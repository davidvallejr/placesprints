// Autoteste do diagnóstico comercial PÚBLICO (diagnosticomeli.place2u.com.br).
// Foco em SEGURANÇA: a guarda só abre as rotas comerciais pelo host exato; o painel segue fechado;
// lead exige consentimento; token de 128 bits; anti-abuso; exclusão pelo titular (com revogação no ML).
// Sobe um mini-app em porta efêmera (127.0.0.1) — sem Notion, sem OAuth real, sem chamar o ML
// (a revogação é injetada); limpa o que criou.
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import { db, log } from '../src/lib/db.js'
import { env } from '../src/lib/env.js'
import { guardaLocal } from '../src/lib/guarda-local.js'
import { rotasPublicas, podeCadastrar, chaveIp, _resetLimites, corpoResultado, linkWhatsApp, CFG_PUBLICO } from '../src/rotas-publicas.js'
import { cadastrarProspecto, prospectoPorToken, prospectoRecentePorEmail, ehChaveProspecto, removerProspecto,
  expurgarLeadsAbandonados, limparConexoesOrfas, _revogacao, coletaEmCurso, listarCadastrosTeste, apagarCadastrosTeste, MSG_LIMITE_EMAIL, utmLimpa, CAMPOS_FORMULARIO, formularioLimpo } from '../src/lib/comercial.js'
import { readFileSync, readdirSync } from 'node:fs'
import { GTM_ID } from '../src/lib/gtm.js'
import { salvarConexao, statusConexao } from '../src/lib/meli-contas.js'
import { urlAutorizacao } from '../src/lib/meli-oauth.js'

const HC = 'diagnosticomeli.place2u.com.br'
const TOKEN = 'A'.repeat(22)
const limpar = () => {
  db.prepare("DELETE FROM meli_contas WHERE cliente LIKE '[Comercial] __teste_publico__%'").run()
  db.prepare("DELETE FROM prospectos WHERE empresa LIKE '__teste_publico__%' OR email IN ('u@u.com','rep@teste.com')").run()
  db.prepare("DELETE FROM sync_log WHERE instr(msg, '[Comercial] __teste_publico__') > 0").run()
}
// conexão FALSA (tokens cifrados de mentira): nunca é usada contra o ML — a revogação está injetada
const conectarFalso = chave => salvarConexao(chave, { user_id: 999, access_token: 'tk-falso', refresh_token: 'rf-falso', expires_in: 21600, scope: 'read', app_id: 'app-teste' }, { nickname: '' })
_revogacao(async () => false)                                        // nada abaixo chama o ML de verdade

// env determinístico: infra do ML "pronta" (só gera links assinados; nada sai da máquina) e SEM app comercial
const envOriginal = { ...env }
env.MELI_CLIENT_ID ||= 'app-teste-principal'; env.PUBLIC_BASE_URL ||= 'https://exemplo.test'
env.MELI_CLIENT_ID_COMERCIAL = ''; env.MELI_CLIENT_SECRET_COMERCIAL = ''

// 1) GUARDA (função pura)
const passa = (path, { host = HC, method = 'GET', origin, hc = HC } = {}) => {
  let foi = false, st = 200
  guardaLocal({ method, path, originalUrl: path, headers: { host, ...(origin ? { origin } : {}) } },
    { status(c) { st = c; return this }, send() { return this } }, () => { foi = true }, hc)
  return foi && st === 200
}
assert.ok(passa('/diagnostico'), 'landing pública pelo host comercial')
assert.ok(passa(`/d/${TOKEN}`) && passa(`/d/${TOKEN}/excluir`, { method: 'POST', origin: `https://${HC}` }))
assert.ok(passa('/logo'))
assert.ok(passa('/'), 'raiz do host comercial passa (só para redirecionar à landing)')
assert.ok(!passa('/', { host: 'meli.place2u.com.br' }), 'raiz por outro host segue bloqueada')
assert.ok(passa(`/d/${TOKEN}/contato`, { method: 'POST', origin: `https://${HC}` }), 'lead pode pedir contato')
for (const p of ['/comercial', '/cliente', '/analistas', '/planos', '/api/comercial/prospectos', '/api/planos/equipe', '/api/tarefas', '/comercial.js', '/d/curto', `/d/${TOKEN}/outra`])
  assert.ok(!passa(p), `painel/rota interna NÃO pode passar pelo host comercial: ${p}`)
// Place Sprint 90 (F1): o painel do cliente e o webhook do MP só existem no host S90 — o host comercial nunca os alcança
for (const p of ['/c/painel', '/c/entrar', '/c/api/acoes', `/c/acesso/${TOKEN}`, '/webhook/mp'])
  assert.ok(!passa(p), `Sprint 90 NÃO pode passar pelo host comercial: ${p}`)
assert.ok(!passa('/diagnostico', { host: 'meli.place2u.com.br' }), 'outro host do túnel não serve a landing')
assert.ok(!passa('/diagnostico', { hc: '' }), 'sem COMERCIAL_PUBLIC_HOST nada é exposto')
assert.ok(!passa('/diagnostico', { host: 'diagnosticomeli.place2u.com.br.evil.com' }))
assert.ok(!passa('/diagnostico', { method: 'POST', origin: 'https://evil.example' }), 'CSRF de outra origem bloqueado')
assert.ok(passa('/diagnostico', { method: 'POST', origin: `https://${HC}` }), 'POST da própria landing passa')
assert.ok(passa('/meli/conectar'), 'OAuth do ML continua alcançável')
assert.ok(passa('/comercial', { host: 'localhost:3012' }), 'localhost segue com acesso total')

// 2) DADOS DO LEAD
limpar()
try {
  assert.throws(() => cadastrarProspecto({ nome: 'X', empresa: '__teste_publico__ a', origem: 'publico', consentimento: false }), /aceitar/)
  const p = cadastrarProspecto({ nome: 'Ana Teste', empresa: '__teste_publico__ Loja', email: 'ana@teste.com', origem: 'publico', consentimento: true })
  assert.match(p.token_publico, /^[A-Za-z0-9_-]{22}$/, 'token de 128 bits')
  assert.equal(p.origem, 'publico'); assert.ok(p.consentimento_em && p.consentimento_versao)
  assert.equal(p.consentimento_versao, 'lgpd-v2-2026-10', 'versão do termo sem app comercial (sem "-ro")')
  assert.ok(ehChaveProspecto(p.chave_conexao) && !ehChaveProspecto('Damar Comercial'))
  assert.equal(prospectoPorToken(p.token_publico).id, p.id)
  assert.equal(prospectoPorToken('x'), null); assert.equal(prospectoPorToken(TOKEN), null)
  assert.equal(prospectoRecentePorEmail('ANA@teste.com').id, p.id, 'dedupe por e-mail (24h, sem caixa)')
  const c = cadastrarProspecto({ nome: 'Closer', empresa: '__teste_publico__ closer' })
  assert.equal(c.origem, 'closer'); assert.equal(c.consentimento_em, '')

  // 3) ANTI-ABUSO
  _resetLimites()
  const alertas = [], alertar = m => alertas.push(m)
  for (let i = 0; i < 5; i++) assert.ok(podeCadastrar('1.2.3.4', undefined, alertar))
  assert.ok(!podeCadastrar('1.2.3.4', undefined, alertar), '6º cadastro/h do mesmo IP bloqueado')
  assert.ok(podeCadastrar('5.6.7.8', undefined, alertar), 'outro IP segue livre')
  // IPv6 agrupado pelo /64 (um /64 dá endereços infinitos)
  assert.equal(chaveIp('2001:db8:1:2::a'), chaveIp('2001:0DB8:0001:0002:ffff:1:2:3'), 'mesmo /64 = mesma chave')
  assert.notEqual(chaveIp('2001:db8:1:2::1'), chaveIp('2001:db8:1:3::1'), '/64 vizinho = outra chave')
  assert.equal(chaveIp('::ffff:1.2.3.4'), '1.2.3.4', 'IPv4 mapeado vira IPv4')
  assert.equal(chaveIp('9.9.9.9'), '9.9.9.9')
  for (let i = 1; i <= 5; i++) assert.ok(podeCadastrar(`2001:db8:1:2::${i}`, undefined, alertar))
  assert.ok(!podeCadastrar('2001:db8:1:2:abcd:ef01:2345:6789', undefined, alertar), 'dois IPv6 do mesmo /64 dividem o limite')
  assert.ok(podeCadastrar('2001:db8:1:3::1', undefined, alertar), 'outro /64 segue livre')
  // teto global: NÃO recusa lead legítimo — só alerta no log (a cada 60 no dia)
  _resetLimites(); alertas.length = 0
  for (let i = 0; i < 130; i++) assert.ok(podeCadastrar(`10.0.${i >> 8}.${i & 255}`, undefined, alertar), `lead ${i + 1} do dia não pode ser recusado pelo volume global`)
  assert.equal(alertas.length, 2); assert.match(alertas[0], /^alerta: volume anormal no diagnóstico público/)
  _resetLimites()

  // 4) HTTP (mini-app com a mesma guarda)
  const app = express()
  app.use((req, res, next) => guardaLocal(req, res, next, HC)); app.use(express.json()); app.use(rotasPublicas)
  const srv = await new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
  const porta = srv.address().port
  // node:http (o fetch do Node não permite sobrescrever o Host — precisamos simular o host público de verdade)
  const req = (method, path, { host = HC, origin, body, ip, cookie, accept } = {}) => new Promise((ok, falha) => {
    const dados = body ? JSON.stringify(body) : null
    const r = http.request({ host: '127.0.0.1', port: porta, method, path, headers: { host, ...(origin ? { origin } : {}), ...(accept ? { accept } : {}), ...(ip ? { 'cf-connecting-ip': ip } : {}), ...(cookie ? { cookie } : {}), ...(dados ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } : {}) } }, res => {
      let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: async () => t, json: async () => JSON.parse(t) }))
    })
    r.on('error', falha); if (dados) r.write(dados); r.end()
  })
  const post = (path, body, { host = HC, ip, cookie } = {}) => req('POST', path, { host, origin: `https://${host}`, body, ip, cookie })
  // formulário completo da referência (docs/landing-referencia.md): e-mail E telefone obrigatórios + nicho, canais, funcionários, faturamento
  const FORM = { telefone: '(13) 99999-0000', nicho: 'Pet shop', canais: ['Mercado Livre', 'Shopee'], funcionarios: '1 a 5', faturamento: 'R$7mil a R$40mil' }
  const lead = b => ({ ...FORM, ...b })
  const get = (path, host = HC, cookie) => req('GET', path, { host, cookie })
  const excluir = token => req('POST', `/d/${token}/excluir`, { origin: `https://${HC}` })
  try {
    let r = await get('/diagnostico')
    assert.equal(r.status, 200); let html = await r.text()
    assert.ok(html.includes('Autorizo a Place2u') && html.includes('noindex'), 'landing com consentimento LGPD e noindex')
    // sem app comercial, NADA pode prometer "somente leitura" sobre a permissão (o app principal tem escrita)
    assert.ok(!/somente leitura/i.test(html), 'sem MELI_CLIENT_ID_COMERCIAL a landing não diz "somente leitura"')
    assert.ok(html.includes('A tela do Mercado Livre lista as permissões do aplicativo Place2u'), 'texto honesto da permissão')
    r = await post('/diagnostico', lead({ nome: 'Robô', empresa: '__teste_publico__ bot', email: 'b@b.com', website: 'spam', consentimento: true }))
    assert.equal((await r.json()).proximo, '/diagnostico', 'honeypot: robô não cria lead')
    assert.equal(db.prepare("SELECT COUNT(*) n FROM prospectos WHERE empresa = '__teste_publico__ bot'").get().n, 0)
    r = await post('/diagnostico', lead({ nome: 'Sem', empresa: '__teste_publico__ sem', email: 's@s.com', consentimento: false }))
    assert.equal(r.status, 400, 'sem consentimento = 400')
    r = await post('/diagnostico', lead({ nome: 'Sem', empresa: '__teste_publico__ sem', consentimento: true }))
    assert.equal(r.status, 400, 'sem e-mail = 400 (obrigatório como na referência)')
    r = await post('/diagnostico', lead({ nome: 'Sem', empresa: '__teste_publico__ sem', email: 's@s.com', telefone: '', consentimento: true }))
    assert.equal(r.status, 400, 'sem telefone = 400')
    // campos da referência: cada um obrigatório; select/checkbox fora da lista = 400 SEM ecoar o valor
    for (const k of Object.keys(CAMPOS_FORMULARIO)) {
      r = await post('/diagnostico', lead({ nome: 'Sem', empresa: '__teste_publico__ sem', email: 's@s.com', consentimento: true, [k]: k === 'canais' ? [] : '' }), { ip: '9.9.9.9' })
      assert.equal(r.status, 400, `sem ${k} = 400`); assert.ok((await r.json()).erro.includes(CAMPOS_FORMULARIO[k].rotulo), `erro cita o rótulo de ${k}`)
    }
    for (const [k, v] of [['funcionarios', '<script>x'], ['faturamento', 'R$1'], ['canais', ['Mercado Livre', 'TikTok<b>']]]) {
      r = await post('/diagnostico', lead({ nome: 'Sem', empresa: '__teste_publico__ sem', email: 's@s.com', consentimento: true, [k]: v }), { ip: '9.9.9.9' })
      assert.equal(r.status, 400, `${k} fora da lista = 400`); const e = (await r.json()).erro
      assert.ok(e.includes('opção válida') && !/script|R\$1|TikTok|</.test(e), `${k} fora da lista: erro sem eco do valor`)
    }
    assert.deepEqual(formularioLimpo({ nicho: ' Moda ', canais: ['Shopee', 'Shopee'], funcionarios: '6 a 10', faturamento: 'Até R$7.000', extra: 'x' }), { ok: true, dados: { nicho: 'Moda', canais: ['Shopee'], funcionarios: '6 a 10', faturamento: 'Até R$7.000' } }, 'lista fechada, limpa, sem repetição')
    // POST inválido NÃO gasta cota: 6 inválidos do mesmo IP e o válido ainda passa (limite é 5/h)
    for (const corpo of [{ nome: '', empresa: '__teste_publico__ x' }, { nome: 'X', empresa: '   ' }, { nome: '\u0000', empresa: 'y' }, { nome: 'X', empresa: '' }, { nome: '', empresa: '' }, { empresa: 'z' }]) {
      r = await post('/diagnostico', lead({ ...corpo, email: 'i@i.com', consentimento: true }), { ip: '9.9.9.9' })
      assert.equal(r.status, 400, `nome/empresa vazios = 400 (${JSON.stringify(corpo)})`)
    }
    r = await post('/diagnostico', lead({ nome: 'Val', empresa: '__teste_publico__ cota', email: 'v@v.com', consentimento: true }), { ip: '9.9.9.9' })
    assert.equal(r.status, 200, 'POST inválido não gastou a cota do IP')
    // 16/10/2026: a «página de obrigado» É a autorização no ML — o POST devolve o link assinado /meli/conectar (proximo) + id opaco; /d/<token> vem em `resultado`
    let j = await r.json()
    assert.match(j.proximo, /^https?:\/\/[^/]+\/meli\/conectar\?/, 'POST leva direto ao OAuth do ML')
    assert.match(j.resultado, /^\/d\/[A-Za-z0-9_-]{22}$/); assert.match(j.lead_id, /^[0-9a-f]{8}$/)
    assert.equal(prospectoPorToken(j.resultado.slice(3)).empresa, '__teste_publico__ cota')
    assert.ok(!JSON.stringify(j).includes('v@v.com'), 'a resposta não ecoa dado pessoal')
    assert.deepEqual(prospectoPorToken(j.resultado.slice(3)).formulario, { nicho: 'Pet shop', canais: ['Mercado Livre', 'Shopee'], funcionarios: '1 a 5', faturamento: 'R$7mil a R$40mil' }, 'formulario_json gravado no prospect')
    assert.equal(cadastrarProspecto({ nome: 'C', empresa: '__teste_publico__ closer2' }).formulario, null, 'prospect do closer não tem formulário')

    // GTM: em TODAS as páginas públicas (landing, /d, 429), nunca no painel; dataLayer só com id opaco/UTM
    html = await (await get('/diagnostico')).text()
    assert.ok(html.includes(`'dataLayer','${GTM_ID}'`) && html.includes(`ns.html?id=${GTM_ID}`) && html.includes('"event":"lead_form_view"') && html.includes("dl('lead_form_submit')") && html.includes("dl('ml_connect_start'"), 'landing com GTM (head + noscript) e eventos do formulário')
    for (const f of readdirSync('src/web').filter(f => /\.(html|js)$/.test(f))) assert.ok(!readFileSync('src/web/' + f, 'utf8').includes('googletagmanager'), `painel interno sem GTM: ${f}`)
    // comunicação absorvida da landing do WordPress (lp.place2u.com.br/analise-diagnostica) + formulário nosso intacto
    for (const t of ['Descubra o que está limitando seus resultados no Mercado Livre com uma análise diagnóstica.', '+1000 empresas atendidas', '(4.8 de 5) em avaliações', 'logo_place_branco', 'Poppins', 'Perguntas frequentes', 'O que você recebe', 'id="nome"', 'id="empresa"', 'id="email"', 'id="telefone"', 'id="website"', 'id="consent"',
      'indica campos obrigatórios', '>ENVIAR<', '© Todos os direitos Reservados a Place2u.', 'CNPJ: 34.243.829/0001-37'])
      assert.ok(html.includes(t), `landing: faltou "${t}"`)
    // os 8 campos da referência (docs/landing-referencia.md), na mesma ordem, com rótulos, opções e obrigatório
    const ordem = ['for="nome">Nome <', 'for="email">E-mail <', 'for="telefone">Telefone <', 'for="empresa">Nome da empresa <', 'for="nicho">Nicho em que atua <', 'Já vende nos marketplaces? Se sim, quais?', 'for="funcionarios">Quantos funcionários tem na sua empresa? <', 'for="faturamento">O faturamento mensal da sua empresa? (Loja Física e online) <']
    let pos = -1; for (const t of ordem) { const i = html.indexOf(t); assert.ok(i > pos, `landing: campo "${t}" ausente ou fora da ordem da referência`); pos = i }
    for (const k of ['nome', 'email', 'telefone', 'empresa', 'nicho', 'funcionarios', 'faturamento']) assert.match(html, new RegExp(`<(input|select)[^>]*id="${k}"[^>]*required`), `${k} obrigatório`)
    for (const [k, c] of Object.entries(CAMPOS_FORMULARIO)) if (c.opcoes) for (const o of c.opcoes) assert.ok(html.includes(`value="${o}"`), `opção "${o}" de ${k}`)
    assert.equal((html.match(/name="canais"/g) || []).length, 8, '8 checkboxes de canais'); assert.ok(!html.includes('placeholder='), 'sem placeholder, como na referência')
    assert.ok(!html.includes('Pet shop') && !/dataLayer\.push\(\{[^}]*(nicho|faturamento|funcionarios)/.test(html), 'página pública e dataLayer sem os dados do formulário')
    // UTMs: 1º toque vira cookie de 30 d; o cadastro grava utm_json; a visita sem UTM não apaga a campanha de origem
    r = await get('/diagnostico?utm_source=insta&utm_medium=social&utm_campaign=out26&gclid=abc&utm_term=<x>&foo=bar')
    const sc = String(r.headers['set-cookie'] || '')
    assert.match(sc, /^ps_utm=.*Max-Age=2592000; Path=\/; SameSite=Lax/, 'cookie 1st-party de 30 dias')
    const cookie = sc.split(';')[0]
    assert.ok(!decodeURIComponent(cookie).includes('foo') && !decodeURIComponent(cookie).includes('<'), 'só a lista fechada de chaves, valores limpos')
    r = await get('/diagnostico', HC, cookie); assert.equal(r.headers['set-cookie'], undefined, 'cookie já existente não é reescrito')
    assert.ok((await r.text()).includes('"utm_source":"insta"') , 'lead_form_view leva as UTMs')
    r = await post('/diagnostico', lead({ nome: 'Utm', empresa: '__teste_publico__ utm', email: 'u@u.com', consentimento: true }), { ip: '7.7.7.7', cookie })
    assert.equal(r.status, 200); j = await r.json()
    const pu = prospectoPorToken(j.resultado.slice(3))
    assert.deepEqual(pu.utm, { utm_source: 'insta', utm_medium: 'social', utm_campaign: 'out26', utm_term: 'x', gclid: 'abc' }, 'UTMs gravadas no cadastro')
    assert.deepEqual(utmLimpa({ utm_source: ' a ', utm_medium: '', x: 1 }), { utm_source: 'a' })
    // 3 cadastros/24 h por e-mail: o 4º recebe 429 com mensagem FIXA (IPs diferentes: o limite é do e-mail)
    _resetLimites()
    for (let i = 1; i <= 3; i++) { r = await post('/diagnostico', lead({ nome: 'Rep', empresa: `__teste_publico__ rep${i}`, email: 'REP@teste.com', consentimento: true }), { ip: `8.8.8.${i}` }); assert.equal(r.status, 200, `cadastro ${i} do e-mail passa`) }
    r = await post('/diagnostico', lead({ nome: 'Rep', empresa: '__teste_publico__ rep4', email: 'rep@teste.com', consentimento: true }), { ip: '8.8.8.9' })
    assert.equal(r.status, 429); assert.equal((await r.json()).erro, MSG_LIMITE_EMAIL, '4º cadastro do mesmo e-mail em 24 h = 429 fixo')
    r = await get('/conectar?email=rep@teste.com&utm_source=wp', HC); assert.equal(r.status, 429, '/conectar respeita o mesmo limite por e-mail')
    r = await get('/conectar?utm_source=wp&utm_campaign=c1', HC)
    assert.equal(r.status, 302); assert.match(r.headers.location, /^https?:\/\/[^/]+\/meli\/conectar\?/, '/conectar continua levando direto ao OAuth')
    assert.match(String(r.headers['set-cookie']), /^ps_utm=/, '/conectar também guarda a UTM')
    const visitante = db.prepare("SELECT utm_json FROM prospectos WHERE empresa = 'Loja (link do site)' ORDER BY criado_em DESC LIMIT 1").get()
    assert.equal(JSON.parse(visitante.utm_json).utm_campaign, 'c1', '/conectar grava a UTM no cadastro')
    db.prepare("UPDATE prospectos SET empresa = '__teste_publico__ visitante' WHERE empresa = 'Loja (link do site)' AND utm_json LIKE '%c1%'").run()   // marca p/ limpeza
    // cadastros de TESTE: prévia lista (e-mail repetido ≥ 3× ou domínio de teste, sem conexão); confirmar apaga SÓ eles; conectado fica
    const ids = new Set(db.prepare("SELECT id FROM prospectos WHERE empresa LIKE '__teste_publico__ rep%'").all().map(x => x.id))
    const lt = listarCadastrosTeste().filter(x => ids.has(x.id))
    assert.equal(lt.length, 3); assert.match(lt[0].motivo, /e-mail repetido 3×|domínio ou nome de teste/)
    const pv = apagarCadastrosTeste({ apenas: ids }); assert.equal(pv.previa, true); assert.equal(pv.total, 3)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM prospectos WHERE empresa LIKE '__teste_publico__ rep%'").get().n, 3, 'prévia não apaga')
    const con = cadastrarProspecto({ nome: 'Fulano', empresa: '__teste_publico__ fulano conectado', email: 'fulano@loja.com', origem: 'publico', consentimento: true })
    conectarFalso(con.chave_conexao)
    assert.ok(!listarCadastrosTeste().some(x => x.id === con.id), 'lead de teste CONECTADO nunca entra na limpeza automática')
    assert.equal(apagarCadastrosTeste({ confirmar: true, apenas: ids }).apagados, 3)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM prospectos WHERE empresa LIKE '__teste_publico__ rep%'").get().n, 0)
    // /d/<token> conectado com coleta EM CURSO: «estamos lendo», recarrega sozinha, ml_connected sem PII (a API do ML não é chamada de verdade: o token é falso → números rápidos indisponíveis, declarado)
    coletaEmCurso.add(con.chave_conexao)
    html = await (await get(`/d/${con.token_publico}`)).text()
    coletaEmCurso.delete(con.chave_conexao)
    assert.ok(html.includes('Estamos lendo os anúncios') && html.includes('location.reload()') && html.includes('"event":"ml_connected"') && html.includes(`"lead_id":"${con.id}"`), 'página do lead enquanto a coleta roda')
    assert.ok(!html.includes('fulano@loja.com') && !/dataLayer\.push\([^)]*(Fulano|fulano@)/.test(html), 'dataLayer e página sem dado pessoal')
    // 16/10/2026 — resultado PARCIAL: CTA único fixo → wa.me do config com a mensagem exata (+ apelido só quando existe), contact_request no dataLayer, fetch marca o contato
    const wa = `https://wa.me/${CFG_PUBLICO.whatsapp}?text=${encodeURIComponent(CFG_PUBLICO.mensagem)}`
    assert.equal(linkWhatsApp({ nickname: '' }), wa, 'sem apelido: só a mensagem'); assert.equal(linkWhatsApp({ nickname: 'Loja Z' }), wa + encodeURIComponent('\nLoja: Loja Z'), 'apelido em linha nova')
    assert.ok(html.includes(`id="btEspecialista" href="${wa}"`) && html.includes(CFG_PUBLICO.botao) && html.includes(CFG_PUBLICO.texto_bloqueio) && html.includes('class="barra-cta"'), 'barra fixa com o botão do WhatsApp')
    assert.ok(html.includes("event:'contact_request'") && html.includes(`fetch('/d/${con.token_publico}/contato'`), 'clique: dataLayer + fetch sem navegar')
    assert.ok(!html.includes('fulano@loja.com') && !html.includes('13999990000'), 'wa.me sem e-mail/telefone do lead')
    assert.ok(!html.includes('action="/d/' + con.token_publico + '/contato"'), 'o formulário antigo de contato sumiu (um só comportamento)')
    assert.ok(html.includes(`'dataLayer','${GTM_ID}'`) && html.includes('"event":"ml_connected"'), 'GTM presente na página conectada')
    // timer: expira_em persistido no 1º GET conectado (= agora + timer_minutos), nunca reescrito; página leva o restante em ms e o relógio regressivo
    const exp1 = prospectoPorToken(con.token_publico).expira_em
    assert.ok(exp1 && Math.abs(Date.parse(exp1) - Date.now() - CFG_PUBLICO.timer_minutos * 60e3) < 5000, 'expira_em = conexão + timer_minutos')
    assert.match(html, /id="timer" data-restante="\d+">\d\d:\d\d</, 'timer regressivo na sombra'); assert.ok(html.includes('Esta análise fica disponível por') && html.includes('class="sombra"'), 'sombra com o timer')
    html = await (await get(`/d/${con.token_publico}`)).text()
    assert.equal(prospectoPorToken(con.token_publico).expira_em, exp1, 'recarregar não reinicia o relógio')
    assert.ok(html.includes('A leitura completa dos anúncios ainda não terminou') || html.includes('conectada e lida'), 'sem coleta em curso: estado honesto, não «sem dados»')
    // contato por fetch: 204 e quer_contato_em marcado; a página confirma e mantém o botão
    r = await req('POST', `/d/${con.token_publico}/contato`, { origin: `https://${HC}`, accept: 'application/json' })
    assert.equal(r.status, 204, 'fetch com accept json = 204 (não navega)')
    assert.ok(prospectoPorToken(con.token_publico).quer_contato_em, 'lead marcado como "pediu contato" pelo fetch')
    html = await (await get(`/d/${con.token_publico}`)).text()
    assert.ok(html.includes('id="ctaOk">Recebido!') && !html.includes('class="ok oculto"') && html.includes('id="btEspecialista"'), 'confirmação visível e botão continua')
    // expirada: só cabeçalho + CTA (sem números, sem seções, sem timer); recarregar não ressuscita
    db.prepare('UPDATE prospectos SET expira_em = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), con.id)
    for (let i = 0; i < 2; i++) {
      html = await (await get(`/d/${con.token_publico}`)).text()
      assert.ok(html.includes('tempo de visualização desta análise terminou') && html.includes('"event":"report_expired"') && html.includes('id="btEspecialista"'), 'página expirada: cabeçalho + CTA')
      assert.ok(!html.includes('class="kv"') && !html.includes('class="rel"') && !html.includes('id="timer"') && !html.includes('Estamos lendo'), 'página expirada sem números, seções ou timer')
    }
    assert.ok(Date.parse(prospectoPorToken(con.token_publico).expira_em) < Date.now(), 'expira_em segue no passado')
    // seções bloqueadas NUNCA vão ao navegador: só as dobras_visiveis; as demais viram esqueleto (sem texto) sob a sombra
    const parcial = corpoResultado({ secoes: ['<p>S1 resumo</p>', '<p>S2 funil</p>', '<p>S3 oitenta-vinte SEGREDO</p>', '<p>S4 ads SEGREDO</p>', '<p>S5 prioridades SEGREDO</p>'], restanteMs: 90e3 })
    assert.equal(CFG_PUBLICO.dobras_visiveis, 2)
    assert.ok(parcial.includes('S1 resumo') && parcial.includes('S2 funil') && !parcial.includes('SEGREDO') && !parcial.includes('S3') && !parcial.includes('S5'), 'só 2 dobras no HTML; o resto não sai do servidor')
    assert.equal((parcial.match(/class="l t"/g) || []).length, 3, '3 esqueletos = 3 seções bloqueadas'); assert.ok(parcial.includes('data-restante="90000">01:30<'))
    assert.ok(!corpoResultado({ secoes: ['<p>A</p>', '<p>B</p>'], restanteMs: 1 }).includes('class="sombra"'), 'sem seção bloqueada = sem sombra')
    // o relatório interno e o PDF (rotas-planos → renderDiagnosticoComercial) continuam completos: nada de sombra/wa.me/timer no render
    const render = readFileSync('src/lib/render-diagnostico-comercial.js', 'utf8')
    assert.ok(!/wa\.me|sombra|esqueleto|timer|dobras/.test(render) && render.includes('return [resumo, funil, p80, imas, adsBloco, estoque, reputacao, oportunidades, limites, interno].filter(Boolean)'), 'render interno intocado (todas as seções)')
    assert.ok(readFileSync('src/rotas-planos.js', 'utf8').includes('res.send(renderDiagnosticoComercial(d))'), 'relatório interno segue completo')
    await removerProspecto(con.id)
    // painel: botão do link público e «Apagar cadastros de teste» (secundários; o primário segue «Novo prospect»); endpoint fechado fora do loopback
    const painel = readFileSync('src/web/comercial.html', 'utf8')
    assert.ok(painel.includes('id="btLinkPublico"') && painel.includes('id="btApagarTestes"') && (painel.match(/btn-primario/g) || []).length === 2, 'botões no cabeçalho do Comercial (1 primário: Novo prospect + submit do diálogo)')
    assert.ok(readFileSync('src/web/comercial.js', 'utf8').includes('/conectar') && readFileSync('src/web/comercial.js', 'utf8').includes('utm_campaign'), 'diálogo monta o link com UTMs e mostra o /conectar')
    assert.ok(readFileSync('src/web/comercial.js', 'utf8').includes('p.formulario') && readFileSync('src/web/comercial.js', 'utf8').includes('f.faturamento'), 'painel mostra os campos do formulário na linha do prospect')
    r = await post('/api/comercial/apagar-testes', { por: 'x', confirmar: true }); assert.equal(r.status, 403, 'apagar testes INACESSÍVEL pelo host público')
    _resetLimites()
    // ANTI-VAZAMENTO: o e-mail de um lead existente (Ana) NÃO pode devolver o token/resultado dela a terceiros
    r = await post('/diagnostico', lead({ nome: 'Atacante', empresa: '__teste_publico__ atk', email: 'ana@teste.com', consentimento: true }))
    if (r.status === 200) assert.ok(!(await r.json()).proximo.includes(p.token_publico), 'e-mail alheio não entrega o diagnóstico de outra pessoa')
    // estado NÃO conectado: botão de conectar + formulário de exclusão
    r = await get(`/d/${p.token_publico}`)
    assert.equal(r.status, 200); html = await r.text()
    assert.ok(html.includes('Falta só conectar') && html.includes('Conectar no Mercado Livre'), 'resultado sem conexão pede a conexão')
    assert.ok(html.includes(`action="/d/${p.token_publico}/excluir"`), 'formulário de exclusão no estado não conectado')
    assert.ok(!/somente leitura/i.test(html), 'página do resultado sem "somente leitura" (sem app comercial)')
    r = await get(`/d/${TOKEN}`)
    assert.equal(r.status, 404, 'token inexistente = 404')
    r = await get('/api/comercial/prospectos')
    assert.equal(r.status, 403, 'lista de leads INACESSÍVEL pelo host público')
    // pedir contato sem JS (formulário): marca o lead e volta ao resultado; a página NÃO conectada não tem CTA nem timer (só quem conectou vê)
    r = await req('POST', `/d/${p.token_publico}/contato`, { origin: `https://${HC}` })
    assert.equal(r.status, 303)
    assert.ok(prospectoPorToken(p.token_publico).quer_contato_em, 'lead marcado como "pediu contato"')
    html = await (await get(`/d/${p.token_publico}`)).text()
    assert.ok(!/wa\.me|class="barra-cta"|id="timer"/.test(html) && !prospectoPorToken(p.token_publico).expira_em, 'sem conexão: sem CTA do WhatsApp, sem relógio')
    r = await excluir(p.token_publico)
    assert.equal(r.status, 200); assert.equal(prospectoPorToken(p.token_publico), null, 'titular apaga os próprios dados')

    // COM app comercial configurado: aí sim "somente leitura", e o prospect autoriza pelo app comercial
    env.MELI_CLIENT_ID_COMERCIAL = 'app-comercial-teste'; env.MELI_CLIENT_SECRET_COMERCIAL = 'seg-teste'
    try {
      html = await (await get('/diagnostico')).text()
      assert.ok(html.includes('somente leitura'), 'com app comercial a landing pode dizer "somente leitura"')
      assert.equal(new URL(urlAutorizacao('st', true)).searchParams.get('client_id'), 'app-comercial-teste', 'prospect → app comercial')
      assert.equal(new URL(urlAutorizacao('st', false)).searchParams.get('client_id'), env.MELI_CLIENT_ID, 'cliente → app principal intacto')
    } finally { env.MELI_CLIENT_ID_COMERCIAL = ''; env.MELI_CLIENT_SECRET_COMERCIAL = '' }
    assert.equal(new URL(urlAutorizacao('st', true)).searchParams.get('client_id'), env.MELI_CLIENT_ID, 'sem app comercial o prospect usa o principal')

    // REVOGAÇÃO na exclusão (falsa): chamada com a chave da conexão; a página só afirma a revogação se deu certo
    const chamadas = []
    _revogacao(async chave => { chamadas.push(chave); return true })
    const ok = cadastrarProspecto({ nome: 'Rev', empresa: '__teste_publico__ rev ok', email: 'r@r.com', origem: 'publico', consentimento: true })
    conectarFalso(ok.chave_conexao)
    assert.equal(db.prepare('SELECT app_id FROM meli_contas WHERE cliente = ?').get(ok.chave_conexao).app_id, 'app-teste', 'conexão guarda o app que emitiu o token')
    log('info', `Mercado Livre conectado — ${ok.chave_conexao} (nick-de-teste)`)                 // linha antiga com dado pessoal
    html = await (await excluir(ok.token_publico)).text()
    assert.deepEqual(chamadas, [ok.chave_conexao], 'revogação chamada na exclusão')
    assert.ok(html.includes('Autorização revogada no Mercado Livre'), 'página reflete revogação confirmada')
    assert.equal(prospectoPorToken(ok.token_publico), null); assert.equal(statusConexao(ok.chave_conexao), null, 'tokens apagados')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_log WHERE instr(msg, ?) > 0').get(ok.chave_conexao).n, 0, 'sync_log com a chave apagado')
    _revogacao(async () => { throw new Error('ML fora do ar') })
    const falha = cadastrarProspecto({ nome: 'Rev', empresa: '__teste_publico__ rev falha', email: 'f@f.com', origem: 'publico', consentimento: true })
    conectarFalso(falha.chave_conexao)
    html = await (await excluir(falha.token_publico)).text()
    assert.ok(!html.includes('revogada') && html.includes('configurações de segurança da sua conta do Mercado Livre'), 'falha na revogação: página orienta o titular')
    assert.equal(prospectoPorToken(falha.token_publico), null, 'apaga mesmo com a revogação falhando')
    assert.equal(statusConexao(falha.chave_conexao), null)
    _revogacao(async () => false)
  } finally { srv.close() }

  // 5) EXPURGO: lead público não conectado com +7 dias some; conectado, recente e do closer ficam
  const velho = cadastrarProspecto({ nome: 'V', empresa: '__teste_publico__ exp velho', email: 'v1@v.com', origem: 'publico', consentimento: true })
  const conectado = cadastrarProspecto({ nome: 'V', empresa: '__teste_publico__ exp conectado', email: 'v2@v.com', origem: 'publico', consentimento: true })
  const recente = cadastrarProspecto({ nome: 'V', empresa: '__teste_publico__ exp recente', email: 'v3@v.com', origem: 'publico', consentimento: true })
  const closerVelho = cadastrarProspecto({ nome: 'V', empresa: '__teste_publico__ exp closer' })
  conectarFalso(conectado.chave_conexao)
  const oitoDias = new Date(Date.now() - 8 * 86400e3).toISOString()
  db.prepare('UPDATE prospectos SET criado_em = ? WHERE id IN (?,?,?)').run(oitoDias, velho.id, conectado.id, closerVelho.id)
  assert.ok(expurgarLeadsAbandonados() >= 1)
  assert.equal(prospectoPorToken(velho.token_publico), null, 'lead público abandonado (+7 dias) expurgado')
  assert.ok(prospectoPorToken(conectado.token_publico), 'lead conectado preservado')
  assert.ok(prospectoPorToken(recente.token_publico), 'lead recente preservado')
  assert.ok(prospectoPorToken(closerVelho.token_publico), 'prospect do closer nunca é expurgado')

  // 6) CONEXÕES ÓRFÃS: só a de prospect sem prospect sai; clientes e prospect existente intactos
  const orfa = '[Comercial] __teste_publico__ orfa · deadbeef'
  conectarFalso(orfa)
  const clientes = () => db.prepare("SELECT COUNT(*) n FROM meli_contas WHERE cliente NOT LIKE '[Comercial] %'").get().n
  const antes = clientes()
  assert.ok(limparConexoesOrfas() >= 1)
  assert.equal(statusConexao(orfa), null, 'conexão órfã de prospect removida')
  assert.ok(statusConexao(conectado.chave_conexao), 'conexão de prospect existente preservada')
  assert.equal(clientes(), antes, 'conexões de clientes intactas')

  for (const x of [c, conectado, recente, closerVelho]) await removerProspecto(x.id)
  console.log('✔ comercial-publico: GTM só nas páginas públicas + dataLayer sem PII, UTMs em cookie 30 d e no cadastro, POST → OAuth direto, 3 cadastros/24 h por e-mail (429 fixo), apagar testes com prévia, /d com estado honesto, guarda por host exato (painel fechado, CSRF bloqueado), consentimento obrigatório, token 128 bits, honeypot, limite por IP e /64 (inválido não gasta), teto global só alerta, exclusão em todo estado com revogação (falsa) refletida, expurgo 7 dias, órfãs, texto honesto sem app comercial')
} finally { limpar(); _resetLimites(); Object.assign(env, envOriginal) }
