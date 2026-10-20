// Autoteste do RELATÓRIO FOCADO (14/10/2026): montarRelatorioFoco (src/lib/plano-semana-texto.js, puro) e scripts/relatorio-foco.mjs (universo, flags, envio com
// fetch STUB — nenhum POST real —, idempotência por lote_id, destino divergente, livro de registro num banco em memória).
// Rodar: node scripts/teste-relatorio-foco.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { spawnSync } = await import('node:child_process')
const { default: Database } = await import('better-sqlite3')
const { montarRelatorioFoco, auditarMensagem, lerCfgRelatorio, aberturaFoco, ABERTURA_FOCO, ABERTURA_FOCO_2, FECHO, FECHO_CURTO, ASSINATURA, NOTA, NOTA_COMPRAS, FOCO_MAX_CARACTERES } = await import('../src/lib/plano-semana-texto.js')
const { createHash } = await import('node:crypto')
const { auditarTexto } = await import('../src/lib/relatorio-seguro.js')
const { familiaCliente } = await import('../src/lib/processos.js')
const { criarEnvio } = await import('../src/lib/gatilhos-envio.js')
const { criarLivro, SCHEMA_LIVRO } = await import('../src/lib/livro-registro.js')
const F = await import('./relatorio-foco.mjs')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const R = lerCfgRelatorio()
const L = { cobertura_critica_dias: 10, lead_time_reposicao_dias: 21, min_unidades_item: 3, min_impacto_pct_gmv: 2 }
const LINK = id => `https://produto.mercadolivre.com.br/MLB-${id}-produto-_JM`
const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, permalink: LINK(id), curva: 'A', status: 'active', cobertura: 30, estoque: 60, ponto_reposicao: 40, vel_dia: 2, logistica: '', r: 1400, u: 56, r0: 1000, u0: 40, v: 2000, v0: 1800, sug: null, ...o })
const ITENS = [
  it('100', { titulo: 'Kit Pistão Anéis Motosserra 170', cobertura: 4, estoque: 8, sug: { conservador: 20, base: 26 } }),                 // perto de acabar
  it('101', { titulo: 'Sabre Saibre 14 Polegadas', r: 2200, r0: 3200 }),
  it('102', { titulo: 'Corrente Para Motosserra 3/8', status: 'paused', estoque: 0, r: 1200, u: 30, r0: 2400, u0: 60 }),                 // vendeu nos 28 d e zerou: fora do ar sem estoque
  it('103', { titulo: 'Filtro De Ar Roçadeira', status: 'paused', estoque: 5, r: 0, u: 0, r0: 900 }),                                     // pausado COM estoque: não é ruptura
  it('104', { titulo: 'Vela De Ignição Universal', status: 'under_review', estoque: 0, r: 0, u: 0, r0: 800 }),                            // em revisão: não é falta de estoque
  it('105', { titulo: 'Bobina De Ignição Roçadeira', curva: 'B', u: 12, r: 600 }),                                                       // entrega da equipe que vende
  it('106', { titulo: 'Formulário Contínuo 80 Colunas', status: 'paused', estoque: 0, r: 0, u: 0, r0: 476, u0: 1 }),                     // 1 venda no período ANTERIOR: não é ruptura recente
]
const COMPRAS = { disponivel: true, ciclo_dias: 30, seguranca_dias: 7, itens: [
  { id: '100', titulo: 'Kit Pistão Anéis Motosserra 170', quando_pedir: { agora: true, data: '2026-10-14', dias: 0 }, quanto_pedir: { conservador: 22, base: 36 }, lead_time: { dias: 21, fonte: 'premissa' }, estoque: 8 },   // já no 📦: não repete
  { id: '101', titulo: 'Sabre Saibre 14 Polegadas', quando_pedir: { agora: false, data: '2026-10-25', dias: 11 }, quanto_pedir: { conservador: 10, base: 14 }, lead_time: { dias: 21, fonte: 'premissa' }, estoque: 60 }] }
const SUBIU = { estado: 'melhorou', bruto_pct: 20, vendas_ok: true, n_itens: 1 }
const MEDIDAS = [
  { ...SUBIU, familia: 'Otimizar anúncios', data: '2026-09-12', efeito_pct: 35.2, metrica: 'vendas', confianca: 66, item_id: '101' },
  { familia: 'Imagens', data: '2026-09-15', estado: 'piorou', efeito_pct: -22, metrica: 'vendas', confianca: 70, item_id: '100' },
  { familia: 'Cadastro de produtos', data: '2026-09-02', estado: 'lancamento', efeito_pct: 0, metrica: 'vendas', confianca: null, item_id: '104', unidades: 9, dias: 14 },
  { ...SUBIU, familia: 'Corrigir anúncios', data: '2026-09-20', efeito_pct: 18, metrica: 'visitas', confianca: 85, item_id: '105' }]   // 105 também é entrega: sai só lá
const ENTREGAS = [{ item_id: '105', titulo: 'Bobina De Ignição Roçadeira', permalink: LINK('105'), dia: '2026-09-02', criado: true, semVendaAntes: false, aumento: false, pre: 0, pos: 9, unidades: 9, receita: 450, acao: 'Cadastro', familia: 'cadastro', tarefa: 'Cadastrar filtro PS-abc123', analista: 'Giovanna Torres' }]
const TAREFAS = [{ id: 'otimizar', familia: 'Otimizar anúncios', n: 3 }, { id: 'kits', familia: 'Kits', n: 1 }]
const base = (o = {}) => ({ rotulo: 'Trem Chique', hoje: '2026-10-14', itens: ITENS, entregas: ENTREGAS, limiares: L, info: { compras: COMPRAS, tarefas: TAREFAS, causa: { medidas: MEDIDAS } }, ...o })
const audita = t => auditarMensagem(t, auditarTexto, { nomesInternos: ['Giovanna Torres', 'Carla Souza'], permitidos: ['Trem Chique'] })
const secao = (t, emoji) => { const i = t.indexOf(emoji); return i < 0 ? '' : t.slice(i, t.indexOf('\n\n', i) < 0 ? undefined : t.indexOf('\n\n', i)) }

await ok('seções na ordem 📦 → 🛠️ → ✅ entre a abertura aprovada e o fecho/assinatura/nota; tem_conteudo; passa no auditor do relatório', () => {
  const r = montarRelatorioFoco(base())
  assert.deepEqual(r.secoes, [{ chave: 'estoque', conteudo: true }, { chave: 'tarefas', conteudo: true }, { chave: 'resultados', conteudo: true }])
  assert.equal(r.tem_conteudo, true); assert.deepEqual(r.conferir, [])
  assert.ok(r.texto.startsWith(`${ABERTURA_FOCO}\n\n*Estoque, ações e resultados · Trem Chique · 14/10*\n\n📦 *Estoque e ruptura*`))
  const p = ['📦 *Estoque e ruptura*', '🛠️ *O que a nossa equipe fez na sua conta*', '✅ *O que já está dando resultado*'].map(x => r.texto.indexOf(x))
  assert.ok(p.every((x, k) => x > 0 && (k === 0 || x > p[k - 1])), 'ordem das seções')
  assert.ok(r.texto.endsWith(`${FECHO}\n${ASSINATURA}\n${NOTA}`), 'faixa sem premissa extra → nota dos 28 dias')
  const alta = montarRelatorioFoco(base({ info: { compras: { ...COMPRAS, itens: COMPRAS.itens.map(x => ({ ...x, tendencia: { fator: 1.3 } })) }, tarefas: TAREFAS, causa: { medidas: MEDIDAS } } }))
  assert.ok(alta.texto.endsWith(NOTA_COMPRAS) && alta.texto.includes('o maior número inclui a alta recente das vendas'), 'premissa do maior número → nota das compras')
  assert.deepEqual(audita(r.texto), [])
  assert.ok(r.texto.length <= FOCO_MAX_CARACTERES)
})

await ok('📦: perto de acabar (mesmo construtor do semanal, com link), fora do ar por FALTA DE ESTOQUE (pausado e 0 un, com o que vendia por semana) e próximos pedidos com prazo declarado', () => {
  const e = secao(montarRelatorioFoco(base()).texto, '📦')
  // fora do Full: a quantidade é a do pedido ao fornecedor (preverCompras: 22 a 36), não a régua do Full (sugestaoFull: 20 a 26)
  assert.match(e, /Campeões de venda perto de acabar:\n• Kit Pistão Anéis Motosserra 170: tem 8 un \(~4 dias\) → sugerimos repor \*22 a 36 un\*\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-100-/)
  const full = secao(montarRelatorioFoco(base({ itens: [it('100', { ...ITENS[0], logistica: 'fulfillment' }), ...ITENS.slice(1)] })).texto, '📦')
  assert.match(full, /• Kit Pistão Anéis Motosserra 170 \(Full\): tem 8 un \(~4 dias\) → sugerimos enviar \*20 a 26 un\*/, 'no Full continua a sugestaoFull (enviar)')
  // fora do ar: FATO dos últimos 28 dias (R$ e unidades), nunca «vendia ~R$/semana» do período anterior
  assert.match(e, /Já fora do ar por falta de estoque:\n• Corrente Para Motosserra 3\/8: sem estoque e pausado; nos últimos 28 dias vendeu \*R\$ 1\.200\* \(30 unidades\)\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-102-/)
  assert.ok(!/por semana|período anterior/.test(e))
  assert.ok(!e.includes('Filtro De Ar') && !e.includes('Vela De Ignição'), 'pausado com estoque e em revisão não são ruptura')
  assert.ok(!e.includes('Formulário Contínuo'), 'sem venda nos últimos 28 dias (1 venda no período anterior) não é «já fora do ar»')
  assert.match(e, /Próximos pedidos ao fornecedor:\n• Sabre Saibre 14 Polegadas: pedir \*até 25\/10\* · \*10 a 14 un\* \(tem 60 un\)\nPrazo usado: 21 dias entre o pedido e a chegada \(premissa:/)
  assert.equal((e.match(/Kit Pistão/g) || []).length, 1, 'o que já está no «perto de acabar» não repete no pedido')
  // alinhamento com o cliente (predicado único) tira a linha
  const sem = secao(montarRelatorioFoco(base({ livre: (regra, id) => !(regra === 'anuncio_restrito' && id === '102') })).texto, '📦')
  assert.ok(!sem.includes('Corrente Para Motosserra'))
  // sem campeão perto de acabar mas com anúncio já parado: nada de «Nenhum campeão… ✅» ao lado da ruptura que já aconteceu
  const parado = secao(montarRelatorioFoco(base({ itens: ITENS.filter(i => i.id !== '100') })).texto, '📦')
  assert.ok(parado.startsWith('📦 *Estoque e ruptura*\nJá fora do ar por falta de estoque:') && !parado.includes('✅'))
  // o mesmo título em anúncios diferentes (Rotec, Damar): nome resolvido na conta inteira e a linha do pedido leva o link
  const gemeos = [it('201', { titulo: 'Kit 4 Roldanas V 50 Mm', status: 'paused', estoque: 0, r: 900, u: 9 }), it('202', { titulo: 'Kit 4 Roldanas V 50 Mm' })]
  const cg = { ...COMPRAS, itens: [{ ...COMPRAS.itens[1], id: '202', titulo: 'Kit 4 Roldanas V 50 Mm', permalink: LINK('202') }] }
  const g = secao(montarRelatorioFoco(base({ itens: gemeos, entregas: [], info: { compras: cg, tarefas: TAREFAS, causa: {} } })).texto, '📦')
  assert.match(g, /• Kit 4 Roldanas V 50 Mm: pedir \*até 25\/10\* · \*10 a 14 un\* \(tem 60 un\)\n  https:\/\/produto\.mercadolivre\.com\.br\/MLB-202-/)
  const uma = secao(montarRelatorioFoco(base({ itens: [gemeos[1]], entregas: [], info: { compras: cg, tarefas: TAREFAS, causa: {} } })).texto, '📦')
  assert.ok(!uma.includes('MLB-202'), 'título único na conta: o pedido não precisa do link')
})

await ok('✅: entregas com venda medida + SÓ as medições que subiram, com confiança e a frase de associação; a medição do anúncio que já é entrega não repete', () => {
  const v = secao(montarRelatorioFoco(base()).texto, '✅')
  assert.match(v, /• \*Criamos\* o anúncio Bobina De Ignição Roçadeira em 02\/09: desde então, \*9 unidades vendidas \(R\$ 450\)\*\./)
  assert.match(v, /• Otimizar anúncios em 12\/09 · Sabre Saibre 14 Polegadas: vendas \+35% \(confiança média\)/)
  assert.ok(v.includes('É associação no tempo, não prova de causa.'))
  assert.ok(!/−22%|Imagens|passou a vender|Corrigir anúncios/.test(v), 'piorou, lançamento sem comparação e a medição da entrega ficam fora')
  // sem medição que subiu: nada de frase de associação; só a entrega (FATO)
  const so = secao(montarRelatorioFoco(base({ info: { compras: COMPRAS, tarefas: TAREFAS, causa: { medidas: MEDIDAS.filter(m => m.estado !== 'melhorou') } } })).texto, '✅')
  assert.ok(so.includes('Criamos') && !so.includes('associação'))
})

await ok('✅ só o que VENDE hoje e subiu de fato: fora do «já fora do ar», venda nos 28 d, últimos 60 d; medição com alta bruta, vendas mantidas e confiança ≥ média; grupo = «e mais N»', () => {
  const med = m => ({ ...SUBIU, familia: 'Otimizar anúncios', data: '2026-09-12', efeito_pct: 50, metrica: 'visitas', confianca: 70, item_id: '101', ...m })
  const v = (o = {}) => secao(montarRelatorioFoco(base({ entregas: [], ...o, info: { compras: COMPRAS, tarefas: TAREFAS, causa: { medidas: o.medidas || [] } } })).texto, '✅')
  assert.match(v({ medidas: [med()] }), /Sabre Saibre 14 Polegadas: visitas \+50% \(confiança média\)/)
  assert.equal(v({ medidas: [med({ bruto_pct: -12.8 })] }), '', 'alta só relativa ao controle (Jula: visitas −13%, controle −59%) não é resultado')
  assert.equal(v({ medidas: [med({ vendas_ok: false })] }), '', 'visitas subiram mas as vendas caíram')
  assert.equal(v({ medidas: [med({ confianca: 40 })] }), '', 'confiança baixa fica fora do ✅')
  assert.equal(v({ medidas: [med({ item_id: '102' })] }), '', 'anúncio já fora do ar não está «dando resultado»')
  assert.match(v({ medidas: [med({ n_itens: 5 })] }), /Sabre Saibre 14 Polegadas e mais 4 anúncios: visitas \+50%/, 'efeito do grupo, nunca só do 1º nome')
  const ent = o => ({ ...ENTREGAS[0], ...o })
  assert.equal(v({ entregas: [ent({ item_id: '102', titulo: 'Corrente Para Motosserra 3/8' })] }), '', 'entrega do anúncio que zerou o estoque (Click Beauty/ND Tintas): só no 📦')
  assert.equal(v({ entregas: [ent({ item_id: '103', titulo: 'Filtro De Ar Roçadeira' })] }), '', 'sem venda nos últimos 28 dias')
  assert.equal(v({ entregas: [ent({ dia: '2026-06-03' })] }), '', 'entrega de junho (Bima) fica fora: janela de 60 dias')
  const t = montarRelatorioFoco(base({ entregas: [ent({ item_id: '102', titulo: 'Corrente Para Motosserra 3/8', permalink: LINK('102') })] })).texto
  assert.equal((t.match(/Corrente Para Motosserra/g) || []).length, 1, 'o anúncio aparece uma vez só na mensagem')
})

await ok('sem nome de analista nem tipo cru: o 🛠️ fala por família (familiaCliente) e a entrega não leva tarefa/analista', () => {
  const crua = familiaCliente('Demanda interna XPTO-77')
  assert.equal(crua.nome, 'Outras ações')
  const r = montarRelatorioFoco(base({ info: { compras: COMPRAS, tarefas: [...TAREFAS, { id: crua.id, familia: crua.nome, n: 2 }], causa: { medidas: MEDIDAS } } }))
  assert.match(secao(r.texto, '🛠️'), new RegExp(`Tarefas concluídas no Mercado Livre nos últimos ${R.foco_tarefas_dias} dias:\\n• Otimizar anúncios: 3 tarefas concluídas\\n• Kits: 1 tarefa concluída\\n• Outras ações: 2 tarefas concluídas`))
  assert.ok(!/Giovanna|XPTO|PS-abc123|Cadastrar filtro/.test(r.texto))
  assert.deepEqual(audita(r.texto), [])
})

await ok('vazios honestos: Notion não lido ≠ zero; zero confirmado = a seção some + CONFERIR; nada medido = sem ✅ (nunca «em medição» inventado); abertura, título e fecho só do que entrou', () => {
  const nada = { compras: { disponivel: true, ciclo_dias: 30, seguranca_dias: 7, itens: [] }, tarefas: null, causa: { medidas: [], outras: { sem_alta: 0, em_medicao: 0 } } }
  const r = montarRelatorioFoco(base({ itens: [it('101')], entregas: [], info: nada }))
  assert.equal(r.tem_conteudo, false)
  assert.deepEqual(r.secoes, [{ chave: 'estoque', conteudo: false }, { chave: 'tarefas', conteudo: false }])
  assert.ok(r.texto.includes('📦 *Estoque e ruptura*\nNenhum campeão de vendas perto de acabar pelo ritmo dos últimos 28 dias ✅\n\n'))
  assert.ok(r.texto.includes('🛠️ *O que a nossa equipe fez na sua conta*\nSem a leitura das tarefas (não quer dizer que nada foi feito).'))
  assert.ok(!/em medição|resultado|costuma aparecer|✅ \*/.test(r.texto.replace('pelo ritmo dos últimos 28 dias ✅', '')), 'nada medido nem entregue: sem a seção, sem promessa')
  assert.ok(r.texto.startsWith(aberturaFoco(['estoque', 'tarefas'])) && r.texto.includes('*Estoque e ações · Trem Chique · 14/10*'))
  assert.ok(r.texto.endsWith(`${FECHO_CURTO}\n${ASSINATURA}`), 'sem nada a pedir: fecho curto, sem «data prevista» nem nota de estimativa')
  const med = montarRelatorioFoco(base({ itens: [it('101')], entregas: [], info: { ...nada, causa: { medidas: [], outras: { sem_alta: 9, em_medicao: 2 } } } }))
  assert.ok(med.texto.includes('⏳ *Resultados em medição*\n2 ações seguem em medição; quando houver venda medida, ela aparece aqui.') && !med.texto.includes('dando resultado'))
  assert.ok(med.texto.startsWith(aberturaFoco(['estoque', 'tarefas', 'medicao'])) && med.secoes.at(-1).conteudo === false)
  const zero = montarRelatorioFoco(base({ itens: [it('101')], entregas: [], info: { ...nada, tarefas: [] } }))
  assert.ok(!zero.texto.includes('🛠️') && zero.texto.startsWith(aberturaFoco(['estoque'])) && zero.texto.includes('*Estoque · Trem Chique · 14/10*'))
  assert.deepEqual(zero.secoes.map(s => s.chave), ['estoque'])
  assert.ok(montarRelatorioFoco(base({ info: { compras: COMPRAS, tarefas: [], causa: { medidas: MEDIDAS } } })).texto.startsWith(ABERTURA_FOCO_2))
  assert.ok(zero.conferir.some(c => /nenhuma tarefa do Mercado Livre concluída nos últimos 30 dias/.test(c)))
  assert.ok(zero.conferir.every(c => !zero.texto.includes(c)), 'CONFERIR nunca vai ao texto')
  // só tarefas lidas já é conteúdo; previsão de compras indisponível = CONFERIR, nunca «nenhum pedido»
  const t = montarRelatorioFoco(base({ itens: [it('101')], entregas: [], info: { tarefas: TAREFAS, causa: {} } }))
  assert.equal(t.tem_conteudo, true); assert.ok(t.conferir.some(c => /previsão de compras indisponível/.test(c)))
  assert.deepEqual(audita(r.texto), []); assert.deepEqual(audita(zero.texto), [])
})

await ok(`teto de ${FOCO_MAX_CARACTERES} caracteres: corta linhas inteiras com «e mais N», nunca no meio de uma linha`, () => {
  // títulos iguais nas 6 primeiras palavras (variações): o nome vira começo…fim (~70 caracteres); links do tamanho dos reais
  const longo = k => `Produto Campeão Com Título Bem Comprido Para Ocupar Espaço Na Mensagem Do Cliente Variação ${k}`, LINK_LONGO = id => `https://produto.mercadolivre.com.br/MLB-${id}000000-produto-campeao-com-titulo-bem-comprido-para-ocupar-espaco-_JM`
  const itens = [...Array(12)].map((_, k) => it(`5${k}`, { titulo: longo(k), permalink: LINK_LONGO(`5${k}`), cobertura: 3, estoque: 5, logistica: 'fulfillment', sug: { conservador: 30, base: 40 } }))
    .concat([...Array(8)].map((_, k) => it(`6${k}`, { titulo: `Fora ${longo(k)}`, permalink: LINK_LONGO(`6${k}`), status: 'paused', estoque: 0, r: 3000, u: 30 })))
  const info = { compras: { disponivel: true, ciclo_dias: 30, seguranca_dias: 7, itens: [...Array(8)].map((_, k) => ({ id: `7${k}`, titulo: `Pedido ${longo(k)}`, quando_pedir: { agora: true, dias: 0 }, quanto_pedir: { conservador: 10, base: 20 }, lead_time: { dias: 21, fonte: 'premissa' }, estoque: 3 })) },
    tarefas: [...Array(9)].map((_, k) => ({ id: `f${k}`, familia: `Família ${k}`, n: 9 - k })), causa: { medidas: [] } }
  const livre = montarRelatorioFoco(base({ itens, info, maxCaracteres: Infinity })), r = montarRelatorioFoco(base({ itens, info }))
  assert.ok(livre.texto.length > FOCO_MAX_CARACTERES, 'o caso de teste precisa estourar o teto')
  assert.ok(r.texto.length <= FOCO_MAX_CARACTERES, `texto com ${r.texto.length}`)
  const inteiras = new Set(livre.texto.split('\n'))
  for (const l of r.texto.split('\n')) assert.ok(inteiras.has(l) || /^• e mais \d+ /.test(l), `linha cortada: ${l.slice(0, 60)}`)
  assert.ok(/• e mais \d+ produtos/.test(r.texto) && /• e mais \d+ anúncios/.test(r.texto))
  assert.ok(r.texto.endsWith(`${FECHO}\n${ASSINATURA}\n${NOTA}`), 'o fecho nunca é cortado')
  assert.deepEqual(r.conferir, [])
})

await ok('entregas (gatilhos-real.dadosPlanoSemana, banco em memória): criação só pelo anúncio criado (nunca o anúncio-fonte); recém-criado nunca «não vinha vendendo»; «triplicou» só com os 28 dias antes inteiros; família da tarefa', async () => {
  const { db } = await import('../src/lib/db.js'); assert.equal(db.name, ':memory:')
  const { dadosPlanoSemana } = await import('../src/lib/gatilhos-real.js')
  const C = 'Entregas Teste', item = db.prepare("INSERT INTO meli_item (cliente, item_id, titulo, status, estoque, criado_em) VALUES (?, ?, ?, 'active', 10, ?)")
  const venda = db.prepare('INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?, ?, ?, ?, ?)'), coleta = db.prepare('INSERT INTO meli_coleta_dia (cliente, dia, pedidos, coletado_em) VALUES (?, ?, 1, ?)')
  for (let d = new Date('2026-05-01T12:00:00Z'); d <= new Date('2026-10-13T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) coleta.run(C, d.toISOString().slice(0, 10), d.toISOString())
  const vende = (id, dias, u, r) => dias.forEach(dia => venda.run(C, id, dia, u, r))
  item.run(C, 'MLB1', 'Bloqueador De Odores Catalogo', '2022-12-27T10:00:00Z'); item.run(C, 'MLB2', 'Esfrebom Novo', '2026-09-03T10:00:00Z')   // Moema: anúncio-fonte e o criado
  vende('MLB1', ['2026-08-20'], 1, 34); vende('MLB1', ['2026-09-05', '2026-09-08', '2026-09-12', '2026-09-15', '2026-09-20', '2026-09-25', '2026-09-30', '2026-10-05', '2026-10-08', '2026-10-10'], 1, 34)
  item.run(C, 'MLB3', 'Mandril 1/2', '2026-08-11T10:00:00Z'); vende('MLB3', ['2026-08-15', '2026-08-25', '2026-09-10'], 5, 150)                   // Bima: duplicado no dia da tarefa
  item.run(C, 'MLB4', 'Fio Náutico 5mm', '2026-08-20T10:00:00Z'); vende('MLB4', ['2026-08-22', '2026-09-02', '2026-09-12'], 5, 170)              // Jula: teste A/B no dia em que nasceu
  item.run(C, 'MLB5', 'Shampoo Absolut', '2026-08-11T10:00:00Z'); vende('MLB5', ['2026-08-15'], 1, 70); vende('MLB5', ['2026-08-28', '2026-09-02', '2026-09-08', '2026-09-15'], 2, 140)   // Click: 14 dias de vida
  item.run(C, 'MLB6', 'Coleira Antiga', '2025-01-01T10:00:00Z'); vende('MLB6', ['2026-09-05', '2026-09-12', '2026-09-20'], 4, 160)               // controle: otimizado e passou a vender
  const m = (data, tipo, titulo, itens) => ({ estado: 'lancamento', data, tipo, titulo, itens })
  const medidas = [m('2026-09-03', 'Cadastro de Produtos', 'Criar anúncio fora de catalogo, já otimizado', ['MLB2', 'MLB1']), m('2026-08-11', '', 'Duplicar Anúncio: 4339059128', ['MLB3']),
    m('2026-08-20', 'Teste A/B', 'Teste A/B', ['MLB4']), m('2026-08-25', 'Otimizar anúncios', 'Otimizar', ['MLB5']), m('2026-09-01', 'Otimizar anúncios', 'Otimizar', ['MLB6']),
    { estado: 'melhorou', data: '2026-09-20', tipo: 'Duplicação de Títulos', titulo: 'Otimizar', itens: ['MLB6', 'MLB3'], efeito_pct: 114, efeito_bruto_pct: -12.8, metricas: { unidades: { antes: 0.11, depois: 0 } }, confianca: { score: 66 } }]
  const diag = { disponivel: true, cliente: C, hoje: '2026-10-14', resumo: { gmv: 0, pedidos: 0, variacao: { pct: null } }, itens: [{ id: 'MLB6', titulo: 'Coleira Antiga' }], data_quality: {} }
  const d = dadosPlanoSemana(C, { diag, medidas, entregasMax: Infinity })
  assert.deepEqual(d.entregas.map(e => [e.item_id, e.criado, e.semVendaAntes, e.aumento, e.familia]).sort(), [['MLB3', true, false, false, 'duplicacao'], ['MLB6', false, true, false, 'otimizar']],
    'MLB1 (fonte da criação), MLB2 (criado, sem venda), MLB4 (nasceu com a tarefa) e MLB5 (14 dias de vida) ficam fora')
  assert.equal(dadosPlanoSemana(C, { diag, medidas }).entregas.length, 2, 'o semanal continua com até 3')
  const med = d.relatorio.causa.medidas.find(x => x.estado === 'melhorou')
  assert.deepEqual([med.bruto_pct, med.vendas_ok, med.n_itens, med.item_id], [-12.8, false, 2, 'MLB6'], 'alta só relativa e vendas caindo chegam ao texto para o ✅ descartar; grupo de 2 anúncios')
})

// ── script ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const G1 = '120363012345678901@g.us', G2 = '120363099999999999@g.us'
const nt = (d, o = {}) => JSON.stringify({ liberado_por: 'David do Valle', liberado_em: '2026-10-13T12:00:00Z', canais: { whatsapp: { ligado: true, destino: d } }, ...o })
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex')

await ok('universo: só Ativo, não prospect, com grupo do ML (…@g.us), WhatsApp ligado, liberado por líder e integração ML de fato; pulados com motivo', () => {
  const central = [
    { cliente: 'Acme', status: 'Ativo', notificacao_json: nt(G1) },
    { cliente: '[Comercial] Prospect', status: 'Ativo', notificacao_json: nt(G1) },
    { cliente: 'Velha', status: 'Desligado', notificacao_json: nt(G1) },
    { cliente: 'Congelada', status: 'Congelado', notificacao_json: nt(G1) },
    { cliente: 'SemGrupo', status: 'Ativo', notificacao_json: '' },
    { cliente: 'Telefone', status: 'Ativo', notificacao_json: nt('5511999998888') },
    { cliente: 'SemML', status: 'Ativo', notificacao_json: nt(G2) },
    { cliente: 'Quebrada', status: 'Ativo', notificacao_json: nt(G2) },
    { cliente: 'Desligado', status: 'Ativo', notificacao_json: nt(G1, { canais: { whatsapp: { ligado: false, destino: G1 } } }) },    // Pavio Decor: grupo sem liberação
    { cliente: 'NaoLiberado', status: 'Ativo', notificacao_json: nt(G1, { liberado_por: '' }) }]
  const u = F.universo(central, { integracao: c => c === 'SemML' ? { ok: false, motivo: 'coleta_atrasada' } : c === 'Quebrada' ? (() => { throw new Error('x') })() : { ok: true, motivo: '' } })
  assert.deepEqual(u.alvos, [{ cliente: 'Acme', destino: G1 }])
  assert.deepEqual(u.pulados, [{ cliente: 'SemGrupo', motivo: 'sem_grupo' }, { cliente: 'Telefone', motivo: 'sem_grupo' }, { cliente: 'SemML', motivo: 'sem_integracao:coleta_atrasada' }, { cliente: 'Quebrada', motivo: 'sem_integracao:integracao_indisponivel' },
    { cliente: 'Desligado', motivo: 'canal_desligado' }, { cliente: 'NaoLiberado', motivo: 'nao_liberado' }])
  // prévia: sem dados / bloqueado / sem conteúdo / erro viram pulados; o item leva lote_id, hash e o texto exato
  const m = F.montarPrevia(['A', 'B', 'C', 'D', 'F', 'E'].map(cliente => ({ cliente, destino: G1 })), { data: '2026-10-14', gerar: c => ({
    A: { disponivel: true, rotulo: 'Aa', texto: 'oi', secoes: [], conferir: [], tem_conteudo: true }, B: { disponivel: false, motivo: 'sem_coleta' },
    C: { disponivel: true, bloqueado: true, motivo: 'conteudo:promessa', texto: '' }, D: { disponivel: true, texto: 'x', tem_conteudo: false, conferir: [] },
    F: { disponivel: true, rotulo: 'F', texto: 'y', secoes: [], conferir: ['nenhuma tarefa do Mercado Livre concluída nos últimos 30 dias (Notion lido): conferir com a equipe'], tem_conteudo: true } }[c] || (() => { throw new TypeError('y') })()) })
  assert.deepEqual(m.itens.map(x => [x.cliente, x.rotulo, x.lote_id, x.texto, x.chars, x.hash]), [['A', 'Aa', 'foco-20261014-a', 'oi', 2, sha('oi')]])
  assert.deepEqual(m.pulados.map(x => x.motivo), ['sem_dados:sem_coleta', 'bloqueado:conteudo:promessa', 'sem_conteudo', 'conferir', 'erro:TypeError'], 'CONFERIR segura o envio até a equipe conferir')
  assert.equal(F.loteId('2026-10-14', 'Áurea Cosméticos'), 'foco-20261014-aurea-cosmeticos')
  // o .txt mascara o destino
  const txt = F.textoPrevia({ data: '2026-10-14', itens: m.itens.map(x => ({ ...x, secoes: [{ chave: 'estoque', conteudo: true }] })), pulados: m.pulados })
  assert.ok(!txt.includes(G1) && txt.includes(F.mascarar(G1)))
})

await ok('envio exige --enviar --confirmar --arquivo; sem as três, nada sai (CLI sai com código 2 antes de qualquer rede)', () => {
  assert.equal(F.lerArgs([]).modo, 'previa')
  for (const a of [['--enviar'], ['--enviar', '--confirmar'], ['--enviar', '--arquivo', 'p.json'], ['--confirmar', '--arquivo', 'p.json'], ['--arquivo', 'p.json'], ['--enviar', '--confirmar', '--arquivo', '--x']])
    assert.ok(F.lerArgs(a).erro, a.join(' '))
  assert.deepEqual(F.lerArgs(['--enviar', '--confirmar', '--arquivo', 'p.json']), { modo: 'enviar', arquivo: 'p.json' })
  const r = spawnSync(process.execPath, ['scripts/relatorio-foco.mjs', '--enviar', '--arquivo', '/nao/existe.json'], { encoding: 'utf8', env: { ...process.env, PLACE_GATILHOS_URL: 'http://127.0.0.1:9', PLACE_GATILHOS_SECRET: '' } })
  assert.equal(r.status, 2); assert.match(r.stderr, /exige --enviar --confirmar --arquivo/)
})

await ok('envio (fetch STUB): texto EXATO do arquivo, tipo teste, 5 s entre envios; reconfere central (status, ligado/liberado, destino, integração) e texto (hash, cabeçalho do cliente, auditor); idempotente pelo registro E pelo livro; livro honesto', async () => {
  const posts = [], fetch = async (url, o) => { posts.push({ url, corpo: JSON.parse(o.body), chave: o.headers['x-place-key'] }); return { ok: !JSON.parse(o.body).texto.includes('FALHA'), status: JSON.parse(o.body).texto.includes('FALHA') ? 500 : 200 } }
  const envio = criarEnvio({ env: { PLACE_GATILHOS_URL: 'https://n8n.exemplo.test', PLACE_GATILHOS_SECRET: 's'.repeat(40) }, fetch, webhook: { caminho: '/webhook/place-gatilhos' } })
  const enviar = ({ lote_id, rotulo, assunto, texto, destino }) => envio.enviar({ lote: { id: lote_id, cliente: rotulo, tipo: 'teste', titulo: assunto, texto }, notificacao: { canais: { whatsapp: { ligado: true, destino } } } })
  const h = new Database(':memory:'); h.exec(SCHEMA_LIVRO); const livro = criarLivro({ handle: h, agora: () => '2026-10-14T12:00:00.000Z' })
  const msg = (rotulo, corpo) => `${ABERTURA_FOCO}\n\n*Estoque, ações e resultados · ${rotulo} · 14/10*\n\n📦 *Estoque e ruptura*\n${corpo}\n\n${FECHO}\n${ASSINATURA}`
  const central = { Acme: { status: 'Ativo', notificacao_json: nt(G1, { rotulo: 'Acme Store' }) }, Beta: { status: 'Ativo', notificacao_json: nt(G2) }, Gama: { status: 'Ativo', notificacao_json: nt(G2) },
    Delta: { status: 'Ativo', notificacao_json: nt(G1) }, Desl: { status: 'Ativo', notificacao_json: nt(G1, { canais: { whatsapp: { ligado: false, destino: G1 } } }) }, Inativo: { status: 'Desligado', notificacao_json: nt(G1) },
    SemML: { status: 'Ativo', notificacao_json: nt(G1) }, Hash: { status: 'Ativo', notificacao_json: nt(G1) }, Livro: { status: 'Ativo', notificacao_json: nt(G1) } }
  const it = (cliente, destino, texto, o = {}) => ({ cliente, rotulo: cliente, destino, texto, hash: sha(texto), ...o })
  const tA = msg('Acme Store', 'Texto aprovado da Acme ✅'), tB = msg('Beta', 'Texto da Beta')
  const previa = { data: '2026-10-14', itens: [
    it('Acme', G1, tA, { rotulo: 'Acme Store' }), it('Beta', G2, tB), it('Gama', G1, msg('Gama', 'Texto da Gama')), it('Delta', G1, msg('Delta', 'FALHA no n8n')),
    it('[Comercial] X', G1, msg('X', 'nunca')), it('Desl', G1, msg('Desl', 'canal desligado')), it('Inativo', G1, msg('Inativo', 'inativo')), it('SemML', G1, msg('SemML', 'sem ML')),
    it('Hash', G1, msg('Hash', 'texto mexido depois da prévia'), { hash: sha('outro') }), it('Livro', G1, msg('Livro', 'já está no livro'))] }
  const esperas = [], salvos = [], registro = {}
  const deps = { previa, hoje: '2026-10-14', registro, enviar, livro, centralDe: c => central[c] || null, integracao: c => c === 'SemML' ? { ok: false, motivo: 'coleta_atrasada' } : { ok: true },
    auditar: (t, { cliente, rotulo }) => auditarMensagem(t, auditarTexto, { nomesInternos: ['Giovanna Torres', 'Carla Souza'], permitidos: [cliente, rotulo] }), jaNoLivro: ref => ref === 'foco:foco-20261014-livro',
    salvarRegistro: r => salvos.push(JSON.stringify(r)), esperar: async ms => { esperas.push(ms) }, agora: () => '2026-10-14T12:00:00.000Z' }
  const r1 = await F.enviarPrevia(deps)
  assert.deepEqual(r1.enviados.map(x => x.lote_id), ['foco-20261014-acme', 'foco-20261014-beta'])
  assert.deepEqual(r1.pulados.map(x => [x.cliente, x.motivo]), [['Gama', 'destino_divergente'], ['Delta', 'falhou:n8n_500'], ['[Comercial] X', 'item_invalido'], ['Desl', 'canal_desligado'],
    ['Inativo', 'status_inelegivel'], ['SemML', 'sem_integracao:coleta_atrasada'], ['Hash', 'hash_divergente'], ['Livro', 'ja_enviado']])
  assert.equal(posts.length, 3, 'só Acme, Beta e Delta chegam ao n8n')
  assert.deepEqual(esperas, [5000, 5000], '5 s entre um POST e o seguinte')
  assert.equal(posts[0].url, 'https://n8n.exemplo.test/webhook/place-gatilhos')
  assert.equal(posts[0].chave, 's'.repeat(40))
  assert.deepEqual({ ...posts[0].corpo, texto_html: undefined, whatsapp_partes: undefined, link: undefined }, { lote_id: 'foco-20261014-acme', cliente_rotulo: 'Acme Store', tipo: 'teste', assunto: 'Estoque, ações e resultados · 14/10/2026', texto: tA, canais: { whatsapp: { ligado: true, destino: G1 } }, texto_html: undefined, whatsapp_partes: undefined, link: undefined })
  assert.deepEqual(Object.keys(registro), ['foco-20261014-acme', 'foco-20261014-beta'], 'falha não marca como enviado')
  assert.equal(salvos.length, 2, 'registro salvo a cada envio')
  const linhas = h.prepare("SELECT * FROM registro_cliente WHERE tipo = 'relatorio_enviado' ORDER BY seq").all()
  assert.deepEqual(linhas.map(l => [l.cliente, l.ref, l.resumo]), [['Acme', 'foco:foco-20261014-acme', F.RESUMO_LIVRO], ['Beta', 'foco:foco-20261014-beta', F.RESUMO_LIVRO]])
  assert.match(F.RESUMO_LIVRO, /aceito pelo n8n.*sem recibo de entrega/); assert.deepEqual(JSON.parse(linhas[0].dados_json), { lote_id: 'foco-20261014-acme', caracteres: tA.length, estado: 'enviado_n8n', recibo: false })
  assert.ok(linhas.every(l => !/@g\.us|\d{12,}/.test(JSON.stringify(l).replace(/[0-9a-f]{64}/g, ''))), 'sem destino nem telefone no livro')
  assert.match(linhas[0].prova, /^sha256:[0-9a-f]{64}$/)
  // segunda passada com o MESMO registro: nada repete (idempotência por lote_id); Delta tenta de novo (não saiu)
  const r2 = await F.enviarPrevia({ ...deps, esperar: async () => {} })
  assert.deepEqual(r2.enviados, []); assert.deepEqual(r2.pulados.filter(x => x.motivo === 'ja_enviado').map(x => x.cliente), ['Acme', 'Beta', 'Livro'])
  assert.equal(posts.length, 4, 'só o Delta (que falhou) foi tentado de novo')
  // registro perdido: o livro (ref foco:<lote_id>) ainda barra o reenvio
  const r3 = await F.enviarPrevia({ ...deps, registro: {}, jaNoLivro: ref => deps.jaNoLivro(ref) || !!h.prepare("SELECT 1 FROM registro_cliente WHERE tipo = 'relatorio_enviado' AND ref = ?").get(ref), esperar: async () => {} })
  assert.ok(['Acme', 'Beta'].every(c => r3.pulados.some(x => x.cliente === c && x.motivo === 'ja_enviado'))); assert.equal(posts.length, 5, 'de novo só o Delta')
  // arquivo adulterado: textos trocados entre clientes (hash recalculado) e nome de analista injetado — nada sai
  const posts0 = posts.length, troca = { data: '2026-10-14', itens: [it('Gama', G2, tB), it('Beta', G2, msg('Beta', 'Fale com Giovanna Torres'))] }
  const r4 = await F.enviarPrevia({ ...deps, previa: troca, registro: {}, jaNoLivro: () => false })
  assert.deepEqual(r4.pulados.map(x => [x.cliente, x.motivo]), [['Gama', 'cabecalho_divergente'], ['Beta', 'bloqueado:conteudo']]); assert.equal(posts.length, posts0)
  // prévia de outro dia (números velhos) e arquivo sem data/itens = erro antes de qualquer POST
  await assert.rejects(F.enviarPrevia({ ...deps, previa: { ...previa, data: '2026-10-04' } }), /prévia vencida/)
  await assert.rejects(F.enviarPrevia({ ...deps, previa: { itens: [] } }), /prévia inválido/)
  assert.equal(posts.length, posts0)
})

await ok('poucas tarefas (1 a 3 em 30 dias): a seção 🛠️ sai, vira nota_interna e NÃO retém o envio; 4 ou mais continua', () => {
  const pouco = montarRelatorioFoco(base({ info: { compras: COMPRAS, tarefas: [{ id: 'kits', familia: 'Kits', n: 2 }], causa: { medidas: MEDIDAS } } }))
  assert.ok(!pouco.texto.includes('🛠️')); assert.ok(!pouco.secoes.some(x => x.chave === 'tarefas')); assert.equal(pouco.conferir.length, 0, 'não retém')
  assert.match(pouco.nota_interna[0], /só 2 tarefas concluídas/); assert.ok(pouco.texto.includes('💬 Esse resumo ajuda no seu dia a dia?'), 'a pergunta fecha a mensagem')
  const ok4 = montarRelatorioFoco(base()); assert.ok(ok4.texto.includes('🛠️')); assert.deepEqual(ok4.nota_interna, [])
})

console.log(`\n${n} verificações do relatório focado ok.`)
