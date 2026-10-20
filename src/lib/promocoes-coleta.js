// Coleta de promoções por cliente — SOMENTE LEITURA (só GET; nenhum POST/PUT/DELETE existe neste arquivo).
// Fluxo (porte do carga_todos_elegiveis_gs): (A) campanhas do vendedor → (B) itens por campanha, paginando por
// search_after → (C) detalhes dos anúncios (SKU em camadas, status, under_review) → (D) oferta VIVA por anúncio
// → (E) tarifa/frete só de quem precisa → grava tudo atomicamente + foto da rodada (campanha derrubada antes do prazo).
// Uma falha de um anúncio NUNCA derruba a coleta; dado indisponível vira NOT_AUTHORIZED / NOT_AVAILABLE declarado.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { num, ehRebate, ehRelampago, tipoRebateConhecido, compararRodadas } from './promocoes-mc.js'
import * as repo from './promocoes-db.js'
import { vinculosCusto } from './custos-db.js'
import { urlBulk, lerLoteBulk, LOTE_BULK } from './meli-bulk.js'          // formato do /items/bulk (puro: este módulo não carrega meli-api.js, que abre o banco)
import { resolverSku } from './produto-estoque.js'                                  // puro (sem banco), como meli-bulk.js

// ── coleta para todos, em lotes por madrugada (config/promocoes.json) ──────────────────────────────
export const cfgColeta = JSON.parse(readFileSync(join(ROOT, 'config', 'promocoes.json'), 'utf-8'))
// interruptor por cliente (perfil_cliente.coleta_promocoes): 1/true liga, 0/false desliga, null = padrão da base (coleta_para_todos)
export const coletaLigada = (valorCliente, cfg = cfgColeta) => valorCliente == null ? cfg.coleta_para_todos !== false : valorCliente === 1 || valorCliente === true
// quem entra na madrugada: só ligados; quem nunca coletou primeiro, depois a coleta mais antiga; até `lote`. lista: [{ cliente, coleta: concluida_em|null, ligada }]
export const loteNoturno = (lista, lote = cfgColeta.lote_por_madrugada) => lista.filter(c => c.ligada)
  .sort((a, b) => (a.coleta ? 1 : 0) - (b.coleta ? 1 : 0) || String(a.coleta || '').localeCompare(String(b.coleta || '')) || String(a.cliente).localeCompare(String(b.cliente)))
  .slice(0, Math.max(0, Math.trunc(Number(lote)) || 0))

const dormir = ms => new Promise(r => setTimeout(r, ms))
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const descartada = motivo => Object.assign(erro(`coleta descartada: ${motivo} — nada foi gravado; colete de novo`, 409), { descartada: true })
const lotes = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))
const ITENS_ATTR = 'id,title,price,original_price,status,sub_status,available_quantity,category_id,listing_type_id,seller_custom_field,attributes,user_product_id,catalog_listing,permalink,variations,tags'
const PONTOS_FRETE = [18.9, 48.9, 78.9, 99.9, 119.9, 149.9, 199.9, 250]          // um preço por faixa do degrau: <19 <49 <79 <100 <120 <150 <200 200+
const LIMITES_FRETE = [19, 49, 79, 100, 120, 150, 200, null]

// 401/403 = sem autorização · 404/400 = endpoint/recurso indisponível · 0 = rede · 5xx = ML fora
export const estadoDoErro = r => (r.status === 401 || r.status === 403 ? 'NOT_AUTHORIZED' : r.status === 0 ? 'NETWORK_ERROR' : r.status >= 500 ? 'ML_INDISPONIVEL' : 'NOT_AVAILABLE')
export const ehUnderReview = r => r?._erro && r.status === 400 && /under_review/i.test(r.corpo || '')
// erro POR ITEM no multiget que não passa sozinho (anúncio removido/bloqueado: 403/404/410 e demais 4xx) × transitório (429/408/5xx/rede/sem código).
// Só o transitório deixa a coleta PARCIAL; o permanente vira "sem leitura" declarada (senão um único anúncio morto travava o analista para sempre). 401 = token: nunca é por item.
export const ehErroPermanente = code => Number.isInteger(code) && code >= 400 && code < 500 && ![401, 408, 425, 429].includes(code)

// GET sequencial com pausa entre chamadas e retry em 429/5xx. Nunca lança: devolve { _erro, status, corpo }.
async function ler(ctx, caminho) {
  for (let t = 0; ; t++) {
    let r
    try { r = await ctx.chamar(ctx.cliente, caminho, { permitirFalha: true }) } catch (e) { r = { _erro: true, status: 0, corpo: String(e.message).slice(0, 200) } }
    ctx.chamadas++
    await dormir(ctx.espera)
    if (!r?._erro) return r
    if ([429, 500, 502, 503, 504].includes(r.status) && t < ctx.tentativas - 1) { await dormir(ctx.espera * 6 * (t + 1)); continue }
    return r
  }
}

// oferta crua da API (do anúncio OU da listagem da campanha) → formato único do módulo
export function normalizarOferta(raw, padrao = {}) {
  const pid = raw.id || raw.promotion_id || padrao.pid || raw.type || 'SEM-ID'
  const preco = num(raw.price)
  return {
    pid: String(pid), offer_id: String(raw.ref_id || raw.offer_id || ''), tipo: String(raw.type || raw.promotion_type || padrao.tipo || ''), subtipo: String(raw.sub_type || ''),
    nome: String(raw.name || padrao.nome || ''), status: String(raw.status || '').toLowerCase(),
    preco: preco > 0 ? preco : null,                                   // price 0 = DEAL/cupom sem preço utilizável (§13-bis) — nunca tratar 0 como preço
    preco_original: num(raw.original_price), meli_pct: num(raw.meli_percentage ?? raw.meli_percent), seller_pct: num(raw.seller_percentage ?? raw.seller_percent),
    inicio: raw.start_date || '', fim: raw.finish_date || raw.end_date || '',
    min_preco: num(raw.min_discounted_price), max_preco: num(raw.max_discounted_price), sugerido: num(raw.suggested_discounted_price),
  }
}

// SKU em camadas (regras-promocoes.md §3): movida para produto-estoque.js (puro, mesma precedência) — reexportada aqui para quem já importa deste módulo.
// Não portada: a camada 1 (order.seller_sku da venda real) — este módulo não lê pedidos item a item (a V3 grava em meli_pedido_item).
export { resolverSku }

// pagina até o fim (teto de segurança alto, DECLARADO se atingido). completa=false => leitura essencial incompleta => coleta PARCIAL
const MAX_LISTAGEM = 5000
async function listarCampanhas(ctx, uid, limites) {
  const out = []
  let completa = true
  for (let off = 0; ; off += 50) {
    if (off >= MAX_LISTAGEM) { ctx.falhas++; completa = false; limites.push({ codigo: 'LISTAGEM_TRUNCADA', estado: 'PARCIAL', texto: `a listagem de campanhas passou do teto de segurança (${MAX_LISTAGEM}) — lista parcial` }); break }
    const r = await ler(ctx, `/seller-promotions/users/${uid}?app_version=v2&limit=50&offset=${off}`)
    if (r._erro) {
      if (off === 0) throw erro(`a API de promoções devolveu ${r.status} (${estadoDoErro(r)}) — ${r.corpo || 'sem detalhe'}`, 502)
      ctx.falhas++; completa = false
      limites.push({ codigo: 'LISTAGEM_PAGINA', estado: estadoDoErro(r), texto: `página ${off / 50 + 1} da listagem de campanhas falhou (${r.status}) — lista parcial` }); break
    }
    const lista = Array.isArray(r) ? r : r.results || []
    for (const p of lista) out.push({ pid: String(p.id), tipo: String(p.type || ''), subtipo: String(p.sub_type || ''), nome: String(p.name || ''), status: String(p.status || '').toLowerCase(),
      inicio: p.start_date || '', fim: p.finish_date || '', prazo: p.deadline_date || '', origem: 'listagem' })
    const total = r.paging?.total                                       // sem total: só para na página incompleta (nunca assume que a 1ª página era tudo)
    if (!lista.length || (total != null ? off + 50 >= total : lista.length < 50)) break
  }
  return { campanhas: out, completa }
}

async function itensDaCampanha(ctx, c, maxPaginas, limites) {
  const ids = new Set()
  let sa = null, paginas = 0
  do {
    const q = `/seller-promotions/promotions/${encodeURIComponent(c.pid)}/items?promotion_type=${encodeURIComponent(c.tipo)}&app_version=v2&limit=50${sa ? `&search_after=${encodeURIComponent(sa)}` : ''}`
    const r = await ler(ctx, q)
    if (r._erro) { ctx.falhas++; limites.push({ codigo: 'ITENS_DA_CAMPANHA', estado: estadoDoErro(r), texto: `itens da campanha ${c.pid} (${c.nome || c.tipo}): ${r.status} — ${(r.corpo || '').slice(0, 100)}` }); break }
    for (const x of r.results || []) if (x.id) ids.add(String(x.id))
    sa = r.paging?.searchAfter || null
    if (!(r.results || []).length) break
  } while (sa && ++paginas < maxPaginas)
  if (sa && paginas >= maxPaginas) { ctx.falhas++; limites.push({ codigo: 'CAMPANHA_TRUNCADA', estado: 'PARCIAL', texto: `campanha ${c.pid}: limite de ${maxPaginas} páginas atingido — lista de itens parcial` }) }
  return ids
}

// oferta VIVA do anúncio (a fonte da verdade da participação; sempre re-buscada) — usada também pelo plano e pelo executor
export async function buscarOfertasDoItem(ctx, itemId) {
  const r = await ler(ctx, `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`)
  if (ehUnderReview(r)) return { ok: false, underReview: true, erro: 'under_review' }
  if (r._erro) return { ok: false, erro: `${estadoDoErro(r)} (${r.status})`, status: r.status }
  return { ok: true, ofertas: (Array.isArray(r) ? r : r.results || []).filter(o => o && typeof o === 'object').map(o => normalizarOferta(o)) }
}
export const criarContexto = async (cliente, deps = {}) => ({
  cliente, chamar: deps.chamar || (await import('./meli-api.js')).chamar, espera: deps.espera ?? 150, tentativas: 3, chamadas: 0, falhas: 0,   // falhas = leituras ESSENCIAIS que não completaram (=> coleta parcial)
})

// tarifa (comissão % + taxa fixa) e frete por faixa — SÓ de quem tem custo em R$ e rebate em jogo (evita ~10 chamadas/anúncio à toa)
// ponytail: tarifa medida no preço de referência; candidato em outra faixa de taxa fixa pode diferir (declarado nos docs)
export async function coletarTarifa(ctx, uid, a, precoRef) {
  const lp = await ler(ctx, `/sites/MLB/listing_prices?price=${precoRef}&listing_type_id=${encodeURIComponent(a.tipo_anuncio)}&category_id=${encodeURIComponent(a.categoria)}`)
  const det = (Array.isArray(lp) ? lp[0] : lp)?.sale_fee_details
  if (lp._erro || !det || num(det.percentage_fee) == null) return { estado: lp._erro ? estadoDoErro(lp) : 'NOT_AVAILABLE', tarifa: null }
  const faixas = []
  for (let i = 0; i < PONTOS_FRETE.length; i++) {
    const f = await ler(ctx, `/users/${uid}/shipping_options/free?item_id=${a.item_id}&item_price=${PONTOS_FRETE[i]}`)
    const v = num(f?.coverage?.all_country?.list_cost)
    if (f._erro || v == null) return { estado: f._erro ? estadoDoErro(f) : 'NOT_AVAILABLE', tarifa: { comissao_pct: num(det.percentage_fee), taxa_fixa: num(det.fixed_fee) || 0, faixas: null, precoRef } }
    faixas.push({ ate: LIMITES_FRETE[i], valor: v })
  }
  return { estado: 'ok', tarifa: { comissao_pct: num(det.percentage_fee), taxa_fixa: num(det.fixed_fee) || 0, faixas, precoRef, medido_em: new Date().toISOString() } }
}

// Tetos de segurança (altos): se algum for atingido NÃO é silencioso — vira limite declarado com código estável.
// Estado final (contrato): 'concluida' só se TODAS as leituras essenciais (campanhas, itens, detalhes, ofertas) completaram;
// 'parcial' se alguma falhou (resumo.leituras_falhas); falha total das ofertas = 'erro' (nada essencial foi lido; dados anteriores intactos).
export async function coletarPromocoes(cliente, { aoProgredir, deps = {}, maxPaginas = 400, maxTarifas = 300, maxUserProducts = 1500, por = 'sistema' } = {}) {      // por = quem disparou (auditoria)
  const ctx = await criarContexto(cliente, deps)
  const lerUid = 'uid' in deps ? () => deps.uid : (await import('./meli-contas.js')).idDoVendedor.bind(null, cliente)     // relido ANTES de gravar: a conta pode ser trocada no meio da coleta
  const uid = lerUid()
  if (!uid) throw erro('conta Mercado Livre não conectada para este cliente', 409)
  const coletaId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), t0 = Date.now(), limites = []     // sufixo: duas coletas no mesmo ms nunca dividem o carimbo
  const prog = (fase, feitos, total) => aoProgredir?.({ fase, feitos, total, cliente })
  repo.iniciarColeta(cliente, coletaId, uid)                                            // dona do estado: coleta_id + conta ML (a mais nova assume; a anterior é descartada ao gravar)
  try {
    const hoje = repo.hojeLocal()
    const previos = new Map(repo.lerAnuncios(cliente).map(a => [a.item_id, a]))        // leitura anterior: nunca é apagada por uma leitura que falhou
    const fat30 = repo.faturamento30(cliente, hoje), fat = fat30.porItem               // prioriza (maior faturamento primeiro) quando algum teto corta e vai para promo_anuncio.fat30
    const prio = id => fat.get(id)?.fat || 0
    // (A) campanhas
    prog('campanhas', 0, 1)
    const { campanhas, completa: listagemCompleta } = await listarCampanhas(ctx, uid, limites)
    const camps = new Map(campanhas.map(c => [c.pid, c]))
    // (B) itens por campanha — descoberta do universo (a verdade da participação vem do item, passo D)
    const universo = new Set()
    let i = 0
    for (const c of campanhas) { prog('itens por campanha', i++, campanhas.length); if (c.tipo) for (const id of await itensDaCampanha(ctx, c, maxPaginas, limites)) universo.add(id); else { ctx.falhas++; limites.push({ codigo: 'CAMPANHA_SEM_TIPO', estado: 'NOT_AVAILABLE', texto: `campanha ${c.pid} sem tipo na listagem — itens não listados` }) } }
    for (const id of deps.itensExtras || []) universo.add(id)
    try { for (const r of repo.db.prepare("SELECT item_id FROM meli_item WHERE cliente = ? AND status NOT IN ('closed','inactive')").all(cliente)) universo.add(r.item_id) } catch { /* tabela do Place Sprints ausente (teste) */ }
    for (const r of previos.values()) if (!['closed', 'inactive'].includes(r.status)) universo.add(r.item_id)
    const ids = [...universo].filter(x => /^MLB\d+$/.test(x))
    // (C) detalhes dos anúncios (/items/bulk, lotes de 20). Bloco que falha NÃO vira anúncio vazio: o anúncio fica "sem detalhe" e mantém o dado anterior.
    // A guarda "N pedidos e 0 corpos" daqui é a própria: nada lido = "sem detalhe" DECLARADO (PARCIAL, dado anterior mantido) e, se tudo for 4xx por item, ERRO abaixo.
    const det = new Map(), statusSemDetalhe = new Set(), permanentes = new Map()      // permanentes: item → HTTP (4xx por item; o bulk traz o id na raiz)
    const blocos = lotes(ids, LOTE_BULK)
    for (let b = 0; b < blocos.length; b++) {
      prog('anúncios', b, blocos.length)
      const r = await ler(ctx, urlBulk(blocos[b], ITENS_ATTR)), l = lerLoteBulk(r, blocos[b])
      if (l.falhou) { statusSemDetalhe.add(r?.status ?? 'resposta inválida'); continue }      // bloco inteiro falhou: nunca é "por item" (falha fechada → PARCIAL)
      for (const c of l.corpos) det.set(c.id, c)
      for (const [id, st] of l.erros) if (st) { statusSemDetalhe.add(st); if (ehErroPermanente(st) && id) permanentes.set(id, st) }     // sem como atribuir o item (sem id) = transitório
    }
    const semDetalhe = ids.filter(id => !det.has(id) && !permanentes.has(id))
    if (semDetalhe.length) {
      ctx.falhas += semDetalhe.length
      limites.push({ codigo: 'DETALHE_ANUNCIOS', estado: 'NOT_AVAILABLE', texto: `${semDetalhe.length} anúncio(s) sem detalhes (HTTP ${[...statusSemDetalhe].join('/') || '?'}) — mantêm os dados da leitura anterior (SKU, status, under_review) e a coleta fica PARCIAL` })
    }
    // erro PERMANENTE por item: não trava a coleta (as leituras essenciais restantes decidem). O item fica "sem leitura" DECLARADO: último dado marcado VELHO,
    // ofertas descartadas (nada de participando/elegível congelado) e o analista não decide sobre ele. Se NADA foi lido, não é por item (token/permissão): erro.
    if (ids.length && permanentes.size === ids.length)
      throw erro(`nenhum anúncio pôde ser lido (HTTP ${[...new Set(permanentes.values())].join('/')} em todos os ${ids.length}) — coleta descartada, os dados anteriores foram mantidos`, 502)
    if (permanentes.size) {
      const lista = [...permanentes.keys()]
      limites.push({ codigo: 'ANUNCIOS_SEM_LEITURA', estado: 'NOT_AVAILABLE', ids: lista.slice(0, 200),
        texto: `${lista.length} anúncio(s) sem leitura (HTTP ${[...new Set(permanentes.values())].join('/')}, o ML não os entrega): ${lista.slice(0, 20).join(', ')}${lista.length > 20 ? ` e mais ${lista.length - 20}` : ''} — o último dado deles está VELHO, as ofertas foram descartadas e o analista NÃO decide sobre eles (confira no painel do ML)` })
    }
    // SKU: camada user-products só para quem ficou sem SKU — maior faturamento primeiro; o que passar do teto é DECLARADO
    const semSkuTodos = [...det.values()].filter(x => !resolverSku(x).sku && x.user_product_id).sort((a, b) => prio(b.id) - prio(a.id))
    const semSku = semSkuTodos.slice(0, maxUserProducts)
    const userProducts = new Map()
    let upFalhas = 0
    for (const x of semSku) { const r = await ler(ctx, `/user-products/${encodeURIComponent(x.user_product_id)}`); if (r._erro) upFalhas++; else userProducts.set(x.id, r) }
    if (semSkuTodos.length > semSku.length) limites.push({ codigo: 'SKU_USER_PRODUCTS_TRUNCADO', estado: 'PARCIAL', texto: `${semSkuTodos.length - semSku.length} anúncio(s) sem SKU não foram consultados no user-products (teto de ${maxUserProducts} por coleta; prioridade = maior faturamento 30d) — SKU NÃO RESOLVIDO, não é custo ausente` })
    if (upFalhas) limites.push({ codigo: 'SKU_USER_PRODUCTS_FALHA', estado: 'NOT_AVAILABLE', texto: `${upFalhas} consulta(s) ao user-products falharam — o SKU resolvido antes é mantido; sem SKU anterior, o anúncio segue sem SKU (SKU NÃO RESOLVIDO)` })
    // (D) oferta viva por anúncio
    // ofertasPerm: erro PERMANENTE no GET de ofertas do anúncio (400/403/404/410 — ex.: anúncio pausado) = mesma regra do multiget: "sem leitura" DECLARADA,
    // ofertas descartadas, não soma em leituras_falhas (senão um anúncio pausado deixava a coleta PARCIAL para sempre). Transitório (429/5xx/rede) segue PARCIAL.
    const ofertasPorItem = new Map(), underReview = new Set(), falhas = new Map(), ofertasPerm = new Map()
    const ativos = ids.filter(id => !permanentes.has(id) && !['closed', 'inactive'].includes(det.get(id)?.status))
    for (let k = 0; k < ativos.length; k++) {
      prog('ofertas por anúncio', k, ativos.length)
      const r = await buscarOfertasDoItem(ctx, ativos[k])
      if (r.ok) ofertasPorItem.set(ativos[k], r.ofertas)
      else if (r.underReview) underReview.add(ativos[k])
      else if (ehErroPermanente(r.status)) ofertasPerm.set(ativos[k], r.erro)
      else falhas.set(ativos[k], r.erro)
    }
    // campanhas vistas SÓ na oferta do anúncio = a listagem as escondia (limitação declarada, parcialmente contornada)
    let ocultas = 0
    for (const ofertas of ofertasPorItem.values()) for (const o of ofertas) {
      if (!o.pid || o.pid === 'SEM-ID' || camps.has(o.pid) || o.pid === o.tipo) continue
      camps.set(o.pid, { pid: o.pid, tipo: o.tipo, subtipo: o.subtipo, nome: o.nome, status: o.status === 'candidate' ? '' : o.status, inicio: o.inicio, fim: o.fim, prazo: '', origem: 'item' })
      ocultas++
    }
    limites.unshift({
      codigo: 'LISTAGEM_ESCONDE_CAMPANHAS', estado: 'NOT_AVAILABLE',
      texto: `A listagem /seller-promotions/users pode ESCONDER campanhas vivas (caso 30/09/2026 no DropX). Aqui não há o BFF do painel: só enxergamos campanhas que aparecem na listagem OU na oferta de algum anúncio lido (${ocultas} descoberta(s) por este segundo caminho). Campanha viva sem nenhum anúncio lido continua invisível — confira no painel do ML.`,
    })
    for (const ofertas of ofertasPorItem.values()) for (const o of ofertas) if (!o.nome) o.nome = camps.get(o.pid)?.nome || ''     // relâmpago é detectado pelo NOME
    // flags das campanhas: rebate (por tipo ou por meli% observado) e relâmpago
    const rebatePid = new Set(), tiposNovos = new Set()
    for (const ofertas of ofertasPorItem.values()) for (const o of ofertas) if (ehRebate(o)) { rebatePid.add(o.pid); if (!tipoRebateConhecido(o.tipo)) tiposNovos.add(o.tipo) }
    const listaCamps = [...camps.values()].map(c => ({ ...c, rebate: tipoRebateConhecido(c.tipo) || rebatePid.has(c.pid) ? 1 : 0, relampago: ehRelampago(c) ? 1 : 0 }))
    if (tiposNovos.size) limites.push({ codigo: 'TIPO_NOVO_COM_REBATE', estado: 'ATENCAO', texto: `tipo(s) fora da lista de rebate com meli% > 0: ${[...tiposNovos].join(', ')} — tratados como rebate pela definição primária (meli_percentage > 0)` })
    if (underReview.size) limites.push({ codigo: 'UNDER_REVIEW', estado: 'NOT_AVAILABLE', texto: `${underReview.size} anúncio(s) under_review: o ML devolve 400 e não aceita promoção até a revisão terminar` })
    if (falhas.size) limites.push({ codigo: 'OFERTAS_SEM_LEITURA', estado: 'NOT_AVAILABLE', texto: `${falhas.size} anúncio(s) sem leitura de ofertas (${[...new Set(falhas.values())].join('; ')}) — mantêm a leitura anterior e contam como cobertura DESCONHECIDA` })
    if (ofertasPerm.size) {
      const lista = [...ofertasPerm.keys()]
      limites.push({ codigo: 'OFERTAS_INDISPONIVEIS', estado: 'NOT_AVAILABLE', ids: lista.slice(0, 200),
        texto: `${lista.length} anúncio(s) com as ofertas indisponíveis no ML (${[...new Set(ofertasPerm.values())].join('; ')} — erro permanente, ex.: anúncio pausado): ${lista.slice(0, 20).join(', ')}${lista.length > 20 ? ` e mais ${lista.length - 20}` : ''} — ofertas descartadas, cobertura DESCONHECIDA e o analista NÃO decide sobre eles (confira no painel do ML)` })
    }
    // leituras essenciais que falharam (listagem, itens da campanha, detalhes, ofertas) => coleta PARCIAL; nenhuma oferta lida => ERRO (nada é gravado por cima)
    const leiturasFalhas = ctx.falhas + falhas.size
    if (ativos.length && !ofertasPorItem.size && !underReview.size)      // nada lido (nem por erro permanente) não é "por anúncio": token/permissão/ML fora
      throw erro(`nenhuma leitura de ofertas completou (${ativos.length} anúncio(s): ${[...new Set([...falhas.values(), ...ofertasPerm.values()])].join('; ') || 'sem detalhe'}) — coleta descartada, os dados anteriores foram mantidos`, 502)
    const estado = leiturasFalhas ? 'parcial' : 'concluida'
    // (anúncios p/ gravar)
    const anuncios = ids.map(id => {
      const x = det.get(id) || {}
      let { sku, fonte } = resolverSku(x, userProducts.get(id))
      const p = previos.get(id)
      if (!sku && x.user_product_id && !userProducts.has(id) && p?.sku && p.sku_fonte === 'user-products' && p.user_product_id === x.user_product_id) { sku = p.sku; fonte = p.sku_fonte }   // user-products não respondeu/ficou fora do teto: mantém o SKU já resolvido
      const ur = underReview.has(id) || x.status === 'under_review'
      return { item_id: id, sku, sku_fonte: fonte, titulo: x.title || '', permalink: x.permalink || '', status: x.status || '', sub_status: Array.isArray(x.sub_status) ? x.sub_status.join(',') : String(x.sub_status || ''),
        under_review: ur ? 1 : 0, preco: num(x.price), preco_original: num(x.original_price), estoque: x.available_quantity ?? null, categoria: x.category_id || '', tipo_anuncio: x.listing_type_id || '',
        catalogo: x.catalog_listing ? 1 : 0, user_product_id: x.user_product_id || '',
        fat30: fat30.disponivel ? Math.round(prio(id) * 100) / 100 : null,      // faturamento 30d (pedidos pagos) = o de carregarEntrada; série indisponível não vira 0 (mantém o gravado)
        tarifa_json: falhas.has(id) ? p?.tarifa_json || '' : '', tarifa_estado: falhas.has(id) ? p?.tarifa_estado || '' : '',     // ofertas sem leitura mantêm a leitura anterior — tarifa inclusa
        oferta_erro: falhas.get(id) || (permanentes.has(id) ? `sem leitura (HTTP ${permanentes.get(id)}, o ML não entrega este anúncio): último dado VELHO, ofertas descartadas — o analista não decide sobre ele`
          : ofertasPerm.has(id) ? `ofertas sem leitura (${ofertasPerm.get(id)}, o ML não as entrega — ex.: anúncio pausado): ofertas descartadas — o analista não decide sobre ele` : det.has(id) ? '' : 'sem detalhes do anúncio (leitura falhou; mantém os dados anteriores)'),
        sem_detalhe: det.has(id) ? 0 : 1, sem_leitura: permanentes.has(id) || ofertasPerm.has(id) ? 1 : 0 }
    })
    // (E) tarifa/frete de quem tem custo em R$ e rebate em jogo — maior faturamento primeiro; o que passar do teto é "tarifa NÃO COLETADA" (nunca "SEM CUSTO")
    const custos = vinculosCusto.custosDosAnuncios(cliente, anuncios)      // mesma régua do analista: custo do anúncio pela resolução única (vínculo manual incluso)
    const todosPrecisam = anuncios.filter(a => custos.has(a.item_id) && a.categoria && a.tipo_anuncio && (ofertasPorItem.get(a.item_id) || []).some(o => ehRebate(o))).sort((a, b) => prio(b.item_id) - prio(a.item_id))
    const precisam = todosPrecisam.slice(0, maxTarifas), foraDoTeto = todosPrecisam.slice(maxTarifas)
    const recente = p => p?.tarifa_estado === 'ok' && Date.now() - Date.parse(p.tarifa?.medido_em) < 7 * 864e5       // tarifa medida há < 7 dias vale até a próxima coleta
    for (const a of foraDoTeto) { const p = previos.get(a.item_id); if (recente(p)) { a.tarifa_json = p.tarifa_json; a.tarifa_estado = 'ok' } else a.tarifa_estado = 'NAO_COLETADA' }
    const naoColetadas = foraDoTeto.filter(a => a.tarifa_estado === 'NAO_COLETADA').length
    if (naoColetadas) limites.push({ codigo: 'TARIFA_NAO_COLETADA', estado: 'PARCIAL', texto: `${naoColetadas} anúncio(s) com custo e rebate em jogo ficaram SEM tarifa/frete coletados (teto de ${maxTarifas} por coleta; prioridade = maior faturamento 30d). Tarifa NÃO COLETADA — não é falta de custo; sem recomendação até a próxima coleta` })
    for (let k = 0; k < precisam.length; k++) {
      prog('tarifa e frete', k, precisam.length)
      const ofs = ofertasPorItem.get(precisam[k].item_id), ref = Math.max(...ofs.map(o => o.preco_original || 0), precisam[k].preco_original || 0, precisam[k].preco || 0)
      if (!(ref > 0)) continue
      const t = await coletarTarifa(ctx, uid, precisam[k], ref)
      precisam[k].tarifa_json = t.tarifa ? JSON.stringify(t.tarifa) : ''; precisam[k].tarifa_estado = t.estado
    }
    if (precisam.some(a => a.tarifa_estado && a.tarifa_estado !== 'ok')) limites.push({ codigo: 'TARIFA_FRETE', estado: 'NOT_AVAILABLE', texto: 'tarifa/frete por anúncio indisponíveis para parte dos SKUs com custo — MC cai no fallback percentual (custos_cliente) ou fica "SEM TARIFA/FRETE"' })

    // resumo e foto da rodada
    let ofertas = 0, candidatas = 0, started = 0, pending = 0
    const itensRebate = new Set()
    const participacoes = []
    for (const [id, ofs] of ofertasPorItem) for (const o of ofs) {
      ofertas++
      if (o.status === 'candidate') { candidatas++; if (ehRebate(o)) itensRebate.add(id) }
      if (o.status === 'started') started++
      if (o.status === 'pending') pending++
      // fim = o da PARTICIPAÇÃO (oferta). O fim da campanha-mãe vai à parte: SMART que acaba no prazo da campanha não tem data própria
      // e NÃO pode virar "derrubada antes do prazo" (sem fim próprio a comparação a classifica como sem prazo, nunca como derrubada)
      if (['started', 'pending'].includes(o.status)) participacoes.push({ item_id: id, pid: o.pid, status: o.status, fim: o.fim || '', fim_campanha: camps.get(o.pid)?.fim || '' })
    }
    const tipos = {}; for (const c of listaCamps) tipos[c.tipo || '?'] = (tipos[c.tipo || '?'] || 0) + 1
    const anterior = repo.ultimoSnapshot(cliente)
    const derrubadas = anterior ? compararRodadas(anterior, { participacoes, itens: [...ofertasPorItem.keys()] }, hoje) : null
    const resumo = {
      coleta_id: coletaId, estado, leituras_falhas: leiturasFalhas, tarifas_nao_coletadas: naoColetadas, campanhas: listaCamps.length, tipos, campanhas_rebate: listaCamps.filter(c => c.rebate).length, campanhas_ocultas_na_listagem: ocultas,
      anuncios: anuncios.length, anuncios_lidos: ofertasPorItem.size, anuncios_sem_leitura: falhas.size + permanentes.size + ofertasPerm.size, under_review: underReview.size,
      ofertas, candidatas, started, pending, anuncios_com_candidata_rebate: itensRebate.size, tarifas_coletadas: precisam.filter(a => a.tarifa_estado === 'ok').length,
      chamadas_get: ctx.chamadas, duracao_s: Math.round((Date.now() - t0) / 100) / 10,
      derrubadas: derrubadas ? { derrubadas: derrubadas.derrubadas.length, vencidas: derrubadas.vencidas.length, sem_prazo: derrubadas.semPrazo.length, saiu_da_coleta: derrubadas.saiuDaColeta.length, desde: anterior.em,
        lista: derrubadas.derrubadas.slice(0, 200).map(d => ({ item_id: d.item_id, pid: d.pid, fim: d.fim })) } : null,      // a tela lista item a item (resumo_json é o que /participando devolve); teto de 200 — a contagem acima é a total
    }
    // escrita longa: só grava se ainda for a dona do estado — conta ML igual à do início (relida agora) e coleta corrente = esta (gravarColeta confere, atômico)
    if (String(lerUid() ?? '') !== String(uid)) throw descartada('a conta do Mercado Livre deste cliente mudou (ou foi desconectada) durante a coleta')
    repo.gravarColeta(cliente, { coletaId, campanhas: listaCamps, anuncios, ofertasPorItem, resumo, limites, estado, listagemCompleta, meliUserId: uid })
    repo.salvarSnapshot(cliente, coletaId, { participacoes, itens: [...ofertasPorItem.keys()], campanhas: listaCamps.map(c => ({ pid: c.pid, status: c.status, fim: c.fim })) })
    repo.auditar(cliente, 'coleta', { autor: por, depois: resumo, detalhe: [estado === 'parcial' ? `⚠ coleta PARCIAL: ${leiturasFalhas} leitura(s) essencial(is) falharam — o analista não aplica sobre ela` : '',
      derrubadas?.derrubadas.length ? `⚠ ${derrubadas.derrubadas.length} participação(ões) sumiram antes do prazo: ${derrubadas.derrubadas.slice(0, 5).map(d => `${d.item_id}/${d.pid}`).join(', ')}` : ''].filter(Boolean).join(' · ') })
    prog(estado === 'concluida' ? 'concluída' : 'concluída (parcial)', 1, 1)
    return { ...resumo, limites, derrubadas_detalhe: derrubadas }
  } catch (e) {
    repo.falharColeta(cliente, coletaId, e.message, limites)          // só marca se o carimbo ainda for desta coleta
    repo.auditar(cliente, e.descartada ? 'coleta_descartada' : 'coleta_erro', { autor: por, detalhe: e.message })
    throw e
  }
}
