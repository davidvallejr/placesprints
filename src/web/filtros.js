// Filtros avançados (estilo Pipedrive) — o MESMO componente em todos os painéis: condições "todas estas (E)" + "e qualquer uma destas (OU)",
// operadores por tipo de campo, período com a data filtrada explícita e comparação, chips removíveis um a um, favoritos salvos e ?f= na URL.
// window.PSFiltros.montar(el, { painel, aoAplicar(def, f), inicial, parametro = 'f' }) — DOM puro (nada do servidor vira HTML). Lê /api/filtros/definicao.
// `parametro` é o nome na URL (duas instâncias na mesma tela não se sobrescrevem: a Folha do anúncio usa 'ff' ao lado do 'f' de Anúncios no período).
(() => {
  if (window.PSFiltros) return
  const css = document.createElement('style')
  css.textContent = `
  .flt{font-size:var(--t-13);color:var(--tinta)}
  .flt-topo{display:flex;flex-wrap:wrap;gap:var(--e-2);align-items:center}
  .flt-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:var(--e-2)}
  .flt-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 10px;border:1px solid var(--borda-forte);border-radius:var(--raio-pilula);background:var(--superficie);color:var(--tinta)}
  .flt-chip.per{border-style:dashed}
  .flt-chip button{border:0;background:none;color:var(--cinza);font:500 var(--t-14)/1 var(--fonte);width:18px;height:18px;border-radius:50%;cursor:pointer}
  .flt-chip button:hover{background:var(--fundo-suave);color:var(--tinta)}
  .flt-painel{margin-top:var(--e-3);padding:var(--e-4);background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio)}
  .flt-painel[hidden]{display:none}
  .flt-sec{margin-top:var(--e-4)}.flt-sec:first-child{margin-top:0}
  .flt-sec>h4{margin:0 0 var(--e-2);font:600 var(--t-13)/1.3 var(--fonte)}
  .flt-sec>h4 span{font-weight:400;color:var(--cinza)}
  .flt-cond{display:grid;grid-template-columns:minmax(140px,1.2fr) minmax(130px,1fr) minmax(160px,1.6fr) 32px;gap:var(--e-2);align-items:center;margin-bottom:var(--e-2)}
  .flt-cond select,.flt-cond input{width:100%;min-width:0}
  .flt-cond .dois{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .flt-cond .lista{display:flex;flex-wrap:wrap;gap:4px;max-height:96px;overflow:auto;padding:4px;border:1px solid var(--borda-campo);border-radius:var(--raio-p);background:var(--superficie)}
  .flt-cond .lista label{display:inline-flex;align-items:center;gap:4px;font-size:var(--t-12);padding:2px 6px;border-radius:var(--raio-p);cursor:pointer}
  .flt-cond .lista label:hover{background:var(--fundo-suave)}
  .flt-per{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--e-2);align-items:end}
  .flt-per .intervalo{grid-column:1/-1;font-size:var(--t-12);color:var(--cinza)}
  .flt-rodape{display:flex;flex-wrap:wrap;gap:var(--e-2);align-items:center;margin-top:var(--e-4);padding-top:var(--e-3);border-top:1px solid var(--borda)}
  .flt-rodape .dir{margin-left:auto;display:flex;gap:var(--e-2);flex-wrap:wrap}
  .flt-salvar{flex-basis:100%;align-items:end}.flt-salvar .campo{flex:1 1 200px}
  .flt-msg{margin-top:var(--e-2);font-size:var(--t-12);color:var(--verm)}
  .flt-msg:empty{display:none}
  .flt-fav{display:flex;gap:6px;align-items:center}
  @media (max-width:700px){.flt-cond{grid-template-columns:1fr 1fr;} .flt-cond .valor{grid-column:1/-1} .flt-cond .rm{grid-column:2;justify-self:end}}`
  document.head.appendChild(css)

  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'dataset') Object.assign(e.dataset, v); else if (k in e) e[k] = v; else e.setAttribute(k, v) } e.append(...filhos.filter(x => x != null)); return e }
  const api = async (url, body, method) => {
    const r = await fetch(url, body !== undefined ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : (method ? { method } : undefined))
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  // mesma codificação do servidor (lib/filtros.js serializar): base64url do JSON compacto {p,a,t}
  const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const serializar = def => b64url(JSON.stringify({ p: def.painel, a: def.arvore, t: def.periodo ? { c: def.periodo.campo, s: def.periodo.preset, d: def.periodo.de, a: def.periodo.ate, x: def.periodo.comparar } : null }))
  const lerNome = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }
  const gravarNome = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento */ } }
  const fUrl = p => new URLSearchParams(location.search).get(p)
  const desserializarLocal = s => { try { const j = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))); return { painel: j.p, arvore: j.a || null, periodo: j.t ? { campo: j.t.c, preset: j.t.s, de: j.t.d, ate: j.t.a, comparar: j.t.x } : null } } catch { return null } }

  // ── estado interno: duas listas (E, OU) + período; a árvore sai como { op:'E', itens:[...E, { op:'OU', itens:[...OU] }] } ──
  function montar(raiz, { painel, aoAplicar, inicial = null, periodoPadrao = null, escreverUrl = true, rotuloAbrir = 'Filtros', parametro = 'f' } = {}) {
    raiz.classList.add('flt'); raiz.replaceChildren(el('span', { className: 'mudo peq', textContent: 'Carregando filtros…' }))
    let D = null, E = [], OU = [], per = null, aberto = false, favoritos = []
    const topo = el('div', { className: 'flt-topo' }), chips = el('div', { className: 'flt-chips', 'aria-live': 'polite' }), painelEl = el('div', { className: 'flt-painel', hidden: true }), msg = el('div', { className: 'flt-msg', role: 'alert' })

    const campo = id => D.campos.find(c => c.id === id)
    const arvore = () => {
      const limpo = lista => lista.filter(c => c.campo && c.operador).map(c => ({ campo: c.campo, operador: c.operador, valor: c.valor }))
      const e = limpo(E), ou = limpo(OU)
      if (!e.length && !ou.length) return null
      if (!ou.length) return { op: 'E', itens: e }
      if (!e.length) return { op: 'OU', itens: ou }
      return { op: 'E', itens: [...e, { op: 'OU', itens: ou }] }
    }
    const definicao = () => ({ painel, arvore: arvore(), periodo: per ? { campo: per.campo, preset: per.preset, de: per.de || '', ate: per.ate || '', comparar: per.comparar || null } : null })
    const carregarDef = def => {
      E = []; OU = []
      const flat = (no, destino) => { for (const it of no?.itens || []) { if (it.itens) flat(it, it.op === 'OU' ? OU : destino); else destino.push({ ...it }) } }
      if (def?.arvore) { if (def.arvore.itens) flat(def.arvore, def.arvore.op === 'OU' ? OU : E); else E.push({ ...def.arvore }) }
      per = !D.datas?.length ? null : def?.periodo ? { ...def.periodo } : (periodoPadrao ? { campo: D.data_padrao, preset: periodoPadrao, comparar: 'anterior' } : null)
    }

    // ── linha de condição ──
    function linha(cond, lista) {
      const row = el('div', { className: 'flt-cond' })
      const selCampo = el('select', { 'aria-label': 'Campo' }, el('option', { value: '', textContent: 'Campo…' }), ...D.campos.map(c => el('option', { value: c.id, textContent: c.rotulo })))
      const selOp = el('select', { 'aria-label': 'Operador' }), valor = el('div', { className: 'valor' })
      const rm = el('button', { className: 'btn btn-icone btn-p rm', type: 'button', 'aria-label': 'Remover condição', textContent: '×' })
      const desenharOps = () => {
        const c = campo(cond.campo); selOp.replaceChildren(el('option', { value: '', textContent: 'Operador…' }))
        if (c) for (const o of c.operadores) selOp.append(el('option', { value: o.id, textContent: o.rotulo }))
        selOp.value = cond.operador && c?.operadores.some(o => o.id === cond.operador) ? cond.operador : ''
        if (!selOp.value) cond.operador = ''
      }
      const desenharValor = () => {
        valor.replaceChildren()
        const c = campo(cond.campo), o = c?.operadores.find(x => x.id === cond.operador)
        if (!c || !o || o.arid === 0) { cond.valor = o && o.arid === 0 ? null : cond.valor; return }
        const tipoInput = c.tipo === 'numero' ? 'number' : c.tipo === 'data' ? 'date' : 'text'
        const input = (v, i) => { const x = el('input', { type: tipoInput, 'aria-label': 'Valor', value: v ?? '', step: c.tipo === 'numero' ? 'any' : null }); x.oninput = () => { if (o.arid === 2) { cond.valor = Array.isArray(cond.valor) ? [...cond.valor] : ['', '']; cond.valor[i] = x.value } else cond.valor = x.value }; return x }
        if (o.arid === 'lista' && c.valores?.length) {           // "é um de": caixinhas
          const sel = new Set(Array.isArray(cond.valor) ? cond.valor : String(cond.valor || '').split(',').filter(Boolean))
          const box = el('div', { className: 'lista' })
          for (const v of c.valores) { const id = typeof v === 'object' ? v.id : v, rot = typeof v === 'object' ? v.rotulo : v; const cb = el('input', { type: 'checkbox', checked: sel.has(id) }); cb.onchange = () => { cb.checked ? sel.add(id) : sel.delete(id); cond.valor = [...sel] }; box.append(el('label', {}, cb, document.createTextNode(rot))) }
          cond.valor = [...sel]; valor.append(box); return
        }
        if (o.arid === 2) { const v = Array.isArray(cond.valor) ? cond.valor : ['', '']; cond.valor = [v[0] ?? '', v[1] ?? '']; valor.append(el('div', { className: 'dois' }, input(v[0], 0), input(v[1], 1))); return }
        if (c.valores?.length && ['igual', 'diferente'].includes(cond.operador)) {
          const s = el('select', { 'aria-label': 'Valor' }, el('option', { value: '', textContent: 'Escolha…' }), ...c.valores.map(v => el('option', { value: typeof v === 'object' ? v.id : v, textContent: typeof v === 'object' ? v.rotulo : v })))
          s.value = cond.valor ?? ''; s.onchange = () => { cond.valor = s.value }; valor.append(s); return
        }
        valor.append(input(Array.isArray(cond.valor) ? '' : cond.valor))
      }
      selCampo.value = cond.campo || ''
      selCampo.onchange = () => { cond.campo = selCampo.value; cond.operador = ''; cond.valor = ''; desenharOps(); desenharValor() }
      selOp.onchange = () => { cond.operador = selOp.value; cond.valor = ''; desenharValor() }
      rm.onclick = () => { const i = lista.indexOf(cond); if (i >= 0) lista.splice(i, 1); desenharPainel() }
      desenharOps(); desenharValor()
      row.append(selCampo, selOp, valor, rm)
      return row
    }
    function secao(titulo, sub, lista) {
      const s = el('div', { className: 'flt-sec' }, el('h4', {}, document.createTextNode(titulo + ' '), el('span', { textContent: sub })))
      for (const c of lista) s.append(linha(c, lista))
      const add = el('button', { className: 'btn btn-fantasma btn-p', type: 'button', textContent: 'Adicionar condição' }); add.onclick = () => { lista.push({ campo: '', operador: '', valor: '' }); desenharPainel() }
      s.append(add); return s
    }
    // ── período ──
    function secaoPeriodo() {
      if (!D.datas?.length) return el('div', { className: 'flt-sec mudo peq', textContent: D.sem_periodo || 'Este painel não filtra por período.' })
      const s = el('div', { className: 'flt-sec' }, el('h4', {}, document.createTextNode('Período '), el('span', { textContent: 'qual data e qual recorte' })))
      const liga = el('label', { className: 'linha' }, Object.assign(el('input', { type: 'checkbox', checked: !!per }), { onchange: e => { per = e.target.checked ? { campo: D.data_padrao, preset: periodoPadrao || 'ultimos_90_dias', comparar: 'anterior' } : null; desenharPainel() } }), document.createTextNode(' Filtrar por período'))
      s.append(liga)
      if (!per) return s
      const g = el('div', { className: 'flt-per' })
      const c1 = el('div', { className: 'campo' }, el('label', { textContent: 'Data filtrada' }), Object.assign(el('select', {}, ...D.datas.map(d => el('option', { value: d.id, textContent: d.rotulo }))), { value: per.campo, onchange: e => { per.campo = e.target.value } }))
      const c2 = el('div', { className: 'campo' }, el('label', { textContent: 'Recorte' }), Object.assign(el('select', {}, ...D.presets.map(p => el('option', { value: p.id, textContent: p.rotulo }))), { value: per.preset, onchange: e => { per.preset = e.target.value; desenharPainel() } }))
      const c3 = el('div', { className: 'campo' }, el('label', { textContent: 'Comparar com' }), Object.assign(el('select', {}, el('option', { value: '', textContent: 'Não comparar' }), ...D.comparacoes.map(p => el('option', { value: p.id, textContent: p.rotulo }))), { value: per.comparar || '', onchange: e => { per.comparar = e.target.value || null; mostrarIntervalo() } }))
      g.append(c1, c2, c3)
      if (per.preset === 'personalizado') {
        g.append(el('div', { className: 'campo' }, el('label', { textContent: 'De' }), Object.assign(el('input', { type: 'date', value: per.de || '' }), { onchange: e => { per.de = e.target.value; mostrarIntervalo() } })),
          el('div', { className: 'campo' }, el('label', { textContent: 'Até' }), Object.assign(el('input', { type: 'date', value: per.ate || '' }), { onchange: e => { per.ate = e.target.value; mostrarIntervalo() } })))
      }
      const intervalo = el('div', { className: 'intervalo' }); g.append(intervalo)
      async function mostrarIntervalo() {
        try {
          const q = new URLSearchParams({ preset: per.preset, de: per.de || '', ate: per.ate || '' })
          const r = await api('/api/filtros/periodo?' + q)
          intervalo.textContent = r.rotulo + (per.comparar ? ' · ' + r[per.comparar].rotulo : '')
        } catch (e) { intervalo.textContent = e.message }
      }
      mostrarIntervalo()
      s.append(g); return s
    }
    // ── favoritos ──
    function secaoFavoritos() {
      const s = el('div', { className: 'flt-fav' })
      const sel = el('select', { 'aria-label': 'Filtros salvos' }, el('option', { value: '', textContent: favoritos.length ? 'Filtros salvos…' : 'Nenhum filtro salvo' }), ...favoritos.map(f => el('option', { value: String(f.id), textContent: f.nome })))
      sel.onchange = () => { const f = favoritos.find(x => String(x.id) === sel.value); if (!f) return; carregarDef(f.definicao); api('/api/filtros/salvos/usar', { id: f.id }).catch(() => {}); desenharPainel(); aplicar() }
      const rm = el('button', { className: 'btn btn-fantasma btn-p', type: 'button', textContent: 'Remover salvo' })
      rm.onclick = async () => { const f = favoritos.find(x => String(x.id) === sel.value); if (!f) return msgErro('Escolha um filtro salvo para remover.'); if (!(await (window.PS?.confirmar ? PS.confirmar({ titulo: `Remover o filtro "${f.nome}"?`, rotuloOk: 'Remover', perigo: true }) : Promise.resolve(confirm(`Remover o filtro "${f.nome}"?`))))) return; await api(`/api/filtros/salvos/${f.id}?painel=${encodeURIComponent(painel)}`, undefined, 'DELETE'); favoritos = favoritos.filter(x => x.id !== f.id); desenharPainel() }
      s.append(sel, rm); return s
    }
    // salvar favorito sem prompt(): um formulário pequeno no rodapé do painel (nome do filtro + quem salva)
    function salvarFavorito(rod) {
      const def = definicao(); if (!def.arvore && !def.periodo) return msgErro('Monte um filtro antes de salvar.')
      rod.querySelector('.flt-salvar')?.remove()
      const nome = el('input', { type: 'text', maxLength: 60, placeholder: 'Nome do filtro (ex.: ML da Giovanna · 3 meses)', 'aria-label': 'Nome do filtro' })
      const por = el('input', { type: 'text', maxLength: 80, placeholder: 'Seu nome', 'aria-label': 'Seu nome', value: lerNome(), autocomplete: 'name' })
      const okBtn = el('button', { className: 'btn btn-p', type: 'button', textContent: 'Salvar' }), cancelar = el('button', { className: 'btn btn-fantasma btn-p', type: 'button', textContent: 'Cancelar' })
      const form = el('div', { className: 'flt-salvar linha' }, el('div', { className: 'campo' }, el('label', { textContent: 'Nome do filtro' }), nome), el('div', { className: 'campo' }, el('label', { textContent: 'Seu nome (fica registrado)' }), por), okBtn, cancelar)
      cancelar.onclick = () => form.remove()
      okBtn.onclick = async () => {
        if (!nome.value.trim()) { msgErro('Dê um nome ao filtro.'); nome.focus(); return }
        if (!por.value.trim()) { msgErro('Informe seu nome.'); por.focus(); return }
        okBtn.disabled = true
        try { const r = await api('/api/filtros/salvos', { painel, nome: nome.value.trim(), definicao: def, por: por.value.trim() }); gravarNome(por.value.trim()); favoritos = await api('/api/filtros/salvos?painel=' + encodeURIComponent(painel)); desenharPainel(); window.PS?.toast?.(`Filtro "${r.nome}" salvo.`) } catch (e) { msgErro(e.message); okBtn.disabled = false }
      }
      rod.append(form); nome.focus()
    }
    const msgErro = t => { msg.textContent = t }

    // ── aplicar: valida no servidor (mensagens legíveis), desenha chips, escreve ?f= e avisa a tela ──
    let ultimoF = null
    async function aplicar() {
      msg.textContent = ''
      const def = definicao()
      try {
        const r = await api('/api/filtros/validar', def)
        const f = (r.definicao.arvore || r.definicao.periodo) ? serializar(r.definicao) : null
        ultimoF = f
        desenharChips(r.chips, r.definicao)
        if (escreverUrl) { const u = new URL(location.href); if (f) u.searchParams.set(parametro, f); else u.searchParams.delete(parametro); history.replaceState(history.state, '', u) }
        aoAplicar?.(r.definicao, f)
      } catch (e) { msgErro(e.message) }
    }
    function desenharChips(lista, def) {
      chips.replaceChildren()
      for (const c of lista) {
        const chip = el('span', { className: 'flt-chip' + (c.caminho === 'periodo' || c.caminho === 'comparar' ? ' per' : ''), title: c.detalhe || c.texto }, el('span', { textContent: c.texto }))
        const x = el('button', { type: 'button', 'aria-label': 'Remover: ' + c.texto, textContent: '×' })
        x.onclick = () => { removerCaminho(def, c.caminho); desenharPainel(); aplicar() }
        chip.append(x); chips.append(chip)
      }
      if (lista.length) { const limpar = el('button', { className: 'btn btn-fantasma btn-p', type: 'button', textContent: 'Limpar tudo' }); limpar.onclick = () => { E = []; OU = []; per = null; desenharPainel(); aplicar() }; chips.append(limpar) }
      abrir.textContent = `${rotuloAbrir}${lista.length ? ` (${lista.length})` : ''}`
    }
    // remove pelo caminho devolvido pelo servidor: índices na árvore normalizada → mapeia para E/OU pela ordem
    function removerCaminho(defNorm, caminho) {
      if (caminho === 'periodo') { per = null; return }
      if (caminho === 'comparar') { if (per) per.comparar = null; return }
      const flatE = [], flatOU = []
      const walk = (no, destino) => { for (const it of no?.itens || []) { if (it.itens) walk(it, it.op === 'OU' ? flatOU : destino); else destino.push(it) } }
      if (defNorm.arvore?.itens) walk(defNorm.arvore, defNorm.arvore.op === 'OU' ? flatOU : flatE); else if (defNorm.arvore) flatE.push(defNorm.arvore)
      // acha o nó pelo caminho e remove o equivalente (mesma posição relativa) da lista local
      let no = defNorm.arvore; for (const i of caminho) no = no?.itens?.[i]
      if (!no) return
      const idxE = flatE.indexOf(no), idxOU = flatOU.indexOf(no)
      if (idxE >= 0) E.splice(idxE, 1); else if (idxOU >= 0) OU.splice(idxOU, 1)
    }

    const abrir = el('button', { className: 'btn', type: 'button', textContent: rotuloAbrir, 'aria-expanded': 'false' })
    abrir.onclick = () => { aberto = !aberto; painelEl.hidden = !aberto; abrir.setAttribute('aria-expanded', String(aberto)); if (aberto) desenharPainel() }
    function desenharPainel() {
      painelEl.replaceChildren(secaoPeriodo(), secao('Todas estas condições', '(E)', E), secao('E qualquer uma destas', '(OU)', OU))
      const rod = el('div', { className: 'flt-rodape' })
      const aplicarBtn = el('button', { className: 'btn forte', type: 'button', textContent: 'Aplicar filtros' }); aplicarBtn.onclick = aplicar   // secundário: a tela já tem o seu único primário
      const salvar = el('button', { className: 'btn', type: 'button', textContent: 'Salvar como favorito' }); salvar.onclick = () => salvarFavorito(rod)
      rod.append(secaoFavoritos(), el('div', { className: 'dir' }, salvar, aplicarBtn))
      painelEl.append(rod, msg)
    }

    ;(async () => {
      try {
        D = await api('/api/filtros/definicao?painel=' + encodeURIComponent(painel))
        favoritos = D.salvos || []
        const daUrl = fUrl(parametro) ? desserializarLocal(fUrl(parametro)) : null
        carregarDef(daUrl && daUrl.painel === painel ? daUrl : inicial)
        topo.append(abrir); raiz.replaceChildren(topo, chips, painelEl)
        if (daUrl || inicial || per) aplicar(); else desenharChips([], definicao())
      } catch (e) { raiz.replaceChildren(el('span', { className: 'mudo peq', textContent: 'Filtros indisponíveis: ' + e.message })) }
    })()
    return { aplicar, serializado: () => ultimoF, definicao }
  }
  window.PSFiltros = { montar, serializar }
})()
