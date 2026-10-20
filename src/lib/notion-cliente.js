// Notion do cliente no painel: para cada cliente da central lê a PÁGINA do cliente (título, url), os filhos de 1º nível
// (bases e páginas) e a base «Informações» inteira (uma linha por item: título, Secção, Status, Link, url, última edição).
// Só leitura no Notion; grava em cliente_notion_pagina / cliente_informacoes (isolamento por cliente). Puro: banco, Notion e
// resolução de página entram por fábrica — o teste roda com :memory: e stub. Erro do Notion nunca ecoa o corpo (só o status).
// Contrato e limites: docs/notion-cliente.md.

export const SCHEMA_NOTION_CLIENTE = `
CREATE TABLE IF NOT EXISTS cliente_notion_pagina (
  cliente TEXT PRIMARY KEY,
  page_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '',
  filhos_json TEXT NOT NULL DEFAULT '[]',
  lido_em TEXT NOT NULL DEFAULT '', erro TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS cliente_informacoes (
  row_id TEXT PRIMARY KEY, cliente TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '', secao TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '', editado_em TEXT NOT NULL DEFAULT '', lido_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_cliente_informacoes_cliente ON cliente_informacoes (cliente, secao);
`

const RX_ID = /^[0-9a-f-]{32,36}$/i
const normNome = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const texto = v => typeof v === 'string' ? v.trim() : ''
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const plain = arr => (Array.isArray(arr) ? arr : []).map(t => t?.plain_text ?? '').join('').trim()
export const urlDe = (id, url) => url || `https://www.notion.so/${String(id || '').replace(/-/g, '')}`
// mensagem segura: só o status do Notion (nunca o corpo) ou a mensagem local cortada
export const resumirErro = e => e?.status !== undefined ? `Notion ${e.status}` : String(e?.message ?? e).replace(/\{[\s\S]*$/, '').slice(0, 80)

// título do bloco filho (child_database / child_page) e tipo legível
export const filhoDe = b => {
  if (b?.type === 'child_database') return { id: b.id, tipo: 'base', titulo: String(b.child_database?.title || '').trim(), url: urlDe(b.id) }
  if (b?.type === 'child_page') return { id: b.id, tipo: 'pagina', titulo: String(b.child_page?.title || '').trim(), url: urlDe(b.id) }
  return null
}
export const ehInformacoes = f => f?.tipo === 'base' && /informa/i.test(f.titulo)

// uma linha da base Informações a partir das propriedades da página (chaves pelo tipo/nome; nunca pela posição)
export function linhaDe(pg) {
  const props = pg?.properties && typeof pg.properties === 'object' ? Object.entries(pg.properties) : []
  const sel = p => p?.select?.name || p?.status?.name || ''
  const tit = props.find(([, p]) => p?.type === 'title')
  const sec = props.find(([k, p]) => (p?.type === 'select' || p?.type === 'status') && /^sec{1,2}ao$/.test(normNome(k)))
  const sta = props.find(([k, p]) => (p?.type === 'select' || p?.type === 'status') && normNome(k) === 'status')
  const link = props.find(([k, p]) => p?.type === 'url' && /link/.test(normNome(k))) || props.find(([, p]) => p?.type === 'url')
  return { row_id: pg.id, titulo: plain(tit?.[1]?.title), secao: sel(sec?.[1]), status: sel(sta?.[1]), link: texto(link?.[1]?.url || ''), url: urlDe(pg.id, pg.url), editado_em: String(pg.last_edited_time || '') }
}

// deps: handle (better-sqlite3), notion.req(caminho, opts), fontes() → [{cliente, dbId, modo, paginaClienteId}], resolverPaginaCliente(params),
//       estado {get,set}, clienteCanonico(nome) → nome da central ou '', validarPor(nome) → nome ou '', agora(), log(nivel, msg)
export function criarNotionCliente({ handle, notion, fontes, resolverPaginaCliente, estado, clienteCanonico, validarPor, agora = () => new Date().toISOString(), log = () => {} }) {
  handle.exec(SCHEMA_NOTION_CLIENTE)
  const req = (caminho, opts = {}) => notion.req(caminho, { retry5xx: false, ...opts })
  const upPagina = handle.prepare(`INSERT INTO cliente_notion_pagina (cliente, page_id, url, titulo, filhos_json, lido_em, erro) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(cliente) DO UPDATE SET page_id=excluded.page_id, url=excluded.url, titulo=excluded.titulo, filhos_json=excluded.filhos_json, lido_em=excluded.lido_em, erro=excluded.erro`)
  const upErro = handle.prepare(`INSERT INTO cliente_notion_pagina (cliente, lido_em, erro) VALUES (?,?,?) ON CONFLICT(cliente) DO UPDATE SET lido_em=excluded.lido_em, erro=excluded.erro`)
  const upLinha = handle.prepare(`INSERT INTO cliente_informacoes (row_id, cliente, titulo, secao, status, link, url, editado_em, lido_em) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(row_id) DO UPDATE SET cliente=excluded.cliente, titulo=excluded.titulo, secao=excluded.secao, status=excluded.status, link=excluded.link, url=excluded.url, editado_em=excluded.editado_em, lido_em=excluded.lido_em`)
  const delLinhas = handle.prepare('DELETE FROM cliente_informacoes WHERE cliente = ?')

  const canon = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    const k = ehProspecto(c) ? '' : clienteCanonico(c)
    if (!k) throw erro('cliente não encontrado na central', 404)
    return k
  }
  const quem = por => { const p = validarPor(texto(por)); if (!p) throw erro('"por" precisa ser líder ou consultor', 403); return p }

  // ── leitura paginada (só leitura; retry5xx:false em tudo) ───────────────────────────────────────────────────────
  async function filhosDaPagina(pagina) {
    const out = []
    let cursor
    do {
      const d = await req(`blocks/${pagina}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
      for (const b of d.results || []) { const f = filhoDe(b); if (f) out.push(f) }
      cursor = d.has_more ? d.next_cursor : undefined
    } while (cursor)
    return out
  }
  async function dataSourceDe(dbId) {
    const b = await req(`databases/${dbId}`)
    const dss = Array.isArray(b?.data_sources) ? b.data_sources : []
    const ds = dss.length === 1 ? dss[0].id : dss.find(d => /informa/i.test(d?.name || ''))?.id || dss[0]?.id
    return { ds: ds || dbId, modo: ds ? 'data_source' : 'database', url: b?.url || '' }
  }
  async function* linhasDe({ ds, modo }, desde) {
    const filtro = desde ? { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: desde } } } : {}
    let cursor
    do {
      const d = await req(modo === 'data_source' ? `data_sources/${ds}/query` : `databases/${ds}/query`, { method: 'POST', body: { page_size: 100, ...filtro, ...(cursor ? { start_cursor: cursor } : {}) } })
      for (const pg of d.results || []) if (pg?.object === 'page' && !pg.archived && !pg.in_trash) yield linhaDe(pg)
      cursor = d.has_more ? d.next_cursor : undefined
    } while (cursor)
  }

  // ── um cliente: página → filhos → Informações; completo:true reescreve as linhas, senão incremental por last_edited_time ──
  async function lerCliente(bruto, { completo = false, por } = {}) {
    const cliente = canon(bruto)
    if (por !== undefined) quem(por)
    const t = agora()
    try {
      const fonte = (await fontes()).find(f => f.cliente === cliente)
      const pagina = await resolverPaginaCliente({ cliente, paginaClienteId: fonte?.paginaClienteId || '', tarefasDbId: fonte?.dbId || '', tarefasModo: fonte?.modo || null })
      if (!pagina || !RX_ID.test(String(pagina))) { upErro.run(cliente, t, 'sem_pagina'); return { cliente, estado: 'sem_pagina', lido_em: t } }
      const pg = await req(`pages/${pagina}`)
      if (pg?.object !== 'page' || pg.archived || pg.in_trash) { upErro.run(cliente, t, 'pagina_invalida'); return { cliente, estado: 'pagina_invalida', lido_em: t } }
      const titProp = Object.values(pg.properties || {}).find(p => p?.type === 'title')
      const titulo = plain(titProp?.title) || cliente
      const filhos = await filhosDaPagina(pagina)
      const info = filhos.find(ehInformacoes)

      const chave = `notion_info_desde:${cliente}`
      const desde = completo ? '' : (estado.get(chave) || '')
      const linhas = []
      let infoUrl = ''
      if (info) {
        const fonteInfo = await dataSourceDe(info.id)
        infoUrl = fonteInfo.url
        for await (const l of linhasDe(fonteInfo, desde)) linhas.push(l)
      }
      handle.transaction(() => {
        upPagina.run(cliente, pagina, urlDe(pagina, pg.url), titulo, JSON.stringify(filhos.map(f => f.id === info?.id && infoUrl ? { ...f, url: infoUrl } : f)), t, '')
        if (!info || !desde) delLinhas.run(cliente)              // leitura completa (ou base sumiu): o que não está mais no Notion sai
        for (const l of linhas) upLinha.run(l.row_id, cliente, l.titulo, l.secao, l.status, l.link, l.url, l.editado_em, t)
      })()
      if (info) estado.set(chave, t); else estado.set(chave, '')
      return { cliente, estado: info ? 'ok' : 'sem_informacoes', lido_em: t, filhos: filhos.length, linhas: linhas.length, incremental: !!desde }
    } catch (e) {
      const msg = resumirErro(e)
      upErro.run(cliente, t, msg)
      log('aviso', `Notion do cliente ${cliente}: ${msg}`)
      return { cliente, estado: 'erro', erro: msg, lido_em: t }
    }
  }

  // ── leitura local (painel) ──────────────────────────────────────────────────────────────────────────────────────
  function lerLocal(bruto) {
    const cliente = canon(bruto)
    const p = handle.prepare('SELECT * FROM cliente_notion_pagina WHERE cliente = ?').get(cliente)
    const linhas = handle.prepare('SELECT row_id, titulo, secao, status, link, url, editado_em FROM cliente_informacoes WHERE cliente = ? ORDER BY editado_em DESC').all(cliente)
    const secoes = [...new Set(linhas.map(l => l.secao).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    return { cliente, pagina: p ? { page_id: p.page_id, url: p.url, titulo: p.titulo, filhos: JSON.parse(p.filhos_json || '[]'), lido_em: p.lido_em, erro: p.erro } : null, informacoes: linhas, secoes }
  }

  // ── todos (job com progresso; prévia sem confirmar:true) ───────────────────────────────────────────────────────
  const jobs = new Map()
  let rodando = null
  const todosDaCentral = () => handle.prepare('SELECT cliente FROM clientes_central ORDER BY cliente').all().map(r => r.cliente).filter(c => !ehProspecto(c))
  const jobDe = id => { const j = jobs.get(String(id)); return j ? { id: j.id, estado: j.estado, total: j.total, feitos: j.feitos, atual: j.atual, itens: j.itens.slice(), resumo: j.resumo } : null }
  function lerTodos({ por, confirmar = false, completo = false } = {}) {
    quem(por)
    const clientes = todosDaCentral()
    if (confirmar !== true) return { ok: true, previa: true, n: clientes.length, clientes, ultimo: estado.get('notion_cliente_todos_em') || '' }
    if (rodando && jobs.get(rodando)?.estado === 'rodando') throw erro('já existe uma atualização rodando — aguarde terminar', 409)
    const job = { id: Date.now().toString(36), estado: 'rodando', total: clientes.length, feitos: 0, atual: '', itens: [], resumo: null, por: quem(por) }
    jobs.set(job.id, job); rodando = job.id
    for (const k of [...jobs.keys()].slice(0, -10)) jobs.delete(k)
    ;(async () => {
      for (const c of clientes) { job.atual = c; const r = await lerCliente(c, { completo }); job.itens.push({ cliente: c, estado: r.estado, linhas: r.linhas ?? 0, erro: r.erro || '' }); job.feitos++ }
      job.resumo = resumir(job.itens); job.estado = 'concluido'; job.atual = ''
      estado.set('notion_cliente_todos_em', agora())
    })().catch(e => { job.estado = 'erro'; job.resumo = { erro: resumirErro(e) } })
    return { ok: true, job: job.id, total: clientes.length }
  }
  const resumir = itens => itens.reduce((a, i) => { a[i.estado] = (a[i.estado] || 0) + 1; a.linhas += i.linhas || 0; return a }, { linhas: 0 })

  // ── etapa do sync (incremental, com teto de tempo; nunca lança) — os mais antigos primeiro ──────────────────────
  async function etapaSync({ limiteMs = 4 * 60_000, filtro } = {}) {
    const t0 = Date.now(), r = { lidos: 0, erros: 0, pulados: 0 }
    try {
      const fila = handle.prepare(`SELECT c.cliente FROM clientes_central c LEFT JOIN cliente_notion_pagina p ON p.cliente = c.cliente ORDER BY COALESCE(p.lido_em, '') ASC, c.cliente`).all()
        .map(x => x.cliente).filter(c => !ehProspecto(c) && (!filtro || normNome(c).includes(normNome(filtro))))
      for (const c of fila) {
        if (Date.now() - t0 > limiteMs) { r.pulados = fila.length - r.lidos - r.erros; break }
        const x = await lerCliente(c)
        x.estado === 'erro' ? r.erros++ : r.lidos++
      }
    } catch (e) { log('aviso', `Notion dos clientes: ${resumirErro(e)}`) }
    return r
  }

  return { lerCliente, lerLocal, lerTodos, jobDe, etapaSync }
}
