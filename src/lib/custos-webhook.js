// Webhook público de custos (M2 da integração de custos, docs/integracao-custos-erp-SPEC.md §6).
// POST /webhook/custos/:wid → limitador → corpo BRUTO (≤ 256 KB) → tratarWebhook. O wid (id opaco) é a única coisa que diz
// de qual cliente é o lote: `cliente` vindo no corpo é ignorado. HMAC sobre os bytes crus ANTES de qualquer parse, janela ±300 s,
// idempotência por batch_id (erp_lotes) e 401 SEMPRE igual (sem dizer se o wid existe, se o carimbo venceu ou se a assinatura não bate).
// Grava só custo local via aplicarLote (M1). Segredo do webhook cifrado (cifrarSegredo, M6) e exibido UMA vez na geração/rotação.
// Log: só os 6 primeiros caracteres do wid, status e contagens — nunca corpo, assinatura, segredo ou lista de SKUs.
import express, { Router } from 'express'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from './env.js'
import { db, agora, auditar } from './promocoes-db.js'
import { aplicarLote, fecharSyncCompleto, gravarEstadoFonte } from './custos-db.js'
import { cifrarSegredo, decifrarSegredo } from './cripto.js'

const LIMITE_CORPO = 256 * 1024, MAX_ITENS = 1000, MAX_LISTA = 200, JANELA_S = 300
const MIN = 60_000, DIA = 24 * 60 * MIN
const WID_OK = /^[A-Za-z0-9_-]{16,64}$/, ID_OK = /^[A-Za-z0-9_-]{8,64}$/
const FONTES_WEBHOOK = ['sheets', 'bling']
const blingLigado = () => process.env.PS_BLING_WEBHOOK === '1'          // padrão DESLIGADO (decisão 6 do dono)

let log = (nivel, msg) => { if (nivel === 'erro') console.error(`[erro] ${msg}`) }
export function configurarLog(fn) { if (typeof fn === 'function') log = fn }

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const NEGADO = () => ({ status: 401, body: { ok: false } })              // resposta ÚNICA para qualquer falha de autenticação
const cab = (headers, nome) => { for (const [k, v] of Object.entries(headers || {})) if (k.toLowerCase() === nome) return Array.isArray(v) ? v[0] : v }
const urlDe = wid => env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}/webhook/custos/${wid}` : ''

// ── assinatura ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// HMAC-SHA256(chave = segredo em UTF-8, NÃO decodificado de hex; mensagem = prefixo + bytes crus), comparado em tempo constante.
function confere(segredo, prefixo, raw, assinatura) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(assinatura ?? ''))
  if (!segredo || !m) return false
  const esperado = createHmac('sha256', Buffer.from(String(segredo), 'utf8')).update(prefixo).update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ''))).digest()
  return timingSafeEqual(esperado, Buffer.from(m[1], 'hex'))               // 32 bytes dos dois lados (regex garante 64 hex)
}
export function verificarAssinaturaSheets({ segredo, timestamp, raw, assinatura, agoraMs = Date.now() }) {
  const ts = String(timestamp ?? '')
  if (!/^\d{1,12}$/.test(ts) || Math.abs(Math.floor(agoraMs / 1000) - Number(ts)) > JANELA_S) return false
  return confere(segredo, ts + '.', raw, assinatura)
}
function abrir(cifrado, w6) {
  if (!cifrado) return ''
  try { return decifrarSegredo(cifrado) } catch (e) {                       // sem ERP_TOKEN_KEY ou dado adulterado: falha FECHADA (401 igual)
    log('erro', `webhook custos ${w6}…: segredo indecifrável (${e?.code || 'confira ERP_TOKEN_KEY'})`); return ''
  }
}

// ── limitador em memória (reinício zera: aceitável, painel em loopback + túnel) ────────────────────────────────────────────
// ponytail: Maps com teto de 10 mil chaves e poda por expiração; processo único, sem Redis
const TETO_CHAVES = 10_000
const baldesWid = new Map(), janelasIp = new Map(), falhasIp = new Map()
function guardar(mapa, chave, valor, t) {
  if (!mapa.has(chave) && mapa.size >= TETO_CHAVES) {
    for (const [k, v] of mapa) if (v.expira < t) mapa.delete(k)
    if (mapa.size >= TETO_CHAVES) mapa.delete(mapa.keys().next().value) // ainda cheio: sai o mais antigo
  }
  mapa.set(chave, valor)
}
// → segundos de espera (0 = passa). 120 req/min por IP, balde por wid (30, +1 a cada 2 s). O bloqueio do IP por falhas de auth
// NÃO entra aqui: ele só vale DEPOIS do HMAC (tratarWebhook) — o IP de saída do Apps Script é compartilhado, e quem assina
// certo nunca pode levar 429 pelas falhas de um estranho no mesmo IP.
function espera(ip, wid, t) {
  let j = janelasIp.get(ip)
  if (!j || t - j.inicio >= MIN) { j = { inicio: t, n: 0, expira: t + MIN }; guardar(janelasIp, ip, j, t) }
  if (j.n >= 120) return Math.ceil((j.inicio + MIN - t) / 1000)
  j.n++
  const b = baldesWid.get(wid), fichas = b ? Math.min(30, b.fichas + (t - b.t) / 2000) : 30
  if (fichas < 1) return Math.ceil((1 - fichas) * 2)
  guardar(baldesWid, wid, { fichas: fichas - 1, t, expira: t + MIN }, t)
  return 0
}
function registrarFalhaAuth(ip, t) {                                          // 10 falhas em 5 min = IP bloqueado por 15 min
  let f = falhasIp.get(ip)
  if (!f || t - f.inicio > 5 * MIN) f = { inicio: t, n: 0, bloqueado_ate: 0 }
  if (++f.n >= 10) f.bloqueado_ate = t + 15 * MIN
  f.expira = Math.max(f.inicio + 5 * MIN, f.bloqueado_ate)
  guardar(falhasIp, ip, f, t)
}
const ipDe = req => String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || '').slice(0, 64)

// ── corpo da planilha (protocolo de fio em inglês curto, §6.3) ─────────────────────────────────────────────────────────────
function validarLote(p, xBatch) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { erro: 'o corpo deve ser um objeto JSON' }
  if (typeof p.batch_id !== 'string' || !ID_OK.test(p.batch_id)) return { erro: 'batch_id inválido (8 a 64 caracteres A-Z a-z 0-9 _ -)' }
  if (xBatch != null && xBatch !== p.batch_id) return { erro: 'X-Batch-Id diferente do batch_id do corpo' }
  const mode = p.mode ?? 'partial'
  if (mode !== 'partial' && mode !== 'full') return { erro: 'mode deve ser partial ou full' }
  let sync_id = '', n = 1, total = 1
  if (mode === 'full') {
    ({ sync_id, batch_no: n, batch_total: total } = p)
    if (typeof sync_id !== 'string' || !ID_OK.test(sync_id)) return { erro: 'sync_id inválido (8 a 64 caracteres A-Z a-z 0-9 _ -)' }
    if (!Number.isInteger(n) || !Number.isInteger(total) || n < 1 || total < n || total > 200) return { erro: 'batch_no/batch_total inválidos (1 ≤ batch_no ≤ batch_total ≤ 200)' }
  }
  if (!Array.isArray(p.items) || !p.items.length) return { erro: 'items deve ser uma lista com 1 a 1000 linhas' }
  if (p.items.length > MAX_ITENS) return { erro: 'mais de 1000 linhas no lote: divida em lotes menores' }
  const linhas = []
  for (const it of p.items) {                                                 // só os campos conhecidos: nada é mesclado
    if (!it || typeof it !== 'object' || Array.isArray(it)) return { erro: 'cada item deve ser um objeto' }
    if (it.sku != null && typeof it.sku !== 'string') return { erro: 'sku deve ser texto' }
    if (it.mlb != null && typeof it.mlb !== 'string') return { erro: 'mlb deve ser texto ou null' }
    if (it.line != null && !(Number.isInteger(it.line) && it.line >= 0)) return { erro: 'line deve ser inteiro' }
    // custo vai BRUTO: quem decide validade é o aplicarLote (custo ruim = linha rejeitada, nunca 4xx do lote)
    linhas.push({ sku: it.sku ?? '', mlb: it.mlb ?? null, custo: it.custo ?? null, linha: it.line ?? null, campo: 'sheets.coluna_custo', id_externo: '', atualizado_na_fonte: null })
  }
  return { batch_id: p.batch_id, modo: mode === 'full' ? 'completo' : 'parcial', sync_id, n, total, linhas }
}

const lista = xs => (xs || []).slice(0, MAX_LISTA)
function tratarSheets(w, headers, raw, agoraMs, w6) {
  const segredos = [w.segredo_cifrado, Date.parse(w.anterior_expira_em) > agoraMs ? w.segredo_anterior_cifrado : '']
  const ts = cab(headers, 'x-timestamp'), sig = cab(headers, 'x-signature')
  if (!segredos.some(s => s && verificarAssinaturaSheets({ segredo: abrir(s, w6), timestamp: ts, raw, assinatura: sig, agoraMs }))) return NEGADO()

  // autenticado daqui para baixo: mensagem curta é permitida (nunca eco do corpo)
  const cliente = w.cliente, fonte = 'sheets'
  db.prepare('UPDATE erp_webhooks SET ultimo_uso_em = ? WHERE wid = ?').run(agora(), w.wid)
  const falha = (status, msg) => {
    gravarEstadoFonte(cliente, fonte, { estado: 'erro', ultimo_sync_em: agora(), ultimo_erro: `lote recusado (${status}): ${msg}` })
    return { status, body: { ok: false, error: msg }, nota: msg }
  }
  let p
  try { p = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { return falha(400, 'JSON inválido') }
  const v = validarLote(p, cab(headers, 'x-batch-id'))
  if (v.erro) return falha(422, v.erro)

  const corpo_hash = createHash('sha256').update(raw).digest('hex')
  const ant = db.prepare('SELECT corpo_hash, resumo_json FROM erp_lotes WHERE cliente = ? AND fonte = ? AND lote_id = ?').get(cliente, fonte, v.batch_id)
  if (ant) return ant.corpo_hash === corpo_hash
    ? { status: 200, body: { ...JSON.parse(ant.resumo_json), duplicate: true }, nota: 'duplicado (resumo guardado, sem reprocessar)' }
    : falha(409, 'batch_id reutilizado com outro conteúdo')
  if (v.modo === 'completo' && db.prepare('SELECT 1 FROM erp_lotes WHERE cliente = ? AND fonte = ? AND sync_id = ? AND lote_total <> ? LIMIT 1').get(cliente, fonte, v.sync_id, v.total))
    return falha(422, 'batch_total diferente dentro do mesmo sync_id')

  // processa, grava o lote e (envio completo) fecha a foto — tudo numa transação: erro do servidor não deixa meio lote
  const recebido_em = agora()
  let body
  db.transaction(() => {
    const r = aplicarLote({ cliente, fonte, modo: v.modo, lote_id: v.batch_id, linhas: v.linhas, origem: 'webhook', por: 'planilha' })
    db.prepare('INSERT INTO erp_lotes (cliente, fonte, lote_id, sync_id, lote_n, lote_total, corpo_hash, resumo_json, recebido_em) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(cliente, fonte, v.batch_id, v.sync_id, v.n, v.total, corpo_hash, '{}', recebido_em)
    let fechou = false
    if (v.modo === 'completo') {                                              // só fecha com TODOS os lotes 1..total do sync_id
      const s = db.prepare('SELECT COUNT(DISTINCT lote_n) n, MIN(recebido_em) inicio FROM erp_lotes WHERE cliente = ? AND fonte = ? AND sync_id = ? AND lote_n BETWEEN 1 AND ?').get(cliente, fonte, v.sync_id, v.total)
      if (s.n === v.total) { fecharSyncCompleto(cliente, fonte, s.inicio); fechou = true }
    }
    body = {
      ok: true, batch_id: v.batch_id, duplicate: false,
      accepted: r.aceitas, new: r.novas, changed: r.alteradas, unchanged: r.inalteradas,
      quarantined: lista(r.quarentena_lista).map(q => ({ sku: q.sku, line: q.linha ?? null, reason: q.motivo })),
      rejected: lista(r.rejeitadas_lista).map(x => ({ sku: x.sku, line: x.linha ?? null, reason: x.motivo })),
      refused: lista(r.recusado_antes_lista).map(x => ({ sku: x.sku, line: x.linha ?? null, reason: x.motivo })),   // valor que o dono já recusou: o vigente continua
      rejected_total: r.rejeitadas, quarantined_total: r.em_quarentena, refused_total: r.recusado_antes, duplicates_equal: r.duplicadas_iguais, closed_full_sync: fechou,
      // accepted + quarantined_total + rejected_total + refused_total + duplicates_equal = linhas do lote (o script só marca "OK" quando a conta fecha)
    }
    db.prepare('UPDATE erp_lotes SET resumo_json = ? WHERE cliente = ? AND fonte = ? AND lote_id = ?').run(JSON.stringify(body), cliente, fonte, v.batch_id)
    // liveness (estado/ultimo_sync_ok_em) é do aplicarLote com origem 'webhook'; aqui só o resumo do último lote para o cartão
    gravarEstadoFonte(cliente, fonte, { ultimo_resumo: { lote_id: v.batch_id, aceitas: r.aceitas, rejeitadas: r.rejeitadas, em_quarentena: r.em_quarentena, fechou_completo: fechou } })
  })()
  return { status: 200, body, nota: `aceitas=${body.accepted} rejeitadas=${body.rejected_total} quarentena=${body.quarantined_total}${body.closed_full_sync ? ' fechou-completo' : ''}` }
}

// ── Bling como GATILHO (§6.8): valida, deduplica, enfileira em erp_fila e responde 200; a releitura autenticada é do M7 ──────
// Envelope assumido { eventId, date, event, companyId, data: { padrao, produto: { id }, ... } }: campos de `data` citados na doc
// oficial; nomes do envelope (`event`, `date`, fuso de `date`) e HMAC sobre o corpo CRU: NÃO CONFIRMADO (validar no 1º evento real).
function tratarBling(w, headers, raw, agoraMs, w6) {
  if (!blingLigado()) return NEGADO()
  const cred = db.prepare("SELECT client_secret_cifrado, company_id FROM erp_credenciais WHERE cliente = ? AND fonte = 'bling'").get(w.cliente || '*')
  if (!confere(abrir(cred?.client_secret_cifrado, w6), '', raw, cab(headers, 'x-bling-signature-256'))) return NEGADO()
  db.prepare('UPDATE erp_webhooks SET ultimo_uso_em = ? WHERE wid = ?').run(agora(), w.wid)
  // autenticado: tudo o mais é 200 silencioso (4xx faria o Bling reenviar por 3 dias e desabilitar o recurso)
  const ignorar = nota => ({ status: 200, body: { ok: true }, nota: `ignorado: ${nota}` })
  let p
  try { p = JSON.parse(raw.toString('utf8')) } catch { return ignorar('JSON inválido') }
  const d = p?.data, id = String(d?.produto?.id ?? ''), eventId = String(p?.eventId ?? '')
  if (!(Math.abs(agoraMs - Date.parse(String(p?.date ?? '').replace(' ', 'T'))) <= 3 * DIA)) return ignorar('date ausente ou fora de 3 dias')
  if (!/^product_supplier\.(created|updated)$/.test(String(p?.event ?? '')) || d?.padrao !== true) return ignorar('evento sem custo do fornecedor padrão')
  if (!/^\d{1,20}$/.test(id) || !eventId || eventId.length > 100) return ignorar('produto.id/eventId inválido')
  const companyId = String(p?.companyId ?? '')
  let cliente = ''
  if (w.cliente) cliente = !cred.company_id || cred.company_id === companyId ? w.cliente : ''   // app próprio: wid já diz o cliente
  else { const rs = db.prepare("SELECT cliente FROM erp_credenciais WHERE fonte = 'bling' AND cliente <> '*' AND company_id <> '' AND company_id = ?").all(companyId); if (rs.length === 1) cliente = rs[0].cliente }
  if (!cliente) return ignorar('companyId desconhecido')                     // 200 silencioso: não vaza quem é cliente
  let novo = false
  db.transaction(() => {
    novo = db.prepare("INSERT OR IGNORE INTO erp_eventos_vistos (fonte, evento_id, em) VALUES ('bling', ?, ?)").run(eventId, agora()).changes === 1
    if (novo) db.prepare("INSERT OR IGNORE INTO erp_fila (cliente, fonte, id_externo, motivo, enfileirado_em) VALUES (?, 'bling', ?, 'gatilho', ?)").run(cliente, id, agora())   // coalescido por produto
  })()
  return { status: 200, body: { ok: true }, nota: novo ? 'gatilho enfileirado' : 'evento repetido' }
}

// Pura (sem porta): devolve { status, headers, body }; nunca lança.
export async function tratarWebhook({ wid, headers = {}, raw, agoraMs = Date.now(), ip } = {}) {
  const w6 = String(wid ?? '').slice(0, 6), corpo = Buffer.isBuffer(raw) ? raw : Buffer.alloc(0)
  let r
  try {
    if (corpo.length > LIMITE_CORPO) r = { status: 413, body: { ok: false } }
    else {
      const w = WID_OK.test(String(wid ?? '')) ? db.prepare('SELECT * FROM erp_webhooks WHERE wid = ? AND ativo = 1').get(wid) : null
      r = !w ? NEGADO() : w.fonte === 'bling' ? tratarBling(w, headers, corpo, agoraMs, w6) : tratarSheets(w, headers, corpo, agoraMs, w6)
    }
  } catch (e) {
    log('erro', `webhook custos ${w6}…: ${String(e?.message || e).slice(0, 160)}`)
    r = { status: 500, body: { ok: false } }
  }
  if (r.status === 401 && ip) {                                               // só quem FALHOU no HMAC sente o bloqueio do IP
    const t = Date.now(), ate = falhasIp.get(ip)?.bloqueado_ate ?? 0
    if (ate > t) r = { status: 429, body: { ok: false }, retry: Math.ceil((ate - t) / 1000) }
    else registrarFalhaAuth(ip, t)
  }
  if (r.status !== 500) log(r.status >= 400 ? 'aviso' : 'info', `webhook custos ${w6}… → ${r.status}${r.nota ? ` ${r.nota}` : ''}`)
  return { status: r.status, headers: { 'Cache-Control': 'no-store', ...(r.retry ? { 'Retry-After': String(r.retry) } : {}) }, body: r.body }
}

// ── roteador (montado no server.js ANTES do express.json: o HMAC é sobre os bytes crus) ──────────────────────────────────
export const rotasWebhookCustos = Router()
rotasWebhookCustos.post('/:wid',
  (req, res, next) => {
    const s = espera(ipDe(req), String(req.params.wid).slice(0, 64), Date.now())
    if (!s) return next()
    res.status(429).set({ 'Retry-After': String(s), 'Cache-Control': 'no-store' }).json({ ok: false })
  },
  express.raw({ type: () => true, limit: LIMITE_CORPO, inflate: false }),
  async (req, res) => {
    const r = await tratarWebhook({ wid: req.params.wid, headers: req.headers, raw: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), agoraMs: Date.now(), ip: ipDe(req) })
    res.status(r.status).set(r.headers).json(r.body)
  })
rotasWebhookCustos.use((err, req, res, next) => {                             // corpo grande = 413; o resto (gzip, aborto) = 400; corpo fixo
  const st = err?.type === 'entity.too.large' ? 413 : 400
  log('aviso', `webhook custos ${String(req.path || '').slice(1, 7)}… → ${st}`)
  res.status(st).set('Cache-Control', 'no-store').json({ ok: false })
})

// ── gestão (chamada pelas rotas do M8; o segredo sai SÓ no retorno de gerar/rotacionar) ──────────────────────────────────────
function conferir(cliente, fonte) {
  if (!FONTES_WEBHOOK.includes(fonte)) throw erro('fonte de webhook inválida (sheets ou bling)')
  if (typeof cliente !== 'string' || cliente.length > 200 || (fonte === 'sheets' && !cliente)) throw erro('informe o cliente')
  return cliente                                                              // bling com cliente '' = app global (cliente por companyId)
}
const exigirBase = () => { if (!env.PUBLIC_BASE_URL) throw erro('configure PUBLIC_BASE_URL', 409) }

export function gerarWebhook(cliente, fonte) {
  conferir(cliente, fonte); exigirBase()
  if (fonte === 'bling' && !blingLigado()) throw erro('webhook do Bling desligado (PS_BLING_WEBHOOK=1 liga)', 409)
  if (db.prepare('SELECT ativo FROM erp_webhooks WHERE cliente = ? AND fonte = ?').get(cliente, fonte)?.ativo) throw erro('webhook já existe: use rotacionar', 409)
  const wid = randomBytes(16).toString('base64url')
  const segredo = fonte === 'sheets' ? randomBytes(32).toString('hex') : ''  // Bling assina com o client_secret do app (erp_credenciais)
  const cifrado = segredo ? cifrarSegredo(segredo) : ''                       // sem ERP_TOKEN_KEY lança ANTES de gravar qualquer coisa
  db.transaction(() => {
    db.prepare('DELETE FROM erp_webhooks WHERE cliente = ? AND fonte = ?').run(cliente, fonte)   // havia um desativado: a URL antiga morre de vez
    db.prepare('INSERT INTO erp_webhooks (wid, cliente, fonte, segredo_cifrado, criado_em) VALUES (?,?,?,?,?)').run(wid, cliente, fonte, cifrado, agora())
    if (fonte === 'sheets') gravarEstadoFonte(cliente, fonte, { estado: 'conectado' })
  })()
  auditar(cliente, 'custos_webhook_gerado', { detalhe: `${fonte} ${wid.slice(0, 6)}…` })
  return { wid, url: urlDe(wid), segredo }
}

export function rotacionarSegredo(cliente, fonte) {
  conferir(cliente, fonte); exigirBase()
  if (fonte !== 'sheets') throw erro('o Bling assina com o client_secret do aplicativo: não há segredo próprio a rotacionar')
  const w = db.prepare('SELECT wid, ativo, segredo_cifrado FROM erp_webhooks WHERE cliente = ? AND fonte = ?').get(cliente, fonte)
  if (!w?.ativo) throw w ? erro('webhook desativado: gere um novo', 409) : erro('webhook ainda não gerado', 404)
  const segredo = randomBytes(32).toString('hex'), cifrado = cifrarSegredo(segredo)
  // o antigo vale mais 24 h (tempo de colar o script novo); segunda rotação dentro da janela sobrescreve o anterior
  db.prepare('UPDATE erp_webhooks SET segredo_cifrado = ?, segredo_anterior_cifrado = ?, anterior_expira_em = ?, rotacionado_em = ? WHERE wid = ?')
    .run(cifrado, w.segredo_cifrado, new Date(Date.now() + DIA).toISOString(), agora(), w.wid)
  auditar(cliente, 'custos_webhook_rotacionado', { detalhe: `${fonte} ${w.wid.slice(0, 6)}…` })
  return { wid: w.wid, url: urlDe(w.wid), segredo }
}

export function desativarWebhook(cliente, fonte) {
  conferir(cliente, fonte)
  const n = db.prepare("UPDATE erp_webhooks SET ativo = 0, segredo_cifrado = '', segredo_anterior_cifrado = '', anterior_expira_em = '' WHERE cliente = ? AND fonte = ? AND ativo = 1").run(cliente, fonte).changes
  if (n) {
    if (fonte === 'sheets') gravarEstadoFonte(cliente, fonte, { estado: 'desconectado' })
    auditar(cliente, 'custos_webhook_desativado', { detalhe: fonte })
  }
  return n === 1
}

export function statusWebhook(cliente, fonte) {
  const w = db.prepare('SELECT wid, ativo, criado_em, rotacionado_em, ultimo_uso_em FROM erp_webhooks WHERE cliente = ? AND fonte = ?').get(String(cliente ?? ''), String(fonte ?? ''))
  return w ? { ativo: !!w.ativo, url: urlDe(w.wid), criado_em: w.criado_em, rotacionado_em: w.rotacionado_em, ultimo_uso_em: w.ultimo_uso_em } : null
}
