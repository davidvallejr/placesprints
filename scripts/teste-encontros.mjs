// Autoteste dos encontros da consultoria (Place Prime, docs/desenho-place-prime.md § D.1–D.6). Banco EM MEMÓRIA (schema inteiro do db.js), stubs de distribuir/redigir,
// arquivos num diretório temporário — nunca toca data/db.sqlite, o Notion real nem a IA real.
//  (1) encontro = card + sidecar: contagens; previsto vencido > 24 h = «confirmar», nunca «faltou»; registrado e ainda não sincronizado aparece;
//  (2) salvarInfo: prévia sem escrita; treinado só da lista fechada; gravação sem query; quem valida (403); card de outro cliente (404) e não-encontro (400);
//  (3) Registrar encontro: prévia não chama o Notion; confirmar grava ação aprovada e chama o distribuir() com dryRun:false; idempotente;
//  (4) transcrição: consentimento obrigatório; prévia sem arquivo; arquivo em data/encontros/<cliente>/<sha256>.txt; candidatos; IA só redige (stub) e sem ela modelo fixo;
//  (5) agenda (projeção) por consultor e semana, com o aviso do calendário não ligado;
//  (6) «o que o cliente não executa»: faixas 14/30, não puxado, feito no prazo, treinado e não feito, cobertura honesta;
//  (7) «quem treina melhor»: crédito a quem treinou, senão central rotulada; n < 8 = «—» (sem prova suficiente);
//  (8) rotas HTTP: 415, 404 prospect/fora da central, escopo, por inválido.
// Rodar: node scripts/teste-encontros.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { mkdtempSync, readFileSync, existsSync, readdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const { createHash } = await import('node:crypto')
const express = (await import('express')).default
const { db } = await import('../src/lib/db.js')
const { criarEncontros, estadoDe, contagens, agenda, treinadosDaAta, naoExecuta, quemTreina, CALENDARIO, semanaIso } = await import('../src/lib/encontros.js')
const { criarRotasEncontros } = await import('../src/rotas-encontros.js')
const { idAcao } = await import('../src/lib/plano-cliente.js')
const { wilson } = await import('../src/lib/impacto-tarefas.js')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const falha = async (fn, rx, status = 400) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); assert.match(e.message, rx); assert.equal(e.status, status) }
const HOJE = '2026-10-22', AGORA = '2026-10-22T12:00:00.000Z'
const QUEM = ['Giovanna Torres', 'Carla Souza']
const validarPor = nome => QUEM.find(q => q.toLowerCase() === String(nome).toLowerCase()) || ''
const ID = k => `${k}`.padEnd(8, '0') + '-0000-0000-0000-000000000000'
const ins = (id, cliente, campos) => db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, tipo_demanda, status, data_inicio, prazo, data_conclusao, conteudo, url, arquivada)
  VALUES (@id, 'demo', @cliente, @titulo, @tipo_demanda, @status, @data_inicio, @prazo, @data_conclusao, @conteudo, @url, 0)`).run({ id, cliente, titulo: 'Reunião', tipo_demanda: 'Reunião de Alinhamento', status: 'nao_iniciada', data_inicio: null, prazo: null, data_conclusao: null, conteudo: '', url: 'https://notion.so/x', ...campos })
const ATA = 'Reunião de alinhamento. Treinamos a 6.12 Ficha Técnica e a Construção de títulos com o cliente, revisando os curva A um a um, e combinamos os próximos passos da conta. ' +
  'O cliente vai enviar a planilha de custos até sexta. A assessoria vai analisar os anúncios.'
ins(ID('a1'), 'Acme', { status: 'concluida', data_conclusao: '2026-10-10', conteudo: ATA })
ins(ID('a2'), 'Acme', { prazo: '2026-10-30' })                                     // previsto
ins(ID('a3'), 'Acme', { prazo: '2026-10-19' })                                     // vencido há 3 dias → confirmar
ins(ID('a4'), 'Acme', { tipo_demanda: 'Reuniao Gravada', status: 'concluida', data_conclusao: '2026-09-20' })
ins(ID('a5'), 'Acme', { tipo_demanda: 'Ficha Técnica', titulo: 'Ficha técnica' })  // não é encontro
ins(ID('b1'), 'Beta', { status: 'concluida', data_conclusao: '2026-10-05' })
const chamadas = { distribuir: [], redigir: 0 }
const raiz = mkdtempSync(join(tmpdir(), 'ps-encontros-'))
const fab = (extra = {}) => criarEncontros({ handle: db, agora: () => AGORA, hoje: () => HOJE, validarPor, idAcao, raiz,
  distribuir: async (acoes, o) => { chamadas.distribuir.push({ ids: acoes.map(a => a.id), dryRun: o.dryRun, executor: acoes[0].dados.executor }); return { criadas: [{ url: 'https://notion.so/novo' }], ja_existiam: [], erros: [] } },
  centralDe: c => ({ Acme: { produto: 'prime', consultor: 'Giovanna Torres', squad: 'S1', canais: ['ML'] }, Beta: { produto: 'performance', consultor: 'Carla Souza', squad: 'S2', canais: ['ML'] } })[c] || null, ...extra })
const E = fab()

await ok('encontro = card + sidecar: contagens; vencido > 24 h = confirmar (nunca «faltou»); não-encontro fica fora; sugestão de treinado pela ata', () => {
  assert.equal(estadoDe({ status: 'nao_iniciada', prazo: '2026-10-21' }, HOJE).estado, 'previsto', 'ontem ainda não passou de 24 h')
  assert.equal(estadoDe({ status: 'nao_iniciada', prazo: '2026-10-20' }, HOJE).estado, 'confirmar')
  assert.equal(estadoDe({ status: 'nao_iniciada' }, HOJE).estado, 'sem_data')
  const l = E.listar('Acme')
  assert.deepEqual(l.map(e => e.estado).sort(), ['confirmar', 'previsto', 'realizado', 'realizado'])
  const c = contagens(l, HOJE)
  assert.deepEqual([c.previstos, c.confirmar, c.realizados, c.com_ata, c.gravados, c.com_treinado, c.sem_tipo], [1, 1, 2, 1, 1, 0, 2])
  assert.equal(c.proximo.data, '2026-10-30'); assert.ok(!JSON.stringify(c).includes('faltou'))
  assert.deepEqual(l.find(e => e.id === ID('a1')).sugestao_treinado.sort(), ['6.12', '8.2'])
  assert.deepEqual(treinadosDaAta('nada a ver 99.9'), [])
  const p = E.painel('Acme')
  assert.equal(p.calendario.ligado, false); assert.match(p.calendario.motivo, /Google Calendar/); assert.ok(p.encontros.every(e => !('conteudo' in e)), 'ata não sai na API')
  assert.equal(p.processos.length, 138); assert.ok(p.tipos.some(t => t.id === 'kickoff'))
})

await ok('salvarInfo: prévia sem escrita; treinado só da lista; gravação sem query; 403/404/400', async () => {
  const pv = E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a1'), tipo: 'kickoff', treinado: ['6.12'], gravacao_url: 'https://meet.x/abc?token=SEGREDO#t', por: 'giovanna torres' })
  assert.equal(pv.previa, true); assert.equal(pv.depois.gravacao_url, 'https://meet.x/abc'); assert.equal(db.prepare('SELECT COUNT(*) n FROM encontro_info').get().n, 0)
  const r = E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a1'), tipo: 'kickoff', consultor: 'Carla Souza', treinado: ['6.12', '8.2'], gravacao_url: 'https://meet.x/abc?token=SEGREDO', por: 'Giovanna Torres', confirmar: true })
  assert.deepEqual(r.depois.treinado.map(x => [x.processo_id, x.por]), [['6.12', 'Carla Souza'], ['8.2', 'Carla Souza']], 'crédito a quem conduziu')
  const row = db.prepare('SELECT * FROM encontro_info WHERE tarefa_id = ?').get(ID('a1'))
  assert.equal(row.gravacao_url, 'https://meet.x/abc'); assert.ok(!JSON.stringify(row).includes('SEGREDO')); assert.equal(row.cliente, 'Acme')
  await falha(() => E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a1'), treinado: ['99.9'], por: 'Giovanna Torres' }), /lista fechada/)
  await falha(() => E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a1'), tipo: 'jantar', por: 'Giovanna Torres' }), /fora da lista/)
  await falha(() => E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a1'), por: 'Fulano' }), /só líderes e consultores/, 403)
  await falha(() => E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('b1'), por: 'Giovanna Torres' }), /não encontrado/, 404)
  await falha(() => E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a5'), por: 'Giovanna Torres' }), /não é um card de encontro/)
  await falha(() => E.salvarInfo({ cliente: 'Acme', tarefa_id: ID('a1'), gravacao_url: 'javascript:alert(1)', por: 'Giovanna Torres' }), /http/)
  assert.equal(contagens(E.listar('Acme'), HOJE).com_treinado, 1)
})

await ok('Registrar encontro: prévia não escreve nem chama o Notion; confirmar grava aprovada e distribui com dryRun:false; idempotente; aparece como previsto', async () => {
  const pv = await E.registrar({ cliente: 'Acme', data: '2026-10-28', tipo: 'diagnostico', por: 'Giovanna Torres' })
  assert.equal(pv.previa, true); assert.equal(chamadas.distribuir.length, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM acoes_plano WHERE regra = 'encontro'").get().n, 0)
  assert.equal(pv.acao.id, idAcao('Acme', 'encontro', '2026-10-28|diagnostico'))
  const r = await E.registrar({ cliente: 'Acme', data: '2026-10-28', tipo: 'diagnostico', por: 'Giovanna Torres', confirmar: true })
  assert.deepEqual(chamadas.distribuir, [{ ids: [pv.acao.id], dryRun: false, executor: 'consultor' }]); assert.equal(r.distribuicao.criadas, 1)
  const a = db.prepare('SELECT * FROM acoes_plano WHERE id = ?').get(pv.acao.id), d = JSON.parse(a.dados_json)
  assert.equal(a.status, 'aprovada'); assert.equal(a.prazo, '2026-10-28'); assert.equal(d.demanda_notion, 'Reunião de Alinhamento'); assert.deepEqual(d.encontro_info, { tipo: 'diagnostico', consultor: 'Giovanna Torres' })
  await E.registrar({ cliente: 'Acme', data: '2026-10-28', tipo: 'diagnostico', por: 'Giovanna Torres', confirmar: true })
  assert.equal(db.prepare("SELECT COUNT(*) n FROM acoes_plano WHERE regra = 'encontro'").get().n, 1, 'não duplica')
  const reg = E.listar('Acme').find(e => e.id === pv.acao.id)
  assert.equal(reg.estado, 'previsto'); assert.equal(reg.aguardando_sync, true); assert.equal(reg.tipo, 'diagnostico')
  // card sincronizado (título com o PS-id, demanda diferente) passa a ser o encontro, sem duplicar
  db.prepare("UPDATE acoes_plano SET status = 'distribuida', notion_page_id = ? WHERE id = ?").run(ID('a6'), pv.acao.id)
  ins(ID('a6'), 'Acme', { titulo: `Encontro com o cliente · ${pv.acao.id}`, tipo_demanda: '', prazo: '2026-10-28' })
  const l = E.listar('Acme'); assert.equal(l.filter(e => e.data === '2026-10-28').length, 1); assert.equal(l.find(e => e.id === ID('a6')).tipo, 'diagnostico')
  await falha(() => E.registrar({ cliente: 'Acme', data: '2027-12-01', tipo: 'kickoff', por: 'Giovanna Torres' }), /data/)
  await falha(() => E.registrar({ cliente: 'Acme', data: '2026-10-28', tipo: 'jantar', por: 'Giovanna Torres' }), /fora da lista/)
  await falha(() => E.registrar({ cliente: 'Acme', data: '2026-10-28', tipo: 'kickoff', consultor: 'Fulano', por: 'Giovanna Torres' }), /central/, 403)
})

await ok('transcrição: consentimento obrigatório; prévia sem arquivo; arquivo fora do banco por sha256; candidatos; IA só redige (stub); sem IA = modelo fixo', async () => {
  const txt = 'Transcrição da reunião.\nO cliente vai enviar a planilha de custos até sexta.\nO cliente se comprometeu a liberar o acesso ao Bling.\nA assessoria vai revisar os títulos.'
  const sha = createHash('sha256').update(txt, 'utf8').digest('hex')
  await falha(() => E.transcricao({ cliente: 'Acme', tarefa_id: ID('a4'), texto: txt, consentimento: false, por: 'Giovanna Torres' }), /consentimento/)
  await falha(() => E.transcricao({ cliente: 'Acme', tarefa_id: ID('a4'), texto: 'curto', consentimento: true, por: 'Giovanna Torres' }), /20 caracteres/)
  await falha(() => E.transcricao({ cliente: 'Acme', tarefa_id: ID('a4'), texto: 'x'.repeat(600_000), consentimento: true, por: 'Giovanna Torres' }), /500 KB/)
  const pv = await E.transcricao({ cliente: 'Acme', tarefa_id: ID('a4'), texto: txt, consentimento: true, por: 'Giovanna Torres' })
  assert.equal(pv.previa, true); assert.equal(pv.sha256, sha); assert.equal(pv.candidatos.length, 2); assert.match(pv.redacao, /modelo fixo/)
  assert.ok(!existsSync(join(raiz, 'data', 'encontros')), 'prévia não grava arquivo')
  const comIA = fab({ temChaveIA: () => true, redigir: async ({ template }) => { chamadas.redigir++; return { texto: 'Enviar a planilha de custos', origem: template.includes('Bling') ? 'deterministico' : 'ia' } } })
  const r = await comIA.transcricao({ cliente: 'Acme', tarefa_id: ID('a4'), texto: txt, consentimento: true, por: 'Giovanna Torres', confirmar: true })
  assert.equal(chamadas.redigir, 2); assert.deepEqual(r.candidatos.map(c => c.titulo_origem), ['ia', 'modelo'])
  const arq = join(raiz, 'data', 'encontros', 'acme', `${sha}.txt`)
  assert.equal(readFileSync(arq, 'utf8'), txt); assert.deepEqual(readdirSync(join(raiz, 'data', 'encontros', 'acme')), [`${sha}.txt`])
  const row = db.prepare('SELECT * FROM encontro_info WHERE tarefa_id = ?').get(ID('a4'))
  assert.equal(row.transcricao_ref, `sha256:${sha}`); assert.equal(row.consentimento_transcricao, 1); assert.equal(row.consentimento_por, 'Giovanna Torres'); assert.ok(!JSON.stringify(row).includes('Transcrição da reunião'), 'texto não vai ao banco')
  assert.equal(E.listar('Acme').find(e => e.id === ID('a4')).candidatos.length, 2, 'candidatos ficam para a regra combinado_ata')
})

await ok('agenda (projeção) por consultor/cliente/semana, com o aviso de que o calendário não está ligado', () => {
  const ag = E.agenda({ clientes: ['Acme', 'Beta'], por: 'consultor' })
  assert.equal(ag.calendario, CALENDARIO); assert.equal(ag.total.realizados, 3)
  const gi = ag.linhas.find(l => l.chave === 'Giovanna Torres'), ca = ag.linhas.find(l => l.chave === 'Carla Souza')
  assert.ok(gi && ca); assert.equal(ca.realizados, 2, 'Acme a1 (quem conduziu) + Beta (central)')
  assert.equal(semanaIso('2026-10-22'), '2026-W43'); assert.equal(semanaIso('2027-01-01'), '2026-W53')
  assert.ok(E.agenda({ clientes: ['Acme'], por: 'semana' }).linhas.some(l => l.chave === '2026-W44'))
  assert.deepEqual(agenda([], { por: 'cliente', hoje: HOJE }), [])
})

await ok('o que o cliente não executa: faixas 14/30, não puxado, feito no prazo, treinado e não feito, cobertura honesta', () => {
  const tarefas = new Map([['p1', { status: 'nao_iniciada', url: 'u1' }], ['p2', { status: 'nao_iniciada', url: 'u2' }], ['p3', { status: 'concluida', data_conclusao: '2026-10-09', url: 'u3' }], ['p4', { status: 'nao_iniciada' }]])
  const a = (id, status, prazo, page, extra = {}) => ({ id, regra: 'trilha_prime', titulo: id, status, prazo, notion_page_id: page, dados: { executor: 'cliente', ...extra } })
  const r = naoExecuta({ hoje: HOJE, tarefas, acoes: [a('v20', 'distribuida', '2026-10-02', 'p1'), a('v35', 'distribuida', '2026-09-17', 'p2'), a('ok', 'distribuida', '2026-10-10', 'p3', { processo_id: '8.2' }),
    a('futuro', 'distribuida', '2026-11-01', 'p4'), a('prop', 'proposta', '2026-10-30', ''), a('sync', 'distribuida', '2026-10-30', 'zz'), a('desc', 'descartada', '2026-10-01', ''), { ...a('time', 'distribuida', '2026-10-01', 'p1'), dados: { executor: 'consultor' } }],
    encontros: [{ estado: 'realizado', data: '2026-10-08', treinado: [{ processo_id: '8.2', por: 'Carla Souza' }, { processo_id: '6.12', por: 'Carla Souza' }] }] })
  assert.deepEqual(r.itens.map(i => [i.acao_id, i.estado, i.faixa]).slice(0, 2), [['v35', 'vencido', 'revisar'], ['v20', 'vencido', 'cobrar']])
  assert.deepEqual(r.resumo, { com_executor: 6, nao_puxados: 1, aguardando_sync: 1, no_prazo: 1, vencidos: 2, vencidos_14: 2, vencidos_30: 1, feitos: 1, feitos_no_prazo: 1, pct_no_prazo: 100 })
  assert.deepEqual(r.treinado_nao_feito.map(t => t.processo_id), ['6.12'], 'títulos (8.2) foi feito depois do treino; ficha (6.12) não')
  assert.match(r.cobertura, /decisão 3/)
  const vazio = naoExecuta({ hoje: HOJE, tarefas: new Map(), acoes: [] })
  assert.equal(vazio.resumo.pct_no_prazo, null, 'sem feitos = «—», nunca 0%')
  const doBanco = E.naoExecuta('Acme'); assert.equal(doBanco.produto, 'prime'); assert.equal(doBanco.resumo.com_executor, 0)
})

await ok('quem treina melhor: crédito a quem treinou (senão central, rotulado); n < 8 = «—» sem prova; só medidas de tarefa do cliente', () => {
  const ex = new Map(), medidas = [], treinos = [{ cliente: 'Acme', familia: 'ficha', por: 'Carla Souza', em: '2026-09-01' }]
  for (let i = 0; i < 10; i++) { ex.set(`t${i}`, 'cliente'); medidas.push({ id: `t${i}`, cliente: 'Acme', tipo: 'Ficha Técnica', estado: i < 9 ? 'melhorou' : 'piorou', data: '2026-10-01' }) }
  for (let i = 0; i < 3; i++) { ex.set(`u${i}`, 'cliente'); medidas.push({ id: `u${i}`, cliente: 'Beta', tipo: 'Otimizar Anúncios', estado: 'sem_efeito', data: '2026-10-01' }) }
  medidas.push({ id: 'time1', cliente: 'Acme', tipo: 'Ficha Técnica', estado: 'melhorou', data: '2026-10-01' })   // tarefa do time: fora
  medidas.push({ id: 'tantes', cliente: 'Acme', tipo: 'Ficha Técnica', estado: 'melhorou', data: '2026-08-01' }); ex.set('tantes', 'cliente')   // antes do treino: central
  const r = quemTreina({ medidas, executorPorTarefa: ex, treinos, consultorCentral: c => ({ Acme: 'Giovanna Torres', Beta: 'Giovanna Torres' })[c], wilson })
  const carla = r.linhas.find(l => l.consultor === 'Carla Souza'), gi = r.linhas.find(l => l.consultor === 'Giovanna Torres')
  assert.equal(carla.n, 10); assert.equal(carla.pelo_treino, 10); assert.ok(carla.taxa > 0.8 && carla.prova === true)
  assert.equal(gi.n, 4); assert.equal(gi.pela_central, 4); assert.equal(gi.taxa, null); assert.match(gi.texto, /sem prova suficiente \(4 de 8/)
  assert.equal(r.n_medidas, 14); assert.match(r.rotulo, /nunca causa/)
  assert.equal(quemTreina({ medidas: [], executorPorTarefa: new Map(), treinos: [], wilson }).base, null)
})

await ok('rotas HTTP: 415 sem JSON, 404 prospect/fora da central, escopo, por inválido, prévia por padrão', async () => {
  const app = express(); app.use(express.json())
  app.use(criarRotasEncontros({ encontros: E, clienteCanonico: c => ['Acme', 'Beta'].find(x => x.toLowerCase() === c.toLowerCase()) || '', wilson,
    escopo: ({ tipo, clientes }) => tipo === 'selecao' ? { clientes } : tipo === 'total' ? { clientes: ['Acme', 'Beta'] } : { clientes: [], erro: 'x' }, medidas: () => [] }))
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`
  const get = p => fetch(base + p).then(async r => ({ s: r.status, j: await r.json() }))
  const post = (p, b, ct = 'application/json') => fetch(base + p, { method: 'POST', headers: { 'Content-Type': ct }, body: JSON.stringify(b) }).then(async r => ({ s: r.status, j: await r.json() }))
  try {
    assert.equal((await get('/api/cliente/encontros?cliente=acme')).j.cliente, 'Acme')
    assert.equal((await get('/api/cliente/encontros?cliente=%5BComercial%5D%20X')).s, 404)
    assert.equal((await get('/api/cliente/encontros?cliente=Nada')).s, 404)
    assert.equal((await post('/api/cliente/encontros/registrar', { cliente: 'Acme' }, 'text/plain')).s, 415)
    const pv = await post('/api/cliente/encontros/registrar', { cliente: 'Acme', data: '2026-11-05', tipo: 'plano', por: 'Giovanna Torres', confirmar: 'true' })
    assert.equal(pv.j.previa, true, 'confirmar só vale se for exatamente true')
    assert.equal((await post(`/api/cliente/encontros/nao-e-id`, { cliente: 'Acme', por: 'Giovanna Torres' })).s, 404)
    const sv = await post(`/api/cliente/encontros/${ID('a2')}`, { cliente: 'Acme', tipo: 'plano', por: 'Giovanna Torres' })
    assert.equal(sv.s, 200); assert.equal(sv.j.previa, true)
    const msg = (await post(`/api/cliente/encontros/${ID('a2')}`, { cliente: 'Acme', tipo: '<script>', por: 'Giovanna Torres' })).j.erro
    assert.ok(!msg.includes('<script>'), 'erro não ecoa o valor recebido')
    assert.equal((await get('/api/agenda?por=semana&tipo=selecao&clientes=Acme')).j.clientes, 1)
    assert.equal((await get('/api/agenda?por=xyz')).s, 400)
    assert.equal((await get('/api/agenda?tipo=consultor')).s, 400)
    assert.equal((await get('/api/encontros/quem-treina')).j.n_medidas, 0)
    assert.equal((await get('/api/cliente/nao-executa?cliente=Acme')).j.cliente, 'Acme')
  } finally { srv.close() }
})

console.log(`\n${n} verificações dos encontros ok.`)
