// Autoteste do motor de preço das Ofertas (src/lib/ofertas-preco.js). Spec §7 e critérios 4 e 15. Puro: sem banco, sem rede. Rodar: node scripts/teste-ofertas-preco.mjs
import assert from 'node:assert/strict'
import { criarPreco, arredondarPreco, aCentavos, BLOQUEIOS } from '../src/lib/ofertas-preco.js'

let n = 0
const ok = (nome, fn) => { try { fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const P = criarPreco({ agora: () => '2026-10-07T12:00:00.000Z' })
const regra = { canal: 'mercadolivre', modalidade: 'classico', comissao_pct: 12, tarifa_fixa: 0, base_comissao: 'receita', tributos_pct: 8, frete_vendedor: 0, desconto_pct: 0, promo_pct: 0, devolucao_pct: 0, ads_pct: 0,
  margem_min_pct: 10, margem_alvo_pct: 20, fonte: 'cliente (planilha PRECOS_POR_CANAL)', consultado_em: '2026-10-01', validade: '2026-12-31' }
const custos = { custo_compra: 50, frete_entrada: 0, embalagem: 0, preparo: 0, outros: 0, fonte: 'manual' }

// ── critério 15: exemplo da spec C=50, t=20%, m=20% → 83,333… ─────────────────
ok('exemplo da spec: preço para margem 20% = 83,33 (exato 83,333…), arredondado e margem recalculada', () => {
  const r = P.calcular({ custos, regra, margem_alvo_pct: 20 })
  assert.deepEqual(r.bloqueios, [])
  assert.equal(r.metodo, 'formula_simplificada')
  assert.equal(r.preco_alvo.preco, 83.33)
  assert.ok(Math.abs(r.preco_alvo.exato - 83.333333) < 1e-5)
  assert.equal(r.preco_alvo.margem_pct, 19.99)                    // recalculada no preço operacional: 8333 − 1000 − 667 − 5000 = 1666 centavos → 19,99% (arredondar p/ baixo perde margem; é o fato)
  assert.equal(r.simulacao, false)                                // tudo informado, com fonte e validade
  const m = r.preco_para_margem(20)
  assert.equal(m.operacional, 83.33); assert.equal(m.margem_operacional_pct, 19.99)
})
ok('arredondamento operacional configurável: centavos → 83,33; final 90 → 83,90 (e nunca abaixo do exato)', () => {
  assert.equal(arredondarPreco(83.3333, { modo: 'centavos' }), 83.33)
  assert.equal(arredondarPreco(83.3333, { modo: 'final', finais: ['90'] }), 83.9)
  assert.equal(arredondarPreco(83.95, { modo: 'final', finais: ['90'] }), 84.9)
  assert.equal(arredondarPreco(83.9, { modo: 'final', finais: ['90'] }), 83.9)
  assert.equal(arredondarPreco(83.3333, { modo: 'final', finais: ['49', '99'] }), 83.49)
  const P90 = criarPreco({ cfg: { arredondamento_preco: { modo: 'final', finais: ['90'] } }, agora: () => '2026-10-07' })
  const r = P90.calcular({ custos, regra, margem_alvo_pct: 20 })
  assert.equal(r.preco_alvo.preco, 83.9)
  assert.ok(r.preco_alvo.margem_pct > 20, 'preço arredondado para cima tem margem acima da alvo')
})
ok('contribuição em um preço dado: P×(1−t)−C em centavos, composição com base declarada', () => {
  const r = P.calcular({ custos, regra, preco: 100 })
  assert.equal(r.contribuicao, 30); assert.equal(r.margem_pct, 30)
  assert.equal(r.piso, 71.43)                                      // 50 / 0,70
  assert.equal(r.abaixo_do_piso, false)
  const itens = Object.fromEntries(r.composicao.map(c => [c.item, c]))
  assert.equal(itens.comissao.valor, -12); assert.equal(itens.comissao.base, 'receita_considerada')
  assert.equal(itens.tributos.valor, -8); assert.equal(itens.custo_compra.valor, -50); assert.equal(itens.contribuicao.valor, 30)
  assert.equal(r.fontes.regra.fonte, regra.fonte); assert.equal(r.fontes.bases.comissao, 'receita')
})
ok('centavos inteiros: 0,1 + 0,2 não vira 0,30000000000000004; meio centavo sobe', () => {
  assert.equal(aCentavos(0.1) + aCentavos(0.2), 30)
  assert.equal(aCentavos(1.005), 101)
  const r = P.calcular({ custos: { ...custos, custo_compra: 0.1, embalagem: 0.2 }, regra, preco: 1 })
  assert.equal(r.contribuicao, 0.5)
})

// ── desconto contado UMA vez; bases ──────────────────────────────────────────
ok('desconto: receita considerada = P×(1−d); comissão e tributos sobre a receita considerada; nada deduzido duas vezes', () => {
  const r = P.calcular({ custos, regra: { ...regra, desconto_pct: 10 }, preco: 100 })
  const it = Object.fromEntries(r.composicao.map(c => [c.item, c.valor]))
  assert.equal(it.desconto, -10); assert.equal(it.receita_considerada, 90)
  assert.equal(it.comissao, -10.8); assert.equal(it.tributos, -7.2)   // 12% e 8% de 90, não de 100
  assert.equal(r.composicao.filter(c => c.item === 'desconto').length, 1)
  assert.equal(r.contribuicao, 90 - 10.8 - 7.2 - 50)                 // 22,00
  assert.equal(r.margem_pct, r2(22 / 90 * 100))
  // preço para margem com desconto: P·(1−d)·(1−t−m) = C
  const m = r.preco_para_margem(20)
  assert.equal(m.preco, r2(50 / (0.9 * 0.6)))                       // 92,59
})
ok('base diferente (comissão sobre preço cheio) sai da fórmula fechada e vai para a simulação', () => {
  const r = P.calcular({ custos, regra: { ...regra, desconto_pct: 10, base_comissao: 'preco_cheio' }, preco: 100 })
  assert.equal(r.metodo, 'simulacao_faixa')
  assert.equal(Object.fromEntries(r.composicao.map(c => [c.item, c.valor])).comissao, -12)
})

// ── Ads: % da receita total ≠ ACOS sobre receita atribuída ───────────────────
ok('ads_modo pct_receita usa ads_pct da regra sobre a receita; acos usa acos × share atribuído; nunca ACOS sobre todas as vendas', () => {
  const a = P.calcular({ custos, regra: { ...regra, ads_pct: 5 }, preco: 100, ads_modo: 'pct_receita' })
  assert.equal(Object.fromEntries(a.composicao.map(c => [c.item, c.valor])).ads, -5)
  const b = P.calcular({ custos, regra, preco: 100, ads_modo: 'acos', acos_pct: 20, receita_ads_share: 0.3 })
  const ads = b.composicao.find(c => c.item === 'ads')
  assert.equal(ads.valor, -6); assert.equal(ads.base, 'receita_atribuida_ads')     // 20% de (30% de 100)
  assert.equal(b.simulacao, false)
  const c = P.calcular({ custos, regra, preco: 100, ads_modo: 'acos', acos_pct: 20 })
  assert.equal(c.simulacao, true, 'ACOS sem share atribuído → simulação')
  assert.ok(c.pendencias.some(p => /receita_ads_share/.test(p)))
  assert.equal(P.calcular({ custos, regra, preco: 100 }).composicao.some(x => x.item === 'ads'), false)
})

// ── critério 4: sem custo não há preço automático ────────────────────────────
ok('custo ausente/zero/negativo bloqueia (custo_ausente), simulacao=true e nenhum número é inventado', () => {
  for (const c of [null, {}, { custo_compra: 0 }, { custo_compra: -1 }, { custo_compra: '' }, { custo_compra: 'abc' }]) {
    const r = P.calcular({ custos: c, regra, preco: 100, margem_alvo_pct: 20 })
    assert.ok(r.bloqueios.includes('custo_ausente'), JSON.stringify(c)); assert.equal(r.simulacao, true)
    assert.equal(r.contribuicao, null); assert.equal(r.piso, null); assert.equal(r.preco_alvo, null)
    assert.equal(r.preco_para_margem(20).preco, null)
  }
})
ok('regra ausente / sem comissão / tributo não parametrizado / vencida → bloqueios nomeados (nenhuma alíquota presumida)', () => {
  assert.ok(P.calcular({ custos, regra: null, preco: 100 }).bloqueios.includes('regra_ausente'))
  assert.ok(P.calcular({ custos, regra: { ...regra, comissao_pct: null }, preco: 100 }).bloqueios.includes('regra_ausente'))
  assert.ok(P.calcular({ custos, regra: { ...regra, tributos_pct: undefined }, preco: 100 }).bloqueios.includes('tributo_nao_parametrizado'))
  assert.ok(P.calcular({ custos, regra: { ...regra, validade: '2026-10-01' }, preco: 100 }).bloqueios.includes('regra_vencida'))
  assert.deepEqual(P.calcular({ custos, regra: { ...regra, validade: '2026-10-07T12:00:00.000Z' }, preco: 100 }).bloqueios, [])
  for (const b of BLOQUEIOS) assert.equal(typeof b, 'string')
})
ok('denominador ≤ 0 bloqueia: t=70% e m=30% não tem preço', () => {
  const r = P.calcular({ custos, regra: { ...regra, comissao_pct: 62 }, margem_alvo_pct: 30 })
  assert.ok(r.bloqueios.includes('denominador_nao_positivo'))
  assert.equal(r.preco_alvo, null)
  assert.ok(/não existe preço/.test(r.preco_para_margem(30).motivo))
})
ok('componentes secundários não informados contam como 0 mas marcam simulação (ausência ≠ zero confiável)', () => {
  const r = P.calcular({ custos: { custo_compra: 50 }, regra, preco: 100 })
  assert.equal(r.contribuicao, 30); assert.equal(r.simulacao, true)
  assert.deepEqual(r.fontes.nao_informados, ['frete_entrada', 'embalagem', 'preparo', 'outros'])
  assert.equal(P.calcular({ custos, regra: { ...regra, fonte: '' }, preco: 100 }).simulacao, true, 'regra sem fonte → simulação')
})

// ── tarifa por faixa e subsídio condicional: simulação preço a preço ─────────
ok('simularFaixa: tarifa fixa abaixo de R$79 e frete do vendedor a partir de R$79 mudam a margem por faixa', () => {
  const rf = { ...regra, tarifa_fixa: [{ ate: 78.99, valor: 6 }], frete_vendedor: [{ a_partir_de: 79, valor: 20 }] }
  const s = P.simularFaixa([70, 78.99, 79, 120], rf, { custos })
  assert.equal(s.length, 4)
  const it = i => Object.fromEntries(s[i].composicao.map(c => [c.item, c.valor]))
  assert.equal(it(0).tarifa_fixa, -6); assert.equal(it(0).frete_vendedor, undefined)
  assert.equal(it(2).tarifa_fixa, undefined); assert.equal(it(2).frete_vendedor, -20)
  assert.ok(s[1].contribuicao > s[2].contribuicao, 'R$ 78,99 contribui mais que R$ 79,00 por causa do subsídio de frete')
  const r = P.calcular({ custos, regra: rf, preco: 100, margem_alvo_pct: 20 })
  assert.equal(r.metodo, 'simulacao_faixa')
  assert.ok(r.preco_alvo.margem_pct >= 20)
  // menor preço que atinge 20%: abaixo de 79 com tarifa 6 → (50+6)/0,6 = 93,33 > 79, então cai na faixa com frete 20 → (50+20)/0,6 = 116,67
  assert.equal(r.preco_alvo.preco, 116.67)
  assert.ok(r.piso < r.preco_alvo.preco)
})
ok('preço abaixo do piso é sinalizado (abaixo_do_piso) sem alterar nada sozinho', () => {
  const r = P.calcular({ custos, regra, preco: 60 })
  assert.equal(r.abaixo_do_piso, true); assert.equal(r.piso, 71.43); assert.equal(r.preco, 60)
})
ok('margem_min ausente → sem piso (pendência, não bloqueio) e simulação', () => {
  const r = P.calcular({ custos, regra: { ...regra, margem_min_pct: null }, preco: 100 })
  assert.equal(r.piso, null); assert.deepEqual(r.bloqueios, []); assert.equal(r.simulacao, true)
  assert.ok(r.pendencias.some(p => /margem_min_pct/.test(p)))
})

function r2(x) { return Math.round(x * 100) / 100 }
console.log(`teste-ofertas-preco: ${n} verificações OK`)
