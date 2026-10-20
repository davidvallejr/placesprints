// V3 F5 — duplicação ciente do estoque + kits (docs/desenho-v3-produto-estoque-financeiro.md § 6, § 3.6, § 9 F5). Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports);
// nenhuma chamada ao ML (API falsa injetada). Cobre: alocarEstoque (Σ = total, Full fora, piso de rateio, teto), cobertura projetada, trava da duplicação (EF em ruptura não
// nasce → omitidas.estoque_nao_comporta), cobertura projetada/teto/divisão na ação, chave DESLIGADA = duplicação idêntica, validarProposta/criarAnuncio barram
// estoque_acima_do_fisico (sem físico: live pendente), quantidade proposta pelo UP esperado, conferência mesmo UP/UP novo, família pelo produto (acharFilhos), kits
// (virtual q × vendas no componente e sem ruptura do kit; montado na hora não soma; pré-montado soma na compra; sem modo = recusa; Kit Virtual lido só com tag bundle e teto).
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
const { db, hojeLocal, getEstado } = await import('../src/lib/db.js')
const { addDias } = await import('../src/lib/meli-serie.js')
const { algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { montarGrafo, aplicarProduto, alocarEstoque, coberturaProjetada, validarEstoqueFisico, rotuloUpDuplicata, representaEstoque, representaProduto, pseudoProdutos } = await import('../src/lib/produto-estoque.js')
const { montarAcoes } = await import('../src/lib/plano-anuncios.js')
const { validarProposta, quantidadeDuplicata, criarAdaptadorML } = await import('../src/lib/ofertas-ml.js')
const { acharFilhos } = await import('../src/lib/duplicacao.js')
const R = await import('../src/lib/produto-estoque-real.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = hojeLocal(), D = k => addDias(HOJE, k), T = `${HOJE}T05:00:00.000Z`
const L = algoritmo.limiares, P = algoritmo.produto
const A = (item_id, o = {}) => ({ item_id, variacao_id: '', user_product_id: '', inventory_id: '', sku: '', sku_fonte: '', catalogo_produto_id: '', estoque: null, logistica: 'xd_drop_off', flex: 0, tags: '', status: 'active', lido_em: T, titulo: `Produto ${item_id}`, ...o })
const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, permalink: `https://produto.mercadolivre.com.br/MLB-${id.slice(3)}-x-_JM`, status: 'active', curva: 'A', u: 28, r: 1400, u0: 28, r0: 1400, v: 300, v0: 300, visOk: true, conv: 9.3, preco: 50, estoque: 100, vel_dia: 1, cobertura: 100, ponto_reposicao: 28, lead_time_dias: L.lead_time_reposicao_dias, lead_time_fonte: 'premissa', fotos: 8, frete_gratis: true, catalogo: false, ads: null, ads_ant: null, logistica: 'xd_drop_off', ...o })
function diagDe(itens) {
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: '__f5__', hoje: HOJE, periodo: { de: D(-28), ate: D(-1), anterior: { de: D(-56), ate: D(-29) } }, resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, conversao_conta: null, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: null, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, clicks: 0, prints: 0, anterior: { roas: null } }, economia: null, custos_informados: true, itens, janelas: [], pendencias: [], algoritmo_versao: algoritmo.versao, vendas_dia_sem_mudanca: {}, data_quality: { cobertura: { pedidos: { lacunas: [], truncados: 0 } } } }
}

await ok('alocarEstoque: 40 com vendas 3/1 → 30/10; 3 em 4 pools → Σ 3 sem negativo; Full fora; piso de 1 só com total ≥ nº de pools; teto por pool; Σ nunca passa do total', () => {
  assert.deepEqual(alocarEstoque(40, [{ chave: 'a', v: 3 }, { chave: 'b', v: 1 }]).map(x => x.quantidade), [30, 10])
  const q3 = alocarEstoque(3, ['p1', 'p2', 'p3', 'p4'].map(c => ({ chave: c, v: 1 }))); assert.equal(q3.reduce((t, x) => t + x.quantidade, 0), 3); assert.ok(q3.every(x => x.quantidade >= 0))
  assert.deepEqual(alocarEstoque(10, [{ chave: 'a', v: 1 }, { chave: 'f', v: 9, local: 'full' }]), [{ chave: 'a', quantidade: 10 }], 'Full nunca recebe')
  assert.deepEqual(alocarEstoque(10, [{ chave: 'a', v: 9 }, { chave: 'b', v: 0 }]).map(x => x.quantidade), [9, 1], 'piso de rateio: quem não vende recebe 1 do mais cheio')
  assert.deepEqual(alocarEstoque(10, [{ chave: 'a', v: 9, max: 4 }, { chave: 'b', v: 1, max: 3 }]).map(x => x.quantidade), [4, 3], 'todos no teto: Σ < total, nunca acima')
  assert.deepEqual(alocarEstoque(0, [{ chave: 'a', v: 1 }]).map(x => x.quantidade), [0]); assert.deepEqual(alocarEstoque(5, [{ chave: 'a', v: 0 }, { chave: 'b', v: 0 }]).map(x => x.quantidade), [3, 2], 'sem venda: partes iguais')
  for (let k = 0; k < 50; k++) { const T0 = k * 7 % 53, ps = [1, 2, 3].map(j => ({ chave: 'p' + j, v: (k * j) % 5 })); assert.equal(alocarEstoque(T0, ps).reduce((t, x) => t + x.quantidade, 0), T0, 'Σ = total') }
})

await ok('cobertura projetada (E 40, v 4, extra 1 → 8 d) e trava do físico (validarEstoqueFisico): acima → estoque_acima_do_fisico; sem físico → estoque_fisico; motivos fixos', () => {
  assert.equal(coberturaProjetada(40, 4, 1), 8); assert.equal(coberturaProjetada(null, 4, 1), null); assert.equal(coberturaProjetada(10, 0, 0), null)
  assert.deepEqual(validarEstoqueFisico({ quantidade: 14, fisico: 40, outros: 26 }), { ok: true, motivo: '' })
  assert.deepEqual(validarEstoqueFisico({ quantidade: 15, fisico: 40, outros: 26 }), { ok: false, motivo: 'estoque_acima_do_fisico' })
  assert.deepEqual(validarEstoqueFisico({ quantidade: 5, fisico: null }), { ok: false, motivo: 'estoque_fisico' })
  assert.equal(validarEstoqueFisico({ quantidade: -1, fisico: 9 }).motivo, 'quantidade_invalida')
})

// G4 (curva A com queda): gatilho de duplicação que nasce de dado
const g4 = o => it('MLB1', { u: 28, r: 1000, r0: 2000, u0: 50, v: 270, v0: 300, ...o })
const grafoDup = estoque => montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque, sku: 'COL-M', sku_fonte: 'seller_sku' }), A('MLB2', { user_product_id: 'MLBU2', estoque: estoque === 40 ? 40 : estoque, sku: 'COL-M', sku_fonte: 'seller_sku' })], hoje: HOJE, P })

await ok('duplicação com o produto ligado: EF do original em ruptura → a ação NÃO nasce (omitidas.estoque_nao_comporta); com folga → evidência com cobertura projetada, teto da previsão e divisão sugerida (Σ = físico)', () => {
  const l = [g4({ estoque: 3 }), it('MLB2', { u: 2, r: 60, curva: 'C', estoque: 3 })]; aplicarProduto(l, grafoDup(3), { L, ligado: true })
  const a = montarAcoes('__f5__', diagDe(l), { hoje: HOJE })
  assert.ok(!a.some(x => x.regra === 'anuncio_duplicacao_estrategica'), 'sem estoque não se duplica'); assert.equal(a.omitidas.estoque_nao_comporta, 1)
  const l2 = [g4({ estoque: 40 }), it('MLB2', { u: 2, r: 60, curva: 'C', estoque: 40 })]; aplicarProduto(l2, grafoDup(40), { L, ligado: true })
  const d = montarAcoes('__f5__', diagDe(l2), { hoje: HOJE }).find(x => x.regra === 'anuncio_duplicacao_estrategica')
  assert.ok(d, 'com estoque a ação nasce'); const e = d.dados.estoque_duplicata
  assert.equal(e.estoque, 40, 'espelho: 40 contado uma vez'); assert.equal(e.cobertura, 37, '40 ÷ (30/28)')
  assert.ok(e.cobertura_pos < e.cobertura, 'com a duplicata vendendo, cobre menos dias'); assert.match(d.dados.evidencia, /A duplicata vende do mesmo estoque do produto: hoje 40 un para ~37 dias; com a duplicata vendendo o previsto, ~\d+ dias/)
  assert.equal(e.divisao.reduce((t, x) => t + x, 0), 40, 'divisão sugerida: Σ = físico'); assert.match(d.dados.evidencia, /divisão sugerida: \d+ \/ \d+/)
  assert.ok(d.previsao.premissas.some(p => /não soma estoque/.test(p)), 'premissa: estoque compartilhado')
  assert.ok(d.previsao.cenarios.otimista.unidades <= e.teto_unidades + 0.05, 'teto: ganho que não cabe no estoque não é ganho')
  assert.equal(e.fisico_fonte, 'ml'); assert.equal(quantidadeDuplicata(e).estoque_contexto.fisico, null, 'físico do ML não vale para a trava: só o informado')
})

await ok('duplicação com a chave DESLIGADA: a mesma ação de antes (sem estoque_duplicata, sem omissão nova); cobertura curta pede «programar a reposição junto»', () => {
  const sem = montarAcoes('__f5__', diagDe([g4({ estoque: 3, cobertura: 3 })]), { hoje: HOJE })
  const d0 = sem.find(x => x.regra === 'anuncio_duplicacao_estrategica'); assert.ok(d0, 'sem produto a regra não lê estoque'); assert.equal(d0.dados.estoque_duplicata, undefined); assert.equal(sem.omitidas.estoque_nao_comporta, undefined)
  const l = [g4({ estoque: 31 }), it('MLB2', { u: 2, r: 60, curva: 'C', estoque: 31 })]; aplicarProduto(l, grafoDup(31), { L, ligado: true })
  const d = montarAcoes('__f5__', diagDe(l), { hoje: HOJE }).find(x => x.regra === 'anuncio_duplicacao_estrategica')
  if (d.dados.estoque_duplicata.repor_junto) assert.ok(d.dados.como.some(c => /reposição junto/.test(c)))
  else assert.ok(d.dados.estoque_duplicata.cobertura_pos >= L.lead_time_reposicao_dias + L.estoque_seguranca_dias)
})

await ok('validarProposta barra estoque_acima_do_fisico (mensagem fixa); sem físico = pendência (live espera); quantidade proposta pelo UP esperado; conferência mesmo UP / UP novo / contado 2×', () => {
  const cap = { pode: { titulo: true, preco: true } }
  const v1 = validarProposta(cap, { titulo: 'Coleira M nova', estoque: 15, estoque_contexto: { fisico: 40, outros: 26 } }, 'titulo_descricao')
  assert.equal(v1.ok, false); assert.ok(v1.bloqueios.some(b => b.tipo === 'estoque_acima_do_fisico' && !/15|40|26/.test(b.motivo)), 'motivo fixo, sem eco')
  const v2 = validarProposta(cap, { titulo: 'Coleira M nova', estoque: 14, estoque_contexto: { fisico: 40, outros: 26 } }, 'titulo_descricao'); assert.equal(v2.ok, true)
  const v3 = validarProposta(cap, { titulo: 'Coleira M nova', estoque: 14, estoque_contexto: { fisico: null, outros: 26 } }, 'titulo_descricao'); assert.ok(v3.pendencias.some(p => /estoque físico/.test(p)))
  const v4 = validarProposta(cap, { titulo: 'Coleira M nova' }, 'titulo_descricao'); assert.equal(v4.ok, true, 'sem contexto (não é duplicata): nada muda'); assert.equal(v4.pendencias.length, 0)
  const est = { quantidade_proposta: { mesmo_up: 40, up_novo: 14 }, fisico: 40, fisico_fonte: 'declarado', outros_proprios: 26 }
  assert.deepEqual(quantidadeDuplicata(est, { titulo_ou_capa_novos: false }), { espera: 'mesmo_up', quantidade: 40, estoque_contexto: null })
  assert.deepEqual(quantidadeDuplicata(est), { espera: 'up_novo', quantidade: 14, estoque_contexto: { fisico: 40, outros: 26 } })
  assert.equal(rotuloUpDuplicata({ upOriginal: 'MLBU1', upNovo: 'MLBU1' }).rotulo, 'divide_pelo_ml'); assert.equal(rotuloUpDuplicata({ upOriginal: 'MLBU1', upNovo: 'MLBU9' }).rotulo, 'estoque_separado')
  assert.equal(rotuloUpDuplicata({ upOriginal: 'MLBU1', upNovo: 'MLBU9', espera: 'mesmo_up' }).pendencia, true); assert.equal(rotuloUpDuplicata({ upOriginal: 'MLBU1', upNovo: '' }), null, 'sem UP lido: nunca supor')
})

await ok('criarAnuncio (duplicata em UP novo): acima do físico = rejeitado antes de qualquer chamada; sem físico = dry-run livre e live pendente estoque_fisico; nenhum POST', async () => {
  const chamadas = []
  const a = criarAdaptadorML({ fetch: async (url, o = {}) => { chamadas.push(`${o.method || 'GET'} ${url}`); return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' } }, tokenValido: async () => 'tk', conta: () => ({ meli_user_id: '1' }) })
  const cap = { pode: { criar: true }, observacoes: [] }
  const base = { titulo: 'Coleira M', categoria_id: 'MLB1', preco: 50, sku: 'COL-M', galeria: [{ url: 'https://http2.mlstatic.com/x.jpg' }] }
  const r1 = await a.criarAnuncio('C', { ...base, estoque: 15, estoque_contexto: { fisico: 40, outros: 26 } }, { live: true, chave_idem: 'k', capacidades: cap })
  assert.deepEqual([r1.estado, r1.motivo], ['rejeitado', 'estoque_acima_do_fisico'])
  const r2 = await a.criarAnuncio('C', { ...base, estoque: 14, estoque_contexto: { fisico: null, outros: 26 } }, { capacidades: cap }); assert.equal(r2.estado, 'dry_run', 'dry-run segue livre'); assert.equal(r2.payload.estoque_contexto, undefined, 'o contexto nunca vai no corpo')
  const r3 = await a.criarAnuncio('C', { ...base, estoque: 14, estoque_contexto: { fisico: null, outros: 26 } }, { live: true, chave_idem: 'k', capacidades: cap }); assert.deepEqual([r3.estado, r3.motivo], ['pendente_dados', 'estoque_fisico'])
  assert.equal(chamadas.filter(c => c.startsWith('POST')).length, 0, 'nenhum POST no ML')
})

await ok('família pelo PRODUTO: a duplicata com título bem diferente vira filho por fato (fonte produto, similaridade 1); sem produtoDe a saída é a de sempre (título)', () => {
  const originais = [{ item_id: 'MLB1', titulo: 'Coleira Peitoral Cachorro Médio Ajustável Nylon' }]
  const candidatos = [...originais, { item_id: 'MLB7', titulo: 'Guia Passeio Pet Resistente Conforto', criado_em: D(-5), preco: 40 }, { item_id: 'MLB8', titulo: 'Coleira Peitoral Cachorro Médio Ajustável Premium', criado_em: D(-5), preco: 45 }]
  const sem = acharFilhos({ originais, candidatos, data: D(-6) })
  assert.ok(!sem.some(f => f.item_id === 'MLB7'), 'pelo título, MLB7 não parece filho'); assert.ok(sem.every(f => f.fonte === undefined), 'saída de sempre')
  const com = acharFilhos({ originais, candidatos, data: D(-6), produtoDe: new Map([['MLB1', 'sku:col-m'], ['MLB7', 'sku:col-m'], ['MLB8', 'sku:outro']]) })
  const f7 = com.find(f => f.item_id === 'MLB7'); assert.ok(f7, 'mesmo produto = filho'); assert.deepEqual([f7.fonte, f7.similaridade, f7.original], ['produto', 1, 'MLB1'])
  assert.ok(com.some(f => f.item_id === 'MLB8' && f.fonte === undefined), 'título como reserva para o resto')
})

await ok('Kit Virtual q = 2 com 5 vendidos → +10 un na demanda do componente; o kit não é estoque físico (estoque = componente ÷ 2) e não gera ruptura nem linha de compra', () => {
  const kits = [{ kit: 'up:MLBU9', componente: 'sku:casc', quantidade: 2, modo: 'kit_virtual', fonte: 'ml_bundle' }]
  const g = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 30, sku: 'CASC', sku_fonte: 'seller_sku' }), A('MLB9', { user_product_id: 'MLBU9', estoque: 15, tags: 'bundle', titulo: 'Cascos Kit 2un' })], kits, hoje: HOJE, P })
  const l = [it('MLB1', { u: 28, r: 1400, estoque: 30 }), it('MLB9', { u: 5, r: 400, estoque: 15 })]; aplicarProduto(l, g, { L, ligado: true })
  const [c, k] = l
  assert.equal(c.produto.u_ef, 28 + 10, 'venda do kit × 2 entra no componente'); assert.equal(c.produto.r_ef, 1800, 'a receita do kit fica em risco junto')
  assert.equal(k.produto.estoque_ef, 15, 'estoque do kit = mín(30 ÷ 2)'); assert.ok(!representaEstoque(k) && !representaProduto(k), 'o kit não fala de estoque nem de compra')
  assert.equal(k.produto.kit.modo, 'kit_virtual'); assert.equal(pseudoProdutos(l).length, 1, '1 linha de compra: a do componente')
  const l2 = [it('MLB1', { u: 28, r: 1400, estoque: 2, cobertura: 2 }), it('MLB9', { u: 5, r: 400, estoque: 1, cobertura: 1 })]
  const g2 = montarGrafo({ arestas: [A('MLB1', { user_product_id: 'MLBU1', estoque: 2, sku: 'CASC', sku_fonte: 'seller_sku' }), A('MLB9', { user_product_id: 'MLBU9', estoque: 1, tags: 'bundle' })], kits, hoje: HOJE, P }); aplicarProduto(l2, g2, { L, ligado: true })
  const rup = montarAcoes('__f5__', diagDe(l2), { hoje: HOJE }).filter(x => x.regra === 'anuncio_estoque_ruptura')
  assert.deepEqual(rup.map(x => x.item_id), ['MLB1'], 'só o componente tem ação de ruptura')
})

await ok('montado na hora não soma estoque (o kit não é EF); pré-montado é EF próprio e soma na COMPRA (E_equiv = E_c + E_kit × q); composição que não resolve vira aviso', () => {
  const ar = [A('MLB1', { user_product_id: 'MLBU1', estoque: 30, sku: 'CASC', sku_fonte: 'seller_sku' }), A('MLB9', { user_product_id: 'MLBU9', estoque: 4, titulo: 'Cascos Kit 3un' })]
  const mh = montarGrafo({ arestas: ar, kits: [{ kit: 'up:MLBU9', componente: 'sku:casc', quantidade: 3, modo: 'montado_na_hora', fonte: 'declarado' }], hoje: HOJE, P })
  const l = [it('MLB1', { u: 28, estoque: 30 }), it('MLB9', { u: 6, r: 300, estoque: 4 })]; aplicarProduto(l, mh, { L, ligado: true })
  assert.equal(l[0].produto.estoque, 30, 'componente: o kit montado na hora não soma'); assert.equal(l[1].produto.estoque_ef, 10, 'kit = 30 ÷ 3'); assert.equal(l[0].produto.u_ef, 28 + 18)
  const pm = montarGrafo({ arestas: ar, kits: [{ kit: 'up:MLBU9', componente: 'sku:casc', quantidade: 3, modo: 'pre_montado', fonte: 'declarado' }], hoje: HOJE, P })
  const l2 = [it('MLB1', { u: 28, estoque: 30 }), it('MLB9', { u: 6, r: 300, estoque: 4 })]; aplicarProduto(l2, pm, { L, ligado: true })
  assert.equal(l2[0].produto.estoque, 30 + 4 * 3, 'compra do componente conta as caixas montadas'); assert.equal(l2[0].produto.estoque_ef, 30, 'o EF do componente não muda'); assert.equal(l2[1].produto.estoque_ef, 4, 'pré-montado = EF próprio')
  assert.ok(representaEstoque(l2[1]), 'a ruptura do pré-montado é «montar kits»')
  const sem = montarGrafo({ arestas: ar, kits: [{ kit: 'up:MLBU9', componente: 'sku:naoexiste', quantidade: 2, modo: 'montado_na_hora', fonte: 'declarado' }], hoje: HOJE, P })
  assert.ok(sem.avisos.some(a => /componente de kit não encontrado/.test(a))); assert.equal(sem.produtos.find(p => p.chave === 'up:MLBU9').kit, undefined, 'não resolve = não conta')
})

await ok('composição declarada (criarKit): sem modo = recusa; prévia não grava; confirmar exige por; Kit Virtual do ML não é sobrescrito; CHECK do banco barra modo inválido', () => {
  const C = 'Cliente F5'
  db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, status, atualizado_em) VALUES (?,?,?,?,?)").run(C, 'MLB1', 'Cascos Luva', 'active', T)
  db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, status, atualizado_em) VALUES (?,?,?,?,?)").run(C, 'MLB9', 'Cascos Luva Kit 3un', 'active', T)
  const ins = db.prepare('INSERT INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, sku, sku_fonte, estoque, logistica, tags, status, lido_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  ins.run(C, 'MLB1', '', 'MLBU1', 'CASC', 'seller_sku', 30, 'xd_drop_off', '', 'active', T); ins.run(C, 'MLB9', '', 'MLBU9', '', '', 4, 'xd_drop_off', '', 'active', T)
  const k = R.criarKit({ validarPor: n0 => (n0 === 'Líder X' ? 'Líder X' : '') })
  assert.throws(() => k.salvar({ cliente: C, kit: 'up:MLBU9', componentes: [{ chave: 'sku:casc', quantidade: 3 }] }), /modo do kit/)
  const pv = k.salvar({ cliente: C, kit: 'up:MLBU9', componentes: [{ chave: 'sku:casc', quantidade: 3 }], modo: 'montado_na_hora' })
  assert.equal(pv.previa, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM kit_componente').get().n, 0, 'prévia não grava')
  assert.throws(() => k.salvar({ cliente: C, kit: 'up:MLBU9', componentes: [{ chave: 'sku:casc', quantidade: 3 }], modo: 'montado_na_hora', confirmar: true, por: 'Fulano' }), e => e.status === 403)
  const g = k.salvar({ cliente: C, kit: 'up:MLBU9', componentes: [{ chave: 'sku:casc', quantidade: 3 }], modo: 'montado_na_hora', confirmar: true, por: 'Líder X' })
  assert.equal(g.previa, false); assert.equal(db.prepare("SELECT modo FROM kit_componente WHERE cliente = ?").get(C).modo, 'montado_na_hora')
  const lista = R.kitsDoCliente(C); assert.equal(lista.compostos.length, 1); assert.equal(lista.compostos[0].kit, 'up:MLBU9')
  assert.throws(() => db.prepare("INSERT INTO kit_componente (cliente, kit, componente, quantidade, modo, fonte, em) VALUES (?,?,?,?,?,?,?)").run(C, 'up:MLBU1', 'sku:x', 1, 'qualquer', 'declarado', T), /CHECK/)
  db.prepare("INSERT INTO kit_componente (cliente, kit, componente, quantidade, modo, fonte, em) VALUES (?,?,?,?,?,?,?)").run(C, 'item:MLB1', 'up:MLBU9', 1, 'kit_virtual', 'ml_bundle', T)
  assert.throws(() => k.salvar({ cliente: C, kit: 'item:MLB1', componentes: [{ chave: 'up:MLBU9', quantidade: 1 }], modo: 'pre_montado' }), e => e.status === 409 || /origem|não encontrado/.test(e.message))
})

await ok('Kit Virtual lido do ML: GET /items/{id} SÓ dos anúncios com a tag bundle, teto por coleta, falha não apaga a composição; relido só depois de 7 dias', async () => {
  const C = 'Cliente Bundle', ins = db.prepare('INSERT INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, estoque, logistica, tags, status, lido_em) VALUES (?,?,?,?,?,?,?,?,?)')
  ins.run(C, 'MLB50', '', 'MLBU50', 5, 'xd_drop_off', 'bundle', 'active', T); ins.run(C, 'MLB51', '', 'MLBU51', 5, 'xd_drop_off', 'bundle', 'active', T); ins.run(C, 'MLB52', '', 'MLBU52', 5, 'xd_drop_off', '', 'active', T)
  const chamados = []
  const api = async (_c, caminho) => { chamados.push(caminho); return caminho.endsWith('MLB50') ? { id: 'MLB50', bundle: { components: [{ type: 'user_product', user_product_id: 'MLBU7', quantity: 2 }, { type: 'user_product', user_product_id: 'MLBU8', quantity: 1 }] } } : { _erro: true, status: 500 } }
  const r = await R.lerKitsVirtuais(C, { chamarFn: api, pausaMs: 0, teto: 5 })
  assert.deepEqual(chamados.sort(), ['/items/MLB50', '/items/MLB51'], 'só os da tag bundle'); assert.deepEqual([r.lidos, r.falhas], [1, 1])
  assert.deepEqual(db.prepare("SELECT componente, quantidade, modo, fonte FROM kit_componente WHERE cliente = ? ORDER BY componente").all(C), [{ componente: 'up:MLBU7', quantidade: 2, modo: 'kit_virtual', fonte: 'ml_bundle' }, { componente: 'up:MLBU8', quantidade: 1, modo: 'kit_virtual', fonte: 'ml_bundle' }])
  chamados.length = 0; await R.lerKitsVirtuais(C, { chamarFn: api, pausaMs: 0, teto: 5 }); assert.deepEqual(chamados, ['/items/MLB51'], 'o já lido espera 7 dias; a falha tenta de novo')
  chamados.length = 0; await R.lerKitsVirtuais(C, { chamarFn: api, pausaMs: 0, teto: 0 }); assert.equal(chamados.length, 0, 'teto 0 = nenhuma chamada')
  assert.ok(getEstado(`bundle_lido:${C}`).includes('MLB50'))
})

console.log(`✔ teste-produto-f5: ${n} casos (V3 F5 atrás da chave produto.diagnostico_ligado, que segue DESLIGADA no config)`)
