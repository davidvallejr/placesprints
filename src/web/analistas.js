// Analistas · "Quem precisa de ajuda agora?" (spec docs/ux/sistema-de-design.md, 7.5)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const brData = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const brDatas = s => String(s ?? '').replace(/\d{4}-\d{2}-\d{2}/g, brData)          // "parada desde 2026-08-31" → dd/mm/aaaa
const fmt = (n, dec = 0) => n == null ? '—' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: dec })
const $ = id => document.getElementById(id)
const toast = (t, tipo) => window.PS?.toast ? PS.toast(t, tipo) : (tipo === 'erro' ? alert(t) : console.log(t))
const api = async (url, body) => {
  const r = await fetch(url, body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.erro || 'erro ' + r.status)
  return j
}

let V = null, AT = null, TP = null
let F = null                                      // filtro avançado serializado (?f=), o mesmo para as 3 APIs
let ordem = { col: 'atencao', dir: -1 }
let aberto = ''                                   // analista com drill-down aberto
let limCli = 10                                   // clientes travados visíveis: 10 → 50 → +50
const comF = url => F ? `${url}${url.includes('?') ? '&' : '?'}f=${encodeURIComponent(F)}` : url
// o que a API disse que o filtro NÃO alcança (período fixo, campo fora da visão): mostrado no topo do bloco, nunca escondido
const avisoDe = r => r?.filtro?.aviso ? `<p class="aviso">${esc(r.filtro.aviso.charAt(0).toUpperCase() + r.filtro.aviso.slice(1))}.</p>` : ''

const COLS = [
  { k: 'nome', rotulo: 'Analista' },
  { k: 'concluidas28', rotulo: 'Entregas 28d', n: true },
  { k: 'abertas', rotulo: 'Carteira', n: true },
  { k: 'clientes', rotulo: 'Clientes ativos', n: true },
  { k: 'atencao', rotulo: 'Atenção' },
]
const atencaoDe = a => a.atrasadas * 3 + a.bloqueadas * 2 + a.paradas30
const travadasDe = a => a.bloqueadas + a.paradas30
const primeiroNome = n => String(n).split(' ')[0]   // ponytail: 13 nomes, colisão improvável
const nomeBtn = (a, texto) => `<button class="nome-btn" type="button" data-n="${esc(a.nome)}">${texto}</button>`

// ── estados por bloco ─────────────────────────────────────────────────────────────────
const vazio = (titulo, dica, botao = '') => `<div class="vazio-box"><b>${titulo}</b>${dica}${botao}</div>`
const erro = (e, bloco, attr = 'data-retry') => `<div class="erro-bloco"><b>Não foi possível carregar</b>O servidor não respondeu como esperado. Tente de novo em instantes.
  <div><button class="btn btn-p" type="button" ${attr}="${esc(bloco)}">Tentar de novo</button></div>
  <details><summary>Detalhe técnico</summary><pre>${esc(e.message)}</pre></details></div>`
const pronto = el => { el.removeAttribute('aria-busy') }
const carregando = (el, sk = '<div class="sk-tabela"></div>') => { el.setAttribute('aria-busy', 'true'); el.innerHTML = sk }

// ── veredito, KPIs e próxima ação: só com as linhas da lista oficial ──────────────────
function desenharTopo() {
  const lista = V.analistas
  const soma = k => lista.reduce((s, a) => s + (a[k] || 0), 0)
  const travadas = soma('bloqueadas') + soma('paradas30'), abertas = soma('abertas')
  const top = [...lista].sort((x, y) => atencaoDe(y) - atencaoDe(x)).filter(a => travadasDe(a) > 0).slice(0, 2)

  $('metaOficial').textContent = `${lista.length} ${lista.length === 1 ? 'analista oficial ativo' : 'analistas oficiais ativos'}${F ? ' no filtro' : ''}`
  $('veredito').innerHTML = !lista.length ? (F ? 'Nenhum analista da lista oficial neste filtro. Limpe ou troque as condições.' : 'Nenhum analista na lista oficial. Atualize a lista do Notion para ler a carteira.')
    : !travadas ? 'Nenhuma tarefa travada na carteira. O time está em dia.'
    : `<b>${fmt(travadas)} tarefas travadas</b> na carteira. Comece por ${top.map(a => nomeBtn(a, `${esc(primeiroNome(a.nome))} (${fmt(travadasDe(a))})`)).join(' e ')}.`
  // régua: proporção real travadas ÷ carteira aberta (some sem carteira — PS.regua esconde com valor não numérico)
  window.PS?.regua?.('regua', { valor: abertas ? 100 * travadas / abertas : NaN, rotulo: `${fmt(travadas)} travadas de ${fmt(abertas)} abertas` })

  $('kpis').innerHTML = `
    <div class="kpi"><div class="rotulo">Analistas ativos</div><div class="valor">${fmt(lista.length)}</div><div class="detalhe">de ${fmt(V.lista_oficial?.total)} na lista oficial</div></div>
    <div class="kpi"><div class="rotulo">Entregas 28d</div><div class="valor">${fmt(soma('concluidas28'))}</div><div class="detalhe">ritmo de ${fmt(soma('ritmo_semana'))} por semana</div></div>
    <div class="kpi"><div class="rotulo">Carteira aberta</div><div class="valor">${fmt(soma('abertas'))}</div><div class="detalhe">tarefas abertas no Notion</div></div>
    <div class="kpi ${travadas ? 'risco' : lista.length ? 'bom' : ''}"><div class="rotulo">Travadas</div><div class="valor">${fmt(travadas)}</div><div class="detalhe">aproximação de atraso: o Notion não tem prazo</div></div>`
  pronto($('kpis'))
  const sec = $('kpisSec')
  sec.innerHTML = `Bloqueadas <b>${fmt(soma('bloqueadas'))}</b> · Paradas 30d+ <b>${fmt(soma('paradas30'))}</b>${F ? '' : ` · Depende do cliente <b>${fmt(V.time?.dependencia_cliente)}</b> (fora da carteira) · Fora da lista oficial <b>${fmt(V.lista_oficial?.fora_total)}</b>`}`   // depende do cliente e fora da lista são da base inteira: não seguem o filtro
  sec.hidden = false

  const px = $('proxima'), lider = top[0]
  px.hidden = !lider
  if (lider) {
    $('proximaTexto').textContent = `Destravar a carteira de ${primeiroNome(lider.nome)} (${fmt(travadasDe(lider))} travadas)`
    $('proximaBtn').textContent = `Ver carteira de ${primeiroNome(lider.nome)}`
    $('proximaBtn').onclick = () => drill(lider.nome, true, true)
  }
}

// ── ranking ───────────────────────────────────────────────────────────────────────────
function celAtencao(a) {
  const p = []
  if (a.atrasadas) p.push(`<span class="selo ruim">${fmt(a.atrasadas)} prazo vencido</span>`)
  if (a.bloqueadas) p.push(`<span class="selo atencao">${fmt(a.bloqueadas)} bloqueada(s)</span>`)
  if (a.paradas30) p.push(`<span class="selo neutro">${fmt(a.paradas30)} parada(s) 30d+</span>`)
  return p.join(' ') || '<span class="selo bom">em dia</span>'
}

function desenharRanking() {
  const box = $('ranking')
  if (!V.analistas.length) { box.innerHTML = avisoDe(V) + (F ? vazio('Nenhum analista neste filtro.', 'Remova um chip acima ou use "Limpar tudo".') : vazio('Nenhum analista na lista oficial.', 'Use "Atualizar lista do Notion" no menu de ações para ler a base de prestadores.')); pronto(box); return }
  const lista = [...V.analistas].sort((x, y) => {
    const vx = ordem.col === 'atencao' ? atencaoDe(x) : x[ordem.col], vy = ordem.col === 'atencao' ? atencaoDe(y) : y[ordem.col]
    if (typeof vx === 'string') return ordem.dir * vx.localeCompare(vy)
    return ordem.dir * ((vx ?? -1) - (vy ?? -1))
  })
  box.innerHTML = `${avisoDe(V)}<div class="cartao"><div class="tabela-wrap"><table>
    <thead><tr>${COLS.map(c => { const on = ordem.col === c.k; return `<th data-k="${c.k}" class="${[on ? 'on' : '', c.n ? 'n' : ''].join(' ').trim()}"${on ? ` aria-sort="${ordem.dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button">${c.rotulo}</button></th>` }).join('')}</tr></thead>
    <tbody>${lista.map(a => `
      <tr>
        <td>${nomeBtn(a, esc(a.nome))}</td>
        <td class="n">${fmt(a.concluidas28)} <span class="mini">${fmt(a.ritmo_semana, 1)}/semana</span></td>
        <td class="n">${fmt(a.abertas)}</td>
        <td class="n">${fmt(a.clientes)}</td>
        <td>${celAtencao(a)}</td>
      </tr>
      <tr id="drill-${esc(a.nome)}" hidden><td colspan="${COLS.length}"><div class="drill" id="drillbox-${esc(a.nome)}"></div></td></tr>`).join('')}
    </tbody></table></div></div>`
  pronto(box)
  if (aberto) drill(aberto, true)
}

async function drill(nome, manter = false, focar = false) {
  const linha = $('drill-' + nome)
  if (!linha) return
  if (!manter && aberto === nome && !linha.hidden) { linha.hidden = true; aberto = ''; return }
  document.querySelectorAll('[id^="drill-"]').forEach(x => { x.hidden = true })
  linha.hidden = false; aberto = nome
  const box = $('drillbox-' + nome)
  box.innerHTML = '<div class="sk-linha"></div><div class="sk-linha"></div>'
  if (focar) { box.tabIndex = -1; box.focus({ preventScroll: true }); linha.scrollIntoView({ block: 'center', inline: 'nearest' }) }   // sem rolar a tabela para o lado no celular
  try {
    const d = await api('/api/analistas/detalhe?nome=' + encodeURIComponent(nome))
    const mostradas = d.atencao.slice(0, 12), total = d.atencao_total ?? d.atencao.length
    box.innerHTML = `
      <div class="linha"><b>${esc(d.nome)}</b><span class="mini">${fmt(d.abertas)} em carteira · ${fmt(d.concluidas90)} concluídas em 90d</span>
        <a class="mini" href="/matriz?responsavel=${encodeURIComponent(d.nome)}" target="_blank" rel="noopener">Matriz Eisenhower · interno</a></div>
      ${mostradas.length ? `<h5>Precisa de atenção (${fmt(total)})</h5>
      <table><thead><tr><th>Cliente</th><th>Tarefa</th><th>Motivo</th></tr></thead><tbody>
        ${mostradas.map(t => `<tr><td>${esc(t.cliente)}</td><td>${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(String(t.titulo).slice(0, 60))}</a>` : esc(String(t.titulo).slice(0, 60))}</td><td class="mini">${esc(brDatas(t.motivo))}</td></tr>`).join('')}
      </tbody></table>${total > mostradas.length ? `<div class="mini mt-2">Mostrando as ${mostradas.length} mais críticas de ${fmt(total)}.</div>` : ''}`
      : '<div class="mini mt-2">Nada travado ou vencido na carteira.</div>'}
      <div class="grade2 mt-4">
        <div><h5>Clientes da carteira</h5><table><thead><tr><th>Cliente</th><th class="n">Abertas</th><th class="n">Travadas</th></tr></thead><tbody>
          ${d.clientes.slice(0, 8).map(c => `<tr><td><a href="/cliente?cliente=${encodeURIComponent(c.cliente)}">${esc(c.cliente)}</a></td><td class="n">${fmt(c.abertas)}</td><td class="n">${c.bloqueadas + c.paradas30 ? fmt(c.bloqueadas + c.paradas30) : '—'}</td></tr>`).join('')}
        </tbody></table></div>
        <div><h5>O que mais entrega (90d)</h5><table><thead><tr><th>Tipo</th><th class="n">Concluídas</th></tr></thead><tbody>
          ${d.tipos.slice(0, 8).map(x => `<tr><td>${esc(x.tipo)}</td><td class="n">${fmt(x.n)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>`
  } catch (e) { box.innerHTML = erro(e, nome, 'data-retry-drill') }
}

// ── clientes travados: top 10, depois 50 por vez ──────────────────────────────────────
function desenharClientes() {
  const box = $('clientes'), cs = AT.clientes
  if (!cs.length) { box.innerHTML = avisoDe(AT) + (F ? vazio('Nenhum cliente travado neste filtro.', 'Remova um chip acima ou use "Limpar tudo".') : vazio('Nenhum cliente travado agora.', 'Bloqueadas e paradas há mais de 30 dias aparecem aqui assim que surgirem no Notion.')); pronto(box); return }
  const vis = cs.slice(0, limCli)
  box.innerHTML = `${avisoDe(AT)}<div class="cartao"><div class="tabela-wrap"><table>
    <thead><tr><th>Cliente</th><th class="n">Bloqueadas</th><th class="n">Paradas 30d+</th><th>Parada mais antiga</th><th>Responsável</th></tr></thead>
    <tbody>${vis.map(c => `<tr>
      <td><a href="/cliente?cliente=${encodeURIComponent(c.cliente)}">${esc(c.cliente)}</a><div class="mini">${fmt(c.abertas)} aberta(s)${c.atrasadas.length ? ` · <span class="selo ruim">${fmt(c.atrasadas.length)} prazo vencido</span>` : ''}</div></td>
      <td class="n">${c.bloqueadas ? fmt(c.bloqueadas) : '—'}</td>
      <td class="n">${c.paradas30 ? fmt(c.paradas30) : '—'}</td>
      <td>${brData(c.mais_antiga)}</td>
      <td>${c.analistas.length ? `${c.analistas.slice(0, 3).map(esc).join(', ')}${c.analistas.length > 3 ? ` <span class="mini">+${c.analistas.length - 3}</span>` : ''}` : '<span class="selo ruim">Sem responsável</span>'}</td>
    </tr>`).join('')}</tbody></table></div>
    ${cs.length > vis.length ? `<div class="t-pag">1–${vis.length} de ${fmt(cs.length)} <button class="btn btn-p" type="button" data-mais-cli>${limCli === 10 ? `Ver todos (${fmt(cs.length)})` : 'Mostrar mais'}</button></div>` : ''}
  </div>`
  pronto(box)
}

// ── recolhidos: entrega (tipos e combinações) e qualidade do dado ─────────────────────
function desenharEntrega() {
  const box = $('entrega')
  $('nTipos').textContent = TP.tipos.length ? `${TP.tipos.length} tipos` : ''
  if (!TP.tipos.length) { box.innerHTML = avisoDe(TP) + vazio('Nenhuma tarefa concluída em 90 dias.', 'Os tipos aparecem quando o Notion registrar conclusões.'); pronto(box); return }
  box.innerHTML = `${avisoDe(TP)}<p class="nota">Volume por tipo e pares de tipos concluídos no mesmo cliente com até 7 dias de distância. Mede o que o time executa, não resultado de vendas.</p>
  <div class="grade2">
    <div class="cartao"><div class="tabela-wrap"><table class="t">
      <thead><tr><th>Tipo de tarefa</th><th class="n">Concluídas</th><th class="n">Clientes</th></tr></thead>
      <tbody>${TP.tipos.map(x => `<tr><td>${esc(x.tipo)}</td><td class="n">${fmt(x.concluidas)}</td><td class="n">${fmt(x.clientes)}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <div class="cartao"><div class="tabela-wrap"><table class="t">
      <thead><tr><th>Combinação</th><th class="n">Clientes</th></tr></thead>
      <tbody>${TP.combos.length ? TP.combos.map(x => `<tr><td>${esc(x.combo)}</td><td class="n">${fmt(x.clientes)}</td></tr>`).join('') : '<tr><td class="vazio" colspan="2">Nenhum par de tipos no mesmo cliente em 7 dias.</td></tr>'}</tbody>
    </table></div></div>
  </div>`
  pronto(box)
}

function desenharQualidade() {
  const t = V?.time, lo = V?.lista_oficial, semTipo = TP?.tipos.find(x => x.tipo === '(sem tipo)')
  const itens = []
  if (t) itens.push(`<li><b>Prazo:</b> ${fmt(t.pct_sem_prazo)}% das tarefas abertas não têm o campo Prazo. Por isso bloqueadas e paradas 30d+ entram como aproximação de atraso, não como atraso por prazo.</li>`,
    `<li><b>Duração:</b> ${fmt(t.pct_mesmo_dia_time)}% das concluídas têm início igual à conclusão, então a velocidade não é medida aqui.</li>`)
  if (lo) itens.push(`<li><b>Lista oficial:</b> ${fmt(lo.total)} nomes (${esc(lo.fonte)}); ${fmt(V.analistas.length)} ativos no ranking; ${fmt(lo.fora_total)} responsáveis de tarefas fora da lista.${lo.fora?.length ? ` Maiores volumes fora: ${lo.fora.map(f => `${esc(f.nome)} (${fmt(f.creditos)})`).join(', ')}. Grafia diferente de um analista? Mapeie em config/equipe.json ou ajuste a base no Notion.` : ''}</li>`)
  if (semTipo) itens.push(`<li><b>Sem tipo:</b> ${fmt(semTipo.concluidas)} tarefas concluídas em 90 dias não têm o campo Tipo preenchido.</li>`)
  if (itens.length) $('qualidade').innerHTML = `${F ? '<p class="aviso">Os números desta seção são da base inteira: o filtro aplicado não os recorta.</p>' : ''}<ul class="nota">${itens.join('')}</ul>`
}

// ── cargas independentes: cada bloco carrega e falha sozinho ──────────────────────────
const CARGAS = {
  async visao() {
    const box = $('ranking'); carregando(box)
    try { V = await api(comF('/api/analistas/visao')); desenharTopo(); desenharRanking() }
    catch (e) { $('veredito').textContent = 'Não foi possível ler a carteira do time.'; window.PS?.regua?.('regua', { valor: NaN }); $('kpis').innerHTML = ''; pronto($('kpis')); $('kpisSec').hidden = true; $('proxima').hidden = true; box.innerHTML = erro(e, 'visao'); pronto(box) }
    desenharQualidade()
  },
  async clientes() {
    const box = $('clientes'); carregando(box)
    try { AT = await api(comF('/api/analistas/clientes-atrasados')); desenharClientes() }
    catch (e) { box.innerHTML = erro(e, 'clientes'); pronto(box) }
  },
  async tipos() {
    const box = $('entrega'); carregando(box)
    try { TP = await api(comF('/api/analistas/tipos')); desenharEntrega() }
    catch (e) { box.innerHTML = erro(e, 'tipos'); pronto(box) }
    desenharQualidade()
  },
}
const carregarTudo = () => { CARGAS.visao(); CARGAS.clientes(); CARGAS.tipos() }

// um listener para ordenar, abrir drill, paginar e tentar de novo (os blocos redesenham o próprio HTML)
document.addEventListener('click', e => {
  const th = e.target.closest('th[data-k]')
  if (th) {
    const k = th.dataset.k; ordem = { col: k, dir: ordem.col === k ? -ordem.dir : (k === 'nome' ? 1 : -1) }; desenharRanking()
    document.querySelector(`th[data-k="${k}"] button`)?.focus()   // o innerHTML refez a tabela; devolve o foco a quem ordenou
    return
  }
  const b = e.target.closest('.nome-btn[data-n]')
  if (b) return drill(b.dataset.n)
  const mais = e.target.closest('[data-mais-cli]')
  if (mais) { limCli = limCli === 10 ? 50 : limCli + 50; desenharClientes(); return }
  const rd = e.target.closest('[data-retry-drill]')
  if (rd) return drill(rd.dataset.retryDrill, true)
  const retry = e.target.closest('[data-retry]')
  if (retry) CARGAS[retry.dataset.retry]()
})

const bs = $('btnSync')
bs.onclick = async () => {
  bs.disabled = true; bs.setAttribute('aria-busy', 'true'); bs.textContent = 'Sincronizando…'
  try { await api('/api/analistas/sincronizar', {}); toast('Lista de analistas atualizada'); CARGAS.visao() }
  catch (e) { toast('Falhou: ' + e.message, 'erro') }
  bs.disabled = false; bs.removeAttribute('aria-busy'); bs.textContent = 'Atualizar lista do Notion'
}

// filtro avançado (painel analistas): com ?f= legível na URL o componente chama aoAplicar sozinho (mesmo de outro painel, com f=null); sem ele a tela carrega direto
const temF = (() => { try { const s = new URLSearchParams(location.search).get('f'); return !!s && !!JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))) } catch { return false } })()
const filtros = window.PSFiltros?.montar($('filtros'), { painel: 'analistas', aoAplicar: (def, f) => { if (f === F && V) return; F = f; limCli = 10; carregarTudo() } })
if (!filtros || !temF) carregarTudo()
else setTimeout(() => { if (!V && !AT) carregarTudo() }, 5000)   // ponytail: se /api/filtros/definicao ou /validar falhar, o componente mostra o erro dele e a tela carrega sem filtro em vez de ficar no skeleton
