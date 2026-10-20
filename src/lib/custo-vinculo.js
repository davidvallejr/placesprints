// Vínculo manual CUSTO ↔ ANÚNCIO (item_id → SKU de custo). 'manual' manda sobre o SKU do anúncio; 'recusado' = "não é este" (o candidato não volta).
// ATENÇÃO: db.js e promocoes-db.js importam este arquivo (DDL). Nada de import estático de db.js/promocoes-db.js/custos-db.js aqui:
// viraria import circular (TDZ ou deadlock com o top-level await de promocoes-db). Lógica com banco entra por fábrica (handle), como vinculos.js.
// A instância com o banco real é `vinculosCusto`, criada em custos-db.js (que injeta os custos efetivos, a chaveSku e a auditoria).
import { indiceVinculo } from './vinculos.js'
import { origemCatalogo } from './catalogo.js'
import { criarCatalogo } from './catalogo-db.js'          // sem import de banco: o handle entra por fábrica
import { SKU_OFICIAL } from './produto-estoque.js'       // PURO (sem banco): quais sku_fonte de meli_anuncio_up são SKU oficial

export const SCHEMA_CUSTO_VINCULO = `
CREATE TABLE IF NOT EXISTS custo_vinculo (cliente TEXT NOT NULL, item_id TEXT NOT NULL, sku_custo TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('manual','recusado')), por TEXT NOT NULL, em TEXT NOT NULL, PRIMARY KEY (cliente, item_id, sku_custo));
`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
// SKU normalizado forte: minúsculas, NFC, sem espaços, hífens e caractere invisível ("Cinto desegurança" = "CINTODESEGURANÇA").
// O ponto FICA: separa decimal/versão ("AGUA-1.5L" não é "AGUA-15L") e o casamento de nível 3 é automático, sem confirmação.
export const skuForte = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s\-\u200B-\u200D\uFEFF]+/g, '')
const SEM_CUSTO = Object.freeze({ custo: null, sku_custo: null, origem: null })
const MAX_CANDIDATOS = 5, MAX_LISTA = 500

// ── núcleo PURO: Map(item_id → { chave, origem }) = qual SKU de custo vale para cada anúncio. Precedência (o MLB manda sobre o SKU, como regraDoAnuncio):
//   1 manual (custo_vinculo) · 2 SKU exato (chaveSku, como sempre foi) · 3 SKU normalizado forte, só se a chave aponta para UM único SKU de custo ·
//   4 mesmo produto (user_product_id ou inventory_id) de anúncio já resolvido em 1–3, só se o grupo inteiro concorda. 'recusado' tira o par (anúncio, SKU de custo) dos níveis 2–4.
// `chaves` = Set das chaves com custo; `vinculos` = linhas de custo_vinculo do cliente.
// Anúncio com variações (15/10/2026, F1 meli_anuncio_up): `skus` = SKU do anúncio + SKUs oficiais das variações. O SKU do anúncio (a.sku) manda; senão as variações
// só casam se TODAS as que têm custo apontam para a MESMA chave — ou, com `custoDe`, para chaves de MESMO custo (P/M/G de mesmo custo); custos diferentes por
// variação = sem custo único do anúncio (a venda usa o da variação em lucro-real).
// `grupos` = ['up:MLBU…', 'inv:…'] (sem `grupos`, o user_product_id de sempre).
const chaveUnica = (ks, custoDe) => { const u = [...new Set(ks.filter(Boolean))].sort(); return u.length === 1 || (custoDe && u.length && u.every(k => custoDe(k) === custoDe(u[0]))) ? u[0] : null }
export function resolverChaves(anuncios, chaves, vinculos, chaveSku, custoDe = null) {
  const manual = new Map(), recusado = new Set(), porForte = new Map(), out = new Map()
  for (const v of vinculos) if (v.origem === 'manual') manual.set(v.item_id, v.sku_custo); else recusado.add(`${v.item_id}|${v.sku_custo}`)
  for (const k of chaves) { const f = skuForte(k); if (f) porForte.set(f, porForte.has(f) ? null : k) }     // null = 2+ custos na mesma chave: ambíguo, não casa
  const livre = (id, k) => !recusado.has(`${id}|${k}`)
  const exato = (id, s) => { const k = chaveSku(s); return k && chaves.has(k) && livre(id, k) ? k : null }
  const forte = (id, s) => { const f = porForte.get(skuForte(s)); return f && livre(id, f) ? f : null }
  for (const a of anuncios) {
    // manual vale mesmo se o custo dele sumiu: o anúncio fica sem custo (não cai no SKU, que alguém já disse não ser o dele)
    if (manual.has(a.item_id)) { out.set(a.item_id, { chave: manual.get(a.item_id), origem: 'manual' }); continue }
    const vars = (a.skus || []).filter(s => s && s !== a.sku)
    const k = exato(a.item_id, a.sku) || (vars.length ? chaveUnica(vars.map(s => exato(a.item_id, s)), custoDe) : null)
    const f = k ? null : forte(a.item_id, a.sku) || (vars.length ? chaveUnica(vars.map(s => forte(a.item_id, s)), custoDe) : null)
    if (k) out.set(a.item_id, { chave: k, origem: 'sku' })
    else if (f) out.set(a.item_id, { chave: f, origem: 'sku_normalizado' })
  }
  const grupo = new Map(), gruposDe = a => a.grupos || (a.user_product_id ? [`up:${a.user_product_id}`] : [])
  for (const a of anuncios) {
    const r = out.get(a.item_id)
    // só vota quem tem custo vigente: um manual cujo custo foi descartado (chave morta) não anula a herança do irmão válido
    if (r && chaves.has(r.chave)) for (const g of gruposDe(a)) grupo.set(g, !grupo.has(g) || grupo.get(g) === r.chave ? r.chave : null)
  }
  for (const a of anuncios) {
    if (out.has(a.item_id)) continue
    const votos = gruposDe(a).filter(g => grupo.has(g)).map(g => grupo.get(g)), k = votos.length && votos.every(v => v && v === votos[0]) ? votos[0] : null
    if (k && livre(a.item_id, k)) out.set(a.item_id, { chave: k, origem: 'grupo' })
  }
  return out
}

// chaves do produto da coleta F1 (meli_anuncio_up): Map(item_id → { sku do anúncio, skus oficiais (anúncio + variações), grupos up:/inv: }). Tabela ausente = Map vazio.
export function chavesF1(linhas) {
  const m = new Map()
  for (const r of linhas) {
    const x = m.get(r.item_id) || m.set(r.item_id, { sku: '', skus: [], grupos: [] }).get(r.item_id)
    if (r.sku && SKU_OFICIAL.has(r.sku_fonte)) { if (!r.variacao_id) x.sku = r.sku; if (!x.skus.includes(r.sku)) x.skus.push(r.sku) }
    for (const g of [r.user_product_id && `up:${r.user_product_id}`, r.inventory_id && `inv:${r.inventory_id}`]) if (g && !x.grupos.includes(g)) x.grupos.push(g)
  }
  return m
}
// promo_anuncio (sku, user_product_id) + F1: o SKU da coleta de promoções manda; o F1 acrescenta variações e grupos (e o anúncio fora das promoções)
export function juntarChaves(promo, f1) {
  const out = new Map()
  for (const a of promo) { const u = f1.get(a.item_id); out.set(a.item_id, { ...a, skus: [...new Set([a.sku, ...(u?.skus || [])].filter(Boolean))], grupos: [...new Set([a.user_product_id && `up:${a.user_product_id}`, ...(u?.grupos || [])].filter(Boolean))] }) }
  for (const [id, u] of f1) if (!out.has(id)) out.set(id, { item_id: id, sku: u.sku, user_product_id: '', skus: u.skus, grupos: u.grupos })
  return out
}

// ── camada com banco ───────────────────────────────────────────────────────────
// efetivos(cliente) → Map(chave → { sku, custo }) (custos-db: manual > bling > tiny > sheets; quarentena e custo ≤ 0 nunca entram)
export function criarCustoVinculo(handle, { efetivos, chaveSku, auditar = () => {} }) {
  const lerVinculos = cliente => handle.prepare('SELECT item_id, sku_custo, origem, por, em FROM custo_vinculo WHERE cliente = ?').all(cliente)
  const catalogoDb = criarCatalogo(handle)
  const doMeli = (sql, ...p) => { try { return handle.prepare(sql).all(...p) } catch { return [] } }     // meli_item não existe no banco em memória das promoções
  const f1 = cliente => chavesF1(doMeli('SELECT item_id, variacao_id, sku, sku_fonte, user_product_id, inventory_id FROM meli_anuncio_up WHERE cliente = ?', cliente))
  // anúncios do cliente: promo_anuncio (tem SKU, user_product_id e fat30) + meli_item (tem miniatura; anúncio fora das promoções entra sem SKU)
  function anunciosDoCliente(cliente) {
    const m = juntarChaves(handle.prepare('SELECT item_id, sku, titulo, user_product_id, fat30, status, catalogo FROM promo_anuncio WHERE cliente = ?').all(cliente).map(a => ({ ...a, thumb: '' })), f1(cliente))
    for (const r of doMeli('SELECT item_id, titulo, thumb, status, catalogo FROM meli_item WHERE cliente = ?', cliente)) {
      const a = m.get(r.item_id)
      if (a) { a.thumb = r.thumb || ''; a.catalogo = a.catalogo || r.catalogo; a.titulo ||= r.titulo || ''; a.status ||= r.status || ''; a.fat30 ??= 0 }
      else m.set(r.item_id, { item_id: r.item_id, sku: '', titulo: r.titulo || '', user_product_id: '', fat30: 0, status: r.status || '', thumb: r.thumb || '', catalogo: r.catalogo })
    }
    const ctx = catalogoDb.contexto(cliente)       // selo de catálogo na tela de vínculo: terceiros/próprio (marcação manual) ou 'nao'
    return [...m.values()].map(a => ({ ...a, catalogo_origem: origemCatalogo({ id: a.item_id, catalogo: a.catalogo }, ctx) }))
  }
  const doCliente = (cliente, id) => !!handle.prepare('SELECT 1 FROM promo_anuncio WHERE cliente = ? AND item_id = ?').get(cliente, id)
    || doMeli('SELECT 1 FROM meli_item WHERE cliente = ? AND item_id = ?', cliente, id).length > 0

  // custo de cada anúncio pela resolução única: Map(item_id → { custo, sku_custo, origem, chave }) SÓ de quem tem custo. Uma leitura por chamada (sem N consultas):
  // os irmãos de user_product_id vêm de promo_anuncio; o anúncio passado manda sobre a linha gravada, e o que ele não traz (sku/user_product_id
  // ausentes, ex.: linha do meli_item) vem dela. memo ({} do chamador, um cliente só): quem resolve um anúncio por vez num laço (capacidades das
  // Ofertas, uma variante por vez — variações do mesmo MLB têm SKUs diferentes, não cabem num lote por item_id) lê custos, anúncios e vínculos uma vez.
  // ponytail: com memo a leitura é única, mas a resolução (pura) ainda roda por chamada: O(variantes × anúncios) em CPU
  function custosDosAnuncios(cliente, anuncios, memo = null) {
    const base = memo?.base || { ef: efetivos(cliente), linhas: juntarChaves(handle.prepare('SELECT item_id, sku, user_product_id FROM promo_anuncio WHERE cliente = ?').all(cliente), f1(cliente)), vinc: lerVinculos(cliente) }
    if (memo) memo.base = base
    const ef = base.ef, todos = new Map(base.linhas)
    base.chaves ??= new Set(ef.keys())
    // SKU passado (ex.: o da venda, em lucro-real) = só ele casa no nível 2–3; sem SKU passado, o anúncio + as variações do F1
    for (const a of anuncios) { const g = todos.get(a.item_id); todos.set(a.item_id, { ...a, sku: a.sku ?? g?.sku ?? '', user_product_id: a.user_product_id ?? g?.user_product_id ?? '',
      skus: a.sku != null ? [a.sku] : g?.skus || [], grupos: [...new Set([a.user_product_id && `up:${a.user_product_id}`, ...(g?.grupos || [])].filter(Boolean))] }) }
    const res = resolverChaves([...todos.values()], base.chaves, base.vinc, chaveSku, k => ef.get(k)?.custo), out = new Map()
    for (const a of anuncios) { const r = res.get(a.item_id), c = r && ef.get(r.chave); if (c) out.set(a.item_id, { custo: c.custo, sku_custo: c.sku, origem: r.origem, chave: r.chave }) }
    return out
  }
  const custoDoAnuncio = (cliente, anuncio, memo = null) => custosDosAnuncios(cliente, [anuncio], memo).get(anuncio.item_id) || SEM_CUSTO

  // ── vincular / recusar / desvincular: validação na porta (mensagens nunca repetem o valor recebido) ──
  function validar({ cliente, item_id, sku_custo, por }, { exigeCusto = true } = {}) {
    if (typeof cliente !== 'string' || !cliente.trim()) throw erro('cliente obrigatório')
    if (cliente.startsWith('[Comercial]')) throw erro('prospect do Comercial não é cliente: vínculo de custo só para cliente')
    const id = typeof item_id === 'string' ? item_id.trim().toUpperCase() : ''
    if (!/^MLB\d{1,14}$/.test(id)) throw erro('anúncio inválido: use o código MLB (ex.: MLB1234567890)')
    const quem = typeof por === 'string' ? por.trim() : ''
    if (!quem) throw erro('informe "por" (quem está fazendo o vínculo)')
    if (quem.length > 80) throw erro('"por" longo demais (máx. 80 caracteres)')
    if (!doCliente(cliente, id)) throw erro('anúncio não encontrado neste cliente', 404)
    if (sku_custo != null && typeof sku_custo !== 'string') throw erro('"sku_custo" deve ser texto')
    const chave = chaveSku(sku_custo), ef = exigeCusto || chave ? efetivos(cliente) : null
    if (exigeCusto && !ef.has(chave)) throw erro('SKU de custo sem custo vigente neste cliente (cadastre o custo antes de vincular)')
    return { id, chave, quem, sku: ef?.get(chave)?.sku || chave }
  }
  const gravar = (cliente, id, chave, origem, quem) => handle.prepare(`INSERT INTO custo_vinculo (cliente, item_id, sku_custo, origem, por, em) VALUES (?,?,?,?,?,?)
    ON CONFLICT(cliente, item_id, sku_custo) DO UPDATE SET origem = excluded.origem, por = excluded.por, em = excluded.em`).run(cliente, id, chave, origem, quem, new Date().toISOString())
  function vincular(p) {
    const { id, chave, quem, sku } = validar(p)
    handle.transaction(() => {
      handle.prepare("DELETE FROM custo_vinculo WHERE cliente = ? AND item_id = ? AND origem = 'manual'").run(p.cliente, id)    // um custo por anúncio
      gravar(p.cliente, id, chave, 'manual', quem)
      auditar(p.cliente, 'custo_vinculo', { item_id: id, autor: quem, depois: { sku_custo: sku, origem: 'manual' }, detalhe: 'vínculo manual custo ↔ anúncio' })
    })()
    return { ok: true, item_id: id, sku_custo: sku, origem: 'manual' }
  }
  function recusar(p) {                                                // "não é este": o par sai das sugestões e dos casamentos automáticos
    const { id, chave, quem, sku } = validar(p)
    handle.transaction(() => {
      gravar(p.cliente, id, chave, 'recusado', quem)
      auditar(p.cliente, 'custo_vinculo', { item_id: id, autor: quem, depois: { sku_custo: sku, origem: 'recusado' }, detalhe: 'não é este custo' })
    })()
    return { ok: true, item_id: id, sku_custo: sku, origem: 'recusado' }
  }
  function desvincular(p) {                                            // sem sku_custo: tira o manual do anúncio; com sku_custo: apaga o par (desfaz também um "não é este")
    const { id, chave, quem } = validar(p, { exigeCusto: false })
    let removidos = 0
    handle.transaction(() => {
      removidos = (chave ? handle.prepare('DELETE FROM custo_vinculo WHERE cliente = ? AND item_id = ? AND sku_custo = ?').run(p.cliente, id, chave)
        : handle.prepare("DELETE FROM custo_vinculo WHERE cliente = ? AND item_id = ? AND origem = 'manual'").run(p.cliente, id)).changes
      if (removidos) auditar(p.cliente, 'custo_vinculo', { item_id: id, autor: quem, depois: { removidos }, detalhe: 'vínculo de custo desfeito' })
    })()
    return { ok: true, item_id: id, removidos }
  }

  // ── tela: custos sem anúncio e anúncios sem custo, com candidatos (semelhança nome do custo × título; NUNCA grava) ──
  // ponytail: matriz custos × anúncios sem custo em memória (índice tokeniza o catálogo uma vez); milhares × milhares ~1 s — paginar se um cliente passar disso
  function listarVinculos(cliente) {
    if (typeof cliente !== 'string' || !cliente.trim()) throw erro('cliente obrigatório')
    if (cliente.startsWith('[Comercial]')) throw erro('prospect do Comercial não é cliente: vínculo de custo só para cliente')
    const ef = efetivos(cliente), vinc = lerVinculos(cliente)
    const anuncios = anunciosDoCliente(cliente), res = resolverChaves(anuncios, new Set(ef.keys()), vinc, chaveSku, k => ef.get(k)?.custo)
    const comCusto = id => ef.has(res.get(id)?.chave), recusado = new Set(vinc.filter(v => v.origem === 'recusado').map(v => `${v.item_id}|${v.sku_custo}`))
    const semCusto = anuncios.filter(a => !comCusto(a.item_id) && !['closed', 'inactive'].includes(a.status))
      .sort((x, y) => (y.fat30 || 0) - (x.fat30 || 0) || x.item_id.localeCompare(y.item_id))      // por faturamento: também desempata candidatos de mesma semelhança
    const porItem = new Map(semCusto.map(a => [a.item_id, a])), busca = indiceVinculo(semCusto, { tamanhos: true })
    const usados = new Set(anuncios.filter(a => comCusto(a.item_id)).map(a => res.get(a.item_id).chave))
    const doCusto = new Map(), doAnuncio = new Map()
    for (const [k, c] of ef) for (const x of busca(c.sku)) {
      if (recusado.has(`${x.item_id}|${k}`)) continue
      const s = Math.round(100 * x.score), a = porItem.get(x.item_id)
      if (!doCusto.has(k)) doCusto.set(k, [])
      doCusto.get(k).push({ item_id: a.item_id, titulo: a.titulo, thumb: a.thumb, sku: a.sku, catalogo_origem: a.catalogo_origem, semelhanca: s })
      if (!doAnuncio.has(a.item_id)) doAnuncio.set(a.item_id, [])
      doAnuncio.get(a.item_id).push({ sku_custo: c.sku, custo: c.custo, semelhanca: s })
    }
    const custos_sem_anuncio = [...ef].filter(([k]) => !usados.has(k)).map(([k, c]) => ({ sku_custo: c.sku, custo: c.custo, candidatos: (doCusto.get(k) || []).slice(0, MAX_CANDIDATOS) }))
      .sort((x, y) => x.sku_custo.localeCompare(y.sku_custo))
    const anuncios_sem_custo = semCusto.map(a => ({ item_id: a.item_id, titulo: a.titulo, thumb: a.thumb, sku: a.sku, catalogo_origem: a.catalogo_origem,
      fat30: a.fat30 || 0, candidatos: (doAnuncio.get(a.item_id) || []).sort((x, y) => y.semelhanca - x.semelhanca).slice(0, MAX_CANDIDATOS) }))
    const manual = new Map(vinc.filter(v => v.origem === 'manual').map(v => [v.item_id, v]))
    const vinculados = anuncios.filter(a => comCusto(a.item_id)).map(a => { const r = res.get(a.item_id), m = r.origem === 'manual' ? manual.get(a.item_id) : null
      return { item_id: a.item_id, sku_custo: ef.get(r.chave).sku, origem: r.origem, por: m?.por || '', em: m?.em || '' } })
    return { custos_sem_anuncio: custos_sem_anuncio.slice(0, MAX_LISTA), anuncios_sem_custo: anuncios_sem_custo.slice(0, MAX_LISTA), vinculados,
      totais: { custos_sem_anuncio: custos_sem_anuncio.length, anuncios_sem_custo: anuncios_sem_custo.length, vinculados: vinculados.length } }
  }

  return { custosDosAnuncios, custoDoAnuncio, vincular, recusar, desvincular, listarVinculos }
}
