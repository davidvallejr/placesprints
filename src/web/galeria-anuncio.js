// Galeria do anúncio na tela do cliente (Anúncios no período, Folha do anúncio e Cronologia de preços): miniatura maior e nítida e, AO PASSAR O MOUSE
// (sem clique, ~200 ms para não disparar ao rolar), um painel flutuante com a capa grande e as próximas fotos (até 7), todas de uma vez.
// Fotos de GET /api/cliente/anuncio/fotos (só leitura), buscadas no 1º hover daquele anúncio e guardadas por cliente+item enquanto a página vive.
// Delegação no document: as tabelas têm até 500 linhas e nenhuma ganha listener próprio. Teclado: a miniatura é focável (abre no foco, fecha no
// blur/Escape; Enter alterna); toque: tocar abre/fecha. Fecha ao sair da miniatura E do painel (150 ms para atravessar), Escape e rolagem.
// Usa esc (cliente.js) e imgAnuncio (acomp.js) só em tempo de chamada. Carregado antes de cliente.js; expõe window.PSGaleria.
(() => {
  const ITEM = /^MLB\d+$/
  const CDN = /^(https:\/\/http2\.mlstatic\.com\/D_(?:NQ_NP_)?\d+-ML[A-Z]\d+_\d+)-[A-Z]\.(jpg|webp)$/
  const URL_OK = /^https:\/\/http2\.mlstatic\.com\//
  // -N = 200×200 do CDN do ML (medido em 14/10/2026): nítida na miniatura de 76 px até tela 2,5×; a -I (90 px) esticada fica borrada no retina.
  // Sempre .webp: o CDN serve -N.webp também para foto de origem .jpg, com 1/2 a 1/2,5 do peso do -N.jpg (88% dos thumbs são .jpg)
  const nitida = u => String(u || '').replace(CDN, '$1-N.webp')
  const ABRIR_MS = 200, ATRAVESSAR_MS = 150
  const cache = new Map()                                                        // cliente|item → Promise da resposta; falha sai para tentar de novo
  let painel = null, alvo = null, tAbrir = 0, tFechar = 0, porTeclado = false, toque = false, focoEm = 0

  const miniatura = (thumb, titulo, item) => ITEM.test(String(item || ''))
    ? `<span class="an-galeria" data-galeria="${esc(item)}" tabindex="0" role="button" aria-label="Ver as fotos do anúncio ${esc(item)}" aria-expanded="false">${imgAnuncio(nitida(thumb), titulo, 'an-thumb')}</span>`
    : imgAnuncio(nitida(thumb), titulo, 'an-thumb')
  const clienteAtual = () => document.getElementById('telaCliente')?.dataset.cliente || ''
  const naGaleria = n => n?.closest?.('[data-galeria]') || null
  const noPainel = n => !!(painel && n instanceof Node && painel.contains(n))
  const dm = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }
  const ESQUELETO = '<div class="gl-capa sk-linha"></div><div class="gl-grade">' + '<div class="sk-linha"></div>'.repeat(4) + '</div><p class="gl-rodape">Carregando fotos…</p>'
  const msg = t => `<p class="gl-msg">${t}</p>`

  function posicionar() {                                                        // fixed, nunca sai da janela: vira para a esquerda/cima perto das bordas
    if (!painel || painel.hidden || !alvo) return
    if (!alvo.isConnected) { fechar(); return }                                   // a tabela foi redesenhada sob o painel
    painel.style.maxHeight = ''
    const r = alvo.getBoundingClientRect(), w = painel.offsetWidth, m = 8
    const W = document.documentElement.clientWidth, H = document.documentElement.clientHeight
    let x = r.right + m, y = r.top, h = painel.offsetHeight
    if (x + w > W - m) x = r.left - m - w
    if (x < m) {                                                                  // nenhum lado cabe (celular): abaixo ou acima, nunca por cima da miniatura
      const baixo = H - r.bottom - 2 * m, cima = r.top - 2 * m                    // (cobrir a miniatura impede o 2º toque de fechar)
      if (h > baixo && h > cima) { painel.style.maxHeight = Math.max(baixo, cima) + 'px'; h = painel.offsetHeight }   // o .gl-painel rola por dentro
      y = h <= baixo ? r.bottom + m : r.top - m - h
    }
    x = Math.max(m, Math.min(x, W - m - w)); y = Math.max(m, Math.min(y, H - m - h))
    Object.assign(painel.style, { left: x + 'px', top: y + 'px' })
  }
  function desenhar(r) {
    const fotos = (r.fotos || []).filter(f => URL_OK.test(f.url))               // a rota já monta só http2.mlstatic.com; aqui é a 2ª trava
    if (!fotos.length) { painel.innerHTML = msg('Sem foto registrada para este anúncio.'); return }
    const total = Math.max(Number(r.total) || 0, fotos.length)
    const rodape = r.fonte === 'capa'
      ? `${total > 1 ? `${total} fotos no anúncio · ` : ''}demais fotos indisponíveis agora`
      : `${total} foto${total === 1 ? '' : 's'}${total > fotos.length ? ` (${fotos.length} aqui)` : ''}${dm(r.lido_em) ? ` · fotos lidas em ${dm(r.lido_em)}` : ''}`
    painel.innerHTML = `<img class="gl-capa" src="${esc(fotos[0].url)}" alt="Capa do anúncio" referrerpolicy="no-referrer">
      ${fotos.length > 1 ? `<div class="gl-grade">${fotos.map((f, i) => `<img src="${esc(f.url)}" alt="Foto ${i + 1}" data-gl-foto loading="lazy" referrerpolicy="no-referrer"${i ? '' : ' class="on"'}>`).join('')}</div>` : ''}
      <p class="gl-rodape">${esc(rodape)}</p>`
  }
  async function abrir(el) {
    clearTimeout(tAbrir); clearTimeout(tFechar)
    if (!painel) {
      painel = Object.assign(document.createElement('div'), { id: 'psGaleria', className: 'gl-painel', hidden: true })
      painel.setAttribute('role', 'group'); painel.setAttribute('aria-label', 'Fotos do anúncio')
      document.body.append(painel)
    }
    if (alvo === el && !painel.hidden) return
    alvo?.setAttribute('aria-expanded', 'false')
    alvo = el; el.setAttribute('aria-expanded', 'true'); porTeclado = false          // quem abriu pelo teclado marca de novo logo depois
    const cliente = clienteAtual(), item = el.dataset.galeria, k = cliente + '|' + item
    if (!cache.has(k)) cache.set(k, fetch(`/api/cliente/anuncio/fotos?cliente=${encodeURIComponent(cliente)}&item=${encodeURIComponent(item)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('fotos ' + r.status)))
      .then(j => { if (j.fonte === 'capa') cache.delete(k); return j })           // só a capa (ML fora): o próximo hover pede de novo (o servidor guarda 5 min)
      .catch(e => { cache.delete(k); throw e }))
    const p = cache.get(k)
    painel.innerHTML = ESQUELETO; painel.hidden = false; posicionar()
    try { const r = await p; if (alvo === el) { desenhar(r); posicionar() } }
    catch { if (alvo === el) { painel.innerHTML = msg('Não foi possível carregar as fotos agora.'); posicionar() } }
  }
  function fechar() {
    clearTimeout(tAbrir); clearTimeout(tFechar)
    if (painel) painel.hidden = true
    alvo?.setAttribute('aria-expanded', 'false'); alvo = null; porTeclado = false
  }
  function trocar(f) {                                                           // foto pequena sob o mouse vai para o lugar da capa (sem clique)
    const capa = painel.querySelector('.gl-capa'); if (!capa || f.classList.contains('on')) return
    capa.src = f.src; capa.alt = f.alt
    painel.querySelector('[data-gl-foto].on')?.classList.remove('on'); f.classList.add('on')
  }

  document.addEventListener('pointerover', e => {
    const f = noPainel(e.target) && e.target.closest('[data-gl-foto]')
    if (f) trocar(f)
    if (e.pointerType === 'touch') return                                       // no toque quem abre é o clique (alterna)
    const t = naGaleria(e.target)
    if (alvo && !alvo.isConnected && !t && !noPainel(e.target)) fechar()          // a miniatura sob o mouse foi trocada (esqueleto/redesenho): sem pointerout
    if (t || noPainel(e.target)) clearTimeout(tFechar)
    if (t && t !== alvo) { clearTimeout(tAbrir); tAbrir = setTimeout(() => abrir(t), ABRIR_MS) }
  })
  document.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch') return
    const de = naGaleria(e.target) || (noPainel(e.target) ? painel : null), para = e.relatedTarget
    if (!de || (para instanceof Node && de.contains(para))) return
    clearTimeout(tAbrir)                                                         // saiu antes dos 200 ms: não abre
    if (!alvo || porTeclado || naGaleria(para) === alvo || noPainel(para)) return   // atravessando miniatura ↔ painel
    clearTimeout(tFechar); tFechar = setTimeout(fechar, ATRAVESSAR_MS)
  })
  document.addEventListener('pointerdown', e => { toque = e.pointerType !== 'mouse' }, { capture: true })
  document.addEventListener('click', e => {
    const t = naGaleria(e.target)
    if (t) { toque && t === alvo && !painel.hidden ? fechar() : abrir(t); return }
    if (alvo && !noPainel(e.target)) fechar()                                    // toque/clique fora fecha
  })
  document.addEventListener('focusin', e => {                                    // só foco de teclado: o clique do mouse já abriu pelo hover
    const t = naGaleria(e.target)
    if (t && t.matches(':focus-visible')) { abrir(t); porTeclado = true; focoEm = Date.now() }
  })
  document.addEventListener('focusout', e => { if (alvo && naGaleria(e.target) === alvo && porTeclado && !noPainel(e.relatedTarget)) fechar() })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && alvo) { fechar(); return }
    const t = naGaleria(e.target)
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (t === alvo) fechar(); else { abrir(t); porTeclado = true } }
  })
  // rolagem fecha; só a que o foco de teclado provoca (o navegador traz a miniatura para a vista, logo após o focusin) reposiciona
  document.addEventListener('scroll', e => {
    if (noPainel(e.target)) return
    clearTimeout(tAbrir)                                                         // a miniatura que passou sob o mouse durante a rolagem não abre
    if (alvo) porTeclado && document.activeElement === alvo && Date.now() - focoEm < 500 ? posicionar() : fechar()
  }, { capture: true, passive: true })
  addEventListener('resize', () => { if (alvo) fechar() })

  window.PSGaleria = { miniatura, nitida, fechar }
})()
