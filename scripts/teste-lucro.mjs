// Autoteste do núcleo PURO do financeiro da V3 F4 (src/lib/lucro.js; docs/desenho-v3-produto-estoque-financeiro.md § 5 e § 9 F4): rateio do frete do pacote, tarifa × q,
// ausente = null (nunca 0), imposto, cupom só informativo, reembolso, margem sobre a receita coberta, cobertura < mínimo = «parcial», dia sem linhas no denominador,
// pós-Ads, economiaReal (preço mínimo, desconto máximo, faixa do frete grátis), conciliarTarifa e o DRE. Fixtures com o FORMATO real (Uniaodog, 14/10/2026). Sem banco, sem rede.
// Rodar: node scripts/teste-lucro.mjs
import assert from 'node:assert/strict'
const { fretesDasLinhas, linhaFinanceira, agregar, economiaReal, conciliarTarifa, dreMensal, resumoFin } = await import('../src/lib/lucro.js')
const { ratearPorReceita } = await import('../src/lib/produto-estoque.js')

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
// linhas no formato de meli_pedido_item (P1 = pedido real de 1 linha, envio 48257561912 = 8,15; pacote real 48256982091 = P2 + P3 + P4, frete 48,30)
const L = (o = {}) => ({ order_id: 'o1', item_id: 'MLB1', variacao_id: '', dia: '2026-10-10', quantidade: 1, preco_unit_c: 10000, tarifa_c: 1200, envio_id: 'e1', reembolso_c: 0, cupom_c: 0, ...o })
const P1 = L({ order_id: '2000018978910976', item_id: 'MLB4612661755', preco_unit_c: 7124, tarifa_c: 846, envio_id: '48257561912', cupom_c: 356 })
const PAC = [L({ order_id: 'p2', item_id: 'MLB6599833678', quantidade: 2, preco_unit_c: 5452, tarifa_c: 670, envio_id: '48256982091' }),
  L({ order_id: 'p3', item_id: 'MLB5943664742', preco_unit_c: 9160, tarifa_c: 1541, envio_id: '48256982091' }), L({ order_id: 'p4', item_id: 'MLB6756024752', preco_unit_c: 12974, tarifa_c: 1594, envio_id: '48256982091' })]

ok('rateio do frete do pacote: Σ exato, resto na maior linha; 1 envio desconta UMA vez; envio não lido e linha sem envio = null', () => {
  assert.deepEqual(ratearPorReceita(815, [10904, 9160, 12974]), [268, 225, 322])
  assert.deepEqual(ratearPorReceita(4830, [10904, 9160, 12974]), [1594, 1339, 1897])                      // frete real do pacote: 48,30
  const envios = new Map([['48256982091', { custo_vendedor_c: 4830 }], ['48257561912', { custo_vendedor_c: null, pendente: 'indisponivel' }]])
  assert.deepEqual(fretesDasLinhas([...PAC, P1, L({ envio_id: '' })], envios), [1594, 1339, 1897, null, null])
})

ok('tarifa × quantidade (premissa por unidade: 670 → 1340); por linha fica como veio; lucro = receita − reembolso − tarifa − frete − custo, cupom só informativo', () => {
  assert.equal(linhaFinanceira(PAC[0]).tarifa_c, 1340); assert.equal(linhaFinanceira(PAC[0], { porUnidade: false }).tarifa_c, 670)
  const f = linhaFinanceira(P1, { frete_c: 815, custo_unit_c: 3000 })
  assert.deepEqual([f.receita_c, f.tarifa_c, f.frete_c, f.custo_c, f.cupom_c, f.lucro_antes_imposto_c, f.lucro_c], [7124, 846, 815, 3000, 356, 2463, null], 'sem imposto informado: lucro só «antes do imposto»')
  const g = linhaFinanceira(P1, { frete_c: 815, custo_unit_c: 3000, imposto_pct: 6 })
  assert.deepEqual([g.imposto_c, g.lucro_c], [427, 2036])
  assert.equal(linhaFinanceira({ ...P1, reembolso_c: 1000 }, { frete_c: 815, custo_unit_c: 3000 }).lucro_antes_imposto_c, 1463, 'reembolso sai da receita')
})

ok('ausente = null, NUNCA 0: sem frete, sem custo, sem tarifa ou sem o valor de reembolso → lucro null', () => {
  for (const [l, o] of [[P1, { custo_unit_c: 3000 }], [P1, { frete_c: 815 }], [{ ...P1, tarifa_c: null }, { frete_c: 815, custo_unit_c: 3000 }], [{ ...P1, reembolso_c: null }, { frete_c: 815, custo_unit_c: 3000 }]]) {
    const f = linhaFinanceira(l, o); assert.equal(f.lucro_antes_imposto_c, null); assert.equal(f.lucro_c, null)
  }
  assert.equal(linhaFinanceira({ ...P1, tarifa_c: null }).tarifa_c, null)
})

const fins = (custo = 3000, frete = 1000) => [linhaFinanceira(L({ order_id: 'a', envio_id: 'ea' }), { frete_c: frete, custo_unit_c: custo }), linhaFinanceira(L({ order_id: 'b', envio_id: 'eb' }), { frete_c: frete, custo_unit_c: custo })]
ok('agregar: margem sobre a receita COBERTA; cobertura ≥ mínimo mostra número; abaixo, null com o motivo («parcial»); taxas e frete existem sem custo', () => {
  const a = agregar(fins(), () => 'c').get('c')
  assert.deepEqual([a.receita_c, a.cobertura, a.lucro_c, a.margem_pct, a.taxas_c, a.frete_c, a.custo_c, a.receita_liquida_c, a.antes_do_imposto], [20000, 1, 9600, 48, 2400, 2000, 6000, 15600, true])
  const meio = [fins()[0], linhaFinanceira(L({ order_id: 'b', envio_id: 'eb' }), { frete_c: 1000, custo_unit_c: null })]     // custo em 50% da receita
  const b = agregar(meio, () => 'c').get('c')
  assert.equal(b.cobertura, 0.5); assert.equal(b.lucro_c, null); assert.equal(b.margem_pct, null); assert.equal(b.custo_c, null); assert.match(b.motivo, /custo não informado em 50% da receita/)
  assert.equal(b.receita_liquida_c, 15600, 'receita líquida de taxas e frete existe sem custo (cobertura de taxas e frete 100%)')
  const semFrete = agregar(fins(3000, null), () => 'c').get('c')
  assert.equal(semFrete.receita_liquida_c, null); assert.equal(semFrete.lucro_c, null); assert.match(semFrete.motivo, /frete não lido em 2 de 2 envio\(s\)/)
})

ok('dia sem linhas entra no denominador (nunca vira «coberto»); pós-Ads = margem − Ads ÷ receita TOTAL; agrupa por anúncio, produto ou conta', () => {
  const a = agregar(fins(), l => l.item_id, { semLinhas: new Map([['MLB1', 5000]]), ads: new Map([['MLB1', 2500], ['MLB9', 99]]) }).get('MLB1')
  assert.equal(a.receita_total_c, 25000); assert.equal(a.cobertura, 0.8); assert.equal(a.margem_pct, 48, 'margem só sobre o coberto (nunca extrapola)')
  assert.equal(a.margem_pos_ads_pct, 38); assert.equal(a.ads_c, 2500)
  const b = agregar(fins(), l => l.item_id, { semLinhas: new Map([['MLB1', 6000]]) }).get('MLB1')
  assert.equal(b.lucro_c, null); assert.match(b.motivo, /dias sem linhas de pedido: 23% da receita/)
  assert.equal(agregar(fins(), l => l.item_id, { semLinhas: new Map([['MLB2', 100]]) }).get('MLB2').receita_c, 0, 'anúncio só com venda sem linha aparece, sem lucro')
})

ok('economiaReal: lucro por unidade, ROAS de equilíbrio, preço mínimo, desconto máximo; para na faixa do frete grátis (R$ 79); null sem custo ou sem cobertura', () => {
  const a = { t_obs: 0.2, frete_unit_c: 1000, cobertura_taxas_frete: 1 }
  const e = economiaReal(a, { preco: 100, custo_unit: 20 })
  assert.deepEqual([e.lucro_unit, e.margem_pct, e.roas_equilibrio, e.preco_minimo, e.cruza_faixa_frete, e.desconto_max_pct], [50, 50, 2, 37.5, true, 21])
  assert.ok(e.premissas.some(p => /antes do imposto/.test(p)) && e.premissas.some(p => /abaixo de R\$ 79/.test(p)))
  const m = economiaReal(a, { preco: 100, custo_unit: 20, margem_desejada_pct: 10 }); assert.equal(m.preco_minimo, 42.86); assert.equal(m.acos_alvo_pct, 40)
  assert.deepEqual([economiaReal(a, { preco: 50, custo_unit: 20 }).cruza_faixa_frete, economiaReal(a, { preco: 50, custo_unit: 20 }).desconto_max_pct], [false, 25])
  assert.equal(economiaReal(a, { preco: 100, custo_unit: 80 }).roas_equilibrio, null, 'margem ≤ 0: sem ROAS de equilíbrio')
  assert.equal(economiaReal(a, { preco: 100, custo_unit: 80 }).desconto_max_pct, 0)
  assert.equal(economiaReal(a, { preco: 100, custo_unit: null }), null); assert.equal(economiaReal({ ...a, cobertura_taxas_frete: 0.5 }, { preco: 100, custo_unit: 20 }), null)
  assert.equal(economiaReal({ ...a, frete_unit_c: null }, { preco: 100, custo_unit: 20 }), null)
})

ok('conciliarTarifa: q ≥ 2 contra q = 1 do mesmo anúncio e preço; ≥ 5 votos e ≥ 90% decide; sem par ou mistura = premissa (indeterminado vota contra)', () => {
  const um = L({ item_id: 'MLB6599833678', preco_unit_c: 5452, tarifa_c: 670 }), dois = q => L({ item_id: 'MLB6599833678', preco_unit_c: 5452, quantidade: q, tarifa_c: 670 })
  assert.deepEqual(conciliarTarifa([um, dois(2), dois(2), dois(3), dois(2), dois(2)]), { semantica: 'por_unidade', decidida: true, votos: { por_unidade: 5, por_linha: 0, indeterminado: 0 }, n: 5 })
  const linha = L({ item_id: 'MLB6599833678', preco_unit_c: 5452, quantidade: 2, tarifa_c: 1340 })
  assert.equal(conciliarTarifa([um, dois(2), dois(2), dois(2), dois(2), linha]).decidida, false, '4 de 5 = 80% < 90%')
  assert.deepEqual(conciliarTarifa([um, L({ item_id: 'MLB6599833678', preco_unit_c: 5452, quantidade: 2, tarifa_c: 900 })]).votos, { por_unidade: 0, por_linha: 0, indeterminado: 1 })
  assert.equal(conciliarTarifa([dois(2), L({ item_id: 'MLB6599833678', preco_unit_c: 5500, tarifa_c: 670 })]).n, 0, 'preço diferente não é par (custo fixo e % mudam)')
  assert.equal(conciliarTarifa([um, L({ item_id: 'MLB6599833678', preco_unit_c: 5452, quantidade: 2, tarifa_c: 670, deposito_store: '86161652' })]).n, 0, 'depósito diferente (Flex × Full) não é par')
})

ok('DRE: cancelados e reembolsos em linhas próprias; Ads «—»; mês com dias sem linhas = «parcial»; margem só com cobertura, com a %; rodapé «Não é lucro líquido.»', () => {
  const conta = agregar([linhaFinanceira(L({ reembolso_c: 500 }), { frete_c: 1000, custo_unit_c: 3000 }), linhaFinanceira(L({ order_id: 'b', envio_id: 'eb' }), { frete_c: 1000, custo_unit_c: 3000 })], () => 'c').get('c')
  const d = dreMensal({ mes: '2026-10', dias: { total: 10, com_linhas: 9, sem_linhas: ['2026-10-03'] }, gmv_c: 25000, conta, tarifa_rotulo: 'tarifa não conciliada' })
  const v = k => d.linhas.find(l => l.chave === k)
  assert.deepEqual(['receita_bruta', 'cancelados', 'reembolsos', 'receita_liquida', 'tarifas', 'frete', 'ads', 'custo', 'impostos', 'margem'].map(k => v(k).valor_c), [25000, 5000, 500, 19500, 2400, 2000, null, 6000, null, 9100])
  assert.match(v('ads').nota, /—/); assert.match(v('impostos').nota, /não incluídos/); assert.match(v('margem').rotulo, /custo e frete lidos \(100% da receita\)/)
  assert.deepEqual(d.parcial, { dias_sem_linhas: 1, dias: 10, lista: ['2026-10-03'] }); assert.equal(d.rodape, 'Não é lucro líquido.'); assert.ok(d.fora.every(x => /NOT_COLLECTED/.test(x)))
  const meia = agregar([linhaFinanceira(L(), { frete_c: 1000, custo_unit_c: 3000 }), linhaFinanceira(L({ order_id: 'b' }), { frete_c: 1000 })], () => 'c').get('c')
  const p = dreMensal({ mes: '2026-10', dias: { total: 2, com_linhas: 2, sem_linhas: [] }, gmv_c: 20000, conta: meia, imposto_pct: 5 })
  assert.equal(p.linhas.find(l => l.chave === 'margem').valor_c, null); assert.match(p.linhas.find(l => l.chave === 'margem').nota, /parcial \(50%\)/); assert.equal(p.parcial, null)
  assert.equal(p.linhas.find(l => l.chave === 'impostos').valor_c, 1000)
  const semFrete = dreMensal({ mes: '2026-10', dias: { total: 1, com_linhas: 1, sem_linhas: [] }, gmv_c: 10000, conta: agregar([linhaFinanceira(L(), { custo_unit_c: 3000 })], () => 'c').get('c') })
  assert.deepEqual(['frete', 'custo', 'tarifas'].map(k => semFrete.linhas.find(l => l.chave === k).valor_c), [null, 3000, 1200], 'frete nunca lido = «—», não R$ 0')
  const vazio = dreMensal({ mes: '2026-10', dias: { total: 3, com_linhas: 0, sem_linhas: ['a', 'b', 'c'] }, gmv_c: 0, conta: undefined })
  assert.equal(vazio.linhas.find(l => l.chave === 'margem').valor_c, null); assert.equal(vazio.linhas.find(l => l.chave === 'tarifas').valor_c, null)
})

ok('revisão F4: imposto informado 10% com margem antes do imposto de 8% → exibe −2% e lucro −R$ 20 «depois do imposto»; sem imposto, «antes do imposto»', () => {
  const fins = Array.from({ length: 10 }, (_, k) => linhaFinanceira(L({ order_id: 'O' + k, envio_id: 'E' + k }), { frete_c: 1000, custo_unit_c: 7000, imposto_pct: 10 }))
  const a = agregar(fins, () => 'c').get('c')
  assert.deepEqual([a.lucro_c, a.margem_pct, a.lucro_depois_imposto_c, a.margem_depois_imposto_pct, a.antes_do_imposto, a.completas.imposto_c], [8000, 8, -2000, -2, false, 10000], 'margem_pct segue «antes do imposto» (DEFINICOES)')
  const r = resumoFin(a)
  assert.deepEqual([r.lucro_c, r.margem_pct, r.antes_do_imposto], [-2000, -2, false], 'a tela mostra o número DEPOIS do imposto quando o rótulo diz «depois do imposto informado»')
  const sem = resumoFin(agregar(fins.map(f => ({ ...f, imposto_c: null, lucro_c: null })), () => 'c').get('c'))
  assert.deepEqual([sem.lucro_c, sem.margem_pct, sem.antes_do_imposto], [8000, 8, true])
})

ok('revisão F4: cada número leva a receita que cobre (lucro × receita das linhas completas; receita líquida × linhas com tarifa+frete); custo com a própria base', () => {
  const fins = Array.from({ length: 10 }, (_, k) => linhaFinanceira(L({ order_id: 'O' + k, envio_id: 'E' + k }), { frete_c: k < 8 ? 1000 : null, custo_unit_c: 7000 }))
  const r = resumoFin(agregar(fins, () => 'c').get('c'))
  assert.deepEqual([r.receita_c, r.receita_liquida_c, r.receita_tf_c, r.lucro_c, r.receita_coberta_c, r.cobertura, r.custo_c, r.custo_receita_c, r.cobertura_custo],
    [100000, 62400, 80000, 6400, 80000, 0.8, 70000, 100000, 1], 'R$ 624 sobre R$ 800 (80%), nunca lido contra a receita total de R$ 1.000')
})

ok('revisão F4: limiar de 80% não é contornado pelo arredondamento — 79,5% de taxas+frete: cobertura exibida 0,79 (piso), ok_taxas_frete falso, economiaReal null', () => {
  const fins = Array.from({ length: 200 }, (_, k) => linhaFinanceira(L({ order_id: 'O' + k, envio_id: 'E' + k }), { frete_c: k < 159 ? 1000 : null, custo_unit_c: 6000 }))
  const a = agregar(fins, () => 'x', { minimo: 0.8 }).get('x')
  assert.deepEqual([a.cobertura_taxas_frete, a.ok_taxas_frete, a.receita_liquida_c, a.cobertura, a.ok_lucro], [0.79, false, null, 0.79, false])
  assert.equal(economiaReal(a, { preco: 100, custo_unit: 60, minimo: 0.8 }), null, 'abaixo do mínimo: sem ROAS de equilíbrio nem desconto máximo')
  const cheio = agregar(fins.map(f => ({ ...f })).slice(0, 159), () => 'x').get('x'); assert.equal(cheio.ok_taxas_frete, true)
})

console.log(`\n${n} casos ok — financeiro por pedido (V3 F4, núcleo puro)`)
