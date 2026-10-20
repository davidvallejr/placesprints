// Autoteste da V3 F9 — os 8 relatórios (src/lib/relatorios-ciclo.js puro + relatorios-ciclo-real.js + src/rotas-relatorios-ciclo.js). Banco EM MEMÓRIA (PS_DB_MEMORIA=1),
// nunca data/db.sqlite; nenhuma chamada ao ML. Por relatório: fórmula, ausente ≠ zero, centavos inteiros, sem custo = sem lucro; razão append-only; pedidos ao fornecedor
// (estados, prévia, `por`, entrada no razão); isolamento por cliente; rotas (404 sem eco, 415, CSV = a mesma função, HTML de 1 página); blocos de terça desligados.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('o teste só roda em memória')
const R = await import('../src/lib/relatorios-ciclo.js')
const { criarErp, localDaLinha } = await import('../src/lib/relatorios-ciclo-real.js')
const { criarRotasRelatoriosCiclo } = await import('../src/rotas-relatorios-ciclo.js')

let n = 0
const ok = async (nome, fn) => { await fn(); n++; console.log('✔', nome) }
const C = { tendencia_limites: [0.7, 1.5], ciclo_compra_dias: 30 }
const Lm = { lead_time_reposicao_dias: 21, estoque_seguranca_dias: 7 }
const premissa = p => ({ p, n: 0, fonte: 'premissa inicial' })
const prod = (o = {}) => ({ chave: 'sku:a', nome: 'Produto A', curva: 'A', situacao: 'ok', estoque: 56, local: { full: 0, proprio: 56 }, u: 28, u14: 14, receita_c: 280000, receita14_c: 140000,
  custo_unit_c: null, lead: { dias: 21, fonte: 'premissa' }, pedir: null, fin: null, ads: null, saida: null, ...o })
function base(o = {}) {
  const B = {
    cliente: 'Cliente A', hoje: '2026-10-15', mes: '2026-10', disponivel: true, janela: { de: '2026-09-17', ate: '2026-10-14', dias: 28, dias_coleta: 28 },
    cfg: { C, L: Lm, minimo: 0.8, fator_roas_marginal: [0.5, 0.7] },
    chances: { estoque_ruptura: premissa(0.85), ads_escalar: premissa(0.5), margem_negativa: premissa(0.5), envio_atrasado: premissa(0.5) },
    conta: { receita28_c: 2800000, receita14_c: 1400000, fin: null, ads: null,
      mes: { ini: '2026-10-01', ate: '2026-10-14', dias_total: 31, dias_fechados: 14, dias_coleta: 14, receita_c: 1400000, fin: null, dias_linhas: 14, ads_c: null, compras_c: null, compras_motivo: 'nenhuma compra registrada' },
      dre: { disponivel: false, motivo: 'sem linhas' }, saude: { taxa_atraso: null, atrasos: null }, envios: { total: 0, lidos: 0 }, frete_medio_c: null,
      local: { full: { un: 0, pedidos: 0 }, proprio: { un: 0, pedidos: 0 }, desconhecido: { un: 0, pedidos: 0 }, dias: 0 }, recebiveis: null, parado: [], parado_lido: false, lead_conta: null },
    produtos: [prod()], compras_forn: [], movs: [], vendas_razao: [], pedidos: [], anuncios: [],
  }
  return { ...B, ...o, conta: { ...B.conta, ...(o.conta || {}), mes: { ...B.conta.mes, ...(o.conta?.mes || {}) } } }
}
const linha = (rel, met, sec = 'conta') => rel.secoes.find(s => s.chave === sec)?.linhas.find(l => l.metrica === met)
const inteiros = rel => { for (const s of rel.secoes) for (const l of s.linhas) for (const c of [l.previsao, l.medido]) if (c.u === 'c' && c.v != null) for (const x of [].concat(c.v)) assert.ok(Number.isInteger(x), `${rel.nome}/${l.metrica}: centavos inteiros (${x})`) }
const semZeroInventado = rel => { for (const s of rel.secoes) for (const l of s.linhas) for (const c of [l.previsao, l.medido]) if (c.v == null) { assert.equal(c.txt, '—'); assert.ok(c.motivo, `${rel.nome}/${l.metrica}: «—» com motivo`) } }

await ok('células: «—» com motivo (nunca zero), faixa do menor ao maior, centavos só formatados na saída, chance só calibrada', () => {
  assert.deepEqual(R.cel(null, 'c', 'x'), { v: null, u: 'c', txt: '—', motivo: 'x' })
  assert.equal(R.cel(0, 'c').txt, 'R$ 0,00', 'zero MEDIDO é zero')
  assert.equal(R.cel(123456, 'c').txt, 'R$ 1.234,56')
  assert.equal(R.cel([500, 300], 'c').txt, 'R$ 3,00 a R$ 5,00'); assert.deepEqual(R.cel([500, 300], 'c').v, [500, 300], 'o valor guarda [conservador, base]')
  assert.equal(R.cel([1, NaN], 'un').txt, '—')
  assert.equal(R.chanceCel(premissa(0.85)).txt, 'sem calibração ainda'); assert.match(R.chanceCel(premissa(0.85)).motivo, /premissa 85%/)
  assert.equal(R.chanceCel({ p: 0.62, n: 12, fonte: 'calibrado' }).txt, '62%')
  assert.equal(R.COLUNAS.length, 6); assert.equal(R.NOMES.length, 8)
})

await ok('1. ciclo financeiro: vendas = série 28 d; previsão = ritmo × 30 × tendência; prazo de recebimento e a receber «—» sem liberação; a pagar = pedidos em aberto', () => {
  let r = R.montarRelatorio('ciclo_financeiro', base())
  assert.equal(linha(r, 'Vendas (28 d fechados)').medido.v, 2800000)
  assert.deepEqual(linha(r, 'Vendas (28 d fechados)').previsao.v, [3000000, 3000000], 'tendência 1 → 100.000/dia × 30')
  r = R.montarRelatorio('ciclo_financeiro', base({ conta: { receita14_c: 2100000 } }))                // 14 d acima da média: fator 1,5 só no base
  assert.deepEqual(linha(r, 'Vendas (28 d fechados)').previsao.v, [3000000, 4500000])
  assert.equal(linha(r, 'Prazo médio de recebimento (venda → liberação)').medido.v, null)
  assert.equal(linha(r, 'A pagar a fornecedores (pedidos em aberto)').medido.v, null, 'sem pedido registrado não é «R$ 0»')
  r = R.montarRelatorio('ciclo_financeiro', base({ compras_forn: [{ produto: 'sku:a', estado: 'pedida', valor_c: 12345, prevista_em: '2026-10-20', atualizado_em: 'x' }, { produto: 'sku:a', estado: 'recebida', valor_c: 999, atualizado_em: 'y' }] }))
  assert.equal(linha(r, 'A pagar a fornecedores (pedidos em aberto)').medido.v, 12345)
  inteiros(r); semZeroInventado(r)
})

await ok('2. ciclo de compras: Σ sugestão; valor só com custo em todos; prazo medido = média pedida → recebida; chance «sem calibração ainda» até calibrar', () => {
  const p1 = prod({ pedir: { conservador: 10, base: 15, quando: { agora: true, data: '2026-10-15', dias: 0 } }, custo_unit_c: 1000 })
  const p2 = prod({ chave: 'sku:b', nome: 'B', pedir: { conservador: 4, base: 6, quando: { agora: false, data: '2026-10-30', dias: 15 } } })
  let r = R.montarRelatorio('ciclo_compras', base({ produtos: [p1, p2] }))
  assert.deepEqual(linha(r, 'Compras sugeridas pelo Algoritmo').previsao.v, [14, 21])
  assert.equal(linha(r, 'Valor das compras sugeridas').previsao.v, null, 'sem custo em B: sem valor')
  assert.equal(linha(r, 'Compras sugeridas pelo Algoritmo').chance.txt, 'sem calibração ainda')
  r = R.montarRelatorio('ciclo_compras', base({ produtos: [p1, { ...p2, custo_unit_c: 500 }], chances: { ...base().chances, estoque_ruptura: { p: 0.7, n: 40, fonte: 'calibrado' } },
    compras_forn: [{ produto: 'sku:a', estado: 'recebida', pedida_em: '2026-09-01', recebida_em: '2026-09-11', atualizado_em: '1' }, { produto: 'sku:b', estado: 'recebida', pedida_em: '2026-09-01', recebida_em: '2026-09-21', atualizado_em: '2' }] }))
  assert.deepEqual(linha(r, 'Valor das compras sugeridas').previsao.v, [10 * 1000 + 4 * 500, 15 * 1000 + 6 * 500])
  assert.equal(linha(r, 'Prazo do fornecedor (declarado × medido)').medido.v, 15); assert.equal(linha(r, 'Prazo do fornecedor (declarado × medido)').previsao.v, 21)
  assert.equal(linha(r, 'Compras sugeridas pelo Algoritmo').chance.txt, '70%')
  inteiros(r); semZeroInventado(r)
})

await ok('3. ciclo de estoque: dias = estoque ÷ vendas/dia; capital só com custo; razão: contagem + entradas − vendas pagas depois (venda do dia da contagem já está nela)', () => {
  let r = R.montarRelatorio('ciclo_estoque', base())
  assert.equal(linha(r, 'Dias de estoque (cobertura)').medido.v, 56, '56 un ÷ 1/dia')
  assert.equal(linha(r, 'Capital em estoque').medido.v, null)
  assert.equal(linha(r, 'Razão de estoque (movimentos)').medido.v, null, 'sem contagem: sem saldo')
  r = R.montarRelatorio('ciclo_estoque', base({ produtos: [prod({ custo_unit_c: 1050 })] }))
  assert.equal(linha(r, 'Capital em estoque').medido.v, 56 * 1050)
  const movs = [{ id: 1, produto: 'sku:a', local: 'proprio', origem: 'contagem', quantidade: 10, fato_em: '2026-10-01' }, { id: 2, produto: 'sku:a', local: 'proprio', origem: 'compra', quantidade: 5, fato_em: '2026-10-03' }]
  const vendas = [{ produto: 'sku:a', dia: '2026-10-01', quantidade: 9, local: 'proprio' }, { produto: 'sku:a', dia: '2026-10-05', quantidade: 3, local: 'proprio' }, { produto: 'sku:a', dia: '2026-10-06', quantidade: 2, local: 'full' }, { produto: 'sku:a', dia: '2026-10-06', quantidade: 4, local: 'desconhecido' }]
  assert.deepEqual(R.saldoRazao(movs, vendas, 'proprio'), { saldo: 12, ancora: '2026-10-01', contado: 10, movimentos: 1, vendido: 3 })
  assert.equal(R.saldoRazao(movs, vendas, 'full'), null)
  r = R.montarRelatorio('ciclo_estoque', base({ movs, vendas_razao: vendas }))
  assert.match(linha(r, 'Zera em', 'produto').nota, /razão próprio: 12 un \(contagem 01\/10; -44 un × ML\)/)
  inteiros(r); semZeroInventado(r)
})

await ok('4. logística: Full × próprio pelas linhas; prazos «—» sem datas; atrasos previstos = pedidos próprios/dia × 7 × taxa', () => {
  assert.equal(localDaLinha({ deposito_node: 'BRP1', deposito_store: '86' }), 'proprio'); assert.equal(localDaLinha({ deposito_node: 'BRSP02', deposito_store: '' }), 'full'); assert.equal(localDaLinha({}), 'desconhecido')
  const r = R.montarRelatorio('logistica', base({ conta: { saude: { taxa_atraso: 10, atrasos: null, atrasos_motivo: 'pendente: indisponivel' }, local: { full: { un: 6, pedidos: 5 }, proprio: { un: 20, pedidos: 20 }, desconhecido: { un: 0, pedidos: 0 }, dias: 10 } } }))
  assert.equal(linha(r, 'Vendas pelo Full').medido.v, 6)
  assert.deepEqual(linha(r, 'Atrasos previstos nos próximos 7 dias').previsao.v, [1, 1], '2/dia × 7 × 10% = 1,4 → 1')
  assert.equal(linha(r, 'Prazo de despacho (pago → despachado)').medido.v, null)
  assert.equal(linha(r, 'Envios com despacho vencido agora').medido.v, null, 'não lido ≠ zero atrasos')
  semZeroInventado(r)
})

await ok('5. escalabilidade: compra = ritmo × (1+g) × horizonte − estoque; capital só com custo; Ads = crescimento ÷ (retorno × fator); gargalo do prazo do fornecedor', () => {
  // 1/dia, estoque 10, prazo 21: zera em 10/(1,1) < 21 → gargalo prazo; horizonte 21+30+7 = 58 → ceil(1 × 1,1 × 58 − 10) = 54
  const p = prod({ estoque: 10, local: { full: 0, proprio: 10 } })
  let r = R.montarRelatorio('escalabilidade', base({ produtos: [p], conta: { ads: { custo_c: 100000, receita_c: 400000 } } }))
  const l = r.secoes[0].linhas
  assert.deepEqual(l.find(x => x.item === '+10%' && x.metrica === 'Estoque a comprar').previsao.v, [54, 54])
  assert.equal(l.find(x => x.item === '+10%' && x.metrica === 'Capital para o estoque').previsao.v, null, 'sem custo, sem capital')
  assert.deepEqual(l.find(x => x.item === '+10%' && x.metrica === 'Ads a mais em 28 d').previsao.v, [Math.round(280000 / (4 * 0.5)), Math.round(280000 / (4 * 0.7))])
  assert.match(l.find(x => x.item === '+10%' && x.metrica === 'Gargalo').previsao.txt, /prazo do fornecedor/)
  r = R.montarRelatorio('escalabilidade', base({ produtos: [{ ...p, custo_unit_c: 200 }] }))
  assert.deepEqual(r.secoes[0].linhas.find(x => x.item === '+50%' && x.metrica === 'Capital para o estoque').previsao.v, [77 * 200, 77 * 200])
  inteiros(r); semZeroInventado(r)
})

await ok('6. lucro: sem custo = sem lucro («—» com o motivo); com lucro medido, projeção = margem medida × receita prevista; projeção do mês = medido + ritmo × dias restantes', () => {
  let r = R.montarRelatorio('lucro', base({ conta: { fin: { receita_c: 2800000, lucro_c: null, cobertura_custo: 0, motivo: 'custo não informado em 100% da receita' } } }))
  const lc = linha(r, 'Lucro de contribuição')
  assert.equal(lc.medido.v, null); assert.match(lc.medido.motivo, /sem custo, sem lucro/); assert.equal(lc.previsao.v, null)
  assert.deepEqual(linha(r, 'Receita (série do ML, mês até ontem)').previsao.v, [1400000 + 100000 * 17, 1400000 + 100000 * 17])
  r = R.montarRelatorio('lucro', base({ conta: { fin: { receita_c: 2800000, receita_coberta_c: 2000000, lucro_c: 400000, margem_pct: 20, antes_do_imposto: true, cobertura_custo: 0.9 } },
    produtos: [prod({ fin: { lucro_c: 50000, receita_coberta_c: 250000, margem_pct: 20, cobertura_custo: 1 } })] }))
  assert.equal(linha(r, 'Lucro de contribuição').medido.v, 400000)
  assert.deepEqual(linha(r, 'Lucro de contribuição').previsao.v, [600000, 600000], '3.000.000 × 400.000 ÷ 2.000.000')
  assert.equal(linha(r, 'Lucro 28 d', 'produto').medido.v, 50000)
  inteiros(r); semZeroInventado(r)
})

await ok('7. caixa: = líquido − Ads − compras; qualquer parcela ausente deixa o total «—» (compra não registrada ≠ R$ 0); projeção proporcional à receita', () => {
  const fin = { receita_c: 1400000, receita_tf_c: 1400000, receita_liquida_c: 1100000, cobertura_taxas_frete: 1 }
  let r = R.montarRelatorio('caixa', base({ conta: { mes: { fin, ads_c: 50000 } } }))
  assert.equal(linha(r, '= Caixa gerado (competência)').medido.v, null, 'compras não registradas')
  assert.equal(linha(r, '(−) Compras ao fornecedor').medido.v, null)
  r = R.montarRelatorio('caixa', base({ conta: { mes: { fin, ads_c: 50000, compras_c: 200000 } } }))
  assert.equal(linha(r, '= Caixa gerado (competência)').medido.v, 850000)
  assert.equal(linha(r, '(−) Tarifas, frete e reembolsos').medido.v, 300000)
  const f = (1400000 + 1700000) / 1400000; assert.deepEqual(linha(r, '= Caixa gerado (competência)').previsao.v, [Math.round(850000 * f), Math.round(850000 * f)])
  r = R.montarRelatorio('caixa', base({ conta: { mes: { fin, ads_c: null, compras_c: 200000 } } }))
  assert.equal(linha(r, '= Caixa gerado (competência)').medido.v, null, 'Ads do mês não coletado')
  inteiros(r); semZeroInventado(r)
})

await ok('8. reinvestimento: ordem = retorno esperado × p; sem custo = sem retorno; «pode voltar» = menor entre caixa e opções boas; nunca ordem', () => {
  const fin = { receita_c: 1400000, receita_tf_c: 1400000, receita_liquida_c: 1100000, cobertura_taxas_frete: 1 }
  const a = prod({ chave: 'sku:a', nome: 'A', u: 28, receita_c: 280000, pedir: { conservador: 10, base: 20 }, custo_unit_c: 4000, fin: { margem_pct: 20, lucro_c: 56000 } })    // lucro/un = 2.000
  const b = prod({ chave: 'sku:b', nome: 'B', u: 28, receita_c: 560000, pedir: { conservador: 10, base: 20 }, custo_unit_c: 8000, fin: { margem_pct: 25, lucro_c: 140000 } })   // lucro/un = 5.000
  const c = prod({ chave: 'sku:c', nome: 'C', pedir: { conservador: 5, base: 5 } })
  const r = R.montarRelatorio('reinvestimento', base({ produtos: [a, c, b], conta: { mes: { fin, ads_c: 0, compras_c: 0 } } }))
  const ps = r.secoes[1].linhas
  assert.deepEqual(ps.map(l => l.item), ['B', 'A', 'C'])
  assert.deepEqual(ps[0].previsao.v, [50000, 100000]); assert.equal(ps[2].previsao.v, null)
  assert.equal(linha(r, 'Pode voltar para estoque/Ads').previsao.v, Math.min(1100000, 20 * 8000 + 20 * 4000))
  assert.ok(ps.every(l => /nunca ordem/.test(l.nota)))
  inteiros(r); semZeroInventado(r)
})

await ok('montarRelatorio: nome fora da lista = 404 sem eco; base indisponível = disponivel:false com o motivo; blocos de terça desligados = []', () => {
  assert.throws(() => R.montarRelatorio('xpto<script>', base()), e => e.status === 404 && !/xpto/.test(e.message))
  const r = R.montarRelatorio('lucro', { cliente: 'X', disponivel: false, motivo: 'sem coleta' }); assert.equal(r.disponivel, false); assert.equal(r.motivo, 'sem coleta')
  const rels = Object.fromEntries(['lucro', 'caixa', 'ciclo_compras', 'ciclo_estoque'].map(k => [k, R.montarRelatorio(k, base())]))
  assert.deepEqual(R.blocosTerca(rels), []); assert.deepEqual(R.blocosTerca(rels, { ligado: false }), [])
  assert.ok(R.blocosTerca(rels, { ligado: true }).every(t => !t.includes('—')), 'ligado: nunca frase com «—»')
})

await ok('CSV = a mesma função da tela (BOM, «;», uma linha por linha do relatório, fórmula neutralizada); HTML de 1 página com «falta para ficar completo»', () => {
  const r = R.montarRelatorio('ciclo_estoque', base({ produtos: [prod({ nome: '=HYPERLINK("x")' })] }))
  const csv = R.paraCsv(r), ls = csv.split('\r\n')
  assert.ok(csv.startsWith('﻿')); assert.equal(ls.length, 1 + r.secoes.reduce((t, s) => t + s.linhas.length, 0))
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'fórmula neutralizada')
  const h = R.paraHtml(r); assert.match(h, /<title>Ciclo de estoque<\/title>/); assert.match(h, /Falta para ficar completo/); assert.ok(!h.includes('=HYPERLINK("x")'), 'escapado')
})

// ── banco: razão append-only, pedidos ao fornecedor, isolamento ──
const quem = new Set(['Ana'])
const erp = criarErp({ agora: () => '2026-10-15T12:00:00Z', hoje: () => '2026-10-15', validarPor: n => (quem.has(n) ? n : '') })
await ok('razão: prévia não grava; `por` validado; contagem pode ser 0; envio ao Full = saída do próprio + entrada no Full; repetido = 409; UPDATE/DELETE barrados', () => {
  const pv = erp.registrarMov({ cliente: 'Cliente A', produto: 'sku:a', local: 'proprio', origem: 'contagem', quantidade: 0, fato_em: '2026-10-10' })
  assert.equal(pv.previa, true); assert.equal(erp.listarMovs('Cliente A').length, 0)
  assert.throws(() => erp.registrarMov({ cliente: 'Cliente A', produto: 'sku:a', local: 'proprio', origem: 'contagem', quantidade: 0, fato_em: '2026-10-10', por: 'Zé', confirmar: true }), e => e.status === 403)
  erp.registrarMov({ cliente: 'Cliente A', produto: 'sku:a', local: 'proprio', origem: 'contagem', quantidade: 0, fato_em: '2026-10-10', por: 'Ana', confirmar: true })
  assert.throws(() => erp.registrarMov({ cliente: 'Cliente A', produto: 'sku:a', local: 'proprio', origem: 'contagem', quantidade: 3, fato_em: '2026-10-10', por: 'Ana', confirmar: true }), e => e.status === 409, '1 contagem por produto/local/dia')
  erp.registrarMov({ cliente: 'Cliente A', produto: 'sku:a', local: 'proprio', origem: 'envio_full', quantidade: 4, fato_em: '2026-10-11', por: 'Ana', confirmar: true })
  const m = erp.listarMovs('Cliente A'); assert.equal(m.length, 3)
  assert.deepEqual(m.filter(x => x.origem === 'envio_full').map(x => [x.local, x.quantidade]).sort(), [['full', 4], ['proprio', -4]])
  for (const bad of [{ quantidade: 0, origem: 'ajuste' }, { quantidade: 1.5, origem: 'ajuste' }, { quantidade: -1, origem: 'compra' }, { quantidade: 1, origem: 'linha_pedido' }, { quantidade: 1, origem: 'ajuste', fato_em: '2099-01-01' }, { quantidade: 1, origem: 'ajuste', produto: 'qualquer' }])
    assert.throws(() => erp.registrarMov({ cliente: 'Cliente A', produto: 'sku:a', local: 'proprio', fato_em: '2026-10-12', ...bad }), e => e.status === 400)
  assert.throws(() => db.prepare("UPDATE estoque_mov SET quantidade = 99 WHERE cliente = 'Cliente A'").run(), /alteracao proibida/)
  assert.throws(() => db.prepare("DELETE FROM estoque_mov WHERE cliente = 'Cliente A'").run(), /exclusao proibida/)
})

await ok('pedidos ao fornecedor: sugerida → pedida → recebida (com entrada «compra» no razão e custo unitário do valor); transição proibida = 409; isolamento por cliente', () => {
  const s = erp.salvarCompra({ cliente: 'Cliente A', produto: 'sku:a', estado: 'pedida', qtd_pedida: 10, valor_c: 10000, prevista_em: '2026-10-30', pedida_em: '2026-10-01', por: 'Ana', confirmar: true })
  assert.match(s.id, /^CF-[0-9a-f]{10}$/)
  assert.throws(() => erp.salvarCompra({ cliente: 'Cliente A', id: s.id, estado: 'sugerida', qtd_sugerida_cons: 1, qtd_sugerida_base: 2, por: 'Ana', confirmar: true }), e => e.status === 409)
  assert.throws(() => erp.salvarCompra({ cliente: 'Cliente A', id: s.id, estado: 'recebida', qtd_recebida: 9, recebida_em: '2026-09-30', por: 'Ana', confirmar: true }), e => e.status === 400, 'recebida antes de pedida')
  assert.throws(() => erp.salvarCompra({ cliente: 'Cliente B', id: s.id, estado: 'recebida', qtd_recebida: 9, por: 'Ana', confirmar: true }), e => e.status === 404, 'o pedido de A não existe para B')
  const pv = erp.salvarCompra({ cliente: 'Cliente A', id: s.id, estado: 'recebida', qtd_recebida: 9, recebida_em: '2026-10-12' }); assert.equal(pv.previa, true)
  assert.equal(erp.listarCompras('Cliente A')[0].estado, 'pedida', 'prévia não grava')
  erp.salvarCompra({ cliente: 'Cliente A', id: s.id, estado: 'recebida', qtd_recebida: 9, recebida_em: '2026-10-12', por: 'Ana', confirmar: true })
  const e = erp.listarMovs('Cliente A').find(x => x.origem === 'compra'); assert.equal(e.quantidade, 9); assert.equal(e.custo_unit_c, 1000)
  assert.equal(erp.listarCompras('Cliente B').length, 0); assert.equal(erp.listarMovs('Cliente B').length, 0)
})

await ok('rotas: lista, JSON, CSV (BOM, text/csv), HTML; nome desconhecido/prospect/cliente fora = 404 sem eco; POST sem JSON = 415; prévia por padrão', async () => {
  const relStub = (c, nome) => R.montarRelatorio(nome, base({ cliente: c }))
  const app = express(); app.use(express.json())
  app.use(criarRotasRelatoriosCiclo({ relatorio: relStub, erp, clienteCanonico: c => (c === 'Cliente A' ? 'Cliente A' : '') }))
  const srv = app.listen(0), u = `http://127.0.0.1:${srv.address().port}`
  try {
    let r = await fetch(`${u}/api/cliente/relatorios?cliente=Cliente%20A`); assert.equal((await r.json()).relatorios.length, 8)
    r = await fetch(`${u}/api/cliente/relatorios/lucro?cliente=Cliente%20A`); const j = await r.json(); assert.equal(j.nome, 'lucro'); assert.equal(j.colunas.length, 6)
    r = await fetch(`${u}/api/cliente/relatorios/caixa.csv?cliente=Cliente%20A`); assert.match(r.headers.get('content-type'), /text\/csv/)
    const t = await r.text(); assert.equal(t, R.paraCsv(relStub('Cliente A', 'caixa')).replace(/^﻿/, ''), 'CSV = a mesma função da tela')
    r = await fetch(`${u}/api/cliente/relatorios/caixa.html?cliente=Cliente%20A`); assert.match(await r.text(), /Geração de caixa/)
    for (const q of ['/api/cliente/relatorios/inventado?cliente=Cliente%20A', '/api/cliente/relatorios/lucro?cliente=%5BComercial%5D%20X', '/api/cliente/relatorios/lucro?cliente=Outro']) {
      r = await fetch(u + q); assert.equal(r.status, 404); const b = await r.text(); assert.ok(!/inventado|Outro|Comercial/.test(b), 'sem eco')
    }
    r = await fetch(`${u}/api/cliente/relatorios/lucro.pdf?cliente=Cliente%20A`); assert.equal(r.status, 503, 'sem gerarPdf injetado = 503 com a orientação')
    r = await fetch(`${u}/api/cliente/estoque/mov`, { method: 'POST', body: 'x' }); assert.equal(r.status, 415)
    r = await fetch(`${u}/api/cliente/compras/pedidos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cliente: 'Cliente A', produto: 'sku:z', estado: 'pedida', qtd_pedida: 1 }) })
    const pv = await r.json(); assert.equal(pv.previa, true); assert.equal(erp.listarCompras('Cliente A').some(x => x.produto === 'sku:z'), false)
  } finally { srv.close() }
})

await ok('isolamento: toda consulta de relatorios-ciclo-real.js filtra por cliente = ?; o puro não abre banco', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/relatorios-ciclo-real.js', import.meta.url), 'utf8')
  const sqls = [...src.matchAll(/db\.prepare\(\s*([`'"])([\s\S]*?)\1/g)].map(m => m[2]).filter(q => /\bFROM\b/i.test(q))
  assert.ok(sqls.length >= 15, `consultas achadas: ${sqls.length}`)
  for (const q of sqls) for (const parte of q.split(/\(\s*SELECT/i)) if (/\bFROM\b/i.test(parte)) assert.match(parte, /cliente = \?/, `sem filtro de cliente: ${parte.slice(0, 80)}`)
  const puro = readFileSync(new URL('../src/lib/relatorios-ciclo.js', import.meta.url), 'utf8'); assert.doesNotMatch(puro, /from '\.\/db\.js'|better-sqlite3|fetch\(/)
})

console.log(`\n${n} verificações da F9 (relatórios) ok.`)
