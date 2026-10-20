// Diagnóstico da conta (Mercado Livre) por anúncio — base do plano de ação por anúncio.
// Lê SÓ dados já coletados (série diária, anúncios, Ads por anúncio, visão do comprador): nenhuma chamada de API aqui.
// Todo achado carrega o tipo de evidência (fato / hipótese / pendente). Dado que a API não entrega
// (CTR orgânico, impressões orgânicas, custo/margem, perguntas) vira PENDENTE declarado, nunca estimativa silenciosa.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal, agora } from './db.js'
import { ROOT } from './env.js'
import { addDias, diasEntre, cfgAtrib, coberturaPedidos, qualidadeNoIntervalo } from './meli-serie.js'
import { velocidadePonderada, serieDiaria, tendencia, causalidadeVendas, somaJanela } from './motor-ppc.js'
import { historico } from './preco-historico.js'
import { vinculosCusto, pendenciasCustos } from './custos-db.js'
import { origemCatalogo } from './catalogo.js'
import { criarCatalogo } from './catalogo-db.js'
import { lerSaude, CFG_SAUDE } from './saude-coleta.js'
import { criarLeadTime } from './lead-time.js'
import { eventoDoItem } from './compras-previsao.js'
import { financeiroDoCliente } from './lucro-real.js'
import { economiaReal } from './lucro.js'
import { aplicarProduto, estoqueDe } from './produto-estoque.js'
import { grafoDoCliente } from './produto-estoque-real.js'
const SAUDE_TEXTOS = CFG_SAUDE.pendente

export const algoritmo = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8'))
// mesmo corte de dias sem coleta das métricas da série no motor (diagnostico-motor.js → MAX_SEM_COLETA), lido da mesma chave;
// ponytail: lê o JSON direto porque retroalimentacao.js importa este módulo (importar cfgRetro daria ciclo)
const MAX_SEM_COLETA = JSON.parse(readFileSync(join(ROOT, 'config', 'retroalimentacao.json'), 'utf-8')).estado?.max_dias_sem_coleta ?? 3
const catalogoDb = criarCatalogo(db)
const leadTimes = criarLeadTime(db)            // prazo de reposição informado (v1.6.0): vence a premissa lead_time_reposicao_dias por anúncio > SKU > conta toda
const L = algoritmo.limiares, F = algoritmo.foco
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100
// percentuais/razões: arredondar nunca cria zero — valor ≠ 0 que sumiria guarda 2 algarismos significativos (0,0027% fica 0.0027); zero medido segue 0
const semZero = f => n => { const a = f(n); return a === 0 && n !== 0 && Number.isFinite(n) ? Number(n.toPrecision(2)) : a }
const p1 = semZero(r1), p2 = semZero(r2)
// percentual no TEXTO (participação, conversão, CTR, TACOS, margem, gap em p.p.), sem o "%": de 1 em diante 1 casa; abaixo de 1, 2 algarismos significativos —
// nunca imprime 0 para valor ≠ 0 nem iguala dois valores diferentes na mesma frase (0,04 contra 0,02, não "< 0,1 contra < 0,1"); zero medido segue "0"
export const pctTxt = x => x == null ? '—' : String(Math.abs(x) >= 1 ? r1(x) : Number(x.toPrecision(2))).replace('.', ',')
const brl = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dm = d => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : ''
// série de visitas do anúncio cobre a janela [de, ate]: começa até `de` e foi coletada até a véspera do último dia (vis_ate = dia da coleta, que vem parcial;
// os dias depois dele somam zero e inflariam a conversão). Tolera UMA coleta diária perdida (madrugada antes da coleta, máquina dormindo) — o mesmo critério
// de Mais vendidos (gmv.js), do acompanhamento e do impacto por tarefa (vis_ate ≥ hoje − 2). ponytail: no pior caso ~2 de 28 dias de visitas a menos (~7%)
export const visitasCobrem = (i, de, ate) => !!i.vis_de && i.vis_de <= de && !!i.vis_ate && i.vis_ate >= addDias(ate, -1)
// mudanças do anúncio que tiram um anúncio do grupo de CONTROLE das regras de queda (conversão/visitas): preço, título, fotos e capa
export const CAMPOS_MUDANCA_CONTROLE = ['preco', 'titulo', 'fotos', 'thumb']

// ── custos informados (ROAS alvo e desconto máximo só existem com eles) ─────
export function custosDoCliente(cliente) {
  const r = db.prepare('SELECT custos_json FROM custos_cliente WHERE cliente = ?').get(cliente)
  const c = r ? JSON.parse(r.custos_json) : null
  if (!c) return null
  const num = k => Number.isFinite(Number(c[k])) ? Number(c[k]) : null
  const v = { cmv_pct: num('cmv_pct'), imposto_pct: num('imposto_pct'), comissao_pct: num('comissao_pct'), frete_pct: num('frete_pct'), embalagem_pct: num('embalagem_pct'), outros_pct: num('outros_pct'), margem_desejada_pct: num('margem_desejada_pct') }
  return v.cmv_pct != null && v.comissao_pct != null && v.imposto_pct != null ? v : null   // mínimo: CMV, comissão e imposto
}
// margem de contribuição estimada do anúncio num preço: CMV = custo do próprio anúncio (vínculo custo ↔ anúncio) quando existe, senão o CMV% da conta;
// comissão, imposto, frete, embalagem e outros só dos percentuais da conta (nenhuma alíquota presumida: sem eles, null)
export function margemPct(custos, preco, custoUnit = null) {
  if (!custos || !(preco > 0)) return null
  const cmv = custoUnit != null ? 100 * custoUnit / preco : custos.cmv_pct
  return p1(100 - cmv - ['imposto_pct', 'comissao_pct', 'frete_pct', 'embalagem_pct', 'outros_pct'].reduce((t, k) => t + (custos[k] || 0), 0))
}
export function economiaAds(custos) {
  if (!custos) return null
  const gasto = ['cmv_pct', 'imposto_pct', 'comissao_pct', 'frete_pct', 'embalagem_pct', 'outros_pct'].reduce((t, k) => t + (custos[k] || 0), 0)
  const margemPre = p1(100 - gasto), desejada = custos.margem_desejada_pct ?? 0      // p1: margem de 0,04% não vira 0 (que a regra leria como "sem margem")
  const acosBreakeven = margemPre, acosMax = p1(margemPre - desejada)
  return {
    margem_pre_ads_pct: margemPre, acos_breakeven_pct: acosBreakeven, roas_breakeven: margemPre > 0 ? r2(100 / margemPre) : null,
    margem_desejada_pct: desejada, acos_max_pct: acosMax, roas_alvo: acosMax > 0 ? r2(100 / acosMax) : null,
    viavel: acosMax > 0,
    nota: acosMax > 0 ? 'ROAS alvo preserva a margem desejada; contribuição ainda não é lucro líquido (despesas fixas).' : 'ACOS permitido ≤ 0: a oferta precisa ser revista antes de qualquer Ads.',
  }
}
// desconto máximo que preserva a margem mínima: custos "fixos por unidade" (CMV, embalagem, frete, outros) não caem com o preço
export function descontoMaximoPct(custos, margemMinPct = null) {
  if (!custos) return null
  const m = (margemMinPct ?? custos.margem_desejada_pct ?? 0) / 100
  const variavel = ((custos.comissao_pct || 0) + (custos.imposto_pct || 0)) / 100
  const fixo = ((custos.cmv_pct || 0) + (custos.embalagem_pct || 0) + (custos.frete_pct || 0) + (custos.outros_pct || 0)) / 100
  const folga = 1 - variavel - m
  return folga > 0 ? Math.max(0, r1((1 - fixo / folga) * 100)) : 0
}

// ── base por anúncio: 28 dias atuais × 28 anteriores ────────────────────────
export function carregarBase(cliente, { hoje = hojeLocal(), dias = 28 } = {}) {
  const ate = addDias(hoje, -1), de = addDias(ate, -(dias - 1)), anteAte = addDias(de, -1), anteDe = addDias(anteAte, -(dias - 1))
  const itens = db.prepare('SELECT * FROM meli_item WHERE cliente = ?').all(cliente)
  const agg = new Map(db.prepare(`SELECT item_id,
      SUM(CASE WHEN dia BETWEEN @de AND @ate THEN unidades ELSE 0 END) u, SUM(CASE WHEN dia BETWEEN @de AND @ate THEN receita ELSE 0 END) r, SUM(CASE WHEN dia BETWEEN @de AND @ate THEN visitas ELSE 0 END) v,
      SUM(CASE WHEN dia BETWEEN @ad AND @aa THEN unidades ELSE 0 END) u0, SUM(CASE WHEN dia BETWEEN @ad AND @aa THEN receita ELSE 0 END) r0, SUM(CASE WHEN dia BETWEEN @ad AND @aa THEN visitas ELSE 0 END) v0
    FROM meli_serie_item WHERE cliente = @c GROUP BY item_id`).all({ c: cliente, de, ate, ad: anteDe, aa: anteAte }).map(x => [x.item_id, x]))
  const ads = { atual: new Map(), anterior: new Map() }
  for (const a of db.prepare('SELECT * FROM meli_ads_item WHERE cliente = ?').all(cliente)) ads[a.periodo]?.set(a.item_id, a)
  // mudanças registradas no anúncio nos 28 dias (preço, título, fotos, capa — change-log meli_item_mudanca): quem mudou sai do controle das regras de queda;
  // a regra de preço usa só as de preço (1 centavo conta)
  const mud = historico.eventosAnuncio(cliente, { de, ate, campos: CAMPOS_MUDANCA_CONTROLE })
  const mudPreco = new Map()
  for (const [id, evs] of mud) { const p = evs.filter(e => e.campo === 'preco'); if (p.length) mudPreco.set(id, p) }
  // vendas por dia nos 56 dias: de cada anúncio que mudou de preço e a soma dos que não mudaram — a regra de preço compara antes × DEPOIS da data da alta
  // (no anúncio e no controle, nas mesmas datas), não 28d × 28d, que misturaria dias de antes da alta no "depois"
  const vendasDia = new Map(), vendasSemMudanca = {}, serieU = new Map(), de30 = addDias(ate, -29)
  for (const x of db.prepare('SELECT item_id, dia, unidades FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ? AND unidades > 0').all(cliente, anteDe, ate)) {
    if (x.dia >= de30) (serieU.get(x.item_id) || serieU.set(x.item_id, {}).get(x.item_id))[x.dia] = x.unidades     // unidades/dia dos últimos 30 d: velocidade ponderada e tendência por anúncio
    if (mudPreco.has(x.item_id)) (vendasDia.get(x.item_id) || vendasDia.set(x.item_id, {}).get(x.item_id))[x.dia] = x.unidades
    else vendasSemMudanca[x.dia] = (vendasSemMudanca[x.dia] || 0) + x.unidades
  }
  // custo por anúncio pela resolução única (manual > SKU igual > SKU normalizado > herdado), numa leitura só; sem ele, os percentuais da conta seguem como fallback
  const custoItem = vinculosCusto.custosDosAnuncios(cliente, itens.map(i => ({ item_id: i.item_id })))
  // prazo de reposição por anúncio: informado (anúncio > SKU > conta toda) ou a PREMISSA; o SKU vem da leitura das promoções (promo_anuncio), quando existe
  const leadDe = leadTimes.resolvedor(cliente)
  let skus = new Map(); try { skus = new Map(db.prepare("SELECT item_id, sku FROM promo_anuncio WHERE cliente = ? AND sku != ''").all(cliente).map(r => [r.item_id, r.sku])) } catch { skus = new Map() }
  const catCtx = catalogoDb.contexto(cliente)       // catálogo próprio × terceiros (marcação manual; sem marcação = terceiros): quem decide se foto/título/descrição entram nas recomendações
  const lista = []
  for (const i of itens) {
    const g = agg.get(i.item_id) || { u: 0, r: 0, v: 0, u0: 0, r0: 0, v0: 0 }
    if (!g.u && !g.u0 && !ads.atual.get(i.item_id)?.custo) continue         // sem venda nem Ads em 56 dias: fora do foco
    // série de visitas parada antes do fim inflaria a conversão — e o benchmark, que puxaria o ímã de OUTRO anúncio, e o controle das quedas
    const visOk = visitasCobrem(i, de, ate)
    const visao = i.visao_json ? JSON.parse(i.visao_json) : null
    const ad = ads.atual.get(i.item_id), ad0 = ads.anterior.get(i.item_id)
    let conv = visOk && g.v > 0 ? 100 * g.u / g.v : null
    const convInvalida = conv != null && conv > 100                         // visitas registradas em outro anúncio do mesmo produto
    if (convInvalida) conv = null
    const velDia = g.u / dias
    const lt = leadDe({ id: i.item_id, sku: skus.get(i.item_id) }) || { dias: L.lead_time_reposicao_dias, fonte: 'premissa' }, sU = serieU.get(i.item_id) || {}
    lista.push({
      id: i.item_id, titulo: i.titulo, permalink: i.permalink, thumb: i.thumb, preco: i.preco, estoque: i.estoque, fotos: i.fotos,
      frete_gratis: !!i.frete_gratis, catalogo: !!i.catalogo, catalogo_origem: origemCatalogo({ id: i.item_id, catalogo: i.catalogo }, catCtx), status: i.status, tipo_anuncio: i.tipo_anuncio, criado_em: i.criado_em,
      category_id: i.category_id || '',                                       // '' = ainda não coletada (anúncio gravado antes da coluna): cai no benchmark da conta
      u: g.u, r: r2(g.r), v: visOk ? g.v : null, u0: g.u0, r0: r2(g.r0), v0: visOk ? g.v0 : null, visOk,
      conv: conv == null ? null : p2(conv), conv_invalida: convInvalida,
      vel_dia: r2(velDia), cobertura: i.estoque != null && velDia > 0 ? Math.round(i.estoque / velDia) : null,
      // ponto de reposição (v1.6.0) = vendas/dia × (prazo de reposição + segurança): sem a segurança o Pistão 170 da Agrinorte (10 un, ~0,43/dia, 21 d) ficava fora do
      // próximo pedido (9 < 10). Prazo informado (lead_time_cliente) vence a premissa; − 1e-9: 12/28 × 28 em ponto flutuante não pode virar 13
      giro: i.estoque > 0 ? r2(g.u / i.estoque) : null, ponto_reposicao: velDia > 0 ? Math.ceil(g.u * (lt.dias + L.estoque_seguranca_dias) / dias - 1e-9) : null,
      lead_time_dias: lt.dias, lead_time_fonte: lt.fonte,                      // 'cliente' | 'equipe' | 'premissa'
      vel_pond: velocidadePonderada(sU, ate).velocidade, u14: somaJanela(sU, addDias(ate, -13), ate),   // previsão de compras (compras-previsao.js): ritmo recente e tendência 14 d × 28 d
      ads: ad ? { prints: ad.prints, clicks: ad.clicks, custo: r2(ad.custo), receita: r2(ad.receita), unidades: ad.unidades, ctr: ad.prints ? p2(100 * ad.clicks / ad.prints) : null, roas: ad.custo > 0 ? p2(ad.receita / ad.custo) : null, acos: ad.receita > 0 ? p2(100 * ad.custo / ad.receita) : null, status: ad.status } : null,
      ads_ant: ad0 ? { prints: ad0.prints, clicks: ad0.clicks, custo: r2(ad0.custo), receita: r2(ad0.receita), unidades: ad0.unidades, ctr: ad0.prints ? p2(100 * ad0.clicks / ad0.prints) : null, roas: ad0.custo > 0 ? p2(ad0.receita / ad0.custo) : null } : null,
      mudancas_28d: mud.get(i.item_id) || [],                                 // todos os eventos de preço/título/fotos/capa do período (as regras de queda leem as causas daqui)
      buy_box: ad?.buy_box == null ? null : !!ad.buy_box, logistica: ad?.logistica || '', nivel: ad?.nivel || '',
      avaliacoes: visao?.avaliacoes || null, ptw: visao?.catalogo ? { ...visao.catalogo, lido_em: String(i.visao_em || '').slice(0, 10) } : null,   // lido_em: data da leitura do price_to_win
      // preço: riscado ("de"), preço pago (receita ÷ unidades) 28d × 28d anteriores e as mudanças do preço de lista registradas no período
      preco_original: i.preco_original ?? null, preco_realizado_28d: g.u > 0 ? r2(g.r / g.u) : null, preco_realizado_ant: g.u0 > 0 ? r2(g.r0 / g.u0) : null, mudancas_preco_28d: mudPreco.get(i.item_id) || [],
      vendas_dia: mudPreco.has(i.item_id) ? vendasDia.get(i.item_id) || {} : null,
      custo_unitario: custoItem.get(i.item_id)?.custo ?? null, custo_origem: custoItem.get(i.item_id)?.origem ?? null,
    })
  }
  // V3 F3: PRODUTO por trás do anúncio — SÓ com a chave produto.diagnostico_ligado (nasce DESLIGADA: com ela desligada nenhum campo do item existe ou muda e o plano sai
  // idêntico). Ligada: aplicarProduto anota i.produto (estoque físico de referência contado 1×, demanda somada dos irmãos, representante) e troca i.cobertura e
  // i.ponto_reposicao pelos do EF; regras, gatilhos, compras e textos leem só o item (representaEstoque/estoqueDe) — nunca uma tabela de produto, nunca um 2º motor
  let produto = null
  if (algoritmo.produto?.diagnostico_ligado === true) {
    const g = grafoDoCliente(cliente, { hoje })
    aplicarProduto(lista, g, { L, dias, ligado: true })
    const ativos = g.produtos.filter(p => p.nos.some(n => n.status === 'active'))
    produto = { produtos: ativos.length, agrupados: ativos.filter(p => p.nos.length >= 2).length, com_sku: ativos.filter(p => p.skus.length).length, com_up: ativos.filter(p => p.ups.length).length,
      declarados: ativos.filter(p => p.modo === 'declarado').length, nao_lidos: ativos.filter(p => p.estoque == null).length, arestas: g.qualidade.arestas, sem_aresta: g.qualidade.sem_aresta, avisos: g.avisos.slice(0, 20) }
  }
  // controle das regras de queda (conversão e visitas): soma dos anúncios cobertos por visitas e SEM mudança registrada (preço/título/fotos/capa) nos 28 dias
  const ctrl = lista.filter(i => i.visOk && !mud.has(i.id)), somaCtrl = k => ctrl.reduce((t, i) => t + (i[k] || 0), 0)
  // V3 F4: financeiro MEDIDO nos pedidos (lucro-real.js) — SÓ com a chave financeiro.margem_medida_nas_regras (nasce DESLIGADA: com ela desligada nenhum campo do
  // diagnóstico muda e o plano sai idêntico). Ligada: i.financeiro (agregado do anúncio na MESMA janela, com cobertura) e i.economia_real (margem, ROAS de equilíbrio,
  // desconto máximo a preço de hoje); as regras leem os dois só com a chave ligada (plano-anuncios.js)
  let financeiro = null
  if (algoritmo.financeiro?.margem_medida_nas_regras === true) {
    const f = financeiroDoCliente(cliente, { hoje, de, ate }), porItem = f.por(l => l.item_id)
    for (const i of lista) {
      i.financeiro = porItem.get(i.id) || null
      i.economia_real = economiaReal(i.financeiro, { preco: i.preco, custo_unit: i.custo_unitario, imposto_pct: f.imposto_pct, margem_desejada_pct: f.margem_desejada_pct, faixa: algoritmo.financeiro.faixa_frete_gratis_brl ?? 79, minimo: f.minimo })
    }
    financeiro = { de, ate, minimo: f.minimo, conta: f.por(() => 'conta').get('conta') || null, tarifa: f.tarifa, envios: f.envios, dias: f.dias, premissas: f.premissas }
  }
  return { de, ate, anterior: { de: anteDe, ate: anteAte }, dias, itens: lista.sort((a, b) => b.r - a.r), vendas_dia_sem_mudanca: vendasSemMudanca,
    visitas_sem_mudanca: { n: ctrl.length, u: somaCtrl('u'), v: somaCtrl('v'), u0: somaCtrl('u0'), v0: somaCtrl('v0') }, ...(financeiro ? { financeiro } : {}), ...(produto ? { produto } : {}) }
}

// ── curva ABC (receita) + potencial (segunda dimensão) ──────────────────────
export function classificarCurvas(itens, convBench) {
  const total = itens.reduce((t, i) => t + i.r, 0) || 1
  let acum = 0
  for (const i of itens) {
    const antes = acum / total * 100
    acum += i.r
    i.share_pct = p1(100 * i.r / total)
    i.curva = i.r > 0 ? (antes < 80 ? 'A' : antes < 95 ? 'B' : 'C') : 'C'      // sem receita não há curva (com GMV 0 tudo cairia em A e "campeão de vendas" nasceria sem venda)
    // potencial: quanto ainda cabe de receita no próprio anúncio (gap de conversão até o benchmark da conta)
    const gap = convBench && i.conv != null && i.v ? Math.max(0, (convBench - i.conv) / 100 * i.v) * (i.preco || 0) : 0
    const crescendo = i.v0 > 0 && i.v >= i.v0 * 1.2
    i.gap_receita = r2(gap)
    i.potencial = gap >= 0.3 * Math.max(i.r, 1) || crescendo ? 1 : 2
    i.classe = i.curva + i.potencial
  }
  return itens
}

// benchmark de conversão = taxa agregada dos anúncios A/B com visitas suficientes (a MESMA conta, nunca um número de mercado)
export function benchmarkConversao(itens) {
  const base = itens.filter(i => i.conv != null && i.v >= L.benchmark_min_visitas && i.curva !== 'C')
  const v = base.reduce((t, i) => t + i.v, 0), u = base.reduce((t, i) => t + i.u, 0)
  return v > 0 ? { conv: p2(100 * u / v), n: base.length, visitas: v, regra: `taxa agregada dos ${base.length} anúncios curva A/B com ≥ ${L.benchmark_min_visitas} visitas` } : null
}
// benchmark por CATEGORIA do Mercado Livre (category_id do multiget), ainda da PRÓPRIA conta: só categorias com ≥ 3 anúncios A/B cobertos por visitas (visOk) e com
// visitas suficientes. Anúncio gravado antes da coluna fica sem categoria ('') até a próxima coleta: cai no benchmark da conta, com a fonte declarada em benchmark_ref.
export function benchmarkPorCategoria(itens, minAnuncios = 3) {
  const por = new Map()
  for (const i of itens) if (i.category_id && i.visOk && i.conv != null && i.v >= L.benchmark_min_visitas && i.curva !== 'C') (por.get(i.category_id) || por.set(i.category_id, []).get(i.category_id)).push(i)
  const out = new Map()
  for (const [cat, lst] of por) {
    if (lst.length < minAnuncios) continue
    const v = lst.reduce((t, i) => t + i.v, 0), u = lst.reduce((t, i) => t + i.u, 0)
    if (v > 0) out.set(cat, { conv: p2(100 * u / v), n: lst.length, visitas: v })
  }
  return out
}

// ── definições canônicas das métricas (motor de diagnóstico, 08/10/2026): UMA fórmula por métrica, com denominador, período e fonte declarados ──
// Nenhuma conta das telas muda — o mapa diz o que cada número É. `onde` = caminhos em que diagnosticarConta expõe a métrica (o teste de paridade confere que existem).
// Dado que ainda não é gravado (cancelamentos, devoluções, reclamações, atrasos) tem fórmula null e entra como NOT_COLLECTED em data_quality — nunca como zero.
const NAO_COLETADA = (texto, chave) => ({ texto, formula: null, denominador: null, periodo: null, fonte: 'NOT_COLLECTED: lido ao vivo na tela, ainda não gravado', onde: [`resumo.${chave}`] })
export const DEFINICOES = {
  receita: { texto: 'Receita (GMV) dos pedidos pagos', formula: 'Σ unit_price × quantity dos itens de pedidos pagos (order.status=paid), por anúncio e dia', denominador: null, periodo: '28 dias fechados (até ontem) × 28 anteriores', fonte: 'meli_serie_item (pedidos)', onde: ['resumo.gmv', 'resumo.gmv_anterior', 'itens[].r', 'itens[].r0'] },
  pedidos: { texto: 'Pedidos pagos', formula: 'Σ pedidos pagos dos dias coletados da janela (meli_coleta_dia.pedidos); null se nenhum dia foi coletado', denominador: null, periodo: '28 dias', fonte: 'meli_coleta_dia', onde: ['resumo.pedidos'] },
  unidades: { texto: 'Unidades vendidas', formula: 'Σ quantity dos itens de pedidos pagos', denominador: null, periodo: '28 dias', fonte: 'meli_serie_item', onde: ['resumo.unidades', 'itens[].u', 'itens[].u0'] },
  ticket: { texto: 'Ticket médio da conta', formula: 'receita ÷ pedidos pagos (nível CONTA; por anúncio o número correspondente é o preço pago); null com motivo (ticket_motivo) sem pedido pago na janela — nunca R$ 0', denominador: 'pedidos pagos', periodo: '28 dias', fonte: 'meli_serie_item + meli_coleta_dia', onde: ['resumo.ticket', 'resumo.ticket_motivo'] },
  preco_pago: { texto: 'Preço pago do anúncio', formula: 'receita ÷ unidades do anúncio', denominador: 'unidades', periodo: '28 dias × 28 anteriores', fonte: 'meli_serie_item', onde: ['itens[].preco_realizado_28d', 'itens[].preco_realizado_ant'] },
  conversao_anuncio: { texto: 'Conversão do anúncio', formula: 'unidades ÷ visitas × 100, só com visitas coletadas no período inteiro (visOk: série desde o início da janela e coletada até a véspera do último dia, vis_ate ≥ ate − 1 — o mesmo critério de Mais vendidos); null se > 100% (visitas registradas em outro anúncio do mesmo produto)', denominador: 'visitas', periodo: '28 dias', fonte: 'meli_serie_item (pedidos + visitas)', onde: ['itens[].conv'] },
  conversao_conta: { texto: 'Conversão da conta (benchmark)', formula: 'Σ unidades ÷ Σ visitas dos anúncios curva A/B cobertos por visitas com ≥ benchmark_min_visitas; declara anuncios_cobertos/anuncios_total em data_quality.cobertura.visitas', denominador: 'visitas dos anúncios cobertos', periodo: '28 dias', fonte: 'meli_serie_item', onde: ['resumo.conversao_conta', 'benchmark', 'data_quality.cobertura.visitas'] },
  ctr_ads: { texto: 'CTR de Ads', formula: 'cliques ÷ impressões × 100, só na janela própria de Ads', denominador: 'impressões (prints)', periodo: 'janela de Ads (28 d atual e 28 d anterior)', fonte: 'meli_ads_item', onde: ['ads.ctr', 'ads.anterior.ctr', 'itens[].ads.ctr', 'itens[].ads_ant.ctr'] },
  cpc: { texto: 'Custo por clique', formula: 'custo de Ads ÷ cliques', denominador: 'cliques', periodo: 'janela de Ads', fonte: 'meli_ads_item', onde: ['ads.cpc'] },
  custo_por_pedido_ads: { texto: 'Custo por venda atribuída a Ads', formula: 'custo de Ads ÷ unidades atribuídas (a API de Product Ads devolve unidades, não pedidos)', denominador: 'unidades atribuídas', periodo: 'janela de Ads', fonte: 'meli_ads_item', onde: ['ads.custo_por_pedido'] },
  acos: { texto: 'ACOS', formula: 'custo de Ads ÷ receita atribuída a Ads × 100', denominador: 'receita atribuída', periodo: 'janela de Ads', fonte: 'meli_ads_item', onde: ['ads.acos', 'itens[].ads.acos'] },
  roas: { texto: 'ROAS', formula: 'receita atribuída a Ads ÷ custo de Ads', denominador: 'custo de Ads', periodo: 'janela de Ads', fonte: 'meli_ads_item', onde: ['ads.roas', 'ads.anterior.roas', 'itens[].ads.roas'] },
  tacos: { texto: 'TACOS', formula: 'custo de Ads ÷ GMV × 100 — cruza a janela de Ads com a dos pedidos (declarado em data_quality.incompatibilidades)', denominador: 'GMV (pedidos)', periodo: 'Ads 28 d × pedidos 28 d', fonte: 'meli_ads_item + meli_serie_item', onde: ['ads.tacos'] },
  participacao_publicidade: { texto: 'Participação da publicidade', formula: 'receita atribuída a Ads ÷ GMV × 100 (mesma ressalva de janelas do TACOS)', denominador: 'GMV', periodo: 'Ads 28 d × pedidos 28 d', fonte: 'meli_ads_item + meli_serie_item', onde: ['ads.participacao_pct'] },
  margem_pre_ads: { texto: 'Margem de contribuição antes de Ads', formula: '100 − CMV% − imposto% − comissão% − frete% − embalagem% − outros% (margemPct); por anúncio o CMV vem do custo vinculado quando existe; null sem custos', denominador: 'preço', periodo: 'custos vigentes', fonte: 'custos_cliente + custo_vinculo', onde: ['economia.margem_pre_ads_pct'] },
  margem_pos_ads: { texto: 'Margem depois de Ads', formula: 'margem_pre_ads − TACOS da conta (custo de Ads ÷ GMV × 100: Ads descontado UMA vez, sobre a receita TOTAL; o ACOS mede só as vendas atribuídas a Ads e não entra aqui); null sem custos, sem Ads coletado ou sem GMV; o GMV é da série de pedidos: dia sem coleta ou truncado na janela atual marca parcial e, acima do corte de dias sem coleta, null com motivo', denominador: 'preço', periodo: 'custos vigentes × Ads 28 d × pedidos 28 d', fonte: 'custos_cliente + meli_ads_item + meli_serie_item', onde: ['margem_pos_ads_pct', 'margem_pos_ads_motivo', 'margem_pos_ads_parcial'] },
  cobertura: { texto: 'Cobertura de estoque', formula: 'estoque ÷ (unidades 28 d ÷ 28), em dias; null sem venda. Com produto.diagnostico_ligado (V3 F3): do ESTOQUE FÍSICO DE REFERÊNCIA do produto (estoque contado uma vez, unidades somadas dos anúncios que vendem dele; Full e próprio separados; estoque não lido por local = null, nunca 0); itens[].cobertura_anuncio guarda o número por anúncio', denominador: 'vendas por dia', periodo: '28 dias', fonte: 'meli_item.estoque + meli_serie_item (+ meli_anuncio_up, meli_up_estoque, produto_estoque_declarado com a chave)', onde: ['itens[].cobertura'] },
  giro: { texto: 'Giro', formula: 'unidades 28 d ÷ estoque; null sem estoque', denominador: 'estoque', periodo: '28 dias', fonte: 'meli_item + meli_serie_item', onde: ['itens[].giro'] },
  ponto_reposicao: { texto: 'Ponto de reposição', formula: 'vendas por dia × (lead time + segurança), em unidades, arredondado para cima (com produto.diagnostico_ligado: vendas por dia do estoque físico de referência do produto, prazo do anúncio representante); lead time = o informado em lead_time_cliente (anúncio > SKU > conta toda; itens[].lead_time_fonte cliente|equipe) ou a PREMISSA lead_time_reposicao_dias do config; segurança = PREMISSA estoque_seguranca_dias', denominador: null, periodo: '28 dias', fonte: 'meli_serie_item + lead_time_cliente + config/algoritmo.json → premissas', onde: ['itens[].ponto_reposicao', 'itens[].lead_time_dias', 'itens[].lead_time_fonte'] },
  cancelamentos: NAO_COLETADA('Cancelamentos', 'cancelamentos'), devolucoes: NAO_COLETADA('Devoluções', 'devolucoes'),
  // saúde da conta GRAVADA (src/lib/saude-coleta.js, 1 linha/dia): sem linha de hoje/ontem continua NOT_COLLECTED; bloco que falhou na coleta sai como pendente:<motivo> (nunca zero)
  reclamacoes: { texto: 'Reclamações abertas', formula: 'contagem das reclamações com status=opened na última leitura do dia (player_role=respondent; até teto_paginas.claims × 50)', denominador: null, periodo: 'leitura do dia (hoje ou ontem)', fonte: 'meli_conta_saude.claims_abertas (+ meli_claim)', onde: ['resumo.reclamacoes'] },
  atrasos: { texto: 'Atrasos de despacho', formula: 'pedidos pagos dos últimos pedidos_dias dias cujo envio segue em ready_to_ship/handling com shipping_option.estimated_handling_limit.date já vencido (campo a verificar em conta real: sem ele, pendente)', denominador: null, periodo: 'pedidos dos últimos 7 dias, leitura do dia', fonte: 'meli_conta_saude.atrasos (+ meli_envio_atraso)', onde: ['resumo.atrasos'] },
  perguntas: { texto: 'Perguntas sem resposta há mais de 24 h', formula: 'perguntas UNANSWERED com date_created anterior a agora − perguntas_limite_horas; texto da pergunta não é gravado (só hash)', denominador: null, periodo: 'leitura do dia', fonte: 'meli_conta_saude.perguntas_24h (+ meli_pergunta)', onde: ['resumo.perguntas'] },
  reputacao: { texto: 'Reputação da conta', formula: 'level_id, power_seller_status e taxas (claims, delayed_handling_time, cancellations × 100) de /users/{id}.seller_reputation na leitura do dia', denominador: 'vendas do período da reputação', periodo: 'período da reputação (ML, ~60 dias)', fonte: 'meli_conta_saude (level_id, taxa_*)', onde: ['resumo.reputacao'] },
  // V3 F4 (financeiro por pedido): expostas na aba Produtos (visão Lucro), no DRE e — com financeiro.margem_medida_nas_regras ligada — em itens[].financeiro / financeiro.conta
  taxas_ml: { texto: 'Tarifas de venda do Mercado Livre', formula: 'Σ order_items[].sale_fee × quantidade das linhas pagas (PREMISSA por unidade até conciliar; null quando não veio, nunca 0)', denominador: null, periodo: '28 dias fechados', fonte: 'meli_pedido_item', onde: [] },
  frete_vendedor: { texto: 'Frete pago pelo vendedor', formula: 'Σ senders[].cost de /shipments/{id}/costs, rateado pela receita entre as linhas pagas do mesmo envio (pacote desconta uma vez); envio não lido = null', denominador: null, periodo: '28 dias fechados', fonte: 'meli_envio_custo + meli_pedido_item', onde: [] },
  receita_liquida: { texto: 'Receita líquida de taxas e frete', formula: 'Σ (receita − reembolso − tarifa − frete) das linhas com tarifa, frete e reembolso lidos; existe sem custo; número só com cobertura ≥ financeiro.cobertura_minima', denominador: 'receita total da janela (dia sem linhas entra pela série)', periodo: '28 dias fechados', fonte: 'meli_pedido_item + meli_envio_custo + meli_serie_item', onde: [] },
  margem_medida: { texto: 'Margem de contribuição MEDIDA (antes do imposto)', formula: 'Σ lucro ÷ Σ receita das linhas completas (receita − reembolso − tarifa − frete − custo informado) × 100; null sem custo ou com cobertura < financeiro.cobertura_minima («parcial (x%)»); com o imposto informado, margem_depois_imposto_pct = (lucro − receita × imposto%) ÷ a mesma receita — é a que a regra margem_negativa e a aba Produtos usam', denominador: 'receita das linhas completas', periodo: '28 dias fechados', fonte: 'meli_pedido_item + meli_envio_custo + custo informado (custo-vinculo: o do anúncio — manual > SKU exato > SKU forte > grupo do produto —; o SKU da venda só sem custo do anúncio ou na variação com custo próprio pelo SKU dela)', onde: [] },
  lucro_contribuicao: { texto: 'Lucro de contribuição (antes do imposto)', formula: 'Σ (receita − reembolso − tarifa − frete − custo) das linhas completas; com imposto informado, menos receita × imposto%; não é lucro líquido (sem despesas fixas, armazenagem, devolução)', denominador: null, periodo: '28 dias fechados ou mês (DRE)', fonte: 'meli_pedido_item + meli_envio_custo + custo informado', onde: [] },
  variacao: { texto: 'Variação vs período comparável', formula: '(atual ÷ anterior − 1) × 100; null com motivo quando qualquer uma das duas janelas tem dia sem coleta ou truncado', denominador: 'período anterior (28 d)', periodo: '28 d × 28 d anteriores', fonte: 'meli_serie_item + meli_coleta_dia', onde: ['resumo.variacao'] },
}

// metas do mês cadastradas pelo time (nunca inventadas): só as que o plano por anúncio usa; null quando não há nenhuma
export function lerMetas(json) {
  let m = null; try { m = json ? JSON.parse(json) : null } catch { m = null }
  if (!m || typeof m !== 'object') return null
  const num = k => Number.isFinite(Number(m[k])) && Number(m[k]) > 0 ? Number(m[k]) : null
  const v = { gmv: num('gmv'), roas: num('roas'), acos_max: num('acos_max'), margem_pct: num('margem_pct') }
  return Object.values(v).some(x => x != null) ? v : null
}

// as 5 pendências declaradas do diagnóstico (texto único: `pendencias` e data_quality.analises_bloqueadas saem daqui)
const pendenciasPadrao = custos => [
  ...(!custos ? [{ item: 'Custos (CMV, comissão, impostos, frete, embalagem, margem desejada)', muda: 'sem eles não existe ROAS alvo, desconto máximo nem margem por anúncio — Ads e promoção ficam em cenários', como: 'informar na tela do cliente (Custos) ou na reunião de resultados', estado: 'NEEDS_EXTERNAL_DATA' }] : []),
  { item: 'Impressões e CTR orgânicos por anúncio', muda: 'a estratégia de atração (título/imagem) usa só o CTR de Ads como referência', como: 'a API de Mercado Livre não entrega esses dados da busca orgânica', estado: 'NOT_AVAILABLE' },
  { item: 'Perguntas e reclamações por anúncio', muda: 'objeções reais do comprador ficam por inferência dos sinais do anúncio', como: 'escopo de perguntas não autorizado no app (403) — dá para solicitar a permissão', estado: 'NOT_AUTHORIZED' },
  { item: 'Posição do anúncio na busca e concorrentes', muda: 'oportunidade de mercado não é medida', como: 'a busca pública do ML está bloqueada para integrações', estado: 'NOT_SUPPORTED' },
  { item: 'Histórico de 12 meses (sazonalidade real)', muda: 'janelas comerciais seguem calendário, não a curva do produto', como: 'acumula com o tempo; o sistema guarda a série desde a conexão', estado: 'NEEDS_EXTERNAL_DATA' },
]

// ── data_quality: o que foi coletado, de quando, com que buracos, e o que NÃO dá para analisar (estado + como obter). PURA: recebe leituras, não consulta nada ──
// conta = meli_contas {escopos, erro, atualizado_em} | null · cob = coberturaPedidos + atualizado_em | null · qualidade = { periodo, atual, anterior } (qualidadeNoIntervalo)
// itens = itens do diagnóstico (visOk) · ads = { n, de, ate, coletado_em } da foto 'atual' | null · promo = promo_coleta {estado, concluida_em} | null
// custos = { percentuais, atualizado_em, avisos[] } · metas = lerMetas() | null. Canais Amazon/Shopee/TikTok: NOT_SUPPORTED (sem importador).
export const ESTADOS_BLOQUEIO = ['NEEDS_EXTERNAL_DATA', 'NOT_AVAILABLE', 'NOT_AUTHORIZED', 'NOT_SUPPORTED', 'NOT_COLLECTED']
const MOEDA = 'BRL (implícita: currency_id não lido)'
const CANAIS_SEM_API = ['Amazon', 'Shopee', 'TikTok Shop']
// orfas = { receita, anuncios } dos pedidos pagos de anúncios que a leitura de anúncios não trouxe (série sem anúncio lido) | null quando não medido.
export function qualidadeDados({ conta = null, cob = null, qualidade = null, itens = [], ads = null, promo = null, custos = null, metas = null, orfas = null, saude = null, hoje = hojeLocal() } = {}) {
  const fonte = (nome, status, o = {}) => ({ fonte: nome, status, periodo: null, moeda: MOEDA, atualizado_em: null, granularidade: null, definicao: '', ...o })
  const faltam = [...(qualidade?.atual?.faltam || []), ...(qualidade?.anterior?.faltam || [])]
  const truncados = (qualidade?.atual?.truncados || 0) + (qualidade?.anterior?.truncados || 0)
  const cobertos = itens.filter(i => i.visOk).length, total = itens.length
  const adsOk = !!(ads && ads.n > 0)
  const saudeOk = !!(saude?.dia && saude.do_dia)
  const fontes = [
    fonte('Mercado Livre — conta (OAuth)', !conta ? 'indisponivel' : conta.erro ? 'parcial' : 'disponivel', { atualizado_em: conta?.atualizado_em || null, granularidade: 'conta', definicao: !conta ? 'conta não conectada' : conta.erro ? `última renovação do token com erro: ${String(conta.erro).slice(0, 120)}` : 'token renovado; escopos autorizados' }),
    fonte('Mercado Livre — pedidos pagos (série diária por anúncio)', !cob?.de ? 'indisponivel' : faltam.length || truncados ? 'parcial' : 'disponivel', { periodo: cob?.de ? { de: cob.de, ate: cob.ate } : null, atualizado_em: cob?.atualizado_em || null, granularidade: 'anúncio × dia', definicao: DEFINICOES.receita.formula }),
    fonte('Mercado Livre — visitas por anúncio', !total || !cobertos ? 'indisponivel' : cobertos === total ? 'disponivel' : 'parcial', { periodo: qualidade?.periodo || null, granularidade: 'anúncio × dia', definicao: total ? `${cobertos} de ${total} anúncio(s) com visitas no período inteiro; a conversão só existe para eles` : 'sem anúncios lidos: cobertura de visitas não medida' }),
    // latente declarado (não corrigido): o GMV soma só os anúncios lidos — pedido pago de anúncio que a leitura não trouxe fica fora do GMV, do ticket e das curvas
    // status e contador decidem pelo MESMO critério (anúncio órfão com unidade > 0): pedido pago com receita 0 (unit_price 0) é venda fora da leitura, não "tudo lido"
    fonte('Mercado Livre — pedidos de anúncios fora do catálogo lido', !orfas ? 'indisponivel' : orfas.anuncios > 0 ? 'parcial' : 'disponivel', { periodo: qualidade?.periodo || null, granularidade: 'anúncio × dia', definicao: !orfas ? 'sem leitura de pedidos: não medido' : orfas.anuncios > 0 ? `${orfas.anuncios} anúncio(s) vendido(s) no período sem leitura de anúncio: ${brl(orfas.receita)} fora do GMV, do ticket e das curvas — rode a coleta de novo para ler os anúncios` : 'todos os anúncios vendidos no período foram lidos: o GMV soma todos os pedidos pagos' }),
    fonte('Mercado Livre — Product Ads por anúncio', adsOk ? 'disponivel' : 'indisponivel', { periodo: adsOk ? { de: ads.de, ate: ads.ate } : null, atualizado_em: adsOk ? ads.coletado_em : null, granularidade: 'anúncio × janela de 28 d (sem campanha, sem dia)', definicao: adsOk ? 'duas fotos de 28 d por anúncio (atual e anterior)' : 'conta sem Product Ads, sem permissão de leitura ou ainda não coletado' }),
    fonte('Mercado Livre — promoções', promo?.concluida_em ? 'disponivel' : 'indisponivel', { atualizado_em: promo?.concluida_em || null, granularidade: 'anúncio (última leitura)', definicao: promo?.concluida_em ? 'ofertas ativas e candidatas na última coleta' : 'coleta de promoções não concluída para este cliente' }),
    fonte('Mercado Livre — saúde da conta (reputação, perguntas, reclamações, atrasos, Full)', !saudeOk ? 'indisponivel' : Object.keys(saude.pendente || {}).some(k => k !== 'full') ? 'parcial' : 'disponivel', { periodo: saudeOk ? { de: saude.dia, ate: saude.dia } : null, atualizado_em: saudeOk ? saude.coletado_em : null, granularidade: 'conta × dia (+ listas abertas)', definicao: !saude?.dia ? 'ainda sem coleta de saúde: reputação, perguntas, reclamações e atrasos não medidos (não é zero)' : !saudeOk ? `última leitura de ${dm(saude.dia)}: velha demais para o dia (não é zero)` : Object.keys(saude.pendente || {}).length ? `leitura do dia com pendência em: ${Object.keys(saude.pendente).join(', ')}` : 'leitura do dia completa' }),
    fonte('Custos do cliente', custos?.percentuais ? 'disponivel' : 'indisponivel', { atualizado_em: custos?.atualizado_em || null, granularidade: 'conta (percentuais) + anúncio (custo vinculado)', definicao: custos?.percentuais ? (custos.avisos?.length ? custos.avisos.join(' ') : 'CMV, comissão e imposto informados') : 'sem CMV/comissão/imposto: margem, ROAS alvo e desconto máximo não existem' }),
    fonte('Metas do mês', metas ? 'disponivel' : 'indisponivel', { periodo: hoje.slice(0, 7), granularidade: 'conta × mês', definicao: metas ? `metas cadastradas: ${Object.entries(metas).filter(([, v]) => v != null).map(([k]) => k).join(', ')}` : 'nenhuma meta cadastrada para o mês' }),
    ...CANAIS_SEM_API.map(c => fonte(c, 'indisponivel', { moeda: null, definicao: 'canal sem integração (NOT_SUPPORTED): só pelo quadro de tarefas da equipe e registro manual' })),
  ]
  const bloq = []
  if (!conta) bloq.push({ analise: 'Dados do Mercado Livre (pedidos, visitas, anúncios, Ads)', motivo: 'conta não conectada: nada foi coletado', estado: 'NOT_COLLECTED', como_obter: 'conectar a conta do Mercado Livre (botão na página do cliente) e rodar a coleta' })
  for (const p of pendenciasPadrao(custos?.percentuais)) bloq.push({ analise: p.item, motivo: p.muda, estado: p.estado, como_obter: p.como })
  for (const k of ['cancelamentos', 'devolucoes']) bloq.push({ analise: DEFINICOES[k].texto, motivo: 'lido ao vivo na tela, ainda não coletado pelo sistema; não é zero', estado: 'NOT_COLLECTED', como_obter: 'gravar a leitura diária (fase futura da coleta)' })
  // saúde gravada: sem linha do dia → NOT_COLLECTED; linha com bloco pendente → estado pelo motivo (permissão do app = NOT_AUTHORIZED), texto fixo do config
  const saudeSinais = {}
  for (const k of ['reputacao', 'perguntas', 'reclamacoes', 'atrasos']) {
    const mot = saudeOk ? saude.pendente?.[k] || '' : 'sem_coleta'
    saudeSinais[k] = mot ? `pendente:${mot}` : 'disponivel'
    if (!mot) continue
    bloq.push({ analise: DEFINICOES[k].texto, motivo: (saude?.textos || SAUDE_TEXTOS)[mot] || 'não lido no dia; não é zero', estado: mot === 'permissao_do_app' ? 'NOT_AUTHORIZED' : 'NOT_COLLECTED', como_obter: mot === 'permissao_do_app' ? 'marcar o escopo de perguntas/mensagens no app do Mercado Livre e reconectar o cliente em Integrações' : mot === 'endpoint_nao_verificado' ? 'confirmar o campo do endpoint em conta real (docs/manual-integracao-ml.md § Saúde da conta)' : '«Atualizar agora» em Saúde da conta ou aguardar a coleta diária' })
  }
  if (faltam.length || truncados) bloq.push({ analise: 'Variação vs período comparável', motivo: [faltam.length ? `${faltam.length} dia(s) sem coleta (${faltam.slice(0, 4).map(dm).join(', ')}${faltam.length > 4 ? '…' : ''})` : '', truncados ? `${truncados} dia(s) truncado(s) pela API (1.000 pedidos)` : ''].filter(Boolean).join('; ') + ': a comparação 28 d × 28 d anteriores não é confiável', estado: 'NOT_COLLECTED', como_obter: 'recoletar os dias que faltam ("Atualizar dados" do cliente)' })
  if (!metas) bloq.push({ analise: 'Ads contra a META do mês (ACOS máximo / ROAS)', motivo: 'sem meta só existe a leitura contra o equilíbrio econômico (custos) ou a média da conta', estado: 'NEEDS_EXTERNAL_DATA', como_obter: 'cadastrar as metas do mês na tela do cliente' })
  bloq.push({ analise: 'Campanhas de Ads (orçamento, campanha, palavra-chave)', motivo: 'a leitura é por anúncio; id de campanha e orçamento não são coletados', estado: 'NOT_SUPPORTED', como_obter: 'não há coleta por campanha nesta versão' })
  for (const c of CANAIS_SEM_API) bloq.push({ analise: `Diagnóstico de ${c}`, motivo: 'canal sem integração', estado: 'NOT_SUPPORTED', como_obter: 'só pelo quadro de tarefas da equipe e registro manual de pendências' })
  const incompatibilidades = []
  if (adsOk) incompatibilidades.push(`Ads tem janela própria de 28 d (${dm(ads.de)}–${dm(ads.ate)}), não o período dos pedidos; só o TACOS e a participação da publicidade cruzam com o GMV, e declaram isso.`)
  if (total && cobertos < total) incompatibilidades.push(`Visitas cobrem ${cobertos} de ${total} anúncio(s): a conversão da conta é dos cobertos, não da conta inteira.`)
  if (custos?.percentuais) incompatibilidades.push('A margem por anúncio usa o custo vinculado quando existe e o CMV% da conta nos demais: os dois conjuntos não são comparáveis entre si.')
  if (orfas?.anuncios > 0) incompatibilidades.push(`GMV, ticket e curvas somam só os anúncios lidos: ${brl(orfas.receita)} de pedidos pagos de ${orfas.anuncios} anúncio(s) sem leitura de anúncio ficam fora — ${orfas.receita > 0 ? 'o GMV não está completo' : 'as unidades vendidas não estão completas'}.`)
  return {
    fontes,
    saude: { dia: saude?.dia || null, do_dia: saudeOk, coletado_em: saudeOk ? saude.coletado_em : null, sinais: saudeSinais },   // 'disponivel' | 'pendente:<motivo>' por sinal (texto do motivo em config/saude.json)
    // sem leitura das janelas (conta sem ML) lacunas/truncados/contagens não foram medidos: null, nunca [] / 0
    cobertura: { pedidos: { de: cob?.de || null, ate: cob?.ate || null, lacunas: qualidade ? faltam : null, truncados: qualidade ? truncados : null }, visitas: { anuncios_cobertos: total ? cobertos : null, anuncios_total: total || null }, ads: adsOk ? { coletado_em: ads.coletado_em, janela: { de: ads.de, ate: ads.ate } } : null, fora_do_gmv: orfas },
    analises_bloqueadas: bloq, incompatibilidades,
  }
}

// ── sazonalidade: próximas janelas × produtos por palavra do título ─────────
export function janelasComerciais(itens, hoje = hojeLocal()) {
  const lt = { conteudo: 30, reposicao: 21, campanha: 14 }
  return algoritmo.sazonalidade.filter(e => e.data >= hoje).map(e => {
    const dias = diasEntre(hoje, e.data)
    const rel = itens.filter(i => eventoDoItem(e, i))                                 // o MESMO predicado da previsão de compras
    return {
      evento: e.evento, data: e.data, dias, acao: e.acao, produtos: rel.slice(0, 8).map(i => i.id), n_produtos: rel.length,
      limites: { conteudo: addDias(e.data, -lt.conteudo), reposicao: addDias(e.data, -lt.reposicao), campanha: addDias(e.data, -lt.campanha) },
      estagio: dias <= 0 ? 'passou' : dias < lt.campanha ? 'janela curta' : dias <= 90 ? 'preparar agora' : 'monitorar',
      evidencia: 'HIPÓTESE do calendário comercial — a conta ainda não tem 12 meses de histórico para confirmar a sazonalidade do produto',
    }
  }).filter(j => j.dias <= 120)
}

// ── Full: quantidade sugerida (nunca movimenta estoque — só sugere) ─────────
// V3 F3 (com a chave): velocidade e estoque do ESTOQUE FÍSICO que o anúncio representa (estoqueDe); a tendência segue a do anúncio (premissa). Sem a chave, os do anúncio.
export function sugestaoFull(i, { cobertura = L.full_cobertura_planejada_dias, seguranca = L.estoque_seguranca_dias } = {}) {
  const E = estoqueDe(i)
  if (!(E.vel > 0) || E.estoque == null) return null
  const tendPct = i.u0 > 0 ? (i.u / i.u0 - 1) * 100 : 0
  const g = Math.max(0, Math.min(L.crescimento_max_pct, tendPct))               // crescimento só se OBSERVADO, com teto
  const cen = f => Math.max(0, Math.ceil(E.vel * (1 + f / 100) * (cobertura + seguranca) - E.estoque))
  return { cobertura_planejada: cobertura, seguranca, tendencia_obs_pct: r1(tendPct), cenarios: { conservador: cen(0), base: cen(g / 2), crescimento: cen(g) }, premissa: `${cobertura} dias de cobertura + ${seguranca} de segurança; crescimento só o observado (${r1(tendPct)}% vs período anterior), teto ${L.crescimento_max_pct}%` }
}

// ── urgência oculta: HIPÓTESES (nunca atributos que o produto não tem) ─────
export function hipotesesUrgenciaOculta(i) {
  const t = i.titulo
  return [
    { tipo: 'NOVO KIT', hipotese: `Combinar "${t.slice(0, 60)}" em kit (2–3 un.) para quem compra recorrente`, teste: 'criar anúncio de kit e comparar vendas e ticket em 14 dias', metrica: 'unidades do kit e ticket médio' },
    { tipo: 'NOVA PALAVRA-CHAVE', hipotese: 'Testar termos de busca alternativos no título (sinônimos e uso final) em um anúncio duplicado', teste: 'duplicar o anúncio com título novo e medir visitas em 14 dias', metrica: 'visitas/dia do anúncio duplicado' },
    { tipo: 'NOVO PÚBLICO', hipotese: 'Reposicionar o anúncio (imagem e título) para um segundo público de uso', teste: 'trocar imagem de capa e comparar CTR/conversão em 14 dias', metrica: 'conversão do anúncio' },
  ]
}

// ── portão da coleta de pedidos: decidido pela COBERTURA da janela (meli_coleta_dia), nunca pelos anúncios lidos ──────────────────────────────
// Anúncio que entra no foco só por gasto de Ads, ou série órfã de anúncio que a coleta não leu, não dizem nada sobre a coleta. Sem dia coletado → indisponível;
// coletado e sem venda nem Ads → disponível com zeros MEDIDOS (receita 0 e pedidos 0 são fato), sem regra que dependa de venda. "Sem venda" só vale para a
// janela coletada: dia sem coleta não é zero (acima do corte do motor: indisponível); pedido coletado de anúncio que a coleta não leu não é "sem venda".
// Devolve o bloqueio pronto ({ disponivel: false, motivo }) ou null, mais o que o diagnóstico e o Full leem depois. O MESMO portão para diagnosticarConta e metricasFull.
export function portaoColeta(cliente, base) {
  const qualidade_atual = qualidadeNoIntervalo(cliente, base.de, base.ate), dias = diasEntre(base.de, base.ate) + 1, sem_coleta = qualidade_atual.faltam.length
  const pedidos = sem_coleta < dias ? db.prepare('SELECT COALESCE(SUM(pedidos), 0) n FROM meli_coleta_dia WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, base.de, base.ate).n : null
  // ponytail: unidade na série é pedido que FOI coletado — vale como coleta onde o registro diário não existe (massa antiga); pedidos pagos só do registro
  const unSerie = db.prepare('SELECT COALESCE(SUM(unidades), 0) u FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, base.de, base.ate).u
  const sem_vendas = !base.itens.some(i => i.u > 0)
  const bloqueio = pedidos == null && !unSerie ? { disponivel: false, motivo: 'sem dados coletados do Mercado Livre — conecte a conta e rode a coleta' }
    : sem_vendas && (pedidos > 0 || unSerie > 0) ? { disponivel: false, motivo: `${pedidos > 0 ? `${pedidos} pedido(s)` : `${unSerie} unidade(s)`} coletado(s) no período sem os dados dos anúncios vendidos — rode a coleta de novo para ler os anúncios` }
    : sem_vendas && sem_coleta > MAX_SEM_COLETA ? { disponivel: false, motivo: `só ${dias - sem_coleta} de ${dias} dias do período com coleta de pedidos: sem venda nos dias coletados não prova período sem venda — recolete os dias que faltam` }
    : null
  return { bloqueio, qualidade_atual, pedidos, sem_vendas, dias, sem_coleta }
}

// ── diagnóstico completo da conta ───────────────────────────────────────────
export function diagnosticarConta(cliente, { hoje = hojeLocal() } = {}) {
  const base = carregarBase(cliente, { hoje })
  const portao = portaoColeta(cliente, base)
  if (portao.bloqueio) return portao.bloqueio
  const semVendas = portao.sem_vendas
  // primeira passada de curva para o benchmark, depois classificar com o benchmark
  classificarCurvas(base.itens, null)
  const bench = benchmarkConversao(base.itens)
  classificarCurvas(base.itens, bench?.conv)
  const itens = base.itens
  // benchmark por categoria da própria conta (quando a categoria tem amostra); por item, a referência usada e de onde veio — a DECISÃO das regras segue o da conta
  const benchCat = benchmarkPorCategoria(itens)
  for (const i of itens) { const c = benchCat.get(i.category_id); i.benchmark_ref = c ? { conv: c.conv, fonte: `própria conta (categoria ${i.category_id})` } : bench ? { conv: bench.conv, fonte: 'própria conta' } : null }
  const gmv = itens.reduce((t, i) => t + i.r, 0), gmv0 = itens.reduce((t, i) => t + i.r0, 0)
  const adsAtual = itens.reduce((o, i) => i.ads ? { custo: o.custo + i.ads.custo, receita: o.receita + i.ads.receita, clicks: o.clicks + i.ads.clicks, prints: o.prints + i.ads.prints, unidades: o.unidades + i.ads.unidades } : o, { custo: 0, receita: 0, clicks: 0, prints: 0, unidades: 0 })
  const adsAnt = itens.reduce((o, i) => i.ads_ant ? { custo: o.custo + i.ads_ant.custo, receita: o.receita + i.ads_ant.receita, clicks: o.clicks + (i.ads_ant.clicks || 0), prints: o.prints + (i.ads_ant.prints || 0) } : o, { custo: 0, receita: 0, clicks: 0, prints: 0 })
  const ads = {
    ...adsAtual, custo: r2(adsAtual.custo), receita: r2(adsAtual.receita),
    roas: adsAtual.custo > 0 ? p2(adsAtual.receita / adsAtual.custo) : null, acos: adsAtual.receita > 0 ? p1(100 * adsAtual.custo / adsAtual.receita) : null,
    ctr: adsAtual.prints ? p2(100 * adsAtual.clicks / adsAtual.prints) : null, tacos: gmv > 0 ? p2(100 * adsAtual.custo / gmv) : null,
    cpc: adsAtual.clicks ? r2(adsAtual.custo / adsAtual.clicks) : null, custo_por_pedido: adsAtual.unidades ? r2(adsAtual.custo / adsAtual.unidades) : null, participacao_pct: gmv > 0 ? p1(100 * adsAtual.receita / gmv) : null,
    anterior: { custo: r2(adsAnt.custo), receita: r2(adsAnt.receita), roas: adsAnt.custo > 0 ? p2(adsAnt.receita / adsAnt.custo) : null, prints: adsAnt.prints, clicks: adsAnt.clicks, ctr: adsAnt.prints ? p2(100 * adsAnt.clicks / adsAnt.prints) : null },
    custo_var_pct: adsAnt.custo > 0 ? r1((adsAtual.custo / adsAnt.custo - 1) * 100) : null,
  }
  // baseline (previsibilidade): velocidade ponderada da receita diária + tendência
  const serieRec = {}
  for (const x of db.prepare('SELECT dia, SUM(receita) r FROM meli_serie_item WHERE cliente = ? GROUP BY dia').all(cliente)) serieRec[x.dia] = x.r
  const vel = velocidadePonderada(serieRec, addDias(hoje, -1)), tend = tendencia(serieRec, addDias(hoje, -1))
  // cadeia causal da conta (GMV = visitas × conversão × ticket) — 28d × 28d com a mesma definição dos relatórios
  const agg = (campo, sufixo = '') => itens.reduce((t, i) => t + (i[campo + sufixo] || 0), 0)
  const comVis = itens.filter(i => i.visOk)
  const vA = comVis.reduce((t, i) => t + i.v, 0), vB = comVis.reduce((t, i) => t + (i.v0 || 0), 0)
  const uA = agg('u'), uB = agg('u0')
  const causal = causalidadeVendas(
    { faturamento: gmv, vendas: uA, visitas: vA || null, conversao: vA ? 100 * comVis.reduce((t, i) => t + i.u, 0) / vA : null },
    { faturamento: gmv0, vendas: uB, visitas: vB || null, conversao: vB ? 100 * comVis.reduce((t, i) => t + i.u0, 0) / vB : null },
    { preco: historico.resumoPrecos28d(cliente, { ate: base.ate, limiar: cfgAtrib.preco?.limiar_confundidor_pct ?? 3 }) })     // o preço também nos motivos da queda
  const custos = custosDoCliente(cliente), eco = economiaAds(custos)
  // metas do mês (cadastradas pelo time; nunca inventadas) — ads_abaixo_meta só nasce com elas
  const metas = lerMetas(db.prepare('SELECT metas_json FROM metas_cliente WHERE cliente = ? AND mes = ?').get(cliente, hoje.slice(0, 7))?.metas_json)

  // ── data_quality: leituras do que foi coletado (nenhuma decisão aqui; a função é pura e testável) ──
  const conta = db.prepare('SELECT escopos, erro, atualizado_em FROM meli_contas WHERE cliente = ?').get(cliente) || null
  const cobPed = coberturaPedidos(cliente)
  const qualidade = { periodo: { de: base.de, ate: base.ate }, atual: portao.qualidade_atual, anterior: qualidadeNoIntervalo(cliente, base.anterior.de, base.anterior.ate) }
  // pedidos pagos de anúncios que a leitura de anúncios não trouxe (série sem anúncio lido): ficam FORA do GMV, do ticket e das curvas — declarado, não corrigido
  const orfas = cobPed.de ? db.prepare('SELECT COALESCE(SUM(s.receita), 0) receita, COUNT(DISTINCT s.item_id) anuncios FROM meli_serie_item s LEFT JOIN meli_item i ON i.cliente = s.cliente AND i.item_id = s.item_id WHERE s.cliente = ? AND s.dia BETWEEN ? AND ? AND s.unidades > 0 AND i.item_id IS NULL').get(cliente, base.de, base.ate) : null
  const adsFoto = db.prepare("SELECT COUNT(*) n, MIN(de) de, MAX(ate) ate, MAX(coletado_em) coletado_em FROM meli_ads_item WHERE cliente = ? AND periodo = 'atual'").get(cliente)
  let promo = null; try { promo = db.prepare('SELECT estado, concluida_em FROM promo_coleta WHERE cliente = ?').get(cliente) || null } catch { promo = null }   // tabela do módulo de promoções: pode não existir num banco de teste
  let avisosCustos = []; try { avisosCustos = pendenciasCustos(cliente).map(p => p.texto) } catch { avisosCustos = [] }
  const saude = lerSaude(cliente, { hoje })
  const dq = qualidadeDados({
    conta, saude, cob: cobPed.de ? { ...cobPed, atualizado_em: db.prepare('SELECT MAX(coletado_em) em FROM meli_coleta_dia WHERE cliente = ?').get(cliente)?.em || null } : null, qualidade, itens, ads: adsFoto?.n ? adsFoto : null, promo,
    custos: { percentuais: custos, atualizado_em: db.prepare('SELECT atualizado_em FROM custos_cliente WHERE cliente = ?').get(cliente)?.atualizado_em || null, avisos: avisosCustos }, metas, hoje,
    orfas: orfas ? { receita: r2(orfas.receita), anuncios: orfas.anuncios } : null,
  })
  // V3 F4 (só com a chave financeiro.margem_medida_nas_regras): a fonte «taxas e frete por pedido» e a fatura do ML (403 sem a permissão Faturamento) em data_quality
  const fin = base.financeiro
  if (fin) {
    const cf = fin.conta?.cobertura_taxas_frete ?? 0
    dq.fontes.push({ fonte: 'Mercado Livre — taxas e frete por pedido', status: (fin.conta?.ok_taxas_frete ?? cf >= fin.minimo) ? 'disponivel' : cf > 0 ? 'parcial' : 'indisponivel', periodo: { de: fin.de, ate: fin.ate }, moeda: 'BRL', atualizado_em: null, granularidade: 'linha de pedido',
      definicao: `${Math.round(cf * 100)}% da receita com tarifa e frete lidos; ${fin.dias.com_linhas} de ${fin.dias.total} dias com linhas; ${fin.envios.lidos} de ${fin.envios.total} envios lidos; ${fin.tarifa.rotulo}` })
    dq.analises_bloqueadas.push({ analise: 'Fatura do ML (tarifa fechada do mês, custo fixo, Ads e armazenagem do Full)', motivo: 'o billing responde 403 sem a permissão funcional «Faturamento» no app', estado: 'NOT_AUTHORIZED', como_obter: 'ligar a permissão Faturamento (leitura) no app do ML e reautorizar o cliente' })
  }
  // V3 F3 (só com a chave produto.diagnostico_ligado): a fonte «produto por trás do anúncio» em data_quality (k de n com UP/SKU, grupos, estoque não lido por local)
  const pr = base.produto
  if (pr) dq.fontes.push({ fonte: 'Mercado Livre — produto por trás do anúncio (estoque contado uma vez)', status: pr.arestas ? (pr.sem_aresta ? 'parcial' : 'disponivel') : 'indisponivel', periodo: null, moeda: null, atualizado_em: null, granularidade: 'produto (anúncios do mesmo estoque)',
    definicao: `${pr.produtos} produto(s) ativo(s), ${pr.agrupados} com 2+ anúncios; ${pr.com_up} com user_product_id, ${pr.com_sku} com SKU oficial; ${pr.declarados} com estoque informado pelo cliente; ${pr.nao_lidos} sem estoque lido por local (cobertura null, nunca 0)${pr.sem_aresta ? `; ${pr.sem_aresta} anúncio(s) ainda sem chave do produto (cada um conta como um produto)` : ''}` })
  const pendencias = pendenciasPadrao(custos)
  const nPedidos = portao.pedidos                                  // null sem dia coletado na janela (só com série antiga sem registro diário)
  const deltaPct = gmv0 > 0 ? r1((gmv / gmv0 - 1) * 100) : null
  const lacunas = dq.cobertura.pedidos.lacunas.length, trunc = dq.cobertura.pedidos.truncados
  // margem depois de Ads = margem pré − TACOS, e o TACOS divide pelo GMV da janela ATUAL: dia sem coleta encolhe o GMV, infla o TACOS e subestima a margem
  // (dia sem coleta não é zero). Mesmo corte do motor para as métricas da série: até MAX_SEM_COLETA dias → valor marcado parcial; acima → null com motivo
  const qA = qualidade.atual, semCol = qA.faltam.length, diasJan = diasEntre(base.de, base.ate) + 1
  const margemPos = !eco ? { valor: null, motivo: 'custos não informados (CMV, comissão, imposto)' }
    : !dq.cobertura.ads || ads.tacos == null ? { valor: null, motivo: 'sem Product Ads coletado ou sem receita no período' }
    : semCol > MAX_SEM_COLETA ? { valor: null, motivo: `${semCol} dia(s) da janela sem coleta de pedidos (acima de ${MAX_SEM_COLETA}): com a receita incompleta, o custo de Ads sobre a receita sairia inflado e a margem, menor que a real` }
    : semCol || qA.truncados ? { valor: r1(eco.margem_pre_ads_pct - ads.tacos), motivo: `parcial: ${diasJan - semCol} de ${diasJan} dias coletados${qA.truncados ? `, ${qA.truncados} dia(s) truncado(s)` : ''}`, parcial: { dias_cobertos: diasJan - semCol, dias: diasJan, dias_sem_coleta: semCol, dias_truncados: qA.truncados } }
    : { valor: r1(eco.margem_pre_ads_pct - ads.tacos), motivo: '' }

  return {
    disponivel: true, motivo: !semVendas ? '' : semCol ? `sem vendas nos ${diasJan - semCol} dias coletados (${semCol} dia(s) sem coleta)` : 'sem vendas no período', cliente, hoje, periodo: { de: base.de, ate: base.ate, anterior: base.anterior },
    resumo: {
      gmv: r2(gmv), gmv_anterior: r2(gmv0), delta_pct: deltaPct, unidades: uA, anuncios_ativos: itens.length,
      pedidos: nPedidos, ticket: nPedidos > 0 ? r2(gmv / nPedidos) : null,
      ticket_motivo: nPedidos > 0 ? '' : nPedidos == null ? 'pedidos não coletados na janela: ticket não medido' : 'sem pedido pago no período: o ticket não existe (não é R$ 0)',
      // variação só é afirmada com as duas janelas inteiras (dia sem coleta não é zero); delta_pct segue como as telas já mostram
      variacao: lacunas || trunc ? { pct: null, motivo: `${lacunas ? `${lacunas} dia(s) sem coleta` : ''}${lacunas && trunc ? ' e ' : ''}${trunc ? `${trunc} dia(s) truncado(s)` : ''} nas janelas comparadas` } : { pct: deltaPct, motivo: deltaPct == null ? 'sem período anterior' : '' },
      cancelamentos: null, devolucoes: null,       // NOT_COLLECTED (data_quality.analises_bloqueadas): nunca zero
      // saúde gravada do dia (lerSaude): número só quando o bloco foi lido; pendente → null (motivo em data_quality.saude.sinais)
      reclamacoes: dq.saude.sinais.reclamacoes === 'disponivel' ? saude.reclamacoes.abertas : null, atrasos: dq.saude.sinais.atrasos === 'disponivel' ? saude.atrasos : null,
      perguntas: dq.saude.sinais.perguntas === 'disponivel' ? { abertas: saude.perguntas.abertas, mais_de_24h: saude.perguntas.mais_de_24h } : null,
      reputacao: dq.saude.sinais.reputacao === 'disponivel' ? saude.reputacao : null,
      conversao_conta: bench?.conv ?? null, tendencia: tend, velocidade_dia: vel.velocidade, baseline_28d: r2(vel.velocidade * 28),
      curvas: { A: itens.filter(i => i.curva === 'A').length, B: itens.filter(i => i.curva === 'B').length, C: itens.filter(i => i.curva === 'C').length },
    },
    benchmark: bench, benchmark_categoria: Object.fromEntries(benchCat), ads, economia: eco,
    margem_pos_ads_pct: margemPos.valor, margem_pos_ads_motivo: margemPos.motivo, margem_pos_ads_parcial: margemPos.parcial || null,   // TACOS (Ads ÷ receita total), não ACOS
    custos_informados: !!custos, custos, metas, causal, itens, vendas_dia_sem_mudanca: base.vendas_dia_sem_mudanca, visitas_sem_mudanca: base.visitas_sem_mudanca, janelas: janelasComerciais(itens, hoje), pendencias, ...(pr ? { produto: pr } : {}),
    data_quality: dq, definicoes: DEFINICOES,
    gerado_em: agora(), algoritmo_versao: algoritmo.versao, ...(fin ? { financeiro: fin } : {}),
  }
}
