// Monta a estrutura completa do relatório de sprint (9 seções).
// Tudo determinístico, exceto o resumo executivo (ia.js, cacheado).
import { db, getEstado, hojeLocal } from './db.js'
import {
  listarTarefas, calcularKpis, graficoStatus, graficoProcessos, graficoBurnup,
  riscos, sprintAnterior, evidenciasDe, ordemSprints, planoDoMes,
} from './metricas.js'
import { resumoExecutivo } from './ia.js'
import { ROTULOS as rotuloStatus, ehDependencia } from './status-tarefa.js'
import { criarDependencias } from './dependencia-cliente.js'
import { pendenciasReal } from './pendencias-cliente-real.js'

// só listar(): o que falta do cliente e desde quando (registro → historico → última edição); nada aqui escreve no Notion
const { listar: listarDependencias } = criarDependencias({ handle: db, hoje: hojeLocal })
const dependenciasDe = tarefas => tarefas.length ? listarDependencias({ ids: tarefas.map(t => t.id) }) : []

export async function montarRelatorio(filtros = {}) {
  const f = { ...filtros, visivel_cliente: filtros.interno ? undefined : true }
  const tarefas = listarTarefas(f)
  const kpis = calcularKpis(f)
  const risco = riscos(f)
  const evid = evidenciasDe(tarefas.map(t => t.id))
  const evidPorTarefa = {}
  for (const e of evid) (evidPorTarefa[e.tarefa_id] ??= []).push(e)

  const concluidas = tarefas.filter(t => t.status === 'concluida')
  const datas = tarefas.flatMap(t => [t.data_inicio, t.prazo, t.data_conclusao]).filter(Boolean).sort()

  // consultor: responsável mais frequente
  const contagemResp = {}
  for (const t of tarefas) if (t.responsavel) contagemResp[t.responsavel] = (contagemResp[t.responsavel] || 0) + 1
  const consultor = Object.entries(contagemResp).sort((a, b) => b[1] - a[1])[0]?.[0] || ''

  // 4. evolução por processo (problema → ação → evidência → impacto → próximo passo)
  const processos = graficoProcessos(f).map(p => {
    const doProcesso = tarefas.filter(t => t.processo === p.processo)
    const entregues = doProcesso.filter(t => t.status === 'concluida')
    return {
      ...p,
      situacao_anterior: doProcesso.map(t => t.resultado_esperado).filter(Boolean).slice(0, 2).join(' · '),
      acoes: entregues.map(t => t.titulo).slice(0, 4),
      situacao_atual: entregues.map(t => t.resultado_alcancado).filter(Boolean).slice(0, 2).join(' · '),
      evidencias: entregues.reduce((s, t) => s + (evidPorTarefa[t.id]?.length || 0), 0),
      impactos: doProcesso.map(t => t.impacto).filter(Boolean).slice(0, 2),
      proximos: doProcesso.map(t => t.proximo_passo).filter(Boolean).slice(0, 2),
    }
  })

  // 5. entregas — diferencia atividade executada × entrega × resultado × impacto
  const entregas = concluidas.map(t => ({
    id: t.id, titulo: t.titulo, processo: t.processo, responsavel: t.responsavel,
    data: t.data_conclusao || '', descricao: t.descricao || t.conteudo.slice(0, 280),
    resultado: t.resultado_alcancado, impacto: t.impacto, url: t.url,
    evidencias: evidPorTarefa[t.id] || [],
    sem_resultado_informado: !t.resultado_alcancado && !t.impacto,
  }))

  // 7. pendências e bloqueios — dependências do cliente à parte: não contam como atraso da equipe (motivo e "desde" vêm do registro)
  const porId = new Map(risco.dependencia_cliente.map(t => [t.id, t]))
  const pendencias = [
    ...[...risco.bloqueadas, ...risco.atrasadas.filter(t => t.status !== 'bloqueada')].map(t => ({
      titulo: t.titulo, classe: t.status, status: rotuloStatus[t.status], motivo: t.bloqueio || (t.prazo ? `Prazo vencido em ${t.prazo}` : ''),
      responsavel: t.responsavel || '—', impacto: t.impacto || '—',
      recuperacao: t.proximo_passo || '—', prazo: t.prazo || '—', url: t.url,
    })),
    ...dependenciasDe(risco.dependencia_cliente).map(d => ({                    // mais antiga primeiro (ordem do listar: desde ASC)
      titulo: d.titulo, classe: d.status, status: rotuloStatus[d.status], motivo: `${d.texto} (${d.desde_origem === 'ultima_edicao' ? `em aberto; data aproximada: ${br(d.desde).slice(0, 5)}` : `desde ${br(d.desde)}`})`,
      responsavel: d.responsavel || '—', impacto: porId.get(d.id)?.impacto || '—',
      recuperacao: 'Envio pelo cliente — cobrança do consultor', prazo: '—', url: d.url,
    })),
  ]

  // 8. próximo sprint
  const ordem = ordemSprints(filtros)
  const idx = f.sprint ? ordem.indexOf(f.sprint) : -1
  const proximoSprint = idx >= 0 && idx < ordem.length - 1 ? ordem[idx + 1] : null
  let proximo = null
  if (proximoSprint) {
    const prox = listarTarefas({ ...f, sprint: proximoSprint })
    proximo = {
      sprint: proximoSprint,
      prioridades: prox.filter(t => /alta|urgente|p1/i.test(t.prioridade)).map(t => t.titulo).slice(0, 6),
      tarefas: prox.map(t => ({ titulo: t.titulo, processo: t.processo, responsavel: t.responsavel, prazo: t.prazo })),
      riscos: [
        ...prox.filter(t => !t.responsavel).map(t => `Sem responsável: ${t.titulo}`),
        ...prox.filter(t => !t.prazo).map(t => `Sem prazo: ${t.titulo}`),
      ].slice(0, 6),
      decisoes_cliente: dependenciasDe(prox.filter(ehDependencia)).map(d => `${d.titulo}: ${d.texto}`).slice(0, 4),   // o que o cliente precisa devolver no próximo ciclo
    }
  }

  // 7b. o que depende do cliente, com a explicação (avaliador único; leitura LOCAL do banco, sem Mercado Livre). Só relatório de UM cliente: pendência é por conta e vale para HOJE, não para o sprint.
  // Falha não derruba o relatório: sem a seção + aviso em "Qualidade dos dados". `detalhe_interno` (texto da equipe) nunca sai daqui.
  let pendenciasCliente = [], pendenciasFalhou = false
  if (f.cliente) {
    try { pendenciasCliente = pendenciasReal().avaliar(f.cliente, { paraCliente: !f.interno }).itens.map(({ detalhe_interno, ...p }) => p) } catch { pendenciasFalhou = true }
  }

  // 9. comparação com sprint anterior
  const anterior = sprintAnterior(f)
  const comparacao = anterior ? { sprint: anterior, kpis: calcularKpis({ ...f, sprint: anterior }) } : null

  // 2. resumo executivo (payload compacto → ia.js decide IA × determinístico × cache)
  const payloadIA = {
    contexto: { cliente: f.cliente || 'todos', projeto: f.projeto || 'todos', sprint: f.sprint || 'período' },
    kpis, entregas: entregas.slice(0, 8).map(e => ({ titulo: e.titulo, impacto: e.impacto })),
    riscos: pendencias.slice(0, 5).map(p => p.titulo),
    proximos: proximo?.tarefas.slice(0, 5).map(t => t.titulo) || [],
  }
  const resumo = await resumoExecutivo(f, payloadIA)

  // barra de progresso do plano do mês (quando o relatório é de um cliente)
  const mesDoSprint = (f.sprint?.match(/(\d{4}-\d{2})/) || [])[1] || datas.at(-1)?.slice(0, 7)
  const plano = f.cliente && mesDoSprint ? planoDoMes({ cliente: f.cliente, anoMes: mesDoSprint, interno: !!filtros.interno }) : null

  return {
    plano,
    identificacao: {
      cliente: f.cliente || 'Todos os clientes', projeto: f.projeto || 'Todos os projetos',
      sprint: f.sprint || 'Período completo',
      periodo: datas.length ? `${br(datas[0])} a ${br(datas.at(-1))}` : '—',
      consultor, gerado_em: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      ultima_atualizacao: getEstado('ultimo_sync') ? br(getEstado('ultimo_sync')) : 'nunca sincronizado',
    },
    resumo, kpis, processos, entregas,
    galeria: entregas.filter(e => e.evidencias.length).map(e => ({
      tarefa: e.titulo, processo: e.processo, url: e.url,
      itens: e.evidencias.map(ev => ({ ...ev })),
    })),
    pendencias, pendencias_cliente: pendenciasCliente, proximo, comparacao,
    graficos: { status: graficoStatus(f), processos: graficoProcessos(f), burnup: graficoBurnup(f) },
    avisos: [...avisosQualidade(tarefas, kpis), ...(pendenciasFalhou ? ['As pendências do cliente por canal não foram avaliadas nesta geração: a seção "O que depende do cliente" não foi montada.'] : [])],
  }
}

function avisosQualidade(tarefas, kpis) {
  const avisos = []
  if (kpis.sem_evidencia > 0) avisos.push(`${kpis.sem_evidencia} entrega(s) concluída(s) sem evidência anexada — conclusão de card não é prova de evolução.`)
  if (kpis.sem_prazo > 0) avisos.push(`${kpis.sem_prazo} tarefa(s) sem prazo definido.`)
  if (kpis.sem_responsavel > 0) avisos.push(`${kpis.sem_responsavel} tarefa(s) sem responsável.`)
  const semResultado = tarefas.filter(t => t.status === 'concluida' && !t.resultado_alcancado).length
  if (semResultado) avisos.push(`${semResultado} entrega(s) sem "resultado alcançado" preenchido — o relatório mostra a atividade, mas não o resultado.`)
  return avisos
}

export const br = iso => {
  if (!iso) return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}
