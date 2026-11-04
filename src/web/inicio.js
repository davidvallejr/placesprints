// Sucesso do cliente (/ no modo clientes de teste; 04/11/2026): GET /api/inicio → cartão de estado da carteira, 1 cartão por cliente (receita 28 d, variação,
// etapa atual, próximo dado pedido) e a linha do tempo do que o sistema fez (livro de execução). Só leitura; o único .btn-primario é o do cartão de estado.
// Valor nunca colorido; sem emoji; sem hex. Tudo do servidor passa por esc().
(() => {
  const $ = id => document.getElementById(id)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async url => { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || `erro ${r.status}`); return j }
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const brl = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
  const pct = v => v == null ? 'sem base de comparação' : `${v > 0 ? '+' : ''}${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} % vs 28 d anteriores`
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
  const SELO = { feito: 'bom', pendente: 'neutro', atrasado: 'ruim', atual: 'azul' }
  const jornadaDe = c => '/jornada?cliente=' + encodeURIComponent(c)

  function cartaoCliente(c) {
    const p = c.proximo
    const prox = p ? `<p class="i-prox"><b>${p.quem === 'cliente' ? 'Pede ao cliente' : 'Próximo passo'}:</b> ${esc(p.nome)}<br><span class="mini">${esc(p.numero || '')}${p.motivo ? ' · ' + esc(p.motivo) : ''}</span><br><span class="mini">Destrava: ${esc(p.destrava)}</span></p>`
      : '<p class="i-prox"><b>Tudo em dia.</b> <span class="mini">Nenhum passo pede ação agora.</span></p>'
    return `<article class="cartao i-cliente" data-cliente="${esc(c.cliente)}">
      <header><h3><a href="${jornadaDe(c.cliente)}">${esc(c.cliente)}</a></h3><span class="mini">${esc(c.consultor || 'consultor a definir')}</span></header>
      <div class="i-num"><div class="valor">${brl(c.gmv)}</div><div class="mini">${c.gmv == null ? 'sem coleta do Mercado Livre' : pct(c.delta_pct)}${c.gmv != null && !c.cobertura_ok ? ' · cobertura incompleta' : ''}</div></div>
      <p class="mini">Etapa ${c.etapa.n} · ${esc(c.etapa.nome)} <span class="selo ${SELO[c.etapa.estado] || 'neutro'}">${esc(c.etapa.estado)}</span> · ${c.passos.feitos} de ${c.passos.total} passos</p>
      ${prox}
      <div class="i-acoes">${p?.ir ? `<a class="btn btn-p" href="${esc(p.ir)}">${esc(p.acao || 'Abrir')}</a>` : ''}<a class="btn btn-p btn-fantasma" href="${jornadaDe(c.cliente)}">Jornada</a></div>
    </article>`
  }
  function desenhar(d) {
    const R = d.resumo, cs = d.clientes
    $('veredito').innerHTML = `<b>${R.clientes}</b> cliente${R.clientes === 1 ? '' : 's'} · <b>${R.pedem_dado}</b> ${R.pedem_dado === 1 ? 'pede' : 'pedem'} um dado ao cliente · <b>${R.atrasados}</b> com passo atrasado · <b>${R.em_dia}</b> em dia`
    $('kpis').innerHTML = kp('Clientes', R.clientes, d.modo_teste ? 'ambiente de teste' : 'carteira') + kp('Pedem um dado', R.pedem_dado, 'custo, prazo, metas, catálogo…') + kp('Passo atrasado', R.atrasados, 'fora do prazo da etapa') + kp('Em dia', R.em_dia, 'nenhum passo pendente')
    $('kpis').removeAttribute('aria-busy')
    const alvo = cs.find(c => c.proximo), c = $('cartaoEstado'); c.hidden = false
    if (!alvo) { c.className = 'cartao i-estado ok'; $('estadoTitulo').textContent = 'Tudo em dia'; $('estadoTexto').textContent = 'Nenhum cliente pede ação agora.'; $('estadoAcao').innerHTML = '' }
    else { const p = alvo.proximo; c.className = 'cartao i-estado ' + (p.estado === 'atrasado' ? 'ruim' : 'atencao'); $('estadoTitulo').textContent = `${alvo.cliente}: ${p.nome}`; $('estadoTexto').textContent = `Quem alimenta: ${p.quem_rotulo} · ${p.numero || ''}${p.motivo ? ' · ' + p.motivo : ''} · destrava ${p.destrava}`; $('estadoAcao').innerHTML = p.ir ? `<a class="btn btn-primario" href="${esc(p.ir)}">${esc(p.acao || 'Abrir')}</a>` : '' }
    $('iClientes').innerHTML = cs.map(cartaoCliente).join('') || '<p class="mini">Nenhum cliente na central.</p>'; $('iClientes').removeAttribute('aria-busy')
    $('iHoje').innerHTML = d.hoje_sistema.map(l => `<li class="${l.ok ? '' : 'falha'}"><time datetime="${esc(l.em)}">${hora(l.em)}</time><span class="sis" data-sistema="${esc(l.sistema)}">${esc(l.sistema)}</span><span>${esc(l.texto)}</span></li>`).join('') || '<li class="mini">Nenhuma rodada registrada nas últimas 24 h.</li>'
    $('iLido').textContent = `lido às ${hora(new Date().toISOString())}`
  }
  async function carregar() {
    $('kpis').setAttribute('aria-busy', 'true')
    try { desenhar(await api('/api/inicio')) } catch (e) { $('veredito').textContent = `Não foi possível ler a carteira (${e.message}).`; $('kpis').removeAttribute('aria-busy') }
  }
  $('btnIAtualizar').onclick = carregar
  carregar()
})()
