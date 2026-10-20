// Autoteste da PREVISÃO DE COMPRAS e do ponto de reposição com segurança (Algoritmo v1.6.0, 13/10/2026): o caso real da Agrinorte (Pistão 170: 10 un, ~0,43/dia,
// prazo 21 d — antes ponto 9, ficava fora do próximo pedido; agora ponto 12 = 0,43 × (21 + 7) e entra), lead time informado vencendo a premissa (conta toda < SKU
// < anúncio), tendência limitada a [0,7; 1,5], data comercial do calendário só no cenário base, «pedir agora», curva C só dentro do ciclo, estoque parado do Full com
// as travas (vendeu nos 28 d / inventário compartilhado), capital empatado só com custo («—» = null), pendência `prazo_fornecedor` sem prazo informado e o HTTP
// do lead time (415/404/403, prévia, sem eco). Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports): nunca abre data/db.sqlite.
// Rodar: node scripts/teste-compras-previsao.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { diagnosticarConta, sugestaoFull, algoritmo, DEFINICOES } = await import('../src/lib/diagnostico-conta.js')
const { preverCompras, eventoDoItem } = await import('../src/lib/compras-previsao.js')
const { criarLeadTime, resolvedorLeadTime, emRuptura } = await import('../src/lib/lead-time.js')
const { montarPlanoSemanal } = await import('../src/lib/plano-semana-texto.js')
const { criarRotasCompras } = await import('../src/rotas-compras.js')
const { montar, itemMl, baseMl } = await import('./fixtures/pendencias-mundo.mjs')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-13', D = k => addDias(HOJE, k), L = algoritmo.limiares
const POR = 'Giovanna Torres', norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const lead = criarLeadTime(db, { agora: () => '2026-10-13T12:00:00.000Z', validarPor: nome => norm(nome) === norm(POR) ? POR : '' })
const PISTAO = 'MLB6304458754'

// Agrinorte: Kit Pistão 170 com 10 un e 12 vendidas em 28 dias (0,43/dia), uma venda a cada 2 dias; 56 dias coletados, sem Ads, sem custos
function semear(cli, { estoque = 10, id = PISTAO, titulo = 'Kit Pistão + Anéis Para Motosserra Stihl 170 Ms170' } = {}) {
  gravarItens(cli, [{ id, title: titulo, price: 89.9, available_quantity: estoque, pictures: [{}, {}, {}, {}, {}], shipping: {}, status: 'active', date_created: '2025-01-01T00:00:00.000Z' }], { t: '2026-10-13T05:00:00.000Z', dia: HOJE })
  const insSerie = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  const insCob = db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,1,0,'2026-10-13T05:00:00.000Z')")
  db.transaction(() => { for (let d = -56; d <= -1; d++) { insCob.run(cli, D(d)); if (d >= -24 && d % 2 === 0) insSerie.run(cli, id, D(d), 1, 89.9, 30) } })()
}
semear('Agrinorte')

await ok('Pistão 170 (caso real da Agrinorte): ponto de reposição = vendas/dia × (21 + 7 de segurança) = 12 ≥ 10 un → entra no «próximo pedido»; sem a segurança era 9 e ficava fora', () => {
  const d = diagnosticarConta('Agrinorte', { hoje: HOJE }), i = d.itens.find(x => x.id === PISTAO)
  assert.equal(i.u, 12); assert.equal(i.vel_dia, 0.43); assert.equal(i.estoque, 10); assert.equal(i.cobertura, 23)
  assert.equal(Math.ceil(12 / 28 * L.lead_time_reposicao_dias), 9, 'a régua antiga (só o prazo) dava 9 < 10: o Pistão não aparecia')
  assert.equal(L.estoque_seguranca_dias, 7); assert.ok(algoritmo.premissas.limiares.includes('estoque_seguranca_dias'), 'a segurança é premissa rotulada')
  assert.deepEqual([i.ponto_reposicao, i.lead_time_dias, i.lead_time_fonte], [12, 21, 'premissa'])
  assert.match(DEFINICOES.ponto_reposicao.formula, /lead time \+ segurança/); assert.ok(i.estoque <= i.ponto_reposicao)
  // o plano semanal (mesmo predicado do gatilho ciclo_estoque_previsto: estoque ≤ ponto_reposicao) agora lista o Pistão no 🔄
  const it = { id: i.id, titulo: i.titulo, permalink: '', curva: i.curva, status: i.status, cobertura: i.cobertura, estoque: i.estoque, ponto_reposicao: i.ponto_reposicao,
    lead_time_dias: i.lead_time_dias, lead_time_fonte: i.lead_time_fonte, vel_dia: i.vel_dia, logistica: '', r: i.r, u: i.u, sug: sugestaoFull(i)?.cenarios || null }
  const p = montarPlanoSemanal({ rotulo: 'Agrinorte', hoje: HOJE, resumo: { gmv: d.resumo.gmv, pedidos: 12, variacao_pct: null }, itens: [it], limiares: { ...L, min_unidades_item: algoritmo.foco.min_unidades_item } })
  assert.ok(p.blocos.includes('ciclo'), 'bloco 🔄 do próximo pedido'); assert.match(p.texto, /Kit Pistão/); assert.match(p.texto, /Consideramos 21 dias entre o pedido e a chegada/)
  const antigo = montarPlanoSemanal({ rotulo: 'Agrinorte', hoje: HOJE, resumo: { gmv: d.resumo.gmv, pedidos: 12, variacao_pct: null }, itens: [{ ...it, ponto_reposicao: 9 }], limiares: { ...L, min_unidades_item: algoritmo.foco.min_unidades_item } })
  assert.ok(!antigo.blocos.includes('ciclo'), 'com o ponto antigo (9) o Pistão não entrava — a falha que a Agrinorte apontou')
  // previsão de compras: pedir agora, quanto cobre prazo + ciclo + segurança (58 d), conservador ≤ base, premissas declaradas, sem custos = null
  const c = preverCompras(d, { cfg: algoritmo, sugestaoFull }), x = c.itens.find(y => y.id === PISTAO)
  assert.equal(c.disponivel, true); assert.equal(c.rotulo_pedido, 'pedido ao fornecedor ou à produção')
  assert.equal(x.no_ponto_de_pedido, true); assert.deepEqual(x.quando_pedir, { agora: true, data: HOJE, dias: 0 }); assert.deepEqual(x.lead_time, { dias: 21, fonte: 'premissa' })
  assert.equal(x.quanto_pedir.cobre_dias, 21 + 30 + 7); assert.ok(x.quanto_pedir.conservador >= 1 && x.quanto_pedir.conservador <= x.quanto_pedir.base, JSON.stringify(x.quanto_pedir))
  assert.equal(x.envio_full, null, 'não é Full'); assert.equal(x.capital_empatado, null); assert.equal(x.valor_pedido, null)
  assert.ok(c.premissas.some(t => /21 dias onde o prazo do fornecedor ou da produção não foi informado \(premissa/.test(t))); assert.ok(c.premissas.some(t => /Estimativa, não promessa/.test(t)))
  assert.ok(!c.premissas.some(t => /Parcial/.test(t)), '56 dias coletados: sem lacuna')
  // tendência UMA vez sobre a média simples dos 28 d (antes: velocidade ponderada × tendência → 22 a 36 un): Pistão 0,43/dia (7 un nos últimos 14 d: tendência 1,17);
  // conservador = 0,43 × 58 − 10 = 15; base = 0,5 × 58 + Black Friday (curva A, 45 dias: 7 dias × +50 % = 1,75) − 10 = 21. «Kit» não é palavra de Natal/Dia das Mães
  assert.deepEqual([x.vendas_dia_28d, x.vendas_dia, x.tendencia.fator], [0.43, 0.5, 1.17]); assert.deepEqual(x.quanto_pedir, { conservador: 15, base: 21, cobre_dias: 58 })
  assert.deepEqual(x.datas_comerciais.map(e => e.evento), ['Black Friday', 'Natal'], 'curva A: as universais (Natal pela curva, não pela palavra «kit»)'); assert.equal(x.cobertura_dias, i.cobertura, 'a MESMA cobertura do diagnóstico (🔄)')
})

await ok('lead time informado vence a premissa: conta toda (cliente, 10 d) → SKU (equipe, 30 d) → anúncio (cliente, 40 d); prévia não grava; por fora da lista = 403 sem eco', () => {
  const pre = lead.salvar({ cliente: 'Agrinorte', chave: '*', dias: 10, fonte: 'cliente' })
  assert.equal(pre.previa, true); assert.equal(lead.ler('Agrinorte').conta, null, 'prévia não grava')
  assert.throws(() => lead.salvar({ cliente: 'Agrinorte', dias: 10, por: 'Fulano Intruso', confirmar: true }), e => e.status === 403 && !/Fulano/.test(e.message))
  for (const [b, rx] of [[{ dias: 0 }, /entre 1 e 365/], [{ dias: '12a' }, /entre 1 e 365/], [{ dias: 10, fonte: 'chute' }, /fonte desconhecida/], [{ dias: 10, chave: '<b>' }, /chave inválida/]]) assert.throws(() => lead.salvar({ cliente: 'Agrinorte', ...b }), e => rx.test(e.message) && !/chute|<b>|12a/.test(e.message))
  assert.throws(() => lead.salvar({ cliente: '[Comercial] Prospect', dias: 10 }), /cliente inválido/)
  assert.equal(lead.salvar({ cliente: 'Agrinorte', chave: '*', dias: 10, fonte: 'cliente', por: POR, confirmar: true }).mudou, true)
  assert.equal(lead.salvar({ cliente: 'Agrinorte', chave: '*', dias: 10, fonte: 'cliente', por: POR, confirmar: true }).mudou, false, 'igual ao salvo: nada grava')
  let i = diagnosticarConta('Agrinorte', { hoje: HOJE }).itens.find(x => x.id === PISTAO)
  assert.deepEqual([i.lead_time_dias, i.lead_time_fonte, i.ponto_reposicao], [10, 'cliente', 8], '12/28 × (10 + 7) = 7,3 → 8: com o prazo real de 10 d o Pistão ainda não precisa de pedido')
  db.prepare("INSERT INTO promo_anuncio (cliente, item_id, sku) VALUES ('Agrinorte', ?, 'KIT-PISTAO-170')").run(PISTAO)
  lead.salvar({ cliente: 'Agrinorte', chave: 'kit-pistao-170', dias: 30, fonte: 'equipe', por: POR, confirmar: true })
  i = diagnosticarConta('Agrinorte', { hoje: HOJE }).itens.find(x => x.id === PISTAO)
  assert.deepEqual([i.lead_time_dias, i.lead_time_fonte, i.ponto_reposicao], [30, 'equipe', 16], 'SKU (sem diferença de maiúsculas) vence a conta toda')
  lead.salvar({ cliente: 'Agrinorte', chave: PISTAO.toLowerCase(), dias: 40, fonte: 'cliente', por: POR, confirmar: true })
  i = diagnosticarConta('Agrinorte', { hoje: HOJE }).itens.find(x => x.id === PISTAO)
  assert.deepEqual([i.lead_time_dias, i.lead_time_fonte, i.ponto_reposicao], [40, 'cliente', 21], 'anúncio vence SKU e conta')
  assert.deepEqual(lead.ler('Agrinorte').por_anuncio.map(r => r.chave).sort(), [PISTAO, 'kit-pistao-170'].sort())
  const c = preverCompras(diagnosticarConta('Agrinorte', { hoje: HOJE }), { cfg: algoritmo }).itens.find(x => x.id === PISTAO)
  assert.deepEqual(c.lead_time, { dias: 40, fonte: 'cliente' }); assert.equal(c.quanto_pedir.cobre_dias, 40 + 30 + 7)
  assert.equal(resolvedorLeadTime([])({ id: PISTAO }), null, 'sem cadastro: null (quem chama usa a premissa)')
  // os textos ao cliente dizem o prazo usado, não a premissa
  const p = montarPlanoSemanal({ rotulo: 'Agrinorte', hoje: HOJE, resumo: { gmv: 1, pedidos: 1, variacao_pct: null }, limiares: { ...L, min_unidades_item: 3 },
    itens: [{ id: 'A', titulo: 'Produto A', curva: 'A', status: 'active', cobertura: 45, estoque: 45, ponto_reposicao: 47, vel_dia: 1, u: 28, r: 100, lead_time_dias: 40, lead_time_fonte: 'cliente' }] })
  assert.match(p.texto, /Usamos o prazo de 40 dias entre o pedido e a chegada que temos registrado/)
})

// diagnóstico mínimo para os testes puros
const diagCom = (itens, o = {}) => ({ disponivel: true, cliente: 'Acme', hoje: HOJE, custos: null, data_quality: { cobertura: { pedidos: { lacunas: [] } } }, ...o, itens })
const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, curva: 'B',   // curva B sem palavra de evento: sem data comercial (o teste dela pede curva A)
  status: 'active', estoque: 100, u: 28, u14: 14, vel_dia: 1, vel_pond: 1, preco: 50, custo_unitario: null, r: 1400, ponto_reposicao: 28, lead_time_dias: 21, lead_time_fonte: 'premissa', logistica: '', ...o })

await ok('tendência = vendas/dia 14 d ÷ 28 d, limitada a [0,7; 1,5] e declarada (medido × usado); conservador nunca sobe com a tendência', () => {
  const c = preverCompras(diagCom([it('alta', { u14: 28 }), it('queda', { u14: 1 }), it('estavel')]), { cfg: algoritmo })
  const [alta, queda, est] = ['alta', 'queda', 'estavel'].map(id => c.itens.find(x => x.id === id))
  assert.deepEqual(alta.tendencia, { fator: 1.5, medido: 2, limitada: true }); assert.deepEqual(queda.tendencia, { fator: 0.7, medido: 0.07, limitada: true }); assert.deepEqual(est.tendencia, { fator: 1, medido: 1, limitada: false })
  assert.deepEqual(alta.previsao[30], { conservador: 30, base: 45 }); assert.deepEqual(queda.previsao[30], { conservador: 21, base: 21 }); assert.deepEqual(est.previsao[90], { conservador: 90, base: 90 })
  assert.deepEqual(Object.keys(alta.previsao), ['30', '60', '90'])
  assert.ok(c.premissas[0].includes('limitada entre 0,7 e 1,5'))
})

await ok('data comercial do calendário (Black Friday 27/11, universal = curva A) entra só no cenário base e só na janela que a contém; curva B sem palavra do evento fica de fora', () => {
  const hoje = '2026-11-10', c = preverCompras(diagCom([it('a', { curva: 'A' }), it('b')], { hoje }), { cfg: algoritmo, hoje })
  const a = c.itens.find(x => x.id === 'a'), b = c.itens.find(x => x.id === 'b')
  assert.deepEqual(a.datas_comerciais.map(e => e.evento), ['Black Friday', 'Natal']); assert.deepEqual(b.datas_comerciais, [])
  assert.equal(eventoDoItem({ universal: true }, { curva: 'B' }), false); assert.equal(eventoDoItem({ palavras: ['cao'] }, { curva: 'C', titulo: 'Coleira para Cão' }), true)
  const extra = algoritmo.compras.data_comercial.dias_efeito * (algoritmo.compras.data_comercial.fator - 1)          // 7 × 0,5 = 3,5 dias de venda por evento
  assert.deepEqual(a.previsao[30], { conservador: 30, base: Math.round(30 + extra) }, 'BF (17 d) na janela de 30; Natal (45 d) não')
  assert.deepEqual(a.previsao[60], { conservador: 60, base: Math.round(60 + 2 * extra) }, 'BF e Natal na de 60')
  assert.deepEqual(b.previsao[60], { conservador: 60, base: 60 })
  assert.ok(c.premissas.some(t => /7 dias de venda 50 % acima do ritmo \(premissa da casa/.test(t)))
})

await ok('quando pedir = hoje + (cobertura − prazo − segurança): ≤ 0 → «pedir agora»; quanto = demanda de (prazo + ciclo 30 + segurança) − estoque; curva C só se o pedido cai no ciclo', () => {
  const c = preverCompras(diagCom([it('folga', { estoque: 100 }), it('zerado', { estoque: 0, status: 'paused' }), it('c-perto', { curva: 'C', estoque: 40 }), it('c-longe', { curva: 'C', estoque: 500 }),
    it('pausado', { status: 'paused', estoque: 5 }), it('sem-venda', { vel_pond: 0, vel_dia: 0, u: 0, u14: 0 }), it('nao-lido', { estoque: null })]), { cfg: algoritmo })
  const por = id => c.itens.find(x => x.id === id)
  assert.deepEqual(por('folga').quando_pedir, { agora: false, data: D(72), dias: 72 }, '100 dias de estoque − 21 − 7'); assert.deepEqual(por('folga').quanto_pedir, { conservador: 0, base: 0, cobre_dias: 58 })
  assert.deepEqual(por('zerado').quando_pedir, { agora: true, data: HOJE, dias: 0 }); assert.deepEqual(por('zerado').quanto_pedir, { conservador: 58, base: 58, cobre_dias: 58 }, 'pausado sem estoque = ruptura, entra')
  assert.equal(por('c-perto').quando_pedir.dias, 12); assert.equal(por('c-longe'), undefined, 'curva C longe do pedido fica fora'); assert.equal(por('pausado'), undefined, 'pausa com estoque é decisão')
  assert.equal(por('sem-venda'), undefined); assert.deepEqual([por('nao-lido').quando_pedir, por('nao-lido').quanto_pedir, por('nao-lido').cobertura_dias], [null, null, null], 'estoque não lido: nada inventado')
  assert.deepEqual(c.itens.slice(0, 2).map(x => x.id), ['zerado', 'c-perto'], 'ordem: quem pede primeiro'); assert.equal(c.totais.pedir_agora, 1); assert.equal(c.totais.pedir_no_ciclo, 2)
})

await ok('Full: envio sugerido pelo sugestaoFull (o mesmo da regra full_envio); estoque parado do Full com as travas (vendeu nos 28 d ou inventário compartilhado não é parado)', () => {
  const full = it('full', { logistica: 'fulfillment', estoque: 20 })
  const c = preverCompras(diagCom([full, it('vendeu')]), { cfg: algoritmo, sugestaoFull, fullParado: [
    { item_id: 'parado', inventory_id: 'I1', disponivel: 8, dias: 90, titulo: 'Produto parado', preco: 40 },
    { item_id: 'vendeu', inventory_id: 'I2', disponivel: 5, dias: 70, titulo: 'Produto vendeu' },
    { item_id: 'irmao', inventory_id: 'I3', disponivel: 4, dias: 80, titulo: 'Variação', compartilhado: true },
    { item_id: 'vazio', inventory_id: 'I4', disponivel: 0, dias: 80, titulo: 'Sem unidade' }] })
  assert.deepEqual(c.itens.find(x => x.id === 'full').envio_full, sugestaoFull(full).cenarios); assert.equal(c.itens.find(x => x.id === 'vendeu').envio_full, null)
  assert.deepEqual(c.parado.map(x => [x.item_id, x.unidades, x.dias_sem_venda, x.capital]), [['parado', 8, 90, null]], 'só o parado de verdade; sem custo, capital null')
})

await ok('capital empatado e valor do pedido só com custo cadastrado (custo do anúncio > CMV % da conta); sem custo = null («—»), nunca zero', () => {
  const sem = preverCompras(diagCom([it('x', { estoque: 10 })]), { cfg: algoritmo })
  assert.deepEqual([sem.itens[0].capital_empatado, sem.itens[0].valor_pedido, sem.itens[0].custo_fonte], [null, null, null]); assert.deepEqual(sem.totais.capital_empatado, { valor: null, com_custo: 0, total: 1 })
  const com = preverCompras(diagCom([it('x', { estoque: 10, custo_unitario: 12.5 }), it('y', { estoque: 4, preco: 50 })], { custos: { cmv_pct: 40 } }), { cfg: algoritmo,
    fullParado: [{ item_id: 'z', inventory_id: 'I9', disponivel: 3, dias: 75, titulo: 'Z', preco: 10 }] })
  const [x, y] = ['x', 'y'].map(id => com.itens.find(i => i.id === id))
  assert.deepEqual([x.custo_fonte, x.capital_empatado], ['anuncio', 125]); assert.deepEqual([y.custo_fonte, y.custo_unitario, y.capital_empatado], ['cmv_conta', 20, 80])
  assert.deepEqual(x.valor_pedido, { conservador: r2(x.quanto_pedir.conservador * 12.5), base: r2(x.quanto_pedir.base * 12.5) })
  assert.deepEqual(com.totais.capital_empatado, { valor: 205, com_custo: 2, total: 2 }); assert.deepEqual(com.parado.map(p => p.capital), [12], '3 un × (40 % de R$ 10)')
  const parcial = preverCompras(diagCom([it('x')], { data_quality: { cobertura: { pedidos: { lacunas: ['2026-10-01', '2026-10-02'] } } } }), { cfg: algoritmo })
  assert.deepEqual(parcial.parcial, { dias_sem_coleta: 2 }); assert.ok(parcial.premissas.some(t => /dia sem coleta não é venda zero/.test(t)))
  assert.deepEqual(preverCompras({ disponivel: false, motivo: 'sem dados coletados' }, { cfg: algoritmo }), { disponivel: false, motivo: 'sem dados coletados' })
})
function r2(v) { return Math.round(v * 100) / 100 }

await ok('pendência «prazo do fornecedor ou da produção»: produto que mais vende vendendo sem prazo informado → info, medida, sem R$, texto do catálogo sem culpa; com prazo, some', () => {
  const pend = fonte => montar({ base: baseMl([itemMl({ estoque: 500, cobertura: 500, lead_time_fonte: fonte, lead_time_dias: fonte === 'premissa' ? 21 : 15 })]) }).p.avaliar('Acme').itens.find(p => p.item === 'prazo_fornecedor')
  const p = pend('premissa')
  assert.deepEqual([p.gravidade, p.fonte, p.canal, p.impacto.valor_brl], ['info', 'medido', 'ml', null])
  assert.match(p.evidencia, /usa 21 dias como referência/); assert.match(p.o_que_precisamos, /quantos dias, em média, o fornecedor ou a produção leva/)
  assert.equal(pend('cliente'), undefined); assert.equal(pend('equipe'), undefined)
  // risco de ruptura usa o prazo informado e diz isso
  const r = montar({ base: baseMl([itemMl({ lead_time_fonte: 'cliente', lead_time_dias: 15 })]) }).p.avaliar('Acme').itens.find(x => x.item === 'estoque_curva_a')
  assert.match(r.impacto.premissa, /com o prazo de reposição informado \(15 dias\)/); assert.equal(r.impacto.valor_brl, Math.round(100 * (15 - 3)))
})

await ok('HTTP: GET/POST /api/cliente/lead-time (415 sem JSON, 404 fora da central/prospect, prévia por padrão, 403 sem eco) e GET /api/cliente/compras', async () => {
  const app = express(); app.use(express.json())
  app.use(criarRotasCompras({ leadTime: lead, compras: c => preverCompras(diagnosticarConta(c, { hoje: HOJE }), { cfg: algoritmo }), premissa: { dias: 21, seguranca_dias: 7 }, quem: () => [POR],
    clienteCanonico: nome => norm(nome) === 'agrinorte' ? 'Agrinorte' : '' }))
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const post = (b, ct = 'application/json') => fetch(base + '/api/cliente/lead-time', { method: 'POST', headers: { 'content-type': ct }, body: typeof b === 'string' ? b : JSON.stringify(b) })
    let r = await fetch(base + '/api/cliente/lead-time?cliente=agrinorte'); let j = await r.json()
    assert.equal(r.status, 200); assert.equal(j.cliente, 'Agrinorte'); assert.equal(j.conta.dias, 10); assert.deepEqual(j.premissa, { dias: 21, seguranca_dias: 7 })
    r = await fetch(base + '/api/cliente/lead-time?cliente=' + encodeURIComponent('[Comercial] Xyz')); assert.equal(r.status, 404); assert.doesNotMatch(JSON.stringify(await r.json()), /Xyz/)
    assert.equal((await post('dias=5', 'text/plain')).status, 415)
    r = await post({ cliente: 'Agrinorte', dias: 12, fonte: 'cliente', por: POR }); j = await r.json(); assert.deepEqual([j.previa, j.mudou, j.depois.dias], [true, true, 12]); assert.equal(lead.ler('Agrinorte').conta.dias, 10, 'sem confirmar:true nada grava')
    r = await post({ cliente: 'Agrinorte', dias: 12, por: 'Hacker Malvado', confirmar: true }); assert.equal(r.status, 403); assert.doesNotMatch(JSON.stringify(await r.json()), /Hacker/)
    r = await post({ cliente: 'Agrinorte', dias: 12, por: POR, confirmar: 'true' }); assert.equal((await r.json()).previa, true, 'confirmar só vale se for exatamente true')
    r = await fetch(base + '/api/cliente/compras?cliente=Agrinorte'); j = await r.json(); assert.equal(j.disponivel, true); assert.ok(j.itens.some(x => x.id === PISTAO))
    r = await fetch(base + '/api/cliente/compras?cliente=Ninguem'); assert.equal(r.status, 404)
  } finally { srv.close() }
})

await ok('venda concentrada nos últimos 7 dias (Sabre 14 da Agrinorte: 9 un em 28 d): a alta conta UMA vez e limitada a 1,5 × o ritmo de 28 d; conservador = ritmo de 28 d', () => {
  const c = preverCompras(diagCom([it('sabre', { u: 9, u14: 9, vel_dia: 0.32, vel_pond: 0.73, estoque: 6, ponto_reposicao: 9 })]), { cfg: algoritmo }), x = c.itens[0]
  assert.deepEqual(x.tendencia, { fator: 1.5, medido: 2, limitada: true }); assert.ok(x.vendas_dia / x.vendas_dia_28d <= 1.5 + 1e-9, 'base ≤ 1,5 × 28 d')
  assert.deepEqual(x.quanto_pedir, { conservador: 13, base: 22, cobre_dias: 58 }, 'antes: 37 a 62 un'); assert.deepEqual(x.previsao[30], { conservador: 10, base: 14 })
  assert.equal(x.cobertura_dias, 19, 'cobertura pelo ritmo de 28 d, igual ao 🔄 (6 un ÷ 0,32/dia)')
  assert.ok(c.premissas[0].startsWith('Previsão = vendas por dia dos últimos 28 dias × dias × tendência'))
})

await ok('campeão SEM estoque (Bee Top Cropped: 15 un em 28 d, 1 nos últimos 14, pausado com 0): sem tendência para baixo; o base usa o ritmo de antes da falta', () => {
  const c = preverCompras(diagCom([it('top', { status: 'paused', estoque: 0, u: 15, u14: 1, u0: 20, vel_pond: 0.13, vel_dia: 0.54 })]), { cfg: algoritmo }), x = c.itens[0]
  assert.equal(x.ruptura, true); assert.equal(x.tendencia.fator, 1, 'a queda dos dias parados não é queda de demanda')
  assert.deepEqual(x.quanto_pedir, { conservador: 32, base: 42, cobre_dias: 58 }, 'antes: 6 un'); assert.deepEqual(x.quando_pedir, { agora: true, data: HOJE, dias: 0 })
  assert.ok(c.premissas.some(t => /sem estoque: os dias parados não contam como queda/i.test(t)))
})

await ok('data comercial por palavra: «kit» sozinho não é presente (Kit Pistão fora do Dia das Mães); «kit presente» entra', () => {
  const maes = algoritmo.sazonalidade.find(e => e.evento === 'Dia das Mães'), natal = algoritmo.sazonalidade.find(e => e.evento === 'Natal')
  assert.ok(!maes.palavras.includes('kit') && !natal.palavras.includes('kit'))
  assert.equal(eventoDoItem(maes, { curva: 'B', titulo: 'Kit Pistão + Anéis Para Motosserra Stihl 170' }), false)
  assert.equal(eventoDoItem(maes, { curva: 'B', titulo: 'Kit Presente Dia das Mães Caneca' }), true)
})

await ok('ruptura = predicado ÚNICO (regra, 📦, gatilho): prazo informado maior que o corte amplia; reposição que chega antes de zerar não é ruptura; premissa não amplia', () => {
  const L2 = { cobertura_critica_dias: 10, lead_time_reposicao_dias: 21 }
  assert.equal(emRuptura({ cobertura: 19, lead_time_dias: 60, lead_time_fonte: 'cliente' }, L2), true, 'acaba em 19 d, chega em 60')
  assert.equal(emRuptura({ cobertura: 5, lead_time_dias: 3, lead_time_fonte: 'cliente' }, L2), false, 'chega em 3 d, antes de zerar: é ciclo')
  assert.equal(emRuptura({ cobertura: 9, lead_time_dias: 21, lead_time_fonte: 'premissa' }, L2), true); assert.equal(emRuptura({ cobertura: 12, lead_time_dias: 21, lead_time_fonte: 'premissa' }, L2), false)
  assert.equal(emRuptura({ cobertura: null }, L2), false, 'sem leitura não é zero')
  const p = montarPlanoSemanal({ rotulo: 'Agrinorte', hoje: HOJE, resumo: { gmv: 1, pedidos: 1, variacao_pct: null }, limiares: { ...L, min_unidades_item: 3 },
    itens: [{ id: 'S', titulo: 'Sabre Saibre 14', curva: 'A', status: 'active', cobertura: 19, estoque: 6, ponto_reposicao: 21, vel_dia: 0.32, u: 9, r: 900, lead_time_dias: 60, lead_time_fonte: 'cliente' },
      { id: 'T', titulo: 'Tambor Embreagem', curva: 'A', status: 'active', cobertura: 5, estoque: 5, ponto_reposicao: 10, vel_dia: 1, u: 28, r: 900, lead_time_dias: 3, lead_time_fonte: 'cliente' }] })
  assert.deepEqual(p.blocos, ['ruptura', 'ciclo']); assert.match(p.texto, /📦[^]*• Sabre Saibre 14: tem 6 un/); assert.match(p.texto, /🔄[^]*• Tambor Embreagem: 5 un/)
  // 🔄 com prazos/fontes misturados: o prazo de cada um na linha (sem «Consideramos 21 dias» para quem tem prazo informado) e sem «2 ou 3 semanas» fixo
  const m = montarPlanoSemanal({ rotulo: 'Agrinorte', hoje: HOJE, resumo: { gmv: 1, pedidos: 1, variacao_pct: null }, limiares: { ...L, min_unidades_item: 3 },
    itens: [{ id: 'A', titulo: 'Produto Alfa', curva: 'A', status: 'active', cobertura: 70, estoque: 70, ponto_reposicao: 80, vel_dia: 1, u: 28, r: 900, lead_time_dias: 60, lead_time_fonte: 'cliente' },
      { id: 'B', titulo: 'Produto Beta', curva: 'A', status: 'active', cobertura: 20, estoque: 20, ponto_reposicao: 28, vel_dia: 1, u: 28, r: 800, lead_time_dias: 21, lead_time_fonte: 'premissa' }] }).texto
  assert.match(m, /Usamos o prazo de cada produto entre o pedido e a chegada \(o que temos registrado; sem registro, a referência de 21 dias\)/)
  assert.match(m, /• Produto Alfa: 70 un \(~70 dias\) · vende ~R\$ 225\/semana · prazo 60 dias\n• Produto Beta: 20 un \(~20 dias\) · vende ~R\$ 200\/semana · prazo 21 dias \(referência\)/); assert.doesNotMatch(m, /2 ou 3 semanas|Consideramos/)
})

await ok('prazo por SKU/anúncio só grava quando casa com um anúncio do cliente (SKU vem da leitura do ML): 404 fixo sem eco; o GET marca a chave que não casa', () => {
  const lt = criarLeadTime(db, { agora: () => '2026-10-13T12:00:00.000Z', validarPor: () => POR, anuncios: () => ({ itens: [PISTAO], skus: ['KIT-PISTAO-170'] }) })
  assert.throws(() => lt.salvar({ cliente: 'Agrinorte', chave: 'SKU-INEXISTENTE-9', dias: 15 }), e => e.status === 404 && !/INEXISTENTE/.test(e.message) && /MLB/.test(e.message))
  assert.throws(() => lt.salvar({ cliente: 'Agrinorte', chave: 'MLB9999999999', dias: 15, por: POR, confirmar: true }), e => e.status === 404)
  assert.equal(lt.salvar({ cliente: 'Agrinorte', chave: 'kit-pistao-170', dias: 15 }).previa, true, 'SKU conhecido (sem diferença de maiúsculas)')
  assert.equal(lt.salvar({ cliente: 'Agrinorte', chave: '*', dias: 15 }).previa, true, 'conta toda sempre vale')
  db.prepare("INSERT OR REPLACE INTO lead_time_cliente (cliente, chave, dias, fonte, por, atualizado_em) VALUES ('Agrinorte', 'velho-sku', 9, 'equipe', ?, '2026-10-01')").run(POR)
  const g = lt.ler('Agrinorte').por_anuncio; assert.equal(g.find(r => r.chave === 'velho-sku').casa, false); assert.equal(g.find(r => r.chave === PISTAO).casa, true)
  db.prepare("DELETE FROM lead_time_cliente WHERE cliente = 'Agrinorte' AND chave = 'velho-sku'").run()
})

console.log(`\n${n} verificações de compras e previsibilidade passaram`)
