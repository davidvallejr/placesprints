// Autoteste do "Como era" do anúncio (banco EM MEMÓRIA com o DDL; sem rede: a API do ML é um dublê).
// Cobre: hash estável (ordem de chaves/ficha não muda o hash; estoque fora), só grava quando algo muda, descrição ausente declarada e sem linha nova,
// A/B diário × C a cada 7 dias + teto, diff em todos os campos, change-log dos 4 campos novos, "piorou" só com veredito do controle, rotas (prospect 400, isolamento).
import assert from 'node:assert/strict'
process.env.PS_DB_MEMORIA = '1'
const { db } = await import('../src/lib/db.js')
const { SCHEMA_SNAPSHOT } = await import('../src/lib/snapshot-schema.js')
const { SCHEMA_MUDANCA, migrarMudanca } = await import('../src/lib/acomp-schema.js')
const { criarHistoricoAnuncio, hashSnapshot, hashDescricao, diffSnapshots, impressaoCompleta, mudancasParaLog } = await import('../src/lib/anuncio-historico.js')
const { criarRotasHistorico } = await import('../src/rotas-historico.js')
const { textoEvento } = await import('../src/lib/estado-anuncio.js')

db.exec(SCHEMA_SNAPSHOT); db.exec(SCHEMA_MUDANCA); migrarMudanca(db)
const C = '__teste_hist__', ID = 'MLB9000000001', ID2 = 'MLB9000000002', ID3 = 'MLB9000000003'
for (const [id, k] of [[ID, 1], [ID2, 2], [ID3, 3]]) db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco, status) VALUES (?,?,?,?,'active')").run(C, id, 'Produto ' + k, 50)

const item = (over = {}) => ({ id: ID, title: 'Capa de celular azul', price: 59.9, status: 'active', category_id: 'MLB1055', listing_type_id: 'gold_special',
  pictures: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], attributes: [{ id: 'BRAND', value_name: 'Acme' }, { id: 'COLOR', value_name: 'Azul' }],
  variations: [{ id: 11, price: 59.9, available_quantity: 5, picture_ids: ['p1'] }], shipping: { free_shipping: true, logistic_type: 'drop_off', mode: 'me2' }, ...over })
// dublê da API: por item, uma fila de respostas (item) e de descrições
const fila = new Map(), desc = new Map()
const api = { lerItem: async (c, id) => fila.get(id) ?? { _erro: true, status: 404 }, lerDescricao: async (c, id) => desc.has(id) ? desc.get(id) : { plain_text: 'Descrição padrão do produto.' } }
let medidaFixa = null
const hist = criarHistoricoAnuncio(db, { medir: async () => medidaFixa, params: { snapshot: { ab_dias: 1, c_dias: 7, max_itens_por_coleta: 2, teto_ms: 60_000 } } })
const T = n => `2026-10-0${n}T05:00:00.000Z`

// 1) hash estável: ordem dos atributos/chaves não importa; estoque de variação não entra; descrição não entra
{
  const a = impressaoCompleta(item()), b = impressaoCompleta(item({ attributes: [{ id: 'COLOR', value_name: 'Azul' }, { id: 'BRAND', value_name: 'Acme' }] }))
  assert.equal(hashSnapshot(a), hashSnapshot(b), 'ordem da ficha não muda o hash')
  assert.equal(hashSnapshot(a), hashSnapshot(impressaoCompleta(item({ variations: [{ id: 11, price: 59.9, available_quantity: 2, picture_ids: ['p1'] }] }))), 'estoque fora do hash')
  assert.notEqual(hashSnapshot(a), hashSnapshot(impressaoCompleta(item({ title: 'Capa de celular verde' }))))
  assert.equal(hashDescricao('x'), hashDescricao('x')); assert.equal(hashDescricao(null), null)
}
// 2) só grava quando muda: 1ª captura grava; a mesma leitura não; título novo grava; descrição nova grava (impressão igual)
{
  fila.set(ID, item())
  let r = await hist.capturarSnapshot(C, ID, { api, em: T(1) }); assert.equal(r.gravou, true); assert.equal(r.primeira, true); assert.equal(r.sem_descricao, false)
  r = await hist.capturarSnapshot(C, ID, { api, em: T(2) }); assert.equal(r.gravou, false)
  assert.equal(hist.listarSnapshots(C, ID).length, 1)
  fila.set(ID, item({ title: 'Capa de celular azul premium' }))
  r = await hist.capturarSnapshot(C, ID, { api, em: T(3) }); assert.equal(r.gravou, true)
  desc.set(ID, { plain_text: 'Descrição nova, mais completa.' })
  r = await hist.capturarSnapshot(C, ID, { api, em: T(4) }); assert.equal(r.gravou, true, 'só a descrição mudou: grava'); assert.equal(r.mudancas_log, 1)
  assert.equal(hist.listarSnapshots(C, ID).length, 3)
  const ev = db.prepare("SELECT campo, de, para FROM meli_item_mudanca WHERE cliente = ? AND item_id = ? AND campo = 'descricao'").all(C, ID)
  assert.equal(ev.length, 1); assert.equal(ev[0].de, hashDescricao('Descrição padrão do produto.')); assert.equal(ev[0].para, hashDescricao('Descrição nova, mais completa.'))
  assert.equal(textoEvento({ campo: 'descricao' }), 'descrição mudou')
}
// 3) descrição ilegível: grava sem ela e DECLARA; impressão igual + descrição ilegível = nenhuma linha nova
{
  desc.set(ID, { _erro: true, status: 500 })
  let r = await hist.capturarSnapshot(C, ID, { api, em: T(5) }); assert.equal(r.gravou, false, 'leitura falhou e nada mais mudou: herda a descrição anterior'); assert.equal(r.sem_descricao, true)
  fila.set(ID, item({ title: 'Capa azul premium 2' }))
  r = await hist.capturarSnapshot(C, ID, { api, em: T(6) }); assert.equal(r.gravou, true); assert.equal(r.sem_descricao, true)
  const ultimo = hist.listarSnapshots(C, ID)[0]
  assert.equal(ultimo.descricao, null); assert.equal(ultimo.descricao_hash, null)
  assert.ok(hist.resumoSnapshots(C, ID)[0].resumo.includes('descrição não lida'))
  // descrição não lida de um lado → o diff não inventa "descrição removida"
  assert.ok(!diffSnapshots(hist.listarSnapshots(C, ID)[1], ultimo).some(d => d.campo === 'descricao'))
  desc.delete(ID)
}
// 4) diff cobre todos os campos: título, descrição por trecho, fotos (adicionada/removida/reordenada), ficha por id, variações (preço/estoque/fotos, nova/removida), preço, frete, status, categoria, tipo
{
  const a = { titulo: 'A', preco: 10, status: 'active', categoria: 'MLB1', tipo_anuncio: 'gold_special', fotos: ['p1', 'p2', 'p3'], atributos: { BRAND: 'Acme', COLOR: 'Azul', SIZE: 'M' },
    variacoes: [{ id: 1, preco: 10, estoque: 5, picture_ids: ['p1'] }, { id: 2, preco: 12, estoque: 1, picture_ids: [] }], frete: { free_shipping: 1, logistic_type: 'drop_off' }, descricao: 'Produto bom. Entrega rápida. Garantia de 1 ano.' }
  const b = { titulo: 'B', preco: 10.01, status: 'paused', categoria: 'MLB2', tipo_anuncio: 'gold_pro', fotos: ['p3', 'p1', 'p4'], atributos: { BRAND: 'Acme', COLOR: 'Verde', MODEL: 'X' },
    variacoes: [{ id: 1, preco: 11, estoque: 4, picture_ids: ['p4'] }, { id: 3, preco: 9, estoque: 2, picture_ids: [] }], frete: { free_shipping: 0, logistic_type: 'drop_off' }, descricao: 'Produto bom. Entrega em 2 dias. Garantia de 1 ano.' }
  const d = diffSnapshots(a, b), por = c => d.filter(x => x.campo === c)
  for (const c of ['titulo', 'preco', 'status', 'categoria', 'tipo_anuncio']) assert.equal(por(c).length, 1, c)
  assert.equal(por('preco')[0].de, 10); assert.equal(por('preco')[0].para, 10.01)
  assert.equal(por('descricao').length, 1); assert.ok(por('descricao')[0].de.includes('rápida') && por('descricao')[0].para.includes('em 2 dias') && !por('descricao')[0].de.includes('Garantia'), 'trecho curto só da parte que mudou')
  assert.deepEqual(por('fotos').map(x => x.tipo).sort(), ['adicionado', 'removido', 'reordenado'])
  assert.equal(por('fotos').find(x => x.tipo === 'adicionado').para, 'p4'); assert.equal(por('fotos').find(x => x.tipo === 'removido').de, 'p2')
  assert.equal(por('atributos.COLOR')[0].tipo, 'alterado'); assert.equal(por('atributos.SIZE')[0].tipo, 'removido'); assert.equal(por('atributos.MODEL')[0].tipo, 'adicionado'); assert.equal(por('atributos.BRAND').length, 0)
  assert.equal(por('variacoes.1.preco').length, 1); assert.equal(por('variacoes.1.estoque').length, 1); assert.equal(por('variacoes.1.fotos').length, 1)
  assert.equal(por('variacoes.2')[0].tipo, 'removido'); assert.equal(por('variacoes.3')[0].tipo, 'adicionado')
  assert.equal(por('frete.free_shipping').length, 1); assert.equal(por('frete.logistic_type').length, 0)
  assert.deepEqual(diffSnapshots(a, a), [])
  // sem mudança de ordem entre as fotos comuns não há "reordenado"
  assert.ok(!diffSnapshots(a, { ...a, fotos: ['p1', 'p2', 'p3', 'p9'] }).some(x => x.tipo === 'reordenado'))
  // change-log: só descricao, atributos, categoria, tipo_anuncio (título/preço/fotos já saem da coleta)
  assert.deepEqual(mudancasParaLog(a, b).map(x => x.campo).sort(), ['atributos', 'categoria', 'descricao', 'tipo_anuncio'])
  assert.equal(JSON.parse(mudancasParaLog(a, b).find(x => x.campo === 'atributos').para).COLOR, 'Verde')
}
// 5) lote: A/B diário, C a cada 7 dias, teto de itens; A/B primeiro
{
  const curva = id => id === ID3 ? 'C' : 'A'
  fila.set(ID2, item({ id: ID2, title: 'Dois' })); fila.set(ID3, item({ id: ID3, title: 'Três' }))
  let r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-10', em: '2026-10-10T05:00:00.000Z' })
  assert.equal(r.devidos, 3, 'ID (A, fotografia do dia 06), ID2 e ID3 nunca fotografados'); assert.equal(r.lidos, 2, 'teto de 2 por coleta'); assert.equal(r.teto_atingido, true); assert.equal(r.restantes, 1)
  assert.equal(hist.listarSnapshots(C, ID3).length, 0, 'C fica para depois dos A/B')
  r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-10', em: '2026-10-10T05:10:00.000Z' })
  assert.equal(r.devidos, 1); assert.equal(hist.listarSnapshots(C, ID3).length, 1)
  // dia seguinte: A/B devidos de novo, C não (7 dias)
  r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-11', em: '2026-10-11T05:00:00.000Z' })
  assert.equal(r.devidos, 2); assert.equal(r.gravados, 0, 'nada mudou: nada gravado'); assert.equal(r.sem_mudanca, 2)
  r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-16', em: '2026-10-16T05:00:00.000Z' }); assert.equal(r.devidos, 2, 'C ainda não venceu (6 dias)')
  r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-17', em: '2026-10-17T05:00:00.000Z' }); assert.equal(r.devidos, 3, 'C venceu (7 dias)')
  // falha de leitura é contada, não derruba o lote; o teto de relógio para o lote
  fila.delete(ID2)
  r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-18' }); assert.equal(r.falhas, 1)
  let tick = 0; r = await hist.capturarLote(C, { curvaDe: curva, api, hoje: '2026-10-19', relogio: () => (tick++) * 100_000 }); assert.equal(r.teto_atingido, true); assert.ok(r.lidos <= 1)
  fila.set(ID2, item({ id: ID2, title: 'Dois' }))
}
// 6) piorou só com veredito 'piorou' do controle; sem controle = "caiu depois da mudança (sem controle)"; em maturação e sem base declarados
{
  medidaFixa = { estado: 'piorou', efeito_pct: -22.4, efeito_bruto_pct: -30, metrica_primaria: 'unidades', janelas: {}, controle: { razao: 1.1, base: 100 } }
  let m = await hist.piorouDepoisDe(C, ID)
  assert.equal(m.length, hist.listarSnapshots(C, ID).length - 1); assert.equal(m[0].veredito, 'piorou'); assert.ok(/piorou −22%/.test(m[0].texto) && /descontado o controle/.test(m[0].texto))
  assert.ok(m.some(x => x.diff.some(d => d.campo === 'titulo')), 'o par da troca de título traz o diff'); assert.ok(m.every(x => x.de.capturado_em < x.para.capturado_em))
  assert.equal(m[0].diff.length, 0, 'descrição não lida num lado e impressão igual: nada a comparar (declarado, não inventado)')
  medidaFixa = { estado: 'sem_controle', efeito_pct: null, efeito_bruto_pct: -30, metrica_primaria: 'unidades', janelas: {} }
  m = await hist.piorouDepoisDe(C, ID); assert.equal(m[0].veredito, 'sem_controle'); assert.ok(m[0].texto.startsWith('caiu depois da mudança (sem controle)'))
  medidaFixa = { estado: 'variacao_conta', efeito_bruto_pct: 5 }; m = await hist.piorouDepoisDe(C, ID); assert.equal(m[0].veredito, 'sem_controle'); assert.ok(m[0].texto.startsWith('variou depois da mudança (sem controle)'))
  medidaFixa = { estado: 'em_maturacao', motivo: 'só 2 dia(s)' }; m = await hist.piorouDepoisDe(C, ID); assert.equal(m[0].veredito, 'em_maturacao'); assert.ok(m[0].texto.includes('só 2 dia(s)'))
  medidaFixa = { estado: 'sem_base', motivo: 'cobertura' }; m = await hist.piorouDepoisDe(C, ID); assert.equal(m[0].veredito, 'sem_base')
  medidaFixa = { estado: 'melhorou', efeito_pct: 15, metrica_primaria: 'visitas' }; m = await hist.piorouDepoisDe(C, ID); assert.equal(m[0].veredito, 'melhorou')
  assert.deepEqual(await hist.piorouDepoisDe(C, 'MLB0000000000'), [])
}
// 7) rotas: prospect 400 fixo, item inválido 400, anúncio de outro cliente 404 (sem ecoar o valor), GET devolve snapshots + mudancas, POST captura
{
  const r = criarRotasHistorico({ hist: { ...hist, capturarSnapshot: (c, i, o) => hist.capturarSnapshot(c, i, { ...o, api }) }, handle: db })
  const chamar = (metodo, url, body) => new Promise(ok => {
    const [path, qs] = url.split('?'), req = { method: metodo, url, path, query: Object.fromEntries(new URLSearchParams(qs || '')), body, headers: {} }
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(j) { ok({ status: this.statusCode, body: j }) }, setHeader() {}, set() { return this } }
    r.handle(req, res, e => ok({ status: 500, body: { erro: e?.message } }))
  })
  let x = await chamar('GET', `/api/cliente/anuncio/historico?cliente=${encodeURIComponent('[Comercial] Loja X')}&item=${ID}`); assert.equal(x.status, 400)
  x = await chamar('GET', `/api/cliente/anuncio/historico?cliente=${encodeURIComponent(C)}&item=abc`); assert.equal(x.status, 400)
  x = await chamar('GET', `/api/cliente/anuncio/historico?cliente=${encodeURIComponent('outro cliente')}&item=${ID}`); assert.equal(x.status, 404); assert.ok(!x.body.erro.includes(ID))
  x = await chamar('GET', `/api/cliente/anuncio/historico?cliente=${encodeURIComponent(C)}&item=${ID}`); assert.equal(x.status, 200)
  assert.equal(x.body.snapshots.length, hist.listarSnapshots(C, ID).length); assert.equal(x.body.mudancas.length, x.body.snapshots.length - 1); assert.ok(x.body.snapshots[0].resumo); assert.equal(x.body.restaurar, 'Restaurar chega na fase 3')
  x = await chamar('POST', '/api/cliente/anuncio/snapshot', { cliente: C, item: ID }); assert.equal(x.status, 200); assert.equal(x.body.ok, true); assert.equal(x.body.gravou, false)
  x = await chamar('POST', '/api/cliente/anuncio/snapshot', { cliente: '[Comercial] Loja X', item: ID }); assert.equal(x.status, 400)
}
console.log('✔ anuncio-historico: hash estável, grava só quando muda, descrição ausente declarada, A/B diário × C a cada 7 d com teto, diff completo, change-log dos 4 campos, piorou só com controle, rotas isoladas')
