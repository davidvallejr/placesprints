// Ofertas estratégicas dentro do Cliente → Anúncios: capacidades (honestas), lista de anúncios com filtros, Novo produto, Importar planilha,
// Importar anúncio existente, Otimizar selecionados, Fila de produção e o detalhe do job em gaveta com 8 abas (visão geral, dados e ficha,
// custos e preços, fotos e galeria, estratégia, aprovação, publicação, histórico). window.PSOfertas.montar(el, cliente).
// Regra do projeto: o módulo não decide nada sozinho — as propostas são ações do plano (Algoritmo) e o resultado volta ao Merovíngio.
// Segurança: tudo do servidor passa por esc()/textContent; publicação live só com confirmação explícita; nada de sucesso simulado.
(() => {
  if (window.PSOfertas) return
  const css = document.createElement('style')
  css.textContent = `
  .of{font-size:var(--t-13)}
  .of-cap{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:var(--e-2) 0 var(--e-3)}
  .of-acoes{display:flex;flex-wrap:wrap;gap:var(--e-2);align-items:center;margin-bottom:var(--e-3)}
  .of-acoes .dir{margin-left:auto;display:flex;gap:var(--e-2);align-items:center;flex-wrap:wrap}
  .of-tab td,.of-tab th{white-space:nowrap}.of-tab td.tit{white-space:normal;min-width:220px;max-width:360px}
  .of-tab .foto img{width:36px;height:36px;object-fit:cover;border-radius:var(--raio-p);border:1px solid var(--borda)}
  .of-tab .foto span{display:inline-block;width:36px;height:36px;border-radius:var(--raio-p);background:var(--fundo-suave)}
  .of-chips{display:flex;flex-wrap:wrap;gap:6px;margin:var(--e-2) 0}
  .of-gaveta{position:fixed;inset:0 0 0 auto;width:min(860px,100%);overflow:auto;z-index:var(--z-gaveta);background:var(--superficie);border-left:1px solid var(--borda);box-shadow:var(--sombra-alta);padding:var(--e-5) var(--e-5) var(--e-8)}
  .of-gaveta[hidden]{display:none}
  .of-gaveta .cab{display:flex;gap:var(--e-3);align-items:flex-start;justify-content:space-between;margin-bottom:var(--e-3)}
  .of-gaveta h3{margin:0;font:600 var(--t-20)/1.3 var(--fonte-display)}
  .of-abas{display:flex;gap:var(--e-4);border-bottom:1px solid var(--borda);overflow-x:auto;scrollbar-width:none;margin-bottom:var(--e-4)}
  .of-abas button{border:0;background:none;padding:10px 0;color:var(--cinza);font:500 var(--t-14) var(--fonte);border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap}
  .of-abas button[aria-pressed="true"]{color:var(--tinta);font-weight:600;border-bottom-color:var(--tinta)}
  .of-kv{display:grid;grid-template-columns:max-content 1fr;gap:6px var(--e-4);font-size:var(--t-13)}.of-kv dt{color:var(--cinza)}.of-kv dd{margin:0}
  .of-pend li{margin:4px 0}
  .of-lente{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--e-2)}
  .of-lente .cartao{padding:12px 14px}.of-lente h5{margin:0 0 4px;font:600 var(--t-13) var(--fonte)}
  .of-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--e-3)}
  .of-form .cheia{grid-column:1/-1}
  .of-var{border-top:1px solid var(--borda);padding-top:var(--e-3);margin-top:var(--e-3)}
  .of-ok{color:var(--verde)}.of-no{color:var(--verm)}
  .of-mono{font:400 var(--t-12) var(--fonte-mono)}
  .of-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:var(--e-3)}
  .of-gal figure{margin:0;border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden;background:var(--superficie)}
  .of-gal img{width:100%;aspect-ratio:1;object-fit:cover;display:block}.of-gal figcaption{padding:6px 8px;font-size:var(--t-12)}
  .of-diff td{vertical-align:top;white-space:normal}
  @media (max-width:639px){.of-acoes .dir{margin-left:0}}`
  document.head.appendChild(css)

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body, method) => {
    const r = await fetch(url, body !== undefined ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok && !(r.status === 409 && j && typeof j === 'object' && 'ok' in j)) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'dataset') Object.assign(e.dataset, v); else if (k in e) e[k] = v; else e.setAttribute(k, v) } e.append(...filhos.filter(x => x != null)); return e }
  const brl = v => v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const num = v => v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR')
  const pct = v => v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
  const dt = iso => iso ? String(iso).slice(0, 16).replace('T', ' ').split(' ').map((p, i) => i === 0 ? p.split('-').reverse().join('/') : p).join(' ') : '—'
  const urlOk = u => /^https?:\/\//.test(String(u || '')) ? u : ''
  const lerNome = () => { try { return window.PS?.quem?.().nome || localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }   // padrão = «Quem sou» do topo (F2)
  const gravarNome = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento */ } }
  const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
  const confirmar = o => window.PS?.confirmar ? PS.confirmar(o) : Promise.resolve(confirm(o.titulo))
  const ESCOPO = { oferta_completa: 'Oferta completa', titulo_descricao: 'Título e descrição', ficha: 'Ficha técnica', preco: 'Preço', imagem_avulsa: 'Imagem avulsa', galeria: 'Galeria' }
  const OBJETIVO = { lancar: 'Lançar produto', elevar_clique: 'Elevar clique', melhorar_conversao: 'Melhorar conversão', preservar_margem: 'Preservar margem', corrigir_ficha: 'Corrigir ficha', campanha_sazonal: 'Campanha sazonal' }
  const MODO = { rascunho: 'Só preparar rascunho', publicar_apos_aprovacao: 'Publicar depois da aprovação (padrão)', automatico_politica: 'Automático com política autorizada' }
  const TOM = e => /publicado|monitorando|confirmada/.test(e) ? 'ok' : /falha|conflito|rejeitado|cancelado/.test(e) ? 'no' : /pendente|aguardando|rascunho/.test(e) ? 'mid' : ''
  const badge = (txt, tom) => `<span class="badge ${tom === 'ok' ? 't-concluida' : tom === 'no' ? 't-bloqueada' : tom === 'mid' ? 'selo atencao' : ''}">${esc(txt)}</span>`

  function montar(raiz, cliente) {
    raiz.classList.add('of')
    const S = { cliente, visao: 'lista', opcoes: null, cap: null, lista: null, f: null, limite: 50, jobs: null, estado: '', sel: new Set(), job: null, aba: 'visao' }
    const q = encodeURIComponent(cliente)
    const topo = el('div'), corpo = el('div'), gaveta = el('aside', { className: 'of-gaveta', hidden: true, 'aria-label': 'Detalhe da oferta' })
    raiz.replaceChildren(topo, corpo, gaveta)
    const porAtual = () => lerNome()
    const pedirPor = () => { let p = lerNome(); if (!p) { p = (prompt('Seu nome (fica registrado na auditoria):') || '').trim(); if (p) gravarNome(p) } return p }

    // ── capacidades + barra de ações ──
    async function cabecalho() {
      topo.replaceChildren(el('div', { className: 'mudo peq', textContent: 'Lendo capacidades…' }))
      try { const [cap, op] = await Promise.all([api(`/api/ofertas/capacidades?cliente=${q}`), S.opcoes || api('/api/ofertas/opcoes')]); S.cap = cap; S.opcoes = op } catch (e) { topo.replaceChildren(el('div', { className: 'erro-bloco' }, el('b', { textContent: 'Não foi possível ler as capacidades' }), el('div', { className: 'mudo', textContent: e.message }))); return }
      const c = S.cap, ml = c.canais?.ML || c.ML || {}
      const chips = [
        ml.estado === 'leitura_e_escrita' ? ['Mercado Livre: leitura e escrita', 'ok'] : ml.estado === 'somente_leitura' ? ['Mercado Livre: só leitura', 'mid'] : ml.estado === 'reconectar' ? ['Mercado Livre: reconectar', 'no'] : ['Mercado Livre: não conectado', 'no'],
        c.custos ? [c.custos.sem_custo ? `Custos: ${c.custos.sem_custo} variante(s) sem custo` : `Custos: ${c.custos.com_custo || 0} com custo`, c.custos.sem_custo ? 'mid' : 'ok'] : null,
        c.regras_comerciais ? [c.regras_comerciais.vigentes ? `Regras comerciais: ${c.regras_comerciais.vigentes} vigente(s)` : 'Regras comerciais: pendente (preço fica em simulação)', c.regras_comerciais.vigentes ? 'ok' : 'mid'] : null,
        c.imagens ? [c.imagens.provedor && c.imagens.provedor !== 'nenhum' ? `Imagens: ${c.imagens.provedor}` : `Imagens: pendente — ${c.imagens.pendente || 'provedor não configurado'}`, c.imagens.provedor && c.imagens.provedor !== 'nenhum' ? 'ok' : 'mid'] : null,
        c.drive ? [c.drive.estado === 'pendente' ? `Drive: pendente — ${(c.drive.faltando || []).join(', ') || 'credencial'}` : 'Drive: disponível', c.drive.estado === 'pendente' ? 'mid' : 'ok'] : null,
      ].filter(Boolean)
      const curto = t => t.length > 70 ? t.slice(0, 67).replace(/[\s—:,-]+$/, '') + '…' : t
      const capEl = el('div', { className: 'of-cap' }); capEl.innerHTML = chips.map(([t, tom]) => `<span title="${esc(t)}">${badge(curto(t), tom)}</span>`).join('')
      const acoes = el('div', { className: 'of-acoes' })
      const b = (t, fn, title) => { const x = el('button', { className: 'btn', type: 'button', textContent: t, title: title || '' }); x.onclick = fn; return x }
      const dir = el('div', { className: 'dir' })
      const seg = el('div', { className: 'seg', role: 'group', 'aria-label': 'Visão' })
      for (const [k, t] of [['lista', 'Anúncios'], ['fila', 'Fila de produção']]) { const x = el('button', { type: 'button', textContent: t, 'aria-pressed': String(S.visao === k) }); x.onclick = () => { S.visao = k; cabecalho(); desenhar() }; seg.append(x) }
      dir.append(seg)
      acoes.append(b('Novo produto', dlgNovoProduto, 'Cadastra produto e variantes (uma linha por SKU)'), b('Importar planilha', dlgPlanilha, 'Cole o CSV da aba PRODUTOS: prévia por linha antes de aplicar'), b('Importar anúncio existente', dlgImportarAnuncio, 'Lê o anúncio do Mercado Livre e vincula ao produto/variante'), b('Otimizar selecionados', dlgOtimizar, 'Abre um job por anúncio selecionado, com escopo e objetivo'), dir)
      topo.replaceChildren(capEl, acoes)
    }

    // ── lista de anúncios ──
    function desenhar() { S.visao === 'fila' ? desenharFila() : desenharLista() }
    let fltEl = null
    function desenharLista() {
      if (!fltEl) { fltEl = el('div'); if (window.PSFiltros) PSFiltros.montar(fltEl, { painel: 'ofertas', periodoPadrao: 'ultimos_90_dias', rotuloAbrir: 'Filtrar', escreverUrl: false, aoAplicar: (_d, f) => { S.f = f; S.limite = 50; buscarLista() } }) }
      corpo.replaceChildren(fltEl, el('div', { className: 'skeleton sk-tabela' }))
      if (!window.PSFiltros) buscarLista()
    }
    async function buscarLista() {
      const alvo = el('div'); corpo.replaceChildren(fltEl, alvo); alvo.innerHTML = '<div class="skeleton sk-tabela"></div>'
      try {
        const r = await api(`/api/ofertas/anuncios?cliente=${q}${S.f ? '&f=' + encodeURIComponent(S.f) : ''}`)
        S.lista = r; renderLista(alvo)
      } catch (e) { alvo.replaceChildren(el('div', { className: 'erro-bloco' }, el('b', { textContent: 'Não foi possível carregar os anúncios' }), el('div', { className: 'mudo', textContent: e.message }), Object.assign(el('button', { className: 'btn btn-p', type: 'button', textContent: 'Tentar de novo' }), { onclick: buscarLista }))) }
    }
    function renderLista(alvo) {
      const r = S.lista, itens = r.itens || [], t = r.totais || {}
      if (!itens.length) { alvo.innerHTML = `<div class="vazio-box"><b>${r.total_sem_filtro ? 'Nenhum anúncio com esses filtros.' : 'Nenhum anúncio coletado do Mercado Livre nem produto cadastrado ainda.'}</b>${r.total_sem_filtro ? 'Ajuste as condições em Filtrar.' : 'Conecte a conta do Mercado Livre em Integrações (a coleta traz os anúncios) ou cadastre um produto novo.'}</div>`; return }
      const linha = i => `<tr data-id="${esc(i.anuncio || '')}" data-mlb="${esc(i.anuncio_id || '')}" data-var="${esc(i.variante_id || '')}">
        <td><input type="checkbox" class="of-sel" value="${esc(i.anuncio_id || i.variante_id || '')}" aria-label="Selecionar ${esc(i.produto || i.anuncio_id)}" ${S.sel.has(i.anuncio_id || i.variante_id) ? 'checked' : ''}></td>
        <td class="foto">${urlOk(i.foto) ? `<img src="${esc(i.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span></span>'}</td>
        <td class="tit"><b>${esc(i.produto || i.titulo || '—')}</b> ${i.catalogo_origem && i.catalogo_origem !== 'nao' ? seloCatalogo(i.catalogo_origem) : ''}<div class="mini">${esc(i.sku || 'sem SKU')}${i.variacao ? ' · ' + esc(i.variacao) : ''}</div></td>
        <td class="of-mono">${urlOk(i.url) ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.anuncio_id)}</a>` : esc(i.anuncio_id || '—')}<div class="mini">${esc(i.canal || '')}${i.conta ? ' · ' + esc(i.conta) : ''}</div></td>
        <td class="n">${brl(i.preco)}</td>
        <td class="n" title="${esc(i.margem_fonte || '')}">${i.margem_pct == null ? '<span class="mudo">sem custo</span>' : pct(i.margem_pct)}</td>
        <td class="n">${num(i.estoque)}</td><td class="n">${num(i.vendas_unidades)}</td><td class="n">${brl(i.faturamento)}</td>
        <td>${esc(i.consultor || '—')}<div class="mini">${esc(i.analista || '')}</div></td>
        <td>${i.job_id ? `<button class="nome-btn" type="button" data-job="${esc(i.job_id)}">${esc(i.status_rotulo || i.status)}</button>` : `<span class="mudo">${i.importado === false ? 'não importado' : 'sem job'}</span>`}${i.escopo ? `<div class="mini">${esc(ESCOPO[i.escopo] || i.escopo)}</div>` : ''}</td>
        <td class="mini">${esc(dt(i.ultima_sincronizacao))}</td></tr>`
      alvo.innerHTML = `
        <p class="mini">${esc(r.periodo?.rotulo || '')}${r.periodo?.nota ? ' · ' + esc(r.periodo.nota) : ''}</p>
        <div class="kpis">
          <div class="kpi"><div class="rotulo">Anúncios</div><div class="valor">${num(t.anuncios)}</div><div class="detalhe">${r.total_sem_filtro != null && r.total_sem_filtro !== t.anuncios ? `de ${num(r.total_sem_filtro)} do cliente` : 'do cliente no Mercado Livre e no módulo'}</div></div>
          <div class="kpi"><div class="rotulo">Unidades no período</div><div class="valor">${num(t.vendas_unidades)}</div><div class="detalhe">data da venda</div></div>
          <div class="kpi"><div class="rotulo">Faturamento no período</div><div class="valor">${brl(t.faturamento)}</div><div class="detalhe">${r.serie_disponivel === false ? 'sem série de vendas coletada' : 'pedidos do Mercado Livre'}</div></div>
          <div class="kpi"><div class="rotulo">Com job aberto</div><div class="valor">${num(itens.filter(i => i.job_id).length)}</div><div class="detalhe">veja a Fila de produção</div></div>
        </div>
        <div class="linha" style="justify-content:space-between"><span class="mini">${num(itens.length)} linha(s)</span><a class="btn btn-fantasma btn-p" href="/api/ofertas/exportar.csv?cliente=${q}${S.f ? '&f=' + encodeURIComponent(S.f) : ''}">Baixar CSV (com o filtro)</a></div>
        <div class="tabela-wrap fixa"><table class="t of-tab"><thead><tr><th><input type="checkbox" class="of-todos" aria-label="Selecionar todos"></th><th></th><th>Produto / SKU</th><th>Anúncio</th><th class="n">Preço atual</th><th class="n">Margem est.</th><th class="n">Estoque</th><th class="n">Unid.</th><th class="n">Faturamento</th><th>Consultor / analista</th><th>Oferta</th><th>Sincronizado</th></tr></thead>
        <tbody>${itens.slice(0, S.limite).map(linha).join('')}</tbody></table></div>
        ${itens.length > S.limite ? `<div class="t-pag">1–${S.limite} de ${num(itens.length)} <button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div>` : ''}`
      alvo.querySelector('[data-mais]')?.addEventListener('click', () => { S.limite += 50; renderLista(alvo) })
      alvo.querySelector('.of-todos')?.addEventListener('change', e => { alvo.querySelectorAll('.of-sel').forEach(cb => { cb.checked = e.target.checked; e.target.checked ? S.sel.add(cb.value) : S.sel.delete(cb.value) }) })
      alvo.querySelectorAll('.of-sel').forEach(cb => cb.addEventListener('change', () => cb.checked ? S.sel.add(cb.value) : S.sel.delete(cb.value)))
      alvo.querySelectorAll('[data-job]').forEach(bt => bt.onclick = () => abrirJob(bt.dataset.job))
    }

    // ── fila de produção ──
    async function desenharFila() {
      corpo.replaceChildren(el('div', { className: 'skeleton sk-tabela' }))
      try { S.jobs = await api(`/api/ofertas/jobs?cliente=${q}${S.estado ? '&estado=' + encodeURIComponent(S.estado) : ''}`) } catch (e) { corpo.replaceChildren(el('div', { className: 'erro-bloco' }, el('b', { textContent: 'Não foi possível carregar a fila' }), el('div', { className: 'mudo', textContent: e.message }))); return }
      const jobs = S.jobs.jobs || [], ES = S.jobs.estados || {}
      const cont = {}; for (const j of jobs) cont[j.estado] = (cont[j.estado] || 0) + 1
      const chips = el('div', { className: 'of-chips' })
      const chip = (k, t) => { const x = el('button', { className: 'f-chip', type: 'button', 'aria-pressed': String(S.estado === k) }, document.createTextNode(t), el('span', { className: 'n', textContent: k ? ` ${cont[k] || 0}` : ` ${jobs.length}` })); x.onclick = () => { S.estado = k; desenharFila() }; return x }
      chips.append(chip('', 'Todos'), ...Object.entries(ES).filter(([k]) => cont[k] || k === S.estado).map(([k, v]) => chip(k, v.rotulo)))
      const tab = el('div')
      tab.innerHTML = jobs.length ? `<div class="tabela-wrap fixa"><table class="t of-tab"><thead><tr><th>Produto / anúncio</th><th>Escopo</th><th>Objetivo</th><th>Estado</th><th>Responsável</th><th class="n">Versão</th><th class="n">Pendências</th><th>Atualizado</th></tr></thead><tbody>${jobs.map(j => `<tr><td class="tit"><button class="nome-btn" type="button" data-job="${esc(j.id)}">${esc(j.produto_nome || j.titulo || j.sku || j.anuncio_id || j.id.slice(0, 8))}</button><div class="mini of-mono">${esc(j.anuncio_id || '')}${j.sku ? ' · ' + esc(j.sku) : ''}</div></td><td>${esc(ESCOPO[j.escopo] || j.escopo)}</td><td>${esc(OBJETIVO[j.objetivo] || j.objetivo || '—')}</td><td>${badge(ES[j.estado]?.rotulo || j.estado, TOM(j.estado))}</td><td>${esc(j.responsavel || '—')}</td><td class="n">${num(j.proposta_versao)}</td><td class="n">${num((j.pendencias || []).length)}</td><td class="mini">${esc(dt(j.atualizado_em))}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="vazio-box"><b>Nenhum job nesta situação.</b>Selecione anúncios na lista e use Otimizar selecionados, ou cadastre um produto novo.</div>'
      tab.querySelectorAll('[data-job]').forEach(bt => bt.onclick = () => abrirJob(bt.dataset.job))
      corpo.replaceChildren(chips, tab)
    }

    // ── diálogos ──
    function dialogo(titulo, conteudoEl, { rotuloOk = 'Salvar', aoOk } = {}) {
      const form = el('form', { method: 'dialog' }, el('h2', { textContent: titulo }), conteudoEl, el('div', { className: 'dlg-rodape' }, el('button', { className: 'btn', value: 'nao', type: 'button', textContent: 'Cancelar' }), el('button', { className: 'btn btn-primario', value: 'sim', type: 'submit', textContent: rotuloOk })))
      const d = el('dialog', { className: 'dlg' }, form)   // o formulário mora DENTRO do <dialog> (antes ficava solto e o diálogo abria vazio)
      const msg = el('div', { className: 'aviso erro', hidden: true }); form.insertBefore(msg, form.lastElementChild)
      form.querySelector('[value=nao]').onclick = () => { d.close(); d.remove() }
      form.onsubmit = async e => { e.preventDefault(); const bt = form.querySelector('[type=submit]'); bt.disabled = true; msg.hidden = true; try { await aoOk(form, msg); d.close(); d.remove() } catch (x) { msg.textContent = x.message; msg.hidden = false; bt.disabled = false } }
      document.body.append(d); d.showModal(); return d
    }
    const campo = (nome, label, props = {}) => el('div', { className: 'campo' }, el('label', { htmlFor: 'of_' + nome, textContent: label }), el('input', { id: 'of_' + nome, name: nome, ...props }))
    const select = (nome, label, opts) => el('div', { className: 'campo' }, el('label', { htmlFor: 'of_' + nome, textContent: label }), el('select', { id: 'of_' + nome, name: nome }, ...opts.map(([v, t]) => el('option', { value: v, textContent: t }))))
    const porCampo = () => campo('por', 'Seu nome (fica na auditoria)', { value: porAtual(), required: true, maxLength: 80, autocomplete: 'name' })
    const valores = (form, nomes) => Object.fromEntries(nomes.map(n => [n, form.elements[n] ? form.elements[n].value.trim() : '']))

    function dlgNovoProduto() {
      const vars = el('div')
      const novaVar = () => { const v = el('div', { className: 'of-form of-var' }); for (const [n, l, p] of [['sku', 'SKU (obrigatório)', { required: true }], ['cor', 'Cor', {}], ['tamanho', 'Tamanho', {}], ['quantidade_kit', 'Qtd. no kit', { type: 'number', min: 1 }], ['estoque', 'Estoque', { type: 'number', min: 0 }], ['peso_embalado_kg', 'Peso embalado (kg)', { type: 'number', step: '0.001' }], ['alt_cm', 'Altura emb. (cm)', { type: 'number', step: '0.1' }], ['larg_cm', 'Largura emb. (cm)', { type: 'number', step: '0.1' }], ['comp_cm', 'Comprimento emb. (cm)', { type: 'number', step: '0.1' }]]) { const c = campo(n + '_' + vars.children.length, l, p); c.querySelector('input').dataset.campo = n; v.append(c) } vars.append(v) }
      novaVar()
      const mais = el('button', { className: 'btn btn-fantasma btn-p', type: 'button', textContent: 'Adicionar variante (outra cor/tamanho)' }); mais.onclick = novaVar
      const cont = el('div', {}, el('div', { className: 'of-form' }, campo('nome', 'Nome do produto (obrigatório)', { required: true, maxLength: 200 }), campo('marca', 'Marca'), campo('modelo', 'Modelo'), campo('gtin', 'GTIN/EAN (texto)'), campo('mpn', 'MPN (só o real do fabricante)'), select('objetivo', 'Objetivo', Object.entries(OBJETIVO)), porCampo()), el('p', { className: 'mini', textContent: 'Uma variante por SKU. Vazio significa desconhecido, nunca zero. GTIN e SKU ficam como texto.' }), vars, mais)
      dialogo('Novo produto', cont, { rotuloOk: 'Cadastrar', aoOk: async form => {
        const p = valores(form, ['nome', 'marca', 'modelo', 'gtin', 'mpn']), por = form.elements.por.value.trim(); gravarNome(por)
        const variantes = [...vars.children].map(v => { const o = { objetivo: form.elements.objetivo.value }; v.querySelectorAll('input').forEach(i => { if (i.value.trim() !== '') o[i.dataset.campo] = i.type === 'number' ? Number(i.value) : i.value.trim() }); return o }).filter(o => o.sku)
        if (!variantes.length) throw new Error('informe ao menos uma variante com SKU')
        const r = await api('/api/ofertas/produtos', { cliente, por, produto: p, variantes })
        toast(`Produto cadastrado com ${r.variantes.length} variante(s)${r.erros?.length ? ` · ${r.erros.length} variante(s) com erro: ${r.erros.map(e => e.sku + ' (' + e.erro + ')').join('; ')}` : ''}.`, r.erros?.length ? 'erro' : 'ok')
        buscarLista()
      } })
    }
    function dlgPlanilha() {
      const ta = el('textarea', { id: 'of_csv', rows: 8, placeholder: 'Cole aqui o CSV/TSV da aba PRODUTOS (1ª linha = cabeçalho: sku, nome_produto, marca, cor, tamanho, estoque_disponivel…)', style: 'width:100%' })
      const arq = el('input', { type: 'file', accept: '.csv,.tsv,text/csv', id: 'of_arq' })
      arq.onchange = () => { const f = arq.files?.[0]; if (f) f.text().then(t => { ta.value = t }) }
      const previa = el('div')
      const cont = el('div', {}, el('div', { className: 'campo' }, el('label', { htmlFor: 'of_arq', textContent: 'Arquivo .csv (opcional)' }), arq), el('div', { className: 'campo' }, el('label', { htmlFor: 'of_csv', textContent: 'Conteúdo' }), ta), porCampo(), previa)
      const parse = txt => { const linhas = txt.split(/\r?\n/).filter(l => l.trim()); if (linhas.length < 2) throw new Error('cole o cabeçalho e ao menos uma linha'); const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/\t/g) || []).length ? (linhas[0].includes(';') ? ';' : ',') : '\t'; const cab = linhas[0].split(sep).map(c => c.trim().replace(/^"|"$/g, '')); return linhas.slice(1).map((l, i) => { const cs = l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')); const o = { _linha: i + 2 }; cab.forEach((c, k) => { if (c) o[c] = cs[k] ?? '' }); return o }) }
      let modo = 'previa'
      const d = dialogo('Importar planilha (aba PRODUTOS)', cont, { rotuloOk: 'Pré-visualizar', aoOk: async (form, msg) => {
        const por = form.elements.por.value.trim(); gravarNome(por)
        const linhas = parse(ta.value)
        if (modo === 'previa') {
          const r = await api('/api/ofertas/importar-planilha', { cliente, por, linhas, aplicar: false })
          const p = r.produtos || {}
          previa.innerHTML = `<div class="aviso ${p.erros?.length ? '' : 'ok'}"><b>Prévia:</b> ${num(p.validas ?? (p.linhas || []).filter(x => !x.erros?.length).length)} linha(s) válidas · ${num((p.erros || []).length)} com erro${p.alteracoes != null ? ` · ${num(p.alteracoes)} alteração(ões) em itens já existentes` : ''}.</div>${(p.erros || []).slice(0, 20).map(e => `<div class="mini of-no">linha ${esc(e.linha ?? e._linha ?? '?')}: ${esc(e.erro || (e.erros || []).join('; '))}</div>`).join('')}<p class="mini">Confira e clique em Aplicar: só as válidas entram; as inválidas ficam listadas.</p>`
          modo = 'aplicar'; form.querySelector('[type=submit]').textContent = 'Aplicar importação'; throw Object.assign(new Error(''), { silencioso: true })
        }
        const r = await api('/api/ofertas/importar-planilha', { cliente, por, linhas, aplicar: true })
        toast(`Importação aplicada: ${num(r.produtos?.importadas ?? r.produtos?.validas ?? 0)} linha(s).`, 'ok'); buscarLista()
      } })
      const formEl = d.querySelector('form'); const velho = formEl.onsubmit
      formEl.onsubmit = async e => { try { await velho(e) } catch (x) { if (!x.silencioso) throw x } finally { const bt = formEl.querySelector('[type=submit]'); bt.disabled = false; const m = formEl.querySelector('.aviso.erro'); if (m && !m.textContent) m.hidden = true } }
    }
    function dlgImportarAnuncio() {
      const cont = el('div', { className: 'of-form' }, campo('anuncio_id', 'Código do anúncio (ex.: MLB1234567890)', { required: true, pattern: '[A-Za-z]{3}\\d{1,15}' }), porCampo())
      dialogo('Importar anúncio existente', cont, { rotuloOk: 'Importar', aoOk: async form => {
        const por = form.elements.por.value.trim(); gravarNome(por)
        const r = await api('/api/ofertas/importar-anuncio', { cliente, por, anuncio_id: form.elements.anuncio_id.value.trim().toUpperCase() })
        if (r.ok === false) throw new Error(r.erro || r.motivo || 'o anúncio não pôde ser importado')
        toast(`Anúncio ${r.anuncio_id || ''} importado${r.pendencias?.length ? ` · pendência: ${r.pendencias.map(p => p.texto || p.tipo || p).join('; ')}` : ''}.`, 'ok'); buscarLista()
      } })
    }
    function dlgOtimizar() {
      const ids = [...S.sel]; if (!ids.length) return toast('Selecione ao menos um anúncio na lista.', 'erro')
      const itens = (S.lista?.itens || []).filter(i => ids.includes(i.anuncio_id || i.variante_id))
      const cont = el('div', { className: 'of-form' }, select('escopo', 'Escopo', Object.entries(ESCOPO)), select('objetivo', 'Objetivo', Object.entries(OBJETIVO)), select('modo', 'Modo', Object.entries(MODO)), el('div', { className: 'campo' }, el('label', { htmlFor: 'of_solicitante', textContent: 'Seu nome (solicitante)' }), el('input', { id: 'of_solicitante', name: 'solicitante', value: porAtual(), required: true, maxLength: 80 })), el('p', { className: 'mini cheia', textContent: `${itens.length} anúncio(s): ${itens.map(i => i.anuncio_id || i.sku).join(', ')}. Cada um vira um job com resultado individual; anúncio ainda não importado é lido do Mercado Livre antes (só leitura). A proposta passa pelo algoritmo e pela aprovação antes de qualquer publicação.` }))
      cont.querySelector('#of_modo').value = 'publicar_apos_aprovacao'
      dialogo('Otimizar selecionados', cont, { rotuloOk: 'Abrir jobs', aoOk: async form => {
        const v = valores(form, ['escopo', 'objetivo', 'modo', 'solicitante']); gravarNome(v.solicitante)
        const r = await api('/api/ofertas/jobs', { cliente, solicitante: v.solicitante, escopo: v.escopo, objetivo: v.objetivo, modo: v.modo, itens: itens.map(i => ({ anuncio_id: i.anuncio_id || '', variante_id: i.variante_id || '' })) })
        toast(`${r.abertos} job(s) aberto(s)${r.falhas ? ` · ${r.falhas} falha(s): ${r.itens.filter(x => !x.ok).map(x => (x.anuncio_id || x.variante_id) + ' (' + x.erro + ')').join('; ')}` : ''}.`, r.falhas ? 'erro' : 'ok')
        S.sel.clear(); S.visao = 'fila'; cabecalho(); desenhar()
      } })
    }

    // ── detalhe do job (gaveta, 8 abas) ──
    async function abrirJob(id) {
      gaveta.hidden = false; gaveta.replaceChildren(el('div', { className: 'skeleton sk-tabela' }))
      try { S.job = await api(`/api/ofertas/jobs/${encodeURIComponent(id)}?cliente=${q}`) } catch (e) { gaveta.replaceChildren(el('div', { className: 'erro-bloco' }, el('b', { textContent: 'Não foi possível abrir o job' }), el('div', { className: 'mudo', textContent: e.message }), Object.assign(el('button', { className: 'btn btn-p', type: 'button', textContent: 'Fechar' }), { onclick: fecharJob }))); return }
      renderJob()
    }
    function fecharJob() { gaveta.hidden = true; gaveta.replaceChildren(); S.job = null; desenhar() }
    const ABAS = [['visao', 'Visão geral'], ['ficha', 'Dados e ficha'], ['preco', 'Custos e preços'], ['fotos', 'Fotos e galeria'], ['estrategia', 'Estratégia'], ['aprovacao', 'Aprovação'], ['publicacao', 'Publicação'], ['historico', 'Histórico e resultados']]
    async function acaoJob(rota, body, rotulo) {
      const por = pedirPor(); if (!por) return
      try { const r = await api(`/api/ofertas/jobs/${encodeURIComponent(S.job.job.id)}/${rota}`, { cliente, por, autor: por, solicitante: por, ...body }); toast(r.mensagem || r.aviso || `${rotulo}: ok${r.estado ? ' · ' + (S.jobs?.estados?.[r.estado]?.rotulo || r.estado) : ''}`, r.ok === false ? 'erro' : 'ok'); await abrirJob(S.job.job.id) } catch (e) { toast(e.message, 'erro') }
    }
    function renderJob() {
      const D = S.job, j = D.job, ES = S.jobs?.estados || S.opcoes?.estados_job?.reduce((m, e) => (m[e.id] = e, m), {}) || {}
      const estado = ES[j.estado] || { rotulo: j.estado }
      const pend = Array.isArray(j.pendencias) ? j.pendencias : (() => { try { return JSON.parse(j.pendencias_json || '[]') } catch { return [] } })()
      const cab = el('div', { className: 'cab' })
      cab.innerHTML = `<div><p class="pg-sobre">Oferta · ${esc(ESCOPO[j.escopo] || j.escopo)} · ${esc(OBJETIVO[j.objetivo] || j.objetivo || '')}</p><h3>${esc(j.produto_nome || j.titulo || j.anuncio_id || 'Produto novo')}</h3><p class="mini of-mono">${esc(j.anuncio_id || '')}${j.sku ? ' · ' + esc(j.sku) : ''} · versão ${num(j.proposta_versao)} · ${esc(MODO[j.modo] || j.modo)}</p></div><div class="linha">${badge(estado.rotulo, TOM(j.estado))}<button class="btn btn-icone" type="button" aria-label="Fechar" data-fechar>×</button></div>`
      cab.querySelector('[data-fechar]').onclick = fecharJob
      const abas = el('nav', { className: 'of-abas', 'aria-label': 'Seções da oferta' })
      for (const [k, t] of ABAS) { const b = el('button', { type: 'button', textContent: t, 'aria-pressed': String(S.aba === k) }); b.onclick = () => { S.aba = k; renderJob() }; abas.append(b) }
      const painel = el('div')
      const P = j.proposta || {}, C = P.conteudo || {}
      const kv = pares => `<dl class="of-kv">${pares.filter(p => p[1] != null && p[1] !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`
      const botao = (t, fn, primario) => { const b = el('button', { className: 'btn' + (primario ? ' btn-primario' : ''), type: 'button', textContent: t }); b.onclick = fn; return b }
      // próxima ação por estado (uma primária na gaveta)
      const proximas = () => {
        const l = el('div', { className: 'linha' })
        const e = j.estado
        if (['rascunho', 'validando_entrada', 'referencia_confirmada', 'pendente_dados'].includes(e)) l.append(botao('Preparar estratégia', () => acaoJob('preparar', {}, 'Estratégia'), true))
        if (['estrategia_preparada', 'em_revisao', 'em_producao'].includes(e) && P) { l.append(botao(`Aprovar versão ${j.proposta_versao}`, () => aprovarCampos(), true), botao('Reprovar com motivo', () => reprovar())) }
        if (['aprovado_publicar', 'na_fila'].includes(e)) { l.append(botao('Publicar (pré-visualizar)', () => publicar(false)), botao('Publicar ao vivo', () => publicar(true), true)) }
        if (['publicando', 'em_conferencia', 'aguardando_canal', 'falha_parcial', 'conflito_externo'].includes(e)) l.append(botao('Conferir no canal', () => acaoJob('conferir', {}, 'Conferência'), true))
        if (['publicado_confirmado', 'monitorando'].includes(e)) l.append(botao('Atualizar monitoramento', () => acaoJob('monitorar', {}, 'Monitoramento'), true))
        if (!['cancelado', 'rejeitado', 'publicado_confirmado', 'monitorando'].includes(e)) { const c = botao('Cancelar oferta', async () => { if (await confirmar({ titulo: 'Cancelar esta oferta?', texto: 'O histórico fica guardado; nada é publicado.', rotuloOk: 'Cancelar oferta', perigo: true })) acaoJob('cancelar', { motivo: 'cancelado pela operação' }, 'Cancelamento') }); c.classList.add('btn-perigo'); l.append(c) }
        return l
      }
      const numeroQueProva = C.mudancas?.[0]?.metrica || j.dados?.metrica_principal || D.diagnostico?.metrica_principal
      if (S.aba === 'visao') {
        painel.innerHTML = `${kv([['Estado', badge(estado.rotulo, TOM(j.estado)) + (estado.acao ? ` <span class="mini">${esc(estado.acao)}</span>` : '')], ['Responsável', esc(j.responsavel || '—') + (j.dados?.responsavel_origem ? ` <span class="mini">(${esc(j.dados.responsavel_origem)})</span>` : '')], ['Ação do plano', j.acao_id ? `<span class="of-mono">${esc(j.acao_id)}</span> <span class="mini">a proposta é uma ação do Algoritmo e é medida pelo Merovíngio</span>` : '<span class="mudo">será criada ao preparar a estratégia</span>'], ['O número que prova', numeroQueProva ? esc(numeroQueProva) + (C.mudancas?.[0]?.janela_dias ? ` · janela ${esc(C.mudancas[0].janela_dias)} dias` : '') : '<span class="mudo">definido na estratégia</span>'], ['Aberto em', esc(dt(j.criado_em))], ['Atualizado', esc(dt(j.atualizado_em))]])}
          <h4>Pendências</h4>${pend.length ? `<ul class="of-pend">${pend.map(p => `<li>${badge(p.tipo || 'pendência', 'mid')} ${esc(p.texto || p.motivo || JSON.stringify(p))}${p.responsavel ? ` <span class="mini">· ${esc(p.responsavel)}</span>` : ''}${p.acao ? ` <span class="mini">· ${esc(p.acao)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="mini">Nenhuma pendência registrada.</p>'}
          ${j.dados?.profissional_sugerido || D.profissional ? `<h4>Quem melhor executa esta tarefa</h4><p class="mini">${esc((j.dados?.profissional_sugerido || D.profissional).recomendado?.nome ? 'Recomendado: ' + (j.dados?.profissional_sugerido || D.profissional).recomendado.nome + ' — ' + (j.dados?.profissional_sugerido || D.profissional).recomendado.motivo : (j.dados?.profissional_sugerido || D.profissional).aviso || '')}</p>` : ''}`
        painel.append(el('h4', { textContent: 'Próxima ação' }), proximas())
      } else if (S.aba === 'ficha') {
        const at = C.atributos || []
        painel.innerHTML = at.length ? `<div class="tabela-wrap"><table class="t of-diff"><thead><tr><th>Atributo</th><th>Atual</th><th>Proposto</th><th>Fonte / evidência</th><th>Situação</th></tr></thead><tbody>${at.map(a => `<tr><td><b>${esc(a.nome || a.atributo_id)}</b><div class="mini of-mono">${esc(a.atributo_id || '')}</div></td><td>${esc(a.valor_atual ?? '—')}</td><td>${esc(a.valor_proposto ?? '—')}</td><td class="mini">${esc(a.fonte || '')}${a.evidencia ? ' · ' + esc(a.evidencia) : ''}</td><td>${P.aprovados?.includes?.('atributos') || P.aprovados?.includes?.('atributo:' + a.atributo_id) ? badge('aprovado', 'ok') : a.validacao === 'reprovado' ? badge('reprovado: ' + (a.motivo || 'não factual'), 'no') : badge('pendente', 'mid')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio-box"><b>Sem proposta de ficha nesta versão.</b>Prepare a estratégia (escopo ficha ou oferta completa) para o algoritmo propor os atributos com evidência.</div>'
        if (C.titulo || C.descricao) painel.insertAdjacentHTML('beforeend', `<h4>Título e descrição propostos</h4>${kv([['Título', esc(C.titulo || '—') + (C.titulo ? ` <span class="mini">${C.titulo.length} caracteres</span>` : '')], ['Descrição', `<div style="white-space:pre-wrap">${esc(C.descricao || '—')}</div>`]])}`)
      } else if (S.aba === 'preco') {
        const pr = C.preco
        painel.innerHTML = pr ? `${kv([['Preço proposto', brl(pr.preco_proposto)], ['Piso (margem mínima)', brl(pr.piso)], ['Margem prevista', pct(pr.margem_prevista_pct)], ['Situação', pr.bloqueios?.length ? badge('bloqueado: ' + pr.bloqueios.join(', '), 'no') : pr.simulacao ? badge('simulação — sem aprovação automática', 'mid') : badge('cálculo com regra e custo vigentes', 'ok')]])}
          ${pr.composicao?.length ? `<h4>Composição</h4><div class="tabela-wrap"><table class="t"><thead><tr><th>Item</th><th class="n">Valor</th><th>Base</th></tr></thead><tbody>${pr.composicao.map(c => `<tr><td>${esc(c.item)}</td><td class="n">${brl(c.valor)}</td><td class="mini">${esc(c.base || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
          <p class="mini">Margem de contribuição estimada, não lucro contábil. Nenhuma alíquota é presumida: tudo vem de regra cadastrada com fonte e validade.</p>` : '<div class="vazio-box"><b>Sem cálculo de preço nesta versão.</b>Cadastre o custo da variante e a regra comercial do canal; sem eles o preço fica bloqueado (não é estimado).</div>'
        const f = el('div', { className: 'of-form' })
        f.append(campo('custo_compra', 'Custo de compra (R$)', { type: 'number', step: '0.01', min: 0 }), campo('frete_entrada', 'Frete de entrada un. (R$)', { type: 'number', step: '0.01', min: 0 }), campo('embalagem', 'Embalagem un. (R$)', { type: 'number', step: '0.01', min: 0 }), campo('preparo', 'Preparo un. (R$)', { type: 'number', step: '0.01', min: 0 }))
        const salvar = botao('Registrar custo da variante', async () => { const por = pedirPor(); if (!por) return; const o = {}; f.querySelectorAll('input').forEach(i => { if (i.value !== '') o[i.name] = Number(i.value) }); if (!j.variante_id) return toast('Este job não tem variante vinculada.', 'erro'); try { await api('/api/ofertas/custos', { cliente, por, custo: { variante_id: j.variante_id, ...o, fonte: 'cadastro manual', inicio_vigencia: new Date().toISOString().slice(0, 10) } }); toast('Custo registrado. Prepare a estratégia de novo para recalcular.', 'ok') } catch (e) { toast(e.message, 'erro') } })
        painel.append(el('h4', { textContent: 'Custos da variante' }), f, el('div', { className: 'linha mt-2' }, salvar))
      } else if (S.aba === 'fotos') {
        const imgs = D.imagens || []
        painel.innerHTML = `<p class="mini">Referência do produto (GATE 0): ${j.referencia_confirmada || j.dados?.referencia_confirmada ? badge('confirmada', 'ok') : badge('pendente — nada é gerado nem publicado sem confirmar', 'mid')}</p>
          ${imgs.length ? `<div class="of-gal">${imgs.map(i => `<figure>${urlOk(i.url) ? `<img src="${esc(i.url)}" alt="" referrerpolicy="no-referrer">` : '<div style="aspect-ratio:1;background:var(--fundo-suave)"></div>'}<figcaption><b>${esc(i.papel || '')}</b> ${badge(i.status || '', TOM(i.status || ''))}<div class="mini">${esc(i.fonte || '')}${i.motivo_reprovacao ? ' · ' + esc(i.motivo_reprovacao) : ''}</div>${['candidata', 'gerada', 'pendente'].includes(i.status) ? `<div class="linha mt-2"><button class="btn btn-mini ok" type="button" data-dec="aprovada" data-img="${esc(i.id)}">Aprovar</button><button class="btn btn-mini no" type="button" data-dec="reprovada" data-img="${esc(i.id)}">Reprovar</button></div>` : ''}</figcaption></figure>`).join('')}</div>` : '<div class="vazio-box"><b>Sem imagens neste job.</b>Confirme a referência do produto e peça a geração; sem provedor configurado a resposta é "pendente", nunca um resultado simulado.</div>'}`
        const acoes = el('div', { className: 'linha mt-4' })
        if (j.variante_id) acoes.append(botao('Confirmar referência do produto', async () => { if (!(await confirmar({ titulo: 'É ESTE o produto? (caixa, botão e pulseira conferem?)', texto: 'As fotos do próprio anúncio viram a referência de fidelidade. Confirme só se tiver certeza.', rotuloOk: 'Sim, é este' }))) return; const por = pedirPor(); if (!por) return; try { await api(`/api/ofertas/variantes/${encodeURIComponent(j.variante_id)}/confirmar-referencia`, { cliente, por, origem_fotos: j.anuncio_id ? [{ origem: 'anuncio', ref: j.anuncio_id }] : [] }); toast('Referência confirmada.', 'ok'); abrirJob(j.id) } catch (e) { toast(e.message, 'erro') } }))
        acoes.append(botao('Gerar imagens (capa)', async () => { const por = pedirPor(); if (!por) return; try { const r = await api('/api/ofertas/imagens/gerar', { cliente, por, job_id: j.id, papel: 'capa', n: 2 }); toast(r.estado === 'pendente' ? `Integração pendente: ${r.motivo || r.pendente || 'provedor de imagens não configurado'}` : `Geração: ${r.estado || 'ok'}`, r.estado === 'pendente' ? 'erro' : 'ok'); abrirJob(j.id) } catch (e) { toast(e.message, 'erro') } }))
        painel.append(acoes)
        painel.querySelectorAll('[data-dec]').forEach(b => b.onclick = async () => { const por = pedirPor(); if (!por) return; const motivo = b.dataset.dec === 'reprovada' ? (prompt('Motivo curto da reprovação (reaproveitado na próxima rodada):') || '').trim() : ''; if (b.dataset.dec === 'reprovada' && !motivo) return; try { await api(`/api/ofertas/imagens/${encodeURIComponent(b.dataset.img)}/decidir`, { cliente, por, status: b.dataset.dec, motivo }); abrirJob(j.id) } catch (e) { toast(e.message, 'erro') } })
      } else if (S.aba === 'estrategia') {
        const dg = D.diagnostico || {}, lentes = dg.lentes || dg
        const nomes = { descoberta: 'Descoberta', clique: 'Clique', conversao: 'Conversão', viabilidade: 'Viabilidade', qualidade: 'Qualidade e fidelidade' }
        const cards = Object.entries(nomes).filter(([k]) => lentes?.[k]).map(([k, t]) => { const l = lentes[k]; return `<div class="cartao"><h5>${t} ${badge(l.severidade || l.sinal || '—', l.severidade === 'alta' ? 'no' : l.severidade === 'media' ? 'mid' : '')}</h5><div class="mini">${esc(l.evidencia || '')}</div>${l.hipotese ? `<div class="mini"><b>Hipótese:</b> ${esc(l.hipotese)}</div>` : ''}</div>` }).join('')
        const mud = D.antes_depois || C.mudancas || []
        const pri = dg.porque_priorizado || dg.prioridade, priTxt = typeof pri === 'string' ? pri : pri ? (pri.texto || pri.motivo || pri.rotulo || Object.entries(pri).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')) : ''
        painel.innerHTML = `${priTxt ? `<p>${esc(priTxt)}</p>` : ''}${cards ? `<h4>Diagnóstico em cinco lentes</h4><div class="of-lente">${cards}</div>` : ''}
          <h4>Mudanças propostas</h4>${mud.length ? `<div class="tabela-wrap"><table class="t of-diff"><thead><tr><th>Campo</th><th>De → para</th><th>Problema → evidência → hipótese</th><th>Métrica · janela</th><th>Confusores</th></tr></thead><tbody>${mud.map(m => `<tr><td><b>${esc(m.campo)}</b></td><td class="mini">${esc(String(m.de ?? '—')).slice(0, 160)} → ${esc(String(m.para ?? '—')).slice(0, 160)}</td><td class="mini">${esc(m.problema || '')}${m.evidencia ? ' · ' + esc(m.evidencia) : ''}${m.hipotese ? ' · <i>' + esc(m.hipotese) + '</i>' : ''}</td><td class="mini">${esc(m.metrica || '')}${m.janela_dias ? ' · ' + esc(m.janela_dias) + ' dias' : ''}</td><td class="mini">${esc((m.confusores || []).join(', '))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio-box"><b>Sem estratégia preparada.</b>Clique em Preparar estratégia na Visão geral: o diagnóstico roda sobre a linha de base e vira uma ação do plano.</div>'}
          ${D.baseline ? `<h4>Linha de base (antes de mexer)</h4>${kv([['Visitas', num(D.baseline.visitas)], ['Unidades', num(D.baseline.unidades ?? D.baseline.vendas_unidades)], ['Receita', brl(D.baseline.receita)], ['Conversão', D.baseline.conversao != null ? pct(D.baseline.conversao) : '—'], ['Preço', brl(D.baseline.preco)], ['Estoque', num(D.baseline.estoque)], ['Capturada em', esc(dt(D.baseline.capturada_em || D.baseline.em))]])}<p class="mini">Ausência de dado não é zero. Comparações depois da publicação informam estoque, preço e campanha; nada é atribuído como causa automaticamente.</p>` : ''}`
      } else if (S.aba === 'aprovacao') {
        const campos = Object.keys(C).filter(k => k !== 'mudancas'), aprov = new Set(P.aprovados || [])
        painel.innerHTML = `${kv([['Versão atual', num(j.proposta_versao)], ['Aprovação', P.aprovacao_valida === false ? badge('a aprovação anterior caducou: a versão mudou', 'mid') : aprov.size ? badge(`${aprov.size} campo(s) aprovados`, 'ok') : badge('nenhum campo aprovado nesta versão', 'mid')]])}
          ${(D.versoes || []).length ? `<h4>Versões</h4><ul class="of-pend">${D.versoes.map(v => `<li>v${esc(v.versao)} · ${esc(dt(v.criado_em))} · ${esc(v.criado_por || '')} · ${esc((v.campos || []).join(', '))}</li>`).join('')}</ul>` : ''}
          ${campos.length ? `<h4>Aprovar campo a campo</h4><div class="linha" id="of_campos">${campos.map(k => `<label class="f-chip" style="cursor:pointer"><input type="checkbox" value="${esc(k)}" ${aprov.has(k) ? 'checked disabled' : 'checked'}> ${esc(k)}</label>`).join('')}</div><p class="mini">Aprovar referencia exatamente esta versão (ficha, imagens, preço e plano). Se qualquer parte mudar, a aprovação é invalidada.</p>` : '<div class="vazio-box"><b>Nada para aprovar ainda.</b>Prepare a estratégia primeiro.</div>'}`
        if (campos.length) painel.append(el('div', { className: 'linha mt-2' }, botao(`Aprovar versão ${j.proposta_versao}`, () => aprovarCampos(painel), true), botao('Reprovar com motivo', () => reprovar())))
      } else if (S.aba === 'publicacao') {
        const pubs = j.publicacoes || D.publicacoes || []
        painel.innerHTML = `<p class="mini">Dry-run por padrão: a pré-visualização mostra o payload e o diff sem gravar nada. "Publicar ao vivo" exige aprovação válida da versão e confirmação explícita; só os campos aprovados vão ao canal; variações irmãs são preservadas.</p>
          ${pubs.length ? `<div class="tabela-wrap"><table class="t"><thead><tr><th>Quando</th><th>Operação</th><th>Versão</th><th>Estado</th><th>Retorno</th></tr></thead><tbody>${pubs.map(p => `<tr><td class="mini">${esc(dt(p.criado_em))}</td><td>${esc(p.operacao || '')}</td><td class="n">${num(p.versao)}</td><td>${badge(p.estado || '', TOM(p.estado || ''))}</td><td class="mini">${esc(p.erro || (p.resposta && typeof p.resposta === 'object' ? (p.resposta.resumo || p.resposta.status || '') : '') || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mini">Nenhuma publicação registrada neste job.</p>'}
          ${j.dados?.ultimo_dry_run ? `<h4>Último dry-run</h4><pre class="of-mono" style="white-space:pre-wrap;max-height:320px;overflow:auto;background:var(--fundo-suave);padding:12px;border-radius:var(--raio-p)">${esc(JSON.stringify(j.dados.ultimo_dry_run, null, 1)).slice(0, 6000)}</pre>` : ''}`
        painel.append(el('div', { className: 'linha mt-2' }, botao('Publicar (pré-visualizar)', () => publicar(false)), botao('Publicar ao vivo', () => publicar(true), ['aprovado_publicar', 'na_fila'].includes(j.estado)), botao('Conferir no canal', () => acaoJob('conferir', {}, 'Conferência'))))
      } else if (S.aba === 'historico') {
        const ev = D.eventos || []
        painel.innerHTML = `${j.dados?.monitoramento ? `<h4>Resultado (antes × depois)</h4>${kv(Object.entries(j.dados.monitoramento).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, esc(String(v))]))}<p class="mini">Associação temporal, não causalidade. Estoque, preço e campanha do período estão declarados acima quando disponíveis.</p>` : ''}
          <h4>Eventos</h4>${ev.length ? `<ul class="of-pend">${ev.map(e => `<li><span class="mini">${esc(dt(e.em))}</span> <b>${esc(e.acao)}</b> <span class="mini">${esc(e.por || '')}</span>${e.detalhes ? `<div class="mini">${esc(typeof e.detalhes === 'string' ? e.detalhes : JSON.stringify(e.detalhes)).slice(0, 300)}</div>` : ''}</li>`).join('')}</ul>` : '<p class="mini">Sem eventos.</p>'}`
        painel.append(el('div', { className: 'linha mt-2' }, botao('Atualizar monitoramento', () => acaoJob('monitorar', {}, 'Monitoramento'), ['publicado_confirmado', 'monitorando'].includes(j.estado))))
      }
      gaveta.replaceChildren(cab, abas, painel)
      async function aprovarCampos(pn) {
        const marcados = pn ? [...pn.querySelectorAll('#of_campos input:checked:not(:disabled)')].map(i => i.value) : Object.keys(C).filter(k => k !== 'mudancas' && !(P.aprovados || []).includes(k))
        if (!marcados.length) return toast('Nenhum campo novo para aprovar.', 'erro')
        if (!(await confirmar({ titulo: `Aprovar a versão ${j.proposta_versao}?`, texto: `Campos: ${marcados.join(', ')}. No modo "publicar após aprovação", a publicação ao vivo começa em seguida, sem outro clique.`, rotuloOk: 'Aprovar' }))) return
        acaoJob('aprovar', { versao: j.proposta_versao, campos: marcados }, 'Aprovação')
      }
      async function reprovar() { const motivo = (prompt('Motivo curto da reprovação (vai para a próxima rodada):') || '').trim(); if (!motivo) return; acaoJob('aprovar', { decisao: 'reprovar', motivo }, 'Reprovação') }
      async function publicar(live) {
        if (live && !(await confirmar({ titulo: 'Publicar AO VIVO no Mercado Livre?', texto: 'Só os campos aprovados desta versão são enviados. Variações irmãs ficam intactas. Depois do envio o sistema confere o que o canal realmente publicou.', rotuloOk: 'Publicar ao vivo', perigo: true }))) return
        acaoJob('publicar', live ? { live: true, confirmar: true } : { live: false }, live ? 'Publicação ao vivo' : 'Pré-visualização')
      }
    }

    cabecalho().then(desenhar)
    return { recarregar: () => { cabecalho(); desenhar() } }
  }
  window.PSOfertas = { montar }
})()
