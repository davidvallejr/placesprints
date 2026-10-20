// Autoteste da Folha do anúncio (src/lib/folha-anuncio.js + GET /api/cliente/folha e /api/cliente/folha.csv em src/rotas-planos.js + leituraAnuncio de
// src/lib/estado-anuncio.js). Banco EM MEMÓRIA com o schema inteiro (PS_DB_MEMORIA=1 antes dos imports dinâmicos): nunca abre data/db.sqlite, nunca
// chama a API do ML; as rotas reais numa porta efêmera de loopback. Massa: Cliente A (40 anúncios com promoção, Ads, Full, plano e change-log),
// Cliente B (1.500 anúncios, sem promoções nem Ads: honestidade e desempenho) e um prospect do Comercial (recusado).
// Rodar: node scripts/teste-folha-anuncio.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db, hojeLocal } = await import('../src/lib/db.js')
const { addDias } = await import('../src/lib/meli-serie.js')
const { serializar, validar } = await import('../src/lib/filtros.js')
const { leituraAnuncio, textoEvento } = await import('../src/lib/estado-anuncio.js')
const { folhaDoCliente, BLOCOS, csvDaFolha } = await import('../src/lib/folha-anuncio.js')
const { rotasPlanos } = await import('../src/rotas-planos.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = hojeLocal(), D = k => addDias(HOJE, k), dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const A = 'Cliente A', B = 'Cliente B', PROSPECT = '[Comercial] Loja X', SEGREDO = 'SEGREDO_NAO_ECOAR'
const BASE_KEYS = ['anuncio_id', 'titulo', 'permalink', 'thumb', 'sku', 'status_anuncio', 'preco', 'estoque', 'curva', 'catalogo_origem']   // catalogo_origem ('nao'|'proprio'|'terceiros') entrou de PROPÓSITO em 08/10 (selo de catálogo na coluna Anúncio)

// ── massa ───────────────────────────────────────────────────────────────────────
const insItem = db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, preco_original, status, estoque, criado_em, logistica, visao_json, vis_de, vis_ate, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
const insSerie = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
const insCob = db.prepare("INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,1,0,'x')")
const insAds = db.prepare('INSERT INTO meli_ads_item (cliente, item_id, periodo, de, ate, prints, clicks, custo, receita, unidades, status, coletado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
const insOf = db.prepare('INSERT INTO promo_oferta (cliente, item_id, pid, offer_id, tipo, nome, status, preco, preco_original, inicio, fim, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
const insMud = db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,?,?,?,?,?,'x')")
const insAcao = db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES (?,?,'Mercado Livre',?,'2026-10',?,'7d','2026-10-15',?,?,?,?,'x','x')")
const ADS_DE = D(-28), ADS_ATE = D(-1)
db.transaction(() => {
  for (let d = -100; d <= 0; d++) { insCob.run(A, D(d)); insCob.run(B, D(d)); insCob.run(PROSPECT, D(d)) }
  // Cliente A: 40 anúncios. ímpares têm cobertura de visitas (20/dia); Full nos múltiplos de 3; MLB40 sem logística (—) e com título que parece fórmula
  for (let i = 1; i <= 40; i++) {
    const id = 'MLB' + i, full = i % 3 === 0, cob = i % 2 === 1
    insItem.run(A, id, i === 40 ? '=SOMA(1)' : `Produto ${i}`, `https://ml/${id}`, '', 50 + i, null, 'active', i === 6 ? 5 : 100, '2025-01-01', i === 40 ? '' : full ? 'fulfillment' : 'cross_docking', i === 1 ? '{"seller_custom_field":"SKU-1"}' : '', cob ? '2025-01-01' : '', cob ? HOJE : '', '2026-10-08T05:00:00.000Z')
    // série: 56 dias (28 atuais × 28 anteriores) + o resto dos 90 dias. MLB1 vende 2/dia agora e 1/dia antes; MLB3 CAI (1/dia antes, 10 un agora); MLB6 vende ~1,07/dia (30 un) com 5 em estoque → ruptura
    for (let d = -90; d <= -1; d++) {
      const atual = d >= -28
      let u = i === 1 ? (atual ? 2 : 1) : i === 3 ? (atual ? (d % 3 === 0 ? 1 : 0) : 1) : i === 6 ? (atual ? (d % 14 === 0 ? 2 : 1) : 1) : i <= 12 ? 1 : (d % 7 === 0 ? 1 : 0)
      if (i > 30) u = 0                                       // MLB31–40: sem venda em 90 dias (fora do diagnóstico de 28 d: cobertura —)
      if (u || cob) insSerie.run(A, id, D(d), u, u * (50 + i), cob ? 20 : 0)
    }
  }
  insAds.run(A, 'MLB1', 'atual', ADS_DE, ADS_ATE, 1000, 50, 120, 96, 2, 'active', '2026-10-08T05:00:00.000Z'); insAds.run(A, 'MLB1', 'anterior', D(-56), D(-29), 900, 40, 100, 150, 3, 'active', '2026-10-08T05:00:00.000Z')
  insAds.run(A, 'MLB2', 'atual', ADS_DE, ADS_ATE, 10, 0, 0, 0, 0, 'active', '2026-10-08T05:00:00.000Z')
  insAds.run(A, 'MLB5', 'atual', ADS_DE, ADS_ATE, 500, 25, 50, 200, 3, 'paused', '2026-10-08T05:00:00.000Z')
  db.prepare("INSERT INTO promo_coleta (cliente, coleta_id, estado, iniciada_em, concluida_em) VALUES (?,?,?,?,?)").run(A, 'c1', 'concluida', '2026-10-07T18:10:00.000Z', '2026-10-07T18:15:00.000Z')
  insOf.run(A, 'MLB1', 'P1', 'o1', 'SMART', 'Campanha Outubro', 'started', 85, 100, D(-10) + 'T00:00:00.000-03:00', D(12) + 'T23:59:59.000-03:00', 'x')
  insOf.run(A, 'MLB1', 'P2', 'o2', 'DEAL', 'Oferta do dia', 'candidate', null, null, '', '', 'x')
  insOf.run(A, 'MLB2', 'P2', 'o3', 'DEAL', 'Oferta do dia', 'candidate', null, null, '', '', 'x'); insOf.run(A, 'MLB2', 'P3', 'o4', 'SMART', 'Smart', 'pending', null, null, '', '', 'x')
  db.prepare("INSERT INTO promo_anuncio (cliente, item_id, sku, atualizado_em) VALUES (?,?,?,'x')").run(A, 'MLB1', 'SKU-1')
  db.prepare("INSERT INTO promo_custos_sku (cliente, sku, custo, fonte, atualizado_em) VALUES (?,?,?,?,?)").run(A, 'SKU-1', 40, 'manual', '2026-10-01T00:00:00.000Z')
  db.prepare("INSERT INTO of_anuncio (id, cliente, canal, anuncio_id) VALUES ('ofa1', ?, 'ML', 'MLB4')").run(A)
  db.prepare("INSERT INTO of_job (id, cliente, anuncio_id, escopo, objetivo, estado, publicado_em, criado_em, atualizado_em) VALUES ('job1', ?, 'ofa1', 'titulo_descricao', 'elevar_clique', 'em_revisao', '', '2026-10-01T00:00:00.000Z', '2026-10-05T00:00:00.000Z')").run(A)
  insAcao.run('PS-1', A, 'anuncio_ads_reduzir', 'Reduzir ou pausar Ads sem retorno', 80, JSON.stringify({ problema: 'Gastou R$ 120,00 em 28 dias com ROAS 0.8', hipotese: 'A verba desse anúncio rende menos que a média da conta — HIPÓTESE.', prioridade: { p: 'P1' }, evidencia_tipo: 'fato' }), 'proposta', 'MLB1')
  insAcao.run('PS-2', A, 'anuncio_ima_conversao', 'Descartada não aparece', 70, JSON.stringify({ problema: 'x', hipotese: 'y', prioridade: { p: 'P2' } }), 'descartada', 'MLB1')
  insAcao.run('PS-3', A, 'anuncio_estoque_ruptura', 'Repor estoque', 60, JSON.stringify({ problema: 'Estoque para 5 dias', hipotese: 'Sem reposição o anúncio para de vender — o efeito no ranking é HIPÓTESE.', prioridade: { p: 'P2' } }), 'distribuida', 'MLB3')
  insAcao.run('PS-4', A, 'sem_plano_mes', 'Regra de conta, não de anúncio', 50, '{}', 'proposta', 'MLB1')
  insMud.run(A, 'MLB1', D(-10), 'promocao', 'nenhuma', 'SMART −15%', null, 'promo'); insMud.run(A, 'MLB1', D(-5), 'ads', 'idle', 'active', null, 'ads'); insMud.run(A, 'MLB1', D(-3), 'preco', '100', '110', 10, 'coleta')
  insMud.run(A, 'MLB2', D(-6), 'ads', 'hold', 'active', null, 'ads')
  insMud.run(A, 'MLB3', D(-12), 'promocao', 'SMART −10%', 'nenhuma', null, 'promo'); insMud.run(A, 'MLB3', D(-8), 'ads', 'active', 'paused', null, 'ads')
  insMud.run(A, 'MLB6', D(-4), 'logistica', 'cross_docking', 'fulfillment', null, 'coleta'); insMud.run(A, 'MLB9', D(-2), 'titulo', 'a', 'b', null, 'coleta')
  insMud.run(B, 'MLB7', D(-4), 'promocao', 'nenhuma', 'DEAL −20%', null, 'promo')          // isolamento: evento do B não pode aparecer no A
  // Cliente B: 1.500 anúncios (desempenho); MLB7 existe nos dois clientes (isolamento); sem promoções, sem Ads
  for (let i = 1; i <= 1500; i++) {
    const id = i === 7 ? 'MLB7' : 'MLB9' + String(i).padStart(6, '0')
    insItem.run(B, id, i === 7 ? 'Produto 7 do B' : `B ${i}`, '', '', 20 + (i % 50), null, 'active', 10, '2025-01-01', i % 2 ? 'cross_docking' : 'fulfillment', '', i % 10 === 0 ? '2025-01-01' : '', i % 10 === 0 ? HOJE : '', 'x')
    for (let k = 0; k < 6; k++) { const d = -1 - ((i * 7 + k * 11) % 85); insSerie.run(B, id, D(d), 1 + (k % 2), (1 + (k % 2)) * (20 + (i % 50)), i % 10 === 0 ? 15 : 0) }
  }
  insItem.run(PROSPECT, 'MLB1', 'Prospect', '', '', 10, null, 'active', 1, '2025-01-01', '', '', '', '', 'x'); insSerie.run(PROSPECT, 'MLB1', D(-3), 1, 10, 0)
})()

// ── parte pura: leituraAnuncio / textoEvento ────────────────────────────────────
await ok('leituraAnuncio: sem nada coletado tudo é "—" declarado (nunca zero), sem hipótese e com "Nenhuma ação do plano"', () => {
  const r = leituraAnuncio(null, {})
  assert.deepEqual(r.fatos, ['Vendas: sem venda registrada nos últimos 56 dias', 'Conversão —: visitas não coletadas para este anúncio', 'Ads —: Ads não coletado nesta conta', 'Promoção —: promoções não coletadas para este cliente', 'Full —: logística não coletada', 'Nenhuma ação do plano para este anúncio'])
  assert.deepEqual([r.hipoteses, r.acoes, r.eventos], [[], [], []])
})
await ok('leituraAnuncio: frases dos 4 tópicos com dado; coincidência só com queda (u < 0,85·u0) E evento que cruza fronteira; plano = só o que está salvo', () => {
  const item = { u: 12, u0: 20, conv: 2.1, cobertura: 9 }
  const r = leituraAnuncio(item, { promo: { estado: 'started', tipo: 'SMART', desconto_pct: 15, fim: '2026-10-20', desde: '2026-10-03', candidatas: 0 }, ads: { status: 'active', custo: 120, roas: 0.8, unidades: 2 }, full: { no_full: true, cobertura_dias: 9, risco_ruptura: true }, bench: { conv: 3.5 },
    acoes: [{ id: 'PS-9', regra: 'ads_reduzir', titulo: 'Reduzir ou pausar Ads sem retorno', status: 'proposta', p: 'P1', problema: 'ROAS 0,8', hipotese: 'Realocar é HIPÓTESE.' }], eventos: [{ dia: '2026-10-03', campo: 'promocao', de: 'nenhuma', para: 'SMART −15%' }, { dia: '2026-10-05', campo: 'ads', de: 'active', para: 'paused' }, { dia: '2026-10-06', campo: 'titulo', de: 'a', para: 'b' }] })
  assert.deepEqual(r.fatos, ['12 un em 28 dias (−40% sobre os 28 anteriores)', 'Conversão 2,1%, 40% abaixo da média da conta (3,5%)', 'Ads gastou R$ 120,00 em 28 dias com ROAS 0,8 (2 venda(s) atribuída(s))', 'Em promoção SMART −15% desde 03/10 (até 20/10)',
    'No Full, 9 dias de estoque no ritmo atual', 'Risco de ruptura: menos de 10 dias de estoque', 'A queda coincide com: entrou em promoção (SMART −15%) em 03/10; Ads pausado em 05/10', 'O plano já propõe: Reduzir ou pausar Ads sem retorno (P1, proposta)'])
  assert.deepEqual(r.hipoteses, ['Hipótese: essas mudanças pode explicar a queda. Não medido; compare com os anúncios que não mudaram', 'Reduzir ou pausar Ads sem retorno: ROAS 0,8', 'Realocar é HIPÓTESE.'])
  assert.deepEqual(r.acoes, [{ id: 'PS-9', regra: 'ads_reduzir', titulo: 'Reduzir ou pausar Ads sem retorno', status: 'proposta', p: 'P1' }])
  assert.deepEqual(r.eventos.map(e => e.texto), ['entrou em promoção (SMART −15%)', 'Ads pausado', 'título mudou'])
  const semQueda = leituraAnuncio({ ...item, u: 19 }, { eventos: r.eventos.map(e => ({ ...e })) }); assert.ok(!semQueda.fatos.some(f => f.startsWith('A queda')) && !semQueda.hipoteses.length, 'sem queda não há coincidência')
  const soTitulo = leituraAnuncio(item, { eventos: [{ dia: '2026-10-06', campo: 'titulo', de: 'a', para: 'b' }] }); assert.ok(!soTitulo.fatos.some(f => f.startsWith('A queda')), 'título não cruza fronteira')
  assert.ok(leituraAnuncio({ u: 0, u0: 0, conv: null }, { ads: { status: 'active', custo: 0, desde: '2026-10-02' }, promo: { estado: 'nenhuma', candidatas: 4 }, full: { no_full: false, logistica_rotulo: 'Postagem (cross docking)' } }).fatos.join('|').includes('Ads anunciando desde 02/10, sem gasto em 28 dias|Fora de promoção · 4 campanha(s) candidata(s)|Fora do Full (Postagem (cross docking))'))
  assert.ok(leituraAnuncio(null, { oferta: { estado_rotulo: 'publicada', publicado_em: '2026-10-07T00:30:00.000Z' } }).fatos.includes('Ofertas Estratégicas: publicada (publicada em 06/10)'), 'carimbo UTC vira o dia do Brasil (00h30Z = 21h30 do dia anterior)')
  assert.equal(leituraAnuncio({ u: 1, u0: 1, conv: 3.51 }, { bench: { conv: 3.5 } }).fatos[1], 'Conversão 3,5%, na média da conta (3,5%)'); assert.equal(leituraAnuncio({ u: 1, u0: 1, conv: 2 }, {}).fatos[1], 'Conversão 2,0% (sem média da conta para comparar)')
  assert.deepEqual(['promocao', 'ads', 'logistica', 'estoque_zero', 'status', 'preco', 'fotos'].map(campo => textoEvento({ campo, de: campo === 'promocao' ? 'SMART −10%' : campo === 'ads' ? 'active' : campo === 'logistica' ? 'fulfillment' : campo === 'estoque_zero' ? '3' : campo === 'status' ? 'active' : '6', para: campo === 'promocao' ? 'nenhuma' : campo === 'ads' ? 'idle' : campo === 'logistica' ? 'drop_off' : campo === 'estoque_zero' ? '0' : campo === 'status' ? 'paused' : '9', pct: campo === 'preco' ? -8 : null })),
    ['saiu da promoção', 'Ads desligado', 'saiu do Full', 'estoque zerou', 'pausado', 'preço −8%', 'fotos 6 → 9'])
})

// ── rotas reais, porta efêmera ─────────────────────────────────────────────────
const app = express(); app.use(rotasPlanos)
const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
const base = `http://127.0.0.1:${srv.address().port}`
const get = async (caminho) => { const r = await fetch(base + caminho); const t = await r.text(); let json = null; try { json = JSON.parse(t) } catch { /* CSV */ } return { status: r.status, json, texto: t, headers: r.headers } }
const q = s => encodeURIComponent(s)
const FF = (arvore, periodo) => serializar(validar({ painel: 'folha', arvore, periodo }, { hoje: HOJE }))
const folha = (cliente, extra = '') => get(`/api/cliente/folha?cliente=${q(cliente)}&blocos=anuncios,ads,full,metricas${extra}`)
const naoEcoa = (r, msg) => { assert.equal(r.status, 400, msg); assert.match(r.json?.erro || '', msg); assert.doesNotMatch(r.texto, /SEGREDO|xpto|zzz/) }
const subconjuntos = []
for (let m = 1; m < 16; m++) subconjuntos.push(BLOCOS.filter((_, i) => m & (1 << i)))

try {
  await ok('contrato: os 15 subconjuntos de tópicos devolvem SÓ as chaves marcadas (itens, totais, honestidade); leitura só com os 4; ordem canônica mesmo pedida fora de ordem', async () => {
    for (const sub of subconjuntos) {
      const r = await get(`/api/cliente/folha?cliente=${q(A)}&blocos=${[...sub].reverse().join(',')}`)
      assert.equal(r.status, 200, sub.join())
      const todos = sub.length === 4
      assert.deepEqual(r.json.blocos, sub); assert.equal(r.json.leitura_cruzada, todos)
      assert.deepEqual(Object.keys(r.json.totais), sub); assert.deepEqual(Object.keys(r.json.honestidade), sub)
      assert.equal(r.json.itens.length, 40); assert.equal(r.json.total, 40); assert.equal(r.json.por_pagina, 50)
      for (const it of r.json.itens) assert.deepEqual(Object.keys(it), [...BASE_KEYS, ...sub, ...(todos ? ['leitura'] : [])], sub.join())
      for (const b of sub) assert.ok(Object.keys(r.json.totais[b]).length <= 4, 'no máximo 4 KPIs por bloco')
    }
    const r = await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas,%20anuncios,metricas`); assert.deepEqual(r.json.blocos, ['anuncios', 'metricas'], 'repetido e com espaço: canônico')
  })
  await ok('validação 400 sem eco: tópico desconhecido · marque ao menos um tópico · ordenação indisponível (para os tópicos marcados) · página fora da faixa · filtro de outro painel · prospect recusado', async () => {
    naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}&blocos=xpto`), /tópico desconhecido/)
    naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}&blocos=`), /marque ao menos um tópico/)
    naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}`), /marque ao menos um tópico/)
    naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas&ordem=zzz`), /^ordenação indisponível$/)
    naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas&ordem=roas`), /ordenação indisponível para os tópicos marcados/)
    naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas&ordem=__proto__`), /ordenação indisponível/)
    for (const p of ['0', 'abc', '2', '-1', '1.5']) naoEcoa(await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas&pagina=${p}`), /página fora da faixa/)
    const outro = serializar(validar({ painel: 'cliente', arvore: { campo: 'titulo', operador: 'contem', valor: SEGREDO } }, { hoje: HOJE }))
    naoEcoa(await folha(A, `&ff=${outro}`), /outro painel/)
    naoEcoa(await get(`/api/cliente/folha.csv?cliente=${q(A)}&blocos=metricas&ff=${outro}`), /outro painel/)
    const pr = await folha(PROSPECT); assert.equal(pr.status, 400); assert.match(pr.json.erro, /prospect/)
    assert.equal((await get(`/api/cliente/folha.csv?cliente=${q(PROSPECT)}&blocos=metricas`)).status, 400)
    const semConta = await folha('Ninguém'); assert.equal(semConta.status, 200); assert.equal(semConta.json.disponivel, false); assert.match(semConta.json.motivo, /não conectada/)
    assert.throws(() => folhaDoCliente(A, validar({ painel: 'folha' }), { blocos: ['metricas'] }), /informe o período/)
  })
  await ok('Cliente A com os 4 tópicos: promoção, candidatas, oferta, custo, Ads, Full (risco e sugestão), métricas e "desde" do change-log; honestidade com data da coleta', async () => {
    const r = await folha(A); assert.equal(r.status, 200)
    const por = Object.fromEntries(r.json.itens.map(i => [i.anuncio_id, i]))
    const m1 = por.MLB1
    assert.deepEqual(m1.anuncios.promocao, { estado: 'started', tipo: 'SMART', nome: 'Campanha Outubro', desconto_pct: 15, preco: 85, preco_original: 100, fim: D(12), desde: D(-10) })
    assert.equal(m1.anuncios.candidatas, 1); assert.equal(m1.anuncios.mudancas_preco_28d, 1); assert.deepEqual(m1.anuncios.custo, { custo: 40, origem: 'sku' }); assert.equal(m1.anuncios.oferta, null); assert.equal(m1.sku, 'SKU-1')
    assert.deepEqual(m1.ads, { status: 'active', status_rotulo: 'anunciando', custo: 120, receita: 96, roas: 0.8, acos: 125, ctr: 5, unidades: 2, custo_var_pct: 20, desde: D(-5) })
    assert.equal(m1.full.no_full, false); assert.equal(m1.full.logistica_rotulo, 'Coleta (cross docking)'); assert.equal(m1.full.risco_ruptura, false); assert.equal(m1.full.sugestao, null)
    assert.equal(m1.metricas.unidades, 56 + 61, '28 dias × 2 + 61 dias × 1 dentro dos 90'); assert.equal(m1.metricas.visitas, 89 * 20); assert.equal(m1.curva, 'A'); assert.ok(m1.metricas.conversao > 0 && m1.metricas.preco_realizado === 51)
    assert.equal(por.MLB2.anuncios.promocao.estado, 'nenhuma'); assert.equal(por.MLB2.anuncios.candidatas, 2); assert.equal(por.MLB2.ads.custo, 0); assert.equal(por.MLB2.ads.roas, null); assert.equal(por.MLB2.ads.desde, D(-6))
    assert.deepEqual(por.MLB4.anuncios.oferta, { job_id: 'job1', estado: 'em_revisao', estado_rotulo: 'Em revisão', otimizado_em: '2026-10-05T00:00:00.000Z', publicado_em: null })
    assert.equal(por.MLB8.ads.status, 'sem_anuncio'); assert.equal(por.MLB8.ads.custo, null, 'sem anúncio de Ads: custo não é 0, é não se aplica')
    assert.equal(por.MLB6.full.no_full, true); assert.equal(por.MLB6.full.cobertura_dias, 5); assert.equal(por.MLB6.full.risco_ruptura, true); assert.ok(por.MLB6.full.sugestao.base > 0 && por.MLB6.full.sugestao.premissa); assert.equal(por.MLB6.full.desde, D(-4))
    assert.equal(por.MLB40.full.no_full, null, 'logística vazia = —'); assert.equal(por.MLB40.full.risco_ruptura, null); assert.equal(por.MLB40.metricas.unidades, 0)
    assert.equal(por.MLB2.metricas.visitas, null); assert.equal(por.MLB2.metricas.conversao, null, 'sem cobertura de visitas: — (nunca 0)')
    assert.equal(por.MLB35.full.cobertura_dias, null, 'sem venda em 56 dias: fora do diagnóstico, cobertura —')
    const t = r.json.totais
    assert.deepEqual(t.anuncios, { em_promocao: 1, candidatas: 2, com_oferta_ativa: 1, desconto_mediano_pct: 15 })
    assert.deepEqual(t.ads, { custo: 170, receita: 296, roas: 1.74, anunciando: 2 })
    assert.equal(t.full.no_full, 13); assert.equal(t.full.risco_ruptura, 1); assert.ok(t.full.share_receita_pct > 0 && t.full.cobertura_dias > 0)
    assert.equal(t.metricas.unidades, r.json.itens.reduce((s, i) => s + i.metricas.unidades, 0)); assert.ok(t.metricas.conversao > 0 && t.metricas.delta_faturamento_pct != null)
    const h = r.json.honestidade
    assert.ok(h.anuncios.disponivel && h.anuncios.coletado_em === '2026-10-07T18:15:00.000Z' && /Promoções lidas em 07\/10\/2026 às 15h15/.test(h.anuncios.ressalva), h.anuncios.ressalva)
    assert.ok(h.ads.disponivel && h.ads.janela.de === ADS_DE && /últimos 28 dias/.test(h.ads.ressalva) && /Histórico de Ads ligado\/desligado desde/.test(h.ads.ressalva))
    assert.ok(h.full.disponivel && /Logística não coletada em 1 anúncio/.test(h.full.ressalva))
    assert.ok(h.metricas.disponivel && /20 de 40 anúncios com visitas/.test(h.metricas.ressalva) && h.metricas.aviso_cobertura === '')
    assert.deepEqual([r.json.janela_28d.de, r.json.janela_28d.ate, r.json.periodo.de, r.json.periodo.ate], [D(-28), D(-1), D(-89), HOJE])
  })
  await ok('leitura cruzada (4 tópicos): fatos dos 4 blocos + ação do plano (descartada e regra de conta ficam fora); coincidência fato+hipótese só na queda; eventos de 30 d; nunca promessa', async () => {
    const r = await folha(A); const por = Object.fromEntries(r.json.itens.map(i => [i.anuncio_id, i]))
    const L1 = por.MLB1.leitura
    assert.equal(L1.fatos[0], '56 un em 28 dias (+100% sobre os 28 anteriores)')
    assert.match(L1.fatos[1], /^Conversão 10,0%, \d+% acima da média da conta \(\d+,\d+%\)$/)
    assert.equal(L1.fatos[2], 'Ads gastou R$ 120,00 em 28 dias com ROAS 0,8 (2 venda(s) atribuída(s))')
    assert.equal(L1.fatos[3], `Em promoção SMART −15% desde ${dm(D(-10))} (até ${dm(D(12))})`)
    assert.equal(L1.fatos[4], 'Fora do Full (Coleta (cross docking))')
    assert.equal(L1.fatos.at(-1), 'O plano já propõe: Reduzir ou pausar Ads sem retorno (P1, proposta)')
    assert.deepEqual(L1.hipoteses, ['Reduzir ou pausar Ads sem retorno: Gastou R$ 120,00 em 28 dias com ROAS 0.8', 'A verba desse anúncio rende menos que a média da conta — HIPÓTESE.'])
    assert.deepEqual(L1.acoes, [{ id: 'PS-1', regra: 'ads_reduzir', titulo: 'Reduzir ou pausar Ads sem retorno', status: 'proposta', p: 'P1' }])
    assert.deepEqual(L1.eventos.map(e => e.texto), ['entrou em promoção (SMART −15%)', 'Ads ligado', 'preço +10%'])
    const L3 = por.MLB3.leitura
    assert.equal(L3.fatos[0], '9 un em 28 dias (−68% sobre os 28 anteriores)')
    assert.ok(L3.fatos.includes(`A queda coincide com: saiu da promoção em ${dm(D(-12))}; Ads pausado em ${dm(D(-8))}`), L3.fatos.join(' | '))
    assert.equal(L3.hipoteses[0], 'Hipótese: essas mudanças pode explicar a queda. Não medido; compare com os anúncios que não mudaram')
    assert.ok(L3.fatos.includes('O plano já propõe: Repor estoque (P2, distribuida)') && L3.fatos.includes('Fora de promoção'))
    assert.ok(por.MLB6.leitura.fatos.includes('No Full, 5 dias de estoque no ritmo atual') && por.MLB6.leitura.fatos.includes('Risco de ruptura: menos de 10 dias de estoque'))
    assert.ok(por.MLB2.leitura.fatos.includes(`Ads anunciando desde ${dm(D(-6))}, sem gasto em 28 dias`) && por.MLB2.leitura.fatos.includes('Fora de promoção · 2 campanha(s) candidata(s)') && por.MLB2.leitura.fatos.includes('Conversão —: visitas não coletadas para este anúncio'))
    assert.ok(por.MLB4.leitura.fatos.includes('Ofertas Estratégicas: Em revisão') && por.MLB4.leitura.fatos.includes('Nenhuma ação do plano para este anúncio') && por.MLB4.leitura.fatos.includes('Sem Ads nos últimos 28 dias'))
    assert.ok(por.MLB40.leitura.fatos.includes('Full —: logística não coletada') && por.MLB40.leitura.fatos.includes('Vendas: sem venda registrada nos últimos 56 dias'))
    assert.doesNotMatch(r.texto, /vai vender|garant|certeza/i)
    const sem = await get(`/api/cliente/folha?cliente=${q(A)}&blocos=anuncios,ads,full`); assert.equal(sem.json.leitura_cruzada, false); assert.ok(!('leitura' in sem.json.itens[0]))
  })
  await ok('ordens: faturamento (padrão), variação (piores primeiro), conversão, desconto, Ads custo, ROAS (só quem tem gasto, crescente), cobertura; nulo sempre no fim; MLB desempata', async () => {
    const ids = async (ordem, blocos) => (await get(`/api/cliente/folha?cliente=${q(A)}&blocos=${blocos}&ordem=${ordem}`)).json.itens.map(i => i.anuncio_id)
    const fat = await folha(A); assert.equal(fat.json.ordem, 'faturamento'); const fs = fat.json.itens.map(i => i.metricas.faturamento); assert.deepEqual(fs, [...fs].sort((a, b) => b - a))
    assert.deepEqual((await ids('roas', 'ads')).slice(0, 2), ['MLB1', 'MLB5']); assert.equal((await ids('ads_custo', 'ads'))[0], 'MLB1'); assert.equal((await ids('desconto', 'anuncios'))[0], 'MLB1'); assert.equal((await ids('cobertura', 'full'))[0], 'MLB6')
    const conv = (await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas&ordem=conversao`)).json.itens; assert.ok(conv[0].metricas.conversao >= conv[1].metricas.conversao && conv.at(-1).metricas.conversao === null)
    const v = (await get(`/api/cliente/folha?cliente=${q(A)}&blocos=metricas&ordem=variacao`)).json.itens.map(i => i.metricas.delta_faturamento_pct).filter(x => x != null); assert.deepEqual(v, [...v].sort((a, b) => a - b))
  })
  await ok('filtros do painel folha (?ff=): em promoção · com Ads · ROAS · no Full · risco de ruptura · com ação do plano · curva · faturamento; chips legíveis (Sim/Não); "—" nunca casa', async () => {
    const ids = async (arvore) => { const r = await folha(A, `&ff=${FF(arvore)}`); assert.equal(r.status, 200, JSON.stringify(arvore)); return { ids: r.json.itens.map(i => i.anuncio_id).sort(), r } }
    assert.deepEqual((await ids({ campo: 'em_promocao', operador: 'igual', valor: true })).ids, ['MLB1'])
    assert.deepEqual((await ids({ campo: 'com_ads', operador: 'igual', valor: 1 })).ids, ['MLB1', 'MLB5'])
    assert.deepEqual((await ids({ campo: 'roas', operador: 'maior', valor: 1 })).ids, ['MLB5'])
    assert.deepEqual((await ids({ campo: 'risco_ruptura', operador: 'igual', valor: 1 })).ids, ['MLB6'])
    assert.deepEqual((await ids({ campo: 'tem_acao_plano', operador: 'igual', valor: 1 })).ids, ['MLB1', 'MLB3'])
    const full = await ids({ campo: 'no_full', operador: 'igual', valor: 1 }); assert.equal(full.ids.length, 13); assert.ok(!full.ids.includes('MLB40'), 'logística vazia (—) não é "não"')
    const naoFull = await ids({ campo: 'no_full', operador: 'igual', valor: 0 }); assert.equal(naoFull.ids.length, 26, 'MLB40 (—) também não casa com "Não"')
    const { r } = await ids({ op: 'E', itens: [{ campo: 'curva', operador: 'em', valor: ['A'] }, { campo: 'faturamento', operador: 'maior', valor: 100 }, { campo: 'em_promocao', operador: 'igual', valor: 1 }] })
    assert.deepEqual(r.json.itens.map(i => i.anuncio_id), ['MLB1']); assert.equal(r.json.total, 1); assert.equal(r.json.total_sem_filtro, 40); assert.equal(r.json.totais.anuncios.em_promocao, 1, 'totais seguem o filtro')
    assert.ok(r.json.filtro.chips.some(c => c.texto === 'Em promoção agora é igual a Sim'), JSON.stringify(r.json.filtro.chips)); assert.ok(r.json.filtro.serializado)
    const vazio = await ids({ campo: 'faturamento', operador: 'maior', valor: 1e9 }); assert.deepEqual(vazio.ids, []); assert.equal(vazio.r.json.pagina, 1)
    const b = await get(`/api/cliente/folha?cliente=${q(B)}&blocos=ads,anuncios&ff=${FF({ campo: 'com_ads', operador: 'igual', valor: 0 })}`); assert.equal(b.json.total, 0, 'Ads não coletado (—) não é "não tem Ads"')
  })
  await ok('isolamento e honestidade do Cliente B (sem promoções, sem Ads): MLB7 é o do B; promoção/candidatas/Ads = null e totais null; evento do B não vaza para o A', async () => {
    const r = await get(`/api/cliente/folha?cliente=${q(B)}&blocos=anuncios,ads,full,metricas&ff=${FF({ campo: 'curva', operador: 'em', valor: ['A', 'B', 'C'] })}`)
    const m7 = r.json.itens.find(i => i.anuncio_id === 'MLB7') || (await get(`/api/cliente/folha?cliente=${q(B)}&blocos=anuncios,ads,full,metricas&pagina=2`)).json.itens.find(i => i.anuncio_id === 'MLB7')
    const todas = []; for (let p = 1; p <= r.json.paginas; p++) todas.push(...(await get(`/api/cliente/folha?cliente=${q(B)}&blocos=anuncios,ads&pagina=${p}`)).json.itens)
    const b7 = todas.find(i => i.anuncio_id === 'MLB7'); assert.equal(b7.titulo, 'Produto 7 do B'); assert.ok(!todas.some(i => i.anuncio_id === 'MLB1'))
    assert.deepEqual(b7.anuncios.promocao, { estado: null, tipo: null, nome: null, desconto_pct: null, preco: null, preco_original: null, fim: null, desde: null }); assert.equal(b7.anuncios.candidatas, null); assert.equal(b7.ads, null)
    assert.deepEqual(r.json.totais.ads, { custo: null, receita: null, roas: null, anunciando: null }); assert.equal(r.json.totais.anuncios.em_promocao, null); assert.equal(r.json.totais.anuncios.com_oferta_ativa, 0)
    assert.equal(r.json.honestidade.anuncios.disponivel, false); assert.match(r.json.honestidade.anuncios.ressalva, /não coletadas para este cliente/); assert.equal(r.json.honestidade.ads.disponivel, false); assert.match(r.json.honestidade.ads.ressalva, /aparece —/)
    assert.ok(m7 == null || m7.leitura.fatos.includes('Promoção —: promoções não coletadas para este cliente'))
    const a = await folha(A); assert.ok(!a.json.itens.find(i => i.anuncio_id === 'MLB7').leitura.eventos.length, 'o evento de promoção do MLB7 do B não aparece no MLB7 do A')
  })
  await ok('paginação (Cliente B, 1.500 anúncios): 50 por página, 30 páginas, páginas disjuntas, totais iguais em todas; desempenho < 1 s com os 4 tópicos', async () => {
    const t0 = performance.now(); const p1 = await folha(B); const ms = performance.now() - t0
    assert.equal(p1.status, 200); assert.equal(p1.json.total, 1500); assert.equal(p1.json.paginas, 30); assert.equal(p1.json.itens.length, 50); assert.equal(p1.json.pagina, 1)
    const p2 = await folha(B, '&pagina=2'), p30 = await folha(B, '&pagina=30')
    assert.equal(p30.json.itens.length, 50); assert.equal(p2.json.pagina, 2)
    const s1 = new Set(p1.json.itens.map(i => i.anuncio_id)); assert.ok(!p2.json.itens.some(i => s1.has(i.anuncio_id)) && !p30.json.itens.some(i => s1.has(i.anuncio_id)))
    assert.deepEqual(p1.json.totais, p2.json.totais); assert.deepEqual(p1.json.totais, p30.json.totais); assert.equal(p1.json.totais.metricas.unidades, 1500 * 9)
    assert.ok(p1.json.itens[0].metricas.faturamento >= p1.json.itens[49].metricas.faturamento && p1.json.itens[49].metricas.faturamento >= p30.json.itens[0].metricas.faturamento)
    naoEcoa(await folha(B, '&pagina=31'), /página fora da faixa/)
    console.log(`   desempenho: 1.500 anúncios, 4 tópicos, página 1 com leitura — ${Math.round(ms)} ms de ida e volta (${p1.json.ms} ms no servidor)`)
    assert.ok(ms < 1000, `folha demorou ${Math.round(ms)} ms (meta < 1000 ms)`)
  })
  await ok('CSV = tela: mesmas linhas e ordem do JSON (lista inteira, sem página), colunas dos tópicos marcados + leitura com os 4, ";" e vírgula decimal, BOM, nulo vazio (nunca 0), defesa contra fórmula', async () => {
    const ff = FF({ campo: 'curva', operador: 'em', valor: ['A', 'B', 'C'] })
    const j = await folha(A, `&ff=${ff}`), c = await get(`/api/cliente/folha.csv?cliente=${q(A)}&blocos=metricas,full,ads,anuncios&ff=${ff}`)
    assert.equal(c.status, 200); assert.match(c.headers.get('content-type'), /text\/csv/); assert.match(c.headers.get('content-disposition'), /folha-do-anuncio-cliente-a-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv/)
    assert.ok(c.texto.startsWith('"Folha do anúncio · Cliente A ·'), '1ª linha com cliente, período, tópicos e ressalvas (fetch().text() tira o BOM; ele é conferido em csvDaFolha abaixo)'); assert.match(c.texto.split('\r\n')[0], /tópicos: anuncios, ads, full, metricas/)
    const linhas = c.texto.split('\r\n'), cab = linhas[1].split(';').map(s => s.replace(/^"|"$/g, ''))
    assert.equal(cab.length, 8 + 13 + 9 + 6 + 6 + 4); assert.equal(cab[0], 'Anúncio (MLB)'); assert.ok(cab.includes('ROAS') && cab.includes('No Full') && cab.includes('Leitura: fatos') && cab.includes('O que mudou (30 d)'))
    assert.equal(linhas.length - 2, j.json.total); assert.deepEqual(linhas.slice(2).map(l => l.split(';')[0]), j.json.itens.map(i => `"${i.anuncio_id}"`), 'mesma ordem do JSON')
    const linha = id => Object.fromEntries(cab.map((k, i) => [k, linhas.slice(2).find(l => l.startsWith(`"${id}"`)).split(';')[i].replace(/^"|"$/g, '')]))
    const m1 = linha('MLB1'), m2 = linha('MLB2'), m40 = linha('MLB40')
    assert.equal(m1['ROAS'], '0,8'); assert.equal(m1['Desconto (%)'], '15'); assert.equal(m1['Custo (R$)'], '40'); assert.equal(m1['Ads desde'], D(-5)); assert.match(m1['Leitura: fatos'], /Ads gastou R\$ 120,00/); assert.match(m1['Leitura: ações do plano'], /Reduzir ou pausar Ads sem retorno \(P1, proposta\)/)
    assert.equal(m2['Visitas'], ''); assert.equal(m2['Conversão (%)'], ''); assert.equal(m2['ROAS'], ''); assert.equal(m40['No Full'], ''); assert.equal(m40['Dias de estoque'], ''); assert.equal(m40['Risco de ruptura'], '')
    assert.equal(m40['Título'], "'=SOMA(1)", 'célula que começa com = ganha apóstrofo'); assert.doesNotMatch(c.texto, /\bnull\b|undefined/)
    const so = await get(`/api/cliente/folha.csv?cliente=${q(A)}&blocos=metricas`); assert.equal(so.texto.split('\r\n')[1].split(';').length, 8 + 6, 'sem leitura e só as colunas de métricas')
    const sem = await get(`/api/cliente/folha.csv?cliente=Ninguém&blocos=metricas`); assert.equal(sem.status, 409)
    const direto = csvDaFolha(j.json); assert.equal(direto.charCodeAt(0), 0xFEFF, 'BOM'); assert.equal(direto.slice(1), c.texto, 'csvDaFolha é a mesma função que a rota usa (a rota devolve a lista inteira; aqui são 40, cabem numa página)')
    // número negativo não é fórmula: "-12,5" fica número na planilha (soma e ordena); texto que começa com "-" continua defendido
    const neg = csvDaFolha({ cliente: 'X', periodo: { rotulo: 'p' }, blocos: ['metricas'], leitura_cruzada: false, honestidade: {}, itens: [{ anuncio_id: 'MLB1', titulo: '-12 x', permalink: '', sku: '', status_anuncio: '', preco: 1, estoque: 1, curva: 'A', metricas: { unidades: 1, faturamento: 700, delta_faturamento_pct: -12.5, visitas: null, conversao: null, preco_realizado: 700 } }] }).split('\r\n')[2]
    assert.match(neg, /;"-12,5";/); assert.match(neg, /"'-12 x"/)
  })
} finally { srv.close() }
console.log(`\nteste-folha-anuncio: ${n} verificações ok`)
