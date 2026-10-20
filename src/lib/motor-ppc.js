// Motor Previsibilidade → Probabilidade → Causalidade (roteiro do David, out/2026).
// 100% determinístico e HONESTO: cada bloco declara os dados que usou e os que faltam;
// score com dado faltante é renormalizado e reporta a cobertura — nunca um número inventado.
// Funciona sobre QUALQUER série diária: entregas do Notion (sempre disponível) e, quando a
// conta do canal estiver conectada, vendas reais. Causalidade fala sempre em "causa provável".
import { playbook } from './plano-cliente.js'

const r2 = n => Math.round(n * 100) / 100
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

// ── série diária ────────────────────────────────────────────────────────────
// datas: array de 'YYYY-MM-DD' (uma por evento) OU mapa {dia: valor}
export function serieDiaria(datas) {
  if (!Array.isArray(datas)) return { ...datas }
  const s = {}
  for (const d of datas) if (d) s[d] = (s[d] || 0) + 1
  return s
}
export const somaJanela = (serie, de, ate) => Object.entries(serie).reduce((t, [d, v]) => t + (d >= de && d <= ate ? v : 0), 0)
export const mediaDiaria = (serie, dias, ate) => r2(somaJanela(serie, addDias(ate, -(dias - 1)), ate) / dias)

// ── 1. PREVISIBILIDADE ──────────────────────────────────────────────────────
export const CLASSES_TENDENCIA = [
  [1.15, 'CRESCIMENTO FORTE'], [1.05, 'CRESCIMENTO'], [0.95, 'ESTÁVEL'], [0.85, 'QUEDA'], [-Infinity, 'QUEDA CRÍTICA'],
]
export function tendencia(serie, ate) {
  const m7 = mediaDiaria(serie, 7, ate), m7ant = mediaDiaria(serie, 7, addDias(ate, -7))
  if (!m7ant) return { indice: null, classe: m7 ? 'SEM BASE DE COMPARAÇÃO' : 'SEM DADOS', m7, m7ant }
  const indice = r2(m7 / m7ant)
  return { indice, classe: CLASSES_TENDENCIA.find(([lim]) => indice >= lim)[1], m7, m7ant }
}

// velocidade ponderada: 30d×20% + 14d×30% + 7d×50% (o agora pesa mais)
export function velocidadePonderada(serie, ate) {
  const m30 = mediaDiaria(serie, 30, ate), m14 = mediaDiaria(serie, 14, ate), m7 = mediaDiaria(serie, 7, ate)
  return { m30, m14, m7, velocidade: r2(m30 * 0.2 + m14 * 0.3 + m7 * 0.5) }
}

// projeção do mês: realizado + velocidade × dias restantes
export function projecaoMes(serie, hoje) {
  const mes = hoje.slice(0, 7)
  const ultimoDia = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
  const realizado = somaJanela(serie, mes + '-01', hoje)
  const diasRestantes = ultimoDia - Number(hoje.slice(8, 10))
  const { velocidade, m30, m14, m7 } = velocidadePonderada(serie, hoje)
  return { mes, realizado: r2(realizado), diasRestantes, velocidade, m30, m14, m7, projecao: r2(realizado + velocidade * diasRestantes) }
}

// ── 2. PROBABILIDADE ────────────────────────────────────────────────────────
// nota de ritmo (média atual ÷ necessidade diária para a meta)
export function notaRitmo(indice) {
  if (!Number.isFinite(indice)) return null
  for (const [lim, nota] of [[1.2, 100], [1.1, 90], [1, 80], [0.9, 60], [0.8, 40]]) if (indice >= lim) return nota
  return 20
}
export const notaTendencia = ind => ind == null ? null : ind >= 1.15 ? 100 : ind >= 1.05 ? 85 : ind >= 0.95 ? 70 : ind >= 0.85 ? 40 : 20

export const CLASSES_PROB = [[85, 'PROBABILIDADE MUITO ALTA'], [70, 'PROBABILIDADE ALTA'], [50, 'INCERTO'], [30, 'PROBABILIDADE BAIXA'], [-Infinity, 'RISCO CRÍTICO']]
export const PESOS_PROB = { ritmo: 30, tendencia: 20, conversao: 15, trafego: 10, estoque: 15, ads: 10 }

// notas: { ritmo, tendencia, conversao, trafego, estoque, ads } — null/ausente = sem dado.
// Renormaliza pelos pesos disponíveis e devolve a cobertura (ex.: 50% = só ritmo+tendência).
export function probabilidadeMeta(notas) {
  let soma = 0, pesoUsado = 0
  const usadas = {}, faltantes = []
  for (const [k, peso] of Object.entries(PESOS_PROB)) {
    const n = notas[k]
    if (n == null) { faltantes.push(k); continue }
    usadas[k] = n; soma += n * peso; pesoUsado += peso
  }
  if (!pesoUsado) return { score: null, classe: 'SEM DADOS', cobertura: 0, usadas, faltantes }
  const score = Math.round(soma / pesoUsado)
  return { score, classe: CLASSES_PROB.find(([lim]) => score >= lim)[1], cobertura: pesoUsado, usadas, faltantes }
}

// meta × projeção × ritmo — o pacote completo quando há meta registrada
export function panoramaMeta({ meta, realizado, diasRestantes, mediaAtual, indiceTendencia, extras = {} }) {
  if (!meta || meta <= 0) return { tem_meta: false, motivo: 'meta não registrada — vira pendência, não chute' }
  // diasRestantes=0 = "só hoje": a necessidade é o que falta hoje, nunca 0 ao lado de gap>0
  const necessidadeDiaria = r2(Math.max(0, meta - realizado) / Math.max(1, diasRestantes))
  const indiceRitmo = !Number.isFinite(mediaAtual) ? null
    : necessidadeDiaria > 0 ? r2(mediaAtual / necessidadeDiaria) : (realizado >= meta ? 2 : 0)
  const prob = probabilidadeMeta({ ritmo: notaRitmo(indiceRitmo), tendencia: notaTendencia(indiceTendencia), ...extras })
  return {
    tem_meta: true, meta, realizado: r2(realizado), gap: r2(Math.max(0, meta - realizado)),
    necessidade_diaria: necessidadeDiaria, indice_ritmo: indiceRitmo, ...prob,
  }
}

// ── 3. CAUSALIDADE ──────────────────────────────────────────────────────────
export const CLASSES_CAUSAL = [[80, 'forte evidência causal'], [60, 'causa provável'], [40, 'hipótese possível'], [-Infinity, 'hipótese fraca']]
const vari = (a, b) => (b == null || a == null || !b) ? null : r2((a - b) / Math.abs(b) * 100)

// Receita = Visitas × Conversão × Ticket. Acha o elo rompido (queda > 10%, regra do roteiro)
// e devolve hipótese + lista de investigação + score causal honesto (com 2 janelas de 28 dias
// só dá para pontuar temporalidade e intensidade — correlação/consistência/concorrente ficam
// declarados como "sem dados" e o score nunca passa de "causa provável").
// preco (opcional, preco-historico.resumoPrecos28d): anúncios que subiram de preço na janela, a fatia da receita anterior que eles somam e a variação
// dos anúncios SEM mudança de preço. Aumento em ≥ 20% da receita vira a leitura "elo mais provável: preço" (FATO a coincidência; a causa é hipótese)
// com dois falsificadores (os sem mudança caíram na mesma proporção; os que subiram não caíram); e o critério "sem explicação concorrente" passa a
// ter nota. Sem preco (ou null = sem histórico) tudo fica como antes.
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`
export function causalidadeVendas(atual, anterior, { preco = null } = {}) {
  if (!atual || !anterior) return { disponivel: false, motivo: 'exige dois períodos completos do canal conectado' }
  const ticket = x => x.vendas ? r2(x.faturamento / x.vendas) : null
  const deltas = {
    faturamento: vari(atual.faturamento, anterior.faturamento),
    visitas: vari(atual.visitas, anterior.visitas),
    conversao: atual.conversao != null && anterior.conversao != null ? r2(atual.conversao - anterior.conversao) : null, // pontos
    ticket: vari(ticket(atual), ticket(anterior)),
  }
  if (deltas.faturamento == null || deltas.faturamento > -10)
    return { disponivel: true, deltas, ruptura: null, leitura: deltas.faturamento == null ? 'Sem base de faturamento para comparar.' : 'Sem ruptura relevante de receita no período (queda < 10%).' }

  // árvore: tráfego → conversão → ticket (primeiro elo com queda > 10% / 0,5 ponto)
  const INVESTIGAR = {
    visitas: ['Impressões', 'CTR (título, imagem de capa, preço exibido)', 'Posicionamento/indexação', 'Ads ativos', 'Estoque/anúncio pausado', 'Catálogo (perda de destaque)', 'Competitividade de preço e frete'],
    conversao: ['Preço e frete', 'Prazo de entrega', 'Avaliações e perguntas', 'Oferta e desconto', 'Concorrência direta', 'Imagens/título/descrição', 'Catálogo (buy box)'],
    ticket: ['Mix de produtos (curva A perdendo participação)', 'Quantidade por pedido', 'Kits e upsell', 'Produtos mais baratos ganhando participação'],
  }
  // conversão é comparada em termos RELATIVOS (queda > 10%, igual aos outros elos): numa conversão
  // típica de marketplace (~1%), um limiar fixo em pontos deixaria passar quedas de 40%
  const varConvRel = deltas.conversao != null && anterior.conversao ? r2(deltas.conversao / anterior.conversao * 100) : null
  // elo rompido = o de MAIOR queda relativa entre os que cruzaram o limiar — não o primeiro da árvore
  const candidatos = [['visitas', deltas.visitas], ['conversao', varConvRel], ['ticket', deltas.ticket]]
    .filter(([, v]) => v != null && v <= -10).sort((a, b) => a[1] - b[1])
  const elo = candidatos[0]?.[0] || null
  const tambem = candidatos.slice(1).map(([k, v]) => `${k === 'conversao' ? 'conversão' : k} também caiu ${v}%${k === 'conversao' ? ' (relativo)' : ''}`)
  const semDado = ['visitas', 'conversao', 'ticket'].filter(k => deltas[k] == null)

  // preço: aumento em anúncios com ≥ 20% da receita anterior coincide com a queda. Falsificador com dado: os anúncios SEM mudança de preço caíram
  // na mesma proporção (ponytail: "mesma" = pelo menos 75% da queda da conta; régua fixa, sem teste estatístico)
  let lPreco = '', semConc = { nota: null, de: 10, base: 'sem dados de concorrência/preço de mercado' }, precoOut = null
  if (preco && Array.isArray(preco.aumentos)) {
    const a = preco.aumentos, maior = a[0], vs = preco.var_sem_mudanca_pct, va = preco.var_aumentos_pct, desde = preco.desde ? ` (histórico de preço desde ${dm(preco.desde)})` : ''
    const coincide = a.length > 0 && (preco.share_aumentos_pct ?? 0) >= 20
    const mesma = coincide && vs != null && vs <= deltas.faturamento * 0.75
    // 2º falsificador: os anúncios que SUBIRAM não caíram (queda < 10%) — a queda da conta está em outro lugar (sem o dado, fica a leitura de antes)
    const naoCairam = coincide && !mesma && va != null && va > -10
    if (coincide) {
      const quando = maior.incerteza ? `(${maior.incerteza})` : `em ${dm(maior.dia)}`, queda = Math.abs(deltas.faturamento)
      lPreco = naoCairam
        ? ` A queda de ${queda}% coincide com aumento de preço em ${a.length} anúncio(s) (o maior, ${maior.item_id}, subiu ${maior.pct}% ${quando}), mas os anúncios que subiram de preço não caíram (variaram ${va}%): a causa não é o preço.`
        : mesma
        ? ` A queda de ${queda}% coincide com aumento de preço em ${a.length} anúncio(s) (o maior, ${maior.item_id}, subiu ${maior.pct}% ${quando}), mas os anúncios sem mudança de preço caíram ${Math.abs(vs)}%, na mesma proporção: a causa não é o preço.`
        : ` A queda de ${queda}% coincide com aumento de preço em ${a.length} anúncio(s); o maior, ${maior.item_id}, subiu ${maior.pct}% ${quando} — elo mais provável: preço. Se os anúncios sem mudança de preço caíram na mesma proporção, a causa não é o preço${vs != null ? ` (eles variaram ${vs}%)` : ''}.`
      semConc = naoCairam ? { nota: 6, de: 10, base: `preço subiu em anúncios com ${preco.share_aumentos_pct}% da receita, mas eles não caíram (${va}%)${desde}` }
        : mesma ? { nota: 6, de: 10, base: `preço subiu em anúncios com ${preco.share_aumentos_pct}% da receita, mas os sem mudança caíram na mesma proporção (${vs}%)${desde}` }
        : { nota: 0, de: 10, base: `preço subiu em ${a.length} anúncio(s) com ${preco.share_aumentos_pct}% da receita no mesmo período: explicação concorrente${desde}` }
    } else semConc = preco.n_mudaram
      ? { nota: 6, de: 10, base: `preço mudou em ${preco.n_mudaram} anúncio(s), sem aumento em 20% ou mais da receita${desde}` }
      : { nota: 10, de: 10, base: `nenhuma mudança de preço registrada nos anúncios no período${desde}` }
    precoOut = { coincide, mesma_proporcao: mesma, aumentos_nao_cairam: naoCairam, aumentos: a.slice(0, 5), share_aumentos_pct: preco.share_aumentos_pct ?? null, var_aumentos_pct: va ?? null, var_sem_mudanca_pct: vs ?? null, desde: preco.desde || null, completo: !!preco.completo }
  }

  // score causal: temporalidade 25 + intensidade 20 avaliáveis; concorrente 10 só com histórico de preço; correlação 25 + consistência 20 = sem dados
  const intensidadeOk = elo && Math.abs(elo === 'conversao' ? varConvRel : deltas[elo]) >= Math.abs(deltas.faturamento) * 0.5
  const score = elo ? 25 + (intensidadeOk ? 20 : 8) + (semConc.nota ?? 0) : null
  return {
    disponivel: true, deltas, ruptura: elo,
    leitura: (elo
      ? `Faturamento ${deltas.faturamento}%. A ruptura principal está no elo ${elo === 'visitas' ? 'TRÁFEGO (demanda → visita)' : elo === 'conversao' ? 'CONVERSÃO (visita → pedido)' : 'TICKET (valor por pedido)'}${tambem.length ? ` — ${tambem.join('; ')}` : ''}.`
      : semDado.length === 3
        ? `Faturamento ${deltas.faturamento}%, sem dado de visitas, conversão e ticket — impossível localizar a ruptura; conectar as métricas do canal.`
        : `Faturamento ${deltas.faturamento}%, mas nenhum elo medido explica isoladamente (${['visitas', 'conversão', 'ticket'].filter((k, i) => deltas[['visitas', 'conversao', 'ticket'][i]] != null).join('/')} estáveis${semDado.length ? `; sem dado de ${semDado.join(', ')}` : ''}) — queda difusa: investigar os três elos.`) + lPreco,
    preco: precoOut,
    investigar: elo ? [...INVESTIGAR[elo], ...(candidatos[1] ? INVESTIGAR[candidatos[1][0]].slice(0, 3) : [])] : [...INVESTIGAR.visitas.slice(0, 3), ...INVESTIGAR.conversao.slice(0, 3)],
    causal: elo ? {
      score, classe: CLASSES_CAUSAL.find(([lim]) => score >= lim)[1],
      criterios: {
        temporalidade: { nota: 25, de: 25, base: 'a queda do elo ocorre no mesmo período da queda de receita' },
        intensidade: { nota: intensidadeOk ? 20 : 8, de: 20, base: intensidadeOk ? 'a variação do elo é grande o suficiente para explicar a receita' : 'variação do elo menor que a da receita — pode haver outro fator' },
        correlacao: { nota: null, de: 25, base: 'sem histórico suficiente (precisa de série longa)' },
        consistencia: { nota: null, de: 20, base: 'sem histórico de casos anteriores' },
        sem_concorrente: semConc,
      },
      nota: 'Sempre "causa provável", nunca comprovada — comprovação exige teste controlado.',
    } : null,
    sem_dado: semDado,
  }
}

// Execução (Notion) = tarefas ativas × taxa de conclusão — causalidade operacional
export function causalidadeOperacao({ c28, p28, abertas, bloqueadas, paradas, semResponsavel, temPlanoMes, dependenciasVencidas = 0 }) {
  const delta = vari(c28, p28)
  if (delta == null || delta > -10) return { ruptura: null, leitura: p28 ? 'Cadência de execução sem ruptura relevante (queda < 10%).' : 'Sem base de comparação de entregas (28 dias anteriores vazios).' }
  const causas = []
  if (bloqueadas) causas.push({ causa: `${bloqueadas} tarefa(s) bloqueadas (impedimento interno)`, peso: bloqueadas })
  if (dependenciasVencidas) causas.push({ causa: `${dependenciasVencidas} tarefa(s) aguardando o cliente há ${playbook.limiares.dependencia_atencao_dias}+ dias`, peso: dependenciasVencidas * 0.5 })   // não é falha de execução: pesa metade
  if (semResponsavel) causas.push({ causa: `${semResponsavel} tarefa(s) sem responsável`, peso: semResponsavel })
  if (paradas) causas.push({ causa: `${paradas} tarefa(s) paradas há 30+ dias`, peso: paradas * 0.5 })
  if (!temPlanoMes) causas.push({ causa: 'mês sem plano de ação registrado', peso: abertas * 0.3 + 1 })
  causas.sort((a, b) => b.peso - a.peso)
  return {
    ruptura: 'execucao', delta,
    leitura: `Entregas caíram ${Math.abs(delta)}% (28d vs 28d anteriores).${causas.length ? ` Causa provável: ${causas[0].causa}.` : ' Nenhuma causa visível nos dados do Notion — investigar capacidade/prioridade com o consultor.'}`,
    causas: causas.map(c => c.causa),
  }
}

// ── 4. PRIORIDADE P0–P3 e características (sobre as ações do plano) ────────
// Prioridade = impacto 40% + gravidade 20% + evidência causal 25% + facilidade 15% (roteiro §10).
// Sem impacto FINANCEIRO por ação (sem vendas conectadas), impacto usa a escala 1-5 da ação.
export const CLASSES_P = [[80, 'P0'], [65, 'P1'], [50, 'P2'], [-Infinity, 'P3']]
export function prioridadeAcao(a) {
  const d = a.dados || a
  if (![d.impacto, d.urgencia, d.confianca, d.esforco].every(Number.isFinite))
    return { p: null, nota: null, rotulo: 'sem dados para priorizar' }
  const nota = (d.impacto * 20) * 0.40 + (d.urgencia * 20) * 0.20 + (d.confianca * 20) * 0.25 + ((6 - d.esforco) * 20) * 0.15
  const score = Math.round(nota)
  const classe = CLASSES_P.find(([lim]) => score >= lim)[1]
  return { p: classe, nota: score, rotulo: { P0: 'P0 — agir agora', P1: 'P1 — alta', P2: 'P2 — média', P3: 'P3 — monitorar' }[classe] }
}
export const caracteristicas = a => ({
  alto_impacto: (a.dados?.impacto ?? 0) >= 4,
  curto_prazo: ['72h', '7d'].includes(a.horizonte),
  longevo: ['30d', '90d'].includes(a.horizonte),     // efeito estrutural/duradouro (plano, sazonalidade, preço)
  fato: a.dados?.evidencia_tipo === 'fato',
})

// ── 9. impacto financeiro (valor em risco) — só com faturamento real ───────
export const valorEmRisco = (faturamento, quedaPct) => faturamento != null && quedaPct != null && quedaPct < 0
  ? r2(faturamento * Math.abs(quedaPct) / 100) : null

// ── renovação de contrato (datas reais da central) ─────────────────────────
export function statusRenovacao(vencimentos, hoje, { janelaDias = playbook.renovacao_janela_dias ?? 30 } = {}) {
  const itens = Object.entries(vencimentos || {}).map(([canal, data]) => {
    const dia = String(data || '').slice(0, 10)                     // o Notion pode mandar datetime
    const d = new Date(dia + 'T12:00:00')
    const valida = Number.isFinite(+d) && d.toISOString().slice(0, 10) === dia   // 2026-02-30 "rola" p/ 02/03 — recusar
    const dias = valida ? Math.round((d - new Date(hoje + 'T12:00:00')) / 86400000) : null
    return { canal, data: dia, dias, invalida: dias == null }       // inválida = declarada, nunca NaN mudo
  }).sort((a, b) => (a.dias ?? 1e9) - (b.dias ?? 1e9))
  return { itens, alerta: itens.filter(i => i.dias != null && i.dias <= janelaDias && i.dias >= -15) }
}
