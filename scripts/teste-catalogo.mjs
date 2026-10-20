// Autoteste do anúncio de CATÁLOGO (selo + bloqueio de recomendação de conteúdo; pedido do David de 08/10/2026): "se for catálogo próprio pode até realizar
// alterações, mas se for catálogo de terceiros não tem como alterar". Sem rede, sem banco real (db.js em memória). Cobre: predicado e prioridades; migração
// idempotente e coleta do catalog_product_id; marcação manual (prévia → confirmar, nome do líder, padrão seguro = terceiros); regras do plano filtradas e mantidas;
// Ofertas (abrirJob, proposta, adaptador); rotas HTTP; selo nos payloads; efeito de regerar o plano; PDF do plano.
// Rodar: node scripts/teste-catalogo.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
process.env.PS_OFERTAS_MEMORIA = '1'      // ofertas.js não abre data/db.sqlite
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import Database from 'better-sqlite3'
const { origemCatalogo, editavelConteudo, edicaoDiretaConteudo, ORIGENS } = await import('../src/lib/catalogo.js')
const { criarCatalogo, migrarCatalogo, SCHEMA_CATALOGO } = await import('../src/lib/catalogo-db.js')
const { CATALOGO, TEXTO_CATALOGO, regraBloqueada, escopoDeConteudo } = await import('../src/lib/catalogo-cfg.js')
const { criarRotasCatalogo } = await import('../src/rotas-catalogo.js')
const { db, hojeLocal } = await import('../src/lib/db.js')
const { gravarItens, addDias } = await import('../src/lib/meli-serie.js')
const { montarAcoes, salvarAcoesAnuncio, VIA_OFERTA } = await import('../src/lib/plano-anuncios.js')
const { classificarCurvas, benchmarkConversao, algoritmo, diagnosticarConta } = await import('../src/lib/diagnostico-conta.js')
const { criarDiagnostico } = await import('../src/lib/ofertas-diagnostico.js')
const { criarAdaptadorML, validarProposta } = await import('../src/lib/ofertas-ml.js')
const { SCHEMA_OFERTAS } = await import('../src/lib/ofertas-schema.js')
const O = await import('../src/lib/ofertas.js')
const { criarFluxo } = await import('../src/lib/ofertas-fluxo.js')
const { linhasDoPeriodo } = await import('../src/lib/anuncios.js')
const { maisVendidos } = await import('../src/lib/gmv.js')
const { renderPlanoConta } = await import('../src/lib/render-plano-conta.js')
const { perfilDoCliente, salvarPerfil, listarPerfis } = await import('../src/lib/perfil-cliente.js')
const { distribuir } = await import('../src/lib/distribuir-notion.js')
const { rotasPlanos } = await import('../src/rotas-planos.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = async (fn, rx, status) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); if (rx) assert.match(e.message, rx); if (status) assert.equal(e.status, status) }
const LIDER = 'Líder Teste', A = 'Cliente A', B = 'Cliente B', SEGREDO = 'SEGREDO_NAO_ECOAR'
const HOJE = '2026-10-05'

// ═════════ 1. predicado único ═════════════════════════════════════════════════════════════════════════
await caso('predicado: item.catalogo falsy → "nao"; catalog_product_id NÃO é a flag; sem marcação catálogo = terceiros (padrão seguro)', () => {
  assert.deepEqual(ORIGENS, ['nao', 'proprio', 'terceiros'])
  for (const it of [null, undefined, {}, { catalogo: 0 }, { catalogo: false }, { catalogo: '' }, { id: 'MLB1', catalogo_produto_id: 'MLB-P1', catalog_product_id: 'MLB-P1' }]) {
    assert.equal(origemCatalogo(it, { padrao: 'proprio' }), 'nao'); assert.equal(editavelConteudo(it, { padrao: 'terceiros' }), true); assert.equal(edicaoDiretaConteudo(it), true)
  }
  assert.equal(origemCatalogo({ id: 'MLB1', catalogo: 1 }), 'terceiros', 'sem ctx e sem marcação: terceiros')
  assert.equal(origemCatalogo({ id: 'MLB1', catalogo: true }, {}), 'terceiros'); assert.equal(origemCatalogo({ id: 'MLB1', catalogo: true }, { padrao: null }), 'terceiros')
  assert.equal(origemCatalogo({ id: 'MLB1', catalogo: true }, { padrao: 'qualquer' }), 'terceiros', 'padrão desconhecido nunca vira próprio')
  assert.equal(editavelConteudo({ catalogo: true }), false)
})
await caso('predicado: exceção por anúncio > padrão do cliente > terceiros; Map e objeto; id herdado de Object nunca casa', () => {
  const m = new Map([['MLB2', 'terceiros'], ['MLB3', 'proprio']]), ctx = { padrao: 'proprio', excecoes: m }
  assert.equal(origemCatalogo({ id: 'MLB1', catalogo: 1 }, ctx), 'proprio', 'padrão do cliente')
  assert.equal(origemCatalogo({ id: 'MLB2', catalogo: 1 }, ctx), 'terceiros', 'exceção por anúncio vence o padrão')
  assert.equal(origemCatalogo({ item_id: 'MLB3', catalogo: 1 }, { padrao: 'terceiros', excecoes: m }), 'proprio', 'item_id também identifica o anúncio')
  assert.equal(origemCatalogo({ anuncio_id: 'MLB3', catalogo: 1 }, { excecoes: { MLB3: 'proprio' } }), 'proprio', 'excecoes como objeto')
  assert.equal(origemCatalogo({ id: 'constructor', catalogo: 1 }, { padrao: 'terceiros', excecoes: {} }), 'terceiros'); assert.equal(origemCatalogo({ id: '__proto__', catalogo: 1 }, { excecoes: {} }), 'terceiros')
  assert.equal(origemCatalogo({ id: 'MLB9', catalogo: 1 }, { padrao: 'proprio', excecoes: { MLB9: 'lixo' } }), 'proprio', 'exceção inválida é ignorada')
  assert.equal(origemCatalogo({ id: 'MLB2', catalogo: 0 }, ctx), 'nao', 'não é catálogo: exceção nenhuma muda isso')
  // editável = "nao" e "proprio" (o próprio pode propor correção); edição DIRETA no item só fora do catálogo
  assert.deepEqual(['nao', 'proprio', 'terceiros'].map(o => editavelConteudo({ id: 'x', catalogo: 1, catalogo_origem: o })), [false, true, false], 'sem ctx vale o item já resolvido ({ nao } com catalogo é contradição → terceiros)')
  assert.equal(editavelConteudo({ catalogo_origem: 'nao' }), true); assert.equal(editavelConteudo({ catalogo_origem: 'proprio' }), true); assert.equal(editavelConteudo({ catalogo_origem: 'terceiros' }), false)
  assert.equal(edicaoDiretaConteudo({ catalogo_origem: 'proprio' }), false); assert.equal(edicaoDiretaConteudo({ catalogo_origem: 'nao' }), true)
})

// ═════════ 2. migração e coleta ═══════════════════════════════════════════════════════════════════════
await caso('migração aditiva e idempotente em banco legado; colunas e tabela no banco do db.js; CHECK da origem', () => {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE meli_item (cliente TEXT, item_id TEXT, catalogo INTEGER, PRIMARY KEY (cliente, item_id)); CREATE TABLE perfil_cliente (cliente TEXT PRIMARY KEY, perfis_json TEXT NOT NULL DEFAULT '[]', objetivo TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT '')")
  h.prepare("INSERT INTO meli_item VALUES ('X','MLB1',1)").run(); h.prepare("INSERT INTO perfil_cliente (cliente, atualizado_em) VALUES ('X','t')").run()
  migrarCatalogo(h); migrarCatalogo(h); migrarCatalogo(h)
  const cols = t => h.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  assert.equal(cols('meli_item').filter(c => c === 'catalogo_produto_id').length, 1); assert.equal(cols('perfil_cliente').filter(c => c === 'catalogo_proprio').length, 1)
  assert.equal(h.prepare("SELECT catalogo_produto_id c FROM meli_item").get().c, '', 'linha antiga ganha o padrão vazio'); assert.equal(h.prepare('SELECT catalogo_proprio c FROM perfil_cliente').get().c, null, 'NULL = terceiros')
  assert.deepEqual(cols('catalogo_origem'), ['cliente', 'item_id', 'origem', 'por', 'em'])
  assert.throws(() => h.prepare("INSERT INTO catalogo_origem VALUES ('X','MLB1','dono','p','t')").run(), /CHECK/)
  const vazio = new Database(':memory:'); migrarCatalogo(vazio); assert.ok(vazio.prepare("SELECT 1 FROM sqlite_master WHERE name = 'catalogo_origem'").get(), 'banco sem meli_item/perfil_cliente não quebra')
  assert.ok(db.prepare('PRAGMA table_info(meli_item)').all().some(c => c.name === 'catalogo_produto_id') && db.prepare('PRAGMA table_info(perfil_cliente)').all().some(c => c.name === 'catalogo_proprio'), 'db.js aplica a migração')
  assert.match(SCHEMA_CATALOGO, /IF NOT EXISTS/)
})
await caso('coleta: o catalog_product_id é gravado (e atualizado); item tradicional com produto de catálogo guarda o id mas catalogo = 0', () => {
  const base = { title: 'T', permalink: 'https://produto.mercadolivre.com.br/MLB-1', thumbnail: 'http://t/x.jpg', price: 10, status: 'active', available_quantity: 5, pictures: [{}], shipping: {}, listing_type_id: 'gold_special', date_created: '2026-01-01T00:00:00Z' }
  gravarItens(A, [{ ...base, id: 'MLB101', catalog_listing: true, catalog_product_id: 'MLB-P1' }, { ...base, id: 'MLB102', catalog_listing: false, catalog_product_id: 'MLB-P2' }, { ...base, id: 'MLB103' }])
  const q = id => db.prepare('SELECT catalogo, catalogo_produto_id p FROM meli_item WHERE cliente = ? AND item_id = ?').get(A, id)
  assert.deepEqual(q('MLB101'), { catalogo: 1, p: 'MLB-P1' }); assert.deepEqual(q('MLB102'), { catalogo: 0, p: 'MLB-P2' }); assert.deepEqual(q('MLB103'), { catalogo: 0, p: '' })
  gravarItens(A, [{ ...base, id: 'MLB101', catalog_listing: true, catalog_product_id: 'MLB-P9' }]); assert.equal(q('MLB101').p, 'MLB-P9', 'atualiza na leitura seguinte')
  assert.equal(origemCatalogo({ id: 'MLB102', catalogo: q('MLB102').catalogo }), 'nao', 'ligado a produto de catálogo ≠ anúncio de catálogo')
})

// ═════════ 3. marcação manual (núcleo) ════════════════════════════════════════════════════════════════
const cat = criarCatalogo(db, { validarPor: n => n === LIDER ? LIDER : '', agora: () => '2026-10-08T10:00:00.000Z' })
await caso('marcação do cliente: padrão seguro = terceiros; prévia não grava; confirmar === true estrito; perfil do relatório não é afetado', async () => {
  gravarItens(A, [{ id: 'MLB104', title: 'Cat 4', permalink: 'https://produto.mercadolivre.com.br/MLB-4', price: 10, status: 'paused', catalog_listing: true, shipping: {}, pictures: [] }])
  const r0 = cat.resumo(A)
  assert.deepEqual({ ...r0, excecoes: undefined }, { cliente: A, padrao: 'terceiros', total: 2, ativos: 1, terceiros: 2, proprio: 0, excecoes: undefined }, '2 de catálogo (1 ativo), todos terceiros sem marcação')
  assert.equal(cat.contexto(A).padrao, 'terceiros')
  const p = cat.definirPadrao({ cliente: A, proprio: true, por: LIDER })
  assert.equal(p.ok, true); assert.equal(p.previa, true); assert.equal(p.de, 'terceiros'); assert.equal(p.para, 'proprio'); assert.equal(p.mudam, 2); assert.match(p.texto, /PRÓPRIOS/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM perfil_cliente WHERE cliente = ?').get(A).n, 0, 'prévia não escreve')
  for (const c of ['true', 1, 'sim', {}, [], null, undefined, 'false']) assert.equal(cat.definirPadrao({ cliente: A, proprio: true, por: LIDER, confirmar: c }).previa, true, `confirmar=${JSON.stringify(c)} é prévia`)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM perfil_cliente WHERE cliente = ?').get(A).n, 0)
  const g = cat.definirPadrao({ cliente: A, proprio: true, por: LIDER, confirmar: true })
  assert.equal(g.ok, true); assert.equal(g.previa, false); assert.equal(g.gravado_por, LIDER); assert.equal(g.resumo.padrao, 'proprio'); assert.equal(g.resumo.proprio, 2); assert.equal(g.resumo.terceiros, 0)
  assert.equal(db.prepare('SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(A).c, 1)
  // a linha nasce só para guardar o marcador: o perfil do relatório continua o padrão da config, sem aviso
  const pf = perfilDoCliente(A); assert.equal(pf.origem, 'padrao'); assert.deepEqual(pf.avisos, [])
  // salvar o perfil depois NÃO apaga o marcador (e o marcador não depende do perfil)
  salvarPerfil({ cliente: A, perfis: [listarPerfis()[0].id], por: LIDER }); assert.equal(db.prepare('SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(A).c, 1)
  assert.equal(cat.definirPadrao({ cliente: A, proprio: false, por: LIDER, confirmar: true }).resumo.padrao, 'terceiros'); assert.equal(db.prepare('SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(A).c, 0)
  assert.equal(cat.definirPadrao({ cliente: A, proprio: null, por: LIDER, confirmar: true }).resumo.padrao, 'terceiros'); assert.equal(db.prepare('SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(A).c, null)
  assert.equal(cat.definirPadrao({ cliente: B, proprio: null, por: LIDER, confirmar: true }).ok, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM perfil_cliente WHERE cliente = ?').get(B).n, 0, 'apagar a marcação de quem nunca marcou não cria linha')
})
await caso('validações do núcleo: mensagens fixas sem eco; "por" fora da lista de líder/consultor = 403; isolamento por cliente', async () => {
  await falha(() => cat.definirPadrao({ cliente: A, proprio: SEGREDO, por: LIDER }), /"proprio" deve ser true, false ou null/, 400)
  await falha(() => cat.definirPadrao({ cliente: A, proprio: true, por: SEGREDO }), /só líderes e consultores/, 403)
  await falha(() => cat.definirPadrao({ cliente: A, proprio: true, por: '' }), /informe "por"/, 400)
  await falha(() => cat.definirPadrao({ cliente: '', proprio: true, por: LIDER }), /informe "cliente"/, 400)
  for (const fn of [() => cat.definirPadrao({ cliente: A, proprio: SEGREDO, por: SEGREDO }), () => cat.definirExcecao({ cliente: A, item_id: SEGREDO, origem: 'proprio', por: LIDER }), () => cat.definirExcecao({ cliente: A, item_id: 'MLB101', origem: SEGREDO, por: LIDER })]) {
    let e; try { fn() } catch (x) { e = x } assert.ok(e && !e.message.includes(SEGREDO), 'a mensagem nunca repete o valor recebido')
  }
  // exceção por anúncio: precisa ser do cliente e de catálogo
  await falha(() => cat.definirExcecao({ cliente: B, item_id: 'MLB101', origem: 'proprio', por: LIDER }), /anúncio não encontrado neste cliente/, 404)
  const naoCat = cat.definirExcecao({ cliente: A, item_id: 'MLB103', origem: 'proprio', por: LIDER, confirmar: true }); assert.equal(naoCat.ok, false); assert.match(naoCat.motivo, /não é de catálogo/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM catalogo_origem').get().n, 0)
  const pv = cat.definirExcecao({ cliente: A, item_id: 'MLB101', origem: 'proprio', por: LIDER }); assert.equal(pv.previa, true); assert.equal(pv.de, 'terceiros'); assert.equal(pv.para, 'proprio'); assert.equal(db.prepare('SELECT COUNT(*) n FROM catalogo_origem').get().n, 0)
  assert.equal(cat.definirExcecao({ cliente: A, item_id: 'mlb101', origem: 'proprio', por: LIDER, confirmar: 'true' }).previa, true, '"true" (string) não confirma')
  const g = cat.definirExcecao({ cliente: A, item_id: 'mlb101', origem: 'proprio', por: LIDER, confirmar: true }); assert.equal(g.ok, true); assert.equal(g.resumo.proprio, 1); assert.equal(g.resumo.terceiros, 1)
  assert.deepEqual(g.resumo.excecoes.map(x => [x.item_id, x.origem, x.por, x.titulo]), [['MLB101', 'proprio', LIDER, 'T']])
  assert.equal(origemCatalogo({ id: 'MLB101', catalogo: 1 }, cat.contexto(A)), 'proprio'); assert.equal(origemCatalogo({ id: 'MLB101', catalogo: 1 }, cat.contexto(B)), 'terceiros', 'a exceção de A não vaza para B')
  assert.deepEqual([...cat.origensDe(A, ['MLB101', 'MLB102', 'MLB104', 'MLB999'])], [['MLB101', 'proprio'], ['MLB102', 'nao'], ['MLB104', 'terceiros'], ['MLB999', 'nao']])
  const volta = cat.definirExcecao({ cliente: A, item_id: 'MLB101', origem: null, por: LIDER, confirmar: true }); assert.equal(volta.resumo.excecoes.length, 0); assert.equal(volta.resumo.proprio, 0)
})

// ═════════ 4. regras do plano por anúncio ═════════════════════════════════════════════════════════════
const item = o => ({ id: 'MLB1', titulo: 'Produto de teste', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x-_JM', thumb: '', preco: 50, estoque: 400, fotos: 8, frete_gratis: true, catalogo: false,
  u: 20, r: 1000, v: 300, u0: 20, r0: 1000, v0: 300, visOk: true, conv: 6.7, vel_dia: 0.71, cobertura: 560, ads: null, ads_ant: null, buy_box: null, logistica: '', avaliacoes: null, ptw: null, ...o })
const serie = (antes, depois) => { const o = {}; for (let t = Date.parse('2026-08-23T12:00:00Z'); t <= Date.parse('2026-10-04T12:00:00Z'); t += 864e5) { const d = new Date(t).toISOString().slice(0, 10); o[d] = d < '2026-09-20' ? antes : depois } return o }
function diagDe(itens, extra = {}) {
  classificarCurvas(itens, null); const b = benchmarkConversao(itens); classificarCurvas(itens, b?.conv)
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: '__teste__', hoje: HOJE, periodo: { de: '2026-09-07', ate: '2026-10-04', anterior: { de: '2026-08-10', ate: '2026-09-06' } },
    resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, conversao_conta: b?.conv, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: b, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, clicks: 0, prints: 0, anterior: { roas: null } }, economia: null, custos_informados: false, itens, janelas: [], pendencias: [], algoritmo_versao: algoritmo.versao,
    vendas_dia_sem_mudanca: serie(5, 5), ...extra }
}
const bom = () => item({ id: 'MLB10', r: 5000, u: 100, v: 600, conv: 16.7 })
// anúncio relevante, com tráfego e conversão baixa, 3 fotos (sinal de conteúdo), frete grátis (sem sinal de entrega), curva A, Ads com custo (ads_otimizar_antes)
const cand = (origem, o = {}) => item({ id: 'MLB50', r: 8000, u: 30, u0: 40, v: 500, v0: 500, conv: 6, fotos: 3, catalogo: origem !== 'nao', catalogo_origem: origem, ...o })
const doItem = (origem, o, extra) => montarAcoes('__teste__', diagDe([bom(), cand(origem, o)], extra), { hoje: HOJE })
const regrasDe = (a, id = 'MLB50') => a.filter(x => x.item_id === id).map(x => x.regra.replace('anuncio_', ''))
const comoDe = (a, regra, id = 'MLB50') => a.find(x => x.item_id === id && x.regra === 'anuncio_' + regra)?.dados.como.join(' | ') || ''
const CONTEUDO = /foto|conteúdo|dúvidas que ele teria|Abrir o anúncio como comprador/i
const ADS = { prints: 9000, clicks: 80, custo: 120, receita: 400, unidades: 5, ctr: 0.9, roas: 3.3, acos: 30 }

await caso('configuração: regras bloqueadas/filtradas/mantidas no Algoritmo (v1.4.0: motor de diagnóstico) e textos fixos', () => {
  assert.equal(algoritmo.versao, '1.6.0'); assert.equal(CATALOGO.padrao_seguro, 'terceiros')   // 1.5.0: regras de saúde da conta; 1.6.0: ponto de reposição com segurança + lead time informado — nenhuma lista de catálogo muda
  assert.equal(TEXTO_CATALOGO.terceiros, 'Conteúdo controlado pelo catálogo: ajuste preço, estoque, frete e a caixa de compra.')
  assert.equal(TEXTO_CATALOGO.proprio, 'Conteúdo do catálogo: só por sugestão de correção, com revisão do Mercado Livre.')
  assert.deepEqual(CATALOGO.regras.bloqueadas_terceiros, ['conteudo_fotos', 'duplicacao_estrategica', 'queda_ctr_ads']);   // queda_ctr_ads: a capa do catálogo não é do vendedor (v1.4.0) assert.deepEqual(CATALOGO.regras.bloqueadas_proprio, ['duplicacao_estrategica'])
  assert.deepEqual(CATALOGO.regras.filtradas, ['ima_conversao', 'ads_otimizar_antes', 'sazonal', 'queda_conversao_anuncio'])   // queda_conversao_anuncio perde a causa de conteúdo em catálogo (v1.4.0)
  for (const r of CATALOGO.regras.mantidas) assert.ok(!regraBloqueada(r, 'terceiros') && !regraBloqueada(r, 'proprio') && !CATALOGO.regras.filtradas.includes(r), r)
  for (const r of ['catalogo_buybox', 'frete_gratis', 'ads_entrar', 'ads_escalar', 'ads_reduzir', 'estoque_ruptura', 'full_envio', 'promocao_giro', 'preco_mudou_vendas_cairam', 'queda_exposicao_anuncio', 'margem_negativa', 'ads_abaixo_meta', 'concentracao_receita', 'anuncio_restrito']) assert.ok(CATALOGO.regras.mantidas.includes(r), r)
  assert.equal(regraBloqueada('conteudo_fotos', 'nao'), false); assert.equal(regraBloqueada('conteudo_fotos', 'terceiros'), true); assert.equal(regraBloqueada('conteudo_fotos', 'proprio'), false)
  assert.ok(escopoDeConteudo('galeria') && escopoDeConteudo('ficha') && escopoDeConteudo('titulo_descricao') && escopoDeConteudo('oferta_completa') && !escopoDeConteudo('preco'))
  assert.ok(!('catalogo_buybox' in VIA_OFERTA), 'catalogo_buybox não abre mais job de ficha'); assert.deepEqual(VIA_OFERTA.frete_gratis, { escopo: 'preco', objetivo: 'preservar_margem' })
  for (const r of CATALOGO.regras.filtradas.concat(CATALOGO.regras.bloqueadas_terceiros, CATALOGO.regras.mantidas)) assert.ok(algoritmo.regras.some(x => x.id === r), 'regra existe no Algoritmo: ' + r)
})
await caso('terceiros: conteudo_fotos e duplicacao_estrategica não nascem; ima_conversao sem sinal editável não nasce; sem job de conteúdo; nada de foto no texto', () => {
  const nao = doItem('nao'), ter = doItem('terceiros')
  assert.ok(regrasDe(nao).includes('conteudo_fotos') && regrasDe(nao).includes('duplicacao_estrategica') && regrasDe(nao).includes('ima_conversao'), 'controle: anúncio comum recebe as três')
  assert.ok(!regrasDe(ter).includes('conteudo_fotos'), 'foto não é do vendedor'); assert.ok(!regrasDe(ter).includes('duplicacao_estrategica'), 'a casa não duplica catálogo')
  assert.ok(!regrasDe(ter).includes('ima_conversao'), 'sem sinal de preço, entrega ou disponibilidade, a ação não nasce')
  assert.equal(ter.filter(x => x.item_id === 'MLB50' && x.dados.executar_via_oferta).length, 0)
})
await caso('terceiros: ima_conversao com sinal de ENTREGA nasce sem os passos de conteúdo e com o texto fixo; sem sinal CONTEÚDO/CONFIANÇA; curva A não sugere duplicata', () => {
  const ter = doItem('terceiros', { frete_gratis: false, avaliacoes: { nota: 3.9, total: 40 } }), nao = doItem('nao', { frete_gratis: false, avaliacoes: { nota: 3.9, total: 40 } })
  const a = ter.find(x => x.item_id === 'MLB50' && x.regra === 'anuncio_ima_conversao'); assert.ok(a, 'o sinal de frete é editável: a ação nasce')
  assert.ok(!CONTEUDO.test(a.dados.como.filter(c => c !== TEXTO_CATALOGO.terceiros).join(' | ')), 'nenhum passo de conteúdo: ' + a.dados.como.join(' | ')); assert.match(a.dados.como.join(' | '), /sem frete grátis/); assert.ok(a.dados.como.includes(TEXTO_CATALOGO.terceiros))
  assert.ok(!/só 3 foto|nota 3,9|nota 3\.9/.test(a.dados.evidencia), 'evidência sem foto nem nota do catálogo'); assert.ok(!/DUPLICATA/.test(a.dados.como.join(' ')))
  assert.equal(a.dados.executar_via_oferta, undefined, 'catálogo não abre job de oferta completa')
  const n = nao.find(x => x.item_id === 'MLB50' && x.regra === 'anuncio_ima_conversao'); assert.ok(/só 3 foto/.test(n.dados.evidencia) && /Abrir o anúncio como comprador/.test(n.dados.como.join(' ')) && n.dados.executar_via_oferta?.escopo === 'oferta_completa', 'controle: sem catálogo nada muda')
  assert.deepEqual(a.dados.item.catalogo_origem, 'terceiros'); assert.deepEqual(a.dados.catalogo, { origem: 'terceiros', texto: TEXTO_CATALOGO.terceiros }); assert.equal(n.dados.catalogo, undefined); assert.equal(n.dados.item.catalogo_origem, 'nao')
})
await caso('próprio: foto/conteúdo viram "só por sugestão de correção, com revisão do Mercado Livre", sem passo de edição direta nem job; duplicação continua bloqueada', () => {
  const pr = doItem('proprio'), f = pr.find(x => x.item_id === 'MLB50' && x.regra === 'anuncio_conteudo_fotos'); assert.ok(f, 'o dono do produto pode propor correção das fotos')
  assert.ok(f.dados.como[0].startsWith(TEXTO_CATALOGO.proprio)); assert.ok(!/Adicionar fotos|Conferir a capa/.test(f.dados.como.join(' ')), 'sem passo de edição direta'); assert.match(f.dados.como.join(' '), /sugestão de correção/)
  assert.equal(f.dados.executar_via_oferta, undefined, 'a galeria não é publicada pelo módulo de Ofertas em catálogo'); assert.ok(!regrasDe(pr).includes('duplicacao_estrategica'))
  const ima = pr.find(x => x.item_id === 'MLB50' && x.regra === 'anuncio_ima_conversao'); assert.ok(ima, 'o sinal de conteúdo continua valendo para o dono'); assert.ok(ima.dados.como.some(c => c.startsWith(TEXTO_CATALOGO.proprio)) && !ima.dados.como.some(c => /^Tratar conteúdo/.test(c)))
  assert.equal(ima.dados.executar_via_oferta, undefined); assert.equal(ima.dados.catalogo.origem, 'proprio')
})
await caso('ads_otimizar_antes: o passo 2 deixa de pedir revisão de conteúdo em catálogo (terceiros e próprio); anúncio comum igual', () => {
  // o ímã tem prioridade sobre ads_otimizar_antes no mesmo anúncio; para isolar a regra, o anúncio tem menos de 3 vendas (o ímã exige ≥ 3)
  const so = origem => montarAcoes('__teste__', diagDe([item({ id: 'MLB10', r: 5000, u: 100, v: 600, conv: 9 }), item({ id: 'MLB60', r: 3000, u: 2, v: 300, conv: 6.2, catalogo: origem !== 'nao', catalogo_origem: origem, ads: ADS })]), { hoje: HOJE })
  const nao = comoDe(so('nao'), 'ads_otimizar_antes', 'MLB60'), ter = comoDe(so('terceiros'), 'ads_otimizar_antes', 'MLB60'), pr = comoDe(so('proprio'), 'ads_otimizar_antes', 'MLB60')
  assert.match(nao, /revisão de objeções do anúncio \(conteúdo, preço, frete, confiança\)/, 'controle'); assert.ok(ter, 'a regra continua valendo em catálogo (não aumentar a verba)')
  assert.ok(!/conteúdo, preço/.test(ter) && ter.includes(TEXTO_CATALOGO.terceiros), ter); assert.ok(!/\(conteúdo, preço/.test(pr) && pr.includes(TEXTO_CATALOGO.proprio), pr)
})
await caso('sazonal: o passo "Conteúdo e anúncio prontos" some em catálogo de terceiros e vira sugestão no próprio; estoque e campanha ficam', () => {
  const j = { evento: 'Dia das Crianças', data: '2026-10-12', dias: 7, acao: 'preparar', produtos: ['MLB50'], n_produtos: 1, limites: { conteudo: '2026-09-12', reposicao: '2026-09-21', campanha: '2026-09-28' }, estagio: 'janela curta', evidencia: 'calendário' }
  const por = origem => doItem(origem, {}, { janelas: [j] })
  const s = (origem) => por(origem).find(x => x.item_id === 'MLB50' && x.regra === 'anuncio_sazonal')
  assert.match(s('nao').dados.como[0], /Conteúdo e anúncio prontos até 12\/09/)
  const t = s('terceiros'); assert.ok(!/Conteúdo e anúncio prontos/.test(t.dados.como[0]) && t.dados.como[0].includes(TEXTO_CATALOGO.terceiros)); assert.match(t.dados.como[1], /Estoque garantido/); assert.match(t.dados.como[2], /Campanha no ar/)
  assert.ok(!/conteúdo até/.test(t.dados.evidencia)); assert.equal(t.prazo, '2026-09-21' > HOJE ? '2026-09-21' : addDias(HOJE, 3))
  const p = s('proprio'); assert.ok(p.dados.como[0].startsWith(TEXTO_CATALOGO.proprio))
})
await caso('mantidas em catálogo: catalogo_buybox (sem job de ficha e sem roteiro de entrar no catálogo), frete_gratis (job de preço), estoque_ruptura', () => {
  const x = item({ id: 'MLB70', r: 6000, u: 60, u0: 90, v: 500, conv: 12, catalogo: true, catalogo_origem: 'terceiros', buy_box: false, frete_gratis: false, estoque: 6, cobertura: 2, vel_dia: 3 })
  const a = montarAcoes('__teste__', diagDe([bom(), x]), { hoje: HOJE }), r = regrasDe(a, 'MLB70')
  for (const regra of ['catalogo_buybox', 'frete_gratis', 'estoque_ruptura']) assert.ok(r.includes(regra), regra + ' continua valendo para catálogo')
  const b = a.find(y => y.item_id === 'MLB70' && y.regra === 'anuncio_catalogo_buybox'); assert.equal(b.dados.executar_via_oferta, undefined, 'buybox não abre job de ficha'); assert.equal(b.dados.processo, null, 'o roteiro de ENTRAR no catálogo não é o de recuperar a caixa de compra')
  assert.equal(a.find(y => y.item_id === 'MLB70' && y.regra === 'anuncio_frete_gratis').dados.executar_via_oferta.escopo, 'preco', 'preço segue valendo')
  assert.ok(b.dados.como.some(c => /preço|condição/i.test(c)))
  const nao = montarAcoes('__teste__', diagDe([bom(), item({ id: 'MLB71', r: 6000, u: 60, u0: 90, v: 500, conv: 12, catalogo: false, frete_gratis: false })]), { hoje: HOJE })
  assert.equal(nao.find(y => y.item_id === 'MLB71' && y.regra === 'anuncio_frete_gratis').dados.executar_via_oferta.escopo, 'preco')
})
await caso('regerar o plano: ações de conteúdo que sumiram viram obsoletas (inclusive aprovada) e o resultado conta isso; nada é apagado', () => {
  const antes = doItem('nao'), depois = doItem('terceiros')
  assert.ok(antes.length > depois.length)
  salvarAcoesAnuncio('Cliente Regerar', antes.map(a => ({ ...a, cliente: 'Cliente Regerar' })))
  const fotos = antes.find(a => a.item_id === 'MLB50' && a.regra === 'anuncio_conteudo_fotos')
  db.prepare("UPDATE acoes_plano SET status = 'aprovada' WHERE id = ?").run(fotos.id)
  const r = salvarAcoesAnuncio('Cliente Regerar', depois.map(a => ({ ...a, cliente: 'Cliente Regerar' })))
  assert.ok(r.obsoletas >= 2 && r.obsoletas_aprovadas === 1, JSON.stringify(r)); assert.equal(db.prepare('SELECT status FROM acoes_plano WHERE id = ?').get(fotos.id).status, 'obsoleta')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM acoes_plano WHERE cliente = 'Cliente Regerar'").get().n, antes.length, 'nenhuma linha some')
})

// ═════════ 5. Ofertas: diagnóstico, proposta, abrirJob e adaptador ════════════════════════════════════
await caso('Ofertas: proposta e diagnóstico — terceiros não recebem título, descrição, ficha nem galeria; próprio recebe a proposta (texto da sugestão); preço segue', () => {
  const ficha = { nome: 'Smartwatch D20', marca: 'Genérica', modelo: 'D20', cor: 'Preto', referencia_confirmada: true, atributos: [{ atributo_id: 'BRAND', nome: 'Marca', valor_atual: 'Genérica', fonte: 'cadastro', obrigatorio: true }] }
  const prop = origem => { const D = criarDiagnostico({ serie: [{ dia: '2026-10-01', unidades: 1, receita: 50, visitas: 40 }], item: { id: 'MLB5', titulo: 'x', preco: 50, estoque: 5, fotos: 2, status: 'active', catalogo: true, catalogo_origem: origem } }); const b = D.baseline(); const d = D.diagnosticar(b, { ficha });
    return { b, d, p: ['titulo_descricao', 'ficha', 'galeria', 'oferta_completa', 'preco'].map(escopo => D.proporProposta({ escopo, objetivo: 'melhorar_conversao', baseline: b, diagnostico: d, ficha })) } }
  const t = prop('terceiros'), pr = prop('proprio'), nao = prop(undefined)
  assert.equal(t.b.catalogo_origem, 'terceiros'); assert.equal(pr.b.catalogo_origem, 'proprio'); assert.equal(nao.b.catalogo_origem, 'terceiros', 'catálogo sem origem resolvida = terceiros'); assert.equal(origemCatalogo({ catalogo: true, catalogo_origem: 'nao' }), 'terceiros', 'contradição vale o padrão seguro')
  for (const p of t.p.slice(0, 4)) { assert.ok(!p.titulo && !p.descricao && !p.galeria && !p.atributos, 'nenhum conteúdo para terceiros'); assert.ok(p.pendencias.some(x => /CATÁLOGO/.test(x)), p.pendencias.join()) }
  assert.equal(t.d.lentes.qualidade.sinal, 'conteudo_do_catalogo'); assert.equal(t.d.lentes.qualidade.evidencia, TEXTO_CATALOGO.terceiros); assert.ok(!/foto|briefing/.test(t.d.lentes.qualidade.evidencia))
  assert.ok(pr.p[0].titulo && pr.p[0].mudancas.length, 'próprio: a proposta nasce (é o texto da sugestão de correção)'); assert.match(pr.d.lentes.descoberta.hipotese || pr.d.lentes.conversao.hipotese || TEXTO_CATALOGO.proprio, /sugestão de correção/)
  const semCat = criarDiagnostico({ item: { id: 'MLB6', titulo: 'x', preco: 50, fotos: 2, catalogo: false } }); assert.equal(semCat.baseline().catalogo_origem, 'nao')
  assert.equal(t.p[4].pendencias.some(x => /CATÁLOGO/.test(x)), false, 'escopo de preço não é bloqueado')
})
await caso('Ofertas: abrirJob recusa título/descrição/ficha/galeria/oferta completa em catálogo de TERCEIROS (409, mensagem fixa com CATÁLOGO), aceita preço e aceita o próprio', async () => {
  const h = new Database(':memory:')
  h.exec(SCHEMA_OFERTAS); h.exec(SCHEMA_CATALOGO)
  h.exec("CREATE TABLE meli_item (cliente TEXT, item_id TEXT, titulo TEXT, thumb TEXT, preco REAL, estoque INTEGER, fotos INTEGER, status TEXT, catalogo INTEGER, criado_em TEXT, PRIMARY KEY (cliente, item_id)); CREATE TABLE perfil_cliente (cliente TEXT PRIMARY KEY, catalogo_proprio INTEGER)")
  const of = O.criarOfertas(h, { custosSku: () => new Map() }), fluxo = criarFluxo({ of, h, ml: {}, hoje: () => HOJE })
  const por = 'Tester'
  const anuncio = (id, catalogo, cliente = A) => {
    const p = of.criarProduto(cliente, { nome: 'Produto ' + id, marca: 'M', modelo: id, gtin: '', categoria_canal: 'MLB1', descricao_base: '' }, { por }), v = of.criarVariante(cliente, { produto_id: p.id, sku: 'SKU-' + id, cor: '', tamanho: '', estoque: 5 }, { por })
    return of.vincularAnuncio(cliente, { variante_id: v.id, canal: 'ML', conta_id: '123', anuncio_id: id, variacao_externa_id: '', catalogo_id: catalogo ? 'MLB-P1' : '', categoria_id: 'MLB1', url: 'https://produto.mercadolivre.com.br/' + id, titulo_atual: 't', preco_atual: 50, estoque_canal: 5, status_canal: 'active',
      snapshot: { item: { id, title: 't', price: 50, catalog_listing: catalogo, pictures: [], attributes: [] }, descricao: null, lido_em: '2026-10-05', hash: 'h' } }, { por })
  }
  const c1 = anuncio('MLB301', true), nc = anuncio('MLB302', false)
  const abre = (an, escopo) => fluxo.abrirJob(A, { anuncio_id: an.id, escopo, objetivo: 'melhorar_conversao', solicitante: por })
  for (const escopo of ['titulo_descricao', 'ficha', 'galeria', 'imagem_avulsa', 'oferta_completa']) await falha(() => abre(c1, escopo), /CATÁLOGO de terceiros/, 409)
  assert.equal(of.listarJobs(A).length, 0, 'nenhum job nasceu')
  assert.ok(abre(c1, 'preco').job.id, 'preço continua valendo em catálogo'); assert.ok(abre(nc, 'galeria').job.id, 'anúncio comum abre normalmente')
  // a marcação do cliente libera o catálogo próprio (a proposta é o texto da sugestão de correção; a publicação continua recusada pelo adaptador)
  h.prepare('INSERT INTO perfil_cliente VALUES (?, 1)').run(A); assert.ok(abre(c1, 'titulo_descricao').job.id, 'catálogo próprio abre')
  h.prepare('DELETE FROM perfil_cliente').run(); h.prepare("INSERT INTO catalogo_origem VALUES (?, 'MLB301', 'proprio', 'x', 't')").run(A)
  assert.ok(abre(c1, 'ficha').job.id, 'exceção por anúncio libera só aquele anúncio')
  const c2 = anuncio('MLB303', true); await falha(() => abre(c2, 'galeria'), /CATÁLOGO de terceiros/, 409)
  // a lista de Ofertas carrega o campo do selo (banco de teste sem a coluna nova: segue funcionando)
  const lista = fluxo.listaAnuncios(A, { periodo: { campo: 'data_venda', resolvido: { de: '2026-09-01', ate: '2026-09-28' } }, arvore: null })
  assert.deepEqual(Object.fromEntries(lista.itens.map(i => [i.anuncio_id, i.catalogo_origem])), { MLB301: 'proprio', MLB302: 'nao', MLB303: 'terceiros' })
})
await caso('Ofertas: adaptador do ML — capacidades de catálogo (sem título, descrição, ficha, imagens) e publicação recusada com pendência identificada', async () => {
  const itemML = (id, o) => ({ id, title: 'Smartwatch', price: 99.9, status: 'active', category_id: 'MLB1', listing_type_id: 'gold_special', sold_quantity: 0, available_quantity: 10, catalog_listing: false, seller_id: 123, pictures: [{ id: 'p1', secure_url: 'https://x/p1.jpg' }], attributes: [], variations: [], ...o })
  const itens = { MLB401: itemML('MLB401', { catalog_listing: true, catalog_product_id: 'MLB-P1' }), MLB402: itemML('MLB402') }, chamadas = []
  const fetch = async (url, init = {}) => { const m = /\/items\/(MLB\d+)/.exec(url); chamadas.push(`${init.method || 'GET'} ${url}`); const corpo = m && itens[m[1]] ? itens[m[1]] : { message: 'x' }; return { ok: !!(m && itens[m[1]]), status: m && itens[m[1]] ? 200 : 404, text: async () => JSON.stringify(corpo) } }
  const mk = origemCatalogo => criarAdaptadorML({ fetch, tokenValido: async () => 'tok', conta: () => ({ meli_user_id: 123, nickname: 'x', escopos: 'offline_access read write' }), espera: 0, ...(origemCatalogo ? { origemCatalogo } : {}) })
  const t = await mk().consultarCapacidades(A, { anuncio_id: 'MLB401' }), p = await mk(() => 'proprio').consultarCapacidades(A, { anuncio_id: 'MLB401' }), nc = await mk().consultarCapacidades(A, { anuncio_id: 'MLB402' })
  for (const c of [t, p]) { assert.equal(c.catalogo, true); assert.deepEqual([c.pode.titulo, c.pode.descricao, c.pode.atributos, c.pode.imagens], [false, false, false, false]); assert.equal(c.pode.preco, true, 'preço e estoque seguem do vendedor') }
  assert.equal(t.catalogo_origem, 'terceiros'); assert.equal(p.catalogo_origem, 'proprio'); assert.equal(nc.catalogo, false); assert.equal(nc.pode.titulo, true)
  for (const [campo, prop] of [['titulo', { titulo: 'Novo' }], ['descricao', { descricao: 'Texto' }], ['atributos', { atributos: [{ atributo_id: 'BRAND', valor_proposto: 'M' }] }], ['galeria', { galeria: [{ imagem_id: 'i', picture_id: 'p', ordem: 0 }] }]]) {
    const escopo = campo === 'titulo' || campo === 'descricao' ? 'titulo_descricao' : campo === 'atributos' ? 'ficha' : 'galeria'
    const vt = validarProposta(t, prop, escopo), vp = validarProposta(p, prop, escopo)
    assert.equal(vt.ok, false); assert.equal(vt.bloqueios[0].tipo, 'nao_suportado'); assert.match(vt.bloqueios[0].motivo, /CATÁLOGO de terceiros/); assert.ok(vt.pendencias.includes(TEXTO_CATALOGO.terceiros))
    assert.equal(vp.ok, false); assert.match(vp.bloqueios[0].motivo, /CATÁLOGO próprio.*sugestão de correção/); assert.ok(vp.pendencias.some(x => /sugestão de correção/.test(x)))
    assert.ok(validarProposta(nc, { ...prop, ...(campo === 'atributos' ? {} : {}) }, escopo).bloqueios.every(b => !/CATÁLOGO/.test(b.motivo)), 'anúncio comum: sem bloqueio de catálogo')
  }
  const preco = { preco: { preco_proposto: 90, piso: 80, simulacao: false, bloqueios: [] } }
  assert.equal(validarProposta(t, preco, 'preco').ok, true, 'preço de catálogo é publicável')
  const pub = await mk().publicar({ cliente: A, anuncio_id: 'MLB401', escopo: 'titulo_descricao', proposta: { titulo: 'Novo' }, live: true, chave_idem: 'k' })
  assert.equal(pub.estado, 'pendente_dados'); assert.match(pub.motivo, /CATÁLOGO/); assert.ok(chamadas.every(c => c.startsWith('GET')), 'nada foi enviado ao canal')
})

// ═════════ 6. selo nos payloads (leitura) ═════════════════════════════════════════════════════════════
const C = 'Cliente Selo'
const serieItem = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
await caso('payloads: diagnóstico, Anúncios no período e Mais vendidos trazem catalogo_origem (nao | proprio | terceiros) ao lado do catalogo legado; a flag "só N foto(s)" só para editável', () => {
  const base = { permalink: 'https://produto.mercadolivre.com.br/MLB-9', thumbnail: 'https://t/x.jpg', price: 20, status: 'active', available_quantity: 50, pictures: [{}, {}], shipping: {}, listing_type_id: 'gold_special', date_created: '2026-01-01T00:00:00Z' }
  gravarItens(C, [{ ...base, id: 'MLB501', title: 'Comum', catalog_listing: false }, { ...base, id: 'MLB502', title: 'Catálogo terceiros', catalog_listing: true, catalog_product_id: 'MLB-P5' }, { ...base, id: 'MLB503', title: 'Catálogo próprio', catalog_listing: true }])
  for (const id of ['MLB501', 'MLB502', 'MLB503']) for (let k = 1; k <= 20; k++) serieItem.run(C, id, addDias(HOJE, -k), 2, 40, 30)
  db.prepare("UPDATE meli_item SET vis_de = ?, vis_ate = ? WHERE cliente = ?").run(addDias(HOJE, -60), addDias(HOJE, -1), C)
  cat.definirExcecao({ cliente: C, item_id: 'MLB503', origem: 'proprio', por: LIDER, confirmar: true })
  const diag = diagnosticarConta(C, { hoje: HOJE }), por = Object.fromEntries(diag.itens.map(i => [i.id, [i.catalogo, i.catalogo_origem]]))
  assert.deepEqual(por, { MLB501: [false, 'nao'], MLB502: [true, 'terceiros'], MLB503: [true, 'proprio'] }, 'o campo legado fica; o novo vem ao lado')
  const per = { de: addDias(HOJE, -28), ate: addDias(HOJE, -1), anterior: { de: addDias(HOJE, -56), ate: addDias(HOJE, -29) }, ano_anterior: { de: addDias(HOJE, -393), ate: addDias(HOJE, -366) } }
  assert.deepEqual(Object.fromEntries(linhasDoPeriodo(C, per).itens.map(i => [i.anuncio_id, i.catalogo_origem])), { MLB501: 'nao', MLB502: 'terceiros', MLB503: 'proprio' })
  const mv = maisVendidos(C, { hoje: HOJE }), mvo = Object.fromEntries(mv.map(i => [i.item_id, i]))
  assert.deepEqual(Object.fromEntries(mv.map(i => [i.item_id, [i.catalogo, i.catalogo_origem]])), { MLB501: [false, 'nao'], MLB502: [true, 'terceiros'], MLB503: [true, 'proprio'] })
  const foto = i => i.flags.some(f => /foto/.test(f.texto))
  assert.deepEqual([foto(mvo.MLB501), foto(mvo.MLB502), foto(mvo.MLB503)], [true, false, true], 'catálogo de terceiros não mostra "só N foto(s)" (foto não é do vendedor)')
  // marcar o cliente inteiro como próprio troca o padrão dos que não têm exceção
  cat.definirPadrao({ cliente: C, proprio: true, por: LIDER, confirmar: true })
  assert.deepEqual(Object.fromEntries(diagnosticarConta(C, { hoje: HOJE }).itens.map(i => [i.id, i.catalogo_origem])), { MLB501: 'nao', MLB502: 'proprio', MLB503: 'proprio' })
  cat.definirExcecao({ cliente: C, item_id: 'MLB502', origem: 'terceiros', por: LIDER, confirmar: true })
  assert.equal(diagnosticarConta(C, { hoje: HOJE }).itens.find(i => i.id === 'MLB502').catalogo_origem, 'terceiros', 'exceção por anúncio vence o padrão do cliente')
})
await caso('PDF do plano por anúncio: selo "Catálogo" no anúncio e o texto fixo no lugar de "PRECISA CONVERTER (conteúdo)" e "completar fotos"', () => {
  const ima = item({ id: 'MLB80', r: 4000, u: 30, v: 500, conv: 6, fotos: 3, catalogo: true, catalogo_origem: 'terceiros', ads: { prints: 9000, clicks: 40, custo: 50, receita: 300, unidades: 3, ctr: 0.4, roas: 6, acos: 16 } })
  const comum = item({ id: 'MLB81', r: 3500, u: 30, v: 500, conv: 6, fotos: 3, ads: { prints: 9000, clicks: 40, custo: 50, receita: 300, unidades: 3, ctr: 0.4, roas: 6, acos: 16 } })
  const proprio = item({ id: 'MLB82', r: 3000, u: 30, v: 500, conv: 6, fotos: 3, catalogo: true, catalogo_origem: 'proprio' })
  const diag = diagDe([bom(), ima, comum, proprio], { ads: { custo: 100, receita: 600, roas: 6, acos: 16, ctr: 0.9, tacos: 3, clicks: 80, prints: 18000, anterior: { roas: 5 } } })
  const acoes = montarAcoes('__teste__', diag, { hoje: HOJE })
  const html = renderPlanoConta({ diag: { ...diag, causal: null }, acoes, previsao: { cenarios: { conservador: { ganho: 0, faturamento: 0, uplift_pct: 0 }, base: { ganho: 0, faturamento: 0, uplift_pct: 0 }, otimista: { ganho: 0, faturamento: 0, uplift_pct: 0 } }, baseline: 0, ultimo_periodo: 0, baseline_regra: '', receita_em_risco_evitada: 0, n_acoes: 0 }, custos: null })
  assert.match(html, /pl-chip cinza">Catálogo</); assert.match(html, /pl-chip cinza">Catálogo próprio</)
  const secao = (de, ate) => html.slice(html.indexOf(`Seção ${de}`), html.indexOf(`Seção ${ate}`))
  const linha = (sec, id) => (sec.match(new RegExp(`<tr><td><a href="[^"]*">[^<]*</a><div class="pl-sc">${id}[\\s\\S]*?</tr>`)) || [''])[0]
  const tabIma = id => linha(secao('04', '05'), id), ctr = id => linha(secao('06', '07'), id)
  assert.ok(!/PRECISA CONVERTER \(conteúdo\)/.test(tabIma('MLB80')) && tabIma('MLB80').includes(TEXTO_CATALOGO.terceiros), 'terceiros: texto fixo no lugar')
  assert.match(tabIma('MLB81'), /PRECISA CONVERTER \(conteúdo\)/); assert.match(tabIma('MLB82'), /conteúdo: só por sugestão de correção/)
  assert.ok(ctr('MLB80').includes(TEXTO_CATALOGO.terceiros) && !/revisar imagem|completar fotos/.test(ctr('MLB80')), 'tabela de CTR: catálogo de terceiros sem pedido de capa/fotos')
  assert.match(ctr('MLB81'), /revisar imagem de capa e título/)
})

await caso('Notion: ação de foto/duplicação já gravada em catálogo de TERCEIROS não é distribuída (barrada no dry-run, sem tocar no Notion); próprio e frete não são barrados', async () => {
  const acao = (id, regra, item_id) => ({ id, cliente: C, regra, item_id, titulo: 'x', status: 'proposta', notion_page_id: '', dados: {} })
  cat.definirPadrao({ cliente: C, proprio: false, por: LIDER, confirmar: true })       // MLB502/MLB503 sob o padrão do cliente: terceiros (MLB503 tem exceção "próprio")
  const rel = await distribuir([acao('PS-1', 'anuncio_conteudo_fotos', 'MLB502'), acao('PS-2', 'anuncio_duplicacao_estrategica', 'MLB502')], { dryRun: true })      // só barradas: nenhuma chamada ao Notion
  assert.deepEqual(rel.barradas_catalogo.map(x => x.id), ['PS-1', 'PS-2']); assert.equal(rel.a_criar.length, 0); assert.match(rel.avisos[0], /catálogo de terceiros não foram distribuídas/)
  // próprio (exceção por anúncio) e frete em catálogo não são barrados pelo guarda (a decisão; o fluxo seguinte chamaria o Notion e o teste não chama)
  const mapa = cat.origensDe(C, ['MLB502', 'MLB503']); assert.equal(mapa.get('MLB502'), 'terceiros'); assert.equal(mapa.get('MLB503'), 'proprio')
  assert.equal(regraBloqueada('conteudo_fotos', mapa.get('MLB503')), false); assert.equal(regraBloqueada('frete_gratis', mapa.get('MLB502')), false)
  cat.definirPadrao({ cliente: C, proprio: true, por: LIDER, confirmar: true })       // devolve o estado para os casos seguintes
})

await caso('tela: a seção do catálogo (cliente.js) renderiza com tudo escapado e só grava depois da prévia + confirmação, com o nome do líder', async () => {
  const { readFileSync } = await import('node:fs'), vm = await import('node:vm')
  const fonte = readFileSync(new URL('../src/web/cliente.js', import.meta.url), 'utf8'), bloco = fonte.slice(fonte.indexOf('async function carregarCatalogo'), fonte.indexOf('async function carregarPerfil'))
  assert.ok(bloco.includes('function desenharCatalogo'))
  const els = {}, el = id => els[id] || (els[id] = { id, value: '', checked: false, disabled: false, innerHTML: '', focus() {}, dataset: {} })
  const chamadas = []
  const ctx = { $: el, esc: x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), intPt: v => String(v), brData: d => d.slice(0, 10).split('-').reverse().join('/'), lerNome: () => 'Maria', gravarNome: () => {}, toast: () => {},
    dados: { cliente: A }, erroBloco: () => {}, SK: () => '', document: {},
    api: async (url, corpo) => { chamadas.push([url, corpo]); return url.startsWith('/api/cliente/catalogo?') ? { ...cat.resumo(A), textos: { terceiros: TEXTO_CATALOGO.terceiros, proprio: TEXTO_CATALOGO.proprio } } : { ok: true, previa: !corpo?.confirmar, de: 'terceiros', para: 'proprio', texto: 'prévia do servidor' } },
    confirmar: async o => { chamadas.push(['confirmar', o.texto]); return true } }
  vm.runInNewContext(bloco, ctx)
  const alvo = { innerHTML: '', querySelectorAll: () => [] }
  const r = { ...cat.resumo(A), textos: { terceiros: TEXTO_CATALOGO.terceiros, proprio: TEXTO_CATALOGO.proprio }, excecoes: [{ item_id: 'MLB1', origem: 'proprio', por: '<b>x</b>', em: '2026-10-08T10:00:00Z', titulo: '<img src=x onerror=alert(1)>' }] }
  vm.runInContext('desenharCatalogo', ctx)(alvo, A, r)
  assert.match(alvo.innerHTML, /anúncios de catálogo \(<b>\d+<\/b> ativos\)/); assert.match(alvo.innerHTML, /Os anúncios de catálogo desta conta são próprios \(marca\/dono do produto\)/); assert.match(alvo.innerHTML, /value="Maria"/)
  assert.ok(!alvo.innerHTML.includes('<img src=x') && !alvo.innerHTML.includes('<b>x</b>'), 'título e nome de quem marcou entram escapados'); assert.match(alvo.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/)
  // salvar: prévia → confirmação → gravação (confirmar:true) → recarrega a contagem
  el('catPor').value = ''; el('catProprio').checked = true
  await el('btnCatalogo').onclick({ currentTarget: el('btnCatalogo') }); await new Promise(r => setImmediate(r))
  assert.equal(chamadas.length, 0, 'sem nome nada é enviado'); assert.match(el('catMsg').innerHTML, /Informe seu nome/)
  el('catPor').value = 'Líder Teste'; await el('btnCatalogo').onclick({ currentTarget: el('btnCatalogo') }); await new Promise(r => setTimeout(r, 20))
  const posts = chamadas.filter(c => c[1] && c[0] === '/api/cliente/catalogo')
  assert.equal(posts.length, 2); assert.equal(posts[0][1].confirmar, undefined, 'a 1ª chamada é a prévia'); assert.equal(posts[1][1].confirmar, true); assert.deepEqual([posts[1][1].cliente, posts[1][1].proprio, posts[1][1].por], [A, true, 'Líder Teste'])
  assert.ok(chamadas.some(c => c[0] === 'confirmar' && c[1] === 'prévia do servidor'), 'a confirmação mostra o texto da prévia')
})

await caso('rotas de leitura: Plano por anúncio (selo ao vivo e texto fixo), Anúncios no período e Folha trazem catalogo_origem; a marcação vale sem regerar o plano', async () => {
  db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES ('PS-cat001', ?, 'Mercado Livre', 'anuncio_frete_gratis', '2026-10', 'Avaliar frete grátis: Catálogo terceiros (MLB502)', '30d', '2026-10-20', 50, ?, 'proposta', 'MLB502', 'x', 'x')")
    .run(C, JSON.stringify({ prioridade: { p: 'P2' }, fila: 'fila', item: { id: 'MLB502', titulo: 'Catálogo terceiros', permalink: 'https://produto.mercadolivre.com.br/MLB-502', thumb: '', classe: 'A1' }, como: ['x'], evidencia_tipo: 'fato' }))
  const app = express(); app.use(express.json()); app.use(rotasPlanos)
  const srv = await new Promise(ok => { const s2 = app.listen(0, '127.0.0.1', () => ok(s2)) }), base = `http://127.0.0.1:${srv.address().port}`
  const get = p => fetch(base + p).then(async r => ({ status: r.status, json: await r.json() }))
  try {
    cat.definirExcecao({ cliente: C, item_id: 'MLB502', origem: 'terceiros', por: LIDER, confirmar: true })
    const q = encodeURIComponent(C)
    let pc = await get(`/api/plano-conta?cliente=${q}`); const a1 = pc.json.acoes.find(x => x.id === 'PS-cat001')
    assert.equal(pc.status, 200); assert.equal(a1.catalogo_origem, 'terceiros'); assert.equal(a1.catalogo_texto, TEXTO_CATALOGO.terceiros)
    cat.definirExcecao({ cliente: C, item_id: 'MLB502', origem: 'proprio', por: LIDER, confirmar: true })       // sem regerar o plano
    pc = await get(`/api/plano-conta?cliente=${q}`); const a2 = pc.json.acoes.find(x => x.id === 'PS-cat001'); assert.equal(a2.catalogo_origem, 'proprio'); assert.equal(a2.catalogo_texto, TEXTO_CATALOGO.proprio)
    const an = await get(`/api/cliente/anuncios?cliente=${q}`); assert.equal(an.status, 200); assert.deepEqual(Object.fromEntries(an.json.itens.map(i => [i.anuncio_id, i.catalogo_origem])), { MLB501: 'nao', MLB502: 'proprio', MLB503: 'proprio' })
    const fo = await get(`/api/cliente/folha?cliente=${q}&blocos=metricas`); assert.equal(fo.status, 200); assert.deepEqual(Object.fromEntries(fo.json.itens.map(i => [i.anuncio_id, i.catalogo_origem])), { MLB501: 'nao', MLB502: 'proprio', MLB503: 'proprio' })
    const csv = await fetch(`${base}/api/plano-conta/acoes.csv?cliente=${q}`).then(r => r.text()); assert.match(csv, /"Catálogo"/); assert.match(csv, /"catálogo próprio"/)
    cat.definirExcecao({ cliente: C, item_id: 'MLB502', origem: 'terceiros', por: LIDER, confirmar: true })       // estado dos casos seguintes
  } finally { srv.close() }
})

// ═════════ 7. rotas HTTP ══════════════════════════════════════════════════════════════════════════════
function servir() {
  const app = express(); app.use(express.json())
  app.use(criarRotasCatalogo({ catalogo: criarCatalogo(db, { validarPor: n => n === LIDER ? LIDER : '', agora: () => '2026-10-08T12:00:00.000Z' }), quem: () => [LIDER], clienteCanonico: nome => [A, B, C].includes(nome) ? nome : '' }))
  app.use((e, req, res, next) => res.status(500).json({ erro: 'erro interno' }))
  return new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
}
await caso('rotas: contrato do GET, 415 sem JSON, 400 sem eco, 403 por inválido, prospect inexistente, confirmar:"true" = prévia, isolamento e exceção por anúncio', async () => {
  const srv = await servir(), base = `http://127.0.0.1:${srv.address().port}`
  const req = (m, p, corpo, tipo = 'application/json') => fetch(base + p, { method: m, headers: tipo ? { 'Content-Type': tipo } : {}, body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }))
  try {
    const g = await req('GET', `/api/cliente/catalogo?cliente=${encodeURIComponent(B)}`)
    assert.equal(g.status, 200); assert.deepEqual(Object.keys(g.json).sort(), ['ativos', 'cliente', 'excecoes', 'padrao', 'proprio', 'quem', 'terceiros', 'textos', 'total']); assert.equal(g.json.padrao, 'terceiros'); assert.deepEqual(g.json.quem, [LIDER])
    assert.deepEqual(g.json.textos, { terceiros: TEXTO_CATALOGO.terceiros, proprio: TEXTO_CATALOGO.proprio })
    const gc = await req('GET', `/api/cliente/catalogo?cliente=${encodeURIComponent(C)}`); assert.equal(gc.json.total, 2); assert.equal(gc.json.proprio, 1); assert.equal(gc.json.terceiros, 1); assert.equal(gc.json.padrao, 'proprio'); assert.deepEqual(gc.json.excecoes.map(x => [x.item_id, x.origem]).sort(), [['MLB502', 'terceiros'], ['MLB503', 'proprio']])
    assert.equal((await req('GET', '/api/cliente/catalogo')).status, 400)
    for (const prospect of ['[Comercial] Loja X', 'Cliente Inexistente']) { const r = await req('GET', `/api/cliente/catalogo?cliente=${encodeURIComponent(prospect)}`); assert.equal(r.status, 404); assert.ok(!JSON.stringify(r.json).includes('Loja X') && !JSON.stringify(r.json).includes('Inexistente'), 'sem eco') }
    assert.equal((await req('POST', '/api/cliente/catalogo', { cliente: '[Comercial] Loja X', proprio: true, por: LIDER, confirmar: true })).status, 404, 'prospect nunca é marcado')
    // 415 e 400
    assert.equal((await req('POST', '/api/cliente/catalogo', JSON.stringify({ cliente: B }), 'text/plain')).status, 415); assert.equal((await req('POST', '/api/anuncio/catalogo-origem', 'x=1', 'application/x-www-form-urlencoded')).status, 415); assert.equal((await req('POST', '/api/cliente/catalogo', 'x', null)).status, 415)
    const ruim = await req('POST', '/api/cliente/catalogo', { cliente: B, proprio: SEGREDO, por: LIDER }); assert.equal(ruim.status, 400); assert.ok(!JSON.stringify(ruim.json).includes(SEGREDO))
    assert.equal((await req('POST', '/api/cliente/catalogo', { cliente: B, por: LIDER })).status, 400, 'proprio ausente')
    const semPor = await req('POST', '/api/cliente/catalogo', { cliente: B, proprio: true }); assert.equal(semPor.status, 400)
    const forjado = await req('POST', '/api/cliente/catalogo', { cliente: B, proprio: true, por: SEGREDO, confirmar: true }); assert.equal(forjado.status, 403); assert.ok(!JSON.stringify(forjado.json).includes(SEGREDO))
    assert.equal((await req('POST', '/api/cliente/catalogo', { cliente: B, proprio: true, por: { toString: 'x' } })).status, 400, 'objeto no lugar do nome não vira "[object Object]"')
    // prévia por padrão; "true" (string) não confirma; true confirma
    const pv = await req('POST', '/api/cliente/catalogo', { cliente: C, proprio: false, por: LIDER }); assert.equal(pv.status, 200); assert.equal(pv.json.previa, true); assert.equal(pv.json.para, 'terceiros')
    const str = await req('POST', '/api/cliente/catalogo', { cliente: C, proprio: false, por: LIDER, confirmar: 'true' }); assert.equal(str.json.previa, true); assert.equal(db.prepare('SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(C).c, 1, 'nada gravado')
    const ok = await req('POST', '/api/cliente/catalogo', { cliente: C, proprio: false, por: LIDER, confirmar: true }); assert.equal(ok.json.previa, false); assert.equal(ok.json.resumo.padrao, 'terceiros'); assert.equal(db.prepare('SELECT catalogo_proprio c FROM perfil_cliente WHERE cliente = ?').get(C).c, 0)
    // exceção por anúncio
    const ex = (o) => req('POST', '/api/anuncio/catalogo-origem', { cliente: C, por: LIDER, ...o })
    assert.equal((await ex({ item_id: 'MLB502', origem: SEGREDO })).status, 400); assert.equal((await ex({ item_id: SEGREDO, origem: 'proprio' })).status, 400); assert.equal((await ex({ item_id: 'MLB502' })).status, 400)
    assert.equal((await ex({ item_id: 'MLB502', origem: 'proprio', por: SEGREDO })).status, 403)
    assert.equal((await req('POST', '/api/anuncio/catalogo-origem', { cliente: B, por: LIDER, item_id: 'MLB502', origem: 'proprio', confirmar: true })).status, 404, 'o anúncio é do outro cliente')
    const naoCat = await ex({ item_id: 'MLB501', origem: 'proprio', confirmar: true }); assert.equal(naoCat.status, 200); assert.equal(naoCat.json.ok, false)
    const prev = await ex({ item_id: 'MLB502', origem: 'proprio', confirmar: 'true' }); assert.equal(prev.json.previa, true)
    const grava = await ex({ item_id: 'MLB502', origem: 'proprio', confirmar: true }); assert.equal(grava.json.ok, true); assert.equal(grava.json.resumo.excecoes.find(x => x.item_id === 'MLB502').origem, 'proprio')
    const volta = await ex({ item_id: 'MLB502', origem: null, confirmar: true }); assert.equal(volta.json.ok, true); assert.ok(!volta.json.resumo.excecoes.some(x => x.item_id === 'MLB502'))
  } finally { srv.close() }
})

console.log(`\nteste-catalogo: ${n} casos OK`)
