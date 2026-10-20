// Autoteste da F1 da V3 (docs/desenho-v3-produto-estoque-financeiro.md § 1.1 e § 2.2): chaves do produto por anúncio/variação em meli_anuncio_up,
// gravadas na MESMA transação de gravarItens (sem chamada a mais ao ML). Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports), rede bloqueada;
// corpos com o FORMATO REAL do /items/bulk lido no Uniaodog em 14/10/2026 (scratchpad v3/f1/f1-bulk-novo.json, aparados; sem token, sem buyer).
// Rodar: node scripts/teste-anuncio-up.mjs
process.env.PS_DB_MEMORIA = '1'
globalThis.fetch = () => Promise.reject(new Error('rede bloqueada no teste'))
import assert from 'node:assert/strict'
const { db } = await import('../src/lib/db.js')
const S = await import('../src/lib/meli-serie.js')
const { arestasDoAnuncio, chaveSku, resolverSku } = await import('../src/lib/produto-estoque.js')
const PC = await import('../src/lib/promocoes-coleta.js')
const { TABELAS_SERIE, limparSerieDoCliente } = await import('../src/lib/meli-contas.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }

// ── corpos reais (aparados) ──
const GUBELLA = { id: 'MLB3601262873', title: 'Guia Unificada Bella Coleira União Dog 15mm Azul-claro', status: 'active', available_quantity: 3, catalog_listing: false, catalog_product_id: 'MLB26091235', user_product_id: 'MLBU3455477126', inventory_id: 'IKDT11460', seller_custom_field: null,
  shipping: { logistic_type: 'fulfillment', tags: ['self_service_in', 'mandatory_free_shipping'] }, tags: ['good_quality_thumbnail', 'user_product_listing', 'immediate_payment', 'cart_eligible'], attributes: [{ id: 'BRAND', value_name: 'Uniãodog' }, { id: 'SELLER_SKU', value_name: 'GUBELLA-5' }], variations: [] }
const GUBELLA_CAT = { ...GUBELLA, id: 'MLB5751083964', title: 'Guia Unificada Bella 15mm Azul-claro', catalog_listing: true, tags: ['immediate_payment', 'cart_eligible'] }   // catálogo + clássico: MESMO UP e MESMO inventory_id
const KIT = { id: 'MLB7050534654', title: 'Cascos Bovino Natural Luv Kit 3un Grande Mordedor Para Cães', status: 'active', available_quantity: 2, catalog_listing: true, catalog_product_id: 'MLB44794367', user_product_id: 'MLBU3732810550', inventory_id: 'SMCE30384', seller_custom_field: null,
  shipping: { logistic_type: 'fulfillment', tags: ['self_service_in'] }, tags: ['kit_component', 'immediate_payment', 'cart_eligible'], attributes: [{ id: 'SELLER_SKU', value_name: 'CASC-LUV-KIT3' }], variations: [] }
const TRANCA_XD = { id: 'MLB7476654566', title: 'Trança De Pele Bovina Tam M', status: 'active', available_quantity: 22, catalog_listing: true, catalog_product_id: 'MLB42961226', user_product_id: 'MLBU4863548833', inventory_id: null, seller_custom_field: null,
  shipping: { logistic_type: 'xd_drop_off', tags: ['self_service_out', 'self_service_available'] }, tags: ['immediate_payment', 'cart_eligible'], attributes: [{ id: 'SELLER_SKU', value_name: 'TRAN-NATK-M' }], variations: [] }
const GUIA_195 = { id: 'MLB4455125354', title: 'Guia Coleira Unificada Cachorros 1.80cm União Dog Pet Cães', status: 'active', available_quantity: 2799, catalog_listing: false, catalog_product_id: null, user_product_id: null, inventory_id: null, seller_custom_field: '195',
  shipping: { logistic_type: 'xd_drop_off', tags: ['self_service_in', 'mandatory_free_shipping'] }, tags: ['standard_price_by_quantity', 'good_quality_thumbnail'], attributes: [{ id: 'BRAND', value_name: 'Uniãodog' }],
  variations: [{ id: 189920381297, available_quantity: 399, seller_custom_field: null, catalog_product_id: null, inventory_id: null, user_product_id: 'MLBU3369871723' }, { id: 191520759199, available_quantity: 400, seller_custom_field: null, catalog_product_id: null, inventory_id: 'LLTI04821', user_product_id: 'MLBU3475893382' }] }
const PEITORAL = { id: 'MLB5943664742', title: 'Peitoral H | Tamanho M | Porte Médio |  Ajuste Anti-escape', status: 'active', available_quantity: 4993, catalog_listing: false, catalog_product_id: null, user_product_id: null, inventory_id: null, seller_custom_field: 'PEITORALH-2-M',
  shipping: { logistic_type: 'xd_drop_off', tags: ['self_service_in', 'mandatory_free_shipping'] }, tags: ['good_quality_thumbnail'], attributes: [{ id: 'BRAND', value_name: 'Uniãodog' }],
  variations: [{ id: 193087451151, available_quantity: 993, seller_custom_field: '', catalog_product_id: null, inventory_id: null, user_product_id: 'MLBU3571287796' }, { id: 193087451153, available_quantity: 1000, seller_custom_field: '', catalog_product_id: null, inventory_id: null, user_product_id: 'MLBU3571287800' }] }

const arestas = cli => db.prepare('SELECT item_id, variacao_id, user_product_id, inventory_id, sku, sku_fonte, catalogo_produto_id, estoque, logistica, flex, tags, status FROM meli_anuncio_up WHERE cliente = ? ORDER BY item_id, variacao_id').all(cli)
const de = (cli, item) => arestas(cli).filter(a => a.item_id === item)

ok('anúncio sem variação: 1 aresta com UP, inventory_id, SELLER_SKU oficial, catálogo, estoque, logística e flex', () => {
  assert.deepEqual(arestasDoAnuncio(GUBELLA), [{ item_id: 'MLB3601262873', logistica: 'fulfillment', flex: 1, tags: 'user_product_listing', status: 'active', variacao_id: '',
    user_product_id: 'MLBU3455477126', inventory_id: 'IKDT11460', sku: 'GUBELLA-5', sku_fonte: 'seller_sku', catalogo_produto_id: 'MLB26091235', estoque: 3 }])
  const [x] = arestasDoAnuncio(TRANCA_XD)
  assert.equal(x.flex, 0, 'self_service_out não é Flex'); assert.equal(x.inventory_id, '', 'fora do Full: sem inventory_id'); assert.equal(x.logistica, 'xd_drop_off')
})

ok('variações: 1 aresta por variação com o UP e o inventory_id DELA; o anúncio-pai não gera aresta própria nem empresta SKU/catálogo', () => {
  const v = arestasDoAnuncio(GUIA_195)
  assert.deepEqual(v.map(a => [a.variacao_id, a.user_product_id, a.inventory_id, a.estoque]), [['189920381297', 'MLBU3369871723', '', 399], ['191520759199', 'MLBU3475893382', 'LLTI04821', 400]])
  assert.ok(v.every(a => a.sku === '' && a.sku_fonte === ''), 'seller_custom_field do PAI («195») não desce para a variação')
  const p = arestasDoAnuncio({ ...PEITORAL, attributes: [{ id: 'SELLER_SKU', value_name: 'PEITORALH-PAI' }], catalog_product_id: 'MLB1' })
  assert.ok(p.every(a => a.sku === '' && a.catalogo_produto_id === ''), 'SKU e catálogo do pai são da família: juntariam tamanhos diferentes')
  const comSku = arestasDoAnuncio({ ...PEITORAL, variations: [{ ...PEITORAL.variations[0], attributes: [{ id: 'SELLER_SKU', value_name: 'PEITORALH-2-M-ROCK' }] }, { ...PEITORAL.variations[1], seller_custom_field: 'PH-SCF' }] })
  assert.deepEqual(comSku.map(a => [a.sku, a.sku_fonte]), [['PEITORALH-2-M-ROCK', 'variacao'], ['PH-SCF', 'seller_custom_field']])
})

ok('SELLER_SKU oficial vence seller_custom_field; só seller_custom_field = fonte seller_custom_field (nunca agrupa); sem nada = vazio', () => {
  assert.deepEqual(arestasDoAnuncio({ ...GUBELLA, seller_custom_field: 'OUTRO' }).map(a => [a.sku, a.sku_fonte]), [['GUBELLA-5', 'seller_sku']])
  assert.deepEqual(arestasDoAnuncio({ ...GUBELLA, attributes: [], seller_custom_field: '  CADES-2-M ' }).map(a => [a.sku, a.sku_fonte]), [['CADES-2-M', 'seller_custom_field']])
  assert.deepEqual(arestasDoAnuncio({ ...GUBELLA, attributes: [{ id: 'SELLER_SKU', value_name: '  ' }], seller_custom_field: '' }).map(a => [a.sku, a.sku_fonte]), [['', '']])
  assert.equal(chaveSku('  Coleira-P/M '), 'coleira-p/m'); assert.notEqual(chaveSku('KIT-2'), chaveSku('KIT2'), 'hífen NÃO some (não é skuForte)')
})

ok('sem UP lido: user_product_id vazio (vira pool item: na F2); estoque ausente = NULL, nunca 0; corpo sem id = nenhuma aresta', () => {
  const [x] = arestasDoAnuncio({ id: 'MLB9', status: 'active' })
  assert.equal(x.user_product_id, ''); assert.equal(x.estoque, null); assert.equal(x.flex, 0); assert.equal(x.tags, '')
  assert.deepEqual(arestasDoAnuncio({ title: 'sem id' }), [])
  assert.equal(arestasDoAnuncio({ ...GUBELLA, available_quantity: 0 })[0].estoque, 0, 'zero lido é zero')
  assert.equal(arestasDoAnuncio({ ...PEITORAL, variations: [{ user_product_id: 'MLBU1' }] }).length, 1, 'variação sem id é ignorada: sobra a aresta do anúncio')
})

ok('tags: só a lista fechada (bundle, kit_component, user_product_listing)', () => {
  assert.equal(arestasDoAnuncio(KIT)[0].tags, 'kit_component')
  assert.equal(arestasDoAnuncio({ ...KIT, tags: ['bundle', 'catalog_boost', 'user_product_listing', 'immediate_payment'] })[0].tags, 'bundle,user_product_listing')
})

ok('gravarItens grava as arestas: catálogo + clássico do MESMO UP e inventory_id (o grupo real do Uniaodog)', () => {
  S.gravarItens('Cli A', [GUBELLA, GUBELLA_CAT, KIT, GUIA_195], { t: '2026-10-14T10:00:00.000Z', dia: '2026-10-14' })
  const a = arestas('Cli A')
  assert.equal(a.length, 5, '3 anúncios sem variação + 2 variações')
  assert.deepEqual([...new Set(a.filter(x => x.user_product_id === 'MLBU3455477126').map(x => x.item_id))], ['MLB3601262873', 'MLB5751083964'])
  assert.ok(a.filter(x => x.inventory_id === 'IKDT11460').length === 2)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_item WHERE cliente = ?').get('Cli A').n, 4, 'meli_item continua 1 linha por anúncio')
})

ok('releitura do anúncio apaga e regrava SÓ as linhas dele; anúncio que sai da listagem guarda as últimas (costura a migração do ML)', () => {
  S.gravarItens('Cli A', [{ ...GUIA_195, variations: [GUIA_195.variations[1]] }, { ...GUBELLA, available_quantity: 1 }], { t: '2026-10-15T10:00:00.000Z', dia: '2026-10-15' })
  assert.deepEqual(de('Cli A', 'MLB4455125354').map(a => a.variacao_id), ['191520759199'], 'variação que sumiu do anúncio sai')
  assert.equal(de('Cli A', 'MLB3601262873')[0].estoque, 1)
  assert.equal(de('Cli A', 'MLB5751083964').length, 1, 'irmão não lido nesta rodada mantém a aresta')
  assert.equal(db.prepare("SELECT lido_em FROM meli_anuncio_up WHERE cliente = 'Cli A' AND item_id = 'MLB5751083964'").get().lido_em, '2026-10-14T10:00:00.000Z')
})

ok('aresta e change-log na MESMA transação: falha na aresta não grava nada pela metade (nem meli_item, nem meli_item_mudanca)', () => {
  const antes = JSON.stringify([db.prepare("SELECT * FROM meli_item WHERE cliente = 'Cli A' ORDER BY item_id").all(), db.prepare("SELECT * FROM meli_item_mudanca WHERE cliente = 'Cli A'").all(), arestas('Cli A')])
  db.exec("CREATE TEMP TRIGGER falha_aresta BEFORE INSERT ON meli_anuncio_up WHEN NEW.item_id = 'MLB7050534654' BEGIN SELECT RAISE(ABORT, 'falha simulada'); END")
  assert.throws(() => S.gravarItens('Cli A', [{ ...GUBELLA, price: 99, available_quantity: 0 }, KIT], { t: '2026-10-16T10:00:00.000Z', dia: '2026-10-16' }), /falha simulada/)
  db.exec('DROP TRIGGER falha_aresta')
  assert.equal(JSON.stringify([db.prepare("SELECT * FROM meli_item WHERE cliente = 'Cli A' ORDER BY item_id").all(), db.prepare("SELECT * FROM meli_item_mudanca WHERE cliente = 'Cli A'").all(), arestas('Cli A')]), antes)
})

ok('camada SKU da VENDA: sem SELLER_SKU oficial, o seller_sku mais recente do pedido (mesmo anúncio + variação) vira sku_fonte pedido; oficial nunca é trocado', () => {
  const ins = db.prepare("INSERT INTO meli_pedido_item (cliente, order_id, item_id, variacao_id, dia, quantidade, preco_unit_c, seller_sku, coletado_em) VALUES ('Cli B', ?, ?, ?, ?, 1, 9160, ?, 'x')")
  ins.run('1', 'MLB5943664742', '193087451151', '2026-10-10', 'PEITORALH-ANTIGO'); ins.run('2', 'MLB5943664742', '193087451151', '2026-10-14', 'PEITORALH-2-M-ROCK')
  ins.run('3', 'MLB3601262873', '', '2026-10-14', 'SKU-DA-VENDA'); ins.run('4', 'MLB4455125354', '', '2026-10-14', 'SKU-NIVEL-ITEM')
  S.gravarItens('Cli B', [PEITORAL, GUBELLA, { ...GUIA_195, variations: [], seller_custom_field: '195' }], { t: '2026-10-14T10:00:00.000Z', dia: '2026-10-14' })
  assert.deepEqual(de('Cli B', 'MLB5943664742').map(a => [a.variacao_id, a.sku, a.sku_fonte]), [['193087451151', 'PEITORALH-2-M-ROCK', 'pedido'], ['193087451153', '', '']], 'a mais recente vence; variação sem venda fica sem SKU')
  assert.deepEqual(de('Cli B', 'MLB3601262873').map(a => [a.sku, a.sku_fonte]), [['GUBELLA-5', 'seller_sku']], 'SELLER_SKU oficial do anúncio vence a venda')
  assert.deepEqual(de('Cli B', 'MLB4455125354').map(a => [a.sku, a.sku_fonte]), [['SKU-NIVEL-ITEM', 'pedido']], 'SKU da venda vence o seller_custom_field (que nunca agrupa)')
})

ok('isolamento: o mesmo anúncio em 2 clientes nunca se mistura; a troca de conta limpa as arestas e as linhas só do cliente', () => {
  S.gravarItens('Cli C', [{ ...GUBELLA, available_quantity: 77 }], { t: '2026-10-14T11:00:00.000Z', dia: '2026-10-14' })
  assert.equal(de('Cli A', 'MLB3601262873')[0].estoque, 1); assert.equal(de('Cli C', 'MLB3601262873')[0].estoque, 77)
  assert.ok(TABELAS_SERIE.includes('meli_anuncio_up') && TABELAS_SERIE.includes('meli_pedido_item'))
  limparSerieDoCliente('Cli B', 'teste')
  assert.equal(arestas('Cli B').length, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM meli_pedido_item WHERE cliente = 'Cli B'").get().n, 0)
  assert.equal(arestas('Cli A').length, 4, 'outro cliente intacto')
})

ok('resolverSku saiu de promocoes-coleta para produto-estoque SEM mudar a precedência (reexportada)', () => {
  assert.equal(PC.resolverSku, resolverSku)
  assert.deepEqual(resolverSku({ attributes: [], seller_custom_field: 'SCF', variations: [{ attributes: [{ id: 'SELLER_SKU', value_name: 'VAR' }] }] }), { sku: 'SCF', fonte: 'seller_custom_field' })
})

console.log(`\n${n} casos ok — chaves do produto por anúncio/variação (V3 F1)`)
