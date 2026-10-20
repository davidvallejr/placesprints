// Autoteste das rotas HTTP do alerta de pendência crítica ao cliente (src/rotas-alertas.js, prefixo /api/alertas): o contrato num servidor efêmero com o núcleo REAL
// (src/lib/alerta-cliente.js) sobre banco :memory:, avaliador real de pendências com dependências stub e stub do Notion — 415 sem JSON, 400/403/404 com mensagem fixa SEM eco,
// prospect "[Comercial]" rejeitado, `confirmar:"true"` = prévia, estado de negócio impeditivo = 200 com ok:false, erro interno = 500 genérico, e a fiação do server.js.
// Rodar: node scripts/teste-alerta-rotas.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
import { readFileSync } from 'node:fs'
import { criarRotasAlertas } from '../src/rotas-alertas.js'
import { montarAlerta, QUEM, norm } from './fixtures/alerta-mundo.mjs'
import { PREFIXO_ALERTA } from '../src/lib/relatorio-notion.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }

async function servidor(opts = {}) {
  const clientes = opts.clientes || [['Acme', {}], ['Beta', {}]]
  const m = montarAlerta({ ...opts, clientes })
  const canon = nome => clientes.map(([c]) => c).find(c => norm(c) === norm(nome)) || ''
  const app = express(); app.use(express.json())
  app.use(criarRotasAlertas({ alertas: opts.alertas || m.e, quem: () => QUEM, clienteCanonico: canon }))
  app.use((err, req, res, _next) => res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ erro: err?.type === 'entity.parse.failed' ? 'JSON inválido' : 'erro interno' }))   // papel do handler global do server.js
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, { tipo = 'application/json', metodo } = {}) => {
    const init = corpo === undefined && !metodo ? {} : { method: metodo || 'POST', headers: { 'Content-Type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }
    const r = await fetch(base + rota, init); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch { /* texto */ }
    return { status: r.status, j, t }
  }
  return { ...m, srv, chama, fim: () => srv.close() }
}
const eco = (r, ...ruins) => { const s = JSON.stringify(r.j) + r.t; for (const x of ruins) assert.ok(!s.includes(x), `eco de "${x}"`) }
const por = 'Giovanna Torres'
// Acme com estoque crítico detectado (interruptor desligado: o alerta fica pendente) e apto ao envio manual; Beta sem pendência
const comAlerta = async () => { const s = await servidor(); s.estoque('Acme'); s.pronto('Acme'); await s.e.varrer(); return s }

await ok('POST sem Content-Type JSON = 415 nas rotas de escrita (e nada acontece); JSON inválido = 400 genérico; corpo que não é objeto vira {}', async () => {
  const s = await comAlerta()
  try {
    for (const rota of ['/api/alertas/enviar', '/api/alertas/agendador']) { const r = await s.chama(rota, '{"id":1}', { tipo: 'text/plain' }); assert.equal(r.status, 415, rota); assert.match(r.j.erro, /Content-Type: application\/json/) }
    assert.equal((await s.chama('/api/alertas/enviar', '{nao é json')).status, 400)
    const arr = await s.chama('/api/alertas/enviar', [1, 2]); assert.deepEqual([arr.status, arr.j.erro], [400, 'informe "id" (número do alerta)'], 'array vira {}')
    assert.equal(s.w.chamadas.length, 0); assert.equal(s.e.agendadorEstado().ligado, false)
  } finally { s.fim() }
})

await ok('GET /cliente e /pendentes devolvem o contrato (campos exatos, isolamento); prospect e desconhecido = 404 sem eco, vazio = 400; query repetida vira texto', async () => {
  const s = await comAlerta()
  try {
    const c = await s.chama('/api/alertas/cliente?cliente=Acme'); assert.equal(c.status, 200)
    assert.deepEqual(Object.keys(c.j), ['itens', 'automatico', 'quem']); assert.deepEqual([c.j.automatico, c.j.quem, c.j.itens.length], [{ ligado: false }, QUEM, 1])
    assert.deepEqual(Object.keys(c.j.itens[0]), ['id', 'item', 'rotulo', 'canal', 'canal_rotulo', 'gravidade', 'estado', 'motivo', 'motivo_codigo', 'titulo', 'page_url', 'criado_em', 'enviado_em', 'resolvido_em', 'assinatura'])
    assert.deepEqual([c.j.itens[0].estado, c.j.itens[0].motivo_codigo, c.j.itens[0].rotulo], ['pendente', 'interruptor_desligado', 'Estoque dos produtos que mais vendem']); assert.match(c.j.itens[0].motivo, /desligado/)
    assert.deepEqual((await s.chama('/api/alertas/cliente?cliente=beta')).j.itens, [], 'outro cliente: nada do Acme')
    assert.equal((await s.chama('/api/alertas/cliente?cliente[]=Acme&cliente[]=Beta')).status, 200)
    const p = await s.chama('/api/alertas/pendentes'); assert.equal(p.status, 200); assert.deepEqual(Object.keys(p.j), ['itens', 'automatico', 'resumo', 'quem'])
    assert.deepEqual(p.j.resumo, { pendentes: 1, enviados_7d: 0, bloqueados: 0 }); assert.deepEqual(Object.keys(p.j.itens[0]).slice(0, 3), ['cliente', 'id', 'item']); assert.equal(p.j.itens[0].cliente, 'Acme')
    const prosp = await s.chama('/api/alertas/cliente?cliente=' + encodeURIComponent('[Comercial] Empresa X · 9')); assert.deepEqual([prosp.status, prosp.j.erro], [404, 'cliente não encontrado na central']); eco(prosp, 'Empresa X')
    const des = await s.chama('/api/alertas/cliente?cliente=Fantasma%3Cb%3E'); assert.deepEqual([des.status, des.j.erro], [404, 'cliente não encontrado na central']); eco(des, 'Fantasma', '<b>')
    assert.deepEqual([(await s.chama('/api/alertas/cliente')).status, (await s.chama('/api/alertas/cliente?cliente=')).status], [400, 400])
  } finally { s.fim() }
})

await ok('POST /enviar: prévia (200), `confirmar:"true"` e qualquer não-true = prévia, confirmar exige por válido (403) e previa_id, id inválido = 400, inexistente = 404 sem eco; sucesso e reenvio', async () => {
  const s = await comAlerta()
  try {
    const e = corpo => s.chama('/api/alertas/enviar', corpo)
    let r = await e({ id: 1 }); assert.equal(r.status, 200)
    assert.deepEqual([r.j.ok, r.j.previa, r.j.acao, r.j.destino.estado, r.j.violacoes, r.j.avisos], [true, true, 'criar', 'ok', [], []]); assert.equal(r.j.titulo, `${PREFIXO_ALERTA}Estoque dos produtos que mais vendem (Mercado Livre) · 14/10/2026`)
    assert.deepEqual(Object.keys(r.j), ['ok', 'previa', 'previa_id', 'titulo', 'destino', 'acao', 'bloqueio', 'linhas', 'violacoes', 'avisos', 'expira_em']); assert.deepEqual(Object.keys(r.j.destino), ['estado', 'pagina_titulo', 'informacoes_url'])
    for (const nao of ['true', 1, 'sim', null, [], {}]) { r = await e({ id: 1, confirmar: nao, por }); assert.equal(r.j.previa, true, JSON.stringify(nao)) }
    assert.equal((await e({ id: '1' })).j.previa, true, 'id em texto numérico vale')
    assert.equal(s.w.criadas(), 0)
    const pv = (await e({ id: 1 })).j
    r = await e({ id: 1, confirmar: true, previa_id: pv.previa_id }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem está enviando — líder ou consultor)'])
    r = await e({ id: 1, confirmar: true, por: 'Fulano de Tal', previa_id: pv.previa_id }); assert.deepEqual([r.status, r.j.erro], [403, 'somente líder ou consultor da central envia alerta ao cliente']); eco(r, 'Fulano')
    r = await e({ id: 1, confirmar: true, por: 42, previa_id: pv.previa_id }); assert.equal(r.status, 400, 'por numérico não é nome')
    r = await e({ id: 1, confirmar: true, por }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "previa_id" (gere a prévia antes de confirmar)'])
    r = await e({ id: 1, confirmar: true, por, previa_id: 'pv-lixo<script>' }); assert.deepEqual([r.status, r.j.erro], [409, 'prévia expirada — gere de novo']); eco(r, 'lixo', 'script')
    for (const ruim of [undefined, null, 0, -3, 'abc', 1.5, {}, [], true]) { r = await e({ id: ruim, por }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "id" (número do alerta)'], JSON.stringify(ruim)) }
    r = await e({ id: 987654 }); assert.deepEqual([r.status, r.j.erro], [404, 'alerta não encontrado']); eco(r, '987654')
    assert.equal(s.w.criadas(), 0)
    r = await e({ id: 1, confirmar: true, por, previa_id: pv.previa_id }); assert.equal(r.status, 200); assert.deepEqual([r.j.ok, r.j.previa, r.j.estado], [true, false, 'enviado']); assert.match(r.j.url, /^https:\/\/www\.notion\.so\//); assert.equal(s.w.criadas(), 1)
    r = await e({ id: 1 }); assert.deepEqual([r.status, r.j.ok, r.j.estado], [200, false, 'enviado'], 'já enviado = 200 com ok:false, não duplica')
    r = await e({ id: 1, confirmar: true, por, previa_id: pv.previa_id }); assert.deepEqual([r.status, r.j.estado], [200, 'enviado']); assert.equal(s.w.criadas(), 1)
    assert.equal(s.linhas()[0].origem, 'manual'); assert.equal(s.linhas()[0].por, por)
  } finally { s.fim() }
})

await ok('estado de negócio impeditivo é 200 com ok:false {estado, mensagem} (nunca 4xx): sem relatório anterior, destino compartilhado, cooldown, reconferência negativa, sem eco', async () => {
  const s = await servidor({ clientes: [['Acme', {}], ['Beta', {}]] })
  try {
    s.estoque('Acme'); s.liberar('Acme'); await s.e.varrer()                                                                 // Acme nunca recebeu relatório
    let r = await s.chama('/api/alertas/enviar', { id: 1 }); assert.deepEqual([r.status, r.j.ok, r.j.estado], [200, false, 'sem_relatorio_anterior']); assert.deepEqual(Object.keys(r.j).slice(0, 4), ['ok', 'estado', 'motivo', 'mensagem'])
    s.relatorioEnviado('Acme'); s.estado.set('pagina_cliente:Beta', s.w.cfgCli.get('Acme').pagina_id)
    r = await s.chama('/api/alertas/enviar', { id: 1 }); assert.deepEqual([r.status, r.j.ok, r.j.estado], [200, false, 'destino_compartilhado'])
    r = await s.chama('/api/alertas/enviar', { id: 1, confirmar_destino: 'true' }); assert.equal(r.j.estado, 'destino_compartilhado', 'confirmar_destino estrito')
    r = await s.chama('/api/alertas/enviar', { id: 1, confirmar_destino: true }); assert.deepEqual([r.j.ok, r.j.previa], [true, true]); assert.match(r.j.titulo, /\(Acme\)$/)
    s.reconf.estado = 'negativo'; const x = await s.chama('/api/alertas/enviar', { id: 1, confirmar: true, por, previa_id: r.j.previa_id, confirmar_destino: true }); assert.deepEqual([x.status, x.j.ok, x.j.estado], [200, false, 'reconferencia_negativa'])
    assert.equal(s.w.criadas(), 0)
  } finally { s.fim() }
})

await ok('GET/POST /agendador: interruptor nasce desligado; boolean estrito; por líder/consultor (403 sem eco); persiste', async () => {
  const s = await servidor()
  try {
    assert.deepEqual((await s.chama('/api/alertas/agendador')).j, { ligado: false })
    for (const ruim of ['true', 1, null, undefined]) { const r = await s.chama('/api/alertas/agendador', { ligado: ruim, por }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "ligado" (verdadeiro ou falso)'], String(ruim)) }
    let r = await s.chama('/api/alertas/agendador', { ligado: true }); assert.deepEqual([r.status, r.j.erro], [400, 'informe "por" (quem está enviando — líder ou consultor)'])
    r = await s.chama('/api/alertas/agendador', { ligado: true, por: 'Fulano Z9' }); assert.deepEqual([r.status, r.j.erro], [403, 'somente líder ou consultor da central envia alerta ao cliente']); eco(r, 'Fulano', 'Z9')
    assert.equal(s.e.agendadorEstado().ligado, false)
    r = await s.chama('/api/alertas/agendador', { ligado: true, por: 'carla souza' }); assert.deepEqual([r.status, r.j], [200, { ok: true, ligado: true }])
    assert.deepEqual((await s.chama('/api/alertas/agendador')).j, { ligado: true }); assert.equal(s.estado.get('alerta_auto'), 'ligado')
    assert.deepEqual((await s.chama('/api/alertas/agendador', { ligado: false, por })).j, { ok: true, ligado: false })
  } finally { s.fim() }
})

await ok('erro interno sem status (ex.: SQLITE_BUSY) vai ao handler global (500 «erro interno»), nunca a mensagem crua; erro com status mantém a mensagem fixa', async () => {
  const s = await servidor()
  try {
    const falso = { ...s.e, listarPendentes: () => { throw new Error('SQLITE_BUSY: database is locked') }, enviar: async () => { throw Object.assign(new Error('mensagem fixa'), { status: 409 }) } }
    const app = express(); app.use(express.json()); app.use(criarRotasAlertas({ alertas: falso, quem: () => QUEM })); app.use((err, req, res, _next) => res.status(500).json({ erro: 'erro interno' }))
    const srv = await new Promise(res => { const x = app.listen(0, '127.0.0.1', () => res(x)) }), base = `http://127.0.0.1:${srv.address().port}`
    try {
      const g = await fetch(base + '/api/alertas/pendentes'); assert.equal(g.status, 500); assert.deepEqual(await g.json(), { erro: 'erro interno' })
      const p = await fetch(base + '/api/alertas/enviar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 1 }) }); assert.equal(p.status, 409); assert.equal((await p.json()).erro, 'mensagem fixa')
    } finally { srv.close() }
  } finally { s.fim() }
})

await ok('fiação: server.js monta as rotas DEPOIS do guardaLocal e antes do estático, varre a cada 10 min e ao fim da coleta diária, sem `hoje: hojeLocal` no relatório; db.js cria a tabela; módulos puros', () => {
  const sv = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(sv, /import \{ criarAlertaReal \} from '\.\/lib\/alerta-cliente-real\.js'/); assert.match(sv, /import \{ criarRotasAlertas \} from '\.\/rotas-alertas\.js'/)
  assert.match(sv, /const alertas = criarAlertaReal\(\{ clienteCanonico: clienteDaCentral \}\)/); assert.match(sv, /app\.use\(criarRotasAlertas\(\{ alertas, quem: lideresEConsultores, clienteCanonico: clienteDaCentral \}\)\)/)
  assert.ok(sv.indexOf('app.use(guardaLocal)') < sv.indexOf('app.use(criarRotasAlertas('), 'depois da guarda local (Origin de mutação)')
  assert.ok(sv.indexOf("app.use(express.json({ limit: '1mb' }))") < sv.indexOf('app.use(criarRotasAlertas('), 'depois do express.json')
  assert.ok(sv.indexOf('app.use(criarRotasAlertas(') < sv.indexOf("app.use(express.static(join(ROOT, 'src', 'web')))"), 'antes do express.static')
  assert.match(sv, /setInterval\(\(\) => Promise\.resolve\(\)\.then\(\(\) => alertas\.varrer\(\)\)\.catch\(e => logS\('morpheus', 'erro', `varredura de alertas: \$\{sanitizarErp\(e\?\.message\)\}`\)\), 10 \* 60 \* 1000\)/)
  assert.match(sv, /setEstado\('coleta_ml_dia', hojeLocal\(\)\)\n\s+Promise\.resolve\(\)\.then\(\(\) => alertas\.varrer\(\{ origem: 'coleta' \}\)\)\.catch\(/, 'a varredura dispara no fim da coleta diária, depois de gravar o dia')
  assert.ok(!/criarRelatorioEnvio\(\{[^}]*\bhoje: hojeLocal\b/s.test(sv.slice(sv.indexOf('criarRelatorioEnvio({'), sv.indexOf('app.use(criarRotasRelatorio('))), 'o relatório usa o fuso America/Sao_Paulo do próprio módulo')
  // as linhas que outros testes fixam continuam intactas
  assert.match(sv, /setInterval\(\(\) => Promise\.resolve\(\)\.then\(\(\) => relatorios\.tick\(\)\)\.catch\(e => logS\('morpheus', 'erro', `agendador de relatórios: \$\{sanitizarErp\(e\?\.message\)\}`\)\), 10 \* 60 \* 1000\)/)
  assert.match(sv, /criarDependencias\(\{ handle: db, notion: \{ req: notionReq \}, agora, hoje: hojeLocal, validarPor: validarLiderOuConsultor, mapeamento,/)
  assert.match(sv, /validarPor: validarLiderOuConsultor, notificar, log: \(n, m\) => logS\('morpheus', n, m\), elegiveis: \(\) => clientesElegiveis\(\)\.elegiveis/)
  const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8')
  assert.match(db, /import \{ SCHEMA_ALERTA \} from '\.\/alerta-cliente\.js'/); assert.match(db, /db\.exec\(SCHEMA_ALERTA\)/)
  for (const f of ['lib/alerta-cliente.js', 'rotas-alertas.js']) assert.ok(!/from '\.\/(?:lib\/)?(db|notion|equipe|plano-informacoes|notificacoes)\.js'/.test(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')), f + ' não importa banco, Notion nem notificações reais')
  const real = readFileSync(new URL('../src/lib/alerta-cliente-real.js', import.meta.url), 'utf8')
  assert.ok(!/method: 'POST'|method: 'PATCH'|retry5xx/.test(real), 'a fiação real só LÊ (as escritas estão no núcleo, depois das salvaguardas)')
})

console.log(`\n${n} verificações das rotas de alertas ok.`)
