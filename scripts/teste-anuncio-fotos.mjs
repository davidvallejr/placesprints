// Autoteste da galeria do anúncio: GET /api/cliente/anuncio/fotos (rotas-historico.js + lib/anuncio-fotos.js). Banco EM MEMÓRIA, sem rede: o ML é um dublê.
// Cobre: prospect 400, id inválido 400, isolamento por cliente (404 sem eco, snapshot e cache de outro cliente nunca vazam), snapshot ≤ 7 d vence,
// snapshot velho → ML ao vivo, falha/tempo esgotado/sem conexão do ML → só a capa (nunca 500), cache 6 h, teto de 8 fotos, teto de leituras em paralelo,
// teto de entradas do cache, URLs só https://http2.mlstatic.com montadas pelo servidor (id malicioso ou host estranho somem), fila sem leitura depois do prazo;
// e a tela (galeria-anuncio.js num vm): só-capa sem cache na página, painel sem cobrir a miniatura no celular, rolagem/redesenho fecham, miniatura -N.webp.
import assert from 'node:assert/strict'
process.env.PS_DB_MEMORIA = '1'
const { db } = await import('../src/lib/db.js')
const { SCHEMA_SNAPSHOT } = await import('../src/lib/snapshot-schema.js')
const { criarFotosAnuncio, urlFoto, idDaUrl, MAX_FOTOS } = await import('../src/lib/anuncio-fotos.js')
const { criarRotasHistorico } = await import('../src/rotas-historico.js')

db.exec(SCHEMA_SNAPSHOT)
const C = '__teste_fotos__', OUTRO = '__outro_fotos__'
const F = n => `${100000 + n}-MLB${2000000000 + n}_102025`                     // id de foto no formato do ML
const THUMB = n => `https://http2.mlstatic.com/D_${F(n)}-I.jpg`
const insItem = db.prepare('INSERT INTO meli_item (cliente, item_id, titulo, thumb, fotos, status, atualizado_em) VALUES (?,?,?,?,?,?,?)')
for (let k = 1; k <= 9; k++) insItem.run(C, 'MLB10' + k, 'Produto ' + k, THUMB(k), 5, 'active', '2026-10-13T10:00:00.000Z')
insItem.run(OUTRO, 'MLB109', 'Do outro', THUMB(90), 3, 'active', '')         // MESMO id de anúncio em outro cliente
insItem.run(OUTRO, 'MLB200', 'Só do outro', THUMB(91), 3, 'active', '')
insItem.run(C, 'MLB110', 'Thumb de outro host', 'https://evil.example/D_1-MLB1_1-I.jpg', 2, 'active', '')
const insSnap = db.prepare("INSERT INTO meli_item_snapshot (cliente, item_id, hash, capturado_em, origem, fotos_json) VALUES (?,?,?,?,'coleta',?)")

let relogio = Date.parse('2026-10-14T12:00:00.000Z')
const DIA = 864e5
// dublê do ML: por item, uma função que devolve o item (ou lança); conta as chamadas
const respostas = new Map(), chamadas = []
const lerItem = async (cliente, id) => {
  chamadas.push(cliente + '|' + id)
  const f = respostas.get(id); if (!f) return { _erro: true, status: 404 }; return f()
}
const fotos = criarFotosAnuncio({ handle: db, lerItem, agora: () => relogio, timeoutMs: 60, maxParalelo: 3, maxCache: 50 })
const URL_ML = /^https:\/\/http2\.mlstatic\.com\/D_\d+-ML[A-Z]\d+_\d+-O\.webp$/
const soMl = r => r.fotos.every(f => URL_ML.test(f.url))

// rotas com o dublê de "fake express" (o mesmo de teste-anuncio-historico.mjs)
const rotas = criarRotasHistorico({ hist: { resumoSnapshots: () => [], piorouDepoisDe: async () => [], capturarSnapshot: async () => ({}) }, handle: db, fotos })
const get = url => new Promise(ok => {
  const [path, qs] = url.split('?'), req = { method: 'GET', url, path, query: Object.fromEntries(new URLSearchParams(qs || '')), headers: {} }
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(j) { ok({ status: this.statusCode, body: j }) }, setHeader() {}, set() { return this } }
  rotas.handle(req, res, e => ok({ status: 500, body: { erro: e?.message } }))
})
const rota = (cliente, item) => get(`/api/cliente/anuncio/fotos?cliente=${encodeURIComponent(cliente)}&item=${encodeURIComponent(item)}`)

// 0) helpers puros: id → URL só do CDN do ML; URL estranha não vira id
{
  assert.equal(urlFoto(F(1)), `https://http2.mlstatic.com/D_${F(1)}-O.webp`)
  for (const ruim of ['x"><script>', '../../a', 'https://evil.example/a.jpg', '', null]) assert.equal(urlFoto(ruim), null, String(ruim))
  assert.equal(idDaUrl(THUMB(3)), F(3)); assert.equal(idDaUrl(`https://http2.mlstatic.com/D_NQ_NP_${F(3)}-O.webp`), F(3))
  assert.equal(idDaUrl('https://evil.example/D_1-MLB1_1-I.jpg'), null); assert.equal(idDaUrl('javascript:alert(1)'), null)
  assert.equal(MAX_FOTOS, 8)
}
// 1) validação: sem cliente, prospect, id inválido → 400; anúncio de outro cliente → 404; nenhuma mensagem ecoa o valor
{
  let x = await rota('', 'MLB101'); assert.equal(x.status, 400)
  x = await rota('[Comercial] Loja X', 'MLB101'); assert.equal(x.status, 400); assert.match(x.body.erro, /prospect do Comercial não é cliente: sem fotos de anúncio/)
  for (const ruim of ['abc', 'MLA101', 'MLB', 'MLB101;DROP', '101', 'MLB 101']) { x = await rota(C, ruim); assert.equal(x.status, 400, ruim); assert.equal(x.body.erro, 'informe "item" (id do anúncio, ex.: MLB + números)', 'mensagem fixa, sem eco: ' + ruim) }
  x = await rota(C, 'MLB200'); assert.equal(x.status, 404); assert.ok(!x.body.erro.includes('MLB200'), '404 sem eco')
  x = await rota(C, 'mlb101'); assert.equal(x.status, 200, 'minúsculas normalizadas')
  assert.equal(chamadas.length, 1, 'MLB101 sem snapshot e sem resposta do dublê: 1 leitura')
  assert.equal(x.body.fonte, 'capa')
}
// 2) snapshot ≤ 7 dias vence: o ML nem é chamado; teto de 8 fotos (capa + 7), ordem 1..8, total real, URLs montadas pelo servidor
{
  insSnap.run(C, 'MLB102', 'h1', new Date(relogio - 2 * DIA).toISOString(), JSON.stringify(Array.from({ length: 12 }, (_, i) => F(200 + i))))
  insSnap.run(C, 'MLB102', 'h0', new Date(relogio - 20 * DIA).toISOString(), JSON.stringify([F(999)]))          // mais antiga: perde para a recente
  respostas.set('MLB102', async () => { throw new Error('não devia chamar o ML') })
  const n0 = chamadas.length, x = await rota(C, 'MLB102')
  assert.equal(x.status, 200); assert.equal(chamadas.length, n0, 'snapshot recente: sem leitura ao vivo')
  assert.equal(x.body.fonte, 'snapshot'); assert.equal(x.body.item_id, 'MLB102'); assert.equal(x.body.total, 12)
  assert.equal(x.body.fotos.length, 8); assert.deepEqual(x.body.fotos.map(f => f.ordem), [1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(x.body.fotos[0].url, urlFoto(F(200)), 'capa = 1ª foto da fotografia mais recente'); assert.ok(soMl(x.body))
  assert.equal(x.body.lido_em, new Date(relogio - 2 * DIA).toISOString())
}
// 3) isolamento: a fotografia do MESMO item em outro cliente nunca aparece, nem pelo cache
{
  insSnap.run(OUTRO, 'MLB109', 'o1', new Date(relogio - DIA).toISOString(), JSON.stringify([F(500), F(501)]))
  respostas.set('MLB109', async () => ({ id: 'MLB109', pictures: [{ id: F(600) }] }))
  let x = await rota(C, 'MLB109')
  assert.equal(x.body.fonte, 'ml'); assert.deepEqual(x.body.fotos.map(f => f.url), [urlFoto(F(600))], 'C não vê a fotografia do OUTRO')
  const o = await fotos.fotos(OUTRO, 'MLB109')
  assert.equal(o.fonte, 'snapshot'); assert.deepEqual(o.fotos.map(f => f.url), [urlFoto(F(500)), urlFoto(F(501))], 'o cache de C não serve ao OUTRO')
}
// 4) snapshot velho (> 7 d) → ML ao vivo: pictures por id ou por secure_url do CDN; id malicioso e host estranho somem
{
  insSnap.run(C, 'MLB103', 'v1', new Date(relogio - 8 * DIA).toISOString(), JSON.stringify([F(700)]))
  respostas.set('MLB103', async () => ({ id: 'MLB103', pictures: [{ id: F(301) }, { id: 'x"><img src=x onerror=alert(1)>', secure_url: 'https://evil.example/a.jpg' }, { id: 'sem-formato', secure_url: `https://http2.mlstatic.com/D_${F(302)}-O.jpg` }, { id: F(303) }] }))
  const n0 = chamadas.length, x = await rota(C, 'MLB103')
  assert.equal(chamadas.length, n0 + 1); assert.equal(x.body.fonte, 'ml')
  assert.deepEqual(x.body.fotos.map(f => f.url), [urlFoto(F(301)), urlFoto(F(302)), urlFoto(F(303))]); assert.equal(x.body.total, 3); assert.ok(soMl(x.body))
  assert.equal(x.body.lido_em, new Date(relogio).toISOString())
  assert.ok(!JSON.stringify(x.body).includes('evil') && !JSON.stringify(x.body).includes('onerror'))
}
// 5) cache por cliente+item: 2ª leitura não chama o ML; depois de 6 h chama de novo
{
  const n0 = chamadas.length
  await rota(C, 'MLB103'); assert.equal(chamadas.length, n0, 'cache')
  relogio += 6 * 3600e3 + 1000
  const x = await rota(C, 'MLB103'); assert.equal(chamadas.length, n0 + 1, 'TTL de 6 h vencido: lê de novo'); assert.equal(x.body.fonte, 'ml')
}
// 6) falha do ML cai na capa (thumb de meli_item, variante -O), nunca 500: erro HTTP, exceção (sem conexão), resposta sem pictures, tempo esgotado
{
  const casos = [['MLB104', async () => ({ _erro: true, status: 500 })], ['MLB105', async () => { throw new Error('Conta Mercado Livre não conectada') }], ['MLB106', async () => ({ id: 'MLB106' })], ['MLB107', () => new Promise(() => {})]]
  for (const [id, f] of casos) {
    respostas.set(id, f)
    const x = await rota(C, id)
    assert.equal(x.status, 200, id); assert.equal(x.body.fonte, 'capa', id)
    assert.deepEqual(x.body.fotos, [{ url: urlFoto(F(Number(id.slice(-1)))), ordem: 1 }], id); assert.equal(x.body.total, 5, id + ': total = meli_item.fotos')
    assert.equal(x.body.lido_em, '2026-10-13T10:00:00.000Z')
  }
  // capa fica em cache curto (5 min): o ML voltou → em 5 min lê de novo
  respostas.set('MLB104', async () => ({ id: 'MLB104', pictures: [{ id: F(800) }] }))
  assert.equal((await rota(C, 'MLB104')).body.fonte, 'capa', 'capa ainda no cache curto')
  relogio += 5 * 60e3 + 1000
  assert.equal((await rota(C, 'MLB104')).body.fonte, 'ml', 'cache da capa venceu: o ML voltou')
  // thumb de host estranho nunca vira URL: sem foto
  const x = await rota(C, 'MLB110'); assert.equal(x.status, 200); assert.equal(x.body.fonte, 'capa'); assert.deepEqual(x.body.fotos, []); assert.equal(x.body.total, 2)
}
// 7) no máximo 3 leituras ao ML em paralelo; pedidos simultâneos do MESMO item viram uma leitura só (dublê próprio: o de MLB107 acima nunca termina)
{
  const portoes = [], lidos = []
  let em = 0, topo = 0
  const lerLento = (c, id) => { lidos.push(id); em++; topo = Math.max(topo, em); return new Promise(ok => portoes.push(() => { em--; ok({ id, pictures: [{ id: F(900) }] }) })) }
  relogio += 7 * DIA                                                            // tudo vencido (cache e fotografia de MLB102)
  const f2 = criarFotosAnuncio({ handle: db, lerItem: lerLento, agora: () => relogio, timeoutMs: 5000, maxParalelo: 3 })
  const ps = ['MLB101', 'MLB102', 'MLB105', 'MLB106', 'MLB107', 'MLB108', 'MLB108'].map(id => f2.fotos(C, id))
  for (let i = 0; i < 50 && portoes.length < 3; i++) await new Promise(r => setTimeout(r, 1))
  await new Promise(r => setTimeout(r, 5))
  assert.equal(em, 3, '3 leituras em andamento, as outras esperam vaga'); assert.equal(portoes.length, 3)
  while (lidos.length < 6 || portoes.length) { portoes.shift()?.(); await new Promise(r => setTimeout(r, 1)) }
  const rs = await Promise.all(ps)
  assert.equal(topo, 3, 'pico de leituras simultâneas = teto'); assert.equal(lidos.length, 6, 'MLB108 pedido 2× ao mesmo tempo: 1 leitura')
  assert.ok(rs.every(r => r.fonte === 'ml' && soMl(r)))
}
// 8) teto de entradas do cache: a mais antiga sai
{
  const f3 = criarFotosAnuncio({ handle: db, lerItem: async () => ({ _erro: true }), agora: () => relogio, maxCache: 2 })
  for (const id of ['MLB101', 'MLB104', 'MLB105']) await f3.fotos(C, id)
  assert.equal(f3.cache.size, 2); assert.ok(![...f3.cache.keys()].some(k => k.endsWith('MLB101')), 'a mais antiga saiu')
}
// 9) prazo vencido na fila: quem ainda esperava vaga NÃO vai ao ML depois (antes: 10 leituras, 4 delas sem ninguém esperando)
{
  const inicios = [], t0 = Date.now()
  const lerDevagar = (c, id) => { inicios.push(Date.now() - t0); return new Promise(ok => setTimeout(ok, 100, { id, pictures: [{ id: F(950) }] })) }
  const f4 = criarFotosAnuncio({ handle: db, lerItem: lerDevagar, agora: () => relogio, timeoutMs: 150, maxParalelo: 3 })
  const ids = Array.from({ length: 10 }, (_, k) => 'MLB1' + String(k + 1).padStart(2, '0'))
  const rs = await Promise.all(ids.map(id => f4.fotos(C, id)))
  await new Promise(r => setTimeout(r, 120))                                     // a 2ª leva termina (200 ms) e a fila escoa
  assert.equal(rs.filter(r => r.fonte === 'ml').length, 3, '1ª leva (0–100 ms) dentro do prazo')
  assert.ok(inicios.every(t => t < 150), 'nenhuma leitura começa depois do prazo: ' + inicios.join(','))
  assert.equal(inicios.length, 6, '2 levas de 3; as 4 que ainda esperavam vaga desistem')
}
// 10) tela (galeria-anuncio.js num vm com DOM de mentira): só-capa não fica no cache da página, painel nunca cobre a miniatura no celular,
//     rolagem de roda fecha o painel aberto pelo teclado, miniatura trocada sob o mouse fecha o painel, miniatura sempre -N.webp
{
  const { readFileSync } = await import('node:fs'), vm = (await import('node:vm')).default
  class Node { contains(n) { return n === this } }
  class El extends Node {
    constructor(galeria, rect) { super(); this.dataset = galeria ? { galeria } : {}; this.style = {}; this.attrs = {}; this.isConnected = true; this.rect = rect; this.hidden = false; this.innerHTML = '' }
    setAttribute(k, v) { this.attrs[k] = String(v) } getAttribute(k) { return this.attrs[k] }
    closest(sel) { return sel === '[data-galeria]' && this.dataset.galeria ? this : null }
    matches() { return true } querySelector() { return null } getBoundingClientRect() { return this.rect }
    get offsetWidth() { return 346 } get offsetHeight() { return this.style.maxHeight ? Math.min(536, parseFloat(this.style.maxHeight)) : 536 }   // 5 fotos = 536 px
  }
  const ev = {}, fetches = []
  let proxima = { fonte: 'capa', fotos: [{ url: urlFoto(F(1)), ordem: 1 }], total: 5 }
  const doc = {
    addEventListener: (t, f) => (ev[t] ||= []).push(f), getElementById: id => id === 'telaCliente' ? { dataset: { cliente: C } } : null,
    createElement: () => new El(), body: { append: el => { doc.painel = el } }, documentElement: { clientWidth: 375, clientHeight: 812 }, activeElement: null,
  }
  const ctx = { document: doc, Node, fetch: async url => { fetches.push(url); return { ok: true, json: async () => proxima } }, setTimeout, clearTimeout,
    esc: s => String(s ?? ''), imgAnuncio: (u, t, c) => `<img class="${c}" src="${u}">`, addEventListener: () => {} }
  ctx.window = ctx
  vm.runInNewContext(readFileSync(new URL('../src/web/galeria-anuncio.js', import.meta.url), 'utf8'), ctx)
  const G = ctx.PSGaleria, disparar = (t, e) => ev[t].forEach(f => f({ preventDefault() {}, ...e })), espera = ms => new Promise(r => setTimeout(r, ms))
  const thumb = (id, top) => new El(id, { top, bottom: top + 76, left: 16, right: 92 })

  assert.equal(G.nitida(THUMB(1)), `https://http2.mlstatic.com/D_${F(1)}-N.webp`, '.jpg vira -N.webp (metade do peso)')
  assert.equal(G.nitida(`https://http2.mlstatic.com/D_${F(1)}-I.webp`), `https://http2.mlstatic.com/D_${F(1)}-N.webp`)

  // só-capa: cada abertura pede de novo; quando o ML volta ('ml'), aí sim fica no cache
  const a = thumb('MLB101', 352)
  const ciclo = async () => { disparar('keydown', { key: 'Enter', target: a }); await espera(5); disparar('keydown', { key: 'Escape', target: a }) }
  await ciclo(); await ciclo()
  assert.equal(fetches.length, 2, 'resposta só-capa não fica no cache da página')
  proxima = { fonte: 'ml', fotos: [1, 2, 3].map(n => ({ url: urlFoto(F(n)), ordem: n })), total: 3 }
  await ciclo(); await ciclo()
  assert.equal(fetches.length, 3, "resposta 'ml' fica no cache da página")
  const P = doc.painel

  // celular 375×812: painel de 536 px não cabe nem abaixo nem acima → vai para o lado maior, com max-height, sem cobrir a miniatura
  for (const top of [100, 352, 500, 700]) {
    const t = thumb('MLB102', top)
    disparar('keydown', { key: 'Enter', target: t }); await espera(5)
    const y = parseFloat(P.style.top), h = P.offsetHeight, r = t.rect
    assert.ok(y >= r.bottom || y + h <= r.top, `top ${top}: painel ${y}–${y + h} cobre a miniatura ${r.top}–${r.bottom}`)
    assert.ok(y >= 8 && y + h <= 812 - 8, `top ${top}: dentro da tela`)
    disparar('pointerdown', { pointerType: 'touch' }); disparar('click', { target: t })
    assert.equal(P.hidden, true, `top ${top}: o 2º toque na miniatura fecha`)
  }

  // teclado: a rolagem logo após o foco só reposiciona; a da roda, depois, fecha
  const k = thumb('MLB103', 100)
  disparar('focusin', { target: k }); doc.activeElement = k; await espera(5)
  disparar('scroll', { target: doc }); assert.equal(P.hidden, false, 'rolagem do próprio foco: continua aberto')
  await espera(520)
  disparar('scroll', { target: doc }); assert.equal(P.hidden, true, 'rolagem de roda com o foco parado: fecha')
  doc.activeElement = null

  // miniatura sob o mouse trocada pelo esqueleto/redesenho: o próximo pointerover fora dela fecha
  const m = thumb('MLB104', 100)
  disparar('pointerover', { pointerType: 'mouse', target: m }); await espera(230)
  assert.equal(P.hidden, false, 'hover abre em 200 ms')
  m.isConnected = false
  disparar('pointerover', { pointerType: 'mouse', target: new El() })
  assert.equal(P.hidden, true, 'alvo desconectado: fecha')
}
console.log('✔ anuncio-fotos: prospect/id inválido 400, isolamento 404 sem eco (snapshot e cache por cliente), snapshot ≤ 7 d vence, ML ao vivo, falha/tempo/sem conexão → capa sem 500, cache 6 h + capa 5 min, teto 8 fotos, 3 em paralelo, teto do cache, URLs só https://http2.mlstatic.com')
