// Autoteste do cadastro do cliente (planilha do CS → clientes_central; edição manual com prévia/confirmar; rotas HTTP). Sem rede, sem banco real
// (db.js em memória), sem python: a planilha entra como abas já lidas. Rodar: node scripts/teste-cadastro-clientes.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
import assert from 'node:assert/strict'
import express from 'express'
import { readFileSync } from 'node:fs'
const { db } = await import('../src/lib/db.js')
const C = await import('../src/lib/cadastro-clientes.js')
const { criarRotasCadastro } = await import('../src/rotas-cadastro.js')
const { sincronizarEquipe } = await import('../src/lib/equipe.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = async (fn, rx, status) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); if (rx) assert.match(e.message, rx); if (status) assert.equal(e.status, status) }
const LIDER = 'Líder Teste', SEGREDO = 'SEGREDO_NAO_ECOAR'

// central de mentira (o sync real vem do Notion): os 12 pares do David + vizinhos que forçam ambiguidade
const CENTRAL = ['Rotec', 'MA Filho e Maluf', 'Shopt30villa', 'Brupes (Criativa Decor)', 'Photo K', 'Olimpo Editora', 'Edwora Hub (União Dog)', 'Uniformes Brasil Confecções ltda',
  'HT Imports (Helder Morcatti)', 'Jula Textil', 'BLISS Comercio de Produtos', 'JBM Textil', 'Ceju', 'Avion Sports', 'Cejuvan Modas', 'Nort Sports', 'Agrinorte', 'Casa Azul', 'Casa Verde', 'Teste IA']
const ins = db.prepare("INSERT INTO clientes_central (cliente, status_cs, tier, canais_json, consultores_json, lideres_json, atualizado_em) VALUES (?, 'Ativo', 'Plano', '[\"ML\"]', '{}', ?, 'x')")
for (const c of CENTRAL) ins.run(c, c === 'Rotec' ? JSON.stringify({ ML: LIDER }) : '{}')
const aliases = C.lerAliases()

// ═════════ 1. normalização e casamento ═══════════════════════════════════════════════════════════════
await caso('normalizar: NFKD, sem acento/pontuação, caixa baixa, espaços colapsados', () => {
  assert.equal(C.normalizar('  Jula Têxtil LTDA. '), 'jula textil ltda')
  assert.equal(C.normalizar("D'calice | Brás & Cia"), 'd calice bras cia')
  assert.equal(C.normalizar(null), '')
})
await caso('casar: os 12 pares do David casam (exato → alias → contenção) com o nome exato da central', () => {
  const PARES = [['Adriano Teixeira I Rotec', 'Rotec'], ['M A Filho', 'MA Filho e Maluf'], ['SHOPT30', 'Shopt30villa'], ['Brupes Decor', 'Brupes (Criativa Decor)'], ['Photok', 'Photo K'],
    ['Olimpo', 'Olimpo Editora'], ['União Dog', 'Edwora Hub (União Dog)'], ['Uniformes Brasil', 'Uniformes Brasil Confecções ltda'], ['HT Imports', 'HT Imports (Helder Morcatti)'],
    ['Jula Têxtil', 'Jula Textil'], ['Bliss Assessoria', 'BLISS Comercio de Produtos'], ['JBM', 'JBM Textil']]
  for (const [p, c] of PARES) assert.equal(C.casar(p, CENTRAL, aliases)?.cliente, c, p)
  assert.equal(C.casar('rotec', CENTRAL, aliases).via, 'exato'); assert.equal(C.casar('Photok', CENTRAL, aliases).via, 'alias'); assert.equal(C.casar('Jula Textil LTDA', CENTRAL, aliases).via, 'contem')
})
await caso('casar: contenção só por palavra inteira com ≥ 4 caracteres e candidato único; ambíguo e não achado nunca casam', () => {
  assert.equal(C.casar('Ceju', CENTRAL).cliente, 'Ceju', 'exato vence mesmo com vizinho')
  assert.equal(C.casar('Ceju Comercio', CENTRAL).cliente, 'Ceju', '"ceju" é palavra inteira só em Ceju (não em Cejuvan)')
  assert.equal(C.casar('Nort', CENTRAL).cliente, 'Nort Sports', '"nort" é palavra inteira só em Nort Sports (em Agrinorte é pedaço)')
  assert.equal(C.casar('Agri', CENTRAL), null, '"agri" tem 4 letras mas é só prefixo de Agrinorte, não palavra inteira')
  assert.equal(C.casar('JBM', CENTRAL), null, '3 caracteres sem alias não casa')
  assert.deepEqual(C.casar('Casa', CENTRAL).ambiguo.sort(), ['Casa Azul', 'Casa Verde'])
  assert.equal(C.casar('Loja Inexistente', CENTRAL), null)
  assert.equal(C.casar('', CENTRAL), null)
})

// ═════════ 2. interpretação e consolidação da planilha ═══════════════════════════════════════════════
const ABAS = {
  'Lista Clientes': [['CLIENTE', 'CANAL', 'CS RESPONSÁVEL', 'HEALTH SCORE', 'CLASSIFICAÇÃO', '', ''],
    ['Adriano Teixeira I Rotec', 'Mercado Livre', 'Rayssa Freitas', 73.2, 'Saudável', '', ''], ['Adriano Teixeira I Rotec', 'Shopee', 'Rayssa Freitas', 75, 'Saudável', '', ''],
    ['Jula Textil LTDA', 'Shopee', 'Rayssa Freitas', 80.6, 'Saudável', '', ''], ['Jula Textil LTDA', 'Mercado Livre', 'Rayssa Freitas', 41, 'Risco', '', ''],
    ['Avion Sports', 'Shopee', 'Agatha Barros', '—', 'Sem HS', '', ''], ['Photok', 'SHEIN', 'Agatha Barros', 0, 'Dados insuficientes', '', ''],
    ['Casa', 'Shopee', 'Agatha Barros', 50, 'Atenção', '', ''], ['Lojas Wolf', 'Amazon, Shopee', '—', '—', 'Sem HS', '', ''], ['Olimpo Comércio e Editora de Livros LTDA', 'Amazon', 'Agatha Barros', '—', 'Sem HS', '', '']],
  'Relatórios': [['Cliente', 'Canal', 'Frequencia', 'HS'], ['Rotec', 'Mercado Livre', 'Semanal', 67], ['Olimpo', 'Amazon', 'Semanal', 70], ['JDS Kids', 'TikTok', 'Semanal', 61]],
}
await caso('interpretar + consolidar: linhas por canal viram 1 cliente; "—" = null (nunca 0); 0 de verdade fica 0; HS = média, classificação = mais grave', () => {
  const itens = C.interpretar(ABAS), por = Object.fromEntries(itens.map(e => [e.nome, e]))
  assert.deepEqual(C.consolidar(por['Adriano Teixeira I Rotec']), { cs_responsavel: 'Rayssa Freitas', health_score: 74.1, hs_classificacao: 'Saudável', canais_cs: [{ canal: 'Mercado Livre', cs: 'Rayssa Freitas', hs: 73.2, classificacao: 'Saudável' }, { canal: 'Shopee', cs: 'Rayssa Freitas', hs: 75, classificacao: 'Saudável' }] })
  assert.equal(C.consolidar(por['Jula Textil LTDA']).hs_classificacao, 'Risco')
  const av = C.consolidar(por['Avion Sports']); assert.equal(av.health_score, null); assert.equal(av.hs_classificacao, 'Sem HS'); assert.equal(av.canais_cs[0].hs, null)
  assert.equal(C.consolidar(por['Photok']).health_score, 0, 'zero real é zero')
  assert.equal(C.consolidar(por['Lojas Wolf']).cs_responsavel, '', '"—" no CS = vazio')
  assert.deepEqual(por['Rotec'].relatorio, { canais: 'Mercado Livre', frequencia: 'Semanal', hs: 67 }); assert.equal(por['Rotec'].canais.length, 0)
})

// ═════════ 3. importação: prévia não grava; confirmar grava; pendências ═══════════════════════════════
await caso('importarPlanilha: prévia não grava nada; confirmar:true grava, Relatórios só informa, pendências (não achado/ambíguo) ficam guardadas', () => {
  const pv = C.importarPlanilha('/nao/existe.xlsx', { abas: ABAS, hoje: '2026-10-09' })
  assert.equal(pv.aplicado, false); assert.equal(pv.casados, 5); assert.equal(pv.pendencias, 3)
  assert.deepEqual(pv.lista_pendencias.map(p => [p.nome, p.motivo]), [['Casa', 'ambiguo'], ['Lojas Wolf', 'nao_encontrado'], ['JDS Kids', 'nao_encontrado']])
  assert.deepEqual(pv.lista_pendencias[0].candidatos.sort(), ['Casa Azul', 'Casa Verde'])
  assert.equal(db.prepare("SELECT cadastro_fonte f FROM clientes_central WHERE cliente = 'Rotec'").get().f, '', 'prévia não gravou')
  const rot = pv.itens.find(x => x.cliente === 'Rotec'); assert.equal(rot.nome, 'Adriano Teixeira I Rotec'); assert.deepEqual(rot.relatorio, { canais: 'Mercado Livre', frequencia: 'Semanal', hs: 67 }, 'a linha "Rotec" de Relatórios se junta ao cliente já casado pela Lista')
  assert.equal(rot.mudancas.health_score.para, 74.1)
  const ap = C.importarPlanilha('/nao/existe.xlsx', { abas: ABAS, confirmar: true, hoje: '2026-10-09' })
  assert.equal(ap.aplicado, true); assert.equal(ap.mudam, 5)
  const r = db.prepare("SELECT * FROM clientes_central WHERE cliente = 'Rotec'").get()
  assert.equal(r.health_score, 74.1); assert.equal(r.cs_responsavel, 'Rayssa Freitas'); assert.equal(r.hs_em, '2026-10-09'); assert.equal(r.cadastro_fonte, 'planilha 2026-10-09'); assert.equal(JSON.parse(r.canais_cs_json).length, 2)
  assert.equal(db.prepare("SELECT health_score h FROM clientes_central WHERE cliente = 'Avion Sports'").get().h, null, '"—" vira NULL no banco')
  assert.equal(db.prepare("SELECT health_score h FROM clientes_central WHERE cliente = 'Olimpo Editora'").get().h, null)
  assert.equal(db.prepare("SELECT cadastro_fonte f FROM clientes_central WHERE cliente = 'Casa Azul'").get().f, '', 'ambíguo não grava em ninguém')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes_central').get().n, CENTRAL.length, 'nunca cria cliente')
  assert.equal(C.pendenciasImportacao().pendencias.length, 3); assert.equal(C.pendenciasImportacao().fonte, 'planilha 2026-10-09')
  const de_novo = C.importarPlanilha('/nao/existe.xlsx', { abas: ABAS, hoje: '2026-10-09' }); assert.equal(de_novo.mudam, 0, 'reimportar a mesma planilha = sem mudança (idempotente)')
})

// ═════════ 4. o sync da central NÃO zera os campos novos ═════════════════════════════════════════════
await caso('sincronizarEquipe: o UPSERT dele (extraído do fonte) só toca as colunas do Notion; a poda só apaga quem saiu da central', async () => {
  const fonte = readFileSync(new URL('../src/lib/equipe.js', import.meta.url), 'utf8')
  const sql = fonte.match(/INSERT INTO clientes_central[\s\S]*?atualizado_em=excluded\.atualizado_em/)[0]
  for (const col of ['cs_responsavel', 'health_score', 'hs_classificacao', 'hs_em', 'canais_cs_json', 'cadastro_fonte', 'observacoes']) assert.ok(!sql.includes(col), col + ' não pode estar no UPSERT do sync')
  db.prepare(sql).run('Rotec', 'Ativo', 'Place Prime', 'Peças', '["ML","SHO"]', '{"ML":"Alguém"}', JSON.stringify({ ML: LIDER }), '', '', '', '{}', '2026-10-09T00:00:00.000Z')
  const r = db.prepare("SELECT * FROM clientes_central WHERE cliente = 'Rotec'").get()
  assert.equal(r.tier, 'Place Prime', 'o sync atualizou o que é dele'); assert.equal(r.health_score, 74.1); assert.equal(r.cs_responsavel, 'Rayssa Freitas'); assert.equal(r.cadastro_fonte, 'planilha 2026-10-09')
  assert.equal(typeof sincronizarEquipe, 'function')
})

// ═════════ 5. edição manual: prévia/confirmar estrito, por validado, lista fechada, sem eco ═══════════
await caso('salvarCadastro: prévia por padrão; confirmar "true" (string) não grava; true grava com hs_em e fonte manual; por inválido = 403 sem eco', () => {
  const base = { cliente: 'Ceju', por: LIDER, campos: { cs_responsavel: 'Agatha Barros', health_score: 61.26, hs_classificacao: 'Atenção', observacoes: 'cliente pediu reunião', canais_cs: ['Shopee', 'TikTok'] } }
  const pv = C.salvarCadastro(base); assert.equal(pv.previa, true); assert.equal(pv.n, 5); assert.equal(pv.mudancas.health_score.para, 61.3)
  assert.equal(db.prepare("SELECT cs_responsavel c FROM clientes_central WHERE cliente = 'Ceju'").get().c, '')
  assert.equal(C.salvarCadastro({ ...base, confirmar: 'true' }).previa, true); assert.equal(db.prepare("SELECT cs_responsavel c FROM clientes_central WHERE cliente = 'Ceju'").get().c, '', '"true" string não grava')
  const ok = C.salvarCadastro({ ...base, confirmar: true }); assert.equal(ok.previa, false); assert.equal(ok.gravado_por, LIDER)
  const r = db.prepare("SELECT * FROM clientes_central WHERE cliente = 'Ceju'").get()
  assert.equal(r.health_score, 61.3); assert.equal(r.hs_classificacao, 'Atenção'); assert.equal(r.observacoes, 'cliente pediu reunião'); assert.match(r.cadastro_fonte, /^manual \d{4}-\d{2}-\d{2}$/); assert.match(r.hs_em, /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(JSON.parse(r.canais_cs_json), [{ canal: 'Shopee' }, { canal: 'TikTok' }])
  // só observações: hs_em não muda
  const em = r.hs_em
  C.salvarCadastro({ cliente: 'Ceju', por: LIDER, campos: { observacoes: 'x' }, confirmar: true }); assert.equal(db.prepare("SELECT hs_em e FROM clientes_central WHERE cliente = 'Ceju'").get().e, em)
  // '—' e '' viram null; 0 fica 0
  C.salvarCadastro({ cliente: 'Ceju', por: LIDER, campos: { health_score: '—' }, confirmar: true }); assert.equal(db.prepare("SELECT health_score h FROM clientes_central WHERE cliente = 'Ceju'").get().h, null)
  C.salvarCadastro({ cliente: 'Ceju', por: LIDER, campos: { health_score: 0 }, confirmar: true }); assert.equal(db.prepare("SELECT health_score h FROM clientes_central WHERE cliente = 'Ceju'").get().h, 0)
  assert.equal(C.salvarCadastro({ cliente: 'Ceju', por: LIDER, campos: { health_score: 0 } }).n, 0, 'sem mudança = n 0')
  // erros
  falha(() => C.salvarCadastro({ ...base, por: SEGREDO }), /líderes e consultores/, 403)
  falha(() => C.salvarCadastro({ ...base, campos: { [SEGREDO]: 1 } }), /fora da lista/)
  falha(() => C.salvarCadastro({ ...base, campos: { health_score: SEGREDO } }), /health_score/); falha(() => C.salvarCadastro({ ...base, campos: { health_score: 101 } }))
  falha(() => C.salvarCadastro({ ...base, campos: { hs_classificacao: SEGREDO } }), /fora da lista/)
  falha(() => C.salvarCadastro({ ...base, campos: { canais_cs: SEGREDO } })); falha(() => C.salvarCadastro({ ...base, campos: { cs_responsavel: { a: 1 } } }))
  falha(() => C.salvarCadastro({ ...base, cliente: 'Loja Inexistente' }), /não encontrado/, 404); falha(() => C.salvarCadastro({ ...base, por: '' }), /"por"/)
  try { C.salvarCadastro({ ...base, por: SEGREDO }) } catch (e) { assert.ok(!e.message.includes(SEGREDO), 'sem eco') }
  try { C.salvarCadastro({ ...base, campos: { [SEGREDO]: 1 } }) } catch (e) { assert.ok(!e.message.includes(SEGREDO), 'sem eco') }
  falha(() => C.lerCadastro('Loja Inexistente'), /não encontrado/, 404)
  const lido = C.lerCadastro('Rotec'); assert.deepEqual(Object.keys(lido).sort(), ['cadastro', 'central', 'classificacoes', 'cliente', 'relatorio']); assert.equal(lido.relatorio, null); assert.equal(lido.central.tier, 'Place Prime')
})

// ═════════ 6. rotas HTTP ═════════════════════════════════════════════════════════════════════════════
await caso('rotas: GET contrato, 400/404 sem eco, 415 sem JSON, 403 por inválido, prévia por padrão, confirmar estrito, pendências', async () => {
  const app = express(); app.use(express.json())
  app.use(criarRotasCadastro({ cadastro: C, quem: () => [LIDER], clienteCanonico: nome => CENTRAL.find(c => c.toLowerCase() === String(nome).toLowerCase()) || '' }))
  app.use((e, req, res, next) => res.status(500).json({ erro: 'erro interno' }))
  const srv = await new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const req = (m, p, corpo, tipo = 'application/json') => fetch(base + p, { method: m, headers: tipo ? { 'Content-Type': tipo } : {}, body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }))
  try {
    const g = await req('GET', '/api/cliente/cadastro?cliente=rotec')
    assert.equal(g.status, 200); assert.equal(g.json.cliente, 'Rotec'); assert.deepEqual(g.json.quem, [LIDER]); assert.equal(g.json.cadastro.health_score, 74.1); assert.deepEqual(g.json.classificacoes, C.CLASSIFICACOES)
    assert.equal((await req('GET', '/api/cliente/cadastro')).status, 400)
    for (const p of ['[Comercial] Loja X', 'Loja Inexistente']) { const r = await req('GET', `/api/cliente/cadastro?cliente=${encodeURIComponent(p)}`); assert.equal(r.status, 404); assert.ok(!JSON.stringify(r.json).includes('Loja')) }
    assert.equal((await req('POST', '/api/cliente/cadastro', 'x=1', 'application/x-www-form-urlencoded')).status, 415)
    const forjado = await req('POST', '/api/cliente/cadastro', { cliente: 'Ceju', por: SEGREDO, campos: { observacoes: 'a' }, confirmar: true }); assert.equal(forjado.status, 403); assert.ok(!JSON.stringify(forjado.json).includes(SEGREDO))
    const extra = await req('POST', '/api/cliente/cadastro', { cliente: 'Ceju', por: LIDER, campos: { [SEGREDO]: 1 } }); assert.equal(extra.status, 400); assert.ok(!JSON.stringify(extra.json).includes(SEGREDO))
    assert.equal((await req('POST', '/api/cliente/cadastro', { cliente: 'Ceju', por: { toString: 'x' }, campos: {} })).status, 400)
    const pv = await req('POST', '/api/cliente/cadastro', { cliente: 'Ceju', por: LIDER, campos: { observacoes: 'via rota' } }); assert.equal(pv.status, 200); assert.equal(pv.json.previa, true)
    assert.equal((await req('POST', '/api/cliente/cadastro', { cliente: 'Ceju', por: LIDER, campos: { observacoes: 'via rota' }, confirmar: 'true' })).json.previa, true)
    assert.equal(db.prepare("SELECT observacoes o FROM clientes_central WHERE cliente = 'Ceju'").get().o, 'x', 'nada gravado')
    const ok = await req('POST', '/api/cliente/cadastro', { cliente: 'Ceju', por: LIDER, campos: { observacoes: 'via rota' }, confirmar: true }); assert.equal(ok.json.previa, false); assert.equal(ok.json.cadastro.observacoes, 'via rota')
    const pend = await req('GET', '/api/cadastro/pendencias'); assert.equal(pend.status, 200); assert.equal(pend.json.pendencias.length, 3)
  } finally { srv.close() }
})

console.log(`\n${n} casos OK`)
