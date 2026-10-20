// Aba Produtos do /cliente — V3 F2, em SOMBRA (docs/desenho-v3-produto-estoque-financeiro.md § 8.1–8.3). Projeção de GET /api/cliente/produtos: «por anúncio × por produto»,
// estoque contado uma vez, folha do produto (linha de detalhe embaixo, aberta por botão com aria-expanded — sem coluna extra) e a gaveta «Gerenciar mapeamento» (Sugestões | Mapeados | Não mapeados) com
// Juntar / Não é o mesmo / Separar → prévia → nome → confirmar (POST …/juntar|separar com confirmar:true). Nada aqui muda plano, aviso ou texto ao cliente.
// V3 F4: chip «Estoque | Lucro» (#prVisao). Lucro = projeção do financeiro por pedido (receita − tarifas − frete − custo; número só com custo e cobertura ≥ mínimo, senão
// «parcial (x%)» com o motivo no title) + DRE simples do mês (#secDre, GET /api/cliente/dre) com «Não é lucro líquido.». Nada disso muda plano, aviso ou texto ao cliente.
// window.PSProdutos.montar(alvo, cliente). Sem botão primário fixo (o diálogo usa PSRelatorio.ui); valor de KPI sem cor; tudo do servidor passa por esc(); sem emoji.
(() => {
  if (window.PSProdutos) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => (window.PS?.toast ? PS.toast(t, tipo) : alert(t))
  const un = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR'))
  const brl = v => (v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 }))
  // dinheiro em centavos → R$ (só na saída); null = «—» ou «parcial (x%)» com o motivo no title (a tela nunca recalcula nem mostra número abaixo do mínimo)
  const brlc = c => (c == null ? '—' : 'R$ ' + (c / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }))
  const pct = x => `${Math.floor(x * 100 + 1e-9)}%`                       // cobertura sempre para baixo: 79,5% nunca aparece como «80%»
  // a receita que o número cobre, quando é menos que a receita inteira: «sobre R$ 800 (80% da receita)» — lucro, receita líquida e custo nunca lidos contra a receita total
  const sobre = (cob, base) => (cob != null && cob < 1 ? `sobre ${base != null ? brlc(base) + ' ' : ''}(${pct(cob)} da receita)` : '')
  const ouParcial = (v, cob, motivo, fmt = brlc, base = null) => (v != null ? `${fmt(v)}${base != null && sobre(cob, base) ? `<div class="mini">${sobre(cob, base)}</div>` : ''}`
    : `<span title="${esc(motivo || 'sem dado')}">${cob ? `parcial (${pct(cob)})` : '—'}</span>`)
  const impTxt = f => (f?.antes_do_imposto === false ? 'depois do imposto informado' : 'antes do imposto')
  const margemTxt = f => ouParcial(f?.margem_pct, f?.cobertura, f?.motivo, m => `${String(m).replace('.', ',')}%`)
  const dm = d => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '')
  const urlOk = u => (/^https:\/\/[\w.-]*mercadoli[bv]re\.com(\.br)?\//.test(String(u || '')) ? u : '')
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
  const PAGINA = 50
  const SITUACAO = { ruptura: ['ruim', 'ruptura'], hora_de_pedir: ['atencao', 'hora de pedir'], estoque_dividido: ['atencao', 'estoque dividido'], confirmar_estoque: ['amb', 'confirmar estoque'],
    kit_sem_composicao: ['neutro', 'kit sem composição'], estoque_nao_lido: ['neutro', 'estoque não lido'], ok: ['bom', 'ok'] }
  const MODO = { um_pool: 'um estoque', full_e_proprio: 'Full e próprio', espelho_provavel: 'espelho provável', dividido: 'dividido', declarado: 'declarado', nao_lido: 'não lido' }
  const MOTIVO = { up: 'mesmo produto do ML', variacao: 'variação no mesmo produto do ML', inventory: 'mesmo estoque Full', sku: 'mesmo SKU', catalogo: 'mesmo catálogo', manual: 'juntado pela equipe' }
  const FONTE = { stock: 'lido por local', full_inventario: 'inventário Full', anuncio: 'anúncio', anuncio_menos_full: 'anúncio com o Full zerado (premissa)' }
  const selo = p => { const [c, t] = SITUACAO[p.situacao] || ['neutro', p.situacao], full = p.situacao === 'ruptura' && p.efs.some(e => e.ruptura && e.local === 'full') && !p.efs.some(e => e.ruptura && e.local === 'proprio')
    return `<span class="selo ${c}">${esc(full ? 'ruptura no Full' : t)}</span>` }
  const estoqueTxt = p => {
    const loc = l => p.efs.filter(e => e.local === l), soma = l => (loc(l).every(e => e.estoque != null) ? loc(l).reduce((t, e) => t + e.estoque, 0) : null)
    const partes = [['proprio', 'próprio'], ['full', 'Full']].filter(([l]) => loc(l).length).map(([l, r]) => `${r} ${un(soma(l))}`)
    const motivo = p.pools.find(q => q.estoque == null)?.motivo || ''
    return `<span${motivo ? ` title="${esc(motivo)}"` : ''}>${partes.join(' · ') || '—'}</span>`
  }
  function folha(p) {
    const an = p.anuncios.map(a => `<tr><td data-rotulo="Anúncio"><div>${urlOk(a.permalink) ? `<a href="${esc(urlOk(a.permalink))}" target="_blank" rel="noopener">${esc(a.titulo.slice(0, 60))}</a>` : esc(a.titulo.slice(0, 60))}<div class="mini">${esc(a.id)}${a.status === 'paused' ? ' · pausado' : ''}</div></div></td>
      <td data-rotulo="Tipo"><div>${esc(a.tipo)}</div></td><td data-rotulo="Logística"><div>${esc(a.logistica)}</div></td><td data-rotulo="Estoque no ML"><div>${un(a.estoque)}</div></td><td data-rotulo="Vendas 28 d"><div>${un(a.u_28d)}</div></td><td data-rotulo="Receita 28 d"><div>${brl(a.receita_28d)}</div></td></tr>`).join('')
    const loc = p.pools.map(q => `<tr><td data-rotulo="Local"><div>${q.local === 'full' ? 'Full' : 'próprio'}</div></td><td data-rotulo="Quantidade"><div>${q.estoque == null ? `<span title="${esc(q.motivo)}">—</span>` : un(q.estoque)}${q.divergente ? '<div class="mini">anúncios com números diferentes</div>' : ''}</div></td>
      <td data-rotulo="Fonte"><div>${esc(FONTE[q.fonte] || 'não lido')}${q.lido_em ? ` em ${dm(q.lido_em)}` : ''}</div></td><td data-rotulo="Modo"><div>${esc(MODO[p.modo] || p.modo)}</div></td><td data-rotulo="Premissa"><div class="mini">${esc(q.motivo || '')}</div></td></tr>`).join('')
    const fin = p.anuncios.map(a => { const f = a.financeiro || {}; return `<tr><td data-rotulo="Anúncio"><div>${esc(a.titulo.slice(0, 50))}<div class="mini">${esc(a.id)}</div></div></td>
      <td class="num" data-rotulo="Receita 28 d"><div>${brlc(f.receita_c ?? null)}</div></td><td class="num" data-rotulo="Tarifas"><div>${ouParcial(f.taxas_c, f.cobertura_taxas_frete, f.motivo, brlc, f.receita_tf_c)}</div></td>
      <td class="num" data-rotulo="Frete"><div>${ouParcial(f.frete_c, f.cobertura_taxas_frete, f.motivo, brlc, f.receita_tf_c)}</div></td><td class="num" data-rotulo="Custo"><div>${ouParcial(f.custo_c, f.cobertura_custo, f.motivo, brlc, f.custo_receita_c)}</div></td>
      <td class="num" data-rotulo="Lucro"><div>${ouParcial(f.lucro_c, f.cobertura, f.motivo, brlc, f.receita_coberta_c)}${f.margem_pct != null ? `<div class="mini">margem ${margemTxt(f)}, ${impTxt(f)}</div>` : ''}</div></td></tr>` }).join('')
    return `<div class="mt-2">
      <table class="t empilha"><thead><tr><th>Anúncio</th><th>Tipo</th><th>Logística</th><th>Estoque no ML</th><th>Vendas 28 d</th><th>Receita 28 d</th></tr></thead><tbody>${an}</tbody></table>
      <table class="t empilha mt-2"><thead><tr><th>Anúncio</th><th class="num">Receita 28 d</th><th class="num">Tarifas</th><th class="num">Frete</th><th class="num">Custo</th><th class="num">Lucro</th></tr></thead><tbody>${fin}</tbody></table>
      <table class="t empilha mt-2"><thead><tr><th>Local</th><th>Quantidade</th><th>Fonte</th><th>Modo</th><th>Premissa</th></tr></thead><tbody>${loc}</tbody></table>
      ${p.premissas.length ? `<ul class="mini">${p.premissas.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div>`
  }
  // folha do produto numa linha própria embaixo (colspan, sem coluna extra), aberta pelo botão — o mesmo padrão da Folha do anúncio
  const linha = (p, k) => `<tr>
    <td data-rotulo="Produto"><div><b>${esc(p.nome.slice(0, 80))}</b><div class="mini">${p.n_anuncios} anúncio${p.n_anuncios > 1 ? 's' : ''} · ${p.sku ? 'SKU ' + esc(p.sku) : 'sem SKU'}${p.n_anuncios > 1 && p.motivos.length ? ' · ' + esc(p.motivos.map(m => MOTIVO[m] || m).join(', ')) : ''}</div>
      <button class="btn-mini" type="button" data-pr-det aria-expanded="false" aria-controls="pdet-${k}">Ver anúncios e estoque</button></div></td>
    <td data-rotulo="Estoque"><div>${estoqueTxt(p)}</div></td>
    <td data-rotulo="Vende/dia"><div>${p.vel_dia ? p.vel_dia.toLocaleString('pt-BR') : '—'}</div></td>
    <td data-rotulo="Cobertura"><div>${p.cobertura == null ? '—' : `${un(p.cobertura)} d`}${p.cobertura_por_anuncio && p.n_anuncios > 1 ? `<div class="mini">por anúncio: ${un(p.cobertura_por_anuncio.min)}${p.cobertura_por_anuncio.max !== p.cobertura_por_anuncio.min ? `–${un(p.cobertura_por_anuncio.max)}` : ''} d</div>` : ''}</div></td>
    <td data-rotulo="Pedir"><div>${p.pedir ? `${un(p.pedir.conservador)} a ${un(p.pedir.base)} un${p.pedir.quando ? `<div class="mini">${p.pedir.quando.agora ? 'pedir agora' : `até ${dm(p.pedir.quando.data)}`}</div>` : ''}` : '—'}</div></td>
    <td data-rotulo="Situação"><div>${selo(p)}</div></td></tr><tr class="det" id="pdet-${k}" hidden><td colspan="6">${folha(p)}</td></tr>`

  // visão Lucro: mesma linha de detalhe (folha) aberta pelo mesmo botão; 6 colunas
  const linhaLucro = (p, k) => { const f = p.financeiro || {}; return `<tr>
    <td data-rotulo="Produto"><div><b>${esc(p.nome.slice(0, 80))}</b><div class="mini">${p.n_anuncios} anúncio${p.n_anuncios > 1 ? 's' : ''} · ${p.sku ? 'SKU ' + esc(p.sku) : 'sem SKU'}</div>
      <button class="btn-mini" type="button" data-pr-det aria-expanded="false" aria-controls="pdet-${k}">Ver anúncios e estoque</button></div></td>
    <td class="num" data-rotulo="Receita 28 d"><div>${brlc(f.receita_c ?? null)}</div></td>
    <td class="num" data-rotulo="Taxas e frete"><div>${ouParcial(f.taxas_frete_c, f.cobertura_taxas_frete, f.motivo, brlc, f.receita_tf_c)}</div></td>
    <td class="num" data-rotulo="Custo"><div>${ouParcial(f.custo_c, f.cobertura_custo, f.motivo, brlc, f.custo_receita_c)}</div></td>
    <td class="num" data-rotulo="Lucro"><div>${ouParcial(f.lucro_c, f.cobertura, f.motivo, brlc, f.receita_coberta_c)}</div></td>
    <td class="num" data-rotulo="Margem"><div>${margemTxt(f)}${f.margem_pct != null ? `<div class="mini">${impTxt(f)}</div>` : ''}${f.margem_pos_ads_pct != null ? `<div class="mini">depois de Ads ${String(f.margem_pos_ads_pct).replace('.', ',')}%</div>` : ''}</div></td></tr><tr class="det" id="pdet-${k}" hidden><td colspan="6">${folha(p)}</td></tr>` }

  // DRE simples do mês (GET /api/cliente/dre): 3 colunas; mês pelo seletor nativo; rodapé fixo «Não é lucro líquido.»
  async function dre(caixa, cliente, mes) {
    caixa.innerHTML = '<div class="skeleton sk-tabela"></div>'
    let d
    try { d = await api(`/api/cliente/dre?cliente=${encodeURIComponent(cliente)}&mes=${encodeURIComponent(mes)}`) } catch (e) { caixa.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return }
    if (!d.disponivel) { caixa.innerHTML = `<div class="vazio-box">${esc(d.motivo || 'sem dado')}</div>`; return }
    caixa.innerHTML = `${d.parcial ? `<div class="aviso">Parcial: ${d.parcial.dias_sem_linhas} de ${d.parcial.dias} dias do mês sem linhas de pedido (nada é extrapolado).</div>` : ''}
      <div class="tabela-wrap"><table class="t empilha" id="tabDre"><thead><tr><th>Linha</th><th class="num">Valor</th><th>Observação</th></tr></thead><tbody>${d.linhas.map(l => `<tr><td data-rotulo="Linha"><div>${l.chave === 'margem' || l.chave === 'receita_liquida' ? `<b>${esc(l.rotulo)}</b>` : esc(l.rotulo)}</div></td>
        <td class="num" data-rotulo="Valor"><div>${l.chave === 'margem' ? ouParcial(l.valor_c, l.cobertura, l.nota) : brlc(l.valor_c)}</div></td><td data-rotulo="Observação"><div class="mini">${esc([l.cobertura != null && l.chave !== 'margem' ? `${pct(l.cobertura)} da receita` : '', l.nota].filter(Boolean).join(' · '))}</div></td></tr>`).join('')}</tbody></table></div>
      <p class="mini"><b>${esc(d.rodape)}</b> Fora: ${esc(d.fora.join('; '))}.</p>`
  }

  async function montar(alvo, cliente) {
    if (!alvo) return
    alvo.innerHTML = '<div class="skeleton sk-tabela"></div>'
    let r
    try { r = await api('/api/cliente/produtos?cliente=' + encodeURIComponent(cliente)) } catch (e) {
      alvo.innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b><div>${esc(e.message)}</div><button class="btn btn-p" type="button" data-denovo>Tentar de novo</button></div>`
      alvo.querySelector('[data-denovo]').onclick = () => montar(alvo, cliente); return
    }
    if (!r.disponivel) { alvo.innerHTML = `<div class="vazio-box"><b>Sem produtos para mostrar.</b> ${esc(r.motivo || '')}</div>`; return }
    const s = r.resumo, e = r.sombra.estoque, fc = r.financeiro?.conta || {}
    let limite = PAGINA, visao = 'estoque'
    alvo.innerHTML = `<p class="veredito-frase">${un(s.anuncios_ativos)} anúncios ativos são <b>${un(s.produtos)} produtos</b> · ${un(s.estoque_dividido)} com estoque dividido · ${un(s.kits_sem_composicao)} kits sem composição</p>
      <div class="seg" id="prVisao" role="group" aria-label="Visão da tabela"><button type="button" data-visao="estoque" aria-pressed="true">Estoque</button><button type="button" data-visao="lucro" aria-pressed="false">Lucro</button></div>
      <div data-so="estoque"><div class="aviso info" id="prSombra"><span class="selo ${r.sombra_ligada ? 'bom' : 'neutro'}" id="prSeloF3">${r.sombra_ligada ? 'diagnóstico por produto ligado' : 'diagnóstico por produto desligado (sombra)'}</span> Comparativo por anúncio × por produto. Somando por anúncio (ativos e pausados): ${un(e.soma_por_anuncio)} un · contado uma vez: ${un(e.contado_uma_vez)} un${e.em_pausados ? ` (${un(e.em_pausados)} un em anúncios pausados)` : ''}${e.produtos_sem_leitura ? ` · ${un(e.produtos_sem_leitura)} produto(s) sem estoque lido` : ''}.
        Por anúncio, ${un(r.sombra.ruptura.anuncios)} em ruptura e ${un(r.sombra.compras.linhas_por_anuncio)} linhas de compra; por produto, ${un(r.sombra.ruptura.efs)} e ${un(r.sombra.compras.linhas_por_produto)}. ${r.sombra_ligada ? 'O plano, os avisos e os textos ao cliente já usam o estoque por produto.' : 'Nada disso muda o plano, os avisos ou os textos ao cliente até a conferência.'}</div>
      <div class="kpis">${kp('Produtos', un(s.produtos), `${un(s.agrupados)} com 2 ou mais anúncios`)}${kp('Estoque contado uma vez', `${un(s.estoque_contado)} un`, 'Full e próprio, sem dupla contagem')}${kp('Capital em estoque', s.capital ? brl(s.capital.valor) : '—', s.capital ? `custo informado em ${un(s.capital.com_custo)} de ${un(s.capital.total)} produtos` : 'sem custo informado')}${kp('Produtos em ruptura', un(s.produtos_em_ruptura), 'pelo estoque do produto')}</div></div>
      <div data-so="lucro" hidden>
        <div class="aviso info" id="prLucroNota">Vendas pagas de ${dm(r.financeiro?.de)} a ${dm(r.financeiro?.ate)}: receita menos tarifas do ML, frete pago pelo vendedor e custo informado. ${un(r.financeiro?.dias?.com_linhas)} de ${un(r.financeiro?.dias?.total)} dias com linhas de pedido; ${un(r.financeiro?.envios?.lidos)} de ${un(r.financeiro?.envios?.total)} envios com frete lido. Número só com custo e ${pct(r.financeiro?.minimo ?? 0.8)} da receita coberta. Não é lucro líquido.</div>
        <div class="kpis">${kp('Receita 28 d', brlc(fc.receita_c ?? null), fc.receita_sem_linhas_c ? 'pedidos pagos; nos dias ainda sem linhas de pedido, a série (cancelado depois de 2 dias pode estar dentro)' : 'pedidos pagos (cancelados fora)')}${kp('Receita líquida de taxas e frete', ouParcial(fc.receita_liquida_c, fc.cobertura_taxas_frete, fc.motivo), ['existe sem custo', fc.receita_liquida_c != null && sobre(fc.cobertura_taxas_frete, fc.receita_tf_c)].filter(Boolean).join(' · '))}${kp('Lucro de contribuição', ouParcial(fc.lucro_c, fc.cobertura, fc.motivo), [impTxt(fc), fc.lucro_c != null && sobre(fc.cobertura, fc.receita_coberta_c)].filter(Boolean).join(' · '))}${kp('Margem', margemTxt(fc), `sobre a receita coberta, ${impTxt(fc)}`)}</div>
      </div>
      <div class="mt-2"><button class="btn" type="button" id="btnMapeamento">Gerenciar mapeamento</button><button class="btn" type="button" id="btnAtualizarEstoque" title="Lê no Mercado Livre o estoque por local dos produtos desta página (só leitura, com teto por dia)">Atualizar estoque</button></div>
      ${r.data_quality.nota ? `<div class="aviso">${esc(r.data_quality.nota)}</div>` : ''}
      <div class="tabela-wrap"><table class="t empilha" id="tabProdutos"><thead></thead><tbody></tbody></table></div>
      <div id="prMais"></div>
      <section class="mt-2" id="secDre" data-so="lucro" hidden><div class="bloco-cab"><h3>DRE do mês</h3><label class="mini">Mês <input type="month" id="dreMes" value="${esc(String(r.hoje || '').slice(0, 7))}"></label></div><div id="dreCorpo"></div></section>
      <details class="recolhido mt-2"><summary>Premissas</summary><ul class="mini">${[...r.premissas, ...(r.financeiro?.premissas || [])].map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
      <details class="recolhido mt-2" id="secSyncEstoque"><summary>Sincronismo de estoque (Chaveiro) — prévia</summary><div id="syncCorpo"></div></details>
      <aside class="gaveta" id="gavMapeamento" hidden aria-label="Gerenciar mapeamento"></aside>`
    const corpo = alvo.querySelector('#tabProdutos tbody'), cab = alvo.querySelector('#tabProdutos thead'), mais = alvo.querySelector('#prMais')
    // V3 F6: prévia do sincronismo (só leitura, POST /api/chaveiro/estoque/previa) — carrega ao abrir; sem botão novo; executar é do líder pela rota com confirmar
    alvo.querySelector('#secSyncEstoque').addEventListener('toggle', e => { if (e.currentTarget.open) syncPrevia(alvo.querySelector('#syncCorpo'), cliente) })
    const CAB = { estoque: ['Produto', 'Estoque', 'Vende/dia', 'Cobertura', 'Pedir', 'Situação'], lucro: ['Produto', 'Receita 28 d', 'Taxas e frete', 'Custo', 'Lucro', 'Margem'] }
    const pintar = () => {
      cab.innerHTML = `<tr>${CAB[visao].map((t, k) => `<th${visao === 'lucro' && k ? ' class="num"' : ''}>${t}</th>`).join('')}</tr>`
      corpo.innerHTML = r.produtos.slice(0, limite).map(visao === 'lucro' ? linhaLucro : linha).join('') || '<tr><td colspan="6">Nenhum produto ativo.</td></tr>'
      corpo.querySelectorAll('[data-pr-det]').forEach(b => { b.onclick = () => { const d = document.getElementById(b.getAttribute('aria-controls')); if (!d) return; d.hidden = !d.hidden; b.setAttribute('aria-expanded', String(!d.hidden)); b.textContent = d.hidden ? 'Ver anúncios e estoque' : 'Fechar' } })
      mais.innerHTML = r.produtos.length > limite ? `<button class="btn btn-p mt-2" type="button">Mostrar mais (${un(r.produtos.length - limite)})</button>` : ''
      mais.querySelector('button')?.addEventListener('click', () => { limite += PAGINA; pintar() })
    }
    pintar()
    const mesI = alvo.querySelector('#dreMes'), dreCx = alvo.querySelector('#dreCorpo')
    mesI.onchange = () => { if (/^\d{4}-\d{2}$/.test(mesI.value)) dre(dreCx, cliente, mesI.value) }
    alvo.querySelectorAll('[data-visao]').forEach(b => { b.onclick = () => {
      visao = b.dataset.visao
      alvo.querySelectorAll('[data-visao]').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
      alvo.querySelectorAll('[data-so]').forEach(x => { x.hidden = x.dataset.so !== visao })
      pintar()
      if (visao === 'lucro' && !dreCx.childElementCount) dre(dreCx, cliente, mesI.value)
    } })
    // depois de juntar/separar a aba inteira é redesenhada (a gaveta mora nela) e reabre já com o mapeamento novo
    const reabrir = async () => { await montar(alvo, cliente); gaveta(alvo.querySelector('#gavMapeamento'), cliente, reabrir) }
    alvo.querySelector('#btnMapeamento').onclick = () => gaveta(alvo.querySelector('#gavMapeamento'), cliente, reabrir)
    alvo.querySelector('#btnAtualizarEstoque').onclick = async ev => {
      const b = ev.currentTarget, produtos = r.produtos.slice(0, Math.min(limite, PAGINA)).map(p => p.chave)
      b.disabled = true
      try {
        const pv = await api('/api/cliente/produtos/estoque/atualizar', { cliente, produtos })
        if (!pv.ups) { toast('Nenhum produto desta página tem leitura por local a fazer.'); return }
        const U = window.PSRelatorio?.ui
        if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
        const por = await U.pedirPor({ titulo: 'Ler o estoque por local?', texto: `Lê no Mercado Livre o estoque de ${pv.ups} produto(s) do ML (só leitura, cerca de 1 por segundo). Restam ${pv.teto_restante} leituras hoje para este cliente.`, rotuloOk: 'Ler agora' })
        if (!por) return
        const x = await api('/api/cliente/produtos/estoque/atualizar', { cliente, produtos, por, confirmar: true })
        toast(`${x.lidos} lido(s)${x.falhas ? `, ${x.falhas} falha(s) (o estoque anterior segue valendo até vencer)` : ''}${x.pulados ? `, ${x.pulados} para amanhã (teto do dia)` : ''}.`, x.falhas ? 'erro' : 'ok')
        montar(alvo, cliente)
      } catch (err) { toast(err.message, 'erro') } finally { b.disabled = false }
    }
  }

  // ── V3 F6: prévia do sincronismo de estoque do Chaveiro — o que seria escrito, por anúncio (6 colunas). Nada é escrito daqui.
  const SIT_SYNC = { escreveria: ['atencao', 'escreveria'], sem_mudanca: ['bom', 'já no alvo'], fisico_vencido: ['neutro', 'físico vencido'], sem_fisico: ['neutro', 'sem físico'], divergente: ['ruim', 'contar o estoque'], sem_pool: ['neutro', 'sem estoque próprio'], nao_escrever: ['neutro', 'não escrever'] }
  async function syncPrevia(caixa, cliente) {
    caixa.innerHTML = '<div class="skeleton sk-tabela"></div>'
    let p
    try { p = await api('/api/chaveiro/estoque/previa', { cliente }) } catch (e) { caixa.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return }
    const est = p.parado ? 'parado (botão de emergência)' : !p.ligado ? 'desligado (chave global)' : p.politica?.ml_estoque ? `ligado para este cliente (${esc((p.politica.produtos || []).join(', '))})` : 'cliente não liberado'
    if (!p.produtos.length) { caixa.innerHTML = `<p class="mini">Sincronismo: ${est}. Nenhum produto com estoque físico informado — o sincronismo só escreve a partir do físico (nunca do número do anúncio).</p>`; return }
    const sel = s => { const [c, t] = SIT_SYNC[s] || ['neutro', s]; return `<span class="selo ${c}">${esc(t)}</span>` }
    caixa.innerHTML = `<p class="mini">Sincronismo: ${est}. Prévia: nada foi escrito.</p>
      <div class="tabela-wrap"><table class="t empilha" id="tabSyncEstoque"><thead><tr><th>Anúncio</th><th>Produto (SKU)</th><th class="num">Hoje no ML</th><th class="num">Seria escrito</th><th>Escrita</th><th>Situação</th></tr></thead><tbody>${p.linhas.map(l => `<tr>
        <td data-rotulo="Anúncio"><div>${esc(String(l.titulo).slice(0, 60))}<div class="mini">${esc(l.anuncio)}${l.variacao ? ' · variação ' + esc(l.variacao) : ''}</div></div></td><td data-rotulo="Produto (SKU)"><div>${esc(l.sku)}</div></td>
        <td class="num" data-rotulo="Hoje no ML"><div>${un(l.de)}</div></td><td class="num" data-rotulo="Seria escrito"><div>${un(l.para)}</div></td>
        <td data-rotulo="Escrita"><div class="mini">${l.escrita === 'replica' ? 'o ML replica (mesmo produto)' : 'escreve'}</div></td><td data-rotulo="Situação"><div>${sel(l.situacao)}</div></td></tr>`).join('')}</tbody></table></div>
      <ul class="mini">${p.produtos.map(x => `<li>${esc(x.sku)}: físico ${un(x.fisico.fisico)} un (informado ${un(x.fisico.informado)}, ${un(x.fisico.deduzido)} vendidas desde então), segurança ${un(x.seguranca)} un · ${esc(x.motivos.join(' · '))}</li>`).join('')}</ul>
      <details class="recolhido"><summary>Premissas</summary><ul class="mini">${p.premissas.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`
  }

  // ── gaveta «Gerenciar mapeamento» (molde UpSeller): sugestão nunca junta; Juntar / Não é o mesmo / Separar → prévia → nome → confirmar ──
  async function gaveta(g, cliente, aoMudar) {
    g.hidden = false
    g.innerHTML = '<div class="skeleton sk-tabela"></div>'
    let m
    try { m = await api('/api/cliente/produtos/mapeamento?cliente=' + encodeURIComponent(cliente)) } catch (e) { g.innerHTML = `<div class="aviso erro">${esc(e.message)}</div><button class="btn" type="button" data-fechar>Fechar</button>`; g.querySelector('[data-fechar]').onclick = () => { g.hidden = true }; return }
    let aba = 'sugestoes'
    const ABAS = [['sugestoes', `Sugestões (${m.totais.sugestoes})`], ['mapeados', `Mapeados (${m.totais.mapeados})`], ['nao', `Não mapeados (${m.totais.nao_mapeados})`]]
    const lista = () => aba === 'sugestoes'
      ? (m.sugestoes.map((s, k) => `<li class="mt-2"><b>${esc(s.motivo)}</b><div class="mini">${esc(String(s.de).slice(0, 70))} → ${esc(String(s.para).slice(0, 70))}</div>
          ${s.tipo === 'kit' ? '' : `<button class="btn btn-mini" type="button" data-juntar="${k}">Juntar</button> `}<button class="btn btn-mini" type="button" data-recusar="${k}">Não é o mesmo</button></li>`).join('') || '<li>Nenhuma sugestão agora.</li>')
      : aba === 'mapeados'
        ? (m.mapeados.map(p => `<li class="mt-2"><b>${esc(p.nome.slice(0, 70))}</b> <span class="mini">${p.n_anuncios} anúncios · ${esc(p.motivos.map(x => MOTIVO[x] || x).join(', '))}</span>
            <ul>${p.origens.map(o => `<li class="mini">${esc(o.anuncios.map(a => a.id).join(', '))}${o.manual ? ' · juntado pela equipe' : ''}${p.origens.length > 1 ? ` <button class="btn btn-mini" type="button" data-separar="${esc(o.origem)}" data-produto="${esc(p.alvo)}">Separar</button>` : ''}</li>`).join('')}</ul></li>`).join('') || '<li>Nenhum produto com 2 ou mais anúncios.</li>')
        : (m.nao_mapeados.map(p => `<li class="mini">${esc(p.nome.slice(0, 80))}</li>`).join('') || '<li>Nada.</li>') + (m.totais.nao_mapeados > m.nao_mapeados.length ? `<li class="mini">e mais ${un(m.totais.nao_mapeados - m.nao_mapeados.length)}</li>` : '')
    const pintar = () => {
      g.innerHTML = `<div class="bloco-cab"><h2>Gerenciar mapeamento</h2><button class="btn btn-p" type="button" data-fechar>Fechar</button></div>
        <p class="sub">Anúncios do mesmo produto juntam sozinhos pelo produto do Mercado Livre, pelo estoque Full, pelo SKU e pelo catálogo. Aqui ficam as sugestões (nunca juntam sozinhas) e as correções da equipe.</p>
        <div class="seg">${ABAS.map(([k, t]) => `<button type="button" data-aba-map="${k}" aria-pressed="${k === aba}">${esc(t)}</button>`).join('')}</div><ul>${lista()}</ul>`
      const x = g.querySelector('[data-fechar]'); x.onclick = () => { g.hidden = true }; x.focus()
      g.onkeydown = e => { if (e.key === 'Escape') g.hidden = true }
      g.querySelectorAll('[data-aba-map]').forEach(b => { b.onclick = () => { aba = b.dataset.abaMap; pintar() } })
      g.querySelectorAll('[data-juntar]').forEach(b => { b.onclick = () => decidir('juntar', cliente, m.sugestoes[b.dataset.juntar], aoMudar) })
      g.querySelectorAll('[data-recusar]').forEach(b => { b.onclick = () => decidir('separar', cliente, m.sugestoes[b.dataset.recusar], aoMudar) })
      g.querySelectorAll('[data-separar]').forEach(b => { b.onclick = () => decidir('separar', cliente, { origem: b.dataset.separar, produto: b.dataset.produto }, aoMudar) })
    }
    pintar()
  }
  async function decidir(acao, cliente, s, aoMudar) {
    const U = window.PSRelatorio?.ui
    if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(acao === 'juntar' ? 'Juntar ao produto' : 'Não é o mesmo produto')
    corpo.innerHTML = '<div class="mini">Calculando a prévia…</div>'
    let pv
    try { pv = await api(`/api/cliente/produtos/${acao}`, { cliente, origem: s.origem, produto: s.produto }) } catch (e) { corpo.innerHTML = U.aviso('erro', esc(e.message)); rodape.append(U.botao('Fechar', { aoClicar: fechar })); return }
    const desc = x => `${x.n_anuncios} anúncio${x.n_anuncios > 1 ? 's' : ''}: ${esc(x.anuncios.map(a => a.titulo.slice(0, 40)).join(' · '))}`
    corpo.innerHTML = `<p>${acao === 'juntar' ? 'Passa a contar o estoque uma vez e somar as vendas destes anúncios.' : 'Estes anúncios nunca mais se juntam automaticamente a este produto.'}</p>
      <p class="mini"><b>Hoje:</b> ${desc(pv.antes)}</p><p class="mini"><b>Depois:</b> ${desc(pv.depois)}</p>${pv.mudou ? '' : U.aviso('', 'Nada muda no agrupamento de hoje.')}${U.campoPor('prPor')}<div id="prResp"></div>`
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), U.botao(acao === 'juntar' ? 'Juntar' : 'Confirmar', { primario: true, aoClicar: async ev => {
      const por = U.lerPor(corpo, 'prPor'), resp = corpo.querySelector('#prResp')
      if (!por) { resp.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(por); ev.currentTarget.disabled = true
      try { await api(`/api/cliente/produtos/${acao}`, { cliente, origem: s.origem, produto: s.produto, por, confirmar: true }); toast(acao === 'juntar' ? 'Anúncios juntados ao produto.' : 'Separação registrada.'); fechar(); aoMudar?.() }
      catch (e) { resp.innerHTML = U.aviso('erro', esc(e.message)); ev.currentTarget.disabled = false }
    } }))
  }
  window.PSProdutos = { montar }
})()
