// Seção «Financeiro (Smith)» do /cliente › Resumo — Agente Smith G0 (só leitura). Projeção de GET /api/cliente/guardiao: cartão de estado do custo, o raio-X em seções com a
// MESMA tabela de 6 colunas (Item · Métrica · Previsão · Chance · Medido · Observação), «—» sempre com o motivo, botão secundário «Decisão do cliente» em cada mudança de preço
// (prévia → nome do líder/consultor → confirmar; a medição não muda) e «Gerar pauta da reunião» secundário (a tela já tem o primário «Revisar plano»): abre a pauta em HTML, com PDF e texto.
// window.PSGuardiao.montar(alvo, cliente). Valor sem cor; tudo do servidor passa por esc(); sem emoji.
(() => {
  if (window.PSGuardiao) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || `erro ${r.status}`); return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const celH = c => `${esc(c?.txt ?? '—')}${c?.v == null && c?.motivo ? `<div class="mini" title="${esc(c.motivo)}">${esc(String(c.motivo).slice(0, 110))}${String(c.motivo).length > 110 ? '…' : ''}</div>` : ''}`
  const proximaTerca = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); do d.setDate(d.getDate() + 1); while (d.getDay() !== 2); return d.toISOString().slice(0, 10) }
  const ABERTAS = new Set(['custos', 'precos', 'promessas'])

  async function montar(alvo, cliente) {
    if (!alvo) return
    let rx
    try { rx = await api('/api/cliente/guardiao?cliente=' + encodeURIComponent(cliente)) } catch (e) { alvo.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return }
    const f = rx.fatos || {}
    const estado = f.tem_custo ? 'Há custo informado: a margem só vale onde o custo cobre a receita.' : `Sem custo${f.sem_custo_dias != null ? ` há ${f.sem_custo_dias} dias` : ''}: sem margem, sem lucro e sem teto de Ads. Recomendação padrão: pausar novos aumentos de preço por 14 dias até ter o custo.`
    const linhaH = l => `<tr><td data-rotulo="Item"><div>${esc(String(l.item).slice(0, 90))}</div></td><td data-rotulo="Métrica"><div>${esc(l.metrica)}</div></td>
      <td class="num" data-rotulo="Previsão"><div>${celH(l.previsao)}</div></td><td data-rotulo="Chance"><div>${celH(l.chance)}</div></td>
      <td class="num" data-rotulo="Medido"><div>${celH(l.medido)}</div></td><td data-rotulo="Observação"><div class="mini">${esc(l.nota)}</div>${l.ref && l.decisor !== 'cliente'
        ? `<button class="btn-mini" type="button" data-gd-ref="${esc(l.ref)}" data-gd-dec="cliente">Decisão do cliente</button>` : l.ref && l.decisor_fonte === 'marcado' ? `<button class="btn-mini" type="button" data-gd-ref="${esc(l.ref)}" data-gd-dec="assessoria">Voltar para assessoria</button>` : ''}</td></tr>`
    alvo.innerHTML = `<div class="aviso ${f.tem_custo ? 'info' : 'atencao'}" id="gdEstado">${esc(estado)}</div>
      <div class="mt-2" id="gdPauta"><label class="mini" for="gdData">Reunião em</label> <input type="date" id="gdData" value="${proximaTerca()}"> <input type="time" id="gdHora" value="16:00" aria-label="Hora da reunião">
        <button class="btn btn-p" type="button" id="btnGerarPauta">Gerar pauta da reunião</button> <span id="gdPautaLinks"></span></div>
      ${rx.secoes.map(s => `<details class="recolhido mt-2" ${ABERTAS.has(s.chave) ? 'open' : ''}><summary>${esc(s.titulo)} <span class="n">${s.linhas.length}</span></summary>
        <div class="tabela-wrap"><table class="t empilha" id="gdTab-${esc(s.chave)}"><thead><tr>${rx.colunas.map((c, j) => `<th${j === 2 || j === 4 ? ' class="num"' : ''}>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${s.linhas.map(linhaH).join('')}</tbody></table></div></details>`).join('')}
      ${rx.faltando.length ? `<div class="aviso info mt-2" id="gdFaltando"><b>Falta para ficar completo:</b> ${esc(rx.faltando.join('; '))}</div>` : ''}
      <p class="mini mt-2">${esc(rx.rodape)}</p>`
    alvo.querySelector('#btnGerarPauta').onclick = async () => {
      const q = `?cliente=${encodeURIComponent(cliente)}&data=${encodeURIComponent(alvo.querySelector('#gdData').value)}&hora=${encodeURIComponent(alvo.querySelector('#gdHora').value || '16:00')}`
      const links = alvo.querySelector('#gdPautaLinks')
      try {
        const r = await api('/api/cliente/guardiao/pauta' + q)
        if (!r.auditoria.ok) { links.innerHTML = `<span class="mudo">A pauta não passou no auditor de texto (${esc(r.auditoria.codigos.join(', '))}).</span>`; return }
        links.innerHTML = `<a class="btn btn-fantasma btn-p" href="/api/cliente/guardiao/pauta.html${q}" target="_blank" rel="noopener">Abrir pauta</a> <a class="btn btn-fantasma btn-p" href="/api/cliente/guardiao/pauta.pdf${q}">PDF</a> <a class="btn btn-fantasma btn-p" href="/api/cliente/guardiao/pauta.txt${q}" download>Texto</a>`
        window.open('/api/cliente/guardiao/pauta.html' + q, '_blank', 'noopener')
      } catch (e) { toast(e.message, 'erro') }
    }
    alvo.querySelectorAll('[data-gd-ref]').forEach(b => { b.onclick = async () => {
      const ref = b.dataset.gdRef, decisor = b.dataset.gdDec
      try {
        const por = window.PSRelatorio?.ui ? await PSRelatorio.ui.pedirPor({ titulo: decisor === 'cliente' ? 'Marcar como decisão do cliente' : 'Voltar para decisão da assessoria', texto: 'Muda só quem decidiu o preço; a medição do efeito continua a mesma. Fica no livro de registro.', rotuloOk: 'Ver prévia' }) : null
        if (!por) return
        const pv = await api('/api/cliente/preco/decisao', { cliente, ref, decisor, por })
        const sim = window.PS?.confirmar ? await PS.confirmar({ titulo: 'Confirmar a marcação', texto: `${pv.produto} (${pv.dia}): de «${pv.antes.decisor}» para «${pv.depois.decisor}». ${pv.nota}`, rotuloOk: 'Confirmar' }) : true
        if (!sim) return
        await api('/api/cliente/preco/decisao', { cliente, ref, decisor, por, confirmar: true })
        toast('Marcado. A medição não mudou.'); montar(alvo, cliente)
      } catch (e) { toast(e.message, 'erro') }
    } })
  }
  window.PSGuardiao = { montar }
})()
