// Autoteste da saúde da conta gravada (fase 1): banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports) + api stub. Nunca abre data/db.sqlite, nada de rede.
// Cobre: 200 normal grava 1 linha/dia + listas; 403 em perguntas → pendente 'permissao_do_app' e coluna NULL; 5xx → 'indisponivel' (nunca 0); paginação com teto;
// idempotência do upsert (2 coletas no mesmo dia = 1 linha); atraso de despacho pelo prazo do envio; campo do prazo ausente → 'endpoint_nao_verificado'; Full com estimativa pela série;
// lerSaude sem linha; rotas (GET/POST, prospect 400, 415). Rodar: node scripts/teste-saude-coleta.mjs
process.env.PS_DB_MEMORIA = '1'
globalThis.fetch = () => Promise.reject(new Error('rede bloqueada no teste'))
import assert from 'node:assert/strict'
const { db } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { coletarSaude, lerSaude, coletarSaudeTodos, CFG_SAUDE } = await import('../src/lib/saude-coleta.js')
const { criarRotasSaude } = await import('../src/rotas-saude.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-09', CLI = 'Conta Saúde'
db.prepare("INSERT INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 777, 'x', 'x', '2026-12-01', 'read offline_access', '2026-01-01', '2026-10-09T04:00:00.000Z')").run(CLI)
gravarItens(CLI, [{ id: 'MLB1', title: 'Full', price: 100, available_quantity: 10, pictures: [], shipping: { logistic_type: 'fulfillment' }, status: 'active' }, { id: 'MLB2', title: 'Normal', price: 50, available_quantity: 10, pictures: [], shipping: {}, status: 'active' }], { t: '2026-10-09T05:00:00.000Z', dia: HOJE })
db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)').run(CLI, 'MLB1', addDias(HOJE, -70), 1, 100, 10)

const ONTEM_ISO = new Date(Date.now() - 30 * 3600e3).toISOString(), AGORA_ISO = new Date().toISOString()
// stub da API: respostas por prefixo de caminho; `falhas` força { _erro, status }; `chamadas` registra os caminhos
function stub({ falhas = {}, perguntas = 2, claims = [], pedidos = [], envios = {}, prazo = true, paginasPedidos = 1 } = {}) {
  const chamadas = []
  const api = async (_c, caminho) => {
    chamadas.push(caminho)
    for (const [pref, st] of Object.entries(falhas)) if (caminho.startsWith(pref)) return { _erro: true, status: st }
    if (caminho.startsWith('/users/')) return { seller_reputation: { level_id: '5_green', power_seller_status: 'platinum', metrics: { sales: { period: '60 days', completed: 120 }, claims: { rate: 0.012 }, delayed_handling_time: { rate: 0.03 }, cancellations: { rate: 0 } } } }
    if (caminho.startsWith('/questions/search')) return { total: perguntas, questions: Array.from({ length: perguntas }, (_, i) => ({ id: 100 + i, item_id: 'MLB2', text: 'Tem em estoque? ' + i, date_created: i === 0 ? ONTEM_ISO : AGORA_ISO })) }
    if (caminho.startsWith('/post-purchase/v2/claims/search')) return { paging: { total: claims.length }, data: claims }
    if (caminho.startsWith('/orders/search')) { const off = Number(new URL('http://x' + caminho).searchParams.get('offset')), lim = CFG_SAUDE.pagina; return { paging: { total: paginasPedidos * lim }, results: off / lim < paginasPedidos ? Array.from({ length: lim }, (_, i) => pedidos[0] ? { ...pedidos[0], id: off + i, shipping: { id: 'S' + (off + i) } } : { id: off + i, shipping: null }) : [] } }
    if (caminho.startsWith('/shipments/')) { const id = caminho.split('/')[2]; return envios[id] || { status: 'shipped' } }
    if (caminho.startsWith('/items/bulk?ids=')) return [{ id: 'MLB1', status_code: 200, body: { id: 'MLB1', inventory_id: 'INV1' } }]
    if (caminho.startsWith('/inventories/')) return { available_quantity: 7, not_available_quantity: 1 }
    throw new Error('caminho inesperado no stub: ' + caminho)
  }
  return { api, chamadas }
}
const linha = () => db.prepare('SELECT * FROM meli_conta_saude WHERE cliente = ? AND dia = ?').get(CLI, HOJE)
const pend = l => JSON.parse(l.pendente_json)

await ok('200 normal: 1 linha do dia com reputação em %, perguntas (abertas e >24h), reclamações, atrasos 0 (pedidos todos despachados) e Full com estimativa pela série + idade pendente', async () => {
  const claims = [{ id: 'C1', type: 'mediations', stage: 'claim', status: 'opened', reason_id: 'PNR', date_created: ONTEM_ISO, resource: 'order', resource_id: 9001 }, { id: 'C2', type: 'mediations', stage: 'dispute', status: 'opened', date_created: ONTEM_ISO }, { id: 'C3', status: 'closed', stage: 'claim', date_created: ONTEM_ISO, last_updated: AGORA_ISO }]
  const { api, chamadas } = stub({ claims, pedidos: [{ status: 'paid', order_items: [{ item: { id: 'MLB2' } }] }] })
  const r = await coletarSaude(CLI, { api, hoje: HOJE })
  assert.equal(r.coletada, true); assert.deepEqual(r.pendente, {})
  const l = linha()
  assert.equal(l.level_id, '5_green'); assert.equal(l.power_seller, 'platinum'); assert.equal(l.taxa_claims, 1.2); assert.equal(l.taxa_atraso, 3); assert.equal(l.taxa_cancel, 0); assert.equal(l.vendas_periodo, 120)
  assert.equal(l.perguntas_abertas, 2); assert.equal(l.perguntas_24h, 1); assert.equal(l.claims_abertas, 2); assert.equal(l.mediacoes, 1); assert.equal(l.atrasos, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_pergunta WHERE cliente = ?').get(CLI).n, 2)
  const p = db.prepare('SELECT * FROM meli_pergunta WHERE cliente = ? AND question_id = ?').get(CLI, '100')
  assert.equal(p.texto_hash.length, 40); assert.ok(!Object.values(p).some(v => /estoque/.test(String(v))), 'texto da pergunta NUNCA gravado')
  assert.equal(db.prepare("SELECT order_id FROM meli_claim WHERE cliente = ? AND claim_id = 'C1'").get(CLI).order_id, '9001'); assert.ok(db.prepare("SELECT fechado_em FROM meli_claim WHERE claim_id = 'C3'").get().fechado_em)
  const f = db.prepare('SELECT * FROM meli_full_estoque WHERE cliente = ? AND dia = ?').all(CLI, HOJE)
  assert.equal(f.length, 1); assert.equal(f[0].inventory_id, 'INV1'); assert.equal(f[0].disponivel, 7); assert.equal(f[0].nao_disponivel, 1); assert.equal(f[0].dias_sem_venda, 70); assert.equal(f[0].idade_dias, null); assert.equal(f[0].fonte, 'estimativa_serie'); assert.equal(f[0].pendente, 'endpoint_nao_verificado')
  assert.equal(chamadas.filter(c => c.startsWith('/shipments/')).length, CFG_SAUDE.pagina, 'sem shipping.status no pedido, cada envio é lido')
  const s = lerSaude(CLI, { hoje: HOJE })
  assert.equal(s.do_dia, true); assert.equal(s.reputacao.nivel, '5_green'); assert.equal(s.perguntas.mais_de_24h, 1); assert.equal(s.listas.claims.length, 2); assert.equal(s.listas.perguntas.length, 2); assert.equal(s.listas.full.length, 1); assert.equal(s.listas.atrasos.length, 0)
})

await ok('idempotência: segunda coleta no mesmo dia = 1 linha; pergunta que sumiu da lista vira "fechada" (não é apagada, não ganha hora inventada)', async () => {
  const { api } = stub({ perguntas: 1 })
  await coletarSaude(CLI, { api, hoje: HOJE })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_conta_saude WHERE cliente = ?').get(CLI).n, 1)
  assert.equal(linha().perguntas_abertas, 1)
  const fechada = db.prepare("SELECT status, respondido_em FROM meli_pergunta WHERE cliente = ? AND question_id = '101'").get(CLI)
  assert.equal(fechada.status, 'fechada'); assert.equal(fechada.respondido_em, null)
  assert.equal(lerSaude(CLI, { hoje: HOJE }).listas.perguntas.length, 1)
})

await ok('403 em perguntas → pendente.perguntas = permissao_do_app, colunas NULL (nunca 0), o resto do dia gravado normalmente', async () => {
  const { api } = stub({ falhas: { '/questions/search': 403 } })
  const r = await coletarSaude(CLI, { api, hoje: HOJE })
  assert.equal(r.pendente.perguntas, 'permissao_do_app')
  const l = linha(); assert.equal(l.perguntas_abertas, null); assert.equal(l.perguntas_24h, null); assert.equal(l.level_id, '5_green'); assert.equal(l.claims_abertas, 0)
  assert.match(lerSaude(CLI).textos.permissao_do_app, /escopo/)
})

await ok('5xx/timeout → indisponivel em cada bloco (reputação, reclamações, pedidos, Full); nenhum número vira 0 por falha', async () => {
  const { api } = stub({ falhas: { '/users/': 503, '/post-purchase': 500, '/orders/search': 502, '/inventories/': 504 } })
  const r = await coletarSaude(CLI, { api, hoje: HOJE })
  assert.deepEqual(r.pendente, { reputacao: 'indisponivel', reclamacoes: 'indisponivel', atrasos: 'indisponivel', full: 'indisponivel' })
  const l = linha(); for (const k of ['level_id', 'taxa_claims', 'claims_abertas', 'mediacoes', 'atrasos']) assert.equal(l[k], null, k)
  assert.equal(l.perguntas_abertas, 2, 'o bloco que respondeu grava')
  const lanca = async () => { throw new Error('ETIMEDOUT') }
  const r2 = await coletarSaude(CLI, { api: lanca, hoje: HOJE })
  assert.deepEqual(r2.pendente, { reputacao: 'indisponivel', perguntas: 'indisponivel', reclamacoes: 'indisponivel', atrasos: 'indisponivel', full: 'indisponivel' })
})

await ok('atrasos: envio em ready_to_ship com prazo vencido conta e entra em meli_envio_atraso; prazo futuro não conta; envio sem o campo do prazo → endpoint_nao_verificado e atrasos NULL', async () => {
  const pedido = { status: 'paid', order_items: [{ item: { id: 'MLB2' } }] }
  const vencido = new Date(Date.now() - 2 * 86400e3).toISOString(), futuro = new Date(Date.now() + 86400e3).toISOString()
  const envios = { S0: { status: 'ready_to_ship', shipping_option: { estimated_handling_limit: { date: vencido } } }, S1: { status: 'handling', shipping_option: { estimated_handling_limit: { date: futuro } } } }
  const { api } = stub({ pedidos: [pedido], envios })
  await coletarSaude(CLI, { api, hoje: HOJE })
  assert.equal(linha().atrasos, 1)
  const a = db.prepare('SELECT * FROM meli_envio_atraso WHERE cliente = ?').all(CLI)
  assert.equal(a.length, 1); assert.equal(a[0].order_id, '0'); assert.equal(a[0].shipment_id, 'S0'); assert.equal(a[0].item_id, 'MLB2'); assert.ok(a[0].dias_atraso >= 1)
  const semCampo = stub({ pedidos: [pedido], envios: { S0: { status: 'ready_to_ship' } } })
  const r = await coletarSaude(CLI, { api: semCampo.api, hoje: HOJE })
  assert.equal(r.pendente.atrasos, 'endpoint_nao_verificado'); assert.equal(linha().atrasos, null)
  // pedido que já traz shipping.status despachado não gasta chamada de /shipments
  const comStatus = stub({ pedidos: [{ ...pedido, shipping: { id: 'S9', status: 'shipped' } }] })
  // o stub sobrescreve shipping.id; força status no stub por pedido:
  comStatus.api2 = async (c, caminho) => caminho.startsWith('/orders/search') ? { paging: { total: 1 }, results: [{ id: 5, shipping: { id: 'S5', status: 'shipped' } }] } : comStatus.api(c, caminho)
  await coletarSaude(CLI, { api: comStatus.api2, hoje: HOJE })
  assert.equal(linha().atrasos, 0); assert.ok(!comStatus.chamadas.some(c => c.startsWith('/shipments/')))
})

await ok('paginação com teto: pedidos param em teto_paginas.pedidos (fonte_json.atrasos.truncado = true); envios lidos limitados a teto_envios_por_coleta', async () => {
  const { api, chamadas } = stub({ pedidos: [{ status: 'paid' }], paginasPedidos: CFG_SAUDE.teto_paginas.pedidos + 5 })
  await coletarSaude(CLI, { api, hoje: HOJE })
  assert.equal(chamadas.filter(c => c.startsWith('/orders/search')).length, CFG_SAUDE.teto_paginas.pedidos)
  assert.equal(JSON.parse(linha().fonte_json).atrasos.truncado, true)
  assert.ok(chamadas.filter(c => c.startsWith('/shipments/')).length <= CFG_SAUDE.teto_envios_por_coleta)
})

await ok('lerSaude sem linha → dia null, do_dia false, textos presentes; prospect → erro 400; conta sem conexão → coletada:false; coletarSaudeTodos percorre as conexões em coleta e isola falhas', async () => {
  const v = lerSaude('Sem coleta'); assert.equal(v.dia, null); assert.equal(v.do_dia, false); assert.ok(v.textos.sem_coleta)
  await assert.rejects(coletarSaude('[Comercial] Loja · 1', { api: stub().api }), e => e.status === 400)
  assert.equal((await coletarSaude('Sem conexão', { api: stub().api })).coletada, false)
  db.prepare("INSERT INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES ('Outra', 778, 'x', 'x', '2026-12-01', '', '2026-01-01', '2026-10-09T04:00:00.000Z')").run()
  const logs = []
  const r = await coletarSaudeTodos({ api: async (c, p) => { if (c === 'Outra') throw new Error('boom'); return stub().api(c, p) }, hoje: HOJE, log: (n, m) => logs.push(m) })
  assert.equal(r.ok, 2); assert.equal(r.falhas, 0, 'rede caída vira pendente, não falha')   // isolamento: a conta com rede caída grava o dia com tudo pendente e a outra segue normal
  assert.deepEqual(lerSaude('Outra', { hoje: HOJE }).pendente, { reputacao: 'indisponivel', perguntas: 'indisponivel', reclamacoes: 'indisponivel', atrasos: 'indisponivel', full: 'sem_full' })
  assert.ok(logs.some(m => /Outra \(pendente: /.test(m)) && logs.some(m => /Conta Saúde$/.test(m)))
  assert.equal((await coletarSaudeTodos({ api: stub().api, hoje: HOJE, tetoMs: -1 })).pulados, 2)
})

await ok('rotas: GET devolve lerSaude; POST sem JSON = 415; prospect = 400 fixo; POST coleta e devolve a leitura', async () => {
  const express = (await import('express')).default
  const app = express(); app.use(express.json()); app.use(criarRotasSaude({ coletar: (c) => coletarSaude(c, { api: stub().api, hoje: HOJE }) }))
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) }); const base = `http://127.0.0.1:${srv.address().port}`
  const http = await import('node:http')
  const req = (m, path, body, ct = 'application/json') => new Promise((res, rej) => { const q = http.request(base + path, { method: m, headers: body ? { 'content-type': ct } : {} }, r => { let d = ''; r.on('data', x => d += x); r.on('end', () => res({ status: r.statusCode, json: JSON.parse(d || '{}') })) }); q.on('error', rej); q.end(body ? JSON.stringify(body) : undefined) })
  try {
    const g = await req('GET', '/api/cliente/saude?cliente=' + encodeURIComponent(CLI)); assert.equal(g.status, 200); assert.equal(g.json.dia, HOJE)
    assert.equal((await req('GET', '/api/cliente/saude?cliente=' + encodeURIComponent('[Comercial] X · 1'))).status, 400)
    assert.equal((await req('POST', '/api/cliente/saude/atualizar', { cliente: CLI }, 'text/plain')).status, 415)
    const p = await req('POST', '/api/cliente/saude/atualizar', { cliente: CLI }); assert.equal(p.status, 200); assert.equal(p.json.coleta.coletada, true); assert.equal(p.json.reputacao.nivel, '5_green')
    assert.equal((await req('POST', '/api/cliente/saude/atualizar', { cliente: 'Sem conexão' })).status, 400)
  } finally { srv.close() }
})


await ok('Full: dois anúncios com o MESMO inventory_id = um estoque só; "dias sem venda" vem do que vendeu por último (não do anúncio que não vende) e o inventário é lido uma vez', async () => {
  const C2 = 'Conta Inventário Compartilhado'
  db.prepare("INSERT INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 778, 'x', 'x', '2026-12-01', 'read offline_access', '2026-01-01', '2026-10-09T04:00:00.000Z')").run(C2)
  gravarItens(C2, [{ id: 'MLBA', title: 'Kit 4 Roldanas', price: 100, available_quantity: 14, pictures: [], shipping: { logistic_type: 'fulfillment' }, status: 'active' }, { id: 'MLBB', title: 'Kit 4 Roldanas (catálogo)', price: 100, available_quantity: 14, pictures: [], shipping: { logistic_type: 'fulfillment' }, status: 'active' }], { t: '2026-10-09T05:00:00.000Z', dia: HOJE })
  db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)').run(C2, 'MLBA', addDias(HOJE, -101), 1, 100, 10)   // o que "não vende"
  db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)').run(C2, 'MLBB', addDias(HOJE, -2), 3, 300, 30)    // o que vende
  const base = stub().api, lidos = []
  const api = async (c, caminho) => {
    if (caminho.startsWith('/items/bulk?ids=')) return [{ id: 'MLBA', status_code: 200, body: { id: 'MLBA', inventory_id: 'INVX' } }, { id: 'MLBB', status_code: 200, body: { id: 'MLBB', inventory_id: 'INVX' } }]
    if (caminho.startsWith('/inventories/')) { lidos.push(caminho); return { available_quantity: 14, not_available_quantity: 0 } }
    return base(c, caminho)
  }
  await coletarSaude(C2, { api, hoje: HOJE })
  const f = db.prepare('SELECT * FROM meli_full_estoque WHERE cliente = ? AND dia = ?').all(C2, HOJE)
  assert.equal(f.length, 1); assert.equal(f[0].dias_sem_venda, 2, 'vale a venda mais recente entre os anúncios do mesmo estoque'); assert.equal(f[0].item_id, 'MLBB'); assert.equal(lidos.length, 1, 'um inventário, uma leitura')
})

await ok('Full pelo /items/bulk: todos os itens 404 (0 corpos de N) ou lote 500 → full indisponivel (guarda; nunca "sem Full" vazio); item 404 isolado só fica de fora', async () => {
  const base = stub().api
  const com = bulk => async (c, caminho) => caminho.startsWith('/items/bulk?ids=') ? bulk : base(c, caminho)
  assert.equal((await coletarSaude(CLI, { api: com([{ id: 'MLB1', status_code: 404 }]), hoje: HOJE })).pendente.full, 'indisponivel')
  assert.equal((await coletarSaude(CLI, { api: com({ _erro: true, status: 500 }), hoje: HOJE })).pendente.full, 'indisponivel')
  gravarItens(CLI, [{ id: 'MLB3', title: 'Full 2', price: 10, available_quantity: 1, pictures: [], shipping: { logistic_type: 'fulfillment' }, status: 'active' }], { t: '2026-10-09T05:00:00.000Z', dia: HOJE })
  const r = await coletarSaude(CLI, { api: com([{ id: 'MLB1', status_code: 200, body: { id: 'MLB1', inventory_id: 'INV1' } }, { id: 'MLB3', status_code: 404 }]), hoje: HOJE })
  assert.equal(r.pendente.full, undefined); assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_full_estoque WHERE cliente = ? AND dia = ?').get(CLI, HOJE).n, 1)
})

console.log(`\n${n} caso(s) ok`)
