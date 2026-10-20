// Autoteste da coleta e da leitura do financeiro da V3 F4 (src/lib/lucro-real.js + meli-serie.js: completarLinhas e marcarCancelados; desenho § 2.3, § 2.5, § 5 e § 9 F4):
// frete por envio com teto e pendente na falha (nunca 0), recoleta sem duplicar, cancelados marcados (e nunca apagados pelo DELETE do dia), linhas de dia fechado com a
// invariante de TETO, e o lucro de ponta a ponta — pedido com frete, cupom, cancelado, sem custo, cobertura < 80% — mais o DRE. Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes
// dos imports); a API é falsa com o FORMATO REAL (scratchpad v3/api/09-shipment-costs.json, v3/f4/api/*.json, 14/10/2026). Nenhuma chamada ao ML.
// Rodar: node scripts/teste-financeiro-coleta.mjs
process.env.PS_DB_MEMORIA = '1'
globalThis.fetch = () => Promise.reject(new Error('rede bloqueada no teste'))
import assert from 'node:assert/strict'
const { db, hojeLocal } = await import('../src/lib/db.js')
const { cifrar } = await import('../src/lib/cripto.js')
const S = await import('../src/lib/meli-serie.js')
const R = await import('../src/lib/lucro-real.js')
const P = await import('../src/lib/promocoes-db.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = hojeLocal(), D = k => S.addDias(HOJE, k), CLI = 'Conta Financeiro', OUTRO = 'Outro Cliente', T = new Date().toISOString()
const insLinha = db.prepare(`INSERT INTO meli_pedido_item (cliente, order_id, item_id, variacao_id, dia, quantidade, preco_unit_c, tarifa_c, seller_sku, envio_id, cupom_c, reembolso_c, status, coletado_em)
  VALUES (@cliente, @order_id, @item_id, '', @dia, @quantidade, @preco_unit_c, @tarifa_c, @seller_sku, @envio_id, @cupom_c, @reembolso_c, @status, 'x')`)
const linha = o => insLinha.run({ cliente: CLI, quantidade: 1, tarifa_c: 1000, seller_sku: '', cupom_c: 0, reembolso_c: 0, status: 'paid', ...o })
const custos = senders => ({ receiver: { cost: 0 }, gross_amount: 29.14, senders })
const REAL = custos([{ cost: 8.15, discounts: [{ rate: 0.3, type: 'mandatory', promoted_amount: 3.49 }], user_id: 1, charges: { charge_flex: 0 } }])
const PACOTE = custos([{ cost: 48.3, discounts: [{ rate: 0.45, type: 'mandatory', promoted_amount: 38.98 }] }])
const envio = id => db.prepare('SELECT custo_vendedor_c c, desconto_c d, pendente p FROM meli_envio_custo WHERE cliente = ? AND envio_id = ?').get(CLI, id)

// ── frete por envio (chamarFn falso) ──
await ok('coletarFretes: Σ senders[].cost em centavos; 403 = permissao_do_app, 500 = indisponivel, senders vazio = sem_remetente — sempre NULL, nunca 0; teto → «teto» lido na próxima', async () => {
  linha({ order_id: 'A', item_id: 'MLB1', dia: D(-2), preco_unit_c: 7124, tarifa_c: 846, envio_id: '101', cupom_c: 356 })
  linha({ order_id: 'B1', item_id: 'MLB2', dia: D(-3), quantidade: 2, preco_unit_c: 5452, tarifa_c: 670, envio_id: '102', seller_sku: 'COLEIRA-P/M' })
  linha({ order_id: 'B2', item_id: 'MLB3', dia: D(-3), preco_unit_c: 9160, tarifa_c: 1541, envio_id: '102' })
  linha({ order_id: 'B3', item_id: 'MLB4', dia: D(-3), preco_unit_c: 12974, tarifa_c: 1594, envio_id: '102' })
  linha({ order_id: 'C', item_id: 'MLB5', dia: D(-4), preco_unit_c: 3000, envio_id: '103' })
  linha({ order_id: 'E', item_id: 'MLB6', dia: D(-5), preco_unit_c: 3000, envio_id: '104' })
  linha({ order_id: 'F', item_id: 'MLB7', dia: D(-6), preco_unit_c: 3000, envio_id: '105' })
  linha({ order_id: 'V', item_id: 'MLB8', dia: D(-40), preco_unit_c: 3000, envio_id: '199' })            // fora dos 28 d: nunca lido
  insLinha.run({ cliente: OUTRO, order_id: 'X', item_id: 'MLB1', dia: D(-2), quantidade: 1, preco_unit_c: 1, tarifa_c: 1, seller_sku: '', envio_id: '900', cupom_c: 0, reembolso_c: 0, status: 'paid' })
  const chamadas = [], resp = { '101': REAL, '102': PACOTE, '103': { _erro: true, status: 403 }, '104': { _erro: true, status: 500 }, '105': custos([]) }
  const fn = async (cli, caminho, o) => { assert.equal(cli, CLI); assert.deepEqual(o, { permitirFalha: true }); chamadas.push(caminho); return resp[caminho.split('/')[2]] }
  const r = await R.coletarFretes(CLI, { teto: 4, chamarFn: fn, pausaMs: 0 })
  assert.deepEqual(r, { lidos: 2, falhas: 2, para_amanha: 1, teto: 4 })
  assert.deepEqual(chamadas, ['/shipments/101/costs', '/shipments/102/costs', '/shipments/103/costs', '/shipments/104/costs'], 'do mais recente ao mais antigo; só GET de leitura')
  assert.deepEqual([envio('101'), envio('102'), envio('103'), envio('104'), envio('105')], [{ c: 815, d: 349, p: '' }, { c: 4830, d: 3898, p: '' }, { c: null, d: null, p: 'permissao_do_app' }, { c: null, d: null, p: 'indisponivel' }, { c: null, d: null, p: 'teto' }])
  assert.equal(envio('199'), undefined); assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_envio_custo WHERE cliente = ?').get(OUTRO).n, 0, 'isolamento: só o cliente pedido')
  chamadas.length = 0
  const r2 = await R.coletarFretes(CLI, { teto: 4, chamarFn: fn, pausaMs: 0 })
  assert.deepEqual(chamadas, ['/shipments/105/costs'], 'recoleta sem duplicar: lido não é relido; falha recente espera 3 dias; o «teto» vai primeiro na próxima')
  assert.equal(r2.falhas, 1); assert.deepEqual(envio('105'), { c: null, d: null, p: 'sem_remetente' })
  db.prepare("UPDATE meli_envio_custo SET lido_em = '2000-01-01T00:00:00.000Z' WHERE cliente = ? AND envio_id = '103'").run(CLI)
  resp['103'] = custos([{ cost: 0 }]); chamadas.length = 0
  await R.coletarFretes(CLI, { teto: 4, chamarFn: fn, pausaMs: 0 })
  assert.deepEqual(chamadas, ['/shipments/103/costs']); assert.deepEqual(envio('103'), { c: 0, d: null, p: '' }, 'frete zero LIDO é fato (não falha)')
})

// ── cancelados (fetch falso por trás de chamar) ──
db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id) VALUES (?, 77, 'n', ?, ?, ?, '', ?, ?, '', '')`)
  .run(CLI, cifrar('AT-teste'), cifrar('RT-teste'), new Date(Date.now() + 6 * 3600e3).toISOString(), T, T)
let porBusca = () => ({ results: [] }), urls = []
globalThis.fetch = async url => {
  const u = new URL(String(url)); urls.push(u)
  assert.equal(u.pathname, '/orders/search', 'só a busca de pedidos (leitura)')
  const b = porBusca(u)
  if (b === 'falha') return { ok: false, status: 500, json: async () => ({}), text: async () => 'erro' }
  const corpo = { paging: { total: b.total ?? b.results.length, offset: Number(u.searchParams.get('offset')), limit: 50 }, results: b.results }
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) }
}
await ok('marcarCancelados: busca por date_last_updated (1ª vez 30 d, depois desde a última − 1 d), UPDATE paid → cancelled por order_id; pedido sem linha fica de fora; truncado não avança', async () => {
  porBusca = u => (u.searchParams.get('order.status') === 'cancelled' ? { results: [{ id: 'B1', status: 'cancelled' }, { id: 'ZZ', status: 'cancelled' }] } : { results: [] })
  const r = await S.marcarCancelados(CLI, { hoje: HOJE })
  assert.deepEqual(r, { desde: D(-30), cancelados: 2, linhas_marcadas: 1, truncado: false })
  assert.equal(urls.at(-1).searchParams.get('order.date_last_updated.from'), `${D(-30)}T00:00:00.000-03:00`)
  assert.equal(db.prepare("SELECT status FROM meli_pedido_item WHERE cliente = ? AND order_id = 'B1'").get(CLI).status, 'cancelled')
  assert.equal((await S.marcarCancelados(CLI, { hoje: HOJE })).desde, D(-1), 'a próxima passada recomeça na véspera da última')
  porBusca = () => ({ results: Array.from({ length: 50 }, (_, k) => ({ id: `T${k}` })), total: 999 })
  const t = await S.marcarCancelados(CLI, { hoje: D(5), paginas: 2 })
  assert.equal(t.truncado, true); assert.equal((await S.marcarCancelados(CLI, { hoje: D(6), paginas: 2 })).desde, D(-1), 'truncado: a data não avança')
})

// ── linhas de dia fechado (backfill) ──
const P2 = (id, item, q, preco, envioId) => ({ id, status: 'paid', pack_id: null, shipping: { id: envioId }, order_items: [{ item: { id: item, variation_id: null, seller_sku: null }, quantity: q, unit_price: preco, sale_fee: 1, listing_type_id: 'gold_special' }],
  payments: [{ status: 'approved', transaction_amount: q * preco, transaction_amount_refunded: 0, coupon_amount: 0 }] })
await ok('completarLinhas: só dias fechados (≥ 3 d) sem linhas e não truncados; grava SÓ as linhas (série intacta) com a invariante de TETO; acima da série = dia segue sem linhas', async () => {
  const dia = (d, o = {}) => db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em, linhas) VALUES (?,?,?,?,?,?)').run(CLI, d, o.p ?? 2, o.t ?? 0, T, o.l ?? 0)
  const serie = (d, item, u, r) => db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)').run(CLI, item, d, u, r)
  dia(D(-10)); serie(D(-10), 'MLB20', 2, 100); serie(D(-10), 'MLB21', 1, 30)       // MLB21 foi cancelado depois da coleta: some dos pagos
  dia(D(-11)); serie(D(-11), 'MLB20', 1, 50)                                       // pagos de hoje passam da série (pago tardio): dia segue sem linhas
  dia(D(-12), { t: 1 }); dia(D(-1)); dia(D(-13), { l: 1 })
  porBusca = u => { const d = u.searchParams.get('order.date_created.from').slice(0, 10); return { results: d === D(-10) ? [P2('O1', 'MLB20', 2, 50, 7)] : d === D(-11) ? [P2('O2', 'MLB20', 1, 50, 8), P2('O3', 'MLB20', 1, 50, 9)] : [] } }
  urls.length = 0
  const r = await S.completarLinhas(CLI, { hoje: HOJE, dias: 28, teto: 10 })
  assert.deepEqual(r, { dias: 2, feitos: 1, pulados: 1, falhas: 0 })
  assert.deepEqual(urls.map(u => u.searchParams.get('order.date_created.from').slice(0, 10)).sort(), [D(-11), D(-10)].sort(), 'nem o truncado, nem o recente, nem o já com linhas')
  assert.deepEqual(db.prepare('SELECT order_id, quantidade, preco_unit_c, envio_id FROM meli_pedido_item WHERE cliente = ? AND dia = ?').all(CLI, D(-10)), [{ order_id: 'O1', quantidade: 2, preco_unit_c: 5000, envio_id: '7' }])
  assert.deepEqual(db.prepare('SELECT dia, linhas FROM meli_coleta_dia WHERE cliente = ? AND dia IN (?,?) ORDER BY dia').all(CLI, D(-11), D(-10)), [{ dia: D(-11), linhas: 0 }, { dia: D(-10), linhas: 1 }])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_pedido_item WHERE cliente = ? AND dia = ?').get(CLI, D(-11)).n, 0)
  assert.deepEqual(db.prepare('SELECT item_id, unidades, receita FROM meli_serie_item WHERE cliente = ? AND dia = ? ORDER BY item_id').all(CLI, D(-10)).map(x => [x.item_id, x.unidades, x.receita]), [['MLB20', 2, 100], ['MLB21', 1, 30]], 'série intacta')
  porBusca = () => 'falha'
  assert.equal((await S.completarLinhas(CLI, { hoje: HOJE })).falhas, 1, 'falha da busca: o dia segue sem linhas (lacuna), nada derruba')
})

// ── lucro de ponta a ponta ──
await ok('financeiroDoCliente: pedido com frete (pacote rateado), cupom só informativo, cancelado fora da receita, anúncio sem custo → cobertura < 80% = «parcial»; com custo, número', async () => {
  P.importarCustosSku(CLI, [{ sku: 'COLEIRA-P/M', custo: 20 }, { sku: 'PEITORAL', custo: 30 }], 'teste', 'teste')
  db.prepare("UPDATE meli_pedido_item SET seller_sku = 'PEITORAL' WHERE cliente = ? AND order_id = 'A'").run(CLI)
  db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em, linhas) VALUES (?,?,1,0,?,1),(?,?,1,0,?,1)").run(CLI, D(-2), T, CLI, D(-3), T)
  const f = R.financeiroDoCliente(CLI, { hoje: HOJE, de: D(-3), ate: D(-2) })
  const por = f.por(l => l.item_id)
  const a = por.get('MLB1')                                                          // 7124 − 846 − 815 − 3000 = 2463; cupom 356 não desconta
  assert.deepEqual([a.receita_c, a.taxas_c, a.frete_c, a.custo_c, a.lucro_c, a.margem_pct, a.cupom_c], [7124, 846, 815, 3000, 2463, 34.6, 356])
  assert.equal(por.get('MLB2'), undefined, 'B1 cancelado: fora da receita e do lucro')
  const b = por.get('MLB3')                                                          // pacote: 48,30 rateado entre as linhas PAGAS do envio (B2 + B3)
  assert.deepEqual([b.frete_c, b.lucro_c, b.cobertura], [1998, null, 0], 'sem custo: lucro null, nunca 0')
  assert.equal(por.get('MLB4').frete_c, 4830 - 1998)
  const c = f.por(() => 'conta').get('conta')
  assert.equal(c.receita_c, 7124 + 9160 + 12974, 'só o cliente pedido (a linha do outro cliente no mesmo dia fica fora)'); assert.equal(c.lucro_c, null); assert.ok(c.cobertura < 0.8); assert.match(c.motivo, /custo não informado/)
  assert.equal(c.receita_liquida_c, 7124 - 846 - 815 + 9160 - 1541 - 1998 + 12974 - 1594 - (4830 - 1998), 'receita líquida de taxas e frete existe sem custo')
  assert.deepEqual([f.envios.total, f.envios.lidos], [2, 2]); assert.match(f.tarifa.rotulo, /não conciliada: PREMISSA por unidade/)
})

await ok('dreDoCliente: só os dias com linhas; cancelados = GMV − linhas pagas (o cancelado depois da coleta entra); «parcial» com dias sem linhas; «Não é lucro líquido.»; mês sem dia fechado = indisponível', async () => {
  // a série desses dias como a coleta gravou (o pacote B inteiro estava pago na coleta; B1 cancelou depois)
  const s = db.prepare('INSERT OR REPLACE INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)')
  s.run(CLI, 'MLB1', D(-2), 1, 71.24); s.run(CLI, 'MLB2', D(-3), 2, 109.04); s.run(CLI, 'MLB3', D(-3), 1, 91.6); s.run(CLI, 'MLB4', D(-3), 1, 129.74)
  const mes = D(-10).slice(0, 7), d = R.dreDoCliente(CLI, mes, { hoje: HOJE }), v = k => d.linhas.find(l => l.chave === k).valor_c
  assert.equal(d.disponivel, true); assert.equal(d.rodape, 'Não é lucro líquido.'); assert.ok(d.parcial.dias_sem_linhas > 0, 'dias do mês sem linhas: parcial, nada extrapolado')
  const com = db.prepare("SELECT dia FROM meli_coleta_dia WHERE cliente = ? AND linhas = 1 AND dia BETWEEN ? AND ?").all(CLI, d.de, d.ate).map(r => r.dia), q = com.map(() => '?').join(',')
  const gmv = Math.round(db.prepare(`SELECT SUM(receita) r FROM meli_serie_item WHERE cliente = ? AND dia IN (${q})`).get(CLI, ...com).r * 100)
  const pagas = db.prepare(`SELECT SUM(preco_unit_c * quantidade) c FROM meli_pedido_item WHERE cliente = ? AND status = 'paid' AND dia IN (${q})`).get(CLI, ...com).c
  assert.deepEqual([v('receita_bruta'), v('cancelados'), v('receita_liquida')], [gmv, gmv - pagas, pagas])
  assert.ok(v('cancelados') >= 3000, 'MLB21 (R$ 30,00) cancelado depois da coleta entra em cancelados'); assert.equal(v('ads'), null); assert.equal(v('margem'), null, 'custo em < 80% da receita: margem «parcial»')
  assert.equal(R.dreDoCliente(CLI, '2999-01', { hoje: HOJE }).disponivel, false)
})

await ok('carregarBase/diagnosticarConta: chave desligada = nenhum campo novo (sem i.financeiro, sem diag.financeiro, data_quality igual); ligada = agregado do anúncio na MESMA janela + fonte «taxas e frete por pedido»', async () => {
  const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
  S.gravarItens(CLI, ['MLB1', 'MLB3', 'MLB4'].map(id => ({ id, title: `Produto ${id}`, price: 71.24, available_quantity: 10, status: 'active', shipping: { logistic_type: 'xd_drop_off', tags: [] }, date_created: '2025-01-01T00:00:00.000Z' })), { dia: HOJE })
  const off = diagnosticarConta(CLI, { hoje: HOJE })
  assert.equal(off.disponivel, true); assert.ok(!('financeiro' in off)); assert.ok(off.itens.every(i => !('financeiro' in i) && !('economia_real' in i)))
  assert.ok(!off.data_quality.fontes.some(f => /taxas e frete/.test(f.fonte)))
  algoritmo.financeiro.margem_medida_nas_regras = true
  try {
    const on = diagnosticarConta(CLI, { hoje: HOJE }), i1 = on.itens.find(i => i.id === 'MLB1')
    assert.ok(on.financeiro?.conta && on.financeiro.de === on.periodo.de && on.financeiro.ate === on.periodo.ate, 'a MESMA janela do diagnóstico')
    assert.equal(i1.financeiro.receita_c, 7124); assert.equal(i1.economia_real?.custo_unit, 30, 'o SKU da venda gravado no F1 (meli_anuncio_up, sku_fonte «pedido») liga o custo ao anúncio: custo-vinculo lê o F1 desde 15/10/2026')
    assert.ok(on.data_quality.fontes.some(f => /taxas e frete por pedido/.test(f.fonte))); assert.ok(on.data_quality.analises_bloqueadas.some(b => b.estado === 'NOT_AUTHORIZED' && /Faturamento/.test(b.como_obter)))
    assert.deepEqual(on.itens.map(i => [i.id, i.cobertura, i.ponto_reposicao]), off.itens.map(i => [i.id, i.cobertura, i.ponto_reposicao]), 'o financeiro não mexe em estoque')
  } finally { algoritmo.financeiro.margem_medida_nas_regras = false }
})

await ok('coletarFinanceiro: cada etapa com try próprio — a busca falhando não impede o frete', async () => {
  porBusca = () => 'falha'
  const r = await R.coletarFinanceiro(CLI, { hoje: HOJE })
  assert.match(r.cancelados.erro, /Mercado Livre 500/); assert.ok('fretes' in r && 'linhas' in r)
})

// ── revisões ──
const conta = cli => db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id) VALUES (?, 78, 'n', ?, ?, ?, '', ?, ?, '', '')`)
  .run(cli, cifrar('AT-teste'), cifrar('RT-teste'), new Date(Date.now() + 6 * 3600e3).toISOString(), T, T)
await ok('revisão F4: pedido cancelado até D+2 — a recoleta guarda a linha como «cancelled» (não apaga) e o DRE soma à receita bruta e aos cancelados; busca truncada não marca', async () => {
  const CC = 'Cancela D2'; conta(CC)
  let pagos = [P2('O1', 'MLB50', 1, 100, 1), P2('O2', 'MLB50', 1, 50, 2)]
  porBusca = u => (u.searchParams.get('order.status') === 'paid' ? { results: pagos } : { results: [] })
  await S.coletarPedidos(CC, D(-1), D(-1))
  pagos = [P2('O1', 'MLB50', 1, 100, 1)]                                              // O2 cancelado no dia seguinte: some da busca de pagos
  await S.coletarPedidos(CC, D(-1), D(-1))
  assert.deepEqual(db.prepare('SELECT order_id, status FROM meli_pedido_item WHERE cliente = ? ORDER BY order_id').all(CC), [{ order_id: 'O1', status: 'paid' }, { order_id: 'O2', status: 'cancelled' }])
  assert.equal(db.prepare('SELECT receita FROM meli_serie_item WHERE cliente = ? AND item_id = ?').get(CC, 'MLB50').receita, 100, 'a série segue sem o cancelado (GMV de sempre)')
  const d = R.dreDoCliente(CC, D(-1).slice(0, 7), { hoje: HOJE }), v = k => d.linhas.find(l => l.chave === k).valor_c
  assert.deepEqual([v('receita_bruta'), v('cancelados'), v('receita_liquida')], [15000, 5000, 10000], 'antes: bruta 100 e cancelados 0 (o cancelamento sumia)')
  db.prepare("UPDATE meli_pedido_item SET status = 'cancelled' WHERE cliente = ? AND order_id = 'O1'").run(CC)   // + cancelado DEPOIS da última recoleta (marcarCancelados): continua na série
  const d2 = R.dreDoCliente(CC, D(-1).slice(0, 7), { hoje: HOJE }), v2 = k => d2.linhas.find(l => l.chave === k).valor_c
  assert.deepEqual([v2('receita_bruta'), v2('cancelados')], [15000, 15000], 'max(série − pagas, canceladas) nunca conta o mesmo pedido duas vezes')
  porBusca = u => (u.searchParams.get('order.status') === 'paid' ? { results: Array.from({ length: 50 }, (_, k) => P2(`T${k}`, 'MLB51', 1, 10, 9)), total: 5000 } : { results: [] })
  db.prepare("UPDATE meli_pedido_item SET status = 'paid' WHERE cliente = ? AND order_id = 'O1'").run(CC)
  await S.coletarPedidos(CC, D(-1), D(-1))
  assert.equal(db.prepare("SELECT status FROM meli_pedido_item WHERE cliente = ? AND order_id = 'O1'").get(CC)?.status ?? 'apagada', 'apagada', 'truncado: nada vira «cancelled» (O1 pode estar depois do corte)')
})

await ok('revisão F4: completarLinhas não trava — o dia que sempre passa da série vai para o fim da fila; os 2 mais antigos completam na 2ª passada', async () => {
  const CF = 'Fila Linhas'; conta(CF)
  for (let k = 3; k <= 14; k++) { db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em, linhas) VALUES (?,?,1,0,?,0)').run(CF, D(-k), T); db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,1,50)').run(CF, 'MLB1', D(-k)) }
  const buscados = []
  porBusca = u => { const d = u.searchParams.get('order.date_created.from').slice(0, 10), k = Math.round((new Date(HOJE) - new Date(d)) / 864e5); buscados.push(k); return { results: k <= 12 ? [P2('A' + k, 'MLB1', 1, 50, 1), P2('B' + k, 'MLB1', 1, 50, 1)] : [P2('A' + k, 'MLB1', 1, 50, 1)] } }
  const r1 = await S.completarLinhas(CF, { hoje: HOJE, dias: 28, teto: 10 })
  assert.deepEqual([r1.feitos, r1.pulados], [0, 10]); assert.ok(!buscados.includes(13) && !buscados.includes(14))
  buscados.length = 0
  const r2 = await S.completarLinhas(CF, { hoje: HOJE, dias: 28, teto: 10 })
  assert.equal(r2.feitos, 2); assert.deepEqual(buscados.slice(0, 2).sort(), [13, 14], 'nunca tentados primeiro')
  assert.deepEqual(db.prepare('SELECT dia, linhas FROM meli_coleta_dia WHERE cliente = ? AND dia IN (?,?) ORDER BY dia').all(CF, D(-14), D(-13)).map(x => x.linhas), [1, 1])
})

await ok('revisão F4: custo da linha — o do ANÚNCIO vence o SKU da venda; a variação só usa o próprio SKU quando ele tem custo (casado pelo SKU)', async () => {
  const CV = 'Custo Var'
  P.importarCustosSku(CV, [{ sku: 'PEITORAL', custo: 30 }, { sku: 'COLEIRA-P/M', custo: 20 }], 'teste', 'teste')
  db.prepare("INSERT INTO promo_anuncio (cliente, item_id, sku) VALUES (?, 'MLB60', 'PEITORAL')").run(CV)
  db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em, linhas) VALUES (?,?,1,0,?,1)").run(CV, D(-2), T)
  insLinha.run({ cliente: CV, order_id: 'V1', item_id: 'MLB60', dia: D(-2), quantidade: 1, preco_unit_c: 10000, tarifa_c: 1000, seller_sku: 'PEITORAL-AZUL', envio_id: '', cupom_c: 0, reembolso_c: 0, status: 'paid' })
  insLinha.run({ cliente: CV, order_id: 'V2', item_id: 'MLB61', dia: D(-2), quantidade: 1, preco_unit_c: 10000, tarifa_c: 1000, seller_sku: 'COLEIRA-P/M', envio_id: '', cupom_c: 0, reembolso_c: 0, status: 'paid' })
  db.prepare("UPDATE meli_pedido_item SET variacao_id = '123' WHERE cliente = ? AND order_id IN ('V1','V2')").run(CV)
  insLinha.run({ cliente: CV, order_id: 'V3', item_id: 'MLB60', dia: D(-2), quantidade: 1, preco_unit_c: 10000, tarifa_c: 1000, seller_sku: 'COLEIRA-P/M', envio_id: '', cupom_c: 0, reembolso_c: 0, status: 'paid' })
  db.prepare("UPDATE meli_pedido_item SET variacao_id = '124' WHERE cliente = ? AND order_id = 'V3'").run(CV)
  const f = R.financeiroDoCliente(CV, { hoje: HOJE, de: D(-2), ate: D(-2) }), c = o => f.fins.find(x => x.order_id === o).custo_c
  assert.deepEqual([c('V1'), c('V2'), c('V3')], [3000, 2000, 2000], 'anúncio custeado + variação sem custo = do anúncio; variação custeada + pai sem custo = da variação; os dois = o da variação')
})

console.log(`\n${n} casos ok — coleta e leitura do financeiro (V3 F4)`)
