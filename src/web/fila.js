// Hoje (/fila; docs/ux/arquitetura-5-menus.md § B, F5 21/10/2026): a fila do dia de quem está usando — papel e nome de «Quem sou» (ou ?por=&quem=), até 5 blocos,
// só exceções, 1 botão por item (SÓ rotas de escrita que já existem; sem rota = link «Abrir»), 4 números fixos no topo e o stepper da carteira (progresso.js).
// O ÚNICO .btn-primario da tela é o botão do 1º item. Valor de KPI nunca colorido; sem emoji; sem hex. Tudo que vem do servidor passa por esc().
(() => {
  const $ = id => document.getElementById(id)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const pedirPor = o => window.PSRelatorio?.ui ? window.PSRelatorio.ui.pedirPor(o) : (toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'), Promise.resolve(null))
  const confirmar = o => window.PS?.confirmar ? PS.confirmar(o) : Promise.resolve(confirm(o.texto || o.titulo))
  const hora = iso => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
  const pct = v => v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
  const PAPEIS = ['dono', 'lider', 'consultor', 'analista', 'cs', 'tecnico']

  const st = { dados: null, itens: new Map() }
  // papel e nome: ?por=&quem= na URL vencem; senão «Quem sou» (PS.quem); senão líder (a mesa de exceções)
  const quemSou = () => { try { return window.PS?.quem?.() || {} } catch { return {} } }
  const estado = () => { const u = new URLSearchParams(location.search), q = quemSou(); const por = u.get('por') || q.papel || 'lider'; return { por: PAPEIS.includes(por) ? por : 'lider', quem: (u.get('quem') ?? q.nome ?? '').trim().slice(0, 80), etapa: u.get('etapa') || '' } }
  const gravarUrl = ({ por, quem, etapa }) => { const u = new URL(location.href); u.searchParams.set('por', por); if (quem) u.searchParams.set('quem', quem); else u.searchParams.delete('quem'); if (etapa) u.searchParams.set('etapa', etapa); else u.searchParams.delete('etapa'); history.replaceState(null, '', u.pathname + u.search) }

  const linkCliente = c => c ? `<a href="/cliente?cliente=${encodeURIComponent(c)}">${esc(c)}</a>` : '<span class="mini">sistema</span>'
  function itemHtml(it, k) {
    st.itens.set(k, it)
    const acao = it.botao
      ? `<button class="${it.primario ? 'btn btn-primario' : 'btn btn-p'}" type="button" data-acao="${k}">${esc(it.botao.rotulo)}</button>`
      : it.link ? `<a class="${it.primario ? 'btn btn-primario' : 'btn btn-p btn-fantasma'}" href="${esc(it.link.href)}">${esc(it.link.rotulo)}</a>` : '—'
    return `<li class="fila-item${it.gravidade ? ' ' + esc(it.gravidade) : ''}" data-id="${esc(it.id)}">
      <div class="fi-cliente" data-rotulo="Cliente">${linkCliente(it.cliente)}</div>
      <div class="fi-oque" data-rotulo="O que fazer">${esc(it.o_que)}</div>
      <div class="fi-prazo" data-rotulo="Prazo">${esc(it.prazo || '—')}</div>
      <div class="fi-numero" data-rotulo="Fecha quando">${esc(it.numero || '—')}</div>
      <div class="fi-acao" data-rotulo="Ação">${acao}</div>
    </li>`
  }
  function blocoHtml(b, i) {
    const limiar = b.limiar_errado.map(l => `<p class="aviso">${esc(l.aviso)} · família «${esc(l.familia)}» <a href="${esc(l.ajuste)}">Regras do método</a></p>`).join('')
    const corpo = b.itens.length ? `<ol class="fila-lista">${b.itens.map((it, j) => itemHtml(it, `${i}:${j}`)).join('')}</ol>`
      : b.motivo ? `<p class="mini">${esc(b.motivo)}</p>` : b.limiar_errado.length ? '' : '<div class="vazio-box"><b>Nada aqui agora.</b>Nenhuma exceção neste bloco.</div>'
    return `<section class="bloco" data-bloco="${esc(b.id)}">
      <div class="bloco-cab"><h2>${esc(b.titulo)} <span class="badge">${b.total}</span></h2><small class="sis-papel">${esc(b.sistemas)}</small></div>
      <p class="sub">${esc(b.sub)}${b.nota ? ' · ' + esc(b.nota) : ''}</p>
      ${limiar}${corpo}
    </section>`
  }

  function desenhar() {
    const d = st.dados; if (!d) return
    const N = d.numeros, blocos = d.blocos
    const comItem = blocos.filter(b => b.total).length
    $('veredito').innerHTML = `<b>${d.total_itens}</b> ${d.total_itens === 1 ? 'item' : 'itens'} em <b>${comItem}</b> de ${blocos.length} blocos para <b>${esc(d.rotulo)}</b>${d.quem ? ' · ' + esc(d.quem) : ''}${d.escopo != null ? ` · ${d.escopo} ${d.escopo === 1 ? 'cliente' : 'clientes'} no recorte` : ' · carteira inteira'}${d.escopo_motivo ? ` · ${esc(d.escopo_motivo)}` : ''}.`
    $('kpis').innerHTML = kp('Autonomia', pct(N.autonomia.valor), N.autonomia.valor == null ? esc(N.autonomia.motivo) : `${N.autonomia.n} ordens do Chaveiro de ${N.autonomia.de} ações encerradas em 28 d`)
      + kp('Cobertura PS-', pct(N.cobertura.valor), N.cobertura.valor == null ? esc(N.cobertura.motivo) : `${N.cobertura.cards} cards PS- de ${N.cobertura.tarefas} tarefas do Notion`)
      + kp('Exceções ÷ teto', `${N.excecoes.valor} ÷ ${N.excecoes.teto}`, `${N.excecoes.familias} ${N.excecoes.familias === 1 ? 'família' : 'famílias'} × ${N.excecoes.por_familia} por semana`)
      + kp('Contas por pessoa', N.contas_por_pessoa.valor == null ? '—' : N.contas_por_pessoa.valor.toLocaleString('pt-BR'), N.contas_por_pessoa.valor == null ? esc(N.contas_por_pessoa.motivo) : `${N.contas_por_pessoa.clientes} clientes elegíveis ÷ ${N.contas_por_pessoa.pessoas} consultores`)
    $('kpis').removeAttribute('aria-busy')
    const sec = $('kpisSec'); sec.hidden = false; sec.innerHTML = `Teto por família <b>${N.excecoes.por_familia}</b>/semana (decisão D-C1) · acima disso o bloco diz «limiar errado» · ajuste em <a href="/metodologia?sec=secParam">Estrutura › Regras do método</a>`
    const et = $('filaEtapa'); et.hidden = !d.etapa; et.innerHTML = d.etapa ? `Mostrando só o que fecha a etapa <b>${d.etapa}</b> do stepper. <a href="#" data-limpar-etapa>Ver a fila inteira</a>` : ''
    st.itens.clear()
    const alvo = $('blocos'); alvo.innerHTML = blocos.map(blocoHtml).join(''); alvo.removeAttribute('aria-busy')
    $('filaLido').textContent = `lido às ${hora(d.lido_em)}`
    $('filaEscopo').textContent = d.escopo != null ? `${d.escopo} ${d.escopo === 1 ? 'cliente' : 'clientes'} no recorte de ${d.rotulo}` : `${d.rotulo}: carteira inteira`
  }

  async function agir(it, b) {
    const bt = it.botao; if (!bt) return
    const corpo = { ...bt.corpo }
    if (bt.por) { const por = await pedirPor({ titulo: bt.rotulo + (it.cliente ? ': ' + it.cliente : ''), texto: bt.confirmar || it.o_que, rotuloOk: bt.rotulo }); if (!por) return; corpo.por = por }
    else if (bt.confirmar && !(await confirmar({ titulo: bt.rotulo + (it.cliente ? ': ' + it.cliente : ''), texto: bt.confirmar, rotuloOk: bt.rotulo }))) return
    b.disabled = true; b.setAttribute('aria-busy', 'true')
    try {
      const r = await api(bt.rota, corpo)
      if (bt.copiar === 'url' && r.url) { await navigator.clipboard.writeText(r.url).catch(() => { throw new Error('O navegador não deixou copiar: use «Conexões» para baixar o link.') }); toast(`Link de conexão de ${it.cliente} copiado (válido ${r.validade_dias || 60} dias).`); return }
      if (bt.copiar === 'texto') { if (r.ok === false) { toast(r.motivo || 'Lembrete não preparado.', 'erro'); return } await navigator.clipboard.writeText(r.texto || '').catch(() => {}); toast(`Lembrete preparado e copiado. ${r.como_enviar || ''}`); return }
      if (bt.mostrar === 'previa') { toast(`Prévia: ${(r.liberados || []).length} a liberar · ${(r.sem_grupo_ml || []).length} sem grupo · ${(r.sem_integracao || []).length} sem integração. A liberação real é feita em Estrutura › Comunicação.`); return }
      if (r.job) { toast(`Distribuição iniciada (${r.acoes} ${r.acoes === 1 ? 'ação' : 'ações'}). Acompanhe em Execução › Distribuir.`); carregar(); return }
      toast(r.nota || r.mensagem || `${bt.rotulo}: feito.`); carregar()
    } catch (e) { toast(e.message, 'erro') } finally { b.disabled = false; b.removeAttribute('aria-busy') }
  }

  async function carregar() {
    const e = estado(); gravarUrl(e)
    $('filaPor').value = e.por; $('filaQuem').value = e.quem
    window.PSProgresso?.montar($('progressoCarteira'), { escopo: e.por === 'consultor' && e.quem ? { tipo: 'consultor', consultor: e.quem } : { tipo: 'total' } })
    const u = new URLSearchParams({ por: e.por }); if (e.quem) u.set('quem', e.quem); if (e.etapa) u.set('etapa', e.etapa)
    try { st.dados = await api('/api/fila?' + u.toString()); desenhar() } catch (err) {
      $('blocos').innerHTML = `<section class="bloco"><div class="erro-bloco"><b>Não foi possível carregar a fila</b><div>${esc(err.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div></section>`
      $('blocos').querySelector('[data-denovo]').onclick = carregar
      $('veredito').textContent = 'Não foi possível ler a fila agora.'; $('kpis').removeAttribute('aria-busy')
    }
  }

  const trocar = () => { const u = new URL(location.href); u.searchParams.set('por', $('filaPor').value); const n = $('filaQuem').value.trim().slice(0, 80); if (n) u.searchParams.set('quem', n); else u.searchParams.delete('quem'); history.replaceState(null, '', u.pathname + u.search); carregar() }
  $('filaPor').addEventListener('change', trocar)
  $('filaQuem').addEventListener('change', trocar)
  $('btnFilaAtualizar').onclick = carregar
  document.addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]'); if (b) { const it = st.itens.get(b.dataset.acao); if (it) agir(it, b); return }
    const l = ev.target.closest('[data-limpar-etapa]'); if (l) { ev.preventDefault(); const u = new URL(location.href); u.searchParams.delete('etapa'); history.replaceState(null, '', u.pathname + u.search); carregar() }
  })
  carregar()
})()
