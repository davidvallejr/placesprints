// Foco 80/20 + atribuição de UM cliente com o banco (F1, só leitura; docs/desenho-merovingio-foco-8020.md § 9 «Construído»).
// Lê o que já existe — série por anúncio, medidas do Merovíngio (analisarCliente), change-log (meli_item_mudanca), Ads 28 d, cobertura de estoque do
// diagnóstico — e entrega às funções PURAS de foco-8020.js e atribuicao.js. Nada é gravado (nem foco_veredito, nem tarefa_item 'observado': próxima fase).
import { db, hojeLocal } from './db.js'
import { addDias, coberturaPedidos, qualidadeNoIntervalo, cfgAtrib } from './meli-serie.js'
import { contextoCliente, analisarCliente, medirMarcoNoContexto, confiancaEfeito, dimensoesDe } from './impacto-tarefas.js'
import { cfgRetro, aprender, classificarEstado, classificarEstrategia, serieConta, itensSerie } from './retroalimentacao.js'
import { historico } from './preco-historico.js'
import { diagnosticarConta, algoritmo } from './diagnostico-conta.js'
import { montarFoco, JANELAS, diasDeSerie, NIVEIS } from './foco-8020.js'
import { marcosDoAnuncio, episodiosDe, textoAtribuicao, rankingCombinacoes, casarCardComMarco, degrauDe, janelaMarcos } from './atribuicao.js'
import { ROTULO_PRODUTO } from './produto.js'

const MAX_ANUNCIOS_ATRIBUICAO = 60       // ponytail: teto por leitura (anúncios com mudança, ordenados pela receita da janela); paginar se a tela pedir mais
const MEDIDOS = ['melhorou', 'piorou', 'sem_efeito']

export function focoDoCliente(cliente, { janela = 30, hoje = hojeLocal(), item = null } = {}) {
  janela = Number(janela)
  if (!JANELAS.includes(janela)) throw Object.assign(new Error('janela deve ser 15, 30, 45, 60 ou 90'), { status: 400 })
  const cob = coberturaPedidos(cliente)
  const base = { cliente, janela, janelas: JANELAS, hoje, produto_place: ROTULO_PRODUTO[dimensoesDe(cliente).produto] || '—',
    nota: 'Associação temporal ajustada por controle e ruído — não é prova de causa. Ausente = «—» com o motivo. Nada aqui muda o plano (F1, só leitura).' }
  if (!cob?.de) return { ...base, disponivel: false, motivo: 'sem pedidos coletados do Mercado Livre: conecte a conta e rode a coleta' }
  const ate = cob.ate < addDias(hoje, -1) ? cob.ate : addDias(hoje, -1), de = addDias(ate, -(janela - 1))
  const ctx = contextoCliente(cliente, { hoje })
  const analise = analisarCliente(cliente, { hoje, ctx })
  const meta = new Map(db.prepare('SELECT item_id, titulo, permalink FROM meli_item WHERE cliente = ?').all(cliente).map(r => [r.item_id, r]))
  const verba = new Map(db.prepare("SELECT item_id, custo FROM meli_ads_item WHERE cliente = ? AND periodo = 'atual' AND custo > 0").all(cliente).map(r => [r.item_id, r.custo]))
  let diag = null; try { diag = diagnosticarConta(cliente, { hoje }) } catch { diag = null }
  const itensDiag = diag?.disponivel ? diag.itens : []
  const limRup = cfgRetro.queda.limiar_ruptura_dias
  const risco = new Map(itensDiag.filter(i => i.cobertura != null && i.cobertura < limRup && i.curva !== 'C' && i.u >= 3).map(i => [i.id, `estoque para ${i.cobertura} dia(s)`]))
  const tot = itensDiag.reduce((t, i) => t + i.r, 0)
  const serie = serieConta(cliente), estado = classificarEstado({ serie, ate, cob })
  const estrategia = classificarEstrategia({ estado, economia: diag?.economia ?? null, custos: !!diag?.custos_informados, ads: (diag?.ads?.custo || 0) > 0, cobertura_dias: cob.dias, hoje,
    share_ruptura_pct: tot > 0 ? Math.round(1000 * [...risco.keys()].reduce((t, id) => t + (itensDiag.find(i => i.id === id)?.r || 0), 0) / tot) / 10 : null })
  const porItem = itensSerie(cliente)
  const lacunas = qualidadeNoIntervalo(cliente, de, ate).faltam.length
  const foco = montarFoco({ janela, ate, hoje, porItem, meta, medidas: analise.medidas, diasSerie: diasDeSerie(cob, ate), lacunas, risco, verba, estrategia: estrategia.classe,
    base: aprender(analise.medidas).base, tendencia: id => { const s = porItem.get(id); if (!s) return null; const e = classificarEstado({ serie: s, ate, cob }); return { estado: e.estado, significativo: !!e.significativo, variacao_pct: e.variacao_pct ?? null, motivo: e.motivo ?? null } } })
  return {
    ...base, disponivel: true, periodo: foco.periodo, cobertura: { de: cob.de, ate: cob.ate, lacunas_na_janela: lacunas },
    estado_conta: { estado: estado.estado, variacao_pct: estado.variacao_pct ?? null, motivo: estado.motivo ?? null }, estrategia: { classe: estrategia.classe, justificativa: estrategia.justificativa, provisoria: estrategia.provisoria },
    produto_por_tras: algoritmo.produto?.diagnostico_ligado === true ? 'chave produto.diagnostico_ligado ligada: o agrupamento por produto ainda não entra no foco (F2)' : 'produto = anúncio (agrupamento por produto em sombra até a F3 da V3)',
    niveis: NIVEIS, ...foco,
    atribuicao: atribuicaoDoCliente(cliente, { ctx, analise, de, ate, item, porItem, meta }),
  }
}

// atribuição por anúncio na janela: marcos (change-log + tarefas que citam o anúncio + execuções do sistema) → episódios → medida do Merovíngio → texto
export function atribuicaoDoCliente(cliente, { ctx, analise, de, ate, item = null, porItem = new Map(), meta = new Map() }) {
  const jm = janelaMarcos(de, ate)
  const eventos = historico.eventosAnuncio(cliente, { de: jm.de, ate: jm.ate, ...(item ? { itens: [item] } : {}) })
  const doItem = new Map()
  for (const m of analise.medidas) if (m.data >= jm.de && m.data <= ate) for (const i of m.itens || []) (doItem.get(i) || doItem.set(i, []).get(i)).push(m)
  const receitaJanela = id => Object.entries(porItem.get(id)?.receita || {}).reduce((t, [d, v]) => d >= de && d <= ate ? t + v : t, 0)
  const ids = [...new Set([...eventos.keys(), ...doItem.keys()])].filter(i => !item || i === item).sort((a, b) => receitaJanela(b) - receitaJanela(a))
  const marcosPorItem = new Map(), anuncios = [], todos = []
  for (const id of ids) marcosPorItem.set(id, marcosDoAnuncio({ item_id: id, eventos: eventos.get(id) || [], tarefas: doItem.get(id) || [] }))
  for (const id of ids.slice(0, MAX_ANUNCIOS_ATRIBUICAO)) {
    const eps = episodiosDe(marcosPorItem.get(id)).filter(ep => ep.dk >= de && ep.caso !== 'sem_intervencao')
    const saida = eps.map(ep => {
      const medidas = medirEpisodio(ctx, ep)
      const principal = medidas[0]
      const linha = { ...resumoEp(ep), medida: resumoMedida(principal), etapas: ep.caso === 'sequencial' ? medidas.map((m, k) => ({ dia: ep.intervencoes[k].dia, ...resumoMedida(m) })) : null,
        evidencia: degrauDe(principal), texto: textoAtribuicao(ep, principal), texto_cliente: textoAtribuicao(ep, principal, { cliente: true }) }
      todos.push({ ...ep, medida: principal })
      return linha
    })
    if (saida.length) anuncios.push({ item_id: id, titulo: meta.get(id)?.titulo || id, receita_janela_reais: Math.round(receitaJanela(id) * 100) / 100, episodios: saida })
  }
  // cards sem anúncio da janela: casamento com a mudança observada (mostrado como «inferido»; ainda não gravado nem medido como vínculo)
  const semAnuncio = analise.medidas.filter(m => m.data >= de && m.data <= ate && !(m.itens || []).length && m.fonte !== 'ofertas')
  const inferidos = semAnuncio.map(t => ({ tarefa_id: t.id, titulo: t.titulo, tipo: t.tipo, data: t.data, ...casarCardComMarco(t, marcosPorItem) }))
  return {
    n_anuncios_com_mudanca: ids.length, mostrados: anuncios.length, teto: MAX_ANUNCIOS_ATRIBUICAO, anuncios,
    ranking: rankingCombinacoes(todos),
    cards_sem_anuncio: { n: semAnuncio.length, casados: inferidos.filter(x => x.item_id).length, itens: inferidos.slice(0, 50),
      nota: 'Vínculo «observado» (decisão de 15/10: entra automático, rotulado, reversível) — nesta fase só é mostrado; a gravação em tarefa_item e a medição pelo vínculo inferido vêm na próxima.' },
    inicio_change_log: historico.inicioHistorico(cliente),
    limites: ['O change-log diário só existe a partir do início da coleta de mudanças; antes disso, só tarefas que citam o anúncio viram marco.',
      'Ranking do Mercado Livre: não medido.', `Etapas de um episódio sequencial são medidas cada uma no seu dia (pré = os dias antes da etapa, já com as anteriores); a janela pós não é truncada na etapa seguinte — ela conta como concorrente.`],
  }
}

// medida do Merovíngio para o episódio: individual/conjunto/confundido = UMA medida do 1º marco com a defasagem cobrindo a última mudança; sequencial = uma por etapa
function medirEpisodio(ctx, ep) {
  const alvo = ep.caso === 'sequencial' ? ep.intervencoes : [ep.intervencoes[0]]
  return alvo.map(m => {
    const tarefa = ep.intervencoes.flatMap(x => x.tarefas)[0]
    const t = { id: `episodio:${ep.item_id}:${m.dia}`, cliente: ctx.cliente, titulo: `Mudança no anúncio ${ep.item_id}`, tipo: tarefa?.tipo || 'Mudança no anúncio', analista: '', url: '', data: m.dia,
      data_estimada: false, itens: [ep.item_id], vinculo_origem: ['episodio'], fonte: 'episodio', lag_extra: ep.caso === 'sequencial' ? 0 : ep.lag_extra,
      intervencao_preco: (cfgAtrib.preco?.familias_preco || []).some(f => ep.familias.includes(f)) }
    const r = medirMarcoNoContexto(ctx, t)
    if (['melhorou', 'piorou'].includes(r.estado)) r.confianca = confiancaEfeito({ m: r, dataEstimada: false, concorrentes: r.concorrentes, eventos: r.eventos, taxaHistorica: null, params: ctx.params })
    return r
  })
}
const resumoEp = ep => ({ d1: ep.d1, dk: ep.dk, caso: ep.caso, credito: ep.credito, assinatura: ep.assinatura, familias: ep.familias, peso_compartilhado: ep.peso_compartilhado, autor_desconhecido: ep.autor_desconhecido,
  marcos: ep.marcos.map(m => ({ dia: m.dia, fonte: m.fonte, papel: m.intervencao ? 'intervencao' : 'cofator', incerteza: m.incerteza, campos: m.eventos.map(e => ({ campo: e.campo, de: e.de, para: e.para, papel: e.papel })), tarefas: m.tarefas.map(t => ({ id: t.id, titulo: t.titulo, tipo: t.tipo })) })),
  cofatores: ep.cofatores.map(e => ({ dia: e.dia, campo: e.campo, texto: e.texto, incerteza: e.incerteza || null })), nao_separa: ep.nao_separa })
const resumoMedida = m => m ? { estado: m.estado, motivo: m.motivo || null, efeito_pct: m.efeito_pct ?? null, receita_incremental: MEDIDOS.includes(m.estado) ? (m.receita_incremental ?? null) : null, janelas: m.janelas,
  confianca: m.confianca?.score ?? null, tendencia_pre_pct: m.tendencia_pre_pct ?? null, reversao_provavel: !!m.reversao_provavel, confundido_preco: !!m.confundido_preco, confundido_estado: !!m.confundido_estado } : null
