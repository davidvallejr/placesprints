// /shell.js · topo único das 11 telas internas. DOM puro (createElement/textContent, nunca HTML em string), nenhuma API.
(() => {
  const topo = document.getElementById('psShell'); if (!topo) return   // documentos e páginas públicas não têm o placeholder
  // Os 5 menus (docs/ux/arquitetura-5-menus.md § A). Item = [id, rótulo, href]; id = pagina ou pagina:aba; href só de rota que já existe
  // (teste-shell-ui). Estruturas e Equipe vivem em /estrutura (F3); o lugar do antigo utilitário «Integrações» tem Hoje (F5, /fila por papel)
  // e Quem sou (F2). Assinantes do autoatendimento ficam em /integracoes, nunca no topo.
  const G = [
    ['Assessoria', [['execucao', 'Painel executivo', '/'], ['gmv', 'Faturamento', '/gmv'], ['o-que-funciona', 'O que funciona', '/resultados'], ['algoritmo', 'Acerto do algoritmo', '/metodologia'], ['distribuicao:risco', 'Carteira em risco', '/planos?sec=secRisco'], ['comercial', 'Comercial', '/comercial']]],   // "Painel executivo": decisão do CEO (spec 8.7)
    ['Consultor', [['cliente:resumo', 'Resumo', '/cliente?aba=resumo'], ['cliente:plano', 'Plano', '/cliente?aba=plano'], ['cliente:anuncios', 'Anúncios', '/cliente?aba=anuncios'], ['cliente:estrategia', 'Estratégia', '/cliente?aba=estrategia'], ['promocoes', 'Promoções', '/promocoes'], ['processos', 'Como fazer', '/processos']]],
    ['Execução', [['distribuicao', 'Distribuir', '/planos'], ['cliente:executar', 'Execução no ML', '/cliente?aba=executar'], ['cliente:do-cliente', 'Pelo cliente', '/cliente?aba=do-cliente'], ['cliente:ofertas', 'Ofertas', '/cliente?aba=anuncios&sec=secOfertas'], ['analistas', 'Analistas', '/analistas']]],
    ['Empresa do cliente', [['cliente:produtos', 'Produtos e estoque', '/cliente?aba=produtos'], ['cliente:lucro', 'Lucro do mês', '/cliente?aba=produtos&visao=lucro'], ['cliente:compras', 'Compras', '/cliente?aba=relatorios&rc=ciclo_compras'], ['cliente:precos', 'Preços', '/cliente?aba=anuncios&sec=secPrecos'], ['cliente:financeiro', 'Raio-X e contrato', '/cliente?aba=resumo&sec=secFinanceiro'], ['cliente:custos', 'Custos', '/cliente?aba=configurar&sec=secCustosUpload'], ['cliente:nf', 'Nota fiscal', '/cliente?aba=configurar&sec=secNotaFiscal'], ['cliente:relatorios', 'Ciclos do negócio', '/cliente?aba=relatorios']]],
    ['Estrutura', [['estrutura', 'Estruturas', '/estrutura'], ['integracoes', 'Conexões', '/integracoes'], ['distribuicao:comunicacao', 'Comunicação', '/planos?sec=secAvisosAuto'], ['cliente:configurar', 'Configurar cliente', '/cliente?aba=configurar'], ['estrutura:equipe', 'Equipe', '/estrutura?sec=secEquipe'], ['algoritmo:param', 'Regras do método', '/metodologia?sec=secParam']]],
  ]
  const CLI = new Set(['/cliente', '/promocoes'])                      // rotas que carregam ?cliente=
  const pag = document.body.dataset.pagina
  const itens = G.flatMap(([grupo, abas]) => abas.map(([id, rotulo, href]) => ({ id, rotulo, href, grupo, pagina: id.split(':')[0], params: [...new URL(href, location.origin).searchParams].filter(([k]) => k !== 'cliente') })))
  const grupoDe = nome => G.find(g => g[0] === nome)
  // item ativo: data-pagina bate E todos os parâmetros do href (menos cliente) estão na URL; empate → mais parâmetros casados → primeiro de G.
  // Sem casamento completo (ex.: /cliente sem ?aba=), o 1º item da página. Nenhum parâmetro de menu na URL.
  const ativo = () => {
    const sp = new URLSearchParams(location.search), cand = itens.filter(i => i.pagina === pag)
    const pontos = i => (i.params.every(([k, v]) => sp.get(k) === v) ? i.params.length : -1)
    return cand.reduce((m, i) => (pontos(i) > (m ? pontos(m) : -1) ? i : m), null) || cand[0] || null
  }
  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos); return e }
  const attr = (e, o) => { for (const k in o) e.setAttribute(k, o[k]); return e }
  const link = (i, props = {}) => { const a = el('a', { href: i.href, textContent: i.rotulo, ...props }); a.dataset.base = i.href; a.dataset.item = i.id; return a }
  const linkGrupo = ([nome, abas]) => { const a = el('a', { href: abas[0][2], textContent: nome }); a.dataset.base = abas[0][2]; a.dataset.grupo = nome; return a }

  // favicon: o /logo (svg quadrado) serve de ícone da aba e evita o 404 de /favicon.ico em toda carga
  if (!document.querySelector('link[rel~="icon"]')) document.head.append(el('link', { rel: 'icon', href: '/logo', type: 'image/svg+xml' }))

  // marca (wordmark Place2u em SVG, texto claro para o fundo navy), grupos, utilitários
  const img = el('img', { className: 'logo', src: '/assets/marca-shell.svg', alt: 'Place2u', width: 82, height: 24 }); img.onerror = () => img.remove()
  const marca = el('a', { className: 'ps-marca', href: '/' }, img, el('span', { textContent: 'Sprints' }))
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
  // Quem sou (F2): papel + nome lembrados em localStorage.ps_quem; o nome também vai a ps_perfil_por (o que as telas já liam) — só preenche «Seu nome»,
  // nunca dá permissão: o cargo continua validado no servidor (config/equipe.json). No lugar do antigo utilitário «Integrações»; Hoje chega na F5.
  const PAPEIS = [['dono', 'Dono'], ['lider', 'Líder'], ['consultor', 'Consultor'], ['analista', 'Analista'], ['cs', 'CS'], ['tecnico', 'Técnico']]
  const lerQuem = () => { let q = {}; try { q = JSON.parse(localStorage.getItem('ps_quem') || '{}') || {} } catch { q = {} } let nome = String(q.nome || ''); if (!nome) try { nome = localStorage.getItem('ps_perfil_por') || '' } catch { /* sem armazenamento */ } return { papel: PAPEIS.some(p => p[0] === q.papel) ? q.papel : '', nome: nome.trim().slice(0, 80) } }
  const gravarQuem = q => { try { localStorage.setItem('ps_quem', JSON.stringify(q)); if (q.nome) localStorage.setItem('ps_perfil_por', q.nome) } catch { /* sem armazenamento: só não lembra */ } }
  // Hoje (F5): botão único no lugar do antigo utilitário «Integrações» → /fila?por=<papel>&quem=<nome> de «Quem sou»; sem papel a fila mostra o Líder (mesa de exceções)
  const hrefHoje = () => { const q = lerQuem(), u = new URLSearchParams(); if (q.papel) u.set('por', q.papel); if (q.nome) u.set('quem', q.nome); const s = u.toString(); return '/fila' + (s ? '?' + s : '') }
  const hoje = el('a', { className: 'ps-hoje', href: hrefHoje(), textContent: 'Hoje' })
  if (pag === 'fila') hoje.setAttribute('aria-current', 'page')
  const selPapel = el('select', { id: 'psQuemPapel', name: 'papel' }, el('option', { value: '', textContent: 'Escolha o papel' }), ...PAPEIS.map(([v, t]) => el('option', { value: v, textContent: t })))
  const inpNome = el('input', { id: 'psQuemNome', name: 'nome', type: 'text', maxLength: 80, autocomplete: 'name', placeholder: 'Nome e sobrenome' })
  const quemNome = el('span', { className: 'ps-quem-nome' }), quemPapel = el('span', { className: 'ps-quem-papel' })
  const quemResumo = attr(el('summary', { className: 'ps-quem-botao' }, quemNome, quemPapel), { 'aria-label': 'Quem sou: papel e nome usados como «Seu nome»' })
  const pintarQuem = () => { const q = lerQuem(); selPapel.value = q.papel; inpNome.value = q.nome; quemNome.textContent = q.nome || 'Quem sou'; quemPapel.textContent = q.papel ? ' · ' + PAPEIS.find(p => p[0] === q.papel)[1] : ''; hoje.href = hrefHoje() }
  const quemPainel = el('div', { className: 'ps-quem-painel' }, el('label', { htmlFor: 'psQuemPapel', textContent: 'Papel' }, selPapel), el('label', { htmlFor: 'psQuemNome', textContent: 'Nome (vira o padrão de «Seu nome»)' }, inpNome), el('span', { className: 'mudo', textContent: 'Lembrado neste navegador. Quem pode aprovar, liberar ou enviar continua sendo decidido pelo servidor.' }))
  const quem = el('details', { className: 'ps-quem' }, quemResumo, quemPainel)
  for (const c of [selPapel, inpNome]) c.addEventListener('change', () => { gravarQuem({ papel: selPapel.value, nome: inpNome.value.trim().slice(0, 80) }); pintarQuem() })
  pintarQuem()
  // Produto (Performance × Prime, docs/desenho-place-prime.md § A): lembrado em localStorage.ps_produto; só acrescenta ?f=<produto> nos links das
  // telas cujo painel de filtro já lê ?f= E tem o campo produto (FP: rota → painel). Nenhuma API; recorta o que se vê, nunca o que o algoritmo vê.
  const FP = { '/': 'execucao', '/resultados': 'resultados' }
  const PRODUTOS = [['', 'Todos'], ['performance', 'Performance'], ['prime', 'Prime']]
  const lerProduto = () => { let v = ''; try { v = localStorage.getItem('ps_produto') || '' } catch { /* sem armazenamento */ } return PRODUTOS.some(p => p[0] === v) ? v : '' }
  const b64url = t => btoa(unescape(encodeURIComponent(t))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')   // = filtros.js (serializar {p,a,t})
  const fProduto = (painel, p) => b64url(JSON.stringify({ p: painel, a: { op: 'E', itens: [{ campo: 'produto', operador: 'igual', valor: p }] }, t: null }))
  const selProduto = attr(el('select', { id: 'psProduto', name: 'produto', className: 'ps-produto' }, ...PRODUTOS.map(([v, t]) => el('option', { value: v, textContent: t }))), { 'aria-label': 'Produto: Todos, Performance ou Prime (vale para os links do Painel executivo e de O que funciona)' })
  selProduto.value = lerProduto()
  selProduto.addEventListener('change', () => { try { localStorage.setItem('ps_produto', selProduto.value) } catch { /* sem armazenamento: só não lembra */ } sync() })
  const lista = attr(el('nav', { className: 'ps-menu-lista' }), { 'aria-label': 'Todas as páginas' })
  for (const [nome, abas] of G) lista.append(el('p', { className: 'ps-menu-grupo', textContent: nome }), ...abas.map(a => link(itens.find(i => i.id === a[0]))))
  const menu = el('details', { className: 'ps-menu' }, el('summary', { className: 'ps-menu-botao', textContent: 'Menu' }), lista)
  const pular = el('a', { className: 'ps-pular', href: '#', textContent: 'Pular para o conteúdo' })
  pular.onclick = e => { const m = document.querySelector('main'); if (m) { e.preventDefault(); m.tabIndex = -1; m.focus() } }
  topo.append(pular, el('div', { className: 'ps-barra' }, marca, grupos, el('div', { className: 'ps-util' }, hoje, quem, busca, slot, menu)))
  topo.querySelector('.ps-util').prepend(selProduto)   // produto antes de Hoje

  // linha 2: submenus do menu ativo + contexto do cliente; reconstruída quando o item ativo muda de menu (ex.: ?aba=produtos → Empresa do cliente)
  const ctx = el('span', { className: 'ps-ctx' })
  const abasIn = el('div', { className: 'ps-abas-in' })
  const abas = attr(el('nav', { className: 'ps-abas', hidden: true }, abasIn), { 'aria-label': 'Submenu' })
  topo.after(abas)

  // ?cliente= é lido da URL ATUAL sempre que ela muda (cliente.js e promocoes.js usam pushState); new URL preserva &aba=&sec= do href
  const sync = () => {
    // último cliente aberto fica lembrado (ponytail: localStorage só como conveniência; sem ele os menus pedem o cliente de novo)
    const cUrl = new URLSearchParams(location.search).get('cliente')
    if (cUrl) { try { localStorage.setItem('ps_cliente', cUrl) } catch {} }
    let c = cUrl; if (!c) { try { c = localStorage.getItem('ps_cliente') || '' } catch { c = '' } }
    const at = ativo()
    if (abasIn.dataset.grupo !== (at?.grupo || '')) {
      abasIn.dataset.grupo = at?.grupo || ''
      abasIn.replaceChildren(...(at ? grupoDe(at.grupo)[1].map(a => link(itens.find(i => i.id === a[0]))) : []), ctx)
      abas.hidden = !at; abas.setAttribute('aria-label', 'Páginas de ' + (at?.grupo || ''))
    }
    for (const a of document.querySelectorAll('.ps-shell a[data-base], .ps-abas a[data-base]')) {
      const h = new URL(a.dataset.base, location.origin)
      if (CLI.has(h.pathname)) { if (c) h.searchParams.set('cliente', c); else h.searchParams.delete('cliente'); a.href = h.pathname + h.search }
      if (FP[h.pathname]) { const p = lerProduto(); if (p) h.searchParams.set('f', fProduto(FP[h.pathname], p)); a.href = h.pathname + h.search }
      const cur = a.dataset.item ? (a.dataset.item === at?.id ? 'page' : '') : a.dataset.grupo === at?.grupo ? (grupoDe(at.grupo)[1][0][0] === at.id ? 'page' : 'true') : ''
      if (cur) a.setAttribute('aria-current', cur); else a.removeAttribute('aria-current')
    }
    ctx.textContent = at && cUrl && CLI.has(new URL(at.href, location.origin).pathname) ? 'Cliente: ' + c : ''
  }
  for (const m of ['pushState', 'replaceState']) { const f = history[m]; history[m] = function (...a) { const r = f.apply(this, a); sync(); return r } }
  addEventListener('popstate', sync); sync()

  // sino: move o nó do alerta.js assim que ele entra no body (microtarefa, antes da pintura; os listeners vão junto)
  const moverSino = () => { const s = document.getElementById('psSino'); if (s) { slot.append(s); s.querySelector('button.sino')?.setAttribute('aria-label', 'Avisos do sistema') } return !!s }
  if (!moverSino()) { const mo = new MutationObserver(() => { if (moverSino()) mo.disconnect() }); mo.observe(document.body, { childList: true }) }

  // menus: clique fora ou Esc fecha qualquer details aberto (vale para os menus de todas as telas)
  const fechar = alvo => document.querySelectorAll('details.menu[open], details.ps-menu[open], details.ps-busca[open], details.ps-quem[open]').forEach(d => { if (!alvo || !d.contains(alvo)) d.open = false })
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
  for (const n of [topo, abas]) for (const ev of ['mouseenter', 'focus']) n.addEventListener(ev, e => { const a = e.target.closest?.('a[href]'); if (a) prefetch(a) }, true)

  window.PS = {
    // quem está usando: { papel, nome } de «Quem sou» (localStorage.ps_quem; nome cai para ps_perfil_por). Valor padrão de «Seu nome» nas telas; permissão é do servidor
    quem: lerQuem,
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
    const sp = new URLSearchParams(location.search), b = sp.get('busca'), q = document.getElementById('q')
    if (pag === 'cliente' && b && q) { q.value = b; q.dispatchEvent(new Event('input')); q.focus() }   // reusa a busca do cliente.js
    // ?sec=<id> em página estática: abre o details (e os de fora) e rola até o bloco. No /cliente quem faz isso é desenhar(), depois de mostrarAba
    const sec = sp.get('sec'), alvo = pag !== 'cliente' && sec ? document.getElementById(sec) : null
    if (alvo) { for (let d = alvo.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; alvo.scrollIntoView({ block: 'start' }) }
  })
})()
