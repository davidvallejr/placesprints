// Acompanhamento por TAREFA e por ANÚNCIO: antes × 24h × 48h × 72h × 1 semana × hoje, com visitas, cliques e métricas de Ads.
//
// Regras de honestidade (as mesmas do motor de atribuição, impacto-tarefas.js):
//  • Este módulo DESCREVE o que aconteceu com o anúncio nos marcos (variação observada). Quem diz se a tarefa "gerou resultado" é o motor
//    de atribuição (efeito ajustado por grupo de controle e ruído). Sem controle, a variação aparece, mas nunca vira "efeito da tarefa".
//  • Dado não coletado é "—" + motivo, jamais zero. Marco que ainda não tem o dia completo fica "aguardando" com a data em que fecha.
//  • O dia da conclusão (D) e o dia de hoje não entram nas janelas: D tem a mudança acontecendo e hoje está incompleto.
//  • "24h" = o 1º dia inteiro depois da conclusão (D+1); 48h = média de D+1..D+2; 72h = D+1..D+3; 1 semana = D+1..D+7;
//    "hoje" = de D+1 até o último dia completo coletado. A base é a média diária dos N dias anteriores a D.
//  • Ads por dia (prints, cliques, custo, receita atribuída) vem do endpoint diário de Product Ads; "cliques" de Ads NÃO são as visitas do
//    anúncio (visitas = orgânico + Ads). O ML não entrega impressões orgânicas: ficam declaradas como lacuna, nunca estimadas.

import { db, hojeLocal, agora } from './db.js'
import { coberturaPedidos, cfgAtrib } from './meli-serie.js'
import { analisarCliente, fraseEstado, intervencoesEstado } from './impacto-tarefas.js'
import { criarVinculos } from './vinculos.js'
import { CAMPOS_ANUNCIO, igualCampo, historico } from './preco-historico.js'
import { cruzaFronteira, ROTULO_ADS, SEM_PROMOCAO } from './estado-anuncio.js'
import { familiaDeDemanda } from './processos.js'
import { microGrafico } from './micro-grafico.js'
import { cfgRetro } from './retroalimentacao.js'
import { ABERTA_SQL, ehAberta } from './status-tarefa.js'
import { origemCatalogo } from './catalogo.js'
import { criarCatalogo } from './catalogo-db.js'

const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
const soma = (s, de, ate) => { let t = 0; for (let d = de; d <= ate; d = addDias(d, 1)) t += s?.[d] || 0; return t }
const diasDe = (de, ate) => { const a = []; for (let d = de; d <= ate; d = addDias(d, 1)) a.push(d); return a }
const dm = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : ''

export const MARCOS = [
  { k: 'd1', rotulo: '24h', dias: 1 },
  { k: 'd2', rotulo: '48h', dias: 2 },
  { k: 'd3', rotulo: '72h', dias: 3 },
  { k: 'd7', rotulo: '1 semana', dias: 7 },
]
// métrica → polaridade do delta (true = subir é bom; null = neutra: gastar mais/menos não é bom nem ruim por si)
export const POLARIDADE = { visitas: true, unidades: true, receita: true, conversao: true, ticket: true, ads_prints: true, ads_clicks: true, ads_ctr: true, ads_custo: null, ads_receita: true, ads_roas: true, ads_cpc: false }
export const ROTULOS = {
  visitas: 'Visitas/dia', unidades: 'Vendas (un.)/dia', receita: 'Faturamento/dia', conversao: 'Conversão', ticket: 'Ticket médio',
  ads_prints: 'Impressões de Ads/dia', ads_clicks: 'Cliques de Ads/dia', ads_ctr: 'CTR de Ads', ads_custo: 'Investimento em Ads/dia', ads_receita: 'Receita de Ads/dia', ads_roas: 'ROAS', ads_cpc: 'CPC de Ads',
}
export const UNIDADES = { visitas: 'num', unidades: 'num', receita: 'moeda', conversao: 'pct', ticket: 'moeda', ads_prints: 'num', ads_clicks: 'num', ads_ctr: 'pct', ads_custo: 'moeda', ads_receita: 'moeda', ads_roas: 'x', ads_cpc: 'moeda' }

// soma de séries por dia ({dia: n}); null se a lista não tem série nenhuma
export function somarSeries(lista) {
  const out = {}; let alguma = false
  for (const s of lista) if (s) { alguma = true; for (const [d, v] of Object.entries(s)) out[d] = (out[d] || 0) + v }
  return alguma ? out : null
}

// ── métricas de UMA janela [a,b] ────────────────────────────────────────────
// serie: { unidades, receita, visitas|null, ads: {prints,clicks,custo,receita,unidades}|null }; cob: { pedidos(dia), visitas(dia), ads(dia) } → bool
// Cobertura é por DIA: janela com lacuna (dia não coletado) devolve null no grupo afetado, com o motivo.
export function metricasDaJanela(serie, a, b, cob = {}) {
  const dias = diasEntre(a, b) + 1
  const completo = f => !f || diasDe(a, b).every(d => f(d))
  const out = {}, motivos = {}
  if (completo(cob.pedidos) && serie.unidades) {
    const u = soma(serie.unidades, a, b), rc = soma(serie.receita, a, b)
    out.unidades = r2(u / dias); out.receita = r2(rc / dias); out.ticket = u > 0 ? r2(rc / u) : null
    if (u === 0) motivos.ticket = 'sem vendas na janela'
  } else { motivos.unidades = motivos.receita = motivos.ticket = 'pedidos desta janela não coletados' }
  if (serie.visitas && completo(cob.visitas)) {
    const v = soma(serie.visitas, a, b)
    out.visitas = r2(v / dias)
    if (out.unidades != null && v > 0) { const c = 100 * soma(serie.unidades, a, b) / v; out.conversao = c > 100 ? null : r2(c); if (c > 100) motivos.conversao = 'vendas > visitas (visitas registradas em outro anúncio do mesmo produto)' }
    else motivos.conversao = v === 0 ? 'sem visitas na janela' : 'depende das vendas'
  } else motivos.visitas = motivos.conversao = serie.visitas ? 'visitas desta janela não coletadas' : 'visitas não coletadas para este anúncio'
  if (serie.ads && completo(cob.ads)) {
    const g = k => soma(serie.ads[k], a, b)
    const pr = g('prints'), cl = g('clicks'), cu = g('custo'), re = g('receita')
    out.ads_prints = r2(pr / dias); out.ads_clicks = r2(cl / dias); out.ads_custo = r2(cu / dias); out.ads_receita = r2(re / dias)
    out.ads_ctr = pr > 0 ? r2(100 * cl / pr) : null
    out.ads_cpc = cl > 0 ? r2(cu / cl) : null
    out.ads_roas = cu > 0 ? r2(re / cu) : null
    if (pr === 0) motivos.ads_ctr = 'sem impressões de Ads na janela'
    if (cu === 0) motivos.ads_roas = 'sem investimento em Ads na janela'
  } else motivos.ads_prints = motivos.ads_clicks = motivos.ads_custo = motivos.ads_receita = motivos.ads_ctr = motivos.ads_roas = motivos.ads_cpc = serie.ads ? 'Ads desta janela não coletados' : 'sem dado diário de Ads para este anúncio'
  return { dias, valores: out, motivos }
}

// variação de cada métrica da janela contra a base. Contagens: % só com base mínima (senão null + motivo); taxas (conversão, CTR): pontos.
export function compararComBase(base, atual, { pisoBase = cfgRetro.acompanhamento.piso_base, pisoEsperado = cfgRetro.acompanhamento.piso_esperado_na_janela } = {}) {
  const d = {}
  const totalBase = k => (base.valores[k] ?? 0) * base.dias
  // cada métrica de contagem tem a sua base de referência (receita e ticket seguem as unidades; custo/receita de Ads seguem os cliques)
  const REF = { unidades: 'unidades', receita: 'unidades', ticket: 'unidades', visitas: 'visitas', ads_prints: 'ads_prints', ads_clicks: 'ads_clicks', ads_custo: 'ads_clicks', ads_receita: 'ads_clicks', ads_cpc: 'ads_clicks', ads_roas: 'ads_clicks' }
  for (const k of Object.keys(ROTULOS)) {
    const b = base.valores[k], v = atual.valores[k]
    if (b == null || v == null) { d[k] = null; continue }
    if (k === 'conversao' || k === 'ads_ctr') {          // taxa: pontos, e só com tráfego suficiente na base
      const ref = k === 'conversao' ? 'visitas' : 'ads_prints'
      if (totalBase(ref) < (pisoBase[ref] ?? 0)) { d[k] = { pontos: null, motivo: 'base pequena demais para comparar a taxa', abs: r2(v - b) }; continue }
      d[k] = { pontos: r2(v - b), bom: Math.sign(v - b) || 0 }; continue
    }
    const ref = REF[k] || k
    if (b <= 0) { d[k] = { pct: null, motivo: 'base zero', abs: r2(v - b) }; continue }
    if (totalBase(ref) < (pisoBase[ref] ?? 0)) { d[k] = { pct: null, motivo: 'base pequena demais para uma variação percentual', abs: r2(v - b) }; continue }
    if (!['receita', 'ticket', 'ads_custo', 'ads_receita', 'ads_cpc', 'ads_roas'].includes(k) ? (b * atual.dias < (pisoEsperado[ref] ?? 0)) : ((base.valores[ref] ?? 0) * atual.dias < (pisoEsperado[ref] ?? 0))) { d[k] = { pct: null, motivo: 'janela curta demais para a base (poucas ocorrências esperadas)', abs: r2(v - b) }; continue }
    d[k] = { pct: r1(100 * (v - b) / b), abs: r2(v - b) }
  }
  return d
}

// ── quadro completo: base + marcos + hoje ───────────────────────────────────
// controle (opcional): { unidades, visitas } = soma dos anúncios que nenhuma tarefa tocou na época → "ajustado" para unidades/visitas.
export function quadroAntesDepois({ serie, controle = null, data, N = 14, ultimoCompleto, cob = {}, minControle = { unidades: 10, visitas: 60 }, minBase = { unidades: 10, visitas: 50 }, maxDiasAjuste = 14 }) {
  const preDe = addDias(data, -N), preAte = addDias(data, -1)
  const base = metricasDaJanela(serie, preDe, preAte, cob)
  const baseCtrl = c => controle?.[c] ? soma(controle[c], preDe, preAte) : 0
  const linha = (rotulo, k, ate, extra = {}) => {
    const a = addDias(data, 1)
    if (ate > ultimoCompleto) return { k, rotulo, de: a, ate, estado: 'aguardando', disponivel_em: addDias(ate, 1), ...extra }
    const m = metricasDaJanela(serie, a, ate, cob)
    const deltas = compararComBase(base, m)
    const ajustado = {}
    // janela longa (ex.: "hoje" 40 dias depois): o grupo de controle foi escolhido para o entorno da tarefa e outras tarefas o tocam depois — não ajusta
    for (const c of m.dias <= maxDiasAjuste ? ['unidades', 'visitas'] : []) {
      const bT = soma(serie[c], preDe, preAte)
      if (!controle?.[c] || baseCtrl(c) < minControle[c] || bT < minBase[c] || m.valores[c] == null || base.valores[c] == null || !(base.valores[c] > 0)) continue
      const rC = (soma(controle[c], a, ate) / m.dias) / (baseCtrl(c) / N)
      if (!(rC >= 0.1)) continue           // controle que "sumiu" não serve de referência (mesma regra do motor)
      ajustado[c] = r1(((m.valores[c] / base.valores[c]) / rC - 1) * 100)
    }
    const temDado = Object.keys(m.valores).some(x => m.valores[x] != null)
    return { k, rotulo, de: a, ate, dias: m.dias, estado: temDado ? 'ok' : 'sem_dado', valores: m.valores, motivos: m.motivos, deltas, ajustado, ...(m.dias > maxDiasAjuste ? { sem_ajuste: `janela de ${m.dias} dias: sem ajuste pelo grupo de controle` } : {}), ...extra }
  }
  const marcos = MARCOS.map(m => linha(m.rotulo, m.k, addDias(data, m.dias)))
  const hojeAte = ultimoCompleto
  const hoje = hojeAte >= addDias(data, 1) ? linha('hoje', 'hoje', hojeAte, { atualizado_ate: hojeAte }) : { k: 'hoje', rotulo: 'hoje', estado: 'aguardando', disponivel_em: addDias(data, 2) }
  return { janela_base: { de: preDe, ate: preAte, dias: N }, base: { valores: base.valores, motivos: base.motivos }, marcos, hoje }
}

// leitura DESCRITIVA do quadro (nunca "efeito"): olha o último marco disponível e a métrica primária
export function sinalObservado(quadro, primaria = 'unidades', limiar = 20) {
  const ultimo = [quadro.hoje, ...[...quadro.marcos].reverse()].find(m => m?.estado === 'ok')
  if (!ultimo) return { sinal: 'sem_leitura', motivo: 'ainda sem marco completo para ler' }
  const ordem = [primaria, primaria === 'unidades' ? 'visitas' : 'unidades']
  for (const c of ordem) {
    const d = ultimo.deltas?.[c]
    if (d?.pct != null) return { sinal: d.pct >= limiar ? 'positivo' : d.pct <= -limiar ? 'negativo' : 'estavel', metrica: c, pct: d.pct, marco: ultimo.rotulo, ajustado_pct: ultimo.ajustado?.[c] ?? null }
  }
  return { sinal: 'sem_leitura', motivo: 'base pequena demais para ler variação percentual' }
}

// ── pontos do micro gráfico: N dias antes até D+extra (limitado ao último dia completo) ──
export function serieGrafico({ serie, data, N = 14, ultimoCompleto, extra = 21, cob = null }) {
  const de = addDias(data, -N), ate = addDias(data, extra) < ultimoCompleto ? addDias(data, extra) : ultimoCompleto
  if (ate < de) return null
  const dias = diasDe(de, ate)
  const baseDe = addDias(data, -N), baseAte = addDias(data, -1)
  const pega = (s, cobFn) => s && (!cobFn || dias.every(cobFn)) ? dias.map(d => s[d] || 0) : null   // dia não coletado não vira zero no gráfico: sem cobertura completa, a série não é desenhada
  const media = s => s ? r2(soma(s, baseDe, baseAte) / N) : null
  return {
    de, ate, dias, marcador: data, n_antes: dias.filter(d => d < data).length,
    visitas: pega(serie.visitas, cob?.visitas), unidades: pega(serie.unidades, cob?.pedidos), ads_clicks: pega(serie.ads?.clicks, cob?.ads),
    base: { visitas: media(serie.visitas), unidades: media(serie.unidades), ads_clicks: media(serie.ads?.clicks) },
  }
}

// ── o que mudou no anúncio entre o "antes" fotografado e agora (só com fotografia: nunca adivinha) ──
// eventos: histórico do anúncio (historico.eventosAnuncio, um item) → cada mudança ganha a data ("em") da última mudança daquele campo DEPOIS da
// fotografia (desde = dia da fotografia; a coleta do dia roda antes dela). Sem evento, em = null: a data não é inventada.
export function mudancasNoAnuncio(antes, agora, { eventos = [], desde = '' } = {}) {
  if (!antes || !agora) return null
  const out = []
  for (const [k, rotulo] of CAMPOS_ANUNCIO) {
    const a = antes[k], b = agora[k]
    if (a == null && b == null) continue
    if (igualCampo(k, a, b)) continue
    // estoque só tem histórico ao cruzar o zero; tipo de anúncio não tem histórico
    const campoHist = k === 'estoque' ? ((Number(a) > 0) !== (Number(b) > 0) ? 'estoque_zero' : null) : k === 'tipo_anuncio' ? null : k
    const ev = campoHist ? eventos.filter(e => e.campo === campoHist && (!desde || e.dia > desde)).at(-1) : null
    out.push({ campo: k, rotulo, antes: a ?? null, agora: b ?? null, em: ev?.dia ?? null, ...(ev?.incerteza ? { incerteza: ev.incerteza } : {}) })
  }
  return out
}

// rótulo curto de uma mudança do histórico (ponto do gráfico)
const ROT_CAMPO = { preco: 'Preço', preco_original: 'Preço "de"', titulo: 'Título', fotos: 'Fotos', estoque_zero: 'Estoque', status: 'Status', frete_gratis: 'Frete grátis', logistica: 'Logística', thumb: 'Foto de capa', promocao: 'Promoção', ads: 'Ads' }
const brl2 = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export function rotuloEvento(e) {
  const inc = e.incerteza ? ` (${e.incerteza})` : ''
  switch (e.campo) {
    case 'preco': case 'preco_original': return `${ROT_CAMPO[e.campo]}: ${brl2(e.de)} → ${e.para == null ? 'removido' : brl2(e.para)}${inc}`
    case 'fotos': case 'status': case 'logistica': return `${ROT_CAMPO[e.campo]}: ${e.de} → ${e.para}${inc}`
    case 'estoque_zero': return `Estoque ${Number(e.para) > 0 ? 'voltou' : 'zerou'}${inc}`
    case 'frete_gratis': return `Frete grátis ${Number(e.para) ? 'ligado' : 'desligado'}${inc}`
    case 'promocao': return `Promoção: ${e.de === SEM_PROMOCAO ? `entrou (${e.para})` : e.para === SEM_PROMOCAO ? `saiu (${e.de})` : `${e.de} → ${e.para}`}${inc}`
    case 'ads': return `Ads: ${ROTULO_ADS[e.de] || e.de} → ${ROTULO_ADS[e.para] || e.para}${inc}`
    default: return `${ROT_CAMPO[e.campo] || e.campo} mudou${inc}`
  }
}
// evento de ESTADO que cruza fronteira (promoção, Ads, Full, estoque zero, pausa): marcador próprio no gráfico e segmento no veredito
const ehEstado = e => (cfgAtrib.estado?.campos || []).includes(e.campo) && String(e.de ?? '') !== '' && cruzaFronteira(e)


// ═══════════════════════════════════════════════════════════════════════════
// Camada com banco: fotografias (antes / 24h / 48h / 72h / 1 semana) e cartões por tarefa
// ═══════════════════════════════════════════════════════════════════════════
const vinculos = criarVinculos(db)
const catalogoDb = criarCatalogo(db)
const diaBR = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '' }
export const ROTULO_MEDIDO = { melhorou: 'Melhorou (ajustado pelo controle)', piorou: 'Piorou (ajustado pelo controle)', sem_efeito: 'Sem efeito mensurável', em_maturacao: 'Em maturação', sem_base: 'Sem base para medir', sem_controle: 'Sem grupo de controle', variacao_conta: 'Variação da conta', lancamento: 'Lançamento', em_andamento: 'Em andamento (antes de mexer)' }
const ATTRS = `titulo, preco, fotos, estoque, status, frete_gratis, tipo_anuncio, logistica, thumb, permalink, catalogo`

// séries por anúncio: pedidos/visitas (meli_serie_item) + Ads por dia (meli_ads_dia) e a cobertura de cada fonte
export function carregarSeries(cliente) {
  const itens = new Map()
  const get = id => itens.get(id) || itens.set(id, { unidades: {}, receita: {}, visitas: {}, ads: null, cob: {} }).get(id)
  for (const r of db.prepare('SELECT item_id, dia, unidades, receita, visitas FROM meli_serie_item WHERE cliente = ?').all(cliente)) {
    const o = get(r.item_id)
    if (r.unidades) { o.unidades[r.dia] = r.unidades; o.receita[r.dia] = r.receita }
    if (r.visitas) o.visitas[r.dia] = r.visitas
  }
  for (const r of db.prepare('SELECT item_id, vis_de, vis_ate FROM meli_item WHERE cliente = ?').all(cliente)) { const o = itens.get(r.item_id); if (o && r.vis_de) o.cob.visitas = [r.vis_de, r.vis_ate] }
  const cobAds = new Map(db.prepare('SELECT item_id, de, ate FROM meli_ads_cobertura WHERE cliente = ?').all(cliente).map(r => [r.item_id, [r.de, r.ate]]))
  for (const r of db.prepare('SELECT item_id, dia, prints, clicks, custo, receita, unidades FROM meli_ads_dia WHERE cliente = ?').all(cliente)) {
    const o = get(r.item_id)
    o.ads ||= { prints: {}, clicks: {}, custo: {}, receita: {}, unidades: {} }
    for (const k of ['prints', 'clicks', 'custo', 'receita', 'unidades']) if (r[k]) o.ads[k][r.dia] = r[k]
  }
  for (const [id, c] of cobAds) { const o = get(id); o.cob.ads = c; o.ads ||= { prints: {}, clicks: {}, custo: {}, receita: {}, unidades: {} } }   // coletado e sem Ads = zeros (≠ não coletado)
  return itens
}

// agrega vários anúncios numa série única; cobertura por dia = TODOS os incluídos cobrem o dia (nunca soma com buraco)
export function agregarAnuncios(series, ids, cobPedidos) {
  const lista = ids.map(i => series.get(i)).filter(Boolean)
  const comVis = lista.length > 0 && lista.every(o => o.cob.visitas)
  const comAds = lista.filter(o => o.cob.ads)
  const serie = {
    unidades: somarSeries(lista.map(o => o.unidades)) || {}, receita: somarSeries(lista.map(o => o.receita)) || {},
    visitas: comVis ? somarSeries(lista.map(o => o.visitas)) : null,
    ads: comAds.length ? Object.fromEntries(['prints', 'clicks', 'custo', 'receita', 'unidades'].map(k => [k, somarSeries(comAds.map(o => o.ads[k]))])) : null,
  }
  const cob = {
    pedidos: d => !!cobPedidos?.de && d >= cobPedidos.de && d <= cobPedidos.ate,
    visitas: d => comVis && lista.every(o => d >= o.cob.visitas[0] && d <= o.cob.visitas[1]),
    ads: d => comAds.length > 0 && comAds.every(o => d >= o.cob.ads[0] && d <= o.cob.ads[1]),
  }
  return { serie, cob, ads_itens: { com: comAds.length, total: lista.length }, visitas_ok: comVis }
}

// controle para o ajuste: anúncios que nenhuma tarefa tocou no entorno desta (da janela anterior até D+17: o ajuste vale para janelas de até 14 dias)
// visitas do controle só entram de anúncio com série FRESCA (vis_ate ≥ ontem−2), como no motor de atribuição
function controleDe({ series, tocadosPorItem, data, N, ultimoCompleto, alvo, cobPedidos }) {
  const de = addDias(data, -N - 3), ate = addDias(data, 17)
  const ids = [...series.keys()].filter(i => !alvo.includes(i) && !(tocadosPorItem.get(i) || []).some(d => d >= de && d <= ate))
  if (!ids.length) return null
  const a = agregarAnuncios(series, ids, cobPedidos)
  const idsVis = ids.filter(i => { const c = series.get(i)?.cob.visitas; return c && c[0] <= addDias(data, -N) && c[1] >= addDias(ultimoCompleto, -2) })
  const av = idsVis.length ? agregarAnuncios(series, idsVis, cobPedidos) : null
  return { unidades: a.serie.unidades, visitas: av?.visitas_ok ? av.serie.visitas : null, n: ids.length }
}

// eventos (opcional): Map item_id → mudanças do anúncio (historico.eventosAnuncio) → um ponto por dia no micro gráfico
export function construirQuadro({ series, cobPedidos, ids, data, N = 14, ultimoCompleto, tocadosPorItem = new Map(), eventos = null }) {
  const ag = agregarAnuncios(series, ids, cobPedidos)
  const controle = controleDe({ series, tocadosPorItem, data, N, ultimoCompleto, alvo: ids, cobPedidos })
  const quadro = quadroAntesDepois({ serie: ag.serie, controle, data, N, ultimoCompleto, cob: ag.cob })
  const meta = ag.serie.visitas ? 'visitas' : 'unidades'   // (se a série de visitas tiver buraco, serieGrafico devolve null nela e cai para unidades)
  const sinal = sinalObservado(quadro, 'unidades')
  const graf = serieGrafico({ serie: ag.serie, data, N, ultimoCompleto, cob: ag.cob })
  const gValores = graf ? (graf[meta] || graf.unidades || graf.visitas) : null
  const porDia = new Map()
  if (graf && eventos) for (const e of ids.flatMap(i => eventos.get(i) || [])) if (e.dia >= graf.de && e.dia <= graf.ate) { const d = porDia.get(e.dia) || porDia.set(e.dia, { rs: new Set(), estado: false }).get(e.dia); d.rs.add(rotuloEvento(e)); if (ehEstado(e)) d.estado = true }
  const pontos = graf ? [...porDia].map(([d, { rs, estado }]) => ({ idx: graf.dias.indexOf(d), rotulo: `${dm(d)} · ${[...rs].join('; ')}`, estado })) : []
  const grafico = graf && gValores ? {
    metrica: graf.visitas ? 'visitas' : 'unidades', de: graf.de, ate: graf.ate, marcador: graf.marcador, base: graf.base[graf.visitas ? 'visitas' : 'unidades'], eventos: pontos.length,
    svg: microGrafico({ valores: gValores, marcadorIdx: graf.n_antes, base: graf.base[graf.visitas ? 'visitas' : 'unidades'], sinal: sinal.sinal === 'sem_leitura' ? 'neutro' : sinal.sinal, eventos: pontos, rotulo: `${graf.visitas ? 'Visitas' : 'Vendas'} por dia (média móvel de 3 dias); tracejado vertical = conclusão em ${data.split('-').reverse().join('/')}${pontos.length ? '; ponto = mudança no anúncio' : ''}${pontos.some(p => p.estado) ? '; losango = mudança de estado (promoção, Ads, Full, estoque, pausa)' : ''}` }),
  } : null
  return { quadro, sinal, grafico, ads_itens: ag.ads_itens, visitas_ok: ag.visitas_ok, controle_n: controle?.n ?? 0 }
}

// ── fases devidas (pura): quando cada fotografia pode ser tirada ────────────
// d1 fecha quando o dia D+1 está completo, ou seja, a partir de D+2 (último dia completo = ontem). Captura tardia fica registrada (atraso_dias).
export function fasesPendentes({ data, hoje, capturadas = [] }) {
  const out = []
  for (const m of MARCOS) {
    if (capturadas.includes(m.k)) continue
    const disponivel = addDias(data, m.dias + 1)
    if (hoje >= disponivel) out.push({ fase: m.k, disponivel_em: disponivel, atraso_dias: diasEntre(disponivel, hoje) })
  }
  return out
}

const attrsDe = (cliente, id) => db.prepare(`SELECT ${ATTRS} FROM meli_item WHERE cliente = ? AND item_id = ?`).get(cliente, id) || null
const MAX_FOTOS_ITENS = 6

// fotografias diárias (idempotente). Roda depois da coleta do ML: 1) 'antes' para tarefas abertas com anúncio vinculado;
// 2) marcos 24h/48h/72h/1 semana para tarefas concluídas recentemente.
export function capturarAcompanhamento(cliente, { hoje = hojeLocal(), analise = null } = {}) {
  const conhecidos = new Set(db.prepare('SELECT item_id FROM meli_item WHERE cliente = ?').all(cliente).map(r => r.item_id))
  const cobPedidos = coberturaPedidos(cliente)
  const ultimoCompleto = cobPedidos?.ate && cobPedidos.ate < addDias(hoje, -1) ? cobPedidos.ate : addDias(hoje, -1)
  const series = carregarSeries(cliente)
  const salvas = new Map()
  for (const r of db.prepare('SELECT tarefa_id, item_id, fase FROM tarefa_acomp WHERE cliente = ?').all(cliente)) (salvas.get(`${r.tarefa_id}|${r.item_id}`) || salvas.set(`${r.tarefa_id}|${r.item_id}`, []).get(`${r.tarefa_id}|${r.item_id}`)).push(r.fase)
  const ins = db.prepare(`INSERT OR IGNORE INTO tarefa_acomp (tarefa_id, item_id, fase, cliente, data_ref, capturado_em, atraso_dias, estado_json) VALUES (?,?,?,?,?,?,?,?)`)
  let antes = 0, marcos = 0
  const t = agora()
  // 1) 'antes': tarefa aberta de Mercado Livre com anúncio vinculado (citado/plano/confirmado)
  const abertas = db.prepare(`SELECT id, titulo, descricao, conteudo FROM tarefas WHERE cliente = ? AND arquivada = 0 AND ${ABERTA_SQL} AND processo LIKE '%ercado%'`).all(cliente)
  const vm = vinculos.vinculosDe(cliente, abertas, conhecidos)
  db.transaction(() => {
    for (const tk of abertas) for (const v of (vm.get(tk.id) || []).slice(0, MAX_FOTOS_ITENS)) {
      if ((salvas.get(`${tk.id}|${v.item_id}`) || []).includes('antes')) continue
      const a = attrsDe(cliente, v.item_id)
      if (!a) continue
      const q = construirQuadro({ series, cobPedidos, ids: [v.item_id], data: hoje, ultimoCompleto })
      ins.run(tk.id, v.item_id, 'antes', cliente, hoje, t, 0, JSON.stringify({ attrs: a, base: q.quadro.base.valores, janela_base: q.quadro.janela_base, origem_vinculo: v.origem }))
      antes++
    }
  })()
  // 2) marcos: tarefa concluída (a análise já traz data e anúncios vinculados)
  analise ??= analisarCliente(cliente, { hoje })
  const tocadosPorItem = tocadosDe(analise.medidas)
  db.transaction(() => {
    for (const m of analise.medidas) {
      if (!m.itens.length || m.data < addDias(hoje, -12)) continue
      for (const id of m.itens.slice(0, MAX_FOTOS_ITENS)) {
        const feitas = salvas.get(`${m.id}|${id}`) || []
        const devidas = fasesPendentes({ data: m.data, hoje, capturadas: feitas })
        if (!devidas.length) continue
        const q = construirQuadro({ series, cobPedidos, ids: [id], data: m.data, ultimoCompleto, tocadosPorItem })
        const a = attrsDe(cliente, id)
        for (const d of devidas) {
          const marco = q.quadro.marcos.find(x => x.k === d.fase)
          if (!marco || marco.estado === 'aguardando') continue
          ins.run(m.id, id, d.fase, cliente, m.data, t, d.atraso_dias, JSON.stringify({ attrs: a, marco: { valores: marco.valores, deltas: marco.deltas, ajustado: marco.ajustado, de: marco.de, ate: marco.ate }, base: q.quadro.base.valores }))
          marcos++
        }
      }
    }
  })()
  return { antes, marcos }
}
const tocadosDe = medidas => { const m = new Map(); for (const x of medidas) for (const i of x.itens || []) (m.get(i) || m.set(i, []).get(i)).push(x.data); return m }

// ── veredito descritivo do cartão (puro): título por estado medido × sinal observado; linha só com os segmentos que têm dado ──
// O título de "melhorou/piorou" é o efeito do MOTOR (ajustado por controle e ruído); o resto descreve o que se viu, sem chamar de efeito.
export const ORDEM_FAMILIA = ['piorou', 'melhorou', 'lancou', 'sem_efeito', 'maturando', 'andamento', 'sem_base']
const FAMILIA = { piorou: 'piorou', melhorou: 'melhorou', lancamento: 'lancou', sem_efeito: 'sem_efeito', em_maturacao: 'maturando', em_andamento: 'andamento' }
const ROT_METRICA = { unidades: 'vendas/dia', visitas: 'visitas/dia', receita: 'faturamento/dia' }
const MOTIVO_SEM_BASE = { cobertura: 'histórico de pedidos começa depois da janela anterior', unidades: 'poucas vendas e visitas antes da tarefa' }
const pctAbs = v => `${(Math.abs(v) < 1 ? Math.round(Math.abs(v) * 10) / 10 : Math.round(Math.abs(v))).toLocaleString('pt-BR')}%`
const pctV = v => `${pctAbs(v) === '0%' ? '' : v > 0 ? '+' : '−'}${pctAbs(v)}`
const reais = v => `R$ ${Math.round(v).toLocaleString('pt-BR')}`
const num1 = v => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
const ultimoOk = q => q ? [q.hoje, ...[...(q.marcos || [])].reverse()].find(m => m?.estado === 'ok') || null : null

// preço na janela da tarefa: o maior evento (dia relativo à conclusão), ou o preço pago quando só ele confundiu, ou se o histórico cobre a janela
function segmentoPreco(p) {
  if (!p) return null
  const evs = p.eventos || []
  if (evs.length) {
    const e = [...evs].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))[0]
    const quando = e.incerteza || (e.dia_rel == null ? `em ${dm(e.dia)}` : e.dia_rel < 0 ? `${-e.dia_rel} dia(s) antes da conclusão` : `no dia ${e.dia_rel}`)
    const mais = evs.length > 1 ? ` (+${evs.length - 1} outra(s))` : ''
    // mudança de centavos (abaixo de 0,1%) aparece em reais: "caiu 0%" esconderia que mudou
    const mag = e.pct != null && Math.abs(e.pct) < 0.1 && e.de != null && e.para != null ? brl2(Math.abs(e.para - e.de)) : e.pct != null ? pctAbs(e.pct) : null
    if (p.tarefa_de_preco) return `preço ${mag == null ? 'mudou' : `${e.pct > 0 ? '+' : '−'}${mag}`} ${quando} (a própria tarefa)${mais}`
    return `preço ${mag == null ? 'mudou' : `${e.pct > 0 ? 'subiu' : 'caiu'} ${mag}`} ${quando} (pode ter interferido)${mais}`
  }
  if (p.confundidor && p.variacao_pct != null) return `preço pago variou ${pctV(p.variacao_pct)} na janela (pode ter interferido)`
  return p.historico ? 'preço inalterado' : 'preço: sem histórico neste período'
}
// estado na janela da tarefa: um segmento por evento ("entrou em promoção no dia 3 (pode ter interferido)", "Ads ligado no dia 0 (a própria tarefa)");
// sem evento, nada (o estado constante não é notícia). Até 3 eventos; o resto vira contagem.
function segmentosEstado(est) {
  const evs = est?.eventos || [], intervencao = est?.intervencao || []
  const seg = evs.slice(0, 3).map(e => {
    const quando = e.incerteza || (e.dia_rel == null ? `em ${dm(e.dia)}` : e.dia_rel < 0 ? `${-e.dia_rel} dia(s) antes da conclusão` : `no dia ${e.dia_rel}`)
    return `${fraseEstado(e, false)} ${quando} (${intervencao.includes(e.campo) ? 'a própria tarefa' : 'pode ter interferido'})`
  })
  if (evs.length > 3) seg[2] += ` (+${evs.length - 3} outro(s) evento(s))`
  return seg
}

// c: cartão de cartoesDoCliente ({ medido, sinal, quadro, precos, estado, itens }). Devolve { familia, titulo, linha }.
export function vereditoCartao(c) {
  const med = c?.medido || {}, s = c?.sinal || {}, q = c?.quadro
  const familia = FAMILIA[med.estado] || 'sem_base'
  const rot = ROT_METRICA[med.metrica_primaria] || 'vendas/dia'
  const efeito = med.efeito_pct != null ? ` ${pctV(med.efeito_pct)}` : ''
  const obs = s.pct != null ? `${ROT_METRICA[s.metrica] || s.metrica} ${pctV(s.pct)} ${s.marco === 'hoje' ? 'até ontem' : `em ${s.marco}`}` : null
  const semLeitura = /base pequena/.test(s.motivo || '') ? 'base pequena para ler a variação' : 'ainda sem marco completo'
  let titulo
  if (med.estado === 'piorou') titulo = `Caiu: ${rot}${efeito} (ajustado pelo controle)`
  else if (med.estado === 'melhorou') titulo = `Melhorou: ${rot}${efeito} (ajustado pelo controle)`
  else if (med.estado === 'sem_efeito') titulo = (s.sinal === 'positivo' || s.sinal === 'negativo') && obs ? `Variação dentro do ruído: ${obs}, mas os anúncios sem tarefa oscilaram igual` : 'Sem efeito distinguível do ruído'
  else if (med.estado === 'lancamento') {
    const l = med.lancamento || {}, em = med.dias_pos ? ` em ${med.dias_pos} dias` : ''
    titulo = l.unidades > 0 ? `Lançou e vendeu: ${l.unidades} un (${reais(l.receita || 0)})${em}${l.primeira_venda_dias != null ? ` · 1ª venda no dia ${l.primeira_venda_dias}` : ''}` : `Lançou, ainda sem venda${em}`
  } else if (med.estado === 'em_maturacao') {
    const fecha = med.janelas?.pos?.[1] ? ` · fecha em ${dm(addDias(med.janelas.pos[1], 1))}` : ''
    titulo = `Em maturação, ${s.sinal === 'positivo' ? 'sinal inicial de alta' : s.sinal === 'negativo' ? 'sinal inicial de queda' : s.sinal === 'estavel' ? 'sem variação' : semLeitura}${fecha}`
  } else if (med.estado === 'em_andamento') {
    const foto = (c.itens || []).map(i => i.antes_fotografia?.capturado_em).filter(Boolean).sort()[0], b = q?.base?.valores?.unidades
    titulo = `Em andamento: ${foto ? `antes fotografado em ${dm(diaBR(foto))}` : 'antes ainda não fotografado'}${b != null ? ` · base ${num1(b)} vendas/dia` : ''}`
  } else titulo = `Sem base para medir (${med.estado === 'sem_controle' ? 'sem grupo de controle' : med.estado === 'variacao_conta' ? 'tarefa da conta inteira, sem anúncio' : MOTIVO_SEM_BASE[med.causa] || 'dados insuficientes'}) · observado: ${obs || semLeitura}; sem controle não vira efeito`
  if (med.reversao_provavel) titulo += ' · possível reversão à média'

  const seg = [], u = ultimoOk(q)
  if (u) {
    const v = u.valores || {}, d = u.deltas || {}, dias = u.dias
    if (v.unidades != null && familia !== 'lancou') { const un = Math.round(v.unidades * dias); seg.push(un > 0 ? `vendeu ${un} un (${reais(v.receita * dias)}) em ${dias} dia${dias > 1 ? 's' : ''}` : dias > 1 ? `sem venda nos ${dias} dias` : 'sem venda no dia') }
    if (d.receita?.pct != null) seg.push(`faturamento/dia ${pctV(d.receita.pct)}`)
    if (d.unidades?.pct != null) seg.push(`vendas/dia ${pctV(d.unidades.pct)}`)
    if (d.visitas?.pct != null) seg.push(`visitas/dia ${pctV(d.visitas.pct)}`)
    if (d.conversao?.pontos != null) seg.push(Math.abs(d.conversao.pontos) < 0.1 ? 'conversão estável' : `conversão ${d.conversao.pontos > 0 ? '+' : '−'}${num1(Math.abs(d.conversao.pontos))} p.p.`)
    if (d.unidades?.pct > 0 && d.receita?.pct < 0) seg.push('ticket caiu: vende mais e fatura menos (preço/promoção)')
    else if (d.ticket?.pct != null && Math.abs(d.ticket.pct) >= 3) seg.push(`ticket ${pctV(d.ticket.pct)}`)
  }
  const sp = segmentoPreco(c?.precos); if (sp) seg.push(sp)
  seg.push(...segmentosEstado(c?.estado))
  const aj = u?.ajustado?.unidades ?? u?.ajustado?.visitas
  if (aj != null) seg.push(`descontado o controle: ${pctV(aj)}`)
  return { familia, titulo, linha: seg.join(' · ') }
}

// ── cartões por tarefa ──────────────────────────────────────────────────────
function fraseMarco(q, medido) {
  const ult = [q.hoje, ...[...q.marcos].reverse()].find(m => m?.estado === 'ok')
  if (!ult) return 'Ainda sem marco completo: o primeiro (24h) fecha quando o dia seguinte à conclusão terminar.'
  const d = ult.deltas || {}, v = ult.valores || {}, b = q.base.valores
  const n = x => String(x).replace('.', ',')
  const parte = (k, rot, un = '') => d[k]?.pct != null ? `${rot} ${n(b[k])} → ${n(v[k])}${un} (${d[k].pct > 0 ? '+' : ''}${n(d[k].pct)}%)`
    : d[k]?.abs != null && b[k] != null && v[k] != null ? `${rot} ${n(b[k])} → ${n(v[k])}${un} (${d[k].motivo === 'base zero' ? 'base zero' : 'base pequena'}: sem variação percentual)` : null
  const partes = [parte('visitas', 'visitas/dia'), parte('unidades', 'vendas/dia'), parte('ads_clicks', 'cliques de Ads/dia')].filter(Boolean)
  const aj = ult.ajustado?.unidades ?? ult.ajustado?.visitas
  const base = partes.length ? `${ult.rotulo === 'hoje' ? 'Até ontem' : `Em ${ult.rotulo}`}: ${partes.join('; ')}.` : `${ult.rotulo === 'hoje' ? 'Até ontem' : `Em ${ult.rotulo}`}: sem dado suficiente para comparar com o antes.`
  const ajt = aj != null ? ` Descontando o que os anúncios sem tarefa fizeram no mesmo período: ${aj > 0 ? '+' : ''}${String(aj).replace('.', ',')}%.` : ''
  return `${base}${ajt} Isso é associação temporal — não prova que a tarefa causou a variação.`
}

export function cartoesDoCliente(cliente, { hoje = hojeLocal(), analise = null, dias = 60, soResultado = false, tarefaId = null, limite = 80 } = {}) {
  const cobPedidos = coberturaPedidos(cliente)
  const ultimoCompleto = cobPedidos?.ate && cobPedidos.ate < addDias(hoje, -1) ? cobPedidos.ate : addDias(hoje, -1)
  analise ??= analisarCliente(cliente, { hoje })
  const series = carregarSeries(cliente)
  const tocadosPorItem = tocadosDe(analise.medidas)
  const itemRows = new Map(db.prepare(`SELECT item_id, ${ATTRS} FROM meli_item WHERE cliente = ?`).all(cliente).map(r => [r.item_id, r]))
  const tk = new Map(db.prepare('SELECT id, titulo, responsavel, status, url, processo, tipo_demanda, descricao, conteudo FROM tarefas WHERE cliente = ?').all(cliente).map(r => [r.id, r]))
  // histórico do anúncio (todos os campos): pontos no gráfico e data de "O que mudou"; o preço na janela da medida vem do motor (m.eventos_preco)
  const evAnuncio = historico.eventosAnuncio(cliente), iniHist = historico.inicioHistorico(cliente)
  const comDiaRel = (evs, data) => evs.map(e => ({ ...e, dia_rel: diasEntre(data, e.dia) }))
  const snaps = new Map()
  for (const r of db.prepare('SELECT tarefa_id, item_id, fase, capturado_em, atraso_dias, estado_json FROM tarefa_acomp WHERE cliente = ?').all(cliente)) { const k = `${r.tarefa_id}|${r.item_id}`; (snaps.get(k) || snaps.set(k, {}).get(k))[r.fase] = { capturado_em: r.capturado_em, atraso_dias: r.atraso_dias, ...JSON.parse(r.estado_json) } }
  const planoDe = new Map(db.prepare("SELECT id, regra, dados_json, previsao_json FROM acoes_plano WHERE cliente = ?").all(cliente).map(r => [r.id.toUpperCase(), r]))
  const RX_PS = /·\s*(PS-[0-9a-f]{10})\b/i

  const catCtx = catalogoDb.contexto(cliente)
  const cartaoItem = id => {
    const r = itemRows.get(id)
    return r ? { item_id: id, titulo: r.titulo, thumb: r.thumb, permalink: r.permalink, preco: r.preco, status: r.status, estoque: r.estoque, fotos: r.fotos, logistica: r.logistica, frete_gratis: !!r.frete_gratis, catalogo_origem: origemCatalogo({ id, catalogo: r.catalogo }, catCtx) } : { item_id: id, titulo: '(anúncio não encontrado na coleta)', thumb: '', permalink: '', preco: null }
  }
  const construir = m => {
    const ids = m.itens
    const q = construirQuadro({ series, cobPedidos, ids, data: m.data, ultimoCompleto, tocadosPorItem, eventos: evAnuncio })
    const t = tk.get(m.id) || {}
    const ps = RX_PS.exec(m.titulo || '')?.[1]?.toUpperCase()
    const pl = ps ? planoDe.get(ps) : null
    const dadosPl = pl ? JSON.parse(pl.dados_json) : null, prevPl = pl && pl.previsao_json ? JSON.parse(pl.previsao_json) : null
    const por_item = ids.slice(0, 3).map(id => { const x = construirQuadro({ series, cobPedidos, ids: [id], data: m.data, ultimoCompleto, tocadosPorItem }); const s = snaps.get(`${m.id}|${id}`) || {}; const atual = attrsDe(cliente, id)
      return { ...cartaoItem(id), quadro: ids.length > 1 ? x.quadro : null, antes_fotografia: s.antes ? { capturado_em: s.antes.capturado_em, attrs: s.antes.attrs } : null, mudancas: s.antes ? mudancasNoAnuncio(s.antes.attrs, atual, { eventos: evAnuncio.get(id) || [], desde: diaBR(s.antes.capturado_em) }) : null, marcos_capturados: Object.keys(s).filter(k => k !== 'antes').map(k => ({ fase: k, capturado_em: s[k].capturado_em, atraso_dias: s[k].atraso_dias })) } })
    const A = cfgRetro.acompanhamento
    const gerou = (m.estado === 'melhorou' && (m.receita_alocada || 0) > 0)
      || (m.estado === 'lancamento' && (m.lancamento?.unidades ?? 0) >= A.lancamento_min_unidades && m.lancamento?.primeira_venda_dias != null && m.lancamento.primeira_venda_dias <= A.lancamento_max_dias_primeira_venda)
    const card = {
      tarefa: { id: m.id, titulo: m.titulo, tipo: m.tipo, analista: m.analista, status: t.status || 'concluida', url: m.url || t.url, data: m.data, data_estimada: m.data_estimada },
      vinculo: { origem: m.vinculo_origem, n_itens: ids.length },
      itens: por_item, itens_extra: Math.max(0, ids.length - 3),
      quadro: q.quadro, sinal: q.sinal, grafico: q.grafico, ads_itens: q.ads_itens, visitas_ok: q.visitas_ok, controle_n: q.controle_n,
      medido: { estado: m.estado, rotulo: ROTULO_MEDIDO[m.estado] || m.estado, efeito_pct: m.efeito_pct ?? null, metrica_primaria: m.metrica_primaria ?? null, confianca: m.confianca || null, receita_alocada: m.receita_alocada ?? null, motivo: m.motivo || null, janelas: m.janelas, pct_ruido: m.pct_ruido ?? null, reversao_provavel: !!m.reversao_provavel, lancamento: m.lancamento || null, controle: m.controle || null, dias_pos: m.dias_pos ?? null, causa: m.causa ?? null },
      precos: { eventos: comDiaRel(m.eventos_preco || [], m.data), tarefa_de_preco: !!m.intervencao_preco, confundidor: !!m.confundido_preco, variacao_pct: m.variacao_preco_pct ?? null, historico: !!iniHist && iniHist <= (m.janelas?.pre?.[0] || m.data) },
      // estado (promoção, Ads, Full, estoque, pausa) na janela da medida, do motor (marcarEstado): intervencao = campos em que a tarefa é a própria mudança
      estado: { eventos: comDiaRel(m.eventos_estado || [], m.data), intervencao: m.intervencao_estado || [], confundidor: !!m.confundido_estado },
      plano: dadosPl ? { id: ps, regra: pl.regra, indicador_inicial: dadosPl.indicador_inicial, meta: dadosPl.meta, previsto_base: prevPl?.cenarios?.base?.receita ?? null, p_sucesso: prevPl?.p_sucesso ?? null } : null,
      gerou_resultado: gerou,
      leitura: fraseMarco(q.quadro, m),
    }
    card.veredito = vereditoCartao(card)
    return card
  }

  const desde = addDias(hoje, -dias)
  let cartoes = analise.medidas.filter(m => m.itens.length && (tarefaId ? m.id === tarefaId : m.data >= desde)).map(construir)
  // tarefas abertas com anúncio vinculado: só o "antes"
  const conhecidos = new Set(itemRows.keys())
  const abertas = [...tk.values()].filter(t => ehAberta(t) && /mercado/i.test(t.processo || '') && (!tarefaId || t.id === tarefaId))
  const vm = vinculos.vinculosDe(cliente, abertas, conhecidos)
  const emAndamento = []
  for (const t of abertas) {
    const vs = vm.get(t.id) || []
    if (!vs.length) continue
    const ids = vs.map(v => v.item_id), q = construirQuadro({ series, cobPedidos, ids, data: hoje, ultimoCompleto, tocadosPorItem })
    const pDe = addDias(hoje, -14), evP = ids.flatMap(i => (evAnuncio.get(i) || []).filter(e => e.campo === 'preco' && e.dia > pDe && e.dia <= hoje).map(e => ({ item_id: i, ...e })))
    const evE = ids.flatMap(i => (evAnuncio.get(i) || []).filter(e => e.dia > pDe && e.dia <= hoje && ehEstado(e)).map(e => ({ item_id: i, ...e })))
    const card = {
      tarefa: { id: t.id, titulo: (t.titulo || '').split('\n')[0].slice(0, 140), tipo: null, analista: t.responsavel, status: t.status, url: t.url, data: null, data_estimada: false },
      vinculo: { origem: [...new Set(vs.map(v => v.origem))], n_itens: ids.length },
      // o que mudou desde a fotografia do antes, com data (sem isso a tela diria "sem mudança" sem ter comparado)
      itens: ids.slice(0, 3).map(id => { const s = snaps.get(`${t.id}|${id}`) || {}; return { ...cartaoItem(id), antes_fotografia: s.antes ? { capturado_em: s.antes.capturado_em, attrs: s.antes.attrs } : null,
        mudancas: s.antes ? mudancasNoAnuncio(s.antes.attrs, attrsDe(cliente, id), { eventos: evAnuncio.get(id) || [], desde: diaBR(s.antes.capturado_em) }) : null } }), itens_extra: Math.max(0, ids.length - 3),
      quadro: { janela_base: q.quadro.janela_base, base: q.quadro.base, marcos: [], hoje: null }, sinal: { sinal: 'sem_leitura', motivo: 'tarefa ainda não concluída' }, grafico: null,
      medido: { estado: 'em_andamento', rotulo: ROTULO_MEDIDO.em_andamento }, plano: null, gerou_resultado: false,
      // tarefa aberta não tem conclusão: sem dia relativo (a tela diz "em dd/mm", nunca "N dias antes da conclusão")
      precos: { eventos: evP.map(e => ({ ...e, dia_rel: null })), tarefa_de_preco: (cfgAtrib.preco?.familias_preco || []).includes(familiaDeDemanda(t.tipo_demanda).id), confundidor: false, variacao_pct: null, historico: !!iniHist && iniHist <= pDe },
      estado: { eventos: evE.map(e => ({ ...e, dia_rel: null })), intervencao: intervencoesEstado(t.tipo_demanda), confundidor: false },
      leitura: 'Tarefa em andamento: as métricas abaixo são o "antes" (média diária dos últimos 14 dias). Os marcos de 24h, 48h, 72h e 1 semana começam a contar na conclusão.',
    }
    card.veredito = vereditoCartao(card)
    emAndamento.push(card)
  }
  if (!soResultado && !tarefaId) cartoes = cartoes.concat(emAndamento)
  if (tarefaId) cartoes = cartoes.concat(emAndamento)
  if (soResultado) cartoes = cartoes.filter(c => c.gerou_resultado)
  // painel: piorou primeiro (a ordem das famílias do veredito, depois o maior R$ em módulo) — o corte em `limite` nunca deixa os "piorou" de fora.
  // "só o que gerou resultado" (relatório semanal) mantém a ordem de antes: maior ganho primeiro.
  const porData = (a, b) => String(b.tarefa.data || '9999').localeCompare(String(a.tarefa.data || '9999'))
  cartoes.sort(soResultado ? (a, b) => (b.gerou_resultado - a.gerou_resultado) || (b.medido.receita_alocada ?? -1e9) - (a.medido.receita_alocada ?? -1e9) || porData(a, b)
    : (a, b) => ORDEM_FAMILIA.indexOf(a.veredito.familia) - ORDEM_FAMILIA.indexOf(b.veredito.familia) || Math.abs(b.medido.receita_alocada ?? 0) - Math.abs(a.medido.receita_alocada ?? 0) || porData(a, b))
  const semAnuncio = analise.medidas.filter(m => !m.itens.length && m.data >= desde)
  const resultado = cartoes.filter(c => c.gerou_resultado)
  return {
    cliente, hoje, ultimo_dia_completo: ultimoCompleto, dias,
    resumo: { tarefas_com_anuncio: cartoes.length, em_andamento: emAndamento.length, gerou_resultado: resultado.length,
      ganho_associado: r2(resultado.filter(c => c.medido.estado === 'melhorou').reduce((t, c) => t + (c.medido.receita_alocada || 0), 0)),   // só o AJUSTADO por controle
      lancamentos_que_venderam: resultado.filter(c => c.medido.estado === 'lancamento').length, vendas_lancamento: r2(resultado.filter(c => c.medido.estado === 'lancamento').reduce((t, c) => t + (c.medido.receita_alocada || 0), 0)),   // valor BRUTO, sem controle: à parte
      sem_anuncio_identificado: semAnuncio.length,
      perda_associada: r2(cartoes.filter(c => c.medido.estado === 'piorou').reduce((t, c) => t + (c.medido.receita_alocada || 0), 0)),   // ajustada por controle, negativa
      por_familia: Object.fromEntries(ORDEM_FAMILIA.map(f => [f, cartoes.filter(c => c.veredito.familia === f).length])) },
    cartoes: cartoes.slice(0, limite), truncado: cartoes.length > limite,
    sem_anuncio: semAnuncio.slice(0, 20).map(m => ({ id: m.id, titulo: m.titulo, tipo: m.tipo, data: m.data, url: m.url })),
    aviso: 'Antes/depois por marco descreve o que o anúncio fez; só o estado "Melhorou" (ajustado por grupo de controle e ruído) autoriza dizer que a tarefa gerou resultado, e mesmo assim como associação temporal.',
  }
}

// painel "só o que gerou resultado"
export const soResultados = pacote => ({ ...pacote, cartoes: pacote.cartoes.filter(c => c.gerou_resultado) })

// manutenção diária de todos os clientes conectados (depois da coleta): fotografias; falha de um não derruba os outros
export function rodarAcompanhamento({ hoje = hojeLocal(), clientes = null } = {}) {
  const lista = clientes || db.prepare("SELECT DISTINCT cliente FROM meli_serie_item WHERE cliente NOT LIKE '[Comercial] %'").all().map(r => r.cliente)
  const out = []
  for (const c of lista) { try { out.push({ cliente: c, ...capturarAcompanhamento(c, { hoje }) }) } catch (e) { out.push({ cliente: c, erro: String(e.message).slice(0, 120) }) } }
  return out
}

// tarefas de Mercado Livre SEM anúncio identificado + sugestões por semelhança (nunca entram em medição até alguém confirmar)
export function sugestoesDeVinculo(cliente, { hoje = hojeLocal(), dias = 60, limite = 30 } = {}) {
  const itens = db.prepare('SELECT item_id, titulo, thumb, permalink FROM meli_item WHERE cliente = ?').all(cliente)
  const conhecidos = new Set(itens.map(i => i.item_id))
  const ignorar = new Set((cfgAtrib.tipos_ignorados || []).map(x => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()))
  const desde = addDias(hoje, -dias)
  const tarefas = db.prepare("SELECT id, titulo, descricao, conteudo, status, tipo_demanda, data_conclusao, last_edited, url FROM tarefas WHERE cliente = ? AND arquivada = 0 AND processo LIKE '%ercado%' AND status != 'cancelada'").all(cliente)
    .filter(t => !ignorar.has(String(t.tipo_demanda || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()) && (t.status !== 'concluida' || (t.data_conclusao || diaBR(t.last_edited)) >= desde))
  const vm = vinculos.vinculosDe(cliente, tarefas, conhecidos)
  const sem = tarefas.filter(t => !vm.has(t.id))
  const porId = new Map(itens.map(i => [i.item_id, i]))
  const sug = vinculos.sugestoes(cliente, sem, itens.map(i => ({ item_id: i.item_id, titulo: i.titulo })), new Set())
  const compl = x => ({ ...x, thumb: porId.get(x.item_id)?.thumb || '', permalink: porId.get(x.item_id)?.permalink || '' })
  return {
    com_anuncio: tarefas.length - sem.length, sem_anuncio: sem.length,
    sugestoes: sug.slice(0, limite).map(x => x.ambiguo ? { ...x, candidatos: x.candidatos.map(compl) } : compl(x)),
    sem_sugestao: sem.filter(t => !sug.some(x => x.tarefa_id === t.id)).slice(0, 15).map(t => ({ tarefa_id: t.id, titulo: (t.titulo || '').split('\n')[0].slice(0, 120), url: t.url })),
    nota: 'Sem o anúncio identificado não existe antes/depois nem atribuição. Cite o ID MLB no card ou confirme uma sugestão: só vínculo confirmado, citado ou do plano entra na medição.',
  }
}
export const vinculosCliente = vinculos     // confirmar / recusar / remover (lib/vinculos.js)
