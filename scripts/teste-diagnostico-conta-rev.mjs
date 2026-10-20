// Autoteste da revisão adversarial do diagnóstico da conta (08/10/2026): margem depois de Ads com TACOS (não ACOS) e presa à cobertura da série,
// conta sem ML com null (não [] / 0, nem "0 de 0" no texto) e textos de pendência/motivo sem nome interno. Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports): nunca abre data/db.sqlite, nada de rede.
// Rodar: node scripts/teste-diagnostico-conta-rev.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { db } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { diagnosticarConta, qualidadeDados, DEFINICOES } = await import('../src/lib/diagnostico-conta.js')
const { gerarPlanoCliente } = await import('../src/lib/plano-cliente.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-05', D = k => addDias(HOJE, k)
const INTERNO = /notion|merov[ií]ngio|backlog|\bnull\b/i
const textosDq = dq => [...dq.analises_bloqueadas.flatMap(b => [b.analise, b.motivo, b.como_obter]), ...dq.fontes.map(f => f.definicao)]

// conta com GMV 28.000 em 28 dias; Ads: custo 1.000, receita atribuída 2.000 (ACOS 50, TACOS 3,57); custos CMV 40 / comissão 16 / imposto 6 → margem pré 38
function semear(cli, { ads, gap = 0 }) {   // gap = últimos N dias da janela atual sem coleta e sem série (dia sem coleta não é venda zero)
  gravarItens(cli, [{ id: 'MLB1', title: 'Produto de teste', price: 100, available_quantity: 400, pictures: [], shipping: { free_shipping: true }, status: 'active', date_created: '2025-01-01T00:00:00.000Z' }], { t: '2026-10-05T05:00:00.000Z', dia: HOJE })
  const insSerie = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  const insCob = db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,10,0,'2026-10-05T05:00:00.000Z')")
  db.transaction(() => {
    for (let d = -56; d <= -1; d++) { if (d >= -gap) continue; insCob.run(cli, D(d)); if (d >= -28) insSerie.run(cli, 'MLB1', D(d), 10, 1000, 200) }
    if (ads) db.prepare("INSERT INTO meli_ads_item (cliente, item_id, periodo, de, ate, prints, clicks, custo, receita, unidades, status, coletado_em) VALUES (?, 'MLB1', 'atual', ?, ?, 10000, 500, 1000, 2000, 20, 'active', '2026-10-05T06:00:00.000Z')").run(cli, D(-28), D(-1))
    db.prepare("INSERT INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 1, 'x', 'x', '2026-12-01', 'read offline_access', '2026-01-01', '2026-10-05T04:00:00.000Z')").run(cli)
    db.prepare("INSERT INTO custos_cliente (cliente, custos_json, atualizado_em) VALUES (?, ?, '2026-10-01T00:00:00.000Z')").run(cli, JSON.stringify({ cmv_pct: 40, comissao_pct: 16, imposto_pct: 6 }))
  })()
}
semear('Conta Ads', { ads: true }); semear('Conta sem Ads', { ads: false }); semear('Conta 2 lacunas', { ads: true, gap: 2 }); semear('Conta 10 lacunas', { ads: true, gap: 10 })

await ok('margem depois de Ads = margem pré − TACOS (custo de Ads ÷ receita TOTAL): 38 − 3,57 ≈ 34,4, nunca 38 − ACOS 50 = −12', () => {
  const d = diagnosticarConta('Conta Ads', { hoje: HOJE })
  assert.equal(d.resumo.gmv, 28000); assert.equal(d.ads.acos, 50); assert.equal(d.ads.tacos, 3.57); assert.equal(d.economia.margem_pre_ads_pct, 38)
  assert.equal(d.margem_pos_ads_pct, 34.4)
  assert.match(DEFINICOES.margem_pos_ads.formula, /TACOS/); assert.doesNotMatch(DEFINICOES.margem_pos_ads.formula, /margem_pre_ads − ACOS/)
  assert.equal(diagnosticarConta('Conta sem Ads', { hoje: HOJE }).margem_pos_ads_pct, null, 'Ads não coletado: null, não margem pré')
})

await ok('margem depois de Ads respeita a cobertura da série (o TACOS divide pelo GMV): até 3 dias sem coleta → parcial declarado; 10 → null com motivo; o motivo do null não fala mais em ACOS', () => {
  const cheia = diagnosticarConta('Conta Ads', { hoje: HOJE })
  assert.equal(cheia.margem_pos_ads_motivo, ''); assert.equal(cheia.margem_pos_ads_parcial, null)
  const d2 = diagnosticarConta('Conta 2 lacunas', { hoje: HOJE })
  assert.equal(typeof d2.margem_pos_ads_pct, 'number'); assert.deepEqual(d2.margem_pos_ads_parcial, { dias_cobertos: 26, dias: 28, dias_sem_coleta: 2, dias_truncados: 0 }); assert.match(d2.margem_pos_ads_motivo, /^parcial: 26 de 28 dias coletados$/)
  const d10 = diagnosticarConta('Conta 10 lacunas', { hoje: HOJE })
  assert.equal(d10.resumo.gmv, 18000); assert.equal(d10.ads.tacos, 5.56, 'o TACOS da conta segue exposto (o motor marca/anula pela própria série)')
  assert.equal(d10.margem_pos_ads_pct, null, 'GMV com 10 dias a menos subestimaria a margem (32,4 contra 34,4 real): null, nunca número')
  assert.match(d10.margem_pos_ads_motivo, /^10 dia\(s\) da janela sem coleta de pedidos \(acima de 3\)/); assert.equal(d10.margem_pos_ads_parcial, null)
  const semAds = diagnosticarConta('Conta sem Ads', { hoje: HOJE }).margem_pos_ads_motivo
  assert.match(semAds, /sem Product Ads coletado/); assert.doesNotMatch(semAds, /ACOS/)
  for (const t of [d2.margem_pos_ads_motivo, d10.margem_pos_ads_motivo, semAds]) assert.doesNotMatch(t, INTERNO)
})

await ok('conta sem ML: cobertura de pedidos e de visitas = null (não [] / 0); conta com coleta segue medida', () => {
  const q = qualidadeDados({ conta: null, hoje: HOJE })
  assert.deepEqual(q.cobertura.pedidos, { de: null, ate: null, lacunas: null, truncados: null })
  assert.deepEqual(q.cobertura.visitas, { anuncios_cobertos: null, anuncios_total: null })
  // a definição da fonte de visitas também não inventa contagem: nada de "0 de 0 anúncio(s)" para o que não foi lido
  const vis = q.fontes.find(f => /visitas por anúncio/.test(f.fonte))
  assert.equal(vis.status, 'indisponivel'); assert.equal(vis.definicao, 'sem anúncios lidos: cobertura de visitas não medida')
  for (const t of textosDq(q)) assert.doesNotMatch(String(t), /(^|\D)0 (de \d|dia|anúncio)/, t)
  const c = diagnosticarConta('Conta Ads', { hoje: HOJE }).data_quality.cobertura
  assert.deepEqual([c.pedidos.lacunas, c.pedidos.truncados, c.visitas.anuncios_total], [[], 0, 1])
})

await ok('textos de pendência/motivo/fonte do diagnóstico sem Notion, Merovíngio, backlog nem "null"', () => {
  const d = diagnosticarConta('Conta Ads', { hoje: HOJE })
  const textos = [...textosDq(qualidadeDados({ conta: null, hoje: HOJE })), ...textosDq(d.data_quality), ...d.pendencias.flatMap(p => [p.item, p.muda, p.como])]
  assert.ok(textos.length > 20)
  for (const t of textos) assert.doesNotMatch(String(t), INTERNO)
  assert.ok(d.data_quality.analises_bloqueadas.some(b => /não é zero/.test(b.motivo)), 'o sentido continua: não coletado não é zero')
})

await ok('plano do cliente: backlog_parado, alavanca_* e sem_plano_mes (3 ramos) sem nome interno; a falha da consulta não ecoa o erro bruto', () => {
  const CLI = '__rev_plano__'
  const ins = db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, last_edited) VALUES (?, 'teste', ?, ?, 'nao_iniciada', 'Fulano Teste', ?)")
  for (let i = 1; i <= 3; i++) ins.run(`rev-${i}`, CLI, `Tarefa parada ${i}`, D(-40) + 'T12:00:00.000Z')   // 3 abertas paradas há 40 dias (backlog_parado) e ativas na janela das alavancas
  const cli = { cliente: CLI, status: 'Ativo', tier: '', nicho: '', canais: ['ML'], consultores: { ML: 'Fulano Teste' }, lideres: {}, principal: 'Fulano Teste', squads: [], squadPrincipal: '', squadDoCanal: () => '', responsavelDoCanal: () => 'Fulano Teste' }
  const ramos = [{ ok: true }, { ok: false, motivo: 'Notion 401: token inválido' }, null]
  for (const planoStatus of ramos) {
    const acoes = gerarPlanoCliente(cli, { hoje: HOJE, planoStatus }).acoes
    const alvo = acoes.filter(a => a.regra === 'backlog_parado' || a.regra === 'sem_plano_mes' || a.regra.startsWith('alavanca_'))
    assert.ok(alvo.some(a => a.regra === 'backlog_parado') && alvo.some(a => a.regra === 'sem_plano_mes') && alvo.some(a => a.regra.startsWith('alavanca_')), JSON.stringify(acoes.map(a => a.regra)))
    for (const a of alvo) for (const t of [a.titulo, a.dados.problema, a.dados.acao, a.dados.evidencia]) assert.doesNotMatch(t, INTERNO, `${a.regra}: ${t}`)
    assert.doesNotMatch(acoes.find(a => a.regra === 'sem_plano_mes').dados.evidencia, /401|token/)
  }
})

// ── sobras do motor (08/10/2026): visOk com vis_ate, conta coletada sem vendas, arredondamento que criava zero, textos do config e da metodologia ──
const { readFileSync } = await import('node:fs')
const { classificarCurvas, carregarBase } = await import('../src/lib/diagnostico-conta.js')
const { montarAcoes, gerarPlanoConta } = await import('../src/lib/plano-anuncios.js')
const insItem = db.prepare("INSERT OR REPLACE INTO meli_item (cliente, item_id, titulo, preco, status, estoque, fotos, frete_gratis, category_id, vis_de, vis_ate, atualizado_em) VALUES (?,?,?,?,'active',1000,8,1,'MLB1234','2026-05-01',?,'x')")
const insDia = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
const coletaDias = (cli, pedidos) => { for (let d = -56; d <= -1; d++) db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,?,0,'2026-10-05T05:00:00.000Z')").run(cli, D(d), pedidos) }
const conta = cli => db.prepare("INSERT OR IGNORE INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 1, 'x', 'x', '2026-12-01', 'read offline_access', '2026-01-01', '2026-10-05T04:00:00.000Z')").run(cli)

await ok('benchmark só com séries de visitas inteiras: anúncio com a série parada 10 dias antes do fim (conversão inflada 44%) fica fora do benchmark da conta e da categoria; o ímã não dispara como FATO nos anúncios que convertem igual à conta', () => {
  const C = 'Conta Bench'
  conta(C); coletaDias(C, 3)
  db.transaction(() => {
    for (const id of ['MLB1', 'MLB2', 'MLB3']) { insItem.run(C, id, `Produto ${id}`, 100, HOJE); for (let d = -28; d <= -1; d++) insDia.run(C, id, D(d), 1, 100, 50) }   // 28 un / 1.400 visitas = 2%
    insItem.run(C, 'MLB9', 'Produto parado', 100, D(-10))                                                                                       // série de visitas parada em 25/09
    for (let d = -28; d <= -1; d++) insDia.run(C, 'MLB9', D(d), 3, 300, d <= -10 ? 10 : 0)                                                     // 84 un / 190 visitas
  })()
  const d = diagnosticarConta(C, { hoje: HOJE })
  const parado = d.itens.find(i => i.id === 'MLB9')
  assert.deepEqual([parado.visOk, parado.conv, parado.v], [false, null, null], 'série parada antes do fim: sem conversão (os dias depois de vis_ate somariam zero)')
  assert.deepEqual([d.benchmark.conv, d.benchmark.n, d.benchmark.visitas], [2, 3, 4200], 'benchmark da conta só com as 3 séries inteiras (com o parado seria 3,83%)')
  assert.deepEqual(d.benchmark_categoria.MLB1234, { conv: 2, n: 3, visitas: 4200 }, 'benchmark da categoria idem')
  assert.deepEqual(d.data_quality.cobertura.visitas, { anuncios_cobertos: 3, anuncios_total: 4 })
  assert.equal(d.visitas_sem_mudanca.n, 3, 'o parado sai do controle das quedas dos outros (as visitas que faltam derrubariam o controle)')
  const ima = montarAcoes(C, d, { hoje: HOJE }).filter(a => a.regra === 'anuncio_ima_conversao').map(a => a.item_id)
  assert.deepEqual(ima, [], 'converter igual à conta não é ímã (com o parado no benchmark, MLB1–3 virariam FATO)')
  // fronteira na origem (visitasCobrem, o critério de Mais vendidos): coletada até a véspera do último dia cobre (madrugada antes da coleta do dia, ou UMA
  // coleta diária perdida); parada antes disso não. (Rodada anterior: vis_ate > ate derrubava a conversão da conta toda entre a meia-noite e a coleta.)
  const visOkCom = ate => { db.prepare('UPDATE meli_item SET vis_ate = ? WHERE cliente = ? AND item_id = ?').run(ate, C, 'MLB1'); return carregarBase(C, { hoje: HOJE }).itens.find(i => i.id === 'MLB1').visOk }
  assert.deepEqual([visOkCom(HOJE), visOkCom(D(-1)), visOkCom(D(-2)), visOkCom(D(-3))], [true, true, true, false])
  visOkCom(HOJE)
})

await ok('antes da coleta do dia (vis_ate = ontem) e com uma coleta perdida (anteontem): conversão, benchmark, fonte de visitas e ímã seguem medidos, iguais à tela Mais vendidos', async () => {
  const { maisVendidos } = await import('../src/lib/gmv.js')
  const C = 'Conta madrugada'
  conta(C); coletaDias(C, 3)
  db.transaction(() => {
    for (const id of ['MLB1', 'MLB2', 'MLB3']) { insItem.run(C, id, `Produto ${id}`, 100, HOJE); for (let d = -56; d <= -1; d++) insDia.run(C, id, D(d), 2, 200, 50) }   // 4%
    insItem.run(C, 'MLB4', 'Produto que converte menos', 100, HOJE); for (let d = -56; d <= -1; d++) insDia.run(C, 'MLB4', D(d), 1, 100, 100)                      // 1%
  })()
  const ler = visAte => {
    db.prepare('UPDATE meli_item SET vis_ate = ? WHERE cliente = ?').run(visAte, C)
    const d = diagnosticarConta(C, { hoje: HOJE })
    return { conv: d.itens.map(i => [i.id, i.visOk, i.conv]).sort(), bench: d.benchmark?.conv ?? null, conta: d.resumo.conversao_conta, fonte: d.data_quality.fontes.find(f => /visitas por anúncio/.test(f.fonte)).status,
      ima: montarAcoes(C, d, { hoje: HOJE }).filter(a => a.regra === 'anuncio_ima_conversao').map(a => a.item_id),
      tela: maisVendidos(C, { hoje: HOJE }).map(l => [l.item_id, l.conversao]).sort() }
  }
  const esperado = { conv: [['MLB1', true, 4], ['MLB2', true, 4], ['MLB3', true, 4], ['MLB4', true, 1]], bench: 2.8, conta: 2.8, fonte: 'disponivel', ima: ['MLB4'], tela: [['MLB1', 4], ['MLB2', 4], ['MLB3', 4], ['MLB4', 1]] }
  assert.deepEqual(ler(HOJE), esperado, 'coletada hoje')
  assert.deepEqual(ler(D(-1)), esperado, 'madrugada, antes da coleta do dia: nada some')
  assert.deepEqual(ler(D(-2)), esperado, 'uma coleta diária perdida: nada some (mesma tolerância das outras telas)')
  const parada = ler(D(-3))
  assert.deepEqual([parada.bench, parada.fonte, parada.ima, parada.tela.map(x => x[1])], [null, 'indisponivel', [], [null, null, null, null]], 'duas coletas perdidas: as duas telas deixam de afirmar conversão, juntas')
})

await ok('conta conectada e coletada SEM vendas nem Ads: diagnóstico disponível com zeros medidos e "sem vendas no período", sem regra que dependa de venda; sem coleta na janela continua indisponível', () => {
  const C = 'Conta sem vendas'
  conta(C); coletaDias(C, 0)
  insItem.run(C, 'MLB1', 'Produto parado na vitrine', 100, HOJE)
  for (let d = -56; d <= -1; d++) insDia.run(C, 'MLB1', D(d), 0, 0, 30)          // tem visitas, nenhuma venda
  const d = diagnosticarConta(C, { hoje: HOJE })
  assert.equal(d.disponivel, true); assert.equal(d.motivo, 'sem vendas no período')
  assert.deepEqual([d.resumo.gmv, d.resumo.pedidos, d.resumo.unidades, d.itens.length], [0, 0, 0, 0], 'receita 0 e pedidos 0 são fato medido')
  assert.equal(d.resumo.ticket, null, 'sem pedido não existe ticket (nunca 0)'); assert.equal(d.benchmark, null)
  assert.deepEqual(d.data_quality.cobertura.pedidos.lacunas, [])
  const p = gerarPlanoConta(C, { hoje: HOJE, salvar: false })
  assert.equal(p.disponivel, true)
  assert.deepEqual([...new Set(p.acoes.map(a => a.regra))], ['anuncio_cadastrar_custos'], 'só a pendência de custos (não depende de venda)')
  const sem = 'Conta sem coleta'
  conta(sem)
  const ind = diagnosticarConta(sem, { hoje: HOJE })
  assert.equal(ind.disponivel, false); assert.match(ind.motivo, /sem dados coletados do Mercado Livre/)
})

await ok('"sem vendas" só vale para a janela coletada: 1 de 28 dias coletado → indisponível (dia sem coleta não é zero); 2 dias sem coleta → disponível e o motivo diz quantos dias foram lidos; pedido de anúncio que a coleta não leu nunca vira "sem vendas"', () => {
  const um = 'Conta 1 dia'
  conta(um); db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,0,0,'2026-10-05T05:00:00.000Z')").run(um, D(-1))
  const d1 = diagnosticarConta(um, { hoje: HOJE })
  assert.equal(d1.disponivel, false); assert.match(d1.motivo, /^só 1 de 28 dias do período com coleta de pedidos: sem venda nos dias coletados não prova período sem venda/)
  const dois = 'Conta sem vendas 2 lacunas'
  conta(dois); coletaDias(dois, 0); db.prepare('DELETE FROM meli_coleta_dia WHERE cliente = ? AND dia >= ?').run(dois, D(-2))
  const d2 = diagnosticarConta(dois, { hoje: HOJE })
  assert.equal(d2.disponivel, true); assert.equal(d2.motivo, 'sem vendas nos 26 dias coletados (2 dia(s) sem coleta)'); assert.equal(d2.resumo.variacao.pct, null)
  const orf = 'Conta órfã'
  conta(orf); coletaDias(orf, 3)
  for (let d = -56; d <= -1; d++) insDia.run(orf, 'MLB9', D(d), 3, 150, 0)     // vendas de um anúncio que não está em meli_item (a releitura dos "desconhecidos" falhou)
  const d3 = diagnosticarConta(orf, { hoje: HOJE })
  assert.equal(d3.disponivel, false); assert.equal(d3.motivo, '84 pedido(s) coletado(s) no período sem os dados dos anúncios vendidos — rode a coleta de novo para ler os anúncios')
  for (const t of [d1.motivo, d2.motivo, d3.motivo]) assert.doesNotMatch(t, /MLB|null|undefined/)
})

await ok('arredondamento não cria zero: participação 0,0027%, conversão 0,0036%, CTR, TACOS e participação da publicidade minúsculos ficam > 0; zero medido segue 0', () => {
  const its = classificarCurvas([{ id: 'A', r: 1000000 }, { id: 'B', r: 27 }, { id: 'Z', r: 0 }], null)
  assert.equal(its[1].share_pct, 0.0027); assert.equal(its[2].share_pct, 0); assert.equal(its[0].share_pct, 100)
  const C = 'Conta mínimos'
  conta(C); coletaDias(C, 10)
  db.transaction(() => {
    insItem.run(C, 'MLB1', 'Produto de cauda', 100, HOJE)
    insItem.run(C, 'MLB2', 'Produto campeão', 1000, '')
    for (let d = -28; d <= -1; d++) { insDia.run(C, 'MLB1', D(d), d === -5 ? 1 : 0, d === -5 ? 100 : 0, 1000); insDia.run(C, 'MLB2', D(d), 10, 10000, 0) }
    db.prepare("INSERT INTO meli_ads_item (cliente, item_id, periodo, de, ate, prints, clicks, custo, receita, unidades, status, coletado_em) VALUES (?, 'MLB1', 'atual', ?, ?, 1000000, 1, 1, 1, 0, 'active', '2026-10-05T06:00:00.000Z')").run(C, D(-28), D(-1))
  })()
  const d = diagnosticarConta(C, { hoje: HOJE }), cauda = d.itens.find(i => i.id === 'MLB1')
  assert.equal(d.resumo.gmv, 280100)
  assert.equal(cauda.share_pct, 0.036, '100 de 280.100 = 0,0357%: nunca 0')
  assert.equal(cauda.conv, 0.0036, '1 un / 28.000 visitas: nunca 0')
  assert.equal(cauda.ads.ctr, 0.0001); assert.equal(d.ads.ctr, 0.0001)
  assert.equal(d.ads.tacos, 0.00036); assert.equal(d.ads.participacao_pct, 0.00036)
  assert.equal(d.ads.acos, 100); assert.equal(d.ads.roas, 1, 'valores normais continuam com o arredondamento de sempre')
})

await ok('config e metodologia: margem negativa pelo TACOS do anúncio, priors sem nome interno, versão e listas intactas; §10 documenta TACOS, mínimos de amostra, janelas incompletas e séries paradas', () => {
  const cfg = JSON.parse(readFileSync(new URL('../config/algoritmo.json', import.meta.url), 'utf-8'))
  assert.equal(cfg.versao, '1.6.0')
  const mn = cfg.regras.find(r => r.id === 'margem_negativa')
  assert.match(mn.descricao, /margem antes de Ads − TACOS do anúncio \(custo de Ads ÷ receita total do anúncio\)/); assert.doesNotMatch(mn.descricao, /margem − ACOS/)
  assert.ok(mn.dados.some(x => /TACOS do anúncio/.test(x)) && !mn.dados.some(x => /ACOS de Ads do anúncio/.test(x)))
  for (const [k, v] of Object.entries(cfg.priors_efeito)) assert.doesNotMatch(String(v.fonte || ''), /merov/i, k)
  for (const r of cfg.regras) for (const t of [r.descricao, r.justificativa, ...(r.dados || [])]) assert.doesNotMatch(String(t || ''), /merov/i, r.id)
  assert.match(cfg.priors_efeito.oferta_galeria.fonte, /substituída pelo resultado medido quando houver amostra suficiente/)
  const doc = readFileSync(new URL('../docs/metodologia-algoritmo.md', import.meta.url), 'utf-8'), s10 = doc.slice(doc.indexOf('## 10.'))
  assert.match(s10, /margem_pos_ads \| margem_pre_ads − \*\*TACOS\*\*/); assert.doesNotMatch(s10, /margem_pre_ads − ACOS/); assert.doesNotMatch(s10, /margem − ACOS do anúncio/)
  for (const k of ['min_unidades_controle', 'ads_min_cliques_sem_venda', 'vis_ate ≥ ate − 1', 'Janelas incompletas', 'sem vendas no período', 'algarismos significativos']) assert.ok(s10.includes(k), k)
  assert.doesNotMatch(s10, /vis_ate > ate|< 0,1%/, 'critério e formato da rodada anterior saíram do texto')
})

// ── 2ª rodada (08/10/2026): portão pela cobertura (não pelos anúncios), tela interna com o mesmo critério de visitas, mensagens "sem coleta" × "coletado, sem vendas",
//    vendas de anúncios fora da leitura declaradas no data_quality ──
const { montarAcoes: montarAcoes2, previsaoDoPlano } = await import('../src/lib/plano-anuncios.js')
const { linhasDoPeriodo } = await import('../src/lib/anuncios.js')
const { metricasFull } = await import('../src/lib/full-metricas.js')
const { retroalimentar } = await import('../src/lib/retroalimentacao.js')
const insAdsSoGasto = (cli, id) => db.prepare("INSERT INTO meli_ads_item (cliente, item_id, periodo, de, ate, prints, clicks, custo, receita, unidades, status, coletado_em) VALUES (?, ?, 'atual', ?, ?, 5000, 40, 50, 0, 0, 'active', '2026-10-05T06:00:00.000Z')").run(cli, id, D(-28), D(-1))

await ok('portão pela COBERTURA, não pelos anúncios: anúncio que entra no foco só por gasto de Ads não pula a trava — sem dia coletado é indisponível; com pedidos coletados e nenhum anúncio lido vendendo é "rode a coleta"; coletado com 0 pedidos é disponível com zeros medidos, ticket null com motivo, curva C (não A) e sem regra que dependa de venda', () => {
  const A = 'Conta só Ads sem coleta'
  conta(A); insItem.run(A, 'MLB1', 'Anúncio só com Ads', 100, HOJE); insAdsSoGasto(A, 'MLB1')
  const dA = diagnosticarConta(A, { hoje: HOJE })
  assert.equal(dA.disponivel, false, 'antes: disponível com GMV 0 e previsão contra baseline 0'); assert.match(dA.motivo, /sem dados coletados do Mercado Livre/)
  const B = 'Conta só Ads com pedidos'
  conta(B); coletaDias(B, 3); insItem.run(B, 'MLB1', 'Anúncio só com Ads', 100, HOJE); insAdsSoGasto(B, 'MLB1')
  const dB = diagnosticarConta(B, { hoje: HOJE })
  assert.equal(dB.disponivel, false, 'antes: GMV 0 e ticket R$ 0 com 84 pedidos coletados'); assert.equal(dB.motivo, '84 pedido(s) coletado(s) no período sem os dados dos anúncios vendidos — rode a coleta de novo para ler os anúncios')
  const C = 'Conta só Ads sem vendas'
  conta(C); coletaDias(C, 0); insItem.run(C, 'MLB1', 'Anúncio só com Ads', 100, HOJE); insAdsSoGasto(C, 'MLB1')
  const dC = diagnosticarConta(C, { hoje: HOJE })
  assert.equal(dC.disponivel, true); assert.equal(dC.motivo, 'sem vendas no período')
  assert.deepEqual([dC.resumo.gmv, dC.resumo.pedidos, dC.resumo.unidades, dC.resumo.ticket], [0, 0, 0, null]); assert.match(dC.resumo.ticket_motivo, /não é R\$ 0/)
  assert.equal(dC.itens.length, 1); assert.equal(dC.itens[0].curva, 'C', 'sem receita não há curva A'); assert.deepEqual(dC.resumo.curvas, { A: 0, B: 0, C: 1 })
  const acoes = montarAcoes2(C, dC, { hoje: HOJE }), regras = acoes.map(a => a.regra)
  assert.ok(!regras.includes('anuncio_urgencia_oculta') && !regras.includes('anuncio_catalogo_buybox') && !regras.includes('anuncio_frete_gratis'), 'nenhuma regra que dependa de venda: ' + regras.join(', '))
  assert.ok(regras.includes('anuncio_ads_reduzir'), 'gasto de Ads sem venda é fato e continua nascendo')
  assert.equal(previsaoDoPlano(dC, acoes).cenarios.base.uplift_pct, null, 'baseline 0: uplift não existe (não é 0%)')
  assert.equal(diagnosticarConta('Conta Ads', { hoje: HOJE }).resumo.ticket_motivo, '', 'com pedidos o ticket segue medido e sem motivo')
})

await ok('tela interna (Anúncios no período) lê a cobertura de visitas pelo MESMO critério do diagnóstico (visitasCobrem, com vis_ate): série parada 10 dias antes do fim é "—", não conversão de 44%', () => {
  const C = 'Conta Bench', per = { de: D(-28), ate: D(-1), anterior: { de: D(-56), ate: D(-29) }, ano_anterior: { de: D(-393), ate: D(-366) } }
  const tela = Object.fromEntries(linhasDoPeriodo(C, per).itens.map(i => [i.anuncio_id, [i.visitas, i.conversao]]))
  assert.deepEqual(tela.MLB9, [null, null], 'antes: 190 visitas e conversão 44,21% na tela enquanto o diagnóstico devolvia null')
  assert.deepEqual(tela.MLB1, [1400, 2], 'série inteira segue medida')
  assert.equal(diagnosticarConta(C, { hoje: HOJE }).itens.find(i => i.id === 'MLB9').conv, null, 'as duas leituras concordam')
})

await ok('"sem coleta" × "coletado, sem vendas no período": Full, retroalimentação e rotas de cliente não dizem "não coletado"/"conecte a conta" para conta conectada, coletada e sem venda', async () => {
  const sv = metricasFull('Conta sem vendas', { hoje: HOJE })
  assert.equal(sv.disponivel, false); assert.match(sv.motivo, /conta coletada, sem venda nem Ads no período/); assert.doesNotMatch(sv.motivo, /sem dados coletados|conecte/)
  assert.match(metricasFull('Conta sem coleta', { hoje: HOJE }).motivo, /sem dados coletados do Mercado Livre/)
  assert.equal(metricasFull('Conta só Ads com pedidos', { hoje: HOJE }).motivo, diagnosticarConta('Conta só Ads com pedidos', { hoje: HOJE }).motivo, 'o Full passa pelo mesmo portão do diagnóstico')
  const V = 'Conta coletada vazia'
  conta(V); coletaDias(V, 0)
  const rv = retroalimentar(V, { hoje: HOJE })
  assert.equal(rv.disponivel, false); assert.match(rv.motivo, /^conta coletada \(pedidos lidos de \d\d\/\d\d\/\d{4} a \d\d\/\d\d\/\d{4}\) sem venda registrada/); assert.doesNotMatch(rv.motivo, /conecte/)
  assert.match(retroalimentar('Conta sem coleta', { hoje: HOJE }).motivo, /conecte a conta e rode a coleta/)
  for (const t of [sv.motivo, rv.motivo]) assert.doesNotMatch(t, INTERNO)
  // rotas: conta coletada sem série é "com dados" (lista vazia, cobertura declarada), não "ainda não foram coletados"
  const fetchLocal = globalThis.fetch
  globalThis.fetch = (url, ...r) => /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url)) ? fetchLocal(url, ...r) : Promise.reject(new Error('rede bloqueada no teste'))
  const express = (await import('express')).default, { rotasPlanos } = await import('../src/rotas-planos.js')
  const app = express(); app.use(rotasPlanos)
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  try {
    const get = async c => (await fetchLocal(`http://127.0.0.1:${srv.address().port}${c}`)).json()
    const v = await get(`/api/cliente/vendas?cliente=${encodeURIComponent(V)}`)
    assert.equal(v.disponivel, true, 'antes: "conta conectada, mas os dados ... ainda não foram coletados"'); assert.deepEqual(v.itens, []); assert.equal(v.cobertura.dias, 56)
    const s = await get(`/api/cliente/vendas?cliente=${encodeURIComponent('Conta sem coleta')}`)
    assert.equal(s.disponivel, false); assert.equal(s.conectado, true); assert.match(s.motivo, /ainda não foram coletados/)
  } finally { srv.close(); globalThis.fetch = fetchLocal }
})

await ok('latente declarado: pedidos pagos de anúncios que a leitura não trouxe ficam FORA do GMV — fonte "fora do catálogo lido" parcial com o valor, incompatibilidade e cobertura.fora_do_gmv; sem órfãos a fonte é disponível; sem leitura, não medido', () => {
  const C = 'Conta com órfã'
  conta(C); coletaDias(C, 3)
  insItem.run(C, 'MLB1', 'Produto lido', 100, HOJE)
  for (let d = -28; d <= -1; d++) { insDia.run(C, 'MLB1', D(d), 1, 100, 50); insDia.run(C, 'MLB9', D(d), 2, 100.5, 0) }     // MLB9 não está em meli_item
  const d = diagnosticarConta(C, { hoje: HOJE })
  assert.equal(d.resumo.gmv, 2800, 'o GMV segue só com os anúncios lidos (não muda a conta agora)')
  const f = d.data_quality.fontes.find(x => /fora do catálogo lido/.test(x.fonte))
  assert.equal(f.status, 'parcial'); assert.match(f.definicao, /^1 anúncio\(s\) vendido\(s\) no período sem leitura de anúncio: R\$ 2\.814,00 fora do GMV, do ticket e das curvas/)
  assert.deepEqual(d.data_quality.cobertura.fora_do_gmv, { receita: 2814, anuncios: 1 })
  assert.ok(d.data_quality.incompatibilidades.some(t => /R\$ 2\.814,00 de pedidos pagos de 1 anúncio\(s\) sem leitura de anúncio ficam fora — o GMV não está completo/.test(t)))
  for (const t of [f.definicao, ...d.data_quality.incompatibilidades]) assert.doesNotMatch(t, INTERNO)
  // órfã com unidade > 0 e receita 0 (pedido pago com unit_price 0): status e contador decidem pelo MESMO critério — antes a fonte dizia "todos lidos" com fora_do_gmv.anuncios = 1
  const Z = 'Conta órfã receita zero'
  conta(Z); coletaDias(Z, 3); insItem.run(Z, 'MLB1', 'Produto lido', 100, HOJE)
  for (let d = -28; d <= -1; d++) { insDia.run(Z, 'MLB1', D(d), 1, 100, 50); insDia.run(Z, 'MLB9', D(d), 2, 0, 0) }
  const dz = diagnosticarConta(Z, { hoje: HOJE }), fz = dz.data_quality.fontes.find(x => /fora do catálogo lido/.test(x.fonte))
  assert.deepEqual([dz.resumo.gmv, dz.resumo.unidades, dz.data_quality.cobertura.fora_do_gmv], [2800, 28, { receita: 0, anuncios: 1 }])
  assert.equal(fz.status, 'parcial', 'antes: disponivel ("todos os anúncios vendidos no período foram lidos") contradizendo anuncios: 1'); assert.match(fz.definicao, /^1 anúncio\(s\) vendido\(s\) no período sem leitura de anúncio/)
  assert.ok(dz.data_quality.incompatibilidades.some(t => /1 anúncio\(s\) sem leitura de anúncio ficam fora — as unidades vendidas não estão completas/.test(t)), 'com receita 0 a incompatibilidade fala das unidades, não de "GMV incompleto"')
  const ok0 = diagnosticarConta('Conta Ads', { hoje: HOJE }).data_quality
  assert.equal(ok0.fontes.find(x => /fora do catálogo lido/.test(x.fonte)).status, 'disponivel'); assert.deepEqual(ok0.cobertura.fora_do_gmv, { receita: 0, anuncios: 0 }); assert.ok(!ok0.incompatibilidades.some(t => /fora do GMV|não está completo/.test(t)))
  const nada = qualidadeDados({ conta: null, hoje: HOJE })
  assert.equal(nada.fontes.find(x => /fora do catálogo lido/.test(x.fonte)).status, 'indisponivel'); assert.equal(nada.cobertura.fora_do_gmv, null)
  const doc = readFileSync(new URL('../docs/metodologia-algoritmo.md', import.meta.url), 'utf-8'), s10 = doc.slice(doc.indexOf('## 10.'))
  for (const k of ['portaoColeta', 'ticket_motivo', 'fora_do_gmv', 'visitasCobrem', 'anúncio que entra no foco só por gasto de Ads']) assert.ok(s10.includes(k), '§10 documenta ' + k)
})

// ── saúde da conta gravada (fase 1): com linha do dia os 4 sinais saem do NOT_COLLECTED; bloco pendente fica null com motivo; sem linha continua NOT_COLLECTED; contrato segue válido ──
await ok('saúde gravada: sem linha → Reclamações/Atrasos/Perguntas/Reputação NOT_COLLECTED e resumo null; com linha do dia → números no resumo, fonte "saúde" disponível, bloqueios somem; perguntas 403 → NOT_AUTHORIZED com texto fixo e resumo.perguntas null; metrics.conta do motor recebe e o contrato valida', async () => {
  const { montarDiagnostico, validarContrato } = await import('../src/lib/diagnostico-motor.js')
  const { CFG_SAUDE } = await import('../src/lib/saude-coleta.js')
  const bloq = (d, rx) => d.data_quality.analises_bloqueadas.find(b => rx.test(b.analise)), fonte = d => d.data_quality.fontes.find(f => /saúde da conta/.test(f.fonte))
  let d = diagnosticarConta('Conta Ads', { hoje: HOJE })
  for (const k of ['reclamacoes', 'atrasos', 'perguntas', 'reputacao']) assert.equal(d.resumo[k], null, k)
  for (const rx of [/^Reclamações abertas/, /^Atrasos/, /^Perguntas sem resposta/, /^Reputação da conta/]) assert.equal(bloq(d, rx)?.estado, 'NOT_COLLECTED')
  assert.equal(fonte(d).status, 'indisponivel'); assert.equal(d.data_quality.saude.do_dia, false)
  let j = montarDiagnostico('Conta Ads', { hoje: HOJE, diag: d }); validarContrato(j)
  const chaves = Object.keys(j).sort()
  assert.equal(j.metrics.conta.reclamacoes.valor, null); assert.match(j.metrics.conta.reclamacoes.motivo, /^NOT_COLLECTED/); assert.equal(j.metrics.conta.reputacao.valor, null)
  // linha de ONTEM (aceita_ontem) com perguntas 403
  db.prepare("INSERT INTO meli_conta_saude (cliente, dia, level_id, power_seller, taxa_claims, taxa_atraso, taxa_cancel, vendas_periodo, perguntas_abertas, perguntas_24h, claims_abertas, mediacoes, atrasos, fonte_json, pendente_json, coletado_em) VALUES ('Conta Ads', ?, '5_green', 'gold', 1.5, 2, 0.5, 80, NULL, NULL, 3, 1, 2, '{}', ?, '2026-10-04T05:00:00.000Z')").run(D(-1), JSON.stringify({ perguntas: 'permissao_do_app' }))
  d = diagnosticarConta('Conta Ads', { hoje: HOJE })
  assert.equal(d.resumo.reclamacoes, 3); assert.equal(d.resumo.atrasos, 2); assert.equal(d.resumo.perguntas, null); assert.deepEqual(d.resumo.reputacao, { nivel: '5_green', medalha: 'gold', taxa_claims: 1.5, taxa_atraso: 2, taxa_cancel: 0.5, vendas_periodo: 80 })
  assert.equal(bloq(d, /^Reclamações abertas/), undefined); assert.equal(bloq(d, /^Atrasos/), undefined); assert.equal(bloq(d, /^Reputação da conta/), undefined)
  const p = bloq(d, /^Perguntas sem resposta/); assert.equal(p.estado, 'NOT_AUTHORIZED'); assert.equal(p.motivo, CFG_SAUDE.pendente.permissao_do_app); assert.match(p.como_obter, /Integrações/)
  assert.equal(fonte(d).status, 'parcial'); assert.deepEqual(d.data_quality.saude.sinais, { reputacao: 'disponivel', perguntas: 'pendente:permissao_do_app', reclamacoes: 'disponivel', atrasos: 'disponivel' })
  assert.ok(d.data_quality.analises_bloqueadas.some(b => /^Cancelamentos/.test(b.analise) && b.estado === 'NOT_COLLECTED'), 'cancelamentos e devoluções seguem NOT_COLLECTED')
  j = montarDiagnostico('Conta Ads', { hoje: HOJE, diag: d }); validarContrato(j)
  assert.equal(j.metrics.conta.reclamacoes.valor, 3); assert.ok(j.metrics.conta.reclamacoes.evidence_id); assert.equal(j.metrics.conta.atrasos.valor, 2)
  assert.equal(j.metrics.conta.perguntas.valor, null); assert.match(j.metrics.conta.perguntas.motivo, /^NOT_AUTHORIZED: Perguntas: o app/)
  assert.equal(j.metrics.conta.reputacao.valor, 1.5); assert.equal(j.metrics.conta.reputacao.nivel, '5_green'); assert.match(j.evidence.find(e => e.id === j.metrics.conta.reputacao.evidence_id).texto, /Reputação 5_green \(gold\): reclamações 1.5%/)
  assert.deepEqual(Object.keys(j).sort(), chaves, 'contrato sem chave nova')
  // zero lido é zero (não some): linha de hoje completa com 0 reclamações
  db.prepare("INSERT INTO meli_conta_saude (cliente, dia, claims_abertas, mediacoes, atrasos, perguntas_abertas, perguntas_24h, level_id, fonte_json, pendente_json, coletado_em) VALUES ('Conta Ads', ?, 0, 0, 0, 0, 0, '5_green', '{}', '{}', '2026-10-05T05:00:00.000Z')").run(HOJE)
  d = diagnosticarConta('Conta Ads', { hoje: HOJE }); assert.equal(d.resumo.reclamacoes, 0); assert.deepEqual(d.resumo.perguntas, { abertas: 0, mais_de_24h: 0 }); assert.equal(fonte(d).status, 'disponivel')
  j = montarDiagnostico('Conta Ads', { hoje: HOJE, diag: d }); validarContrato(j); assert.equal(j.metrics.conta.reclamacoes.valor, 0); assert.ok(j.metrics.conta.reclamacoes.evidence_id, 'zero medido vira evidência')
})

console.log(`\n${n} caso(s) ok`)
