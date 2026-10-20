// Autoteste do módulo Promoções por cliente: dados SINTÉTICOS, sem rede, banco EM MEMÓRIA (nunca toca data/db.sqlite).
// Rodar: node scripts/teste-promocoes.mjs
// Garantia de segurança: todo "api"/"chamar" injetado aqui FALHA o teste se for invocado com método ≠ GET.
process.env.PS_PROMO_MEMORIA = '1'                       // tem de vir ANTES dos imports (o módulo lê isto no carregamento)
import assert from 'node:assert/strict'
const M = await import('../src/lib/promocoes-mc.js')
const R = await import('../src/lib/promocoes-db.js')
const A = await import('../src/lib/promocoes-analista.js')
const C = await import('../src/lib/promocoes-coleta.js')
const P = await import('../src/lib/promocoes-plano.js')
const X = await import('../src/lib/promocoes-exec.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { const r = fn(); if (r?.then) throw new Error('use okA para async'); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const perto = (a, b, t = 0.011) => assert.ok(Math.abs(a - b) <= t, `${a} ≠ ${b}`)

const HOJE = '2026-10-05'
// ── builders sintéticos ─────────────────────────────────────────────────────────────────────────────
const of = (item_id, pid, o = {}) => ({ item_id, pid, offer_id: `OFFER-${item_id}-${pid}`, tipo: 'SMART', subtipo: '', nome: `Camp ${pid}`, status: 'candidate', preco: 100, preco_original: 120, meli_pct: 5, seller_pct: 0, inicio: '', fim: '2026-12-31T23:59:59', min_preco: null, max_preco: null, sugerido: null, fonte: 'item', ...o })
const an = (item_id, o = {}) => ({ item_id, sku: `${item_id}-SKU`, sku_fonte: 'teste', titulo: `Anúncio ${item_id}`, permalink: '', status: 'active', sub_status: '', under_review: false, preco: 100, preco_original: 120, estoque: 10, categoria: 'MLB1', tipo_anuncio: 'gold_special', catalogo: false, user_product_id: '', curva: 'A', fat30: 1000, unid30: 10, protegido: false, lido_em: '2026-10-05T10:00:00Z', oferta_erro: '', tarifa: { comissao_pct: 15, taxa_fixa: 0, frete: 10 }, tarifa_json: '', tarifa_estado: '', ...o })
const CFG = { piso_mc: 20, piso_relampago: 19, imposto_pct: 10, dias_vigia: 7, janela_cobertura_dias: 3, hedge_cobertura: 1, execucao_habilitada: 0, execucao_max_itens: 1 }
// com comissão 15% + frete 10 + imposto 10%, preço 100, original 120, rebate 5% (=6): MC = 71 − custo
const custosDe = mapa => new Map(Object.entries(mapa).map(([k, v]) => [k.toLowerCase(), v]))
const rodar = (anuncios, ofertas, extra = {}) => A.analisar({
  hoje: HOJE, config: { ...CFG, ...(extra.config || {}) }, anuncios, campanhas: extra.campanhas || [], ofertasPorItem: R.agruparPorItem(ofertas),
  regrasSku: extra.regras || [], aprendizados: extra.aprendizados || [], custosSku: extra.custos || new Map(), custosCliente: extra.custosCliente ?? null,
})
const marcas = res => res.recomendacoes.map(r => `${r.item_id}:${r.pid}:${r.regra}`)

// ═══ 1. MC ═══════════════════════════════════════════════════════════════════════════════════════════
ok('MC = preço − (comissão − rebate) − frete − custo − imposto', () => {
  const m = M.calcularMC({ preco: 100, precoOriginal: 120, meliPct: 5, comissaoPct: 15, taxaFixa: 0, frete: 10, custo: 45, impostoPct: 10 })
  assert.equal(m.ok, true); assert.equal(m.rebate, 6); assert.equal(m.comissao, 15); assert.equal(m.mc, 26); assert.equal(m.mcPct, 26)
})
ok('rebate = meli% × preço ORIGINAL (não o do candidato)', () => {
  const a = M.calcularMC({ preco: 100, precoOriginal: 200, meliPct: 5, comissaoPct: 15, frete: 10, custo: 45, impostoPct: 10 })
  assert.equal(a.rebate, 10); assert.equal(a.mc, 30)
})
ok('taxa fixa entra na comissão', () => assert.equal(M.calcularMC({ preco: 100, precoOriginal: 100, comissaoPct: 10, taxaFixa: 6, frete: 0, custo: 0, impostoPct: 0 }).mc, 84))
ok('sem custo => "SEM CUSTO" (nunca número otimista)', () => {
  const m = M.calcularMC({ preco: 100, precoOriginal: 100, comissaoPct: 15, frete: 10, custo: null, impostoPct: 10 })
  assert.equal(m.ok, false); assert.equal(m.estado, 'SEM CUSTO'); assert.deepEqual(m.faltando, ['custo'])
  assert.equal(M.calcularMC({ preco: 100, comissaoPct: 15, frete: 10, custo: 1, impostoPct: null }).estado, 'SEM CUSTO')
  assert.equal(M.calcularMC({ preco: 100, comissaoPct: 15, frete: null, custo: 1, impostoPct: 10 }).estado, 'SEM TARIFA/FRETE')
})
ok('resolverCustos: SKU vence; fallback percentual; nenhum => SEM CUSTO', () => {
  const sku = M.resolverCustos({ custoSku: 45, tarifaItem: { comissao_pct: 15, frete: 10 }, impostoPct: 10, precoRef: 120 })
  assert.equal(sku.ok, true); assert.equal(sku.modo, 'sku'); assert.equal(sku.custo, 45)
  const pct = M.resolverCustos({ custosCliente: { cmv_pct: 30, comissao_pct: 15, frete_pct: 8, imposto_pct: 10, embalagem_pct: 2, outros_pct: null }, precoRef: 100 })
  assert.equal(pct.ok, true); assert.equal(pct.modo, 'percentual'); assert.equal(pct.custo, 32); assert.equal(pct.frete, 8)   // custos fixos = % do preço de REFERÊNCIA
  const nada = M.resolverCustos({ custoSku: null, custosCliente: null, impostoPct: 10, precoRef: 100 })
  assert.equal(nada.ok, false); assert.equal(nada.estado, 'SEM CUSTO'); assert.ok(nada.faltando.includes('custo'))
  assert.ok(M.resolverCustos({ custoSku: 45, tarifaItem: { comissao_pct: 15, frete: 10 }, impostoPct: null, precoRef: 100 }).faltando.includes('imposto'))
})
ok('degrau de frete: faixas mudam o frete e a MC', () => {
  const faixas = [{ ate: 79, valor: 0 }, { ate: 200, valor: 20.45 }, { ate: null, valor: 23.25 }]
  assert.equal(M.freteNoPreco(78.9, { faixas }), 0); assert.equal(M.freteNoPreco(79, { faixas }), 20.45); assert.equal(M.freteNoPreco(250, { faixas }), 23.25)
  const base = { precoOriginal: 250, meliPct: 0, comissaoPct: 10, custo: 100, impostoPct: 10, faixasFrete: faixas }
  const m198 = M.calcularMC({ ...base, preco: 198.74 }), m201 = M.calcularMC({ ...base, preco: 201.8 })
  assert.ok(m198.mc > m201.mc, 'abaixo de R$ 200 o frete é menor: rende MAIS que o preço maior (caso W10M)')
})
ok('precoParaMargem acha o menor preço que entrega a margem', () => {
  const c = M.resolverCustos({ custoSku: 45, tarifaItem: { comissao_pct: 15, frete: 10 }, impostoPct: 10, precoRef: 100 })
  const p = M.precoParaMargem(22, c)
  assert.ok(M.calcularMC({ preco: p, precoOriginal: p, ...c }).mcPct >= 22)
  assert.ok(M.calcularMC({ preco: p - 0.02, precoOriginal: p - 0.02, ...c }).mcPct < 22)
  assert.equal(M.precoParaMargem(22, { ok: false }), null)
})
ok('parse de custos colados (; , tab, pt-BR)', () => {
  const r = M.parseCustosCsv('sku;custo\nAB-1;12,50\nAB-2\t1.234,56\nAB-3,7.5\n;3\nAB-4;x\nAB-5;R$ 8')
  assert.deepEqual(r.linhas, [{ sku: 'AB-1', custo: 12.5 }, { sku: 'AB-2', custo: 1234.56 }, { sku: 'AB-3', custo: 7.5 }, { sku: 'AB-5', custo: 8 }])
  assert.equal(r.rejeitadas.length, 2)
})

// ═══ 2. preço vigente ════════════════════════════════════════════════════════════════════════════════
ok('preço vigente = MENOR price entre os started que mexem no preço; nunca o do candidato', () => {
  const ofs = [of('M1', 'A', { status: 'started', preco: 95 }), of('M1', 'B', { status: 'started', preco: 90, tipo: 'DEAL', meli_pct: 0 }),
    of('M1', 'C', { status: 'candidate', preco: 50 }),                                        // candidato BARATO: não pode virar vigente
    of('M1', 'D', { status: 'started', preco: 40, tipo: 'PRICE_MATCHING' }),                  // não mexe no preço
    of('M1', 'E', { status: 'started', preco: 30, tipo: 'SELLER_COUPON_CAMPAIGN', meli_pct: 0 }), of('M1', 'F', { status: 'started', preco: 20, tipo: 'BANK' })]
  const v = M.precoVigente(ofs, 120)
  assert.equal(v.preco, 90); assert.equal(v.oferta.pid, 'B'); assert.equal(v.origem, 'campanha')
  const semAtivo = M.precoVigente([of('M1', 'C', { status: 'candidate', preco: 50 })], 120)
  assert.equal(semAtivo.preco, 120); assert.equal(semAtivo.origem, 'original')
})

// ═══ 3. cobertura contínua ═══════════════════════════════════════════════════════════════════════════
ok('cobertura: lacuna corta; sem lacuna emenda', () => {
  const h = '2026-07-05'
  const a = [of('C1', 'A', { status: 'started', inicio: '2026-07-01', fim: '2026-07-10T23:59:59' }), of('C1', 'B', { status: 'pending', inicio: '2026-07-12', fim: '2026-07-30' })]
  assert.equal(M.coberturaContinua(a, h).cobreAte, '2026-07-10')                              // dia 11 descoberto corta
  const b = [of('C1', 'A', { status: 'started', inicio: '2026-07-01', fim: '2026-07-10' }), of('C1', 'B', { status: 'pending', inicio: '2026-07-11', fim: '2026-07-30' })]
  assert.equal(M.coberturaContinua(b, h).cobreAte, '2026-07-30')
})
ok('cobertura: sem nada => descoberto; pending sem data usa a campanha; relâmpago não usa fallback', () => {
  assert.equal(M.coberturaContinua([], HOJE).descoberto, true)
  const camps = new Map([['P-W', { pid: 'P-W', nome: 'Wearables', inicio: '2026-10-01', fim: '2026-10-20T03:00:00Z' }]])
  const pend = [of('C2', 'P-W', { status: 'pending', inicio: '', fim: '' })]
  assert.equal(M.coberturaContinua(pend, HOJE, { campanhas: camps }).cobreAte, '2026-10-20')       // 03:00Z = 00:00 BRT → 20/10
  const camps2 = new Map([['P-R', { pid: 'P-R', nome: 'OFERTAS RELÂMPAGOS', inicio: '2026-10-01', fim: '2026-11-30' }]])
  const rel = M.coberturaContinua([of('C2', 'P-R', { status: 'started', nome: 'OFERTAS RELÂMPAGOS', fim: '' })], HOJE, { campanhas: camps2 })
  assert.equal(rel.cobreAte, null); assert.ok(rel.avisos.length)
})
ok('cobertura: com × sem rebate separados; PRICE_MATCHING/cupom/BANK não cobrem; data > 60 dias é suspeita', () => {
  const ofs = [of('C3', 'A', { status: 'started', inicio: '2026-10-01', fim: '2026-10-08', meli_pct: 5 }), of('C3', 'B', { status: 'started', tipo: 'DEAL', meli_pct: 0, inicio: '2026-10-01', fim: '2026-10-13' }),
    of('C3', 'C', { status: 'started', tipo: 'PRICE_MATCHING', inicio: '2026-10-01', fim: '2026-12-30' }), of('C3', 'D', { status: 'started', tipo: 'SELLER_COUPON_CAMPAIGN', meli_pct: 0, inicio: '2026-10-01', fim: '2026-12-30' })]
  const c = M.coberturaContinua(ofs, HOJE)
  assert.equal(c.cobreAte, '2026-10-13'); assert.equal(c.cobreAteRebate, '2026-10-08'); assert.equal(c.cobreAteSemRebate, '2026-10-13'); assert.equal(c.suspeita, false)
  assert.equal(M.coberturaContinua([of('C3', 'X', { status: 'started', tipo: 'DEAL', meli_pct: 0, inicio: '2026-10-01', fim: '2027-02-19' })], HOJE).suspeita, true)
})
ok('diaBR: Z → BRT, naive = local, offset respeitado', () => {
  assert.equal(M.diaBR('2026-10-13T02:00:00Z'), '2026-10-12'); assert.equal(M.diaBR('2026-10-13T03:00:00Z'), '2026-10-13')
  assert.equal(M.diaBR('2026-10-08T23:59:59'), '2026-10-08'); assert.equal(M.diaBR('2026-10-19T00:00:00-03:00'), '2026-10-19'); assert.equal(M.diaBR('lixo'), null)
})

// ═══ 4. curva ABC ════════════════════════════════════════════════════════════════════════════════════
ok('curva ABC: A < 80%, B < 95%, C o resto (+ sem venda); o maior nunca cai fora da A', () => {
  const itens = [['a', 700], ['b', 150], ['c', 90], ['d', 40], ['e', 20], ['f', 0]].map(([id, fat]) => ({ id, fat }))
  const c = M.curvaABC(itens)
  assert.equal(c.get('a').curva, 'A'); assert.equal(c.get('b').curva, 'A')          // acumulado antes de b = 70% < 80 → A
  assert.equal(c.get('c').curva, 'B'); assert.equal(c.get('d').curva, 'B'); assert.equal(c.get('e').curva, 'C'); assert.equal(c.get('f').curva, 'C'); assert.equal(c.get('f').semVenda, true)
  assert.equal(M.curvaABC([{ id: 'x', fat: 1000 }]).get('x').curva, 'A')
  assert.equal(M.curvaABC([{ id: 'x', fat: 0 }]).get('x').curva, 'C')
})

// ═══ 5. analista: R1/R2/piso/regras ══════════════════════════════════════════════════════════════════
ok('R2: sem campanha viva → melhor elegível ≥ piso; abaixo do piso e MC negativa NÃO marcam', () => {
  const res = rodar([an('R2A'), an('R2B'), an('R2C')], [of('R2A', 'P1'), of('R2B', 'P1'), of('R2C', 'P1')], { custos: custosDe({ 'R2A-SKU': 45, 'R2B-SKU': 55, 'R2C-SKU': 75 }) })
  assert.deepEqual(marcas(res), ['R2A:P1:R2'])
  assert.equal(res.avaliacoes.get('R2B').motivoSemMarca.codigo, 'abaixo_piso'); assert.match(res.avaliacoes.get('R2B').motivoSemMarca.texto, /16,0%/)
  assert.equal(res.avaliacoes.get('R2C').motivoSemMarca.codigo, 'mc_negativa')
  assert.match(res.recomendacoes[0].obs, /^🤖 Recomendação do analista \(R2\)/)
})
ok('R1: só migra se MC ≥ MC da atual (empate conta) E ≥ piso', () => {
  const atual = of('R1A', 'S1', { status: 'started', preco: 100, meli_pct: 5, inicio: '2026-09-01', fim: '2026-10-30' })          // MC 26
  const cands = [of('R1A', 'C1', { meli_pct: 5, preco: 100 }), of('R1B', 'C1', { meli_pct: 3, preco: 100 }), of('R1C', 'C1', { meli_pct: 5, preco: 100 })]
  const res = rodar([an('R1A'), an('R1B'), an('R1C')], [atual, cands[0], of('R1B', 'S1', { status: 'started', preco: 100, meli_pct: 5, inicio: '2026-09-01', fim: '2026-10-30' }), cands[1],
    of('R1C', 'S1', { status: 'started', preco: 100, meli_pct: 8, inicio: '2026-09-01', fim: '2026-10-30' }), cands[2]], { custos: custosDe({ 'R1A-SKU': 45, 'R1B-SKU': 45, 'R1C-SKU': 45 }) })
  assert.deepEqual(marcas(res), ['R1A:C1:R1'], 'empate (26 = 26) migra')
  assert.equal(res.avaliacoes.get('R1B').motivoSemMarca.codigo, 'atual_melhor')       // candidata 23,6 < atual 26
  assert.equal(res.avaliacoes.get('R1C').motivoSemMarca.codigo, 'atual_melhor')       // atual 8% (MC 28,6) > candidata 26
})
ok('R1: candidata abaixo do piso nunca migra, mesmo "melhor" que a atual ruim', () => {
  const res = rodar([an('R1D')], [of('R1D', 'S1', { status: 'started', preco: 100, meli_pct: 0.1, inicio: '2026-09-01', fim: '2026-10-30' }), of('R1D', 'C1', { meli_pct: 5 })], { custos: custosDe({ 'R1D-SKU': 55 }) })
  assert.equal(marcas(res).length, 0); assert.equal(res.avaliacoes.get('R1D').motivoSemMarca.codigo, 'abaixo_piso')
})
ok('uma marcação por anúncio (a de maior MC) + as demais ≥ piso listadas na observação', () => {
  const res = rodar([an('U1')], [of('U1', 'C1', { preco: 100, meli_pct: 5 }), of('U1', 'C2', { preco: 95, meli_pct: 6 }), of('U1', 'C3', { preco: 90, meli_pct: 2 })], { custos: custosDe({ 'U1-SKU': 45 }) })
  assert.deepEqual(marcas(res), ['U1:C1:R2'])
  const av = res.avaliacoes.get('U1'); assert.deepEqual(av.outras.map(o => o.pid), ['C2'])                 // C3 está abaixo do piso: não é "outra elegível"
  assert.match(res.recomendacoes[0].obs, /outras elegíveis \(NÃO marcadas — marcar derruba o preço p\/ o menor\): Camp C2/)
})
ok('⚠P: anúncio já started noutra campanha leva aviso de desconto sobre desconto', () => {
  const res = rodar([an('PP')], [of('PP', 'DEAL1', { tipo: 'DEAL', meli_pct: 0, status: 'started', preco: 90, nome: '10.10', fim: '2026-10-13' }), of('PP', 'C1')], { custos: custosDe({ 'PP-SKU': 45 }) })
  assert.match(res.avaliacoes.get('PP').avisoP, /⚠P já em: 10\.10 · R\$ 90,00 · MC/); assert.match(res.recomendacoes[0].obs, /⚠P/)
})
ok('regra por SKU: Livre = melhor rebate, qualquer MC, mas "já ativo, não mexer"', () => {
  const regras = [{ mlb: '', sku: 'LV1-SKU', status: 'Livre', nota: '' }, { mlb: '', sku: 'LV2-SKU', status: 'livre', nota: '' }]
  const res = rodar([an('LV1'), an('LV2')], [of('LV1', 'P3', { meli_pct: 3 }), of('LV1', 'P6', { meli_pct: 6 }), of('LV2', 'S', { status: 'started', meli_pct: 4, inicio: '2026-09-01', fim: '2026-12-01' }), of('LV2', 'P6', { meli_pct: 6 })],
    { regras, custos: custosDe({ 'LV1-SKU': 150, 'LV2-SKU': 150 }) })             // MC negativa nos dois
  assert.deepEqual(marcas(res), ['LV1:P6:LIVRE']); assert.equal(res.avaliacoes.get('LV2').motivoSemMarca.codigo, 'ja_ativo')
  const semCusto = rodar([an('LV3', { sku: 'LV3' })], [of('LV3', 'P6', { meli_pct: 6 })], { regras: [{ mlb: '', sku: 'LV3', status: 'Livre' }] })
  assert.deepEqual(marcas(semCusto), ['LV3:P6:LIVRE'], 'Livre não precisa de custo')
})
ok('regra por SKU: "N%" = piso próprio (PISO_SKU); sem regra segue o piso padrão', () => {
  const ofs = [of('PS1', 'C1'), of('PS2', 'C1')]
  const res = rodar([an('PS1'), an('PS2')], ofs, { regras: [{ mlb: '', sku: 'PS1-SKU', status: '5%', nota: '' }], custos: custosDe({ 'PS1-SKU': 55, 'PS2-SKU': 55 }) })   // MC 16%
  assert.deepEqual(marcas(res), ['PS1:C1:PISO_SKU']); assert.equal(res.avaliacoes.get('PS2').motivoSemMarca.codigo, 'abaixo_piso')
  const porMlb = rodar([an('PS3')], [of('PS3', 'C1')], { regras: [{ mlb: 'MLB-X', sku: 'PS3-SKU', status: '99%' }, { mlb: 'PS3', sku: '', status: '10%' }], custos: custosDe({ 'PS3-SKU': 55 }) })
  assert.equal(porMlb.avaliacoes.get('PS3').piso, 10, 'o MLB manda sobre o SKU')
})
ok('regra por SKU: "Revisar toda rodada" nunca decide e vira lembrete TODA rodada', () => {
  const res = rodar([an('RV')], [of('RV', 'C1')], { regras: [{ mlb: 'RV', sku: '', status: 'Revisar toda rodada (FONE-CAT-PR)', nota: 'entrar ou manual' }], custos: custosDe({ 'RV-SKU': 45 }) })
  assert.equal(marcas(res).length, 0); assert.equal(res.vigias.lembretes.length, 1); assert.equal(res.avaliacoes.get('RV').estado, 'revisar_toda_rodada')
})
ok('SEM CUSTO: não recomenda, vira pendência NEEDS_EXTERNAL_DATA', () => {
  const res = rodar([an('SC', { sku: 'SC-9' })], [of('SC', 'C1')])
  assert.equal(marcas(res).length, 0); assert.equal(res.vigias.semCusto.length, 1); assert.equal(res.vigias.semCusto[0].pendencia, 'NEEDS_EXTERNAL_DATA'); assert.ok(res.vigias.semCusto[0].faltando.includes('custo'))
  assert.equal(res.avaliacoes.get('SC').motivoSemMarca.codigo, 'sem_custo')
})
ok('under_review não recebe marca e declara a causa', () => {
  const res = rodar([an('UR', { under_review: true, sub_status: 'waiting_for_patch' })], [of('UR', 'C1')], { custos: custosDe({ 'UR-SKU': 45 }) })
  assert.equal(marcas(res).length, 0); assert.equal(res.avaliacoes.get('UR').estado, 'under_review'); assert.match(res.avaliacoes.get('UR').motivoSemMarca.texto, /waiting_for_patch/); assert.equal(res.vigias.underReview.length, 1)
})
ok('relâmpago SMART: só painel, piso 19%, pista separada; LIGHTNING NUNCA é recomendada', () => {
  const rel = of('RL', 'P-R', { nome: 'OFERTAS RELÂMPAGOS IMPERDÍVEIS', preco: 100, meli_pct: 6 })      // MC 45... com custo 52: 100−(15−7,2)−10−52−10 = 20,2 ≥ 19
  const lgh = of('RL', 'LGH-MLB1000', { tipo: 'LIGHTNING', nome: '', meli_pct: null, preco: 60 })
  const res = rodar([an('RL')], [rel, lgh, of('RL', 'P-N', { preco: 100, meli_pct: 1 })], { custos: custosDe({ 'RL-SKU': 52 }) })
  const rl = res.recomendacoes.find(r => r.regra === 'RELAMPAGO')
  assert.ok(rl); assert.equal(rl.via, 'painel'); assert.equal(rl.pid, 'P-R')
  assert.ok(!res.recomendacoes.some(r => r.pid === 'LGH-MLB1000'), 'LIGHTNING jamais')
  assert.ok(res.avaliacoes.get('RL').avisos.some(a => /LIGHTNING/.test(a)))
  assert.ok(!res.recomendacoes.some(r => r.pid === 'P-N' && r.regra === 'RELAMPAGO'))
  const abaixo = rodar([an('RL2')], [of('RL2', 'P-R', { nome: 'Relâmpago', meli_pct: 6 })], { custos: custosDe({ 'RL2-SKU': 55 }) })       // 17,2% < 19
  assert.equal(abaixo.recomendacoes.length, 0)
})
ok('hedge de cobertura e R1-cobertura (regras do dono, 28/07 e 28/09)', () => {
  const hedge = rodar([an('HG')], [of('HG', 'CURTA', { fim: '2026-10-07T23:59:59', meli_pct: 5 }), of('HG', 'LONGA', { inicio: '2026-10-01', fim: '2026-12-31', meli_pct: 4.9 })], { custos: custosDe({ 'HG-SKU': 45 }) })      // a hedge tem de CONTINUAR a cobertura: início conhecido e ≤ fim da curta + 1
  assert.deepEqual(marcas(hedge), ['HG:CURTA:R2', 'HG:LONGA:HEDGE'])
  const semHedge = rodar([an('HG')], [of('HG', 'CURTA', { fim: '2026-10-07T23:59:59' }), of('HG', 'LONGA', { fim: '2026-12-31', meli_pct: 4.9 })], { custos: custosDe({ 'HG-SKU': 45 }), config: { hedge_cobertura: 0 } })
  assert.equal(semHedge.recomendacoes.length, 1)
  const r1c = rodar([an('RC')], [of('RC', 'ATUAL', { status: 'started', meli_pct: 8, inicio: '2026-09-01', fim: '2026-10-05' }), of('RC', 'NOVA', { meli_pct: 5, inicio: '2026-09-20' })], { custos: custosDe({ 'RC-SKU': 45 }) })      // R1C: a nova continua a cobertura sem lacuna (início conhecido)
  assert.deepEqual(marcas(r1c), ['RC:NOVA:R1C'])                                   // 26 < 28,6, mas a atual vence HOJE e a nova ≥ piso
  const longe = rodar([an('RC')], [of('RC', 'ATUAL', { status: 'started', meli_pct: 8, inicio: '2026-09-01', fim: '2026-11-30' }), of('RC', 'NOVA', { meli_pct: 5 })], { custos: custosDe({ 'RC-SKU': 45 }) })
  assert.equal(longe.recomendacoes.length, 0)
})
ok('aprendizado "ignorar" (👤 IGNORAR) tira o item das recomendações', () => {
  const res = rodar([an('IG')], [of('IG', 'C1')], { custos: custosDe({ 'IG-SKU': 45 }), aprendizados: [{ ativo: true, acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'IG', resposta: 'esse ignorar', em: '2026-09-04T00:00:00Z' }] })
  assert.equal(marcas(res).length, 0); assert.match(res.avaliacoes.get('IG').motivoSemMarca.texto, /IGNORAR/)
})
ok('piso nunca fica abaixo de zero: "0%" aceita MC 0, nunca negativa', () => {
  const res = rodar([an('Z0')], [of('Z0', 'C1')], { regras: [{ mlb: '', sku: 'Z0-SKU', status: '0%' }], custos: custosDe({ 'Z0-SKU': 75 }) })
  assert.equal(marcas(res).length, 0)
})

// ═══ 6. humano manda ═════════════════════════════════════════════════════════════════════════════════
ok('marca HUMANA é intocável; recusa humana tira só a campanha recusada', () => {
  const res = rodar([an('H1'), an('H2')], [of('H1', 'C1'), of('H2', 'C1')], { custos: custosDe({ 'H1-SKU': 45, 'H2-SKU': 45 }) })
  const a = A.aplicarHumanos(res.recomendacoes, [{ item_id: 'H1', pid: 'OUTRA', origem: 'humano', marcado: true, via: 'api' }])
  assert.deepEqual(a.efetivas.map(r => r.item_id), ['H2']); assert.equal(a.ignoradas[0].porque, 'humano_marcou')
  const b = A.aplicarHumanos(res.recomendacoes, [{ item_id: 'H2', pid: 'C1', origem: 'humano', marcado: false, via: 'api' }])
  assert.deepEqual(b.efetivas.map(r => r.item_id), ['H1']); assert.equal(b.ignoradas[0].porque, 'humano_recusou')
})

// ═══ 7. vigias ═══════════════════════════════════════════════════════════════════════════════════════
ok('vigia de cobertura: protegido que vence em ≤ N dias; saída MARCAR × SUGERIR MANUAL; exceções declaradas', () => {
  const anuncios = [an('V1', { curva: 'A', fat30: 5000 }), an('V2', { curva: 'B', fat30: 3000 }), an('V3', { curva: 'C', fat30: 10, protegido: false }), an('V4', { curva: 'A', under_review: true }),
    an('V5', { curva: 'A', lido_em: '' }), an('V6', { curva: 'A', status: 'closed' }), an('V7', { curva: 'A', fat30: 100 }), an('V8', { curva: 'C', protegido: true, fat30: 50 })]
  const ofs = [of('V1', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-08' }), of('V1', 'C1', { inicio: '2026-10-01', fim: '2026-12-31' }),   // vence em 3 dias; há elegível que cobre (abre antes do fim da manual: sem lacuna)
    of('V2', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-09' }),                                              // vence em 4 dias; NENHUMA elegível
    of('V7', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-11-30' }),                                              // coberto até depois da janela
    of('V3', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-06' })]                                              // curva C não protegida: ignorado
  const res = rodar(anuncios, ofs, { custos: custosDe({ 'V1-SKU': 45, 'V2-SKU': 45 }) })
  const al = res.vigias.cobertura.alertas
  assert.deepEqual(al.map(x => x.item_id), ['V1', 'V2', 'V8'], 'ordenado por faturamento; V8 é protegido manual sem nenhuma oferta')
  assert.equal(al[0].saida, 'MARCAR'); assert.equal(al[0].marcaCobre, true, 'a marca do analista cobre'); assert.equal(al[0].cobreAteSemRebate, '2026-10-08')
  assert.equal(al[1].saida, 'SUGERIR MANUAL'); assert.ok(al[1].precoManual > 0)
  assert.equal(al[2].cobreAte, null)
  assert.deepEqual(res.vigias.cobertura.excecoes.map(e => e.item_id).sort(), ['V4', 'V5', 'V6'])
  assert.match(res.vigias.cobertura.excecoes.find(e => e.item_id === 'V5').motivo, /DESCONHECIDA/)
})
ok('vigia de rebate pior: empate de preço com rebates diferentes; sazonal e fim próximo viram ressalva; nunca "sair"', () => {
  const anuncios = [an('RP1', { fat30: 9000, unid30: 100 }), an('RP2', { curva: 'B' }), an('RP3', { curva: 'B' }), an('RP4', { curva: 'B' })]
  const camps = [{ pid: 'GRAN', nome: 'Black Friday', fim: '2026-11-30' }]
  const ofs = [of('RP1', 'IMP', { status: 'started', preco: 100, meli_pct: 2.7, nome: 'Impulsione' }), of('RP1', 'OUT', { status: 'started', preco: 100, meli_pct: 4.4, nome: 'Outra', fim: '2026-12-31' }),
    of('RP2', 'GRAN', { status: 'started', preco: 100, meli_pct: 2, nome: 'Black Friday' }), of('RP2', 'OUT', { status: 'started', preco: 100, meli_pct: 4, nome: 'Outra', fim: '2026-12-31' }),
    of('RP3', 'A', { status: 'started', preco: 100, meli_pct: 2, nome: 'A' }), of('RP3', 'B', { status: 'started', preco: 100, meli_pct: 4, nome: 'B', fim: '2026-10-08' }),
    of('RP4', 'A', { status: 'started', preco: 100, meli_pct: 2, nome: 'A' }), of('RP4', 'MELHOR', { status: 'candidate', preco: 100, meli_pct: 6, nome: 'Melhor' })]
  const out = A.vigiaRebatePior({ anuncios, ofertasPorItem: R.agruparPorItem(ofs), campanhas: new Map(camps.map(c => [c.pid, c])), hoje: HOJE })
  assert.deepEqual(out.map(o => `${o.item_id}:${o.tipo}`), ['RP1:empate', 'RP2:empate', 'RP3:empate', 'RP4:elegivel_melhor'].sort((a, b) => { const o = x => out.findIndex(y => `${y.item_id}:${y.tipo}` === x); return o(a) - o(b) }))
  const rp1 = out.find(o => o.item_id === 'RP1'); perto(rp1.ganhoVenda, 2.04); perto(rp1.ganhoMes, 204)
  assert.equal(out.find(o => o.item_id === 'RP2').sazonal, true); assert.match(out.find(o => o.item_id === 'RP2').recomendacao, /SAZONAL/)
  assert.match(out.find(o => o.item_id === 'RP3').recomendacao, /NÃO mexer/)
  for (const o of out) assert.ok(!/\bsair agora\b|saia/i.test(o.recomendacao) || /NUNCA|NÃO|não/.test(o.recomendacao))
  assert.equal(A.vigiaRebatePior({ anuncios: [an('SO')], ofertasPorItem: R.agruparPorItem([of('SO', 'X', { status: 'started', meli_pct: 3 })]), campanhas: new Map(), hoje: HOJE }).length, 0)
})

// ═══ 8. interrogatório e invariante (puros) ═══════════════════════════════════════════════════════════
ok('interrogatório: concordam × divergem, agrupado por padrão, pergunta objetiva, e aprendizado tira da fila', () => {
  const anuncios = [an('I1'), an('I2'), an('I3'), an('I4')]
  const ofs = [of('I1', 'C1'), of('I2', 'C1'), of('I3', 'C1'), of('I4', 'C1')]
  const res = rodar(anuncios, ofs, { custos: custosDe({ 'I1-SKU': 45, 'I2-SKU': 45, 'I3-SKU': 55, 'I4-SKU': 45 }) })       // I1,I2,I4 marcam; I3 abaixo do piso
  const dec = [{ item_id: 'I1', pid: 'C1', origem: 'humano', marcado: true, via: 'api' },                             // concorda
    { item_id: 'I3', pid: 'C1', origem: 'humano', marcado: true, via: 'api' },                                         // ele marcou abaixo do piso
    { item_id: 'I2', pid: 'C1', origem: 'humano', marcado: false, via: 'api' }]                                        // recusou o que eu marcaria
  const ent = { avaliacoes: res.avaliacoes, decisoes: dec, anuncios, ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] }
  const q = A.interrogar(ent)
  assert.equal(q.concordam, 1); assert.equal(q.divergem, 3)                                                            // I3 (ele), I2 (recusa), I4 (sem decisão)
  assert.deepEqual(q.grupos.map(g => g.padrao).sort(), ['abaixo_piso', 'recusa', 'sem_decisao'])
  assert.match(q.grupos.find(g => g.padrao === 'abaixo_piso').itens[0].pergunta, /MC 16,0% < piso 20,0%/)
  assert.match(q.resumoTexto, /Concordamos em 1 de 4\. Divergimos em 3, agrupados em 3 padrão/)
  const q2 = A.interrogar({ ...ent, aprendizados: [{ id: 7, ativo: true, padrao: 'abaixo_piso', escopo_tipo: 'item', escopo_valor: 'I3' }] })
  assert.equal(q2.respondidas, 1); assert.ok(!q2.grupos.some(g => g.padrao === 'abaixo_piso'), 'não re-pergunta o que já foi respondido')
  assert.equal(A.interrogar({ ...ent, decisoes: [] }).revisaoFeita, false)
  assert.equal(A.interrogar({ ...ent, decisoes: [] }).divergem, 0, 'sem revisão do dono não há divergência — há revisão pendente')
})
ok('invariante: 3 zeros com read-back em contagens; vermelho se faltar decisão/alerta/menção ou coleta velha', () => {
  const anuncios = [an('IV1'), an('IV2', { curva: 'A', fat30: 900 })]
  const ofs = [of('IV1', 'C1'), of('IV2', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-07' }), of('IV2', 'RA', { status: 'started', preco: 100, meli_pct: 2 }), of('IV2', 'RB', { status: 'started', preco: 100, meli_pct: 4 })]
  const res = rodar(anuncios, ofs, { custos: custosDe({ 'IV1-SKU': 45, 'IV2-SKU': 45 }) })
  const vazio = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: [], alertas: [] })
  assert.equal(vazio.ok, false); assert.deepEqual(vazio.itens.map(i => i.encontrado), [1, 2, 1, 1, 0, 0])      // IV2 descoberto nas DUAS janelas (7 e 14); o analista nem rodou (+ marca desatualizada e selo das entradas: nada gravado, nada a comparar)
  // contrato novo (invariante só fecha com rodada gravada SOBRE a coleta atual): marcador { rodada_id, coleta_id } + linhas/alertas daquela rodada
  const rodada = { rodada_id: 'R1', coleta_id: 'K1' }, efetivas = res.recomendacoes
  const decisoes = efetivas.map(r => ({ ...r, origem: 'analista', marcado: true, rodada_id: 'R1' }))
  const alertas = A.alertasDeVigias(res.vigias).map(a => ({ ...a, rodada_id: 'R1' }))
  const verde = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes, alertas, efetivas, coletaId: 'K1', rodada })
  assert.equal(verde.ok, true); assert.deepEqual(verde.itens.map(i => i.encontrado), [0, 0, 0, 0, 0, 0]); assert.equal(verde.readback.elegiveis_ge_piso, 1)
  assert.equal(A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes, alertas, efetivas, coletaId: 'K1', rodada, coletaFresca: false }).ok, false, 'coleta velha nunca fecha a rodada')
  const semMotivo = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: [{ item_id: 'IV1', pid: '', origem: 'analista', marcado: false, regra: 'SEM_MARCA', motivo: '', via: 'api', rodada_id: 'R1' }], alertas, efetivas: [], coletaId: 'K1', rodada })
  assert.equal(semMotivo.itens[0].encontrado, 1, '"sem marca" sem motivo declarado não conta como decisão')
})

// ═══ 9. banco (em memória): isolamento por cliente, humano × analista, config, custos, aprendizados ═════
const coletaSint = (cliente, anuncios, ofertas, campanhas = []) => {
  const id = 'T' + Math.random().toString(36).slice(2, 7)
  R.iniciarColeta(cliente, id)
  R.gravarColeta(cliente, { coletaId: id, campanhas: campanhas.map(c => ({ tipo: '', subtipo: '', nome: '', status: '', inicio: '', fim: '', prazo: '', rebate: 0, relampago: 0, origem: 'listagem', ...c })),
    anuncios: anuncios.map(a => ({ ...a, under_review: a.under_review ? 1 : 0, catalogo: 0, tarifa_json: JSON.stringify(a.tarifa), tarifa_estado: '' })), ofertasPorItem: R.agruparPorItem(ofertas), resumo: {}, limites: [] })
}
const CLI = 'Cliente Teste', OUTRO = 'Outro Cliente'
R.db.exec(`CREATE TABLE meli_serie_item (cliente TEXT, item_id TEXT, dia TEXT, unidades INTEGER DEFAULT 0, receita REAL DEFAULT 0, visitas INTEGER DEFAULT 0);
  CREATE TABLE meli_coleta_dia (cliente TEXT, dia TEXT, pedidos INTEGER, truncado INTEGER, coletado_em TEXT)`)
await okA('banco: nada mistura clientes', async () => {
  coletaSint(CLI, [an('DB1')], [of('DB1', 'P1')])
  coletaSint(OUTRO, [an('DB2'), an('DB3')], [of('DB2', 'P1'), of('DB3', 'P1')])
  assert.deepEqual(R.lerAnuncios(CLI).map(a => a.item_id), ['DB1']); assert.equal(R.lerAnuncios(OUTRO).length, 2)
  assert.equal(R.lerOfertas(CLI).length, 1); assert.equal(R.lerOfertas(OUTRO).length, 2)
  R.salvarRegraSku(CLI, { sku: 'X1', status: 'Livre' }, 'teste'); assert.equal(R.listarRegrasSku(OUTRO).length, 0)
  R.importarCustosSku(CLI, [{ sku: 'X1', custo: 5 }], 'teste'); assert.equal(R.listarCustosSku(OUTRO).length, 0)
  R.setConfig(CLI, { piso_mc: 25 }); assert.equal(R.getConfig(OUTRO).piso_mc, 20)
  assert.equal(R.getConfig('qualquer').execucao_habilitada, 0, 'execução SEMPRE nasce desligada')
})
await okA('banco: config e regras validam entrada', async () => {
  assert.throws(() => R.setConfig(CLI, { piso_mc: 'abc' }), /inválido/); assert.throws(() => R.setConfig(CLI, { piso_mc: 150 }), /inválido/)
  assert.throws(() => R.setConfig(CLI, { dias_vigia: 1.5 }), /inteiro/); assert.throws(() => R.setConfig(CLI, { hack: 1 }), /desconhecido/)
  assert.throws(() => R.salvarRegraSku(CLI, { sku: 'A', status: 'talvez' }), /status inválido/); assert.throws(() => R.salvarRegraSku(CLI, { status: 'Livre' }), /MLB ou SKU/)
  assert.throws(() => R.salvarRegraSku(CLI, { mlb: 'abc', status: 'Livre' }), /MLB inválido/)
  assert.throws(() => R.registrarAprendizado(CLI, { resposta: '' }), /resposta/); assert.throws(() => R.registrarAprendizado(CLI, { resposta: 'x', acao: 'ignorar' }), /escopo/)
  R.setConfig(CLI, { piso_mc: 20, imposto_pct: 10 })
})
await okA('aprendizado "regra_sku" vira regra por SKU configurável + auditoria', async () => {
  const id = R.registrarAprendizado(CLI, { padrao: 'sem_custo', escopo_tipo: 'sku', escopo_valor: 'FORA-1', resposta: 'Fora de linha, pode marcar como livre', acao: 'regra_sku', parametro: 'Livre' }, 'dono')
  assert.ok(id > 0); assert.ok(R.listarRegrasSku(CLI).some(r => r.sku === 'FORA-1' && r.status === 'Livre'))
  assert.ok(R.listarAuditoria(CLI, { evento: 'aprendizado' }).length >= 1)
  R.desativarAprendizado(CLI, id, 'dono'); assert.equal(R.listarAprendizados(CLI, { soAtivos: true }).length, 0)
})
await okA('analista end-to-end (banco): dry-run, aplicar, read-back, humano intocável, adulteração detectada', async () => {
  const C2 = 'Cliente E2E'
  coletaSint(C2, [an('E1'), an('E2'), an('E3', { curva: 'A', fat30: 900 }), an('E4')], [of('E1', 'C1', { inicio: '2026-10-01' }), of('E2', 'C1'), of('E3', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-08' }), of('E3', 'C9', { inicio: '2026-10-01', fim: '2026-12-31' }), of('E4', 'C1'), of('E4', 'MINHA', { meli_pct: 4 })])      // candidatas que cobrem têm início conhecido (sem lacuna); MINHA = a campanha que o dono marca (viva: marca 👤 só trava enquanto a campanha é candidata/ativa)
  R.importarCustosSku(C2, [{ sku: 'E1-SKU', custo: 45 }, { sku: 'E2-SKU', custo: 55 }, { sku: 'E3-SKU', custo: 45 }, { sku: 'E4-SKU', custo: 45 }], 'teste')
  R.setConfig(C2, { imposto_pct: 10 })
  for (const [item, rec] of [['E1', 5000], ['E3', 4000], ['E2', 100], ['E4', 50]]) R.db.prepare("INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)").run(C2, item, '2026-10-03', 1, rec)
  R.db.prepare("INSERT INTO meli_coleta_dia VALUES (?,?,?,?,?)").run(C2, '2026-10-04', 1, 0, 'x')
  const deps = { hoje: HOJE, custosCliente: null }
  const antes = await A.lerInvariante(C2, deps)
  assert.equal(antes.ok, false, 'sem o analista rodar, o read-back é vermelho')
  const seco = await A.rodarAnalista(C2, { aplicar: false, deps })
  assert.equal(seco.aplicado, false); assert.equal(R.lerDecisoes(C2).length, 0, 'dry-run não grava decisão'); assert.equal(seco.invariante.readback_gravado, false)
  assert.deepEqual(seco.recomendacoes.map(r => r.item_id).sort(), ['E1', 'E3', 'E4'])
  const ap = await A.rodarAnalista(C2, { aplicar: true, por: 'analista-teste', deps })
  assert.equal(ap.aplicado, true); assert.equal(ap.invariante.readback_gravado, true); assert.equal(ap.invariante.ok, true, JSON.stringify(ap.invariante.itens))
  const linhas = R.lerDecisoes(C2)
  assert.ok(linhas.some(d => d.item_id === 'E2' && !d.marcado && d.regra === 'SEM_MARCA' && /abaixo do piso/.test(d.motivo)), 'quem não marca tem motivo gravado')
  const alC = R.lerAlertas(C2, 'cobertura')
  assert.deepEqual([...new Set(alC.map(a => a.item_id))].sort(), ['E1', 'E3'], 'E1 (curva A, sem nenhuma promoção) e E3 (curva A, vence em 3 dias)')
  assert.deepEqual(alC.map(a => a.chave).sort(), ['E1|14d', 'E1|7d', 'E3|14d', 'E3|7d'], 'as duas janelas (7 e 14) são gravadas, com a janela na chave')
  assert.ok(alC.every(a => a.detalhe.curva === 'A' && a.detalhe.saida === 'MARCAR' && a.detalhe.marcaCobre === true))
  // aprovação do dono é preservada ao recalcular
  assert.equal(R.aprovarAnalista(C2, [{ item_id: 'E1', pid: 'C1' }], 'dono'), 1)
  await A.rodarAnalista(C2, { aplicar: true, deps })
  assert.equal(R.lerDecisoes(C2).find(d => d.item_id === 'E1' && d.origem === 'analista' && d.marcado).aprovado, true)
  // humano marca E4 em OUTRA campanha: o analista não toca mais em E4
  R.marcarHumano(C2, { item_id: 'E4', pid: 'MINHA', marcado: true, preco: 90, offer_id: 'o' }, 'dono')
  const r3 = await A.rodarAnalista(C2, { aplicar: true, deps })
  assert.ok(!R.lerDecisoes(C2).some(d => d.item_id === 'E4' && d.origem === 'analista' && d.marcado), 'bloco humano é intocável')
  assert.ok(R.lerDecisoes(C2).some(d => d.item_id === 'E4' && d.origem === 'humano' && d.marcado), 'e a marca humana segue lá')
  assert.ok(r3.ignoradas_por_humano.some(i => i.item_id === 'E4'))
  assert.ok(r3.interrogatorio.grupos.length >= 1, 'o interrogatório enxerga a divergência')
  // recusa humana não é re-sugerida
  R.marcarHumano(C2, { item_id: 'E1', pid: 'C1', marcado: false }, 'dono')
  await A.rodarAnalista(C2, { aplicar: true, deps })
  assert.ok(!R.lerDecisoes(C2).some(d => d.item_id === 'E1' && d.origem === 'analista' && d.marcado))
  assert.equal((await A.lerInvariante(C2, deps)).ok, true)
  // adulteração: apagar as linhas do analista => o read-back pega
  R.db.prepare("DELETE FROM promo_decisao WHERE cliente = ? AND origem = 'analista'").run(C2)
  assert.equal((await A.lerInvariante(C2, deps)).ok, false)
  // coleta velha nunca é analisada em modo aplicar
  R.db.prepare("UPDATE promo_coleta SET concluida_em = '2026-01-01T00:00:00Z' WHERE cliente = ?").run(C2)
  await assert.rejects(A.rodarAnalista(C2, { aplicar: true, deps }), /foto velha/)
  assert.equal((await A.rodarAnalista(C2, { aplicar: false, deps })).coleta.fresca, false)
  await assert.rejects(A.rodarAnalista('Cliente sem coleta', { aplicar: false, deps }), /nenhuma coleta/)
  // curva ABC veio da série de pedidos pagos (R$ 5.000 / 4.000 / 100 / 50)
  const ent = await A.carregarEntrada(C2, deps)
  assert.equal(ent.anuncios.find(a => a.item_id === 'E1').curva, 'A'); assert.equal(ent.anuncios.find(a => a.item_id === 'E4').curva, 'C'); assert.equal(ent.vendas.ate, '2026-10-04')
})

// ═══ 10. coleta (stub de GET) ═══════════════════════════════════════════════════════════════════════
const chamadas = []
const fakeChamar = (variante = {}) => async (cliente, caminho, opts = {}) => {
  assert.ok(opts.permitirFalha, 'a coleta sempre pede permitirFalha (nunca derruba por 1 anúncio)')
  assert.ok(!/method|POST|DELETE/i.test(caminho)); chamadas.push(caminho)
  const erro = (status, corpo = '') => ({ _erro: true, status, corpo })
  if (/^\/seller-promotions\/users\/123/.test(caminho)) {
    assert.match(caminho, /app_version=v2/)
    if (variante.listagem403) return erro(403, 'forbidden')
    return { results: [{ id: 'P-1', type: 'SMART', status: 'started', name: 'Impulsione', start_date: '2026-10-01T03:00:00Z', finish_date: '2026-12-01T03:00:00Z' }, { id: 'P-2', type: 'DEAL', status: 'started', name: '10.10', finish_date: '2026-10-13T03:00:00Z' }, { id: 'LGH-MLB1000', type: 'LIGHTNING', status: 'started' }, ...(variante.relampago ? [{ id: 'P-REL', type: 'SMART', status: 'started', name: 'OFERTAS RELÂMPAGOS IMPERDÍVEIS' }] : [])], paging: { total: 3, limit: 50, offset: 0 } }
  }
  let m
  if ((m = caminho.match(/^\/seller-promotions\/promotions\/([^/]+)\/items\?(.*)$/))) {
    const q = new URLSearchParams(m[2]); assert.equal(q.get('app_version'), 'v2'); assert.ok(Number(q.get('limit')) <= 50, 'limit máximo é 50 na API'); assert.ok(q.get('promotion_type'))
    if (m[1] === 'P-1' && !q.get('search_after')) return { results: [{ id: 'MLB1', status: 'candidate' }], paging: { total: 2, searchAfter: 'ABC' } }
    if (m[1] === 'P-1') { assert.equal(q.get('search_after'), 'ABC'); return { results: [{ id: 'MLB2', status: 'candidate' }], paging: { total: 2 } } }
    return { results: [{ id: 'MLB1' }], paging: { total: 1 } }
  }
  if (/^\/items\/bulk\?ids=/.test(caminho)) {                // formato real do /items/bulk: { id, status_code, body }
    const ids = caminho.match(/ids=([^&]+)/)[1].split(',')
    return ids.map(id => ({ id, status_code: 200, body: { id, title: `Item ${id}`, price: 90, original_price: 120, status: id === 'MLB3' ? 'under_review' : 'active', sub_status: id === 'MLB3' ? ['waiting_for_patch'] : [], category_id: 'MLB1', listing_type_id: 'gold_special', available_quantity: 5,
      attributes: id === 'MLB1' ? [{ id: 'SELLER_SKU', value_name: 'SKU-UM' }] : [], seller_custom_field: id === 'MLB2' ? '' : null, variations: id === 'MLB4' ? [{ attributes: [{ id: 'SELLER_SKU', value_name: 'SKU-VAR' }] }] : [], user_product_id: '' } }))
  }
  if ((m = caminho.match(/^\/seller-promotions\/items\/(MLB\d+)\?app_version=v2$/))) {
    if (m[1] === 'MLB3') return erro(400, '{"message":"Item status is not allowed (under_review)"}')
    if (m[1] === 'MLB4' && variante.mlb4falha) return erro(500, 'boom')
    const base = [{ id: 'P-1', type: 'SMART', ref_id: `CANDIDATE-${m[1]}`, status: 'candidate', price: 90, original_price: 120, meli_percentage: 5, seller_percentage: 0 },
      { id: 'P-2', type: 'DEAL', status: 'candidate', price: 0, original_price: 120, min_discounted_price: 24, max_discounted_price: 100, start_date: '2026-09-28T00:00:00-03:00', finish_date: '2026-10-13T00:00:00-03:00' },
      { type: 'PRICE_DISCOUNT', status: 'candidate', price: 0, original_price: 120, name: '' }]
    if (m[1] === 'MLB1' && !variante.semHidden) base.push({ id: 'P-HIDDEN', type: 'SMART', name: 'Wearables Geral Out', status: 'started', price: 95, original_price: 120, meli_percentage: 4, finish_date: '2026-10-30T03:00:00Z' })
    if (m[1] === 'MLB2' && variante.relampago) base.push({ id: 'P-REL', type: 'SMART', ref_id: 'CANDIDATE-REL', status: 'candidate', price: 80, original_price: 120, meli_percentage: 7 })     // sem NOME no item
    if (m[1] === 'MLB2') base.push({ id: 'P-9', type: 'UNHEALTHY_STOCK', status: 'started', price: 100, original_price: 120, meli_percentage: 2, finish_date: '2026-11-01T03:00:00Z' })
    return base
  }
  return erro(404, 'rota não prevista no stub')
}
await okA('coleta: campanhas, search_after, oferta por anúncio, under_review, campanha oculta, rebate por meli%, SKU em camadas', async () => {
  const C3 = 'Cliente Coleta'
  const prog = []
  const r = await C.coletarPromocoes(C3, { aoProgredir: p => prog.push(p.fase), deps: { chamar: fakeChamar(), uid: 123, espera: 0, itensExtras: ['MLB3', 'MLB4'] } })
  assert.equal(r.campanhas, 5, '3 da listagem + 2 que só apareceram na oferta do anúncio (a listagem as escondia)'); assert.equal(r.campanhas_ocultas_na_listagem, 2)
  assert.ok(r.limites.some(l => l.codigo === 'TIPO_NOVO_COM_REBATE' && /UNHEALTHY_STOCK/.test(l.texto)), 'tipo fora da lista com meli% > 0 é sinalizado, não escondido')
  assert.ok(r.limites.some(l => l.codigo === 'LISTAGEM_ESCONDE_CAMPANHAS' && l.estado === 'NOT_AVAILABLE'), 'a limitação é declarada em TODA coleta')
  const camps = new Map(R.lerCampanhas(C3).map(c => [c.pid, c]))
  assert.equal(camps.get('P-HIDDEN').origem, 'item'); assert.equal(camps.get('P-HIDDEN').rebate, true); assert.equal(camps.get('P-1').rebate, true)
  assert.equal(camps.get('P-2').rebate, false, 'DEAL fica fora do rebate'); assert.equal(camps.get('LGH-MLB1000').rebate, false)
  assert.equal(camps.get('P-HIDDEN').relampago, false); assert.equal(camps.get('P-9').rebate, true)
  const of1 = R.lerOfertas(C3).filter(o => o.item_id === 'MLB1')
  assert.equal(of1.find(o => o.pid === 'P-2').preco, null, 'price 0 do DEAL nunca vira preço'); assert.equal(of1.find(o => o.pid === 'P-1').offer_id, 'CANDIDATE-MLB1'); assert.ok(of1.some(o => o.pid === 'PRICE_DISCOUNT'))
  assert.equal(R.lerOfertas(C3).find(o => o.pid === 'P-9').meli_pct, 2)
  const anun = new Map(R.lerAnuncios(C3).map(a => [a.item_id, a]))
  assert.equal(anun.get('MLB1').sku, 'SKU-UM'); assert.equal(anun.get('MLB1').sku_fonte, 'attributes.SELLER_SKU'); assert.equal(anun.get('MLB4').sku, 'SKU-VAR'); assert.equal(anun.get('MLB2').sku, '')
  assert.equal(anun.get('MLB3').under_review, true); assert.equal(anun.get('MLB3').sub_status, 'waiting_for_patch'); assert.equal(r.under_review, 1)
  assert.ok(R.lerOfertas(C3).every(o => o.item_id !== 'MLB3'), 'under_review não tem oferta')
  assert.ok(chamadas.some(c => /search_after=ABC/.test(c)), 'paginou por search_after'); assert.ok(prog.includes('ofertas por anúncio'))
  assert.equal(R.lerColeta(C3).estado, 'concluida'); assert.equal(R.coletaFresca(C3).fresca, true)
  assert.ok(R.listarAuditoria(C3, { evento: 'coleta' }).length === 1)
  // segunda coleta: a participação do MLB1 em P-HIDDEN (fim futuro) some => DERRUBADA antes do prazo
  const r2 = await C.coletarPromocoes(C3, { deps: { chamar: fakeChamar({ semHidden: true }), uid: 123, espera: 0, itensExtras: ['MLB3', 'MLB4'] } })
  assert.equal(r2.derrubadas.derrubadas, 1); assert.equal(r2.derrubadas_detalhe.derrubadas[0].pid, 'P-HIDDEN')
  // UI #8: a lista item a item fica NO resumo gravado da coleta (é o que /participando devolve e a tela lista); só a contagem não bastava
  const gravada = R.lerColeta(C3).resumo.derrubadas
  assert.equal(gravada.derrubadas, 1); assert.deepEqual(gravada.lista.map(x => `${x.item_id}|${x.pid}`), ['MLB1|P-HIDDEN']); assert.match(gravada.lista[0].fim, /^\d{4}-\d{2}-\d{2}/)
  // falha de UM anúncio não derruba a coleta; ele mantém a leitura anterior e vira "sem leitura"
  const r3 = await C.coletarPromocoes(C3, { deps: { chamar: fakeChamar({ mlb4falha: true }), uid: 123, espera: 0, itensExtras: ['MLB4'] } })
  assert.equal(r3.anuncios_sem_leitura, 1); assert.ok(r3.limites.some(l => l.codigo === 'OFERTAS_SEM_LEITURA'))
  assert.match(R.lerAnuncios(C3).find(a => a.item_id === 'MLB4').oferta_erro, /ML_INDISPONIVEL/)
})
await okA('coleta: o NOME da campanha é herdado pela oferta (relâmpago é detectado pelo nome)', async () => {
  const C6 = 'Cliente Relampago'
  await C.coletarPromocoes(C6, { deps: { chamar: fakeChamar({ relampago: true }), uid: 123, espera: 0 } })
  assert.equal(R.lerCampanhas(C6).find(c => c.pid === 'P-REL').relampago, true)
  const o = R.lerOfertas(C6).find(x => x.pid === 'P-REL' && x.item_id === 'MLB2')
  assert.equal(o.nome, 'OFERTAS RELÂMPAGOS IMPERDÍVEIS'); assert.equal(M.ehRelampagoSmart(o), true)
})
await okA('coleta: 403 na listagem = NOT_AUTHORIZED declarado (nada é inventado) e a coleta marca erro', async () => {
  await assert.rejects(C.coletarPromocoes('Cliente 403', { deps: { chamar: fakeChamar({ listagem403: true }), uid: 123, espera: 0 } }), /NOT_AUTHORIZED/)
  assert.equal(R.lerColeta('Cliente 403').estado, 'erro'); assert.equal(R.lerCampanhas('Cliente 403').length, 0)
  await assert.rejects(C.coletarPromocoes('Sem conta', { deps: { chamar: fakeChamar(), uid: null, espera: 0 } }), /não conectada/)
})
ok('coleta: classificação de erros e resolverSku', () => {
  assert.equal(C.estadoDoErro({ status: 403 }), 'NOT_AUTHORIZED'); assert.equal(C.estadoDoErro({ status: 404 }), 'NOT_AVAILABLE'); assert.equal(C.estadoDoErro({ status: 400 }), 'NOT_AVAILABLE'); assert.equal(C.estadoDoErro({ status: 502 }), 'ML_INDISPONIVEL')
  assert.equal(C.ehUnderReview({ _erro: true, status: 400, corpo: 'Item status is not allowed (under_review)' }), true); assert.equal(C.ehUnderReview({ _erro: true, status: 400, corpo: 'outro' }), false)
  assert.equal(C.resolverSku({ attributes: [{ id: 'SELLER_SKU', value_name: 'A' }], seller_custom_field: 'B' }).sku, 'A')
  assert.equal(C.resolverSku({ attributes: [], seller_custom_field: '' , variations: [] }, { attributes: [{ id: 'SELLER_SKU', values: [{ name: 'UP' }] }] }).sku, 'UP')
  assert.equal(C.resolverSku({ seller_custom_field: '   ' }).sku, '', 'string vazia NÃO vence a cascata (|| e não ??)')
  const o = C.normalizarOferta({ id: 'P', type: 'SMART', ref_id: 'R', price: 10, meli_percent: 3, seller_percent: 1, end_date: '2026-10-10' }); assert.equal(o.meli_pct, 3); assert.equal(o.fim, '2026-10-10'); assert.equal(o.offer_id, 'R')
})
ok('comparar rodadas: derrubada × vencida no prazo × saiu da coleta', () => {
  const ant = { participacoes: [{ item_id: 'A', pid: 'P', status: 'started', fim: '2026-10-30' }, { item_id: 'B', pid: 'P', status: 'started', fim: '2026-10-01' }, { item_id: 'C', pid: 'P', status: 'pending', fim: '2026-11-01' }, { item_id: 'D', pid: 'P', status: 'candidate', fim: '2026-11-01' }, { item_id: 'E', pid: 'P', status: 'started', fim: '' }, { item_id: 'F', pid: 'P', status: 'started', fim: '2026-11-01' }] }
  const atu = { participacoes: [{ item_id: 'F', pid: 'P', status: 'started', fim: '2026-11-01' }], itens: ['A', 'B', 'D', 'E', 'F'] }
  const c = M.compararRodadas(ant, atu, HOJE)
  assert.deepEqual(c.derrubadas.map(x => x.item_id), ['A']); assert.deepEqual(c.vencidas.map(x => x.item_id), ['B']); assert.deepEqual(c.saiuDaColeta, ['C']); assert.deepEqual(c.semPrazo.map(x => x.item_id), ['E'])
})

// ═══ 11. plano (dry-run) ═══════════════════════════════════════════════════════════════════════════
const dec = (item_id, pid, o = {}) => ({ item_id, pid, origem: 'humano', marcado: true, regra: 'HUMANO', via: 'api', preco: 100, mc_pct: 26, ordem_direta: false, ...o })
const viva = ofertas => ({ ok: true, ofertas })
const planejar = (decisoes, vivas, extra = {}) => P.montarPlano({ cliente: 'PL', decisoes, vivasPorItem: new Map(Object.entries(vivas)), anuncios: new Map((extra.anuncios || [an('MLB9001'), an('MLB9002'), an('MLB9003'), an('MLB9004'), an('MLB9005'), an('MLB9006')]).map(a => [a.item_id, a])),
  regrasSku: extra.regras || [], custosSku: extra.custos || custosDe({ 'MLB9001-SKU': 45, 'MLB9002-SKU': 45, 'MLB9003-SKU': 45, 'MLB9004-SKU': 45, 'MLB9005-SKU': 45, 'MLB9006-SKU': 45 }), custosCliente: null, config: CFG, agora: new Date('2026-10-05T12:00:00Z') })
ok('plano dry-run: chamada exata (offer_id VIVO), expira em 24h, sem saída de campanha', () => {
  const p = planejar([dec('MLB9001', 'P1')], { MLB9001: viva([of('MLB9001', 'P1', { offer_id: 'CANDIDATE-VIVO-NOVO' })]) })
  assert.equal(p.resumo.entrar, 1); const e = p.itens[0]
  assert.deepEqual(e.chamada, { metodo: 'POST', caminho: '/seller-promotions/items/MLB9001?app_version=v2', corpo: { promotion_id: 'P1', promotion_type: 'SMART', offer_id: 'CANDIDATE-VIVO-NOVO' } })
  assert.equal(Date.parse(p.expira_em) - Date.parse(p.criado_em), 24 * 3600e3); assert.ok(p.id.startsWith('PL-'))
  assert.ok(p.itens.every(i => !i.chamada || i.chamada.metodo === 'POST')); P.assertSemSaida(p.itens)
  assert.throws(() => P.assertSemSaida([{ chamada: { metodo: 'DELETE', caminho: '/seller-promotions/items/MLB1?app_version=v2', corpo: {} } }]), /nunca sai de campanha/)
  assert.throws(() => P.assertSemSaida([{ chamada: { metodo: 'POST', caminho: '/seller-promotions/items/MLB1/sair', corpo: { promotion_id: 'x', offer_id: 'y' } } }]), /nunca sai/)
  assert.notEqual(P.hashPlano(p.itens), P.hashPlano([{ ...e, chamada: { ...e.chamada, corpo: { ...e.chamada.corpo, offer_id: 'OUTRO' } } }]))
})
ok('plano: ignora started/pending e não-candidato; pula relâmpago SMART, LIGHTNING e fora do rebate', () => {
  const p = planejar([dec('MLB9001', 'P1'), dec('MLB9002', 'P1'), dec('MLB9003', 'P1'), dec('MLB9004', 'RL'), dec('MLB9005', 'LGH-1'), dec('MLB9006', 'DEAL')], {
    MLB9001: viva([of('MLB9001', 'P1', { status: 'started' })]), MLB9002: viva([of('MLB9002', 'P1', { status: 'pending' })]), MLB9003: viva([]),
    MLB9004: viva([of('MLB9004', 'RL', { nome: 'OFERTAS RELÂMPAGOS IMPERDÍVEIS' })]), MLB9005: viva([of('MLB9005', 'LGH-1', { tipo: 'LIGHTNING', meli_pct: null })]), MLB9006: viva([of('MLB9006', 'DEAL', { tipo: 'DEAL', meli_pct: 0 })]) })
  const por = Object.fromEntries(p.itens.map(i => [i.item_id, `${i.acao}:${i.motivo}`]))
  assert.deepEqual(por, { MLB9001: 'IGNORAR:ja_participa', MLB9002: 'IGNORAR:ja_participa', MLB9003: 'IGNORAR:sem_candidato_vivo', MLB9004: 'PULAR:relampago_smart_painel', MLB9005: 'PULAR:lightning_fora_do_escopo', MLB9006: 'PULAR:fora_do_rebate' })
  assert.equal(p.resumo.entrar, 0); assert.equal(p.itens.filter(i => i.chamada).length, 0)
  assert.equal(P.planoExpirado({ expira_em: '2026-10-06T12:00:00Z' }, Date.parse('2026-10-06T12:00:01Z')), true)
})
ok('plano: pre-check por MARGEM (vivo abaixo do aprovado não entra; acima entra) e leitura falha/under_review', () => {
  const abaixo = planejar([dec('MLB9001', 'P1')], { MLB9001: viva([of('MLB9001', 'P1', { preco: 92 })]) })               // aprovado MC 26% a R$ 100; vivo R$ 92 → MC menor
  assert.equal(abaixo.itens[0].acao, 'PULAR'); assert.equal(abaixo.itens[0].motivo, 'precheck_margem'); assert.match(abaixo.itens[0].detalhe, /MC viva .* < aprovada 26,0%/)
  const acima = planejar([dec('MLB9001', 'P1')], { MLB9001: viva([of('MLB9001', 'P1', { preco: 110 })]) })
  assert.equal(acima.itens[0].acao, 'ENTRAR'); assert.match(acima.itens[0].detalhe, /≥ aprovada/)
  assert.equal(P.precheckMargem({ preco: 100, mcPct: null }, { preco: 99, mcPct: null }).entra, false); assert.equal(P.precheckMargem({ preco: 100 }, { preco: 100.004 }).entra, true)
  assert.equal(P.precheckMargem({}, { preco: 1 }).entra, false, 'sem base de comparação não entra')
  assert.equal(planejar([dec('MLB9001', 'P1')], { MLB9001: { ok: false, underReview: true } }).itens[0].motivo, 'under_review')
  assert.equal(planejar([dec('MLB9001', 'P1')], { MLB9001: { ok: false, erro: 'ML_INDISPONIVEL (503)' } }).itens[0].motivo, 'leitura_falhou')
})
ok('plano: MC negativa só com ordem direta ou SKU "Livre"', () => {
  const ofs = { MLB9001: viva([of('MLB9001', 'P1', { preco: 100 })]) }
  const neg = { custos: custosDe({ 'MLB9001-SKU': 90 }) }                                                         // MC viva = −19
  const sem = planejar([dec('MLB9001', 'P1', { mc_pct: -19 })], ofs, neg); assert.equal(sem.itens[0].motivo, 'mc_negativa')
  const direta = planejar([dec('MLB9001', 'P1', { mc_pct: -19, ordem_direta: true })], ofs, neg); assert.equal(direta.itens[0].acao, 'ENTRAR'); assert.match(direta.itens[0].detalhe, /ordem direta/)
  const livre = planejar([dec('MLB9001', 'P1', { mc_pct: -19 })], ofs, { ...neg, regras: [{ mlb: '', sku: 'MLB9001-SKU', status: 'Livre' }] }); assert.equal(livre.itens[0].acao, 'ENTRAR'); assert.match(livre.itens[0].detalhe, /Livre/)
})
ok('plano: hedge entra em TODAS as campanhas equivalentes (mesmo preço e meli%)', () => {
  const p = planejar([dec('MLB9001', 'P1')], { MLB9001: viva([of('MLB9001', 'P1'), of('MLB9001', 'P2'), of('MLB9001', 'P3', { preco: 101 }), of('MLB9001', 'P4', { meli_pct: 6 }), of('MLB9001', 'P5', { status: 'started' })]) })
  assert.deepEqual(p.itens.filter(i => i.acao === 'ENTRAR').map(i => `${i.pid}${i.hedge ? '*' : ''}`), ['P1', 'P2*']); assert.equal(p.resumo.hedge, 1)
})

// ═══ 12. executor: TRAVADO por duas chaves — NENHUMA chamada nos caminhos bloqueados ═══════════════════
const apiBomba = () => { const a = async (metodo, caminho) => { a.chamadas++; assert.fail(`o executor chamou a API (${metodo} ${caminho}) com as travas fechadas`) }; a.chamadas = 0; return a }
const planoSalvo = (cliente, { estado = 'aprovado', itens = null, expira = null, ids = ['MLB1'] } = {}) => {
  const base = P.montarPlano({ cliente, decisoes: ids.map(i => dec(i, 'P1')), vivasPorItem: new Map(ids.map(i => [i, viva([of(i, 'P1')])])), anuncios: new Map(ids.map(i => [i, an(i)])), custosSku: new Map(ids.map(i => [`${i}-sku`.toLowerCase(), 45])), config: CFG })     // chave minúscula (como o plano consulta): antes o custo não era achado e o plano só entrava pelo ramo de PREÇO (fail-open, rev2/5)
  const p = { ...base, itens: itens || base.itens, gerado_por: 't' }
  R.salvarPlano(p)
  if (estado !== 'dry-run') R.atualizarPlano(cliente, p.id, { estado, aprovado_por: 'dono', aprovado_em: new Date().toISOString() })
  if (expira) R.db.prepare('UPDATE promo_plano SET expira_em = ? WHERE id = ?').run(expira, p.id)
  return p
}
await okA('executor: sem as duas chaves nada é chamado (stub falha o teste se for invocado)', async () => {
  const api = apiBomba(), deps = { api, espera: 0, esperaReadback: 0, custosCliente: null }
  const tent = async (cliente, planoId, confirmar, re) => { await assert.rejects(X.executarPlano(cliente, planoId, { confirmar, por: 'dono', deps }), re) }
  const c1 = 'Exec 1', p1 = planoSalvo(c1)
  await tent(c1, p1.id, true, /DESLIGADA.*chave 1/)                                         // configuração padrão: desligada
  R.setConfig(c1, { execucao_habilitada: 1 })
  await tent(c1, p1.id, false, /confirmar === true.*chave 2/)
  await tent(c1, p1.id, 'true', /chave 2/); await tent(c1, p1.id, 1, /chave 2/); await tent(c1, p1.id, undefined, /chave 2/)
  const c2 = 'Exec 2'; R.setConfig(c2, { execucao_habilitada: 1 })
  const p2 = planoSalvo(c2, { estado: 'dry-run' }); await tent(c2, p2.id, true, /só plano APROVADO/)
  const p3 = planoSalvo(c2, { expira: '2026-01-01T00:00:00Z' }); await tent(c2, p3.id, true, /expirado/)
  const base = planoSalvo(c2); R.db.prepare('UPDATE promo_plano SET itens_json = ? WHERE id = ?').run(JSON.stringify(base.itens.map(i => ({ ...i, chamada: { ...i.chamada, corpo: { ...i.chamada.corpo, offer_id: 'ADULTERADO' } } }))), base.id)
  await tent(c2, base.id, true, /hash não confere/)
  const dois = planoSalvo(c2, { ids: ['MLB1', 'MLB2'] }); await tent(c2, dois.id, true, /limite por execução é 1/)
  await tent(c2, 'PL-inexistente', true, /plano inexistente/)
  await tent('Exec 3', p1.id, true, /DESLIGADA|outro cliente|inexistente/)                  // plano de OUTRO cliente nunca executa
  assert.equal(api.chamadas, 0, 'ZERO chamadas externas'); assert.ok(R.listarAuditoria(c1, { evento: 'execucao_bloqueada' }).length >= 4, 'toda tentativa bloqueada fica na auditoria')
  assert.equal(R.lerPlano(c2, base.id).estado, 'aprovado', 'plano bloqueado não muda de estado')
})
ok('executor: travas puras — só abrem com TUDO em ordem (e mesmo assim este teste não executa)', () => {
  const agora = Date.parse('2026-10-05T13:00:00Z')
  const plano = P.montarPlano({ cliente: 'T', decisoes: [dec('MLB9001', 'P1')], vivasPorItem: new Map([['MLB9001', viva([of('MLB9001', 'P1')])]]), anuncios: new Map([['MLB9001', an('MLB9001')]]), custosSku: custosDe({ 'MLB9001-SKU': 45 }), config: CFG, agora: new Date('2026-10-05T12:00:00Z') })
  const p = { ...plano, estado: 'aprovado' }
  const aberta = { cliente: 'T', config: { execucao_habilitada: 1, execucao_max_itens: 1 }, confirmar: true, plano: p, agoraMs: agora }
  assert.equal(X.verificarTravas(aberta).liberado, true)
  for (const [nome, mud] of Object.entries({ habilitada0: { config: { execucao_habilitada: 0, execucao_max_itens: 1 } }, habilitadaTexto: { config: { execucao_habilitada: '1' } }, semConfirmar: { confirmar: false }, confirmarTexto: { confirmar: 'true' }, dryRun: { plano: { ...p, estado: 'dry-run' } },
    expirado: { agoraMs: agora + 25 * 3600e3 }, outroCliente: { cliente: 'OUTRO' }, semPlano: { plano: null } }))
    assert.equal(X.verificarTravas({ ...aberta, ...mud }).liberado, false, nome)
  assert.equal(X.verificarTravas({ ...aberta, config: { execucao_habilitada: 1 } }).liberado, true, 'limite padrão é 1 anúncio')
})
ok('executor: 2xx ≠ entrou; 409/5xx/400 podem ter gravado; prova só pela campanha pedida', () => {
  assert.equal(X.classificarResposta(201), 'enviado'); assert.equal(X.classificarResposta(409), 'incerto'); assert.equal(X.classificarResposta(504), 'incerto'); assert.equal(X.classificarResposta(0), 'incerto'); assert.equal(X.classificarResposta(400), 'incerto'); assert.equal(X.classificarResposta(403), 'recusado')
  assert.equal(X.avaliarProva([of('X', 'P1', { status: 'candidate' })], 'P1').provado, false); assert.equal(X.avaliarProva([of('X', 'P1', { status: 'pending' })], 'P1').provado, true); assert.equal(X.avaliarProva([of('X', 'OUTRA', { status: 'started' })], 'P1').provado, false)
})
ok('executor: prova rápida por /prices (promoção NOVA no preço esperado) — preço antigo ou standard não provam nada', () => {
  const antes = [{ amount: 100, type: 'standard', fim: null }]
  assert.equal(X.avaliarProvaPrecos(antes, [{ amount: 100, type: 'standard', fim: null }], 90).provado, false)
  assert.equal(X.avaliarProvaPrecos(antes, [{ amount: 100, type: 'standard', fim: null }, { amount: 90, type: 'promotion', fim: '2026-10-13T03:00:00Z' }], 90).provado, true)
  assert.equal(X.avaliarProvaPrecos([{ amount: 90, type: 'promotion', fim: 'x' }], [{ amount: 90, type: 'promotion', fim: 'x' }], 90).provado, false, 'a promoção que já existia antes não conta')
  assert.equal(X.avaliarProvaPrecos(antes, [{ amount: 80, type: 'promotion', fim: 'y' }], 90).provado, false, 'preço diferente do esperado não prova')
  assert.equal(X.avaliarProvaPrecos(antes, [], 90).provado, false); assert.equal(X.avaliarProvaPrecos(antes, [{ amount: 90, type: 'promotion', fim: 'y' }], null).provado, false)
  assert.deepEqual(X.precosResumo({ prices: [{ amount: '12.5', type: 'standard', conditions: { end_time: null } }] }), [{ amount: 12.5, type: 'standard', fim: null }])
})
await okA('sync pós-execução: respeita a espera de ~30 min, só faz GET, suspeita ≠ veredito, nunca limpa marcas em massa', async () => {
  const C4 = 'Sync 1', agora = Date.now()
  coletaSint(C4, [an('MLB1'), an('MLB2')], [])
  R.marcarHumano(C4, { item_id: 'MLB1', pid: 'P1', marcado: true, preco: 100 }, 'dono'); R.marcarHumano(C4, { item_id: 'MLB2', pid: 'P1', marcado: true, preco: 100 }, 'dono')
  const p = planoSalvo(C4, { ids: ['MLB1', 'MLB2'] })
  const chamadasPlano = p.itens.map(i => ({ item_id: i.item_id, pid: i.pid, chamada: i.chamada, classe: 'enviado', estado_final: 'enviado_sem_prova_ainda' }))
  R.atualizarPlano(C4, p.id, { estado: 'executado', executado_em: new Date(agora - 5 * 60e3).toISOString(), resultado: { chamadas: chamadasPlano, resumo: {} } })
  const apiGet = vivas => { const a = async (metodo, caminho) => { assert.equal(metodo, 'GET', 'o sync só lê'); a.n++; const id = caminho.match(/items\/(MLB\d+)/)[1]; return { status: 200, corpo: (vivas[id] || []).map(o => ({ id: o.pid, type: 'SMART', status: o.status, price: 90, original_price: 120, meli_percentage: 5 })) } }; a.n = 0; return a }
  const cedo = apiGet({}); await assert.rejects(X.sincronizarPosExecucao(C4, p.id, { deps: { api: cedo, espera: 0 } }), /espere a propagação/); assert.equal(cedo.n, 0, 'leitura precoce nem acontece')
  // 31 min depois, NENHUMA aparece: SUSPEITO — não limpa nada, não declara "não entrou"
  R.atualizarPlano(C4, p.id, { executado_em: new Date(agora - 31 * 60e3).toISOString() })
  const s1 = await X.sincronizarPosExecucao(C4, p.id, { deps: { api: apiGet({ MLB1: [], MLB2: [] }), espera: 0 } })
  assert.equal(s1.suspeito, true); assert.match(s1.aviso, /NÃO conclua que falhou/)
  assert.ok(R.lerDecisoes(C4).every(d => d.marcado && d.estado === 'ativa'), 'marcas intactas')
  // uma entrou, a outra não: só linha a linha
  const s2 = await X.sincronizarPosExecucao(C4, p.id, { deps: { api: apiGet({ MLB1: [{ pid: 'P1', status: 'started' }], MLB2: [] }), espera: 0 } })
  assert.equal(s2.entrou, 1); assert.equal(s2.nao_provado, 1); assert.equal(s2.suspeito, false)
  const d = Object.fromEntries(R.lerDecisoes(C4).map(x => [x.item_id, x])); assert.equal(d.MLB1.estado, 'executada'); assert.equal(d.MLB2.estado, 'nao_entrou'); assert.ok(d.MLB2.marcado, 'a marca NUNCA é apagada')
  await assert.rejects(X.sincronizarPosExecucao(C4, 'PL-xx', {}), /não encontrado/)
  const nExec = planoSalvo('Sync 2'); await assert.rejects(X.sincronizarPosExecucao('Sync 2', nExec.id, {}), /já executado/)
})
await okA('plano end-to-end (banco + GET ao vivo simulado): gerar, aprovar, e o executor segue travado', async () => {
  const C5 = 'Plano E2E'
  coletaSint(C5, [an('MLB10')], [of('MLB10', 'P1')]); R.importarCustosSku(C5, [{ sku: 'MLB10-SKU', custo: 45 }], 't'); R.setConfig(C5, { imposto_pct: 10 })
  await assert.rejects(P.gerarPlano(C5, { por: 'dono', deps: { chamar: fakeChamar(), espera: 0, custosCliente: null } }), /nenhuma marca efetiva/)
  R.marcarHumano(C5, { item_id: 'MLB10', pid: 'P1', marcado: true, preco: 90, mc_pct: 23.2, offer_id: 'x' }, 'dono')
  const vivoStub = async (cliente, caminho, o) => { assert.ok(/^\/seller-promotions\/items\/MLB10\?app_version=v2$/.test(caminho), caminho); return [{ id: 'P1', type: 'SMART', ref_id: 'CANDIDATE-MLB10-1', status: 'candidate', price: 100, original_price: 120, meli_percentage: 5, name: 'Campanha comum' }] }     // SMART sem nome (oferta e coleta) = relâmpago desconhecido: PULAR
  const pl = await P.gerarPlano(C5, { por: 'dono', deps: { chamar: vivoStub, espera: 0, custosCliente: null, hoje: HOJE } })
  assert.equal(pl.estado, 'dry-run'); assert.equal(pl.resumo.entrar, 1); assert.equal(pl.itens[0].chamada.corpo.offer_id, 'CANDIDATE-MLB10-1')
  assert.equal(R.lerPlano(C5, pl.id).itens.length, 1)
  await assert.rejects(async () => P.aprovarPlano(C5, pl.id, ''), /quem está aprovando/)
  const ap = P.aprovarPlano(C5, pl.id, 'dono'); assert.equal(ap.estado, 'aprovado'); assert.equal(ap.aprovado_por, 'dono')
  assert.throws(() => P.aprovarPlano(C5, pl.id, 'dono'), /já está "aprovado"/)
  const api = apiBomba()
  await assert.rejects(X.executarPlano(C5, pl.id, { confirmar: true, por: 'dono', deps: { api, custosCliente: null } }), /DESLIGADA/); assert.equal(api.chamadas, 0)
  assert.ok(R.listarAuditoria(C5).some(a => a.evento === 'plano_aprovado'))
})

// ═══ 12b. rotas HTTP reais (Express em porta efêmera, banco em memória, GET externo = stub) ══════════════
const express = (await import('express')).default
const Rotas0 = await import('../src/rotas-promocoes.js')
const app = express(); app.use(express.json({ limit: '1mb' })); app.use(Rotas0.rotasPromocoes)
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`
const HC = 'Cliente HTTP'
Object.assign(Rotas0.depsPromocoes, { conexoes: () => [{ cliente: HC, nickname: 'x' }], chamar: fakeChamar(), uid: 123, espera: 0, itensExtras: ['MLB3', 'MLB4'],
  custosCliente: { cmv_pct: 40, comissao_pct: 15, imposto_pct: null, frete_pct: 8, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 0 } })
Rotas0.depsPromocoes.api = apiBomba()
const http = async (metodo, caminho, corpo) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) })
  const tipo = r.headers.get('content-type') || '', ehJson = tipo.includes('json')
  const out = { status: r.status, tipo, json: ehJson ? await r.json() : null, texto: ehJson ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer()) }   // text() descartaria o BOM
  assert.ok(!/\n\s+at .*\.js:\d+/.test(JSON.stringify(out.json) + (out.texto || '').slice(0, 500)), 'nunca vaza stack')
  return out
}
const esperarJob = async (cliente, id) => { for (let i = 0; i < 400; i++) { const j = (await http('GET', `/api/promocoes/job/${id}?cliente=${encodeURIComponent(cliente)}`)).json; if (j.estado !== 'rodando') return j; await new Promise(r => setTimeout(r, 15)) } throw new Error('job não terminou') }
const q = c => encodeURIComponent(c)
await okA('rotas: validação — cliente ausente/desconhecido/repetido, NaN e lixo nunca viram 500', async () => {
  assert.equal((await http('GET', '/api/promocoes/resumo')).status, 400)
  assert.equal((await http('GET', `/api/promocoes/resumo?cliente=Fulano`)).status, 404)
  assert.equal((await http('GET', `/api/promocoes/elegiveis?cliente=Fulano&cliente=Beltrano`)).status, 404)
  assert.equal((await http('GET', `/api/promocoes/auditoria?cliente=${q(HC)}&cliente=Zé&limite=5&item_id[]=x`)).status, 200)
  assert.equal((await http('GET', `/api/promocoes/auditoria?cliente=${q(HC)}&limite=abc`)).status, 400, 'valor PRESENTE porém inválido => 400 (contrato: nunca padrão silencioso)')
  assert.equal((await http('POST', '/api/promocoes/marcar', { cliente: HC, item_id: "MLB1'; DROP", pid: 'P-1', marcado: true })).status, 400)
  assert.equal((await http('POST', '/api/promocoes/marcar', { cliente: HC, item_id: 'MLB1', pid: 'P-1', marcado: 'talvez' })).status, 400)
  assert.equal((await http('POST', '/api/promocoes/marcar', { cliente: [HC, 'x'], item_id: ['MLB1'], pid: { a: 1 }, marcado: true })).status, 400)
  assert.equal((await http('GET', `/api/promocoes/exportar.csv?cliente=${q(HC)}&tipo=lixo`)).status, 400)
  assert.equal((await http('POST', '/api/promocoes/custos/importar', { cliente: HC, texto: 123 })).status, 400)
  assert.equal((await http('POST', '/api/promocoes/regras-sku', { cliente: HC, sku: 'A', status: 'talvez' })).status, 400)
  assert.equal((await http('POST', '/api/promocoes/aprendizados', { cliente: HC, resposta: '' })).status, 400)
  assert.equal((await http('POST', '/api/promocoes/aprovar-analista', { cliente: HC, itens: 'x' })).status, 400)
  assert.equal((await http('GET', `/api/promocoes/job/pj-x?cliente=${q(HC)}`)).status, 404)
  assert.equal((await http('GET', `/api/promocoes/resumo?cliente=${q(HC)}`)).status, 200, 'sem coleta ainda: resumo honesto, não erro')
  assert.equal((await http('POST', '/api/promocoes/config', { cliente: HC, piso_mc: 'abc' })).status, 400)
})
await okA('rotas: fluxo completo — coletar (job com lock), custos, analista, aprovar, marcar, plano, aprovar plano, execução TRAVADA', async () => {
  Rotas0.depsPromocoes.espera = 25                                           // lento o bastante para provar o lock único
  const [a, b] = await Promise.all([http('POST', '/api/promocoes/coletar', { cliente: HC, por: 'dono' }), http('POST', '/api/promocoes/coletar', { cliente: HC, por: 'dono' })])      // "por" é obrigatório (rev2 #24)
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'lock único: a 2ª coleta simultânea é recusada')
  const job = await esperarJob(HC, (a.status === 200 ? a : b).json.job)
  Rotas0.depsPromocoes.espera = 0
  assert.equal(job.estado, 'concluido', job.erro); assert.equal(job.resultado.campanhas, 5); assert.ok(job.progresso.fase)
  const r0 = (await http('GET', `/api/promocoes/resumo?cliente=${q(HC)}`)).json
  assert.equal(r0.frescor.fresca, true); assert.ok(r0.pendencias.some(p => p.codigo === 'LISTAGEM_ESCONDE_CAMPANHAS')); assert.ok(r0.pendencias.some(p => p.codigo === 'SEM_IMPOSTO'), 'sem imposto configurado = pendência declarada')
  assert.equal(r0.execucao.habilitada, false); assert.ok(r0.invariante.itens.length === 6)       // 3 zeros + "o analista rodou sobre esta coleta" + "marca gravada reproduzível" + "selo das entradas"
  // sem imposto nada é recomendado
  assert.equal((await http('POST', '/api/promocoes/analista', { cliente: HC })).json.recomendacoes.length, 0)
  assert.equal((await http('POST', '/api/promocoes/config', { cliente: HC, imposto_pct: 10 })).json.imposto_pct, 10)
  const imp = await http('POST', '/api/promocoes/custos/importar', { cliente: HC, texto: 'sku;custo\nSKU-VAR;40\nSKU-UM;45\nLIXO;abc' })
  assert.equal(imp.json.importados, 2); assert.equal(imp.json.total_rejeitadas, 1)
  assert.equal((await http('GET', `/api/promocoes/custos?cliente=${q(HC)}`)).json.skus.length, 2)
  // 'aplicar' só vale com o booleano true — string "true" é dry-run
  const seco = (await http('POST', '/api/promocoes/analista', { cliente: HC, aplicar: 'true' })).json
  assert.equal(seco.aplicado, false); assert.equal(repo2().lerDecisoes(HC).length, 0)
  const ap = (await http('POST', '/api/promocoes/analista', { cliente: HC, aplicar: true, por: 'analista' })).json
  assert.equal(ap.aplicado, true); assert.ok(ap.recomendacoes.some(r => r.item_id === 'MLB4' && r.regra === 'R2'), JSON.stringify(ap.recomendacoes.map(r => r.item_id + r.regra)))
  assert.equal(ap.invariante.ok, true, JSON.stringify(ap.invariante.itens))
  assert.equal((await http('GET', `/api/promocoes/elegiveis?cliente=${q(HC)}&pagina=NaN&limite=abc&curva=x`)).status, 400, 'paginação presente porém inválida => 400, não 500 nem padrão calado')
  const eleg = (await http('GET', `/api/promocoes/elegiveis?cliente=${q(HC)}&curva=x`)).json
  const l4 = eleg.itens.find(i => i.item_id === 'MLB4'); assert.equal(l4.situacao, 'sugerida'); assert.equal(l4.sugerida[0].gravada, true); assert.ok(l4.candidatos[0].passaPiso)
  assert.equal(eleg.itens.find(i => i.item_id === 'MLB2').situacao, 'abaixo_piso')
  assert.ok((await http('GET', `/api/promocoes/elegiveis?cliente=${q(HC)}&situacao=sugerida&q=var`)).json.itens.every(i => i.situacao === 'sugerida'))
  assert.equal((await http('GET', `/api/promocoes/elegiveis?cliente=${q(HC)}&q=naoexiste`)).json.total, 0)
  // 🤖 só entra no plano depois de aprovada
  assert.equal((await http('POST', '/api/promocoes/plano', { cliente: HC })).status, 409)
  assert.equal((await http('POST', '/api/promocoes/aprovar-analista', { cliente: HC, itens: (await http('GET', `/api/promocoes/resumo?cliente=${q(HC)}`)).json.sugestoes_pendentes, por: 'dono' })).json.aprovadas, 1)     // "Aprovar todas" = a lista exibida, com os números
  const mk = await http('POST', '/api/promocoes/marcar', { cliente: HC, item_id: 'MLB1', pid: 'P-1', marcado: true, por: 'dono' })
  assert.equal(mk.status, 200); assert.equal(mk.json.decisao.marcado, true); assert.equal(mk.json.decisao.preco, 90)
  assert.equal((await http('POST', '/api/promocoes/marcar', { cliente: HC, item_id: 'MLB1', pid: 'P-NAO-EXISTE', marcado: true })).status, 409, 'só marca candidata da última coleta')
  const plJob = await http('POST', '/api/promocoes/plano', { cliente: HC, por: 'dono' }); assert.equal(plJob.status, 200)
  const pj = await esperarJob(HC, plJob.json.job); assert.equal(pj.estado, 'concluido', pj.erro)
  const plano = (await http('GET', `/api/promocoes/plano?cliente=${q(HC)}`)).json.plano
  assert.equal(plano.estado, 'dry-run'); assert.equal(plano.expirado, false); assert.equal(plano.execucao_habilitada, false)
  assert.ok(plano.itens.filter(i => i.acao === 'ENTRAR').length >= 1); assert.ok(plano.itens.every(i => !i.chamada || i.chamada.metodo === 'POST'))
  assert.equal((await http('POST', '/api/promocoes/plano/aprovar', { cliente: HC, id: plano.id })).status, 400, 'aprovar exige o nome de quem aprova')
  assert.equal((await http('POST', '/api/promocoes/plano/aprovar', { cliente: HC, id: plano.id, por: 'dono' })).json.plano.estado, 'aprovado')
  // execução: TRAVADA — com e sem confirmar, a rota responde 403 {erro, motivo} ANTES de criar o job e a API nunca é chamada
  for (const confirmar of [true, 'true', undefined]) {
    const ex = await http('POST', '/api/promocoes/plano/executar', { cliente: HC, id: plano.id, confirmar, por: 'dono' })
    assert.equal(ex.status, 403); assert.match(ex.json.erro, /BLOQUEADA/); assert.match(ex.json.motivo, /DESLIGADA/); assert.equal(ex.json.job, undefined)
  }
  assert.equal((await http('POST', '/api/promocoes/config', { cliente: HC, execucao_habilitada: 1 })).status, 403, 'ligar a execução exige a frase inteira')
  assert.equal(Rotas0.depsPromocoes.api.chamadas, 0)
  assert.equal((await http('POST', '/api/promocoes/plano/sync', { cliente: HC, id: plano.id, por: 'dono' })).status, 409, 'sync só de plano executado')
  // regras por SKU, aprendizados, interrogatório, protegido, auditoria, CSV, participando, relâmpago
  assert.equal((await http('POST', '/api/promocoes/regras-sku', { cliente: HC, sku: 'SKU-UM', status: 'Livre', nota: 'fora de linha' })).json.regras.length, 1)
  assert.equal((await http('DELETE', '/api/promocoes/regras-sku', { cliente: HC, sku: 'SKU-UM' })).json.regras.length, 0)
  const inter = (await http('GET', `/api/promocoes/interrogatorio?cliente=${q(HC)}`)).json
  assert.equal(inter.revisaoFeita, true); assert.ok(inter.concordam >= 1)
  assert.equal((await http('POST', '/api/promocoes/aprendizados', { cliente: HC, padrao: 'abaixo_piso', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'decisão pontual', acao: 'nota' })).status, 200)
  assert.equal((await http('POST', '/api/promocoes/protegido', { cliente: HC, item_id: 'MLB2', protegido: true })).status, 200)
  assert.equal((await http('GET', `/api/promocoes/participando?cliente=${q(HC)}&dias=abc`)).status, 400, 'dias presente porém inválido => 400 (nunca a janela da config calada)')
  assert.equal((await http('GET', `/api/promocoes/participando?cliente=${q(HC)}`)).status, 200)
  const part = (await http('GET', `/api/promocoes/participando?cliente=${q(HC)}&dias=60`)).json
  assert.ok(part.participando.some(p => p.item_id === 'MLB1')); assert.ok(part.cobertura.alertas.some(a => a.item_id === 'MLB2' && a.cobreAte === '2026-11-01'), 'protegido que vence em 27 dias aparece na janela de 60')
  assert.equal((await http('GET', `/api/promocoes/relampago?cliente=${q(HC)}`)).json.avisos.length, 3)
  assert.ok((await http('GET', `/api/promocoes/auditoria?cliente=${q(HC)}&limite=3`)).json.length === 3)
  const csv = await http('GET', `/api/promocoes/exportar.csv?cliente=${q(HC)}&tipo=elegiveis`); assert.equal(csv.status, 200); assert.ok(csv.tipo.includes('text/csv')); assert.ok(csv.texto.startsWith('﻿')); assert.ok(csv.texto.includes(';'))
  assert.equal((await http('GET', `/api/promocoes/exportar.csv?cliente=${q(HC)}&tipo=plano`)).status, 200); assert.equal((await http('GET', `/api/promocoes/exportar.csv?cliente=${q(HC)}&tipo=auditoria`)).status, 200); assert.equal((await http('GET', `/api/promocoes/exportar.csv?cliente=${q(HC)}&tipo=descobertos`)).status, 200)
  assert.equal((await http('GET', '/api/promocoes/clientes')).json[0].cliente, HC)
})
srv.close()
function repo2() { return R }

// ═══ 13. CSV/estrutura: exportação neutraliza injeção de fórmula (rotas) ═════════════════════════════
const Rotas = await import('../src/rotas-promocoes.js')
ok('rotas: CSV com BOM, ; e apóstrofo contra injeção de fórmula; números não são neutralizados', () => {
  const csv = Rotas.paraCsv([{ A: '=1+1', B: '-cmd', C: '+x', D: '@y', E: 'normal "aspas"', F: -3.5, G: 12.5, H: 'a\nb' }], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
  assert.ok(csv.startsWith('﻿')); const [cab, lin] = csv.slice(1).split('\r\n'); assert.equal(cab, '"A";"B";"C";"D";"E";"F";"G";"H"')
  assert.equal(lin, `"'=1+1";"'-cmd";"'+x";"'@y";"normal ""aspas""";-3,5;12,5;"a b"`)
})
ok('rotas: validadores não explodem com repetidos/NaN/lixo', () => {
  assert.equal(Rotas.texto(['a', 'b'], 'x'), 'a'); assert.equal(Rotas.texto(undefined, 'x'), ''); assert.throws(() => Rotas.exigirTexto('', 'cliente'), /cliente/)
  assert.equal(Rotas.inteiro(undefined, 5, 1, 10), 5); assert.equal(Rotas.inteiro('7', 5, 1, 10), 7)
  for (const lixo of ['abc', '99', NaN, '', null, false, [], ['3', '4'], 0]) assert.throws(() => Rotas.inteiro(lixo, 5, 1, 10), /inteiro/, `inteiro(${JSON.stringify(lixo)}) deve dar 400, nunca padrão/coerção`)   // contrato: presente+inválido => 400
  assert.throws(() => Rotas.itemId('MLB1; DROP'), /MLB/); assert.equal(Rotas.itemId('mlb123456'), 'MLB123456')
  assert.equal(Rotas.simNao('1'), true); assert.throws(() => Rotas.simNao(['0', '1']), /sim ou não/); assert.equal(Rotas.simNao(undefined), false)
})

console.log(`teste-promocoes: ${n} verificações OK`)
