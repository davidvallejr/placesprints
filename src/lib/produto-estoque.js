// Produto por trás do anúncio (V3 — docs/desenho-v3-produto-estoque-financeiro.md). PURO: sem import de banco; db.js executa o SCHEMA_PRODUTO.
// F1 (14/10/2026) é SÓ GRAVAÇÃO, zero chamada a mais ao ML: as chaves do produto por anúncio/variação (meli_anuncio_up, lidas no MESMO multiget
// da coleta) e as linhas de pedido (meli_pedido_item, dos MESMOS pedidos da série diária).
// F4 (14/10/2026): meli_envio_custo (frete por envio) entra no mesmo SCHEMA; o financeiro puro mora em lucro.js.
// F2 (14/10/2026) é SOMBRA: montarGrafo junta anúncios em produtos (UP > inventory_id > SELLER_SKU oficial > catálogo, com travas, vínculo manual e recusa),
// conta o estoque UMA vez por estoque físico de referência (EF) e aplicarProduto anota i.produto — com `ligado = false` nenhum número do diagnóstico muda.
// F3 (15/10/2026): atrás da MESMA chave (produto.diagnostico_ligado, ainda DESLIGADA), carregarBase roda aplicarProduto com ligado = true e as regras, os gatilhos, as compras
// e os textos leem o item pelos predicados únicos daqui (representaEstoque, representaProduto, estoqueDe, sufixoAnuncios, envioDoProprio, pseudoProdutos) — nunca uma tabela
// de produto, nunca um 2º motor. Sem i.produto (chave desligada) cada predicado devolve o número do próprio anúncio: nada muda. Manual: docs/manual-integracao-ml.md § F3.
import { tokens } from './vinculos.js'

export const SCHEMA_PRODUTO = `
CREATE TABLE IF NOT EXISTS meli_anuncio_up (       -- 1 linha por anúncio sem variação, ou 1 por variação; gravada na MESMA transação de gravarItens
  cliente TEXT NOT NULL, item_id TEXT NOT NULL,
  variacao_id TEXT NOT NULL DEFAULT '',            -- '' = nível do anúncio
  user_product_id TEXT NOT NULL DEFAULT '',        -- MLBU…; '' = a API não trouxe (vira pool 'item:…', sem compartilhar com ninguém)
  inventory_id TEXT NOT NULL DEFAULT '',           -- só Full (por variação quando há variações)
  sku TEXT NOT NULL DEFAULT '',                    -- cru, como veio
  sku_fonte TEXT NOT NULL DEFAULT '' CHECK (sku_fonte IN ('','seller_sku','variacao','pedido','seller_custom_field')),
  catalogo_produto_id TEXT NOT NULL DEFAULT '',
  estoque INTEGER,                                 -- available_quantity do anúncio/variação; NULL = não lido
  logistica TEXT NOT NULL DEFAULT '',
  flex INTEGER NOT NULL DEFAULT 0 CHECK (flex IN (0,1)),   -- shipping.tags contém self_service_in
  tags TEXT NOT NULL DEFAULT '',                   -- só a lista fechada: bundle, kit_component, user_product_listing
  status TEXT NOT NULL DEFAULT '',
  lido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id, variacao_id));
CREATE INDEX IF NOT EXISTS ix_anuncio_up_up  ON meli_anuncio_up (cliente, user_product_id);
CREATE INDEX IF NOT EXISTS ix_anuncio_up_inv ON meli_anuncio_up (cliente, inventory_id);
CREATE INDEX IF NOT EXISTS ix_anuncio_up_sku ON meli_anuncio_up (cliente, sku);
CREATE TABLE IF NOT EXISTS meli_pedido_item (      -- 1 linha por order_items[] de pedido pago; dia recoletado substitui (como meli_serie_item)
  cliente TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL, variacao_id TEXT NOT NULL DEFAULT '',
  dia TEXT NOT NULL,                               -- o MESMO recorte de meli_serie_item (dia da busca de pedidos, fuso -03:00)
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unit_c INTEGER NOT NULL,                   -- unit_price em centavos
  tarifa_c INTEGER,                                -- order_items[].sale_fee como veio; NULL = não veio (nunca 0)
  tipo_anuncio TEXT NOT NULL DEFAULT '', seller_sku TEXT NOT NULL DEFAULT '',
  envio_id TEXT NOT NULL DEFAULT '', pack_id TEXT NOT NULL DEFAULT '',
  deposito_node TEXT NOT NULL DEFAULT '', deposito_store TEXT NOT NULL DEFAULT '',  -- order_items[].stock: de que depósito saiu
  cupom_c INTEGER, reembolso_c INTEGER,            -- payments[] rateados pela receita das linhas do pedido (Σ exato); NULL = não veio
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','cancelled')),
  coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, order_id, item_id, variacao_id));
CREATE INDEX IF NOT EXISTS ix_pedido_item_dia   ON meli_pedido_item (cliente, dia);
CREATE INDEX IF NOT EXISTS ix_pedido_item_envio ON meli_pedido_item (cliente, envio_id);
CREATE INDEX IF NOT EXISTS ix_pedido_item_item  ON meli_pedido_item (cliente, item_id, dia);
CREATE TABLE IF NOT EXISTS meli_up_estoque (       -- F2: GET /user-products/{id}/stock; só a última leitura BEM-SUCEDIDA (falha só marca pendente; nunca 0 por falha)
  cliente TEXT NOT NULL, user_product_id TEXT NOT NULL,
  local TEXT NOT NULL CHECK (local IN ('proprio','full')),  -- seller_warehouse + selling_address → proprio; meli_facility → full (local ausente na leitura = 0)
  quantidade INTEGER,                              -- NULL = nunca lido com sucesso
  lojas INTEGER,                                   -- nº de store_id distintos no próprio (multi-depósito)
  pendente TEXT NOT NULL DEFAULT '' CHECK (pendente IN ('','permissao_do_app','indisponivel','teto')),
  lido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, user_product_id, local));
CREATE TABLE IF NOT EXISTS meli_envio_custo (      -- F4: GET /shipments/{id}/costs; 1 envio = N pedidos (pacote). Só leitura; falha nunca vira 0
  cliente TEXT NOT NULL, envio_id TEXT NOT NULL,
  custo_vendedor_c INTEGER,                        -- Σ senders[].cost em centavos; NULL = não lido (pendente diz por quê)
  desconto_c INTEGER,                              -- Σ senders[].discounts[].promoted_amount (informativo; ex.: mandatory 30%)
  logistica TEXT NOT NULL DEFAULT '',
  pendente TEXT NOT NULL DEFAULT '' CHECK (pendente IN ('','permissao_do_app','indisponivel','teto','sem_remetente')),
  lido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, envio_id));
CREATE TABLE IF NOT EXISTS produto_vinculo (       -- F2: só a EXCEÇÃO humana é gravada; o automático é recalculado a cada leitura
  cliente TEXT NOT NULL,
  origem TEXT NOT NULL,                            -- 'up:MLBU…' | 'item:MLB…'
  produto TEXT NOT NULL,                           -- 'sku:<norm>' | 'cat:MLB…' | 'up:MLBU…' | 'item:MLB…' (o produto que contém esse anúncio)
  tipo TEXT NOT NULL CHECK (tipo IN ('manual','recusado')),   -- manual: esta origem É deste produto; recusado: nunca juntar automaticamente
  por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, origem, produto));
CREATE TABLE IF NOT EXISTS produto_estoque_declarado (   -- F3: estoque físico PRÓPRIO (fora do Full) informado pelo cliente/equipe por SKU oficial; vale estoque_declarado_validade_dias
  cliente TEXT NOT NULL, sku TEXT NOT NULL,        -- sku = chaveSku (normalizado) de um SELLER_SKU oficial lido do ML; nunca sintético
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 0 AND 1000000),
  fonte TEXT NOT NULL CHECK (fonte IN ('cliente','equipe','erp','planilha')),   -- F6: erp/planilha = saldo lido de fonte externa (adaptador); o sincronismo escreve só com ≤ 24 h
  por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, sku));
CREATE TABLE IF NOT EXISTS kit_componente (       -- F5: composição de kit. ml_bundle = Kit Virtual lido do ML (regravado pela leitura); declarado = só por humano (prévia → confirmar)
  cliente TEXT NOT NULL,
  kit TEXT NOT NULL,                               -- origem do kit: 'up:MLBU…' | 'item:MLB…'
  componente TEXT NOT NULL,                        -- produto componente: 'sku:…' | 'up:MLBU…' | 'cat:MLB…' | 'item:MLB…'
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 100),
  modo TEXT NOT NULL CHECK (modo IN ('kit_virtual','montado_na_hora','pre_montado')),   -- sem modo não se grava: o modo errado conta o estoque em dobro ou esconde a ruptura
  fonte TEXT NOT NULL CHECK (fonte IN ('ml_bundle','declarado')),
  por TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, kit, componente));
`

// F6: o CHECK de fonte do estoque declarado ganhou erp/planilha. Banco criado antes (CHECK só cliente/equipe) é recriado com cópia (tabela pequena); idempotente.
export function migrarEstoqueDeclarado(h) {
  const sql = h.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'produto_estoque_declarado'").get()?.sql || ''
  if (!sql || sql.includes("'planilha'")) return false
  h.transaction(() => {
    h.exec('ALTER TABLE produto_estoque_declarado RENAME TO produto_estoque_declarado_v1')
    h.exec(SCHEMA_PRODUTO.slice(SCHEMA_PRODUTO.indexOf('CREATE TABLE IF NOT EXISTS produto_estoque_declarado'), SCHEMA_PRODUTO.indexOf('CREATE TABLE IF NOT EXISTS kit_componente')))
    h.exec('INSERT INTO produto_estoque_declarado (cliente, sku, quantidade, fonte, por, em) SELECT cliente, sku, quantidade, fonte, por, em FROM produto_estoque_declarado_v1')
    h.exec('DROP TABLE produto_estoque_declarado_v1')
  })()
  return true
}

// regra do UpSeller (sem caixa); NÃO skuForte (tira hífen: juntaria KIT-2 com KIT2)
export const chaveSku = s => String(s ?? '').normalize('NFC').trim().toLowerCase()
export const SKU_OFICIAL = new Set(['seller_sku', 'variacao', 'pedido'])        // seller_custom_field NUNCA agrupa sozinho («uso interno, sem relação» — doc do ML)
const TAGS_ARESTA = ['bundle', 'kit_component', 'user_product_listing']
const txt = v => (v == null ? '' : String(v).trim())
const inteiro = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)
const skuAttr = attrs => txt((Array.isArray(attrs) ? attrs : []).find(a => a?.id === 'SELLER_SKU')?.value_name)

// SKU em camadas da coleta de PROMOÇÕES (regras-promocoes.md §3), movida de promocoes-coleta.js sem mudar a precedência (lá é reexportada).
// Cascata com || (NUNCA ??: seller_custom_field vem "" em anúncio sincronizado). A aresta do produto usa a regra própria de arestasDoAnuncio.
export function resolverSku(item, userProduct = null) {
  const attr = (lista, id) => (lista || []).find(a => a.id === id)
  const s1 = String(attr(item.attributes, 'SELLER_SKU')?.value_name || '').trim()
  if (s1) return { sku: s1, fonte: 'attributes.SELLER_SKU' }
  const s2 = String(item.seller_custom_field || '').trim()
  if (s2) return { sku: s2, fonte: 'seller_custom_field' }
  const s3 = String(attr(userProduct?.attributes, 'SELLER_SKU')?.values?.[0]?.name || '').trim()
  if (s3) return { sku: s3, fonte: 'user-products' }
  for (const v of item.variations || []) {
    const s = String(attr(v.attributes, 'SELLER_SKU')?.value_name || v.seller_custom_field || '').trim()
    if (s) return { sku: s, fonte: 'variação' }
  }
  return { sku: '', fonte: '' }
}

// corpo do /items/bulk → arestas: 1 por anúncio sem variação, ou 1 por variação (UP e inventory_id vêm por variação: 65/65 e 47/65 na amostra).
// SKU: SELLER_SKU do próprio nível ('seller_sku' no anúncio, 'variacao' na variação) > seller_custom_field (só sugestão). A camada 'pedido' entra na gravação.
// A variação NÃO herda SKU nem catálogo do anúncio-pai: o do pai é da família (ex.: «…-PAI») e juntaria tamanhos/cores diferentes num produto só.
export function arestasDoAnuncio(b) {
  const item_id = txt(b?.id)
  if (!item_id) return []
  const comum = { item_id, logistica: txt(b.shipping?.logistic_type), flex: (b.shipping?.tags || []).includes('self_service_in') ? 1 : 0,
    tags: TAGS_ARESTA.filter(t => (b.tags || []).includes(t)).join(','), status: txt(b.status) }
  const aresta = (n, fonteOficial, variacao_id) => {
    const oficial = skuAttr(n.attributes), scf = txt(n.seller_custom_field)
    return { ...comum, variacao_id, user_product_id: txt(n.user_product_id), inventory_id: txt(n.inventory_id),
      sku: oficial || scf, sku_fonte: oficial ? fonteOficial : scf ? 'seller_custom_field' : '',
      catalogo_produto_id: txt(n.catalog_product_id), estoque: inteiro(n.available_quantity) }
  }
  const vars = Array.isArray(b.variations) ? b.variations.filter(v => v && v.id != null) : []
  return vars.length ? vars.map(v => aresta(v, 'variacao', String(v.id))) : [aresta(b, 'seller_sku', '')]
}

// rateio de um valor em centavos proporcional aos pesos (receita da linha): Σ = valor EXATO, o resto do arredondamento vai para a maior linha
export function ratearPorReceita(valor_c, pesos) {
  if (!pesos.length) return []
  const W = pesos.reduce((s, w) => s + w, 0)
  const partes = pesos.map(w => (W > 0 ? Math.floor((valor_c * w) / W) : 0))
  const maior = pesos.reduce((m, w, i) => (w > pesos[m] ? i : m), 0)
  partes[maior] += valor_c - partes.reduce((s, x) => s + x, 0)
  return partes
}

// pedido pago do /orders/search → linhas de meli_pedido_item (sem cliente/coletado_em). O MESMO corte da série diária: item sem id fica fora,
// preço ausente vale 0 como lá (`unit_price || 0`), quantidade ≤ 0 não vira linha (na série soma 0). A mesma linha repetida (item + variação) é somada.
// cupom e reembolso: Σ dos payments não recusados, rateados pela receita das linhas; algum payment sem o número = NULL (nunca 0).
export function linhasDoPedido(p, dia) {
  const por = new Map()
  for (const it of p?.order_items || []) {
    const item_id = txt(it?.item?.id), q = Math.round(Number(it?.quantity) || 0)
    if (!item_id || q <= 0) continue
    const variacao_id = txt(it.item.variation_id), k = `${item_id}|${variacao_id}`
    const preco = Math.round((Number(it.unit_price) || 0) * 100), tarifa = typeof it.sale_fee === 'number' && Number.isFinite(it.sale_fee) ? Math.round(it.sale_fee * 100) : null
    const a = por.get(k)
    if (!a) { por.set(k, { item_id, variacao_id, quantidade: q, receita_c: preco * q, preco_unit_c: preco, tarifa_c: tarifa, tipo_anuncio: txt(it.listing_type_id), seller_sku: txt(it.item.seller_sku), deposito_node: txt(it.stock?.node_id), deposito_store: txt(it.stock?.store_id) }); continue }
    a.quantidade += q; a.receita_c += preco * q
    if (a.preco_unit_c !== preco) a.preco_unit_c = Math.round(a.receita_c / a.quantidade)   // ponytail: preços diferentes na mesma linha somada = média (a invariante com a série acusa se passar de 1 c/linha)
    if (a.tarifa_c !== tarifa) a.tarifa_c = null                                              // tarifas diferentes: semântica incerta → NULL, nunca soma
    if (!a.seller_sku) a.seller_sku = txt(it.item.seller_sku)
  }
  const linhas = [...por.values()]
  const pagos = (Array.isArray(p?.payments) ? p.payments : []).filter(x => x && !['rejected', 'cancelled'].includes(x.status))
  const total = campo => (pagos.length && pagos.every(x => typeof x[campo] === 'number' && Number.isFinite(x[campo])) ? pagos.reduce((s, x) => s + Math.round(x[campo] * 100), 0) : null)
  const pesos = linhas.map(l => l.receita_c), cupom = total('coupon_amount'), reemb = total('transaction_amount_refunded')
  const rc = cupom == null ? null : ratearPorReceita(cupom, pesos), rr = reemb == null ? null : ratearPorReceita(reemb, pesos)
  return linhas.map(({ receita_c, ...l }, i) => ({ order_id: txt(p.id), ...l, dia, envio_id: txt(p.shipping?.id), pack_id: txt(p.pack_id),
    cupom_c: rc ? rc[i] : null, reembolso_c: rr ? rr[i] : null, status: 'paid' }))
}

// invariante da F1 (por anúncio no dia): Σ (preço × qtd) das linhas = receita da série (±1 centavo por linha) e Σ qtd = unidades.
// serie: Map item_id → { u, r } com r em REAIS (como meli_serie_item). Devolve os item_id que NÃO batem ([] = ok).
// teto = true (F4, linhas de dia JÁ fechado): só falha se as linhas PASSAM da série — o que foi cancelado depois da coleta some dos pagos e fica abaixo dela.
export function conferirLinhasComSerie(linhas, serie, { teto = false } = {}) {
  const soma = new Map()
  for (const l of linhas) { const a = soma.get(l.item_id) || { u: 0, c: 0, n: 0 }; a.u += l.quantidade; a.c += l.preco_unit_c * l.quantidade; a.n++; soma.set(l.item_id, a) }
  return [...new Set([...soma.keys(), ...serie.keys()])].filter(id => {
    const l = soma.get(id) || { u: 0, c: 0, n: 0 }, s = serie.get(id) || { u: 0, r: 0 }
    const dc = l.c - Math.round(s.r * 100)
    return teto ? l.u > s.u || dc > l.n : l.u !== s.u || Math.abs(dc) > l.n
  })
}

// ════════ F2: o grafo produto → anúncio → estoque por local (SOMBRA) — desenho § 3 ════════
export const RX_KIT = /\b(kit|pacote|combo|c\/|jogo)\b.*\d+/i                  // só SUGESTÃO (1.603 títulos ativos casam); composição de kit é F5
export const ehOrigem = s => /^(up:MLBU\d{1,20}|item:MLB\d{1,20})$/.test(String(s ?? ''))
export const ehChaveProduto = s => /^(sku:[^\u0000-\u001f<>{}~]{1,80}|cat:MLB\d{1,20}|up:MLBU\d{1,20}|item:MLB\d{1,20})$/.test(String(s ?? ''))   // item: = o produto que contém o anúncio (sem chave lida)
const diaMenos = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const minimo = xs => [...xs].sort()[0]
const r2 = n => Math.round(n * 100) / 100
// identidade do produto que uma chave nomeia: 'sku:x' → tem o SKU oficial x; 'cat:y' → tem o catálogo y; 'up:z' → tem o UP z; 'item:w' → contém o anúncio w
const temIdentidade = (id, k) => k.startsWith('sku:') ? id.skus.has(k.slice(4)) : k.startsWith('cat:') ? id.cats.has(k.slice(4)) : k.startsWith('up:') ? id.ups.has(k.slice(3)) : k.startsWith('item:') ? id.itens.has(k.slice(5)) : false
// chave natural do produto: manual > menor SKU oficial > menor catálogo > menor UP > menor anúncio
const chaveNatural = I => I.forcada || (I.skus.size ? `sku:${minimo(I.skus)}` : I.cats.size ? `cat:${minimo(I.cats)}` : I.ups.size ? `up:${minimo(I.ups)}` : `item:${minimo(I.itens)}`)
// chave que o vínculo manual usa para apontar ESTE produto: a própria chave, ou (colisão/sem chave) um UP ou anúncio dele — sempre resolvível por temIdentidade
export const chaveAlvo = p => (ehChaveProduto(p.chave) && !p.chave.startsWith('item:') ? p.chave : p.ups.length ? `up:${p.ups[0]}` : `item:${p.nos[0]?.item_id}`)
const disjuntos = (a, b) => a.size > 0 && b.size > 0 && ![...a].some(x => b.has(x))

// arestas (meli_anuncio_up + título do meli_item; ativas e pausadas) → nós. Anúncio com variações = 1 nó AGREGADO (Σ estoques, velocidade do anúncio): a venda por
// variação só existe com 28 dias de linhas de pedido (desenho § 3.5). Ele guarda os UPs (vups) e, no Full, os inventários (vinvs) das variações: variação no UP ou no
// inventário de outro anúncio junta o agregado ao grupo dele (§ 3.2 item 2, § 3.5) — sem SKU nem catálogo do pai. ponytail: pool por variação com as 28 d de linhas (F3/F5).
function nosDasArestas(arestas) {
  const porItem = new Map()
  for (const a of arestas) if (a.status === 'active' || a.status === 'paused') (porItem.get(a.item_id) || porItem.set(a.item_id, []).get(a.item_id)).push(a)
  return [...porItem.keys()].sort().map(item_id => {
    const l = porItem.get(item_id), b = l[0], local = b.logistica === 'fulfillment' ? 'full' : 'proprio', agregado = l.some(a => a.variacao_id)
    const k = agregado ? { up: '', inv: '', sku: '', scf: '', cat: '' }
      : { up: txt(b.user_product_id), inv: local === 'full' ? txt(b.inventory_id) : '', sku: SKU_OFICIAL.has(b.sku_fonte) ? chaveSku(b.sku) : '',
        scf: b.sku_fonte === 'seller_custom_field' ? chaveSku(b.sku) : '', cat: txt(b.catalogo_produto_id) }
    const estoque = agregado ? (l.every(a => a.estoque != null) ? l.reduce((t, a) => t + a.estoque, 0) : null) : b.estoque ?? null
    const vups = agregado ? [...new Set(l.map(a => txt(a.user_product_id)).filter(Boolean))].sort() : [], vinvs = agregado && local === 'full' ? [...new Set(l.map(a => txt(a.inventory_id)).filter(Boolean))].sort() : []
    const no = { item_id, ...k, sem_chave: b.sku_fonte === 'sem_aresta', vups, vinvs, vinv_completo: agregado && local === 'full' && l.every(a => txt(a.inventory_id)), local, flex: l.some(a => a.flex === 1 || a.flex === true), estoque, variacoes: agregado ? l.length : 0, status: b.status,
      lido_em: l.map(a => String(a.lido_em || '')).sort().pop(), tags: txt(b.tags), titulo: txt(b.titulo), permalink: txt(b.permalink), tipo_anuncio: txt(b.tipo_anuncio), catalogo: !!b.catalogo }
    no.origem = no.up ? `up:${no.up}` : `item:${item_id}`
    no.pool = no.up ? `up:${no.up}|${local}` : no.inv ? `inv:${no.inv}|full` : `item:${item_id}|${local}`
    return no
  })
}
// número que os anúncios do pool mostram: o lido mais recente (empate = maior); irmãos com números diferentes = divergente_ml (1 de 254 grupos hoje)
function doAnuncio(nos) {
  const l = nos.filter(n => n.estoque != null).sort((a, b) => b.lido_em.localeCompare(a.lido_em) || b.estoque - a.estoque)
  return l.length ? { estoque: l[0].estoque, lido_em: l[0].lido_em, divergente: new Set(l.map(n => n.estoque)).size > 1 } : null
}

// arestas · vinculos (produto_vinculo) · upEstoque (meli_up_estoque) · fullEstoque [{ inventory_id, disponivel, dia }] (meli_full_estoque, a última por inventário)
// · declarado Map(sku normalizado → { quantidade, fonte, em }) (F3; vazio na F2) · hoje 'AAAA-MM-DD' · P = config/algoritmo.json → produto
// → { produtos[], doItem: Map(item_id → { produto, ef }), sugestoes[] (pares de pools), avisos[] }. Determinístico: embaralhar a entrada dá a mesma saída.
export function montarGrafo({ arestas = [], vinculos = [], upEstoque = [], fullEstoque = [], declarado = new Map(), kits = [], hoje, P = {} } = {}) {
  const auto = new Set(P.juntar_automatico ?? ['up', 'inventory', 'sku', 'catalogo']), desde = diaMenos(hoje, P.leitura_stock_validade_dias ?? 2)
  const validoDecl = diaMenos(hoje, P.estoque_declarado_validade_dias ?? 7), avisos = [], sugestoes = []
  const stock = new Map(upEstoque.filter(r => r.quantidade != null && String(r.lido_em).slice(0, 10) >= desde).map(r => [`${r.user_product_id}|${r.local}`, r]))
  const full = new Map(fullEstoque.filter(r => r.disponivel != null && String(r.dia) >= desde).map(r => [r.inventory_id, r]))
  // ── 1) nós → pools (UP × local). Full com Flex: o estoque próprio do UP só existe lido em /stock — sem leitura, pool próprio com estoque null (ambíguo)
  const nos = nosDasArestas(arestas), pools = new Map()
  // anúncio Full mostrando MAIS que o inventário Full lido = a diferença é estoque próprio vendido pelo Flex (mesma ambiguidade da tag self_service_in)
  for (const n of nos) if (n.local === 'full' && !n.flex && n.estoque != null && full.get(n.inv)?.disponivel < n.estoque) n.flex = n.flex_inferido = true
  const pool = (chave, local, up) => pools.get(chave) || pools.set(chave, { chave, local, up, nos: [], virtual: false }).get(chave)
  for (const n of nos) pool(n.pool, n.local, n.up).nos.push(n)
  for (const up of [...new Set(nos.filter(n => n.up).map(n => n.up))].sort()) for (const local of ['proprio', 'full']) {
    const k = `up:${up}|${local}`, s = stock.get(`${up}|${local}`)
    if (pools.has(k)) continue
    if ((s && s.quantidade > 0) || (!s && local === 'proprio' && nos.some(n => n.up === up && n.local === 'full' && n.flex))) pool(k, local, up).virtual = true
  }
  // ── 2) union-find dos pools com identidade por componente (SKU oficial, catálogo, UP, origens) — desenho § 3.2
  const manual = new Map([...vinculos].filter(v => v.tipo === 'manual').sort((a, b) => a.origem.localeCompare(b.origem) || a.produto.localeCompare(b.produto)).map(v => [v.origem, v.produto]))
  const recusas = vinculos.filter(v => v.tipo === 'recusado')
  const pai = new Map(), id = new Map()
  const raiz = k => { while (pai.get(k) !== k) k = pai.get(k); return k }
  const chaves = [...pools.keys()].sort()
  for (const k of chaves) {
    const p = pools.get(k), origens = new Set(p.nos.map(n => n.origem)); if (p.up) origens.add(`up:${p.up}`)
    pai.set(k, k); id.set(k, { skus: new Set(p.nos.map(n => n.sku).filter(Boolean)), cats: new Set(p.nos.map(n => n.cat).filter(Boolean)), ups: new Set(p.up ? [p.up] : []),
      origens, itens: new Set(p.nos.map(n => n.item_id)), motivos: new Set(), forcada: null })
    p.fixo = [...origens].some(o => manual.has(o))
  }
  const unir = (a, b, motivo) => {
    const [ra, rb] = [raiz(a), raiz(b)]; if (ra === rb) return
    const [m, M] = ra < rb ? [ra, rb] : [rb, ra], x = id.get(m), y = id.get(M)
    for (const c of ['skus', 'cats', 'ups', 'origens', 'itens', 'motivos']) for (const v of y[c]) x[c].add(v)
    x.motivos.add(motivo); x.forcada = [x.forcada, y.forcada].filter(Boolean).sort()[0] || null; pai.set(M, m)
  }
  const recusado = (A, B) => recusas.some(r => (A.origens.has(r.origem) && temIdentidade(B, r.produto)) || (B.origens.has(r.origem) && temIdentidade(A, r.produto)))
  const conflitos = new Set()
  const tentar = (a, b, tipo, valor) => {   // SKU e catálogo: só com a trava de contradição (a outra identidade forte não pode discordar) e sem recusa
    const [ra, rb] = [raiz(a), raiz(b)]; if (ra === rb) return
    const A = id.get(ra), B = id.get(rb)
    if (recusado(A, B)) return
    if (tipo === 'sku' ? disjuntos(A.cats, B.cats) : disjuntos(A.skus, B.skus)) {                // 1 sugestão por SKU/catálogo em conflito (não 1 por par)
      if (!conflitos.has(`${tipo}:${valor}`)) { conflitos.add(`${tipo}:${valor}`); sugestoes.push({ tipo: 'conflito', a, b, motivo: tipo === 'sku' ? 'mesmo SKU, catálogos diferentes' : 'mesmo catálogo, SKUs diferentes' }) }
      return
    }
    if (!auto.has(tipo)) return void sugestoes.push({ tipo, a, b, motivo: tipo === 'sku' ? 'mesmo SKU' : 'mesmo catálogo' })
    unir(a, b, tipo)
  }
  const agrupar = f => { const m = new Map(); for (const k of chaves) for (const v of f(pools.get(k))) (m.get(v) || m.set(v, []).get(v)).push(k); return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0])) }
  for (const [, ks] of agrupar(p => (p.up ? [p.up] : []))) ks.slice(1).forEach(k => unir(ks[0], k, 'up'))                              // 1. mesmo UP: sempre
  const vupsDe = p => [...new Set([...(p.up ? [p.up] : []), ...p.nos.flatMap(n => n.vups)])]                                       // 1b. variação no UP de outro anúncio
  for (const [v, ks] of agrupar(vupsDe)) if (ks.some(k => pools.get(k).nos.some(n => n.vups.includes(v)))) ks.slice(1).forEach(k => unir(ks[0], k, 'variacao'))
  for (const [, ks] of agrupar(p => (p.local === 'full' ? [...new Set(p.nos.flatMap(n => [n.inv, ...n.vinvs]).filter(Boolean))] : []))) ks.slice(1).forEach(k => unir(ks[0], k, 'inventory'))   // 2. mesmo inventário Full
  const livres = p => !p.fixo                                                                                                          // vínculo manual vence: não entra no automático
  // SKU e catálogo: cada pool tenta todos os anteriores do grupo (uma recusa ou trava entre 2 não impede os outros de se juntarem)
  const todos = (ks, tipo, valor) => ks.forEach((k, i) => ks.slice(0, i).forEach(j => tentar(j, k, tipo, valor)))
  for (const [v, ks] of agrupar(p => (livres(p) ? [...new Set(p.nos.map(n => n.sku).filter(Boolean))] : []))) todos(ks, 'sku', v)        // 3. SKU oficial
  for (const [v, ks] of agrupar(p => (livres(p) ? [...new Set(p.nos.map(n => n.cat).filter(Boolean))] : []))) todos(ks, 'catalogo', v)   // 4. catálogo
  const separado = r => recusas.some(v => id.get(r).origens.has(v.origem))
  for (const [o, alvo] of manual) {                                                                                                    // 5. manual: move a origem
    const meus = chaves.filter(k => id.get(k).origens.has(o) || pools.get(k).nos.some(n => n.origem === o)); if (!meus.length) { avisos.push(`vínculo manual sem anúncio ativo: ${o}`); continue }
    // destino pela MESMA regra da chave: o produto cuja chave natural é o alvo (na ordem em que a chave limpa é atribuída); sem esse, quem tem a identidade (up:/item:)
    const r0 = raiz(meus[0]), raizes = [...new Set(chaves.map(raiz))].filter(r => r !== r0).sort((a, b) => separado(a) - separado(b) || a.localeCompare(b))
    const dest = raizes.find(r => chaveNatural(id.get(r)) === alvo) ?? raizes.find(r => temIdentidade(id.get(r), alvo))
    // o produto de destino mantém a chave que já tinha (nada de churn porque o vínculo apontou por um UP ou anúncio dele); sem destino, vale a chave pedida
    const forcada = dest ? chaveNatural(id.get(dest)) : alvo.startsWith('item:') ? null : alvo
    if (dest) unir(r0, dest, 'manual'); else id.get(r0).motivos.add('manual')
    id.get(raiz(r0)).forcada = forcada || id.get(raiz(r0)).forcada
  }
  // ── 3) produtos: chave determinística (manual > menor SKU oficial > menor catálogo > menor UP > menor anúncio); colisão (recusa separou) ganha ~origem
  const grupos = new Map(); for (const k of chaves) (grupos.get(raiz(k)) || grupos.set(raiz(k), []).get(raiz(k))).push(pools.get(k))
  const usadas = new Set(), produtos = [], doItem = new Map()
  for (const r of [...grupos.keys()].sort((a, b) => separado(a) - separado(b) || a.localeCompare(b))) {   // quem foi separado por recusa cede a chave limpa ao grupo
    const I = id.get(r), ps = grupos.get(r), nosP = ps.flatMap(p => p.nos).sort((a, b) => a.item_id.localeCompare(b.item_id))
    let chave = chaveNatural(I)
    if (usadas.has(chave)) chave += `~${minimo(I.origens)}`
    usadas.add(chave)
    // ── 4) estoque de cada pool (§ 3.3): /stock ≤ validade > inventário Full ≤ validade > anúncio só sem ambiguidade > null com o motivo
    for (const p of ps) {
      const outro = p.up && pools.has(`up:${p.up}|${p.local === 'full' ? 'proprio' : 'full'}`), flex = p.nos.some(n => n.flex), s = p.up && stock.get(`${p.up}|${p.local}`)
      const invs = [...new Set(p.nos.flatMap(n => [n.inv, ...n.vinvs]).filter(Boolean))], fi = invs.map(i => full.get(i)), an = doAnuncio(p.nos)
      const invOk = p.nos.every(n => !n.variacoes || n.vinv_completo)                    // anúncio com variações: Σ dos inventários Full só com TODAS as variações lidas
      Object.assign(p, s ? { estoque: s.quantidade, fonte: 'stock', lido_em: String(s.lido_em).slice(0, 10), lojas: s.lojas ?? null }
        : p.local === 'full' && invs.length && invOk && fi.every(Boolean) ? { estoque: fi.reduce((t, x) => t + x.disponivel, 0), fonte: 'full_inventario', lido_em: fi.map(x => x.dia).sort()[0] }
        : an && !outro && !(p.local === 'full' && flex) ? { estoque: an.estoque, fonte: 'anuncio', lido_em: an.lido_em.slice(0, 10), divergente: an.divergente }
        : { estoque: null, fonte: '', motivo: p.virtual ? 'Flex ligado no anúncio Full: o estoque próprio deste produto ainda não foi lido por local'
          : p.local === 'full' && flex ? 'Full com Flex: o número do anúncio mistura o Full e o estoque próprio; falta a leitura por local'
          : outro ? 'o mesmo produto tem Full e estoque próprio: o número do anúncio pode misturar os dois; falta a leitura por local'
          : 'estoque não lido' })
      p.divergente = !!p.divergente
      if (p.divergente) avisos.push(`anúncios do mesmo estoque com números diferentes no ML (${p.chave}): vale o lido mais recente`)
    }
    // F3 — próprio do Full com Flex SEM leitura por local: medido na F2 (3 UPs do Uniaodog, 14/10), com o inventário Full ZERADO o anúncio mostra o estoque próprio que o
    // Flex vende (396/400/15 = o depósito); com Full > 0 mostra só o Full. Logo, SÓ com o Full lido em 0 e o anúncio > 0 o número do anúncio é o próprio (PREMISSA rotulada;
    // fonte anuncio_menos_full), nunca «—» nem 0 por falta de leitura. Full > 0 ⇒ o anúncio não diz o próprio ⇒ null (nao_lido), como na F2
    for (const p of ps) if (p.local === 'proprio' && p.virtual && p.estoque == null && p.up) {
      const fp = ps.find(q => q.up === p.up && q.local === 'full'), an = fp && doAnuncio(fp.nos)
      if (fp && fp.fonte === 'full_inventario' && fp.estoque === 0 && an && an.estoque > 0) Object.assign(p, { estoque: an.estoque, fonte: 'anuncio_menos_full', lido_em: an.lido_em.slice(0, 10), motivo: '', inferido: true })
    }
    // ── 5) estoque físico de referência (§ 3.4): cada Full é um EF; os próprios são 1 EF (um pool, espelho provável, declarado, não lido) ou N (dividido).
    // Antes, pools do mesmo local que dividem um estoque físico (a variação de um anúncio agregado no UP/inventário de outro anúncio) viram UM grupo: o estoque é o do pool
    // que contém todos os outros (o agregado soma as variações); sem esse pool, null. Pool sozinho = o próprio pool (a chave do EF não muda).
    const fis = p => new Set([...(p.up ? [`up:${p.up}`] : []), ...p.nos.flatMap(n => [...n.vups.map(u => `up:${u}`), ...(p.local === 'full' ? [n.inv, ...n.vinvs].filter(Boolean).map(x => `inv:${x}`) : [])])])
    const juntarFisico = l => {
      const gs = []
      for (const p of l) { const k = fis(p), hit = gs.filter(g => [...k].some(x => g.k.has(x))); for (const h of hit) gs.splice(gs.indexOf(h), 1); gs.push({ pools: [...hit.flatMap(h => h.pools), p], k: new Set([...hit.flatMap(h => [...h.k]), ...k]) }) }
      return gs.map(g => { const l2 = g.pools.sort((a, b) => a.chave.localeCompare(b.chave)), sup = l2.length === 1 ? l2[0] : l2.find(p => [...g.k].every(x => fis(p).has(x)))
        if (!sup) avisos.push(`anúncios do mesmo estoque físico sem um que cubra todas as variações (${chave}): estoque «—» até a leitura por variação`)
        return { chave: l2[0].chave, pools: l2.map(p => p.chave), estoque: sup ? sup.estoque : null, lido_em: sup?.lido_em || '' } }).sort((a, b) => a.chave.localeCompare(b.chave))
    }
    const prop = juntarFisico(ps.filter(p => p.local === 'proprio')), ful = juntarFisico(ps.filter(p => p.local === 'full'))
    const decl = [...I.skus].map(s => declarado.get(s)).find(d => d && String(d.em).slice(0, 10) >= validoDecl) || null
    const nums = prop.map(p => p.estoque)
    // espelho × dividido só com TODOS os estoques próprios lidos: com algum null o modo é «não lido» (1 EF «—»), nunca «números diferentes»
    const modo_proprio = !prop.length ? null : decl ? 'declarado' : prop.length === 1 ? 'um_pool' : nums.some(x => x == null) ? 'nao_lido' : nums.every(x => x === nums[0]) ? 'espelho_provavel' : 'dividido'
    const modo = prop.length >= 2 || decl ? modo_proprio : prop.length === 1 && ful.length ? 'full_e_proprio' : prop.length + ful.length === 1 ? 'um_pool' : prop.length ? modo_proprio : 'dividido'
    const efs = ful.map(p => ({ chave: `ef:${chave}|${p.chave}`, local: 'full', pools: p.pools, estoque: p.estoque }))
    if (modo_proprio === 'dividido') efs.push(...prop.map(p => ({ chave: `ef:${chave}|${p.chave}`, local: 'proprio', pools: p.pools, estoque: p.estoque })))
    else if (prop.length) efs.push({ chave: `ef:${chave}|proprio`, local: 'proprio', pools: prop.flatMap(p => p.pools), estoque: decl ? decl.quantidade : modo_proprio === 'espelho_provavel' ? nums[0] : modo_proprio === 'nao_lido' ? null : prop[0].estoque })
    const efDoPool = new Map(efs.flatMap(e => e.pools.map(k => [k, e])))
    for (const e of efs) e.nos = ps.filter(p => e.pools.includes(p.chave)).flatMap(p => p.nos.map(n => n.item_id))
    const premissas = []
    if (modo_proprio === 'espelho_provavel') premissas.push(P.$premissa_espelho || 'mesmo número em 2+ estoques próprios = o mesmo estoque físico (contado uma vez)')
    if (modo_proprio === 'dividido' && prop.length >= 2) premissas.push(P.$premissa_dividido || 'números diferentes = estoque dividido entre os anúncios (soma)')
    if (modo_proprio === 'nao_lido') premissas.push('um dos estoques próprios do produto ainda não foi lido por local: sem ele não dá para saber se é o mesmo estoque ou um estoque dividido (estoque próprio «—»)')
    // § 3.3: o mesmo número redondo (ou a ≤ 1% dele) em 2+ estoques próprios na mesma data = provável estoque de cadastro (nota; a conta não muda). ponytail: o depósito
    // (store_id) não é guardado por pool — a data e o número bastam para a nota; entra o depósito quando a F6 precisar
    const redondo = v => { const r = Math.round(v / 50) * 50; return v != null && r >= 100 && Math.abs(v - r) <= r * 0.01 ? r : null }, cad = new Map()
    for (const p of prop) { const r = redondo(p.estoque); if (r != null) cad.set(`${r}|${p.lido_em}`, (cad.get(`${r}|${p.lido_em}`) || 0) + 1) }
    if ([...cad.values()].some(x => x >= 2)) {
      premissas.push('provável estoque de cadastro: 2 ou mais estoques próprios com o mesmo número redondo (ou a até 1% dele) na mesma data — a conta não muda; vale confirmar com o cliente quanto existe')
      avisos.push(`provável estoque de cadastro (${chave}): estoques próprios com o mesmo número redondo na mesma data`)
    }
    if (nosP.some(n => n.variacoes) && nosP.length > 1) avisos.push(`anúncio com variações no mesmo produto de outro anúncio (${chave}): a venda é do anúncio inteiro até existirem 28 dias de linhas por variação`)
    if (decl) premissas.push(`estoque informado: ${decl.quantidade} un em ${String(decl.em).slice(8, 10)}/${String(decl.em).slice(5, 7)} (${decl.fonte})`)
    if (ful.length && prop.length) premissas.push('Full e estoque próprio são estoques separados: somados só para comprar')
    if (ful.length >= 2) premissas.push('cada estoque Full é contado pelo Mercado Livre: estoques Full separados somam')
    if (nosP.some(n => n.local === 'full' && n.flex)) premissas.push('venda do anúncio Full atribuída ao Full pela logística (premissa): com o Flex ligado, parte da venda pode sair do estoque próprio')
    if (nosP.some(n => n.flex_inferido)) premissas.push('o anúncio Full mostra mais que o estoque do Full: a diferença foi tratada como estoque próprio (Flex), a ler por local')
    if (nosP.some(n => n.variacoes)) premissas.push('anúncio com variações contado inteiro (soma das variações, venda do anúncio): a venda por variação entra com 28 dias de linhas de pedido')
    if (ps.some(p => p.fonte === 'anuncio_menos_full')) premissas.push('estoque próprio do anúncio Full com Flex = o número do anúncio, porque o Full lido está zerado (premissa até a leitura por local)')
    if (prop.length) premissas.push('estoque próprio = informado no Mercado Livre pelo vendedor, não contagem física')
    const estoque = efs.length && efs.every(e => e.estoque != null) ? efs.reduce((t, e) => t + e.estoque, 0) : null
    const prod = { chave, pools: ps, nos: nosP, skus: [...I.skus].sort(), cats: [...I.cats].sort(), ups: [...I.ups].sort(), origens: [...I.origens].sort(), motivos: [...I.motivos].sort(),
      modo, modo_proprio, efs, estoque, premissas, kit_titulo: nosP.some(n => RX_KIT.test(n.titulo)) && !nosP.some(n => /bundle/.test(n.tags)) }
    produtos.push(prod)
    for (const n of nosP) doItem.set(n.item_id, { produto: prod, ef: efDoPool.get(n.pool) })
  }
  // ── 6) F5 kits (§ 3.6): kit_componente → p.kit = { modo, fonte, componentes[{ produto, q }] }. kit_virtual e montado_na_hora NÃO são estoque físico (aplicarProduto:
  // estoque do kit = mín(componente ÷ q) e a venda do kit entra na demanda do componente); pre_montado é EF próprio e só soma na COMPRA do componente.
  // Composição que não resolve (kit ou componente fora dos anúncios ativos, componente = o próprio kit) vira aviso, nunca conta. ponytail: modo único por kit (o 1º)
  const contem = (p, k) => k.startsWith('sku:') ? p.skus.includes(k.slice(4)) : k.startsWith('cat:') ? p.cats.includes(k.slice(4)) : k.startsWith('up:') ? p.ups.includes(k.slice(3)) : k.startsWith('item:') ? p.nos.some(n => n.item_id === k.slice(5)) : false
  const porKit = new Map(); for (const k of kits) (porKit.get(k.kit) || porKit.set(k.kit, []).get(k.kit)).push(k)
  for (const [origem, cs] of [...porKit].sort((a, b) => a[0].localeCompare(b[0]))) {
    const kp = produtos.find(p => p.origens.includes(origem) || contem(p, origem)); if (!kp) { avisos.push(`kit sem anúncio ativo: ${origem}`); continue }
    const l = [...cs].sort((a, b) => a.componente.localeCompare(b.componente)), componentes = []
    for (const c of l) {
      const cp = produtos.find(p => p !== kp && contem(p, c.componente))
      if (!cp) { avisos.push(`componente de kit não encontrado nos anúncios (${kp.chave}): ${c.componente}`); continue }
      componentes.push({ produto: cp.chave, q: c.quantidade })
    }
    if (new Set(l.map(c => c.modo)).size > 1) avisos.push(`kit com modos diferentes (${kp.chave}): vale ${l[0].modo}`)
    if (componentes.length) {
      kp.kit = { origem, modo: l[0].modo, fonte: l[0].fonte, componentes }; kp.kit_titulo = false
      kp.premissas.push(kp.kit.modo === 'pre_montado' ? 'kit pré-montado: estoque próprio de caixas montadas; na compra do componente conta kit × quantidade'
        : `kit ${kp.kit.modo === 'kit_virtual' ? 'virtual do Mercado Livre' : 'montado na hora'}: o estoque do kit é o do componente (mínimo de componente ÷ quantidade) e a venda do kit desconta do componente`)
    }
  }
  return { produtos, doItem, sugestoes, avisos }
}

// o anúncio que «fala de estoque» do EF/produto: maior receita em 28 d; empate = menor item_id
const representante = (ids, porId) => [...ids].sort((a, b) => (porId.get(b)?.r || 0) - (porId.get(a)?.r || 0) || a.localeCompare(b))[0]

// lista = itens do diagnóstico (u, r em 28 d; lead_time_dias) · grafo = montarGrafo · L = limiares. Anota i.produto e i.cobertura_anuncio (o número de hoje, só leitura).
// Com ligado = true (F3) troca i.cobertura e i.ponto_reposicao pelos do EF; com false (F2, sombra) NENHUM campo existente muda. Idempotente.
export function aplicarProduto(lista, grafo, { L, dias = 28, ligado = false } = {}) {
  const porId = new Map(lista.map(i => [String(i.id), i])), seg = L.estoque_seguranca_dias, lead0 = L.lead_time_reposicao_dias
  // extras (F5 kits): [{ ids (anúncios do kit), q, r }] — a venda do kit × q entra na demanda do componente; r = a receita do kit também fica em risco quando o componente zera
  const conta = (ids, E, rep, extras = []) => {
    const its = ids.map(x => porId.get(x)).filter(Boolean), soma = (l, f) => l.reduce((t, i) => t + (f(i) || 0), 0)
    const ex = extras.map(x => ({ its: x.ids.map(y => porId.get(y)).filter(Boolean), q: x.q, r: x.r }))
    const u = soma(its, i => i.u) + ex.reduce((t, x) => t + soma(x.its, i => i.u) * x.q, 0), r = soma(its, i => i.r) + ex.reduce((t, x) => t + (x.r ? soma(x.its, i => i.r) : 0), 0), v = u / dias
    const lead = porId.get(rep)?.lead_time_dias ?? its[0]?.lead_time_dias ?? lead0, fonte = porId.get(rep)?.lead_time_fonte ?? its[0]?.lead_time_fonte ?? 'premissa'
    return { u, r: r2(r), vel: r2(v), lead, lead_fonte: fonte, representante: rep, cobertura: E != null && v > 0 ? Math.round(E / v) : null, ponto: v > 0 ? Math.ceil(u * (lead + seg) / dias - 1e-9) : null }
  }
  // F3 (só ligado; o grafo da F2 não muda): o número do anúncio Full = o Full + o que o Flex vende do próprio ⇒ TETO do estoque Full. Sem leitura do inventário (coleta do
  // Full falhou ou venceu) vale o teto — a ruptura não some (é o número de sem a chave); leitura mais velha que o anúncio e ACIMA dele = o Full caiu desde a leitura: vale o
  // anúncio. O estoque do produto (compras) só acompanha quando o teto CORRIGE uma leitura (≤ o Full lido); teto sem leitura pode conter o próprio e seria contado 2×
  const tetoFull = (p, e) => {
    const ps = p.pools.filter(q => e.pools.includes(q.chave)), n = ps.flatMap(q => q.nos).filter(x => x.estoque != null).sort((a, b) => b.lido_em.localeCompare(a.lido_em) || a.estoque - b.estoque)[0]
    if (!n) return e.estoque
    return e.estoque == null ? n.estoque : n.estoque < e.estoque && n.lido_em.slice(0, 10) > (ps.map(q => q.lido_em || '').sort()[0] || '') ? n.estoque : e.estoque
  }
  const PREM_TETO = 'estoque do Full sem leitura recente do inventário (ou lido antes de cair): vale o número do anúncio, que é o Full + o que o Flex vende do próprio (teto, premissa)'
  // F5 kits: kit_virtual/montado_na_hora dependem do componente (não são EF: estoque = mín(componente ÷ q), venda × q na demanda do EF do componente no MESMO local
  // do kit, senão no maior EF — premissa); pre_montado é EF próprio e só entra na COMPRA do componente (E_equiv = E_c + E_kit × q, demanda u_kit × q)
  const porChave = new Map(grafo.produtos.map(p => [p.chave, p])), depende = p => !!p.kit && p.kit.modo !== 'pre_montado'
  const efAlvo = (cp, local) => cp.efs.find(e => e.local === local) || [...cp.efs].sort((a, b) => (b.estoque ?? -1) - (a.estoque ?? -1))[0]
  const exEf = new Map(), exProd = new Map(), push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v)
  for (const p of grafo.produtos) if (p.kit) for (const c of p.kit.componentes) {
    const cp = porChave.get(c.produto); if (!cp) continue
    if (depende(p)) for (const ek of p.efs) { const a = efAlvo(cp, ek.local); if (a) push(exEf, a.chave, { ids: ek.nos, q: c.q, r: true }) }
    push(exProd, cp.chave, { ids: p.nos.map(n => n.item_id), q: c.q, r: depende(p), kit: p })
  }
  for (const p of grafo.produtos) if (!depende(p)) for (const e of p.efs) {
    const E = ligado && e.local === 'full' ? tetoFull(p, e) : e.estoque
    if (E !== e.estoque) { e.teto = e.estoque == null ? 'sem_leitura' : 'abaixo_da_leitura'; e.estoque = E; if (!p.premissas.includes(PREM_TETO)) p.premissas.push(PREM_TETO) }
    Object.assign(e, conta(e.nos, e.estoque, representante(e.nos, porId), exEf.get(e.chave)))
  }
  for (const p of grafo.produtos) if (depende(p)) for (const e of p.efs) {
    const qs = p.kit.componentes.map(c => { const cp = porChave.get(c.produto), a = cp && efAlvo(cp, e.local); return a && a.estoque != null ? Math.floor(a.estoque / c.q) : null })
    e.estoque = qs.length && qs.every(x => x != null) ? Math.min(...qs) : null; e.kit = true
    Object.assign(e, conta(e.nos, e.estoque, representante(e.nos, porId)))
  }
  for (const p of grafo.produtos) {
    if (p.efs.some(e => e.teto === 'abaixo_da_leitura') && !p.efs.some(e => e.teto === 'sem_leitura')) p.estoque = p.efs.every(e => e.estoque != null) ? p.efs.reduce((t, e) => t + e.estoque, 0) : null
    if (depende(p)) p.estoque = p.efs.length && p.efs.every(e => e.estoque != null) ? p.efs.reduce((t, e) => t + e.estoque, 0) : null
    const pre = (exProd.get(p.chave) || []).filter(x => !x.r)
    p.estoque_compra = pre.reduce((E, x) => (E == null || x.kit.estoque == null ? null : E + x.kit.estoque * x.q), p.estoque)
    Object.assign(p, conta(p.nos.map(n => n.item_id), p.estoque_compra, representante(p.nos.map(n => n.item_id), porId), exProd.get(p.chave)))
  }
  // F3: as entradas dos EFs do produto vão no item (só números e ids): a regra estoque_dividido compara o EF fraco com o EF forte sem reler o grafo
  const efSlim = e => ({ chave: e.chave, local: e.local, estoque: e.estoque, cobertura: e.cobertura, ponto: e.ponto, vel: e.vel, u: e.u, r: e.r, lead: e.lead, lead_fonte: e.lead_fonte, representante: e.representante, nos: e.nos.slice(0, 20) })
  for (const i of lista) {
    const x = grafo.doItem.get(String(i.id)); if (!x) continue
    const { produto: p, ef } = x, id = String(i.id)
    if (i.cobertura_anuncio === undefined) i.cobertura_anuncio = i.cobertura
    i.produto = { chave: p.chave, ef: ef?.chave ?? null, modo: p.modo, modo_proprio: p.modo_proprio, local: ef?.local ?? null, n_anuncios: p.nos.length, irmaos: p.nos.map(n => n.item_id).filter(y => y !== id).slice(0, 20),
      n_ef: ef?.nos.length ?? 1, irmaos_ef: (ef?.nos || []).filter(y => y !== id).slice(0, 20), skus: p.skus, efs: p.efs.map(efSlim), ligado,
      representa_estoque: depende(p) ? false : ef ? ef.representante === id : true, representa_produto: depende(p) ? false : p.representante === id, ...(p.kit ? { kit: { modo: p.kit.modo, componentes: p.kit.componentes } } : {}), estoque_ef: ef?.estoque ?? null, vel_ef: ef?.vel ?? null, u_ef: ef?.u ?? 0, r_ef: ef?.r ?? 0,
      cobertura_ef: ef?.cobertura ?? null, ponto_ef: ef?.ponto ?? null, estoque: p.estoque_compra ?? p.estoque, vel: p.vel, u: p.u, r: p.r, cobertura: p.cobertura, ponto: p.ponto, lead: p.lead, lead_fonte: p.lead_fonte,
      divergente_ml: p.pools.some(q => q.divergente), premissas: p.premissas, chaves_lidas: !p.nos.find(n => n.item_id === id)?.sem_chave }   // chaves_lidas = false: anúncio ainda sem a coleta da F1 (SKU não lido ≠ sem SKU)
    if (ligado) { i.cobertura = ef?.cobertura ?? null; i.ponto_reposicao = ef?.ponto ?? null }
  }
  return grafo
}

// ════════ F3: predicados e vistas ÚNICOS do produto para quem consome estoque (regras, gatilhos, textos, compras) ════════
// Sem i.produto (chave desligada: carregarBase não roda aplicarProduto) tudo devolve o número do próprio anúncio: nenhum consumidor muda de comportamento.
// Só o representante do EF «fala de estoque» (1 ação/aviso/linha por estoque físico); só o representante do produto «fala de compra» (1 linha por produto).
export const produtoLigado = i => i?.produto?.ligado === true
export const representaEstoque = i => !produtoLigado(i) || i.produto.representa_estoque !== false
export const representaProduto = i => !produtoLigado(i) || i.produto.representa_produto !== false
// números do ESTOQUE FÍSICO de referência que o anúncio representa (estoque contado 1×, demanda somada dos irmãos do EF); sem produto = os do anúncio
export const estoqueDe = i => produtoLigado(i)
  ? { estoque: i.produto.estoque_ef, vel: i.produto.vel_ef, u: i.produto.u_ef, r: i.produto.r_ef, n: i.produto.n_ef, irmaos: i.produto.irmaos_ef, cobertura: i.produto.cobertura_ef, ponto: i.produto.ponto_ef, ligado: true }
  : { estoque: i?.estoque ?? null, vel: i?.vel_dia ?? null, u: i?.u ?? 0, r: i?.r ?? 0, n: 1, irmaos: [], cobertura: i?.cobertura ?? null, ponto: i?.ponto_reposicao ?? null, ligado: false }
// EF Full em ruptura com estoque PRÓPRIO do mesmo produto: enviar ao Full (teto = próprio − ponto de pedido do próprio), não comprar — desenho § 4.2/§ 8.6.
// sug = cenários de sugestaoFull do EF Full ({ conservador, base }); → { conservador, base, proprio } | null (sem produto, sem Full, sem próprio > 0 ou sem folga)
export function envioDoProprio(i, sug) {
  if (!produtoLigado(i) || i.produto.local !== 'full' || !sug || !Number.isInteger(sug.conservador)) return null
  const ep = i.produto.efs.find(e => e.local === 'proprio' && e.estoque > 0); if (!ep) return null
  const teto = Math.max(0, ep.estoque - (ep.ponto ?? 0)); if (!(teto > 0)) return null
  const c = Math.min(sug.conservador, teto), b = Math.min(Math.max(Number.isInteger(sug.base) ? sug.base : sug.conservador, sug.conservador), teto)
  return b > 0 ? { conservador: c, base: b, proprio: ep.estoque } : null
}
// sufixo ao cliente quando o estoque é de vários anúncios («vende em 3 anúncios»); '' para anúncio sozinho
export const sufixoAnuncios = i => { const n = estoqueDe(i).n; return n > 1 ? ` (vende em ${n} anúncios)` : '' }
// linhas de COMPRA por produto (1 por produto: estoque Σ dos EFs contado 1×, demanda somada, prazo do representante) — a MESMA pseudo-lista da aba Produtos e de preverCompras
export function pseudoProdutos(itens) {
  const porId = new Map(itens.map(i => [String(i.id), i])), soma = (l, f) => l.reduce((t, x) => t + (f(x) || 0), 0), out = []
  for (const i of itens) {
    if (!produtoLigado(i)) { out.push(i); continue }
    if (!i.produto.representa_produto) continue                                  // só o representante do produto vira linha (os irmãos entram nele)
    const p = i.produto, ids = [String(i.id), ...p.irmaos], its = ids.map(x => porId.get(x)).filter(Boolean)
    const ativo = its.some(x => x.status === 'active'), zerado = its.every(x => x.status === 'paused' && x.estoque === 0)
    out.push({ ...i, status: ativo ? 'active' : zerado ? 'paused' : i.status, estoque: p.estoque, u: p.u, r: p.r, u0: soma(its, x => x.u0), u14: soma(its, x => x.u14), vel_pond: soma(its, x => x.vel_pond),
      vel_dia: p.vel, cobertura: p.cobertura, ponto_reposicao: p.ponto, lead_time_dias: p.lead ?? i.lead_time_dias, lead_time_fonte: p.lead_fonte ?? i.lead_time_fonte,
      logistica: p.efs.length && p.efs.every(e => e.local === 'full') ? 'fulfillment' : p.efs.some(e => e.local === 'proprio') ? (i.logistica === 'fulfillment' ? 'proprio' : i.logistica) : i.logistica,
      produto_linha: { chave: p.chave, n_anuncios: p.n_anuncios, itens: ids, modo: p.modo, efs: p.efs } })
  }
  return out
}

// ════════ F5/F6: divisão do estoque físico entre os estoques próprios do produto (desenho § 6.4 e § 7.3; desenho-v3-erp § A.4) ════════
// total = unidades a dividir (físico − segurança; nunca acima do físico) · pools = [{ chave, v (vendas/dia), local?, max? }]. Full fica FORA (o ML não aceita escrita).
// q_p = floor(total × v_p ÷ Σv), resto pelos maiores restos (empate = menor chave); sem venda em nenhum = partes iguais; piso de 1 un por pool só quando total ≥ nº de pools
// (rateio, nunca inflação — NÃO é o «mínimo» do UpSeller); max = teto por pool (o excedente vai aos outros com folga; todos no teto = Σ < total). Σ q ≤ total SEMPRE.
export function alocarEstoque(total, pools, { minimo = 1 } = {}) {
  const ps = (pools || []).filter(p => p && p.local !== 'full').map(p => ({ chave: String(p.chave), v: Math.max(0, Number(p.v) || 0), max: Number.isInteger(p.max) && p.max >= 0 ? p.max : Infinity })).sort((a, b) => a.chave.localeCompare(b.chave))
  const T = Number.isInteger(total) && total > 0 ? total : 0, q = new Map(ps.map(p => [p.chave, 0]))
  let resto = T
  for (let volta = 0; resto > 0 && volta < 5; volta++) {                       // ponytail: 5 voltas bastam para redistribuir o que bate no teto (pools ≤ dezenas)
    const livres = ps.filter(p => q.get(p.chave) < p.max); if (!livres.length) break
    const V = livres.reduce((t, p) => t + p.v, 0), peso = p => (V > 0 ? p.v / V : 1 / livres.length)
    const partes = livres.map(p => { const x = resto * peso(p); return { p, f: Math.min(Math.floor(x), p.max - q.get(p.chave)), r: x - Math.floor(x) } })
    for (const x of partes) { q.set(x.p.chave, q.get(x.p.chave) + x.f); resto -= x.f }
    for (const x of partes.sort((a, b) => b.r - a.r || a.p.chave.localeCompare(b.p.chave))) { if (resto <= 0) break; if (q.get(x.p.chave) < x.p.max) { q.set(x.p.chave, q.get(x.p.chave) + 1); resto-- } }
  }
  // piso de rateio: com total ≥ nº de pools × mínimo, quem ficou abaixo recebe do pool mais cheio (Σ não muda)
  if (minimo > 0 && T >= ps.length * minimo) for (const p of ps) while (q.get(p.chave) < Math.min(minimo, p.max)) {
    const doador = ps.filter(x => q.get(x.chave) > minimo).sort((a, b) => q.get(b.chave) - q.get(a.chave) || a.chave.localeCompare(b.chave))[0]; if (!doador) break
    q.set(doador.chave, q.get(doador.chave) - 1); q.set(p.chave, q.get(p.chave) + 1)
  }
  return ps.map(p => ({ chave: p.chave, quantidade: q.get(p.chave) }))
}
// cobertura (dias) com venda extra por dia (a duplicata vendendo o que a regra prevê) — o mesmo estoque, mais demanda
export const coberturaProjetada = (E, v, extra = 0) => (E != null && (v || 0) + (extra || 0) > 0 ? Math.round(E / ((v || 0) + (extra || 0))) : null)
// trava da quantidade de uma duplicata em UP NOVO (estoque separado): com físico informado, quantidade + Σ dos outros estoques próprios ≤ físico; sem físico, a publicação
// live fica pendente (o dry-run segue livre). → { ok, motivo: '' | 'estoque_acima_do_fisico' | 'estoque_fisico' } (motivos FIXOS, nunca o número recebido)
export function validarEstoqueFisico({ quantidade, fisico = null, outros = 0 } = {}) {
  if (!Number.isInteger(quantidade) || quantidade < 0) return { ok: false, motivo: 'quantidade_invalida' }
  if (fisico == null) return { ok: false, motivo: 'estoque_fisico' }
  return quantidade + Math.max(0, Number(outros) || 0) <= fisico ? { ok: true, motivo: '' } : { ok: false, motivo: 'estoque_acima_do_fisico' }
}
// conferência da duplicata publicada (dia seguinte, pela coleta): mesmo UP do original = o ML divide o estoque; UP novo = estoque separado (a regra estoque_dividido assume);
// esperava o mesmo UP e nasceu UP novo = estoque contado 2× (pendência assistida imediata «ajustar no painel»). Sem UP lido = null (nunca supor).
export function rotuloUpDuplicata({ upOriginal, upNovo, espera = 'up_novo' } = {}) {
  if (!upOriginal || !upNovo) return null
  if (upOriginal === upNovo) return { rotulo: 'divide_pelo_ml', texto: 'divide o estoque pelo ML' }
  return espera === 'mesmo_up' ? { rotulo: 'contado_2x', texto: 'estoque contado 2×: ajustar no painel', pendencia: true } : { rotulo: 'estoque_separado', texto: 'estoque separado' }
}
export const MOTIVOS_ESTOQUE_FISICO = {
  quantidade_invalida: 'quantidade de estoque inválida: inteiro ≥ 0',
  estoque_fisico: 'estoque físico do produto não informado: a publicação ao vivo da duplicata espera o estoque físico (o dry-run segue livre)',
  estoque_acima_do_fisico: 'a quantidade da duplicata somada aos outros estoques próprios do produto passa do estoque físico informado',
}

// «Gerenciar mapeamento» — SÓ SUGESTÃO, nunca junta: conflitos e links fora do automático (do grafo), seller_custom_field igual, título parecido (IDF ≥ min, pesos
// de duplicacao.js) e «Kit N» → componente provável. Cada sugestão: { tipo, origem, produto, motivo, similaridade? } — «Juntar» = vínculo manual origem → produto.
// Par entre 2 produtos de várias origens fica de fora (o vínculo move UMA origem). ponytail: O(n²) nos títulos; ~600 produtos por conta é instantâneo.
export function sugerirMapeamento(grafo, { recusas = [], min = 0.65, max = 60 } = {}) {
  const prodDoPool = new Map(grafo.produtos.flatMap(p => p.pools.map(q => [q.chave, p]))), out = [], vistos = new Set()
  const recusado = (o, k) => recusas.some(r => r.origem === o && r.produto === k)
  const add = (A, B, base) => {
    if (!A || !B || A === B) return
    const [o, d] = A.origens.length === 1 ? [A, B] : B.origens.length === 1 ? [B, A] : []
    if (!o) return
    const par = [A.chave, B.chave].sort().join('|')
    if (vistos.has(par) || recusado(o.origens[0], chaveAlvo(d)) || recusado(o.origens[0], d.chave)) return
    vistos.add(par); out.push({ ...base, origem: o.origens[0], produto: chaveAlvo(d), de: nome(o), para: nome(d) })
  }
  const nome = p => p.nos[0]?.titulo || p.chave
  for (const s of grafo.sugestoes) add(prodDoPool.get(s.a), prodDoPool.get(s.b), { tipo: s.tipo, motivo: s.motivo })
  const porScf = new Map(); for (const p of grafo.produtos) for (const n of p.nos) if (n.scf) (porScf.get(n.scf) || porScf.set(n.scf, new Set()).get(n.scf)).add(p)
  for (const [, ps] of [...porScf].sort((a, b) => a[0].localeCompare(b[0]))) { const l = [...ps]; l.slice(1).forEach(p => add(l[0], p, { tipo: 'seller_custom_field', motivo: 'mesmo SKU interno (seller_custom_field)' })) }
  // título: sobreposição ponderada pelo IDF no catálogo do cliente, entre os nomes dos produtos (o mesmo cálculo de acharFilhos)
  const tk = grafo.produtos.map(p => ({ p, t: tokens(nome(p), { tamanhos: true }), kit: p.kit_titulo })), df = new Map()   // tamanho conta (P × M × G são produtos diferentes)
  for (const x of tk) for (const w of x.t) df.set(w, (df.get(w) || 0) + 1)
  const idf = w => Math.log(1 + tk.length / (df.get(w) || 1)), peso = ws => ws.reduce((t, w) => t + idf(w), 0)
  // sobreposição nos DOIS sentidos (÷ o maior peso): título curto contido num longo não passa — «Coleira Passeio Cachorro» não é todo anúncio de coleira
  const sim = (a, b) => { const s = new Set(b), c = a.filter(w => s.has(w)); return c.length < 3 ? 0 : peso(c) / Math.max(1e-9, peso(a), peso(b)) }
  const pares = []
  for (let i = 0; i < tk.length; i++) for (let j = i + 1; j < tk.length; j++) {
    if (tk[i].kit !== tk[j].kit) continue                                           // kit × componente é a sugestão de kit, abaixo
    const s = sim(tk[i].t, tk[j].t); if (s >= min) pares.push([s, tk[i].p, tk[j].p])
  }
  const comTitulo = new Set()                                                         // 1 sugestão de título por produto (a melhor)
  for (const [s, a, b] of pares.sort((x, y) => y[0] - x[0])) {
    if (comTitulo.has(a.chave) || comTitulo.has(b.chave)) continue
    const antes = out.length; add(a, b, { tipo: 'titulo', motivo: `título ${Math.round(s * 100)}% parecido`, similaridade: r2(s) })
    if (out.length > antes) { comTitulo.add(a.chave); comTitulo.add(b.chave) }
  }
  for (const k of tk.filter(x => x.kit)) {
    const q = Number(nome(k.p).match(/(?:kit|pacote|combo|jogo|c\/)\s*(?:com\s*)?(\d{1,3})/i)?.[1]) || null
    const t = k.t.filter(w => !/^\d+$/.test(w) && !/^(kit|pacote|combo|jogo|unidades|unid|und|pecas)$/.test(w))
    const c = tk.filter(x => !x.kit).map(x => [sim(t, x.t), x.p]).sort((a, b) => b[0] - a[0])[0]
    if (c && c[0] >= min) out.push({ tipo: 'kit', origem: k.p.origens[0], produto: chaveAlvo(c[1]), de: nome(k.p), para: nome(c[1]), similaridade: r2(c[0]),
      motivo: `${q ? `Kit ${q}un → ${q} × ` : 'kit → '}${nome(c[1]).slice(0, 50)}? (composição do kit: F5)` })
  }
  return out.slice(0, max)
}
