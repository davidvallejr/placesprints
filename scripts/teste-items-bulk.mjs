// Autoteste da F0 da V3 (docs/desenho-v3-produto-estoque-financeiro.md § 2.1): multiget /items?ids= → /items/bulk (o ML desliga o antigo em 25/10/2026).
// Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports), rede bloqueada; a API é um stub com o FORMATO REAL lido no Uniaodog em 14/10 (sem token, sem buyer).
// Cobre: URL (prefixo body. + id/status_code na raiz), formato novo (status_code) e antigo (code), item 404/403 dentro do bulk, lote inteiro com erro,
// lotes de 20, GUARDA (N ids e 0 corpos = erro, nada gravado), parcial contado e logado, e a varredura (nenhum '/items?ids=' sobra em src/).
// Rodar: node scripts/teste-items-bulk.mjs
process.env.PS_DB_MEMORIA = '1'
globalThis.fetch = () => Promise.reject(new Error('rede bloqueada no teste'))
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const { db } = await import('../src/lib/db.js')
const { cifrar } = await import('../src/lib/cripto.js')
const { urlBulk, lerLoteBulk, LOTE_BULK } = await import('../src/lib/meli-bulk.js')
const { multiget, detalhesItens } = await import('../src/lib/meli-api.js')
const { atualizarItens } = await import('../src/lib/meli-serie.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }

// formato REAL do /items/bulk (scratchpad v3/api/f0-bulk-2.json, 14/10/2026): { id, status_code, body } e o 404 sem body
const corpo = id => ({ id, title: `Anúncio ${id}`, price: 114.14, original_price: null, available_quantity: 96, sold_quantity: 24, listing_type_id: 'gold_pro', condition: 'new', status: 'active', category_id: 'MLB85855',
  permalink: `https://produto.mercadolivre.com.br/MLB-${id.slice(3)}`, thumbnail: 'http://http2.mlstatic.com/D_810821-MLB104555060979_012026-I.jpg', pictures: [{ id: '810821-MLB104555060979_012026' }], shipping: { logistic_type: 'fulfillment', free_shipping: true }, catalog_listing: false, catalog_product_id: null, health: null, date_created: '2026-01-10T12:00:00.000Z' })
const real = id => ({ id, status_code: 200, body: corpo(id) })
const idsDe = caminho => decodeURIComponent(caminho.match(/ids=([^&]+)/)[1]).split(',')
// stub de chamar(cliente, caminho, { permitirFalha }): por id, `st` decide o status do item; `lote` derruba o lote inteiro
function stub({ st = () => 200, lote = () => null, formato = 'novo' } = {}) {
  const chamadas = []
  const fn = async (_c, caminho, opts) => {
    assert.ok(opts?.permitirFalha, 'multiget sempre pede permitirFalha (falha vira contagem, nunca exceção crua)')
    assert.match(caminho, /^\/items\/bulk\?ids=/, 'só o endpoint novo')
    chamadas.push(caminho)
    const ids = idsDe(caminho), l = lote(ids)
    if (l) return { _erro: true, status: l, corpo: 'x' }
    return ids.map(id => {
      const s = st(id)
      if (formato === 'antigo') return s === 200 ? { code: 200, body: corpo(id) } : { code: s, body: { message: 'not_found' } }
      return s === 200 ? real(id) : { id, status_code: s }
    })
  }
  fn.chamadas = chamadas
  return fn
}
const ids = (k, base = 5000) => Array.from({ length: k }, (_, i) => `MLB${base + i}`)

await ok('URL: /items/bulk com id e status_code na RAIZ e body. em cada campo (sem eles a raiz some — visto no GET real)', async () => {
  assert.equal(urlBulk(['MLB1', 'MLB2'], 'id,title, price'), '/items/bulk?ids=MLB1,MLB2&attributes=id,status_code,body.id,body.title,body.price')
  assert.equal(LOTE_BULK, 20)
})

await ok('formato novo (real): status_code + id na raiz; 404 DENTRO do bulk vira erro do item, não do lote', async () => {
  const l = lerLoteBulk([real('MLB1'), { id: 'MLB9', status_code: 404 }, real('MLB2'), { id: 'MLB8', status_code: 403 }], ['MLB1', 'MLB9', 'MLB2', 'MLB8'])
  assert.equal(l.falhou, false)
  assert.deepEqual(l.corpos.map(c => c.id), ['MLB1', 'MLB2']); assert.equal(l.corpos[0].available_quantity, 96)
  assert.deepEqual(l.erros, [['MLB9', 404], ['MLB8', 403]])
})
await ok('formato antigo (code) ainda aceito; sem id na raiz o erro é atribuído pela ordem só quando o tamanho bate', async () => {
  const l = lerLoteBulk([{ code: 200, body: corpo('MLB1') }, { code: 404, body: { message: 'x' } }], ['MLB1', 'MLB2'])
  assert.deepEqual(l.corpos.map(c => c.id), ['MLB1']); assert.deepEqual(l.erros, [['MLB2', 404]])
  const m = lerLoteBulk([{ code: 404 }], ['MLB1', 'MLB2'])                          // tamanho diferente: não chuta o id
  assert.deepEqual(m.erros, [['', 404]])
  const s = lerLoteBulk([{ body: corpo('MLB1') }, {}], ['MLB1', 'MLB2'])            // pedido sem id/status_code na raiz (como no 1º GET real): nada é "válido" sem status
  assert.equal(s.corpos.length, 0); assert.deepEqual(s.erros, [['MLB1', 0], ['MLB2', 0]])
  const c = lerLoteBulk([{ id: 'MLB3', status_code: 200, body: { title: 'sem id no body' } }], ['MLB3'])   // id da raiz completa o corpo
  assert.equal(c.corpos[0].id, 'MLB3')
  assert.equal(lerLoteBulk([{ status_code: 200, body: { title: 'sem id nenhum' } }, real('MLB4')], ['MLBx']).corpos.length, 1, 'corpo sem id em lugar nenhum não é válido')
})
await ok('lote inteiro com erro ou fora do formato = falhou, todos os ids com o status do lote', async () => {
  assert.deepEqual(lerLoteBulk({ _erro: true, status: 500 }, ['MLB1', 'MLB2']), { corpos: [], erros: [['MLB1', 500], ['MLB2', 500]], falhou: true })
  assert.equal(lerLoteBulk({ results: [] }, ['MLB1']).falhou, true)
  assert.equal(lerLoteBulk(null, ['MLB1']).falhou, true)
})

await ok('lotes de 20: 45 ids → 3 chamadas (20/20/5), todos os corpos, sem parcial', async () => {
  const f = stub(), r = await multiget('C1', ids(45), 'id,title', { chamarFn: f })
  assert.deepEqual(f.chamadas.map(c => idsDe(c).length), [20, 20, 5])
  assert.equal(r.length, 45); assert.equal(r.parcial, undefined)
  assert.ok(f.chamadas.every(c => c.includes('&attributes=id,status_code,body.id,body.title')))
})
await ok('0 ids = nenhuma chamada e lista vazia (não é erro)', async () => {
  const f = stub(); assert.deepEqual(await multiget('C1', [], 'id', { chamarFn: f }), []); assert.equal(f.chamadas.length, 0)
})
await ok('parcial: item 404 + lote inteiro 500 → lê o resto, CONTA (parcial.por_status, blocos_falhos) e LOGA em sync_log', async () => {
  const antes = db.prepare('SELECT COUNT(*) n FROM sync_log').get().n
  const lista = ids(25), f = stub({ st: id => (id === 'MLB5003' ? 404 : 200), lote: l => (l.includes('MLB5020') ? 500 : null) })
  const r = await multiget('Cliente Parcial', lista, 'id,title', { chamarFn: f })
  assert.equal(r.length, 19)
  assert.deepEqual(r.parcial, { pedidos: 25, lidos: 19, por_status: { 404: 1, 500: 5 }, blocos_falhos: 1 })
  const l = db.prepare('SELECT nivel, msg FROM sync_log ORDER BY rowid DESC LIMIT 1').get()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_log').get().n, antes + 1)
  assert.equal(l.nivel, 'aviso'); assert.match(l.msg, /Cliente Parcial/); assert.match(l.msg, /19 de 25/); assert.match(l.msg, /HTTP 404×1/); assert.match(l.msg, /HTTP 500×5/)
})
await ok('GUARDA: N ids e 0 corpos = ERRO (todos 404, lote 500, formato antigo com erro, resposta fora do formato) — sem eco do corpo da resposta', async () => {
  await assert.rejects(multiget('C1', ids(3), 'id', { chamarFn: stub({ st: () => 404 }) }), /nenhum dos 3 anúncio\(s\).*HTTP 404×3/)
  await assert.rejects(multiget('C1', ids(22), 'id', { chamarFn: stub({ lote: () => 503 }) }), /nenhum dos 22 anúncio\(s\).*HTTP 503×22/)
  await assert.rejects(multiget('C1', ids(2), 'id', { chamarFn: stub({ st: () => 403, formato: 'antigo' }) }), /HTTP 403×2/)
  await assert.rejects(multiget('C1', ids(2), 'id', { chamarFn: async () => ({ resposta: 'segredo-do-corpo' }) }), e => !/segredo/.test(e.message) && /HTTP \?×2/.test(e.message))
})
await ok('formato antigo inteiro (code) continua lido pelo multiget (transição)', async () => {
  const r = await multiget('C1', ids(3), 'id', { chamarFn: stub({ formato: 'antigo' }) }); assert.equal(r.length, 3)
})
await ok('detalhesItens = multiget com os campos de produção (os 18 do GET real + as 6 chaves do produto da V3 F1) via /items/bulk, com include_attributes=all (SELLER_SKU da variação)', async () => {
  const f = stub(), r = await detalhesItens('C1', ['MLB1', 'MLB2'], { chamarFn: f })
  assert.equal(r.length, 2)
  assert.match(f.chamadas[0], /attributes=id,status_code,body\.id,body\.title,body\.price,body\.original_price,body\.permalink,body\.thumbnail,body\.pictures,body\.shipping,body\.catalog_listing,body\.catalog_product_id,body\.listing_type_id,body\.condition,body\.sold_quantity,body\.available_quantity,body\.health,body\.date_created,body\.status,body\.category_id,body\.user_product_id,body\.inventory_id,body\.seller_custom_field,body\.attributes,body\.variations,body\.tags&include_attributes=all$/)
  assert.equal(urlBulk(['MLB1'], 'id'), '/items/bulk?ids=MLB1&attributes=id,status_code,body.id', 'sem extra: a URL de sempre (promoções, saúde, alerta)')
})

// coleta diária de verdade (chamar → fetch): N anúncios e 0 corpos LANÇA e NADA é gravado (o plano nunca sai sobre "0 anúncios"); parcial grava só os lidos
const CLI = 'Conta Bulk'
db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id) VALUES (?, 77, 'n', ?, ?, ?, '', ?, ?, '', '')`)
  .run(CLI, cifrar('AT-teste'), cifrar('RT-teste'), new Date(Date.now() + 6 * 3600e3).toISOString(), new Date().toISOString(), new Date().toISOString())
let resposta = () => []
globalThis.fetch = async url => { const u = String(url); assert.match(u, /^https:\/\/api\.mercadolibre\.com\/items\/bulk\?ids=/); const b = resposta(idsDe(u.slice(u.indexOf('/items')))); return { ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) } }
const itens = () => db.prepare('SELECT item_id, estoque, titulo FROM meli_item WHERE cliente = ? ORDER BY item_id').all(CLI)
await ok('atualizarItens: leitura normal grava os anúncios', async () => {
  resposta = l => l.map(real)
  assert.equal(await atualizarItens(CLI, ['MLB1', 'MLB2']), 2); assert.equal(itens().length, 2)
})
await ok('atualizarItens: N ids e 0 corpos → LANÇA e nada muda no banco (antes gravava 0 anúncios em silêncio)', async () => {
  const antes = JSON.stringify(itens())
  resposta = l => l.map(id => ({ id, status_code: 404 }))
  await assert.rejects(atualizarItens(CLI, ['MLB1', 'MLB2']), /nenhum dos 2 anúncio/)
  resposta = () => []
  await assert.rejects(atualizarItens(CLI, ['MLB1', 'MLB2']), /nenhum dos 2/)
  assert.equal(JSON.stringify(itens()), antes)
})
await ok('atualizarItens: parcial grava só os lidos; o item que falhou mantém a leitura anterior', async () => {
  resposta = l => l.map(id => id === 'MLB2' ? { id, status_code: 500 } : { ...real(id), body: { ...corpo(id), available_quantity: 7 } })
  assert.equal(await atualizarItens(CLI, ['MLB1', 'MLB2']), 1)
  assert.deepEqual(itens().map(i => [i.item_id, i.estoque]), [['MLB1', 7], ['MLB2', 96]])
})

await ok('varredura: nenhum /items?ids= (nem /users?ids=) sobra em src/', async () => {
  const achados = []
  const andar = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) andar(p); else if (/\.(m?js)$/.test(f) && /\/(items|users)\?ids=/.test(readFileSync(p, 'utf-8'))) achados.push(p) } }
  andar(new URL('../src', import.meta.url).pathname)
  assert.deepEqual(achados, [])
})

console.log(`\n${n} casos ok — /items/bulk (F0)`)
