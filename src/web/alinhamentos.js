// Alinhamentos com o cliente (exceções intencionais, PLANO ATIVO 4 — pontos do Adriano): o que foi combinado com o cliente e por isso não vira ação, aviso nem cobrança.
// window.PSAlinhamentos.montar(alvo, cliente) (Resumo › Alinhado com o cliente) e .descartar({ ids }) → Promise<{ alteradas } | null> (diálogo de DESCARTE em /cliente e /planos:
// descartar exige motivo da lista e vira alinhamento, revisão padrão +30 dias, permanente só para descontinuado).
// O servidor decide tudo (src/lib/alinhamentos.js, predicado único): esta tela só mostra e pede. Tudo que vem do servidor passa por esc(); o único primário mora DENTRO do diálogo
// (botões do PSRelatorio.ui); sem cor nova, sem emoji; o motivo livre é interno e o cliente só lê o texto fixo do tipo.
(() => {
  if (window.PSAlinhamentos) return

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brData = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const ui = () => window.PSRelatorio?.ui || null
  const diaMais = n => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const erroBloco = (alvo, e, denovo) => { alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`; alvo.querySelector('[data-denovo]').onclick = denovo }
  const ORIGEM = { painel: 'registrado no painel', descarte: 'descarte de ação', s90_cliente: 'marcado pelo cliente (Sprint 90)', notion: 'Notion' }
  // campos comuns do diálogo: motivo da lista, motivo livre (interno), revisar em, permanente (só onde o tipo permite)
  const camposMotivo = (p, tipos, padrao, max) => `
    <div class="campo"><label for="${p}Tipo">Motivo (da lista)</label><select id="${p}Tipo"><option value="">Escolha o motivo</option>${tipos.map(t => `<option value="${esc(t.id)}">${esc(t.rotulo)}</option>`).join('')}</select></div>
    <div class="campo"><label for="${p}Motivo">Detalhe interno (opcional, até 200 caracteres; o cliente nunca lê)</label><textarea id="${p}Motivo" maxlength="200" rows="2" placeholder="ex.: pausado por falta de produção do fornecedor"></textarea></div>
    <div class="linha"><div class="campo"><label for="${p}Revisar">Revisar em</label><input type="date" id="${p}Revisar" value="${esc(diaMais(padrao))}" min="${esc(diaMais(1))}" max="${esc(diaMais(max))}"></div>
    <label class="rl-opcao" id="${p}PermCaixa" hidden><input type="checkbox" id="${p}Permanente"> <span>Permanente (produto descontinuado: não volta para revisão)</span></label></div>`
  const ligarPermanente = (corpo, p, tipos) => {
    const sel = corpo.querySelector(`#${p}Tipo`), caixa = corpo.querySelector(`#${p}PermCaixa`), chk = corpo.querySelector(`#${p}Permanente`), data = corpo.querySelector(`#${p}Revisar`)
    const sync = () => { const t = tipos.find(x => x.id === sel.value); caixa.hidden = !t?.permanente; if (caixa.hidden) chk.checked = false; data.disabled = chk.checked }
    sel.addEventListener('change', sync); chk.addEventListener('change', sync); sync()
  }
  const lerMotivo = (corpo, p) => {
    const permanente = corpo.querySelector(`#${p}Permanente`).checked
    return { motivo_tipo: corpo.querySelector(`#${p}Tipo`).value, motivo: corpo.querySelector(`#${p}Motivo`).value.trim(), permanente, ...(permanente ? {} : { revisar_em: corpo.querySelector(`#${p}Revisar`).value }) }
  }

  // ── DESCARTE: motivo obrigatório da lista → POST /api/planos/acoes/status (o servidor grava um alinhamento por ação, origem 'descarte') ─────────────
  let tiposCache = null
  function descartar({ ids } = {}) {
    return new Promise(async resolver => {
      const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); resolver(null); return }
      if (!Array.isArray(ids) || !ids.length) { resolver(null); return }
      try { tiposCache ||= await api('/api/alinhamentos/tipos') } catch (e) { toast(e.message, 'erro'); resolver(null); return }
      const T = tiposCache, n = ids.length
      const { d, corpo, rodape, fechar } = U.dialogo(n === 1 ? 'Descartar ação' : `Descartar ${n} ações`)
      corpo.innerHTML = `<p>Descartar exige o motivo. Ele vira um <b>alinhamento com o cliente</b>: a ação não volta ao plano, não vira aviso nem cobrança até a data de revisão. Reabrir a ação encerra o alinhamento.${n > 1 ? ' O mesmo motivo vale para todas as marcadas.' : ''}</p>
        ${camposMotivo('ds', T.tipos, T.revisao_dias_padrao, T.revisao_dias_max)}${U.campoPor('dsPor')}<div id="dsSaida"></div>`
      ligarPermanente(corpo, 'ds', T.tipos)
      const saida = corpo.querySelector('#dsSaida')
      let feito = null
      rodape.append(U.botao('Cancelar', { aoClicar: fechar }), U.botao(n === 1 ? 'Descartar' : `Descartar ${n}`, { primario: true, aoClicar: async e => {
        const m = lerMotivo(corpo, 'ds'), por = U.lerPor(corpo, 'dsPor')
        if (!m.motivo_tipo) { saida.innerHTML = U.aviso('erro', 'Escolha o motivo da lista.'); return }
        if (!por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
        U.gravarNome(por); e.currentTarget.disabled = true
        try { feito = await api('/api/planos/acoes/status', { ids, status: 'descartada', por, ...m }); toast(`${feito.alteradas} ação(ões) descartada(s); o motivo ficou registrado como alinhamento.`); fechar() }
        catch (x) { saida.innerHTML = U.aviso('erro', esc(x.message)); e.currentTarget.disabled = false }
      } }))
      d.addEventListener('close', () => resolver(feito), { once: true })
    })
  }

  // ── registrar alinhamento pelo painel: prévia → Registrar (origem 'painel') ─────────────────────────────────────────────────────────────
  function registrar(r, { aoConcluir } = {}) {
    const U = ui(); if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(`Registrar alinhamento · ${r.cliente}`)
    corpo.innerHTML = `<p>Use quando algo foi combinado com o cliente: anúncio pausado de propósito, campanha de visibilidade com ACOS alto aceito, anúncio de atração, produto descontinuado queimando estoque, ou um ponto que o consultor já conversou com o seller. O sistema deixa de recomendar, avisar e cobrar o que ficou coberto até a revisão.</p>
      <div class="linha"><div class="campo"><label for="alEscopo">Onde vale</label><select id="alEscopo"><option value="anuncio">Um anúncio</option><option value="conta">A conta inteira, para uma regra</option></select></div>
      <div class="campo" id="alAnuncioCaixa"><label for="alAnuncio">Anúncio</label><select id="alAnuncio"><option value="">${r.anuncios.length ? 'Escolha o anúncio' : 'Sem anúncios coletados deste cliente'}</option>${r.anuncios.map(a => `<option value="${esc(a.id)}">${esc(a.id)} · ${esc(String(a.titulo || '').slice(0, 70))}</option>`).join('')}</select></div></div>
      <div class="campo"><label for="alRegra">Regra coberta</label><select id="alRegra"><option value="">Padrão do motivo (o que ele cobre no anúncio)</option>${r.regras.map(g => `<option value="${esc(g.id)}">${esc(g.rotulo)}</option>`).join('')}</select><span class="ajuda-campo" id="alRegraAjuda">No anúncio, o padrão do motivo basta; na conta inteira, escolha a regra.</span></div>
      ${camposMotivo('al', r.tipos, r.revisao_dias_padrao, r.revisao_dias_max)}
      <div class="campo" id="alAcosCaixa" hidden><label for="alAcos">ACOS alvo aceito (%)</label><input type="number" id="alAcos" min="1" max="300" step="0.1" placeholder="ex.: 30"><span class="ajuda-campo">As regras de Ads por ACOS passam a usar este alvo no lugar da meta da conta.</span></div>
      ${U.campoPor('alPor')}<div id="alSaida"></div>`
    ligarPermanente(corpo, 'al', r.tipos)
    const q = id => corpo.querySelector('#' + id), saida = q('alSaida')
    const syncEscopo = () => { q('alAnuncioCaixa').hidden = q('alEscopo').value !== 'anuncio'; q('alRegra').options[0].disabled = q('alEscopo').value === 'conta' }
    const syncAcos = () => { q('alAcosCaixa').hidden = !r.tipos.find(t => t.id === q('alTipo').value)?.acos; if (q('alAcosCaixa').hidden) q('alAcos').value = '' }
    q('alEscopo').addEventListener('change', syncEscopo); q('alTipo').addEventListener('change', syncAcos); syncEscopo(); syncAcos()
    const dados = () => {
      const m = lerMotivo(corpo, 'al'), escopo = q('alEscopo').value, regra = q('alRegra').value
      return { cliente: r.cliente, escopo, chave: escopo === 'anuncio' ? q('alAnuncio').value : '', regras: regra ? [regra] : [], tipo: m.motivo_tipo, motivo: m.motivo, permanente: m.permanente,
        ...(m.revisar_em ? { revisar_em: m.revisar_em } : {}), ...(q('alAcos').value ? { acos_alvo: Number(q('alAcos').value) } : {}), por: U.lerPor(corpo, 'alPor') }
    }
    const previaBt = U.botao('Ver prévia', { aoClicar: async () => {
      const b = dados()
      if (b.escopo === 'anuncio' && !b.chave) { saida.innerHTML = U.aviso('erro', 'Escolha o anúncio.'); return }
      if (b.escopo === 'conta' && !b.regras.length) { saida.innerHTML = U.aviso('erro', 'Na conta inteira, escolha a regra coberta.'); return }
      if (!b.tipo) { saida.innerHTML = U.aviso('erro', 'Escolha o motivo da lista.'); return }
      if (!b.por) { saida.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(b.por); previaBt.disabled = true
      let v
      try { v = await api('/api/cliente/alinhamentos', b) } catch (e) { saida.innerHTML = U.aviso('erro', esc(e.message)); previaBt.disabled = false; return }
      const a = v.alinhamento || {}
      saida.innerHTML = `<div class="aviso info"><b>${esc(a.rotulo)}</b> · ${a.escopo === 'anuncio' ? `anúncio ${esc(a.chave)}` : 'conta inteira'} · ${a.permanente ? 'permanente' : `revisar em ${esc(brData(a.revisar_em))}`}<div class="mini">O cliente lê só: ${esc(a.texto_cliente)}</div></div>`
      previaBt.remove()
      rodape.append(U.botao('Registrar', { primario: true, aoClicar: async e => {
        e.currentTarget.disabled = true
        try { await api('/api/cliente/alinhamentos', { ...b, confirmar: true }); toast('Alinhamento registrado.'); fechar(); aoConcluir?.() }
        catch (x) { saida.insertAdjacentHTML('beforeend', U.aviso('erro', esc(x.message))); e.currentTarget.disabled = false }
      } }))
    } })
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), previaBt)
  }

  // ── Resumo › Alinhado com o cliente: lista viva, vencidos em atenção, renovar/encerrar, registrar novo ─────────────────────────────────────
  async function montar(alvo, cliente) {
    if (!alvo) return
    let r
    try { r = await api('/api/cliente/alinhamentos?cliente=' + encodeURIComponent(cliente)) } catch (e) { erroBloco(alvo, e, () => montar(alvo, cliente)); return }
    const lista = r.alinhamentos || [], vencidos = lista.filter(a => a.estado === 'vencido'), vivos = lista.filter(a => a.estado === 'vivo')
    const titulo = new Map((r.anuncios || []).map(a => [a.id, a.titulo]))
    const onde = a => a.escopo === 'anuncio' ? `Anúncio ${esc(a.chave)}${titulo.get(a.chave) ? `<div class="mini">${esc(String(titulo.get(a.chave)).slice(0, 60))}</div>` : ''}` : a.escopo === 'conta' ? 'Conta inteira' : `${esc(a.escopo)} ${esc(a.chave)}`
    const linha = a => `<tr>
      <td><b>${esc(a.rotulo)}</b>${a.acos_alvo != null ? `<div class="mini">ACOS alvo ${esc(String(a.acos_alvo).replace('.', ','))}%</div>` : ''}<div class="mini">${esc(a.texto_cliente)}</div></td>
      <td>${onde(a)}${a.regras?.length ? `<div class="mini">regras: ${esc(a.regras.join(', '))}</div>` : ''}</td>
      <td>${a.motivo ? esc(a.motivo) : '<span class="mudo">—</span>'}<div class="mini">${esc(ORIGEM[a.origem] || a.origem)}${a.por ? ` · ${esc(a.por)}` : ''}</div></td>
      <td>${esc(brData(a.desde))}</td>
      <td>${a.permanente ? 'permanente' : esc(brData(a.revisar_em))}${a.estado === 'vencido' ? ' <span class="selo atencao">revisar</span>' : ''}</td>
      <td><button class="btn-mini" type="button" data-al-renovar="${esc(a.id)}">Renovar</button> <button class="btn-mini no" type="button" data-al-encerrar="${esc(a.id)}">Encerrar</button></td></tr>`
    alvo.innerHTML = `
      <p class="veredito-frase" id="alVeredito">${lista.length ? `<b>${esc(String(vivos.length))}</b> alinhamento(s) valendo${vencidos.length ? ` · <b>${esc(String(vencidos.length))}</b> vencido(s) para revisar: a regra volta ao plano como "observar"` : ''}` : '<b>Nada alinhado</b> com este cliente: tudo o que o sistema enxerga pode virar ação, aviso e cobrança'}</p>
      ${vencidos.length ? `<div class="aviso amb">Vencido(s) na data de revisão: renove se o combinado continua, ou encerre para a recomendação voltar normal.</div>` : ''}
      <div class="tabela-wrap mt-2"><table class="t empilha" id="alTabela"><caption class="sr">Alinhamentos com o cliente ${esc(cliente)}</caption><thead><tr><th scope="col">Motivo</th><th scope="col">Onde</th><th scope="col">Detalhe interno</th><th scope="col">Desde</th><th scope="col">Revisar em</th><th scope="col">Ações</th></tr></thead><tbody>${lista.length
        ? [...vencidos, ...vivos].map(linha).join('')
        : '<tr><td colspan="6" class="vazio"><b>Nenhum alinhamento.</b> Registre quando algo for combinado com o cliente; descartar uma ação do plano também registra, com o motivo escolhido.</td></tr>'}</tbody></table></div>
      <div class="mt-2"><button class="btn" type="button" id="btnAlRegistrar">Registrar alinhamento</button></div>`
    const recarregar = () => montar(alvo, cliente)
    alvo.querySelector('#btnAlRegistrar').onclick = () => registrar(r, { aoConcluir: recarregar })
    const pedirPor = (titulo, texto) => ui() ? ui().pedirPor({ titulo, texto, rotuloOk: titulo }) : (toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'), Promise.resolve(null))
    alvo.querySelectorAll('[data-al-renovar]').forEach(b => b.onclick = async () => {
      const por = await pedirPor('Renovar alinhamento', `O combinado continua: nova revisão em ${r.revisao_dias_padrao} dias (descontinuado permanente continua permanente).`); if (!por) return
      try { const x = await api('/api/cliente/alinhamentos/renovar', { cliente, id: Number(b.dataset.alRenovar), por }); toast(x.revisar_em ? `Renovado: revisar em ${brData(x.revisar_em)}.` : 'Renovado.'); recarregar() } catch (e) { toast(e.message, 'erro') }
    })
    alvo.querySelectorAll('[data-al-encerrar]').forEach(b => b.onclick = async () => {
      const por = await pedirPor('Encerrar alinhamento', 'A recomendação, o aviso e a cobrança voltam a valer na próxima geração do plano.'); if (!por) return
      try { await api('/api/cliente/alinhamentos/encerrar', { cliente, id: Number(b.dataset.alEncerrar), por }); toast('Alinhamento encerrado.'); recarregar() } catch (e) { toast(e.message, 'erro') }
    })
  }

  window.PSAlinhamentos = { montar, descartar, registrar }
})()
