// Autoteste dos alinhamentos com o cliente (exceções intencionais; PLANO ATIVO 4): predicado, vencimento, descarte com motivo (vira alinhamento), reabrir encerra,
// regra suprimida não nasce (omitidas.alinhado) no plano por anúncio e no plano por cliente, ACOS alvo, vencido vira "observar", bug das vagas (descartada não ocupa
// teto/fila), auditor do motivo, prospect nunca, rotas HTTP. Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes dos imports): nunca abre data/db.sqlite, nunca chama rede.
// Rodar: node scripts/teste-alinhamentos.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const { db } = await import('../src/lib/db.js')
const { criarAlinhamentos, CFG, acosDaAcao } = await import('../src/lib/alinhamentos.js')
const { montarAcoes, acaoDeOferta } = await import('../src/lib/plano-anuncios.js')
const { marcarStatus, gerarPlanoCliente } = await import('../src/lib/plano-cliente.js')
const { classificarCurvas, benchmarkConversao, algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { criarRotasAlinhamentos } = await import('../src/rotas-alinhamentos.js')
const { rotasPlanos } = await import('../src/rotas-planos.js')
const { default: express } = await import('express')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const DIA = '2026-10-10', CLI = 'Cliente Alinhado', CONSULTOR = 'Giovanna Torres'
const addD = (iso, k) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
const hojeReal = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()   // alinhamentosReal usa hojeLocal
// central em memória: o consultor existe (validarLiderOuConsultor da fiação real o reconhece)
db.prepare("INSERT INTO clientes_central (cliente, status_cs, tier, nicho, canais_json, consultores_json, lideres_json, atualizado_em) VALUES (?, 'Ativo', '', '', '[\"ML\"]', ?, '{}', ?)").run(CLI, JSON.stringify({ ML: CONSULTOR }), DIA)
const nucleo = (o = {}) => criarAlinhamentos({ handle: db, hoje: () => DIA, agora: () => DIA + 'T12:00:00.000Z', nomesInternos: () => [CONSULTOR], validarPor: x => x === CONSULTOR ? x : '', ...o })
const A = nucleo()
const reg = e => A.registrar({ cliente: CLI, por: CONSULTOR, confirmar: true, ...e })
const insAl = o => db.prepare(`INSERT INTO alinhamento (cliente, escopo, chave, regras_json, tipo, motivo, acos_alvo, por, origem, acao_id, desde, revisar_em, permanente, estado, criado_em)
  VALUES (@cliente, @escopo, @chave, @regras_json, @tipo, '', @acos_alvo, @por, @origem, @acao_id, @desde, @revisar_em, 0, @estado, @desde)`).run({ cliente: CLI, escopo: 'anuncio', chave: '', regras_json: '[]', tipo: 'outro', acos_alvo: null, por: CONSULTOR, origem: 'painel', acao_id: '', desde: DIA, revisar_em: addD(DIA, 30), estado: 'vivo', ...o }).lastInsertRowid
const limpar = () => { db.prepare('DELETE FROM alinhamento').run(); db.prepare('DELETE FROM acoes_plano').run() }
const erroDe = fn => { try { fn() } catch (e) { return e } assert.fail('esperava erro') }

// fixtures do plano por anúncio (scripts/teste-plano-anuncios.mjs:7-18)
const HOJE = '2026-10-05'
const item = (o) => ({ id: 'MLB1', titulo: 'Produto de teste', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x-_JM', thumb: '', preco: 50, estoque: 400, fotos: 8, frete_gratis: true, catalogo: false,
  u: 20, r: 1000, v: 300, u0: 20, r0: 1000, v0: 300, visOk: true, conv: 6.7, vel_dia: 0.71, cobertura: 560, ads: null, ads_ant: null, buy_box: null, logistica: '', avaliacoes: null, ptw: null, ...o })
function diagDe(itens, extra = {}) {
  classificarCurvas(itens, null); const b = benchmarkConversao(itens); classificarCurvas(itens, b?.conv)
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: CLI, hoje: HOJE, periodo: { de: '2026-09-07', ate: '2026-10-04', anterior: { de: '2026-08-10', ate: '2026-09-06' } },
    resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, conversao_conta: b?.conv, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: b, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, clicks: 0, prints: 0, anterior: { roas: null } }, economia: null, custos_informados: false, itens, janelas: [], pendencias: [], algoritmo_versao: algoritmo.versao, ...extra }
}
const campeao = id => item({ id, r: 9000, u: 120, estoque: 6, cobertura: 1, vel_dia: 4.3 })

await ok('config: 8 tipos da lista fechada (= CHECK da tabela), revisão padrão 30 dias, permanente só descontinuado, mapa tipo → regras como no plano', () => {
  assert.deepEqual(Object.keys(CFG.tipos).sort(), ['boi_de_piranha', 'campanha_visibilidade', 'descontinuado_queima_estoque', 'intencional', 'ja_informado', 'outro', 'pausa_producao', 'teste'])
  assert.equal(CFG.revisao_dias_padrao, 30); assert.deepEqual(CFG.permanente_permitido, ['descontinuado_queima_estoque'])
  assert.deepEqual(CFG.tipos.pausa_producao.suprime, ['anuncio_restrito', 'queda_*', 'estoque_ruptura', 'estoque_sincronizar']); assert.deepEqual(CFG.tipos.ja_informado.suprime, [])
  for (const t of Object.values(CFG.tipos)) assert.match(t.texto_cliente, /conforme alinhado em \{data\}/)
  for (const r of ['anuncio_restrito', 'estoque_ruptura', 'ads_reduzir', 'ads_abaixo_meta', 'queda_ctr_ads', 'full_estoque_antigo', 'full_envio']) assert.ok(algoritmo.regras.some(x => x.id === r), 'regra do mapa existe no Algoritmo: ' + r)
})

await ok('predicado: anúncio pausado de propósito cobre anuncio_restrito/quedas/ruptura e mais nada; ja_informado não tira regra (só silencia aviso); conta exige regras; escopo regra; prévia não grava', () => {
  limpar()
  const pv = A.registrar({ cliente: CLI, escopo: 'anuncio', chave: 'mlb100', tipo: 'pausa_producao', por: CONSULTOR })
  assert.equal(pv.previa, true); assert.equal(pv.alinhamento.chave, 'MLB100'); assert.equal(pv.alinhamento.revisar_em, addD(DIA, 30)); assert.match(pv.alinhamento.texto_cliente, /conforme alinhado em 10\/10/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 0, 'sem confirmar === true nada é gravado')
  assert.equal(A.registrar({ cliente: CLI, escopo: 'anuncio', chave: 'MLB100', tipo: 'pausa_producao', por: CONSULTOR, confirmar: 'true' }).previa, true, '"true" string é prévia')
  reg({ escopo: 'anuncio', chave: 'MLB100', tipo: 'pausa_producao', motivo: 'erro de produção do fornecedor, volta em novembro' })
  const p = A.predicado(CLI)
  const r = p({ item: 'MLB100', regra: 'anuncio_anuncio_restrito' })
  assert.equal(r.sim, true); assert.equal(r.tipo, 'pausa_producao'); assert.equal(r.desde, DIA); assert.equal(r.revisar_em, addD(DIA, 30)); assert.equal(r.acos_alvo, null); assert.ok(r.rotulo)
  assert.equal(p({ item: 'MLB100', regra: 'queda_exposicao_anuncio' }).sim, true, "'queda_*' cobre as quedas")
  assert.equal(p({ item: 'MLB100', regra: 'estoque_ruptura' }).sim, true)
  assert.equal(p({ item: 'MLB100', regra: 'ima_conversao' }).sim, false, 'regra fora do mapa continua nascendo')
  assert.equal(p({ item: 'MLB999', regra: 'anuncio_restrito' }).sim, false, 'outro anúncio não')
  assert.equal(p({ regra: 'anuncio_restrito' }).sim, false, 'pergunta de conta não casa com alinhamento de anúncio')
  assert.equal(p({ item: 'MLB100' }).sim, true, 'sem regra: a entidade está alinhada (gatilhos)')
  reg({ escopo: 'anuncio', chave: 'MLB200', tipo: 'ja_informado' })
  assert.equal(A.alinhado(CLI, { item: 'MLB200', regra: 'anuncio_restrito' }).sim, false, 'ja_informado: a regra continua')
  assert.equal(A.alinhado(CLI, { item: 'MLB200' }).sim, true, 'ja_informado: aviso ao cliente silencia')
  assert.match(erroDe(() => reg({ escopo: 'conta', tipo: 'intencional' })).message, /informe as regras cobertas/)
  reg({ escopo: 'conta', tipo: 'intencional', regras: ['anuncio_cadastrar_custos'] })
  assert.equal(A.alinhado(CLI, { regra: 'anuncio_cadastrar_custos' }).sim, true); assert.equal(A.alinhado(CLI, { regra: 'concentracao_receita' }).sim, false)
  reg({ escopo: 'regra', chave: 'frete_gratis', tipo: 'outro' })
  assert.equal(A.alinhado(CLI, { item: 'MLB777', regra: 'frete_gratis' }).sim, true, 'escopo regra vale para qualquer anúncio'); assert.equal(A.alinhado(CLI, { item: 'MLB777', regra: 'conteudo_fotos' }).sim, false)
  assert.equal(A.vivos(CLI).length, 4); assert.ok(A.listar(CLI).every(x => x.estado === 'vivo' && x.texto_cliente.includes('conforme alinhado em')))
})

await ok('validação: acos_alvo só campanha_visibilidade; permanente só descontinuado; por só líder/consultor (403) exceto origem s90_cliente; data fora da janela; mensagens fixas sem eco', () => {
  limpar()
  const lixo = 'MLB<script>alert(1)</script>'
  const e1 = erroDe(() => reg({ escopo: 'anuncio', chave: lixo, tipo: 'teste' })); assert.equal(e1.status, 400); assert.ok(!e1.message.includes('script'), 'não ecoa')
  assert.ok(!erroDe(() => reg({ escopo: 'anuncio', chave: 'MLB1', tipo: lixo })).message.includes('script'))
  assert.match(erroDe(() => reg({ escopo: 'anuncio', chave: 'MLB1', tipo: 'teste', acos_alvo: 30 })).message, /só vale para campanha de visibilidade/)
  assert.match(erroDe(() => reg({ escopo: 'anuncio', chave: 'MLB1', tipo: 'campanha_visibilidade', acos_alvo: 900 })).message, /entre 0 e 300/)
  assert.match(erroDe(() => reg({ escopo: 'anuncio', chave: 'MLB1', tipo: 'pausa_producao', permanente: true })).message, /permanente só para produto descontinuado/)
  const perm = reg({ escopo: 'anuncio', chave: 'MLB1', tipo: 'descontinuado_queima_estoque', permanente: true }); assert.equal(perm.alinhamento.revisar_em, ''); assert.equal(perm.alinhamento.permanente, true)
  const e403 = erroDe(() => A.registrar({ cliente: CLI, escopo: 'anuncio', chave: 'MLB1', tipo: 'teste', por: 'Fulano Qualquer', confirmar: true })); assert.equal(e403.status, 403); assert.ok(!e403.message.includes('Fulano'))
  assert.match(erroDe(() => A.registrar({ cliente: CLI, escopo: 'anuncio', chave: 'MLB1', tipo: 'teste', confirmar: true })).message, /informe "por"/)
  const s90 = A.registrar({ cliente: CLI, escopo: 'anuncio', chave: 'MLB2', tipo: 'intencional', origem: 's90_cliente', confirmar: true }); assert.equal(s90.alinhamento.por, 'cliente')
  for (const d of [DIA, addD(DIA, -1), addD(DIA, 400), '10/11/2026']) assert.match(erroDe(() => reg({ escopo: 'anuncio', chave: 'MLB3', tipo: 'teste', revisar_em: d })).message, /revisar_em/)
  assert.equal(reg({ escopo: 'anuncio', chave: 'MLB3', tipo: 'teste', revisar_em: addD(DIA, 7) }).alinhamento.revisar_em, addD(DIA, 7))
})

await ok('auditor: motivo com nome interno, ID ou promessa é barrado (código, sem trecho); causa descrita passa; acima de 200 caracteres é recusado', () => {
  limpar()
  const base = { escopo: 'anuncio', chave: 'MLB10', tipo: 'outro' }
  const cod = m => erroDe(() => reg({ ...base, motivo: m })).codigos
  assert.ok(cod('combinado com a Giovanna Torres na reunião').includes('analista'))
  assert.ok(cod('mesmo caso do MLB1234567890').includes('id_interno'))
  assert.ok(cod('o cliente disse que vai vender muito').includes('promessa'))
  const e = erroDe(() => reg({ ...base, motivo: 'combinado com a Giovanna Torres' })); assert.ok(!e.message.includes('Giovanna'), 'mensagem fixa')
  assert.ok(reg({ ...base, motivo: 'pausado por causa da falta de produção no fornecedor' }).id, 'descrever a causa não é causalidade afirmada ao cliente')
  assert.match(erroDe(() => reg({ ...base, motivo: 'x'.repeat(201) })).message, /200 caracteres/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 1)
})

await ok('prospect "[Comercial] …" nunca: registrar recusa (400), predicado e listas vazios', () => {
  limpar()
  const P = '[Comercial] Loja X · 7'
  const e = erroDe(() => A.registrar({ cliente: P, escopo: 'anuncio', chave: 'MLB1', tipo: 'teste', por: CONSULTOR, confirmar: true })); assert.equal(e.status, 400); assert.match(e.message, /prospect/)
  db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, tipo, origem, desde, revisar_em, criado_em) VALUES (?, 'anuncio', 'MLB1', 'teste', 'painel', ?, ?, ?)").run(P, DIA, addD(DIA, 30), DIA)   // nem gravado à mão vale
  assert.equal(A.alinhado(P, { item: 'MLB1', regra: 'ima_conversao' }).sim, false); assert.deepEqual(A.listar(P), []); assert.deepEqual(A.vivos(P), [])
})

await ok('vencimento: vivo com revisar_em chegado já é vencido no predicado (estado efetivo); vencer() grava; descarte vencido devolve a ação à fila; permanente nunca vence; renovar e encerrar', () => {
  limpar()
  const v = reg({ escopo: 'anuncio', chave: 'MLB50', tipo: 'pausa_producao', revisar_em: addD(DIA, 10) }).id
  const perm = reg({ escopo: 'anuncio', chave: 'MLB51', tipo: 'descontinuado_queima_estoque', permanente: true }).id
  db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES ('PS-ven0000001', ?, 'Mercado Livre', 'anuncio_estoque_ruptura', '2026-10', 't', '72h', ?, 50, '{}', 'descartada', 'MLB52', ?, ?)").run(CLI, DIA, DIA, DIA)
  const d = reg({ escopo: 'anuncio', chave: 'MLB52', tipo: 'outro', regras: ['estoque_ruptura'], origem: 'descarte', acao_id: 'PS-ven0000001', revisar_em: addD(DIA, 10) }).id
  const depois = addD(DIA, 10)
  const r = A.alinhado(CLI, { item: 'MLB50', regra: 'anuncio_restrito' }, { hoje: depois })
  assert.equal(r.sim, false); assert.deepEqual({ tipo: r.vencido.tipo, desde: r.vencido.desde }, { tipo: 'pausa_producao', desde: DIA })
  assert.equal(A.alinhado(CLI, { item: 'MLB50', regra: 'anuncio_restrito' }, { hoje: addD(DIA, 9) }).sim, true, 'véspera ainda vivo')
  const t = A.vencer(depois)
  assert.deepEqual(t, { vencidos: 2, reabertas: 1 })
  assert.equal(db.prepare('SELECT estado FROM alinhamento WHERE id = ?').get(v).estado, 'vencido'); assert.equal(db.prepare('SELECT estado FROM alinhamento WHERE id = ?').get(d).estado, 'vencido')
  assert.equal(db.prepare('SELECT estado FROM alinhamento WHERE id = ?').get(perm).estado, 'vivo', 'permanente nunca vence')
  assert.equal(db.prepare("SELECT status FROM acoes_plano WHERE id = 'PS-ven0000001'").get().status, 'proposta', 'descarte vencido: a ação volta para revisão')
  assert.deepEqual(A.vencer(depois), { vencidos: 0, reabertas: 0 }, 'idempotente')
  const B = nucleo({ hoje: () => depois })
  assert.equal(B.renovar({ cliente: CLI, id: v, por: CONSULTOR }).revisar_em, addD(depois, 30)); assert.equal(B.alinhado(CLI, { item: 'MLB50', regra: 'anuncio_restrito' }).sim, true, 'renovado volta a valer')
  assert.equal(B.encerrar({ cliente: CLI, id: v, por: CONSULTOR }).estado, 'encerrado'); assert.equal(B.alinhado(CLI, { item: 'MLB50', regra: 'anuncio_restrito' }).sim, false)
  assert.equal(erroDe(() => B.encerrar({ cliente: CLI, id: v, por: CONSULTOR })).status, 404); assert.equal(erroDe(() => B.encerrar({ cliente: 'Outro', id: perm, por: CONSULTOR })).status, 404, 'isolamento por cliente')
})

await ok('descarte: sem motivo_tipo → 400 e nada muda; por fora da central → 403; motivo com nome → barrado; com motivo grava alinhamento (anúncio pelo item_id, conta pelas regras) com revisão +30 d; reabrir encerra', () => {
  limpar()
  const ins = db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES (?, ?, 'Mercado Livre', ?, '2026-10', 't', '7d', ?, 50, '{}', 'proposta', ?, ?, ?)")
  ins.run('PS-des0000001', CLI, 'anuncio_ads_reduzir', DIA, 'MLB300', DIA, DIA); ins.run('PS-des0000002', CLI, 'bloqueio_interno', DIA, '', DIA, DIA); ins.run('PS-des0000003', CLI, 'anuncio_estoque_ruptura', DIA, 'MLB301', DIA, DIA)
  const st = id => db.prepare('SELECT status FROM acoes_plano WHERE id = ?').get(id).status
  assert.equal(erroDe(() => marcarStatus(['PS-des0000001'], 'descartada')).status, 400)
  assert.equal(erroDe(() => marcarStatus(['PS-des0000001'], 'descartada', { por: 'Fulano', motivo_tipo: 'teste' })).status, 403)
  assert.equal(erroDe(() => marcarStatus(['PS-des0000001'], 'descartada', { por: CONSULTOR, motivo_tipo: 'nao_existe' })).status, 400)
  assert.ok(erroDe(() => marcarStatus(['PS-des0000001', 'PS-des0000002'], 'descartada', { por: CONSULTOR, motivo_tipo: 'outro', motivo: 'falei com Giovanna Torres' })).codigos.includes('analista'))
  assert.equal(erroDe(() => marcarStatus(['PS-des0000001'], 'descartada', { por: CONSULTOR, motivo_tipo: 'teste', permanente: true })).status, 400, 'permanente só descontinuado')
  assert.equal(st('PS-des0000001'), 'proposta'); assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 0, 'validação antes de qualquer gravação')
  // lote: o mesmo motivo para todas
  assert.equal(marcarStatus(['PS-des0000001', 'PS-des0000002'], 'descartada', { por: CONSULTOR, motivo_tipo: 'campanha_visibilidade', motivo: 'verba de lançamento combinada' }), 2)
  assert.equal(st('PS-des0000001'), 'descartada')
  const al = db.prepare('SELECT * FROM alinhamento ORDER BY id').all()
  assert.equal(al.length, 2)
  assert.deepEqual([al[0].escopo, al[0].chave, JSON.parse(al[0].regras_json), al[0].origem, al[0].acao_id, al[0].tipo, al[0].por, al[0].revisar_em], ['anuncio', 'MLB300', ['ads_reduzir'], 'descarte', 'PS-des0000001', 'campanha_visibilidade', CONSULTOR, addD(hojeReal, 30)])
  assert.deepEqual([al[1].escopo, al[1].chave, JSON.parse(al[1].regras_json)], ['conta', '', ['bloqueio_interno']])
  assert.equal(marcarStatus(['PS-des0000001'], 'descartada', { por: CONSULTOR, motivo_tipo: 'outro' }), 0, 'descartar de novo não duplica alinhamento')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 2)
  assert.equal(marcarStatus(['PS-des0000003'], 'descartada', { por: CONSULTOR, motivo_tipo: 'descontinuado_queima_estoque', permanente: true }), 1)
  assert.equal(db.prepare("SELECT permanente, revisar_em FROM alinhamento WHERE acao_id = 'PS-des0000003'").get().permanente, 1)
  // reabrir uma descartada exige quem decide (líder/consultor): sem "por" = 400, fora da central = 403, nada muda
  assert.equal(erroDe(() => marcarStatus(['PS-des0000001'], 'proposta')).status, 400)
  const e403 = erroDe(() => marcarStatus(['PS-des0000001'], 'aprovada', { por: 'Fulano Inventado' })); assert.equal(e403.status, 403); assert.ok(!e403.message.includes('Fulano'))
  assert.equal(st('PS-des0000001'), 'descartada'); assert.equal(db.prepare("SELECT estado FROM alinhamento WHERE acao_id = 'PS-des0000001'").get().estado, 'vivo')
  // reabrir encerra o alinhamento DAQUELE descarte, com o nome canônico de quem decidiu
  assert.equal(marcarStatus(['PS-des0000001'], 'proposta', { por: CONSULTOR }), 1)
  assert.equal(db.prepare("SELECT encerrado_por FROM alinhamento WHERE acao_id = 'PS-des0000001'").get().encerrado_por, CONSULTOR)
  assert.equal(db.prepare("SELECT estado FROM alinhamento WHERE acao_id = 'PS-des0000001'").get().estado, 'encerrado')
  assert.equal(db.prepare("SELECT estado FROM alinhamento WHERE acao_id = 'PS-des0000002'").get().estado, 'vivo')
})

await ok('rota /api/planos/acoes/status: descartar sem motivo → 400 fixo; com motivo grava; rotas de alinhamento (GET, prévia, confirmar, encerrar, renovar, 415, 404 prospect, sem eco)', async () => {
  limpar()
  db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES ('PS-rot0000001', ?, 'Mercado Livre', 'anuncio_ads_reduzir', '2026-10', 't', '7d', ?, 50, '{}', 'proposta', 'MLB400', ?, ?)").run(CLI, DIA, DIA, DIA)
  const app = express(); app.use(express.json())
  app.use(criarRotasAlinhamentos({ alinhamentos: A, quem: () => [CONSULTOR], clienteCanonico: c => c === CLI ? CLI : '' }))
  app.use(rotasPlanos)
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = async (p, corpo, tipo = 'application/json') => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); return { status: r.status, json: await r.json() } }
  try {
    const s1 = await post('/api/planos/acoes/status', { ids: ['PS-rot0000001'], status: 'descartada' })
    assert.equal(s1.status, 400); assert.equal(s1.json.erro, 'informe "motivo_tipo" (motivo da lista) para descartar')
    const s2 = await post('/api/planos/acoes/status', { ids: ['PS-rot0000001'], status: 'descartada', por: CONSULTOR, motivo_tipo: 'intencional', motivo: 'cliente prefere manter' })
    assert.equal(s2.status, 200); assert.equal(s2.json.alteradas, 1)
    assert.equal(db.prepare("SELECT origem FROM alinhamento WHERE acao_id = 'PS-rot0000001'").get().origem, 'descarte')
    const sp = await post('/api/planos/acoes/status', { ids: ['PS-rot0000001'], status: 'proposta', por: 'Intruso' }); assert.equal(sp.status, 403, 'reabrir pela rota sem líder/consultor = 403'); assert.ok(!JSON.stringify(sp.json).includes('Intruso'))
    assert.equal((await post('/api/planos/acoes/status', { ids: ['PS-rot0000001'], status: 'proposta', por: CONSULTOR })).json.alteradas, 1)
    assert.equal(db.prepare("SELECT estado FROM alinhamento WHERE acao_id = 'PS-rot0000001'").get().estado, 'encerrado')

    const g = await (await fetch(`${base}/api/cliente/alinhamentos?cliente=${encodeURIComponent(CLI)}`)).json()
    assert.deepEqual(g.alinhamentos, []); assert.equal(g.tipos.length, 8); assert.equal(g.revisao_dias_padrao, 30); assert.deepEqual(g.quem, [CONSULTOR])
    assert.equal((await post('/api/cliente/alinhamentos', 'x=1', 'text/plain')).status, 415)
    const corpo = { cliente: CLI, escopo: 'anuncio', chave: 'MLB401', tipo: 'campanha_visibilidade', acos_alvo: 30, motivo: 'visibilidade de lançamento', por: CONSULTOR }
    const pv = await post('/api/cliente/alinhamentos', { ...corpo, confirmar: 'true' }); assert.equal(pv.status, 200); assert.equal(pv.json.previa, true)
    const cf = await post('/api/cliente/alinhamentos', { ...corpo, confirmar: true }); assert.equal(cf.json.previa, false); assert.ok(cf.json.id)
    assert.equal((await post('/api/cliente/alinhamentos', { ...corpo, por: 'Intruso', confirmar: true })).status, 403)
    const pr = await post('/api/cliente/alinhamentos', { ...corpo, cliente: '[Comercial] Loja Secreta · 9', confirmar: true }); assert.equal(pr.status, 404); assert.ok(!JSON.stringify(pr.json).includes('Secreta'))
    const au = await post('/api/cliente/alinhamentos', { ...corpo, motivo: 'pedido do MLB1234567890', confirmar: true }); assert.equal(au.status, 400); assert.deepEqual(au.json.codigos, ['id_interno']); assert.ok(!au.json.erro.includes('1234567890'))
    const rn = await post('/api/cliente/alinhamentos/renovar', { cliente: CLI, id: cf.json.id, por: CONSULTOR, revisar_em: addD(DIA, 60) }); assert.equal(rn.json.revisar_em, addD(DIA, 60))
    assert.equal((await post('/api/cliente/alinhamentos/encerrar', { cliente: CLI, id: cf.json.id, por: CONSULTOR })).json.estado, 'encerrado')
    assert.equal((await post('/api/cliente/alinhamentos/encerrar', { cliente: CLI, id: cf.json.id, por: CONSULTOR })).status, 404)
  } finally { srv.close() }
})

await ok('plano por anúncio: regra alinhada não nasce e conta em omitidas.alinhado; regra fora do mapa continua; descontinuado anota a promoção como queima de estoque', () => {
  limpar()
  const diag = diagDe([campeao('MLB20'), campeao('MLB21')])
  const antes = montarAcoes(CLI, diag, { hoje: HOJE })
  assert.ok(antes.some(a => a.regra === 'anuncio_estoque_ruptura' && a.item_id === 'MLB20') && !antes.omitidas.alinhado)
  insAl({ chave: 'MLB20', tipo: 'pausa_producao' })
  const depois = montarAcoes(CLI, diag, { hoje: HOJE })
  assert.ok(!depois.some(a => a.regra === 'anuncio_estoque_ruptura' && a.item_id === 'MLB20'), 'ruptura do anúncio pausado de propósito não nasce')
  assert.ok(depois.some(a => a.regra === 'anuncio_estoque_ruptura' && a.item_id === 'MLB21'), 'o outro anúncio segue')
  assert.ok(depois.omitidas.alinhado >= 1)
  assert.equal(depois.filter(a => a.item_id === 'MLB20').length, antes.filter(a => a.item_id === 'MLB20' && a.regra !== 'anuncio_estoque_ruptura').length, 'só as regras do mapa saem')
  // descontinuado queimando estoque: a promoção para girar continua nascendo, com a nota fixa de queima (sem reposição) como primeiro passo
  const custos = { cmv_pct: 30, imposto_pct: 6, comissao_pct: 14, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const dPromo = () => diagDe([campeao('MLB21'), item({ id: 'MLB22', r: 3000, u: 30, estoque: 400, cobertura: 560 })], { custos_informados: true, custos })
  assert.ok(montarAcoes(CLI, dPromo(), { hoje: HOJE }).some(a => a.regra === 'anuncio_promocao_giro' && a.item_id === 'MLB22'), 'fixture: a promoção nasce')
  insAl({ chave: 'MLB22', tipo: 'descontinuado_queima_estoque' })
  const promo = montarAcoes(CLI, dPromo(), { hoje: HOJE }).find(a => a.regra === 'anuncio_promocao_giro' && a.item_id === 'MLB22')
  assert.ok(promo, 'a promoção não é suprimida'); assert.match(promo.dados.alinhamento.texto, /queimar o estoque restante/); assert.equal(promo.dados.como[0], promo.dados.alinhamento.texto); assert.equal(promo.dados.acao, promo.dados.alinhamento.texto)
  // prospect: nada de alinhamento nem de descarte (só calcula)
  assert.ok(montarAcoes('[Comercial] Loja X · 1', diag, { hoje: HOJE }).some(a => a.item_id === 'MLB20' && a.regra === 'anuncio_estoque_ruptura'))
})

await ok('ACOS alvo: com campanha de visibilidade alinhada (alvo 30%), ACOS 25% contra meta da conta 15% não nasce (omitidas.alinhado); ACOS 40% nasce contra o alvo, não contra a meta', () => {
  limpar()
  const ads = acos => ({ prints: 9000, clicks: 200, custo: 300, receita: 300 * 100 / acos, unidades: 10, ctr: 2.2, roas: Math.round(100 / acos * 100) / 100, acos })
  const metas = { gmv: null, roas: null, acos_max: 15, margem_pct: null }
  const diag = () => diagDe([item({ id: 'MLB60', r: 5000, u: 100, v: 600, conv: 16.7, ads: ads(25) }), item({ id: 'MLB61', r: 5000, u: 100, v: 600, conv: 16.7, ads: ads(40) })], { metas })
  const sem = montarAcoes(CLI, diag(), { hoje: HOJE }).filter(a => a.regra === 'anuncio_ads_abaixo_meta')
  assert.deepEqual(sem.map(a => a.item_id).sort(), ['MLB60', 'MLB61'], 'sem alinhamento: os dois fora da meta de 15%')
  insAl({ chave: 'MLB60', tipo: 'campanha_visibilidade', acos_alvo: 30 }); insAl({ chave: 'MLB61', tipo: 'campanha_visibilidade', acos_alvo: 30 })
  const com = montarAcoes(CLI, diag(), { hoje: HOJE }), abaixo = com.filter(a => a.regra === 'anuncio_ads_abaixo_meta')
  assert.deepEqual(abaixo.map(a => a.item_id), ['MLB61'], '25% cabe no alvo de 30%; 40% não')
  assert.equal(abaixo[0].dados.meta, 'ACOS ≤ 30%'); assert.match(abaixo[0].dados.evidencia, /alvo alinhado com o cliente: ACOS ≤ 30%/); assert.match(abaixo[0].titulo, /Ads fora do alvo alinhado com o cliente/)
  assert.equal(abaixo[0].dados.alinhamento.acos_alvo, 30); assert.match(abaixo[0].dados.alinhamento.texto, /alvo de 30% alinhado com o cliente em 10\/10/)
  assert.ok(com.omitidas.alinhado >= 1)
})

await ok('alinhamento VENCIDO: a ação nasce com dados.alinhamento_vencido {tipo, desde} e "observar: alinhado em dd/mm, revisar"', () => {
  limpar()
  insAl({ chave: 'MLB70', tipo: 'pausa_producao', estado: 'vencido', desde: '2026-09-01', revisar_em: '2026-10-01' })
  const a = montarAcoes(CLI, diagDe([campeao('MLB70')]), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura' && x.item_id === 'MLB70')
  assert.ok(a, 'vencido não suprime')
  assert.deepEqual({ tipo: a.dados.alinhamento_vencido.tipo, desde: a.dados.alinhamento_vencido.desde }, { tipo: 'pausa_producao', desde: '2026-09-01' })
  assert.equal(a.dados.alinhamento_vencido.texto, 'observar: alinhado em 01/09, revisar'); assert.match(a.dados.problema, /observar: alinhado em 01\/09, revisar$/)
  // vivo com revisar_em já passado (o tick ainda não rodou) também vira observar
  limpar(); insAl({ chave: 'MLB70', tipo: 'pausa_producao', desde: '2026-09-01', revisar_em: '2026-10-01' })
  assert.ok(montarAcoes(CLI, diagDe([campeao('MLB70')]), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura').dados.alinhamento_vencido)
})

await ok('BUG DAS VAGAS: com 2 ações descartadas no banco, as 5 vagas da semana continuam preenchidas (descartada não ocupa teto/fila) e saem contadas em omitidas.descartada', () => {
  limpar()
  const diag = () => diagDe(['MLB81', 'MLB82', 'MLB83', 'MLB84', 'MLB85', 'MLB86', 'MLB87'].map(campeao))
  const r0 = montarAcoes(CLI, diag(), { hoje: HOJE }), sem0 = r0.filter(a => a.dados.fila === 'esta_semana')
  assert.ok(r0.length >= 7 && sem0.length === algoritmo.foco.max_acoes_por_cliente_semana && sem0.length === 5)
  const [d1, d2] = sem0
  const ins = db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES (?, ?, 'Mercado Livre', ?, '2026-10', 't', '72h', ?, 50, '{}', 'descartada', ?, ?, ?)")
  for (const a of [d1, d2]) ins.run(a.id, CLI, a.regra, DIA, a.item_id, DIA, DIA)       // descartadas legadas (sem alinhamento): só o status no banco
  const r1 = montarAcoes(CLI, diag(), { hoje: HOJE }), sem1 = r1.filter(a => a.dados.fila === 'esta_semana')
  assert.equal(sem1.length, 5, '5 vagas preenchidas mesmo com 2 descartadas')
  assert.ok(!r1.some(a => a.id === d1.id || a.id === d2.id), 'descartada não volta à lista')
  assert.equal(r1.omitidas.descartada, 2)
  assert.deepEqual(sem1.map(a => a.id), r0.filter(a => a.id !== d1.id && a.id !== d2.id).slice(0, 5).map(a => a.id), 'a 6ª e a 7ª sobem para a semana')
  assert.deepEqual(r1.map(a => a.dados.posicao), r1.map((_, k) => k + 1))
})

await ok('teto por regra: descartada não ocupa vaga do teto (frete_gratis, teto 3)', () => {
  limpar()
  const cap = algoritmo.foco.max_por_regra.frete_gratis; assert.equal(cap, 3)
  const diag = () => diagDe(['MLB91', 'MLB92', 'MLB93', 'MLB94', 'MLB95'].map((id, k) => item({ id, r: 3000 + k * 100, u: 60, v: 500, conv: 12, frete_gratis: false, preco: 120 })))
  const f0 = montarAcoes(CLI, diag(), { hoje: HOJE }).filter(a => a.regra === 'anuncio_frete_gratis')
  assert.ok(f0.length >= cap, 'fixture: frete grátis dispara em mais anúncios que o teto')
  db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES (?, ?, 'Mercado Livre', 'anuncio_frete_gratis', '2026-10', 't', '30d', ?, 50, '{}', 'descartada', ?, ?, ?)").run(f0[0].id, CLI, DIA, f0[0].item_id, DIA, DIA)
  const f1 = montarAcoes(CLI, diag(), { hoje: HOJE }).filter(a => a.regra === 'anuncio_frete_gratis')
  assert.equal(f1.length, cap, 'a vaga da descartada é ocupada pela próxima da mesma regra'); assert.ok(!f1.some(a => a.id === f0[0].id))
})

await ok('acaoDeOferta: anúncio alinhado → a ação existe (o job precisa dela) mas vai para a fila, marcada, e conta em omitidas.alinhado', () => {
  limpar()
  insAl({ chave: 'MLB513', tipo: 'teste' })
  const job = { id: '3e0c980e-0000-4000-8000-000000000001', escopo: 'galeria', objetivo: 'elevar_clique', variante_id: 'v1', criado_em: '2026-10-05T10:00:00', proposta_versao: 1 }
  const of = acaoDeOferta(CLI, { regra: 'anuncio_oferta_galeria', job, item: item({ id: 'MLB513' }), baseline: { unidades: 10, preco: 50 }, diagnostico: { lentes: {} }, hoje: HOJE })
  assert.equal(of.dados.fila, 'fila'); assert.equal(of.dados.alinhado.tipo, 'teste'); assert.deepEqual(of.omitidas, { alinhado: 1 }); assert.match(of.dados.nota_foco, /alinhado com o cliente/)
  const livre = acaoDeOferta(CLI, { regra: 'anuncio_oferta_galeria', job, item: item({ id: 'MLB514' }), baseline: { unidades: 10, preco: 50 }, diagnostico: { lentes: {} }, hoje: HOJE })
  assert.equal(livre.dados.alinhado, undefined); assert.equal(livre.omitidas, undefined)
})

await ok('plano por cliente (regras de conta): alinhada não nasce (plano.omitidas.alinhado), descartada sai do top 5, vencida nasce com "observar"', () => {
  limpar()
  const cli = { cliente: CLI, status: 'Ativo', tier: '', nicho: '', canais: ['ML'], consultores: { ML: CONSULTOR }, lideres: {}, principal: CONSULTOR, squads: [], squadPrincipal: '', squadDoCanal: () => '', responsavelDoCanal: () => CONSULTOR }
  const g0 = gerarPlanoCliente(cli, { hoje: HOJE })
  const alvo = g0.acoes.find(a => a.regra === 'sem_plano_mes') || g0.acoes[0]
  assert.ok(alvo, 'o plano sintético tem ação de conta')
  insAl({ escopo: 'conta', regras_json: JSON.stringify([alvo.regra]), tipo: 'outro' })
  const g1 = gerarPlanoCliente(cli, { hoje: HOJE })
  assert.ok(!g1.acoes.some(a => a.regra === alvo.regra)); assert.equal(g1.plano.omitidas.alinhado, g0.acoes.filter(a => a.regra === alvo.regra).length)
  limpar(); insAl({ escopo: 'conta', regras_json: JSON.stringify([alvo.regra]), tipo: 'outro', estado: 'vencido', desde: '2026-09-02', revisar_em: '2026-10-02' })
  const venc = gerarPlanoCliente(cli, { hoje: HOJE }).acoes.find(a => a.id === alvo.id)
  assert.equal(venc.dados.alinhamento_vencido.texto, 'observar: alinhado em 02/09, revisar')
  limpar()
  db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, criado_em, atualizado_em) VALUES (?, ?, '', ?, '2026-10', 't', '7d', ?, 50, '{}', 'descartada', ?, ?)").run(alvo.id, CLI, alvo.regra, DIA, DIA, DIA)
  const g2 = gerarPlanoCliente(cli, { hoje: HOJE })
  assert.ok(!g2.acoes.some(a => a.id === alvo.id) && !g2.plano.resumo.top5.includes(alvo.id)); assert.equal(g2.plano.omitidas.descartada, 1)
})

// ═════════ correções do registro de alinhamentos (revisão de 10/10) ═════════
const insAcao = (id, regra, item, status = 'proposta') => db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES (?, ?, 'Mercado Livre', ?, '2026-10', 't', '72h', ?, 50, '{}', ?, ?, ?, ?)").run(id, CLI, regra, DIA, status, item, DIA, DIA)
const stAcao = id => db.prepare('SELECT status FROM acoes_plano WHERE id = ?').get(id).status

await ok('encerrar o alinhamento de um DESCARTE devolve a ação à fila na mesma transação: o montarAcoes seguinte a recria (nada de exceção permanente e invisível)', () => {
  limpar()
  const diag = () => diagDe([campeao('MLB9')])
  const a = montarAcoes(CLI, diag(), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura' && x.item_id === 'MLB9'); assert.ok(a, 'fixture: a ruptura nasce')
  insAcao(a.id, a.regra, 'MLB9')
  assert.equal(marcarStatus([a.id], 'descartada', { por: CONSULTOR, motivo_tipo: 'pausa_producao' }), 1)
  const r1 = montarAcoes(CLI, diag(), { hoje: HOJE }); assert.ok(!r1.some(x => x.id === a.id), 'descartada não volta')
  const alId = db.prepare('SELECT id FROM alinhamento WHERE acao_id = ?').get(a.id).id
  assert.deepEqual(A.encerrar({ cliente: CLI, id: alId, por: CONSULTOR }), { ok: true, id: alId, estado: 'encerrado', acao_reaberta: true })
  assert.equal(stAcao(a.id), 'proposta', 'a ação descartada voltou à fila')
  const r2 = montarAcoes(CLI, diag(), { hoje: HOJE }); assert.ok(r2.some(x => x.id === a.id), 'a recomendação volta na geração seguinte'); assert.ok(!r2.omitidas.descartada && !r2.omitidas.alinhado)
  // alinhamento de painel não mexe em ação nenhuma
  const p = reg({ escopo: 'anuncio', chave: 'MLB9', tipo: 'pausa_producao' }).id
  assert.equal(A.encerrar({ cliente: CLI, id: p, por: CONSULTOR }).acao_reaberta, false)
})

await ok('decisão humana sobre a ação depois do VENCIMENTO do descarte (aprovar, descartar de novo) encerra o alinhamento vencido: sem selo "revisar" eterno nem linha órfã', () => {
  limpar()
  insAcao('PS-vnc0000001', 'anuncio_estoque_ruptura', 'MLB31'); insAcao('PS-vnc0000002', 'anuncio_estoque_ruptura', 'MLB32')
  const amanha = addD(hojeReal, 1)
  for (const id of ['PS-vnc0000001', 'PS-vnc0000002']) marcarStatus([id], 'descartada', { por: CONSULTOR, motivo_tipo: 'teste', revisar_em: amanha })
  assert.deepEqual(A.vencer(amanha), { vencidos: 2, reabertas: 2 })
  assert.equal(stAcao('PS-vnc0000001'), 'proposta')
  assert.equal(marcarStatus(['PS-vnc0000001'], 'aprovada'), 1, 'aprovar uma proposta não exige nome')
  assert.equal(db.prepare("SELECT estado FROM alinhamento WHERE acao_id = 'PS-vnc0000001'").get().estado, 'encerrado')
  assert.equal(marcarStatus(['PS-vnc0000002'], 'descartada', { por: CONSULTOR, motivo_tipo: 'intencional' }), 1)
  assert.deepEqual(db.prepare("SELECT estado FROM alinhamento WHERE acao_id = 'PS-vnc0000002' ORDER BY id").all().map(r => r.estado), ['encerrado', 'vivo'], 'só o descarte novo fica aberto')
  assert.ok(A.listar(CLI, { hoje: amanha }).every(x => x.estado === 'vivo'), 'nenhum vencido sobrando na lista de atenção')
})

await ok('tipo herdado de Object.prototype, curinga e regra fora da lista: 400 fixo (nunca TypeError/500); escopos campanha_ads e sku recusados (nenhum consumidor os lê)', () => {
  limpar()
  for (const t of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) for (const confirmar of [false, true]) {
    const e = erroDe(() => A.registrar({ cliente: CLI, escopo: 'anuncio', chave: 'MLB1', tipo: t, por: CONSULTOR, confirmar })); assert.equal(e.status, 400, t); assert.match(e.message, /fora da lista de motivos/)
  }
  insAcao('PS-pro0000001', 'anuncio_estoque_ruptura', 'MLB1')
  const ed = erroDe(() => marcarStatus(['PS-pro0000001'], 'descartada', { por: CONSULTOR, motivo_tipo: 'toString' })); assert.equal(ed.status, 400); assert.match(ed.message, /fora da lista de motivos/)
  assert.match(erroDe(() => reg({ escopo: 'conta', tipo: 'intencional', regras: ['ad*', 'al*', 're*'] })).message, /sem curinga/)
  assert.match(erroDe(() => reg({ escopo: 'conta', tipo: 'intencional', regras: ['regra_inventada'] })).message, /fora da lista de regras/)
  assert.match(erroDe(() => reg({ escopo: 'regra', chave: 'regra_inventada', tipo: 'outro' })).message, /fora da lista de regras/)
  for (const escopo of ['campanha_ads', 'sku']) assert.match(erroDe(() => reg({ escopo, chave: 'CAMP1', tipo: 'outro' })).message, /anuncio, regra ou conta/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 0)
  // a lista fechada aceita toda regra que o plano por cliente, os gatilhos e a tela (ROT_REGRA) citam
  const src = f => readFileSync(new URL('../src/lib/' + f, import.meta.url), 'utf8')
  const doPlano = [...src('plano-cliente.js').matchAll(/regra: '([a-z_]+)'/g)].map(m => m[1])
  const doGatilho = [...src('gatilhos.js').match(/const REGRA_DO_TIPO = \{([\s\S]*?)\}/)[1].matchAll(/: '([a-z_]+)'/g)].map(m => m[1])
  const daTela = [...src('render-diagnostico-motor.js').match(/export const ROT_REGRA = \{([\s\S]*?)\}/)[1].matchAll(/([a-z_]+): '/g)].map(m => m[1])
  assert.ok(doPlano.length > 10 && doGatilho.length === 19 && daTela.length > 20)   // 12/10: +queda_por_preco e +promocao_encerrada → preco_mudou_vendas_cairam; 14/10: +estoque_zerado → anuncio_restrito
  for (const r of new Set([...doPlano, ...doGatilho, ...daTela])) assert.ok(reg({ escopo: 'conta', tipo: 'outro', regras: [r] }).id, 'regra aceita: ' + r)
})

await ok('pergunta sem regra ("esta entidade está alinhada?") só casa alinhamento da entidade INTEIRA: o descarte de uma regra não rotula nem apaga o anúncio todo', () => {
  limpar()
  insAl({ chave: 'MLB2', tipo: 'intencional', origem: 'descarte', acao_id: 'PS-x', regras_json: JSON.stringify(['ads_reduzir']) })
  insAl({ chave: 'MLB3', tipo: 'pausa_producao' })
  const p = A.predicado(CLI)
  assert.equal(p({ item: 'MLB2' }).sim, false, 'descarte de UMA regra não alinha a entidade'); assert.equal(p({ item: 'MLB2', regra: 'ads_reduzir' }).sim, true)
  assert.equal(p({ item: 'MLB3' }).sim, true, 'alinhamento sem lista de regras vale para a entidade')
})

await ok('ACOS acima do alvo é regra do PREDICADO: visibilidade com alvo 30% não cobre ACOS 60% (o aviso sai, a ação fica); "intencional" no mesmo anúncio continua cobrindo (ads_* não renasce)', () => {
  limpar()
  insAl({ chave: 'MLB61', tipo: 'campanha_visibilidade', acos_alvo: 30 })
  const p = A.predicado(CLI)
  assert.equal(p({ item: 'MLB61', regra: 'anuncio_ads_abaixo_meta', aviso: true }).sim, true, 'sem ACOS na pergunta: cobre (o plano mede a regra contra o alvo)')
  assert.equal(p({ item: 'MLB61', regra: 'anuncio_ads_abaixo_meta', aviso: true, acos: 25 }).sim, true)
  const r = p({ item: 'MLB61', regra: 'anuncio_ads_abaixo_meta', aviso: true, acos: 60 }); assert.equal(r.sim, false); assert.equal(r.acima_do_alvo.acos_alvo, 30)
  assert.equal(p({ item: 'MLB61', regra: 'queda_ctr_ads', acos: 60 }).sim, true, 'só as regras de ACOS olham o alvo')
  assert.equal(acosDaAcao({ dados: { alinhamento: { acos_alvo: 30 } } }), Infinity); assert.equal(acosDaAcao({}, { ads: { acos: 12 } }), 12); assert.equal(acosDaAcao({ dados: {} }), undefined)
  insAl({ chave: 'MLB62', tipo: 'intencional' }); insAl({ chave: 'MLB62', tipo: 'campanha_visibilidade', acos_alvo: 30 })
  assert.equal(A.predicado(CLI)({ item: 'MLB62', regra: 'ads_reduzir', acos: 40 }).sim, true, 'intencional (todas, sem alvo) segue cobrindo')
  const ads = acos => ({ prints: 9000, clicks: 200, custo: 300, receita: 300 * 100 / acos, unidades: 10, ctr: 2.2, roas: Math.round(100 / acos * 100) / 100, acos })
  const acs = montarAcoes(CLI, diagDe([item({ id: 'MLB62', r: 5000, u: 100, v: 600, conv: 16.7, ads: ads(40) })], { metas: { gmv: null, roas: null, acos_max: 15, margem_pct: null } }), { hoje: HOJE })
  assert.ok(!acs.some(a => a.item_id === 'MLB62' && /ads_(reduzir|abaixo_meta)$/.test(a.regra)), 'nenhuma ação de Ads no anúncio intencional'); assert.ok(acs.omitidas.alinhado >= 1)
})

await ok('descartar a ação sazonal de UM evento (Black Friday) não silencia o outro evento do mesmo anúncio (Natal)', () => {
  limpar()
  const jan = (evento, data) => ({ evento, data, dias: 40, acao: 'preparar', produtos: ['MLB81'], n_produtos: 1, limites: { conteudo: '2026-10-20', reposicao: '2026-10-25', campanha: '2026-11-01' }, estagio: 'preparar agora', evidencia: 'calendário comercial' })
  const diag = () => diagDe([campeao('MLB81')], { janelas: [jan('Black Friday', '2026-11-27'), jan('Natal', '2026-12-25')] })
  const saz = () => montarAcoes(CLI, diag(), { hoje: HOJE }).filter(a => a.regra === 'anuncio_sazonal' && a.item_id === 'MLB81').map(a => ({ id: a.id, evento: a.titulo.split(':')[0] }))
  const s0 = saz(); assert.deepEqual(s0.map(x => x.evento).sort(), ['Black Friday', 'Natal'])
  const bf = s0.find(x => x.evento === 'Black Friday')
  insAcao(bf.id, 'anuncio_sazonal', 'MLB81')
  assert.equal(marcarStatus([bf.id], 'descartada', { por: CONSULTOR, motivo_tipo: 'intencional' }), 1)
  assert.deepEqual(saz().map(x => x.evento), ['Natal'], 'só a Black Friday sai')
})

await ok('Sprint 90 (semConsultor): alinhamento vencido não escreve "observar: … revisar" no problema que o painel do cliente projeta; a nota fica em dados.alinhamento_vencido', async () => {
  limpar()
  const S90 = '[S90] Loja Teste · 0123abcd'
  insAl({ cliente: S90, chave: 'MLB70', tipo: 'pausa_producao', estado: 'vencido', desde: '2026-09-01', revisar_em: '2026-10-01', origem: 's90_cliente', por: 'cliente' })
  const a = montarAcoes(S90, diagDe([campeao('MLB70')]), { hoje: HOJE, semConsultor: true }).find(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(a.dados.alinhamento_vencido.texto, 'observar: alinhado em 01/09, revisar'); assert.doesNotMatch(a.dados.problema, /observar/)
  const { acaoParaCliente } = await import('../src/lib/s90-texto.js')
  assert.doesNotMatch(JSON.stringify(acaoParaCliente(a)), /observar|revisar/)
})

await ok('config/alinhamentos.json inválida não derruba o servidor: db.js importa só o schema; o núcleo vem desligado (predicado "não alinhado", escrita e rotas 503 com o motivo)', async () => {
  assert.doesNotMatch(readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8'), /from '\.\/alinhamentos\.js'/)
  const codigo = `
    import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'
    const orig = fs.readFileSync
    fs.readFileSync = (p, ...a) => String(p).endsWith('alinhamentos.json') ? String(orig(p, ...a)).replaceAll('{data}', '') : orig(p, ...a)
    syncBuiltinESMExports()
    process.env.PS_DB_MEMORIA = '1'
    const { db } = await import('./src/lib/db.js')
    const N = await import('./src/lib/alinhamentos.js')
    const A = N.criarAlinhamentos({ handle: db })
    let st = 0; try { A.registrar({}) } catch (e) { st = e.status }
    console.log(JSON.stringify({ cfg: N.CFG, erro: N.CFG_ERRO, sim: A.predicado('X')({ item: 'MLB1', regra: 'estoque_ruptura' }).sim, st, tabela: !!db.prepare("SELECT name FROM sqlite_master WHERE name = 'alinhamento'").get() }))`
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', codigo], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const r = JSON.parse(saida.trim().split('\n').at(-1))
  assert.deepEqual([r.cfg, r.sim, r.st, r.tabela], [null, false, 503, true]); assert.match(r.erro, /texto_cliente/)
  const app = express(); app.use(express.json())
  app.use(criarRotasAlinhamentos({ alinhamentos: criarAlinhamentos({ handle: db, cfg: null, cfgErro: 'config/alinhamentos.json: teste' }), quem: () => [], clienteCanonico: c => c }))
  const srv = await new Promise(ok2 => { const s = app.listen(0, '127.0.0.1', () => ok2(s)) })
  try {
    const base = `http://127.0.0.1:${srv.address().port}`
    for (const [m, p] of [['GET', '/api/alinhamentos/tipos'], ['GET', '/api/cliente/alinhamentos?cliente=X'], ['POST', '/api/cliente/alinhamentos'], ['POST', '/api/cliente/alinhamentos/encerrar']]) {
      const x = await fetch(base + p, m === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cliente: 'X', id: 1, escopo: 'conta', tipo: 'outro' }) } : undefined)
      assert.equal(x.status, 503, p); assert.match((await x.json()).erro, /indisponíveis: config\/alinhamentos\.json: teste/)
    }
  } finally { srv.close() }
})

limpar()
console.log(`\nteste-alinhamentos: ${n} verificações ok`)
