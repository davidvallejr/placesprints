// Auto-teste do webhook público de custos (M2, docs/integracao-custos-erp-SPEC.md §6 e §12). Banco EM MEMÓRIA, nenhuma chamada
// externa: o roteador REAL roda em Express numa porta efêmera de loopback com express.json global DEPOIS dele (prova que o HMAC
// vê o corpo cru), e os casos de relógio (janela ±300 s, validade de 24 h do segredo antigo) usam tratarWebhook puro com agoraMs.
// Chave de cifra e segredos são gerados aqui (valores de teste, nunca impressos). Rodar: node scripts/teste-custos-webhook.mjs
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
process.env.PS_PROMO_MEMORIA = '1'                                  // ANTES dos imports dinâmicos (o módulo lê isto no carregamento)
process.env.ERP_TOKEN_KEY = randomBytes(32).toString('hex')         // chave de TESTE (vence a do .env: env.js não sobrescreve)
process.env.PUBLIC_BASE_URL = 'https://teste.invalid'
process.env.PS_BLING_WEBHOOK = '0'
const W = await import('../src/lib/custos-webhook.js')
const R = await import('../src/lib/promocoes-db.js')
const { cifrarSegredo } = await import('../src/lib/cripto.js')
const express = (await import('express')).default
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

const logs = []; W.configurarLog((nivel, msg) => logs.push(`${nivel} ${msg}`))
let n = 0
const okA = async (nome, fn) => { try { await fn(); n++; console.log(`✔ ${nome}`) } catch (e) { console.error('FALHOU:', nome); throw e } }
const dormir = ms => new Promise(r => setTimeout(r, ms))
const q1 = (sql, ...a) => R.db.prepare(sql).get(...a)

// ── servidor: roteador real montado ANTES do express.json (mesma ordem do server.js) ──────────────────────────────────────
const app = express(); app.use('/webhook/custos', W.rotasWebhookCustos); app.use(express.json({ limit: '1mb' }))
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`

const agoraS = () => Math.floor(Date.now() / 1000)
const assinar = (segredo, ts, corpo) => 'sha256=' + createHmac('sha256', segredo).update(`${ts}.`).update(corpo).digest('hex')
let ipSeq = 0; const ipNovo = () => `teste-ip-${++ipSeq}`           // um IP por caso: falhas de auth de um caso não bloqueiam o outro
let loteSeq = 0; const lote = (items, extra = {}) => ({ batch_id: `lote-teste-${++loteSeq}`, items, ...extra })
const segredosVistos = [], widsVistos = []
const gerar = (c, f = 'sheets') => { const g = W.gerarWebhook(c, f); if (g.segredo) segredosVistos.push(g.segredo); widsVistos.push(g.wid); return g }

async function enviar(wid, corpo, { segredo, ts = agoraS(), ip = ipNovo(), cab = {}, assinatura, assinarTexto } = {}) {
  const txt = typeof corpo === 'string' || Buffer.isBuffer(corpo) ? corpo : JSON.stringify(corpo)
  const h = { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...cab }
  if (segredo || assinatura) Object.assign(h, { 'X-Timestamp': String(ts), 'X-Signature': assinatura ?? assinar(segredo, ts, assinarTexto ?? txt) })
  const r = await fetch(`${BASE}/webhook/custos/${wid}`, { method: 'POST', headers: h, body: txt })
  const texto = await r.text()
  let json = null; try { json = JSON.parse(texto) } catch { /* corpo não-JSON */ }
  return { status: r.status, texto, json, retry: r.headers.get('retry-after'), cache: r.headers.get('cache-control'), tipo: r.headers.get('content-type') }
}
const puro = (wid, corpo, { segredo, agoraMs = Date.now(), ts = Math.floor(agoraMs / 1000), cab = {} } = {}) => {
  const raw = Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo))
  return W.tratarWebhook({ wid, raw, agoraMs, headers: { 'x-timestamp': String(ts), 'x-signature': assinar(segredo, ts, raw), ...cab } })
}

const A = 'Cliente Webhook A', B = 'Cliente Webhook B'
const gA = gerar(A), gB = gerar(B)

await okA('gerarWebhook: wid opaco de 22 caracteres, segredo de 64 hex só no retorno, cifrado v1 no banco; 2ª geração = 409; fonte/cliente inválidos = 400', async () => {
  assert.match(gA.wid, /^[A-Za-z0-9_-]{22}$/); assert.match(gA.segredo, /^[0-9a-f]{64}$/)
  assert.equal(gA.url, `https://teste.invalid/webhook/custos/${gA.wid}`)
  const linha = q1('SELECT * FROM erp_webhooks WHERE wid = ?', gA.wid)
  assert.match(linha.segredo_cifrado, /^v1\./); assert.ok(!JSON.stringify(linha).includes(gA.segredo))
  assert.throws(() => W.gerarWebhook(A, 'sheets'), e => e.status === 409 && /rotacionar/.test(e.message))
  assert.throws(() => W.gerarWebhook(A, 'tiny'), e => e.status === 400)
  assert.throws(() => W.gerarWebhook('', 'sheets'), e => e.status === 400)
  assert.throws(() => W.gerarWebhook(null, 'sheets'), e => e.status === 400)
  assert.throws(() => W.gerarWebhook('', 'bling'), e => e.status === 409 && /PS_BLING_WEBHOOK/.test(e.message))   // desligado por padrão
  const st = W.statusWebhook(A, 'sheets')
  assert.deepEqual(Object.keys(st).sort(), ['ativo', 'criado_em', 'rotacionado_em', 'ultimo_uso_em', 'url'])
  assert.equal(st.ativo, true); assert.equal(st.url, gA.url); assert.equal(W.statusWebhook('Ninguém', 'sheets'), null)
  assert.equal(q1("SELECT estado FROM erp_fontes WHERE cliente = ? AND fonte = 'sheets'", A)?.estado, 'conectado')
  const aud = R.listarAuditoria(A, { evento: 'custos_webhook_gerado' })
  assert.equal(aud.length, 1); assert.ok(!JSON.stringify(aud).includes(gA.segredo) && !JSON.stringify(aud).includes(gA.wid))
})

await okA('lote assinado → 200 com resumo; custo ruim vira linha rejeitada (nunca 4xx); `cliente` do corpo é ignorado; no-store e sem segredo', async () => {
  const corpo = { ...lote([
    { sku: 'SKUT-A1', custo: 10, line: 2 }, { sku: 'SKUT-A2', custo: '36.3200000000', line: 3 },
    { sku: 'SKUT-Z0', custo: 0, line: 4 }, { sku: 'SKUT-VAZIO', custo: '', line: 5 }, { sku: 'SKUT-TXT', custo: 'abc', line: 6 },
    { sku: 'SKUT-VIRG', custo: '12,50', line: 7 }, { sku: 'SKUT-NULO', custo: null, line: 8 }, { mlb: 'MLB999999', custo: 5, line: 9 },
  ]), cliente: B }
  const txt = JSON.stringify(corpo).replace('"line":2', '"line":2,"__proto__":{"poluido":true},"cliente":"' + B + '"')
  const r = await enviar(gA.wid, txt, { segredo: gA.segredo })
  assert.equal(({}).poluido, undefined, 'campo desconhecido não é mesclado')
  assert.equal(r.status, 200); assert.equal(r.cache, 'no-store'); assert.equal(r.json.ok, true); assert.equal(r.json.duplicate, false)
  assert.equal(r.json.batch_id, corpo.batch_id)
  assert.equal(r.json.accepted, 2); assert.equal(r.json.new, 2); assert.equal(r.json.changed, 0); assert.equal(r.json.unchanged, 0)
  assert.equal(r.json.rejected_total, 6); assert.equal(r.json.quarantined_total, 0); assert.equal(r.json.closed_full_sync, false)
  assert.deepEqual(r.json.rejected.map(x => x.line).sort((a, b) => a - b), [4, 5, 6, 7, 8, 9])
  assert.ok(r.json.rejected.every(x => typeof x.reason === 'string' && x.reason.length > 0))
  assert.ok(!r.texto.includes(gA.segredo))
  const custos = R.db.prepare('SELECT sku, custo, fonte, campo FROM erp_custos_sku WHERE cliente = ? ORDER BY sku').all(A)
  assert.deepEqual(custos, [{ sku: 'SKUT-A1', custo: 10, fonte: 'sheets', campo: 'sheets.coluna_custo' }, { sku: 'SKUT-A2', custo: 36.32, fonte: 'sheets', campo: 'sheets.coluna_custo' }])
  assert.equal(q1('SELECT COUNT(*) n FROM erp_custos_sku WHERE cliente = ?', B).n, 0, 'o corpo dizer "cliente: B" não grava nada no B')
  const f = q1("SELECT * FROM erp_fontes WHERE cliente = ? AND fonte = 'sheets'", A)
  assert.equal(f.estado, 'conectado'); assert.ok(f.ultimo_sync_ok_em); assert.equal(f.ultimo_erro, '')
  assert.ok(W.statusWebhook(A, 'sheets').ultimo_uso_em, 'uso autenticado fica registrado')
})

await okA('corpo alterado em 1 byte depois de assinado → 401; JSON inválido SEM autenticação → 401 (HMAC antes do parse)', async () => {
  const corpo = JSON.stringify(lote([{ sku: 'SKUT-A1', custo: 11.25 }]))
  const r = await enviar(gA.wid, corpo.replace('11.25', '11.26'), { segredo: gA.segredo, assinarTexto: corpo })
  assert.equal(r.status, 401); assert.equal(r.texto, '{"ok":false}')
  assert.equal((await enviar(gA.wid, '{isto não é json', { assinatura: 'sha256=' + '0'.repeat(64) })).status, 401)
  assert.equal(q1("SELECT custo FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-a1'", A).custo, 10)
})

await okA('janela anti-replay: ±300 s passa, ±301 s não (relógio fixo); pela rede −301 s e +310 s → 401; segredo é UTF-8, não hex decodificado', async () => {
  const t = 1_800_000_000_000, ts = t / 1000, raw = Buffer.from('{"x":1}')
  const v = d => W.verificarAssinaturaSheets({ segredo: gA.segredo, timestamp: ts + d, raw, assinatura: assinar(gA.segredo, ts + d, raw), agoraMs: t })
  assert.equal(v(-300), true); assert.equal(v(300), true); assert.equal(v(-301), false); assert.equal(v(301), false)
  const hexDecod = 'sha256=' + createHmac('sha256', Buffer.from(gA.segredo, 'hex')).update(`${ts}.`).update(raw).digest('hex')
  assert.equal(W.verificarAssinaturaSheets({ segredo: gA.segredo, timestamp: ts, raw, assinatura: hexDecod, agoraMs: t }), false)
  for (const sig of ['', 'sha256=', 'sha256=zz', assinar(gA.segredo, ts, raw).slice(0, -2), assinar(gA.segredo, ts, raw).replace('sha256=', 'sha1=')])
    assert.equal(W.verificarAssinaturaSheets({ segredo: gA.segredo, timestamp: ts, raw, assinatura: sig, agoraMs: t }), false)
  assert.equal(W.verificarAssinaturaSheets({ segredo: gA.segredo, timestamp: `${ts}.5`, raw, assinatura: assinar(gA.segredo, `${ts}.5`, raw), agoraMs: t }), false)
  for (const d of [-301, 310]) assert.equal((await enviar(gA.wid, lote([{ sku: 'SKUT-A1', custo: 10 }]), { segredo: gA.segredo, ts: agoraS() + d })).status, 401)
})

await okA('401 uniforme: wid inexistente, wid malformado, wid desativado, sem cabeçalhos, assinatura errada, carimbo vencido → status, corpo e cabeçalhos idênticos', async () => {
  const gI = gerar('Cliente Inativo'); assert.equal(W.desativarWebhook('Cliente Inativo', 'sheets'), true)
  assert.equal(W.desativarWebhook('Cliente Inativo', 'sheets'), false)
  assert.equal(q1('SELECT segredo_cifrado FROM erp_webhooks WHERE wid = ?', gI.wid).segredo_cifrado, '', 'desativar apaga o segredo cifrado')
  assert.equal(q1("SELECT estado FROM erp_fontes WHERE cliente = 'Cliente Inativo' AND fonte = 'sheets'").estado, 'desconectado')
  const c = lote([{ sku: 'SKUT-U', custo: 1 }])
  const rs = [
    await enviar(randomBytes(16).toString('base64url'), c, { segredo: gA.segredo }),
    await enviar('curto', c, { segredo: gA.segredo }),
    await enviar(gI.wid, c, { segredo: gI.segredo }),
    await enviar(gA.wid, c),
    await enviar(gA.wid, c, { segredo: gB.segredo }),
    await enviar(gA.wid, c, { segredo: gA.segredo, ts: agoraS() - 1000 }),
  ]
  for (const r of rs) {
    assert.equal(r.status, 401); assert.equal(r.texto, '{"ok":false}')
    assert.deepEqual([r.cache, r.tipo, r.retry], [rs[0].cache, rs[0].tipo, rs[0].retry])
  }
})

await okA('rotação: antigo vale por 24 h e depois não; novo vale; 2ª rotação na janela sobrescreve o anterior; bling/inexistente/desativado recusam; gerar após desativar troca a URL', async () => {
  const C = 'Cliente Rotacao', g1 = gerar(C), g2 = W.rotacionarSegredo(C, 'sheets'); segredosVistos.push(g2.segredo)
  assert.equal(g2.wid, g1.wid); assert.equal(g2.url, g1.url); assert.notEqual(g2.segredo, g1.segredo); assert.match(g2.segredo, /^[0-9a-f]{64}$/)
  assert.ok(W.statusWebhook(C, 'sheets').rotacionado_em)
  const depois = Date.now() + 24 * 3600e3 + 60e3
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g1.segredo })).status, 200)
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g2.segredo })).status, 200)
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g1.segredo, agoraMs: depois })).status, 401)
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g2.segredo, agoraMs: depois })).status, 200)
  const g3 = W.rotacionarSegredo(C, 'sheets'); segredosVistos.push(g3.segredo)
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g1.segredo })).status, 401, 'o original saiu de vez')
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g2.segredo })).status, 200)
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g3.segredo })).status, 200)
  assert.ok(!JSON.stringify(q1('SELECT * FROM erp_webhooks WHERE wid = ?', g1.wid)).match(new RegExp(`${g2.segredo}|${g3.segredo}`)))
  assert.throws(() => W.rotacionarSegredo('Ninguém', 'sheets'), e => e.status === 404)
  assert.throws(() => W.rotacionarSegredo(C, 'bling'), e => e.status === 400)
  W.desativarWebhook(C, 'sheets')
  assert.throws(() => W.rotacionarSegredo(C, 'sheets'), e => e.status === 409)
  const g4 = gerar(C); assert.notEqual(g4.wid, g1.wid)
  assert.equal((await puro(g1.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g3.segredo })).status, 401, 'URL antiga morta')
  assert.equal((await puro(g4.wid, lote([{ sku: 'SKUT-R', custo: 3 }]), { segredo: g4.segredo })).status, 200)
  assert.equal(R.listarAuditoria(C, { evento: 'custos_webhook_rotacionado' }).length, 2)
})

await okA('idempotência: mesmo batch_id + mesmo corpo (carimbo novo) → 200 duplicate:true SEM reprocessar; corpo diferente → 409', async () => {
  const corpo = lote([{ sku: 'SKUT-ID', custo: 7, line: 2 }, { sku: 'SKUT-ID2', custo: 0, line: 3 }])
  const r1 = await enviar(gA.wid, corpo, { segredo: gA.segredo })
  assert.equal(r1.status, 200); assert.equal(r1.json.duplicate, false)
  const visto = q1("SELECT visto_em FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-id'", A).visto_em
  const lotes = q1('SELECT COUNT(*) n FROM erp_lotes').n, hist = q1('SELECT COUNT(*) n FROM erp_custos_hist').n
  await dormir(15)
  const r2 = await enviar(gA.wid, corpo, { segredo: gA.segredo, ts: agoraS() - 5 })
  assert.equal(r2.status, 200); assert.equal(r2.json.duplicate, true)
  assert.deepEqual({ ...r2.json, duplicate: false }, r1.json, 'devolve o resumo guardado')
  assert.equal(q1("SELECT visto_em FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-id'", A).visto_em, visto, 'não reprocessou')
  assert.equal(q1('SELECT COUNT(*) n FROM erp_lotes').n, lotes); assert.equal(q1('SELECT COUNT(*) n FROM erp_custos_hist').n, hist)
  const r3 = await enviar(gA.wid, { ...corpo, items: [{ sku: 'SKUT-ID', custo: 8 }] }, { segredo: gA.segredo })
  assert.equal(r3.status, 409); assert.equal(r3.json.ok, false); assert.match(r3.json.error, /batch_id reutilizado/)
  assert.equal(q1("SELECT custo FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-id'", A).custo, 7)
  // o mesmo batch_id em OUTRO cliente é outro lote (idempotência por cliente)
  assert.equal((await enviar(gB.wid, corpo, { segredo: gB.segredo })).json.duplicate, false)
})

await okA('limites: 257 KB → 413 de corpo fixo; 1.001 itens → 422; JSON inválido autenticado → 400; esquema inválido → 422 com mensagem curta e sem eco', async () => {
  const grande = JSON.stringify(lote([{ sku: 'SKUT-G', custo: 1, pad: 'x'.repeat(257 * 1024) }]))
  const r413 = await enviar(gA.wid, grande, { segredo: gA.segredo })
  assert.equal(r413.status, 413); assert.equal(r413.texto, '{"ok":false}')
  assert.equal((await W.tratarWebhook({ wid: gA.wid, raw: Buffer.alloc(256 * 1024 + 1), headers: {} })).status, 413)
  const mil1 = lote(Array.from({ length: 1001 }, (_, i) => ({ sku: `SKUT-M${i}`, custo: 1 })))
  const r422 = await enviar(gA.wid, mil1, { segredo: gA.segredo })
  assert.equal(r422.status, 422); assert.match(r422.json.error, /1000/)
  const r400 = await enviar(gA.wid, '{"batch_id": "lote-quebrado-1", items: [', { segredo: gA.segredo })
  assert.equal(r400.status, 400); assert.equal(r400.json.error, 'JSON inválido')
  assert.equal((await enviar(gA.wid, Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), { segredo: gA.segredo })).status, 400, 'UTF-8 inválido')
  const segredoNoCampo = 'SEGREDO-NAO-ECOA-' + randomBytes(4).toString('hex')
  for (const [corpo, cab] of [
    [{ batch_id: 'curto', items: [{ sku: 'X', custo: 1 }] }, {}],
    [{ batch_id: segredoNoCampo + '!', items: [{ sku: 'X', custo: 1 }] }, {}],
    [lote([{ sku: 'X', custo: 1 }]), { 'X-Batch-Id': 'outro-lote-qualquer' }],
    [lote([]), {}], [lote('x'), {}], [[1, 2], {}], [lote([null]), {}], [lote([{ sku: 123, custo: 1 }]), {}],
    [lote([{ sku: 'X', mlb: 5, custo: 1 }]), {}], [lote([{ sku: 'X', custo: 1, line: 1.5 }]), {}], [lote([{ sku: 'X', custo: 1 }], { mode: 'tudo' }), {}],
  ]) {
    const r = await puro(gA.wid, corpo, { segredo: gA.segredo, cab })     // puro: poupa o balde do wid (mesmo código do roteador)
    assert.equal(r.status, 422, JSON.stringify(corpo).slice(0, 60)); assert.equal(r.body.ok, false); assert.ok(r.body.error.length < 120)
    assert.ok(!JSON.stringify(r.body).includes(segredoNoCampo))
  }
  const f = q1("SELECT estado, ultimo_erro FROM erp_fontes WHERE cliente = ? AND fonte = 'sheets'", A)
  assert.equal(f.estado, 'erro'); assert.match(f.ultimo_erro, /lote recusado \(422\)/)
  assert.equal((await enviar(gA.wid, lote([{ sku: 'SKUT-A1', custo: 10 }]), { segredo: gA.segredo })).status, 200)
  assert.equal(q1("SELECT estado FROM erp_fontes WHERE cliente = ? AND fonte = 'sheets'", A).estado, 'conectado', 'lote bom seguinte limpa o erro')
})

await okA('mode=full: lotes fora de ordem e faltando um NÃO fecham; com todos fecha (marca não visto, NUNCA apaga nem zera); total trocado no mesmo sync = 422', async () => {
  const F = 'Cliente Full', g = gerar(F)
  assert.equal((await puro(g.wid, lote([{ sku: 'SKUT-VELHO', custo: 5 }]), { segredo: g.segredo })).status, 200)
  await dormir(15)
  const S = 'sync-teste-0001', full = (no, items) => lote(items, { mode: 'full', sync_id: S, batch_no: no, batch_total: 3 })
  const r3 = await puro(g.wid, full(3, [{ sku: 'SKUT-F3', custo: 3 }]), { segredo: g.segredo })
  const r1 = await puro(g.wid, full(1, [{ sku: 'SKUT-F1', custo: 1 }]), { segredo: g.segredo })
  assert.equal(r3.status, 200); assert.equal(r1.status, 200); assert.equal(r3.body.closed_full_sync, false); assert.equal(r1.body.closed_full_sync, false)
  assert.equal(q1("SELECT nao_visto_desde FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-velho'", F).nao_visto_desde, '', 'incompleto não marca')
  const rT = await puro(g.wid, lote([{ sku: 'SKUT-F2', custo: 2 }], { mode: 'full', sync_id: S, batch_no: 2, batch_total: 4 }), { segredo: g.segredo })
  assert.equal(rT.status, 422); assert.match(rT.body.error, /batch_total/)
  const b2 = full(2, [{ sku: 'SKUT-F2', custo: 2 }]), r2 = await puro(g.wid, b2, { segredo: g.segredo })
  assert.equal(r2.status, 200); assert.equal(r2.body.closed_full_sync, true)
  const velho = q1("SELECT custo, nao_visto_desde FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-velho'", F)
  assert.equal(velho.custo, 5); assert.ok(velho.nao_visto_desde, 'ausente na foto completa = não visto (o custo continua valendo)')
  assert.equal(q1("SELECT nao_visto_desde FROM erp_custos_sku WHERE cliente = ? AND sku_key = 'skut-f1'", F).nao_visto_desde, '')
  const dup = await puro(g.wid, b2, { segredo: g.segredo })
  assert.equal(dup.body.duplicate, true); assert.equal(dup.body.closed_full_sync, true)
  const S2 = 'sync-teste-0002'
  const s2 = await puro(g.wid, lote([{ sku: 'SKUT-F1', custo: 1 }], { mode: 'full', sync_id: S2, batch_no: 1, batch_total: 2 }), { segredo: g.segredo })
  assert.equal(s2.body.closed_full_sync, false, 'falta o lote 2: não fecha')
  for (const extra of [{ mode: 'full' }, { mode: 'full', sync_id: 'sync-teste-0003', batch_no: 2, batch_total: 1 }, { mode: 'full', sync_id: 'sync-teste-0003', batch_no: 0, batch_total: 1 }, { mode: 'full', sync_id: 'sync-teste-0003', batch_no: 1, batch_total: 201 }])
    assert.equal((await puro(g.wid, lote([{ sku: 'SKUT-F1', custo: 1 }], extra), { segredo: g.segredo })).status, 422, JSON.stringify(extra))
  const um = await puro(g.wid, lote([{ sku: 'SKUT-F1', custo: 1 }], { mode: 'full', sync_id: 'sync-teste-0004', batch_no: 1, batch_total: 1 }), { segredo: g.segredo })
  assert.equal(um.body.closed_full_sync, true)
})

await okA('rate limit por wid (mesmo inexistente): 30 passam, a 31ª → 429 com Retry-After', async () => {
  const wid = 'inexistente-rate-0001'
  for (let i = 0; i < 30; i++) assert.equal((await enviar(wid, '{}')).status, 401)
  const r = await enviar(wid, '{}')
  assert.equal(r.status, 429); assert.ok(Number(r.retry) >= 1); assert.equal(r.texto, '{"ok":false}')
})

await okA('rate limit por IP: 120 req/min passam (5 wids reais, reenvio idempotente), a 121ª → 429 com Retry-After', async () => {
  const ip = 'teste-ip-rate', gs = [1, 2, 3, 4, 5].map(i => gerar(`Cliente IP ${i}`)), corpos = gs.map(() => lote([{ sku: 'SKUT-IP', custo: 2 }]))
  for (let i = 0; i < 120; i++) assert.equal((await enviar(gs[i % 5].wid, corpos[i % 5], { segredo: gs[i % 5].segredo, ip })).status, 200)
  const r = await enviar(gs[0].wid, corpos[0], { segredo: gs[0].segredo, ip })
  assert.equal(r.status, 429); assert.ok(Number(r.retry) >= 1 && Number(r.retry) <= 60)
  assert.equal((await enviar(gs[0].wid, corpos[0], { segredo: gs[0].segredo })).status, 200, 'outro IP segue normal')
})

await okA('10 falhas de autenticação em 5 min bloqueiam o IP por 15 min só para quem falha no HMAC → 429; envio assinado do MESMO IP (pool do Apps Script) → 200', async () => {
  const ip = 'teste-ip-bloqueio'
  for (let i = 0; i < 10; i++) assert.equal((await enviar(`inexistente-bloq-${String(i).padStart(4, '0')}`, '{}', { ip })).status, 401)
  const r = await enviar(`inexistente-bloq-9999`, '{}', { ip })
  assert.equal(r.status, 429); assert.ok(Number(r.retry) > 800 && Number(r.retry) <= 900); assert.equal(r.texto, '{"ok":false}')
  assert.equal((await enviar(gA.wid, '{}', { segredo: 'segredo-errado', ip })).status, 429, 'wid real com assinatura errada também')
  // regressão idx 35: antes o bloqueio vinha ANTES do HMAC e o envio legítimo levava 429
  const ok = await enviar(gA.wid, lote([{ sku: 'SKUT-A1', custo: 10 }]), { segredo: gA.segredo, ip })
  assert.equal(ok.status, 200, ok.texto); assert.equal(ok.json.ok, true); assert.equal(ok.retry, null)
})

await okA('Bling como gatilho (PS_BLING_WEBHOOK=1): HMAC do corpo cru com o client_secret do app; product_supplier padrão enfileira coalescido; resto = 200 silencioso; desligado = 401', async () => {
  // payload construído a partir da documentação (campos de `data` citados na spec §6.8); envelope NÃO CONFIRMADO: não é captura real
  process.env.PS_BLING_WEBHOOK = '1'
  const segApp = randomBytes(24).toString('hex'); segredosVistos.push(segApp)
  R.db.prepare("INSERT INTO erp_credenciais (cliente, fonte, modo_app, client_secret_cifrado) VALUES ('*', 'bling', 'global', ?)").run(cifrarSegredo(segApp))
  R.db.prepare("INSERT INTO erp_credenciais (cliente, fonte, modo_app, company_id) VALUES (?, 'bling', 'global', 'emp-teste-123')").run(A)
  const gb = gerar('', 'bling'); assert.equal(gb.segredo, ''); assert.equal(q1('SELECT segredo_cifrado FROM erp_webhooks WHERE wid = ?', gb.wid).segredo_cifrado, '')
  let ev = 0
  const evento = (o = {}, d = {}) => ({ eventId: `ev-teste-${++ev}`, date: new Date().toISOString().slice(0, 19).replace('T', ' '), version: 'v1', event: 'product_supplier.updated',
    companyId: 'emp-teste-123', ...o, data: { id: 9001, padrao: true, precoCusto: 10, precoCompra: 9, produto: { id: 555 }, fornecedor: { id: 7 }, ...d } })
  const enviarBling = async (corpo, segredo = segApp) => {
    const txt = JSON.stringify(corpo)
    const r = await fetch(`${BASE}/webhook/custos/${gb.wid}`, { method: 'POST', body: txt, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ipNovo(),
      'X-Bling-Signature-256': 'sha256=' + createHmac('sha256', segredo).update(txt).digest('hex') } })
    return { status: r.status, texto: await r.text() }
  }
  const fila = () => R.db.prepare("SELECT cliente, id_externo, motivo FROM erp_fila WHERE fonte = 'bling'").all()
  const e1 = evento()
  assert.deepEqual(await enviarBling(e1), { status: 200, texto: '{"ok":true}' })
  assert.deepEqual(fila(), [{ cliente: A, id_externo: '555', motivo: 'gatilho' }])
  assert.equal((await enviarBling(e1)).status, 200); assert.equal((await enviarBling(evento())).status, 200)
  assert.equal(fila().length, 1, 'mesmo eventId e mesmo produto: coalescido')
  assert.equal((await enviarBling(evento({}, { produto: { id: 556 } }))).status, 200); assert.equal(fila().length, 2)
  for (const e of [evento({ companyId: 'emp-desconhecida' }, { produto: { id: 700 } }), evento({ event: 'product.updated' }, { produto: { id: 701 } }),
    evento({}, { padrao: false, produto: { id: 702 } }), evento({ date: '2020-01-01 10:00:00' }, { produto: { id: 703 } }), evento({ eventId: '' }, { produto: { id: 704 } }),
    evento({}, { produto: { id: 'abc' } })])
    assert.deepEqual(await enviarBling(e), { status: 200, texto: '{"ok":true}' })
  assert.equal(fila().length, 2, 'nada disso enfileira')
  assert.equal((await enviarBling(evento({}, { produto: { id: 800 } }), 'outro-segredo')).status, 401)
  assert.equal((await enviarBling(evento({}, { produto: { id: 800 } }), gA.segredo)).status, 401)
  process.env.PS_BLING_WEBHOOK = '0'
  const off = await enviarBling(evento({}, { produto: { id: 801 } }))
  assert.deepEqual(off, { status: 401, texto: '{"ok":false}' }); assert.equal(fila().length, 2)
})

await okA('nenhum segredo, assinatura, wid inteiro, SKU ou corpo no log; o log traz só o prefixo de 6 do wid, status e contagens', async () => {
  const tudo = logs.join('\n')
  assert.ok(logs.length > 20)
  for (const s of segredosVistos) assert.ok(!tudo.includes(s), 'segredo no log')
  for (const w of widsVistos) assert.ok(!tudo.includes(w), 'wid inteiro no log')
  assert.ok(!/sha256=|SKUT-|"items"|lote-teste-|sync-teste-/i.test(tudo), 'assinatura, SKU ou corpo no log')
  assert.ok(logs.some(l => l.includes(`${gA.wid.slice(0, 6)}… → 200 aceitas=`)))
  assert.ok(logs.some(l => l.includes(`${gA.wid.slice(0, 6)}… → 401`)))
})

srv.close()
console.log(`✔ teste-custos-webhook: ${n} verificações OK`)
