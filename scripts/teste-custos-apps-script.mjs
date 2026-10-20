// Auto-teste do M3 (Apps Script da planilha de custos, spec custos ERP seção 8/12): roda o Codigo.gs GERADO por gerarScriptApps
// em node:vm com stubs dos serviços do Google (UrlFetchApp, Utilities com HMAC real do node:crypto e bytes COM SINAL como no
// Apps Script, SpreadsheetApp, PropertiesService, LockService, ScriptApp). Teste de CONTRATO: a assinatura que o script produz é
// aceita por verificarAssinaturaSheets do M2. Sem rede, sem Google, banco do núcleo em memória. Rodar: node scripts/teste-custos-apps-script.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // o M2 importa o núcleo, que abre o banco no import: tem de ser memória
import assert from 'node:assert/strict'
import vm from 'node:vm'
import crypto from 'node:crypto'
process.env.ERP_TOKEN_KEY = crypto.randomBytes(32).toString('hex')   // chave de TESTE p/ o webhook real (vence a do .env; nunca impressa)
process.env.PUBLIC_BASE_URL = 'https://teste.invalid'
const { gerarScriptApps } = await import('../src/lib/custos-sheets-script.js')
const W = await import('../src/lib/custos-webhook.js')
const R = await import('../src/lib/promocoes-db.js')
const C = await import('../src/lib/custos-db.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }

const SEGREDO = crypto.randomBytes(32).toString('hex')
const URL_WH = 'https://tunel.exemplo.test/webhook/custos/AbCdEfGhIjKlMnOpQrStUv'
const TEXTO = gerarScriptApps({ url: URL_WH, segredo: SEGREDO })
const CAB = ['SKU', 'MLB', 'Custo', 'Status']

// ── ambiente Apps Script simulado ─────────────────────────────────────────────────────────────────────────
const comSinal = b => Array.from(new Int8Array(b.buffer, b.byteOffset, b.length))      // Byte[] do Apps Script: -128..127
const PARECE_DATA = /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/                                   // o que o Sheets converte em data ao gravar texto
function ambiente({ linhas = null, cab = CAB, responder = servidor(), instalar = true, travado = false, texto = TEXTO } = {}) {
  const rel = { ms: Date.UTC(2026, 9, 5, 15, 0, 0) }
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [rel.ms])) } static now() { return rel.ms } }
  const chamadas = [], props = {}, doc = {}, gatilhos = [], toasts = [], esperas = [], abas = {}, menus = [], alertas = [], respostasUi = []
  const aba = dados => ({
    dados, formato: {}, fmt: [],
    getLastRow: () => dados.length,
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { setNumberFormat: f => { this.formato[r] = f } }
      const fmt = this.fmt
      return {
        getValues: () => Array.from({ length: nr }, (_, k) => Array.from({ length: nc }, (_, i) => (dados[r - 1 + k] || [])[c - 1 + i] ?? '')),   // como no Sheets: sempre nr linhas
        setNumberFormat: f => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) (fmt[r - 1 + i] ||= [])[c - 1 + j] = f },
        setValues: v => { assert.equal(v.length, nr, 'setValues: linhas'); v.forEach((l, i) => { assert.equal(l.length, nc, 'setValues: colunas'); l.forEach((x, j) => {
          const texto = (fmt[r - 1 + i] || [])[c - 1 + j] === '@'                           // como no Sheets: "1/3" sem formato de texto vira data
          ;(dados[r - 1 + i] ||= [])[c - 1 + j] = typeof x === 'string' && !texto && PARECE_DATA.test(x) ? new Date(0) : x }) }) },
      }
    },
  })
  if (linhas) abas.Custos = aba([cab, ...linhas])
  const ss = { getSheetByName: nm => abas[nm] || null, insertSheet: nm => (abas[nm] = aba([])), toast: m => toasts.push(String(m)), getSpreadsheetTimeZone: () => 'America/Sao_Paulo' }
  const loja = o => ({ getProperty: k => o[k] ?? null, setProperty: (k, v) => { o[k] = String(v) }, setProperties: p => { Object.assign(o, p) }, deleteProperty: k => { delete o[k] } })
  const ui = {
    ButtonSet: { OK_CANCEL: 'OK_CANCEL', OK: 'OK' }, Button: { OK: 'OK', CANCEL: 'CANCEL' },
    prompt: () => { const [b, t] = respostasUi.shift(); return { getSelectedButton: () => b, getResponseText: () => t } },
    alert: (...a) => alertas.push(a.join(' ')),
    createMenu: nome => { const m = { nome, itens: [], addItem(rot, fn) { this.itens.push([rot, fn]); return this }, addToUi() { menus.push(m) } }; return m },
  }
  const ctx = vm.createContext({
    Date: FakeDate,
    Utilities: {
      computeHmacSha256Signature: (v, k) => comSinal(crypto.createHmac('sha256', Buffer.from(k, 'utf8')).update(v, 'utf8').digest()),
      computeDigest: (_alg, v) => comSinal(crypto.createHash('sha256').update(v, 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(),
      sleep: ms => { esperas.push(ms); rel.ms += ms },
      formatDate: d => new Date(d.getTime()).toISOString().slice(0, 16),
    },
    PropertiesService: { getScriptProperties: () => loja(props), getDocumentProperties: () => loja(doc) },
    LockService: { getScriptLock: () => ({ tryLock: () => !travado, releaseLock: () => {} }) },
    ScriptApp: {
      getProjectTriggers: () => gatilhos.slice(),
      deleteTrigger: t => gatilhos.splice(gatilhos.indexOf(t), 1),
      newTrigger: fn => ({ timeBased: () => ({ everyMinutes: m => ({ create: () => { const t = { fn, m, getHandlerFunction: () => fn }; gatilhos.push(t); return t } }) }) }),
    },
    UrlFetchApp: {
      fetch: (url, opt) => {
        chamadas.push({ url, opt, em: rel.ms })
        const r = responder(JSON.parse(opt.payload), chamadas.length)
        if (r instanceof Error) throw r
        return { getResponseCode: () => r.code, getContentText: () => r.texto }
      },
    },
    SpreadsheetApp: { getActive: () => ss, getUi: () => ui },
  })
  vm.runInContext(texto, ctx, { filename: 'Codigo.gs' })
  if (instalar) ctx.instalar()
  const status = (nome = 'Custos') => abas[nome].dados.slice(1).map(l => l[3] ?? '')
  const corpos = () => chamadas.map(c => JSON.parse(c.opt.payload))
  return { ctx, rel, chamadas, props, doc, gatilhos, toasts, esperas, abas, menus, alertas, respostasUi, status, corpos, setResponder: f => { responder = f } }
}

// servidor simulado no formato da resposta 6.5 (accepted/quarantined/rejected/refused por line); antigo = sem os campos de recusa
function servidor({ rej = [], qua = [], rec = [], cortar = 200, antigo = false } = {}) {
  return corpo => {
    const it = corpo.items, Rj = it.filter(i => rej.includes(i.sku)), Q = it.filter(i => qua.includes(i.sku)), Rc = it.filter(i => rec.includes(i.sku))
    const lista = (a, reason) => a.slice(0, cortar).map(i => ({ sku: i.sku, line: i.line, reason }))
    const aceitas = it.length - Rj.length - Q.length - Rc.length
    const recusa = antigo ? {} : { refused: lista(Rc, 'o painel mantém R$ 10,00 (custo anterior da planilha)'), refused_total: Rc.length, duplicates_equal: 0 }
    return { code: 200, texto: JSON.stringify({ ok: true, batch_id: corpo.batch_id, duplicate: false, accepted: aceitas, new: aceitas, changed: 0, unchanged: 0,
      quarantined: lista(Q, 'variação de 180% sobre R$ 10,00 (limite 50%)'), rejected: lista(Rj, 'conflito com o SKU do anúncio'),
      rejected_total: Rj.length, quarantined_total: Q.length, closed_full_sync: false, ...recusa }) }
  }
}
const resp = (code, texto = '{"ok":false}') => ({ code, texto })

// servidor REAL (tratarWebhook → aplicarLote, banco em memória). O fetch do Apps Script é síncrono e o webhook é async: a rodada
// captura o corpo assinado (resposta 418, sem efeito no servidor), processa no webhook real e repete devolvendo a resposta real
async function rodadaReal(G, wid) {
  const k = G.chamadas.length
  G.setResponder(() => resp(418)); G.ctx.sincronizarAgora()
  const c = G.chamadas[k], h = c.opt.headers
  const r = await W.tratarWebhook({ wid, raw: Buffer.from(c.opt.payload, 'utf8'), agoraMs: c.em, headers: { 'x-timestamp': h['X-Timestamp'], 'x-signature': h['X-Signature'], 'x-batch-id': h['X-Batch-Id'] } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  G.setResponder(() => ({ code: 200, texto: JSON.stringify(r.body) })); G.ctx.sincronizarAgora()
  return r.body
}

// contrato com o M2 + conferência independente da fórmula da spec 6.2 (HMAC(segredo UTF-8, "<ts>." + bytes crus), hex minúsculo)
const aceitoPeloM2 = (c, { payload = c.opt.payload, agoraMs = c.em } = {}) => W.verificarAssinaturaSheets({
  segredo: SEGREDO, timestamp: c.opt.headers['X-Timestamp'], raw: Buffer.from(payload, 'utf8'), assinatura: c.opt.headers['X-Signature'], agoraMs })
const assinaturaSpec = c => 'sha256=' + crypto.createHmac('sha256', SEGREDO).update(c.opt.headers['X-Timestamp'] + '.').update(Buffer.from(c.opt.payload, 'utf8')).digest('hex')

// ── 1. gerador ───────────────────────────────────────────────────────────────────────────────────────────
ok('gerador recusa URL e segredo fora da regra', () => {
  for (const url of ['http://x.test/a', 'https://a b', 'https://a"b', "https://a'b", 'https://a`b', 'https://a\\b', 'https://a\nb', 'https://a b', '', null, 123, 'https://' + 'a'.repeat(2000)])
    assert.throws(() => gerarScriptApps({ url, segredo: SEGREDO }), e => e.status === 400, `url ${JSON.stringify(url)}`)
  for (const segredo of [SEGREDO.slice(1), SEGREDO.toUpperCase(), 'g'.repeat(64), SEGREDO + '0', '', null])
    assert.throws(() => gerarScriptApps({ url: URL_WH, segredo }), e => e.status === 400 && !(segredo && e.message.includes(segredo)), 'segredo inválido (sem eco)')
  assert.throws(() => gerarScriptApps(), e => e.status === 400)
})
ok('texto gerado compila, sem marcadores, sem aspas soltas e sem onEdit', () => {
  const url = 'https://t.test/webhook/custos/abc$&x$$y$1'
  const t = gerarScriptApps({ url, segredo: SEGREDO })
  new vm.Script(t, { filename: 'gerado.gs' })                                  // aspas soltas não compilariam
  assert.ok(!t.includes('__WEBHOOK_URL__') && !t.includes('__WEBHOOK_SECRET__'))
  assert.ok(t.includes(`salvarConfig_(${JSON.stringify(url)}, "${SEGREDO}");`), 'URL e segredo dentro de strings, sem padrão $& expandido')
  assert.equal(t.split(SEGREDO).length, 2, 'segredo aparece uma única vez (só em instalar)')
  assert.ok(!/function\s+onEdit/.test(t), 'sem onEdit')
})

// ── 2. instalar / menu / configurar ──────────────────────────────────────────────────────────────────────
ok('instalar grava propriedades, cria abas e UM gatilho de 10 min (idempotente)', () => {
  const G = ambiente({ instalar: false })
  G.doc.HASH = 'velho'
  G.ctx.instalar(); G.ctx.instalar()
  assert.deepEqual(G.props, { WEBHOOK_URL: URL_WH, WEBHOOK_SECRET: SEGREDO })
  assert.equal(G.doc.HASH, undefined, 'configuração nova força reenvio')
  assert.equal(G.gatilhos.length, 1); assert.equal(G.gatilhos[0].fn, 'sincronizarAuto'); assert.equal(G.gatilhos[0].m, 10)
  assert.deepEqual(G.abas.Custos.dados[0], CAB); assert.equal(G.abas.Custos.formato['A:A'], '@', 'SKU em texto simples')
  assert.equal(G.abas.Sync_Log.dados[0][0], 'Quando')
  assert.ok(G.toasts.every(t => !t.includes(SEGREDO)))
})
ok('onOpen só cria o menu Custos', () => {
  const G = ambiente({ instalar: false })
  G.ctx.onOpen()
  assert.deepEqual(G.menus.map(m => [m.nome, m.itens]), [['Custos', [['Sincronizar agora', 'sincronizarAgora'], ['Configurar', 'configurar'], ['Criar aba-modelo', 'criarAbaModelo']]]])
  assert.equal(G.chamadas.length, 0)
})
ok('Configurar valida, cancela e grava', () => {
  const G = ambiente({ instalar: false })
  G.respostasUi.push(['OK', URL_WH], ['OK', 'abc']); G.ctx.configurar()
  assert.equal(G.props.WEBHOOK_SECRET, undefined); assert.match(G.alertas[0], /inválido/)
  G.respostasUi.push(['CANCEL', '']); G.ctx.configurar()
  assert.equal(G.props.WEBHOOK_URL, undefined)
  G.respostasUi.push(['OK', ' ' + URL_WH + ' '], ['OK', SEGREDO]); G.ctx.configurar()
  assert.deepEqual(G.props, { WEBHOOK_URL: URL_WH, WEBHOOK_SECRET: SEGREDO }); assert.equal(G.gatilhos.length, 1)
})
ok('sem configuração não envia nada', () => {
  const G = ambiente({ instalar: false, linhas: [['A1', '', 10]] })
  G.ctx.sincronizarAuto(); G.ctx.sincronizarAgora()
  assert.equal(G.chamadas.length, 0); assert.match(G.toasts.at(-1), /configurar/i)
})

// ── 3. contrato da assinatura com o M2 + JSON só ASCII ───────────────────────────────────────────────────
ok('assinatura do script é aceita por verificarAssinaturaSheets (M2); 1 byte ou carimbo fora = recusada', () => {
  const sku = 'Caneca Água ção 😀 ñ', G = ambiente({ linhas: [[sku, '', 10.5], ['B-2', 'MLB123', 7]] })
  G.ctx.sincronizarAgora()
  assert.equal(G.chamadas.length, 1)
  const c = G.chamadas[0]
  assert.ok(!/[^\x00-\x7f]/.test(c.opt.payload), 'corpo só ASCII (\\uXXXX)')
  assert.equal(JSON.parse(c.opt.payload).items[0].sku, sku.normalize('NFC'), 'roundtrip de acento e emoji')
  assert.match(c.opt.headers['X-Signature'], /^sha256=[0-9a-f]{64}$/)
  assert.match(c.opt.headers['X-Timestamp'], /^\d{10}$/)
  assert.equal(c.opt.headers['X-Signature'], assinaturaSpec(c), 'fórmula da spec 6.2')
  assert.equal(aceitoPeloM2(c), true, 'CONTRATO M3→M2')
  const adulterado = c.opt.payload.replace('10.5', '10.6')
  assert.notEqual(adulterado, c.opt.payload)
  assert.equal(aceitoPeloM2(c, { payload: adulterado }), false)
  assert.equal(aceitoPeloM2(c, { agoraMs: c.em + 301000 }), false)
  assert.equal(aceitoPeloM2(c, { agoraMs: c.em - 301000 }), false)
  assert.equal(c.opt.method, 'post'); assert.equal(c.opt.contentType, 'application/json'); assert.equal(c.opt.muteHttpExceptions, true)
  assert.equal(c.opt.followRedirects, false); assert.equal(c.url, URL_WH)
  assert.equal(c.opt.headers['X-Batch-Id'], JSON.parse(c.opt.payload).batch_id)
})

// ── 4. retry ─────────────────────────────────────────────────────────────────────────────────────────────
ok('429, 503 e erro de rede repetem com o MESMO corpo e carimbo novo; todas as tentativas assinadas valem', () => {
  const G = ambiente({ linhas: [['A1', '', 10]], responder: (corpo, k) => (k === 1 ? resp(429) : k === 2 ? resp(503) : k === 3 ? new Error('Timeout') : servidor()(corpo)) })
  G.ctx.sincronizarAgora()
  assert.equal(G.chamadas.length, 4)
  assert.ok(G.chamadas.every(c => c.opt.payload === G.chamadas[0].opt.payload), 'corpo idêntico')
  assert.equal(new Set(G.chamadas.map(c => c.opt.headers['X-Timestamp'])).size, 4, 'carimbo novo a cada tentativa')
  assert.ok(G.chamadas.every(c => aceitoPeloM2(c)))
  assert.equal(G.esperas.length, 3); assert.ok(G.esperas[0] >= 1000 && G.esperas[1] >= 2000 && G.esperas[2] >= 4000, 'espera crescente')
  assert.match(G.status()[0], /^OK /)
})
ok('400 não repete; 500 contínuo faz 4 tentativas; nenhum grava hash', () => {
  const G = ambiente({ linhas: [['A1', '', 10]], responder: () => resp(400, '{"ok":false,"erro":"esquema"}') })
  G.ctx.sincronizarAgora()
  assert.equal(G.chamadas.length, 1); assert.equal(G.status()[0], 'ERRO HTTP 400 (nova tentativa na próxima rodada)'); assert.equal(G.doc.HASH, undefined)
  const H = ambiente({ linhas: [['A1', '', 10]], responder: () => resp(500) })
  H.ctx.sincronizarAgora()
  assert.equal(H.chamadas.length, 4); assert.equal(H.esperas.length, 3, 'não espera depois da última'); assert.equal(H.doc.HASH, undefined)
})
ok('falha 401 não grava hash nem batimento, registra no log e a próxima rodada reenvia', () => {
  let k401 = true
  const G = ambiente({ linhas: [['A', '', 5]], responder: c => (k401 ? resp(401) : servidor()(c)) })
  G.ctx.sincronizarAuto()
  assert.equal(G.status()[0], 'ERRO HTTP 401 (nova tentativa na próxima rodada)')
  assert.equal(G.doc.HASH, undefined); assert.equal(G.doc.LAST_SEND, undefined)
  const log = G.abas.Sync_Log.dados.at(-1)
  assert.equal(log[4], 401); assert.match(log[11], /^erro: /)
  k401 = false; G.ctx.sincronizarAuto()
  assert.equal(G.chamadas.length, 2); assert.match(G.status()[0], /^OK /); assert.ok(G.doc.HASH)
})

// ── 5. lotes ─────────────────────────────────────────────────────────────────────────────────────────────
ok('1204 linhas = 3 lotes (500, 500, 204) com mode full, sync_id único e batch_no/batch_total', () => {
  const linhas = Array.from({ length: 1204 }, (_, i) => ['S' + i, '', 10 + i])
  const G = ambiente({ linhas })
  G.ctx.sincronizarAuto()
  const cs = G.corpos()
  assert.deepEqual(cs.map(c => c.items.length), [500, 500, 204])
  assert.deepEqual(cs.map(c => [c.mode, c.batch_no, c.batch_total]), [['full', 1, 3], ['full', 2, 3], ['full', 3, 3]])
  assert.equal(new Set(cs.map(c => c.sync_id)).size, 1); assert.equal(new Set(cs.map(c => c.batch_id)).size, 3)
  assert.ok(cs.every(c => /^[A-Za-z0-9_-]{8,64}$/.test(c.batch_id) && c.sync_id !== c.batch_id))
  assert.deepEqual([cs[0].items[0].line, cs[2].items.at(-1).line], [2, 1205])
  assert.ok(G.chamadas.every(c => aceitoPeloM2(c)))
  assert.equal(G.abas.Sync_Log.dados.length, 1 + 3)
  assert.ok(G.status().every(s => s.startsWith('OK ')))
})
ok('lote que falha interrompe o envio: os seguintes ficam "NÃO ENVIADO" e o hash não é salvo', () => {
  const linhas = Array.from({ length: 1001 }, (_, i) => ['S' + i, '', 1 + i])
  const G = ambiente({ linhas, responder: (c, k) => (k === 1 ? servidor()(c) : resp(500)) })
  G.ctx.sincronizarAuto()
  assert.equal(G.chamadas.length, 1 + 4)
  const st = G.status()
  assert.match(st[0], /^OK /); assert.match(st[500], /^ERRO HTTP 500/); assert.equal(st[1000], 'NÃO ENVIADO: lote anterior falhou')
  assert.equal(G.doc.HASH, undefined)
})

// ── 6. validação local e status por linha ────────────────────────────────────────────────────────────────
ok('rejeições locais nunca viram custo; status por linha de accepted/quarantined/rejected', () => {
  const linhas = [
    ['A1', '', 10],                      // 2  ok
    ['A2', ' mlb123 ', 12.345678],       // 3  ok (MLB normalizado, custo bruto)
    ['', 'MLB999', 5],                   // 4  ok só com MLB
    ['VAZIO', '', ''],                   // 5
    ['TXT', '', 'abc'],                  // 6
    ['NA', '', '#N/A'],                  // 7
    ['DT', '', new Date(0)],             // 8
    ['BOOL', '', true],                  // 9
    ['ZERO', '', 0],                     // 10
    ['NEG', '', -1],                     // 11
    ['MIN', '', 0.00001],                // 12 arredonda a 0 → rejeita
    ['Dup', '', 1],                      // 13 duplicado (sem diferença de caixa/espaço) → TODAS as ocorrências
    ['dup ', '', 1],                     // 14
    ['MU', 'MLBU123', 3],                // 15 MLBU de catálogo
    ['', '', 7],                         // 16 sem SKU e sem MLB
    ['', '', ''],                        // 17 linha vazia
    [12345, '', 3],                      // 18 ok, SKU numérico vira texto
    ['Q1', '', 50],                      // 19 quarentena no servidor
    ['R1', '', 60],                      // 20 rejeitado no servidor
    [new Date(0), '', 3],                // 21 SKU data
    ['X'.repeat(81), '', 3],             // 22 SKU longo
    [' A B​ ', '', 4],         // 23 ok → 'A B'
    ['MLB-NUM', 1234, 2],                // 24 MLB numérico inválido
    [1e16, '', 2],                       // 25 SKU numérico longo
  ]
  const G = ambiente({ linhas, responder: servidor({ qua: ['Q1'], rej: ['R1'] }) })
  G.ctx.sincronizarAgora()
  const st = G.status(), itens = G.corpos()[0].items
  assert.deepEqual(itens.map(i => [i.sku, i.mlb, i.custo, i.line]), [
    ['A1', null, 10, 2], ['A2', 'MLB123', 12.345678, 3], ['', 'MLB999', 5, 4], ['12345', null, 3, 18], ['Q1', null, 50, 19], ['R1', null, 60, 20], ['A B', null, 4, 23]])
  assert.ok(itens.every(i => typeof i.custo === 'number' && i.custo > 0), 'só number > 0 sai da planilha')
  const esperado = {
    2: /^OK /, 3: /^OK /, 4: /^OK /, 5: /^REJEITADO: custo vazio$/, 6: /^REJEITADO: custo não numérico: abc$/, 7: /^REJEITADO: erro de fórmula na planilha \(#N\/A\)/,
    8: /^REJEITADO: custo não numérico/, 9: /^REJEITADO: custo não numérico: true$/, 10: /^REJEITADO: custo deve ser > 0$/, 11: /^REJEITADO: custo deve ser > 0$/,
    12: /^REJEITADO: custo deve ser > 0$/, 13: /^REJEITADO: SKU repetido na planilha$/, 14: /^REJEITADO: SKU repetido na planilha$/, 15: /^REJEITADO: MLB inválido/,
    16: /^REJEITADO: linha sem SKU e sem MLB$/, 17: /^$/, 18: /^OK /, 19: /^EM ANÁLISE: variação de 180%/, 20: /^REJEITADO \(servidor\): conflito/,
    21: /^REJEITADO: SKU inválido/, 22: /^REJEITADO: SKU com mais de 80/, 23: /^OK /, 24: /^REJEITADO: MLB inválido/, 25: /^REJEITADO: SKU inválido/,
  }
  for (const [linha, re] of Object.entries(esperado)) assert.match(st[linha - 2], re, `linha ${linha}: ${st[linha - 2]}`)
  const log = G.abas.Sync_Log.dados.at(-1)
  assert.deepEqual(log.slice(3, 11), [7, 200, 5, 5, 0, 0, 1, 1])
  assert.match(log[11], /L20 R1: conflito/); assert.match(log[11], /L19 Q1: variação/)
  assert.match(G.toasts.at(-1), /5 aceito\(s\), 1 em análise, 0 recusado\(s\) no painel, 1 rejeitado\(s\) pelo servidor, 16 rejeitado\(s\) na planilha/)
  const D = ambiente({ linhas: [['', 'MLB999', 5], ['', 'mlb999', 6], ['OK1', '', 1]] })
  D.ctx.sincronizarAgora()
  assert.deepEqual(D.status().map(s => s.replace(/^OK .*/, 'OK')), ['REJEITADO: MLB repetido na planilha', 'REJEITADO: MLB repetido na planilha', 'OK'])
})
ok('lista do servidor cortada (total > itens listados): linha não listada NÃO vira "OK"', () => {
  const G = ambiente({ linhas: [['R1', '', 1], ['R2', '', 2], ['B', '', 3]], responder: servidor({ rej: ['R1', 'R2'], cortar: 1 }) })
  G.ctx.sincronizarAgora()
  assert.deepEqual(G.status().map(s => s.split(' ')[0]), ['REJEITADO', 'ENVIADO', 'ENVIADO'])
})
ok('nenhuma linha válida: não chama o servidor e escreve os motivos', () => {
  const G = ambiente({ linhas: [['A', '', ''], ['B', '', 0]] })
  G.ctx.sincronizarAgora()
  assert.equal(G.chamadas.length, 0); assert.deepEqual(G.status(), ['REJEITADO: custo vazio', 'REJEITADO: custo deve ser > 0'])
})

// ── 7. pulo por hash e batimento diário ──────────────────────────────────────────────────────────────────
ok('sem mudança não envia; mudou reenvia; "Sincronizar agora" força; batimento só depois de 20 h', () => {
  const G = ambiente({ linhas: [['A1', '', 10], ['A2', '', 20]] })
  G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 1); assert.ok(G.doc.HASH && G.doc.LAST_SEND)
  G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 1, 'nada mudou')
  G.abas.Custos.dados[2][2] = 21; G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 2, 'mudou um custo → reenvia tudo')
  G.ctx.sincronizarAgora(); assert.equal(G.chamadas.length, 3, 'botão ignora o hash')
  G.rel.ms += 19 * 3600e3; G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 3, '19 h: ainda não')
  G.rel.ms += 2 * 3600e3; G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 4, '21 h: batimento reenvia o completo')
  assert.equal(G.corpos()[3].mode, 'full'); assert.equal(G.doc.LAST_SEND, String(G.rel.ms))
  G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 4, 'batimento renovado')
})
ok('trava ocupada não envia', () => {
  const G = ambiente({ linhas: [['A1', '', 10]], travado: true })
  G.ctx.sincronizarAgora(); assert.equal(G.chamadas.length, 0); assert.match(G.toasts.at(-1), /em andamento/)
})

// ── 8. o segredo não vaza para a planilha ────────────────────────────────────────────────────────────────
ok('segredo nunca aparece em célula, log, aviso ou corpo enviado', () => {
  const G = ambiente({ linhas: [['A1', '', 10], ['R1', '', 2]], responder: servidor({ rej: ['R1'] }) })
  G.ctx.sincronizarAgora()
  const tudo = JSON.stringify([G.abas, G.toasts, G.alertas, G.chamadas.map(c => [c.url, c.opt.payload, c.opt.headers])])
  assert.ok(!tudo.includes(SEGREDO))
})

// ── 9. regressões da revisão adversarial (frente planilha) ───────────────────────────────────────────────
await okA('#2 valor recusado no painel volta como "RECUSADO no painel — o painel mantém R$ 10,00", nunca "OK" (webhook real)', async () => {
  const CLI = 'Cliente Planilha Recusa', g = W.gerarWebhook(CLI, 'sheets')
  const G = ambiente({ linhas: [['ABC', '', 10]], texto: gerarScriptApps({ url: URL_WH, segredo: g.segredo }) })
  await rodadaReal(G, g.wid); assert.match(G.status()[0], /^OK /)
  G.abas.Custos.dados[1][2] = 100
  await rodadaReal(G, g.wid); assert.match(G.status()[0], /^EM ANÁLISE: variação de \+900% sobre R\$ 10,00/)
  assert.deepEqual(C.decidirQuarentena(CLI, [{ sku: 'ABC', fonte: 'sheets' }], 'recusar', 'Dono'), { aprovados: 0, recusados: 1, ignorados: 0 })
  const b = await rodadaReal(G, g.wid)
  assert.deepEqual([b.accepted, b.refused_total, b.refused.map(e => e.line)], [0, 1, [2]])
  assert.equal(G.status()[0], 'RECUSADO no painel — o painel mantém R$ 10,00 (custo anterior da planilha)')
  assert.equal(C.custosEfetivos(CLI).get('abc'), 10, 'o painel continua com o custo antigo')
  assert.ok(!JSON.stringify(b).includes('Cliente'), 'resumo sem nome de cliente')
})
ok('#2 resposta que não conta todas as linhas (ex.: servidor sem refused_total): linha sem marca vira "ENVIADO … confira", nunca "OK"', () => {
  const G = ambiente({ linhas: [['A', '', 1], ['REC', '', 2]], responder: servidor({ rec: ['REC'], antigo: true }) })
  G.ctx.sincronizarAgora()
  assert.deepEqual(G.status().map(s => s.split(' ')[0]), ['ENVIADO', 'ENVIADO'])
  const H = ambiente({ linhas: [['A', '', 1], ['REC', '', 2]], responder: servidor({ rec: ['REC'] }) })
  H.ctx.sincronizarAgora()
  assert.match(H.status()[0], /^OK /); assert.equal(H.status()[1], 'RECUSADO no painel — o painel mantém R$ 10,00 (custo anterior da planilha)')
})
ok('#3 CONTRATO de SKU: normSku_/chave_ do script = chaveSku do servidor; repetição com acento/caixa/espaço entre lotes é rejeitada', () => {
  const [norm, chave] = vm.runInContext('[normSku_, chave_]', ambiente({ instalar: false }).ctx)
  const casos = ['Ação-1', 'Ação-1', ' ação-1 ', 'AÇÃO-1 ', '​Ação-1‍', '﻿ação-1', 'Caneca  Azul', 'caneca azul', 12345, 'İ', 'ẞ', 'A B', '\tX\n']
  for (const v of casos) assert.equal(chave(norm(v), ''), C.chaveSku(v), `mesma chave para ${JSON.stringify(v)}`)
  assert.equal(new Set(casos.slice(0, 6).map(v => chave(norm(v), ''))).size, 1, 'variantes de "Ação-1" = uma chave só')
  const linhas = Array.from({ length: 600 }, (_, i) => ['S' + i, '', 1 + i]); linhas[0] = ['Ação-1', '', 10]; linhas[500] = ['ação-1 ', '', 12]
  const G = ambiente({ linhas }); G.ctx.sincronizarAgora()
  assert.equal(G.corpos().length, 2, 'dois lotes')
  assert.ok(G.corpos().every(c => c.items.every(i => C.chaveSku(i.sku) !== 'ação-1')), 'nenhuma das duas é enviada')
  assert.deepEqual([G.status()[0], G.status()[500]], ['REJEITADO: SKU repetido na planilha', 'REJEITADO: SKU repetido na planilha'])
})
ok('#4 aba "Custos" do cliente com outro cabeçalho: não lê, não envia, não escreve; motivo no Sync_Log 1x; "Criar aba-modelo" resolve', () => {
  const cab = ['SKU', 'Fornecedor', 'Custo', 'Preço venda'], G = ambiente({ instalar: false, cab, linhas: [['Caneca', 'F1', 10, '=C2*2.5']] })
  Object.assign(G.props, { WEBHOOK_URL: URL_WH, WEBHOOK_SECRET: SEGREDO })
  const antes = JSON.stringify(G.abas.Custos.dados)
  G.ctx.sincronizarAuto(); G.ctx.sincronizarAuto()
  assert.equal(G.chamadas.length, 0); assert.equal(JSON.stringify(G.abas.Custos.dados), antes, 'coluna D (fórmula do cliente) intacta')
  const logs = () => G.abas.Sync_Log.dados.slice(1).map(l => l[11])
  assert.equal(logs().length, 1, 'gatilho registra o mesmo motivo uma vez só')
  assert.match(logs()[0], /^NÃO ENVIADO: a aba "Custos" tem na linha 1 "SKU \| Fornecedor \| Custo \| Preço venda" \(esperado: SKU \| MLB \| Custo \| Status\); nada foi enviado/)
  G.ctx.sincronizarAgora(); assert.equal(logs().length, 2); assert.match(G.toasts.at(-1), /Criar aba-modelo/)
  G.ctx.criarAbaModelo()
  assert.deepEqual(G.abas['Custos (Place Sprints)'].dados, [CAB]); assert.equal(G.abas['Custos (Place Sprints)'].formato['A:A'], '@')
  G.abas['Custos (Place Sprints)'].dados.push(['A1', '', 10])
  G.ctx.sincronizarAgora()
  assert.deepEqual(G.corpos()[0].items.map(i => i.sku), ['A1']); assert.match(G.status('Custos (Place Sprints)')[0], /^OK /)
  assert.equal(JSON.stringify(G.abas.Custos.dados), antes, 'a aba do cliente nunca foi tocada')
  const H = ambiente({ cab, linhas: [['X', '', 1]] })                             // instalar com a aba do cliente ocupada: cria a aba-modelo
  assert.deepEqual(H.abas['Custos (Place Sprints)'].dados, [CAB]); assert.match(H.toasts.at(-1), /Custos \(Place Sprints\)/)
  const V = ambiente({ instalar: false }); V.abas.Custos = undefined; V.ctx.instalar()  // sem aba: cria "Custos"
  assert.deepEqual(V.abas.Custos.dados, [CAB])
})
ok('#17 lotes cortados por tamanho (~200 KB) além de 500 itens: SKUs longos acentuados não estouram os 256 KB do servidor', () => {
  const linhas = Array.from({ length: 500 }, (_, i) => ['ç'.repeat(76) + String(i).padStart(4, '0'), 'MLB' + (1e9 + i), 10 + i / 7])
  const G = ambiente({ linhas }); G.ctx.sincronizarAuto()
  const cs = G.corpos()
  assert.ok(cs.length >= 2, `${cs.length} lote(s)`)
  assert.ok(G.chamadas.every(c => Buffer.byteLength(c.opt.payload) <= 256 * 1024), 'nenhum corpo acima do limite do servidor')
  assert.deepEqual(cs.map(c => [c.batch_no, c.batch_total]), cs.map((_, i) => [i + 1, cs.length]))
  assert.equal(cs.reduce((s, c) => s + c.items.length, 0), 500); assert.ok(G.status().every(s => s.startsWith('OK ')))
})
ok('#18 erro de fórmula (#N/A, #REF!…) no SKU, MLB ou custo nunca é enviado', () => {
  const erros = ['#N/A', '#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!', '#ERROR!', 'Loading...']
  const G = ambiente({ linhas: [...erros.map(e => [e, '', 25]), ['OK1', '#N/A', 5], ['OK2', '', 7]] })
  G.ctx.sincronizarAgora()
  assert.deepEqual(G.corpos()[0].items.map(i => i.sku), ['OK2'])
  erros.forEach((e, i) => assert.equal(G.status()[i], `REJEITADO: erro de fórmula na planilha (${e}): corrija a fórmula da linha`))
  assert.match(G.status()[erros.length], /^REJEITADO: erro de fórmula na planilha \(#N\/A\)/)
})
ok('#19 linha nova inválida mostra o motivo na rodada seguinte (não espera o batimento de 20 h)', () => {
  const G = ambiente({ linhas: [['A1', '', 10]] })
  G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 1)
  G.abas.Custos.dados.push(['NOVO', '', '12,50'])
  G.rel.ms += 600e3; G.ctx.sincronizarAuto()
  assert.equal(G.status()[1], 'REJEITADO: custo não numérico: 12,50'); assert.match(G.status()[0], /^OK /)
  G.rel.ms += 600e3; G.ctx.sincronizarAuto(); assert.equal(G.chamadas.length, 2, 'sem mudança depois disso: não envia')
})
ok('#20 Sync_Log grava Envio, Lote e Detalhe como texto ("1/3" não vira data)', () => {
  const G = ambiente({ linhas: Array.from({ length: 1001 }, (_, i) => ['S' + i, '', 1 + i]) })
  G.ctx.sincronizarAuto()
  assert.deepEqual(G.abas.Sync_Log.dados.slice(1).map(l => l[2]), ['1/3', '2/3', '3/3'])
})

console.log(`✔ teste-custos-apps-script: ${n} verificações OK`)
