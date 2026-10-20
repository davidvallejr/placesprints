// Autoteste do Notion do cliente no painel (src/lib/notion-cliente.js, src/rotas-notion-cliente.js, descobrirQuadroNaPagina):
// leitura com paginação, incremental por last_edited_time, isolamento A×B, prospect recusado, 5xx não derruba nem ecoa o corpo,
// descoberta do quadro pela página (único / ambíguo / nenhum), rotas com `por` validado e confirmar estrito. Sem rede, sem banco real.
// Rodar: node scripts/teste-notion-cliente.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { criarNotionCliente, linhaDe, resumirErro } from '../src/lib/notion-cliente.js'
import { criarRotasNotionCliente } from '../src/rotas-notion-cliente.js'
import { descobrirQuadroNaPagina } from '../src/lib/descobrir.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const SEGREDO = 'CORPO-SECRETO-DO-NOTION-123'
const NE = status => Object.assign(new Error(`Notion ${status} em x: {"message":"${SEGREDO}"}`), { status, corpo: SEGREDO })
const QUEM = ['Giovanna Torres']
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const hex = (p, i) => (p + String(i).padStart(4, '0')).padEnd(32, '0')

// mundo: cliente → { pagina, filhos, linhas[] }; falhas por caminho; contador de chamadas
function mundo(clientes) {
  const w = { cfg: new Map(), chamadas: [], falhas: new Map(), relogio: { t: '2026-10-09T10:00:00.000Z' } }
  let i = 0
  for (const [nome, o = {}] of clientes) {
    i++
    const c = { pagina: hex('a', i), info: hex('b', i), ds: hex('c', i), arquivada: false, semInfo: false, linhas: [], ...o }
    c.filhos = [{ object: 'block', id: hex('d', i), type: 'child_page', child_page: { title: 'Plano 2026' } }, ...(c.semInfo ? [] : [{ object: 'block', id: c.info, type: 'child_database', child_database: { title: 'Informações' } }])]
    w.cfg.set(nome, c)
  }
  const pageDe = id => [...w.cfg.entries()].find(([, c]) => c.pagina === id)
  const linha = (c, l) => ({ object: 'page', id: l.id, url: `https://www.notion.so/${l.id}`, last_edited_time: l.editado, archived: !!l.arquivada, properties: {
    'Lista ': { type: 'title', title: [{ plain_text: l.titulo }] }, 'Secção ': { type: 'status', status: l.secao ? { name: l.secao } : null },
    Status: { type: 'select', select: l.status ? { name: l.status } : null }, 'Link ': { type: 'url', url: l.link || null } } })
  w.req = async (caminho, opts = {}) => {
    w.chamadas.push({ caminho, ...opts })
    const f = w.falhas.get(caminho.split('?')[0]); if (f) { w.falhas.delete(caminho.split('?')[0]); throw NE(f) }
    let m
    if ((m = caminho.match(/^pages\/(.+)$/))) { const e = pageDe(m[1]); if (!e) throw NE(404); return { object: 'page', id: m[1], url: `https://www.notion.so/${m[1]}`, archived: e[1].arquivada, properties: { title: { type: 'title', title: [{ plain_text: `Página de ${e[0]}` }] } } } }
    if ((m = caminho.match(/^blocks\/(.+?)\/children\?page_size=100(?:&start_cursor=(.+))?$/))) {
      const e = pageDe(m[1]); if (!e) throw NE(404)
      const f = e[1].filhos; return m[2] ? { results: f.slice(1), has_more: false } : { results: f.slice(0, 1), has_more: f.length > 1, next_cursor: 'c2' }   // paginação dos filhos
    }
    if ((m = caminho.match(/^databases\/(.+)$/))) { const e = [...w.cfg.values()].find(c => c.info === m[1]); if (!e) throw NE(404); return { object: 'database', id: m[1], url: `https://www.notion.so/${m[1]}?v=1`, data_sources: [{ id: e.ds, name: 'Informações' }] } }
    if ((m = caminho.match(/^data_sources\/(.+)\/query$/))) {
      const e = [...w.cfg.values()].find(c => c.ds === m[1]); if (!e) throw NE(404)
      const desde = opts.body?.filter?.last_edited_time?.on_or_after
      const todas = e.linhas.filter(l => !desde || l.editado >= desde).map(l => linha(e, l))
      const ini = Number(opts.body?.start_cursor || 0), pag = todas.slice(ini, ini + 2)      // 2 por página
      return { results: pag, has_more: ini + 2 < todas.length, next_cursor: String(ini + 2) }
    }
    throw NE(500)
  }
  return w
}
function montar(clientes, { central } = {}) {
  const w = mundo(clientes)
  const h = new Database(':memory:')
  h.exec('CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY); CREATE TABLE sync_estado (chave TEXT PRIMARY KEY, valor TEXT)')
  for (const c of central || clientes.map(([n]) => n)) h.prepare('INSERT INTO clientes_central VALUES (?)').run(c)
  const estado = { get: k => h.prepare('SELECT valor FROM sync_estado WHERE chave = ?').get(k)?.valor, set: (k, v) => h.prepare('INSERT INTO sync_estado VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, v) }
  const logs = []
  const nc = criarNotionCliente({ handle: h, notion: { req: (...a) => w.req(...a) }, fontes: async () => clientes.map(([n]) => ({ cliente: n, dbId: '', modo: null, paginaClienteId: '' })),
    resolverPaginaCliente: async ({ cliente }) => w.cfg.get(cliente)?.pagina || null, estado,
    clienteCanonico: nome => (central || clientes.map(([n]) => n)).find(c => norm(c) === norm(nome)) || '', validarPor: v => QUEM.find(q => norm(q) === norm(v)) || '',
    agora: () => w.relogio.t, log: (nv, m) => logs.push(`${nv}: ${m}`) })
  return { w, h, nc, logs, estado }
}
const L = (i, o = {}) => ({ id: hex('e', i), titulo: `Item ${i}`, secao: i % 2 ? 'Plano de Ação' : 'Relatório', status: 'Concluído', link: `https://x.test/${i}`, editado: '2026-10-01T00:00:00.000Z', ...o })

await ok('linhaDe: título pelo tipo, Secção/Status por nome (status ou select), Link pela url; vazio = ""', () => {
  const l = linhaDe({ id: 'r1', url: 'u', last_edited_time: 't', properties: { Nome: { type: 'title', title: [{ plain_text: 'A' }, { plain_text: 'B' }] }, 'Seção': { type: 'select', select: { name: 'Plano' } }, status: { type: 'status', status: null }, Site: { type: 'url', url: 'https://s' } } })
  assert.deepEqual(l, { row_id: 'r1', titulo: 'AB', secao: 'Plano', status: '', link: 'https://s', url: 'u', editado_em: 't' })
  assert.equal(linhaDe({ id: 'x' }).url, 'https://www.notion.so/x')
  assert.equal(resumirErro(NE(502)), 'Notion 502'); assert.ok(!resumirErro(NE(502)).includes(SEGREDO))
})

await ok('leitura completa: página, filhos paginados (2 páginas de blocos) e Informações paginada (5 linhas em 3 páginas); tudo com retry5xx:false; arquivada não entra', async () => {
  const m = montar([['Acme', { linhas: [L(1), L(2), L(3), L(4), L(5), L(6, { arquivada: true })] }]])
  const r = await m.nc.lerCliente('Acme')
  assert.deepEqual([r.estado, r.filhos, r.linhas, r.incremental], ['ok', 2, 5, false])
  assert.ok(m.w.chamadas.length >= 6 && m.w.chamadas.every(c => c.retry5xx === false), 'retry5xx:false em todas')
  const loc = m.nc.lerLocal('acme')
  assert.deepEqual([loc.pagina.titulo, loc.pagina.page_id, loc.pagina.filhos.map(f => f.tipo), loc.pagina.filhos[1].url], ['Página de Acme', hex('a', 1), ['pagina', 'base'], `https://www.notion.so/${hex('b', 1)}?v=1`])
  assert.deepEqual(loc.secoes, ['Plano de Ação', 'Relatório']); assert.equal(loc.informacoes.length, 5)
  assert.deepEqual(Object.keys(loc.informacoes[0]), ['row_id', 'titulo', 'secao', 'status', 'link', 'url', 'editado_em'])
  assert.equal(m.estado.get('notion_info_desde:Acme'), m.w.relogio.t)
})

await ok('incremental: 2ª leitura só pede o que mudou desde a marca (filtro last_edited_time) e preserva as linhas antigas; completo:true reescreve e remove o que sumiu', async () => {
  const m = montar([['Acme', { linhas: [L(1), L(2)] }]])
  await m.nc.lerCliente('Acme')
  m.w.relogio.t = '2026-10-10T10:00:00.000Z'; m.w.chamadas.length = 0
  m.w.cfg.get('Acme').linhas = [L(1, { titulo: 'Item 1 editado', editado: '2026-10-09T12:00:00.000Z' }), L(3, { editado: '2026-10-09T12:00:00.000Z' })]   // o 2 sumiu no Notion
  const r = await m.nc.lerCliente('Acme')
  assert.deepEqual([r.incremental, r.linhas], [true, 2])
  const q = m.w.chamadas.find(c => c.caminho.endsWith('/query')); assert.equal(q.body.filter.last_edited_time.on_or_after, '2026-10-09T10:00:00.000Z')
  let it = m.nc.lerLocal('Acme').informacoes; assert.deepEqual(it.map(i => i.titulo).sort(), ['Item 1 editado', 'Item 2', 'Item 3'], 'incremental não apaga')
  await m.nc.lerCliente('Acme', { completo: true })
  it = m.nc.lerLocal('Acme').informacoes; assert.deepEqual(it.map(i => i.titulo).sort(), ['Item 1 editado', 'Item 3'], 'completo remove o que sumiu')
})

await ok('isolamento A×B: as linhas de um cliente nunca aparecem no outro; lerLocal de quem nunca foi lido = pagina null', async () => {
  const m = montar([['A', { linhas: [L(1), L(2)] }], ['B', { linhas: [L(3)] }]])
  await m.nc.lerCliente('A'); await m.nc.lerCliente('B')
  assert.deepEqual(m.nc.lerLocal('A').informacoes.map(i => i.titulo).sort(), ['Item 1', 'Item 2'])
  assert.deepEqual(m.nc.lerLocal('B').informacoes.map(i => i.titulo), ['Item 3'])
  const m2 = montar([['C', {}]]); assert.deepEqual(m2.nc.lerLocal('C'), { cliente: 'C', pagina: null, informacoes: [], secoes: [] })
})

await ok('prospect "[Comercial] …" e desconhecido = 404 sem eco; cliente vazio = 400; "por" inválido = 403', async () => {
  const m = montar([['Acme', {}]])
  for (const c of ['[Comercial] Empresa X · 9', 'Fantasma<b>']) { await assert.rejects(m.nc.lerCliente(c), e => e.status === 404 && !e.message.includes('Empresa') && !e.message.includes('<b>')); assert.throws(() => m.nc.lerLocal(c), e => e.status === 404) }
  await assert.rejects(m.nc.lerCliente(''), e => e.status === 400)
  await assert.rejects(m.nc.lerCliente('Acme', { por: 'Ninguém' }), e => e.status === 403)
  assert.throws(() => m.nc.lerTodos({ por: '' }), e => e.status === 403)
  assert.equal(m.w.chamadas.length, 0)
})

await ok('sem página = sem_pagina; sem base Informações = sem_informacoes (filhos gravados, linhas zeradas); 5xx = estado erro só com o status, nada ecoa, leitura anterior fica', async () => {
  const m = montar([['Acme', { linhas: [L(1)] }], ['SemInfo', { semInfo: true }], ['SemPag', {}]], { central: ['Acme', 'SemInfo', 'SemPag'] })
  m.w.cfg.get('SemPag').pagina = ''
  assert.equal((await m.nc.lerCliente('SemPag')).estado, 'sem_pagina'); assert.equal(m.nc.lerLocal('SemPag').pagina.erro, 'sem_pagina')
  const si = await m.nc.lerCliente('SemInfo'); assert.deepEqual([si.estado, si.filhos, si.linhas], ['sem_informacoes', 1, 0])
  await m.nc.lerCliente('Acme'); assert.equal(m.nc.lerLocal('Acme').informacoes.length, 1)
  m.w.falhas.set(`data_sources/${hex('c', 1)}/query`, 502)
  const r = await m.nc.lerCliente('Acme')
  assert.deepEqual([r.estado, r.erro], ['erro', 'Notion 502'])
  const s = JSON.stringify([r, m.nc.lerLocal('Acme'), m.logs]); assert.ok(!s.includes(SEGREDO), 'corpo do Notion vazou')
  assert.equal(m.nc.lerLocal('Acme').informacoes.length, 1, 'erro não apaga a leitura anterior'); assert.equal(m.nc.lerLocal('Acme').pagina.erro, 'Notion 502')
  // etapaSync: um cliente com erro não derruba os outros; teto de tempo zero lê nada e conta pulados
  m.w.falhas.set(`pages/${hex('a', 1)}`, 500)
  const e = await m.nc.etapaSync(); assert.deepEqual(e, { lidos: 2, erros: 1, pulados: 0 })
  assert.deepEqual(await m.nc.etapaSync({ limiteMs: -1 }), { lidos: 0, erros: 0, pulados: 3 })
})

await ok('lerTodos: prévia sem confirmar:true (lista, nada lido); confirmar:true cria job com progresso e resumo; segundo job enquanto roda = 409', async () => {
  const m = montar([['A', { linhas: [L(1)] }], ['B', { semInfo: true }]])
  const p = m.nc.lerTodos({ por: 'giovanna torres', confirmar: 'true' }); assert.deepEqual([p.previa, p.n, p.clientes], [true, 2, ['A', 'B']]); assert.equal(m.w.chamadas.length, 0)
  const j = m.nc.lerTodos({ por: 'Giovanna Torres', confirmar: true }); assert.equal(j.total, 2)
  assert.throws(() => m.nc.lerTodos({ por: 'Giovanna Torres', confirmar: true }), e => e.status === 409)
  let s; const t = Date.now(); do { await new Promise(r => setTimeout(r, 5)); s = m.nc.jobDe(j.job) } while (s.estado === 'rodando' && Date.now() - t < 3000)
  assert.deepEqual([s.estado, s.feitos, s.itens.map(i => i.estado), s.resumo], ['concluido', 2, ['ok', 'sem_informacoes'], { linhas: 1, ok: 1, sem_informacoes: 1 }])
  assert.equal(m.nc.jobDe('nada'), null)
})

await ok('descobrirQuadroNaPagina: filho único «Tarefas…»/«Demandas…» vira fonte e fica em sync_estado; dois = ambíguo; nenhum/sem página = {}; lembrado não relê a página', async () => {
  const mem = new Map(), deps = { get: k => mem.get(k), set: (k, v) => mem.set(k, v), resolverPagina: async ({ cliente }) => cliente === 'SemPag' ? null : 'pg1', fontesDe: async id => [{ id: 'ds-' + id, modo: 'data_source' }] }
  const filhos = { Um: [{ type: 'child_database', id: 'db1', child_database: { title: '🛠️ Tarefas Casulus' } }, { type: 'child_page', child_page: { title: 'Tarefas antigas' } }], Dois: [{ type: 'child_database', id: 'x', child_database: { title: 'Tarefas' } }, { type: 'child_database', id: 'y', child_database: { title: 'Demandas 2026' } }], Zero: [{ type: 'child_database', id: 'z', child_database: { title: 'Informações' } }] }
  let lidas = 0
  const d = { ...deps, lerFilhos: async () => { lidas++; return filhos[atual] } }
  let atual = 'Um'; let r = await descobrirQuadroNaPagina({ cliente: 'Um', paginaClienteId: '' }, d)
  assert.deepEqual(r, { fonte: { dbId: 'ds-db1', modo: 'data_source', titulo: '🛠️ Tarefas Casulus' } })
  assert.deepEqual(JSON.parse(mem.get('fonte_descoberta:Um')).ds_id, 'ds-db1')
  r = await descobrirQuadroNaPagina({ cliente: 'Um', paginaClienteId: '' }, d); assert.equal(r.lembrado, true); assert.equal(lidas, 1)
  atual = 'Dois'; assert.deepEqual(await descobrirQuadroNaPagina({ cliente: 'Dois' }, d), { ambiguos: ['Tarefas', 'Demandas 2026'] })
  atual = 'Zero'; assert.deepEqual(await descobrirQuadroNaPagina({ cliente: 'Zero' }, d), {})
  assert.deepEqual(await descobrirQuadroNaPagina({ cliente: 'SemPag' }, d), {})
  assert.deepEqual(await descobrirQuadroNaPagina({ cliente: 'Falha' }, { ...d, lerFilhos: async () => { throw NE(503) } }), {})
  assert.ok(![...mem.keys()].some(k => k.includes('Dois') || k.includes('Zero')), 'ambíguo/nenhum não grava')
})

await ok('rotas: 415 sem JSON; GET contrato; POST atualizar com por; atualizar-todos confirmar estrito; job 404; prospect 404 sem eco', async () => {
  const m = montar([['Acme', { linhas: [L(1)] }]])
  const app = express(); app.use(express.json()); app.use(criarRotasNotionCliente({ nc: m.nc, quem: () => QUEM }))
  app.use((err, req, res, _next) => res.status(500).json({ erro: 'erro interno' }))
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) }); const base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, tipo = 'application/json') => { const r = await fetch(base + rota, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': tipo }, body: JSON.stringify(corpo) }); return { status: r.status, j: await r.json() } }
  try {
    for (const rota of ['/api/cliente/notion/atualizar', '/api/notion/atualizar-todos']) assert.equal((await chama(rota, { cliente: 'Acme' }, 'text/plain')).status, 415)
    let g = await chama('/api/cliente/notion?cliente=Acme'); assert.deepEqual([g.status, Object.keys(g.j)], [200, ['cliente', 'pagina', 'informacoes', 'secoes', 'quem']])
    assert.equal((await chama('/api/cliente/notion')).status, 400)
    const pr = await chama('/api/cliente/notion?cliente=' + encodeURIComponent('[Comercial] Empresa X')); assert.equal(pr.status, 404); assert.ok(!JSON.stringify(pr.j).includes('Empresa'))
    assert.equal((await chama('/api/cliente/notion/atualizar', { cliente: 'Acme', por: 'x' })).status, 403)
    const a = await chama('/api/cliente/notion/atualizar', { cliente: 'Acme', por: 'Giovanna Torres' }); assert.deepEqual([a.status, a.j.estado, a.j.linhas], [200, 'ok', 1])
    g = await chama('/api/cliente/notion?cliente=Acme'); assert.equal(g.j.informacoes.length, 1)
    const p = await chama('/api/notion/atualizar-todos', { por: 'Giovanna Torres', confirmar: 'true' }); assert.equal(p.j.previa, true)
    const j = await chama('/api/notion/atualizar-todos', { por: 'Giovanna Torres', confirmar: true }); assert.ok(j.j.job)
    let s; const t = Date.now(); do { await new Promise(r => setTimeout(r, 5)); s = (await chama('/api/notion/job/' + j.j.job)).j } while (s.estado === 'rodando' && Date.now() - t < 3000)
    assert.equal(s.estado, 'concluido'); assert.equal((await chama('/api/notion/job/zzz')).status, 404)
  } finally { srv.close() }
})

console.log(`\n${n} caso(s) ok — notion do cliente`)
