// Persistência das conexões Mercado Livre por cliente. Tokens sempre
// cifrados (cripto.js) — nada fora daqui manuseia texto puro.
import { db, agora } from './db.js'
import { cifrar, decifrar } from './cripto.js'
import { renovarToken, revogarAutorizacao } from './meli-oauth.js'
import { limparPromocoesDoCliente } from './promocoes-db.js'
import { notificar } from './notificacoes.js'
import { ufDoPerfil } from './dimensoes.js'
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, env } from './env.js'
import { ehChaveS90, semChaveS90, S90_FORA_DA_COLETA_SQL } from './s90-chave.js'

// prospect do Comercial e conta do Place Sprint 90 (LGPD): a conexão antiga NUNCA vai para meli_contas_arquivo (apaga de vez); o S90 também fica fora do backup e da restauração
const semArquivo = cliente => /^\[(Comercial|S90)\] /.test(cliente)

// dados coletados da conta anterior NUNCA podem se misturar com os da nova (reconexão com outra conta do ML)
export const TABELAS_SERIE = ['meli_item', 'meli_serie_item', 'meli_coleta_dia', 'meli_ads_item', 'meli_ads_dia', 'meli_ads_cobertura', 'tarefa_acomp', 'meli_item_mudanca', 'meli_anuncio_up', 'meli_pedido_item', 'meli_up_estoque', 'meli_envio_custo']
export function limparSerieDoCliente(cliente, motivo = '') {
  for (const t of TABELAS_SERIE) db.prepare(`DELETE FROM ${t} WHERE cliente = ?`).run(cliente)
  // promoções: apaga o derivado da conta antiga (preserva config/custos/regras/aprendizados/auditoria). Um erro aqui NUNCA impede a troca/desconexão.
  try { limparPromocoesDoCliente(cliente, motivo) } catch (e) { console.error(semChaveS90(`[meli-contas] limpeza de promoções de "${cliente}" falhou: ${e.message}`)) }
}
export function salvarConexao(cliente, tokenResp, perfil = {}) {
  const linhaAnterior = db.prepare('SELECT * FROM meli_contas WHERE cliente = ?').get(cliente)
  const anterior = linhaAnterior?.meli_user_id
  if (anterior && String(anterior) !== String(tokenResp.user_id)) {
    // outra conta do ML: a série da antiga não pode se misturar com a nova (recomeça do zero), mas a CONEXÃO antiga fica arquivada (restaurável) e a troca AVISA
    if (!semArquivo(cliente)) {
      db.prepare('INSERT INTO meli_contas_arquivo (cliente, linha_json, motivo, arquivado_em) VALUES (?,?,?,?)').run(cliente, JSON.stringify(linhaAnterior), `conta ML trocada: ${anterior} → ${tokenResp.user_id}`, agora())
      try { notificar({ tipo: 'conta_trocada', nivel: 'alerta', titulo: `Conta do Mercado Livre TROCADA: ${cliente}`, corpo: `A conexão deste cliente agora aponta para OUTRA conta (${perfil.nickname || tokenResp.user_id}; antes: ${linhaAnterior.nickname || anterior}). Os dados coletados da conta anterior foram apagados; a conexão anterior ficou guardada e pode ser restaurada em Integrações. Se foi engano (link enviado à pessoa errada), restaure.`, cliente, link: '/integracoes' }) } catch { /* aviso é melhor esforço */ }
    }
    limparSerieDoCliente(cliente, `conta ML trocada: ${anterior} → ${tokenResp.user_id}`)
    // S90: o plano por anúncio do vendedor anterior (anúncios, títulos, fotos) nunca é projetado no painel da conexão nova — nada dele foi ao Notion
    if (ehChaveS90(cliente)) db.prepare("DELETE FROM acoes_plano WHERE cliente = ? AND regra LIKE 'anuncio\\_%' ESCAPE '\\'").run(cliente)
  }
  const expiraEm = new Date(Date.now() + tokenResp.expires_in * 1000).toISOString()
  // UF do perfil que o callback já buscou; perfil sem endereço (falha de rede) mantém a da MESMA conta — nunca herda a de outra
  const uf = ufDoPerfil(perfil) || (String(anterior) === String(tokenResp.user_id) ? linhaAnterior?.uf || '' : '')
  db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id, uf)
    VALUES (?,?,?,?,?,?,?,?,?,'',?,?)
    ON CONFLICT(cliente) DO UPDATE SET meli_user_id=excluded.meli_user_id, nickname=excluded.nickname,
      access_token=excluded.access_token, refresh_token=excluded.refresh_token, expira_em=excluded.expira_em,
      escopos=excluded.escopos, atualizado_em=excluded.atualizado_em, erro='', app_id=excluded.app_id, uf=excluded.uf`)
    .run(cliente, tokenResp.user_id, perfil.nickname || '', cifrar(tokenResp.access_token),
      cifrar(tokenResp.refresh_token), expiraEm, tokenResp.scope || '', agora(), agora(), tokenResp.app_id || '', uf)
}

// Status de conexão para exibir (nunca devolve o token em si).
export function statusConexao(cliente) {
  const row = db.prepare('SELECT cliente, meli_user_id, nickname, expira_em, conectado_em, atualizado_em, erro FROM meli_contas WHERE cliente = ?').get(cliente)
  return row || null
}

// coleta diária, promoções de madrugada e renovação preventiva: sem conexão em erro e sem conta S90 fora de serviço (cancelada, exclusão agendada…: só consulta até o expurgo)
export function listarConexoesColeta() {
  return db.prepare(`SELECT cliente, meli_user_id, nickname, expira_em, conectado_em, atualizado_em, erro FROM meli_contas WHERE cliente NOT LIKE '[Comercial] %' AND COALESCE(erro, '') = '' AND NOT ${S90_FORA_DA_COLETA_SQL} ORDER BY cliente`).all()
}

export function listarConexoes() {
  // só CLIENTES: conexões de prospect do comercial ("[Comercial] Empresa · id") ficam fora de todo fluxo
  // de cliente (coleta diária, promoções, custos, painel). O comercial lê a dele por statusConexao(chave).
  return db.prepare("SELECT cliente, meli_user_id, nickname, expira_em, conectado_em, atualizado_em, erro FROM meli_contas WHERE cliente NOT LIKE '[Comercial] %' ORDER BY cliente").all()
}

// A conexão é o ativo mais difícil de recuperar (o cliente precisa autorizar de novo): ao desconectar um CLIENTE a linha (tokens
// continuam cifrados) vai para meli_contas_arquivo e dá para restaurar sem pedir nada ao cliente enquanto o ML não revogar. Prospect (LGPD): apaga de vez.
db.exec(`CREATE TABLE IF NOT EXISTS meli_contas_arquivo (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, linha_json TEXT NOT NULL, motivo TEXT NOT NULL DEFAULT '', arquivado_em TEXT NOT NULL)`)
export function desconectar(cliente, motivo = 'desconectado pelo painel') {
  const linha = db.prepare('SELECT * FROM meli_contas WHERE cliente = ?').get(cliente)
  if (linha && !semArquivo(cliente)) {
    db.prepare('INSERT INTO meli_contas_arquivo (cliente, linha_json, motivo, arquivado_em) VALUES (?,?,?,?)').run(cliente, JSON.stringify(linha), motivo, agora())
    db.prepare("DELETE FROM meli_contas_arquivo WHERE arquivado_em < ?").run(new Date(Date.now() - 90 * 86400e3).toISOString())
  }
  db.prepare('DELETE FROM meli_contas WHERE cliente = ?').run(cliente)
  limparSerieDoCliente(cliente, 'conta ML desconectada')             // desconectou = apaga também o que foi coletado dessa conta
}

// Devolve um access_token utilizável — renova sozinho se estiver perto de
// expirar (tokens do ML duram ~6h). Retorna null se não há conexão ou se a
// renovação falhar (ex.: cliente revogou o acesso no painel do Mercado Livre).
const renovando = new Map()                                    // uma renovação por vez por cliente, NESTE processo
// O refresh_token do ML é de USO ÚNICO e rotativo: se dois processos (servidor + script de CLI) renovam a mesma conta ao
// mesmo tempo, o segundo usa um token já queimado e a conta cai ("invalid_grant"). Por isso a renovação passa por uma
// TRAVA NO BANCO (vale entre processos) e RELÊ a linha depois de obtê-la: se outro processo já renovou, só usa o resultado.
db.exec(`CREATE TABLE IF NOT EXISTS meli_renovacao_trava (cliente TEXT PRIMARY KEY, dono TEXT NOT NULL, em INTEGER NOT NULL)`)
const DONO = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const TRAVA_MS = 45_000                                        // trava velha (processo morreu no meio) é tomada depois disso
function pegarTrava(cliente) {
  return db.transaction(() => {
    const t = db.prepare('SELECT dono, em FROM meli_renovacao_trava WHERE cliente = ?').get(cliente)
    if (t && t.dono !== DONO && Date.now() - t.em < TRAVA_MS) return false
    db.prepare('INSERT INTO meli_renovacao_trava (cliente, dono, em) VALUES (?,?,?) ON CONFLICT(cliente) DO UPDATE SET dono = excluded.dono, em = excluded.em').run(cliente, DONO, Date.now())
    return true
  }).immediate()
}
const soltarTrava = cliente => db.prepare('DELETE FROM meli_renovacao_trava WHERE cliente = ? AND dono = ?').run(cliente, DONO)
const frescoDemais = (row, margemMs = 60_000) => Date.now() < new Date(row.expira_em).getTime() - margemMs
const espera = ms => new Promise(ok => setTimeout(ok, ms))

// margemMs: quanto antes de vencer já vale renovar (60 s no uso normal; a renovação preventiva usa 90 min para a conta nunca chegar ao vencimento)
export async function tokenValido(cliente, { margemMs = 60_000 } = {}) {
  let row = db.prepare('SELECT * FROM meli_contas WHERE cliente = ?').get(cliente)
  if (!row) return null
  if (frescoDemais(row, margemMs)) return decifrar(row.access_token)
  if (renovando.has(cliente)) return renovando.get(cliente)
  const p = (async () => {
    for (let i = 0; i < 30; i++) {                             // até ~30 s esperando outro processo terminar a renovação
      if (pegarTrava(cliente)) break
      await espera(1000)
      row = db.prepare('SELECT * FROM meli_contas WHERE cliente = ?').get(cliente)
      if (row && frescoDemais(row, margemMs)) return decifrar(row.access_token)   // o outro processo já renovou: só usa
      if (i === 29) return null
    }
    try {
      row = db.prepare('SELECT * FROM meli_contas WHERE cliente = ?').get(cliente)    // RELÊ: pode ter sido renovado entre a espera e a trava
      if (!row) return null
      if (frescoDemais(row, margemMs)) return decifrar(row.access_token)
      return await renovarERegistrar(cliente, row)
    } finally { soltarTrava(cliente) }
  })().finally(() => renovando.delete(cliente))
  renovando.set(cliente, p)
  return p
}

// Renovação PREVENTIVA (chamada pelo servidor a cada ~30 min): renova o que vence em < 90 min e dá um "toque" no refresh_token de
// contas ociosas (refresh_token do ML expira por inatividade ~6 meses; renovar de tempos em tempos garante que NUNCA envelheça).
export async function renovarPreventivo({ margemMin = 90, clientes = null, retomarErrosHoras = 6 } = {}) {
  const limite = Date.now() + margemMin * 60_000
  let lista = db.prepare(`SELECT cliente, expira_em, erro, atualizado_em FROM meli_contas WHERE cliente NOT LIKE '[Comercial]%' AND NOT ${S90_FORA_DA_COLETA_SQL}`).all()
  if (Array.isArray(clientes)) lista = lista.filter(c => clientes.includes(c.cliente))   // o autoteste só toca nas contas dele
  const corteErro = new Date(Date.now() - retomarErrosHoras * 3600e3).toISOString()
  const res = { renovadas: 0, ok: 0, falhas: [], recuperadas: 0 }
  for (const c of lista) {
    const emErro = !!c.erro
    // conta em erro é retomada de tempos em tempos (pode ter sido um falso alarme resolvido por outro processo); se o refresh morreu de verdade, falha de novo sem barulho
    if (emErro && !(c.atualizado_em < corteErro)) continue
    if (!emErro && new Date(c.expira_em).getTime() > limite) { res.ok++; continue }
    const tok = await tokenValido(c.cliente, { margemMs: margemMin * 60_000 })     // renova DE VERDADE (antes só renovava quando faltavam 60 s)
    const depois = db.prepare('SELECT erro, expira_em FROM meli_contas WHERE cliente = ?').get(c.cliente)
    if (tok && !depois?.erro) { if (emErro) res.recuperadas++; if (depois?.expira_em !== c.expira_em) res.renovadas++; else res.ok++ }
    else if (!emErro) res.falhas.push({ cliente: c.cliente, erro: depois?.erro || 'sem token (falha transitória: tenta de novo no próximo ciclo)' })
    await espera(400)                                          // não martela a API do ML
  }
  return res
}
// renovações em voo: o desligamento do servidor espera por elas (matar o processo entre a resposta do ML e a gravação perderia o refresh_token novo)
const emVoo = new Set()
export async function aguardarRenovacoes(ms = 25_000) { const t0 = Date.now(); while (emVoo.size && Date.now() - t0 < ms) await espera(200) }

const ARQ_PENDENTE = /^meli_pendente-.+\.json$/
// o par novo (já cifrado) que não coube no banco: guardado em arquivo 0600 para recuperar — o ML já invalidou o antigo, esta é a ÚNICA cópia
function guardarPendente(cliente, par) {
  mkdirSync(DIR_BACKUP, { recursive: true })
  const arq = join(DIR_BACKUP, `meli_pendente-${Buffer.from(cliente).toString('base64url').slice(0, 40)}-${Date.now()}.json`)
  writeFileSync(arq, JSON.stringify({ cliente, ...par }), { mode: 0o600 })
  return arq
}
// exclusão LGPD do S90: o par de tokens que ficou em arquivo (meli_pendente-*.json) daquela chave também sai
export function purgarPendentesDe(cliente) {
  let n = 0
  let arquivos = []
  try { arquivos = readdirSync(DIR_BACKUP).filter(f => ARQ_PENDENTE.test(f)) } catch { return 0 }
  for (const f of arquivos) {
    try { if (JSON.parse(readFileSync(join(DIR_BACKUP, f), 'utf-8')).cliente === cliente) { unlinkSync(join(DIR_BACKUP, f)); n++ } } catch { /* arquivo ilegível: o próximo ciclo de recuperação decide */ }
  }
  return n
}
export function recuperarPendentes() {
  let n = 0
  let arquivos = []
  try { arquivos = readdirSync(DIR_BACKUP).filter(f => ARQ_PENDENTE.test(f)).sort() } catch { return 0 }
  for (const f of arquivos) {
    try {
      const p = JSON.parse(readFileSync(join(DIR_BACKUP, f), 'utf-8'))
      const r = db.prepare("UPDATE meli_contas SET access_token = ?, refresh_token = ?, expira_em = ?, atualizado_em = ?, erro = '' WHERE cliente = ? AND expira_em < ?").run(p.access_token, p.refresh_token, p.expira_em, agora(), p.cliente, p.expira_em)
      if (r.changes || !db.prepare('SELECT 1 FROM meli_contas WHERE cliente = ?').get(p.cliente)) { unlinkSync(join(DIR_BACKUP, f)); n++ }
      else unlinkSync(join(DIR_BACKUP, f))                    // a linha do banco já é mais nova que o arquivo: nada a recuperar
    } catch { /* tenta de novo no próximo ciclo */ }
  }
  return n
}

async function renovarERegistrar(cliente, row) {
  emVoo.add(cliente)
  try {
    let novo
    try { novo = await renovarToken(decifrar(row.refresh_token), row.app_id) }   // mesmo app que emitiu o token
    catch (e) { return tratarFalhaRenovacao(cliente, row, e) }
    const expiraEm = new Date(Date.now() + novo.expires_in * 1000).toISOString()
    const parNovo = { access_token: cifrar(novo.access_token), refresh_token: cifrar(novo.refresh_token), expira_em: expiraEm }
    // GRAVA SEMPRE: o ML já queimou o refresh_token antigo e este é o único exemplar do novo. Repete a escrita (outro processo pode estar com o banco
    // ocupado) e só grava se a linha ainda tem o refresh_token que usamos (comparação atômica: se outro processo gravou um par, o dele vale).
    let ultimo
    for (let i = 0; i < 30; i++) {
      try {
        const r = db.prepare(`UPDATE meli_contas SET access_token=?, refresh_token=?, expira_em=?, atualizado_em=?, erro='' WHERE cliente=? AND refresh_token=?`)
          .run(parNovo.access_token, parNovo.refresh_token, parNovo.expira_em, agora(), cliente, row.refresh_token)
        if (r.changes) return novo.access_token
        const atual = db.prepare('SELECT access_token, expira_em FROM meli_contas WHERE cliente = ?').get(cliente)
        return atual && frescoDemais(atual, 0) ? decifrar(atual.access_token) : novo.access_token
      } catch (e) { ultimo = e; await espera(2000) }
    }
    try { guardarPendente(cliente, parNovo) } catch { /* sem disco: pelo menos o aviso abaixo */ }
    try { notificar({ tipo: 'conexao_pendente', nivel: 'erro', titulo: `Token renovado mas NÃO gravado: ${cliente}`, corpo: `O Mercado Livre renovou o acesso, mas o banco recusou a gravação (${String(ultimo?.message || '').slice(0, 80)}). O par novo foi guardado em data/backups e é recuperado automaticamente.`, cliente, link: '/integracoes', dedupeMin: 60 }) } catch { /* aviso é melhor esforço */ }
    return novo.access_token
  } finally { emVoo.delete(cliente) }
}

function tratarFalhaRenovacao(cliente, row, e) {
  const msg = String(e.message || '')
  // SÓ invalid_grant / "Error validating grant" prova que o refresh_token morreu (revogado, expirado ou já usado). Outro 400/401 (invalid_client = credencial
  // do app errada no .env, por exemplo) NÃO é culpa da conta do cliente: marcar erro derrubaria todas as contas por um segredo trocado.
  const tokenMorto = /invalid_grant|Error validating grant/i.test(msg)
  if (tokenMorto) {
    // CORRIDA: outro processo pode ter usado este mesmo refresh_token um instante antes e já gravado o novo. Se a linha mudou e está fresca,
    // a conexão está VIVA — só usa o token dele e NÃO marca erro (era assim que uma conta saudável caía por "invalid_grant").
    const atual = db.prepare('SELECT access_token, refresh_token, expira_em FROM meli_contas WHERE cliente = ?').get(cliente)
    if (atual && atual.refresh_token !== row.refresh_token && frescoDemais(atual, 0)) return decifrar(atual.access_token)
    db.prepare('UPDATE meli_contas SET erro=?, atualizado_em=? WHERE cliente=?').run(msg.slice(0, 300), agora(), cliente)
    if (!/^\[Comercial\] /.test(cliente)) {
      try { notificar({ tipo: 'conexao_caiu', nivel: 'erro', titulo: `Conexão com o Mercado Livre caiu: ${cliente}`, corpo: 'O Mercado Livre recusou a renovação do acesso (autorização revogada ou refresh token já usado). Gere o link de reconexão e envie ao cliente — os dados já coletados continuam no sistema.', cliente, link: '/integracoes', dedupeMin: 12 * 60 }) } catch { /* aviso é melhor esforço */ }
    }
  } else if (/OAuth (400|401)/i.test(msg)) {
    try { notificar({ tipo: 'meli_credencial', nivel: 'alerta', titulo: 'O Mercado Livre recusou as credenciais do aplicativo', corpo: `A renovação de ${cliente} falhou com "${msg.slice(0, 90)}" — não é a conta do cliente: confira MELI_CLIENT_ID/MELI_CLIENT_SECRET no .env. Nenhuma conta foi marcada como caída.`, cliente: '', link: '/integracoes', dedupeMin: 6 * 60 }) } catch { /* aviso é melhor esforço */ }
  }
  return null
}

// O ML revoga o APP inteiro para aquele seller: outra conexão (cliente OU prospect) do mesmo seller no mesmo app cairia junto.
// App comparado pelo EFETIVO: app_id '' é conexão antiga do app PRINCIPAL (meli-oauth.js appPorId), não um app diferente.
export function outraConexaoDoApp(meliUserId, appId, exceto = '') {
  return db.prepare("SELECT cliente FROM meli_contas WHERE meli_user_id = ? AND COALESCE(NULLIF(app_id, ''), @p) = COALESCE(NULLIF(@app, ''), @p) AND cliente != @exceto")
    .get(meliUserId, { p: env.MELI_CLIENT_ID, app: String(appId || ''), exceto: String(exceto) })?.cliente || null
}
// Revoga no ML a autorização desta conexão (melhor esforço: quem chama apaga os dados de qualquer jeito). true = o ML confirmou.
export async function revogarConexao(cliente) {
  const row = db.prepare('SELECT meli_user_id, app_id FROM meli_contas WHERE cliente = ?').get(cliente)
  if (!row) return false
  if (outraConexaoDoApp(row.meli_user_id, row.app_id, cliente)) return false
  try {
    const token = await tokenValido(cliente)                     // o guardado; renova só se expirou
    return !!token && await revogarAutorizacao(token, row.meli_user_id, row.app_id)
  } catch { return false }
}

export function idDoVendedor(cliente) {
  return db.prepare('SELECT meli_user_id FROM meli_contas WHERE cliente = ?').get(cliente)?.meli_user_id || null
}

// ── backup diário das conexões (tokens JÁ cifrados): se o banco corromper ou alguém apagar a linha, o vínculo se restaura sem o cliente autorizar de novo ──
const DIR_BACKUP = join(ROOT, 'data', 'backups')
export function backupConexoes(hoje = new Date().toISOString().slice(0, 10)) {
  mkdirSync(DIR_BACKUP, { recursive: true })
  const linhas = db.prepare("SELECT * FROM meli_contas WHERE cliente NOT LIKE '[Comercial]%' AND cliente NOT LIKE '[S90]%'").all()
  if (!linhas.length) return { arquivo: null, n: 0, pulado: true }          // nunca grava um backup vazio por cima do que existe
  const arq = join(DIR_BACKUP, `meli_contas-${hoje}.json`)
  // o snapshot do dia é regravado a cada ciclo (o refresh_token roda a cada ~5 h; um snapshot só diário já nasceria velho) e NUNCA perde conta que ele já tinha
  const mapa = new Map()
  try { for (const l of JSON.parse(readFileSync(arq, 'utf-8')).linhas || []) mapa.set(l.cliente, l) } catch { /* 1º do dia */ }
  for (const l of linhas) mapa.set(l.cliente, l)
  const todas = [...mapa.values()]
  writeFileSync(arq, JSON.stringify({ feito_em: agora(), n: todas.length, linhas: todas }), { mode: 0o600 })
  try { chmodSync(arq, 0o600) } catch { /* sistema sem chmod */ }
  const antigos = readdirSync(DIR_BACKUP).filter(f => /^meli_contas-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14)   // guarda 14 dias (arquivos de poucos KB)
  for (const f of antigos) try { unlinkSync(join(DIR_BACKUP, f)) } catch { /* já apagado */ }
  return { arquivo: arq, n: todas.length }
}
// restaura SÓ conexões que sumiram do banco (nunca sobrescreve uma conexão viva). origem: 'arquivo' (último backup) ou 'arquivada' (desconectada pelo painel)
export function restaurarConexoes({ clientes = null, origem = 'arquivo' } = {}) {
  let linhas = []
  if (origem === 'arquivada') linhas = db.prepare('SELECT linha_json FROM meli_contas_arquivo ORDER BY id DESC').all().map(r => JSON.parse(r.linha_json)).filter(l => !l.erro)   // conexão arquivada já em erro está morta: não ressuscita
  else {
    const fs = readdirSync(DIR_BACKUP).filter(x => /^meli_contas-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().reverse()   // do mais novo ao mais velho: vale a 1ª linha de cada cliente
    for (const f of fs) { try { linhas.push(...(JSON.parse(readFileSync(join(DIR_BACKUP, f), 'utf-8')).linhas || [])) } catch { /* arquivo ruim: segue */ } }
  }
  const vistos = new Set(), out = []
  for (const l of linhas) {
    if (vistos.has(l.cliente) || (clientes && !clientes.includes(l.cliente)) || ehChaveS90(l.cliente)) continue   // S90 nunca ressuscita (exclusão LGPD)
    vistos.add(l.cliente)
    if (db.prepare('SELECT 1 FROM meli_contas WHERE cliente = ?').get(l.cliente)) continue
    const cols = Object.keys(l)
    db.prepare(`INSERT INTO meli_contas (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => l[c]))
    out.push(l.cliente)
  }
  return out
}
