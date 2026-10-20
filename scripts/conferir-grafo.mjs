// Conferidor da V3 (F1, docs/desenho-v3-produto-estoque-financeiro.md § 9) — SÓ LEITURA: abre data/db.sqlite com { readonly: true }
// (nunca db.js, que migra; nunca cópia do banco). Por cliente: quantos anúncios têm cada chave do produto, os pools (UP × local), os grupos
// encontrados (mesmo UP, mesmo SKU oficial em pools diferentes, mesmo catálogo, conflito catálogo × SKU), Σ estoque por anúncio × uma vez
// por pool, pools com números divergentes, candidatos a kit e a invariante das linhas de pedido (Σ linhas = série, ±1 c por linha).
// Fonte: meli_anuncio_up quando o cliente já tem arestas (coleta F1); senão SIMULAÇÃO com o que o banco já tem — promo_anuncio (UP e SKU,
// 18 clientes), meli_item_snapshot (SELLER_SKU), meli_item (catálogo, logística, estoque) e meli_full_estoque (inventory_id) — rotulada.
// A simulação é só do nível do anúncio (sem variações) e subestima: inventory_id só do anúncio que a saúde guardou por inventário.
// Uso: node scripts/conferir-grafo.mjs [--cliente "Nome"] [--simular] [--grupos N]
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { ROOT } from '../src/lib/env.js'
import { chaveSku, SKU_OFICIAL, conferirLinhasComSerie } from '../src/lib/produto-estoque.js'

const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null }
const SO = arg('--cliente'), FORCAR_SIM = process.argv.includes('--simular'), N_GRUPOS = Number(arg('--grupos') ?? (SO ? 8 : 0))
const db = new Database(join(ROOT, 'data', 'db.sqlite'), { readonly: true, fileMustExist: true })
const tem = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
const temCol = (t, c) => tem(t) && db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c)
const KIT = /\b(kit|pacote|combo|c\/|jogo)\b.*\d+/i
const FONTE_PROMO = { 'attributes.SELLER_SKU': 'seller_sku', 'user-products': 'seller_sku', 'variação': 'variacao', seller_custom_field: 'seller_custom_field' }

const clientes = db.prepare("SELECT DISTINCT cliente FROM meli_item WHERE status IN ('active','paused') AND cliente NOT LIKE '[%' ORDER BY cliente").all().map(r => r.cliente)
  .filter(c => !SO || c === SO)
if (SO && !clientes.length) { console.log('cliente não encontrado (ou prospect)'); process.exit(1) }

function arestasReais(c) {
  if (FORCAR_SIM || !tem('meli_anuncio_up')) return null
  const a = db.prepare(`SELECT u.item_id, u.variacao_id, u.user_product_id, u.inventory_id, u.sku, u.sku_fonte, u.catalogo_produto_id, u.estoque, u.logistica, u.tags, u.status,
    u.lido_em, i.titulo FROM meli_anuncio_up u LEFT JOIN meli_item i ON i.cliente = u.cliente AND i.item_id = u.item_id WHERE u.cliente = ?`).all(c)
  return a.length ? a : null
}
function arestasSimuladas(c) {
  const promo = tem('promo_anuncio') ? new Map(db.prepare('SELECT item_id, user_product_id, sku, sku_fonte FROM promo_anuncio WHERE cliente = ?').all(c).map(r => [r.item_id, r])) : new Map()
  const snap = new Map()
  if (tem('meli_item_snapshot')) for (const r of db.prepare('SELECT item_id, atributos_json FROM meli_item_snapshot WHERE cliente = ? ORDER BY capturado_em').all(c)) {
    try { const s = String(JSON.parse(r.atributos_json || '{}').SELLER_SKU || '').trim(); if (s) snap.set(r.item_id, s) } catch { /* snapshot defensivo */ }
  }
  const inv = tem('meli_full_estoque') ? new Map(db.prepare('SELECT item_id, inventory_id FROM meli_full_estoque WHERE cliente = ? AND item_id IS NOT NULL ORDER BY dia').all(c).map(r => [r.item_id, r.inventory_id])) : new Map()
  return db.prepare('SELECT item_id, titulo, status, estoque, logistica, catalogo_produto_id, atualizado_em FROM meli_item WHERE cliente = ?').all(c).map(i => {
    const p = promo.get(i.item_id), fp = FONTE_PROMO[p?.sku_fonte] || ''
    const [sku, sku_fonte] = p?.sku && fp ? [p.sku, fp] : snap.has(i.item_id) ? [snap.get(i.item_id), 'seller_sku'] : ['', '']
    return { item_id: i.item_id, variacao_id: '', user_product_id: p?.user_product_id || '', inventory_id: inv.get(i.item_id) || '', sku, sku_fonte,
      catalogo_produto_id: i.catalogo_produto_id || '', estoque: i.estoque, logistica: i.logistica, tags: '', status: i.status, lido_em: i.atualizado_em, titulo: i.titulo }
  })
}

const local = a => (a.logistica === 'fulfillment' ? 'full' : 'proprio')
const pool = a => (a.user_product_id ? `up:${a.user_product_id}` : a.inventory_id ? `inv:${a.inventory_id}` : `item:${a.item_id}${a.variacao_id ? ':' + a.variacao_id : ''}`) + `|${local(a)}`
const agrupar = (lista, chave) => { const m = new Map(); for (const x of lista) { const k = chave(x); if (k) m.set(k, [...(m.get(k) || []), x]) } return m }
const pct = (k, n) => (n ? `${Math.round((k / n) * 100)}%` : '—')

function conferir(c) {
  const reais = arestasReais(c), todas = reais || arestasSimuladas(c), fonte = reais ? 'F1' : 'simulação'
  const at = todas.filter(a => a.status === 'active'), nAnuncios = new Set(at.map(a => a.item_id)).size
  const conta = f => at.filter(f).length
  const cob = { arestas: at.length, up: conta(a => a.user_product_id), inv: conta(a => a.inventory_id), sku_oficial: conta(a => SKU_OFICIAL.has(a.sku_fonte)),
    sku_pedido: conta(a => a.sku_fonte === 'pedido'), so_scf: conta(a => a.sku_fonte === 'seller_custom_field'), catalogo: conta(a => a.catalogo_produto_id),
    sem_chave: conta(a => !a.user_product_id && !a.inventory_id && !SKU_OFICIAL.has(a.sku_fonte) && !a.catalogo_produto_id) }
  // pools: estoque contado uma vez (o lido mais recente; empate = maior); divergente = irmãos ativos com números diferentes
  const pools = agrupar(at, pool), info = new Map()
  for (const [k, l] of pools) {
    const nums = l.filter(a => a.estoque != null)
    const ref = nums.sort((x, y) => String(y.lido_em).localeCompare(String(x.lido_em)) || y.estoque - x.estoque)[0]
    info.set(k, { n: new Set(l.map(a => a.item_id)).size, estoque: ref ? ref.estoque : null, divergente: new Set(nums.map(a => a.estoque)).size > 1, sku: [...new Set(l.filter(a => SKU_OFICIAL.has(a.sku_fonte)).map(a => chaveSku(a.sku)))], cat: [...new Set(l.map(a => a.catalogo_produto_id).filter(Boolean))], itens: l })
  }
  const somaAnuncio = at.reduce((s, a) => s + (a.estoque ?? 0), 0), somaPool = [...info.values()].reduce((s, p) => s + (p.estoque ?? 0), 0)
  // grupos encontrados (só fatos da F1; o produto e os modos espelho/dividido são da F2)
  const upCompart = [...info.entries()].filter(([k, p]) => k.startsWith('up:') && p.n >= 2)
  const porSku = new Map(), porCat = new Map()
  for (const [k, p] of info) { for (const s of p.sku) porSku.set(s, [...(porSku.get(s) || []), k]); for (const x of p.cat) porCat.set(x, [...(porCat.get(x) || []), k]) }
  const skuMulti = [...porSku.entries()].filter(([, ks]) => ks.length >= 2)
  const skuProprios = skuMulti.filter(([, ks]) => ks.filter(k => k.endsWith('|proprio')).length >= 2)
  const skuEspelho = skuProprios.filter(([, ks]) => { const v = ks.filter(k => k.endsWith('|proprio')).map(k => info.get(k).estoque); return v.every(x => x != null && x === v[0]) })
  const skuSoFull = skuMulti.filter(([, ks]) => ks.some(k => k.endsWith('|full')) && ks.filter(k => k.endsWith('|proprio')).length < 2)
  const catMulti = [...porCat.entries()].filter(([, ks]) => ks.length >= 2)
  const conflito = catMulti.filter(([, ks]) => new Set(ks.flatMap(k => info.get(k).sku)).size >= 2)
  const somaSkuRep = (f) => skuMulti.reduce((s, [, ks]) => s + ks.reduce((t, k) => t + f(k), 0), 0)
  const repAnuncio = somaSkuRep(k => info.get(k).itens.reduce((t, a) => t + (a.estoque ?? 0), 0)), repPool = somaSkuRep(k => info.get(k).estoque ?? 0)
  const kits = { titulo: new Set(at.filter(a => KIT.test(a.titulo || '')).map(a => a.item_id)).size, bundle: conta(a => /bundle/.test(a.tags)), kit_component: conta(a => /kit_component/.test(a.tags)) }
  // invariante das linhas de pedido (dias com linhas = 1)
  let inv = { dias: 0, itens_dia: 0, furos: [] }
  if (temCol('meli_coleta_dia', 'linhas') && tem('meli_pedido_item')) {
    const dias = db.prepare('SELECT dia FROM meli_coleta_dia WHERE cliente = ? AND linhas = 1 ORDER BY dia').all(c).map(r => r.dia)
    for (const d of dias) {
      const linhas = db.prepare("SELECT item_id, quantidade, preco_unit_c FROM meli_pedido_item WHERE cliente = ? AND dia = ? AND status = 'paid'").all(c, d)
      const serie = new Map(db.prepare('SELECT item_id, unidades u, receita r FROM meli_serie_item WHERE cliente = ? AND dia = ? AND (unidades > 0 OR receita > 0)').all(c, d).map(r => [r.item_id, r]))
      const f = conferirLinhasComSerie(linhas, serie)
      inv.dias++; inv.itens_dia += new Set([...linhas.map(l => l.item_id), ...serie.keys()]).size; inv.furos.push(...f.map(i => `${d} ${i}`))
    }
  }
  return { c, fonte, nAnuncios, cob, pools: info.size, pools_compartilhados: [...info.values()].filter(p => p.n >= 2).length, divergentes: [...info.values()].filter(p => p.divergente).length,
    somaAnuncio, somaPool, upCompart, skuMulti, skuProprios, skuEspelho, skuSoFull, catMulti, conflito, repAnuncio, repPool, kits, inv, info }
}

const res = clientes.map(conferir)
const L = (...x) => console.log(x.join(''))
L(`Conferidor V3 F1 — ${new Date().toISOString().slice(0, 16)}Z — banco aberto SÓ LEITURA; ${res.filter(r => r.fonte === 'F1').length} cliente(s) com arestas da F1, ${res.filter(r => r.fonte !== 'F1').length} em SIMULAÇÃO (fontes atuais do banco)`)
L('cliente'.padEnd(26), 'fonte'.padEnd(10), 'anúnc'.padStart(6), ' UP'.padStart(6), ' inv'.padStart(6), ' SKUof'.padStart(7), ' scf'.padStart(5), ' cat'.padStart(6), ' s/chave'.padStart(8),
  ' pools'.padStart(7), ' UP2+'.padStart(6), ' SKU2+'.padStart(6), ' esp/div'.padStart(9), ' Fu×pr'.padStart(6), ' conf'.padStart(5), ' diverg'.padStart(7), '  Σ/anúncio'.padStart(12), '  Σ/pool'.padStart(10), ' kits'.padStart(6))
const tot = { n: 0, up: 0, inv: 0, sku: 0, scf: 0, cat: 0, sem: 0, pools: 0, up2: 0, sku2: 0, esp: 0, div: 0, fp: 0, conf: 0, dv: 0, sa: 0, sp: 0, ra: 0, rp: 0, kit: 0 }
for (const r of res) {
  const a = r.cob.arestas
  L(r.c.slice(0, 25).padEnd(26), r.fonte.padEnd(10), String(r.nAnuncios).padStart(6), pct(r.cob.up, a).padStart(6), pct(r.cob.inv, a).padStart(6), pct(r.cob.sku_oficial, a).padStart(7), String(r.cob.so_scf).padStart(5),
    pct(r.cob.catalogo, a).padStart(6), String(r.cob.sem_chave).padStart(8), String(r.pools).padStart(7), String(r.upCompart.length).padStart(6), String(r.skuMulti.length).padStart(6),
    `${r.skuEspelho.length}/${r.skuProprios.length - r.skuEspelho.length}`.padStart(9), String(r.skuSoFull.length).padStart(6), String(r.conflito.length).padStart(5), String(r.divergentes).padStart(7),
    r.somaAnuncio.toLocaleString('pt-BR').padStart(12), r.somaPool.toLocaleString('pt-BR').padStart(10), String(r.kits.titulo).padStart(6))
  Object.entries({ n: r.nAnuncios, up: r.cob.up, inv: r.cob.inv, sku: r.cob.sku_oficial, scf: r.cob.so_scf, cat: r.cob.catalogo, sem: r.cob.sem_chave, pools: r.pools, up2: r.upCompart.length, sku2: r.skuMulti.length,
    esp: r.skuEspelho.length, div: r.skuProprios.length - r.skuEspelho.length, fp: r.skuSoFull.length, conf: r.conflito.length, dv: r.divergentes, sa: r.somaAnuncio, sp: r.somaPool, ra: r.repAnuncio, rp: r.repPool, kit: r.kits.titulo }).forEach(([k, v]) => { tot[k] += v })
}
const nAr = res.reduce((s, r) => s + r.cob.arestas, 0)
L(`\nTOTAL ${res.length} clientes · ${tot.n} anúncios ativos (${nAr} arestas) · UP ${pct(tot.up, nAr)} · inventory_id ${pct(tot.inv, nAr)} · SKU oficial ${pct(tot.sku, nAr)} · só seller_custom_field ${tot.scf} · catálogo ${pct(tot.cat, nAr)} · sem chave nenhuma ${tot.sem}`)
L(`Pools (UP × local): ${tot.pools} · UPs com 2+ anúncios: ${tot.up2} · SKUs oficiais em 2+ pools: ${tot.sku2} (2+ próprios com o MESMO número ${tot.esp} · com números diferentes ${tot.div} · só Full × próprio ${tot.fp}) · conflito catálogo × SKU: ${tot.conf} · pools com irmãos divergentes: ${tot.dv}`)
L(`Estoque ativo: Σ por anúncio ${tot.sa.toLocaleString('pt-BR')} un × uma vez por pool ${tot.sp.toLocaleString('pt-BR')} un. Nos SKUs repetidos: Σ por anúncio ${tot.ra.toLocaleString('pt-BR')} × uma vez por pool ${tot.rp.toLocaleString('pt-BR')} (o «uma vez por produto» depende do modo espelho/dividido: F2).`)
L(`Candidatos a kit pelo título (só sugestão, nunca composição): ${tot.kit}. Colunas: esp/div = SKUs com 2+ pools próprios e o mesmo número / números diferentes; Fu×pr = SKU só em Full × próprio; conf = mesmo catálogo com SKUs oficiais diferentes.`)
const li = res.filter(r => r.inv.dias)
L(li.length ? `Linhas de pedido: ${li.map(r => `${r.c.slice(0, 20)} ${r.inv.dias} dia(s), ${r.inv.itens_dia} anúncio·dia, ${r.inv.furos.length ? `${r.inv.furos.length} FURO(S): ${r.inv.furos.slice(0, 3).join(', ')}` : 'invariante ok'}`).join(' · ')}`
  : 'Linhas de pedido: nenhum dia com linhas = 1 ainda (a coleta da F1 começa depois do reinício do servidor) — invariante sem dado, não «ok».')

if (N_GRUPOS > 0) for (const r of res) {
  L(`\n── ${r.c} (${r.fonte}) — grupos (até ${N_GRUPOS} por tipo) ──`)
  const desc = k => { const p = r.info.get(k); return `${k} ${p.n} anúncio(s) estoque ${p.estoque ?? '—'}${p.divergente ? ' DIVERGENTE' : ''}` }
  r.upCompart.slice(0, N_GRUPOS).forEach(([k, p]) => L(`  mesmo UP: ${desc(k)} — ${p.itens.map(a => a.item_id).join(', ')}`))
  r.skuMulti.slice(0, N_GRUPOS).forEach(([s, ks]) => L(`  mesmo SKU «${s}»: ${ks.map(desc).join(' | ')}`))
  r.conflito.slice(0, N_GRUPOS).forEach(([x, ks]) => L(`  CONFLITO catálogo ${x}: SKUs ${[...new Set(ks.flatMap(k => r.info.get(k).sku))].join(' × ')}`))
  if (r.inv.furos.length) L(`  furos da invariante: ${r.inv.furos.slice(0, N_GRUPOS).join(', ')}`)
}
db.close()
