// Gestão por ANALISTA — volume, velocidade, atraso e "o que move resultado", por pessoa.
// Honestidade primeiro (regra de ouro do sistema):
//  • "Atrasada" de verdade = prazo vencido — mas 99% das tarefas abertas não têm prazo no Notion,
//    então o painel mostra as atrasadas reais E declara a cegueira, usando "parada 30+ dias" e
//    "bloqueada" como proxy operacional de atraso (rotulado como proxy, nunca como atraso).
//  • Velocidade = mediana de (conclusão − início) nas concluídas com as DUAS datas (≈92% têm) —
//    cobertura sempre declarada. Mediana, não média (lotes e outliers distorcem média).
//  • Cards com vários responsáveis dão crédito a todos (declarado).
//  • "Resultado para a empresa" em janelas (+1/+3/+5/+15/+20 dias após a conclusão) é mecânica
//    pronta e testada (janelasResultado) — liga sobre VENDAS quando o canal do cliente conectar;
//    sem vendas conectadas o painel não inventa: mostra co-ocorrência de tipos (o que anda junto)
//    e deixa o resultado comercial como "aguardando conexão".
import { db, hojeLocal, agora } from './db.js'
import { criarResolvedor, equipeCfg, normNome } from './equipe.js'
import { playbook } from './plano-cliente.js'
import { ABERTA_SQL, ehAberta } from './status-tarefa.js'

const r1 = n => Math.round(n * 10) / 10
const pct = (a, b) => b ? Math.round(100 * a / b) : 0
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const mediana = v => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : r1((s[m - 1] + s[m]) / 2) }

// tarefas reais: sem demo, sem linhas de relatório, sem as tarefas criadas pela própria distribuição
const BASE = "arquivada = 0 AND fonte != 'demo' AND titulo NOT LIKE '%· PS-%'"
const ABERTA = ABERTA_SQL
const fimDe = "COALESCE(NULLIF(data_conclusao,''), DATE(last_edited, 'localtime'))"   // fallback em data LOCAL (o ISO é UTC)

// explode "Kenia Jubileu, Alexandre Silva" → crédito para cada nome canônico
function explodir(responsavel, canon) {
  // Set: há cards reais com o MESMO nome repetido ('Kenia Jubileu, Kenia Jubileu') — crédito 1×
  return [...new Set(String(responsavel || '').split(',').map(s => canon(s.trim())).filter(Boolean))]
}

// ── lista OFICIAL de analistas de marketplace (base de RH no Notion) ───────
// Só quem está nela aparece no painel; os demais responsáveis (líderes, consultores,
// ex-colaboradores, nomes de teste) ficam de fora — pedido do David em 06/10/2026.
export async function sincronizarAnalistasOficiais() {
  const cfg = equipeCfg.analistas_oficiais || {}
  if (!cfg.db) throw new Error('config/equipe.json → analistas_oficiais.db ausente')
  const { notionReq, resolverFontes } = await import('./notion.js')
  const fontes = await resolverFontes(cfg.db)
  const rota = fontes[0].modo === 'data_source' ? `data_sources/${fontes[0].id}` : `databases/${fontes[0].id}`
  const cargos = new Set((cfg.cargos || []).map(normNome))
  const nomes = new Set((cfg.incluir || []))
  let cursor
  do {
    const r = await notionReq(`${rota}/query`, { method: 'POST', body: { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) } })
    for (const p of r.results) {
      const nome = (p.properties?.Nome?.title || []).map(t => t.plain_text).join('').trim()
      const cargo = p.properties?.Cargo?.select?.name || ''
      const ativo = (p.properties?.Status?.select?.name || '') === 'Ativo'   // o select manda (a data de desligamento tem lixo)
      if (nome && ativo && cargos.has(normNome(cargo))) nomes.add(nome)
    }
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)
  for (const ex of cfg.excluir || []) nomes.delete(ex)
  const t = agora()
  db.transaction(() => {
    db.prepare('DELETE FROM analistas_oficiais').run()
    const ins = db.prepare('INSERT INTO analistas_oficiais (nome, nome_norm, cargo, atualizado_em) VALUES (?,?,?,?)')
    for (const n of nomes) ins.run(n, normNome(n), 'analista', t)
  })()
  return nomes.size
}

export const listaOficial = () => db.prepare('SELECT nome, nome_norm FROM analistas_oficiais ORDER BY nome').all()

// nome curto das tarefas ("Vitória Oliveira") → nome completo do RH ("Vitória de Jesus Rodrigues de Oliveira"):
// todas as palavras do curto aparecem no completo NA ORDEM (subsequência), mínimo 2 palavras;
// ambíguo (2 oficiais possíveis) = NÃO casa — melhor sumir do painel do que creditar à pessoa errada.
export function casadorOficial() {
  const oficiais = listaOficial().map(o => ({ ...o, palavras: o.nome_norm.split(' ') }))
  const subseq = (curto, longo) => {
    let i = 0
    for (const p of longo) if (p === curto[i]) i++
    return i === curto.length
  }
  const cache = new Map()
  return nomeCanon => {
    const n = normNome(nomeCanon)
    if (cache.has(n)) return cache.get(n)
    const palavras = n.split(' ').filter(Boolean)
    let r = null
    if (palavras.length >= 2) {
      const matches = oficiais.filter(o => subseq(palavras, o.palavras))
      if (matches.length === 1) r = matches[0].nome
    } else if (palavras.length === 1) {
      const exato = oficiais.filter(o => o.nome_norm === n)
      if (exato.length === 1) r = exato[0].nome
    }
    cache.set(n, r)
    return r
  }
}

function resolvedor() {
  const nomes = db.prepare(`SELECT DISTINCT responsavel FROM tarefas WHERE ${BASE} AND responsavel != ''`).all()
    .flatMap(r => r.responsavel.split(',').map(s => s.trim())).filter(Boolean)
  return criarResolvedor(nomes)
}

// ── visão do time (uma linha por analista) ─────────────────────────────────
export function visaoTime({ hoje = hojeLocal() } = {}) {
  const canon0 = resolvedor()
  const oficial = casadorOficial()
  const foraDaLista = new Map()                                 // nome canônico → créditos descartados
  const canon = nome => {                                       // crédito só para quem está na base oficial
    const c = canon0(nome)
    if (!c) return ''
    const o = oficial(c)
    if (!o) { foraDaLista.set(c, (foraDaLista.get(c) || 0) + 1); return '' }
    return o                                                    // consolida variações no nome completo do RH
  }
  const d28 = new Date(hoje + 'T12:00:00'); d28.setDate(d28.getDate() - 27)
  const corte28 = d28.toISOString().slice(0, 10)
  const d90 = new Date(hoje + 'T12:00:00'); d90.setDate(d90.getDate() - 89)
  const corte90 = d90.toISOString().slice(0, 10)
  const corteParada = new Date(hoje + 'T12:00:00'); corteParada.setDate(corteParada.getDate() - playbook.limiares.dias_parada)
  const corteP = corteParada.toISOString().slice(0, 10)

  const abertas = db.prepare(`SELECT cliente, responsavel, status, prazo, DATE(last_edited, 'localtime') ed FROM tarefas WHERE ${BASE} AND ${ABERTA}`).all()
  const concluidas = db.prepare(`SELECT cliente, responsavel, tipo_demanda, data_inicio, data_conclusao, ${fimDe} fim FROM tarefas WHERE ${BASE} AND status = 'concluida' AND ${fimDe} >= ?`).all(corte90)

  const A = new Map()
  const linha = n => { if (!A.has(n)) A.set(n, { nome: n, abertas: 0, bloqueadas: 0, paradas30: 0, atrasadas: 0, sem_prazo: 0, clientes: new Set(), concluidas28: 0, concluidas90: 0, duracoes: [], com_duracao: 0, duracao_zero: 0 }); return A.get(n) }

  for (const t of abertas) for (const n of explodir(t.responsavel, canon)) {
    const a = linha(n)
    a.abertas++; a.clientes.add(t.cliente)
    if (t.status === 'bloqueada') a.bloqueadas++
    if (t.ed && t.ed < corteP && t.status !== 'bloqueada') a.paradas30++
    if (t.prazo) { if (t.prazo < hoje) a.atrasadas++ } else a.sem_prazo++
  }
  for (const t of concluidas) for (const n of explodir(t.responsavel, canon)) {
    const a = linha(n)
    a.concluidas90++; a.clientes.add(t.cliente)
    if (t.fim >= corte28) a.concluidas28++
    if (t.data_inicio && t.data_conclusao && t.data_conclusao >= t.data_inicio) {
      const d = diasEntre(t.data_inicio, t.data_conclusao)
      if (d <= 365) { a.duracoes.push(d); a.com_duracao++; if (d === 0) a.duracao_zero++ }   // >1 ano = dado suspeito
    }
  }

  const analistas = [...A.values()].filter(a => a.nome && a.abertas + a.concluidas90 >= 3)
    .map(a => ({
      nome: a.nome, abertas: a.abertas, bloqueadas: a.bloqueadas, paradas30: a.paradas30, atrasadas: a.atrasadas,
      clientes: a.clientes.size, concluidas28: a.concluidas28, concluidas90: a.concluidas90,
      ritmo_semana: r1(a.concluidas28 / 4),
      mediana_dias: mediana(a.duracoes), cobertura_duracao: pct(a.com_duracao, a.concluidas90),
      pct_mesmo_dia: pct(a.duracao_zero, a.com_duracao),
      pct_sem_prazo: pct(a.sem_prazo, a.abertas),
    }))
    .sort((x, y) => y.concluidas28 - x.concluidas28)

  const totAb = abertas.length
  return {
    hoje, janelas: { volume: '28 dias', historico: '90 dias' },
    time: {
      analistas: analistas.length, abertas: totAb,
      atrasadas_reais: abertas.filter(t => t.prazo && t.prazo < hoje).length,
      abertas_com_prazo: abertas.filter(t => t.prazo).length,
      pct_sem_prazo: pct(abertas.filter(t => !t.prazo).length, totAb),
      bloqueadas: abertas.filter(t => t.status === 'bloqueada').length,
      dependencia_cliente: db.prepare(`SELECT COUNT(*) n FROM tarefas WHERE ${BASE} AND status = 'dependencia_cliente'`).get().n,   // fora de abertas, carga e atenção: a cobrança é do consultor
      paradas30: abertas.filter(t => t.ed && t.ed < corteP && t.status !== 'bloqueada').length,
      concluidas28: concluidas.filter(t => t.fim >= corte28).length,
      mediana_dias_time: mediana(analistas.flatMap(a => a.mediana_dias != null ? [a.mediana_dias] : [])),
      pct_mesmo_dia_time: (() => { const cd = concluidas.filter(t => t.data_inicio && t.data_conclusao && t.data_conclusao >= t.data_inicio)
        return pct(cd.filter(t => t.data_inicio === t.data_conclusao).length, cd.length) })(),
    },
    aviso_duracao: 'Na maioria dos cards, início e conclusão são preenchidos JUNTOS (mesmo dia) — a duração medida reflete disciplina de registro, não o tempo real de execução. Quem preenche o início quando começa de fato tem a medida mais fiel.',
    nota_multi: 'Cards com mais de um responsável dão crédito a todos os nomes.',
    lista_oficial: {
      total: listaOficial().length,
      fonte: 'Base "Cadastro de Prestadores de serviço" no Notion — Cargo Analista de E-commerce, Status Ativo',
      fora: [...foraDaLista.entries()].map(([nome, creditos]) => ({ nome, creditos })).sort((a, b) => b.creditos - a.creditos).slice(0, 15),
      fora_total: foraDaLista.size,
    },
    analistas,
  }
}

// ── clientes com tarefas atrasadas (real + proxy, com a cegueira declarada) ──
export function clientesAtrasados({ hoje = hojeLocal() } = {}) {
  const canon0 = resolvedor(), oficial = casadorOficial()
  const canon = nome => { const c = canon0(nome); return c ? (oficial(c) || '') : '' }
  const corteParada = new Date(hoje + 'T12:00:00'); corteParada.setDate(corteParada.getDate() - playbook.limiares.dias_parada)
  const corteP = corteParada.toISOString().slice(0, 10)
  const abertas = db.prepare(`SELECT cliente, titulo, responsavel, status, prazo, DATE(last_edited, 'localtime') ed, url FROM tarefas WHERE ${BASE} AND ${ABERTA}`).all()
  const C = new Map()
  for (const t of abertas) {
    if (!C.has(t.cliente)) C.set(t.cliente, { cliente: t.cliente, abertas: 0, atrasadas: [], bloqueadas: 0, paradas30: 0, mais_antiga: null, analistas: new Set() })
    const c = C.get(t.cliente)
    c.abertas++
    explodir(t.responsavel, canon).forEach(n => c.analistas.add(n))
    if (t.prazo && t.prazo < hoje) c.atrasadas.push({ titulo: t.titulo, prazo: t.prazo, responsavel: t.responsavel, url: t.url })
    if (t.status === 'bloqueada') c.bloqueadas++
    else if (t.ed && t.ed < corteP) { c.paradas30++; if (!c.mais_antiga || t.ed < c.mais_antiga) c.mais_antiga = t.ed }
  }
  const lista = [...C.values()]
    .map(c => ({ ...c, analistas: [...c.analistas].sort(), gravidade: c.atrasadas.length * 3 + c.bloqueadas * 2 + c.paradas30 }))
    .filter(c => c.gravidade > 0)
    .sort((x, y) => y.gravidade - x.gravidade)
  return {
    hoje, clientes: lista,
    cegueira: 'Só tarefas com o campo Prazo preenchido podem ficar "atrasadas" — hoje quase nenhuma tem. Bloqueada e parada 30+ dias entram como proxy operacional de atraso (rotuladas assim, não como atraso por prazo). Tarefas aguardando o cliente não contam como atraso nem como carga do analista.',
  }
}

// ── resultado em janelas após a conclusão (mecânica genérica, testável) ─────
// serie: {dia: valor} (ex.: faturamento/dia). Compara média diária N dias ANTES × N dias DEPOIS
// da conclusão. Associação temporal — NUNCA causalidade comprovada (vários fatores mudam juntos).
export function janelasResultado(serie, dataConclusao, janelas = [1, 3, 5, 15, 20]) {
  const soma = (de, ate) => { let s = 0; for (const [d, v] of Object.entries(serie)) if (d >= de && d <= ate) s += v; return s }
  const add = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const out = {}
  for (const j of janelas) {
    const antes = soma(add(dataConclusao, -j), add(dataConclusao, -1)) / j
    const depois = soma(add(dataConclusao, 1), add(dataConclusao, j)) / j
    out[j] = { antes: r1(antes), depois: r1(depois), delta_pct: antes ? Math.round((depois - antes) / antes * 100) : (depois ? null : 0) }
  }
  return out
}

// ── o que move resultado: tipos de tarefa e combinações (dado real de hoje) ──
export function tiposQueMovem({ hoje = hojeLocal() } = {}) {
  const d90 = new Date(hoje + 'T12:00:00'); d90.setDate(d90.getDate() - 89)
  const corte90 = d90.toISOString().slice(0, 10)
  const rows = db.prepare(`SELECT cliente, COALESCE(NULLIF(tipo_demanda,''),'(sem tipo)') tipo, data_inicio, data_conclusao, ${fimDe} fim
    FROM tarefas WHERE ${BASE} AND status = 'concluida' AND ${fimDe} >= ?`).all(corte90)
  const T = new Map()
  for (const t of rows) {
    if (!T.has(t.tipo)) T.set(t.tipo, { tipo: t.tipo, concluidas: 0, clientes: new Set(), duracoes: [] })
    const x = T.get(t.tipo)
    x.concluidas++; x.clientes.add(t.cliente)
    if (t.data_inicio && t.data_conclusao && t.data_conclusao >= t.data_inicio) {
      const d = diasEntre(t.data_inicio, t.data_conclusao)
      if (d <= 365) x.duracoes.push(d)
    }
  }
  // combinações: tipos concluídos no MESMO cliente com fins a ≤7 dias um do outro (o que anda junto)
  const porCliente = new Map()
  for (const t of rows) { if (!porCliente.has(t.cliente)) porCliente.set(t.cliente, []); porCliente.get(t.cliente).push(t) }
  const combos = new Map()
  for (const ts of porCliente.values()) {
    const vistos = new Set()
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      const a = ts[i], b = ts[j]
      if (a.tipo === b.tipo || a.tipo === '(sem tipo)' || b.tipo === '(sem tipo)') continue
      if (Math.abs(diasEntre(a.fim, b.fim)) > 7) continue
      const k = [a.tipo, b.tipo].sort().join(' + ')
      if (vistos.has(k)) continue                                 // conta 1× por cliente
      vistos.add(k); combos.set(k, (combos.get(k) || 0) + 1)
    }
  }
  return {
    janela: '90 dias',
    tipos: [...T.values()].map(x => ({ tipo: x.tipo, concluidas: x.concluidas, clientes: x.clientes.size, mediana_dias: mediana(x.duracoes) }))
      .sort((a, b) => b.concluidas - a.concluidas).slice(0, 14),
    combos: [...combos.entries()].map(([combo, clientes]) => ({ combo, clientes })).sort((a, b) => b.clientes - a.clientes).slice(0, 10),
    resultado_comercial: 'Variação de vendas +1/+3/+5/+15/+20 dias após cada conclusão (janelasResultado) liga quando o cliente conectar o canal — associação temporal, nunca causa comprovada. Sem vendas conectadas, nada é inventado.',
  }
}

// ── drill-down de um analista ───────────────────────────────────────────────
export function detalheAnalista(nome, { hoje = hojeLocal() } = {}) {
  const canon0 = resolvedor(), oficial = casadorOficial()
  const alvo = oficial(canon0(nome)) || nome                    // aceita nome curto OU o completo do RH
  const canon = n => { const c = canon0(n); return c ? (oficial(c) || '') : '' }
  const corteParada = new Date(hoje + 'T12:00:00'); corteParada.setDate(corteParada.getDate() - playbook.limiares.dias_parada)
  const corteP = corteParada.toISOString().slice(0, 10)
  const d90 = new Date(hoje + 'T12:00:00'); d90.setDate(d90.getDate() - 89)
  const corte90 = d90.toISOString().slice(0, 10)
  const minhas = db.prepare(`SELECT cliente, titulo, status, prazo, tipo_demanda, responsavel, data_inicio, data_conclusao, ${fimDe} fim, DATE(last_edited, 'localtime') ed, url
    FROM tarefas WHERE ${BASE} AND responsavel != ''`).all()          // sem LIKE: acento/caixa no dado cru zerava o resultado
    .filter(t => explodir(t.responsavel, canon).includes(alvo))
  const abertas = minhas.filter(ehAberta)
  const concl90 = minhas.filter(t => t.status === 'concluida' && t.fim >= corte90)
  const porTipo = new Map()
  for (const t of concl90) {
    const k = t.tipo_demanda || '(sem tipo)'
    if (!porTipo.has(k)) porTipo.set(k, { tipo: k, n: 0, duracoes: [] })
    const x = porTipo.get(k); x.n++
    if (t.data_inicio && t.data_conclusao && t.data_conclusao >= t.data_inicio) {
      const d = diasEntre(t.data_inicio, t.data_conclusao)
      if (d <= 365) x.duracoes.push(d)                                 // mesmo corte da visão
    }
  }
  const porCliente = new Map()
  for (const t of abertas) {
    if (!porCliente.has(t.cliente)) porCliente.set(t.cliente, { cliente: t.cliente, abertas: 0, bloqueadas: 0, paradas30: 0, atrasadas: 0 })
    const c = porCliente.get(t.cliente); c.abertas++
    if (t.status === 'bloqueada') c.bloqueadas++
    else if (t.ed && t.ed < corteP) c.paradas30++
    if (t.prazo && t.prazo < hoje) c.atrasadas++
  }
  return {
    nome: alvo, hoje,
    abertas: abertas.length, concluidas90: concl90.length,
    atencao_total: abertas.filter(t => t.status === 'bloqueada' || (t.ed && t.ed < corteP) || (t.prazo && t.prazo < hoje)).length,
    atencao: abertas.filter(t => t.status === 'bloqueada' || (t.ed && t.ed < corteP) || (t.prazo && t.prazo < hoje))
      .map(t => ({ cliente: t.cliente, titulo: t.titulo, motivo: t.prazo && t.prazo < hoje ? `prazo vencido (${t.prazo})` : t.status === 'bloqueada' ? 'bloqueada' : `parada desde ${t.ed}`, url: t.url }))
      .slice(0, 40),
    clientes: [...porCliente.values()].sort((a, b) => (b.bloqueadas * 2 + b.paradas30) - (a.bloqueadas * 2 + a.paradas30)),
    tipos: [...porTipo.values()].map(x => ({ tipo: x.tipo, n: x.n, mediana_dias: mediana(x.duracoes) })).sort((a, b) => b.n - a.n).slice(0, 12),
  }
}
