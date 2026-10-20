// Seções do Relatório Semanal focadas em RESULTADO (o que vai para o cliente que não prioriza a lista de tarefas, e também para quem prioriza):
//   desempenho (crescimento / estagnação / queda + o que fazer) · full · tarefas que geraram venda no detalhe (anúncio, antes × 24h × 48h × 72h × 1 semana × hoje,
//   micro gráfico) · combinações de tarefas · tarefa que pede cuidado · 20% que geram 80%.
// Puro (sem banco): recebe os dados em `r` (montados em semanal.js) e os helpers de formatação de render-semanal.js em `h`.
// Honestidade: "—" + motivo, nunca zero inventado; "associação temporal", nunca "causou"; só o estado Melhorou autoriza "gerou resultado".

const ESTADO_CLS = { queda: 'e-queda', estagnacao: 'e-estagnacao', crescimento: 'e-crescimento' }
const LINHAS = [
  ['visitas', 'Visitas por dia', 'num', true], ['unidades', 'Vendas (unidades) por dia', 'num', true], ['receita', 'Faturamento por dia', 'moeda', true], ['conversao', 'Conversão', 'pct', true],
  ['ads_prints', 'Impressões de Ads por dia', 'num', true], ['ads_clicks', 'Cliques de Ads por dia', 'num', true], ['ads_custo', 'Investimento em Ads por dia', 'moeda', null], ['ads_roas', 'ROAS (retorno de Ads)', 'x', true],
]
const STATUS_ANUNCIO = { active: 'ativo', paused: 'pausado', under_review: 'em revisão', closed: 'encerrado', inactive: 'inativo' }
const VEREDITO = { funciona: 'já funcionou nesta conta', nao_funciona: 'sem resultado mensurável até agora', inconclusivo: 'resultado misto', sem_amostra: 'ainda sem amostra' }

export function criarSecoesResultado(h) {
  const { esc, num, fmtNum, fmtMoeda, urlOk, brData, secTitulo, plural, corta } = h
  const br1 = v => num(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'
  const val = (v, un) => !num(v) ? '—' : un === 'moeda' ? fmtMoeda(v) : un === 'pct' ? `${br1(v)}%` : un === 'x' ? `${br1(v)}x` : br1(v)
  const sig = v => v > 0 ? '+' : ''
  const ef = v => !num(v) ? '—' : Math.abs(v) > 300 ? (v > 0 ? 'mais de +300%' : 'menos de −300%') : `${sig(v)}${br1(v)}%`   // percentual absurdo = base pequena: não imprime +1.114%
  const img = (t, alt) => urlOk(t) ? `<img src="${esc(urlOk(t))}" alt="${esc(alt || '')}" loading="lazy" referrerpolicy="no-referrer">` : '<div class="sem-img">sem imagem</div>'
  const aItem = (it, txt) => urlOk(it?.permalink) ? `<a href="${esc(urlOk(it.permalink))}" target="_blank" rel="noopener">${esc(txt)}</a>` : esc(txt)
  // o SVG vem de microGrafico() (só números; título escapado). Defesa extra: só entra se tiver exatamente essa cara e nada executável
  const svgSeguro = svg => typeof svg === 'string' && /^<svg class="micro" [^>]*>[\s\S]*<\/svg>$/.test(svg) && !/<script|<foreignObject|\son\w+\s*=|javascript:|<a[\s>]|<image|<use/i.test(svg) ? svg : ''
  const semDado = (x, motivo) => x.interno ? `<section class="sec-curta" data-sec="indisponivel"><p class="vazio">△ Seção indisponível nesta geração — ${esc(motivo)} <span class="mono">(visível só na versão interna)</span></p></section>` : ''

  // ── 1. Crescimento ou queda da conta + o que fazer ────────────────────────
  function secDesempenho(x) {
    const { r } = x, d = r.desempenho
    if (!d) return semDado(x, r.retro_erro || 'sem série de vendas coletada do Mercado Livre')
    const e = d.estado
    if (e.estado === 'sem_base') return `<section data-sec="desempenho" class="sec-curta">${secTitulo(x.n(), 'Crescimento ou queda da conta', 'Como a conta se comportou nas últimas duas semanas.')}<p class="vazio">— ${esc(e.motivo || 'Sem base de comparação suficiente.')} Nada foi estimado.</p></section>`
    const pct = e.variacao_pct
    const conf = e.confirmacao_28d ? ` · mês de 28 dias: ${esc(e.confirmacao_28d.estado === 'queda' ? 'queda' : e.confirmacao_28d.estado === 'crescimento' ? 'crescimento' : 'estável')} (${sig(e.confirmacao_28d.variacao_pct)}${br1(e.confirmacao_28d.variacao_pct)}%)` : ''
    const q = d.queda
    const vis = m => !m.interno || x.interno                  // motivo sobre o trabalho da própria equipe (entregas, mexidas) é interno: o cliente não lê "a equipe entregou menos"
    const mots = q ? q.motivos.filter(vis) : []
    const motivos = q ? `<div class="bloco-queda"><h3>Por que caiu — as causas mais prováveis</h3>
      ${q.aviso_janela ? `<p class="nota-honesta">${esc(q.aviso_janela)}</p>` : ''}
      ${mots.length ? `<ol class="motivos">${mots.map(m => `<li><b>${esc(m.rotulo)}</b> <span class="tag ${m.tipo === 'fato' ? 't-medido' : 't-hipotese'}">${m.tipo === 'fato' ? 'dado' : 'hipótese'}</span>${m.interno ? ' <span class="mono">INTERNO</span>' : ''}<br>${esc(m.texto)}${m.evidencia ? `<br><span class="evid">${esc(m.evidencia)}</span>` : ''}${m.acao ? `<br><span class="acao-m">→ ${esc(m.acao)}</span>` : ''}
        ${(m.itens || []).filter(i => num(i.delta) && i.delta <= -1).length ? `<div class="mini-itens">${m.itens.filter(i => num(i.delta) && i.delta <= -1).slice(0, 4).map(i => `<span class="mini-item">${urlOk(i.thumb) ? img(i.thumb, i.titulo) : ''}<span>${aItem(i, corta(i.titulo, 46))} <i>−${fmtMoeda(Math.abs(i.delta))}</i></span></span>`).join('')}</div>` : ''}</li>`).join('')}</ol>` : '<p class="vazio">Nenhuma causa isolada aparece nos dados disponíveis — a queda é difusa e será investigada anúncio a anúncio.</p>'}
      ${q.acoes.filter(a => !a.interno || x.interno).length ? `<h3>Ações recomendadas</h3><ul class="lista-acoes">${q.acoes.filter(a => !a.interno || x.interno).map(a => `<li>${esc(a.descricao)}</li>`).join('')}</ul>` : ''}
      ${q.tarefas.filter(t => t.veredito !== 'nao_funciona').length ? `<h3>Tarefas que mais ajudam nesse cenário</h3><ul class="lista-acoes">${q.tarefas.filter(t => t.veredito !== 'nao_funciona').map(t => `<li><b>${esc(t.tipo)}</b>${t.veredito === 'funciona' ? ` <span class="mono">${esc(VEREDITO.funciona)}${t.n ? ` (${fmtNum(t.melhorou)} de ${fmtNum(t.n)} melhoraram)` : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}
      <h3>Atitudes</h3><ul class="lista-acoes">${[...q.atitudes, ...(x.interno ? (q.atitudes_internas || []) : [])].map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''
    const jog = d.jogadas && !q ? `<div class="bloco-jogadas"><h3>${esc(d.jogadas.titulo)}</h3><p class="sub-bloco">${esc(d.jogadas.leitura)}</p>
      <ol class="jogadas">${d.jogadas.jogadas.map(j => `<li><b>${esc(j.titulo)}</b><br>${esc(j.porque)}${j.extra ? `<br><span class="evid">${esc(j.extra)}</span>` : ''}</li>`).join('')}</ol>
      <h3>Atitudes</h3><ul class="lista-acoes">${d.jogadas.atitudes.map(a => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''
    const prox = (r.proximas_acoes || []).length ? `<div class="bloco-prox"><h3>Próximas ações do plano — na ordem em que o sistema recomenda</h3>
      <ol class="jogadas">${r.proximas_acoes.slice(0, 5).map(a => `<li><b>${esc(a.titulo)}</b>${a.prazo ? ` <span class="mono">prazo ${esc(brData(a.prazo))}</span>` : ''}<br><span class="evid">${esc(x.interno ? (a.retro?.motivo || 'Prioridade pelo impacto estimado, gravidade, evidência e facilidade.') : 'Priorizada pelo impacto estimado, pela gravidade e pelo que já funcionou nesta conta.')}</span></li>`).join('')}</ol>
      <p class="nota-honesta">${x.interno ? 'O plano aprende com as tarefas já medidas: o que melhorou vendas sobe na fila, o que não mostrou resultado desce. Inclui propostas ainda não aprovadas.' : 'Ações aprovadas pela equipe para as próximas semanas. Estimativa, não promessa de resultado.'}</p></div>` : ''
    return `<section data-sec="desempenho">
  ${secTitulo(x.n(), 'Crescimento ou queda da conta', 'Estado da conta nas últimas duas semanas, o porquê e o que fazer a partir dele.')}
  <div class="estado-conta"><span class="estado ${ESTADO_CLS[e.estado]}">${esc(e.rotulo)}${e.forca === 'forte' ? ' forte' : ''}</span>
    <div class="estado-num"><b>${sig(pct)}${br1(pct)}%</b> de faturamento nos últimos ${fmtNum(e.janela_dias)} dias<span class="mono"> — ${fmtMoeda(e.receita.atual)} contra ${fmtMoeda(e.receita.anterior)}${conf}</span></div></div>
  <p>${esc(d.leitura)}</p>
  ${e.sinal_misto ? `<p class="nota-honesta">${esc(e.sinal_misto)}</p>` : ''}
  ${d.ciclo_anterior ? `<p class="mono">CICLO ANTERIOR (${esc(brData(d.ciclo_anterior.dia))}): ${esc(d.ciclo_anterior.estado.toUpperCase())} → AGORA ${esc(e.rotulo.toUpperCase())}${d.ciclo_anterior.evolucao === 'melhorou' ? ' · MELHOROU' : d.ciclo_anterior.evolucao === 'piorou' ? ' · PIOROU' : ' · IGUAL'}</p>` : ''}
  ${motivos}${jog}${prox}
</section>`
  }

  // ── 2. Full ───────────────────────────────────────────────────────────────
  function secFull(x) {
    const f = x.r.full
    if (!f) return semDado(x, 'sem dados coletados do Mercado Livre')
    if (!f.disponivel) return /logística/.test(f.motivo || '') ? `<section data-sec="full" class="sec-curta">${secTitulo(x.n(), 'Mercado Livre Full', 'Participação e estoque dos anúncios no Full.')}<p class="vazio">O dado de logística dos anúncios (Full ou não) ainda está sendo coletado e entra no próximo relatório. Nada foi estimado.</p></section>` : semDado(x, f.motivo)
    if (!f.tem_full) return `<section data-sec="full" class="sec-curta">${secTitulo(x.n(), 'Mercado Livre Full', 'Participação e estoque dos anúncios no Full.')}<p class="vazio">${esc(f.leitura)}</p></section>`
    const tile = (n, rot, dl) => `<div class="met"><div class="v"><span class="n">${n}</span>${dl}</div><div class="r">${esc(rot)}</div></div>`
    const bdg = p => num(p) ? ` <span class="comp ${p === 0 ? 'igual' : p > 0 ? 'bom' : 'ruim'}">${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${br1(Math.abs(p))}%</span>` : ''
    return `<section data-sec="full">
  ${secTitulo(x.n(), 'Mercado Livre Full', 'Anúncios no Full: o quanto vendem, quanto pesam no faturamento e quanto estoque têm.')}
  <div class="met-grade">
    ${tile(fmtNum(f.anuncios_full), 'Anúncios com venda no Full', '')}
    ${tile(fmtMoeda(f.receita.atual), 'Faturamento no Full', bdg(f.receita.pct))}
    ${tile(fmtNum(f.unidades.atual), 'Unidades vendidas no Full', bdg(f.unidades.pct))}
    ${tile(num(f.share_pct) ? `${br1(f.share_pct)}%` : '—', 'Participação no faturamento', '')}
    ${tile(num(f.cobertura_dias) ? `${fmtNum(f.cobertura_dias)} dias` : '—', 'Cobertura de estoque (média)', '')}
    ${tile(num(f.conversao.full) ? `${br1(f.conversao.full)}%` : '—', `Conversão no Full${num(f.conversao.fora_do_full) ? ` · fora do Full ${br1(f.conversao.fora_do_full)}%` : ''}`, '')}
  </div>
  <p>${esc(f.leitura)}</p>
  ${f.risco_ruptura.length ? `<div class="aviso">△ Risco de ruptura no Full: ${f.risco_ruptura.map(i => `${esc(corta(i.titulo, 50))} (${fmtNum(i.cobertura_dias)} dia(s) de estoque)`).join('; ')}.</div>` : ''}
</section>`
  }

  // ── 3. Tarefas que geraram venda, no detalhe ──────────────────────────────
  function celulaMarco(m, k, un, pol) {
    if (!m) return '<td class="nd">—</td>'
    if (m.estado === 'aguardando') return `<td class="aguarda" title="o marco fecha com o dia completo">fecha em ${esc(brData(m.disponivel_em))}</td>`
    const v = m.valores?.[k]
    if (!num(v)) return `<td class="nd" title="${esc(m.motivos?.[k] || '')}">—</td>`
    const d = m.deltas?.[k]
    let dl = ''
    if (d?.pontos != null) dl = `<i class="${d.pontos === 0 || pol === null ? 'n' : (d.pontos > 0) === (pol !== false) ? 'b' : 'r'}">${sig(d.pontos)}${br1(d.pontos)} p.p.</i>`
    else if (d?.pct != null) dl = `<i class="${d.pct === 0 || pol === null ? 'n' : (d.pct > 0) === (pol !== false) ? 'b' : 'r'}">${sig(d.pct)}${br1(d.pct)}%</i>`
    return `<td>${val(v, un)}${dl}</td>`
  }
  function cartaoVenda(x, c) {
    const it = c.itens[0] || {}, q = c.quadro, med = c.medido
    const marcos = ['d1', 'd2', 'd3', 'd7'].map(k => q.marcos.find(m => m.k === k))
    const linhas = LINHAS.filter(([k]) => num(q.base.valores[k]) || marcos.some(m => num(m?.valores?.[k])) || num(q.hoje?.valores?.[k])).map(([k, rot, un, pol]) =>
      `<tr><th>${esc(rot)}</th><td class="base">${val(q.base.valores[k], un)}</td>${marcos.map(m => celulaMarco(m, k, un, pol)).join('')}${celulaMarco(q.hoje, k, un, pol)}</tr>`).join('')
    const semAds = !LINHAS.filter(([k]) => k.startsWith('ads_')).some(([k]) => num(q.base.valores[k]) || marcos.some(m => num(m?.valores?.[k])) || num(q.hoje?.valores?.[k]))
    const mud = (it.mudancas || []).filter(m => m.campo !== 'thumb')
    const lanc = med.estado === 'lancamento'
    const ganho = num(med.receita_alocada) ? `<div class="vc-ganho"><span class="rotulo">${lanc ? 'Vendas depois da tarefa (valor bruto)' : 'Ganho associado (estimativa)'}</span> <b>${fmtMoeda(med.receita_alocada)}</b>${!lanc && num(med.efeito_pct) ? ` · efeito ajustado ${ef(med.efeito_pct)}` : ''}
      ${lanc ? '<div class="mono">ANÚNCIO PARADO ANTES DA TAREFA: NÃO HÁ BASE NEM GRUPO DE CONTROLE — O VALOR É A VENDA TOTAL DEPOIS, SEM AJUSTE.</div>' : ''}</div>` : ''
    const cf = med.confianca
    const itensHtml = c.itens.map(i => `<div class="vc-item-um">${img(i.thumb, i.titulo)}<div class="vc-item-txt"><div class="rotulo">Anúncio</div>${aItem(i, corta(i.titulo || 'Anúncio', 80))}<div class="mono">${esc(i.item_id || '')}${num(i.preco) ? ` · ${fmtMoeda(i.preco)}` : ''}${i.status && i.status !== 'active' ? ` · ${esc(STATUS_ANUNCIO[i.status] || i.status)}` : ''}</div></div></div>`).join('')
    return `<div class="entrega venda-card" data-venda="1">
  <div class="vc-item">${itensHtml}${c.itens_extra ? `<div class="mono">+ ${plural(c.itens_extra, 'outro anúncio', 'outros anúncios')} na mesma tarefa</div>` : ''}${(c.vinculo?.n_itens || c.itens.length) > 1 ? `<div class="mono">MÉTRICAS SOMADAS DE ${fmtNum(c.vinculo?.n_itens || c.itens.length)} ANÚNCIOS</div>` : ''}</div>
  <div class="vc-corpo">
    <h3>${esc(c.tarefa.titulo)}</h3>
    <div class="lm"><span class="tag ${lanc ? 't-informado' : 't-medido'}">${esc(med.rotulo)}</span>${c.tarefa.tipo ? `<span class="tag t-proc">${esc(c.tarefa.tipo)}</span>` : ''}<span>${esc(brData(c.tarefa.data))}${c.tarefa.data_estimada ? ' (data estimada)' : ''}</span>${x.regras.mostrar_equipe && c.tarefa.analista ? `<span>${esc(c.tarefa.analista)}</span>` : ''}
      ${cf?.score != null ? `<span class="mono">${esc(x.T.certeza.toUpperCase())} ${fmtNum(cf.score)}/100</span>` : ''}</div>
    <p class="vc-leitura">${esc(c.leitura)}</p>
    <div class="vc-quadro"><table class="vc-tab"><colgroup><col style="width:24%"><col style="width:15%"><col style="width:12.5%"><col style="width:12.5%"><col style="width:12.5%"><col style="width:12.5%"><col style="width:11%"></colgroup><thead><tr><th></th><th>Antes<small>média dos ${fmtNum(q.janela_base.dias)} dias</small></th><th>24h</th><th>48h</th><th>72h</th><th>1 semana</th><th>Hoje<small>até ${esc(brData(q.hoje?.atualizado_ate || q.hoje?.disponivel_em))}</small></th></tr></thead><tbody>${linhas}</tbody></table>
      ${semAds ? '<p class="mono">SEM DADO DIÁRIO DE ADS PARA ESTE ANÚNCIO NO PERÍODO — NADA FOI ESTIMADO.</p>' : ''}</div>
    ${svgSeguro(c.grafico?.svg) ? `<div class="vc-grafico">${c.grafico.svg}<div class="explica">${c.grafico.metrica === 'visitas' ? 'VISITAS' : 'VENDAS'} POR DIA · LINHA = MÉDIA DE 3 DIAS · TRACEJADO VERTICAL = TAREFA CONCLUÍDA · TRACEJADO HORIZONTAL = MÉDIA DE ANTES</div></div>` : ''}
    ${ganho}
    ${mud.length ? `<div class="vc-mudou"><span class="rotulo">O que mudou no anúncio</span><ul>${mud.slice(0, 5).map(m => `<li><b>${esc(m.rotulo)}:</b> ${esc(m.campo === 'preco' ? fmtMoeda(m.antes) : String(m.antes ?? '—'))} → ${esc(m.campo === 'preco' ? fmtMoeda(m.agora) : String(m.agora ?? '—'))}</li>`).join('')}</ul></div>` : ''}
    ${c.plano ? `<p class="mono">PLANO: META "${esc(corta(c.plano.meta || '', 90))}"${num(c.plano.previsto_base) ? ` · PREVISTO (CENÁRIO BASE) ${esc(fmtMoeda(c.plano.previsto_base))}` : ''}</p>` : ''}
  </div></div>`
  }
  function secVendaDetalhe(x) {
    const ta = x.r.tarefas_anuncio
    if (!ta) return semDado(x, x.r.acompanhamento_erro || 'acompanhamento por tarefa indisponível')
    const cards = (ta.cartoes || []).filter(c => c.gerou_resultado)
    const lim = x.regras.max_resultados > 0 ? x.regras.max_resultados : 8
    const resumo = ta.resumo || {}
    return `<section data-sec="venda_detalhe">
  ${secTitulo(x.n(), 'Tarefas que geraram venda, no detalhe', 'Cada tarefa com o anúncio, o antes e o depois (24h, 48h, 72h, 1 semana e hoje) e a evolução em gráfico.')}
  <p class="nota-honesta">Só entra aqui a tarefa cujo anúncio MELHOROU depois dela — descontando o que os anúncios sem tarefa fizeram no mesmo período e o ruído normal da conta — ou o anúncio que estava parado e passou a vender (lançamento: valor bruto, sem ajuste). É a causa mais provável, não uma prova. As variações dos marcos descrevem o que o anúncio fez; o "ganho associado" é uma estimativa.</p>
  ${cards.length ? cards.slice(0, lim).map(c => cartaoVenda(x, c)).join('') : `<p class="vazio">${esc(`Nenhuma tarefa dos últimos ${fmtNum(ta.dias)} dias teve melhora medida com confiança neste período.${resumo.tarefas_com_anuncio ? ` ${plural(resumo.tarefas_com_anuncio, 'tarefa com anúncio identificado foi acompanhada', 'tarefas com anúncio identificado foram acompanhadas')} e ainda ${resumo.tarefas_com_anuncio === 1 ? 'não mostrou' : 'não mostraram'} efeito mensurável.` : ''}`)}</p>`}
  ${cards.length > lim ? `<div class="tab-mais">+ ${plural(cards.length - lim, 'tarefa com resultado não exibida', 'tarefas com resultado não exibidas')} neste resumo.</div>` : ''}
  ${x.interno && resumo.sem_anuncio_identificado ? `<p class="mono">INTERNO: ${fmtNum(resumo.sem_anuncio_identificado)} TAREFA(S) SEM ANÚNCIO IDENTIFICADO NO CARD — SEM O ANÚNCIO NÃO HÁ ANTES/DEPOIS. CITE O ID MLB NO CARD OU CONFIRME O VÍNCULO NA TELA DO CLIENTE.</p>` : ''}
</section>`
  }

  // ── 4. Combinações ────────────────────────────────────────────────────────
  const linhaCombo = c => `<tr><td><b>${esc(c.chave)}</b>${c.amostra_pequena ? ' <span class="mono">amostra pequena</span>' : ''}</td><td>${fmtNum(c.n)}</td><td>${fmtNum(c.melhorou)}</td><td>${fmtNum(c.sem_efeito)}</td><td>${fmtNum(c.piorou)}</td><td>${num(c.efeito_mediano_pct) ? `${sig(c.efeito_mediano_pct)}${br1(c.efeito_mediano_pct)}%` : '—'}</td></tr>`
  const tabCombo = l => `<table><thead><tr><th>Combinação de tarefas no mesmo anúncio</th><th style="width:70px">Casos</th><th style="width:80px">Melhorou</th><th style="width:80px">Sem efeito</th><th style="width:70px">Piorou</th><th style="width:100px">Efeito mediano</th></tr></thead><tbody>${l.map(linhaCombo).join('')}</tbody></table>`
  function secCombos(x) {
    const c = x.r.retro?.combos
    if (!c) return semDado(x, 'análise de combinações indisponível')
    return `<section data-sec="combos">
  ${secTitulo(x.n(), 'Combinações de tarefas que mais funcionam', 'Tarefas diferentes aplicadas ao MESMO anúncio na mesma quinzena — e o que aconteceu com ele.')}
  <p>${esc(c.leitura)}</p>
  ${c.funcionam.length ? `<h3>Quais tarefas juntas melhoraram</h3>${tabCombo(c.funcionam.slice(0, 6))}` : ''}
  ${!c.funcionam.length && c.candidatas.length ? `<h3>Candidatas (ainda sem amostra para afirmar)</h3>${tabCombo(c.candidatas.slice(0, 4))}` : ''}
  ${c.pioram.length ? `<h3>Combinações que não deram certo — evitar repetir sem piloto</h3>${tabCombo(c.pioram.slice(0, 4))}` : ''}
  <p class="nota-honesta">Cada caso é um anúncio com duas ou mais tarefas de tipos diferentes na mesma quinzena, medido como uma única intervenção (com grupo de controle e ruído). Poucos casos = leitura provisória: a amostra só vira padrão a partir de ${fmtNum(c.min_n)} casos.</p>
</section>`
  }

  // ── 5. A tarefa que pede cuidado ──────────────────────────────────────────
  function secPior(x) {
    const p = x.r.retro?.pior_tarefa
    if (!p) return semDado(x, 'análise indisponível')
    // estatística da BASE INTEIRA (tarefas de outros clientes) é uso interno; o cliente só lê o que aconteceu NA CONTA DELE
    const tipos = x.interno ? p.tipos : p.tipos.filter(t => t.conta && t.conta.n >= 1)
    const indiv = p.tarefas_individuais || []
    if (!tipos.length && !indiv.length) return x.interno ? `<section data-sec="pior" class="sec-curta">${secTitulo(x.n(), 'A tarefa que pede mais cuidado', 'Onde o histórico mostra mais risco de piora.')}<p class="vazio">${esc(p.leitura)}</p></section>` : ''
    return `<section data-sec="pior">
  ${secTitulo(x.n(), 'A tarefa que pede mais cuidado', 'Onde o histórico mostra mais risco de piora — para fazer com piloto, não para evitar.')}
  ${tipos.map(t => `<div class="entrega cuidado"><h3>${esc(t.tipo)}</h3>
    ${x.interno ? `<p>${esc(t.leitura)}</p><p class="mono">BASE: ${fmtNum(t.n)} TAREFAS MEDIDAS · ${fmtNum(t.melhorou)} MELHORARAM · ${fmtNum(t.sem_efeito)} SEM EFEITO · ${fmtNum(t.piorou)} PIORARAM</p>` : ''}
    ${t.conta ? `<p>${x.interno ? 'Nesta conta: ' : ''}${plural(t.conta.n, 'tarefa medida', 'tarefas medidas')} deste tipo, ${fmtNum(t.conta.piorou)} seguida(s) de piora. Por isso, antes de repetir em vários anúncios, vale um piloto de 14 dias em UM anúncio.</p>` : ''}</div>`).join('')}
  ${indiv.length ? `<h3>Tarefas desta conta seguidas de piora (últimos 90 dias)</h3><ul class="lista-acoes">${indiv.map(t => `<li><b>${esc(corta(t.titulo, 90))}</b> <span class="mono">${esc(t.tipo || '')} · ${esc(brData(t.data))} · ${ef(t.efeito_pct)}</span></li>`).join('')}</ul>` : ''}
  <h3>Como fazer com cuidado</h3><ul class="lista-acoes">${p.cuidados.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
  <p class="nota-honesta">${esc(p.aviso)} Tarefas feitas num pico do anúncio (que tendem a piorar sozinhas) ficam de fora desta conta.</p>
</section>`
  }

  // ── 6. Os 20% que geram 80% ───────────────────────────────────────────────
  function secPareto(x) {
    const P = x.r.retro?.pareto
    if (!P) return semDado(x, 'análise 80/20 indisponível')
    const I = P.itens, T = P.tarefas
    const itens = I?.disponivel ? `<h3>Anúncios que sustentam a conta</h3><p>${esc(I.leitura)}</p>${I.alerta ? `<div class="aviso">△ ${esc(I.alerta)}</div>` : ''}
      <div class="pareto-itens">${I.itens.slice(0, 8).map(i => `<div class="p-item">${img(i.thumb, i.titulo)}<div class="p-txt">${aItem(i, corta(i.titulo, 60))}<div class="mono">${esc(i.id)} · ${fmtMoeda(i.receita)} · ${br1(i.share_pct)}% da receita · acumulado ${br1(i.acum_pct)}%</div></div></div>`).join('')}</div>${I.itens.length > 8 ? `<div class="tab-mais">+ ${plural(I.itens.length - 8, 'anúncio', 'anúncios')} completam os ${fmtNum(I.pct_alvo)}%.</div>` : ''}` : ''
    const tarefas = T?.disponivel ? `<h3>Ações que mais geraram resultado${T.periodo_dias ? ` <span class="mono">(tarefas dos últimos ${fmtNum(T.periodo_dias)} dias)</span>` : ''}</h3><p>${esc(T.leitura)}</p>
      ${T.por_tipo.some(t => t.ganho > 0) ? `<table><thead><tr><th>Tipo de tarefa</th><th style="width:70px">Medidas</th><th style="width:80px">Melhoraram</th><th style="width:110px">Ganho associado</th><th style="width:90px">Do total</th></tr></thead><tbody>${T.por_tipo.filter(t => t.ganho > 0).slice(0, 6).map(t => `<tr><td><b>${esc(t.tipo)}</b></td><td>${fmtNum(t.n)}</td><td>${fmtNum(t.melhorou)}</td><td>${fmtMoeda(t.ganho)}</td><td>${br1(t.share_pct)}%</td></tr>`).join('')}</tbody></table>` : ''}` : ''
    if (!itens && !tarefas) return semDado(x, I?.motivo || T?.motivo || 'sem dados')
    return `<section data-sec="pareto">
  ${secTitulo(x.n(), 'Os 20% que geram 80%', 'Onde está o resultado da conta — e onde cada ação deve começar.')}
  ${itens}${tarefas}
</section>`
  }

  const CSS = `
  /* resultado: estado da conta, tarefas que geraram venda, Full, combinações */
  .estado-conta{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin:6px 0 12px}
  .estado{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.1em;text-transform:uppercase;padding:7px 16px;border-radius:3px;color:#fff;white-space:nowrap}
  .e-queda{background:#c0392b} .e-estagnacao{background:#b7791f} .e-crescimento{background:#1e7b4d}
  .estado-num{font-size:15px} .estado-num b{font-family:'Playfair Display',serif;font-size:26px;margin-right:4px}
  .estado-num .mono{display:block;font-size:10px;color:var(--rule);letter-spacing:.04em;margin-top:2px}
  .bloco-queda,.bloco-jogadas,.bloco-prox{margin-top:16px} .bloco-queda h3,.bloco-jogadas h3,.bloco-prox h3,[data-sec=combos] h3,[data-sec=pareto] h3,[data-sec=pior] h3{font-size:15px;margin:16px 0 6px}
  .motivos,.jogadas{margin:6px 0 0 20px;font-size:13px} .motivos li,.jogadas li{margin:9px 0;line-height:1.45}
  .evid{font-size:11.5px;color:var(--rule)} .acao-m{font-size:12.5px;color:#3c4a33}
  .lista-acoes{margin:4px 0 0 20px;font-size:13px} .lista-acoes li{margin:4px 0}
  .sub-bloco{font-size:13px;color:var(--rule)}
  .mini-itens{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px} .mini-item{display:flex;gap:7px;align-items:center;font-size:11.5px;border:1px solid rgba(42,37,32,.14);padding:4px 8px;background:#fffdfa;max-width:310px}
  .mini-item img{width:30px;height:30px;object-fit:cover;flex:none} .mini-item i{font-style:normal;color:#9c2b1f;font-family:'JetBrains Mono',monospace;font-size:10px}
  .venda-card{display:grid;grid-template-columns:200px 1fr;gap:18px;border-top-color:var(--sage)}
  .vc-item img,.vc-item .sem-img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border:1px solid rgba(42,37,32,.12);display:block} .vc-item-um+.vc-item-um{margin-top:12px} .vc-item-um img{max-width:200px}
  .sem-img{display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--cinza)}
  .vc-item-txt{margin-top:8px;font-size:12px;line-height:1.35} .vc-item-txt a{font-weight:600}
  .vc-leitura{font-size:13px;margin:6px 0 10px}
  .vc-tab{width:100%;border-collapse:collapse;font-size:11.5px;table-layout:fixed}
  .vc-tab th,.vc-tab td{padding:5px 6px;border-bottom:1px solid rgba(42,37,32,.1);text-align:right;vertical-align:top}
  .vc-tab thead th{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:var(--rule);font-weight:500;vertical-align:bottom}
  .vc-tab thead th small{display:block;font-size:8px;letter-spacing:0;text-transform:none;color:var(--cinza)}
  .vc-tab tbody th{text-align:left;font-weight:500;width:25%} .vc-tab td.base{background:var(--paper-deep);font-weight:600}
  .vc-tab td i{display:block;font-style:normal;font-size:9.5px;font-family:'JetBrains Mono',monospace} .vc-tab td i.b{color:#1e7b4d} .vc-tab td i.r{color:#c0392b} .vc-tab td i.n{color:var(--cinza)}
  .vc-tab td.nd{color:var(--cinza)} .vc-tab td.aguarda{font-size:9.5px;color:var(--cinza);font-family:'JetBrains Mono',monospace}
  .vc-grafico{margin:12px 0 4px;max-width:420px} .vc-grafico svg{display:block;width:100%;height:56px;border-bottom:1px solid rgba(42,37,32,.15)} .vc-grafico .explica{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--rule);margin-top:5px;letter-spacing:.03em}
  .vc-ganho{margin:10px 0 4px;font-size:13px} .vc-ganho b{font-family:'Playfair Display',serif;font-size:21px}
  .vc-mudou{margin-top:10px;font-size:12px} .vc-mudou ul{list-style:none;margin-top:4px} .vc-mudou li{margin:2px 0}
  .entrega.cuidado{border-top-color:var(--gold)}
  .pareto-itens{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px;margin-top:10px}
  .p-item{display:flex;gap:10px;align-items:center;border:1px solid rgba(42,37,32,.12);background:#fffdfa;padding:8px} .p-item img,.p-item .sem-img{width:56px;height:56px;object-fit:contain;flex:none;background:#fff}
  .p-txt{font-size:12px;line-height:1.35;min-width:0} .p-txt .mono{font-size:9.5px;color:var(--rule);margin-top:2px}
  @media(max-width:700px){.venda-card{grid-template-columns:1fr}.vc-item img{max-width:160px}}
  .venda-card,.mini-item,.p-item,.estado-conta,.vc-tab tr{break-inside:avoid;page-break-inside:avoid}
  @media print{ .estado{-webkit-print-color-adjust:exact;print-color-adjust:exact} .vc-grafico svg *{-webkit-print-color-adjust:exact;print-color-adjust:exact} }`
  return { desempenho: secDesempenho, full: secFull, venda_detalhe: secVendaDetalhe, combos: secCombos, pior: secPior, pareto: secPareto, CSS }
}
