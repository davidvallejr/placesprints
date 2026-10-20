// Indicadores calculados por código — nenhum token de IA é gasto aqui.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal } from './db.js'
import { ROOT } from './env.js'
import { ORDEM, ROTULOS, PLANEJADA_SQL, ehAberta, ehPlanejada, ehDependencia } from './status-tarefa.js'
import { desdeDe } from './dependencia-cliente.js'

const HOJE = hojeLocal
const L = JSON.parse(readFileSync(join(ROOT, 'config', 'playbook.json'), 'utf-8')).limiares   // lido direto: plano-cliente.js importa este módulo (sem ciclo)
const ORDEM_SQL = ORDEM.map((s, i) => `WHEN '${s}' THEN ${i}`).join(' ')                       // lista fechada de constantes, nunca entrada do usuário

// desde quando cada tarefa depende do cliente: a mesma régua de dependencia-cliente.listar (desdeDe) — o mais antigo entre o registro ativo
// do líder, a última troca de status p/ dependencia_cliente/bloqueada no historico e a última edição; o painel e o relatório dizem o mesmo número
function dependenciaDesde(tarefas) {
  if (!tarefas.length) return new Map()
  const hist = new Map(db.prepare(`SELECT tarefa_id, MAX(em) em FROM historico WHERE campo = 'status' AND para IN ('dependencia_cliente','bloqueada') GROUP BY tarefa_id`).all().map(r => [r.tarefa_id, r.em]))
  const reg = new Map(db.prepare("SELECT tarefa_id, em FROM tarefa_dependencia WHERE notion_ok = 1 AND reaberta_em = ''").all().map(r => [r.tarefa_id, r.em]))
  const m = new Map(), aprox = new Set()
  for (const t of tarefas) { const d = desdeDe({ registro_em: reg.get(t.id), historico_em: hist.get(t.id), last_edited: t.last_edited }); m.set(t.id, d.desde); if (d.desde_origem === 'ultima_edicao') aprox.add(t.id) }
  m.aprox = aprox                                                // ids cuja data é APROXIMADA (veio da última edição do card): não sustentam "há N dias" ao cliente
  return m
}

function whereFiltros(f = {}) {
  const cond = ['arquivada = 0', "fonte != 's90'"], args = []   // s90 = "fiz" informado pelo cliente do Place Sprint 90: nunca entra nos KPIs do time
  const eq = (campo, valor) => { if (valor) { cond.push(`${campo} = ?`); args.push(valor) } }
  eq('cliente', f.cliente); eq('projeto', f.projeto); eq('sprint', f.sprint)
  eq('processo', f.processo); eq('responsavel', f.responsavel); eq('status', f.status)
  if (f.visivel_cliente) cond.push('visivel_cliente = 1')
  if (f.de) { cond.push(`COALESCE(data_conclusao, prazo, data_inicio, substr(last_edited,1,10)) >= ?`); args.push(f.de) }
  if (f.ate) { cond.push(`COALESCE(data_conclusao, prazo, data_inicio, substr(last_edited,1,10)) <= ?`); args.push(f.ate) }
  if (f.sql?.where) { cond.push(`(${f.sql.where})`); args.push(...f.sql.args) }   // filtro avançado (?f=) já compilado por lib/filtros.js
  return { where: cond.join(' AND '), args }
}

export function listarTarefas(f = {}) {
  const { where, args } = whereFiltros(f)
  return db.prepare(`SELECT * FROM tarefas WHERE ${where} ORDER BY CASE status ${ORDEM_SQL} ELSE ${ORDEM.length} END, prazo`).all(args)
}

export function opcoesFiltros() {
  const col = c => db.prepare(`SELECT DISTINCT ${c} AS v FROM tarefas WHERE arquivada = 0 AND fonte != 's90' AND ${c} != '' ORDER BY v`).all().map(r => r.v)
  return {
    clientes: col('cliente'), projetos: col('projeto'), sprints: col('sprint'),
    processos: col('processo'), responsaveis: col('responsavel'),
  }
}

export function calcularKpis(f = {}) {
  const todas = listarTarefas(f)
  const tarefas = todas.filter(ehPlanejada)                       // dependência do cliente fica fora do denominador
  const ev = new Map(db.prepare('SELECT tarefa_id, COUNT(*) AS n FROM evidencias GROUP BY tarefa_id').all().map(r => [r.tarefa_id, r.n]))
  const hoje = HOJE()
  const peso = t => t.esforco ?? 1
  const concluidas = tarefas.filter(t => t.status === 'concluida')
  const atrasadas = tarefas.filter(t => t.prazo && t.prazo < hoje && t.status !== 'concluida')
  const comEvid = concluidas.filter(t => ev.get(t.id))
  const dependencias = todas.filter(ehDependencia), desde = dependenciaDesde(dependencias)
  const corteDep = new Date(hoje + 'T12:00:00'); corteDep.setDate(corteDep.getDate() - L.dependencia_atencao_dias)
  const corteDepIso = corteDep.toISOString().slice(0, 10)

  // transferidas: tarefas que SAÍRAM do sprint filtrado (histórico de mudança de sprint)
  let transferidas = 0
  if (f.sprint) {
    transferidas = db.prepare(`SELECT COUNT(DISTINCT tarefa_id) AS n FROM historico WHERE campo = 'sprint' AND de = ?`).get(f.sprint)?.n ?? 0
  }

  const esfPlan = tarefas.reduce((s, t) => s + peso(t), 0)
  const esfConc = concluidas.reduce((s, t) => s + peso(t), 0)

  return {
    planejadas: tarefas.length,
    concluidas: concluidas.length,
    pct_conclusao: tarefas.length ? Math.round(100 * concluidas.length / tarefas.length) : 0,
    andamento: tarefas.filter(t => t.status === 'andamento').length,
    validacao: tarefas.filter(t => t.status === 'validacao').length,
    nao_iniciadas: tarefas.filter(t => t.status === 'nao_iniciada').length,
    bloqueadas: tarefas.filter(t => t.status === 'bloqueada').length,
    dependencia_cliente: dependencias.length,                      // fora de planejadas: não é entrega nem bloqueio
    dependencia_14d: dependencias.filter(t => desde.get(t.id) && desde.get(t.id) <= corteDepIso).length,
    dependencia_14d_exata: dependencias.filter(t => desde.get(t.id) && desde.get(t.id) <= corteDepIso && !desde.aprox.has(t.id)).length,   // só datas reais (registro/histórico): é o que o relatório ao cliente pode dizer "há 14+ dias"
    atrasadas: atrasadas.length,
    transferidas,
    com_evidencia: comEvid.length,
    cobertura_evidencias: concluidas.length ? Math.round(100 * comEvid.length / concluidas.length) : 0,
    esforco_planejado: Math.round(esfPlan * 10) / 10,
    esforco_concluido: Math.round(esfConc * 10) / 10,
    pct_esforco: esfPlan ? Math.round(100 * esfConc / esfPlan) : 0,
    sem_responsavel: tarefas.filter(t => !t.responsavel).length,
    sem_prazo: tarefas.filter(t => !t.prazo).length,
    sem_evidencia: concluidas.length - comEvid.length,
  }
}

// Ordena sprints pela data mínima das tarefas (funciona para nomes arbitrários).
export function ordemSprints(f = {}) {
  const { where, args } = whereFiltros({ ...f, sprint: undefined })
  return db.prepare(`SELECT sprint, MIN(COALESCE(data_inicio, prazo, data_conclusao, substr(last_edited,1,10))) AS ini
    FROM tarefas WHERE ${where} AND sprint != '' GROUP BY sprint ORDER BY ini`).all(args).map(r => r.sprint)
}

export function sprintAnterior(f = {}) {
  if (!f.sprint) return null
  const ordem = ordemSprints(f)
  const i = ordem.indexOf(f.sprint)
  return i > 0 ? ordem[i - 1] : null
}

// ── dados dos gráficos ───────────────────────────────────────────────────
export function graficoBurnup(f = {}) {
  const cond = ['1=1'], args = []
  for (const c of ['cliente', 'projeto', 'sprint']) if (f[c]) { cond.push(`${c} = ?`); args.push(f[c]) }
  const linhas = db.prepare(`SELECT dia, SUM(planejadas) AS plan, SUM(concluidas) AS conc
    FROM snapshots WHERE ${cond.join(' AND ')} GROUP BY dia ORDER BY dia`).all(args)
  if (!linhas.length) return { dias: [], planejado: [], concluido: [], ideal: [], span: null }
  const total = linhas.at(-1).plan
  const n = linhas.length
  // ritmo ideal = reta do INÍCIO ao FIM planejado do sprint (não do 1º ao último snapshot: senão o último dia sempre dá 100%).
  // início = 1ª data de início/prazo das tarefas do sprint; fim = véspera do início do sprint seguinte (cadência mensal), senão o maior prazo.
  let span = null
  if (f.sprint) {
    const r = db.prepare(`SELECT MIN(COALESCE(NULLIF(data_inicio,''), NULLIF(prazo,''))) ini, MAX(NULLIF(prazo,'')) fim FROM tarefas WHERE arquivada = 0 AND sprint = ?`).get(f.sprint)
    const ordem = ordemSprints({ ...f, sprint: undefined }), prox = ordem[ordem.indexOf(f.sprint) + 1]
    const iniProx = prox ? db.prepare(`SELECT MIN(COALESCE(NULLIF(data_inicio,''), NULLIF(prazo,''))) ini FROM tarefas WHERE arquivada = 0 AND sprint = ?`).get(prox)?.ini : null
    const vespera = iniProx ? new Date(iniProx + 'T12:00:00') : null; if (vespera) vespera.setDate(vespera.getDate() - 1)
    // cadência mensal: o fim é o último dia do mês do nome ("Sprint 2026-10" → 31/10) ou a véspera do sprint seguinte, o que vier ANTES (e depois do início)
    const mes = /(\d{4})-(\d{2})/.exec(f.sprint), fimMes = mes ? new Date(Number(mes[1]), Number(mes[2]), 0).toISOString().slice(0, 10) : null
    const candidatos = [vespera ? vespera.toISOString().slice(0, 10) : null, fimMes].filter(d => d && (!r?.ini || d > r.ini)).sort()
    const fim = candidatos[0] || r?.fim || null
    if (r?.ini && fim && fim > r.ini) span = { ini: r.ini, fim }
  }
  const frac = dia => { if (!span) return null; const a = new Date(span.ini + 'T12:00:00'), b = new Date(span.fim + 'T12:00:00'), d = new Date(dia + 'T12:00:00'); return Math.max(0, Math.min(1, (d - a) / (b - a))) }
  return {
    dias: linhas.map(l => l.dia),
    planejado: linhas.map(l => l.plan),
    concluido: linhas.map(l => l.conc),
    ideal: linhas.map((l, i) => Math.round(total * (span ? frac(l.dia) : (n === 1 ? 1 : i / (n - 1))))),
    span, ideal_base: span ? 'inicio_fim_do_sprint' : 'janela_dos_snapshots',
  }
}

export function graficoStatus(f = {}) {
  const tarefas = listarTarefas(f)
  return Object.keys(ROTULOS).map(s => ({ status: s, rotulo: ROTULOS[s], n: tarefas.filter(t => t.status === s).length }))
    .filter(x => x.n > 0)
}

export function graficoProcessos(f = {}) {
  const tarefas = listarTarefas(f).filter(ehPlanejada)
  const grupos = {}
  for (const t of tarefas) {
    const g = grupos[t.processo] ??= { processo: t.processo, total: 0, concluidas: 0, esforco: 0, esforco_conc: 0 }
    g.total++; g.esforco += t.esforco ?? 1
    if (t.status === 'concluida') { g.concluidas++; g.esforco_conc += t.esforco ?? 1 }
  }
  return Object.values(grupos)
    .map(g => ({ ...g, pct: g.total ? Math.round(100 * g.concluidas / g.total) : 0 }))
    .sort((a, b) => b.total - a.total)
}

export function graficoSemanas(f = {}) {
  const concl = listarTarefas(f).filter(t => t.status === 'concluida' && t.data_conclusao)
  const semanas = {}
  for (const t of concl) {
    const d = new Date(t.data_conclusao + 'T12:00:00')
    const seg = new Date(d); seg.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const chave = seg.toISOString().slice(0, 10)
    semanas[chave] = (semanas[chave] || 0) + 1
  }
  return Object.entries(semanas).sort(([a], [b]) => a.localeCompare(b))
    .map(([semana, n]) => ({ semana, n }))
}

export function riscos(f = {}) {
  const todas = listarTarefas(f)
  const tarefas = todas.filter(ehAberta)                            // atrasadas/sem dono/sem prazo só sobre o backlog ativo
  const ev = new Map(db.prepare('SELECT tarefa_id, COUNT(*) AS n FROM evidencias GROUP BY tarefa_id').all().map(r => [r.tarefa_id, r.n]))
  const hoje = HOJE()
  const concluidasSemEvid = todas.filter(t => t.status === 'concluida' && !ev.get(t.id))
  const dependencias = todas.filter(ehDependencia), desde = dependenciaDesde(dependencias)
  return {
    atrasadas: tarefas.filter(t => t.prazo && t.prazo < hoje),
    bloqueadas: tarefas.filter(t => t.status === 'bloqueada'),
    sem_responsavel: tarefas.filter(t => !t.responsavel),
    sem_prazo: tarefas.filter(t => !t.prazo),
    sem_evidencia: concluidasSemEvid,
    dependencia_cliente: dependencias.map(t => ({ ...t, desde: desde.get(t.id) || null })),   // à parte: a cobrança é do consultor
  }
}

// Plano de ação do mês de um cliente: tarefas cujo sprint referencia o mês
// OU cuja data (início/prazo/conclusão) cai no mês. Alimenta a barra de progresso.
export function planoDoMes({ cliente, anoMes, interno = false }) {
  if (!cliente || !anoMes) return null
  const doMes = `arquivada = 0 AND cliente = ? ${interno ? '' : 'AND visivel_cliente = 1'}
    AND (sprint LIKE '%' || ? || '%' OR COALESCE(data_inicio, prazo, data_conclusao) LIKE ? || '%')`
  const rows = db.prepare(`SELECT status, esforco FROM tarefas WHERE ${PLANEJADA_SQL} AND ${doMes}`).all(cliente, anoMes, anoMes)
  const dependencia_cliente = db.prepare(`SELECT COUNT(*) n FROM tarefas WHERE status = 'dependencia_cliente' AND ${doMes}`).get(cliente, anoMes, anoMes).n   // à parte: não entra no total
  if (!rows.length) return { anoMes, total: 0, concluidas: 0, pct: 0, esforco: 0, esforco_concluido: 0, pct_esforco: 0, andamento: 0, bloqueadas: 0, dependencia_cliente }
  const peso = r => r.esforco ?? 1
  const conc = rows.filter(r => r.status === 'concluida')
  const esfTotal = rows.reduce((s, r) => s + peso(r), 0)
  const esfConc = conc.reduce((s, r) => s + peso(r), 0)
  return {
    anoMes,
    total: rows.length,
    concluidas: conc.length,
    pct: Math.round(100 * conc.length / rows.length),
    esforco: Math.round(esfTotal * 10) / 10,
    esforco_concluido: Math.round(esfConc * 10) / 10,
    pct_esforco: esfTotal ? Math.round(100 * esfConc / esfTotal) : 0,
    andamento: rows.filter(r => ['andamento', 'validacao'].includes(r.status)).length,
    bloqueadas: rows.filter(r => r.status === 'bloqueada').length,
    dependencia_cliente,
  }
}

export function evidenciasDe(tarefaIds) {
  if (!tarefaIds.length) return []
  const q = tarefaIds.map(() => '?').join(',')
  return db.prepare(`SELECT * FROM evidencias WHERE tarefa_id IN (${q}) ORDER BY criada_em`).all(tarefaIds)
}
