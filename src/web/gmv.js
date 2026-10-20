// GMV da carteira (/gmv): veredito, 3 KPIs, próxima ação, ponte (cascata) e ranking por consultor/analista/cliente.
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const nome = s => esc(String(s ?? '').replace(/\p{Extended_Pictographic}|️/gu, '').trim() || '—')   // nome vindo do Notion: sem emoji
const brl = v => (v < 0 ? '-' : '') + 'R$ ' + Math.abs(Number(v || 0)).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
const brlAbrev = v => { const a = Math.abs(Number(v || 0)), s = v < 0 ? '-' : ''; return a >= 1e6 ? `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : a >= 1e3 ? `${s}R$ ${(a / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: a >= 1e4 ? 0 : 1 })} mil` : brl(v) }
const brd = iso => iso ? iso.slice(5).split('-').reverse().join('/') : '—'          // 2026-09-08 → 08/09
const brdAno = iso => iso ? iso.split('-').reverse().join('/') : '—'                // 2025-09-08 → 08/09/2025 (comparação com outro ano)
const pct = v => v == null ? '—' : (v >= 0 ? '+' : '') + v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
const pct1 = v => v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(v) < 1 ? 2 : 1 }) + '%'
const cls = v => v == null ? 'mudo' : v > 0 ? 'pos' : v < 0 ? 'neg' : 'mudo'
const delta = v => `<span class="${cls(v)}">${pct(v)}</span>`
const PAG = 50
let dados = null, dias = 28, aba = 'consultor', todos = false, limite = PAG, ctrl = null
// filtro avançado (PSFiltros, painel gmv): defF = definição normalizada pelo servidor (traz periodo.comparar), fAtual = ?f= que vai para a API
let filtros = null, defF = null, fAtual = null
const fDaUrl = () => new URLSearchParams(location.search).get('f')
const tirarFDaUrl = () => { const u = new URL(location.href); u.searchParams.delete('f'); history.replaceState(history.state, '', u) }

// ── filtros ──────────────────────────────────────────────────────────────────────────────────────
// o componente lê ?f= da URL sozinho e chama aoAplicar; sem f na URL (e sem `inicial`) ele não chama ninguém, e a tela carrega por conta própria
function montarFiltros(inicial = null) {
  if (!window.PSFiltros) return null
  filtros = PSFiltros.montar($('filtros'), { painel: 'gmv', inicial, aoAplicar(def, f) { if (f === fAtual && defF) return; defF = f ? def : null; fAtual = f; carregar() } })
  return filtros
}
// o atalho 14|28|56 substitui o período do filtro avançado; as condições (E/OU) ficam. O componente não expõe "tirar só o período",
// então ele é remontado com a mesma árvore e sem período (a URL perde o ?f= antes, senão a remontagem leria o período de volta)
function atalhoPeriodo(n) {
  if (defF?.periodo) {
    const def = { ...filtros.definicao(), periodo: null }
    tirarFDaUrl()
    dias = n; defF = null; fAtual = null
    if (def.arvore) { montarFiltros(def); return }       // aoAplicar recarrega com as condições
    montarFiltros(); carregar(); return
  }
  if (n === dias) return
  dias = n; carregar()
}
// comparação efetivamente aplicada pela API: a escolhida no filtro ou, sem escolha, o período anterior (mesma regra do servidor)
const comparacao = () => defF?.periodo ? (defF.periodo.comparar || 'anterior') : 'anterior'

// ── carga ────────────────────────────────────────────────────────────────────────────────────────
function skeleton() {
  $('veredito').textContent = 'Lendo o GMV das contas conectadas…'
  $('kpis').innerHTML = '<div class="kpi sk-kpi"></div><div class="kpi sk-kpi"></div><div class="kpi sk-kpi"></div>'
  $('ponte').innerHTML = '<div class="skeleton"></div>'
  $('tabela').innerHTML = '<div class="sk-tabela"></div>'
  for (const id of ['kpis', 'ponte', 'tabela']) $(id).setAttribute('aria-busy', 'true')
}
async function carregar() {
  ctrl?.abort(); ctrl = new AbortController()
  skeleton()
  try {
    const q = new URLSearchParams({ dias }); if (fAtual) q.set('f', fAtual)
    const r = await fetch('/api/gmv?' + q, { signal: ctrl.signal })
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro ? `${j.erro} (HTTP ${r.status})` : `HTTP ${r.status} em /api/gmv`) }
    dados = await r.json(); limite = PAG; desenhar()
  } catch (e) {
    if (e.name === 'AbortError') return
    dados = null
    window.PS?.regua?.('regua', { valor: NaN })
    $('veredito').textContent = 'Não foi possível carregar o GMV.'
    $('kpis').innerHTML = `<div class="erro-bloco"><b>Não foi possível carregar</b>O servidor não respondeu com os dados de GMV. Tente de novo em instantes.<br><button type="button" class="btn" id="btnRetry">Tentar de novo</button><details><summary>Detalhe técnico</summary><pre>${esc(e.message)}</pre></details></div>`
    $('kpis').className = ''                                                            // sai da grade de KPIs enquanto mostra o erro
    $('btnRetry').onclick = carregar
    $('ponte').innerHTML = ''; $('tabela').innerHTML = ''
    $('secPonte').hidden = $('secQuem').hidden = true
    $('proxima').hidden = true
  } finally { for (const id of ['kpis', 'ponte', 'tabela']) $(id).removeAttribute('aria-busy') }
}

// ── desenho ──────────────────────────────────────────────────────────────────────────────────────
function desenhar() {
  const d = dados, t = d.total, c = d.cobertura, fp = d.filtro?.periodo || null, comp = comparacao()
  // recorte = clientes que passaram nas condições do filtro; conectados = antes do filtro. sem_conexao da API desconta o recorte, por isso é refeito aqui
  const recorte = fAtual && c.filtrados < c.conectados, semConexao = c.clientes_ml - c.conectados, semBase = t.anterior === 0
  $('secPonte').hidden = $('secQuem').hidden = false
  // atalho de período: com período vindo do filtro avançado, nenhum item fica ligado (o período é o do filtro)
  document.querySelectorAll('#periodo [data-d]').forEach(b => { const on = !fp && Number(b.dataset.d) === dias; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) })
  const coleta = d.atualizado_em ? new Date(d.atualizado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'nunca'
  const p = d.periodo, a = p.anterior, outroAno = comp === 'ano_anterior'
  // meta: sem filtro, datas curtas; com período do filtro, o recorte e a comparação por extenso (o que a API aplicou de fato).
  // Preset civil ("últimos 3 meses" = 68 dias) compara com meses inteiros (92 dias): a premissa fica declarada quando os tamanhos diferem
  const outroTamanho = fp && fp[comp].dias !== p.dias
  $('metaPeriodo').textContent = fp
    ? `Período ${brd(p.de)}–${brd(p.ate)} (${p.dias} dias · ${fp.rotulo.split(':')[0].toLowerCase()}) · comparado com ${fp[comp].rotulo.split(':')[0].toLowerCase()}, ${brdAno(a.de)}–${brdAno(a.ate)}${outroTamanho ? ` (${fp[comp].dias} dias)` : ''} · coleta ${coleta}`
    : `Período ${brd(p.de)}–${brd(p.ate)} vs ${brd(a.de)}–${brd(a.ate)} · coleta ${coleta}`
  // cobertura: a proporção real vai na régua; o #aviso fica para o recorte do filtro (chip) e para ressalvas (.aviso), inclusive as que a API devolver
  const ressalvas = []
  if (recorte) ressalvas.push(`<b>${c.filtrados} de ${c.conectados} contas conectadas no recorte.</b>`)
  if (c.historico_incompleto) ressalvas.push(`${c.historico_incompleto} cliente${c.historico_incompleto === 1 ? '' : 's'} com histórico incompleto no período (dia sem coleta ou truncado): o GMV pode estar subestimado.`)
  if (c.fora_da_central?.length) ressalvas.push(`Conectados fora da central: ${c.fora_da_central.map(nome).join(', ')}.`)
  if (d.filtro?.aviso) ressalvas.push(esc(d.filtro.aviso))
  const av = $('aviso'); av.hidden = !ressalvas.length
  if (ressalvas.length > (recorte ? 1 : 0)) { av.className = 'aviso'; av.innerHTML = ressalvas.join(' ') }
  else if (recorte) { av.className = 'badge'; av.textContent = `${c.filtrados} de ${c.conectados} conectadas no recorte` }
  window.PS?.regua?.('regua', { valor: c.clientes_ml ? 100 * c.conectados / c.clientes_ml : NaN, rotulo: `${c.conectados} de ${c.clientes_ml} contas conectadas`, rotuloMarco: 'GMV visível só das conectadas' })

  // veredito responde à pergunta da tela; sem conta conectada (ou sem conta no recorte), diz o que falta; sem base de comparação, não lê variação
  const v = t.variacao_associada
  // um parêntese só, delta primeiro: "(+43,5% · 5 contas no recorte)"
  const par = [t.delta_pct != null && `<b>${pct(t.delta_pct)}</b>`, recorte && `${c.filtrados} contas no recorte`].filter(Boolean).join(' · ')
  $('veredito').innerHTML = !c.conectados
    ? 'Nenhuma conta conectada: sem GMV para ler. Conecte as contas do Mercado Livre na Central de integrações.'
    : !c.filtrados ? 'Nenhuma conta conectada passa neste filtro. Afrouxe as condições ou limpe o filtro.'
    : `<b>${brlAbrev(t.gmv)}</b> de GMV em ${p.dias} dias${par ? ` (${par})` : ''}. ${semBase ? 'Sem GMV coletado no período de comparação: a variação não pode ser lida.' : v < 0 ? `O trabalho está associado a uma queda de ${brlAbrev(Math.abs(v))}.` : `${brlAbrev(v)} da variação está associado ao trabalho.`}`

  // KPIs (3): o valor nunca é colorido; o estado é o ponto + a palavra no detalhe
  const tem = c.filtrados > 0
  const refComp = !tem ? 'nenhuma conta no recorte' : semBase ? 'sem GMV coletado no período de comparação' : `vs ${fp ? (outroAno ? `mesmo período de ${a.de.slice(0, 4)}` : 'período anterior') : `${p.dias} dias anteriores`}${outroTamanho ? ` de ${fp[comp].dias} dias` : ''} (${brlAbrev(t.anterior)})`
  const kpis = $('kpis'); kpis.className = 'kpis'
  kpis.innerHTML = `
    <div class="kpi ${t.delta_pct > 0 ? 'bom' : t.delta_pct < 0 ? 'ruim' : ''}"><div class="rotulo">GMV no período</div><div class="valor">${tem ? brlAbrev(t.gmv) : '—'}</div><div class="detalhe">${delta(t.delta_pct)} ${refComp}</div></div>
    <div class="kpi ${!semBase && v > 0 ? 'bom' : !semBase && v < 0 ? 'ruim' : ''}"><div class="rotulo">Resultado associado ao trabalho</div><div class="valor">${tem && !semBase ? brlAbrev(v) : '—'}</div><div class="detalhe">variação associada · efeito líquido ${brl(t.liquido)} (${pct1(t.pct_associado)} do GMV)</div></div>
    <div class="kpi"><div class="rotulo">Lançamentos</div><div class="valor">${tem ? brlAbrev(t.lancamentos) : '—'}</div><div class="detalhe">receita bruta de anúncios novos ou reativados</div></div>`

  // próxima ação: só com contas sem conexão (navegação real para /integracoes)
  $('proxima').hidden = !semConexao
  $('proximaTexto').textContent = `${semConexao} conta${semConexao === 1 ? '' : 's'} sem conexão escondem o GMV`

  ponte(t, outroAno, tem)
  desenharTabela()
}

// ponte: cascata anterior → associado → restante → atual, com sinal (deslocamento e largura em % do maior ponto)
function ponte(t, outroAno, tem) {
  if (!tem || t.anterior === 0) {                          // sem conta no recorte ou sem base: a "variação" seria o GMV inteiro; nada de ponte inventada
    $('ponteSub').textContent = !tem ? 'Nenhuma conta conectada no recorte: sem variação para decompor.' : 'Sem GMV coletado no período de comparação: não dá para ler de onde veio a variação. Escolha outro período ou outra comparação no filtro.'
    $('ponte').innerHTML = ''; return
  }
  const passos = [
    [outroAno ? 'GMV do mesmo período do ano passado' : 'GMV do período anterior', 'anterior', 0, t.anterior],
    ['Associado ao trabalho', 'assoc', t.anterior, t.variacao_associada],
    ['Restante (mercado, sazonalidade, preço, Ads, estoque)', 'rest', t.anterior + t.variacao_associada, t.restante],
    ['GMV do período', 'atual', 0, t.gmv],
  ]
  const max = Math.max(1, ...passos.flatMap(([, , ini, v]) => [ini, ini + v]))
  $('ponteSub').textContent = `GMV de ${brl(t.anterior)} para ${brl(t.gmv)}: variação de ${brl(t.variacao)}. A parte associada ao trabalho é a mudança do efeito entre os dois períodos; o restante o painel não consegue atribuir.`
  // ordem no DOM: rótulo, valor, trilho (o CSS coloca cada um na coluna certa; no celular o trilho desce para a linha de baixo)
  $('ponte').innerHTML = `<div class="ponte">${passos.map(([rot, k, , v]) => `<span class="rot">${rot}</span><span class="val">${k === 'anterior' || k === 'atual' ? brl(v) : (v >= 0 ? '+' : '') + brl(v)}</span><div class="barra" role="img" aria-label="${esc(rot)}: ${brl(v)}"><i class="esp"></i><i class="${k}"></i></div>`).join('')}</div>`
  // larguras são dado, não estilo estático: entram pelo DOM
  $('ponte').querySelectorAll('.barra').forEach((b, i) => {
    const [, , ini, v] = passos[i], esq = Math.min(ini, ini + v)
    b.firstElementChild.style.width = (esq / max * 100).toFixed(2) + '%'
    b.lastElementChild.style.width = (Math.abs(v) / max * 100).toFixed(2) + '%'
  })
}

// ── ranking ──────────────────────────────────────────────────────────────────────────────────────
const impacto = x => Math.abs((x.ganho || 0) + (x.perda || 0)) + (x.lancamentos || 0)
const pendente = n => /^\(|@/.test(String(n ?? ''))                                  // "(consultor a definir)", "(sem responsável)", e-mail: cadastro pendente no Notion
const porImpacto = (a, b) => pendente(a.nome ?? a.cliente) - pendente(b.nome ?? b.cliente) || impacto(b) - impacto(a) || (b.gmv || 0) - (a.gmv || 0)
// 1ª célula: o nome é o summary; pendência de cadastro vira chip abaixo do nome (fora do flex do summary, para não alargar a coluna)
const rotulo = n => `<details class="lin"><summary>${pendente(n) ? `<span class="mudo">${nome(n)}</span>` : `<b>${nome(n)}</b>`}</summary></details>${pendente(n) ? '<span class="badge">pendência de cadastro</span>' : ''}`
const celAssoc = (g, p, l, gm) => `<td class="n"><b>${brl(g + p)}</b><div class="mudo peq">${gm > 0 ? pct1((g + p) / gm * 100) + ' do GMV' : '—'}${l ? ` · lançamentos ${brl(l)} (bruto)` : ''}</div></td>`
const cab = (col, cobertura) => `<thead><tr><th>${col}</th><th class="n">GMV</th><th class="n">${comparacao() === 'ano_anterior' ? 'vs ano passado' : 'vs anterior'}</th><th class="n">Associado</th><th class="n">${cobertura}</th></tr></thead>`
// vazio: sem filtro, a saída é conectar contas; com condições no filtro, a lista está vazia por causa do recorte e a saída é limpar o filtro
const vazio = (titulo, texto) => defF?.arvore
  ? `<div class="vazio-box"><b>Nenhum resultado neste filtro.</b>Afrouxe as condições ou limpe o filtro. <button type="button" class="btn" id="btnLimparFiltro">Limpar filtros</button></div>`
  : `<div class="vazio-box"><b>${titulo}</b>${texto} <a class="btn" href="/integracoes">Conectar contas</a></div>`
function limparFiltro() {
  tirarFDaUrl()
  defF = null; fAtual = null; montarFiltros(); carregar()
}
const pagina = (lista, plural) => lista.length <= limite ? '' : `<div class="t-pag">1–${limite} de ${lista.length.toLocaleString('pt-BR')} ${plural} · <button type="button" class="btn btn-p" id="btnMais">Mostrar mais</button></div>`
// linha expansível: o nome é o summary; o detalhe vai para a linha irmã tr.det (largura toda), sem subtabela
const linhaExp = (n, celulas, det) => `<tr><td>${rotulo(n)}</td>${celulas}</tr><tr class="det" hidden><td colspan="5">${det}</td></tr>`
const linkCli = c => `<a href="/cliente?cliente=${encodeURIComponent(c)}"><b>${nome(c)}</b></a>`

function desenharTabela() {
  const d = dados
  document.querySelectorAll('#abas [data-a]').forEach(b => { const on = b.dataset.a === aba; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) })
  $('tabela').innerHTML = aba === 'consultor' ? tabConsultor(d) : aba === 'analista' ? tabAnalista(d) : tabCliente(d)
  $('tabela').querySelectorAll('details.lin').forEach(dt => dt.ontoggle = () => { dt.closest('tr').nextElementSibling.hidden = !dt.open })
  const mais = $('btnMais'); if (mais) mais.onclick = () => { limite += PAG; desenharTabela() }
  const tod = $('btnTodos'); if (tod) tod.onclick = () => { todos = true; desenharTabela() }
  const lf = $('btnLimparFiltro'); if (lf) lf.onclick = limparFiltro
}
function tabConsultor(d) {
  const com = d.consultores.filter(c => c.clientes).sort(porImpacto), sem = d.consultores.filter(c => !c.clientes)
  if (!com.length) return vazio('Nenhuma carteira com conta conectada.', 'Os consultores aparecem aqui quando ao menos um cliente da carteira conecta a conta do Mercado Livre.')
  const lista = todos ? com.concat(sem) : com
  const linhas = lista.slice(0, limite).map(c => linhaExp(c.nome,
    `<td class="n">${c.clientes ? brl(c.gmv) : '<span class="mudo">—</span>'}</td><td class="n">${c.clientes ? delta(c.delta_pct) : '<span class="mudo">—</span>'}</td>${c.clientes ? celAssoc(c.ganho, c.perda, c.lancamentos, c.gmv) : '<td class="n mudo">—</td>'}<td class="mudo num">${c.clientes} de ${c.clientes_na_carteira} contas</td>`,
    c.lista.length
      ? c.lista.slice().sort(porImpacto).map(x => `<div>${linkCli(x.cliente)} · GMV ${brl(x.gmv)} · ${delta(x.delta_pct)} · associado ${brl(x.ganho + x.perda)}${x.lancamentos ? ` · lançamentos ${brl(x.lancamentos)}` : ''} <span class="mudo">· ${x.analistas.slice(0, 3).map(a => nome(a.nome)).join(', ') || 'sem analista'}</span></div>`).join('')
      : 'Nenhum cliente desta carteira conectou a conta ainda.')).join('')
  // com condições no filtro, a API devolve com 0 clientes também quem tem conta conectada mas ficou fora do recorte
  const motivo = defF?.arvore ? 'sem cliente no recorte' : 'sem conta conectada na carteira'
  return `<div class="tabela-wrap" tabindex="0"><table class="t">${cab('Consultor', 'Carteira conectada')}<tbody>${linhas}</tbody></table>${pagina(lista, 'consultores')}</div>
    ${!todos && sem.length ? `<p class="nota mt-2 linha">${sem.length} consultor${sem.length === 1 ? '' : 'es'} ${motivo}. <button type="button" class="btn btn-p" id="btnTodos">Mostrar todos (${sem.length})</button></p>` : ''}`
}
function tabAnalista(d) {
  const porNome = new Map(d.clientes.map(c => [c.cliente, c]))
  const lista = d.analistas.map(a => {
    const contas = a.clientes.map(c => porNome.get(c.cliente)).filter(Boolean)
    const gmv = contas.reduce((s, c) => s + c.gmv, 0), ant = contas.reduce((s, c) => s + c.anterior, 0)
    return { ...a, gmv, delta_pct: ant > 0 ? (gmv - ant) / ant * 100 : null }
  }).sort(porImpacto)
  if (!lista.length) return vazio('Nenhuma tarefa medida no período.', 'Os analistas aparecem aqui quando concluem tarefas em contas conectadas.')
  const linhas = lista.slice(0, limite).map(a => linhaExp(a.nome,
    `<td class="n">${brl(a.gmv)}</td><td class="n">${delta(a.delta_pct)}</td>${celAssoc(a.ganho, a.perda, a.lancamentos, a.gmv)}<td class="mudo num">${a.tarefas} tarefa${a.tarefas === 1 ? '' : 's'} em ${a.clientes.length} cliente${a.clientes.length === 1 ? '' : 's'}</td>`,
    a.clientes.map(c => `<div>${linkCli(c.cliente)} · ${c.tarefas} tarefa${c.tarefas === 1 ? '' : 's'} · ganho ${brl(c.ganho)} · perda ${brl(c.perda)}${c.lancamentos ? ` · lançamentos ${brl(c.lancamentos)}` : ''} <span class="mudo">· carteira de ${nome(c.consultor)}</span></div>`).join('') || 'Sem clientes no período.')).join('')
  return `<div class="tabela-wrap" tabindex="0"><table class="t">${cab('Analista', 'Tarefas concluídas')}<tbody>${linhas}</tbody></table>${pagina(lista, 'analistas')}</div>
    <p class="nota mt-2">GMV e variação somam as contas em que o analista atuou. Poucas tarefas medidas não permitem conclusão; veja a taxa de acerto por tipo de tarefa em <a href="/resultados">O que funciona</a>.</p>`
}
function tabCliente(d) {
  const lista = d.clientes.slice().sort(porImpacto)
  if (!lista.length) return vazio('Nenhum cliente conectado ainda.', 'Conecte as contas do Mercado Livre na Central de integrações para medir o GMV por cliente.')
  const linhas = lista.slice(0, limite).map(c => `<tr><td>${linkCli(c.cliente)}<div class="mudo peq">${nome(c.consultor)}${c.cobertura_ok ? '' : ' · histórico parcial no período'}</div></td>
    <td class="n">${brl(c.gmv)}</td><td class="n">${delta(c.delta_pct)}</td>${celAssoc(c.ganho, c.perda, c.lancamentos, c.gmv)}<td class="mudo num">${c.tarefas_medidas} de ${c.tarefas_total} tarefas medidas</td></tr>`).join('')
  return `<div class="tabela-wrap" tabindex="0"><table class="t">${cab('Cliente', 'Tarefas medidas')}<tbody>${linhas}</tbody></table>${pagina(lista, 'clientes')}</div>`
}

// ── eventos ──────────────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('#periodo [data-d]').forEach(b => b.onclick = () => atalhoPeriodo(Number(b.dataset.d)))
document.querySelectorAll('#abas [data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; limite = PAG; if (dados) desenharTabela() })
// com ?f= deste painel na URL, quem dispara a 1ª carga é o aoAplicar do componente (já com a definição normalizada); senão a tela carrega direto
let fUrl = null; try { fUrl = JSON.parse(decodeURIComponent(escape(atob(fDaUrl().replace(/-/g, '+').replace(/_/g, '/'))))) } catch { /* sem f legível */ }
// rede de segurança: filtro recusado pelo servidor (o componente só escreve .flt-msg dentro do painel fechado e não chama aoAplicar).
// A URL perde o ?f= inválido e a tela avisa antes de carregar sem filtro; senão quem recebe o link acha que vê o recorte filtrado
if (montarFiltros() && fUrl?.p === 'gmv') setTimeout(() => {
  if (ctrl) return
  tirarFDaUrl()
  window.PS?.toast?.('O filtro da URL foi recusado pelo servidor; a tela carregou sem filtro.', 'erro')
  fAtual = null; carregar()
}, 2500)
else carregar()
