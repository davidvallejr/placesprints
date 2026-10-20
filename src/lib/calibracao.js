// Calibração: o algoritmo aprende com o que foi MEDIDO, em vez de repetir premissas.
//  • priorEfetivo(regra): probabilidade de sucesso = premissa inicial, mesclada (encolhimento bayesiano, k=5)
//    com a taxa de melhora das tarefas medidas do mesmo tipo — só depois de ≥ min_n_padrao tarefas.
//  • compararPrevisaoRealizado(): cada ação distribuída guarda a PREVISÃO; quando a tarefa (identificada pelo
//    "· PS-xxxx" no título do card) é medida, comparamos previsto × realizado → viés e erro do algoritmo.
//  • saudeRegras(): o registro de regras com sua saúde — regra que não funciona vira candidata à aposentadoria.
import { db } from './db.js'
import { normNome } from './equipe.js'
import { algoritmo } from './diagnostico-conta.js'
import { padroesGlobais, analisarCliente, wilson, excluirDaAprendizagem } from './impacto-tarefas.js'
import { cfgAtrib } from './meli-serie.js'
import { familiaDeDemanda } from './processos.js'

const K_PSEUDO = 5
let cache = { em: 0, p: null }
function padroes() {
  if (!cache.p || Date.now() - cache.em > 5 * 60_000) cache = { em: Date.now(), p: padroesGlobais() }
  return cache.p
}
export const limparCacheCalibracao = () => { cache = { em: 0, p: null } }
export const padroesGlobaisCache = padroes          // a retroalimentação reutiliza a mesma análise (cache de 5 min) em vez de refazer a de todos os clientes

export function priorEfetivo(regraId) {
  const id = String(regraId).replace(/^anuncio_/, '')
  const p0 = algoritmo.priors_efeito[id]?.p_sucesso ?? 0.3
  const tipo = algoritmo.regras.find(r => r.id === id)?.tipo_demanda
  try {
    // por FAMÍLIA de demanda: "Duplicar anúncios", "Duplicação" e "Duplicação de Anuncio" são a mesma tarefa — somam a amostra
    const fam = tipo && familiaDeDemanda(tipo).id
    const grupo = fam ? padroes().por_tipo.filter(x => familiaDeDemanda(x.chave).id === fam) : []
    const g = grupo.length ? { n: grupo.reduce((t, x) => t + x.n, 0), melhorou: grupo.reduce((t, x) => t + x.melhorou, 0) } : null
    if (g && g.n >= cfgAtrib.min_n_padrao) {
      const p = (g.melhorou + K_PSEUDO * p0) / (g.n + K_PSEUDO)
      return { p, n: g.n, fonte: `calibrado: ${g.melhorou} de ${g.n} tarefas "${familiaDeDemanda(tipo).nome}" melhoraram, mescladas à premissa ${Math.round(p0 * 100)}%` }
    }
  } catch { /* sem série medida: fica a premissa */ }
  return { p: p0, n: 0, fonte: 'premissa inicial (ainda sem tarefas medidas suficientes desse tipo)' }
}

const RX_PS = /PS-[0-9a-f]{7,10}/

// previsto × realizado, só para ações que viraram tarefa E já foram medidas
export function compararPrevisaoRealizado() {
  const acoes = db.prepare("SELECT id, cliente, regra, previsao_json FROM acoes_plano WHERE regra LIKE 'anuncio\\_%' ESCAPE '\\' AND status = 'distribuida' AND previsao_json != ''").all()
  const porCliente = new Map()
  for (const a of acoes) (porCliente.get(a.cliente) || porCliente.set(a.cliente, []).get(a.cliente)).push(a)
  const linhas = []
  for (const [cliente, lista] of porCliente) {
    const ids = new Map(lista.map(a => [a.id, a]))
    let analise
    try { analise = analisarCliente(cliente) } catch { continue }
    for (const m of analise.medidas) {
      const ps = RX_PS.exec(m.titulo || '')?.[0]
      const a = ps && ids.get(ps)
      if (!a || excluirDaAprendizagem(m) || !['melhorou', 'piorou', 'sem_efeito', 'lancamento'].includes(m.estado)) continue   // pico ou preço mexendo junto: não calibra
      const prev = JSON.parse(a.previsao_json)
      if (prev.tipo !== 'ganho') continue                              // risco evitado / pendência não têm "realizado" comparável
      const realizado = m.estado === 'sem_efeito' ? 0 : (m.receita_alocada || 0)
      linhas.push({ cliente, acao: a.id, regra: a.regra, estado: m.estado, previsto_base: prev.cenarios.base.receita, previsto_conservador: prev.cenarios.conservador.receita, previsto_otimista: prev.cenarios.otimista.receita, p_sucesso: prev.p_sucesso, realizado, dentro_do_intervalo: realizado >= prev.cenarios.conservador.receita && realizado <= prev.cenarios.otimista.receita })
    }
  }
  const n = linhas.length
  return {
    n, linhas,
    erro_absoluto_medio: n ? Math.round(linhas.reduce((t, l) => t + Math.abs(l.previsto_base - l.realizado), 0) / n) : null,
    vies: n ? Math.round(linhas.reduce((t, l) => t + (l.previsto_base - l.realizado), 0) / n) : null,          // >0 = o algoritmo superestima
    pct_no_intervalo: n ? Math.round(100 * linhas.filter(l => l.dentro_do_intervalo).length / n) : null,
    brier: n ? Math.round(1000 * linhas.reduce((t, l) => t + (l.p_sucesso - (l.estado === 'melhorou' || (l.estado === 'lancamento' && l.realizado > 0) ? 1 : 0)) ** 2, 0) / n) / 1000 : null,
    nota: n ? 'viés > 0 = previsão acima do realizado; Brier perto de 0 = probabilidades bem calibradas.' : 'Nenhuma ação distribuída foi medida ainda — a calibração começa quando as primeiras tarefas completarem 14 dias.',
  }
}

// registro de regras + saúde
export function saudeRegras() {
  const comp = compararPrevisaoRealizado()
  return algoritmo.regras.map(r => {
    const reg = 'anuncio_' + r.id
    const cont = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM acoes_plano WHERE regra = ? GROUP BY status").all(reg).map(x => [x.status, x.n]))
    const medidas = comp.linhas.filter(l => l.regra === reg)
    const k = medidas.filter(l => l.estado === 'melhorou' || (l.estado === 'lancamento' && l.realizado > 0)).length
    const w = wilson(k, medidas.length)
    const geradas = Object.values(cont).reduce((t, n) => t + n, 0)
    let situacao = 'sem dados ainda'
    if (medidas.length >= 10 && w.alto < 0.25) situacao = 'candidata à aposentadoria'
    else if (medidas.length >= cfgAtrib.min_n_padrao) situacao = 'validada pelos dados'
    else if (geradas) situacao = 'em observação'
    return {
      id: r.id, descricao: r.descricao, kpi: r.kpi, dados: r.dados, tipo_demanda: r.tipo_demanda, ativa: r.ativa, justificativa: r.justificativa,
      geradas, distribuidas: cont.distribuida || 0, descartadas: cont.descartada || 0, medidas: medidas.length, melhoraram: k,
      taxa: w.p, taxa_baixo: w.baixo, taxa_alto: w.alto, situacao,
      prior: algoritmo.priors_efeito[r.id]?.p_sucesso ?? null, prior_efetivo: priorEfetivo(r.id),
    }
  })
}
