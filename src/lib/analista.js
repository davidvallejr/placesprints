// Visão por analista: workload cruzando TODOS os clientes + diagnóstico de
// causa raiz do backlog. Tudo calculado por código (zero tokens de IA) — a
// IA, quando configurada, só escreve 1 parágrafo de leitura executiva no final.
import { db, hojeLocal } from './db.js'
import { classificarTarefa, regrasEisenhower } from './eisenhower.js'
import { ehAberta, ehDependencia } from './status-tarefa.js'

// Notion permite mais de um responsável por card ("Kenia Jubileu, Alexandre
// Silva") — por isso usamos LIKE em vez do "=" exato de listarTarefas(), ou
// perderíamos exatamente os cards de trabalho em dupla.
export function tarefasDoAnalista(responsavel, { arquivada = 0 } = {}) {
  return db.prepare(`SELECT * FROM tarefas WHERE arquivada = ? AND responsavel LIKE ? ORDER BY prazo`)
    .all(arquivada, `%${responsavel}%`)
}

// Frequência mensal de cada tipo_demanda (ou título quando o tipo vier
// vazio) — alimenta a regra de "Delegar" (recorrência alta = candidata).
function frequenciasPorTipo(tarefas) {
  const freq = new Map()
  for (const t of tarefas) {
    const chave = t.tipo_demanda || t.titulo
    freq.set(chave, (freq.get(chave) || 0) + 1)
  }
  return freq
}

// Monta os 4 quadrantes + o diagnóstico de causa raiz para UM analista.
// { de, ate } filtra o RECORTE do mês analisado; a frequência (para a regra
// de delegação) sempre considera as últimas ~4 semanas, independente do recorte.
export function workloadAnalista(responsavel, { de, ate } = {}) {
  const hoje = hojeLocal()
  const desde30d = new Date(hoje + 'T12:00:00'); desde30d.setDate(desde30d.getDate() - 30)
  const janela30d = desde30d.toISOString().slice(0, 10)

  const todas = tarefasDoAnalista(responsavel)
  const recentes = todas.filter(t => t.last_edited?.slice(0, 10) >= janela30d || (t.data_conclusao && t.data_conclusao >= janela30d))
  const freq = frequenciasPorTipo(recentes)

  const abertas = todas.filter(ehAberta)
  const aguardandoCliente = todas.filter(ehDependencia).length       // fora da carga e da matriz: a cobrança é do consultor
  const noRecorte = de && ate ? todas.filter(t => (t.data_conclusao || t.prazo || t.data_inicio || t.last_edited?.slice(0, 10) || '') >= de && (t.data_conclusao || t.prazo || t.data_inicio || t.last_edited?.slice(0, 10) || '') <= ate) : todas

  const quadrantes = { fazer: [], agendar: [], delegar: [], eliminar: [] }
  for (const t of abertas) {
    const chave = t.tipo_demanda || t.titulo
    const c = classificarTarefa(t, { hoje, frequenciaTipo: freq.get(chave) || 0 })
    if (!c) continue
    quadrantes[c.quadrante].push({ ...t, _classificacao: c })
  }
  for (const q of Object.keys(quadrantes)) quadrantes[q].sort((a, b) => (a.prazo || '9999') < (b.prazo || '9999') ? -1 : 1)

  const minutosPorQuadrante = q => quadrantes[q].reduce((s, t) => s + (t._classificacao.minutos || 0), 0)

  return {
    responsavel, gerado_em: hoje,
    total_aberto: abertas.length,
    total_geral: todas.length,
    total_concluido: todas.length - abertas.length - aguardandoCliente,   // dependência do cliente não é entrega
    aguardando_cliente: aguardandoCliente,
    quadrantes,
    resumo: {
      fazer: { n: quadrantes.fazer.length, minutos: minutosPorQuadrante('fazer') },
      agendar: { n: quadrantes.agendar.length, minutos: minutosPorQuadrante('agendar') },
      delegar: { n: quadrantes.delegar.length, minutos: minutosPorQuadrante('delegar') },
      eliminar: { n: quadrantes.eliminar.length, minutos: minutosPorQuadrante('eliminar') },
    },
    diagnostico: diagnosticoAnalista(todas, abertas),
    recorte: { de, ate, tarefas: noRecorte.length },
  }
}

// A parte de "me ajuda a entender o motivo" — só fatos, calculados por código.
function diagnosticoAnalista(todas, abertas) {
  const hoje = hojeLocal()

  // concentração por cliente (poucos clientes tomando desproporcionalmente o tempo)
  const porCliente = new Map()
  for (const t of abertas) porCliente.set(t.cliente, (porCliente.get(t.cliente) || 0) + 1)
  const concentracao = [...porCliente.entries()].map(([cliente, n]) => ({ cliente, n }))
    .sort((a, b) => b.n - a.n).slice(0, 8)
  const top3 = concentracao.slice(0, 3).reduce((s, c) => s + c.n, 0)
  const pctTop3 = abertas.length ? Math.round(100 * top3 / abertas.length) : 0

  // idade do backlog aberto (dias desde início/última edição, sem conclusão)
  const idades = abertas
    .filter(t => t.status === 'nao_iniciada' || t.status === 'andamento')
    .map(t => Math.floor((Date.now() - new Date((t.data_inicio || t.last_edited.slice(0, 10)) + 'T12:00:00').getTime()) / 86400000))
    .filter(n => n >= 0)
  const idadeMedia = idades.length ? Math.round(idades.reduce((s, n) => s + n, 0) / idades.length) : null
  const paradasHaMuito = idades.filter(n => n >= regrasEisenhower.eliminar.dias_parada_minimo).length

  // higiene de dados: sem prazo é a causa raiz mais comum de backlog invisível
  const semPrazo = abertas.filter(t => !t.prazo).length
  const pctSemPrazo = abertas.length ? Math.round(100 * semPrazo / abertas.length) : 0

  // tipos mais recorrentes no backlog ABERTO (não no geral) — o que mais empaca
  const tiposAbertos = new Map()
  for (const t of abertas) {
    const chave = t.tipo_demanda || t.titulo
    tiposAbertos.set(chave, (tiposAbertos.get(chave) || 0) + 1)
  }
  const tiposDominantes = [...tiposAbertos.entries()].map(([tipo, n]) => ({ tipo, n }))
    .sort((a, b) => b.n - a.n).slice(0, 6)

  const bloqueadas = abertas.filter(t => t.status === 'bloqueada').length

  return {
    concentracao_clientes: concentracao,
    pct_backlog_top3_clientes: pctTop3,
    idade_media_dias: idadeMedia,
    tarefas_paradas_45d_mais: paradasHaMuito,
    sem_prazo: semPrazo, pct_sem_prazo: pctSemPrazo,
    tipos_dominantes_backlog: tiposDominantes,
    bloqueadas,
    clientes_distintos: porCliente.size,
  }
}
