// Autoteste das rotas HTTP das pendências do cliente (src/rotas-pendencias.js): o contrato de docs/contrato-pendencias-cliente.md num servidor efêmero com o
// núcleo REAL sobre banco :memory: e dependências stub — 415 sem JSON, 400/403/404 com mensagem fixa SEM eco, prospect "[Comercial]" rejeitado,
// `confirmar:"true"` = prévia, estado de negócio impeditivo = 200 com ok:false, erro interno = 500 genérico, fiação do server.js.
// Rodar: node scripts/teste-pendencias-rotas.mjs
import assert from 'node:assert/strict'
import express from 'express'
import { readFileSync } from 'node:fs'
import { criarRotasPendencias } from '../src/rotas-pendencias.js'
import { montar, tarefa, itemMl, baseMl, QUEM, norm, dia } from './fixtures/pendencias-mundo.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const CONTRATO = ['id', 'item', 'rotulo', 'canal', 'canal_rotulo', 'tipo', 'fonte', 'gravidade', 'gravidade_rotulo', 'desde', 'dias', 'evidencia', 'por_que_importa', 'efeito_se_atrasar', 'o_que_precisamos', 'o_que_fazemos', 'impacto', 'tarefas', 'registro_id']

async function servidor(opts = {}) {
  const m = montar({ base: baseMl([itemMl({ cobertura: 2 })]), tarefas: [tarefa({ processo: 'Amazon', tipo: 'documentos', tipo_rotulo: 'Documentos e validação da conta', dias: 20 })], ...opts })
  const canon = nome => ['Acme', 'Beta'].find(c => norm(c) === norm(nome)) || ''
  const app = express(); app.use(express.json())
  app.use(criarRotasPendencias({ pendencias: opts.pendencias || m.p, quem: () => QUEM, clienteCanonico: canon }))
  app.use((err, req, res, _next) => res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ erro: err?.type === 'entity.parse.failed' ? 'JSON inválido' : 'erro interno' }))   // papel do handler global do server
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, { tipo = 'application/json' } = {}) => {
    const init = corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
    const r = await fetch(base + rota, init); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* texto */ }
    return { status: r.status, j, t }
  }
  return { ...m, srv, chama, fim: () => srv.close() }
}
const eco = (r, ...ruins) => { const s = JSON.stringify(r.j) + r.t; for (const x of ruins) assert.ok(!s.includes(x), `eco de "${x}"`) }
const REG = { cliente: 'Acme', item: 'documentos_conta', canal: 'amazon', detalhe: 'Cartão vencido, falar com a Maria', desde: dia(-3) }

await ok('POST sem Content-Type JSON = 415 nas duas rotas de escrita (e nada acontece); JSON inválido = 400 genérico; corpo que não é objeto vira {}', async () => {
  const s = await servidor()
  try {
    for (const rota of ['/api/pendencias/registrar', '/api/pendencias/resolver']) {
      const r = await s.chama(rota, JSON.stringify(REG), { tipo: 'text/plain' }); assert.equal(r.status, 415, rota); assert.match(r.j.erro, /Content-Type: application\/json/)
    }
    assert.equal((await s.chama('/api/pendencias/registrar', '{nao é json')).status, 400)
    const arr = await s.chama('/api/pendencias/registrar', [1, 2]); assert.deepEqual([arr.status, arr.j.erro], [400, 'informe "cliente"'], 'array vira {}')
    assert.equal(s.handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n, 0)
  } finally { s.fim() }
})

await ok('GET /api/cliente/pendencias é a leitura INTERNA (paraCliente:false): vê a tarefa invisível ao cliente e a evidência com dias/origem da data aproximada, que o texto ao cliente nunca leva', async () => {
  const inv = tarefa({ processo: 'Shopee', tipo: 'custos', tipo_rotulo: 'Custos e preços', dias: 50, desde_origem: 'ultima_edicao' })
  const s = await servidor({ base: null, tarefas: [inv], invisiveis: [inv.id] })
  try {
    const r = await s.chama('/api/cliente/pendencias?cliente=Acme'); assert.equal(r.status, 200)
    assert.deepEqual(r.j.itens.map(p => [p.item, p.gravidade]), [['preco_custo', 'atencao']], 'a invisível aparece no Resumo (interno); data aproximada = atenção')
    assert.match(r.j.itens[0].evidencia, /50 dia\(s\); data aproximada pela última atualização da tarefa/); assert.deepEqual(r.j.tarefas.map(t => t.id), [inv.id])
    assert.deepEqual(s.p.avaliar('Acme').itens, [], 'o mesmo avaliador, para o cliente (padrão), não a vê')
  } finally { s.fim() }
})

await ok('GET /api/cliente/pendencias devolve o contrato (campos e ordem); prospect = 400 sem eco, desconhecido = 404, vazio = 400; query repetida vira texto', async () => {
  const s = await servidor()
  try {
    const r = await s.chama('/api/cliente/pendencias?cliente=acme'); assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.j), ['cliente', 'gerado_em', 'resumo', 'itens', 'tarefas']); assert.equal(r.j.cliente, 'Acme', 'nome canônico da central')
    assert.deepEqual(Object.keys(r.j.resumo), ['total', 'criticas', 'atencao', 'impacto']); assert.deepEqual([r.j.resumo.total, r.j.resumo.criticas, r.j.resumo.atencao], [2, 2, 0])
    assert.deepEqual(Object.keys(r.j.itens[0]).slice(0, CONTRATO.length), CONTRATO); assert.deepEqual(Object.keys(r.j.itens[0].impacto), ['tipo', 'valor_brl', 'rotulo', 'premissa'])
    assert.deepEqual(Object.keys(r.j.tarefas[0]).slice(0, 6), ['id', 'titulo', 'url', 'dias', 'canal', 'canal_rotulo']); assert.equal(r.j.tarefas[0].tipo_rotulo, 'Documentos e validação da conta')
    assert.deepEqual(r.j.itens.map(p => p.item), ['estoque_curva_a', 'documentos_conta'])
    assert.equal((await s.chama('/api/cliente/pendencias?cliente[]=Acme&cliente[]=Beta')).status, 200)
    assert.equal((await s.chama('/api/cliente/pendencias?cliente=Beta')).j.itens.length, 0, 'isolamento por cliente')
    const prosp = await s.chama('/api/cliente/pendencias?cliente=' + encodeURIComponent('[Comercial] Empresa X · 9')); assert.deepEqual([prosp.status, prosp.j.erro], [400, 'cliente inválido para pendências']); eco(prosp, 'Empresa X')
    const des = await s.chama('/api/cliente/pendencias?cliente=Fantasma%3Cb%3E'); assert.deepEqual([des.status, des.j.erro], [404, 'cliente não encontrado na central']); eco(des, 'Fantasma', '<b>')
    assert.deepEqual([(await s.chama('/api/cliente/pendencias')).status, (await s.chama('/api/cliente/pendencias?cliente=')).status], [400, 400])
  } finally { s.fim() }
})

await ok('GET /api/pendencias/catalogo: itens {id, rotulo, canais, tipo}, canais, gravidades e quem pode registrar', async () => {
  const s = await servidor()
  try {
    const r = await s.chama('/api/pendencias/catalogo'); assert.equal(r.status, 200)
    assert.deepEqual(['itens', 'canais', 'gravidades', 'quem'].filter(k => k in r.j), ['itens', 'canais', 'gravidades', 'quem'])
    assert.equal(r.j.itens.length, 16); assert.deepEqual(Object.keys(r.j.itens[0]).slice(0, 4), ['id', 'rotulo', 'canais', 'tipo']); assert.deepEqual(r.j.itens[0].canais, ['ml', 'shopee', 'amazon', 'tiktok', 'magalu'])
    assert.deepEqual(r.j.gravidades.map(g => g.rotulo), ['Crítico', 'Atenção', 'Informativo']); assert.deepEqual(r.j.canais.map(c => c.id), ['ml', 'shopee', 'amazon', 'tiktok', 'magalu', 'geral']); assert.deepEqual(r.j.quem, QUEM)
  } finally { s.fim() }
})

await ok('POST /registrar: prévia (200, nada gravado, com texto_cliente), `confirmar:"true"` e qualquer não-true = prévia, por obrigatório (400) e válido (403 sem eco), duplicado = 200 ok:false', async () => {
  const s = await servidor()
  try {
    const cnt = () => s.handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n
    let r = await s.chama('/api/pendencias/registrar', REG)
    assert.deepEqual([r.status, r.j.ok, r.j.previa, r.j.pendencia.fonte, r.j.pendencia.registro_id, r.j.pendencia.dias], [200, true, true, 'registro', null, 3]); assert.deepEqual(Object.keys(r.j.texto_cliente), ['rotulo', 'canal_rotulo', 'por_que_importa', 'efeito_se_atrasar', 'o_que_precisamos', 'o_que_fazemos'])
    for (const nao of ['true', 1, 'sim', null, [], {}]) { r = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: nao, por: 'Giovanna Torres' }); assert.equal(r.j.previa, true, JSON.stringify(nao)) }
    assert.equal(cnt(), 0)
    r = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: true }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem registra — líder ou consultor)'])
    r = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: true, por: 'Fulano de Tal' }); assert.deepEqual([r.status, r.j.erro], [403, 'somente líder ou consultor da central registra pendências do cliente']); eco(r, 'Fulano')
    r = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: true, por: 42 }); assert.equal(r.status, 400, 'por numérico não é nome')
    assert.equal(cnt(), 0)
    r = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: true, por: 'carla souza' }); assert.deepEqual([r.status, r.j.ok, typeof r.j.registro_id], [200, true, 'number'])
    assert.equal(cnt(), 1)
    const lista = await s.chama('/api/cliente/pendencias?cliente=Acme'); assert.ok(lista.j.itens.some(p => p.fonte === 'registro' && p.registro_id === r.j.registro_id))
    r = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: true, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.ok, r.j.motivo], [200, false, 'ja_registrada']); assert.equal(cnt(), 1)
  } finally { s.fim() }
})

await ok('POST /registrar: cliente (vazio, tipo errado, prospect, desconhecido) e campos inválidos = 4xx com mensagem fixa e SEM eco do valor recebido', async () => {
  const s = await servidor()
  try {
    const casos = [[{ cliente: '' }, 400, 'informe "cliente"'], [{ cliente: { a: 1 } }, 400, 'informe "cliente"'], [{ cliente: ['Acme'] }, 400, 'informe "cliente"'],
      [{ cliente: '[Comercial] Empresa Y · 3' }, 400, 'cliente inválido para pendências'], [{ cliente: 'Fantasma<script>' }, 404, 'cliente não encontrado na central'],
      [{ item: 'inventado<img onerror=1>' }, 400, 'item de pendência desconhecido — escolha um do catálogo'], [{ canal: 'olx' }, 400, 'canal não se aplica a este item — escolha um da lista'],
      [{ detalhe: 'ab' }, 400, 'descreva a pendência (de 3 a 300 caracteres)'], [{ desde: '2026-02-30' }, 400, 'data inválida (use AAAA-MM-DD, até hoje)'],
      [{ evidencia: 'javascript:alert(1)' }, 400, 'link inválido: use um endereço http(s) completo, sem espaços'], [{ gravidade: 'urgentissimo' }, 400, 'gravidade desconhecida — escolha crítico, atenção ou informativo']]
    for (const [mut, st, msg] of casos) { const r = await s.chama('/api/pendencias/registrar', { ...REG, ...mut }); assert.deepEqual([r.status, r.j.erro], [st, msg], JSON.stringify(mut)); eco(r, 'Empresa Y', 'Fantasma', 'script', 'inventado', 'onerror', 'olx', 'urgentissimo', 'javascript') }
    assert.equal(s.handle.prepare('SELECT COUNT(*) n FROM pendencia_cliente').get().n, 0)
  } finally { s.fim() }
})

await ok('POST /resolver: prévia, confirmar estrito, por válido (403), registro_id inválido (400), inexistente (404), já resolvida (200 ok:false), nota ≤ 300', async () => {
  const s = await servidor()
  try {
    const g = await s.chama('/api/pendencias/registrar', { ...REG, confirmar: true, por: 'Giovanna Torres' }); const id = g.j.registro_id
    const rs = c => s.chama('/api/pendencias/resolver', c)
    let r = await rs({ registro_id: id, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.ok, r.j.previa, r.j.registro.item, r.j.registro.rotulo], [200, true, true, 'documentos_conta', 'Documentos e validação da conta'])
    assert.equal((await rs({ registro_id: id, por: 'Carla Souza', confirmar: 'true' })).j.previa, true)
    assert.equal(s.handle.prepare("SELECT resolvida_em FROM pendencia_cliente").get().resolvida_em, '')
    r = await rs({ registro_id: id, confirmar: true }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem resolve — líder ou consultor)'])
    r = await rs({ registro_id: id, confirmar: true, por: 'Zé Ninguém' }); assert.deepEqual([r.status, r.j.erro], [403, 'somente líder ou consultor da central resolve pendências do cliente']); eco(r, 'Ninguém')
    for (const ruim of [undefined, 0, 'abc<b>', {}, -3]) { r = await rs({ registro_id: ruim, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "registro_id" (número da pendência registrada)']); eco(r, 'abc', '<b>') }
    r = await rs({ registro_id: 4242, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.erro], [404, 'pendência registrada não encontrada'])
    r = await rs({ registro_id: id, por: 'Carla Souza', nota: 'x'.repeat(301) }); assert.deepEqual([r.status, r.j.erro], [400, 'a nota pode ter até 300 caracteres'])
    r = await rs({ registro_id: String(id), por: 'Carla Souza', nota: 'Cartão atualizado', confirmar: true }); assert.deepEqual([r.status, r.j.ok, r.j.registro_id], [200, true, id])
    r = await rs({ registro_id: id, por: 'Carla Souza', confirmar: true }); assert.deepEqual([r.status, r.j.ok, r.j.motivo], [200, false, 'ja_resolvida'])
    assert.equal((await s.chama('/api/cliente/pendencias?cliente=Acme')).j.itens.some(p => p.fonte === 'registro'), false)
  } finally { s.fim() }
})

await ok('erro interno (falha sem status) = 500 genérico, sem vazar o detalhe', async () => {
  const quebrado = { avaliar: () => { throw new Error('SQLITE_BUSY: database is locked /Users/segredo/db.sqlite') }, catalogo: () => ({}), registrar: () => { throw new Error('boom segredo') }, resolver: () => ({}) }
  const s = await servidor({ pendencias: quebrado })
  try {
    const r = await s.chama('/api/cliente/pendencias?cliente=Acme'); assert.deepEqual([r.status, r.j.erro], [500, 'erro interno']); eco(r, 'SQLITE', 'segredo', '/Users')
    const w = await s.chama('/api/pendencias/registrar', REG); assert.deepEqual([w.status, w.j.erro], [500, 'erro interno']); eco(w, 'boom', 'segredo')
  } finally { s.fim() }
})

await ok('fiação: server.js monta as rotas DEPOIS do guardaLocal e antes do estático, com o avaliador real e o cliente canônico da central; o `desde` do risco chega ao painel; módulos puros', () => {
  const sv = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(sv, /import \{ criarRotasPendencias \} from '\.\/rotas-pendencias\.js'/); assert.match(sv, /import \{ pendenciasReal \} from '\.\/lib\/pendencias-cliente-real\.js'/)
  assert.match(sv, /app\.use\(criarRotasPendencias\(\{ pendencias: pendenciasReal\(\), quem: lideresEConsultores, clienteCanonico: clienteDaCentral \}\)\)/)
  assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasPendencias('), 'depois da guarda local (Origin de mutação)')
  assert.ok(sv.indexOf('app.use(criarRotasPendencias(') < sv.indexOf("app.use(express.static(join(ROOT, 'src', 'web')))"), 'antes do express.static')
  assert.ok(sv.indexOf("app.use(express.json({ limit: '1mb' }))") < sv.indexOf('app.use(criarRotasPendencias('), 'depois do express.json')
  // correção do painel executivo: o risco devolve `desde` e `dias` (antes só id/titulo/responsavel/prazo/url → "sem data de início registrada" sempre)
  assert.match(sv, /url: t\.url, desde: t\.desde \?\? null, dias: t\.desde \? Math\.max\(0, Math\.round\(\(Date\.parse\(hojeLocal\(\)\) - Date\.parse\(t\.desde\)\) \/ 86_400_000\)\) : null \}\)/)
  const rotas = readFileSync(new URL('../src/rotas-pendencias.js', import.meta.url), 'utf8')
  assert.ok(!/from '\.\.?\/(lib\/)?(db|notion)\.js'/.test(rotas), 'rotas puras: sem banco nem Notion')
})

console.log(`\n${n} verificações das rotas de pendências ok.`)
