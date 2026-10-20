// Autoteste ponta a ponta com o src/server.js REAL (achados de segurança de 08/10): o OAuth do ML da conta S90 só conclui com a sessão dona do link (A1),
// conexão antiga da central (app_id '') não é revogada (A2), /meli/conectar recusa S90 inativa antes do ML (A15), callback sem eco de error_description (A16),
// corpo gzip recusado antes do parser (A6), host S90 exclusivo (A14), http → https + HSTS (A10), __Host-s90 (A13), raiz → painel (A26), XFO (A17), sem
// X-Powered-By (A27) e config inválida desliga só o Sprint 90 (A25). Banco em memória, porta aleatória (nunca a 3012), fetch falso: nada chama o ML.
// O processo sai no fim (o server.js liga timers). Rodar: node scripts/teste-sprint90-oauth.mjs
const HS = 'sprint90.test', HM = 'meli.test'
Object.assign(process.env, {
  PS_DB_MEMORIA: '1', PORT: '0',                                       // só o banco principal em memória: ofertas/promoções/perfil usam o MESMO handle (db.js)
  SPRINT90_PUBLIC_HOST: HS, PUBLIC_BASE_URL: `https://${HM}`, MELI_CLIENT_ID: 'APP-PRINCIPAL', MELI_CLIENT_SECRET: 'segredo-teste', MELI_LINK_SECRET: 'link-teste',
  MELI_TOKEN_KEY: 'chave-teste', MELI_CLIENT_ID_COMERCIAL: '', MELI_CLIENT_SECRET_COMERCIAL: '', NOTION_TOKEN: '', ANTHROPIC_API_KEY: '', COMERCIAL_PUBLIC_HOST: '',
  COMERCIAL_CONTATO_LGPD: '', ERP_TOKEN_KEY: '', WEBHOOK_SECRET: '',
})
import assert from 'node:assert/strict'
import http from 'node:http'
import { gzipSync } from 'node:zlib'
import { execFileSync } from 'node:child_process'

// ML falso: oauth/token devolve o vendedor da vez; /users/:id o apelido; DELETE (revogação) registrado; o resto do ML responde vazio; fora do ML = erro
const rede = []
let vendedor = 222
globalThis.fetch = async (url, o = {}) => {
  const u = String(url), m = (o.method || 'GET').toUpperCase(), json = (st, b) => new Response(JSON.stringify(b), { status: st, headers: { 'content-type': 'application/json' } })
  rede.push(`${m} ${u}`)
  if (u === 'https://api.mercadolibre.com/oauth/token') return json(200, { access_token: `TK-${vendedor}`, refresh_token: `RF-${vendedor}`, expires_in: 21600, scope: 'offline_access read write', user_id: vendedor, token_type: 'bearer' })
  if (m === 'DELETE') return json(200, {})
  if (/^https:\/\/api\.mercadolibre\.com\/users\/\d+$/.test(u)) return json(200, { id: vendedor, nickname: `NICK-${vendedor}` })
  if (u.startsWith('https://api.mercadolibre.com/')) return json(200, { results: [], paging: { total: 0 } })
  throw new Error('rede bloqueada no teste')
}
const listen0 = http.Server.prototype.listen
let servidor
http.Server.prototype.listen = function (...a) { servidor = this; return listen0.apply(this, a) }
const log0 = console.log; console.log = () => {}                         // o server.js e as coletas em segundo plano falam muito
await import('../src/server.js')
http.Server.prototype.listen = listen0
await new Promise(ok => servidor.listening ? ok() : servidor.once('listening', ok))
const porta = servidor.address().port
assert.notEqual(porta, 3012)
const { s90 } = await import('../src/rotas-sprint90.js')
const { db } = await import('../src/lib/db.js')
const MC = await import('../src/lib/meli-contas.js')
const { linkConectar } = await import('../src/lib/meli-link.js')

const pedir = (method, path, { host = HS, cookie, body, bruto, origin, headers = {} } = {}) => new Promise((ok, falha) => {
  const dados = bruto ?? (body ? Buffer.from(JSON.stringify(body)) : null)
  const r = http.request({ host: '127.0.0.1', port: porta, method, path, headers: { host, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}), ...headers } }, res => {
    let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t }))
  })
  r.on('error', falha); if (dados) r.write(dados); r.end()
})
const ativa = loja => { const c = s90.cadastrar({ nome: 'Titular', loja, email: 't@x.com', plano: 'fixo' }, { por: 'teste', piloto: true }); s90.registrarAceite(c.id, { aceite: true, consentimento: true }); return s90.mudarEstado(c.id, 'ativo', { por: 'teste' }) }
const login = async id => { const r = await pedir('POST', `/c/acesso/${s90.gerarAcesso(id).token}`, { origin: `https://${HS}` }); assert.equal(r.status, 303); return r.headers['set-cookie'][0].split(';')[0] }
const caminho = url => { const u = new URL(url); return u.pathname + u.search }
// /c/conectar → link do ML (host do ML) → state do consentimento
async function iniciar(ck, host = HS) {
  const r1 = await pedir('GET', '/c/conectar', { cookie: ck, host }); assert.equal(r1.status, 302)
  const r2 = await pedir('GET', caminho(r1.headers.location), { host: HM }); assert.equal(r2.status, 302); assert.match(r2.headers.location, /^https:\/\/auth\.mercadolivre\.com\.br\/authorization\?/)
  return new URL(r2.headers.location).searchParams.get('state')
}
const tokens = () => rede.filter(x => x.endsWith('/oauth/token')).length

try {
  // ── A1: o link é um bearer? Não: a vítima autoriza, o callback só repassa ao host S90, e lá sem a sessão dona nada é trocado nem gravado ──
  const atacante = ativa('Loja Atacante'), ckAt = await login(atacante.id)
  assert.match(ckAt, /^__Host-s90=/, 'A13: cookie __Host- no host S90')
  const st = await iniciar(ckAt)
  vendedor = 222
  let r = await pedir('GET', `/meli/callback?${new URLSearchParams({ code: 'CODE-222', state: st })}`, { host: HM })
  assert.equal(r.status, 302); assert.ok(r.headers.location.startsWith(`https://${HS}/c/conectar/fim?`), 'A1: callback de chave S90 repassa code+state ao host S90')
  assert.equal(tokens(), 0, 'A1: o callback NÃO troca o código')
  const fim = caminho(r.headers.location)
  r = await pedir('GET', fim)                                            // o navegador da vítima: sem a sessão do atacante
  assert.equal(r.status, 302); assert.equal(r.headers.location, '/c/entrar')
  assert.equal(tokens(), 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_contas WHERE meli_user_id = 222').get().n, 0, 'A1: o vendedor da vítima NÃO foi ligado à conta do atacante')
  const r5 = await pedir('GET', caminho(linkConectar(atacante.chave, 10 / 1440)), { host: HM })
  assert.equal(r5.status, 302, '(o link do ML em si continua abrindo o consentimento: o que mudou é que ele não conclui sem a sessão)')
  // a dona do link conclui (fluxo legítimo): troca, grava e volta ao painel
  r = await pedir('GET', fim, { cookie: ckAt }); assert.equal(r.status, 303); assert.equal(r.headers.location, '/c/painel?conectado=1')
  assert.equal(tokens(), 1); assert.equal(MC.statusConexao(atacante.chave).meli_user_id, 222)
  r = await pedir('GET', fim, { cookie: ckAt }); assert.equal(r.status, 403, 'A1: a volta é de uso único'); assert.equal(tokens(), 1)

  // ── A2: vendedor da central com conexão ANTIGA (app_id '') tentando o S90 → 409 sem revogar o app principal (derrubaria a central) ──
  MC.salvarConexao('Cliente Legado', { user_id: 333, access_token: 'a', refresh_token: 'b', expires_in: 21600, scope: 'read write', app_id: '' }, { nickname: 'L' })
  const b = ativa('Loja B'), ckB = await login(b.id)
  const stB = await iniciar(ckB)
  vendedor = 333; rede.length = 0
  r = await pedir('GET', `/meli/callback?${new URLSearchParams({ code: 'CODE-333', state: stB })}`, { host: HM })
  r = await pedir('GET', caminho(r.headers.location), { cookie: ckB })
  assert.equal(r.status, 409); assert.match(r.text, /já está conectada em outro cadastro/)
  await new Promise(ok => setTimeout(ok, 50))
  assert.ok(!rede.some(x => x.startsWith('DELETE')), 'A2: nenhum DELETE no app principal do vendedor da central')
  assert.equal(MC.statusConexao('Cliente Legado').meli_user_id, 333)

  // ── A15: S90 pausada (ou inexistente) nem chega ao consentimento do ML ──
  const pausada = ativa('Loja Pausada'); s90.mudarEstado(pausada.id, 'pausado', { por: 'teste' })
  for (const chave of [pausada.chave, '[S90] Loja Fantasma · 0123abcd']) {
    r = await pedir('GET', caminho(linkConectar(chave, 1)), { host: HM })
    assert.equal(r.status, 410, 'A15: 410 antes do ML'); assert.ok(!r.headers.location)
  }

  // ── A16: error_description nunca vira texto da página com a marca da Place2u ──
  r = await pedir('GET', `/meli/callback?${new URLSearchParams({ error: 'access_denied', error_description: 'Sua assinatura Place2u foi suspensa. Regularize via PIX chave 11999990000', state: stB })}`, { host: HM })
  assert.equal(r.status, 200); assert.ok(!/PIX|suspensa/.test(r.text), 'A16: sem eco do error_description'); assert.match(r.text, /Autorização recusada no Mercado Livre/)
  r = await pedir('GET', `/meli/callback?${new URLSearchParams({ error: 'server_error', error_description: 'Ligue para 0800' })}`, { host: HM })
  assert.ok(!/0800/.test(r.text)); assert.match(r.text, /não concluiu a autorização/)
  assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN', 'A17: página do callback não é emoldurável por outro site')

  // ── A6: gzip (1 KB que infla para 1 MB) recusado ANTES do parser — 415, nunca 401/400 depois de inflar ──
  const bomba = gzipSync(Buffer.from('[' + '{},'.repeat(349000) + '{}]'))
  assert.ok(bomba.length < 5000)
  r = await pedir('POST', '/c/api/aceite', { bruto: bomba, origin: `https://${HS}`, headers: { 'content-encoding': 'gzip' } })
  assert.equal(r.status, 415, 'A6: corpo comprimido = 415 sem inflar')
  r = await pedir('POST', '/c/api/aceite', { bruto: gzipSync(Buffer.from('{x')), origin: `https://${HS}`, headers: { 'content-encoding': 'gzip' } })
  assert.equal(r.status, 415, 'A6: gzip inválido nem chega ao JSON.parse (antes: 400 entity.parse.failed)')
  r = await pedir('POST', '/webhook/meli', { host: HM, bruto: gzipSync(Buffer.from('{}')), headers: { 'content-encoding': 'gzip' } }); assert.equal(r.status, 415, 'A6: idem no host do ML')
  r = await pedir('POST', '/webhook/meli', { host: HM, body: { topic: 'orders' } }); assert.equal(r.status, 200, 'webhook normal segue')

  // ── A14: host S90 exclusivo (webhook de custos, rotas do ML) ──
  for (const [m, p] of [['POST', `/webhook/custos/${'a'.repeat(16)}`], ['POST', `/WEBHOOK/CUSTOS/${'a'.repeat(16)}`], ['GET', '/meli/callback'], ['POST', '/webhook/notion']])
    assert.equal((await pedir(m, p)).status, 403, `A14: ${m} ${p} pelo host S90`)

  // ── A10/A13/A26 pelo servidor real ──
  r = await pedir('GET', '/c/entrar', { headers: { 'x-forwarded-proto': 'http' } }); assert.equal(r.status, 301); assert.equal(r.headers.location, `https://${HS}/c/entrar`)
  r = await pedir('GET', '/c/entrar'); assert.equal(r.headers['strict-transport-security'], 'max-age=31536000'); assert.equal(r.headers['x-frame-options'], 'DENY', 'as páginas /c seguem com DENY')
  assert.equal((await pedir('POST', `/c/acesso/${'A'.repeat(22)}`, { origin: `http://${HS}` })).status, 403, 'A13: Origin http:// no host S90')
  r = await pedir('GET', '/', { cookie: ckAt }); assert.equal(r.status, 302); assert.equal(r.headers.location, '/c/painel', 'A26')

  // ── A17/A27: telas internas não emolduráveis; nenhum X-Powered-By ──
  r = await pedir('GET', '/integracoes', { host: `localhost:${porta}`, headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' } })
  assert.equal(r.status, 200); assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN'); assert.match(r.headers['content-security-policy'], /frame-ancestors 'self'/)
  for (const [h, p] of [[HS, '/c/entrar'], [HS, '/c/api/resumo'], [HS, '/qualquer'], [HM, '/meli/callback'], [`localhost:${porta}`, '/integracoes']])
    assert.ok(!('x-powered-by' in (await pedir('GET', p, { host: h })).headers), `A27: sem X-Powered-By em ${h}${p}`)

  // ── revisão dos céticos (08/10) ──
  const entrar = async (token, { host = HS, ip } = {}) => {   // IP próprio por login: o limite de /c/acesso é 10 por 15 min por IP
    const r = await pedir('POST', `/c/acesso/${token}`, { host, origin: host === HS ? `https://${HS}` : `http://${host}`, headers: ip ? { 'cf-connecting-ip': ip } : {} })
    assert.equal(r.status, 303); return r.headers['set-cookie'][0].split(';')[0]
  }
  const LOCAL = `localhost:${porta}`
  // A1 (regressão do loopback): a sessão aberta em localhost (teste/piloto da equipe, o único jeito antes do DNS do host S90) conclui a conexão —
  // o callback devolve code+state ao host da sessão que pediu o link, não sempre ao host S90 (onde o cookie do loopback nunca chega)
  const lb = ativa('Loja Loopback'), ckLb = await entrar(s90.gerarAcesso(lb.id).token, { host: LOCAL, ip: '10.0.0.1' })
  assert.match(ckLb, /^s90=/, 'no loopback o cookie segue s90 (Path=/c)')
  const stLb = await iniciar(ckLb, LOCAL)
  vendedor = 601
  r = await pedir('GET', `/meli/callback?${new URLSearchParams({ code: 'CODE-601', state: stLb })}`, { host: HM })
  assert.equal(r.status, 302); assert.ok(r.headers.location.startsWith(`http://${LOCAL}/c/conectar/fim?`), 'A1-loopback: volta ao loopback de quem pediu')
  r = await pedir('GET', caminho(r.headers.location), { host: LOCAL, cookie: ckLb })
  assert.equal(r.status, 303); assert.equal(r.headers.location, '/c/painel?conectado=1'); assert.equal(MC.statusConexao(lb.chave).meli_user_id, 601, 'A1-loopback: conexão gravada')
  {
    const stHs = await iniciar(ckAt)                                    // controle: a sessão do host S90 continua voltando ao host S90
    r = await pedir('GET', `/meli/callback?${new URLSearchParams({ code: 'X', state: stHs })}`, { host: HM }); assert.ok(r.headers.location.startsWith(`https://${HS}/c/conectar/fim?`))
  }

  // A1 (incompleto): "Guardar meu acesso" é um link que a sessão gera e pode REPASSAR ("seu painel grátis"). Quem entra por ele não liga o próprio vendedor à conta alheia:
  // sem vendedor na conta, /c/conectar recusa antes do ML; com o vendedor do assinante, a volta com OUTRO vendedor é recusada (nada gravado, token novo revogado)
  const golpe = ativa('Loja Golpe'), ckGolpe = await entrar(s90.gerarAcesso(golpe.id).token, { ip: '10.0.0.2' })
  const guardar = async ck => { const g = await pedir('POST', '/c/api/acesso/gerar', { cookie: ck, body: {}, origin: `https://${HS}` }); assert.equal(g.status, 200); return JSON.parse(g.text).url.split('/').pop() }
  let ckVit = await entrar(await guardar(ckGolpe), { ip: '10.0.0.3' })
  r = await pedir('GET', '/c/conectar', { cookie: ckVit }); assert.equal(r.status, 409, 'A1-incompleto: sessão de "Guardar meu acesso" sem vendedor ligado não conecta')
  assert.match(r.text, /só reconecta a conta do Mercado Livre que já está ligada/); assert.ok(!r.headers.location)
  MC.salvarConexao(golpe.chave, { user_id: 701, access_token: 'a', refresh_token: 'b', expires_in: 21600, scope: 'read write', app_id: 'APP-PRINCIPAL' }, { nickname: 'NICK-701' })
  ckVit = await entrar(await guardar(ckGolpe), { ip: '10.0.0.4' })
  const stVit = await iniciar(ckVit)
  vendedor = 702; rede.length = 0
  r = await pedir('GET', `/meli/callback?${new URLSearchParams({ code: 'CODE-702', state: stVit })}`, { host: HM })
  r = await pedir('GET', caminho(r.headers.location), { cookie: ckVit })
  assert.equal(r.status, 409, 'A1-incompleto: a vítima autorizou, mas o vendedor dela NÃO entra na conta do assinante'); assert.match(r.text, /só reconecta/)
  assert.equal(MC.statusConexao(golpe.chave).meli_user_id, 701); assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_contas WHERE meli_user_id = 702').get().n, 0)
  await new Promise(ok => setTimeout(ok, 50))
  assert.ok(rede.includes('DELETE https://api.mercadolibre.com/users/702/applications/APP-PRINCIPAL'), 'A1-incompleto: a autorização recém-dada não fica viva no ML')
  // o uso legítimo do acesso guardado segue: reconectar o MESMO vendedor
  const stRe = await iniciar(ckVit)
  vendedor = 701
  r = await pedir('GET', `/meli/callback?${new URLSearchParams({ code: 'CODE-701', state: stRe })}`, { host: HM })
  r = await pedir('GET', caminho(r.headers.location), { cookie: ckVit }); assert.equal(r.status, 303, 'acesso guardado reconecta o vendedor já ligado'); assert.equal(MC.statusConexao(golpe.chave).meli_user_id, 701)

  // A7 (resíduo): webhook de vendedor sem conexão aqui (excluído com a revogação não confirmada, desconectado, inventado) não é guardado
  const notifs = u => db.prepare('SELECT COUNT(*) n FROM meli_notificacoes WHERE user_id = ?').get(u).n
  for (let i = 0; i < 3; i++) assert.equal((await pedir('POST', '/webhook/meli', { host: HM, body: { topic: 'orders', resource: '/orders/1', user_id: 7002, application_id: 'APP-PRINCIPAL' } })).status, 200)
  assert.equal(notifs('7002'), 0, 'A7: vendedor sem conexão = nada guardado em meli_notificacoes')
  await pedir('POST', '/webhook/meli', { host: HM, body: { topic: 'orders', resource: '/orders/2', user_id: 701, application_id: 'APP-PRINCIPAL' } })
  assert.equal(notifs('701'), 1, 'vendedor conectado segue registrado')
} finally { servidor.close(); console.log = log0 }

// ── A25: config/sprint90.json com erro de digitação desliga SÓ o Sprint 90 (o import não lança) ──
{
  const pre = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const o = fs.readFileSync;
fs.readFileSync = function (p, ...r) { return String(p).endsWith('config/sprint90.json') ? '{"versao": "1.0.0",,}' : o.call(this, p, ...r) }; syncBuiltinESMExports()`
  const saida = execFileSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(pre), '--input-type=module', '-e',
    "const m = await import('./src/rotas-sprint90.js'); console.log('HOST=' + JSON.stringify(m.hostS90Publico()))"],
  { cwd: new URL('..', import.meta.url), env: { ...process.env, SPRINT90_PUBLIC_HOST: HS }, encoding: 'utf8' })
  assert.match(saida, /HOST=""/, 'A25: config inválida = Sprint 90 desligado, servidor de pé')
  // regressão da correção: com a env definida e a config inválida, a guarda segue reservando o host S90 (lista fechada, com "/") — o roteador fecha
  // TUDO desse host (503), nada cai no estático (que serviria o painel interno em "/"); Integrações recebe o motivo real (503), não "falta a env"
  const filho = `const http = await import('node:http'); globalThis.fetch = async () => { throw new Error('rede bloqueada') }
const l0 = http.Server.prototype.listen; let srv; http.Server.prototype.listen = function (...a) { srv = this; return l0.apply(this, a) }
console.log = () => {}; await import('./src/server.js'); await new Promise(ok => srv.listening ? ok() : srv.once('listening', ok))
const porta = srv.address().port, HS = process.env.SPRINT90_PUBLIC_HOST, out = {}
const get = (path, host) => new Promise((ok, f) => http.get({ host: '127.0.0.1', port: porta, path, headers: { host } }, r => { let t = ''; r.on('data', c => t += c); r.on('end', () => ok({ s: r.statusCode, interno: /Painel executivo/.test(t), t: t.slice(0, 300) })) }).on('error', f))
for (const [k, p, h] of [['raiz', '/', HS], ['painel', '/c/painel', HS], ['entrar', '/c/entrar', HS], ['app', '/app.js', HS], ['api', '/api/tarefas', HS], ['contas', '/api/sprint90/contas', 'localhost:' + porta], ['local', '/', 'localhost:' + porta]]) out[k] = await get(p, h)
process.stdout.write('RES=' + JSON.stringify(out) + '\\n', () => process.exit(0))`
  const res = JSON.parse(execFileSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(pre), '--input-type=module', '-e', filho],
    { cwd: new URL('..', import.meta.url), env: { ...process.env, SPRINT90_PUBLIC_HOST: HS }, encoding: 'utf8', timeout: 60e3 }).split('RES=').pop())
  for (const k of ['raiz', 'painel', 'entrar']) { assert.equal(res[k].s, 503, `A25: ${k} no host S90 com config inválida = 503`); assert.ok(!res[k].interno, `A25: ${k} nunca é o painel interno`) }
  assert.equal(res.app.s, 403); assert.equal(res.api.s, 403)
  assert.equal(res.contas.s, 503); assert.match(res.contas.t, /config\/sprint90\.json inválido/, 'A25: Integrações recebe o motivo real')
  assert.equal(res.local.s, 200); assert.ok(res.local.interno, 'controle: no loopback "/" segue o painel interno')
}
console.log('✔ sprint90-oauth (server.js real): OAuth S90 só conclui com a sessão dona do link (uso único, 10 min; o callback nem troca o código; volta ao loopback de quem pediu), acesso guardado só reconecta o vendedor já ligado, webhook de vendedor sem conexão não é guardado, central com app_id "" não é revogada, /meli/conectar recusa S90 inativa antes do ML, callback sem eco de error_description, gzip = 415 antes do parser, host S90 exclusivo, http → https + HSTS, __Host-s90, raiz → painel, XFO SAMEORIGIN, sem X-Powered-By, config inválida desliga só o Sprint 90 (host S90 = 503, nunca o painel interno)')
process.exit(0)
