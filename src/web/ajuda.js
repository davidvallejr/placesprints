// /ajuda.js · ícone (i) «Como fazer» das estruturas (docs/ux/arquitetura-5-menus.md § C; F2, 21/10/2026). Compartilhado pelas 11 telas.
// Delegação de click em [data-ajuda] no document (o botão fica depois do selo .sis ou dentro do <summary>: preventDefault + stopPropagation
// para não abrir/fechar o details). GET /api/ajuda/:id?cliente= e dialog.dlg em DOM puro (createElement/textContent, nunca HTML em string).
// Fica fora do shell.js porque o shell não chama API (spec § 4.1). Estado «sem leitura» até a F3: o texto diz onde a chave mora.
(() => {
  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos); return e }
  const clienteDaUrl = () => new URLSearchParams(location.search).get('cliente') || ''
  const ESTADO = { sem_leitura: 'sem leitura', ligado: 'ligado', desligado: 'desligado', pronto: 'pronto (configurado, não ligado)', pendente: 'pendente', erro: 'erro' }
  const PONTO = { ok: 's-ok', pendente: 's-pend', erro: 's-erro' }
  const linha = (rotulo, texto) => texto ? el('p', { className: 'ajuda-linha' }, el('b', { textContent: rotulo + ': ' }), document.createTextNode(texto)) : null

  function corpo(v) {
    const cab = el('div', { className: 'bloco-cab' }, el('h2', { textContent: 'Como fazer: ' + v.titulo }))
    const sis = el('span', { className: 'sis', textContent: v.sistema_nome }); sis.dataset.sistema = v.sistema; sis.title = 'Sistema de origem: ' + v.sistema_nome
    cab.append(sis, el('small', { className: 'sis-papel', textContent: '· ' + v.sistema_papel }), el('span', { className: 'mudo peq', textContent: v.escopo }))
    const e = v.estado || {}
    const estado = el('div', { className: 'aviso info ajuda-estado' }, el('b', { textContent: 'Estado agora: ' + (ESTADO[e.estado] || e.estado || '—') }))
    for (const n of [linha('chave', e.chave), linha('camada', e.camada), linha('desde', e.desde), linha('por quem', e.por), linha('motivo', e.motivo_chave), linha('leitura', e.motivo)]) if (n) estado.append(n)
    const pre = el('ul', { className: 'ajuda-pre' }, ...(v.pre_requisitos || []).map(p => {
      const li = el('li', {}, el('i', { className: 'ponto ' + (PONTO[p.estado] || 's-neutro'), title: ESTADO[p.estado] || p.estado || '' }), document.createTextNode(' ' + p.texto))
      if (p.estado && ESTADO[p.estado]) li.append(el('small', { className: 'mudo', textContent: ' — ' + ESTADO[p.estado] }))
      return li
    }))
    const passos = el('ol', { className: 'passos-ajuda' }, ...(v.passos || []).map(p => el('li', {}, el('b', { textContent: p.titulo }), el('small', { textContent: ' ' + p.texto + (p.quem ? ' (' + p.quem + ')' : '') }))))
    const fim = el('div', { className: 'aviso ok' }, el('b', { textContent: 'Concluído quando: ' }), document.createTextNode(v.concluido_quando || '—'))
    const rodape = el('p', { className: 'ajuda-rodape mudo peq' })
    if (v.onde) rodape.append(el('a', { href: v.onde, textContent: 'Onde configurar' }), document.createTextNode(' · '))
    rodape.append(document.createTextNode('Documento: ' + (v.doc || '—') + (v.doc_secao ? ' ' + v.doc_secao : '')))
    if (v.processo) rodape.append(document.createTextNode(' · '), el('a', { href: '/processos?busca=' + encodeURIComponent(v.processo), textContent: 'Processo completo' }))
    return [cab, estado, el('h3', { textContent: 'Pré-requisitos' }), pre, el('h3', { textContent: 'Passo a passo' }), passos, fim, rodape]
  }

  let aberto = null
  async function abrir(id, { cliente = clienteDaUrl() } = {}) {
    if (aberto) aberto.close()
    const d = el('dialog', { className: 'dlg dlg-ajuda' }); aberto = d
    const miolo = el('div', { className: 'ajuda-miolo' }, el('p', { className: 'mudo', textContent: 'Carregando…' }))
    const fechar = el('button', { className: 'ps-btn', type: 'button', textContent: 'Fechar' }); fechar.addEventListener('click', () => d.close())
    d.append(miolo, el('div', { className: 'dlg-rodape' }, fechar))
    d.addEventListener('close', () => { d.remove(); if (aberto === d) aberto = null })
    document.body.append(d); d.showModal()
    try {
      const r = await fetch('/api/ajuda/' + encodeURIComponent(id) + (cliente ? '?cliente=' + encodeURIComponent(cliente) : ''), { headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error(r.status === 404 ? 'Este (i) ainda não tem texto em config/ajuda.json.' : 'Não foi possível carregar a ajuda agora.')
      miolo.replaceChildren(...corpo(await r.json()))
    } catch (e) {
      miolo.replaceChildren(el('div', { className: 'aviso erro' }, el('b', { textContent: 'Ajuda indisponível. ' }), document.createTextNode(e.message || '')))
    }
    fechar.focus()
  }

  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-ajuda]'); if (!b) return
    e.preventDefault(); e.stopPropagation()   // dentro de <summary>: não abre/fecha o details
    abrir(b.dataset.ajuda)
  })
  window.PSAjuda = { abrir }
})()
