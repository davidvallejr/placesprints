// Aba Executar do /cliente — console único do Chaveiro F4+ (src/lib/chaveiro-executor(-real).js, src/rotas-chaveiro-executor.js). Por que uma aba própria e não dentro de
// Anúncios/Produtos: executar é um fluxo com estado (selecionar → estratégia → prévia → preparar → aprovar → executar → conferir → reverter) que atravessa anúncios e operações;
// Anúncios e Produtos são leitura e já têm 4 seções cada. O Resumo continua com a cobertura (#secChaveiro) e o botão «Executar pelo Chaveiro» abre esta aba já preenchida.
// window.PSExecutar.montar(alvo, cliente, preset?). Sem botão primário fixo (o primário só existe dentro do diálogo de confirmação, via PSRelatorio.ui); tabelas ≤ 6 colunas;
// KPI sem cor; tudo do servidor passa por esc(); sem emoji; nada é escrito sem o diálogo + confirmar === true + as travas do servidor.
(() => {
  if (window.PSExecutar) return
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const api = async (url, body) => {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
    return j
  }
  const toast = (t, tipo) => (window.PS?.toast ? PS.toast(t, tipo) : alert(t))
  const brl = v => (v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  const quando = iso => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
  const val = v => (v == null ? '—' : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x ?? '—'}`).join(' · ') : String(v))
  const kp = (rot, v, det) => `<div class="kpi"><div class="rotulo">${rot}</div><div class="valor">${v}</div><div class="detalhe">${det}</div></div>`
  const SELO = { preparada: 'neutro', aprovada: 'azul', enviada: 'atencao', conferida: 'bom', divergente: 'ruim', falhou: 'ruim', recusada: 'atencao', cancelada: 'neutro', obsoleta: 'neutro', revertida: 'amb' }
  const SIT = { pronto: ['bom', 'pronto'], assistido: ['azul', 'assistido'], bloqueado: ['atencao', 'bloqueado'], pulado: ['neutro', 'pulado'] }
  let st = { cliente: '', painel: null, anuncios: [], sel: new Set(), preset: null }

  function campoParam(nome, d, alvoId) {
    const id = `exP_${nome}`, rot = esc(d.rotulo || nome), a = st.anuncios.find(x => st.sel.size === 1 && st.sel.has(x.item_id))
    if (d.tipo === 'bool') return `<label class="campo"><span class="pf-rot">${rot}</span><input type="checkbox" id="${id}" data-param="${esc(nome)}" data-tipo="bool"></label>`
    if (d.tipo === 'escolha') return `<label class="campo"><span class="pf-rot">${rot}</span><select id="${id}" data-param="${esc(nome)}" data-tipo="texto"><option value="">—</option>${d.opcoes.map(o => `<option>${esc(o)}</option>`).join('')}</select></label>`
    if (d.tipo === 'foto' && a?.fotos?.length) return `<label class="campo"><span class="pf-rot">${rot}</span><select id="${id}" data-param="${esc(nome)}" data-tipo="texto"><option value="">—</option>${a.fotos.map((f, i) => `<option value="${esc(f)}">foto ${i + 1}${i === 0 ? ' (capa atual)' : ''}</option>`).join('')}</select></label>`
    if (d.tipo === 'snapshot' && a?.snapshots?.length) return `<label class="campo"><span class="pf-rot">${rot}</span><select id="${id}" data-param="${esc(nome)}" data-tipo="texto"><option value="">—</option>${a.snapshots.map(s => `<option value="${esc(s.hash)}">${esc(quando(s.capturado_em))} · ${esc(String(s.titulo || '').slice(0, 40))} · ${esc(brl(s.preco))}</option>`).join('')}</select></label>`
    if (d.tipo === 'atributos') return `<label class="campo"><span class="pf-rot">${rot} — uma linha por atributo: ID=valor</span><textarea id="${id}" data-param="${esc(nome)}" data-tipo="atributos" rows="3"></textarea></label>`
    if (d.tipo === 'fotos') return ''
    const num = ['numero', 'inteiro'].includes(d.tipo)
    return `<label class="campo"><span class="pf-rot">${rot}${(d.tipo === 'foto' || d.tipo === 'snapshot') ? ' (escolha 1 anúncio para listar)' : ''}</span><input id="${id}" data-param="${esc(nome)}" data-tipo="${num ? (d.tipo === 'inteiro' ? 'inteiro' : 'numero') : 'texto'}" ${num ? `type="number" step="${d.tipo === 'inteiro' ? 1 : 'any'}"${d.min != null ? ` min="${d.min}"` : ''}${d.max != null ? ` max="${d.max}"` : ''}${d.padrao != null ? ` value="${d.padrao}"` : ''}` : 'type="text" maxlength="200"'}></label>`
  }
  const lerParams = raiz => {
    const out = {}
    raiz.querySelectorAll('[data-param]').forEach(el => {
      const k = el.dataset.param, t = el.dataset.tipo
      if (t === 'bool') { if (el.checked) out[k] = true; return }
      const v = el.value.trim(); if (!v) return
      if (t === 'numero') out[k] = Number(v.replace(',', '.'))
      else if (t === 'inteiro') out[k] = parseInt(v, 10)
      else if (t === 'atributos') out[k] = v.split('\n').map(l => l.split('=')).filter(p => p.length >= 2).map(([id, ...r]) => ({ id: id.trim(), valor: r.join('=').trim() }))
      else out[k] = v
    })
    return out
  }
  // o que fazer: estratégia (catálogo + próprias) ou operação avulsa; o formulário dos parâmetros vem da definição do servidor
  function pintarParams(alvo) {
    const sel = alvo.querySelector('#exOque'), caixa = alvo.querySelector('#exParams'), v = sel.value
    if (v.startsWith('e:')) { const e = st.painel.estrategias.find(x => x.id === v.slice(2)); caixa.innerHTML = e ? `<p class="mini">${esc(e.objetivo || '')} KPI: ${esc(e.kpi)} em ${esc(e.janela_dias)} dias${e.holdout ? ' · original fica como grupo de comparação' : ''}.</p><div class="form-grade">${Object.entries(e.parametros || {}).map(([k, d]) => campoParam(k, d)).join('')}</div>` : '' }
    else if (v.startsWith('o:')) { const o = st.painel.operacoes.find(x => x.operacao === v.slice(2)); caixa.innerHTML = o ? `<p class="mini">${esc(o.escrita === 'assistido' ? 'Assistido: o sistema prepara o passo a passo, a aplicação é humana.' : o.escrita === 'delegado' ? 'Delegado ao executor de Promoções (as travas dele valem).' : 'O sistema aplica com aprovação, releitura ao vivo e conferência.')} Documentação: ${esc(o.doc)}.</p><div class="form-grade">${Object.entries(o.params || {}).map(([k, d]) => campoParam(k, d)).join('')}</div>` : '' }
    else caixa.innerHTML = ''
    if (st.preset?.params) for (const [k, x] of Object.entries(st.preset.params)) { const el = caixa.querySelector(`[data-param="${k}"]`); if (el) el.type === 'checkbox' ? (el.checked = x === true) : (el.value = x) }
  }
  const pedido = alvo => {
    const v = alvo.querySelector('#exOque').value, params = lerParams(alvo.querySelector('#exParams'))
    return { cliente: st.cliente, itens: [...st.sel], ...(v.startsWith('e:') ? { estrategia: v.slice(2), valores: params } : { operacao: v.slice(2), params }), acao_id: st.preset?.acao_id || '' }
  }

  function pintarAnuncios(alvo) {
    const q = (alvo.querySelector('#exBusca')?.value || '').trim().toLowerCase()
    const l = st.anuncios.filter(a => !q || a.item_id.toLowerCase().includes(q) || String(a.titulo).toLowerCase().includes(q))
    alvo.querySelector('#exAnuncios').innerHTML = l.length ? `<div class="tabela-wrap"><table class="t empilha" id="exTabAnuncios"><caption class="sr">Anúncios para executar</caption><thead><tr><th scope="col">Selecionar</th><th scope="col">Anúncio</th><th scope="col" class="num">Preço</th><th scope="col">Status</th><th scope="col" class="num">Receita 28 d</th><th scope="col">Catálogo</th></tr></thead><tbody>${l.map(a => `<tr>
      <td data-rotulo="Selecionar"><input type="checkbox" data-sel="${esc(a.item_id)}" aria-label="selecionar ${esc(a.item_id)}"${st.sel.has(a.item_id) ? ' checked' : ''}></td>
      <td data-rotulo="Anúncio"><div>${esc(String(a.titulo).slice(0, 60))}<div class="mini">${esc(a.item_id)}</div></div></td><td class="num" data-rotulo="Preço">${brl(a.preco)}</td>
      <td data-rotulo="Status">${esc(a.status)}</td><td class="num" data-rotulo="Receita 28 d">${brl(a.r28)}</td><td data-rotulo="Catálogo">${a.catalogo ? 'sim' : 'não'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio-box">Nenhum anúncio ativo ou pausado com este filtro.</div>'
    alvo.querySelectorAll('[data-sel]').forEach(c => { c.onchange = () => { c.checked ? st.sel.add(c.dataset.sel) : st.sel.delete(c.dataset.sel); alvo.querySelector('#exNSel').textContent = `${st.sel.size} selecionado(s)`; pintarParams(alvo) } })
    alvo.querySelector('#exNSel').textContent = `${st.sel.size} selecionado(s)`
  }

  function pintarPrevia(alvo, r) {
    const linhas = r.anuncios.flatMap(a => a.passos.map(p => ({ a, p })))
    alvo.querySelector('#exPreviaRes').innerHTML = `${r.estrategia ? `<p class="mini">Estratégia ${esc(r.estrategia.nome)} · KPI ${esc(r.estrategia.kpi)} · janela ${esc(r.estrategia.janela_dias)} dias</p>` : ''}
      <div class="tabela-wrap"><table class="t empilha" id="exTabPrevia"><caption class="sr">Prévia campo a campo</caption><thead><tr><th scope="col">Anúncio</th><th scope="col">Operação</th><th scope="col">De → para</th><th scope="col">Situação</th><th scope="col">Previsão (Oráculo)</th><th scope="col">O que será medido</th></tr></thead><tbody>${linhas.map(({ a, p }) => {
        const [c, t] = SIT[p.situacao] || ['neutro', p.situacao], o = p.oraculo || {}
        return `<tr><td data-rotulo="Anúncio"><div>${esc(String(a.titulo || a.item_id).slice(0, 50))}<div class="mini">${esc(a.item_id)}${a.precondicoes && !a.precondicoes.ok ? ` · pré-condição: ${esc(a.precondicoes.falhas.map(f => f.motivo).join('; '))}` : ''}${a.aviso_medicao ? ` · ${esc(a.aviso_medicao)}` : ''}</div></div></td>
          <td data-rotulo="Operação">${esc(p.rotulo || p.operacao)}${r.estrategia ? `<div class="mini">passo ${esc(p.passo)}</div>` : ''}</td>
          <td data-rotulo="De → para"><div>${(p.diff || []).map(d => `${esc(d.campo)}: ${esc(val(d.de))} → <b>${esc(val(d.para))}</b>`).join('<br>') || '—'}${(p.passo_a_passo || []).length ? `<ol class="mini">${p.passo_a_passo.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}</div></td>
          <td data-rotulo="Situação"><span class="selo ${c}">${esc(t)}</span>${(p.bloqueios || []).length ? `<div class="mini">${esc(p.bloqueios.join('; '))}</div>` : ''}${(p.avisos || []).length ? `<div class="mini">${esc(p.avisos.join('; '))}</div>` : ''}</td>
          <td data-rotulo="Previsão (Oráculo)"><div class="mini">${o.faixa ? `receita ${esc(brl(o.faixa.conservador))} a ${esc(brl(o.faixa.otimista))} em ${esc(o.horizonte_dias)} d (hipótese)` : esc(o.nota || '—')}${o.chance ? `<br>chance ${Math.round(o.chance.p * 100)}% · ${esc(o.chance.fonte)}` : ''}</div></td>
          <td data-rotulo="O que será medido"><div class="mini">${esc(p.medicao || '')}</div></td></tr>` }).join('')}</tbody></table></div><p class="mini">${esc(r.nota)}</p>`
  }

  function dialogoAcao({ titulo, texto, rotulo, enviar }) {
    const U = window.PSRelatorio?.ui; if (!U) { toast('Recarregue a página: o módulo de diálogos não carregou.', 'erro'); return }
    const { corpo, rodape, fechar } = U.dialogo(titulo)
    corpo.innerHTML = `${texto}${U.campoPor('exPor')}<div id="exResp"></div>`
    rodape.append(U.botao('Cancelar', { aoClicar: fechar }), U.botao(rotulo, { primario: true, aoClicar: async ev => {
      const por = U.lerPor(corpo, 'exPor'), resp = corpo.querySelector('#exResp')
      if (!por) { resp.innerHTML = U.aviso('erro', 'Informe seu nome.'); return }
      U.gravarNome(por); ev.currentTarget.disabled = true
      try { const r = await enviar(por); fechar(); toast(r || 'Feito.'); recarregar() } catch (e) { resp.innerHTML = U.aviso('erro', esc(e.message)); ev.currentTarget.disabled = false }
    } }))
  }
  const motivosTxt = r => (r?.motivos?.length ? ` Não saiu: ${r.motivos.join('; ')}.` : '')

  function pintarOrdens(alvo) {
    const os = st.painel.ordens
    alvo.querySelector('#exOrdensBox').innerHTML = os.length ? `<div class="tabela-wrap"><table class="t empilha" id="exOrdens"><caption class="sr">Ordens do Chaveiro</caption><thead><tr><th scope="col">Ordem</th><th scope="col">Operação</th><th scope="col">De → para</th><th scope="col">Estado</th><th scope="col">Quando</th><th scope="col">Ação</th></tr></thead><tbody>${os.map(o => `<tr>
      <td data-rotulo="Ordem"><div>${esc(o.item_id)}<div class="mini">${esc(o.id)}${o.estrategia ? ` · ${esc(o.estrategia.nome)} ${esc(o.estrategia.passo)}/${esc(o.estrategia.de)}` : ''}${o.reverte ? ` · reverte ${esc(o.reverte)}` : ''}</div></div></td>
      <td data-rotulo="Operação">${esc(o.rotulo)}${o.caminho === 'assistido' ? '<div class="mini">assistido</div>' : ''}</td>
      <td data-rotulo="De → para"><div class="mini">${o.diff.map(d => `${esc(d.campo)}: ${esc(val(d.de))} → ${esc(val(d.para))}`).join('<br>') || (o.passo_a_passo.length ? esc(o.passo_a_passo.join(' ')) : '—')}</div></td>
      <td data-rotulo="Estado"><span class="selo ${SELO[o.estado_exibido] || 'neutro'}">${esc(o.estado_exibido)}</span>${o.erro ? `<div class="mini">${esc(o.erro)}</div>` : ''}</td>
      <td data-rotulo="Quando"><div class="mini">criada ${esc(quando(o.criado_em))}${o.executado_em ? `<br>enviada ${esc(quando(o.executado_em))}` : ''}${o.conferido_em ? `<br>conferida ${esc(quando(o.conferido_em))}` : ''}</div></td>
      <td data-rotulo="Ação">${o.estado === 'aguardando_aprovacao' ? `<button class="btn btn-p" type="button" data-aprovar="${esc(o.id)}">Aprovar</button>` : ''}${o.estado === 'aprovada' && o.caminho !== 'assistido' ? `<button class="btn btn-p" type="button" data-executar="${esc(o.id)}">Executar</button>` : ''}${o.estado === 'aprovada' && o.caminho === 'assistido' ? `<button class="btn btn-p" type="button" data-feito="${esc(o.id)}">Fiz no painel</button>` : ''}${o.reversivel ? `<button class="btn btn-p" type="button" data-reverter="${esc(o.id)}">Reverter</button>` : ''}${o.estado === 'executada' ? `<button class="btn btn-fantasma btn-p" type="button" data-marco="${esc(o.id)}">Medir</button>` : ''}${['aguardando_aprovacao', 'aprovada'].includes(o.estado) ? `<button class="btn btn-fantasma btn-p" type="button" data-cancelar="${esc(o.id)}">Cancelar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio-box">Nenhuma ordem ainda. Selecione anúncios, escolha a estratégia ou a operação, veja a prévia e prepare.</div>'
    const c = st.cliente
    alvo.querySelectorAll('[data-aprovar]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Aprovar ordem', texto: '<p>Aprova exatamente o que está na prévia (o hash da ordem fica registrado). Só o líder do cliente aprova.</p>', rotulo: 'Aprovar', enviar: async por => { const r = await api('/api/chaveiro/exec/aprovar', { cliente: c, ordens: [b.dataset.aprovar], por }); return r.aprovadas ? 'Ordem aprovada.' : r.resultado[0]?.motivo || 'Não aprovada.' } }) })
    alvo.querySelectorAll('[data-executar]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Executar no Mercado Livre', texto: '<p>O sistema relê o anúncio ao vivo; se mudou desde a preparação, nada é enviado. Depois do envio, a conferência relê (2xx não é «feito»). Todas as travas valem: chave geral, chave da operação, liberação do cliente, estreia, teto do dia.</p>', rotulo: 'Executar', enviar: async por => { const r = await api('/api/chaveiro/exec/executar', { cliente: c, ordem: b.dataset.executar, por, confirmar: true }); return r.executado ? 'Enviado. A conferência relê o anúncio em seguida.' : `Nada foi enviado.${motivosTxt(r)}` } }) })
    alvo.querySelectorAll('[data-reverter]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Reverter ao que era', texto: '<p>Cria uma ordem que volta os campos tocados ao valor lido antes do envio e a executa com as mesmas travas.</p>', rotulo: 'Reverter', enviar: async por => { const r = await api('/api/chaveiro/exec/reverter', { cliente: c, ordem: b.dataset.reverter, por, confirmar: true }); return r.execucao?.executado ? 'Reversão enviada; a conferência confirma.' : `Reversão não saiu.${motivosTxt(r.execucao)}` } }) })
    alvo.querySelectorAll('[data-feito]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Aplicado no painel', texto: '<p>Registra que o passo a passo foi aplicado no painel do Mercado Livre. A coleta de Ads do dia seguinte confere.</p>', rotulo: 'Registrar', enviar: async por => { await api('/api/chaveiro/exec/feito', { cliente: c, ordem: b.dataset.feito, por }); return 'Registrado; a coleta confere.' } }) })
    alvo.querySelectorAll('[data-cancelar]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Cancelar ordem', texto: '<p>A ordem é cancelada e nada é enviado.</p>', rotulo: 'Cancelar ordem', enviar: async por => { await api('/api/chaveiro/exec/cancelar', { cliente: c, ordens: [b.dataset.cancelar], por }); return 'Ordem cancelada.' } }) })
    alvo.querySelectorAll('[data-marco]').forEach(b => { b.onclick = async () => { try { const m = await api(`/api/chaveiro/exec/marco?cliente=${encodeURIComponent(c)}&ordem=${encodeURIComponent(b.dataset.marco)}`); toast(m.medida ? `Merovíngio: ${m.medida.estado}${m.medida.efeito_pct != null ? `, efeito ${m.medida.efeito_pct}% contra o controle` : ''}${m.medida.motivo ? ` (${m.medida.motivo})` : ''}. ${m.rotulo}.` : m.motivo || 'sem medida') } catch (e) { toast(e.message, 'erro') } } })
  }

  function pintarLiberacoes(alvo) {
    const os = st.painel.operacoes.filter(o => ['automatico', 'delegado'].includes(o.escrita)), c = st.cliente
    alvo.querySelector('#exLibBox').innerHTML = `<div class="tabela-wrap"><table class="t empilha" id="exTabLib"><caption class="sr">Liberações por operação</caption><thead><tr><th scope="col">Operação</th><th scope="col">Chave geral da operação</th><th scope="col">Cliente</th><th scope="col">Estreia</th><th scope="col">Neo</th><th scope="col">Ação</th></tr></thead><tbody>${os.map(o => { const l = o.liberacao, lib = l && l.liberado_por && !l.revogado_em
      return `<tr><td data-rotulo="Operação">${esc(o.rotulo)}<div class="mini">${esc(o.doc)}</div></td><td data-rotulo="Chave geral da operação">${o.live_global ? 'ligada' : 'desligada'}</td>
        <td data-rotulo="Cliente">${lib ? `liberada por ${esc(l.liberado_por)}<div class="mini">cliente informado em ${esc(quando(l.cliente_informado_em))}</div>` : 'não liberada'}</td>
        <td data-rotulo="Estreia">${lib ? `${o.ampliado ? 'ampliada' : esc(l.estreia_item)}<div class="mini">${esc(o.conferidas)} de ${esc(o.para_ampliar)} conferidas · ${esc(o.divergencias)} divergência(s) · hoje ${esc(o.executadas_hoje)}/${esc(o.teto_dia)}</div>` : '—'}</td>
        <td data-rotulo="Neo">${l?.ampliacao_proposta_em ? (l.vetado_em ? 'vetado' : `propôs ampliar; veto até ${esc(quando(l.veto_ate))}`) : '—'}</td>
        <td data-rotulo="Ação">${lib ? `<button class="btn btn-fantasma btn-p" type="button" data-revogar="${esc(o.operacao)}">Revogar</button>` : `<button class="btn btn-p" type="button" data-liberar="${esc(o.operacao)}">Liberar</button>`}${l?.ampliacao_proposta_em && !l.vetado_em && !o.ampliado ? `<button class="btn btn-p" type="button" data-vetar="${esc(o.operacao)}">Vetar</button>` : ''}</td></tr>` }).join('')}</tbody></table></div>`
    alvo.querySelectorAll('[data-liberar]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Liberar operação para este cliente', texto: `<p>Estreia supervisionada: só o anúncio escolhido até ${esc(st.painel.operacoes[0]?.para_ampliar || 10)} ordens conferidas sem divergência; depois o Neo propõe ampliar e você tem ${esc(st.painel.limites.veto_horas)} h de veto. A chave geral e a chave da operação no config continuam valendo.</p>
      <label class="campo"><span class="pf-rot">Anúncio da estreia (MLB)</span><input id="exEstreia" maxlength="20" value="${esc([...st.sel][0] || '')}"></label><label class="campo"><span class="pf-rot">O cliente foi informado</span><input type="checkbox" id="exInformado"></label>`,
      rotulo: 'Liberar', enviar: async por => { const d = document; await api('/api/chaveiro/exec/liberar', { cliente: c, operacao: b.dataset.liberar, por, estreia_item: d.getElementById('exEstreia').value.trim(), cliente_informado: d.getElementById('exInformado').checked, confirmar: true }); return 'Operação liberada para a estreia.' } }) })
    alvo.querySelectorAll('[data-revogar]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Revogar operação', texto: '<p>As ordens abertas desta operação neste cliente são canceladas.</p>', rotulo: 'Revogar', enviar: async por => { await api('/api/chaveiro/exec/revogar', { cliente: c, operacao: b.dataset.revogar, por, confirmar: true }); return 'Operação revogada.' } }) })
    alvo.querySelectorAll('[data-vetar]').forEach(b => { b.onclick = () => dialogoAcao({ titulo: 'Vetar a ampliação do Neo', texto: '<p>A operação continua só no anúncio da estreia.</p>', rotulo: 'Vetar', enviar: async por => { await api('/api/chaveiro/exec/vetar', { cliente: c, operacao: b.dataset.vetar, por, confirmar: true }); return 'Ampliação vetada.' } }) })
  }

  // estratégia própria: nome, até 4 passos (operação + parâmetros «chave=valor»), KPI e janela; o servidor valida com a mesma lista fechada
  function novaEstrategia() {
    const ops = st.painel.operacoes.filter(o => o.escrita !== 'f6'), opc = `<option value="">—</option>${ops.map(o => `<option value="${esc(o.operacao)}">${esc(o.rotulo)}</option>`).join('')}`
    dialogoAcao({ titulo: 'Nova sequência de operações', rotulo: 'Salvar estratégia',
      texto: `<p class="mini">Passos da lista fechada; parâmetros como chave=valor separados por vírgula (ex.: variacao_pct=-5, decisao_cliente=true). $nome vira um parâmetro pedido na hora de rodar (declare em «parâmetros»: nome=tipo, tipos numero, inteiro, texto, foto, snapshot).</p>
        <label class="campo"><span class="pf-rot">Nome</span><input id="exNNome" maxlength="60"></label><label class="campo"><span class="pf-rot">Parâmetros</span><input id="exNPar" maxlength="200" placeholder="capa=foto"></label>
        ${[1, 2, 3, 4].map(i => `<div class="form-grade"><label class="campo"><span class="pf-rot">Passo ${i}</span><select id="exNOp${i}">${opc}</select></label><label class="campo"><span class="pf-rot">Parâmetros do passo ${i}</span><input id="exNPp${i}" maxlength="300"></label></div>`).join('')}
        <label class="campo"><span class="pf-rot">KPI</span><input id="exNKpi" maxlength="120" value="unidades e receita"></label><label class="campo"><span class="pf-rot">Janela (dias)</span><input id="exNJan" type="number" min="7" max="90" value="14"></label>`,
      enviar: async por => {
        const d = document, conv = s => (s === 'true' ? true : s === 'false' ? false : s !== '' && !isNaN(Number(s)) && !/^\$/.test(s) ? Number(s) : s)
        const kv = s => Object.fromEntries(String(s || '').split(',').map(x => x.split('=')).filter(p => p.length === 2 && p[0].trim()).map(([k, v]) => [k.trim(), conv(v.trim())]))
        const passos = [1, 2, 3, 4].map(i => ({ operacao: d.getElementById(`exNOp${i}`).value, params: kv(d.getElementById(`exNPp${i}`).value) })).filter(p => p.operacao)
        const parametros = Object.fromEntries(Object.entries(kv(d.getElementById('exNPar').value)).map(([k, t]) => [k, { tipo: String(t), rotulo: k }]))
        await api('/api/chaveiro/exec/estrategia', { nome: d.getElementById('exNNome').value, parametros, passos, precondicoes: [], kpi: d.getElementById('exNKpi').value, janela_dias: parseInt(d.getElementById('exNJan').value, 10), por, confirmar: true })
        return 'Estratégia salva.'
      } })
  }

  let alvoAtual = null
  async function recarregar() { if (alvoAtual) { st.painel = await api(`/api/chaveiro/exec/painel?cliente=${encodeURIComponent(st.cliente)}`); pintarCabecalho(alvoAtual); pintarOrdens(alvoAtual); pintarLiberacoes(alvoAtual) } }
  function pintarCabecalho(alvo) {
    const p = st.painel, abertas = p.ordens.filter(o => ['aguardando_aprovacao', 'aprovada', 'executando', 'em_conferencia'].includes(o.estado)).length, lib = p.operacoes.filter(o => o.liberacao?.liberado_por && !o.liberacao.revogado_em).length
    alvo.querySelector('#exVeredito').innerHTML = `Execução <b>${p.ligado ? 'ligada' : 'desligada'}</b> (chave geral) · ${p.parado ? '<b>parada pelo botão de emergência</b>' : 'botão de emergência solto'} · ${lib} operação(ões) liberada(s) neste cliente · teto de ${esc(p.limites.teto_ordens_por_lote)} anúncios por lote, ${esc(p.limites.teto_dia_estreia)} ordem/dia por operação na estreia, preço até ${esc(p.limites.preco_max_var_pct)}% por ordem`
    alvo.querySelector('#exKpis').innerHTML = kp('Ordens abertas', abertas, 'preparadas, aprovadas ou em conferência') + kp('Conferidas', p.ordens.filter(o => o.estado === 'executada').length, 'o Merovíngio mede a partir da conferência') + kp('Divergências', p.ordens.filter(o => ['divergente', 'falhou'].includes(o.estado)).length, 'divergente ou não confirmada') + kp('Operações liberadas', lib, 'líder + cliente informado')
    alvo.querySelector('#exParar').textContent = p.parado ? 'Retomar o Chaveiro' : 'Parar tudo (emergência)'
  }

  async function montar(alvo, cliente, preset = null) {
    alvoAtual = alvo; st = { cliente, painel: null, anuncios: [], sel: new Set(preset?.item_id ? [preset.item_id] : []), preset }
    alvo.innerHTML = '<div class="skeleton sk-tabela"></div>'
    try { [st.painel, st.anuncios] = await Promise.all([api(`/api/chaveiro/exec/painel?cliente=${encodeURIComponent(cliente)}`), api(`/api/chaveiro/exec/anuncios?cliente=${encodeURIComponent(cliente)}`).then(r => r.anuncios)]) }
    catch (e) { alvo.innerHTML = `<div class="aviso erro">${esc(e.message)}</div>`; return }
    if (preset?.item_id && !st.anuncios.some(a => a.item_id === preset.item_id)) st.sel.delete(preset.item_id)
    const p = st.painel
    alvo.innerHTML = `<p class="veredito-frase" id="exVeredito"></p><div class="kpis" id="exKpis"></div>
      ${preset ? `<div class="aviso">Preenchido pela ação ${esc(preset.acao_id)} do plano (${esc(preset.regra || '')}).${preset.nota ? ` ${esc(preset.nota)}` : ''}</div>` : ''}
      <h3 class="mt-4">1. Anúncios <span class="mini" id="exNSel"></span></h3><div class="filtros"><label class="campo"><span class="pf-rot">Buscar por título ou MLB</span><input id="exBusca" type="search" maxlength="60"></label></div><div id="exAnuncios"></div>
      <h3 class="mt-4">2. Estratégia ou operação</h3><label class="campo"><span class="pf-rot">O que fazer</span><select id="exOque"><option value="">—</option><optgroup label="Estratégias">${p.estrategias.map(e => `<option value="e:${esc(e.id)}">${esc(e.nome)}${e.origem === 'propria' ? ' (própria)' : ''}</option>`).join('')}</optgroup><optgroup label="Operação avulsa">${p.operacoes.filter(o => o.escrita !== 'f6').map(o => `<option value="o:${esc(o.operacao)}">${esc(o.rotulo)}</option>`).join('')}</optgroup></select></label>
      <div id="exParams"></div>
      <div class="mt-2"><button class="btn" type="button" id="exPrevia">Ver prévia</button> <button class="btn" type="button" id="exPreparar">Preparar ordens</button> <button class="btn btn-fantasma" type="button" id="exNova">Nova sequência de operações</button></div>
      <div id="exPreviaRes" class="mt-2"></div>
      <h3 class="mt-4">3. Ordens</h3><div id="exOrdensBox"></div><div class="mt-2"><button class="btn btn-fantasma" type="button" id="exConferir">Conferir agora</button></div>
      <details class="recolhido mt-4" id="exLiberacoes"><summary>Liberações, estreia e Neo</summary><div id="exLibBox"></div></details>
      <div class="mt-4"><button class="btn" type="button" id="exParar"></button> <span class="mini">Estoque segue o ajuste automático próprio na aba Produtos.</span></div>`
    pintarCabecalho(alvo); pintarAnuncios(alvo); pintarOrdens(alvo); pintarLiberacoes(alvo)
    if (preset?.operacao && preset.operacao !== 'estoque') { alvo.querySelector('#exOque').value = `o:${preset.operacao}` }
    pintarParams(alvo)
    alvo.querySelector('#exBusca').oninput = () => pintarAnuncios(alvo)
    alvo.querySelector('#exOque').onchange = () => { st.preset = st.preset ? { ...st.preset, params: null } : null; pintarParams(alvo) }
    alvo.querySelector('#exPrevia').onclick = async ev => {
      const b = ev.currentTarget; b.disabled = true
      try { pintarPrevia(alvo, await api('/api/chaveiro/exec/previa', pedido(alvo))) } catch (e) { alvo.querySelector('#exPreviaRes').innerHTML = `<div class="aviso erro">${esc(e.message)}</div>` } finally { b.disabled = false }
    }
    alvo.querySelector('#exPreparar').onclick = () => dialogoAcao({ titulo: 'Preparar ordens', texto: '<p>O sistema relê cada anúncio ao vivo (só leitura) e grava uma ordem por passo, aguardando a aprovação do líder. Nada é escrito no Mercado Livre agora.</p>', rotulo: 'Preparar',
      enviar: async por => { const r = await api('/api/chaveiro/exec/preparar', { ...pedido(alvo), por, confirmar: true }); return `${r.criadas.length} ordem(ns) preparada(s)${r.ignoradas.length ? `; ${r.ignoradas.length} não: ${r.ignoradas.slice(0, 3).map(x => `${x.item_id} (${x.motivo})`).join('; ')}` : ''}.` } })
    alvo.querySelector('#exNova').onclick = novaEstrategia
    alvo.querySelector('#exConferir').onclick = async () => { try { const r = await api('/api/chaveiro/exec/conferir', { cliente }); toast(`${r.conferidas} ordem(ns) relida(s).`); recarregar() } catch (e) { toast(e.message, 'erro') } }
    alvo.querySelector('#exParar').onclick = () => dialogoAcao(st.painel.parado ? { titulo: 'Retomar o Chaveiro', texto: '<p>Solta o botão de emergência da execução (o sincronismo de estoque retoma pelo botão dele).</p>', rotulo: 'Retomar', enviar: async por => { await api('/api/chaveiro/exec/retomar', { por, confirmar: true }); return 'Chaveiro retomado.' } }
      : { titulo: 'Parar tudo', texto: '<p>Nenhuma escrita sai do Chaveiro (execução e sincronismo de estoque) e as ordens na fila são canceladas. O que já foi enviado só é conferido.</p>', rotulo: 'Parar tudo', enviar: async por => { await api('/api/chaveiro/exec/parar', { por, confirmar: true }); return 'Chaveiro parado.' } })
  }
  window.PSExecutar = { montar }
})()
