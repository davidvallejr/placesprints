// Chaveiro F4+ — console de execução de estratégias (src/lib/chaveiro-executor(-real).js, src/rotas-chaveiro-executor.js). Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos
// imports); a API do ML é SEMPRE um stub injetado (nenhuma chamada real). Cobre: cada operação (payload fechado, «antes» tocado, travas da operação, conferência, reversão),
// catálogo bloqueado, teto e piso de preço, sem custo = decisão do cliente, nunca closed/DELETE, automação de preço, 2xx ≠ feito, releitura divergente bloqueia, travas
// (chave global, chave da operação, liberação, estreia, teto, confirmar, hash, kill switch), estratégias (sequência, pré-condição, parada no meio), Neo com veto, duplicação
// (F5), promoção delegada, prévia sem escrita, aprovação só do líder, isolamento e rotas sem eco.
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db, agora, hojeLocal } = await import('../src/lib/db.js')
const X = await import('../src/lib/chaveiro-executor.js')
const R = await import('../src/lib/chaveiro-executor-real.js')
const { criarRotasChaveiroExecutor } = await import('../src/rotas-chaveiro-executor.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')
assert.equal(X.CFG.execucao_ligada, false, 'a chave global NASCE desligada no config')
assert.ok(Object.entries(X.CFG.adaptadores_live).filter(([k]) => k !== '$doc').every(([, v]) => v === false), 'toda operação NASCE desligada no config')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const C = 'Loja Exec', OUTRO = 'Outra Loja', LIDER = 'Lia Lider', LIGADO = { ...X.CFG, execucao_ligada: true, adaptadores_live: Object.fromEntries(X.OPS_EXECUTAVEIS.map(k => [k, true])) }
db.prepare("INSERT INTO prestadores (nome, nome_norm, cargo, atualizado_em) VALUES (?, ?, 'Líder de squad', ?)").run(LIDER, 'lia lider', agora())
db.prepare("INSERT INTO prestadores (nome, nome_norm, cargo, atualizado_em) VALUES ('Ana Analista', 'ana analista', 'Analista', ?)").run(agora())

// anúncio base (formato do GET /items/{id}) — o stub guarda o estado VIVO
const base = (id, extra = {}) => ({ id, title: 'Coleira Azul M', price: 100, status: 'active', sub_status: [], sold_quantity: 0, catalog_listing: false, category_id: 'MLB1', listing_type_id: 'gold_special', condition: 'new',
  pictures: [{ id: 'P1A' }, { id: 'P2B' }, { id: 'P3C' }], attributes: [{ id: 'COLOR', value_name: 'Azul' }, { id: 'SELLER_SKU', value_name: 'COL-M' }, { id: 'MATERIAL', value_name: 'Nylon' }],
  variations: [], shipping: { free_shipping: false, mode: 'me2', tags: [] }, ...extra })
function semear(cliente, itens) {
  for (const it of itens) {
    db.prepare('INSERT OR REPLACE INTO meli_item (cliente, item_id, titulo, preco, status, vendidos, fotos, frete_gratis, catalogo, tipo_anuncio, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(cliente, it.id, it.title, it.price, it.status, it.sold_quantity, it.pictures.length, it.shipping.free_shipping ? 1 : 0, it.catalog_listing ? 1 : 0, it.listing_type_id, agora())
    db.prepare(`INSERT OR REPLACE INTO meli_item_snapshot (cliente, item_id, hash, capturado_em, origem, titulo, preco, status, categoria, tipo_anuncio, fotos_json, atributos_json, variacoes_json, frete_json, descricao, descricao_hash)
      VALUES (?,?,?,?,'coleta',?,?,?,?,?,?,?,?,?,?,?)`).run(cliente, it.id, 'aaaaaaaaaaaaaaaa', new Date(Date.now() - 86_400_000).toISOString(), it.title, it.price, it.status, it.category_id, it.listing_type_id,
      JSON.stringify(it.pictures.map(p => p.id)), JSON.stringify(Object.fromEntries(it.attributes.map(a => [a.id, a.value_name]))), JSON.stringify(it.variations.map(v => ({ id: v.id, preco: v.price, picture_ids: [] }))), JSON.stringify({ free_shipping: it.shipping.free_shipping ? 1 : 0, mode: 'me2' }), 'Coleira azul de nylon', 'h')
  }
}
const ITENS = { MLB1001: base('MLB1001'), MLB1002: base('MLB1002', { title: 'Coleira Azul G' }), MLB1003: base('MLB1003', { catalog_listing: true }), MLB1004: base('MLB1004', { variations: [{ id: 11, price: 50 }, { id: 12, price: 60 }] }) }
semear(C, Object.values(ITENS))
semear(OUTRO, [base('MLB9001')])

// stub do ML: estado vivo por anúncio; registra TODA chamada; nunca tem DELETE
function stubML({ itens = ITENS, naoAplica = false, falhaPut = {}, automacao = {}, descricoes = {} } = {}) {
  const vivo = JSON.parse(JSON.stringify(itens)), desc = { ...descricoes }, chamadas = []
  const aplicar = (id, corpo) => {
    if (naoAplica) return
    const it = vivo[id]
    if (corpo.price != null) it.price = corpo.price
    if (corpo.variations) for (const v of corpo.variations) { const w = it.variations.find(x => x.id === v.id); if (w && v.price != null) w.price = v.price }
    if (corpo.status) it.status = corpo.status
    if (corpo.title) it.title = corpo.title
    if (corpo.pictures) it.pictures = corpo.pictures.map(p => ({ id: p.id }))
    if (corpo.attributes) for (const a of corpo.attributes) { const b = it.attributes.find(x => x.id === a.id); if (b) b.value_name = a.value_name; else it.attributes.push({ id: a.id, value_name: a.value_name }) }
    if (corpo.shipping) it.shipping.free_shipping = corpo.shipping.free_shipping
  }
  return { chamadas, vivo,
    get: async (_c, caminho) => { chamadas.push(`GET ${caminho}`)
      let m = caminho.match(/^\/items\/(MLB\d+)\?include_attributes=all$/); if (m) return vivo[m[1]] ? { status: 200, corpo: JSON.parse(JSON.stringify(vivo[m[1]])), headers: {} } : { status: 404, corpo: null, headers: {} }
      m = caminho.match(/^\/items\/(MLB\d+)\/description$/); if (m) return desc[m[1]] != null ? { status: 200, corpo: { plain_text: desc[m[1]] }, headers: {} } : { status: 404, corpo: null, headers: {} }
      m = caminho.match(/^\/pricing-automation\/items\/(MLB\d+)\/automation$/); if (m) return automacao[m[1]] ? { status: 200, corpo: { status: automacao[m[1]] }, headers: {} } : { status: 404, corpo: null, headers: {} }
      return { status: 404, corpo: null, headers: {} } },
    put: async (_c, caminho, corpo) => { chamadas.push(`PUT ${caminho} ${JSON.stringify(corpo)}`)
      const f = falhaPut[caminho]; if (f) return { status: f, corpo: null, headers: {} }
      let m = caminho.match(/^\/items\/(MLB\d+)\/description\?api_version=2$/); if (m) { if (!naoAplica) desc[m[1]] = corpo.plain_text; return { status: 200, corpo: {}, headers: {} } }
      m = caminho.match(/^\/items\/(MLB\d+)$/); if (m) { aplicar(m[1], corpo); return { status: 200, corpo: {}, headers: {} } }
      return { status: 400, corpo: null, headers: {} } },
    post: async (_c, caminho, corpo) => { chamadas.push(`POST ${caminho} ${JSON.stringify(corpo)}`); const m = caminho.match(/^\/items\/(MLB\d+)\/description$/); if (m && !naoAplica) desc[m[1]] = corpo.plain_text; return { status: 201, corpo: {}, headers: {} } },
  }
}
const escritas = api => api.chamadas.filter(c => !c.startsWith('GET'))
const deps = (api, extra = {}) => ({ api, integracao: async () => true, cfg: LIGADO, ...extra })
const liberar = (op, item = 'MLB1001', cliente = C) => R.liberar(cliente, { operacao: op, por: LIDER, cliente_informado: true, estreia_item: item, confirmar: true })
const limpar = () => { db.exec("DELETE FROM exec_ordem; DELETE FROM exec_liberacao; DELETE FROM sync_estado WHERE chave IN ('chaveiro_execucao_parado','chaveiro_estoque_parado')") }
async function prepararAprovar(api, pedido, cliente = C) {
  const p = await R.preparar(cliente, pedido, { por: LIDER, confirmar: true, api })
  if (p.criadas.length) R.aprovar(cliente, { ordens: p.criadas.map(c => c.id), por: LIDER })
  return p
}
const conferirJa = api => { db.prepare("UPDATE exec_ordem SET conferir_em = '2000-01-01T00:00:00Z' WHERE estado = 'em_conferencia'").run(); return R.conferirOrdens({ api }) }

// ═════════ núcleo puro ═════════
await ok('parâmetros: lista fechada por operação, uma forma de preço, erros sem eco do valor recebido', () => {
  assert.equal(X.validarParams('preco', { variacao_pct: -5 }).ok, true)
  assert.equal(X.validarParams('preco', { variacao_pct: -5, novo_preco: 90 }).ok, false, 'duas formas de preço')
  const v = X.validarParams('preco', { campo_inventado: '<script>x</script>' }); assert.equal(v.ok, false); assert.ok(!JSON.stringify(v.erros).includes('script'), 'erro sem eco')
  assert.equal(X.validarParams('status', {}).ok, false, 'status exige a ação')
  assert.equal(X.validarParams('atributos', { atributos: [{ id: 'GTIN', valor: '789' }] }).ok, false, 'identificador intocável')
  assert.equal(X.validarParams('atributos', { atributos: [{ id: 'BRAND', valor: 'X' }] }).ok, false, 'fora da lista fechada')
  assert.equal(X.validarParams('atributos', { atributos: [{ id: 'color', valor: 'Preto' }] }).params.atributos[0].id, 'COLOR')
  assert.equal(X.validarParams('xyz', {}).ok, false)
})
await ok('preço: payload SÓ com price; teto de 10% por ordem; piso de margem; sem custo exige «decisão do cliente»; variações listadas por id', () => {
  const it = ITENS.MLB1001
  let p = X.planejar('preco', { variacao_pct: -5, decisao_cliente: true }, it, { piso: null })
  assert.deepEqual(p.grupos, [{ grupo: 'preco', metodo: 'PUT', caminho: '/items/MLB1001', corpo: { price: 95 } }]); assert.deepEqual(p.antes, { preco: 100 }); assert.deepEqual(p.esperado, { preco: 95 })
  assert.match(X.planejar('preco', { variacao_pct: -5 }, it, { piso: null }).bloqueios[0], /decisão do cliente/)
  assert.match(X.planejar('preco', { variacao_pct: -15 }, it, { piso: 50 }).bloqueios[0], /teto de 10%/)
  assert.match(X.planejar('preco', { novo_preco: 92 }, it, { piso: 95 }).bloqueios[0], /abaixo do piso/)
  p = X.planejar('preco', { ao_piso: true }, { ...it, price: 80 }, { piso: 95 }); assert.equal(p.esperado.preco, 88, 'sobe até o piso, limitado ao teto (80 × 1,10)')
  p = X.planejar('preco', { variacao_pct: -5 }, ITENS.MLB1004, { piso: 10 })
  assert.deepEqual(p.grupos[0].corpo, { variations: [{ id: 11, price: 47.5 }, { id: 12, price: 57 }] }); assert.deepEqual(p.esperado.preco, { 11: 47.5, 12: 57 })
  p = X.planejar('preco', { novo_preco: 55, variacao_id: '11' }, ITENS.MLB1004, { piso: 10 }); assert.deepEqual(p.grupos[0].corpo, { variations: [{ id: 11, price: 55 }, { id: 12 }] }, 'irmã listada só por id (preservada)')
})
await ok('status: pausar/ativar; moderação e sem estoque nunca reativam; pausado pelo vendedor só com decisão; closed nunca sai', () => {
  assert.deepEqual(X.planejar('status', { acao: 'pausar' }, ITENS.MLB1001, {}).grupos[0].corpo, { status: 'paused' })
  const pausado = { ...ITENS.MLB1001, status: 'paused' }
  assert.match(X.planejar('status', { acao: 'ativar', decisao_reativar: true }, { ...pausado, sub_status: ['held'] }, {}).bloqueios[0], /moderação/)
  assert.match(X.planejar('status', { acao: 'ativar', decisao_reativar: true }, { ...pausado, sub_status: ['out_of_stock'] }, {}).bloqueios[0], /estoque/)
  assert.match(X.planejar('status', { acao: 'ativar' }, pausado, {}).bloqueios[0], /decisão registrada/)
  assert.deepEqual(X.planejar('status', { acao: 'ativar', decisao_reativar: true }, pausado, {}).grupos[0].corpo, { status: 'active' })
  assert.throws(() => X.assertCorpoSeguro({ status: 'closed' }, 'status'), /status só paused\/active/)
  assert.throws(() => X.assertCorpoSeguro({ status: 'paused' }, 'preco'), /só na operação status/)
  assert.throws(() => X.assertCorpoSeguro({ available_quantity: 0 }, 'preco'), /proibido/)
  assert.equal(X.validarParams('status', { acao: 'encerrar' }).ok, false, 'encerrar não existe na lista')
})
await ok('frete grátis: só ME2, obrigatório não desliga, corpo shipping.free_shipping (NOT_VERIFIED declarado)', () => {
  assert.match(X.planejar('frete_gratis', { ativar: true }, { ...ITENS.MLB1001, shipping: { mode: 'me1' } }, {}).bloqueios[0], /Mercado Envios 2/)
  assert.match(X.planejar('frete_gratis', { ativar: false }, { ...ITENS.MLB1001, shipping: { mode: 'me2', free_shipping: true, tags: ['mandatory_free_shipping'] } }, {}).bloqueios[0], /obrigatório/)
  const p = X.planejar('frete_gratis', { ativar: true }, ITENS.MLB1001, {}); assert.deepEqual(p.grupos[0].corpo, { shipping: { free_shipping: true } }); assert.ok(p.avisos.some(a => /NOT_VERIFIED/.test(a)))
  assert.equal(X.OPERACOES.frete_gratis.doc, 'NOT_VERIFIED')
})
await ok('conteúdo: catálogo bloqueado; título só sem vendas e sem perder o que o atual afirma (preservação de Ofertas); descrição sem HTML, PUT ou POST', () => {
  for (const op of ['titulo', 'descricao', 'atributos', 'fotos']) assert.match(X.planejar(op, { titulo: 'x', texto: 'x', atributos: [{ id: 'COLOR', valor: 'Preto' }], capa: 'P2B' }, ITENS.MLB1003, { catalogoOrigem: 'terceiros' }).bloqueios[0], /catálogo/, op)
  assert.match(X.planejar('titulo', { titulo: 'Coleira Azul M Premium' }, { ...ITENS.MLB1001, sold_quantity: 3 }, {}).bloqueios[0], /vendas/)
  assert.match(X.planejar('titulo', { titulo: 'Coleira M Premium' }, ITENS.MLB1001, {}).bloqueios[0], /perde.*cor/, 'a cor sumiu do título')
  assert.deepEqual(X.planejar('titulo', { titulo: 'Coleira Azul M Premium' }, ITENS.MLB1001, {}).grupos[0].corpo, { title: 'Coleira Azul M Premium' })
  assert.match(X.planejar('descricao', { texto: '<b>oi</b>' }, ITENS.MLB1001, {}).bloqueios[0], /HTML/)
  const put = X.planejar('descricao', { texto: 'Coleira azul de nylon reforçada' }, { ...ITENS.MLB1001, _descricao: { plain_text: 'Coleira azul de nylon' } }, {})
  assert.equal(put.grupos[0].metodo, 'PUT'); assert.equal(put.grupos[0].caminho, '/items/MLB1001/description?api_version=2')
  assert.equal(X.planejar('descricao', { texto: 'Coleira azul de nylon' }, { ...ITENS.MLB1001, _descricao: null }, {}).grupos[0].metodo, 'POST')
})
await ok('ficha e fotos: só o que muda; fotos = permutação das existentes (nunca foto nova), variações ficam com Ofertas', () => {
  const a = X.planejar('atributos', { atributos: [{ id: 'COLOR', valor: 'Azul' }, { id: 'MATERIAL', valor: 'Couro' }] }, ITENS.MLB1001, {})
  assert.deepEqual(a.grupos[0].corpo, { attributes: [{ id: 'MATERIAL', value_name: 'Couro' }] }); assert.deepEqual(a.antes, { atributos: { MATERIAL: 'Nylon' } })
  assert.match(X.planejar('atributos', { atributos: [{ id: 'COLOR', valor: 'Azul' }] }, ITENS.MLB1001, {}).bloqueios[0], /nada a mudar/)
  assert.deepEqual(X.planejar('fotos', { capa: 'P3C' }, ITENS.MLB1001, {}).grupos[0].corpo, { pictures: [{ id: 'P3C' }, { id: 'P1A' }, { id: 'P2B' }] })
  assert.match(X.planejar('fotos', { capa: 'ZZZZ' }, ITENS.MLB1001, {}).bloqueios[0], /não é uma foto/)
  assert.match(X.planejar('fotos', { ordem: ['P1A', 'P2B', 'NOVA9'] }, ITENS.MLB1001, {}).bloqueios[0], /exatamente as fotos/)
  assert.match(X.planejar('fotos', { capa: 'P2B' }, ITENS.MLB1004, {}).bloqueios[0], /variações/)
})
await ok('restaurar «como era»: só os campos da lista fechada que mudaram, um grupo por campo, preço por último e sozinho; catálogo só preço/frete', () => {
  const vivo = { ...ITENS.MLB1001, title: 'Coleira Azul M Nova', price: 120, attributes: [{ id: 'COLOR', value_name: 'Azul' }, { id: 'MATERIAL', value_name: 'Couro' }], _descricao: { plain_text: 'Coleira azul de nylon' } }
  const snap = { titulo: 'Coleira Azul M', preco: 100, fotos: ['P1A', 'P2B', 'P3C'], atributos: { COLOR: 'Azul', MATERIAL: 'Nylon', SELLER_SKU: 'OUTRO' }, descricao: 'Coleira azul de nylon', frete: { free_shipping: 0 } }
  const p = X.planejar('restaurar', { snapshot: 'aaaaaaaaaaaaaaaa', decisao_cliente: true }, vivo, { snapshot: snap, piso: null })
  assert.deepEqual(p.grupos.map(g => g.grupo), ['titulo', 'ficha', 'preco'], 'fotos/descrição/frete iguais ficam fora; SELLER_SKU nunca')
  assert.deepEqual(p.grupos.at(-1).corpo, { price: 100 }, 'preço sozinho, sem teto (estado que o anúncio já teve)')
  const cat = X.planejar('restaurar', { snapshot: 'aaaaaaaaaaaaaaaa', decisao_cliente: true }, { ...vivo, catalog_listing: true }, { snapshot: snap, piso: null, catalogoOrigem: 'terceiros' })
  assert.deepEqual(cat.grupos.map(g => g.grupo), ['preco'], 'catálogo: conteúdo fica como está')
  assert.match(X.planejar('restaurar', { snapshot: 'aaaaaaaaaaaaaaaa' }, vivo, { snapshot: snap, piso: 110 }).avisos.join(' '), /abaixo do piso/)
})
await ok('duplicar (F5): sem físico ou acima do físico bloqueia; SKU copiado; capa escolhida primeiro; nasce ativa (declarado)', () => {
  assert.match(X.planejar('duplicar', { quantidade: 5 }, ITENS.MLB1001, { sku: 'COL-M', fisico: null }).bloqueios[0], /estoque físico do produto não informado/)
  assert.match(X.planejar('duplicar', { quantidade: 15 }, ITENS.MLB1001, { sku: 'COL-M', fisico: 20, outros: 10 }).bloqueios[0], /passa do estoque físico/)
  assert.match(X.planejar('duplicar', { quantidade: 5 }, ITENS.MLB1001, { sku: '', fisico: 20 }).bloqueios[0], /SKU/)
  const p = X.planejar('duplicar', { quantidade: 5, capa: 'P3C', titulo_novo: 'Coleira Azul M Reforçada' }, ITENS.MLB1001, { sku: 'COL-M', fisico: 20, outros: 10 })
  const pr = p.grupos[0].proposta
  assert.equal(pr.sku, 'COL-M'); assert.equal(pr.estoque, 5); assert.equal(pr.galeria[0].picture_id, 'P3C'); assert.ok(!pr.atributos.some(a => a.id === 'SELLER_SKU'), 'o SKU entra pelo criarAnuncio')
  assert.ok(p.avisos.some(a => /nasce ATIVA/.test(a)))
})
await ok('promoção delegada e Ads assistido: plano aprovado e de 1 anúncio só; Ads gera passo a passo e nunca é escrita', () => {
  assert.match(X.planejar('promocao', { plano_id: 'P1' }, ITENS.MLB1001, { plano: { id: 'P1', estado: 'rascunho', itens: [] } }).bloqueios[0], /não está aprovado/)
  assert.match(X.planejar('promocao', { plano_id: 'P1' }, ITENS.MLB1001, { plano: { id: 'P1', estado: 'aprovado', itens: [{ acao: 'ENTRAR', item_id: 'MLB1001' }, { acao: 'ENTRAR', item_id: 'MLB1002' }] } }).bloqueios[0], /mais de um anúncio/)
  assert.equal(X.planejar('promocao', { plano_id: 'P1' }, ITENS.MLB1001, { plano: { id: 'P1', estado: 'aprovado', itens: [{ acao: 'ENTRAR', item_id: 'MLB1001', pid: 'X' }] } }).grupos[0].delegado, true)
  const a = X.planejar('ads', { acao: 'orcamento', valor: 30 }, ITENS.MLB1001, {}); assert.equal(a.grupos.length, 0); assert.ok(a.passo_a_passo.length >= 3)
  assert.ok(X.verificarTravas({ cfg: LIGADO, operacao: 'ads' }).motivos.includes(X.MOTIVOS.assistido))
  assert.ok(X.verificarTravas({ cfg: LIGADO, operacao: 'estoque' }).motivos.includes(X.MOTIVOS.f6))
})
await ok('conferência: confere / aguardando (ainda o antes) / divergente; esperado vazio nunca «confere»', () => {
  assert.equal(X.conferir({ preco: 95 }, { preco: 95 }, { preco: 100 }), 'confere')
  assert.equal(X.conferir({ preco: 95 }, { preco: 100 }, { preco: 100 }), 'aguardando')
  assert.equal(X.conferir({ preco: 95 }, { preco: 80 }, { preco: 100 }), 'divergente')
  assert.equal(X.conferir({}, {}, {}), 'aguardando')
})
await ok('travas puras: cada uma fecha sozinha; estreia; ampliado só depois do veto sem veto; teto do dia', () => {
  const ordem = { estado: 'aprovada', payload: { a: 1 } }; ordem.hash = X.hashOrdem(ordem.payload)
  const lib = { liberado_por: LIDER, cliente_informado_em: agora(), estreia_item: 'MLB1001' }
  const t = o => X.verificarTravas({ cfg: LIGADO, operacao: 'preco', integracaoOk: true, liberacao: lib, item_id: 'MLB1001', executadasHoje: 0, confirmar: true, ordem, ...o })
  assert.equal(t({}).liberado, true)
  assert.ok(t({ cfg: X.CFG }).motivos.includes(X.MOTIVOS.chave_global))
  assert.ok(t({ cfg: { ...LIGADO, adaptadores_live: { preco: false } } }).motivos.includes(X.MOTIVOS.adaptador))
  assert.ok(t({ parado: true }).motivos.includes(X.MOTIVOS.parado))
  assert.ok(t({ liberacao: null }).motivos.includes(X.MOTIVOS.sem_liberacao))
  assert.ok(t({ liberacao: { ...lib, cliente_informado_em: '' } }).motivos.includes(X.MOTIVOS.cliente_informado))
  assert.ok(t({ item_id: 'MLB1002' }).motivos.includes(X.MOTIVOS.estreia))
  assert.equal(t({ item_id: 'MLB1002', ampliado: true }).liberado, true)
  assert.ok(t({ executadasHoje: 1 }).motivos.includes(X.MOTIVOS.teto_dia)); assert.equal(t({ executadasHoje: 1, reversao: true }).liberado, true, 'reversão não conta no teto')
  for (const c of ['true', 1, 'sim', undefined]) assert.ok(t({ confirmar: c }).motivos.includes(X.MOTIVOS.confirmar))
  assert.ok(t({ ordem: { ...ordem, hash: 'x' } }).motivos.includes(X.MOTIVOS.hash))
  assert.ok(t({ integracaoOk: false }).motivos.includes(X.MOTIVOS.integracao))
  const agoraISO = agora(), libP = { ...lib, ampliacao_proposta_em: agoraISO }
  assert.equal(X.ampliado({ ...libP, veto_ate: '2999-01-01T00:00:00Z' }, agoraISO), false); assert.equal(X.ampliado({ ...libP, veto_ate: '2000-01-01T00:00:00Z' }, agoraISO), true); assert.equal(X.ampliado({ ...libP, veto_ate: '2000-01-01T00:00:00Z', vetado_em: agoraISO }, agoraISO), false)
  assert.equal(X.neoPropoe({ lib, conferidas: 10, divergencias: 0 }), true); assert.equal(X.neoPropoe({ lib, conferidas: 10, divergencias: 1 }), false); assert.equal(X.neoPropoe({ lib, conferidas: 9, divergencias: 0 }), false)
})
await ok('estratégias: catálogo válido, parâmetros trocados, passo sem valor pulado; pré-condição sem dado não atende; estratégia própria só com a lista fechada', () => {
  for (const e of X.CFG_ESTRATEGIAS.estrategias) { const v = X.validarEstrategia(e); assert.equal(v.ok, true, `${e.id}: ${v.erros.join('; ')}`) }
  const ima = X.CFG_ESTRATEGIAS.estrategias.find(e => e.id === 'ima_conversao')
  const x = X.expandirEstrategia(ima, {}); assert.equal(x.passos[0].params.variacao_pct, -5, 'padrão'); assert.match(x.passos[2].pulado, /capa/, 'sem capa o passo é pulado, nunca inventado')
  assert.equal(X.expandirEstrategia(ima, { desconto_pct: -30 }).ok, false, 'fora do mínimo')
  assert.equal(X.avaliarPrecondicoes(ima.precondicoes, { v: 500, conv: 1, benchmark_ref: { conv: 2 } }).ok, true)
  assert.equal(X.avaliarPrecondicoes(ima.precondicoes, { v: 500, conv: null }).ok, false, 'sem dado = não atendida')
  assert.equal(X.validarEstrategia({ nome: 'Minha', passos: [{ operacao: 'estoque', params: {} }] }).ok, false, 'estoque segue o F6')
  assert.equal(X.validarEstrategia({ nome: 'Minha', passos: [{ operacao: 'preco', params: { variacao_pct: -3 } }], precondicoes: [{ campo: 'inventado', op: '>', valor: 1 }] }).ok, false)
  assert.equal(X.validarEstrategia({ nome: 'Capa e preço', parametros: { capa: { tipo: 'foto' } }, passos: [{ operacao: 'fotos', params: { capa: '$capa' } }, { operacao: 'preco', params: { variacao_pct: -3 } }] }).ok, true)
})

// ═════════ fluxo com banco e stub ═════════
await ok('prévia: só cache, nenhuma chamada ao ML, diff + Oráculo + o que o Merovíngio mede; isolamento (anúncio de outro cliente = 404)', async () => {
  const p = await R.previa(C, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } })
  assert.equal(p.escrita, false); assert.equal(p.anuncios[0].fonte, 'cache')
  const l = p.anuncios[0].passos[0]; assert.equal(l.situacao, 'pronto'); assert.deepEqual(l.diff[0], { campo: 'preço', de: 100, para: 95 }); assert.match(l.medicao, /não prova de causa/); assert.ok(l.oraculo)
  await assert.rejects(R.previa(C, { itens: ['MLB9001'], operacao: 'preco', params: { variacao_pct: -5 } }), e => e.status === 404)
  await assert.rejects(R.previa('[Comercial] X', { itens: ['MLB1001'], operacao: 'preco', params: {} }))
})
await ok('preparar: sem confirmar = prévia; com confirmar relê ao vivo (só GET) e grava aguardando aprovação; analista não prepara; só o líder aprova; outro cliente não vê', async () => {
  limpar(); const api = stubML()
  const pv = await R.preparar(C, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } }, { por: LIDER, confirmar: 'true', api }); assert.equal(pv.previa, true); assert.equal(api.chamadas.length, 0)
  await assert.rejects(R.preparar(C, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5 } }, { por: 'Ana Analista', confirmar: true, api }), e => e.status === 403)
  const p = await R.preparar(C, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } }, { por: LIDER, confirmar: true, api })
  assert.equal(p.criadas.length, 1); assert.equal(escritas(api).length, 0, 'preparar nunca escreve')
  const o = db.prepare('SELECT * FROM exec_ordem WHERE id = ?').get(p.criadas[0].id); assert.equal(o.estado, 'aguardando_aprovacao'); assert.equal(JSON.parse(o.payload_json).antes.preco, 100)
  assert.throws(() => R.aprovar(C, { ordens: [o.id], por: 'Ana Analista' }), e => e.status === 403)
  assert.equal(R.aprovar(OUTRO, { ordens: [o.id], por: LIDER }).aprovadas, 0, 'isolamento: a ordem é de outro cliente')
  assert.equal(R.aprovar(C, { ordens: [o.id], por: LIDER }).aprovadas, 1)
  const p2 = await R.preparar(C, { itens: ['MLB1001'], operacao: 'frete_gratis', params: { ativar: true } }, { por: LIDER, confirmar: true, api }); assert.match(p2.ignoradas[0].motivo, /ordem aberta/, 'uma intervenção por vez no anúncio')
})
await ok('executar: chave global desligada (config real) e operação desligada barram; confirmar só true; liberação, estreia e teto; nada sai', async () => {
  const api = stubML(), o = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aprovada'").get()
  let r = await R.executarOrdem(C, o.id, { por: LIDER, confirmar: true, api, integracao: async () => true }); assert.equal(r.executado, false); assert.ok(r.motivos.includes(X.MOTIVOS.chave_global))
  r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true, cfg: { ...LIGADO, adaptadores_live: {} } }); assert.ok(r.motivos.includes(X.MOTIVOS.adaptador))
  r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true }); assert.ok(r.motivos.includes(X.MOTIVOS.sem_liberacao))
  assert.throws(() => R.liberar(C, { operacao: 'preco', por: LIDER, cliente_informado: false, estreia_item: 'MLB1001', confirmar: true }), /cliente_informado/)
  assert.equal(R.liberar(C, { operacao: 'preco', por: LIDER, cliente_informado: true, estreia_item: 'MLB1002' }).previa, true, 'liberar é prévia por padrão')
  liberar('preco', 'MLB1002')
  r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true }); assert.ok(r.motivos.includes(X.MOTIVOS.estreia))
  liberar('preco', 'MLB1001')
  r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: 'true' }); assert.ok(r.motivos.includes(X.MOTIVOS.confirmar))
  await assert.rejects(R.executarOrdem(C, o.id, { ...deps(api), por: 'Ana Analista', confirmar: true }), e => e.status === 403)
  assert.equal(escritas(api).length, 0, 'nenhuma escrita com trava fechada')
})
await ok('executar preço (fluxo completo): relê ao vivo, confere automação, PUT só {price}, 2xx → em conferência; conferência relê → conferida + marco «chaveiro» no change-log + decisão do cliente no Smith', async () => {
  const api = stubML(), o = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aprovada'").get()
  const r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true })
  assert.equal(r.executado, true); assert.equal(r.estado, 'em_conferencia')
  assert.deepEqual(api.chamadas, ['GET /items/MLB1001?include_attributes=all', 'GET /pricing-automation/items/MLB1001/automation', 'PUT /items/MLB1001 {"price":95}'])
  const c = await conferirJa(api); assert.equal(c.resultados[0].veredito, 'confere')
  assert.equal(db.prepare('SELECT estado FROM exec_ordem WHERE id = ?').get(o.id).estado, 'executada')
  const m = db.prepare("SELECT * FROM meli_item_mudanca WHERE cliente = ? AND item_id = 'MLB1001' AND fonte = 'chaveiro'").get(C); assert.equal(m.campo, 'preco'); assert.equal(m.para, '95'); assert.equal(m.variacao_pct, -5)
  assert.equal(db.prepare("SELECT decisor FROM preco_decisao WHERE cliente = ?").get(C)?.decisor, 'cliente', 'sem custo: registrada como decisão do cliente')
  assert.ok(db.prepare('SELECT COUNT(*) n FROM exec_evento WHERE ordem_id = ?').get(o.id).n >= 4, 'toda transição e todo envio no exec_evento')
  assert.throws(() => db.prepare('DELETE FROM exec_evento').run(), /append-only/)
})
await ok('teto do dia na estreia: a 2ª ordem da operação no mesmo dia não sai', async () => {
  const api = stubML({ itens: { ...ITENS, MLB1001: { ...ITENS.MLB1001, price: 95 } } })
  await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } })
  const o = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aprovada' AND item_id = 'MLB1001'").get()
  const r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true }); assert.ok(r.motivos.includes(X.MOTIVOS.teto_dia)); assert.equal(escritas(api).length, 0)
})
await ok('reversão: só da ordem conferida, volta ao «antes» (sem teto), passa pelas mesmas travas e marca a original como revertida', async () => {
  const api = stubML({ itens: { ...ITENS, MLB1001: { ...ITENS.MLB1001, price: 95 } } })
  const orig = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'executada'").get()
  const pv = await R.reverter(C, orig.id, { por: LIDER, api }); assert.equal(pv.previa, true); assert.equal(escritas(api).length, 0)
  const r = await R.reverter(C, orig.id, { por: LIDER, confirmar: true, ...deps(api) }); assert.equal(r.execucao.executado, true)
  assert.ok(escritas(api).includes('PUT /items/MLB1001 {"price":100}'))
  await conferirJa(api)
  const p = R.painel(C), o = p.ordens.find(x => x.id === orig.id); assert.equal(o.estado_exibido, 'revertida'); assert.equal(o.reversivel, false)
  await assert.rejects(R.reverter(C, orig.id, { por: LIDER, confirmar: true, ...deps(api) }), e => e.status === 409, 'não reverte duas vezes')
})
await ok('2xx ≠ feito: o ML responde 200 e não aplica → aguardando nas releituras → falhou (nunca reenvia)', async () => {
  limpar(); liberar('frete_gratis'); const api = stubML({ naoAplica: true })
  await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'frete_gratis', params: { ativar: true } })
  const o = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aprovada'").get()
  assert.equal((await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true })).executado, true)
  for (let k = 0; k < X.CFG.execucao.conferencias_max; k++) await conferirJa(api)
  assert.equal(db.prepare('SELECT estado FROM exec_ordem WHERE id = ?').get(o.id).estado, 'falhou'); assert.equal(escritas(api).length, 1, 'um envio só')
})
await ok('releitura divergente: o anúncio mudou fora do sistema depois da preparação → divergente, nada enviado; automação de preço ativa → recusada', async () => {
  limpar(); liberar('preco'); const api = stubML()
  await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } })
  api.vivo.MLB1001.price = 110
  const o = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aprovada'").get()
  const r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true }); assert.equal(r.estado, 'divergente'); assert.equal(escritas(api).length, 0)
  limpar(); liberar('preco'); const api2 = stubML({ automacao: { MLB1001: 'ACTIVE' } })
  await prepararAprovar(api2, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } })
  const o2 = db.prepare("SELECT id FROM exec_ordem WHERE estado = 'aprovada'").get()
  const r2 = await R.executarOrdem(C, o2.id, { ...deps(api2), por: LIDER, confirmar: true }); assert.equal(r2.estado, 'recusada'); assert.match(r2.motivos[0], /automação de preço/); assert.equal(escritas(api2).length, 0)
})
await ok('catálogo bloqueado e alinhamento vivo: a ordem de conteúdo nem nasce; com alinhamento nada é escrito', async () => {
  limpar(); const api = stubML()
  const p = await R.preparar(C, { itens: ['MLB1003'], operacao: 'titulo', params: { titulo: 'Coleira Azul M Top' } }, { por: LIDER, confirmar: true, api })
  assert.equal(p.criadas.length, 0); assert.match(p.ignoradas[0].motivo, /catálogo/)
  db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, regras_json, tipo, motivo, por, desde, revisar_em, estado, origem, criado_em) VALUES (?, 'anuncio', 'MLB1002', '[]', 'intencional', 'teste', ?, ?, '2999-01-01', 'vivo', 'painel', ?)").run(C, LIDER, hojeLocal(), agora())
  const p2 = await R.preparar(C, { itens: ['MLB1002'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } }, { por: LIDER, confirmar: true, api })
  assert.equal(p2.criadas.length, 0); assert.match(p2.ignoradas[0].motivo, /alinhamento/)
})
await ok('kill switch: parar cancela a fila e barra a execução (e para o sincronismo de estoque também); retomar só com líder e confirmar', async () => {
  limpar(); liberar('preco'); const api = stubML()
  await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } })
  assert.equal(R.pararTudo({ por: LIDER }).previa, true)
  const r = R.pararTudo({ por: LIDER, confirmar: true }); assert.equal(r.canceladas, 1)
  assert.equal(db.prepare("SELECT valor FROM sync_estado WHERE chave = 'chaveiro_estoque_parado'").get()?.valor, '1')
  assert.ok(X.verificarTravas({ cfg: LIGADO, operacao: 'preco', parado: R.parado() }).motivos.includes(X.MOTIVOS.parado))
  assert.throws(() => R.retomar({ por: 'Ana Analista', confirmar: true }), e => e.status === 403)
  R.retomar({ por: LIDER, confirmar: true }); assert.equal(R.parado(), false)
})
await ok('estratégia «Ímã de conversão»: pré-condição sem dado barra; estratégia própria vira 3 ordens executadas 1 por vez, na ordem dos passos; reexecutar não reenvia', async () => {
  limpar(); for (const op of ['preco', 'frete_gratis', 'fotos']) liberar(op)
  const api = stubML({ falhaPut: {} })
  const p = await prepararAprovar(api, { itens: ['MLB1001'], estrategia: 'ima_conversao', valores: { capa: 'P2B' } })
  assert.equal(p.criadas.length, 0, 'pré-condição sem diagnóstico (sem dado) = não atendida'); assert.match(p.ignoradas[0].motivo, /pré-condição/)
  // estratégia própria sem pré-condição: a mesma sequência
  const s = R.salvarEstrategia({ nome: 'Ímã sem pré', parametros: { capa: { tipo: 'foto' } }, passos: [{ operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } }, { operacao: 'frete_gratis', params: { ativar: true } }, { operacao: 'fotos', params: { capa: '$capa' } }] }, { por: LIDER, confirmar: true })
  const p2 = await prepararAprovar(api, { itens: ['MLB1001'], estrategia: s.id, valores: { capa: 'P2B' } })
  assert.deepEqual(p2.criadas.map(c => c.operacao), ['preco', 'frete_gratis', 'fotos'])
  const api2 = stubML({ falhaPut: {} }); api2.vivo = api.vivo
  const lote = await R.executarLote(C, { ordens: p2.criadas.map(c => c.id), por: LIDER, confirmar: true, ...deps(api2, { cfg: { ...LIGADO, execucao: { ...LIGADO.execucao } } }) })
  assert.equal(lote.executadas, 3, 'teto é por operação: as 3 saem, 1 por vez')
  assert.deepEqual(escritas(api2).map(c => c.split(' {')[0] + ' ' + Object.keys(JSON.parse(c.slice(c.indexOf('{')))).join(',')), ['PUT /items/MLB1001 price', 'PUT /items/MLB1001 shipping', 'PUT /items/MLB1001 pictures'], 'na ordem dos passos, cada envio com um campo só')
  const lote2 = await R.executarLote(C, { ordens: p2.criadas.map(c => c.id), por: LIDER, confirmar: true, ...deps(api2) }); assert.equal(lote2.executadas, 0, 'já executadas: nada sai de novo'); assert.equal(escritas(api2).length, 3)
})
await ok('estratégia: envio recusado no meio (400) para a sequência; as ordens seguintes ficam aprovadas, sem envio', async () => {
  limpar(); for (const op of ['preco', 'frete_gratis']) liberar(op)
  const s = R.salvarEstrategia({ nome: 'Frete e preço', passos: [{ operacao: 'frete_gratis', params: { ativar: true } }, { operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } }] }, { por: LIDER, confirmar: true })
  const api = stubML({ falhaPut: { '/items/MLB1001': 400 } })
  const p = await prepararAprovar(api, { itens: ['MLB1001'], estrategia: s.id })
  const lote = await R.executarLote(C, { ordens: p.criadas.map(c => c.id), por: LIDER, confirmar: true, ...deps(api) })
  assert.equal(lote.executadas, 0); assert.equal(escritas(api).length, 1, 'só o 1º envio (recusado)')
  assert.equal(db.prepare("SELECT estado FROM exec_ordem WHERE operacao = 'frete_gratis'").get().estado, 'falhou')
  assert.equal(db.prepare("SELECT estado FROM exec_ordem WHERE operacao = 'preco'").get().estado, 'aprovada', 'o passo seguinte não saiu')
})
await ok('duplicar pelo criarAnuncio de Ofertas (estoque F5 relido; SKU copiado) e conferência no anúncio novo; promoção delegada ao promocoes-exec', async () => {
  limpar(); db.exec('DELETE FROM alinhamento'); liberar('duplicar'); liberar('promocao')
  db.prepare("INSERT OR REPLACE INTO produto_estoque_declarado (cliente, sku, quantidade, fonte, por, em) VALUES (?, 'col-m', 30, 'cliente', ?, ?)").run(C, LIDER, agora())
  db.prepare("INSERT OR REPLACE INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, sku, sku_fonte, estoque, logistica, tags, status, lido_em) VALUES (?, 'MLB1001', '', 'UP1', 'COL-M', 'seller_sku', 10, 'xd_drop_off', '', 'active', ?)").run(C, agora())
  const api = stubML(), chamadasMl = []
  const ml = { criarAnuncio: async (cliente, proposta, opts) => { chamadasMl.push({ proposta, opts }); api.vivo.MLB7777 = base('MLB7777', { title: proposta.titulo }); return { estado: 'em_conferencia', anuncio_id: 'MLB7777' } } }
  const p = await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'duplicar', params: { quantidade: 30 } }); assert.match(p.ignoradas[0].motivo, /passa do estoque físico/, '30 + 10 > 30')
  const p2 = await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'duplicar', params: { quantidade: 20, capa: 'P2B' } }); assert.equal(p2.criadas.length, 1)
  const r = await R.executarOrdem(C, p2.criadas[0].id, { ...deps(api), ml, por: LIDER, confirmar: true }); assert.equal(r.executado, true)
  assert.equal(chamadasMl[0].proposta.sku, 'COL-M'); assert.equal(chamadasMl[0].opts.live, true); assert.deepEqual(chamadasMl[0].opts.excluir_ids, ['MLB1001'])
  assert.equal((await conferirJa(api)).resultados[0].veredito, 'confere')
  assert.equal(escritas(api).length, 0, 'a escrita da duplicata é do criarAnuncio (Ofertas), nunca um PUT/POST paralelo')
  // promoção
  try { db.prepare(`INSERT INTO promo_plano (id, cliente, estado, itens_json, hash, criado_em, expira_em) VALUES ('PL1', ?, 'aprovado', ?, 'h', ?, ?)`).run(C, JSON.stringify([{ acao: 'ENTRAR', item_id: 'MLB1002', pid: 'C1', campanha: 'Dia', aprovado: { preco: 90 } }]), agora(), '2999-01-01T00:00:00Z') } catch (e) { throw new Error('promo_plano ausente no banco em memória: ' + e.message) }
  const promo = { lerPlano: (c, id) => ({ id, estado: 'aprovado', itens: [{ acao: 'ENTRAR', item_id: 'MLB1002' }] }), executarPlano: async () => ({ estado: 'executado', resumo: { chamadas: 1 } }), sincronizarPosExecucao: async () => ({ entrou: 1, suspeito: false, nao_provado: 0 }) }
  db.prepare("UPDATE exec_liberacao SET estreia_item = 'MLB1002' WHERE operacao = 'promocao'").run()
  const p3 = await prepararAprovar(api, { itens: ['MLB1002'], operacao: 'promocao', params: { plano_id: 'PL1' } }); assert.equal(p3.criadas.length, 1, JSON.stringify(p3.ignoradas))
  assert.equal((await R.executarOrdem(C, p3.criadas[0].id, { ...deps(api), promo, por: LIDER, confirmar: true })).executado, true)
  db.prepare("UPDATE exec_ordem SET conferir_em = '2000-01-01T00:00:00Z' WHERE estado = 'em_conferencia'").run()
  assert.equal((await R.conferirOrdens({ api, promo })).resultados[0].veredito, 'confere')
})
await ok('Neo (D-C1): 10 conferidas sem divergência → propõe ampliar; vale depois de 48 h sem veto; veto do líder mantém a estreia', async () => {
  limpar(); liberar('titulo')
  for (let k = 0; k < 10; k++) db.prepare(`INSERT INTO exec_ordem (id, cliente, regra, item_id, caminho, adaptador, operacao, payload_json, hash, chave_idem, estado, criado_em, atualizado_em) VALUES (?, ?, 'x', 'MLB1001', 'automatico', 'ml_item', 'titulo', '{"executor":"f4"}', 'h', ?, 'executada', ?, ?)`).run(`CH-00000000${k}${k}`.slice(0, 13), C, `k${k}`, agora(), agora())
  assert.deepEqual(R.neoAvaliar(C), ['titulo'])
  const lib = db.prepare("SELECT * FROM exec_liberacao WHERE operacao = 'titulo'").get(); assert.ok(lib.veto_ate > lib.ampliacao_proposta_em)
  assert.equal(X.ampliado(lib, agora()), false, 'dentro das 48 h')
  assert.equal(X.ampliado(lib, new Date(Date.now() + 49 * 3_600_000).toISOString()), true)
  R.vetar(C, { operacao: 'titulo', por: LIDER, confirmar: true }); assert.equal(X.ampliado(db.prepare("SELECT * FROM exec_liberacao WHERE operacao = 'titulo'").get(), new Date(Date.now() + 49 * 3_600_000).toISOString()), false)
})
await ok('preset da ação do plano (botão «Executar pelo Chaveiro») e Ads assistido (feito pelo humano, nunca escrito)', async () => {
  db.prepare(`INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, dados_json, status, criado_em, atualizado_em, item_id) VALUES ('PS-1', ?, 'anuncio_frete_gratis', '2026-10', 't', 'esta_semana', '2026-10-20', ?, 'aprovada', ?, ?, 'MLB1001')`)
    .run(C, JSON.stringify({ execucao: { caminho: 'automatico', adaptador: 'ml_item', operacao: 'frete_gratis' } }), agora(), agora())
  const pr = R.presetDaAcao(C, 'PS-1'); assert.equal(pr.operacao, 'frete_gratis'); assert.equal(pr.item_id, 'MLB1001'); assert.deepEqual(pr.params, { ativar: true })
  assert.throws(() => R.presetDaAcao(OUTRO, 'PS-1'), e => e.status === 404, 'isolamento')
  limpar(); const api = stubML()
  const p = await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'ads', params: { acao: 'ativar' } }); assert.equal(p.criadas.length, 1)
  const r = await R.executarOrdem(C, p.criadas[0].id, { ...deps(api), por: LIDER, confirmar: true }); assert.equal(r.executado, false); assert.ok(r.motivos.includes(X.MOTIVOS.assistido))
  assert.equal(R.marcarFeito(C, p.criadas[0].id, { por: LIDER }).estado, 'em_conferencia'); assert.equal(escritas(api).length, 0)
})
await ok('ordem adulterada no banco (caminho de outro anúncio, hash recalculado) não sai: o que sairia ao vivo tem de ser o aprovado', async () => {
  limpar(); db.exec('DELETE FROM alinhamento'); liberar('preco'); const api = stubML()
  await prepararAprovar(api, { itens: ['MLB1001'], operacao: 'preco', params: { variacao_pct: -5, decisao_cliente: true } })
  const o = db.prepare("SELECT id, payload_json FROM exec_ordem WHERE estado = 'aprovada'").get(), pay = JSON.parse(o.payload_json)
  pay.grupos[0].caminho = '/items/MLB1002'; db.prepare('UPDATE exec_ordem SET payload_json = ?, hash = ? WHERE id = ?').run(JSON.stringify(pay), X.hashOrdem(pay), o.id)
  const r = await R.executarOrdem(C, o.id, { ...deps(api), por: LIDER, confirmar: true, hoje: '2099-01-01' }); assert.equal(r.executado, false); assert.equal(escritas(api).length, 0)
})
await ok('nunca DELETE nem closed: nenhum caminho de código do executor monta DELETE; o stub nunca recebeu um', () => {
  const fonte = ['src/lib/chaveiro-executor.js', 'src/lib/chaveiro-executor-real.js', 'src/rotas-chaveiro-executor.js'].map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n')
  assert.doesNotMatch(fonte, /'DELETE'|method: *'DELETE'|\.delete\(/); assert.doesNotMatch(fonte.replace(/\/\/.*$/gm, ''), /status: *'closed'/)
})
await ok('rotas: JSON obrigatório (415), prospect 400, cliente fora da central 404, prévia sem escrita, ordem inválida 400 sem eco', async () => {
  const app = express(); app.use(express.json())
  app.use(criarRotasChaveiroExecutor({ exec: R, clienteCanonico: c => ([C, OUTRO].includes(c) ? c : ''), validarPor: () => '' }))
  const srv = app.listen(0), url = `http://127.0.0.1:${srv.address().port}`
  try {
    const post = (p, b, ct = 'application/json') => fetch(url + p, { method: 'POST', headers: { 'Content-Type': ct }, body: typeof b === 'string' ? b : JSON.stringify(b) })
    assert.equal((await post('/api/chaveiro/exec/previa', 'x', 'text/plain')).status, 415)
    assert.equal((await post('/api/chaveiro/exec/previa', { cliente: '[Comercial] Y', itens: ['MLB1001'] })).status, 400)
    assert.equal((await post('/api/chaveiro/exec/previa', { cliente: 'Ninguém', itens: ['MLB1001'] })).status, 404)
    const r = await post('/api/chaveiro/exec/previa', { cliente: C, itens: ['MLB1002'], operacao: 'frete_gratis', params: { ativar: true } }); const j = await r.json()
    assert.equal(r.status, 200); assert.equal(j.escrita, false)
    const ruim = await post('/api/chaveiro/exec/executar', { cliente: C, ordem: '<script>alert(1)</script>', confirmar: true }); assert.equal(ruim.status, 400); assert.ok(!(await ruim.text()).includes('script'))
    const op = await post('/api/chaveiro/exec/previa', { cliente: C, itens: ['MLB1001'], operacao: 'apagar<b>' }); assert.equal(op.status, 400); assert.ok(!(await op.text()).includes('<b>'))
    const g = await (await fetch(`${url}/api/chaveiro/exec/painel?cliente=${encodeURIComponent(C)}`)).json(); assert.equal(g.ligado, false); assert.ok(g.operacoes.length >= 10)
  } finally { srv.close() }
})

import { readFileSync } from 'node:fs'
console.log(`\n✔ teste-chaveiro-executor: ${n} verificações passaram`)
