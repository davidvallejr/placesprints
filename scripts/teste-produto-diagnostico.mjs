// V3 F3 — diagnóstico POR PRODUTO atrás da chave produto.diagnostico_ligado (docs/desenho-v3-produto-estoque-financeiro.md § 4 e § 9 F3). Banco EM MEMÓRIA
// (PS_DB_MEMORIA=1 antes dos imports); nenhuma chamada ao ML, ao Notion ou ao n8n. Cobre: fórmulas do grupo (cobertura/ponto do estoque físico, helpers), 1 ação por
// estoque físico (entidade produto, id estável, irmãos, causa enviar_full), estoque_dividido (confirmar_fisico e pool_zerando), sku_ausente, pergunta ao cliente só A/B e
// até 2 por plano, estoque declarado vence (e vencido não vale), rota do estoque físico, chave DESLIGADA = plano/compras/textos byte a byte iguais, auditor nos textos novos.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db, hojeLocal } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { diagnosticarConta, algoritmo, sugestaoFull } = await import('../src/lib/diagnostico-conta.js')
const { montarGrafo, aplicarProduto, representaEstoque, representaProduto, estoqueDe, sufixoAnuncios, envioDoProprio, pseudoProdutos, produtoLigado } = await import('../src/lib/produto-estoque.js')
const { montarAcoes, gerarPlanoConta } = await import('../src/lib/plano-anuncios.js')
const { preverCompras } = await import('../src/lib/compras-previsao.js')
const { riscoRuptura } = await import('../src/lib/lead-time.js')
const { montarPlanoSemanal, montarRelatorioFoco, auditarMensagem, PREMISSA_PRODUTO } = await import('../src/lib/plano-semana-texto.js')
const { dadosPlanoSemana, relatorioFoco } = await import('../src/lib/gatilhos-real.js')
const { criarGatilhos, lerConfig, validarConfig } = await import('../src/lib/gatilhos.js')
const { auditarTexto } = await import('../src/lib/relatorio-seguro.js')
const { criarPendencias } = await import('../src/lib/pendencias-cliente.js')
const { lerCatalogo: catalogoReal } = await import('../src/lib/pendencias-cliente-real.js')
const R = await import('../src/lib/produto-estoque-real.js')
const { criarRotasProdutos } = await import('../src/rotas-produtos.js')
const { classificarCaminho } = await import('../src/lib/chaveiro.js')
import Database from 'better-sqlite3'
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = hojeLocal(), D = k => addDias(HOJE, k), T = `${HOJE}T05:00:00.000Z`, POR = 'Giovanna Torres'
const L = algoritmo.limiares, SEG = L.estoque_seguranca_dias, LEAD = L.lead_time_reposicao_dias
const ligar = v => { algoritmo.produto.diagnostico_ligado = v }
assert.equal(algoritmo.produto.diagnostico_ligado, false, 'a chave NASCE desligada no config')

// ── fixtures puras ──
const A = (item_id, o = {}) => ({ item_id, variacao_id: '', user_product_id: '', inventory_id: '', sku: '', sku_fonte: '', catalogo_produto_id: '', estoque: null, logistica: 'xd_drop_off', flex: 0, tags: '', status: 'active', lido_em: T, titulo: `Produto ${item_id}`, ...o })
const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, permalink: `https://produto.mercadolivre.com.br/MLB-${id.slice(3)}-x-_JM`, status: 'active', curva: 'A', u: 28, r: 1400, u0: 28, r0: 1400, v: 300, v0: 300, visOk: true, conv: 9.3, preco: 50, estoque: 100, vel_dia: 1, cobertura: 100, ponto_reposicao: 28, lead_time_dias: LEAD, lead_time_fonte: 'premissa', fotos: 8, frete_gratis: true, catalogo: false, ads: null, ads_ant: null, logistica: 'xd_drop_off', ...o })
const P = algoritmo.produto

await ok('fórmulas do grupo: catálogo + clássico no MESMO UP (E = 100, 56 + 84 un) → cobertura 20 d e ponto 140 nos dois SÓ com ligado; helpers representaEstoque/estoqueDe/sufixo', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 100 }), A('MLB2', { user_product_id: 'MLBU1', estoque: 100 })], hoje: HOJE, P })
  const lista = [it('MLB1', { u: 56, r: 2800, vel_dia: 2, cobertura: 50 }), it('MLB2', { u: 84, r: 4200, vel_dia: 3, cobertura: 33 })]
  aplicarProduto(lista, g, { L, ligado: false })
  assert.deepEqual(lista.map(i => i.cobertura), [50, 33], 'desligado: a cobertura do anúncio não muda')
  assert.ok(lista.every(i => !produtoLigado(i) && representaEstoque(i) && estoqueDe(i).n === 1 && sufixoAnuncios(i) === ''), 'desligado: todo anúncio fala por si')
  aplicarProduto(lista, g, { L, ligado: true })
  assert.deepEqual(lista.map(i => i.cobertura), [20, 20]); assert.deepEqual(lista.map(i => i.ponto_reposicao), [140, 140])
  assert.deepEqual(lista.map(i => i.cobertura_anuncio), [50, 33], 'o número por anúncio fica guardado')
  const [a, b] = lista
  assert.ok(!representaEstoque(a) && representaEstoque(b), 'representante = maior receita (MLB2)'); assert.ok(representaProduto(b) && !representaProduto(a))
  assert.deepEqual([estoqueDe(b).estoque, estoqueDe(b).u, estoqueDe(b).r, estoqueDe(b).vel, estoqueDe(b).n, estoqueDe(b).irmaos], [100, 140, 7000, 5, 2, ['MLB1']])
  assert.equal(sufixoAnuncios(b), ' (vende em 2 anúncios)')
  assert.equal(riscoRuptura(b, L).risco, 7000 / 28 * Math.max(0, LEAD - 20), 'receita em risco = do estoque físico inteiro')
  const ps = pseudoProdutos(lista); assert.equal(ps.length, 1); assert.deepEqual([ps[0].id, ps[0].estoque, ps[0].u, ps[0].produto_linha.n_anuncios], ['MLB2', 100, 140, 2])
  assert.equal(sugestaoFull(b).cenarios.conservador, Math.ceil(5 * (L.full_cobertura_planejada_dias + SEG) - 100), 'sugestaoFull usa velocidade e estoque do EF')
})

await ok('modos do F2 respeitados: nao_lido → cobertura null (nunca 0); espelho provável → contado 1× com premissa; dividido → 1 EF por estoque; Full + próprio = EFs separados', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', flex: 1, estoque: 50, sku: 'X', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', estoque: 50, sku: 'X', sku_fonte: 'seller_sku' }),
    A('MLB3', { user_product_id: 'MLBU3', estoque: 40, sku: 'ESP', sku_fonte: 'seller_sku' }), A('MLB4', { user_product_id: 'MLBU4', estoque: 40, sku: 'ESP', sku_fonte: 'seller_sku' }),
    A('MLB5', { user_product_id: 'MLBU5', estoque: 5, sku: 'DIV', sku_fonte: 'seller_sku' }), A('MLB6', { user_product_id: 'MLBU6', estoque: 90, sku: 'DIV', sku_fonte: 'seller_sku' })],
    fullEstoque: [{ inventory_id: 'I1', disponivel: 30, dia: HOJE }], hoje: HOJE, P })
  const l = [it('MLB1', { logistica: 'fulfillment' }), it('MLB2', { r: 1300 }), it('MLB3'), it('MLB4', { r: 1300 }), it('MLB5', { u: 28, r: 1400 }), it('MLB6', { u: 14, r: 700 })]
  aplicarProduto(l, g, { L, ligado: true })
  const d = Object.fromEntries(l.map(i => [i.id, i]))
  assert.equal(d.MLB2.cobertura, null, 'próprio não lido por local (Full > 0 com Flex) = null'); assert.equal(d.MLB1.cobertura, 30, 'o Full é um EF próprio: 30 ÷ 1/dia')
  assert.equal(d.MLB1.produto.modo_proprio, 'nao_lido'); assert.ok(d.MLB1.produto.premissas.some(t => /não foi lido por local/.test(t)))
  assert.equal(d.MLB3.produto.modo_proprio, 'espelho_provavel'); assert.equal(d.MLB3.cobertura, 20, 'espelho: 40 contado uma vez ÷ 2/dia'); assert.equal(d.MLB4.cobertura, 20)
  assert.ok(d.MLB3.produto.premissas.some(t => /mesmo número/.test(t)), 'premissa rotulada')
  assert.equal(d.MLB5.produto.modo_proprio, 'dividido'); assert.equal(d.MLB5.cobertura, 5, 'dividido: cada estoque é seu EF (5 ÷ 1/dia)'); assert.equal(d.MLB6.cobertura, 180)
  assert.ok(representaEstoque(d.MLB5) && representaEstoque(d.MLB6), 'dividido: cada EF tem o seu representante')
})

await ok('Full com Flex e inventário Full ZERADO: o número do anúncio é o estoque próprio (premissa rotulada, fonte anuncio_menos_full); envioDoProprio limita ao próprio − ponto', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', flex: 1, estoque: 17 })], fullEstoque: [{ inventory_id: 'I1', disponivel: 0, dia: HOJE }], hoje: HOJE, P })
  const prop = g.produtos[0].pools.find(p => p.local === 'proprio')
  assert.deepEqual([prop.estoque, prop.fonte, prop.inferido], [17, 'anuncio_menos_full', true]); assert.ok(g.produtos[0].premissas.some(t => /Full lido está zerado/.test(t)))
  const l = [it('MLB1', { logistica: 'fulfillment', u: 52, r: 2600, vel_dia: 1.86, estoque: 17 })]
  aplicarProduto(l, g, { L, ligado: true })
  assert.equal(l[0].cobertura, 0, 'o EF Full está em 0'); assert.equal(l[0].produto.local, 'full')
  const env = envioDoProprio(l[0], { conservador: 69, base: 83 })
  assert.deepEqual(env, { conservador: 17, base: 17, proprio: 17 }, 'envio limitado ao estoque próprio (sem ponto do próprio: teto = próprio)')
  assert.equal(envioDoProprio(l[0], null), null); assert.equal(envioDoProprio(it('MLB9'), { conservador: 1, base: 2 }), null, 'sem produto: null')
})

// ── montarAcoes com itens que carregam i.produto (o mesmo que carregarBase anota com a chave) ──
function diagDe(itens, extra = {}) {
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: '__f3__', hoje: HOJE, periodo: { de: D(-28), ate: D(-1), anterior: { de: D(-56), ate: D(-29) } }, resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, conversao_conta: null, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: null, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, clicks: 0, prints: 0, anterior: { roas: null } }, economia: null, custos_informados: true, itens, janelas: [], pendencias: [], algoritmo_versao: algoritmo.versao, vendas_dia_sem_mudanca: {}, data_quality: { cobertura: { pedidos: { lacunas: [], truncados: 0 } } }, ...extra }
}
const regras = a => a.map(x => x.regra.replace('anuncio_', ''))

await ok('1 ação de ruptura por ESTOQUE FÍSICO: 2 anúncios no mesmo UP em ruptura → 1 estoque_ruptura no representante, entidade produto com os irmãos, id = chave do EF (estável quando o representante troca); sem produto, 2 ações e id de hoje', () => {
  const mk = (rA, rB) => { const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 6, sku: 'TR-M', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU1', estoque: 6, sku: 'TR-M', sku_fonte: 'seller_sku' }), A('MLB3', { user_product_id: 'MLBU3', estoque: 500 })], hoje: HOJE, P })
    const l = [it('MLB1', { u: 60, r: rA, vel_dia: 2.14, estoque: 6, cobertura: 3 }), it('MLB2', { u: 60, r: rB, vel_dia: 2.14, estoque: 6, cobertura: 3 }), it('MLB3', { estoque: 500, cobertura: 500, r: 200, curva: 'C' })]; aplicarProduto(l, g, { L, ligado: true }); return l }
  const a1 = montarAcoes('__f3__', diagDe(mk(3000, 2000)), { hoje: HOJE }), rup = a1.filter(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(rup.length, 1); assert.equal(rup[0].item_id, 'MLB1', 'representante = maior receita')
  assert.deepEqual(rup[0].dados.entidade, { tipo: 'produto', id: 'sku:tr-m', ef: 'ef:sku:tr-m|proprio', itens: ['MLB1', 'MLB2'], modo: 'um_pool' }); assert.equal(rup[0].dados.nivel, 'produto')
  assert.equal(rup[0].dados.refs.length, 2, 'refs com os irmãos'); assert.match(rup[0].titulo, /\(2 anúncios, mesmo estoque\)/); assert.match(rup[0].dados.evidencia, /contado uma vez para 2 anúncios/)
  assert.match(rup[0].dados.evidencia, /estoque 6 un/); assert.match(rup[0].dados.problema, /produto em 2 anúncios/)
  assert.equal(rup[0].previsao.cenarios.base.receita, Math.round(100 * (5000 / 28) * Math.max(0, LEAD - Math.round(6 / (120 / 28)))) / 100, 'R$ pela demanda do PRODUTO (r_ef = 5000)')
  assert.deepEqual(rup[0].dados.causas_possiveis.map(c => c.causa), ['comprar'])
  const a2 = montarAcoes('__f3__', diagDe(mk(2000, 3000)), { hoje: HOJE }), rup2 = a2.filter(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(rup2[0].item_id, 'MLB2'); assert.equal(rup2[0].id, rup[0].id, 'o representante trocou e o id da ação não mudou (chave do EF)')
  // sem produto (chave desligada): 2 ações, uma por anúncio, com o id de hoje
  const l0 = [it('MLB1', { u: 60, r: 3000, vel_dia: 2.14, estoque: 6, cobertura: 3 }), it('MLB2', { u: 60, r: 2000, vel_dia: 2.14, estoque: 6, cobertura: 3 })]
  const a0 = montarAcoes('__f3__', diagDe(l0), { hoje: HOJE }).filter(x => x.regra === 'anuncio_estoque_ruptura')
  assert.deepEqual(a0.map(x => x.item_id), ['MLB1', 'MLB2']); assert.ok(a0.every(x => x.dados.entidade.tipo === 'anuncio' && x.id !== rup[0].id))
  // EF de 1 anúncio com a chave ligada mantém o id de hoje (zero churn)
  const g1 = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 6 })], hoje: HOJE, P }), l1 = [it('MLB1', { u: 60, r: 3000, vel_dia: 2.14, estoque: 6, cobertura: 3 })]; aplicarProduto(l1, g1, { L, ligado: true })
  const s1 = montarAcoes('__f3__', diagDe(l1), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(s1.id, a0[0].id); assert.equal(s1.dados.entidade.tipo, 'anuncio')
})

await ok('causa enviar_full: EF Full em ruptura com estoque PRÓPRIO do mesmo produto → como[0] «Enviar ao Full … (não precisa comprar)», teto próprio − ponto; sem próprio = comprar; Chaveiro: pendência (cliente) nas duas causas', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', estoque: 5, sku: 'GUIA', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', estoque: 120, sku: 'GUIA', sku_fonte: 'seller_sku' })],
    fullEstoque: [{ inventory_id: 'I1', disponivel: 5, dia: HOJE }], hoje: HOJE, P })
  const l = [it('MLB1', { logistica: 'fulfillment', u: 56, r: 2800, vel_dia: 2, estoque: 5, cobertura: 2 }), it('MLB2', { u: 7, r: 350, vel_dia: 0.25, estoque: 120, cobertura: 480, curva: 'B' })]
  aplicarProduto(l, g, { L, ligado: true })
  const a = montarAcoes('__f3__', diagDe(l), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(a.item_id, 'MLB1'); assert.deepEqual(a.dados.causas_possiveis.map(c => c.causa), ['enviar_full'])
  assert.match(a.dados.como[0], /^Enviar ao Full \d+( a \d+)? un do estoque próprio \(tem 120 un no depósito; não precisa comprar\)$/); assert.match(a.dados.evidencia, /Estoque próprio do mesmo produto: 120 un/)
  const q = Number(/Full (\d+)/.exec(a.dados.como[0])[1]); assert.ok(q <= 120 - l[1].produto.efs.find(e => e.local === 'proprio').ponto, 'teto = próprio − ponto do próprio')
  assert.equal(a.dados.execucao.caminho, 'cliente'); assert.equal(classificarCaminho({ regra: 'anuncio_estoque_ruptura', dados: { causas_possiveis: [{ causa: 'comprar' }] } }).caminho, 'cliente')
})

await ok('estoque_dividido: espelho provável (A/B) → confirmar_fisico (pendência, caminho cliente, sem R$); dividido com um EF em ruptura e outro acima do ponto → pool_zerando (card assistido, R$ do EF fraco); teto 2; curva C não nasce', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 40, sku: 'ESP', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', estoque: 40, sku: 'ESP', sku_fonte: 'seller_sku' }),
    A('MLB3', { user_product_id: 'MLBU3', estoque: 3, sku: 'DIV', sku_fonte: 'seller_sku' }), A('MLB4', { user_product_id: 'MLBU4', estoque: 90, sku: 'DIV', sku_fonte: 'seller_sku' }),
    A('MLB5', { user_product_id: 'MLBU5', estoque: 10, sku: 'C1', sku_fonte: 'seller_sku' }), A('MLB6', { user_product_id: 'MLBU6', estoque: 10, sku: 'C1', sku_fonte: 'seller_sku' })], hoje: HOJE, P })
  const l = [it('MLB1', { u: 30, r: 3000, vel_dia: 1.07 }), it('MLB2', { u: 28, r: 2800, vel_dia: 1 }), it('MLB3', { u: 28, r: 2800, vel_dia: 1, estoque: 3, cobertura: 3 }), it('MLB4', { u: 14, r: 1400, vel_dia: 0.5, estoque: 90, cobertura: 180 }),
    it('MLB5', { u: 2, r: 20, curva: 'C' }), it('MLB6', { u: 1, r: 10, curva: 'C' })]
  aplicarProduto(l, g, { L, ligado: true })
  const acoes = montarAcoes('__f3__', diagDe(l), { hoje: HOJE }), div = acoes.filter(x => x.regra === 'anuncio_estoque_dividido')
  assert.equal(div.length, 2, 'uma por produto (espelho + dividido); curva C fora')
  const esp = div.find(x => x.dados.causas_possiveis[0].causa === 'confirmar_fisico'), zer = div.find(x => x.dados.causas_possiveis[0].causa === 'pool_zerando')
  assert.ok(esp && zer)
  assert.equal(esp.item_id, 'MLB1'); assert.equal(esp.previsao.tipo, 'pendencia'); assert.equal(esp.dados.execucao.caminho, 'cliente'); assert.equal(esp.dados.execucao.adaptador, 'pendencia'); assert.match(esp.dados.como[0], /quantas unidades existem/)
  assert.deepEqual(esp.dados.entidade.itens, ['MLB1', 'MLB2']); assert.equal(esp.dados.entidade.tipo, 'produto')
  assert.equal(zer.item_id, 'MLB3', 'nasce no representante do EF que zera'); assert.equal(zer.previsao.tipo, 'risco_evitado'); assert.ok(zer.previsao.cenarios.base.receita > 0)
  assert.equal(zer.dados.execucao.caminho, 'assistido'); assert.equal(zer.dados.execucao.adaptador, 'notion'); assert.match(zer.dados.problema, /outro mostra 90 un do mesmo produto/)
  assert.ok(acoes.some(x => x.regra === 'anuncio_estoque_ruptura' && x.item_id === 'MLB3'), 'a ruptura do EF fraco também nasce (comprar)')
  // teto: 3 produtos espelhados → 2 ações (omitidas conta)
  const g3 = montarGrafo({ arestas: [1, 2, 3].flatMap(k => [A(`MLB${k}a`, { user_product_id: `MLBU${k}a`, estoque: 40, sku: `S${k}`, sku_fonte: 'seller_sku' }), A(`MLB${k}b`, { user_product_id: `MLBU${k}b`, estoque: 40, sku: `S${k}`, sku_fonte: 'seller_sku' })]), hoje: HOJE, P })
  const l3 = [1, 2, 3].flatMap(k => [it(`MLB${k}a`, { u: 30, r: 3000 }), it(`MLB${k}b`, { u: 28, r: 2800 })]); aplicarProduto(l3, g3, { L, ligado: true })
  const a3 = montarAcoes('__f3__', diagDe(l3), { hoje: HOJE })
  assert.equal(a3.filter(x => x.regra === 'anuncio_estoque_dividido').length, 2); assert.equal(a3.omitidas.estoque_dividido, 1)
})

await ok('sku_ausente (conta): anúncios A/B sem SELLER_SKU ≥ 20% do GMV → 1 ação assistida sem R$, listando os maiores; abaixo de 20% ou sem a chave, nada', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 100 }), A('MLB2', { user_product_id: 'MLBU2', estoque: 100, sku: 'OK', sku_fonte: 'seller_sku' })], hoje: HOJE, P })
  const l = [it('MLB1', { r: 3000 }), it('MLB2', { r: 7000 })]; aplicarProduto(l, g, { L, ligado: true })
  const a = montarAcoes('__f3__', diagDe(l), { hoje: HOJE }).find(x => x.regra === 'anuncio_sku_ausente')
  assert.ok(a, 'nasce'); assert.equal(a.item_id, ''); assert.equal(a.previsao.tipo, 'pendencia'); assert.equal(a.dados.execucao.caminho, 'assistido'); assert.match(a.dados.como[0], /MLB1/); assert.equal(a.dados.refs.length, 1)
  const l2 = [it('MLB1', { r: 1000 }), it('MLB2', { r: 9000 })]; aplicarProduto(l2, g, { L, ligado: true })
  assert.ok(!montarAcoes('__f3__', diagDe(l2), { hoje: HOJE }).some(x => x.regra === 'anuncio_sku_ausente'), '10% do GMV: não nasce')
  assert.ok(!montarAcoes('__f3__', diagDe([it('MLB1', { r: 3000 }), it('MLB2', { r: 7000 })]), { hoje: HOJE }).some(x => /sku_ausente|estoque_dividido/.test(x.regra)), 'sem i.produto (chave desligada) as regras novas não existem')
})

await ok('compras: 1 linha por PRODUTO (estoque contado 1×, demanda somada, prazo do representante), envio ao Full pelo EF Full; com produto:false, 1 por anúncio; premissa do produto no texto', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 20 }), A('MLB2', { user_product_id: 'MLBU1', estoque: 20 }), A('MLB3', { user_product_id: 'MLBU3', estoque: 200 })], hoje: HOJE, P })
  const l = [it('MLB1', { u: 56, r: 2800, vel_dia: 2, estoque: 20, cobertura: 10, u14: 28 }), it('MLB2', { u: 28, r: 1400, vel_dia: 1, estoque: 20, cobertura: 20, u14: 14 }), it('MLB3', { u: 28, r: 1400, estoque: 200, cobertura: 200, u14: 14 })]
  aplicarProduto(l, g, { L, ligado: true })
  const cp = preverCompras(diagDe(l), { cfg: algoritmo, produto: true }), ca = preverCompras(diagDe(l), { cfg: algoritmo, produto: false })
  assert.equal(cp.itens.length, 2); assert.equal(ca.itens.length, 3)
  const x = cp.itens.find(y => y.id === 'MLB1'); assert.deepEqual(x.produto, { chave: 'up:MLBU1', n_anuncios: 2, itens: ['MLB1', 'MLB2'], modo: 'um_pool' }); assert.equal(x.estoque, 20); assert.equal(x.vendas_dia_28d, 3)
  assert.ok(x.quanto_pedir.conservador >= Math.ceil(3 * (LEAD + algoritmo.compras.ciclo_compra_dias + SEG) - 20) - 1, 'demanda somada contra o estoque contado uma vez')
  assert.ok(cp.premissas.some(t => /Contamos o estoque uma vez por produto/.test(t)) && !ca.premissas.some(t => /Contamos o estoque uma vez/.test(t)))
  assert.equal(preverCompras(diagDe(l), { cfg: algoritmo }).itens.length, 3, 'omitido: segue a chave do config (desligada)')
})

await ok('pergunta ao cliente (pendência estoque_espelhado): só produtos curva A/B espelhados, no máximo 2 por cliente por plano, texto do catálogo pelo auditor', () => {
  const cat = catalogoReal(), h = new Database(':memory:')
  h.exec('CREATE TABLE pendencia_cliente (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT, canal TEXT, item TEXT, detalhe TEXT DEFAULT "", desde TEXT DEFAULT "", evidencia TEXT DEFAULT "", gravidade TEXT DEFAULT "", por TEXT, criada_em TEXT, resolvida_em TEXT DEFAULT "", resolvida_por TEXT DEFAULT "", nota TEXT DEFAULT "")')
  const NOME = { MLB1: 'Coleira Peitoral Rock', MLB2: 'Guia Unificada Preta', MLB3: 'Mordedor Natural', MLB4: 'Petisqueira Kong', MLB5: 'Colar Adestramento' }
  const esp = (id, curva, r, n = 2) => ({ id, titulo: NOME[id], curva, status: 'active', estoque: 40, cobertura: 40, u: 20, r, fotos: 8, catalogo: false, custo_unitario: 1, lead_time_dias: 21, lead_time_fonte: 'cliente', atualizado_em: T,
    produto: { ligado: true, representa_produto: true, representa_estoque: true, modo_proprio: 'espelho_provavel', n_anuncios: n, chave: `sku:${id}` } })
  const itens = [esp('MLB1', 'A', 5000, 3), esp('MLB2', 'B', 2000), esp('MLB3', 'B', 1500), { ...esp('MLB4', 'C', 100), curva: 'C' }, { ...esp('MLB5', 'A', 900), produto: { ...esp('MLB5', 'A', 900).produto, modo_proprio: 'um_pool' } }]
  const p = criarPendencias({ handle: h, dependencias: { listar: () => [] }, riscoEstoque: () => ({ itens, atualizado_em: T, janela_dias: 28, lead_time_dias: 21, fotos_minimas: 6, custos_conta_informados: true }), contasMl: () => null, acoesPlano: null, visiveis: null, hoje: () => HOJE, agora: () => T, catalogo: cat, auditar: auditarTexto })
  const r = p.avaliar('Acme'), e = r.itens.find(x => x.item === 'estoque_espelhado')
  assert.ok(e, 'nasce'); assert.equal(e.produtos.length, 2, 'no máximo 2 por cliente'); assert.deepEqual(e.anuncios.map(a => a.id), ['MLB1', 'MLB2'], 'os 2 de maior receita; curva C e um_pool fora')
  assert.equal(e.gravidade, 'info'); assert.equal(e.impacto.tipo, 'sem_estimativa'); assert.match(e.o_que_precisamos, /Quantas unidades você tem hoje de Coleira Peitoral Rock e Guia Unificada Preta, fora do Full/)
  for (const k of ['por_que_importa', 'efeito_se_atrasar', 'o_que_precisamos', 'o_que_fazemos']) assert.deepEqual(auditarTexto(e[k]), [], `auditor: ${k}`)
  assert.ok(!r.itens.some(x => x.item === 'estoque_espelhado' && x.produtos.length > 2))
  const semChave = criarPendencias({ handle: h, dependencias: { listar: () => [] }, riscoEstoque: () => ({ itens: itens.map(({ produto, ...i }) => i), atualizado_em: T, janela_dias: 28, lead_time_dias: 21, fotos_minimas: 6, custos_conta_informados: true }), contasMl: () => null, acoesPlano: null, visiveis: null, hoje: () => HOJE, agora: () => T, catalogo: cat, auditar: auditarTexto })
  assert.ok(!semChave.avaliar('Acme').itens.some(x => x.item === 'estoque_espelhado'), 'sem i.produto (chave desligada) a pergunta não existe')
})

await ok('estoque declarado vence: espelho 40/40 com 60 declarados há 3 dias → modo declarado, E = 60; declarado há 10 dias (vencido) é ignorado; produto sem SKU não recebe declaração', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', estoque: 40, sku: 'Col-P', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', estoque: 40, sku: 'col-p', sku_fonte: 'seller_sku' })]
  const g = montarGrafo({ arestas: ar, declarado: new Map([['col-p', { quantidade: 60, fonte: 'cliente', em: D(-3) }]]), hoje: HOJE, P })
  assert.equal(g.produtos[0].modo, 'declarado'); assert.equal(g.produtos[0].estoque, 60); assert.ok(g.produtos[0].premissas.some(t => /estoque informado: 60 un/.test(t)))
  const l = [it('MLB1', { u: 28, r: 1400, vel_dia: 1 }), it('MLB2', { u: 28, r: 1400, vel_dia: 1, r: 1300 })]; aplicarProduto(l, g, { L, ligado: true })
  assert.equal(l[0].cobertura, 30, '60 ÷ 2/dia')
  const gv = montarGrafo({ arestas: ar, declarado: new Map([['col-p', { quantidade: 60, fonte: 'cliente', em: D(-10) }]]), hoje: HOJE, P })
  assert.equal(gv.produtos[0].modo, 'espelho_provavel', 'vencido (> 7 d) não vale'); assert.equal(gv.produtos[0].estoque, 40)
})

// ── cliente semeado em memória (o mesmo caminho da coleta): chave desligada = idêntico; ligada = produto no plano, nos textos e na rota do estoque físico ──
const item = (id, o = {}) => ({ id, title: `Peitoral H Rock ${id}`, price: 50, available_quantity: 6, pictures: [{}, {}, {}, {}, {}], shipping: { logistic_type: 'xd_drop_off', tags: [] }, status: 'active', date_created: '2025-01-01T00:00:00.000Z', user_product_id: 'MLBU777', ...o })
function semear(cli, itens, vendas) {
  gravarItens(cli, itens, { t: T, dia: HOJE })
  const s = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  const c = db.prepare('INSERT OR IGNORE INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,1,0,?)')
  db.transaction(() => { for (let d = -56; d <= -1; d++) { c.run(cli, D(d), T); for (const [id, u] of Object.entries(vendas)) if (u) s.run(cli, id, D(d), u, u * 50, 40) } })()
}
db.prepare("INSERT OR IGNORE INTO clientes_central (cliente, status_cs) VALUES ('Uniao', 'Ativo')").run()
// catálogo + clássico no MESMO UP com 6 un (2 + 3 por dia = ruptura), um 3º com o mesmo SKU oficial em outro UP (espelho 6/6) e um sem SKU
semear('Uniao', [item('MLB1', { catalog_listing: true, catalog_product_id: 'MLB55', attributes: [{ id: 'SELLER_SKU', value_name: 'PH-ROCK-M' }] }), item('MLB2', { attributes: [{ id: 'SELLER_SKU', value_name: 'PH-ROCK-M' }] }),
  item('MLB3', { user_product_id: 'MLBU888', attributes: [{ id: 'SELLER_SKU', value_name: 'ph-rock-m' }] }), item('MLB4', { user_product_id: 'MLBU999', available_quantity: 300, title: 'Guia Unificada Rock' })], { MLB1: 2, MLB2: 3, MLB3: 1, MLB4: 2 })
const limpa = o => JSON.parse(JSON.stringify(o, (k, v) => (['gerado_em', 'atualizado_em', 'criado_em'].includes(k) ? undefined : v)))
const fotografia = () => {
  const diag = diagnosticarConta('Uniao', { hoje: HOJE }), plano = gerarPlanoConta('Uniao', { hoje: HOJE, salvar: false }), d = dadosPlanoSemana('Uniao', { diag })
  const lim = { ...algoritmo.limiares, min_unidades_item: algoritmo.foco.min_unidades_item }
  const semanal = montarPlanoSemanal({ rotulo: 'Uniao', hoje: HOJE, resumo: d.resumo, itens: d.itens, fullParado: d.fullParado, entregas: d.entregas, custosInformados: d.custosInformados, limiares: lim, info: d.relatorio })
  const foco = relatorioFoco('Uniao', { hoje: HOJE })
  return { itens: limpa(diag.itens), acoes: limpa(plano.acoes.map(a => ({ id: a.id, regra: a.regra, item_id: a.item_id, titulo: a.titulo, dados: a.dados, previsao: a.previsao }))), omitidas: plano.omitidas, compras: limpa(preverCompras(diag, { cfg: algoritmo })), semanal: semanal.texto, foco: foco.texto, dq: limpa(diag.data_quality) }
}

await ok('chave DESLIGADA = byte a byte igual: com as chaves do produto gravadas (meli_anuncio_up) e sem elas, diagnóstico, plano, compras, plano semanal e relatório focado saem iguais; nenhum i.produto, nenhuma entidade produto, 3 rupturas por anúncio', () => {
  ligar(false)
  const com = fotografia()
  const backup = db.prepare("SELECT * FROM meli_anuncio_up WHERE cliente = 'Uniao'").all()
  db.prepare("DELETE FROM meli_anuncio_up WHERE cliente = 'Uniao'").run()
  const sem = fotografia()
  const ins = db.prepare(`INSERT INTO meli_anuncio_up (${Object.keys(backup[0]).join(',')}) VALUES (${Object.keys(backup[0]).map(() => '?').join(',')})`)
  for (const r of backup) ins.run(...Object.values(r))
  assert.equal(JSON.stringify(com), JSON.stringify(sem), 'as chaves gravadas não mudam NADA com a chave desligada')
  assert.ok(com.itens.every(i => i.produto === undefined && i.cobertura_anuncio === undefined)); assert.ok(com.acoes.every(a => a.dados.entidade.tipo !== 'produto'))
  assert.equal(com.acoes.filter(a => a.regra === 'anuncio_estoque_ruptura').length, 3, 'MLB1, MLB2 e MLB3: 3 rupturas por anúncio'); assert.ok(!com.acoes.some(a => /dividido|sku_ausente/.test(a.regra)))
  assert.ok(!/vende em \d+ anúncios|Contamos o estoque uma vez/.test(com.semanal + com.foco)); assert.equal(com.compras.itens.length, 4)
})

await ok('chave LIGADA (só em memória): MLB1+MLB2 (mesmo UP) + MLB3 (mesmo SKU, espelho 6/6) = 1 estoque físico → 1 ruptura no representante com entidade produto (3 irmãos) + pergunta ao cliente (estoque_dividido), 3 linhas de compra viram 1, «vende em 3 anúncios» no plano semanal e no focado com a premissa; auditor aprova; data_quality declara a fonte', () => {
  ligar(true)
  try {
    const f = fotografia(), rup = f.acoes.filter(a => a.regra === 'anuncio_estoque_ruptura')
    assert.deepEqual(rup.map(a => a.item_id), ['MLB2'], 'espelho provável = 1 EF para os 3 anúncios: só o representante (maior receita = MLB2)')
    const up = rup[0]; assert.equal(up.dados.entidade.tipo, 'produto'); assert.deepEqual(up.dados.entidade.itens.sort(), ['MLB1', 'MLB2', 'MLB3']); assert.match(up.titulo, /3 anúncios, mesmo estoque/)
    assert.equal(up.previsao.cenarios.base.receita, Math.round(100 * (300 * 28 / 28) * Math.max(0, LEAD - Math.round(6 / (6)))) / 100, 'R$ = receita dos 3 anúncios (6 un/dia × R$ 50) × dias sem estoque')
    const div = f.acoes.find(a => a.regra === 'anuncio_estoque_dividido'); assert.ok(div, 'espelho 6/6 entre MLBU777 e MLBU888 → pergunta ao cliente'); assert.equal(div.dados.causas_possiveis[0].causa, 'confirmar_fisico')
    assert.ok(f.acoes.some(a => a.regra === 'anuncio_sku_ausente'), 'MLB4 (sem SKU) ≥ 20% do GMV')
    assert.equal(f.compras.itens.length, 2, '4 anúncios → 2 produtos (MLB1+MLB2+MLB3 pelo SKU, MLB4)'); assert.ok(f.compras.itens.some(x => x.produto?.n_anuncios === 3))
    assert.match(f.semanal, /vende em 3 anúncios/); assert.ok(f.semanal.includes(PREMISSA_PRODUTO)); assert.match(f.foco, /vende em 3 anúncios/)
    assert.deepEqual(auditarMensagem(f.semanal, auditarTexto, { permitidos: ['Uniao'] }), [], 'auditor do plano semanal'); assert.deepEqual(auditarMensagem(f.foco, auditarTexto, { permitidos: ['Uniao'] }), [], 'auditor do focado')
    assert.ok(f.dq.fontes.some(x => /produto por trás do anúncio/.test(x.fonte)))
    const pr = R.produtosDoCliente('Uniao', diagnosticarConta('Uniao', { hoje: HOJE }), { cfg: algoritmo })
    assert.equal(pr.sombra_ligada, true); assert.ok(pr.sombra.ruptura.anuncios >= pr.sombra.ruptura.efs, 'o comparativo por anúncio × por produto continua (por anúncio pela cobertura guardada)')
  } finally { ligar(false) }
})

await ok('rota POST /api/cliente/produtos/estoque-fisico: prévia não grava; SKU inexistente 404; por inválido 403; confirmar grava e o grafo passa a «declarado»; nunca eco do valor', async () => {
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(), validarPor = nome => (norm(nome) === norm(POR) ? POR : '')
  const app = express(); app.use(express.json())
  app.use(criarRotasProdutos({ produtos: () => ({}), mapeamento: () => ({}), vinculos: { juntar: () => ({}), separar: () => ({}) }, estoque: { ups: () => [], restante: () => 0, ler: async () => ({}) }, estoqueFisico: R.criarEstoqueDeclarado({ agora: () => T, validarPor }), dre: () => ({}), mesAtual: () => HOJE.slice(0, 7), clienteCanonico: nome => (norm(nome) === 'uniao' ? 'Uniao' : '') }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const post = async b => { const r = await fetch(`${base}/api/cliente/produtos/estoque-fisico`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() } }
  try {
    let r = await post({ cliente: 'Uniao', sku: 'PH-ROCK-M', quantidade: 9 }); assert.equal(r.status, 200); assert.equal(r.j.previa, true); assert.equal(r.j.produto, 'sku:ph-rock-m'); assert.equal(r.j.n_anuncios, 3)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM produto_estoque_declarado').get().n, 0, 'prévia não grava')
    r = await post({ cliente: 'Uniao', sku: 'NAO-EXISTE', quantidade: 9, confirmar: true, por: POR }); assert.equal(r.status, 404); assert.ok(!/NAO-EXISTE/.test(r.j.erro)); r = await post({ cliente: 'Uniao', sku: 'A<b>', quantidade: 9 }); assert.equal(r.status, 400); assert.ok(!/<b>/.test(r.j.erro))
    r = await post({ cliente: 'Uniao', sku: 'PH-ROCK-M', quantidade: 9, confirmar: true, por: 'Fulano' }); assert.equal(r.status, 403)
    r = await post({ cliente: 'Uniao', sku: 'PH-ROCK-M', quantidade: -1, confirmar: true, por: POR }); assert.equal(r.status, 400)
    r = await post({ cliente: '[Comercial] X', sku: 'PH-ROCK-M', quantidade: 9 }); assert.equal(r.status, 400)
    r = await post({ cliente: 'Uniao', sku: 'PH-ROCK-M', quantidade: 9, fonte: 'equipe', confirmar: true, por: POR }); assert.equal(r.status, 200); assert.equal(r.j.previa, false); assert.equal(r.j.modo_depois, 'declarado')
    assert.deepEqual(db.prepare('SELECT sku, quantidade, fonte, por FROM produto_estoque_declarado').all(), [{ sku: 'ph-rock-m', quantidade: 9, fonte: 'equipe', por: POR }])
    assert.equal(R.grafoDoCliente('Uniao').produtos.find(p => p.skus.includes('ph-rock-m')).estoque, 9, 'declarado vence no grafo real')
  } finally { srv.close() }
})

await ok('aviso de estoque (gatilhos) com produto: 1 linha por estoque físico com «vende em N anúncios», estoque e R$ do produto, o irmão não aparece; auditor aprova; estoque_zerado idem', async () => {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT '', notificacao_json TEXT NOT NULL DEFAULT '{}')"); h.prepare("INSERT INTO clientes_central (cliente, status_cs) VALUES ('Acme', 'Ativo')").run()
  const prod = (rep, irm) => ({ ligado: true, chave: 'sku:racao', ef: 'ef:sku:racao|proprio', modo: 'um_pool', local: 'proprio', n_anuncios: 2, n_ef: 2, irmaos: [irm], irmaos_ef: [irm], representa_estoque: rep, representa_produto: rep, estoque_ef: 8, vel_ef: 3, u_ef: 84, r_ef: 4200, cobertura_ef: 3, ponto_ef: 84, estoque: 8, u: 84, r: 4200, efs: [], skus: ['racao'], premissas: [] })
  const itens = [{ id: 'MLB1', titulo: 'Ração Premium 15kg', curva: 'A', status: 'active', cobertura: 3, estoque: 8, ponto_reposicao: 84, vel_dia: 2, u: 56, r: 2800, r0: 2600, logistica: 'self_service', permalink: 'https://produto.mercadolivre.com.br/MLB-1-racao-_JM', produto: prod(true, 'MLB2') },
    { id: 'MLB2', titulo: 'Ração Premium 15kg Catálogo', curva: 'A', status: 'active', cobertura: 3, estoque: 8, ponto_reposicao: 84, vel_dia: 1, u: 28, r: 1400, r0: 1400, logistica: 'self_service', permalink: 'https://produto.mercadolivre.com.br/MLB-2-racao-_JM', produto: prod(false, 'MLB1') }]
  const diag = { disponivel: true, hoje: HOJE, periodo: { de: D(-28), ate: D(-1) }, data_quality: { cobertura: { pedidos: { de: D(-120), lacunas: [] } } }, itens }
  const cfg = (() => { const c = JSON.parse(JSON.stringify(lerConfig())); c.urgente.na_hora_ligado = true; c.urgente.impacto_min_reais = 0; return validarConfig(c) })()
  const g = criarGatilhos({ handle: h, fontes: { acoes: () => [], diagnostico: () => diag, saude: () => null, sugestaoFull: () => null, mudancasPreco: () => [], atividadePreco: () => ({ tarefas: [], execucoes: [], promocoes: [], sync: '', promo_lida: '', leituras: [] }), compras: (c, d) => preverCompras(d, { cfg: algoritmo, produto: true }), planoSemana: () => ({ disponivel: false }) },
    agora: () => T, nomesInternos: () => [POR], cfg, validarPor: v => (v === POR ? v : ''), elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }], clienteCanonico: n => (n === 'Acme' ? 'Acme' : ''), envio: null, integracao: () => ({ ok: true, motivo: '' }), coletaCompleta: () => true })
  await g.avaliar('Acme')
  const row = h.prepare("SELECT itens_json, texto FROM gatilho_cliente WHERE cliente = 'Acme' AND tipo = 'ruptura_curva_a'").get()
  assert.ok(row, 'ruptura detectada'); const its = JSON.parse(row.itens_json)
  assert.deepEqual(its.map(x => x.id), ['MLB1'], 'só o representante'); assert.equal(its[0].produto, 'sku:racao'); assert.deepEqual(its[0].irmaos, ['MLB2'])
  assert.equal(its[0].impacto.b, Math.round(riscoRuptura(itens[0], L).risco), 'R$ pela demanda do produto (r_ef)'); assert.equal(its[0].impacto.b, Math.round(4200 / 28 * (LEAD - 3)))
  assert.match(row.texto, /Ração Premium 15kg \(vende em 2 anúncios\): tem 8 un \(~3 dias\)/); assert.ok(row.texto.includes(PREMISSA_PRODUTO)); assert.ok(!/Catálogo/.test(row.texto))
  assert.deepEqual(auditarMensagem(row.texto, auditarTexto, { permitidos: ['Acme'] }), [])
})

// ── revisão adversarial F3 (15/10): uma prova por correção ──
await ok('revisão F3 · teto do Full: sem leitura do inventário (coleta do Full falhou/venceu) o EF Full usa o número do anúncio (ruptura não some); leitura velha ACIMA do anúncio = vale o anúncio e o produto acompanha; desligado nada muda', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', flex: 1, estoque: 3 })]
  const l = [it('MLB1', { logistica: 'fulfillment', u: 14, r: 700, vel_dia: 0.5, estoque: 3, cobertura: 6 })]
  aplicarProduto(l, montarGrafo({ arestas: ar, hoje: HOJE, P }), { L, ligado: true })
  assert.equal(l[0].produto.estoque_ef, 3); assert.equal(l[0].cobertura, 6, 'sem leitura: o teto (3 un ÷ 0,5/dia)'); assert.ok(l[0].produto.premissas.some(t => /teto, premissa/.test(t)))
  assert.equal(l[0].produto.estoque, null, 'teto sem leitura NÃO entra no estoque do produto (pode conter o próprio)')
  const ar2 = [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', estoque: 3, lido_em: T })]
  const l2 = [it('MLB1', { logistica: 'fulfillment', u: 14, r: 700, vel_dia: 0.5, estoque: 3, cobertura: 6 })], g2 = montarGrafo({ arestas: ar2, fullEstoque: [{ inventory_id: 'I1', disponivel: 6, dia: D(-2) }], hoje: HOJE, P })
  aplicarProduto(l2, g2, { L, ligado: true })
  assert.deepEqual([l2[0].produto.estoque_ef, l2[0].cobertura, l2[0].produto.estoque], [3, 6, 3], 'Full lido há 2 d com 6 e anúncio hoje com 3: vale 3')
  const l3 = [it('MLB1', { logistica: 'fulfillment', u: 14, r: 700, vel_dia: 0.5, estoque: 3, cobertura: 6 })]; aplicarProduto(l3, montarGrafo({ arestas: ar2, fullEstoque: [{ inventory_id: 'I1', disponivel: 6, dia: D(-2) }], hoje: HOJE, P }), { L, ligado: false })
  assert.equal(l3[0].cobertura, 6); assert.equal(l3[0].produto.estoque_ef, 6, 'desligado (sombra da F2): o grafo não muda')
})

await ok('revisão F3 · Full zerado com o anúncio vendendo pelo Flex: receita em risco conta da cobertura do número do anúncio (396 un → R$ 0, hipótese honesta; 15 un → só os dias depois que o próprio acaba)', () => {
  const mk = est => { const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', logistica: 'fulfillment', inventory_id: 'I1', flex: 1, estoque: est })], fullEstoque: [{ inventory_id: 'I1', disponivel: 0, dia: HOJE }], hoje: HOJE, P })
    const l = [it('MLB1', { logistica: 'fulfillment', u: 56, r: 2800, vel_dia: 2, estoque: est, cobertura: Math.round(est / 2) })]; aplicarProduto(l, g, { L, ligado: true }); return l }
  const [a] = mk(396); assert.equal(a.cobertura, 0); const k = riscoRuptura(a, L); assert.deepEqual([k.dias, k.risco, k.segue_flex], [0, 0, true])
  const acao = montarAcoes('__f3__', diagDe([a]), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(acao.previsao.cenarios.base.receita, 0); assert.match(acao.dados.hipotese, /segue vendendo pelo Flex do estoque próprio enquanto o Full está com 0 un: sem receita em risco estimada/)
  assert.deepEqual(acao.dados.causas_possiveis.map(c => c.causa), ['enviar_full'])
  const [b] = mk(15); const kb = riscoRuptura(b, L); assert.equal(kb.dias, Math.max(0, LEAD - Math.round(15 / 2)), 'dias sem vender a partir da cobertura do anúncio (15 ÷ 2/dia)'); assert.ok(!kb.segue_flex)
  assert.equal(riscoRuptura(it('MLB9', { cobertura: 0, estoque: 396 }), L).dias, LEAD, 'sem produto: a fórmula de sempre')
})

await ok('revisão F3 · sinal DISPONIBILIDADE (objeção de conversão) usa o número que o comprador vê (cobertura do anúncio), não o Full zerado', () => {
  const i = it('MLB1', { cobertura: 0, cobertura_anuncio: 600, conv: 1, v: 3000 }), j = it('MLB2', { cobertura: 1, conv: 1, v: 3000 })
  const acs = montarAcoes('__f3__', diagDe([i, j], { benchmark: { conv: 9.3 } }), { hoje: HOJE }).filter(x => x.regra === 'anuncio_ima_conversao')
  const sinal = id => JSON.stringify(acs.find(x => x.item_id === id)?.dados || {})
  assert.ok(!/DISPONIBILIDADE/.test(sinal('MLB1')), 'Full 0 com 600 un no anúncio: sem objeção de disponibilidade')
  assert.ok(acs.some(x => x.item_id === 'MLB1')); assert.match(sinal('MLB2'), /DISPONIBILIDADE/, 'sem produto: o número de sempre')
})

await ok('revisão F3 · sku_ausente não nasce de anúncio sem a coleta da F1 (SKU não lido ≠ sem SKU)', () => {
  const g = montarGrafo({ arestas: [A('MLB1', { estoque: 100, sku_fonte: 'sem_aresta' }), A('MLB2', { estoque: 100, sku: 'OK', sku_fonte: 'seller_sku' })], hoje: HOJE, P })
  const l = [it('MLB1', { r: 3000 }), it('MLB2', { r: 7000 })]; aplicarProduto(l, g, { L, ligado: true })
  assert.equal(l[0].produto.chaves_lidas, false); assert.equal(l[1].produto.chaves_lidas, true)
  assert.ok(!montarAcoes('__f3__', diagDe(l), { hoje: HOJE }).some(x => x.regra === 'anuncio_sku_ausente'))
})

await ok('revisão F3 · pendência estoque_curva_a com o produto: 1 linha por estoque físico (irmão fora), receita e risco do estoque inteiro pela fórmula única (Flex que segue vendendo = R$ 0)', () => {
  const cat = catalogoReal(), h = new Database(':memory:')
  h.exec('CREATE TABLE pendencia_cliente (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT, canal TEXT, item TEXT, detalhe TEXT DEFAULT "", desde TEXT DEFAULT "", evidencia TEXT DEFAULT "", gravidade TEXT DEFAULT "", por TEXT, criada_em TEXT, resolvida_em TEXT DEFAULT "", resolvida_por TEXT DEFAULT "", nota TEXT DEFAULT "")')
  const NM = { MLB1: 'Guia Unificada Preta', MLB2: 'Guia Unificada Preta Catálogo', MLB3: 'Coleira Peitoral Rock' }, base = (id, o) => ({ id, titulo: NM[id], curva: 'A', status: 'active', estoque: 6, cobertura: 3, u: 28, r: 1400, fotos: 8, catalogo: false, custo_unitario: 1, lead_time_dias: 21, lead_time_fonte: 'cliente', atualizado_em: T, ...o })
  const pr = (rep, o = {}) => ({ ligado: true, local: 'proprio', representa_estoque: rep, u_ef: 56, r_ef: 2800, vel_ef: 2, ...o })
  const itens = [base('MLB1', { produto: pr(true) }), base('MLB2', { produto: pr(false) }), base('MLB3', { estoque: 396, cobertura: 0, produto: pr(true, { local: 'full', u_ef: 28, r_ef: 1400, vel_ef: 1 }) })]
  const p = criarPendencias({ handle: h, dependencias: { listar: () => [] }, riscoEstoque: () => ({ itens, atualizado_em: T, janela_dias: 28, lead_time_dias: 21, fotos_minimas: 6, custos_conta_informados: true }), contasMl: () => null, acoesPlano: null, visiveis: null, hoje: () => HOJE, agora: () => T, catalogo: cat, auditar: auditarTexto })
  const e = p.avaliar('Acme').itens.find(x => x.item === 'estoque_curva_a')
  assert.deepEqual(e.produtos, ['Guia Unificada Preta', 'Coleira Peitoral Rock'], 'o irmão (MLB2) não repete o produto')
  assert.equal(e.impacto.valor_brl, Math.round(2800 / 28 * (21 - 3)), 'R$ do EF inteiro (r_ef) só no que fica sem vender; o Full zerado com 396 un no anúncio soma 0')
})

console.log(`✔ teste-produto-diagnostico: ${n} casos (V3 F3 atrás da chave produto.diagnostico_ligado, que segue DESLIGADA no config)`)
