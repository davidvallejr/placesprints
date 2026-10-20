// Autoteste da atribuição tarefa → resultado: séries SINTÉTICAS com efeito plantado (sem rede). O caso 22 grava num banco EM MEMÓRIA (data/db.sqlite nem é aberto).
import assert from 'node:assert/strict'
process.env.PS_DB_MEMORIA = '1'
const { medirEfeito, confiancaEfeito, wilson, agruparPadroes, somarSeries, alocarIncremental, marcarPreco, marcarEstado, fraseEstado, intervencoesEstado, excluirDaAprendizagem, analisarCliente, medirMarco } = await import('../src/lib/impacto-tarefas.js')
const { cfgAtrib, addDias } = await import('../src/lib/meli-serie.js')
const { db } = await import('../src/lib/db.js')

const HOJE = '2026-10-05', COB = { de: '2026-05-09', ate: '2026-10-04' }
const dias = (de, n) => Array.from({ length: n }, (_, i) => addDias(de, i))
// série determinística com "ruído" fixo (sem Math.random): base ± variação periódica
const serie = (base, de, ate, f = () => 1, amp = 0.15) => {
  const s = {}
  for (let d = de, i = 0; d <= ate; d = addDias(d, 1), i++) s[d] = Math.max(0, Math.round(base * f(d) * (1 + amp * Math.sin(i * 1.7))))
  return s
}
const alvoDe = (u, v = null) => ({ unidades: u, receita: Object.fromEntries(Object.entries(u).map(([d, n]) => [d, n * 50])), visitas: v })
const DATA = '2026-08-20', args = (alvo, controle) => ({ alvo, controle, data: DATA, N: 14, lag: 3, cobertura: COB, hoje: HOJE, eventosPlacebo: [DATA] })   // a data da própria tarefa nunca vira placebo (como em produção)
const depois = d => d > addDias(DATA, 3)

// 1) efeito plantado +40% no alvo, controle plano → detecta, melhorou, ganho positivo
{
  const alvo = alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.4 : 1))
  const ctrl = alvoDe(serie(30, COB.de, '2026-10-04'))
  const m = medirEfeito(args(alvo, ctrl))
  assert.equal(m.estado, 'melhorou'); assert.ok(m.efeito_pct > 25 && m.efeito_pct < 55, 'efeito ~+40%: ' + m.efeito_pct)
  assert.ok(m.receita_incremental > 0); assert.ok(m.controle)
}
// 2) o MERCADO inteiro sobe +40% (alvo e controle): a tarefa NÃO leva o mérito
{
  const f = d => depois(d) ? 1.4 : 1
  const m = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', f)), alvoDe(serie(30, COB.de, '2026-10-04', f))))
  assert.ok(Math.abs(m.efeito_pct) < 12, 'DiD absorve o mercado: ' + m.efeito_pct); assert.notEqual(m.estado, 'melhorou')
  assert.ok(m.efeito_bruto_pct > 25, 'sem controle pareceria +40%')
}
// 3) sem controle → NUNCA atribui (conta inteira / sem controle)
{
  const alvo = alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.4 : 1))
  assert.equal(medirEfeito({ ...args(alvo, null), escopo: 'conta' }).estado, 'variacao_conta')
  assert.equal(medirEfeito({ ...args(alvo, null), escopo: 'anuncios' }).estado, 'sem_controle')
}
// 4) queda real de −40% com controle plano → piorou
{
  const m = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 0.6 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(m.estado, 'piorou'); assert.ok(m.efeito_pct < -25)
}
// 5) sem efeito (ruído puro) → sem_efeito, nunca "melhorou"
{
  const m = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04')), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(m.estado, 'sem_efeito')
}
// 6) janela pós incompleta → em_maturacao; histórico curto → sem_base; base mínima → sem_base
{
  const alvo = alvoDe(serie(10, COB.de, '2026-10-04')), ctrl = alvoDe(serie(30, COB.de, '2026-10-04'))
  assert.equal(medirEfeito({ ...args(alvo, ctrl), data: '2026-09-30' }).estado, 'em_maturacao')
  assert.equal(medirEfeito({ ...args(alvo, ctrl), data: '2026-05-12' }).estado, 'sem_base')
  assert.equal(medirEfeito(args(alvoDe(serie(0.1, COB.de, '2026-10-04')), ctrl)).estado === 'sem_base' || medirEfeito(args(alvoDe(serie(0.1, COB.de, '2026-10-04')), ctrl)).estado === 'lancamento', true)
}
// 7) anúncio SEM venda antes (novo/dormente) → lançamento mede desempenho pós, não razão antes/depois
{
  const u = {}; for (const d of dias(addDias(DATA, 4), 14)) u[d] = d === addDias(DATA, 9) ? 2 : 0
  const m = medirEfeito(args(alvoDe(u), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(m.estado, 'lancamento'); assert.equal(m.lancamento.vendeu, true); assert.equal(m.lancamento.unidades, 2); assert.equal(m.lancamento.primeira_venda_dias, 9)
}
// 8) visitas como métrica quando a venda é pouca; corrobora com unidades
{
  const v = serie(40, COB.de, '2026-10-04', d => depois(d) ? 1.6 : 1), u = serie(0.2, COB.de, '2026-10-04')
  const cv = serie(120, COB.de, '2026-10-04')
  const m = medirEfeito(args({ ...alvoDe(u), visitas: v }, { ...alvoDe(serie(30, COB.de, '2026-10-04')), visitas: cv }))
  assert.equal(m.metrica_primaria, 'visitas'); assert.ok(m.efeito_pct > 35)
}
// 9) confiança: declara o que falta, nunca passa de "causa provável" sem cobertura, penaliza concorrentes/eventos/data estimada
{
  const base = { efeito_pct: 40, controle: { razao: 1 }, pct_ruido: 96, p_placebo: 0.04, n_placebos: 24, sinal_z: 3, corrobora: { campo: 'visitas', pct: 35, base: 200 }, tendencia_pre_pct: 0, estado: 'melhorou' }
  const forte = confiancaEfeito({ m: base, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: 0.8 })
  assert.equal(forte.cobertura, 100); assert.ok(forte.score >= 80); assert.equal(forte.classe, 'forte evidência causal')
  const fraca = confiancaEfeito({ m: { ...base, corrobora: null, pct_ruido: null, tendencia_pre_pct: 50 }, dataEstimada: true, concorrentes: 3, eventos: ['Black Friday'], taxaHistorica: null })
  assert.ok(fraca.score < forte.score); assert.ok(fraca.cobertura < 100); assert.ok(fraca.criterios.correlacao.nota === null && fraca.criterios.consistencia.nota === null)
  assert.notEqual(fraca.classe, 'forte evidência causal')
}
// 10) Wilson (referência conhecida: 8/10 → [0,49; 0,94]); amostra pequena não vira padrão
{
  const w = wilson(8, 10); assert.ok(Math.abs(w.baixo - 0.490) < 0.01 && Math.abs(w.alto - 0.943) < 0.01)
  assert.equal(wilson(0, 0).p, null)
  const mk = (tipo, estado, n) => Array.from({ length: n }, () => ({ tipo, analista: 'A', titulo: 'x', estado, efeito_pct: 20, receita_alocada: 10, confianca: { score: 60 } }))
  const g = agruparPadroes([...mk('T1', 'melhorou', 3), ...mk('T2', 'melhorou', 8), ...mk('T2', 'sem_efeito', 2)])
  assert.equal(g.por_tipo.find(x => x.chave === 'T1').amostra_pequena, true); assert.equal(g.por_tipo.find(x => x.chave === 'T2').amostra_pequena, false)
  assert.equal(g.por_tipo[0].chave, 'T2', 'ranking por limite inferior: T2 (8/10) acima de T1 (3/3, amostra pequena)')
}
// 11) alocação: duas tarefas no MESMO anúncio e período não recebem o ganho inteiro cada uma
{
  const jan = { pre: [], pos: ['2026-09-01', '2026-09-14'], pos_medida: ['2026-09-01', '2026-09-14'] }
  const t = n => ({ cliente: 'C', escopo: 'anuncios', itens: ['MLB1'], estado: 'melhorou', janelas: jan, dias_pos: 14, receita_incremental: 1400, id: n })
  const ms = alocarIncremental([t(1), t(2)])
  assert.equal(ms[0].receita_alocada, 700); assert.equal(ms[1].receita_alocada, 700)
  assert.equal(alocarIncremental([t(3)])[0].receita_alocada, 1400)
}
// ── regressões da 3ª revisão adversarial (out/2026) ──
// 12) z direcional pelo PRÓPRIO efeito ajustado: alvo +20% com controle +50% NUNCA pode sair "melhorou"/"piorou" por uma ALTA do alvo
{
  const f = d => depois(d) ? 1.2 : 1, g = d => depois(d) ? 1.5 : 1
  const m = medirEfeito({ ...args(alvoDe(serie(10, COB.de, '2026-10-04', f)), alvoDe(serie(30, COB.de, '2026-10-04', g))), eventosPlacebo: [DATA, ...dias(COB.de, 140)] })   // sem placebos: força a via z
  assert.ok(m.efeito_pct < 0, 'efeito ajustado negativo: ' + m.efeito_pct)
  assert.ok(m.sinal_z == null || m.sinal_z < 0, 'o z tem o sinal do efeito ajustado, não o do alvo bruto')
}
// 13) mercado −40% com alvo plano: o DiD é POSITIVO e o z também (antes o z bruto dava 0 e escondia)
{
  const m = medirEfeito({ ...args(alvoDe(serie(10, COB.de, '2026-10-04')), alvoDe(serie(30, COB.de, '2026-10-04', d => depois(d) ? 0.6 : 1))), eventosPlacebo: [DATA, ...dias(COB.de, 140)] })
  assert.ok(m.efeito_pct > 30 && m.sinal_z > 0, `efeito ${m.efeito_pct} z ${m.sinal_z}`)
}
// 14) p do placebo com correção +1 e mínimo de placebos: nunca "maior que 100% do ruído"; poucos placebos → p nulo
{
  const m = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.6 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.ok(m.p_placebo != null && m.p_placebo >= 1 / (m.n_placebos + 1) - 1e-9, 'p mínimo possível é 1/(n+1)')
  assert.ok(m.pct_ruido <= Math.round(100 * (1 - 1 / (m.n_placebos + 1))))
  const poucos = medirEfeito({ ...args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.6 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))), cobertura: { de: '2026-07-20', ate: '2026-10-04' } })
  assert.equal(poucos.p_placebo, null, 'menos placebos que o mínimo: sem p')
}
// 15) quedas e altas simétricas: efeito +100% e −50% são o mesmo tamanho no placebo (escala log)
{
  const alta = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 2 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))))
  const queda = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 0.5 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(alta.estado, 'melhorou'); assert.equal(queda.estado, 'piorou', 'queda de 50% é tão detectável quanto alta de 100%')
}
// 16) regressão à média: anúncio que estava 50% abaixo do seu nível habitual e "volta" não ganha confiança de temporalidade cheia
{
  const u = serie(10, COB.de, '2026-10-04', d => d >= addDias(DATA, -14) && d < addDias(DATA, 4) ? 0.45 : 1)
  const m = medirEfeito(args(alvoDe(u), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(m.reversao_provavel, true, 'queda recente + recuperação = possível reversão à média')
  const c = confiancaEfeito({ m, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: null })
  assert.ok(c.criterios.temporalidade.nota <= 10 && /reversão/.test(c.criterios.temporalidade.base))
}
// 17) cobertura: coleta velha não vira "dia sem venda" na janela pós
{
  const m = medirEfeito({ ...args(alvoDe(serie(10, COB.de, '2026-10-04')), alvoDe(serie(30, COB.de, '2026-10-04'))), cobertura: { de: COB.de, ate: addDias(DATA, 5) } })
  assert.equal(m.estado, 'em_maturacao', 'só 2 dias pós coletados')
}
// 18) controle que "sumiu" (razão ~0) não é controle; confiança negativa por direção; nota ≥ 80 só com cobertura
{
  const m = medirEfeito({ ...args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.5 : 1)), alvoDe(serie(30, COB.de, '2026-10-04', d => depois(d) ? 0.02 : 1))), escopo: 'anuncios' })
  assert.equal(m.estado, 'sem_controle')
  const piorou = { efeito_pct: -40, controle: { razao: 1 }, pct_ruido: 96, p_placebo: 0.04, n_placebos: 20, sinal_z: -3, corrobora: { campo: 'visitas', pct: -30, base: 100 }, tendencia_pre_pct: -35, estado: 'piorou' }
  const c = confiancaEfeito({ m: piorou, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: null })
  assert.equal(c.criterios.temporalidade.nota, 10, 'queda que já vinha caindo: tendência prévia na mesma direção')
  const parcial = confiancaEfeito({ m: { ...piorou, corrobora: null, tendencia_pre_pct: 0 }, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: 0.9 })
  assert.ok(parcial.cobertura < 80 ? parcial.score < 80 : true)
}
// ── preço como fator de confusão (out/2026) ──
// 19) "melhorou" com o preço pago +8% em tarefa que NÃO é de preço → confundida e fora dos padrões (o grupo conta quantas ficaram de fora)
const comPreco = (u, f) => ({ unidades: u, receita: Object.fromEntries(Object.entries(u).map(([d, n]) => [d, n * f(d)])), visitas: null })
{
  const alvo = comPreco(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.4 : 1), d => depois(d) ? 54 : 50)
  const m = medirEfeito(args(alvo, alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(m.estado, 'melhorou'); assert.deepEqual([m.preco_realizado.antes, m.preco_realizado.depois, m.preco_realizado.variacao_pct], [50, 54, 8])
  assert.equal(m.metricas.ticket.antes, 50); assert.equal(m.metricas.ticket.depois, 54)
  const p = marcarPreco(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'] })
  assert.equal(p.confundido_preco, true); assert.equal(p.variacao_preco_pct, 8); assert.equal(p.intervencao_preco, false)
  assert.equal(excluirDaAprendizagem({ ...m, ...p }), true)
  const ok = Array.from({ length: 5 }, () => ({ tipo: 'Otimizar Anúncios', analista: 'A', titulo: 'x', estado: 'melhorou', efeito_pct: 20 }))
  const g = agruparPadroes([{ ...m, ...p, tipo: 'Otimizar Anúncios', analista: 'A', titulo: 'x' }, ...ok])
  assert.equal(g.n_medidas, 5, 'a confundida não entra nos padrões'); assert.equal(g.por_tipo[0].n, 5); assert.equal(g.por_tipo[0].confundidas_preco, 1)
  // preço pago que mexe sem o mínimo de vendas nas duas janelas não confunde (preço de 2 vendas é ruído)
  assert.equal(marcarPreco({ ...m, preco_realizado: { ...m.preco_realizado, unidades: { antes: 2, depois: 40 } } }, { tipo: 'Otimizar Anúncios' }).confundido_preco, false)
  // 20) a MESMA medida numa tarefa de preço ("Atualizar Preços", oferta relâmpago, campanha de desconto) é a própria intervenção
  for (const tipo of ['Atualizar Preços', 'Oferta Relâmpago', 'Campanhas de Desconto']) {
    const q = marcarPreco(m, { tipo, itens: ['MLB1'] }); assert.equal(q.intervencao_preco, true, tipo); assert.equal(q.confundido_preco, false, tipo)
  }
  // evento de lista ≥ limiar dentro da janela confunde; fora da janela (ou no 1º dia do "antes") não
  const ev = dia => new Map([['MLB1', [{ dia, de: 50, para: 52, pct: 4, fonte: 'coleta' }]]])
  const igual = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.4 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(marcarPreco(igual, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev(addDias(DATA, 2)) }).confundido_preco, true)
  assert.equal(marcarPreco(igual, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev(igual.janelas.pre[0]) }).eventos_preco.length, 0)
  assert.equal(marcarPreco(igual, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: new Map([['MLB1', [{ dia: addDias(DATA, 2), de: 50, para: 50.01, pct: 0.02, fonte: 'coleta' }]]]) }).confundido_preco, false, '1 centavo é evento, não confunde')
}
// 21) confiança: QUALQUER mudança de preço tira 1 ponto (com o motivo e a data); confundida tira mais 4; na tarefa de preço a mudança é a tarefa
{
  const base = { efeito_pct: 40, controle: { razao: 1 }, pct_ruido: 96, p_placebo: 0.04, n_placebos: 24, sinal_z: 3, corrobora: { campo: 'visitas', pct: 35, base: 200 }, tendencia_pre_pct: 0, estado: 'melhorou' }
  const c = x => confiancaEfeito({ m: { ...base, ...x }, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: 0.8 }).criterios.sem_concorrente
  const um = [{ item_id: 'MLB1', dia: '2026-08-25', de: 50, para: 50.01, pct: 0.02, fonte: 'coleta' }]
  assert.equal(c({}).nota, 10); assert.equal(c({ eventos_preco: um }).nota, 9, '1 centavo tira 1 ponto')
  assert.match(c({ eventos_preco: um }).base, /preço mudou R\$ 50,00 → R\$ 50,01 em 25\/08/)
  const conf = c({ eventos_preco: um, confundido_preco: true, variacao_preco_pct: 8 })
  assert.equal(conf.nota, 5); assert.match(conf.base, /preço variou \+8% na janela: o efeito pode ser do preço, não da tarefa/)
  assert.equal(c({ eventos_preco: um, intervencao_preco: true }).nota, 10, 'tarefa de preço: a mudança é a própria tarefa')
  assert.match(c({ eventos_preco: [{ ...um[0], fonte: 'acomp', incerteza: 'mudou entre 20/08 e 25/08' }] }).base, /R\$ 50,01 \(mudou entre 20\/08 e 25\/08\)/)
}
// 22) motor inteiro (banco em memória): anúncio que mudou de preço na janela SAI do controle; a tarefa com evento de lista no alvo fica confundida e o resumo conta
{
  const C = '__teste_preco__', ids = n => 'MLB10000000' + String(n).padStart(2, '0')
  const ins = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,0)')
  db.transaction(() => {
    for (let d = COB.de; d <= COB.ate; d = addDias(d, 1)) db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, coletado_em) VALUES (?,?,'x')").run(C, d)
    for (let k = 1; k <= 7; k++) {
      db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES (?,?,?,50)").run(C, ids(k), 'Produto ' + k)
      const s = serie(k === 1 ? 10 : 8, COB.de, COB.ate, d => k === 1 && depois(d) ? 1.4 : 1)
      for (const [d, n] of Object.entries(s)) if (n) ins.run(C, ids(k), d, n, n * 50)
    }
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao) VALUES ('t-preco', 'teste', ?, ?, 'Mercado Livre', 'concluida', 'Otimizar Anúncios', ?)").run(C, `Otimizar ${ids(1)}`, DATA)
    const mud = db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,'preco',?,?,?,'coleta','x')")
    mud.run(C, ids(1), addDias(DATA, 5), '50', '54', 8)     // o alvo subiu o preço junto com a tarefa
    mud.run(C, ids(7), addDias(DATA, 6), '50', '55', 10)    // um anúncio do "controle" também mexeu no preço
  })()
  const medida = () => analisarCliente(C, { hoje: HOJE }).medidas.find(x => x.id === 't-preco')
  const a = analisarCliente(C, { hoje: HOJE }), m = a.medidas.find(x => x.id === 't-preco')
  assert.ok(['melhorou', 'piorou', 'sem_efeito'].includes(m.estado), 'medida comparável: ' + m.estado)
  assert.equal(m.confundido_preco, true); assert.equal(m.eventos_preco.length, 1); assert.equal(m.eventos_preco[0].item_id, ids(1)); assert.equal(a.resumo.confundidas_preco, 1)
  const comEvento = m.controle.base
  db.prepare("DELETE FROM meli_item_mudanca WHERE cliente = ? AND item_id = ?").run(C, ids(7))
  const semEvento = medida().controle.base
  const pre7 = db.prepare('SELECT SUM(unidades) n FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia BETWEEN ? AND ?').get(C, ids(7), m.janelas.pre[0], addDias(m.janelas.pos[0], -(m.lag + 2))).n
  assert.ok(pre7 > 0 && Math.abs(semEvento - comEvento - pre7) < 0.11, `controle sem o anúncio que mudou de preço: ${comEvento} + ${pre7} = ${semEvento}`)
}
// 23) preço pago POR ANÚNCIO: tarefa em 2 anúncios de preços diferentes (R$ 20 e R$ 100) sem mudança de preço; o barato passa a vender mais. O preço
//     pago do alvo SOMADO cai (mix), mas nenhum anúncio mudou de preço: não é confundida. O job de Ofertas que publicou preço é a própria intervenção.
{
  const C = '__teste_mix__', id = n => 'MLB20000000' + String(n).padStart(2, '0'), preco = [0, 20, 100, 50, 50, 50, 50, 50]
  const ins = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,0)')
  db.transaction(() => {
    for (let d = COB.de; d <= COB.ate; d = addDias(d, 1)) db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, coletado_em) VALUES (?,?,'x')").run(C, d)
    for (let k = 1; k <= 7; k++) {
      db.prepare('INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES (?,?,?,?)').run(C, id(k), 'Produto ' + k, preco[k])
      for (const [d, n] of Object.entries(serie(k <= 2 ? 10 : 8, COB.de, COB.ate, x => k === 1 && depois(x) ? 1.6 : 1))) if (n) ins.run(C, id(k), d, n, n * preco[k])
    }
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao) VALUES ('t-mix', 'teste', ?, ?, 'Mercado Livre', 'concluida', 'Otimizar Anúncios', ?)").run(C, `Otimizar ${id(1)} e ${id(2)}`, DATA)
  })()
  const m = analisarCliente(C, { hoje: HOJE }).medidas.find(x => x.id === 't-mix')
  assert.ok(m.metrica_primaria && m.preco_realizado.variacao_pct <= -3, 'o preço pago do alvo somado cai só pelo mix: ' + m.preco_realizado.variacao_pct)
  assert.equal(m.confundido_preco, false, 'nenhum anúncio mudou de preço: o mix de vendas não é "preço mudou"')
  assert.equal(excluirDaAprendizagem(m), false)
  const base = { metrica_primaria: 'unidades', janelas: { pre: ['2026-08-06', '2026-08-19'], pos: ['2026-08-24', '2026-09-06'] }, preco_realizado: { variacao_pct: -15, unidades: { antes: 280, depois: 364 } } }
  const um = v => ({ variacao_pct: v, unidades: { antes: 140, depois: 140 } })
  assert.equal(marcarPreco(base, { tipo: 'Otimizar Anúncios', realizados: [um(0), um(0)] }).confundido_preco, false)
  assert.equal(marcarPreco(base, { tipo: 'Otimizar Anúncios', realizados: [um(1), um(-6)] }).variacao_preco_pct, -6, 'vale a maior variação de um anúncio')
  const job = marcarPreco(base, { tipo: 'Corrigir Anúncios', intervencao: true })
  assert.equal(job.intervencao_preco, true); assert.equal(job.confundido_preco, false, 'job de Ofertas que publicou preço: a mudança é a tarefa')
}
// 24) confundida pelo preço nunca passa de "hipótese possível" (sai do aprendizado; não pode se dizer causa provável nem forte evidência)
{
  const forte = { efeito_pct: 40, controle: { razao: 1 }, pct_ruido: 97, p_placebo: 0.03, n_placebos: 30, sinal_z: 3, corrobora: { campo: 'visitas', pct: 30, base: 300 }, tendencia_pre_pct: 0, estado: 'melhorou' }
  const c = x => confiancaEfeito({ m: { ...forte, ...x }, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: 0.7 })
  assert.equal(c({}).classe, 'forte evidência causal')
  const conf = c({ eventos_preco: [{ item_id: 'MLB1', dia: '2026-08-25', de: 50, para: 45, pct: -10, fonte: 'coleta' }], confundido_preco: true, variacao_preco_pct: -10 })
  assert.equal(conf.classe, 'hipótese possível'); assert.equal(conf.score, 59)
}
// ── ESTADO do anúncio como fator de confusão (out/2026): promoção, Ads, Full, estoque zerado, pausado — mesmo molde do preço ──
// 25) marcarEstado (puro): só evento que CRUZA fronteira dentro da janela; a intervenção da própria família não confunde; modos
const comModo = modo => ({ ...cfgAtrib, estado: { ...cfgAtrib.estado, modo } })
{
  assert.equal(cfgAtrib.estado.modo, 'ativo', 'decisão do David (08/10): modo ativo'); assert.equal(cfgAtrib.estado.pontos_por_campo, 3)
  const m = medirEfeito(args(alvoDe(serie(10, COB.de, '2026-10-04', d => depois(d) ? 1.4 : 1)), alvoDe(serie(30, COB.de, '2026-10-04'))))
  assert.equal(m.estado, 'melhorou')
  const promo = { dia: addDias(DATA, 2), campo: 'promocao', de: 'nenhuma', para: 'SMART −15%', pct: null, fonte: 'promo' }
  const ads = { dia: addDias(DATA, 5), campo: 'ads', de: 'active', para: 'paused', pct: null, fonte: 'ads' }
  const ev = (...l) => new Map([['MLB1', l]])
  const e = marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev(promo, ads) })
  assert.deepEqual(e.campos_estado, ['promocao', 'ads']); assert.equal(e.confundido_estado, true); assert.equal(e.coincide_estado, true); assert.deepEqual(e.intervencao_estado, [])
  assert.equal(e.eventos_estado.length, 2); assert.equal(e.eventos_estado[0].item_id, 'MLB1')
  assert.equal(excluirDaAprendizagem({ ...m, ...e }), true, 'modo ativo: a medida sai do aprendizado')
  // a própria intervenção: tarefa de Ads com Ads ligando/desligando; oferta relâmpago/campanha/cupom com promoção; Full com logística e estoque
  const tAds = marcarEstado(m, { tipo: 'Ajuste ADS', itens: ['MLB1'], eventos: ev(promo, ads) })
  assert.deepEqual(tAds.intervencao_estado, ['ads']); assert.deepEqual(tAds.campos_estado, ['promocao']); assert.equal(tAds.confundido_estado, true, 'a promoção não é a tarefa de Ads: ainda confunde')
  const soAds = marcarEstado(m, { tipo: 'Ajuste ADS', itens: ['MLB1'], eventos: ev(ads) })
  assert.equal(soAds.confundido_estado, false); assert.equal(soAds.eventos_estado.length, 1, 'o evento fica (a tela diz "a própria tarefa")'); assert.deepEqual(soAds.campos_estado, [])
  for (const tipo of ['Oferta Relâmpago', 'Campanhas de Desconto', 'Cupom de desconto']) assert.equal(marcarEstado(m, { tipo, itens: ['MLB1'], eventos: ev(promo) }).confundido_estado, false, tipo)
  assert.deepEqual(intervencoesEstado('Planejamento full'), ['logistica', 'estoque_zero']); assert.deepEqual(intervencoesEstado('Ativar anúncio'), ['status']); assert.deepEqual(intervencoesEstado('Otimizar Anúncios'), [])
  const full = { dia: addDias(DATA, 3), campo: 'logistica', de: 'xd_drop_off', para: 'fulfillment', pct: null, fonte: 'coleta' }
  assert.equal(marcarEstado(m, { tipo: 'Planejamento full', itens: ['MLB1'], eventos: ev(full) }).confundido_estado, false)
  assert.equal(marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev(full) }).confundido_estado, true)
  // fronteira: xd_drop_off → drop_off não é evento; idle ↔ hold de Ads não chega aqui (diffAds), mas um status que não cruza 'active' também não; sem "de" não há evento
  const nada = marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev({ ...full, para: 'drop_off' }, { dia: addDias(DATA, 4), campo: 'status', de: 'paused', para: 'closed' }, { ...full, de: '' }) })
  assert.equal(nada.eventos_estado.length, 0); assert.equal(nada.confundido_estado, false)
  // janela: evento no 1º dia do "antes" ou depois do fim da janela pós não conta; no 2º dia conta
  assert.equal(marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev({ ...promo, dia: m.janelas.pre[0] }, { ...ads, dia: addDias(m.janelas.pos[1], 1) }) }).eventos_estado.length, 0)
  assert.equal(marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev({ ...promo, dia: addDias(m.janelas.pre[0], 1) }) }).eventos_estado.length, 1)
  // só confunde uma comparação antes × depois: lançamento / sem base não têm metrica_primaria
  assert.equal(marcarEstado({ ...m, metrica_primaria: null }, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev(promo) }).confundido_estado, false)
  assert.equal(marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: [], eventos: ev(promo) }).eventos_estado.length, 0, 'medida de conta inteira não olha estado')
  // modos: observar e so_confianca contam (coincide) mas não excluem
  for (const modo of ['observar', 'so_confianca']) {
    const x = marcarEstado(m, { tipo: 'Otimizar Anúncios', itens: ['MLB1'], eventos: ev(promo, ads), params: comModo(modo) })
    assert.equal(x.coincide_estado, true, modo); assert.equal(x.confundido_estado, false, modo); assert.deepEqual(x.campos_estado, ['promocao', 'ads'], modo)
    assert.equal(excluirDaAprendizagem({ ...m, ...x }), false, modo + ': segue no aprendizado')
  }
  // frases
  assert.equal(fraseEstado(promo), 'entrou em promoção SMART −15%'); assert.equal(fraseEstado(promo, false), 'entrou em promoção'); assert.equal(fraseEstado({ ...promo, de: 'SMART −15%', para: 'nenhuma' }), 'saiu da promoção SMART −15%')
  assert.equal(fraseEstado(ads), 'Ads desligado'); assert.equal(fraseEstado({ ...ads, de: 'sem_anuncio', para: 'active' }), 'Ads ligado')
  assert.equal(fraseEstado(full), 'foi para o Full'); assert.equal(fraseEstado({ ...full, de: 'fulfillment', para: 'drop_off' }), 'saiu do Full')
  assert.equal(fraseEstado({ campo: 'estoque_zero', de: 5, para: 0 }), 'estoque zerou'); assert.equal(fraseEstado({ campo: 'estoque_zero', de: 0, para: 3 }), 'estoque voltou')
  assert.equal(fraseEstado({ campo: 'status', de: 'active', para: 'paused' }), 'anúncio pausado'); assert.equal(fraseEstado({ campo: 'status', de: 'paused', para: 'active' }), 'anúncio reativado')
}
// 26) confiança: −pontos_por_campo por CAMPO que mudou (não por evento), com cada evento escrito; a intervenção não entra; observar não mexe; confundida nunca passa de "hipótese possível"
{
  const base = { efeito_pct: 40, controle: { razao: 1 }, pct_ruido: 97, p_placebo: 0.03, n_placebos: 30, sinal_z: 3, corrobora: { campo: 'visitas', pct: 30, base: 300 }, tendencia_pre_pct: 0, estado: 'melhorou' }
  const c = (x, params) => confiancaEfeito({ m: { ...base, ...x }, dataEstimada: false, concorrentes: 0, eventos: [], taxaHistorica: 0.7, params })
  const evs = [{ item_id: 'MLB1', dia: '2026-10-03', campo: 'promocao', de: 'nenhuma', para: 'SMART −15%' }, { item_id: 'MLB1', dia: '2026-10-05', campo: 'ads', de: 'active', para: 'paused' }, { item_id: 'MLB2', dia: '2026-10-06', campo: 'ads', de: 'active', para: 'sem_anuncio' }]
  const dois = c({ eventos_estado: evs, intervencao_estado: [], campos_estado: ['promocao', 'ads'], coincide_estado: true, confundido_estado: true })
  assert.equal(dois.criterios.sem_concorrente.nota, 4, '10 − 3 × 2 campos (3 eventos)')
  assert.match(dois.criterios.sem_concorrente.base, /^entrou em promoção SMART −15% em 03\/10; Ads desligado em 05\/10; Ads desligado em 06\/10: o efeito pode ser desses eventos, não da tarefa$/)
  assert.equal(dois.classe, 'hipótese possível'); assert.equal(dois.score, 59, 'confundida pelo estado sai do aprendizado: nunca "causa provável"')
  const um = c({ eventos_estado: evs, intervencao_estado: ['ads'], campos_estado: ['promocao'], coincide_estado: true, confundido_estado: true })
  assert.equal(um.criterios.sem_concorrente.nota, 7); assert.match(um.criterios.sem_concorrente.base, /^entrou em promoção SMART −15% em 03\/10: o efeito pode ser desse evento, não da tarefa$/, 'a tarefa de Ads: o Ads não entra no motivo')
  assert.equal(c({ eventos_estado: evs.slice(1), intervencao_estado: ['ads'], campos_estado: [], coincide_estado: false, confundido_estado: false }).criterios.sem_concorrente.nota, 10, 'só a própria intervenção: nada')
  const obs = c({ eventos_estado: evs, intervencao_estado: [], campos_estado: ['promocao', 'ads'], coincide_estado: true, confundido_estado: false }, comModo('observar'))
  assert.equal(obs.criterios.sem_concorrente.nota, 10); assert.equal(obs.classe, 'forte evidência causal'); assert.doesNotMatch(obs.criterios.sem_concorrente.base, /promoção/)
  const so = c({ eventos_estado: evs, intervencao_estado: [], campos_estado: ['promocao', 'ads'], coincide_estado: true, confundido_estado: false }, comModo('so_confianca'))
  assert.equal(so.criterios.sem_concorrente.nota, 4); assert.equal(so.classe, 'forte evidência causal', 'só pontos: a classe não é rebaixada')
  assert.equal(c({ eventos_estado: evs, campos_estado: ['promocao', 'ads'] }, { ...cfgAtrib, estado: { ...cfgAtrib.estado, pontos_por_campo: 1 } }).criterios.sem_concorrente.nota, 8)
  // preço e estado juntos somam (−1 do evento de preço, −4 confundida, −3 do campo de estado)
  assert.equal(c({ eventos_preco: [{ item_id: 'MLB1', dia: '2026-10-02', de: 50, para: 54, pct: 8 }], confundido_preco: true, variacao_preco_pct: 8, eventos_estado: [evs[0]], campos_estado: ['promocao'], confundido_estado: true }).criterios.sem_concorrente.nota, 2)
}
// 27) padrões: a confundida pelo estado não entra no n do grupo e é contada em confundidas_estado; pelos dois, nos dois contadores
{
  const ok = Array.from({ length: 5 }, () => ({ tipo: 'Otimizar Anúncios', analista: 'A', titulo: 'x', estado: 'melhorou', efeito_pct: 20 }))
  const g = agruparPadroes([...ok, { ...ok[0], confundido_estado: true }, { ...ok[0], confundido_estado: true, confundido_preco: true }, { ...ok[0], confundido_preco: true }])
  assert.equal(g.n_medidas, 5); assert.equal(g.por_tipo[0].n, 5); assert.equal(g.por_tipo[0].confundidas_estado, 2); assert.equal(g.por_tipo[0].confundidas_preco, 2)
}
// 28) motor inteiro (banco em memória): promoção no alvo → confundida (modo ativo) e contada no resumo; anúncio do controle que ligou Ads SAI do
//     controle; em modo 'observar' a mesma análise só conta a coincidência e o controle fica inteiro
{
  const C = '__teste_estado__', ids = n => 'MLB30000000' + String(n).padStart(2, '0')
  const ins = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,0)')
  db.transaction(() => {
    for (let d = COB.de; d <= COB.ate; d = addDias(d, 1)) db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, coletado_em) VALUES (?,?,'x')").run(C, d)
    for (let k = 1; k <= 7; k++) {
      db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES (?,?,?,50)").run(C, ids(k), 'Produto ' + k)
      for (const [d, n] of Object.entries(serie(k === 1 ? 10 : 8, COB.de, COB.ate, d => k === 1 && depois(d) ? 1.4 : 1))) if (n) ins.run(C, ids(k), d, n, n * 50)
    }
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao) VALUES ('t-estado', 'teste', ?, ?, 'Mercado Livre', 'concluida', 'Otimizar Anúncios', ?)").run(C, `Otimizar ${ids(1)}`, DATA)
    const mud = db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,?,?,?,NULL,?,'x')")
    mud.run(C, ids(1), addDias(DATA, 5), 'promocao', 'nenhuma', 'SMART −15%', 'promo')   // o alvo entrou em promoção na janela
    mud.run(C, ids(7), addDias(DATA, 6), 'ads', 'paused', 'active', 'ads')             // um anúncio do "controle" ligou Ads
    mud.run(C, ids(6), addDias(DATA, 6), 'logistica', 'xd_drop_off', 'drop_off', 'coleta')   // não cruza fronteira: fica no controle
  })()
  const a = analisarCliente(C, { hoje: HOJE }), m = a.medidas.find(x => x.id === 't-estado')
  assert.ok(['melhorou', 'piorou', 'sem_efeito'].includes(m.estado), 'medida comparável: ' + m.estado)
  assert.equal(m.confundido_estado, true); assert.deepEqual(m.campos_estado, ['promocao']); assert.equal(m.eventos_estado.length, 1); assert.equal(m.eventos_estado[0].item_id, ids(1))
  assert.equal(a.resumo.confundidas_estado, 1); assert.equal(a.resumo.coincidencias_estado, 1); assert.equal(a.resumo.confundidas_preco, 0)
  assert.equal(m.confianca?.classe, m.confianca ? 'hipótese possível' : undefined); assert.ok(!m.confianca || /entrou em promoção SMART −15% em 25\/08/.test(m.confianca.criterios.sem_concorrente.base))
  const obs = analisarCliente(C, { hoje: HOJE, params: comModo('observar') }), mo = obs.medidas.find(x => x.id === 't-estado')
  assert.equal(mo.confundido_estado, false); assert.equal(mo.coincide_estado, true); assert.equal(obs.resumo.confundidas_estado, 0); assert.equal(obs.resumo.coincidencias_estado, 1)
  const pre7 = db.prepare('SELECT SUM(unidades) n FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia BETWEEN ? AND ?').get(C, ids(7), m.janelas.pre[0], addDias(m.janelas.pos[0], -(m.lag + 2))).n
  assert.ok(pre7 > 0 && Math.abs(mo.controle.base - m.controle.base - pre7) < 0.11, `ativo: controle sem o anúncio que ligou Ads (${m.controle.base}); observar: controle inteiro (${mo.controle.base}) = +${pre7}`)
  assert.equal(excluirDaAprendizagem(m), true); assert.equal(excluirDaAprendizagem(mo), false)
}
// 25) medirMarco (data-marco de uma mudança do anúncio) = a MESMA medida da tarefa na mesma data e no mesmo anúncio: efeito, estado, métrica, janelas e controle iguais
//     (a tarefa já existente conta como concorrente do marco — único campo que pode diferir). Marco em anúncio sem venda: sem_base/lançamento declarado (o mesmo da tarefa), nunca inventa efeito.
{
  const C = '__teste_estado__', ids = n => 'MLB30000000' + String(n).padStart(2, '0')
  const t = analisarCliente(C, { hoje: HOJE }).medidas.find(x => x.id === 't-estado')
  const m = medirMarco(C, ids(1), DATA, { tipo: 'Otimizar Anúncios', hoje: HOJE })
  assert.equal(m.estado, t.estado); assert.equal(m.efeito_pct, t.efeito_pct); assert.equal(m.efeito_bruto_pct, t.efeito_bruto_pct); assert.equal(m.metrica_primaria, t.metrica_primaria)
  assert.deepEqual(m.janelas, t.janelas); assert.deepEqual(m.controle, t.controle); assert.equal(m.p_placebo, t.p_placebo); assert.equal(m.janela_usada, t.janela_usada); assert.equal(m.lag, t.lag)
  assert.equal(m.confundido_estado, t.confundido_estado); assert.equal(m.confundido_preco, t.confundido_preco)
  assert.equal(m.concorrentes, t.concorrentes + 1, 'a tarefa do mesmo anúncio e data é concorrente do marco'); assert.deepEqual(m.itens, [ids(1)]); assert.equal(m.fonte, 'snapshot')
  if (['melhorou', 'piorou'].includes(m.estado)) assert.ok(m.confianca && m.confianca.criterios.consistencia.nota == null, 'marco não tem consistência histórica por tipo')
  assert.ok(['sem_base', 'lancamento'].includes(medirMarco(C, 'MLB0000000099', DATA, { hoje: HOJE }).estado), 'anúncio sem venda: nunca inventa efeito (sem_base ou lançamento, como na tarefa)')
}
// caso 10 (contrato de ordem dos padrões) segue intacto acima: agruparPadroes só ganhou confundidas_preco e confundidas_estado por grupo
console.log('✔ impacto-tarefas: efeito plantado detectado, mercado absorvido pelo controle, sem controle não atribui, lançamento, visitas, confiança honesta, Wilson, alocação sem dupla contagem, preço e estado do anúncio como fatores de confusão (controle, placebo, confiança, aprendizado, modos)')
