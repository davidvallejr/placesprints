// Integração dos custos de ERP/planilha com as promoções (M10, spec docs/integracao-custos-erp-SPEC.md §11–12): lote aplicado → custo
// efetivo → o ANALISTA calcula MC (antes SEM CUSTO); quarentena não muda a MC; custo 0 continua SEM CUSTO; manual vence ERP, ERP vence planilha;
// webhook assinado pela porta HTTP (mesma ordem do server.js: guard → webhook cru → express.json); pendências CUSTO_* no /api/promocoes/resumo;
// troca de conta ML preserva custos; guard só libera as rotas públicas certas. Banco EM MEMÓRIA, Express em porta efêmera de loopback,
// nenhuma rede externa (nem ML, nem Bling/Tiny, nem Google). Rodar: node scripts/teste-custos-integracao.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
process.env.PS_PROMO_MEMORIA = '1'                         // ANTES dos imports dinâmicos (o promocoes-db lê isto no carregamento)
process.env.ERP_TOKEN_KEY = randomBytes(32).toString('hex')  // chave descartável deste processo (cifra o segredo do webhook de teste); o .env não é tocado
process.env.PUBLIC_BASE_URL = 'https://tunel-teste.example'
const R = await import('../src/lib/promocoes-db.js')
const C = await import('../src/lib/custos-db.js')
const A = await import('../src/lib/promocoes-analista.js')
const W = await import('../src/lib/custos-webhook.js')
const G = await import('../src/lib/guarda-local.js')
const Rotas = await import('../src/rotas-promocoes.js')
const express = (await import('express')).default
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const okA = async (nome, fn) => { try { await fn(); n++; console.log(`✔ ${nome}`) } catch (e) { console.error('FALHOU:', nome); throw e } }

// ── servidor de teste na MESMA ordem do server.js: guard → /webhook/custos (corpo cru) → express.json → rotas ──
const HC = 'Cliente Custos', HB = 'Cliente Vizinho', HOJE = '2026-10-05'
const app = express()
app.use(G.guardaLocal); app.use('/webhook/custos', W.rotasWebhookCustos); app.use(express.json({ limit: '1mb' })); app.use(Rotas.rotasPromocoes)
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`
Object.assign(Rotas.depsPromocoes, { conexoes: () => [{ cliente: HC, nickname: 'x' }, { cliente: HB, nickname: 'y' }], hoje: HOJE, custosCliente: null })
const get = async c => (await fetch(BASE + c)).json(), q = encodeURIComponent(HC)

// ── dados sintéticos (mesma forma do teste-promocoes-rotas-mc.mjs). Comissão 15% + frete 10 + imposto 10%, preço 100, original 120,
// rebate 5% (= 6): MC = 71 − custo. MLB3 não tem SKU (nenhum custo de ERP chega nele: nada é inventado).
const of = (item_id, pid, o = {}) => ({ item_id, pid, offer_id: `OFFER-${item_id}-${pid}`, tipo: 'SMART', subtipo: '', nome: `Camp ${pid}`, status: 'candidate', preco: 100, preco_original: 120, meli_pct: 5, seller_pct: 0, inicio: '', fim: '2026-12-31T23:59:59', min_preco: null, max_preco: null, sugerido: null, fonte: 'item', ...o })
const an = (item_id, sku) => ({ item_id, sku, sku_fonte: 'teste', titulo: `Anúncio ${item_id}`, permalink: '', status: 'active', sub_status: '', under_review: 0, preco: 100, preco_original: 120, estoque: 10, categoria: 'MLB1', tipo_anuncio: 'gold_special', catalogo: 0, user_product_id: '', lido_em: '2026-10-05T10:00:00Z', oferta_erro: '', tarifa_json: JSON.stringify({ comissao_pct: 15, taxa_fixa: 0, frete: 10 }), tarifa_estado: '' })
for (const [cli, anuncios] of [[HC, [an('MLB1', 'AZ-01'), an('MLB2', 'VD-02'), an('MLB3', '')]], [HB, [an('MLB7', 'AZ-01')]]]) {
  const id = 'T' + Math.random().toString(36).slice(2, 7)
  R.iniciarColeta(cli, id)
  R.gravarColeta(cli, { coletaId: id, campanhas: [], anuncios, ofertasPorItem: R.agruparPorItem(anuncios.map(a => of(a.item_id, 'P1'))), resumo: {}, limites: [] })
  R.setConfig(cli, { imposto_pct: 10 })
}
// MC que o ANALISTA de fato calcula (carregarEntrada → custosEfetivos → analisar): é a troca do M10 que está sob teste
const mcDe = async (cliente, item) => {
  const av = A.analisar(await A.carregarEntrada(cliente, { hoje: HOJE, custosCliente: null })).avaliacoes.get(item)
  return { estado: av.custos.ok ? 'ok' : av.custos.estado, mc: av.candidatos[0]?.mcPct ?? null }
}
const linha = (sku, custo, o = {}) => ({ sku, mlb: null, custo, campo: 'sheets.coluna_custo', id_externo: '', atualizado_na_fonte: null, ...o })
const lote = (fonte, linhas) => C.aplicarLote({ cliente: HC, fonte, modo: 'parcial', lote_id: `lote-${randomBytes(4).toString('hex')}`, linhas, origem: fonte === 'sheets' ? 'webhook' : 'sync', por: 'teste' })

await okA('antes de qualquer custo: o anúncio fica SEM CUSTO e sem MC (nada é inferido)', async () => {
  assert.equal(C.custosEfetivos(HC).size, 0)
  assert.deepEqual(await mcDe(HC, 'MLB1'), { estado: 'SEM CUSTO', mc: null })
})

await okA('lote aplicado via aplicarLote vira custo efetivo (caixa diferente casa) e o analista passa de SEM CUSTO a MC numérica', async () => {
  const r = lote('sheets', [linha('az-01', 30)])
  assert.equal(r.aceitas, 1); assert.equal(r.rejeitadas, 0)
  assert.equal(C.custosEfetivos(HC).get('az-01'), 30)
  assert.deepEqual(await mcDe(HC, 'MLB1'), { estado: 'ok', mc: 41 })
})

await okA('quarentena (variação > 50%) NÃO muda o custo efetivo nem a MC até o dono aprovar', async () => {
  const r = lote('sheets', [linha('AZ-01', 90)])
  assert.equal(r.em_quarentena, 1); assert.equal(r.quarentena_lista[0].codigo, 'variacao_brusca')
  assert.equal(C.custosEfetivos(HC).get('az-01'), 30)
  assert.deepEqual(await mcDe(HC, 'MLB1'), { estado: 'ok', mc: 41 })
  assert.equal(C.listarQuarentena(HC).length, 1)
})

await okA('custo 0, vazio, null e "R$ 12,50" vindos do ERP são REJEITADOS com código: o anúncio continua SEM CUSTO', async () => {
  for (const [c, codigo] of [[0, 'custo_zero_ou_negativo'], ['', 'custo_ausente'], [null, 'custo_ausente'], ['R$ 12,50', 'custo_invalido']]) {
    const r = lote('bling', [linha('VD-02', c, { campo: 'bling.fornecedor_padrao.precoCusto', id_externo: '2' })])
    assert.equal(r.aceitas, 0, String(c)); assert.equal(r.rejeitadas_lista[0].codigo, codigo, String(c)); assert.ok(r.rejeitadas_lista[0].motivo)
  }
  assert.equal(C.custosEfetivos(HC).has('vd-02'), false)
  assert.deepEqual(await mcDe(HC, 'MLB2'), { estado: 'SEM CUSTO', mc: null })
})

await okA('precedência: bling vence a planilha e o manual (aba Custos) vence o ERP — a MC acompanha', async () => {
  lote('bling', [linha('AZ-01', 35, { campo: 'bling.fornecedor_padrao.precoCusto', id_externo: '99' })])
  assert.deepEqual(await mcDe(HC, 'MLB1'), { estado: 'ok', mc: 36 })
  R.importarCustosSku(HC, [{ sku: 'AZ-01', custo: 50 }], 'importação', 'teste')
  assert.deepEqual(await mcDe(HC, 'MLB1'), { estado: 'ok', mc: 21 })
  const d = C.custosEfetivosDetalhe(HC, { q: 'az-01' }).itens[0]
  assert.equal(d.fonte, 'manual'); assert.deepEqual(d.perdedoras.map(p => `${p.fonte}:${p.custo}`).sort(), ['bling:35', 'sheets:30'])
})

await okA('webhook assinado pela porta HTTP (guard → corpo cru → express.json depois): custo chega e a MC aparece; sem assinatura = 401 sem detalhe', async () => {
  const { url, segredo } = W.gerarWebhook(HC, 'sheets'), caminho = new URL(url).pathname
  assert.match(caminho, /^\/webhook\/custos\/[A-Za-z0-9_-]{16,64}$/); assert.equal(G.ROTA_PUBLICA.test(caminho), true, 'a URL gerada passa pelo túnel')
  // `cliente` no corpo é ignorado: quem diz o cliente é o wid
  const corpo = JSON.stringify({ batch_id: 'lote-integracao-1', items: [{ sku: 'VD-02', mlb: 'MLB2', custo: 20, line: 2 }], cliente: HB })
  const ts = String(Math.floor(Date.now() / 1000)), sig = 'sha256=' + createHmac('sha256', segredo).update(ts + '.').update(corpo).digest('hex')
  const r = await fetch(BASE + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Timestamp': ts, 'X-Signature': sig }, body: corpo })
  const j = await r.json()
  assert.equal(r.status, 200); assert.equal(j.accepted, 1); assert.ok(!JSON.stringify(j).includes(segredo), 'a resposta nunca ecoa o segredo')
  assert.deepEqual(await mcDe(HC, 'MLB2'), { estado: 'ok', mc: 51 })
  assert.equal(C.custosEfetivos(HB).has('vd-02'), false, 'o cliente do corpo não recebeu nada')
  const sem = await fetch(BASE + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo })
  assert.equal(sem.status, 401); assert.deepEqual(await sem.json(), { ok: false })
})

await okA('/api/promocoes/resumo traz as pendências CUSTO_* e o SEM_CUSTO aponta para Integrações; /custos traz skus_efetivos com a fonte', async () => {
  const res = await get(`/api/promocoes/resumo?cliente=${q}`), cods = res.pendencias.map(p => p.codigo)
  assert.ok(cods.includes('CUSTO_QUARENTENA'), cods.join()); assert.ok(cods.includes('CUSTO_REJEITADO'), cods.join())
  assert.match(res.pendencias.find(p => p.codigo === 'SEM_CUSTO').texto, /Integrações/, 'MLB3 (sem SKU) segue SEM CUSTO e a pendência diz onde resolver')
  const cu = await get(`/api/promocoes/custos?cliente=${q}`)
  assert.deepEqual(cu.skus.map(s => s.sku), ['AZ-01'], '"skus" continua sendo só o manual (compatibilidade da aba)')
  assert.deepEqual(Object.fromEntries(cu.skus_efetivos.itens.map(i => [i.sku, `${i.fonte}:${i.custo}`])), { 'AZ-01': 'manual:50', 'VD-02': 'sheets:20' })
  assert.equal(cu.skus_efetivos.total, 2); assert.ok(cu.custos_pendencias.some(p => p.codigo === 'CUSTO_QUARENTENA'))
})

await okA('dados de cada cliente separados: o vizinho com o mesmo SKU continua SEM CUSTO', async () => {
  assert.equal(C.custosEfetivos(HB).size, 0)
  assert.deepEqual(await mcDe(HB, 'MLB7'), { estado: 'SEM CUSTO', mc: null })
})

await okA('troca/desconexão da conta ML apaga os derivados mas PRESERVA os custos (entradas do dono)', async () => {
  const antes = [...C.custosEfetivos(HC)].sort()
  R.limparPromocoesDoCliente(HC, 'teste de troca de conta')
  assert.equal(R.lerAnuncios(HC).length, 0)
  assert.deepEqual([...C.custosEfetivos(HC)].sort(), antes)
  assert.equal(C.listarQuarentena(HC).length, 1, 'a quarentena pendente continua esperando o dono')
})

await okA('guard: só /webhook/custos/<wid> e /erp/callback abrem pelo túnel; /api/custos/* e variações sem âncora = 403', async () => {
  const tunel = 'abc-123.trycloudflare.com', passa = path => {
    let foi = false, st = 0
    G.guardaLocal({ method: 'POST', path, headers: { host: tunel } }, { status(c) { st = c; return this }, send() { return this } }, () => { foi = true })
    return foi || st
  }
  for (const p of ['/webhook/custos/AbCdEfGhIjKlMnOpQrStUv', '/erp/callback', '/webhook/meli', '/webhook/notion', '/meli/callback']) assert.equal(passa(p), true, p)
  for (const p of ['/webhook/custos', '/webhook/custos/x/y', '/webhook/custos/curto', '/api/custos/resumo', '/api/custos/fontes/sheets/webhook', '/erp/autorizar', '/webhook/meliXYZ', '/api/promocoes/custos'])
    assert.equal(passa(p), 403, p)
})

await okA('server.js monta na ordem certa: guard → /webhook/custos → express.json → rotas; /erp/callback, timers e logger injetado', async () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8'), pos = s => { const i = src.indexOf(s); assert.ok(i >= 0, `faltou: ${s}`); return i }
  assert.ok(pos('app.use(guardaLocal)') < pos("app.use('/webhook/custos', rotasWebhookCustos)"))
  assert.ok(pos("app.use('/webhook/custos', rotasWebhookCustos)") < pos("app.use(express.json({ limit: '1mb' }))"), 'o HMAC é sobre os bytes crus')
  assert.ok(pos("app.use(express.json({ limit: '1mb' }))") < pos('app.use(rotasCustos)'))
  pos("app.get('/erp/callback'"); pos('tratarCallbackErp(req.query)'); pos('configurarLogCustos(log)'); pos('configurarLogWebhookCustos(log)'); pos('configurarLogSyncErp(log)')
  assert.match(src, /setInterval\(\(\) => tickCustos\(\)[^\n]*10 \* 60 \* 1000\)/); assert.match(src, /setInterval\(\(\) => processarFila\(\)[^\n]*, 5000\)/)
})

srv.close()
console.log(`\n✔ teste-custos-integracao: ${n} verificações OK`)
