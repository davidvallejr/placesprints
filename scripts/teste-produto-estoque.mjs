// V3 F2 — grafo produto → anúncio → estoque por local, em SOMBRA (docs/desenho-v3-produto-estoque-financeiro.md § 3 e § 9 F2). PURO: nenhum banco, nenhuma rede.
// Junções (UP, inventário, SKU oficial, catálogo), travas, recusa, manual, chave determinística, precedência do estoque, modos, EF, cobertura e ponto do produto,
// sombra (ligado=false não muda nada), a soma ingênua × contado uma vez (85.703 × 28.410) e as sugestões da gaveta.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { montarGrafo, aplicarProduto, sugerirMapeamento, ehOrigem, ehChaveProduto, chaveAlvo } = await import('../src/lib/produto-estoque.js')

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-14', L = { estoque_seguranca_dias: 7, lead_time_reposicao_dias: 21, cobertura_critica_dias: 10 }
const P = { juntar_automatico: ['up', 'inventory', 'sku', 'catalogo'], leitura_stock_validade_dias: 2, estoque_declarado_validade_dias: 7 }
const A = (item_id, o = {}) => ({ item_id, variacao_id: '', user_product_id: '', inventory_id: '', sku: '', sku_fonte: '', catalogo_produto_id: '', estoque: null,
  logistica: 'xd_drop_off', flex: 0, tags: '', status: 'active', lido_em: '2026-10-14T05:00:00Z', titulo: `Produto ${item_id}`, ...o })
const G = (arestas, o = {}) => montarGrafo({ arestas, hoje: HOJE, P, ...o })
const prodDe = (g, id) => g.doItem.get(id).produto
const embaralhar = l => l.map(x => [Math.sin(x.item_id.length * 7919 + x.item_id.charCodeAt(x.item_id.length - 1)), x]).sort((a, b) => a[0] - b[0]).map(x => x[1])

ok('chaves válidas: origem up:/item:, produto sku:/cat:/up: (nada mais passa)', () => {
  assert.ok(ehOrigem('up:MLBU3455477126') && ehOrigem('item:MLB5751083964')); assert.ok(!ehOrigem('sku:x') && !ehOrigem('up:MLBU1; DROP') && !ehOrigem(''))
  assert.ok(ehChaveProduto('sku:glpreta-10m') && ehChaveProduto('cat:MLB26091235') && ehChaveProduto('up:MLBU1') && ehChaveProduto('item:MLB1'))
  assert.ok(!ehChaveProduto('sku:<b>') && !ehChaveProduto('sku:gl~up:MLBU1') && !ehChaveProduto('inv:I1'), 'chave com sufixo de colisão nunca é alvo de vínculo')
})

ok('junções: mesmo UP (catálogo + clássico), mesmo inventário Full, mesmo SKU oficial (sem caixa) e mesmo catálogo — cada uma com o motivo', () => {
  const g = G([
    A('MLB1', { user_product_id: 'MLBU10', estoque: 100 }), A('MLB2', { user_product_id: 'MLBU10', estoque: 100 }),                                       // UP
    A('MLB3', { inventory_id: 'INV7', logistica: 'fulfillment', estoque: 5 }), A('MLB4', { user_product_id: 'MLBU20', inventory_id: 'INV7', logistica: 'fulfillment', estoque: 5 }),   // inventário
    A('MLB5', { user_product_id: 'MLBU30', sku: 'COL-P', sku_fonte: 'seller_sku', estoque: 40 }), A('MLB6', { user_product_id: 'MLBU31', sku: 'col-p ', sku_fonte: 'variacao', estoque: 40 }),   // SKU
    A('MLB7', { user_product_id: 'MLBU40', catalogo_produto_id: 'MLB900', estoque: 9 }), A('MLB8', { user_product_id: 'MLBU41', catalogo_produto_id: 'MLB900', estoque: 9 }),   // catálogo
  ])
  assert.equal(prodDe(g, 'MLB1'), prodDe(g, 'MLB2')); assert.deepEqual(prodDe(g, 'MLB1').motivos, []); assert.equal(prodDe(g, 'MLB1').pools.length, 1, 'mesmo UP e local = 1 pool')
  assert.equal(prodDe(g, 'MLB3'), prodDe(g, 'MLB4')); assert.deepEqual(prodDe(g, 'MLB3').motivos, ['inventory'])
  assert.equal(prodDe(g, 'MLB5'), prodDe(g, 'MLB6')); assert.equal(prodDe(g, 'MLB5').chave, 'sku:col-p'); assert.deepEqual(prodDe(g, 'MLB5').motivos, ['sku'])
  assert.equal(prodDe(g, 'MLB7'), prodDe(g, 'MLB8')); assert.equal(prodDe(g, 'MLB7').chave, 'cat:MLB900')
  assert.equal(g.produtos.length, 4)
})

ok('trava de contradição: mesmo catálogo com SKUs oficiais diferentes NÃO junta (vira sugestão); mesmo SKU com catálogos diferentes idem; seller_custom_field nunca junta', () => {
  const g = G([
    A('MLB1', { user_product_id: 'MLBU1', sku: 'A1', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB900' }), A('MLB2', { user_product_id: 'MLBU2', sku: 'B2', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB900' }),
    A('MLB3', { user_product_id: 'MLBU3', sku: 'X', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB901' }), A('MLB4', { user_product_id: 'MLBU4', sku: 'X', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB902' }),
    A('MLB5', { user_product_id: 'MLBU5', sku: '195', sku_fonte: 'seller_custom_field' }), A('MLB6', { user_product_id: 'MLBU6', sku: '195', sku_fonte: 'seller_custom_field' }),
  ])
  assert.notEqual(prodDe(g, 'MLB1'), prodDe(g, 'MLB2')); assert.notEqual(prodDe(g, 'MLB3'), prodDe(g, 'MLB4')); assert.notEqual(prodDe(g, 'MLB5'), prodDe(g, 'MLB6'))
  assert.deepEqual(g.sugestoes.map(s => s.motivo).sort(), ['mesmo SKU, catálogos diferentes', 'mesmo catálogo, SKUs diferentes'])
  const s = sugerirMapeamento(g)
  assert.ok(s.some(x => x.tipo === 'seller_custom_field' && x.motivo === 'mesmo SKU interno (seller_custom_field)'), 'seller_custom_field só como sugestão')
  assert.ok(s.some(x => x.tipo === 'conflito' && /catálogo, SKUs diferentes/.test(x.motivo)))
})

ok('juntar_automatico sem "sku" (decisão 3 do desenho: só sugerir): o mesmo SKU vira sugestão, o UP continua juntando', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', sku: 'K', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', sku: 'K', sku_fonte: 'seller_sku' }), A('MLB3', { user_product_id: 'MLBU1' })]
  const g = montarGrafo({ arestas: ar, hoje: HOJE, P: { ...P, juntar_automatico: ['up', 'inventory', 'catalogo'] } })
  assert.notEqual(prodDe(g, 'MLB1'), prodDe(g, 'MLB2')); assert.equal(prodDe(g, 'MLB1'), prodDe(g, 'MLB3')); assert.deepEqual(g.sugestoes.map(x => x.tipo), ['sku'])
})

ok('recusa separa o par (e cede a chave limpa ao grupo); manual vence tudo e move a origem; vínculo de outro cliente nunca entra (cada grafo é de 1 cliente)', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', sku: 'GL', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', sku: 'GL', sku_fonte: 'seller_sku' }), A('MLB3', { user_product_id: 'MLBU3', sku: 'GL', sku_fonte: 'seller_sku' }),
    A('MLB9', { user_product_id: 'MLBU9', sku: 'OUTRO', sku_fonte: 'seller_sku' })]
  const base = G(ar); assert.equal(prodDe(base, 'MLB1').nos.length, 3)
  const g = G(ar, { vinculos: [{ origem: 'up:MLBU1', produto: 'sku:gl', tipo: 'recusado' }] })
  assert.equal(prodDe(g, 'MLB2'), prodDe(g, 'MLB3')); assert.notEqual(prodDe(g, 'MLB1'), prodDe(g, 'MLB2'))
  assert.equal(prodDe(g, 'MLB2').chave, 'sku:gl', 'o grupo mantém a chave'); assert.equal(prodDe(g, 'MLB1').chave, 'sku:gl~up:MLBU1', 'o separado ganha sufixo')
  const m = G(ar, { vinculos: [{ origem: 'up:MLBU9', produto: 'sku:gl', tipo: 'manual' }] })
  assert.equal(prodDe(m, 'MLB9'), prodDe(m, 'MLB1')); assert.equal(prodDe(m, 'MLB9').chave, 'sku:gl'); assert.ok(prodDe(m, 'MLB9').motivos.includes('manual'))
  const m3 = G(ar, { vinculos: [{ origem: 'up:MLBU9', produto: 'up:MLBU2', tipo: 'manual' }] })
  assert.equal(prodDe(m3, 'MLB9'), prodDe(m3, 'MLB1')); assert.equal(prodDe(m3, 'MLB9').chave, 'sku:gl', 'apontado pelo UP, o destino mantém a chave dele (sem churn)')
  assert.equal(chaveAlvo(prodDe(g, 'MLB1')), 'up:MLBU1', 'o separado (chave com sufixo) é apontado pelo UP'); assert.equal(chaveAlvo(prodDe(g, 'MLB2')), 'sku:gl')
  const m2 = G(ar, { vinculos: [{ origem: 'up:MLBU1', produto: 'sku:outro', tipo: 'manual' }] })
  assert.equal(prodDe(m2, 'MLB1'), prodDe(m2, 'MLB9'), 'manual tira MLBU1 do grupo do SKU dele'); assert.equal(prodDe(m2, 'MLB2'), prodDe(m2, 'MLB3')); assert.notEqual(prodDe(m2, 'MLB1'), prodDe(m2, 'MLB2'))
})

ok('chave e saída determinísticas: a entrada embaralhada dá os mesmos produtos, chaves e EFs', () => {
  const ar = [A('MLB11', { user_product_id: 'MLBU5', sku: 'Z9', sku_fonte: 'seller_sku', estoque: 3 }), A('MLB12', { user_product_id: 'MLBU6', sku: 'z9', sku_fonte: 'pedido', estoque: 3 }),
    A('MLB13', { user_product_id: 'MLBU6', catalogo_produto_id: 'MLB1', estoque: 3 }), A('MLB14', { user_product_id: 'MLBU7', catalogo_produto_id: 'MLB1', logistica: 'fulfillment', inventory_id: 'I1' }),
    A('MLB15', { estoque: 2 }), A('MLB16', { user_product_id: 'MLBU8', sku: 'a1', sku_fonte: 'seller_sku', estoque: 1 })]
  const assinatura = g => JSON.stringify(g.produtos.map(p => [p.chave, p.nos.map(x => x.item_id), p.efs.map(e => [e.chave, e.estoque]), p.modo]))
  assert.equal(assinatura(G(embaralhar(ar))), assinatura(G(ar))); assert.equal(assinatura(G([...ar].reverse())), assinatura(G(ar)))
  assert.deepEqual(G(ar).produtos.map(p => [p.chave, p.nos.length]), [['item:MLB15', 1], ['sku:z9', 4], ['sku:a1', 1]], 'SKU (U5,U6) + catálogo (U6,U7) num produto só')
})

ok('Full × próprio do mesmo produto = 2 pools e 2 EFs (modo full_e_proprio): nunca somados num EF; somados no estoque do produto (para comprar)', () => {
  const g = G([A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', estoque: 3 }), A('MLB2', { user_product_id: 'MLBU1', estoque: 400 })],
    { upEstoque: [{ user_product_id: 'MLBU1', local: 'proprio', quantidade: 400, lido_em: '2026-10-14T06:00:00Z' }, { user_product_id: 'MLBU1', local: 'full', quantidade: 3, lido_em: '2026-10-14T06:00:00Z' }] })
  const p = prodDe(g, 'MLB1')
  assert.equal(p.modo, 'full_e_proprio'); assert.equal(p.pools.length, 2); assert.deepEqual(p.efs.map(e => [e.local, e.estoque]), [['full', 3], ['proprio', 400]]); assert.equal(p.estoque, 403)
  assert.equal(g.doItem.get('MLB1').ef.local, 'full'); assert.equal(g.doItem.get('MLB2').ef.local, 'proprio'); assert.ok(p.premissas.some(t => /Full e estoque próprio são estoques separados/.test(t)))
})

ok('precedência do estoque: /stock ≤ 2 d > inventário Full ≤ 2 d > anúncio só sem ambiguidade > null com o motivo (Full com Flex nunca usa o número do anúncio)', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', estoque: 400, flex: 1 })]
  const stockFull = { user_product_id: 'MLBU1', local: 'full', quantidade: 3, lido_em: '2026-10-13T06:00:00Z' }, inv = { inventory_id: 'I1', disponivel: 4, dia: '2026-10-14' }
  const pool = g => prodDe(g, 'MLB1').pools.find(p => p.local === 'full')
  assert.deepEqual([pool(G(ar, { upEstoque: [stockFull], fullEstoque: [inv] })).estoque, pool(G(ar, { upEstoque: [stockFull], fullEstoque: [inv] })).fonte], [3, 'stock'])
  assert.deepEqual([pool(G(ar, { fullEstoque: [inv] })).estoque, pool(G(ar, { fullEstoque: [inv] })).fonte], [4, 'full_inventario'])
  assert.equal(pool(G(ar, { upEstoque: [{ ...stockFull, lido_em: '2026-10-10T06:00:00Z' }], fullEstoque: [{ ...inv, dia: '2026-10-11' }] })).estoque, null, 'leituras vencidas (> 2 d) não valem')
  const semNada = G(ar); assert.equal(pool(semNada).estoque, null); assert.match(pool(semNada).motivo, /Full com Flex/); assert.equal(prodDe(semNada, 'MLB1').estoque, null, 'ausente = null, nunca 0')
  const flexSemLeitura = prodDe(semNada, 'MLB1').pools.find(p => p.local === 'proprio'); assert.ok(flexSemLeitura?.virtual, 'Flex sem leitura = estoque próprio ambíguo (pool com null)'); assert.match(flexSemLeitura.motivo, /Flex ligado/)
  const semFlex = G([A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', estoque: 7 })]); assert.deepEqual([pool(semFlex).estoque, pool(semFlex).fonte], [7, 'anuncio'], 'sem Flex e sem estoque próprio: o anúncio vale')
  const proprio = G([A('MLB2', { user_product_id: 'MLBU2', estoque: 50 }), A('MLB3', { user_product_id: 'MLBU2', logistica: 'fulfillment', estoque: 50 })])
  assert.equal(prodDe(proprio, 'MLB2').pools.find(p => p.local === 'proprio').estoque, null, 'UP com Full: o número do anúncio próprio é ambíguo sem /stock')
  const lidoZero = G(ar, { upEstoque: [stockFull, { user_product_id: 'MLBU1', local: 'proprio', quantidade: 0, lido_em: '2026-10-14T06:00:00Z' }] })
  assert.equal(prodDe(lidoZero, 'MLB1').pools.length, 1, '/stock lido sem estoque próprio: o Flex não cria pool'); assert.equal(prodDe(lidoZero, 'MLB1').estoque, 3)
})

ok('divergente: irmãos do mesmo pool com números diferentes → vale o lido mais recente, divergente_ml e aviso', () => {
  const g = G([A('MLB1', { user_product_id: 'MLBU1', estoque: 10, lido_em: '2026-10-13T05:00:00Z' }), A('MLB2', { user_product_id: 'MLBU1', estoque: 12, lido_em: '2026-10-14T05:00:00Z' })])
  const p = prodDe(g, 'MLB1'); assert.equal(p.estoque, 12); assert.equal(p.pools[0].divergente, true); assert.equal(g.avisos.length, 1)
  aplicarProduto([{ id: 'MLB1', u: 1, r: 10 }], g, { L }); assert.equal(p.pools[0].divergente, true)
})

ok('modos: um_pool, espelho_provavel (mesmo número: conta 1×), dividido (números diferentes: soma), declarado válido (F3) e vencido; premissas rotuladas', () => {
  const um = prodDe(G([A('MLB1', { estoque: 5 })]), 'MLB1'); assert.deepEqual([um.modo, um.estoque], ['um_pool', 5])
  const dois = (a, b) => [A('MLB1', { user_product_id: 'MLBU1', sku: 'S', sku_fonte: 'seller_sku', estoque: a }), A('MLB2', { user_product_id: 'MLBU2', sku: 'S', sku_fonte: 'seller_sku', estoque: b })]
  const esp = prodDe(G(dois(40, 40)), 'MLB1'); assert.deepEqual([esp.modo, esp.estoque, esp.efs.length], ['espelho_provavel', 40, 1]); assert.ok(esp.premissas.some(t => /mesmo número/.test(t)))
  const div = prodDe(G(dois(400, 10)), 'MLB1'); assert.deepEqual([div.modo, div.estoque, div.efs.length], ['dividido', 410, 2]); assert.ok(div.premissas.some(t => /números diferentes/.test(t)))
  const dec = prodDe(G(dois(40, 40), { declarado: new Map([['s', { quantidade: 60, fonte: 'cliente', em: '2026-10-12' }]]) }), 'MLB1')
  assert.deepEqual([dec.modo, dec.estoque], ['declarado', 60]); assert.ok(dec.premissas.some(t => /informado: 60 un em 12\/10/.test(t)))
  const venc = prodDe(G(dois(40, 40), { declarado: new Map([['s', { quantidade: 60, fonte: 'cliente', em: '2026-10-01' }]]) }), 'MLB1'); assert.equal(venc.modo, 'espelho_provavel', 'declaração vencida (> 7 d) é ignorada')
})

ok('anúncio com variações = 1 nó agregado (Σ estoques, venda do anúncio) que JUNTA pelo UP da variação (§ 3.5) e conta o estoque compartilhado uma vez; declarado na premissa e no aviso', () => {
  const g = G([A('MLB1', { variacao_id: '11', user_product_id: 'MLBU1', estoque: 3 }), A('MLB1', { variacao_id: '12', user_product_id: 'MLBU2', estoque: 4 }), A('MLB2', { user_product_id: 'MLBU2', estoque: 4 })])
  const p = prodDe(g, 'MLB1')
  assert.equal(p, prodDe(g, 'MLB2'), 'variação no UP de outro anúncio entra no grupo dele'); assert.deepEqual(p.motivos, ['variacao'])
  assert.equal(p.efs.length, 1, 'o agregado (UPs 1 e 2) contém o pool do MLBU2: 1 estoque, nunca 7 + 4'); assert.equal(p.estoque, 7); assert.equal(p.modo, 'um_pool')
  assert.ok(p.premissas.some(t => /variações contado inteiro/.test(t))); assert.ok(g.avisos.some(t => /venda é do anúncio inteiro/.test(t)), 'data_quality: velocidade do anúncio inteiro')
})

ok('revisão F2: variação com o MESMO UP e inventário de um anúncio de catálogo (Full, formato real do Uniaodog) = 1 produto e 1 EF Full; estoque = Σ dos inventários das variações', () => {
  const ar = [A('MLB5630314884', { variacao_id: '190089709217', user_product_id: 'MLBU3384418426', inventory_id: 'KLYA48414', logistica: 'fulfillment', flex: 1, estoque: 4 }),
    A('MLB5630314884', { variacao_id: '190089709219', user_product_id: 'MLBU3384418430', inventory_id: 'KPVG48991', logistica: 'fulfillment', flex: 1, estoque: 0 }),
    A('MLB6016719968', { user_product_id: 'MLBU3384418426', inventory_id: 'KLYA48414', logistica: 'fulfillment', flex: 1, estoque: 4, catalogo_produto_id: 'MLB24383445' })]
  const full = [{ inventory_id: 'KLYA48414', disponivel: 5, dia: HOJE }, { inventory_id: 'KPVG48991', disponivel: 2, dia: HOJE }]
  const g = G(ar, { fullEstoque: full }), p = prodDe(g, 'MLB6016719968')
  assert.equal(g.produtos.length, 1); assert.equal(p, prodDe(g, 'MLB5630314884'))
  const efFull = p.efs.filter(e => e.local === 'full')
  assert.equal(efFull.length, 1, '1 EF Full: o mesmo estoque Full nunca entra 2 vezes'); assert.equal(efFull[0].estoque, 7, 'Σ dos inventários das variações (5 + 2), com o Flex ligado')
  const lista = [{ id: 'MLB5630314884', u: 1, r: 79.89 }, { id: 'MLB6016719968', u: 4, r: 353.81 }]
  aplicarProduto(lista, g, { L })
  assert.equal(lista[1].produto.u_ef, 5, 'a venda do pai entra no EF do catálogo'); assert.equal(lista[0].produto.ef, lista[1].produto.ef)
  const so1 = G(ar, { fullEstoque: full.slice(0, 1) })
  assert.equal(prodDe(so1, 'MLB6016719968').efs.filter(e => e.local === 'full').length, 1); assert.equal(prodDe(so1, 'MLB6016719968').estoque, null, 'variação sem leitura do inventário: «—», nunca 4 + 5')
})

ok('exemplo do desenho: catálogo + clássico no mesmo UP, E = 100, vendas 56 + 84 em 28 d → cobertura 20 e ponto 140 nos dois; 1 representante', () => {
  const g = G([A('MLB1', { user_product_id: 'MLBU1', estoque: 100, catalogo_produto_id: 'MLB5' }), A('MLB2', { user_product_id: 'MLBU1', estoque: 100 })])
  const lista = [{ id: 'MLB1', u: 56, r: 560, estoque: 100, cobertura: 50, ponto_reposicao: 56, lead_time_dias: 21, lead_time_fonte: 'premissa' },
    { id: 'MLB2', u: 84, r: 840, estoque: 100, cobertura: 33, ponto_reposicao: 84, lead_time_dias: 21, lead_time_fonte: 'premissa' }]
  aplicarProduto(lista, g, { L, ligado: true })
  for (const i of lista) { assert.equal(i.cobertura, 20); assert.equal(i.ponto_reposicao, 140); assert.equal(i.produto.cobertura_ef, 20); assert.equal(i.produto.n_anuncios, 2) }
  assert.deepEqual(lista.map(i => i.cobertura_anuncio), [50, 33], 'o número antigo fica para leitura')
  assert.deepEqual(lista.map(i => i.produto.representa_estoque), [false, true], 'representante = maior receita')
  aplicarProduto(lista, g, { L, ligado: true }); assert.deepEqual(lista.map(i => i.cobertura_anuncio), [50, 33], 'idempotente')
})

ok('SOMBRA: com ligado = false nenhum campo existente do item muda (só ganha produto e cobertura_anuncio)', () => {
  const g = G([A('MLB1', { user_product_id: 'MLBU1', estoque: 100 }), A('MLB2', { user_product_id: 'MLBU1', estoque: 100 })])
  const lista = [{ id: 'MLB1', u: 56, r: 560, estoque: 100, cobertura: 50, ponto_reposicao: 56, lead_time_dias: 21 }, { id: 'MLB2', u: 84, r: 840, estoque: 100, cobertura: 33, ponto_reposicao: 84, lead_time_dias: 21 }]
  const antes = structuredClone(lista)
  aplicarProduto(lista, g, { L })
  assert.deepEqual(lista.map(({ produto, cobertura_anuncio, ...resto }) => resto), antes); assert.equal(lista[0].produto.cobertura, 20); assert.equal(lista[1].cobertura_anuncio, 33)
})

ok('85.703 × 28.410: a soma ingênua por anúncio contra o estoque contado uma vez por produto (mesmo UP em 3 anúncios + espelho em 4 UPs pelo SKU)', () => {
  const ar = [...[1, 2, 3].map(k => A(`MLB${k}`, { user_product_id: 'MLBU100', estoque: 27937 })),
    ...[4, 5, 6, 7].map(k => A(`MLB${k}`, { user_product_id: `MLBU20${k}`, sku: 'PEITORAL-H-M', sku_fonte: 'seller_sku', estoque: 473 }))]
  const g = G(ar), ingenua = ar.reduce((t, a) => t + a.estoque, 0), contado = g.produtos.reduce((t, p) => t + p.estoque, 0)
  assert.equal(ingenua, 85703); assert.equal(contado, 28410); assert.deepEqual(g.produtos.map(p => p.modo), ['um_pool', 'espelho_provavel'])
})

ok('Full + Full do mesmo SKU (2 UPs no Full) = 2 EFs que somam (fato: cada um contado pelo ML)', () => {
  const g = G([A('MLB1', { user_product_id: 'MLBU1', sku: 'T', sku_fonte: 'seller_sku', logistica: 'fulfillment', inventory_id: 'I1' }), A('MLB2', { user_product_id: 'MLBU2', sku: 'T', sku_fonte: 'seller_sku', logistica: 'fulfillment', inventory_id: 'I2' })],
    { fullEstoque: [{ inventory_id: 'I1', disponivel: 5, dia: HOJE }, { inventory_id: 'I2', disponivel: 7, dia: HOJE }] })
  const p = prodDe(g, 'MLB1'); assert.deepEqual([p.efs.length, p.estoque, p.modo], [2, 12, 'dividido']); assert.ok(p.premissas.some(t => /estoques Full separados/.test(t)))
})

ok('sugestões: título parecido (IDF ≥ 0,65) e «Kit 3un» → componente provável; recusa some com a sugestão; nunca junta', () => {
  const ar = [A('MLB1', { titulo: 'Coleira Peitoral Cachorro Ajustável Nylon Preta Tamanho M' }), A('MLB2', { titulo: 'Coleira Peitoral Cachorro Ajustável Nylon Preta M Reforçada' }),
    A('MLB3', { titulo: 'Kit 3un Cascos Luva Silicone Banho Pet' }), A('MLB4', { titulo: 'Cascos Luva Silicone Banho Pet Escova' }), A('MLB5', { titulo: 'Ração Úmida Gato Sachê Frango' })]
  const g = G(ar), s = sugerirMapeamento(g)
  const tit = s.find(x => x.tipo === 'titulo'); assert.ok(tit && /título \d+% parecido/.test(tit.motivo)); assert.deepEqual([tit.origem, tit.produto].sort(), ['item:MLB1', 'item:MLB2'])
  const kit = s.find(x => x.tipo === 'kit'); assert.ok(kit); assert.equal(kit.origem, 'item:MLB3'); assert.equal(kit.produto, 'item:MLB4'); assert.match(kit.motivo, /^Kit 3un → 3 × Cascos/)
  assert.equal(g.produtos.length, 5, 'sugestão nunca junta')
  assert.ok(!sugerirMapeamento(g, { recusas: [{ origem: tit.origem, produto: tit.produto }] }).some(x => x.tipo === 'titulo'))
})

ok('revisão F2: estoque próprio NÃO lido (null) + outro lido = modo «nao_lido» (1 EF «—»), nunca «dividido» nem «espelho», sem a premissa de números', () => {
  const g = G([A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', flex: 1, estoque: 50, sku: 'X', sku_fonte: 'seller_sku' }),
    A('MLB2', { user_product_id: 'MLBU2', estoque: 50, sku: 'X', sku_fonte: 'seller_sku' })], { fullEstoque: [{ inventory_id: 'I1', disponivel: 30, dia: HOJE }] })
  const p = prodDe(g, 'MLB1')
  assert.equal(p.modo_proprio, 'nao_lido'); assert.equal(p.modo, 'nao_lido'); assert.ok(!p.premissas.some(t => /números diferentes|mesmo número/.test(t)))
  const prop = p.efs.filter(e => e.local === 'proprio'); assert.equal(prop.length, 1); assert.equal(prop[0].estoque, null); assert.equal(p.estoque, null)
  assert.ok(p.premissas.some(t => /não foi lido por local/.test(t)))
})

ok('revisão F2: juntar a sku:b leva a origem ao produto cuja CHAVE é sku:b — não ao primeiro que tem o SKU b entre vários', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', sku: 'A', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB100', estoque: 10 }),
    A('MLB2', { user_product_id: 'MLBU1', sku: 'B', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB100', estoque: 10 }),
    A('MLB3', { user_product_id: 'MLBU2', sku: 'B', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB200', estoque: 10 }), A('MLB4', { user_product_id: 'MLBU3', estoque: 10 })]
  const g0 = G(ar), alvo = chaveAlvo(prodDe(g0, 'MLB3'))
  assert.deepEqual([prodDe(g0, 'MLB1').chave, alvo], ['sku:a', 'sku:b'], 'o produto de MLB1+MLB2 tem 2 SKUs (a, b); o de MLB3 tem a chave sku:b')
  const g = G(ar, { vinculos: [{ origem: 'up:MLBU3', produto: alvo, tipo: 'manual' }] })
  assert.equal(prodDe(g, 'MLB4'), prodDe(g, 'MLB3')); assert.equal(prodDe(g, 'MLB4').chave, 'sku:b'); assert.deepEqual(prodDe(g, 'MLB1').nos.map(n => n.item_id), ['MLB1', 'MLB2'])
})

ok('revisão F2: o mesmo número redondo (ou a ≤ 1% dele) em 2+ estoques próprios na mesma data = nota «provável estoque de cadastro» (premissa + aviso); a conta não muda', () => {
  const ar = ['400', '397', '400'].map((e, k) => A(`MLB${k + 1}`, { user_product_id: `MLBU${k + 1}`, estoque: Number(e), sku: 'GUIA-M', sku_fonte: 'seller_sku' }))
  const g = G(ar), p = prodDe(g, 'MLB1')
  assert.equal(p.modo, 'dividido'); assert.equal(p.estoque, 1197, 'soma como antes')
  assert.ok(p.premissas.some(t => /provável estoque de cadastro/.test(t))); assert.ok(g.avisos.some(t => /provável estoque de cadastro \(sku:guia-m\)/.test(t)))
  const q = prodDe(G([A('MLB1', { user_product_id: 'MLBU1', estoque: 37, sku: 'Z', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', estoque: 12, sku: 'Z', sku_fonte: 'seller_sku' })]), 'MLB1')
  assert.ok(!q.premissas.some(t => /cadastro/.test(t)), 'números quaisquer: sem a nota')
})

console.log(`\n✔ teste-produto-estoque: ${n} casos`)
