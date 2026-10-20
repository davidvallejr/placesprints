// Relatório Semanal Place2u — individualizado por cliente, seguindo o checklist
// oficial de coleta: identificação → ações da semana (Notion) → prints →
// métricas 7 dias → Ads → extras, com CHECAGEM DE PRONTIDÃO automática
// (Recebido / Parcial / Faltando / Opcional) antes de montar.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { db, getEstado, hojeLocal } from './db.js'
import { ROOT } from './env.js'
import { listarTarefas, evidenciasDe, planoDoMes } from './metricas.js'
import { planosDoMes } from './plano-informacoes.js'
import { tokenValido } from './meli-contas.js'
import { relatorioNegocio, relatorioAds, produtosMaisVendidos, relatorioOfertas, comComparativo, calcularTacos } from './meli-api.js'
import { analisarCliente } from './impacto-tarefas.js'
import { retroalimentar } from './retroalimentacao.js'
import { cartoesDoCliente } from './acompanhamento.js'
import { metricasFull } from './full-metricas.js'
import { custosDoCliente, economiaAds } from './diagnostico-conta.js'
import { perfilDoCliente, listarObjetivos, janelaResultadosDias } from './perfil-cliente.js'
import { RX_ADS, CANAIS_CONHECIDOS as MARKETPLACES, canalDe, dentro, br, deltaPct, montarResultados, montarDestaques, volumeAtividades, tarefasComResultado, situacaoDaConta,
  ehPainel, horaSP, periodoManual, semanasNaoSobrepostas } from './semanal-resultados.js'
import { ehPrint } from './render-semanal.js'
import { ehDependencia } from './status-tarefa.js'
import { criarDependencias } from './dependencia-cliente.js'
import { pendenciasReal } from './pendencias-cliente-real.js'

// só listar(): tipo/detalhe/desde do registro de dependência — nada aqui escreve no Notion (encerrar fica em server.js)
const { listar: listarDependencias } = criarDependencias({ handle: db, hoje: hojeLocal })

const RX_OTIM = /otimiz|melhor|ajust|alter|corrig|revis|precific|pre[çc]o|t[ií]tulo|imagem|foto|ficha|seo|descri[çc]|kit|reputa/i
const CHAVES_ML_MANUAL = ['faturamento', 'vendas', 'unidades', 'visitas', 'conversao', 'ticket_medio', 'ads']

// Métricas manuais (prints dos painéis continuam sendo a fonte; este arquivo é
// o transcrito para a tabela do relatório): config/metricas-semanais.json.
// Raiz do cliente = painel do Mercado Livre; `canais` = { Shopee: {...métricas, semana_de} } para canais sem API.
function configManual(cliente) {
  const p = join(ROOT, 'config', 'metricas-semanais.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8'))[cliente] || null } catch { return null }
}
function metricasManuais(cliente) {
  const { canais, ...raiz } = configManual(cliente) || {}     // só `canais` (ou só semana_de) NÃO é painel do ML transcrito
  return CHAVES_ML_MANUAL.some(k => raiz[k] != null) ? raiz : null
}

const diasAntes = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

// ── links de anúncio: URLs do card + IDs reconhecidos no título/descrição ─
const RX_URL = /https?:\/\/[^\s<>"')\]]+/g
const rotuloLink = u => {
  try {
    const h = new URL(u).hostname
    if (/mercadoliv|meli/.test(h)) return 'Mercado Livre'
    if (/shopee/.test(h)) return 'Shopee'
    if (/amazon/.test(h)) return 'Amazon'
    if (/magalu|magazineluiza/.test(h)) return 'Magalu'
    if (/tiktok/.test(h)) return 'TikTok Shop'
    return h.replace(/^www\./, '')
  } catch { return 'link' }
}
function linksDeAnuncio(t, evidencias) {
  const urls = new Set()
  for (const m of `${t.descricao}\n${t.conteudo}`.matchAll(RX_URL)) urls.add(m[0].replace(/[.,;]$/, ''))
  for (const e of evidencias) if (['bookmark', 'embed'].includes(e.tipo) && e.url_origem) urls.add(e.url_origem)
  const texto = `${t.titulo} ${t.descricao}`
  for (const m of texto.matchAll(/\bMLB-?\s?(\d{9,12})\b/gi)) urls.add(`https://produto.mercadolivre.com.br/MLB-${m[1]}`)
  for (const m of texto.matchAll(/\b(B0[A-Z0-9]{8})\b/g)) urls.add(`https://www.amazon.com.br/dp/${m[1]}`)
  return [...urls].filter(u => !/notion\.(so|com)|prod-files-secure/.test(u)).slice(0, 6)
    .map(u => ({ url: u, rotulo: rotuloLink(u) }))
}

// ── histórico de métricas → crescimento e gráfico de faturamento ─────────
// só janelas de 7 dias: outra duração (ou um período de 30 dias com o mesmo `de`) não é "semana" e sobrescreveria a linha
function gravarMetricasSemana(cliente, de, ate, m) {
  if (diasAntes(ate, 6) !== de) return
  db.prepare(`INSERT INTO metricas_semana (cliente, de, ate, faturamento, vendas, unidades, visitas, conversao, ticket_medio, ads_json, comparativo, criado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(cliente, de) DO UPDATE SET ate=excluded.ate, faturamento=excluded.faturamento,
      vendas=excluded.vendas, unidades=excluded.unidades, visitas=excluded.visitas,
      conversao=excluded.conversao, ticket_medio=excluded.ticket_medio,
      ads_json=excluded.ads_json, comparativo=excluded.comparativo`)
    .run(cliente, de, ate, m.faturamento ?? null, m.vendas ?? null, m.unidades ?? null, m.visitas ?? null,
      m.conversao ?? null, m.ticket_medio ?? null, m.ads ? JSON.stringify(m.ads) : '', m.comparativo || '', hojeLocal())
}
// deltaPct, delta e montarDestaques (destaques positivos + ações do ML no mesmo período) vivem em semanal-resultados.js (funções puras, testadas)

// `perfil` (opcional) = ids de perfil (['direto'] ou 'direto,tecnico') que valem SÓ nesta geração; sem ele vale o perfil salvo do cliente.
// `leve` (opcional) = o relatório curto do Notion (relatorio-brief.js): pula a lista de produtos mais vendidos (consulta ao ML), NÃO grava a linha semanal de métricas
// (prévia 100% somente leitura) e não avalia as pendências do cliente (o curto as lê pelo avaliador injetado em criarBrief).
export async function montarSemanal({ cliente, de, ate, interno = false, perfil, leve = false }) {
  if (!cliente) throw new Error('Relatório semanal é individual: informe o cliente.')
  const perfilCli = perfilDoCliente(cliente, { perfis: perfil })   // id desconhecido no override falha aqui, antes de gastar chamadas ao ML
  const hoje = hojeLocal()
  if (!ate) ate = hoje   // sempre até o dia em que o relatório está sendo gerado, nunca "ontem"
  if (!de) { const d = new Date(ate + 'T12:00:00'); d.setDate(d.getDate() - 6); de = d.toISOString().slice(0, 10) }

  const brutasTarefas = listarTarefas({ cliente, ...(interno ? {} : { visivel_cliente: true }) })
  // cards sem título não entram num relatório de cliente — viram aviso de qualidade
  const semTitulo = brutasTarefas.filter(t => !t.titulo || /^sem t[ií]tulo$/i.test(t.titulo.trim())).length
  const todas = brutasTarefas.filter(t => t.titulo && !/^sem t[ií]tulo$/i.test(t.titulo.trim()))
  const concluidasSemana = todas.filter(t => t.status === 'concluida' && dentro(t.data_conclusao, de, ate))
  const abertas = todas.filter(t => ['andamento', 'validacao', 'nao_iniciada', 'bloqueada'].includes(t.status))
  const atrasadas = abertas.filter(t => t.prazo && t.prazo < hoje)
  const bloqueadas = abertas.filter(t => t.status === 'bloqueada')
  // dependências do cliente à parte (fora de abertas/atrasadas/bloqueadas), mesma visibilidade; o registro traz o que falta e desde quando
  const idsDep = todas.filter(ehDependencia).map(t => t.id)
  const dependencias = idsDep.length ? listarDependencias({ ids: idsDep, hoje }) : []

  const evTodas = evidenciasDe([...concluidasSemana, ...abertas].map(t => t.id))
  // evPorTarefa = só PRINTS (imagem/PDF — ehPrint): é o que conta em "Com print anexado", "Sem evidência" e miniaturas.
  // Bookmark/embed (link de anúncio) e demais anexos ficam em naoPrint: só alimentam os chips de link (linksDeAnuncio).
  const evPorTarefa = {}, naoPrint = {}
  const guardaEv = e => { e.criada_em = horaSP(e.criada_em); ((ehPrint(e) ? evPorTarefa : naoPrint)[e.tarefa_id] ??= []).push(e) }   // data do print no fuso do cliente, não em UTC
  evTodas.forEach(guardaEv)

  const ehAds = t => RX_ADS.test(`${t.titulo} ${t.processo} ${t.descricao}`)
  const ehMetrica = ehPainel                                            // (tarefa, print): print de PAINEL/métricas, não print de ação

  const acoesAds = concluidasSemana.filter(ehAds)                       // todos os canais: volume de atividades e checklist interno
  // os blocos "Mercado Livre" e "Mercado Livre Ads" só recebem tarefas do canal Mercado Livre —
  // campanha/print da Amazon ou da Shopee vai para o bloco do próprio canal (Outros canais), nunca para o ML
  const ehML = t => canalDe(t.processo) === 'Mercado Livre'
  const acoesAdsML = acoesAds.filter(ehML)
  const evidMetricas = concluidasSemana.filter(ehML).flatMap(t => (evPorTarefa[t.id] || []).filter(e => ehMetrica(t, e)))
  const evidAds = acoesAdsML.flatMap(t => evPorTarefa[t.id] || [])

  // ── conta Mercado Livre conectada: dados reais têm prioridade sobre a
  // transcrição manual do painel, sempre comparados com o período anterior
  // de mesma duração — igual ao próprio painel "Métricas" do Mercado Livre.
  let dadosMeli = null, produtosTop = [], ofertasMeli = null, adsMeli = null
  let negocioComp = null, adsComp = null, destaques = []
  const avisosMeli = []
  const tokenMeli = await tokenValido(cliente).catch(() => null)
  if (tokenMeli) {
    try { negocioComp = await comComparativo(cliente, { de, ate }, relatorioNegocio) }
    catch (e) { avisosMeli.push(`Métricas do Mercado Livre indisponíveis: ${e.message}`) }
    try { adsComp = await comComparativo(cliente, { de, ate }, relatorioAds) } catch (e) { avisosMeli.push(`Ads do Mercado Livre indisponíveis: ${e.message}`) }
    // o cliente vê só uma frase pronta (semanal-resultados.js); o detalhe técnico (status da API) fica aqui, no aviso interno
    if (adsComp?.atual && !adsComp.atual.disponivel && adsComp.atual.motivo) avisosMeli.push(`Ads do Mercado Livre: ${adsComp.atual.motivo}`)
    if (!leve) try { produtosTop = await produtosMaisVendidos(cliente, { de, ate }) } catch { /* segue sem produtos */ }
    try { const of = await relatorioOfertas(cliente); if (of.disponivel && of.total) ofertasMeli = of } catch { /* segue sem ofertas */ }

    if (negocioComp?.atual) {
      const n = negocioComp.atual
      dadosMeli = { faturamento: n.faturamento, vendas: n.vendas, unidades: n.unidades, visitas: n.visitas, conversao: n.conversao, ticket_medio: n.vendas ? n.preco_medio_venda : null, periodo: `${br(de)} a ${br(ate)}` }
    }
    if (adsComp?.atual?.disponivel) {
      adsMeli = adsComp.atual
      if (dadosMeli) dadosMeli.ads = adsMeli
    }
  }

  // métricas manuais (config/metricas-semanais.json) valem só como reforço quando NÃO há conta conectada, e apenas
  // se o período DECLARADO (semana_de [+ semana_ate]) cobrir a maior parte do relatório (4 de 7 dias) — periodoManual
  const brutas = metricasManuais(cliente)
  const perManual = brutas ? periodoManual(brutas, de, ate) : null
  const manuaisArquivo = perManual ? { ...brutas, periodo: `${br(perManual.de)} a ${br(perManual.ate)}` } : null
  const metricasDesatualizadas = !!(brutas && !manuaisArquivo && !dadosMeli)
  const manuais = dadosMeli || manuaisArquivo
  const origemMetricas = dadosMeli ? 'meli' : manuaisArquivo ? 'manual' : null
  // o histórico guarda o período a que os números se referem: o declarado (manual) ou o do relatório (API)
  const perMetricas = !dadosMeli && perManual ? perManual : { de, ate }
  if (manuais && !leve) gravarMetricasSemana(cliente, perMetricas.de, perMetricas.ate, manuais)   // `leve` (relatório curto do Notion, prévia incluída) é SOMENTE LEITURA

  const marketplaces = [...new Set(todas.map(t => t.processo).filter(p => MARKETPLACES.some(m => p.toLowerCase().includes(m.toLowerCase()))))]

  // ── ações concluídas, com seus prints e links de anúncio ──────────────
  const acoes = concluidasSemana.map(t => ({
    id: t.id, titulo: t.titulo, processo: t.processo, responsavel: t.responsavel || '—',
    data: t.data_conclusao, status_raw: t.status_raw, descricao: t.descricao,
    resultado: t.resultado_alcancado, impacto: t.impacto, url: t.url,
    evidencias: evPorTarefa[t.id] || [],
    links: linksDeAnuncio(t, naoPrint[t.id] || []),
  }))

  // ── próximos passos, pendências e dependências do cliente (dependencia_cliente vem do registro, não do campo bloqueio) ──
  const proximo = (t, dependencia_cliente = '') => ({
    titulo: t.titulo, processo: t.processo, status: t.status, status_raw: t.status_raw,
    responsavel: t.responsavel || '—', prazo: t.prazo, dependencia_cliente,
    bloqueio: t.bloqueio || '', proximo_passo: t.proximo_passo || '', url: t.url,
    atrasada: !dependencia_cliente && !!(t.prazo && t.prazo < hoje),
    // aditivos (relatorio-brief.js): data planejada do card (Notion "Data de conclusão" ou início), há quanto tempo espera o cliente e se o motivo foi registrado
    data_planejada: t.data_conclusao || t.data_inicio || null, desde: t.desde ?? null, dias_aguardando: t.dias ?? null, desde_aproximado: t.desde_origem === 'ultima_edicao', motivo_registrado: !!t.tipo,
  })
  // há quanto tempo espera o cliente: data aproximada (última edição do card) NUNCA vira contagem de dias ao cliente; o interno diz a origem
  const esperaDe = d => d.desde_origem !== 'ultima_edicao' ? `aguardando desde ${br(d.desde)} (${d.dias} dia(s))`
    : interno ? `aguardando desde ${br(d.desde)} (${d.dias} dia(s); data aproximada pela última atualização da tarefa)` : `em aberto; data aproximada: ${br(d.desde).slice(0, 5)}`
  const proximos = [...abertas.map(t => proximo(t)), ...dependencias.map(d => proximo(d, d.texto))]
    .sort((a, b) => (b.status === 'bloqueada') - (a.status === 'bloqueada') || (b.atrasada) - (a.atrasada))

  // ── otimizações/alterações/melhorias e o efeito observado em vendas ───
  const otimizacoes = concluidasSemana.filter(t => RX_OTIM.test(`${t.titulo} ${t.descricao}`)).map(t => ({
    titulo: t.titulo, processo: t.processo,
    mudanca: t.resultado_alcancado || t.descricao || '',
    efeito: t.impacto || '',
    evidencias: (evPorTarefa[t.id] || []).length,
  }))

  // ── barra de progresso (execução) + plano oficial 5W2H (Informações) ──
  const plano = planoDoMes({ cliente, anoMes: ate.slice(0, 7), interno })
  const planoOficial = planosDoMes(cliente, ate.slice(0, 7))

  // ── resultados em destaque: sempre há algo positivo — o relatório procura
  // ativamente e liga à execução da semana (nunca afirma causalidade certa)
  const { destaques: destaquesPositivos, acoes_relacionadas: acoesRelacionadas } =
    montarDestaques({ negocioComp, adsComp, otimizacoes, acoes })
  if (negocioComp?.atual && adsComp?.atual?.disponivel)
    adsMeli.tacos = calcularTacos(adsComp.atual.investimento, negocioComp.atual.faturamento)

  // ── pontos de atenção ──────────────────────────────────────────────────
  const semPrint = concluidasSemana.filter(t => !(evPorTarefa[t.id] || []).length)
  // o que depende do cliente (classe dependencia_cliente + registro) vira "Depende de você", sem nome interno: a cobrança é do consultor
  const ponto = (tipo, t, texto) => ({ tipo, texto, url: t.url || '', responsavel: t.responsavel || '—', prazo: t.prazo || null })
  const atencao = [
    ...bloqueadas.map(t => ponto('Bloqueio', t, `${t.titulo}${t.bloqueio ? ` — ${t.bloqueio}` : ''}`)),
    ...dependencias.map(d => ({ tipo: 'Depende de você', texto: `${d.titulo} — ${d.texto} · ${esperaDe(d)}`, url: d.url || '', responsavel: '', prazo: null })),
    ...atrasadas.filter(t => t.status !== 'bloqueada').map(t => ponto('Atraso', t, `${t.titulo} (prazo ${br(t.prazo)})`)),
    ...semPrint.map(t => ponto('Sem evidência', t, `${t.titulo} — concluída sem print anexado no card`)),
  ]

  // ── checagem de prontidão (o "checklist de coleta" auditado por código) ─
  const prontidao = []
  const item = (n, nome, estado, detalhe) => prontidao.push({ n, nome, estado, detalhe })

  item(1, 'Identificação da conta',
    marketplaces.length ? 'recebido' : 'parcial',
    marketplaces.length ? `${cliente} · ${marketplaces.join(' + ')} · ${br(de)} a ${br(ate)}`
      : `Marketplace não identificado nas tarefas (preencha a propriedade Canal/Processo no Notion). Período: ${br(de)} a ${br(ate)}`)

  const semStatus = concluidasSemana.filter(t => !t.status_raw).length
  item(2, 'Dados do Notion (ações + pendências)',
    concluidasSemana.length || abertas.length || dependencias.length ? (semStatus ? 'parcial' : 'recebido') : 'faltando',
    concluidasSemana.length || abertas.length || dependencias.length
      ? `${concluidasSemana.length} concluída(s) na semana, ${abertas.length} aberta(s)${dependencias.length ? `, ${dependencias.length} aguardando o cliente` : ''}${semStatus ? ` — ${semStatus} sem status visível` : ''}`
      : 'Nenhuma tarefa do cliente no período — confira o sync e os cards no Notion')

  item(3, 'Prints das ações realizadas',
    concluidasSemana.length === 0 ? 'faltando'
      : semPrint.length === 0 ? 'recebido'
      : semPrint.length < concluidasSemana.length ? 'parcial' : 'faltando',
    concluidasSemana.length === 0 ? 'Sem ações concluídas para evidenciar'
      : semPrint.length === 0 ? `Todas as ${concluidasSemana.length} ações têm print no card`
      : `Faltam prints em: ${semPrint.map(t => t.titulo).join('; ')}`)

  item(4, 'Métricas dos últimos 7 dias',
    manuais || evidMetricas.length ? 'recebido' : 'faltando',
    origemMetricas === 'meli' ? `Dados reais do Mercado Livre (conta conectada) — ${manuais.periodo}`
      : origemMetricas === 'manual' ? `Painel transcrito em config/metricas-semanais.json${manuais.periodo ? ` (${manuais.periodo})` : ''}`
      : evidMetricas.length ? `${evidMetricas.length} print(s) de painel anexado(s) nos cards`
      : 'Conecte a conta do Mercado Livre pelo botão no Notion, anexe o print do painel no card, ou preencha config/metricas-semanais.json')

  item(5, 'Ads (ML Ads / Shopee Ads)',
    adsMeli ? 'recebido'
      : acoesAds.length === 0 && !manuais?.ads ? 'opcional'
      : (manuais?.ads || evidAds.length) ? 'recebido' : 'faltando',
    adsMeli ? 'Dados reais do Mercado Livre Ads (conta conectada)'
      : acoesAds.length === 0 && !manuais?.ads ? 'Sem atividade de Ads no período'
      : manuais?.ads ? 'Números de Ads informados' : evidAds.length ? `${evidAds.length} print(s) de Ads` : `Há ação de Ads (${acoesAds.map(t => t.titulo).join('; ')}) sem print/números do painel`)

  const extras = todas.filter(t => t.impacto && dentro(t.data_conclusao, de, ate)).map(t => t.impacto)
  item(6, 'Informações extras', extras.length ? 'recebido' : 'opcional',
    extras.length ? extras.slice(0, 3).join(' · ') : 'Nada informado (opcional)')

  // prevenção de erros do checklist
  const avisos = []
  const evForaPeriodo = concluidasSemana.flatMap(t => (evPorTarefa[t.id] || [])
    .filter(e => e.criada_em && !dentro(e.criada_em.slice(0, 10), de, ate)))
  if (evForaPeriodo.length) avisos.push(`${evForaPeriodo.length} print(s) com data fora do período analisado — não misture períodos.`)
  const evSemLegenda = concluidasSemana.flatMap(t => (evPorTarefa[t.id] || []).filter(e => !e.legenda))
  if (evSemLegenda.length) avisos.push(`${evSemLegenda.length} print(s) sem legenda/contexto — adicione legenda no bloco do Notion.`)
  if (metricasDesatualizadas) avisos.push(`As métricas em config/metricas-semanais.json (semana_de=${brutas.semana_de}${brutas.semana_ate ? `, semana_ate=${brutas.semana_ate}` : ''}) não cobrem ao menos 4 dos 7 dias do relatório (ou a data é inválida) e foram IGNORADAS — atualize a transcrição do painel para ${br(de)} a ${br(ate)}.`)
  if (semTitulo) avisos.push(`${semTitulo} card(s) sem título foram ocultados do relatório — nomeie-os no Notion.`)
  avisos.push(...avisosMeli)

  // ── crescimento (semana × semana anterior) ────────────────────────────
  const dePrev = diasAntes(de, 7), atePrev = diasAntes(ate, 7)
  const concluidasPrev = todas.filter(t => t.status === 'concluida' && dentro(t.data_conclusao, dePrev, atePrev)).length
  // linha anterior de MESMA duração (de e ate 7 dias antes do período das métricas), nunca uma janela de outro tamanho
  const prevRow = db.prepare('SELECT * FROM metricas_semana WHERE cliente = ? AND de = ? AND ate = ?')
    .get(cliente, diasAntes(perMetricas.de, 7), diasAntes(perMetricas.ate, 7)) || null
  const cresce = (atual, anterior) => ({ atual: atual ?? null, anterior: anterior ?? null, pct: deltaPct(atual, anterior) })
  const crescimento = {
    entregas: cresce(concluidasSemana.length, concluidasPrev),
    faturamento: cresce(manuais?.faturamento, prevRow?.faturamento),
    vendas: cresce(manuais?.vendas, prevRow?.vendas),
    unidades: cresce(manuais?.unidades, prevRow?.unidades),
    visitas: cresce(manuais?.visitas, prevRow?.visitas),
    conversao: cresce(manuais?.conversao, prevRow?.conversao),
    ticket_medio: cresce(manuais?.ticket_medio, prevRow?.ticket_medio),
  }

  // ── dados dos gráficos ────────────────────────────────────────────────
  const porDia = Array.from({ length: 7 }, (_, i) => {
    const dia = diasAntes(ate, 6 - i)
    return { dia, n: concluidasSemana.filter(t => t.data_conclusao === dia).length }
  })
  const porCanalMap = {}
  for (const t of concluidasSemana) porCanalMap[t.processo] = (porCanalMap[t.processo] || 0) + 1
  const porCanal = Object.entries(porCanalMap).map(([canal, n]) => ({ canal, n })).sort((a, b) => b.n - a.n)
  // ponytail: lê todo o histórico do cliente (dezenas de linhas) e filtra em JS — semanasNaoSobrepostas é a regra testada
  const faturamentoHist = semanasNaoSobrepostas(db.prepare(`SELECT de, ate, faturamento, vendas FROM metricas_semana
    WHERE cliente = ? AND faturamento IS NOT NULL AND ate <= ?`).all(cliente, perMetricas.ate))

  let pronto = !prontidao.some(i => i.estado === 'faltando')

  // ── Relatório v2: resultados (ML · ADS · outros canais), volume, tarefas que geraram resultado, situação da conta ──
  // (a montagem mora em semanal-resultados.js, função pura; aqui só se leem o banco e as medidas)
  const janelaDias = janelaResultadosDias()
  const inicioJanela = diasAntes(ate, janelaDias - 1)
  const naJanela = todas.filter(t => t.status === 'concluida' && dentro(t.data_conclusao || horaSP(t.last_edited).slice(0, 10), inicioJanela, ate))
  evidenciasDe(naJanela.map(t => t.id).filter(id => !(id in evPorTarefa) && !(id in naoPrint))).forEach(guardaEv)   // prints das tarefas anteriores à semana, ainda na janela
  let analise = null, erroMedicao = null
  try { analise = analisarCliente(cliente) } catch (e) { erroMedicao = e.message }       // só lê o banco (sem chamada ao ML); falha => só resultados informados + nota
  let margemPct = null
  if (perfilCli.objetivo.id === 'margem') {
    try { const c = custosDoCliente(cliente); margemPct = c ? economiaAds(c).margem_pre_ads_pct : null } catch { /* sem custo informado: o objetivo cai em faturamento com nota */ }
  }
  const resultados = montarResultados({
    de, ate, conectado: !!tokenMeli, falhou: !!tokenMeli && !negocioComp?.atual,
    parcial: ate >= hoje ? { ate_hora: horaSP(new Date().toISOString()).slice(11) } : null,   // período com o dia de hoje (incompleto)
    negocio: negocioComp, ads: adsComp, manual: manuaisArquivo, semanaIgnorada: metricasDesatualizadas ? brutas.semana_de : null,
    anteriorManual: prevRow, canaisManuais: configManual(cliente)?.canais, tarefas: todas, concluidas: concluidasSemana, evPorTarefa, ehMetrica,
    acoesAds: acoesAdsML.map(t => t.titulo), destaques: destaquesPositivos, acoesRelacionadas,
  })
  const atividades = volumeAtividades({ de, ate, concluidas: concluidasSemana, concluidasAnterior: concluidasPrev, abertas, atrasadas, bloqueadas, dependencias,
    otimizacoes: otimizacoes.length, acoesAds: acoesAds.length, evPorTarefa })
  const tarefas_resultado = tarefasComResultado({ objetivo: perfilCli.objetivo, objetivos: listarObjetivos(), ate, janelaDias, tarefas: todas,
    medidas: analise?.medidas ?? null, erroMedicao, evPorTarefa, linksDe: t => linksDeAnuncio(t, naoPrint[t.id] || []), margemPct })
  const situacao = situacaoDaConta({ atrasadas, bloqueadas, dependencias, plano, hoje })

  // ── Relatório de RESULTADOS: estado da conta (queda / estagnação / crescimento) e o que fazer, tarefas que geraram venda em detalhe
  // (anúncio, antes × 24h × 48h × 72h × 1 semana × hoje), Full, combinações, tarefa de cuidado e 80/20. Cada bloco falha sozinho: o relatório sai sem ele.
  let retro = null, retroErro = null, tarefasAnuncio = null, acompErro = null, full = null
  if (analise) {
    try { const rr = retroalimentar(cliente, { hoje, analise }); if (rr.disponivel) retro = rr; else retroErro = rr.motivo } catch (e) { retroErro = e.message }
    try { tarefasAnuncio = cartoesDoCliente(cliente, { hoje, analise, dias: janelaDias, soResultado: true }) } catch (e) { acompErro = e.message }
    try { const f = metricasFull(cliente, { hoje }); full = f } catch { full = null }
  }
  const desempenho = retro ? { estado: retro.estado, leitura: retro.leitura, queda: retro.queda, jogadas: retro.jogadas, ciclo_anterior: retro.ciclo_anterior } : null
  // próximas ações do plano, na ordem que o aprendizado deu (só o que está na fila desta semana)
  // próximas ações: ao CLIENTE só o que a equipe aprovou ou já distribuiu (proposta ainda é sugestão do sistema); o interno vê também as propostas
  const statusAcoes = interno ? "'proposta','aprovada','distribuida'" : "'aprovada','distribuida'"
  const proximasAcoes = db.prepare(`SELECT titulo, prazo, score, dados_json FROM acoes_plano WHERE cliente = ? AND status IN (${statusAcoes}) AND regra LIKE 'anuncio\\_%' ESCAPE '\\' ORDER BY score DESC LIMIT 12`).all(cliente)
    .map(a => ({ titulo: a.titulo, prazo: a.prazo, score: a.score, ...(() => { try { const d = JSON.parse(a.dados_json); return { fila: d.fila, retro: d.retro } } catch { return {} } })() }))
    .filter(a => a.fila === 'esta_semana').slice(0, 5)

  // estoque crítico em anúncio que vende depende do CLIENTE (repor): entra nos pontos de atenção
  for (const i of retro?.risco_estoque || []) atencao.push({ tipo: 'Depende de você', texto: `Estoque para ${i.cobertura_dias} dia(s): ${String(i.titulo || i.id).slice(0, 70)} (${i.id}) — repor antes de zerar`, url: i.permalink || '', responsavel: 'Cliente', prazo: null })

  // sem NENHUM dado de resultado (canal sem API, conta não conectada): o relatório só de resultados sairia vazio — lista as tarefas, a menos que o cliente tenha sido marcado para NUNCA listar
  if (!perfilCli.regras.lista_tarefas && perfilCli.tarefas_override !== false && !desempenho && !tarefasAnuncio && !dadosMeli && !manuais) {
    perfilCli.regras = { ...perfilCli.regras, lista_tarefas: true }
    perfilCli.avisos = [...(perfilCli.avisos || []), 'Sem dados de resultado conectados (Mercado Livre): o relatório lista as tarefas até o canal ser conectado.']
  }
  // relatório que não lista tarefas não exige print de ação para ficar "pronto"
  if (!perfilCli.regras.lista_tarefas) {
    const it3 = prontidao.find(i => i.n === 3)
    if (it3 && it3.estado !== 'recebido') { it3.estado = 'opcional'; it3.detalhe = 'Relatório de resultados: os prints das ações não entram neste relatório' }
    pronto = !prontidao.some(i => i.estado === 'faltando')
  }

  // pendências do cliente por canal (avaliador único, leitura LOCAL do banco — nunca o Mercado Livre): a explicação do que depende do cliente no PDF.
  // Falha não derruba o relatório: vazio + aviso interno. `detalhe_interno` (texto da equipe) nunca sai daqui.
  let pendencias = []
  if (!leve) {
    try { pendencias = pendenciasReal().avaliar(cliente, { hoje, paraCliente: !interno }).itens.map(({ detalhe_interno, ...p }) => p) }
    catch { avisos.push('Pendências do cliente por canal indisponíveis nesta geração: o bloco "Pontos que dependem de você" não foi montado.') }
  }

  return {
    identificacao: {
      cliente, marketplaces, de, ate, periodo: `${br(de)} a ${br(ate)}`, tipo: 'Semanal',
      gerado_em: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      ultima_atualizacao: getEstado('ultimo_sync') ? horaSP(getEstado('ultimo_sync')).slice(0, 16).replace('T', ' ') : 'nunca sincronizado',   // ultimo_sync é UTC
    },
    prontidao, pronto, avisos, plano, plano_oficial: planoOficial,
    meli_conectado: !!tokenMeli, origem_metricas: origemMetricas,
    acoes, metricas: manuais, evidMetricas,
    ads: { acoes: acoesAdsML.map(t => t.titulo), numeros: adsMeli || manuais?.ads || null, evidencias: evidAds },
    produtos_top: produtosTop, ofertas: ofertasMeli,
    negocio_comparativo: negocioComp, ads_comparativo: adsComp,
    destaques: destaquesPositivos, acoes_relacionadas: acoesRelacionadas,
    otimizacoes, efeito_vendas: manuais?.comparativo || null,
    crescimento, graficos: { por_dia: porDia, por_canal: porCanal, faturamento_hist: faturamentoHist },
    atencao, proximos,
    perfil: perfilCli, resultados, atividades, tarefas_resultado, situacao,
    desempenho, retro_erro: retroErro, proximas_acoes: proximasAcoes, tarefas_anuncio: tarefasAnuncio, acompanhamento_erro: acompErro, full,
    retro: retro ? { combos: retro.combos, pior_tarefa: retro.pior_tarefa, pareto: retro.pareto, limites: retro.limites } : null,
    risco_estoque: retro?.risco_estoque || [],   // aditivo: anúncios que mais vendem com estoque curto (relatorio-brief.js → "Depende de você")
    pendencias,                                    // aditivo: Pendencia[] do avaliador (render-semanal.js → "Pontos que dependem de você")
  }
}

