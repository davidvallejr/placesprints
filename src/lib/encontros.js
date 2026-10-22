// Encontros da consultoria (Place Prime, docs/desenho-place-prime.md § D.1–D.6). Encontro CONTINUA sendo o card do Notion («Reunião de Alinhamento» /
// «Reuniao Gravada», ou o card nascido de «Registrar encontro» pelo · PS-id) + um sidecar encontro_info por tarefa_id — zero backfill, zero 2ª fonte.
// Núcleo SEM import de banco/Notion/IA: handle, agora/hoje, validarPor, idAcao, distribuir, redigir e raiz entram por fábrica (o autoteste usa :memory: e stubs).
// Regras: prévia por padrão; `confirmar === true` grava; Notion só pelo distribuir() injetado e só com confirmar; mensagens fixas, nunca ecoam o valor recebido.
//   • agenda/contagens = projeção (previsto · confirmar · realizado · com ata · gravado · com treinado); previsto vencido > 24 h vira «confirmar», nunca «faltou»;
//   • treinado_json só com ids de config/processos-base.json (lista fechada), marcado pelo consultor; treinadosDaAta só SUGERE;
//   • transcrição .txt guardada FORA do banco (data/encontros/<cliente>/<sha256>.txt) com consentimento registrado → candidatos (trilhas.candidatosDaAta);
//   • «o que o cliente não executa» e «quem treina melhor» com «—» onde o sistema não sabe (executor só é conhecido nas tarefas da trilha/combinados).
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TIPOS_ENCONTRO, ROTULO_ENCONTRO, candidatosDaAta } from './trilhas.js'
import { base as BASE_PROCESSOS, familiaDeDemanda, norm } from './processos.js'
import { faixaDe } from './dependencia-cliente.js'
import { semanaIso } from './gatilhos.js'

export const SCHEMA_ENCONTROS = `
CREATE TABLE IF NOT EXISTS encontro_info (       -- sidecar do card de encontro; sobrevive ao sync (o sync nunca escreve aqui)
  tarefa_id TEXT PRIMARY KEY,                    -- page_id do card (= tarefas.id); nunca trocado
  cliente TEXT NOT NULL,                         -- copiado de tarefas.cliente, nunca do corpo
  tipo TEXT NOT NULL DEFAULT '',                 -- config/trilhas.json → encontros[].id ('' = não marcado)
  consultor TEXT NOT NULL DEFAULT '',            -- nome canônico de quem conduziu (validado)
  gravacao_url TEXT NOT NULL DEFAULT '',         -- http(s) SEM query/fragmento
  transcricao_ref TEXT NOT NULL DEFAULT '',      -- 'sha256:<hex>' do .txt em data/encontros/<cliente>/
  transcricao_bytes INTEGER NOT NULL DEFAULT 0,
  treinado_json TEXT NOT NULL DEFAULT '[]',      -- [{ processo_id, por, em }] — ids de processos-base (lista fechada)
  candidatos_json TEXT NOT NULL DEFAULT '[]',    -- candidatos de tarefa da transcrição [{ frase, alvo, processo, titulo, titulo_origem }]
  consentimento_transcricao INTEGER NOT NULL DEFAULT 0, consentimento_por TEXT NOT NULL DEFAULT '', consentimento_em TEXT NOT NULL DEFAULT '',
  por TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_encontro_cliente ON encontro_info (cliente);
`
export const CALENDARIO = { ligado: false, motivo: 'Google Calendar e Notion Calendar ainda não estão ligados ao servidor (são conectores da sessão do David; decisão 8 do desenho). A agenda abaixo vem só dos cards de encontro do Notion e do «Registrar encontro».' }
export const COBERTURA_EXECUTOR = 'Quem executa só é conhecido nas tarefas nascidas da trilha Prime e dos combinados de reunião. As demais tarefas do quadro ficam fora desta conta («—») até a decisão 3 do desenho (propriedade «Executor» no Notion ou inferência rotulada).'
export const MAX_TRANSCRICAO = 512_000
const PROC = new Map(BASE_PROCESSOS.processos.map(p => [p.id, p.nome]))
export const processosDisponiveis = () => [...PROC].map(([id, nome]) => ({ id, nome }))

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const DIA = /^\d{4}-\d{2}-\d{2}$/
const dia10 = v => (DIA.test(String(v ?? '').slice(0, 10)) ? String(v).slice(0, 10) : '')
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasAte = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
const semQuery = u => String(u || '').split(/[?#]/)[0]
const json = (s, d) => { try { return JSON.parse(s) } catch { return d } }
const idNorm = s => String(s || '').replace(/-/g, '').toLowerCase()
const RX_PS = /PS-[0-9a-f]{7,10}/
export const RX_ENCONTRO = /reuni[aã]o (de alinhamento|gravada)/i
export const ehAta = t => String(t.conteudo || '').length > 200          // mesmo limiar de guardiao-real.ehAta
export { semanaIso }                                                   // a mesma semana ISO do plano semanal (gatilhos.js)

// ── estado de UM encontro (projeção sobre o card) ──
export function estadoDe(t, hoje) {
  if (t.status === 'concluida') return { estado: 'realizado', data: dia10(t.data_conclusao) || dia10(t.data_inicio) || dia10(t.prazo) || dia10(t.last_edited) }
  if (t.status === 'cancelada' || t.status === 'dependencia_cliente') return { estado: 'cancelado', data: dia10(t.prazo) || dia10(t.data_inicio) }
  const data = dia10(t.prazo) || dia10(t.data_inicio)
  if (!data) return { estado: 'sem_data', data: '' }
  return { estado: data < addDias(hoje, -1) ? 'confirmar' : 'previsto', data }    // vencido há mais de 24 h: confirmar com o consultor, nunca «faltou»
}

export function contagens(encontros, hoje) {
  const c = { previstos: 0, confirmar: 0, realizados: 0, com_ata: 0, gravados: 0, com_treinado: 0, sem_tipo: 0, sem_data: 0, proximo: null, ultimo: null }
  for (const e of encontros) {
    if (e.estado === 'previsto') { c.previstos++; if (!c.proximo || e.data < c.proximo.data) c.proximo = { data: e.data, tipo: e.tipo, titulo: e.titulo } }
    if (e.estado === 'confirmar') c.confirmar++
    if (e.estado === 'sem_data') c.sem_data++
    if (e.estado !== 'realizado') continue
    c.realizados++; if (e.com_ata) c.com_ata++; if (e.gravado) c.gravados++; if (e.treinado.length) c.com_treinado++; if (!e.tipo) c.sem_tipo++
    if (!c.ultimo || e.data > c.ultimo.data) c.ultimo = { data: e.data, tipo: e.tipo, titulo: e.titulo, treinado: e.treinado.map(x => x.nome) }
  }
  return c
}

// agenda geral (projeção): linhas por consultor | cliente | semana ISO
export function agenda(encontros, { por = 'consultor', hoje } = {}) {
  const chave = e => por === 'cliente' ? e.cliente : por === 'semana' ? (e.data ? semanaIso(e.data) : 'sem data') : (e.consultor || 'consultor a definir')
  const m = new Map()
  for (const e of encontros) { const k = chave(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e) }
  return [...m].map(([k, es]) => ({ chave: k, ...contagens(es, hoje) })).sort((a, b) => por === 'semana' ? (a.chave < b.chave ? 1 : -1) : b.realizados + b.previstos - (a.realizados + a.previstos) || (a.chave < b.chave ? -1 : 1))
}

// sugestão de «treinado» pelo texto da ata: id do processo citado («6.12») ou nome do processo com 10+ caracteres — o consultor corrige na tela
// ponytail: regex sobre o corpo do card; erra para mais em ata longa, por isso só sugere
export function treinadosDaAta(texto) {
  const t = String(texto || ''), n = norm(t), out = new Set()
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2}\.\d{1,2})(?![\d.])/g)) if (PROC.has(m[1])) out.add(m[1])
  for (const [id, nome] of PROC) if (norm(nome).length >= 10 && n.includes(norm(nome))) out.add(id)
  return [...out].slice(0, 12)
}

// ── «o que o cliente não executa» (pura) ──
// acoes: linhas de acoes_plano da trilha/combinados com dados.executor; tarefas: Map(idNorm → tarefa); encontros: com treinado
export function naoExecuta({ acoes, tarefas, encontros = [], hoje, limiares = { atencao: 14, revisar: 30 } }) {
  const doCliente = acoes.filter(a => a.dados?.executor === 'cliente' && !['descartada', 'obsoleta'].includes(a.status))
  const itens = doCliente.map(a => {
    const base = { acao_id: a.id, titulo: a.titulo, prazo: a.prazo, regra: a.regra, processo_id: a.dados.processo_id || '' }
    if (a.status !== 'distribuida') return { ...base, estado: 'nao_puxado', dias: null, faixa: '' }
    const t = tarefas.get(idNorm(a.notion_page_id))
    if (!t) return { ...base, estado: 'aguardando_sync', dias: null, faixa: '' }
    if (t.status === 'concluida') { const d = dia10(t.data_conclusao); return { ...base, estado: d && a.prazo && d <= a.prazo ? 'feito_no_prazo' : d ? 'feito_atrasado' : 'feito_sem_data', concluido_em: d, dias: null, faixa: '', url: t.url } }
    if (!a.prazo || a.prazo >= hoje) return { ...base, estado: 'no_prazo', dias: null, faixa: '', url: t.url }
    const dias = diasAte(a.prazo, hoje)
    return { ...base, estado: 'vencido', dias, faixa: faixaDe(dias, limiares), url: t.url }
  }).sort((x, y) => (y.dias ?? -1) - (x.dias ?? -1))
  const cnt = k => itens.filter(i => i.estado === k).length
  const feitos = itens.filter(i => i.estado.startsWith('feito'))
  const vencidos = itens.filter(i => i.estado === 'vencido')
  // treinado nos últimos 30 d sem tarefa do cliente concluída naquela família depois do treino
  const famDe = id => familiaDeDemanda(PROC.get(id) || '').id
  const desde = addDias(hoje, -30), treinos = []
  for (const e of encontros) if (e.estado === 'realizado' && e.data >= desde) for (const x of e.treinado) treinos.push({ ...x, em: x.em || e.data })
  const treinadoNaoFeito = treinos.filter(tr => !feitos.some(f => f.processo_id && famDe(f.processo_id) === famDe(tr.processo_id) && (f.concluido_em || '') >= tr.em))
    .map(tr => ({ processo_id: tr.processo_id, nome: PROC.get(tr.processo_id) || tr.processo_id, em: tr.em, por: tr.por }))
  return {
    resumo: { com_executor: itens.length, nao_puxados: cnt('nao_puxado'), aguardando_sync: cnt('aguardando_sync'), no_prazo: cnt('no_prazo'), vencidos: vencidos.length,
      vencidos_14: vencidos.filter(i => i.dias >= limiares.atencao).length, vencidos_30: vencidos.filter(i => i.dias >= limiares.revisar).length,
      feitos: feitos.length, feitos_no_prazo: cnt('feito_no_prazo'), pct_no_prazo: feitos.length ? Math.round(100 * cnt('feito_no_prazo') / feitos.length) : null },
    itens, treinado_nao_feito: treinadoNaoFeito, treinos_30d: treinos.length, cobertura: COBERTURA_EXECUTOR,
  }
}

// ── «quem treina melhor» (pura) — crédito a quem TREINOU (treinado_json[].por mais recente da família no cliente antes da medida), senão o consultor da central rotulado ──
export function quemTreina({ medidas, executorPorTarefa, treinos, consultorCentral = () => '', minN = 8, wilson }) {
  const VALIDOS = ['melhorou', 'piorou', 'sem_efeito']
  const P = new Map(); let total = 0, melhorouTotal = 0, semConsultor = 0
  for (const m of medidas) {
    if (executorPorTarefa.get(idNorm(m.id)) !== 'cliente' || !VALIDOS.includes(m.estado)) continue
    const fam = familiaDeDemanda(m.tipo).id, data = dia10(m.data)
    const tr = treinos.filter(t => t.cliente === m.cliente && t.familia === fam && (!data || t.em <= data)).sort((a, b) => (a.em < b.em ? 1 : -1))[0]
    const nome = tr?.por || consultorCentral(m.cliente) || ''
    if (!nome) { semConsultor++; continue }
    if (!P.has(nome)) P.set(nome, { consultor: nome, n: 0, melhorou: 0, piorou: 0, sem_efeito: 0, pelo_treino: 0, pela_central: 0 })
    const l = P.get(nome); l.n++; l[m.estado]++; tr ? l.pelo_treino++ : l.pela_central++
    total++; if (m.estado === 'melhorou') melhorouTotal++
  }
  const base = total >= minN ? Math.min(0.5, melhorouTotal / total) : null
  const linhas = [...P.values()].map(l => {
    if (l.n < minN) return { ...l, taxa: null, baixo: null, alto: null, prova: false, texto: `sem prova suficiente (${l.n} de ${minN} medidas)` }
    const w = wilson(l.melhorou, l.n), prova = base != null && w.baixo > base
    return { ...l, taxa: w.p, baixo: w.baixo, alto: w.alto, prova, texto: prova ? 'acima da taxa habitual das tarefas do cliente' : 'sem diferença conclusiva' }
  }).sort((a, b) => (b.prova - a.prova) || b.n - a.n)
  return { linhas, n_medidas: total, sem_consultor: semConsultor, base, min_n: minN, cobertura: COBERTURA_EXECUTOR,
    rotulo: 'resultado associado (antes × depois com controle), nunca causa; crédito a quem treinou, senão ao consultor da central (rotulado)' }
}

// ── fábrica com banco ──
// deps: handle · agora() · hoje() · validarPor(nome) → canônico|'' · idAcao(cliente, regra, alvo) · distribuir(acoes, { dryRun }) · redigir(opts) · temChaveIA() · raiz
//       centralDe(cliente) → { produto, consultor, squad, canais } | null
export function criarEncontros({ handle: h, agora = () => new Date().toISOString(), hoje = () => new Date().toISOString().slice(0, 10), validarPor = () => '', idAcao, distribuir = null, redigir = null, temChaveIA = () => false, raiz = '', centralDe = () => null }) {
  const tarefasDo = cliente => h.prepare('SELECT id, cliente, titulo, tipo_demanda, status, data_inicio, prazo, data_conclusao, last_edited, responsavel, conteudo, url FROM tarefas WHERE cliente = ? AND arquivada = 0').all(cliente)
  const acoesEncontro = cliente => h.prepare("SELECT id, titulo, prazo, status, notion_page_id, dados_json FROM acoes_plano WHERE cliente = ? AND regra = 'encontro'").all(cliente).map(a => ({ ...a, dados: json(a.dados_json, {}) }))
  const infoDe = cliente => new Map(h.prepare('SELECT * FROM encontro_info WHERE cliente = ?').all(cliente).map(r => [r.tarefa_id, r]))

  function listar(cliente, { hojeRef = hoje() } = {}) {
    const ts = tarefasDo(cliente), info = infoDe(cliente), acs = acoesEncontro(cliente), porPs = new Map(acs.map(a => [a.id, a]))
    const central = centralDe(cliente) || {}
    const out = [], vistosPage = new Set()
    for (const t of ts) {
      const ps = (t.titulo.match(RX_PS) || [])[0], ac = ps ? porPs.get(ps) : null
      if (!RX_ENCONTRO.test(t.tipo_demanda) && !ac) continue
      vistosPage.add(idNorm(t.id))
      const i = info.get(t.id), ei = ac?.dados?.encontro_info || {}, { estado, data } = estadoDe(t, hojeRef)
      const treinado = json(i?.treinado_json, []).map(x => ({ ...x, nome: PROC.get(x.processo_id) || x.processo_id }))
      out.push({ id: t.id, cliente, titulo: t.titulo.split('\n')[0].slice(0, 160), url: t.url, status: t.status, estado, data, tipo: i?.tipo || ei.tipo || '',
        consultor: i?.consultor || ei.consultor || central.consultor || '', com_ata: ehAta(t), gravado: !!i?.gravacao_url || /gravada/i.test(t.tipo_demanda),
        gravacao_url: i?.gravacao_url || '', treinado, transcricao: i?.transcricao_ref ? { ref: i.transcricao_ref, bytes: i.transcricao_bytes, consentimento_em: i.consentimento_em } : null,
        candidatos: json(i?.candidatos_json, []), sugestao_treinado: i?.treinado_json && i.treinado_json !== '[]' ? [] : treinadosDaAta(t.conteudo), conteudo: t.conteudo, registrado: !!ac })
    }
    // registrado pelo painel e ainda não sincronizado: aparece como previsto/confirmar, com o aviso
    for (const a of acs) {
      if (a.status === 'descartada' || a.status === 'obsoleta' || (a.notion_page_id && vistosPage.has(idNorm(a.notion_page_id)))) continue
      const data = dia10(a.prazo), ei = a.dados.encontro_info || {}
      out.push({ id: a.id, cliente, titulo: a.titulo, url: '', status: a.status, estado: !data ? 'sem_data' : data < addDias(hojeRef, -1) ? 'confirmar' : 'previsto', data, tipo: ei.tipo || '',
        consultor: ei.consultor || central.consultor || '', com_ata: false, gravado: false, gravacao_url: '', treinado: [], transcricao: null, candidatos: [], sugestao_treinado: [], conteudo: '',
        registrado: true, aguardando_sync: true, erro: a.dados?.erro || '' })
    }
    return out.sort((a, b) => (a.data < b.data ? 1 : -1))
  }

  function painel(cliente) {
    const hj = hoje(), es = listar(cliente, { hojeRef: hj }), central = centralDe(cliente) || {}
    const trilha = h.prepare("SELECT id, titulo, prazo, status, notion_url, dados_json FROM acoes_plano WHERE cliente = ? AND regra = 'trilha_prime' AND status NOT IN ('obsoleta')").all(cliente)
      .map(a => { const d = json(a.dados_json, {}); return { id: a.id, titulo: a.titulo, prazo: a.prazo, status: a.status, notion_url: a.notion_url, passo_n: d.passo_n ?? null, executor: d.executor || '', trilha_id: d.trilha_id || '' } })
      .sort((a, b) => (a.passo_n ?? 99) - (b.passo_n ?? 99) || (a.prazo < b.prazo ? -1 : 1))
    return { cliente, produto: central.produto || '', hoje: hj, contagens: contagens(es, hj), encontros: es.map(({ conteudo, ...e }) => e), trilha, calendario: CALENDARIO,
      tipos: TIPOS_ENCONTRO.map(id => ({ id, nome: ROTULO_ENCONTRO[id] })), processos: processosDisponiveis(), ia: temChaveIA() ? 'ligada' : 'sem ANTHROPIC_API_KEY: títulos pelo modelo fixo' }
  }

  const exigePor = por => { const p = validarPor(String(por || '').trim()); if (!String(por || '').trim()) throw erro('informe "por" (líder ou consultor)'); if (!p) throw erro('só líderes e consultores registram encontros — escolha um nome da central', 403); return p }
  const cardDoEncontro = (cliente, tarefaId) => {
    const t = h.prepare('SELECT id, cliente, titulo, tipo_demanda, conteudo FROM tarefas WHERE id = ? AND arquivada = 0').get(String(tarefaId || ''))
    if (!t || t.cliente !== cliente) throw erro('encontro não encontrado para este cliente', 404)
    const ps = (t.titulo.match(RX_PS) || [])[0]
    const doPainel = ps && h.prepare("SELECT 1 FROM acoes_plano WHERE id = ? AND cliente = ? AND regra = 'encontro'").get(ps, cliente)
    if (!RX_ENCONTRO.test(t.tipo_demanda) && !doPainel) throw erro('a tarefa não é um card de encontro (Reunião de Alinhamento / Reunião Gravada)')
    return t
  }

  // «Registrar encontro» = ação 'encontro' (demanda Reunião de Alinhamento, prazo = data) pelo MESMO distribuir(); prévia nunca escreve nem chama o Notion
  async function registrar({ cliente, data, tipo, consultor = '', por, confirmar = false }) {
    const quem = exigePor(por), hj = hoje()
    if (!DIA.test(String(data || '')) || diasAte(hj, data) < -60 || diasAte(hj, data) > 180) throw erro('informe "data" (AAAA-MM-DD, de 60 dias atrás a 180 à frente)')
    if (!TIPOS_ENCONTRO.includes(tipo)) throw erro('tipo de encontro fora da lista')
    const cons = String(consultor || '').trim() ? validarPor(String(consultor).trim()) : ''
    if (String(consultor || '').trim() && !cons) throw erro('consultor fora da central — escolha um nome da lista', 403)
    const central = centralDe(cliente) || {}, conduz = cons || central.consultor || ''
    const id = idAcao(cliente, 'encontro', `${data}|${tipo}`), br = data.split('-').reverse().join('/')
    const dados = { dimensao: 'Qualidade operacional', problema: 'Encontro da consultoria com o cliente', acao: `Encontro «${ROTULO_ENCONTRO[tipo]}» com o cliente em ${br}${conduz ? `, conduzido por ${conduz}` : ''}. Ao terminar: concluir o card, anexar a ata e marcar em Encontros o que foi treinado.`,
      evidencia_tipo: 'fato', evidencia: `Encontro registrado no painel por ${quem}.`, fonte: 'Place Sprints — Registrar encontro', periodo: br, dependencia: 'Agenda do cliente',
      indicador_inicial: 'Encontro realizado: não', meta: 'Encontro realizado com ata e o que foi treinado registrado', criterio_aceite: 'Card concluído com a ata no corpo e o treinado marcado em Encontros',
      impacto: 3, confianca: 5, urgencia: 3, esforco: 1, logica: 'Agenda da consultoria: registro manual (sem prioridade calculada)', demanda_notion: 'Reunião de Alinhamento', refs: [],
      executor: 'consultor', encontro_info: { tipo, consultor: conduz } }
    const acao = { id, cliente, canal: '', regra: 'encontro', mes: data.slice(0, 7), titulo: `Encontro com o cliente: ${ROTULO_ENCONTRO[tipo]} (${br})`, horizonte: diasAte(hj, data) <= 3 ? '72h' : diasAte(hj, data) <= 7 ? '7d' : '30d',
      prazo: data, responsavel: conduz, squad: central.squad || '', score: 50, dados }
    const ja = h.prepare('SELECT status, notion_url FROM acoes_plano WHERE id = ?').get(id)
    if (!confirmar) return { previa: true, acao: { id, titulo: acao.titulo, prazo: data, tipo, consultor: conduz }, ja_existe: ja ? { status: ja.status, notion_url: ja.notion_url } : null,
      efeito: ja?.status === 'distribuida' ? 'Este encontro já está no Notion: nada muda.' : 'Ao confirmar, o card «Reunião de Alinhamento» é criado no quadro do cliente no Notion (distribuição de sempre).' }
    const t = agora()
    if (!ja) h.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'aprovada', ?, ?)`).run(id, cliente, '', 'encontro', acao.mes, acao.titulo, acao.horizonte, data, conduz, acao.squad, 50, JSON.stringify(dados), t, t)
    if (ja?.status === 'distribuida') return { ok: true, id, distribuicao: null, ja_existia: true }
    if (!distribuir) return { ok: true, id, distribuicao: null, pendente: 'distribuição indisponível nesta instância: o encontro fica aprovado e sai na próxima distribuição' }
    const linha = h.prepare('SELECT * FROM acoes_plano WHERE id = ?').get(id)
    const rel = await distribuir([{ ...linha, dados: json(linha.dados_json, {}) }], { dryRun: false })
    return { ok: true, id, distribuicao: { criadas: rel.criadas?.length || 0, ja_existiam: rel.ja_existiam?.length || 0, erros: (rel.erros || []).map(e => e.erro), url: rel.criadas?.[0]?.url || '' } }
  }

  // marcar o encontro realizado: tipo, quem conduziu, gravação (sem query) e o que foi treinado (ids da lista fechada)
  function salvarInfo({ cliente, tarefa_id, tipo, consultor, gravacao_url, treinado, por, confirmar = false }) {
    const quem = exigePor(por), t = cardDoEncontro(cliente, tarefa_id), atual = h.prepare('SELECT * FROM encontro_info WHERE tarefa_id = ?').get(t.id)
    const novo = { tipo: atual?.tipo || '', consultor: atual?.consultor || '', gravacao_url: atual?.gravacao_url || '', treinado: json(atual?.treinado_json, []) }
    if (tipo !== undefined) { if (tipo !== '' && !TIPOS_ENCONTRO.includes(tipo)) throw erro('tipo de encontro fora da lista'); novo.tipo = tipo }
    if (consultor !== undefined) { const c = String(consultor || '').trim(); const v = c ? validarPor(c) : ''; if (c && !v) throw erro('consultor fora da central — escolha um nome da lista', 403); novo.consultor = v }
    if (gravacao_url !== undefined) {
      const u = semQuery(String(gravacao_url || '').trim())
      if (u && (!/^https?:\/\/[^\s]+$/i.test(u) || u.length > 500)) throw erro('gravação: informe um endereço http(s) de até 500 caracteres')
      novo.gravacao_url = u
    }
    if (treinado !== undefined) {
      if (!Array.isArray(treinado) || treinado.length > 20) throw erro('treinado: lista de até 20 processos')
      const ids = [...new Set(treinado.map(String))]
      if (ids.some(id => !PROC.has(id))) throw erro('treinado: só processos do Manual (lista fechada)')
      const antes = new Map(novo.treinado.map(x => [x.processo_id, x]))
      novo.treinado = ids.map(id => antes.get(id) || { processo_id: id, por: novo.consultor || quem, em: hoje() })
    }
    const depois = { ...novo, treinado: novo.treinado.map(x => ({ ...x, nome: PROC.get(x.processo_id) })) }
    if (!confirmar) return { previa: true, tarefa_id: t.id, depois, efeito: 'Grava só o registro do encontro neste painel (nada vai ao Notion).' }
    h.prepare(`INSERT INTO encontro_info (tarefa_id, cliente, tipo, consultor, gravacao_url, treinado_json, por, atualizado_em) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(tarefa_id) DO UPDATE SET tipo = excluded.tipo, consultor = excluded.consultor, gravacao_url = excluded.gravacao_url, treinado_json = excluded.treinado_json, por = excluded.por, atualizado_em = excluded.atualizado_em`)
      .run(t.id, cliente, novo.tipo, novo.consultor, novo.gravacao_url, JSON.stringify(novo.treinado), quem, agora())
    return { ok: true, tarefa_id: t.id, depois }
  }

  // transcrição (.txt) do consultor: consentimento obrigatório; arquivo fora do banco; candidatos de tarefa (lado do cliente) para o plano aprovar
  async function transcricao({ cliente, tarefa_id, texto, consentimento, por, confirmar = false }) {
    const quem = exigePor(por), t = cardDoEncontro(cliente, tarefa_id)
    if (consentimento !== true) throw erro('registre o consentimento do cliente para guardar a transcrição')
    if (typeof texto !== 'string' || texto.includes('\u0000')) throw erro('envie o texto do arquivo .txt')
    const bytes = Buffer.byteLength(texto, 'utf8')
    if (texto.trim().length < 20 || bytes > MAX_TRANSCRICAO) throw erro('a transcrição precisa ter de 20 caracteres a 500 KB')
    const sha = createHash('sha256').update(texto, 'utf8').digest('hex')
    let candidatos = candidatosDaAta(texto)
    const redacao = temChaveIA() && redigir ? 'a IA redige os títulos ao confirmar (processo continua da lista fechada)' : 'sem ANTHROPIC_API_KEY: títulos pelo modelo fixo'
    if (!confirmar) return { previa: true, tarefa_id: t.id, sha256: sha, bytes, candidatos, redacao, efeito: 'Guarda o arquivo fora do banco e os candidatos no registro do encontro; eles entram como ações PROPOSTAS na próxima geração do plano (o consultor aprova ou descarta). Nada vai ao Notion agora.' }
    if (redigir) candidatos = await Promise.all(candidatos.slice(0, 10).map(async c => {
      const r = await redigir({ fatos: { frase: c.frase }, template: c.titulo, instrucao: 'Reescreva o combinado como título curto de tarefa do cliente (até 90 caracteres), começando por verbo no infinitivo, sem nomes de pessoas e sem números que não estejam na frase.', evidence: [{ texto: c.frase }], maxTokens: 80 })
      return r.origem === 'ia' ? { ...c, titulo: String(r.texto).replace(/\s+/g, ' ').trim().slice(0, 150), titulo_origem: 'ia' } : c
    }))
    const slug = norm(cliente).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || createHash('sha256').update(cliente).digest('hex').slice(0, 16)
    const dir = join(raiz, 'data', 'encontros', slug), arq = join(dir, `${sha}.txt`)
    mkdirSync(dir, { recursive: true })
    if (!existsSync(arq)) writeFileSync(arq, texto, { encoding: 'utf8', flag: 'wx' })
    const em = agora()
    h.prepare(`INSERT INTO encontro_info (tarefa_id, cliente, transcricao_ref, transcricao_bytes, candidatos_json, consentimento_transcricao, consentimento_por, consentimento_em, por, atualizado_em)
      VALUES (?,?,?,?,?,1,?,?,?,?) ON CONFLICT(tarefa_id) DO UPDATE SET transcricao_ref = excluded.transcricao_ref, transcricao_bytes = excluded.transcricao_bytes, candidatos_json = excluded.candidatos_json,
      consentimento_transcricao = 1, consentimento_por = excluded.consentimento_por, consentimento_em = excluded.consentimento_em, por = excluded.por, atualizado_em = excluded.atualizado_em`)
      .run(t.id, cliente, `sha256:${sha}`, bytes, JSON.stringify(candidatos), quem, em, quem, em)
    return { ok: true, tarefa_id: t.id, sha256: sha, bytes, candidatos }
  }

  function naoExecutaDo(cliente) {
    const acoes = h.prepare("SELECT id, regra, titulo, prazo, status, notion_page_id, dados_json FROM acoes_plano WHERE cliente = ? AND regra IN ('trilha_prime','combinado_ata')").all(cliente).map(a => ({ ...a, dados: json(a.dados_json, {}) }))
    const tarefas = new Map(tarefasDo(cliente).map(t => [idNorm(t.id), t]))
    return { cliente, hoje: hoje(), produto: centralDe(cliente)?.produto || '', ...naoExecuta({ acoes, tarefas, encontros: listar(cliente), hoje: hoje() }) }
  }

  // carteira: executor por tarefa (distribuídas da trilha/combinados) + treinos de todos os clientes
  function quemTreinaCarteira({ clientes, medidas, wilson, minN = 8 }) {
    const executorPorTarefa = new Map(h.prepare("SELECT notion_page_id, dados_json FROM acoes_plano WHERE regra IN ('trilha_prime','combinado_ata') AND notion_page_id != ''").all()
      .map(a => [idNorm(a.notion_page_id), json(a.dados_json, {}).executor || '']))
    const set = new Set(clientes), treinos = []
    for (const r of h.prepare('SELECT e.cliente, e.treinado_json, t.data_conclusao, t.data_inicio FROM encontro_info e JOIN tarefas t ON t.id = e.tarefa_id').all()) {
      if (!set.has(r.cliente)) continue
      for (const x of json(r.treinado_json, [])) treinos.push({ cliente: r.cliente, familia: familiaDeDemanda(PROC.get(x.processo_id) || '').id, por: x.por, em: x.em || dia10(r.data_conclusao) || dia10(r.data_inicio) })
    }
    return quemTreina({ medidas: medidas.filter(m => set.has(m.cliente)), executorPorTarefa, treinos, consultorCentral: c => centralDe(c)?.consultor || '', minN, wilson })
  }

  function agendaCarteira({ clientes, por = 'consultor' }) {
    const hj = hoje(), todos = clientes.flatMap(c => listar(c, { hojeRef: hj }).map(({ conteudo, ...e }) => e))
    return { por, hoje: hj, clientes: clientes.length, total: contagens(todos, hj), linhas: agenda(todos, { por, hoje: hj }), calendario: CALENDARIO }
  }

  return { listar, painel, registrar, salvarInfo, transcricao, naoExecuta: naoExecutaDo, quemTreina: quemTreinaCarteira, agenda: agendaCarteira }
}
