// O que funciona (/resultados): veredito → cobertura → próxima ação → tabelas. Uma chamada, cada bloco monta e falha sozinho.
const $ = id => document.getElementById(id)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const int = v => Number(v || 0).toLocaleString('pt-BR')
const brl = v => (v < 0 ? '−' : '') + 'R$ ' + Math.abs(Number(v || 0)).toLocaleString('pt-BR', { maximumFractionDigits: 0 })      // sinal "−" como no resto da tela
const brlAbrev = v => { const a = Math.abs(v || 0), s = v < 0 ? '−' : ''; return a >= 1e6 ? `${s}R$ ${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : a >= 1e4 ? `${s}R$ ${Math.round(a / 1e3)} mil` : brl(v) }
const pc = v => v == null ? '—' : Math.round(v * 100) + '%'
const pct1 = v => v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%'
const dt = s => s ? s.slice(8, 10) + '/' + s.slice(5, 7) : ''
const plural = (n, um, varios) => `${int(n)} ${n === 1 ? um : varios}`
const urlOk = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : ''
const neg = v => v < 0 ? ' neg' : ''

const BLOCOS = ['veredito', 'mensura', 'tipos', 'nichos', 'regioes', 'lanc', 'nichoTipo', 'analistas', 'palavras']
const TAB = '<div class="sk-tabela"></div>'
const SK = { veredito: '<div class="sk-kpi"></div>'.repeat(3), mensura: '<div class="sk-linha"></div><div class="sk-linha"></div>', tipos: TAB, nichos: TAB, regioes: TAB, lanc: '<div class="sk-kpi"></div>', nichoTipo: TAB, analistas: TAB, palavras: TAB }
const poe = (id, html, ocupado = false) => { const el = $(id); el.innerHTML = html; ocupado ? el.setAttribute('aria-busy', 'true') : el.removeAttribute('aria-busy') }
const vazio = (titulo, instrucao, extra = '') => `<div class="vazio-box"><b>${esc(titulo)}</b>${esc(instrucao)}${extra}</div>`
const erro = (msg, detalhe, tentar = 'data-tentar') => `<div class="erro-bloco"><b>Não foi possível carregar</b><p>${esc(msg)}</p><button class="btn btn-p" type="button" ${tentar}>Tentar de novo</button><details><summary>Detalhe técnico</summary><pre>${esc(detalhe)}</pre></details></div>`
const conta = (n, cls) => n ? `<span class="estado ${cls}">${int(n)}</span>` : '<span class="mudo">0</span>'   // zero sem selo

// Tabela de 8 colunas (6 nos lançamentos). Ordem da API intocada; a amostra pequena fica VISÍVEL com selo e o botão a oculta.
// grupo (tipo|analista|nicho|regiao|nicho_tipo): a 1ª célula vira botão que abre as tarefas do grupo (drill). Palavras e lançamentos não têm drill.
function tabela(grupos, { lanc = false, col1 = 'Tipo', rotulo = 'tipos', um = rotulo.replace(/s$/, ''), grupo = '', vazioTitulo = 'Ainda não há tarefas medidas nesta categoria.', vazioInstrucao = 'Conclua tarefas citando o MLB para elas entrarem aqui.' } = {}) {
  if (!grupos.length) return vazio(vazioTitulo, vazioInstrucao)
  const pequenas = grupos.filter(g => g.amostra_pequena).length, grandes = grupos.length - pequenas
  const cab = lanc
    ? `<th scope="col">${col1}</th><th scope="col" class="n">Tarefas</th><th scope="col" class="n">Venderam</th><th scope="col" class="n">Taxa ≥</th><th scope="col" class="n">Receita</th><th scope="col" class="n">Visitas/dia</th>`
    : `<th scope="col">${col1}</th><th scope="col" class="n">Tarefas</th><th scope="col" class="n">Melhorou</th><th scope="col" class="n opc">Sem efeito</th><th scope="col" class="n">Piorou</th><th scope="col" class="n">Taxa de melhora ≥</th><th scope="col" class="n opc">Efeito mediano</th><th scope="col" class="n">R$ associado</th>`
  const nome = g => {
    const rot = g.outros ? `${esc(g.chave)} <span class="mudo">· ${plural(g.grupos, um, rotulo)} com menos de 5</span>` : esc(g.chave)
    return (grupo ? `<button class="lnk" type="button" data-drill="${esc(grupo + '|' + g.chave)}" data-conf="${g.confundidas || 0}" aria-expanded="false">${rot}</button>` : rot)
      + (g.amostra_pequena ? ' <span class="selo neutro">amostra pequena</span>' : '')
      + (g.clientes === 1 ? ' <span class="selo neutro" title="resultado daquele cliente, não do grupo">1 cliente</span>' : '')
  }
  const lin = grupos.map(g => {
    const tr = `<tr${g.amostra_pequena ? ' class="pequena"' : ''}>`
    if (lanc) return `${tr}<td>${nome(g)}</td><td class="n">${g.n}</td><td class="n">${g.venderam}</td><td class="n">${pc(g.taxa_baixo)}</td><td class="n">${brl(g.receita)}</td><td class="n">${g.visitas_dia_mediana == null ? '—' : g.visitas_dia_mediana.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</td></tr>`
    const conf = g.confundidas ? ` title="mais ${plural(g.confundidas, 'medida', 'medidas')} fora do aprendizado por preço alterado ou mudança de estado (promoção, Ads, Full, estoque, pausa) na janela (aparecem no detalhe)"` : ''
    const taxa = ` title="taxa observada ${pc(g.taxa)} (${g.melhorou} de ${g.n}); limite inferior de Wilson (95%): ${pc(g.taxa_baixo)}"`
    return `${tr}<td>${nome(g)}</td><td class="n"${conf}>${g.n}</td><td class="n">${conta(g.melhorou, 'e-melhorou')}</td><td class="n opc mudo">${g.sem_efeito}</td><td class="n">${conta(g.piorou, 'e-piorou')}</td>`
      + `<td class="n"${taxa}>${pc(g.taxa_baixo)}</td><td class="n opc${neg(g.efeito_mediano_pct)}">${pct1(g.efeito_mediano_pct)}</td><td class="n${neg(g.receita_incremental)}">${brl(g.receita_incremental)}</td></tr>`
  }).join('')
  // sem linha com volume, ocultar a amostra pequena esvaziaria a tabela: no lugar do botão, o aviso
  const botao = pequenas && grandes ? `<div class="t-pag"><button class="btn btn-p" type="button" data-pequenas>Ocultar ${plural(pequenas, um, rotulo)} com amostra pequena</button></div>` : ''
  const aviso = grandes ? '' : '<p class="aviso info">Nenhuma linha com 5 ou mais tarefas medidas: tudo abaixo é amostra pequena e ainda não vira padrão.</p>'
  return `<div class="tab-grupo">${aviso}<div class="tabela-wrap"><table class="t"><thead><tr>${cab}</tr></thead><tbody>${lin}</tbody></table>${botao}</div></div>`
}

// Frase do veredito (responde "que tipo traz resultado mensurável e o que rever?") + régua medidas/mensuráveis: só proporção real, some sem dado
function frase(d, cob, fazer, rever) {
  const el = $('vereditoFrase')
  if (!d.n_clientes) el.textContent = 'Nenhuma conta do Mercado Livre conectada: a medição ainda não começou.'
  else if (!d.n_medidas) el.textContent = d.filtro ? 'Nenhuma tarefa com efeito medido neste filtro.' : `Nenhuma tarefa com efeito medido ainda; ${plural(cob.maturando, 'está', 'estão')} em maturação.`
  else el.innerHTML = fazer.length && rever.length ? `<b>${esc(fazer[0].chave)}</b> é o tipo que mais prova melhora; <b>${esc(rever[0].chave)}</b> pede revisão.`
    : fazer.length ? `<b>${esc(fazer[0].chave)}</b> é o tipo que mais prova melhora; nenhum tipo com volume pede revisão.`
      : rever.length ? `Nenhum tipo com volume prova melhora; <b>${esc(rever[0].chave)}</b> pede revisão.`
        : 'Nenhum tipo com 5 ou mais tarefas prova melhora nem pede revisão: medir mais é o caminho.'
  // com filtro, mensuráveis/medidos vêm da cobertura por conta (a API não a recalcula): o rótulo da direita diz isso
  window.PS?.regua('regua', { valor: cob.total ? 100 * cob.medidos / cob.total : NaN, rotulo: `${int(cob.medidos)} de ${int(cob.total)} medidas (${pc(cob.medidos / cob.total)})`, rotuloMarco: d.filtro ? 'cobertura por conta, não recalculada pelo filtro' : '' })
}

// Veredito: 3 cartões calculados no front, só com n ≥ 5 (cópias filtradas; d.por_tipo não é reordenado)
function veredito(d, cob) {
  const grandes = d.por_tipo.filter(g => !g.amostra_pequena)
  const rever = grandes.filter(g => g.piorou > g.melhorou || g.receita_incremental < 0)
  const fazer = grandes.filter(g => !rever.includes(g) && g.melhorou > 0 && g.receita_incremental > 0).sort((a, b) => b.taxa_baixo - a.taxa_baixo)
  const pequenas = d.por_tipo.length - grandes.length
  frase(d, cob, fazer, rever)
  if (!d.n_clientes) return vazio('Nenhuma conta do Mercado Livre conectada.', 'Conecte uma conta em Integrações para a medição começar; as tarefas concluídas no Notion já estão esperando.')
  const cartao = (tom, titulo, num, frase) => `<div class="cartao ver ${tom}"><h3>${titulo}</h3><div class="ver-num${num ? '' : ' sem'}">${int(num)}</div><p>${frase}</p></div>`
  const fraseFazer = !cob.medidos ? `Nenhuma tarefa com efeito medido ainda. ${plural(cob.maturando, 'está', 'estão')} em maturação: os 14 dias depois da conclusão ainda não passaram.`
    : fazer.length ? `${esc(fazer[0].chave)}: taxa de melhora de pelo menos ${pc(fazer[0].taxa_baixo)} em ${plural(fazer[0].n, 'tarefa', 'tarefas')}, ${brlAbrev(fazer[0].receita_incremental)} associados.${fazer.length > 1 ? ` Depois, ${esc(fazer[1].chave)}.` : ''}`
      : 'Nenhum tipo com 5 ou mais tarefas prova melhora com R$ positivo. Medir mais tarefas é o caminho mais curto.'
  const fraseRever = rever.length ? rever.slice(0, 2).map(g => `${esc(g.chave)}: ${plural(g.piorou, 'piorou', 'pioraram')}, ${plural(g.melhorou, 'melhorou', 'melhoraram')}, ${brlAbrev(g.receita_incremental)} associados`).join('. ') + '.'
    : 'Nenhum tipo com volume mostra mais pioras que melhoras nem R$ negativo.'
  return cartao(fazer.length ? 'bom' : 'neutro', 'Fazer mais', fazer.length, fraseFazer)
    + cartao(rever.length ? 'ruim' : 'neutro', 'Rever', rever.length, fraseRever)
    + cartao('neutro', 'Ainda sem prova', pequenas, pequenas ? `${pequenas === 1 ? 'tipo tem' : 'tipos têm'} menos de 5 tarefas medidas e ainda não ${pequenas === 1 ? 'vira' : 'viram'} padrão.` : 'Todos os tipos já têm 5 ou mais tarefas medidas.')
}

// Cobertura: aviso da API (o que o filtro não recalcula), barra empilhada com legenda em texto e os canais não medidos em chips. A métrica-âncora é a régua.
function cobertura(d, cob) {
  const aviso = d.filtro?.aviso ? `<p class="aviso">${esc(d.filtro.aviso)}</p>` : ''
  if (!cob.total) return aviso + (d.filtro ? vazio('Nenhuma tarefa medida neste filtro.', 'Remova condições no filtro ou limpe tudo.') : vazio('Nenhuma tarefa concluída no Mercado Livre no período.', 'Conclua tarefas citando o MLB para elas entrarem aqui.'))
  const fatias = [['melhorou', 'Melhorou', cob.melhorou], ['sem_efeito', 'Sem efeito', cob.sem_efeito], ['piorou', 'Piorou', cob.piorou], ['lancamento', 'Lançamentos', cob.lancamento], ['variacao_conta', 'Conta inteira (sem anúncio citado)', cob.variacao_conta], ['maturando', 'Sem base ou maturando', cob.maturando]]
  const barra = `<div class="barra" role="img" aria-label="${fatias.map(([, r, n]) => `${r} ${int(n)}`).join(', ')}">${fatias.map(([k, , n]) => `<i class="cob-${k}" data-w="${n}"></i>`).join('')}</div>`
  const legenda = `<div class="legenda">${fatias.map(([k, r, n]) => `<span><span class="bola cob-${k}"></span>${r} <b>${int(n)}</b></span>`).join('')}</div>`
  // as confundidas (preço ou estado) já estão nas contagens por estado; só saem das taxas por grupo (agruparPadroes)
  const preco = cob.confundidas ? `<p class="mudo peq mt-2">${plural(cob.confundidas, 'medida', 'medidas')} fora do aprendizado por preço alterado ou mudança de estado na janela (contadas acima; ficam fora das taxas por grupo).</p>` : ''
  const canais = Object.values(d.mensurabilidade.reduce((o, m) => { for (const [c, n] of Object.entries(m.nao_mensuraveis.por_canal)) { const k = c.replace(/\s+/g, '').toLowerCase(), e = (o[k] ??= { rotulo: c, n: 0 }); e.n += n; if ((c.match(/[A-Z]/g) || []).length > (e.rotulo.match(/[A-Z]/g) || []).length) e.rotulo = c } return o }, {})).sort((a, b) => b.n - a.n)   // Tiktok/TikTok e Shopee2/Shopee 2 somam numa só
  const outros = canais.slice(3).reduce((t, c) => t + c.n, 0)
  const chips = canais.length ? `<div class="linha mt-2 peq mudo">Não medidas (canal não conectado):${canais.slice(0, 3).map(c => ` <span class="chip">${esc(c.rotulo)} ${int(c.n)}</span>`).join('')}${outros ? ` <span class="chip">outros ${int(outros)}</span>` : ''}</div>` : ''
  return aviso + barra + legenda + preco + chips
}

// canal: só o Mercado Livre tem API; as tarefas concluídas de Shopee/Amazon/TikTok das contas conectadas ficam fora (mesmas regex de RX_CANAL, melhor-profissional.js)
const RX_CANAIS = [['Shopee', /shopee/i], ['Amazon', /amazon/i], ['TikTok', /tik\s*tok/i]]
function avisoCanal(d) {
  const partes = RX_CANAIS.map(([r, rx]) => [r, d.mensurabilidade.reduce((t, m) => t + Object.entries(m.nao_mensuraveis?.por_canal || {}).reduce((s, [c, n]) => s + (rx.test(c) ? n : 0), 0), 0)])
    .filter(([, n]) => n).map(([r, n]) => `${r} ${int(n)}`)
  const lista = partes.length > 1 ? partes.slice(0, -1).join(', ') + ' e ' + partes.at(-1) : partes[0]
  return `<p class="aviso info">Toda medição é do Mercado Livre${lista ? ` (${lista} tarefas concluídas nas contas conectadas, sem API conectada)` : ': Shopee, Amazon e TikTok não têm API conectada'}.</p>`
}

// Lançamentos: novo × reativado em 2 números; a tabela por tipo fica recolhida
function lancamentos(d) {
  const sub = d.lancamentos.por_subtipo || []
  if (!sub.length) return vazio('Nenhum lançamento medido ainda.', 'Anúncios criados, duplicados ou reativados aparecem aqui 14 dias depois da conclusão da tarefa.')
  const rot = { reativado: 'Reativados', novo: 'Novos' }
  const kpis = sub.map(s => `<div class="kpi"><div class="rotulo">${esc(rot[s.chave] || s.chave)}</div><div class="valor">${int(s.n)}</div><div class="detalhe">${pc(s.taxa)} venderam em 14 dias (≥ ${pc(s.taxa_baixo)}) · ${brlAbrev(s.receita)}</div></div>`).join('')
  return `<div class="kpis">${kpis}</div><details class="recolhido"><summary>Lançamentos por tipo de tarefa <span class="n">${int(d.lancamentos.por_tipo.length)}</span></summary>${tabela(d.lancamentos.por_tipo, { lanc: true, vazioInstrucao: 'Cite o MLB do anúncio novo no card da tarefa.' })}</details>`
}

// recortes novos da API (no fim da resposta): servidor ainda na versão anterior não os manda — o bloco diz isso em vez de quebrar
const semRecorte = () => vazio('O servidor ainda não entrega este recorte.', 'Ele aparece depois que o servidor for reiniciado com a versão nova.')

function cabecalho(d) {
  const cobs = d.mensurabilidade.map(m => m.cobertura).filter(Boolean)
  const de = cobs.map(c => c.de).filter(Boolean).sort()[0], ate = cobs.map(c => c.ate).filter(Boolean).sort().at(-1), per = d.filtro?.periodo
  // com período no filtro, o recorte é pela data de conclusão da tarefa (o que a API aplica); sem ele, a janela de coleta das contas
  $('metaPeriodo').textContent = per ? `Concluídas ${dt(per.de)}–${dt(per.ate)}/${per.ate.slice(0, 4)}` : de && ate ? `Período ${dt(de)}–${dt(ate)}/${ate.slice(0, 4)}` : 'Período sem contas medidas'
  $('metaContas').textContent = d.n_clientes ? plural(d.n_clientes, 'conta conectada', 'contas conectadas') : 'nenhuma conta conectada'
  if (!d.n_clientes) { $('proximaTexto').textContent = 'Conecte uma conta do Mercado Livre para começar a medir'; $('proximaBtn').textContent = 'Conectar conta'; $('proximaBtn').href = '/integracoes' }
}

// ── drill-down: a linha abre as tarefas medidas do grupo (piorou primeiro, 50 por página no servidor, mesmo ?f= da tela) ──
const ROT_ESTADO = { piorou: 'Piorou', melhorou: 'Melhorou', sem_efeito: 'Sem efeito' }
function linhaDrill(t) {
  const a = t.anuncio, link = (u, txt) => urlOk(u) ? `<a href="${esc(urlOk(u))}" target="_blank" rel="noopener">${txt} ↗</a>` : txt
  const img = a && urlOk(a.thumb) ? `<img class="dr-img" src="${esc(urlOk(a.thumb))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="dr-img" aria-hidden="true"></span>'
  const anuncio = a ? link(a.permalink, esc(String(a.titulo || a.item_id).slice(0, 80))) + (t.itens_extra ? ` <span class="mudo">+${plural(t.itens_extra, 'anúncio', 'anúncios')}</span>` : '') : '<span class="mudo">sem anúncio identificado</span>'
  const tarefa = `${esc(t.tipo)} · ${esc(String(t.titulo || '').slice(0, 90))}${urlOk(t.url) ? ` · ${link(t.url, 'abrir tarefa')}` : ''}`
  const preco = (t.aviso_preco ? `<div class="mini"><span class="selo amb">preço</span> ${esc(t.aviso_preco)}</div>` : '') + (t.aviso_estado ? `<div class="mini"><span class="selo amb">estado</span> ${esc(t.aviso_estado)}</div>` : '')
  return `<tr><td><div class="dr-an">${img}<div><div>${anuncio}</div><div class="mini">${tarefa}</div>${preco}</div></div></td>`
    + `<td><a href="/cliente?cliente=${encodeURIComponent(t.cliente)}">${esc(t.cliente)}</a></td><td>${esc(t.analista || '—')}</td>`
    + `<td class="n">${t.data ? esc(t.data.split('-').reverse().join('/')) : '—'}${t.data_estimada ? ' <span class="mudo" title="sem Concluído em no card: data da última edição">est.</span>' : ''}</td>`
    + `<td><span class="estado e-${esc(t.estado)}">${ROT_ESTADO[t.estado] || esc(t.estado)}</span></td><td class="n${neg(t.efeito_pct)}">${pct1(t.efeito_pct)}</td>`
    + `<td class="n${neg(t.receita)}">${t.receita == null ? '—' : brl(t.receita)}</td><td>${t.confianca?.score != null ? `${int(t.confianca.score)} <span class="mini">${esc(t.confianca.classe)}</span>` : '—'}</td></tr>`
}
async function paginaDrill(box, pagina) {
  const [grupo, ...resto] = box.dataset.alvo.split('|'), q = new URLSearchParams({ grupo, chave: resto.join('|'), pagina })
  if (fAtual) q.set('f', fAtual)
  const pag = box.querySelector('.t-pag')
  if (pagina === 1) box.innerHTML = SK.mensura; else pag.querySelector('button')?.setAttribute('disabled', '')
  try {
    const r = await fetch('/api/resultados/tarefas?' + q), d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.erro || 'HTTP ' + r.status)
    if (pagina === 1) {
      if (!d.total) { box.innerHTML = vazio('Nenhuma tarefa medida neste grupo.', 'O filtro aplicado pode ter tirado as medidas deste grupo.'); return }
      const c = d.contagem || {}
      const selo = (n, cls, txt) => n ? `<span class="estado ${cls}">${txt}</span>` : `<span class="mudo">${txt}</span>`   // zero sem selo, como na tabela
      box.innerHTML = `<p class="linha peq">${selo(c.piorou, 'e-piorou', plural(c.piorou || 0, 'piorou', 'pioraram'))}${selo(c.melhorou, 'e-melhorou', plural(c.melhorou || 0, 'melhorou', 'melhoraram'))}${selo(c.sem_efeito, 'e-sem_efeito', `${int(c.sem_efeito)} sem efeito`)}${+box.dataset.conf ? `<span class="mudo">inclui ${plural(+box.dataset.conf, 'medida', 'medidas')} fora do aprendizado por preço ou estado (aviso na linha)</span>` : ''}</p>`
        + '<table><thead><tr><th scope="col">Anúncio e tarefa</th><th scope="col">Cliente</th><th scope="col">Analista</th><th scope="col" class="n">Concluída</th><th scope="col">Resultado</th><th scope="col" class="n">Efeito</th><th scope="col" class="n">R$</th><th scope="col">Confiança</th></tr></thead><tbody></tbody></table>'
        + `<div class="t-pag"></div><p class="mini">${esc(d.aviso)}</p>`
    }
    const antes = box.querySelectorAll('tbody tr').length
    box.querySelector('tbody').insertAdjacentHTML('beforeend', d.linhas.map(linhaDrill).join(''))
    box.querySelector('.t-pag').innerHTML = d.total > d.por_pagina ? `<span>${int(Math.min(d.total, d.pagina * d.por_pagina))} de ${int(d.total)}</span>${d.pagina < d.paginas ? `<button class="btn btn-p" type="button" data-drill-mais="${d.pagina + 1}">Mostrar mais</button>` : ''}` : ''
    // o botão foi trocado: o foco vai para o novo "Mostrar mais" (ou o 1º link das linhas novas), não volta ao topo da página
    if (pagina > 1) (box.querySelector('[data-drill-mais]') || box.querySelectorAll('tbody tr')[antes]?.querySelector('a'))?.focus()
  } catch (e) {
    (pagina === 1 ? box : pag).innerHTML = erro('As tarefas deste grupo não vieram do servidor.', e.message, `data-drill-mais="${pagina}"`)
  }
}
function abrirDrill(b) {
  const tr = b.closest('tr'), abrir = b.getAttribute('aria-expanded') !== 'true', det = tr.nextElementSibling?.classList.contains('det') ? tr.nextElementSibling : null
  b.setAttribute('aria-expanded', String(abrir))
  if (det) { det.hidden = !abrir; return }
  if (!abrir) return
  const novo = document.createElement('tr')
  novo.className = 'det' + (tr.classList.contains('pequena') ? ' pequena' : '')
  novo.innerHTML = '<td colspan="8"><div class="drill"></div></td>'
  const box = novo.querySelector('.drill')
  box.dataset.alvo = b.dataset.drill; box.dataset.conf = b.dataset.conf   // conf: as confundidas (preço ou estado) que a linha da tabela não conta
  tr.after(novo)
  paginaDrill(box, 1)
}

// ?f= na URL ao abrir: a tela já carrega filtrada (o PSFiltros lê a mesma URL e só dispara aoAplicar de novo se o f mudar)
let fAtual = new URLSearchParams(location.search).get('f')
async function carregar(f = fAtual) {
  fAtual = f
  $('vereditoFrase').textContent = 'Lendo as medições…'; window.PS?.regua('regua', {})
  for (const id of BLOCOS) poe(id, SK[id], true)
  let d
  try {
    const r = await fetch('/api/resultados/padroes' + (f ? '?f=' + encodeURIComponent(f) : ''))
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'HTTP ' + r.status)
    d = await r.json()
  } catch (e) {
    $('vereditoFrase').textContent = 'As medições não vieram do servidor.'
    for (const id of BLOCOS) poe(id, erro('Os padrões das tarefas não vieram do servidor. Confira a conexão e tente de novo.', e.message))
    return
  }
  const soma = k => d.mensurabilidade.reduce((t, m) => t + (m[k] || 0), 0)
  const cob = { melhorou: soma('melhorou'), sem_efeito: soma('sem_efeito'), piorou: soma('piorou'), lancamento: soma('lancamento'), variacao_conta: soma('variacao_conta'), maturando: soma('sem_base') + soma('em_maturacao') + soma('sem_controle'), total: soma('mensuraveis'), confundidas: soma('confundidas') }
  cob.medidos = cob.melhorou + cob.sem_efeito + cob.piorou
  const partes = {
    veredito: () => veredito(d, cob),
    mensura: () => cobertura(d, cob),
    tipos: () => tabela(d.por_tipo, { grupo: 'tipo' }),
    nichos: () => avisoCanal(d) + (d.por_nicho ? tabela(d.por_nicho, { col1: 'Nicho', rotulo: 'nichos', grupo: 'nicho' }) : semRecorte()),
    regioes: () => d.por_regiao ? tabela(d.por_regiao, { col1: 'Região', rotulo: 'regiões', um: 'região', grupo: 'regiao' }) : semRecorte(),
    lanc: () => lancamentos(d),
    nichoTipo: () => {
      if (!d.por_nicho_tipo) return semRecorte()
      $('nNichoTipo').textContent = int(d.por_nicho_tipo.length)
      return tabela(d.por_nicho_tipo, { col1: 'Nicho · tipo', rotulo: 'cruzamentos', grupo: 'nicho_tipo', vazioTitulo: 'Nenhum cruzamento com 5 ou mais tarefas medidas.', vazioInstrucao: 'Os cruzamentos de nicho e tipo aparecem quando o mesmo par soma 5 tarefas medidas.' })
    },
    analistas: () => { $('nAnalistas').textContent = int(d.por_analista.length); return tabela(d.por_analista, { col1: 'Analista', rotulo: 'analistas', grupo: 'analista' }) },
    palavras: () => { $('nPalavras').textContent = int(d.por_palavra.length); return tabela(d.por_palavra, { col1: 'Palavra', rotulo: 'palavras', vazioTitulo: 'Ainda não há palavras com 5 ou mais tarefas medidas.', vazioInstrucao: 'Quando mais tarefas forem medidas, as palavras recorrentes dos títulos aparecem aqui.' }) },
  }
  try { cabecalho(d) } catch (e) { console.error(e) }
  for (const [id, fn] of Object.entries(partes)) {
    try { poe(id, fn()) } catch (e) { poe(id, erro('Este bloco não pôde ser montado com os dados recebidos.', e.message)) }
  }
  for (const i of document.querySelectorAll('[data-w]')) i.style.flexGrow = i.dataset.w   // largura das fatias é dado, não estilo
}

document.querySelector('main').addEventListener('click', e => {
  if (e.target.closest('[data-tentar]')) return carregar()
  const dr = e.target.closest('[data-drill]'); if (dr) return abrirDrill(dr)
  const mais = e.target.closest('[data-drill-mais]'); if (mais) return paginaDrill(mais.closest('.drill'), Number(mais.dataset.drillMais))
  const b = e.target.closest('[data-pequenas]'); if (!b) return
  // ocultar some com as linhas pequenas e com o drill aberto delas; mostrar volta só as linhas (o drill reabre no clique)
  const grupo = b.closest('.tab-grupo'), ocultar = b.textContent.startsWith('Ocultar')
  grupo.querySelectorAll('tr.pequena').forEach(tr => { if (ocultar || !tr.classList.contains('det')) tr.hidden = ocultar })
  if (ocultar) grupo.querySelectorAll('tr.pequena [aria-expanded]').forEach(x => x.setAttribute('aria-expanded', 'false'))
  b.textContent = b.textContent.replace(/^(Mostrar|Ocultar)/, ocultar ? 'Mostrar' : 'Ocultar')
})
// filtros do painel "resultados": tudo na tela (veredito, cobertura, tabelas, lançamentos) recarrega com o mesmo ?f=; sem o componente, a tela segue sem filtro
window.PSFiltros?.montar($('filtros'), { painel: 'resultados', aoAplicar: (_def, f) => { if (f !== fAtual) carregar(f) } })
carregar()
