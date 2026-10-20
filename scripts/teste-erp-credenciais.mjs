// Auto-teste do M6 (credenciais e infra da integração de custos): cripto de ERP (AES-256-GCM, falha fechado), HTTP de saída
// com allowlist, limitador, OAuth (state assinado/expirado/reusado/de outro cliente, callback que troca o code uma vez, renovação
// sob lock, invalid_grant → reautorizar sem laço), status e logs sem segredo. Banco EM MEMÓRIA, sem rede: o ERP é um HTTP fake
// injetado e o fetch global vira stub no teste do httpPadrao. Rodar: node scripts/teste-erp-credenciais.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // tem de vir ANTES dos imports dinâmicos (o módulo lê isto no carregamento)
// valores de TESTE definidos antes do env.js ler o .env: o teste nunca carrega as chaves reais do painel
process.env.ERP_TOKEN_KEY = 'chave-de-teste-do-m6-nao-e-segredo-real-0000000000000000'
process.env.MELI_TOKEN_KEY = ''
process.env.PUBLIC_BASE_URL = 'https://painel.teste.invalid'
import assert from 'node:assert/strict'

// captura TODO o console (o módulo não pode vazar segredo em log); o resultado sai pelas cópias originais
const imprimir = console.log.bind(console), imprimirErro = console.error.bind(console), capturado = []
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => capturado.push(a.map(String).join(' '))

const R = await import('../src/lib/promocoes-db.js')
const { env } = await import('../src/lib/env.js')
const C = await import('../src/lib/cripto.js')
const H = await import('../src/lib/erp-http.js')
const E = await import('../src/lib/erp-credenciais.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')
for (const t of ['erp_credenciais', 'erp_fontes', 'erp_oauth_state'])
  assert.ok(R.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), `tabela ${t} ausente do SCHEMA (M1)`)

let n = 0
const ok = (nome, fn) => { try { fn(); n++; imprimir(`  ✔ ${nome}`) } catch (e) { imprimirErro('FALHOU:', nome); throw e } }
const okA = async (nome, fn) => { try { await fn(); n++; imprimir(`  ✔ ${nome}`) } catch (e) { imprimirErro('FALHOU:', nome); throw e } }

// ── ERP fake (formatos da doc: Bling { error: { type } }, Tiny/Keycloak { error, error_description }) ─────────────
const chamadas = []
let respostas = []
const fakeHttp = async req => {
  chamadas.push(req)
  const r = respostas.shift() ?? { status: 500, corpo: {} }
  if (r.atraso) await new Promise(ok => setTimeout(ok, r.atraso))
  return { status: r.status, headers: r.headers || {}, texto: JSON.stringify(r.corpo) }
}
const deps = (o = {}) => ({ http: fakeHttp, limitadorToken: null, ...o })
const corpoDe = req => Object.fromEntries(new URLSearchParams(req.corpo))
const stateDe = url => new URL(url).searchParams.get('state')
const estado = (c, f) => R.db.prepare('SELECT estado FROM erp_fontes WHERE cliente = ? AND fonte = ?').get(c, f)?.estado
const credRow = (c, f) => R.db.prepare('SELECT * FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(c, f)

const CLI = 'Cliente <b>Teste</b> & Cia', OUTRO = 'Outro Cliente'
const SEG_GLOBAL = 'SEGREDO-APP-GLOBAL-teste', SEG_TINY = 'SEGREDO-APP-TINY-teste', SEG_OUTRO = 'SEGREDO-APP-OUTRO-teste'
const SEGREDOS = [process.env.ERP_TOKEN_KEY, SEG_GLOBAL, SEG_TINY, SEG_OUTRO, 'ACESSO-BLING-1', 'RENOVA-BLING-1', 'ACESSO-BLING-2', 'RENOVA-BLING-2',
  'ACESSO-BLING-3', 'ACESSO-TINY-1', 'RENOVA-TINY-1', 'ACESSO-TINY-2', 'RENOVA-TINY-2', 'ACESSO-TINY-3', 'RENOVA-TINY-3', 'CODIGO-TESTE-1', 'CODIGO-TINY', 'VAZOU']
const paginas = []

// ── cripto ───────────────────────────────────────────────────────────────────
ok('cifrarSegredo: formato v1.<iv>.<tag>.<enc>, roundtrip com acento/emoji, IV aleatório, sem texto puro', () => {
  const s = C.cifrarSegredo('tökên-✓-🔑')
  assert.match(s, /^v1\.[\w-]{16}\.[\w-]{22}\.[\w-]+$/)
  assert.equal(C.decifrarSegredo(s), 'tökên-✓-🔑')
  assert.notEqual(C.cifrarSegredo('x'), C.cifrarSegredo('x'))
  assert.ok(!s.includes('tökên'))
})
ok('decifrarSegredo: adulterado (enc/tag/iv), tag truncada, lixo, v2 e formato do ML → lança ERP_CIFRA_INVALIDA', () => {
  const p = C.cifrarSegredo('segredo').split('.'), troca = x => (x[0] === 'A' ? 'B' : 'A') + x.slice(1)
  for (const ruim of [[p[0], p[1], p[2], troca(p[3])], [p[0], p[1], troca(p[2]), p[3]], [p[0], troca(p[1]), p[2], p[3]], [p[0], p[1], p[2].slice(0, 8), p[3]], ['v2', ...p.slice(1)]].map(a => a.join('.'))
    .concat(['lixo', '', null, undefined, C.cifrar('segredo')]))
    assert.throws(() => C.decifrarSegredo(ruim), { code: 'ERP_CIFRA_INVALIDA' })
})
ok('sem ERP_TOKEN_KEY (nem MELI_TOKEN_KEY): falha fechado, nunca chave de desenvolvimento; nada é gravado', () => {
  const s = C.cifrarSegredo('x'), k = env.ERP_TOKEN_KEY
  env.ERP_TOKEN_KEY = ''
  try {
    assert.throws(() => C.cifrarSegredo('x'), { code: 'ERP_SEM_CHAVE', status: 409 })
    assert.throws(() => C.decifrarSegredo(s), { code: 'ERP_SEM_CHAVE' })
    assert.throws(() => C.hmacErp('x'), { code: 'ERP_SEM_CHAVE' })
    assert.throws(() => E.salvarAppGlobal('bling', { client_id: 'ID', client_secret: 'S' }), { code: 'ERP_SEM_CHAVE' })
    assert.equal(R.db.prepare('SELECT COUNT(*) n FROM erp_credenciais').get().n, 0)
    env.MELI_TOKEN_KEY = 'fallback-de-teste'                                    // fallback documentado na spec 9.1
    assert.equal(C.decifrarSegredo(C.cifrarSegredo('y')), 'y')
    assert.throws(() => C.decifrarSegredo(s), { code: 'ERP_CIFRA_INVALIDA' })   // outra chave não lê o que a primeira cifrou
  } finally { env.ERP_TOKEN_KEY = k; env.MELI_TOKEN_KEY = '' }
  assert.equal(C.decifrarSegredo(s), 'x')
})
ok('sanitizar: tira Bearer, Basic, access/refresh_token, client_secret, code e JWT; corta em 300', () => {
  const t = H.sanitizar('Authorization: Bearer abc.def-123 {"access_token":"AT1","refresh_token":"RT1"} client_secret=CS1&code=CODE1 eyJhbGciOi.eyJzdWIi.c2ln Basic dXNlcjpwYXNz')
  for (const s of ['abc.def-123', 'AT1', 'RT1', 'CS1', 'CODE1', 'eyJhbGciOi', 'dXNlcjpwYXNz']) assert.ok(!t.includes(s), s)
  assert.equal(H.sanitizar('x'.repeat(500)).length, 300)
})

// ── HTTP de saída ────────────────────────────────────────────────────────────
const fetchOriginal = globalThis.fetch
await okA('httpPadrao: allowlist fixa recusa host estranho/sósia/http/porta/userinfo/ML ANTES da rede; só GET e POST de token', async () => {
  let chamou = 0
  globalThis.fetch = async () => { chamou++; throw new Error('não deveria chamar a rede') }
  try {
    for (const url of ['https://evil.example/x', 'https://api.bling.com.br.evil.example/', 'http://api.bling.com.br/Api/v3/produtos', 'https://api.bling.com.br:8443/',
      'https://u:p@api.tiny.com.br/', 'https://127.0.0.1/', 'nao-e-url', 'https://api.mercadolibre.com/items', undefined])
      await assert.rejects(H.httpPadrao({ url }), { code: 'HOST_NAO_PERMITIDO' })
    await assert.rejects(H.httpPadrao({ metodo: 'PUT', url: 'https://api.bling.com.br/Api/v3/produtos/1' }), { code: 'METODO_NAO_PERMITIDO' })
    await assert.rejects(H.httpPadrao({ metodo: 'POST', url: 'https://api.bling.com.br/Api/v3/produtos' }), { code: 'METODO_NAO_PERMITIDO' })
    await assert.rejects(H.httpPadrao({ metodo: 'DELETE', url: 'https://api.tiny.com.br/public-api/v3/produtos/1' }), { code: 'METODO_NAO_PERMITIDO' })
    assert.equal(chamou, 0)
  } finally { globalThis.fetch = fetchOriginal }
})
await okA('httpPadrao: devolve { status, headers minúsculos, texto }; não segue redirect; teto de 5 MB; timeout', async () => {
  let opcoes
  try {
    globalThis.fetch = async (u, o) => { opcoes = o; return new Response('{"data":[]}', { status: 200, headers: { 'X-RateLimit-Remaining': '7' } }) }
    const r = await H.httpPadrao({ url: 'https://api.tiny.com.br/public-api/v3/produtos?limit=1', headers: { Authorization: 'Bearer t' } })
    assert.deepEqual([r.status, r.texto, r.headers['x-ratelimit-remaining']], [200, '{"data":[]}', '7'])
    assert.deepEqual([opcoes.method, opcoes.redirect], ['GET', 'manual'])
    const r2 = await H.httpPadrao({ metodo: 'POST', url: 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token', corpo: 'a=1' })
    assert.equal(r2.status, 200)
    globalThis.fetch = async () => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024 * 1024)) } }), { status: 200 })   // sem content-length
    await assert.rejects(H.httpPadrao({ url: 'https://api.bling.com.br/Api/v3/produtos' }), { code: 'RESPOSTA_GRANDE' })
    globalThis.fetch = async () => new Response('x', { status: 200, headers: { 'Content-Length': String(6 * 1024 * 1024) } })
    await assert.rejects(H.httpPadrao({ url: 'https://api.bling.com.br/Api/v3/produtos' }), { code: 'RESPOSTA_GRANDE' })
    globalThis.fetch = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason)))
    const vivo = setTimeout(() => {}, 5000)      // o timer do AbortSignal.timeout é unref: sem socket aberto (stub), algo tem de segurar o processo
    await assert.rejects(H.httpPadrao({ url: 'https://api.bling.com.br/Api/v3/produtos', timeoutMs: 30 }), { code: 'TIMEOUT' })
    clearTimeout(vivo)
  } finally { globalThis.fetch = fetchOriginal }
})
await okA('criarLimitador: espaçamento por conta, teto global compartilhado (objeto ou número) e pausa do 429', async () => {
  const lim = H.criarLimitador({ porSegundo: 20 })                                // 50 ms entre chamadas
  let t = Date.now(); for (let i = 0; i < 5; i++) await lim.aguardar()
  assert.ok(Date.now() - t >= 180, 'porSegundo não espaçou')
  const g = H.criarLimitador({ porSegundo: 20 }), a = H.criarLimitador({ porSegundo: 1000, global: g }), b = H.criarLimitador({ porSegundo: 1000, global: g })
  t = Date.now(); await Promise.all([1, 2, 3].flatMap(() => [a.aguardar(), b.aguardar()]))
  assert.ok(Date.now() - t >= 230, 'teto global não segurou as duas contas')
  const x = H.criarLimitador({ porMinuto: 60_000, global: 25 }), y = H.criarLimitador({ porMinuto: 60_000, global: 25 })   // número = mesmo teto do processo
  t = Date.now(); await Promise.all([x.aguardar(), y.aguardar(), x.aguardar(), y.aguardar()])
  assert.ok(Date.now() - t >= 110, 'global numérico não é compartilhado')
  const p = H.criarLimitador({ porMinuto: 6000 }); await p.aguardar(); p.registrar429(150)
  t = Date.now(); await p.aguardar()
  assert.ok(Date.now() - t >= 140, '429 não pausou')
})

// ── cadastro do aplicativo ───────────────────────────────────────────────────
ok('salvarAppGlobal / salvarCredenciaisApp: validação sem eco, Tiny só modo próprio, segredo cifrado no banco', () => {
  assert.throws(() => E.salvarAppGlobal('tiny', { client_id: 'a', client_secret: 'b' }), { status: 400 })
  assert.throws(() => E.salvarAppGlobal('bling', { client_id: '', client_secret: 'x' }), { status: 400 })
  assert.throws(() => E.salvarAppGlobal('bling', { client_id: 'id com espaco-XYZ', client_secret: 'x' }), e => e.status === 400 && !e.message.includes('XYZ'))
  assert.throws(() => E.salvarAppGlobal('bling', { client_id: 'ok', client_secret: ['lista'] }), { status: 400 })
  assert.throws(() => E.salvarCredenciaisApp(CLI, 'tiny', { modo_app: 'global' }), { status: 400 })
  assert.throws(() => E.salvarCredenciaisApp(CLI, 'sap', { modo_app: 'proprio', client_id: 'a', client_secret: 'b' }), { status: 400 })
  assert.throws(() => E.salvarCredenciaisApp('*', 'bling', { modo_app: 'global' }), { status: 400 })
  assert.throws(() => E.salvarCredenciaisApp(CLI, 'tiny', { modo_app: 'proprio', client_id: 'x' }), { status: 400 })
  assert.throws(() => E.salvarCredenciaisApp(CLI, 'bling', { modo_app: 'outro' }), { status: 400 })
  E.salvarAppGlobal('bling', { client_id: 'ID-GLOBAL', client_secret: SEG_GLOBAL }, 'dono')
  E.salvarCredenciaisApp(CLI, 'tiny', { modo_app: 'proprio', client_id: 'ID-TINY', client_secret: ` ${SEG_TINY} ` }, 'dono')
  E.salvarCredenciaisApp(OUTRO, 'tiny', { modo_app: 'proprio', client_id: 'ID-OUTRO', client_secret: SEG_OUTRO }, 'dono')
  const linhas = R.db.prepare('SELECT * FROM erp_credenciais').all()
  assert.equal(linhas.length, 3)
  assert.ok(linhas.every(l => l.client_secret_cifrado.startsWith('v1.')))
  assert.equal(C.decifrarSegredo(credRow(CLI, 'tiny').client_secret_cifrado), SEG_TINY)   // aparado, sem espaço
  assert.equal(credRow('*', 'bling').modo_app, 'global')
})
ok('urlAutorizacao: Bling (app global) e Tiny (redirect_uri, scope openid); state assinado sem nome do cliente nem segredo; 409 sem app/sem PUBLIC_BASE_URL', () => {
  const ub = new URL(E.urlAutorizacao(CLI, 'bling'))
  assert.equal(ub.origin + ub.pathname, 'https://www.bling.com.br/Api/v3/oauth/authorize')
  assert.deepEqual([ub.searchParams.get('client_id'), ub.searchParams.get('response_type')], ['ID-GLOBAL', 'code'])
  assert.match(ub.searchParams.get('state'), /^[\w-]{22}\.\d+\.[\w-]{43}$/)
  const ut = new URL(E.urlAutorizacao(CLI, 'tiny'))
  assert.equal(ut.origin + ut.pathname, 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth')
  assert.deepEqual([ut.searchParams.get('client_id'), ut.searchParams.get('redirect_uri'), ut.searchParams.get('scope')], ['ID-TINY', 'https://painel.teste.invalid/erp/callback', 'openid'])
  for (const u of [ub.href, ut.href]) for (const s of [...SEGREDOS, 'Cliente', encodeURIComponent(CLI)]) assert.ok(!u.includes(s), s)
  assert.throws(() => E.urlAutorizacao('Sem App', 'tiny'), { status: 409 })
  assert.throws(() => E.urlAutorizacao(CLI, 'sheets'), { status: 400 })
  const base = env.PUBLIC_BASE_URL; env.PUBLIC_BASE_URL = ''
  try { assert.throws(() => E.urlAutorizacao(CLI, 'tiny'), { status: 409 }) } finally { env.PUBLIC_BASE_URL = base }
})

// ── callback ─────────────────────────────────────────────────────────────────
await okA('callback Bling: troca o code UMA vez (Basic + enable-jwt, credenciais fora do corpo), grava cifrado, fonte conectada, página com esc()', async () => {
  const st = stateDe(E.urlAutorizacao(CLI, 'bling'))
  respostas = [{ status: 200, corpo: { access_token: 'ACESSO-BLING-1', refresh_token: 'RENOVA-BLING-1', expires_in: 21600, token_type: 'Bearer', scope: '98309 5990556' } }]
  chamadas.length = 0
  const r = await E.tratarCallbackErp({ code: 'CODIGO-TESTE-1', state: st }, deps()); paginas.push(r.html)
  assert.equal(r.status, 200)
  assert.ok(r.html.includes('Cliente &lt;b&gt;Teste&lt;/b&gt; &amp; Cia') && !r.html.includes('<b>Teste</b>'))
  assert.equal(chamadas.length, 1)
  const c = chamadas[0]
  assert.deepEqual([c.metodo, c.url, c.headers['enable-jwt']], ['POST', 'https://api.bling.com.br/Api/v3/oauth/token', '1'])
  assert.equal(c.headers.Authorization, 'Basic ' + Buffer.from(`ID-GLOBAL:${SEG_GLOBAL}`).toString('base64'))
  assert.deepEqual(corpoDe(c), { grant_type: 'authorization_code', code: 'CODIGO-TESTE-1' })
  const row = credRow(CLI, 'bling')
  assert.deepEqual([row.modo_app, C.decifrarSegredo(row.access_token_cifrado), C.decifrarSegredo(row.refresh_token_cifrado)], ['global', 'ACESSO-BLING-1', 'RENOVA-BLING-1'])
  assert.equal(estado(CLI, 'bling'), 'conectado')
  const r2 = await E.tratarCallbackErp({ code: 'CODIGO-TESTE-1', state: st }, deps())     // mesmo state de novo
  assert.equal(r2.status, 400); assert.match(r2.html, /já foi usado/); assert.equal(chamadas.length, 1)
})
await okA('state adulterado, de outro cliente, com validade esticada, ausente/lista, expirado e cancelado → recusado sem chamar o ERP', async () => {
  chamadas.length = 0
  const a = stateDe(E.urlAutorizacao(CLI, 'bling')), b = stateDe(E.urlAutorizacao(OUTRO, 'bling'))
  const [na, ea, sa] = a.split('.'), [nb] = b.split('.'), troca = s => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
  for (const st of [`${na}.${ea}.${troca(sa)}`, `${nb}.${ea}.${sa}`, `${na}.${Number(ea) + 3600}.${sa}`, `${troca(na)}.${ea}.${sa}`, a + 'x', undefined, '', [a, a], { a }, 'lixo']) {
    const r = await E.tratarCallbackErp({ code: 'C', state: st }, deps())
    assert.equal(r.status, 400); assert.match(r.html, /inválido/)
  }
  const exp = await E.tratarCallbackErp({ code: 'C', state: a }, deps({ agoraMs: Date.now() + 31 * 60e3 }))
  assert.equal(exp.status, 400); assert.match(exp.html, /expirado/)
  const c = stateDe(E.urlAutorizacao(CLI, 'bling'))
  const canc = await E.tratarCallbackErp({ error: 'access_denied', error_description: '<script>x</script>', state: c }, deps())
  assert.equal(canc.status, 400); assert.ok(!canc.html.includes('<script>x') && !canc.html.includes('&lt;script'))
  assert.equal((await E.tratarCallbackErp({ code: 'C', state: c }, deps())).status, 400)   // o cancelamento consumiu o nonce
  assert.equal((await E.tratarCallbackErp({ code: 'com espaço', state: stateDe(E.urlAutorizacao(CLI, 'bling')) }, deps())).status, 400)
  assert.equal(chamadas.length, 0)
  assert.equal(estado(OUTRO, 'bling'), undefined)                                        // nada conectou o outro cliente
})
await okA('callback com troca recusada: 502, erro sanitizado, code nunca reusado; resposta sem refresh_token também falha', async () => {
  const st = stateDe(E.urlAutorizacao(OUTRO, 'bling'))
  respostas = [{ status: 400, corpo: { error: { type: 'invalid_grant', message: 'Invalid grant', description: 'refresh_token=VAZOU' } } }]
  chamadas.length = 0
  const r = await E.tratarCallbackErp({ code: 'CODIGO-RUIM', state: st }, deps())
  assert.equal(r.status, 502); assert.equal(chamadas.length, 1)
  const s = E.statusCredenciais(OUTRO, 'bling')
  assert.equal(s.conectado, false); assert.match(s.erro, /invalid_grant/); assert.ok(!s.erro.includes('VAZOU'))
  assert.equal((await E.tratarCallbackErp({ code: 'CODIGO-RUIM', state: st }, deps())).status, 400)
  assert.equal(chamadas.length, 1)
  respostas = [{ status: 200, corpo: { access_token: 'X-SEM-REFRESH', expires_in: 100 } }]
  const r3 = await E.tratarCallbackErp({ code: 'C2', state: stateDe(E.urlAutorizacao(OUTRO, 'tiny')) }, deps())
  assert.equal(r3.status, 502); assert.equal(credRow(OUTRO, 'tiny').access_token_cifrado, '')
})
await okA('callback Tiny: client_id/secret e redirect_uri no corpo, sem Basic', async () => {
  respostas = [{ status: 200, corpo: { access_token: 'ACESSO-TINY-1', refresh_token: 'RENOVA-TINY-1', expires_in: 14400 } }]
  chamadas.length = 0
  const r = await E.tratarCallbackErp({ code: 'CODIGO-TINY', state: stateDe(E.urlAutorizacao(CLI, 'tiny')) }, deps()); paginas.push(r.html)
  assert.equal(r.status, 200)
  const c = chamadas[0]
  assert.equal(c.url, 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token'); assert.equal(c.headers.Authorization, undefined)
  assert.deepEqual(corpoDe(c), { grant_type: 'authorization_code', code: 'CODIGO-TINY', redirect_uri: 'https://painel.teste.invalid/erp/callback', client_id: 'ID-TINY', client_secret: SEG_TINY })
  assert.equal(estado(CLI, 'tiny'), 'conectado')
})

// ── token válido ─────────────────────────────────────────────────────────────
await okA('obterTokenValido: na validade não chama o ERP; vencido com 3 chamadas concorrentes = UMA renovação (lock) e grava o refresh novo', async () => {
  chamadas.length = 0
  assert.equal(await E.obterTokenValido(CLI, 'bling', deps()), 'ACESSO-BLING-1'); assert.equal(chamadas.length, 0)
  respostas = [{ status: 200, atraso: 40, corpo: { access_token: 'ACESSO-BLING-2', refresh_token: 'RENOVA-BLING-2', expires_in: 21600 } }]
  const depois = deps({ agoraMs: Date.now() + 7 * 3600e3 })                           // passou das 6 h de validade
  assert.deepEqual(await Promise.all([1, 2, 3].map(() => E.obterTokenValido(CLI, 'bling', depois))), ['ACESSO-BLING-2', 'ACESSO-BLING-2', 'ACESSO-BLING-2'])
  assert.equal(chamadas.length, 1)
  assert.equal(chamadas[0].headers['enable-jwt'], '1')                                   // sem ele a renovação volta token opaco
  assert.deepEqual(corpoDe(chamadas[0]), { grant_type: 'refresh_token', refresh_token: 'RENOVA-BLING-1' })
  assert.equal(C.decifrarSegredo(credRow(CLI, 'bling').refresh_token_cifrado), 'RENOVA-BLING-2')
  assert.equal(await E.obterTokenValido(CLI, 'bling', deps()), 'ACESSO-BLING-2'); assert.equal(chamadas.length, 1)
})
await okA('forcar/renovar renova dentro da validade; resposta sem refresh novo mantém o anterior; falha transitória não pede reautorização', async () => {
  respostas = [{ status: 200, corpo: { access_token: 'ACESSO-BLING-3', expires_in: 21600 } }]
  chamadas.length = 0
  assert.equal(await E.obterTokenValido(CLI, 'bling', deps({ renovar: true })), 'ACESSO-BLING-3')
  assert.equal(C.decifrarSegredo(credRow(CLI, 'bling').refresh_token_cifrado), 'RENOVA-BLING-2')
  respostas = [{ status: 503, corpo: { error: 'temporarily_unavailable' } }]
  assert.equal(await E.obterTokenValido(CLI, 'bling', deps({ forcar: true })), null)
  assert.equal(estado(CLI, 'bling'), 'conectado'); assert.match(credRow(CLI, 'bling').erro, /503/)
  assert.equal(C.decifrarSegredo(credRow(CLI, 'bling').refresh_token_cifrado), 'RENOVA-BLING-2')   // nada perdido
  assert.equal(chamadas.length, 2)
})
await okA('invalid_grant (Tiny e Bling) → estado reautorizar, null e SEM laço; novo consentimento volta a conectado', async () => {
  respostas = [{ status: 400, corpo: { error: 'invalid_grant', error_description: 'Token is not active' } }]
  chamadas.length = 0
  assert.equal(await E.obterTokenValido(CLI, 'tiny', deps({ forcar: true })), null)
  assert.equal(estado(CLI, 'tiny'), 'reautorizar')
  for (let i = 0; i < 3; i++) assert.equal(await E.obterTokenValido(CLI, 'tiny', deps({ forcar: true })), null)
  assert.equal(chamadas.length, 1, 'reautorizar não pode chamar o ERP de novo')
  assert.deepEqual([E.statusCredenciais(CLI, 'tiny').conectado, E.statusCredenciais(CLI, 'tiny').reautorizar], [false, true])
  respostas = [{ status: 200, corpo: { access_token: 'ACESSO-TINY-2', refresh_token: 'RENOVA-TINY-2', expires_in: 14400 } }]
  assert.equal((await E.tratarCallbackErp({ code: 'C3', state: stateDe(E.urlAutorizacao(CLI, 'tiny')) }, deps())).status, 200)
  assert.equal(estado(CLI, 'tiny'), 'conectado')
  assert.equal(await E.obterTokenValido(CLI, 'tiny', deps()), 'ACESSO-TINY-2')
  respostas = [{ status: 400, corpo: { error: { type: 'invalid_grant', message: 'Invalid refresh token' } } }]     // formato do Bling
  assert.equal(await E.obterTokenValido(CLI, 'bling', deps({ forcar: true })), null)
  assert.equal(estado(CLI, 'bling'), 'reautorizar')
  assert.ok(R.listarAuditoria(CLI).some(a => a.evento === 'erp_reautorizar'))
})
await okA('regressão idx 36: renovação em voo com o refresh VELHO que volta invalid_grant depois de uma reconexão NÃO derruba a conexão nova', async () => {
  respostas = [{ status: 400, atraso: 60, corpo: { error: 'invalid_grant', error_description: 'Token is not active' } }]
  chamadas.length = 0
  const emVoo = E.obterTokenValido(CLI, 'tiny', deps({ forcar: true }))                   // lê RENOVA-TINY-2 e fica esperando o ERP
  await new Promise(ok => setTimeout(ok, 5)); assert.equal(chamadas.length, 1)
  respostas = [{ status: 200, corpo: { access_token: 'ACESSO-TINY-3', refresh_token: 'RENOVA-TINY-3', expires_in: 14400 } }]
  assert.equal((await E.tratarCallbackErp({ code: 'C4', state: stateDe(E.urlAutorizacao(CLI, 'tiny')) }, deps())).status, 200)
  assert.equal(await emVoo, 'ACESSO-TINY-3', 'devolve o token da conexão nova')
  assert.equal(estado(CLI, 'tiny'), 'conectado'); assert.equal(credRow(CLI, 'tiny').erro, '')
  assert.equal(C.decifrarSegredo(credRow(CLI, 'tiny').refresh_token_cifrado), 'RENOVA-TINY-3')
  assert.equal(await E.obterTokenValido(CLI, 'tiny', deps()), 'ACESSO-TINY-3')
})
await okA('chave trocada: token ilegível → reautorizar (não lança, não chama o ERP); chave ausente → lança ERP_SEM_CHAVE', async () => {
  chamadas.length = 0
  const k = env.ERP_TOKEN_KEY
  try {
    env.ERP_TOKEN_KEY = ''
    await assert.rejects(E.obterTokenValido(CLI, 'tiny', deps()), { code: 'ERP_SEM_CHAVE' })
    const cb = await E.tratarCallbackErp({ code: 'C', state: 'A'.repeat(22) + '.1.' + 'A'.repeat(43) }, deps())
    assert.equal(cb.status, 400)                                                              // nonce inexistente: nem precisa da chave
    env.ERP_TOKEN_KEY = 'outra-chave-de-teste-0000000000000000000000000000000000'
    assert.equal(await E.obterTokenValido(CLI, 'tiny', deps()), null)
    assert.equal(estado(CLI, 'tiny'), 'reautorizar')
  } finally { env.ERP_TOKEN_KEY = k }
  assert.equal(chamadas.length, 0)
})
ok('isolamento: a conexão de um cliente não aparece no outro', () => {
  assert.equal(E.statusCredenciais(OUTRO, 'bling').conectado, false)
  assert.equal(E.statusCredenciais(OUTRO, 'tiny').conectado, false)
})
await okA('obterTokenValido devolve null para cliente sem conexão, "*" e fonte inválida', async () => {
  chamadas.length = 0
  for (const [c, f] of [[OUTRO, 'tiny'], [OUTRO, 'bling'], ['*', 'bling'], [CLI, 'sheets'], ['', 'bling'], [null, 'tiny']]) assert.equal(await E.obterTokenValido(c, f, deps()), null)
  assert.equal(chamadas.length, 0)
})

// ── status e desconexão ──────────────────────────────────────────────────────
ok('statusCredenciais: formato do cartão, sem coluna cifrada nem segredo; app global visível como configurado', () => {
  const s = E.statusCredenciais(CLI, 'bling')
  for (const k of ['conectado', 'modo_app', 'escopos', 'company_id', 'expira_em', 'app_configurado', 'erro']) assert.ok(k in s, k)
  assert.ok(Object.keys(s).every(k => !/cifrad|secret|segredo|token/i.test(k)))
  assert.deepEqual([s.modo_app, s.app_configurado], ['global', true])
  assert.equal(E.statusCredenciais('Sem App', 'bling').modo_app, 'global')
  assert.deepEqual([E.statusCredenciais('Sem App', 'tiny').modo_app, E.statusCredenciais('Sem App', 'tiny').app_configurado], ['proprio', false])
  assert.equal(E.statusCredenciais('*', 'bling').app_configurado, true)
  assert.equal(E.statusCredenciais(CLI, 'sap'), null)
})
await okA('troca de app (client_id novo) desfaz a conexão; desconectarErp apaga tokens, mantém o app e marca desconectado', async () => {
  respostas = [{ status: 200, corpo: { access_token: 'ACESSO-TINY-2', refresh_token: 'RENOVA-TINY-2', expires_in: 14400 } }]
  assert.equal((await E.tratarCallbackErp({ code: 'C4', state: stateDe(E.urlAutorizacao(OUTRO, 'tiny')) }, deps())).status, 200)
  assert.equal(E.statusCredenciais(OUTRO, 'tiny').conectado, true)
  E.salvarCredenciaisApp(OUTRO, 'tiny', { modo_app: 'proprio', client_id: 'ID-OUTRO-2', client_secret: SEG_OUTRO }, 'dono')
  assert.deepEqual([E.statusCredenciais(OUTRO, 'tiny').conectado, estado(OUTRO, 'tiny'), credRow(OUTRO, 'tiny').refresh_token_cifrado], [false, 'desconectado', ''])
  const d = E.desconectarErp(CLI, 'bling', 'dono')
  assert.deepEqual(d, { ok: true, tinha_conexao: true })
  const row = credRow(CLI, 'bling')
  assert.deepEqual([row.access_token_cifrado, row.refresh_token_cifrado, estado(CLI, 'bling')], ['', '', 'desconectado'])
  assert.equal(await E.obterTokenValido(CLI, 'bling', deps()), null)
  assert.equal(E.statusCredenciais('*', 'bling').app_configurado, true)                    // o app global continua
  assert.throws(() => E.desconectarErp(CLI, 'sheets'), { status: 400 })
})

// ── nenhum segredo em status, auditoria, estado, páginas ou log ──────────────
ok('nenhum segredo/token em statusCredenciais, auditoria, erp_fontes, coluna erro, páginas ou console', () => {
  const textos = [
    ...[CLI, OUTRO, '*', 'Sem App'].flatMap(c => ['bling', 'tiny'].map(f => JSON.stringify(E.statusCredenciais(c, f)))),
    JSON.stringify(R.db.prepare('SELECT * FROM promo_auditoria').all()),
    JSON.stringify(R.db.prepare('SELECT * FROM erp_fontes').all()),
    JSON.stringify(R.db.prepare('SELECT erro, escopos, client_id FROM erp_credenciais').all()),
    ...paginas, ...capturado,
  ]
  for (const t of textos) for (const s of SEGREDOS) assert.ok(!t.includes(s), `vazou "${s.slice(0, 6)}…"`)
  assert.ok(!textos.some(t => /"v1\.[\w-]+\./.test(t)), 'texto cifrado exposto')
})

globalThis.fetch = fetchOriginal
imprimir(`✔ teste-erp-credenciais: ${n} verificações OK`)
