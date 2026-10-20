// Relatório Semanal v2 — blocos de DADOS que dependem só de ENTRADAS (funções PURAS: sem banco, rede ou arquivo).
// semanal.js lê o banco e o Mercado Livre e entrega tudo aqui; scripts/teste-semanal-dados.mjs usa dados sintéticos.
// Honestidade: nunca inventar número (indisponível = valor null + motivo, jamais 0); "causa provável", nunca causalidade
// provada; resultado MEDIDO (motor impacto-tarefas.js) separado do INFORMADO (campos do card); canal sem API só tem dado informado.

export const RX_ADS = /\b(ads|campanhas?|patrocinad\w*|acos|roas)\b/i       // 'product ads' e 'Mercado Ads' casam por 'ads'
export const CANAIS_CONHECIDOS = ['Mercado Livre', 'Shopee', 'Amazon', 'Magalu', 'TikTok Shop']
const CANAL_RX = [['Mercado Livre', /mercado\s*livre|\bml\b/i], ['Shopee', /shopee/i], ['Amazon', /amazon/i], ['Magalu', /magalu|magazine/i], ['TikTok Shop', /tik\s*tok/i]]
export const canalDe = processo => CANAL_RX.find(([, rx]) => rx.test(processo || ''))?.[0] || null
const RX_LANC = /\bcadastr|\blan[çc]a|novo an[úu]ncio|an[úu]ncio novo|\bpublica[çr]/i   // ancorado: 'Balanço' e 'Publicidade' não são lançamento
// print de PAINEL do canal = legenda ou título que diz painel/métricas; print de ação que só cita conversão/visitas não conta
const RX_PAINEL = /\bpainel\b|\bm[ée]tricas?\b|dashboard/i
export const ehPainel = (t, e) => RX_PAINEL.test(t?.titulo || '') || RX_PAINEL.test(e?.legenda || '')
// data/hora do Notion e do servidor (UTC, ISO com fuso) no fuso do cliente: 'AAAA-MM-DD HH:MM'; data sem hora/fuso fica como veio
export const horaSP = iso => { const d = new Date(iso); return /T.*(Z|[+-]\d\d:?\d\d)$/.test(iso || '') && !isNaN(d) ? d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 16) : (iso || '') }

// ── utilitários ──────────────────────────────────────────────────────────
export const dentro = (data, de, ate) => data && data >= de && data <= ate
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
export const br = iso => {
  if (!iso) return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return d ? `${d}/${m}/${a}` : iso
}
export const deltaPct = (atual, anterior) =>
  (atual != null && anterior != null && anterior !== 0) ? Math.round(1000 * (atual - anterior) / Math.abs(anterior)) / 10 : null
const r2 = n => Math.round(n * 100) / 100
const ISO = /^\d{4}-\d{2}-\d{2}$/

// Período DECLARADO de uma transcrição manual: semana_de [+ semana_ate, padrão semana_de + 6 dias]. Vale para o relatório só
// se cobrir a MAIORIA dos dias dele (4 de 7); senão null (ignorada). Sem semana_de vale sempre, com o período do relatório.
export function periodoManual(x, de, ate) {
  if (!x?.semana_de) return { de, ate, declarado: false }
  const pDe = String(x.semana_de), pAte = x.semana_ate ? String(x.semana_ate) : ISO.test(pDe) ? addDias(pDe, 6) : ''
  if (!ISO.test(pDe) || !ISO.test(pAte) || pAte < pDe) return null                    // data malformada: falha fechada
  const ini = pDe > de ? pDe : de, fim = pAte < ate ? pAte : ate
  const cobre = fim >= ini ? diasEntre(ini, fim) + 1 : 0
  return 2 * cobre > diasEntre(de, ate) + 1 ? { de: pDe, ate: pAte, declarado: true } : null
}
const avisoDeclarado = (per, quem) => per?.declarado ? `Números ${quem}, referentes a ${br(per.de)} a ${br(per.ate)}.` : null

// Histórico do gráfico "faturamento semanal": só janelas de 7 dias e sem sobreposição (a mais recente vence) — linhas
// gravadas com outra duração, ou que se cruzam com uma mais nova, contariam vendas duas vezes.
export function semanasNaoSobrepostas(linhas, max = 8) {
  const out = []
  for (const l of [...linhas].sort((a, b) => b.de.localeCompare(a.de))) {
    if (!ISO.test(l.de) || !ISO.test(l.ate) || diasEntre(l.de, l.ate) !== 6) continue
    if (out.length && l.ate >= out[out.length - 1].de) continue
    out.push(l)
    if (out.length === max) break
  }
  return out.reverse()
}

// Delta de uma métrica com POLARIDADE (nem toda subida é boa notícia — uma queda em "vendas canceladas" é a vitória) e,
// quando pedido, em pontos percentuais (conversão é ela mesma um %: "Conversão 10,4% ▲0,7 pontos", como no painel do ML).
export function delta(atual, anterior, { invertido = false, pontos = false } = {}) {
  if (atual == null || anterior == null) return null
  if (pontos) {
    const v = Math.round((atual - anterior) * 10) / 10
    return { valor: v, bom: invertido ? v < 0 : v > 0, pontos: true }
  }
  if (anterior === 0) return null
  const v = Math.round(((atual - anterior) / Math.abs(anterior)) * 1000) / 10
  return { valor: v, bom: invertido ? v < 0 : v > 0, pontos: false }
}

const f1 = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const brl0 = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const sg = (n, un = '%') => (n >= 0 ? '+' : '-') + f1(Math.abs(n)) + un
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) ? null : Number(v)   // valor digitado à mão: vazio/negativo/texto = não informado
const tacos = (investimento, faturamento) => num(investimento) != null && num(faturamento) ? Math.round((investimento / faturamento) * 10000) / 100 : null

// Metrica = { chave, rotulo, valor, unidade, delta, explicacao, extra, motivo } — valor null => "—" + motivo, nunca 0
const metrica = (chave, rotulo, valor, unidade, explicacao, { variacao = null, extra = false, motivo = null } = {}) =>
  ({ chave, rotulo, valor, unidade, delta: valor == null ? null : variacao, explicacao, extra, motivo: valor == null ? motivo : null })

// ── RESULTADOS: Mercado Livre · ADS · Outros canais ──────────────────────
function blocoMl({ de, ate, conectado, falhou, negocio, manual, semanaIgnorada, anteriorManual }) {
  const perMan = !negocio?.atual && manual ? periodoManual(manual, de, ate) : null
  const api = negocio?.atual || null, man = perMan ? manual : null
  const fonte = api ? 'api' : man ? 'manual' : null
  // sem venda, ticket e preço por unidade são indefinidos (null + motivo), nunca R$ 0,00
  const semVenda = x => { if (x.vendas === 0 || x.ticket === 0) x.ticket = null; if (x.unidades === 0 || x.preco_unidade === 0) x.preco_unidade = null; return x }
  const doApi = n => n && semVenda({ faturamento: num(n.faturamento), vendas: num(n.vendas), unidades: num(n.unidades), ticket: num(n.preco_medio_venda), visitas: num(n.visitas),
    conversao: num(n.conversao), cancelamentos: num(n.vendas_canceladas), devolucoes: num(n.vendas_devolvidas), valor_cancelado: num(n.valor_cancelado), preco_unidade: num(n.preco_medio_unidade) })
  const doManual = x => x && semVenda({ faturamento: num(x.faturamento), vendas: num(x.vendas), unidades: num(x.unidades), ticket: num(x.ticket_medio), visitas: num(x.visitas), conversao: num(x.conversao) })
  const a = (api ? doApi(api) : man ? doManual(man) : null) || {}
  const p = api ? doApi(negocio.anterior) : man ? doManual(anteriorManual) : null
  const v = (k, o) => p ? delta(a[k], p[k], o) : null
  // cancelamento/devolução/valor cancelado: a cor vem da TAXA sobre as vendas (mín. 10 vendas nos dois períodos) — em número
  // absoluto, cair porque as vendas caíram pareceria vitória. Sem amostra, ou número e taxa em sentidos opostos: sem delta.
  const vTaxa = (k, base) => {
    const d = v(k, { invertido: true })
    if (!d || d.valor === 0) return d
    if (!(a.vendas >= 10 && p.vendas >= 10 && a[base] > 0 && p[base] > 0)) return null
    const ta = a[k] / a[base], tp = p[k] / p[base]
    return (d.valor < 0 && ta < tp) || (d.valor > 0 && ta > tp) ? d : null
  }
  const nd = fonte === 'api' ? 'não retornado pela API do Mercado Livre' : 'não consta nos números informados pela equipe'
  const ndVenda = (x, k) => a.vendas === 0 && x == null ? 'sem vendas no período' : k
  const metricas = [
    metrica('faturamento', 'Faturamento', a.faturamento ?? null, 'moeda', 'Total vendido no período (soma dos pedidos pagos).', { variacao: v('faturamento'), motivo: nd }),
    metrica('vendas', 'Vendas', a.vendas ?? null, 'numero', 'Quantidade de pedidos pagos.', { variacao: v('vendas'), motivo: nd }),
    metrica('unidades', 'Unidades vendidas', a.unidades ?? null, 'numero', 'Quantidade de produtos vendidos (um pedido pode ter vários).', { variacao: v('unidades'), motivo: nd }),
    metrica('ticket_medio', 'Ticket médio', a.ticket ?? null, 'moeda', 'Valor médio de cada venda (faturamento ÷ vendas).', { variacao: v('ticket'), motivo: ndVenda(a.ticket, nd) }),
    metrica('visitas', 'Visitas', a.visitas ?? null, 'numero', 'Quantas vezes os anúncios foram abertos por compradores.', { variacao: v('visitas'), motivo: nd }),
    metrica('conversao', 'Conversão', a.conversao ?? null, 'pct', 'De cada 100 visitas, quantas viraram venda (vendas ÷ visitas).', { variacao: v('conversao', { pontos: true }), motivo: a.visitas == null ? 'depende das visitas, que estão indisponíveis' : nd }),
    metrica('cancelamentos', 'Vendas canceladas', a.cancelamentos ?? null, 'numero', 'Pedidos cancelados no período — quanto menos, melhor.', { variacao: vTaxa('cancelamentos', 'vendas'), motivo: nd }),
    metrica('devolucoes', 'Devoluções', a.devolucoes ?? null, 'numero', 'Reclamações e devoluções abertas no período — quanto menos, melhor.', { variacao: vTaxa('devolucoes', 'vendas'), motivo: fonte === 'api' ? 'consulta de reclamações indisponível para esta conta' : nd }),
    metrica('valor_cancelado', 'Valor cancelado', a.valor_cancelado ?? null, 'moeda', 'Quanto valia o que foi cancelado — quanto menos, melhor.', { variacao: vTaxa('valor_cancelado', 'faturamento'), extra: true, motivo: nd }),
    metrica('preco_medio_unidade', 'Preço médio por unidade', a.preco_unidade ?? null, 'moeda', 'Faturamento ÷ unidades vendidas.', { variacao: v('preco_unidade'), extra: true, motivo: ndVenda(a.preco_unidade, nd) }),
  ]
  const motivo = fonte ? null
    : falhou ? 'O Mercado Livre não respondeu na geração deste relatório; os números não foram estimados.'
    : semanaIgnorada ? `Os números informados pela equipe são de outra semana (semana de ${br(semanaIgnorada)}) e não foram usados.`
    : !conectado ? 'Conta do Mercado Livre ainda não conectada ao relatório e nenhum dado foi informado pela equipe nesta semana.'
    : 'O Mercado Livre não retornou dados para o período.'
  return { canal: 'Mercado Livre', fonte, disponivel: !!fonte, motivo,
    aviso: api?.parcial ? 'Período com mais de 1.000 pedidos: os números são uma amostra, não o total.' : man ? avisoDeclarado(perMan, 'informados pela equipe a partir do painel') : null, metricas }
}

// motivo vindo da API de Ads só vai ao cliente se for uma frase conhecida; status HTTP e afins ficam no aviso interno (semanal.js)
const MOTIVO_ADS_CLIENTE = /^(nenhum gasto em Ads no período|conta sem Ads \(Product Ads\) habilitado ou sem permissão de leitura)$/
function blocoAds({ de, ate, conectado, falhou, ads, negocio, manual, semanaIgnorada, acoes }) {
  const api = ads?.atual?.disponivel ? ads.atual : null
  const ant = api && ads.anterior?.disponivel ? ads.anterior : null
  const perMan = !api && !negocio?.atual && manual?.ads ? periodoManual(manual, de, ate) : null
  const man = perMan ? manual.ads : null     // transcrição só vale sem dado automático (mesma regra do relatório todo)
  const fonte = api ? 'api' : man ? 'manual' : null
  const norm = (x, fat) => {
    if (!x) return null
    const inv = num(x.investimento), rec = num(x.receita), cl = num(x.cliques), im = num(x.impressoes)
    return { investimento: inv, receita: rec, roas: num(x.roas) ?? (inv > 0 && rec != null ? r2(rec / inv) : null),
      acos: num(x.acos) ?? (rec > 0 && inv != null ? r2(100 * inv / rec) : null), vendas: num(x.vendas_atribuidas),
      impressoes: im, cliques: cl, ctr: im > 0 && cl != null ? r2(100 * cl / im) : null, cpc: cl > 0 && inv != null ? r2(inv / cl) : null,
      tacos: tacos(inv, fat) }
  }
  const a = (api ? norm(api, negocio?.atual?.faturamento) : man ? norm(man, num(manual.faturamento)) : null) || {}
  const p = norm(ant, negocio?.anterior?.faturamento)
  const v = (k, o) => p ? delta(a[k], p[k], o) : null
  const nd = fonte === 'api' ? 'não retornado pela API do Mercado Livre Ads' : 'não consta nos números informados pela equipe'
  const metricas = [
    metrica('vendas_atribuidas', 'Vendas atribuídas aos anúncios', a.vendas ?? null, 'numero', 'Vendas que vieram de clique em anúncio patrocinado.', { variacao: v('vendas'), motivo: nd }),
    metrica('roas', 'ROAS', a.roas ?? null, 'numero', 'Quanto cada R$ 1 investido em anúncios trouxe de vendas (receita atribuída ÷ investimento).', { variacao: v('roas'), motivo: nd }),
    metrica('receita_atribuida', 'Receita atribuída aos anúncios', a.receita ?? null, 'moeda', 'Valor vendido que o Mercado Livre atribui aos anúncios.', { variacao: v('receita'), motivo: nd }),
    metrica('investimento', 'Investimento em anúncios', a.investimento ?? null, 'moeda', 'Quanto foi gasto em anúncios no período.', { motivo: nd }),   // sem delta: gastar mais não é bom nem ruim por si
    metrica('acos', 'ACOS', a.acos ?? null, 'pct', 'Parte da venda atribuída que foi gasta em anúncios (investimento ÷ receita atribuída). Menor é melhor.', { variacao: v('acos', { invertido: true }), extra: true, motivo: nd }),
    metrica('tacos', 'TACOS', a.tacos ?? null, 'pct', 'Quanto do faturamento TOTAL da conta foi gasto em anúncios (investimento ÷ faturamento total). Menor é melhor.', { variacao: v('tacos', { invertido: true }), extra: true, motivo: negocio?.atual || manual?.faturamento != null ? nd : 'depende do faturamento total, indisponível' }),
    metrica('impressoes', 'Impressões', a.impressoes ?? null, 'numero', 'Quantas vezes os anúncios apareceram.', { variacao: v('impressoes'), extra: true, motivo: nd }),
    metrica('cliques', 'Cliques', a.cliques ?? null, 'numero', 'Quantas vezes clicaram nos anúncios.', { variacao: v('cliques'), extra: true, motivo: nd }),
    metrica('ctr', 'CTR', a.ctr ?? null, 'pct', 'De cada 100 aparições, quantas viraram clique (cliques ÷ impressões).', { variacao: v('ctr', { pontos: true }), extra: true, motivo: nd }),
    metrica('cpc', 'CPC', a.cpc ?? null, 'moeda', 'Custo médio de cada clique (investimento ÷ cliques). Menor é melhor.', { variacao: v('cpc', { invertido: true }), extra: true, motivo: nd }),
  ]
  const motivo = fonte ? null
    : ads?.atual && !ads.atual.disponivel && ads.atual.motivo
      ? (MOTIVO_ADS_CLIENTE.test(ads.atual.motivo) ? ads.atual.motivo : 'Dados de anúncios indisponíveis nesta semana; os números não foram estimados.')
    : falhou ? 'O Mercado Livre não respondeu na geração deste relatório; os números não foram estimados.'
    : semanaIgnorada ? `Os números informados pela equipe são de outra semana (semana de ${br(semanaIgnorada)}) e não foram usados.`
    : !conectado ? 'Conta do Mercado Livre ainda não conectada ao relatório e nenhum dado de Ads foi informado pela equipe nesta semana.'
    : 'Sem dados de Ads para o período.'
  return { canal: 'Mercado Livre Ads', fonte, disponivel: !!fonte, motivo, aviso: man ? avisoDeclarado(perMan, 'informados pela equipe') : null, metricas, acoes: acoes || [] }
}

// um item por canal presente nas tarefas do cliente (exceto ML) + canais que a equipe transcreveu em config/metricas-semanais.json → canais.
// Dado informado vale só se o período declarado cobrir a maior parte do relatório (periodoManual, mesma regra do ML); sem semana_de vale sempre.
function blocosOutros({ tarefas, concluidas, evPorTarefa, ehMetrica, canaisManuais, de, ate }) {
  const manuais = {}
  for (const [k, x] of Object.entries(canaisManuais || {})) { const c = canalDe(k) || k; if (c !== 'Mercado Livre' && x && typeof x === 'object') manuais[c] = x }
  const canais = [...new Set([...tarefas.map(t => canalDe(t.processo)).filter(c => c && c !== 'Mercado Livre'), ...Object.keys(manuais)])]
    .sort((x, y) => (CANAIS_CONHECIDOS.indexOf(x) + 1 || 99) - (CANAIS_CONHECIDOS.indexOf(y) + 1 || 99) || x.localeCompare(y))
  return canais.map(canal => {
    const raw = manuais[canal], per = raw ? periodoManual(raw, de, ate) : null, valido = !!per, d = valido ? raw : {}
    const nd = 'não informado pela equipe nesta semana'
    const metricas = [
      metrica('faturamento', 'Faturamento', num(d.faturamento), 'moeda', 'Total vendido no período.', { motivo: nd }),
      metrica('vendas', 'Vendas', num(d.vendas), 'numero', 'Quantidade de pedidos pagos.', { motivo: nd }),
      metrica('unidades', 'Unidades vendidas', num(d.unidades), 'numero', 'Quantidade de produtos vendidos.', { motivo: nd }),
      metrica('ticket_medio', 'Ticket médio', num(d.ticket_medio), 'moeda', 'Valor médio de cada venda (faturamento ÷ vendas).', { motivo: nd }),
      metrica('visitas', 'Visitas', num(d.visitas), 'numero', 'Quantas vezes os anúncios foram abertos por compradores.', { motivo: nd }),
      metrica('conversao', 'Conversão', num(d.conversao), 'pct', 'De cada 100 visitas, quantas viraram venda (vendas ÷ visitas).', { motivo: nd }),
    ]
    if (valido && d.ads && typeof d.ads === 'object') metricas.push(
      metrica('ads_investimento', 'Investimento em anúncios', num(d.ads.investimento), 'moeda', 'Quanto foi gasto em anúncios no período.', { motivo: nd }),
      metrica('ads_receita', 'Receita atribuída aos anúncios', num(d.ads.receita), 'moeda', 'Valor vendido atribuído aos anúncios.', { motivo: nd }),
      metrica('ads_roas', 'ROAS', num(d.ads.roas), 'numero', 'Quanto cada R$ 1 investido em anúncios trouxe de vendas (receita atribuída ÷ investimento).', { motivo: nd }),
      metrica('ads_acos', 'ACOS', num(d.ads.acos), 'pct', 'Parte da venda atribuída gasta em anúncios (investimento ÷ receita atribuída). Menor é melhor.', { extra: true, motivo: nd }))
    const doCanal = concluidas.filter(t => canalDe(t.processo) === canal)
    const evidencias = doCanal.flatMap(t => (evPorTarefa[t.id] || []).filter(e => ehMetrica(t, e)))   // só prints de PAINEL do canal (ehPainel), não de ação
    const informado = metricas.some(m => m.valor != null)
    const fonte = informado ? 'manual' : evidencias.length ? 'print' : null
    const motivo = fonte === 'manual' ? null
      : fonte === 'print' ? 'Sem integração automática com o canal; os números do período estão no print do painel, disponível no card do Notion.'
      : raw && !valido ? `Os números informados pela equipe são de outra semana (semana de ${br(raw.semana_de)}) e não foram usados.`
      : `A Place2u ainda não tem integração automática com ${canal}, e nenhum dado foi informado pela equipe nesta semana.`
    return { canal, tem_api: false, fonte, motivo, aviso: fonte === 'manual' ? avisoDeclarado(per, 'informados pela equipe') : null, metricas, evidencias, acoes_semana: doCanal.length }
  })
}

// `parcial` = { ate_hora:'HH:MM' } quando o período inclui o dia de hoje (incompleto) — o render não diz "de mesma duração"
export function montarResultados({ de, ate, conectado = false, falhou = false, negocio = null, ads = null, manual = null, semanaIgnorada = null, parcial = null,
  anteriorManual = null, canaisManuais = null, tarefas = [], concluidas = [], evPorTarefa = {}, ehMetrica = () => false, acoesAds = [], destaques = [], acoesRelacionadas = [] }) {
  return {
    periodo: { de, ate }, periodo_parcial: parcial?.ate_hora ? { ate_hora: parcial.ate_hora } : null,
    anterior: negocio?.janela_anterior || (anteriorManual?.de ? { de: anteriorManual.de, ate: anteriorManual.ate } : null),
    ml: blocoMl({ de, ate, conectado, falhou, negocio, manual, semanaIgnorada, anteriorManual }),
    ads: blocoAds({ de, ate, conectado, falhou, ads, negocio, manual, semanaIgnorada, acoes: acoesAds }),
    outros: blocosOutros({ tarefas, concluidas, evPorTarefa, ehMetrica, canaisManuais, de, ate }),
    destaques, acoes_relacionadas: acoesRelacionadas,
  }
}

// Sempre existe algo positivo numa semana — o relatório busca ativamente por
// isso (em vez de só listar números) e liga cada melhora às ações que a
// equipe executou no mesmo período. Nunca afirma causa e efeito com certeza:
// apresenta a métrica que melhorou ao lado do que foi feito, para o cliente
// ligar os pontos — mas sempre com o lado positivo na frente.
export function montarDestaques({ negocioComp, adsComp, otimizacoes = [], acoes = [] }) {
  const candidatos = []
  const add = (rotulo, d) => { if (d?.bom) candidatos.push({ rotulo, delta: d }) }
  const n = negocioComp?.atual, np = negocioComp?.anterior
  if (n && np) {
    add('Faturamento', delta(n.faturamento, np.faturamento))
    add('Unidades vendidas', delta(n.unidades, np.unidades))
    add('Quantidade de vendas', delta(n.vendas, np.vendas))
    add('Preço médio por venda', delta(n.preco_medio_venda, np.preco_medio_venda))
    if (n.visitas != null && np.visitas != null) add('Visitas', delta(n.visitas, np.visitas))
    if (n.conversao != null && np.conversao != null) add('Conversão', delta(n.conversao, np.conversao, { pontos: true }))
    // cancelamento/devolução só é "melhora" como TAXA sobre as vendas e com amostra mínima:
    // em número absoluto, cair porque as vendas caíram seria apresentado como vitória
    const taxa = (x, v) => (x != null && v >= 10 ? 100 * x / v : null)
    add('Taxa de cancelamento', delta(taxa(n.vendas_canceladas, n.vendas), taxa(np.vendas_canceladas, np.vendas), { invertido: true, pontos: true }))
    if (n.vendas_devolvidas != null && np.vendas_devolvidas != null) add('Taxa de devolução', delta(taxa(n.vendas_devolvidas, n.vendas), taxa(np.vendas_devolvidas, np.vendas), { invertido: true, pontos: true }))
  }
  const a = adsComp?.atual, ap = adsComp?.anterior
  if (a?.disponivel && ap?.disponivel) {
    add('ROAS dos anúncios', delta(a.roas, ap.roas))
    add('Receita atribuída a Ads', delta(a.receita, ap.receita))
    add('Vendas atribuídas a Ads', delta(a.vendas_atribuidas, ap.vendas_atribuidas))
    add('ACOS', delta(a.acos, ap.acos, { invertido: true }))
  }
  candidatos.sort((x, y) => Math.abs(y.delta.valor) - Math.abs(x.delta.valor))

  // os destaques vêm só da API do Mercado Livre: ação de outro canal (Amazon, Shopee...) não é "executada no mesmo período" ao lado deles
  const doMl = [...otimizacoes, ...acoes].filter(x => canalDe(x.processo) === 'Mercado Livre')
  const acoesPeriodo = [...new Map(doMl.map(x => [x.titulo, x.titulo])).values()]
  return { destaques: candidatos.slice(0, 5), acoes_relacionadas: acoesPeriodo.slice(0, 8) }
}

// ── VOLUME DE ATIVIDADES ─────────────────────────────────────────────────
const nomesDe = txt => [...new Set(String(txt || '').split(/[,;/]|\s+e\s+/i).map(x => x.replace(/\s+/g, ' ').trim()).filter(x => x && x !== '—'))]
export function volumeAtividades({ de, ate, concluidas = [], concluidasAnterior = 0, abertas = [], atrasadas = [], bloqueadas = [], dependencias = [], otimizacoes = 0, acoesAds = 0, evPorTarefa = {} }) {
  const porCanal = {}, equipe = {}
  for (const t of concluidas) {
    const c = canalDe(t.processo) || t.processo || 'Sem canal'
    porCanal[c] = (porCanal[c] || 0) + 1
    for (const nome of nomesDe(t.responsavel)) equipe[nome] = (equipe[nome] || 0) + 1
  }
  const ordenar = (obj, chave) => Object.entries(obj).map(([k, n]) => ({ [chave]: k, n })).sort((a, b) => b.n - a.n || a[chave].localeCompare(b[chave]))
  const comEv = concluidas.filter(t => (evPorTarefa[t.id] || []).length).length
  return {
    periodo: { de, ate },
    concluidas: { atual: concluidas.length, anterior: concluidasAnterior, pct: deltaPct(concluidas.length, concluidasAnterior) },
    por_canal: ordenar(porCanal, 'canal'),
    otimizacoes, acoes_ads: acoesAds,
    em_andamento: abertas.filter(t => ['andamento', 'validacao'].includes(t.status)).length,
    atrasadas: atrasadas.length, bloqueadas: bloqueadas.length,
    depende_cliente: dependencias.length,                          // aguardando um retorno do cliente: fora de abertas, atrasadas e bloqueadas
    com_evidencia: { n: comEv, de: concluidas.length, pct: concluidas.length ? Math.round(100 * comEv / concluidas.length) : null },
    equipe: ordenar(equipe, 'nome'),
  }
}

// ── TAREFAS QUE GERARAM RESULTADO ────────────────────────────────────────
const janelaDe = pre => pre?.length === 2 ? diasEntre(pre[0], pre[1]) + 1 : null
const limpo = s => { const x = String(s || '').trim(); return /^[\s\-–—.]*$|^(n\/?a|nenhum|não se aplica)\.?$/i.test(x) ? '' : x }
const corta = (s, n = 300) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
const FAT_PADRAO = { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita' }

// Métrica da tarefa MEDIDA conforme o OBJETIVO do cliente. Lê os campos reais de analisarCliente (impacto-tarefas.js):
// metricas.{unidades,receita,visitas,conversao}.{antes,depois} (médias por dia), efeito_pct (ajustado pelo controle),
// receita_alocada (estimativa em R$, dividida entre tarefas sobrepostas), receita_estimavel, lancamento.{unidades,receita,visitas}.
function metricaDoObjetivo(m, metricaObj, suf, margemPct) {
  const lanc = m.estado === 'lancamento', L = m.lancamento || {}
  const rec = lanc ? (m.receita_alocada > 0 ? m.receita_alocada : (L.receita > 0 ? L.receita : null))
    : (m.receita_estimavel !== false && m.receita_alocada > 0 ? m.receita_alocada : null)
  const prim = m.metrica_primaria === 'visitas' ? 'visitas' : 'unidades vendidas'
  const efeito = (nota = '') => lanc ? { rotulo: 'Anúncio que passou a vender', texto: `${L.unidades} un. vendidas em ${m.dias_pos} dias`, nota }
    : { rotulo: `Efeito em ${prim} (${suf})`, texto: `${sg(m.efeito_pct)} ajustado pelo restante da conta`, nota }
  const faturamento = (rotulo, nota = '') => lanc
    ? { rotulo: 'Faturamento do anúncio que passou a vender', texto: rec ? `${brl0(rec)} em ${L.unidades} un. (${m.dias_pos} dias medidos)` : `${L.unidades} un. vendidas (${m.dias_pos} dias medidos)`, nota }
    : rec ? { rotulo, texto: `+ ${brl0(rec)}`, nota: nota || 'Estimativa nos dias medidos; tarefas sobrepostas no mesmo anúncio dividem o valor.' }
    : efeito(nota || 'Sem estimativa em R$ para esta tarefa (anúncio sem vendas anteriores suficientes para converter o efeito em reais).')
  // "causa provável" só para o efeito MEDIDO com controle (métrica primária); visitas/conversão brutas (antes × depois, sem
  // controle) saem como "variação observada, não ajustada" — e se caíram, não viram resultado: mostra o que foi medido
  const BRUTA = 'variação observada, não ajustada'
  switch (metricaObj) {
    case 'visitas': {
      const vis = m.metricas?.visitas
      if (!vis) return faturamento(`Faturamento adicional (${suf})`, 'Visitas não medidas para este anúncio; mostrando o que foi medido.')
      if (!(vis.depois > vis.antes)) return faturamento(`Faturamento adicional (${suf})`, 'Visitas sem alta medida para este anúncio; mostrando o que foi medido.')
      const ajustada = !lanc && m.metrica_primaria === 'visitas'
      return { rotulo: lanc ? 'Visitas do anúncio que passou a vender' : `Visitas por dia (${ajustada ? suf : BRUTA})`,
        texto: `de ${f1(vis.antes)} para ${f1(vis.depois)} visitas/dia${ajustada ? ` · ${sg(m.efeito_pct)} ajustado pelo restante da conta` : ''}`, nota: '' }
    }
    case 'conversao': {
      const c = m.metricas?.conversao
      if (c && !(c.depois > c.antes)) return faturamento(`Faturamento adicional (${suf})`, 'Conversão sem alta medida para este anúncio; mostrando o que foi medido.')
      if (c) return { rotulo: `Conversão (${BRUTA})`, texto: `de ${f1(c.antes)}% para ${f1(c.depois)}% (${sg(c.depois - c.antes, ' ponto(s)')})`, nota: '' }
      if (lanc && L.visitas > 0) return { rotulo: 'Conversão do anúncio que passou a vender', texto: `${f1(100 * L.unidades / L.visitas)}% (${L.unidades} vendas em ${L.visitas} visitas)`, nota: '' }
      return faturamento(`Faturamento adicional (${suf})`, 'Conversão não medida para este anúncio (faltam visitas); mostrando o que foi medido.')
    }
    case 'ads':
      return lanc ? faturamento('') : rec ? { rotulo: `Vendas do anúncio após o ajuste de Ads (${suf})`, texto: `+ ${brl0(rec)}`, nota: 'O retorno dos anúncios (ROAS) é medido no nível da conta — veja o bloco ADS; aqui só o efeito nas vendas do anúncio.' }
        : efeito('O retorno dos anúncios (ROAS) é medido no nível da conta — veja o bloco ADS; aqui só o efeito nas vendas do anúncio.')
    case 'margem':
      return rec && !lanc ? { rotulo: `Margem adicional estimada (${suf})`, texto: `+ ${brl0(rec * margemPct / 100)}`,
        nota: `Estimativa: ${brl0(rec)} de faturamento associado × margem de contribuição de ${f1(margemPct)}% informada para esta conta (antes de despesas fixas e Ads).` }
        : lanc && rec ? { rotulo: 'Margem do anúncio que passou a vender (estimada)', texto: `${brl0(rec * margemPct / 100)} (${brl0(rec)} × ${f1(margemPct)}% informada)`, nota: 'Antes de despesas fixas e Ads.' } : efeito()
    case 'lancamentos':
      return { rotulo: m.subtipo === 'reativado' ? 'Anúncio reativado que voltou a vender' : 'Anúncio novo que passou a vender',
        texto: `${L.unidades} un.${L.receita > 0 ? ` · ${brl0(L.receita)}` : ''} em ${m.dias_pos} dias`, nota: '' }
    default: return faturamento(`Faturamento adicional (${suf})`)
  }
}

function itemMedido(m, t, metricaObj, margemPct, ev, linksDe) {
  const lanc = m.estado === 'lancamento'
  const sc = m.confianca?.score
  const confianca = sc != null ? { nivel: sc >= 80 ? 'alta' : sc >= 60 ? 'media' : 'baixa', pct: Math.round(sc) } : null
  // preço mexendo junto na janela (impacto-tarefas.marcarPreco): a medida saiu do aprendizado — para o cliente, nunca "causa provável"
  const suf = !lanc && (!confianca || confianca.nivel === 'baixa' || m.confundido_preco) ? 'hipótese — confiança baixa' : 'causa provável'
  const mt = metricaDoObjetivo(m, metricaObj, suf, margemPct)
  const N = m.janela_usada ?? janelaDe(m.janelas?.pre) ?? '—'
  const L = m.lancamento || {}
  const resumo = (lanc
    ? `O anúncio quase não vendia nos ${N} dias antes da tarefa e vendeu ${L.unidades} un. nos ${m.dias_pos} dias medidos depois. Observação direta, sem grupo de controle.`
    : `Efeito medido em ${m.metrica_primaria === 'visitas' ? 'visitas' : 'unidades vendidas'}: ${sg(m.efeito_pct)} nos ${m.dias_pos} dias após a conclusão (+${m.lag} de defasagem), já descontada a variação dos demais anúncios da conta. ${suf === 'causa provável' ? 'Causa provável, não prova.' : 'Associação fraca: não trate como causa.'}`)
    + (m.reversao_provavel ? ' Atenção: parte da variação pode ser retorno ao nível habitual do anúncio.' : '')
    + (m.confundido_preco ? ` Atenção: o preço variou${m.variacao_preco_pct != null ? ' ' + sg(m.variacao_preco_pct) : ''} na janela; parte do efeito pode ser do preço.` : '')
    + (m.concorrentes ? ` Havia ${m.concorrentes} outra(s) tarefa(s) no mesmo alvo e período.` : '')
    + (mt.nota ? ' ' + mt.nota : '')
  const metodo = lanc
    ? `Observação direta das vendas do anúncio: quase sem vendas nos ${N} dias antes da conclusão e ${L.unidades} un. nos ${m.dias_pos} dias medidos depois (defasagem de ${m.lag} dia(s)). Sem grupo de controle — mostra que o anúncio passou a vender, não prova que a tarefa foi a causa.`
    : `Comparação dos ${N} dias antes com os ${m.dias_pos} dias medidos depois da conclusão (defasagem de ${m.lag} dia(s) para o Mercado Livre reindexar), ajustada pelo comportamento de anúncios da mesma conta que nenhuma tarefa tocou no período (grupo de controle) e testada contra as oscilações normais da própria conta. É associação temporal, não causalidade provada.`
  const links = [...linksDe(t, ev), ...(m.itens || []).map(i => /^MLB(\d+)$/.exec(i)).filter(Boolean).map(x => ({ url: `https://produto.mercadolivre.com.br/MLB-${x[1]}`, rotulo: 'Mercado Livre' }))]
  return {
    id: t.id, titulo: t.titulo, canal: canalDe(t.processo) || t.processo || '', responsavel: t.responsavel || '—', concluida_em: m.data, url: t.url || '',
    tipo: 'medido', metrica: { rotulo: mt.rotulo, texto: mt.texto }, resumo, confianca,
    metodo: metodo + (m.data_estimada ? ' Data de conclusão estimada (campo "Concluído em" vazio no card).' : ''),
    evidencias: ev, links: [...new Map(links.map(l => [l.url, l])).values()].slice(0, 6),
    peso: [m.receita_alocada || 0, confianca?.pct ?? 0],      // só para ordenar; removido antes de devolver
  }
}

export function tarefasComResultado({ objetivo, objetivos = [], ate, janelaDias = 45, tarefas = [], medidas = null, erroMedicao = null, evPorTarefa = {}, linksDe = () => [], margemPct = null }) {
  let obj = objetivo, notaObj = ''
  if (objetivo.id === 'margem' && !(margemPct > 0)) {       // margem exige custo informado; sem ele, faturamento + aviso honesto
    obj = objetivos.find(o => o.id === 'faturamento') || FAT_PADRAO
    notaObj = margemPct == null ? "O objetivo 'margem' exige custos informados para esta conta (ainda não há); mostrando o faturamento."
      : "Os custos informados deixam a margem de contribuição em zero ou negativa — não há margem adicional a estimar; mostrando o faturamento."
  }
  const mo = obj.metrica, inicio = addDias(ate, -(janelaDias - 1))
  const porId = new Map(tarefas.map(t => [t.id, t]))
  const doObjetivo = (t, texto) => mo === 'ads' ? RX_ADS.test(texto) : mo === 'lancamentos' ? RX_LANC.test(texto) : true   // ads/lançamentos: só as tarefas desse tema

  const itens = [], cont = { sem_efeito: 0, em_maturacao: 0, piorou: 0, nao_medidas: 0 }
  // tarefa cuja medição deu NÃO positiva (piorou, sem efeito, lançamento que não vendeu) nunca vira resultado, nem como "informado"
  const naoPositiva = new Set((medidas || []).filter(m => m.estado === 'piorou' || m.estado === 'sem_efeito' || (m.estado === 'lancamento' && !m.lancamento?.vendeu)).map(m => m.id))
  for (const m of medidas || []) {
    const t = porId.get(m.id)
    if (!t || !dentro(m.data, inicio, ate)) continue          // só tarefas que o cliente pode ver, concluídas na janela
    const lancTema = m.estado === 'lancamento' || (m.estado === 'em_maturacao' && m.lancamento)
    if (mo === 'lancamentos' ? !lancTema : mo === 'ads' ? !RX_ADS.test(`${m.titulo} ${m.tipo} ${t.processo} ${t.descricao}`) : false) continue
    if (m.estado === 'melhorou' || (m.estado === 'lancamento' && m.lancamento?.vendeu))
      itens.push(itemMedido(m, t, mo, margemPct, evPorTarefa[t.id] || [], linksDe))
    else if (m.estado === 'sem_efeito' || m.estado === 'lancamento') cont.sem_efeito++       // lançamento que não vendeu = sem efeito
    else if (m.estado === 'em_maturacao') cont.em_maturacao++
    else if (m.estado === 'piorou') cont.piorou++                                           // contado (uso interno), nunca listado como resultado
    else cont.nao_medidas++                                                                 // sem_base / sem_controle / variacao_conta
  }
  for (const t of tarefas) {
    if (t.status !== 'concluida' || !dentro(t.data_conclusao, inicio, ate) || naoPositiva.has(t.id)) continue
    const resultado = limpo(t.resultado_alcancado), impacto = limpo(t.impacto), texto = resultado || impacto
    if (!texto || !doObjetivo(t, `${t.titulo} ${t.tipo_demanda || ''} ${t.processo} ${t.descricao}`)) continue
    const ev = evPorTarefa[t.id] || []
    itens.push({
      id: t.id, titulo: t.titulo, canal: canalDe(t.processo) || t.processo || '', responsavel: t.responsavel || '—', concluida_em: t.data_conclusao, url: t.url || '',
      tipo: 'informado', metrica: { rotulo: resultado ? 'Resultado informado pela equipe' : 'Impacto informado pela equipe', texto: corta(texto) },
      resumo: resultado && impacto && impacto !== resultado ? `Impacto informado: ${corta(impacto)}` : 'Informado pela equipe no card; não foi medido pelo sistema.',
      confianca: null, metodo: 'Informado pela equipe nos campos do card (resultado alcançado / impacto); não medido pelo sistema.',
      evidencias: ev, links: linksDe(t, ev), peso: [0, 0],
    })
  }
  // medidos primeiro (maior R$ associado, depois maior confiança), informados por data
  itens.sort((a, b) => (a.tipo === 'informado') - (b.tipo === 'informado') || (a.tipo === 'medido' ? b.peso[0] - a.peso[0] || b.peso[1] - a.peso[1] : 0) || (b.concluida_em || '').localeCompare(a.concluida_em || ''))
  for (const it of itens) delete it.peso

  const contagens = [
    cont.sem_efeito && `${cont.sem_efeito} tarefa(s) medida(s) sem efeito distinguível das oscilações normais`,
    cont.em_maturacao && `${cont.em_maturacao} ainda sem prazo suficiente para medir`,
    cont.nao_medidas && `${cont.nao_medidas} sem base para medir (histórico curto, sem grupo de controle ou sem anúncio citado)`,
  ].filter(Boolean)
  const partes = []
  if (notaObj) partes.push(notaObj)
  if (erroMedicao) partes.push('A medição automática não pôde ser calculada nesta geração; só aparecem resultados informados pela equipe.')
  else if (medidas == null) partes.push('Sem histórico de vendas do Mercado Livre para medir o efeito das tarefas; só aparecem resultados informados pela equipe.')
  if (!itens.length) partes.unshift(`Nenhuma tarefa concluída nos últimos ${janelaDias} dias tem resultado medido ou informado.`)
  if (contagens.length) partes.push(`${itens.length ? 'Lista parcial — além dos itens acima: ' : 'Das tarefas avaliadas: '}${contagens.join('; ')}.`)
  if (!itens.length || contagens.length) partes.push('Resultado medido só existe para tarefas do Mercado Livre com o anúncio (MLB) citado no card; nos demais casos aparece apenas o que a equipe informou.')
  return { objetivo: { id: obj.id, rotulo: obj.rotulo, metrica: obj.metrica }, ...(obj.id !== objetivo.id ? { objetivo_pedido: objetivo.id } : {}), itens,
    sem_efeito: cont.sem_efeito, em_maturacao: cont.em_maturacao, piorou: cont.piorou, nota: partes.join(' ') }
}

// ── SITUAÇÃO DA CONTA (perfil ansioso): só fatos; 'ok' somente com 0 atrasadas e 0 bloqueadas — dependência do cliente NÃO muda o nível ──
export function situacaoDaConta({ atrasadas = [], bloqueadas = [], dependencias = [], plano = null, hoje }) {
  const vistos = new Set(), itens = []
  const prazo = t => t.prazo ? `prazo ${br(t.prazo)}${hoje && t.prazo < hoje ? ` (${diasEntre(t.prazo, hoje)} dia(s) de atraso)` : ''}` : 'sem prazo definido'
  for (const t of bloqueadas) {
    vistos.add(t.id)
    itens.push({ texto: `${t.titulo} — bloqueada${t.bloqueio ? `: ${t.bloqueio}` : ''} · responsável: ${t.responsavel || '—'} · ${prazo(t)}`, tom: 'atencao' })
  }
  const soAtrasadas = atrasadas.filter(t => !vistos.has(t.id))
  for (const t of soAtrasadas) itens.push({ texto: `${t.titulo} — atrasada · responsável: ${t.responsavel || '—'} · ${prazo(t)}`, tom: 'atencao' })
  if (dependencias.length) itens.push({ texto: `${dependencias.length} tarefa(s) aguardam um retorno seu — veja Pontos de atenção`, tom: 'atencao' })
  const nivel = bloqueadas.length || atrasadas.length ? 'atencao' : 'ok'
  itens.push({ texto: plano?.total ? `Plano de ${plano.anoMes}: ${plano.concluidas} de ${plano.total} ações concluídas (${plano.pct}%).` : `Plano de ${plano?.anoMes || 'este mês'}: nenhuma ação registrada até agora.`, tom: 'ok' })
  return {
    nivel,
    titulo: nivel === 'ok' ? 'Conta em dia — nenhuma ação atrasada ou bloqueada'
      : `${bloqueadas.length + soAtrasadas.length} ponto(s) pedem atenção — ${bloqueadas.length} bloqueada(s), ${soAtrasadas.length} atrasada(s)`,
    itens,
  }
}
