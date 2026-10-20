// Autoteste do motor de diagnóstico — parte PURA (frente G1, 08/10/2026): data_quality (qualidadeDados), definições canônicas (DEFINICOES) com paridade contra o que
// diagnosticarConta expõe, benchmark por categoria, metas lidas e category_id gravada/relida por gravarItens ('' quando a API não manda). Banco EM MEMÓRIA
// (PS_DB_MEMORIA=1 antes dos imports dinâmicos): nunca abre data/db.sqlite, nunca chama a API. Outra frente completa este arquivo (contrato das 11 chaves, rotas, IA).
// Rodar: node scripts/teste-diagnostico-motor.mjs
process.env.PS_DB_MEMORIA = '1'
process.env.ANTHROPIC_API_KEY = ''         // a IA nunca é chamada de verdade: só o stub injetado em redigir({ chamar })
const fetchLocal = globalThis.fetch       // rede bloqueada: só a porta efêmera local das rotas (ML/Notion/MP/IA nunca)
globalThis.fetch = (url, ...r) => /^http:\/\/127\.0\.0\.1:\d+\//.test(String(url)) ? fetchLocal(url, ...r) : Promise.reject(new Error('rede bloqueada no teste'))
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const { db } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { qualidadeDados, DEFINICOES, ESTADOS_BLOQUEIO, benchmarkPorCategoria, classificarCurvas, lerMetas, diagnosticarConta, algoritmo } = await import('../src/lib/diagnostico-conta.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-05', D = k => addDias(HOJE, k)
// fixtures do plano por anúncio (scripts/teste-plano-anuncios.mjs:7-18)
const item = (o) => ({ id: 'MLB1', titulo: 'Produto de teste', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x-_JM', thumb: '', preco: 50, estoque: 400, fotos: 8, frete_gratis: true, catalogo: false,
  u: 20, r: 1000, v: 300, u0: 20, r0: 1000, v0: 300, visOk: true, conv: 6.7, vel_dia: 0.71, cobertura: 560, ads: null, ads_ant: null, buy_box: null, logistica: '', avaliacoes: null, ptw: null, ...o })
const QUAL = (fa = [], ta = 0, fb = [], tb = 0) => ({ periodo: { de: '2026-09-07', ate: '2026-10-04' }, atual: { completo: !fa.length && !ta, faltam: fa, truncados: ta }, anterior: { completo: !fb.length && !tb, faltam: fb, truncados: tb } })
const CONTA = { escopos: 'read offline_access', erro: '', atualizado_em: '2026-10-05T08:00:00.000Z' }
const COB = { de: '2026-06-01', ate: '2026-10-04', dias: 126, truncados: 0, lacunas: 0, atualizado_em: '2026-10-05T07:00:00.000Z' }
const ADS = { n: 2, de: '2026-09-07', ate: '2026-10-04', coletado_em: '2026-10-05T06:00:00.000Z' }
const dq = o => qualidadeDados({ conta: CONTA, cob: COB, qualidade: QUAL(), itens: [item(), item({ id: 'MLB2', visOk: false, v: null, v0: null, conv: null })], ads: ADS, promo: null, custos: { percentuais: null, atualizado_em: null, avisos: [] }, metas: null, hoje: HOJE, ...o })
const fonte = (q, rx) => q.fontes.find(f => rx.test(f.fonte)), bloq = (q, rx) => q.analises_bloqueadas.find(b => rx.test(b.analise))

await ok('data_quality: formato (fontes com status/moeda/granularidade/definição, estados da lista fechada, cobertura, incompatibilidades); 3 canais sem API = NOT_SUPPORTED', () => {
  const q = dq()
  assert.ok(q.fontes.length >= 10 && q.fontes.every(f => ['disponivel', 'parcial', 'indisponivel'].includes(f.status) && 'moeda' in f && 'granularidade' in f && 'atualizado_em' in f && 'periodo' in f && typeof f.definicao === 'string'))
  assert.ok(q.fontes.filter(f => f.moeda).every(f => /BRL \(implícita/.test(f.moeda)), 'moeda declarada como implícita')
  assert.ok(q.analises_bloqueadas.every(b => ESTADOS_BLOQUEIO.includes(b.estado) && b.analise && b.motivo && b.como_obter))
  for (const c of ['Amazon', 'Shopee', 'TikTok Shop']) { assert.equal(fonte(q, new RegExp('^' + c)).status, 'indisponivel'); assert.equal(bloq(q, new RegExp(c)).estado, 'NOT_SUPPORTED') }
  assert.deepEqual(q.cobertura.visitas, { anuncios_cobertos: 1, anuncios_total: 2 }); assert.equal(fonte(q, /visitas/).status, 'parcial')
  assert.deepEqual(q.cobertura.ads, { coletado_em: ADS.coletado_em, janela: { de: ADS.de, ate: ADS.ate } })
  assert.ok(q.incompatibilidades.some(t => /Ads tem janela própria de 28 d \(07\/09–04\/10\)/.test(t)) && q.incompatibilidades.some(t => /Visitas cobrem 1 de 2/.test(t)))
  // as 5 pendências do diagnóstico entram como análises bloqueadas (sem custos: NEEDS_EXTERNAL_DATA; CTR orgânico NOT_AVAILABLE; perguntas NOT_AUTHORIZED; busca NOT_SUPPORTED)
  assert.equal(bloq(q, /^Custos/).estado, 'NEEDS_EXTERNAL_DATA'); assert.equal(bloq(q, /CTR orgânicos/).estado, 'NOT_AVAILABLE'); assert.equal(bloq(q, /Perguntas/).estado, 'NOT_AUTHORIZED'); assert.equal(bloq(q, /Posição do anúncio/).estado, 'NOT_SUPPORTED')
  for (const k of ['Cancelamentos', 'Devoluções', 'Reclamações abertas', 'Atrasos', 'Perguntas sem resposta', 'Reputação da conta']) assert.equal(bloq(q, new RegExp('^' + k)).estado, 'NOT_COLLECTED')   // sem linha de saúde: continua NOT_COLLECTED
  assert.equal(q.saude.do_dia, false); assert.deepEqual(Object.values(q.saude.sinais), Array(4).fill('pendente:sem_coleta'))
  assert.equal(bloq(q, /Campanhas de Ads/).estado, 'NOT_SUPPORTED'); assert.equal(bloq(q, /META/).estado, 'NEEDS_EXTERNAL_DATA')
})
await ok('janela com 2 dias faltando → cobertura.pedidos.lacunas com os dias, fonte de pedidos "parcial" e variação bloqueada (null com motivo); janelas inteiras não bloqueiam', () => {
  const q = dq({ qualidade: QUAL(['2026-09-10', '2026-09-11']) })
  assert.deepEqual(q.cobertura.pedidos, { de: COB.de, ate: COB.ate, lacunas: ['2026-09-10', '2026-09-11'], truncados: 0 })
  assert.equal(fonte(q, /pedidos pagos/).status, 'parcial')
  const v = bloq(q, /Variação/); assert.ok(v && v.estado === 'NOT_COLLECTED' && /2 dia\(s\) sem coleta \(10\/09, 11\/09\)/.test(v.motivo) && /recoletar/.test(v.como_obter), JSON.stringify(v))
  assert.ok(bloq(dq({ qualidade: QUAL([], 0, ['2026-08-20']) }), /Variação/), 'lacuna no período ANTERIOR também bloqueia a comparação')
  const c = dq(); assert.equal(bloq(c, /Variação/), undefined); assert.equal(fonte(c, /pedidos pagos/).status, 'disponivel'); assert.deepEqual(c.cobertura.pedidos.lacunas, [])
})
await ok('dia truncado pela API → fonte "parcial", truncados = 1 e variação bloqueada com o motivo', () => {
  const q = dq({ qualidade: QUAL([], 1) })
  assert.equal(fonte(q, /pedidos pagos/).status, 'parcial'); assert.equal(q.cobertura.pedidos.truncados, 1); assert.match(bloq(q, /Variação/).motivo, /1 dia\(s\) truncado/)
})
await ok('sem meli_contas → fonte da conta "indisponivel" + análise NOT_COLLECTED com como_obter; conta com erro de renovação → "parcial"; com conta, sem bloqueio geral', () => {
  const q = dq({ conta: null, cob: null, ads: null })
  assert.equal(fonte(q, /conta \(OAuth\)/).status, 'indisponivel'); assert.equal(fonte(q, /pedidos pagos/).status, 'indisponivel'); assert.equal(fonte(q, /Product Ads/).status, 'indisponivel'); assert.equal(q.cobertura.ads, null)
  const b = bloq(q, /Dados do Mercado Livre/); assert.ok(b && b.estado === 'NOT_COLLECTED' && /conectar a conta/.test(b.como_obter))
  assert.equal(fonte(dq({ conta: { ...CONTA, erro: 'invalid_grant' } }), /conta \(OAuth\)/).status, 'parcial')
  assert.equal(bloq(dq(), /Dados do Mercado Livre/), undefined)
})
await ok('custos, metas e promoções: fonte "disponivel" só com dado; sem custos é NEEDS_EXTERNAL_DATA; com meta a análise de Ads × meta sai da lista', () => {
  const CC = { cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const q = dq({ custos: { percentuais: CC, atualizado_em: '2026-10-01T00:00:00.000Z', avisos: ['Custos Bling sem sincronização há 5 dias (limite 3).'] }, metas: { gmv: 100, roas: null, acos_max: 20, margem_pct: null }, promo: { estado: 'concluida', concluida_em: '2026-10-04T18:00:00.000Z' } })
  assert.equal(fonte(q, /^Custos/).status, 'disponivel'); assert.match(fonte(q, /^Custos/).definicao, /Bling/); assert.equal(bloq(q, /^Custos/), undefined)
  assert.equal(fonte(q, /Metas/).status, 'disponivel'); assert.match(fonte(q, /Metas/).definicao, /gmv, acos_max/); assert.equal(bloq(q, /META/), undefined)
  assert.equal(fonte(q, /promoções/).status, 'disponivel'); assert.equal(fonte(q, /promoções/).atualizado_em, '2026-10-04T18:00:00.000Z')
  assert.ok(q.incompatibilidades.some(t => /custo vinculado/.test(t)))
  assert.equal(fonte(dq(), /promoções/).status, 'indisponivel')
})
await ok('DEFINICOES: toda métrica declara texto/fórmula/denominador/período/fonte/onde; dado não coletado tem fórmula null; definições canônicas do plano', () => {
  for (const [k, d] of Object.entries(DEFINICOES)) assert.ok(d.texto && 'formula' in d && 'denominador' in d && 'periodo' in d && d.fonte && Array.isArray(d.onde), k)
  for (const k of ['cancelamentos', 'devolucoes']) { assert.equal(DEFINICOES[k].formula, null); assert.match(DEFINICOES[k].fonte, /NOT_COLLECTED/) }
  for (const k of ['reclamacoes', 'atrasos', 'perguntas', 'reputacao']) { assert.ok(DEFINICOES[k].formula, k); assert.match(DEFINICOES[k].fonte, /meli_conta_saude/) }   // saúde gravada (fase 1)
  assert.match(DEFINICOES.ticket.formula, /receita ÷ pedidos pagos/); assert.match(DEFINICOES.preco_pago.formula, /receita ÷ unidades/); assert.match(DEFINICOES.conversao_anuncio.formula, /visOk.*null se > 100%/)
  assert.match(DEFINICOES.conversao_conta.formula, /anuncios_cobertos\/anuncios_total/); assert.match(DEFINICOES.margem_pos_ads.formula, /Ads descontado UMA vez/); assert.match(DEFINICOES.ponto_reposicao.formula, /PREMISSA lead_time_reposicao_dias/)
  assert.match(DEFINICOES.participacao_publicidade.formula, /receita atribuída a Ads ÷ GMV/); assert.match(DEFINICOES.variacao.formula, /null com motivo/)
  for (const k of ['receita', 'pedidos', 'unidades', 'ticket', 'preco_pago', 'conversao_anuncio', 'conversao_conta', 'ctr_ads', 'cpc', 'custo_por_pedido_ads', 'acos', 'roas', 'tacos', 'participacao_publicidade', 'margem_pre_ads', 'margem_pos_ads', 'cobertura', 'giro', 'ponto_reposicao', 'variacao']) assert.ok(DEFINICOES[k], k)
  assert.ok(algoritmo.premissas.limiares.includes('lead_time_reposicao_dias'), 'o lead time é premissa rotulada no config')
})
await ok('lerMetas: só números > 0 das 4 metas que o plano usa; sem nenhuma delas (ou só entregas) → null; JSON inválido → null', () => {
  assert.deepEqual(lerMetas('{"gmv":100,"entregas":20}'), { gmv: 100, roas: null, acos_max: null, margem_pct: null })
  assert.deepEqual(lerMetas('{"acos_max":"20","roas":4.5}'), { gmv: null, roas: 4.5, acos_max: 20, margem_pct: null })
  assert.equal(lerMetas('{"entregas":20}'), null); assert.equal(lerMetas('{"gmv":0}'), null); assert.equal(lerMetas(''), null); assert.equal(lerMetas('{nope'), null); assert.equal(lerMetas(undefined), null)
})
await ok('benchmarkPorCategoria: só categorias com ≥ 3 anúncios A/B cobertos com visitas suficientes; sem categoria ("") fica fora; sem cobertura de visitas, nada', () => {
  const its = [item({ id: 'MLB1', r: 5000, u: 60, v: 600, conv: 10, category_id: 'MLBCAT1' }), item({ id: 'MLB2', r: 4000, u: 40, v: 500, conv: 8, category_id: 'MLBCAT1' }), item({ id: 'MLB3', r: 3000, u: 20, v: 400, conv: 5, category_id: 'MLBCAT1' }),
    item({ id: 'MLB4', r: 3000, u: 30, v: 300, conv: 10, category_id: 'MLBCAT2' }), item({ id: 'MLB5', r: 2500, u: 30, v: 300, conv: 10, category_id: 'MLBCAT2' }), item({ id: 'MLB6', r: 2500, u: 30, v: 300, conv: 10, category_id: '' })]
  classificarCurvas(its, null)
  const b = benchmarkPorCategoria(its)
  assert.deepEqual([...b.keys()], ['MLBCAT1']); assert.deepEqual(b.get('MLBCAT1'), { conv: 8, n: 3, visitas: 1500 })
  assert.equal(benchmarkPorCategoria(its.map(i => ({ ...i, visOk: false }))).size, 0)
})

// ── banco em memória: category_id gravada e relida por gravarItens; diagnosticarConta expõe metas, data_quality, definições e benchmark_ref; paridade DEFINICOES.onde ──
const A = 'Cliente A'
await ok('gravarItens grava category_id do multiget e relê ("" quando a API não manda: nada inventado); coluna idempotente', () => {
  const api = (id, extra = {}) => ({ id, title: 'Produto ' + id, price: 50, available_quantity: 400, pictures: Array(8).fill({}), shipping: { free_shipping: true }, status: 'active', date_created: '2025-01-01T00:00:00.000Z', ...extra })
  gravarItens(A, [api('MLB1', { category_id: 'MLBCAT1' }), api('MLB2', { category_id: 'MLBCAT1' }), api('MLB3', { category_id: 'MLBCAT1' }), api('MLB4')], { t: '2026-10-05T05:00:00.000Z', dia: HOJE })
  assert.deepEqual(db.prepare('SELECT item_id, category_id FROM meli_item WHERE cliente = ? ORDER BY item_id').all(A), [{ item_id: 'MLB1', category_id: 'MLBCAT1' }, { item_id: 'MLB2', category_id: 'MLBCAT1' }, { item_id: 'MLB3', category_id: 'MLBCAT1' }, { item_id: 'MLB4', category_id: '' }])
  gravarItens(A, [api('MLB4', { category_id: 'MLBCAT9' })], { t: '2026-10-05T06:00:00.000Z', dia: HOJE })
  assert.equal(db.prepare('SELECT category_id FROM meli_item WHERE cliente = ? AND item_id = ?').get(A, 'MLB4').category_id, 'MLBCAT9', 'recoleta atualiza')
  gravarItens(A, [api('MLB4')], { t: '2026-10-05T07:00:00.000Z', dia: HOJE })
  assert.equal(db.prepare('SELECT category_id FROM meli_item WHERE cliente = ? AND item_id = ?').get(A, 'MLB4').category_id, '', 'resposta sem category_id → "" (o que a API devolveu)')
  assert.equal(db.prepare("PRAGMA table_info(meli_item)").all().filter(c => c.name === 'category_id').length, 1)
})
await ok('diagnosticarConta (memória): metas, ads.anterior.ctr/cpc/participação, benchmark por categoria com fonte declarada, data_quality com as lacunas reais, variação null com motivo (delta_pct das telas intacto), não coletadas = null, e PARIDADE: todo caminho de DEFINICOES.onde existe', () => {
  const insSerie = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  const insCob = db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,8,0,'2026-10-05T05:00:00.000Z')")
  const insAds = db.prepare("INSERT INTO meli_ads_item (cliente, item_id, periodo, de, ate, prints, clicks, custo, receita, unidades, status, coletado_em) VALUES (?,?,?,?,?,?,?,?,?,?,'active','2026-10-05T06:00:00.000Z')")
  db.transaction(() => {
    db.prepare("UPDATE meli_item SET vis_de = '2025-01-01', vis_ate = ? WHERE cliente = ?").run(HOJE, A)
    for (let d = -56; d <= -1; d++) { for (const id of ['MLB1', 'MLB2', 'MLB3', 'MLB4']) insSerie.run(A, id, D(d), 2, 100, 20); if (d !== -3 && d !== -4) insCob.run(A, D(d)) }   // 2 dias sem coleta na janela atual
    insAds.run(A, 'MLB1', 'atual', D(-28), D(-1), 5000, 100, 100, 500, 5); insAds.run(A, 'MLB1', 'anterior', D(-56), D(-29), 4000, 100, 90, 450, 4)
    db.prepare("INSERT INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 1, 'x', 'x', '2026-12-01', 'read offline_access', '2026-01-01', '2026-10-05T04:00:00.000Z')").run(A)
    db.prepare("INSERT INTO custos_cliente (cliente, custos_json, atualizado_em) VALUES (?, ?, '2026-10-01T00:00:00.000Z')").run(A, JSON.stringify({ cmv_pct: 40, comissao_pct: 16, imposto_pct: 6 }))
    db.prepare("INSERT INTO metas_cliente (cliente, mes, metas_json, atualizado_em) VALUES (?, '2026-10', ?, 'x')").run(A, JSON.stringify({ acos_max: 20, entregas: 10 }))
  })()
  const diag = diagnosticarConta(A, { hoje: HOJE })
  assert.equal(diag.disponivel, true); assert.equal(diag.algoritmo_versao, '1.6.0'); assert.equal(diag.definicoes, DEFINICOES)
  assert.deepEqual(diag.metas, { gmv: null, roas: null, acos_max: 20, margem_pct: null })
  assert.equal(diag.ads.anterior.ctr, 2.5); assert.equal(diag.ads.ctr, 2); assert.equal(diag.ads.cpc, 1); assert.equal(diag.ads.custo_por_pedido, 20); assert.equal(typeof diag.ads.participacao_pct, 'number')
  // asserção alterada (08/10, motivo declarado): diagnostico-conta.js (outra frente) passou margem_pos_ads a descontar o TACOS (Ads ÷ receita total), não o ACOS
  assert.equal(diag.margem_pos_ads_pct, Math.round((38 - diag.ads.tacos) * 10) / 10, 'margem depois de Ads = margem pré − TACOS (uma vez)')
  assert.deepEqual(Object.keys(diag.benchmark_categoria), ['MLBCAT1']); assert.equal(diag.benchmark_categoria.MLBCAT1.n, 3)
  assert.match(diag.itens.find(i => i.id === 'MLB1').benchmark_ref.fonte, /própria conta \(categoria MLBCAT1\)/); assert.equal(diag.itens.find(i => i.id === 'MLB4').benchmark_ref.fonte, 'própria conta')
  assert.deepEqual(diag.data_quality.cobertura.pedidos.lacunas, [D(-4), D(-3)]); assert.equal(diag.data_quality.fontes.find(f => /pedidos pagos/.test(f.fonte)).status, 'parcial')
  assert.equal(typeof diag.resumo.delta_pct, 'number', 'as telas antigas seguem com delta_pct'); assert.equal(diag.resumo.variacao.pct, null); assert.match(diag.resumo.variacao.motivo, /2 dia\(s\) sem coleta/)
  assert.ok(diag.resumo.pedidos > 0 && diag.resumo.ticket > 0)
  for (const k of ['cancelamentos', 'devolucoes', 'reclamacoes', 'atrasos']) assert.equal(diag.resumo[k], null)
  for (const [rx, st] of [[/conta \(OAuth\)/, 'disponivel'], [/Metas/, 'disponivel'], [/^Custos/, 'disponivel'], [/^Amazon/, 'indisponivel']]) assert.equal(diag.data_quality.fontes.find(f => rx.test(f.fonte)).status, st, String(rx))
  assert.ok(diag.data_quality.incompatibilidades.some(t => /Ads tem janela própria/.test(t)))
  assert.equal(diag.pendencias.length, 4, 'array pendencias intacto (com custos informados são 4)')
  assert.ok(diag.visitas_sem_mudanca.n === 4 && diag.itens.every(i => Array.isArray(i.mudancas_28d) && 'giro' in i && 'ponto_reposicao' in i && 'category_id' in i && 'ctr' in (i.ads_ant || { ctr: null })))
  // paridade: todo caminho declarado em DEFINICOES.onde existe (a chave pode ser null — ausente ≠ zero —, mas tem que existir)
  const tem = (o, path) => { const [k, ...rest] = path.split('.'); if (k.endsWith('[]')) { const arr = o?.[k.slice(0, -2)]; return Array.isArray(arr) && arr.some(x => rest.length ? tem(x, rest.join('.')) : true) } if (!o || typeof o !== 'object' || !(k in o)) return false; return rest.length ? tem(o[k], rest.join('.')) : true }
  for (const [k, d] of Object.entries(DEFINICOES)) for (const p of d.onde) assert.ok(tem(diag, p), `${k}: caminho "${p}" não existe no diagnóstico`)
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// G4 — contrato JSON das 11 chaves (diagnostico-motor.js), validador, prompts derivados, IA (ia.js redigir), render em PT e rotas (porta efêmera)
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
import express from 'express'
const { montarDiagnostico, diagnosticoDoCliente, validarContrato, VERSAO, PROMPT_POR_REGRA, REGRAS_OPORTUNIDADE } = await import('../src/lib/diagnostico-motor.js')
const { renderDiagnosticoMotor, leituraDeterministica } = await import('../src/lib/render-diagnostico-motor.js')
const { redigir, numerosFora, auditarInterno } = await import('../src/lib/ia.js')
const { montarAcoes, salvarAcoesAnuncio } = await import('../src/lib/plano-anuncios.js')
const { benchmarkConversao } = await import('../src/lib/diagnostico-conta.js')
const { rotasPlanos } = await import('../src/rotas-planos.js')
const { auditarTexto } = await import('../src/lib/relatorio-seguro.js')

// ── fixtures puras: diagnóstico sintético (molde de teste-plano-anuncios.mjs) + retroalimentação sintética ──
function diagDe(itens, extra = {}) {
  classificarCurvas(itens, null); const b = benchmarkConversao(itens); classificarCurvas(itens, b?.conv)
  for (const i of itens) i.benchmark_ref = b ? { conv: b.conv, fonte: 'própria conta' } : null
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: '__teste__', hoje: HOJE, periodo: { de: '2026-09-07', ate: '2026-10-04', anterior: { de: '2026-08-10', ate: '2026-09-06' } },
    resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, unidades: itens.reduce((t, i) => t + i.u, 0), pedidos: 90, ticket: gmv / 90, variacao: { pct: 0, motivo: '' }, cancelamentos: null, devolucoes: null, reclamacoes: null, atrasos: null, conversao_conta: b?.conv ?? null, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: b, benchmark_categoria: {}, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, cpc: null, custo_por_pedido: null, participacao_pct: null, clicks: 0, prints: 0, unidades: 0, anterior: { roas: null, ctr: null, prints: 0, clicks: 0 } }, economia: null, margem_pos_ads_pct: null, custos_informados: false, custos: null, metas: null,
    causal: { disponivel: true, deltas: {}, elo: null, leitura: 'Sem ruptura relevante de receita no período (queda < 10%).' }, itens, janelas: [], pendencias: [], data_quality: dq(), definicoes: DEFINICOES, visitas_sem_mudanca: { n: 3, u: 100, v: 1000, u0: 100, v0: 1000 }, vendas_dia_sem_mudanca: {}, gerado_em: '2026-10-05T08:00:00.000Z', algoritmo_versao: algoritmo.versao, ...extra }
}
const estrategia = (classe, o = {}) => ({ classe, justificativa: 'sintética', confianca: 'hipotese', revisar_em: '2026-10-19', provisoria: true, faltam: ['caixa', 'capacidade', 'mercado'], condicoes_revisao: ['Reavaliar em 14 dias.'], evidencias: [], ...o })
const retroDe = (itens, o = {}) => ({ disponivel: true, estado: { estado: 'queda', rotulo: 'Queda', variacao_pct: -30, forca: 'forte', significativo: true, sinal_misto: false, motivo: 'receita −30% em 14 dias' }, estrategia: estrategia('Sobrevivência'),
  estrategia_por_grupo: { A: { curva: 'A', n_anuncios: 2, estado: { estado: 'queda' }, estrategia: estrategia('Sobrevivência') }, B: { curva: 'B', n_anuncios: 0, estado: null, estrategia: null, motivo: '0 anúncio(s)' }, C: { curva: 'C', n_anuncios: 0, estado: null, estrategia: null, motivo: '0 anúncio(s)' } },
  pareto: { itens: paretoDe(itens) }, ciclo_anterior: null, ...o })
const paretoDe = itens => { const t = itens.reduce((s, i) => s + i.r, 0); const top = [...itens].sort((a, b) => b.r - a.r); return { disponivel: true, n_80: 1, n_anuncios: itens.length, concentracao_top1_pct: Math.round(1000 * top[0].r / t) / 10, alerta: null, leitura: '1 de ' + itens.length + ' anúncios geram 80% da receita.', itens: top.slice(0, 1).map(i => ({ id: i.id, titulo: i.titulo, share_pct: Math.round(1000 * i.r / t) / 10, acum_pct: 80 })) } }
const CHAVES_11 = ['data_quality', 'metrics', 'evidence', 'account_diagnosis', 'listing_diagnoses', 'campaign_diagnoses', 'issues', 'opportunities', 'actions', 'derived_prompts', 'review_plan']
// ação sintética já no formato de acoes_plano hidratada (o que lerAcoes devolve), para casos que não dependem de uma regra disparar
// id = sha1(regra|item) como o idAcao real (o antigo cortava "ima_conversaoMLB5" e "…MLB6" no mesmo id: o validador agora recusa ação duplicada)
const acaoDe = (regra, item, o = {}, dados = {}) => ({ id: 'PS-' + createHash('sha1').update(regra + '|' + item).digest('hex').slice(0, 10), cliente: '__teste__', regra: 'anuncio_' + regra, titulo: `${regra} (${item})`, horizonte: '7d', prazo: '2026-10-12', responsavel: '', score: 60, item_id: item, status: 'proposta', previsao: null,
  dados: { evidencia_tipo: 'fato', evidencia: `evidência de ${regra} em ${item}`, problema: `problema ${regra}`, hipotese: 'hipótese', como: ['passo'], indicador_inicial: 'x 1', meta: 'x 2', criterio_aceite: 'a', prioridade: { p: 'P1', nota: 60, componentes: {} }, entidade: { tipo: 'anuncio', id: item }, nivel: 'anuncio', causas_possiveis: [], confirmar_com: [], parada: 'p', prova_janela_dias: 14, revisar_em: '2026-10-26', depende_de: [], executar_via: 'notion', item: { id: item, titulo: 'Produto ' + item, catalogo_origem: 'nao' }, ...dados }, ...o })
// JSON mínimo válido do contrato (também em docs/motor-diagnostico.md): uma métrica com evidência, uma ação citando-a, um prompt pronto
const MINIMO = () => ({ versao: VERSAO, canal: 'mercadolivre', cliente: 'Mínimo', gerado_em: '2026-10-05T08:00:00.000Z', periodo: { de: '2026-09-07', ate: '2026-10-04', anterior: { de: '2026-08-10', ate: '2026-09-06' } }, disponivel: true,
  canais_suportados: { mercadolivre: 'SUPPORTED', amazon: 'NOT_SUPPORTED', shopee: 'NOT_SUPPORTED', tiktok: 'NOT_SUPPORTED' },
  data_quality: { fontes: [{ fonte: 'Mercado Livre — pedidos pagos', status: 'disponivel' }], cobertura: { pedidos: { de: '2026-06-01', ate: '2026-10-04', lacunas: [], truncados: 0 } }, analises_bloqueadas: [{ analise: 'Diagnóstico de Amazon', motivo: 'canal sem integração', estado: 'NOT_SUPPORTED', como_obter: '—' }], incompatibilidades: [] },
  metrics: { conta: { receita: { valor: 1000, formula: 'Σ unit_price × quantity', denominador: null, periodo: '28 dias', fonte: 'meli_serie_item', evidence_id: 'ev-0000000001' }, margem_pre_ads: { valor: null, formula: '100 − custos', denominador: 'preço', periodo: 'custos vigentes', fonte: 'custos_cliente', evidence_id: null, motivo: 'custos não informados' } }, por_curva: { A: {}, B: {}, C: {} }, anuncios: [] },
  evidence: [{ id: 'ev-0000000001', tipo: 'fato', chave: 'conta:receita', valor: 1000, unidade: 'BRL', texto: 'Receita: 1000', fonte: 'meli_serie_item', periodo: '2026-09-07..2026-10-04' }],
  account_diagnosis: { estado: { estado: 'estagnacao' }, estrategia: { classe: 'Manutenção', provisoria: true, faltam: ['caixa', 'capacidade', 'mercado'] }, por_grupo: null, causal: null, concentracao: null, evidence_ids: ['ev-0000000001'] },
  listing_diagnoses: [], campaign_diagnoses: { granularidade: 'anuncio', itens: [], pendencia: { estado: 'NOT_SUPPORTED', item: 'campanhas de Product Ads', motivo: 'não coletado' } },
  issues: [], opportunities: [],
  actions: [{ id: 'PS-0000000001', regra: 'ima_conversao', entidade: { tipo: 'anuncio', id: 'MLB1' }, o_que: 'Quebrar objeções', por_que: { evidence_ids: ['ev-0000000001'] }, responsavel: '', prazo: '2026-10-12', horizonte: '7d', depende_de: [], limites: [], metrica_sucesso: { indicador: 'conversão 1%', meta: 'conversão 2%' }, parada: 'reverter', revisar_em: '2026-10-26', prioridade: { p: 'P1', nota: 60, componentes: null }, previsao: null, executar_via: 'notion', status: 'proposta' }],
  derived_prompts: [{ id: 'dp-0000000001', tipo: 'titulo_descricao', entidade: { tipo: 'anuncio', id: 'MLB1' }, acao_id: 'PS-0000000001', estado: 'pronto', insumos: {}, restricoes: { preservar: [], proibido: ['inventar característica'] }, insumos_faltantes: [], texto: 'Redigir título a partir da ficha.' }],
  review_plan: { ritual: { semanal: 'gerar plano' }, proximas_revisoes: [{ acao_id: 'PS-0000000001', em: '2026-10-26', o_que_conferir: 'conversão' }], ciclo_anterior: null, sinal_misto: false } })

await ok('validarContrato: o JSON mínimo válido passa; 4 variantes falham com frase fixa (sem data_quality; evidence_id órfão; métrica com valor sem fórmula; provisoria=false com faltam cheio); valor 0 com motivo é rejeitado (ausente ≠ zero)', () => {
  assert.deepEqual(validarContrato(MINIMO()), { ok: true, erros: [] })
  const semDq = MINIMO(); delete semDq.data_quality; assert.match(validarContrato(semDq).erros.join('|'), /falta a chave "data_quality"/)
  const orfao = MINIMO(); orfao.actions[0].por_que.evidence_ids = ['ev-ffffffffff']; assert.match(validarContrato(orfao).erros.join('|'), /evidence_id órfão em actions\.por_que/)
  const semFormula = MINIMO(); semFormula.metrics.conta.receita.formula = ''; assert.match(validarContrato(semFormula).erros.join('|'), /valor e sem fórmula em metrics\.conta\.receita/)
  const naoProv = MINIMO(); naoProv.account_diagnosis.estrategia.provisoria = false; assert.match(validarContrato(naoProv).erros.join('|'), /precisa ser provisória/)
  const zero = MINIMO(); zero.metrics.conta.receita.valor = 0; zero.metrics.conta.receita.motivo = 'sem venda'; assert.match(validarContrato(zero).erros.join('|'), /valor 0 e motivo/)
  const nuloSemMotivo = MINIMO(); delete nuloSemMotivo.metrics.conta.margem_pre_ads.motivo; assert.match(validarContrato(nuloSemMotivo).erros.join('|'), /nula sem motivo/)
  const promessa = MINIMO(); promessa.derived_prompts[0].texto = 'Título que garante a primeira página'; assert.match(validarContrato(promessa).erros.join('|'), /reprovado no auditor interno/)
  const versao = MINIMO(); versao.versao = '0.0.1'; assert.match(validarContrato(versao).erros.join('|'), /versao diferente/)
  for (const e of validarContrato(orfao).erros) assert.ok(!/ffffffffff/.test(e), 'a mensagem nunca ecoa o valor recebido')
})
await ok('montarDiagnostico (puro): 11 chaves + cabeçalho (versao = algoritmo, canal, 4 canais), validador ok, toda métrica não nula tem evidência (id estável por cliente|chave|período), sem custos → margem_* null com motivo, nenhuma issue margem_negativa, render interno e ao cliente sem "lucro"/"prejuízo"', () => {
  const bom = item({ id: 'MLB10', r: 5000, u: 100, v: 600, conv: 16.7 }), ima = item({ id: 'MLB11', r: 3000, u: 30, v: 500, conv: 6, frete_gratis: false, fotos: 3 }), rup = item({ id: 'MLB12', r: 9000, u: 120, estoque: 6, cobertura: 1, vel_dia: 4.3 })
  const diag = diagDe([bom, ima, rup]), acoes = montarAcoes('__teste__', diag, { hoje: HOJE })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, retro: retroDe(diag.itens) })
  for (const k of CHAVES_11) assert.ok(k in j, k)
  assert.equal(j.versao, algoritmo.versao); assert.equal(j.canal, 'mercadolivre'); assert.deepEqual(j.canais_suportados, { mercadolivre: 'SUPPORTED', amazon: 'NOT_SUPPORTED', shopee: 'NOT_SUPPORTED', tiktok: 'NOT_SUPPORTED' })
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const ids = new Set(j.evidence.map(e => e.id))
  const todas = [...Object.values(j.metrics.conta), ...['A', 'B', 'C'].flatMap(c => Object.entries(j.metrics.por_curva[c]).filter(([k]) => k !== 'estrategia').map(([, m]) => m)), ...j.metrics.anuncios.flatMap(a => Object.values(a.metrics))]
  for (const m of todas) { if (m.valor != null) assert.ok(ids.has(m.evidence_id), 'métrica com valor cita evidência existente'); else assert.ok(m.motivo && m.evidence_id === null, 'métrica nula leva motivo') }
  const j2 = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, retro: retroDe(diag.itens) })
  assert.equal(j.metrics.conta.receita.evidence_id, j2.metrics.conta.receita.evidence_id, 'id estável (sha1 de cliente|chave|período)')
  assert.notEqual(j.metrics.conta.receita.evidence_id, montarDiagnostico('outro', { hoje: HOJE, diag, acoes }).metrics.conta.receita.evidence_id)
  assert.equal(j.metrics.conta.margem_pre_ads.valor, null); assert.match(j.metrics.conta.margem_pre_ads.motivo, /custos não informados/); assert.equal(j.metrics.conta.margem_pos_ads.valor, null)
  assert.ok(j.metrics.anuncios.every(a => a.metrics.margem_pre_ads.valor === null))
  assert.ok(!j.issues.some(i => i.regra === 'margem_negativa') && !j.actions.some(a => a.regra === 'margem_negativa'))
  for (const k of ['cancelamentos', 'devolucoes', 'reclamacoes', 'atrasos']) { assert.equal(j.metrics.conta[k].valor, null); assert.match(j.metrics.conta[k].motivo, /NOT_COLLECTED/) }
  for (const para of ['interno', 'cliente']) { const html = renderDiagnosticoMotor(j, { para }); assert.doesNotMatch(html, /lucro|prejuízo/i, para); assert.match(html, /Sem custos informados/) }
  assert.ok(j.issues.some(i => i.regra === 'estoque_ruptura') && j.issues.some(i => i.regra === 'ima_conversao'), 'regras de problema viram issues')
  assert.ok(j.opportunities.every(o => REGRAS_OPORTUNIDADE.has(o.regra)) && j.issues.every(i => !REGRAS_OPORTUNIDADE.has(i.regra)))
  assert.ok(j.actions.every(a => ['oferta', 'promocoes', 'notion'].includes(a.executar_via)), 'nenhum executor novo')
  assert.ok(j.account_diagnosis.evidence_ids.every(id => ids.has(id)) && j.account_diagnosis.concentracao.top1_pct > 0)
  assert.equal(j.campaign_diagnoses.granularidade, 'anuncio'); assert.equal(j.campaign_diagnoses.pendencia.estado, 'NOT_SUPPORTED')
  assert.ok(j.review_plan.proximas_revisoes.some(r => r.acao_id === 'conta' && r.em === '2026-10-19') && j.review_plan.proximas_revisoes.every(r => r.o_que_conferir) && j.review_plan.ritual.semanal)
})
await ok('dia truncado e lacuna → data_quality.cobertura.pedidos.{truncados,lacunas} no contrato e variação null com motivo (nunca zero); estratégia copiada da retroalimentação com provisoria e faltam (conta e por grupo)', () => {
  const diag = diagDe([item({ id: 'MLB1' })], { data_quality: dq({ qualidade: QUAL(['2026-09-10'], 1) }), resumo: { ...diagDe([item({ id: 'MLB1' })]).resumo, variacao: { pct: null, motivo: '1 dia(s) sem coleta e 1 dia(s) truncado(s) nas janelas comparadas' } } })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [], retro: retroDe(diag.itens) })
  assert.equal(j.data_quality.cobertura.pedidos.truncados, 1); assert.deepEqual(j.data_quality.cobertura.pedidos.lacunas, ['2026-09-10'])
  assert.equal(j.metrics.conta.variacao.valor, null); assert.match(j.metrics.conta.variacao.motivo, /truncado/)
  assert.equal(j.account_diagnosis.estrategia.classe, 'Sobrevivência'); assert.equal(j.account_diagnosis.estrategia.provisoria, true); assert.deepEqual(j.account_diagnosis.estrategia.faltam, ['caixa', 'capacidade', 'mercado'])
  assert.equal(j.account_diagnosis.por_grupo.A.estrategia.provisoria, true); assert.equal(j.metrics.por_curva.A.estrategia.classe, 'Sobrevivência')
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const semRetro = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [] })
  assert.equal(semRetro.account_diagnosis.estrategia, null); assert.equal(semRetro.account_diagnosis.estado.estado, null); assert.ok(validarContrato(semRetro).ok)
})
await ok('preço como confundidor: queda_conversao com mudança de preço → causas_possiveis[0] = { causa: "preco", tipo: "hipotese" } em listing_diagnoses e issues; a evidência da ação entra em evidence como FATO', () => {
  const caiu = item({ id: 'MLB400', r: 4000, u: 20, v: 400, conv: 5, u0: 40, v0: 400, r0: 8000, mudancas_28d: [{ dia: '2026-09-25', campo: 'preco', de: 50, para: 60, pct: 20, fonte: 'coleta' }], mudancas_preco_28d: [{ dia: '2026-09-25', de: 50, para: 60, pct: 20 }] })
  const outro = item({ id: 'MLB401', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })
  const diag = diagDe([caiu, outro], { visitas_sem_mudanca: { n: 3, u: 100, v: 1000, u0: 100, v0: 1000 } }), acoes = montarAcoes('__teste__', diag, { hoje: HOJE })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes })
  const l = j.listing_diagnoses.find(x => x.entidade.id === 'MLB400'), p = l.problemas.find(x => x.regra === 'queda_conversao_anuncio')
  assert.ok(p, 'a regra de queda dispara'); assert.equal(p.causas_possiveis[0].causa, 'preco'); assert.equal(p.causas_possiveis[0].tipo, 'hipotese'); assert.match(p.causas_possiveis[0].sinal, /preço de lista mudou/)
  assert.ok(p.confianca >= 1 && p.confianca <= 5 && p.confirmar_com.some(c => /NOT_AVAILABLE/.test(c)))
  const ev = j.evidence.find(e => e.id === p.evidence_ids[0]); assert.equal(ev.tipo, 'fato'); assert.match(ev.texto, /Controle/)
  assert.equal(j.issues.find(i => i.regra === 'queda_conversao_anuncio').causas_possiveis[0].causa, 'preco')
  assert.ok(validarContrato(j).ok)
})
await ok('dependência (depende_de) e limites refletidos em actions; ação de conta (concentracao_receita) vira oportunidade com entidade conta e prompt plano_conta; ação do plano por cliente (sem entidade) cai em conta', () => {
  const rup = acaoDe('estoque_ruptura', 'MLB1', { prazo: '2026-10-08' }), ads = acaoDe('ads_entrar', 'MLB1', { prazo: '2026-10-10' }, { depende_de: [rup.id], dependencia: 'Custos do cliente (margem)', nota_dependencia: 'prazo depois da ruptura' })
  const conc = { ...acaoDe('concentracao_receita', '', {}, { entidade: { tipo: 'conta', id: '__teste__' }, nivel: 'conta', oportunidade: 'Diversificar a receita: duplicação, kit ou segundo público do anúncio MLB1', item: null }), item_id: '' }
  const planoCli = { id: 'PS-planocli00', cliente: '__teste__', regra: 'pendencia_cliente', titulo: 'Cobrar o cliente: estoque (ML)', horizonte: '72h', prazo: '2026-10-08', responsavel: 'Consultor X', score: 40, item_id: '', status: 'proposta', dados: { evidencia_tipo: 'fato', evidencia: 'estoque crítico', problema: 'sem reposição', dimensao: 'x' } }
  const diag = diagDe([item({ id: 'MLB1' })]), j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [rup, ads, conc, planoCli] })
  const a = j.actions.find(x => x.id === ads.id); assert.deepEqual(a.depende_de, [rup.id]); assert.ok(a.limites.some(l => /depende de: Custos/.test(l)) && a.limites.some(l => /decisão humana/.test(l)))
  const c = j.opportunities.find(o => o.regra === 'concentracao_receita'); assert.equal(c.entidade.tipo, 'conta'); assert.match(c.oportunidade, /Diversificar/)
  assert.ok(j.derived_prompts.some(p => p.tipo === 'plano_conta' && p.acao_id === conc.id && p.estado === 'pronto'))
  const pc = j.actions.find(x => x.id === 'PS-planocli00'); assert.equal(pc.entidade.tipo, 'conta'); assert.equal(pc.executar_via, 'notion'); assert.equal(pc.prioridade.p, null); assert.ok(j.issues.some(i => i.regra === 'pendencia_cliente'))
  assert.ok(j.review_plan.proximas_revisoes.some(r => r.acao_id === ads.id && r.em === '2026-10-26'))
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
})
await ok('prompts derivados: PROMPT_POR_REGRA; catálogo de terceiros → só campanha/preco; sem ficha → pendente (ficha NOT_COLLECTED + voz NOT_AUTHORIZED); sem FAL_KEY → imagens pendente; sem custos → preco pendente; restricoes.proibido traz os termos do config; todo texto passa no auditor interno', () => {
  assert.deepEqual(PROMPT_POR_REGRA.ima_conversao, ['titulo_descricao', 'imagens']); assert.deepEqual(PROMPT_POR_REGRA.oferta_ficha, ['atributos']); assert.deepEqual(PROMPT_POR_REGRA.urgencia_oculta, ['oferta_kit']); assert.deepEqual(PROMPT_POR_REGRA.queda_ctr_ads, ['imagens'])
  const diag = diagDe([item({ id: 'MLB5', catalogo: true, catalogo_origem: 'terceiros' }), item({ id: 'MLB6', r: 900 })])
  const acoes = [acaoDe('ima_conversao', 'MLB5', {}, { item: { id: 'MLB5', titulo: 'P5', catalogo_origem: 'terceiros' } }), acaoDe('ads_reduzir', 'MLB5', {}, { item: { id: 'MLB5', titulo: 'P5', catalogo_origem: 'terceiros' }, executar_via: 'notion' }), acaoDe('preco_mudou_vendas_cairam', 'MLB5', {}, { item: { id: 'MLB5', titulo: 'P5', catalogo_origem: 'terceiros' }, causas_possiveis: [{ causa: 'preco', tipo: 'hipotese', sinal: 'R$ 50,00 → R$ 60,00 em 25/09 (+20%)' }] }),
    acaoDe('ima_conversao', 'MLB6'), acaoDe('conteudo_fotos', 'MLB6'), acaoDe('urgencia_oculta', 'MLB6', {}, { exige_pesquisa_consultor: true })]
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, ambiente: { fal_key: false } })
  const de = id => j.derived_prompts.filter(p => p.entidade.id === id)
  assert.deepEqual(de('MLB5').map(p => p.tipo).sort(), ['campanha', 'preco'], 'catálogo de terceiros: título/imagens não nascem')
  assert.deepEqual(de('MLB6').map(p => p.tipo).sort(), ['imagens', 'imagens', 'oferta_kit', 'titulo_descricao'])
  const img = de('MLB6').find(p => p.tipo === 'imagens'); assert.equal(img.estado, 'pendente')
  assert.deepEqual(img.insumos_faltantes.map(f => f.estado), ['NOT_COLLECTED', 'NOT_AUTHORIZED', 'NEEDS_EXTERNAL_DATA']); assert.match(img.insumos_faltantes[2].item, /FAL_KEY/); assert.ok(img.insumos_faltantes.every(f => f.como_obter))
  assert.deepEqual(img.insumos.galeria.papeis, ['capa', 'beneficio_principal', 'uso_real', 'diferenciais', 'medidas', 'conteudo_embalagem', 'compatibilidade_cuidados'])
  const preco = de('MLB5').find(p => p.tipo === 'preco'); assert.equal(preco.estado, 'pendente'); assert.match(preco.insumos_faltantes[0].item, /custos/); assert.match(preco.texto, /Sem custos informados/); assert.match(preco.texto, /R\$ 50,00 → R\$ 60,00/)
  const camp = de('MLB5').find(p => p.tipo === 'campanha'); assert.equal(camp.estado, 'pronto'); assert.match(camp.texto, /NOT_SUPPORTED/)
  for (const p of j.derived_prompts) { assert.ok(p.restricoes.proibido.includes('promoção') && p.restricoes.proibido.includes('ranking') && p.restricoes.proibido.includes('inventar característica') && p.restricoes.proibido.includes('prometer resultado')); assert.deepEqual(auditarInterno(p.texto), [], p.texto); assert.ok(p.acao_id && j.actions.some(a => a.id === p.acao_id)) }
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
})
await ok('ficha com fonte: restricoes.preservar (cor, kit, marca…) vem de checarPreservacao; título proposto que perde cor/kit → prompt titulo_descricao PENDENTE com insumos_faltantes nomeando o que se perdeu; título que preserva → pronto', () => {
  const ficha = { nome: 'Garrafa Térmica', marca: 'Acme', modelo: 'X1', cor: 'Azul', tamanho: '', material: '', quantidade_kit: 3, atributos: [{ atributo_id: 'COLOR', valor_atual: 'Azul', fonte: 'planilha do cliente' }] }
  const diag = diagDe([item({ id: 'MLB7' })]), acoes = [acaoDe('oferta_titulo_descricao', 'MLB7')]
  const perde = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, ofertas: { porItem: new Map([['MLB7', { ficha, referencia_confirmada: true, voz_coletada: true, titulo_proposto: 'Garrafa Térmica Acme X1' }]]) } }).derived_prompts[0]
  assert.equal(perde.tipo, 'titulo_descricao'); assert.equal(perde.estado, 'pendente'); assert.match(perde.insumos_faltantes[0].item, /cor=Azul.*kit=3/); assert.match(perde.insumos_faltantes[0].como_obter, /nunca é silencioso/)
  assert.deepEqual(perde.restricoes.preservar.map(p => `${p.campo}=${p.valor}`), ['cor=Azul', 'quantidade_kit=3', 'marca=Acme', 'modelo=X1']); assert.match(perde.texto, /Preservar: cor=Azul \(planilha do cliente\)/)
  const ok2 = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, ofertas: { porItem: new Map([['MLB7', { ficha, referencia_confirmada: true, voz_coletada: true, titulo_proposto: 'Garrafa Térmica Acme X1 Azul Kit 3 un' }]]) } }).derived_prompts[0]
  assert.equal(ok2.estado, 'pronto'); assert.deepEqual(ok2.insumos_faltantes, [])
  const semGate = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, ofertas: { porItem: new Map([['MLB7', { ficha, referencia_confirmada: false, voz_coletada: true }]]) } }).derived_prompts[0]
  assert.match(semGate.insumos_faltantes[0].item, /GATE 0/); assert.equal(semGate.insumos_faltantes[0].estado, 'NEEDS_EXTERNAL_DATA')
})
await ok('IA (redigir): sem chave → deterministico com motivo; stub "ROAS 9,99 garante primeira página" → deterministico (número não rastreável); stub só com promessa → deterministico (auditor); stub que repete só números de evidence → origem ia com tokens/custo; falha do stub → motivo logado, template; numerosFora ignora datas e entende pt-BR', async () => {
  const evidence = [{ id: 'ev-1', valor: 4.27, unidade: 'x', texto: 'ROAS: 4.27', periodo: '2026-09-07..2026-10-04' }, { id: 'ev-2', valor: 12345.6, unidade: 'BRL', texto: 'Receita: 12345.6' }]
  const base = { fatos: { roas: 4.27 }, instrucao: 'x', template: () => 'Texto determinístico.', evidence, escopo: '' }
  const semChave = await redigir(base); assert.equal(semChave.origem, 'deterministico'); assert.equal(semChave.texto, 'Texto determinístico.'); assert.match(semChave.motivo, /ANTHROPIC_API_KEY/); assert.equal(semChave.custo_estimado, null)
  const promessa = await redigir({ ...base, chamar: async () => ({ texto: 'ROAS 9,99 garante primeira página', tokens: { entrada: 10, saida: 5 } }) })
  assert.equal(promessa.origem, 'deterministico'); assert.match(promessa.motivo, /número não rastreável: 9\.99/); assert.equal(promessa.texto, 'Texto determinístico.')
  const soPromessa = await redigir({ ...base, chamar: async () => ({ texto: 'ROAS 4,27 garante a primeira página', tokens: null }) }); assert.equal(soPromessa.origem, 'deterministico'); assert.match(soPromessa.motivo, /auditor: promessa/)
  const ia = await redigir({ ...base, chamar: async ({ prompt }) => { assert.match(prompt, /Você NÃO decide nada/); assert.match(prompt, /"roas":4\.27/); return { texto: 'A conta faturou R$ 12.345,60 no período com ROAS 4,3 (07/09 a 04/10).', tokens: { entrada: 100, saida: 20 } } } })
  assert.equal(ia.origem, 'ia'); assert.deepEqual(ia.tokens, { entrada: 100, saida: 20 }); assert.equal(ia.custo_estimado, null, 'sem AI_PRECO_* o custo é null, nunca inventado'); assert.equal(ia.motivo, '')
  const erros = []; const logOrig = console.error; console.error = (...a) => erros.push(a.join(' '))
  const falha = await redigir({ ...base, chamar: async () => { throw new Error('boom') } }); console.error = logOrig
  assert.equal(falha.origem, 'deterministico'); assert.match(falha.motivo, /IA indisponível: boom/); assert.ok(erros.some(e => /\[ia\] falha na chamada: boom/.test(e)), 'o catch loga o motivo')
  assert.deepEqual(numerosFora('R$ 12.345,60 em 05/10/2026 às 14:30, ROAS 4,27 e 4,3', evidence), []); assert.deepEqual(numerosFora('ROAS 5 em 28 dias', evidence), ['5', '28'], '"28 dias" só passa se o período estiver em evidence'); assert.deepEqual(numerosFora('qualquer 7', null), [])
  const cache = await redigir({ ...base, escopo: 'teste:cache', chamar: async () => ({ texto: 'ROAS 4,27.', tokens: null }) }); assert.equal(cache.origem, 'ia'); assert.equal(cache.cache, false)
  const cache2 = await redigir({ ...base, escopo: 'teste:cache', chamar: async () => { throw new Error('não deveria chamar') } }); assert.equal(cache2.cache, true); assert.equal(cache2.texto, 'ROAS 4,27.')
})
await ok('render: todo número impresso vem de evidence (métrica nula = "—" com motivo); interno mostra ids/responsável/prompts/revisão; ?para=cliente sem PS-/MLB, sem nome interno, sem as seções internas; leituraDeterministica só cita números de evidence', () => {
  const diag = diagDe([item({ id: 'MLB123456789', r: 5000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB987654321', r: 3000, u: 30, v: 500, conv: 6, frete_gratis: false, fotos: 3 })])
  const acoes = montarAcoes('__teste__', diag, { hoje: HOJE }).map(a => ({ ...a, responsavel: 'Giovanna Torres', status: 'proposta' }))
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, retro: retroDe(diag.itens) })
  const interno = renderDiagnosticoMotor(j, { para: 'interno' }), cliente = renderDiagnosticoMotor(j, { para: 'cliente', nomesInternos: ['Giovanna Torres'] })
  assert.match(interno, /PS-[0-9a-f]{10}/); assert.match(interno, /MLB987654321/); assert.match(interno, /Giovanna Torres/); assert.match(interno, /Prompts derivados/); assert.match(interno, /Plano de revisão/); assert.match(interno, /ev-[0-9a-f]{10}/)
  assert.doesNotMatch(cliente, /PS-[0-9a-f]{6}/); assert.doesNotMatch(cliente, /MLB\d/); assert.doesNotMatch(cliente, /Giovanna|Torres/); assert.doesNotMatch(cliente, /Prompts derivados|Plano de revisão|Merovíngio/)
  assert.match(cliente, /R\$ 8\.000/, 'receita impressa do valor da evidência'); assert.match(cliente, /Quebrar objeções de conversão: Produto de teste/)
  assert.match(interno, /— \(custos não informados\)/, 'métrica nula sai como — com o motivo')
  for (const t of [leituraDeterministica(j), ...j.evidence.map(e => e.texto)]) assert.deepEqual(auditarInterno(t), [], t)
  assert.deepEqual(numerosFora(leituraDeterministica(j), [...j.evidence, { texto: `${j.issues.length} ${j.opportunities.length} ${j.actions.length} 28` }]), [], 'a leitura só cita números rastreáveis')
})

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Correções da revisão adversarial (08/10/2026, grupo diagnóstico): um bloco por achado; cada um falha sem a correção
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const { visaoCliente, insumosLeitura, REGRAS_CLIENTE, formatarEvidencia } = await import('../src/lib/render-diagnostico-motor.js')
const { cfgRetro } = await import('../src/lib/retroalimentacao.js')
const acaoConta = (regra, titulo, dados = {}) => ({ id: 'PS-' + createHash('sha1').update('conta|' + regra).digest('hex').slice(0, 10), cliente: '__teste__', regra, titulo, horizonte: '7d', prazo: '2026-10-12', responsavel: '', score: 50, item_id: '', status: 'proposta',
  dados: { evidencia_tipo: 'fato', evidencia: 'contagem do painel', problema: titulo, ...dados } })

await ok('achado 1: ?para=cliente só mostra REGRAS_CLIENTE (regras de anúncio/conta com rótulo); operacionais do plano por cliente, bloqueios e pendências ficam fora, nunca a chave crua; contadores contam só o mostrado; interno mostra tudo', () => {
  assert.equal(REGRAS_CLIENTE.size, algoritmo.regras.length, 'as regras do algoritmo, todas com rótulo'); for (const r of algoritmo.regras) assert.ok(REGRAS_CLIENTE.has(r.id), r.id)
  for (const r of ['bloqueio_interno', 'pendencia_cliente', 'bloqueio_cliente', 'sem_responsavel', 'renovacao', 'calendario']) assert.ok(!REGRAS_CLIENTE.has(r), r)
  const diag = diagDe([item({ id: 'MLB31' })])
  const internas = [acaoConta('sem_responsavel', 'Atribuir responsável a 6 tarefa(s) abertas sem dono'), acaoConta('backlog_parado', 'Revisar 24 tarefas abertas paradas há 30+ dias'), acaoConta('sem_entrega', 'Retomar cadência: sem entrega concluída há 237 dias'),
    acaoConta('renovacao', 'Contrato Mercado Livre vencido há 5 dia(s) — tratar a renovação', { problema: 'o playbook pede o CS acionado ~20 dias antes do fim' }), acaoConta('queda_cadencia', 'Investigar queda de cadência: 2 entregas em 28 dias vs 9 nos 28 anteriores'),
    acaoConta('alavanca_ads', 'Ads: nenhuma ação nos últimos 30 dias'), acaoConta('calendario', 'Preparar Black Friday (27/11)'), acaoConta('sem_plano_mes', 'Montar o plano de ação de outubro/2026'), acaoConta('ml_queda_faturamento', 'Faturamento no Mercado Livre caiu 30% em 28 dias'),
    acaoConta('bloqueio_interno', 'Destravar 2 tarefa(s) com impedimento interno'), acaoConta('pendencia_cliente', 'Cobrar o cliente: estoque (ML)'), acaoConta('regra_nova_sem_rotulo', 'Texto de regra nova sem rótulo')]
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [...internas, acaoDe('ima_conversao', 'MLB31')] })
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const cli = renderDiagnosticoMotor(j, { para: 'cliente' }), int = renderDiagnosticoMotor(j, { para: 'interno' })
  for (const a of internas) { assert.ok(!cli.includes(a.titulo.slice(0, 25)), 'texto interno ao cliente: ' + a.regra); assert.doesNotMatch(cli, new RegExp(`\\b${a.regra}\\b`), 'chave crua: ' + a.regra); assert.ok(int.includes(a.titulo.slice(0, 25)), 'interno mostra: ' + a.regra) }
  assert.doesNotMatch(cli, /playbook|o CS acionado/)
  assert.match(cli, /Quebrar objeções de conversão|Conversão abaixo da referência da conta/, 'a regra de anúncio continua')
  assert.match(cli, /1 problema\(s\) e 0 oportunidade\(s\) identificados pelas regras; 1 ação\(ões\) priorizada\(s\)/, 'contadores do cliente = o que é mostrado')
  assert.match(cli, /12 tarefa\(s\) de rotina da equipe não entram neste diagnóstico/, 'omitidas contadas')
  assert.match(int, /13 problema\(s\) e 0 oportunidade\(s\) identificados pelas regras; 13 ação\(ões\)/)
  const v = visaoCliente(j); assert.equal(v.omitidos, 12); assert.ok(v.issues.every(i => REGRAS_CLIENTE.has(i.regra)) && v.listing_diagnoses.every(l => l.problemas.every(p => REGRAS_CLIENTE.has(p.regra))))
  assert.equal(j.actions.length, 13, 'a visão do cliente não muda o contrato')
})
await ok('achado 2: texto livre reprovado no auditor interno (ex.: "ACOS null%") nunca derruba o contrato: o prompt usa frase neutra, fica pendente com insumo faltante, e o validador aprova', () => {
  const diag = diagDe([item({ id: 'MLB32' })])
  const custos = { ...acaoDe('cadastrar_custos', '', {}, { entidade: { tipo: 'conta', id: '__teste__' }, nivel: 'conta', problema: 'Sem custos informados (ACOS null%, TACOS null%)', item: null }), item_id: '' }
  const preco = acaoDe('preco_mudou_vendas_cairam', 'MLB32', {}, { causas_possiveis: [{ causa: 'preco', tipo: 'hipotese', sinal: 'preço de lista mudou: R$ null → R$ 60,00' }] })
  const limpa = { ...acaoDe('concentracao_receita', '', {}, { entidade: { tipo: 'conta', id: '__teste__' }, nivel: 'conta', item: null }), item_id: '' }
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [custos, preco, limpa] })
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const pc = j.derived_prompts.find(p => p.acao_id === custos.id && p.tipo === 'plano_conta')
  assert.equal(pc.estado, 'pendente'); assert.doesNotMatch(pc.texto, /null/); assert.match(pc.texto, /Esta ação: cadastrar_custos \(\)\.|Esta ação: /)
  assert.ok(pc.insumos_faltantes.some(f => /fora do padrão/.test(f.item) && f.estado === 'NOT_AVAILABLE' && f.como_obter))
  const pp = j.derived_prompts.find(p => p.acao_id === preco.id); assert.doesNotMatch(pp.texto, /null/); assert.match(pp.texto, /o motivo registrado na ação/)
  const pl = j.derived_prompts.find(p => p.acao_id === limpa.id); assert.equal(pl.estado, 'pronto', 'sem texto ruim, nada muda'); assert.match(pl.texto, /problema concentracao_receita/)
  for (const p of j.derived_prompts) assert.deepEqual(auditarInterno(p.texto), [], p.texto)
})
await ok('achado 4: janela atual com dia sem coleta → métricas da série com parcial {dias_cobertos, dias, dias_sem_coleta} e evidência "pendente" com motivo; acima do corte (config) → null com motivo; render "parcial (X de 28 dias)" ou "—"', () => {
  const MAX = cfgRetro.estado?.max_dias_sem_coleta ?? 3
  const its = () => [item({ id: 'MLB33', r: 5000, u: 100, v: 600, conv: 16.7 })]
  const comFaltas = (faltam, truncados = 0) => montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe(its(), { data_quality: dq({ qualidade: QUAL(faltam, truncados) }) }), acoes: [], coleta: { atual: { faltam, truncados }, anterior: { faltam: [], truncados: 0 } } })
  const j = comFaltas(['2026-09-10', '2026-09-11']), rc = j.metrics.conta.receita
  assert.equal(rc.valor, 5000); assert.deepEqual(rc.parcial, { dias_cobertos: 26, dias: 28, dias_sem_coleta: 2, dias_truncados: 0 })
  const e = j.evidence.find(x => x.id === rc.evidence_id); assert.equal(e.tipo, 'pendente'); assert.match(e.motivo, /parcial: 26 de 28 dias coletados/); assert.match(e.texto, /26 de 28/)
  assert.ok(j.metrics.conta.pedidos.parcial && j.metrics.conta.unidades.parcial && j.metrics.por_curva.A.receita.parcial && j.metrics.anuncios[0].metrics.receita.parcial, 'conta, curva e anúncio')
  assert.equal(j.metrics.conta.receita_anterior.parcial, undefined, 'a janela anterior está inteira'); assert.equal(j.metrics.por_curva.A.n_anuncios.parcial, undefined, 'contagem de anúncios não é soma de dias')
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  assert.match(renderDiagnosticoMotor(j, { para: 'cliente' }), /R\$ 5\.000 <span class="pl-sc">parcial \(26 de 28 dias\)<\/span>/); assert.match(leituraDeterministica(j), /faturou R\$ 5\.000 em 26 de 28 dias com coleta \(parcial\)/)
  const trunc = comFaltas([], 1).metrics.conta.receita; assert.deepEqual(trunc.parcial, { dias_cobertos: 28, dias: 28, dias_sem_coleta: 0, dias_truncados: 1 })
  const noCorte = comFaltas(Array.from({ length: MAX }, (_, k) => D(-10 - k))).metrics.conta.receita; assert.equal(noCorte.valor, 5000, 'no corte ainda é parcial'); assert.equal(noCorte.parcial.dias_sem_coleta, MAX)
  const j4 = comFaltas(Array.from({ length: MAX + 1 }, (_, k) => D(-10 - k))), r4 = j4.metrics.conta.receita
  assert.equal(r4.valor, null); assert.equal(r4.evidence_id, null); assert.match(r4.motivo, new RegExp(`${MAX + 1} dia\\(s\\) da janela sem coleta`)); assert.equal(j4.metrics.anuncios[0].metrics.receita.valor, null)
  assert.deepEqual(validarContrato(j4), { ok: true, erros: [] })
  const h4 = renderDiagnosticoMotor(j4, { para: 'cliente' }); assert.match(h4, new RegExp(`— \\(${MAX + 1} dia\\(s\\) da janela sem coleta`)); assert.doesNotMatch(h4, /Receita \(GMV\)<\/td><td><b>R\$/, 'a receita atual não sai como número'); assert.match(h4, /Receita do período anterior<\/td><td><b>R\$ 5\.000/, 'a janela anterior, inteira, segue')
  assert.match(leituraDeterministica(j4), /receita dos 28 dias está sem dado/)
  const semColetaInformada = montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe(its(), { data_quality: dq({ qualidade: QUAL(['2026-09-10']) }) }), acoes: [] })
  assert.equal(semColetaInformada.metrics.conta.receita.parcial.dias_sem_coleta, 1, 'sem `coleta`, as lacunas da janela saem de data_quality')
})
await ok('achado 5: job de Ofertas e ids do contrato (ev-/dp-) somem do texto ao cliente (com o parêntese de escopo); a IA com crivo cliente que cite ev-/dp- cai no template', async () => {
  const diag = diagDe([item({ id: 'MLB34' })])
  const a = acaoDe('oferta_completa', 'MLB34', { titulo: 'Oferta completa: Garrafa · job 3e0c980e (escopo oferta_completa, objetivo lancar)' }, { problema: 'galeria curta, ver ev-0123456789 e dp-abcdef0123' })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [a] })
  const cli = renderDiagnosticoMotor(j, { para: 'cliente' })
  assert.doesNotMatch(cli, /job [0-9a-f]{8}|escopo oferta_completa|objetivo lancar|ev-[0-9a-f]{10}|dp-[0-9a-f]{10}/); assert.match(cli, /Oferta completa: Garrafa</); assert.match(cli, /galeria curta, ver e</)
  assert.match(renderDiagnosticoMotor(j, { para: 'interno' }), /job 3e0c980e/, 'interno mantém')
  const r = await redigir({ fatos: {}, instrucao: 'x', template: () => 'Template.', evidence: [], crivo: 'cliente', chamar: async () => ({ texto: 'Leitura conforme ev-abcdefabcd e dp-abcdefabcd.', tokens: null }) })
  assert.equal(r.origem, 'deterministico'); assert.match(r.motivo, /id_interno/); assert.equal(r.texto, 'Template.')
})
await ok('achado 7: insumos da leitura executiva levam só as evidências que os fatos citam (métricas da conta + diagnóstico da conta) + contadores; número de anúncio não citado fica "não rastreável"', () => {
  const diag = diagDe([item({ id: 'MLB35', r: 5000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB36', r: 1234.56, u: 7, v: 500, conv: 1.4 })])
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: montarAcoes('__teste__', diag, { hoje: HOJE }), retro: retroDe(diag.itens) })
  const ins = insumosLeitura(j), citados = new Set([...Object.values(j.metrics.conta).map(m => m.evidence_id), ...j.account_diagnosis.evidence_ids].filter(Boolean))
  assert.ok(ins.evidence.filter(e => e.id).every(e => citados.has(e.id)) && ins.evidence.length < j.evidence.length / 2)
  assert.deepEqual([ins.fatos.n_issues, ins.fatos.n_opportunities, ins.fatos.n_actions], [j.issues.length, j.opportunities.length, j.actions.length])
  assert.deepEqual(numerosFora(leituraDeterministica(j), ins.evidence), [], 'o template segue rastreável')
  assert.deepEqual(numerosFora('O anúncio faturou R$ 1.234,56.', j.evidence), [], 'com TODAS as evidências o número do anúncio passava')
  assert.deepEqual(numerosFora('O anúncio faturou R$ 1.234,56.', ins.evidence), ['1234.56'], 'só as citadas: não passa')
})
await ok('achado 8: validarContrato recusa cada caso com frase fixa e sem eco; dependência descartada/obsoleta vira "dependência encerrada" na montagem (nunca id órfão)', () => {
  const listing = c => ({ entidade: { tipo: 'anuncio', id: 'MLB1' }, nivel: 'anuncio', titulo: 'x', evidence_ids: [], problemas: [{ regra: 'ima_conversao', problema: 'p', evidence_ids: [], confianca: c, causas_possiveis: [], confirmar_com: [] }] })
  const casos = [
    ['valor NaN', j => { j.metrics.conta.receita.valor = NaN }, /valor não finito em metrics\.conta\.receita/],
    ['valor Infinity', j => { j.metrics.conta.receita.valor = Infinity }, /valor não finito em metrics\.conta\.receita/],
    ['depende_de órfão', j => { j.actions[0].depende_de = ['PS-ffffffffff'] }, /depende_de para ação inexistente/],
    ['issue órfã', j => { j.issues.push({ acao_id: 'PS-ffffffffff', regra: 'ima_conversao', entidade: { tipo: 'anuncio', id: 'MLB1' }, evidence_ids: [] }) }, /issues aponta para ação inexistente/],
    ['oportunidade órfã', j => { j.opportunities.push({ acao_id: 'PS-ffffffffff', regra: 'ads_entrar', entidade: { tipo: 'anuncio', id: 'MLB1' }, evidence_ids: [] }) }, /opportunities aponta para ação inexistente/],
    ['revisão órfã', j => { j.review_plan.proximas_revisoes.push({ acao_id: 'PS-ffffffffff', em: '2026-10-30', o_que_conferir: 'x' }) }, /revisão aponta para ação inexistente/],
    ['ação duplicada', j => { j.actions.push({ ...j.actions[0] }) }, /ação com id repetido/],
    ['métrica nula com evidence_id', j => { j.metrics.conta.margem_pre_ads.evidence_id = 'ev-0000000001' }, /métrica nula com evidence_id em metrics\.conta\.margem_pre_ads/],
    ['evidence.valor string', j => { j.evidence[0].valor = '1000' }, /evidência com valor não numérico/],
    ['análise bloqueada sem como_obter', j => { delete j.data_quality.analises_bloqueadas[0].como_obter }, /análise bloqueada sem analise\/motivo\/como_obter/],
    ['confiança "3" (string)', j => { j.listing_diagnoses.push(listing('3')) }, /confiança fora de 1\.\.5/],
    ['confiança 2,5', j => { j.listing_diagnoses.push(listing(2.5)) }, /confiança fora de 1\.\.5/],
    ['confiança de issue "3"', j => { j.issues.push({ acao_id: 'PS-0000000001', regra: 'ima_conversao', entidade: { tipo: 'anuncio', id: 'MLB1' }, evidence_ids: [], confianca: '3' }) }, /issues com confiança fora de 1\.\.5/],
    ['conta de Ads sem evidência', j => { j.campaign_diagnoses.conta = { roas: { valor: 4, formula: 'receita ÷ custo', denominador: 'custo', periodo: '28 dias', fonte: 'meli_ads_item', evidence_id: null } } }, /métrica com valor sem evidence_id em campaign_diagnoses\.conta\.roas/],
    ['periodo.anterior = true', j => { j.periodo.anterior = true }, /periodo incompleto/],
    ['disponivel ausente', j => { delete j.disponivel }, /disponivel ausente/],
  ]
  for (const [nome, muda, rx] of casos) {
    const j = MINIMO(); muda(j); const v = validarContrato(j)
    assert.equal(v.ok, false, nome); assert.match(v.erros.join('|'), rx, nome)
    for (const e of v.erros) assert.doesNotMatch(e, /ffffffffff|NaN|Infinity|1000|"3"|2\.5/, `${nome}: a mensagem não ecoa o valor`)
  }
  // caso real: a dependência foi descartada (ou ficou obsoleta) depois de distribuída → some de depende_de, vira rótulo, e o contrato fecha
  const diag = diagDe([item({ id: 'MLB37' })])
  const dep = acaoDe('estoque_ruptura', 'MLB37', { status: 'descartada' }), ads = acaoDe('ads_entrar', 'MLB37', { status: 'distribuida' }, { depende_de: [dep.id], confianca: '4' })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [dep, ads] })
  const a = j.actions.find(x => x.id === ads.id); assert.deepEqual(a.depende_de, []); assert.ok(a.limites.includes('dependência encerrada (descartada ou obsoleta): a ação segue sem ela'))
  assert.equal(j.opportunities.find(o => o.acao_id === ads.id).confianca, 4, 'confiança "4" dos dados vira inteiro')
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
})
await ok('achado 9: ROAS alvo, ACOS máximo, metas, concentração e cobertura viram evidência e o render só imprime a partir delas ("—" sem evidência); valor abaixo de 1 nunca sai como 0', () => {
  const its = [item({ id: 'MLB38', r: 5000, u: 100, v: 600, conv: 16.7, ads: { custo: 100, receita: 500, clicks: 90, prints: 300000, unidades: 5, ctr: 0.03, acos: 20, roas: 5 } }), item({ id: 'MLB39', r: 1000, u: 20, v: 300, conv: 6.7 })]
  const diag = diagDe(its, { economia: { roas_alvo: 3.57, acos_max_pct: 28, viavel: true, nota: '' }, metas: { gmv: null, roas: 4.5, acos_max: 20, margem_pct: null } })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [], retro: retroDe(diag.itens) })
  const porChave = k => j.evidence.find(e => e.chave === k)
  for (const [k, v] of [['conta:roas_alvo', 3.57], ['conta:acos_max_pct', 28], ['conta:meta_roas', 4.5], ['conta:meta_acos_max', 20], ['conta:concentracao_n80', 1], ['conta:concentracao_n', 2], ['cobertura:pedidos_lacunas', 0], ['cobertura:visitas_cobertos', 1], ['cobertura:visitas_total', 2]]) assert.equal(porChave(k)?.valor, v, k)
  assert.ok(j.campaign_diagnoses.conta.evidence_ids.length === 4 && j.account_diagnosis.concentracao.evidence_ids.length === 3 && j.data_quality.evidence_ids.length === 4)
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const h = renderDiagnosticoMotor(j, { para: 'cliente' })
  assert.match(h, /ROAS alvo 3,57 \(ACOS máximo 28%\) pelos custos informados/); assert.match(h, /Meta do mês: ROAS 4,5 · ACOS máximo 20%/); assert.match(h, /1 de 2 anúncio\(s\) fazem 80% da receita; o maior responde por 83,3%/)
  assert.match(h, /sem coleta: 0 dias; truncados: 0 dias/); assert.match(h, /Visitas: 1 de 2 anúncio\(s\)/); assert.match(h, /0,03%/, 'CTR 0,03 não vira "0%"')
  const sem = { ...j, evidence: j.evidence.filter(e => !['conta:acos_max_pct', 'conta:meta_roas', 'conta:concentracao_n80', 'cobertura:visitas_total'].includes(e.chave)) }
  const h2 = renderDiagnosticoMotor(sem, { para: 'cliente' })
  assert.match(h2, /ROAS alvo 3,57 \(ACOS máximo —\)/); assert.match(h2, /Meta do mês: ACOS máximo 20%</); assert.match(h2, /— de 2 anúncio\(s\) fazem 80%/); assert.match(h2, /Visitas: 1 de — anúncio\(s\)/)
  assert.equal(formatarEvidencia({ valor: 0.03, unidade: '%' }), '0,03%'); assert.equal(formatarEvidencia({ valor: 0.004, unidade: 'BRL' }), 'R$ 0,004'); assert.equal(formatarEvidencia({ valor: 0, unidade: '%' }), '0%'); assert.equal(formatarEvidencia({ valor: 12.345, unidade: '%' }), '12,3%')
})
await ok('varredura 08/10: ação antiga de urgencia_oculta ("Campeão de vendas") em anúncio com 0 un na janela atual sai do contrato; com venda, fica', () => {
  const sem = item({ id: 'MLB1', r: 0, u: 0, v: 10 }), com = item({ id: 'MLB2', r: 500, u: 5, v: 100 })
  const diag = diagDe([sem, com])
  const acoes = [acaoDe('urgencia_oculta', 'MLB1', {}, { problema: 'Campeão de vendas com possível demanda oculta' }), acaoDe('urgencia_oculta', 'MLB2', {}, { problema: 'Campeão de vendas com possível demanda oculta' })]
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes, retro: retroDe(diag.itens) })
  const ids = j.actions.map(x => x.entidade.id)
  assert.ok(!ids.includes('MLB1'), 'anúncio sem venda não aparece como campeão')
  assert.ok(ids.includes('MLB2'), 'anúncio com venda continua')
  assert.ok(!JSON.stringify(j.listing_diagnoses.filter(l => l.entidade.id === 'MLB1')).includes('Campeão'), 'nem no listing')
})
await ok('achado 11: ao cliente, causa em PT por lista fechada (sem rótulo some), estados em PT (não coletado, depende de dado externo, não disponível nesta versão) e estratégia provisória como "Hipótese (provisória)", nunca "Fato observado"', () => {
  const diag = diagDe([item({ id: 'MLB40' })])
  const a = acaoDe('queda_conversao_anuncio', 'MLB40', {}, { causas_possiveis: [{ causa: 'preco', tipo: 'hipotese', sinal: 'preço de lista mudou' }, { causa: 'causa_interna_nova', tipo: 'hipotese', sinal: 'sinal interno' }] })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [a], retro: retroDe(diag.itens, { estrategia: estrategia('Sobrevivência', { confianca: 'fato' }) }) })
  const cli = renderDiagnosticoMotor(j, { para: 'cliente' }), int = renderDiagnosticoMotor(j, { para: 'interno' })
  assert.doesNotMatch(cli, /NOT_COLLECTED|NOT_SUPPORTED|NEEDS_EXTERNAL_DATA|NOT_AUTHORIZED|NOT_AVAILABLE/)
  for (const t of ['não coletado', 'depende de dado externo', 'não disponível nesta versão']) assert.ok(cli.includes(t), t)
  assert.doesNotMatch(cli, /causa_interna_nova|sinal interno/); assert.match(cli, /<li>preço: preço de lista mudou<\/li>/); assert.match(cli, /Causas possíveis: preço \(hipóteses\)/)
  const estr = cli.slice(cli.indexOf('<b>Estratégia</b>'), cli.indexOf('<b>Cadeia causal</b>')); assert.match(estr, /Hipótese \(provisória\)/); assert.doesNotMatch(estr, /Fato observado/)
  assert.match(int, /NOT_COLLECTED/, 'interno segue com o enum'); assert.match(int, /causa_interna_nova/)
})
await ok('achado 13: conta sem Mercado Livre → cobertura "—" (nunca "0 dia(s) sem coleta" nem "0 de 0 anúncios")', () => {
  const j = montarDiagnostico('Sem ML', { hoje: HOJE, diag: { disponivel: false, motivo: 'sem dados' } })
  assert.ok(validarContrato(j).ok)
  for (const para of ['interno', 'cliente']) { const h = renderDiagnosticoMotor(j, { para }); assert.doesNotMatch(h, /0 dia\(s\) sem coleta|0 de 0 anúncio|sem coleta;/, para); assert.match(h, /Pedidos: —; sem coleta: —; truncados: —/, para); assert.match(h, /Visitas: — de — anúncio/, para) }
})

// ── refutações (08/10/2026): o que os céticos reproduziram depois da 1ª correção; cada bloco falha sem a correção ──
// nós de texto do HTML como o leitor vê (sem <head>/<style>), para o auditor completo e a varredura de snake_case
const nosDeTexto = h => h.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<style>[\s\S]*?<\/style>/g, '').split(/<[^>]+>/).map(s => s.replace(/&[a-z#0-9]+;/g, ' ').trim()).filter(Boolean)
await ok('refutação achado 4: TACOS e participação (período = janela de Ads ≠ janela de pedidos) seguem o corte da janela de pedidos — parcial/pendente até o corte, null com motivo acima; nunca "fato" sobre receita com buraco', () => {
  const MAX = cfgRetro.estado?.max_dias_sem_coleta ?? 3
  const adsC = { custo: 652, receita: 3260, roas: 5, acos: 20, ctr: 1.2, tacos: 13.04, cpc: 1.1, custo_por_pedido: 9, participacao_pct: 65.2, clicks: 590, prints: 49000, unidades: 70, anterior: { roas: null, ctr: null, prints: 0, clicks: 0 } }
  const monta = faltam => montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], coleta: { atual: { faltam, truncados: 0 }, anterior: { faltam: [], truncados: 0 } },
    diag: diagDe([item({ id: 'MLB41', r: 5000, u: 100, v: 600, conv: 16.7 })], { ads: adsC, data_quality: dq({ ads: { ...ADS, de: '2026-09-02', ate: '2026-09-29' }, qualidade: QUAL(faltam) }) }) })
  const corte = Array.from({ length: MAX + 2 }, (_, k) => D(-5 - k)), j = monta(corte), m = j.metrics.conta
  assert.equal(m.tacos.periodo, 'Ads 28 d × pedidos 28 d'); assert.equal(j.data_quality.cobertura.ads.janela.de, '2026-09-02', 'janela de Ads diferente da de pedidos')
  assert.equal(m.receita.valor, null)
  for (const k of ['tacos', 'participacao_publicidade']) { assert.equal(m[k].valor, null, k); assert.equal(m[k].evidence_id, null, k); assert.match(m[k].motivo, new RegExp(`${MAX + 2} dia\\(s\\) da janela sem coleta`), k) }
  assert.ok(!j.evidence.some(e => /^conta:(tacos|participacao_publicidade)$/.test(e.chave)), 'nenhuma evidência de TACOS sobre receita com buraco')
  assert.equal(m.roas.valor, 5, 'ROAS/ACOS (só Ads) não dependem da série de pedidos'); assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const h = renderDiagnosticoMotor(j, { para: 'cliente' }); assert.doesNotMatch(h, /<td>TACOS<\/td><td><b>13/); assert.doesNotMatch(h, /Participação da publicidade<\/td><td><b>65/); assert.doesNotMatch(leituraDeterministica(j), /TACOS/)
  const p = monta([D(-6)]), t = p.metrics.conta.tacos, e = p.evidence.find(x => x.id === t.evidence_id)
  assert.equal(t.valor, 13.04); assert.deepEqual(t.parcial, { dias_cobertos: 27, dias: 28, dias_sem_coleta: 1, dias_truncados: 0 }); assert.equal(e.tipo, 'pendente'); assert.equal(p.metrics.conta.participacao_publicidade.parcial.dias_sem_coleta, 1)
  assert.match(leituraDeterministica(p), /\(TACOS 13%, parcial\)/); assert.match(renderDiagnosticoMotor(p, { para: 'cliente' }), /<td>TACOS<\/td><td><b>13% <span class="pl-sc">parcial \(27 de 28 dias\)/)
})
await ok('refutação achado 11: logística crua da API (xd_drop_off, cross_docking) chega ao cliente em PT (rótulos de filtros.js); qualquer snake_case que sobrar não é impresso; interno mantém', () => {
  const a = acaoDe('full_envio', 'MLB42', {}, { problema: 'Anúncio curva A com boa conversão fora do Full (logística atual: xd_drop_off)', indicador_inicial: 'logística cross_docking', evidencia: '100 un/28d, conversão 16,7% (≥ benchmark); logística xd_drop_off.', hipotese: 'texto com regra_nova_crua' })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe([item({ id: 'MLB42' })]), acoes: [a] })
  const cli = renderDiagnosticoMotor(j, { para: 'cliente' }), nos = nosDeTexto(cli)
  assert.deepEqual(nos.filter(t => /\b[a-z]+_[a-z0-9_]+\b/.test(t)), [], 'nenhuma chave snake_case no texto ao cliente')
  assert.ok(nos.includes('Anúncio curva A com boa conversão fora do Full (logística atual: Postagem (cross docking))')); assert.ok(nos.includes('logística Coleta (cross docking)')); assert.match(cli, /logística Postagem \(cross docking\)\./)
  assert.match(renderDiagnosticoMotor(j, { para: 'interno' }), /logística atual: xd_drop_off/, 'interno mantém o valor cru')
})
await ok('refutação achado 1: no HTML ao cliente TODO nó de texto passa no auditor completo — capa sem "Algoritmo", rodapé sem "Notion", sem "módulo de Ofertas"/"job"; interno mantém', () => {
  const NOMES = ['Giovanna Torres']
  const of1 = acaoDe('oferta_galeria', 'MLB43', { responsavel: 'Giovanna Torres' }, { problema: 'qualidade com pendencias (alta) — job do módulo de Ofertas' })
  const of2 = acaoDe('oferta_ficha', 'MLB43', {}, { problema: 'Execução pedida no módulo de Ofertas sem leitura medida da lente', hipotese: 'HIPÓTESE do objetivo do job (sem sinal medido): só a medição antes × depois com controle dirá se funcionou' })
  const diag = diagDe([item({ id: 'MLB43', r: 5000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB44', r: 900, u: 9, v: 300, conv: 3 })])
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [...montarAcoes('__teste__', diag, { hoje: HOJE }), of1, of2], retro: retroDe(diag.itens) })
  const cli = renderDiagnosticoMotor(j, { para: 'cliente', nomesInternos: NOMES }), nos = nosDeTexto(cli)
  const reprov = nos.flatMap(t => auditarTexto(t, { nomesInternos: NOMES, permitidos: ['__teste__'] }).map(v => `${v.codigo} :: ${t.slice(0, 60)}`)); assert.deepEqual(reprov, [])
  assert.doesNotMatch(nos.join('\n'), /Notion|Algoritmo|m[óo]dulo de Ofertas|\bjob\b|Giovanna/i)
  assert.ok(nos.includes('qualidade com pendencias (alta)'), 'a atribuição interna sai, o conteúdo fica'); assert.match(cli, /Fonte: Mercado Livre e registros da Place2u/); assert.match(cli, /Versão <b>v/)
  const int = renderDiagnosticoMotor(j, { para: 'interno' }); assert.match(int, /Fonte oficial: Notion/); assert.match(int, /Algoritmo <b>v/); assert.match(int, /job do módulo de Ofertas/)
})
await ok('refutação achado 5: fragmento de variante sem anúncio ("variante 7c1e9a42", título de oferta_cadastro) some do texto ao cliente e é ID interno no auditor', () => {
  const a = { ...acaoDe('oferta_cadastro', '', { titulo: 'Lançar anúncio novo: variante 7c1e9a42' }, { entidade: { tipo: 'conta', id: '__teste__' }, nivel: 'conta', problema: 'Produto/variante sem anúncio no canal', executar_via: 'oferta', item: null }), item_id: '' }
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe([item({ id: 'MLB45' })]), acoes: [a] })
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  const cli = renderDiagnosticoMotor(j, { para: 'cliente' }); assert.doesNotMatch(cli, /7c1e9a42|variante [0-9a-f]{8}/i); assert.match(cli, /<b>Lançar anúncio novo<\/b>/)
  assert.ok(auditarTexto('Lançar anúncio novo: variante 7c1e9a42').some(v => v.codigo === 'id_interno'))
  assert.match(renderDiagnosticoMotor(j, { para: 'interno' }), /variante 7c1e9a42/, 'interno mantém')
})

// ── sobras (08/10/2026, grupo diagnóstico): cada bloco falha sem a correção ──
const { paginaDiagnostico, traduzirEnumML } = await import('../src/lib/render-diagnostico-motor.js')
const { TERMOS_PROIBIDOS_PROMPT } = await import('../src/lib/ofertas-diagnostico.js')
const { readFileSync } = await import('node:fs')
await ok('sobras — IA no modo cliente: paginaDiagnostico(para=cliente) nunca chama redigir (stub), a leitura é a determinística da visão do cliente; interno chama uma vez com crivo interno; a rota não chama redigir direto', async () => {
  const diag = diagDe([item({ id: 'MLB50', r: 5000, u: 100, v: 600, conv: 16.7 })]), j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes: [acaoDe('ima_conversao', 'MLB50')], retro: retroDe(diag.itens) })
  const chamadas = [], stub = async a => { chamadas.push(a.crivo); return { texto: 'Leitura redigida pela IA com 99%.', origem: 'ia' } }
  const cli = await paginaDiagnostico(j, { para: 'cliente', redigir: stub })
  assert.deepEqual(chamadas, [], 'ao cliente a IA nunca é chamada')
  assert.doesNotMatch(cli, /Leitura redigida pela IA/); assert.match(cli, /1 problema\(s\) e 0 oportunidade\(s\) identificados pelas regras/, 'leitura determinística da visão do cliente')
  const int = await paginaDiagnostico(j, { para: 'interno', redigir: stub })
  assert.deepEqual(chamadas, ['interno']); assert.match(int, /Leitura redigida pela IA/)
  const rota = readFileSync(new URL('../src/rotas-planos.js', import.meta.url), 'utf-8'), bloco = rota.slice(rota.indexOf("rotasPlanos.get('/diagnostico-motor'"), rota.indexOf("rotasPlanos.get('/api/cliente/diagnostico.csv'"))
  assert.ok(bloco.includes('paginaDiagnostico(') && !/\bredigir\(/.test(bloco), 'a rota decide pela paginaDiagnostico, sem chamar redigir direto')
  const doc = readFileSync(new URL('../docs/motor-diagnostico.md', import.meta.url), 'utf-8'); assert.match(doc, /IA só no relatório interno; ao cliente, texto determinístico/)
})
await ok('sobras — enum cru do ML ao cliente: cada status/tipo de anúncio/logística conhecido vira PT por mapa fechado; desconhecido (status em inglês ou snake_case) sai da frase, nunca cru; interno mantém o valor da API', () => {
  const ROT = { active: 'ativo', paused: 'pausado', under_review: 'em revisão pelo Mercado Livre', inactive: 'inativo', closed: 'encerrado', payment_required: 'com pagamento pendente no Mercado Livre', not_yet_active: 'ainda não ativado' }
  const TIPOS = { gold_special: 'Clássico', gold_pro: 'Premium' }
  const LOG = { fulfillment: 'Full', cross_docking: 'Coleta (cross docking)', drop_off: 'Postagem (drop off)', xd_drop_off: 'Postagem (cross docking)', self_service: 'Flex', not_specified: 'Não informada' }
  const restrito = (st, extra = {}) => acaoDe('anuncio_restrito', 'MLB51', {}, { problema: `Status ${st}; vendeu R$ 1.000,00 (10 un) nos 28 dias anteriores e R$ 0,00 nos atuais`, evidencia: `status ${st} na última leitura do anúncio; receita R$ 1.000,00 → R$ 0,00.`,
    causas_possiveis: [{ causa: 'pausa_ou_moderacao', tipo: 'fato', sinal: `status ${st} na última leitura` }], confirmar_com: ['sub_status/moderação — NOT_COLLECTED'], indicador_inicial: `status ${st}`, ...extra })
  const cliDe = a => { const j = montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe([item({ id: 'MLB51' })]), acoes: [a] }); assert.deepEqual(validarContrato(j), { ok: true, erros: [] }); return { j, cli: renderDiagnosticoMotor(j, { para: 'cliente' }), nos: nosDeTexto(renderDiagnosticoMotor(j, { para: 'cliente' })) } }
  for (const [st, pt] of Object.entries(ROT)) {
    const { j, cli, nos } = cliDe(restrito(st))
    assert.ok(nos.includes(`Status ${pt}; vendeu R$ 1.000,00 (10 un) nos 28 dias anteriores e R$ 0,00 nos atuais`), `${st}: ${nos.filter(t => /Status/.test(t)).join(' | ')}`)
    assert.ok(nos.includes(`status ${pt}`), `${st}: indicador`); assert.match(cli, new RegExp(`pausa ou moderação do anúncio: status ${pt} na última leitura`), `${st}: causa`)
    assert.ok(nos.includes('moderação — não coletado'), `${st}: confirmar com sem sub_status cru`)
    assert.ok(!nos.some(t => new RegExp(`\\b${st}\\b`).test(t)), `${st} cru ao cliente`); assert.match(renderDiagnosticoMotor(j, { para: 'interno' }), new RegExp(`Status ${st};`), `${st}: interno cru`)
  }
  for (const [tp, pt] of Object.entries({ ...TIPOS, ...LOG })) {
    const { nos } = cliDe(restrito('paused', { hipotese: `anúncio com ${tp} ainda vende` }))
    assert.ok(nos.includes(`anúncio com ${pt} ainda vende`), `${tp}: ${nos.filter(t => /ainda vende/.test(t)).join(' | ')}`); assert.ok(!nos.some(t => t.includes(tp)), `${tp} cru`)
  }
  for (const desconhecido of ['suspended', 'blocked_by_policy']) {
    const { nos } = cliDe(restrito(desconhecido, { hipotese: 'anúncio gold_premium_x com tipo_novo_ml ainda vende' }))
    assert.ok(!nos.some(t => t.includes(desconhecido) || /gold_premium_x|tipo_novo_ml/.test(t)), `${desconhecido} nunca cru`)
    assert.ok(nos.includes('vendeu R$ 1.000,00 (10 un) nos 28 dias anteriores e R$ 0,00 nos atuais'), `${desconhecido}: a frase fica, sem o status sem rótulo`)
    assert.ok(nos.includes('anúncio com ainda vende'), 'palavra técnica sem rótulo omitida da frase')
  }
  assert.equal(traduzirEnumML('Legging Active Fit'), 'Legging Active Fit', 'título do cliente em inglês fora do contexto "status" não é traduzido')
  assert.equal(traduzirEnumML('status do anúncio'), 'status do anúncio', 'palavra PT depois de "status" fica')
})
await ok('sobras — motivo da margem: com custos e margem depois de Ads nula, a leitura diz o motivo real (janela parcial acima do corte, sem TACOS), nunca "Sem custos informados"; parcial marcado; sem custos segue "Sem custos informados"', () => {
  const eco = { margem_pre_ads_pct: 38, acos_breakeven_pct: 38, roas_breakeven: 2.63, margem_desejada_pct: 10, acos_max_pct: 28, roas_alvo: 3.57, viavel: true, nota: '' }
  const comCustos = extra => montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB52' })], { custos_informados: true, custos: { cmv_pct: 40, comissao_pct: 16, imposto_pct: 6 }, economia: eco, ...extra }) })
  const corte = comCustos({ margem_pos_ads_pct: null, margem_pos_ads_motivo: '5 dia(s) da janela sem coleta de pedidos (acima de 3): com a receita incompleta, o custo de Ads sobre a receita sairia inflado e a margem, menor que a real' })
  assert.equal(corte.metrics.conta.margem_pre_ads.valor, 38); assert.equal(corte.metrics.conta.margem_pos_ads.valor, null)
  const l1 = leituraDeterministica(corte); assert.doesNotMatch(l1, /Sem custos informados/); assert.match(l1, /Margem depois de Ads sem leitura \(5 dia\(s\) da janela sem coleta de pedidos/)
  const semTacos = comCustos({ margem_pos_ads_pct: null })
  assert.match(semTacos.metrics.conta.margem_pos_ads.motivo, /^sem TACOS \(custo de Ads ÷ receita total\)/); assert.doesNotMatch(semTacos.metrics.conta.margem_pos_ads.motivo, /\bACOS\b/)
  assert.match(leituraDeterministica(semTacos), /Margem depois de Ads sem leitura \(sem TACOS/); assert.match(renderDiagnosticoMotor(semTacos, { para: 'cliente' }), /Margem depois de Ads sem leitura \(sem TACOS/)
  const parc = comCustos({ margem_pos_ads_pct: 25, margem_pos_ads_motivo: 'parcial: 26 de 28 dias coletados', margem_pos_ads_parcial: { dias_cobertos: 26, dias: 28, dias_sem_coleta: 2, dias_truncados: 0 } })
  assert.match(leituraDeterministica(parc), /Margem estimada depois de Ads: 25% \(parcial\)/)
  assert.match(leituraDeterministica(montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB52' })]) })), /Sem custos informados: nenhuma leitura de margem\./)
})
await ok('sobras — termo proibido numa fonte só: restricoes.proibido = TERMOS_PROIBIDOS_PROMPT (ofertas-diagnostico) + 2; "top" sai como a regra (elogio/promessa), nunca a palavra solta; os demais termos do config seguem', () => {
  const ficha = { nome: 'Top Fitness Nadador', marca: 'Bee', modelo: 'TF1', cor: 'Preto', tamanho: 'M', atributos: [] }
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe([item({ id: 'MLB53' })]), acoes: [acaoDe('oferta_titulo_descricao', 'MLB53')], ofertas: { porItem: new Map([['MLB53', { ficha, referencia_confirmada: true, voz_coletada: true, titulo_proposto: 'Top Fitness Nadador Bee TF1 Preto M' }]]) } })
  assert.ok(j.derived_prompts.length)
  for (const p of j.derived_prompts) {
    assert.deepEqual(p.restricoes.proibido, [...TERMOS_PROIBIDOS_PROMPT, 'inventar característica', 'prometer resultado'])
    assert.ok(!p.restricoes.proibido.includes('top'), '"top" solto viraria proibição para "Top Fitness Nadador"')
    assert.ok(p.restricoes.proibido.some(t => /^top como elogio ou promessa/.test(t)) && p.restricoes.proibido.includes('top de linha') && p.restricoes.proibido.includes('presente'))
  }
})

// ── sobras 2 (08/10/2026, céticos): cada bloco falha sem a correção ──
await ok('sobras 2 — logística sem rótulo ("custom" existe no banco real; "default" no ML) pela regra REAL full_envio: nunca crua ao cliente, a frase fica sem o valor; interno mantém', () => {
  for (const lg of ['custom', 'default']) {
    const diag = diagDe([item({ id: 'MLB70', r: 5000, u: 100, v: 600, conv: 16.7, logistica: lg }), item({ id: 'MLB71', r: 1000, u: 20, v: 300, conv: 6.7 })])
    const acoes = montarAcoes('__teste__', diag, { hoje: HOJE }); assert.ok(acoes.some(a => a.regra === 'anuncio_full_envio'), `${lg}: a regra real dispara`)
    const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes }); assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
    const nos = nosDeTexto(renderDiagnosticoMotor(j, { para: 'cliente' }))
    assert.deepEqual(nos.filter(t => new RegExp(`\\b${lg}\\b`).test(t)), [], `${lg} cru ao cliente`)
    assert.ok(nos.includes('Anúncio curva A com boa conversão fora do Full'), nos.filter(t => /Full/.test(t)).join(' | '))
    assert.ok(nos.includes('100 un/28d, conversão 16,7% (≥ benchmark).'), nos.filter(t => /un\/28d/.test(t)).join(' | '))
    assert.match(renderDiagnosticoMotor(j, { para: 'interno' }), new RegExp(`logística atual: ${lg}\\)`), 'interno mantém o valor da API')
  }
  assert.equal(traduzirEnumML('logística atual: default'), ''); assert.equal(traduzirEnumML('logística self_service'), 'logística Flex')
})
await ok('sobras 2 — "Status <Palavra>" no NOME do produto não é status da API: título do anúncio chega inteiro ao cliente; traduzirEnumML só lê valor minúsculo da API', () => {
  const titulo = 'Camiseta Banda Status Quo'
  const j = montarDiagnostico('__teste__', { hoje: HOJE, diag: diagDe([item({ id: 'MLB72', titulo })]), acoes: [acaoDe('ima_conversao', 'MLB72', {}, { item: { id: 'MLB72', titulo, catalogo_origem: 'nao' } })] })
  assert.ok(nosDeTexto(renderDiagnosticoMotor(j, { para: 'cliente' })).includes(titulo), 'título inteiro ao cliente')
  for (const t of ['Camiseta Status Quo, Preta', 'Relógio Masculino Status Gold', 'Perfume Status Closed']) assert.equal(traduzirEnumML(t), t, t)
  assert.equal(traduzirEnumML('Status paused; vendeu'), 'Status pausado; vendeu'); assert.equal(traduzirEnumML('status closed.'), 'status encerrado.')
})
// ── motor-res (08/10/2026): A5 nome do produto em minúsculas com "status" dentro de título/problema de ação; A6 percentual minúsculo nunca "0%"; A1 "top premium" na fonte única dos prompts ──
await ok('motor-res A5: "status <palavra>" no MEIO de uma frase (nome do produto em minúsculas no título da ação) não é traduzido nem removido; o slot das regras (abrindo a oração) segue traduzido/omitido', () => {
  for (const t of ['relógio masculino status gold', 'camiseta banda status quo', 'Avaliar envio ao Full: relógio masculino status gold', 'Receita concentrada em camiseta banda status quo', 'perfume status closed masculino', 'anúncio status paused ainda vende'])
    assert.equal(traduzirEnumML(t), t, t)
  assert.equal(traduzirEnumML('Status paused; vendeu'), 'Status pausado; vendeu'); assert.equal(traduzirEnumML('status closed.'), 'status encerrado.'); assert.equal(traduzirEnumML('status suspended na última leitura'), ' na última leitura')
  // MUDOU (cético A5): "(status suspended)" dava "()" — nenhuma regra escreve "(status X)" (só "(logística atual: X)", plano-anuncios.js full_envio) e "(" é separador comum
  // dentro de título ("boné (status quo)"). Hífen, travessão, dois-pontos e ponto idem: só "^", ";" e "(logística atual:" abrem slot
  assert.equal(traduzirEnumML('(status suspended)'), '(status suspended)')
  for (const t of ['relógio masculino - status gold', 'relógio masculino (status gold)', 'camiseta banda: status quo', 'camiseta banda – status quo', 'camiseta banda — status quo', 'camiseta. status quo', 'boné (status quo)', 'caixa - logística organizadora', 'Avaliar: logística organizadora',
    'Avaliar envio ao Full: status quo', 'anúncio com status paused desde setembro', 'ficou com status closed'])
    assert.equal(traduzirEnumML(t), t, t)   // enum conhecido no meio da frase também não é traduzido: "perfume status closed masculino" é nome de produto, o render não sabe o limite (docs/motor-diagnostico.md)
  assert.equal(traduzirEnumML('fora do Full (logística atual: xd_drop_off)'), 'fora do Full (logística atual: Postagem (cross docking))'); assert.equal(traduzirEnumML('fora do Full (logística atual: custom)'), 'fora do Full ()')
  assert.equal(traduzirEnumML('conversão 16,7%; logística custom.'), 'conversão 16,7%; .'); assert.equal(traduzirEnumML('conversão 16,7%; status paused.'), 'conversão 16,7%; status pausado.')
  // regra REAL full_envio com o título do anúncio em minúsculas (com e sem separador antes de "status"/"logística"): a ação chega ao cliente com o nome inteiro
  for (const titulo of ['relógio masculino status gold', 'relógio masculino - status gold', 'relógio masculino (status gold)', 'camiseta banda: status quo', 'camiseta banda – status quo', 'caixa - logística organizadora']) {
    const diag = diagDe([item({ id: 'MLB90', titulo, r: 5000, u: 100, v: 600, conv: 16.7, logistica: 'drop_off' }), item({ id: 'MLB91', r: 1000, u: 20, v: 300, conv: 6.7 })])
    const acoes = montarAcoes('__teste__', diag, { hoje: HOJE }).filter(a => a.regra === 'anuncio_full_envio'); assert.equal(acoes.length, 1, titulo)
    const j = montarDiagnostico('__teste__', { hoje: HOJE, diag, acoes }); assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
    const nos = nosDeTexto(renderDiagnosticoMotor(j, { para: 'cliente' }))
    assert.ok(nos.includes(`Avaliar envio ao Full: ${titulo}`), `${titulo} → ${nos.filter(t => /Full/.test(t)).join(' | ')}`); assert.ok(!nos.some(t => /(?:relógio masculino|camiseta banda|caixa)\s*[-–:(]?\s*(?:status|logística)?\s*$/.test(t)), `nada do nome some: ${titulo}`)
    assert.match(nos.find(t => /fora do Full/.test(t)) || '', /logística atual: Postagem \(drop off\)/, 'o slot da regra segue traduzido')
  }
})
await ok('motor-res A6: formatarEvidencia usa pctTxt — percentual minúsculo sai com 2 algarismos significativos, nunca "0%" para valor ≠ 0; zero medido segue "0%"', () => {
  assert.equal(formatarEvidencia({ valor: 0.00036, unidade: '%' }), '0,00036%'); assert.equal(formatarEvidencia({ valor: 0.0000012, unidade: '%' }), '0,0000012%'); assert.equal(formatarEvidencia({ valor: 0.049, unidade: '%' }), '0,049%')
  for (const v of [0.00036, 0.0004, 0.000049, 1e-7, 1e-12, 0.5, 0.049]) assert.doesNotMatch(formatarEvidencia({ valor: v, unidade: '%' }), /^-?0%$/, String(v))
  assert.equal(formatarEvidencia({ valor: 0, unidade: '%' }), '0%'); assert.equal(formatarEvidencia({ valor: 12.345, unidade: '%' }), '12,3%'); assert.equal(formatarEvidencia({ valor: -15.26, unidade: '%' }), '-15,3%')
  // cético A6: milhar com ponto como "x"/BRL ("12.345,7%", não "12345,7%"); valor minúsculo nunca em notação científica ("1e-7%")
  assert.equal(formatarEvidencia({ valor: 12345.678, unidade: '%' }), '12.345,7%'); assert.equal(formatarEvidencia({ valor: -1234.56, unidade: '%' }), '-1.234,6%'); assert.equal(formatarEvidencia({ valor: 12345.678, unidade: 'x' }), '12.345,68')
  assert.equal(formatarEvidencia({ valor: 1e-7, unidade: '%' }), '0,0000001%'); assert.equal(formatarEvidencia({ valor: 1e-12, unidade: '%' }), '0,000000000001%'); assert.equal(formatarEvidencia({ valor: 0.999, unidade: '%' }), '1%'); assert.equal(formatarEvidencia({ valor: 99.995, unidade: '%' }), '100%')
  for (const v of [1e-7, 1e-12, 0.00036, 12345.678]) for (const u of ['%', 'x', 'BRL', 'un']) assert.doesNotMatch(formatarEvidencia({ valor: v, unidade: u }), /e-|^-?0(?:%| |$)/, `${v} ${u}`)
  assert.equal(formatarEvidencia({ valor: 0.03, unidade: '%' }), '0,03%'); assert.equal(formatarEvidencia({ valor: 0.004, unidade: 'BRL' }), 'R$ 0,004', 'BRL inalterado')
  assert.ok(TERMOS_PROIBIDOS_PROMPT.find(t => /^top como elogio ou promessa/.test(t)).includes('top premium'), 'A1: "premium" como elogio do top chega aos prompts derivados pela mesma fonte')
})
await ok('sobras 2 — leitura de Ads: ROAS nula com Ads coletado (500 impressões, 0 cliques) diz o motivo real e o CTR/TACOS medidos (0 é 0), nunca "Sem Product Ads coletado"; sem Ads segue "Sem Product Ads"', () => {
  const ads = { custo: 0, receita: 0, roas: null, acos: null, ctr: 0, tacos: 0, cpc: null, custo_por_pedido: null, participacao_pct: 0, clicks: 0, prints: 500, unidades: 0, anterior: { roas: null, ctr: null, prints: 0, clicks: 0 } }
  const j = montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB73' })], { ads }) })
  assert.equal(j.metrics.conta.roas.valor, null); assert.equal(j.metrics.conta.ctr_ads.valor, 0); assert.equal(j.metrics.conta.tacos.valor, 0)
  const l = leituraDeterministica(j); assert.doesNotMatch(l, /Sem Product Ads/); assert.match(l, /Ads coletado com ROAS sem leitura \(sem base \(cliques\/receita atribuída = 0\)\); CTR 0%; TACOS 0%\./)
  assert.match(renderDiagnosticoMotor(j, { para: 'cliente' }), /Ads coletado com ROAS sem leitura/, 'passa no auditor ao cliente')
  assert.match(leituraDeterministica(montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB73' })]) })), /Sem Product Ads coletado no período\./)
})

// ── mundo em memória: rotas reais numa porta efêmera (molde de teste-folha-anuncio.mjs). Cliente A é o da parte G1 (4 anúncios, Ads, custos, metas, 2 dias sem coleta) ──
const B = 'Cliente B', PROSPECT = '[Comercial] Loja X'
db.transaction(() => {
  const insItem = db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, status, estoque, fotos, frete_gratis, criado_em, vis_de, vis_ate, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  const insSerie = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  const insCob = db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,3,0,'x')")
  for (let i = 1; i <= 3; i++) { insItem.run(B, 'MLB90000000' + i, 'B ' + i, 'https://ml/b' + i, '', 30, 'active', 50, 8, 1, '2025-01-01', '2025-01-01', HOJE, 'x'); for (let d = -56; d <= -1; d++) insSerie.run(B, 'MLB90000000' + i, D(d), 1, 30, 10) }
  for (let d = -56; d <= -1; d++) insCob.run(B, D(d))
  db.prepare("INSERT INTO meli_contas (cliente, meli_user_id, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em) VALUES (?, 2, 'x', 'x', '2026-12-01', 'read', '2026-01-01', 'x')").run(B)
  insItem.run(PROSPECT, 'MLB1', 'Prospect', '', '', 10, 'active', 1, 1, 0, '2025-01-01', '', '', 'x'); insSerie.run(PROSPECT, 'MLB1', D(-3), 1, 10, 0)
})()
const diagA = diagnosticarConta(A, { hoje: HOJE }), acoesA = montarAcoes(A, diagA, { hoje: HOJE }); salvarAcoesAnuncio(A, acoesA)
db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, item_id, previsao_json, criado_em, atualizado_em) VALUES (?,?,'Mercado Livre',?,'2026-10',?,'7d','2026-10-15','Giovanna Torres','',80,?,'proposta','MLB1','',?,?)")
  .run('PS-abcdef0123', A, 'anuncio_ads_reduzir', '=SOMA(1) (MLB1)', JSON.stringify({ problema: 'Gastou R$ 100,00 em 28 dias com ROAS 5', hipotese: 'Realocar é HIPÓTESE.', evidencia_tipo: 'fato', evidencia: 'ROAS 5 contra 4,5 da conta (MLB1)', prioridade: { p: 'P1', nota: 80, componentes: {} }, entidade: { tipo: 'anuncio', id: 'MLB1' }, nivel: 'anuncio', causas_possiveis: [], confirmar_com: [], parada: 'x', revisar_em: '2026-10-29', depende_de: [], executar_via: 'notion', indicador_inicial: 'ROAS 5', meta: 'ROAS 6', item: { id: 'MLB1', titulo: 'Produto MLB1', catalogo_origem: 'nao' } }), '2026-10-05T08:00:00.000Z', '2026-10-05T08:00:00.000Z')
const app = express(); app.use(rotasPlanos)
const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const base = `http://127.0.0.1:${srv.address().port}`, q = s => encodeURIComponent(s)
const get = async c => { const r = await fetch(base + c); const buf = Buffer.from(await r.arrayBuffer()); const texto = buf.toString('utf-8'); let json = null; try { json = JSON.parse(texto) } catch { /* html/csv */ } return { status: r.status, json, texto, buf } }
try {
  await ok('mundo: GET /api/cliente/diagnostico (cliente A com série, Ads, metas e custos) valida no contrato; métricas e ações reais; margem com custos; metas lidas; data_quality com as lacunas reais', async () => {
    const r = await get(`/api/cliente/diagnostico?cliente=${q(A)}`)
    assert.equal(r.status, 200); const j = r.json
    assert.deepEqual(validarContrato(j), { ok: true, erros: [] }); assert.equal(j.cliente, A); assert.equal(j.versao, '1.6.0'); assert.deepEqual(j.avisos, [])
    // asserção alterada (achado 4, motivo declarado): a rota usa o hoje real, e a janela de A tem as 2 lacunas semeadas + os dias depois da massa (05/10 em diante).
    // Receita com dia sem coleta nunca sai como fato de 28 dias: até o corte é parcial (evidência 'pendente'); acima dele, null com motivo.
    const rc = j.metrics.conta.receita, semColeta = j.data_quality.cobertura.pedidos.lacunas.filter(d => d >= j.periodo.de && d <= j.periodo.ate).length
    assert.ok(semColeta >= 2 && (rc.valor === null ? /sem coleta/.test(rc.motivo) : rc.valor > 0 && rc.parcial?.dias_sem_coleta === semColeta), JSON.stringify(rc))
    // margem depois de Ads (− TACOS, sobre o GMV da janela atual) segue o mesmo corte (diagnosticarConta, outra frente): número só com a janela até o corte
    const mp = j.metrics.conta.margem_pos_ads; assert.ok(mp.valor === null ? /sem coleta/.test(mp.motivo) : typeof mp.valor === 'number', JSON.stringify(mp))
    assert.ok(j.metrics.conta.margem_pre_ads.valor === 38 && j.metrics.conta.roas.valor === 5)
    assert.ok(j.data_quality.cobertura.pedidos.lacunas.includes(D(-4)) && j.data_quality.cobertura.pedidos.lacunas.includes(D(-3)), 'a rota usa o hoje real: as 2 lacunas semeadas estão lá (mais os dias depois da massa)'); assert.equal(j.metrics.conta.variacao.valor, null)
    assert.ok(j.actions.length >= 2 && j.actions.some(a => a.id === 'PS-abcdef0123') && j.evidence.length > 20 && j.metrics.anuncios.length === 4)
    assert.equal(j.campaign_diagnoses.conta.meta.acos_max, 20); assert.ok(j.campaign_diagnoses.itens.some(i => i.entidade.id === 'MLB1' && i.roas.valor === 5))
    assert.ok(j.account_diagnosis.estrategia && j.account_diagnosis.estrategia.provisoria === true, 'retroalimentação real com salvar:false')
    assert.equal(db.prepare('SELECT COUNT(*) n FROM retro_ciclo').get().n, 0, 'nada gravado pela leitura')
  })
  await ok('mundo: cliente B sem Ads → campaign_diagnoses.pendencia NOT_SUPPORTED, itens vazios, métricas de Ads null com motivo; ML não conectado → disponivel:false, fontes indisponivel, 3 canais NOT_SUPPORTED, contrato válido; prospect → 400 sem eco', async () => {
    const b = (await get(`/api/cliente/diagnostico?cliente=${q(B)}`)).json
    assert.ok(validarContrato(b).ok); assert.equal(b.campaign_diagnoses.pendencia.estado, 'NOT_SUPPORTED'); assert.match(b.campaign_diagnoses.pendencia.motivo, /não tem Product Ads/); assert.deepEqual(b.campaign_diagnoses.itens, [])
    assert.equal(b.metrics.conta.roas.valor, null); assert.match(b.metrics.conta.roas.motivo, /sem Product Ads/)
    const nc = await get(`/api/cliente/diagnostico?cliente=${q('Sem ML')}`)
    assert.equal(nc.status, 200); assert.equal(nc.json.disponivel, false); assert.ok(validarContrato(nc.json).ok)
    assert.ok(nc.json.data_quality.fontes.every(f => f.status === 'indisponivel')); assert.equal(nc.json.data_quality.analises_bloqueadas.filter(x => x.estado === 'NOT_SUPPORTED' && /Diagnóstico de/.test(x.analise)).length, 3)
    assert.deepEqual(nc.json.canais_suportados, { mercadolivre: 'SUPPORTED', amazon: 'NOT_SUPPORTED', shopee: 'NOT_SUPPORTED', tiktok: 'NOT_SUPPORTED' })
    const p = await get(`/api/cliente/diagnostico?cliente=${q(PROSPECT)}`); assert.equal(p.status, 400); assert.match(p.json.erro, /prospect/); assert.doesNotMatch(p.texto, /Loja X/)
    assert.equal((await get('/api/cliente/diagnostico')).status, 400)
    assert.equal((await get(`/diagnostico-motor?cliente=${q('Sem ML')}`)).status, 404)
  })
  await ok('mundo: /diagnostico-motor interno em PT com ids; ?para=cliente sem PS-/MLB e sem nome interno (Giovanna Torres é responsável de uma ação), leitura determinística (sem chave); .csv com BOM, ";" e defesa contra fórmula', async () => {
    const i = await get(`/diagnostico-motor?cliente=${q(A)}`); assert.equal(i.status, 200); assert.match(i.texto, /Diagnóstico de marketplace/); assert.match(i.texto, /PS-abcdef0123/); assert.match(i.texto, /Giovanna Torres/); assert.match(i.texto, /Métricas da conta/)
    const c = await get(`/diagnostico-motor?cliente=${q(A)}&para=cliente`); assert.equal(c.status, 200)
    assert.doesNotMatch(c.texto, /PS-[0-9a-f]{6}/); assert.doesNotMatch(c.texto, /MLB\d/); assert.doesNotMatch(c.texto, /Giovanna|Torres/); assert.doesNotMatch(c.texto, /Prompts derivados/); assert.match(c.texto, /Leitura/)
    const csv = await get(`/api/cliente/diagnostico.csv?cliente=${q(A)}`); assert.equal(csv.status, 200)
    assert.deepEqual([...csv.buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM'); const linhas = csv.texto.replace(/^\ufeff/, '').split('\r\n'); assert.match(linhas[0], /^"ID";"Cliente";"Entidade"/)
    const soma = linhas.find(l => /SOMA/.test(l)); assert.ok(soma && /;"'=SOMA\(1\)/.test(soma), 'fórmula neutralizada pelo csvSeguro'); assert.ok(linhas.every(l => !/;=|;\+|;-|;@/.test(l)))
    assert.equal((await get(`/api/cliente/diagnostico.csv?cliente=${q(PROSPECT)}`)).status, 400)
  })
  await ok('mundo (achados 1, 2 e 5): ações reais gravadas — operacionais do plano por cliente, cadastrar_custos com "null%" e oferta com "job <hex>" → GET /api/cliente/diagnostico 200 e válido; ?para=cliente sem elas, sem "null%", sem job; interno com tudo', async () => {
    const ins = db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, item_id, previsao_json, criado_em, atualizado_em) VALUES (?,?,'Mercado Livre',?,'2026-10',?,'7d','2026-10-15','','',?,?,'proposta',?,'','2026-10-08T09:00:00.000Z','2026-10-08T09:00:00.000Z')")
    const dados = o => JSON.stringify({ evidencia_tipo: 'fato', evidencia: 'contagem', prioridade: { p: 'P1', nota: 70, componentes: {} }, executar_via: 'notion', ...o })
    db.transaction(() => {
      ins.run('PS-b000000001', B, 'sem_responsavel', 'Atribuir responsável a 6 tarefa(s) abertas sem dono', 70, dados({ problema: '6 tarefas sem dono' }), '')
      ins.run('PS-b000000002', B, 'renovacao', 'Contrato Mercado Livre vencido há 5 dia(s) — tratar a renovação', 69, dados({ problema: 'o playbook pede o CS acionado ~20 dias antes do fim' }), '')
      ins.run('PS-b000000003', B, 'anuncio_cadastrar_custos', 'Informar os custos da conta', 68, dados({ problema: 'Sem custos informados (ACOS null%, TACOS null%)', entidade: { tipo: 'conta', id: B }, nivel: 'conta' }), '')
      ins.run('PS-b000000004', B, 'anuncio_oferta_completa', 'Oferta completa: B 1 · job 3e0c980e (escopo oferta_completa, objetivo lancar)', 67, dados({ problema: 'galeria e ficha incompletas', entidade: { tipo: 'anuncio', id: 'MLB900000001' }, nivel: 'anuncio', item: { id: 'MLB900000001', titulo: 'B 1', catalogo_origem: 'nao' } }), 'MLB900000001')
    })()
    const r = await get(`/api/cliente/diagnostico?cliente=${q(B)}`)
    assert.equal(r.status, 200, 'texto ruim não derruba a rota'); assert.deepEqual(validarContrato(r.json), { ok: true, erros: [] })
    assert.equal(r.json.derived_prompts.find(p => p.acao_id === 'PS-b000000003').estado, 'pendente')
    const c = (await get(`/diagnostico-motor?cliente=${q(B)}&para=cliente`)).texto, i = (await get(`/diagnostico-motor?cliente=${q(B)}`)).texto
    assert.doesNotMatch(c, /Atribuir responsável|Contrato Mercado Livre|playbook|null%|job 3e0c980e|escopo oferta_completa|sem_responsavel|renovacao/); assert.match(c, /Oferta completa: B 1</); assert.match(c, /Custos não informados/)
    assert.match(c, /2 tarefa\(s\) de rotina da equipe/)
    for (const t of ['Atribuir responsável', 'Contrato Mercado Livre vencido', 'job 3e0c980e']) assert.ok(i.includes(t), 'interno: ' + t)
  })
  await ok('achado 14: o contrato é memorizado por (cliente, hoje, carimbo das ações e da coleta); ação nova muda o carimbo; memo:false recalcula; o GET do relatório sem IA não grava ia_cache', async () => {
    const j1 = diagnosticoDoCliente(B), j2 = diagnosticoDoCliente(B)
    assert.equal(j1, j2, 'segundo pedido sem recalcular')
    assert.notEqual(diagnosticoDoCliente(B, { memo: false }), j1)
    db.prepare("UPDATE acoes_plano SET status = 'descartada', atualizado_em = '2026-10-08T10:00:00.000Z' WHERE id = 'PS-b000000001'").run()
    const j3 = diagnosticoDoCliente(B); assert.notEqual(j3, j1, 'carimbo mudou'); assert.ok(!j3.actions.some(a => a.id === 'PS-b000000001'))
    await get(`/diagnostico-motor?cliente=${q(B)}`); await get(`/diagnostico-motor?cliente=${q(B)}&para=cliente`)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM ia_cache WHERE escopo LIKE 'diagnostico:%'").get().n, 0, 'sem IA, nada gravado')
  })
} finally { srv.close() }

// ── v1.5.0 (09/10/2026): regras de saúde da conta entram em issues/actions pelo fluxo normal; o contrato valida; a visão do cliente as mantém (tudo é do cliente) ──
await ok('v1.5.0: as 5 regras de saúde (saúde sintética gravada) viram issues + actions, validarContrato ok, anúncio Full fora de diag.itens entra pelo item mínimo, REGRAS_CLIENTE as inclui e o HTML ao cliente sai em PT sem chave crua', async () => {
  const { visaoCliente, REGRAS_CLIENTE } = await import('../src/lib/render-diagnostico-motor.js')
  const C = '__saude_motor__', T = '2026-10-05T06:00:00.000Z'
  db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, status, estoque, fotos, catalogo, atualizado_em) VALUES (?, 'MLB7001', 'Produto Full parado', 'https://produto.mercadolivre.com.br/MLB-7001-x-_JM', '', 80, 'active', 30, 6, 0, ?)").run(C, T)
  db.prepare("INSERT INTO meli_conta_saude (cliente, dia, level_id, power_seller, taxa_claims, taxa_atraso, taxa_cancel, vendas_periodo, perguntas_abertas, perguntas_24h, claims_abertas, mediacoes, atrasos, fonte_json, pendente_json, coletado_em) VALUES (?, ?, '3_yellow', NULL, 1.8, 3, 0.5, 120, 3, 2, 1, 1, 2, '{}', '{}', ?)").run(C, HOJE, T)
  db.prepare("INSERT INTO meli_claim (cliente, claim_id, item_id, order_id, tipo, estagio, status, motivo, aberto_em, prazo_resposta, fechado_em, atualizado_em) VALUES (?, 'c1', 'MLB1', NULL, 'claim', 'dispute', 'opened', NULL, ?, NULL, NULL, ?)").run(C, T, T)
  db.prepare("INSERT INTO meli_pergunta (cliente, question_id, item_id, texto_hash, status, perguntado_em, respondido_em) VALUES (?, 'q1', 'MLB1', NULL, 'UNANSWERED', '2026-10-03T10:00:00.000Z', NULL), (?, 'q2', 'MLB1', NULL, 'UNANSWERED', '2026-10-03T11:00:00.000Z', NULL)").run(C, C)
  db.prepare("INSERT INTO meli_envio_atraso (cliente, order_id, shipment_id, item_id, prazo_despacho, despachado_em, dias_atraso, status, coletado_em) VALUES (?, 'o1', 's1', 'MLB1', '2026-10-03', NULL, 2, 'ready_to_ship', ?), (?, 'o2', 's2', 'MLB1', '2026-10-04', NULL, 1, 'handling', ?)").run(C, T, C, T)
  db.prepare("INSERT INTO meli_full_estoque (cliente, item_id, inventory_id, dia, disponivel, nao_disponivel, dias_sem_venda, idade_dias, fonte, pendente) VALUES (?, 'MLB7001', 'INV1', ?, 30, 0, 75, NULL, 'estimativa_serie', 'endpoint_nao_verificado')").run(C, HOJE)
  const diag = diagDe([item({ id: 'MLB1', r: 5000, u: 100, v: 600, conv: 16.7 })], { cliente: C }); diag.resumo.ticket = 50
  const acoes = montarAcoes(C, diag, { hoje: HOJE }).map(a => ({ ...a, status: 'proposta' }))
  const REG = ['reputacao_em_risco', 'envio_atrasado', 'reclamacao_sem_resposta', 'pergunta_sem_resposta', 'full_estoque_antigo']
  for (const r of REG) assert.ok(acoes.some(a => a.regra === 'anuncio_' + r), 'ação gerada: ' + r)
  const j = montarDiagnostico(C, { hoje: HOJE, diag, acoes, retro: retroDe(diag.itens) })
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  for (const r of REG) { assert.ok(j.issues.some(i => i.regra === r), 'issue: ' + r); assert.ok(j.actions.some(a => a.regra === r), 'action: ' + r); assert.ok(REGRAS_CLIENTE.has(r), 'allowlist do cliente: ' + r) }
  assert.ok(!j.opportunities.some(o => REG.includes(o.regra)), 'saúde é problema, não oportunidade')
  assert.ok(j.listing_diagnoses.some(l => l.entidade.id === 'MLB7001' && l.problemas.some(p => p.regra === 'full_estoque_antigo' && p.confianca >= 1)), 'anúncio sem venda em 56 d (fora de diag.itens) entra pelo item mínimo')
  assert.ok(j.actions.filter(a => a.regra === 'reclamacao_sem_resposta').every(a => a.executar_via === 'notion') && j.actions.find(a => a.regra === 'full_estoque_antigo').executar_via === 'notion', 'sem custos o Full é decisão do cliente (notion), não promoção')
  const vc = visaoCliente(j); for (const r of REG) assert.ok(vc.issues.some(i => i.regra === r) && vc.actions.some(a => a.regra === r), 'visão do cliente mantém: ' + r)
  const html = renderDiagnosticoMotor(j, { para: 'cliente' })
  for (const t of ['Reputação da conta em risco', 'Pedidos com despacho atrasado', 'Reclamação sem resposta', 'Perguntas sem resposta', 'Estoque parado no Full']) assert.ok(html.includes(t), 'rótulo em PT ao cliente: ' + t)
  assert.doesNotMatch(html, /reputacao_em_risco|envio_atrasado|reclamacao_sem_resposta|pergunta_sem_resposta|full_estoque_antigo|3_yellow|MLB7001|MLB1\b/)
  assert.doesNotMatch(renderDiagnosticoMotor(j, { para: 'interno' }), /undefined|NaN|null%/)
})
// ── alinhamentos com o cliente (10/10/2026): account_diagnosis.alinhamentos[] sem estado novo no enum de bloqueio; contrato válido; render interno com a subtabela
//    "Alinhado com o cliente" (motivo, quem, onde); ao cliente só o rótulo do tipo e "conforme alinhado em dd/mm" (sem motivo, sem anúncio, sem nome); vencido só no interno ──
await ok('alinhamentos: account_diagnosis.alinhamentos (montagem pura e leitura real do banco), validarContrato ok, enum de bloqueio intacto; interno com motivo, cliente só rótulo + "conforme alinhado em dd/mm"', async () => {
  const { visaoCliente } = await import('../src/lib/render-diagnostico-motor.js')
  const ENUM = ['NEEDS_EXTERNAL_DATA', 'NOT_AVAILABLE', 'NOT_AUTHORIZED', 'NOT_SUPPORTED', 'NOT_COLLECTED']
  assert.deepEqual([...ESTADOS_BLOQUEIO].sort(), [...ENUM].sort(), 'alinhamento não vira estado de análise bloqueada')
  const als = [
    { id: 1, tipo: 'pausa_producao', rotulo: 'Pausado de propósito (produção)', rotulo_cliente: 'Pausa combinada', texto_cliente: 'Pausa combinada com você, conforme alinhado em 01/10.', escopo: 'anuncio', chave: 'MLB1', regras: [], motivo: 'erro de produção no fornecedor', acos_alvo: null, por: 'Giovanna Torres', origem: 'painel', desde: '2026-10-01', revisar_em: '2026-10-31', permanente: false, estado: 'vivo' },
    { id: 2, tipo: 'campanha_visibilidade', rotulo: 'Campanha de visibilidade (ACOS alto aceito)', rotulo_cliente: 'Campanha de visibilidade', texto_cliente: 'Campanha de visibilidade, conforme alinhado em 15/09.', escopo: 'anuncio', chave: 'MLB2', regras: [], motivo: 'lançamento combinado', acos_alvo: 30, por: 'Giovanna Torres', origem: 'descarte', desde: '2026-09-15', revisar_em: '2026-10-01', permanente: false, estado: 'vencido' },
  ]
  const j = montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB1' }), item({ id: 'MLB2' })]), alinhamentos: als })
  assert.deepEqual(validarContrato(j), { ok: true, erros: [] })
  assert.equal(j.account_diagnosis.alinhamentos.length, 2); assert.deepEqual(Object.keys(j.account_diagnosis.alinhamentos[0]).sort(), ['acos_alvo', 'chave', 'desde', 'escopo', 'estado', 'id', 'motivo', 'origem', 'permanente', 'por', 'regras', 'revisar_em', 'rotulo', 'rotulo_cliente', 'texto_cliente', 'tipo'])
  assert.ok(j.data_quality.analises_bloqueadas.every(b => ENUM.includes(b.estado)))
  assert.deepEqual(montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB1' })]) }).account_diagnosis.alinhamentos, [], 'sem alinhamento: lista vazia')
  const vc = visaoCliente(j).account_diagnosis.alinhamentos
  assert.deepEqual(vc, [{ tipo: 'pausa_producao', rotulo_cliente: 'Pausa combinada', texto_cliente: 'Pausa combinada com você, conforme alinhado em 01/10.', estado: 'vivo' }], 'cliente: só o vivo, sem motivo/quem/anúncio')
  const int = renderDiagnosticoMotor(j, { para: 'interno' }), cli = renderDiagnosticoMotor(j, { para: 'cliente', nomesInternos: ['Giovanna Torres'] })
  assert.match(int, /Alinhado com o cliente \(interno\)/); assert.match(int, /erro de produção no fornecedor/); assert.match(int, /ACOS alvo 30%/); assert.match(int, /vencido/); assert.match(int, /Giovanna Torres/)
  assert.match(cli, /Alinhado com o cliente</); assert.match(cli, /Pausa combinada/); assert.match(cli, /conforme alinhado em 01\/10/)
  assert.doesNotMatch(cli, /erro de produção|lançamento combinado|Giovanna|Torres|Campanha de visibilidade|\(interno\)/)
  assert.doesNotMatch(int, /undefined|NaN|null%/)
  // leitura real (gerarDiagnostico → alinhamentosReal().listar): o alinhamento gravado no banco entra no contrato do cliente A
  db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, regras_json, tipo, motivo, por, origem, desde, revisar_em, criado_em) VALUES (?, 'conta', '', '[\"cadastrar_custos\"]', 'intencional', 'custos ficam com o financeiro do cliente', 'Giovanna Torres', 'painel', ?, ?, ?)").run(A, HOJE, D(30), HOJE)
  const real = diagnosticoDoCliente(A, { memo: false })
  assert.deepEqual(validarContrato(real), { ok: true, erros: [] })
  const ra = real.account_diagnosis.alinhamentos.find(x => x.tipo === 'intencional'); assert.ok(ra && ra.escopo === 'conta' && ra.regras[0] === 'cadastrar_custos' && /conforme alinhado em/.test(ra.texto_cliente))
  db.prepare("DELETE FROM alinhamento WHERE cliente = ?").run(A)
})
await ok('alinhamentos: a visão do cliente segue o config (tipo "teste" = omitir, como no relatório curto); "Observação do consultor" só no interno; renovar vivo→vivo muda o carimbo do memo (data de revisão nova)', async () => {
  const { visaoCliente } = await import('../src/lib/render-diagnostico-motor.js')
  const { carimboDiagnostico } = await import('../src/lib/diagnostico-motor.js')
  const al = (id, tipo, rot) => ({ id, tipo, rotulo: rot, rotulo_cliente: rot, texto_cliente: `${rot}, conforme alinhado em 01/10.`, escopo: 'anuncio', chave: 'MLB1', regras: [], motivo: '', acos_alvo: null, por: 'Giovanna Torres', origem: 'painel', desde: '2026-10-01', revisar_em: '2026-10-31', permanente: false, estado: 'vivo' })
  const j = montarDiagnostico('__teste__', { hoje: HOJE, acoes: [], diag: diagDe([item({ id: 'MLB1' })]), alinhamentos: [al(1, 'teste', 'Teste em andamento'), al(2, 'pausa_producao', 'Pausa combinada')] })
  assert.deepEqual(visaoCliente(j).account_diagnosis.alinhamentos.map(a => a.tipo), ['pausa_producao'], 'teste (relatorio: omitir) não vai ao cliente')
  const cli = renderDiagnosticoMotor(j, { para: 'cliente', nomesInternos: ['Giovanna Torres'] }), int = renderDiagnosticoMotor(j, { para: 'interno' })
  assert.doesNotMatch(cli, /Teste em andamento|Observação do consultor|<form class="pl-obs"|<script/)
  assert.match(int, /Observação do consultor/); assert.match(int, /data-cliente="__teste__"/); assert.match(int, /escopo: 'conta', tipo: 'outro'/); assert.match(int, /confirmar: true/)
  // carimbo: renovar (vivo → vivo, só revisar_em muda) precisa invalidar o contrato memorizado
  const id = db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, regras_json, tipo, motivo, por, origem, desde, revisar_em, criado_em) VALUES (?, 'conta', '', '[\"cadastrar_custos\"]', 'intencional', '', 'Giovanna Torres', 'painel', ?, ?, ?)").run(A, HOJE, D(30), HOJE).lastInsertRowid
  const c1 = carimboDiagnostico(A)
  db.prepare('UPDATE alinhamento SET revisar_em = ? WHERE id = ?').run(D(60), id)
  assert.notEqual(carimboDiagnostico(A), c1, 'nova data de revisão = contrato novo')
  db.prepare("DELETE FROM alinhamento WHERE cliente = ?").run(A)
})
console.log(`\nteste-diagnostico-motor (G1 parte pura + G4 contrato/IA/render/rotas + v1.5.0 saúde): ${n} verificações ok`)
