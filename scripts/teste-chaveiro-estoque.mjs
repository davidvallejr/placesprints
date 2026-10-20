// V3 F6 — sincronismo de estoque pelo Chaveiro (docs/desenho-v3-erp.md § A). Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports); a API do ML é SEMPRE um stub
// injetado (nenhuma chamada real). Cobre: núcleo puro (segurança em dias × venda prevista, nunca zera pela segurança, 0 só com físico 0, divisão Σ = alvo, Full fora,
// lerStock/payload/classes/conferência), prévia por anúncio, travas (chave global, kill switch, liberação líder + cliente informado, estreia em 1 produto, confirmar === true,
// hash, físico vencido), fluxo completo multiorigem (x-version, doador primeiro, conferência em todos os irmãos), conta simples (PUT /items), releitura divergente = nada
// escrito, 409 relê 1×, aviso antes de escrever 0, 429 com backoff, exec_evento append-only, regra do plano (assistido com a chave desligada), marco e rotas.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db, hojeLocal, agora, setEstado } = await import('../src/lib/db.js')
const { addDias } = await import('../src/lib/meli-serie.js')
const CE = await import('../src/lib/chaveiro-estoque.js')
const SR = await import('../src/lib/chaveiro-estoque-real.js')
const { montarAcoes } = await import('../src/lib/plano-anuncios.js')
const { algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { criarRotasChaveiroEstoque } = await import('../src/rotas-chaveiro-estoque.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')
assert.equal(CE.CFG.sync_estoque_ligado, false, 'a chave global NASCE desligada no config')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = hojeLocal(), D = k => addDias(HOJE, k), C = 'Loja Sync', LIDER = 'Lia Lider', LIGADO = { ...CE.CFG, sync_estoque_ligado: true }
db.prepare("INSERT INTO prestadores (nome, nome_norm, cargo, atualizado_em) VALUES (?, ?, 'Líder de squad', ?)").run(LIDER, 'lia lider', agora())
db.prepare("INSERT INTO prestadores (nome, nome_norm, cargo, atualizado_em) VALUES ('Ana Analista', 'ana analista', 'Analista', ?)").run(agora())

function semear(cliente, { declarado = 50, horas = 2, estoques = [40, 40, 40] } = {}) {
  const T = new Date(Date.now() - 3 * 3_600_000).toISOString(), ins = db.prepare('INSERT OR REPLACE INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, sku, sku_fonte, estoque, logistica, tags, status, lido_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  ins.run(cliente, 'MLB1', '', 'MLBU1', 'COL-M', 'seller_sku', estoques[0], 'xd_drop_off', '', 'active', T)
  ins.run(cliente, 'MLB2', '', 'MLBU1', '', '', estoques[1], 'xd_drop_off', '', 'active', T)                           // catálogo: mesmo UP, sem SKU
  ins.run(cliente, 'MLB3', '', 'MLBU3', 'COL-M', 'seller_sku', estoques[2], 'xd_drop_off', '', 'active', T)
  ins.run(cliente, 'MLB4', '', 'MLBU4', 'COL-M', 'seller_sku', 9, 'fulfillment', '', 'active', T)                       // Full: fora
  for (const id of ['MLB1', 'MLB2', 'MLB3', 'MLB4']) db.prepare("INSERT OR REPLACE INTO meli_item (cliente, item_id, titulo, status, atualizado_em) VALUES (?,?,?,?,?)").run(cliente, id, `Coleira M ${id}`, 'active', T)
  const s = db.prepare('INSERT OR REPLACE INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)')
  for (let k = 1; k <= 28; k++) { s.run(cliente, 'MLB1', D(-k), 1, 50); s.run(cliente, 'MLB2', D(-k), 1, 50); s.run(cliente, 'MLB3', D(-k), k % 2, 25 * (k % 2)) }
  db.prepare("INSERT OR REPLACE INTO produto_estoque_declarado (cliente, sku, quantidade, fonte, por, em) VALUES (?, 'col-m', ?, 'cliente', ?, ?)").run(cliente, declarado, LIDER, new Date(Date.now() - horas * 3_600_000).toISOString())
}
semear(C)

// stub da API do ML: estado vivo por UP/anúncio; registra toda chamada
function stubML({ wm = true, stock = { MLBU1: 40, MLBU3: 40 }, pedidos = [], falhaPut = {}, xv = { MLBU1: 7, MLBU3: 3 } } = {}) {
  const chamadas = [], est = { ...stock }, item = id => ({ MLB1: 'MLBU1', MLB2: 'MLBU1', MLB3: 'MLBU3' }[id])
  const api = {
    chamadas, est,
    get: async (_c, caminho) => { chamadas.push(`GET ${caminho}`)
      if (caminho.startsWith('/users/')) return { status: 200, corpo: { id: 99, tags: wm ? ['normal', 'warehouse_management'] : ['normal'] }, headers: {} }
      let m = caminho.match(/^\/user-products\/(MLBU\d+)\/stock$/)
      if (m) return { status: 200, corpo: { locations: [{ type: 'seller_warehouse', store_id: '861', network_node_id: 'BRP1', quantity: est[m[1]] }] }, headers: { 'x-version': String(xv[m[1]]) } }
      m = caminho.match(/^\/items\/(MLB\d+)\?/)
      if (m) return { status: 200, corpo: { id: m[1], status: 'active', sub_status: [], available_quantity: est[item(m[1])] }, headers: {} }
      if (caminho.startsWith('/orders/search')) return { status: 200, corpo: { results: pedidos }, headers: {} }
      return { status: 404, corpo: null, headers: {} } },
    put: async (_c, caminho, corpo, headers) => { chamadas.push(`PUT ${caminho} ${JSON.stringify(corpo)} ${JSON.stringify(headers || {})}`)
      const f = falhaPut[caminho]; if (f) { const st = Array.isArray(f) ? f.shift() : f; if (st) return { status: st, corpo: null, headers: {} } }
      let m = caminho.match(/^\/user-products\/(MLBU\d+)\/stock\/type\/seller_warehouse$/)
      if (m) { if (String(headers['x-version']) !== String(xv[m[1]])) return { status: 409, corpo: null, headers: {} }; est[m[1]] = corpo.stock[0].quantity; xv[m[1]]++; return { status: 200, corpo: {}, headers: { 'x-version': String(xv[m[1]]) } } }
      m = caminho.match(/^\/items\/(MLB\d+)$/)
      if (m) { est[item(m[1])] = corpo.available_quantity; return { status: 200, corpo: {}, headers: {} } }
      return { status: 400, corpo: null, headers: {} } },
  }
  return api
}
const puts = api => api.chamadas.filter(c => c.startsWith('PUT'))
const deps = api => ({ api, integracao: async () => true, seller: () => '99', cfg: LIGADO })

await ok('núcleo: segurança = ceil(dias × venda prevista); alvo = físico − segurança; a segurança NUNCA zera (só corta até o físico); 0 só com físico 0 (com aviso); Σ = alvo; tolerância', () => {
  assert.equal(CE.segurancaUn(2.5, 2), 5); assert.equal(CE.segurancaUn(0, 2), 0)
  const p = CE.planejarSync({ fisico: 50, seguranca: 5, vBase: 2.5, pools: [{ chave: 'a', v: 2, mostrado: 40 }, { chave: 'b', v: 0.5, mostrado: 40 }] })
  assert.deepEqual(p.pools.map(x => x.para), [36, 9]); assert.equal(p.alvo_total, 45); assert.ok(p.escreve && p.risco_vender_sem_estoque)
  const c = CE.planejarSync({ fisico: 3, seguranca: 5, vBase: 2.5, pools: [{ chave: 'a', v: 1, mostrado: 10 }] })
  assert.equal(c.alvo_total, 3, 'segurança maior que o físico: corta até o físico, nunca zera'); assert.ok(c.seguranca_consumida); assert.ok(c.aviso_zerar, 'vai zerar em ~1 dia: aviso')
  const z = CE.planejarSync({ fisico: 0, seguranca: 5, vBase: 2.5, pools: [{ chave: 'a', v: 1, mostrado: 4 }] }); assert.equal(z.pools[0].para, 0); assert.equal(z.aviso_zerar.zera, true)
  const t = CE.planejarSync({ fisico: 100, seguranca: 5, vBase: 1, pools: [{ chave: 'a', v: 1, mostrado: 94 }] }); assert.equal(t.escreve, false, '1 un de diferença abaixo do físico: dentro da tolerância')
  assert.equal(CE.planejarSync({ fisico: 10, pools: [], seguranca: 0 }).motivo, 'sem_pool'); assert.equal(CE.planejarSync({ fisico: 10, pools: [{ chave: 'a', v: 1, mostrado: 1 }], regra: { nao_escrever: true } }).escreve, false)
  const mx = CE.planejarSync({ fisico: 50, seguranca: 0, pools: [{ chave: 'a', v: 9, mostrado: 0 }, { chave: 'b', v: 1, mostrado: 0 }], regra: { maximo_por_anuncio: 20 } }); assert.ok(mx.pools.every(x => x.para <= 20), 'máximo por anúncio')
})

await ok('núcleo: lerStock (Full/Flex independente/multi-depósito recusam; x-version), payload por tipo de conta (lista fechada), classes HTTP, conferência e coerência com a prévia', () => {
  assert.equal(CE.lerStock({ locations: [{ type: 'seller_warehouse', store_id: 1, quantity: 5 }, { type: 'meli_facility', quantity: 3 }] }).recusa, 'full')
  assert.equal(CE.lerStock({ locations: [{ type: 'seller_warehouse', store_id: 1, quantity: 5 }, { type: 'seller_warehouse', store_id: 2, quantity: 1 }] }).recusa, 'multi_deposito')
  assert.equal(CE.lerStock({ locations: [{ type: 'seller_warehouse', store_id: 1, quantity: 5 }, { type: 'selling_address', quantity: 2 }] }).recusa, 'full', 'Flex independente fora')
  const s = CE.lerStock({ locations: [{ type: 'seller_warehouse', store_id: '861', network_node_id: 'N', quantity: 7 }] }, { 'x-version': '12' }); assert.deepEqual([s.proprio, s.x_version, s.recusa], [7, '12', ''])
  assert.equal(CE.lerStock({ locations: [{ type: 'seller_warehouse' }] }), null, 'fora do formato = null, nunca 0')
  const pool = { up: 'MLBU1', itens: [{ item_id: 'MLB1', variacao_id: '' }] }
  assert.deepEqual(CE.payloadDoPool(pool, 5, { multiorigem: true, x_version: '7', local: { store_id: '861', network_node_id: 'N' } }), { metodo: 'PUT', caminho: '/user-products/MLBU1/stock/type/seller_warehouse', headers: { 'x-version': '7' }, corpo: { stock: [{ store_id: '861', network_node_id: 'N', quantity: 5 }] } })
  assert.equal(CE.payloadDoPool(pool, 5, { multiorigem: true }), null, 'sem x-version não há escrita')
  assert.deepEqual(CE.payloadDoPool(pool, 5).corpo, { available_quantity: 5 }); assert.deepEqual(CE.payloadDoPool({ up: 'U', itens: [{ item_id: 'MLB9', variacao_id: '123' }] }, 2, { variacoes: ['123', '124'] }).corpo, { variations: [{ id: 123, available_quantity: 2 }, { id: 124 }] }, 'variação: só a do pool com quantidade; as irmãs vão por id (senão o ML as remove)')
  assert.equal(CE.payloadDoPool({ up: 'U', itens: [{ item_id: 'MLB9', variacao_id: '123' }] }, 2), null, 'sem a lista de variações lida ao vivo: nenhuma escrita')
  assert.throws(() => CE.payloadDoPool(pool, -1))
  assert.deepEqual([200, 409, 429, 403, 400, 500, 0].map(CE.classificarStatus), ['enviado', 'conflito', 'limite', 'permissao', 'payload', 'incerto', 'incerto'])
  assert.equal(CE.conferirPool({ esperado: 9, lido: 9 }), 'confere'); assert.equal(CE.conferirPool({ esperado: 9, lido: 8, vendasDesde: 1 }), 'confere'); assert.equal(CE.conferirPool({ esperado: 9, lido: 10 }), 'divergente'); assert.equal(CE.conferirPool({ esperado: 9, lido: 5 }), 'aguardando')
  assert.ok(CE.conferePrevia({ de: 40, lido: 38, vendasDesde: 2 })); assert.ok(!CE.conferePrevia({ de: 40, lido: 41 }), 'alguém subiu no painel'); assert.ok(!CE.conferePrevia({ de: 40, lido: 30, vendasDesde: 2 }))
})

await ok('pools do SKU: anúncio + VARIAÇÃO com o SKU, irmão do mesmo UP sem SKU, Full fora, recusa tira; 3 variações em 3 UPs = 3 pools', () => {
  const a = (item_id, o) => ({ item_id, variacao_id: '', user_product_id: '', sku: '', sku_fonte: '', estoque: 5, logistica: 'xd_drop_off', status: 'active', ...o })
  const r = CE.poolsDoSku({ sku: 'COL-M', arestas: [a('MLB1', { user_product_id: 'U1', sku: 'col-m', sku_fonte: 'seller_sku' }), a('MLB2', { user_product_id: 'U1' }), a('MLB4', { user_product_id: 'U4', sku: 'COL-M', sku_fonte: 'seller_sku', logistica: 'fulfillment' }), a('MLB5', { user_product_id: 'U5', sku: 'COL-M', sku_fonte: 'seller_custom_field' }), a('MLB6', { user_product_id: 'U6', sku: 'COL-M', sku_fonte: 'seller_sku', tags: 'bundle' })] })
  assert.deepEqual(r.pools.map(p => [p.chave, p.itens.length]), [['up:U1', 2]]); assert.deepEqual(r.fora, [{ chave: 'up:U4', motivo: 'full' }, { chave: 'up:U6', motivo: 'kit_virtual' }], 'Full e Kit Virtual nunca'); assert.ok(!r.pools.some(p => p.chave === 'up:U5'), 'seller_custom_field nunca agrupa')
  const v = CE.poolsDoSku({ sku: 'P', arestas: ['1', '2', '3'].map(k => a('MLB9', { variacao_id: k, user_product_id: 'UV' + k, sku: 'P', sku_fonte: 'variacao' })) })
  assert.equal(v.pools.length, 3)
  const rc = CE.poolsDoSku({ sku: 'COL-M', arestas: [a('MLB1', { user_product_id: 'U1', sku: 'COL-M', sku_fonte: 'seller_sku' })], vinculos: [{ origem: 'up:U1', produto: 'sku:col-m', tipo: 'recusado' }] }); assert.equal(rc.pools.length, 0)
})

await ok('prévia por anúncio (só leitura): físico 50 − 0 vendas − segurança 5 (2 d × 2,5/dia) = 45 → MLB1 36 (escreve) · MLB2 36 (o ML replica) · MLB3 9; Full fora; nenhuma ordem gravada', () => {
  const p = SR.previaSync(C)
  const pr = p.produtos[0]; assert.equal(pr.situacao, 'escreveria'); assert.equal(pr.seguranca, 5); assert.equal(pr.plano.alvo_total, 45); assert.equal(pr.fora.length, 1)
  assert.deepEqual(p.linhas.map(l => [l.anuncio, l.para, l.escrita]), [['MLB1', 36, 'escreve'], ['MLB2', 36, 'replica'], ['MLB3', 9, 'escreve']])
  assert.equal(p.ligado, false); assert.equal(db.prepare('SELECT COUNT(*) n FROM exec_ordem').get().n, 0)
  assert.ok(p.premissas.some(t => /nunca o número do anúncio/.test(t)))
})

await ok('travas: chave global DESLIGADA (config) → nada sai, zero chamada ao ML; preparar sem confirmar = prévia; com confirmar exige líder/consultor/CS', async () => {
  assert.equal(SR.prepararOrdens(C).previa, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM exec_ordem').get().n, 0)
  assert.throws(() => SR.prepararOrdens(C, { por: 'Ninguém', confirmar: true }), e => e.status === 403)
  const r = SR.prepararOrdens(C, { por: LIDER, confirmar: true }); assert.equal(r.criadas.length, 1)
  const o = db.prepare('SELECT * FROM exec_ordem').get(); assert.equal(o.estado, 'aguardando_aprovacao'); assert.equal(o.adaptador, 'ml_estoque')
  assert.equal(SR.prepararOrdens(C, { por: LIDER, confirmar: true }).criadas.length, 1); assert.equal(db.prepare('SELECT COUNT(*) n FROM exec_ordem').get().n, 1, 'idempotente: a mesma prévia não duplica a ordem')
  const api = stubML(), x = await SR.executarOrdem(C, o.id, { por: LIDER, confirmar: true, api, integracao: async () => true, seller: () => '99' })
  assert.equal(x.executado, false); assert.ok(x.motivos.includes(CE.MOTIVOS.chave_global)); assert.equal(api.chamadas.length, 0, 'nenhuma chamada ao ML')
})

await ok('travas com a chave ligada: sem liberação → recusa; liberação exige líder + cliente informado + SKU com físico; estreia: 2º produto e executar_e_avisar recusados antes de 10 conferidas', async () => {
  const o = db.prepare('SELECT id FROM exec_ordem').get(), api = stubML()
  const x = await SR.executarOrdem(C, o.id, { por: LIDER, confirmar: true, ...deps(api) }); assert.ok(x.motivos.includes(CE.MOTIVOS.sem_politica)); assert.equal(api.chamadas.length, 0)
  assert.throws(() => SR.liberarCliente(C, { por: 'Ana Analista', cliente_informado: true, produto: 'COL-M', confirmar: true }), e => e.status === 403, 'analista não libera')
  assert.throws(() => SR.liberarCliente(C, { por: LIDER, produto: 'COL-M', confirmar: true }), /cliente_informado/)
  assert.equal(SR.liberarCliente(C, { por: LIDER, cliente_informado: true, produto: 'COL-M' }).previa, true); assert.equal(SR.politicaDe(C), null, 'prévia não grava')
  const l = SR.liberarCliente(C, { por: LIDER, cliente_informado: true, produto: 'COL-M', confirmar: true }); assert.deepEqual([l.produtos, l.max_ordens_dia], [['col-m'], 1])
  db.prepare("INSERT INTO produto_estoque_declarado (cliente, sku, quantidade, fonte, por, em) VALUES (?, 'outro', 5, 'equipe', ?, ?)").run(C, LIDER, agora())
  assert.throws(() => SR.liberarCliente(C, { por: LIDER, cliente_informado: true, produto: 'OUTRO', confirmar: true }), e => e.status === 409)
  assert.throws(() => SR.liberarCliente(C, { por: LIDER, cliente_informado: true, produto: 'COL-M', nivel: 'executar_e_avisar', confirmar: true }), e => e.status === 409)
  const y = await SR.executarOrdem(C, o.id, { por: LIDER, confirmar: 'true', ...deps(api) }); assert.ok(y.motivos.includes(CE.MOTIVOS.confirmar), '"true" texto não confirma'); assert.equal(api.chamadas.length, 0)
  await assert.rejects(SR.executarOrdem(C, o.id, { por: 'Ana Analista', confirmar: true, ...deps(api) }), e => e.status === 403, 'só o líder executa')
})

await ok('fluxo multiorigem: lê /users (warehouse_management), /stock com x-version e todos os irmãos; escreve PRIMEIRO quem diminui, com x-version; em conferência; conferência em TODOS os irmãos → executada; exec_evento append-only', async () => {
  const o = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aguardando_aprovacao'").get(), api = stubML()
  const x = await SR.executarOrdem(C, o.id, { por: LIDER, confirmar: true, ...deps(api) })
  assert.equal(x.executado, true, JSON.stringify(x)); assert.deepEqual(x.enviados.map(e => [e.pool, e.de, e.para]), [['up:MLBU3', 40, 9], ['up:MLBU1', 40, 36]], 'o que mais diminui primeiro')
  const p = puts(api); assert.equal(p.length, 2, 'catálogo + clássico no mesmo UP = 1 escrita'); assert.ok(p.every(c => /seller_warehouse/.test(c) && /x-version/.test(c)))
  assert.ok(!p.some(c => /MLBU4/.test(c)), 'Full nunca')
  assert.equal(db.prepare('SELECT estado FROM exec_ordem WHERE id = ?').get(o.id).estado, 'em_conferencia')
  const conf0 = await SR.conferirOrdens({ cliente: C, api, seller: () => '99' }); assert.equal(conf0.conferidas, 0, 'antes de 5 min não confere')
  const conf = await SR.conferirOrdens({ cliente: C, api, seller: () => '99', forcar: true }); assert.equal(conf.resultados[0].veredito, 'confere')
  assert.equal(db.prepare('SELECT estado FROM exec_ordem WHERE id = ?').get(o.id).estado, 'executada')
  assert.ok(api.chamadas.filter(c => c.startsWith('GET /items/MLB2')).length >= 2, 'o irmão do catálogo também é conferido')
  assert.throws(() => db.prepare('UPDATE exec_evento SET por = ?').run('x'), /append-only/); assert.throws(() => db.prepare('DELETE FROM exec_evento').run(), /append-only/)
  const ev = db.prepare("SELECT detalhe_json FROM exec_evento WHERE ordem_id = ? AND detalhe_json LIKE '%x_version_enviado%'").all(o.id); assert.equal(ev.length, 2, 'log por escrita'); assert.ok(!ev.some(e => /Bearer|token/i.test(e.detalhe_json)))
  const t = await SR.executarOrdem(C, o.id, { por: LIDER, confirmar: true, ...deps(api) }); assert.equal(t.executado, false, 'ordem executada não roda de novo')
})

const nova = (cli, o = {}) => { semear(cli, o); db.prepare("INSERT OR REPLACE INTO exec_politica (cliente, nivel, adaptadores_live_json, max_ordens_dia, produtos_json, liberado_por, liberado_em, cliente_informado_por, cliente_informado_em, atualizado_em) VALUES (?, 'executar_com_aprovacao', '{\"ml_estoque\":1}', 5, '[\"col-m\"]', ?, ?, ?, ?, ?)").run(cli, LIDER, agora(), LIDER, agora(), agora()); return SR.prepararOrdens(cli, { por: LIDER, confirmar: true }).criadas[0]?.id }

await ok('teto do dia (estreia: 1 ordem/dia) e releitura ao vivo: alguém SUBIU o estoque no painel desde a prévia → divergente, nada escrito', async () => {
  const id1 = nova('Loja Teto'); db.prepare("UPDATE exec_politica SET max_ordens_dia = 1 WHERE cliente = 'Loja Teto'").run()
  db.prepare("UPDATE exec_ordem SET executado_em = ? WHERE id = ?").run(agora(), 'CH-0000000000')       // nenhum efeito
  db.prepare("INSERT INTO exec_ordem (id, cliente, regra, produto, caminho, adaptador, operacao, chave_idem, estado, executado_em, criado_em, atualizado_em) VALUES ('CH-aaaaaaaaaa', 'Loja Teto', 'estoque_sincronizar', 'col-m', 'automatico', 'ml_estoque', 'alocar', 'x1', 'executada', ?, ?, ?)").run(agora(), agora(), agora())
  const api0 = stubML(), t = await SR.executarOrdem('Loja Teto', id1, { por: LIDER, confirmar: true, ...deps(api0) }); assert.ok(t.motivos.includes(CE.MOTIVOS.teto_dia)); assert.equal(api0.chamadas.length, 0)
  const id = nova('Loja Div'), api = stubML({ stock: { MLBU1: 45, MLBU3: 40 } })
  const x = await SR.executarOrdem('Loja Div', id, { por: LIDER, confirmar: true, ...deps(api) })
  assert.equal(x.estado, 'divergente'); assert.equal(puts(api).length, 0, 'mudança humana nunca é sobrescrita')
})

await ok('vendas desde a informação descontam do físico AO VIVO (alvo recalculado, nunca acima do aprovado); conta simples → PUT /items com available_quantity', async () => {
  const id = nova('Loja Simples'), ped = [{ status: 'paid', date_created: new Date(Date.now() - 60e3).toISOString(), order_items: [{ item: { id: 'MLB1', variation_id: null }, quantity: 10 }] }]
  const api = stubML({ wm: false, stock: { MLBU1: 30, MLBU3: 40 }, pedidos: ped })               // o ML já descontou as 10 do pool U1
  const x = await SR.executarOrdem('Loja Simples', id, { por: LIDER, confirmar: true, ...deps(api) })
  assert.equal(x.executado, true, JSON.stringify(x)); const p = puts(api)
  assert.ok(p.every(c => /^PUT \/items\/MLB[13] \{"available_quantity":\d+\}/.test(c)), 'conta sem multiorigem: PUT no item')
  const soma = x.enviados.reduce((t, e) => t + e.para, 0); assert.ok(soma <= 50 - 10 - 5, 'Σ ≤ físico − vendidas − segurança'); assert.ok(x.enviados.every(e => e.para <= (e.pool === 'up:MLBU1' ? 36 : 9)), 'nunca acima do aprovado')
})

await ok('409 (versão desatualizada): relê e tenta UMA vez; 400 nunca reenvia; 429/5xx no adaptador com backoff (GET) e PUT 5xx sem reenvio', async () => {
  const id = nova('Loja 409'), api = stubML({ falhaPut: { '/user-products/MLBU3/stock/type/seller_warehouse': [409] } })
  const x = await SR.executarOrdem('Loja 409', id, { por: LIDER, confirmar: true, ...deps(api) }); assert.equal(x.executado, true)
  assert.equal(puts(api).filter(c => /MLBU3/.test(c)).length, 2, '1 conflito + 1 nova tentativa com a versão relida')
  const id2 = nova('Loja 400'), api2 = stubML({ falhaPut: { '/user-products/MLBU3/stock/type/seller_warehouse': 400 } })
  const y = await SR.executarOrdem('Loja 400', id2, { por: LIDER, confirmar: true, ...deps(api2) }); assert.equal(y.estado, 'falhou'); assert.equal(puts(api2).length, 1, '400: nada mais é enviado (nem o pool que aumentaria)')
  let k = 0; const fetchFn = async (_u, o) => { k++; const st = k <= 2 ? 429 : 200; return { status: st, text: async () => '{"ok":1}', headers: { get: () => (st === 200 ? '5' : null) } } }
  const real = SR.criarApiEstoque({ fetchFn, tokenValido: async () => 't', espera: 1 }), g = await real.get('c', '/x'); assert.deepEqual([g.status, g.headers['x-version'], k], [200, '5', 3])
  let m = 0; const f5 = async () => { m++; return { status: 503, text: async () => '', headers: { get: () => null } } }
  const r5 = await SR.criarApiEstoque({ fetchFn: f5, tokenValido: async () => 't', espera: 1 }).put('c', '/items/MLB1', { available_quantity: 1 }); assert.deepEqual([r5.status, m], [503, 1], 'PUT 5xx: sem reenvio')
})

await ok('aviso antes de escrever 0: a preparação já avisa (sino do Chaveiro); ordem sem aviso registrado só avisa na 1ª execução e escreve 0 na seguinte', async () => {
  const id = nova('Loja Zero', { declarado: 0, estoques: [4, 4, 2] }), api = stubML({ stock: { MLBU1: 4, MLBU3: 2 } })
  assert.ok(db.prepare('SELECT aviso_em FROM exec_ordem WHERE id = ?').get(id).aviso_em, 'aviso registrado ao preparar')
  assert.match(db.prepare("SELECT titulo FROM notificacoes WHERE tipo = 'sync_estoque_aviso' AND cliente = 'Loja Zero'").get().titulo, /^Chaveiro · estoque vai zerar/)
  db.prepare("UPDATE exec_ordem SET aviso_em = '' WHERE id = ?").run(id)                                  // simula ordem sem aviso
  const a = await SR.executarOrdem('Loja Zero', id, { por: LIDER, confirmar: true, ...deps(api) })
  assert.equal(a.executado, false); assert.ok(a.motivos.includes(CE.MOTIVOS.aviso_zerar)); assert.equal(api.chamadas.length, 0, 'só avisa: nada vai ao ML')
  const b = await SR.executarOrdem('Loja Zero', id, { por: LIDER, confirmar: true, ...deps(api) }); assert.equal(b.executado, true, JSON.stringify(b)); assert.ok(b.enviados.every(e => e.para === 0))
})

await ok('kill switch: parar cancela a fila e nenhuma execução passa; retomar volta; físico vencido (> 24 h) não escreve', async () => {
  const id = nova('Loja Kill'); assert.throws(() => SR.pararSync({ por: 'Ana Analista', confirmar: true }), e => e.status === 403)
  assert.equal(SR.pararSync({ por: LIDER }).previa, true); SR.pararSync({ por: LIDER, confirmar: true })
  assert.equal(db.prepare('SELECT estado FROM exec_ordem WHERE id = ?').get(id).estado, 'cancelada')
  const api = stubML(), x = await SR.executarOrdem('Loja Kill', id, { por: LIDER, confirmar: true, ...deps(api) }); assert.equal(x.executado, false); assert.equal(api.chamadas.length, 0)
  assert.deepEqual(await SR.tickEstoque({ api, cfg: LIGADO }), { ligado: false }, 'tick sai no 1º if')
  SR.retomarSync({ por: LIDER, confirmar: true }); assert.equal(SR.parado(), false)
  const idV = nova('Loja Velha', { horas: 30 }); assert.equal(idV, undefined, 'físico de 30 h: nenhuma ordem nasce'); assert.equal(SR.previaSync('Loja Velha').produtos[0].situacao, 'divergente', 'físico de 30 h (50 un) × ML 80 un: pede contagem (estoque_divergente)')
})

await ok('regra do plano (Arquiteto) sobre a MESMA prévia: estoque_sincronizar nasce com caminho ASSISTIDO (chave desligada) e entidade produto; sem diag.sync_estoque nada nasce; divergente = pendência do cliente', () => {
  semear('Loja Plano'); const sp = SR.syncParaPlano('Loja Plano'); assert.equal(sp.sincronizar.length, 1); assert.equal(sp.liberado, false)
  const it = id => ({ id, titulo: `Coleira M ${id}`, permalink: `https://produto.mercadolivre.com.br/MLB-${id.slice(3)}`, status: 'active', curva: 'A', u: 28, r: 1400, u0: 28, r0: 1400, v: 300, v0: 300, conv: 9.3, preco: 50, estoque: 40, vel_dia: 1, cobertura: 40, ponto_reposicao: 28, lead_time_dias: 21, lead_time_fonte: 'premissa', fotos: 8, frete_gratis: true, catalogo: false, ads: null, logistica: 'xd_drop_off' })
  const itens = ['MLB1', 'MLB2', 'MLB3'].map(it), gmv = 4200
  const diag = { disponivel: true, cliente: 'Loja Plano', hoje: HOJE, periodo: { de: D(-28), ate: D(-1), anterior: { de: D(-56), ate: D(-29) } }, resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, curvas: {} }, benchmark: null, ads: { custo: 0, receita: 0, roas: null, acos: null, anterior: {} }, economia: null, custos_informados: true, itens, janelas: [], pendencias: [], vendas_dia_sem_mudanca: {}, data_quality: { cobertura: { pedidos: { lacunas: [], truncados: 0 } } } }
  assert.ok(!montarAcoes('Loja Plano', diag, { hoje: HOJE }).some(a => /estoque_sincronizar/.test(a.regra)), 'sem a prévia anexada (chave do produto desligada) nada nasce')
  const a = montarAcoes('Loja Plano', { ...diag, sync_estoque: sp }, { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_sincronizar')
  assert.ok(a); assert.equal(a.dados.execucao.caminho, 'assistido'); assert.equal(a.dados.execucao.adaptador, 'ml_estoque'); assert.equal(a.dados.entidade.tipo, 'produto'); assert.match(a.dados.como[0], /Ajustar no painel/)
  const d = montarAcoes('Loja Plano', { ...diag, sync_estoque: { sincronizar: [], divergente: sp.sincronizar, liberado: false } }, { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_divergente')
  assert.equal(d.dados.execucao.caminho, 'cliente')
})

await ok('marco sync_estoque (Merovíngio): antes × depois da 1ª escrita conferida, tratados × controle, rótulo de associação; sem escrita = sem_marco', () => {
  assert.equal(SR.marcoSyncEstoque('Loja Plano').estado, 'sem_marco')
  const m = SR.marcoSyncEstoque(C); assert.equal(m.estado, 'em_maturacao'); assert.ok(m.tratado.antes.unidades > 0); assert.match(m.rotulo, /não prova de causa/)
  const p = CE.medirSyncEstoque({ tratado: { antes: { dias_sem_estoque: 6, cancelados: 3, unidades: 50 }, depois: { dias_sem_estoque: 1, cancelados: 0, unidades: 60 }, completo: true }, controle: { antes: { dias_sem_estoque: 2, cancelados: 1, unidades: 40 }, depois: { dias_sem_estoque: 2, cancelados: 1, unidades: 42 }, completo: true }, N: 28 })
  assert.deepEqual(p.efeito, { dias_sem_estoque: -5, cancelados: -3, unidades: 8 }); assert.equal(p.estado, 'medido')
})

await ok('rotas: prospect 400, fora da central 404, sem JSON 415, prévia por padrão, ordem inválida 400, confirmar repassado cru', async () => {
  const visto = []
  const sync = { ...SR, previaSync: c => ({ cliente: c, produtos: [] }), executarOrdem: async (c, o, x) => { visto.push(x.confirmar); return { executado: false } }, prepararOrdens: (c, x) => ({ previa: x.confirmar !== true }) }
  const app = express(); app.use(express.json()); app.use(criarRotasChaveiroEstoque({ sync, clienteCanonico: c => (c === C ? C : '') }))
  const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}`
  const post = (u, b, ct = 'application/json') => fetch(base + u, { method: 'POST', headers: { 'Content-Type': ct }, body: JSON.stringify(b) })
  try {
    assert.equal((await post('/api/chaveiro/estoque/previa', { cliente: '[Comercial] X' })).status, 400)
    assert.equal((await post('/api/chaveiro/estoque/previa', { cliente: 'Outra' })).status, 404)
    assert.equal((await post('/api/chaveiro/estoque/previa', { cliente: C }, 'text/plain')).status, 415)
    assert.equal((await (await post('/api/chaveiro/estoque/preparar', { cliente: C })).json()).previa, true)
    const r = await post('/api/chaveiro/estoque/executar', { cliente: C, ordem: 'X<script>' }); assert.equal(r.status, 400); assert.doesNotMatch(await r.text(), /script/)
    await post('/api/chaveiro/estoque/executar', { cliente: C, ordem: 'CH-0123456789', confirmar: 'true' }); assert.deepEqual(visto, ['true'])
    assert.equal((await fetch(`${base}/api/chaveiro/estoque/ordens?cliente=${encodeURIComponent(C)}`)).status, 200)
  } finally { srv.close() }
})

console.log(`✔ teste-chaveiro-estoque: ${n} casos (V3 F6; chave chaveiro.sync_estoque_ligado segue DESLIGADA no config; API do ML só em stub)`)
