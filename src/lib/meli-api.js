// Os 4 relatórios pedidos, usando a conta Mercado Livre conectada de cada
// cliente. Vendas e Produtos mais vendidos usam a API de Orders (estável e
// bem documentada). Ofertas e Ads usam APIs mais novas/variáveis do
// Mercado Livre — implementadas de forma defensiva: se a conta não tiver a
// funcionalidade habilitada ou o endpoint mudar, o relatório sinaliza
// "indisponível" em vez de quebrar o restante (mesmo princípio do resto do
// sistema: uma falha nunca derruba o relatório inteiro).
import { tokenValido, idDoVendedor } from './meli-contas.js'
import { log } from './db.js'
import { urlBulk, lerLoteBulk, LOTE_BULK } from './meli-bulk.js'

const BASE = 'https://api.mercadolibre.com'

export async function chamar(cliente, caminho, { headers = {}, permitirFalha = false } = {}) {
  const token = await tokenValido(cliente)
  if (!token) throw new Error('Conta Mercado Livre não conectada ou desconectada — peça ao cliente para reconectar pelo botão no Notion.')
  let r
  for (let tentativa = 0; ; tentativa++) {                      // limite de taxa (429) e falha transitória (5xx): espera e tenta de novo
    r = await fetch(`${BASE}${caminho}`, { headers: { Authorization: `Bearer ${token}`, ...headers } })
    if (r.ok || tentativa >= 3 || !(r.status === 429 || r.status >= 500)) break
    await new Promise(ok => setTimeout(ok, 1500 * 2 ** tentativa + Math.floor(Math.random() * 400)))
  }
  if (!r.ok) {
    const corpo = await r.text().catch(() => '')
    if (permitirFalha) return { _erro: true, status: r.status, corpo: corpo.slice(0, 200) }
    throw new Error(`Mercado Livre ${r.status} em ${caminho}: ${corpo.slice(0, 200)}`)
  }
  return r.json()
}

const isoDia = d => `${d}T00:00:00.000-03:00`      // dia comercial do Brasil — o MESMO recorte da série diária e do GMV
const isoFimDia = d => `${d}T23:59:59.999-03:00`
const arred2 = n => Math.round(n * 100) / 100

// Janela imediatamente anterior, com a MESMA duração — é como o próprio
// painel "Métricas" do Mercado Livre compara ("Comparar com: Período anterior").
export function janelaAnterior(de, ate) {
  const dDe = new Date(de + 'T12:00:00'), dAte = new Date(ate + 'T12:00:00')
  const dias = Math.round((dAte - dDe) / 86400000) + 1
  const ateAnt = new Date(dDe); ateAnt.setDate(ateAnt.getDate() - 1)
  const deAnt = new Date(ateAnt); deAnt.setDate(deAnt.getDate() - (dias - 1))
  return { de: deAnt.toISOString().slice(0, 10), ate: ateAnt.toISOString().slice(0, 10) }
}

// Roda a mesma função para o período atual e o anterior em paralelo —
// é o que alimenta todo comparativo ▲▼ dos relatórios.
export async function comComparativo(cliente, { de, ate }, fn, ...args) {
  const anterior = janelaAnterior(de, ate)
  const [atual, anteriorR] = await Promise.all([
    fn(cliente, { de, ate }, ...args),
    fn(cliente, { de: anterior.de, ate: anterior.ate }, ...args).catch(() => null),
  ])
  return { atual, anterior: anteriorR, janela_anterior: anterior }
}

// ── 1 e 2. Vendas + produtos mais vendidos — mesma paginação de pedidos ───
async function buscarPedidos(cliente, { de, ate }, status = 'paid') {
  const userId = idDoVendedor(cliente)
  if (!userId) throw new Error('Conta Mercado Livre sem seller id — reconecte pelo Notion.')
  const pedidos = []
  let offset = 0
  const limite = 50
  while (true) {
    const q = new URLSearchParams({
      seller: userId, 'order.status': status,
      'order.date_created.from': isoDia(de), 'order.date_created.to': isoFimDia(ate),
      sort: 'date_desc', limit: String(limite), offset: String(offset),
    })
    const pagina = await chamar(cliente, `/orders/search?${q}`)
    pedidos.push(...(pagina.results || []))
    offset += limite
    // a API do ML limita offset a 1000 — acima disso seria preciso dividir por data
    if (!pagina.results?.length || offset >= (pagina.paging?.total ?? 0) || offset >= 1000) {
      if (offset >= 1000 && (pagina.paging?.total ?? 0) > 1000) pedidos.truncado = true   // amostra, não o total
      break
    }
  }
  return pedidos
}

// Visitas totais do catálogo no período — soma por item ativo, em lotes de
// 20 (limite da API). Best-effort: catálogos grandes custam mais chamadas;
// se falhar, o relatório mostra "—" em vez de inventar um número.
async function listarItemIdsAtivos(cliente) {
  const userId = idDoVendedor(cliente)
  const ids = []
  let offset = 0
  while (true) {
    const r = await chamar(cliente, `/users/${userId}/items/search?status=active&limit=100&offset=${offset}`, { permitirFalha: true })
    if (r._erro) break
    ids.push(...(r.results || []))
    offset += 100
    if (!r.results?.length || offset >= (r.paging?.total ?? 0) || offset >= 1000) break
  }
  return ids
}

export async function visitasNoPeriodo(cliente, { de, ate }) {
  // 1 chamada: visitas de TODOS os anúncios da conta no período (inclui pausados/encerrados)
  const userId = idDoVendedor(cliente)
  const conta = userId && await chamar(cliente, `/users/${userId}/items_visits?date_from=${de}&date_to=${ate}`, { permitirFalha: true })
  if (conta && !conta._erro && Number.isFinite(conta.total_visits)) return conta.total_visits
  const ids = await listarItemIdsAtivos(cliente)
  if (!ids.length) return null
  let total = 0, ok = 0
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20)
    const q = new URLSearchParams({ ids: lote.join(','), date_from: de, date_to: ate })
    const r = await chamar(cliente, `/visits/items?${q}`, { permitirFalha: true })
    if (r._erro) continue
    ok++
    for (const v of Array.isArray(r) ? r : Object.values(r)) total += typeof v === 'number' ? v : (v?.total_visits ?? 0)
  }
  return ok ? total : null            // todas as chamadas falharam = SEM DADO, nunca "0 visitas" 
}

// ── Relatório de negócio: as mesmas métricas do painel "Métricas → Negócio"
// do próprio Mercado Livre (vendas brutas, unidades, ticket, visitas,
// conversão, cancelamentos, devoluções). Devoluções são best-effort (API de
// Claims varia por conta) — indisponível vira "—", nunca um número inventado.
export async function relatorioNegocio(cliente, { de, ate }) {
  const [pagos, cancelados] = await Promise.all([
    buscarPedidos(cliente, { de, ate }, 'paid'),
    buscarPedidos(cliente, { de, ate }, 'cancelled').catch(() => null),   // falha = SEM DADO (null + motivo no relatório), nunca "0 cancelamentos"
  ])
  let faturamento = 0, unidades = 0
  for (const p of pagos) for (const it of p.order_items || []) {
    faturamento += (it.unit_price || 0) * (it.quantity || 0)
    unidades += it.quantity || 0
  }
  let valorCancelado = 0
  for (const p of cancelados || []) for (const it of p.order_items || []) valorCancelado += (it.unit_price || 0) * (it.quantity || 0)

  const vendas = pagos.length
  let visitas = null, devolvidas = null
  try { visitas = await visitasNoPeriodo(cliente, { de, ate }) } catch { /* fica indisponível */ }
  try {
    const userId = idDoVendedor(cliente)
    const q = new URLSearchParams({ player_id: String(userId), player_role: 'respondent', limit: '50' })
    const resp = await chamar(cliente, `/post-purchase/v2/claims/search?${q}`, { permitirFalha: true })
    if (!resp._erro) {
      const lista = resp.data || resp.results || []
      devolvidas = lista.filter(c => c.date_created && c.date_created.slice(0, 10) >= de && c.date_created.slice(0, 10) <= ate).length
    }
  } catch { /* fica indisponível */ }

  return {
    disponivel: true, de, ate,
    parcial: !!(pagos.truncado || cancelados?.truncado),   // true = janela com mais de 1000 pedidos: números são amostra
    faturamento: arred2(faturamento), unidades, vendas,
    preco_medio_unidade: unidades ? arred2(faturamento / unidades) : 0,
    preco_medio_venda: vendas ? arred2(faturamento / vendas) : 0,
    visitas, conversao: visitas ? Math.round((vendas / visitas) * 1000) / 10 : null,
    vendas_canceladas: cancelados ? cancelados.length : null, valor_cancelado: cancelados ? arred2(valorCancelado) : null,   // null => "—" + motivo (blocoMl)
    vendas_devolvidas: devolvidas,
  }
}

export async function relatorioVendas(cliente, { de, ate }) {
  const pedidos = await buscarPedidos(cliente, { de, ate })
  let receita = 0, unidades = 0
  for (const p of pedidos) {
    for (const item of p.order_items || []) {
      receita += (item.unit_price || 0) * (item.quantity || 0)
      unidades += item.quantity || 0
    }
  }
  return {
    disponivel: true,
    pedidos: pedidos.length,
    unidades,
    faturamento: Math.round(receita * 100) / 100,
    ticket_medio: pedidos.length ? Math.round((receita / pedidos.length) * 100) / 100 : 0,
    de, ate,
  }
}

export async function produtosMaisVendidos(cliente, { de, ate }, top = 10) {
  const pedidos = await buscarPedidos(cliente, { de, ate })
  const porItem = new Map()
  for (const p of pedidos) {
    for (const item of p.order_items || []) {
      const id = item.item?.id || item.item?.title
      if (!id) continue
      const atual = porItem.get(id) || { id, titulo: item.item?.title || id, unidades: 0, receita: 0 }
      atual.unidades += item.quantity || 0
      atual.receita += (item.unit_price || 0) * (item.quantity || 0)
      porItem.set(id, atual)
    }
  }
  const ordenados = [...porItem.values()].sort((a, b) => b.unidades - a.unidades).slice(0, top)
  const det = new Map((await detalhesItens(cliente, ordenados.map(p => p.id).filter(i => /^MLB\d+$/.test(i))).catch(() => [])).map(i => [i.id, i]))   // só link e foto: sem leitura cai no link do comprador
  return ordenados.map(p => ({
    ...p, receita: Math.round(p.receita * 100) / 100,
    url: det.get(p.id)?.permalink || urlComprador(p.id), thumb: det.get(p.id)?.thumbnail || '',
  }))
}

// Anúncio como o COMPRADOR vê (permalink público). Fallback só se a API não devolver o permalink.
export const urlComprador = id => /^MLB\d+$/.test(String(id)) ? `https://produto.mercadolivre.com.br/MLB-${String(id).slice(3)}` : ''

// multiget de anúncios em /items/bulk (formato em meli-bulk.js; o multiget antigo de /items sai do ar em 25/10/2026), lotes de 20 → corpos[].
// GUARDA: N ids pedidos e 0 corpos válidos = LANÇA (antes gravava 0 anúncios em silêncio e o plano saía sobre o estoque de ontem).
// Parcial (item 404/403 ou lote inteiro com erro) NÃO lança: os corpos lidos voltam com `parcial` { pedidos, lidos, por_status, blocos_falhos } e 1 linha de log.
export async function multiget(cliente, ids, attrs, { chamarFn = chamar, extra = '' } = {}) {
  const corpos = [], por_status = {}
  let blocos_falhos = 0
  for (let i = 0; i < ids.length; i += LOTE_BULK) {
    const lote = ids.slice(i, i + LOTE_BULK), l = lerLoteBulk(await chamarFn(cliente, urlBulk(lote, attrs, extra), { permitirFalha: true }), lote)
    corpos.push(...l.corpos)
    if (l.falhou) blocos_falhos++
    for (const [, st] of l.erros) por_status[st || '?'] = (por_status[st || '?'] || 0) + 1
  }
  const resumo = Object.entries(por_status).map(([s, k]) => `HTTP ${s}×${k}`).join(', ')
  if (ids.length && !corpos.length) throw new Error(`Mercado Livre não devolveu nenhum dos ${ids.length} anúncio(s) pedidos (${resumo || 'resposta vazia'}) — nada foi gravado`)
  if (corpos.length < ids.length) {
    corpos.parcial = { pedidos: ids.length, lidos: corpos.length, por_status, blocos_falhos }
    log('aviso', `multiget de anúncios (${cliente}): ${corpos.length} de ${ids.length} lidos (${resumo || 'ids sem resposta'}) — os demais mantêm a leitura anterior`)
  }
  return corpos
}

// campos da visão do comprador + as CHAVES do produto (V3 F1: user_product_id, inventory_id, seller_custom_field, attributes → SELLER_SKU, variations, tags):
// o mesmo número de chamadas, payload ~1,9× (151 → 286 KB por lote de 20 no Uniaodog, 14/10/2026; latência dentro do ruído). include_attributes=all traz o SELLER_SKU
// de cada variação (sem ele variations[] vem sem `attributes`; 357 KB por lote, a mesma chamada — revisão da F1, 1 GET real em 14/10/2026)
export const detalhesItens = (cliente, ids, opts) => multiget(cliente, ids, 'id,title,price,original_price,permalink,thumbnail,pictures,shipping,catalog_listing,catalog_product_id,listing_type_id,condition,sold_quantity,available_quantity,health,date_created,status,category_id,user_product_id,inventory_id,seller_custom_field,attributes,variations,tags', { ...opts, extra: 'include_attributes=all' })

// ── 3. Ofertas ativas — API de Promoções do vendedor ──────────────────────
// Endpoint mais recente do ML (pode exigir ajuste conforme a versão vigente
// da conta — validar após a primeira conexão real e corrigir aqui se preciso).
export async function relatorioOfertas(cliente) {
  const userId = idDoVendedor(cliente)
  if (!userId) return { disponivel: false, motivo: 'conta não conectada' }
  const resp = await chamar(cliente, `/seller-promotions/users/${userId}?app_version=v2`, {
    headers: { 'x-format-new': 'true' }, permitirFalha: true,
  })
  if (resp._erro) return { disponivel: false, motivo: `API de promoções retornou ${resp.status} — pode não estar habilitada para esta conta` }
  const promocoes = Array.isArray(resp) ? resp : resp.results || []
  return {
    disponivel: true,
    total: promocoes.length,
    promocoes: promocoes.slice(0, 20).map(p => ({
      tipo: p.type || p.promotion_type || '—',
      status: p.status || '—',
      inicio: p.date_from || p.start_date || '',
      fim: p.date_to || p.finish_date || '',
    })),
  }
}

// ── 4. Ads (Product Ads / Mercado Ads) ────────────────────────────────────
// Exige que a conta tenha Ads habilitado. Fluxo: lista o(s) advertiser_id(s)
// do vendedor → lista campanhas → soma as métricas do período por campanha.
export async function relatorioAds(cliente, { de, ate }) {
  const r = await adsPorAnuncio(cliente, { de, ate })
  if (!r.disponivel) return r
  const s = r.resumo
  if (!(s.cost > 0 || s.clicks > 0)) return { disponivel: false, motivo: 'nenhum gasto em Ads no período' }
  return {
    disponivel: true,
    investimento: arred2(s.cost), receita: arred2(s.total_amount || 0),
    roas: s.cost ? Math.round((s.total_amount / s.cost) * 100) / 100 : null,
    acos: s.total_amount ? Math.round((s.cost / s.total_amount) * 10000) / 100 : null,
    vendas_atribuidas: s.units_quantity || 0, cliques: s.clicks || 0, impressoes: s.prints || 0,
    campanhas: r.itens.filter(a => a.metrics?.cost > 0).sort((a, b) => b.metrics.cost - a.metrics.cost).slice(0, 10)
      .map(a => ({ nome: a.title, status: a.status, custo: a.metrics.cost })),
  }
}

// Product Ads POR ANÚNCIO (endpoint atual): impressões, cliques, CTR, custo, ACOS, ROAS, receita atribuída,
// buy_box_winner e tipo logístico. Métricas de Ads valem só para anúncios que anunciam — o orgânico não vem daqui.
export async function adsPorAnuncio(cliente, { de, ate }) {
  const adv = await chamar(cliente, '/advertising/advertisers?product_id=PADS', { headers: { 'Api-Version': '1' }, permitirFalha: true })
  const advId = adv.advertisers?.[0]?.advertiser_id
  if (adv._erro || !advId) return { disponivel: false, motivo: 'conta sem Ads (Product Ads) habilitado ou sem permissão de leitura' }
  const metricas = 'clicks,prints,cost,cpc,ctr,acos,roas,direct_amount,indirect_amount,total_amount,units_quantity'
  const itens = []
  let resumo = null, completo = false
  for (let off = 0; off < 2000; off += 50) {
    const q = `/advertising/MLB/advertisers/${advId}/product_ads/ads/search?limit=50&offset=${off}&date_from=${de}&date_to=${ate}&metrics=${metricas}&metrics_summary=true`
    const r = await chamar(cliente, q, { headers: { 'Api-Version': '2' }, permitirFalha: true })
    if (r._erro) { if (off === 0) return { disponivel: false, motivo: `API de Ads retornou ${r.status}` }; break }
    resumo = resumo || r.metrics_summary || {}
    itens.push(...(r.results || []))
    if (off + 50 >= (r.paging?.total ?? 0)) { completo = true; break }
  }
  return { disponivel: true, advertiser_id: advId, resumo: resumo || {}, itens, completo }
}

// TACOS (Total Advertising Cost of Sale) = investimento em Ads ÷ faturamento
// TOTAL da conta no período (não só o atribuído aos anúncios) — é o mesmo
// cálculo que o painel "Meu orçamento" do Mercado Livre mostra.
export const calcularTacos = (investimentoAds, faturamentoTotal) =>
  faturamentoTotal ? Math.round((investimentoAds / faturamentoTotal) * 10000) / 100 : null
