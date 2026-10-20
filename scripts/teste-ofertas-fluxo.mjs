// Fluxo ponta a ponta do módulo Ofertas (src/lib/ofertas-fluxo.js + src/rotas-ofertas.js) com banco EM MEMÓRIA e Mercado Livre em stub (fetch injetado).
// Cobre: importar → preparar → aprovar v1 → revisar (v2) → aprovação antiga inválida (critério 9) → aprovar v2 (enfileira, critério 10) → publicar dry-run →
// publicar live → conferir (só conclusivo após propagação) → monitorar (sem causalidade); critério 14 (credencial expirada, limite 429, publicação parcial
// com retomada só do necessário); preço recalculado no momento invalida aprovação; critério 16 (lista, totais e CSV com o mesmo filtro); isolamento nas rotas (17).
// Rodar: node scripts/teste-ofertas-fluxo.mjs
process.env.PS_OFERTAS_MEMORIA = '1'                       // ANTES dos imports: ofertas.js e rotas-ofertas.js não abrem data/db.sqlite
import assert from 'node:assert/strict'
import http from 'node:http'
import Database from 'better-sqlite3'
import express from 'express'
const { SCHEMA_OFERTAS } = await import('../src/lib/ofertas-schema.js')
const O = await import('../src/lib/ofertas.js')
const { criarAdaptadorML } = await import('../src/lib/ofertas-ml.js')
const { criarFluxo } = await import('../src/lib/ofertas-fluxo.js')
const { criarRotasOfertas, rotasOfertas } = await import('../src/rotas-ofertas.js')
const { validar, serializar } = await import('../src/lib/filtros.js')
assert.equal(O.ofertas, null); assert.equal(rotasOfertas, null)

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = async (fn, rx, status) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); if (rx) assert.match(e.message, rx); if (status) assert.equal(e.status, status) }
const A = 'Cliente A', B = 'Cliente B', POR = 'Tester'
const HOJE = '2026-10-07'

// ── Mercado Livre em memória (mesmo stub do teste do adaptador) ──
const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => corpo == null ? '' : JSON.stringify(corpo) })
function criarML({ itens = {}, falhas = {} } = {}) {
  const log = { chamadas: [] }, descricoes = {}
  const catAttrs = [{ id: 'BRAND', name: 'Marca', value_type: 'string', tags: { required: true } }, { id: 'MODEL', name: 'Modelo', value_type: 'string', tags: {} }, { id: 'GTIN', name: 'GTIN', value_type: 'string', tags: { hidden: true } }, { id: 'COLOR', name: 'Cor', value_type: 'string', tags: { variation_attribute: true } }]
  const fetch = async (url, init = {}) => {
    const u = new URL(url), metodo = init.method || 'GET'
    assert.ok(init.headers?.Authorization?.startsWith('Bearer '), 'toda chamada leva o token'); assert.notEqual(metodo, 'DELETE')
    const corpo = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null
    log.chamadas.push({ metodo, caminho: u.pathname + u.search, corpo })
    const k = `${metodo} ${u.pathname}`
    if (falhas[k] !== undefined) return resposta(falhas[k], { message: 'erro simulado', cause: [{ code: 'item.invalid' }] })
    let m
    if (metodo === 'GET' && (m = u.pathname.match(/^\/items\/(MLB\d+)$/))) return itens[m[1]] ? resposta(200, itens[m[1]]) : resposta(404, { message: 'not found' })
    if (metodo === 'GET' && (m = u.pathname.match(/^\/items\/(MLB\d+)\/description$/))) return descricoes[m[1]] || itens[m[1]]?._desc ? resposta(200, descricoes[m[1]] || itens[m[1]]._desc) : resposta(404, {})
    if (metodo === 'GET' && /^\/categories\/MLB\d+\/attributes$/.test(u.pathname)) return resposta(200, catAttrs)
    if (metodo === 'GET' && /^\/categories\/MLB\d+$/.test(u.pathname)) return resposta(200, { id: 'MLB1', name: 'Smartwatches', path_from_root: [{ name: 'Eletrônicos' }, { name: 'Smartwatches' }] })
    if (metodo === 'PUT' && (m = u.pathname.match(/^\/items\/(MLB\d+)$/))) {
      const it = itens[m[1]]
      if (corpo.title) it.title = corpo.title
      if (corpo.price != null) it.price = corpo.price
      if (corpo.attributes) for (const a of corpo.attributes) { const x = it.attributes.find(y => y.id === a.id); if (x) x.value_name = a.value_name; else it.attributes.push({ id: a.id, value_name: a.value_name }) }
      return resposta(200, it)
    }
    if ((metodo === 'PUT' || metodo === 'POST') && (m = u.pathname.match(/^\/items\/(MLB\d+)\/description$/))) { descricoes[m[1]] = { plain_text: corpo.plain_text }; return resposta(200, descricoes[m[1]]) }
    assert.fail(`chamada inesperada: ${k}`)
  }
  return { fetch, log, itens, falhas }
}
const item = (id, o = {}) => ({ id, title: 'Smartwatch D20 Preto', price: 99.9, status: 'active', category_id: 'MLB1', listing_type_id: 'gold_special', sold_quantity: 0, available_quantity: 10, catalog_listing: false, seller_id: 123, date_created: '2026-01-10T00:00:00.000Z', permalink: `https://produto.mercadolivre.com.br/${id}`, thumbnail: `https://http2.mlstatic.com/${id}.jpg`,
  pictures: [{ id: 'pic-a', secure_url: `https://http2.mlstatic.com/${id}-a.jpg`, max_size: '1200x1200' }], attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'Genérica' }, { id: 'MODEL', name: 'Modelo', value_name: 'D20' }, { id: 'GTIN', name: 'GTIN', value_name: '7890000000001' }, { id: 'SELLER_SKU', name: 'SKU', value_name: 'SW-D20-PRETO' }], variations: [], _desc: { plain_text: 'Descrição antiga' }, ...o })

// ── cenário: banco em memória com of_* + meli_* mínimos, série de 28 dias, conta conectada ──
function cenario({ token = 'tok', ml = criarML({ itens: { MLB1: item('MLB1') } }) } = {}) {
  const h = new Database(':memory:')
  h.exec(SCHEMA_OFERTAS)
  h.exec(`CREATE TABLE meli_contas (cliente TEXT PRIMARY KEY, meli_user_id INTEGER, nickname TEXT, escopos TEXT, erro TEXT DEFAULT '', expira_em TEXT DEFAULT '');
    CREATE TABLE meli_item (cliente TEXT, item_id TEXT, titulo TEXT, thumb TEXT, preco REAL, estoque INTEGER, fotos INTEGER, status TEXT, catalogo INTEGER, criado_em TEXT, PRIMARY KEY (cliente, item_id));
    CREATE TABLE meli_serie_item (cliente TEXT, item_id TEXT, dia TEXT, unidades INTEGER, receita REAL, visitas INTEGER, PRIMARY KEY (cliente, item_id, dia));
    CREATE TABLE meli_ads_dia (cliente TEXT, item_id TEXT, dia TEXT, prints INTEGER, clicks INTEGER, custo REAL, receita REAL, unidades INTEGER, PRIMARY KEY (cliente, item_id, dia))`)
  h.prepare("INSERT INTO meli_contas VALUES (?, 123, 'loja-a', 'offline_access read write', '', '')").run(A)
  h.prepare("INSERT INTO meli_item VALUES (?, 'MLB1', 'Smartwatch D20 Preto', 'https://t/MLB1.jpg', 99.9, 10, 1, 'active', 0, '2026-01-10')").run(A)
  const ins = h.prepare('INSERT INTO meli_serie_item VALUES (?,?,?,?,?,?)')
  for (let i = 1; i <= 28; i++) ins.run(A, 'MLB1', `2026-09-${String(i).padStart(2, '0')}`, i % 4 === 0 ? 1 : 0, i % 4 === 0 ? 99.9 : 0, 12)   // 7 unidades / 336 visitas no período
  let relogio = '2026-10-07T12:00:00.000Z'
  const agora = () => relogio
  const of = O.criarOfertas(h, { custosSku: () => new Map() })
  const adaptador = criarAdaptadorML({ fetch: ml.fetch, tokenValido: async () => token, conta: c => h.prepare('SELECT meli_user_id, nickname, escopos FROM meli_contas WHERE cliente = ?').get(c) || null, agora, espera: 0 })
  const fluxo = criarFluxo({ of, h, ml: adaptador, imagens: null, agora, hoje: () => HOJE })
  const avancar = min => { relogio = new Date(Date.parse(relogio) + min * 60e3).toISOString() }
  // custo + regra completos (nada presumido): C = 50, comissão 12 + tributos 8 → piso (10%) 71,43 e alvo (20%) 83,33
  const prontoParaPreco = (vid) => {
    of.registrarCusto(A, { variante_id: vid, custo_compra: 50, frete_entrada: 0, embalagem: 0, preparo: 0, outros: 0, fonte: 'planilha CUSTOS' }, { por: POR })
    of.registrarRegraCanal(A, { canal: 'ML', conta_id: '123', modalidade: 'gold_special', comissao_pct: 12, tarifa_fixa: 0, base_comissao: 'receita', tributos_pct: 8, frete_vendedor: 0, desconto_pct: 0, promo_pct: 0, devolucao_pct: 0, margem_min_pct: 10, margem_alvo_pct: 20, fonte: 'cliente (PRECOS_POR_CANAL)', consultado_em: '2026-10-01', validade: '2026-12-31' }, { por: POR })
  }
  return { h, of, ml, adaptador, fluxo, avancar, agora, prontoParaPreco }
}
// atalho: importa MLB1, confirma referência, custo+regra, atributo proposto com evidência, abre o job e prepara v1
async function jobPreparado(c, { escopo = 'oferta_completa', objetivo = 'melhorar_conversao', modo = 'publicar_apos_aprovacao' } = {}) {
  const imp = await c.fluxo.importarExistente(A, 'MLB1', { por: POR })
  const vid = imp.itens[0].variante_id, aid = imp.itens[0].anuncio
  c.of.confirmarReferencia({ cliente: A, variante_id: vid, por: 'Dono', origem_fotos: [{ origem: 'anuncio', ref: 'MLB1:pic-a' }] })
  c.prontoParaPreco(vid)
  c.of.upsertAtributo(A, { variante_id: vid, canal: 'ML', categoria_id: 'MLB1', atributo_id: 'MODEL', nome: 'Modelo', valor_atual: 'D20', valor_proposto: 'D20 Pro', fonte: 'caixa do produto', evidencia: 'foto da caixa (bases/CONFIRMACAO.json)' }, { por: POR })
  const job = c.of.abrir({ cliente: A, anuncio_id: aid, escopo, objetivo, modo, solicitante: POR })
  // método IMA: na oferta completa o título só é aprovável depois da galeria — aqui a galeria atual fica (dispensa registrada com motivo)
  if (escopo === 'oferta_completa') c.of.dispensarEtapa(A, job.id, { etapa: 'galeria', motivo: 'galeria atual fica (teste de mecânica do fluxo)', por: POR })
  const prep = c.fluxo.prepararEstrategia(A, job.id, { por: POR })
  return { imp, vid, aid, job: prep.job, prep }
}
const campos = j => Object.keys(j.proposta.conteudo).filter(k => k !== 'mudancas')

// ── importar anúncio existente ──
await caso('importarExistente: variante pela chave externa (SELLER_SKU), produto criado, atributos da categoria com valor atual, snapshot e baseline da série', async () => {
  const c = cenario()
  const r = await c.fluxo.importarExistente(A, 'MLB1', { por: POR })
  assert.equal(r.ok, true); assert.equal(r.criados.produtos, 1); assert.equal(r.criados.variantes, 1)
  const v = c.of.obterVariante(A, r.itens[0].variante_id)
  assert.equal(v.sku, 'SW-D20-PRETO'); assert.equal(v.anuncios.length, 1); assert.equal(v.anuncios[0].anuncio_id, 'MLB1'); assert.equal(v.anuncios[0].preco_atual, 99.9); assert.equal(v.anuncios[0].snapshot.item.title, 'Smartwatch D20 Preto')
  const atrs = c.of.listarAtributos(A, { variante_id: v.id })
  assert.ok(atrs.find(a => a.atributo_id === 'BRAND' && a.valor_atual === 'Genérica' && a.obrigatorio === 1)); assert.ok(atrs.find(a => a.atributo_id === 'MODEL' && a.valor_atual === 'D20'))
  assert.equal(r.itens[0].baseline.unidades, 5); assert.equal(r.itens[0].baseline.visitas, 240); assert.equal(r.itens[0].baseline.periodo.dias, 20, 'janela = 28 dias até ontem (09/09–06/10): só 20 dias coletados; dia ausente não vira zero')
  // reimportar não duplica: mesma variante, mesmo anúncio
  const r2 = await c.fluxo.importarExistente(A, 'MLB1', { por: POR })
  assert.equal(r2.criados.variantes, 0); assert.equal(r2.itens[0].variante_id, v.id); assert.equal(c.of.listarAnuncios(A).length, 1)
  // sem token → estado nomeado com pendência, nada criado
  const c2 = cenario({ token: null })
  const r3 = await c2.fluxo.importarExistente(A, 'MLB1', { por: POR })
  assert.equal(r3.ok, false); assert.equal(r3.estado, 'falha_recuperavel'); assert.match(r3.pendencias[0], /reconectar/); assert.equal(c2.of.listarProdutos(A).length, 0)
})

// ── GATE 0 + estratégia ──
await caso('prepararEstrategia: sem referência → pendente_dados; com referência → diagnóstico em lentes + proposta v1 só com campos possíveis (preço calculado com custo+regra)', async () => {
  const c = cenario()
  const imp = await c.fluxo.importarExistente(A, 'MLB1', { por: POR }), vid = imp.itens[0].variante_id
  const j0 = c.of.abrir({ cliente: A, anuncio_id: imp.itens[0].anuncio, escopo: 'preco', objetivo: 'preservar_margem', solicitante: POR })
  const p0 = c.fluxo.prepararEstrategia(A, j0.id, { por: POR })
  assert.equal(p0.job.estado, 'pendente_dados'); assert.deepEqual(p0.pendencias, ['referencia_nao_confirmada'])
  c.of.confirmarReferencia({ cliente: A, variante_id: vid, por: 'Dono', origem_fotos: [{ origem: 'anuncio', ref: 'MLB1:pic-a' }] })
  // sem custo: escopo preço não tem proposta possível → pendente_dados com o motivo (critério 4: bloqueio declarado, não número inventado)
  const p1 = c.fluxo.prepararEstrategia(A, j0.id, { por: POR })
  assert.equal(p1.job.estado, 'pendente_dados'); assert.match(p1.pendencias[0], /custo ausente/)
  assert.equal(p1.diagnostico.lentes.viabilidade.severidade, 'sem_dado'); assert.equal(p1.diagnostico.lentes.descoberta.sinal, 'descoberta_ok')
  c.prontoParaPreco(vid)
  const p2 = c.fluxo.prepararEstrategia(A, j0.id, { por: POR })
  assert.equal(p2.job.estado, 'estrategia_preparada'); assert.deepEqual(campos(p2.job), ['preco'])
  const pr = p2.job.proposta.conteudo.preco
  assert.equal(pr.preco_proposto, 83.33); assert.equal(pr.piso, 71.43); assert.equal(pr.simulacao, false); assert.deepEqual(pr.bloqueios, [])
  assert.equal(p2.job.proposta.baseline.snapshot.item.id, 'MLB1'); assert.ok(p2.job.proposta.diagnostico.explicacao.length > 20)
  await falha(() => c.fluxo.prepararEstrategia(A, j0.id, { por: POR }), /já foi preparada/, 409)
})

// ── aprovação versionada, revisão, fila, dry-run, live, conferência, monitoramento ──
await caso('fluxo feliz: aprovar v1 enfileira → revisar cria v2 e invalida v1 (critério 9) → aprovar v2 → dry-run sem escrita → live PUT por grupo → conferir → monitorar', async () => {
  const c = cenario()
  const { job, prep } = await jobPreparado(c)
  assert.equal(job.estado, 'estrategia_preparada'); assert.deepEqual(campos(job).sort(), ['atributos', 'descricao', 'preco', 'titulo'])   // galeria vazia não é campo a aprovar
  assert.ok(!('galeria' in job.proposta.conteudo)); assert.ok(!('pendencias' in job.proposta.conteudo))
  assert.equal(job.proposta.conteudo.atributos[0].valor_proposto, 'D20 Pro'); assert.ok(job.proposta.conteudo.titulo.length <= 60)
  // aprovar v1 campo a campo: tudo aprovado + modo publicar_apos_aprovacao → na_fila (sem clique redundante)
  const a1 = c.fluxo.aprovar(A, job.id, { versao: 1, campos: ['titulo', 'descricao'], autor: 'Consultor' })
  assert.equal(a1.enfileirado, false); assert.equal(a1.job.estado, 'em_revisao'); assert.deepEqual(a1.campos_pendentes.sort(), ['atributos', 'preco'])
  const a2 = c.fluxo.aprovar(A, job.id, { versao: 1, campos: ['atributos', 'preco'], autor: 'Consultor' })
  assert.equal(a2.enfileirado, true); assert.equal(a2.job.estado, 'na_fila')
  // revisar título → v2, volta à revisão, aprovação de v1 inválida; aprovar v1 de novo é recusado (critério 9)
  const rv = c.fluxo.revisar(A, job.id, { titulo: 'Smartwatch D20 Pro Genérica Preto' }, { por: 'Analista' })
  assert.equal(rv.versao.versao, 2); assert.equal(rv.job.estado, 'em_revisao'); assert.ok(rv.job.aprovacoes.every(a => a.valida === false)); assert.match(rv.job.aprovacoes[0].invalidada_motivo, /versão 2/)
  assert.deepEqual(rv.job.campos_pendentes.sort(), ['atributos', 'descricao', 'preco', 'titulo'])
  await falha(() => c.fluxo.aprovar(A, job.id, { versao: 1, campos: ['titulo'], autor: 'Consultor' }), /não é a atual/, 409)
  await falha(() => c.fluxo.publicar(A, job.id, { live: true, por: POR }), /só com job aprovado/, 409)
  const a3 = c.fluxo.aprovar(A, job.id, { versao: 2, campos: ['titulo', 'descricao', 'atributos', 'preco'], autor: 'Consultor' })
  assert.equal(a3.enfileirado, true); assert.equal(a3.job.estado, 'na_fila')
  // dry-run: payload por grupo, diff antes/depois, nenhuma escrita
  const antes = c.ml.log.chamadas.length
  const dry = await c.fluxo.publicar(A, job.id, { por: POR })
  assert.equal(dry.estado, 'dry_run'); assert.equal(dry.live, false); assert.deepEqual(dry.payload.map(p => p.grupo), ['ficha', 'titulo', 'preco', 'descricao'])
  assert.ok(dry.diff.find(d => d.campo === 'titulo' && d.de === 'Smartwatch D20 Preto' && d.para === 'Smartwatch D20 Pro Genérica Preto')); assert.ok(dry.diff.find(d => d.campo === 'preco' && d.para === 83.33))
  assert.ok(c.ml.log.chamadas.slice(antes).every(x => x.metodo === 'GET')); assert.equal(c.of.obterJob(A, job.id).estado, 'na_fila')
  assert.equal(dry.preco_recalculado.divergente, false)
  // live: um PUT por grupo, publicação mestre + uma por grupo, job em conferência (API aceitou ≠ publicado)
  const live = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  assert.equal(live.estado, 'em_conferencia'); assert.deepEqual(live.grupos_enviados, ['ficha', 'titulo', 'preco', 'descricao']); assert.deepEqual(live.retomar, [])
  const escritas = c.ml.log.chamadas.filter(x => x.metodo !== 'GET')
  assert.equal(escritas.length, 4); assert.deepEqual(escritas.map(x => Object.keys(x.corpo)[0]), ['attributes', 'title', 'price', 'plain_text'])
  const pubs = c.of.listarPublicacoes(A, job.id)
  assert.equal(pubs.filter(p => p.operacao === 'atualizar').length, 1); assert.equal(pubs.find(p => p.operacao === 'atualizar').estado, 'aceita')
  assert.deepEqual(pubs.filter(p => p.operacao.startsWith('grupo:')).map(p => p.estado), ['enviada', 'enviada', 'enviada', 'enviada'])
  assert.ok(!JSON.stringify(pubs).includes('"tok"'), 'nenhum token nas publicações')
  // mesma chave de idempotência: publicar de novo não cria outra publicação nem duplica envio (estado não permite)
  await falha(() => c.fluxo.publicar(A, job.id, { live: true, por: POR }), /só com job aprovado/, 409)
  // conferir cedo: não conclusivo → aguardando_canal com reconferir_em; 31 min depois → verificado → publicado_confirmado
  const cf1 = await c.fluxo.conferir(A, job.id, { por: POR })
  assert.equal(cf1.conclusivo, false); assert.equal(cf1.job.estado, 'aguardando_canal'); assert.ok(cf1.reconferir_em); assert.ok(cf1.campos.every(x => x.estado !== 'divergente'), 'antes da propagação nada é divergente, só verificado ou processando')
  c.avancar(31)
  const cf2 = await c.fluxo.conferir(A, job.id, { por: POR })
  assert.equal(cf2.conclusivo, true); assert.equal(cf2.divergencias.length, 0); assert.equal(cf2.job.estado, 'publicado_confirmado'); assert.ok(cf2.job.publicado_em)
  const pubs2 = c.of.listarPublicacoes(A, job.id)
  assert.ok(pubs2.filter(p => p.operacao.startsWith('grupo:')).every(p => p.estado === 'verificada')); assert.equal(pubs2.find(p => p.operacao === 'atualizar').estado, 'verificada')
  assert.equal(c.of.obterAnuncio(A, job.anuncio_id).snapshot.item.title, 'Smartwatch D20 Pro Genérica Preto', 'snapshot do anúncio atualizado pela leitura')
  // monitorar: antes × depois, confusores declarados, sem causalidade
  const mon = c.fluxo.monitorar(A, job.id, { por: POR })
  assert.equal(mon.job.estado, 'monitorando'); assert.equal(mon.janela_dias, 14); assert.match(mon.nota, /nenhuma causalidade/)
  assert.ok('preco_atual' in mon.confusores && 'estoque_atual' in mon.confusores && 'campanha_ads_no_periodo' in mon.confusores)
  assert.equal(mon.depois.dias_coletados, 0); assert.equal(mon.depois.receita, null, 'dia não coletado não é zero'); assert.equal(mon.completo, false)
  // auditoria: todas as etapas em of_evento
  const acoes = c.of.eventos(A, { entidade: 'job', entidade_id: job.id, limite: 500 }).map(e => e.acao)
  for (const a of ['aberto', 'estrategia_preparada', 'revisado', 'publicacao_dry_run', 'publicado_live', 'conferido', 'monitorado', 'transicao']) assert.ok(acoes.includes(a), `evento ${a}`)
  assert.equal(prep.versao.versao, 1)
})

// ── critério 14: credencial expirada, limite do canal, publicação parcial com retomada ──
await caso('14a. credencial expirada na hora de publicar → falha_recuperavel com pendência "reconectar", nada enviado', async () => {
  const c = cenario()
  const { job } = await jobPreparado(c)
  c.fluxo.aprovar(A, job.id, { versao: 1, campos: campos(job), autor: 'Consultor' })
  // a conexão cai depois da aprovação: o adaptador passa a não ter token
  const semToken = criarAdaptadorML({ fetch: c.ml.fetch, tokenValido: async () => null, conta: () => ({ meli_user_id: 123, nickname: 'loja-a', escopos: 'read write' }), agora: c.agora, espera: 0 })
  const f2 = criarFluxo({ of: c.of, h: c.h, ml: semToken, agora: c.agora, hoje: () => HOJE })
  const r = await f2.publicar(A, job.id, { live: true, por: POR })
  assert.equal(r.estado, 'falha_recuperavel'); assert.equal(r.job.estado, 'falha_recuperavel'); assert.match(r.pendencias.join(' '), /não conectada|reconectar/i)
  assert.ok(c.ml.log.chamadas.every(x => x.metodo === 'GET'))
  // reconectou: retoma do ponto (falha_recuperavel → na_fila → publicando → em_conferencia)
  const r2 = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  assert.equal(r2.estado, 'em_conferencia'); assert.equal(c.ml.log.chamadas.filter(x => x.metodo !== 'GET').length, 4)
})
await caso('14b. limite de uso (429) no 1º grupo → aguardando_canal, nenhum grupo marcado como enviado; conferência conclusiva vira falha_parcial e a retomada envia tudo', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') }, falhas: { 'PUT /items/MLB1': 429 } })
  const c = cenario({ ml })
  const { job } = await jobPreparado(c)
  c.fluxo.aprovar(A, job.id, { versao: 1, campos: campos(job), autor: 'Consultor' })
  const r = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  assert.equal(r.estado, 'aguardando_canal'); assert.equal(r.classe_erro, 'limite_uso'); assert.deepEqual(r.grupos_enviados, []); assert.match(r.pendencias.join(' '), /limite/)
  const pubs = c.of.listarPublicacoes(A, job.id)
  assert.equal(pubs.find(p => p.operacao === 'atualizar').estado, 'processando'); assert.equal(pubs.find(p => p.operacao === 'grupo:ficha').estado, 'falhou')
  delete ml.falhas['PUT /items/MLB1']
  c.avancar(31)
  const cf = await c.fluxo.conferir(A, job.id, { por: POR })
  assert.equal(cf.conclusivo, true); assert.ok(cf.divergencias.length >= 3); assert.equal(cf.job.estado, 'falha_parcial')
  const r2 = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  assert.equal(r2.estado, 'em_conferencia'); assert.deepEqual(r2.grupos_enviados.sort(), ['descricao', 'ficha', 'preco', 'titulo'])
})
await caso('14c. publicação parcial: ficha/título/preço entram, descrição é rejeitada → falha_parcial; a retomada reenvia SÓ a descrição', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') }, falhas: { 'PUT /items/MLB1/description': 400 } })
  const c = cenario({ ml })
  const { job } = await jobPreparado(c)
  c.fluxo.aprovar(A, job.id, { versao: 1, campos: campos(job), autor: 'Consultor' })
  const r = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  assert.equal(r.estado, 'falha_parcial'); assert.deepEqual(r.grupos_enviados, ['ficha', 'titulo', 'preco']); assert.deepEqual(r.retomar, ['descricao']); assert.equal(r.classe_erro, 'validacao_rejeitada')
  const pubs = c.of.listarPublicacoes(A, job.id)
  assert.equal(pubs.find(p => p.operacao === 'grupo:descricao').estado, 'falhou'); assert.match(pubs.find(p => p.operacao === 'grupo:descricao').erro, /validacao_rejeitada/)
  assert.equal(pubs.filter(p => p.operacao.startsWith('grupo:') && p.estado === 'enviada').length, 3)
  assert.equal(pubs.find(p => p.operacao === 'atualizar').estado, 'falhou'); assert.match(pubs.find(p => p.operacao === 'atualizar').erro, /PARCIAL|retomar/i)
  delete ml.falhas['PUT /items/MLB1/description']
  const antes = ml.log.chamadas.length
  const r2 = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  const escritas = ml.log.chamadas.slice(antes).filter(x => x.metodo !== 'GET')
  assert.equal(escritas.length, 1); assert.match(escritas[0].caminho, /description/)
  assert.equal(r2.estado, 'em_conferencia'); assert.deepEqual(r2.grupos_enviados.sort(), ['descricao', 'ficha', 'preco', 'titulo']); assert.ok(r2.pendencias.some(p => /retomada/.test(p)))
  assert.equal(c.of.listarPublicacoes(A, job.id).filter(p => p.operacao === 'atualizar').length, 1, 'mesma chave: a publicação mestre não duplica')
})

await caso('GATE 0 na retomada: referência contestada depois de falha_parcial → publicar live recusa ANTES de qualquer envio (critério 5)', async () => {
  const ml = criarML({ itens: { MLB1: item('MLB1') }, falhas: { 'PUT /items/MLB1/description': 400 } })
  const c = cenario({ ml })
  const { job, vid } = await jobPreparado(c)
  c.fluxo.aprovar(A, job.id, { versao: 1, campos: campos(job), autor: 'Consultor' })
  assert.equal((await c.fluxo.publicar(A, job.id, { live: true, por: POR })).estado, 'falha_parcial')
  delete ml.falhas['PUT /items/MLB1/description']
  c.of.contestarReferencia({ cliente: A, variante_id: vid, por: 'Dono', motivo: 'foto de outro produto' })   // job em falha_parcial não volta sozinho para pendente_dados
  const antes = ml.log.chamadas.length
  await falha(() => c.fluxo.publicar(A, job.id, { live: true, por: POR }), /GATE 0/, 409)
  assert.deepEqual(ml.log.chamadas.slice(antes).filter(x => x.metodo !== 'GET'), [], 'nenhum PUT saiu com a referência revogada')
})
await caso('isolamento: importar anúncio de OUTRA conta do ML (seller ≠ conta do cliente) é recusado e nada é criado', async () => {
  const c = cenario({ ml: criarML({ itens: { MLB7: item('MLB7', { seller_id: 999, attributes: [{ id: 'SELLER_SKU', value_name: 'ALHEIO-1' }] }) } }) })
  const r = await c.fluxo.importarExistente(A, 'MLB7', { por: POR })
  assert.equal(r.ok, false); assert.equal(r.classe, 'sem_permissao'); assert.match(r.pendencias[0], /outra conta|não é da conta/i)
  assert.equal(c.of.listarProdutos(A).length, 0); assert.equal(c.of.listarAnuncios(A).length, 0)
})

// ── preço recalculado no momento da publicação ──
await caso('preço: custo sobe depois da aprovação → publicar live recalcula, cria nova versão, invalida a aprovação e volta para revisão', async () => {
  const c = cenario()
  const { job, vid } = await jobPreparado(c, { escopo: 'preco', objetivo: 'preservar_margem' })
  c.fluxo.aprovar(A, job.id, { versao: 1, campos: ['preco'], autor: 'Consultor' })
  c.of.registrarCusto(A, { variante_id: vid, custo_compra: 70, frete_entrada: 0, embalagem: 0, preparo: 0, outros: 0, fonte: 'ERP' }, { por: POR })   // piso passa a 100 > 83,33 aprovado
  const r = await c.fluxo.publicar(A, job.id, { live: true, por: POR })
  assert.equal(r.estado, 'em_revisao'); assert.equal(r.versao, 2); assert.match(r.motivo, /materialmente/)
  const j = c.of.obterJob(A, job.id)
  assert.equal(j.proposta.conteudo.preco.piso, 100); assert.ok(j.aprovacoes.every(a => !a.valida)); assert.ok(c.ml.log.chamadas.every(x => x.metodo === 'GET'))
  assert.ok(j.proposta.conteudo.mudancas.some(m => m.origem === 'recalculo'))
})

// ── reprovação com motivo, cancelamento, revisão fora do escopo ──
await caso('reprovar exige motivo e leva a rejeitado; nova rodada reaproveita; revisar fora do escopo é recusado; cancelar é terminal', async () => {
  const c = cenario()
  const { job } = await jobPreparado(c, { escopo: 'ficha', objetivo: 'corrigir_ficha' })
  await falha(() => c.fluxo.reprovar(A, job.id, { motivo: '', autor: 'Consultor' }), /motivo/)
  await falha(() => c.fluxo.revisar(A, job.id, { titulo: 'x' }, { por: POR }), /não permite editar/)
  const rj = c.fluxo.reprovar(A, job.id, { motivo: 'modelo errado', autor: 'Consultor' })
  assert.equal(rj.job.estado, 'rejeitado')
  const p2 = c.fluxo.prepararEstrategia(A, job.id, { por: POR })
  assert.equal(p2.job.estado, 'em_revisao'); assert.equal(p2.versao.versao, 2)
  const cc = c.fluxo.cancelar(A, job.id, { motivo: 'cliente desistiu', por: POR })
  assert.equal(cc.job.estado, 'cancelado'); await falha(() => c.fluxo.prepararEstrategia(A, job.id, { por: POR }), /encerrado|já foi/, 409)
})

// ── capacidades honestas ──
await caso('capacidades: ML conectado com escopos, custos/regras contados, imagens pendentes sem provedor, outros canais não implementados', async () => {
  const c = cenario()
  await jobPreparado(c)
  const cap = await c.fluxo.capacidades(A)
  assert.equal(cap.canais.ML.estado, 'leitura_e_escrita'); assert.equal(cap.canais.ML.pode.criar, true); assert.equal(cap.canais.SHO.estado, 'nao_implementado')
  assert.equal(cap.custos.com_custo, 1); assert.equal(cap.regras_comerciais.vigentes, 1); assert.equal(cap.imagens.provedor, 'nenhum'); assert.equal(cap.drive.estado, 'pendente'); assert.equal(cap.referencia.variantes_confirmadas, 1)
  const capB = await c.fluxo.capacidades(B)
  assert.equal(capB.canais.ML.estado, 'nao_conectado'); assert.equal(capB.custos.variantes, 0)
  const g = await c.fluxo.gerarImagens(A, { job_id: c.of.listarJobs(A)[0].id, por: POR })   // sem provedor injetado → pendente, nunca sucesso
  assert.equal(g.estado, 'pendente'); assert.match(g.motivo, /provedor/); assert.deepEqual(g.candidatas, [])
})

// ── fase 5: preservação (Trocar/Preservar) na revisão e no prompt de imagem ──
await caso('revisar: título sem a cor da variante gera pendência na versão (não bloqueia); título corrigido limpa; prompt de imagem leva PRESERVAR cor/kit e "Proibido inventar"', async () => {
  const c = cenario()
  const imp = await c.fluxo.importarExistente(A, 'MLB1', { por: POR }), vid = imp.itens[0].variante_id
  c.of.atualizarVariante(A, vid, { cor: 'Azul', quantidade_kit: 3 }, { por: POR })            // identidade definida ANTES da referência (mudar depois revoga o GATE 0)
  c.of.confirmarReferencia({ cliente: A, variante_id: vid, por: 'Dono', origem_fotos: [{ origem: 'anuncio', ref: 'MLB1:pic-a' }] })
  const job = c.of.abrir({ cliente: A, anuncio_id: imp.itens[0].anuncio, escopo: 'titulo_descricao', objetivo: 'melhorar_conversao', solicitante: POR })
  const prep = c.fluxo.prepararEstrategia(A, job.id, { por: POR })
  assert.equal(prep.job.estado, 'estrategia_preparada'); assert.match(prep.job.proposta.conteudo.titulo, /Azul/); assert.match(prep.job.proposta.conteudo.titulo, /Kit 3 un/)
  assert.ok(!prep.pendencias.some(p => /preserva|não coube/.test(p)), prep.pendencias.join(' | '))
  const rv = c.fluxo.revisar(A, job.id, { titulo: 'Smartwatch D20 Genérica Kit 3 un' }, { por: 'Analista' })
  assert.equal(rv.versao.versao, 2); assert.equal(rv.job.estado, 'estrategia_preparada', 'pendência não bloqueia a edição nem muda o estado')
  assert.deepEqual(rv.pendencias, ['título revisado não preserva cor (Azul) da ficha — revisar antes de publicar'])
  assert.deepEqual(rv.job.proposta.diagnostico.proposta_pendencias, rv.pendencias, 'fica registrada na versão do job')
  const rv2 = c.fluxo.revisar(A, job.id, { titulo: 'Smartwatch D20 Genérica Azul Kit 3 un' }, { por: 'Analista' })
  assert.deepEqual(rv2.pendencias, []); assert.deepEqual(rv2.job.proposta.diagnostico.proposta_pendencias, [], 'título corrigido limpa a pendência do campo')
  const rv3 = c.fluxo.revisar(A, job.id, { descricao: 'Relógio bonito.' }, { por: 'Analista' })
  assert.ok(rv3.pendencias[0].startsWith('descrição revisada não preserva')); assert.match(rv3.pendencias[0], /cor \(Azul\)/); assert.match(rv3.pendencias[0], /kit \(3\)/)
  // prompt de imagem: PRESERVAR gerado da ficha com fonte + proibido inventar (briefing padrão e do operador)
  let visto = []
  const prov = { gerar: async ({ briefing }) => { visto.push(briefing); return { estado: 'pendente', motivo: 'stub', candidatas: [] } }, disponivel: () => ({ provedor: 'stub' }) }
  const f2 = criarFluxo({ of: c.of, h: c.h, ml: c.adaptador, imagens: prov, agora: c.agora, hoje: () => HOJE })
  await f2.gerarImagens(A, { job_id: job.id, por: POR }); await f2.gerarImagens(A, { job_id: job.id, por: POR, briefing: 'capa limpa' })
  for (const t of visto) { assert.match(t, /PRESERVAR \(fatos da ficha, com fonte\): cor Azul; kit 3; marca Genérica; modelo D20\./); assert.match(t, /Proibido inventar/) }
  assert.match(visto[0], /^Imagem "capa" do produto da referência.*Não alterar o produto\. PRESERVAR/); assert.match(visto[1], /^capa limpa PRESERVAR/)
})

// ── rotas: lista + totais + CSV com o mesmo filtro (16) e isolamento por cliente (17) ──
await caso('rotas: lista, totais e CSV batem com o mesmo filtro; cliente B não vê job de A (404 sem vazar); [Comercial] recusado; live exige confirmar', async () => {
  const c = cenario()
  const { job, vid } = await jobPreparado(c)
  c.fluxo.aprovar(A, job.id, { versao: 1, campos: campos(job), autor: 'Consultor' })
  // segunda variante/anúncio sem job, para o filtro separar
  c.ml.itens.MLB2 = item('MLB2', { title: 'Fone BT', attributes: [{ id: 'BRAND', value_name: 'X' }, { id: 'SELLER_SKU', value_name: 'FONE-1' }] })
  c.h.prepare("INSERT INTO meli_item VALUES (?, 'MLB2', 'Fone BT', '', 50, 3, 1, 'active', 0, '2026-02-01')").run(A)
  await c.fluxo.importarExistente(A, 'MLB2', { por: POR })
  const app = express(); app.use(express.json()); app.use(criarRotasOfertas({ fluxo: c.fluxo, of: c.of, hoje: () => HOJE }))
  const srv = await new Promise(ok => { const s = http.createServer(app).listen(0, '127.0.0.1', () => ok(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const api = async (metodo, caminho, corpo) => { const r = await fetch(base + caminho, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }
  try {
    // filtro: estado do job = na_fila, período de venda em setembro
    const f = validar({ painel: 'ofertas', arvore: { campo: 'status', operador: 'igual', valor: 'na_fila' }, periodo: { campo: 'data_venda', preset: 'personalizado', de: '2026-09-01', ate: '2026-09-30' } }, { hoje: HOJE })
    const s = serializar(f)
    const lista = await api('GET', `/api/ofertas/anuncios?cliente=${encodeURIComponent(A)}&f=${s}`)
    assert.equal(lista.status, 200); assert.equal(lista.body.total_sem_filtro, 2); assert.equal(lista.body.itens.length, 1); assert.equal(lista.body.totais.anuncios, 1)
    const it = lista.body.itens[0]
    assert.equal(it.anuncio_id, 'MLB1'); assert.equal(it.sku, 'SW-D20-PRETO'); assert.equal(it.vendas_unidades, 7); assert.equal(it.faturamento, 699.3); assert.equal(it.status, 'na_fila'); assert.equal(it.escopo, 'oferta_completa')
    assert.equal(it.margem_pct, 29.95, 'margem no preço atual em centavos: 9990 − 1199 (12%) − 799 (8%) − 5000 = 2992 → 29,95%'); assert.match(it.margem_fonte, /regra/); assert.ok(it.foto); assert.ok(it.ultima_sincronizacao); assert.equal(it.criado_em, '2026-01-10')
    assert.equal(lista.body.totais.faturamento, 699.3); assert.equal(lista.body.totais.vendas_unidades, 7); assert.ok(lista.body.filtro.chips.length >= 2)
    const semFiltro = await api('GET', `/api/ofertas/anuncios?cliente=${encodeURIComponent(A)}&preset=este_ano`)
    assert.equal(semFiltro.body.itens.length, 2); assert.equal(semFiltro.body.itens.find(x => x.anuncio_id === 'MLB2').margem_fonte, 'sem custo')
    // CSV respeita o mesmo filtro: cabeçalho de totais + linha de colunas + 1 linha
    const csv = await api('GET', `/api/ofertas/exportar.csv?cliente=${encodeURIComponent(A)}&f=${s}`)
    const linhas = csv.body.split('\r\n')
    assert.equal(linhas.length, 3); assert.match(linhas[0], /anúncios 1/); assert.match(linhas[0], /faturamento 699.3/); assert.ok(linhas[2].includes('"SW-D20-PRETO"') && linhas[2].includes('"MLB1"'))
    // detalhe do job: versões, antes/depois, eventos; outro cliente → 404 sem ecoar nada
    const det = await api('GET', `/api/ofertas/jobs/${job.id}?cliente=${encodeURIComponent(A)}`)
    assert.equal(det.status, 200); assert.equal(det.body.versoes.length, 1); assert.ok(det.body.antes_depois.length >= 3); assert.ok(det.body.eventos.length > 3); assert.ok(det.body.diagnostico.lentes)
    const outro = await api('GET', `/api/ofertas/jobs/${job.id}?cliente=${encodeURIComponent(B)}`)
    assert.equal(outro.status, 404); assert.ok(!JSON.stringify(outro.body).includes(job.id) && !JSON.stringify(outro.body).includes('SW-D20'))
    assert.deepEqual((await api('GET', `/api/ofertas/jobs?cliente=${encodeURIComponent(B)}`)).body.jobs, [])
    assert.equal((await api('POST', `/api/ofertas/jobs/${job.id}/preparar`, { cliente: B, por: POR })).status, 404)
    assert.equal((await api('POST', `/api/ofertas/jobs/${job.id}/publicar`, { cliente: B, por: POR, live: true, confirmar: true })).status, 404)
    assert.equal((await api('GET', `/api/ofertas/anuncios?cliente=${encodeURIComponent(B)}`)).body.itens.length, 0)
    assert.equal((await api('GET', '/api/ofertas/anuncios?cliente=' + encodeURIComponent('[Comercial] Loja · 1a2b3c4d'))).status, 400)
    assert.equal((await api('GET', '/api/ofertas/anuncios')).status, 400)
    // live exige confirmar; sem ele é dry-run mesmo com live:true? não: recusa explicitamente
    const semConf = await api('POST', `/api/ofertas/jobs/${job.id}/publicar`, { cliente: A, por: POR, live: true })
    assert.equal(semConf.status, 400); assert.match(semConf.body.erro, /confirmar/)
    const dry = await api('POST', `/api/ofertas/jobs/${job.id}/publicar`, { cliente: A, por: POR })
    assert.equal(dry.body.estado, 'dry_run'); assert.ok(c.ml.log.chamadas.every(x => x.metodo === 'GET'))
    const sem415 = await fetch(base + '/api/ofertas/jobs', { method: 'POST', body: 'x' }); assert.equal(sem415.status, 415)
    // abrir em lote: resultado individual (um inválido não derruba o outro)
    const lote = await api('POST', '/api/ofertas/jobs', { cliente: A, solicitante: POR, escopo: 'ficha', objetivo: 'corrigir_ficha', itens: [{ variante_id: vid }, { variante_id: 'nao-existe' }] })
    assert.equal(lote.status, 201); assert.equal(lote.body.abertos, 1); assert.equal(lote.body.falhas, 1); assert.equal(lote.body.itens[1].ok, false)
    // aprovar pela rota no modo publicar_apos_aprovacao dispara a publicação live em segundo plano (critério 10)
    const j2 = c.of.abrir({ cliente: A, anuncio_id: c.of.listarAnuncios(A).find(a => a.anuncio_id === 'MLB2').id, escopo: 'titulo_descricao', objetivo: 'elevar_clique', solicitante: POR })
    c.of.confirmarReferencia({ cliente: A, variante_id: j2.variante_id, por: 'Dono', origem_fotos: [{ origem: 'anuncio', ref: 'MLB2:pic-a' }] })
    const prep = await api('POST', `/api/ofertas/jobs/${j2.id}/preparar`, { cliente: A, por: POR })
    assert.equal(prep.body.job.estado, 'estrategia_preparada')
    const ap = await api('POST', `/api/ofertas/jobs/${j2.id}/aprovar`, { cliente: A, autor: 'Consultor', versao: 1, campos: Object.keys(prep.body.versao.conteudo).filter(k => k !== 'mudancas') })
    assert.equal(ap.body.enfileirado, true); assert.ok(ap.body.publicacao.tarefa)
    for (let i = 0; i < 50 && (await api('GET', `/api/ofertas/tarefas/${ap.body.publicacao.tarefa}?cliente=${encodeURIComponent(A)}`)).body.estado === 'rodando'; i++) await new Promise(r => setTimeout(r, 20))
    const tarefa = await api('GET', `/api/ofertas/tarefas/${ap.body.publicacao.tarefa}?cliente=${encodeURIComponent(A)}`)
    assert.equal(tarefa.body.estado, 'concluido'); assert.equal(tarefa.body.resultado.estado, 'em_conferencia'); assert.equal(c.of.obterJob(A, j2.id).estado, 'em_conferencia')
    assert.equal((await api('GET', `/api/ofertas/tarefas/${ap.body.publicacao.tarefa}?cliente=${encodeURIComponent(B)}`)).status, 404)
  } finally { srv.close() }
})

console.log(`\nteste-ofertas-fluxo: ${n} casos OK`)
