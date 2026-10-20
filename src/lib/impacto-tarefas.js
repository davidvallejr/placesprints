// Atribuição TAREFA → RESULTADO (Mercado Livre) e PADRÕES do que melhor funciona.
//
// Método (sempre "associação temporal ajustada", nunca causalidade comprovada):
//  1. Janela ANTES  = N dias antes da conclusão da tarefa; DEPOIS = N dias após a conclusão + lag
//     (o ML leva dias para reindexar título/imagem; o lag varia por tipo de tarefa).
//  2. Efeito = razão DEPOIS/ANTES do alvo ÷ razão DEPOIS/ANTES do GRUPO DE CONTROLE
//     (anúncios da mesma conta que nenhuma tarefa tocou na janela) — diferença-em-diferenças
//     multiplicativa: o que mercado/sazonalidade fez com todo mundo sai da conta.
//  3. RUÍDO: o mesmo efeito calculado em "datas falsas" (placebo) do histórico do próprio alvo.
//     O percentil diz se o efeito observado é maior que as oscilações normais da conta.
//  4. Confiança 0–100 (mesmos pesos do motor causal): temporalidade 25 + corroboração por visitas 25
//     + intensidade 20 + consistência histórica do tipo de tarefa 20 + ausência de explicação
//     concorrente 10. Critério sem dado é DECLARADO e sai da conta (cobertura informada).
//  5. Padrões: taxa de sucesso por tipo/analista/palavra com limite inferior de Wilson (95%) —
//     amostra pequena nunca vira "padrão".
//  6. PREÇO é fator de confusão (config/atribuicao.json → preco): mudança na janela tira ponto da confiança; ≥ limiar em tarefa que não é de
//     preço tira a medida do aprendizado (excluirDaAprendizagem); anúncio que mudou de preço sai do controle e a data vira evento de placebo.
//  7. ESTADO do anúncio (config → estado; promoção, Ads, Full, estoque zerado, pausado) é fator de confusão no mesmo molde: só o evento que CRUZA
//     fronteira na janela conta (estado constante nunca confunde), e nunca quando o campo é a própria intervenção da família da tarefa.
//     modo 'ativo' = controle + placebo + pontos + fora do aprendizado; 'so_confianca' = só pontos; 'observar' = só conta (coincide_estado).
import { db, hojeLocal } from './db.js'
import { normNome } from './equipe.js'
import { playbook } from './plano-cliente.js'
import { CLASSES_CAUSAL } from './motor-ppc.js'
import { cfgAtrib, addDias, diasEntre, coberturaPedidos } from './meli-serie.js'
import { criarVinculos } from './vinculos.js'
import { historico, precoRealizado } from './preco-historico.js'
import { familiaDeDemanda } from './processos.js'
import { nichoDe, ufDe, regiaoDe, SEM_NICHO, SEM_UF } from './dimensoes.js'
import { cruzaFronteira, SEM_PROMOCAO } from './estado-anuncio.js'

const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const vinculos = criarVinculos(db)
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const brl = n => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const comSinal = n => `${n > 0 ? '+' : ''}${String(n).replace('.', ',')}`

// medida que NÃO ensina: tarefa feita num pico (reversão à média), com o preço mexendo junto ou com o anúncio mudando de estado (promoção, Ads,
// Full, estoque, pausa — só no modo 'ativo', que é quando confundido_estado existe). Fica aqui (e não em retroalimentacao.js) para
// melhor-profissional e calibracao usarem sem import circular.
export const excluirDaAprendizagem = m => m.reversao_provavel === true || m.confundido_preco === true || m.confundido_estado === true
const confundida = m => m.confundido_preco === true || m.confundido_estado === true

// mudanças do preço de lista do cliente: todas (eventos: confiança e confundidor) e as ≥ limiar por anúncio (grandes: Map item_id → [dias]) — estas
// tiram o anúncio do controle e viram data de placebo (aqui, na duplicação e nas combinações da retroalimentação)
// ponytail: só o campo preço — o preço riscado (preco_original) acompanha a promoção, que já move o preço
export function precosDoCliente(cliente, params = cfgAtrib) {
  const eventos = historico.eventosAnuncio(cliente, { campos: ['preco'] }), lim = params.preco?.limiar_confundidor_pct ?? 3
  return { eventos, grandes: new Map([...eventos].map(([i, l]) => [i, l.filter(e => Math.abs(e.pct ?? 0) >= lim).map(e => e.dia)]).filter(([, ds]) => ds.length)) }
}
// eventos de ESTADO do cliente (campos de config → estado): todos (eventos) e os que cruzam fronteira por anúncio (fronteira: Map item_id → [dias]).
// Evento sem "de" (fotografia antiga sem o campo) não é mudança: sem leitura anterior não há evento. Em modo 'ativo', fronteira entra junto com
// `grandes` do preço: o anúncio sai do controle e a data vira placebo.
export function estadosDoCliente(cliente, params = cfgAtrib) {
  const campos = params.estado?.campos || []
  const eventos = campos.length ? historico.eventosAnuncio(cliente, { campos }) : new Map()
  return { eventos, fronteira: new Map([...eventos].map(([i, l]) => [i, l.filter(eventoDeEstado).map(e => e.dia)]).filter(([, ds]) => ds.length)) }
}
const eventoDeEstado = e => String(e.de ?? '') !== '' && cruzaFronteira(e)
const juntarDatas = (a, b) => { const m = new Map(a); for (const [i, ds] of b) m.set(i, [...(m.get(i) || []), ...ds]); return m }
// campos de estado em que a família da tarefa É a intervenção (promoção numa oferta relâmpago, Ads numa tarefa de Ads…): mudar ali é a tarefa
export const intervencoesEstado = (tipo, params = cfgAtrib) => { const fam = familiaDeDemanda(tipo).id; return Object.entries(params.estado?.intervencao || {}).filter(([, fams]) => (fams || []).includes(fam)).map(([c]) => c) }

// ── utilitários de série ({dia: valor}) ─────────────────────────────────────
export const somaJanela = (s, de, ate) => { let t = 0; for (let d = de; d <= ate; d = addDias(d, 1)) t += s[d] || 0; return t }
const diarios = (s, de, ate) => { const a = []; for (let d = de; d <= ate; d = addDias(d, 1)) a.push(s[d] || 0); return a }
const media = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
const variancia = a => { if (a.length < 2) return 0; const m = media(a); return a.reduce((t, x) => t + (x - m) ** 2, 0) / (a.length - 1) }

export function somarSeries(lista) {              // lista de {dia: valor} → {dia: soma}
  const out = {}
  for (const s of lista) for (const [d, v] of Object.entries(s)) out[d] = (out[d] || 0) + v
  return out
}

// ── núcleo puro: efeito de UMA tarefa sobre um alvo (com controle e placebo) ──
// alvo/controle: { unidades: {dia:n}, receita: {dia:n}, visitas: {dia:n}|null }
// Métrica primária: UNIDADES quando o anúncio vende o bastante; senão VISITAS (otimização de título/imagem
// mexe primeiro nas visitas — anúncio pequeno quase não tem venda para medir, mas tem visita).
export function medirEfeito({ alvo, controle, data, N, lag, cobertura, hoje, escopo = 'anuncios', eventosPlacebo = [], params = cfgAtrib }) {
  const preDe = addDias(data, -N), preAte = addDias(data, -1)
  const posDe = addDias(data, lag + 1), posAteFull = addDias(data, lag + N)
  const ultimoDiaCompleto = cobertura?.ate && cobertura.ate < addDias(hoje, -1) ? cobertura.ate : addDias(hoje, -1)
  const posAte = posAteFull > ultimoDiaCompleto ? ultimoDiaCompleto : posAteFull
  const diasPos = diasEntre(posDe, posAte) + 1
  const base = { janelas: { pre: [preDe, preAte], pos: [posDe, posAteFull] } }

  if (!cobertura?.de || preDe < cobertura.de) return { ...base, estado: 'sem_base', causa: 'cobertura', motivo: `histórico de pedidos coletado só a partir de ${cobertura?.de || '—'} — a janela anterior começaria em ${preDe}` }
  if (diasPos < 5) return { ...base, estado: 'em_maturacao', motivo: `só ${Math.max(diasPos, 0)} dia(s) após a conclusão (+${lag} de defasagem) — mínimo de 5 para medir` }

  const MIN = { unidades: [params.min_unidades_base, params.min_unidades_controle], visitas: [params.min_visitas_base, params.min_visitas_controle] }
  const pre = c => alvo[c] ? somaJanela(alvo[c], preDe, preAte) : 0
  const ctrlOk = c => !!controle?.[c] && somaJanela(controle[c], preDe, preAte) >= MIN[c][1]
  const candidatos = ['unidades', 'visitas'].filter(c => alvo[c] && pre(c) >= MIN[c][0])
  const campo = candidatos.find(ctrlOk) || candidatos[0]
  const dormente = pre('unidades') <= 1 && (!alvo.visitas || pre('visitas') <= params.max_visitas_dormente_por_dia * N)
  if (!campo && dormente) {
    const completaL = posAte === posAteFull
    const uP = somaJanela(alvo.unidades, posDe, posAte), rP = somaJanela(alvo.receita, posDe, posAte), vP = alvo.visitas ? somaJanela(alvo.visitas, posDe, posAte) : null
    let primeira = null
    for (let d = posDe; d <= posAte; d = addDias(d, 1)) if ((alvo.unidades[d] || 0) > 0) { primeira = diasEntre(data, d); break }
    return {
      ...base, estado: completaL ? 'lancamento' : 'em_maturacao', janelas: { pre: [preDe, preAte], pos: [posDe, posAteFull], pos_medida: [posDe, posAte] }, dias_pos: diasPos,
      metricas: { unidades: { antes: r2(pre('unidades') / N), depois: r2(uP / diasPos) }, receita: { antes: 0, depois: r2(rP / diasPos) }, ...(vP != null ? { visitas: { antes: r2(pre('visitas') / N), depois: r2(vP / diasPos) } } : {}) },
      lancamento: { unidades: uP, receita: r2(rP), visitas: vP, vendeu: uP > 0, primeira_venda_dias: primeira },
      receita_incremental: r2(rP), unidades_incrementais: uP, bruta: true,
    }
  }
  if (!campo) return { ...base, estado: 'sem_base', causa: 'unidades', motivo: `só ${pre('unidades')} unidade(s)${alvo.visitas ? ` e ${pre('visitas')} visita(s)` : ''} na janela anterior (mínimos ${MIN.unidades[0]} e ${MIN.visitas[0]}) — razão instável` }

  const metricas = {}
  for (const m of ['unidades', 'receita', 'visitas']) {
    if (!alvo[m]) continue
    const antes = somaJanela(alvo[m], preDe, preAte) / N, depois = somaJanela(alvo[m], posDe, posAte) / diasPos
    metricas[m] = { antes: r2(antes), depois: r2(depois), razao: antes > 0 ? depois / antes : null }
  }
  const vPre = alvo.visitas ? somaJanela(alvo.visitas, preDe, preAte) : 0, vPos = alvo.visitas ? somaJanela(alvo.visitas, posDe, posAte) : 0
  const uPre = somaJanela(alvo.unidades, preDe, preAte), uPos = somaJanela(alvo.unidades, posDe, posAte)
  if (vPre > 0 && vPos > 0) metricas.conversao = { antes: r2(100 * uPre / vPre), depois: r2(100 * uPos / vPos) }
  // preço pago (receita ÷ unidades, só dias com venda) antes × depois = o ticket por unidade do alvo
  const pAntes = precoRealizado(alvo, preDe, preAte), pDepois = precoRealizado(alvo, posDe, posAte)
  if (pAntes && pDepois) metricas.ticket = { antes: pAntes, depois: pDepois, razao: pDepois / pAntes }

  let comControle = ctrlOk(campo)
  const razaoDe = (serie, de, ate, dias, preDe2, preAte2) => (somaJanela(serie, de, ate) / dias) / (somaJanela(serie, preDe2, preAte2) / N)
  let razaoControle = comControle ? razaoDe(controle[campo], posDe, posAte, diasPos, preDe, preAte) : null
  if (razaoControle != null && !(razaoControle >= 0.1)) { comControle = false; razaoControle = null }   // controle que "sumiu" não serve de referência
  const efeitoPct = (rT, rC) => rT == null ? null : ((rC ? rT / rC : rT) - 1) * 100
  const efeito = efeitoPct(metricas[campo].razao, razaoControle)
  const efeitoBruto = (metricas[campo].razao - 1) * 100

  // corroboração: o indicador "vizinho" se moveu na mesma direção? (visitas p/ unidades; unidades p/ visitas)
  const outro = campo === 'unidades' ? 'visitas' : 'unidades'
  let corrobora = null
  if (metricas[outro]?.razao != null) {
    const cOutro = controle?.[outro] && somaJanela(controle[outro], preDe, preAte) > 0 ? razaoDe(controle[outro], posDe, posAte, diasPos, preDe, preAte) : null
    corrobora = { campo: outro, pct: r1(efeitoPct(metricas[outro].razao, cOutro)), base: somaJanela(alvo[outro], preDe, preAte) }
  }

  // sinal: z do PRÓPRIO efeito ajustado (log da razão de razões ÷ erro-padrão de contagens com correção de superdispersão).
  // Direcional por construção (z tem o sinal do efeito) e usa o controle — não é o teste bruto do alvo.
  const aPre = diarios(alvo[campo], preDe, preAte)
  const sPreT = somaJanela(alvo[campo], preDe, preAte), sPosT = somaJanela(alvo[campo], posDe, posAte)
  const sPreC = comControle ? somaJanela(controle[campo], preDe, preAte) : 0, sPosC = comControle ? somaJanela(controle[campo], posDe, posAte) : 0
  const phi = Math.max(1, variancia(aPre) / (media(aPre) || 1))
  const seLog = Math.sqrt(phi * (1 / Math.max(sPreT, 1) + 1 / Math.max(sPosT, 1) + (comControle ? 1 / Math.max(sPreC, 1) + 1 / Math.max(sPosC, 1) : 0)))
  const razaoEfetiva = metricas[campo].razao / (razaoControle ?? 1)
  const lnRef = Math.log(Math.max(razaoEfetiva, 0.01))
  const z = seLog > 0 ? lnRef / seLog : null

  // ruído: o mesmo efeito (escala log, simétrica para altas e quedas) em datas falsas do histórico do alvo
  const placebos = []
  const ateHist = addDias(ultimoDiaCompleto, -(lag + N))
  for (let f = addDias(cobertura.de, N); f <= ateHist; f = addDias(f, 7)) {
    if (eventosPlacebo.some(e => Math.abs(diasEntre(e, f)) <= N + lag)) continue
    const fp = [addDias(f, -N), addDias(f, -1)], fq = [addDias(f, lag + 1), addDias(f, lag + N)]
    const pu = somaJanela(alvo[campo], fp[0], fp[1])
    if (pu < MIN[campo][0]) continue
    const rT = (somaJanela(alvo[campo], fq[0], fq[1]) / N) / (pu / N)
    let rC = null
    if (comControle) { const cp = somaJanela(controle[campo], fp[0], fp[1]); if (cp < MIN[campo][1]) continue; rC = (somaJanela(controle[campo], fq[0], fq[1]) / N) / (cp / N); if (!(rC >= 0.1)) continue }
    placebos.push(Math.abs(Math.log(Math.max(rC ? rT / rC : rT, 0.01))))
  }
  // p empírico com correção +1: (1 + nº de placebos ao menos tão extremos) ÷ (n + 1) — nunca "100% maior que o ruído"
  const pPlacebo = placebos.length >= params.min_placebos ? (1 + placebos.filter(p => p >= Math.abs(lnRef)).length) / (placebos.length + 1) : null
  const pctRuido = pPlacebo == null ? null : Math.round(100 * (1 - pPlacebo))

  // tendência já em curso antes da tarefa (metades de tamanho igual; o dia do meio, se N ímpar, fica de fora)
  const h = Math.floor(N / 2)
  const h1 = somaJanela(alvo[campo], preDe, addDias(preDe, h - 1)), h2 = somaJanela(alvo[campo], addDias(preAte, -(h - 1)), preAte)
  const tendenciaPre = h1 > 0 ? (h2 / h1 - 1) * 100 : null
  // regressão à média: a janela anterior está longe do nível do próprio anúncio nas semanas ANTERIORES a ela?
  const bDe = addDias(preDe, -params.base_longa_dias) < cobertura.de ? cobertura.de : addDias(preDe, -params.base_longa_dias), bAte = addDias(preDe, -1)
  const diasBase = bAte >= bDe ? diasEntre(bDe, bAte) + 1 : 0
  const baseLonga = diasBase >= 21 ? somaJanela(alvo[campo], bDe, bAte) / diasBase : null
  const nivelPre = baseLonga > 0 ? (pre(campo) / N / baseLonga - 1) * 100 : null
  const reversaoProvavel = nivelPre != null && Math.abs(nivelPre) >= params.limiar_reversao_pct && Math.sign(nivelPre) === -Math.sign(efeito)

  const completa = posAte === posAteFull
  const sinal = pPlacebo != null ? pPlacebo <= params.p_max_placebo : (z != null && Math.abs(z) >= params.z_forte)
  let estado
  if (!completa) estado = 'em_maturacao'
  else if (!comControle) estado = escopo === 'conta' ? 'variacao_conta' : 'sem_controle'   // sem controle o mercado se confunde com a tarefa
  else if (efeito >= params.limiar_efeito_pct && sinal) estado = 'melhorou'
  else if (efeito <= -params.limiar_efeito_pct && sinal) estado = 'piorou'
  else estado = 'sem_efeito'

  // POTENCIAL ESTIMADO (nunca receita garantida): unidades/receita associadas ao efeito, dias medidos
  const rCuso = razaoControle ?? 1
  const preco = uPre > 0 ? somaJanela(alvo.receita, preDe, preAte) / uPre : (uPos > 0 ? somaJanela(alvo.receita, posDe, posAte) / uPos : 0)
  let unidadesInc, receitaInc
  if (campo === 'unidades') { unidadesInc = r1(metricas.unidades.antes * (metricas.unidades.razao - rCuso) * diasPos); receitaInc = r2(unidadesInc * preco) }
  else {                                                   // via visitas: converte com a conversão e o preço do PRÓPRIO anúncio; sem venda anterior = não estima
    const visInc = metricas.visitas.antes * (metricas.visitas.razao - rCuso) * diasPos
    const conv = vPre > 0 ? uPre / vPre : 0
    unidadesInc = conv > 0 ? r1(visInc * conv) : null
    receitaInc = unidadesInc != null && preco > 0 ? r2(unidadesInc * preco) : null
  }
  return {
    ...base, estado, metrica_primaria: campo, janelas: { pre: [preDe, preAte], pos: [posDe, posAteFull], pos_medida: [posDe, posAte] }, dias_pos: diasPos,
    metricas, efeito_pct: r1(efeito), efeito_bruto_pct: r1(efeitoBruto), corrobora,
    controle: comControle ? { razao: r2(razaoControle), base: r1(somaJanela(controle[campo], preDe, preAte)) } : null,
    sinal_z: z == null ? null : r2(z), pct_ruido: pctRuido, p_placebo: pPlacebo == null ? null : r2(pPlacebo), n_placebos: placebos.length, tendencia_pre_pct: tendenciaPre == null ? null : r1(tendenciaPre),
    nivel_pre_vs_base_pct: nivelPre == null ? null : r1(nivelPre), reversao_provavel: reversaoProvavel, receita_estimavel: receitaInc != null,
    unidades_incrementais: unidadesInc, receita_incremental: receitaInc, preco_ref: r2(preco),
    // unidades de cada janela vão junto: a variação do preço pago só vale como confundidor com o mínimo de vendas nas duas
    preco_realizado: { antes: pAntes, depois: pDepois, variacao_pct: pAntes && pDepois ? r1((pDepois / pAntes - 1) * 100) : null, unidades: { antes: uPre, depois: uPos } },
  }
}

// preço pago de UM anúncio antes × depois (o formato de medirEfeito.preco_realizado), para o confundidor por anúncio
const realizadoDe = (s, pd, pa, qd, qa) => {
  if (!s) return null
  const a = precoRealizado(s, pd, pa), b = precoRealizado(s, qd, qa)
  return { antes: a, depois: b, variacao_pct: a && b ? r1((b / a - 1) * 100) : null, unidades: { antes: somaJanela(s.unidades, pd, pa), depois: somaJanela(s.unidades, qd, qa) } }
}

// preço como FATOR DE CONFUSÃO (puro): eventos de preço de lista do alvo dentro da janela da medida, se a tarefa é a própria intervenção de preço
// e se a medida está confundida — tarefa que não é de preço com |Δ| ≥ limiar no preço pago (mínimo de unidades nas duas janelas) ou num evento de lista.
// eventos: Map item_id → [{ dia, de, para, pct, fonte, incerteza? }] (historico.eventosAnuncio, campo preço).
// realizados: preço pago de CADA anúncio do alvo (o do alvo somado mistura o mix de vendas entre anúncios de preços diferentes: vender mais do
// barato não é "preço mudou"); vale a maior variação com o mínimo de unidades nas duas janelas. intervencao: o job de Ofertas que publicou preço.
export function marcarPreco(m, { tipo, itens = [], eventos = new Map(), realizados = [m.preco_realizado], intervencao: doJob = false, params = cfgAtrib } = {}) {
  const P = params.preco || {}, lim = P.limiar_confundidor_pct ?? 3
  const intervencao = doJob === true || (P.familias_preco || []).includes(familiaDeDemanda(tipo).id)
  const [de, ate] = [m.janelas?.pre?.[0], m.janelas?.pos?.[1]]
  // evento no 1º dia da janela anterior já vale para as duas janelas inteiras: não confunde
  const evs = de ? itens.flatMap(i => (eventos.get(i) || []).filter(e => e.dia > de && e.dia <= ate).map(e => ({ item_id: i, ...e }))) : []
  const minU = params.min_unidades_base
  const realizado = realizados.filter(pr => pr?.variacao_pct != null && pr.unidades.antes >= minU && pr.unidades.depois >= minU && Math.abs(pr.variacao_pct) >= lim)
    .sort((a, b) => Math.abs(b.variacao_pct) - Math.abs(a.variacao_pct))[0]?.variacao_pct ?? null
  const lista = evs.filter(e => Math.abs(e.pct ?? 0) >= lim).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0]?.pct ?? null
  // só confunde uma COMPARAÇÃO antes × depois (lançamento e sem base não têm razão para contaminar)
  const confundido = !!m.metrica_primaria && !intervencao && (realizado != null || lista != null)
  return { eventos_preco: evs, intervencao_preco: intervencao, confundido_preco: confundido, variacao_preco_pct: confundido ? realizado ?? lista : null }
}

// ESTADO como FATOR DE CONFUSÃO (puro, gêmeo de marcarPreco): eventos de estado do alvo dentro da janela que cruzam fronteira (estado-anuncio.js).
// eventos: Map item_id → [{ dia, campo, de, para, … }] (historico.eventosAnuncio, campos de config → estado). eventos_estado traz TODOS (a tela
// mostra "a própria tarefa" nos campos de intervencao_estado); campos_estado e o confundidor só contam os que NÃO são a intervenção da família.
// coincide_estado = há evento que confunde numa comparação antes × depois; confundido_estado = coincide E modo 'ativo' (é o que tira do aprendizado).
export function marcarEstado(m, { tipo, itens = [], eventos = new Map(), params = cfgAtrib } = {}) {
  const E = params.estado || {}, modo = E.modo || 'ativo', intervencao = intervencoesEstado(tipo, params)
  const [de, ate] = [m.janelas?.pre?.[0], m.janelas?.pos?.[1]]
  const evs = de ? itens.flatMap(i => (eventos.get(i) || []).filter(e => e.dia > de && e.dia <= ate && eventoDeEstado(e)).map(e => ({ item_id: i, ...e }))) : []
  const campos = [...new Set(evs.filter(e => !intervencao.includes(e.campo)).map(e => e.campo))]
  const coincide = !!m.metrica_primaria && campos.length > 0
  return { eventos_estado: evs, intervencao_estado: intervencao, campos_estado: campos, coincide_estado: coincide, confundido_estado: coincide && modo === 'ativo' }
}
// frase de um evento de estado ("entrou em promoção SMART −15%", "Ads desligado", "foi para o Full", "estoque zerou", "anúncio pausado");
// detalhe=false omite o tipo/desconto da promoção (cartão curto)
const ROT_STATUS = { paused: 'pausado', closed: 'encerrado', under_review: 'em revisão', inactive: 'inativo' }
export function fraseEstado(e, detalhe = true) {
  const de = String(e.de ?? ''), para = String(e.para ?? '')
  switch (e.campo) {
    case 'promocao': return de === SEM_PROMOCAO ? `entrou em promoção${detalhe ? ' ' + para : ''}` : para === SEM_PROMOCAO ? `saiu da promoção${detalhe ? ' ' + de : ''}` : `promoção mudou${detalhe ? ` de ${de} para ${para}` : ''}`
    case 'ads': return para === 'active' ? 'Ads ligado' : de === 'active' ? 'Ads desligado' : 'Ads mudou'
    case 'logistica': return para === 'fulfillment' ? 'foi para o Full' : 'saiu do Full'
    case 'estoque_zero': return Number(para) > 0 ? 'estoque voltou' : 'estoque zerou'
    case 'status': return para === 'active' ? 'anúncio reativado' : `anúncio ${ROT_STATUS[para] || para}`
    default: return `${e.campo} mudou`
  }
}

// ── confiança (reaproveita os pesos e as classes do motor causal) ───────────
export function confiancaEfeito({ m, dataEstimada, concorrentes, eventos, taxaHistorica, params = cfgAtrib }) {
  const crit = {}
  // temporalidade 25: o efeito pode ser CONTINUAÇÃO de tendência (alta antes de uma melhora; queda antes de uma piora) ou REVERSÃO à média
  const dir = Math.sign(m.efeito_pct)
  const jaEmCurso = m.tendencia_pre_pct != null && ((dir > 0 && m.tendencia_pre_pct > 20) || (dir < 0 && m.tendencia_pre_pct < -20))
  let temp = 25
  if (jaEmCurso) temp = 10
  if (m.reversao_provavel) temp = Math.min(temp, 10)
  if (dataEstimada) temp = Math.min(temp, 12)
  crit.temporalidade = { nota: temp, de: 25, base: dataEstimada ? 'data de conclusão ESTIMADA (campo "Concluído em" vazio)' : m.reversao_provavel ? `a janela anterior estava ${Math.abs(m.nivel_pre_vs_base_pct)}% ${m.nivel_pre_vs_base_pct < 0 ? 'abaixo' : 'acima'} do nível habitual do anúncio — pode ser reversão à média` : jaEmCurso ? 'a tendência já vinha na mesma direção antes da tarefa' : 'sem tendência prévia na mesma direção' }
  // correlação 25: o indicador vizinho (visitas ↔ unidades) se moveu na mesma direção — com base mínima para valer
  const baseMin = m.corrobora?.campo === 'unidades' ? cfgAtrib.min_unidades_base : cfgAtrib.min_visitas_base
  if (!m.corrobora || m.corrobora.pct == null || (m.corrobora.base ?? 0) < baseMin) crit.correlacao = { nota: null, de: 25, base: 'sem o indicador vizinho com volume suficiente para corroborar' }
  else {
    const p = m.corrobora.pct, c = m.corrobora.campo
    if (Math.sign(p) === Math.sign(m.efeito_pct) && Math.abs(p) >= 3) crit.correlacao = { nota: 25, de: 25, base: `${c} ${p >= 0 ? '+' : ''}${p}% na mesma direção` }
    else if (Math.abs(p) < 3) crit.correlacao = { nota: 8, de: 25, base: `${c} praticamente parado (${p}%) — não corrobora nem contradiz` }
    else crit.correlacao = { nota: 0, de: 25, base: `${c} ${p}% na direção OPOSTA` }
  }
  // intensidade 20: tamanho do efeito frente ao ruído normal da própria conta
  if (m.pct_ruido != null) crit.intensidade = { nota: m.pct_ruido >= 95 ? 20 : m.pct_ruido >= 90 ? 16 : m.pct_ruido >= 80 ? 12 : m.pct_ruido >= 60 ? 6 : 0, de: 20, base: `p = ${m.p_placebo} contra ${m.n_placebos} janelas de comparação (efeito maior que ${m.pct_ruido}% das oscilações normais)` }
  else { const a = Math.abs(m.sinal_z ?? 0); crit.intensidade = { nota: a >= 2.58 ? 16 : a >= 1.96 ? 12 : a >= 1.28 ? 6 : 0, de: 20, base: `janelas de ruído insuficientes (${m.n_placebos}); usa o z do próprio efeito ajustado: z=${m.sinal_z ?? '—'} (teto menor que o do placebo)` } }
  // consistência histórica 20: taxa de sucesso do mesmo tipo nas OUTRAS tarefas (leave-one-out)
  crit.consistencia = taxaHistorica == null
    ? { nota: null, de: 20, base: `menos de ${cfgAtrib.min_n_padrao} outras tarefas desse tipo medidas` }
    : { nota: taxaHistorica >= 0.6 ? 20 : taxaHistorica >= 0.4 ? 12 : 5, de: 20, base: `${Math.round(taxaHistorica * 100)}% das outras tarefas desse tipo tiveram o mesmo resultado (${m.estado === 'piorou' ? 'pioraram' : 'melhoraram'})` }
  // ausência de explicação concorrente 10: outras tarefas na janela, eventos sazonais, falta de controle
  let conc = concorrentes === 0 ? 10 : concorrentes === 1 ? 6 : 2
  // preço: qualquer mudança (até 1 centavo) faz o ML reentregar o anúncio → −1; confundida (≥ limiar, tarefa que não é de preço) → −4. Na tarefa de preço a mudança É a tarefa.
  const evP = m.intervencao_preco ? [] : (m.eventos_preco || [])
  const ev0 = [...evP].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0))[0]
  // estado (promoção, Ads, Full, estoque, pausa): −pontos_por_campo por campo que mudou na janela, com cada evento escrito; a intervenção da própria
  // família não entra; em modo 'observar' nada muda na nota
  const E = params.estado || {}, observar = (E.modo || 'ativo') === 'observar'
  const evE = observar ? [] : (m.eventos_estado || []).filter(e => !(m.intervencao_estado || []).includes(e.campo))
  const camposE = observar ? [] : (m.campos_estado || [])
  const motivos = [concorrentes ? `${concorrentes} outra(s) tarefa(s) no mesmo alvo e período` : null, eventos.length ? `data comercial na janela (${eventos.join(', ')})` : null, !m.controle ? 'sem grupo de controle' : null,
    ev0 ? `preço mudou R$ ${brl(ev0.de)} → R$ ${ev0.para == null ? '—' : brl(ev0.para)} ${ev0.incerteza ? `(${ev0.incerteza})` : 'em ' + dm(ev0.dia)}${evP.length > 1 ? ` (+${evP.length - 1} outra(s) mudança(s))` : ''}` : null,
    m.confundido_preco ? `preço variou ${comSinal(m.variacao_preco_pct)}% na janela: o efeito pode ser do preço, não da tarefa` : null,
    evE.length ? `${evE.map(e => `${fraseEstado(e)} ${e.incerteza ? `(${e.incerteza})` : 'em ' + dm(e.dia)}`).join('; ')}: o efeito pode ser ${evE.length > 1 ? 'desses eventos' : 'desse evento'}, não da tarefa` : null].filter(Boolean)
  if (eventos.length) conc = Math.max(0, conc - 3)
  if (!m.controle) conc = Math.max(0, conc - 3)
  if (ev0) conc = Math.max(0, conc - 1)
  if (m.confundido_preco) conc = Math.max(0, conc - 4)
  if (camposE.length) conc = Math.max(0, conc - (E.pontos_por_campo ?? 3) * camposE.length)
  crit.sem_concorrente = { nota: conc, de: 10, base: motivos.join('; ') || 'nenhuma outra explicação identificável nos dados' }

  let soma = 0, peso = 0
  for (const c of Object.values(crit)) if (c.nota != null) { soma += c.nota; peso += c.de }
  const score = peso ? Math.round(100 * soma / peso) : null
  let classe = score == null ? 'sem dados' : CLASSES_CAUSAL.find(([lim]) => score >= lim)[1]
  let scoreFinal = score
  if (peso < 80 && classe === 'forte evidência causal') { classe = 'causa provável'; scoreFinal = Math.min(score, 79) }   // sem cobertura não há "forte evidência" nem nota ≥ 80
  if (confundida(m) && scoreFinal >= 60) { classe = 'hipótese possível'; scoreFinal = 59 }   // o preço (ou o estado) mexeu junto: a medida sai do aprendizado e não pode se dizer "causa provável"
  return { score: scoreFinal, classe, cobertura: peso, criterios: crit, nota: 'Associação temporal ajustada por controle e ruído — não é causalidade comprovada.' }
}

// ── estatística dos padrões ─────────────────────────────────────────────────
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, baixo: null, alto: null }
  const p = k / n, d = 1 + z * z / n
  const c = p + z * z / (2 * n), m = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)
  return { p, baixo: (c - m) / d, alto: (c + m) / d }
}
const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }
const STOP = new Set('para como mais pela pelo dos das uma uns com sem por que anuncio anuncios produto produtos teste focando foco'.split(' '))
export const palavras = t => [...new Set(normNome(t).split(' ').filter(w => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)))]

export function padroesLancamento(medidas, minN = cfgAtrib.min_n_padrao) {
  const ls = medidas.filter(m => m.estado === 'lancamento')
  const grupo = chaveFn => {
    const g = new Map()
    for (const m of ls) { const k = chaveFn(m); if (k) (g.get(k) || g.set(k, []).get(k)).push(m) }
    return [...g.entries()].map(([chave, ms]) => {
      const k = ms.filter(x => x.lancamento.vendeu).length, w = wilson(k, ms.length)
      return { chave, n: ms.length, venderam: k, taxa: w.p, taxa_baixo: w.baixo, taxa_alto: w.alto,
        receita: r2(ms.reduce((t, x) => t + (x.receita_alocada || 0), 0)),
        visitas_dia_mediana: mediana(ms.map(x => x.metricas.visitas?.depois).filter(Number.isFinite)),
        dias_ate_primeira_venda: mediana(ms.map(x => x.lancamento.primeira_venda_dias).filter(Number.isFinite)),
        amostra_pequena: ms.length < minN }
    }).sort((a, b) => (b.taxa_baixo ?? -1) - (a.taxa_baixo ?? -1) || b.n - a.n)
  }
  return { n: ls.length, por_tipo: grupo(m => m.tipo), por_analista: grupo(m => analistasDe(m.analista)), por_subtipo: grupo(m => m.subtipo) }
}

const ESTADOS_PADRAO = ['melhorou', 'piorou', 'sem_efeito']
// um grupo por chave (chaveFn devolve uma chave ou uma lista); a confundida (preço ou estado) não entra no padrão, só é contada no grupo (que tem
// medida válida) — uma medida confundida pelos dois conta nos dois contadores; `confundidas` é a união (o drill abre n + confundidas)
function agrupar(validas, confundidas, chaveFn, minN) {
  const g = new Map(), nc = new Map(), ne = new Map(), nu = new Map()
  for (const m of validas) for (const k of [].concat(chaveFn(m))) { if (!k) continue; (g.get(k) || g.set(k, []).get(k)).push(m) }
  for (const m of confundidas) for (const k of [].concat(chaveFn(m))) if (k) { nu.set(k, (nu.get(k) || 0) + 1); if (m.confundido_preco) nc.set(k, (nc.get(k) || 0) + 1); if (m.confundido_estado) ne.set(k, (ne.get(k) || 0) + 1) }
  return [...g.entries()].map(([chave, ms]) => {
    const k = ms.filter(x => x.estado === 'melhorou').length, w = wilson(k, ms.length)
    return {
      chave, n: ms.length, melhorou: k, piorou: ms.filter(x => x.estado === 'piorou').length, sem_efeito: ms.filter(x => x.estado === 'sem_efeito').length,
      taxa: w.p, taxa_baixo: w.baixo, taxa_alto: w.alto, efeito_mediano_pct: mediana(ms.map(x => x.efeito_pct)),
      receita_incremental: r2(ms.reduce((t, x) => t + (x.receita_alocada ?? x.receita_incremental ?? 0), 0)),
      confianca_media: (() => { const sc = ms.map(x => x.confianca?.score).filter(Number.isFinite); return sc.length ? r1(media(sc)) : null })(),
      amostra_pequena: ms.length < minN, confundidas: nu.get(chave) || 0, confundidas_preco: nc.get(chave) || 0, confundidas_estado: ne.get(chave) || 0,
      clientes: new Set(ms.map(x => x.cliente).filter(Boolean)).size,          // 1 = resultado daquele cliente, não do grupo
    }
  }).sort((a, b) => (b.taxa_baixo ?? -1) - (a.taxa_baixo ?? -1) || b.n - a.n)
}
const separar = medidas => { const ok = medidas.filter(m => ESTADOS_PADRAO.includes(m.estado)); return { validas: ok.filter(m => !confundida(m)), confundidas: ok.filter(confundida) } }

export function agruparPadroes(medidas, minN = cfgAtrib.min_n_padrao) {
  const { validas, confundidas } = separar(medidas)
  const grupo = chaveFn => agrupar(validas, confundidas, chaveFn, minN)
  return {
    lancamentos: padroesLancamento(medidas, minN),
    n_medidas: validas.length,
    por_tipo: grupo(m => m.tipo), por_analista: grupo(m => analistasDe(m.analista)),
    por_palavra: grupo(m => palavras(m.titulo)).filter(g => g.n >= minN),
    por_analista_tipo: grupo(m => m.tipo ? analistasDe(m.analista).map(a => `${a} · ${m.tipo}`) : []).filter(g => g.n >= 3),
  }
}

// ── recortes por NICHO e REGIÃO (dimensoes.js): a chave de cada recorte é a mesma no agrupamento e no drill-down de /api/resultados/tarefas ──
export const CHAVES_GRUPO = {
  tipo: m => m.tipo, analista: m => analistasDe(m.analista),
  nicho: m => m.nicho || SEM_NICHO, regiao: m => m.regiao || SEM_UF, uf: m => m.uf || SEM_UF,
  nicho_tipo: m => m.tipo ? `${m.nicho || SEM_NICHO} · ${m.tipo}` : null,
}
export const OUTROS = 'Outros'
// ponytail: um nicho chamado literalmente "Outros" se misturaria com a linha de soma — não existe na central hoje; renomear OUTROS se aparecer
// grupo pequeno (menos de minN medidas válidas) de nicho/região: soma na linha "Outros"
const pequenoDe = (validas, fn, minN) => { const c = new Map(); for (const m of validas) for (const k of [].concat(fn(m))) if (k) c.set(k, (c.get(k) || 0) + 1); return m => [].concat(fn(m)).some(k => k && (c.get(k) || 0) < minN) }
export function agruparDimensoes(medidas, minN = cfgAtrib.min_n_padrao) {
  const { validas, confundidas } = separar(medidas)
  const comOutros = dim => {
    const fn = CHAVES_GRUPO[dim], pequeno = pequenoDe(validas, fn, minN)
    const vP = validas.filter(pequeno), grandes = agrupar(validas.filter(m => !pequeno(m)), confundidas.filter(m => !pequeno(m)), fn, minN)
    if (!vP.length) return grandes
    const [o] = agrupar(vP, confundidas.filter(pequeno), () => OUTROS, minN)
    return [...grandes, { ...o, outros: true, grupos: new Set(vP.flatMap(m => [].concat(fn(m)))).size }]
  }
  // nicho × tipo: só os cruzamentos com amostra (o resto não soma numa linha: "outros × outros" não diz nada)
  return { por_nicho: comOutros('nicho'), por_regiao: comOutros('regiao'), por_nicho_tipo: agrupar(validas, confundidas, CHAVES_GRUPO.nicho_tipo, minN).filter(g => g.n >= minN) }
}
// as medidas (melhorou/piorou/sem efeito, inclusive as confundidas por preço ou estado) de UMA linha das tabelas: a mesma regra de agruparPadroes/agruparDimensoes
export function medidasDoGrupo(medidas, grupo, chave, minN = cfgAtrib.min_n_padrao) {
  const fn = CHAVES_GRUPO[grupo], ok = medidas.filter(m => ESTADOS_PADRAO.includes(m.estado))
  if (chave === OUTROS && (grupo === 'nicho' || grupo === 'regiao')) return ok.filter(pequenoDe(ok.filter(m => !confundida(m)), fn, minN))
  return ok.filter(m => [].concat(fn(m)).includes(chave))
}

// Duas tarefas que melhoraram o mesmo anúncio na mesma época NÃO podem receber o ganho inteiro cada uma:
// em cada dia o ganho diário da tarefa é dividido entre todas as tarefas com efeito que tocam os mesmos anúncios.
export function alocarIncremental(medidas) {
  const efetivas = medidas.filter(m => ['melhorou', 'piorou', 'lancamento'].includes(m.estado) && m.janelas && m.dias_pos)
  for (const m of medidas) m.receita_alocada = 0
  for (const m of efetivas) {
    const porDia = (m.receita_incremental || 0) / m.dias_pos
    const [de, ate] = m.janelas.pos_medida || m.janelas.pos
    let alocado = 0
    for (let d = de; d <= ate; d = addDias(d, 1)) {
      const k = 1 + efetivas.filter(o => o !== m && o.cliente === m.cliente && o.escopo === m.escopo && d >= o.janelas.pos[0] && d <= (o.janelas.pos_medida || o.janelas.pos)[1] && o.itens.some(i => m.itens.includes(i))).length
      alocado += porDia / k
    }
    m.receita_alocada = r2(alocado)
  }
  return medidas
}

// ── execuções do PRÓPRIO sistema (módulo Ofertas): publicação conferida pelo canal vira medida como qualquer tarefa (controle, placebo, lag do tipo) ──
// tipo = demanda Notion da ação do plano que o job executa (família certa); analista = responsável do job; data = publicação confirmada (dia no fuso BR);
// itens = o anúncio publicado (duplicação: original + duplicata = a família). Título leva "· PS-<id>" para a calibração casar previsto × realizado.
export function execucoesOfertas(cliente) {
  // publica_preco: o job mexeu no preço (escopo 'preco' ou a publicação verificada traz o campo preço no diff) — a mudança de preço É a tarefa
  return db.prepare(`SELECT j.id, j.responsavel, j.solicitante, j.publicado_em, j.dados_json, j.escopo, a.anuncio_id item, p.id acao_id, p.titulo, p.dados_json acao_dados, p.notion_page_id, p.notion_url,
      EXISTS (SELECT 1 FROM of_publicacao x, json_each(CASE WHEN json_valid(x.diff_json) THEN CASE WHEN json_type(x.diff_json) = 'array' THEN x.diff_json END END) d
        WHERE x.cliente = j.cliente AND x.job_id = j.id AND x.estado = 'verificada' AND json_extract(d.value, '$.campo') = 'preco') publica_preco
    FROM of_job j JOIN of_anuncio a ON a.id = j.anuncio_id AND a.cliente = j.cliente AND a.canal = 'ML'
    JOIN acoes_plano p ON p.id = j.acao_id AND p.cliente = j.cliente
    WHERE j.cliente = ? AND j.estado IN ('publicado_confirmado', 'monitorando') AND j.publicado_em <> ''
      AND EXISTS (SELECT 1 FROM of_publicacao x WHERE x.cliente = j.cliente AND x.job_id = j.id AND x.estado = 'verificada' AND x.operacao IN ('atualizar', 'criar'))`).all(cliente)
    .map(r => {
      const dj = JSON.parse(r.dados_json || '{}'), da = JSON.parse(r.acao_dados || '{}')
      return { id: 'OF-' + r.id, cliente, titulo: `${String(r.titulo).slice(0, 110)} · ${r.acao_id}`, tipo: da.demanda_notion || '(sem tipo)', analista: String(r.responsavel || r.solicitante || '').trim(), url: r.notion_url || '',
        data: diaBR(r.publicado_em), data_estimada: false, itens: [...new Set([dj.duplicacao?.item_origem, r.item].filter(Boolean))], vinculo_origem: ['ofertas'], fonte: 'ofertas', acao_id: r.acao_id, notion_page_id: r.notion_page_id || '',
        intervencao_preco: r.escopo === 'preco' || r.publica_preco === 1 }
    })
}

// ── análise de um cliente (série do banco + tarefas do Notion) ──────────────
// dia (AAAA-MM-DD) no fuso do Brasil a partir de um instante ISO (UTC) — "last_edited" às 22h não pode virar o dia seguinte
// "Ana, Bruno e Carla" → ['Ana', 'Bruno', 'Carla']; sem responsável → []
export const analistasDe = txt => [...new Map(String(txt || '').split(/[,;/]|\s+e\s+/i).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean).map(x => [normNome(x), x])).values()]
const diaBR = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '' }
// contexto do cliente para medir QUALQUER marco (tarefa concluída, execução de Ofertas ou mudança do anúncio): séries, tarefas, eventos de preço/estado
function contextoCliente(cliente, { hoje = hojeLocal(), params = cfgAtrib } = {}) {
  const cob = coberturaPedidos(cliente)
  const itens = db.prepare('SELECT item_id, vis_de, vis_ate FROM meli_item WHERE cliente = ?').all(cliente)
  const conhecidos = new Set(itens.map(i => i.item_id))
  const vis = new Map(itens.map(i => [i.item_id, i]))
  const rows = db.prepare('SELECT item_id, dia, unidades, receita, visitas FROM meli_serie_item WHERE cliente = ?').all(cliente)
  const porItem = new Map()
  for (const r of rows) {
    const o = porItem.get(r.item_id) || { unidades: {}, receita: {}, visitas: {} }
    if (r.unidades) { o.unidades[r.dia] = r.unidades; o.receita[r.dia] = r.receita }
    if (r.visitas) o.visitas[r.dia] = r.visitas
    porItem.set(r.item_id, o)
  }
  // execuções do próprio sistema (Ofertas) entram como medida; o card do Notion da MESMA ação conta uma vez só (fica a execução, que tem a data exata da publicação)
  const ofertas = execucoesOfertas(cliente)
  const cardsDaOferta = new Set(ofertas.map(o => o.notion_page_id).filter(Boolean)), sufixos = ofertas.map(o => `· ${o.acao_id}`)
  const todas = db.prepare("SELECT id, titulo, descricao, conteudo, processo, responsavel, tipo_demanda, data_conclusao, last_edited, url FROM tarefas WHERE cliente = ? AND arquivada = 0 AND status = 'concluida'").all(cliente)
  const tarefas = todas.filter(t => !cardsDaOferta.has(t.id) && !sufixos.some(s => String(t.titulo || '').includes(s)))
  const vmap = vinculos.vinculosDe(cliente, tarefas, conhecidos)           // citado (MLB no card) + plano + confirmado; 'sugerido' nunca
  const ignorar = new Set((params.tipos_ignorados || []).map(normNome))
  const nao = { por_canal: {}, ignoradas: 0, cards_contados_pela_oferta: todas.length - tarefas.length }
  const lista = []
  for (const t of tarefas) {
    const tipo = (t.tipo_demanda || '').trim() || '(sem tipo)'
    if (ignorar.has(normNome(tipo))) { nao.ignoradas++; continue }
    if (!/mercado/i.test(t.processo || '')) { nao.por_canal[t.processo || '(sem canal)'] = (nao.por_canal[t.processo || '(sem canal)'] || 0) + 1; continue }
    const data = t.data_conclusao || diaBR(t.last_edited)
    if (!data) { nao.sem_data = (nao.sem_data || 0) + 1; continue }
    lista.push({
      id: t.id, cliente, titulo: (t.titulo || '').split('\n')[0].slice(0, 140), tipo, analista: (t.responsavel || '').trim(), url: t.url, data,
      data_estimada: !t.data_conclusao, itens: (vmap.get(t.id) || []).map(x => x.item_id), vinculo_origem: [...new Set((vmap.get(t.id) || []).map(x => x.origem))],
    })
  }
  lista.push(...ofertas)
  const N = params.janela_dias
  const lagDe = tipo => params.lag_dias_por_tipo?.[tipo] ?? params.lag_dias_padrao
  const eventosCal = (playbook.calendario || []).map(e => ({ nome: e.nome, data: e.data }))
  // histórico de preço de lista (uma leitura por dia): mudança ≥ limiar tira o anúncio do controle e a data dos placebos; o estado (promoção, Ads,
  // Full, estoque, pausa) que cruza fronteira faz o mesmo em modo 'ativo' — as datas entram no mesmo mapa `grandes`
  const { eventos: evPreco, grandes: grandesPreco } = precosDoCliente(cliente, params)
  const { eventos: evEstado, fronteira } = estadosDoCliente(cliente, params)
  const grandes = (params.estado?.modo || 'ativo') === 'ativo' ? juntarDatas(grandesPreco, fronteira) : grandesPreco
  return { cliente, hoje, params, cob, porItem, vis, lista, nao, N, lagDe, eventosCal, evPreco, evEstado, grandes }
}
// medida de UM marco t ({ tipo, data, itens, data_estimada, intervencao_preco }) no contexto: janela adaptativa, controle, placebo, preço e estado como confundidores.
// t pode estar fora de ctx.lista (marco de snapshot): a própria data entra nos placebos e as tarefas da lista continuam contando como concorrentes/tocadas.
function medirMarcoNoContexto(ctx, t) {
  const { cliente, hoje, params, cob, porItem, vis, lista, N, lagDe, eventosCal, evPreco, evEstado, grandes } = ctx
  const lag = lagDe(t.tipo), escopo = t.itens.length ? 'anuncios' : 'conta'
  const idsAlvo = escopo === 'anuncios' ? t.itens : [...porItem.keys()]
  const montar = (ids, comVis) => ({ unidades: somarSeries(ids.map(i => porItem.get(i)?.unidades || {})), receita: somarSeries(ids.map(i => porItem.get(i)?.receita || {})), visitas: comVis ? somarSeries(ids.map(i => porItem.get(i)?.visitas || {})) : null })
  // eventos placebo = datas de tarefas do mesmo alvo + datas de mudança de preço (≥ limiar) dos anúncios do alvo
  const eventos = [t.data, ...lista.filter(o => o !== t && (escopo === 'conta' || o.itens.some(i => t.itens.includes(i)))).map(o => o.data), ...(escopo === 'anuncios' ? t.itens.flatMap(i => grandes.get(i) || []) : [])]
  // janela adaptativa: anúncio pequeno vende pouco em 14 dias — tenta 21 e 28 antes de desistir.
  // Controle, exclusão de anúncios "tocados" e cobertura de visitas são recalculados com o MESMO N da janela usada.
  let m, Nusado = N
  for (const Nj of (params.janelas_adaptativas || [N])) {
    Nusado = Nj
    const tocados = new Set(t.itens)
    for (const o of lista) if (o !== t && Math.abs(diasEntre(o.data, t.data)) <= Nj + lag + 3) o.itens.forEach(i => tocados.add(i))
    // anúncio que mudou de preço (≥ limiar) dentro das janelas não é controle: ele também "recebeu uma intervenção"
    const jDe = addDias(t.data, -Nj), jAte = addDias(t.data, lag + Nj)
    for (const [i, ds] of grandes) if (ds.some(d => d > jDe && d <= jAte)) tocados.add(i)
    const idsCtrl = escopo === 'anuncios' ? [...porItem.keys()].filter(i => !tocados.has(i)) : []
    const visOk = ids => ids.length > 0 && ids.every(i => vis.get(i)?.vis_de && vis.get(i).vis_de <= addDias(t.data, -Nj) && vis.get(i).vis_ate >= addDias(hoje, -2))
    const alvo = montar(idsAlvo, escopo === 'anuncios' && visOk(idsAlvo))
    const idsCtrlVis = idsCtrl.filter(i => visOk([i]))
    const controle = idsCtrl.length ? { ...montar(idsCtrl, false), visitas: idsCtrlVis.length ? somarSeries(idsCtrlVis.map(i => porItem.get(i)?.visitas || {})) : null } : null
    m = medirEfeito({ alvo, controle, data: t.data, N: Nj, lag, cobertura: cob, hoje, escopo, eventosPlacebo: eventos, params })
    if (m.estado !== 'sem_base' || m.causa === 'cobertura') break
  }
  const concorrentes = lista.filter(o => o !== t && o.data >= addDias(t.data, -lag - 3) && o.data <= m.janelas.pos[1] &&
    (escopo === 'conta' || !o.itens.length || o.itens.some(i => t.itens.includes(i)))).length
  const evs = eventosCal.filter(e => e.data >= addDias(m.janelas.pos[0], -7) && e.data <= addDias(m.janelas.pos[1], 3)).map(e => e.nome)
  let subtipo = null
  if (m.estado === 'lancamento' || (m.estado === 'em_maturacao' && m.lancamento)) {
    const criados = t.itens.map(i => db.prepare('SELECT criado_em FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, i)?.criado_em).filter(Boolean)
    subtipo = criados.length && criados.every(d => diasEntre(t.data, d) >= -3) ? 'novo' : 'reativado'
  }
  // ponytail: medida de conta inteira não olha preço por anúncio (nunca entra no aprendizado: sem controle)
  const [pd, pa] = m.janelas?.pre || [], [qd, qa] = m.janelas?.pos_medida || []
  const realizados = escopo === 'anuncios' && pd && qd ? t.itens.map(i => realizadoDe(porItem.get(i), pd, pa, qd, qa)) : undefined
  const preco = marcarPreco(m, { tipo: t.tipo, itens: escopo === 'anuncios' ? t.itens : [], eventos: evPreco, realizados, intervencao: t.intervencao_preco === true, params })
  const est = marcarEstado(m, { tipo: t.tipo, itens: escopo === 'anuncios' ? t.itens : [], eventos: evEstado, params })
  return { ...t, escopo, lag, janela_usada: Nusado, ...m, subtipo, concorrentes, eventos: evs, ...preco, ...est }
}
// marco por DATA (mudança do anúncio vista no snapshot/change-log) em vez de tarefa: o MESMO cálculo de antes × depois com controle e placebo.
// tipo = demanda que dá o lag (padrão: lag_dias_padrao); confiança só quando há alegação de efeito, sem consistência histórica (não é um tipo de tarefa).
export function medirMarco(cliente, item_id, data, { tipo = 'Mudança no anúncio', hoje = hojeLocal(), params = cfgAtrib } = {}) {
  const ctx = contextoCliente(cliente, { hoje, params })
  const t = { id: `marco:${item_id}:${data}`, cliente, titulo: `Mudança no anúncio ${item_id}`, tipo, analista: '', url: '', data, data_estimada: false, itens: [String(item_id)], vinculo_origem: ['snapshot'], fonte: 'snapshot' }
  const m = medirMarcoNoContexto(ctx, t)
  if (['melhorou', 'piorou'].includes(m.estado)) m.confianca = confiancaEfeito({ m, dataEstimada: false, concorrentes: m.concorrentes, eventos: m.eventos, taxaHistorica: null, params })
  return m
}
export function analisarCliente(cliente, { hoje = hojeLocal(), params = cfgAtrib } = {}) {
  const ctx = contextoCliente(cliente, { hoje, params })
  const { cob, lista, nao, N } = ctx
  const medidas = lista.map(t => medirMarcoNoContexto(ctx, t))

  // consistência histórica por tipo SEM a própria tarefa (evita circularidade)
  const cls = medidas.filter(x => ['melhorou', 'piorou', 'sem_efeito'].includes(x.estado) && !excluirDaAprendizagem(x))   // a que não ensina não vira taxa das outras
  for (const x of medidas) {
    if (!['melhorou', 'piorou'].includes(x.estado)) continue          // confiança só existe para uma alegação de efeito
    const outras = cls.filter(o => o !== x && o.tipo === x.tipo)
    const taxa = outras.length >= params.min_n_padrao ? outras.filter(o => o.estado === x.estado).length / outras.length : null   // mesma direção do resultado
    x.confianca = confiancaEfeito({ m: x, dataEstimada: x.data_estimada, concorrentes: x.concorrentes, eventos: x.eventos, taxaHistorica: taxa, params })
  }
  alocarIncremental(medidas)
  const por = estado => medidas.filter(m => m.estado === estado).length
  const comparaveis = m => ['melhorou', 'piorou', 'sem_efeito'].includes(m.estado)
  return {
    cliente, hoje, cobertura: cob, janela_dias: N,
    medidas: medidas.sort((a, b) => b.data.localeCompare(a.data)),
    resumo: {
      mensuraveis: medidas.length, melhorou: por('melhorou'), piorou: por('piorou'), sem_efeito: por('sem_efeito'),
      em_maturacao: por('em_maturacao'), sem_base: por('sem_base'),
      sem_controle: por('sem_controle'), variacao_conta: por('variacao_conta'), lancamento: por('lancamento'),
      receita_lancamentos: r2(medidas.filter(m => m.estado === 'lancamento').reduce((t, m) => t + (m.receita_alocada || 0), 0)),
      lancamentos_que_venderam: medidas.filter(m => m.estado === 'lancamento' && m.lancamento?.vendeu).length,
      ganho_associado: r2(medidas.filter(m => m.estado === 'melhorou').reduce((t, m) => t + (m.receita_alocada || 0), 0)),
      perda_associada: r2(medidas.filter(m => m.estado === 'piorou').reduce((t, m) => t + (m.receita_alocada || 0), 0)),
      confundidas: medidas.filter(m => confundida(m) && comparaveis(m)).length,          // união (preço ou estado): o contador visível de /resultados
      confundidas_preco: medidas.filter(m => m.confundido_preco && comparaveis(m)).length,
      // estado: coincidências = medidas comparáveis com evento que confunde (qualquer modo); confundidas = as que saíram do aprendizado (modo 'ativo')
      coincidencias_estado: medidas.filter(m => m.coincide_estado && comparaveis(m)).length,
      confundidas_estado: medidas.filter(m => m.confundido_estado && comparaveis(m)).length,
    },
    nao_mensuraveis: nao,
  }
}

// padrões entre TODOS os clientes conectados
// nicho (central, curado em config/nichos.json), UF e região (meli_contas.uf) da conta: recortes de /resultados, da retroalimentação e do melhor profissional
export const dimensoesDe = cliente => { const uf = ufDe(cliente); return { nicho: nichoDe(cliente), uf, regiao: regiaoDe(uf) } }
export function padroesGlobais(opts = {}) {
  const conectados = db.prepare("SELECT DISTINCT cliente FROM meli_serie_item WHERE cliente NOT LIKE '[Comercial] %' AND cliente NOT LIKE '[S90] %'").all().map(r => r.cliente)
  // cada medida já sai com nicho/uf/regiao da conta (quem usa as análises do cache recorta sem nova consulta)
  const analises = conectados.map(c => { const a = analisarCliente(c, opts), d = dimensoesDe(c); for (const m of a.medidas) Object.assign(m, d); return Object.assign(a, d) })
  const todas = analises.flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente })))
  return { clientes: conectados, n_clientes: conectados.length, ...agruparPadroes(todas), analises }
}
