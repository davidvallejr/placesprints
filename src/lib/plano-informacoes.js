// Planos de Ação mensais — a base "Informações" dentro da página de cada
// cliente guarda uma linha por mês/canal ("Setembro/26 - Amz") cujo conteúdo
// é uma tabela 5W2H (What/Why/Where/Quando/Who/How/Observações).
// Este módulo lê essas tabelas e as espelha em planos_acao; o relatório
// apresenta o plano como COMPROMISSO oficial, e o progresso segue medido
// pela execução das tarefas (barra do plano do mês).
import { db, agora, getEstado, setEstado, log } from './db.js'
import { lerBlocos, resolverFontes, consultarPaginas, notionGet, NotionError } from './notion.js'

const MES_NUM = {
  janeiro: '01', fevereiro: '02', marco: '03', março: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
}
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// "Setembro/26 - Amz" → { anoMes: '2026-09', canal: 'Amz' }
export function parseTituloPlano(titulo) {
  const m = norm(titulo).match(/^([a-zç]+)\s*\/\s*(\d{2,4})\s*-\s*(.+)$/)
  if (!m || !MES_NUM[m[1]]) return null
  const ano = m[2].length === 2 ? '20' + m[2] : m[2]
  return { anoMes: `${ano}-${MES_NUM[m[1]]}`, canal: titulo.split('-').slice(1).join('-').trim() }
}

// A página REAL do cliente é o pai da base de tarefas (o campo "Id da página
// do cliente" da central guarda, na prática, o id da database de tarefas).
// Cadeia: data source → parent database → parent page. Cacheada por cliente.
// Só cacheia id VALIDADO (a árvore da API, ou GET pages/{id} de verdade): o campo cru da central já cacheou lixo (H1 Editora: id de database/data source),
// e a base Informações dessa "página" respondia 400 "Block does not support children" a cada leitura. forcar:true ignora o cache (revalidação).
const RX_ID = /^[0-9a-f-]{32,36}$/i
export class PaginaInvalida extends NotionError {                 // a "página" do cliente não é página (ou não tem filhos): quem chama invalida e resolve de novo, uma vez
  constructor(msg, status, corpo) { super(msg, status, corpo); this.name = 'PaginaInvalida' }
}
export async function resolverPaginaCliente({ cliente, paginaClienteId, tarefasDbId, tarefasModo, forcar = false }) {
  const chave = `pagina_cliente:${cliente}`
  const cache = forcar ? '' : getEstado(chave)
  if (cache && RX_ID.test(cache)) return cache
  const grava = id => { if (id) setEstado(chave, id); return id }
  try {
    if (tarefasDbId) {
      let dbId = tarefasDbId
      if (tarefasModo === 'data_source') {
        const ds = await notionGet(`data_sources/${tarefasDbId}`)
        dbId = ds.parent?.database_id || tarefasDbId
      }
      const dbInfo = await notionGet(`databases/${dbId}`)
      if (dbInfo.parent?.page_id) return grava(dbInfo.parent.page_id)
    }
    if (paginaClienteId) {
      if (!RX_ID.test(String(paginaClienteId))) { log('aviso', `página do cliente ${cliente}: o id da central não tem o formato de um id do Notion`); return null }   // nunca entra numa URL
      // pode ser uma página de verdade — ou o id da database (campo trocado)
      try {
        const dbInfo = await notionGet(`databases/${paginaClienteId}`)
        if (dbInfo.parent?.page_id) return grava(dbInfo.parent.page_id)
      } catch { /* não é database → tratar como página */ }
      const pg = await notionGet(`pages/${paginaClienteId}`)         // valida ANTES de cachear
      if (pg?.object === 'page' && !pg.archived && !pg.in_trash) return grava(paginaClienteId)
      log('aviso', `página do cliente ${cliente}: o id da central não é uma página ativa`)
    }
  } catch (e) {
    log('aviso', `página do cliente ${cliente}: ${e?.status !== undefined ? `Notion ${e.status}` : String(e?.message ?? e).slice(0, 80)}`)   // só o status: o corpo do Notion não vai para o log
  }
  return null
}
// esquece o que foi resolvido para o cliente/página (cache '' conta como miss em getEstado)
export function invalidarCliente(cliente, pagina) {
  if (cliente) setEstado(`pagina_cliente:${cliente}`, '')
  if (pagina) { setEstado(`info:${pagina}`, ''); setEstado(`info_vazio:${pagina}`, '') }
}

// ttlNegativoMs: validade do cache de "sem Informações" (info_vazio:{pagina}). PADRÃO 0 = sempre reescaneia, como PlacePlan e sincronizarPlanos sempre fizeram (um cache negativo de 6 h
// escondia a base recém-criada). Só o relatório em lote passa um TTL (relatorio-notion.js: 6 h) para não reescanear a página a cada cliente sem a base.
export async function acharInformacoesDb(paginaClienteId, { ttlNegativoMs = 0 } = {}) {
  const chave = `info:${paginaClienteId}`
  const cache = getEstado(chave)
  if (cache) return cache
  const vazio = getEstado(`info_vazio:${paginaClienteId}`)
  if (vazio && ttlNegativoMs > 0 && Date.now() - Date.parse(vazio) < ttlNegativoMs) return null
  let blocos
  try { blocos = await lerBlocos(paginaClienteId, 0) } catch (e) {
    if (e?.status === 404 || (e?.status === 400 && /does not support children/i.test(String(e.message)))) throw new PaginaInvalida(`página do cliente inválida (${e.status})`, e.status, '')
    throw e
  }
  const info = blocos.find(b => b.type === 'child_database' && /informa/i.test(b.child_database?.title || ''))
  if (!info) { setEstado(`info_vazio:${paginaClienteId}`, agora()); return null }
  setEstado(chave, info.id)
  return info.id
}

function extrairAcoesDaTabela(blocos) {
  const linhas = []
  const anda = bs => {
    for (const b of bs) {
      if (b.type === 'table_row') linhas.push(b.table_row.cells.map(c => c.map(t => t.plain_text).join('').trim()))
      if (b._filhos) anda(b._filhos)
    }
  }
  anda(blocos)
  if (!linhas.length) return []
  // primeira linha com cara de cabeçalho (what/o que) é descartada
  const inicio = /what|o que|oque/i.test(linhas[0]?.join(' ')) ? 1 : 0
  return linhas.slice(inicio)
    .filter(c => (c[0] || '').trim())
    .map(c => ({ oque: c[0] || '', porque: c[1] || '', onde: c[2] || '', quando: c[3] || '', quem: c[4] || '', como: c[5] || '', obs: c[6] || '' }))
}

// Busca no Notion os planos do(s) mês(es) pedido(s) e espelha em planos_acao.
export async function sincronizarPlanos({ cliente, paginaClienteId, tarefasDbId, tarefasModo, meses }) {
  const pagina = await resolverPaginaCliente({ cliente, paginaClienteId, tarefasDbId, tarefasModo })
  if (!pagina) return { ok: false, motivo: 'página do cliente não resolvida' }
  const infoDb = await acharInformacoesDb(pagina)
  if (!infoDb) return { ok: false, motivo: 'base "Informações" não encontrada na página' }

  const gravar = db.prepare(`INSERT INTO planos_acao (cliente, ano_mes, canal, status, acoes_json, url, atualizado_em)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(cliente, ano_mes, canal) DO UPDATE SET status=excluded.status,
      acoes_json=excluded.acoes_json, url=excluded.url, atualizado_em=excluded.atualizado_em`)

  let encontrados = 0
  for (const fonte of await resolverFontes(infoDb)) {
    for await (const pg of consultarPaginas(fonte)) {
      const titKey = Object.keys(pg.properties).find(k => pg.properties[k].type === 'title')
      const titulo = pg.properties[titKey]?.title?.map(t => t.plain_text).join('') || ''
      const info = parseTituloPlano(titulo)
      if (!info || (meses && !meses.includes(info.anoMes))) continue
      try {
        const blocos = await lerBlocos(pg.id, 2)
        const acoes = extrairAcoesDaTabela(blocos)
        const statusSel = Object.values(pg.properties).find(p => p.type === 'select')?.select?.name || ''
        gravar.run(cliente, info.anoMes, info.canal, statusSel, JSON.stringify(acoes), pg.url || '', agora())
        encontrados++
      } catch (e) {
        log('aviso', `plano "${titulo}" (${cliente}): ${e.message}`)
      }
    }
  }
  return { ok: true, encontrados }
}

// Leitura local (relatórios) — não toca o Notion.
export function planosDoMes(cliente, anoMes) {
  return db.prepare('SELECT * FROM planos_acao WHERE cliente = ? AND ano_mes = ? ORDER BY canal').all(cliente, anoMes)
    .map(r => ({ canal: r.canal, status: r.status, url: r.url, acoes: JSON.parse(r.acoes_json), atualizado_em: r.atualizado_em }))
}
