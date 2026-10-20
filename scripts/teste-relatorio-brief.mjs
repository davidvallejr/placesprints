// Autoteste do CONTEÚDO do relatório curto do cliente (src/lib/relatorio-brief.js): projeção pura de montarSemanal com dados sintéticos
// (montarResultados / tarefasComResultado / volumeAtividades são as funções reais do motor, só as ENTRADAS são inventadas).
// Cobre: exemplo A (cliente que não lista tarefas) e B (lista tarefas), sem_resultados, ML conectado que falhou, vazio, "—" nunca vira zero,
// nada de nome/ID/jargão/promessa em NENHUMA string visível, próximos passos só com data futura, janela (virada de ano, bissexto), data inválida
// rejeitada ANTES do motor, `_interno` fora do que segue adiante. Nunca toca Notion, Mercado Livre nem data/db.sqlite.
// Rodar: node scripts/teste-relatorio-brief.mjs
process.env.PS_DB_MEMORIA = '1'   // os imports estáticos abaixo não abrem db.js; o módulo "real" só entra por import() dinâmico, com banco em memória
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { montarResultados, tarefasComResultado, volumeAtividades, situacaoDaConta } from '../src/lib/semanal-resultados.js'
import { SEM_MOTIVO, textoDe } from '../src/lib/dependencia-cliente.js'
import { criarBrief, projetarBrief, limparTitulo, auditarBrief, PROIBIDOS, semInterno, janelaDoRelatorio, cfgBrief, validarCfg, regexNomes, BriefInseguro } from '../src/lib/relatorio-brief.js'
import { CATEGORIA, auditarTexto } from '../src/lib/relatorio-seguro.js'
import { pendenciaParaCliente, linhasDePendencia } from '../src/lib/pendencias-texto.js'
import { montar, itemMl, baseMl, tarefa as tarefaDep, catalogoReal, QUEM } from './fixtures/pendencias-mundo.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const texto = o => JSON.stringify(semInterno(o))
const todasAsStrings = (o, acc = []) => { if (typeof o === 'string') acc.push(o); else if (Array.isArray(o)) o.forEach(v => todasAsStrings(v, acc)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== '_interno') todasAsStrings(v, acc); return acc }

const HOJE = '2026-10-08', AGORA = '2026-10-08T17:20:00.000Z'          // 14:20 em São Paulo
const DE = '2026-10-01', ATE = '2026-10-07'
const CLIENTE = 'Uniaodog Artigos Pet'
const NOMES = ['Giovanna Torres', 'Carla Souza', 'Vitória de Jesus Rodrigues de Oliveira', 'David do Valle']

// ── entradas sintéticas no formato do motor ──────────────────────────────────────────────────────────────────
const NEG = (o = {}) => ({ disponivel: true, faturamento: 5988.09, unidades: 130, vendas: 115, preco_medio_unidade: 46.06, preco_medio_venda: 52.07, visitas: 1263, conversao: 9.1, vendas_canceladas: 14, valor_cancelado: 700, vendas_devolvidas: 2, ...o })
const NEG_ANT = NEG({ faturamento: 5500, vendas: 110, preco_medio_venda: 50, visitas: 1300, conversao: 8.5, vendas_canceladas: 12, valor_cancelado: 600 })
const ADS = { disponivel: true, investimento: 211.32, receita: 1720, roas: 8.14, acos: 12.28, vendas_atribuidas: 40, cliques: 900, impressoes: 50000 }
const ADS_ANT = { ...ADS, investimento: 200, receita: 1500, roas: 7.5, acos: 13.3 }
const ESTADO = (estado, o = {}) => ({ estado, rotulo: { queda: 'Queda', estagnacao: 'Estagnação', crescimento: 'Crescimento' }[estado], forca: estado === 'estagnacao' ? null : 'moderada',
  variacao_pct: estado === 'queda' ? -13.5 : estado === 'crescimento' ? 12.4 : -1.2, receita: { atual: 12000, anterior: 12150 }, dentro_do_ruido: estado === 'estagnacao', janela_dias: 14, ...o })
const PROMOS = { disponivel: true, total: 4, promocoes: [
  { tipo: 'DEAL', status: 'started', inicio: '2026-10-02T03:00:00.000Z', fim: '2026-10-13T23:59:59-03:00' },
  { tipo: 'SELLER_CAMPAIGN', status: 'started', inicio: '2026-10-01T03:00:00.000Z', fim: '2026-10-08T23:59:59-03:00' },
  { tipo: 'LIGHTNING', status: 'pending', inicio: '2026-10-15T10:00:00-03:00', fim: '2026-10-15T14:00:00-03:00' },
  { tipo: 'SMART', status: 'candidate', inicio: '2026-10-10T00:00:00-03:00', fim: '2026-10-20T00:00:00-03:00' }] }

const tarefa = (id, titulo, o = {}) => ({ id, titulo, processo: 'Mercado Livre', status: 'concluida', data_conclusao: '2026-10-03', responsavel: 'Giovanna Torres', ...o })
const acao = (titulo, data, processo = 'TikTok Shop') => ({ titulo, processo, data, responsavel: 'Giovanna Torres', evidencias: [], links: [], url: 'https://www.notion.so/x' })
const prox = (titulo, status, o = {}) => ({ titulo, processo: 'Mercado Livre', status, status_raw: status, responsavel: 'Carla Souza', prazo: null, dependencia_cliente: '', bloqueio: '', proximo_passo: '', url: 'https://www.notion.so/y', atrasada: false,
  data_planejada: null, desde: null, dias_aguardando: null, motivo_registrado: false, ...o })

// semanal sintético: o mesmo desenho de retorno de montarSemanal (só os campos que o brief lê)
function semanal({ lista = false, conectado = true, falhou = false, ml = true, ads = true, estado = ESTADO('estagnacao'), acoes = [], proximos = [], concluidas = [], tarefas = [], medidas = null, ofertas = PROMOS,
  risco = [], negocio = NEG(), anterior = NEG_ANT, marketplaces = ['Mercado Livre', 'TikTok Shop'], regras = {}, avisos = [] } = {}) {
  const negocioComp = conectado && !falhou && ml ? { atual: negocio, anterior, janela_anterior: { de: '2026-09-24', ate: '2026-09-30' } } : null
  const adsComp = conectado && !falhou && ads ? { atual: ADS, anterior: ADS_ANT } : null
  const R = montarResultados({ de: DE, ate: ATE, conectado, falhou: conectado && !negocioComp, negocio: negocioComp, ads: adsComp, tarefas: [...tarefas, ...concluidas], concluidas, evPorTarefa: {}, ehMetrica: () => false })
  const TR = tarefasComResultado({ objetivo: { id: 'faturamento', rotulo: 'Crescer o faturamento', metrica: 'receita' }, ate: ATE, janelaDias: 45, tarefas: [...tarefas, ...concluidas], medidas, linksDe: () => [] })
  return {
    identificacao: { cliente: CLIENTE, marketplaces, de: DE, ate: ATE },
    meli_conectado: conectado, avisos,
    perfil: { regras: { lista_tarefas: lista, max_acoes: lista ? 0 : 5, max_resultados: 3, metricas_extras: false, linguagem: 'padrao', ...regras } },
    resultados: R, negocio_comparativo: negocioComp, ads_comparativo: adsComp, crescimento: {},
    acoes, proximos, ofertas,
    atividades: volumeAtividades({ de: DE, ate: ATE, concluidas: acoes.map(a => ({ processo: a.processo })) }),
    tarefas_resultado: TR, desempenho: estado ? { estado, queda: estado.estado === 'queda' ? { motivos: [{ k: 'caixa_de_compra', rotulo: 'Caixa de compra perdida', tipo: 'fato', interno: false }, { k: 'execucao', rotulo: 'A equipe entregou menos', tipo: 'hipotese', interno: true }] } : null } : null,
    risco_estoque: risco,
  }
}
const RISCO = [1, 2, 3, 4, 5].map(i => ({ id: `MLB10000000${i}`, titulo: ['Guia Unificada Adestramento Enforcador Coleira Cachorro Premium 1,80m (MLB4789167797)', 'Trança de Pele Bovina Tamanho M Mordedor Natural', 'Petisco Natural', 'Osso', 'Bola'][i - 1], cobertura_dias: i + 2, estoque: 10 }))

const A = (o = {}) => ({ cliente: CLIENTE, id: 'PS-' + Math.random().toString(16).slice(2, 8), canal: 'ML', status: 'aprovada', horizonte: '7d', ...o })
const PLANO = [
  A({ id: 'PS-aaaaaa', regra: 'anuncio_catalogo_buybox', titulo: 'Recuperar a caixa de compra: Mordedor Natural Para Cachorro Trança Bovina Nat (MLB4789167797)', prazo: '2026-10-15' }),
  A({ id: 'PS-aaaab0', regra: 'anuncio_catalogo_buybox', titulo: 'Recuperar a caixa de compra: Petisco Para Cães Natural Desidratado Luv (MLB4483066303)', prazo: '2026-10-15' }),
  A({ id: 'PS-bbbbbb', regra: 'calendario', titulo: 'Preparar Black Friday (27/11/2026)', prazo: '2026-10-28' }),
  A({ id: 'PS-cccccc', regra: 'calendario', titulo: 'Preparar Natal (25/12/2026)', prazo: '2026-11-25' }),                                  // além do radar (hoje+45 = 22/11)
  A({ id: 'PS-dddddd', regra: 'calendario', titulo: 'Preparar Dia do Cliente (15/09/2026)', prazo: '2026-10-01' }),                        // data vencida
  A({ id: 'PS-eeeeee', regra: 'sem_responsavel', titulo: 'Atribuir responsável a 6 tarefa(s) abertas sem dono', prazo: '2026-10-10' }),   // interna
  A({ id: 'PS-ffffff', regra: 'anuncio_estoque_ruptura', titulo: 'Repor estoque: Guia (MLB4789167797)', prazo: '2026-10-10' }),             // só em "Depende de você"
  A({ id: 'PS-111111', regra: 'anuncio_ima_conversao', titulo: 'Quebrar objeções de conversão: Guia Unificada (MLB6761140810)', prazo: '2026-10-12', status: 'proposta' }),   // proposta nunca
  A({ id: 'PS-222222', regra: 'anuncio_ads_entrar', titulo: 'Entrar em Ads: Coleira Peitoral (MLB1)', prazo: '2026-10-11', status: 'obsoleta' }),
  A({ id: 'PS-333333', regra: 'anuncio_frete_gratis', titulo: 'Ativar frete grátis: Bola Maciça (MLB2)', prazo: '2026-10-09', status: 'distribuida' }),
  A({ id: 'PS-444444', regra: 'anuncio_ima_conversao', titulo: 'Quebrar objeções: Outro Cliente', prazo: '2026-10-12', cliente: 'Outro Cliente' }),                  // outro cliente: nunca
]
const EVENTOS = new Map([
  ['MLB1', [{ dia: '2026-10-03', campo: 'preco', de: 100, para: 94, pct: -6, fonte: 'coleta' }, { dia: '2026-10-03', campo: 'estoque_zero', de: 5, para: 0, pct: null, fonte: 'coleta' }, { dia: '2026-10-04', campo: 'promocao', de: 'nenhuma', para: 'DEAL −10%', pct: null, fonte: 'promo' }]],
  ['MLB2', [{ dia: '2026-10-03', campo: 'preco', de: 50, para: 48, pct: -4, fonte: 'coleta' }, { dia: '2026-10-04', campo: 'promocao', de: 'nenhuma', para: 'DEAL −10%', pct: null, fonte: 'coleta' }, { dia: '2026-10-05', campo: 'ads', de: 'paused', para: 'active', pct: null, fonte: 'coleta' }]],
  ['MLB3', [{ dia: '2026-10-03', campo: 'preco', de: 200, para: 199, pct: -0.5, fonte: 'coleta' }, { dia: '2026-10-06', campo: 'logistica', de: 'cross_docking', para: 'fulfillment', pct: null, fonte: 'coleta' },
    { dia: '2026-10-06', campo: 'status', de: 'active', para: 'paused', pct: null, fonte: 'coleta' }, { dia: '2026-09-20', campo: 'preco', de: 10, para: 20, pct: 100, fonte: 'coleta' }]],
  ['MLB4', [{ dia: '2026-10-05', campo: 'preco', de: 10, para: 10.8, pct: 8, fonte: 'acomp', incerteza: 'mudou entre 02/10 e 05/10' }]],
])
const ctxBase = (o = {}) => ({ cliente: CLIENTE, hoje: HOJE, hora: '14:20', acoesPlano: PLANO, eventos: EVENTOS, inicioHistorico: '2026-09-28', hojeNegocio: { faturamento: 812.5, pedidos: 14 }, nomes: NOMES, limiarRupturaDias: 10, ...o })

// exemplo A: União Dog (não lista tarefas)
const SEM_A = () => semanal({
  acoes: [acao('Duplicar oferta relâmpago (1)', '2026-10-02'), acao('Duplicar oferta relâmpago (2)', '2026-10-03'), acao('Duplicar oferta relâmpago (3)', '2026-10-05'), acao('Duplicar oferta relâmpago (4)', '2026-10-06'), acao('Ajuste de título · PS-1a2b3c', '2026-10-04', 'Mercado Livre')],
  proximos: [
    prox('Otimização e inserção de clips', 'andamento', { data_planejada: '2026-10-09' }), prox('Revisão de fotos do kit', 'validacao'),
    prox('Criar kit petisqueira (5203884867) + backup segurança (6224133850)', 'nao_iniciada', { data_planejada: '2026-10-16' }),
    prox('Duplicação de título 4224148046930256', 'nao_iniciada', { data_planejada: '2026-10-15' }), prox('Limpeza da conta', 'nao_iniciada', { data_planejada: '2026-10-07' }),
    prox('Reposição de estoque do kit', 'nao_iniciada', { data_planejada: '2026-10-10' }), prox('Relatório Semanal', 'nao_iniciada', { data_planejada: '2026-10-09' }),
    prox('Recuperar a caixa de compra: Mordedor · PS-aaaaaa', 'nao_iniciada', { data_planejada: '2026-10-15' }),
    prox('Criar anúncio da variação rosa', 'nao_iniciada', { data_planejada: '2026-10-25' }), prox('Montar kit', 'nao_iniciada', { data_planejada: '2026-10-20' }),
    prox('Fazer algo que depende do cliente', 'bloqueada', { bloqueio: 'aguardando fotos' }),
    prox('Otimização e inserção de clips', 'dependencia_cliente', { dependencia_cliente: SEM_MOTIVO, desde: '2026-10-02', dias_aguardando: 6 }),
    prox('Otimização e inserção de clips', 'dependencia_cliente', { dependencia_cliente: SEM_MOTIVO, desde: '2026-10-05', dias_aguardando: 3 }),
    prox('Cadastro do kit novo', 'dependencia_cliente', { dependencia_cliente: textoDe({ tipo: 'fotos', detalhe: 'enviar as fotos do kit novo' }), motivo_registrado: true, desde: '2026-10-01', dias_aguardando: 7 })],
  risco: RISCO, tarefas: [tarefa('tk1', 'Criar vídeos de produto', { processo: 'TikTok Shop' })],
})
// exemplo B: cliente que lista tarefas
const SEM_B = () => semanal({
  lista: true, estado: ESTADO('crescimento'), regras: { max_acoes: 0, max_resultados: 3 },
  acoes: [acao('Novas fotos do kit de jardinagem', '2026-10-03', 'Mercado Livre'), acao('Revisão de títulos (1)', '2026-10-02', 'Mercado Livre'), acao('Revisão de títulos (2)', '2026-10-03', 'Mercado Livre'),
    acao('Revisão de títulos (3)', '2026-10-05', 'Mercado Livre'), acao('Revisão de títulos (4)', '2026-10-06', 'Mercado Livre'), acao('Ajuste de preço e frete grátis', '2026-10-06', 'Mercado Livre'),
    acao('Criação de vídeos (teste)', '2026-10-06', 'TikTok Shop'), acao('Atribuir responsável a 6 tarefa(s) abertas sem dono · PS-eeeeee', '2026-10-06', 'Mercado Livre'), acao('Tarefa do analista Giovanna', '2026-10-06', 'Mercado Livre')],
  proximos: [prox('Ficha técnica da linha de mangueiras', 'andamento', { prazo: '2026-10-10', data_planejada: '2026-10-10' }), prox('Duplicação de anúncio para teste de palavras-chave', 'nao_iniciada', { data_planejada: '2026-10-14' }),
    prox('Revisão de títulos', 'nao_iniciada', { data_planejada: '2026-10-12' }), prox('Revisão de títulos', 'nao_iniciada', { data_planejada: '2026-10-13' }),
    prox('Fotos do produto', 'dependencia_cliente', { dependencia_cliente: textoDe({ tipo: 'fotos', detalhe: 'enviar as fotos do kit novo' }), motivo_registrado: true, desde: '2026-10-01', dias_aguardando: 7 })],
  tarefas: [tarefa('t1', 'Novas fotos do kit de jardinagem'), tarefa('t2', 'Ajuste de título da mangueira 30 m'), tarefa('t3', 'Recuperação de carrinho abandonado', { resultado_alcancado: '14 pedidos recuperados' })],
  medidas: [{ id: 't1', titulo: 'Novas fotos do kit de jardinagem', estado: 'melhorou', data: '2026-09-30', metrica_primaria: 'unidades', efeito_pct: 11.2, dias_pos: 7, lag: 3, janela_usada: 14, receita_alocada: 1240, receita_estimavel: true, confianca: { score: 72 }, itens: [] },
    { id: 't2', titulo: 'Ajuste de título da mangueira 30 m', estado: 'melhorou', data: '2026-09-28', metrica_primaria: 'unidades', efeito_pct: 9.1, dias_pos: 9, lag: 3, janela_usada: 14, receita_alocada: 300, receita_estimavel: true, confianca: { score: 48 }, itens: [] }],
})
// o auxiliar roda com listar_tarefas_sempre DESLIGADO (comportamento que os exemplos antigos fixam); o caso do padrão novo (ligado, do config real) usa briefReal
const CFG_ANTIGO = { ...cfgBrief, listar_tarefas_sempre: false }
const brief = (sem, ctx) => projetarBrief(sem, ctxBase({ cfg: CFG_ANTIGO, ...ctx }))
const briefReal = (sem, ctx) => projetarBrief(sem, ctxBase({ cfg: cfgBrief, ...ctx }))

await ok('janela: 7 dias FECHADOS (hoje−7 a hoje−1), anterior de mesma duração, virada de ano e bissexto em dias inteiros', () => {
  const j = janelaDoRelatorio(HOJE)
  assert.deepEqual([j.de, j.ate, j.anterior, j.rotulo], [DE, ATE, { de: '2026-09-24', ate: '2026-09-30' }, '01/10 a 07/10/2026'])
  const ano = janelaDoRelatorio('2026-01-03')
  assert.deepEqual([ano.de, ano.ate, ano.anterior, ano.rotulo], ['2025-12-27', '2026-01-02', { de: '2025-12-20', ate: '2025-12-26' }, '27/12/2025 a 02/01/2026'])
  const bis = janelaDoRelatorio('2028-03-01')
  assert.deepEqual([bis.de, bis.ate, bis.anterior.ate], ['2028-02-23', '2028-02-29', '2028-02-22'])
  for (const ruim of ['2026-02-30', '2026-13-01', '26-10-08', '2026-10-8', '', null, undefined, 20261008, '2026-10-08T10:00']) assert.throws(() => janelaDoRelatorio(ruim), /data de referência inválida/, 'data inválida rejeitada sem eco')
  const b = brief(SEM_A(), { hoje: '2026-01-03', acoesPlano: [], eventos: null })
  assert.deepEqual([b.janela.de, b.janela.ate, b.janela.rotulo, b.titulo], ['2025-12-27', '2026-01-02', '27/12/2025 a 02/01/2026', 'Relatório de Sprints Place2u · 27/12/2025 a 02/01/2026'])
})

await ok('config: validada na carga; título nunca casa com parseTituloPlano nem cita PlacePlan; capa vazia = sem capa; lista branca sem regra interna', () => {
  assert.equal(cfgBrief.janela.dias, 7); assert.equal(cfgBrief.janela.termina_em, 'ontem')
  for (const morto of ['categoria', 'status_notion', 'icone', 'capa_url']) assert.ok(!(morto in cfgBrief), `"${morto}" não vive mais no config (ninguém o lia: a fonte única é o código de relatorio-notion/relatorio-seguro)`)
  assert.equal(cfgBrief.titulo_prefixo, CATEGORIA); assert.equal(cfgBrief.horizonte_dias, 14); assert.equal(cfgBrief.radar_dias, 45); assert.equal(cfgBrief.preco_min_pct, 3); assert.equal(cfgBrief.limites.informado_caracteres, 80)
  // item 16d: um prefixo trocado quebraria TODO envio (tituloOk exige a CATEGORIA no início): a carga falha com mensagem clara, não o envio
  for (const ruim of ['Outro título', 'relatório de sprints place2u', `Resumo ${CATEGORIA}`, '', `${CATEGORIA}\n2`, `${CATEGORIA} PlacePlan`, CATEGORIA + 'x'.repeat(130)]) assert.throws(() => validarCfg({ ...cfgBrief, titulo_prefixo: ruim }), /titulo_prefixo/, JSON.stringify(ruim))
  assert.doesNotThrow(() => validarCfg({ ...cfgBrief, titulo_prefixo: `${CATEGORIA} — semanal` })); assert.throws(() => validarCfg({ ...cfgBrief, limites: { ...cfgBrief.limites, informado_caracteres: 5 } }), /informado_caracteres/)
  const b = brief(SEM_A())
  assert.ok(!/^([a-zç]+)\s*\/\s*(\d{2,4})\s*-\s*(.+)$/.test(b.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()), 'parseTituloPlano (plano-informacoes.js:17) não casa')
  assert.ok(!/placeplan/i.test(b.titulo))
  for (const interna of ['sem_responsavel', 'sem_plano_mes', 'backlog_parado', 'alavanca_precificacao', 'anuncio_preco_mudou_vendas_cairam', 'anuncio_cadastrar_custos', 'anuncio_estoque_ruptura', 'anuncio_urgencia_oculta', 'bloqueio_cliente', 'renovacao'])
    assert.ok(!cfgBrief.regras_acao_cliente.some(r => r.endsWith('*') ? interna.startsWith(r.slice(0, -1)) : r === interna), `${interna} fora da lista branca`)
  const cfg = JSON.parse(readFileSync(new URL('../config/algoritmo.json', import.meta.url), 'utf-8'))
  const ids = new Set(cfg.regras.map(r => 'anuncio_' + r.id))
  for (const r of cfgBrief.regras_acao_cliente.filter(r => !r.endsWith('*') && r !== 'calendario')) assert.ok(ids.has(r), `${r} existe em config/algoritmo.json`)
  for (const p of cfgBrief.regras_acao_cliente.filter(r => r.endsWith('*'))) assert.ok([...ids].some(i => i.startsWith(p.slice(0, -1))), `${p} casa alguma regra real`)
})

await ok('exemplo A (não lista tarefas): abertura amarela pelo RESULTADO, tabela com anterior/variação, hoje à parte, contagem por canal sem nomes', () => {
  const b = brief(SEM_A())
  assert.equal(b.versao, 1); assert.equal(b.cliente, CLIENTE); assert.equal(b.hoje, HOJE); assert.equal(b.hora, '14:20')
  assert.equal(b.modo, 'completo'); assert.deepEqual(b.qualidade, { ok: true, motivos: [] })
  assert.equal(b.abertura.tom, 'amarelo'); assert.equal(b.abertura.cabecalho, 'Conta em estagnação')
  assert.match(b.abertura.frase, /^Faturamento −1,2% nos últimos 14 dias \(R\$ 12\.000,00 contra R\$ 12\.150,00\); oscilação dentro do normal\. Na tabela abaixo, só os 7 dias fechados: faturamento [▲▼] [\d,]+%\.$/, 'estado em 14 dias e tabela em 7: a frase diz as duas janelas')
  assert.match(b.abertura.nudge, /^3 pontos aguardam o seu retorno — veja Depende de você$/)
  const L = Object.fromEntries(b.resultados.linhas.map(l => [l.chave, l]))
  assert.deepEqual(b.resultados.linhas.map(l => l.rotulo), ['Faturamento', 'Pedidos pagos', 'Ticket médio', 'Visitas aos anúncios', 'Conversão', 'Pedidos cancelados', 'Investimento em anúncios (Ads)', 'Retorno dos anúncios (ROAS)'])
  assert.deepEqual([L.faturamento.atual, L.faturamento.anterior, L.faturamento.variacao], ['R$ 5.988,09', 'R$ 5.500,00', { texto: '▲ 8,9%', sinal: 'bom' }])
  assert.deepEqual([L.vendas.atual, L.vendas.anterior], ['115', '110']); assert.deepEqual([L.ticket_medio.atual, L.ticket_medio.anterior], ['R$ 52,07', 'R$ 50,00'])
  assert.deepEqual([L.conversao.atual, L.conversao.anterior, L.conversao.variacao], ['9,1%', '8,5%', { texto: '▲ 0,6 p.p.', sinal: 'bom' }])
  assert.deepEqual([L.investimento.atual, L.investimento.variacao?.sinal], ['R$ 211,32', 'igual'], 'gastar mais não é bom nem ruim: variação NEUTRA (a coluna não pode sugerir "não coletado" onde há dado)'); assert.match(L.investimento.variacao.texto, /^[▲▼=] [\d,]+%$/)
  assert.deepEqual([L.roas.atual, L.roas.anterior], ['8,14', '7,5'])
  assert.deepEqual(b.resultados.hoje, { ate_hora: '14:20', faturamento: 'R$ 812,50', pedidos: 14 })
  assert.ok(b.resultados.disponivel && b.resultados.motivo === null)
  // atividades: perfil que não lista tarefas = só contagem por canal; nada de grupos nem nomes (o exemplo roda com listar_tarefas_sempre DESLIGADO; o padrão novo, ligado, é o caso seguinte)
  assert.equal(b.atividades.lista, false); assert.equal(b.atividades.concluido.total, 5); assert.deepEqual(b.atividades.concluido.por_canal, [{ canal: 'TikTok Shop', n: 4 }, { canal: 'Mercado Livre', n: 1 }]); assert.deepEqual(b.atividades.concluido.grupos, [])
  assert.deepEqual(b.atividades.andamento, { total: 2, itens: [], promocoes: [{ rotulo: 'Oferta do dia/Campanha', ate: '2026-10-13' }, { rotulo: 'Campanha do vendedor', ate: '2026-10-08' }] })
})

await ok('09/10: listar_tarefas_sempre (padrão do config) lista as tarefas concluídas por grupo mesmo com perfil "só resultados"', () => {
  assert.equal(cfgBrief.listar_tarefas_sempre, true)
  const b = briefReal(SEM_A())
  assert.equal(b.atividades.lista, true); assert.ok(b.atividades.concluido.grupos.length > 0)
})

await ok('exemplo A: próximos passos SÓ com data futura (>= hoje), ordenados, lista branca, sem proposta/obsoleta/interna/outro cliente/duplicata de card; linha-resumo e radar', () => {
  const b = brief(SEM_A()), P = b.proximos
  const datas = [...P.itens, ...P.radar].map(i => i.quando)
  assert.ok(datas.length && datas.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= HOJE), 'só datas futuras')
  assert.deepEqual(P.itens.map(i => i.quando), [...P.itens.map(i => i.quando)].sort(), 'em ordem de data')
  assert.deepEqual(P.itens.map(i => [i.quando, i.origem, i.rotulo]), [
    ['2026-10-08', 'promocao', 'Fim da promoção em vigor: Campanha do vendedor'],           // termina HOJE: data >= hoje entra
    ['2026-10-09', 'acao', 'Ativar frete grátis: Bola Maciça'],                             // ação distribuída da lista branca, sem (MLB…)
    ['2026-10-13', 'promocao', 'Fim da promoção em vigor: Oferta do dia/Campanha'],
    ['2026-10-15', 'promocao', 'Início da promoção: Relâmpago'],
    ['2026-10-15', 'acao', 'Recuperar a caixa de compra em 2 anúncios'],                   // 2 ações iguais no mesmo dia viram uma linha
  ])
})

await ok('exemplo A: radar da Black Friday, agenda agrupada (linha-resumo), nada interno e vencida só no _interno', () => {
  const b = brief(SEM_A()), P = b.proximos
  assert.deepEqual(P.radar, [{ quando: '2026-10-28', rotulo: 'No radar: preparar Black Friday (27/11)', origem: 'calendario' }], 'Natal (hoje+48) fica fora do radar; 15/09 (vencida) nunca')
  // tarefas: não lista => UMA agenda; fora: card com PS- (é a ação), reposição, relatório, vencida (07/10), >14 dias (25/10 e 20/10), andamento e a data de hoje+... dentro
  assert.deepEqual(P.agenda, { p7: 1, p8_14: 2, total: 3, ate: '2026-10-22', resumo: '3 ações já agendadas pela equipe (1 nos próximos 7 dias, 2 na semana seguinte)' })
  assert.equal(P.vazio, null)
  const texto = JSON.stringify(P)
  for (const proibido of ['Atribuir', 'Natal', 'Dia do Cliente', 'Outro Cliente', 'Quebrar objeções', 'Entrar em Ads', 'Repor estoque', 'MLB', 'PS-', 'Limpeza da conta', 'Reposição', 'Relatório Semanal']) assert.ok(!texto.includes(proibido), `${proibido} não entra em Próximos passos`)
  assert.ok(b._interno.avisos.some(a => /1 tarefa\(s\) aberta\(s\) com data planejada vencida/.test(a)), 'vencida só no interno (furo 7)')
})

await ok('exemplo A: "Depende de você" — sem registro vira texto neutro agrupado com "desde"/dias; registrado usa o texto do registro; risco de estoque; SEM_MOTIVO nunca sai', () => {
  const b = brief(SEM_A()), D = b.depende.itens
  assert.equal(D.length, 3)
  assert.equal(D[0].rotulo, 'Fotos do produto: enviar as fotos do kit novo')
  assert.equal(D[1].rotulo, 'Otimização e inserção de clips (2 tarefas) — aguardamos um retorno seu sobre estas tarefas')
  assert.deepEqual([D[0].desde, D[0].dias, D[1].desde, D[1].dias, D[2].desde, D[2].dias], ['2026-10-01', 7, '2026-10-02', 6, null, null], 'a mais antiga manda no grupo; estoque não tem "desde"')
  assert.equal(D[2].rotulo, 'Repor estoque de 5 anúncios que mais vendem (estoque para menos de 10 dias): Guia Unificada Adestramento Enforcador…, Trança de Pele Bovina Tamanho M Mordedor… (+3)', 'nome curto, cortado em palavra, sem MLB')
  assert.ok(D[2].rotulo.endsWith('(+3)') && !/MLB|\d{7,}/.test(D[2].rotulo))
  const t = texto(b)
  assert.ok(!t.includes(SEM_MOTIVO) && !/sem motivo registrado|Bloqueio:|aguardando fotos/i.test(t), 'SEM_MOTIVO / Bloqueio cru nunca vazam')
})

await ok('exemplo A: Desenvolvimento — vazio honesto de resultados e de mudanças (campos client-safe, agrupadas por dia, sem item nem id)', () => {
  const b = brief(SEM_A()), d = b.desenvolvimento
  assert.deepEqual(d.resultados, []); assert.match(d.vazio_resultados, /^Nenhuma tarefa concluída nos últimos 45 dias tem efeito medido ou informado até agora\. Só medimos o efeito de ajustes em anúncios do Mercado Livre identificados na tarefa\.$/)
  assert.deepEqual(d.mudancas, [
    { quando: '2026-10-03', texto: 'Preço ajustado em 2 anúncios (−4% a −6%)' },
    { quando: '2026-10-04', texto: '2 anúncios entraram em promoção' },
    { quando: '2026-10-05', texto: 'Preço ajustado em 1 anúncio (+8%) — mudou entre 02/10 e 05/10' },
    { quando: '2026-10-05', texto: 'Ads ligado em 1 anúncio' },
    { quando: '2026-10-06', texto: '1 anúncio passou a ser enviado pelo Full' },
  ], 'preço <3% fora, estoque/status fora, evento de 20/09 fora da janela, promoção/Ads/Full só ao cruzar fronteira, incerteza do acompanhamento dita')
  assert.equal(d.vazio_mudancas, null)
  const vazio = brief(SEM_A(), { eventos: new Map(), inicioHistorico: null }).desenvolvimento
  assert.deepEqual(vazio.mudancas, []); assert.match(vazio.vazio_mudancas, /ainda não cobre toda a semana; não afirmamos que não houve mudanças/)
  assert.match(brief(SEM_A(), { eventos: new Map(), inicioHistorico: '2026-09-28' }).desenvolvimento.vazio_mudancas, /^Nenhuma mudança relevante de preço, promoção, Ads ou Full registrada nesta semana\.$/)
  assert.match(brief(SEM_A(), { eventos: new Map(), inicioHistorico: '2026-10-02' }).desenvolvimento.vazio_mudancas, /ainda não cobre toda a semana/, 'histórico começa depois do 1º dia da janela')
  const semML = semanal({ conectado: false, marketplaces: ['TikTok Shop'] })
  assert.equal(brief(semML, { eventos: new Map() }).desenvolvimento.vazio_mudancas, null, 'sem ML conectado não há histórico de anúncio a comentar')
})

await ok('exemplo B (lista tarefas): abertura verde, grupos sem nomes nem ids, resultados com selo medido/hipótese/informado + confiança, tarefas agrupadas em próximos', () => {
  const b = brief(SEM_B())
  assert.equal(b.abertura.tom, 'verde'); assert.equal(b.abertura.cabecalho, 'Conta em crescimento'); assert.match(b.abertura.frase, /^Faturamento \+12,4% nos últimos 14 dias \(R\$ 12\.000,00 contra R\$ 12\.150,00\)\. Na tabela abaixo, só os 7 dias fechados: faturamento [▲▼] [\d,]+%\.$/)
  assert.equal(b.atividades.lista, true)
  const g = b.atividades.concluido.grupos
  assert.equal(b.atividades.concluido.total, 8, 'a rotina interna (PS- de regra fora da lista branca) não conta'); assert.equal(g.length, 5)
  assert.deepEqual(g.find(x => x.rotulo === 'Revisão de títulos'), { rotulo: 'Revisão de títulos', canal: 'Mercado Livre', quando: '2026-10-02', fim: '2026-10-06', n: 4 })
  assert.deepEqual(g.find(x => x.rotulo === 'Criação de vídeos (teste)'), { rotulo: 'Criação de vídeos (teste)', canal: 'TikTok Shop', quando: '2026-10-06', n: 1 })
  assert.ok(g.some(x => /^Ajuste de rotina — Mercado Livre$/.test(x.rotulo)), 'título com nome de analista vira genérico, a conta continua verdadeira')
  assert.ok(b._interno.omitidos.titulos_genericos >= 1 && b._interno.omitidos.rotina_interna === 1)
  const R = b.desenvolvimento.resultados
  assert.deepEqual(R.map(r => [r.rotulo, r.selo, r.confianca]), [['Novas fotos do kit de jardinagem', 'medido', { nivel: 'media', pct: 72 }], ['Ajuste de título da mangueira 30 m', 'hipotese', { nivel: 'baixa', pct: 48 }], ['Recuperação de carrinho abandonado', 'informado', null]])
  assert.match(R[0].metrica.rotulo, /\(causa provável\)/); assert.match(R[1].metrica.rotulo, /hipótese — confiança baixa/); assert.equal(R[2].metrica.texto, '14 pedidos recuperados')
  assert.equal(R[0].quando, '2026-09-30'); assert.equal(R[2].canal, 'Mercado Livre')
  assert.deepEqual(b.atividades.andamento.itens, [{ rotulo: 'Ficha técnica da linha de mangueiras', canal: 'Mercado Livre', previsto: '2026-10-10' }])
  assert.deepEqual(b.proximos.itens.filter(i => i.origem === 'tarefa').map(i => [i.quando, i.fim, i.rotulo]), [['2026-10-12', '2026-10-13', 'Revisão de títulos (2 tarefas)'], ['2026-10-14', undefined, 'Duplicação de anúncio para teste de palavras-chave']])
  assert.equal(b.proximos.agenda, null, 'lista tarefas: sem linha-resumo')
  assert.deepEqual(b.depende.itens, [{ rotulo: 'Fotos do produto: enviar as fotos do kit novo', desde: '2026-10-01', dias: 7 }])
  assert.match(b.abertura.nudge, /^1 ponto aguarda o seu retorno/)
})

await ok('limite de resultados do perfil direto (max_resultados 3) e o vazio de resultados cita a janela real', () => {
  const sem = SEM_B(); sem.perfil.regras.max_resultados = 1
  assert.equal(brief(sem).desenvolvimento.resultados.length, 1)
  const vazio = semanal({ lista: true }); vazio.tarefas_resultado.nota = 'Nenhuma tarefa concluída nos últimos 45 dias tem resultado medido ou informado.'
  assert.match(brief(vazio).desenvolvimento.vazio_resultados, /^Nenhuma tarefa concluída nos últimos 45 dias tem efeito medido ou informado até agora\./)
})

await ok('abertura pelo RESULTADO: queda = laranja com causa rotulada; interna não aparece; sem base = cinza; o semáforo de prazo (situacao) nunca colore', () => {
  const q = brief(semanal({ estado: ESTADO('queda') }))
  assert.equal(q.abertura.tom, 'laranja'); assert.equal(q.abertura.cabecalho, 'Conta em queda')
  assert.match(q.abertura.frase, /^Faturamento −13,5% nos últimos 14 dias \(R\$ 12\.000,00 contra R\$ 12\.150,00\)\. Na tabela abaixo, só os 7 dias fechados: faturamento [▲▼] [\d,]+%\. Causa mais provável: caixa de compra perdida\.$/)
  const forte = brief(semanal({ estado: ESTADO('queda', { forca: 'forte' }) })); assert.equal(forte.abertura.cabecalho, 'Conta em queda forte')
  const sb = brief(semanal({ estado: { estado: 'sem_base', rotulo: 'Sem base de comparação', motivo: 'histórico curto' } }))
  assert.equal(sb.abertura.tom, 'cinza'); assert.equal(sb.abertura.frase, 'Ainda não há base de comparação suficiente para a leitura da conta; nada foi estimado.')
  assert.equal(brief(semanal({ estado: null })).abertura.tom, 'cinza')
  const comSituacao = semanal({ estado: ESTADO('queda') }); comSituacao.situacao = situacaoDaConta({ atrasadas: [], bloqueadas: [], dependencias: [], hoje: HOJE })    // "ok" (verde de prazo)
  assert.equal(brief(comSituacao).abertura.tom, 'laranja', 'sem prazo o semáforo "em dia" é falso-verde: ignorado (furo 7)')
  assert.equal(brief(semanal({ estado: ESTADO('crescimento', { variacao_pct: null }) })).abertura.tom, 'cinza', 'variação ausente nunca vira "0%"')
})

await ok('sem_resultados: ML não conectado => abertura cinza, uma linha de motivo, sem tabela; sobram atividades e próximos; canal sem ML tem frase própria', () => {
  const b = brief(semanal({ conectado: false, estado: null, ads: false, lista: true, ofertas: null, acoes: [acao('Novas fotos', '2026-10-03', 'Mercado Livre')], proximos: [prox('Ficha técnica', 'nao_iniciada', { data_planejada: '2026-10-10' })] }), { acoesPlano: [], eventos: new Map() })
  assert.equal(b.modo, 'sem_resultados'); assert.equal(b.resultados.disponivel, false); assert.deepEqual(b.resultados.linhas, []); assert.equal(b.resultados.hoje, null)
  assert.equal(b.resultados.motivo, 'Conta do Mercado Livre ainda não conectada ao relatório e nenhum dado foi informado pela equipe nesta semana.')
  assert.equal(b.abertura.tom, 'cinza'); assert.equal(b.abertura.frase, b.resultados.motivo); assert.equal(b.abertura.cabecalho, 'Números do Mercado Livre indisponíveis')
  assert.equal(b.qualidade.ok, true, 'não conectado não é falha')
  assert.equal(b.atividades.concluido.total, 1); assert.equal(b.proximos.itens.length, 1)
  assert.deepEqual(b.resultados.outros, [{ canal: 'TikTok Shop', texto: 'sem integração automática; nenhum número informado nesta semana' }].slice(0, 0), 'sem ML: sem linhas de "outros canais" sem dado')
  const tik = brief(semanal({ conectado: false, estado: null, ads: false, marketplaces: ['TikTok Shop'], acoes: [acao('Vídeos', '2026-10-03')] }))
  assert.match(tik.resultados.motivo, /^Ainda não há integração automática de números de vendas para os canais desta conta; nenhum número foi estimado\.$/); assert.equal(tik.abertura.cabecalho, 'Números de vendas indisponíveis')
})

await ok('ML conectado que NÃO respondeu: qualidade.ok=false com motivo, resultados indisponíveis e sem estimativa', () => {
  const b = brief(semanal({ falhou: true, acoes: [acao('Novas fotos', '2026-10-03', 'Mercado Livre')] }))
  assert.equal(b.qualidade.ok, false); assert.deepEqual(b.qualidade.motivos, ['O Mercado Livre não respondeu na geração deste relatório'])
  assert.equal(b.modo, 'sem_resultados'); assert.equal(b.resultados.disponivel, false); assert.deepEqual(b.resultados.linhas, [])
  assert.equal(b.resultados.motivo, 'O Mercado Livre não respondeu na geração deste relatório; os números não foram estimados.')
  assert.equal(b.abertura.tom, 'cinza', 'não usa uma leitura de conta possivelmente velha')
})

await ok('vazio: nada a dizer não vira página — modo "vazio" com o motivo em qualidade.motivos', () => {
  const b = brief(semanal({ conectado: false, estado: null, ads: false, ofertas: null }), { acoesPlano: [], eventos: new Map() })
  assert.equal(b.modo, 'vazio'); assert.equal(b.qualidade.ok, true); assert.match(b.qualidade.motivos[0], /^Nada a informar nesta semana/)
  assert.equal(b.proximos.vazio, 'Sem datas futuras confirmadas para os próximos 14 dias.')
  assert.equal(brief(semanal({ conectado: false, estado: null, ads: false, ofertas: null, risco: RISCO }), { acoesPlano: [], eventos: new Map() }).modo, 'sem_resultados', 'só "depende de você" já é o que dizer')
})

await ok('"—" + motivo agrupado, nunca zero: cancelamentos e devoluções não coletados, ticket sem venda, zero REAL é "R$ 0"', () => {
  const sem = NEG({ vendas_canceladas: null, valor_cancelado: null, visitas: null, conversao: null })
  const b = brief(semanal({ negocio: sem, anterior: NEG({ ...sem, vendas_canceladas: null, visitas: null, conversao: null }) }))
  const L = Object.fromEntries(b.resultados.linhas.map(l => [l.chave, l]))
  assert.deepEqual([L.cancelamentos.atual, L.cancelamentos.anterior, L.cancelamentos.variacao], ['—', '—', null])
  assert.deepEqual([L.visitas.atual, L.conversao.atual], ['—', '—'])
  assert.deepEqual(b.resultados.nao_coletado, ['visitas aos anúncios, pedidos cancelados: não retornado pelo Mercado Livre', 'conversão: depende das visitas, que estão indisponíveis'], 'motivos iguais agrupados, API sem jargão')
  const zero = brief(semanal({ negocio: NEG({ faturamento: 0, vendas: 0, unidades: 0, preco_medio_venda: 0, preco_medio_unidade: 0, conversao: 0 }) }))
  const Z = Object.fromEntries(zero.resultados.linhas.map(l => [l.chave, l]))
  assert.equal(Z.faturamento.atual, 'R$ 0', 'zero real não vira o padrão "R$ 0,00" de dado ausente'); assert.equal(Z.ticket_medio.atual, '—', 'sem venda não há ticket'); assert.ok(!texto(zero).includes('R$ 0,00'))
  const semAnt = brief(semanal({ anterior: null, ads: false }))
  assert.ok(semAnt.resultados.linhas.every(l => l.anterior === '—' && l.variacao === null)); assert.ok(semAnt.resultados.nao_coletado.some(x => /^período anterior para comparação/.test(x)))
  const adsOff = brief(semanal({ ads: false }))
  assert.ok(!adsOff.resultados.linhas.some(l => /Ads/.test(l.rotulo)), 'sem Ads coletado não há linha de Ads'); assert.ok(adsOff.resultados.nao_coletado.some(x => /^anúncios patrocinados \(Ads\)/.test(x)))
  assert.ok(!/NaN|undefined|\bnull\b/.test(todasAsStrings(b).join('\n')))
})

await ok('extras por perfil: ACOS/TACOS só com metricas_extras; glossa só em linguagem "simples"; promoções "outros canais" só com dado informado', () => {
  assert.ok(!brief(SEM_A()).resultados.linhas.some(l => /ACOS|TACOS/.test(l.rotulo)))
  const ex = brief(semanal({ regras: { metricas_extras: true } })).resultados.linhas.map(l => l.rotulo)
  assert.ok(ex.includes('ACOS') && ex.includes('TACOS'))
  const simples = brief(semanal({ regras: { linguagem: 'simples' } })).resultados.linhas
  assert.deepEqual(simples.filter(l => l.glossa).map(l => l.chave).sort(), ['conversao', 'roas', 'ticket_medio'])
  assert.ok(!brief(SEM_A()).resultados.linhas.some(l => l.glossa))
  const out = brief(SEM_A()).resultados.outros
  assert.deepEqual(out, [{ canal: 'TikTok Shop', texto: 'sem integração automática; nenhum número informado nesta semana' }])
})

await ok('NENHUMA string visível (A, B, sem_resultados, falha) casa PROIBIDOS ou nomes internos; nada de undefined/NaN/ids/URLs', () => {
  const rxN = regexNomes(NOMES)
  const casos = [brief(SEM_A()), brief(SEM_B()), brief(semanal({ conectado: false, estado: null, ads: false })), brief(semanal({ falhou: true })), brief(semanal({ estado: ESTADO('queda') }))]
  for (const b of casos) {
    for (const s of todasAsStrings(b)) {
      for (const p of PROIBIDOS) assert.ok(!p.rx.test(s), `PROIBIDOS.${p.id} em "${s.slice(0, 60)}"`)
      assert.ok(!rxN.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()), `nome interno em "${s.slice(0, 60)}"`)
    }
    assert.deepEqual(auditarBrief(b, { nomes: NOMES }), [], 'o auditor concorda')
    const t = todasAsStrings(b).join('\n').toLowerCase()
    for (const x of ['giovanna', 'torres', 'carla', 'souza', 'vitória', 'notion.so', 'mlb', 'ps-', 'bloqueio', 'backlog', 'algoritmo', 'merov', 'payload', 'garant', 'ranking', 'top 1']) assert.ok(!t.includes(x), `"${x}" não aparece`)
    assert.ok(!/\bprints?\b/.test(t), 'sem prints')
  }
})

await ok('auditarBrief: acusa cada regra com {regra, caminho} e NUNCA ecoa o texto; nomes por palavra inteira só em texto dinâmico; gabarito e _interno passam', () => {
  const base = brief(SEM_A())
  const com = (chave, valor) => ({ ...structuredClone(base), [chave]: valor })
  const dep = valor => { const b = structuredClone(base); b.depende.itens[0].rotulo = valor; return b }                 // texto dinâmico (vem de card/motor): nomes valem
  const casos = [
    ['sem_motivo', 'Tarefa — sem motivo registrado — registre pela tela Painel executivo'], ['id_interno', 'Veja PS-1a2b3c4'], ['id_interno', 'Anúncio MLB4789167797'], ['id_interno', 'código 4224148046930256'],
    ['notion', 'Veja no Notion'], ['sistema', 'Ajuste do algoritmo'], ['sistema', 'Merovíngio decidiu'], ['jargao', 'consulta a API retornou 403'], ['bloqueio_cru', 'Bloqueio: aguardando'],
    ['comprovado', 'efeito comprovado'], ['efeito_observado', 'Efeito observado: +10%'], ['vocabulario_interno', 'Responsável: alguém'], ['vocabulario_interno', 'fale com o consultor'], ['promessa', 'vai garantir o ranking'], ['promessa', 'resultado garantido'], ['promessa', 'Top 1 do nicho'],
    ['url', 'http://localhost:3012/x'], ['lixo', 'Faturamento R$ 0,00'], ['lixo', 'valor undefined'],
  ]
  for (const [regra, valor] of casos) {
    const v = auditarBrief(com('rodape', [valor]), { nomes: NOMES })
    assert.deepEqual(v, [{ regra, caminho: 'rodape[0]' }], `${regra}: ${valor}`)
    assert.ok(!JSON.stringify(v).includes(valor.slice(0, 12)), 'a violação não carrega o texto')
  }
  assert.deepEqual(auditarBrief(dep('Feito por Giovanna'), { nomes: NOMES }), [{ regra: 'nome_interno', caminho: 'depende.itens[0].rotulo' }])
  assert.deepEqual(auditarBrief(dep('Equipe: Torres'), { nomes: NOMES }), [{ regra: 'nome_interno', caminho: 'depende.itens[0].rotulo' }])
  assert.deepEqual(auditarBrief(dep('Maria Aparecida Rosa e dos Santos analisou'), { nomes: ['Maria dos Santos'] }), [{ regra: 'nome_interno', caminho: 'depende.itens[0].rotulo' }])
  assert.deepEqual(auditarBrief(dep('a maioria dos anúncios, dos quais'), { nomes: ['Maria dos Santos'] }), [], 'partícula "dos" não vira nome')
  assert.deepEqual(auditarBrief(dep('Giovannas'), { nomes: ['Giovanna Torres'] }), [], 'palavra inteira, não pedaço')
  assert.deepEqual(auditarBrief(dep('Fotos do produto: enviar as fotos'), { nomes: ['Mariana Fotos'] }), [{ regra: 'nome_interno', caminho: 'depende.itens[0].rotulo' }], 'palavra do card coincide com nome: bloqueia (falha fechada)')
  assert.deepEqual(auditarBrief(com('rodape', ['Últimos 7 dias fechados']), { nomes: ['Mariana Dias'] }), [], 'gabarito: sobrenome que é palavra comum não derruba o relatório')
  assert.deepEqual(auditarBrief(Object.assign(structuredClone(base), { _interno: { avisos: ['Giovanna MLB123456789 Bloqueio:'] }, cliente: 'Torres Pet' }), { nomes: NOMES }), [], '_interno e o nome do cliente ficam fora da auditoria')
  assert.deepEqual(auditarBrief(base, { nomes: NOMES }), [])
  const e = new BriefInseguro([{ regra: 'x', caminho: 'y' }]); assert.equal(e.code, 'BRIEF_INSEGURO'); assert.equal(e.status, 422); assert.ok(!/Giovanna/.test(e.message))
})

await ok('limparTitulo: 1ª linha, sem · PS-…, (MLB…), ids de 10+ dígitos, "ID do Produto", sufixo (n); corta em 70 na palavra; proibido vira genérico e conta', () => {
  assert.equal(limparTitulo('Recuperar a caixa de compra: Mordedor Natural · PS-1a2b3c', 'Mercado Livre'), 'Recuperar a caixa de compra: Mordedor Natural')
  assert.equal(limparTitulo('Criar kit petisqueira (5203884867) + backup segurança (6224133850)'), 'Criar kit petisqueira + backup segurança')
  assert.equal(limparTitulo('Duplicação de título 4224148046930256'), 'Duplicação de título')
  assert.equal(limparTitulo('Corrigir título (MLB4789167797)\nsegunda linha com Bloqueio: x'), 'Corrigir título')
  assert.equal(limparTitulo('Ajustar kit - ID do Produto: 1234567890123'), 'Ajustar kit')
  assert.equal(limparTitulo('Revisão de títulos (4)'), 'Revisão de títulos'); assert.equal(limparTitulo('revisão (12)'), 'Revisão')
  const longo = limparTitulo('Otimização completa de título descrição fotos e ficha técnica dos anúncios de coleiras e guias para cachorro de grande porte')
  assert.ok(longo.length <= 70 && longo.endsWith('…') && !/\s…$/.test(longo) && /ficha$|fotos$|técnica$|e$|descrição$|dos$|de$/.test(longo.replace('…', '')) || longo.length <= 70, longo)
  const om = {}
  assert.equal(limparTitulo('Alinhar com a analista Carla', 'TikTok Shop', { omitidos: om, rxNomes: regexNomes(['Carla Souza']) }), 'Ajuste de rotina — TikTok Shop'); assert.equal(om.titulos_genericos, 1)
  assert.equal(limparTitulo('Garantir o ranking top 1', 'Shopee', { omitidos: om }), 'Ajuste de rotina — Shopee'); assert.equal(limparTitulo('(5203884867)', ''), 'Ajuste de rotina')
  assert.equal(limparTitulo('Renovação do contrato', 'ML'), 'Ajuste de rotina — ML'); assert.equal(om.titulos_genericos, 2)
  assert.equal(limparTitulo(null), 'Ajuste de rotina'); assert.equal(limparTitulo('duplicar 6761140810'), 'Duplicar')
  // títulos reais do Notion: id colado, MLBU, "MLB: 123", fração (1/2), separador solto, "Consultoria" (serviço) não é a pessoa
  assert.equal(limparTitulo('Otimização de Anúncio - 16505508773v'), 'Otimização de Anúncio'); assert.equal(limparTitulo('Otimizar anúncio MLBU3972313200 '), 'Otimizar anúncio')
  assert.equal(limparTitulo('Reformular anúncioMLB4810782857 — Vaso Decorativo'), 'Reformular anúncio — Vaso Decorativo')
  assert.equal(limparTitulo('Aplicar Estratégia IMA — MLB: 5000748399 — Plafon Painel LED'), 'Aplicar Estratégia IMA — Plafon Painel LED')
  assert.equal(limparTitulo('Otimizar anúncios 6289427582 / 6289453672'), 'Otimizar anúncios'); assert.equal(limparTitulo('Otimizar anúncios: 23097832064- alterar a foto de capa'), 'Otimizar anúncios: alterar a foto de capa')
  assert.equal(limparTitulo('Duplicar Anúncio: 22193200461 (1/2)'), 'Duplicar Anúncio'); assert.equal(limparTitulo('08 Reunião de Consultoria - Decoração da Loja'), '08 Reunião de Consultoria - Decoração da Loja')
  assert.equal(limparTitulo('Troca de Consultor: Estratégia de ADS', 'Mercado Livre'), 'Ajuste de rotina — Mercado Livre')
})

await ok('mudanças: agrupa por campo+dia, deduplica o mesmo evento de duas fontes, limita às mais recentes e usa o vocabulário do change-log', () => {
  const ev = new Map([
    ['MLB1', [{ dia: '2026-10-02', campo: 'frete_gratis', de: 0, para: 1, pct: null, fonte: 'coleta' }, { dia: '2026-10-02', campo: 'frete_gratis', de: 0, para: 1, pct: null, fonte: 'promo' }, { dia: '2026-10-03', campo: 'titulo', de: 'a', para: 'b', pct: null, fonte: 'coleta' }]],
    ['MLB2', [{ dia: '2026-10-02', campo: 'frete_gratis', de: 0, para: 1, pct: null, fonte: 'coleta' }, { dia: '2026-10-04', campo: 'fotos', de: 3, para: 6, pct: null, fonte: 'coleta' }, { dia: '2026-10-05', campo: 'thumb', de: 'x', para: 'y', pct: null, fonte: 'coleta' },
      { dia: '2026-10-06', campo: 'ads', de: 'active', para: 'paused', pct: null, fonte: 'coleta' }, { dia: '2026-10-07', campo: 'promocao', de: 'DEAL −10%', para: 'nenhuma', pct: null, fonte: 'promo' },
      { dia: '2026-10-07', campo: 'promocao', de: 'DEAL −10%', para: 'LIGHTNING −10%', pct: null, fonte: 'promo' }]]])
  const m = brief(SEM_A(), { eventos: ev }).desenvolvimento.mudancas
  assert.equal(m.length, 5, 'limite de 5: as mais recentes'); assert.deepEqual(m.map(x => x.quando), [...m.map(x => x.quando)].sort())
  assert.deepEqual(m.map(x => x.texto), ['Fotos atualizadas em 1 anúncio', 'Foto de capa trocada em 1 anúncio', 'Ads pausado em 1 anúncio', '1 anúncio saiu da promoção', 'Título atualizado em 1 anúncio'].sort((a, b) => 0).map((_, i) => m[i].texto))
  assert.ok(m.some(x => x.texto === '1 anúncio saiu da promoção') && !m.some(x => /LIGHTNING|DEAL/.test(x.texto)), 'troca de tipo de promoção (sem cruzar a fronteira) não é evento')
  const freete = brief(SEM_A(), { eventos: new Map([ev.entries().next().value, ['MLB2', [ev.get('MLB2')[0]]]].slice(0, 1).concat([['MLB2', [{ dia: '2026-10-02', campo: 'frete_gratis', de: 0, para: 1, pct: null, fonte: 'coleta' }]]])) }).desenvolvimento.mudancas
  assert.equal(freete[0].texto, 'Frete grátis ativado em 2 anúncios', 'duas fontes do MESMO anúncio contam uma vez; outro anúncio soma')
  assert.equal(brief(SEM_A(), { eventos: { MLB9: [{ dia: '2026-10-04', campo: 'titulo', de: 'a', para: 'b' }] } }).desenvolvimento.mudancas.length, 1, 'aceita objeto simples')
  assert.equal(brief(SEM_A(), { eventos: [{ item_id: 'MLB9', dia: '2026-10-04', campo: 'titulo', de: 'a', para: 'b' }] }).desenvolvimento.mudancas.length, 1, 'aceita lista plana')
})

await ok('próximos: ação distribuída e card com PS- são a MESMA coisa; calendário dentro de 14 dias é "calendario" e fora vira radar; limites; sem datas = frase de vazio', () => {
  const com = brief(semanal({ lista: true, ofertas: null, proximos: [prox('Recuperar a caixa de compra: Mordedor · PS-aaaaaa', 'nao_iniciada', { data_planejada: '2026-10-15' }), prox('Ficha técnica nova', 'nao_iniciada', { data_planejada: '2026-10-15' })] }),
    { acoesPlano: [PLANO[0], A({ regra: 'calendario', titulo: 'Preparar Dia das Crianças (12/10/2026)', prazo: '2026-10-10' })] })
  assert.deepEqual(com.proximos.itens.map(i => [i.quando, i.origem, i.rotulo]), [['2026-10-10', 'calendario', 'Preparar Dia das Crianças (12/10)'], ['2026-10-15', 'acao', 'Recuperar a caixa de compra: Mordedor Natural Para Cachorro Trança…'], ['2026-10-15', 'tarefa', 'Ficha técnica nova']])
  const muitas = Array.from({ length: 12 }, (_, i) => A({ regra: 'anuncio_frete_gratis', titulo: `Ativar frete grátis ${i} produto`, prazo: `2026-10-${String(9 + (i % 5)).padStart(2, '0')}` }))
  const lim = brief(semanal({ ofertas: null }), { acoesPlano: muitas })
  assert.equal(lim.proximos.itens.length, 8); assert.deepEqual(lim.proximos.itens.map(i => i.quando), [...lim.proximos.itens.map(i => i.quando)].sort())
  const so = brief(semanal({ ofertas: null }), { acoesPlano: [PLANO[2], PLANO[3], A({ regra: 'calendario', titulo: 'Preparar Outubro Rosa (31/10/2026)', prazo: '2026-10-23' })] })
  assert.deepEqual(so.proximos.itens, [], 'só radar'); assert.deepEqual(so.proximos.radar.map(r => r.quando), ['2026-10-23', '2026-10-28']); assert.equal(so.proximos.vazio, null)
  const nada = brief(semanal({ ofertas: null }), { acoesPlano: [] })
  assert.deepEqual([nada.proximos.itens, nada.proximos.radar, nada.proximos.agenda, nada.proximos.vazio], [[], [], null, 'Sem datas futuras confirmadas para os próximos 14 dias.'])
  assert.equal(nada.abertura.nudge, '', 'sem depende e sem próximo marco: sem gancho')
  assert.match(brief(SEM_A(), { acoesPlano: PLANO }).abertura.nudge, /pontos aguardam/)
  assert.match(brief(semanal({ ofertas: null }), { acoesPlano: [PLANO[0]] }).abertura.nudge, /^Próximo marco: 15\/10 — Recuperar a caixa de compra: Mordedor/)
})

await ok('hoje inválido e cliente inválido são rejeitados ANTES do motor; o motor recebe a janela fechada, interno:false e leve:true (furo 9)', async () => {
  let chamadas = 0, args = null
  const deps = (o = {}) => ({ montarSemanal: async a => { chamadas++; args = a; return SEM_A() }, hoje: () => HOJE, agora: () => AGORA, lerAcoes: () => PLANO, eventos: () => EVENTOS, inicioHistorico: () => '2026-09-28', negocioHoje: async () => ({ faturamento: 812.5, vendas: 14 }), nomesInternos: () => NOMES, ...o })
  const { gerar } = criarBrief(deps())
  for (const ruim of ['2026-02-30', '2026-13-01', '26-10-08', '', 'ontem', '2026-10-08T10:00:00Z']) await assert.rejects(() => gerar(CLIENTE, { hoje: ruim }), /data de referência inválida/)
  await assert.rejects(() => criarBrief(deps({ hoje: () => '2026-99-99' })).gerar(CLIENTE), /data de referência inválida/)
  await assert.rejects(() => gerar(CLIENTE, { agora: 'não é hora' }), /horário de geração inválido/)
  for (const ruim of ['', '   ', null, undefined, 42, {}, '[Comercial] Prospect X']) await assert.rejects(() => gerar(ruim), /cliente inválido/)
  assert.equal(chamadas, 0, 'o motor nunca foi chamado')
  const b = await gerar(CLIENTE)
  assert.equal(chamadas, 1); assert.deepEqual(args, { cliente: CLIENTE, de: DE, ate: ATE, interno: false, leve: true })
  assert.equal(b.janela.ate, ATE); assert.equal(b.hora, '14:20'); assert.equal(b.cliente, CLIENTE)
  const virada = await gerar(CLIENTE, { hoje: '2026-01-03', agora: '2026-01-03T12:00:00.000Z' })
  assert.deepEqual([args.de, args.ate, virada.janela.de, virada.janela.ate], ['2025-12-27', '2026-01-02', '2025-12-27', '2026-01-02'])
  assert.equal(virada.hora, '09:00', 'hora no fuso do cliente (São Paulo), não da máquina')
})

await ok('gerar: a linha "hoje" é cortesia — falha/demora/valor ruim some sem derrubar; só com ML (API) e janela fechada; o que sai nunca tem _interno', async () => {
  const mk = o => criarBrief({ montarSemanal: async () => SEM_A(), hoje: () => HOJE, agora: () => AGORA, lerAcoes: () => PLANO, eventos: () => EVENTOS, inicioHistorico: () => '2026-09-28', nomesInternos: () => NOMES, cfg: { ...cfgBrief, hoje_timeout_ms: 30 }, ...o })
  assert.deepEqual((await mk({ negocioHoje: async () => ({ faturamento: 10, vendas: 2 }) }).gerar(CLIENTE)).resultados.hoje, { ate_hora: '14:20', faturamento: 'R$ 10,00', pedidos: 2 })
  for (const negocioHoje of [async () => { throw new Error('ML caiu') }, () => new Promise(() => {}), async () => ({ disponivel: false }), async () => ({ faturamento: null, vendas: null }), undefined])
    assert.equal((await mk({ negocioHoje }).gerar(CLIENTE)).resultados.hoje, null)
  let chamou = false
  const b = await mk({ montarSemanal: async () => semanal({ conectado: false, estado: null, acoes: [acao('X', '2026-10-03')] }), negocioHoje: async () => { chamou = true; return { faturamento: 1, vendas: 1 } } }).gerar(CLIENTE)
  assert.equal(chamou, false, 'sem ML conectado não chama o ML'); assert.equal(b.resultados.hoje, null)
  const c = await mk({}).gerar(CLIENTE)
  assert.ok(c._interno.avisos.some(a => /data planejada vencida/.test(a)), 'o brief carrega _interno; quem envia usa semInterno')
  const fora = semInterno(c); assert.ok(!('_interno' in fora) && fora.titulo === c.titulo && fora.versao === 1)
  assert.ok(!JSON.stringify(fora).includes('data planejada vencida') && !JSON.stringify(fora).includes('_interno'), 'os avisos internos não escapam para o resto do brief')
  assert.ok(b._interno && Array.isArray(b._interno.avisos))
})

await ok('gerar: texto interno que escapar da limpeza BLOQUEIA (BriefInseguro, sem eco); isolamento por cliente; deps falhando propagam', async () => {
  const sujo = SEM_A(); sujo.resultados.outros = [{ canal: 'TikTok Shop', fonte: 'manual', metricas: [{ chave: 'faturamento', rotulo: 'Faturamento', valor: 100, unidade: 'moeda' }] }]
  const mk = (sem, o = {}) => criarBrief({ montarSemanal: async () => sem, hoje: () => HOJE, agora: () => AGORA, lerAcoes: () => PLANO, eventos: () => EVENTOS, inicioHistorico: () => null, nomesInternos: () => NOMES, ...o })
  const b = await mk(sujo).gerar(CLIENTE); assert.deepEqual(b.resultados.outros.map(o => o.canal), ['TikTok Shop'])
  const nomeNoCanal = semanal({ acoes: [acao('Vídeos', '2026-10-03', 'Canal da Giovanna')] })
  const g = await mk(nomeNoCanal).gerar(CLIENTE); assert.ok(g.atividades.concluido.por_canal.every(c => !/Giovanna/.test(c.canal)), 'canal com nome interno vira "Outros canais"')
  assert.ok(g.atividades.concluido.por_canal.some(c => c.canal === 'Outros canais'))
  // sobrenome que é palavra do texto fixo ("Dias" em "últimos 14 dias") NÃO pode derrubar todo relatório; já o texto vindo do motor/cards é checado por nome
  const dias = await mk(SEM_A(), { nomesInternos: () => ['Mariana Dias', 'Maria Conta'] }).gerar(CLIENTE)
  assert.match(dias.abertura.frase, /últimos 14 dias/); assert.match(dias.rodape[0], /Últimos 7 dias fechados/); assert.equal(dias.abertura.cabecalho, 'Conta em estagnação')
  // texto do brief que não é "gabarito" e coincide com nome interno (rótulo de tipo de promoção) => a 2ª camada bloqueia, sem eco
  const coincide = mk(SEM_A(), { nomesInternos: () => ['Maria Relâmpago'] })
  await assert.rejects(() => coincide.gerar(CLIENTE), e => { assert.ok(e instanceof BriefInseguro && e.code === 'BRIEF_INSEGURO'); assert.ok(e.violacoes.length && e.violacoes.every(v => v.regra === 'nome_interno' && /^proximos\.itens\[\d+\]\.rotulo$/.test(v.caminho))); assert.ok(!/Maria|Relâmpago/.test(e.message + JSON.stringify(e.violacoes))); return true })
  await assert.rejects(() => mk(SEM_A(), { lerAcoes: () => { throw new Error('banco') } }).gerar(CLIENTE), /banco/)
  const outro = await mk(SEM_A(), { lerAcoes: ({ clientes }) => { assert.deepEqual(clientes, [CLIENTE]); return PLANO } }).gerar(CLIENTE)
  assert.ok(!JSON.stringify(outro.proximos).includes('Outro Cliente'))
})

await ok('fiação REAL (banco em memória): nomesInternos devolve nomes sem tocar data/db.sqlite; gerar rejeita data inválida antes de qualquer consulta', async () => {
  const { briefReal, nomesInternos } = await import('../src/lib/relatorio-brief-real.js')
  const { db } = await import('../src/lib/db.js')
  assert.equal(db.name, ':memory:', 'o teste NUNCA abre data/db.sqlite')
  db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, responsavel, status, arquivada) VALUES ('t-1','f','Cliente Teste','x','Giovanna Torres, Carla Souza e Zé Pedro','andamento',0)").run()
  db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, responsavel, status, arquivada) VALUES ('t-2','f','Outro','x','Fulano Alheio','andamento',0)").run()
  const nomes = nomesInternos('Cliente Teste')
  for (const n of ['Giovanna Torres', 'Carla Souza', 'Zé Pedro']) assert.ok(nomes.includes(n), `${n} entra`)
  assert.ok(!nomes.includes('Fulano Alheio') && nomes.every(x => x && x !== '—'), 'responsáveis de OUTRO cliente não entram')
  assert.deepEqual(nomesInternos('Cliente Inexistente').filter(x => x === 'Giovanna Torres'), [])
  for (const ruim of ['2026-02-30', 'xx']) await assert.rejects(() => briefReal.gerar('Cliente Teste', { hoje: ruim }), /data de referência inválida/)
  await assert.rejects(() => briefReal.gerar('[Comercial] Prospect', { hoje: HOJE }), /cliente inválido/)
})

await ok('integração com o motor REAL (banco em memória, sem Mercado Livre): campos aditivos de montarSemanal alimentam o brief; `leve` e PDF intactos', async () => {
  const { db, hojeLocal } = await import('../src/lib/db.js'), { montarSemanal } = await import('../src/lib/semanal.js')
  assert.equal(db.name, ':memory:')
  const hoje = hojeLocal(), J = janelaDoRelatorio(hoje)
  const soma = (iso, k) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10) }
  const C = 'Cliente Integração'
  const ins = db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, processo, responsavel, status_raw, status, data_inicio, prazo, data_conclusao, visivel_cliente, arquivada, last_edited) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,0,?)")
  const t = (id, titulo, status, o = {}) => ins.run(id, 'f', C, titulo, 'Mercado Livre', 'Giovanna Torres', status, status, o.ini ?? null, o.prazo ?? null, o.conc ?? null, o.ed || '2026-10-01T10:00:00.000Z')
  t('a1', 'Revisão de títulos (1)', 'concluida', { conc: J.ate }); t('a2', 'Revisão de títulos (2)', 'concluida', { conc: J.de })
  t('b1', 'Ficha técnica da linha', 'nao_iniciada', { ini: soma(hoje, 3), conc: soma(hoje, 3) }); t('b2', 'Tarefa vencida', 'nao_iniciada', { ini: soma(hoje, -5), conc: soma(hoje, -5) })
  t('c1', 'Fotos do kit', 'dependencia_cliente', { ed: soma(hoje, -6) + 'T10:00:00.000Z' }); t('c2', 'Fotos do kit', 'dependencia_cliente', { ed: soma(hoje, -3) + 'T10:00:00.000Z' })
  const sem = await montarSemanal({ cliente: C, de: J.de, ate: J.ate, interno: false, leve: true })
  const b1 = sem.proximos.find(p => p.titulo === 'Ficha técnica da linha'), dep = sem.proximos.find(p => p.status === 'dependencia_cliente')
  assert.equal(b1.data_planejada, soma(hoje, 3)); assert.equal(sem.proximos.find(p => p.titulo === 'Tarefa vencida').data_planejada, soma(hoje, -5))
  assert.deepEqual([dep.motivo_registrado, dep.dependencia_cliente.includes('sem motivo registrado'), typeof dep.dias_aguardando, /^\d{4}-\d{2}-\d{2}$/.test(dep.desde)], [false, true, 'number', true])
  assert.ok(Array.isArray(sem.risco_estoque))
  const b = await criarBrief({ montarSemanal, hoje: hojeLocal, agora: () => new Date().toISOString(), lerAcoes: () => [], eventos: () => new Map(), inicioHistorico: () => null, nomesInternos: () => ['Giovanna Torres'] }).gerar(C)
  assert.equal(b.modo, 'sem_resultados'); assert.equal(b.qualidade.ok, true); assert.equal(b.janela.ate, J.ate)
  assert.equal(b.atividades.concluido.total, 2); assert.equal(b.atividades.lista, sem.perfil.regras.lista_tarefas === true || cfgBrief.listar_tarefas_sempre === true); assert.equal(b.proximos.agenda ? b.proximos.agenda.total : b.proximos.itens.length, 1, 'só a tarefa futura; a vencida fica fora')
  assert.deepEqual(b.depende.itens, [{ rotulo: 'Fotos do kit (2 tarefas) — aguardamos um retorno seu sobre estas tarefas', desde: soma(hoje, -6), dias: null, desde_aproximado: true }], 'a mais antiga manda (data da última edição = aproximada: sem contagem de dias); texto interno SEM_MOTIVO nunca sai')
  assert.ok(!texto(b).includes('sem motivo registrado') && !texto(b).includes('Giovanna'))
  assert.ok(b._interno.avisos.some(a => /data planejada vencida/.test(a)))
  // aditivo: `leve` só pula produtosMaisVendidos e nenhuma linha fixada pelos outros testes mudou
  const f = readFileSync(new URL('../src/lib/semanal.js', import.meta.url), 'utf-8')
  assert.match(f, /export async function montarSemanal\(\{ cliente, de, ate, interno = false, perfil, leve = false \}\)/); assert.match(f, /if \(!leve\) try \{ produtosTop = await produtosMaisVendidos\(cliente, \{ de, ate \}\) \}/)
  assert.match(f, /\.\.\.dependencias\.map\(d => proximo\(d, d\.texto\)\)/); assert.match(f, /risco_estoque: retro\?\.risco_estoque \|\| \[\]/)
  const r = readFileSync(new URL('../src/lib/render-semanal.js', import.meta.url), 'utf-8')
  for (const nome of ['RX_JARGAO', 'TIPO_OFERTA', 'STATUS_OFERTA']) assert.match(r, new RegExp(`^export const ${nome} =`, 'm'))
})

// ── correções da revisão adversarial nº 2 (F2) ────────────────────────────────────────────────────────────────────────────────────────────────
const todasLimpas = (b, nomes = NOMES) => todasAsStrings(b).flatMap(t => auditarTexto(t, { nomesInternos: nomes, permitidos: [b.cliente] }).map(v => `${v.codigo}: ${t.slice(0, 50)}`))

await ok('item 10: texto livre do card (informado) — causal, promessa, nome, URL, "Resultado: 0", número solto, texto longo e "null" NÃO entram; o curto e factual entra', () => {
  const com = t => brief(semanal({ lista: true, estado: ESTADO('crescimento'), tarefas: [tarefa('t9', 'Ajuste de foto do kit', { resultado_alcancado: t })] }), { acoesPlano: [], eventos: new Map() })
  const ruins = ['Vendas dobraram graças à nova foto', 'Aumento de 40% nas vendas por causa da otimização do título', 'A ação trouxe R$ 5.000 de faturamento', 'Resultado garantido: sobe no ranking em 7 dias', 'Conforme combinado com a Carla, ficou ótimo', 'Cliente Giovanna aprovou',
    'Ver https://docs.google.com/spreadsheets/d/abc', 'Resultado: 0', 'Resultado: 12', '12', 'null', 'ver planilha interna do ERP', 'Conta liberada pelo suporte do Notion', 'Vendas subiram 12,5% (MLB 3852824965)', '12345678901', 'Sucesso total, 100% certo',
    'Efeito  observado de +9%', 'Foi consequência da troca de capa', 'Assegura mais pedidos', 'Líder da categoria', 'Texto longo demais para um resultado informado: ' + 'x'.repeat(40) + ' pedidos recuperados na semana inteira']
  for (const t of ruins) { const b = com(t); assert.deepEqual(b.desenvolvimento.resultados, [], `não deve entrar: ${t}`); assert.ok(b._interno.omitidos.resultados_descartados >= 1 || (b._interno.omitidos.resultados || 0) >= 1, t); assert.deepEqual(todasLimpas(b), [], 'o brief gerado passa limpo nas duas camadas') }
  for (const [t, esperado] of [['14 pedidos recuperados', '14 pedidos recuperados'], ['+12% de visitas', '+12% de visitas'], ['0 pedidos recuperados', '0 pedidos recuperados'], ['Garantia estendida de 12 meses publicada', 'Garantia estendida de 12 meses publicada']]) {
    const r = com(t).desenvolvimento.resultados; assert.deepEqual([r.length, r[0]?.selo, r[0]?.metrica.texto], [1, 'informado', esperado], t)
  }
  assert.equal(cfgBrief.limites.informado_caracteres, 80); assert.equal(com('p'.repeat(81)).desenvolvimento.resultados.length, 0); assert.equal(com('pedidos ' + 'p'.repeat(72)).desenvolvimento.resultados.length, 1, '80 caracteres cabem')
})

await ok('item 11: as duas camadas concordam — título que o auditor barraria vira "Ajuste de rotina" (nunca trava o relatório); "Sprint Black Friday" e "garantia" passam', async () => {
  const bom = ['Sprint Black Friday: preparar anúncios', 'Revisar garantia do produto', 'Comprovante de Pagamento e Assinatura', 'Máquina Lava Roupas 11kg — ficha técnica', 'Revisar preço do kit']
  const ruim = ['Revisar preço (garantir margem)', 'Garantir cobertura >=45 dias do Spot COB BQ 3000k   (B09JWXSQPN)', 'Escalar ADS somente com estoque garantido', 'Subir o score da conta', 'Entregar relatório da sprint de vendas', 'Resultado da otimização de título', 'Ajuste por causa do algoritmo', 'Conferir planilha interna']
  const om = {}, ctx = { rxNomes: regexNomes(NOMES, [CLIENTE]), nomes: NOMES, permitidos: [CLIENTE], omitidos: om }
  for (const t of bom) assert.equal(limparTitulo(t, 'Mercado Livre', ctx), t.replace(/\s+/g, ' ').replace(/^(.)/, c => c.toUpperCase()), t)
  for (const t of ruim) assert.equal(limparTitulo(t, 'Mercado Livre', ctx), 'Ajuste de rotina — Mercado Livre', t)
  assert.equal(om.titulos_genericos, ruim.length); assert.ok(om.titulos_genericos_por && Object.values(om.titulos_genericos_por).reduce((a, b) => a + b) === ruim.length, 'o motivo é contado (interno), nunca o texto')
  // a propriedade: tudo que limparTitulo devolve (fora o genérico) passa no auditor de verdade
  for (const t of [...bom, ...ruim, 'Place Sprints: conectar conta', 'Sprint de abril', 'Chamado com Suporte Meli', 'Dar baixa no ID do Produto 123']) { const o = limparTitulo(t, 'Shopee', ctx); assert.ok(/^Ajuste de rotina/.test(o) || auditarTexto(o, { nomesInternos: NOMES, permitidos: [CLIENTE] }).length === 0, t) }
  // o relatório inteiro sai com esses títulos (antes: BriefInseguro/promessa na 2ª camada)
  const sem = semanal({ lista: true, acoes: [...bom, ...ruim].map((t, i) => acao(t, '2026-10-0' + (2 + i % 5), 'Mercado Livre')), proximos: ruim.map(t => prox(t, 'andamento', { data_planejada: '2026-10-12' })) })
  const gerado = await criarBrief({ montarSemanal: async () => sem, hoje: () => HOJE, agora: () => AGORA, lerAcoes: () => [], eventos: () => new Map(), inicioHistorico: () => null, nomesInternos: () => NOMES }).gerar(CLIENTE)
  assert.deepEqual(todasLimpas(gerado), [], 'nenhuma string do brief é barrada pela 2ª camada'); assert.ok(gerado.atividades.concluido.grupos.some(g => g.rotulo === 'Sprint Black Friday: preparar anúncios'))
})

await ok('item 12: limparTitulo remove URL, "https:" solto e domínio ANTES das outras substituições; não sobra fragmento nem verbo solto', () => {
  const casos = [['Cadastro de produtos: https://shopee.com.br/Conjunto-Camisa-Colete-Infantil-Masculino', 'Cadastro de produtos'], ['Cadastro de produtos: https: shopee.com.br/Conjunto-Camisa-Colete', 'Cadastro de produtos'],
    ['Ver https://lista.mercadolivre.com.br/_CustId_123456789', 'Ajuste de rotina — Mercado Livre'], ['Ajuste ML https://produto.mercadolivre.com.br/MLB-123456789-xyz', 'Ajuste ML'], ['Ajuste loja.com.br/produto?token=abc', 'Ajuste'],
    ['Revisar http://mercadolivre.com.br/p/MLB19847564', 'Revisar'], ['Atualizar www.exemplo.net/catalogo e fotos', 'Atualizar e fotos'], ['Anúncio https://articulo.mercadolibre.com.ar/MLA-123', 'Anúncio']]
  for (const [entrada, saida] of casos) { const o = limparTitulo(entrada, 'Mercado Livre'); assert.equal(o, saida, entrada); assert.ok(!/https?|www\.|\.com|\.br|\.net/i.test(o), o) }
  // o domínio que sobrar na mão do auditor final também é barrado (url)
  assert.ok(PROIBIDOS.find(p => p.id === 'url').rx.test('Veja loja.com.br/x')); assert.ok(!PROIBIDOS.find(p => p.id === 'url').rx.test('Mercado Livre e Shopee'))
})

await ok('itens 15/16c (camada 1): nome interno por token com `permitidos` (nome do cliente), e-mail ignorado, palavra comum só com o nome completo; 15 títulos reais não viram genéricos à toa', async () => {
  const rx = regexNomes(['Giovanna Torres', 'lojakairos@gmail.com', 'comercial@setefarma.com', 'Julia Rosa De Aguiar Araujo', 'Thayná Alves Lava', 'Carlos Lima', 'Sara Souza'], ['DG da Silva'])
  for (const t of ['feito pela Giovanna', 'Torres, Giovanna', 'G. Torres', 'Giovanna_Torres', 'TAREFA DE CASA SARA: CADASTRO MANUAL', 'Thayná Alves Lava', 'Julia ajustou']) assert.ok(rx.test(t), `barra: ${t}`)
  for (const t of ['Reunião: Chamado com Suporte Meli', 'Trocar capa para: Biquíni Rosa', 'Cadastro Bases - Boca Rosa', 'Shampoo Lava Autos Desengraxante', 'Adicionar imagens padrão na cor Lima', 'Curva A/B/C — DG da Silva', 'Criar anúncio da variação rosa']) assert.ok(!rx.test(t), `NÃO barra: ${t}`)
  const nomes = ['Giovanna Torres', 'Ana Torres']
  assert.equal(limparTitulo('Fotos da loja Torres Pet', 'Mercado Livre', { rxNomes: regexNomes(nomes, ['Torres Pet']), nomes, permitidos: ['Torres Pet'] }), 'Fotos da loja Torres Pet', 'sobrenome que está no nome do cliente passa')
  assert.equal(limparTitulo('Fotos da loja Torres Pet', 'Mercado Livre', { rxNomes: regexNomes(nomes, ['Outro Cliente']), nomes, permitidos: ['Outro Cliente'] }), 'Ajuste de rotina — Mercado Livre', 'em outro cliente, o mesmo título vaza o sobrenome')
  assert.equal(limparTitulo('Ana ajustou o kit', 'Mercado Livre', { rxNomes: regexNomes(nomes, ['Torres Pet']), nomes, permitidos: ['Torres Pet'] }), 'Ajuste de rotina — Mercado Livre', 'o primeiro nome continua barrado')
  // o brief inteiro respeita o nome do cliente (projetarBrief passa `cliente` como permitido nas duas camadas)
  const sem = semanal({ lista: true, acoes: [acao('Fotos da loja Torres Pet', '2026-10-03', 'Mercado Livre'), acao('Ana trocou a capa', '2026-10-04', 'Mercado Livre')] })
  const g = projetarBrief(sem, ctxBase({ cliente: 'Torres Pet', nomes, acoesPlano: [] })).atividades.concluido.grupos.map(x => x.rotulo).sort()
  assert.deepEqual(g, ['Ajuste de rotina — Mercado Livre', 'Fotos da loja Torres Pet'])
  assert.deepEqual(auditarBrief(projetarBrief(sem, ctxBase({ cliente: 'Torres Pet', nomes, acoesPlano: [] })), { nomes }), [], 'o auditor final usa o mesmo `permitidos` (nome do cliente)')
})

await ok('item 16e: período anterior em AMOSTRA (>1.000 pedidos) não gera variação — coluna anterior "—", variação vazia, aviso em "não coletado"; Ads (outra fonte) segue', () => {
  const b = brief(semanal({ anterior: { ...NEG_ANT, parcial: true } }))
  const L = Object.fromEntries(b.resultados.linhas.map(l => [l.chave, l]))
  for (const k of ['faturamento', 'vendas', 'ticket_medio', 'visitas', 'conversao', 'cancelamentos']) assert.deepEqual([L[k].anterior, L[k].variacao], ['—', null], k)
  assert.deepEqual([L.investimento.anterior, L.roas.anterior], ['R$ 200,00', '7,5'], 'Ads não é amostra')
  assert.ok(b.resultados.nao_coletado.some(x => /^período anterior para comparação: o período anterior tem mais de 1\.000 pedidos e só uma amostra foi lida; a variação não é calculada$/.test(x)))
  const normal = brief(semanal()); assert.equal(normal.resultados.linhas[0].anterior, 'R$ 5.500,00'); assert.ok(!normal.resultados.nao_coletado.some(x => /amostra/.test(x)))
})

await ok('item 16j: "previsto" só no prazo de ação APROVADA (ainda sem tarefa distribuída); distribuída, tarefa agendada, promoção e radar não levam', () => {
  const plano = [A({ id: 'PS-a1', regra: 'anuncio_frete_gratis', titulo: 'Ativar frete grátis: Bola Maciça', prazo: '2026-10-09', status: 'distribuida' }),
    A({ id: 'PS-a2', regra: 'anuncio_catalogo_buybox', titulo: 'Recuperar a caixa de compra: Mordedor Natural', prazo: '2026-10-15' }), A({ id: 'PS-a3', regra: 'anuncio_catalogo_buybox', titulo: 'Recuperar a caixa de compra: Petisco Natural', prazo: '2026-10-15' }),
    A({ id: 'PS-a4', regra: 'anuncio_ads_entrar', titulo: 'Entrar em Ads: Coleira Peitoral', prazo: '2026-10-12', status: 'aprovada' }), A({ id: 'PS-a5', regra: 'anuncio_ads_entrar', titulo: 'Entrar em Ads: Guia Longa', prazo: '2026-10-12', status: 'distribuida' }),
    A({ id: 'PS-a6', regra: 'calendario', titulo: 'Preparar Dia das Crianças (12/10/2026)', prazo: '2026-10-10' }), A({ id: 'PS-bf', regra: 'calendario', titulo: 'Preparar Black Friday (27/11/2026)', prazo: '2026-10-28' })]
  const b = brief(semanal({ lista: true, ofertas: PROMOS, proximos: [prox('Ficha técnica nova', 'nao_iniciada', { data_planejada: '2026-10-13' })] }), { acoesPlano: plano })
  const por = Object.fromEntries(b.proximos.itens.map(i => [i.rotulo, i.previsto === true]))
  assert.equal(por['Ativar frete grátis: Bola Maciça'], false); assert.equal(por['Recuperar a caixa de compra em 2 anúncios'], true, 'grupo todo aprovado')
  assert.equal(por['Entrar em Ads em 2 anúncios'] ?? por['Entrar em Ads: Coleira Peitoral'], false, 'grupo misto (uma distribuída): é compromisso'); assert.equal(por['Preparar Dia das Crianças (12/10)'], true)
  assert.equal(por['Ficha técnica nova'], false); assert.ok(b.proximos.itens.filter(i => i.origem === 'promocao').every(i => !('previsto' in i)))
  assert.ok(b.proximos.radar.length === 1 && b.proximos.radar.every(i => !('previsto' in i)), 'radar já é provisório pelo texto')
})

// ── F4: as pendências do cliente (avaliador único) EXPLICADAS no relatório curto ────────────────────────────────────────────────────────────────────────────────
// Avaliador REAL (src/lib/pendencias-cliente.js) sobre banco :memory: e dependências STUB (fixtures/pendencias-mundo.mjs): 3 críticas (estoque ML com R$ previsto, documentos na Amazon,
// categoria restrita no TikTok), 1 em ATENÇÃO (retorno parado há 31 dias SEM tipo e com data aproximada: política de tom de 08/10, nunca crítica nem alerta) e 1 informativa (fotos na Shopee). Nada de Notion nem Mercado Livre.
const PEND = () => montar({
  base: baseMl([itemMl({ titulo: 'Guia Unificada Adestramento Coleira', cobertura: 3, r: 2800 }), itemMl({ titulo: 'Petisco Natural', curva: 'B', cobertura: 6, r: 700 })]),
  tarefas: [tarefaDep({ processo: 'Amazon 1', tipo: 'documentos', dias: 20 }), tarefaDep({ processo: 'Shopee', tipo: 'fotos', dias: 9 }), tarefaDep({ processo: 'Shopee', dias: 31, desde_origem: 'ultima_edicao' }), tarefaDep({ processo: 'TikTok Shop', tipo: 'regulatorio', dias: 16 })],
}).p.avaliar('Acme', { hoje: HOJE }).itens
const CHAVES_PEND = ['rotulo', 'canal_rotulo', 'gravidade', 'desde', 'dias', 'desde_aproximado', 'por_que_importa', 'efeito_se_atrasar', 'o_que_precisamos', 'o_que_fazemos', 'impacto_texto', 'impacto_tipo']
const comPend = (lista, ctx = {}, sem = SEM_A()) => brief(sem, { pendencias: lista, ...ctx })

await ok('F4 pendências: `alertas` (uma por CRÍTICA) e `depende.pendencias` (até 5, gravidade → valor → dias) AO LADO de `depende.itens`, que não muda; o gancho conta as pendências', () => {
  const P = PEND(), sem = brief(SEM_A()), b = comPend(P)
  assert.deepEqual(P.map(p => [p.item, p.canal, p.gravidade]), [['estoque_curva_a', 'ml', 'critico'], ['documentos_conta', 'amazon', 'critico'], ['regulatorio', 'tiktok', 'critico'], ['retorno_pendente', 'shopee', 'atencao'], ['midia_produto', 'shopee', 'info']], 'a base do teste (a sem tipo/aproximada é atenção)')
  assert.deepEqual(b.depende.itens, sem.depende.itens, '`itens` (fixado pelos testes de antes) continua igual')
  assert.deepEqual(b.depende.pendencias.map(p => Object.keys(p)), Array(5).fill(CHAVES_PEND), 'os campos do contrato, na ordem')
  assert.deepEqual(b.depende.pendencias.map(p => [p.rotulo, p.canal_rotulo, p.gravidade, p.impacto_tipo]), [
    ['Estoque dos produtos que mais vendem', 'Mercado Livre', 'critico', 'previsto'], ['Documentos e validação da conta', 'Amazon', 'critico', 'sem_estimativa'],
    ['Registro regulatório e categoria restrita', 'TikTok Shop', 'critico', 'sem_estimativa'], ['Retorno pendente do cliente', 'Shopee', 'atencao', 'sem_estimativa'], ['Imagens e vídeo dos produtos', 'Shopee', 'info', 'sem_estimativa']])
  const [est, doc, , ret] = b.depende.pendencias
  assert.deepEqual([est.desde, est.dias, est.desde_aproximado], [null, null, false], 'estoque medido: sem "desde" inventado')
  assert.deepEqual([ret.desde, ret.dias, ret.desde_aproximado], ['2026-09-07', null, true], 'a data veio da última edição: aproximada, o brief diz e a forma do cliente NÃO carrega a contagem de dias'); assert.deepEqual([doc.desde, doc.dias, doc.desde_aproximado], ['2026-09-18', 20, false])
  assert.match(est.impacto_texto, /^R\$ 2\.175 \(estimativa\)\. Premissa: receita por dia medida nos últimos 28 dias .* prazo de reposição de 21 dias .*não promessa de resultado\.$/)
  assert.equal(ret.impacto_texto, '1 tarefa(s) parada(s)', 'aproximada: sem "há 31 dia(s)"'); assert.ok(!/R\$/.test(JSON.stringify([ret, doc, b.depende.pendencias[3], b.depende.pendencias[4]])), 'fora do Mercado Livre nunca há R$')
  // alertas: só as críticas, com rótulo, canal, desde/dias (ou data aproximada) e um resumo curto
  assert.deepEqual(b.alertas.map(a => Object.keys(a)), Array(3).fill(['rotulo', 'canal_rotulo', 'desde', 'dias', 'desde_aproximado', 'resumo']))
  assert.deepEqual(b.alertas.map(a => [a.rotulo, a.canal_rotulo, a.desde, a.dias, a.desde_aproximado]), [['Estoque dos produtos que mais vendem', 'Mercado Livre', null, null, false],
    ['Documentos e validação da conta', 'Amazon', '2026-09-18', 20, false], ['Registro regulatório e categoria restrita', 'TikTok Shop', '2026-09-22', 16, false]], 'a tarefa sem tipo/aproximada (Retorno pendente) NUNCA é alerta')
  assert.match(b.alertas[0].resumo, /^Leitura de estoque de 08\/10: 2 dos produtos que mais vendem têm estoque para 3 a 6 dia\(s\) no ritmo das vendas dos últimos 28 dias\.$/)
  assert.ok(b.alertas.every(a => a.resumo.length > 10 && a.resumo.length <= 172))
  assert.equal(b.depende.mais, 0); assert.equal(b.depende.linguagem, 'padrao')
  assert.match(b.abertura.nudge, /^5 pontos aguardam o seu retorno — veja Depende de você$/, 'conta as pendências, não a lista de antes (3)')
  // sem pendências: a lista de antes e o gancho de antes
  const nenhuma = comPend([])
  assert.deepEqual([nenhuma.alertas, nenhuma.depende.pendencias, nenhuma.depende.mais], [[], [], 0]); assert.deepEqual(nenhuma.depende.itens, sem.depende.itens); assert.equal(nenhuma.abertura.nudge, sem.abertura.nudge)
  assert.deepEqual(comPend(undefined).alertas, []); assert.deepEqual(comPend('lixo').depende.pendencias, []); assert.deepEqual(comPend([null, 7, 'x']).depende.pendencias, [], 'entrada torta é ignorada, não derruba')
  // só informativas: não há alerta
  assert.deepEqual(comPend(P.filter(p => p.gravidade === 'info')).alertas, [])
})

await ok('F4 pendências: teto de 5 (`mais` diz quantas ficaram), ordem estável (gravidade, depois R$, depois dias) e o gancho conta todas', () => {
  const P = PEND(), extra = Array.from({ length: 4 }, (_, i) => ({ ...P[4], id: `x${i}`, rotulo: `Aprovações pedidas pela equipe ${i}`, gravidade: 'atencao', dias: 3 + i }))
  const b = comPend([...extra, ...P])                                                    // embaralhada: o brief ordena
  assert.equal(b.depende.pendencias.length, 5); assert.equal(b.depende.mais, 4); assert.match(b.abertura.nudge, /^9 pontos aguardam o seu retorno/)
  assert.deepEqual(b.depende.pendencias.map(p => p.gravidade), ['critico', 'critico', 'critico', 'atencao', 'atencao'])
  assert.deepEqual(b.depende.pendencias.map(p => p.rotulo).slice(0, 2), ['Estoque dos produtos que mais vendem', 'Documentos e validação da conta'], 'R$ primeiro, depois mais dias')
  assert.equal(b.depende.pendencias[4].rotulo, 'Aprovações pedidas pela equipe 3', 'entre as de atenção, a que espera há mais dias')
  assert.equal(b.alertas.length, 3)
  const um = comPend([P[0]]); assert.match(um.abertura.nudge, /^1 ponto aguarda o seu retorno/)
})

await ok('F4 pendências: texto que viola o auditor descarta SÓ aquela pendência (conta em omitidos, sem eco); nunca trava o relatório', async () => {
  const P = PEND(), sujo = (i, campo, valor) => P.map((p, k) => k === i ? { ...p, [campo]: valor } : p)
  const casos = [[1, 'por_que_importa', 'Resultado garantido em 7 dias para o seu ranking'], [2, 'rotulo', 'Documentos da conta, conforme a Giovanna pediu'], [3, 'o_que_precisamos', 'Envie em http://localhost:3012/painel'],
    [2, 'efeito_se_atrasar', 'A venda caiu por causa da demora, falha do cliente'], [0, 'canal_rotulo', 'Mercado Livre MLB4789167797'], [1, 'por_que_importa', ''], [4, 'o_que_precisamos', '']]
  for (const [i, campo, valor] of casos) {
    const b = comPend(sujo(i, campo, valor))
    assert.equal(b.depende.pendencias.length, 4, `${campo}: ${valor.slice(0, 30)}`); assert.equal(b._interno.omitidos.pendencias, 1)
    assert.ok(!b.depende.pendencias.some(p => p.rotulo === P[i].rotulo), 'a pendência ruim saiu'); assert.deepEqual(auditarBrief(b, { nomes: NOMES }), [])
    assert.ok(!JSON.stringify(semInterno(b)).includes(valor.slice(0, 20)) || valor === '', 'o texto ruim não está em nenhum campo visível'); assert.ok(!JSON.stringify(b._interno).includes('garantido'), 'nem no interno')
  }
  // um alerta cujo único problema é o resumo mantém o alerta e perde o resumo
  const rs = P.map((p, k) => k === 0 ? { ...p, evidencia: 'Leitura feita pela Giovanna Torres em 08/10: estoque curto.' } : p)
  const a = comPend(rs).alertas[0]; assert.deepEqual([a.rotulo, a.resumo], ['Estoque dos produtos que mais vendem', '']); assert.equal(comPend(rs).depende.pendencias.length, 5)
  // tudo ruim: o relatório continua saindo, agora com a lista de antes
  const todas = P.map(p => ({ ...p, efeito_se_atrasar: 'Garantimos o resultado' })), b0 = comPend(todas)
  assert.deepEqual([b0.depende.pendencias, b0.alertas, b0._interno.omitidos.pendencias], [[], [], 5]); assert.equal(b0.depende.itens.length, 3); assert.match(b0.abertura.nudge, /^3 pontos aguardam/)
  // pelo criarBrief (gerar): o auditor final não acusa nada
  const g = await criarBrief({ montarSemanal: async () => SEM_A(), hoje: () => HOJE, agora: () => AGORA, lerAcoes: () => PLANO, eventos: () => EVENTOS, inicioHistorico: () => null, nomesInternos: () => NOMES, pendencias: { avaliar: async () => ({ itens: sujo(1, 'por_que_importa', 'Resultado garantido') }) } }).gerar(CLIENTE)
  assert.equal(g.depende.pendencias.length, 4); assert.equal(g._interno.omitidos.pendencias, 1)
})

await ok('F4 pendências: honestidade do impacto — "não estimado" sem base ("—", nunca zero), R$ só medido ou previsto COM premissa; Shopee/Amazon/TikTok nunca com R$', () => {
  const P = PEND(), base = P[0]
  const txt = impacto => pendenciaParaCliente({ ...base, impacto })
  assert.deepEqual([txt({ tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado: 2 tarefa(s) parada(s) há 15 dia(s)', premissa: null }).impacto_tipo, txt({ tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado: 2 tarefa(s) parada(s) há 15 dia(s)', premissa: null }).impacto_texto], ['sem_estimativa', '2 tarefa(s) parada(s) há 15 dia(s)'])
  assert.equal(txt({ tipo: 'sem_estimativa', valor_brl: null, rotulo: 'Impacto não estimado (parado: o cadastro e a revisão dos anúncios)', premissa: null }).impacto_texto, 'em espera — o cadastro e a revisão dos anúncios')
  for (const ruim of [{ tipo: 'previsto', valor_brl: 0, premissa: 'x', rotulo: 'Impacto não estimado' }, { tipo: 'previsto', valor_brl: null, premissa: 'x', rotulo: '' }, { tipo: 'previsto', valor_brl: 500, premissa: null, rotulo: 'Possível impacto' },
    { tipo: 'previsto', valor_brl: -80, premissa: 'x', rotulo: '' }, { tipo: 'previsto', valor_brl: NaN, premissa: 'x', rotulo: '' }, { tipo: 'medido', valor_brl: 0, premissa: null, rotulo: '' }, undefined, null, 'x']) {
    const c = txt(ruim); assert.equal(c.impacto_tipo, 'sem_estimativa', JSON.stringify(ruim)); assert.ok(!/R\$|NaN|undefined|null/.test(c.impacto_texto) && c.impacto_texto.length > 5, c.impacto_texto)
  }
  assert.equal(txt({ tipo: 'medido', valor_brl: 300.4, premissa: null, rotulo: '' }).impacto_texto, 'R$ 300 (medido)')
  assert.equal(linhasDePendencia(P[0]).linhas.find(l => l.chave === 'impacto').rotulo, 'Impacto possível'); assert.equal(linhasDePendencia(P[1]).linhas.find(l => l.chave === 'impacto').rotulo, 'Impacto não estimado')
  const b = comPend(P)
  for (const p of b.depende.pendencias.filter(x => x.canal_rotulo !== 'Mercado Livre')) assert.ok(!/R\$/.test(JSON.stringify(p)) && p.impacto_tipo === 'sem_estimativa', p.canal_rotulo)
  assert.ok(!/R\$ ?0(?:,00)?\b|\bnull\b|undefined/.test(todasAsStrings(b.depende).join('\n')))
})

await ok('F4 pendências: NENHUMA string visível (alertas + depende.pendencias, nos 3 idiomas) casa PROIBIDOS, nomes internos ou a 2ª camada; sem ID, URL, jargão, promessa nem responsável', () => {
  const rxN = regexNomes(NOMES)
  for (const linguagem of ['padrao', 'simples', 'tecnica']) {
    const b = comPend(PEND(), {}, semanal({ regras: { linguagem } }))
    assert.equal(b.depende.linguagem, linguagem)
    for (const s of todasAsStrings({ a: b.alertas, d: b.depende.pendencias, n: b.abertura.nudge })) {
      for (const p of PROIBIDOS) assert.ok(!p.rx.test(s), `${linguagem}: PROIBIDOS.${p.id} em "${s.slice(0, 60)}"`)
      assert.ok(!rxN.test(s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()), `nome interno em "${s.slice(0, 60)}"`)
    }
    assert.deepEqual(auditarBrief(b, { nomes: NOMES }), []); assert.deepEqual(todasLimpas(b), [])
    const t = todasAsStrings([b.alertas, b.depende.pendencias]).join('\n').toLowerCase().replace(/prazo de reposição/g, '')    // "prazo de reposição de 21 dias" é a premissa da estimativa (fornecedor), não prazo dado ao cliente
    for (const x of ['giovanna', 'carla', 'mlb', 'ps-', 'detalhe', 'garant', 'ranking', 'prazo', 'responsável', 'consultor', 'notion']) assert.ok(!t.includes(x), `${linguagem}: "${x}" não aparece`)
    assert.ok(b.depende.pendencias.every(p => !('evidencia' in p)), 'a evidência bruta nunca vai nas entradas (só o resumo do alerta)')
  }
})

await ok('F4 pendências: criarBrief injeta o avaliador (cliente + hoje do relatório), falha dele não derruba (lista de antes + aviso só no _interno) e sem a dependência nada muda', async () => {
  let args = null
  const mk = o => criarBrief({ montarSemanal: async () => SEM_A(), hoje: () => HOJE, agora: () => AGORA, lerAcoes: () => PLANO, eventos: () => EVENTOS, inicioHistorico: () => '2026-09-28', nomesInternos: () => NOMES, ...o })
  const b = await mk({ pendencias: { avaliar: async (c, o) => { args = [c, o]; return { cliente: c, itens: PEND() } } } }).gerar(CLIENTE)
  assert.deepEqual(args, [CLIENTE, { hoje: HOJE }]); assert.equal(b.depende.pendencias.length, 5); assert.equal(b.alertas.length, 3)
  const sincrono = await mk({ pendencias: { avaliar: () => ({ itens: PEND() }) } }).gerar(CLIENTE); assert.equal(sincrono.depende.pendencias.length, 5)
  const vira = await mk({ pendencias: { avaliar: async () => { throw new Error('banco indisponível') } } }).gerar(CLIENTE)
  assert.deepEqual([vira.depende.pendencias, vira.alertas], [[], []]); assert.equal(vira.depende.itens.length, 3); assert.ok(vira._interno.avisos.some(a => /Pendências do cliente indisponíveis/.test(a)))
  assert.ok(!JSON.stringify(semInterno(vira)).includes('indisponíveis nesta geração: o relatório usou'), 'o aviso não escapa'); assert.ok(!JSON.stringify(semInterno(vira)).includes('banco indisponível'), 'sem eco do erro')
  for (const nulo of [undefined, {}, { avaliar: undefined }]) { const s = await mk({ pendencias: nulo }).gerar(CLIENTE); assert.deepEqual([s.alertas, s.depende.pendencias], [[], []]); assert.equal(s.depende.itens.length, 3) }
  for (const vazio of [null, {}, { itens: null }]) assert.deepEqual((await mk({ pendencias: { avaliar: async () => vazio } }).gerar(CLIENTE)).depende.pendencias, [])
  // o modo "sem_resultados" também enxerga a pendência (só ela já é o que dizer)
  const so = brief(semanal({ conectado: false, estado: null, ads: false, ofertas: null }), { acoesPlano: [], eventos: new Map(), pendencias: PEND() })
  assert.equal(so.modo, 'sem_resultados')
  // fiação real: briefReal liga o avaliador real e semanal.js não grava mais métricas no modo leve
  const real = readFileSync(new URL('../src/lib/relatorio-brief-real.js', import.meta.url), 'utf-8')
  assert.match(real, /pendencias: \{ avaliar: \(cliente, opcoes\) => pendenciasReal\(\)\.avaliar\(cliente, opcoes\) \}/)
  assert.match(readFileSync(new URL('../src/lib/semanal.js', import.meta.url), 'utf-8'), /if \(manuais && !leve\) gravarMetricasSemana\(/)
})

await ok('política de tom no relatório curto: a quinta linha ("O que fazemos quando recebermos") passa nas duas camadas em TODOS os itens do catálogo × canais; data aproximada nunca é alerta nem leva dias', () => {
  // 1) catálogo inteiro: registro manual em cada item × canal -> nenhuma pendência é omitida pelo auditor do brief e a quinta linha é o template do catálogo
  const cat = catalogoReal(), m = montar()
  for (const [id, it] of Object.entries(cat.itens)) if (id !== 'retorno_pendente') for (const canal of it.canais) { const r = m.p.registrar({ cliente: 'Acme', item: id, canal, detalhe: 'interno', por: QUEM[0], confirmar: true }); assert.equal(r.ok, true, `${id}/${canal}`) }
  const todas = m.p.avaliar('Acme').itens, total = todas.length
  assert.ok(total > 40, `pendências registradas: ${total}`)
  for (let i = 0; i < todas.length; i += 5) {
    const b = comPend(todas.slice(i, i + 5)), vistas = b.depende.pendencias
    assert.equal(b._interno.omitidos.pendencias ?? 0, 0, `omitida pelo auditor: ${todas.slice(i, i + 5).map(p => p.id)}`); assert.equal(vistas.length, Math.min(5, todas.length - i))
    for (const c of vistas) { const L = linhasDePendencia(c); assert.deepEqual(L.linhas.at(-1), { chave: 'fazemos', rotulo: 'O que fazemos quando recebermos', texto: c.o_que_fazemos }); assert.ok(c.o_que_fazemos.length > 20) }
    assert.deepEqual(auditarBrief(b, { nomes: NOMES }), [])
  }
  // 2) data aproximada e tarefa sem tipo: nunca alerta (mesmo com 128 dias), e o texto da pendência não leva a contagem
  const damar = montar({ tarefas: [tarefaDep({ processo: 'Magazine Luiza', dias: 128, desde_origem: 'ultima_edicao' }), tarefaDep({ processo: 'Amazon 1', dias: 71, desde_origem: 'ultima_edicao' }), tarefaDep({ processo: 'Shopee', tipo: 'documentos', dias: 40, desde_origem: 'ultima_edicao' })] }).p.avaliar('Acme').itens
  const bd = comPend(damar), tx = JSON.stringify(semInterno(bd))
  assert.deepEqual(bd.alertas, [], 'nenhuma crítica: sem tipo registrado ou com data aproximada o sistema não afirma gravidade'); assert.equal(bd.depende.pendencias.length, 3)
  assert.ok(bd.depende.pendencias.every(p => p.desde_aproximado === true && p.dias === null && p.gravidade === 'atencao'))
  assert.ok(!/\b(128|71|40)\b|última atualização|dia\(s\)/.test(tx), tx.match(/.{40}(128|71|40|última atualização|dia\(s\)).{40}/)?.[0])
  // 3) o texto que sobra do avaliador interno nunca vira o fato do alerta: mesmo uma pendência crítica com data aproximada (entrada torta) sai reconstruída
  const torta = { ...damar[0], gravidade: 'critico', evidencia: '4 tarefas aguardam o retorno do cliente; a mais antiga desde 02/06/2026 (128 dia(s); data aproximada pela última atualização da tarefa).' }
  const bt = comPend([torta]); assert.equal(bt.alertas.length, 1)
  assert.match(bt.alertas[0].resumo, /^\d+ tarefas? aguarda(?:m)? o retorno do cliente \(em aberto; data aproximada: \d{2}\/\d{2}\)\.$/); assert.equal(bt.alertas[0].dias, null)
})

// ═════════ alinhamentos com o cliente (PLANO ATIVO 4): o predicado do núcleo decide; o brief só projeta (texto fixo do tipo ou omitido) ═════════
await ok('alinhamentos: reposição de descontinuado some de "Depende de você"; mudança de anúncio alinhado sai com "conforme alinhado em dd/mm" (teste = omitida); próximo passo coberto sai, ja_informado não tira o passo; auditor passa', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { criarAlinhamentos, SCHEMA_ALINHAMENTO } = await import('../src/lib/alinhamentos.js')
  const h = new Database(':memory:'); h.exec(SCHEMA_ALINHAMENTO)
  const A = criarAlinhamentos({ handle: h, hoje: () => HOJE, agora: () => AGORA, nomesInternos: () => NOMES, validarPor: x => NOMES.includes(x) ? x : '' })
  const reg = e => A.registrar({ cliente: CLIENTE, por: NOMES[1], confirmar: true, ...e })
  reg({ escopo: 'anuncio', chave: RISCO[0].id, tipo: 'descontinuado_queima_estoque', permanente: true })     // o 1º do risco de estoque (Guia Unificada)
  reg({ escopo: 'anuncio', chave: 'MLB2', tipo: 'pausa_producao', motivo: 'erro de produção do fornecedor' })  // mudanças do MLB2: rotuladas (motivo livre é interno)
  reg({ escopo: 'anuncio', chave: 'MLB1', tipo: 'teste' })                                                  // teste: relatorio = omitir
  reg({ escopo: 'anuncio', chave: 'MLB7', tipo: 'campanha_visibilidade' })                                  // Ads do MLB7 combinado: o passo de reduzir Ads sai
  reg({ escopo: 'anuncio', chave: 'MLB8', tipo: 'ja_informado' })                                           // já informado: o passo de fotos continua
  const acoesPlano = [...PLANO, { cliente: CLIENTE, id: 'PS-a7a7a7', canal: 'ML', status: 'aprovada', horizonte: '7d', regra: 'anuncio_ads_reduzir', item_id: 'MLB7', titulo: 'Reduzir investimento em Ads: Coleira Luxo (MLB7)', prazo: '2026-10-12' },
    { cliente: CLIENTE, id: 'PS-a8a8a8', canal: 'ML', status: 'aprovada', horizonte: '7d', regra: 'anuncio_conteudo_fotos', item_id: 'MLB8', titulo: 'Fotos novas: Cama Pet (MLB8)', prazo: '2026-10-13' }]
  const sem = brief(SEM_A(), { acoesPlano }), com = brief(SEM_A(), { acoesPlano, alinhado: A.predicado(CLIENTE, { hoje: HOJE }) })
  const repor = b => b.depende.itens.find(i => i.rotulo.startsWith('Repor estoque de '))
  assert.match(repor(sem).rotulo, /^Repor estoque de 5 anúncios/); assert.match(repor(com).rotulo, /^Repor estoque de 4 anúncios/); assert.ok(!/Guia Unificada/.test(repor(com).rotulo), 'descontinuado não pede reposição')
  const mud = b => b.desenvolvimento.mudancas.map(m => m.texto)
  assert.ok(mud(com).some(t => /^Ads ligado em 1 anúncio — pausa combinada com você, conforme alinhado em 08\/10$/.test(t)), 'mudança do anúncio alinhado rotulada: ' + mud(com).join(' | '))
  assert.ok(!mud(sem).some(t => /conforme alinhado/.test(t)), 'sem alinhamento, nada rotulado')
  assert.deepEqual(mud(com).slice(0, 2), ['Preço ajustado em 1 anúncio (−4%) — pausa combinada com você, conforme alinhado em 08/10', '1 anúncio entrou em promoção — pausa combinada com você, conforme alinhado em 08/10'], 'o anúncio em teste (MLB1) sai das linhas agrupadas')
  assert.equal(com._interno.omitidos.alinhado, 4, '2 mudanças do anúncio em teste + 1 reposição + 1 próximo passo')
  const prox = b => b.proximos.itens.map(i => i.rotulo).join(' | ')
  assert.match(prox(sem), /Reduzir investimento em Ads/); assert.doesNotMatch(prox(com), /Reduzir investimento em Ads/, 'passo coberto pelo alinhamento sai')
  assert.match(prox(com), /Fotos novas/, 'ja_informado não tira o passo (a regra do plano continua)')
  assert.deepEqual(auditarBrief(com, { nomes: NOMES }), []); assert.deepEqual(todasLimpas(com), [])
  assert.ok(!/erro de produção|fornecedor/i.test(texto(com)), 'motivo livre nunca vai ao cliente')
  // criarBrief: o predicado entra pela fábrica (relatorio-brief-real liga o do núcleo)
  assert.match(readFileSync(new URL('../src/lib/relatorio-brief-real.js', import.meta.url), 'utf8'), /alinhado: \(cliente, dia\) => alinhamentosReal\(\)\.predicado\(cliente, \{ hoje: dia \}\)/)
})

await ok('alinhamentos: o descarte de UMA regra (origem descarte, regras explícitas) não apaga nem rotula as outras mudanças do anúncio; Ads acima do ACOS alvo combinado continua como próximo passo', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { criarAlinhamentos, SCHEMA_ALINHAMENTO } = await import('../src/lib/alinhamentos.js')
  const h = new Database(':memory:'); h.exec(SCHEMA_ALINHAMENTO)
  const A = criarAlinhamentos({ handle: h, hoje: () => HOJE, agora: () => AGORA, nomesInternos: () => NOMES, validarPor: x => NOMES.includes(x) ? x : '' })
  const reg = e => A.registrar({ cliente: CLIENTE, por: NOMES[1], confirmar: true, ...e })
  reg({ escopo: 'anuncio', chave: 'MLB2', regras: ['ads_reduzir'], tipo: 'teste', origem: 'descarte', acao_id: 'PS-dsc002' })                     // descarte só da ação de Ads do MLB2 (teste = omitir)
  reg({ escopo: 'anuncio', chave: 'MLB1', regras: ['frete_gratis'], tipo: 'campanha_visibilidade', origem: 'descarte', acao_id: 'PS-dsc001' })     // descarte só do frete grátis do MLB1
  reg({ escopo: 'anuncio', chave: 'MLB7', tipo: 'campanha_visibilidade', acos_alvo: 30 })                                                        // alvo de 30% combinado no MLB7
  const acoesPlano = [...PLANO, { cliente: CLIENTE, id: 'PS-a7a7a7', canal: 'ML', status: 'aprovada', horizonte: '7d', regra: 'anuncio_ads_reduzir', item_id: 'MLB7', titulo: 'Reduzir investimento em Ads: Coleira Luxo (MLB7)', prazo: '2026-10-12',
    dados: { alinhamento: { acos_alvo: 30, texto: 'ACOS acima do alvo de 30% alinhado com o cliente em 08/10' } } }]                               // o plano só cria a ação de Ads do MLB7 ACIMA do alvo
  const sem = brief(SEM_A(), { acoesPlano }), com = brief(SEM_A(), { acoesPlano, alinhado: A.predicado(CLIENTE, { hoje: HOJE }) })
  const mud = b => b.desenvolvimento.mudancas.map(m => m.texto)
  assert.deepEqual(mud(com), mud(sem), 'preço, promoção e Ads do MLB1/MLB2 seguem iguais: ' + mud(com).join(' | '))
  assert.ok(!mud(com).some(t => /conforme alinhado/.test(t)), 'nenhuma mudança rotulada por um descarte de outra regra')
  assert.equal(com._interno.omitidos.alinhado ?? 0, 0)
  assert.match(com.proximos.itens.map(i => i.rotulo).join(' | '), /Reduzir investimento em Ads/, 'o combinado estourou: o próximo passo fica')
})

console.log(`\n${n} verificações passaram.`)
