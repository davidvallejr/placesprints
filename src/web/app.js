/* Painel executivo Place Sprints — 100% determinístico (nenhuma chamada de IA aqui). */
const $ = s => document.querySelector(s)
const tk = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim()
const CORES = { serie: tk('laranja'), planejado: tk('cinza'), ideal: tk('borda-campo'), barra: tk('cinza'), semana: tk('cinza-claro'), grade: tk('borda'), tinta: tk('tinta'), superficie: tk('superficie') }
const corStatus = { nao_iniciada: tk('cinza-claro'), andamento: tk('azul'), validacao: tk('roxo'), concluida: tk('verde'), bloqueada: tk('verm'), dependencia_cliente: tk('ambar'), cancelada: tk('borda-campo') }
const rotStatus = { nao_iniciada: 'Não iniciada', andamento: 'Em andamento', validacao: 'Em validação', concluida: 'Concluída', bloqueada: 'Bloqueada', dependencia_cliente: 'Dependência do cliente', cancelada: 'Cancelada' }   // espelho de src/lib/status-tarefa.js
const graficos = {}
const TEM_CHART = !!window.Chart
if (TEM_CHART) {
  if (window.ChartDataLabels) { Chart.register(ChartDataLabels); Chart.defaults.plugins.datalabels.display = false }   // sem o plugin (CDN parcial) o defaults.datalabels não existe: só mexe nele depois do register
  Chart.defaults.font.family = tk('fonte')
  Chart.defaults.font.weight = 500
  Chart.defaults.color = tk('cinza')
  Chart.defaults.borderColor = CORES.grade
}

const br = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmt = n => Number(n ?? 0).toLocaleString('pt-BR')
const hoje = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()
const toast = (texto, tipo) => window.PS?.toast ? PS.toast(texto, tipo) : alert(texto)

function filtros() {
  const f = {
    cliente: $('#fCliente').value, projeto: $('#fProjeto').value, sprint: $('#fSprint').value,
    processo: $('#fProcesso').value, responsavel: $('#fResponsavel').value, status: $('#fStatus').value,
    de: $('#fDe').value, ate: $('#fAte').value,
  }
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v))
}
// filtro avançado (PSFiltros): ?f= vai junto dos selects em TODAS as chamadas e nos links de relatório; selects e f valem em paralelo (E)
const fDaUrl = (() => { const f = new URLSearchParams(location.search).get('f'); try { return f && JSON.parse(decodeURIComponent(escape(atob(f.replace(/-/g, '+').replace(/_/g, '/'))))).p === 'execucao' ? f : null } catch { return null } })()
let fAvancado = fDaUrl
const qs = () => new URLSearchParams({ ...filtros(), ...(fAvancado ? { f: fAvancado } : {}) }).toString()
// seletores e inputs do componente de filtros ficam dentro de .filtros mas não são filtros simples: não disparam atualizar nem entram no Limpar
const camposSimples = () => document.querySelectorAll('.filtros select:not(.flt *), .filtros input:not(.flt *)')
async function getJson(url, opts) {
  const r = await fetch(url, opts)
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`)
  return r.json()
}

// sprint atual = último da ordem que não seja futuro (decisão do CEO, spec 8.7)
let sprintAtual = ''
async function carregarOpcoes() {
  const o = await getJson('/api/opcoes')
  const encher = (sel, itens) => {
    const atual = sel.value
    sel.length = 1
    for (const v of itens) sel.add(new Option(v, v))
    sel.value = atual
  }
  encher($('#fCliente'), o.clientes); encher($('#fProjeto'), o.projetos)
  const ordem = o.ordem_sprints.length ? o.ordem_sprints : o.sprints
  encher($('#fSprint'), ordem)
  encher($('#fProcesso'), o.processos); encher($('#fResponsavel'), o.responsaveis)
  const mes = hoje.slice(0, 7)
  sprintAtual = [...o.ordem_sprints].reverse().find(s => (s.match(/\d{4}-\d{2}/) || [])[0] <= mes) || ''
}

// ---- estados por bloco (5.8): skeleton → conteúdo | erro com [Tentar de novo]
const skeleton = { kpi: '<div class="sk-kpi"></div>'.repeat(4), linha: '<div class="sk-linha"></div>', graf: '<div class="sk-graf"></div>', tabela: '<div class="sk-tabela"></div>', cartoes: '<div class="skeleton"></div>'.repeat(3) }
function erroHtml(e, texto = 'Confira a conexão com o servidor e tente de novo.') {
  return `<div class="erro-bloco"><b>Não foi possível carregar</b>${esc(texto)}<br><button type="button" class="btn btn-p" data-retry>Tentar de novo</button><details><summary>Detalhe técnico</summary><pre>${esc(e?.message || e)}</pre></details></div>`
}
// ponytail: Tentar de novo recarrega a tela inteira (um fetch por API, sem cache por bloco)
document.addEventListener('click', e => { if (e.target.closest('[data-retry]')) atualizar() })
function carregando(el, sk, ...esconder) { el.innerHTML = sk; el.setAttribute('aria-busy', 'true'); esconder.forEach(x => { x.hidden = true }) }
function pronto(el, ...mostrar) { el.innerHTML = ''; el.removeAttribute('aria-busy'); mostrar.forEach(x => { x.hidden = false }) }
function falhou(el, e, ...esconder) { el.innerHTML = erroHtml(e); el.removeAttribute('aria-busy'); esconder.forEach(x => { x.hidden = true }) }

function grafico(id, cfg) {
  graficos[id]?.destroy()
  graficos[id] = new Chart(document.getElementById(id), cfg)
}
function kpiHtml(rotulo, valor, extra, tom) {
  return `<div class="kpi ${tom || ''}"><div class="v">${valor}</div><div class="r">${rotulo}</div>${extra ? `<div class="e">${extra}</div>` : ''}</div>`
}
const pp = d => `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)} p.p.`
const regua = (valor, marco, rotulo, rotuloMarco) => { if (window.PS?.regua) PS.regua('regua', { valor, marco: marco ?? NaN, rotulo, rotuloMarco }); else $('#regua').hidden = true }

// ---- cabeçalho: meta-linha e links de relatório
function cabecalho(q) {
  const sprint = $('#fSprint').value
  $('#estadoSprint').innerHTML = !sprint ? 'Carteira inteira' : sprint === sprintAtual
    ? 'Sprint atual · <button type="button" class="nome-btn" id="btnTrocarSprint">trocar</button>' : esc(sprint)
  $('#btnTrocarSprint')?.addEventListener('click', () => $('#fSprint').focus())

  $('#lnkRelatorio').href = '/relatorio?' + q
  $('#lnkPdf').href = '/relatorio.pdf?' + q
  const ligar = (a, href, titulo) => {
    const motivo = a.querySelector('small')
    if (href) { a.href = href; a.removeAttribute('aria-disabled'); a.title = titulo } else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.title = '' }
    if (motivo) motivo.hidden = !!href
  }
  const cli = $('#fCliente').value, resp = $('#fResponsavel').value
  ligar($('#lnkSemanal'), cli && '/semanal?cliente=' + encodeURIComponent(cli), 'Relatório semanal de ' + cli)
  ligar($('#lnkMatriz'), resp && '/matriz?responsavel=' + encodeURIComponent(resp), 'Matriz Eisenhower de ' + resp + ' (uso interno)')

  const ativos = ['#fProjeto', '#fProcesso', '#fStatus', '#fDe', '#fAte'].filter(s => $(s).value).length
  $('#maisFiltros').textContent = ativos ? `Mais filtros (${ativos})` : 'Mais filtros'
}

async function estado() {
  const [e, meli] = await Promise.all([getJson('/api/estado').catch(() => null), getJson('/api/meli/conexoes').catch(() => [])])
  if (e) {
    const min = e.ultimo_sync ? Math.round((Date.now() - new Date(e.ultimo_sync)) / 60000) : null
    const ha = min === null ? '' : min < 60 ? `há ${min} min` : min < 48 * 60 ? `há ${Math.round(min / 60)} h` : `em ${br(e.ultimo_sync)}`
    $('#estadoSync').textContent = e.ultimo_sync ? `Notion sincronizado ${ha} · ${fmt(e.tarefas)} tarefas`
      : (e.notion_configurado ? 'Nunca sincronizado: clique em Reler o Notion' : 'Sem NOTION_TOKEN (modo demo)')
  } else $('#estadoSync').textContent = 'Estado do Notion indisponível'
  const totalClientes = Math.max(0, $('#fCliente').options.length - 1)
  $('#estadoMeli').textContent = `${meli.filter(c => !c.erro).length} de ${totalClientes} contas ML conectadas`
}

// ---- veredito, KPIs e próxima ação (precisam de kpis + burnup)
async function resumo(pK, pG, q) {
  const ver = $('#veredito'), kp = $('#kpis'), sec = $('#kpisSec'), prox = $('#proxima')
  carregando(ver, skeleton.linha); carregando(kp, skeleton.kpi); sec.textContent = ''; prox.hidden = true
  let k
  try { k = await pK } catch (e) { pronto(ver); falhou(kp, e); regua(NaN); return }
  const g = await pG.catch(() => null)
  const sprint = $('#fSprint').value, vazio = k.planejadas === 0
  // ritmo ideal só faz sentido dentro de um sprint: o burnup da carteira inteira mistura sprints e o ideal chega a 100%
  const b = g?.burnup, temRitmo = sprint && b && b.dias.length > 1 && b.planejado.at(-1) > 0
  const idealPct = temRitmo ? Math.round(b.ideal.at(-1) / b.planejado.at(-1) * 100) : null
  const delta = idealPct === null ? null : k.pct_conclusao - idealPct
  // sem responsável: só abertas, o mesmo critério dos grupos de risco (k.sem_responsavel conta concluídas e canceladas)
  const semDono = g?.riscos?.sem_responsavel?.length ?? k.sem_responsavel
  const pedem = k.bloqueadas + k.atrasadas + semDono

  // veredito (8.4: quando falta dado, diz o que falta)
  pronto(ver)
  if (vazio) ver.textContent = 'Nenhuma tarefa neste recorte. Limpe os filtros ou sincronize com o Notion.'
  else if (!sprint) {
    const periodo = fAvancado || $('#fDe').value || $('#fAte').value
    ver.textContent = `Carteira inteira ${periodo ? 'no período filtrado' : 'desde 2024'}. Escolha um sprint para ler o ritmo.`
  } else {
    const ritmo = delta === null ? '' : delta === 0 ? ' está <b>no ritmo ideal</b>' : ` está <b>${Math.abs(delta)} p.p. ${delta < 0 ? 'abaixo' : 'acima'} do ritmo ideal</b>`
    ver.innerHTML = `${esc(sprint)}${ritmo}. ${pedem ? `<b>${fmt(pedem)} tarefas</b> pedem ação.` : 'Nada pede ação agora.'}`
  }
  // régua: conclusão real × ritmo ideal do sprint (proporção real; sem sprint ou sem planejado ela some)
  regua(sprint && !vazio ? k.pct_conclusao : NaN, idealPct, `${k.pct_conclusao}% concluído`, idealPct === null ? 'sem histórico de ritmo' : `ritmo ideal hoje ${idealPct}%`)

  // KPIs (no máximo 4)
  const detConclusao = !sprint ? 'escolha um sprint para ler o ritmo' : idealPct === null ? 'sem histórico de ritmo' : `ritmo ideal hoje ${idealPct}% · <span class="${delta < 0 ? 'neg' : 'pos'}">${pp(delta)}</span>`
  pronto(kp)
  kp.innerHTML = vazio ? [
    kpiHtml('Conclusão', '—', 'sem tarefas no recorte'), kpiHtml('Entregues', '0', 'de 0 planejadas'), kpiHtml('Bloqueadas', '0'), kpiHtml('Com evidência', '—', 'sem entregas'),
  ].join('') : [
    kpiHtml('Conclusão', k.pct_conclusao + '%', detConclusao, k.pct_conclusao >= 70 ? 'bom' : k.pct_conclusao >= 40 ? 'alerta' : 'risco'),
    kpiHtml('Entregues', fmt(k.concluidas), `de ${fmt(k.planejadas)} planejadas`),
    kpiHtml('Bloqueadas', fmt(k.bloqueadas), k.bloqueadas ? 'travam entrega agora — impedimento interno' : 'nenhuma trava a entrega', k.bloqueadas ? 'risco' : ''),
    kpiHtml('Com evidência', k.cobertura_evidencias + '%', `${fmt(k.com_evidencia)} entregas comprovadas`, k.cobertura_evidencias >= 70 ? 'bom' : 'alerta'),
  ].join('')
  const comPrazo = k.planejadas - k.sem_prazo
  // dependência do cliente fica fora de "pedem ação": a cobrança é do consultor, não um risco da equipe
  sec.innerHTML = vazio ? '' : [`Em andamento <b>${fmt(k.andamento)}</b>`, `Atrasadas <b>${fmt(k.atrasadas)}</b> (só ${fmt(comPrazo)} têm prazo)`, `Depende do cliente <b>${fmt(k.dependencia_cliente)}</b> (${fmt(k.dependencia_14d)} há 14+ dias)`, `Esforço <b>${k.pct_esforco}%</b>`]
    .concat(k.transferidas > 0 ? [`Transferidas <b>${fmt(k.transferidas)}</b>`] : []).join(' · ')
  if (vazio) return   // sem tarefa não há próxima ação nem relatório para gerar: #proxima fica hidden (carregando já escondeu)

  // próxima ação: liga um chip de verdade na tabela e leva o foco até ela
  const alvo = k.bloqueadas ? ['bloqueadas', 'Destravar as bloqueadas primeiro', `Ver as ${fmt(k.bloqueadas)} bloqueadas`]
    : k.atrasadas ? ['atrasadas', 'Prazos estourados', `Ver as ${fmt(k.atrasadas)} atrasadas`]
    : semDono ? ['sem_responsavel', 'Tarefas sem dono', `Ver as ${fmt(semDono)} sem responsável`]
    : k.dependencia_14d ? ['dependencia_cliente', 'Cobrar o cliente: aguardam retorno há 14+ dias', `Ver as ${fmt(k.dependencia_cliente)} que dependem do cliente`] : null   // 4ª prioridade: só quando as três acima são zero
  // F5 (21/10/2026): o primário abre o Hoje (/fila) de quem está usando; o chip que filtra a tabela abaixo fica como secundário
  const porFila = (() => { try { return window.PS?.quem?.().papel || 'lider' } catch { return 'lider' } })()
  $('#proximaTexto').textContent = alvo ? alvo[1] : 'Nada pede ação agora.'
  $('#proximaAcao').innerHTML = `<a class="btn btn-primario" href="/fila?por=${encodeURIComponent(porFila)}">Abrir o Hoje</a>` + (alvo ? ` <button type="button" class="btn" data-chip="${alvo[0]}">${alvo[2]}</button>`
    : ` <a class="btn" href="/relatorio?${q}" target="_blank" rel="noopener">Relatório do sprint</a>`)
  prox.hidden = false
}

// ---- grupos de risco e qualidade do dado
const diasDesde = iso => Math.max(0, Math.round((Date.parse(hoje) - Date.parse(iso)) / 86_400_000))
const metaRisco = t => `${esc(t.responsavel || 'sem responsável')}${t.prazo ? ' · ' + br(t.prazo) : ''}`
// dependência do cliente: o que importa é há quanto tempo espera (campo desde de riscos.dependencia_cliente), e o grupo não leva o ponto vermelho
const metaDependencia = t => t.desde ? `desde ${fmt(diasDesde(t.desde))} dias (${br(t.desde)})` : 'sem data de início registrada'
function grupoHtml(chave, rotulo, itens, sub, { meta = metaRisco, tom = itens.length ? 'ruim' : 'ok' } = {}) {
  const lista = itens.slice(0, 6).map(t => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.titulo)}</a>
    <div class="meta">${meta(t)}</div></li>`).join('')
  return `<div class="risco-grupo ${tom}">
    <h3>${rotulo} <span class="n">${fmt(itens.length)}</span></h3>${sub ? `<p class="sub">${sub}</p>` : ''}
    <ul>${lista || '<li class="meta">Nenhuma</li>'}</ul>
    ${itens.length > 6 && chave ? `<button type="button" class="btn btn-fantasma btn-p mt-2" data-chip="${chave}">Ver todas (${fmt(itens.length)})</button>` : ''}
  </div>`
}
async function riscos(pG, pK) {
  const el = $('#riscos'), ql = $('#qualidadeLista')
  carregando(el, skeleton.cartoes); ql.innerHTML = ''
  let g
  try { g = await pG } catch (e) { falhou(el, e); return }
  const k = await pK.catch(() => null)
  const r = g.riscos
  pronto(el)
  el.innerHTML = [
    grupoHtml('bloqueadas', 'Bloqueadas', r.bloqueadas || []),
    grupoHtml('atrasadas', 'Atrasadas', r.atrasadas || [], k ? `só ${fmt(k.planejadas - k.sem_prazo)} de ${fmt(k.planejadas)} têm prazo` : ''),
    grupoHtml('sem_responsavel', 'Sem responsável', r.sem_responsavel || []),
    grupoHtml('dependencia_cliente', 'Depende do cliente', r.dependencia_cliente || [], 'fora do backlog ativo — a cobrança é do consultor', { meta: metaDependencia, tom: r.dependencia_cliente?.length ? '' : 'ok' }),
  ].join('')
  const sp = r.sem_prazo || [], se = r.sem_evidencia || []
  $('#nQualidade').textContent = `sem prazo ${fmt(k?.sem_prazo ?? sp.length)} · sem evidência ${fmt(k?.sem_evidencia ?? se.length)}`
  ql.innerHTML = grupoHtml('', 'Sem prazo', sp) + grupoHtml('', 'Concluídas sem evidência', se)
}

// ---- gráficos
const semChart = el => { el.innerHTML = '<div class="erro-bloco"><b>Gráficos indisponíveis sem internet</b>O restante da tela continua funcionando.</div>'; el.removeAttribute('aria-busy') }
async function ritmo(pG) {
  const el = $('#estadoBurnup'), cv = $('#gBurnup'), vazio = $('#vazioBurnup')
  carregando(el, skeleton.graf, cv, vazio)
  let g
  try { g = await pG } catch (e) { falhou(el, e, cv, vazio); return }
  const b = g.burnup, tem = b.dias.length > 1
  if (!tem) { pronto(el, vazio); cv.hidden = true; return }
  if (!TEM_CHART) { semChart(el); return }
  pronto(el, cv); vazio.hidden = true
  const ultimo = ctx => ctx.dataIndex === ctx.dataset.data.length - 1
  grafico('gBurnup', {
    type: 'line',
    data: { labels: b.dias.map(d => br(d).slice(0, 5)), datasets: [
      { label: 'Concluído', data: b.concluido, borderColor: CORES.serie, backgroundColor: CORES.serie, borderWidth: 2, pointRadius: 2, tension: .2 },
      { label: 'Planejado', data: b.planejado, borderColor: CORES.planejado, backgroundColor: CORES.planejado, borderWidth: 1.5, pointRadius: 0, tension: .2, datalabels: { align: 315 } },
      { label: 'Ritmo ideal', data: b.ideal, borderColor: CORES.ideal, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, datalabels: { align: 45 } },   // ideal e planejado se encontram no fim: rótulos em diagonais opostas
    ]},
    options: { layout: { padding: { right: 84 } }, plugins: { legend: { display: false },
      datalabels: { display: ultimo, align: 'right', anchor: 'end', offset: 6, clip: false, color: CORES.tinta, formatter: (v, ctx) => ctx.dataset.label } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: CORES.grade } }, x: { grid: { display: false } } } },
  })
}
async function processos(pG) {
  const el = $('#estadoProcessos'), cv = $('#gProcessos')
  carregando(el, skeleton.graf, cv)
  let g
  try { g = await pG } catch (e) { falhou(el, e, cv); return }
  if (!TEM_CHART) { semChart(el); return }
  pronto(el, cv)
  const procs = [...g.processos].sort((a, b) => b.total - a.total).slice(0, 8)
  grafico('gProcessos', {
    type: 'bar',
    data: { labels: procs.map(p => p.processo), datasets: [{ label: '% concluído', data: procs.map(p => p.pct), backgroundColor: CORES.barra, borderRadius: 4 }] },
    options: { indexAxis: 'y', layout: { padding: { right: 96 } }, plugins: { legend: { display: false },
      datalabels: { display: true, anchor: 'end', align: 'end', clip: false, color: CORES.tinta, formatter: (v, c) => `${v}% (${fmt(procs[c.dataIndex].concluidas)}/${fmt(procs[c.dataIndex].total)})` } },
      scales: { x: { max: 100, grid: { color: CORES.grade } }, y: { grid: { display: false } } } },
  })
}
async function semanas(pG) {
  const el = $('#estadoSemanas'), cv = $('#gSemanas')
  carregando(el, skeleton.graf, cv)
  let g
  try { g = await pG } catch (e) { falhou(el, e, cv); return }
  if (!TEM_CHART) { semChart(el); return }
  pronto(el, cv)
  const sem = g.semanas.filter(s => s.semana <= hoje).slice(-12)
  grafico('gSemanas', {
    type: 'bar',
    data: { labels: sem.map(s => br(s.semana).slice(0, 5)), datasets: [{ label: 'Entregas', data: sem.map(s => s.n), backgroundColor: CORES.semana, borderRadius: 4 }] },
    options: { plugins: { legend: { display: false }, datalabels: { display: true, anchor: 'end', align: 'top', color: CORES.tinta } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grace: '10%', grid: { color: CORES.grade } }, x: { grid: { display: false } } } },
  })
}
async function distribuicao(pK, pG) {
  if (!TEM_CHART) return
  const [k, g] = await Promise.all([pK, pG]).catch(() => [])
  if (!k || !g) return
  grafico('gPlanejado', {
    type: 'bar',
    data: { labels: ['Quantidade', 'Esforço'], datasets: [
      { label: 'Planejado', data: [k.planejadas, k.esforco_planejado], backgroundColor: CORES.semana, borderRadius: 4 },
      { label: 'Entregue', data: [k.concluidas, k.esforco_concluido], backgroundColor: CORES.barra, borderRadius: 4 },
    ]},
    options: { plugins: { datalabels: { display: true, anchor: 'end', align: 'top', color: CORES.tinta, formatter: v => fmt(Math.round(v * 10) / 10) } },
      scales: { y: { beginAtZero: true, grace: '10%', grid: { color: CORES.grade } }, x: { grid: { display: false } } } },
  })
  grafico('gStatus', {
    type: 'doughnut',
    data: { labels: g.status.map(s => s.rotulo), datasets: [{ data: g.status.map(s => s.n), backgroundColor: g.status.map(s => corStatus[s.status]), borderColor: CORES.superficie }] },
    options: { aspectRatio: 1.7, plugins: { datalabels: { display: ctx => ctx.dataset.data[ctx.dataIndex] > 0, color: CORES.superficie, formatter: v => fmt(v) } } },   // rosca na mesma altura das barras ao lado
  })
}
$('#distribuicao').addEventListener('toggle', () => { if ($('#distribuicao').open) for (const id of ['gPlanejado', 'gStatus']) graficos[id]?.resize() })

// ---- tabela: busca local, chips e paginação de 50 (tudo no cliente, sem API)
const PAG = 50
let todas = [], chip = 'todas', limite = PAG
const FECHADAS = ['concluida', 'cancelada', 'dependencia_cliente']   // espelho de FECHADAS em src/lib/status-tarefa.js (script sem import)
const atrasada = t => t.prazo && t.prazo < hoje && !FECHADAS.includes(t.status)
const aberta = t => !FECHADAS.includes(t.status)
const regra = { todas: () => true, bloqueadas: t => t.status === 'bloqueada', atrasadas: atrasada, sem_responsavel: t => !t.responsavel && aberta(t), dependencia_cliente: t => t.status === 'dependencia_cliente' }
function visiveis() {
  const termo = $('#qTarefas').value.trim().toLowerCase()
  return todas.filter(regra[chip]).filter(t => !termo || [t.titulo, t.cliente, t.responsavel].some(v => (v || '').toLowerCase().includes(termo)))
}
// seleção em massa lida do DOM (padrão planos.js): checkbox em tarefa aberta e na que já depende do cliente (para registrar o motivo das
// marcadas direto no Notion — a API trata como "já estava", sem PATCH); concluída e cancelada não recebem
const marcadas = () => [...document.querySelectorAll('#tabelaTarefas .sel:checked')].map(i => i.value)
function contarSel() { $('#nSel').textContent = fmt(marcadas().length); $('#selTodas').checked = !!marcadas().length && marcadas().length === document.querySelectorAll('#tabelaTarefas .sel').length }
function desenharTabela() {
  const lista = visiveis(), pagina = lista.slice(0, limite), sel = new Set(marcadas())   // "Mostrar mais" e busca não perdem o que já estava marcado
  $('#nTarefas').textContent = fmt(lista.length)
  $('#tabelaTarefas tbody').innerHTML = pagina.map(t => `<tr>
    <td>${aberta(t) || t.status === 'dependencia_cliente' ? `<input type="checkbox" class="sel" value="${esc(t.id)}" aria-label="Marcar ${esc(t.titulo)}"${sel.has(t.id) ? ' checked' : ''}>` : ''}</td>
    <td><a href="${esc(t.url)}" target="_blank" rel="noopener" title="Abrir no Notion">${esc(t.titulo)}</a></td>
    <td>${esc(t.cliente)}</td><td>${esc(t.sprint)}</td><td>${esc(t.processo)}</td><td>${esc(t.responsavel || '—')}</td>
    <td><span class="tag t-${t.status}">${rotStatus[t.status]}</span></td>
    <td class="${atrasada(t) ? 'atrasada' : ''}">${br(t.prazo)}</td>
    <td class="n">${t.esforco ?? '—'}</td>
    <td class="mudo">${t.status === 'concluida' && !t.data_conclusao ? 'sem data' : ''}</td>
  </tr>`).join('') || `<tr><td colspan="10" class="semdados"><b>Nenhuma tarefa neste filtro.</b>Limpe os filtros ou sincronize com o Notion.</td></tr>`
  contarSel()
  $('#pagTarefas').innerHTML = lista.length > PAG
    ? `1–${fmt(pagina.length)} de ${fmt(lista.length)}${lista.length > limite ? ' · <button type="button" class="btn btn-fantasma btn-p" id="btnMais">Mostrar mais 50</button>' : ''}` : ''
  $('#btnMais')?.addEventListener('click', () => { limite += PAG; desenharTabela() })
  for (const b of document.querySelectorAll('#tarefasLocal .f-chip')) {
    const n = b.querySelector('.n'); if (n) n.textContent = fmt(todas.filter(regra[b.dataset.chip]).length)
    b.classList.toggle('on', b.dataset.chip === chip); b.setAttribute('aria-pressed', String(b.dataset.chip === chip))
  }
}
function ligarChip(nome, focar) {
  chip = nome; limite = PAG; desenharTabela()
  if (focar) { const w = $('#wrapTarefas'); w.scrollIntoView({ behavior: 'smooth', block: 'start' }); w.focus({ preventScroll: true }) }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-chip]'); if (b) ligarChip(b.dataset.chip, !b.closest('#tarefasLocal')) })
$('#qTarefas').addEventListener('input', () => { limite = PAG; desenharTabela() })
async function tarefas(pT) {
  const el = $('#estadoTarefas'), wrap = $('#wrapTarefas')
  carregando(el, skeleton.tabela, wrap); $('#pagTarefas').innerHTML = ''
  try { todas = await pT } catch (e) { falhou(el, e, wrap); return }
  pronto(el, wrap); limite = PAG; desenharTabela()
}
$('#selTodas').addEventListener('change', e => { document.querySelectorAll('#tabelaTarefas .sel').forEach(i => { i.checked = e.target.checked }); contarSel() })
$('#tabelaTarefas').addEventListener('change', e => { if (e.target.classList.contains('sel')) contarSel() })
$('#btnDesmarcar').addEventListener('click', () => { document.querySelectorAll('#tabelaTarefas .sel').forEach(i => { i.checked = false }); contarSel() })

// ---- encerrar por dependência do cliente (lote): prévia ao abrir, escrita no Notion só com confirmar:true no botão primário do diálogo
const api = async (url, body) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || `erro ${r.status}`)
  return j
}
const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k in e) e[k] = v; else e.setAttribute(k, v) } e.append(...filhos.filter(x => x != null)); return e }
const lerPor = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }
const gravarPor = v => { try { localStorage.setItem('ps_perfil_por', v) } catch { /* sem armazenamento: só não lembra o nome */ } }
const semOpcao = i => /não tem a opção/.test(i.motivo)
async function dialogoDependencia() {
  const ids = marcadas(); if (!ids.length) return toast('Marque ao menos uma tarefa.', 'erro')
  const nClientes = new Set(ids.map(id => todas.find(t => t.id === id)?.cliente).filter(Boolean)).size
  const campo = (nome, rotulo, ctrl, ajuda) => el('div', { className: 'campo' }, el('label', { htmlFor: 'dep_' + nome, textContent: rotulo }), Object.assign(ctrl, { id: 'dep_' + nome, name: nome }), ajuda ? el('span', { className: 'ajuda-campo', textContent: ajuda }) : null)
  const selTipo = el('select'), selPor = el('select')
  const txtDetalhe = el('textarea', { required: true, maxLength: 300, rows: 3, placeholder: 'ex.: fotos dos 12 SKUs da linha Pet, pedidas em 25/09' })
  const inpEvid = el('input', { type: 'url', maxLength: 500, placeholder: 'https://…' })
  const previa = el('p', { className: 'mini', textContent: 'Conferindo as tarefas marcadas…', 'aria-live': 'polite' })
  const msg = el('div', { className: 'aviso erro', hidden: true })
  const btnOk = el('button', { className: 'btn btn-primario', type: 'submit', textContent: `Encerrar ${fmt(ids.length)} tarefa(s)`, disabled: true })
  const form = el('form', { method: 'dialog' },
    el('h2', { textContent: 'Encerrar por dependência do cliente' }),
    el('p', { textContent: `As ${fmt(ids.length)} tarefa(s) marcadas (${fmt(nClientes)} cliente(s)) saem do backlog e passam a 'Aguardando Devolutiva do Cliente' no Notion; as que já estão nessa opção só ganham o motivo. Não contam como entregues nem como bloqueadas; o motivo fica registrado e pode aparecer no relatório semanal do cliente como 'Depende de você'.` }),
    previa,
    campo('tipo', 'O que falta do cliente', selTipo),
    campo('detalhe', 'Detalhe — o que exatamente está faltando', txtDetalhe, 'Obrigatório, até 300 caracteres. É o que o cliente vai ler.'),
    campo('evidencia', 'Evidência (link da conversa ou do pedido, opcional)', inpEvid),
    campo('por', 'Quem encerra', selPor, 'Só líderes e consultores da central.'),
    msg,
    el('div', { className: 'dlg-rodape' }, el('button', { className: 'btn', type: 'button', value: 'nao', textContent: 'Cancelar' }), btnOk))
  const d = el('dialog', { className: 'dlg', id: 'dlgDependencia' }, form)
  document.body.append(d); d.showModal()
  form.querySelector('[value=nao]').onclick = () => d.close()
  d.addEventListener('close', () => d.remove(), { once: true })
  const corpo = () => ({ ids, tipo: selTipo.value, detalhe: txtDetalhe.value.trim(), evidencia: inpEvid.value.trim(), por: selPor.value })
  try {
    const o = await api('/api/tarefas/dependencia-cliente')
    for (const [v, t] of Object.entries(o.tipos)) selTipo.add(new Option(t, v))
    for (const n of o.quem) selPor.add(new Option(n, n))
    if (!o.quem.length) throw new Error('nenhum líder ou consultor na central — sem quem encerrar')
    selPor.value = lerPor(); if (!selPor.value) selPor.selectedIndex = 0
    // a prévia só depende dos ids; tipo/por vêm do formulário e o detalhe leva um texto fixo só para passar na validação do corpo (nada é gravado)
    const p = await api('/api/tarefas/dependencia-cliente', { ...corpo(), detalhe: 'prévia da tela' })
    const outras = p.invalidas.filter(i => !semOpcao(i))
    previa.textContent = `${fmt(p.mudam.length)} mudam · ${fmt(p.ja_estavam.length)} já estavam · ${fmt(p.invalidas.length - outras.length)} sem a opção na base`
      + (outras.length ? ` · ${fmt(outras.length)} não cabem (${[...new Set(outras.map(i => i.motivo))].join('; ')})` : '')
      + (p.bases_sem_opcao.length ? `. Crie a opção 'Aguardando Devolutiva do Cliente' no Status da base de: ${p.bases_sem_opcao.join(', ')}.` : '')
    const n = p.mudam.length + p.ja_estavam.length
    btnOk.textContent = `Encerrar ${fmt(n)} tarefa(s)`; btnOk.disabled = !n
  } catch (e) { msg.textContent = e.message; msg.hidden = false; previa.textContent = 'Prévia indisponível.' }
  form.onsubmit = async e => {
    e.preventDefault()
    const b = corpo(), rotulo = btnOk.textContent
    btnOk.disabled = true; btnOk.setAttribute('aria-busy', 'true'); btnOk.textContent = rotulo.replace('Encerrar', 'Encerrando') + '…'; msg.hidden = true
    try {
      const r = await api('/api/tarefas/dependencia-cliente', { ...b, confirmar: true })
      gravarPor(b.por); d.close()
      const n = r.encerradas.length, m = r.falhas.length, res = $('#depResultado')
      const pend = r.comentarios_pendentes ? ' · comentário no Notion pendente (integração sem permissão)' : ''
      const ja = r.ja_estavam.length ? ` · ${fmt(r.ja_estavam.length)} já estava(m) (só o motivo foi registrado)` : ''
      if (m) {
        toast(`${fmt(n)} encerrada(s) · ${fmt(m)} falha(s) — motivos abaixo da tabela${pend}`, 'erro')
        res.innerHTML = `<div class="aviso erro"><b>Não encerradas (${fmt(m)})</b>${r.falhas.map(f => `<div>${esc(f.titulo || 'tarefa ' + f.id)} — ${esc(f.motivo)}</div>`).join('')}</div>`
      } else { toast(`${fmt(n)} tarefa(s) encerrada(s) por dependência do cliente.${ja}${pend}`); res.innerHTML = '' }
      await atualizar()
    } catch (x) { msg.textContent = x.message; msg.hidden = false; btnOk.disabled = false; btnOk.removeAttribute('aria-busy'); btnOk.textContent = rotulo }
  }
}
$('#btnDependencia').addEventListener('click', dialogoDependencia)

// ---- cada bloco carrega e falha sozinho (um fetch por API, compartilhado por promessa)
// progresso da carteira (F4): carteira inteira, ou só o cliente escolhido no filtro; os demais filtros são do Notion e não recortam a cadeia
const progressoCarteira = () => { const cli = $('#fCliente').value; return window.PSProgresso?.montar($('#progressoCarteira'), { escopo: cli ? { tipo: 'selecao', clientes: [cli] } : { tipo: 'total' } }) }
async function atualizar() {
  const q = qs()
  cabecalho(q)
  const pK = getJson('/api/kpis?' + q), pG = getJson('/api/graficos?' + q), pT = getJson('/api/tarefas?' + q)
  for (const p of [pK, pG, pT]) p.catch(() => {})   // cada bloco trata o próprio erro; aqui só evita unhandled rejection
  await Promise.allSettled([estado(), resumo(pK, pG, q), progressoCarteira(), riscos(pG, pK), ritmo(pG), processos(pG), semanas(pG), distribuicao(pK, pG), tarefas(pT)])
}

$('#btnSync').addEventListener('click', async () => {
  const btn = $('#btnSync')
  btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Sincronizando…'
  try {
    const r = await getJson('/api/sync', { method: 'POST' })
    if (r.erro) toast('Sincronização falhou: ' + r.erro, 'erro')
    else if (r.erros?.length) toast(`Sincronizado com ${r.erros.length} aviso(s): ` + r.erros.join(' · '), 'erro')
    else toast('Sincronizado com o Notion')
    await carregarOpcoes(); await atualizar()
  } catch (e) { toast('Sincronização falhou: ' + e.message, 'erro') }
  finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Reler o Notion' }
})
$('#btnLimpar').addEventListener('click', () => {
  camposSimples().forEach(el => { el.value = '' })
  $('#qTarefas').value = ''; chip = 'todas'   // a busca local e o chip da tabela também são filtro para quem lê o badge
  atualizar()
})
camposSimples().forEach(el => el.addEventListener('change', atualizar))

// filtros avançados: o componente lê ?f= da URL sozinho e chama aoAplicar; a 1ª carga já usa o f da URL, então só recarrega quando o f muda
if (window.PSFiltros) {
  let primeira = !!fDaUrl   // o componente re-serializa o f da URL normalizado: na 1ª aplicação só adota a string, sem recarregar
  PSFiltros.montar($('#filtrosAvancados'), { painel: 'execucao', rotuloAbrir: 'Filtros avançados', aoAplicar: (def, f) => {
    if (primeira) { primeira = false; fAvancado = f; cabecalho(qs()); return }
    if (f === fAvancado) return
    fAvancado = f; atualizar()
  } })
} else $('#filtrosAvancados').hidden = true

carregarOpcoes().then(() => {
  if (!Object.keys(filtros()).length && !fAvancado && sprintAtual) $('#fSprint').value = sprintAtual   // padrão "sprint atual" só na 1ª carga sem filtro (com ?f= na URL o recorte é o que veio)
  return atualizar()
}).catch(e => { $('#veredito').innerHTML = erroHtml(e, 'Não foi possível ler as opções de filtro.') })
