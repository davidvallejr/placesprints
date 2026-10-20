// "Como era" do anúncio (Parte B, fase 1): lista de fotografias (data, origem, resumo), diff campo a campo por mudança e o selo do veredito do
// Merovíngio (medirMarco). window.PSHistorico.render(container, dados) e .abrir(cliente, item[, container]) — sem container abre um <dialog> nativo.
// Sem botão primário; sem Restaurar (fase 3). Tudo que vem do servidor passa por esc(). Nenhum token novo: .selo, .t, .mini, .mudo, .btn-mini de ui.css.
(() => {
  if (window.PSHistorico) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brDataHora = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)

  const ORIGEM = { coleta: 'coleta diária', ofertas: 'Ofertas', chaveiro: 'Chaveiro', restauracao: 'restauração' }
  const SELO = { piorou: 'ruim', melhorou: 'bom', sem_efeito: 'neutro', sem_controle: 'atencao', em_maturacao: 'neutro', sem_base: 'neutro' }
  const ROT = { piorou: 'Piorou', melhorou: 'Melhorou', sem_efeito: 'Sem efeito', sem_controle: 'Sem controle', em_maturacao: 'Em maturação', sem_base: 'Sem base' }
  const TIPO = { alterado: 'alterado', adicionado: 'adicionado', removido: 'removido', reordenado: 'reordenado' }
  const CAMPO = { titulo: 'Título', preco: 'Preço', status: 'Status', categoria: 'Categoria', tipo_anuncio: 'Tipo de anúncio', descricao: 'Descrição', fotos: 'Fotos' }
  const rotuloCampo = c => CAMPO[c] || (c.startsWith('atributos.') ? `Ficha · ${c.slice(10)}` : c.startsWith('variacoes.') ? `Variação ${c.slice(10).replace('.preco', ' · preço').replace('.estoque', ' · estoque').replace('.fotos', ' · fotos')}` : c.startsWith('frete.') ? `Frete · ${c.slice(6)}` : c)
  const valor = v => v == null || v === '' ? '<span class="mudo">—</span>' : esc(String(v).slice(0, 160))

  const tabelaDiff = diff => diff.length ? `<table class="t hst-diff"><thead><tr><th scope="col">Campo</th><th scope="col">Mudança</th><th scope="col">Como era</th><th scope="col">Como ficou</th></tr></thead><tbody>${diff.map(d => `<tr><td>${esc(rotuloCampo(d.campo))}</td><td>${esc(TIPO[d.tipo] || d.tipo)}</td><td>${valor(d.de)}</td><td>${valor(d.para)}</td></tr>`).join('')}</tbody></table>` : '<p class="mudo">Nenhuma diferença visível entre as duas fotografias (a descrição pode não ter sido lida numa delas).</p>'

  function render(container, dados) {
    if (!container) return
    const snaps = dados?.snapshots || [], muds = dados?.mudancas || []
    container.innerHTML = `
      <div class="hst">
        <p class="sub">Fotografias do anúncio guardadas a cada mudança (curva A/B todo dia, C a cada 7 dias). "Piorou" só aparece quando o Merovíngio mediu contra o grupo de controle; sem controle o texto diz "caiu depois da mudança (sem controle)". <span class="mini">Restaurar chega na fase 3.</span></p>
        ${snaps.length ? `<table class="t hst-lista"><thead><tr><th scope="col">Quando</th><th scope="col">Origem</th><th scope="col">Como era</th></tr></thead><tbody>${snaps.map(s => `<tr><td>${esc(brDataHora(s.capturado_em))}</td><td>${esc(ORIGEM[s.origem] || s.origem)}</td><td>${esc(s.resumo || '')}${s.sem_descricao ? ' <span class="selo neutro">descrição não lida</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="mudo">Nenhuma fotografia ainda. A primeira é tirada na próxima coleta ou agora, pelo botão abaixo.</p>'}
        ${muds.length ? `<h3 class="mt-2">O que mudou e o que aconteceu depois</h3>${muds.map(m => `
          <details class="hst-mud"><summary><b>${esc(brDataHora(m.de.capturado_em))} → ${esc(brDataHora(m.para.capturado_em))}</b> <span class="selo ${SELO[m.veredito] || 'neutro'}">${esc(ROT[m.veredito] || m.veredito)}</span> <span class="mini">${esc(m.diff.length)} diferença(s)</span></summary>
            <p class="mini">${esc(m.texto)}${m.medida?.confundido_preco || m.medida?.confundido_estado ? ' · a medida está confundida (preço ou estado do anúncio mudaram na janela)' : ''}</p>
            ${tabelaDiff(m.diff)}
          </details>`).join('')}` : ''}
        <div class="mt-2"><button class="btn-mini" type="button" id="hstCapturar">Tirar uma fotografia agora</button> <span class="mini" id="hstAviso" aria-live="polite"></span></div>
      </div>`
    const btn = container.querySelector('#hstCapturar')
    if (btn && dados?.cliente && dados?.item) btn.onclick = async () => {
      btn.disabled = true
      try {
        const r = await api('/api/cliente/anuncio/snapshot', { cliente: dados.cliente, item: dados.item })
        container.querySelector('#hstAviso').textContent = !r.ok ? `Não consegui ler o anúncio: ${r.motivo || ''}` : r.gravou ? `Fotografia guardada${r.sem_descricao ? ' (descrição não lida)' : ''}.` : 'Nada mudou desde a última fotografia.'
        if (r.gravou) await abrir(dados.cliente, dados.item, container)
      } catch (e) { toast(e.message, 'erro') } finally { btn.disabled = false }
    }
  }

  async function abrir(cliente, item, container) {
    if (!container) {
      let dlg = document.getElementById('hstDialog')
      if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'hstDialog'; dlg.className = 'hst-dialog'; dlg.innerHTML = '<form method="dialog" class="hst-cab"><h2 id="hstTitulo">Como era</h2><button class="btn-mini" type="submit">Fechar</button></form><div id="hstCorpo"></div>'; document.body.append(dlg) }
      dlg.querySelector('#hstTitulo').textContent = `Como era · ${item}`
      container = dlg.querySelector('#hstCorpo')
      if (!dlg.open) dlg.showModal()
    }
    container.innerHTML = '<p class="mudo">Carregando as fotografias…</p>'
    try { render(container, await api(`/api/cliente/anuncio/historico?cliente=${encodeURIComponent(cliente)}&item=${encodeURIComponent(item)}`)) }
    catch (e) { container.innerHTML = `<p class="mudo">${esc(e.message)}</p>` }
  }

  const css = document.createElement('style')
  css.textContent = `
  .hst .hst-diff td:nth-child(3),.hst .hst-diff td:nth-child(4){max-width:28ch;overflow-wrap:anywhere;font-size:var(--t-12)}
  .hst-mud{margin:var(--e-2) 0}.hst-mud summary{cursor:pointer}
  .hst-dialog{max-width:min(960px,96vw);width:100%;border:0;border-radius:var(--raio-pilula,8px);padding:var(--e-4,16px)}
  .hst-dialog::backdrop{background:rgba(0,0,0,.35)}
  .hst-cab{display:flex;align-items:center;justify-content:space-between;gap:var(--e-2);margin:0 0 var(--e-3)}
  `
  document.head.append(css)
  window.PSHistorico = { render, abrir }
})()
