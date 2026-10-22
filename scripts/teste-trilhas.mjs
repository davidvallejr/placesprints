// Autoteste da trilha Prime e dos combinados de reunião como REGRAS do plano (docs/desenho-place-prime.md § D.1, D.2, D.5). Banco EM MEMÓRIA, sem rede, sem Notion.
//  (1) config/trilhas.json: todo processo existe no Manual (processos-base), faixa de prazo e gatilho na lista, métrica que o sistema mede; validarTrilhas pega erro;
//  (2) passos datados pelo encontro (sem abertura → passo 0; 'anterior' encadeia; encontro que não aconteceu não dispara);
//  (3) idempotência por alvo; nova abertura → novo alvo; Performance → nada;
//  (4) combinados: lado do cliente, transcrição vence a ata, card existente não duplica, contato/documento barrado, teto por cliente;
//  (5) plano-cliente: Prime ganha trilha_prime/combinado_ata com executor; regerar não duplica; Performance sem regra nova e sem campo novo em dados;
//  (6) card do cliente no Notion (montarPagina) sem people e com o consultor citado; card do time igual.
// Rodar: node scripts/teste-trilhas.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { CFG_TRILHAS, validarTrilhas, passosDevidos, descritoresTrilha, descritoresCombinados, candidatosDaAta, trilhaDo, horizonteDe } = await import('../src/lib/trilhas.js')
const { base, curadoria } = await import('../src/lib/processos.js')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const PROC = new Set(base.processos.map(p => p.id)), FAIXAS = new Set(curadoria.regras_gerais.prazos.map(p => p.tipo))
const T = CFG_TRILHAS.trilhas[0]
const enc = (id, tipo, data, extra = {}) => ({ id, tipo, data, estado: 'realizado', treinado: [], candidatos: [], conteudo: '', ...extra })

await ok('config/trilhas.json: processos do Manual, faixas e gatilhos da lista, métricas medidas; validarTrilhas acusa curadoria errada', () => {
  assert.deepEqual(validarTrilhas(CFG_TRILHAS, { processos: PROC, faixas: FAIXAS }), [])
  for (const t of CFG_TRILHAS.trilhas) for (const p of t.passos) assert.ok(PROC.has(p.processo), `${t.id} ${p.n}: ${p.processo}`)
  assert.equal(T.padrao, false, 'trilha padrão só pela marcação do David')
  const ruim = structuredClone(CFG_TRILHAS); ruim.trilhas[0].passos[0].processo = '99.9'; ruim.trilhas[0].passos[1].faixa_prazo = 'x'; ruim.trilhas[0].passos[2].prova.metrica = 'lucro_magico'; ruim.trilhas[0].passos[3].encontro_gatilho = 'jantar'
  const e = validarTrilhas(ruim, { processos: PROC, faixas: FAIXAS })
  assert.equal(e.length, 4); assert.ok(e.some(x => /99\.9/.test(x)) && e.some(x => /faixa/.test(x)) && e.some(x => /não mede/.test(x)) && e.some(x => /gatilho/.test(x)))
})

await ok('passos datados pelo encontro: sem abertura = passo 0; abertura dispara 1 e 2 (2 encadeado no 1); diagnóstico não aconteceu = passo 3 não nasce', () => {
  const vazio = descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [], hoje: '2026-10-22' })
  assert.deepEqual(vazio.map(d => d.alvo), [`${T.id}|0`]); assert.equal(vazio[0].prazo, '2026-10-25'); assert.equal(vazio[0].extra.executor, 'consultor')
  // encontro sem tipo marcado não ancora (o consultor marca a abertura)
  assert.deepEqual(descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [enc('a', '', '2026-10-01')], hoje: '2026-10-22' }).map(d => d.alvo), [`${T.id}|0`])
  const d = descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [enc('k1', 'kickoff', '2026-10-01'), enc('x', 'alinhamento', '2026-10-15')], hoje: '2026-10-22' })
  assert.deepEqual(d.map(x => [x.extra.passo_n, x.prazo, x.extra.executor]), [[1, '2026-10-04', 'cliente'], [2, '2026-10-08', 'cliente']])
  assert.ok(d.every(x => x.regra === 'trilha_prime' && x.extra.encontro_id === 'k1' && PROC.has(x.extra.processo_id) && x.extra.como.length))
  assert.match(d[0].evidencia, /Abertura \(kickoff\).*01\/10\/2026/); assert.equal(d[0].horizonte, '72h', 'vencido entra em 72h')
  // execução: 5 conta do encontro, 6 e 7 encadeiam; abertura antiga continua valendo para 1 e 2
  const e = descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [enc('k1', 'kickoff', '2026-10-01'), enc('ex', 'execucao', '2026-10-20')], hoje: '2026-10-22' })
  assert.deepEqual(e.filter(x => x.extra.passo_n >= 5).map(x => [x.extra.passo_n, x.prazo]), [[5, '2026-10-27'], [6, '2026-11-03'], [7, '2026-11-10']])
  assert.equal(e.find(x => x.extra.passo_n === 7).horizonte, '30d'); assert.ok(!e.some(x => x.extra.passo_n === 3 || x.extra.passo_n === 0))
  // previsto (não realizado) não ancora
  assert.deepEqual(passosDevidos(T, [enc('k2', 'kickoff', '2026-11-01', { estado: 'previsto' })]).devidos, [])
  assert.equal(horizonteDe('2026-10-22', '2026-10-29'), '7d'); assert.equal(horizonteDe('2026-10-22', '2027-01-29'), '90d')
})

await ok('idempotência: mesmo encontro = mesmo alvo; nova abertura = novos alvos; Performance, sem produto e cliente sem o canal da trilha = nada', () => {
  const a = descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [enc('k1', 'kickoff', '2026-10-01')], hoje: '2026-10-22' }).map(x => x.alvo)
  const b = descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [enc('k1', 'kickoff', '2026-10-01')], hoje: '2026-10-23' }).map(x => x.alvo)
  assert.deepEqual(a, b)
  const c = descritoresTrilha({ produto: 'prime', canais: ['ML'], encontros: [enc('k1', 'kickoff', '2026-10-01'), enc('k9', 'kickoff', '2026-10-21')], hoje: '2026-10-22' })
  assert.ok(c.every(x => x.extra.encontro_id === 'k9') && c[0].prazo === '2026-10-24', 'âncora = abertura mais recente')
  for (const produto of ['performance', '']) assert.deepEqual(descritoresTrilha({ produto, canais: ['ML'], encontros: [enc('k1', 'kickoff', '2026-10-01')], hoje: '2026-10-22' }), [])
  assert.deepEqual(descritoresTrilha({ produto: 'prime', canais: ['SHO'], encontros: [], hoje: '2026-10-22' }), [])
  assert.equal(trilhaDo({ produto: 'prime', canais: ['ML'] }).id, T.id)
})

const ATA = 'Reunião de alinhamento com o cliente sobre o Mercado Livre e os próximos passos da conta. Revisamos os anúncios curva A, a ficha técnica e os custos.\n' +
  'Cliente: vai enviar a planilha de custos até sexta.\nA assessoria vai analisar os títulos dos anúncios.\nO cliente se comprometeu a liberar o acesso ao Bling.\nO cliente vai enviar o contato 11 98765-4321 do fornecedor.'
await ok('combinados: só o lado do cliente; telefone barrado; transcrição vence a ata; card existente não duplica; teto por cliente; Performance = nada', () => {
  const c = candidatosDaAta(ATA)
  assert.deepEqual(c.map(x => x.frase), ['vai enviar a planilha de custos até sexta.', 'O cliente se comprometeu a liberar o acesso ao Bling.'])
  assert.ok(c.every(x => /^[0-9a-f]{16}$/.test(x.alvo) && x.titulo.startsWith('Combinado na reunião:') && x.titulo_origem === 'modelo'))
  const e1 = enc('r1', '', '2026-10-15', { conteudo: ATA })
  const d = descritoresCombinados({ produto: 'prime', encontros: [e1], titulosTarefas: ['Liberar o acesso ao Bling - feito'], hoje: '2026-10-22' })
  assert.equal(d.length, 2, 'título só parecido não bloqueia'); assert.ok(d.every(x => x.regra === 'combinado_ata' && x.extra.executor === 'cliente' && x.extra.origem === 'ata'))
  assert.equal(d[0].prazo, '2026-10-25', 'prazo nunca antes de hoje + 3')
  const dup = descritoresCombinados({ produto: 'prime', encontros: [e1], titulosTarefas: ['O cliente se comprometeu a liberar o acesso ao Bling (card)'], hoje: '2026-10-22' })
  assert.equal(dup.length, 1, 'combinado que já tem card não vira ação')
  const tr = enc('r2', '', '2026-10-20', { conteudo: ATA, candidatos: [{ frase: 'Enviar fotos novas', alvo: 'aaaaaaaaaaaaaaaa', processo: '', titulo: 'Enviar as fotos novas dos kits', titulo_origem: 'ia' }] })
  const d2 = descritoresCombinados({ produto: 'prime', encontros: [tr], hoje: '2026-10-22' })
  assert.deepEqual(d2.map(x => [x.titulo, x.extra.origem, x.extra.titulo_origem]), [['Enviar as fotos novas dos kits', 'transcricao', 'ia']])
  assert.equal(descritoresCombinados({ produto: 'prime', encontros: [enc('velho', '', '2026-08-01', { conteudo: ATA })], hoje: '2026-10-22' }).length, 0, 'fora da janela de 30 dias')
  const muitos = Array.from({ length: 8 }, (_, i) => ({ frase: `f${i}`, alvo: String(i).repeat(16), processo: '', titulo: `t${i}` }))
  assert.equal(descritoresCombinados({ produto: 'prime', encontros: [enc('m', '', '2026-10-20', { candidatos: muitos })], hoje: '2026-10-22' }).length, CFG_TRILHAS.regras.combinado_ata.max_por_cliente)
  assert.deepEqual(descritoresCombinados({ produto: 'performance', encontros: [e1], hoje: '2026-10-22' }), [])
})

await ok('plano-cliente: Prime ganha trilha_prime + combinado_ata (executor no dados, mesmo idAcao); regerar não duplica; Performance sem regra nova nem campo novo', async () => {
  const { db } = await import('../src/lib/db.js')
  const { carregarClientes } = await import('../src/lib/equipe.js')
  const { gerarPlanoCliente, salvarPlano, idAcao } = await import('../src/lib/plano-cliente.js')
  const agora = new Date().toISOString(), hoje = new Date().toISOString().slice(0, 10)
  const addD = k => { const d = new Date(hoje + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
  for (const [c, tier] of [['Prime Co', 'Place Prime'], ['Perf Co', 'Plano Performance']]) {
    db.prepare("INSERT INTO clientes_central (cliente, status_cs, tier, canais_json, consultores_json, lideres_json, atualizado_em) VALUES (?, 'Ativo', ?, '[\"ML\"]', '{\"ML\":\"Giovanna Torres\"}', '{}', ?)").run(c, tier, agora)
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, tipo_demanda, status, data_conclusao, conteudo, arquivada) VALUES (?, 'demo', ?, 'Reunião de abertura', 'Reunião de Alinhamento', 'concluida', ?, ?, 0)").run(`enc-${c}`, c, addD(-2), ATA)
    db.prepare("INSERT INTO encontro_info (tarefa_id, cliente, tipo, por, atualizado_em) VALUES (?, ?, 'kickoff', 'Giovanna Torres', ?)").run(`enc-${c}`, c, agora)
  }
  const cli = nome => carregarClientes().find(x => x.cliente === nome)
  const p1 = gerarPlanoCliente(cli('Prime Co'), { hoje })
  const tr = p1.acoes.filter(a => a.regra === 'trilha_prime'), cb = p1.acoes.filter(a => a.regra === 'combinado_ata')
  assert.deepEqual([...tr.map(a => a.dados.passo_n)].sort(), [1, 2]); assert.equal(tr.find(a => a.dados.passo_n === 1).prazo, addD(1))
  assert.ok(tr.every(a => a.dados.executor === 'cliente' && a.dados.trilha_id === T.id && a.id === idAcao('Prime Co', 'trilha_prime', a.dados.trilha_id + '|' + a.dados.passo_n + '|enc-Prime Co')))
  assert.equal(cb.length, 2); assert.ok(cb.every(a => a.dados.executor === 'cliente'))
  const s1 = salvarPlano(p1.plano, p1.acoes), s2 = salvarPlano(p1.plano, gerarPlanoCliente(cli('Prime Co'), { hoje }).acoes)
  assert.equal(s2.novas, 0, 'regerar não duplica'); assert.equal(s2.mantidas, s1.novas + s1.mantidas)
  const p2 = gerarPlanoCliente(cli('Perf Co'), { hoje })
  assert.ok(!p2.acoes.some(a => ['trilha_prime', 'combinado_ata'].includes(a.regra)), 'Performance sem regra Prime')
  const CHAVES = ['dimensao', 'problema', 'acao', 'evidencia_tipo', 'evidencia', 'fonte', 'periodo', 'dependencia', 'indicador_inicial', 'meta', 'criterio_aceite', 'impacto', 'confianca', 'urgencia', 'esforco', 'logica', 'demanda_notion', 'refs']
  for (const a of p2.acoes) assert.deepEqual(Object.keys(a.dados).filter(k => k !== 'alinhamento_vencido'), CHAVES, `dados de ${a.regra} inalterados`)
  // ação 'encontro' (Registrar encontro) nunca vira obsoleta pelo plano
  db.prepare("INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, dados_json, status, criado_em, atualizado_em) VALUES ('PS-e0e0e0e0e0', 'Prime Co', 'encontro', '2026-10', 'Encontro', '7d', ?, '{}', 'aprovada', ?, ?)").run(hoje, agora, agora)
  salvarPlano(p1.plano, p1.acoes)
  assert.equal(db.prepare("SELECT status FROM acoes_plano WHERE id = 'PS-e0e0e0e0e0'").get().status, 'aprovada')
})

await ok('card no Notion: passo do cliente sem people, «Responsável: o cliente · consultor que acompanha»; card do time continua com people', async () => {
  const { montarPagina } = await import('../src/lib/distribuir-notion.js')
  const schema = { modoDS: false, id: 'db1' }, pm = { titulo: 'Nome', resp: { nome: 'Responsável' }, desc: { nome: 'Descrição' }, data: 'Prazo' }
  const base = { id: 'PS-abcdef1234', cliente: 'Prime Co', canal: 'Mercado Livre', regra: 'trilha_prime', titulo: 'Trilha 1/8 · Liberar acessos', horizonte: '72h', prazo: '2026-10-25', responsavel: 'Giovanna Torres', squad: '', score: 40,
    dados: { evidencia_tipo: 'fato', evidencia: 'e', fonte: 'f', periodo: 'p', problema: 'x', acao: 'Liberar', indicador_inicial: 'i', meta: 'm', criterio_aceite: 'c', logica: 'l', demanda_notion: '', refs: [], executor: 'cliente', como: ['Convite aceito'] } }
  const cli = montarPagina(base, schema, pm, true, {})
  assert.equal(cli.payload.properties['Responsável'], undefined, 'sem people'); assert.equal(cli.executor, '')
  assert.match(cli.payload.properties['Descrição'].rich_text[0].text.content, /Responsável: o cliente · consultor que acompanha: Giovanna Torres/)
  assert.ok(!cli.avisos.some(a => /Responsável a definir/.test(a)))
  assert.ok(JSON.stringify(cli.payload.children).includes('o cliente (consultor que acompanha: Giovanna Torres)'))
  const time = montarPagina({ ...base, regra: 'sem_entrega', dados: { ...base.dados, executor: undefined } }, schema, pm, true, {})
  assert.equal(time.executor, 'Giovanna Torres', 'card do time segue o critério de sempre')
})

console.log(`\n${n} verificações da trilha Prime ok.`)
