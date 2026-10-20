// Adaptador ML do módulo Ofertas: sem rede (fetch stub), sem banco. Cobre os critérios 7, 11, 12, 13 e 14 da spec
// e a detecção de pictures[0] trocado. Cada caso FALHARIA se a regra correspondente fosse removida.
import assert from 'node:assert/strict'
import { criarAdaptadorML, validarProposta, montarPayloads, classificarErro, impressaoItem } from '../src/lib/ofertas-ml.js'

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => corpo == null ? '' : JSON.stringify(corpo) })

// ── ML em memória ────────────────────────────────────────────────────────────────────────────────────────────
function criarML({ itens = {}, falhas = {}, categoria = null, timeoutCriacao = false, semSku = false } = {}) {
  const log = { chamadas: [] }, descricoes = {}
  const catAttrs = categoria || [
    { id: 'BRAND', name: 'Marca', value_type: 'string', value_max_length: 255, tags: { required: true } },
    { id: 'MODEL', name: 'Modelo', value_type: 'string', value_max_length: 255, tags: {} },
    { id: 'MPN', name: 'MPN', value_type: 'string', tags: { hidden: true } },
    { id: 'GTIN', name: 'GTIN', value_type: 'string', tags: { hidden: true, conditional_required: true } },
    { id: 'PACKAGE_HEIGHT', name: 'Altura', value_type: 'number_unit', tags: { read_only: true, hidden: true } },
    { id: 'COLOR', name: 'Cor', value_type: 'string', tags: { variation_attribute: true } },
  ]
  let criados = 0
  const fetch = async (url, init = {}) => {
    const u = new URL(url), metodo = init.method || 'GET', caminho = u.pathname + u.search
    assert.ok(init.headers?.Authorization?.startsWith('Bearer '), 'toda chamada leva o token')
    assert.notEqual(metodo, 'DELETE', 'o adaptador nunca exclui')
    const corpo = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null
    log.chamadas.push({ metodo, caminho, corpo })
    if (falhas[`${metodo} ${u.pathname}`] !== undefined) { const f = falhas[`${metodo} ${u.pathname}`]; if (f === 'timeout') throw new Error('fetch failed: timeout'); return resposta(f, { message: 'Validation error', cause: [{ code: 'item.attributes.invalid' }] }) }
    let m
    if (metodo === 'GET' && (m = u.pathname.match(/^\/items\/(MLB\d+)$/))) return itens[m[1]] ? resposta(200, itens[m[1]]) : resposta(404, { message: 'not found' })
    if (metodo === 'GET' && (m = u.pathname.match(/^\/items\/(MLB\d+)\/description$/))) return descricoes[m[1]] || itens[m[1]]?._desc ? resposta(200, descricoes[m[1]] || itens[m[1]]._desc) : resposta(404, {})
    if (metodo === 'GET' && /^\/categories\/MLB\d+\/attributes$/.test(u.pathname)) return resposta(200, catAttrs)
    if (metodo === 'GET' && /^\/categories\/MLB\d+$/.test(u.pathname)) return resposta(200, { id: 'MLB1', name: 'Smartwatches', path_from_root: [{ name: 'Eletrônicos' }, { name: 'Smartwatches' }] })
    if (metodo === 'GET' && u.pathname === '/sites/MLB/listing_prices') return resposta(200, [{ listing_type_id: 'gold_special', sale_fee_amount: 23.98, listing_fee_amount: 0, sale_fee_details: { percentage_fee: 16.5, fixed_fee: 6, gross_amount: 23.98 } }])
    if (metodo === 'GET' && /^\/users\/\d+\/items\/search$/.test(u.pathname)) return resposta(200, { results: semSku ? [] : (criados ? ['MLB9000000001'] : []), paging: { total: criados ? 1 : 0 } })
    if (metodo === 'POST' && u.pathname === '/pictures/items/upload') return resposta(200, { id: `pic-nova-${log.chamadas.filter(c => c.caminho.startsWith('/pictures')).length}`, size: '1200x1200', max_size: '1200x1200' })
    if (metodo === 'POST' && u.pathname === '/items') { criados++; if (timeoutCriacao) throw new Error('fetch failed: timeout'); return resposta(201, { id: 'MLB9000000001', status: 'active', permalink: 'https://produto.mercadolivre.com.br/MLB-9000000001', pictures: [] }) }
    if (metodo === 'PUT' && (m = u.pathname.match(/^\/items\/(MLB\d+)$/))) {
      const it = itens[m[1]]
      if (corpo.title) it.title = corpo.title
      if (corpo.price != null) it.price = corpo.price
      if (corpo.attributes) for (const a of corpo.attributes) { const x = it.attributes.find(y => y.id === a.id); if (x) x.value_name = a.value_name; else it.attributes.push({ id: a.id, value_name: a.value_name }) }
      if (corpo.pictures) it.pictures = corpo.pictures.map(p => ({ id: p.id, max_size: '1200x1200' }))
      if (corpo.variations) for (const v of corpo.variations) { const x = it.variations.find(y => y.id === v.id); if (v.picture_ids) x.picture_ids = v.picture_ids; if (v.price != null) x.price = v.price }
      return resposta(200, it)
    }
    if ((metodo === 'PUT' || metodo === 'POST') && (m = u.pathname.match(/^\/items\/(MLB\d+)\/description$/))) { descricoes[m[1]] = { plain_text: corpo.plain_text }; return resposta(200, descricoes[m[1]]) }
    assert.fail(`chamada inesperada: ${metodo} ${caminho}`)
  }
  return { fetch, log, itens }
}
const item = (id, o = {}) => ({ id, title: 'Smartwatch D20 Preto', price: 99.9, status: 'active', category_id: 'MLB1', listing_type_id: 'gold_special', sold_quantity: 0, available_quantity: 10, catalog_listing: false, permalink: `https://produto.mercadolivre.com.br/${id}`,
  pictures: [{ id: 'pic-a', max_size: '1200x1200' }, { id: 'pic-b', max_size: '1200x1200' }], attributes: [{ id: 'BRAND', value_name: 'Genérica' }, { id: 'MODEL', value_name: 'D20' }, { id: 'GTIN', value_name: '7890000000001' }], variations: [], _desc: { plain_text: 'Descrição antiga' }, ...o })
const adaptador = (ml, { escopos = 'offline_access read write', token = 'tok' } = {}) => criarAdaptadorML({ fetch: ml.fetch, tokenValido: async () => token, conta: () => ({ meli_user_id: 123, nickname: 'loja', escopos }), agora: () => '2026-10-07T12:00:00.000Z', espera: 0 })
const CLI = 'Cliente A'

// ── critério 7: escopo ficha não toca título/preço/estoque/imagens ───────────────────────────────────────────
await caso('ficha: payload só com attributes e nenhum campo proibido', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') } }), a = adaptador(ml)
  const proposta = { titulo: 'Título novo', preco: { preco_proposto: 150 }, descricao: 'nova', galeria: [{ imagem_id: 'i1', picture_id: 'p1', ordem: 0 }], atributos: [{ atributo_id: 'MODEL', valor_proposto: 'D20 Pro Relógio Inteligente' }, { atributo_id: 'GTIN', valor_proposto: '999' }, { atributo_id: 'PACKAGE_HEIGHT', valor_proposto: '10 cm' }, { atributo_id: 'MPN', valor_proposto: 'Promoção Dia dos Pais' }] }
  const r = await a.publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'ficha', proposta })
  assert.equal(r.estado, 'dry_run')
  assert.deepEqual(r.payload.map(p => p.grupo), ['ficha'])
  const corpo = r.payload[0].corpo
  assert.deepEqual(Object.keys(corpo), ['attributes'])
  assert.deepEqual(corpo.attributes, [{ id: 'MODEL', value_name: 'D20 Pro Relógio Inteligente' }])
  const b = r.validacao.bloqueios.map(x => x.campo)
  for (const c of ['titulo', 'preco', 'descricao', 'galeria', 'atributos.GTIN', 'atributos.PACKAGE_HEIGHT', 'atributos.MPN']) assert.ok(b.includes(c), `bloqueio esperado: ${c}`)
  assert.ok(ml.log.chamadas.every(c => c.metodo === 'GET'), 'dry-run não escreve')
  assert.equal(r.diff.length, 1); assert.equal(r.diff[0].de, 'D20')
})
await caso('validarProposta é pura e reprova termo promocional em campo factual', () => {
  const cap = { pode: { atributos: true, titulo: true }, atributos_categoria: [{ id: 'MANUFACTURER', editavel: true }] }
  const v = validarProposta(cap, { atributos: [{ atributo_id: 'MANUFACTURER', valor_proposto: 'Frete grátis relógio' }] }, 'ficha')
  assert.equal(v.ok, false); assert.match(v.bloqueios[0].motivo, /promocional/)
  assert.equal(validarProposta(cap, { titulo: 'x'.repeat(61) }, 'titulo_descricao').ok, false)
  assert.equal(validarProposta(cap, { titulo: 'ok' }, 'escopo_inventado').ok, false)
})
await caso('classificação de erro por status', () => {
  assert.deepEqual([401, 403, 400, 429, 0, 503].map(classificarErro), ['credencial_expirada', 'sem_permissao', 'validacao_rejeitada', 'limite_uso', 'processamento_pendente', 'transitorio'])
})

// ── capacidades: título travado após venda; catálogo; conta sem write ───────────────────────────────────────
await caso('capacidades: vendeu → sem título; catálogo → sem imagens; sem write → nada', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1', { sold_quantity: 3 }), MLB2: item('MLB2', { catalog_listing: true, catalog_product_id: 'MLB-P1' }) } })
  const a = adaptador(ml)
  const c1 = await a.consultarCapacidades(CLI, { anuncio_id: 'MLB1' })
  assert.equal(c1.pode.titulo, false); assert.equal(c1.pode.atributos, true); assert.equal(c1.pode.criar, false); assert.ok(c1.atributos_categoria.length)
  const c2 = await a.consultarCapacidades(CLI, { anuncio_id: 'MLB2' })
  assert.equal(c2.catalogo, true); assert.equal(c2.pode.imagens, false)
  const c3 = await adaptador(ml, { escopos: 'offline_access read' }).consultarCapacidades(CLI, { anuncio_id: 'MLB1' })
  assert.ok(Object.values(c3.pode).every(v => v === false)); assert.match(c3.observacoes[0], /write/)
  const c4 = await adaptador(ml, { token: null }).consultarCapacidades(CLI)
  assert.ok(Object.values(c4.pode).every(v => v === false))
})

// ── critério 13: catálogo → capa não suportada = pendência identificada, nunca sucesso ───────────────────────
await caso('catálogo: galeria vira pendência identificada e nada é enviado', async () => {
  const ml = criarML({ itens: { MLB2: item('MLB2', { catalog_listing: true }) } }), a = adaptador(ml)
  const r = await a.publicar({ cliente: CLI, anuncio_id: 'MLB2', escopo: 'galeria', proposta: { galeria: [{ imagem_id: 'i1', picture_id: 'p1', ordem: 0 }] }, live: true, chave_idem: 'k' })
  assert.equal(r.estado, 'pendente_dados'); assert.ok(r.pendencias.length); assert.match(r.motivo, /CATÁLOGO/)
  assert.ok(ml.log.chamadas.every(c => c.metodo === 'GET'))
})

// ── critério 12: variação alvo sem tocar irmãs ──────────────────────────────────────────────────────────────
await caso('galeria em item com variações: união de ids + irmãs preservadas; sem variacao alvo → bloqueio', async () => {
  const it = item('MLB3', { pictures: [{ id: 'pa' }, { id: 'pb' }, { id: 'pc' }], variations: [{ id: 11, price: 99.9, picture_ids: ['pa', 'pb'] }, { id: 22, price: 99.9, picture_ids: ['pc'] }] })
  const grupos = montarPayloads({ galeria: [{ imagem_id: 'i1', picture_id: 'nova1', ordem: 0 }, { imagem_id: 'i2', picture_id: 'pb', ordem: 1 }] }, it, { variacao_externa_id: '22' })
  const g = grupos[0]
  assert.deepEqual(g.corpo.pictures.map(p => p.id).sort(), ['nova1', 'pa', 'pb'].sort())        // pc saiu só da variação alvo; união cobre as irmãs
  assert.deepEqual(g.corpo.variations.find(v => v.id === 11), { id: 11, picture_ids: ['pa', 'pb'] })
  assert.deepEqual(g.corpo.variations.find(v => v.id === 22), { id: 22, picture_ids: ['nova1', 'pb'] })
  assert.ok(montarPayloads({ galeria: [{ imagem_id: 'i1', picture_id: 'nova1', ordem: 0 }] }, it, {})[0].bloqueio)
  const preco = montarPayloads({ preco: 120 }, it, { variacao_externa_id: '11' })[0]
  assert.deepEqual(preco.corpo, { variations: [{ id: 11, price: 120 }, { id: 22 }] })
})
await caso('payload nunca carrega status/estoque/categoria', () => {
  assert.throws(() => montarPayloads.call(null, { atributos: [{ id: 'GTIN', value_name: 'x' }] }, item('MLB1'), {}), /intocável/)
})

// ── critério 12: mudança externa durante a aprovação → conflito_externo, nada sai ───────────────────────────
await caso('mudança externa desde o diagnóstico → conflito_externo sem escrita', async () => {
  const antes = item('MLB1'), ml = criarML({ itens: { MLB1: item('MLB1', { title: 'Alguém mudou o título no painel' }) } }), a = adaptador(ml)
  const r = await a.publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'ficha', proposta: { atributos: [{ atributo_id: 'MODEL', valor_proposto: 'D20 Pro' }] }, live: true, chave_idem: 'k1', snapshot_diagnostico: { item: antes } })
  assert.equal(r.estado, 'conflito_externo'); assert.equal(r.divergencias[0].campo, 'titulo')
  assert.ok(ml.log.chamadas.every(c => c.metodo === 'GET'))
  assert.deepEqual(impressaoItem(antes).pictures, ['pic-a', 'pic-b'])
})

// ── live feliz: um PUT por grupo, descrição separada, estado em_conferencia (API aceitou ≠ publicado) ─────────
await caso('live: PUT por grupo, descrição em PUT separado (?api_version=2), em_conferencia + registros', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') } }), a = adaptador(ml)
  const r = await a.publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'oferta_completa', proposta: { titulo: 'Smartwatch D20 Pro', descricao: 'Nova descrição', atributos: [{ atributo_id: 'MODEL', valor_proposto: 'D20 Pro' }], preco: { preco_proposto: 129.9, piso: 100 } }, live: true, chave_idem: 'k2' })
  assert.equal(r.estado, 'em_conferencia')
  const escritas = ml.log.chamadas.filter(c => c.metodo !== 'GET')
  assert.deepEqual(escritas.map(c => `${c.metodo} ${c.caminho}`), ['PUT /items/MLB1', 'PUT /items/MLB1', 'PUT /items/MLB1', 'PUT /items/MLB1/description?api_version=2'])
  assert.deepEqual(escritas.map(c => Object.keys(c.corpo)[0]), ['attributes', 'title', 'price', 'plain_text'])
  assert.deepEqual(r.grupos_enviados, ['ficha', 'titulo', 'preco', 'descricao']); assert.deepEqual(r.retomar, [])
  assert.equal(r.registros.length, 4); assert.ok(r.registros.every(x => x.estado === 'enviado' && !JSON.stringify(x).includes('tok')), 'registro sem token')
  assert.ok(r.conferencia.campos.every(c => c.estado !== 'divergente')); assert.equal(r.conferencia.conclusivo, false)   // acabou de enviar: não é conclusivo
  assert.ok(r.snapshot_antes_json.includes('Smartwatch D20 Preto'))
})
await caso('live sem chave_idem é recusado antes de qualquer escrita', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') } })
  const r = await adaptador(ml).publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'ficha', proposta: { atributos: [{ atributo_id: 'MODEL', valor_proposto: 'x' }] }, live: true })
  assert.equal(r.estado, 'rejeitado'); assert.ok(ml.log.chamadas.every(c => c.metodo === 'GET'))
})

// ── critério 14: publicação parcial (fotos ok, ficha 400) → falha_parcial, reconciliação por leitura, retomar só a ficha ──
await caso('parcial: galeria aceita, ficha 400 → falha_parcial + retomar=[ficha,titulo]; retomada não reenvia galeria', async () => {
  let fichaFalha = true
  const ml = criarML({ itens: { MLB1: item('MLB1') } })
  const fetchBase = ml.fetch
  ml.fetch = async (url, init) => { const c = typeof init.body === 'string' ? JSON.parse(init.body) : null; if (init.method === 'PUT' && c?.attributes && fichaFalha) return resposta(400, { message: 'Validation error', cause: [{ code: 'item.attributes.invalid' }] }); return fetchBase(url, init) }
  const a = adaptador(ml)
  const proposta = { galeria: [{ imagem_id: 'i1', ordem: 0 }, { imagem_id: 'i2', ordem: 1 }], atributos: [{ atributo_id: 'MODEL', valor_proposto: 'D20 Pro' }], titulo: 'Smartwatch D20 Pro' }
  const imagens = [{ imagem_id: 'i1', bytes: Buffer.from('jpg1'), papel: 'capa', ordem: 0 }, { imagem_id: 'i2', bytes: Buffer.from('jpg2'), papel: 'beneficio', ordem: 1 }]
  const r = await a.publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'oferta_completa', proposta, imagens, live: true, chave_idem: 'k3' })
  assert.equal(r.estado, 'falha_parcial'); assert.equal(r.classe_erro, 'validacao_rejeitada')
  assert.deepEqual(r.grupos_enviados, ['galeria']); assert.deepEqual(r.retomar, ['ficha', 'titulo'])
  assert.equal(r.imagens.length, 2); assert.ok(r.imagens[0].picture_id)                                 // ids devolvidos para o core gravar em of_imagem
  assert.equal(r.registros.filter(x => x.etapa.startsWith('upload:')).length, 2)
  assert.equal(r.conferencia.campos.find(c => c.campo === 'galeria').estado, 'verificado')              // reconciliado por leitura: a galeria ESTÁ no canal
  assert.notEqual(r.conferencia.campos.find(c => c.campo === 'atributos.MODEL').estado, 'verificado')
  // retomada: mesma chave, grupos já enviados não saem de novo (janela de propagação), uploads não se repetem (picture_ids conhecidos)
  fichaFalha = false
  const antes = ml.log.chamadas.length
  const r2 = await a.publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'oferta_completa', proposta, imagens: r.imagens.map(i => ({ ...i, bytes: Buffer.from('x') })), live: true, chave_idem: 'k3', publicacao_anterior: { em: '2026-10-07T11:50:00.000Z', grupos_enviados: r.grupos_enviados } })
  const novas = ml.log.chamadas.slice(antes).filter(c => c.metodo !== 'GET')
  assert.deepEqual(novas.map(c => Object.keys(c.corpo)[0]), ['attributes', 'title'])
  assert.equal(r2.estado, 'em_conferencia'); assert.ok(r2.registros.some(x => x.estado === 'nao_enviado' && x.etapa === 'galeria'))
})

// ── critério 14: credencial expirada e limite do canal → estados corretos, nada "em processamento" genérico ──
await caso('credencial expirada → falha_recuperavel/credencial_expirada; 429 → aguardando_canal/limite_uso', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') } })
  const cap = await adaptador(ml).consultarCapacidades(CLI, { anuncio_id: 'MLB1' })
  const r1 = await adaptador(ml, { token: null }).publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'ficha', proposta: { atributos: [{ atributo_id: 'MODEL', valor_proposto: 'x' }] }, live: true, chave_idem: 'k', capacidades: cap })
  assert.equal(r1.estado, 'falha_recuperavel'); assert.equal(r1.classe_erro, 'credencial_expirada'); assert.match(r1.pendencias[0], /reconectar/)
  const ml2 = criarML({ itens: { MLB1: item('MLB1') }, falhas: { 'PUT /items/MLB1': 429 } })
  const r2 = await adaptador(ml2).publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'ficha', proposta: { atributos: [{ atributo_id: 'MODEL', valor_proposto: 'x' }] }, live: true, chave_idem: 'k' })
  assert.equal(r2.estado, 'aguardando_canal'); assert.equal(r2.classe_erro, 'limite_uso'); assert.deepEqual(r2.retomar, ['ficha'])
  assert.equal(ml2.log.chamadas.filter(c => c.metodo === 'PUT').length, 1, 'escrita não tem retry automático')
})

// ── critério 11: timeout na criação → consulta antes de repetir, sem duplicar ────────────────────────────────
await caso('criação: timeout → processamento_pendente; retomada consulta por SKU e NÃO faz 2º POST', async () => {
  const ml = criarML({ timeoutCriacao: true }), a = adaptador(ml)
  const proposta = { titulo: 'Smartwatch Novo', categoria_id: 'MLB1', preco: 199.9, estoque: 5, sku: 'SW-01', galeria: [{ picture_id: 'p1' }], atributos: [{ atributo_id: 'BRAND', valor_proposto: 'Marca' }], descricao: 'desc' }
  const dry = await a.criarAnuncio(CLI, proposta)
  assert.equal(dry.estado, 'dry_run'); assert.ok(dry.payload.attributes.some(x => x.id === 'SELLER_SKU' && x.value_name === 'SW-01')); assert.ok(dry.pendencias.some(p => /User Products/.test(p)))
  const r1 = await a.criarAnuncio(CLI, proposta, { live: true, chave_idem: 'c1' })
  assert.equal(r1.estado, 'aguardando_canal'); assert.equal(r1.classe_erro, 'processamento_pendente')
  const r2 = await a.criarAnuncio(CLI, proposta, { live: true, chave_idem: 'c1', publicacao_anterior: { classe_erro: r1.classe_erro } })
  assert.equal(r2.recuperado, true); assert.equal(r2.anuncio_id, 'MLB9000000001')
  assert.equal(ml.log.chamadas.filter(c => c.metodo === 'POST' && c.caminho === '/items').length, 1, 'um único POST /items')
  assert.ok(ml.log.chamadas.some(c => /seller_sku=SW-01/.test(c.caminho)))
  // consulta não acha nada mas a conta não pôde ser lida → NÃO repete
  const ml3 = criarML({ timeoutCriacao: true, semSku: true, falhas: { 'GET /users/123/items/search': 503 } })
  const r3 = await adaptador(ml3).criarAnuncio(CLI, proposta, { live: true, chave_idem: 'c1', publicacao_anterior: { classe_erro: 'processamento_pendente' } })
  assert.equal(r3.estado, 'aguardando_canal'); assert.equal(ml3.log.chamadas.filter(c => c.metodo === 'POST').length, 0)
  assert.equal((await adaptador(criarML(), { escopos: 'read' }).criarAnuncio(CLI, proposta, { live: true, chave_idem: 'x' })).estado, 'rejeitado')
  // critério 8 também na criação: MPN promocional → rejeitado, nenhum POST
  const ml4 = criarML()
  const r4 = await adaptador(ml4).criarAnuncio(CLI, { ...proposta, atributos: [{ atributo_id: 'MPN', valor_proposto: 'Promoção Dia dos Pais' }] }, { live: true, chave_idem: 'c2' })
  assert.equal(r4.estado, 'rejeitado'); assert.match(r4.motivo, /promocional.*MPN/); assert.equal(ml4.log.chamadas.filter(c => c.metodo === 'POST').length, 0)
})

// ── conferirPublicado: pictures[0] trocado pelo ML → divergente com aviso antes de regravar ─────────────────
await caso('conferirPublicado detecta pictures[0] trocado (e só é conclusivo após 30 min)', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1', { pictures: [{ id: 'recorte-do-ml', max_size: '1200x871' }, { id: 'nova1' }, { id: 'nova2' }] }) } }), a = adaptador(ml)
  const esperado = { galeria: ['nova1', 'nova2'], atributos: [{ atributo_id: 'MODEL', valor: 'D20' }], enviado_em: '2026-10-07T10:00:00.000Z' }
  const r = await a.conferirPublicado(CLI, 'MLB1', esperado)
  assert.equal(r.conclusivo, true)
  const g = r.campos.find(c => c.campo === 'galeria')
  assert.equal(g.estado, 'divergente'); assert.match(g.divergencia, /pictures\[0\] trocado.*recorte-do-ml.*1200x871/)
  assert.equal(r.campos.find(c => c.campo === 'atributos.MODEL').estado, 'verificado')
  const cedo = await a.conferirPublicado(CLI, 'MLB1', { ...esperado, enviado_em: '2026-10-07T11:50:00.000Z' })
  assert.equal(cedo.conclusivo, false); assert.equal(cedo.campos.find(c => c.campo === 'galeria').estado, 'processando'); assert.equal(cedo.reconferir_em, '2026-10-07T12:20:00.000Z')
})

// ── importar + tarifas com fonte/data; falha = a confirmar ──────────────────────────────────────────────────
await caso('importarAnuncio e consultarRegrasComerciais com fonte; API fora → a confirmar', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') } }), a = adaptador(ml)
  const imp = await a.importarAnuncio(CLI, 'MLB1')
  assert.equal(imp.ok, true); assert.equal(imp.descricao, 'Descrição antiga'); assert.ok(imp.categoria.atributos.find(x => x.id === 'PACKAGE_HEIGHT').editavel === false); assert.ok(imp.snapshot_json.includes('"item"'))
  const t = await a.consultarRegrasComerciais(CLI, { preco: 129.9, categoria_id: 'MLB1', listing_type: 'gold_special' })
  assert.equal(t.estado, 'consultado'); assert.equal(t.comissao_pct, 16.5); assert.equal(t.tarifa_fixa, 6); assert.match(t.fonte, /listing_prices\?price=129.9/); assert.ok(t.consultado_em)
  const ml2 = criarML({ falhas: { 'GET /sites/MLB/listing_prices': 500 } })
  const t2 = await adaptador(ml2).consultarRegrasComerciais(CLI, { preco: 10, categoria_id: 'MLB1' })
  assert.equal(t2.estado, 'a confirmar'); assert.equal(t2.comissao_pct, null)
  const imp403 = await adaptador(criarML({ falhas: { 'GET /items/MLB1': 403 } })).importarAnuncio(CLI, 'MLB1')
  assert.equal(imp403.classe, 'sem_permissao')
})
await caso('imagem por URL não autorizada é recusada antes do upload', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') } }), a = adaptador(ml)
  const r = await a.publicar({ cliente: CLI, anuncio_id: 'MLB1', escopo: 'galeria', proposta: { galeria: [{ imagem_id: 'i1', ordem: 0 }] }, imagens: [{ imagem_id: 'i1', url: 'https://drive.google.com/file/d/abc/view' }], live: true, chave_idem: 'k9' })
  assert.equal(r.estado, 'falha_recuperavel'); assert.match(r.erro, /não autorizada/); assert.equal(ml.log.chamadas.filter(c => c.metodo !== 'GET').length, 0)
})

console.log(`teste-ofertas-ml: ${n} casos OK`)
