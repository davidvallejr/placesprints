// Coletor da série DIÁRIA por anúncio (Mercado Livre) — base da atribuição tarefa → resultado e do GMV.
// Princípios: incremental (só busca dias ainda não coletados; os 3 últimos sempre, pois pedidos mudam),
// sem inventar (dia coletado sem linha = 0 vendas; dia não coletado = "sem dado"), e uma falha de um
// anúncio/dia nunca derruba a coleta inteira. Só leitura, só endpoints oficiais.
import { db, agora, hojeLocal, log, getEstado, setEstado } from './db.js'
import { idDoVendedor } from './meli-contas.js'
import { chamar, detalhesItens, adsPorAnuncio } from './meli-api.js'
import { historico } from './preco-historico.js'
import { diffAds } from './estado-anuncio.js'
import { ufDoPerfil } from './dimensoes.js'
import { arestasDoAnuncio, linhasDoPedido, conferirLinhasComSerie, SKU_OFICIAL } from './produto-estoque.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const cfgAtrib = JSON.parse(readFileSync(join(ROOT, 'config', 'atribuicao.json'), 'utf-8'))
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const lote = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

// ── anúncios do vendedor (ativos e pausados) ────────────────────────────────
async function listarIds(cliente) {
  const userId = idDoVendedor(cliente), ids = new Set()
  for (const status of ['active', 'paused']) {
    for (let off = 0; off < 1000; off += 100) {
      const r = await chamar(cliente, `/users/${userId}/items/search?status=${status}&limit=100&offset=${off}`, { permitirFalha: true })
      if (r._erro || !r.results?.length) break
      r.results.forEach(i => ids.add(i))
      if (off + 100 >= (r.paging?.total ?? 0)) break
    }
  }
  return [...ids]
}

const upItem = db.prepare(`INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, preco_original, status, estoque, vendidos, fotos, frete_gratis, catalogo, catalogo_produto_id, tipo_anuncio, criado_em, logistica, category_id, atualizado_em)
  VALUES (@cliente,@item_id,@titulo,@permalink,@thumb,@preco,@preco_original,@status,@estoque,@vendidos,@fotos,@frete_gratis,@catalogo,@catalogo_produto_id,@tipo_anuncio,@criado_em,@logistica,@category_id,@agora)
  ON CONFLICT(cliente, item_id) DO UPDATE SET titulo=@titulo, permalink=@permalink, thumb=@thumb, preco=@preco, preco_original=@preco_original, status=@status, estoque=@estoque,
    vendidos=@vendidos, fotos=@fotos, frete_gratis=@frete_gratis, catalogo=@catalogo, catalogo_produto_id=@catalogo_produto_id, tipo_anuncio=@tipo_anuncio, logistica=@logistica, category_id=@category_id, atualizado_em=@agora`)

export async function atualizarItens(cliente, ids) {
  return gravarItens(cliente, await detalhesItens(cliente, ids))
}
// grava a leitura dos anúncios e, na MESMA transação, o que mudou desde a leitura anterior (change-log em meli_item_mudanca)
export function gravarItens(cliente, itens, { t = agora(), dia = hojeLocal() } = {}) {
  const linhas = itens.map(i => ({
    cliente, item_id: i.id, titulo: i.title || '', permalink: i.permalink || '', thumb: (i.thumbnail || '').replace(/^http:/, 'https:'),
    preco: i.price ?? null, preco_original: i.original_price ?? null, status: i.status || '', estoque: i.available_quantity ?? null, vendidos: i.sold_quantity ?? null,
    fotos: Array.isArray(i.pictures) ? i.pictures.length : null, frete_gratis: i.shipping?.free_shipping ? 1 : 0,
    catalogo: i.catalog_listing ? 1 : 0, catalogo_produto_id: String(i.catalog_product_id || ''), tipo_anuncio: i.listing_type_id || '', criado_em: (i.date_created || '').slice(0, 10), logistica: i.shipping?.logistic_type || '', category_id: String(i.category_id || ''), agora: t,   // category_id: só o que a API devolveu ('' quando ausente)
  }))
  db.transaction(() => {
    const anteriores = new Map(db.prepare('SELECT item_id, preco, preco_original, titulo, fotos, estoque, status, frete_gratis, logistica, thumb FROM meli_item WHERE cliente = ?').all(cliente).map(r => [r.item_id, r]))
    historico.registrarMudancas(cliente, anteriores, linhas, { dia, em: t })
    for (const l of linhas) upItem.run(l)
    gravarAnuncioUp(cliente, itens, { t })                     // V3 F1: chaves do produto na MESMA transação (falha não grava pela metade)
  })()
  return itens.length
}

// V3 F1: arestas anúncio/variação → produto (user_product_id, inventory_id, SKU, catálogo). As linhas DO anúncio lido são apagadas e regravadas;
// anúncio que sai da listagem guarda as últimas (costura a migração do ML: item novo, mesmo UP). Sem SELLER_SKU oficial no anúncio/variação,
// vale o SKU da VENDA mais recente (meli_pedido_item.seller_sku → fonte 'pedido') antes do seller_custom_field (que nunca agrupa).
const delArestas = db.prepare('DELETE FROM meli_anuncio_up WHERE cliente = ? AND item_id = ?')
const upAresta = db.prepare(`INSERT INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, inventory_id, sku, sku_fonte, catalogo_produto_id, estoque, logistica, flex, tags, status, lido_em)
  VALUES (@cliente,@item_id,@variacao_id,@user_product_id,@inventory_id,@sku,@sku_fonte,@catalogo_produto_id,@estoque,@logistica,@flex,@tags,@status,@lido_em)`)
const skuDaVenda = db.prepare("SELECT item_id, variacao_id, seller_sku, MAX(dia) d FROM meli_pedido_item WHERE cliente = ? AND seller_sku != '' GROUP BY item_id, variacao_id")   // SQLite: colunas soltas vêm da linha do MAX
export function gravarAnuncioUp(cliente, itens, { t = agora() } = {}) {
  const venda = new Map(skuDaVenda.all(cliente).map(r => [`${r.item_id}|${r.variacao_id}`, r.seller_sku]))
  let n = 0
  for (const b of itens) {
    const arestas = arestasDoAnuncio(b)
    if (!arestas.length) continue
    delArestas.run(cliente, arestas[0].item_id)
    for (const a of arestas) {
      const v = SKU_OFICIAL.has(a.sku_fonte) ? '' : venda.get(`${a.item_id}|${a.variacao_id}`)
      upAresta.run({ cliente, ...a, ...(v ? { sku: v, sku_fonte: 'pedido' } : {}), lido_em: t }); n++
    }
  }
  return n
}

// UF do vendedor para o recorte por região: 1 chamada ao /users (backfill de conta ligada antes da coluna). Sem address.state válido fica '' (nunca deduzida).
export async function atualizarUf(cliente) {
  const userId = idDoVendedor(cliente)
  if (!userId) return ''
  const r = await chamar(cliente, `/users/${userId}`, { permitirFalha: true })
  const uf = r._erro ? '' : ufDoPerfil(r)
  if (uf) db.prepare('UPDATE meli_contas SET uf = ? WHERE cliente = ? AND meli_user_id = ?').run(uf, cliente, userId)
  return uf
}

// ── pedidos por dia (janela do dia no fuso do Brasil) ───────────────────────
async function pedidosDoDia(cliente, dia) {
  const userId = idDoVendedor(cliente), pedidos = []
  let truncado = false
  for (let off = 0; ; off += 50) {
    const q = new URLSearchParams({ seller: userId, 'order.status': 'paid', 'order.date_created.from': `${dia}T00:00:00.000-03:00`, 'order.date_created.to': `${dia}T23:59:59.999-03:00`, sort: 'date_asc', limit: '50', offset: String(off) })
    const r = await chamar(cliente, `/orders/search?${q}`)
    pedidos.push(...(r.results || []))
    if (!r.results?.length || off + 50 >= (r.paging?.total ?? 0)) break
    if (off + 50 >= 1000) { truncado = true; break }
  }
  return { pedidos, truncado }
}

const upSerie = db.prepare(`INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)
  ON CONFLICT(cliente, item_id, dia) DO UPDATE SET unidades = excluded.unidades, receita = excluded.receita`)
const upDia = db.prepare(`INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em, linhas) VALUES (?,?,?,?,?,?)
  ON CONFLICT(cliente, dia) DO UPDATE SET pedidos = excluded.pedidos, truncado = excluded.truncado, coletado_em = excluded.coletado_em, linhas = excluded.linhas`)
// V3 F1: linhas de pedido (só gravação, dos MESMOS pedidos da série). Linha 'cancelled' (F4) nunca é apagada pelo DELETE do dia.
const delLinhasDia = db.prepare("DELETE FROM meli_pedido_item WHERE cliente = ? AND dia = ? AND status = 'paid'")
// recoleta (até D+2): a linha paga cujo pedido SUMIU da busca de pagos foi cancelada — vira 'cancelled' (UPDATE) em vez de ser apagada, e o DRE a vê.
// Busca truncada (≥ 1.000 pedidos) não marca nada: o pedido pode só ter ficado depois do corte.
const linhasPagasDia = db.prepare("SELECT DISTINCT order_id FROM meli_pedido_item WHERE cliente = ? AND dia = ? AND status = 'paid'")
const cancelaLinha = db.prepare("UPDATE meli_pedido_item SET status = 'cancelled' WHERE cliente = ? AND dia = ? AND order_id = ? AND status = 'paid'")
const upLinha = db.prepare(`INSERT INTO meli_pedido_item (cliente, order_id, item_id, variacao_id, dia, quantidade, preco_unit_c, tarifa_c, tipo_anuncio, seller_sku, envio_id, pack_id, deposito_node, deposito_store, cupom_c, reembolso_c, status, coletado_em)
  VALUES (@cliente,@order_id,@item_id,@variacao_id,@dia,@quantidade,@preco_unit_c,@tarifa_c,@tipo_anuncio,@seller_sku,@envio_id,@pack_id,@deposito_node,@deposito_store,@cupom_c,@reembolso_c,@status,@coletado_em)
  ON CONFLICT(cliente, order_id, item_id, variacao_id) DO UPDATE SET dia=excluded.dia, quantidade=excluded.quantidade, preco_unit_c=excluded.preco_unit_c, tarifa_c=excluded.tarifa_c,
    tipo_anuncio=excluded.tipo_anuncio, seller_sku=excluded.seller_sku, envio_id=excluded.envio_id, pack_id=excluded.pack_id, deposito_node=excluded.deposito_node, deposito_store=excluded.deposito_store,
    cupom_c=excluded.cupom_c, reembolso_c=excluded.reembolso_c, status=excluded.status, coletado_em=excluded.coletado_em`)

export async function coletarPedidos(cliente, de, ate, aoProgredir) {
  const feitos = new Map(db.prepare('SELECT dia, coletado_em FROM meli_coleta_dia WHERE cliente = ?').all(cliente).map(r => [r.dia, r.coletado_em]))
  // recoleta o dia se nunca foi coletado OU se foi coletado até 2 dias depois dele (pode estar parcial; pedidos mudam de status)
  const precisa = d => !feitos.has(d) || diasEntre(d, feitos.get(d).slice(0, 10)) < 3
  const dias = []
  for (let d = de; d <= ate; d = addDias(d, 1)) if (precisa(d)) dias.push(d)
  let i = 0
  const falhas = []
  for (const dia of dias) {
    try {
      const { pedidos, truncado } = await pedidosDoDia(cliente, dia)
      const porItem = new Map()
      for (const p of pedidos) for (const it of p.order_items || []) {
        const id = it.item?.id; if (!id) continue
        const a = porItem.get(id) || { u: 0, r: 0 }
        a.u += it.quantity || 0; a.r += (it.unit_price || 0) * (it.quantity || 0)
        porItem.set(id, a)
      }
      // V3 F1: as linhas saem dos MESMOS pedidos; se não baterem com a série (invariante), o dia fica sem linhas (lacuna declarada) e a série NÃO muda
      const linhas = pedidos.flatMap(p => linhasDoPedido(p, dia)), furos = conferirLinhasComSerie(linhas, porItem), t = agora()
      if (furos.length) log('aviso', `linhas de pedido ${cliente} ${dia}: ${furos.length} anúncio(s) não batem com a série — linhas do dia não gravadas`)
      db.transaction(() => {
        // zera vendas do dia SEM apagar as visitas da mesma linha; depois grava o que veio (recoleta substitui, não soma)
        db.prepare('UPDATE meli_serie_item SET unidades = 0, receita = 0 WHERE cliente = ? AND dia = ?').run(cliente, dia)
        for (const [id, a] of porItem) upSerie.run(cliente, id, dia, a.u, Math.round(a.r * 100) / 100)
        if (!truncado) { const pagos = new Set(pedidos.map(p => String(p.id))); for (const { order_id } of linhasPagasDia.all(cliente, dia)) if (!pagos.has(order_id)) cancelaLinha.run(cliente, dia, order_id) }
        delLinhasDia.run(cliente, dia)
        if (!furos.length) for (const l of linhas) upLinha.run({ cliente, ...l, coletado_em: t })
        upDia.run(cliente, dia, pedidos.length, truncado ? 1 : 0, t, furos.length ? 0 : 1)
      })()
    } catch (e) { falhas.push({ dia, erro: e.message.slice(0, 120) }); log('erro', `coleta de pedidos ${cliente} ${dia}: ${e.message.slice(0, 120)}`) }   // dia que falha NÃO é marcado: vira lacuna declarada
    aoProgredir?.({ fase: 'pedidos', feitos: ++i, total: dias.length, cliente })
  }
  return { dias: dias.length, falhas }
}

// ── V3 F4: linhas dos dias JÁ fechados (backfill) e cancelamentos — SÓ LEITURA, nada muda na série ──────────────────────────────
// Dia de 28 d sem linhas (coleta anterior à F1 ou invariante que não bateu), sem truncamento e fora da janela de recoleta (≥ 3 dias atrás): rebusca SÓ os pedidos pagos
// e grava SÓ as linhas. O que foi cancelado depois da coleta sumiu dos pagos e fica abaixo da série — a invariante aqui é de TETO (linhas ≤ série, ±1 c/linha);
// linha acima da série (pago tardio, parse) = o dia inteiro fica sem linhas (lacuna declarada). A diferença série − linhas pagas é «cancelado» no DRE.
// Fila: nunca tentado primeiro, depois a tentativa mais antiga (sync_estado linhas_tentativa:{cliente} = { dia: quando }), e o dia mais recente no empate — o dia que
// sempre passa da série (pago tardio) vai para o fim da fila e não trava os mais antigos.
const marcaLinhas = db.prepare('UPDATE meli_coleta_dia SET linhas = 1 WHERE cliente = ? AND dia = ?')
export async function completarLinhas(cliente, { hoje = hojeLocal(), dias = 28, teto = 10 } = {}) {
  const chave = `linhas_tentativa:${cliente}`, ini = addDias(hoje, -dias)
  let tent = {}; try { tent = JSON.parse(getEstado(chave) || '{}') || {} } catch { tent = {} }
  const alvo = db.prepare('SELECT dia FROM meli_coleta_dia WHERE cliente = ? AND linhas = 0 AND truncado = 0 AND dia BETWEEN ? AND ?').all(cliente, ini, addDias(hoje, -3)).map(r => r.dia)
    .sort((a, b) => String(tent[a] || '').localeCompare(String(tent[b] || '')) || b.localeCompare(a)).slice(0, Math.max(0, teto))
  const serieDia = db.prepare('SELECT item_id, unidades u, receita r FROM meli_serie_item WHERE cliente = ? AND dia = ? AND unidades > 0')
  let feitos = 0, pulados = 0, falhas = 0
  for (const dia of alvo) {
    tent[dia] = agora()
    try {
      const { pedidos, truncado } = await pedidosDoDia(cliente, dia)
      const linhas = pedidos.flatMap(p => linhasDoPedido(p, dia)), furos = truncado ? ['truncado'] : conferirLinhasComSerie(linhas, new Map(serieDia.all(cliente, dia).map(x => [x.item_id, x])), { teto: true })
      if (furos.length) { pulados++; log('aviso', `linhas de pedido (dia fechado) ${cliente} ${dia}: ${truncado ? 'busca truncada' : `${furos.length} anúncio(s) acima da série`} — dia segue sem linhas`); continue }
      const t = agora()
      db.transaction(() => { delLinhasDia.run(cliente, dia); for (const l of linhas) upLinha.run({ cliente, ...l, coletado_em: t }); marcaLinhas.run(cliente, dia) })()
      feitos++
    } catch (e) { falhas++; log('erro', `linhas de pedido (dia fechado) ${cliente} ${dia}: ${String(e.message).slice(0, 120)}`) }
  }
  if (alvo.length) setEstado(chave, JSON.stringify(Object.fromEntries(Object.entries(tent).filter(([d]) => d >= ini))))   // só a janela (o dia já completado sai da fila pela consulta)
  return { dias: alvo.length, feitos, pulados, falhas }
}
// pedidos cancelados atualizados desde a última passada (1ª vez: 30 d) → linha 'paid' vira 'cancelled' (sai da receita do financeiro; a série/GMV não muda aqui).
// Só UPDATE: pedido cancelado sem linha gravada fica de fora (o DRE pega pela diferença série − linhas). A busca devolver TODOS os cancelados é NOT_VERIFIED: «parcial».
export async function marcarCancelados(cliente, { hoje = hojeLocal(), paginas = 10 } = {}) {
  const chave = `financeiro_cancelados:${cliente}`, ultimo = getEstado(chave), desde = ultimo ? addDias(ultimo, -1) : addDias(hoje, -30)
  const userId = idDoVendedor(cliente), ids = new Set()
  let truncado = false
  for (let off = 0; ; off += 50) {
    const q = new URLSearchParams({ seller: userId, 'order.status': 'cancelled', 'order.date_last_updated.from': `${desde}T00:00:00.000-03:00`, sort: 'date_desc', limit: '50', offset: String(off) })
    const r = await chamar(cliente, `/orders/search?${q}`)
    for (const o of r.results || []) if (o?.id != null) ids.add(String(o.id))
    if (!r.results?.length || off + 50 >= (r.paging?.total ?? 0)) break
    if (off + 50 >= paginas * 50) { truncado = true; break }
  }
  const up = db.prepare("UPDATE meli_pedido_item SET status = 'cancelled' WHERE cliente = ? AND order_id = ? AND status = 'paid'")
  let marcadas = 0
  db.transaction(() => { for (const id of ids) marcadas += up.run(cliente, id).changes })()
  if (!truncado) setEstado(chave, hoje)                       // truncado: a próxima passada recomeça da mesma data
  return { desde, cancelados: ids.size, linhas_marcadas: marcadas, truncado }
}

// ── visitas diárias por anúncio (só os que importam: mais vendidos + citados em tarefas) ──
export async function coletarVisitas(cliente, ids, dias, aoProgredir) {
  const ate = hojeLocal(), de = addDias(ate, -(dias - 1))
  let i = 0
  for (const id of ids) {
    const r = await chamar(cliente, `/items/${id}/visits/time_window?last=${dias}&unit=day`, { permitirFalha: true })
    if (!r._erro && Array.isArray(r.results)) {
      db.transaction(() => {
        db.prepare('UPDATE meli_serie_item SET visitas = 0 WHERE cliente = ? AND item_id = ? AND dia >= ?').run(cliente, id, de)
        for (const x of r.results) {
          const dia = String(x.date).slice(0, 10)
          db.prepare(`INSERT INTO meli_serie_item (cliente, item_id, dia, visitas) VALUES (?,?,?,?)
            ON CONFLICT(cliente, item_id, dia) DO UPDATE SET visitas = excluded.visitas`).run(cliente, id, dia, x.total || 0)
        }
        db.prepare('UPDATE meli_item SET vis_de = ?, vis_ate = ? WHERE cliente = ? AND item_id = ?').run(de, ate, cliente, id)
      })()
    }
    aoProgredir?.({ fase: 'visitas', feitos: ++i, total: ids.length, cliente })
  }
}


// ── Ads por anúncio e por DIA (mesma API de Product Ads; janela máxima de 90 dias por chamada) ──
// Só guarda o que a API devolveu; anúncio sem Ads volta com zeros (verdade: não houve gasto). Incremental: com cobertura anterior,
// recoleta só dos últimos 7 dias em diante (o ML consolida atribuição de venda com atraso); sem cobertura, 120 dias em 2 blocos.
const upAdsDia = db.prepare(`INSERT INTO meli_ads_dia (cliente, item_id, dia, prints, clicks, custo, receita, unidades) VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(cliente, item_id, dia) DO UPDATE SET prints=excluded.prints, clicks=excluded.clicks, custo=excluded.custo, receita=excluded.receita, unidades=excluded.unidades`)
const upAdsCob = db.prepare(`INSERT INTO meli_ads_cobertura (cliente, item_id, de, ate, coletado_em) VALUES (?,?,?,?,?)
  ON CONFLICT(cliente, item_id) DO UPDATE SET de = MIN(de, excluded.de), ate = MAX(ate, excluded.ate), coletado_em = excluded.coletado_em`)
export async function coletarAdsDia(cliente, ids, { dias = 120, aoProgredir } = {}) {
  const alvos = [...new Set(ids || [])]
  if (!alvos.length) return { disponivel: true, itens: 0, falhas: 0 }
  const adv = await chamar(cliente, '/advertising/advertisers?product_id=PADS', { headers: { 'Api-Version': '1' }, permitirFalha: true })
  if (adv._erro || !adv.advertisers?.[0]?.advertiser_id) return { disponivel: false, motivo: 'conta sem Ads (Product Ads) habilitado ou sem permissão de leitura' }
  const ate = addDias(hojeLocal(), -1)           // dia de hoje é parcial: nunca entra
  const cob = new Map(db.prepare('SELECT item_id, de, ate FROM meli_ads_cobertura WHERE cliente = ?').all(cliente).map(r => [r.item_id, r]))
  let feitos = 0, falhas = 0
  for (const id of alvos) {
    const c = cob.get(id)
    const de = c ? addDias(c.ate, -7) : addDias(ate, -(dias - 1))
    let ok = true
    for (let ini = de; ini <= ate; ini = addDias(ini, 91)) {                 // blocos de até 91 dias (a API aceita diferença ≤ 90)
      const fim = addDias(ini, 90) < ate ? addDias(ini, 90) : ate
      const r = await chamar(cliente, `/advertising/MLB/product_ads/ads/${id}?date_from=${ini}&date_to=${fim}&metrics=clicks,prints,cost,total_amount,units_quantity&aggregation_type=DAILY`, { headers: { 'Api-Version': '2' }, permitirFalha: true })
      if (r._erro || !Array.isArray(r.results)) { ok = false; break }
      db.transaction(() => {
        for (const x of r.results) { const dia = String(x.date || '').slice(0, 10); if (dia) upAdsDia.run(cliente, id, dia, x.prints || 0, x.clicks || 0, x.cost || 0, x.total_amount || 0, x.units_quantity || 0) }
        upAdsCob.run(cliente, id, ini, fim, agora())
      })()
    }
    if (!ok) falhas++
    aoProgredir?.({ fase: 'ads por dia', feitos: ++feitos, total: alvos.length, cliente })
  }
  return { disponivel: true, itens: alvos.length, falhas }
}
export const idsComAds = cliente => db.prepare("SELECT DISTINCT item_id FROM meli_ads_item WHERE cliente = ? AND (custo > 0 OR prints > 0) ORDER BY custo DESC LIMIT 80").all(cliente).map(r => r.item_id)

// ── citações de anúncios nas tarefas (só vale ID que É deste vendedor — sem falso positivo) ──
export function itensCitados(texto, conhecidos) {
  const achados = new Set()
  for (const m of String(texto || '').matchAll(/MLB-?(\d{6,12})/gi)) if (conhecidos.has('MLB' + m[1])) achados.add('MLB' + m[1])
  for (const m of String(texto || '').matchAll(/(?<![\d])(\d{8,12})(?![\d])/g)) if (conhecidos.has('MLB' + m[1])) achados.add('MLB' + m[1])
  return [...achados]
}

export async function coletarCliente(cliente, { dias = cfgAtrib.dias_coleta, aoProgredir } = {}) {
  if (!idDoVendedor(cliente)) throw new Error('conta Mercado Livre não conectada')
  if (!db.prepare('SELECT uf FROM meli_contas WHERE cliente = ?').get(cliente)?.uf) await atualizarUf(cliente).catch(() => '')   // UF é rótulo: falha nunca derruba a coleta
  const ate = hojeLocal(), de = addDias(ate, -(dias - 1))
  aoProgredir?.({ fase: 'anúncios', feitos: 0, total: 1, cliente })
  const ids = await listarIds(cliente)
  const nItens = await atualizarItens(cliente, ids)
  const ped = await coletarPedidos(cliente, de, ate, aoProgredir)
  if (ped.dias > 0 && ped.falhas.length === ped.dias) throw new Error(`todas as ${ped.dias} coletas de pedidos falharam (${ped.falhas[0].erro}) — nada foi atualizado`)
  // anúncio que vendeu mas não está na lista de ativos/pausados (ex.: encerrado depois): busca os detalhes para não perder a venda
  const desconhecidos = db.prepare('SELECT DISTINCT item_id FROM meli_serie_item WHERE cliente = ? AND item_id NOT IN (SELECT item_id FROM meli_item WHERE cliente = ?)').all(cliente, cliente).map(r => r.item_id)
  // leitura COMPLEMENTAR: anúncio antigo que o ML não entrega mais (404) não pode derrubar a coleta todo dia — fica registrado no log (a guarda vale para a lista principal acima)
  if (desconhecidos.length) await atualizarItens(cliente, desconhecidos).catch(e => log('aviso', `anúncios vendidos fora da lista (${cliente}): ${String(e.message).slice(0, 160)}`))
  // visitas: top-K por unidades no período + qualquer anúncio citado em tarefa concluída do cliente
  const conhecidos = new Set(db.prepare('SELECT item_id FROM meli_item WHERE cliente = ?').all(cliente).map(r => r.item_id))
  const citados = new Set()
  for (const t of db.prepare("SELECT titulo, descricao, conteudo FROM tarefas WHERE cliente = ? AND arquivada = 0 AND status = 'concluida'").all(cliente))
    itensCitados(`${t.titulo} ${t.descricao} ${t.conteudo}`, conhecidos).forEach(i => citados.add(i))
  // visitas de TODOS os anúncios com venda no período (até o teto) — assim o grupo de controle não é escolhido olhando o "pós"
  const top = db.prepare('SELECT item_id FROM meli_serie_item WHERE cliente = ? AND dia >= ? GROUP BY item_id HAVING SUM(unidades) > 0 ORDER BY SUM(unidades) DESC LIMIT ?').all(cliente, de, cfgAtrib.top_itens_serie).map(r => r.item_id)
  const alvos = [...new Set([...top, ...citados])]
  await coletarVisitas(cliente, alvos, Math.min(dias, 150), aoProgredir)
  // visão do comprador (avaliações, preço-para-ganhar) só dos 12 maiores — evita rajada de chamadas
  await atualizarVisao(cliente, top.slice(0, 12))
  const ads = await coletarAds(cliente).catch(e => ({ disponivel: false, motivo: e.message.slice(0, 100) }))
  // Ads por DIA: anúncios com Ads + os citados em tarefas + os vinculados (plano/confirmação) — alimenta o antes/depois por tarefa
  const vinculados = db.prepare('SELECT DISTINCT item_id FROM tarefa_item WHERE cliente = ? AND origem IN (\'citado\',\'plano\',\'confirmado\')').all(cliente).map(r => r.item_id)
  const adsDia = await coletarAdsDia(cliente, [...new Set([...idsComAds(cliente), ...citados, ...vinculados])].filter(i => conhecidos.has(i)), { aoProgredir }).catch(e => ({ disponivel: false, motivo: e.message.slice(0, 100) }))
  return { ads, ads_dia: adsDia, itens: nItens, dias_pedidos: ped.dias, falhas_pedidos: ped.falhas.length, itens_desconhecidos: desconhecidos.length, aviso_teto: ids.length >= 1000 ? 'a conta tem 1000+ anúncios ativos/pausados; a lista foi truncada pela API' : null, itens_com_visitas: alvos.length, citados_em_tarefas: citados.size, de, ate }
}

// ── Ads por anúncio: duas janelas de 28 dias (atual e anterior), substituindo o snapshot anterior ──
export async function coletarAds(cliente, { dias = 28 } = {}) {
  const ate = addDias(hojeLocal(), -1), de = addDias(ate, -(dias - 1)), anteAte = addDias(de, -1), anteDe = addDias(anteAte, -(dias - 1))
  let total = 0
  for (const [periodo, d0, d1] of [['atual', de, ate], ['anterior', anteDe, anteAte]]) {
    const r = await adsPorAnuncio(cliente, { de: d0, ate: d1 })
    if (!r.disponivel) { if (periodo === 'atual') return { disponivel: false, motivo: r.motivo }; continue }
    if (!r.completo) { if (periodo === 'atual') return { disponivel: false, motivo: 'coleta de Ads incompleta — snapshot anterior mantido' }; continue }
    total += gravarAdsItem(cliente, periodo, d0, d1, r.itens)
  }
  return { disponivel: true, anuncios: total }
}
// grava a foto de Ads do período (substitui a anterior) e, no período 'atual' e na MESMA transação, o que mudou de ESTADO desde a foto anterior
// (change-log campo 'ads', fonte 'ads': só ligou/desligou — fronteira 'active'; 1ª foto não gera evento). itens = results da API (item_id, status, metrics…)
export function gravarAdsItem(cliente, periodo, d0, d1, itens, { dia = hojeLocal(), em = agora() } = {}) {
  db.transaction(() => {
    const antes = periodo === 'atual' ? new Map(db.prepare("SELECT item_id, status FROM meli_ads_item WHERE cliente = ? AND periodo = 'atual'").all(cliente).map(r => [r.item_id, r.status || ''])) : null
    db.prepare('DELETE FROM meli_ads_item WHERE cliente = ? AND periodo = ?').run(cliente, periodo)
    const nova = new Map()
    for (const a of itens) {
      const m = a.metrics || {}
      db.prepare(`INSERT OR REPLACE INTO meli_ads_item (cliente, item_id, periodo, de, ate, prints, clicks, custo, receita, unidades, status, buy_box, logistica, nivel, catalogo, coletado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cliente, a.item_id, periodo, d0, d1, m.prints || 0, m.clicks || 0, m.cost || 0, m.total_amount || 0, m.units_quantity || 0,
        a.status || '', a.buy_box_winner == null ? null : (a.buy_box_winner ? 1 : 0), a.logistic_type || '', a.current_level || '', a.catalog_listing ? 1 : 0, em)
      nova.set(a.item_id, a.status || '')
    }
    if (antes) historico.registrarEstados(cliente, diffAds(antes, nova), { fonte: 'ads', dia, em })
  })()
  return itens.length
}

// ── visão do comprador (cache de 6h) ────────────────────────────────────────
export async function atualizarVisao(cliente, ids, { forcar = false } = {}) {
  const limite = Date.now() - cfgAtrib.visao_comprador_validade_horas * 3600e3
  for (const id of ids) {
    const row = db.prepare('SELECT visao_em FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, id)
    if (!forcar && row?.visao_em && new Date(row.visao_em).getTime() > limite) continue
    const [rev, ptw] = await Promise.all([
      chamar(cliente, `/reviews/item/${id}?limit=1`, { permitirFalha: true }),
      chamar(cliente, `/items/${id}/price_to_win?version=v2`, { permitirFalha: true }),
    ])
    const visao = {
      avaliacoes: rev._erro ? null : { total: rev.paging?.total ?? null, nota: rev.rating_average ?? null, niveis: rev.rating_levels ?? null },
      catalogo: ptw._erro ? null : { preco_para_ganhar: ptw.price_to_win ?? null, status: ptw.status || '', concorrente: ptw.winner?.price ?? null, boosts: (ptw.boosts || []).map(b => ({ id: b.id, status: b.status, descricao: b.description })) },
      indisponivel: [rev._erro && 'avaliações', ptw._erro && 'preço para ganhar (item fora de catálogo)'].filter(Boolean),
    }
    db.prepare('UPDATE meli_item SET visao_json = ?, visao_em = ? WHERE cliente = ? AND item_id = ?').run(JSON.stringify(visao), agora(), cliente, id)
  }
}

// ── leitura (série agregada) ────────────────────────────────────────────────
export function coberturaPedidos(cliente) {
  const r = db.prepare('SELECT MIN(dia) de, MAX(dia) ate, COUNT(*) n, SUM(truncado) trunc FROM meli_coleta_dia WHERE cliente = ?').get(cliente)
  const esperados = r.de ? diasEntre(r.de, r.ate) + 1 : 0
  return { de: r.de, ate: r.ate, dias: r.n, truncados: r.trunc || 0, lacunas: Math.max(0, esperados - r.n) }
}
// dias do intervalo que NÃO foram coletados (lacunas) ou foram truncados — o GMV desse período não é confiável
export function qualidadeNoIntervalo(cliente, de, ate) {
  const marcados = new Map(db.prepare('SELECT dia, truncado FROM meli_coleta_dia WHERE cliente = ? AND dia >= ? AND dia <= ?').all(cliente, de, ate).map(r => [r.dia, r.truncado]))
  const faltam = []; let truncados = 0
  for (let d = de; d <= ate; d = addDias(d, 1)) { if (!marcados.has(d)) faltam.push(d); else if (marcados.get(d)) truncados++ }
  return { completo: !faltam.length && !truncados, faltam, truncados }
}
export function serieDoCliente(cliente, itemIds = null) {
  let rows = db.prepare('SELECT item_id, dia, unidades, receita, visitas FROM meli_serie_item WHERE cliente = ?').all(cliente)
  if (itemIds) { const s = new Set(itemIds); rows = rows.filter(r => s.has(r.item_id)) }
  return rows
}
export { diasEntre }
