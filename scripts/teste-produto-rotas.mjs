// V3 F2 — HTTP e carregador do produto por trás do anúncio, em SOMBRA (docs/desenho-v3-produto-estoque-financeiro.md § 8.4 e § 9 F2): isolamento por cliente (o mesmo
// UP em 2 clientes nunca se junta), prospect 400 e fora da central 404 sem eco, 415 sem JSON, prévia não grava, confirmar só com true, `por` inválido 403 sem eco,
// vínculo manual e recusa refletidos no grafo, leitura GET /stock com API falsa (sucesso, falha 403 nunca vira 0, teto do dia), seleção dos UPs ambíguos e a
// projeção «por anúncio × por produto» sem mudar nenhum número do diagnóstico. Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports); nenhuma chamada ao ML.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db, hojeLocal } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const R = await import('../src/lib/produto-estoque-real.js')
const { dreDoCliente } = await import('../src/lib/lucro-real.js')
const { criarRotasProdutos } = await import('../src/rotas-produtos.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = hojeLocal(), D = k => addDias(HOJE, k), POR = 'Giovanna Torres', T = `${HOJE}T05:00:00.000Z`
const item = (id, o = {}) => ({ id, title: `Peitoral H Rock ${id}`, price: 50, available_quantity: 100, pictures: [{}, {}, {}, {}, {}], shipping: { logistic_type: 'xd_drop_off', tags: [] },
  status: 'active', date_created: '2025-01-01T00:00:00.000Z', user_product_id: 'MLBU777', ...o })
function semear(cli, itens, vendas) {
  gravarItens(cli, itens, { t: T, dia: HOJE })
  const s = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  const c = db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,1,0,?)")
  db.transaction(() => { for (let d = -56; d <= -1; d++) { c.run(cli, D(d), T); if (d >= -28) for (const [id, u] of Object.entries(vendas)) if (u) s.run(cli, id, D(d), u, u * 50, 40) } })()
}
// União Dog: catálogo + clássico no MESMO UP (100 un, 2/dia + 3/dia) e um terceiro anúncio com o mesmo SKU oficial em OUTRO UP (espelho 100/100)
semear('Uniao', [item('MLB1', { catalog_listing: true, catalog_product_id: 'MLB55' }), item('MLB2'),
  item('MLB3', { user_product_id: 'MLBU888', attributes: [{ id: 'SELLER_SKU', value_name: 'PH-ROCK-M' }] }), item('MLB4', { user_product_id: 'MLBU999', attributes: [{ id: 'SELLER_SKU', value_name: 'ph-rock-m' }] })],
  { MLB1: 2, MLB2: 3, MLB3: 1, MLB4: 0 })
// Outro cliente com o MESMO UP: nunca entra no produto da União
semear('Outra', [item('MLB9')], { MLB9: 1 })
const quem = ['Giovanna Torres'], norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const canon = nome => ({ uniao: 'Uniao', outra: 'Outra', sep: 'Sep', pausa: 'Pausa' })[norm(nome)] || ''
const fake = { chamadas: [], resp: {} }
const chamarFn = async (c, caminho) => { fake.chamadas.push([c, caminho]); return fake.resp[caminho] ?? { _erro: true, status: 503 } }
const app = express(); app.use(express.json())
app.use(criarRotasProdutos({ produtos: c => R.produtosDoCliente(c, diagnosticarConta(c, { hoje: HOJE }), { cfg: algoritmo }), mapeamento: R.mapeamentoDoCliente,
  vinculos: R.criarVinculoProduto({ agora: () => T, validarPor: (nome) => (norm(nome) === norm(POR) ? POR : '') }), quem: () => quem, clienteCanonico: canon,
  estoque: { ups: R.upsDosProdutos, restante: c => R.estoqueRestanteHoje(c), ler: (c, ups) => R.lerEstoqueUps(c, { ups, chamarFn, pausaMs: 0 }), validarPor: nome => (norm(nome) === norm(POR) ? POR : '') },
  dre: (c, mes) => dreDoCliente(c, mes, { hoje: HOJE }), mesAtual: () => HOJE.slice(0, 7) }))
const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}`
const get = async url => { const r = await fetch(base + url); return [r.status, await r.json()] }
const post = async (url, b, ct = 'application/json') => { const r = await fetch(base + url, { method: 'POST', headers: { 'content-type': ct }, body: typeof b === 'string' ? b : JSON.stringify(b) }); return [r.status, await r.json()] }
const vinculos = () => db.prepare('SELECT cliente, origem, produto, tipo, por FROM produto_vinculo ORDER BY cliente, origem').all()

try {
  await ok('GET /api/cliente/produtos: mesmo UP = 1 produto (2 anúncios, estoque contado 1×), SKU oficial junta o outro UP (espelho 100/100); sombra 400 × 200; diagnóstico intacto', async () => {
    const antes = JSON.stringify(diagnosticarConta('Uniao', { hoje: HOJE }).itens.map(i => [i.id, i.cobertura, i.ponto_reposicao, i.estoque]))
    const [st, j] = await get('/api/cliente/produtos?cliente=uniao')
    assert.equal(st, 200); assert.equal(j.disponivel, true); assert.equal(j.sombra_ligada, false)
    const up = j.produtos.find(p => p.chave === 'cat:MLB55'), sku = j.produtos.find(p => p.chave === 'sku:ph-rock-m')
    assert.deepEqual([up.n_anuncios, up.estoque_total, up.vel_dia, up.cobertura, up.ponto_pedido, up.modo], [2, 100, 5, 20, 140, 'um_pool'])
    assert.deepEqual(up.cobertura_por_anuncio, { min: 33, max: 50 }, 'por anúncio cada um via 50 e 33 dias')
    assert.deepEqual([sku.n_anuncios, sku.modo, sku.estoque_total, sku.situacao], [2, 'espelho_provavel', 100, 'confirmar_estoque'])
    assert.deepEqual([j.sombra.estoque.soma_por_anuncio, j.sombra.estoque.contado_uma_vez], [400, 200]); assert.equal(j.resumo.produtos, 2)
    assert.ok(j.premissas.some(t => /com o mesmo número = o mesmo estoque físico/.test(t)) && j.premissas.some(t => /^Sombra/.test(t)))
    assert.equal(JSON.stringify(diagnosticarConta('Uniao', { hoje: HOJE }).itens.map(i => [i.id, i.cobertura, i.ponto_reposicao, i.estoque])), antes, 'sombra não muda o diagnóstico')
  })

  await ok('V3 F4 — visão Lucro e DRE: sem linhas de pedido a receita vem da série e nada é afirmado («parcial» com o motivo); mês inválido 400 sem eco; prospect 400; «Não é lucro líquido.»', async () => {
    const [st, j] = await get('/api/cliente/produtos?cliente=uniao')
    assert.equal(st, 200); assert.ok(j.financeiro?.conta && Array.isArray(j.financeiro.premissas)); assert.match(j.financeiro.tarifa, /não conciliada/)
    const p = j.produtos.find(x => x.chave === 'cat:MLB55')
    assert.deepEqual([p.financeiro.receita_c, p.financeiro.lucro_c, p.financeiro.margem_pct, p.financeiro.cobertura], [Math.round(p.receita_28d * 100), null, null, 0])
    assert.match(p.financeiro.motivo, /dias sem linhas de pedido: 100% da receita/); assert.equal(p.anuncios[0].financeiro.lucro_c, null)
    let [s2, d] = await get(`/api/cliente/dre?cliente=uniao&mes=${HOJE.slice(0, 7)}`)
    assert.equal(s2, 200); assert.equal(d.disponivel, false, 'nenhum dia com linhas: sem dado, nunca um DRE de zeros'); assert.match(d.motivo, /sem dado não é zero/)
    db.prepare('UPDATE meli_coleta_dia SET linhas = 1 WHERE cliente = ? AND dia = ?').run('Uniao', D(-1))
    ;[s2, d] = await get('/api/cliente/dre?cliente=uniao'); assert.equal(s2, 200); assert.equal(d.mes, HOJE.slice(0, 7), 'sem mês: o corrente')
    if (d.mes === HOJE.slice(0, 7)) { assert.equal(d.rodape, 'Não é lucro líquido.'); assert.equal(d.linhas.find(l => l.chave === 'margem').valor_c, null); assert.ok(d.parcial) }
    db.prepare('UPDATE meli_coleta_dia SET linhas = 0 WHERE cliente = ? AND dia = ?').run('Uniao', D(-1))
    ;[s2, d] = await get('/api/cliente/dre?cliente=uniao&mes=2026-13x'); assert.equal(s2, 400); assert.doesNotMatch(JSON.stringify(d), /13x/)
    ;[s2, d] = await get('/api/cliente/dre?cliente=' + encodeURIComponent('[Comercial] Zebra') + '&mes=2026-10'); assert.equal(s2, 400); assert.doesNotMatch(JSON.stringify(d), /Zebra/)
    ;[s2] = await get('/api/cliente/dre?cliente=Ninguem&mes=2026-10'); assert.equal(s2, 404)
  })

  await ok('isolamento: o MESMO UP em outro cliente nunca entra no produto (cada cliente só vê o seu)', async () => {
    const [, j] = await get('/api/cliente/produtos?cliente=Outra')
    assert.equal(j.produtos.length, 1); assert.equal(j.produtos[0].n_anuncios, 1); assert.deepEqual(j.produtos[0].anuncios.map(a => a.id), ['MLB9'])
    const [, u] = await get('/api/cliente/produtos?cliente=Uniao'); assert.ok(!JSON.stringify(u).includes('MLB9'))
  })

  await ok('prospect 400 e fora da central 404, mensagens fixas sem eco; 415 sem JSON', async () => {
    let [st, j] = await get('/api/cliente/produtos?cliente=' + encodeURIComponent('[Comercial] Xyzzy')); assert.equal(st, 400); assert.doesNotMatch(JSON.stringify(j), /Xyzzy/)
    ;[st, j] = await get('/api/cliente/produtos/mapeamento?cliente=Fulano%20Malvado'); assert.equal(st, 404); assert.doesNotMatch(JSON.stringify(j), /Malvado/)
    ;[st] = await post('/api/cliente/produtos/juntar', 'origem=x', 'text/plain'); assert.equal(st, 415)
    ;[st, j] = await post('/api/cliente/produtos/juntar', { cliente: 'Uniao', origem: '<script>alert(1)</script>', produto: 'sku:x', por: POR }); assert.equal(st, 400); assert.doesNotMatch(JSON.stringify(j), /script/)
    ;[st, j] = await post('/api/cliente/produtos/juntar', { cliente: 'Uniao', origem: 'item:MLB123456', produto: 'sku:ph-rock-m', por: POR }); assert.equal(st, 404); assert.doesNotMatch(JSON.stringify(j), /123456/)
  })

  await ok('juntar: prévia por padrão (antes × depois, nada gravado); confirmar "true" (texto) continua prévia; por inválido 403 sem eco; confirmar === true grava e o grafo obedece', async () => {
    const corpo = { cliente: 'Uniao', origem: 'up:MLBU888', produto: 'cat:MLB55', por: POR }
    let [st, j] = await post('/api/cliente/produtos/juntar', corpo)
    assert.equal(st, 200); assert.equal(j.previa, true); assert.equal(j.mudou, true); assert.deepEqual([j.antes.produto, j.depois.produto, j.depois.n_anuncios], ['sku:ph-rock-m', 'cat:MLB55', 3]); assert.deepEqual(vinculos(), [])
    ;[, j] = await post('/api/cliente/produtos/juntar', { ...corpo, confirmar: 'true' }); assert.equal(j.previa, true); assert.deepEqual(vinculos(), [])
    ;[st, j] = await post('/api/cliente/produtos/juntar', { ...corpo, por: 'Hacker Malvado', confirmar: true }); assert.equal(st, 403); assert.doesNotMatch(JSON.stringify(j), /Hacker/); assert.deepEqual(vinculos(), [])
    ;[st, j] = await post('/api/cliente/produtos/juntar', { ...corpo, confirmar: true }); assert.equal(j.previa, false)
    assert.deepEqual(vinculos(), [{ cliente: 'Uniao', origem: 'up:MLBU888', produto: 'cat:MLB55', tipo: 'manual', por: POR }])
    const [, p] = await get('/api/cliente/produtos?cliente=Uniao'); assert.equal(p.produtos.find(x => x.chave === 'cat:MLB55').n_anuncios, 3)
  })

  await ok('separar (recusa, «Não é o mesmo» de uma sugestão): prévia, depois grava; o par não se junta mais automaticamente; mapeamento lista mapeados e não mapeados', async () => {
    const corpo = { cliente: 'Uniao', origem: 'up:MLBU999', produto: 'cat:MLB55', por: POR }
    let [, j] = await post('/api/cliente/produtos/separar', corpo); assert.equal(j.previa, true); assert.equal(j.depois.n_anuncios, 1)
    ;[, j] = await post('/api/cliente/produtos/separar', { ...corpo, confirmar: true }); assert.equal(j.previa, false)
    assert.ok(vinculos().some(v => v.origem === 'up:MLBU999' && v.tipo === 'recusado'))
    const [st, m] = await get('/api/cliente/produtos/mapeamento?cliente=Uniao')
    assert.equal(st, 200); assert.ok(m.mapeados.some(p => p.chave === 'cat:MLB55' && p.n_anuncios === 3)); assert.ok(m.nao_mapeados.some(p => p.origens[0].origem === 'up:MLBU999')); assert.deepEqual(m.quem, quem)
  })

  await ok('GET /stock: prévia não chama o ML; leitura grava próprio (Σ depósitos, nº de lojas) e Full; falha 403 nunca vira 0 (pendente permissao_do_app); teto do dia', async () => {
    fake.resp['/user-products/MLBU777/stock'] = { id: 'MLBU777', locations: [{ type: 'seller_warehouse', store_id: '86161652', quantity: 400, network_node_id: 'BRP1' }, { type: 'meli_facility', quantity: 3 }] }
    let [st, j] = await post('/api/cliente/produtos/estoque/atualizar', { cliente: 'Uniao', produtos: ['cat:MLB55'] })
    assert.equal(st, 200); assert.deepEqual([j.previa, j.ups], [true, 2]); assert.equal(fake.chamadas.length, 0, 'prévia não chama o ML')
    ;[st, j] = await post('/api/cliente/produtos/estoque/atualizar', { cliente: 'Uniao', produtos: ['cat:MLB55'], confirmar: true })
    assert.equal(st, 400, 'revisão F2: confirmar sem "por" não chama o ML'); assert.equal(fake.chamadas.length, 0)
    ;[st, j] = await post('/api/cliente/produtos/estoque/atualizar', { cliente: 'Uniao', produtos: ['cat:MLB55'], por: 'Hacker Malvado', confirmar: true })
    assert.equal(st, 403); assert.doesNotMatch(JSON.stringify(j), /Hacker/); assert.equal(fake.chamadas.length, 0)
    ;[, j] = await post('/api/cliente/produtos/estoque/atualizar', { cliente: 'Uniao', produtos: ['cat:MLB55'], por: POR, confirmar: true })
    assert.deepEqual([j.lidos, j.falhas], [1, 1], 'MLBU777 lido, MLBU888 falhou (503)')
    const linhas = db.prepare('SELECT user_product_id up, local, quantidade, lojas, pendente FROM meli_up_estoque WHERE cliente = ? ORDER BY up, local').all('Uniao')
    assert.deepEqual(linhas, [{ up: 'MLBU777', local: 'full', quantidade: 3, lojas: null, pendente: '' }, { up: 'MLBU777', local: 'proprio', quantidade: 400, lojas: 1, pendente: '' },
      { up: 'MLBU888', local: 'full', quantidade: null, lojas: null, pendente: 'indisponivel' }, { up: 'MLBU888', local: 'proprio', quantidade: null, lojas: null, pendente: 'indisponivel' }])
    fake.resp['/user-products/MLBU777/stock'] = { _erro: true, status: 403 }
    await R.lerEstoqueUps('Uniao', { ups: ['MLBU777'], chamarFn, pausaMs: 0, teto: 99 })
    assert.deepEqual(db.prepare("SELECT quantidade, pendente FROM meli_up_estoque WHERE cliente = 'Uniao' AND user_product_id = 'MLBU777' AND local = 'proprio'").get(), { quantidade: 400, pendente: 'permissao_do_app' }, 'a leitura boa fica; a falha só marca')
    const antes = fake.chamadas.length, r = await R.lerEstoqueUps('Uniao', { ups: ['MLBU1', 'MLBU2'], chamarFn, pausaMs: 0, teto: 2 })
    assert.deepEqual([r.pulados, fake.chamadas.length - antes], [2, 0], 'teto do dia: 3 chamadas já feitas nas últimas 24 h (a falha e a releitura contam)')
    // o grafo usa a leitura: UP próprio sem Full no grafo → o pool próprio vem do /stock (400) e o Full aparece como pool virtual (3 > 0)
    const [, p] = await get('/api/cliente/produtos?cliente=Uniao'), x = p.produtos.find(q => q.chave === 'cat:MLB55')
    assert.deepEqual(x.pools.filter(q => q.chave.startsWith('up:MLBU777')).map(q => [q.local, q.estoque, q.fonte]).sort(), [['full', 3, 'stock'], ['proprio', 400, 'stock']])
    assert.equal(x.estoque_total, 503, 'Full 3 + próprio 400 (/stock) + próprio 100 do MLBU888 (vínculo manual; números diferentes = dividido, soma)'); assert.equal(x.modo, 'dividido')
    assert.ok(x.premissas.some(t => /Full e estoque próprio são estoques separados/.test(t)) && x.premissas.some(t => /números diferentes/.test(t)))
  })

  await ok('upsParaLer: só UP com anúncio Full e (Flex ou 2+ logísticas), com venda em 28 d, por receita; isolado por cliente', async () => {
    semear('Full', [item('MLB21', { user_product_id: 'MLBU21', shipping: { logistic_type: 'fulfillment', tags: ['self_service_in'] }, inventory_id: 'I21' }),
      item('MLB22', { user_product_id: 'MLBU22', shipping: { logistic_type: 'fulfillment', tags: [] }, inventory_id: 'I22' }),
      item('MLB23', { user_product_id: 'MLBU22' }), item('MLB24', { user_product_id: 'MLBU24', shipping: { logistic_type: 'fulfillment', tags: ['self_service_in'] } }),
      item('MLB25', { user_product_id: 'MLBU25', shipping: { logistic_type: 'fulfillment', tags: [] } })], { MLB21: 1, MLB22: 2, MLB23: 1, MLB24: 0, MLB25: 3 })
    assert.deepEqual(R.upsParaLer('Full', { hoje: HOJE }), ['MLBU22', 'MLBU21'], 'MLBU24 sem venda e MLBU25 sem ambiguidade ficam fora')
    assert.deepEqual(R.upsParaLer('Uniao', { hoje: HOJE }), [])
  })

  await ok('troca de conta do ML limpa a leitura por local (meli_up_estoque) do cliente; a decisão humana (produto_vinculo) fica', async () => {
    const { TABELAS_SERIE, limparSerieDoCliente } = await import('../src/lib/meli-contas.js')
    assert.ok(TABELAS_SERIE.includes('meli_up_estoque') && !TABELAS_SERIE.includes('produto_vinculo'))
    limparSerieDoCliente('Uniao')
    assert.equal(db.prepare("SELECT COUNT(*) n FROM meli_up_estoque WHERE cliente = 'Uniao'").get().n, 0); assert.ok(vinculos().length >= 2)
  })
  await ok('revisão F2: «Separar» a origem que carrega o SKU (produto juntado pelo catálogo) grava 1 recusa por par de origens e separa; confirmar sem efeito = 400, nada gravado', async () => {
    semear('Sep', [item('MLB41', { user_product_id: 'MLBU41', catalog_product_id: 'MLB900', attributes: [{ id: 'SELLER_SKU', value_name: 'GL' }] }), item('MLB42', { user_product_id: 'MLBU42', catalog_product_id: 'MLB900' })], { MLB41: 1, MLB42: 1 })
    const [, m] = await get('/api/cliente/produtos/mapeamento?cliente=Sep'), p = m.mapeados.find(x => x.n_anuncios === 2)
    assert.equal(p.alvo, 'sku:gl')
    const corpo = { cliente: 'Sep', origem: 'up:MLBU41', produto: p.alvo, por: POR }
    let [st, j] = await post('/api/cliente/produtos/separar', corpo)
    assert.deepEqual([st, j.previa, j.mudou, j.depois.n_anuncios, j.vinculos], [200, true, true, 1, 1], 'a prévia já separa (antes: «Nada muda»)')
    ;[st, j] = await post('/api/cliente/produtos/separar', { ...corpo, confirmar: true }); assert.equal(j.previa, false)
    assert.deepEqual(vinculos().filter(v => v.cliente === 'Sep').map(v => [v.origem, v.produto, v.tipo]), [['up:MLBU41', 'up:MLBU42', 'recusado']])
    const [, g] = await get('/api/cliente/produtos?cliente=Sep'); assert.equal(g.produtos.length, 2)
    ;[st, j] = await post('/api/cliente/produtos/separar', { ...corpo, confirmar: true })
    assert.equal(st, 400, 'já separado: a prévia não muda nada e o confirmar é recusado'); assert.equal(vinculos().filter(v => v.cliente === 'Sep').length, 1)
  })

  await ok('revisão F2: teto do /stock conta CHAMADAS (o mesmo UP relido gasta o teto); upsParaLer ignora UPs de variação (o grafo da F2 não usa)', async () => {
    let chamadas = 0
    const so = async () => { chamadas++; return { locations: [{ type: 'seller_warehouse', store_id: '1', quantity: 10 }] } }
    const ups = Array.from({ length: 10 }, (_, k) => `MLBU${500 + k}`)
    for (let k = 0; k < 5; k++) await R.lerEstoqueUps('Pausa', { ups, teto: 15, chamarFn: so, pausaMs: 0 })
    assert.equal(chamadas, 15, 'teto 15: no máximo 15 chamadas, mesmo com a mesma lista 5 vezes'); assert.equal(R.estoqueRestanteHoje('Pausa'), Math.max(0, (algoritmo.produto.stock_teto_por_coleta ?? 150) - 15))
    const ins = db.prepare(`INSERT INTO meli_anuncio_up (cliente,item_id,variacao_id,user_product_id,inventory_id,sku,sku_fonte,catalogo_produto_id,estoque,logistica,flex,tags,status,lido_em) VALUES ('Var',?,?,?,?,'','','',5,'fulfillment',1,'','active',?)`)
    for (const [v, up] of [['11', 'MLBU901'], ['12', 'MLBU902'], ['13', 'MLBU903']]) ins.run('MLB900', v, up, 'INV' + v, T)
    ins.run('MLB800', '', 'MLBU800', 'INV8', T)
    const s = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)'); s.run('Var', 'MLB900', D(-3), 10, 1000); s.run('Var', 'MLB800', D(-3), 3, 300)
    assert.deepEqual(R.upsParaLer('Var', { hoje: HOJE }), ['MLBU800'], 'o pai com variações não entra na fila (nem com a receita multiplicada)')
  })

  await ok('revisão F2: a faixa da sombra compara a MESMA população (anúncios ativos e pausados dos produtos com anúncio ativo); o estoque dos pausados vem à parte', async () => {
    semear('Pausa', [item('MLB31', { user_product_id: 'MLBU31', available_quantity: 10, attributes: [{ id: 'SELLER_SKU', value_name: 'S1' }] }),
      item('MLB32', { user_product_id: 'MLBU32', available_quantity: 8000, status: 'paused', attributes: [{ id: 'SELLER_SKU', value_name: 'S1' }] })], { MLB31: 1, MLB32: 0 })
    const [, j] = await get('/api/cliente/produtos?cliente=Pausa'), e = j.sombra.estoque
    assert.deepEqual([e.soma_por_anuncio, e.contado_uma_vez, e.em_pausados], [8010, 8010, 8000]); assert.equal(j.resumo.anuncios_ativos, 1)
  })
} finally { srv.close() }
console.log(`\n✔ teste-produto-rotas: ${n} casos`)
