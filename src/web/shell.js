// /shell.js · topo único das 11 telas internas. DOM puro (createElement/textContent, nunca HTML em string), nenhuma API.
(() => {
  const topo = document.getElementById('psShell'); if (!topo) return   // documentos e páginas públicas não têm o placeholder
  const G = [
    ['Visão geral', [['execucao', 'Painel executivo', '/'], ['gmv', 'Faturamento', '/gmv']]],   // "Painel executivo": decisão do CEO (spec 8.7)
    ['Clientes', [['cliente', 'Cliente', '/cliente'], ['promocoes', 'Promoções', '/promocoes']]],
    ['Time', [['analistas', 'Analistas', '/analistas'], ['distribuicao', 'Distribuir ao Notion', '/planos']]],
    ['Comercial', [['comercial', 'Comercial', '/comercial']]],
    ['Método', [['o-que-funciona', 'O que funciona', '/resultados'], ['algoritmo', 'Regras do método', '/metodologia'], ['processos', 'Como fazer', '/processos']]],
  ]
  const INT = ['integracoes', 'Conexões', '/integracoes']
  const CLI = new Set(['/cliente', '/promocoes'])                      // links que carregam ?cliente=
  const pag = document.body.dataset.pagina
  const grupo = G.find(g => g[1].some(a => a[0] === pag))
  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos); return e }
  const attr = (e, o) => { for (const k in o) e.setAttribute(k, o[k]); return e }
  const link = ([id, rotulo, href], props = {}) => { const a = el('a', { href, textContent: rotulo, ...props }); a.dataset.base = href; if (id === pag) a.setAttribute('aria-current', 'page'); return a }
  const linkGrupo = ([nome, abas]) => { const a = el('a', { href: abas[0][2], textContent: nome }); a.dataset.base = abas[0][2]; if (grupo?.[0] === nome) a.setAttribute('aria-current', abas[0][0] === pag ? 'page' : 'true'); return a }

  // favicon: o /logo (svg) serve de ícone da aba e evita o 404 de /favicon.ico em toda carga
  if (!document.querySelector('link[rel~="icon"]')) document.head.append(el('link', { rel: 'icon', href: '/logo', type: 'image/svg+xml' }))

  // marca, grupos, utilitários
  const img = el('img', { className: 'logo', src: '/logo', alt: '', width: 24, height: 24 }); img.onerror = () => img.remove()
  const marca = el('a', { className: 'ps-marca', href: '/' }, img, el('span', { textContent: 'Place Sprints' }))
  const grupos = attr(el('nav', { className: 'ps-grupos' }, ...G.map(linkGrupo)), { 'aria-label': 'Principal' })
  const inp = el('input', { id: 'psBusca', name: 'busca', type: 'search', required: true, minLength: 3, autocomplete: 'off' })
  const resumo = attr(el('summary', { className: 'ps-busca-botao' }, el('span', { className: 'ps-rot', textContent: 'Buscar cliente' }), el('kbd', { textContent: '/' })), { 'aria-label': 'Buscar cliente (atalho /)' })
  const form = attr(el('form', { className: 'ps-busca-painel', action: '/cliente', method: 'get' }, el('label', { htmlFor: 'psBusca', textContent: 'Nome ou CNPJ' }), inp, el('button', { className: 'ps-btn', type: 'submit', textContent: 'Buscar' })), { role: 'search' })
  const busca = el('details', { className: 'ps-busca' }, resumo, form)
  const qDaPagina = () => { const q = document.getElementById('q'); return q && q.offsetParent ? q : null }   // #q de /cliente e /promocoes, se visível
  const abrirBusca = () => { const q = qDaPagina(); if (q) return q.focus(); busca.open = true; inp.focus() }
  resumo.addEventListener('click', e => { const q = qDaPagina(); if (q) { e.preventDefault(); q.focus() } })
  busca.addEventListener('toggle', () => { if (busca.open) inp.focus() })
  const slot = el('span', { className: 'ps-sino-slot' })
  const lista = attr(el('nav', { className: 'ps-menu-lista' }), { 'aria-label': 'Todas as páginas' })
  for (const [nome, abas] of G) lista.append(el('p', { className: 'ps-menu-grupo', textContent: nome }), ...abas.map(a => link(a)))
  lista.append(el('p', { className: 'ps-menu-grupo', textContent: 'Configuração' }), link(INT))
  const menu = el('details', { className: 'ps-menu' }, el('summary', { className: 'ps-menu-botao', textContent: 'Menu' }), lista)
  const pular = el('a', { className: 'ps-pular', href: '#', textContent: 'Pular para o conteúdo' })
  pular.onclick = e => { const m = document.querySelector('main'); if (m) { e.preventDefault(); m.tabIndex = -1; m.focus() } }
  topo.append(pular, el('div', { className: 'ps-barra' }, marca, grupos, el('div', { className: 'ps-util' }, busca, link(INT, { className: 'ps-int' }), slot, menu)))

  // linha 2: abas do grupo (só com 2+ páginas) + contexto do cliente
  let ctx = null
  if (grupo && grupo[1].length > 1) {
    if (grupo[0] === 'Clientes') ctx = el('span', { className: 'ps-ctx' })
    topo.after(attr(el('nav', { className: 'ps-abas' }, el('div', { className: 'ps-abas-in' }, ...grupo[1].map(a => link(a)), ...(ctx ? [ctx] : []))), { 'aria-label': 'Páginas de ' + grupo[0] }))
  }

  // ?cliente= é lido da URL ATUAL sempre que ela muda (cliente.js e promocoes.js usam pushState)
  const sync = () => {
    const c = new URLSearchParams(location.search).get('cliente')
    for (const a of document.querySelectorAll('.ps-shell a[data-base], .ps-abas a[data-base]')) if (CLI.has(a.dataset.base)) a.href = a.dataset.base + (c ? '?cliente=' + encodeURIComponent(c) : '')
    if (ctx) ctx.textContent = c ? 'Cliente: ' + c : ''
  }
  for (const m of ['pushState', 'replaceState']) { const f = history[m]; history[m] = function (...a) { const r = f.apply(this, a); sync(); return r } }
  addEventListener('popstate', sync); sync()

  // sino: move o nó do alerta.js assim que ele entra no body (microtarefa, antes da pintura; os listeners vão junto)
  const moverSino = () => { const s = document.getElementById('psSino'); if (s) { slot.append(s); s.querySelector('button.sino')?.setAttribute('aria-label', 'Avisos do sistema') } return !!s }
  if (!moverSino()) { const mo = new MutationObserver(() => { if (moverSino()) mo.disconnect() }); mo.observe(document.body, { childList: true }) }

  // menus: clique fora ou Esc fecha qualquer details aberto (vale para os menus de todas as telas)
  const fechar = alvo => document.querySelectorAll('details.menu[open], details.ps-menu[open], details.ps-busca[open]').forEach(d => { if (!alvo || !d.contains(alvo)) d.open = false })
  document.addEventListener('click', e => fechar(e.target))
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const d = document.activeElement?.closest?.('details[open]'); fechar(null); d?.querySelector('summary')?.focus(); return }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input,textarea,select,[contenteditable="true"]')) { e.preventDefault(); abrirBusca() }
  })

  // toast e confirmação únicos (substituem alert/confirm/prompt aos poucos; nunca no promocoes.js sem fallback)
  const regiao = (id, erro) => document.getElementById(id) || document.body.appendChild(attr(el('div', { id, className: erro ? 'toast erro' : 'toast' }), erro ? { role: 'alert' } : { role: 'status', 'aria-live': 'polite' }))
  let tToast
  // pré-carrega a tela de destino ao passar o mouse/focar um link do topo (documento só): a troca fica quase instantânea
  const prefetched = new Set()
  const prefetch = a => { const h = a.getAttribute('href'); if (!h || !h.startsWith('/') || h.startsWith('/api') || prefetched.has(h) || h.split('?')[0] === location.pathname) return; prefetched.add(h); document.head.append(el('link', { rel: 'prefetch', href: h })) }
  for (const ev of ['mouseenter', 'focus']) topo.addEventListener(ev, e => { const a = e.target.closest?.('a[href]'); if (a) prefetch(a) }, true)
  document.querySelector('.ps-abas')?.addEventListener('mouseenter', e => { const a = e.target.closest?.('a[href]'); if (a) prefetch(a) }, true)

  window.PS = {
    // a régua: proporção real sob o veredito (valor × marco de referência), em %; sem valor numérico ela some
    regua(alvo, { valor, marco = null, rotulo = '', rotuloMarco = '' } = {}) {
      const r = typeof alvo === 'string' ? document.getElementById(alvo) : alvo; if (!r) return
      let rot = r.nextElementSibling?.classList.contains('regua-rotulo') ? r.nextElementSibling : null
      if (!Number.isFinite(valor)) { r.hidden = true; if (rot) rot.hidden = true; return }
      r.hidden = false; r.replaceChildren(el('i'), ...(Number.isFinite(marco) ? [el('b')] : []))
      r.style.setProperty('--v', Math.max(0, Math.min(100, valor)) + '%'); if (Number.isFinite(marco)) r.style.setProperty('--m', Math.max(0, Math.min(100, marco)) + '%')
      r.setAttribute('role', 'img'); r.setAttribute('aria-label', `${rotulo}${Number.isFinite(marco) ? ` · referência ${rotuloMarco}` : ''}`)
      if (!rot) { rot = el('div', { className: 'regua-rotulo' }); r.after(rot) }
      rot.hidden = false; rot.replaceChildren(el('span', {}, el('b', { textContent: rotulo })), el('span', { textContent: rotuloMarco }))
    },
    toast(texto, tipo = 'ok') {
      const erro = tipo === 'erro', r = regiao(erro ? 'psMsgErro' : 'psMsg', erro)
      regiao(erro ? 'psMsg' : 'psMsgErro', !erro).textContent = ''        // as duas regiões ocupam o mesmo canto: só uma por vez
      r.textContent = texto; clearTimeout(tToast); tToast = setTimeout(() => { r.textContent = '' }, 6000)
    },
    confirmar({ titulo, texto = '', rotuloOk = 'Confirmar', perigo = false }) {
      const d = el('dialog', { className: 'dlg' }, el('form', { method: 'dialog' }, el('h2', { textContent: titulo }), el('p', { textContent: texto }),
        el('div', { className: 'dlg-rodape' }, el('button', { className: 'ps-btn', value: 'nao', textContent: 'Cancelar' }), el('button', { className: perigo ? 'ps-btn ps-perigo' : 'ps-btn ps-primario', value: 'sim', textContent: rotuloOk }))))
      document.body.append(d); d.showModal()
      return new Promise(ok => d.addEventListener('close', () => { ok(d.returnValue === 'sim'); d.remove() }, { once: true }))
    },
  }

  document.addEventListener('DOMContentLoaded', () => {
    regiao('psMsg'); regiao('psMsgErro', true)                          // regiões vivas existem antes da 1ª mensagem
    const b = new URLSearchParams(location.search).get('busca'), q = document.getElementById('q')
    if (pag === 'cliente' && b && q) { q.value = b; q.dispatchEvent(new Event('input')); q.focus() }   // reusa a busca do cliente.js
  })
})()
