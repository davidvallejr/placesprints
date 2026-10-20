// Autoteste da frente INTEGRAÇÃO do Relatório Semanal v2: parse de ?perfil=/?interno=, API /api/cliente/perfil
// (validação do payload, 'por' obrigatório, só corpo JSON), guard anti-CSRF na mutação, fiação do server.js e do publicar.
// Sem banco real e sem Notion: as rotas recebem STUBS (fábrica) e rodam numa porta efêmera de loopback.
// Rodar: node scripts/teste-semanal-rotas.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import express from 'express'
import { idsPerfil, opcoesSemanal, criarRotasPerfil } from '../src/rotas-perfil.js'
import { guardaLocal } from '../src/lib/guarda-local.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const fonte = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')

const PERFIS = ['analitico', 'direto', 'relacionamento', 'proativo', 'zero_conhecimento', 'tecnico', 'ansioso']
const perfisCfg = PERFIS.map(id => ({ id, rotulo: id[0].toUpperCase() + id.slice(1), descricao: `descrição de ${id}`, regras: {} }))
const objetivosCfg = ['faturamento', 'visibilidade', 'conversao', 'ads', 'margem', 'lancamentos'].map(id => ({ id, rotulo: `Objetivo ${id}`, metrica: id, descricao: '' }))

// ── parse de ?perfil= ─────────────────────────────────────────────────────────────────────────────────────
await ok('idsPerfil: "a,b" e ?perfil=a&perfil=b viram [a,b]; espaços, vazios e repetidos somem; a ordem (1º = primário) se mantém', () => {
  assert.deepEqual(idsPerfil('direto,tecnico', PERFIS), { ids: ['direto', 'tecnico'], invalidos: [] })
  assert.deepEqual(idsPerfil(['tecnico', 'direto,ansioso'], PERFIS).ids, ['tecnico', 'direto', 'ansioso'])
  assert.deepEqual(idsPerfil(' direto , ,direto,', PERFIS).ids, ['direto'])
  for (const vazio of [undefined, '', ',', []]) assert.deepEqual(idsPerfil(vazio, PERFIS), { ids: [], invalidos: [] })
})
await ok('idsPerfil: id fora da config é apontado como inválido (e objeto da query não vira id válido)', () => {
  assert.deepEqual(idsPerfil('direto,xpto', PERFIS).invalidos, ['xpto'])
  assert.equal(idsPerfil({ a: 'direto' }, PERFIS).invalidos.length, 1)
})

// ── opcoesSemanal: o que /semanal, /semanal.pdf e a CLI entregam a montarSemanal ──────────────────────────
await ok('opcoesSemanal: sem ?interno é a versão do CLIENTE; ?interno=1 (ou true) liga a interna; outro valor não liga', () => {
  assert.equal(opcoesSemanal({ cliente: 'X' }, PERFIS).interno, false)
  assert.equal(opcoesSemanal({ cliente: 'X', interno: '1' }, PERFIS).interno, true)
  assert.equal(opcoesSemanal({ cliente: 'X', interno: 'true' }, PERFIS).interno, true)
  for (const v of ['0', 'false', '', 'sim', ['0', '1']]) assert.equal(opcoesSemanal({ cliente: 'X', interno: v }, PERFIS).interno, false, String(v))
})
await ok('opcoesSemanal: sem ?perfil => perfil undefined (vale o salvo do cliente); com ?perfil => override em array', () => {
  assert.equal(opcoesSemanal({ cliente: 'X' }, PERFIS).perfil, undefined)
  assert.equal(opcoesSemanal({ cliente: 'X', perfil: '' }, PERFIS).perfil, undefined)
  assert.deepEqual(opcoesSemanal({ cliente: 'X', perfil: 'direto,ansioso' }, PERFIS).perfil, ['direto', 'ansioso'])
})
await ok('opcoesSemanal: ?perfil desconhecido => erro 400 que NÃO repete o valor recebido (a mensagem volta dentro de HTML)', () => {
  const e = (() => { try { opcoesSemanal({ cliente: 'X', perfil: '<script>alert(1)</script>' }, PERFIS) } catch (x) { return x } })()
  assert.equal(e.status, 400)
  assert.doesNotMatch(e.message, /script/)
  assert.match(e.message, /analitico/)                         // lista os válidos
})
await ok('opcoesSemanal: cliente/de/ate repetidos na query valem o primeiro; vazios viram "" (montarSemanal aplica o período padrão)', () => {
  const o = opcoesSemanal({ cliente: [' A ', 'B'], de: '2026-09-01' }, PERFIS)
  assert.deepEqual({ ...o }, { cliente: 'A', de: '2026-09-01', ate: '', interno: false, perfil: undefined })
  assert.equal(opcoesSemanal({}, PERFIS).cliente, '')
})

// ── API do perfil, com stubs ──────────────────────────────────────────────────────────────────────────────
const salvos = new Map(), chamadas = []
const padrao = cliente => ({ cliente, perfis: [perfisCfg[0]], primario: 'analitico', objetivo: { id: 'faturamento', rotulo: 'Objetivo faturamento', metrica: 'faturamento' }, regras: { densidade: 'completa' }, origem: 'padrao' })
const deps = {
  listarPerfis: () => perfisCfg, listarObjetivos: () => objetivosCfg,
  perfilDoCliente: c => salvos.get(c) || padrao(c),
  salvarPerfil: a => {
    chamadas.push(a)
    if (a.cliente === 'Cliente Quebrado') throw new Error('falha de gravação simulada')
    const p = { cliente: a.cliente, perfis: a.perfis.map(id => perfisCfg.find(x => x.id === id)), primario: a.perfis[0], objetivo: objetivosCfg.find(o => o.id === a.objetivo), regras: {}, origem: 'banco' }
    salvos.set(a.cliente, p); return p
  },
  clienteCanonico: nome => ({ 'cliente a': 'Cliente A', 'cliente quebrado': 'Cliente Quebrado' })[nome.toLowerCase()] || null,
  coletaPromocoesPadrao: () => true,     // config/promocoes.json coleta_para_todos (stub)
}
const app = express()
app.use(guardaLocal); app.use(express.json({ limit: '1mb' })); app.use(criarRotasPerfil(deps))
app.use((err, req, res, next) => res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ erro: err?.type === 'entity.parse.failed' ? 'JSON inválido' : 'erro interno' }))   // = o handler final do server.js
const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
let porta = srv.address().port
// http cru: dá controle total de Content-Type e Origin (o fetch pode barrar cabeçalhos)
const chama = (metodo, caminho, { corpo, tipo = 'application/json', origin } = {}) => new Promise((resolve, reject) => {
  const dados = corpo === undefined ? null : typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
  const headers = { ...(tipo && dados !== null ? { 'Content-Type': tipo } : {}), ...(origin ? { Origin: origin } : {}), ...(dados !== null ? { 'Content-Length': Buffer.byteLength(dados) } : {}) }
  const rq = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers }, rs => {
    let t = ''; rs.on('data', c => t += c); rs.on('end', () => { let json = null; try { json = JSON.parse(t) } catch { /* corpo não-JSON (ex.: 403 do guard) */ } resolve({ status: rs.statusCode, json, texto: t }) })
  })
  rq.on('error', reject); if (dados !== null) rq.write(dados); rq.end()
})
const post = (corpo, extra) => chama('POST', '/api/cliente/perfil', { corpo, ...extra })
const valido = { cliente: 'Cliente A', perfis: ['direto', 'ansioso'], objetivo: 'ads', por: 'Camila' }
const q = encodeURIComponent

try {
  await ok('GET: perfil efetivo + listas de perfis e objetivos; aviso de origem "padrao" quando não há perfil salvo', async () => {
    const r = await chama('GET', `/api/cliente/perfil?cliente=${q('Cliente A')}`)
    assert.equal(r.status, 200)
    assert.equal(r.json.perfil.origem, 'padrao'); assert.equal(r.json.perfil.primario, 'analitico')
    assert.deepEqual(r.json.perfis.map(p => p.id), PERFIS); assert.equal(r.json.objetivos.length, 6)
    assert.equal(r.json.coleta_promocoes_padrao, true, 'a tela diz o que "padrão da base" significa hoje (ligada/desligada)')
  })
  await ok('GET: nome em outra caixa resolve para o nome oficial da central; cliente inexistente = 404 JSON; sem cliente = 400 JSON', async () => {
    assert.equal((await chama('GET', `/api/cliente/perfil?cliente=${q('CLIENTE a')}`)).json.perfil.cliente, 'Cliente A')
    const nao = await chama('GET', `/api/cliente/perfil?cliente=${q('Fantasma')}`)
    assert.equal(nao.status, 404); assert.match(nao.json.erro, /não encontrado/)
    const sem = await chama('GET', '/api/cliente/perfil'); assert.equal(sem.status, 400); assert.match(sem.json.erro, /cliente/)
  })

  await ok('POST válido: grava com o nome OFICIAL do cliente, ids na ordem enviada (1º = primário), objetivo e "por"; devolve o perfil salvo', async () => {
    const r = await post({ ...valido, cliente: 'cliente a', por: '  Camila  ' })
    assert.equal(r.status, 200); assert.equal(r.json.ok, true)
    assert.deepEqual(chamadas.at(-1), { cliente: 'Cliente A', perfis: ['direto', 'ansioso'], objetivo: 'ads', por: 'Camila' })
    assert.equal(r.json.perfil.primario, 'direto'); assert.equal(r.json.perfil.origem, 'banco')
    assert.equal((await chama('GET', `/api/cliente/perfil?cliente=${q('Cliente A')}`)).json.perfil.origem, 'banco')   // o GET já vê o salvo
  })
  await ok('POST: tarefas_no_relatorio aceita true/false/null (força, desliga, volta ao perfil); qualquer outra coisa => 400 e nada é gravado', async () => {
    for (const v of [true, false, null]) { const r = await post({ ...valido, tarefas_no_relatorio: v }); assert.equal(r.status, 200); assert.equal(chamadas.at(-1).tarefas_no_relatorio, v) }
    const antes = chamadas.length
    for (const v of ['sim', 1, 'false', [], {}]) { const r = await post({ ...valido, tarefas_no_relatorio: v }); assert.equal(r.status, 400, JSON.stringify(v)); assert.match(r.json.erro, /tarefas_no_relatorio/) }
    assert.equal(chamadas.length, antes)
  })
  await ok('POST: coleta_promocoes (interruptor da coleta de promoções do ML) aceita true/false/null; ausente não vai ao salvar; outra coisa => 400 sem gravar', async () => {
    for (const v of [true, false, null]) { const r = await post({ ...valido, coleta_promocoes: v }); assert.equal(r.status, 200); assert.equal(chamadas.at(-1).coleta_promocoes, v) }
    await post(valido); assert.equal('coleta_promocoes' in chamadas.at(-1), false)
    const antes = chamadas.length
    for (const v of ['sim', 1, 0, 'false', []]) { const r = await post({ ...valido, coleta_promocoes: v }); assert.equal(r.status, 400, JSON.stringify(v)); assert.match(r.json.erro, /coleta_promocoes/); assert.doesNotMatch(r.json.erro, /sim/) }
    assert.equal(chamadas.length, antes)
  })
  await ok('POST: "por" obrigatório (ausente, vazio, só espaços, não-texto) => 400 e NADA é gravado', async () => {
    const antes = chamadas.length
    for (const por of [undefined, '', '   ', null, 123, {}]) {
      const { por: _, ...resto } = valido
      const r = await post(por === undefined ? resto : { ...valido, por })
      assert.equal(r.status, 400, JSON.stringify(por)); assert.match(r.json.erro, /por/)
    }
    assert.equal(chamadas.length, antes)
  })
  await ok('POST: "por" gigante é cortado em 80 caracteres', async () => {
    await post({ ...valido, por: 'x'.repeat(500) })
    assert.equal(chamadas.at(-1).por.length, 80)
  })
  await ok('POST: perfis ausentes/vazios/não-lista/ids desconhecidos/não-texto => 400 (a lista de válidos vem na mensagem)', async () => {
    const antes = chamadas.length
    for (const perfis of [undefined, [], 'direto', { 0: 'direto' }, ['xpto'], ['direto', 'xpto'], [7], [null]]) {
      const r = await post({ ...valido, perfis })
      assert.equal(r.status, 400, JSON.stringify(perfis)); assert.match(r.json.erro, /perfis/)
    }
    assert.match((await post({ ...valido, perfis: ['xpto'] })).json.erro, /analitico/)
    assert.equal(chamadas.length, antes)
  })
  await ok('POST: ids repetidos são deduplicados mantendo a ordem', async () => {
    await post({ ...valido, perfis: ['tecnico', 'direto', 'tecnico'] })
    assert.deepEqual(chamadas.at(-1).perfis, ['tecnico', 'direto'])
  })
  await ok('POST: objetivo ausente/desconhecido/não-texto => 400', async () => {
    const antes = chamadas.length
    for (const objetivo of [undefined, '', 'lucro_infinito', 5, ['ads']]) {
      const r = await post({ ...valido, objetivo }); assert.equal(r.status, 400, JSON.stringify(objetivo)); assert.match(r.json.erro, /objetivo/)
    }
    assert.equal(chamadas.length, antes)
  })
  await ok('POST: cliente ausente = 400; cliente fora da central = 404 (e nada é gravado)', async () => {
    const antes = chamadas.length
    assert.equal((await post({ ...valido, cliente: '' })).status, 400)
    const { cliente: _, ...semCliente } = valido; assert.equal((await post(semCliente)).status, 400)
    assert.equal((await post({ ...valido, cliente: 'Fantasma' })).status, 404)
    assert.equal(chamadas.length, antes)
  })
  await ok('POST: corpo que não é objeto ([] / "texto" / null) => 400 JSON, sem estourar', async () => {
    for (const corpo of ['[]', '"texto"', 'null']) { const r = await post(corpo); assert.equal(r.status, 400, corpo); assert.ok(r.json?.erro) }
  })
  await ok('POST: erro da camada de dados volta como JSON {erro} (nunca HTML nem stack)', async () => {
    const r = await post({ ...valido, cliente: 'Cliente Quebrado' })
    assert.equal(r.status, 400); assert.equal(r.json.erro, 'falha de gravação simulada'); assert.doesNotMatch(r.texto, /at .*\.js/)
  })

  await ok('POST só vale com Content-Type JSON e lê SÓ o corpo: form/text/sem tipo => 415; query string é ignorada', async () => {
    const antes = chamadas.length
    const atk = `/api/cliente/perfil?cliente=${q('Cliente A')}&perfis=direto&objetivo=ads&por=Eu`
    for (const tipo of ['text/plain', 'application/x-www-form-urlencoded', null]) {
      const r = await chama('POST', atk, { corpo: '{}', tipo }); assert.equal(r.status, 415, String(tipo)); assert.ok(r.json.erro)
    }
    const r = await chama('POST', atk, { corpo: '{}' }); assert.equal(r.status, 400)       // JSON válido, mas sem os campos: a query não vale
    assert.equal(chamadas.length, antes)
  })
  await ok('guard global: POST com Origin de OUTRA origem => 403 e nada é gravado; mesma origem passa; sem Origin (curl) passa', async () => {
    const antes = chamadas.length
    for (const origin of ['https://evil.example', 'http://localhost:3005', 'null'])
      assert.equal((await post(valido, { origin })).status, 403, origin)
    assert.equal(chamadas.length, antes)
    assert.equal((await post(valido, { origin: `http://127.0.0.1:${porta}` })).status, 200)
    assert.equal((await post(valido)).status, 200)
    assert.equal(chamadas.length, antes + 2)
  })
} finally { srv.close() }

// ── contrato real: as MESMAS rotas contra lib/perfil-cliente.js, com banco EM MEMÓRIA (PS_PERFIL_MEMORIA; nunca data/db.sqlite) ──
process.env.PS_PERFIL_MEMORIA = '1'
const P = await import('../src/lib/perfil-cliente.js')
const app2 = express()
app2.use(guardaLocal); app2.use(express.json({ limit: '1mb' }))
app2.use(criarRotasPerfil({ perfilDoCliente: P.perfilDoCliente, salvarPerfil: P.salvarPerfil, listarPerfis: P.listarPerfis, listarObjetivos: P.listarObjetivos, clienteCanonico: nome => nome.toLowerCase() === 'cliente real' ? 'Cliente Real' : null }))
const srv2 = await new Promise(r => { const s = app2.listen(0, '127.0.0.1', () => r(s)) })
porta = srv2.address().port
try {
  await ok('perfil-cliente real: os 7 perfis e 6 objetivos da config chegam à API; sem perfil salvo = padrão (analítico + faturamento)', async () => {
    const r = await chama('GET', `/api/cliente/perfil?cliente=${q('cliente real')}`)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.perfis.map(p => p.id), PERFIS)
    assert.deepEqual(r.json.objetivos.map(o => o.id), ['faturamento', 'visibilidade', 'conversao', 'ads', 'margem', 'lancamentos'])
    assert.equal(r.json.perfil.origem, 'padrao'); assert.equal(r.json.perfil.primario, 'analitico'); assert.equal(r.json.perfil.objetivo.id, 'faturamento')
    assert.ok(r.json.perfis.every(p => p.rotulo && p.descricao))                          // a tela mostra rótulo e descrição vindos daqui
  })
  await ok('perfil-cliente real: POST salva; o GET devolve origem "banco", o 1º como primário e as regras mescladas (OU nos booleanos, 1º vence texto/limites)', async () => {
    const r = await post({ cliente: 'CLIENTE REAL', perfis: ['direto', 'tecnico'], objetivo: 'ads', por: 'Camila' })
    assert.equal(r.status, 200, r.texto)
    const g = (await chama('GET', `/api/cliente/perfil?cliente=${q('Cliente Real')}`)).json.perfil
    assert.equal(g.origem, 'banco'); assert.equal(g.primario, 'direto'); assert.deepEqual(g.perfis.map(p => p.id), ['direto', 'tecnico']); assert.equal(g.objetivo.id, 'ads')
    assert.equal(g.regras.densidade, 'enxuta'); assert.equal(g.regras.max_acoes, 5)       // primário vence texto e limites
    assert.equal(g.regras.metricas_extras, true); assert.equal(g.regras.metodologia, true) // booleanos: o técnico liga
    assert.equal(g.regras.graficos, true)                                                 // direto desliga, técnico liga: OU
  })
  await ok('perfil-cliente real: a validação da rota barra antes da lib; a lib também rejeita (defesa em profundidade) sem repetir o valor', async () => {
    assert.equal((await post({ cliente: 'Cliente Real', perfis: ['xpto'], objetivo: 'ads', por: 'C' })).status, 400)
    assert.equal((await post({ cliente: 'Cliente Real', perfis: ['direto'], objetivo: 'ads' })).status, 400)
    assert.throws(() => P.salvarPerfil({ cliente: 'X', perfis: ['<b>x</b>'], por: 'C' }), e => e.status === 400 && !/<b>/.test(e.message))
    assert.equal((await chama('GET', `/api/cliente/perfil?cliente=${q('Cliente Real')}`)).json.perfil.primario, 'direto')   // nada mudou
  })
} finally { srv2.close() }

// ── fiação do server.js e do publicar (testes de fonte: o server.js não pode ser importado — abre o banco e a porta reais) ──
await ok('server.js: /semanal repassa interno e perfil a montarSemanal e interno a renderSemanal; sem ?interno o PDF é o do cliente', () => {
  const s = fonte('src/server.js')
  assert.match(s, /import \{ opcoesSemanal \} from '\.\/rotas-perfil\.js'/)
  const rota = s.match(/app\.get\('\/semanal', async[\s\S]*?\n\}\)/)[0]
  assert.match(rota, /renderSemanal\(await montarSemanal\(o\), \{ interno: o\.interno \}\)/)   // o = { cliente, de, ate, interno, perfil }
  assert.doesNotMatch(rota, /req\.query\.interno/)                                       // a decisão passa só por opcoesSemanal
  const pdf = s.match(/app\.get\('\/semanal\.pdf'[\s\S]*?\n\}\)/)[0]
  assert.match(pdf, /opcoesDaQuery\(req\.query\)/); assert.match(pdf, /\/semanal\?\$\{new URLSearchParams\(req\.query\)\}/)
  assert.match(pdf, /o\.interno \? '-interno' : ''/)                                    // o arquivo interno não se passa pelo do cliente
})
await ok('rotas-planos.js monta a API do perfil com o nome oficial da central', () => {
  const s = fonte('src/rotas-planos.js')
  assert.match(s, /rotasPlanos\.use\(criarRotasPerfil\(\{/); assert.match(s, /clienteCanonico: nome =>/)
})
await ok('publicar-notion: o PDF do cliente é SEMPRE a versão do cliente; o log interno de prontidão continua; a linha do Notion não lê mais "proximos"', () => {
  const p = fonte('scripts/publicar-notion.mjs')
  assert.match(p, /montarSemanal\(\{ cliente: c\.nome, interno: false \}\)/); assert.match(p, /renderSemanal\(semanal, \{ inline: true, interno: false \}\)/)
  assert.match(p, /semanal\.pronto \?/); assert.match(p, /semanal\.prontidao\.filter/)     // log interno
  const l = fonte('src/lib/notion-publicar.js')
  assert.doesNotMatch(l, /proximos/); assert.match(l, /semanal\.atividades\.em_andamento/)
  assert.doesNotMatch(l, /semanal\.pronto\b/)                                           // checklist não vaza para a página do cliente no Notion
})
await ok('scripts/semanal.mjs: --perfil e --interno chegam a montarSemanal E a renderSemanal; perfil inválido para antes de gerar', () => {
  const s = fonte('scripts/semanal.mjs')
  assert.match(s, /montarSemanal\(\{[^}]*interno[^}]*perfil:/); assert.match(s, /renderSemanal\(dados, \{ inline: true, interno \}\)/)
  assert.match(s, /process\.exit\(1\)/); assert.match(s, /-interno/)
})
await ok('cliente.js: o bloco de perfil grava só pelo helper api() (JSON) e mostra textos da config via esc()/textContent', () => {
  const j = fonte('src/web/cliente.js'), bloco = j.slice(j.indexOf('function desenharPerfil'))
  // 08/10 (decisão 3): o mesmo POST leva coleta_promocoes (interruptor da coleta de promoções, mesma régua true|false|null de tarefas_no_relatorio)
  assert.match(bloco, /api\('\/api\/cliente\/perfil', \{ cliente, perfis: \[primario, \.\.\.extras\], objetivo: obj\.value, por, tarefas_no_relatorio: tv === 'sim' \? true : tv === 'nao' \? false : null, coleta_promocoes: pv === 'sim' \? true : pv === 'nao' \? false : null \}\)/)
  assert.match(bloco, /\.textContent = r\.perfis\.find/)                                  // descrição da config nunca vira HTML
  assert.doesNotMatch(bloco, /\$\{x\.(rotulo|descricao|id)\}/)                            // rótulo/descrição/id sempre dentro de esc(...)
})

console.log(`\n${n} verificações passaram.`)
