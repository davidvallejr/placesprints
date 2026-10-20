// Documento (HTML → PDF) do diagnóstico de conta para apresentar ao prospect. Mesma identidade visual dos relatórios Place2u.
// Honestidade: fato × hipótese rotulados, impacto sempre como faixa de hipótese com premissa, "—" + motivo onde a API não entrega (nunca estimativa calada).
// 16/10/2026: as MESMAS seções servem a página pública do lead (/d/<token>, modo `publico`) e o relatório do painel (modo interno = + regra das
// prioridades, UTMs e contato). `secoesDiagnosticoComercial` devolve as seções; `renderDiagnosticoComercial` embrulha no documento editorial.
import { FONTES, CSS, esc, brData, capa, secTitulo } from './estilo-editorial.js'
import { editavelConteudo } from './catalogo.js'
import { CAMPOS_FORMULARIO } from './comercial.js'

// texto das regras é escrito para a equipe ("com o cliente", "na tela do cliente"): no documento do prospect fala com ele
const PARA_PROSPECT = [[/\bcom o cliente\b/gi, 'com você'], [/\bpelo cliente\b/gi, 'por você'], [/informar na tela do cliente \(Custos\) ou na reunião de resultados/gi, 'informar na reunião de resultados'], [/\bdos? custos do cliente\b/gi, 'dos seus custos'], [/\bdo cliente\b/gi, 'seu'], [/\bo cliente\b/gi, 'você']]
export const paraProspect = t => PARA_PROSPECT.reduce((x, [rx, to]) => x.replace(rx, to), String(t ?? ''))
const num = v => typeof v === 'number' && Number.isFinite(v)
const brl = v => num(v) ? 'R$ ' + Math.round(v).toLocaleString('pt-BR') : '—'
const brl2 = v => num(v) ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const n1 = (v, d = 1) => num(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: d }) : '—'
const sg = v => num(v) ? (v > 0 ? '+' : '') + n1(v) + '%' : '—'
const urlOk = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : ''
const img = (t, alt) => urlOk(t) ? `<img src="${esc(urlOk(t))}" alt="${esc(alt || '')}" referrerpolicy="no-referrer">` : '<div class="dc-semimg">sem imagem</div>'
const corta = (s, n) => { s = String(s ?? ''); return s.length <= n ? s : s.slice(0, s.lastIndexOf(' ', n) > n * .6 ? s.lastIndexOf(' ', n) : n).trimEnd() + '…' }
const tile = (v, rot, delta) => `<div class="met"><div class="v"><span class="n">${v}</span>${num(delta) ? ` <span class="comp ${delta === 0 ? 'igual' : delta > 0 ? 'bom' : 'ruim'}">${delta > 0 ? '▲' : delta < 0 ? '▼' : '='} ${n1(Math.abs(delta))}%</span>` : ''}</div><div class="r">${esc(rot)}</div></div>`
const dias = d => d > 365 ? '+365 dias' : `${d} dias`
const dpct = (a, b) => num(a) && num(b) && b > 0 ? Math.round(1000 * (a / b - 1)) / 10 : null
const ESTADO = { NOT_COLLECTED: 'não coletado', NOT_AUTHORIZED: 'sem permissão do app', NEEDS_EXTERNAL_DATA: 'depende de informação sua', NOT_SUPPORTED: 'fora desta leitura' }
const MOTIVO_REP = { permissao_do_app: 'o aplicativo não tem permissão para ler a reputação desta conta', indisponivel: 'o Mercado Livre não respondeu na leitura' }
const lnk = i => urlOk(i.permalink) ? `<a href="${esc(urlOk(i.permalink))}" rel="noopener">${esc(corta(i.titulo, 64))}</a>` : esc(corta(i.titulo, 64))

// seções do diagnóstico (array de HTML) — `publico`: linguagem simples, sem regra interna, sem dados de contato
export function secoesDiagnosticoComercial(d, { publico = false } = {}) {
  const { diag, previsao: pv, pareto, full } = d
  const r = diag.resumo, ads = diag.ads
  let n = 0
  const sec = (t, sub) => secTitulo(String(++n).padStart(2, '0'), t, sub)
  const per = `${brData(diag.periodo.de)} a ${brData(diag.periodo.ate)}`, perAnt = `${brData(diag.periodo.anterior.de)} a ${brData(diag.periodo.anterior.ate)}`
  const itens = diag.itens, bench = diag.benchmark?.conv
  const vA = itens.filter(i => i.visOk).reduce((t, i) => t + i.v, 0), vB = itens.filter(i => i.visOk).reduce((t, i) => t + (i.v0 || 0), 0)
  const cobV = itens.filter(i => i.visOk).length
  const uA = itens.reduce((t, i) => t + i.u, 0), uB = itens.reduce((t, i) => t + i.u0, 0)
  const ticket = uA ? r.gmv / uA : null, ticket0 = uB ? r.gmv_anterior / uB : null
  const c = diag.causal
  const porId = new Map(itens.map(i => [i.id, i]))

  const resumo = `${sec('Resumo da conta', `Mercado Livre · últimos 28 dias completos (${per}) contra os 28 anteriores (${perAnt}).`)}
  <div class="met-grade">
    ${tile(brl(r.gmv), 'Faturamento', r.delta_pct)}
    ${tile(n1(r.pedidos ?? uA, 0), 'Pedidos', dpct(r.pedidos ?? uA, uB))}
    ${tile(n1(uA, 0), 'Unidades vendidas', dpct(uA, uB))}
    ${tile(vA ? n1(vA, 0) : '—', `Visitas (${cobV} de ${itens.length} anúncios cobertos)`, dpct(vA, vB))}
    ${tile(bench != null ? n1(bench, 2) + '%' : '—', 'Conversão (só anúncios com visitas lidas)')}
    ${tile(brl2(ticket), 'Ticket médio', dpct(ticket, ticket0))}
  </div>
  <div class="verdict"><span class="eyebrow">Leitura</span><p>${esc(c?.disponivel ? c.leitura : 'Comparação de períodos indisponível: ' + (c?.motivo || 'sem base de comparação') + '.')}</p></div>
  ${d.cobertura?.de && d.cobertura.de > diag.periodo.anterior.de ? `<div class="aviso">△ Histórico de pedidos lido a partir de ${esc(brData(d.cobertura.de))}: o período anterior pode estar incompleto, e a variação, subestimada ou ausente.</div>` : ''}
  ${r.variacao?.motivo ? `<div class="aviso">△ Variação não calculada: ${esc(r.variacao.motivo)} — não é zero.</div>` : ''}`

  const funil = `${sec('O funil: visitas × conversão × ticket', 'Faturamento = visitas × conversão × ticket médio. Onde um desses elos cai, a receita cai — e a ação certa muda com o elo.')}
  <table><thead><tr><th>Elo</th><th style="width:130px">Período atual</th><th style="width:130px">Anterior</th><th style="width:100px">Variação</th></tr></thead><tbody>
    <tr><td><b>Tráfego</b> (visitas)</td><td>${vA ? n1(vA, 0) : '—'}</td><td>${vB ? n1(vB, 0) : '—'}</td><td>${sg(dpct(vA, vB))}</td></tr>
    <tr><td><b>Conversão</b> (visita → pedido)</td><td>${num(c?.deltas?.conversao) || bench != null ? n1(bench, 2) + '%' : '—'}</td><td>—</td><td>${num(c?.deltas?.conversao) ? (c.deltas.conversao > 0 ? '+' : '') + n1(c.deltas.conversao, 2) + ' p.p.' : '—'}</td></tr>
    <tr><td><b>Ticket médio</b> (valor por pedido)</td><td>${brl2(ticket)}</td><td>${brl2(ticket0)}</td><td>${sg(dpct(ticket, ticket0))}</td></tr>
    <tr><td><b>Faturamento</b></td><td>${brl(r.gmv)}</td><td>${brl(r.gmv_anterior)}</td><td>${sg(r.delta_pct)}</td></tr></tbody></table>
  ${c?.ruptura ? `<p style="margin-top:10px"><b>Elo mais afetado:</b> ${c.ruptura === 'visitas' ? 'tráfego' : c.ruptura === 'conversao' ? 'conversão' : 'ticket'}. <span class="mono">${c.causal ? esc(c.causal.classe.toUpperCase()) : ''}</span></p>
  <p style="font-size:12.5px;color:var(--rule)">Onde investigar primeiro: ${(c.investigar || []).slice(0, 5).map(esc).join(' · ')}.</p>` : ''}`

  // curva ABC: top 10 em tabela (MLB · título · receita · unidades · visitas · conversão · estoque) — visitas/conversão só quando cobertas
  const p80 = pareto?.disponivel ? `${sec('Onde está o dinheiro: o 80/20 da conta', pareto.leitura)}
  ${pareto.alerta ? `<div class="aviso">△ ${esc(pareto.alerta)}</div>` : ''}
  <table class="dc-abc"><thead><tr><th>Anúncio</th><th>Receita</th><th>Un.</th><th>Visitas</th><th>Conv.</th><th>Estoque</th></tr></thead><tbody>
  ${pareto.itens.slice(0, 10).map(x => { const i = porId.get(x.id) || x
    return `<tr><td><div class="dc-linha">${img(x.thumb, x.titulo)}<span>${lnk(x)}<div class="mono">${esc(x.id)} · ${n1(x.share_pct)}% da receita${i.curva ? ` · curva ${esc(i.curva)}` : ''}</div></span></div></td><td>${brl(x.receita)}</td><td>${n1(i.u, 0)}</td><td>${i.visOk ? n1(i.v, 0) : '—'}</td><td>${i.visOk && i.conv != null ? n1(i.conv, 2) + '%' : '—'}</td><td>${num(i.estoque) ? n1(i.estoque, 0) : '—'}</td></tr>` }).join('')}</tbody></table>
  <p class="mono" style="margin-top:8px">CURVA ABC: ${r.curvas.A} ANÚNCIO(S) A · ${r.curvas.B} B · ${r.curvas.C} C · «—» = visitas não lidas para o anúncio (não é zero)</p>` : `${sec('Onde está o dinheiro: o 80/20 da conta', 'Sem receita nos anúncios lidos no período.')}<p class="vazio">${esc(pareto?.motivo || 'sem receita no período')}</p>`

  const ima = bench ? itens.filter(i => i.conv != null && i.v >= 150 && i.u >= 3 && i.conv < bench * 0.75).sort((a, b) => b.gap_receita - a.gap_receita).slice(0, 6) : []
  const imas = ima.length ? `${sec('Anúncios que vendem menos do que o tráfego merece', `Têm visita e venda, mas convertem abaixo dos ${n1(bench, 2)}% da própria conta. É o ganho mais barato: não precisa de mais tráfego.`)}
  <table><thead><tr><th>Anúncio</th><th style="width:80px">Visitas</th><th style="width:90px">Conversão</th><th style="width:100px">Da conta</th><th style="width:130px">Receita que cabe</th></tr></thead><tbody>
  ${ima.map(i => `<tr><td><div class="dc-linha">${img(i.thumb, i.titulo)}<span>${lnk(i)}<div class="mono">${esc(i.id)} · ${brl2(i.preco)}${i.fotos != null && editavelConteudo(i) ? ` · ${i.fotos} foto(s)` : ''}${i.frete_gratis ? '' : ' · sem frete grátis'}${i.catalogo_origem === 'terceiros' ? ' · catálogo (conteúdo controlado pelo catálogo)' : ''}</div></span></div></td><td>${n1(i.v, 0)}</td><td>${n1(i.conv, 2)}%</td><td>${n1(bench, 2)}%</td><td>${brl(i.gap_receita)} <span class="mono">hipótese</span></td></tr>`).join('')}</tbody></table>
  <p class="nota-honesta">"Receita que cabe" = visitas × diferença de conversão até a média da própria conta × preço. É teto de referência, não promessa.</p>` : ''

  const adsBloco = ads && (ads.custo > 0 || ads.receita > 0) ? `${sec('Mercado Livre Ads', 'Investimento e retorno dos anúncios patrocinados no período.')}
  <div class="met-grade">
    ${tile(brl(ads.custo), 'Investimento', ads.custo_var_pct)}${tile(brl(ads.receita), 'Receita atribuída', dpct(ads.receita, ads.anterior?.receita))}
    ${tile(num(ads.roas) ? n1(ads.roas, 2) + 'x' : '—', 'ROAS')}${tile(num(ads.acos) ? n1(ads.acos) + '%' : '—', 'ACOS')}${tile(num(ads.tacos) ? n1(ads.tacos) + '%' : '—', 'TACOS (% do faturamento)')}${tile(num(ads.ctr) ? n1(ads.ctr, 2) + '%' : '—', 'CTR')}
  </div>
  ${(() => { const sem = itens.filter(i => i.ads && i.ads.custo >= 30 && i.ads.unidades === 0).slice(0, 4); return sem.length ? `<div class="aviso">△ Gastaram em Ads sem nenhuma venda atribuída no período: ${sem.map(i => `${esc(corta(i.titulo, 46))} (${brl(i.ads.custo)})`).join('; ')}.</div>` : '' })()}
  ${!diag.custos_informados ? '<p class="nota-honesta">Sem os custos da operação (CMV, comissão, impostos, frete, margem) não é possível dizer se o ROAS atual dá lucro. Informá-los libera o ROAS alvo e o limite de desconto.</p>' : ''}`
    : `${sec('Mercado Livre Ads', 'Anúncios patrocinados no período.')}<p class="vazio">${ads?.motivo ? `Ads não lidos: ${esc(ads.motivo)} — não é «sem Ads».` : 'Nenhum investimento nem receita de Ads lidos no período (ou a conta não usa Ads).'}</p>`

  const risco = itens.filter(i => i.cobertura != null && i.cobertura < 10 && i.curva !== 'C' && i.u >= 3).sort((a, b) => a.cobertura - b.cobertura).slice(0, 5)
  const excesso = itens.filter(i => i.cobertura != null && i.cobertura > 90 && i.estoque >= 20).sort((a, b) => b.cobertura - a.cobertura).slice(0, 3)
  const estoque = `${sec('Estoque, rupturas e Full', 'Cobertura de estoque dos anúncios que sustentam a receita (estoque ÷ venda por dia).')}
  ${full?.tem_full ? `<p>${esc(full.leitura)}</p>` : ''}
  ${risco.length ? `<div class="aviso">△ Campeões com cobertura curta (menos de 10 dias): ${risco.map(i => `${esc(corta(i.titulo, 48))} (${i.cobertura} dia(s), ${n1(i.estoque, 0)} un.)`).join('; ')}. Ruptura derruba o ranking além da venda perdida.</div>` : '<p>Nenhum anúncio de curva A/B com estoque para menos de 10 dias na leitura.</p>'}
  ${excesso.length ? `<p style="font-size:13px">Capital parado (mais de 90 dias de cobertura): ${excesso.map(i => `${esc(corta(i.titulo, 48))} (${dias(i.cobertura)})`).join('; ')}.</p>` : ''}`

  const rep = d.reputacao
  const reputacao = `${sec('Reputação e nível', 'Termômetro da conta no Mercado Livre, lido ao vivo com a sua autorização.')}
  ${rep?.lida ? `<div class="met-grade">${tile(esc(rep.nivel || '—'), 'Nível')}${tile(esc(rep.medalha || 'sem medalha'), 'Medalha')}${tile(num(rep.taxa_claims) ? n1(rep.taxa_claims, 2) + '%' : '—', 'Reclamações')}${tile(num(rep.taxa_atraso) ? n1(rep.taxa_atraso, 2) + '%' : '—', 'Atraso no despacho')}${tile(num(rep.taxa_cancel) ? n1(rep.taxa_cancel, 2) + '%' : '—', 'Cancelamentos')}${tile(num(rep.vendas_periodo) ? n1(rep.vendas_periodo, 0) : '—', `Vendas concluídas${rep.periodo ? ` (${esc(rep.periodo)})` : ''}`)}</div>`
    : `<p class="vazio">Reputação não lida: ${esc(rep?.motivo ? (MOTIVO_REP[rep.motivo] || rep.motivo) : 'a leitura ainda não foi feita (acontece no fim da coleta dos dados)')} — não é zero.</p>`}`

  const ops = d.oportunidades
  const opHtml = (a, k) => { const dd = a.dados, pr = a.previsao, cn = pr?.cenarios
    return `<div class="entrega dc-op"><div class="dc-op-n">${k + 1}</div><div class="dc-op-corpo">
      <h3>${esc(a.titulo)}</h3>
      <div class="lm"><span class="tag ${dd.evidencia_tipo === 'fato' ? 't-medido' : 't-hipotese'}">${dd.evidencia_tipo === 'fato' ? 'Fato observado' : 'Hipótese'}</span><span>${esc(dd.dimensao || '')}</span>${!publico && a.regra ? `<span class="mono">regra ${esc(a.regra)}</span>` : ''}${dd.item?.permalink ? `<a href="${esc(urlOk(dd.item.permalink))}" rel="noopener">abrir o anúncio como comprador ↗</a>` : ''}</div>
      <p><b>Por quê:</b> ${esc(dd.evidencia)}</p>
      ${dd.hipotese ? `<p style="font-size:12.5px;color:var(--rule)"><b>Hipótese:</b> ${esc(dd.hipotese)}</p>` : ''}
      <p><b>Como:</b> ${(dd.como || []).slice(0, publico ? 2 : 3).map(esc).join(' → ')}</p>
      ${cn ? `<p class="mono">${pr.tipo === 'risco_evitado' ? 'RISCO EVITADO' : 'IMPACTO ESTIMADO'} EM ${pr.horizonte_dias} DIAS: ${brl(cn.conservador.receita)} A ${brl(cn.otimista.receita)} (BASE ${brl(cn.base.receita)}) · HIPÓTESE</p>${publico ? '' : `<p style="font-size:11.5px;color:var(--rule)">Premissas: ${(pr.premissas || []).map(esc).join('; ')}.</p>`}` : ''}
      ${publico ? '' : `<p class="mono">META: ${esc(dd.meta || '')}</p>`}</div></div>` }
  const oportunidades = `${sec(publico ? 'Os 5 problemas prioritários' : 'Oportunidades priorizadas', publico ? 'O que mais está custando venda hoje, na ordem em que vale atacar. Cada ponto traz o dado que o sustenta; o ganho é estimativa com premissa, não promessa.' : 'Cada uma com o dado que a sustenta (fato) e o impacto estimado (hipótese, com premissa declarada). A ordem considera impacto, gravidade, evidência e facilidade.')}
  ${ops.length ? ops.slice(0, publico ? 5 : ops.length).map(opHtml).join('') : '<p class="vazio">Nenhuma oportunidade acima dos limites de relevância nesta leitura — a conta não apresenta, nos dados lidos, ponto de ação de alto impacto.</p>'}
  ${pv && pv.n_acoes ? `<div class="verdict"><span class="eyebrow">Se o plano fosse executado</span><p>Faturamento de 28 dias hoje: <b>${brl(pv.baseline)}</b> (velocidade atual). Faixa estimada com as ações acima: <b>${brl(pv.cenarios.conservador.faturamento)} a ${brl(pv.cenarios.otimista.faturamento)}</b> (base ${brl(pv.cenarios.base.faturamento)}, ${sg(pv.cenarios.base.uplift_pct)}). ${pv.receita_em_risco_evitada ? `Mais ${brl(pv.receita_em_risco_evitada)} de receita em risco evitada.` : ''} Estimativa por hipótese, com desconto por ações no mesmo anúncio e teto de plausibilidade — não é promessa de resultado.</p></div>` : ''}`

  // o que a API/coleta NÃO entregou — declarado com motivo (NOT_COLLECTED etc.), nunca zero
  const nc = d.nao_coletado || []
  const limites = `${sec('O que não conseguimos ver — e como a Place2u trabalha', 'Transparência sobre os limites desta leitura e os próximos passos.')}
  ${nc.length ? `<table class="dc-nc"><thead><tr><th>Dado</th><th style="width:150px">Estado</th><th>Motivo</th></tr></thead><tbody>${nc.map(x => `<tr><td>${esc(x.analise)}</td><td><span class="mono">${esc(x.estado)}</span> · ${ESTADO[x.estado] || ''}</td><td>${esc(paraProspect(x.motivo))}</td></tr>`).join('')}</tbody></table>` : ''}
  <ul class="dc-ul">${diag.pendencias.map(p => `<li><b>${esc(p.item)}.</b> ${esc(paraProspect(p.muda))}. <span class="mono">${esc(paraProspect(p.como))}</span></li>`).join('')}</ul>
  <div class="verdict"><span class="eyebrow">Próximos passos</span><p>1) Validar este diagnóstico com você e definir a meta de resultado (com prazo). 2) Informar custos para liberar ROAS alvo e margem por anúncio. 3) Executar as 3 primeiras oportunidades em ordem, registrando o antes e o depois de cada uma. 4) Medir em 14 dias e ajustar o plano com o que funcionou.</p></div>
  <p class="nota-honesta">Leitura feita com a autorização do titular da conta, pela API oficial do Mercado Livre, <b>somente leitura</b>: nada foi alterado na conta. Períodos completos e equivalentes. Nenhuma senha passou por esta ferramenta.</p>`

  // só o painel: contato, origem e UTMs do lead (nunca na página pública nem no dataLayer)
  const it = d.interno
  const interno = !publico && it ? `${sec('Dados do lead (interno)', 'Contato, origem e campanha — não vai ao prospect.')}
  <table><tbody><tr><td><b>Contato</b></td><td>${esc(d.prospecto.nome)} · ${esc(it.email || 'sem e-mail')} · ${esc(it.telefone || 'sem telefone')}</td></tr>
  <tr><td><b>Origem</b></td><td>${it.origem === 'publico' ? 'site (formulário público)' : 'closer'} · cadastro em ${esc(brData(it.criado_em))}${it.consentimento_versao ? ` · consentimento ${esc(it.consentimento_versao)}` : ''}</td></tr>
  <tr><td><b>Campanha (UTM)</b></td><td>${Object.keys(it.utm || {}).length ? Object.entries(it.utm).map(([k, v]) => `<span class="mono">${esc(k)}=${esc(v)}</span>`).join(' · ') : 'sem UTM registrada'}</td></tr>
  ${Object.entries(CAMPOS_FORMULARIO).map(([k, c]) => `<tr><td><b>${esc(c.rotulo)}</b></td><td>${it.formulario?.[k] ? esc([].concat(it.formulario[k]).join(' · ')) : 'não informado'}</td></tr>`).join('')}</tbody></table>` : ''

  return [resumo, funil, p80, imas, adsBloco, estoque, reputacao, oportunidades, limites, interno].filter(Boolean)
}

export const CSS_DC = `
  .dc-linha{display:flex;gap:10px;align-items:center}
  .dc-linha img,.dc-semimg{width:54px;height:54px;object-fit:contain;flex:none;background:#fff} .dc-semimg{display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--cinza)}
  .dc-abc td:nth-child(n+2),.dc-abc th:nth-child(n+2){text-align:right;white-space:nowrap}
  .dc-op{display:grid;grid-template-columns:34px 1fr;gap:14px;border-top-color:var(--accent)} .dc-op-n{font-family:'Playfair Display',serif;font-size:30px;color:var(--accent);line-height:1}
  .dc-op h3{font-size:16px} .dc-op p{font-size:12.5px;margin:5px 0}
  .dc-ul{margin:6px 0 14px 18px;font-size:12.5px} .dc-ul li{margin:5px 0}
  .t-medido{background:var(--sage);color:var(--paper)} .t-hipotese{background:var(--cinza);color:#fff}
  .nota-honesta{font-size:12px;color:var(--rule);background:var(--paper-deep);padding:9px 14px;margin:12px 0;border-left:3px solid var(--gold)}
  @page{size:A4;margin:10mm} .dc-op,.met,tr,.verdict,.sec-titulo{break-inside:avoid;page-break-inside:avoid} .sec-titulo{break-after:avoid}
  @media print{.t-medido,.t-hipotese{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`

export function renderDiagnosticoComercial(d) {
  const r = d.diag.resumo, empresa = d.prospecto.empresa
  const per = `${brData(d.diag.periodo.de)} a ${brData(d.diag.periodo.ate)}`
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagnóstico da conta — ${esc(empresa)}</title>
${FONTES}
<style>${CSS}${CSS_DC}</style></head>
<body><div class="pagina">
${capa({ documento: 'Diagnóstico de conta', titulo: empresa, subtitulo: `Mercado Livre · ${r.anuncios_ativos} anúncios com venda ou Ads · ${per}`,
    meta: [`Preparado em <b>${esc(brData(d.hoje))}</b>`, `Para <b>${esc(d.prospecto.nome)}</b>`, 'Fonte <b>API oficial do Mercado Livre (leitura)</b>'] })}
${secoesDiagnosticoComercial(d).map(x => `<section>${x}</section>`).join('\n')}
<footer><span>Place2u · Performance Estratégica em Marketplaces</span><span>Diagnóstico · ${esc(empresa)}</span><span>Leitura autorizada pelo titular</span></footer>
</div></body></html>`
}
