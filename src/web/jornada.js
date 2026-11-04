// Jornada do cliente (/jornada; 04/11/2026): passos por etapa com estado lido do dado real (GET /api/jornada?cliente=), quem alimenta, o que destrava e o botão
// que leva ao campo onde o dado já se preenche (nenhuma rota de escrita nasce aqui). Sem cliente: busca (mesma /api/clientes/busca do /cliente) + carteira
// (progresso.js). 0 primário fixo: o único .btn-primario é o botão do próximo passo pendente. Valor nunca colorido; sem emoji; sem hex. Tudo do servidor passa por esc().
(() => {
  const $ = id => document.getElementById(id)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async url => { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || `erro ${r.status}`); return j }
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
  const ROT = { feito: 'feito', pendente: 'pendente', atrasado: 'atrasado', desligado: 'desligado', aguardando: 'aguardando', nao_se_aplica: 'não se aplica', atual: 'atual' }
  const SELO = { feito: 'bom', pendente: 'neutro', atrasado: 'ruim', desligado: 'neutro', aguardando: 'azul', nao_se_aplica: 'neutro', atual: 'azul' }
  const st = { cliente: new URLSearchParams(location.search).get('cliente') || '', dados: null, etapa: 0 }

  const ligarAjuda = el => { for (const b of el.querySelectorAll('[data-ajuda-id]')) b.dataset.ajuda = b.dataset.ajudaId }

  function etapaLi(e) {
    return `<li class="${esc(e.estado)}${e.atual ? ' atual' : ''}${e.n === st.etapa ? ' sel' : ''}" data-n="${e.n}">
      <button type="button" data-etapa="${e.n}"><span class="j-et-nome">${esc(e.nome)}</span><small>${e.feitos} de ${e.total} passo(s)${e.atraso_txt ? ' · ' + esc(e.atraso_txt) : ''}</small></button>
    </li>`
  }
  function passoHtml(p, primario) {
    const botao = p.ir ? `<a class="${primario ? 'btn btn-primario' : 'btn btn-p'}" href="${esc(p.ir)}">${esc(p.acao || 'Abrir')}</a>` : ''
    return `<li class="j-passo ${esc(p.estado)}" data-id="${esc(p.id)}">
      <div class="j-p-estado"><span class="selo ${SELO[p.estado] || 'neutro'}">${esc(ROT[p.estado] || p.estado)}</span></div>
      <div class="j-p-corpo">
        <b>${esc(p.nome)}</b>
        <div class="j-p-num">${esc(p.numero || '—')}${p.motivo ? ` <span class="mini">· ${esc(p.motivo)}</span>` : ''}</div>
        <div class="mini">Quem alimenta: <b>${esc(p.quem_rotulo)}</b> · Destrava: ${esc(p.destrava)}</div>
      </div>
      <div class="j-p-acao">${p.estado === 'feito' || p.estado === 'nao_se_aplica' ? (p.ir ? `<a class="btn btn-p btn-fantasma" href="${esc(p.ir)}">Ver</a>` : '') : botao}</div>
    </li>`
  }
  function painel(e) {
    const prox = st.dados?.proximo
    const lista = e.passos.map(p => passoHtml(p, false)).join('')   // único primário da tela = o do cartão «Próximo passo»
    return `<div class="j-painel-cab"><h3>${e.n}. ${esc(e.nome)}</h3><span class="selo ${SELO[e.estado] || 'neutro'}">${esc(ROT[e.estado] || e.estado)}</span><span class="mini">${esc(e.numero || '')}</span>
      ${e.ajuda ? `<button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: ${esc(e.nome)}" data-ajuda-id="${esc(e.ajuda)}"></button>` : ''}</div>
      <ul class="j-passos">${lista || '<li class="mini">Nenhum passo declarado para esta etapa.</li>'}</ul>`
  }
  function desenhar() {
    const d = st.dados; if (!d) return
    const R = d.resumo, prox = d.proximo
    $('jTitulo').textContent = `Jornada · ${d.cliente}`
    $('veredito').innerHTML = `<b>${R.feitos} de ${R.total}</b> passos feitos · <b>${R.pendentes}</b> pendente${R.pendentes === 1 ? '' : 's'}${R.atrasados ? ` (<b>${R.atrasados}</b> atrasado${R.atrasados === 1 ? '' : 's'})` : ''}${R.desligados ? ` · ${R.desligados} por chave desligada` : ''}${R.aguardando ? ` · ${R.aguardando} aguardando` : ''}`
    const atual = d.etapas.find(e => e.atual) || d.etapas.find(e => e.estado !== 'feito') || d.etapas.at(-1)
    $('kpis').innerHTML = kp('Etapa atual', atual ? atual.n : '—', atual ? esc(atual.nome) : '') + kp('Passos feitos', R.feitos, `de ${R.total}`) + kp('Pedem ação', R.pendentes, R.atrasados ? `${R.atrasados} atrasado(s)` : 'nenhum atrasado') + kp('Aguardando', R.aguardando + R.desligados, R.desligados ? `${R.desligados} por chave desligada` : 'carência ou janela')
    $('kpis').removeAttribute('aria-busy')
    const c = $('cartaoEstado'); c.hidden = false
    if (!prox) { c.className = 'cartao j-estado ok'; $('estadoTitulo').textContent = 'Tudo em dia'; $('estadoTexto').textContent = 'Nenhum passo pede ação agora.'; $('estadoAcao').innerHTML = '' }
    else { c.className = 'cartao j-estado ' + (prox.estado === 'atrasado' ? 'ruim' : 'atencao'); $('estadoTitulo').textContent = `Próximo passo: ${prox.nome}`; $('estadoTexto').textContent = `Etapa ${prox.etapa} · quem alimenta: ${prox.quem_rotulo} · ${prox.numero}${prox.motivo ? ' · ' + prox.motivo : ''}`; $('estadoAcao').innerHTML = prox.ir ? `<a class="btn btn-primario" href="${esc(prox.ir)}">${esc(prox.acao || 'Abrir')}</a>` : '' }
    if (!st.etapa) st.etapa = prox ? prox.etapa : (atual ? atual.n : 1)
    $('secJornada').hidden = false
    $('jEtapas').innerHTML = d.etapas.map(etapaLi).join('')
    const e = d.etapas.find(x => x.n === st.etapa) || d.etapas[0]
    $('jPainel').innerHTML = painel(e); ligarAjuda($('jPainel'))
    for (const b of $('jEtapas').querySelectorAll('[data-etapa]')) b.onclick = () => { st.etapa = Number(b.dataset.etapa); desenhar() }
    $('jLido').textContent = `lido às ${hora(new Date().toISOString())}`
  }
  async function carregar() {
    if (!st.cliente) { $('jLido').textContent = 'sem cliente'; $('kpis').innerHTML = kp('Etapa atual', '—', 'escolha um cliente') + kp('Passos feitos', '—', '') + kp('Pedem ação', '—', '') + kp('Aguardando', '—', ''); $('kpis').removeAttribute('aria-busy'); return }
    $('kpis').setAttribute('aria-busy', 'true')
    try { st.dados = await api('/api/jornada?cliente=' + encodeURIComponent(st.cliente)); desenhar() }
    catch (e) { $('veredito').textContent = `Não foi possível ler a jornada (${e.message}).`; $('kpis').removeAttribute('aria-busy') }
  }
  // busca (mesma rota do /cliente): escolher = recarregar com ?cliente=
  let seq = 0
  async function buscar() {
    const q = $('q').value.trim(), box = $('resultados')
    if (q.replace(/\D/g, '').length < 3 && q.length < 3) { box.hidden = true; box.innerHTML = ''; return }
    const meu = ++seq
    try {
      const { resultados } = await api('/api/clientes/busca?q=' + encodeURIComponent(q))
      if (meu !== seq) return
      box.hidden = false
      box.innerHTML = resultados.length ? resultados.map(c => `<button class="res-item" type="button" data-c="${esc(c.cliente)}"><span><b>${esc(c.cliente)}</b> <span class="sub">${esc([c.consultor || 'consultor a definir', ...(c.canais || [])].join(' · '))}</span></span></button>`).join('') : '<div class="mini">Nenhum cliente com esse nome.</div>'
      for (const b of box.querySelectorAll('[data-c]')) b.onclick = () => { location.href = '/jornada?cliente=' + encodeURIComponent(b.dataset.c) }
    } catch (e) { box.hidden = false; box.innerHTML = `<div class="mini">Busca indisponível (${esc(e.message)}).</div>` }
  }
  $('q').addEventListener('input', buscar); $('btnBuscar').onclick = buscar
  $('q').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); buscar() } })
  $('btnJAtualizar').onclick = carregar
  // carteira: o stepper agregado + tabela; os links de cliente passam a abrir a jornada
  const cart = $('progressoCarteira')
  const prom = window.PSProgresso?.montar ? window.PSProgresso.montar(cart, { escopo: { tipo: 'total' } }) : Promise.resolve()
  Promise.resolve(prom).finally(() => { for (const a of cart.querySelectorAll('a[href^="/cliente?cliente="]')) { const u = new URL(a.getAttribute('href'), location.origin); if (!u.searchParams.get('aba')) a.setAttribute('href', '/jornada?cliente=' + encodeURIComponent(u.searchParams.get('cliente') || '')) } })
  carregar()
})()
