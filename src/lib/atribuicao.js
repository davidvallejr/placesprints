// Atribuição por anúncio: qual tarefa (ou combinação de mudanças) coincide com a mudança medida — F1, SÓ LEITURA. Desenho: docs/desenho-merovingio-foco-8020.md § 8.
// PURO: marcos, episódios, caso (individual / sequencial / conjunto / confundido), assinatura, texto e ranking. A MEDIDA de cada episódio é o
// antes × depois com controle e placebo do Merovíngio (impacto-tarefas.js::medirMarcoNoContexto), feita por atribuicao-real em foco-real.js.
// Regras: o marco é a MUDANÇA no anúncio (a fonte mais precisa manda na data); o card é testemunha (manda na intenção). Ganho de episódio conjunto
// NUNCA é dividido «em partes iguais» nem «por ordem»; etapas não se somam como independentes; N1/N2 nunca é causa; preço, promoção, Ads e
// estoque que não são a intervenção aparecem como co-fatores. Card sem anúncio só casa com mudança se família + data (± 3 d) + candidato único batem.
import { cfgAtrib, addDias, diasEntre } from './meli-serie.js'
import { cfgRetro } from './retroalimentacao.js'
import { familiaDeDemanda } from './processos.js'
import { cruzaFronteira } from './estado-anuncio.js'
import { rotuloEvento } from './acompanhamento.js'
import { wilson } from './impacto-tarefas.js'

export const CFG_EP = { janela_episodio_dias: cfgRetro.combos.janela_episodio_dias, limiar_preco_pct: cfgAtrib.preco?.limiar_confundidor_pct ?? 3, ...cfgAtrib.episodio }
const MEDIDOS = ['melhorou', 'piorou', 'sem_efeito']
const CAMPOS_ESTADO = ['promocao', 'ads', 'logistica', 'estoque_zero', 'status']
const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const dm = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—'
const brl = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sinal = n => (n > 0 ? '+' : n < 0 ? '−' : '') + String(Math.abs(n)).replace('.', ',')
const famDe = t => familiaDeDemanda(t.tipo).id

// campo que a família prevê (a tarefa «imagens» mexe em fotos/capa…)
export const preve = (famId, campo, c = CFG_EP) => (c.familias_campos?.[famId] || []).includes(campo)
// evento do change-log que confunde quando não é a intervenção: estado que cruza fronteira ou preço ≥ limiar
const confundidor = (e, c) => CAMPOS_ESTADO.includes(e.campo) ? cruzaFronteira(e) : (e.campo === 'preco' || e.campo === 'preco_original') ? Math.abs(e.pct ?? 0) >= c.limiar_preco_pct : false

// ── 1. Marcos do anúncio ──
// eventos: change-log DESTE anúncio ([{ dia, campo, de, para, pct, fonte, incerteza? }]); tarefas: medidas/tarefas que citam o anúncio ([{ id, titulo, tipo, data, fonte? }]).
// Cada evento vira papel 'intervencao' (previsto pela família da tarefa do marco, campo de conteúdo ou execução do sistema) ou 'cofator'.
export function marcosDoAnuncio({ item_id, eventos = [], tarefas = [], c = CFG_EP }) {
  const porDia = new Map()
  for (const e of eventos) (porDia.get(e.dia) || porDia.set(e.dia, { item_id, dia: e.dia, eventos: [], tarefas: [] }).get(e.dia)).eventos.push(e)
  const marcos = [...porDia.values()]
  for (const t of tarefas) {
    const fam = famDe(t)
    // testemunha: o marco observado em ± janela da conclusão cujo campo a família prevê (o mais próximo); senão a tarefa é o próprio marco (data do card)
    const alvo = marcos.filter(m => Math.abs(diasEntre(t.data, m.dia)) <= c.janela_casamento_dias && m.eventos.some(e => preve(fam, e.campo, c)))
      .sort((a, b) => Math.abs(diasEntre(t.data, a.dia)) - Math.abs(diasEntre(t.data, b.dia)))[0]
    if (alvo) alvo.tarefas.push(t)
    else { const m = marcos.find(x => x.dia === t.data && !x.eventos.length) || (marcos.push({ item_id, dia: t.data, eventos: [], tarefas: [] }), marcos.at(-1)); m.tarefas.push(t) }
  }
  for (const m of marcos) {
    const fams = m.tarefas.map(famDe)
    for (const e of m.eventos) {
      const intencional = fams.some(f => preve(f, e.campo, c)) || (c.fontes_execucao || []).includes(e.fonte) || (c.campos_conteudo || []).includes(e.campo)
      e.papel = intencional ? 'intervencao' : confundidor(e, c) ? 'cofator' : 'menor'        // 'menor' = preço < limiar: listado, não confunde
    }
    m.fonte = m.tarefas.some(t => t.fonte === 'ofertas') || m.eventos.some(e => (c.fontes_execucao || []).includes(e.fonte)) ? 'sistema' : m.eventos.length ? (m.tarefas.length ? 'coleta + card' : 'coleta') : 'card'
    m.familias = [...new Set([...fams, ...(fams.length ? [] : m.eventos.filter(e => e.papel === 'intervencao').map(e => c.campo_familia?.[e.campo]).filter(Boolean))])]
    m.intervencao = m.tarefas.length > 0 || m.eventos.some(e => e.papel === 'intervencao')
    m.incerteza = m.eventos.find(e => e.incerteza)?.incerteza || null
  }
  return marcos.sort((a, b) => a.dia.localeCompare(b.dia))
}

// ── 2. Episódios: marcos com no máximo janela_episodio_dias entre consecutivos (o mesmo de retroalimentacao.combos) ──
export function episodiosDe(marcos, c = CFG_EP) {
  const eps = []; let cur = []
  for (const m of marcos) { if (cur.length && diasEntre(cur.at(-1).dia, m.dia) > c.janela_episodio_dias) { eps.push(cur); cur = [] } cur.push(m) }
  if (cur.length) eps.push(cur)
  return eps.map(ms => classificarEpisodio(ms, c))
}

// ── 3. Caso do episódio (§ 8.3) ──
export function classificarEpisodio(marcos, c = CFG_EP) {
  let intervs = marcos.filter(m => m.intervencao)
  const autorDesconhecido = !intervs.length
  // nenhuma tarefa nem execução: a própria mudança observada é a intervenção (autor não identificado); co-fator só existe ao lado de uma intervenção
  if (autorDesconhecido) { intervs = marcos.filter(m => m.eventos.some(e => e.papel !== 'menor')); for (const m of intervs) { m.familias = [...new Set(m.eventos.filter(e => e.papel !== 'menor').map(e => c.campo_familia?.[e.campo]).filter(Boolean))]; m.intervencao = true } }
  const cofatores = autorDesconhecido ? [] : marcos.flatMap(m => m.eventos.filter(e => e.papel === 'cofator').map(e => ({ ...e, texto: rotuloEvento(e) })))
  const d1 = (intervs[0] || marcos[0]).dia, dk = (intervs.at(-1) || marcos.at(-1)).dia
  const gaps = intervs.slice(1).map((m, i) => diasEntre(intervs[i].dia, m.dia))
  const caso = !intervs.length ? 'sem_intervencao' : cofatores.length ? 'confundido' : intervs.length === 1 ? 'individual' : gaps.every(g => g >= c.min_dias_etapa) ? 'sequencial' : 'conjunto'
  const familias = [...new Set(intervs.flatMap(m => m.familias))]
  const assinatura = caso === 'sequencial' ? intervs.map(m => m.familias.join('+') || '?').join(' → ') : [...familias].sort().join(' + ')
  const naoSepara = []
  if (caso === 'conjunto') naoSepara.push(`${intervs.map(m => descreverMarco(m)).join(' e ')} (${diasEntre(d1, dk)} dia(s) entre a primeira e a última)`)
  for (const e of cofatores) naoSepara.push(`${e.texto} ${e.incerteza ? `(${e.incerteza})` : 'em ' + dm(e.dia)}`)
  return {
    item_id: marcos[0].item_id, d1, dk, caso, autor_desconhecido: autorDesconhecido, marcos, intervencoes: intervs, cofatores, familias, assinatura,
    lag_extra: caso === 'sequencial' ? 0 : diasEntre(d1, dk),               // conjunto/confundido: UMA medida do episódio, defasagem cobre até a última mudança
    credito: caso === 'individual' ? 'individual' : caso === 'sequencial' ? 'por_etapa' : 'compartilhado',
    peso_compartilhado: familias.length > 1 && caso !== 'sequencial' ? r2(1 / familias.length) : 1,
    nao_separa: naoSepara,
  }
}
export function descreverMarco(m) {
  const ev = m.eventos.filter(e => e.papel === 'intervencao' || (!m.tarefas.length && e.papel !== 'menor'))
  const quem = m.tarefas.length ? m.tarefas.map(t => familiaDeDemanda(t.tipo).nome).join(', ') : ''
  const o = ev.length ? ev.map(rotuloEvento).join('; ') : quem || 'tarefa sem mudança registrada no anúncio'
  return `${o}${ev.length && quem ? ` (tarefa: ${quem})` : ''} em ${dm(m.dia)}`
}

// ── 4. Grau de evidência da medida (escada do desenho de causalidade; N2+ ainda não existem no sistema) ──
export function degrauDe(m) {
  if (!m || !MEDIDOS.includes(m.estado)) return { nivel: 'N0', motivo: m?.motivo || (m?.estado === 'sem_controle' ? 'sem grupo de controle' : 'sem medida completa') }
  return { nivel: 'N1', motivo: 'antes × depois contra os anúncios sem mudança, com teste de ruído; N2 (controle pareado) e N3/N4 (experimento) ainda não existem no sistema' }
}
export const confiancaTexto = score => score == null ? 'sem nota' : score >= 80 ? 'forte' : score >= 60 ? 'média' : score >= 40 ? 'fraca' : 'hipótese'

// ── 5. Texto em linguagem simples (§ 8.4); cliente = sem sinal de piora, sem degrau cru ──
export function textoAtribuicao(ep, medida, { cliente = false } = {}) {
  const L = [], met = medida?.metricas?.receita
  const comparavel = medida && MEDIDOS.includes(medida.estado)
  if (met && medida.janela_usada && medida.dias_pos) {
    const a = r2(met.antes * medida.janela_usada), b = r2(met.depois * medida.dias_pos), v = a > 0 ? r1(100 * (b / a - 1)) : null
    L.push(`Faturamento ${v == null ? '' : sinal(v) + ' % '}(${brl(a)} → ${brl(b)}) nos ${medida.dias_pos} dias após ${dm(ep.d1)}.`.replace('  ', ' '))
  } else L.push(`Faturamento: — (${medida?.motivo || 'sem medida completa ainda'}).`)
  L.push(`O que mudou: ${ep.intervencoes.map(m => '[' + descreverMarco(m) + ']').join(' + ') || '—'}.`)
  if (comparavel && medida.efeito_pct != null) {
    const piora = medida.estado === 'piorou'
    if (cliente && piora) L.push('Efeito contra os anúncios sem mudança: sem resultado medido até agora.')
    else L.push(`Efeito contra os anúncios sem mudança: ${sinal(medida.efeito_pct)} % (confiança ${confiancaTexto(medida.confianca?.score)}${medida.n_placebos ? `, ${medida.n_placebos} janelas de comparação` : ''}).`)
  } else L.push('Efeito contra os anúncios sem mudança: — (sem comparação válida).')
  L.push('É associação no tempo, não prova de causa.')
  if (ep.nao_separa.length) L.push(`Não dá para separar: ${ep.nao_separa.join('; ')}.`)
  if (!cliente) L.push(`Grau de evidência: ${degrauDe(medida).nivel}.`)
  return L
}

// ── 6. Ranking das combinações por conta (§ 8.5): assinatura com célula Wilson e ganho líquido ──
// episodios: [{ assinatura, medida: { estado, efeito_pct, receita_incremental } }]
export function rankingCombinacoes(episodios, { base = cfgRetro.plano.taxa_base_padrao } = {}) {
  const g = new Map()
  for (const e of episodios) if (e.assinatura && MEDIDOS.includes(e.medida?.estado) && e.caso !== 'confundido') (g.get(e.assinatura) || g.set(e.assinatura, []).get(e.assinatura)).push(e)
  const linhas = [...g].map(([assinatura, es]) => {
    const n = es.length, k = es.filter(e => e.medida.estado === 'melhorou').length, p = es.filter(e => e.medida.estado === 'piorou').length, w = wilson(k, n)
    const ganho = es.reduce((t, e) => t + (e.medida.estado === 'melhorou' ? (e.medida.receita_incremental || 0) : e.medida.estado === 'piorou' ? -Math.abs(e.medida.receita_incremental || 0) : 0), 0)
    return { assinatura, n, melhorou: k, piorou: p, sem_efeito: n - k - p, taxa: r2(w.p), taxa_baixo: r2(w.baixo), taxa_alto: r2(w.alto), ganho_liquido: r2(ganho),
      exemplos: es.slice(0, 3).map(e => ({ item_id: e.item_id, d1: e.d1, estado: e.medida.estado, efeito_pct: e.medida.efeito_pct ?? null })) }
  })
  return {
    top: linhas.filter(l => l.ganho_liquido > 0).sort((a, b) => b.ganho_liquido - a.ganho_liquido).slice(0, 10),
    nao_renderam: linhas.filter(l => (l.n >= 3 && l.taxa_alto < base) || l.ganho_liquido < 0).sort((a, b) => a.ganho_liquido - b.ganho_liquido),
    n_assinaturas: linhas.length, nota: 'Episódios confundidos (preço, promoção, Ads ou estoque mexendo junto) ficam fora do ranking; ganho de episódio conjunto não é dividido entre as mudanças.',
  }
}

// ── 7. Card sem anúncio ↔ mudança observada (vínculo «observado», decisão de 15/10: entra automático, rotulado, reversível) ──
// marcosPorItem: Map item → marcos. Casa só com UM candidato; ≥ 2 = não casa («sem anúncio»). F1 só MOSTRA; a gravação em tarefa_item é a próxima fase.
export function casarCardComMarco(tarefa, marcosPorItem, c = CFG_EP) {
  const fam = famDe(tarefa)
  if (!(c.familias_campos?.[fam] || []).length) return { item_id: null, motivo: 'família da tarefa não prevê mudança visível no anúncio', candidatos: 0 }
  const cand = []
  for (const [item, ms] of marcosPorItem) {
    const m = ms.find(x => Math.abs(diasEntre(tarefa.data, x.dia)) <= c.janela_casamento_dias && x.eventos.some(e => preve(fam, e.campo, c)))
    if (m) cand.push({ item_id: item, dia: m.dia })
  }
  if (cand.length === 1) return { ...cand[0], origem: 'observado', rotulo: `anúncio inferido pela mudança observada em ${dm(cand[0].dia)}`, candidatos: 1 }
  return { item_id: null, motivo: cand.length ? `${cand.length} anúncios mudaram na mesma janela: não dá para escolher` : 'nenhuma mudança compatível em ± ' + c.janela_casamento_dias + ' dias', candidatos: cand.length }
}
export const janelaMarcos = (de, ate, c = CFG_EP) => ({ de: addDias(de, -c.janela_episodio_dias), ate })
