// Credenciais OAuth dos ERPs (Bling e Tiny) por cliente: app (client_id/secret), link de autorização com state
// assinado, callback, renovação do token sob lock e status SEM segredos. Tudo cifrado (cifrarSegredo, ERP_TOKEN_KEY;
// sem chave falha fechado). Só o fluxo oficial: o cliente autoriza na tela do ERP — ninguém digita senha de ERP aqui.
// Linha cliente='*' = aplicativo GLOBAL da Place2u (Bling público). Spec: docs/integracao-custos-erp-SPEC.md (7.2, 7.3, 9).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { db, agora, auditar } from './promocoes-db.js'
import { cifrarSegredo, decifrarSegredo, hmacErp } from './cripto.js'
import { env } from './env.js'
import { httpPadrao, criarLimitador, sanitizar } from './erp-http.js'
import { paginaOkErp, paginaErroErp } from './erp-paginas.js'

const ERP = {
  // Bling: redirect_uri e escopos vêm do cadastro do app; token com Basic + enable-jwt: 1 (sem ele a renovação volta token opaco)
  bling: { nome: 'Bling', modoPadrao: 'global', autorizar: 'https://www.bling.com.br/Api/v3/oauth/authorize', token: 'https://api.bling.com.br/Api/v3/oauth/token' },
  // Tiny/Olist (Keycloak): credenciais no corpo; refresh dura 1 dia. NÃO CONFIRMADO: se o `state` volta no callback (checklist 14.2)
  tiny: { nome: 'Tiny', modoPadrao: 'proprio', autorizar: 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth', token: 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token' },
}
const STATE_VALIDADE_S = 30 * 60
const EXPIRA_SEM_INFO_S = 3600        // duração do JWT do Bling NÃO CONFIRMADA: vale o expires_in; sem ele, 1 h (401 → M4 força renovação)
// O Bling bloqueia o IP por 1 h com 20 chamadas/min a /oauth/token: teto de 10/min por ERP no processo (renovações escalonadas)
const LIMITE_TOKEN = { bling: criarLimitador({ porMinuto: 10 }), tiny: criarLimitador({ porMinuto: 10 }) }
// Grant morto ou app recusado: só um novo consentimento resolve — estado 'reautorizar', sem laço de repetição
const PEDE_REAUTORIZAR = e => e.tipo === 'invalid_grant' || e.tipo === 'invalid_client' || /empresa inativa/i.test(e.message)

export const redirectUriErp = () => `${env.PUBLIC_BASE_URL}/erp/callback`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const parse = t => { try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : {} } catch { return {} } }
function exigirFonte(fonte) { if (!Object.hasOwn(ERP, fonte)) throw erro('fonte deve ser bling ou tiny') }
function exigirCliente(cliente) { if (typeof cliente !== 'string' || !cliente || cliente === '*' || cliente.length > 200) throw erro('cliente inválido') }
function credencial(v, nome, max) {                   // a mensagem nunca ecoa o valor
  const t = typeof v === 'string' ? v.trim() : ''
  if (!t) throw erro(`${nome} obrigatório`)
  if (t.length > max || /[\s\u0000-\u001f\u007f]/.test(t)) throw erro(`${nome} inválido`)
  return t
}

// ── estado da fonte (erp_fontes, sem segredos) ────────────────────────────────
// ponytail: upsert direto em vez de gravarEstadoFonte (M1) para não depender da ordem de entrega; mesma tabela, mesmas colunas
function marcarFonte(cliente, fonte, estado, ultimoErro = '') {
  const t = agora()
  db.prepare(`INSERT INTO erp_fontes (cliente, fonte, estado, ultimo_erro, criado_em, atualizado_em) VALUES (?,?,?,?,?,?)
    ON CONFLICT(cliente, fonte) DO UPDATE SET estado = excluded.estado, ultimo_erro = excluded.ultimo_erro, atualizado_em = excluded.atualizado_em`)
    .run(cliente, fonte, estado, sanitizar(ultimoErro), t, t)
}
const estadoDaFonte = (cliente, fonte) => db.prepare('SELECT estado FROM erp_fontes WHERE cliente = ? AND fonte = ?').get(cliente, fonte)?.estado || 'desconectado'

function gravarErro(cliente, fonte, msg) {
  db.prepare(`INSERT INTO erp_credenciais (cliente, fonte, modo_app, atualizado_em, erro) VALUES (?,?,?,?,?)
    ON CONFLICT(cliente, fonte) DO UPDATE SET erro = excluded.erro, atualizado_em = excluded.atualizado_em`)
    .run(cliente, fonte, ERP[fonte].modoPadrao, agora(), sanitizar(msg))
}
function pedirReautorizacao(cliente, fonte, motivo) {
  gravarErro(cliente, fonte, motivo)
  marcarFonte(cliente, fonte, 'reautorizar', motivo)
  auditar(cliente, 'erp_reautorizar', { autor: 'sistema', detalhe: `${ERP[fonte].nome}: ${sanitizar(motivo)}` })
  return null
}
const limparTokens = (cliente, fonte) => db.prepare(`UPDATE erp_credenciais SET access_token_cifrado = '', refresh_token_cifrado = '', expira_em = '',
  refresh_emitido_em = '', escopos = '', company_id = '', conectado_em = '', atualizado_em = ? WHERE cliente = ? AND fonte = ?`).run(agora(), cliente, fonte)

// App que fala com o ERP por este cliente: o próprio (modo 'proprio') ou o global da Place2u (linha '*').
function appDe(cliente, fonte) {
  const proprio = db.prepare('SELECT modo_app, client_id, client_secret_cifrado FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(cliente, fonte)
  const modo = proprio?.modo_app || ERP[fonte].modoPadrao
  const app = modo === 'global' ? db.prepare("SELECT client_id, client_secret_cifrado FROM erp_credenciais WHERE cliente = '*' AND fonte = ?").get(fonte) : proprio
  if (!app?.client_id || !app.client_secret_cifrado)
    throw erro(modo === 'global' ? `cadastre antes o aplicativo global do ${ERP[fonte].nome} (client_id/secret)` : `cadastre antes o client_id/secret do aplicativo ${ERP[fonte].nome} deste cliente`, 409)
  return { modo, client_id: app.client_id, cifrado: app.client_secret_cifrado }
}

// POST no endpoint de token (troca do code ou renovação). Erro carrega `tipo` (ex. invalid_grant) e nunca o corpo cru.
async function pedirToken(fonte, app, params, { http = httpPadrao, limitadorToken = LIMITE_TOKEN[fonte] } = {}) {
  const corpo = new URLSearchParams(params)
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (fonte === 'bling') Object.assign(headers, { Authorization: 'Basic ' + Buffer.from(`${app.client_id}:${app.client_secret}`).toString('base64'), 'enable-jwt': '1' })
  else { corpo.set('client_id', app.client_id); corpo.set('client_secret', app.client_secret) }
  await limitadorToken?.aguardar()
  const r = await http({ metodo: 'POST', url: ERP[fonte].token, headers, corpo: corpo.toString() })
  const j = parse(r.texto)
  if (r.status === 429) limitadorToken?.registrar429(Number(r.headers?.['retry-after']) * 1000 || 60_000)
  if (r.status >= 200 && r.status < 300 && typeof j.access_token === 'string' && j.access_token) return j
  const tipo = String((typeof j.error === 'string' ? j.error : j.error?.type) || '')                       // Tiny: { error } · Bling: { error: { type } }
  const desc = j.error_description || j.error?.description || j.error?.message || ''
  throw Object.assign(new Error(sanitizar(`${ERP[fonte].nome} OAuth ${r.status}${tipo ? ` ${tipo}` : ''}${desc ? `: ${desc}` : ''}`)), { tipo })
}
const expiraEm = (tok, agoraMs) => new Date(agoraMs + (Number(tok.expires_in) > 0 ? Number(tok.expires_in) : EXPIRA_SEM_INFO_S) * 1000).toISOString()

// ── cadastro do aplicativo ────────────────────────────────────────────────────
export function salvarAppGlobal(fonte, { client_id, client_secret } = {}, por = '') {
  if (fonte !== 'bling') throw erro('aplicativo global só existe para o Bling (no Tiny o app é criado na conta do cliente)')
  const id = credencial(client_id, 'client_id', 200)
  const cifrado = cifrarSegredo(credencial(client_secret, 'client_secret', 500))       // sem ERP_TOKEN_KEY lança ANTES de gravar
  db.prepare(`INSERT INTO erp_credenciais (cliente, fonte, modo_app, client_id, client_secret_cifrado, atualizado_em) VALUES ('*', ?, 'global', ?, ?, ?)
    ON CONFLICT(cliente, fonte) DO UPDATE SET client_id = excluded.client_id, client_secret_cifrado = excluded.client_secret_cifrado,
      atualizado_em = excluded.atualizado_em, erro = ''`).run(fonte, id, cifrado, agora())
  auditar('*', 'erp_app_global', { autor: por, detalhe: `${ERP[fonte].nome}: client_id/secret do app global atualizados` })
  return { ok: true }
}

export function salvarCredenciaisApp(cliente, fonte, { modo_app, client_id, client_secret } = {}, por = '') {
  exigirCliente(cliente); exigirFonte(fonte)
  if (modo_app !== 'global' && modo_app !== 'proprio') throw erro('modo_app deve ser global ou proprio')
  if (modo_app === 'global' && fonte !== 'bling') throw erro('no Tiny o aplicativo é sempre o do próprio cliente (modo_app=proprio)')
  const id = modo_app === 'proprio' ? credencial(client_id, 'client_id', 200) : ''
  const cifrado = modo_app === 'proprio' ? cifrarSegredo(credencial(client_secret, 'client_secret', 500)) : ''
  const antes = db.prepare('SELECT modo_app, client_id FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(cliente, fonte)
  const trocouApp = !!antes && (antes.modo_app !== modo_app || antes.client_id !== id)
  db.transaction(() => {
    db.prepare(`INSERT INTO erp_credenciais (cliente, fonte, modo_app, client_id, client_secret_cifrado, atualizado_em) VALUES (?,?,?,?,?,?)
      ON CONFLICT(cliente, fonte) DO UPDATE SET modo_app = excluded.modo_app, client_id = excluded.client_id,
        client_secret_cifrado = excluded.client_secret_cifrado, atualizado_em = excluded.atualizado_em, erro = ''`)
      .run(cliente, fonte, modo_app, id, cifrado, agora())
    // o token pertence ao app que o emitiu: trocou de app = a conexão antiga não renova mais → desconecta (pede nova autorização)
    if (trocouApp) { limparTokens(cliente, fonte); marcarFonte(cliente, fonte, 'desconectado') }
  })()
  auditar(cliente, 'erp_credenciais', { autor: por, detalhe: `${ERP[fonte].nome}: app ${modo_app}${trocouApp ? ' (app trocado: conexão anterior desfeita)' : ''}` })
  return { ok: true }
}

// ── autorização (state assinado + nonce de uso único) ─────────────────────────
const assinarState = (nonce, exp, cliente, fonte) => hmacErp(JSON.stringify(['erp-state', nonce, exp, cliente, fonte]))

export function urlAutorizacao(cliente, fonte) {
  exigirCliente(cliente); exigirFonte(fonte)
  if (!env.PUBLIC_BASE_URL) throw erro('configure PUBLIC_BASE_URL no .env (o ERP devolve o cliente para /erp/callback)', 409)
  const app = appDe(cliente, fonte)
  const nonce = randomBytes(16).toString('base64url'), exp = Math.floor(Date.now() / 1000) + STATE_VALIDADE_S
  const state = `${nonce}.${exp}.${assinarState(nonce, exp, cliente, fonte)}`         // sem chave: lança antes de gravar o nonce
  db.prepare('INSERT INTO erp_oauth_state (nonce, cliente, fonte, criado_em) VALUES (?,?,?,?)').run(nonce, cliente, fonte, agora())
  const p = fonte === 'bling'
    ? { response_type: 'code', client_id: app.client_id, state }
    : { client_id: app.client_id, redirect_uri: redirectUriErp(), scope: 'openid', response_type: 'code', state }
  return `${ERP[fonte].autorizar}?${new URLSearchParams(p)}`
}

const INVALIDO = 'Link de autorização inválido.'
function validarState(state, agoraMs) {
  const m = typeof state === 'string' && /^([A-Za-z0-9_-]{22})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(state)
  if (!m) return { motivo: INVALIDO }
  const [, nonce, exp, sig] = m
  const row = db.prepare('SELECT cliente, fonte FROM erp_oauth_state WHERE nonce = ?').get(nonce)
  if (!row || !Object.hasOwn(ERP, row.fonte)) return { motivo: INVALIDO }
  const esperado = Buffer.from(assinarState(nonce, Number(exp), row.cliente, row.fonte)), recebido = Buffer.from(sig)
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return { motivo: INVALIDO }   // adulterado ou de outro cliente
  if (agoraMs / 1000 > Number(exp)) return { motivo: 'Link de autorização expirado — peça ao seu consultor para gerar um novo.' }
  // uso único com UPDATE condicional: dois callbacks com o mesmo state → só um troca o code (no Bling, reusar o code REVOGA o usuário)
  if (db.prepare("UPDATE erp_oauth_state SET usado_em = ? WHERE nonce = ? AND usado_em = ''").run(agora(), nonce).changes !== 1)
    return { motivo: 'Este link de autorização já foi usado — peça um novo ao seu consultor.' }
  return { cliente: row.cliente, fonte: row.fonte }
}

// GET /erp/callback (público). deps: { http, limitadorToken, agoraMs } — injetáveis nos testes.
export async function tratarCallbackErp(query = {}, deps = {}) {
  const agoraMs = deps.agoraMs ?? Date.now()
  const falhou = (status, motivo) => ({ status, html: paginaErroErp(motivo) })
  let alvo
  try { alvo = validarState(query?.state, agoraMs) } catch (e) {
    return e.code === 'ERP_SEM_CHAVE' ? falhou(409, 'O painel ainda não está pronto para conectar ERPs (falta configurar a chave de segurança).') : falhou(500, INVALIDO)
  }
  if (alvo.motivo) return falhou(400, alvo.motivo)
  const { cliente, fonte } = alvo
  if (query.error !== undefined) return falhou(400, 'A autorização foi cancelada ou recusada no ERP.')     // sem eco do texto do ERP
  const code = typeof query.code === 'string' ? query.code : ''
  if (!code || code.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(code)) return falhou(400, 'O ERP não devolveu o código de autorização.')
  try {
    const app = appDe(cliente, fonte)
    const tok = await pedirToken(fonte, { client_id: app.client_id, client_secret: decifrarSegredo(app.cifrado) },
      fonte === 'tiny' ? { grant_type: 'authorization_code', code, redirect_uri: redirectUriErp() } : { grant_type: 'authorization_code', code }, deps)
    if (typeof tok.refresh_token !== 'string' || !tok.refresh_token) throw new Error(`${ERP[fonte].nome} OAuth: resposta sem refresh_token`)
    const t = agora()
    // company_id zera: quem grava é o testar() do conector (pode ser outra empresa do ERP nesta reconexão)
    db.prepare(`INSERT INTO erp_credenciais (cliente, fonte, modo_app, access_token_cifrado, refresh_token_cifrado, expira_em, refresh_emitido_em, escopos, company_id, conectado_em, atualizado_em, erro)
      VALUES (@cliente, @fonte, @modo, @acc, @ref, @exp, @t, @escopos, '', @t, @t, '')
      ON CONFLICT(cliente, fonte) DO UPDATE SET access_token_cifrado = excluded.access_token_cifrado, refresh_token_cifrado = excluded.refresh_token_cifrado,
        expira_em = excluded.expira_em, refresh_emitido_em = excluded.refresh_emitido_em, escopos = excluded.escopos, company_id = '',
        conectado_em = excluded.conectado_em, atualizado_em = excluded.atualizado_em, erro = ''`)
      .run({ cliente, fonte, modo: app.modo, acc: cifrarSegredo(tok.access_token), ref: cifrarSegredo(tok.refresh_token), exp: expiraEm(tok, agoraMs), t, escopos: sanitizar(tok.scope ?? '') })
    marcarFonte(cliente, fonte, 'conectado')
    auditar(cliente, 'erp_conectado', { autor: 'oauth', detalhe: `${ERP[fonte].nome} autorizado pelo cliente` })
    return { status: 200, html: paginaOkErp(cliente, ERP[fonte].nome) }
  } catch (e) {
    gravarErro(cliente, fonte, e.message)
    if (e.code === 'ERP_SEM_CHAVE') return falhou(409, 'O painel ainda não está pronto para conectar ERPs (falta configurar a chave de segurança).')
    return falhou(e.status === 409 ? 409 : 502, 'O ERP recusou a conexão ou não respondeu. Peça um novo link ao seu consultor.')
  }
}

// ── token válido (renovação sob lock por conta) ───────────────────────────────
// deps: { http, limitadorToken, agoraMs, forcar } — `forcar` (ou `renovar`, nome usado pelo conector Bling) renova mesmo dentro
// da validade (401 do ERP; keepalive do Tiny).
// ponytail: lock em memória por processo (Map de promessas, como meli-contas.js); dois processos renovando a mesma conta não são cobertos.
const renovando = new Map()
export async function obterTokenValido(cliente, fonte, deps = {}) {
  if (typeof cliente !== 'string' || !cliente || cliente === '*' || !Object.hasOwn(ERP, fonte)) return null
  const chave = `${fonte}|${cliente}`
  if (renovando.has(chave)) return renovando.get(chave)
  const row = db.prepare('SELECT access_token_cifrado, refresh_token_cifrado, expira_em FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(cliente, fonte)
  if (!row?.refresh_token_cifrado || estadoDaFonte(cliente, fonte) === 'reautorizar') return null      // reautorizar só sai com novo consentimento
  const agoraMs = deps.agoraMs ?? Date.now()
  if (!deps.forcar && !deps.renovar && row.access_token_cifrado && agoraMs < Date.parse(row.expira_em) - 60_000) {
    try { return decifrarSegredo(row.access_token_cifrado) } catch (e) { return ilegivel(cliente, fonte, e) }
  }
  const p = renovar(cliente, fonte, row, deps, agoraMs).finally(() => renovando.delete(chave))
  renovando.set(chave, p)
  return p
}
function ilegivel(cliente, fonte, e) {
  if (e.code === 'ERP_SEM_CHAVE') throw e                                         // falha fechado: configuração, não token
  return pedirReautorizacao(cliente, fonte, 'token ilegível com a ERP_TOKEN_KEY atual — reautorize o ERP')
}
async function renovar(cliente, fonte, row, deps, agoraMs) {
  let app, refresh
  try {
    app = appDe(cliente, fonte)
    app.client_secret = decifrarSegredo(app.cifrado)
    refresh = decifrarSegredo(row.refresh_token_cifrado)
  } catch (e) {
    if (e.code !== 'ERP_SEM_CHAVE' && e.status === 409) { gravarErro(cliente, fonte, e.message); return null }    // app descadastrado: não chama o ERP
    return ilegivel(cliente, fonte, e)
  }
  try {
    const tok = await pedirToken(fonte, app, { grant_type: 'refresh_token', refresh_token: refresh }, deps)
    const acc = cifrarSegredo(tok.access_token)
    const ref = typeof tok.refresh_token === 'string' && tok.refresh_token ? cifrarSegredo(tok.refresh_token) : null   // refresh tratado como rotativo
    const t = agora()
    // gravação ATÔMICA (access + refresh novo no mesmo UPDATE), só se a linha ainda é a da renovação (não reconectou/desconectou no meio)
    const r = db.prepare(`UPDATE erp_credenciais SET access_token_cifrado = @acc, refresh_token_cifrado = COALESCE(@ref, refresh_token_cifrado),
        refresh_emitido_em = CASE WHEN @ref IS NULL THEN refresh_emitido_em ELSE @t END, expira_em = @exp, atualizado_em = @t, erro = ''
      WHERE cliente = @cliente AND fonte = @fonte AND refresh_token_cifrado = @antigo`)
      .run({ acc, ref, t, exp: expiraEm(tok, agoraMs), cliente, fonte, antigo: row.refresh_token_cifrado })
    if (r.changes) return tok.access_token
    const atual = db.prepare('SELECT access_token_cifrado FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(cliente, fonte)?.access_token_cifrado
    return atual ? decifrarSegredo(atual) : null
  } catch (e) {
    if (e.code === 'ERP_SEM_CHAVE') throw e
    // reconectou/desconectou (ou o refresh girou) enquanto esta renovação esperava o limitador ou o HTTP: o erro é do refresh
    // VELHO — não marca reautorizar nem grava erro em cima da conexão nova; devolve o token atual (mesma condição do UPDATE acima)
    const atual = db.prepare('SELECT access_token_cifrado, refresh_token_cifrado FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(cliente, fonte)
    if (atual?.refresh_token_cifrado !== row.refresh_token_cifrado) {
      try { return atual?.access_token_cifrado ? decifrarSegredo(atual.access_token_cifrado) : null } catch (e2) { return ilegivel(cliente, fonte, e2) }
    }
    if (PEDE_REAUTORIZAR(e)) return pedirReautorizacao(cliente, fonte, e.message)
    gravarErro(cliente, fonte, e.message)                                            // transitório (rede, 5xx, 429): tenta na próxima chamada
    return null
  }
}

// ── status e desconexão ──────────────────────────────────────────────────────
// Nunca seleciona coluna *_cifrado: só deriva booleanos dela no próprio SQL.
export function statusCredenciais(cliente, fonte) {
  if (!Object.hasOwn(ERP, fonte) || typeof cliente !== 'string') return null
  const r = db.prepare(`SELECT modo_app, (client_id <> '' AND client_secret_cifrado <> '') AS app_proprio, (refresh_token_cifrado <> '') AS tem_token,
      expira_em, refresh_emitido_em, escopos, company_id, conectado_em, atualizado_em, erro
    FROM erp_credenciais WHERE cliente = ? AND fonte = ?`).get(cliente, fonte)
  const modo = r?.modo_app || ERP[fonte].modoPadrao
  const appGlobal = modo === 'global' && !!db.prepare("SELECT 1 FROM erp_credenciais WHERE cliente = '*' AND fonte = ? AND client_id <> '' AND client_secret_cifrado <> ''").get(fonte)
  const reautorizar = cliente !== '*' && estadoDaFonte(cliente, fonte) === 'reautorizar'
  return {
    conectado: !!r?.tem_token && !reautorizar, reautorizar, modo_app: modo,
    app_configurado: modo === 'global' ? appGlobal : !!r?.app_proprio,
    escopos: String(r?.escopos || '').split(/[\s,]+/).filter(Boolean),
    company_id: r?.company_id || '', expira_em: r?.expira_em || '', refresh_emitido_em: r?.refresh_emitido_em || '',
    conectado_em: r?.conectado_em || '', atualizado_em: r?.atualizado_em || '', erro: sanitizar(r?.erro || ''),
  }
}

// Apaga os tokens locais e mantém o app cadastrado (reautorizar não exige redigitar client_id/secret).
// No Bling o cliente também deve desinstalar em "Minhas Instalações" (o guia diz isso).
export function desconectarErp(cliente, fonte, por = '') {
  exigirCliente(cliente); exigirFonte(fonte)
  const tinha = !!db.prepare("SELECT 1 FROM erp_credenciais WHERE cliente = ? AND fonte = ? AND refresh_token_cifrado <> ''").get(cliente, fonte)
  db.transaction(() => { limparTokens(cliente, fonte); marcarFonte(cliente, fonte, 'desconectado') })()
  auditar(cliente, 'erp_desconectado', { autor: por, detalhe: `${ERP[fonte].nome}${tinha ? '' : ' (já estava sem tokens)'}` })
  return { ok: true, tinha_conexao: tinha }
}
