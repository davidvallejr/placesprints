// Documento do PLANO DA CONTA POR ANÚNCIO (para download em PDF/HTML). Cobre o roteiro do diagnóstico:
// ímã, promoção, produto/CTR, catálogo (Meli), Full, sazonalidade, urgência oculta, Ads por curva e ROAS alvo,
// plano por anúncio, previsão por hipótese e a metodologia. Tudo o que é hipótese/pendente está rotulado.
import { FONTES, CSS, esc, brData, capa, secTitulo, rodape } from './estilo-editorial.js'
import { algoritmo, pctTxt } from './diagnostico-conta.js'
import { editavelConteudo } from './catalogo.js'
import { TEXTO_CATALOGO } from './catalogo-cfg.js'

const brl = n => n == null ? '—' : 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const pct = n => n == null ? '—' : pctTxt(n) + '%'            // pctTxt: nunca "0%" para valor ≠ 0 (TACOS 0,00036%, conversão 0,0036%); zero medido segue "0%"
const sg = n => n == null ? '—' : (n >= 0 ? '+' : '') + pct(n)
const chip = (t, tom = '') => `<span class="pl-chip ${tom}">${esc(t)}</span>`
const lista = it => it?.length ? `<ul class="pl-ul">${it.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="vazio">—</p>'
const inativo = txt => `<div class="pl-inativo">${txt}</div>`
const curto = (t, n = 56) => esc(String(t || '').slice(0, n))
// selo de catálogo no PDF: "Catálogo" (terceiros: conteúdo controlado pelo catálogo do ML) ou "Catálogo próprio" (conteúdo só por sugestão de correção)
const seloCat = o => o === 'terceiros' ? chip('Catálogo', 'cinza') : o === 'proprio' ? chip('Catálogo próprio', 'cinza') : ''
const elo = i => i.permalink ? `<a href="${esc(i.permalink)}">${curto(i.titulo)}</a><div class="pl-sc">${esc(i.id)} ${seloCat(i.catalogo_origem)}</div>` : `${curto(i.titulo)} ${seloCat(i.catalogo_origem)}`

export function nivelCobertura(d) {
  if (d == null) return ['sem giro', 'cinza']
  return d <= 3 ? ['RUPTURA IMINENTE', 'blood'] : d < 10 ? ['CRÍTICO', 'blood'] : d < 21 ? ['ATENÇÃO', 'gold'] : d <= 90 ? ['SAUDÁVEL', 'ok'] : ['EXCESSO', 'cinza']
}
const ESTAGIO_ADS = i => {
  if (!i.ads || !i.ads.custo) return null
  if (i.cobertura != null && i.cobertura < 10) return 'DEFESA (estoque crítico: não escalar)'
  if (i.ads.roas != null && i.ads.roas >= 6 && i.curva !== 'C') return 'ESCALA/CRESCIMENTO'
  if (i.conv != null && i.conv < 8) return 'VALIDAÇÃO (corrigir antes)'
  return 'VISIBILIDADE'
}

export function renderPlanoConta({ diag, acoes, previsao, custos = null, omitidas = {} }) {
  const r = diag.resumo, ads = diag.ads, eco = diag.economia, p = previsao
  const ativas = acoes.filter(a => !['descartada', 'obsoleta'].includes(a.status))
  const semana = ativas.filter(a => a.dados.fila === 'esta_semana').slice(0, algoritmo.foco.max_acoes_por_cliente_semana)
  const p0 = ativas.filter(a => a.dados.prioridade?.p === 'P0').length
  const itens = diag.itens
  const ima = itens.filter(i => i.conv != null && diag.benchmark && i.v >= algoritmo.foco.min_visitas_item && i.conv < diag.benchmark.conv * (1 - algoritmo.limiares.ima_gap_conversao_pct / 100))
  const catalogo = itens.filter(i => i.catalogo)
  const emAds = itens.filter(i => i.ads?.custo > 0).sort((a, b) => b.ads.custo - a.ads.custo)

  const tabelaAcoes = lista => lista.length ? `<table class="pl-tab"><thead><tr><th>Prio</th><th>O quê e onde</th><th>Por quê (evidência)</th><th>Impacto esperado</th><th>Como</th><th>Métrica</th><th>Quem · até quando</th></tr></thead><tbody>
${lista.map(a => { const d = a.dados, pv = a.previsao, c = pv?.cenarios; return `<tr>
  <td><b>${esc(d.prioridade?.p || '')}</b><div class="pl-sc">${a.score}/100</div><div class="pl-sc">${a.dados.fila === 'esta_semana' ? 'esta semana' : 'fila'}</div></td>
  <td><b>${esc(a.titulo)}</b>${d.item ? `<div class="pl-sc"><a href="${esc(d.item.permalink)}">abrir como comprador</a> · curva ${esc(d.item.classe || '')} ${seloCat(d.item.catalogo_origem)}</div>${TEXTO_CATALOGO[d.item.catalogo_origem] ? `<div class="pl-sc">${esc(TEXTO_CATALOGO[d.item.catalogo_origem])}</div>` : ''}` : ''}</td>
  <td>${chip(d.evidencia_tipo === 'fato' ? 'Fato observado' : d.evidencia_tipo === 'hipotese' ? 'Hipótese' : 'Pendente', d.evidencia_tipo === 'fato' ? 'ok' : 'gold')}<br>${esc(d.evidencia)}${d.hipotese ? `<div class="pl-sc"><b>Hipótese:</b> ${esc(d.hipotese)}</div>` : ''}</td>
  <td>${pv?.tipo === 'pendencia' ? '<span class="pl-sc">pré-requisito</span>' : `${pv?.tipo === 'risco_evitado' ? 'risco evitado' : 'ganho'} em ${pv?.horizonte_dias}d:<br>${brl(c?.conservador.receita)} · <b>${brl(c?.base.receita)}</b> · ${brl(c?.otimista.receita)}<div class="pl-sc">prob. ${Math.round((pv?.p_sucesso || 0) * 100)}% → esperado ${brl(pv?.valor_esperado)}</div>`}</td>
  <td><ol class="pl-ol">${(d.como || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></td>
  <td>${esc(d.indicador_inicial)}<div class="pl-sc">meta: ${esc(d.meta)}</div></td>
  <td>${esc(a.responsavel || 'responsável a definir')}<div class="pl-sc">${esc(brData(a.prazo))}</div></td></tr>` }).join('')}</tbody></table>` : '<p class="vazio">Nenhuma ação.</p>'

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plano da conta — ${esc(diag.cliente)}</title>
${FONTES}
<style>${CSS}
  .pl-chip{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:9.5px;padding:1px 7px;border:1px solid var(--rule);border-radius:2px;color:var(--rule);white-space:nowrap}
  .pl-chip.ok{border-color:var(--sage);color:var(--sage)} .pl-chip.gold{border-color:var(--gold);color:var(--gold)} .pl-chip.cinza{border-color:var(--cinza);color:var(--cinza)} .pl-chip.blood{border-color:var(--blood);color:var(--blood)}
  .pl-tab{font-size:10.5px;width:100%} .pl-tab td,.pl-tab th{vertical-align:top;padding:7px 6px}
  .pl-sc{font-size:9.5px;color:var(--rule)} .pl-ul{margin:4px 0 0 18px;padding:0;font-size:12.5px} .pl-ul li{margin:2px 0}
  .pl-ol{margin:0 0 0 14px;padding:0;font-size:10px} .pl-ol li{margin:1px 0}
  .pl-inativo{border-left:3px solid var(--gold);background:#fffdfa;padding:10px 14px;font-size:12px;margin:10px 0}
  .pl-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:14px 0}
  .pl-kpi{border:1px solid rgba(42,37,32,.14);border-top:3px solid var(--accent);background:#fffdfa;padding:10px 12px}
  .pl-kpi b{display:block;font-size:20px;font-family:'Playfair Display',serif} .pl-kpi span{font-size:10px;color:var(--rule)}
  .pl-f{font-family:'JetBrains Mono',monospace;font-size:11px;background:#fffdfa;border:1px solid rgba(42,37,32,.14);padding:8px 12px;margin:6px 0;white-space:pre-wrap}
  .pl-h{font-size:13px;margin:18px 0 6px} section{margin-bottom:26px} a{color:inherit}
  @media(max-width:720px){.pl-kpis{grid-template-columns:repeat(2,1fr)}}
  @media print{.pl-tab{font-size:8.5px} section{page-break-inside:auto}}
</style></head><body><div class="pagina">

${capa({ documento: 'Plano da conta por anúncio', titulo: diag.cliente, subtitulo: `Mercado Livre · ${diag.resumo.anuncios_ativos} anúncios com venda ou Ads`,
    meta: [`Período <b>${esc(brData(diag.periodo.de))} a ${esc(brData(diag.periodo.ate))}</b>`, `Gerado em <b>${esc(brData(diag.hoje))}</b>`, `Algoritmo <b>v${esc(diag.algoritmo_versao)}</b>`] })}

<section>
  ${secTitulo('01', 'Resumo executivo', 'O que a conta fez, para onde vai e o que o plano pede.')}
  <div class="verdict"><span class="eyebrow">Leitura</span><p>${esc(`A conta faturou ${brl(r.gmv)} em 28 dias (${sg(r.delta_pct)} sobre o período anterior), com conversão de ${pct(r.conversao_conta)} nos anúncios curva A/B e Ads em ${brl(ads.custo)} (ROAS ${ads.roas ?? '—'}, ACOS ${pct(ads.acos)}, TACOS ${pct(ads.tacos)}). ${p ? `Sem mudar nada, a velocidade atual projeta ${brl(p.baseline)} nos próximos 28 dias; com o plano, a estimativa base é ${brl(p.cenarios.base.faturamento)} (${sg(p.cenarios.base.uplift_pct)}), entre ${brl(p.cenarios.conservador.faturamento)} e ${brl(p.cenarios.otimista.faturamento)}. Isso é previsão por hipótese, não promessa.` : ''} O plano tem ${ativas.length} ação(ões) priorizadas; ${p0} é P0 (agir agora). As ${semana.length} da semana estão destacadas abaixo.`)}</p></div>
  <div class="pl-kpis">
    <div class="pl-kpi"><b>${brl(r.gmv)}</b><span>GMV 28 dias · ${sg(r.delta_pct)}</span></div>
    <div class="pl-kpi"><b>${pct(r.conversao_conta)}</b><span>conversão de referência da conta</span></div>
    <div class="pl-kpi"><b>${ads.roas ?? '—'}</b><span>ROAS · ACOS ${pct(ads.acos)} · TACOS ${pct(ads.tacos)}</span></div>
    <div class="pl-kpi"><b>${ativas.length}</b><span>ações · ${p0} P0</span></div>
    <div class="pl-kpi"><b>${p ? sg(p.cenarios.base.uplift_pct) : '—'}</b><span>uplift base estimado (hipótese)</span></div>
  </div>
  <p class="pl-h"><b>As ações desta semana</b></p>
  ${tabelaAcoes(semana)}
</section>

<section>
  ${secTitulo('02', 'Fontes, qualidade dos dados e pendências', 'Cada número vem da API oficial do Mercado Livre das contas conectadas. O que a API não entrega aparece como pendência declarada.')}
  <table><thead><tr><th>Dado</th><th>Situação</th><th>Por que importa</th><th>Como resolver</th></tr></thead><tbody>
    <tr><td>Pedidos, visitas, preço, estoque, fotos, frete, catálogo</td><td>${chip('Disponível', 'ok')}</td><td>base de todo o diagnóstico</td><td>coletado em ${esc(brData(diag.hoje))}</td></tr>
    <tr><td>Ads por anúncio (impressões, cliques, custo, ROAS)</td><td>${chip('Disponível', 'ok')}</td><td>estratégia de Ads por curva</td><td>só para anúncios que anunciam</td></tr>
    ${diag.pendencias.map(x => `<tr><td>${esc(x.item)}</td><td>${chip(x.estado, 'cinza')}</td><td>${esc(x.muda)}</td><td>${esc(x.como)}</td></tr>`).join('')}
  </tbody></table>
</section>

<section>
  ${secTitulo('03', 'Diagnóstico da conta', 'Faturamento = visitas × conversão × ticket. O diagnóstico procura o elo que se rompeu.')}
  <div class="verdict"><span class="eyebrow">Cadeia causal</span><p>${esc(diag.causal?.leitura || 'Sem base para o diagnóstico causal.')} ${diag.causal?.deltas ? esc(`Faturamento ${sg(diag.causal.deltas.faturamento)} · visitas ${sg(diag.causal.deltas.visitas)} · conversão ${diag.causal.deltas.conversao == null ? '—' : (diag.causal.deltas.conversao >= 0 ? '+' : '') + diag.causal.deltas.conversao + ' p.p.'} · ticket ${sg(diag.causal.deltas.ticket)}.`) : ''} ${chip('CAUSA PROVÁVEL, nunca comprovada', 'gold')}</p></div>
  <p class="pl-h"><b>Curva ABC e potencial</b> — A: até 80% do GMV · B: até 95% · C: o resto. Potencial 1 = ainda cabe receita no próprio anúncio (gap de conversão ou crescimento); 2 = estabilizado.</p>
  <table><thead><tr><th>Anúncio</th><th>Classe</th><th>GMV 28d</th><th>% do GMV</th><th>Visitas</th><th>Conversão</th><th>vs período ant.</th><th>Gap de receita (potencial estimado)</th></tr></thead><tbody>
  ${itens.filter(i => i.curva !== 'C').slice(0, 20).map(i => `<tr><td>${elo(i)}</td><td><b>${esc(i.classe)}</b></td><td>${brl(i.r)}</td><td>${pct(i.share_pct)}</td><td>${i.v ?? '—'}</td><td>${i.conv == null ? (i.conv_invalida ? 'visitas em outro anúncio' : '—') : pct(i.conv)}</td><td>${i.r0 ? sg((i.r / i.r0 - 1) * 100) : 'novo'}</td><td>${i.gap_receita ? brl(i.gap_receita) : '—'}</td></tr>`).join('')}
  </tbody></table>
  <p class="pl-sc">Anúncios curva C (${r.curvas.C}) ficam fora do detalhe: juntos pesam pouco e só entram no plano quando há ruptura, Ads ou catálogo relevante.</p>
</section>

<section>
  ${secTitulo('04', 'Otimização com estratégia ímã', 'Quais anúncios vendem, mas convertem abaixo do benchmark da própria conta: quebrar objeções ou avaliar a oferta.')}
  ${diag.benchmark ? `<p>Referência: <b>${pct(diag.benchmark.conv)}</b> — ${esc(diag.benchmark.regra)}. Entram no ímã os anúncios com ≥ ${algoritmo.foco.min_visitas_item} visitas e conversão ≥ ${algoritmo.limiares.ima_gap_conversao_pct}% abaixo da referência.</p>` : '<p class="vazio">Sem benchmark (poucos anúncios com visitas).</p>'}
  ${ima.length ? `<table><thead><tr><th>Anúncio</th><th>Visitas</th><th>Conversão</th><th>Gap</th><th>Problema provável</th></tr></thead><tbody>${ima.map(i => { const gap = diag.benchmark.conv - i.conv; return `<tr><td>${elo(i)}</td><td>${i.v}</td><td>${pct(i.conv)}</td><td>${pct(gap)} p.p.</td><td>${esc(!i.frete_gratis ? 'PRECISA MELHORAR OFERTA (frete)' : i.catalogo_origem === 'terceiros' ? TEXTO_CATALOGO.terceiros : i.fotos < 5 ? `PRECISA CONVERTER (conteúdo${i.catalogo_origem === 'proprio' ? ': só por sugestão de correção' : ''})` : 'PRECISA CONVERTER (sem sinal objetivo — testar)')}</td></tr>` }).join('')}</tbody></table>` : '<p class="vazio">Nenhum anúncio relevante abaixo do benchmark neste período.</p>'}
</section>

<section>
  ${secTitulo('05', 'Promoções', 'Campanhas de desconto que trazem visibilidade — sempre dentro da margem.')}
  ${eco ? `<p>Desconto máximo que preserva a margem desejada: calculado por anúncio a partir dos custos informados (margem pré-Ads ${pct(eco.margem_pre_ads_pct)}).</p>` : inativo('<b>Sem custos informados.</b> Não recomendamos desconto sem margem: com CMV, comissão, impostos, frete e margem desejada o sistema calcula o desconto máximo e recusa o que corroa a margem. A gestão de campanhas de rebate (elegíveis, MC, cobertura) fica no módulo Promoções do cliente.')}
  ${lista(ativas.filter(a => a.regra === 'anuncio_promocao_giro').map(a => a.titulo))}
</section>

<section>
  ${secTitulo('06', 'Produto: impressões, cliques e como aumentar', 'A API entrega impressões e CTR apenas dos anúncios em Ads; o orgânico não está disponível.')}
  <p>CTR de Ads da conta: <b>${pct(ads.ctr)}</b> (${ads.clicks} cliques em ${ads.prints.toLocaleString('pt-BR')} impressões). ${chip('CTR/impressões orgânicos: NOT_AVAILABLE', 'cinza')}</p>
  ${emAds.length ? `<table><thead><tr><th>Anúncio</th><th>Impressões</th><th>Cliques</th><th>CTR</th><th>vs conta</th><th>O que fazer</th></tr></thead><tbody>${emAds.slice(0, 12).map(i => { const rel = ads.ctr ? i.ads.ctr / ads.ctr : null; return `<tr><td>${elo(i)}</td><td>${i.ads.prints.toLocaleString('pt-BR')}</td><td>${i.ads.clicks}</td><td>${pct(i.ads.ctr)}</td><td>${rel == null ? '—' : '×' + rel.toFixed(2)}</td><td>${esc(!editavelConteudo(i) ? TEXTO_CATALOGO.terceiros : rel != null && rel < algoritmo.limiares.ads_ctr_vs_conta_baixo ? `CTR baixo para a conta: revisar imagem de capa e título (HIPÓTESE de atração)${i.catalogo_origem === 'proprio' ? ' — só por sugestão de correção' : ''}` : i.fotos != null && i.fotos < 5 ? `completar fotos${i.catalogo_origem === 'proprio' ? ' (só por sugestão de correção)' : ''}` : 'manter e monitorar')}</td></tr>` }).join('')}</tbody></table>` : '<p class="vazio">Nenhum anúncio com Ads no período.</p>'}
</section>

<section>
  ${secTitulo('07', 'Catálogo e oportunidades (Mercado Livre)', 'Caixa de compra, preço para ganhar e oportunidades de catálogo.')}
  ${catalogo.length ? `<table><thead><tr><th>Anúncio</th><th>GMV 28d</th><th>Caixa de compra</th><th>Preço × preço para ganhar</th></tr></thead><tbody>${catalogo.slice(0, 15).map(i => `<tr><td>${elo(i)}</td><td>${brl(i.r)}</td><td>${i.buy_box == null ? 'não confirmada' : i.buy_box ? chip('ganha', 'ok') : chip('perdida', 'blood')}</td><td>${i.ptw?.preco_para_ganhar != null ? `R$ ${i.preco?.toFixed(2)} × R$ ${i.ptw.preco_para_ganhar.toFixed(2)}` : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhum anúncio de catálogo com venda no período.</p>'}
  <p class="pl-sc">Oportunidades de catálogo sem participação e concorrentes observáveis: ${chip('NOT_SUPPORTED', 'cinza')} — a busca pública do Mercado Livre não é liberada para integrações.</p>
</section>

<section>
  ${secTitulo('08', 'Planejamento logístico e Full', 'Quantidade sugerida pela demanda projetada, não só pela venda passada. Nenhum estoque é movimentado pelo sistema.')}
  <div class="pl-f">Cobertura (dias)  = estoque disponível ÷ vendas por dia
Quantidade       = vendas/dia × (1 + crescimento observado) × (cobertura planejada + segurança) − estoque
Crescimento só entra se OBSERVADO (teto ${algoritmo.limiares.crescimento_max_pct}%); cobertura planejada ${algoritmo.limiares.full_cobertura_planejada_dias} d + segurança ${algoritmo.limiares.estoque_seguranca_dias} d.</div>
  <table><thead><tr><th>Anúncio</th><th>Logística</th><th>Estoque</th><th>Vendas/dia</th><th>Cobertura</th><th>Nível</th><th>Enviar (conserv. / base / crescim.)</th></tr></thead><tbody>
  ${itens.filter(i => i.curva !== 'C').slice(0, 15).map(i => { const [niv, tom] = nivelCobertura(i.cobertura); const q = i.vel_dia > 0 && i.estoque != null ? (() => { const t = i.u0 > 0 ? Math.max(0, Math.min(algoritmo.limiares.crescimento_max_pct, (i.u / i.u0 - 1) * 100)) : 0; const f = g => Math.max(0, Math.ceil(i.vel_dia * (1 + g / 100) * (algoritmo.limiares.full_cobertura_planejada_dias + algoritmo.limiares.estoque_seguranca_dias) - i.estoque)); return `${f(0)} / ${f(t / 2)} / ${f(t)}` })() : '—'; return `<tr><td>${elo(i)}</td><td>${esc(i.logistica || 'não informado')}</td><td>${i.estoque ?? '—'}</td><td>${i.vel_dia}</td><td>${i.cobertura == null ? '—' : i.cobertura + ' d'}</td><td>${chip(niv, tom)}</td><td>${q}</td></tr>` }).join('')}
  </tbody></table>
</section>

<section>
  ${secTitulo('09', 'Sazonalidade e próxima janela comercial', 'Data de consumo → reposição → campanha → conteúdo. Hipótese do calendário: a conta ainda não tem 12 meses para provar a sazonalidade do produto.')}
  <table><thead><tr><th>Evento</th><th>Em</th><th>Produtos relacionados</th><th>Conteúdo até</th><th>Reposição até</th><th>Campanha no ar até</th><th>Estágio</th></tr></thead><tbody>
  ${diag.janelas.map(j => `<tr><td><b>${esc(j.evento)}</b><div class="pl-sc">${esc(brData(j.data))} · ${esc(j.acao)}</div></td><td>${j.dias} d</td><td>${j.n_produtos}</td><td>${esc(brData(j.limites.conteudo))}</td><td>${esc(brData(j.limites.reposicao))}</td><td>${esc(brData(j.limites.campanha))}</td><td>${chip(j.estagio, j.estagio === 'preparar agora' ? 'blood' : 'cinza')}</td></tr>`).join('')}
  </tbody></table>
</section>

<section>
  ${secTitulo('10', 'Urgência oculta', 'Outros usos, públicos, kits e termos de busca. Tudo aqui é HIPÓTESE ESTRATÉGICA; nenhuma característica que o produto não tenha.')}
  ${tabelaAcoes(ativas.filter(a => a.regra === 'anuncio_urgencia_oculta'))}
</section>

<section>
  ${secTitulo('11', 'Estratégia de Ads por curva e ROAS alvo', 'Antes de anunciar: qual é o objetivo deste anúncio? Estágios: descoberta, visibilidade, validação, crescimento, escala, defesa, recuperação, rentabilidade.')}
  <p>Conta: investimento <b>${brl(ads.custo)}</b> (${sg(ads.custo_var_pct)} vs período anterior) · receita atribuída <b>${brl(ads.receita)}</b> · ROAS <b>${ads.roas ?? '—'}</b> (anterior ${ads.anterior.roas ?? '—'}) · ACOS ${pct(ads.acos)} · TACOS ${pct(ads.tacos)}. ${ads.anterior.roas && ads.roas && ads.roas < ads.anterior.roas ? `O ROAS caiu ${pct((1 - ads.roas / ads.anterior.roas) * 100)} enquanto o investimento subiu: sinal de retorno marginal decrescente (HIPÓTESE).` : ''}</p>
  <div class="pl-f">Margem pré-Ads   = receita − custos variáveis sem Ads
ACOS equilíbrio  = margem pré-Ads        ROAS equilíbrio = 1 ÷ ACOS equilíbrio
ACOS máximo      = margem pré-Ads − margem líquida desejada      ROAS alvo = 1 ÷ ACOS máximo</div>
  ${eco ? `<p><b>Com os custos informados:</b> margem pré-Ads ${pct(eco.margem_pre_ads_pct)} · ROAS de equilíbrio <b>${eco.roas_breakeven}</b> · ROAS alvo <b>${eco.roas_alvo ?? 'inviável'}</b> (margem desejada ${pct(eco.margem_desejada_pct)}). ${esc(eco.nota)}</p>`
    : inativo(`<b>ROAS alvo: sem custos informados.</b> Não usamos ROAS arbitrário. Cenários de equilíbrio por margem pré-Ads: ${[15, 20, 25, 30].map(m => `${m}% → ROAS ${(100 / m).toFixed(2)}`).join(' · ')}. O ROAS da conta (${ads.roas}) só serve de referência relativa entre anúncios.`)}
  ${emAds.length ? `<table><thead><tr><th>Anúncio</th><th>Classe</th><th>Custo 28d</th><th>Receita atribuída</th><th>ROAS</th><th>ACOS</th><th>Objetivo / estágio sugerido</th></tr></thead><tbody>${emAds.slice(0, 15).map(i => `<tr><td>${elo(i)}</td><td>${esc(i.classe)}</td><td>${brl(i.ads.custo)}</td><td>${brl(i.ads.receita)}</td><td>${i.ads.roas ?? '—'}</td><td>${pct(i.ads.acos)}</td><td>${esc(ESTAGIO_ADS(i) || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
  <p class="pl-sc">Atribuição de Ads não prova venda incremental; não pausar por um único dia ruim nem escalar por uma única venda. Nenhum orçamento ou lance é alterado por este sistema.</p>
</section>

<section>
  ${secTitulo('12', 'Plano de ação por anúncio', 'Cada ação responde: o que, onde, por quê, impacto, como, qual métrica e qual resultado esperado. As 5 primeiras são o foco da semana; o restante fica na fila.')}
  ${tabelaAcoes(ativas)}
  ${Object.keys(omitidas).length ? `<p class="pl-sc">Omitidas pelo foco (teto por tipo de regra): ${Object.entries(omitidas).map(([k, n]) => `${n} de ${esc(k)}`).join(', ')}. Elas voltam se subirem na prioridade.</p>` : ''}
  <p class="pl-sc">Cada tarefa enviada ao Notion cita o ID do anúncio; depois de 14 dias o sistema mede o resultado dela e compara com a previsão abaixo.</p>
</section>

<section>
  ${secTitulo('13', 'Previsão de faturamento com hipóteses', 'Previsibilidade (para onde vai) → Probabilidade (chance de cada ação) → Causalidade (por que) → Estratégia e execução.')}
  ${p ? `<table><thead><tr><th>Cenário (próximos 28 dias)</th><th>Ganho do plano</th><th>Faturamento estimado</th><th>Uplift</th></tr></thead><tbody>
    <tr><td>Sem plano (velocidade atual)</td><td>—</td><td><b>${brl(p.baseline)}</b></td><td>—</td></tr>
    ${['conservador', 'base', 'otimista'].map(k => `<tr><td>Com plano — ${k}</td><td>${brl(p.cenarios[k].ganho)}</td><td><b>${brl(p.cenarios[k].faturamento)}</b></td><td>${sg(p.cenarios[k].uplift_pct)}</td></tr>`).join('')}
  </tbody></table>
  <p><b>Receita em risco evitada</b> (reposição, Ads sem retorno): ${brl(p.receita_em_risco_evitada)} — contada à parte, não somada ao ganho.</p>
  <p class="pl-sc"><b>Previsibilidade:</b> ${esc(p.baseline_regra)}. <b>Probabilidade:</b> ${esc(p.metodo)} <b>Teto de plausibilidade:</b> ${algoritmo.foco.teto_plausibilidade_uplift_pct}% do baseline (${p.teto_aplicado ? 'APLICADO' : 'não atingido'}).</p>
  ${inativo(esc(p.aviso))}` : ''}
  <p class="pl-h"><b>As hipóteses por trás de cada ação</b></p>
  <table><thead><tr><th>Ação</th><th>Fórmula</th><th>Premissas</th><th>Probabilidade (fonte)</th></tr></thead><tbody>
  ${ativas.filter(a => a.previsao?.formula).slice(0, 25).map(a => `<tr><td>${esc(a.titulo.slice(0, 70))}</td><td>${esc(a.previsao.formula)}</td><td>${lista(a.previsao.premissas)}</td><td>${Math.round(a.previsao.p_sucesso * 100)}%<div class="pl-sc">${esc(a.previsao.p_fonte)}</div></td></tr>`).join('')}
  </tbody></table>
</section>

<section>
  ${secTitulo('14', 'Metodologia e limites', `Algoritmo v${algoritmo.versao}: poucas regras, todas com dado disponível e KPI mensurável.`)}
  ${lista([
    'Foco: o plano trabalha o que move dinheiro — anúncios curva A/B e o que passa de 0,5% do GMV; no máximo ' + algoritmo.foco.max_acoes_por_cliente_semana + ' ações por semana por cliente, o resto fica na fila.',
    'Prioridade P0–P3 = impacto financeiro 40% + gravidade 20% + evidência causal 25% + facilidade 15%.',
    'Toda probabilidade começa como premissa declarada e é substituída pela taxa de melhora medida das tarefas do mesmo tipo (≥ 5 tarefas), com encolhimento bayesiano.',
    'Depois de 14 dias, cada tarefa distribuída é medida (antes × depois com grupo de controle) e o resultado é comparado com a previsão: o viés e o erro aparecem na página de metodologia.',
    'Regra com 10 tarefas medidas e taxa de melhora abaixo de 25% (limite superior de Wilson) é candidata à aposentadoria.',
    'Limites: associação temporal, não causalidade comprovada; valores são potencial estimado, nunca receita garantida; nada é executado automaticamente.',
  ])}
</section>

${rodape('Plano da conta · ' + diag.cliente)}
</div></body></html>`
}
