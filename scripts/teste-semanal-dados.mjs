process.env.PS_PERFIL_MEMORIA = '1'                    // ANTES de qualquer import: banco em memória, nunca toca data/db.sqlite
// Autoteste da frente DADOS do Relatório Semanal v2: perfis, resultados (ML · ADS · outros canais), volume, tarefas que geraram
// resultado e situação da conta. Dados SINTÉTICOS, funções puras, sem rede e sem banco real. Rodar: node scripts/teste-semanal-dados.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
const P = await import('../src/lib/perfil-cliente.js')
const R = await import('../src/lib/semanal-resultados.js')

let falhas = 0
const caso = (nome, fn) => { try { fn(); console.log('✔', nome) } catch (e) { falhas++; console.log('✘', nome, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')) } }
const todosTextos = o => JSON.stringify(o)

// ── perfis ───────────────────────────────────────────────────────────────────────────────────────────────────────────
caso('7 perfis e 6 objetivos da config, com as regras do pedido', () => {
  const ps = P.listarPerfis(), por = Object.fromEntries(ps.map(p => [p.id, p]))
  assert.deepEqual(ps.map(p => p.id), ['analitico', 'direto', 'relacionamento', 'proativo', 'zero_conhecimento', 'tecnico', 'ansioso'])
  assert.ok(ps.every(p => p.rotulo && p.descricao && p.regras && /propostas/.test(p.definicao)))
  assert.equal(por.analitico.regras.provas, 'completa'); assert.equal(por.analitico.regras.metodologia, true); assert.equal(por.analitico.regras.max_acoes, 0)
  assert.equal(por.direto.regras.densidade, 'enxuta'); assert.equal(por.direto.regras.max_acoes, 5); assert.equal(por.direto.regras.max_resultados, 3); assert.equal(por.direto.regras.tabela_otimizacoes, false)
  assert.equal(por.relacionamento.regras.tom, 'parceria'); assert.equal(por.relacionamento.regras.mostrar_equipe, true); assert.equal(por.relacionamento.regras.max_acoes, 8)
  assert.equal(por.proativo.regras.links_abertos, true)
  assert.equal(por.zero_conhecimento.regras.linguagem, 'simples'); assert.equal(por.zero_conhecimento.regras.glossario, true); assert.equal(por.zero_conhecimento.regras.max_acoes, 6)
  assert.equal(por.tecnico.regras.linguagem, 'tecnica'); assert.equal(por.tecnico.regras.metricas_extras, true); assert.equal(por.tecnico.regras.graficos, true)
  assert.equal(por.ansioso.regras.tom, 'tranquilizador'); assert.equal(por.ansioso.regras.situacao_da_conta, true); assert.equal(por.ansioso.regras.max_acoes, 6)
  assert.deepEqual(P.listarObjetivos().map(o => [o.id, o.metrica]), [['faturamento', 'receita'], ['visibilidade', 'visitas'], ['conversao', 'conversao'], ['ads', 'ads'], ['margem', 'margem'], ['lancamentos', 'lancamentos']])
  assert.equal(P.janelaResultadosDias(), 45)
})

caso('mesclarRegras com 2 perfis: o 1º vence texto/número, booleanos fazem OU, o que o 1º não define vem do 2º', () => {
  const a = P.mesclarRegras(['direto', 'tecnico'])
  assert.equal(a.densidade, 'enxuta'); assert.equal(a.provas, 'minima'); assert.equal(a.max_acoes, 5); assert.equal(a.max_resultados, 3)   // do primário
  assert.equal(a.linguagem, 'tecnica')                                  // direto não define: sem conflito, vale a do técnico
  assert.equal(a.metricas_extras, true); assert.equal(a.metodologia, true); assert.equal(a.graficos, true); assert.equal(a.tabela_otimizacoes, true)   // OU (direto = false)
  const b = P.mesclarRegras(['tecnico', 'direto'])
  assert.equal(b.densidade, 'completa'); assert.equal(b.provas, 'completa'); assert.equal(b.max_acoes, 0)   // ordem importa
  const c = P.mesclarRegras(['proativo', 'zero_conhecimento'])
  assert.equal(c.max_acoes, 0); assert.equal(c.linguagem, 'simples'); assert.equal(c.glossario, true); assert.equal(c.links_abertos, true)   // 0 explícito do primário (todas) vence o 6
  assert.deepEqual(P.mesclarRegras('direto,direto,tecnico'), P.mesclarRegras(['direto', 'tecnico']))   // string com vírgula e repetido
  assert.deepEqual(P.mesclarRegras(['ansioso']), P.listarPerfis().find(p => p.id === 'ansioso').regras)
})

caso('perfil desconhecido é rejeitado (mesclar, salvar, override) sem repetir o valor na mensagem', () => {
  assert.throws(() => P.mesclarRegras(['direto', '<b>x</b>']), e => e.status === 400 && /desconhecido/.test(e.message) && !/<b>/.test(e.message))
  assert.throws(() => P.mesclarRegras([]), /ao menos um/)
  const { perfilDoCliente, salvarPerfil } = P.criarPerfis(new Database(':memory:'))
  assert.throws(() => salvarPerfil({ cliente: 'C', perfis: ['nao_existe'], objetivo: 'faturamento', por: 'David' }), e => e.status === 400)
  assert.throws(() => salvarPerfil({ cliente: 'C', perfis: ['direto'], objetivo: 'nao_existe', por: 'David' }), /objetivo desconhecido/)
  assert.throws(() => salvarPerfil({ cliente: 'C', perfis: [], objetivo: 'faturamento', por: 'David' }), /ao menos um/)
  assert.throws(() => salvarPerfil({ cliente: 'C', perfis: ['direto'], objetivo: 'faturamento' }), /por/)          // `por` obrigatório
  assert.throws(() => salvarPerfil({ cliente: 'C', perfis: ['direto'], objetivo: 'faturamento', por: '   ' }), /por/)
  assert.throws(() => perfilDoCliente('C', { perfis: ['nao_existe'] }), e => e.status === 400)
  assert.throws(() => perfilDoCliente('C', { objetivo: 'nao_existe' }), /objetivo desconhecido/)
  assert.equal(perfilDoCliente('C').origem, 'padrao')                                                              // nada foi gravado pelas tentativas inválidas
})

caso('perfilDoCliente: padrão sem perfil salvo, salvar/ler, override sem gravar, perfil removido da config não derruba', () => {
  const h = new Database(':memory:'), { perfilDoCliente, salvarPerfil } = P.criarPerfis(h)
  const p0 = perfilDoCliente('Cliente A')
  assert.equal(p0.origem, 'padrao'); assert.equal(p0.primario, 'analitico'); assert.equal(p0.objetivo.id, 'faturamento'); assert.equal(p0.objetivo.metrica, 'receita')
  assert.deepEqual(p0.perfis.map(p => p.id), ['analitico']); assert.equal(p0.regras.provas, 'completa'); assert.equal(p0.cliente, 'Cliente A')
  const p1 = salvarPerfil({ cliente: 'Cliente A', perfis: ['ansioso', 'tecnico'], objetivo: 'ads', por: 'David' })
  assert.equal(p1.origem, 'banco'); assert.equal(p1.primario, 'ansioso'); assert.deepEqual(p1.perfis.map(p => p.id), ['ansioso', 'tecnico']); assert.equal(p1.objetivo.id, 'ads')
  assert.equal(p1.regras.tom, 'tranquilizador'); assert.equal(p1.regras.metricas_extras, true); assert.equal(p1.regras.max_acoes, 6)
  const ov = perfilDoCliente('Cliente A', { perfis: 'direto' })                                                    // override só desta geração
  assert.equal(ov.primario, 'direto'); assert.equal(ov.override, true); assert.equal(ov.objetivo.id, 'ads')
  assert.equal(perfilDoCliente('Cliente A').primario, 'ansioso')                                                   // não gravou
  assert.equal(salvarPerfil({ cliente: 'Cliente A', perfis: ['direto'], por: 'David' }).objetivo.id, 'ads')        // objetivo omitido: mantém
  assert.equal(perfilDoCliente('Cliente B').origem, 'padrao')                                                      // clientes não se misturam
  assert.equal(h.prepare('SELECT por FROM perfil_cliente WHERE cliente = ?').get('Cliente A').por, 'David')
  h.prepare("INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, atualizado_em, por) VALUES ('Cliente C', ?, 'fantasma', '2026-10-01', 'x')").run(JSON.stringify(['direto', 'fantasma']))
  const pc = perfilDoCliente('Cliente C')
  assert.deepEqual(pc.perfis.map(p => p.id), ['direto']); assert.equal(pc.objetivo.id, 'faturamento'); assert.equal(pc.avisos.length, 2)
  h.prepare("INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, atualizado_em, por) VALUES ('Cliente D', '[\"fantasma\"]', 'ads', '2026-10-01', 'x')").run()
  assert.equal(perfilDoCliente('Cliente D').origem, 'padrao')                                                      // todos os salvos sumiram: cai no padrão
  h.prepare("INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, atualizado_em, por) VALUES ('Cliente E', 'lixo', 'ads', '2026-10-01', 'x')").run()
  assert.equal(perfilDoCliente('Cliente E').origem, 'padrao')                                                      // JSON corrompido não derruba
})

caso('coleta_promocoes (interruptor da coleta de promoções do ML): null = padrão da base; true/false grava 1/0; ausente mantém; coluna aditiva em banco antigo', () => {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE perfil_cliente (cliente TEXT PRIMARY KEY, perfis_json TEXT NOT NULL DEFAULT '[]', objetivo TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT '')")   // banco de antes das duas colunas
  const { perfilDoCliente, salvarPerfil, coletaPromocoesDoCliente } = P.criarPerfis(h)
  assert.ok(h.prepare('PRAGMA table_info(perfil_cliente)').all().some(c => c.name === 'coleta_promocoes'), 'ALTER aditivo')
  assert.equal(coletaPromocoesDoCliente('Cliente A'), null); assert.equal(perfilDoCliente('Cliente A').coleta_promocoes, null)
  assert.equal(salvarPerfil({ cliente: 'Cliente A', perfis: ['direto'], objetivo: 'ads', por: 'David', coleta_promocoes: false }).coleta_promocoes, 0)
  assert.equal(coletaPromocoesDoCliente('Cliente A'), 0)
  assert.equal(salvarPerfil({ cliente: 'Cliente A', perfis: ['direto'], por: 'David' }).coleta_promocoes, 0, 'ausente mantém')
  assert.equal(salvarPerfil({ cliente: 'Cliente A', perfis: ['direto'], por: 'David', coleta_promocoes: true }).coleta_promocoes, 1)
  assert.equal(salvarPerfil({ cliente: 'Cliente A', perfis: ['direto'], por: 'David', coleta_promocoes: null }).coleta_promocoes, null, 'null volta ao padrão da base')
  assert.throws(() => salvarPerfil({ cliente: 'Cliente A', perfis: ['direto'], por: 'David', coleta_promocoes: 1 }), /coleta_promocoes/)
  assert.equal(coletaPromocoesDoCliente('Cliente B'), null, 'clientes não se misturam')
  assert.equal(typeof P.coletaPromocoesDoCliente, 'function', 'export pronto (banco em memória pelo PS_PERFIL_MEMORIA)')
})

caso('exports prontos (banco em memória pelo PS_PERFIL_MEMORIA)', () => {
  assert.equal(P.perfilDoCliente('Qualquer').origem, 'padrao')
  assert.equal(P.salvarPerfil({ cliente: 'Qualquer', perfis: ['relacionamento'], objetivo: 'visibilidade', por: 'teste' }).regras.mostrar_equipe, true)
})

// ── resultados ───────────────────────────────────────────────────────────────────────────────────────────────────────
const DE = '2026-09-29', ATE = '2026-10-05'
const ML_CHAVES = ['faturamento', 'vendas', 'unidades', 'ticket_medio', 'visitas', 'conversao', 'cancelamentos', 'devolucoes', 'valor_cancelado', 'preco_medio_unidade']
const ADS_CHAVES = ['vendas_atribuidas', 'roas', 'receita_atribuida', 'investimento', 'acos', 'tacos', 'impressoes', 'cliques', 'ctr', 'cpc']
const negocio = {
  atual: { disponivel: true, faturamento: 1000, vendas: 10, unidades: 12, preco_medio_venda: 100, preco_medio_unidade: 83.33, visitas: 500, conversao: 2, vendas_canceladas: 1, valor_cancelado: 50, vendas_devolvidas: null },
  anterior: { disponivel: true, faturamento: 800, vendas: 8, unidades: 10, preco_medio_venda: 100, preco_medio_unidade: 80, visitas: 400, conversao: 1.5, vendas_canceladas: 2, valor_cancelado: 90, vendas_devolvidas: 0 },
  janela_anterior: { de: '2026-09-22', ate: '2026-09-28' },
}
const adsApi = {
  atual: { disponivel: true, investimento: 100, receita: 500, roas: 5, acos: 20, vendas_atribuidas: 6, cliques: 200, impressoes: 10000 },
  anterior: { disponivel: true, investimento: 100, receita: 400, roas: 4, acos: 25, vendas_atribuidas: 4, cliques: 160, impressoes: 8000 },
}
const m = (b, k) => b.metricas.find(x => x.chave === k)
const nenhumZeroInventado = b => b.metricas.every(x => x.valor == null && x.delta == null && x.motivo !== null || x.valor != null)
const base = o => R.montarResultados({ de: DE, ate: ATE, ...o })

caso('ML via API: lista completa, deltas com polaridade, conversão em pontos, indisponível = null + motivo (nunca 0)', () => {
  const r = base({ conectado: true, negocio, tarefas: [], concluidas: [] })
  assert.equal(r.ml.fonte, 'api'); assert.equal(r.ml.disponivel, true); assert.equal(r.ml.motivo, null)
  assert.deepEqual(r.ml.metricas.map(x => x.chave), ML_CHAVES)
  assert.deepEqual(m(r.ml, 'faturamento').delta, { valor: 25, bom: true, pontos: false })
  assert.deepEqual(m(r.ml, 'conversao').delta, { valor: 0.5, bom: true, pontos: true })
  assert.equal(m(r.ml, 'cancelamentos').delta, null)                                                     // só 8 vendas no período anterior: sem amostra para a taxa, sem cor (rev. #8)
  assert.equal(m(r.ml, 'devolucoes').valor, null); assert.match(m(r.ml, 'devolucoes').motivo, /indisponível/)   // null, não 0
  assert.equal(m(r.ml, 'devolucoes').delta, null)
  assert.ok(m(r.ml, 'ticket_medio').explicacao && r.ml.metricas.every(x => x.explicacao && typeof x.extra === 'boolean'))
  assert.equal(m(r.ml, 'faturamento').extra, false); assert.equal(m(r.ml, 'valor_cancelado').extra, true)
  assert.deepEqual(r.anterior, { de: '2026-09-22', ate: '2026-09-28' }); assert.deepEqual(r.periodo, { de: DE, ate: ATE })
  assert.equal(base({ conectado: true, negocio: { ...negocio, atual: { ...negocio.atual, parcial: true } } }).ml.aviso.includes('amostra'), true)
})

caso('cliente sem ML: ML e ADS com a lista COMPLETA em null + motivo; nenhum número inventado', () => {
  const r = base({ conectado: false, tarefas: [], concluidas: [] })
  assert.equal(r.ml.fonte, null); assert.equal(r.ml.disponivel, false); assert.match(r.ml.motivo, /não conectada/)
  assert.deepEqual(r.ml.metricas.map(x => x.chave), ML_CHAVES); assert.ok(r.ml.metricas.every(x => x.valor === null && x.delta === null))
  assert.equal(r.ads.fonte, null); assert.equal(r.ads.disponivel, false); assert.match(r.ads.motivo, /não conectada/)
  assert.deepEqual(r.ads.metricas.map(x => x.chave), ADS_CHAVES); assert.ok(r.ads.metricas.every(x => x.valor === null))
  assert.deepEqual(r.outros, []); assert.deepEqual(r.ads.acoes, [])
  assert.match(base({ conectado: true, falhou: true }).ml.motivo, /não respondeu/)                       // falha do ML: motivo, sem estimar
  assert.match(base({ conectado: true }).ml.motivo, /não retornou/)
})

caso('ML manual: só vale para a mesma semana; semana de outra data é ignorada com motivo; deltas vêm do histórico', () => {
  const manual = { semana_de: DE, periodo: '29/09/2026 a 05/10/2026', faturamento: 48350.9, vendas: 312, unidades: 405, visitas: 15800, conversao: 1.97, ticket_medio: 154.97 }
  const r = base({ manual, anteriorManual: { de: '2026-09-22', ate: '2026-09-28', faturamento: 43000, vendas: 300, unidades: 400, visitas: 16000, conversao: 1.9, ticket_medio: 150 } })
  assert.equal(r.ml.fonte, 'manual'); assert.equal(m(r.ml, 'faturamento').valor, 48350.9); assert.equal(m(r.ml, 'faturamento').delta.bom, true)
  assert.equal(m(r.ml, 'visitas').delta.bom, false)                                                      // visitas caíram
  assert.equal(m(r.ml, 'cancelamentos').valor, null); assert.match(m(r.ml, 'cancelamentos').motivo, /informados pela equipe/)   // sem jargão ("transcrito") no texto do cliente
  assert.deepEqual(r.anterior, { de: '2026-09-22', ate: '2026-09-28' })
  const velho = base({ manual: null, semanaIgnorada: '2026-09-08' })
  assert.equal(velho.ml.fonte, null); assert.match(velho.ml.motivo, /outra semana.*08\/09\/2026/)
  const api = base({ conectado: true, negocio, manual })                                                 // dado automático tem prioridade
  assert.equal(api.ml.fonte, 'api'); assert.equal(m(api.ml, 'faturamento').valor, 1000)
})

caso('ADS: API (com ACOS/TACOS/CTR/CPC derivados), indisponível com o motivo da API, manual com derivados', () => {
  const r = base({ conectado: true, negocio, ads: adsApi, acoesAds: ['Ajuste de campanha A'] })
  assert.equal(r.ads.fonte, 'api'); assert.deepEqual(r.ads.metricas.map(x => x.chave), ADS_CHAVES); assert.deepEqual(r.ads.acoes, ['Ajuste de campanha A'])
  assert.equal(m(r.ads, 'roas').valor, 5); assert.deepEqual(m(r.ads, 'roas').delta, { valor: 25, bom: true, pontos: false })
  assert.equal(m(r.ads, 'tacos').valor, 10); assert.equal(m(r.ads, 'tacos').extra, true)                // 100 ÷ 1000
  assert.equal(m(r.ads, 'tacos').delta.bom, true)                                                        // 100/800 = 12,5% → 10%: caiu (bom)
  assert.equal(m(r.ads, 'ctr').valor, 2); assert.equal(m(r.ads, 'cpc').valor, 0.5)                       // 200 ÷ 10000 e 100 ÷ 200
  assert.equal(m(r.ads, 'acos').delta.bom, true)                                                         // 25 → 20: menor é melhor
  assert.equal(m(r.ads, 'investimento').delta, null)                                                     // gastar mais não é bom nem ruim por si
  assert.equal(m(r.ads, 'roas').extra, false)
  const sem = base({ conectado: true, negocio, ads: { atual: { disponivel: false, motivo: 'nenhum gasto em Ads no período' } } })
  assert.equal(sem.ads.disponivel, false); assert.equal(sem.ads.motivo, 'nenhum gasto em Ads no período'); assert.ok(sem.ads.metricas.every(x => x.valor === null))
  const man = base({ manual: { faturamento: 1000, ads: { investimento: 100, receita: 500, impressoes: 10000, cliques: 200 } } })
  assert.equal(man.ads.fonte, 'manual'); assert.equal(m(man.ads, 'roas').valor, 5); assert.equal(m(man.ads, 'acos').valor, 20); assert.equal(m(man.ads, 'tacos').valor, 10)
  assert.equal(m(man.ads, 'vendas_atribuidas').valor, null); assert.match(m(man.ads, 'vendas_atribuidas').motivo, /informados/)
  assert.equal(base({ conectado: true, negocio, ads: null, manual: { ads: { investimento: 1 } } }).ads.fonte, null)   // com dado automático do ML a transcrição de Ads não entra
})

caso('outros canais: um por canal presente nas tarefas (exceto ML); sem API só com dado informado, print ou motivo', () => {
  const t = (id, processo) => ({ id, processo, titulo: id, status: 'concluida', data_conclusao: '2026-10-01' })
  const tarefas = [t('a', 'Mercado Livre'), t('b', 'Shopee'), t('c', 'Amazon'), t('d', 'TikTok'), t('e', 'Reunião')]
  const concluidas = [t('b', 'Shopee'), t('d', 'TikTok'), t('d2', 'TikTok'), t('c', 'Amazon')]
  const evPorTarefa = { d: [{ id: 'e1', tipo: 'image', legenda: 'painel de vendas' }], c: [{ id: 'e2', tipo: 'image', legenda: 'print da ação' }] }
  const ehMetrica = x => x.id === 'd' || x.id === 'c' && false
  const canaisManuais = { Shopee: { semana_de: DE, faturamento: 5000, vendas: 40, conversao: -3, visitas: '', ads: { investimento: 300, roas: 3 } }, Amazon: { semana_de: '2026-09-08', faturamento: 9999 } }
  const r = base({ tarefas, concluidas, evPorTarefa, ehMetrica, canaisManuais })
  assert.deepEqual(r.outros.map(o => o.canal), ['Shopee', 'Amazon', 'TikTok Shop'])                      // ordem da config de canais; "Reunião" não é canal
  const [sho, amz, ttk] = r.outros
  assert.ok(r.outros.every(o => o.tem_api === false && Array.isArray(o.metricas) && Array.isArray(o.evidencias)))
  assert.equal(sho.fonte, 'manual'); assert.equal(sho.motivo, null); assert.equal(m(sho, 'faturamento').valor, 5000); assert.equal(sho.acoes_semana, 1)
  assert.equal(m(sho, 'conversao').valor, null); assert.equal(m(sho, 'visitas').valor, null)             // negativo e '' = não informado, nunca 0
  assert.equal(m(sho, 'ads_investimento').valor, 300); assert.equal(m(sho, 'ads_roas').valor, 3)
  assert.equal(amz.fonte, null); assert.match(amz.motivo, /outra semana.*08\/09\/2026/); assert.ok(amz.metricas.every(x => x.valor === null))   // semana_de diferente: ignorada
  assert.equal(amz.evidencias.length, 0)                                                                  // print de AÇÃO não é print de painel
  assert.equal(ttk.fonte, 'print'); assert.equal(ttk.evidencias.length, 1); assert.equal(ttk.acoes_semana, 2); assert.ok(ttk.metricas.every(x => x.valor === null))
  const semDado = base({ tarefas: [t('b', 'Shopee')], concluidas: [], canaisManuais: {} }).outros[0]
  assert.equal(semDado.fonte, null); assert.match(semDado.motivo, /integração automática com Shopee.*nenhum dado/)
  assert.deepEqual(base({ tarefas: [t('a', 'Mercado Livre'), t('z', 'Reunião')] }).outros, [])           // sem canal fora do ML => lista vazia
  const semSemanaDe = base({ tarefas: [], canaisManuais: { Magalu: { faturamento: 10 } } }).outros          // canal só na planilha da equipe também aparece; sem semana_de vale sempre
  assert.equal(semSemanaDe[0].canal, 'Magalu'); assert.equal(semSemanaDe[0].fonte, 'manual')
})

// ── volume de atividades ─────────────────────────────────────────────────────────────────────────────────────────────
caso('volumeAtividades: por canal, equipe, evidência, andamento/atrasadas/bloqueadas', () => {
  const c = (id, processo, responsavel) => ({ id, processo, responsavel })
  const concluidas = [c('1', 'Mercado Livre', 'Ana'), c('2', 'Mercado Livre — Ads', 'Ana, Bruno'), c('3', 'Shopee', 'Bruno e Carla'), c('4', 'Shopee', ''), c('5', '', '—')]
  const v = R.volumeAtividades({ de: DE, ate: ATE, concluidas, concluidasAnterior: 2, abertas: [{ status: 'andamento' }, { status: 'validacao' }, { status: 'nao_iniciada' }, { status: 'bloqueada' }],
    atrasadas: [{}, {}], bloqueadas: [{}], otimizacoes: 3, acoesAds: 1, evPorTarefa: { 1: [{}], 3: [{}, {}] } })
  assert.deepEqual(v.concluidas, { atual: 5, anterior: 2, pct: 150 })
  assert.deepEqual(v.por_canal, [{ canal: 'Mercado Livre', n: 2 }, { canal: 'Shopee', n: 2 }, { canal: 'Sem canal', n: 1 }])
  assert.deepEqual(v.equipe, [{ nome: 'Ana', n: 2 }, { nome: 'Bruno', n: 2 }, { nome: 'Carla', n: 1 }])   // sem responsável não vira pessoa
  assert.deepEqual(v.com_evidencia, { n: 2, de: 5, pct: 40 }); assert.equal(v.em_andamento, 2); assert.equal(v.atrasadas, 2); assert.equal(v.bloqueadas, 1)
  assert.equal(v.otimizacoes, 3); assert.equal(v.acoes_ads, 1); assert.deepEqual(v.periodo, { de: DE, ate: ATE })
  const vazio = R.volumeAtividades({ de: DE, ate: ATE })
  assert.deepEqual(vazio.concluidas, { atual: 0, anterior: 0, pct: null }); assert.equal(vazio.com_evidencia.pct, null); assert.deepEqual(vazio.por_canal, [])
})

// ── tarefas que geraram resultado ────────────────────────────────────────────────────────────────────────────────────
const tarefa = o => ({ id: 't1', titulo: 'Otimizar títulos da linha X', processo: 'Mercado Livre', responsavel: 'Ana', status: 'concluida', data_conclusao: '2026-09-25',
  resultado_alcancado: '', impacto: '', tipo_demanda: 'Duplicação de Títulos', descricao: '', url: 'https://notion.so/t1', bloqueio: '', ...o })
// mesma forma que analisarCliente() devolve em `medidas` (campos conferidos em src/lib/impacto-tarefas.js)
const medida = o => ({ id: 't1', cliente: 'C', titulo: 'Otimizar títulos da linha X', tipo: 'Duplicação de Títulos', analista: 'Ana', url: 'https://notion.so/t1', data: '2026-09-25', data_estimada: false,
  itens: ['MLB123456789'], escopo: 'anuncios', lag: 5, janela_usada: 14, estado: 'melhorou', janelas: { pre: ['2026-09-11', '2026-09-24'], pos: ['2026-10-01', '2026-10-14'], pos_medida: ['2026-10-01', '2026-10-04'] },
  metrica_primaria: 'unidades', dias_pos: 9, metricas: { unidades: { antes: 2, depois: 3, razao: 1.5 }, receita: { antes: 100, depois: 150, razao: 1.5 }, visitas: { antes: 40, depois: 62, razao: 1.55 }, conversao: { antes: 5, depois: 4.8 } },
  efeito_pct: 38, efeito_bruto_pct: 50, controle: { razao: 1.1, base: 100 }, corrobora: { campo: 'visitas', pct: 30, base: 560 }, receita_estimavel: true, unidades_incrementais: 11, receita_incremental: 1500, receita_alocada: 1240, preco_ref: 50,
  confianca: { score: 72, classe: 'causa provável', cobertura: 100, criterios: {}, nota: 'Associação temporal ajustada por controle e ruído — não é causalidade comprovada.' },
  reversao_provavel: false, concorrentes: 0, eventos: [], subtipo: null, ...o })
const lanc = o => medida({ estado: 'lancamento', subtipo: 'novo', confianca: undefined, metrica_primaria: undefined, efeito_pct: undefined, receita_estimavel: undefined, controle: undefined, corrobora: undefined,
  metricas: { unidades: { antes: 0, depois: 0.8 }, receita: { antes: 0, depois: 40 }, visitas: { antes: 3, depois: 25 } }, lancamento: { unidades: 8, receita: 400, visitas: 250, vendeu: true, primeira_venda_dias: 6 }, receita_incremental: 400, receita_alocada: 400, ...o })
const obj = id => P.listarObjetivos().find(o => o.id === id)
const tr = (objetivo, extra = {}) => R.tarefasComResultado({ objetivo: obj(objetivo), objetivos: P.listarObjetivos(), ate: ATE, tarefas: [tarefa()], medidas: [medida()], ...extra })
const evs = { t1: [{ id: 'e1', tarefa_id: 't1', tipo: 'image', arquivo_local: 'evidencias/t1/1.png', legenda: 'print', criada_em: '2026-09-26' }] }

caso("'melhorou' vira resultado MEDIDO com causa provável, confiança, método, prints, links e dado conforme o objetivo", () => {
  const r = tr('faturamento', { evPorTarefa: evs, linksDe: () => [{ url: 'https://produto.mercadolivre.com.br/MLB-123456789', rotulo: 'Mercado Livre' }] })
  assert.equal(r.itens.length, 1); const it = r.itens[0]
  assert.equal(it.tipo, 'medido'); assert.equal(it.id, 't1'); assert.equal(it.canal, 'Mercado Livre'); assert.equal(it.responsavel, 'Ana'); assert.equal(it.concluida_em, '2026-09-25'); assert.equal(it.url, 'https://notion.so/t1')
  assert.equal(it.metrica.rotulo, 'Faturamento adicional (causa provável)'); assert.equal(it.metrica.texto, '+ R$ 1.240')
  assert.deepEqual(it.confianca, { nivel: 'media', pct: 72 }); assert.match(it.metodo, /associação temporal/); assert.match(it.metodo, /grupo de controle/)
  assert.match(it.resumo, /Causa provável, não prova/); assert.equal(it.evidencias.length, 1)
  assert.equal(it.links.length, 1)                                                                       // link do MLB citado dedupa com o do card
  assert.deepEqual(r.objetivo, { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita' })
  assert.equal(r.sem_efeito, 0); assert.equal(r.em_maturacao, 0); assert.equal(r.nota, '')
  assert.ok(!/comprovad/i.test(todosTextos({ ...r, itens: r.itens.map(({ metodo, resumo, metrica }) => ({ metodo, resumo, metrica })) })), 'nunca "comprovada"')
  const fraca = tr('faturamento', { medidas: [medida({ confianca: { score: 30, classe: 'hipótese fraca', cobertura: 100, criterios: {}, nota: '' } })] }).itens[0]
  assert.equal(fraca.confianca.nivel, 'baixa'); assert.match(fraca.metrica.rotulo, /hipótese — confiança baixa/); assert.match(fraca.resumo, /não trate como causa/)
  const rev = tr('faturamento', { medidas: [medida({ reversao_provavel: true, concorrentes: 2 })] }).itens[0]
  assert.match(rev.resumo, /retorno ao nível habitual/); assert.match(rev.resumo, /2 outra\(s\) tarefa\(s\)/)
  // preço mexendo junto na janela (fora do aprendizado): ao cliente, nunca "causa provável", e a ressalva do preço vai no resumo
  const pr = tr('faturamento', { medidas: [medida({ confundido_preco: true, variacao_preco_pct: -10 })] }).itens[0]
  assert.match(pr.metrica.rotulo, /hipótese — confiança baixa/); assert.match(pr.resumo, /o preço variou -10% na janela; parte do efeito pode ser do preço/); assert.ok(!/Causa provável/.test(pr.resumo))
  assert.match(tr('faturamento', { medidas: [medida({ data_estimada: true })] }).itens[0].metodo, /estimada/)
})

caso('cada objetivo escolhe o dado certo da mesma tarefa medida', () => {
  const it = o => tr(o).itens[0]
  assert.equal(it('visibilidade').metrica.rotulo, 'Visitas por dia (variação observada, não ajustada)'); assert.equal(it('visibilidade').metrica.texto, 'de 40 para 62 visitas/dia')   // primária = unidades: visitas brutas (rev. #7)
  assert.equal(it('conversao').metrica.rotulo, 'Faturamento adicional (causa provável)'); assert.equal(it('conversao').metrica.texto, '+ R$ 1.240')   // conversão caiu (5% → 4,8%): não vira resultado, mostra o medido (rev. #7)
  assert.match(it('conversao').resumo, /Conversão sem alta medida/)
  const adsT = tr('ads', { tarefas: [tarefa({ titulo: 'Ajuste de campanha Ads' })], medidas: [medida({ titulo: 'Ajuste de campanha Ads' })] }).itens[0]
  assert.match(adsT.metrica.rotulo, /Vendas do anúncio após o ajuste de Ads/); assert.equal(adsT.metrica.texto, '+ R$ 1.240'); assert.match(adsT.resumo, /bloco ADS/)
  const viaVisitas = medida({ metrica_primaria: 'visitas', receita_estimavel: false, receita_alocada: 0 })
  const v = tr('visibilidade', { medidas: [viaVisitas] }).itens[0]; assert.match(v.metrica.texto, /de 40 para 62 visitas\/dia · \+38% ajustado pelo restante da conta/)
  const semR = tr('faturamento', { medidas: [viaVisitas] }).itens[0]                                      // sem estimativa em R$: mostra o efeito medido, não inventa reais
  assert.equal(semR.metrica.rotulo, 'Efeito em visitas (causa provável)'); assert.equal(semR.metrica.texto, '+38% ajustado pelo restante da conta'); assert.match(semR.resumo, /Sem estimativa em R\$/)
  const semVis = tr('visibilidade', { medidas: [medida({ metricas: { unidades: { antes: 2, depois: 3 } } })] }).itens[0]   // objetivo pede visitas, anúncio sem série de visitas
  assert.match(semVis.resumo, /Visitas não medidas/); assert.match(semVis.metrica.rotulo, /Faturamento adicional/)
  const semConv = tr('conversao', { medidas: [medida({ metricas: { unidades: { antes: 2, depois: 3 } } })] }).itens[0]
  assert.match(semConv.resumo, /Conversão não medida/)
  // margem: com custo informado estima a margem sobre o faturamento associado; sem custo cai em faturamento com nota honesta
  const mg = tr('margem', { margemPct: 25 }); assert.equal(mg.itens[0].metrica.texto, '+ R$ 310'); assert.match(mg.itens[0].metrica.rotulo, /Margem adicional estimada/); assert.match(mg.itens[0].resumo, /25% informada/); assert.equal(mg.objetivo.id, 'margem'); assert.equal(mg.nota, '')
  const sc = tr('margem'); assert.equal(sc.objetivo.id, 'faturamento'); assert.equal(sc.objetivo_pedido, 'margem'); assert.match(sc.nota, /exige custos informados/); assert.equal(sc.itens[0].metrica.texto, '+ R$ 1.240')
  assert.match(tr('margem', { margemPct: 0 }).nota, /zero ou negativa/); assert.equal(tr('margem', { margemPct: -5 }).objetivo.id, 'faturamento')
  // lançamentos: só lançamento que vendeu; ads: só tarefas de Ads
  assert.equal(tr('lancamentos').itens.length, 0)
  const l = tr('lancamentos', { medidas: [lanc()] }); assert.equal(l.itens[0].metrica.rotulo, 'Anúncio novo que passou a vender'); assert.equal(l.itens[0].metrica.texto, '8 un. · R$ 400 em 9 dias')
  assert.equal(tr('lancamentos', { medidas: [lanc({ subtipo: 'reativado' })] }).itens[0].metrica.rotulo, 'Anúncio reativado que voltou a vender')
  assert.equal(tr('ads', { tarefas: [tarefa({ titulo: 'Ajuste de campanha Ads' })], medidas: [medida({ titulo: 'Ajuste de campanha Ads' })] }).itens.length, 1)
  assert.equal(tr('ads').itens.length, 0)                                                                 // tarefa de título não é Ads
})

caso("lançamento que vendeu é MEDIDO sem confiança (observação direta); em qualquer objetivo mostra o dado do objetivo", () => {
  const f = tr('faturamento', { medidas: [lanc()] }).itens[0]
  assert.equal(f.tipo, 'medido'); assert.equal(f.confianca, null); assert.equal(f.metrica.rotulo, 'Faturamento do anúncio que passou a vender'); assert.equal(f.metrica.texto, 'R$ 400 em 8 un. (9 dias medidos)')
  assert.match(f.metodo, /Sem grupo de controle/); assert.match(f.metodo, /não prova que a tarefa foi a causa/)
  assert.equal(tr('visibilidade', { medidas: [lanc()] }).itens[0].metrica.texto, 'de 3 para 25 visitas/dia')
  assert.equal(tr('conversao', { medidas: [lanc()] }).itens[0].metrica.texto, '3,2% (8 vendas em 250 visitas)')
  assert.match(tr('margem', { margemPct: 50, medidas: [lanc()] }).itens[0].metrica.texto, /R\$ 200/)
  const semVenda = tr('faturamento', { medidas: [lanc({ lancamento: { unidades: 0, receita: 0, visitas: 40, vendeu: false, primeira_venda_dias: null } })] })
  assert.equal(semVenda.itens.length, 0); assert.equal(semVenda.sem_efeito, 1)                             // anúncio lançado que não vendeu = sem efeito
})

caso("'sem_efeito', 'piorou', 'em_maturacao' e não medidas NÃO viram resultado; viram contagens honestas", () => {
  const ts = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => tarefa({ id, titulo: 'Tarefa ' + id }))
  const medidas = [
    medida({ id: 'a', estado: 'sem_efeito' }), medida({ id: 'b', estado: 'piorou', efeito_pct: -30 }), medida({ id: 'c', estado: 'em_maturacao' }),
    medida({ id: 'd', estado: 'sem_base' }), medida({ id: 'e', estado: 'sem_controle' }), medida({ id: 'f', estado: 'variacao_conta' }),
  ]
  const r = tr('faturamento', { tarefas: ts, medidas })
  assert.equal(r.itens.length, 0); assert.equal(r.sem_efeito, 1); assert.equal(r.em_maturacao, 1); assert.equal(r.piorou, 1)
  assert.match(r.nota, /Nenhuma tarefa concluída nos últimos 45 dias tem resultado medido ou informado/)
  assert.match(r.nota, /1 tarefa\(s\) medida\(s\) sem efeito distinguível/); assert.match(r.nota, /1 ainda sem prazo suficiente/); assert.match(r.nota, /3 sem base para medir/)
  assert.match(r.nota, /só existe para tarefas do Mercado Livre com o anúncio \(MLB\) citado/)
  assert.ok(!/pior/i.test(r.nota))                                                                        // 'piorou' é contado para uso interno, não entra no texto do cliente
  const mix = tr('faturamento', { tarefas: [...ts, tarefa()], medidas: [...medidas, medida()] })
  assert.equal(mix.itens.length, 1); assert.match(mix.nota, /Lista parcial — além dos itens acima/)
})

caso('resultado INFORMADO do card: rotulado, separado do medido, placeholder vazio ignorado, janela e visibilidade respeitadas', () => {
  const inf = tarefa({ id: 'i1', titulo: 'Ação do Dia dos Pais', resultado_alcancado: 'Pedidos subiram 20% na semana', impacto: 'Melhor semana do trimestre', data_conclusao: '2026-10-01', processo: 'Shopee' })
  const r = tr('faturamento', { tarefas: [tarefa(), inf, tarefa({ id: 'i2', resultado_alcancado: '—', impacto: 'n/a' }), tarefa({ id: 'i3', resultado_alcancado: 'velho', data_conclusao: '2026-08-01' }),
    tarefa({ id: 'i4', resultado_alcancado: 'aberta', status: 'andamento' }), tarefa({ id: 'i5', impacto: 'Só impacto', data_conclusao: '2026-09-20' })], evPorTarefa: { i1: [{ id: 'x' }] } })
  assert.deepEqual(r.itens.map(i => [i.id, i.tipo]), [['t1', 'medido'], ['i1', 'informado'], ['i5', 'informado']])   // medido primeiro, informados por data (mais novo antes)
  const i1 = r.itens[1]
  assert.equal(i1.metrica.rotulo, 'Resultado informado pela equipe'); assert.equal(i1.metrica.texto, 'Pedidos subiram 20% na semana'); assert.equal(i1.confianca, null); assert.equal(i1.canal, 'Shopee')
  assert.match(i1.resumo, /Impacto informado: Melhor semana do trimestre/); assert.match(i1.metodo, /não medido pelo sistema/); assert.equal(i1.evidencias.length, 1)
  assert.equal(r.itens[2].metrica.rotulo, 'Impacto informado pela equipe')
  assert.equal(r.itens.filter(i => i.id === 'i2' || i.id === 'i3' || i.id === 'i4').length, 0)             // vazio, fora da janela de 45 dias, não concluída
  assert.equal(R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE, janelaDias: 90, tarefas: [tarefa({ id: 'i3', resultado_alcancado: 'velho', data_conclusao: '2026-08-01' })] }).itens.length, 1)   // janela configurável
  // medida de tarefa que o cliente NÃO vê (fora de `tarefas`) nunca entra, nem nas contagens
  const oculta = R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE, tarefas: [], medidas: [medida()] })
  assert.equal(oculta.itens.length, 0); assert.equal(oculta.sem_efeito, 0)
  // medida fora da janela de conclusão não entra
  assert.equal(tr('faturamento', { medidas: [medida({ data: '2026-07-01' })] }).itens.length, 0)
  assert.equal(tr('faturamento', { medidas: [medida({ data: '2026-10-06' })] }).itens.length, 0)           // depois do fim do período também não
  const longo = 'x'.repeat(500); assert.ok(tr('faturamento', { tarefas: [tarefa({ id: 'l', resultado_alcancado: longo })], medidas: [] }).itens[0].metrica.texto.length <= 300)
  const ads = R.tarefasComResultado({ objetivo: obj('ads'), ate: ATE, tarefas: [inf, tarefa({ id: 'ad', titulo: 'Ajuste de Ads', resultado_alcancado: 'ROAS subiu' })] })
  assert.deepEqual(ads.itens.map(i => i.id), ['ad'])                                                       // objetivo Ads: informados só das tarefas de Ads
})

caso('lista vazia honesta e medição indisponível', () => {
  const vazio = R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE, tarefas: [], medidas: [] })
  assert.equal(vazio.itens.length, 0); assert.match(vazio.nota, /Nenhuma tarefa concluída nos últimos 45 dias/); assert.equal(vazio.sem_efeito, 0)
  assert.doesNotMatch(vazio.nota, /Sem histórico de vendas/)                                               // [] = medição rodou e não achou nada
  assert.match(R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE, tarefas: [], medidas: null }).nota, /Sem histórico de vendas do Mercado Livre/)
  assert.match(R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE, tarefas: [], medidas: null, erroMedicao: 'x' }).nota, /medição automática não pôde ser calculada/)
  const comInformado = R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE, tarefas: [tarefa({ resultado_alcancado: 'ok' })], medidas: null })
  assert.equal(comInformado.itens.length, 1); assert.match(comInformado.nota, /Sem histórico/)             // sem ML: ainda aparece o informado
  assert.deepEqual(R.tarefasComResultado({ objetivo: obj('faturamento'), ate: ATE }).itens, [])             // entradas omitidas não quebram
})

caso('ordem dos medidos: maior R$ associado primeiro; responsável vazio vira "—"', () => {
  const ts = [tarefa({ id: 'p', responsavel: '' }), tarefa({ id: 'g' })]
  const r = tr('faturamento', { tarefas: ts, medidas: [medida({ id: 'p', receita_alocada: 100 }), medida({ id: 'g', receita_alocada: 5000 })] })
  assert.deepEqual(r.itens.map(i => i.id), ['g', 'p']); assert.equal(r.itens[1].responsavel, '—'); assert.ok(r.itens.every(i => !('peso' in i)))
})

// ── situação da conta ────────────────────────────────────────────────────────────────────────────────────────────────
caso('situacaoDaConta: verde só com 0 atrasadas e 0 bloqueadas; amarelo lista cada ponto com responsável e prazo; só fatos', () => {
  const plano = { anoMes: '2026-10', total: 10, concluidas: 4, pct: 40 }
  const ok = R.situacaoDaConta({ atrasadas: [], bloqueadas: [], plano, hoje: ATE })
  assert.equal(ok.nivel, 'ok'); assert.match(ok.titulo, /em dia/); assert.deepEqual(ok.itens, [{ texto: 'Plano de 2026-10: 4 de 10 ações concluídas (40%).', tom: 'ok' }])
  const t1 = { id: 'b', titulo: 'Subir fotos', bloqueio: 'Aguardando cliente enviar imagens', responsavel: 'Ana', prazo: '2026-10-01' }, t2 = { id: 'a', titulo: 'Revisar preços', responsavel: 'Bruno', prazo: '2026-09-30' }
  const am = R.situacaoDaConta({ atrasadas: [t1, t2], bloqueadas: [t1], plano, hoje: ATE })              // t1 é bloqueada E atrasada: aparece uma vez
  assert.equal(am.nivel, 'atencao'); assert.match(am.titulo, /2 ponto\(s\) pedem atenção — 1 bloqueada\(s\), 1 atrasada\(s\)/)
  const aten = am.itens.filter(i => i.tom === 'atencao'); assert.equal(aten.length, 2)
  assert.match(aten[0].texto, /Subir fotos — bloqueada: Aguardando cliente enviar imagens · responsável: Ana · prazo 01\/10\/2026 \(4 dia\(s\) de atraso\)/)
  assert.match(aten[1].texto, /Revisar preços — atrasada · responsável: Bruno · prazo 30\/09\/2026/)
  assert.equal(R.situacaoDaConta({ atrasadas: [], bloqueadas: [{ id: 'x', titulo: 'T', responsavel: 'Z' }], plano, hoje: ATE }).nivel, 'atencao')   // 1 bloqueada basta; sem prazo = dito
  assert.match(R.situacaoDaConta({ bloqueadas: [{ id: 'x', titulo: 'T' }], plano }).itens[0].texto, /sem prazo definido/)
  assert.match(R.situacaoDaConta({ plano: { anoMes: '2026-10', total: 0, concluidas: 0, pct: 0 } }).itens[0].texto, /nenhuma ação registrada/)
})

caso('utilitários: delta/deltaPct/canalDe e pureza do módulo', () => {
  assert.equal(R.deltaPct(120, 100), 20); assert.equal(R.deltaPct(1, 0), null); assert.equal(R.delta(1, 0), null); assert.equal(R.delta(null, 5), null)
  assert.deepEqual(R.delta(3, 5, { invertido: true }), { valor: -40, bom: true, pontos: false })
  assert.deepEqual(['Mercado Livre — Ads', 'ML', 'Shopee Ads', 'TikTok', 'Reunião', ''].map(R.canalDe), ['Mercado Livre', 'Mercado Livre', 'Shopee', 'TikTok Shop', null, null])
  assert.equal(R.br('2026-10-05'), '05/10/2026'); assert.equal(R.br(null), '—')
  const fonte = readFileSync(new URL('../src/lib/semanal-resultados.js', import.meta.url), 'utf-8')
  assert.ok(!/^import\s/m.test(fonte), 'semanal-resultados.js é puro: nenhum import (banco, rede, arquivo)')
})

// ── regressões da revisão adversarial (frente SEMANAL-DADOS) ─────────────────────────────────────────────────────────
const fonteSemanal = () => readFileSync(new URL('../src/lib/semanal.js', import.meta.url), 'utf-8')

caso('rev #1: tarefa medida como piorou / sem efeito / lançamento sem venda não entra nem como informado', () => {
  const ts = [tarefa({ id: 'p1', titulo: 'Troca de fotos MLB1234567890', resultado_alcancado: 'Vendas subiram depois da troca das fotos' }),
    tarefa({ id: 's1', resultado_alcancado: 'Melhorou' }), tarefa({ id: 'l1', resultado_alcancado: 'Anúncio publicado' }), tarefa({ id: 'ok', resultado_alcancado: 'Pedidos subiram' })]
  const r = tr('faturamento', { tarefas: ts, medidas: [medida({ id: 'p1', estado: 'piorou', efeito_pct: -35 }), medida({ id: 's1', estado: 'sem_efeito' }),
    lanc({ id: 'l1', lancamento: { unidades: 0, receita: 0, visitas: 40, vendeu: false } }), medida({ id: 'ok', estado: 'em_maturacao' })] })
  assert.deepEqual(r.itens.map(i => [i.id, i.tipo]), [['ok', 'informado']]); assert.equal(r.piorou, 1)   // em maturação ainda pode ter o informado
})

caso('rev #7: visitas/conversão brutas não são "causa provável"; queda nunca é listada como resultado', () => {
  const caiu = medida({ metricas: { unidades: { antes: 2, depois: 3 }, visitas: { antes: 120, depois: 90 }, conversao: { antes: 5, depois: 3.1 } } })
  for (const o of ['visibilidade', 'conversao']) {
    const it = tr(o, { medidas: [caiu] }).itens[0]
    assert.equal(it.metrica.rotulo, 'Faturamento adicional (causa provável)', o); assert.ok(!/90|3,1/.test(it.metrica.texto), o)
  }
  const subiu = medida({ metricas: { unidades: { antes: 2, depois: 3 }, visitas: { antes: 40, depois: 62 }, conversao: { antes: 3, depois: 4 } } })
  assert.equal(tr('conversao', { medidas: [subiu] }).itens[0].metrica.rotulo, 'Conversão (variação observada, não ajustada)')
  assert.equal(tr('visibilidade', { medidas: [subiu] }).itens[0].metrica.rotulo, 'Visitas por dia (variação observada, não ajustada)')
  assert.equal(tr('visibilidade', { medidas: [medida({ metrica_primaria: 'visitas' })] }).itens[0].metrica.rotulo, 'Visitas por dia (causa provável)')   // primária, com controle
})

caso('rev #8: cancelamentos/devoluções/valor cancelado não viram "melhora" quando a base de vendas caiu', () => {
  const ng = { atual: { ...negocio.atual, vendas: 20, faturamento: 2000, vendas_canceladas: 2, vendas_devolvidas: 1, valor_cancelado: 200 },
    anterior: { ...negocio.anterior, vendas: 200, faturamento: 20000, vendas_canceladas: 10, vendas_devolvidas: 5, valor_cancelado: 1000 } }
  const r = base({ conectado: true, negocio: ng })
  for (const k of ['cancelamentos', 'devolucoes', 'valor_cancelado']) assert.equal(m(r.ml, k).delta, null, k)          // número caiu, taxa dobrou: sem cor
  const ok = base({ conectado: true, negocio: { atual: { ...ng.atual, vendas: 200, faturamento: 20000 }, anterior: ng.anterior } })
  assert.deepEqual(m(ok.ml, 'cancelamentos').delta, { valor: -80, bom: true, pontos: false })                           // mesma base: queda real
  assert.equal(base({ conectado: true, negocio: { atual: { ...ng.atual, vendas: 200, vendas_canceladas: 20 }, anterior: ng.anterior } }).ml.metricas.find(x => x.chave === 'cancelamentos').delta.bom, false)
  assert.ok(!R.montarDestaques({ negocioComp: ng }).destaques.some(d => /cancel|devolu/i.test(d.rotulo)))
})

caso('rev #10: "Ações executadas no mesmo período" (destaques do ML) só com ações do canal Mercado Livre', () => {
  const d = R.montarDestaques({ negocioComp: { atual: { faturamento: 30000 }, anterior: { faturamento: 20000 } },
    otimizacoes: [{ titulo: 'Ajuste de preço kit toalhas', processo: 'Mercado Livre' }],
    acoes: [{ titulo: 'Ajuste de preço kit toalhas', processo: 'Mercado Livre' }, { titulo: 'Ajuste de preço na Amazon (ASIN B0ABCDEFGH)', processo: 'Amazon' }, { titulo: 'Revisão de título Shopee', processo: 'Shopee' }] })
  assert.deepEqual(d.acoes_relacionadas, ['Ajuste de preço kit toalhas']); assert.equal(d.destaques[0].rotulo, 'Faturamento')
})

caso('rev #11: transcrição manual vale se o período declarado cobrir ≥ 4 dos 7 dias; o bloco mostra o período declarado', () => {
  assert.deepEqual(R.periodoManual({ semana_de: '2026-09-08' }, '2026-09-05', '2026-09-11'), { de: '2026-09-08', ate: '2026-09-14', declarado: true })   // 08–11/09 = 4 dias
  assert.equal(R.periodoManual({ semana_de: '2026-09-09' }, '2026-09-05', '2026-09-11'), null)                          // só 3 dias
  assert.equal(R.periodoManual({ semana_de: '2026-09-08' }, DE, ATE), null)
  assert.equal(R.periodoManual({ semana_de: '2026-09-27', semana_ate: '2026-10-03' }, DE, ATE).ate, '2026-10-03')
  assert.equal(R.periodoManual({ semana_de: '08/09/2026' }, DE, ATE), null)                                              // data malformada: ignora
  assert.equal(R.periodoManual({}, DE, ATE).declarado, false)                                                           // sem semana_de: vale (regra antiga)
  const r = R.montarResultados({ de: '2026-09-05', ate: '2026-09-11', manual: { semana_de: '2026-09-08', faturamento: 48350.9, vendas: 312, ads: { investimento: 100, receita: 500 } } })
  assert.equal(r.ml.fonte, 'manual'); assert.match(r.ml.aviso, /08\/09\/2026 a 14\/09\/2026/); assert.equal(r.ads.fonte, 'manual'); assert.match(r.ads.aviso, /08\/09\/2026 a 14\/09\/2026/)
  const sho = base({ canaisManuais: { Shopee: { semana_de: '2026-09-26', faturamento: 5000 } } }).outros[0]               // 29/09–02/10 = 4 dias do relatório
  assert.equal(sho.fonte, 'manual'); assert.match(sho.aviso, /26\/09\/2026 a 02\/10\/2026/)
})

caso('rev #12: faturamento semanal só com janelas de 7 dias sem sobreposição; histórico só grava 7 dias; anterior de mesma duração', () => {
  const linhas = [['2026-09-01', '2026-09-30'], ['2026-09-26', '2026-10-02'], ['2026-09-29', '2026-10-05'], ['2026-09-19', '2026-09-25'], ['2026-09-22', '2026-09-28']]
    .map(([de, ate], i) => ({ de, ate, faturamento: 100 + i }))
  assert.deepEqual(R.semanasNaoSobrepostas(linhas).map(l => l.de), ['2026-09-22', '2026-09-29'])
  assert.equal(R.semanasNaoSobrepostas(linhas, 1).length, 1)
  const f = fonteSemanal()
  assert.match(f, /function gravarMetricasSemana\(cliente, de, ate, m\) \{\s*if \(diasAntes\(ate, 6\) !== de\) return/)
  assert.match(f, /FROM metricas_semana WHERE cliente = \? AND de = \? AND ate = \?/); assert.match(f, /semanasNaoSobrepostas\(db\.prepare/)
})

caso('rev #13: período com o dia de hoje sai marcado como parcial (até HH:MM), sem "mesma duração"', () => {
  assert.deepEqual(base({ parcial: { ate_hora: '09:15' } }).periodo_parcial, { ate_hora: '09:15' })
  assert.equal(base({}).periodo_parcial, null)
  assert.match(fonteSemanal(), /parcial: ate >= hoje \? \{ ate_hora:/)
})

caso('rev #23: sem venda, ticket e preço por unidade = null + "sem vendas no período" (nunca R$ 0,00 ▼100%)', () => {
  const r = base({ conectado: true, negocio: { atual: { ...negocio.atual, faturamento: 0, vendas: 0, unidades: 0, preco_medio_venda: 0, preco_medio_unidade: 0, conversao: 0 }, anterior: negocio.anterior } })
  for (const k of ['ticket_medio', 'preco_medio_unidade']) { assert.equal(m(r.ml, k).valor, null, k); assert.equal(m(r.ml, k).delta, null, k); assert.equal(m(r.ml, k).motivo, 'sem vendas no período', k) }
  assert.equal(m(r.ml, 'faturamento').valor, 0)                                                                        // a API respondeu: faturamento 0 é fato; ticket é indefinido
})

caso('rev #25: datas/horas do Notion e do servidor exibidas no fuso de São Paulo', () => {
  assert.equal(R.horaSP('2026-10-03T01:10:00.000Z'), '2026-10-02 22:10')
  assert.equal(R.horaSP('2026-10-01T02:30:00.000Z').slice(0, 10), '2026-09-30')                                        // print das 23h30 de 30/09
  assert.equal(R.horaSP('2026-09-26'), '2026-09-26'); assert.equal(R.horaSP(''), ''); assert.equal(R.horaSP(null), '')
  const f = fonteSemanal()
  assert.match(f, /ultima_atualizacao: getEstado\('ultimo_sync'\) \? horaSP\(/); assert.match(f, /e\.criada_em = horaSP\(e\.criada_em\)/)
  assert.match(f, /gerado_em: [^\n]*timeZone: 'America\/Sao_Paulo'/)
})

caso('rev #26: print de ação que só cita conversão/visitas não é print de painel', () => {
  const t = { id: 'x', titulo: 'Melhorar conversão do anúncio de toalha (novas fotos)', processo: 'Shopee', status: 'concluida', data_conclusao: '2026-10-01' }
  const acao = { id: 'e1', legenda: 'Antes e depois das fotos' }, painel = { id: 'e2', legenda: 'Painel de métricas da Shopee' }
  assert.equal(R.ehPainel(t, acao), false); assert.equal(R.ehPainel(t, painel), true); assert.equal(R.ehPainel({ titulo: 'Coleta de métricas da semana' }, acao), true)
  const so = base({ tarefas: [t], concluidas: [t], evPorTarefa: { x: [acao] }, ehMetrica: R.ehPainel }).outros[0]
  assert.equal(so.fonte, null); assert.equal(so.evidencias.length, 0)
  const ok = base({ tarefas: [t], concluidas: [t], evPorTarefa: { x: [acao, painel] }, ehMetrica: R.ehPainel }).outros[0]
  assert.equal(ok.fonte, 'print'); assert.deepEqual(ok.evidencias.map(e => e.id), ['e2'])                                // só o print do painel, não o da ação
  assert.match(fonteSemanal(), /const ehMetrica = ehPainel/)
})

caso('rev #27: RX_ADS casa patrocinados/campanhas/product ads/ACOS/ROAS; lançamento não casa Balanço/Publicidade', () => {
  for (const s of ['Anúncios patrocinados revisados', 'Ajuste das campanhas no ML', 'Product Ads pausado', 'ACOS acima da meta', 'ROAS da semana', 'Campanha nova']) assert.ok(R.RX_ADS.test(s), s)
  for (const s of ['Balanço de estoque do CD', 'Publicidade institucional', 'Uploads de fotos']) assert.ok(!R.RX_ADS.test(s), s)
  const l = R.tarefasComResultado({ objetivo: obj('lancamentos'), ate: ATE, tarefas: [
    tarefa({ id: 'b', titulo: 'Balanço de estoque do CD', resultado_alcancado: 'Estoque conferido' }), tarefa({ id: 'pb', titulo: 'Publicidade no Instagram', resultado_alcancado: 'Post feito' }),
    tarefa({ id: 'n', titulo: 'Publicação de anúncio novo', resultado_alcancado: 'Anúncio no ar' }), tarefa({ id: 'c', titulo: 'Lançamento do kit verão', resultado_alcancado: 'Kit no ar' })] })
  assert.deepEqual(l.itens.map(i => i.id).sort(), ['c', 'n'])
})

caso('rev #28: motivo técnico da API de Ads vira frase para o cliente; detalhe só no aviso interno', () => {
  const r = base({ conectado: true, negocio: { atual: { faturamento: 100 } }, ads: { atual: { disponivel: false, motivo: 'API de Ads retornou 403' } } })
  assert.equal(r.ads.motivo, 'Dados de anúncios indisponíveis nesta semana; os números não foram estimados.'); assert.ok(!/403|API/.test(r.ads.motivo))
  assert.equal(base({ conectado: true, negocio, ads: { atual: { disponivel: false, motivo: 'nenhum gasto em Ads no período' } } }).ads.motivo, 'nenhum gasto em Ads no período')
  assert.match(fonteSemanal(), /avisosMeli\.push\(`Ads do Mercado Livre: \$\{adsComp\.atual\.motivo\}`\)/)
})

caso('rev #33: ids herdados de Object (constructor, __proto__, toString) são rejeitados e nunca gravados', () => {
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.throws(() => P.mesclarRegras([id]), e => e.status === 400, id)
  const h = new Database(':memory:'), { perfilDoCliente, salvarPerfil } = P.criarPerfis(h)
  assert.throws(() => salvarPerfil({ cliente: 'X', perfis: ['constructor'], objetivo: 'faturamento', por: 't' }), e => e.status === 400)
  assert.throws(() => salvarPerfil({ cliente: 'X', perfis: ['direto'], objetivo: 'toString', por: 't' }), /objetivo desconhecido/)
  assert.throws(() => perfilDoCliente('Y', { perfis: 'hasOwnProperty' }), e => e.status === 400)
  assert.throws(() => perfilDoCliente('Y', { objetivo: '__proto__' }), /objetivo desconhecido/)
  assert.equal(h.prepare('SELECT COUNT(*) n FROM perfil_cliente').get().n, 0)
  h.prepare("INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, atualizado_em, por) VALUES ('Z', '[\"constructor\"]', 'toString', '2026-10-01', 'x')").run()
  const z = perfilDoCliente('Z'); assert.equal(z.origem, 'padrao'); assert.equal(z.objetivo.id, 'faturamento'); assert.equal(z.avisos.length, 2)
})

caso('dependência do cliente: depende_cliente no volume, NÃO muda o nível da situação (vira item △); o semanal lista pelo registro, sem nome interno', () => {
  const dep = { id: 'd1', titulo: 'Subir fotos', texto: 'Fotos do produto: 12 SKUs', desde: '2026-09-20', dias: 15, url: 'https://notion.so/d1', responsavel: 'Ana' }
  const v = R.volumeAtividades({ de: DE, ate: ATE, abertas: [{ status: 'andamento' }], dependencias: [dep] })
  assert.equal(v.depende_cliente, 1); assert.equal(v.em_andamento, 1); assert.equal(v.bloqueadas, 0); assert.equal(v.atrasadas, 0)   // fora de abertas/atrasadas/bloqueadas
  assert.equal(R.volumeAtividades({ de: DE, ate: ATE }).depende_cliente, 0)
  const plano = { anoMes: '2026-10', total: 10, concluidas: 4, pct: 40 }
  const s = R.situacaoDaConta({ atrasadas: [], bloqueadas: [], dependencias: [dep], plano, hoje: ATE })
  assert.equal(s.nivel, 'ok'); assert.match(s.titulo, /em dia/)                                                       // verde continua
  assert.deepEqual(s.itens[0], { texto: '1 tarefa(s) aguardam um retorno seu — veja Pontos de atenção', tom: 'atencao' })
  assert.ok(!JSON.stringify(s).includes('Ana'), 'nome interno não entra na situação')
  const am = R.situacaoDaConta({ atrasadas: [{ id: 'a', titulo: 'X', prazo: '2026-09-30' }], bloqueadas: [], dependencias: [dep, dep], plano, hoje: ATE })
  assert.equal(am.nivel, 'atencao'); assert.match(am.titulo, /1 ponto\(s\) pedem atenção — 0 bloqueada\(s\), 1 atrasada\(s\)/)   // a dependência não conta no título
  assert.equal(am.itens.filter(i => /2 tarefa\(s\) aguardam um retorno seu/.test(i.texto)).length, 1)
  const f = fonteSemanal()
  assert.match(f, /const dependencias = idsDep\.length \? listarDependencias\(\{ ids: idsDep, hoje \}\) : \[\]/, 'tipo/detalhe/desde vêm de dependencia-cliente.listar, no recorte visível')
  assert.match(f, /tipo: 'Depende de você', texto: `\$\{d\.titulo\} — \$\{d\.texto\} · \$\{esperaDe\(d\)\}`[^\n]*responsavel: '', prazo: null/, '"Depende de você" sem nome interno')
  assert.match(f, /volumeAtividades\(\{[^\n]*\bdependencias,/); assert.match(f, /situacaoDaConta\(\{ atrasadas, bloqueadas, dependencias, plano, hoje \}\)/)
  assert.match(f, /\.\.\.dependencias\.map\(d => proximo\(d, d\.texto\)\)/, 'proximos[].dependencia_cliente vem do registro')
  assert.ok(!/dependeDoCliente|\/cliente\/i\.test\(t\.bloqueio\)/.test(f), 'o campo bloqueio (vazio nas tarefas reais) não decide mais "Depende de você"')
})

// rev #9: falha na consulta de pedidos CANCELADOS = null (→ "—" + motivo no bloco), nunca "0 cancelamentos". meli-api.js roda com
// meli-contas.js trocado por um stub (hook de módulo: nada de banco) e fetch falso (nada de rede).
{
  const nome = 'rev #9: consulta de cancelados com 403 vira null + motivo, nunca 0'
  const { register } = await import('node:module')
  const stub = 'data:text/javascript,' + encodeURIComponent("export const tokenValido = async () => 'tk'; export const idDoVendedor = () => 123")
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, n) { return s === './meli-contas.js' && c.parentURL?.endsWith('/src/lib/meli-api.js') ? { url: ${JSON.stringify(stub)}, shortCircuit: true } : n(s, c) }`))
  const fetchOrig = globalThis.fetch
  const resp = (status, corpo) => ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) })
  globalThis.fetch = async url => url.includes('order.status=cancelled') ? resp(403, { message: 'forbidden' })
    : url.includes('/orders/search') ? resp(200, { results: [{ order_items: [{ unit_price: 100, quantity: 2 }] }], paging: { total: 1 } })
    : url.includes('items_visits') ? resp(200, { total_visits: 50 }) : resp(404, {})
  try {
    const n = await (await import('../src/lib/meli-api.js')).relatorioNegocio('C', { de: DE, ate: ATE })
    assert.equal(n.vendas, 1); assert.equal(n.faturamento, 200); assert.equal(n.vendas_canceladas, null); assert.equal(n.valor_cancelado, null)
    const r = base({ conectado: true, negocio: { atual: n, anterior: { ...n, vendas_canceladas: 3, valor_cancelado: 300 } } })
    assert.equal(m(r.ml, 'cancelamentos').valor, null); assert.ok(m(r.ml, 'cancelamentos').motivo); assert.equal(m(r.ml, 'valor_cancelado').delta, null)
    console.log('✔', nome)
  } catch (e) { falhas++; console.log('✘', nome, '\n   ', e.message.split('\n').slice(0, 6).join('\n    ')) } finally { globalThis.fetch = fetchOrig }
}

if (falhas) { console.log(`\n${falhas} caso(s) falharam`); process.exit(1) }
console.log('\nTodos os casos passaram.')
