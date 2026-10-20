process.env.PS_PROMO_MEMORIA = '1'                       // ANTES de qualquer import: banco em memória, nunca toca data/db.sqlite
// Regressão da frente DADOS do módulo Promoções (coleta, estado, tetos, chave de oferta, troca de conta, cobertura de vendas, foto da rodada).
// Dados sintéticos, sem rede: todo "chamar" injetado só aceita GET. Rodar: node scripts/teste-promocoes-dados.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const C = await import('../src/lib/promocoes-coleta.js')
const R = await import('../src/lib/promocoes-db.js')
const pausa = () => new Promise(r => setTimeout(r, 5))   // coleta_id/snapshot usam Date.now(): duas coletas do mesmo cliente nunca no mesmo ms

let falhas = 0
const caso = async (nome, fn) => { try { await fn(); console.log('✔', nome) } catch (e) { falhas++; console.log('✘', nome, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')) } }

R.db.exec(`CREATE TABLE meli_serie_item (cliente TEXT, item_id TEXT, dia TEXT, unidades INTEGER DEFAULT 0, receita REAL DEFAULT 0, visitas INTEGER DEFAULT 0);
  CREATE TABLE meli_coleta_dia (cliente TEXT, dia TEXT, pedidos INTEGER, truncado INTEGER, coletado_em TEXT)`)

// ── stub da API do ML (só GET) ───────────────────────────────────────────────────────────────────
const erro = (status, corpo = '') => ({ _erro: true, status, corpo })
const OFERTA_REBATE = id => [{ id: 'P-1', type: 'SMART', ref_id: `CAND-${id}`, status: 'candidate', price: 90, original_price: 100, meli_percentage: 5, seller_percentage: 0 }]
function api(cfg = {}) {
  const chamadas = []
  const f = async (cliente, caminho, opts) => {
    assert.ok(opts?.permitirFalha); assert.ok(!/method|POST|DELETE/i.test(caminho)); chamadas.push(caminho)
    let m
    if ((m = caminho.match(/^\/seller-promotions\/users\/123\?.*offset=(\d+)/))) {
      const off = Number(m[1]), todas = cfg.campanhas || []
      if (cfg.paginaFalha === off) return erro(500, 'boom')
      const results = todas.slice(off, off + 50)
      return cfg.semTotal ? { results } : { results, paging: { total: todas.length } }
    }
    if (/^\/seller-promotions\/promotions\/[^/]+\/items\?/.test(caminho)) return { results: [], paging: { total: 0 } }
    if (/^\/items\/bulk\?ids=/.test(caminho)) {              // formato real do /items/bulk: { id, status_code, body }; erro por item vem sem body
      const ids = caminho.match(/ids=([^&]+)/)[1].split(',')
      if (cfg.multigetFalha?.(ids)) return erro(429, 'rate limit')
      return ids.map(id => cfg.detalheCode?.(id) ? { id, status_code: cfg.detalheCode(id) } : ({ id, status_code: 200, body: { id, title: `Item ${id}`, price: 100, original_price: 120, status: 'active', category_id: 'MLB1', listing_type_id: 'gold_special',
        available_quantity: 5, attributes: [{ id: 'SELLER_SKU', value_name: `SKU-${id}` }], seller_custom_field: '', variations: [], user_product_id: '', ...(cfg.item?.(id) || {}) } }))
    }
    if ((m = caminho.match(/^\/seller-promotions\/items\/(MLB\d+)\?app_version=v2$/))) {
      if (cfg.ofertasFalha?.(m[1])) return erro(500, 'boom')
      if (cfg.ofertasUnderReview?.(m[1])) return erro(400, '{"message":"Item status is not allowed (under_review)"}')
      return cfg.ofertas ? cfg.ofertas(m[1]) : OFERTA_REBATE(m[1])
    }
    if (/^\/sites\/MLB\/listing_prices/.test(caminho)) return [{ sale_fee_details: { percentage_fee: 16, fixed_fee: 6 } }]
    if (/^\/users\/123\/shipping_options\/free/.test(caminho)) return { coverage: { all_country: { list_cost: 12 } } }
    if ((m = caminho.match(/^\/user-products\/(.+)$/))) return cfg.userProductsFalha ? erro(500, 'boom') : { attributes: [{ id: 'SELLER_SKU', values: [{ name: `U${m[1]}` }] }] }
    return erro(404, `rota não prevista: ${caminho}`)
  }
  f.chamadas = chamadas
  return f
}
const coletar = (cli, cfg = {}, extras = [], opts = {}) => C.coletarPromocoes(cli, { ...opts, deps: { chamar: api(cfg), uid: 123, espera: 0, itensExtras: extras } })
const ids = (n, base = 1000) => Array.from({ length: n }, (_, i) => `MLB${base + i}`)
const vendas = (cli, item_id, receita, dia = R.hojeLocal()) => R.db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)').run(cli, item_id, dia, 1, receita)

// ── 12 · estado da coleta: falha das leituras essenciais nunca vira 'concluida' fresca ───────────────
await caso('idx12: falha total das ofertas = ERRO (nada gravado por cima); falha parcial = PARCIAL, nunca fresca', async () => {
  const cli = 'D12', itens = ['MLB11', 'MLB12']
  const r1 = await coletar(cli, {}, itens)
  assert.equal(r1.estado, 'concluida'); assert.equal(r1.leituras_falhas, 0); assert.equal(R.lerColeta(cli).estado, 'concluida'); assert.equal(R.coletaFresca(cli).fresca, true)
  await pausa()
  await assert.rejects(coletar(cli, { ofertasFalha: () => true }, itens), /nenhuma leitura de ofertas completou/)
  const c = R.lerColeta(cli)
  assert.equal(c.estado, 'erro'); assert.equal(R.coletaFresca(cli).fresca, false)
  assert.ok(c.limites.some(l => l.codigo === 'OFERTAS_SEM_LEITURA'), 'o motivo fica persistido')
  assert.equal(R.lerOfertas(cli).length, 2, 'ofertas anteriores intactas')
  await pausa()
  const r3 = await coletar(cli, { ofertasFalha: id => id === 'MLB12' }, itens)
  assert.equal(r3.estado, 'parcial'); assert.equal(r3.leituras_falhas, 1)
  assert.equal(R.lerColeta(cli).estado, 'parcial'); assert.equal(R.coletaFresca(cli).fresca, false); assert.match(R.coletaFresca(cli).motivo, /PARCIAL/)
  assert.equal(R.lerColeta(cli).resumo.leituras_falhas, 1)
})
await caso('idx12: página da listagem que falha = PARCIAL e NÃO apaga as campanhas das páginas perdidas', async () => {
  const cli = 'D12b', camps = Array.from({ length: 120 }, (_, i) => ({ id: `P-${i}`, type: 'DEAL', status: 'started', name: `C${i}` }))
  const r1 = await coletar(cli, { campanhas: camps }); assert.equal(r1.estado, 'concluida'); assert.equal(R.lerCampanhas(cli).length, 120)
  await pausa()
  const r2 = await coletar(cli, { campanhas: camps, paginaFalha: 50 })
  assert.equal(r2.estado, 'parcial'); assert.ok(r2.limites.some(l => l.codigo === 'LISTAGEM_PAGINA'))
  assert.equal(R.coletaFresca(cli).fresca, false); assert.equal(R.lerCampanhas(cli).length, 120, 'lista incompleta não apaga o que não viu')
})

// ── 13 · multiget que falha não sobrescreve anúncio já coletado ──────────────────────────────────────
await caso('idx13: bloco do multiget falho mantém SKU/status/categoria/preço anteriores e marca PARCIAL', async () => {
  const cli = 'D13'
  await coletar(cli, { item: id => ({ status: 'paused' }) }, ['MLB21'])
  const antes = R.lerAnuncios(cli).find(a => a.item_id === 'MLB21'); assert.equal(antes.status, 'paused'); assert.equal(antes.sku, 'SKU-MLB21'); assert.equal(antes.preco, 100)
  await pausa()
  const r = await coletar(cli, { multigetFalha: () => true }, ['MLB21', 'MLB22'])
  assert.equal(r.estado, 'parcial'); assert.ok(r.limites.some(l => l.codigo === 'DETALHE_ANUNCIOS'))
  const depois = R.lerAnuncios(cli).find(a => a.item_id === 'MLB21')
  assert.equal(depois.status, 'paused', 'a trava de pausado não some'); assert.equal(depois.sku, 'SKU-MLB21'); assert.equal(depois.categoria, 'MLB1'); assert.equal(depois.preco, 100); assert.equal(depois.titulo, 'Item MLB21')
  assert.match(depois.oferta_erro, /sem detalhes/, 'fica marcado como sem leitura (cobertura desconhecida), não como anúncio vazio')
  assert.equal(R.lerAnuncios(cli).some(a => a.item_id === 'MLB22'), false, 'anúncio nunca lido não entra com status desconhecido (fail-closed)')
  assert.ok(!R.lerOfertas(cli).some(o => o.item_id === 'MLB22'))
})
await caso('idx13: item que o multiget devolve com code transitório (429/5xx) também é "sem detalhe" (não grava vazio) e a coleta fica PARCIAL', async () => {
  const cli = 'D13b'
  await coletar(cli, {}, ['MLB31', 'MLB32']); await pausa()
  const r = await coletar(cli, { detalheCode: id => (id === 'MLB31' ? 503 : 0) }, ['MLB31', 'MLB32'])
  assert.equal(r.estado, 'parcial'); assert.equal(R.lerAnuncios(cli).find(a => a.item_id === 'MLB31').sku, 'SKU-MLB31')
})

// ── rev2 #2 · erro permanente por item no multiget ───────────────────────────────────────────────────
await caso('rev2 #2: item que passa a dar 404/403 no multiget vira "sem leitura" DECLARADA: coleta CONCLUÍDA, dado velho marcado, ofertas descartadas, sem GET de ofertas dele', async () => {
  const cli = 'D2R', lista = ['MLB6001', 'MLB6002', 'MLB6003']
  const r1 = await coletar(cli, {}, lista); assert.equal(r1.estado, 'concluida'); assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB6002').length, 1)
  for (const code of [404, 403]) {
    await pausa()
    const f = api({ detalheCode: id => (id === 'MLB6002' ? code : 0) })
    const r = await C.coletarPromocoes(cli, { deps: { chamar: f, uid: 123, espera: 0, itensExtras: lista } })
    assert.equal(r.estado, 'concluida', `HTTP ${code} por item NÃO trava a coleta para sempre`); assert.equal(r.leituras_falhas, 0)
    assert.equal(R.lerColeta(cli).estado, 'concluida'); assert.equal(R.coletaFresca(cli).fresca, true, 'o analista volta a aplicar')
    assert.equal(r.anuncios_sem_leitura, 1); assert.equal(r.anuncios_lidos, 2)
    const lim = r.limites.find(l => l.codigo === 'ANUNCIOS_SEM_LEITURA'); assert.ok(lim, 'o limite é declarado'); assert.deepEqual(lim.ids, ['MLB6002']); assert.match(lim.texto, /MLB6002/); assert.match(lim.texto, new RegExp(`HTTP ${code}`))
    assert.ok(!r.limites.some(l => l.codigo === 'DETALHE_ANUNCIOS'), 'não é falha transitória')
    assert.ok(!f.chamadas.some(c => /seller-promotions\/items\/MLB6002/.test(c)), 'não lê ofertas de quem o ML não entrega')
    const a = R.lerAnuncios(cli).find(x => x.item_id === 'MLB6002')
    assert.equal(a.sku, 'SKU-MLB6002', 'último dado mantido'); assert.match(a.oferta_erro, /sem leitura \(HTTP/); assert.match(a.oferta_erro, /VELHO/)
    assert.ok(!R.lerOfertas(cli).some(o => o.item_id === 'MLB6002'), 'nada de oferta congelada contando como participando/elegível')
    assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB6001').length, 1, 'os outros itens seguem lidos')
  }
})
await caso('rev2 #2: 429/5xx/401 por item continuam PARCIAL; nada lido por 4xx = ERRO (token/permissão, não é por item); bloco inteiro 4xx não vira "por item"', async () => {
  const cli = 'D2Rb', lista = ['MLB6101', 'MLB6102']
  await coletar(cli, {}, lista)
  for (const code of [429, 503, 401, 408]) { await pausa(); const r = await coletar(cli, { detalheCode: id => (id === 'MLB6102' ? code : 0) }, lista); assert.equal(r.estado, 'parcial', `HTTP ${code} é transitório`); assert.ok(r.limites.some(l => l.codigo === 'DETALHE_ANUNCIOS')) }
  await pausa()
  await assert.rejects(coletar(cli, { detalheCode: () => 403 }, lista), /nenhum anúncio pôde ser lido/)
  assert.equal(R.lerColeta(cli).estado, 'erro'); assert.equal(R.coletaFresca(cli).fresca, false); assert.equal(R.lerOfertas(cli).length, 2, 'dados anteriores intactos')
  await pausa()
  const r = await coletar(cli, { multigetFalha: () => true }, lista); assert.equal(r.estado, 'parcial')       // 429 do bloco todo: continua PARCIAL
  assert.equal(C.ehErroPermanente(404), true); assert.equal(C.ehErroPermanente(410), true); assert.equal(C.ehErroPermanente(400), true)
  for (const c of [401, 408, 425, 429, 500, 503, 0, undefined, null, 200]) assert.equal(C.ehErroPermanente(c), false, `${c}`)
})

// ── rev2 #18 · oferta congelada de anúncio closed/inactive/under_review/sem leitura ──────────────────
await caso('rev2 #18: anúncio que virou closed some das ofertas (não fica participando/elegível); a derrubada vira "saiu da coleta"; falha TRANSITÓRIA mantém a leitura anterior', async () => {
  const cli = 'D18R', lista = ['MLB7001', 'MLB7002']
  const ofs = [{ id: 'P-1', type: 'SMART', ref_id: 'S', status: 'started', price: 90, original_price: 100, meli_percentage: 5, finish_date: '2030-01-01T03:00:00Z' },
    { id: 'P-2', type: 'SMART', ref_id: 'C', status: 'candidate', price: 80, original_price: 100, meli_percentage: 8 }]
  const camps = [{ id: 'P-1', type: 'SMART', status: 'started', name: 'N1' }]
  const c1 = await coletar(cli, { campanhas: camps, ofertas: () => ofs }, lista); assert.equal(c1.estado, 'concluida'); assert.equal(R.lerOfertas(cli).length, 4)
  await pausa()
  const c2 = await coletar(cli, { campanhas: camps, ofertas: () => ofs, item: id => (id === 'MLB7001' ? { status: 'closed' } : {}) }, lista)
  assert.equal(c2.estado, 'concluida')
  assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB7001').length, 0, 'closed: as ofertas congeladas saem')
  assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB7002').length, 2); assert.equal(R.lerAnuncios(cli).find(a => a.item_id === 'MLB7001').status, 'closed')
  assert.equal(c2.derrubadas.derrubadas, 0, 'fechar o anúncio NÃO é campanha derrubada'); assert.equal(c2.derrubadas.saiu_da_coleta, 1, 'a foto da rodada segue coerente: "saiu da coleta"')
  await pausa()
  const c3 = await coletar(cli, { campanhas: camps, ofertas: () => ofs, ofertasFalha: id => id === 'MLB7002' }, lista)
  assert.equal(c3.estado, 'parcial'); assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB7002').length, 2, 'falha transitória: leitura anterior mantida e declarada (parcial)')
  await pausa()
  const c4 = await coletar(cli, { campanhas: camps, ofertas: () => ofs, ofertasUnderReview: id => id === 'MLB7002' }, lista)
  assert.equal(c4.under_review, 1); assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB7002').length, 0, 'under_review não mantém started/candidate congeladas')
})

// ── 14/25 · teto de tarifa/frete ─────────────────────────────────────────────────────────────────────
await caso('idx14/25: 90 anúncios com custo e rebate => TODOS com tarifa (o teto antigo de 80 cortava)', async () => {
  const cli = 'D14', lista = ids(90)
  R.importarCustosSku(cli, lista.map(id => ({ sku: `SKU-${id}`, custo: 40 })), 'teste', 'teste')
  const r = await coletar(cli, {}, lista)
  assert.equal(r.tarifas_coletadas, 90); assert.equal(r.tarifas_nao_coletadas, 0)
  assert.ok(R.lerAnuncios(cli).every(a => a.tarifa_estado === 'ok' && a.tarifa?.comissao_pct === 16))
})
await caso('idx14/25: acima do teto — maior faturamento primeiro, o resto "tarifa NÃO COLETADA" declarada, tarifa recente reaproveitada', async () => {
  const cli = 'D25', lista = ids(6, 2000)
  R.importarCustosSku(cli, lista.map(id => ({ sku: `SKU-${id}`, custo: 40 })), 'teste', 'teste')
  lista.forEach((id, i) => vendas(cli, id, 100 * (i + 1)))          // MLB2005 fatura mais, MLB2000 menos
  const r = await coletar(cli, {}, lista, { maxTarifas: 2 })
  assert.equal(r.tarifas_coletadas, 2); assert.equal(r.tarifas_nao_coletadas, 4)
  const lim = r.limites.find(l => l.codigo === 'TARIFA_NAO_COLETADA'); assert.ok(lim, 'o corte é declarado com código estável'); assert.match(lim.texto, /NÃO COLETADA/); assert.match(lim.texto, /não é falta de custo/)
  const por = Object.fromEntries(R.lerAnuncios(cli).map(a => [a.item_id, a.tarifa_estado]))
  assert.deepEqual(por, { MLB2005: 'ok', MLB2004: 'ok', MLB2003: 'NAO_COLETADA', MLB2002: 'NAO_COLETADA', MLB2001: 'NAO_COLETADA', MLB2000: 'NAO_COLETADA' }, 'fora do teto NUNCA vira estado vazio/"SEM CUSTO"')
  assert.deepEqual(R.lerColeta(cli).limites.map(l => l.codigo).includes('TARIFA_NAO_COLETADA'), true, 'persistido em limites_json')
  await pausa()
  const r2 = await coletar(cli, {}, lista, { maxTarifas: 1 })           // MLB2004 sai do teto, mas a tarifa medida há segundos continua valendo
  assert.equal(r2.tarifas_coletadas, 1)
  const por2 = Object.fromEntries(R.lerAnuncios(cli).map(a => [a.item_id, a.tarifa_estado]))
  assert.equal(por2.MLB2005, 'ok'); assert.equal(por2.MLB2004, 'ok', 'tarifa recente preservada, não zerada'); assert.equal(por2.MLB2003, 'NAO_COLETADA')
})
await caso('idx14: anúncio com a leitura de ofertas falha mantém a tarifa anterior (não é regravada em branco)', async () => {
  const cli = 'D14b', lista = ids(2, 2100)
  R.importarCustosSku(cli, lista.map(id => ({ sku: `SKU-${id}`, custo: 40 })), 'teste', 'teste')
  await coletar(cli, {}, lista); await pausa()
  await coletar(cli, { ofertasFalha: id => id === 'MLB2100' }, lista)
  assert.equal(R.lerAnuncios(cli).find(a => a.item_id === 'MLB2100').tarifa_estado, 'ok')
})

// ── 40 · teto de user-products ───────────────────────────────────────────────────────────────────────
const SEM_SKU = id => ({ attributes: [], seller_custom_field: '', user_product_id: `UP-${id}` })
await caso('idx40: 130 anúncios sem SKU => todos resolvidos via user-products (o teto antigo de 60 deixava vazio)', async () => {
  const cli = 'D40', lista = ids(130, 3000)
  const r = await coletar(cli, { item: SEM_SKU }, lista)
  assert.equal(R.lerAnuncios(cli).filter(a => !a.sku).length, 0); assert.ok(!r.limites.some(l => l.codigo === 'SKU_USER_PRODUCTS_TRUNCADO'))
  assert.equal(R.lerAnuncios(cli).find(a => a.item_id === 'MLB3000').sku_fonte, 'user-products')
  await pausa()
  const r2 = await coletar(cli, { item: SEM_SKU, userProductsFalha: true }, lista)       // user-products fora do ar: o SKU já resolvido NÃO é regravado como ''
  assert.equal(R.lerAnuncios(cli).filter(a => !a.sku).length, 0); assert.ok(r2.limites.some(l => l.codigo === 'SKU_USER_PRODUCTS_FALHA'))
})
await caso('idx40: acima do teto — maior faturamento primeiro e corte declarado', async () => {
  const cli = 'D40b', lista = ids(6, 3200)
  lista.forEach((id, i) => vendas(cli, id, 10 * (i + 1)))
  const r = await coletar(cli, { item: SEM_SKU }, lista, { maxUserProducts: 3 })
  const lim = r.limites.find(l => l.codigo === 'SKU_USER_PRODUCTS_TRUNCADO'); assert.ok(lim); assert.match(lim.texto, /3 anúncio\(s\)/); assert.match(lim.texto, /SKU NÃO RESOLVIDO/)
  assert.deepEqual(R.lerAnuncios(cli).filter(a => a.sku).map(a => a.item_id).sort(), ['MLB3203', 'MLB3204', 'MLB3205'])
})

// ── 41 · listagem de campanhas ───────────────────────────────────────────────────────────────────────
await caso('idx41: mais de 500 campanhas são todas lidas; sem paging.total pagina até a página incompleta', async () => {
  const camps = n => Array.from({ length: n }, (_, i) => ({ id: `P-${i}`, type: 'DEAL', status: 'started', name: `C${i}` }))
  const r = await coletar('D41', { campanhas: camps(700) }); assert.equal(r.campanhas, 700); assert.equal(r.estado, 'concluida')
  const r2 = await coletar('D41b', { campanhas: camps(120), semTotal: true }); assert.equal(r2.campanhas, 120, 'sem paging.total não assume que a 1ª página era tudo')
})

// ── 18 · ofertas sem id/ref_id ───────────────────────────────────────────────────────────────────────
await caso('idx18: duas ofertas do mesmo tipo sem id/ref_id não colidem; a started nunca é apagada', async () => {
  const cli = 'D18'
  const sem = [{ type: 'PRICE_DISCOUNT', status: 'started', price: 80, original_price: 100, finish_date: '2030-02-01T00:00:00Z' }, { type: 'PRICE_DISCOUNT', status: 'candidate', price: 70, original_price: 100 }]
  const r = await coletar(cli, { ofertas: () => sem }, ['MLB41'])
  assert.equal(r.ofertas, 2)
  const of = R.lerOfertas(cli); assert.equal(of.length, 2, 'as duas ficam (antes: 1 — a started sumia)')
  const started = of.find(o => o.status === 'started'); assert.equal(started.preco, 80); assert.equal(started.fim, '2030-02-01T00:00:00Z')
  assert.equal(started.offer_id, '', 'offer_id exposto continua o do ML ("" = sem id; o plano pula por sem_offer_id)'); assert.match(started.chave, /^SEM-REF:/); assert.notEqual(of[0].chave, of[1].chave)
  const smart = await coletar('D18b', { ofertas: () => [{ type: 'SMART', status: 'candidate', price: 90, original_price: 100, meli_percentage: 3 }, { type: 'SMART', status: 'candidate', price: 85, original_price: 100, meli_percentage: 6 }] }, ['MLB42'])
  assert.equal(smart.ofertas, 2); assert.equal(R.lerOfertas('D18b').length, 2, 'duas campanhas SMART sem id também não dividem a mesma chave')
})
await caso('idx18: colisão residual (mesmo pid+offer_id) preserva a participação ativa, qualquer que seja a ordem', async () => {
  const cli = 'D18c', id = 'D18C'
  R.iniciarColeta(cli, id)
  const o = (status, preco) => ({ pid: 'P', offer_id: 'OFF-1', tipo: 'SMART', subtipo: '', nome: '', status, preco, preco_original: 100, meli_pct: 5, seller_pct: 0, inicio: '', fim: '', min_preco: null, max_preco: null, sugerido: null })
  R.gravarColeta(cli, { coletaId: id, campanhas: [], anuncios: [{ item_id: 'MLB43', sku: 'S', sku_fonte: '', titulo: '', permalink: '', status: 'active', sub_status: '', under_review: 0, preco: 100, preco_original: 100, estoque: 1, categoria: 'MLB1', tipo_anuncio: 'gold_special', catalogo: 0, user_product_id: '', tarifa_json: '', tarifa_estado: '', oferta_erro: '' }],
    ofertasPorItem: new Map([['MLB43', [o('candidate', 70), o('started', 80)]]]), resumo: {}, limites: [] })
  const of = R.lerOfertas(cli); assert.equal(of.length, 1); assert.equal(of[0].status, 'started')
})

// ── 44 · cobertura da janela de 30 dias ──────────────────────────────────────────────────────────────
await caso('idx44: faturamento30 devolve cobertura (dias com dado, truncados, lacunas)', async () => {
  const cli = 'D44', hoje = R.hojeLocal()
  const dia = n => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
  for (let n = 0; n < 5; n++) R.db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,?,?,?)').run(cli, dia(n), 3, n === 2 ? 1 : 0, '2026-10-01')
  R.db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,?,?,?)').run(cli, dia(60), 3, 1, '2026-08-01')   // fora da janela: não conta
  vendas(cli, 'MLB44', 1000, dia(1))
  const f = R.faturamento30(cli, hoje)
  assert.deepEqual(f.cobertura, { janela_dias: 30, dias_com_dado: 5, dias_truncados: 1, lacunas: 25, completa: false })
  assert.equal(f.disponivel, true); assert.equal(f.porItem.get('MLB44').fat, 1000)
  for (let n = 5; n < 30; n++) R.db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,?,?,?)').run(cli, dia(n), 1, 0, '2026-10-01')
  assert.equal(R.faturamento30(cli, hoje).cobertura.completa, false, 'dia truncado na janela = incompleta'); R.db.prepare('UPDATE meli_coleta_dia SET truncado = 0 WHERE cliente = ?').run(cli)
  assert.deepEqual(R.faturamento30(cli, hoje).cobertura, { janela_dias: 30, dias_com_dado: 30, dias_truncados: 0, lacunas: 0, completa: true })
})

// ── 46 · foto da rodada ──────────────────────────────────────────────────────────────────────────────
await caso('idx46: SMART sem data própria que some NÃO é "derrubada antes do prazo"; a foto guarda o fim da participação', async () => {
  const cli = 'D46', camp = { id: 'SMT-1', type: 'SMART', name: 'Impulsione', status: 'started', finish_date: '2030-01-01T03:00:00Z' }
  const comSmart = [{ id: 'SMT-1', type: 'SMART', ref_id: 'OFFER-1', status: 'started', price: 80, original_price: 100, meli_percentage: 5 }]    // sem finish_date próprio
  await coletar(cli, { campanhas: [camp], ofertas: () => comSmart }, ['MLB46'])
  const foto = R.ultimoSnapshot(cli).participacoes[0]
  assert.equal(foto.fim, '', 'fim da PARTICIPAÇÃO (a oferta não trouxe)'); assert.equal(foto.fim_campanha, '2030-01-01T03:00:00Z')
  await pausa()
  const r2 = await coletar(cli, { campanhas: [camp], ofertas: () => [] }, ['MLB46'])
  assert.equal(r2.derrubadas.derrubadas, 0, 'sem alarme falso de campanha derrubada'); assert.equal(r2.derrubadas.sem_prazo, 1)
  await pausa()
  // com fim PRÓPRIO da oferta no futuro, sumir continua sendo derrubada de verdade
  await coletar(cli, { campanhas: [camp], ofertas: () => comSmart.map(o => ({ ...o, finish_date: '2030-01-01T03:00:00Z' })) }, ['MLB46']); await pausa()
  const r4 = await coletar(cli, { campanhas: [camp], ofertas: () => [] }, ['MLB46'])
  assert.equal(r4.derrubadas.derrubadas, 1)
})

// ── 15 · troca/desconexão de conta ───────────────────────────────────────────────────────────────────
await caso('idx15: limparPromocoesDoCliente apaga o derivado da conta antiga e preserva o que é do dono', async () => {
  const cli = 'D15', outro = 'D15-outro'
  for (const c of [cli, outro]) {
    await coletar(c, {}, ['MLB51'], {}); await pausa()
    R.importarCustosSku(c, [{ sku: 'SKU-MLB51', custo: 30 }], 'teste', 'dono'); R.salvarRegraSku(c, { sku: 'X', status: 'Livre' }, 'dono')
    R.registrarAprendizado(c, { padrao: 'p', escopo_tipo: 'sku', escopo_valor: 'X', resposta: 'ok', acao: 'nota' }, 'dono')
    R.setConfig(c, { piso_mc: 25, execucao_habilitada: 1 }, 'dono')
    R.marcarHumano(c, { item_id: 'MLB51', pid: 'P-1', marcado: 1 }, 'dono')
    R.substituirAlertas(c, 'cobertura', [{ chave: 'MLB51', item_id: 'MLB51' }], 'r1')
    R.salvarPlano({ id: `${c}-1`, cliente: c, criado_em: '2026-10-01T00:00:00Z', expira_em: '2026-10-02T00:00:00Z', hash: 'h', itens: [], resumo: {} })
  }
  const antes = R.lerAnuncios(cli).length; assert.ok(antes > 0)
  const apagados = R.limparPromocoesDoCliente(cli, 'teste de troca')
  for (const t of R.TABELAS_DERIVADAS) assert.equal(R.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE cliente = ?`).get(cli).n, 0, `${t} limpa`)
  assert.ok(apagados.promo_anuncio >= 1 && apagados.promo_decisao >= 1 && apagados.promo_plano === 1 && apagados.promo_alerta === 1)
  assert.equal(R.listarCustosSku(cli).length, 1); assert.equal(R.listarRegrasSku(cli).length, 1); assert.equal(R.listarAprendizados(cli).length, 1)
  assert.equal(R.getConfig(cli).piso_mc, 25, 'config do dono preservada'); assert.equal(R.getConfig(cli).execucao_habilitada, 0, 'execução volta a DESLIGADA: a conta nova nunca foi revisada')
  const aud = R.listarAuditoria(cli, { evento: 'conta_trocada' }); assert.equal(aud.length, 1); assert.match(aud[0].detalhe, /teste de troca/)
  assert.ok(R.listarAuditoria(cli, { evento: 'coleta' }).length >= 1, 'auditoria anterior preservada')
  assert.equal(R.lerAnuncios(outro).length, antes, 'outro cliente intocado'); assert.equal(R.getConfig(outro).execucao_habilitada, 1); assert.equal(R.lerDecisoes(outro).length, 1)
  assert.equal(R.lerColeta(cli), null)
})
await caso('idx15: meli-contas.js chama a limpeza nas DUAS saídas (troca para outra conta e desconexão) sem deixar um erro dela impedir a troca', async () => {
  const src = readFileSync(new URL('../src/lib/meli-contas.js', import.meta.url), 'utf8')       // importar meli-contas abriria data/db.sqlite: checa o fonte
  assert.match(src, /import \{ limparPromocoesDoCliente \} from '\.\/promocoes-db\.js'/)
  assert.match(src, /try \{ limparPromocoesDoCliente\([^)]*\) \} catch/)
  assert.match(src, /anterior && String\(anterior\) !== String\(tokenResp\.user_id\)\) \{[\s\S]*?limparSerieDoCliente\(cliente, `conta ML trocada/)   // agora a troca também arquiva a conexão antiga e avisa, mas a limpeza segue lá
  assert.match(src, /desconectar[\s\S]*limparSerieDoCliente\(cliente/)
})

// ── contrato: gravarColeta só grava 'concluida' quando o chamador diz que tudo foi lido ───────────────
await caso('contrato (a): gravarColeta grava estado válido (concluida | parcial); valor desconhecido = parcial', async () => {
  const cli = 'DCT'
  R.iniciarColeta(cli, 'X1'); R.gravarColeta(cli, { coletaId: 'X1', campanhas: [], anuncios: [], ofertasPorItem: new Map(), resumo: {}, limites: [] }); assert.equal(R.lerColeta(cli).estado, 'concluida')
  R.iniciarColeta(cli, 'X2'); R.gravarColeta(cli, { coletaId: 'X2', campanhas: [], anuncios: [], ofertasPorItem: new Map(), resumo: {}, limites: [], estado: 'qualquer-coisa' }); assert.equal(R.lerColeta(cli).estado, 'parcial'); assert.equal(R.coletaFresca(cli).fresca, false)
})

// ── rev3 #2 · erro PERMANENTE no GET de ofertas do anúncio (ex.: pausado => 400) ─────────────────────
const comOfertasErro = (cfg, alvo, code) => { const base = api(cfg); return async (c, caminho, o) => { const id = caminho.match(/^\/seller-promotions\/items\/(MLB\d+)\?/)?.[1]; return id && alvo(id) ? erro(code, 'NOT_AVAILABLE') : base(c, caminho, o) } }
await caso('rev3 #2: 400/403/404/410 nas ofertas de UM anúncio = "sem leitura" DECLARADA (ids no limite), coleta CONCLUÍDA e fresca; 5xx segue PARCIAL; todos falhando = ERRO', async () => {
  const cli = 'D3R2', lista = ['MLB8001', 'MLB8002', 'MLB8003']
  await coletar(cli, {}, lista); assert.equal(R.lerOfertas(cli).filter(o => o.item_id === 'MLB8002').length, 1)
  for (const code of [400, 403, 404, 410]) {
    await pausa()
    const r = await C.coletarPromocoes(cli, { deps: { chamar: comOfertasErro({}, id => id === 'MLB8002', code), uid: 123, espera: 0, itensExtras: lista } })
    assert.equal(r.estado, 'concluida', `HTTP ${code} nas ofertas de um anúncio NÃO deixa a coleta parcial para sempre`); assert.equal(r.leituras_falhas, 0)
    assert.equal(R.coletaFresca(cli).fresca, true, 'o analista volta a aplicar'); assert.equal(r.anuncios_sem_leitura, 1); assert.equal(r.anuncios_lidos, 2)
    const lim = r.limites.find(l => l.codigo === 'OFERTAS_INDISPONIVEIS'); assert.ok(lim, 'declarado'); assert.deepEqual(lim.ids, ['MLB8002']); assert.match(lim.texto, new RegExp(`\\(${code}\\)`))
    assert.ok(!r.limites.some(l => l.codigo === 'OFERTAS_SEM_LEITURA'), 'não é falha transitória')
    assert.ok(!R.lerOfertas(cli).some(o => o.item_id === 'MLB8002'), 'ofertas descartadas (nada congelado contando como elegível/participando)')
    assert.match(R.lerAnuncios(cli).find(a => a.item_id === 'MLB8002').oferta_erro, /ofertas sem leitura/, 'cobertura DESCONHECIDA marcada no anúncio')
  }
  await pausa()
  const r5 = await C.coletarPromocoes(cli, { deps: { chamar: comOfertasErro({}, id => id === 'MLB8002', 503), uid: 123, espera: 0, itensExtras: lista } })
  assert.equal(r5.estado, 'parcial', '5xx é transitório')
  await pausa()
  await assert.rejects(C.coletarPromocoes(cli, { deps: { chamar: comOfertasErro({}, () => true, 403), uid: 123, espera: 0, itensExtras: lista } }), /nenhuma leitura de ofertas completou/, 'nada lido não é "por anúncio" (token/permissão)')
})

// ── rev3 #3 · escritas longas só gravam se ainda forem donas do estado ────────────────────────────────
const tabelas = cli => Object.fromEntries(R.TABELAS_DERIVADAS.map(t => [t, R.db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE cliente = ?`).get(cli).n]))
await caso('rev3 #3: troca de conta NO MEIO da coleta (limpeza) => coleta descartada, nada da conta antiga é regravado', async () => {
  const cli = 'D3R3a', lista = ['MLB8101', 'MLB8102']
  await coletar(cli, {}, lista); await pausa()
  const base = api({}); let uidAtual = 123, trocou = false
  const f = async (c, caminho, o) => { if (!trocou && /^\/seller-promotions\/items\//.test(caminho)) { trocou = true; R.limparPromocoesDoCliente(cli, 'conta ML trocada: 123 → 456'); uidAtual = 456 } return base(c, caminho, o) }
  await assert.rejects(C.coletarPromocoes(cli, { deps: { chamar: f, get uid() { return uidAtual }, espera: 0, itensExtras: lista } }), e => e.status === 409 && /coleta descartada/.test(e.message))
  assert.deepEqual(Object.values(tabelas(cli)), R.TABELAS_DERIVADAS.map(() => 0), 'nenhuma linha da conta antiga volta depois da limpeza')
  assert.equal(R.listarAuditoria(cli, { evento: 'coleta_descartada' }).length, 1); assert.equal(R.listarAuditoria(cli, { evento: 'coleta_erro' }).length, 0)
})
await caso('rev3 #3: conta muda sem a limpeza ter rodado => descartada pela conta relida antes de gravar (carimbo vira erro, dados anteriores intactos)', async () => {
  const cli = 'D3R3b'
  await coletar(cli, {}, ['MLB8201']); await pausa()
  let uidAtual = 123; const base = api({})
  const f = async (c, caminho, o) => { if (/^\/seller-promotions\/items\//.test(caminho)) uidAtual = 789; return base(c, caminho, o) }
  await assert.rejects(C.coletarPromocoes(cli, { deps: { chamar: f, get uid() { return uidAtual }, espera: 0, itensExtras: ['MLB8201', 'MLB8299'] } }), /conta do Mercado Livre deste cliente mudou/)
  assert.ok(!R.lerAnuncios(cli).some(a => a.item_id === 'MLB8299'), 'nada desta coleta foi gravado'); assert.equal(R.lerColeta(cli).estado, 'erro'); assert.equal(R.coletaFresca(cli).fresca, false)
})
await caso('rev3 #3: duas coletas sobrepostas do mesmo cliente — a mais nova vale, a anterior é descartada sem misturar', async () => {
  const cli = 'D3R3c', lista = ['MLB8301', 'MLB8302']
  let solta, chegou; const portao = new Promise(r => { solta = r }), noPortao = new Promise(r => { chegou = r })
  const baseA = api({ ofertas: id => OFERTA_REBATE(id).map(o => ({ ...o, price: 77 })) })
  const fA = async (c, caminho, o) => { if (/^\/seller-promotions\/items\//.test(caminho)) { chegou(); await portao } return baseA(c, caminho, o) }
  const pA = C.coletarPromocoes(cli, { deps: { chamar: fA, uid: 123, espera: 0, itensExtras: lista } }); pA.catch(() => {})
  await noPortao
  const rB = await coletar(cli, {}, lista); assert.equal(rB.estado, 'concluida')
  solta()
  await assert.rejects(pA, /outra coleta deste cliente começou depois/)
  const c = R.lerColeta(cli); assert.equal(c.coleta_id, rB.coleta_id); assert.equal(c.estado, 'concluida')
  assert.ok(R.lerOfertas(cli).every(o => o.preco === 90), 'só as linhas da coleta corrente (B)'); assert.equal(R.listarAuditoria(cli, { evento: 'coleta_descartada' }).length, 1)
  assert.equal(R.lerColeta(cli).meli_user_id, '123', 'o carimbo guarda a conta ML')
})
await caso('rev3 #3: gerarPlano — troca de conta durante a geração => plano NÃO é gravado (409 + auditoria); sem troca, grava', async () => {
  const PL = await import('../src/lib/promocoes-plano.js')
  for (const trocar of [true, false]) {
    const cli = `D3R3d-${trocar}`
    await coletar(cli, {}, ['MLB8401']); await pausa()
    R.marcarHumano(cli, { item_id: 'MLB8401', pid: 'P-1', marcado: 1, offer_id: 'CAND-MLB8401', preco: 90 }, 'dono')
    const base = api({})
    const f = async (c, caminho, o) => { if (trocar && /^\/seller-promotions\/items\//.test(caminho)) R.limparPromocoesDoCliente(cli, 'conta ML trocada'); return base(c, caminho, o) }
    const p = PL.gerarPlano(cli, { por: 'dono', deps: { chamar: f, espera: 0 } })
    if (trocar) {
      await assert.rejects(p, e => e.status === 409 && /plano descartado/.test(e.message))
      assert.equal(R.db.prepare('SELECT COUNT(*) n FROM promo_plano WHERE cliente = ?').get(cli).n, 0); assert.equal(R.listarAuditoria(cli, { evento: 'plano_descartado' }).length, 1)
    } else { await p; assert.equal(R.db.prepare('SELECT COUNT(*) n FROM promo_plano WHERE cliente = ?').get(cli).n, 1) }
  }
})

// ── rev3 #5 · desativar aprendizado "regra por SKU" desfaz a regra que ELE criou ─────────────────────
await caso('rev3 #5: desativar regra_sku remove a regra dele (ou volta a anterior); regra feita/editada à mão fica', async () => {
  const cli = 'D3R5', regras = () => Object.fromEntries(R.listarRegrasSku(cli).map(r => [r.sku, r.status]))
  R.salvarRegraSku(cli, { sku: 'MAO', status: '12%', nota: 'manual' }, 'dono')
  const a1 = R.registrarAprendizado(cli, { escopo_tipo: 'sku', escopo_valor: 'X', resposta: 'pode', acao: 'regra_sku', parametro: 'Livre' }, 'dono')
  R.salvarRegraSku(cli, { sku: 'Z', status: 'Revisar toda rodada', nota: 'manual' }, 'dono')
  const a2 = R.registrarAprendizado(cli, { escopo_tipo: 'sku', escopo_valor: 'Z', resposta: 'libera', acao: 'regra_sku', parametro: 'Livre' }, 'dono')
  const a3 = R.registrarAprendizado(cli, { escopo_tipo: 'sku', escopo_valor: 'W', resposta: 'libera', acao: 'regra_sku', parametro: 'Livre' }, 'dono')
  R.salvarRegraSku(cli, { sku: 'W', status: '15%', nota: 'ajustei à mão' }, 'dono')
  assert.deepEqual(regras(), { MAO: '12%', W: '15%', X: 'Livre', Z: 'Livre' })
  assert.match(R.desativarAprendizado(cli, a1, 'dono'), /removida/)
  assert.deepEqual(regras(), { MAO: '12%', W: '15%', Z: 'Livre' }, '"Livre" do aprendizado desativado não continua liberando MC negativa')
  assert.match(R.desativarAprendizado(cli, a2, 'dono'), /voltou a anterior/)
  assert.equal(regras().Z, 'Revisar toda rodada', 'a regra que o aprendizado sobrescreveu volta (não fica mais frouxa que antes)')
  assert.equal(R.desativarAprendizado(cli, a3, 'dono'), '', 'regra editada à mão depois não é tocada'); assert.equal(regras().W, '15%')
  assert.ok(R.listarAuditoria(cli, { evento: 'regra_sku_remove' }).length >= 1); assert.match(R.listarAuditoria(cli, { evento: 'aprendizado_off' }).find(a => a.detalhe.startsWith(`#${a1}`)).detalhe, /desfeita/)
  assert.equal(R.listarAprendizados(cli, { soAtivos: true }).length, 0)
})

// ── estado de promoção no change-log do anúncio (meli_item_mudanca), diferenciado DENTRO de gravarColeta, sem db.js ──
await caso('folha: gravarColeta registra entrou/saiu de promoção e troca de tipo (campo promocao, fonte promo) — só anúncio já lido antes; só o % mudando não é evento', async () => {
  assert.equal(R.db.name, ':memory:', 'banco em memória: a tabela meli_item_mudanca nasce pelo SCHEMA_MUDANCA de acomp-schema.js')
  const fonte = readFileSync(new URL('../src/lib/promocoes-db.js', import.meta.url), 'utf8')
  assert.doesNotMatch(fonte, /from '\.\/preco-historico\.js'/); assert.doesNotMatch(fonte, /^import .* from '\.\/db\.js'/m); assert.match(fonte, /from '\.\/estado-anuncio\.js'/)
  assert.doesNotMatch(readFileSync(new URL('../src/lib/estado-anuncio.js', import.meta.url), 'utf8'), /^import /m, 'módulo puro, sem imports')
  const an = id => ({ item_id: id, sku: 'S', sku_fonte: '', titulo: '', permalink: '', status: 'active', sub_status: '', under_review: 0, preco: 100, preco_original: 100, estoque: 1, categoria: 'MLB1', tipo_anuncio: 'gold_special', catalogo: 0, user_product_id: '', tarifa_json: '', tarifa_estado: '', oferta_erro: '' })
  const of = (status, tipo, preco) => ({ pid: `P-${tipo}`, offer_id: `O-${tipo}-${status}`, tipo, subtipo: '', nome: '', status, preco, preco_original: 100, meli_pct: 5, seller_pct: 0, inicio: '', fim: '', min_preco: null, max_preco: null, sugerido: null })
  const coleta = (cli, ofertas, id = 'K' + Math.random().toString(36).slice(2, 7)) => { R.iniciarColeta(cli, id); R.gravarColeta(cli, { coletaId: id, campanhas: [], anuncios: [an('MLB9')], ofertasPorItem: new Map([['MLB9', ofertas]]), resumo: {}, limites: [] }) }
  const evs = cli => R.db.prepare("SELECT item_id, dia, campo, de, para, variacao_pct, fonte FROM meli_item_mudanca WHERE cliente = ? ORDER BY id").all(cli)
  // 1ª coleta (nunca lido antes) não gera evento, mesmo já em promoção
  coleta('F1', [of('started', 'SMART', 90)]); assert.deepEqual(evs('F1'), [])
  // entrou em promoção
  coleta('F2', [of('candidate', 'SMART', 90)]); coleta('F2', [of('started', 'SMART', 90)])
  assert.deepEqual(evs('F2'), [{ item_id: 'MLB9', dia: R.hojeLocal(), campo: 'promocao', de: 'nenhuma', para: 'SMART −10%', variacao_pct: null, fonte: 'promo' }])
  // só o desconto mudou: nada (isso já aparece no campo preco)
  coleta('F3', [of('started', 'SMART', 90)]); coleta('F3', [of('started', 'SMART', 80)]); assert.deepEqual(evs('F3'), [])
  // trocou de tipo
  coleta('F4', [of('started', 'SMART', 90)]); coleta('F4', [of('started', 'DEAL', 90)])
  assert.deepEqual(evs('F4').map(e => [e.de, e.para]), [['SMART −10%', 'DEAL −10%']])
  // saiu da promoção (voltou a só candidata) e isolamento por cliente
  coleta('F5', [of('started', 'DEAL', 85)]); coleta('F5', [of('candidate', 'DEAL', 85)])
  assert.deepEqual(evs('F5').map(e => [e.de, e.para]), [['DEAL −15%', 'nenhuma']])
  assert.deepEqual(evs('F1'), []); assert.equal(evs('F2').length, 1)
  assert.throws(() => R.db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, fonte, em) VALUES ('F9','MLB9','2026-10-01','folha','a','b','promo','x')").run(), /CHECK/, 'lista fechada do CHECK ampliado')
  // anúncio que virou closed (ofertas apagadas, 0 started) também SAI da promoção no change-log — sem isso o 'desde' e o estadoEm ficavam com duas entradas sem saída
  coleta('F6', [of('started', 'SMART', 90)])
  R.iniciarColeta('F6', 'KC'); R.gravarColeta('F6', { coletaId: 'KC', campanhas: [], anuncios: [{ ...an('MLB9'), status: 'closed' }], ofertasPorItem: new Map(), resumo: {}, limites: [] })
  assert.deepEqual(evs('F6').map(e => [e.de, e.para]), [['SMART −10%', 'nenhuma']], 'closed = saiu da promoção')
  assert.equal(R.db.prepare("SELECT COUNT(*) n FROM promo_oferta WHERE cliente = 'F6' AND status = 'started'").get().n, 0)
  // 2ª coleta no MESMO dia: entrou e saiu = nenhuma linha; trocou de tipo e voltou = nenhuma linha; entrou e trocou de tipo = uma linha nenhuma → tipo final (regra do dia de preco-historico.js)
  coleta('F7', [of('candidate', 'SMART', 90)]); coleta('F7', [of('started', 'SMART', 90)]); assert.equal(evs('F7').length, 1); coleta('F7', [of('candidate', 'SMART', 90)]); assert.deepEqual(evs('F7'), [], 'entrou e saiu no mesmo dia: sem evento')
  coleta('F8', [of('started', 'SMART', 90)]); coleta('F8', [of('started', 'DEAL', 90)]); coleta('F8', [of('started', 'SMART', 85)]); assert.deepEqual(evs('F8'), [], 'SMART → DEAL → SMART no mesmo dia: sem evento (o % é do campo preco)')
  coleta('F9', [of('candidate', 'SMART', 90)]); coleta('F9', [of('started', 'SMART', 90)]); coleta('F9', [of('started', 'DEAL', 80)]); assert.deepEqual(evs('F9').map(e => [e.de, e.para]), [['nenhuma', 'DEAL −20%']], 'juntou na linha do dia')
})

// ── coleta para todos com interruptor por cliente (decisão 3): config/promocoes.json + lote da madrugada ──
await caso('folha: coletaLigada (null = padrão da base; 1/0 do cliente vence) e loteNoturno (só ligados; nunca coletou primeiro, depois a coleta mais antiga; teto do lote)', async () => {
  assert.equal(C.cfgColeta.coleta_para_todos, true); assert.equal(C.cfgColeta.lote_por_madrugada, 5)
  assert.equal(C.coletaLigada(null), true); assert.equal(C.coletaLigada(undefined), true); assert.equal(C.coletaLigada(1), true); assert.equal(C.coletaLigada(0), false); assert.equal(C.coletaLigada(true), true); assert.equal(C.coletaLigada(false), false)
  assert.equal(C.coletaLigada(null, { coleta_para_todos: false }), false); assert.equal(C.coletaLigada(1, { coleta_para_todos: false }), true, 'o interruptor do cliente vence o padrão')
  const lista = [{ cliente: 'Velha', coleta: '2026-09-01T05:00:00Z', ligada: true }, { cliente: 'Nunca B', coleta: null, ligada: true }, { cliente: 'Desligada', coleta: null, ligada: false }, { cliente: 'Recente', coleta: '2026-10-07T05:00:00Z', ligada: true }, { cliente: 'Nunca A', coleta: null, ligada: true }]
  assert.deepEqual(C.loteNoturno(lista, 3).map(c => c.cliente), ['Nunca A', 'Nunca B', 'Velha'])
  assert.deepEqual(C.loteNoturno(lista).map(c => c.cliente), ['Nunca A', 'Nunca B', 'Velha', 'Recente'], 'padrão da config (5) cobre todos os ligados')
  assert.deepEqual(C.loteNoturno(lista, 0), []); assert.deepEqual(C.loteNoturno(lista, 'x'), [])
  const srv = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(srv, /loteNoturno\(listarConexoes\(\)\.filter\(x => !x\.erro\)/, 'o laço diário monta o lote só com conexões sem erro')
  assert.match(srv, /coletaLigada\(coletaPromocoesDoCliente\(c\.cliente\)\)/); assert.match(srv, /logS\('trinity', 'info', `coleta de promoções \(madrugada\)/); assert.match(srv, /logS\('trinity', 'erro', `coleta de promoções \(madrugada\) \$\{c\.cliente\}/)
})

if (falhas) { console.log(`\n${falhas} caso(s) falharam`); process.exit(1) }
console.log('\n✔ frente DADOS: todos os casos de regressão passaram')
