// Autoteste do vínculo CUSTO ↔ ANÚNCIO (plano §4): resolução única (manual > SKU exato > SKU normalizado de chave única > grupo user_product_id),
// "não é este", validações das rotas (404/400 sem eco, 415, prospect), selo das promoções, tarifa para anúncio vinculado, fat30, limpeza e o caso União Dog.
// Banco EM MEMÓRIA com o schema inteiro (PS_DB_MEMORIA=1 antes dos imports dinâmicos); o ML é um stub só-GET. Rodar: node scripts/teste-custo-vinculo.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { db } = await import('../src/lib/db.js')
const R = await import('../src/lib/promocoes-db.js')
const C = await import('../src/lib/custos-db.js')
const A = await import('../src/lib/promocoes-analista.js')
const Col = await import('../src/lib/promocoes-coleta.js')
const V = await import('../src/lib/vinculos.js')
const { resolverChaves } = await import('../src/lib/custo-vinculo.js')
const Rotas = await import('../src/rotas-custos.js')
const G = await import('../src/lib/guarda-local.js')
const express = (await import('express')).default
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')
assert.equal(R.db, db)

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const VC = C.vinculosCusto
const anuncio = (cli, item_id, sku, titulo, o = {}) => db.prepare(`INSERT INTO promo_anuncio (cliente, item_id, sku, titulo, status, preco, user_product_id, fat30, categoria, tipo_anuncio, lido_em)
  VALUES (@cli, @item_id, @sku, @titulo, 'active', @preco, @upid, @fat30, 'MLB1', 'gold_special', 'x')`).run({ cli, item_id, sku, titulo, preco: o.preco ?? 50, upid: o.upid ?? '', fat30: o.fat30 ?? 0 })
const custos = (cli, mapa) => R.importarCustosSku(cli, Object.entries(mapa).map(([sku, custo]) => ({ sku, custo })), 'teste', 'teste')
const linhasVinculo = cli => db.prepare('SELECT item_id, sku_custo, origem FROM custo_vinculo WHERE cliente = ? ORDER BY item_id, sku_custo').all(cli)

// ── dados de exemplo da União Dog (custo chaveado pelo NOME do produto; SKU do anúncio é outro) ──
const UD = 'Uniaodog Teste'
custos(UD, { 'Peitoral Tamanho P': 24.34, 'Peitoral Tamanho M': 29.86, 'Peitoral Tamanho G': 39.27, 'Cinto desegurança': 33.46, 'Guia Longa 5m': 55.63, 'Coleira P': 12.54 })
anuncio(UD, 'MLB4311029803', 'PEITORALH-2-P', 'Coleira Peitoral H | P Cães Pequenos | Confortável | Seguro', { upid: 'MLBU-P', fat30: 900, preco: 49.9 })
anuncio(UD, 'MLB5943664742', 'PEITORALH-2-M', 'Peitoral H | Tamanho M | Porte Médio |  Ajuste Anti-escape', { fat30: 500 })
anuncio(UD, 'MLB5944384554', 'PEITORALH-2-G', 'Peitoral H Tam G | Porte Grande | Resistente', { fat30: 100 })
anuncio(UD, 'MLB6600114090', 'CINTODESEGURANÇA', 'Cinto De Segurança Pet Ajustável Para Carro Resistente Rosa Único')
anuncio(UD, 'MLB4597556961', 'CINTODESEGURANÇA', 'Cinto De Segurança Pet Ajustável Para Carro Resistente Nude Ajustável')
anuncio(UD, 'MLB4100000001', '', 'Guia Corda Cachorro 5m Mosquetão Grande Porte Resistente Preta')
anuncio(UD, 'MLB4100000002', '', 'Coleira Peitoral H P Rosa (mesmo produto do PEITORALH-2-P)', { upid: 'MLBU-P' })
anuncio(UD, 'MLB4100000003', 'TRAN-G', 'Mordedor Trança Bovina Tamanho G')
db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, thumb, status) VALUES (?, 'MLB4311029803', 'x', 'https://http2.mlstatic.com/D_1-I.jpg', 'active'), (?, 'MLB4100000009', 'Peitoral avulso fora das promoções', '', 'active')").run(UD, UD)

await ok('núcleo puro: precedência manual > SKU exato (caixa diferente) > SKU normalizado (só chave única) > grupo; "recusado" e grupo em desacordo não casam', () => {
  const chaves = new Set(['abc', 'cinto desegurança', 'peitoral p', 'x-1', 'x 1', 'agua-15l', 'k'])
  const anuncios = [
    { item_id: 'MLB1', sku: 'ABC' }, { item_id: 'MLB2', sku: 'CINTODESEGURANÇA' }, { item_id: 'MLB3', sku: 'X1' },
    { item_id: 'MLB4', sku: '', user_product_id: 'U1' }, { item_id: 'MLB5', sku: 'ABC', user_product_id: 'U1' }, { item_id: 'MLB6', sku: 'ABC' },
    { item_id: 'MLB7', sku: '', user_product_id: 'U2' }, { item_id: 'MLB8', sku: 'abc', user_product_id: 'U2' }, { item_id: 'MLB9', sku: 'CINTODESEGURANÇA', user_product_id: 'U2' },
    { item_id: 'MLB10', sku: 'abc' }, { item_id: 'MLB11', sku: 'zzz' }, { item_id: 'MLB12', sku: 'AGUA-1.5L' },
    { item_id: 'MLB13', sku: 'K', user_product_id: 'U3' }, { item_id: 'MLB14', sku: '', user_product_id: 'U3' }, { item_id: 'MLB15', sku: 'K', user_product_id: 'U3' },
  ]
  const r = resolverChaves(anuncios, chaves, [{ item_id: 'MLB6', sku_custo: 'peitoral p', origem: 'manual' }, { item_id: 'MLB10', sku_custo: 'abc', origem: 'recusado' },
    { item_id: 'MLB15', sku_custo: 'morto', origem: 'manual' }], C.chaveSku)
  const o = id => r.get(id) ? `${r.get(id).origem}:${r.get(id).chave}` : null
  assert.equal(o('MLB1'), 'sku:abc', 'caixa diferente casa pelo SKU exato (chaveSku), como sempre')
  assert.equal(o('MLB2'), 'sku_normalizado:cinto desegurança')
  assert.equal(o('MLB3'), null, 'x-1 e "x 1" normalizam igual: chave ambígua não casa')
  assert.equal(o('MLB12'), null, 'o ponto fica no normalizado: AGUA-1.5L não herda o custo de AGUA-15L')
  assert.equal(o('MLB15'), 'manual:morto', 'manual com custo descartado: o anúncio fica sem custo (não cai no SKU)')
  assert.equal(o('MLB14'), 'grupo:k', 'a chave morta do manual não vota no grupo: o irmão sem SKU herda o custo válido')
  assert.equal(o('MLB4'), 'grupo:abc')
  assert.equal(o('MLB6'), 'manual:peitoral p', 'manual manda sobre o SKU do anúncio')
  assert.equal(o('MLB7'), null, 'grupo com dois custos diferentes não herda')
  assert.equal(o('MLB10'), null, '"não é este" tira o casamento automático')
  assert.equal(o('MLB11'), null)
})

await ok('vinculos.js: tamanhos (PP/P/M/G…) e "5m" só com opt-in; tarefa segue como antes', () => {
  assert.deepEqual(V.tokens('Peitoral Tamanho P 5m 10mm'), ['peitoral', 'tamanho', '10mm'])
  assert.deepEqual(V.tokens('Peitoral Tamanho P 5m 10mm', { tamanhos: true }), ['peitoral', 'p', '5m', '10mm'], '"tamanho" só anuncia o tamanho')
  const itens = [{ item_id: 'MLB1', titulo: 'Peitoral H Tamanho P Rosa' }, { item_id: 'MLB2', titulo: 'Peitoral H Tamanho M Rosa' }]
  assert.equal(V.sugerirVinculo({ titulo: 'Peitoral tamanho P' }, itens)?.ambiguo, true, 'sem opt-in o P some e os dois empatam (comportamento de tarefa)')
  assert.equal(V.sugerirVinculo({ titulo: 'Peitoral tamanho P' }, itens, { tamanhos: true }).item_id, 'MLB1', 'com tamanhos, M conflita com P e sai')
})

await ok('União Dog: "Peitoral Tamanho P" sugere PEITORALH-2-P e NÃO vincula sozinho; "Cinto desegurança" casa com CINTODESEGURANÇA pelo normalizado', () => {
  assert.deepEqual(VC.custoDoAnuncio(UD, { item_id: 'MLB4311029803', sku: 'PEITORALH-2-P' }), { custo: null, sku_custo: null, origem: null })
  assert.deepEqual(VC.custoDoAnuncio(UD, { item_id: 'MLB6600114090', sku: 'CINTODESEGURANÇA' }), { custo: 33.46, sku_custo: 'Cinto desegurança', origem: 'sku_normalizado', chave: 'cinto desegurança' })
  const l = VC.listarVinculos(UD), c = s => l.custos_sem_anuncio.find(x => x.sku_custo === s)
  assert.deepEqual(Object.keys(l), ['custos_sem_anuncio', 'anuncios_sem_custo', 'vinculados', 'totais'])
  assert.equal(c('Peitoral Tamanho P').candidatos[0].item_id, 'MLB4311029803')
  assert.equal(c('Peitoral Tamanho P').candidatos[0].thumb, 'https://http2.mlstatic.com/D_1-I.jpg')
  assert.ok(Number.isInteger(c('Peitoral Tamanho P').candidatos[0].semelhanca))
  assert.ok(!c('Peitoral Tamanho P').candidatos.some(x => ['MLB5943664742', 'MLB5944384554'].includes(x.item_id)), 'tamanho M/G não é candidato de P')
  assert.equal(c('Peitoral Tamanho M').candidatos[0].item_id, 'MLB5943664742')
  assert.equal(c('Peitoral Tamanho G').candidatos[0].item_id, 'MLB5944384554', '"Tam G" casa com "Tamanho G"')
  assert.ok(!c('Peitoral Tamanho G').candidatos.some(x => x.item_id === 'MLB4100000003'), 'só tamanho em comum (sem "peitoral") não é candidato')
  assert.equal(c('Guia Longa 5m').candidatos[0].item_id, 'MLB4100000001', '"5m" conta como palavra')
  assert.equal(c('Cinto desegurança'), undefined, 'casado pelo normalizado não é "custo sem anúncio"')
  assert.deepEqual(l.vinculados.map(v => [v.item_id, v.origem]).sort(), [['MLB4597556961', 'sku_normalizado'], ['MLB6600114090', 'sku_normalizado']])
  const p = l.anuncios_sem_custo.find(a => a.item_id === 'MLB4311029803')
  assert.equal(l.anuncios_sem_custo[0].item_id, 'MLB4311029803', 'ordenado por faturamento 30d')
  assert.ok(p.candidatos.some(x => x.sku_custo === 'Peitoral Tamanho P' && x.custo === 24.34))
  assert.ok(l.anuncios_sem_custo.some(a => a.item_id === 'MLB4100000009' && a.sku === ''), 'anúncio só do meli_item também aparece (sem SKU)')
  assert.deepEqual(linhasVinculo(UD), [], 'sugestão nunca grava')
})

await ok('vincular (manual) manda; grupo herda pelo user_product_id; um custo por anúncio; vinculados trazem por/em', () => {
  assert.deepEqual(VC.vincular({ cliente: UD, item_id: 'mlb4311029803', sku_custo: 'peitoral tamanho p', por: 'Analista' }), { ok: true, item_id: 'MLB4311029803', sku_custo: 'Peitoral Tamanho P', origem: 'manual' })
  assert.equal(VC.custoDoAnuncio(UD, { item_id: 'MLB4311029803', sku: 'PEITORALH-2-P' }).custo, 24.34)
  const irmao = VC.custoDoAnuncio(UD, { item_id: 'MLB4100000002', sku: '', user_product_id: 'MLBU-P' })
  assert.deepEqual([irmao.custo, irmao.origem], [24.34, 'grupo'])
  assert.equal(VC.custoDoAnuncio(UD, { item_id: 'MLB4100000002' }).origem, 'grupo', 'anúncio sem sku/user_product_id (ex.: do meli_item) completa pelo promo_anuncio')
  VC.vincular({ cliente: UD, item_id: 'MLB4311029803', sku_custo: 'Coleira P', por: 'Analista' })
  assert.deepEqual(linhasVinculo(UD), [{ item_id: 'MLB4311029803', sku_custo: 'coleira p', origem: 'manual' }], 'o novo manual substitui o anterior')
  VC.vincular({ cliente: UD, item_id: 'MLB4311029803', sku_custo: 'Peitoral Tamanho P', por: 'Analista' })
  const l = VC.listarVinculos(UD), m = l.vinculados.find(v => v.item_id === 'MLB4311029803')
  assert.equal(m.origem, 'manual'); assert.equal(m.por, 'Analista'); assert.ok(m.em)
  assert.equal(l.custos_sem_anuncio.find(x => x.sku_custo === 'Peitoral Tamanho P'), undefined)
  assert.equal(R.listarAuditoria(UD, { evento: 'custo_vinculo' }).length >= 3, true)
})

await ok('"Não é este" (recusado) não volta: sai dos candidatos e tira o casamento automático; desvincular com sku_custo desfaz', () => {
  VC.recusar({ cliente: UD, item_id: 'MLB5943664742', sku_custo: 'Peitoral Tamanho M', por: 'Analista' })
  assert.ok(!VC.listarVinculos(UD).custos_sem_anuncio.find(x => x.sku_custo === 'Peitoral Tamanho M').candidatos.some(x => x.item_id === 'MLB5943664742'))
  VC.recusar({ cliente: UD, item_id: 'MLB6600114090', sku_custo: 'Cinto desegurança', por: 'Analista' })
  assert.equal(VC.custoDoAnuncio(UD, { item_id: 'MLB6600114090', sku: 'CINTODESEGURANÇA' }).custo, null)
  assert.equal(VC.desvincular({ cliente: UD, item_id: 'MLB6600114090', sku_custo: 'Cinto desegurança', por: 'Analista' }).removidos, 1)
  assert.equal(VC.custoDoAnuncio(UD, { item_id: 'MLB6600114090', sku: 'CINTODESEGURANÇA' }).origem, 'sku_normalizado')
})

await ok('reconciliação e lote de custo enxergam o vínculo: anuncio_sem_custo, sku_erp_sem_anuncio (camada manual) e quarentena custo ≥ preço', () => {
  const sem = C.reconciliacao(UD, 'anuncio_sem_custo').itens.map(a => a.item_id)
  assert.ok(!sem.includes('MLB4311029803') && sem.includes('MLB5943664742'))
  C.aplicarLote({ cliente: UD, fonte: 'sheets', lote_id: 'l1', origem: 'sync', linhas: [{ sku: 'GUIA-ERP', custo: 20 }] })
  assert.ok(C.reconciliacao(UD, 'sku_erp_sem_anuncio').itens.some(x => x.sku === 'GUIA-ERP'))
  VC.vincular({ cliente: UD, item_id: 'MLB4100000001', sku_custo: 'GUIA-ERP', por: 'Analista' })
  assert.ok(!C.reconciliacao(UD, 'sku_erp_sem_anuncio').itens.some(x => x.sku === 'GUIA-ERP'), 'ligado à mão deixa de ser "SKU do ERP sem anúncio"')
  // o anúncio vinculado (preço 49,90) dá o preço de referência do SKU de custo: 80 ≥ 49,90 vai para a quarentena
  const r = C.aplicarLote({ cliente: UD, fonte: 'sheets', lote_id: 'l2', origem: 'sync', linhas: [{ sku: 'Peitoral Tamanho P', custo: 80 }] })
  assert.equal(r.em_quarentena, 1); assert.equal(r.quarentena_lista[0].codigo, 'custo_ge_preco')
  // "não é este" no SKU EXATO: o custo volta a ser "SKU do ERP sem anúncio" e o preço do anúncio que o recusou não é mais referência do lote
  anuncio(UD, 'MLB2222222222', 'K-9', 'Ração K9 Premium', { preco: 10 })
  C.aplicarLote({ cliente: UD, fonte: 'sheets', lote_id: 'l3', origem: 'sync', linhas: [{ sku: 'K-9', custo: 9 }] })
  assert.ok(!C.reconciliacao(UD, 'sku_erp_sem_anuncio').itens.some(x => x.sku === 'K-9'))
  VC.recusar({ cliente: UD, item_id: 'MLB2222222222', sku_custo: 'K-9', por: 'Analista' })
  assert.equal(VC.custoDoAnuncio(UD, { item_id: 'MLB2222222222', sku: 'K-9' }).custo, null)
  assert.ok(C.reconciliacao(UD, 'sku_erp_sem_anuncio').itens.some(x => x.sku === 'K-9'), 'recusado: a reconciliação concorda com a resolução')
  assert.equal(C.aplicarLote({ cliente: UD, fonte: 'sheets', lote_id: 'l4', origem: 'sync', linhas: [{ sku: 'K-9', custo: 11 }] }).em_quarentena, 0, 'o preço (R$ 10) de quem recusou não manda o custo (R$ 11, +22%) para a quarentena')
})

await ok('custo manual colado com NBSP/NFD (texto do Mac) é a MESMA chave das fontes externas: Confirmar acha o custo', () => {
  const NFD = 'Coleira Luxo Ç'.normalize('NFD').replace('Luxo', 'Luxo\u00A0')
  custos(UD, { [NFD]: 19.9 })
  const k = C.chaveSku(NFD)
  assert.ok(C.custosEfetivos(UD).has(k), 'a camada manual entra com chaveSku (NFC, sem NBSP)')
  assert.equal(VC.vincular({ cliente: UD, item_id: 'MLB4100000003', sku_custo: NFD, por: 'Analista' }).origem, 'manual')
  assert.equal(VC.custoDoAnuncio(UD, { item_id: 'MLB4100000003', sku: 'TRAN-G' }).custo, 19.9)
  VC.desvincular({ cliente: UD, item_id: 'MLB4100000003', por: 'Analista' })
})

// ── rotas: Express efêmero com o guard global e o json (como o server.js); conexões são stub ──
Object.assign(Rotas.depsCustos, { conexoes: () => [{ cliente: UD }, { cliente: 'Outro Cliente' }, { cliente: '[Comercial] Prospect · 1' }] })
anuncio('Outro Cliente', 'MLB7000000001', 'OUTRO-1', 'Anúncio de outro cliente')
const app = express(); app.use(G.guardaLocal); app.use(express.json({ limit: '1mb' })); app.use(Rotas.rotasCustos)
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`
const http = async (metodo, caminho, corpo, tipo = 'application/json') => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: tipo ? { 'Content-Type': tipo } : {}, body: corpo === undefined ? undefined : JSON.stringify(corpo) })
  const texto = await r.text()
  assert.ok(!/\bat .+:\d+:\d+|"stack"/.test(texto), `resposta com stack: ${texto.slice(0, 200)}`)
  return { status: r.status, json: JSON.parse(texto), texto }
}
const semEco = (r, ...valores) => { for (const v of valores) assert.ok(!r.texto.includes(v), `mensagem ecoou o valor recebido: ${r.texto}`) }

await ok('rotas: GET /api/custos/vinculos isolado por cliente; POST vincular/recusar/desvincular com JSON e "por"', async () => {
  const g = await http('GET', `/api/custos/vinculos?cliente=${encodeURIComponent(UD)}`)
  assert.equal(g.status, 200); assert.ok(g.json.vinculados.some(v => v.item_id === 'MLB4311029803'))
  const o = await http('GET', '/api/custos/vinculos?cliente=Outro%20Cliente')
  assert.deepEqual([o.json.custos_sem_anuncio, o.json.vinculados], [[], []]); assert.deepEqual(o.json.anuncios_sem_custo.map(a => a.item_id), ['MLB7000000001'])
  const v = await http('POST', '/api/custos/vincular', { cliente: UD, item_id: 'MLB5944384554', sku_custo: 'Peitoral Tamanho G', por: 'David' })
  assert.equal(v.status, 200); assert.equal(v.json.origem, 'manual')
  assert.equal((await http('POST', '/api/custos/desvincular', { cliente: UD, item_id: 'MLB5944384554', por: 'David' })).json.removidos, 1)
  assert.equal((await http('POST', '/api/custos/recusar', { cliente: UD, item_id: 'MLB5944384554', sku_custo: 'Peitoral Tamanho G', por: 'David' })).json.origem, 'recusado')
})

await ok('rotas: anúncio de outro cliente → 404, SKU de custo inexistente → 400, MLB inválido/"por" ausente → 400, prospect → 400, sem JSON → 415 — nada ecoa o valor', async () => {
  const antes = linhasVinculo(UD).length
  let r = await http('POST', '/api/custos/vincular', { cliente: UD, item_id: 'MLB7000000001', sku_custo: 'Coleira P', por: 'David' })
  assert.equal(r.status, 404); semEco(r, 'MLB7000000001')
  r = await http('POST', '/api/custos/vincular', { cliente: UD, item_id: 'MLB5944384554', sku_custo: 'SKU-QUE-NAO-EXISTE-XYZ', por: 'David' })
  assert.equal(r.status, 400); semEco(r, 'SKU-QUE-NAO-EXISTE-XYZ', 'sku-que-nao-existe-xyz')
  r = await http('POST', '/api/custos/vincular', { cliente: UD, item_id: 'XYZ<script>', sku_custo: 'Coleira P', por: 'David' })
  assert.equal(r.status, 400); semEco(r, 'XYZ<script>')
  assert.equal((await http('POST', '/api/custos/vincular', { cliente: UD, item_id: 'MLB5944384554', sku_custo: 'Coleira P' })).status, 400)
  assert.equal((await http('POST', '/api/custos/vincular', { cliente: UD, item_id: 'MLB5944384554', sku_custo: 'Coleira P', por: 'x'.repeat(81) })).status, 400)
  assert.equal((await http('POST', '/api/custos/recusar', { cliente: UD, item_id: 'MLB5944384554', por: 'David' })).status, 400, 'recusar exige sku_custo')
  r = await http('POST', '/api/custos/vincular', { cliente: '[Comercial] Prospect · 1', item_id: 'MLB5944384554', sku_custo: 'Coleira P', por: 'David' })
  assert.equal(r.status, 400); semEco(r, 'Prospect · 1')
  assert.equal((await http('GET', `/api/custos/vinculos?cliente=${encodeURIComponent('[Comercial] Prospect · 1')}`)).status, 400)
  assert.equal((await http('GET', '/api/custos/vinculos?cliente=Desconhecido')).status, 404)
  const f = await fetch(BASE + '/api/custos/vincular', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `cliente=${encodeURIComponent(UD)}&item_id=MLB5944384554&sku_custo=Coleira%20P&por=David` })
  assert.equal(f.status, 415)
  assert.equal(linhasVinculo(UD).length, antes, 'nada gravado pelas tentativas inválidas')
})
srv.close()

await ok('selo das promoções muda com o vínculo; sem vínculo fora do SKU exato, o selo é o de antes (rodada gravada não fica desatualizada)', async () => {
  const S = 'Selo Teste'
  custos(S, { 'ABC': 10, 'Outro Custo': 30 })
  anuncio(S, 'MLB800', 'ABC', 'Produto ABC'); anuncio(S, 'MLB801', 'SEM-CASAR', 'Produto sem casamento')
  const selo = async () => { const e = await A.carregarEntrada(S, { custosCliente: null }); return { e, s: A.entradaSelo(e, []) } }
  const { e: e1, s: s1 } = await selo()
  assert.equal(A.custoDoItem(e1.anuncios.find(a => a.item_id === 'MLB800'), e1.custosSku), 10)
  const crus = e1.anuncios.map(({ custo_resolvido, ...a }) => a)
  assert.equal(A.entradaSelo({ ...e1, anuncios: crus }, []).hash, s1.hash, 'só SKU exato: selo idêntico ao da versão anterior')
  VC.vincular({ cliente: S, item_id: 'MLB801', sku_custo: 'Outro Custo', por: 'Analista' })
  const { e: e2, s: s2 } = await selo()
  assert.equal(A.custoDoItem(e2.anuncios.find(a => a.item_id === 'MLB801'), e2.custosSku), 30, 'o analista enxerga o custo vinculado')
  assert.notEqual(s2.hash, s1.hash); assert.notEqual(s2.partes.custos, s1.partes.custos)
  assert.deepEqual(Object.keys(s1.partes).filter(k => k !== 'custos' && s1.partes[k] !== s2.partes[k]), [], 'só a parte "custos" muda')
  VC.recusar({ cliente: S, item_id: 'MLB800', sku_custo: 'ABC', por: 'Analista' })
  assert.notEqual((await selo()).s.partes.custos, s2.partes.custos, '"não é este" no SKU exato também muda o selo')
})

await ok('coleta: tarifa/frete coletados para anúncio vinculado à mão (sem SKU que case) e fat30 gravado em promo_anuncio', async () => {
  const T = 'Tarifa Teste', hoje = R.hojeLocal()
  custos(T, { 'Custo Manual': 20 })
  db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?, ?, ?, 3, 150.456)').run(T, 'MLB901', hoje)
  const chamadas = []
  const chamar = async (cli, caminho, opts) => {
    assert.ok(opts?.permitirFalha); chamadas.push(caminho)
    if (/^\/seller-promotions\/users\/123\?/.test(caminho)) return { results: [], paging: { total: 0 } }
    if (/^\/items\/bulk\?ids=/.test(caminho)) return caminho.match(/ids=([^&]+)/)[1].split(',').map(id => ({ id, status_code: 200, body: { id, title: `Item ${id}`, price: 100, original_price: 120, status: 'active',
      category_id: 'MLB1', listing_type_id: 'gold_special', available_quantity: 5, attributes: [{ id: 'SELLER_SKU', value_name: `SEM-CASAR-${id}` }], variations: [], user_product_id: '' } }))
    if (/^\/seller-promotions\/items\/MLB\d+\?app_version=v2$/.test(caminho)) return [{ id: 'P-1', type: 'SMART', ref_id: 'C-1', status: 'candidate', price: 90, original_price: 100, meli_percentage: 5, seller_percentage: 0 }]
    if (/^\/sites\/MLB\/listing_prices/.test(caminho)) return [{ sale_fee_details: { percentage_fee: 16, fixed_fee: 6 } }]
    if (/^\/users\/123\/shipping_options\/free/.test(caminho)) return { coverage: { all_country: { list_cost: 12 } } }
    return { _erro: true, status: 404, corpo: 'rota não prevista' }
  }
  const coletar = () => Col.coletarPromocoes(T, { deps: { chamar, uid: 123, espera: 0, itensExtras: ['MLB901', 'MLB902'] } })
  await coletar()
  const lido = () => Object.fromEntries(db.prepare('SELECT item_id, tarifa_estado, fat30 FROM promo_anuncio WHERE cliente = ?').all(T).map(a => [a.item_id, a]))
  assert.equal(lido().MLB901.tarifa_estado, '', 'sem custo: tarifa não é coletada')
  assert.equal(lido().MLB901.fat30, 150.46, 'fat30 = faturamento 30d da série, em centavos'); assert.equal(lido().MLB902.fat30, 0)
  VC.vincular({ cliente: T, item_id: 'MLB901', sku_custo: 'Custo Manual', por: 'Analista' })
  const antes = chamadas.filter(c => /listing_prices/.test(c)).length
  await new Promise(r => setTimeout(r, 5))
  await coletar()
  assert.equal(lido().MLB901.tarifa_estado, 'ok', 'vinculado à mão: tarifa e frete coletados')
  assert.equal(lido().MLB902.tarifa_estado, '')
  assert.equal(chamadas.filter(c => /listing_prices/.test(c)).length - antes, 1, 'só o anúncio vinculado consulta tarifa')
  assert.ok(!chamadas.some(c => /method|POST|PUT|DELETE/i.test(c)))
  assert.equal(C.resumoCustos(T).efetivo.cobertura_receita_pct, 100, 'cobertura de receita conta o anúncio vinculado (fat30 gravado)')
})

await ok('Algoritmo: o diagnóstico da conta lê o custo de cada anúncio pela resolução única (custo_unitario, custo_origem)', async () => {
  const { carregarBase } = await import('../src/lib/diagnostico-conta.js')
  const D = 'Diag Teste', HOJE = '2026-10-07'
  custos(D, { 'Peitoral Tamanho P': 24.34 })
  anuncio(D, 'MLB7000000001', 'PEITORALH-2-P', 'Coleira Peitoral H P')
  anuncio(D, 'MLB7000000002', 'peitoral tamanho p', 'Peitoral Tamanho P (SKU igual, outra caixa)')
  for (const id of ['MLB7000000001', 'MLB7000000002', 'MLB7000000003']) {
    db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco, status) VALUES (?, ?, 'x', 49.9, 'active')").run(D, id)
    db.prepare("INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?, ?, '2026-10-01', 2, 99.8, 40)").run(D, id)
  }
  VC.vincular({ cliente: D, item_id: 'MLB7000000001', sku_custo: 'Peitoral Tamanho P', por: 'Analista' })
  const it = Object.fromEntries(carregarBase(D, { hoje: HOJE }).itens.map(i => [i.id, [i.custo_unitario, i.custo_origem]]))
  assert.deepEqual(it, { MLB7000000001: [24.34, 'manual'], MLB7000000002: [24.34, 'sku'], MLB7000000003: [null, null] }, 'sem vínculo nem SKU: sem custo (os percentuais da conta seguem como fallback no plano)')
})

await ok('limpeza na troca de conta apaga custo_vinculo só do cliente', () => {
  const ud = linhasVinculo(UD).length, sel = linhasVinculo('Selo Teste').length
  assert.ok(ud > 0 && sel > 0)
  assert.equal(R.limparPromocoesDoCliente(UD, 'teste').custo_vinculo, ud)
  assert.equal(linhasVinculo(UD).length, 0); assert.equal(linhasVinculo('Selo Teste').length, sel)
})

console.log(`teste-custo-vinculo: ${n} verificações OK`)
