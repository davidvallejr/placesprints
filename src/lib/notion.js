// Cliente da Notion API — versão atual (2025-09-03, com data sources) e
// fallback automático para 2022-06-28 quando a integração/rota não suportar.
// Throttle ~3 req/s, retry com backoff exponencial honrando Retry-After.
import { env } from './env.js'

const BASE = 'https://api.notion.com/v1'
const THROTTLE_MS = 350
let ultimaReq = 0

const sleep = ms => new Promise(r => setTimeout(r, ms))

export class NotionError extends Error {
  constructor(msg, status, corpo) { super(msg); this.status = status; this.corpo = corpo }
}

async function req(caminho, { method = 'GET', body, version = env.NOTION_VERSION, tentativa = 0, retry5xx = true } = {}) {
  if (!env.NOTION_TOKEN) throw new NotionError('NOTION_TOKEN ausente — configure o .env (veja o README, seção "Conectar ao Notion").', 0)
  const espera = ultimaReq + THROTTLE_MS - Date.now()
  if (espera > 0) await sleep(espera)
  ultimaReq = Date.now()

  const r = await fetch(`${BASE}/${caminho}`, {
    signal: AbortSignal.timeout(60_000),
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': version,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.ok) return r.json()

  const texto = await r.text()
  // 429/5xx: retry com backoff (máx. 5 tentativas). retry5xx:false para POSTs de criação
  // não idempotentes (um 502 depois de gravar duplicaria a página a cada tentativa).
  if ((r.status === 429 || (r.status >= 500 && retry5xx)) && tentativa < 5) {
    const retryAfter = Number(r.headers.get('retry-after')) || 0
    const atraso = Math.max(retryAfter * 1000, 1000 * 2 ** tentativa)
    await sleep(atraso)
    return req(caminho, { method, body, version, tentativa: tentativa + 1, retry5xx })
  }
  throw new NotionError(`Notion ${r.status} em ${caminho}: ${texto.slice(0, 300)}`, r.status, texto)
}

// Resolve um id de database para a lista de data sources (API 2025-09-03).
// Se a versão nova não estiver disponível, devolve o próprio id com modo legado.
export async function resolverFontes(databaseId) {
  try {
    const db = await req(`databases/${databaseId}`)
    if (Array.isArray(db.data_sources) && db.data_sources.length)
      return db.data_sources.map(ds => ({ id: ds.id, nome: ds.name || db.title?.[0]?.plain_text || '', modo: 'data_source' }))
    // resposta sem data_sources → tratar como database legada
    return [{ id: databaseId, nome: db.title?.[0]?.plain_text || '', modo: 'database' }]
  } catch (e) {
    if (e.status === 400 || e.status === 404) {
      // pode ser um id que já é data_source, ou versão antiga da API
      try {
        const ds = await req(`data_sources/${databaseId}`)
        return [{ id: ds.id, nome: ds.name || '', modo: 'data_source' }]
      } catch {
        const db = await req(`databases/${databaseId}`, { version: '2022-06-28' })
        return [{ id: databaseId, nome: db.title?.[0]?.plain_text || '', modo: 'legado' }]
      }
    }
    throw e
  }
}

// Consulta paginada de uma fonte ({id, modo}), com filtro opcional de
// last_edited_time para sincronização incremental.
export async function* consultarPaginas(fonte, { desde } = {}) {
  const filtro = desde
    ? { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: desde } } }
    : {}
  let cursor
  do {
    const body = { page_size: 100, ...filtro, ...(cursor ? { start_cursor: cursor } : {}) }
    const rota = fonte.modo === 'data_source' ? `data_sources/${fonte.id}/query` : `databases/${fonte.id}/query`
    const versao = fonte.modo === 'legado' ? '2022-06-28' : env.NOTION_VERSION
    const data = await req(rota, { method: 'POST', body, version: versao })
    for (const pg of data.results) yield pg
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
}

// Lê recursivamente os blocos internos de uma página (até 3 níveis por padrão).
export async function lerBlocos(blockId, profundidade = 3) {
  const blocos = []
  let cursor
  do {
    const q = cursor ? `?start_cursor=${cursor}&page_size=100` : '?page_size=100'
    const data = await req(`blocks/${blockId}/children${q}`)
    for (const b of data.results) {
      blocos.push(b)
      if (b.has_children && profundidade > 0 && b.type !== 'child_page' && b.type !== 'child_database') {
        b._filhos = await lerBlocos(b.id, profundidade - 1)
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined
  } while (cursor)
  return blocos
}

export const notionGet = caminho => req(caminho)
// Requisição genérica COM throttle (3 req/s), retry/backoff e timeout — use esta para
// qualquer escrita em massa no Notion (POST/PATCH), não fetch direto.
export const notionReq = req

export async function baixarArquivo(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!r.ok) throw new Error(`download ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}
