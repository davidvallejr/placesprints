// Distribuição de planos (/planos). Fluxo: Escopo → Gerar → Revisar → Enviar. Nada vai ao Notion sem pré-visualização.
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const brData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmt = n => Number(n || 0).toLocaleString('pt-BR')
const plural = (n, um, varios) => `${fmt(n)} ${n === 1 ? um : varios}`
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
  return j
}
// toast/confirmação do shell, com fallback nativo caso o shell.js não carregue
const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : alert(t)
const confirmar = o => (window.PS?.confirmar ?? (o => Promise.resolve(confirm(o.titulo + (o.texto ? '\n\n' + o.texto : '')))))(o)
const fecharMenu = el => { const d = el.closest('details.menu'); if (d) d.open = false }

// estados por bloco (5.8)
const PAG = 50
const CAMINHO_ROTULO = { automatico: 'automático', assistido: 'assistido', cliente: 'do cliente', sem_caminho: 'sem caminho' }   // execução do plano (Chaveiro F1): só leitura
const skTabela = (cols) => `<tr><td colspan="${cols}"><div class="sk-tabela"></div></td></tr>`
const erroBloco = (e, retry) => `<div class="erro-bloco"><b>Não foi possível carregar</b>${esc(e.message)}<br><button type="button" class="btn btn-p" data-retry="${retry}">Tentar de novo</button><details><summary>Detalhe técnico</summary><pre>${esc(e.stack || e.message)}</pre></details></div>`
const vazioTd = (cols, titulo, texto, botao = '') => `<tr><td colspan="${cols}" class="vazio"><b>${titulo}</b>${texto}${botao ? ` <button type="button" class="btn btn-p" ${botao}>Limpar filtros</button>` : ''}</td></tr>`
const pagina = (el, total, limite, retry) => { el.innerHTML = total > PAG ? `<span>1–${fmt(Math.min(limite, total))} de ${fmt(total)}</span>${limite < total ? ` · <button type="button" class="btn btn-p" data-mais="${retry}">Mostrar mais</button>` : ''}` : '' }
const RETRY = { clientes: () => carregarClientes(), acoes: () => carregarAcoes(), gargalos: () => carregarGargalos() }
document.addEventListener('click', e => {
  const r = e.target.closest('[data-retry]'); if (r) return RETRY[r.dataset.retry]?.()
  const m = e.target.closest('[data-mais]'); if (!m) return
  if (m.dataset.mais === 'acoes') { limAcoes += PAG; renderAcoes() } else { limClientes += PAG; renderClientes() }
})

let equipe = null, tipo = 'total', previaOk = null          // previaOk: assinatura do escopo já pré-visualizado
let previaIds = new Set(), clientesAtuais = null, acoesAtuais = [], limAcoes = PAG, limClientes = PAG
let fAtual = null                                            // filtro avançado serializado (?f=): recorta o que se vê; escopo e prévia não mudam com ele
const seq = { clientes: 0, acoes: 0, gargalos: 0 }           // resposta velha (filtro trocado no meio) não sobrescreve a nova
const selecionados = new Set()
const escopo = () => ({ tipo, squad: $('selSquad').value, consultor: $('selConsultor').value, clientes: [...selecionados] })
const assinatura = () => JSON.stringify([escopo(), $('scoreMin').value])
const qs = () => { const e = escopo(); const p = new URLSearchParams({ tipo: e.tipo }); if (e.squad && tipo === 'squad') p.set('squad', e.squad); if (e.consultor && tipo === 'consultor') p.set('consultor', e.consultor); if (tipo === 'selecao') e.clientes.forEach(c => p.append('cliente', c)); if (fAtual) p.set('f', fAtual); return p }

// ── escopo ──────────────────────────────────────────────────────────────────
async function carregarEquipe() {
  equipe = await api('/api/planos/equipe')
  $('selSquad').innerHTML = equipe.squads.map(s => `<option value="${esc(s.nome)}">${esc(s.nome)} — ${s.clientes} cliente(s)</option>`).join('')
  $('selConsultor').innerHTML = equipe.consultores.map(c => `<option value="${esc(c.nome)}">${esc(c.nome)} — ${c.clientes} cliente(s)</option>`).join('')
  desenharLista()
}
function desenharLista() {
  const f = $('busca').value.trim().toLowerCase()
  $('listaCli').innerHTML = equipe.clientes.filter(c => !f || c.cliente.toLowerCase().includes(f)).map(c =>
    `<label><input type="checkbox" value="${esc(c.cliente)}" ${selecionados.has(c.cliente) ? 'checked' : ''}> ${esc(c.cliente)} <span class="mini">${esc(c.consultor || 'sem consultor')}</span></label>`).join('')
}
$('listaCli').addEventListener('change', e => { e.target.checked ? selecionados.add(e.target.value) : selecionados.delete(e.target.value); atualizar() })
$('busca').addEventListener('input', desenharLista)
$('marcarVis').onclick = () => { $('listaCli').querySelectorAll('input').forEach(i => { i.checked = true; selecionados.add(i.value) }); atualizar() }
$('limpar').onclick = () => { selecionados.clear(); desenharLista(); atualizar() }
$('tipos').addEventListener('click', e => {
  if (!e.target.dataset.t) return
  tipo = e.target.dataset.t
  $('tipos').querySelectorAll('button').forEach(b => b.classList.toggle('on', b === e.target))
  $('boxSquad').hidden = tipo !== 'squad'; $('boxConsultor').hidden = tipo !== 'consultor'; $('boxSelecao').hidden = tipo !== 'selecao'
  atualizar()
})
for (const id of ['selSquad', 'selConsultor', 'scoreMin']) $(id).addEventListener('change', atualizar)

async function atualizar() {
  previaOk = null; previaIds = new Set(); $('btnDistribuir').disabled = true; $('btnDistribuir').textContent = 'Criar tarefas no Notion'
  limAcoes = PAG; limClientes = PAG
  const e = escopo()
  try { $('nEscopo').textContent = fmt((await api('/api/planos/escopo', e)).n) } catch (x) { $('nEscopo').textContent = '—' }
  await recarregar()
}
// só os blocos de dado (indicadores, tabelas, gargalos, CSV): é o que o filtro avançado recorta
async function recarregar() {
  limAcoes = PAG; limClientes = PAG
  $('lnkCsv').href = '/api/planos/acoes.csv?' + qs()
  await Promise.all([carregarClientes(), carregarAcoes(), carregarGargalos()])   // cada bloco trata o próprio erro
}
// filtro avançado (painel distribuicao): o componente lê ?f= da URL sozinho e chama aoAplicar; antes da equipe carregar só guardamos o f (o boot usa)
window.PSFiltros?.montar($('fltAvancado'), { painel: 'distribuicao', aoAplicar: (def, f) => { fAtual = f; if (equipe) recarregar() } })

// ── veredito, KPIs, passos ──────────────────────────────────────────────────
function desenharResumo() {
  const cl = clientesAtuais, n = cl.length, semPlano = cl.filter(c => !c.gerado_em).length
  const soma = k => cl.reduce((s, c) => s + c[k], 0), h72 = soma('h72'), total = soma('n')
  const previa = previaOk ? window.__previa : null
  const noFiltro = fAtual ? ' no filtro' : ''          // contagens de ações seguem o filtro; a prévia é do escopo inteiro
  let frase
  if (!n) frase = 'Nenhum cliente no escopo. Escolha um squad, um consultor ou marque clientes.'
  else if (semPlano) frase = `<b>${plural(semPlano, 'cliente', 'clientes')}</b> do escopo ainda sem plano. Gere os planos antes de pré-visualizar.`
  else if (!previa) frase = `Todo o escopo tem plano${h72 ? `, com <b>${plural(h72, 'ação urgente', 'ações urgentes')}</b> para 72 horas${noFiltro}` : ''}. Pré-visualize para saber o que iria ao Notion.`
  else if (!previa.a_criar.length) frase = 'Pré-visualização feita: <b>nada a criar</b>. Aprove ações acima da prioridade mínima ou baixe o corte.'
  else frase = `Envio liberado para <b>${plural(previa.clientes, 'quadro', 'quadros')}</b>${previa.sem_usuario_notion ? `; <b>${previa.sem_usuario_notion}</b> sem usuário do Notion identificado` : ''}${previa.erros.length ? `; <b>${plural(previa.erros.length, 'cliente com erro', 'clientes com erro')}</b>` : ''}. Revise a lista e confirme no passo 4.`
  $('veredito').innerHTML = frase
  // régua: prontas × ações do escopo. Só é proporção real sem filtro (a prévia não segue o filtro; com ele o total é o recortado) — PS.regua some com valor não numérico
  window.PS?.regua?.('regua', { valor: previa && total && !fAtual ? 100 * previa.a_criar.length / total : NaN, rotulo: previa ? `${fmt(previa.a_criar.length)} prontas de ${fmt(total)}` : '' })
  const kpi = (rotulo, valor, detalhe, cls = '') => `<div class="kpi ${cls}"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div><div class="detalhe">${detalhe}</div></div>`
  $('kpis').innerHTML =
    kpi('Prontas para enviar', previa ? fmt(previa.a_criar.length) : '<span class="mudo">—</span>', previa ? `em ${plural(previa.clientes, 'quadro', 'quadros')} · ${fAtual ? 'escopo inteiro: a prévia não segue o filtro' : 'última pré-visualização'}` : 'pré-visualize para contar', previa ? 'bom' : '') +
    kpi('Urgentes 72h', fmt(h72), h72 ? `risco: vencem em até 3 dias${noFiltro}` : `nenhuma nas próximas 72 horas${noFiltro}`, h72 ? 'risco' : '') +
    kpi('Clientes com plano', fmt(n - semPlano), `de ${plural(n, 'cliente', 'clientes')} no escopo`, semPlano ? 'alerta' : n ? 'bom' : '') +
    kpi('Já no Notion', fmt(soma('distribuidas')), fAtual ? 'tarefas criadas no filtro' : 'tarefas criadas a partir dos planos')
  $('kpis').removeAttribute('aria-busy')
  const estado = [n ? 'feito' : 'atual', !n ? '' : semPlano ? 'atual' : 'feito', n && !semPlano ? (previa ? 'feito' : 'atual') : '', previa ? 'atual' : '']
  ;[...$('passos').children].forEach((li, i) => { li.classList.toggle('feito', estado[i] === 'feito'); li.classList.toggle('atual', estado[i] === 'atual') })
}

// ── planos por cliente ──────────────────────────────────────────────────────
async function carregarClientes() {
  const s = ++seq.clientes
  $('tbClientes').innerHTML = skTabela(6); $('kpis').setAttribute('aria-busy', 'true')
  let r
  try { r = await api('/api/planos/clientes?' + qs()) }
  catch (e) { if (s !== seq.clientes) return; $('tbClientes').innerHTML = `<tr><td colspan="6">${erroBloco(e, 'clientes')}</td></tr>`; $('veredito').textContent = 'Não foi possível ler os clientes do escopo.'; $('kpis').innerHTML = ''; return }
  if (s !== seq.clientes) return
  clientesAtuais = Array.isArray(r) ? r : r.clientes          // com ?f= a rota devolve { clientes, filtro }
  desenharResumo(); renderClientes()
}
const seloRel = cliente => { const h = window.PSRelatorio?.selo(cliente); return h ? `<div class="mini">${h}</div>` : '' }   // programação do relatório (relatorio.js), só leitura
// health score do cadastro (planilha do CS / edição manual): o número nunca é colorido; a classificação usa o selo existente
const SELO_HS = { 'Saudável': 'bom', 'Atenção': 'atencao', 'Risco': 'ruim', 'Dados insuficientes': 'neutro', 'Sem HS': 'neutro' }
const seloHs = c => c.hs != null || c.hs_classe ? `<div class="mini">HS ${c.hs != null ? Number(c.hs).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}${c.hs_classe ? ` <span class="selo ${SELO_HS[c.hs_classe] || 'neutro'}">${esc(c.hs_classe)}</span>` : ''}</div>` : ''
function renderClientes() {
  const cl = clientesAtuais
  $('nClientes').textContent = cl.length ? fmt(cl.length) : ''
  if (!cl.length) { $('tbClientes').innerHTML = vazioTd(6, 'Nenhum cliente no escopo.', 'Escolha um squad, um consultor ou marque clientes acima.'); $('pagClientes').innerHTML = ''; return }
  $('tbClientes').innerHTML = cl.slice(0, limClientes).map(c => `<tr><td>${esc(c.cliente)}<div class="mini">${esc(c.tier || '')} ${c.canais.join(' · ')}</div>${seloHs(c)}${seloRel(c.cliente)}</td><td>${esc(c.squad || '—')}<div class="mini">${esc(c.consultor || 'a definir')}</div></td><td class="n">${c.n}</td><td class="n ${c.h72 ? 'h72' : ''}">${c.h72}</td><td>${c.gerado_em ? `<a href="/plano?cliente=${encodeURIComponent(c.cliente)}" target="_blank" rel="noopener">Plano</a> · <a href="/plano.pdf?cliente=${encodeURIComponent(c.cliente)}" target="_blank" rel="noopener">PDF</a><div class="mini">gerado ${brData(c.gerado_em)}</div>` : '<span class="mudo">gere o plano</span>'}</td>
    <td data-eq="${esc(c.cliente)}"><span class="mini">${c.n_ficha ? `${c.n_ficha} atribuição(ões)` : 'sem equipe'}</span> <button type="button" class="btn btn-p" data-ficha="${esc(c.cliente)}">Equipe</button> <button type="button" class="btn btn-fantasma btn-p" data-rel-cliente="${esc(c.cliente)}" title="Gera e envia o relatório curto deste cliente ao Notion dele, depois da prévia">Relatório</button></td></tr>
    <tr class="fichaLinha" data-cli="${esc(c.cliente)}" hidden><td colspan="6"><div class="gaveta"><div class="linha"><b>Equipe · ${esc(c.cliente)}</b><button type="button" class="btn btn-p" data-ficha="${esc(c.cliente)}">Fechar</button></div><div class="fichaBox"></div></div></td></tr>`).join('')
  pagina($('pagClientes'), cl.length, limClientes, 'clientes')
}
let gavetaOrigem = null   // botão Equipe que abriu a gaveta: recebe o foco de volta ao fechar
function fecharGaveta() {
  const aberta = document.querySelector('tr.fichaLinha:not([hidden])'); if (!aberta) return false
  aberta.hidden = true; gavetaOrigem?.focus(); gavetaOrigem = null; return true
}
$('tbClientes').addEventListener('click', e => {
  const b = e.target.closest('[data-ficha]'); if (!b) return
  const linha = [...document.querySelectorAll('tr.fichaLinha')].find(r => r.dataset.cli === b.dataset.ficha)
  if (!linha.hidden) return fecharGaveta()   // botão Fechar da gaveta ou 2º clique em Equipe
  fecharGaveta()                             // uma gaveta por vez
  gavetaOrigem = b; linha.hidden = false
  linha.querySelector('.gaveta .btn')?.focus()
  if (window.PSFicha) PSFicha.montar(linha.querySelector('.fichaBox'), b.dataset.ficha, { aoSalvo: f => { const td = [...document.querySelectorAll('[data-eq]')].find(x => x.dataset.eq === b.dataset.ficha); if (td) td.firstElementChild.textContent = f.prestadores.length ? `${f.prestadores.length} atribuição(ões)` : 'sem equipe'; carregarAcoes() } })
})
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharGaveta() })   // o Esc do shell só fecha details

// ── revisar ações ───────────────────────────────────────────────────────────
async function carregarAcoes() {
  const s = ++seq.acoes
  $('tbAcoes').innerHTML = skTabela(7); $('nAcoes').textContent = ''
  const p = qs(); p.set('status', $('fSt').value); if ($('fHor').value) p.set('horizonte', $('fHor').value)
  let r
  try { r = await api('/api/planos/acoes?' + p) }
  catch (e) { if (s !== seq.acoes) return; $('tbAcoes').innerHTML = `<tr><td colspan="7">${erroBloco(e, 'acoes')}</td></tr>`; $('pagAcoes').innerHTML = ''; return }
  if (s !== seq.acoes) return
  acoesAtuais = Array.isArray(r) ? r : r.acoes                 // com ?f= a rota devolve { acoes, filtro }
  const av = $('fltAviso'); av.hidden = !r.filtro?.aviso; av.textContent = r.filtro?.aviso || ''   // o que a API não alcança, ela mesma avisa
  renderAcoes()
}
function renderAcoes() {
  const f = $('fTxt').value.trim().toLowerCase(), sel = new Set(marcadas())
  const lista = acoesAtuais.filter(a => !f || `${a.titulo} ${a.cliente} ${a.id}`.toLowerCase().includes(f))
  $('nAcoes').textContent = plural(lista.length, 'ação', 'ações') + (fAtual ? ' no filtro' : '')
  $('todas').checked = false
  if (!lista.length) { $('tbAcoes').innerHTML = vazioTd(7, 'Nenhuma ação neste filtro.', acoesAtuais.length || fAtual ? 'Limpe os filtros para ver as demais.' : 'Gere os planos do escopo ou mude o status no filtro.', acoesAtuais.length || f || fAtual ? 'id="limparFiltros"' : ''); $('pagAcoes').innerHTML = ''; return }
  $('tbAcoes').innerHTML = lista.slice(0, limAcoes).map(a => {
    const nome = a.recebe ? esc(a.recebe.nome) : 'analista da conta (automático)'
    const sug = a.sugerido ? (a.sugerido.nome ? `<div class="mini">sugerido: <b>${esc(a.sugerido.nome)}</b> · ${esc(a.sugerido.motivo || '')}</div>` : `<div class="mini" title="${esc(a.sugerido.aviso || '')}">sem prova de melhor profissional ainda</div>`) : ''
    const via = a.executar_via_oferta ? `<div class="mini"><span class="badge selo azul">via Ofertas: ${esc(a.executar_via_oferta.escopo || '')}</span></div>` : ''
    const extras = [a.recebe?.origem, a.responsavel ? `consultor: ${a.responsavel}` : '', a.squad, a.roteiro ? `roteiro: Manual ${a.roteiro.id} — ${a.roteiro.nome}` : ''].filter(Boolean)
    return `<tr>
    <td><input type="checkbox" class="sel" value="${esc(a.id)}" aria-label="Marcar ${esc(a.id)}" ${sel.has(a.id) ? 'checked' : ''}></td><td class="n">${a.score}</td>
    <td>${esc(a.cliente)}<div class="mini">${esc(a.canal || 'Geral')}</div></td>
    <td><b>${esc(a.titulo)}</b><div class="mini">${esc(a.id)} · ${esc(a.tipo)} · caminho: ${esc(CAMINHO_ROTULO[a.caminho] || 'sem caminho')}</div>
      <details class="lin"><summary class="mudo peq">evidência e critérios</summary><div class="det"><b>Evidência:</b> ${esc(a.evidencia)}<br><b>Ação:</b> ${esc(a.acao)}<br><b>Meta:</b> ${esc(a.meta)}<br><b>Aceite:</b> ${esc(a.aceite)}<br><b>Prioridade:</b> ${esc(a.logica)}${extras.length ? `<br><b>Responsável:</b> ${esc(extras.join(' · '))}` : ''}${a.erro ? `<br><span class="neg forte">Erro:</span> ${esc(a.erro)}` : ''}</div></details></td>
    <td>${esc(a.horizonte)}<div class="mini">${brData(a.prazo)}</div></td>
    <td>${nome}${a.recebe?.notion === false ? ' <span class="selo atencao">sem usuário no Notion</span>' : ''}${extras.length ? ` <span class="mudo peq" title="${esc(extras.join(' · '))}">+${extras.length}</span>` : ''}${sug}${via}</td>
    <td><span class="tag p-${esc(a.status)}">${esc(a.status)}</span>${previaIds.has(a.id) ? ' <span class="badge">vai ao Notion</span>' : ''}${a.notion_url ? ` <a href="${esc(a.notion_url)}" target="_blank" rel="noopener">Notion</a>` : ''}</td></tr>`
  }).join('')
  pagina($('pagAcoes'), lista.length, limAcoes, 'acoes')
}
$('todas').onchange = e => document.querySelectorAll('.sel').forEach(i => { i.checked = e.target.checked })
for (const id of ['fHor', 'fSt']) $(id).addEventListener('change', () => { limAcoes = PAG; carregarAcoes() })
let tFiltro
$('fTxt').addEventListener('input', () => { clearTimeout(tFiltro); tFiltro = setTimeout(() => { limAcoes = PAG; renderAcoes() }, 300) })   // filtro local, sem refetch
document.addEventListener('click', e => {
  if (e.target.id !== 'limparFiltros') return
  $('fTxt').value = ''; $('fHor').value = ''; $('fSt').value = 'proposta,aprovada'; limAcoes = PAG
  // o componente não expõe "limpar": o botão "Limpar tudo" dele (único .btn entre os chips) faz o mesmo e dispara aoAplicar → recarregar()
  const limparAvancado = fAtual && $('fltAvancado').querySelector('.flt-chips .btn')
  limparAvancado ? limparAvancado.click() : carregarAcoes()
})
const marcadas = () => [...document.querySelectorAll('.sel:checked')].map(i => i.value)
document.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
  const ids = marcadas(); if (!ids.length) return toast('Marque ao menos uma ação.', 'erro')
  // descartar em lote exige UM motivo da lista para todas (vira alinhamento com o cliente por ação; diálogo em alinhamentos.js)
  if (b.dataset.st === 'descartada') { if (await window.PSAlinhamentos?.descartar({ ids })) atualizar(); return }
  // reabrir DESCARTADA(s) encerra o alinhamento do descarte: o servidor exige quem decide (líder/consultor)
  const reabre = ids.some(id => acoesAtuais.find(a => a.id === id)?.status === 'descartada')
  const por = reabre ? await window.PSRelatorio?.ui?.pedirPor({ titulo: 'Reabrir ação descartada', texto: 'Reabrir encerra o alinhamento que o descarte registrou: a recomendação volta a valer.', rotuloOk: 'Reabrir' }) : ''
  if (reabre && !por) return
  try { await api('/api/planos/acoes/status', { ids, status: b.dataset.st, ...(por ? { por } : {}) }); toast(`${plural(ids.length, 'ação', 'ações')} → ${b.dataset.st}.`); atualizar() } catch (e) { toast('Falhou: ' + e.message, 'erro') }
})
async function carregarPrestadores() {
  try {
    const r = await api('/api/prestadores')
    const grupos = [...new Set(r.prestadores.map(p => p.cargo || 'Sem cargo'))].sort()
    $('selDelegar').innerHTML = '<option value="">Automático (ficha do cliente → analista da conta → consultor)</option>' + grupos.map(g => `<optgroup label="${esc(g)}">${r.prestadores.filter(p => (p.cargo || 'Sem cargo') === g).map(p => `<option value="${esc(p.nome)}">${esc(p.nome)}${p.notion ? '' : ' (sem usuário no Notion)'}</option>`).join('')}</optgroup>`).join('')
    $('nPrest').textContent = r.prestadores.length ? `${r.prestadores.length} prestador(es) ativo(s) do Notion` : 'Nenhum prestador carregado: use "Atualizar prestadores do Notion" no menu da página.'
  } catch (e) { $('nPrest').textContent = e.message }
}
$('btnSyncPrest').onclick = async () => {
  fecharMenu($('btnSyncPrest')); $('btnSyncPrest').disabled = true
  try { const r = await api('/api/prestadores/sincronizar', {}); await carregarPrestadores(); toast(`${r.prestadores} prestador(es) ativo(s) lidos do Notion.`) } catch (e) { toast('Falhou: ' + e.message, 'erro') } finally { $('btnSyncPrest').disabled = false }
}
// Notion de todos os clientes (página + filhos + Informações): prévia → confirmar → job com progresso (GET /api/notion/job/:id)
$('btnNotionTodos').onclick = async () => {
  const b = $('btnNotionTodos'); fecharMenu(b)
  let por = window.PS?.quem?.().nome || ''; try { por = por || localStorage.getItem('ps_perfil_por') || '' } catch { /* sem armazenamento */ }   // padrão = «Quem sou» do topo (F2)
  if (!por) { por = (prompt('Seu nome (líder ou consultor):') || '').trim(); if (!por) return; try { localStorage.setItem('ps_perfil_por', por) } catch { /* só não lembra */ } }
  b.disabled = true
  try {
    const p = await api('/api/notion/atualizar-todos', { por, confirmar: false })
    if (!await confirmar({ titulo: `Ler o Notion de ${plural(p.n, 'cliente', 'clientes')}?`, texto: `Página, bases/páginas internas e a base Informações de cada cliente da central, só leitura no Notion. ${p.ultimo ? 'Última leitura de todos: ' + p.ultimo.slice(0, 10).split('-').reverse().join('/') + '.' : 'Nunca lido em lote.'} Leva alguns minutos pelo rate limit.`, rotuloOk: 'Ler agora' })) return
    const { job } = await api('/api/notion/atualizar-todos', { por, confirmar: true })
    $('job').hidden = false
    let j
    do { await new Promise(r => setTimeout(r, 1500)); j = await api('/api/notion/job/' + job); $('jobTxt').textContent = `Lendo o Notion: ${j.feitos}/${j.total}${j.atual ? ' · ' + j.atual : ''}`; $('jobBarra').style.width = j.total ? Math.round(100 * j.feitos / j.total) + '%' : '5%' } while (j.estado === 'rodando')
    $('job').hidden = true; $('jobBarra').style.width = '0'
    const r = j.resumo || {}
    toast(j.estado === 'erro' ? 'A leitura parou com erro: ' + (r.erro || '') : `Notion lido: ${r.ok || 0} com Informações (${fmt(r.linhas || 0)} itens), ${r.sem_informacoes || 0} sem a base, ${r.sem_pagina || 0} sem página, ${r.erro || 0} com erro.`, j.estado === 'erro' ? 'erro' : 'ok')
  } catch (e) { $('job').hidden = true; toast('Falhou: ' + e.message, 'erro') } finally { b.disabled = false }
}
$('btnDelegar').onclick = async () => {
  const ids = marcadas(); if (!ids.length) return toast('Marque ao menos uma ação (proposta ou aprovada).', 'erro')
  const nome = $('selDelegar').value
  try { const r = await api('/api/planos/acoes/delegar', { ids, prestador: nome }); toast(nome ? `${r.alteradas} ação(ões) delegada(s) a ${nome}. Valem na distribuição para o Notion.` : `${r.alteradas} ação(ões) voltaram ao automático.`); carregarAcoes() } catch (e) { toast('Falhou: ' + e.message, 'erro') }
}
$('btnDesfazer').onclick = async () => {
  fecharMenu($('btnDesfazer'))
  const ids = marcadas(); if (!ids.length) return toast('Marque ao menos uma ação já enviada ao Notion.', 'erro')
  if (!await confirmar({ titulo: 'Desfazer no Notion?', texto: `As tarefas de ${plural(ids.length, 'ação marcada', 'ações marcadas')} vão para a lixeira do Notion. Só as já enviadas são afetadas; dá para recuperar pela lixeira.`, rotuloOk: 'Desfazer', perigo: true })) return
  try { const r = await api('/api/planos/desfazer', { ids }); toast(`${r.desfeitas} tarefa(s) para a lixeira.${r.erros.length ? ` ${r.erros.length} erro(s).` : ''}`, r.erros.length ? 'erro' : 'ok'); atualizar() } catch (e) { toast('Falhou: ' + e.message, 'erro') }
}

// ── gargalos da base ────────────────────────────────────────────────────────
async function carregarGargalos() {
  const s = ++seq.gargalos
  $('gargalos').innerHTML = '<div class="sk-tabela"></div>'
  let ins
  try { ins = await api('/api/planos/insights' + (fAtual ? '?f=' + encodeURIComponent(fAtual) : '')) } catch (e) { if (s === seq.gargalos) $('gargalos').innerHTML = erroBloco(e, 'gargalos'); return }
  if (s !== seq.gargalos) return
  const tabela = (titulo, cab, linhas) => `<div class="cartao"><h2>${titulo}</h2><div class="tabela-wrap"><table class="t"><thead><tr>${cab.map((c, i) => `<th${i ? ' class="n"' : ''}>${c}</th>`).join('')}</tr></thead><tbody>${linhas.map(l => `<tr>${l.map((v, i) => `<td${i ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}" class="vazio">Sem dados.</td></tr>`}</tbody></table></div></div>`
  // com filtro, por regra / por squad / sem responsável seguem o recorte; as tarefas do Notion não (a API avisa) — o aviso dela aparece como veio
  $('gargalos').innerHTML = `${ins.filtro?.aviso ? `<p class="aviso">${esc(ins.filtro.aviso)}</p>` : ''}<p class="kpis-sec">Base inteira · tarefas abertas sem prazo <b>${ins.pct_sem_prazo}%</b> (${fmt(ins.tarefas_abertas)} abertas) · ações sem responsável${fAtual ? ' no filtro' : ''} <b>${fmt(ins.sem_responsavel)}</b></p>
    <div class="grade">${tabela('Por regra', ['Regra', 'Ações', 'Prioridade média'], ins.por_regra.map(r => [r.regra, fmt(r.n), r.score_medio]))}${tabela('Por squad', ['Squad', 'Ações'], ins.por_squad.map(s => [s.squad, fmt(s.n)]))}</div>`
}

// ── jobs ────────────────────────────────────────────────────────────────────
function travar(on) {
  for (const id of ['btnGerar', 'btnPrevia', 'btnDistribuir', 'btnRelAntecipar']) { $(id).disabled = on || (id === 'btnDistribuir' && !previaOk); $(id).toggleAttribute('aria-busy', on) }
  // escopo congelado durante um job: mudar seleção no meio invalidaria a pré-visualização
  for (const el of document.querySelectorAll('#tipos button, #selSquad, #selConsultor, #scoreMin, #listaCli input, #marcarVis, #limpar, #busca')) el.disabled = on
}
async function acompanhar(jobId, rotulo) {
  $('job').hidden = false; travar(true)
  try {
    for (;;) {
      const j = await api('/api/planos/job/' + jobId)
      const { feitos, total, cliente } = j.progresso
      $('jobTxt').textContent = `${rotulo}: ${feitos}/${total || '…'}${cliente ? ' · ' + cliente : ''}`
      $('jobBarra').style.width = total ? Math.round(100 * feitos / total) + '%' : '5%'
      if (j.estado !== 'rodando') return j
      await new Promise(r => setTimeout(r, 1500))
    }
  } finally { travar(false); $('job').hidden = true; $('jobBarra').style.width = '0' }
}
const avisoErro = m => { $('resultado').innerHTML = `<div class="aviso erro"><b>Não foi possível concluir</b> ${esc(m)}</div>` }
const iniciarJob = async (url, body, rotulo) => { try { const { job } = await api(url, body); return await acompanhar(job, rotulo) } catch (e) { travar(false); avisoErro(e.message); return null } }

$('btnGerar').onclick = async () => {
  const j = await iniciarJob('/api/planos/gerar', { escopo: escopo() }, 'Gerando planos')
  if (!j) return
  if (j.estado === 'erro') avisoErro(j.erro)
  else { const r = j.resultado; $('resultado').innerHTML = `<div class="aviso ok"><b>${plural(r.length, 'plano gerado', 'planos gerados')}</b>: ${r.reduce((s, x) => s + x.novas, 0)} ação(ões) nova(s), ${r.reduce((s, x) => s + x.mantidas, 0)} mantida(s). Revise as ações e depois pré-visualize.</div>` }
  atualizar()
}
$('btnPrevia').onclick = async () => {
  const j = await iniciarJob('/api/planos/distribuir', { escopo: escopo(), scoreMin: Number($('scoreMin').value), confirmar: false }, 'Pré-visualizando (nada é criado)')
  if (!j) return
  if (j.estado === 'erro') return avisoErro(j.erro)
  const r = j.resultado
  window.__previa = r; previaOk = assinatura(); previaIds = new Set(r.a_criar.map(a => a.id))
  $('btnDistribuir').disabled = !r.a_criar.length
  $('btnDistribuir').textContent = r.a_criar.length ? `Criar ${plural(r.a_criar.length, 'tarefa', 'tarefas')} no Notion` : 'Criar tarefas no Notion'
  const quem = Object.entries(r.a_criar.reduce((m, x) => (m[x.origem_responsavel || 'sem responsável'] = (m[x.origem_responsavel || 'sem responsável'] || 0) + 1, m), {})).map(([k, v]) => `${v} × ${esc(k)}`).join(' · ') || '—'
  $('resultado').innerHTML = `<div class="aviso"><b>Pré-visualização: nada foi criado.</b>
    ${plural(r.a_criar.length, 'tarefa seria criada', 'tarefas seriam criadas')} em ${plural(r.clientes, 'quadro', 'quadros')} · ${r.ja_existiam.length} já existem (não duplicam) · ${r.sem_usuario_notion} sem usuário do Notion identificado (responsável citado na descrição) · ${plural(r.erros.length, 'cliente com erro', 'clientes com erro')}.
    <div class="mini">Quem recebe: ${quem}</div>
    ${r.erros.length ? `<details open><summary>erros</summary>${r.erros.slice(0, 15).map(e => `<div class="mini">${esc(e.cliente)}: ${esc(e.erro)}</div>`).join('')}</details>` : ''}
    ${r.avisos.length ? `<details><summary>${r.avisos.length} aviso(s) de campos</summary>${[...new Set(r.avisos)].slice(0, 40).map(a => `<div class="mini">${esc(a)}</div>`).join('')}</details>` : ''}
    ${r.exemplo ? `<div class="mini mt-2">Exemplo: ${esc(r.exemplo.id)} · ${esc(r.exemplo.cliente)} · ${esc(r.exemplo.titulo)} · responsável ${esc(r.exemplo.responsavel)} · prazo ${brData(r.exemplo.prazo)} · campos ${esc(r.exemplo.propriedades.join(', '))}</div>` : ''}</div>`
  if (clientesAtuais) desenharResumo()
  renderAcoes()
}
$('btnDistribuir').onclick = async () => {
  if (previaOk !== assinatura()) return toast('O escopo mudou depois da pré-visualização. Pré-visualize de novo.', 'erro')
  const r0 = window.__previa
  const ok = await confirmar({ titulo: `Criar ${plural(r0.a_criar.length, 'tarefa', 'tarefas')} no Notion?`, texto: `Em ${plural(r0.clientes, 'quadro', 'quadros')} de clientes. A leitura do sistema é proposta, não verdade: valide os falsificadores na visão por cliente e descarte o que não fizer sentido. Os consultores citados serão atribuídos e o Notion os notifica. Dá para desfazer pela lixeira do Notion.`, rotuloOk: 'Criar tarefas' })
  if (!ok) return
  const j = await iniciarJob('/api/planos/distribuir', { escopo: escopo(), ids: r0.a_criar.map(a => a.id), confirmar: true }, 'Criando tarefas no Notion')   // só os ids pré-visualizados
  if (!j) return
  if (j.estado === 'erro') return avisoErro(j.erro)
  const r = j.resultado
  $('resultado').innerHTML = `<div class="aviso ${r.erros.length ? 'erro' : 'ok'}"><b>${plural(r.criadas.length, 'tarefa criada', 'tarefas criadas')} no Notion</b> · ${r.ja_existiam.length} já existiam · ${r.erros.length} erro(s).
    ${r.erros.slice(0, 15).map(e => `<div class="mini">${esc(e.cliente)}${e.id ? ' ' + esc(e.id) : ''}: ${esc(e.erro)}</div>`).join('')}</div>`
  toast(`${plural(r.criadas.length, 'tarefa criada', 'tarefas criadas')} no Notion.`)
  previaOk = null; atualizar()
}
$('btnEquipe').onclick = async () => {
  fecharMenu($('btnEquipe')); $('btnEquipe').disabled = true
  try { const r = await api('/api/planos/equipe/sincronizar', {}); await carregarEquipe(); await atualizar(); toast(`Equipe atualizada: ${r.clientes} cliente(s) lidos da central.`) }
  catch (e) { toast('Falhou: ' + e.message, 'erro') } finally { $('btnEquipe').disabled = false }
}

// ── relatório curto ao Notion do cliente (relatorio.js): envio antecipado, frequência em lote, envio por linha e tabela de programação ──
const clientesDoEscopo = () => (clientesAtuais || []).map(c => c.cliente)
const aposRelatorio = () => window.PSRelatorio?.montarTabela().then(() => { if (clientesAtuais) renderClientes() }).catch(() => {})
$('btnRelAntecipar').onclick = () => PSRelatorio.lote(clientesDoEscopo(), { aoConcluir: aposRelatorio })
$('btnRelFrequencia').onclick = () => { fecharMenu($('btnRelFrequencia')); PSRelatorio.frequenciaEmLote(clientesDoEscopo(), { aoConcluir: aposRelatorio }) }
$('tbClientes').addEventListener('click', e => { const b = e.target.closest('[data-rel-cliente]'); if (b) PSRelatorio.enviarAgora(b.dataset.relCliente, { aoConcluir: aposRelatorio }) })
// ── respostas dos clientes ao relatório (GET /api/feedback, POST /api/feedback/coletar e /api/feedback/status): só leitura + marcação interna; nada vai ao cliente ──
const FB_TEMA = { vendas: 'Vendas', estoque_reposicao: 'Estoque e reposição', compras: 'Compras', full: 'Full', logistica: 'Logística', anuncios: 'Anúncios', ads: 'Ads', preco_promocao: 'Preço e promoção',
  concorrencia: 'Concorrência', margem_custos: 'Margem e custos', previsao: 'Previsão', formato_frequencia: 'Formato e frequência', elogio: 'Elogio', critica: 'Crítica', duvida: 'Dúvida' }
const FB_STATUS = { novo: ['atencao', 'Nova'], revisado: ['neutro', 'Revisada'], implementar: ['bom', 'Implementar'], descartado: ['neutro', 'Descartada'] }
const FB_ACAO = [['revisado', 'Marcar como revisada'], ['implementar', 'Marcar para implementar'], ['descartado', 'Descartar']]
let fbTema = ''
const fbPor = async titulo => { let n = window.PS?.quem?.().nome || ''; try { n = n || localStorage.getItem('ps_perfil_por') || '' } catch { /* sem armazenamento */ } return n || (await window.PSRelatorio?.ui?.pedirPor({ titulo, texto: 'Fica registrado quem decidiu.', rotuloOk: 'Continuar' })) || '' }
async function montarFeedback() {
  const tb = $('tbFeedback'); if (!tb) return
  let r
  try { r = await api(`/api/feedback?${new URLSearchParams({ status: $('fbStatus').value, tema: fbTema })}`) } catch (e) { tb.innerHTML = `<tr><td colspan="6">${erroBloco(e, 'feedback')}</td></tr>`; return }
  const pt = r.resumo.por_tema, novas = r.resumo.por_status?.novo || 0
  $('nFeedback').textContent = novas ? fmt(novas) : ''                 // contador do título = respostas ainda não revisadas
  $('fbResumo').textContent = `${plural(r.total, 'resposta', 'respostas')} no recorte · ${plural(r.resumo.por_cliente.length, 'cliente', 'clientes')} · ${fmt(r.resumo.por_status?.novo || 0)} nova(s) · ${fmt(r.resumo.sem_tema)} sem tema`
  $('fbTemas').innerHTML = `<button type="button" data-fb-tema="" class="${fbTema ? '' : 'on'}">Todos ${fmt(r.total)}</button>` + r.temas.filter(t => pt[t] || t === fbTema).map(t => `<button type="button" data-fb-tema="${esc(t)}" class="${t === fbTema ? 'on' : ''}">${esc(FB_TEMA[t] || t)} ${fmt(pt[t])}</button>`).join('')
  $('fbColeta').textContent = !r.coleta.configurado ? 'Coleta pelo n8n não configurada (PLACE_GATILHOS_URL/SECRET).' : r.coleta.ultima ? `Última coleta ${new Date(r.coleta.ultima).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${plural(r.coleta.clientes_com_grupo, 'grupo', 'grupos')} do Mercado Livre` : `Nenhuma coleta ainda · ${plural(r.coleta.clientes_com_grupo, 'grupo', 'grupos')} do Mercado Livre`
  tb.innerHTML = r.itens.length ? r.itens.map(i => `<tr><td><a href="/cliente?cliente=${encodeURIComponent(i.cliente)}&amp;aba=resumo">${esc(i.cliente)}</a>${i.autor_nome ? `<div class="mini">${esc(i.autor_nome)}</div>` : ''}</td>
    <td>${esc(i.recebido_em.length === 10 ? brData(i.recebido_em) : new Date(i.recebido_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}<div class="mini">${i.origem === 'equipe' ? 'colhido pela equipe' : i.ancora_tipo === 'pergunta' ? 'à pergunta' : 'ao plano'}</div></td>
    <td>${i.texto ? esc(i.texto) : '<span class="mini">Texto apagado ao descartar.</span>'}${i.nota_interna ? `<div class="mini">Nota: ${esc(i.nota_interna)}</div>` : ''}</td>
    <td>${i.temas.length ? i.temas.map(t => `<span class="selo neutro">${esc(FB_TEMA[t] || t)}</span>`).join(' ') : '—'}</td>
    <td><span class="selo ${i.confianca === 'certa' ? 'bom' : 'neutro'}">${i.origem === 'equipe' ? 'Equipe (conversa)' : i.confianca === 'certa' ? 'Certa (citou)' : 'Provável'}</span></td>
    <td><span class="selo ${(FB_STATUS[i.status] || ['neutro'])[0]}">${esc((FB_STATUS[i.status] || [0, i.status])[1])}</span>
      ${i.status === 'descartado' ? '' : `<details class="menu"><summary class="btn btn-p" aria-label="Mudar a situação da resposta">⋯</summary><div class="menu-lista">${FB_ACAO.filter(([st]) => st !== i.status).map(([st, rot]) => `<button type="button" data-fb-msg="${esc(i.msg_id)}" data-fb-st="${st}">${rot}</button>`).join('')}</div></details>`}</td></tr>`).join('')
    : `<tr><td colspan="6" class="vazio"><b>Nenhuma resposta guardada${fbTema || $('fbStatus').value ? ' neste recorte' : ''}.</b> ${r.coleta.configurado ? 'Use «Coletar respostas agora» depois de enviar o plano ou a pergunta.' : 'A coleta precisa do n8n configurado.'}</td></tr>`
}
$('fbStatus').addEventListener('change', montarFeedback)
$('fbTemas').addEventListener('click', e => { const b = e.target.closest('[data-fb-tema]'); if (!b) return; fbTema = b.dataset.fbTema; montarFeedback() })
$('tbFeedback').addEventListener('click', async e => {
  const b = e.target.closest('[data-fb-msg]'); if (!b) return
  fecharMenu(b)
  const por = await fbPor('Mudar a situação da resposta'); if (!por) return
  try { await api('/api/feedback/status', { msg_id: b.dataset.fbMsg, status: b.dataset.fbSt, por }); toast('Situação atualizada.') } catch (x) { toast(x.message, 'erro') } finally { montarFeedback() }
})
$('btnFbColetar').onclick = async () => {
  const b = $('btnFbColetar'), por = await fbPor('Coletar as respostas dos clientes'); if (!por) return
  b.disabled = true
  try {
    const x = await api('/api/feedback/coletar', { por })
    toast(x.motivo === 'n8n_nao_configurado' ? 'Coleta pelo n8n não configurada.' : x.motivo === 'coleta_em_andamento' ? 'Já há uma coleta em andamento.'
      : `${plural(x.lidas, 'mensagem lida', 'mensagens lidas')}, ${plural(x.guardadas, 'resposta nova guardada', 'respostas novas guardadas')}${x.ok ? '' : ' · algum grupo falhou, tente de novo mais tarde'}.`, x.ok ? undefined : 'erro')
  } catch (x) { toast(x.message, 'erro') } finally { b.disabled = false; montarFeedback() }
}
RETRY.feedback = montarFeedback
// clientes em risco + chave do dossiê mensal (src/web/dossie.js → GET /api/risco); só leitura até alguém marcar, encerrar ou ligar a chave
const montarRisco = () => window.PSDossie?.montarPlanos($('riscoPlanos'))
RETRY.risco = montarRisco
// o que os clientes querem receber (src/web/perfil-informacao.js → GET /api/perfil-informacao/matriz); só leitura — o perfil se edita em /cliente › Configurar
const montarPerfilInfo = () => window.PSPerfilInfo?.montarPlanos($('perfilInfoPlanos'))
RETRY.perfilInfo = montarPerfilInfo
montarFeedback().catch(() => {})
montarRisco()
montarPerfilInfo()
if (window.PSAlertas) PSAlertas.montarTabela().catch(() => {})
if (window.PSGatilhos) PSGatilhos.montarPlanos().catch(() => {})
if (window.PSRelatorio) { PSRelatorio.montarTabela().then(() => { if (clientesAtuais) renderClientes() }).catch(() => {}) }

carregarPrestadores(); carregarEquipe().then(atualizar).catch(e => { avisoErro(e.message); $('veredito').textContent = 'Não foi possível ler a equipe.'; $('kpis').innerHTML = ''; $('tbAcoes').innerHTML = ''; $('tbClientes').innerHTML = '' })
