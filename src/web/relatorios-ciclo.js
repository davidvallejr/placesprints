// Aba Relatórios do /cliente — V3 F9: os 8 relatórios (Morpheus entrega; Previsão do Oráculo · Chance só calibrada · Medido do Merovíngio/fato). Projeção de
// GET /api/cliente/relatorios/<nome>: seletor dos 8 (#rcSeletor, aria-pressed), seções empilhadas com a MESMA tabela de 6 colunas (Item · Métrica · Previsão · Chance ·
// Medido · Observação), «—» sempre com o motivo embaixo, exportação CSV / 1 página HTML / PDF por links (sem botão primário novo). Nada aqui grava nem muda o plano.
// window.PSRelatoriosCiclo.montar(alvo, cliente). Valor sem cor; tudo do servidor passa por esc(); sem emoji.
(() => {
  if (window.PSRelatoriosCiclo) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async url => { const r = await fetch(url), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || `erro ${r.status}`); return j }
  const POR_VEZ = 50
  const celH = c => `${esc(c?.txt ?? '—')}${c?.v == null && c?.motivo ? `<div class="mini" title="${esc(c.motivo)}">${esc(String(c.motivo).slice(0, 110))}${String(c.motivo).length > 110 ? '…' : ''}</div>` : ''}`
  const linhaH = l => `<tr><td data-rotulo="Item"><div>${esc(String(l.item).slice(0, 90))}</div></td><td data-rotulo="Métrica"><div>${esc(l.metrica)}</div></td>
    <td class="num" data-rotulo="Previsão"><div>${celH(l.previsao)}</div></td><td data-rotulo="Chance"><div>${celH(l.chance)}</div></td>
    <td class="num" data-rotulo="Medido"><div>${celH(l.medido)}</div></td><td data-rotulo="Observação"><div class="mini">${esc(l.nota)}</div></td></tr>`

  async function montar(alvo, cliente) {
    if (!alvo) return
    let lista
    try { lista = await api('/api/cliente/relatorios?cliente=' + encodeURIComponent(cliente)) } catch (e) { alvo.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return }
    let nome = lista.relatorios.find(r => r.nome === new URLSearchParams(location.search).get('rc'))?.nome || lista.relatorios[0].nome   // ?rc= pré-seleciona (menu Empresa do cliente › Compras)
    alvo.innerHTML = `<div class="seg" id="rcSeletor" role="group" aria-label="Relatório">${lista.relatorios.map(r => `<button type="button" data-rc="${esc(r.nome)}" aria-pressed="${r.nome === nome}">${esc(r.titulo)}</button>`).join('')}</div>
      <div class="mt-2" id="rcExportar"></div><div id="rcCorpo" class="mt-2"></div>`
    const corpo = alvo.querySelector('#rcCorpo'), exp = alvo.querySelector('#rcExportar')
    const abrir = async n => {
      nome = n
      alvo.querySelectorAll('[data-rc]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.rc === n)))
      const q = '?cliente=' + encodeURIComponent(cliente), base = `/api/cliente/relatorios/${encodeURIComponent(n)}`
      exp.innerHTML = `<a class="btn btn-fantasma btn-p" href="${base}.csv${q}" download>Exportar CSV</a> <a class="btn btn-fantasma btn-p" href="${base}.html${q}" target="_blank" rel="noopener">Versão de 1 página</a> <a class="btn btn-fantasma btn-p" href="${base}.pdf${q}">PDF</a>`
      corpo.innerHTML = '<div class="skeleton sk-tabela"></div>'
      let r
      try { r = await api(base + q) } catch (e) { corpo.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return }
      if (nome !== n) return
      if (!r.disponivel) { corpo.innerHTML = `<div class="vazio-box">${esc(r.motivo || 'sem dado')}</div>`; return }
      corpo.innerHTML = `<p class="mini">${esc(r.rodape)}${r.janela ? ` Janela de ${esc(r.janela.de)} a ${esc(r.janela.ate)} (${r.janela.dias_coleta} de ${r.janela.dias} dias com coleta).` : ''}</p>
        ${r.secoes.map((s, k) => `<section class="mt-2"><h3>${esc(s.titulo)} <span class="n">${s.linhas.length}</span></h3>
          <div class="tabela-wrap"><table class="t empilha" id="rcTab-${k}"><thead><tr>${r.colunas.map((c, j) => `<th${j === 2 || j === 4 ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${s.linhas.slice(0, POR_VEZ).map(linhaH).join('') || `<tr><td colspan="6">Nada nesta seção.</td></tr>`}</tbody></table></div>
          ${s.linhas.length > POR_VEZ ? `<button class="btn btn-p mt-2" type="button" data-rc-mais="${k}">Mostrar mais (${s.linhas.length - POR_VEZ})</button>` : ''}</section>`).join('')}
        ${r.faltando.length ? `<div class="aviso info mt-2" id="rcFaltando"><b>Falta para ficar completo:</b> ${esc(r.faltando.join('; '))}</div>` : ''}
        <details class="recolhido mt-2"><summary>Premissas</summary><ul class="mini">${r.premissas.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>`
      corpo.querySelectorAll('[data-rc-mais]').forEach(b => { let n0 = POR_VEZ; b.onclick = () => {
        const s = r.secoes[b.dataset.rcMais], tb = corpo.querySelector(`#rcTab-${b.dataset.rcMais} tbody`)
        tb.insertAdjacentHTML('beforeend', s.linhas.slice(n0, n0 + POR_VEZ).map(linhaH).join('')); n0 += POR_VEZ
        if (n0 >= s.linhas.length) b.remove(); else b.textContent = `Mostrar mais (${s.linhas.length - n0})`
      } })
    }
    alvo.querySelectorAll('[data-rc]').forEach(b => { b.onclick = () => abrir(b.dataset.rc) })
    abrir(nome)
  }
  window.PSRelatoriosCiclo = { montar }
})()
