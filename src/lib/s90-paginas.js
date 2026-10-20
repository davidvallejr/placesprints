// Place Sprint 90: páginas do painel do CLIENTE (host SPRINT90_PUBLIC_HOST). Autocontidas: o host público não alcança /ui.css, /shell.js nem /alerta.js,
// então as cores vêm embutidas do 1º :root de src/web/ui.css (fonte única dos tokens) e o resto do CSS só usa var(--token).
// Cabeçalhos: CSP com nonce (nenhum script sem ele), no-store, noindex, referrer só para o próprio site (same-origin: com no-referrer o navegador manda
// Origin: null no POST de formulário e a guarda de CSRF barra; para fora — Mercado Livre — não vai referrer nenhum), sem iframe. O JS do painel monta tudo por DOM (textContent),
// nunca innerHTML com dado do servidor. A cópia fixa daqui NÃO passa pelo auditor do motor (s90-texto.js) — é texto da casa.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ROOT } from './env.js'
import { esc } from './estilo-editorial.js'

export const PRODUTO = 'Place Sprint 90'
const TOKENS = (() => {
  try { const ui = readFileSync(join(ROOT, 'src', 'web', 'ui.css'), 'utf8'), i = ui.indexOf(':root{'); return i >= 0 ? ui.slice(i, ui.indexOf('}', i) + 1) : ':root{}' } catch { return ':root{}' }
})()
const CSS = `${TOKENS}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--tinta);font:400 15px/1.55 var(--fonte);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}:focus-visible{outline:2px solid var(--laranja);outline-offset:2px}a{color:inherit}
.topo{background:var(--superficie);border-bottom:1px solid var(--borda)}.topo-in{max-width:880px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.marca{display:flex;align-items:center;gap:10px;font-weight:600}.marca img{width:28px;height:28px;border-radius:var(--raio-p)}.marca b{color:var(--laranja)}
main{max-width:880px;margin:0 auto;padding:24px 16px 56px}
h1{margin:0 0 6px;font:600 24px/1.25 var(--fonte);letter-spacing:-.015em}h2{margin:28px 0 8px;font:600 16px/1.3 var(--fonte)}h3{margin:0 0 6px;font:600 15px/1.35 var(--fonte)}
p{margin:0 0 10px;max-width:72ch}.sub,.mini{color:var(--cinza)}.mini{font-size:12.5px}
.cartao{background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);padding:16px;margin:12px 0}
.btn{display:inline-block;border:1px solid var(--borda-forte);background:var(--superficie);color:var(--tinta);border-radius:var(--raio-p);padding:9px 14px;font:500 14px var(--fonte);cursor:pointer;text-decoration:none}
.btn:hover{background:var(--fundo-suave)}.btn[disabled]{opacity:.55;cursor:wait}
.btn-primario{background:var(--laranja);border-color:var(--laranja);color:var(--superficie)}.btn-primario:hover{background:var(--laranja-escuro)}
.btn-perigo{color:var(--verm);border-color:var(--verm)}
.abas{display:flex;gap:4px;border-bottom:1px solid var(--borda);margin:8px 0 16px;overflow-x:auto}
.abas button{border:0;background:none;padding:10px 12px;font:500 14px var(--fonte);color:var(--cinza);cursor:pointer;border-bottom:2px solid transparent}
.abas button[aria-selected=true]{color:var(--tinta);border-bottom-color:var(--laranja)}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden;margin:12px 0}
.kpi{padding:14px 16px;box-shadow:-1px -1px 0 var(--borda)}.kpi span{display:block;font-size:12px;color:var(--cinza)}.kpi b{display:block;font:600 22px/1.2 var(--fonte);font-variant-numeric:tabular-nums}
.faixa{border-radius:var(--raio);padding:12px 14px;margin:12px 0}.faixa.aviso{background:var(--ambar-suave);color:var(--ambar)}.faixa.ok{background:var(--verde-suave);color:var(--verde)}.faixa.erro{background:var(--verm-suave);color:var(--verm)}
.rotulo{font-size:12px;font-weight:500;color:var(--cinza)}.selo{display:inline-block;font-size:12px;border:1px solid var(--borda-forte);border-radius:var(--raio-pilula);padding:1px 8px;color:var(--cinza)}
.acao{display:grid;grid-template-columns:72px 1fr;gap:14px}.acao img{width:72px;height:72px;object-fit:cover;border-radius:var(--raio-p);border:1px solid var(--borda)}
.acao ol,.acao ul{margin:4px 0 8px 18px;padding:0}.acao li{margin:2px 0}
label.linha{display:flex;gap:10px;align-items:flex-start;margin:10px 0;font-size:14px}label.linha input{margin-top:4px;width:18px;height:18px;flex:none}
select{border:1px solid var(--borda-campo);border-radius:var(--raio-p);padding:9px 10px;font:14px var(--fonte);background:var(--superficie);color:var(--tinta);max-width:100%}
.intencional{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
input[type=text]{width:100%;border:1px solid var(--borda-campo);border-radius:var(--raio-p);padding:11px 12px;font:15px var(--fonte);background:var(--superficie);color:var(--tinta)}
.erro-txt{color:var(--verm);font-size:13px;margin-top:8px}
.termos h2{margin-top:20px}.termos li{margin:4px 0}
footer{max-width:880px;margin:0 auto;padding:16px;text-align:center;font-size:12px;color:var(--cinza-claro)}
@media(max-width:640px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.acao{grid-template-columns:1fr}.acao img{width:56px;height:56px}}`

// cabeçalhos de toda página do painel; devolve o nonce do <script>
export function cabecalhos(res) {
  const nonce = randomBytes(16).toString('base64')
  res.set({
    'Content-Security-Policy': `default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
  })
  return nonce
}

const pagina = (titulo, corpo, { nonce = '', script = '', topo = '' } = {}) => `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="same-origin">
<title>${esc(titulo)}</title><style>${CSS}</style></head><body>
<header class="topo"><div class="topo-in"><div class="marca"><img src="/logo" alt=""><span><b>Place</b>2u · ${PRODUTO}</span></div>${topo}</div></header>
<main id="conteudo">${corpo}</main>
<footer>Place2u · ${PRODUTO} · seus dados do Mercado Livre são lidos com a sua autorização; nada é alterado no anúncio sem a sua aprovação</footer>
${script ? `<script nonce="${esc(nonce)}">${script}</script>` : ''}</body></html>`

export const paginaErro = (titulo, texto, opts = {}) => pagina(`${titulo} · ${PRODUTO}`, `<h1>${esc(titulo)}</h1><p class="sub">${esc(texto)}</p><p><a class="btn" href="/c/entrar">Ir para a entrada do painel</a></p>`, opts)

// ── entrar: cole o seu link (sem formulário de e-mail nesta versão) ──
export const paginaEntrar = ({ nonce, saiu = false }) => pagina(`Entrar · ${PRODUTO}`, `
  <h1>Entrar no painel</h1>
  <p class="sub">O acesso é pelo link pessoal que você recebeu da Place2u ou guardou no próprio painel. Ele abre o painel uma vez; depois o navegador lembra de você por 30 dias.</p>
  ${saiu ? '<div class="faixa ok">Você saiu do painel neste navegador.</div>' : ''}
  <form class="cartao" id="fEntrar" autocomplete="off">
    <label class="rotulo" for="link">Cole aqui o seu link de acesso</label>
    <input type="text" id="link" name="link" inputmode="url" spellcheck="false" placeholder="https://…/c/acesso/…">
    <p><button class="btn btn-primario" type="submit">Entrar</button></p>
    <div class="erro-txt" id="erro" role="alert"></div>
  </form>
  <p class="mini">Perdeu o link? Fale com a Place2u: a equipe gera um novo para você. Por segurança, nesta versão nenhum link é enviado por e-mail.</p>`, { nonce, script: `
document.getElementById('fEntrar').addEventListener('submit', function (e) {
  e.preventDefault()
  var v = document.getElementById('link').value.trim(), m = v.match(/\\/c\\/acesso\\/([A-Za-z0-9_-]{22})(?:[?#\\/]|$)/) || v.match(/^([A-Za-z0-9_-]{22})$/)
  if (!m) { document.getElementById('erro').textContent = 'Esse não parece um link de acesso do painel. Confira se colou o link inteiro.'; return }
  location.href = '/c/acesso/' + m[1]
})` })

// ── acesso: o GET só mostra o botão (pré-visualização de link no WhatsApp/e-mail não gasta o uso único); o POST consome ──
export const paginaAcesso = ({ nonce }) => pagina(`Entrar · ${PRODUTO}`, `
  <h1>Entrar no painel</h1>
  <p class="sub">Este link abre o seu painel uma única vez neste navegador.</p>
  <form method="post"><button class="btn btn-primario" type="submit">Entrar no painel</button></form>`, { nonce })

// ── termos (texto do arquivo versionado, renderizado sem HTML do arquivo: tudo escapado) ──
const md = t => String(t).replace(/\r/g, '').split(/\n{2,}/).map(b => {
  const l = b.trim(), negrito = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  if (!l) return ''
  if (/^#{1,4}\s/.test(l)) return `<h2>${negrito(l.replace(/^#+\s*/, ''))}</h2>`
  const linhas = l.split('\n')
  if (linhas.every(x => /^\s*([-*]|\d+\.)\s/.test(x))) return `<ul>${linhas.map(x => `<li>${negrito(x.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</ul>`
  return `<p>${linhas.map(negrito).join('<br>')}</p>`
}).join('')
// /c/privacidade = a seção "## … Aviso de Privacidade" do MESMO arquivo dos termos (fonte única); sem a seção, o documento inteiro
const secaoPrivacidade = t => { const i = t.search(/^##\s.*privacidade/im); if (i < 0) return t; const resto = t.slice(i), f = resto.slice(2).search(/^##\s/m); return f < 0 ? resto : resto.slice(0, f + 2) }
export const paginaTermos = ({ nonce, termos, privacidade = false }) => termos
  ? pagina(`${privacidade ? 'Privacidade' : 'Termos'} · ${PRODUTO}`, `${termos.rascunho ? '<div class="faixa aviso">Rascunho em revisão jurídica: ainda não publicado. Só contas de piloto o aceitam.</div>' : ''}<p class="mini">Versão ${esc(termos.versao)}</p>
    <div class="termos">${md(privacidade ? secaoPrivacidade(termos.texto) : termos.texto)}</div>`, { nonce })
  : paginaErro(privacidade ? 'Aviso de privacidade em preparação' : 'Termos em preparação', 'O texto do Place Sprint 90 ainda está sendo publicado. Volte mais tarde.', { nonce })

export const paginaExcluida = ({ nonce, revogado, pendente }) => pagina(`Dados · ${PRODUTO}`, pendente
  ? '<h1>Exclusão agendada</h1><p class="sub">Recebemos o seu pedido. A exclusão termina assim que a assinatura for cancelada no Mercado Pago; nada novo é cobrado por esta conta depois disso.</p>'
  : `<h1>Pronto: seus dados foram apagados</h1><p class="sub">${revogado ? 'A autorização no Mercado Livre foi revogada: a Place2u não acessa mais a sua conta.' : 'Para remover também a autorização, acesse as configurações de segurança da sua conta do Mercado Livre (aplicativos autorizados).'} Faturas, pagamentos e o registro do seu aceite ficam guardados pelo prazo fiscal, como dizem os termos.</p>`, { nonce })

// ── painel: Resumo · Prioridades · Conta (montado no navegador a partir de /c/api/*) ──
const SAIR = '<form method="post" action="/c/sair"><button class="btn" type="submit">Sair</button></form>'
export const paginaPainel = ({ nonce }) => pagina(`Painel · ${PRODUTO}`, `
  <h1 id="titulo">Seu painel</h1>
  <p class="sub" id="linhaConta">Carregando…</p>
  <div class="abas" role="tablist" aria-label="Seções do painel">
    <button type="button" role="tab" id="abaResumo" aria-selected="true" aria-controls="secResumo" data-aba="Resumo">Resumo</button>
    <button type="button" role="tab" id="abaPrioridades" aria-selected="false" aria-controls="secPrioridades" data-aba="Prioridades">Prioridades</button>
    <button type="button" role="tab" id="abaConta" aria-selected="false" aria-controls="secConta" data-aba="Conta">Conta</button>
  </div>
  <section id="secResumo" role="tabpanel" aria-labelledby="abaResumo"></section>
  <section id="secPrioridades" role="tabpanel" aria-labelledby="abaPrioridades" hidden></section>
  <section id="secConta" role="tabpanel" aria-labelledby="abaConta" hidden></section>`, { nonce, topo: SAIR, script: SCRIPT_PAINEL })

const SCRIPT_PAINEL = `
'use strict'
var $ = function (id) { return document.getElementById(id) }
function el(tag, props) {
  var e = document.createElement(tag), filhos = Array.prototype.slice.call(arguments, 2)
  Object.keys(props || {}).forEach(function (k) { var v = props[k]; if (v == null || v === false) return; if (k === 'class') e.className = v; else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]) }); else e.setAttribute(k, v) })
  filhos.flat(9).forEach(function (f) { if (f != null && f !== false && f !== '') e.append(f instanceof Node ? f : String(f)) })
  return e
}
var reais = function (n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) }
var centavos = function (c) { return (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
var inteiro = function (n) { return n == null ? '—' : Number(n).toLocaleString('pt-BR') }
var pct = function (n) { return n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ',') + '%' }
var data = function (iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—' }
function api(url, corpo) {
  var o = corpo === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) }
  return fetch(url, o).then(function (r) {
    if (r.status === 401) { location.href = '/c/entrar'; throw new Error('Sessão expirada.') }
    return r.json().catch(function () { return {} }).then(function (j) { if (!r.ok) throw new Error(j.erro || 'Não foi possível concluir agora.'); return j })
  })
}
function trocar(nome) {
  ['Resumo', 'Prioridades', 'Conta'].forEach(function (n) { $('aba' + n).setAttribute('aria-selected', String(n === nome)); $('sec' + n).hidden = n !== nome })
}
document.querySelector('.abas').addEventListener('click', function (e) { var b = e.target.closest('[data-aba]'); if (b) trocar(b.dataset.aba) })
function falha(sec, msg) { sec.replaceChildren(el('div', { class: 'faixa erro' }, msg)) }

var R = null
function botaoConectar(texto, primario) { return el('a', { class: 'btn' + (primario ? ' btn-primario' : ''), href: '/c/conectar' }, texto) }
function desenharAceite(sec) {
  var a = el('input', { type: 'checkbox', id: 'cbAceite' }), c = el('input', { type: 'checkbox', id: 'cbConsent' }), erro = el('div', { class: 'erro-txt', role: 'alert' })
  var bt = el('button', { class: 'btn btn-primario', type: 'button', on: { click: function () {
    erro.textContent = ''
    if (!a.checked || !c.checked) { erro.textContent = 'Marque as duas caixas para continuar.'; return }
    bt.disabled = true
    api('/c/api/aceite', { aceite: true, consentimento: true }).then(function () { location.reload() }, function (e) { erro.textContent = e.message; bt.disabled = false })
  } } }, 'Aceitar e continuar')
  sec.append(el('div', { class: 'cartao' },
    el('h3', {}, 'Antes de começar'),
    el('p', { class: 'sub' }, 'Leia os termos do ' + 'Place Sprint 90 e confirme. Sem o aceite, o painel não conecta a sua conta.'),
    el('p', {}, el('a', { href: '/c/termos', target: '_blank', rel: 'noopener' }, 'Ler os termos (versão ' + (R.termos_versao || '—') + ')')),
    el('label', { class: 'linha' }, a, el('span', {}, 'Li e aceito os Termos e a Política de Privacidade. Sei que a autorização do Mercado Livre inclui permissão de escrita, usada só depois da minha aprovação em cada mudança.')),
    el('label', { class: 'linha' }, c, el('span', {}, 'Autorizo a Place2u a tratar meus dados de contato e os dados de vendas, visitas e anúncios da minha conta para operar o painel, como descrito na Política. Posso excluir meus dados pelo painel e pedir a exportação deles à Place2u.')),
    bt, erro))
}
function desenharResumo() {
  var sec = $('secResumo'), c = R.conta
  sec.replaceChildren()
  if (R.aceite_pendente) { if (R.termos_disponiveis) desenharAceite(sec); else sec.append(el('div', { class: 'faixa aviso' }, 'Os termos estão em preparação. Assim que forem publicados, o painel pede o seu aceite aqui.')); return }
  if (c.estado === 'pendente_pagamento') sec.append(el('div', { class: 'faixa aviso' }, 'Sua conta ainda não foi ativada. Assim que a Place2u ativar, o botão para conectar o Mercado Livre aparece aqui.'))
  if (c.estado === 'pausado' || c.estado === 'inadimplente') sec.append(el('div', { class: 'faixa aviso' }, 'Conta pausada: a leitura continua, mas nada novo é preparado. Fale com a Place2u.'))
  if (c.estado === 'cancelado') sec.append(el('div', { class: 'faixa aviso' }, 'Assinatura cancelada: o painel fica disponível só para consulta e exclusão dos dados. Para exportá-los, peça à Place2u.'))
  var cx = R.conexao
  if (cx.estado === 'conectada') sec.append(el('p', { class: 'sub' }, 'Mercado Livre conectado' + (cx.nickname ? ' como ' + cx.nickname : '') + (cx.desde ? ' desde ' + data(cx.desde) : '') + '.'))
  else if (cx.estado === 'caida') sec.append(el('div', { class: 'faixa erro' }, 'A conexão com o Mercado Livre caiu. Autorize de novo para o painel voltar a ler a sua conta. ', R.pode_conectar ? botaoConectar('Reconectar', true) : ''))
  else if (R.pode_conectar) sec.append(el('div', { class: 'cartao' }, el('h3', {}, 'Conecte a sua conta do Mercado Livre'), el('p', { class: 'sub' }, 'Pelo login oficial do Mercado Livre: a Place2u nunca vê a sua senha. A tela do Mercado Livre lista as permissões; a de escrita só é usada quando você aprova uma mudança.'), botaoConectar('Conectar o Mercado Livre', true)))
  if (R.leitura && R.leitura.lendo) sec.append(el('div', { class: 'faixa aviso' }, 'Estamos lendo a sua conta. Os números aparecem aqui assim que a primeira leitura terminar.'))
  var n = R.numeros
  if (n) {
    var k = function (rot, val, det) { return el('div', { class: 'kpi' }, el('span', {}, rot), el('b', {}, val), det ? el('span', {}, det) : '') }
    sec.append(el('h2', {}, 'Últimos 28 dias'), el('div', { class: 'kpis' },
      k('Faturamento', reais(n.faturamento_28d), n.variacao_pct == null ? 'sem comparação completa' : (n.variacao_pct > 0 ? '+' : '') + pct(n.variacao_pct) + ' vs 28 dias anteriores'),
      k('Pedidos', inteiro(n.pedidos)), k('Ticket médio', reais(n.ticket)), k('Conversão da conta', pct(n.conversao_pct))),
      el('p', { class: 'mini' }, inteiro(n.anuncios_ativos) + ' anúncio(s) com venda ou Ads no período. Números da API oficial do Mercado Livre; dia sem leitura não conta como zero.'))
  }
  if (R.prioridades > 0) sec.append(el('div', { class: 'cartao' }, el('h3', {}, R.prioridades + ' prioridade(s) nesta semana'), el('p', { class: 'sub' }, 'Poucas ações, as que mais pesam no resultado da sua conta agora.'), el('button', { class: 'btn', type: 'button', on: { click: function () { trocar('Prioridades') } } }, 'Ver prioridades')))
}
function cenarios(p) {
  if (!p || !p.cenarios) return ''
  var c = p.cenarios, risco = p.tipo === 'risco_evitado'
  return el('div', {},
    el('p', { class: 'mini' }, (risco ? 'Receita protegida estimada' : 'Ganho estimado') + ' em ' + (p.horizonte_dias || 28) + ' dias: conservador ' + reais(c.conservador.receita) + ' · base ' + reais(c.base.receita) + ' · otimista ' + reais(c.otimista.receita) + '. Hipótese com premissas declaradas, não é promessa.'),
    p.p_sucesso != null ? el('p', { class: 'mini' }, 'Chance estimada de dar certo: ' + Math.round(p.p_sucesso * 100) + '%' + (p.p_fonte ? ' (' + p.p_fonte + ')' : '') + '.') : '',
    p.premissas && p.premissas.length ? el('details', {}, el('summary', { class: 'mini' }, 'Premissas'), el('ul', { class: 'mini' }, p.premissas.map(function (x) { return el('li', {}, x) }))) : '')
}
// "É intencional": o cliente diz que a prioridade é de propósito, com um motivo da lista fechada (POST /c/api/acoes/{ref}/intencional) — revisamos na data de revisão
function blocoIntencional(a, motivos) {
  var caixa = el('div', { class: 'intencional' })
  if (a.intencional) { caixa.append(el('span', { class: 'selo' }, a.intencional.texto)); return caixa }
  if (!a.ref || !motivos.length) return caixa
  var abrir = el('button', { class: 'btn', type: 'button', on: { click: function () {
    var id = 'mot-' + a.ref, sel = el('select', { id: id }, el('option', { value: '' }, 'Escolha o motivo'), motivos.map(function (m) { return el('option', { value: m.id }, m.rotulo) }))
    var erro = el('span', { class: 'erro-txt' })
    var ok = el('button', { class: 'btn btn-primario', type: 'button', on: { click: function () {
      if (!sel.value) { erro.textContent = 'Escolha um motivo da lista.'; return }
      ok.disabled = true
      api('/c/api/acoes/' + a.ref + '/intencional', { motivo_tipo: sel.value }).then(function (j) { caixa.replaceChildren(el('span', { class: 'selo' }, j.intencional.texto)) }, function (e) { erro.textContent = e.message; ok.disabled = false })
    } } }, 'Confirmar')
    caixa.replaceChildren(el('label', { for: id, class: 'rotulo' }, 'Por que é de propósito?'), sel, ok, el('button', { class: 'btn', type: 'button', on: { click: function () { caixa.replaceWith(blocoIntencional(a, motivos)) } } }, 'Cancelar'), erro)
  } } }, 'É intencional')
  caixa.append(abrir, el('span', { class: 'mini' }, 'Se esta prioridade é assim de propósito, marque: ela sai da sua lista e revisamos depois.'))
  return caixa
}
function cartaoAcao(a, i, motivos) {
  var an = a.anuncio
  return el('article', { class: an && an.thumb ? 'cartao acao' : 'cartao' },
    an && an.thumb ? el('img', { src: an.thumb, alt: '' }) : '',
    el('div', {},
      el('span', { class: 'selo' }, (i + 1) + 'ª prioridade' + (a.prazo ? ' · até ' + data(a.prazo) : '')),
      el('h3', {}, a.titulo),
      an ? el('p', { class: 'mini' }, an.permalink ? el('a', { href: an.permalink, target: '_blank', rel: 'noopener noreferrer' }, an.titulo || an.id) : (an.titulo || an.id), an.id ? ' · ' + an.id : '') : '',
      el('p', { class: 'mini' }, a.modo_texto),
      a.problema ? el('p', {}, el('span', { class: 'rotulo' }, 'O que acontece: '), a.problema) : '',
      a.evidencia ? el('p', {}, el('span', { class: 'rotulo' }, 'Fato medido: '), a.evidencia) : '',
      a.hipotese ? el('p', {}, el('span', { class: 'rotulo' }, 'Hipótese: '), a.hipotese) : '',
      a.como && a.como.length ? el('div', {}, el('span', { class: 'rotulo' }, 'Como fazer'), el('ol', {}, a.como.map(function (x) { return el('li', {}, x) }))) : '',
      a.indicador || a.meta ? el('p', { class: 'mini' }, 'Hoje: ' + (a.indicador || '—') + ' · meta: ' + (a.meta || '—')) : '',
      cenarios(a.previsao),
      blocoIntencional(a, motivos || [])))
}
function desenharPrioridades() {
  var sec = $('secPrioridades')
  if (R.aceite_pendente) { sec.replaceChildren(el('p', { class: 'sub' }, 'Aceite os termos no Resumo para ver as prioridades.')); return }
  sec.replaceChildren(el('p', { class: 'sub' }, 'Carregando…'))
  api('/c/api/acoes').then(function (j) {
    sec.replaceChildren(el('h2', {}, 'Prioridades desta semana'), el('p', { class: 'sub' }, 'Escolhidas pelo diagnóstico da sua conta: impacto em reais, gravidade, força da evidência e facilidade. Nada é alterado no anúncio sem a sua aprovação.'))
    if (!j.acoes.length) sec.append(el('div', { class: 'cartao' }, R.conexao.estado === 'conectada' ? 'Nenhuma prioridade nesta semana: o diagnóstico não achou ação que mova o resultado agora, ou a primeira leitura ainda está em curso.' : 'Conecte a sua conta do Mercado Livre para o diagnóstico montar as prioridades.'))
    j.acoes.forEach(function (a, i) { sec.append(cartaoAcao(a, i, j.motivos_intencional || [])) })
    sec.append(el('p', { class: 'mini' }, j.fora_do_autoatendimento))
    blocoMarcacoes(sec)
  }, function (e) { falha(sec, e.message) })
}
// o que você marcou como intencional (GET /c/api/intencionais): continua valendo depois que a prioridade sai da lista; "Desfazer" volta a recomendação no próximo plano
function blocoMarcacoes(sec) {
  api('/c/api/intencionais').then(function (j) {
    if (!j.intencionais || !j.intencionais.length) return
    sec.append(el('h3', {}, 'Marcadas por você como intencionais'), el('ul', { class: 'mini' }, j.intencionais.map(function (m) {
      var erro = el('span', { class: 'erro-txt' })
      var bt = el('button', { class: 'btn', type: 'button', on: { click: function () {
        bt.disabled = true
        api('/c/api/intencionais/' + m.ref + '/desfazer', {}).then(function () { desenharPrioridades() }, function (e) { erro.textContent = e.message; bt.disabled = false })
      } } }, 'Desfazer')
      return el('li', {}, (m.motivo || 'Intencional') + (m.anuncio ? ' · ' + m.anuncio : '') + ' · ' + m.texto + (m.estado === 'em_revisao' ? ' (em revisão)' : '') + ' ', bt, erro)
    })), el('p', { class: 'mini' }, 'Desfazer devolve a recomendação na próxima atualização das suas prioridades.'))
  }, function () { /* lista auxiliar: falha não apaga as prioridades */ })
}
function desenharConta() {
  var sec = $('secConta'), c = R.conta, saida = el('div', { role: 'status' }), saidaAcesso = el('div', { role: 'status' })
  var plano = c.plano_rotulo + ': ' + centavos(c.preco_centavos) + ' por mês' + (c.comissao_pct ? ' + ' + c.comissao_pct + '% do faturamento aprovado' : '')
  var guardar = el('button', { class: 'btn', type: 'button', on: { click: function () {
    guardar.disabled = true
    api('/c/api/acesso/gerar', {}).then(function (j) {
      var campo = el('input', { type: 'text', readonly: 'readonly', value: j.url })
      saidaAcesso.replaceChildren(el('div', { class: 'faixa ok' }, 'Guarde este link num lugar seguro (ele aparece só agora). Ele abre o painel uma vez e vale até ' + data(j.expira_em) + '. Não compartilhe.'), campo,
        el('p', {}, el('button', { class: 'btn', type: 'button', on: { click: function () { navigator.clipboard.writeText(j.url).then(function () { toastLocal('Link copiado.') }, function () { campo.select() }) } } }, 'Copiar')))
    }, function (e) { saidaAcesso.replaceChildren(el('div', { class: 'faixa erro' }, e.message)) }).finally(function () { guardar.disabled = false })
  } } }, 'Guardar meu acesso')
  var excluir = el('button', { class: 'btn btn-perigo', type: 'button', on: { click: function () {
    if (!confirm('Apagar os seus dados e revogar o acesso da Place2u à sua conta do Mercado Livre? Isso não pode ser desfeito.')) return
    excluir.disabled = true
    api('/c/api/dados/excluir', { confirmar: true }).then(function (j) {
      $('conteudo').replaceChildren(el('h1', {}, j.pendente ? 'Exclusão agendada' : 'Pronto: seus dados foram apagados'), el('p', { class: 'sub' }, j.mensagem))
    }, function (e) { saida.replaceChildren(el('div', { class: 'faixa erro' }, e.message)); excluir.disabled = false })
  } } }, 'Excluir meus dados')
  function toastLocal(t) { saidaAcesso.append(el('p', { class: 'mini' }, t)) }
  sec.replaceChildren(
    el('h2', {}, 'Sua conta'),
    el('div', { class: 'cartao' }, el('p', {}, el('b', {}, c.loja)), el('p', { class: 'sub' }, plano),
      el('p', { class: 'mini' }, 'Situação: ' + c.estado_texto + (c.inicio_em ? ' · início em ' + data(c.inicio_em) : '') + (c.preco_travado_ate ? ' · preço garantido até ' + data(c.preco_travado_ate) : ''))),
    el('h2', {}, 'Mercado Livre'),
    el('p', { class: 'sub' }, R.conexao.estado === 'conectada' ? 'Conectado' + (R.conexao.nickname ? ' como ' + R.conexao.nickname : '') + '.' : R.conexao.estado === 'caida' ? 'Conexão caída.' : 'Sem conexão.'),
    R.pode_conectar ? botaoConectar(R.conexao.estado === 'sem_conexao' ? 'Conectar o Mercado Livre' : 'Reconectar o Mercado Livre', false) : el('p', { class: 'mini' }, R.aceite_pendente ? 'Aceite os termos no Resumo para conectar.' : 'A conexão fica disponível com a conta ativa.'),
    el('h2', {}, 'Acesso'),
    el('p', { class: 'sub' }, 'Sem e-mail nesta versão: gere um link pessoal e guarde. Ele serve para entrar de novo neste ou em outro navegador.'),
    guardar, saidaAcesso,
    el('form', { method: 'post', action: '/c/sair?todos=1' }, el('p', { class: 'mini' }, 'Usou o painel num computador que não é seu, ou perdeu um link guardado? Encerre todas as sessões e invalide os links ainda não usados.'), el('button', { class: 'btn', type: 'submit' }, 'Sair de todos os aparelhos')),
    el('h2', {}, 'Seus dados'),
    el('p', { class: 'sub' }, 'Você pode pedir a exclusão a qualquer momento. Faturas, pagamentos e o registro do aceite ficam guardados pelo prazo fiscal.'),
    excluir, saida)
}
api('/c/api/resumo').then(function (j) {
  R = j
  $('titulo').textContent = j.conta.loja
  $('linhaConta').textContent = j.conta.plano_rotulo + ' · ' + j.conta.estado_texto + (j.conta.dia ? ' · Dia ' + j.conta.dia + ' de ' + j.conta.total + (j.conta.fase ? ' · ' + j.conta.fase : '') : '')
  if (new URLSearchParams(location.search).get('conectado') === '1') $('secResumo').before(el('div', { class: 'faixa ok' }, 'Conta do Mercado Livre conectada. A primeira leitura começa agora.'))
  desenharResumo(); desenharPrioridades(); desenharConta()
}, function (e) { falha($('secResumo'), e.message) })
`
