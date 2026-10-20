// Autoteste do histórico do anúncio (meli_item_mudanca), da semeadura e das dimensões de recorte (nicho/região).
// Banco EM MEMÓRIA com o schema inteiro (PS_DB_MEMORIA=1 antes dos imports dinâmicos): nunca abre data/db.sqlite, nunca chama a API do ML.
// Rodar: node scripts/teste-historico-anuncio.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
const { db } = await import('../src/lib/db.js')
const S = await import('../src/lib/meli-serie.js')
const H = await import('../src/lib/preco-historico.js')
const C = await import('../src/lib/meli-contas.js')
const D = await import('../src/lib/dimensoes.js')
const E = await import('../src/lib/estado-anuncio.js')
const { SCHEMA_MUDANCA, migrarMudanca } = await import('../src/lib/acomp-schema.js')
const { anunciosDoCliente } = await import('../src/lib/anuncios.js')
const { validar: validarFiltro } = await import('../src/lib/filtros.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const item = (id, o = {}) => ({ id, title: 'Coleira Gatos P', permalink: '', thumbnail: 'http://http2.mlstatic.com/D_111-MLA1_102025-I.jpg', price: 50, original_price: null,
  status: 'active', available_quantity: 5, sold_quantity: 0, pictures: [{}, {}, {}], shipping: { free_shipping: false, logistic_type: 'cross_docking' }, listing_type_id: 'gold_special', ...o })
const muds = (cli, item_id) => db.prepare('SELECT dia, campo, de, para, variacao_pct, fonte FROM meli_item_mudanca WHERE cliente = ? AND item_id = ? ORDER BY campo').all(cli, item_id)
const campos = (cli, item_id) => muds(cli, item_id).map(m => m.campo)

ok('1ª leitura não gera evento; diff por campo na leitura seguinte (preço, título, fotos, status, frete, logística, capa)', () => {
  S.gravarItens('A', [item('MLB1')], { dia: '2026-10-01' })
  assert.deepEqual(muds('A', 'MLB1'), [], 'sem leitura anterior não há "de"')
  S.gravarItens('A', [item('MLB1', { price: 55, title: 'Coleira Gatos P Antipulgas', pictures: [{}, {}, {}, {}], status: 'paused', shipping: { free_shipping: true, logistic_type: 'fulfillment' }, thumbnail: 'https://http2.mlstatic.com/D_222-MLA1_102025-I.jpg' })], { dia: '2026-10-02' })
  assert.deepEqual(campos('A', 'MLB1'), ['fotos', 'frete_gratis', 'logistica', 'preco', 'status', 'thumb', 'titulo'])
  const p = muds('A', 'MLB1').find(m => m.campo === 'preco')
  assert.deepEqual(p, { dia: '2026-10-02', campo: 'preco', de: '50', para: '55', variacao_pct: 10, fonte: 'coleta' })
  assert.equal(muds('A', 'MLB1').find(m => m.campo === 'logistica').para, 'fulfillment')
})

ok('1 centavo conta (comparação em centavos); ruído de ponto flutuante não', () => {
  S.gravarItens('B', [item('MLB2', { price: 50 })], { dia: '2026-10-01' })
  S.gravarItens('B', [item('MLB2', { price: 50.01 })], { dia: '2026-10-02' })
  assert.deepEqual(muds('B', 'MLB2').map(m => [m.campo, m.de, m.para, m.variacao_pct]), [['preco', '50', '50.01', 0.02]])
  S.gravarItens('B', [item('MLB2', { price: 50.010000001 })], { dia: '2026-10-03' })
  assert.equal(muds('B', 'MLB2').length, 1)
})

ok('preco_original: gravado em meli_item; valor anterior null NÃO gera evento; sumir (desconto acabou) gera', () => {
  S.gravarItens('C', [item('MLB3')], { dia: '2026-10-01' })
  S.gravarItens('C', [item('MLB3', { original_price: 60, price: 50 })], { dia: '2026-10-02' })
  assert.equal(db.prepare("SELECT preco_original FROM meli_item WHERE cliente = 'C' AND item_id = 'MLB3'").get().preco_original, 60)
  assert.deepEqual(campos('C', 'MLB3'), [], 'null → 60 não é mudança (1ª coleta depois da coluna nova criaria centenas de falsos)')
  S.gravarItens('C', [item('MLB3', { original_price: null, price: 50 })], { dia: '2026-10-03' })
  assert.deepEqual(muds('C', 'MLB3').map(m => [m.campo, m.de, m.para, m.variacao_pct]), [['preco_original', '60', null, null]])
})

ok('estoque só gera evento ao cruzar o zero (estoque_zero), nos dois sentidos', () => {
  S.gravarItens('E', [item('MLB4', { available_quantity: 5 })], { dia: '2026-10-01' })
  S.gravarItens('E', [item('MLB4', { available_quantity: 3 })], { dia: '2026-10-02' })
  assert.deepEqual(campos('E', 'MLB4'), [])
  S.gravarItens('E', [item('MLB4', { available_quantity: 0 })], { dia: '2026-10-03' })
  S.gravarItens('E', [item('MLB4', { available_quantity: 0 })], { dia: '2026-10-04' })
  S.gravarItens('E', [item('MLB4', { available_quantity: 4 })], { dia: '2026-10-05' })
  assert.deepEqual(muds('E', 'MLB4').map(m => [m.dia, m.de, m.para]), [['2026-10-03', '3', '0'], ['2026-10-05', '0', '4']])
})

ok('valor anterior VAZIO (fotografia antiga sem logística/status) não é leitura: "não coletado → fulfillment" não vira "foi para o Full"; linha antiga com de="" some de eventosAnuncio', () => {
  S.gravarItens('V', [item('MLB9', { shipping: { free_shipping: false, logistic_type: '' } })], { dia: '2026-10-01' })
  S.gravarItens('V', [item('MLB9', { shipping: { free_shipping: false, logistic_type: 'fulfillment' } })], { dia: '2026-10-02' })
  assert.deepEqual(campos('V', 'MLB9'), [], "'' → fulfillment não é mudança (sem leitura anterior)")
  S.gravarItens('V', [item('MLB9', { shipping: { free_shipping: false, logistic_type: 'cross_docking' } })], { dia: '2026-10-03' })
  assert.deepEqual(muds('V', 'MLB9').map(m => [m.de, m.para]), [['fulfillment', 'cross_docking']], 'com leitura anterior a saída do Full conta')
  assert.deepEqual(H.diffAnuncio({ logistica: '', status: '', titulo: '' }, { logistica: 'fulfillment', status: 'active', titulo: 'x' }), [])
  db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, fonte, em) VALUES ('V','MLB9','2026-10-04','logistica','','fulfillment','acomp','x')").run()   // linha gravada antes da guarda (banco real tem 4)
  assert.deepEqual(H.historico.eventosAnuncio('V').get('MLB9').map(e => e.dia), ['2026-10-03'], 'de vazio não é evento para nenhum leitor')
})

ok('capa: mesma foto com sufixo de tamanho diferente (-I × -O) não conta; foto diferente conta', () => {
  S.gravarItens('F', [item('MLB5')], { dia: '2026-10-01' })
  S.gravarItens('F', [item('MLB5', { thumbnail: 'https://http2.mlstatic.com/D_111-MLA1_102025-O.jpg' })], { dia: '2026-10-02' })
  assert.deepEqual(campos('F', 'MLB5'), [])
  assert.equal(H.igualCampo('thumb', 'x/D_1-I.webp', 'x/D_1-O.jpg'), true, 'a mesma foto servida em webp/jpg (regra de acompanhamento.js)')
  S.gravarItens('F', [item('MLB5', { thumbnail: 'https://http2.mlstatic.com/D_999-MLA1_102025-O.jpg' })], { dia: '2026-10-03' })
  assert.deepEqual(campos('F', 'MLB5'), ['thumb'])
  assert.equal(H.igualCampo('preco', 10.1, 10.10000001), true)
})

ok('mesmo dia, mesmo campo (2ª coleta do dia): a linha guarda o "de" da 1ª e o "para" da última; foi e voltou = sem linha; isolamento por cliente', () => {
  S.gravarItens('G', [item('MLB6', { price: 10 })], { dia: '2026-10-01' })
  S.gravarItens('G', [item('MLB6', { price: 11 })], { dia: '2026-10-02' })
  S.gravarItens('G', [item('MLB6', { price: 12 })], { dia: '2026-10-02' })
  assert.deepEqual(muds('G', 'MLB6').map(m => [m.de, m.para, m.variacao_pct]), [['10', '12', 20]], '10→11→12 no mesmo dia = 10→12 (+20%), a 2ª mudança não se perde')
  S.gravarItens('G3', [item('MLB6', { price: 50 })], { dia: '2026-10-01' })
  S.gravarItens('G3', [item('MLB6', { price: 55 })], { dia: '2026-10-02' })
  S.gravarItens('G3', [item('MLB6', { price: 50 })], { dia: '2026-10-02' })
  assert.deepEqual(muds('G3', 'MLB6'), [], '50→55→50 no mesmo dia não vira alta fantasma (meli_item volta a 50)')
  assert.equal(db.prepare("SELECT preco FROM meli_item WHERE cliente = 'G3' AND item_id = 'MLB6'").get().preco, 50)
  S.gravarItens('G2', [item('MLB6', { price: 99 })], { dia: '2026-10-02' })   // mesmo MLB em outro cliente: leitura própria, sem "de" herdado
  assert.deepEqual(muds('G2', 'MLB6'), [])
})

ok('eventosAnuncio: filtra por item, data e campo (lista fechada); números de volta; ordem por dia', () => {
  S.gravarItens('H', [item('MLB7', { price: 20 }), item('MLB8', { price: 30 })], { dia: '2026-09-01' })
  S.gravarItens('H', [item('MLB7', { price: 22 }), item('MLB8', { price: 33 })], { dia: '2026-09-05' })
  S.gravarItens('H', [item('MLB7', { price: 21, title: 'Outro título' }), item('MLB8', { price: 33 })], { dia: '2026-09-10' })
  const todos = H.historico.eventosAnuncio('H')
  assert.deepEqual([...todos.keys()], ['MLB7', 'MLB8'])
  assert.deepEqual(todos.get('MLB7').map(e => [e.dia, e.campo]), [['2026-09-05', 'preco'], ['2026-09-10', 'preco'], ['2026-09-10', 'titulo']])
  assert.deepEqual(todos.get('MLB7')[0], { dia: '2026-09-05', campo: 'preco', de: 20, para: 22, pct: 10, fonte: 'coleta' })
  const so7 = H.historico.eventosAnuncio('H', { itens: ['MLB7'], de: '2026-09-06', campos: ['preco', "x') OR 1=1 --"] })
  assert.deepEqual([...so7.keys()], ['MLB7']); assert.deepEqual(so7.get('MLB7').map(e => [e.dia, e.de, e.para]), [['2026-09-10', 22, 21]])
  assert.equal(H.historico.eventosAnuncio('H', { ate: '2026-09-04' }).size, 0)
  assert.equal(H.historico.eventosAnuncio('outro').size, 0, 'isolamento por cliente')
  assert.equal(H.historico.inicioHistorico('H'), '2026-09-05'); assert.equal(H.historico.inicioHistorico('ninguem'), null)
})

ok('precoRealizado = receita ÷ unidades só nos dias com venda', () => {
  const serie = { unidades: { '2026-09-01': 2, '2026-09-02': 0, '2026-09-03': 1, '2026-09-10': 5 }, receita: { '2026-09-01': 100, '2026-09-03': 56, '2026-09-10': 1 } }
  assert.equal(H.precoRealizado(serie, '2026-09-01', '2026-09-05'), 52)
  assert.equal(H.precoRealizado(serie, '2026-09-04', '2026-09-09'), null, 'sem venda não há preço (nunca zero)')
  assert.equal(H.precoRealizado(null, '2026-09-01', '2026-09-30'), null)
})

ok('semeadura: promo (início e fim), fotografias do acompanhamento (linha do tempo do anúncio) e Ofertas verificadas; idempotente; prospect fora', () => {
  const cli = 'Semente', hoje = '2026-10-07'
  const of = db.prepare('INSERT INTO promo_oferta (cliente, item_id, pid, offer_id, status, preco, preco_original, inicio, fim, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)')
  of.run(cli, 'MLB10', 'P1', '', 'started', 45, 50, '2026-09-10T00:00:00', '2026-10-10T23:59:59', 'x')          // em curso: só o início
  of.run(cli, 'MLB10', 'P2', '', 'started', 40, 50, '2026-09-10T00:00:00-03:00', '2026-10-15T00:00:00-03:00', 'x')   // mesmo dia, menor preço: vale esta
  of.run(cli, 'MLB11', 'P3', '', 'started', 90, 100, '2026-09-01T03:00:00Z', '2026-10-01T02:59:59Z', 'x')            // já acabou: início e fim (UTC → dia local)
  of.run(cli, 'MLB12', 'P4', '', 'started', 80, 100, '', '', 'x')                                                  // SMART sem data: não vira evento
  of.run(cli, 'MLB13', 'P5', '', 'started', 70, 70, '2026-09-20T00:00:00', '', 'x')                                // sem desconto
  of.run(cli, 'MLB14', 'P6', '', 'candidate', 70, 90, '2026-09-20T00:00:00', '', 'x')                              // só candidata
  const foto = db.prepare('INSERT INTO tarefa_acomp (tarefa_id, item_id, fase, cliente, data_ref, capturado_em, estado_json) VALUES (?,?,?,?,?,?,?)')
  const attrs = o => JSON.stringify({ attrs: { titulo: 'T', preco: 53, fotos: 7, estoque: 2, status: 'active', frete_gratis: 0, tipo_anuncio: 'gold_special', logistica: '', thumb: 'https://x/D_1-I.jpg', ...o } })
  foto.run('t1', 'MLB20', 'antes', cli, '2026-09-28', '2026-09-28T09:00:00.000Z', attrs({}))
  foto.run('t2', 'MLB20', 'antes', cli, '2026-09-30', '2026-09-30T09:00:00.000Z', attrs({}))
  foto.run('t1', 'MLB20', 'd1', cli, '2026-09-28', '2026-10-02T09:00:00.000Z', attrs({ preco: 57.24, fotos: 8 }))
  foto.run('t2', 'MLB20', 'd1', cli, '2026-09-30', '2026-10-02T09:00:01.000Z', attrs({ preco: 57.24, fotos: 8 }))  // a MESMA mudança vista pela 2ª tarefa
  foto.run('t1', 'MLB20', 'd2', cli, '2026-09-28', '2026-10-03T09:00:00.000Z', attrs({ preco: 57.24, fotos: 8, estoque: 0 }))
  const pub = db.prepare("INSERT INTO of_publicacao (id, job_id, cliente, canal, anuncio_id, versao, chave_idem, operacao, diff_json, estado, criado_em, atualizado_em, verificado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
  pub.run('p1', 'j', cli, 'ML', 'MLB30', 1, 'k1', 'atualizar', JSON.stringify([{ campo: 'titulo', de: 'a', para: 'b' }, { campo: 'preco', de: 100, para: 95 }]), 'verificada', 'x', 'x', '2026-09-15T15:00:00.000Z')
  pub.run('p2', 'j', cli, 'ML', 'MLB31', 1, 'k2', 'atualizar', JSON.stringify([{ campo: 'preco', de: 100, para: 90 }]), 'preparada', 'x', 'x', '')   // não verificada
  pub.run('p3', 'j', cli, 'ML', 'MLB32', 1, 'k3', 'atualizar', '{}', 'verificada', 'x', 'x', '2026-09-15T15:00:00.000Z')                      // diff vazio

  // promocao (estado): MLB10 entra (vale a oferta de menor preço) · MLB11 entra e sai · MLB13 entra (promoção sem desconto ainda é promoção) = 4
  assert.deepEqual(H.historico.semearHistoricoAnuncio(cli, { hoje }), { promo: 3, acomp: 3, ofertas: 1, promocao: 4 })
  assert.deepEqual(H.historico.semearHistoricoAnuncio(cli, { hoje }), { promo: 0, acomp: 0, ofertas: 0, promocao: 0 }, '2ª execução não insere nada')
  assert.deepEqual(H.historico.semearHistoricoAnuncio('[Comercial] Loja X · 1', { hoje }), { promo: 0, acomp: 0, ofertas: 0, promocao: 0 })
  const preco = (id) => muds(cli, id).filter(m => m.campo === 'preco'), promocao = id => muds(cli, id).filter(m => m.campo === 'promocao')
  assert.deepEqual(preco('MLB10').map(m => [m.dia, m.de, m.para, m.variacao_pct, m.fonte]), [['2026-09-10', '50', '40', -20, 'promo']])
  assert.deepEqual(promocao('MLB10').map(m => [m.dia, m.de, m.para, m.variacao_pct, m.fonte]), [['2026-09-10', 'nenhuma', 'PROMOCAO −20%', null, 'promo']], 'estado: tipo vazio vira PROMOCAO; % da oferta de menor preço')
  assert.deepEqual(preco('MLB11').map(m => [m.dia, m.de, m.para]).sort(), [['2026-09-01', '100', '90'], ['2026-09-30', '90', '100']].sort())
  assert.deepEqual(promocao('MLB11').map(m => [m.dia, m.de, m.para]).sort(), [['2026-09-01', 'nenhuma', 'PROMOCAO −10%'], ['2026-09-30', 'PROMOCAO −10%', 'nenhuma']].sort())
  assert.deepEqual(promocao('MLB13').map(m => [m.dia, m.de, m.para]), [['2026-09-20', 'nenhuma', 'PROMOCAO']], 'sem desconto: estado sem %')
  assert.deepEqual(muds(cli, 'MLB20').map(m => [m.dia, m.campo, m.de, m.para, m.fonte]), [['2026-10-03', 'estoque_zero', '2', '0', 'acomp'], ['2026-10-02', 'fotos', '7', '8', 'acomp'], ['2026-10-02', 'preco', '53', '57.24', 'acomp']])
  assert.deepEqual(muds(cli, 'MLB30').map(m => [m.dia, m.campo, m.de, m.para, m.fonte]), [['2026-09-15', 'preco', '100', '95', 'ofertas']])
  for (const id of ['MLB12', 'MLB14', 'MLB31', 'MLB32']) assert.deepEqual(muds(cli, id), [], id)
  assert.deepEqual(preco('MLB13'), [], 'sem desconto não há evento de preço')
  // leitura: mudança vista entre duas fotografias declara o intervalo (a fotografia anterior com o valor antigo é de 30/09)
  const ev = H.historico.eventosAnuncio(cli, { itens: ['MLB20'], campos: ['preco'] }).get('MLB20')
  assert.deepEqual(ev, [{ dia: '2026-10-02', campo: 'preco', de: 53, para: 57.24, pct: 8, fonte: 'acomp', incerteza: 'mudou entre 30/09 e 02/10' }])
  assert.equal(H.historico.eventosAnuncio(cli, { itens: ['MLB20'], campos: ['estoque_zero'] }).get('MLB20')[0].incerteza, 'mudou entre 02/10 e 03/10')
  assert.equal(H.historico.eventosAnuncio(cli, { itens: ['MLB10'] }).get('MLB10')[0].incerteza, undefined, 'promo tem dia exato')
})

ok('semeadura só cobre o período ANTES do histórico da coleta (rodar depois não duplica o que a coleta já viu)', () => {
  const cli = 'Corte'
  S.gravarItens(cli, [item('MLB40', { price: 50 })], { dia: '2026-09-19' })
  S.gravarItens(cli, [item('MLB40', { price: 45 })], { dia: '2026-09-20' })                     // a coleta já registra a partir de 20/09
  const of = db.prepare('INSERT INTO promo_oferta (cliente, item_id, pid, offer_id, status, preco, preco_original, inicio, fim, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)')
  of.run(cli, 'MLB40', 'P1', '', 'started', 45, 50, '2026-09-20T00:00:00', '', 'x')
  of.run(cli, 'MLB41', 'P2', '', 'started', 45, 50, '2026-09-01T00:00:00', '2026-09-25T00:00:00', 'x')
  assert.deepEqual(H.historico.semearHistoricoAnuncio(cli, { hoje: '2026-10-07' }), { promo: 1, acomp: 0, ofertas: 0, promocao: 1 })
  assert.deepEqual(muds(cli, 'MLB41').map(m => [m.campo, m.dia]), [['preco', '2026-09-01'], ['promocao', '2026-09-01']], 'a saída em 25/09 já é depois do corte: a coleta cobre')
})

ok('semeadura do estado de promoção: anúncio que já tem evento promocao com dia ≥ início (a coleta de promoções registrou) é pulado inteiro', () => {
  const cli = 'JaTem'
  db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,'promocao','nenhuma','SMART −15%',NULL,'promo','x')").run(cli, 'MLB50', '2026-09-12')
  const of = db.prepare('INSERT INTO promo_oferta (cliente, item_id, pid, offer_id, tipo, status, preco, preco_original, inicio, fim, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  of.run(cli, 'MLB50', 'P1', '', 'SMART', 'started', 85, 100, '2026-09-10T00:00:00', '2026-09-20T00:00:00', 'x')   // a coleta já viu a entrada (12/09): não duplica nem a saída
  of.run(cli, 'MLB51', 'P2', '', 'DEAL', 'started', 85, 100, '2026-09-10T00:00:00', '', 'x')
  assert.deepEqual(H.historico.semearHistoricoAnuncio(cli, { hoje: '2026-10-07' }), { promo: 3, acomp: 0, ofertas: 0, promocao: 1 }, 'preço: MLB50 entra e sai + MLB51 entra; estado: só MLB51')
  assert.deepEqual(muds(cli, 'MLB50').filter(m => m.campo === 'promocao').map(m => m.dia), ['2026-09-12'])
  assert.deepEqual(muds(cli, 'MLB51').filter(m => m.campo === 'promocao').map(m => [m.dia, m.de, m.para]), [['2026-09-10', 'nenhuma', 'DEAL −15%']])
})

ok('migração do CHECK (migrarMudanca): preserva linhas e ids, recria o índice, aceita promocao/ads, recusa campo e fonte inválidos; 2ª execução nada faz', () => {
  const h = new Database(':memory:')
  h.exec(`CREATE TABLE meli_item_mudanca (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, item_id TEXT NOT NULL, dia TEXT NOT NULL,
    campo TEXT NOT NULL CHECK (campo IN ('preco','preco_original','titulo','fotos','estoque_zero','status','frete_gratis','logistica','thumb')),
    de TEXT, para TEXT, variacao_pct REAL, fonte TEXT NOT NULL CHECK (fonte IN ('coleta','acomp','promo','ofertas','webhook')), em TEXT NOT NULL,
    UNIQUE (cliente, item_id, dia, campo, fonte)); CREATE INDEX ix_item_mudanca ON meli_item_mudanca (cliente, item_id, dia);`)
  const ins = h.prepare("INSERT INTO meli_item_mudanca (id, cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,?,?,?,?,?,?,'x')")
  ins.run(7, 'A', 'MLB1', '2026-10-01', 'preco', '50', '55', 10, 'coleta'); ins.run(9, 'B', 'MLB2', '2026-10-02', 'titulo', 'a', 'b', null, 'acomp')
  assert.throws(() => ins.run(10, 'A', 'MLB1', '2026-10-03', 'promocao', 'nenhuma', 'SMART −10%', null, 'promo'), /CHECK/, 'DDL antigo recusa promocao')
  assert.equal(migrarMudanca(h), true)
  assert.deepEqual(h.prepare('SELECT id, cliente, item_id, campo, de, para, variacao_pct, fonte FROM meli_item_mudanca ORDER BY id').all(),
    [{ id: 7, cliente: 'A', item_id: 'MLB1', campo: 'preco', de: '50', para: '55', variacao_pct: 10, fonte: 'coleta' }, { id: 9, cliente: 'B', item_id: 'MLB2', campo: 'titulo', de: 'a', para: 'b', variacao_pct: null, fonte: 'acomp' }])
  assert.equal(h.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name='ix_item_mudanca' AND tbl_name='meli_item_mudanca'").get().n, 1, 'índice recriado na tabela nova')
  assert.equal(h.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='meli_item_mudanca_v1'").get().n, 0)
  ins.run(10, 'A', 'MLB1', '2026-10-03', 'promocao', 'nenhuma', 'SMART −10%', null, 'promo'); ins.run(11, 'A', 'MLB1', '2026-10-03', 'ads', 'idle', 'active', null, 'ads')
  assert.throws(() => ins.run(12, 'A', 'MLB1', '2026-10-04', 'anuncio_dia', 'x', 'y', null, 'coleta'), /CHECK/)
  assert.throws(() => ins.run(13, 'A', 'MLB1', '2026-10-04', 'preco', 'x', 'y', null, 'folha'), /CHECK/)
  assert.equal(h.prepare('SELECT MAX(id) m FROM meli_item_mudanca').get().m, 11, 'AUTOINCREMENT continua do maior id')
  assert.equal(migrarMudanca(h), false, 'já migrado: nada')
  // a chave da idempotência é a lista inteira dos dois CHECKs: DDL que já tem 'promocao' no campo mas uma lista de fonte velha ainda migra
  const meio = new Database(':memory:')
  meio.exec(SCHEMA_MUDANCA.replace("'webhook','ads'", "'webhook'"))
  meio.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, fonte, em) VALUES ('A','MLB1','2026-10-01','promocao','nenhuma','SMART −10%','promo','x')").run()
  assert.equal(migrarMudanca(meio), true, 'lista de fonte diferente do DDL: migra'); assert.equal(migrarMudanca(meio), false)
  meio.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, fonte, em) VALUES ('A','MLB1','2026-10-02','ads','idle','active','ads','x')").run()
  assert.equal(meio.prepare('SELECT COUNT(*) n FROM meli_item_mudanca').get().n, 2)
  const novo = new Database(':memory:'); novo.exec(SCHEMA_MUDANCA)
  assert.equal(migrarMudanca(novo), false, 'banco novo já nasce certo'); assert.equal(migrarMudanca(new Database(':memory:')), false, 'sem a tabela: nada')
  assert.match(SCHEMA_MUDANCA, /'promocao','ads','descricao','atributos','categoria','tipo_anuncio'\)/); assert.match(SCHEMA_MUDANCA, /'webhook','ads','chaveiro'\)/)   // F4+: execução conferida do Chaveiro é fonte do change-log (atribuição § 8, fonte 1)
  assert.throws(() => H.historico.registrarEstados('A', [{ item_id: 'MLB1', campo: 'preco', de: '1', para: '2' }], { fonte: 'ads' }), /fora da lista/)
  assert.throws(() => H.historico.registrarEstados('A', [{ item_id: 'MLB1', campo: 'ads', de: 'idle', para: 'active' }]), /fonte/)
})

ok('estado-anuncio (puro): estadoPromocao, diffPromocao (fronteira nenhuma / tipo), diffAds (fronteira active), cruzaFronteira, estadoEm', () => {
  assert.equal(E.estadoPromocao([]), 'nenhuma'); assert.equal(E.estadoPromocao([{ status: 'candidate', tipo: 'SMART', preco: 80, preco_original: 100 }]), 'nenhuma')
  assert.equal(E.estadoPromocao([{ status: 'started', tipo: 'SMART', preco: 90, preco_original: 100 }, { status: 'started', tipo: 'DEAL', preco: 85, preco_original: 100 }]), 'DEAL −15%', 'a started de menor preço')
  assert.equal(E.estadoPromocao([{ status: 'started', tipo: 'SMART', preco: null, preco_original: null }]), 'SMART', 'sem preços: só o tipo')
  assert.equal(E.tipoPromocao('DEAL −15%'), 'DEAL'); assert.equal(E.tipoPromocao('nenhuma'), '')
  const lidos = new Set(['MLB1', 'MLB2', 'MLB3', 'MLB4'])
  const d = E.diffPromocao(new Map([['MLB1', 'nenhuma'], ['MLB2', 'SMART −10%'], ['MLB3', 'SMART −10%'], ['MLB4', 'SMART −10%']]),
    new Map([['MLB1', 'SMART −10%'], ['MLB2', 'SMART −20%'], ['MLB3', 'DEAL −10%'], ['MLB4', 'nenhuma'], ['MLB5', 'SMART −10%']]), lidos)
  assert.deepEqual(d, [{ item_id: 'MLB1', campo: 'promocao', de: 'nenhuma', para: 'SMART −10%', pct: null }, { item_id: 'MLB3', campo: 'promocao', de: 'SMART −10%', para: 'DEAL −10%', pct: null }, { item_id: 'MLB4', campo: 'promocao', de: 'SMART −10%', para: 'nenhuma', pct: null }],
    'só % mudando não é evento; anúncio nunca lido antes (MLB5) não tem "de"')
  assert.deepEqual(E.diffAds(new Map(), new Map([['MLB1', 'active']])), [], '1ª foto não gera evento')
  const a = E.diffAds(new Map([['MLB1', 'idle'], ['MLB2', 'active'], ['MLB3', 'active'], ['MLB4', 'hold'], ['MLB5', 'active']]), new Map([['MLB1', 'active'], ['MLB2', 'paused'], ['MLB3', 'active'], ['MLB4', 'idle'], ['MLB6', 'active'], ['MLB7', 'idle']]))
  assert.deepEqual(a.map(e => [e.item_id, e.de, e.para]), [['MLB1', 'idle', 'active'], ['MLB2', 'active', 'paused'], ['MLB6', 'sem_anuncio', 'active'], ['MLB5', 'active', 'sem_anuncio']], 'idle↔hold não gera; sumir só conta se estava ativo')
  assert.equal(E.cruzaFronteira({ campo: 'promocao', de: 'nenhuma', para: 'SMART −10%' }), true); assert.equal(E.cruzaFronteira({ campo: 'promocao', de: 'SMART −10%', para: 'DEAL −5%' }), false)
  assert.equal(E.cruzaFronteira({ campo: 'ads', de: 'idle', para: 'active' }), true); assert.equal(E.cruzaFronteira({ campo: 'estoque_zero', de: '3', para: '0' }), true)
  assert.equal(E.cruzaFronteira({ campo: 'logistica', de: 'xd_drop_off', para: 'fulfillment' }), true); assert.equal(E.cruzaFronteira({ campo: 'logistica', de: 'xd_drop_off', para: 'drop_off' }), false)
  assert.equal(E.cruzaFronteira({ campo: 'status', de: 'active', para: 'paused' }), true); assert.equal(E.cruzaFronteira({ campo: 'status', de: 'paused', para: 'closed' }), false)
  assert.equal(E.cruzaFronteira({ campo: 'preco', de: '1', para: '2' }), false)
  const evs = [{ dia: '2026-09-10', campo: 'promocao', de: 'nenhuma', para: 'SMART −10%' }, { dia: '2026-09-25', campo: 'promocao', de: 'SMART −10%', para: 'nenhuma' }, { dia: '2026-09-20', campo: 'ads', de: 'idle', para: 'active' }]
  assert.equal(E.estadoEm(evs, 'promocao', '2026-09-05', 'nenhuma', '2026-09-01'), 'nenhuma'); assert.equal(E.estadoEm(evs, 'promocao', '2026-09-15', 'nenhuma', '2026-09-01'), 'SMART −10%')
  assert.equal(E.estadoEm(evs, 'promocao', '2026-09-25', 'nenhuma', '2026-09-01'), 'nenhuma', 'no dia do evento já vale o "para"'); assert.equal(E.estadoEm(evs, 'promocao', '2026-10-01', 'nenhuma', '2026-09-01'), 'nenhuma')
  assert.equal(E.estadoEm(evs, 'ads', '2026-09-15', 'active', '2026-09-01'), 'idle'); assert.equal(E.estadoEm(evs, 'ads', '2026-08-15', 'active', '2026-09-01'), null, 'antes do início do histórico: —')
  assert.equal(E.estadoEm([], 'ads', '2026-09-15', 'active', null), 'active', 'sem evento e sem início: vale o atual')
  assert.equal(E.ROTULO_ADS.hold, 'retido pelo ML')
})

ok('Ads: gravarAdsItem no período atual registra ligou/desligou (fonte ads) na MESMA transação; 1ª foto e período anterior não geram; eventosAnuncio aceita os campos novos', () => {
  const cli = 'Ads', item = (id, status) => ({ item_id: id, status, metrics: { cost: 1 } })
  S.gravarAdsItem(cli, 'atual', '2026-09-08', '2026-10-05', [item('MLB1', 'active'), item('MLB2', 'idle')], { dia: '2026-10-06' })
  assert.deepEqual(db.prepare("SELECT campo FROM meli_item_mudanca WHERE cliente = ?").all(cli), [], '1ª foto não gera evento')
  S.gravarAdsItem(cli, 'anterior', '2026-08-11', '2026-09-07', [item('MLB1', 'paused')], { dia: '2026-10-06' })
  assert.deepEqual(db.prepare("SELECT campo FROM meli_item_mudanca WHERE cliente = ?").all(cli), [], 'período anterior é só foto')
  S.gravarAdsItem(cli, 'atual', '2026-09-09', '2026-10-06', [item('MLB1', 'paused'), item('MLB2', 'hold'), item('MLB3', 'active')], { dia: '2026-10-07' })
  assert.deepEqual(muds(cli, 'MLB1').map(m => [m.dia, m.campo, m.de, m.para, m.fonte]), [['2026-10-07', 'ads', 'active', 'paused', 'ads']])
  assert.deepEqual(muds(cli, 'MLB2'), [], 'idle → hold não é evento'); assert.deepEqual(muds(cli, 'MLB3').map(m => [m.de, m.para]), [['sem_anuncio', 'active']])
  assert.equal(db.prepare("SELECT status FROM meli_ads_item WHERE cliente = ? AND item_id = 'MLB1' AND periodo = 'atual'").get(cli).status, 'paused')
  S.gravarAdsItem(cli, 'atual', '2026-09-09', '2026-10-06', [item('MLB1', 'active'), item('MLB2', 'hold'), item('MLB3', 'active')], { dia: '2026-10-07' })
  assert.deepEqual(muds(cli, 'MLB1'), [], 'mesmo dia, foi e voltou: sem linha (regra do dia repetido)')
  const ev = H.historico.eventosAnuncio(cli, { campos: ['ads', 'promocao', "x') --"] })
  assert.deepEqual([...ev.keys()], ['MLB3']); assert.deepEqual(ev.get('MLB3')[0], { dia: '2026-10-07', campo: 'ads', de: 'sem_anuncio', para: 'active', pct: null, fonte: 'ads' })
  assert.equal(H.historico.eventosAnuncio(cli, { campos: ['preco'] }).size, 0)
})

ok('anunciosDoCliente: visitas e conversão são null (—) sem cobertura de visitas (vis_de vazio ou depois do início do período), nunca 0; totais só somam os cobertos', () => {
  const cli = 'Vis', hoje = '2026-10-07'
  const ins = db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, preco, status, estoque, vis_de, vis_ate, atualizado_em) VALUES (?,?,?,?,?,?,?,?,'x')")
  // período = últimos 90 dias (10/07–07/10), anterior = 11/04–09/07: MLB1 coberto nos dois; MLB3 só a partir de 01/09 (nenhuma das janelas inteira)
  ins.run(cli, 'MLB1', 'Coberto', 10, 'active', 1, '2026-04-01', hoje); ins.run(cli, 'MLB2', 'Sem visitas', 10, 'active', 1, '', ''); ins.run(cli, 'MLB3', 'Cobertura recente', 10, 'active', 1, '2026-09-01', hoje)
  const serie = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita, visitas) VALUES (?,?,?,?,?,?)')
  for (const id of ['MLB1', 'MLB2', 'MLB3']) { serie.run(cli, id, '2026-09-20', 2, 20, 100); serie.run(cli, id, '2026-06-20', 1, 10, 50) }
  db.prepare("INSERT INTO meli_coleta_dia (cliente, dia, pedidos, truncado, coletado_em) VALUES (?,?,1,0,'x')").run(cli, '2026-09-20')
  const def = validarFiltro({ painel: 'cliente', periodo: { campo: 'data_venda', preset: 'ultimos_90_dias', comparar: 'anterior' } }, { hoje })
  const r = anunciosDoCliente(cli, def), por = Object.fromEntries(r.itens.map(i => [i.anuncio_id, i]))
  assert.equal(por.MLB1.visitas, 100); assert.equal(por.MLB1.conversao, 2)
  assert.equal(por.MLB2.visitas, null); assert.equal(por.MLB2.conversao, null); assert.equal(por.MLB2.vendas_unidades, 2, 'as vendas continuam')
  assert.equal(por.MLB3.visitas, null, 'vis_de 01/09 é depois do início do período (09/07): a janela não está coberta'); assert.equal(por.MLB3.anterior.visitas, null)
  assert.equal(por.MLB1.anterior.visitas, 50)
  assert.deepEqual([r.totais.visitas, r.totais.anuncios_com_visitas, r.totais.anuncios, r.totais.conversao], [100, 1, 3, 2])
})

ok('troca/desconexão de conta: TABELAS_SERIE limpa o histórico (e a limpeza de promoções limpa custo_vinculo) só do cliente', () => {
  assert.ok(C.TABELAS_SERIE.includes('meli_item_mudanca'))
  db.prepare("INSERT INTO custo_vinculo (cliente, item_id, sku_custo, origem, por, em) VALUES ('A','MLB1','PEITORAL P','manual','teste','x'), ('B','MLB2','X','recusado','teste','x')").run()
  const antesB = db.prepare("SELECT COUNT(*) n FROM meli_item_mudanca WHERE cliente = 'B'").get().n
  assert.ok(db.prepare("SELECT COUNT(*) n FROM meli_item_mudanca WHERE cliente = 'A'").get().n > 0 && antesB > 0)
  C.limparSerieDoCliente('A', 'teste')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meli_item_mudanca WHERE cliente = 'A'").get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM custo_vinculo WHERE cliente = 'A'").get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meli_item_mudanca WHERE cliente = 'B'").get().n, antesB, 'outro cliente intocado')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM custo_vinculo WHERE cliente = 'B'").get().n, 1)
  assert.match(readFileSync(new URL('../src/lib/acomp-schema.js', import.meta.url), 'utf8'), /CREATE TABLE IF NOT EXISTS meli_item_mudanca/, 'DDL no SCHEMA_ACOMP (o mesmo do banco real)')
})

ok('dimensões: normalizarNicho (sem acento/caixa, mapa curado, vazio/Multinicho → sem nicho, fora do mapa = próprio nome)', () => {
  assert.equal(D.normalizarNicho('Cosmeticos'), 'Cosméticos'); assert.equal(D.normalizarNicho('COSMÉTICO'), 'Cosméticos')
  assert.equal(D.normalizarNicho('  moda   feminina '), 'Moda'); assert.equal(D.normalizarNicho('Vestuário'), 'Moda'); assert.equal(D.normalizarNicho('Confecção'), 'Moda')
  assert.equal(D.normalizarNicho('Pet Shop'), 'Pet'); assert.equal(D.normalizarNicho('informática'), 'Informática')
  for (const v of ['', null, undefined, 'Não informado', 'nao informado', 'Multinicho']) assert.equal(D.normalizarNicho(v), D.SEM_NICHO, String(v))
  assert.equal(D.normalizarNicho(' Sexshop '), 'Sexshop')
  const cfg = JSON.parse(readFileSync(new URL('../config/nichos.json', import.meta.url), 'utf8'))
  for (const canon of Object.keys(cfg.nichos)) assert.equal(D.normalizarNicho(canon), canon, `canônico estável: ${canon}`)
  db.prepare("INSERT INTO clientes_central (cliente, nicho, atualizado_em) VALUES ('União Dog', 'Pet Shop', 'x'), ('Sem', '', 'x')").run()
  assert.equal(D.nichoDe('União Dog'), 'Pet'); assert.equal(D.nichoDe('Sem'), D.SEM_NICHO); assert.equal(D.nichoDe('inexistente'), D.SEM_NICHO)
})

ok('dimensões: regiaoDe cobre as 27 UFs; ufDoPerfil só aceita address.state válido; salvarConexao grava a UF sem herdar de outra conta', () => {
  assert.equal(D.UFS.length, 27)
  const porRegiao = {}; for (const uf of D.UFS) porRegiao[D.regiaoDe(uf)] = (porRegiao[D.regiaoDe(uf)] || 0) + 1
  assert.deepEqual(porRegiao, { Norte: 7, Nordeste: 9, 'Centro-Oeste': 4, Sudeste: 4, Sul: 3 })
  assert.equal(D.regiaoDe('sp'), 'Sudeste'); assert.equal(D.regiaoDe('DF'), 'Centro-Oeste'); assert.equal(D.regiaoDe(''), D.SEM_UF); assert.equal(D.regiaoDe('XX'), D.SEM_UF)
  assert.equal(D.ufDoPerfil({ address: { state: 'BR-SP' } }), 'SP'); assert.equal(D.ufDoPerfil({ address: { state: 'rj' } }), 'RJ')
  for (const p of [{}, null, { address: { state: 'BR-XX' } }, { address: { state: 'São Paulo' } }]) assert.equal(D.ufDoPerfil(p), '')
  const tok = uid => ({ user_id: uid, access_token: 'a', refresh_token: 'r', expires_in: 21600, scope: '' })
  C.salvarConexao('Loja UF', tok(1), { nickname: 'L', address: { state: 'BR-PR' } })
  assert.equal(D.ufDe('Loja UF'), 'PR')
  C.salvarConexao('Loja UF', tok(1), { nickname: '' })                                          // reconexão da MESMA conta com perfil sem endereço: mantém
  assert.equal(D.ufDe('Loja UF'), 'PR')
  C.salvarConexao('Loja UF', tok(2), { nickname: '' })                                          // OUTRA conta sem endereço: não herda a UF da antiga
  assert.equal(D.ufDe('Loja UF'), D.SEM_UF)
  assert.equal(D.ufDe('nunca conectou'), D.SEM_UF)
})

ok('resumoPrecos28d (causalidade da conta): aumento líquido ≥ limiar, fatia da receita anterior, variação dos SEM mudança; sem histórico = null', () => {
  const K = 'RP', ins = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?,?,?,?,?)')
  const mud = db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,'preco',?,?,?,?,'x')")
  assert.equal(H.historico.resumoPrecos28d(K, { ate: '2026-10-04' }), null, 'nenhum histórico: sem dado, não "sem mudança"')
  // anterior (06/08–06/09) × atual (07/09–04/10): MLB1 subiu 50 → 55 e caiu; MLB2 fez promoção e voltou (líquido 0); MLB3 sem mudança, estável
  for (const [i, r0, r] of [['MLB1', 3000, 1500], ['MLB2', 1000, 1000], ['MLB3', 6000, 5700]]) { ins.run(K, i, '2026-08-20', 1, r0); ins.run(K, i, '2026-09-20', 1, r) }
  mud.run(K, 'MLB1', '2026-09-15', '50', '55', 10, 'coleta'); mud.run(K, 'MLB2', '2026-09-10', '20', '18', -10, 'promo'); mud.run(K, 'MLB2', '2026-09-25', '18', '20', 11.11, 'promo')
  mud.run(K, 'MLB3', '2026-08-01', '10', '11', 10, 'coleta')     // fora da janela: não conta
  const r = H.historico.resumoPrecos28d(K, { ate: '2026-10-04', limiar: 3 })
  assert.deepEqual(r.aumentos.map(a => [a.item_id, a.pct, a.dia, a.share_pct]), [['MLB1', 10, '2026-09-15', 30]])
  assert.equal(r.share_aumentos_pct, 30); assert.equal(r.n_mudaram, 2); assert.equal(r.var_sem_mudanca_pct, -5); assert.equal(r.desde, '2026-08-01'); assert.equal(r.completo, true)
  assert.equal(r.var_aumentos_pct, -50, 'os que subiram caíram 50% (o 2º falsificador da causalidade lê isto)')
})

console.log(`\n${n} casos ✔`)
