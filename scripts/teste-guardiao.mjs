// Autoteste do Agente Smith G0 (src/lib/guardiao.js puro + guardiao-real.js + src/rotas-guardiao.js). Banco EM MEMÓRIA (PS_DB_MEMORIA=1), nunca data/db.sqlite; nenhuma chamada ao ML.
// Raio-X sem custo = sem lucro; «decisão do cliente» muda a atribuição sem apagar a medição; pauta passa no auditor (sem nome de analista, sem culpa, 3 decisões A/B com o que medir);
// atas → compromissos e preços; lojas do mesmo dono; isolamento por cliente; rotas (prévia por padrão, 415, 403, 404 sem eco).
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
const { db } = await import('../src/lib/db.js')
if (db.name !== ':memory:') throw new Error('o teste só roda em memória')
const G = await import('../src/lib/guardiao.js')
const { dadosGuardiao, raioXDoCliente, pautaDoCliente, criarGuardiao } = await import('../src/lib/guardiao-real.js')
const { criarRotasGuardiao } = await import('../src/rotas-guardiao.js')
const { criarLivro } = await import('../src/lib/livro-registro.js')

let n = 0
const ok = async (nome, fn) => { await fn(); n++; console.log('✔', nome) }
const HOJE = '2026-10-15', AGORA = '2026-10-15T12:00:00.000Z'

// ── semente: Loja A (Shopee, sem integração, 2 contas) e Loja B (Mercado Livre conectado) ──
const cc = db.prepare('INSERT INTO clientes_central (cliente, status_cs, canais_json, vencimentos_json, health_score, hs_classificacao, atualizado_em, canais_cs_json) VALUES (?,?,?,?,?,?,?,?)')
cc.run('Loja A', 'Ativo', '["SHO"]', '{"SHO":"2026-10-17"}', 15.5, 'Dados insuficientes', AGORA, '[{"canal":"Shopee","cs":"X","hs":15.5}]')
cc.run('Loja B', 'Ativo', '["ML"]', '{}', 70, 'Atenção', AGORA, '[]')
const tar = db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, processo, responsavel, status, tipo_demanda, data_conclusao, descricao, conteudo, last_edited) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
const ATA = `Resumo da reunião
Ajuste de preços: foi identificado que será necessário subir o preço dos tapetes para melhorar a margem e evitar operação no negativo.
Definição de aumento: ficou alinhado que o reajuste será de R$ 5,20 nos tapetes unitários.
Mantas sem reajuste por enquanto: as mantas não precisarão de alteração imediata.
Envio de relação de produtos: Loja A se comprometeu a enviar durante a semana uma relação atualizada do que tem em estoque.
Planejamento de investimento mensal: ficou combinado que, na próxima reunião, será definido um valor fixo mensal de investimento em anúncios.
Retorno: o especialista Fulano vai verificar a questão do aplicativo novo depois.`
tar.run('ata1', 'f', 'Loja A', 'Reunião de Alinhamento Setembro', 'Shopee', 'Fulano Analista', 'concluida', 'Reunião de Alinhamento', '2026-09-15', 'Reunião', ATA, AGORA)
tar.run('preco1', 'f', 'Loja A', 'Ajustes Preços Tapete', 'Shopee 1 e 2', 'Fulano Analista', 'concluida', 'Atualizar Preços', '2026-09-15', 'Aumentar 5,20 nos anuncios unitários', '', AGORA)
tar.run('preco0', 'f', 'Loja A', 'Ajuste de valores', 'Shopee', 'Fulano Analista', 'concluida', 'Corrigir Preços', '2026-07-31', 'Ajuste de valores', 'Tambaba 49,99\nManta king 48,80', AGORA)
tar.run('velha', 'f', 'Loja A', 'Ajuste antigo de preço', 'Shopee', 'Fulano Analista', 'concluida', 'Atualizar Preços', '2026-05-01', 'subir 10,00', '', AGORA)   // fora dos 90 d
for (let k = 0; k < 3; k++) tar.run(`s1-${k}`, 'f', 'Loja A', `Tarefa ${k}`, 'Shopee 1', 'Fulano Analista', 'concluida', 'Cadastro', '2026-09-0' + (k + 1), '', '', AGORA)
for (let k = 0; k < 2; k++) tar.run(`s2-${k}`, 'f', 'Loja A', `Tarefa B${k}`, 'Shopee 2', 'Fulano Analista', 'nao_iniciada', 'Cadastro', null, '', '', AGORA)
tar.run('dep', 'f', 'Loja A', 'Duplicar anúncio kit', 'Shopee 2', 'Fulano Analista', 'dependencia_cliente', 'Duplicação', null, '', '', '2026-09-25T18:10:00.000Z')
db.prepare(`INSERT INTO meli_contas (cliente, nickname, access_token, refresh_token, expira_em, conectado_em, atualizado_em) VALUES ('Loja B','lojab','','','2099-01-01',?,?)`).run(AGORA, AGORA)
db.prepare(`INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES ('Loja B','MLB111','Coleira Secreta B', 99.9)`).run()
db.prepare(`INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES ('Loja B','MLB111','2026-09-20','preco','80','99.9',24.9,'coleta',?)`).run(AGORA)
db.prepare(`INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES ('Loja B','MLB111','2026-09-25','preco','99.9','99.95',0.05,'coleta',?)`).run(AGORA)   // < 3%: não é marco
tar.run('b1', 'f', 'Loja B', 'Otimizar título', 'Mercado Livre', 'Beltrano Consultor', 'concluida', 'Ajuste de Título', '2026-10-01', '', '', AGORA)

const livro = criarLivro({ handle: db, agora: () => AGORA })
const validarPor = n => (n === 'Líder Teste' ? 'Líder Teste' : '')
const guardiao = criarGuardiao({ livro, validarPor, agora: () => AGORA })
const linhas = (rx, chave) => rx.secoes.find(s => s.chave === chave).linhas

await ok('atas: compromissos pela lista fechada de verbos (lado) e preços com direção; «sem reajuste» não é alta; exemplo e Ads ficam fora', () => {
  const c = G.compromissosDaAta(ATA)
  assert.equal(c.length, 3)
  assert.deepEqual(c.map(x => x.lado), ['cliente', 'reuniao', 'assessoria'])
  assert.match(c[0].frase, /^Loja A se comprometeu/, 'o rótulo «Envio de …:» sai da frase')
  const p = G.precosDaAta(ATA)
  assert.equal(p.length, 2); assert.ok(p.every(x => x.direcao === 'alta')); assert.deepEqual(p[1].valores_c, [520])
  assert.equal(G.direcaoDe('Mantas sem reajuste por enquanto'), '')
  assert.equal(G.precosDaAta('Exemplo: se o valor final é 178,17, o anúncio deve começar em 254,52.').length, 0)
  assert.equal(G.precosDaAta('Observação: investir mais aumenta valor absoluto gasto em 10,00.').length, 0)
})

await ok('raio-X sem custo = sem lucro: margem «não temos o dado», nenhuma célula de lucro com número; vendas do canal sem integração = «não temos o dado»', () => {
  const { rx } = raioXDoCliente('Loja A', { hoje: HOJE })
  assert.equal(rx.sistema, 'smith'); assert.equal(rx.colunas.length, 6)
  assert.equal(rx.fatos.tem_custo, false)
  const m = linhas(rx, 'margem')
  assert.equal(m.length, 1); assert.equal(m[0].medido.v, null); assert.match(m[0].medido.motivo, /não temos o dado: sem custo, sem lucro/)
  for (const s of rx.secoes) for (const l of s.linhas) for (const c of [l.previsao, l.medido]) if (c.v == null) { assert.equal(c.txt, '—'); assert.ok(c.motivo, `${s.chave}/${l.metrica} sem motivo`) }
  assert.ok(rx.faltando.some(f => /custo unitário/.test(f))); assert.ok(rx.faltando.some(f => /vendas do canal/.test(f)))
  const pr = linhas(rx, 'precos')
  assert.equal(pr.length, 2, 'tarefa de 15/09 (com a frase da ata como contexto) + tarefa de 31/07; a de maio fica fora dos 90 d')
  assert.match(pr[0].nota, /reunião de 15\/09/); assert.match(pr[0].medido.motivo, /sem série de vendas de Shopee/)
  assert.ok(pr.every(l => l.decisor === 'assessoria' && l.decisor_fonte === 'padrao'), 'sem marcação conta como da assessoria')
  assert.equal(rx.fatos.contas_irmas, true, 'Shopee 1 e Shopee 2 nas tarefas')
  const ct = linhas(rx, 'contrato'); assert.match(ct[0].nota, /vence em 2 d/)
  assert.equal(linhas(rx, 'promessas').length, 3)
  assert.equal(linhas(rx, 'execucao')[2].medido.v, 1, '1 aguardando o cliente')
})

await ok('decisão do cliente (1 clique): prévia não grava; confirmar muda SÓ a atribuição — a medição fica idêntica; registra no livro; voltar para assessoria também é marcação', () => {
  const antes = raioXDoCliente('Loja B', { hoje: HOJE }).rx, la = linhas(antes, 'precos')
  assert.equal(la.length, 1, 'só a mudança ≥ 3%'); assert.equal(la[0].decisor, 'assessoria')
  const ref = la[0].ref; assert.equal(ref, 'ml:MLB111:2026-09-20')
  const pv = guardiao.decidir({ cliente: 'Loja B', ref, decisor: 'cliente', por: 'Líder Teste' })
  assert.equal(pv.previa, true); assert.equal(pv.depois.decisor, 'cliente'); assert.equal(pv.medicao_inalterada, true)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM preco_decisao').get().n, 0, 'prévia não grava')
  const g = guardiao.decidir({ cliente: 'Loja B', ref, decisor: 'cliente', por: 'Líder Teste', confirmar: true }); assert.equal(g.gravado, true)
  const lb = linhas(raioXDoCliente('Loja B', { hoje: HOJE }).rx, 'precos')
  assert.equal(lb[0].decisor, 'cliente'); assert.equal(lb[0].decisor_fonte, 'marcado'); assert.match(lb[0].nota, /marcado por Líder Teste/)
  assert.deepEqual(lb[0].medido, la[0].medido, 'a medição não muda com a marcação'); assert.equal(lb[0].metrica, la[0].metrica)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM registro_cliente WHERE cliente = 'Loja B' AND tipo = 'nota' AND ref LIKE 'preco_decisao:%'").get().n, 1)
  // marco de tarefa (canal sem série) também
  const refA = linhas(raioXDoCliente('Loja A', { hoje: HOJE }).rx, 'precos')[0].ref
  guardiao.decidir({ cliente: 'Loja A', ref: refA, decisor: 'cliente', por: 'Líder Teste', confirmar: true })
  const d = dadosGuardiao('Loja A', { hoje: HOJE }); assert.equal(d.marcos.find(m => m.ref === refA).decisao.decisor, 'cliente')
  assert.equal(raioXDoCliente('Loja A', { hoje: HOJE }).rx.fatos.altas_cliente.length, 1)
  guardiao.decidir({ cliente: 'Loja A', ref: refA, decisor: 'assessoria', por: 'Líder Teste', confirmar: true })
  assert.equal(dadosGuardiao('Loja A', { hoje: HOJE }).marcos.find(m => m.ref === refA).decisao.fonte, 'marcado')
  // sem `por` válido / decisor fora da lista
  assert.throws(() => guardiao.decidir({ cliente: 'Loja B', ref, decisor: 'cliente', por: 'Qualquer' }), e => e.status === 403)
  assert.throws(() => guardiao.decidir({ cliente: 'Loja B', ref, decisor: 'chefe', por: 'Líder Teste' }), e => e.status === 400 && !/chefe/.test(e.message))
})

await ok('isolamento: a mudança de preço de outro cliente = 404; o raio-X de um cliente não traz nada do outro', () => {
  assert.throws(() => guardiao.decidir({ cliente: 'Loja A', ref: 'ml:MLB111:2026-09-20', decisor: 'cliente', por: 'Líder Teste' }), e => e.status === 404)
  const a = JSON.stringify(raioXDoCliente('Loja A', { hoje: HOJE }).rx), b = JSON.stringify(raioXDoCliente('Loja B', { hoje: HOJE }).rx)
  assert.ok(!a.includes('Coleira Secreta B') && !a.includes('MLB111')); assert.ok(!b.includes('Tapete') && !b.includes('Shopee 1'))
})

await ok('lojas do mesmo dono: prévia por padrão, confirmar grava, raio-X mostra a loja; canal fora da lista = erro sem eco', () => {
  const pv = guardiao.salvarConta({ cliente: 'Loja A', canal: 'shopee', conta: 'Shopee 2', nome_loja: 'Luxo', grupo: 'dono', por: 'Líder Teste' })
  assert.equal(pv.previa, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM conta_canal').get().n, 0)
  guardiao.salvarConta({ cliente: 'Loja A', canal: 'shopee', conta: 'Shopee 1', nome_loja: 'Loja A', grupo: 'dono', por: 'Líder Teste', confirmar: true })
  guardiao.salvarConta({ cliente: 'Loja A', canal: 'shopee', conta: 'Shopee 2', nome_loja: 'Luxo', grupo: 'dono', por: 'Líder Teste', confirmar: true })
  const rx = raioXDoCliente('Loja A', { hoje: HOJE }).rx, c = linhas(rx, 'canais')
  assert.ok(c.some(l => l.medido.txt === 'Luxo' && /mesmo dono/.test(l.metrica)))
  assert.deepEqual(rx.fatos.lojas, ['Loja A', 'Luxo'])
  assert.throws(() => guardiao.salvarConta({ cliente: 'Loja A', canal: 'orkut', conta: 'x', por: 'Líder Teste' }), e => !/orkut/.test(e.message))
  guardiao.salvarConta({ cliente: 'Loja A', canal: 'shopee', conta: 'Shopee 2', por: 'Líder Teste', remover: true, confirmar: true })
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conta_canal WHERE cliente = 'Loja A'").get().n, 1)
})

await ok('pauta: passa no auditor, sem nome de analista, abertura com fatos e «não temos o dado», exatamente 3 decisões A/B com prós/contras e o que medir em 14 d, padrão «sem custo → pausar aumentos 14 d»', () => {
  const r = pautaDoCliente('Loja A', { data: '2026-10-20', hora: '16:00', hoje: HOJE, rotulo: 'Loja A Têxtil' })
  assert.deepEqual(r.auditoria.codigos, []); assert.equal(r.auditoria.ok, true)
  assert.ok(!/Fulano|Analista|Beltrano/.test(r.texto + r.html), 'nenhum nome da equipe')
  assert.match(r.pauta.quando, /^terça 20\/10\/2026, 16h$/)
  assert.ok(r.pauta.abertura.some(x => /não temos o dado/.test(x))); assert.ok(r.pauta.abertura.some(x => /Contrato Shopee: vencimento registrado em 17\/10\/2026/.test(x)))
  assert.equal(r.pauta.decisoes.length, 3)
  for (const d of r.pauta.decisoes) { assert.ok(d.a.texto && d.a.pros && d.a.contras && d.b.texto && d.b.pros && d.b.contras && d.medir); assert.ok(['A', 'B'].includes(d.recomendada)) }
  assert.equal(r.pauta.decisoes[0].id, 'pausa_aumentos'); assert.equal(r.pauta.decisoes[0].recomendada, 'A')
  assert.match(r.pauta.recomendacao_padrao, /pausar novos aumentos por 14 dias/)
  assert.match(r.texto, /O que medir em 14 dias/)
  assert.ok(r.pauta.precos.some(x => /15\/09/.test(x) && /não temos o dado/.test(x)))
  assert.ok(r.pauta.promessas.some(x => /relação atualizada/.test(x) && /Não aparece no registro/.test(x)))
  assert.match(r.html, /^<!doctype html>/); assert.ok(!/undefined|NaN|\[object/.test(r.texto + r.html))
  // com custo, o padrão some e a 1ª decisão deixa de ser a pausa
  db.prepare("INSERT INTO promo_custos_sku (cliente, sku, custo, atualizado_em) VALUES ('Loja A','SKU1',10,'2026-10-01')").run()
  const r2 = pautaDoCliente('Loja A', { data: '2026-10-20', hoje: HOJE })
  assert.equal(r2.pauta.recomendacao_padrao, ''); assert.notEqual(r2.pauta.decisoes[0].id, 'pausa_aumentos')
  db.prepare("DELETE FROM promo_custos_sku WHERE cliente = 'Loja A'").run()
})

await ok('auditor da pauta barra culpa, «prejuízo», promessa, causalidade e nome da equipe; anonimizar troca apelido curto do 1º nome', () => {
  const A = (t, o) => G.auditarPauta(t, o).codigos
  assert.ok(A('O cliente não respondeu no prazo.').includes('culpa'))
  assert.ok(A('Houve prejuízo de R$ 100.').includes('culpa'))
  assert.ok(A('Isso vai vender mais com certeza.').includes('promessa'))
  assert.ok(A('A alta causou a queda.').includes('causalidade'))
  assert.ok(A('Combinado com Fulano.', { nomesInternos: ['Fulano Analista'] }).includes('analista'))
  assert.equal(G.anonimizar('Gi se comprometeu a enviar; Giovanna também.', ['Giovanna Torres']), 'a equipe se comprometeu a enviar; a equipe também.')
  assert.equal(G.anonimizar('A Gi enviou.', []), 'A Gi enviou.')
})

await ok('rotas: GET raio-X e pauta (JSON/HTML/TXT), POST prévia por padrão, 415 sem JSON, 403 sem líder, 404 sem eco', async () => {
  const app = express(); app.use(express.json())
  app.use(criarRotasGuardiao({ raioX: c => raioXDoCliente(c, { hoje: HOJE }).rx, pauta: (c, o) => pautaDoCliente(c, { ...o, hoje: HOJE }), guardiao, gerarPdf: null,
    clienteCanonico: c => (['Loja A', 'Loja B'].includes(c) ? c : '') }))
  const srv = app.listen(0), u = `http://127.0.0.1:${srv.address().port}`
  const post = (p, b, ct = 'application/json') => fetch(u + p, { method: 'POST', headers: { 'Content-Type': ct }, body: ct === 'application/json' ? JSON.stringify(b) : 'x' })
  try {
    let r = await fetch(`${u}/api/cliente/guardiao?cliente=Loja%20A`); let j = await r.json(); assert.equal(r.status, 200); assert.equal(j.sistema, 'smith')
    r = await fetch(`${u}/api/cliente/guardiao?cliente=%3Cscript%3Exyz`); j = await r.json(); assert.equal(r.status, 404); assert.ok(!JSON.stringify(j).includes('xyz'))
    r = await fetch(`${u}/api/cliente/guardiao?cliente=%5BComercial%5D%20Loja%20A`); assert.equal(r.status, 404)
    r = await fetch(`${u}/api/cliente/guardiao/pauta?cliente=Loja%20A&data=2026-10-20&hora=16:00`); j = await r.json(); assert.equal(j.auditoria.ok, true); assert.equal(j.pauta.decisoes.length, 3); assert.equal(j.auditoria.trechos, undefined)
    r = await fetch(`${u}/api/cliente/guardiao/pauta.html?cliente=Loja%20A&data=2026-10-20`); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(await r.text(), /Três decisões/)
    r = await fetch(`${u}/api/cliente/guardiao/pauta.txt?cliente=Loja%20A&data=2026-10-20`); assert.match(await r.text(), /^Pauta da reunião/)
    r = await fetch(`${u}/api/cliente/guardiao/pauta.pdf?cliente=Loja%20A`); assert.equal(r.status, 503)
    r = await fetch(`${u}/api/cliente/guardiao/pauta?cliente=Loja%20A&data=20-10-2026xyz`); j = await r.json(); assert.equal(r.status, 400); assert.ok(!JSON.stringify(j).includes('xyz'))
    r = await post('/api/cliente/preco/decisao', null, 'text/plain'); assert.equal(r.status, 415)
    r = await post('/api/cliente/preco/decisao', { cliente: 'Loja B', ref: 'ml:MLB111:2026-09-20', decisor: 'assessoria', por: 'Líder Teste' }); j = await r.json()
    assert.equal(j.previa, true, 'sem confirmar = prévia'); assert.equal(db.prepare("SELECT decisor FROM preco_decisao WHERE cliente = 'Loja B'").get().decisor, 'cliente', 'nada mudou')
    r = await post('/api/cliente/preco/decisao', { cliente: 'Loja B', ref: 'ml:MLB111:2026-09-20', decisor: 'assessoria', por: 'Líder Teste', confirmar: 'true' }); j = await r.json(); assert.equal(j.previa, true, '"true" texto não confirma')
    r = await post('/api/cliente/preco/decisao', { cliente: 'Loja B', ref: 'ml:MLB111:2026-09-20', decisor: 'cliente', por: 'Intruso' }); assert.equal(r.status, 403)
    r = await post('/api/cliente/preco/decisao', { cliente: 'Loja B', ref: 'tarefa:naoexiste-xyz', decisor: 'cliente', por: 'Líder Teste' }); j = await r.json(); assert.equal(r.status, 404); assert.ok(!JSON.stringify(j).includes('xyz'))
    r = await post('/api/cliente/contas-canal', { cliente: 'Loja A', canal: 'shopee', conta: 'Shopee 3', por: 'Líder Teste' }); j = await r.json(); assert.equal(j.previa, true)
  } finally { srv.close() }
})

console.log(`\nteste-guardiao: ${n} blocos ok`)
