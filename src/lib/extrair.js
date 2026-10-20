// Extração determinística: propriedades via mapeamento configurável,
// texto dos blocos internos e evidências (imagens/arquivos/bookmarks).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const mapeamento = JSON.parse(readFileSync(join(ROOT, 'config', 'mapeamento.json'), 'utf-8'))

const semAcento = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// índice status normalizado (sem acento/caixa) → categoria
const statusIdx = {}
for (const [cat, nomes] of Object.entries(mapeamento.status_normalizacao))
  if (Array.isArray(nomes)) for (const n of nomes) statusIdx[semAcento(n)] = cat

export function normalizarStatus(statusRaw) {
  if (!statusRaw) return 'nao_iniciada'
  return statusIdx[semAcento(statusRaw)] || 'andamento'
}

// ── leitura de valores de propriedade (qualquer tipo do Notion) ──────────
function valorProp(p) {
  if (!p) return null
  switch (p.type) {
    case 'title': return p.title.map(t => t.plain_text).join('')
    case 'rich_text': return p.rich_text.map(t => t.plain_text).join('')
    case 'select': return p.select?.name ?? ''
    case 'status': return p.status?.name ?? ''
    case 'multi_select': return p.multi_select.map(s => s.name).join(', ')
    case 'number': return p.number
    case 'date': return p.date?.start ?? null
    case 'people': return p.people.map(x => x.name).filter(Boolean).join(', ')
    case 'checkbox': return p.checkbox
    case 'url': return p.url ?? ''
    case 'email': return p.email ?? ''
    case 'formula': return p.formula?.string ?? p.formula?.number ?? p.formula?.boolean ?? null
    case 'rollup': return p.rollup?.number ?? p.rollup?.array?.length ?? null
    case 'relation': return p.relation?.length ? `${p.relation.length} relação(ões)` : ''
    case 'created_time': return p.created_time
    case 'last_edited_time': return p.last_edited_time
    default: return null
  }
}

// Procura a primeira propriedade candidata existente na página.
function acharProp(pagina, candidatos) {
  for (const nome of candidatos || []) {
    if (pagina.properties?.[nome] !== undefined) return valorProp(pagina.properties[nome])
  }
  return null
}

// Sprint derivado por data quando não há propriedade Sprint.
export function sprintPorData(isoData, modo = mapeamento.sprint_automatico?.modo || 'mensal') {
  if (!isoData) return ''
  const d = isoData.slice(0, 10)
  const [ano, mes, dia] = d.split('-')
  if (modo === 'quinzenal') return `Sprint ${ano}-${mes} ${Number(dia) <= 15 ? 'Q1' : 'Q2'}`
  return `Sprint ${ano}-${mes}`
}

// Campos ausentes na base — sinalizados, nunca inventados.
export function extrairTarefa(pagina, contexto = {}) {
  const P = mapeamento.propriedades
  const ausentes = []
  const pega = campo => {
    const v = acharProp(pagina, P[campo])
    if (v === null && !(P[campo] || []).some(n => pagina.properties?.[n] !== undefined)) ausentes.push(campo)
    return v
  }
  const dataIso = v => (v ? String(v).slice(0, 10) : null)

  const statusRaw = pega('status') ?? ''
  const dataInicio = dataIso(pega('data_inicio'))
  const prazo = dataIso(pega('prazo'))
  const dataConclusao = dataIso(pega('data_conclusao'))
  const visivel = pega('visivel_cliente')

  const t = {
    id: pagina.id,
    titulo: pega('titulo') || 'Sem título',
    cliente: pega('cliente') || contexto.cliente || '',
    projeto: pega('projeto') || contexto.projeto || 'Geral',
    sprint: pega('sprint') || sprintPorData(dataInicio || prazo || dataConclusao || pagina.last_edited_time),
    processo: pega('processo') || 'Geral',
    responsavel: pega('responsavel') || '',
    status_raw: statusRaw,
    status: normalizarStatus(statusRaw),
    prioridade: String(pega('prioridade') ?? ''),
    data_inicio: dataInicio,
    prazo,
    data_conclusao: dataConclusao,
    esforco: typeof pega('esforco') === 'number' ? pega('esforco') : null,
    resultado_esperado: String(pega('resultado_esperado') ?? ''),
    resultado_alcancado: String(pega('resultado_alcancado') ?? ''),
    impacto: String(pega('impacto') ?? ''),
    bloqueio: String(pega('bloqueio') ?? ''),
    proximo_passo: String(pega('proximo_passo') ?? ''),
    visivel_cliente: visivel === false ? 0 : 1,
    descricao: String(pega('descricao') ?? ''),
    tipo_demanda: String(pega('tipo_demanda') ?? ''),
    etiquetas: String(pega('etiquetas') ?? ''),
    url: pagina.url || '',
    last_edited: pagina.last_edited_time || '',
    arquivada: pagina.archived || pagina.in_trash ? 1 : 0,
  }
  return { tarefa: t, ausentes }
}

// ── blocos internos: texto + evidências ──────────────────────────────────
const TIPOS_TEXTO = ['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item',
  'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout', 'code']

function textoDoBloco(b) {
  const rt = b[b.type]?.rich_text
  return rt ? rt.map(t => t.plain_text).join('') : ''
}

export function processarBlocos(blocos, acumulado = { texto: [], evidencias: [] }) {
  for (const b of blocos) {
    if (TIPOS_TEXTO.includes(b.type)) {
      const tx = textoDoBloco(b)
      if (tx) acumulado.texto.push(tx)
    }
    if (b.type === 'image' || b.type === 'file' || b.type === 'pdf' || b.type === 'video') {
      const dados = b[b.type]
      const url = dados?.type === 'external' ? dados.external?.url : dados?.file?.url
      if (url) acumulado.evidencias.push({
        id: b.id,
        tipo: b.type === 'image' ? 'image' : b.type,
        url_origem: url,
        hospedagem: dados?.type,                       // 'file' (Notion, URL expira) | 'external'
        legenda: dados?.caption?.map(t => t.plain_text).join('') || '',
        criada_em: b.created_time || b.last_edited_time || '',
      })
    }
    if (b.type === 'bookmark' || b.type === 'embed') {
      const url = b[b.type]?.url
      if (url) acumulado.evidencias.push({
        id: b.id, tipo: b.type, url_origem: url, hospedagem: 'external',
        legenda: b[b.type]?.caption?.map(t => t.plain_text).join('') || '',
        criada_em: b.created_time || '',
      })
    }
    if (b._filhos) processarBlocos(b._filhos, acumulado)
  }
  return acumulado
}

// Hash do conteúdo relevante — decide reaproveitamento de análise de IA
export function hashConteudo(tarefa, textoBlocos, evidencias) {
  const relevante = JSON.stringify({
    t: tarefa.titulo, s: tarefa.status_raw, sp: tarefa.sprint,
    d: tarefa.descricao, re: tarefa.resultado_esperado, ra: tarefa.resultado_alcancado,
    i: tarefa.impacto, b: tarefa.bloqueio, p: tarefa.proximo_passo,
    tx: textoBlocos, ev: evidencias.map(e => e.id),
  })
  return createHash('sha256').update(relevante).digest('hex').slice(0, 24)
}
