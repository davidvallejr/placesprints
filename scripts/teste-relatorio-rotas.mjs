// Autoteste das rotas HTTP do relatório ao Notion (src/rotas-relatorio.js): o contrato de docs/contrato-relatorio-envio.md num servidor efêmero com o núcleo REAL
// sobre banco :memory: e stub do Notion — 415 sem JSON, 400/403/404 com mensagem fixa SEM eco, prospect "[Comercial]" rejeitado, `confirmar:"true"` = prévia,
// `origem` do corpo ignorada, estado de negócio impeditivo = 200 com ok:false, CSV com BOM, erro interno = 500 genérico.
// Rodar: node scripts/teste-relatorio-rotas.mjs
import assert from 'node:assert/strict'
import express from 'express'
import { readFileSync } from 'node:fs'
import { criarRotasRelatorio } from '../src/rotas-relatorio.js'
import { montarEnvio, QUEM, esperar, norm } from './fixtures/relatorio-mundo.mjs'
import { CATEGORIA } from '../src/lib/relatorio-seguro.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }

async function servidor(opts = {}) {
  const clientes = opts.clientes || [['Acme', {}], ['Beta', {}], ['SemBase', { base: false }]]
  const canon = nome => clientes.map(([c]) => c).find(c => norm(c) === norm(nome)) || ''           // como o server.js: resolve o nome na central, qualquer que seja o status
  const m = montarEnvio({ ...opts, clientes, clienteCanonico: canon })
  const app = express(); app.use(express.json())
  app.use(criarRotasRelatorio({ relatorios: m.e, quem: () => QUEM, clienteCanonico: canon }))
  app.use((err, req, res, _next) => res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ erro: err?.type === 'entity.parse.failed' ? 'JSON inválido' : 'erro interno' }))   // papel do handler global do server.js
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, { tipo = 'application/json', metodo } = {}) => {
    const init = corpo === undefined && !metodo ? {} : { method: metodo || 'POST', headers: { 'Content-Type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
    const r = await fetch(base + rota, init); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* csv */ }
    return { status: r.status, j, t, tipo: r.headers.get('content-type'), disp: r.headers.get('content-disposition') }
  }
  return { ...m, srv, chama, fim: () => srv.close() }
}
const POST_ROTAS = ['/api/relatorio/enviar', '/api/relatorio/lote', '/api/relatorio/anexar', '/api/relatorio/anexar-lote', '/api/relatorio/programacao', '/api/relatorio/frequencia-lote', '/api/relatorio/liberar', '/api/relatorio/diagnostico/verificar', '/api/relatorio/agendador']
const eco = (r, ...ruins) => { const s = JSON.stringify(r.j) + r.t; for (const x of ruins) assert.ok(!s.includes(x), `eco de "${x}"`) }

await ok('POST sem Content-Type JSON = 415 em TODAS as rotas de escrita (e nada acontece); JSON inválido = 400 genérico; corpo que não é objeto vira {}', async () => {
  const s = await servidor()
  try {
    for (const rota of POST_ROTAS) {
      const r = await s.chama(rota, '{"cliente":"Acme"}', { tipo: 'text/plain' }); assert.equal(r.status, 415, rota); assert.match(r.j.erro, /Content-Type: application\/json/)
    }
    assert.equal((await s.chama('/api/relatorio/enviar', '{nao é json', { tipo: 'application/json' })).status, 400)
    const arr = await s.chama('/api/relatorio/enviar', [1, 2]); assert.deepEqual([arr.status, arr.j.erro], [400, 'informe "cliente"'], 'array vira {}')
    assert.equal(s.w.chamadas.length, 0); assert.equal(s.h.prepare('SELECT COUNT(*) n FROM relatorio_envio').get().n, 0)
  } finally { s.fim() }
})

await ok('GET /clientes e /cliente?cliente= devolvem o contrato (campos exatos); prospect e desconhecido = 404, vazio = 400; query repetida vira texto', async () => {
  const s = await servidor()
  try {
    const l = await s.chama('/api/relatorio/clientes'); assert.equal(l.status, 200)
    assert.deepEqual(Object.keys(l.j).sort(), ['agendador', 'frequencias', 'itens', 'quem', 'resumo'])
    assert.deepEqual(Object.keys(l.j.itens[0]), ['cliente', 'frequencia', 'frequencia_rotulo', 'proximo_envio', 'ultimo_envio_em', 'ultimo_url', 'ultimo_estado', 'situacao', 'situacao_rotulo', 'motivo', 'liberado', 'pronto'])
    assert.deepEqual(Object.keys(l.j.resumo), ['total', 'prontos', 'liberados', 'pausados', 'sem_categoria', 'sem_base', 'nao_verificados'])
    assert.deepEqual([l.j.agendador, l.j.quem, l.j.frequencias.map(f => f.id), l.j.frequencias.map(f => f.rotulo)], [{ ligado: false }, QUEM, ['desligado', 'semanal', 'quinzenal', 'mensal'], ['Desligado', 'Semanal', 'Quinzenal', 'Mensal']])
    assert.deepEqual(l.j.itens.map(i => i.cliente), ['Acme', 'Beta', 'SemBase'])
    const c = await s.chama('/api/relatorio/cliente?cliente=Acme'); assert.equal(c.status, 200)
    assert.deepEqual(Object.keys(c.j), ['programacao', 'historico', 'diag', 'frequencias', 'quem']); assert.deepEqual(c.j.programacao.datas_previstas, [])
    assert.equal((await s.chama('/api/relatorio/cliente?cliente[]=Acme&cliente[]=Beta')).status, 200)
    const prosp = await s.chama('/api/relatorio/cliente?cliente=' + encodeURIComponent('[Comercial] Empresa X · 9')); assert.deepEqual([prosp.status, prosp.j.erro], [404, 'cliente não encontrado na central']); eco(prosp, 'Empresa X')
    const des = await s.chama('/api/relatorio/cliente?cliente=Fantasma%3Cb%3E'); assert.deepEqual([des.status, des.j.erro], [404, 'cliente não encontrado na central']); eco(des, 'Fantasma', '<b>')
    assert.deepEqual([(await s.chama('/api/relatorio/cliente')).status, (await s.chama('/api/relatorio/cliente?cliente=')).status], [400, 400])
  } finally { s.fim() }
})

await ok('POST /enviar: prévia (200), `confirmar:"true"` e qualquer não-true = prévia, confirmar exige previa_id e por válido (403), origem do corpo é ignorada, sucesso e reenvio', async () => {
  const s = await servidor()
  try {
    const e = (corpo) => s.chama('/api/relatorio/enviar', corpo)
    let r = await e({ cliente: 'Acme' }); assert.equal(r.status, 200); assert.deepEqual([r.j.ok, r.j.previa, r.j.acao, r.j.destino.estado, r.j.categoria.estado, r.j.primeiro_envio], [true, true, 'criar', 'ok', 'ok', true])
    for (const nao of ['true', 1, 'sim', null, [], {}]) { r = await e({ cliente: 'Acme', confirmar: nao, por: 'Giovanna Torres' }); assert.equal(r.j.previa, true, JSON.stringify(nao)) }
    assert.equal(s.w.criadas(), 0)
    const previa = (await e({ cliente: 'Acme' })).j
    r = await e({ cliente: 'Acme', confirmar: true, previa_id: previa.previa_id }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem está enviando — líder ou consultor)'])
    r = await e({ cliente: 'Acme', confirmar: true, por: 'Fulano de Tal', previa_id: previa.previa_id }); assert.deepEqual([r.status, r.j.erro], [403, 'somente líder ou consultor da central envia relatório ao cliente']); eco(r, 'Fulano')
    r = await e({ cliente: 'Acme', confirmar: true, por: 42, previa_id: previa.previa_id }); assert.equal(r.status, 400, 'por numérico não é nome'); r = await e({ cliente: 'Acme', confirmar: true, por: { nome: 'Carla Souza' }, previa_id: previa.previa_id }); assert.equal(r.status, 400)
    r = await e({ cliente: 'Acme', confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "previa_id" (gere a prévia antes de confirmar)'])
    r = await e({ cliente: 'Acme', confirmar: true, por: 'Giovanna Torres', previa_id: 'pv-0000' }); assert.deepEqual([r.status, r.j.erro], [409, 'prévia expirada — gere de novo'])
    r = await e({ cliente: 'Beta', confirmar: true, por: 'Giovanna Torres', previa_id: previa.previa_id }); assert.equal(r.status, 409, 'a prévia é de outro cliente')
    r = await e({ cliente: 'Acme', origem: 'agendado', confirmar: true, por: 'Giovanna Torres' }); assert.equal(r.status, 400, 'origem agendado no corpo não pula a prévia'); assert.equal(s.w.criadas(), 0)
    r = await e({ cliente: 'Acme', origem: 'lote', substituir: 'sim', confirmar: true, por: 'Giovanna Torres', previa_id: previa.previa_id })
    assert.deepEqual([r.status, r.j.ok, r.j.previa, r.j.estado, r.j.categoria, r.j.proximo_envio], [200, true, false, 'enviado', 'aplicada', '']); assert.match(r.j.url, /^https:\/\/www\.notion\.so\//); assert.equal(s.w.criadas(), 1)
    assert.equal(s.h.prepare('SELECT origem FROM relatorio_envio').get().origem, 'manual')
    const p2 = (await e({ cliente: 'Acme' })).j; assert.deepEqual([p2.acao, p2.ja_enviado.url], ['pular', r.j.url])
    r = await e({ cliente: 'Acme', confirmar: true, por: 'carla souza', previa_id: p2.previa_id }); assert.deepEqual([r.j.ok, r.j.estado], [true, 'ja_enviado']); assert.equal(s.w.criadas(), 1)
    // estado de negócio impeditivo = 200 com ok:false
    const pb = (await e({ cliente: 'SemBase' })).j; assert.deepEqual([pb.acao, pb.bloqueio.estado], ['bloqueado', 'sem_base'])
    r = await e({ cliente: 'SemBase', confirmar: true, por: 'Giovanna Torres', previa_id: pb.previa_id }); assert.deepEqual([r.status, r.j.ok, r.j.estado], [200, false, 'sem_base']); assert.match(r.j.mensagem, /ainda não tem a base «Informações»/)
    // cliente: tipo errado, vazio, prospect, desconhecido
    for (const [corpo, st, msg] of [[{}, 400, 'informe "cliente"'], [{ cliente: '' }, 400, 'informe "cliente"'], [{ cliente: { a: 1 } }, 400, 'informe "cliente"'], [{ cliente: ['Acme'] }, 400, 'informe "cliente"'], [{ cliente: '[Comercial] Empresa Y · 3' }, 404, 'cliente não encontrado na central'], [{ cliente: 'Zzz<script>' }, 404, 'cliente não encontrado na central']]) {
      r = await e(corpo); assert.deepEqual([r.status, r.j.erro], [st, msg], JSON.stringify(corpo)); eco(r, 'Empresa Y', 'Zzz', 'script')
    }
  } finally { s.fim() }
})

await ok('POST /programacao, /frequencia-lote e /liberar: prévia por padrão, confirmar estrito, por líder/consultor (403), prospect rejeitado, mensagens fixas', async () => {
  const s = await servidor()
  try {
    const pg = c => s.chama('/api/relatorio/programacao', c)
    let r = await pg({ cliente: 'Acme', frequencia: 'semanal' }); assert.deepEqual([r.status, r.j.ok, r.j.previa, r.j.datas_previstas, r.j.diag], [200, true, true, ['2026-10-23', '2026-10-30', '2026-11-06'], null]); assert.ok(Array.isArray(r.j.avisos))
    assert.equal((await pg({ cliente: 'Acme', frequencia: 'semanal', confirmar: 'true', por: 'Giovanna Torres' })).j.previa, true)
    assert.equal(s.h.prepare('SELECT COUNT(*) n FROM relatorio_programacao').get().n, 0)
    r = await pg({ cliente: 'Acme', frequencia: 'diaria' }); assert.deepEqual([r.status, r.j.erro], [400, 'frequência desconhecida — escolha desligado, semanal, quinzenal ou mensal']); eco(r, 'diaria')
    r = await pg({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-02-30' }); assert.deepEqual([r.status, r.j.erro], [400, 'data inválida (use AAAA-MM-DD, entre hoje e 60 dias)']); eco(r, '02-30')
    // proximo_envio que não é texto (número, objeto, lista, null, booleano) NÃO é ignorado em silêncio: 400 com a mensagem fixa e nada é gravado; ausente = data padrão
    for (const ruim of [20261016, {}, [], null, false, true, 0]) { r = await pg({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: ruim }); assert.deepEqual([r.status, r.j.erro], [400, 'data inválida (use AAAA-MM-DD, entre hoje e 60 dias)'], JSON.stringify(ruim)); eco(r, '20261016') }
    r = await pg({ cliente: 'Acme', frequencia: 'semanal', proximo_envio: '2026-10-17' }); assert.deepEqual([r.status, r.j.datas_previstas[0]], [200, '2026-10-17'])
    r = await pg({ cliente: 'Acme', frequencia: 'semanal' }); assert.deepEqual([r.status, r.j.datas_previstas[0]], [200, '2026-10-23'], 'ausente = próxima sexta')
    r = await pg({ cliente: 'Fantasma', frequencia: 'semanal', proximo_envio: 20261016 }); assert.equal(r.status, 404, 'cliente desconhecido vem antes da data')
    r = await pg({ cliente: 'Acme', frequencia: 'semanal', confirmar: true }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem está enviando — líder ou consultor)'])
    r = await pg({ cliente: 'Acme', frequencia: 'semanal', confirmar: true, por: 'Fulano' }); assert.deepEqual([r.status], [403]); eco(r, 'Fulano')
    r = await pg({ cliente: '[Comercial] Empresa Y · 3', frequencia: 'semanal' }); assert.deepEqual([r.status, r.j.erro], [404, 'cliente não encontrado na central'])
    r = await pg({ cliente: 'Acme', frequencia: 'mensal', proximo_envio: '2026-10-31', confirmar: true, por: 'Carla Souza' })
    assert.deepEqual([r.status, r.j.ok, r.j.programacao.frequencia, r.j.programacao.proximo_envio, r.j.programacao.situacao, r.j.programacao.datas_previstas], [200, true, 'mensal', '2026-10-31', 'nao_liberado', ['2026-10-31', '2026-11-30', '2026-12-31']])
    // frequencia-lote
    const fl = c => s.chama('/api/relatorio/frequencia-lote', c)
    r = await fl({ clientes: ['Acme', 'Beta', '[Comercial] Z · 1', 'Fantasma'], frequencia: 'semanal' }); assert.deepEqual([r.status, r.j.previa, r.j.mudam, r.j.itens.map(i => i.cliente)], [200, true, 2, ['Acme', 'Beta']]); eco(r, 'Comercial', 'Fantasma')
    r = await fl({ clientes: ['Acme'], frequencia: 'semanal', confirmar: true, por: 'Fulano' }); assert.equal(r.status, 403)
    r = await fl({ clientes: ['Acme', 'Beta'], frequencia: 'semanal', confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r.status, r.j], [200, { ok: true, alterados: 2 }])
    r = await fl({ clientes: 'Acme', frequencia: 'semanal' }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "clientes" (1 a 100)'])
    r = await fl({ clientes: Array.from({ length: 101 }, (_, i) => 'c' + i), frequencia: 'semanal' }); assert.deepEqual([r.status, r.j.erro], [400, 'máximo de 100 clientes por vez'])
    // liberar (sem diagnóstico ninguém é liberado)
    const lb = c => s.chama('/api/relatorio/liberar', c)
    r = await lb({}); assert.deepEqual([r.status, r.j.previa, r.j.liberaria], [200, true, []]); assert.deepEqual(r.j.ignorados.map(i => i.motivo), ['base ainda não verificada', 'base ainda não verificada'])
    s.estado.set('rel_diag:Acme', JSON.stringify({ cliente: 'Acme', em: s.relogio.agora(), pronto: true, proxima_acao: '' }))
    r = await lb({ clientes: ['Acme', '[Comercial] Z · 1'] }); assert.deepEqual([r.j.liberaria, r.j.ignorados.map(i => i.cliente)], [['Acme'], ['']]); eco(r, 'Comercial')
    r = await lb({ confirmar: true, por: 'Dani Nunes' }); assert.equal(r.status, 403); r = await lb({ confirmar: 'true', por: 'Giovanna Torres' }); assert.equal(r.j.previa, true)
    r = await lb({ confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r.status, r.j], [200, { ok: true, liberados: 1 }])
    assert.equal(s.h.prepare("SELECT ativado_por FROM relatorio_programacao WHERE cliente = 'Acme'").get().ativado_por, 'Giovanna Torres')
  } finally { s.fim() }
})

await ok('POST /lote e GET /job/:id: prévia por cliente, máx. 40, confirmar → { ok, job:{id} }, job concluído com itens e resumo; 404 para job inexistente', async () => {
  const s = await servidor()
  try {
    s.h.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, por, em) VALUES ('Acme', '2026-10-02', '2026-10-08', 'manual', 'enviado', 'https://www.notion.so/x', 'x', 'y')").run()
    const lt = c => s.chama('/api/relatorio/lote', c)
    let r = await lt({ clientes: ['Acme', 'Beta', '[Comercial] Z · 1'] }); assert.equal(r.status, 200)
    assert.deepEqual(r.j.itens.map(i => [i.cliente, i.acao]), [['', 'ignorado'], ['Acme', 'enviar'], ['Beta', 'precisa_previa']]); eco(r, 'Comercial'); assert.equal(s.bf.chamadas, 0); assert.equal(s.w.chamadas.length, 0)
    r = await lt({ clientes: Array.from({ length: 41 }, (_, i) => 'c' + i) }); assert.deepEqual([r.status, r.j.erro], [400, 'máximo de 40 clientes por vez'])
    r = await lt({ clientes: 'Acme' }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "clientes" (1 a 40)'])
    r = await lt({ clientes: ['Acme'], confirmar: true, por: 'Fulano' }); assert.equal(r.status, 403)
    r = await lt({ clientes: ['Acme'], confirmar: 'true', por: 'Giovanna Torres' }); assert.equal(r.j.previa, true, 'string "true" = prévia'); assert.equal(s.w.criadas(), 0)
    r = await lt({ clientes: ['Acme'], confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r.status, r.j.ok, Object.keys(r.j.job)], [200, true, ['id']])
    const id = r.j.job.id; await esperar(() => s.e.jobDe(id).estado !== 'rodando')
    const j = await s.chama('/api/relatorio/job/' + id); assert.equal(j.status, 200); assert.deepEqual(Object.keys(j.j), ['id', 'tipo', 'estado', 'total', 'feitos', 'itens', 'resumo'])
    assert.deepEqual([j.j.estado, j.j.total, j.j.feitos, j.j.itens.map(i => [i.cliente, i.estado]), j.j.resumo], ['concluido', 1, 1, [['Acme', 'enviado']], '1 enviados']); assert.match(j.j.itens[0].url, /notion\.so/)
    const nf = await s.chama('/api/relatorio/job/nao-existe<x>'); assert.deepEqual([nf.status, nf.j.erro], [404, 'job não encontrado']); eco(nf, '<x>')
    r = await lt({ clientes: ['Beta'], confirmar: true, por: 'Giovanna Torres' }); assert.deepEqual([r.j.ok, r.j.estado], [false, 'nada_a_enviar'])
  } finally { s.fim() }
})

await ok('diagnóstico: POST /diagnostico/verificar → { ok, job }, GET /diagnostico (itens + resumo), GET /diagnostico.csv (BOM, ";", attachment)', async () => {
  const s = await servidor()
  try {
    let r = await s.chama('/api/relatorio/diagnostico'); assert.equal(r.status, 200); assert.deepEqual(r.j.resumo, { prontos: 0, opcao_ausente: 0, sem_base: 0, sem_pagina: 0, nao_verificados: 3 })
    r = await s.chama('/api/relatorio/diagnostico/verificar', {}); assert.deepEqual([r.status, r.j.ok, Object.keys(r.j.job)], [200, true, ['id']])
    const id = r.j.job.id
    await esperar(() => s.e.jobDe(id).estado !== 'rodando')
    r = await s.chama('/api/relatorio/diagnostico'); assert.deepEqual(r.j.resumo, { prontos: 2, opcao_ausente: 0, sem_base: 1, sem_pagina: 0, nao_verificados: 0 })
    assert.deepEqual(Object.keys(r.j.itens[0]), ['cliente', 'em', 'pagina', 'informacoes', 'secao_tipo', 'categoria', 'destino', 'perfil', 'ml_conectado', 'pronto', 'proxima_acao'])
    const csv = await s.chama('/api/relatorio/diagnostico.csv'); assert.equal(csv.status, 200); assert.match(csv.tipo, /^text\/csv; charset=utf-8/); assert.match(csv.disp, /attachment; filename="diagnostico-relatorios\.csv"/)
    const bytes = Buffer.from(await (await fetch(s.srv.address() && `http://127.0.0.1:${s.srv.address().port}/api/relatorio/diagnostico.csv`)).arrayBuffer())
    assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM UTF-8 nos bytes (fetch.text() o engole)'); assert.ok(csv.t.startsWith('"cliente";"pagina";'), 'separador ;'); assert.equal(csv.t.split('\r\n').length, 4)
    assert.equal(s.w.criadas(), 0)
  } finally { s.fim() }
})

await ok('GET|POST /agendador: nasce desligado; ligar exige "ligado" booleano e líder/consultor; vale na hora (freio de emergência sem reiniciar)', async () => {
  const s = await servidor()
  try {
    assert.deepEqual((await s.chama('/api/relatorio/agendador')).j, { ligado: false })
    let r = await s.chama('/api/relatorio/agendador', { ligado: true }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem está enviando — líder ou consultor)'])
    r = await s.chama('/api/relatorio/agendador', { ligado: true, por: 'Fulano' }); assert.equal(r.status, 403)
    for (const ruim of ['true', 1, null]) { r = await s.chama('/api/relatorio/agendador', { ligado: ruim, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "ligado" (verdadeiro ou falso)'], JSON.stringify(ruim)) }
    assert.deepEqual((await s.chama('/api/relatorio/agendador')).j, { ligado: false })
    r = await s.chama('/api/relatorio/agendador', { ligado: true, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j], [200, { ok: true, ligado: true }]); assert.deepEqual((await s.chama('/api/relatorio/agendador')).j, { ligado: true })
    r = await s.chama('/api/relatorio/agendador', { ligado: false, por: 'Giovanna Torres' }); assert.deepEqual(r.j, { ok: true, ligado: false })
    assert.deepEqual((await s.chama('/api/relatorio/clientes')).j.agendador, { ligado: false })
  } finally { s.fim() }
})

await ok('erro interno sem status (ex.: SQLITE_BUSY) vai ao handler global (500 "erro interno"), nunca a mensagem crua; erro com status mantém a mensagem fixa', async () => {
  const s = await servidor()
  try {
    const app = express(); app.use(express.json())
    app.use(criarRotasRelatorio({ relatorios: { ...s.e, listar: () => { throw new Error('SQLITE_BUSY: database is locked') }, programar: () => { throw Object.assign(new Error('mensagem fixa'), { status: 400 }) } }, quem: () => QUEM }))
    app.use((err, req, res, _next) => res.status(500).json({ erro: 'erro interno' }))
    const srv = await new Promise(res => { const x = app.listen(0, '127.0.0.1', () => res(x)) }), base = `http://127.0.0.1:${srv.address().port}`
    try {
      const g = await fetch(base + '/api/relatorio/clientes'); assert.equal(g.status, 500); assert.deepEqual(await g.json(), { erro: 'erro interno' })
      const p = await fetch(base + '/api/relatorio/programacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente: 'Acme', frequencia: 'semanal' }) })
      assert.equal(p.status, 400); assert.equal((await p.json()).erro, 'mensagem fixa')
    } finally { srv.close() }
  } finally { s.fim() }
})

await ok('liberar e diagnosticar: só `clientes` AUSENTE vale "todos" (null, [] e não-lista = 400); cliente Congelado/sem status = 200 com ok:false cliente_inelegivel em /enviar e /programacao (desligar continua valendo), sem eco', async () => {
  const s = await servidor({ clientes: [['Acme', {}], ['Frio', {}], ['Sem', {}]], elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }, { cliente: 'Frio', status: 'Congelado' }, { cliente: 'Sem', status: '' }] })
  try {
    for (const rota of ['/api/relatorio/liberar', '/api/relatorio/diagnostico/verificar']) {
      for (const ruim of [null, [], 'Acme', 7, {}]) { const r = await s.chama(rota, { clientes: ruim, por: 'Giovanna Torres', confirmar: true }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "clientes" (1 a 500)'], `${rota} ${JSON.stringify(ruim)}`); eco(r, 'Acme') }
    }
    assert.equal((await s.chama('/api/relatorio/liberar', { por: 'Giovanna Torres' })).status, 200, 'ausente = todos')
    assert.equal(s.h.prepare('SELECT COUNT(*) n FROM relatorio_programacao').get().n, 0)
    const MSG = 'só clientes Ativos recebem relatório; mude o status na central'
    for (const c of ['Frio', 'Sem']) {
      let r = await s.chama('/api/relatorio/enviar', { cliente: c, por: 'Giovanna Torres' }); assert.deepEqual([r.status, r.j.ok, r.j.estado, r.j.mensagem], [200, false, 'cliente_inelegivel', MSG], 'prévia')
      r = await s.chama('/api/relatorio/enviar', { cliente: c, por: 'Giovanna Torres', confirmar: true, previa_id: 'pv-x' }); assert.deepEqual([r.status, r.j.ok, r.j.estado], [200, false, 'cliente_inelegivel'], 'confirmar')
      r = await s.chama('/api/relatorio/programacao', { cliente: c, frequencia: 'semanal', por: 'Giovanna Torres', confirmar: true }); assert.deepEqual([r.status, r.j.ok, r.j.estado, r.j.mensagem], [200, false, 'cliente_inelegivel', MSG])
      r = await s.chama('/api/relatorio/programacao', { cliente: c, frequencia: 'desligado', por: 'Giovanna Torres', confirmar: true }); assert.deepEqual([r.status, r.j.ok], [200, true], 'desligar sempre pode')
    }
    assert.equal(s.w.chamadas.length, 0, 'nenhuma chamada ao Notion'); assert.equal(s.h.prepare('SELECT COUNT(*) n FROM relatorio_envio').get().n, 0)
    const lt = await s.chama('/api/relatorio/lote', { clientes: ['Frio'] }); assert.deepEqual([lt.j.itens[0].acao, lt.j.itens[0].motivo], ['bloqueado', MSG])
  } finally { s.fim() }
})

await ok('fiação: server.js monta as rotas DEPOIS do guardaLocal, cria o núcleo com handle db e briefReal, liga o timer de 10 min e não mexe nas linhas fixadas pelo teste de dependência', () => {
  const sv = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasRelatorio('), 'rotas do relatório depois da guarda local')
  assert.match(sv, /import \{ briefReal, nomesInternos as nomesInternosRelatorio \} from '\.\/lib\/relatorio-brief-real\.js'/)
  assert.match(sv, /criarRelatorioEnvio\(\{ handle: db, notion: \{ req: notionReq \}, brief: briefReal, nomesInternos: nomesInternosRelatorio,/)
  assert.match(sv, /destinos: \{ fontes: descobrirFontes, resolverPaginaCliente, acharInformacoesDb, invalidar: invalidarCliente \}/)
  assert.match(sv, /validarPor: validarLiderOuConsultor, notificar, log: \(n, m\) => logS\('morpheus', n, m\), elegiveis: \(\) => clientesElegiveis\(\)\.elegiveis/)
  assert.match(sv, /setInterval\(\(\) => Promise\.resolve\(\)\.then\(\(\) => relatorios\.tick\(\)\)\.catch\(e => logS\('morpheus', 'erro', `agendador de relatórios: \$\{sanitizarErp\(e\?\.message\)\}`\)\), 10 \* 60 \* 1000\)/)
  assert.match(sv, /criarDependencias\(\{ handle: db, notion: \{ req: notionReq \}, agora, hoje: hojeLocal, validarPor: validarLiderOuConsultor, mapeamento,/)
  assert.ok(sv.indexOf('app.use(criarRotasRelatorio(') < sv.indexOf("app.use(express.static(join(ROOT, 'src', 'web')))"), 'antes do express.static (as rotas /api não caem no estático)')
  const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8')
  assert.match(db, /import \{ SCHEMA_RELATORIO \} from '\.\/relatorio-envio\.js'/); assert.match(db, /db\.exec\(SCHEMA_RELATORIO\)/)
  // módulos puros: nenhum importa o banco nem o cliente real do Notion
  for (const f of ['relatorio-seguro.js', 'relatorio-notion.js', 'relatorio-envio.js']) { const src = readFileSync(new URL('../src/lib/' + f, import.meta.url), 'utf8'); assert.ok(!/from '\.\/(db|notion|equipe|plano-informacoes)\.js'/.test(src), f + ' não importa banco/Notion') }
  assert.ok(!/from '\.\.?\/(lib\/)?(db|notion)\.js'/.test(readFileSync(new URL('../src/rotas-relatorio.js', import.meta.url), 'utf8')))
  assert.ok(CATEGORIA === 'Relatório de Sprints Place2u')
})

await ok('POST /anexar e /anexar-lote: prévia por padrão (confirmar:"true" = prévia), por validado (403), cliente/datas validados sem eco, confirmar anexa e o lote vira job acompanhável', async () => {
  const s = await servidor()
  try {
    s.w.falhas.pdf.push('pdf_falhou')
    const p = await s.chama('/api/relatorio/enviar', { cliente: 'Acme', por: 'Giovanna Torres' })
    const e = await s.chama('/api/relatorio/enviar', { cliente: 'Acme', por: 'Giovanna Torres', confirmar: true, previa_id: p.j.previa_id })
    assert.deepEqual([e.status, e.j.estado, e.j.anexo], [200, 'enviado', 'falhou:pdf_falhou'])
    const corpo = { cliente: 'Acme', de: '2026-10-09', ate: '2026-10-15', por: 'Giovanna Torres' }
    const pv = await s.chama('/api/relatorio/anexar', { ...corpo, confirmar: 'true' }); assert.deepEqual([pv.status, pv.j.previa, pv.j.faria, pv.j.anexo_atual], [200, true, 'anexar', 'falhou:pdf_falhou'])
    assert.equal(s.w.uploads.length, 0)
    const f = await s.chama('/api/relatorio/anexar', { ...corpo, por: 'Fulano<x>', confirmar: true }); assert.equal(f.status, 403); eco(f, 'Fulano', '<x>')
    const d = await s.chama('/api/relatorio/anexar', { ...corpo, de: '2026-13-99<i>', confirmar: true }); assert.equal(d.status, 400); eco(d, '13-99', '<i>')
    assert.equal((await s.chama('/api/relatorio/anexar', { ...corpo, cliente: '[Comercial] X · 1', confirmar: true })).status, 404)
    assert.equal((await s.chama('/api/relatorio/anexar', { ...corpo, de: { a: 1 }, confirmar: true })).status, 400, 'objeto no lugar de texto')
    const ok1 = await s.chama('/api/relatorio/anexar', { ...corpo, confirmar: true }); assert.deepEqual([ok1.status, ok1.j.ok, ok1.j.estado, ok1.j.anexo], [200, true, 'anexado', 'ok']); assert.equal(s.w.uploads.length, 1)
    const nada = await s.chama('/api/relatorio/anexar', { ...corpo, cliente: 'Beta', confirmar: true }); assert.deepEqual([nada.status, nada.j.ok, nada.j.estado], [200, false, 'sem_envio'])
    // lote
    assert.equal((await s.chama('/api/relatorio/anexar-lote', { por: 'Giovanna Torres' })).status, 400, 'desde obrigatório')
    const lp = await s.chama('/api/relatorio/anexar-lote', { desde: '2026-10-01', por: 'Giovanna Torres' }); assert.deepEqual([lp.status, lp.j.previa, lp.j.itens], [200, true, []])
    s.w.falhas.pdf.push('pdf_falhou')
    const p2 = await s.chama('/api/relatorio/enviar', { cliente: 'Beta', por: 'Giovanna Torres' }); await s.chama('/api/relatorio/enviar', { cliente: 'Beta', por: 'Giovanna Torres', confirmar: true, previa_id: p2.j.previa_id })
    const lp2 = await s.chama('/api/relatorio/anexar-lote', { desde: '2026-10-01', por: 'Giovanna Torres' }); assert.deepEqual(lp2.j.itens.map(i => i.cliente), ['Beta'])
    const lc = await s.chama('/api/relatorio/anexar-lote', { desde: '2026-10-01', por: 'Giovanna Torres', confirmar: true }); assert.equal(lc.status, 200); assert.equal(lc.j.job.tipo, 'anexar')
    await esperar(() => s.e.jobDe(lc.j.job.id).estado !== 'rodando')
    const j = await s.chama('/api/relatorio/job/' + lc.j.job.id); assert.deepEqual(j.j.itens.map(i => [i.cliente, i.estado]), [['Beta', 'anexado']]); assert.equal(j.j.resumo, '1 anexados · 0 com problema')
    assert.equal((await s.chama('/api/relatorio/anexar-lote', { desde: '2026-10-01', por: 'Giovanna Torres', confirmar: true })).j.estado, 'nada_a_anexar')
  } finally { s.fim() }
})

console.log(`\n${n} verificações das rotas ok.`)
