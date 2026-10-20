// Motor de classificação Eisenhower — 100% determinístico, configurável em
// config/eisenhower.json (nenhum token de IA gasto aqui, mesmo princípio do
// resto do sistema). Classifica UMA tarefa por vez; quem agrega por analista
// e calcula frequência mensal (necessária para "Delegar") é analista.js.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { hojeLocal } from './db.js'
import { ehAberta } from './status-tarefa.js'

export const regrasEisenhower = JSON.parse(readFileSync(join(ROOT, 'config', 'eisenhower.json'), 'utf-8'))

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// índice normalizado tipo_demanda → regra (comparação sem acento/caixa)
const indiceTipos = new Map(Object.entries(regrasEisenhower.tipos).map(([k, v]) => [semAcento(k), v]))
const padroesTitulo = Object.entries(regrasEisenhower.padroes_titulo || {})
  .filter(([k]) => k !== '$comentario')
  .map(([regex, v]) => [new RegExp(regex, 'i'), v])

function regraDoTipo(tarefa) {
  if (tarefa.tipo_demanda) {
    const r = indiceTipos.get(semAcento(tarefa.tipo_demanda))
    if (r) return r
  }
  const alvo = semAcento(tarefa.titulo)
  for (const [regex, r] of padroesTitulo) if (regex.test(alvo)) return r
  return regrasEisenhower.padrao
}

const diasDesde = iso => iso ? Math.floor((Date.now() - new Date(iso + 'T12:00:00').getTime()) / 86400000) : null

// hoje() é injetável para testes; por padrão usa a data local do sistema.
export function classificarTarefa(tarefa, { hoje = hojeLocal(), frequenciaTipo = 0 } = {}) {
  if (!ehAberta(tarefa)) return null // só tarefas em aberto entram na matriz (dependência do cliente fica fora: a cobrança é do consultor)

  const regra = regraDoTipo(tarefa)
  let urgente = regra.urgente
  let importante = regra.estrategica

  // sinais reais da tarefa, além da regra do tipo:
  if (tarefa.status === 'bloqueada') urgente = true                         // travada = precisa de ação agora
  if (tarefa.prazo && tarefa.prazo < hoje) urgente = true                    // prazo vencido, quando existe
  if (tarefa.prazo && tarefa.prazo >= hoje && tarefa.prazo <= addDias(hoje, 2)) urgente = true // vence em até 2 dias

  const idadeDias = diasDesde(tarefa.data_conclusao ? null : (tarefa.data_inicio || tarefa.last_edited?.slice(0, 10)))
  const parada = tarefa.status === 'nao_iniciada' && idadeDias != null && idadeDias >= regrasEisenhower.eliminar.dias_parada_minimo

  const cfgDelegar = regrasEisenhower.delegar
  const candidataDelegar = !importante && regra.minutos <= cfgDelegar.minutos_maximo && frequenciaTipo >= cfgDelegar.frequencia_minima_mes

  // Delegar é sobre QUEM faz, não QUANDO — por isso vem antes da checagem de
  // urgência: uma "Transmissão por Chat" pode ser urgente E delegável ao
  // mesmo tempo (alguém mais pode responder o chat hoje mesmo). Só cai em
  // "fazer" por urgência quando NÃO é candidata estrutural a delegação.
  let quadrante
  if (parada && !urgente) quadrante = 'eliminar'
  else if (candidataDelegar) quadrante = 'delegar'
  else if (urgente) quadrante = 'fazer'                       // urgente (importante ou não) precisa sair já
  else if (importante) quadrante = 'agendar'
  else quadrante = 'agendar'

  return {
    quadrante, urgente, importante,
    minutos: regra.minutos,
    idade_dias: idadeDias,
    motivo: motivoQuadrante(quadrante, { urgente, importante, parada, candidataDelegar, tarefa }),
  }
}

const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function motivoQuadrante(q, { urgente, importante, parada, candidataDelegar, tarefa }) {
  if (q === 'eliminar') return `parada há ${diasDesde(tarefa.data_inicio || tarefa.last_edited?.slice(0, 10))}+ dias sem sinal de bloqueio — avaliar cancelar`
  if (q === 'delegar') return 'tipo recorrente e de baixo tempo/complexidade — candidata a delegação'
  if (q === 'fazer' && tarefa.status === 'bloqueada') return 'bloqueada — precisa de ação para destravar'
  if (q === 'fazer' && tarefa.prazo && tarefa.prazo < hojeLocal()) return 'prazo vencido'
  if (q === 'fazer') return 'urgente e importante — decai com o tempo ou mexe com receita/reputação do cliente'
  if (q === 'agendar') return 'importante, sem pressão de tempo imediata — bloco de foco dedicado'
  return 'sem sinal forte — revisar manualmente'
}
