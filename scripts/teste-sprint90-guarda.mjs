// Autoteste da GUARDA do Place Sprint 90 (fase F1, teste 1 do desenho): pelo túnel, o host SPRINT90_PUBLIC_HOST abre SÓ a lista fechada ROTA_PUBLICA_S90;
// painel interno, estático, /api/*, /comercial, /diagnostico e caminhos tortos = 403; o host comercial e o do ML não alcançam /c/* nem /webhook/mp; sem a env nada
// abre; CSRF barrado; a assinatura antiga guardaLocal(req,res,next,hc) segue igual. Montagem no server.js: rotasSprint90 depois de rotasPublicas e antes do
// estático; callback do ML com ramo S90 SEM gerarPlanosEscopo; restauração recusa S90; timers de expurgo/ledger. Mini-app em porta efêmera, banco em memória.
// Rodar: node scripts/teste-sprint90-guarda.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
process.env.PS_OFERTAS_MEMORIA = '1'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { readFileSync } from 'node:fs'
const { guardaLocal, ROTA_PUBLICA_S90 } = await import('../src/lib/guarda-local.js')
const { env } = await import('../src/lib/env.js')
const { rotasPublicas } = await import('../src/rotas-publicas.js')
const { rotasSprint90 } = await import('../src/rotas-sprint90.js')

const HS = 'sprint90.place2u.com.br', HC = 'diagnosticomeli.place2u.com.br', TOKEN = 'A'.repeat(22)
const passa = (path, { host = HS, method = 'GET', origin, hc = HC, hs = HS, originalUrl = path } = {}) => {
  let foi = false, st = 200
  guardaLocal({ method, path, originalUrl, headers: { host, ...(origin ? { origin } : {}) } }, { status(c) { st = c; return this }, send() { return this } }, () => { foi = true }, hc, hs)
  return foi && st === 200
}

// 1) lista fechada no host S90
for (const p of ['/', '/c', '/c/', '/c/entrar', '/c/painel', '/c/termos', '/c/privacidade', '/c/conectar', `/c/acesso/${TOKEN}`, '/c/api/resumo', '/c/api/acoes', '/logo'])
  assert.ok(passa(p), `host S90 abre ${p}`)
for (const p of ['/c/sair', `/c/acesso/${TOKEN}`, '/c/api/aceite', '/c/api/acesso/gerar', '/c/api/dados/excluir'])
  assert.ok(passa(p, { method: 'POST', origin: `https://${HS}` }), `POST da própria origem: ${p}`)
for (const p of ['/cliente', '/api/tarefas', '/api/sprint90/contas', '/comercial', '/diagnostico', `/d/${TOKEN}`, '/c/api/x', '/c/api/resumo/x', '/c/../index.html', '/c/acesso/curto', `/c/acesso/${TOKEN}/x`,
  '/c/painel%2f..%2findex.html', '/c/%2e%2e/app.js', '/index.html', '/app.js', '/ui.css', '/integracoes', '/assets/sprint90/landing.html', '/webhook/mp', '/C/PAINEL', '/c/api', '/c/apix', '/painel'])
  assert.ok(!passa(p), `host S90 NÃO abre ${p}`)
assert.ok(!passa('/c/painel', { originalUrl: '/c/x/..%2f/c/painel' }), '%2f no originalUrl derruba')
// A14 (08/10): host S90 EXCLUSIVO — nem as rotas públicas do ML/webhooks passam por ele (o webhook de custos, montado antes do roteador S90, respondia 401)
for (const p of [`/webhook/custos/${'a'.repeat(16)}`, `/WEBHOOK/CUSTOS/${'a'.repeat(16)}`, '/meli/callback', '/meli/conectar', '/webhook/notion', '/webhook/meli', '/erp/callback'])
  assert.ok(!passa(p) && !passa(p, { method: 'POST', origin: `https://${HS}` }), `host S90 NÃO abre ${p} (rota pública do ML só no host do ML)`)
assert.ok(passa('/c/conectar/fim') && !passa('/c/conectar/fim/x'), 'A1: volta do OAuth concluída no host S90 (/c/conectar/fim, lista fechada)')
// A13: no host S90 (sempre HTTPS) uma origem http:// do mesmo nome é injeção de rede, não a própria origem
assert.ok(!passa(`/c/acesso/${TOKEN}`, { method: 'POST', origin: `http://${HS}` }) && !passa('/c/api/aceite', { method: 'POST', origin: `http://${HS}` }), 'POST com Origin http:// no host S90 = 403')
assert.ok(passa('/c/sair', { host: 'localhost:3012', method: 'POST', origin: 'http://localhost:3012' }), 'loopback segue aceitando a própria origem em http')
assert.ok(!passa('/c/entrar', { host: `${HS}.evil.com` }), 'host parecido não passa')
// 2) outros hosts do túnel não alcançam /c/* nem /webhook/mp; sem a env nada abre
for (const host of [HC, 'meli.place2u.com.br', 'abc-123.trycloudflare.com'])
  for (const p of ['/c/entrar', '/c/painel', '/c/api/acoes', `/c/acesso/${TOKEN}`, '/webhook/mp', '/c/termos'])
    assert.ok(!passa(p, { host }), `${host} não alcança ${p}`)
assert.ok(!passa('/c/entrar', { hs: '' }), 'sem SPRINT90_PUBLIC_HOST nada do Sprint 90 abre')
assert.ok(!passa('/', { hs: '' }))
// 3) CSRF e regressão da assinatura antiga
assert.ok(!passa('/c/sair', { method: 'POST', origin: 'https://evil.example' }), 'POST de outra origem = 403')
assert.ok(!passa('/c/api/aceite', { method: 'POST', origin: `https://${HC}` }), 'POST com origem do host comercial = 403')
{
  let foi = false
  guardaLocal({ method: 'GET', path: '/diagnostico', originalUrl: '/diagnostico', headers: { host: HC } }, { status() { return this }, send() { return this } }, () => { foi = true }, HC)
  assert.ok(foi, 'guardaLocal(req,res,next,hc) antigo segue abrindo a landing comercial')
}
assert.ok(passa('/meli/callback', { host: 'meli.place2u.com.br' }) && passa('/diagnostico', { host: HC }), 'rotas do ML e do comercial intactas')
assert.ok(passa('/cliente', { host: 'localhost:3012' }), 'loopback segue com acesso total')
assert.ok(!ROTA_PUBLICA_S90.flags.includes('i'), 'sem caixa-insensível: /C/PAINEL = 403')

// 4) HTTP: mini-app com a mesma ordem do server.js (guarda → json → rotasPublicas → rotasSprint90 → rotas internas → estático)
const envOriginal = { ...env }
env.SPRINT90_PUBLIC_HOST = HS; env.COMERCIAL_PUBLIC_HOST = HC
const app = express()
app.use((req, res, next) => guardaLocal(req, res, next, HC, HS)); app.use(express.json()); app.use(rotasPublicas); app.use(rotasSprint90)
app.get('/api/tarefas', (req, res) => res.send('INTERNO')); app.use((req, res) => res.send('ESTATICO'))
const srv = await new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
const porta = srv.address().port
const get = (path, host = HS) => new Promise((ok, falha) => {
  http.get({ host: '127.0.0.1', port: porta, path, headers: { host } }, res => { let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t })) }).on('error', falha)
})
try {
  let r = await get('/')
  assert.equal(r.status, 200); assert.match(r.text, /<html/i, 'raiz do host S90 = landing (assets/sprint90/landing.html)'); assert.ok(!r.text.includes('ESTATICO'))
  r = await get('/c/entrar'); assert.equal(r.status, 200); assert.match(r.text, /Place Sprint 90/); assert.match(r.headers['content-security-policy'], /script-src 'nonce-/); assert.equal(r.headers['x-frame-options'], 'DENY')
  r = await get('/c/termos'); assert.equal(r.status, 200); r = await get('/c/privacidade'); assert.equal(r.status, 200); assert.match(r.text, /Privacidade/i)
  r = await get('/c/api/resumo'); assert.equal(r.status, 401); assert.equal(r.headers['cache-control'], 'no-store')
  r = await get('/c/painel'); assert.equal(r.status, 302); assert.equal(r.headers.location, '/c/entrar')
  for (const p of ['/index.html', '/api/tarefas', '/cliente', '/integracoes', '/app.js', '/c/x', '/api/sprint90/contas']) { r = await get(p); assert.equal(r.status, 403, `${p} pelo host S90`); assert.ok(!/INTERNO|ESTATICO/.test(r.text)) }
  for (const p of ['/c/entrar', '/webhook/mp']) { r = await get(p, HC); assert.equal(r.status, 403, `${p} pelo host comercial`) }
  r = await get('/', HC); assert.equal(r.status, 302, 'raiz do host comercial continua indo ao /diagnostico')
  r = await get('/c/entrar', `localhost:${porta}`); assert.equal(r.status, 200, 'loopback alcança o painel (teste local)')
  r = await get('/', `localhost:${porta}`); assert.equal(r.text, 'ESTATICO', 'no loopback "/" segue sendo o painel interno')
  env.SPRINT90_PUBLIC_HOST = ''
  r = await get('/c/entrar', `localhost:${porta}`); assert.equal(r.text, 'ESTATICO', 'sem a env /c/* não existe nem no loopback')
} finally { srv.close(); Object.assign(env, envOriginal) }

// 5) server.js: montagem, callback, restauração e timers
const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
const pos = s => { const i = src.indexOf(s); assert.ok(i >= 0, `server.js sem: ${s}`); return i }
assert.ok(pos('app.use(guardaLocal)') < pos('app.use(rotasPublicas)') && pos('app.use(rotasPublicas)') < pos('app.use(rotasSprint90)') && pos('app.use(rotasSprint90)') < pos("app.use(express.static(join(ROOT, 'src', 'web')))"), 'rotasSprint90 depois de rotasPublicas e antes do estático')
const cb = src.slice(pos("app.get('/meli/callback'"), pos("app.get('/erp/callback'"))
assert.match(cb, /const s90 = ehChaveS90\(v\.cliente\)/)
// A1 (08/10): o callback NÃO troca o código de chave S90 — repassa code + state ao host S90 (/c/conectar/fim), onde só a sessão dona do link conclui.
// Por isso as asserções da conclusão (coleta → acompanhamento → plano, D17, 409) saíram do server.js e valem agora para rotas-sprint90.js → concluirConexaoML.
const ramoCb = cb.slice(cb.indexOf('if (s90) {'), cb.indexOf('const rotulo'))
assert.ok(ramoCb.length > 50 && /\/c\/conectar\/fim/.test(ramoCb) && !/trocarCodigo|salvarConexao/.test(ramoCb) && cb.indexOf('if (s90) {') < cb.indexOf('trocarCodigo('), 'callback: chave S90 vai ao host S90 ANTES de qualquer troca de código')
const rs = readFileSync(new URL('../src/rotas-sprint90.js', import.meta.url), 'utf8')
const ramo = rs.slice(rs.indexOf('async function concluirConexaoML'), rs.indexOf('export const rotasSprint90'))
assert.ok(ramo.length > 200, 'conclusão S90 encontrada')
assert.ok(!/gerarPlanosEscopo/.test(ramo) && /coletarCliente/.test(ramo) && /capturarAcompanhamento/.test(ramo) && /gerarPlanoConta/.test(ramo), 'conclusão S90: coleta → acompanhamento → plano, SEM gerarPlanosEscopo')
assert.match(ramo, /link: '\/integracoes'/, 'aviso interno aponta para /integracoes (a chave não está na central)')
assert.match(ramo, /s90\.aoConectar\(chave, tok\.user_id, tok\.app_id\)/, 'vendedor duplicado checado na transação')
assert.match(ramo, /if \(duplicado\.revogar\) revogarAutorizacao/, 'token recém-obtido revogado só quando não derruba outra conexão')
assert.match(ramo, /status: 409/)
// A15: /meli/conectar recusa chave S90 fora de serviço ANTES de levar ao consentimento do ML
const conectar = src.slice(pos("app.get('/meli/conectar'"), pos("app.get('/meli/callback'"))
assert.ok(conectar.indexOf('ehChaveS90(v.cliente) && (!hostS90Publico() || !s90lib.podeConectar(v.cliente))') > 0 && conectar.indexOf('podeConectar') < conectar.indexOf('urlAutorizacao('), '/meli/conectar: S90 desligado ou conta não ativa = 410 antes do ML')
// A16: o callback nunca ecoa error_description
assert.ok(!/error_description(\s*\|\||\s*[,}])/.test(cb) && /error === 'access_denied' \? 'Autorização recusada no Mercado Livre\.'/.test(cb), 'callback: texto fixo, nunca o error_description da query')
// A6/A17/A27: corpo comprimido recusado ANTES do parser; nenhuma tela emoldurável por outro site; sem X-Powered-By
assert.ok(pos("res.status(415).json({ erro: 'corpo comprimido não é aceito' })") < pos("app.use(express.json({ limit: '1mb' }))") && pos("app.use(guardaLocal)") < pos("'X-Frame-Options': 'SAMEORIGIN'"), 'gzip barrado antes do JSON; XFO depois da guarda')
assert.match(src, /app\.disable\('x-powered-by'\)/)
// A18/A20: coleta só de conta em serviço; ledger independente do expurgo
assert.ok(/for \(const c of listarConexoesColeta\(\)\)/.test(src) && /\.filter\(x => emColeta\.has\(x\.cliente\)\)/.test(src), 'coleta e promoções de madrugada só com conta em serviço (listarConexoesColeta: S90 cancelada fora)')
assert.match(src, /\.finally\(\(\) => \{ try \{ const l = s90lib\.exportarLedger\(hojeLocal\(\)\)/, 'ledger do dia sai mesmo se o expurgo lançar')
assert.match(src, /restauravel: !ehChaveProspecto\(req\.body\.cliente\) && !ehChaveS90\(req\.body\.cliente\)/)
assert.match(src, /s90lib\.expurgar\(\)/); assert.match(src, /s90lib\.exportarLedger\(hojeLocal\(\)\)/); assert.match(src, /getEstado\('s90_tick_dia'\)/)
// A11: fragmento único para as visões internas da equipe tirarem a conta S90 (aplicação em rotas-planos/merovingio/impacto-tarefas: outras frentes)
{
  const { NAO_S90_SQL, S90_FORA_DA_COLETA_SQL, semChaveS90 } = await import('../src/lib/s90-chave.js')
  const { db } = await import('../src/lib/db.js')
  db.exec("CREATE TEMP TABLE t_a11 (cliente TEXT)"); db.prepare("INSERT INTO t_a11 VALUES ('Cliente Central'), ('[S90] Loja · 0123abcd'), ('[Comercial] P · 0123abcd')").run()
  assert.deepEqual(db.prepare(`SELECT cliente FROM t_a11 WHERE ${NAO_S90_SQL} ORDER BY cliente`).all().map(r => r.cliente), ['Cliente Central', '[Comercial] P · 0123abcd'])
  assert.ok(S90_FORA_DA_COLETA_SQL.includes("'ativo','pausado','inadimplente'"))
  // A3/A7: log() mascara a chave S90 (stdout vira data/server.log, que a exclusão não alcança)
  assert.equal(semChaveS90('coleta diária ML ok — [S90] Loja Secreta · 40d6873f; de novo [S90] Outra - Loja · 0badc0de'), 'coleta diária ML ok — Sprint 90 40d6873f; de novo Sprint 90 0badc0de')
}
// PLANO ATIVO 4: "É intencional" entra na lista fechada de forma ESTRITA — só POST /c/api/acoes/{16 hex minúsculos}/intencional; nada de prefixo aberto nem do id interno
{
  const R = 'a1b2c3d4e5f60718'
  assert.ok(passa(`/c/api/acoes/${R}/intencional`, { method: 'POST', origin: `https://${HS}` }), 'POST da própria origem no formato exato')
  assert.ok(ROTA_PUBLICA_S90.test(`/c/api/acoes/${R}/intencional`))
  for (const p of [`/c/api/acoes/${R}`, `/c/api/acoes/${R}/intencional/x`, `/c/api/acoes/${R.toUpperCase()}/intencional`, `/c/api/acoes/${R.slice(1)}/intencional`, `/c/api/acoes/${R}0/intencional`,
    '/c/api/acoes/PS-0123456789/intencional', `/c/api/acoes/${R}/descartar`, `/c/api/acoes/${R}/intencional%2f..`, `/c/api/acoes//intencional`, `/C/API/ACOES/${R}/INTENCIONAL`])
    assert.ok(!passa(p, { method: 'POST', origin: `https://${HS}` }), `host S90 NÃO abre ${p}`)
  assert.ok(!passa(`/c/api/acoes/${R}/intencional`, { method: 'POST', origin: 'https://evil.example' }), 'CSRF barrado também na rota nova')
  assert.ok(!passa(`/c/api/acoes/${R}/intencional`, { host: HC, method: 'POST' }), 'o host comercial não alcança a rota nova')
  // ciclo de vida da marca: GET /c/api/intencionais e POST /c/api/intencionais/{16 hex}/desfazer, formato exato
  assert.ok(passa('/c/api/intencionais'), 'lista das marcas do cliente')
  assert.ok(passa(`/c/api/intencionais/${R}/desfazer`, { method: 'POST', origin: `https://${HS}` }), 'desfazer da própria origem')
  for (const p of [`/c/api/intencionais/${R}`, `/c/api/intencionais/${R}/desfazer/x`, `/c/api/intencionais/${R.toUpperCase()}/desfazer`, `/c/api/intencionais/${R.slice(1)}/desfazer`, '/c/api/intencionais/1/desfazer', `/c/api/intencionais/${R}/encerrar`, '/c/api/intencionaisx'])
    assert.ok(!passa(p, { method: 'POST', origin: `https://${HS}` }), `host S90 NÃO abre ${p}`)
  assert.ok(!passa(`/c/api/intencionais/${R}/desfazer`, { method: 'POST', origin: 'https://evil.example' }), 'CSRF barrado no desfazer')
}
console.log('✔ sprint90-guarda: host S90 abre só a lista fechada e é exclusivo (rotas públicas do ML/webhooks = 403 nele), Origin http:// barrado no host S90, outros hosts não alcançam /c/* nem /webhook/mp, sem a env nada abre, CSRF barrado, assinatura antiga intacta; server.js monta antes do estático, callback S90 só repassa ao host S90 (troca no /c/conectar/fim, sem gerarPlanosEscopo), /meli/conectar recusa S90 inativa, sem eco de error_description, gzip recusado antes do parser, XFO, sem X-Powered-By, coleta só de conta em serviço, ledger independente; restauração recusa S90 e timers de expurgo/ledger')
