// Autoteste do motor Previsibilidade → Probabilidade → Causalidade (números do roteiro do David).
import assert from 'node:assert/strict'
import { serieDiaria, mediaDiaria, tendencia, velocidadePonderada, projecaoMes, notaRitmo, probabilidadeMeta, panoramaMeta, causalidadeVendas, causalidadeOperacao, prioridadeAcao, caracteristicas, valorEmRisco, statusRenovacao } from '../src/lib/motor-ppc.js'

const HOJE = '2026-10-10'
const dia = n => { const d = new Date('2026-10-10T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

// velocidade ponderada: m7=4800, m14=4000, m30=3500 → 4300 (exemplo §2)
const serie = {}
for (let i = 0; i < 7; i++) serie[dia(i)] = 4800            // últimos 7
for (let i = 7; i < 14; i++) serie[dia(i)] = 3200           // 14d médio em 4000
for (let i = 14; i < 30; i++) serie[dia(i)] = 3062.5        // 30d médio em 3500
const v = velocidadePonderada(serie, HOJE)
assert.equal(v.m7, 4800); assert.equal(v.m14, 4000); assert.equal(v.m30, 3500)
assert.equal(v.velocidade, 4300)

// tendência: 4800/4000 = 1,20 → CRESCIMENTO FORTE (exemplo §1)
const st = {}; for (let i = 0; i < 7; i++) st[dia(i)] = 4800; for (let i = 7; i < 14; i++) st[dia(i)] = 4000
const t = tendencia(st, HOJE)
assert.equal(t.indice, 1.2); assert.equal(t.classe, 'CRESCIMENTO FORTE')
assert.equal(tendencia({}, HOJE).classe, 'SEM DADOS')       // divisor zero = sem base, não desempenho

// projeção do mês: realizado + velocidade × dias restantes
const pj = projecaoMes(serie, HOJE)
assert.equal(pj.diasRestantes, 21)
assert.equal(pj.projecao, pj.realizado + pj.velocidade * 21)

// notas de ritmo (tabela §4): 1,15 → 90
for (const [i, n] of [[1.25, 100], [1.15, 90], [1.0, 80], [0.95, 60], [0.85, 40], [0.5, 20]]) assert.equal(notaRitmo(i), n)

// probabilidade com TODAS as notas (pesos §3): 90/100/80/70/85/60 → 85
assert.equal(probabilidadeMeta({ ritmo: 90, tendencia: 100, conversao: 80, trafego: 70, estoque: 85, ads: 60 }).score, 85)
// cobertura parcial renormalizada: só ritmo 90 + tendência 100 → (90×30+100×20)/50 = 94, cobertura 50%
const pp = probabilidadeMeta({ ritmo: 90, tendencia: 100 })
assert.equal(pp.score, 94); assert.equal(pp.cobertura, 50); assert.deepEqual(pp.faltantes, ['conversao', 'trafego', 'estoque', 'ads'])
assert.equal(probabilidadeMeta({}).classe, 'SEM DADOS')

// panorama de meta (exemplo §4): meta 150k, vendeu 70k, 20 dias → precisa 4.000/dia; vende 4.600 → ritmo 1,15
const pm = panoramaMeta({ meta: 150000, realizado: 70000, diasRestantes: 20, mediaAtual: 4600, indiceTendencia: 1.2 })
assert.equal(pm.necessidade_diaria, 4000); assert.equal(pm.indice_ritmo, 1.15); assert.equal(pm.usadas.ritmo, 90)
assert.equal(panoramaMeta({ meta: 0, realizado: 1, diasRestantes: 5, mediaAtual: 1 }).tem_meta, false)   // sem meta = pendência, nunca chute

// causalidade (exemplo §8 adaptado): fat −28%, visitas −19% → ruptura no TRÁFEGO
const cv = causalidadeVendas(
  { faturamento: 72000, vendas: 81, visitas: 8100, conversao: 1.0 },
  { faturamento: 100000, vendas: 100, visitas: 10000, conversao: 1.0 })
assert.equal(cv.ruptura, 'visitas'); assert.equal(cv.deltas.faturamento, -28); assert.equal(cv.deltas.visitas, -19)
assert.equal(cv.causal.classe, 'hipótese possível')          // 2 janelas só: nunca "comprovada"
assert.ok(cv.causal.criterios.correlacao.nota === null)      // critério sem dado fica declarado, não inventado
assert.equal(causalidadeVendas({ faturamento: 95, vendas: 9, visitas: 90 }, { faturamento: 100, vendas: 10, visitas: 100 }).ruptura, null)  // −5%: sem ruptura

// causalidade operacional: entregas −67% com 3 bloqueadas → causa provável = bloqueio
const co = causalidadeOperacao({ c28: 2, p28: 6, abertas: 10, bloqueadas: 3, paradas: 0, semResponsavel: 0, temPlanoMes: true })
assert.equal(co.ruptura, 'execucao'); assert.ok(co.leitura.includes('bloqueadas (impedimento interno)'))
assert.ok(co.causas.every(c => !c.includes('aguardando o cliente')), 'sem o param nada é inventado')
// dependência do cliente vencida: causa separada com peso n×0,5 (não é falha de execução) — 4 dependências (2) pesam menos que 3 bloqueadas (3)
const co2 = causalidadeOperacao({ c28: 2, p28: 6, abertas: 10, bloqueadas: 3, paradas: 0, semResponsavel: 0, temPlanoMes: true, dependenciasVencidas: 4 })
assert.deepEqual(co2.causas.slice(0, 2), ['3 tarefa(s) bloqueadas (impedimento interno)', '4 tarefa(s) aguardando o cliente há 14+ dias'])
assert.equal(causalidadeOperacao({ c28: 2, p28: 6, abertas: 10, bloqueadas: 0, paradas: 0, semResponsavel: 0, temPlanoMes: true, dependenciasVencidas: 2 }).causas[0], '2 tarefa(s) aguardando o cliente há 14+ dias')

// prioridade P0–P3 (§10): impacto 5/urg 5/conf 5/esforço 1 → 100 → P0; 4/3/3/3 → 68 → P1
assert.equal(prioridadeAcao({ dados: { impacto: 5, urgencia: 5, confianca: 5, esforco: 1 } }).p, 'P0')
assert.equal(prioridadeAcao({ dados: { impacto: 4, urgencia: 3, confianca: 3, esforco: 3 } }).p, 'P1')
assert.equal(prioridadeAcao({ dados: { impacto: 2, urgencia: 2, confianca: 2, esforco: 4 } }).p, 'P3')

// características: alto impacto / curto prazo / longevo
const car = caracteristicas({ horizonte: '7d', dados: { impacto: 4, evidencia_tipo: 'fato' } })
assert.deepEqual(car, { alto_impacto: true, curto_prazo: true, longevo: false, fato: true })

// valor em risco (§9): 30.000 × 30% = 9.000
assert.equal(valorEmRisco(30000, -30), 9000)
assert.equal(valorEmRisco(null, -30), null)

// renovação: contrato em 20 dias entra no alerta; 90 dias não
const sr = statusRenovacao({ ML: dia(-20), SHO: dia(-90) }, HOJE)
assert.equal(sr.alerta.length, 1); assert.equal(sr.alerta[0].canal, 'ML')

// regressões da revisão adversarial (out/2026):
// conversão de ~1% caindo 38% relativo TEM que ser apontada como elo (limiar relativo, não −0,5pp fixo)
const cvRel = causalidadeVendas(
  { faturamento: 62000, vendas: 62, visitas: 10000, conversao: 0.62 },
  { faturamento: 100000, vendas: 100, visitas: 10000, conversao: 1.0 })
assert.equal(cvRel.ruptura, 'conversao')
assert.ok(cvRel.causal.criterios.intensidade.nota === 20, 'intensidade usa variação relativa real')
// data com hora (Notion "incluir hora") nunca vira NaN mudo
const srDt = statusRenovacao({ ML: '2026-10-20T14:00:00.000-03:00' }, '2026-10-02')
assert.equal(srDt.itens[0].dias, 18); assert.equal(srDt.alerta.length, 1)
assert.equal(statusRenovacao({ ML: 'abc' }, '2026-10-02').itens[0].invalida, true)
// campo ausente = declarado, nunca TypeError/NaN
assert.equal(prioridadeAcao({ dados: { urgencia: 3, confianca: 3, esforco: 2 } }).p, null)
assert.equal(notaRitmo(NaN), null)
assert.equal(panoramaMeta({ meta: 100, realizado: 60, diasRestantes: 10, indiceTendencia: 1 }).indice_ritmo, null)

// REGRESSÕES da revisão adversarial (out/2026):
// dia 0 do mês: necessidade = o que falta hoje (nunca 0 ao lado de gap>0)
const pm0 = panoramaMeta({ meta: 100, realizado: 60, diasRestantes: 0, mediaAtual: 5, indiceTendencia: 1.2 })
assert.equal(pm0.necessidade_diaria, 40); assert.equal(pm0.indice_ritmo, 0.13)
// dois elos caindo: aponta o DOMINANTE (conversão −44% rel.), citando o outro
const cv2 = causalidadeVendas({ faturamento: 72000 * 0.5 / 0.72, vendas: 50, visitas: 8900, conversao: 0.56 }, { faturamento: 100000, vendas: 100, visitas: 10000, conversao: 1.0 })
assert.equal(cv2.ruptura, 'conversao'); assert.ok(cv2.leitura.includes('visitas também caiu'))
// três elos sem dado: não afirmar "estáveis"
const sd = causalidadeVendas({ faturamento: 50000 }, { faturamento: 100000 })
assert.ok(sd.leitura.includes('impossível localizar') && !sd.leitura.includes('estáveis'))
// data de calendário impossível não passa pelo rollover do V8
assert.equal(statusRenovacao({ ML: '2026-02-30' }, '2026-10-05').itens[0].invalida, true)

// PREÇO na causalidade de vendas (resumoPrecos28d): aumento em anúncios com ≥ 20% da receita → "elo mais provável: preço" com o falsificador; nota de concorrente
{
  const A = { faturamento: 72000, vendas: 81, visitas: 8100, conversao: 1.0 }, B = { faturamento: 100000, vendas: 100, visitas: 10000, conversao: 1.0 }
  const preco = (o = {}) => ({ desde: '2026-09-01', completo: true, n_mudaram: 2, aumentos: [{ item_id: 'MLB123', dia: '2026-09-20', de: 50, para: 55, pct: 10, receita_ant: 30000, share_pct: 30 }, { item_id: 'MLB9', dia: '2026-09-22', de: 20, para: 21, pct: 5, receita_ant: 5000, share_pct: 5 }], share_aumentos_pct: 35, var_sem_mudanca_pct: -2, ...o })
  const p = causalidadeVendas(A, B, { preco: preco() })
  assert.equal(p.ruptura, 'visitas', 'o elo medido continua o mesmo')
  assert.ok(p.leitura.includes('A queda de 28% coincide com aumento de preço em 2 anúncio(s); o maior, MLB123, subiu 10% em 20/09 — elo mais provável: preço.'), p.leitura)
  assert.ok(p.leitura.includes('Se os anúncios sem mudança de preço caíram na mesma proporção, a causa não é o preço (eles variaram -2%)'))
  assert.equal(p.causal.criterios.sem_concorrente.nota, 0); assert.match(p.causal.criterios.sem_concorrente.base, /explicação concorrente/)
  assert.equal(p.preco.coincide, true); assert.equal(p.preco.mesma_proporcao, false)
  // falsificado com dado: os anúncios SEM mudança caíram na mesma proporção → a causa não é o preço
  const f = causalidadeVendas(A, B, { preco: preco({ var_sem_mudanca_pct: -26 }) })
  assert.ok(f.leitura.includes('na mesma proporção: a causa não é o preço') && !f.leitura.includes('elo mais provável: preço'), f.leitura)
  assert.equal(f.causal.criterios.sem_concorrente.nota, 6)
  // aumento em menos de 20% da receita não vira leitura; sem nenhuma mudança o critério ganha a nota cheia (e a classe não passa de hipótese)
  const pouco = causalidadeVendas(A, B, { preco: preco({ share_aumentos_pct: 12 }) })
  assert.ok(!pouco.leitura.includes('coincide')); assert.equal(pouco.causal.criterios.sem_concorrente.nota, 6)
  const nada = causalidadeVendas(A, B, { preco: preco({ n_mudaram: 0, aumentos: [], share_aumentos_pct: 0 }) })
  assert.equal(nada.causal.criterios.sem_concorrente.nota, 10); assert.match(nada.causal.criterios.sem_concorrente.base, /desde 01\/09/); assert.notEqual(nada.causal.classe, 'forte evidência causal')
  // sem histórico (null) = como antes: critério declarado sem dado
  const sem = causalidadeVendas(A, B, { preco: null })
  assert.equal(sem.causal.criterios.sem_concorrente.nota, null); assert.equal(sem.preco, null); assert.equal(sem.causal.score, cv.causal.score)
  // data incerta (fotografias do acompanhamento) aparece como intervalo
  const inc = causalidadeVendas(A, B, { preco: preco({ aumentos: [{ ...preco().aumentos[0], incerteza: 'mudou entre 15/09 e 20/09' }] }) })
  assert.ok(inc.leitura.includes('subiu 10% (mudou entre 15/09 e 20/09)'))
  // 2º falsificador: os anúncios que SUBIRAM não caíram (a queda está em outro anúncio) → nunca "elo mais provável: preço"
  const naoCairam = causalidadeVendas(A, B, { preco: preco({ var_aumentos_pct: 0 }) })
  assert.ok(naoCairam.leitura.includes('mas os anúncios que subiram de preço não caíram (variaram 0%): a causa não é o preço.') && !naoCairam.leitura.includes('elo mais provável: preço'), naoCairam.leitura)
  assert.equal(naoCairam.causal.criterios.sem_concorrente.nota, 6); assert.equal(naoCairam.preco.aumentos_nao_cairam, true)
  assert.ok(causalidadeVendas(A, B, { preco: preco({ var_aumentos_pct: -30 }) }).leitura.includes('elo mais provável: preço'), 'os que subiram caíram: a leitura de preço fica')
}

console.log('✔ motor-ppc: previsibilidade, probabilidade (renormalizada), causalidade honesta (+ preço com falsificador), P0–P3 e renovação (+ regressões da revisão)')
