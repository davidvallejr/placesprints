// Tela do cliente: retroalimentação do Merovíngio (estado da conta, o que fazer, o que funciona, 80/20, combinações) e
// tarefas com o ANÚNCIO (imagem), antes × 24h × 48h × 72h × 1 semana × hoje e micro gráfico. Carregado antes de cliente.js:
// usa $, esc, api, brl, sg, brData, NAO_CONECTADO, ligarColetar, dados e atualizarDadosML de lá (só em tempo de chamada).
const nPt = (v, d = 2) => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d })
const sinalPct = v => v == null ? '' : (v > 0 ? '+' : '') + nPt(v, 1)
const urlOk = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : ''
const imgAnuncio = (t, alt, cls = '') => urlOk(t) ? `<img class="${cls}" src="${esc(urlOk(t))}" alt="${esc(alt || '')}" loading="lazy" referrerpolicy="no-referrer">` : `<div class="ac-semimg ${cls}">sem imagem</div>`
// selo do anúncio de CATÁLOGO (HTML constante, sem dado interpolado): terceiros = conteúdo controlado pelo catálogo do ML; próprio = conteúdo só por sugestão de correção. 'nao'/vazio = nada.
const seloCatalogo = o => o === 'terceiros' ? '<span class="selo azul" title="Conteúdo controlado pelo catálogo do Mercado Livre: foto, título e descrição não são alterados pelo vendedor">Catálogo</span>' : o === 'proprio' ? '<span class="selo azul" title="Catálogo próprio: o conteúdo muda por sugestão de correção, com revisão do Mercado Livre">Catálogo próprio</span>' : ''
const svgSeguro = svg => typeof svg === 'string' && /^<svg class="micro" [^>]*>[\s\S]*<\/svg>$/.test(svg) && !/<script|<foreignObject|\son\w+\s*=|javascript:|<a[\s>]|<image|<use/i.test(svg) ? svg : ''
const VEREDITO = { funciona: ['funciona', 'ok'], nao_funciona: ['sem resultado mensurável', 'no'], inconclusivo: ['resultado misto', 'mid'], sem_amostra: ['sem amostra', 'mid'] }
const ESTADO_ROT = { queda: 'Queda', estagnacao: 'Estagnação', crescimento: 'Crescimento', sem_base: 'Sem base' }
const nomeQuem = () => { try { return localStorage.getItem('ps_perfil_por') || '' } catch { return '' } }

// ── 1. Retroalimentação ─────────────────────────────────────────────────────
async function carregarRetro(cliente) {
  const alvo = document.getElementById('retro'); if (!alvo) return
  try {
    const r = await api('/api/cliente/retroalimentacao?cliente=' + encodeURIComponent(cliente))
    if (dados?.cliente !== cliente) return
    if (r.disponivel === false) { alvo.innerHTML = NAO_CONECTADO(cliente, r); ligarColetar(alvo); avisarRetro({ cliente, estado: null }); return }
    alvo.innerHTML = htmlRetro(r)
    const e = r.estado || {}
    avisarRetro({ cliente, estado: e.estado ?? null, rotulo: e.rotulo, forca: e.forca, delta: e.variacao_pct, janela_dias: e.janela_dias, estado28: e.confirmacao_28d?.estado, delta28: e.confirmacao_28d?.variacao_pct })
  } catch (e) { erroBloco(alvo, e, () => carregarRetro(cliente)); avisarRetro({ cliente, erro: e.message }) }
}
// o KPI "Resultado do cliente" e o veredito (cliente.js) ouvem este evento
const avisarRetro = detail => document.dispatchEvent(new CustomEvent('ps:retro', { detail }))
function tagVeredito(v) { const [t, c] = VEREDITO[v] || VEREDITO.sem_amostra; return `<span class="ac-v ${c}">${esc(t)}</span>` }
function htmlRetro(r) {
  const e = r.estado, q = r.queda
  const topo = e.estado === 'sem_base'
    ? `<div class="aviso-faixa">${esc(e.motivo)}. Nada foi estimado.</div>`
    : `<div class="ac-estado"><span class="ac-badge ac-${e.estado}">${esc(e.rotulo)}${e.forca === 'forte' ? ' forte' : ''}</span>
        <div><b class="ac-grande">${sinalPct(e.variacao_pct)}%</b> de faturamento nos últimos ${e.janela_dias} dias
          <div class="mini">${brl(e.receita.atual)} contra ${brl(e.receita.anterior)}${e.confirmacao_28d ? ` · mês de 28 dias: ${esc(ESTADO_ROT[e.confirmacao_28d.estado] || '')} (${sinalPct(e.confirmacao_28d.variacao_pct)}%)` : ''}${e.dentro_do_ruido ? ' · variação dentro do ruído de contagem' : ''}</div></div></div>
      <p class="mt-2">${esc(r.leitura)}</p>${e.sinal_misto ? `<div class="aviso-faixa">${esc(e.sinal_misto)}</div>` : ''}`
  const ciclo = r.ciclo_anterior ? `<div class="mini">Ciclo anterior (${brData(r.ciclo_anterior.dia)}): ${esc(ESTADO_ROT[r.ciclo_anterior.estado] || r.ciclo_anterior.estado)} → agora ${esc(e.rotulo)} · <b>${r.ciclo_anterior.evolucao === 'melhorou' ? 'melhorou' : r.ciclo_anterior.evolucao === 'piorou' ? 'piorou' : 'igual'}</b>${r.ciclo_anterior.acoes_executadas_desde ? ` · ${r.ciclo_anterior.acoes_executadas_desde} ação(ões) do plano distribuída(s) desde então` : ''}</div>` : ''
  const queda = q ? `<div class="cartao ac-bloco"><h4>Por que caiu e o que fazer</h4>
      <ol class="ac-lista">${q.motivos.map(m => `<li><b>${esc(m.rotulo)}</b> <span class="ac-v ${m.tipo === 'fato' ? 'ok' : 'mid'}">${m.tipo === 'fato' ? 'dado' : 'hipótese'}</span><div>${esc(m.texto)}</div>${m.evidencia ? `<div class="mini">${esc(m.evidencia)}</div>` : ''}${m.acao ? `<div class="pos">Fazer: ${esc(m.acao)}</div>` : ''}
        ${(m.itens || []).length ? `<div class="ac-minis">${m.itens.slice(0, 4).map(i => `<a class="ac-mini" ${urlOk(i.permalink) ? `href="${esc(urlOk(i.permalink))}" target="_blank" rel="noopener"` : ''}>${imgAnuncio(i.thumb, i.titulo)}<span>${esc((i.titulo || '').slice(0, 46))} ${seloCatalogo(i.catalogo_origem)}${i.delta != null ? ` <i class="${i.delta < 0 ? 'neg' : 'pos'}">${i.delta < 0 ? '−' : '+'}${brl(Math.abs(i.delta))}</i>` : ''}</span></a>`).join('')}</div>` : ''}</li>`).join('')}</ol>
      ${q.acoes.length ? `<h5>Ações recomendadas</h5><ul class="ac-lista">${q.acoes.map(a => `<li>${esc(a.descricao)} <span class="mini">(${esc(a.regra)})</span></li>`).join('')}</ul>` : ''}
      ${q.tarefas.length ? `<h5>Tarefas que mais ajudam nesse cenário</h5><ul class="ac-lista">${q.tarefas.map(t => `<li><b>${esc(t.tipo)}</b> ${tagVeredito(t.veredito)}${t.n ? ` <span class="mini">${t.melhorou} de ${t.n} melhoraram</span>` : ''}</li>`).join('')}</ul>` : ''}
      <h5>Atitudes</h5><ul class="ac-lista">${q.atitudes.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''
  const jog = r.jogadas && !q ? `<div class="cartao ac-bloco"><h4>${esc(r.jogadas.titulo)}</h4><p class="mini">${esc(r.jogadas.leitura)}</p>
      <ol class="ac-lista">${r.jogadas.jogadas.map(j => `<li><b>${esc(j.titulo)}</b><div>${esc(j.porque)}</div>${j.extra ? `<div class="mini">${esc(j.extra)}</div>` : ''}
        ${j.regras.some(x => x.abertas) ? `<div class="mini">No plano: ${j.regras.filter(x => x.abertas).map(x => `${esc(x.regra)} (${x.abertas} aberta${x.abertas > 1 ? 's' : ''})`).join(', ')}</div>` : ''}
        ${j.tipos.length ? `<div class="mini">Tarefas: ${j.tipos.map(t => `${esc(t.tipo)}${t.conta?.n ? ` (${t.conta.melhorou}/${t.conta.n} nesta conta)` : ''}`).join(' · ')}</div>` : ''}</li>`).join('')}</ol>
      <h5>Atitudes</h5><ul class="ac-lista">${r.jogadas.atitudes.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''

  // aprendizado: o que funciona e o que não funciona (conta + base) e como isso mexeu no plano
  const ap = r.aprendizado
  const tipos = ap.por_tipo.filter(t => t.n >= 3).slice(0, 10)
  const fat = Object.values(r.fatores || {}).filter(f => f.fator !== 1).sort((a, b) => b.fator - a.fator)
  const aprend = `<div class="cartao ac-bloco"><h4>O que funciona e o que não funciona <span class="mini">(aprendizado do Merovíngio)</span></h4>
    <p class="mini">${ap.geral_todos.n} tarefa(s) com resultado medido na base (${ap.conta.n} desta conta). O plano de ação usa isso como fator de prioridade: o que melhorou vendas sobe na fila, o que não mostrou resultado desce.</p>
    ${tipos.length ? `<div class="ac-rolagem"><table class="ac-tab"><thead><tr><th>Tipo de tarefa</th><th>Medidas</th><th>Melhoraram</th><th>Sem efeito</th><th>Pioraram</th><th>Nesta conta</th><th>Leitura</th></tr></thead><tbody>${tipos.map(t => `<tr><td><b>${esc(t.tipo)}</b></td><td>${t.n}</td><td>${t.melhorou}</td><td>${t.sem_efeito}</td><td>${t.piorou}</td><td>${t.conta ? `${t.conta.melhorou}/${t.conta.n}` : '—'}</td><td>${tagVeredito(t.veredito)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio-box">Ainda não há tipo de tarefa com 3+ medidas.</div>'}
    <div class="mini mt-2">Viés de seleção: tarefas costumam ser aplicadas em anúncios que já estavam caindo ou que já eram campeões; "sem resultado mensurável" não é o mesmo que "tarefa inútil".</div>
    ${fat.length ? `<h5>Como o plano foi reordenado</h5><ul class="ac-lista">${fat.slice(0, 6).map(f => `<li><b>${esc(f.regra)}</b> ×${nPt(f.fator)} <span class="mini">${esc(f.motivo)}</span></li>`).join('')}</ul>` : ''}</div>`

  // 80/20
  const P = r.pareto
  const par = `<div class="cartao ac-bloco"><h4>O 80/20 da conta</h4>
    ${P.itens.disponivel ? `<p>${esc(P.itens.leitura)}</p>${P.itens.alerta ? `<div class="aviso-faixa mt-2">${esc(P.itens.alerta)}</div>` : ''}
      <div class="ac-minis">${P.itens.itens.slice(0, 10).map(i => `<a class="ac-mini" ${urlOk(i.permalink) ? `href="${esc(urlOk(i.permalink))}" target="_blank" rel="noopener"` : ''}>${imgAnuncio(i.thumb, i.titulo)}<span>${esc((i.titulo || '').slice(0, 50))} ${seloCatalogo(i.catalogo_origem)}<i class="mudo"> ${nPt(i.share_pct, 1)}% · acum. ${nPt(i.acum_pct, 1)}%</i></span></a>`).join('')}</div>` : `<div class="mudo">${esc(P.itens.motivo)}</div>`}
    ${P.tarefas.disponivel ? `<h5>Ações que mais geraram resultado</h5><p>${esc(P.tarefas.leitura)}</p>${P.tarefas.por_tipo.some(t => t.ganho > 0) ? `<div class="ac-rolagem"><table class="ac-tab"><thead><tr><th>Tipo</th><th>Medidas</th><th>Melhoraram</th><th>Ganho associado</th><th>Do total</th></tr></thead><tbody>${P.tarefas.por_tipo.filter(t => t.ganho > 0).slice(0, 6).map(t => `<tr><td><b>${esc(t.tipo)}</b></td><td>${t.n}</td><td>${t.melhorou}</td><td>${brl(t.ganho)}</td><td>${nPt(t.share_pct, 1)}%</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${P.tarefas.desperdicio ? `<div class="mini">${P.tarefas.desperdicio.sem_efeito} sem efeito mensurável e ${P.tarefas.desperdicio.piorou} que pioraram (${nPt(P.tarefas.desperdicio.pct, 1)}% das medidas): tempo que pode ir para o que funciona.</div>` : ''}` : ''}</div>`

  // combinações e pior tarefa
  const C = r.combos
  const linhaC = c => `<tr><td><b>${esc(c.chave)}</b>${c.amostra_pequena ? ' <span class="mini">amostra pequena</span>' : ''}</td><td>${c.n}</td><td>${c.melhorou}</td><td>${c.sem_efeito}</td><td>${c.piorou}</td><td>${c.efeito_mediano_pct == null ? '—' : sinalPct(c.efeito_mediano_pct) + '%'}</td></tr>`
  const tabC = l => `<div class="ac-rolagem"><table class="ac-tab"><thead><tr><th>Combinação (mesmo anúncio, mesma quinzena)</th><th>Casos</th><th>Melhorou</th><th>Sem efeito</th><th>Piorou</th><th>Efeito mediano</th></tr></thead><tbody>${l.map(linhaC).join('')}</tbody></table></div>`
  const comb = `<div class="cartao ac-bloco"><h4>Combinações de tarefas</h4><p class="mini">${esc(C.leitura)}</p>
    ${C.funcionam.length ? `<h5>Quais tarefas juntas melhoraram</h5>${tabC(C.funcionam.slice(0, 6))}` : ''}
    ${!C.funcionam.length && C.candidatas.length ? `<h5>Candidatas (ainda sem amostra para afirmar)</h5>${tabC(C.candidatas.slice(0, 4))}` : ''}
    ${C.pioram.length ? `<h5>Combinações que não deram certo</h5>${tabC(C.pioram.slice(0, 4))}` : ''}</div>`
  const W = r.pior_tarefa
  const pior = `<div class="cartao ac-bloco"><h4>A tarefa que pede mais cuidado</h4>
    ${W.disponivel ? `${W.tipos.map(t => `<p><b>${esc(t.tipo)}</b> — ${esc(t.leitura)}${t.conta ? ` <span class="mini">Nesta conta: ${t.conta.n} medidas, ${t.conta.piorou} seguidas de piora.</span>` : ''}</p>`).join('')}
      ${W.tarefas_individuais.length ? `<h5>Tarefas desta conta seguidas de piora</h5><ul class="ac-lista">${W.tarefas_individuais.map(t => `<li>${esc((t.titulo || '').slice(0, 90))} <span class="mini">${esc(t.tipo || '')} · ${brData(t.data)} · ${sinalPct(t.efeito_pct)}%</span></li>`).join('')}</ul>` : ''}
      <h5>Como fazer com cuidado</h5><ul class="ac-lista">${W.cuidados.map(c => `<li>${esc(c)}</li>`).join('')}</ul><div class="mini">${esc(W.aviso)}</div>` : `<div class="mudo">${esc(W.leitura)}</div>`}</div>`

  // duplicação estratégica: o sistema aprende por família (original + duplicatas) — objetivo, volume, aderência ao método e canibalização
  const D = r.duplicacao
  const ESTADO_DUP = { melhorou: ['melhorou', 'ok'], piorou: ['piorou', 'no'], sem_efeito: ['sem efeito', 'mid'], sem_base: ['sem base', 'mid'], sem_original: ['original não achado', 'mid'], sem_duplicata: ['sem duplicata', 'mid'] }
  const dup = !D ? '' : D.erro ? `<div class="cartao ac-bloco"><h4>Duplicação estratégica</h4><div class="mudo">${esc(D.erro)}</div></div>` : (!D.episodios?.length && !D.base?.n) ? '' : `<div class="cartao ac-bloco"><h4>Duplicação estratégica <span class="mini">(o sistema aprende por família: original + duplicatas)</span></h4>
    <p class="mini">Regra de ouro do método: nunca duplicar sem objetivo. A família é medida pelo efeito líquido (o original pode perder o que a duplicata ganha) e cada duplicação é conferida contra o método do treinamento.</p>
    ${(D.base?.leituras || []).length ? `<ul class="ac-lista">${D.base.leituras.slice(0, 6).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    ${D.base?.por_objetivo?.length ? `<h5>Por objetivo <span class="mini">(toda a base: ${D.base.n_medidos} duplicação(ões) medida(s))</span></h5><div class="ac-rolagem"><table class="ac-tab"><thead><tr><th>Objetivo</th><th>Medidas</th><th>Melhoraram</th><th>Canibalizaram</th><th>Leitura</th></tr></thead><tbody>${D.base.por_objetivo.map(o => `<tr><td><b>${esc(o.chave)}</b></td><td>${o.n}</td><td>${o.melhorou}</td><td>${o.canibalizou}</td><td>${tagVeredito(o.veredito)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${D.base?.por_volume?.length ? `<h5>Por volume de duplicatas</h5><div class="ac-rolagem"><table class="ac-tab"><thead><tr><th>Volume</th><th>Medidas</th><th>Melhoraram</th><th>Leitura</th></tr></thead><tbody>${D.base.por_volume.map(o => `<tr><td><b>${esc(o.chave)}</b></td><td>${o.n}</td><td>${o.melhorou}</td><td>${tagVeredito(o.veredito)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${Object.keys(D.fator_por_objetivo || {}).length ? `<div class="mini mt-2">Ajuste no plano: ${Object.entries(D.fator_por_objetivo).map(([k, f]) => `${esc(k)} ×${nPt(f.fator)} (${f.melhorou}/${f.n})`).join(' · ')}</div>` : '<div class="mini mt-2">Sem ajuste no plano: nenhum objetivo difere de forma conclusiva do geral ainda.</div>'}
    ${D.episodios?.length ? `<h5>Duplicações desta conta</h5><ul class="ac-lista">${D.episodios.slice(0, 8).map(e => { const [t, c] = ESTADO_DUP[e.estado] || [e.estado, 'mid']; return `<li><b>${esc((e.titulo || '').slice(0, 80))}</b> <span class="mini">${brData(e.data)} · ${esc(e.objetivo?.nome || e.objetivo?.id || '—')} · ${e.n_filhos} duplicata(s)</span> <span class="ac-v ${c}">${esc(t)}${e.efeito_pct != null ? ' ' + sinalPct(e.efeito_pct) + '%' : ''}</span>${e.canibalizou ? ' <span class="ac-v no">canibalizou o original</span>' : ''}
        <div class="mini">${(e.aderencia?.itens || []).map(i => `${i.ok === true ? 'ok' : i.ok === false ? 'não' : '—'}: ${esc(i.texto)}`).join('<br>')}</div>${e.motivo ? `<div class="mini">${esc(e.motivo)}</div>` : ''}</li>` }).join('')}</ul>` : ''}</div>`

  return `${topo}${ciclo}${queda}${jog}<div class="ac-grade">${par}${aprend}${comb}${pior}${dup}</div>
    <details class="evid mt-4"><summary>Limites desta leitura</summary><div class="box">${(r.limites || []).map(l => `<div>${esc(l)}</div>`).join('')}</div></details>`
}

// ── 2. Resultado das tarefas: veredito por tarefa (c.veredito do servidor), antes × depois, micro gráfico ──
// Piorou primeiro, 8 cartões por página; o chip padrão nunca abre vazio. Os contadores das abas (cliente.js) ouvem ps:acomp.
const ORDEM_FAM = ['piorou', 'melhorou', 'lancou', 'sem_efeito', 'maturando', 'andamento', 'sem_base']   // = ORDEM_FAMILIA de acompanhamento.js
const SELO_FAM = { piorou: ['e-piorou', 'Piorou'], melhorou: ['e-melhorou', 'Melhorou'], lancou: ['e-lancamento', 'Lançou'], sem_efeito: ['e-sem_efeito', 'Sem efeito'], maturando: ['e-em_maturacao', 'Em maturação'], andamento: ['e-em_maturacao', 'Em andamento'], sem_base: ['e-sem_base', 'Sem base'] }
const FAM_DO_ESTADO = { piorou: 'piorou', melhorou: 'melhorou', lancamento: 'lancou', sem_efeito: 'sem_efeito', em_maturacao: 'maturando', em_andamento: 'andamento' }   // cartão sem veredito (servidor antigo)
const famCartao = c => c.veredito?.familia || FAM_DO_ESTADO[c.medido?.estado] || 'sem_base'
// "Com resultado medido" = o motor mediu contra o controle (lançamento é venda bruta, sem controle: chip próprio);
// "Em andamento" junta a tarefa aberta (só o antes) e a concluída cuja medição ainda não fechou
const CHIPS_ACOMP = [['medido', 'Com resultado medido', ['piorou', 'melhorou', 'sem_efeito']], ['piorou', 'Piorou', ['piorou']], ['melhorou', 'Melhorou', ['melhorou']], ['lancou', 'Lançou', ['lancou']],
  ['andamento', 'Em andamento', ['andamento', 'maturando']], ['sem_base', 'Sem base', ['sem_base']], ['todas', 'Todas', ORDEM_FAM]]
const PAG_ACOMP = 8
let acompModo = null, acompLimite = PAG_ACOMP, acompCliente = null
const diaMes = d => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : ''
const avisarAcomp = detail => document.dispatchEvent(new CustomEvent('ps:acomp', { detail }))
async function carregarAcomp(cliente) {
  const alvo = document.getElementById('acomp'); if (!alvo) return
  if (acompCliente !== cliente) { acompCliente = cliente; acompModo = null }
  try {
    // limite 120: o servidor ordena piorou primeiro, então o corte nunca deixa um "piorou" de fora
    const [p, v] = await Promise.all([api('/api/cliente/tarefas-anuncio?cliente=' + encodeURIComponent(cliente) + '&dias=60&limite=120'), api('/api/cliente/vinculos?cliente=' + encodeURIComponent(cliente)).catch(() => null)])
    if (dados?.cliente !== cliente) return
    if (p.disponivel === false) { alvo.innerHTML = NAO_CONECTADO(cliente, p); ligarColetar(alvo); avisarAcomp({ cliente, piorou: 0, tarefas: null }); return }
    avisarAcomp({ cliente, piorou: p.resumo.por_familia?.piorou ?? p.cartoes.filter(c => famCartao(c) === 'piorou').length, tarefas: p.resumo.tarefas_com_anuncio })
    acompLimite = PAG_ACOMP
    desenharAcomp(alvo, cliente, p, v)
  } catch (e) { erroBloco(alvo, e, () => carregarAcomp(cliente)) }
}
function celulaMarco(m, k, un, pol) {
  if (!m) return '<td class="nd">—</td>'
  if (m.estado === 'aguardando') return `<td class="ag">fecha em ${brData(m.disponivel_em)}</td>`
  const v = m.valores?.[k]
  if (v == null) return `<td class="nd" title="${esc(m.motivos?.[k] || '')}">—</td>`
  const d = m.deltas?.[k]
  const val = un === 'moeda' ? brl(v) : un === 'pct' ? nPt(v) + '%' : un === 'x' ? nPt(v) + 'x' : nPt(v)
  let dl = ''
  const cor = x => x === 0 || pol === null ? 'n' : (x > 0) === (pol !== false) ? 'b' : 'r'
  if (d?.pontos != null) dl = `<i class="${cor(d.pontos)}">${sinalPct(d.pontos)} p.p.</i>`
  else if (d?.pct != null) dl = `<i class="${cor(d.pct)}">${sinalPct(d.pct)}%</i>`
  return `<td>${val}${dl}</td>`
}
const LINHAS_ACOMP = [['visitas', 'Visitas/dia', 'num', true], ['unidades', 'Vendas/dia', 'num', true], ['receita', 'Faturamento/dia', 'moeda', true], ['conversao', 'Conversão', 'pct', true],
  ['ads_prints', 'Impressões Ads/dia', 'num', true], ['ads_clicks', 'Cliques Ads/dia', 'num', true], ['ads_custo', 'Invest. Ads/dia', 'moeda', null], ['ads_roas', 'ROAS', 'x', true]]
// mudança de preço na janela da tarefa (motor): valores, data e dia relativo à conclusão
const rotPreco = (e, varios) => `${varios ? esc(e.item_id) + ' ' : ''}${brl2(e.de)} → ${brl2(e.para)}${e.pct != null && Math.abs(e.pct) >= 0.1 ? ` (${sinalPct(e.pct)}%)` : ''} ${e.incerteza ? esc(e.incerteza) : `em ${diaMes(e.dia)}${e.dia_rel != null ? `, dia ${String(e.dia_rel).replace('-', '−')}` : ''}`}`
const valMudanca = (m, k) => m.campo === 'preco' ? brl2(m[k]) : esc(String(m[k] ?? '—').slice(0, 60))
function cartaoAcomp(c) {
  const it = c.itens[0] || {}, q = c.quadro, med = c.medido, ve = c.veredito, [selo, rotFam] = SELO_FAM[famCartao(c)], evP = c.precos?.eventos || []
  const marcos = ['d1', 'd2', 'd3', 'd7'].map(k => (q.marcos || []).find(m => m.k === k))
  const temAlgo = k => q.base.valores[k] != null || marcos.some(m => m?.valores?.[k] != null) || q.hoje?.valores?.[k] != null
  const linhas = LINHAS_ACOMP.filter(([k]) => temAlgo(k)).map(([k, rot, un, pol]) => `<tr><th>${esc(rot)}</th><td class="base">${q.base.valores[k] == null ? '—' : (un === 'moeda' ? brl(q.base.valores[k]) : un === 'pct' ? nPt(q.base.valores[k]) + '%' : un === 'x' ? nPt(q.base.valores[k]) + 'x' : nPt(q.base.valores[k]))}</td>${marcos.map(m => celulaMarco(m, k, un, pol)).join('')}${celulaMarco(q.hoje, k, un, pol)}</tr>`).join('')
  const emAndamento = med.estado === 'em_andamento'
  const lanc = med.estado === 'lancamento'
  const mud = (it.mudancas || []).filter(m => m.campo !== 'thumb')
  const cls = c.gerou_resultado ? 'ok' : med.estado === 'piorou' ? 'no' : ''
  return `<div class="ac-card ${cls}">
    <div class="ac-item">${c.itens.map(i => `<div class="ac-item-um">${imgAnuncio(i.thumb, i.titulo, 'ac-img')}<div class="ac-item-txt"><div class="mini">Anúncio</div>${urlOk(i.permalink) ? `<a href="${esc(urlOk(i.permalink))}" target="_blank" rel="noopener">${esc((i.titulo || 'Anúncio').slice(0, 80))} ↗</a>` : esc(i.titulo || 'Anúncio')} ${seloCatalogo(i.catalogo_origem)}
      <div class="mini">${esc(i.item_id || '')}${i.preco != null ? ' · R$ ' + Number(i.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}${i.status && i.status !== 'active' ? ' · ' + esc(({ paused: 'pausado', under_review: 'em revisão', closed: 'encerrado', inactive: 'inativo' })[i.status] || i.status) : ''}</div></div></div>`).join('')}
      ${c.itens_extra ? `<div class="mini">+ ${c.itens_extra} outro(s) anúncio(s) na mesma tarefa</div>` : ''}${(c.vinculo.n_itens || c.itens.length) > 1 ? `<div class="mini">métricas somadas de ${c.vinculo.n_itens || c.itens.length} anúncios</div>` : ''}
      <div class="mini">vínculo: ${esc((c.vinculo.origem || []).map(o => ({ citado: 'ID no card', plano: 'ação do plano', confirmado: 'confirmado pela equipe' }[o] || o)).join(', '))}</div></div>
    <div class="ac-corpo">
      <div class="ac-topo"><b>${c.tarefa.url && urlOk(c.tarefa.url) ? `<a href="${esc(urlOk(c.tarefa.url))}" target="_blank" rel="noopener">${esc(c.tarefa.titulo)} ↗</a>` : esc(c.tarefa.titulo)}</b></div>
      <div class="ac-veredito"><span class="estado ${selo}">${rotFam}</span><b>${esc(ve?.titulo || med.rotulo)}</b>${ve?.linha ? `<div class="mini">${esc(ve.linha)}</div>` : ''}</div>
      <div class="acao-tags">${c.tarefa.tipo ? `<span class="tagzinha">${esc(c.tarefa.tipo)}</span>` : ''}${c.tarefa.data ? `<span class="tagzinha">${brData(c.tarefa.data)}${c.tarefa.data_estimada ? ' (estimada)' : ''}</span>` : ''}${c.tarefa.analista ? `<span class="tagzinha">${esc(c.tarefa.analista)}</span>` : ''}${med.confianca ? `<span class="tagzinha">confiança ${med.confianca.score}</span>` : ''}</div>
      <p class="ac-leitura">${esc(c.leitura)}</p>
      <div class="ac-rolagem"><table class="ac-tab ac-marcos"><thead><tr><th></th><th>Antes<small>média ${q.janela_base?.dias || 14}d</small></th><th>24h</th><th>48h</th><th>72h</th><th>1 semana</th><th>Hoje<small>${q.hoje?.atualizado_ate ? 'até ' + brData(q.hoje.atualizado_ate) : ''}</small></th></tr></thead><tbody>${linhas || '<tr><td colspan="7" class="nd">sem dado coletado</td></tr>'}</tbody></table></div>
      ${emAndamento ? '' : !LINHAS_ACOMP.filter(([k]) => k.startsWith('ads_')).some(([k]) => temAlgo(k)) ? '<div class="mini">Sem dado diário de Ads para este anúncio — nada foi estimado.</div>' : ''}
      ${svgSeguro(c.grafico?.svg) ? `<div class="ac-graf">${c.grafico.svg}<div class="mini">${c.grafico.metrica === 'visitas' ? 'Visitas' : 'Vendas'} por dia · média de 3 dias · tracejado vertical = conclusão · horizontal = média de antes${c.grafico.eventos ? ' · ponto = mudança no anúncio' : ''}</div></div>` : ''}
      ${med.receita_alocada != null && !emAndamento ? `<div class="ac-ganho">${lanc ? 'Vendas depois da tarefa (bruto, sem controle)' : med.receita_alocada < 0 ? 'Perda associada (estimativa)' : 'Ganho associado (estimativa)'}: <b>${med.receita_alocada < 0 ? '−' : ''}${brl(Math.abs(med.receita_alocada))}</b>${!lanc && med.efeito_pct != null ? ` · efeito ajustado ${sinalPct(med.efeito_pct)}%` : ''}</div>` : ''}
      ${evP.length ? `<div class="mini ac-mudou"><b>Preço na janela da tarefa (${c.precos.tarefa_de_preco ? 'a própria tarefa' : 'pode ter interferido'}):</b> ${evP.slice(0, 4).map(e => rotPreco(e, c.itens.length > 1)).join(' · ')}${evP.length > 4 ? ` · +${evP.length - 4} outra(s)` : ''}</div>` : ''}
      ${mud.length ? `<div class="mini ac-mudou"><b>O que mudou no anúncio:</b> ${mud.slice(0, 5).map(m => `${esc(m.rotulo)}: ${valMudanca(m, 'antes')} → ${valMudanca(m, 'agora')}${m.incerteza ? ` (${esc(m.incerteza)})` : m.em ? ` (em ${diaMes(m.em)})` : ''}`).join(' · ')}</div>`
        // "sem mudança" só quando o servidor COMPAROU (mudancas é lista); com preço registrado na janela, hoje igual à fotografia não é "nada mudou"
        : it.antes_fotografia && Array.isArray(it.mudancas) ? `<div class="mini ac-mudou">Anúncio fotografado antes da tarefa em ${brData(it.antes_fotografia.capturado_em)} — ${evP.length ? 'hoje igual à fotografia em título, preço e fotos (as mudanças de preço registradas na janela estão acima).' : 'sem mudança de título, preço ou fotos até agora.'}</div>` : ''}
      ${c.plano ? `<div class="mini">Plano: meta "${esc(String(c.plano.meta || '').slice(0, 90))}"${c.plano.previsto_base != null ? ` · previsto (base) ${brl(c.plano.previsto_base)}` : ''}</div>` : ''}
    </div></div>`
}
function desenharAcomp(alvo, cliente, p, v) {
  const r = p.resumo
  // ordem: piorou → melhorou → lançou → sem efeito → maturando → andamento → sem base; empate pelo maior R$ em módulo, depois a data mais recente
  const cartoes = [...p.cartoes].sort((a, b) => ORDEM_FAM.indexOf(famCartao(a)) - ORDEM_FAM.indexOf(famCartao(b)) || Math.abs(b.medido.receita_alocada ?? 0) - Math.abs(a.medido.receita_alocada ?? 0)
    || String(b.tarefa.data || '9999').localeCompare(String(a.tarefa.data || '9999')))
  const n = Object.fromEntries(CHIPS_ACOMP.map(([k, , fs]) => [k, cartoes.filter(c => fs.includes(famCartao(c))).length]))
  if (!acompModo || !n[acompModo]) acompModo = n.medido ? 'medido' : 'todas'      // nunca abre num chip vazio
  const fs = CHIPS_ACOMP.find(x => x[0] === acompModo)[2], lista = cartoes.filter(c => fs.includes(famCartao(c)))
  const pior = r.por_familia?.piorou ?? n.piorou, melhor = r.por_familia?.melhorou ?? n.melhorou
  const detMelhor = [melhor ? `${brl(r.ganho_associado)} associados (ajustado pelo controle)` : 'nenhuma melhora medida', r.lancamentos_que_venderam ? `${r.lancamentos_que_venderam} lançamento(s) vendendo ${brl(r.vendas_lancamento)} (bruto, à parte)` : ''].filter(Boolean).join(' · ')
  // o tom fica no ponto do rótulo (kpi.ruim/.bom/.alerta); o valor nunca é colorido
  alvo.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="rotulo">Tarefas com anúncio</div><div class="valor">${r.tarefas_com_anuncio}</div><div class="detalhe">${r.em_andamento} em andamento · últimos ${p.dias} dias</div></div>
      <div class="kpi ${pior ? 'ruim' : ''}"><div class="rotulo">Pioraram</div><div class="valor">${pior}</div><div class="detalhe">${!pior ? 'nenhuma piora medida' : r.perda_associada ? `−${brl(Math.abs(r.perda_associada))} associados (ajustado pelo controle)` : 'sem estimativa de R$'}</div></div>
      <div class="kpi ${melhor ? 'bom' : ''}"><div class="rotulo">Melhoraram</div><div class="valor">${melhor}</div><div class="detalhe">${detMelhor}</div></div>
      <div class="kpi ${r.sem_anuncio_identificado ? 'alerta' : ''}"><div class="rotulo">Sem anúncio identificado</div><div class="valor">${r.sem_anuncio_identificado}</div><div class="detalhe">sem o anúncio não há antes e depois</div></div>
    </div>
    <div class="ac-abas linha">
      ${CHIPS_ACOMP.map(([k, rot]) => `<button class="f-chip${acompModo === k ? ' on' : ''}" data-modo="${k}" type="button" aria-pressed="${acompModo === k}"${n[k] ? '' : ' disabled'}${k === 'andamento' ? ' title="tarefa aberta (só o antes) ou concluída com a medição ainda aberta"' : ''}>${rot} <span class="n">(${n[k]})</span></button>`).join('')}
      <button class="btn-mini" id="btnAcompAtualizar" type="button" title="Recalcula o acompanhamento e o plano com o aprendizado, sem nova coleta no Mercado Livre">Recalcular agora</button>
    </div>
    <div class="aviso-faixa">${esc(p.aviso)} Dado que não foi coletado aparece como "—", nunca como zero.</div>
    ${lista.length ? lista.slice(0, acompLimite).map(cartaoAcomp).join('') : `<div class="vazio-box">Nenhuma tarefa com anúncio identificado nos últimos ${p.dias} dias.</div>`}
    ${lista.length > acompLimite ? `<div class="t-pag">1–${acompLimite} de ${lista.length} <button class="btn btn-p" type="button" data-mais>Mostrar mais</button></div>` : ''}
    ${p.truncado ? `<div class="mini">Lista limitada às ${p.cartoes.length} primeiras tarefas, piorou primeiro; os totais acima contam todas.</div>` : ''}
    ${v?.disponivel ? htmlVinculos(v) : ''}`
  // o redesenho troca o HTML inteiro: o foco volta ao mesmo chip, ou ao novo "Mostrar mais" (senão, ao 1º link do 1º cartão novo) — teclado não volta ao topo
  alvo.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { const k = b.dataset.modo; acompModo = k; acompLimite = PAG_ACOMP; desenharAcomp(alvo, cliente, p, v); alvo.querySelector(`[data-modo="${k}"]`)?.focus() })
  alvo.querySelector('[data-mais]')?.addEventListener('click', () => {
    acompLimite += PAG_ACOMP; desenharAcomp(alvo, cliente, p, v)
    ;(alvo.querySelector('[data-mais]') || alvo.querySelectorAll('.ac-card')[acompLimite - PAG_ACOMP]?.querySelector('a'))?.focus()
  })
  const ba = document.getElementById('btnAcompAtualizar')
  if (ba) ba.onclick = async e => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Recalculando…'
    try { const { job } = await api('/api/cliente/acompanhar', { cliente }); for (let i = 0; ; i++) { if (i > 150) throw new Error('o recálculo está demorando mais que o normal — veja de novo em instantes'); const j = await api('/api/planos/job/' + job); if (j.estado !== 'rodando') { if (j.estado === 'erro') throw new Error(j.erro); break } await new Promise(r => setTimeout(r, 1200)) } if (dados?.cliente === cliente) { carregarAcomp(cliente); carregarRetro(cliente); carregarPlanoConta(cliente) } }
    catch (x) { toast(x.message, 'erro'); b.disabled = false; b.textContent = 'Recalcular agora' }
  }
  ligarVinculos(alvo, cliente, p, v)
}
function htmlVinculos(v) {
  if (!v.sem_anuncio) return `<div class="mini mt-2">Todas as ${v.com_anuncio} tarefa(s) recentes de Mercado Livre têm anúncio identificado.</div>`
  const cand = (t, c) => `<div class="ac-cand">${imgAnuncio(c.thumb, c.titulo)}<div><div>${esc((c.titulo || '').slice(0, 70))}</div><div class="mini">${esc(c.item_id)}${c.motivo ? ' · ' + esc(c.motivo) : ''}${c.score != null ? ` · semelhança ${Math.round(c.score * 100)}%` : ''}</div></div>
      <button class="btn-mini ok" type="button" data-conf="${esc(t)}|${esc(c.item_id)}">Confirmar</button><button class="btn-mini no" type="button" data-rec="${esc(t)}|${esc(c.item_id)}">Não é este</button></div>`
  return `<details class="evid mt-4" ${v.sugestoes.length ? 'open' : ''}><summary>${v.sem_anuncio} tarefa(s) sem anúncio identificado: vincular para medir</summary><div class="box">
    <div class="mini">${esc(v.nota)}</div>
    ${v.sugestoes.map(s => `<div class="ac-vinc"><b>${esc((s.titulo || '').slice(0, 100))}</b>${s.ambiguo ? '<div class="mini">Mais de um anúncio parece servir — escolha:</div>' + s.candidatos.map(c => cand(s.tarefa_id, c)).join('') : cand(s.tarefa_id, s)}</div>`).join('')}
    ${v.sem_sugestao.map(s => `<div class="ac-vinc"><b>${esc(s.titulo)}</b> <span class="mini">sem sugestão automática</span>
      <div class="ac-manual"><input type="text" placeholder="ID do anúncio (MLB…)" data-mlb="${esc(s.tarefa_id)}" maxlength="20"><button class="btn-mini ok" type="button" data-vinc="${esc(s.tarefa_id)}">Vincular</button></div></div>`).join('')}
    <div class="mini mt-2">Quem confirma fica registrado (use o nome salvo no perfil do cliente).</div></div></details>`
}
// quem vincula: <dialog> de 1 campo no lugar do prompt(); o nome fica em ps_perfil_por, como no perfil e na ficha
function perguntarNome() {
  let d = document.getElementById('dlgQuem')
  if (!d) {
    d = document.createElement('dialog'); d.className = 'dlg'; d.id = 'dlgQuem'
    d.innerHTML = `<form method="dialog"><h2>Quem está vinculando?</h2><p class="mudo">O nome fica registrado junto do vínculo.</p>
      <label class="campo">Seu nome<input name="por" required maxlength="80" autocomplete="name" placeholder="Nome e sobrenome"></label>
      <div class="dlg-rodape"><button class="btn" type="button" value="nao" data-fecha>Cancelar</button><button class="btn" type="submit" value="sim">Confirmar</button></div></form>`
    d.querySelector('[data-fecha]').onclick = () => d.close('nao')
    document.body.append(d)
  }
  const f = d.querySelector('form'); f.reset(); f.elements.por.value = nomeQuem(); d.showModal()
  return new Promise(r => d.addEventListener('close', () => r(d.returnValue === 'sim' ? f.elements.por.value.trim() : ''), { once: true }))
}
function ligarVinculos(alvo, cliente, p, v) {
  const por = async () => { const n = (nomeQuem() || await perguntarNome()).trim(); if (n) try { localStorage.setItem('ps_perfil_por', n) } catch { /* sem armazenamento */ } return n }
  const enviar = async (acao, tarefa_id, item_id) => {
    const quem = await por(); if (!quem) return
    try { await api('/api/cliente/vinculo', { acao, tarefa_id, item_id, por: quem }); if (dados?.cliente === cliente) carregarAcomp(cliente) } catch (x) { toast(x.message, 'erro') }
  }
  alvo.querySelectorAll('[data-conf]').forEach(b => b.onclick = () => enviar('confirmar', ...b.dataset.conf.split('|')))
  alvo.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => enviar('recusar', ...b.dataset.rec.split('|')))
  alvo.querySelectorAll('[data-vinc]').forEach(b => b.onclick = () => {
    const id = alvo.querySelector(`[data-mlb="${CSS.escape(b.dataset.vinc)}"]`)?.value.trim().toUpperCase().replace(/^MLB-?/, 'MLB')
    if (!/^MLB\d{6,12}$/.test(id || '')) return toast('Informe o ID do anúncio no formato MLB123456789.', 'erro')
    enviar('confirmar', b.dataset.vinc, id)
  })
}
