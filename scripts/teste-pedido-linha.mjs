// Autoteste da F1 da V3 (docs/desenho-v3-produto-estoque-financeiro.md § 1.2 e § 2.3): linhas de pedido em meli_pedido_item, gravadas dos MESMOS
// pedidos que a coleta da série já busca (zero chamada a mais), na MESMA transação que zera e regrava o dia, com a invariante Σ linhas = série.
// Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports); a API é um fetch falso com o FORMATO REAL do /orders/search do Uniaodog
// (scratchpad v3/api/07-orders-search.json, 14/10/2026; aparado, sem buyer, sem payer, sem token).
// Rodar: node scripts/teste-pedido-linha.mjs
process.env.PS_DB_MEMORIA = '1'
globalThis.fetch = () => Promise.reject(new Error('rede bloqueada no teste'))
import assert from 'node:assert/strict'
const { db, hojeLocal } = await import('../src/lib/db.js')
const { cifrar } = await import('../src/lib/cripto.js')
const S = await import('../src/lib/meli-serie.js')
const { linhasDoPedido, ratearPorReceita, conferirLinhasComSerie } = await import('../src/lib/produto-estoque.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }

// ── pedidos reais (aparados) ──
const ESTOQUE = { node_id: 'BRP6158754031', store_id: '86161652' }
const pag = (valor, o = {}) => ({ status: 'approved', transaction_amount: valor, transaction_amount_refunded: 0, coupon_amount: 0, shipping_cost: 0, ...o })
const linha = (id, o = {}) => ({ quantity: 1, unit_price: 0, sale_fee: 0, listing_type_id: 'gold_special', stock: ESTOQUE, ...o, item: { id, variation_id: null, seller_sku: null, seller_custom_field: null, ...o.item } })
const P1 = { id: 2000018978910976, status: 'paid', pack_id: null, shipping: { id: 48257561912 }, order_items: [linha('MLB4612661755', { unit_price: 71.24, sale_fee: 8.46 })], payments: [pag(71.24, { coupon_amount: 3.56 })] }
const P2 = { id: 2000018978436284, status: 'paid', pack_id: 2000015523333281, shipping: { id: 48256982091 }, order_items: [linha('MLB6599833678', { quantity: 2, unit_price: 54.52, sale_fee: 6.7, item: { seller_sku: 'COLEIRA-P/M' } })], payments: [pag(109.04)] }
const P3 = { id: 2000018978423886, status: 'paid', pack_id: 2000015523333281, shipping: { id: 48256982091 }, order_items: [linha('MLB5943664742', { unit_price: 91.6, sale_fee: 15.41, listing_type_id: 'gold_pro', item: { variation_id: 193087451151, seller_sku: 'PEITORALH-2-M-ROCK', seller_custom_field: 'PEITORALH-2-M' } })], payments: [pag(91.6)] }
const P4 = { id: 2000018978436282, status: 'paid', pack_id: 2000015523333281, shipping: { id: 48256982091 }, order_items: [linha('MLB6756024752', { unit_price: 129.74, sale_fee: 15.94 })], payments: [pag(129.74)] }
const P5 = { id: 2000018971671320, status: 'paid', pack_id: 2000015517015871, shipping: { id: 48253972400 }, order_items: [linha('MLB4921757403', { quantity: 2, unit_price: 36.47, sale_fee: 11.21, item: { seller_sku: 'TRAN-NATK-M' } })], payments: [pag(72.94)] }

await ok('pedido real de 1 linha: 7124 c, tarifa 846 c como veio, envio, depósito e cupom preservados', () => {
  assert.deepEqual(linhasDoPedido(P1, '2026-10-14'), [{ order_id: '2000018978910976', item_id: 'MLB4612661755', variacao_id: '', quantidade: 1, preco_unit_c: 7124, tarifa_c: 846, tipo_anuncio: 'gold_special',
    seller_sku: '', deposito_node: 'BRP6158754031', deposito_store: '86161652', dia: '2026-10-14', envio_id: '48257561912', pack_id: '', cupom_c: 356, reembolso_c: 0, status: 'paid' }])
  const [v] = linhasDoPedido(P3, '2026-10-14')
  assert.deepEqual([v.variacao_id, v.seller_sku, v.tipo_anuncio, v.pack_id], ['193087451151', 'PEITORALH-2-M-ROCK', 'gold_pro', '2000015523333281'])
  assert.equal(linhasDoPedido(P2, 'd')[0].tarifa_c, 670, 'q=2: o sale_fee fica COMO VEIO (a semântica por unidade é premissa da F4)')
})

await ok('ausente = NULL, nunca 0: sem sale_fee, sem payments ou payment sem o número', () => {
  const [a] = linhasDoPedido({ ...P1, order_items: [{ ...P1.order_items[0], sale_fee: undefined }], payments: [] }, 'd')
  assert.equal(a.tarifa_c, null); assert.equal(a.cupom_c, null); assert.equal(a.reembolso_c, null)
  const [b] = linhasDoPedido({ ...P1, payments: [pag(71.24, { coupon_amount: null })] }, 'd')
  assert.equal(b.cupom_c, null); assert.equal(b.reembolso_c, 0)
  const [c] = linhasDoPedido({ ...P1, payments: [pag(71.24, { status: 'rejected', coupon_amount: 9 }), pag(71.24, { coupon_amount: 1.5 })] }, 'd')
  assert.equal(c.cupom_c, 150, 'pagamento recusado não conta')
})

await ok('cupom e reembolso rateados pela receita das linhas do pedido com Σ exato (resto na maior linha); linha repetida é somada', () => {
  assert.deepEqual(ratearPorReceita(815, [10904, 9160, 12974]), [268, 225, 322]); assert.equal(ratearPorReceita(815, [10904, 9160, 12974]).reduce((s, x) => s + x), 815)
  assert.deepEqual(ratearPorReceita(5, [0, 0]), [5, 0]); assert.deepEqual(ratearPorReceita(7, []), [])
  const p = { ...P2, order_items: [linha('MLB1', { unit_price: 10, sale_fee: 1 }), linha('MLB2', { quantity: 2, unit_price: 25, sale_fee: 3 }), linha('MLB1', { quantity: 2, unit_price: 10, sale_fee: 1 })],
    payments: [pag(90, { coupon_amount: 1, transaction_amount_refunded: 0.07 }), pag(0, { coupon_amount: 0.01 })] }
  const l = linhasDoPedido(p, 'd')
  assert.deepEqual(l.map(x => [x.item_id, x.quantidade, x.preco_unit_c, x.tarifa_c]), [['MLB1', 3, 1000, 100], ['MLB2', 2, 2500, 300]])
  assert.equal(l.reduce((s, x) => s + x.cupom_c, 0), 101); assert.equal(l.reduce((s, x) => s + x.reembolso_c, 0), 7)
  const m = linhasDoPedido({ ...P1, order_items: [linha('MLB1', { unit_price: 10, sale_fee: 1 }), linha('MLB1', { unit_price: 12, sale_fee: 2 })] }, 'd')
  assert.deepEqual(m.map(x => [x.quantidade, x.preco_unit_c, x.tarifa_c]), [[2, 1100, null]], 'preços diferentes = média; tarifas diferentes = NULL (nunca soma)')
  assert.deepEqual(linhasDoPedido({ ...P1, order_items: [linha('MLB1', { quantity: 0, unit_price: 5 }), { quantity: 1, unit_price: 5 }] }, 'd'), [], 'quantidade 0 e item sem id: fora (como na série)')
})

await ok('invariante pura: Σ linhas = série (±1 centavo por linha) e unidades exatas', () => {
  const l = [P1, P2, P3, P4, P5].flatMap(p => linhasDoPedido(p, 'd'))
  const serie = new Map([['MLB4612661755', { u: 1, r: 71.24 }], ['MLB6599833678', { u: 2, r: 109.04 }], ['MLB5943664742', { u: 1, r: 91.6 }], ['MLB6756024752', { u: 1, r: 129.74 }], ['MLB4921757403', { u: 2, r: 72.94 }]])
  assert.deepEqual(conferirLinhasComSerie(l, serie), [])
  assert.deepEqual(conferirLinhasComSerie(l, new Map([...serie, ['MLB4921757403', { u: 2, r: 72.96 }]])), ['MLB4921757403'], '2 centavos numa linha = furo')
  assert.deepEqual(conferirLinhasComSerie(l, new Map([...serie, ['MLB4921757403', { u: 3, r: 72.94 }]])), ['MLB4921757403'], 'unidade a mais = furo')
  assert.deepEqual(conferirLinhasComSerie(l, new Map([...serie, ['MLB9', { u: 1, r: 1 }]])), ['MLB9'], 'venda na série sem linha = furo')
})

// ── coleta de verdade (coletarPedidos → chamar → fetch falso) ──
const CLI = 'Conta Pedidos', HOJE = hojeLocal(), ONTEM = S.addDias(HOJE, -1)
db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id) VALUES (?, 77, 'n', ?, ?, ?, '', ?, ?, '', '')`)
  .run(CLI, cifrar('AT-teste'), cifrar('RT-teste'), new Date(Date.now() + 6 * 3600e3).toISOString(), new Date().toISOString(), new Date().toISOString())
let porDia = {}, chamadas = 0
globalThis.fetch = async url => {
  const u = new URL(String(url)); chamadas++
  assert.equal(u.pathname, '/orders/search', 'a F1 não faz chamada nova: só a busca de pedidos que a série já fazia')
  const dia = u.searchParams.get('order.date_created.from').slice(0, 10), r = porDia[dia]
  if (r === 'falha') return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad request' }
  const b = { results: r || [], paging: { total: (r || []).length, offset: 0, limit: 50 } }
  return { ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) }
}
const linhasDe = dia => db.prepare('SELECT order_id, item_id, variacao_id, quantidade, preco_unit_c, tarifa_c, envio_id, status FROM meli_pedido_item WHERE cliente = ? AND dia = ? ORDER BY order_id, item_id').all(CLI, dia)
const diaCol = dia => db.prepare('SELECT pedidos, linhas FROM meli_coleta_dia WHERE cliente = ? AND dia = ?').get(CLI, dia)
const serieDe = dia => db.prepare('SELECT item_id, unidades, receita FROM meli_serie_item WHERE cliente = ? AND dia = ? ORDER BY item_id').all(CLI, dia)

await ok('coletarPedidos grava as linhas na MESMA rodada da série; pacote de 3 pedidos com 1 envio = 3 linhas com o mesmo envio_id; marca linhas = 1', async () => {
  porDia = { [HOJE]: [P1, P2, P3, P4, P5] }
  const r = await S.coletarPedidos(CLI, HOJE, HOJE)
  assert.deepEqual(r, { dias: 1, falhas: [] }); assert.equal(chamadas, 1)
  assert.equal(linhasDe(HOJE).length, 5)
  assert.deepEqual(linhasDe(HOJE).filter(l => l.envio_id === '48256982091').map(l => [l.quantidade, l.preco_unit_c]).sort((x, y) => x[1] - y[1]), [[2, 5452], [1, 9160], [1, 12974]])
  assert.deepEqual(diaCol(HOJE), { pedidos: 5, linhas: 1 })
  // invariante contra o que FOI gravado na série
  const serie = new Map(serieDe(HOJE).map(s => [s.item_id, { u: s.unidades, r: s.receita }]))
  assert.deepEqual(conferirLinhasComSerie(db.prepare('SELECT item_id, quantidade, preco_unit_c FROM meli_pedido_item WHERE cliente = ? AND dia = ?').all(CLI, HOJE), serie), [])
})

await ok('recoleta é idempotente (substitui, não soma); linha cancelled nunca é apagada pelo DELETE do dia; pedido que SUMIU da busca de pagos vira «cancelled» (revisão F4)', async () => {
  db.prepare("INSERT INTO meli_pedido_item (cliente, order_id, item_id, variacao_id, dia, quantidade, preco_unit_c, status, coletado_em) VALUES (?, '999', 'MLB7', '', ?, 1, 500, 'cancelled', 'x')").run(CLI, HOJE)
  porDia = { [HOJE]: [P1, P3, P4, P5] }                    // P2 sumiu da busca de pagos (cancelado até D+2): a linha fica, como cancelled
  await S.coletarPedidos(CLI, HOJE, HOJE)
  assert.deepEqual(linhasDe(HOJE).map(l => [l.order_id, l.status]), [['2000018971671320', 'paid'], ['2000018978423886', 'paid'], ['2000018978436282', 'paid'], ['2000018978436284', 'cancelled'], ['2000018978910976', 'paid'], ['999', 'cancelled']])
  await S.coletarPedidos(CLI, HOJE, HOJE)
  assert.equal(linhasDe(HOJE).length, 6, 'mesma resposta, mesmas linhas')
  assert.equal(serieDe(HOJE).find(s => s.item_id === 'MLB6599833678').unidades, 0, 'a série segue como sempre (dia recoletado zera e regrava)')
})

await ok('linhas que não batem com a série (preços diferentes somados, arredondamento > 1 c): o dia fica SEM linhas (linhas = 0), a série é gravada igual e o aviso vai ao log', async () => {
  const torto = { ...P1, id: 77, order_items: [linha('MLB8', { quantity: 3, unit_price: 10, sale_fee: 1 }), linha('MLB8', { quantity: 3, unit_price: 10.05, sale_fee: 1 })], payments: [pag(60.15)] }
  porDia = { [HOJE]: [P1, torto] }
  await S.coletarPedidos(CLI, HOJE, HOJE)
  assert.deepEqual(linhasDe(HOJE).map(l => [l.order_id, l.status]), [['2000018971671320', 'cancelled'], ['2000018978423886', 'cancelled'], ['2000018978436282', 'cancelled'], ['2000018978436284', 'cancelled'], ['999', 'cancelled']],
    'linhas pagas do dia apagadas, nenhuma gravada; as canceladas ficam (os 4 pedidos que sumiram da busca de pagos viraram «cancelled» — revisão F4)')
  assert.deepEqual(diaCol(HOJE), { pedidos: 2, linhas: 0 })
  assert.deepEqual(serieDe(HOJE).filter(s => s.unidades).map(s => [s.item_id, s.unidades, s.receita]), [['MLB4612661755', 1, 71.24], ['MLB8', 6, 60.15]])
  assert.match(db.prepare("SELECT msg FROM sync_log WHERE nivel = 'aviso' ORDER BY rowid DESC LIMIT 1").get().msg, /linhas de pedido Conta Pedidos .*1 anúncio\(s\) não batem com a série/)
})

await ok('dia com falha na busca não é marcado (nem linhas): lacuna declarada, como a série', async () => {
  porDia = { [ONTEM]: 'falha', [HOJE]: [P1] }
  db.prepare('DELETE FROM meli_coleta_dia WHERE cliente = ?').run(CLI)
  const r = await S.coletarPedidos(CLI, ONTEM, HOJE)
  assert.equal(r.falhas.length, 1); assert.equal(r.falhas[0].dia, ONTEM)
  assert.equal(diaCol(ONTEM), undefined); assert.equal(linhasDe(ONTEM).length, 0)
  assert.deepEqual(diaCol(HOJE), { pedidos: 1, linhas: 1 })
})

await ok('dia anterior à F1 continua com linhas = 0 (lucro «não coletado», nunca zero): a coluna nasce 0', async () => {
  db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?, '2026-01-01', 4, 0, '2026-01-02T00:00:00.000Z')").run(CLI)
  assert.equal(diaCol('2026-01-01').linhas, 0)
})

console.log(`\n${n} casos ok — linhas de pedido (V3 F1)`)
