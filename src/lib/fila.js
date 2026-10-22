// Fila do dia por papel — «Hoje» (F5 dos 5 menus, 21/10/2026; docs/ux/arquitetura-5-menus.md § B e § G «F5»). PURO: recebe listas já lidas (fila-real.js)
// e devolve ATÉ 5 blocos por papel (dono · lider · consultor · analista · cs · tecnico; sem papel = líder, a mesa de exceções). Nenhum motor novo: só projeta o que
// acoes_plano, tarefas, exec_ordem, exec_liberacao, gatilho_lote, relatorio_envio, feedback_relatorio, incidente, custos, meli_contas, aprendizado e o avaliador de
// pendências já dizem. Regra fixa de cada item: cliente · o que fazer · 1 botão (SÓ rota de escrita que já existe; senão link «Abrir») · prazo · o número que fecha.
// Teto 10 exceções/semana/família (decisão D-C1): acima, o bloco diz «limiar errado: N itens; ajuste em Estrutura › Regras do método» — nunca «trabalhe mais».
// Isolamento: `escopo` (Set de clientes) corta todo item com cliente; item sem cliente (coleta, incidente, estrutura) só existe nos papéis globais. Ausente = «—» com motivo.
export const PAPEIS = Object.freeze(['dono', 'lider', 'consultor', 'analista', 'cs', 'tecnico'])
export const ROTULO_PAPEL = Object.freeze({ dono: 'Dono', lider: 'Líder', consultor: 'Consultor', analista: 'Analista', cs: 'CS', tecnico: 'Técnico' })
export const TETO_EXCECOES = 10                                   // por semana, por família (D-C1); ajuste em Estrutura › Regras do método
export const AJUSTE = '/metodologia?sec=secParam'
export const LIMIAR_ERRADO = n => `limiar errado: ${n} itens; ajuste em Estrutura › Regras do método`
// etapa do stepper (§ D) que cada item fecha: ?etapa=<n> filtra por ela
export const ETAPA = Object.freeze({ cadastro: 1, conexao: 2, coleta: 3, empresa: 4, plano: 5, decidir: 6, distribuir: 7, executar: 8, medir: 9, comunicar: 10 })
const L = Object.freeze({ coleta_h: 26, notion_h: 3, custo_dias: 14, custo_pct: 80, decisao_dias_uteis: 2, distribuir_dias: 2, card_parado_dias: 7, pendencia_dias: 14, pendencia_30: 30, veto_h: 48, contrato_dias: 30 })

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const enc = encodeURIComponent
const dataOk = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''))
const ms = (s, hora = 'T12:00:00Z') => Date.parse(String(s).length === 10 ? s + hora : s)
const dias = (iso, hoje) => dataOk(iso) && dataOk(hoje) ? Math.max(0, Math.round((ms(hoje) - ms(iso.slice(0, 10))) / 864e5)) : null
const horas = (iso, agora) => iso && agora && Number.isFinite(Date.parse(iso)) ? Math.max(0, Math.round((Date.parse(agora) - Date.parse(iso)) / 36e5)) : null
const br = iso => dataOk(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : ''
export const diasUteis = (deIso, hoje) => { if (!dataOk(deIso) || !dataOk(hoje)) return null; let n = 0; for (let t = ms(deIso.slice(0, 10)); t < ms(hoje); t += 864e5) { const d = new Date(t + 864e5).getUTCDay(); if (d !== 0 && d !== 6) n++ } return n }
const haDias = d => d == null ? '' : d === 0 ? 'hoje' : `há ${d} d`
const cli = (c, aba = 'resumo', sec = '') => `/cliente?cliente=${enc(c)}&aba=${aba}${sec ? '&sec=' + sec : ''}`
const lista = v => Array.isArray(v) ? v : null
const plural = (n, s, p) => n === 1 ? s : p

// item: cliente · o_que · botao (rota de escrita existente) OU link · prazo · numero · familia · etapa
const item = ({ id, cliente = '', o_que, prazo = '', numero = '', familia, etapa = null, botao = null, link = null, gravidade = '' }) =>
  ({ id: String(id || `${familia}:${cliente}`), cliente, o_que, prazo, numero, familia, etapa, botao: botao ? { ...botao } : null, link: link ? { ...link } : null, gravidade })

// ── blocos por papel: cada def = { id, titulo, sistemas, sub, excecao (teto por família vale), montar(ctx) → { itens, motivo? } } ──────────────────────────────
// fontes que o bloco lê ausentes (null/undefined) → motivo «não lido» e 0 itens, nunca zero fingido
const semLeitura = fonte => ({ itens: [], motivo: `— sem leitura de ${fonte} nesta fila` })

function contasAReconectar({ F, hoje }) {
  const C = lista(F.contas); if (!C) return semLeitura('meli_contas')
  return { itens: C.filter(c => c.erro).map(c => item({ id: 'conexao:' + c.cliente, cliente: c.cliente, familia: 'conexao', etapa: ETAPA.conexao, o_que: `Reconectar o Mercado Livre (${c.erro})`, prazo: 'hoje', numero: 'conexão sem erro na próxima coleta',
    botao: c.restauravel ? { rotulo: 'Restaurar', rota: '/api/meli/restaurar', corpo: { cliente: c.cliente } } : { rotulo: 'Copiar link', rota: '/api/integracoes/meli/link', corpo: { cliente: c.cliente }, copiar: 'url' } })) }
}
function coletaGlobal({ F, agora }) {
  const G = F.coleta; if (!G || typeof G !== 'object') return semLeitura('sync_estado')
  const it = [], hc = horas(G.coleta_em, agora), hn = horas(G.sync_em, agora)
  if (hc == null || hc > L.coleta_h) it.push(item({ id: 'coleta_ml', familia: 'coleta', etapa: ETAPA.coleta, o_que: hc == null ? 'Coleta do Mercado Livre sem registro' : `Coleta do Mercado Livre há ${hc} h (limiar ${L.coleta_h} h)`, prazo: 'hoje', numero: 'coleta ≤ 24 h', link: { rotulo: 'Abrir', href: '/integracoes?sec=secSaudeSistema' } }))
  if (hn == null || hn > L.notion_h) it.push(item({ id: 'sync_notion', familia: 'coleta', etapa: ETAPA.coleta, o_que: hn == null ? 'Notion nunca lido' : `Notion lido há ${hn} h (limiar ${L.notion_h} h)`, prazo: 'hoje', numero: 'sync ≤ 3 h', link: { rotulo: 'Abrir', href: '/' } }))
  return { itens: it }
}
function semCusto({ F, hoje, dentro }) {
  const E = lista(F.empresa); if (!E) return semLeitura('custos')
  return { itens: E.filter(e => dentro(e.cliente) && (e.custo_pct == null || e.custo_pct < L.custo_pct) && (dias(e.conectado_em, hoje) ?? 0) > L.custo_dias).map(e => item({ id: 'custo:' + e.cliente, cliente: e.cliente, familia: 'custos', etapa: ETAPA.empresa,
    o_que: e.custo_pct == null ? 'Custo não informado (conta conectada há mais de 14 d)' : `Custo informado para ${e.custo_pct}% da receita (meta ${L.custo_pct}%)${e.lead_time ? '' : ' · prazo do fornecedor não informado'}`, prazo: 'esta semana', numero: `custo ≥ ${L.custo_pct}% da receita de 28 d`, link: { rotulo: 'Abrir', href: cli(e.cliente, 'configurar', 'secCustosUpload') } })) }
}
function propostasP01({ F, hoje, dentro }) {
  const A = lista(F.acoes); if (!A) return semLeitura('acoes_plano')
  const por = new Map()
  for (const a of A) if (a.status === 'proposta' && ['P0', 'P1'].includes(a.p) && dentro(a.cliente)) { const g = por.get(a.cliente) || { ids: [], max: 0, regras: [] }; g.ids.push(a.id); g.max = Math.max(g.max, diasUteis(a.criado_em, hoje) ?? 0); g.regras.push(a.regra); por.set(a.cliente, g) }
  return { itens: [...por].sort((x, y) => y[1].max - x[1].max).map(([c, g]) => item({ id: 'p01:' + c, cliente: c, familia: 'decidir', etapa: ETAPA.decidir, o_que: `${g.ids.length} ${plural(g.ids.length, 'proposta P0/P1 sem decisão', 'propostas P0/P1 sem decisão')} (${[...new Set(g.regras)].slice(0, 3).join(', ')})`,
    prazo: g.max > L.decisao_dias_uteis ? `vencido: ${g.max} dias úteis (limiar ${L.decisao_dias_uteis})` : `até ${L.decisao_dias_uteis} dias úteis`, numero: '0 P0/P1 sem decisão', gravidade: g.max > L.decisao_dias_uteis ? 'atrasado' : '',
    botao: { rotulo: `Aprovar ${g.ids.length}`, rota: '/api/planos/acoes/status', corpo: { ids: g.ids, status: 'aprovada' }, por: true, confirmar: `Aprova ${g.ids.length} ${plural(g.ids.length, 'proposta', 'propostas')} de ${c}. Descartar com motivo continua na aba Plano.` } })) }
}
function aprovadasNaoDistribuidas({ F, hoje, dentro }) {
  const A = lista(F.acoes); if (!A) return semLeitura('acoes_plano')
  const por = new Map()
  for (const a of A) if (a.status === 'aprovada' && dentro(a.cliente)) { const g = por.get(a.cliente) || { ids: [], max: 0 }; g.ids.push(a.id); g.max = Math.max(g.max, dias(a.atualizado_em, hoje) ?? 0); por.set(a.cliente, g) }
  return { itens: [...por].filter(([, g]) => g.max > L.distribuir_dias).sort((x, y) => y[1].max - x[1].max).map(([c, g]) => item({ id: 'dist:' + c, cliente: c, familia: 'distribuir', etapa: ETAPA.distribuir, o_que: `${g.ids.length} ${plural(g.ids.length, 'aprovada parada', 'aprovadas paradas')} há ${g.max} d sem ir ao Notion`,
    prazo: `limiar ${L.distribuir_dias} d`, numero: '0 aprovadas paradas', gravidade: 'atrasado', botao: { rotulo: 'Distribuir', rota: '/api/planos/distribuir', corpo: { escopo: { tipo: 'selecao', clientes: [c] }, ids: g.ids, confirmar: true }, confirmar: `Cria ${g.ids.length} ${plural(g.ids.length, 'tarefa', 'tarefas')} no quadro de ${c} no Notion (com o roteiro do Manual). Sem volta automática.` } })) }
}
function ordensAguardando({ F, hoje, dentro }) {
  const O = lista(F.ordens); if (!O) return semLeitura('exec_ordem')
  return { itens: O.filter(o => o.estado === 'aguardando_aprovacao' && dentro(o.cliente)).map(o => item({ id: 'ordem:' + o.id, cliente: o.cliente, familia: 'ordens', etapa: ETAPA.executar, o_que: `Ordem ${o.id} (${o.operacao}${o.regra ? ' · ' + o.regra : ''}) aguarda aprovação`, prazo: haDias(dias(o.criado_em, hoje)) || 'hoje', numero: 'ordem aprovada e conferida',
    botao: { rotulo: 'Aprovar', rota: '/api/chaveiro/exec/aprovar', corpo: { cliente: o.cliente, ordens: [o.id] }, por: true } })) }
}
function degrausComVeto({ F, agora, dentro }) {
  const V = lista(F.vetos); if (!V) return semLeitura('exec_liberacao')
  return { itens: V.filter(v => dentro(v.cliente) && (!v.veto_ate || Date.parse(v.veto_ate) > Date.parse(agora))).map(v => item({ id: 'veto:' + v.cliente + ':' + v.operacao, cliente: v.cliente, familia: 'neo', etapa: ETAPA.executar, o_que: `Neo propõe ampliar «${v.operacao}» (veto de ${L.veto_h} h)`, prazo: v.veto_ate ? `veto até ${br(v.veto_ate)}` : 'veto aberto', numero: 'ampliação vetada ou aceita',
    botao: { rotulo: 'Vetar', rota: '/api/chaveiro/exec/vetar', corpo: { cliente: v.cliente, operacao: v.operacao, confirmar: true }, por: true, confirmar: `Veta a ampliação de «${v.operacao}» para ${v.cliente}: a operação segue na estreia.` } })) }
}
function regrasDoConsultor({ F, dentro, regrasConsultor }) {
  const A = lista(F.acoes); if (!A) return semLeitura('acoes_plano')
  return { itens: A.filter(a => a.status === 'proposta' && regrasConsultor.includes(a.regra) && dentro(a.cliente)).map(a => item({ id: 'rc:' + a.id, cliente: a.cliente, familia: 'briefing', etapa: ETAPA.plano, o_que: `${a.titulo || a.regra} — pede o briefing do consultor`, prazo: 'esta semana', numero: 'briefing registrado na ação', link: { rotulo: 'Abrir', href: cli(a.cliente, 'plano') } })) }
}
function ordensDivergentes({ F, dentro }) {
  const O = lista(F.ordens); if (!O) return semLeitura('exec_ordem')
  return { itens: O.filter(o => ['divergente', 'falhou'].includes(o.estado) && dentro(o.cliente)).map(o => item({ id: 'div:' + o.id, cliente: o.cliente, familia: 'ordens', etapa: ETAPA.executar, o_que: `Ordem ${o.id} (${o.operacao}) ${o.estado === 'divergente' ? 'divergente na releitura' : 'falhou'}`, prazo: 'hoje', numero: 'releitura igual ao pedido', gravidade: 'atrasado', link: { rotulo: 'Abrir', href: cli(o.cliente, 'executar') } })) }
}
const barrado = x => /audit|conteudo|bloquead|inseguro/i.test(String(x.motivo || '')) || x.estado === 'bloqueado'
function textosBarrados({ F, dentro }) {
  const Lt = lista(F.lotes), R = lista(F.relatorios); if (!Lt && !R) return semLeitura('gatilho_lote e relatorio_envio')
  const it = []
  for (const l of Lt || []) if (barrado(l) && dentro(l.cliente)) it.push(item({ id: 'lote-barrado:' + l.cliente + ':' + l.dia, cliente: l.cliente, familia: 'auditor', etapa: ETAPA.comunicar, o_que: `Plano de ${l.tipo} de ${br(l.dia)} barrado pelo auditor (${l.motivo})`, prazo: 'antes do próximo envio', numero: 'texto aprovado pelo auditor', link: { rotulo: 'Abrir', href: cli(l.cliente, 'resumo', 'secGatilhos') } }))
  for (const r of R || []) if (barrado(r) && dentro(r.cliente)) it.push(item({ id: 'rel-barrado:' + r.cliente + ':' + r.em, cliente: r.cliente, familia: 'auditor', etapa: ETAPA.comunicar, o_que: `Relatório ao Notion barrado (${r.motivo})`, prazo: 'antes do próximo envio', numero: 'texto aprovado pelo auditor', link: { rotulo: 'Abrir', href: '/planos?sec=secRelatorios' } }))
  return { itens: it, ...(F.brier === undefined ? { nota: 'Brier por família: não lido nesta fila (ver Assessoria › Acerto do algoritmo)' } : {}) }
}
function pendenciasVencidas({ F, dentro, minimo = L.pendencia_dias }) {
  const D = lista(F.dependencias); if (!D) return semLeitura('pendências do cliente')
  return { itens: D.filter(d => dentro(d.cliente) && (d.dias ?? 0) >= minimo).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)).map(d => item({ id: 'pend:' + d.cliente + ':' + (d.chave || d.titulo), cliente: d.cliente, familia: 'pendencias', etapa: ETAPA.executar, o_que: `${d.titulo || 'Pendência do cliente'} — aguarda o cliente há ${d.dias} d`, prazo: `régua ${L.pendencia_dias}/${L.pendencia_30} d`, numero: 'pendência resolvida', gravidade: (d.dias ?? 0) >= L.pendencia_30 ? 'atrasado' : '',
    ...(d.chave ? { botao: { rotulo: 'Preparar lembrete', rota: '/api/cliente/do-cliente/lembrete', corpo: { cliente: d.cliente, chave: d.chave }, copiar: 'texto' } } : { link: { rotulo: 'Abrir', href: cli(d.cliente, 'do-cliente') } }) })) }
}
function respostasNegativas({ F, dentro }) {
  const R = lista(F.respostas); if (!R) return semLeitura('feedback_relatorio')
  return { itens: R.filter(r => dentro(r.cliente) && (r.temas || []).includes('critica')).map(r => item({ id: 'resp:' + r.cliente + ':' + r.recebido_em, cliente: r.cliente, familia: 'respostas', etapa: ETAPA.comunicar, o_que: `Resposta com crítica ao relatório${r.autor_nome ? ' (' + r.autor_nome + ')' : ''}`, prazo: haDias(r.dias) || 'hoje', numero: 'resposta revisada', link: { rotulo: 'Abrir', href: '/planos?sec=secFeedback' } })) }
}
function respostasNovas({ F, dentro }) {
  const R = lista(F.respostas); if (!R) return semLeitura('feedback_relatorio')
  return { itens: R.filter(r => dentro(r.cliente) && r.status === 'novo').map(r => item({ id: 'resp:' + r.cliente + ':' + r.recebido_em, cliente: r.cliente, familia: 'respostas', etapa: ETAPA.comunicar, o_que: `Resposta do cliente ao relatório${(r.temas || []).length ? ' (' + r.temas.join(', ') + ')' : ''}`, prazo: haDias(r.dias) || 'hoje', numero: 'resposta revisada', link: { rotulo: 'Abrir', href: '/planos?sec=secFeedback' } })) }
}
function riscoAberto({ F, hoje, dentro }) {
  const R = lista(F.riscos); if (!R) return semLeitura('risco_cliente')
  return { itens: R.filter(r => dentro(r.cliente)).map(r => item({ id: 'risco:' + r.cliente + ':' + r.motivo, cliente: r.cliente, familia: 'risco', etapa: ETAPA.comunicar, o_que: `Cliente em risco (${r.motivo}) desde ${br(r.desde)}`, prazo: haDias(dias(r.desde, hoje)), numero: 'risco encerrado com nota', gravidade: 'atrasado', link: { rotulo: 'Abrir', href: cli(r.cliente, 'configurar', 'secRisco') } })) }
}
function elegiveisNaoLiberados({ F }) {
  const N = lista(F.nao_liberados); if (!N) return semLeitura('liberação dos avisos')
  return { itens: N.length ? [item({ id: 'nao_liberados', familia: 'liberacao', etapa: ETAPA.comunicar, o_que: `${N.length} ${plural(N.length, 'cliente elegível', 'clientes elegíveis')} ao plano de terça sem liberação (${N.slice(0, 3).map(n => n.cliente).join(', ')}${N.length > 3 ? '…' : ''})`, prazo: 'antes de terça 09:00', numero: '0 elegíveis sem liberação',
    botao: { rotulo: 'Preparar lote (prévia)', rota: '/api/gatilhos/preparar-lote', corpo: { confirmar: false }, por: true, mostrar: 'previa' } })] : [] }
}
function recibosFalhados({ F, dentro }) {
  const Lt = lista(F.lotes); if (!Lt) return semLeitura('gatilho_lote')
  return { itens: Lt.filter(l => ['falhou', 'parcial'].includes(l.estado) && !barrado(l) && dentro(l.cliente)).map(l => item({ id: 'lote:' + l.cliente + ':' + l.dia + ':' + l.tipo, cliente: l.cliente, familia: 'recibos', etapa: ETAPA.comunicar, o_que: `Aviso ${l.tipo} de ${br(l.dia)} ${l.estado}${l.motivo ? ' (' + l.motivo + ')' : ''}`, prazo: 'hoje', numero: 'recibo entregue', gravidade: 'atrasado', link: { rotulo: 'Abrir', href: cli(l.cliente, 'resumo', 'secGatilhos') } })) }
}
function relatoriosFalhados({ F, dentro }) {
  const R = lista(F.relatorios); if (!R) return semLeitura('relatorio_envio')
  return { itens: R.filter(r => r.estado === 'falhou' && !barrado(r) && dentro(r.cliente)).map(r => item({ id: 'rel:' + r.cliente + ':' + r.em, cliente: r.cliente, familia: 'relatorios', etapa: ETAPA.comunicar, o_que: `Relatório ao Notion falhou${r.motivo ? ' (' + r.motivo + ')' : ''}`, prazo: 'até sexta 17:00', numero: 'relatório enviado', gravidade: 'atrasado', link: { rotulo: 'Abrir', href: '/planos?sec=secRelatorios' } })) }
}
function incidentes({ F, so = null }) {
  const I = lista(F.incidentes); if (!I) return semLeitura('incidente')
  return { itens: I.filter(i => !so || so.includes(i.nivel)).map(i => item({ id: 'inc:' + i.id, familia: 'incidentes', etapa: ETAPA.coleta, o_que: `${i.rotulo || i.sinal_id} (${i.nivel})${i.valor ? ' · ' + i.valor : ''}`, prazo: i.sla_ate ? `SLA até ${br(i.sla_ate)} · dono ${i.dono || 'Head de canais'}` : `dono ${i.dono || 'Head de canais'}`, numero: 'incidente resolvido', gravidade: i.nivel === 'critico' ? 'atrasado' : '', link: { rotulo: 'Abrir', href: '/integracoes?sec=secSaudeSistema' } })) }
}
function estruturasPendentes({ F, filtro, familia, o_que }) {
  const E = lista(F.estruturas); if (!E) return semLeitura('estado das estruturas')
  return { itens: E.filter(filtro).map(e => item({ id: 'est:' + e.id, familia, etapa: ETAPA.coleta, o_que: o_que(e), prazo: 'janela combinada', numero: e.reinicio_pendente ? 'servidor reiniciado com o arquivo novo' : 'variável presente', link: { rotulo: 'Abrir', href: '/estrutura' } })) }
}
function medidasRecentes({ F, dentro }) {
  const M = lista(F.medidas); if (!M) return semLeitura('aprendizado')
  const rot = r => r === 1 ? 'melhorou' : r === 0 ? 'sem efeito medido' : 'sem base para medir'
  return { itens: M.filter(m => dentro(m.cliente)).map(m => item({ id: 'med:' + m.acao_id, cliente: m.cliente, familia: 'medicao', etapa: ETAPA.medir, o_que: `${m.regra}: ${rot(m.resolveu)} (medido ${br(m.medido_em)})`, prazo: '', numero: 'vínculo confirmado', link: { rotulo: 'Abrir', href: cli(m.cliente, 'resumo', 'secAcomp') } })) }
}
function precoSemDecisor({ F, dentro }) {
  const P = lista(F.precos); if (!P) return semLeitura('meli_item_mudanca')
  return { itens: P.filter(p => dentro(p.cliente)).map(p => item({ id: 'preco:' + p.cliente + ':' + p.item_id + ':' + p.dia, cliente: p.cliente, familia: 'preco', etapa: ETAPA.executar, o_que: `Preço de ${p.titulo || p.item_id} mudou ${p.variacao_pct != null ? (p.variacao_pct > 0 ? '+' : '') + p.variacao_pct + '%' : ''} em ${br(p.dia)} sem decisor registrado`, prazo: 'esta semana', numero: 'decisor registrado',
    botao: { rotulo: 'Decisão do cliente', rota: '/api/cliente/preco/decisao', corpo: { cliente: p.cliente, ref: `ml:${p.item_id}:${p.dia}`, decisor: 'cliente', confirmar: true }, por: true, confirmar: `Registra que a mudança de preço de ${p.titulo || p.item_id} em ${br(p.dia)} foi decisão do cliente.` } })) }
}
function cardsDoAnalista({ F, hoje }) {
  const C = lista(F.cards); if (!C) return semLeitura('tarefas')
  const ORD = { fazer: 0, agendar: 1, delegar: 2, eliminar: 3 }
  return { itens: [...C].sort((a, b) => (ORD[a.quadrante] ?? 9) - (ORD[b.quadrante] ?? 9) || String(a.prazo || '9').localeCompare(String(b.prazo || '9'))).map(c => item({ id: 'card:' + c.id, cliente: c.cliente, familia: 'cards', etapa: ETAPA.executar, o_que: `${c.titulo}${c.quadrante ? ' · ' + c.quadrante : ''}`, prazo: c.prazo ? (c.prazo < hoje ? `vencido em ${br(c.prazo)}` : br(c.prazo)) : 'sem prazo', numero: 'card concluído com evidência', gravidade: c.prazo && c.prazo < hoje ? 'atrasado' : '', link: { rotulo: 'Abrir', href: c.url || cli(c.cliente, 'plano') } })) }
}
function cardsParados({ F, hoje, dentro }) {
  const C = lista(F.cards); if (!C) return semLeitura('tarefas')
  return { itens: C.filter(c => c.ps && dentro(c.cliente) && (dias(c.last_edited, hoje) ?? 0) > L.card_parado_dias).sort((a, b) => (dias(b.last_edited, hoje) ?? 0) - (dias(a.last_edited, hoje) ?? 0)).map(c => item({ id: 'parado:' + c.id, cliente: c.cliente, familia: 'cards', etapa: ETAPA.executar, o_que: `${c.titulo} parado há ${dias(c.last_edited, hoje)} d${c.responsavel ? ' · ' + c.responsavel : ' · sem responsável'}`, prazo: `limiar ${L.card_parado_dias} d`, numero: 'card movido ou concluído', gravidade: 'atrasado', link: { rotulo: 'Abrir', href: c.url || cli(c.cliente, 'plano') } })) }
}
function aguardandoCliente({ F, dentro }) {
  const C = lista(F.cards); if (!C) return semLeitura('tarefas')
  const D = lista(F.dependencias) || []
  return { itens: C.filter(c => c.status === 'dependencia_cliente' && dentro(c.cliente)).map(c => { const d = D.find(x => x.cliente === c.cliente && x.titulo && norm(c.titulo).includes(norm(x.titulo).slice(0, 20))) || D.find(x => x.cliente === c.cliente); return item({ id: 'dep:' + c.id, cliente: c.cliente, familia: 'pendencias', etapa: ETAPA.executar, o_que: `${c.titulo} — ${d?.o_que_precisamos || 'aguarda o cliente (o que pedir: ver Pelo cliente)'}`, prazo: d?.dias != null ? `há ${d.dias} d` : 'sem data', numero: 'retorno do cliente registrado', link: { rotulo: 'Abrir', href: cli(c.cliente, 'do-cliente') } }) }) }
}
function discordDaSemana({ F, dentro }) {
  const A = lista(F.avisos_discord); if (!A) return semLeitura('consultor_aviso')
  return { itens: A.filter(a => dentro(a.cliente)).map(a => item({ id: 'disc:' + a.cliente + ':' + a.dia, cliente: a.cliente, familia: 'discord', etapa: ETAPA.comunicar, o_que: `Resumo de terça no Discord: ${a.estado}`, prazo: br(a.dia), numero: 'lido', link: { rotulo: 'Abrir', href: cli(a.cliente, 'resumo', 'secGatilhos') } })) }
}
function semGrupoOuContrato({ F, hoje, dentro }) {
  const C = lista(F.clientes); if (!C) return semLeitura('clientes_central')
  const it = []
  for (const c of C) {
    if (!dentro(c.cliente)) continue
    if (c.whatsapp === false) it.push(item({ id: 'grupo:' + c.cliente, cliente: c.cliente, familia: 'canais', etapa: ETAPA.comunicar, o_que: 'Sem grupo de WhatsApp do Mercado Livre na central', prazo: 'antes de terça', numero: 'grupo preenchido', link: { rotulo: 'Abrir', href: cli(c.cliente, 'configurar', 'secAvisos') } }))
    for (const [canal, data] of Object.entries(c.vencimentos || {})) { const d = dataOk(data) ? Math.round((ms(data) - ms(hoje)) / 864e5) : null; if (d != null && d <= L.contrato_dias) it.push(item({ id: 'venc:' + c.cliente + ':' + canal, cliente: c.cliente, familia: 'contrato', etapa: ETAPA.cadastro, o_que: `${canal}: contrato vence em ${br(data)}${d < 0 ? ' (vencido)' : ''}`, prazo: d < 0 ? 'vencido' : `em ${d} d`, numero: 'renovação registrada', gravidade: d < 0 ? 'atrasado' : '', link: { rotulo: 'Abrir', href: cli(c.cliente, 'configurar', 'secContrato') } })) }
  }
  return { itens: it }
}
function carteiraPorEtapa({ F, por }) {
  const C = lista(F.carteira); if (!C) return semLeitura('progresso da carteira')
  return { itens: C.filter(e => e.atrasado > 0).map(e => item({ id: 'etapa:' + e.n, familia: 'carteira', etapa: e.n, o_que: `${e.n} · ${e.nome}: ${e.atrasado} ${plural(e.atrasado, 'cliente atrasado', 'clientes atrasados')} · ${e.parados} ${plural(e.parados, 'parado', 'parados')} nesta etapa`, prazo: '', numero: '0 atrasados', link: { rotulo: 'Ver a fila', href: `/fila?por=lider&etapa=${e.n}` } })) }
}
function numerosDoDono({ F }) {
  const N = F.numeros || {}
  const linha = (id, o_que, v, href) => item({ id, familia: 'numeros', o_que, numero: v == null ? '— não lido nesta fila' : String(v), link: { rotulo: 'Abrir', href } })
  return { itens: [linha('gmv', 'Faturamento 28 d × 28 anteriores', N.gmv_txt ?? null, '/gmv'), linha('brier', 'Brier por família (acerto do algoritmo)', N.brier_txt ?? null, '/metodologia?sec=secCalib')], excecao: false }
}
const juntar = (...partes) => ctx => { const r = partes.map(p => p(ctx)), itens = r.flatMap(x => x.itens), motivos = r.map(x => x.motivo).filter(Boolean), notas = r.map(x => x.nota).filter(Boolean); return { itens, ...(motivos.length ? { motivo: motivos.join(' · ') } : {}), ...(notas.length ? { nota: notas.join(' · ') } : {}) } }

export const BLOCOS = Object.freeze({
  dono: [
    { id: 'numeros', titulo: 'Números', sistemas: 'Oráculo · Merovíngio', sub: 'Os 4 do topo mais faturamento e acerto do algoritmo. Só leitura.', excecao: false, montar: numerosDoDono },
    { id: 'decisoes', titulo: 'Decisões só do dono', sistemas: 'Chaveiro · Neo', sub: 'Degraus do Neo com veto de 48 h e chaves de arquivo que esperam reinício.', montar: juntar(degrausComVeto, ctx => estruturasPendentes({ ...ctx, filtro: e => e.reinicio_pendente, familia: 'reinicio', o_que: e => `${e.nome}: arquivo mudou, servidor ainda com o valor antigo` })) },
    { id: 'carteira', titulo: 'Carteira por etapa', sistemas: 'Arquiteto', sub: 'Etapas da cadeia com clientes atrasados; cada linha abre a fila do líder filtrada pela etapa.', excecao: false, montar: carteiraPorEtapa },
    { id: 'risco', titulo: 'Clientes em risco', sistemas: 'Morpheus · CS', sub: 'Risco aberto e respostas com crítica ao relatório.', montar: juntar(riscoAberto, respostasNegativas) },
    { id: 'incidentes', titulo: 'Incidentes críticos', sistemas: 'Trinity', sub: 'Abertos, com dono e SLA.', montar: ctx => incidentes({ ...ctx, so: ['critico'] }) },
  ],
  lider: [
    { id: 'andar', titulo: 'Para o sistema andar', sistemas: 'Trinity · Smith', sub: 'Contas a reconectar (link pronto), coleta e Notion atrasados, clientes sem custo ou sem prazo do fornecedor.', montar: juntar(contasAReconectar, coletaGlobal, semCusto) },
    { id: 'decidir', titulo: 'Para decidir', sistemas: 'Arquiteto · Chaveiro · Neo', sub: 'P0/P1 propostas por cliente, aprovadas paradas, ordens aguardando aprovação, degraus com veto e as regras que pedem o consultor.', montar: juntar(propostasP01, aprovadasNaoDistribuidas, ordensAguardando, degrausComVeto, regrasDoConsultor) },
    { id: 'desconfiar', titulo: 'Para desconfiar', sistemas: 'Merovíngio · Chaveiro', sub: 'Ordens divergentes ou falhadas e textos barrados pelo auditor.', montar: juntar(ordensDivergentes, textosBarrados) },
    { id: 'gente', titulo: 'Para falar com gente', sistemas: 'Morpheus · CS', sub: 'Pendência do cliente há mais de 30 d, resposta com crítica, risco aberto e elegíveis sem liberação.', montar: juntar(ctx => pendenciasVencidas({ ...ctx, minimo: L.pendencia_30 }), respostasNegativas, riscoAberto, elegiveisNaoLiberados) },
    { id: 'semana', titulo: 'Terça e sexta', sistemas: 'Morpheus', sub: 'Recibos do plano de terça que falharam e relatórios ao Notion que falharam.', montar: juntar(recibosFalhados, relatoriosFalhados) },
  ],
  consultor: [
    { id: 'aprovar', titulo: 'Aprovar', sistemas: 'Arquiteto', sub: 'P0/P1 propostas dos seus clientes.', montar: propostasP01 },
    { id: 'briefing', titulo: 'As regras que exigem o consultor', sistemas: 'Arquiteto', sub: 'Propostas cuja regra pede o seu briefing (foco.regras_exigem_consultor).', montar: regrasDoConsultor },
    { id: 'pelo_cliente', titulo: 'Pelo cliente', sistemas: 'Morpheus', sub: 'Pendências vencidas na régua 14/30 com o texto fixo do catálogo.', montar: pendenciasVencidas },
    { id: 'semana', titulo: 'Terça', sistemas: 'Morpheus', sub: 'Recibo falhado ou texto barrado dos seus clientes e respostas que eles mandaram.', montar: juntar(recibosFalhados, textosBarrados, respostasNovas) },
    { id: 'resultados', titulo: 'Resultados e preço', sistemas: 'Merovíngio · Smith', sub: 'O que fechou ontem (melhorou, sem efeito, sem base), preço alterado sem decisor e cliente sem custo.', montar: juntar(medidasRecentes, precoSemDecisor, semCusto) },
  ],
  analista: [
    { id: 'cards', titulo: 'Seus cards hoje', sistemas: 'Arquiteto', sub: 'Tarefas com você como responsável, na ordem Eisenhower (fazer → agendar → delegar → eliminar).', excecao: false, montar: cardsDoAnalista },
    { id: 'parados', titulo: 'Parados há mais de 7 d', sistemas: 'Merovíngio', sub: 'Cards PS- seus sem movimento.', montar: cardsParados },
    { id: 'aguardando', titulo: 'Aguardando o cliente', sistemas: 'Morpheus', sub: 'Seus cards em dependência do cliente, com o que pedir.', montar: aguardandoCliente },
    { id: 'rendeu', titulo: 'O que você fez rendeu', sistemas: 'Merovíngio', sub: 'Veredito por tarefa, sem culpa: melhorou, sem efeito, sem base.', excecao: false, montar: medidasRecentes },
    { id: 'discord', titulo: 'Terça 08:30 no Discord', sistemas: 'Morpheus', sub: 'O resumo interno do seu cliente desta semana.', excecao: false, montar: discordDaSemana },
  ],
  cs: [
    { id: 'risco', titulo: 'Clientes em risco', sistemas: 'Morpheus · CS', sub: 'Risco aberto e respostas com crítica.', montar: juntar(riscoAberto, respostasNegativas) },
    { id: 'pendencias', titulo: 'Pendências vencidas', sistemas: 'Morpheus', sub: 'Régua 14/30 com lembrete preparado pelo texto fixo do catálogo.', montar: pendenciasVencidas },
    { id: 'dados', titulo: 'Sem custo, prazo ou grupo', sistemas: 'Smith · Trinity', sub: 'O que só o cliente informa e ainda não informou.', montar: juntar(semCusto, ctx => semGrupoOuContrato({ ...ctx, F: { ...ctx.F, clientes: (ctx.F.clientes || null) && ctx.F.clientes.map(c => ({ ...c, vencimentos: {} })) } })) },
    { id: 'contrato', titulo: 'Contrato e renovação', sistemas: 'Smith', sub: 'Contratos vencendo em 30 d (vencimentos da central).', montar: ctx => semGrupoOuContrato({ ...ctx, F: { ...ctx.F, clientes: (ctx.F.clientes || null) && ctx.F.clientes.map(c => ({ ...c, whatsapp: true })) } }) },
    { id: 'entrega', titulo: 'Plano de terça e relatório', sistemas: 'Morpheus', sub: 'Recibos que falharam.', montar: juntar(recibosFalhados, relatoriosFalhados) },
  ],
  tecnico: [
    { id: 'incidentes', titulo: 'Saúde do sistema', sistemas: 'Trinity', sub: 'Incidentes abertos (atenção e crítico), com dono e SLA.', montar: incidentes },
    { id: 'reinicio', titulo: 'Chaves de arquivo pendentes de reinício', sistemas: 'Arquiteto', sub: 'O arquivo em disco difere do carregado; reiniciar na janela combinada.', montar: ctx => estruturasPendentes({ ...ctx, filtro: e => e.reinicio_pendente, familia: 'reinicio', o_que: e => `${e.nome}: arquivo mudou, servidor ainda com o valor antigo` }) },
    { id: 'env', titulo: 'Variáveis do .env faltando', sistemas: 'Trinity', sub: 'Presença das variáveis, nunca o valor.', montar: ctx => estruturasPendentes({ ...ctx, filtro: e => e.camada === 'env' && e.estado === 'pendente', familia: 'env', o_que: e => `${e.nome}: ${(e.falta || []).join('; ') || 'variável ausente'}` }) },
    { id: 'backup', titulo: 'Backup e frio', sistemas: 'Trinity', sub: 'Último backup e arquivamento no frio não são lidos pelo servidor: conferir data/backup.log e data/arquivar.log.', excecao: false, montar: () => ({ itens: [], motivo: '— não lido nesta fila (logs fora do banco)' }) },
  ],
})

// aplica o teto por família (D-C1) num bloco: família acima do teto vira «limiar errado», nunca uma lista maior
export function aplicarTeto(itens, teto = TETO_EXCECOES) {
  const porFam = new Map()
  for (const i of itens) porFam.set(i.familia, (porFam.get(i.familia) || 0) + 1)
  const estourou = [...porFam].filter(([, n]) => n > teto).map(([familia, n]) => ({ familia, n, aviso: LIMIAR_ERRADO(n), ajuste: AJUSTE }))
  const fora = new Set(estourou.map(e => e.familia))
  return { itens: itens.filter(i => !fora.has(i.familia)), limiar_errado: estourou, familias: [...porFam.keys()] }
}

// montarFila({ por, quem, etapa, hoje, agora, escopo (array de clientes | null = todos), fontes, teto, regrasConsultor })
export function montarFila({ por = '', quem = '', etapa = null, hoje = '', agora = '', escopo = null, fontes = {}, teto = TETO_EXCECOES, regrasConsultor = [] } = {}) {
  const papel = PAPEIS.includes(por) ? por : 'lider'
  const esc = Array.isArray(escopo) ? new Set(escopo.map(norm)) : null
  const dentro = c => !esc || esc.has(norm(c))
  const ctx = { F: fontes || {}, hoje, agora: agora || (hoje ? hoje + 'T12:00:00Z' : ''), dentro, quem, por: papel, regrasConsultor: Array.isArray(regrasConsultor) ? regrasConsultor : [] }
  const n = Number(etapa); const etapaN = Number.isInteger(n) && n >= 1 && n <= 10 ? n : null
  let primeiro = true, excecoes = 0
  const familias = new Set()
  const blocos = BLOCOS[papel].slice(0, 5).map(def => {
    let r; try { r = def.montar(ctx) } catch (e) { r = { itens: [], motivo: `— erro ao montar: ${e?.message || 'desconhecido'}` } }
    let itens = (r.itens || []).filter(i => !i.cliente || dentro(i.cliente))     // isolamento por cliente, de novo, mesmo que o montador esqueça
    if (etapaN) itens = itens.filter(i => i.etapa === etapaN)
    const total = itens.length
    const excecao = def.excecao !== false && r.excecao !== false
    const t = excecao ? aplicarTeto(itens, teto) : { itens, limiar_errado: [], familias: [...new Set(itens.map(i => i.familia))] }
    if (excecao) { excecoes += total; for (const f of t.familias) familias.add(f) }
    const saida = t.itens.map(i => { const p = primeiro; primeiro = false; return { ...i, primario: p } })
    return { id: def.id, titulo: def.titulo, sistemas: def.sistemas, sub: def.sub, excecao, itens: saida, total, limiar_errado: t.limiar_errado, ...(r.motivo ? { motivo: r.motivo } : {}), ...(r.nota ? { nota: r.nota } : {}) }
  })
  const N = ctx.F.numeros || {}
  const pct = (a, b) => b > 0 ? Math.round((a / b) * 1000) / 10 : null
  const numeros = {
    autonomia: N.autonomia ? { valor: pct(N.autonomia.n, N.autonomia.de), n: N.autonomia.n, de: N.autonomia.de, motivo: N.autonomia.de > 0 ? '' : 'nenhuma ação encerrada em 28 d' } : { valor: null, motivo: 'não lido' },
    cobertura: N.cobertura ? { valor: pct(N.cobertura.cards, N.cobertura.tarefas), cards: N.cobertura.cards, tarefas: N.cobertura.tarefas, motivo: N.cobertura.tarefas > 0 ? '' : 'nenhuma tarefa sincronizada' } : { valor: null, motivo: 'não lido' },
    excecoes: { valor: excecoes, teto: teto * Math.max(1, familias.size), familias: familias.size, por_familia: teto },
    contas_por_pessoa: N.contas ? { valor: N.contas.pessoas > 0 ? Math.round((N.contas.clientes / N.contas.pessoas) * 10) / 10 : null, clientes: N.contas.clientes, pessoas: N.contas.pessoas, motivo: N.contas.pessoas > 0 ? '' : 'nenhum consultor com cliente' } : { valor: null, motivo: 'não lido' },
  }
  return { papel, rotulo: ROTULO_PAPEL[papel], quem, hoje, etapa: etapaN, escopo: esc ? esc.size : null, numeros, blocos, total_itens: blocos.reduce((s, b) => s + b.total, 0) }
}
