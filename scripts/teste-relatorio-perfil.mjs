// Autoteste do RELATÓRIO PERSONALIZADO (Etapa 3, 13/10/2026): src/lib/plano-semana-texto.js com perfil (puro), divisão do WhatsApp, concorrentes cadastrados
// (src/lib/concorrencia.js, banco em memória), fluxo n8n (partes + recibo único) e a fiação no lote semanal dos gatilhos (stubs; nada sai).
// Cobre: blocos pedidos sobem na ordem do perfil; sem perfil = só a base fixa na ordem padrão; sem perfil nenhum (null) = texto do tom aprovado, idêntico; didático com
// «O que isso significa» + glossário; concorrência sem dado = frase honesta; compras com prazo declarado; causa com rótulo honesto; Ads sem tom de culpa; auditor passa;
// divisão em partes sem cortar bloco; relatório só sai com bloco que traga dado.
// Rodar: node scripts/teste-relatorio-perfil.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { montarPlanoSemanal, dividirMensagem, lerCfgRelatorio, auditarMensagem, ABERTURA, FECHO, ASSINATURA, NOTA, NOTA_COMPRAS, premissaCompras } from '../src/lib/plano-semana-texto.js'
import { auditarTexto } from '../src/lib/relatorio-seguro.js'
import { criarConcorrencia, concorrentesDoCliente, SCHEMA_CONCORRENCIA } from '../src/lib/concorrencia.js'
import { criarGatilhos, lerConfig, validarConfig } from '../src/lib/gatilhos.js'
import { lerConfig as lerPerfilCfg } from '../src/lib/perfil-informacao.js'
import { familiaCliente } from '../src/lib/processos.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const R = lerCfgRelatorio(), PCFG = lerPerfilCfg()
const L = { cobertura_critica_dias: 10, lead_time_reposicao_dias: 21, min_unidades_item: 3 }
const LINK = id => `https://produto.mercadolivre.com.br/MLB-${id}-produto-_JM`
const it = (id, o = {}) => ({ id, titulo: `Produto ${id}`, permalink: LINK(id), curva: 'A', status: 'active', cobertura: 30, estoque: 60, ponto_reposicao: 40, vel_dia: 2, logistica: '', r: 1400, u: 56, r0: 1000, u0: 40, v: 2000, v0: 1800, preco: 25, sug: null, ...o })
const audita = t => auditarMensagem(t, auditarTexto, { nomesInternos: ['Giovanna Torres', 'Carla Souza'], permitidos: ['Trem Chique'] })
const TODOS = Object.keys(PCFG.temas)
// perfil efetivo como perfil-informacao.ler devolve: pedidos no topo + o resto da base fixa
const perfilDe = (temas, nivel = 'padrao', fonte = 'equipe') => ({ temas, nivel, fonte, ordem: [...new Set([...temas, ...PCFG.base_fixa])] })
const SEM_PERFIL = { temas: [], nivel: 'padrao', fonte: 'padrao', ordem: [...PCFG.base_fixa] }
// mundo rico: estoque apertado (📦), próximo pedido (🛒), entregas, medidas, tarefas, plano, Ads, promoções, catálogo e concorrentes
const ITENS = [
  it('100', { titulo: 'Kit Pistão Anéis Motosserra 170', cobertura: 4, estoque: 8, r: 3000, r0: 2800, u: 60, u0: 55, sug: { conservador: 20, base: 26 } }),
  it('101', { titulo: 'Sabre Saibre 14 Polegadas', r: 2200, r0: 3200, u: 40, u0: 58 }),                                 // curva A caindo 31%
  it('102', { titulo: 'Corrente Para Motosserra 3/8', curva: 'B', r: 800, r0: 700, u: 30, u0: 25, v: 900, v0: 1500 }),  // visitas −40% (regra queda_exposicao)
  it('103', { titulo: 'Filtro De Ar Roçadeira', curva: 'B', r: 500, r0: 300, u: 20, u0: 10, v: 1000, v0: 400, catalogo: true, preco: 39.9, ptw: { status: 'competing', preco_para_ganhar: 36.5, lido_em: '2026-10-12' } }),
  it('104', { titulo: 'Vela De Ignição Universal', curva: 'C', r: 0, r0: 50, u: 0, u0: 2, v: 340, v0: 300 }),          // visitas sem venda
]
const INFO = {
  compras: { disponivel: true, ciclo_dias: 30, seguranca_dias: 7, itens: [
    { id: '100', titulo: 'Kit Pistão Anéis Motosserra 170', quando_pedir: { agora: true, data: '2026-10-13', dias: 0 }, quanto_pedir: { conservador: 22, base: 36 }, lead_time: { dias: 21, fonte: 'premissa' }, estoque: 8, cobertura_dias: 4 },
    { id: '101', titulo: 'Sabre Saibre 14 Polegadas', quando_pedir: { agora: false, data: '2026-10-25', dias: 12 }, quanto_pedir: { conservador: 10, base: 14 }, lead_time: { dias: 21, fonte: 'premissa' }, estoque: 60, cobertura_dias: 30 },
    { id: '102', titulo: 'Corrente Para Motosserra 3/8', quando_pedir: { agora: false, data: '2026-12-30', dias: 78 }, quanto_pedir: { conservador: 5, base: 6 }, lead_time: { dias: 21, fonte: 'premissa' }, estoque: 60, cobertura_dias: 90 }] },
  tarefas: [{ id: 'otimizar', familia: 'Otimizar anúncios', n: 3 }, { id: 'oferta_relampago', familia: 'Oferta Relâmpago', n: 1 }],
  causa: { funil: { visitas_pct: 8.4, conv_antes: 2.1, conv_depois: 2.4, ticket_pct: -3.2 }, outras: { sem_alta: 2, em_medicao: 1 }, medidas: [
    { familia: 'Otimizar anúncios', data: '2026-09-12', estado: 'melhorou', efeito_pct: 35.2, metrica: 'vendas', confianca: 66, preco_junto: false, reversao: false, item_id: '101' },
    { familia: 'Cadastro de produtos', data: '2026-09-02', estado: 'lancamento', efeito_pct: 0, metrica: 'vendas', confianca: null, item_id: '103', unidades: 9, dias: 14 }] },
  acoes: [{ regra: 'anuncio_queda_exposicao_anuncio', item_id: '102', status: 'proposta' }, { regra: 'anuncio_ads_reduzir', item_id: '102', status: 'proposta' },
    { regra: 'anuncio_ads_escalar', item_id: '101', status: 'aprovada' }, { regra: 'anuncio_duplicacao_estrategica', item_id: '100', status: 'aprovada' }, { regra: 'anuncio_estoque_ruptura', item_id: '100', status: 'aprovada' }],
  ads: { custo: 694.73, receita: 2965.57, roas: 4.27, anterior: { custo: 500, roas: 3.9 } },
  promocoes: { lida_em: '2026-10-13', parcial: false, elegiveis: 12, no_ar: [{ item_id: '101', nome: 'Semana do Campo', fim: '2026-10-16T23:59:59-03:00', titulo: 'Sabre Saibre 14 Polegadas' }, { item_id: '102', nome: 'Outubro', fim: '2026-10-31T23:59:59-03:00', titulo: 'Corrente Para Motosserra 3/8' }] },
  concorrentes: [{ item_id: '101', url: 'https://produto.mercadolivre.com.br/MLB-999-x', preco: 189.9, observado_em: '2026-10-10' }],
}
const ENTREGAS = [{ titulo: 'Filtro De Ar Roçadeira', permalink: '', dia: '2026-09-02', criado: true, semVendaAntes: false, aumento: false, pre: 0, pos: 9, unidades: 9, receita: 450, acao: 'Cadastro' }]
const base = (o = {}) => ({ rotulo: 'Trem Chique', hoje: '2026-10-13', resumo: { gmv: 7700, pedidos: 140, variacao_pct: 4.2, unidades: 150, ticket: 55 }, itens: ITENS, fullParado: [], entregas: ENTREGAS, custosInformados: true, limiares: L, info: INFO, ...o })
const titulos = t => [...t.matchAll(/^(?:\*\d+\.\* )?(\S+) \*[^*\n]+\*$/gm)].map(m => m[1])     // emojis dos blocos, na ordem em que aparecem

await ok('blocos PEDIDOS sobem na ordem do perfil (Trem Chique: vendas, estoque, causa e efeito, ações); o resto da base fixa vem depois; sem perfil nenhum o texto é o do tom aprovado', () => {
  // sem ponto urgente no 🎯 (Pistão com 15 dias: vai ao 🔄), a ordem é a do perfil
  const semUrg = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'estoque_reposicao', 'causa_efeito', 'acoes_realizadas']), itens: ITENS.map(i => i.id === '100' ? { ...i, cobertura: 15 } : i) }))
  assert.deepEqual(semUrg.secoes.map(s => s.chave), ['estatisticas', 'plano', 'causa', 'entregas', 'acoes_semana', 'compras']); assert.deepEqual(semUrg.blocos, ['ciclo'])
  // ruptura no 🎯 (Pistão com 4 dias): o plano sobe para logo depois do cabeçalho, antes dos pedidos (urgente nunca cai na 2ª mensagem do WhatsApp)
  const p = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'estoque_reposicao', 'causa_efeito', 'acoes_realizadas']) }))
  assert.deepEqual(p.secoes.map(s => s.chave), ['plano', 'estatisticas', 'causa', 'entregas', 'acoes_semana', 'compras'])
  assert.deepEqual(p.secoes.map(s => s.pedido), [true, true, true, true, true, false], '🛒 é base fixa, não pedido')
  assert.deepEqual(titulos(p.texto).filter(e => ['📈', '🎯', '🔍', '✅', '🛠️', '🛒'].includes(e)), ['🎯', '📈', '🔍', '✅', '🛠️', '🛒'])
  assert.ok(p.texto.startsWith(ABERTURA + '\n\n*Plano para manter o ritmo de vendas · Trem Chique · 13/10*\n\nOs últimos 28 dias foram bons'), 'cabeçalho do tom aprovado (vendas = resultado dos 28 dias)')
  assert.ok(p.texto.endsWith(`${FECHO}\n${ASSINATURA}\n${NOTA}`), '🛒 sem premissa além dos 28 dias (fixture): a nota de sempre; com premissa, NOTA_COMPRAS (teste do 🛒)'); assert.equal(p.n_acoes, 1); assert.deepEqual(p.blocos, ['ruptura'])
  // reputação (gatilho urgente) também sobe o 🎯; um gatilho não urgente (perguntas) não
  const rep = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'estoque_reposicao']), itens: ITENS.map(i => ({ ...i, cobertura: 60, estoque: 120 })), extras: [{ id: 1, tipo: 'reputacao_em_risco', texto: 'Taxa de reclamações em 2,1% (limite 2%).' }] }))
  assert.equal(rep.secoes[0].chave, 'plano')
  const perg = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'estoque_reposicao']), itens: ITENS.map(i => ({ ...i, cobertura: 60, estoque: 120 })), extras: [{ id: 2, tipo: 'perguntas_sem_resposta', texto: 'Há 3 perguntas sem resposta.' }] }))
  assert.equal(perg.secoes[0].chave, 'estatisticas')
  // ordem do cliente manda: LS Importados pede anúncios e concorrência → 📉 e 🆚 no topo
  const ls = montarPlanoSemanal(base({ perfil: perfilDe(['anuncios_performance', 'concorrencia']) }))
  assert.deepEqual(ls.secoes.map(s => s.chave).slice(0, 3), ['plano', 'atencao', 'concorrencia'], 'o 🎯 com ruptura vem antes; depois os pedidos na ordem'); assert.ok(!ls.secoes.some(s => s.chave === 'estatisticas'), 'vendas não pedida: só a linha dos 28 dias')
  // sem perfil nenhum (consultor, prévia antiga): idêntico ao tom aprovado, sem 🛒 nem blocos novos
  const leg = montarPlanoSemanal(base()), legSemInfo = montarPlanoSemanal(base({ info: {} }))
  // 14/10: a quantidade do 📦 fora do Full é o pedido ao fornecedor da previsão de compras (a MESMA do relatório focado e do aviso), com a premissa; sem a previsão lida, a de antes
  const q100 = INFO.compras.itens.find(x => x.id === '100'), prem = premissaCompras([q100], INFO.compras, '2026-10-13').premissa
  assert.equal(leg.texto, legSemInfo.texto.replace(/sugerimos repor \*20 a 26 un\*\n(  \S+)/, `sugerimos repor *22 a 36 un*\n$1\n${prem}`)); assert.equal(leg.secoes, undefined); assert.doesNotMatch(leg.texto, /🛒|📈 \*Como foram|🔍/)
  assert.match(leg.texto, /\n\n✅ \*O que já fizemos e está dando resultado\*\n[^\n]+\n\n🎯 \*O plano da semana\*\n\n\*1\.\* 📦/)
})

await ok('cliente SEM perfil: só a base fixa (✅ entregas, 🎯 plano, 🛒 compras) na ordem padrão da carteira, nada marcado como pedido; nenhum bloco com dado = não sai (texto vazio)', () => {
  const p = montarPlanoSemanal(base({ perfil: SEM_PERFIL }))
  assert.deepEqual(p.secoes.map(s => s.chave), ['plano', 'compras', 'entregas']); assert.ok(p.secoes.every(s => !s.pedido))
  assert.doesNotMatch(p.texto, /📈 \*Como foram|🔍 \*|📉 \*|📣 \*|🏷️ \*|🆚 \*|🚀 \*|✨ \*|O que isso significa|glossário/)
  // ordem de matriz diferente (ex.: ações realizadas mais pedidas) muda a ordem da base
  assert.deepEqual(montarPlanoSemanal(base({ perfil: { ...SEM_PERFIL, ordem: ['acoes_realizadas', 'vendas', 'estoque_reposicao', 'compras_previsao'] }, itens: ITENS.map(i => i.id === '100' ? { ...i, cobertura: 15 } : i) })).secoes.map(s => s.chave), ['entregas', 'plano', 'compras'])
  // conta parada: sem ação no plano, sem entrega, sem pedido no ciclo → nada a dizer
  const vazio = montarPlanoSemanal(base({ perfil: SEM_PERFIL, itens: [], entregas: [], info: { compras: { disponivel: true, ciclo_dias: 30, seguranca_dias: 7, itens: [] } } }))
  assert.equal(vazio.texto, ''); assert.equal(vazio.n_acoes, 0)
  // mas o pedido do cliente com dado faz sair mesmo sem ação no plano (Agrinorte: estatísticas toda semana); estoque pedido sem urgência = frase honesta
  const ag = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'estoque_reposicao', 'anuncios_performance']), itens: ITENS.map(i => ({ ...i, cobertura: 60, estoque: 120 })), entregas: [] }))
  assert.equal(ag.n_acoes, 0); assert.deepEqual(ag.blocos, []); assert.match(ag.texto, /📈 \*Como foram as vendas\*/)
  // pedido sem dado novo: sem cabeçalho próprio — uma linha na seção única do fim
  assert.doesNotMatch(ag.texto, /🎯 \*O plano da semana\*/); assert.match(ag.texto, /📋 \*Nas outras frentes que você acompanha\*\n• O plano da semana: nada urgente de estoque ou da conta nesta semana; seguimos acompanhando\./)
  assert.ok(ag.secoes.find(s => s.chave === 'plano').junto)
})

await ok('🛠️ tarefas da semana: zero CONFIRMADO não vira frase ao cliente (só «conferir» interno); sem a leitura = «sem a leitura», nunca zero; família crua vira «Outras ações»', () => {
  const z = montarPlanoSemanal(base({ perfil: perfilDe(['acoes_realizadas', 'vendas']), info: { ...INFO, tarefas: [] } }))
  assert.doesNotMatch(z.texto, /Nenhuma tarefa concluída|🛠️/); const s = z.secoes.find(x => x.chave === 'acoes_semana')
  assert.equal(s.conteudo, false); assert.match(s.conferir[0], /nenhuma tarefa do Mercado Livre concluída nos últimos 7 dias/)
  const nl = montarPlanoSemanal(base({ perfil: perfilDe(['acoes_realizadas', 'vendas']), info: { ...INFO, tarefas: null } })).texto
  assert.match(nl, /• O que a equipe fez na sua conta nesta semana: sem a leitura das tarefas desta semana \(não quer dizer que nada foi feito\)\./)
  for (const t of ['(sem tipo)', 'criar anúncio', '']) assert.deepEqual(familiaCliente(t), { id: 'outras', nome: 'Outras ações' }, t)
  assert.equal(familiaCliente('Otimizar anúncios').nome, 'Otimizar anúncios')
  // rótulos reais trocados (14/10): tipo «Melhorar a qualidade do anuncio», «Ativar Promoções»; tipo genérico «Central de marketing» cai no título
  assert.equal(familiaCliente('Melhorar a qualidade do anuncio', 'Otimizar Anuncios').id, 'otimizar'); assert.equal(familiaCliente('Ativar Promoções').id, 'campanhas_desconto')
  assert.equal(familiaCliente('Central de marketing', 'Comunicação carrinho abandonado').id, 'transmissao'); assert.equal(familiaCliente('Central de marketing', 'x').id, 'campanhas_desconto')
  assert.equal(familiaCliente('', 'Duplicar Anúncio: 4339059128').id, 'duplicacao'); assert.equal(familiaCliente('Cadastro de Produtos', 'Criar anúncio fora de catalogo, já otimizado').id, 'cadastro', 'tipo real vence o título')
})

await ok('dados do 🛠️ (gatilhos-real.dadosRelatorio, banco em memória): Notion sem leitura até ontem = null (ausente ≠ zero); concluída sem data de conclusão conta pela última edição', async () => {
  const { db, setEstado } = await import('../src/lib/db.js'); assert.equal(db.name, ':memory:')
  const { dadosRelatorio } = await import('../src/lib/gatilhos-real.js')
  const ins = db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao, last_edited, arquivada, visivel_cliente) VALUES (?, 'f', 'Rel', 't', 'Mercado Livre', 'concluida', ?, ?, ?, 0, 1)")
  ins.run('r1', 'Otimizar anúncios', '2026-10-10', '2026-10-10T12:00:00.000Z'); ins.run('r2', '(sem tipo)', '', '2026-10-11T15:00:00.000Z'); ins.run('r3', 'Otimizar anúncios', '', '2026-09-01T12:00:00.000Z')
  ins.run('r4', 'Otimizar anúncios', '2026-10-06', '2026-10-06T12:00:00.000Z')                                       // 8 dias corridos antes de 13/10: fora da janela de 7
  const diag = { disponivel: true, cliente: 'Rel', hoje: '2026-10-13', resumo: { variacao: { pct: null } }, itens: [], data_quality: { cobertura: { pedidos: { lacunas: [] } } } }
  setEstado('ultimo_sync', '2026-10-13T10:00:00.000Z'); setEstado('desde:f', '2026-10-09T19:15:00.000Z')
  assert.equal(dadosRelatorio('Rel', { diag }).tarefas, null, 'quadro do cliente lido há 4 dias (a marca GLOBAL de ontem não vale): «sem a leitura», nunca «nenhuma tarefa»')
  setEstado('desde:f', '2026-10-13T10:00:00.000Z')
  assert.deepEqual(dadosRelatorio('Rel', { diag }).tarefas.map(t => [t.familia, t.n]), [['Otimizar anúncios', 1], ['Outras ações', 1]], 'r2 sem data de conclusão conta pela edição; r3 e r4 fora da janela de 7 dias (07 a 13/10)')
  // Bima (14/10): dois quadros, um parado desde 30/09 → «sem a leitura»; cliente sem quadro nenhum também
  db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, status, tipo_demanda, data_conclusao, last_edited, arquivada, visivel_cliente) VALUES ('r5', 'g', 'Rel', 'Duplicar Anúncio: 4339059128', 'Mercado Livre', 'concluida', '', '2026-10-12', '2026-10-12T12:00:00.000Z', 0, 1)").run()
  setEstado('desde:g', '2026-09-30T11:43:33.717Z')
  assert.equal(dadosRelatorio('Rel', { diag }).tarefas, null, 'um dos quadros sem leitura até ontem')
  setEstado('desde:g', '2026-10-12T22:00:00.000Z')
  assert.deepEqual(dadosRelatorio('Rel', { diag }).tarefas.map(t => [t.familia, t.n]), [['Duplicação de anúncios', 1], ['Otimizar anúncios', 1], ['Outras ações', 1]], 'sem tipo: a família sai do título')
  assert.equal(dadosRelatorio('SemQuadro', { diag: { ...diag, cliente: 'SemQuadro' } }).tarefas, null)
})

await ok('linha de gatilho só conta como enviada se o 🎯 entrou no texto (perfil sem estoque na ordem = blocos e usados vazios)', () => {
  const extras = [{ id: 7, tipo: 'perguntas_sem_resposta', texto: 'Há 3 perguntas sem resposta há mais de 24 horas.' }]
  const com = montarPlanoSemanal(base({ extras, perfil: perfilDe(['vendas']) })); assert.ok(com.usados.includes(7))
  const sem = montarPlanoSemanal(base({ extras, perfil: { temas: ['vendas'], nivel: 'padrao', ordem: ['vendas'] } }))
  assert.deepEqual(sem.usados, []); assert.deepEqual(sem.blocos, []); assert.equal(sem.n_acoes, 0); assert.doesNotMatch(sem.texto, /perguntas sem resposta/)
})

await ok('didático (Master Cogumelos, todos os temas): cada bloco ganha «💡 O que isso significa» e o rodapé o mini-glossário (conversão, curva A, cobertura, ponto de pedido, ROAS); completo/didático = até 10 linhas', () => {
  const p = montarPlanoSemanal(base({ perfil: perfilDe(TODOS, 'didatico') }))
  assert.deepEqual(p.secoes.map(s => s.chave), ['plano', 'estatisticas', 'compras', 'causa', 'entregas', 'acoes_semana', 'atencao', 'criacao', 'ads', 'promocoes', 'acoes_vendas', 'concorrencia'])
  const n = (p.texto.match(/💡 _O que isso significa:_/g) || []).length; assert.equal(n, p.secoes.filter(s => !s.junto).length, 'uma explicação por bloco com dado')
  for (const s of p.secoes.filter(s => !s.junto)) assert.ok(p.texto.includes(`${R.significa_prefixo} ${R.blocos[s.chave].significa}`), s.chave)
  assert.match(p.texto, /📖 \*Pequeno glossário\*\n• \*Conversão\*: [^\n]+\n• \*Curva A\*: [^\n]+\n• \*Cobertura\*: [^\n]+\n• \*Ponto de pedido\*: [^\n]+\n• \*ROAS\*: [^\n]+$/)
  assert.doesNotMatch(montarPlanoSemanal(base({ perfil: perfilDe(TODOS) })).texto, /O que isso significa|glossário/, 'padrão: sem explicação')
  // auditor: a mensagem inteira (todos os blocos + explicações + glossário) passa
  assert.deepEqual(audita(p.texto), [])
})

await ok('🛒 compras (base de TODOS): até 3 produtos com quando e quanto, sem repetir o que já está no 📦; prazo declarado (premissa × informado); nada no ciclo = frase honesta sem conteúdo', () => {
  const t = montarPlanoSemanal(base({ perfil: SEM_PERFIL })).texto, c = t.slice(t.indexOf('🛒'), t.indexOf('\n\n', t.indexOf('🛒')))
  assert.doesNotMatch(c, /Kit Pistão/, 'já está no 📦 com quantidade e data'); assert.match(c, /• Sabre Saibre 14 Polegadas: pedir \*até 25\/10\* · \*10 a 14 un\* \(tem 60 un\)/)
  assert.doesNotMatch(c, /Corrente/, 'pedido fora do próximo ciclo de 30 dias'); assert.match(c, /Prazo usado: 21 dias entre o pedido e a chegada \(premissa: se o seu fornecedor entrega em outro prazo, conta pra gente que ajustamos\) \+ 7 dias de folga/)
  const inf = { ...INFO, compras: { ...INFO.compras, itens: INFO.compras.itens.map(x => ({ ...x, lead_time: { dias: 15, fonte: 'cliente' } })) } }
  assert.match(montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: inf })).texto, /Prazo usado: 15 dias entre o pedido e a chegada \(o que temos registrado\)/)
  const nada = montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: { ...INFO, compras: { ...INFO.compras, itens: [INFO.compras.itens[2]] } } }))
  assert.match(nada.texto, /🛒 \*Compras e previsibilidade\*\nPelo ritmo atual, nenhum outro produto chega ao ponto de pedido nos próximos 30 dias\./); assert.equal(nada.secoes.find(s => s.chave === 'compras').conteudo, false)
  assert.match(montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: {} })).texto, /Ainda sem a previsão de compras desta conta/, 'sem diagnóstico: nunca número inventado')
  // conservador zero (o ritmo dos 28 dias não pede compra; só a alta recente ou a data comercial pediriam): nunca «pedir»
  const zero = { ...INFO, compras: { ...INFO.compras, itens: [{ ...INFO.compras.itens[1], quanto_pedir: { conservador: 0, base: 2 } }] } }
  const tz = montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: zero })).texto
  assert.doesNotMatch(tz, /pedir \*até 25\/10\*|até 2 un/); assert.match(tz, /nenhum outro produto chega ao ponto de pedido/)
  // 13/10: «pedir 1 un» é ruído para o cliente — abaixo de compras_min_un (3) no cenário base não entra
  const t1 = montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: { ...INFO, compras: { ...INFO.compras, itens: [{ ...INFO.compras.itens[1], quanto_pedir: { conservador: 1, base: 2 } }] } } })).texto
  assert.doesNotMatch(t1, /pedir \*até 25\/10\*/); assert.match(t1, /nenhum outro produto chega ao ponto de pedido/)
  // «outro» só quando o 📦 já listou produto; sem 📦: «nenhum produto»
  const semUrg = montarPlanoSemanal(base({ perfil: SEM_PERFIL, itens: ITENS.map(i => ({ ...i, cobertura: 60, estoque: 120 })), info: zero })).texto
  assert.match(semUrg, /Pelo ritmo atual, nenhum produto chega ao ponto de pedido nos próximos 30 dias\./)
  // premissas do MAIOR número declaradas (alta recente, data comercial, ritmo de antes da falta) e o «sem estoque» na linha
  const prem = { ...INFO, compras: { ...INFO.compras, data_comercial: { fator: 1.5, dias_efeito: 7 }, itens: [{ ...INFO.compras.itens[1], tendencia: { fator: 1.5 }, datas_comerciais: [{ evento: 'Black Friday', data: '2026-11-27' }] },
    { ...INFO.compras.itens[1], id: '103', titulo: 'Filtro De Ar Roçadeira', estoque: 0, ruptura: true, quando_pedir: { agora: true, data: '2026-10-13', dias: 0 }, quanto_pedir: { conservador: 31, base: 40 } }] } }
  const tp = montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: prem })).texto
  assert.match(tp, /• Filtro De Ar Roçadeira: pedir \*agora\* · \*31 a 40 un\* \(tem 0 un; ficou sem estoque, usamos o ritmo de antes da falta\)/)
  assert.match(tp, /A quantidade cobre esse prazo e o próximo ciclo de compra de 30 dias pelo ritmo dos últimos 28 dias; o maior número inclui a alta recente das vendas, 50% a mais de venda por 7 dias em Black Friday \(premissa da casa\) e o ritmo de antes da falta, para quem ficou sem estoque\./)
  const natal = { ...prem, compras: { ...prem.compras, itens: [{ ...prem.compras.itens[0], tendencia: { fator: 1 }, quanto_pedir: { conservador: 10, base: 14, cobre_dias: 58 }, datas_comerciais: [{ evento: 'Black Friday', data: '2026-11-27' }, { evento: 'Natal', data: '2026-12-25' }] }] } }
  assert.match(montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: natal })).texto, /o maior número inclui 50% a mais de venda por 7 dias em Black Friday \(premissa da casa\)\./, 'Natal (73 dias) fora do pedido de 58 dias: não é citado')
  // só um número (conservador = base): nada de «o maior número inclui…» nem a nota de compras
  const um = montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: { ...prem, compras: { ...prem.compras, itens: [{ ...prem.compras.itens[0], quanto_pedir: { conservador: 5, base: 5, cobre_dias: 58 } }] } } })).texto
  assert.doesNotMatch(um, /o maior número/); assert.ok(um.endsWith(NOTA))
  assert.ok(tp.endsWith(NOTA_COMPRAS)); assert.ok(montarPlanoSemanal(base({ perfil: SEM_PERFIL, info: { ...INFO, compras: { disponivel: false } } })).texto.endsWith(NOTA), 'sem 🛒 com dado, a nota de sempre')
  assert.deepEqual(audita(tp), [])
})

await ok('🔍 causa e efeito: funil 28 × 28 d, medições com rótulo honesto de confiança, lançamento sem controle declarado, «associação no tempo, não prova de causa»; sem janelas inteiras = sem comparação', () => {
  const t = montarPlanoSemanal(base({ perfil: perfilDe(['causa_efeito']) })).texto
  assert.match(t, /🔍 \*O que explica os números\*\nComparando os últimos 28 dias com os 28 anteriores: visitas \+8%, conversão de 2,1% para 2,4%, valor médio por unidade −3%\./, 'por UNIDADE (o ticket do 📈 é por pedido): rótulos diferentes para contas diferentes')
  assert.match(t, /• Otimizar anúncios em 12\/09 · Sabre Saibre 14 Polegadas: vendas \+35% \(confiança média\)/)
  assert.match(t, /• Cadastro de produtos em 02\/09 · Filtro De Ar Roçadeira: passou a vender \(9 un em 14 dias\); observação direta, sem comparação/)
  assert.match(t, /2 outras ações ainda não mostraram alta medida e 1 ação segue em medição\.\nÉ associação no tempo, não prova de causa\./)
  const sem = montarPlanoSemanal(base({ perfil: perfilDe(['causa_efeito']), info: { ...INFO, causa: { funil: null, medidas: [], outras: { sem_alta: 13 } } } }))
  assert.match(sem.texto, /• O que explica os números: sem a comparação completa dos 28 dias nesta semana \(dia sem coleta não é venda zero\)\./); assert.equal(sem.secoes.find(s => s.chave === 'causa').conteudo, false)
  // sem ação listada antes, nada de «outras»: «13 ações ainda não mostraram alta medida»
  const so = montarPlanoSemanal(base({ perfil: perfilDe(['causa_efeito']), info: { ...INFO, causa: { ...INFO.causa, medidas: [], outras: { sem_alta: 13 } } } })).texto
  assert.match(so, /\n13 ações ainda não mostraram alta medida\./); assert.doesNotMatch(so, /outras ações/)
  assert.ok(R.blocos.causa.significa.includes('valor médio por unidade') && /reduz \(não elimina\)/.test(R.blocos.causa.significa) && !/sai da conta/.test(R.blocos.causa.significa), 'o «significa» não promete mais que o bloco')
  assert.match(montarPlanoSemanal(base({ perfil: perfilDe(['causa_efeito']), info: { ...INFO, causa: { ...INFO.causa, medidas: [{ ...INFO.causa.medidas[0], confianca: 52, preco_junto: true }] } } })).texto, /\(confiança baixa\); o preço mudou junto/)
})

await ok('📉 atenção e 📈 estatísticas: queda das regras do plano, campeão caindo, visitas sem venda; top vendidos com variação, curva ABC em uma linha; variação só com as duas janelas inteiras', () => {
  const t = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'anuncios_performance']) })).texto
  assert.match(t, /📉 \*Anúncios que pedem atenção\*\n• Corrente Para Motosserra 3\/8: as visitas caíram 40% \(mais que o resto da conta\)\n• Sabre Saibre 14 Polegadas: campeão de vendas com faturamento 31% abaixo dos 28 dias anteriores\n• Vela De Ignição Universal: 340 visitas e nenhuma venda em 28 dias/)
  assert.match(t, /📈 \*Como foram as vendas\*\n150 unidades vendidas · ticket médio por pedido R\$ 55,00\. Os mais vendidos nos últimos 28 dias:\n• Kit Pistão Anéis Motosserra 170: R\$ 3\.000 \(60 un\) · \+7% sobre os 28 dias anteriores/)
  assert.match(t, /Curva ABC: 2 anúncios na curva A \(\d+% do faturamento\), 2 anúncios na curva B \(\d+% do faturamento\)\./)
  const lac = montarPlanoSemanal(base({ perfil: perfilDe(['vendas', 'anuncios_performance']), resumo: { gmv: 7700, pedidos: 140, variacao_pct: null } })).texto
  assert.doesNotMatch(lac, /sobre os 28 dias anteriores|campeão de vendas com faturamento/, 'dia sem coleta não é zero: sem as duas janelas, nada de variação')
  // a ação do plano dura o mês: a queda só entra se CONTINUA hoje, com o sinal certo (visitas que subiram nunca viram «caíram 30%»; conversão 2% → 4% não é queda)
  const at = (itens, acoes, o = {}) => montarPlanoSemanal(base({ perfil: perfilDe(['anuncios_performance', 'vendas']), entregas: [], itens, info: { ...INFO, acoes, compras: { disponivel: false } }, ...o })).texto
  const alfa = o => it('300', { titulo: 'Produto Alfa Azul', curva: 'B', r: 500, r0: 500, cobertura: 60, estoque: 120, ...o })
  const subiu = at([alfa({ v: 130, v0: 100 })], [{ regra: 'anuncio_queda_exposicao_anuncio', item_id: '300', status: 'proposta' }])
  assert.doesNotMatch(subiu, /visitas caíram/); assert.doesNotMatch(subiu, /Produto Alfa Azul: as visitas/)
  const conv = at([alfa({ u0: 10, v0: 500, u: 20, v: 500 })], [{ regra: 'anuncio_queda_conversao_anuncio', item_id: '300', status: 'proposta' }])
  assert.doesNotMatch(conv, /conversão caiu de 2% para 4%/)
  const estavel = it('310', { titulo: 'Produto Controle', curva: 'B', r: 500, r0: 500, u: 20, u0: 20, v: 1000, v0: 1000, cobertura: 60, estoque: 120 })
  const caiu = at([alfa({ u0: 20, v0: 500, u: 10, v: 500 }), estavel], [{ regra: 'anuncio_queda_conversao_anuncio', item_id: '300', status: 'proposta' }])
  assert.match(caiu, /• Produto Alfa Azul: a conversão caiu de 4% para 2% \(mais que o resto da conta\)/, 'comparação recalculada com o resto da conta')
  assert.match(at([alfa({ u0: 20, v0: 500, u: 10, v: 500 })], [{ regra: 'anuncio_queda_conversao_anuncio', item_id: '300', status: 'proposta' }]), /• Produto Alfa Azul: a conversão caiu de 4% para 2%\n/, 'conta inteira caiu junto: sem «mais que o resto»')
  // «nenhum» só com a comparação feita: sem as duas janelas inteiras (ou sem visitas lidas), ausente ≠ zero
  const semComp = at([alfa({ curva: 'A', r: 300, r0: 1000, v: null, v0: null })], [], { resumo: { gmv: 300, pedidos: 5, variacao_pct: null } })
  assert.match(semComp, /• Anúncios que pedem atenção: sem a comparação completa dos 28 dias nesta semana \(dia sem coleta não é venda zero\)\./); assert.doesNotMatch(semComp, /Nenhum anúncio com queda/)
  assert.match(at([alfa()], []), /• Anúncios que pedem atenção: nenhum anúncio com queda fora do normal nos últimos 28 dias\./)
  // anúncio que vendia e está fora do ar (pausado/em revisão) entra; alinhado (pausa de propósito) não
  const fora = [alfa({ id: '301', titulo: 'Perfume Lattafa Asad', status: 'paused', estoque: 0, r: 0, r0: 900 }), alfa({ id: '302', titulo: 'Câmera Wifi Interna', status: 'under_review', r: 200, r0: 800 })]
  const tf = at(fora, [])
  assert.match(tf, /• Perfume Lattafa Asad: fora do ar \(pausado, sem estoque\); estava vendendo\n• Câmera Wifi Interna: fora do ar \(em revisão no Mercado Livre\); estava vendendo/, 'pela venda do período anterior')
  assert.doesNotMatch(at(fora, [], { livre: (r, id) => !(r === 'anuncio_restrito' && id === '301') }), /Perfume Lattafa Asad: fora do ar/, 'alinhamento com o cliente tira')
  // a MESMA condição do gatilho anuncio_restrito (venda anterior ≥ min_impacto_pct_gmv do GMV anterior): o 🎯 e o 📉 contam igual; mais de 2 = uma linha com a contagem
  const muitos = [...fora, alfa({ id: '303', titulo: 'Kit Roxo M', status: 'paused', estoque: 0, r: 0, r0: 700 }), alfa({ id: '304', titulo: 'Kit Pink M', status: 'paused', estoque: 0, r: 0, r0: 5 })]
  const tm = at(muitos, [], { limiares: { ...L, min_impacto_pct_gmv: 1 } })
  assert.match(tm, /📉 \*Anúncios que pedem atenção\*\n• 3 anúncios que vendiam estão fora do ar \(2 sem estoque\): Perfume Lattafa Asad, Câmera Wifi Interna e mais 1 anúncio\n/, 'o de R$ 5 (abaixo de 1% do GMV anterior) fica fora, como no gatilho')
  // 13/10: o 🎯 já lista os anúncios fora do ar com link → no 📉 só a contagem (LS Importados saía com os nomes duas vezes)
  const comPlano = at(fora, [], { extras: [{ tipo: 'anuncio_restrito', id: 'g1', texto: '• Perfume Lattafa Asad\n• Câmera Wifi Interna' }] })
  assert.match(comPlano, /• 2 anúncios que vendiam estão fora do ar \(1 sem estoque\): estão no plano da semana, com o link/); assert.doesNotMatch(comPlano, /Perfume Lattafa Asad: fora do ar/)
})

await ok('📣 Ads em tom de parceria (nunca culpa nem «a verba é decisão sua»), ROAS como referência; 🏷️ promoções no ar, terminando, elegíveis; 🚀 só ações aprovadas com frase ao cliente', () => {
  const t = montarPlanoSemanal(base({ perfil: perfilDe(['ads', 'promocoes', 'acoes_vendas'], 'didatico') })).texto
  const ads = t.slice(t.indexOf('📣'), t.indexOf('\n\n', t.indexOf('📣')))
  assert.match(ads, /Investimento de R\$ 695 nos últimos 28 dias; o Mercado Livre registrou R\$ 2\.966 em vendas nos anúncios pagos \(ROAS 4,27\)\. Nos 28 dias anteriores: R\$ 500 investidos, ROAS 3,9\./)
  // só APROVADA/distribuída entra (mexe na verba): a proposta (ads_reduzir da Corrente) fica fora
  assert.match(ads, /Aprovado no plano do mês para os anúncios pagos:\n• reforçar o investimento em quem vende bem com Ads: Sabre Saibre 14 Polegadas/); assert.doesNotMatch(ads, /levar a verba|Corrente/)
  // Bee Bikini (22 ações de Ads, todas 'proposta'): nada de «ajustando», só «em análise»; e o 🚀 não contradiz
  const bee = montarPlanoSemanal(base({ perfil: perfilDe(['ads', 'acoes_vendas']), info: { ...INFO, acoes: [{ regra: 'anuncio_ads_escalar', item_id: '101', status: 'proposta' }, { regra: 'anuncio_ads_reduzir', item_id: '102', status: 'proposta' }] } })).texto
  assert.match(bee, /Ajustes nos anúncios pagos seguem em análise no plano do mês; nada foi mudado ainda\./); assert.doesNotMatch(bee, /ajustando|reforçar o investimento|Aprovado no plano/)
  // nomes iguais no corte de 70 (variações diferentes) em linhas diferentes do bloco: mostram o fim, onde está a cor/tamanho
  const kit = (id, cor) => it(id, { titulo: `Kit 2 Conjuntos Fitness Modelador Feminino Sem Transparencia Preto E Azul ${cor}`, curva: 'B', cobertura: 60, estoque: 120 })
  const vk = montarPlanoSemanal(base({ perfil: perfilDe(['ads']), itens: [kit('401', 'Tamanho P'), kit('402', 'Tamanho M')], entregas: [], info: { ...INFO, compras: { disponivel: false }, acoes: [{ regra: 'anuncio_ads_escalar', item_id: '401', status: 'aprovada' }, { regra: 'anuncio_ads_reduzir', item_id: '402', status: 'aprovada' }] } })).texto
  assert.match(vk, /reforçar o investimento em quem vende bem com Ads: Kit 2 Conjuntos Fitness Modelador… Preto E Azul Tamanho P\n/); assert.match(vk, /para os que rendem mais: Kit 2 Conjuntos Fitness Modelador… Preto E Azul Tamanho M/)
  assert.deepEqual(audita(vk), [])
  assert.doesNotMatch(ads, /decis[aã]o (é )?sua|sua decis|culpa|voc[eê] (precisa|deve|n[aã]o)|falta de verba|por sua conta/i)
  assert.match(montarPlanoSemanal(base({ perfil: perfilDe(['ads']), info: { ...INFO, ads: null } })).texto, /Ainda não temos a leitura dos anúncios pagos desta conta\./)
  assert.match(t, /🏷️ \*Promoções\*\nNo ar: 2 anúncios em promoção \(Semana do Campo, Outubro\)\.\nTerminando até 20\/10: Sabre Saibre 14 Polegadas\.\n12 anúncios estão elegíveis para campanhas do Mercado Livre agora/)
  assert.match(t, /_\(leitura das promoções de 13\/10\)_/)
  // aprovada ≠ em andamento: só a distribuída (virou tarefa) é «em andamento»
  assert.match(t, /🚀 \*Ações para vender mais\*\nAprovadas no plano, ainda não iniciadas:\n• Reforçar o anúncio pago de quem vende bem: Sabre Saibre 14 Polegadas\n• Criar uma nova versão do anúncio, com outro ângulo: Kit Pistão Anéis Motosserra 170/)
  const dist = montarPlanoSemanal(base({ perfil: perfilDe(['acoes_vendas']), info: { ...INFO, acoes: INFO.acoes.map(a => a.item_id === '100' ? { ...a, status: 'distribuida' } : a) } })).texto
  assert.match(dist, /Em andamento \(já viraram tarefa da equipe\):\n• Criar uma nova versão do anúncio, com outro ângulo: Kit Pistão Anéis Motosserra 170\nAprovadas no plano, ainda não iniciadas:\n• Reforçar o anúncio pago/)
  // pedidos sem dado: uma seção só, a mesma frase não se repete (🚀 e ✨ juntos numa linha)
  const nada = montarPlanoSemanal(base({ perfil: perfilDe(['acoes_vendas', 'anuncios_criacao_melhoria', 'promocoes', 'vendas']), info: { ...INFO, acoes: [], tarefas: [], promocoes: null } })).texto
  assert.match(nada, /📋 \*Nas outras frentes que você acompanha\*\n• Ações para vender mais e Criação e melhoria de anúncios: nenhuma ação aprovada no plano ainda; seu consultor traz na próxima conversa\.\n• Promoções: ainda não temos a leitura das promoções desta conta\./)
  assert.doesNotMatch(nada, /🚀 \*|✨ \*|🏷️ \*/, 'nunca cabeçalho vazio'); assert.equal((nada.match(/nenhuma ação aprovada/g) || []).length, 1)
  assert.deepEqual(audita(nada), [])
  assert.doesNotMatch(t.slice(t.indexOf('🚀')), /Recuperar as visitas/, 'proposta (não aprovada) fica fora do 🚀')
  assert.deepEqual(audita(t), [])
})

await ok('🆚 concorrência «começar pelo que dá»: catálogo (preço para ganhar), concorrente cadastrado (sem o link no texto), campeão sem dado = frase honesta, busca ampla declarada como não coletada', () => {
  const t = montarPlanoSemanal(base({ perfil: perfilDe(['concorrencia']) })).texto, c = t.slice(t.indexOf('🆚'), t.indexOf('\n\n', t.indexOf('🆚')))
  assert.match(c, /• Filtro De Ar Roçadeira: no catálogo, o Mercado Livre indica R\$ 36,50 para a sua oferta ser a principal da página \(seu preço: R\$ 39,90; lido em 12\/10\)\. Só vale se couber na sua margem; avaliamos com você/)
  // preço para ganhar muito abaixo (> 30%) ou leitura velha (> 7 dias): fora do texto ao cliente, «conferir» na prévia interna (LS Importados: R$ 138 × R$ 320)
  const ptw = (o, i = {}) => montarPlanoSemanal(base({ perfil: perfilDe(['concorrencia']), itens: ITENS.map(x => x.id === '103' ? { ...x, ...i, ptw: { status: 'competing', preco_para_ganhar: 36.5, lido_em: '2026-10-12', ...o } } : x) }))
  for (const [o, i] of [[{ preco_para_ganhar: 138 }, { preco: 320 }], [{ lido_em: '2026-10-01' }, {}], [{ lido_em: '' }, {}]]) {
    const r = ptw(o, i), cc = r.secoes.find(s => s.chave === 'concorrencia')
    assert.doesNotMatch(r.texto, /indica R\$|preço para ganhar/); assert.match(r.texto, /• Filtro De Ar Roçadeira: disputando a página do catálogo/)
    assert.equal(cc.conferir.length, 1); assert.match(cc.conferir[0], /^Filtro De Ar Roçadeira: preço para ganhar R\$ [\d,]+ × seu preço R\$ [\d,]+ \(−\d+%/)
  }
  assert.equal(ptw({}).secoes.find(s => s.chave === 'concorrencia').conferir, undefined, 'dentro dos limites: nada a conferir')
  assert.match(c, /• Sabre Saibre 14 Polegadas: 1 concorrente acompanhado, a R\$ 189,90 \(visto em 10\/10\); seu preço: R\$ 25,00/); assert.doesNotMatch(c, /MLB-999|https/)
  assert.match(c, /• Kit Pistão Anéis Motosserra 170: ainda não acompanhamos concorrentes deste anúncio\. Seu consultor pode cadastrar\./)
  assert.match(c, /A comparação ampla de preços na busca do Mercado Livre ainda não é coletada\.$/)
  const nada = montarPlanoSemanal(base({ perfil: perfilDe(['concorrencia']), itens: ITENS.map(i => ({ ...i, catalogo: false, ptw: null })), info: { ...INFO, concorrentes: [] } }))
  assert.match(nada.texto, /• Kit Pistão Anéis Motosserra 170 e Sabre Saibre 14 Polegadas: ainda não acompanhamos concorrentes destes anúncios\. Seu consultor pode cadastrar\./)
  assert.equal(nada.secoes.find(s => s.chave === 'concorrencia').conteudo, false, 'sem dado de concorrente não é conteúdo')
})

await ok('variações com o mesmo nome curto: o bloco usa o título completo; títulos idênticos viram um nome com a contagem («(3 anúncios)»)', () => {
  const v = (id, t, o = {}) => it(id, { titulo: t, curva: 'A', r: 900, r0: 2000, u: 10, u0: 22, ...o })
  const itens = [v('201', 'Conjunto Fitness Bee Top Cropped Short Preto P'), v('202', 'Conjunto Fitness Bee Top Cropped Short Rosa M'), ...['203', '204', '205'].map(id => v(id, 'Kit 2 Conjuntos Fitness Modelador Feminino'))]
  const acoes = itens.map(i => ({ regra: 'anuncio_ads_escalar', item_id: i.id, status: 'aprovada' }))
  const t = montarPlanoSemanal(base({ itens, entregas: [], perfil: perfilDe(['anuncios_performance', 'ads']), info: { ...INFO, acoes, compras: { disponivel: false } } })).texto
  assert.match(t, /• Conjunto Fitness Bee Top Cropped Short Preto P: campeão[^\n]+\n• Conjunto Fitness Bee Top Cropped Short Rosa M: campeão/)
  assert.match(t, /• reforçar o investimento em quem vende bem com Ads: Conjunto Fitness Bee Top Cropped Short Preto P, Conjunto Fitness Bee Top Cropped Short Rosa M e mais 3 anúncios/)
  const so3 = montarPlanoSemanal(base({ itens: itens.slice(2), entregas: [], perfil: perfilDe(['ads']), info: { ...INFO, acoes: acoes.slice(2), compras: { disponivel: false } } })).texto
  assert.match(so3, /: Kit 2 Conjuntos Fitness Modelador Feminino \(3 anúncios\)\n/)
})

await ok('divisão do WhatsApp: acima do teto sai em partes, na ordem, só entre parágrafos (bloco inteiro), título grudado no bloco seguinte, «continua» só nas do meio; texto curto = 1 parte', () => {
  const t = montarPlanoSemanal(base({ perfil: perfilDe(TODOS, 'didatico') })).texto
  assert.ok(t.length > R.whatsapp_max_caracteres, `o didático completo passa do teto (${t.length})`)
  const partes = dividirMensagem(t, { max: R.whatsapp_max_caracteres, continua: R.continua })
  assert.ok(partes.length >= 2); for (const p of partes) assert.ok(p.length <= R.whatsapp_max_caracteres, 'cada parte no teto')
  assert.ok(partes.slice(0, -1).every(p => p.endsWith(`\n\n${R.continua}`))); assert.ok(!partes.at(-1).includes(R.continua))
  assert.equal(partes.map(p => p.replace(`\n\n${R.continua}`, '')).join('\n\n'), t, 'nada some nem muda: a junção é o texto original')
  for (const par of t.split('\n\n')) assert.ok(partes.some(p => p.includes(par)), 'nenhum parágrafo cortado')
  for (const p of partes) assert.doesNotMatch(p.replace(`\n\n${R.continua}`, ''), /\*\s*$/, 'título nunca fica sozinho no fim de uma parte')
  const eq = dividirMensagem(['x'.repeat(3000), 'y'.repeat(800), 'z'.repeat(150)].join('\n\n'), { max: 3500 })
  assert.deepEqual(eq.map(p => p[0]), ['x', 'y'], 'equilibrado: a 2ª parte não fica só com o fecho'); assert.equal(eq.length, 2)
  assert.deepEqual(dividirMensagem('curto'), ['curto']); assert.deepEqual(audita(R.continua), [], 'a linha «continua» passa no auditor')
  const dois = dividirMensagem('A'.repeat(30) + '\n\n🎯 *Título*\n\n' + 'B'.repeat(30), { max: 50 })
  assert.deepEqual(dois, ['A'.repeat(30), '🎯 *Título*\n\n' + 'B'.repeat(30)])
})

await ok('concorrentes cadastrados (núcleo em memória): prévia não grava; confirmar grava com quem pode; anúncio de outro cliente 404; link, preço e dia validados sem eco; mesmo link e dia só atualiza o preço', () => {
  const h = new Database(':memory:'); h.exec(SCHEMA_CONCORRENCIA)
  const c = criarConcorrencia(h, { agora: () => '2026-10-13T12:00:00.000Z', hoje: () => '2026-10-13', validarPor: (p, cl) => p === 'Carla Souza' && cl === 'Agrinorte' ? 'Carla Souza' : '', anuncioDoCliente: (cl, id) => cl === 'Agrinorte' && id === 'MLB6304458754' })
  const b = { cliente: 'Agrinorte', item_id: 'mlb6304458754', url: 'https://produto.mercadolivre.com.br/MLB-123-kit-pistao-_JM', preco: '74,90', observado_em: '2026-10-12', por: 'Carla Souza' }
  const pv = c.registrar(b); assert.equal(pv.previa, true); assert.equal(pv.novo, true); assert.deepEqual(pv.depois, { item_id: 'MLB6304458754', url: b.url, preco: 74.9, observado_em: '2026-10-12' })
  assert.equal(h.prepare('SELECT COUNT(*) n FROM concorrente_anuncio').get().n, 0, 'prévia não grava')
  assert.equal(c.registrar({ ...b, confirmar: true }).previa, false); assert.equal(c.registrar({ ...b, preco: 72, confirmar: true }).novo, false)
  assert.deepEqual(concorrentesDoCliente(h, 'Agrinorte'), [{ item_id: 'MLB6304458754', url: b.url, preco: 72, observado_em: '2026-10-12' }])
  c.registrar({ ...b, preco: 70, observado_em: '2026-10-13', confirmar: true })
  assert.deepEqual(concorrentesDoCliente(h, 'Agrinorte').map(x => [x.preco, x.observado_em]), [[70, '2026-10-13']], 'a última observação de cada link')
  const erro = (o, st, rx) => { try { c.registrar({ ...b, ...o }); assert.fail('passou') } catch (e) { assert.equal(e.status, st); assert.match(e.message, rx); const v = Object.values(o)[0]; if (typeof v === 'string' && v.length >= 4) assert.ok(!e.message.includes(v), 'sem eco do valor recebido') } }
  erro({ item_id: 'MLB111111111' }, 404, /anúncio não encontrado/); erro({ item_id: 'xyz' }, 400, /MLB/); erro({ url: 'http://exemplo.com/x' }, 400, /https/); erro({ url: 'javascript:alert(1)' }, 400, /https/)
  erro({ preco: 0 }, 400, /maior que zero/); erro({ preco: 'abc' }, 400, /maior que zero/); erro({ preco: 0.001 }, 400, /maior que zero/); erro({ preco: 0.004, confirmar: true }, 400, /maior que zero/)
  erro({ observado_em: '2026-02-31' }, 400, /AAAA-MM-DD/); erro({ observado_em: '2026-13-01' }, 400, /AAAA-MM-DD/); erro({ observado_em: '2026-10-20' }, 400, /hoje ou antes/); erro({ cliente: '[Comercial] Loja' }, 400, /cliente inválido/)
  erro({ por: 'Fulano', confirmar: true }, 403, /líder, consultor ou o CS/)
  assert.equal(c.ler('Agrinorte').concorrentes.length, 1)
})

await ok('fluxo n8n: WhatsApp abre 1 envio por parte (na ordem, 1 por vez) e devolve UM recibo do canal — entregue só se todas as partes saíram; e-mail recebe o texto inteiro', () => {
  const f = JSON.parse(readFileSync(new URL('../automacao/n8n/place-gatilhos-entrega.json', import.meta.url), 'utf-8')), no = nm => f.nodes.find(x => x.name.startsWith(nm))
  const lote = { lote_id: 'L1', cliente_rotulo: 'Agrinorte', tipo: 'semanal', assunto: 'Plano', texto: 'P1\n\nP2', texto_html: 'x', link: '', whatsapp_partes: ['P1\n\n_(continua)_', 'P2'],
    canais: { whatsapp: { ligado: true, destino: '1203@g.us' }, email: { ligado: true, destino: 'a@b.com' } } }
  const abrir = new Function('$input', no('Abrir por canal').parameters.jsCode)({ first: () => ({ json: { body: lote } }) }).map(x => x.json)
  assert.deepEqual(abrir.map(x => [x.canal, x.texto, x.parte, x.partes]), [['whatsapp', 'P1\n\n_(continua)_', 1, 2], ['whatsapp', 'P2', 2, 2], ['email', 'P1\n\nP2', 1, 1]])
  assert.deepEqual(new Function('$input', no('Abrir por canal').parameters.jsCode)({ first: () => ({ json: { body: { ...lote, whatsapp_partes: undefined } } }) }).map(x => x.json.texto), ['P1\n\nP2', 'P1\n\nP2'], 'payload antigo: texto inteiro')
  const recibo = sts => new Function('$input', '$', no('Montar recibo').parameters.jsCode)({ all: () => sts.map(s => ({ json: { statusCode: s } })) }, () => ({ itemMatching: i => ({ json: abrir.filter(x => x.canal === 'whatsapp')[i] }) })).map(x => [x.json.canal, x.json.estado])
  assert.deepEqual(recibo([200, 200]), [['whatsapp', 'entregue']]); assert.deepEqual(recibo([200, 500]), [['whatsapp', 'falhou']], 'a 1ª entregue não esconde a 2ª que falhou')
  assert.deepEqual(no('WhatsApp').parameters.options.batching, { batch: { batchSize: 1, batchInterval: 1500 } }, 'uma parte por vez, na ordem')
  // o modelo traz o que está AO VIVO no Discord (resumo interno em partes, menções travadas): reimportar/colar o nó não volta ao corte de 1.900
  const int = { lote_id: 'L2', cliente_rotulo: 'Rotec', tipo: 'interno_semanal', interno: true, texto: 'p1\np2', canais: { discord: { ligado: true, destino: 'https://discord.com/api/webhooks/1/x' } }, discord_partes: ['p1 ' + 'x'.repeat(1900), 'parte 2'], discord_mencionar: ['712345678901234567'], discord_mencionar_cargos: ['1517119651522547774'] }
  const dc = new Function('$input', no('Abrir por canal').parameters.jsCode)({ first: () => ({ json: { body: int } }) }).map(x => x.json)
  assert.deepEqual(dc.map(x => [x.canal, x.parte, x.partes, x.texto.length]), [['discord', 1, 2, 1903], ['discord', 2, 2, 7]]); assert.deepEqual([dc[0].mencionar, dc[0].mencionar_cargos], [['712345678901234567'], ['1517119651522547774']])
  const disc = no('Discord'); assert.doesNotMatch(disc.parameters.jsonBody, /slice/); assert.match(disc.parameters.jsonBody, /allowed_mentions: \{ parse: \[\], users: \$json\.mencionar \|\| \[\], roles: \$json\.mencionar_cargos \|\| \[\] \}/)
  assert.deepEqual(disc.parameters.options.batching, { batch: { batchSize: 1, batchInterval: 700 } }); assert.match(no('E-mail').parameters.jsCode, /statusCode: 503/, 'e-mail sem SMTP = recibo falhou, como ao vivo')
  assert.match(f.meta.modelo_13_10, /nunca reimportando/)
})

await ok('lote semanal dos gatilhos com o perfil: a prévia leva secoes (o que veio do perfil), perfil { fonte, nível } e em quantas mensagens sai; perfil ilegível = texto do tom aprovado; o texto passa no auditor', () => {
  const h = new Database(':memory:'); h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT '', notificacao_json TEXT NOT NULL DEFAULT '{}')"); h.prepare("INSERT INTO clientes_central VALUES ('Trem Chique', 'Ativo', '{}')").run()
  const cfg = JSON.parse(JSON.stringify(lerConfig())); delete cfg.inicio_envios
  let perfil = () => perfilDe(TODOS, 'didatico')
  const logs = []
  const g = criarGatilhos({ handle: h, cfg: validarConfig(cfg), agora: () => '2026-10-13T13:00:00.000Z', nomesInternos: () => ['Carla Souza'], validarPor: () => 'Carla Souza',
    elegiveis: () => [{ cliente: 'Trem Chique', status: 'Ativo' }], log: (nv, m) => logs.push(m), integracao: () => ({ ok: true }),
    fontes: { planoSemana: () => ({ disponivel: true, resumo: base().resumo, itens: ITENS, fullParado: [], entregas: ENTREGAS, custosInformados: true, relatorio: INFO }), perfil: c => perfil(c) } })
  const l = g.montarLote('Trem Chique', 'semanal', { gravar: false })
  assert.ok(!l.bloqueado, l.motivo); assert.equal(l.perfil.nivel, 'didatico'); assert.equal(l.perfil.fonte, 'equipe'); assert.ok(l.secoes.length >= 10); assert.ok(l.secoes.every(s => s.pedido || PCFG.base_fixa.includes(s.tema)))
  assert.ok(l.n_partes >= 2, 'didático completo sai em partes no WhatsApp'); assert.match(l.texto_final, /📖 \*Pequeno glossário\*/)
  perfil = () => { throw new Error('banco') }
  const leg = g.montarLote('Trem Chique', 'semanal', { gravar: false })
  assert.equal(leg.secoes, undefined); assert.equal(leg.n_partes, 1); assert.doesNotMatch(leg.texto_final, /🛒|glossário/); assert.ok(logs.some(m => /perfil de informação Error/.test(m)), 'log sem o texto do erro')
})

console.log(`\n${n} verificações do relatório personalizado ok.`)
