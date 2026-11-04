// Calibração: o algoritmo aprende com o que foi MEDIDO, em vez de repetir premissas.
//  • priorEfetivo(regra): probabilidade de sucesso = premissa inicial, mesclada (encolhimento bayesiano, k=5)
//    com a taxa de melhora das tarefas medidas do mesmo tipo — só depois de ≥ min_n_padrao tarefas.
//  • compararPrevisaoRealizado(): cada ação distribuída guarda a PREVISÃO; quando a tarefa (identificada pelo
//    "· PS-xxxx" no título do card) é medida, comparamos previsto × realizado → viés e erro do algoritmo.
//  • saudeRegras(): o registro de regras com sua saúde — regra que não funciona vira candidata à aposentadoria.
//  • agruparCalibracao(comp, { por }) (puro) / fotografarCalibracao({ hoje }) / serieCalibracao(): Brier, erro, viés e taxa Wilson POR regra, família e cliente,
//    gravados 1×/dia em calibracao_dia («Neo aprende sobre si», 04/11/2026) — antes só existia o Brier global sob demanda, sem série.
//  • lerAprendido(): overrides que o Neo aplicou (config/algoritmo-aprendido.json: p_sucesso e ativa por regra). algoritmo.json NUNCA é reescrito; o aprendido
//    tem precedência na premissa inicial de priorEfetivo e regraEmQuarentena(id) tira a regra do plano (plano-anuncios.montarAcoes).
import { db } from './db.js'
import { normNome } from './equipe.js'
import { algoritmo } from './diagnostico-conta.js'
import { padroesGlobais, analisarCliente, wilson, excluirDaAprendizagem } from './impacto-tarefas.js'
import { cfgAtrib } from './meli-serie.js'
import { familiaDeDemanda } from './processos.js'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const SCHEMA_CALIBRACAO = `
CREATE TABLE IF NOT EXISTS calibracao_dia (
  dia TEXT NOT NULL,
  escopo TEXT NOT NULL CHECK (escopo IN ('global','regra','familia','cliente')),
  chave TEXT NOT NULL,
  n INTEGER NOT NULL,
  acertos INTEGER NOT NULL,
  brier REAL,
  mae REAL,
  vies REAL,
  pct_intervalo REAL,
  taxa REAL,
  taxa_baixo REAL,
  taxa_alto REAL,
  versao TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (dia, escopo, chave)
);
`
// overrides aprendidos (Neo): { regra: { p_sucesso?, ativa?, desde, proposta_id } } — lido com cache por mtime; arquivo ausente/ilegível = {} (a premissa vale)
export const ARQUIVO_APRENDIDO = join(ROOT, 'config', 'algoritmo-aprendido.json')
let aprendidoCache = { mtime: -1, v: {} }
export function lerAprendido(caminho = ARQUIVO_APRENDIDO) {
  try {
    const m = statSync(caminho).mtimeMs
    if (caminho === ARQUIVO_APRENDIDO && m === aprendidoCache.mtime) return aprendidoCache.v
    const v = JSON.parse(readFileSync(caminho, 'utf-8')), regras = v && typeof v === 'object' && v.regras && typeof v.regras === 'object' ? v.regras : {}
    if (caminho === ARQUIVO_APRENDIDO) aprendidoCache = { mtime: m, v: regras }
    return regras
  } catch { if (caminho === ARQUIVO_APRENDIDO) aprendidoCache = { mtime: -1, v: {} }; return {} }
}
export const regraEmQuarentena = (regraId, aprendido = lerAprendido()) => aprendido[String(regraId).replace(/^anuncio_/, '')]?.ativa === false

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
  const ap = lerAprendido()[id]
  const p0 = ap?.p_sucesso ?? algoritmo.priors_efeito[id]?.p_sucesso ?? 0.3   // aprendido (Neo) > premissa do algoritmo.json > 0,3
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
  return { p: p0, n: 0, fonte: ap?.p_sucesso != null ? `premissa aprendida pelo Neo em ${String(ap.desde || '').slice(0, 10)} (proposta ${ap.proposta_id || '—'})` : 'premissa inicial (ainda sem tarefas medidas suficientes desse tipo)' }
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

// ── calibração por escopo, gravada por dia («Neo aprende sobre si») ──
const acertou = l => l.estado === 'melhorou' || (l.estado === 'lancamento' && l.realizado > 0)
const familiaDaRegra = regra => { const id = String(regra).replace(/^anuncio_/, ''), tipo = algoritmo.regras.find(r => r.id === id)?.tipo_demanda; return tipo ? familiaDeDemanda(tipo).id : 'sem_familia' }
// PURO: comp = saída de compararPrevisaoRealizado(); por ∈ global|regra|familia|cliente → [{ chave, n, acertos, brier, mae, vies, pct_intervalo, taxa, taxa_baixo, taxa_alto }]
export function agruparCalibracao(comp, { por = 'regra' } = {}) {
  const chaveDe = l => por === 'global' ? 'global' : por === 'regra' ? String(l.regra).replace(/^anuncio_/, '') : por === 'familia' ? familiaDaRegra(l.regra) : String(l.cliente)
  const grupos = new Map()
  for (const l of comp.linhas || []) (grupos.get(chaveDe(l)) || grupos.set(chaveDe(l), []).get(chaveDe(l))).push(l)
  return [...grupos].map(([chave, ls]) => {
    const n = ls.length, k = ls.filter(acertou).length, w = wilson(k, n), r = x => Math.round(x * 1000) / 1000
    return { chave, n, acertos: k,
      brier: r(ls.reduce((t, l) => t + (l.p_sucesso - (acertou(l) ? 1 : 0)) ** 2, 0) / n),
      mae: Math.round(ls.reduce((t, l) => t + Math.abs(l.previsto_base - l.realizado), 0) / n),
      vies: Math.round(ls.reduce((t, l) => t + (l.previsto_base - l.realizado), 0) / n),
      pct_intervalo: r(ls.filter(l => l.dentro_do_intervalo).length / n), taxa: r(w.p), taxa_baixo: r(w.baixo), taxa_alto: r(w.alto) }
  }).sort((a, b) => b.n - a.n)
}
// 1×/dia (tick da medição): grava os 4 escopos; o mesmo dia regravado substitui (idempotente). Devolve quantas linhas gravou.
export function fotografarCalibracao({ hoje, handle = db, comp = compararPrevisaoRealizado(), versao = String(algoritmo.versao || '') } = {}) {
  handle.exec(SCHEMA_CALIBRACAO)
  const ins = handle.prepare('INSERT OR REPLACE INTO calibracao_dia (dia, escopo, chave, n, acertos, brier, mae, vies, pct_intervalo, taxa, taxa_baixo, taxa_alto, versao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
  let n = 0
  handle.transaction(() => {
    for (const por of ['global', 'regra', 'familia', 'cliente']) for (const g of agruparCalibracao(comp, { por })) { ins.run(hoje, por, g.chave, g.n, g.acertos, g.brier, g.mae, g.vies, g.pct_intervalo, g.taxa, g.taxa_baixo, g.taxa_alto, versao); n++ }
  })()
  return n
}
export const serieCalibracao = ({ escopo = 'global', chave = 'global', dias = 90, handle = db } = {}) =>
  handle.prepare('SELECT * FROM calibracao_dia WHERE escopo = ? AND chave = ? ORDER BY dia DESC LIMIT ?').all(escopo, chave, Math.max(1, Math.min(365, dias))).reverse()
// últimas N fotos (dias distintos) de um escopo inteiro — é o que o Neo lê para exigir «2 fotos consecutivas»
export const ultimasFotos = ({ escopo, fotos = 2, handle = db } = {}) => {
  const dias = handle.prepare('SELECT DISTINCT dia FROM calibracao_dia WHERE escopo = ? ORDER BY dia DESC LIMIT ?').all(escopo, fotos).map(r => r.dia)
  return dias.map(dia => ({ dia, linhas: handle.prepare('SELECT * FROM calibracao_dia WHERE escopo = ? AND dia = ?').all(escopo, dia) }))
}
