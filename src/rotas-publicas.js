// Diagnóstico comercial PÚBLICO — diagnosticomeli.place2u.com.br (env COMERCIAL_PUBLIC_HOST).
// LINK ÚNICO UNIVERSAL: https://diagnosticomeli.place2u.com.br/ → landing /diagnostico → formulário (lead gravado) → autorização
// no Mercado Livre (OAuth oficial; o diagnóstico só lê) → /d/<token> com o diagnóstico da PRÓPRIA conta (token de 128 bits).
// /conectar = o mesmo caminho sem formulário (cadastro «Visitante», apelido do ML na volta). Os dois aceitam UTMs (cookie 1st-party de 30 d,
// gravadas no cadastro). A guarda (src/lib/guarda-local.js) só deixa o túnel alcançar estas rotas quando o Host é exatamente o host comercial.
// GTM (src/lib/gtm.js) SÓ aqui e nas páginas de volta do OAuth do prospect; dataLayer sem dado pessoal (id curto do lead + UTMs).
// Anti-abuso: honeypot, limite por IP/prefixo IPv6 /64 (5/h, só envio válido conta), 3 cadastros/24 h por e-mail (429 fixo); volume global só alerta no log.
// O titular pode apagar os próprios dados em qualquer estado da página do resultado (LGPD art. 18, VI); lead que nunca conectou some sozinho em 7 dias.
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import { env } from './lib/env.js'
import { log } from './lib/db.js'
import { esc, brData } from './lib/estilo-editorial.js'
import { appComercialPronto } from './lib/meli-oauth.js'
import { gtmHead, gtmBody, dlEvento } from './lib/gtm.js'
import { cadastrarProspecto, prospectoPorToken, diagnosticoProspecto, removerProspecto, infraMeliPronta, marcarQuerContato, garantirExpiracao, limpa, expurgarLeadsAbandonados, limparConexoesOrfas,
  CHAVES_UTM, utmLimpa, cadastrosPorEmail24h, LIMITE_EMAIL_24H, MSG_LIMITE_EMAIL, CAMPOS_FORMULARIO, formularioLimpo } from './lib/comercial.js'
import { montarDiagnosticoComercial } from './lib/diagnostico-comercial.js'
import { secoesDiagnosticoComercial, CSS_DC } from './lib/render-diagnostico-comercial.js'

export const rotasPublicas = Router()

// ── resultado parcial (16/10/2026, config/comercial-publico.json): o lead vê `dobras_visiveis` seções; as demais NÃO saem do servidor
// (só esqueleto sob uma sombra), a página vale `timer_minutos` a partir da 1ª abertura conectada (expira_em por token, nunca ressuscita)
// e o único CTA abre o WhatsApp do comercial com a mensagem fixa. O relatório interno e o PDF (rotas-planos) continuam completos.
export const CFG_PUBLICO = JSON.parse(readFileSync(new URL('../config/comercial-publico.json', import.meta.url), 'utf8'))

// ── anti-abuso (memória do processo; reinício zera — teto conhecido, suficiente para o volume do funil) ──
// chave do limite: IPv4 inteiro; IPv6 pelo prefixo /64 (quem tem um /64 tem endereços "infinitos")
export function chaveIp(ip) {
  const s = String(ip).split('%')[0].toLowerCase()
  if (s.startsWith('::ffff:') && s.includes('.')) return s.slice(7)          // IPv4 mapeado em IPv6
  if (!s.includes(':')) return s
  const [a, b] = s.split('::'), cab = a ? a.split(':') : [], cauda = b ? b.split(':') : []
  const g = s.includes('::') ? [...cab, ...Array(Math.max(0, 8 - cab.length - cauda.length)).fill('0'), ...cauda] : cab
  return g.slice(0, 4).map(x => (parseInt(x, 16) || 0).toString(16)).join(':') + '::/64'
}
const porIp = new Map()
let diaGlobal = { dia: '', n: 0 }
export function podeCadastrar(ip, agoraMs = Date.now(), alertar = msg => log('aviso', msg)) {
  const chave = chaveIp(ip), hora = agoraMs - 3600e3
  const lista = (porIp.get(chave) || []).filter(t => t > hora)
  if (lista.length >= 5) return false
  lista.push(agoraMs); porIp.set(chave, lista)
  if (porIp.size > 5000) porIp.clear()                       // teto de memória
  // volume global NÃO bloqueia (recusaria lead legítimo): só alerta no log a cada 60 cadastros no dia
  const dia = new Date(agoraMs).toISOString().slice(0, 10)
  if (diaGlobal.dia !== dia) diaGlobal = { dia, n: 0 }
  if (++diaGlobal.n % 60 === 0) alertar(`alerta: volume anormal no diagnóstico público (${diaGlobal.n} cadastros hoje)`)
  return true
}
export const _resetLimites = () => { porIp.clear(); diaGlobal = { dia: '', n: 0 } }
export const ipDe = req => String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'local')

// ── UTMs: 1º toque em cookie 1st-party de 30 d (ps_utm, JSON na URL-encoding); a query da visita atual vence quando traz UTM ──
const COOKIE_UTM = 'ps_utm'
export function utmDoCookie(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_UTM}=([^;]*)`))
  try { return m ? utmLimpa(JSON.parse(decodeURIComponent(m[1]))) : {} } catch { return {} }
}
export function utmDaReq(req) {
  const q = utmLimpa(req.query || {})
  return Object.keys(q).length ? q : utmDoCookie(req)
}
// grava o cookie só no 1º toque (não sobrescreve a campanha de origem); Secure atrás do túnel (X-Forwarded-Proto https)
function guardarUtm(req, res) {
  const q = utmLimpa(req.query || {})
  if (!Object.keys(q).length || Object.keys(utmDoCookie(req)).length) return
  const https = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https'
  res.append('Set-Cookie', `${COOKIE_UTM}=${encodeURIComponent(JSON.stringify(q))}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax${https ? '; Secure' : ''}`)
}
const utmParaDl = u => Object.fromEntries(Object.entries(u || {}).filter(([k]) => k.startsWith('utm_')))

// ── layout (autocontido: o túnel não alcança CSS/JS estáticos do painel). Identidade absorvida de lp.place2u.com.br/analise-diagnostica (16/10/2026):
// Poppins, azul-marinho #112337 no herói com o logo branco, laranja #E44919 no botão, prova social «+1000 empresas atendidas · 4.8 de 5».
const LOGO_BRANCO = 'https://lp.place2u.com.br/wp-content/uploads/2026/05/logo_place_branco_1.webp'
const AVATARES = [1, 2, 3, 4, 5].map(n => `https://lp.place2u.com.br/wp-content/uploads/2026/05/aluno0${n}.webp`)
const CSS = `:root{--laranja:#E44919;--laranja-escuro:#c43b10;--marinho:#112337;--tinta:#111111;--cinza:#585e6a;--borda:#e5e7eb;--suave:#F0F5FA;--azul:#046bd2;--verde:#008a05;--verde-s:#e8f6e9;--verm:#c13515;--verm-s:#fdeae3;--ambar:#b45309;--ambar-s:#fef3e2;
--accent:#E44919;--sage:#2f6b4f;--paper:#fff;--paper-deep:#F0F5FA;--rule:#475569;--gold:#c89b3c}
*{box-sizing:border-box;margin:0}body{background:#fff;font-family:Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--tinta);font-size:15px;line-height:1.55}
.heroi{background:var(--marinho);color:#fff;padding:22px 20px 0}.heroi .marca{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;max-width:980px;margin:0 auto}.heroi .marca img{height:34px}
.heroi-corpo{max-width:980px;margin:0 auto;padding:40px 0 44px;display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:center}
.heroi h1{font-size:clamp(28px,4.6vw,44px);font-weight:700;letter-spacing:-.02em;line-height:1.12;margin-bottom:14px}.heroi .lead{color:#d6dde8;font-size:17px;margin-bottom:22px}
.prova{display:flex;align-items:center;gap:12px;font-size:13.5px;color:#d6dde8}.prova .avs{display:flex}.prova .avs img{width:34px;height:34px;border-radius:50%;border:2px solid var(--marinho);margin-left:-8px;object-fit:cover}.prova .avs img:first-child{margin-left:0}.prova b{color:#fff;display:block;font-size:15px}
.heroi-img img{width:100%;border-radius:16px;display:block}
main{max-width:980px;margin:0 auto;padding:40px 20px 64px}.estreita{max-width:720px}
h2.sec{font-size:clamp(22px,3.4vw,30px);font-weight:700;letter-spacing:-.02em;line-height:1.2;margin:0 0 8px}.sub{color:var(--cinza);margin-bottom:22px}
.cartao{border:1px solid var(--borda);border-radius:20px;box-shadow:0 1px 2px rgba(0,0,0,.06),0 6px 18px rgba(17,35,55,.08);padding:26px;background:#fff}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input[type=text],input[type=email],input[type=tel],select{width:100%;border:1px solid #d1d5db;border-radius:12px;padding:13px 14px;font-size:15.5px;font-family:inherit;background:#fff;color:var(--tinta);min-height:48px}
input:focus,select:focus{outline:2px solid var(--azul);outline-offset:1px}
.req{color:var(--laranja)}.legenda{font-size:12px;color:var(--cinza);margin:0 0 4px}
fieldset{border:0;padding:0;margin:14px 0 0}legend{font-size:13px;font-weight:600;margin-bottom:6px;padding:0}
.opcoes{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px}.opcoes label{display:flex;gap:8px;align-items:center;font-weight:400;font-size:14px;margin:0;min-height:30px}.opcoes input{width:18px;height:18px;flex:none;margin:0}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;font-weight:400;color:var(--cinza);margin-top:16px}.consent input{margin-top:3px;width:18px;height:18px;flex:none}
.bt{display:block;width:100%;border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:700;background:var(--laranja);color:#fff;cursor:pointer;margin-top:18px;text-align:center;text-decoration:none;font-family:inherit}
.bt:hover{background:var(--laranja-escuro)}.bt[disabled]{opacity:.55;cursor:wait}.bt.sec{background:#fff;color:var(--tinta);border:1px solid var(--tinta)}
.passos{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 30px}.passo{background:var(--suave);border-radius:14px;padding:14px;font-size:13px}.passo b{display:block;font-size:22px;color:var(--laranja)}
.bens{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 36px}.bem{border:1px solid var(--borda);border-radius:16px;padding:16px}.bem b{display:block;margin-bottom:4px;font-size:14.5px}.bem span{font-size:13px;color:var(--cinza)}
.duas{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
details.faq{border-top:1px solid var(--borda);padding:12px 0}details.faq summary{font-weight:600;cursor:pointer;font-size:14.5px}details.faq p{margin-top:8px;font-size:13.5px;color:var(--cinza)}
.mini{font-size:12px;color:var(--cinza)}.erro{color:var(--verm);font-size:13px;margin-top:10px}
.kv{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.kv>div{border:1px solid var(--borda);border-radius:14px;padding:14px}.kv b{display:block;font-size:20px;font-weight:700}.kv span{font-size:11.5px;color:var(--cinza)}
.delta{font-size:11.5px;font-weight:700}.up{color:var(--verde)}.down{color:var(--verm)}
.faixa{border-radius:14px;padding:14px 16px;font-size:14px;margin:16px 0}.faixa.amb{background:var(--ambar-s);color:var(--ambar)}.faixa.ok{background:var(--verde-s);color:var(--verde)}
ul{margin:8px 0 0 20px}li{margin:4px 0}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
footer{text-align:center;color:#8a909a;font-size:11.5px;padding:24px 20px;max-width:720px;margin:0 auto;border-top:1px solid var(--borda)}
/* seções do diagnóstico (mesmas classes do documento editorial, com a paleta da landing) */
.rel section{margin:30px 0}.sec-titulo{margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--marinho)}.sec-titulo .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--laranja);font-weight:600}
.sec-titulo h2{font-size:22px;font-weight:700;letter-spacing:-.02em;line-height:1.2}.sec-titulo .sub{font-size:13.5px;color:var(--cinza);margin:4px 0 0}
.met-grade{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.met{border:1px solid var(--borda);border-radius:14px;padding:12px 14px}.met .n{font-size:21px;font-weight:700}.met .r{font-size:11.5px;color:var(--cinza);margin-top:2px}
.met .comp{font-size:11.5px;font-weight:700}.comp.bom{color:var(--verde)}.comp.ruim{color:var(--verm)}.comp.igual{color:var(--cinza)}
.verdict{background:var(--marinho);color:#fff;border-radius:14px;padding:16px 18px;margin:14px 0}.verdict .eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#ffb199;font-weight:600;display:block;margin-bottom:4px}.verdict p{font-size:14px}.verdict b{color:#fff}
.aviso{background:var(--ambar-s);color:var(--ambar);border-radius:12px;padding:10px 14px;font-size:13px;margin:10px 0}
.rel table{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}.rel th{text-align:left;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--cinza);padding:6px 8px;border-bottom:1px solid var(--borda)}.rel td{padding:8px;border-bottom:1px solid var(--borda);vertical-align:top}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--rule)}.vazio{color:var(--cinza);font-size:13.5px}
.entrega{border-top:1px solid var(--borda);padding:14px 0}.lm{display:flex;gap:10px;align-items:center;font-size:12px;color:var(--cinza);margin:4px 0 6px;flex-wrap:wrap}.tag{font-size:10.5px;padding:2px 8px;border-radius:999px;font-weight:600}
.rel a{color:var(--azul)}
@media print{.heroi,.so-tela,footer form,.bt{display:none!important}body{font-size:12px}main{padding:0;max-width:none}.met-grade{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){.rel .dc-linha img,.rel .dc-semimg{display:none}.rel table{font-size:12px}.rel td,.rel th{padding:6px 4px}}
@media(max-width:760px){.heroi-corpo,.duas,.bens{grid-template-columns:1fr}.heroi-img{display:none}.passos,.kv,.met-grade{grid-template-columns:1fr 1fr}main{padding-top:28px}}
@media(max-width:480px){.opcoes{grid-template-columns:1fr}.cartao{padding:18px 16px}main{padding-left:16px;padding-right:16px}.bt{padding:17px;font-size:17px}}
/* resultado parcial: sombra sobre o esqueleto das seções bloqueadas (o HTML delas nunca chega aqui) + barra fixa do CTA */
body.com-barra{padding-bottom:168px}
.sombra{position:relative;margin-top:24px;min-height:70vh;overflow:hidden}
.sombra .veu{position:absolute;inset:0;background:linear-gradient(180deg,rgba(17,35,55,0) 0,rgba(17,35,55,.72) 150px,rgba(17,35,55,.96) 420px,var(--marinho) 100%);z-index:2}
.esq{filter:blur(5px);opacity:.75;pointer-events:none;user-select:none;padding:24px 0}
.esq .l{height:12px;border-radius:6px;background:#cbd2dc;margin:10px 0}.esq .l.t{height:22px;width:46%;background:#8f99a8;margin:26px 0 14px}.esq .l.c{width:72%}.esq .l.m{width:88%}
.esq .tb{display:grid;grid-template-columns:54px 1fr 90px 60px 70px;gap:12px;align-items:center;margin:10px 0}.esq .tb i{display:block;height:54px;background:#cbd2dc;border-radius:6px}.esq .tb .l{margin:0}
.timer{position:absolute;top:18px;left:0;right:0;z-index:3;text-align:center;color:#fff;font-size:15px;font-weight:600;padding:0 16px}.timer b{font-variant-numeric:tabular-nums;font-size:22px;display:block;letter-spacing:.02em}
.barra-cta{position:fixed;left:0;right:0;bottom:0;z-index:20;background:var(--marinho);color:#fff;padding:14px 16px calc(14px + env(safe-area-inset-bottom));box-shadow:0 -6px 24px rgba(17,35,55,.35)}
.barra-cta .in{max-width:720px;margin:0 auto;text-align:center}.barra-cta p{font-size:13px;color:#d6dde8;margin:0 0 10px;line-height:1.4}.barra-cta .bt{margin:0;font-size:16px}
.barra-cta .ok{font-size:12.5px;color:#9fe3a4;margin-top:8px}.barra-cta .ok.oculto{display:none}
@media(max-width:480px){body.com-barra{padding-bottom:190px}.barra-cta p{font-size:12.5px}}
@media print{.sombra,.barra-cta{display:none!important}}`

// GTM em TODAS as páginas públicas; `eventos` = pushes no dataLayer logo após o head (ids opacos/UTMs, nunca dado pessoal)
const pagina = (titulo, corpo, { eventos = [], heroi = '', largo = false, barra = '' } = {}) => `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
${gtmHead()}${eventos.map(([e, d]) => dlEvento(e, d)).join('')}</head><body${barra ? ' class="com-barra"' : ''}>
${gtmBody()}${barra}
<div class="heroi"><div class="marca"><img src="${LOGO_BRANCO}" alt="Place2u" onerror="this.src='/logo'"><span>Diagnóstico Mercado Livre</span></div>${heroi}</div>
<main class="${largo ? '' : 'estreita'}">${corpo}</main>
<footer>© Todos os direitos Reservados a Place2u. · CNPJ: 34.243.829/0001-37 · ${appComercialPronto() ? 'acesso somente leitura' : 'conexão pelo login oficial do Mercado Livre'}, autorizado pelo titular da conta${env.COMERCIAL_CONTATO_LGPD ? ` · ${esc(env.COMERCIAL_CONTATO_LGPD)}` : ''}</footer>
</body></html>`

// Honestidade sobre a permissão: só o app comercial é somente leitura; o principal tem escopos de escrita (publicar, ads, pedidos).
const textoPermissao = () => appComercialPronto()
  ? 'Autorização somente leitura pelo login oficial do Mercado Livre — a Place2u nunca vê a sua senha e nada é alterado na sua conta.'
  : 'Você autoriza pelo login oficial do Mercado Livre. A tela do Mercado Livre lista as permissões do aplicativo Place2u; para o diagnóstico usamos apenas leitura e nada é alterado na sua conta.'

// curto: o detalhe da permissão (honesto, sem/with app comercial) fica em textoPermissao(), logo abaixo do botão
const textoLgpd = () => `Autorizo a Place2u a usar estes dados e a ler${appComercialPronto() ? ', somente leitura,' : ''} a minha conta do Mercado Livre para gerar a análise e entrar em contato. Nada é alterado na conta; posso revogar o acesso e apagar meus dados a qualquer momento.`

// campos do formulário = os da landing de referência (docs/landing-referencia.md): mesmos rótulos, ordem e obrigatoriedade; sem placeholder
const campo = (id, rotulo, tipo, ac, max) => `<label for="${id}">${esc(rotulo)} <span class="req">*</span></label><input type="${tipo}" id="${id}" name="${id}" required maxlength="${max}" autocomplete="${ac}">`
const selecao = k => { const c = CAMPOS_FORMULARIO[k]; return `<label for="${k}">${esc(c.rotulo)} <span class="req">*</span></label><select id="${k}" name="${k}" required><option value="">Selecione</option>${c.opcoes.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>` }

// raiz do host comercial → landing (MESMA condição de host exato da guarda: o painel interno nunca é servido aqui); UTMs seguem na query
rotasPublicas.get('/', (req, res, next) => {
  const h = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '')
  if (env.COMERCIAL_PUBLIC_HOST && h === env.COMERCIAL_PUBLIC_HOST) { const q = req.originalUrl.split('?')[1]; return res.redirect(302, '/diagnostico' + (q ? '?' + q : '')) }
  next()
})

// ── link direto (WordPress, 15/10/2026): o botão da página do site aponta para /conectar e o visitante cai DIRETO na autorização do ML,
// sem o formulário daqui. O consentimento (texto de uso dos dados) fica na página do WordPress, junto do botão; aqui ele é registrado com a versão
// «wordpress» e o IP via podeCadastrar. Campos opcionais pela query (o WordPress pode repassar o formulário dele): nome, empresa, email, telefone, origem.
// Sem nome/empresa, o cadastro nasce como «Visitante» e ganha o apelido do ML na volta do OAuth (server.js, callback). Mesmo limite por IP do formulário.
rotasPublicas.get('/conectar', (req, res) => {
  try {
    expurgarLeadsAbandonados(); limparConexoesOrfas()
    guardarUtm(req, res)
    if (!infraMeliPronta()) return res.status(503).send(pagina('Conexão indisponível — Place2u', '<h2 class="sec">Conexão temporariamente indisponível</h2><div class="sub">Tente de novo em alguns minutos.</div>'))
    const q = req.query || {}, txt = (v, n) => limpa(String(v || ''), n)
    const email = String(q.email || '').trim(), okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    if (okEmail && cadastrosPorEmail24h(email) >= LIMITE_EMAIL_24H) return res.status(429).send(pagina('Muitas tentativas — Place2u', `<h2 class="sec">Muitas tentativas</h2><div class="sub">${esc(MSG_LIMITE_EMAIL)}</div>`))
    if (!podeCadastrar(ipDe(req))) return res.status(429).send(pagina('Muitas tentativas — Place2u', '<h2 class="sec">Muitas tentativas</h2><div class="sub">Tente novamente em uma hora.</div>'))
    const p = cadastrarProspecto({ nome: txt(q.nome, 120) || 'Visitante', empresa: txt(q.empresa, 120) || 'Loja (link do site)', email: okEmail ? email : '',
      telefone: String(q.telefone || '').replace(/[^\d+() -]/g, '').slice(0, 40), origem: 'publico', consentimento: true, utm: utmDaReq(req) })
    if (!p.link) return res.status(503).send(pagina('Conexão indisponível — Place2u', '<h2 class="sec">Não foi possível gerar a conexão agora</h2>'))
    log('info', `lead do link direto (${txt(q.origem, 30) || 'site'}): ${p.id}`)
    res.redirect(302, p.link)                                         // → /meli/conectar assinado → consentimento do ML → callback → /d/<token>
  } catch (e) { res.status(400).send(pagina('Erro — Place2u', '<h2 class="sec">Não foi possível iniciar a conexão</h2>')) }
})

// ── landing ─────────────────────────────────────────────────────────────────
rotasPublicas.get('/diagnostico', (req, res) => {
  guardarUtm(req, res)
  const utm = utmDaReq(req)
  const heroi = `<div class="heroi-corpo"><div>
    <h1>Descubra o que está limitando seus resultados no Mercado Livre com uma análise diagnóstica.</h1>
    <div class="lead">Lemos a sua conta pela API oficial do Mercado Livre — faturamento, visitas, conversão, anúncios, Ads, reputação e estoque/Full — e mostramos o que está travando as vendas.</div>
    <div class="prova"><div class="avs">${AVATARES.map(u => `<img src="${u}" alt="" loading="lazy">`).join('')}</div><div><b>+1000 empresas atendidas</b>(4.8 de 5) em avaliações</div></div>
  </div><div class="heroi-img"><img src="https://lp.place2u.com.br/wp-content/uploads/2026/05/marketplacesmelhor.webp" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></div></div>`
  res.send(pagina('Diagnóstico gratuito da sua conta no Mercado Livre — Place2u', `
  <div class="passos"><div class="passo"><b>1</b>Preencha o formulário</div><div class="passo"><b>2</b>Autorize no Mercado Livre</div><div class="passo"><b>3</b>Veja o diagnóstico da sua conta</div></div>
  <div class="duas">
  <div>
  <h2 class="sec">O que você recebe</h2>
  <div class="sub">A análise diagnóstica da sua própria conta no Mercado Livre, com os dados oficiais — números, não achismo.</div>
  <div class="bens" style="grid-template-columns:1fr">
    <div class="bem"><b>Faturamento, visitas e conversão</b><span>Últimos 28 dias comparados com os 28 anteriores: pedidos, ticket médio, visitas e taxa de conversão.</span></div>
    <div class="bem"><b>Anúncios que sustentam a receita</b><span>Quais anúncios vendem, quais recebem visita e não convertem, e onde o estoque ameaça parar a venda.</span></div>
    <div class="bem"><b>Ads, reputação e estoque/Full</b><span>Gasto e retorno do Mercado Ads; nível e medalha da conta; campeões perto da ruptura, inclusive no Full.</span></div>
    <div class="bem"><b>O que está limitando seus resultados</b><span>Os problemas que mais custam venda hoje, em linguagem simples, cada um com o dado que o sustenta.</span></div>
  </div>
  <h2 class="sec" style="font-size:20px">Perguntas frequentes</h2>
  <details class="faq"><summary>É seguro? Vocês veem minha senha?</summary><p>Não. A autorização é feita na tela oficial do Mercado Livre (OAuth). A Place2u nunca vê a sua senha e você pode revogar o acesso a qualquer momento.</p></details>
  <details class="faq"><summary>Alguma coisa muda na minha conta?</summary><p>Nada. A análise só lê dados de vendas, visitas, anúncios, Ads e reputação. Nenhum anúncio, preço ou estoque é alterado.</p></details>
  <details class="faq"><summary>Quanto custa?</summary><p>A análise diagnóstica é gratuita. Se fizer sentido, um especialista da Place2u conversa com você sobre o plano de ação no Mercado Livre.</p></details>
  <details class="faq"><summary>O que eu preciso ter?</summary><p>Uma conta de vendedor no Mercado Livre. Ainda não vende lá? Preencha mesmo assim: a equipe entra em contato.</p></details>
  </div>
  <div>
  ${infraMeliPronta() ? `
  <form class="cartao" id="f" autocomplete="on">
    <h2 class="sec" style="font-size:20px">Análise diagnóstica da sua conta</h2>
    <p class="legenda">"<span class="req">*</span>" indica campos obrigatórios</p>
    ${campo('nome', 'Nome', 'text', 'name', 120)}
    ${campo('email', 'E-mail', 'email', 'email', 160)}
    ${campo('telefone', 'Telefone', 'tel', 'tel', 40)}
    ${campo('empresa', 'Nome da empresa', 'text', 'organization', 120)}
    ${campo('nicho', CAMPOS_FORMULARIO.nicho.rotulo, 'text', 'off', 120)}
    <fieldset><legend>${esc(CAMPOS_FORMULARIO.canais.rotulo)} <span class="req">*</span></legend><div class="opcoes" id="canais">${CAMPOS_FORMULARIO.canais.opcoes.map((o, i) => `<label><input type="checkbox" name="canais" value="${esc(o)}" id="canal${i}">${esc(o)}</label>`).join('')}</div></fieldset>
    ${selecao('funcionarios')}
    ${selecao('faturamento')}
    <div class="hp" aria-hidden="true"><label for="website">Não preencha</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off"></div>
    <label class="consent"><input type="checkbox" id="consent" required><span>${textoLgpd()}</span></label>
    <button class="bt" type="submit" id="bt">ENVIAR</button>
    <div class="erro" id="erro" role="alert"></div>
    <p class="mini" style="margin-top:14px">${textoPermissao()}</p>
  </form>
  <script>
  const dl = (ev, o) => { try { window.dataLayer = window.dataLayer || []; window.dataLayer.push(Object.assign({ event: ev }, o || {})) } catch (e) {} }
  document.getElementById('f').onsubmit = async e => {
    e.preventDefault()
    const v = id => document.getElementById(id).value
    const erro = document.getElementById('erro'), bt = document.getElementById('bt')
    erro.textContent = ''
    const canais = [...document.querySelectorAll('#canais input:checked')].map(i => i.value)
    if (!canais.length) { erro.textContent = 'Marque pelo menos uma opção em «Já vende nos marketplaces? Se sim, quais?».'; return }
    bt.disabled = true; bt.textContent = 'Preparando a conexão…'
    dl('lead_form_submit')
    try {
      const r = await fetch('/diagnostico', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: v('nome'), empresa: v('empresa'), email: v('email'), telefone: v('telefone'), nicho: v('nicho'), canais, funcionarios: v('funcionarios'), faturamento: v('faturamento'), website: v('website'), consentimento: document.getElementById('consent').checked }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.erro || 'Não foi possível continuar agora.')
      dl('ml_connect_start', { lead_id: j.lead_id })
      bt.textContent = 'Obrigado! Levando você ao Mercado Livre…'
      location.href = j.proximo                                   // a «página de obrigado» É a autorização no Mercado Livre
    } catch (err) { erro.textContent = err.message; bt.disabled = false; bt.textContent = 'ENVIAR' }
  }
  </script>` : '<div class="faixa amb">O diagnóstico online está temporariamente indisponível. Fale com a equipe Place2u.</div>'}
  </div></div>`, { eventos: [['lead_form_view', utmParaDl(utm)]], heroi, largo: true }))
})

// ── cadastro do lead → resposta leva DIRETO à autorização do Mercado Livre (/meli/conectar assinado) ──
rotasPublicas.post('/diagnostico', (req, res) => {
  try {
    expurgarLeadsAbandonados(); limparConexoesOrfas()                 // higiene LGPD a cada envio (tabelas pequenas)
    const b = req.body || {}
    if (String(b.website || '').trim()) return res.json({ proximo: '/diagnostico' })   // honeypot: robô "sucede" sem efeito
    if (!infraMeliPronta()) return res.status(503).json({ erro: 'Diagnóstico temporariamente indisponível.' })
    const nome = limpa(b.nome, 120), empresa = limpa(b.empresa, 120)  // mesmos limites do cadastro
    if (!nome || !empresa) return res.status(400).json({ erro: 'Informe seu nome e o nome da empresa.' })
    const email = String(b.email || '').trim(), fone = String(b.telefone || '').replace(/\D+/g, '')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' })   // e-mail E telefone obrigatórios, como na referência
    if (fone.length < 10) return res.status(400).json({ erro: 'Informe um telefone com DDD.' })
    const form = formularioLimpo(b)                                   // nicho, canais, funcionários, faturamento — lista fechada, selects validados, sem eco
    if (!form.ok) return res.status(400).json({ erro: form.erro })
    if (b.consentimento !== true) return res.status(400).json({ erro: 'É preciso aceitar o uso dos dados para gerar o diagnóstico.' })
    // SEM reaproveitar cadastro por e-mail: isso entregaria o token/diagnóstico de OUTRA pessoa a quem só
    // conhece o e-mail dela. Cada envio é um lead novo; o mesmo e-mail só cria 3 por dia (429 fixo) e o limite por IP segura o volume.
    if (email && cadastrosPorEmail24h(email) >= LIMITE_EMAIL_24H) return res.status(429).json({ erro: MSG_LIMITE_EMAIL })
    // Só envio VÁLIDO chega aqui: inválido não gasta a cota de ninguém.
    if (!podeCadastrar(ipDe(req))) return res.status(429).json({ erro: 'Muitas tentativas. Tente novamente em uma hora.' })
    const p = cadastrarProspecto({ nome, empresa, email, telefone: b.telefone, origem: 'publico', consentimento: true, utm: utmDaReq(req), formulario: form.dados })
    if (!p.link) return res.status(503).json({ erro: 'Não foi possível gerar a conexão agora.' })
    log('info', `lead público do diagnóstico: ${p.id} — consentimento ${p.consentimento_versao}`)
    res.json({ proximo: p.link, lead_id: p.id, resultado: `/d/${p.token_publico}` })   // proximo = OAuth do ML; /d/<token> só aparece DEPOIS da conexão
  } catch (e) { res.status(400).json({ erro: e.message.slice(0, 160) }) }
})

// ── resultado (só com o token de 128 bits) ──────────────────────────────────
const cache = new Map()                                      // token → { em, dx } (15 min: não martelar a API do ML)
const fmtR = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtN = v => v == null ? '—' : Number(v).toLocaleString('pt-BR')
const delta = (a, b) => {
  if (a == null || !b) return ''
  const d = Math.round((a - b) / b * 100)
  return `<span class="delta ${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% vs 28 dias anteriores</span>`
}

// exclusão em TODOS os estados da página (LGPD art. 18, VI) — inclusive antes de conectar
const formExcluir = p => `
    <form method="post" action="/d/${esc(p.token_publico)}/excluir" onsubmit="return confirm('Apagar seus dados e revogar o acesso da Place2u à sua conta?')" style="margin-top:28px;text-align:center">
      <button class="bt sec" type="submit" style="display:inline-block;width:auto;padding:10px 18px;font-size:13px">Apagar meus dados e revogar o acesso</button>
    </form>`
// ── CTA único (16/10/2026): botão fixo → WhatsApp do comercial (config) com a mensagem fixa (+ «Loja: <apelido do ML>» quando existe; nunca e-mail/telefone).
// O clique empurra contact_request no dataLayer e marca quer_contato_em por fetch (sem navegar); depois o wa.me abre normalmente.
export const linkWhatsApp = (p, cfg = CFG_PUBLICO) => `https://wa.me/${String(cfg.whatsapp).replace(/\D/g, '')}?text=${encodeURIComponent(cfg.mensagem + (p.nickname ? `\nLoja: ${p.nickname}` : ''))}`
const barraCta = (p, cfg = CFG_PUBLICO) => `<div class="barra-cta" id="barraCta"><div class="in">
  <p>${esc(cfg.texto_bloqueio)}</p>
  <a class="bt" id="btEspecialista" href="${esc(linkWhatsApp(p, cfg))}" target="_blank" rel="noopener">${esc(cfg.botao)}</a>
  <div class="ok${p.quer_contato_em ? '' : ' oculto'}" id="ctaOk">Recebido! Um especialista da Place2u também vai te chamar pelo contato que você informou.</div>
</div></div>
<script>document.getElementById('btEspecialista').addEventListener('click',function(){
  try{window.dataLayer=window.dataLayer||[];window.dataLayer.push({event:'contact_request',lead_id:'${esc(p.id)}'})}catch(e){}
  try{fetch('/d/${esc(p.token_publico)}/contato',{method:'POST',headers:{accept:'application/json'},keepalive:true}).catch(function(){})}catch(e){}
  document.getElementById('ctaOk').classList.remove('oculto')})</script>`

// ── corpo do resultado PARCIAL (puro, testável): só as `dobras_visiveis` primeiras seções vão ao HTML; as demais viram esqueleto sob a sombra
// (nem «inspecionar» nem desligar o CSS revelam o que não foi enviado). `restanteMs` alimenta o timer regressivo; ao zerar a página recarrega e o servidor responde expirada.
const esqueleto = n => Array.from({ length: n }, () => `<div class="l t"></div><div class="l m"></div><div class="l c"></div>${Array.from({ length: 5 }, () => '<div class="tb"><i></i><div><div class="l m"></div><div class="l c"></div></div><div class="l"></div><div class="l"></div><div class="l"></div></div>').join('')}<div class="l m"></div><div class="l c"></div>`).join('')
const fmtMMSS = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
export function corpoResultado({ secoes, restanteMs, dobras = CFG_PUBLICO.dobras_visiveis }) {
  const visiveis = secoes.slice(0, Math.max(0, dobras)), bloqueadas = Math.max(0, secoes.length - visiveis.length)
  return `${visiveis.length ? `<div class="rel">${visiveis.map(s => `<section>${s}</section>`).join('')}</div>` : ''}
  ${bloqueadas ? `<div class="sombra" aria-hidden="true"><div class="timer">Esta análise fica disponível por <b id="timer" data-restante="${Math.max(0, Math.round(restanteMs))}">${fmtMMSS(restanteMs)}</b></div><div class="veu"></div><div class="esq">${esqueleto(bloqueadas)}</div></div>` : ''}
  <script>(function(){var el=document.getElementById('timer');if(!el)return;var fim=Date.now()+Number(el.dataset.restante||0);function t(){var r=Math.max(0,fim-Date.now()),s=Math.ceil(r/1000);el.textContent=('0'+Math.floor(s/60)).slice(-2)+':'+('0'+s%60).slice(-2);if(r<=0){clearInterval(iv);location.reload()}}var iv=setInterval(t,1000);t()})()</script>`
}
const corpoExpirado = p => `<div class="mini">Diagnóstico de</div><h2 class="sec">${esc(p.empresa)}</h2>
    <div class="faixa amb">O tempo de visualização desta análise terminou. O diagnóstico completo da sua conta continua guardado e é apresentado por um especialista da Place2u.</div>`
const expirado = (p, agoraMs = Date.now()) => !!p.expira_em && Date.parse(p.expira_em) <= agoraMs
// números rápidos (28 × 28 d ao vivo na API) — a prévia enquanto a leitura completa dos anúncios roda
const blocoRapido = d => { const n = d.numeros.atual, a = d.numeros.anterior || {}; return `
    <div class="sub">Últimos 28 dias completos (${esc(brData(d.janela_atual.de))} a ${esc(brData(d.janela_atual.ate))}) comparados com os 28 anteriores.${d.numeros.parcial ? ' <b>Conta com alto volume: os números são uma amostra parcial.</b>' : ''}</div>
    <div class="kv">
      <div><b>${fmtR(n.faturamento)}</b><span>faturamento</span><br>${delta(n.faturamento, a.faturamento)}</div>
      <div><b>${fmtN(n.vendas)}</b><span>pedidos</span><br>${delta(n.vendas, a.vendas)}</div>
      <div><b>${fmtN(n.visitas)}</b><span>visitas</span><br>${delta(n.visitas, a.visitas)}</div>
      <div><b>${n.conversao != null ? esc(String(n.conversao).replace('.', ',')) + '%' : '—'}</b><span>conversão</span></div>
      <div><b>${fmtR(n.ticket)}</b><span>ticket médio</span><br>${delta(n.ticket, a.ticket)}</div>
      <div><b>${fmtN(n.vendas_canceladas)}</b><span>cancelamentos${n.vendas_canceladas == null ? ' (não lidos)' : ''}</span></div>
    </div>
    <div class="cartao"><b>O que os números dizem</b><p style="margin-top:8px">${esc(d.leitura)}</p>
      ${d.causalidade?.investigar?.length ? `<p style="margin-top:12px"><b>Onde atacar primeiro</b></p><ul>${d.causalidade.investigar.slice(0, 5).map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      <p class="mini" style="margin-top:12px">Leitura automática e preliminar — causa provável, não comprovada. A consultoria aprofunda anúncio a anúncio.</p></div>` }

rotasPublicas.get('/d/:token', async (req, res) => {
  const p = prospectoPorToken(req.params.token)
  if (!p) return res.status(404).send(pagina('Link inválido — Place2u', '<h2 class="sec">Link inválido ou expirado</h2><div class="sub">Gere um novo diagnóstico na página inicial.</div><a class="bt" href="/diagnostico">Ir para o diagnóstico</a>'))
  const ev = { lead_id: p.id, ...utmParaDl(p.utm) }
  if (!p.conectado) return res.send(pagina('Falta conectar — Place2u', `
    <h2 class="sec">Falta só conectar a sua conta, ${esc(p.nome.split(' ')[0])}</h2>
    <div class="sub">O diagnóstico de <b>${esc(p.empresa)}</b> é gerado assim que você conectar a conta no Mercado Livre.</div>
    ${p.link ? `<a class="bt" href="${esc(p.link)}" onclick="try{window.dataLayer.push({event:'ml_connect_start',lead_id:'${esc(p.id)}'})}catch(e){}">Conectar no Mercado Livre</a>` : '<div class="faixa amb">Conexão temporariamente indisponível.</div>'}
    <p class="mini" style="margin-top:12px">${textoPermissao()}</p>${formExcluir(p)}`))
  // relógio: nasce na 1ª abertura conectada e vale por timer_minutos; zerado = só cabeçalho + CTA (recarregar não ressuscita)
  p.expira_em = garantirExpiracao(p.id, CFG_PUBLICO.timer_minutos)
  const barra = barraCta(p)
  if (expirado(p)) return res.send(pagina(`Diagnóstico ${p.empresa} — Place2u`, `${corpoExpirado(p)}${formExcluir(p)}`, { eventos: [['ml_connected', ev], ['report_expired', ev]], barra }))
  const restanteMs = Date.parse(p.expira_em) - Date.now()
  // leitura completa (itens, pedidos 90 d, visitas, Ads, reputação) já gravada → o MESMO relatório do painel, em linguagem para o lead — só as dobras visíveis
  let completo = null
  try { completo = montarDiagnosticoComercial(p.id) } catch (e) { log('aviso', `relatório público do prospect ${p.id}: ${e.message.slice(0, 120)}`) }
  if (completo?.disponivel) {
    const secoes = secoesDiagnosticoComercial(completo, { publico: true })
    return res.send(pagina(`Diagnóstico ${p.empresa} — Place2u`, `
    <div class="mini">Diagnóstico de</div><h2 class="sec">${esc(p.empresa)}</h2>
    <div class="sub">Conta lida em ${esc(brData(completo.hoje))} · ${completo.diag.resumo.anuncios_ativos} anúncios com venda ou Ads.</div>
    ${corpoResultado({ secoes, restanteMs })}${formExcluir(p)}`, { eventos: [['ml_connected', ev], ['report_view', ev]], largo: true, barra }))
  }
  // ainda sem a leitura completa: números rápidos ao vivo + estado honesto (lendo / não lida / sem vendas)
  let dx = cache.get(p.token_publico)
  if (!dx || Date.now() - dx.em > 15 * 60e3) {
    try { dx = { em: Date.now(), dx: await diagnosticoProspecto(p.id) }; cache.set(p.token_publico, dx) }
    catch (e) { dx = { em: 0, dx: { disponivel: false, motivo: `Não conseguimos ler os números rápidos da sua conta agora (${e.message.slice(0, 120)}). Tente novamente em alguns minutos.` } } }
  }
  const d = dx.dx
  const estado = p.coletando ? '<div class="faixa amb">Estamos lendo os anúncios, pedidos e Ads da sua conta (leva alguns minutos). Esta página se atualiza sozinha.</div><script>setTimeout(()=>location.reload(),30000)</script>'
    : completo?.precisa_coletar ? '<div class="faixa amb">A leitura completa dos anúncios ainda não terminou. Um especialista da Place2u foi avisado; o relatório completo aparece aqui assim que ela concluir.</div>'
    : completo?.motivo ? `<div class="faixa amb">${esc(completo.motivo)}</div>` : ''
  if (!d.disponivel) return res.send(pagina('Diagnóstico — Place2u', `<h2 class="sec">Conta conectada ✓</h2>${estado}<div class="faixa amb">${esc(d.motivo)}</div>${corpoResultado({ secoes: [''], restanteMs, dobras: 0 })}${formExcluir(p)}`, { eventos: [['ml_connected', ev]], barra }))
  // números rápidos = a 1ª dobra; a sombra com o timer entra logo abaixo (1 esqueleto), igual à página completa
  res.send(pagina(`Diagnóstico ${p.empresa} — Place2u`, `
    <div class="mini">Diagnóstico de</div><h2 class="sec">${esc(p.empresa)}</h2>
    ${estado}${blocoRapido(d)}
    <p class="mini" style="text-align:center;margin-top:8px">${esc(d.nota)}</p>
    ${corpoResultado({ secoes: [''], restanteMs, dobras: 0 })}${formExcluir(p)}`, { eventos: [['ml_connected', ev], ['report_view', ev]], barra }))
})

// ── lead pede contato: o botão chama por fetch (204) antes de abrir o WhatsApp; sem JS o formulário antigo ainda volta ao resultado ──
rotasPublicas.post('/d/:token/contato', (req, res) => {
  const p = prospectoPorToken(req.params.token)
  if (p && marcarQuerContato(p.id)) log('info', `lead pediu contato: ${p.id}`)
  if (String(req.headers.accept || '').includes('application/json')) return res.status(204).end()
  res.redirect(303, `/d/${req.params.token}`)
})

// ── exclusão pelo titular (LGPD art. 18, VI) ────────────────────────────────
// revoga no ML antes de apagar (melhor esforço); a página só afirma a revogação se o ML confirmou
rotasPublicas.post('/d/:token/excluir', async (req, res) => {
  try {
    const p = prospectoPorToken(req.params.token)
    let revogado = false
    if (p) { ({ revogado } = await removerProspecto(p.id)); cache.delete(p.token_publico); log('info', `lead público excluído pelo titular: ${p.id}${revogado ? ' (autorização revogada no ML)' : ''}`) }
    res.send(pagina('Dados apagados — Place2u', revogado
      ? '<h2 class="sec">Pronto — seus dados foram apagados</h2><div class="sub">Apagamos seus dados. Autorização revogada no Mercado Livre: a Place2u não acessa mais a sua conta.</div>'
      : '<h2 class="sec">Pronto — seus dados foram apagados</h2><div class="sub">Apagamos seus dados. Para remover também a autorização, acesse as configurações de segurança da sua conta do Mercado Livre (aplicativos autorizados).</div>'))
  } catch (e) {
    log('erro', `exclusão pelo titular falhou: ${e.message.slice(0, 160)}`)
    res.status(500).send(pagina('Erro — Place2u', `<h2 class="sec">Não foi possível apagar agora</h2><div class="sub">Tente novamente em alguns minutos${env.COMERCIAL_CONTATO_LGPD ? ` ou escreva para <b>${esc(env.COMERCIAL_CONTATO_LGPD)}</b>` : ''}.</div>`))
  }
})
export { CHAVES_UTM }
