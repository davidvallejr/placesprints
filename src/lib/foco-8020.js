// Foco 80/20 do Merovíngio por janela (15 · 30 · 45 · 60 · 90 dias) — F1, SÓ LEITURA. Desenho: docs/desenho-merovingio-foco-8020.md § 2–4.
// PURO: recebe séries, medidas (analisarCliente) e contexto já lidos; nenhuma consulta ao banco, nenhuma rede (foco-real.js lê).
// Não é um segundo motor: a curva é a mesma receita da série, o efeito é o antes × depois com controle do Merovíngio (impacto-tarefas.js),
// o veredito de família é o Wilson de retroalimentacao.js::veredito. Nada aqui entra na prioridade do plano (isso é a F3, com chave própria).
// Honestidade: ausente = null («—» na tela) com motivo; efeito = associação ajustada, nunca causa; custo de oportunidade = estimativa pelo retorno passado.
import { wilson, excluirDaAprendizagem } from './impacto-tarefas.js'
import { veredito, cfgRetro } from './retroalimentacao.js'
import { familiaDeDemanda } from './processos.js'
import { addDias, diasEntre } from './meli-serie.js'

export const JANELAS = [15, 30, 45, 60, 90]
// canais de esforço = lista FECHADA de famílias (ids de config/processos-curadoria.json → familias), § 2
export const CANAIS = {
  ads: ['ads'], conteudo: ['imagens', 'otimizar', 'ficha', 'corrigir', 'variacoes', 'loja'], preco: ['precos', 'oferta_relampago', 'cupom'],
  promocao: ['campanhas_desconto'], estoque: ['full', 'custos'], duplicacao: ['duplicacao', 'cadastro', 'kits'], outro: ['afiliados', 'transmissao', 'pesquisa', 'interna'],
}
export const canalDe = famId => Object.keys(CANAIS).find(k => CANAIS[k].includes(famId)) || 'outro'
// ponytail: limiares do § 4 em código; viram config/foco.json na F3, quando o fator entrar no plano
export const CFG_FOCO = { razao_esforco: 1.5, min_esforco_pct: 10, sem_alvo_pct: 70, min_n: cfgRetro.plano.min_n_aprendizado, min_n_prior: 5, revisar_dias: 30 }
export const ROTULO_VEREDITO = { manter_e_escalar: 'Manter e escalar', manter: 'Manter', reduzir: 'Reduzir', pausado_por_evidencia: 'Pausado por evidência', em_observacao: 'Em observação' }
export const NIVEIS = { N0: 'variação observada (sem controle ou sem volume)', N1: 'associação ajustada por controle e ruído', N2: 'efeito com controle pareado — ainda não medido no sistema', N3: 'experimento com holdout — ainda não existe', N4: 'experimento replicado — ainda não existe' }
const MEDIDOS = ['melhorou', 'piorou', 'sem_efeito']
const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }
const pt = n => String(n).replace('.', ',')

// ── 1. Curva de concentração com corte DERIVADO (o joelho), § 3.2 ──
// unidades: [{ id, valor, ... }]. Corte = índice que maximiza acum% − diagonal (sem parâmetro); curva sem joelho (tudo igual) = sem concentração (corte = n).
export function curvaConcentracao(unidades, campo = 'valor') {
  const lista = unidades.filter(u => (u[campo] || 0) > 0).sort((a, b) => b[campo] - a[campo])
  const total = lista.reduce((t, u) => t + u[campo], 0), n = lista.length
  if (!n) return { disponivel: false, n: 0, motivo: 'nenhuma unidade com valor positivo no período' }
  let acum = 0, area = 0, ant = 0, best = -1, iBest = 0, n80 = 0, n50 = 0
  const itens = lista.map((u, i) => {
    acum += u[campo]; const y = acum / total
    area += (ant + y) / 2 / n; ant = y
    const dist = 100 * y - 100 * (i + 1) / n
    if (dist > best + 1e-9) { best = dist; iBest = i }
    if (!n80 && y * 100 >= 80 - 1e-9) n80 = i + 1
    if (!n50 && y * 100 >= 50 - 1e-9) n50 = i + 1
    return { ...u, share_pct: r1(100 * u[campo] / total), acum_pct: r1(100 * y) }
  })
  const semJoelho = best < 1                                            // < 1 ponto percentual acima da diagonal: todos pesam igual
  const nCorte = n < 5 || semJoelho ? n : iBest + 1
  const share = r1(itens[nCorte - 1].acum_pct)
  return {
    disponivel: true, campo, total: r2(total), n, n_corte: nCorte, share_corte_pct: share, n_80: n80, n_50: n50, top1_pct: itens[0].share_pct,
    gini: r2(Math.max(0, 2 * area - 1)), afirmavel: n >= 5 && !semJoelho,
    motivo: n < 5 ? `só ${n} unidade(s) com valor: concentração não afirmável (mínimo 5)` : semJoelho ? 'as unidades pesam praticamente igual: não há concentração' : null,
    topo: itens.slice(0, nCorte), cauda_n: n - nCorte, itens,
  }
}

// receita/unidades de cada anúncio na janela [de, ate] a partir das séries ({dia: v}); meta: Map id → { titulo, permalink, thumb }
export function receitaPorAnuncio(porItem, { de, ate, meta = new Map() }) {
  const out = []
  for (const [id, s] of porItem) {
    let r = 0, u = 0
    for (const [d, v] of Object.entries(s.receita || {})) if (d >= de && d <= ate) r += v
    for (const [d, v] of Object.entries(s.unidades || {})) if (d >= de && d <= ate) u += v
    if (r > 0 || u > 0) out.push({ id, rotulo: meta.get(id)?.titulo || id, permalink: meta.get(id)?.permalink || '', valor: r2(r), unidades: u })
  }
  return out
}

// ── 2. O que a janela consegue afirmar (§ 3.1): a régua é DADO, não calendário ──
// diasSerie = dias de pedidos coletados até `ate`; lacunas = dias sem coleta dentro da janela; medidasCompletas = medidas comparáveis com data na janela
export function oQueAfirmar(janela, { diasSerie = 0, lacunas = 0, medidasCompletas = 0, maxNFamilia = 0 } = {}) {
  const efetivo = JANELAS.filter(j => j <= Math.min(janela, diasSerie)).at(-1) || 0      // o marco efetivo nunca passa dos dias de dado
  const motivos = []
  if (diasSerie < janela) motivos.push(`só ${diasSerie} dia(s) de pedidos coletados: a janela de ${janela} d vale como ${efetivo ? efetivo + ' d' : 'menos de 15 d'}`)
  if (lacunas > 3) motivos.push(`${lacunas} dia(s) sem coleta na janela: tendência não é lida com buraco no histórico`)
  const a = {
    curva: diasSerie >= 14,
    curva_provisoria: diasSerie >= 14 && Math.min(janela, diasSerie) < 28,
    estado: efetivo >= 30 && lacunas <= 3,
    estado_confirmado: efetivo >= 45 && diasSerie >= 56 && lacunas <= 3,
    efeito: efetivo >= 30 && medidasCompletas > 0,
    prior_calibrado: efetivo >= 45 && maxNFamilia >= CFG_FOCO.min_n_prior,
    veredito_familia: efetivo >= 60 && maxNFamilia >= CFG_FOCO.min_n,
  }
  if (!a.curva) motivos.push('menos de 14 dias de série: nem a curva provisória existe')
  else if (a.curva_provisoria) motivos.push('curva provisória: estabiliza com 28 dias de série')
  if (efetivo >= 30 && !medidasCompletas) motivos.push('nenhuma ação com medida completa nesta janela (pré 14 + defasagem + pós 14)')
  if (efetivo >= 60 && maxNFamilia < CFG_FOCO.min_n) motivos.push(`nenhum tipo de ação com ${CFG_FOCO.min_n} medidas: sem veredito «funciona / não funciona»`)
  const permitidos = efetivo < 30 ? ['em_observacao', 'manter'] : efetivo < 45 ? ['em_observacao', 'manter', 'reduzir'] : efetivo < 60 ? ['em_observacao', 'manter', 'reduzir', 'manter_e_escalar'] : Object.keys(ROTULO_VEREDITO)
  return { janela, marco_efetivo: efetivo, dias_serie: diasSerie, afirmavel: a, vereditos_permitidos: permitidos, degrau_max: efetivo >= 30 ? 'N1' : 'N0', motivos }
}

// ── 3. Efeito medido de um conjunto de medidas (célula Wilson + ganho líquido), § 3.4 ──
export function celulaEfeito(ms, base = null) {
  const v = ms.filter(m => MEDIDOS.includes(m.estado) && m.escopo === 'anuncios' && !excluirDaAprendizagem(m))
  const n = v.length, k = v.filter(m => m.estado === 'melhorou').length, p = v.filter(m => m.estado === 'piorou').length, w = wilson(k, n)
  const ganho = v.reduce((t, m) => t + (m.estado === 'melhorou' ? (m.receita_alocada || 0) : m.estado === 'piorou' ? -Math.abs(m.receita_alocada || 0) : 0), 0)
  return {
    n, melhorou: k, piorou: p, sem_efeito: n - k - p, taxa: n ? r2(w.p) : null, taxa_baixo: n ? r2(w.baixo) : null, taxa_alto: n ? r2(w.alto) : null,
    veredito: veredito(n, k, base), ganho_liquido: r2(ganho), efeito_mediano_pct: mediana(v.map(m => m.efeito_pct).filter(Number.isFinite)),
    n_excluidas: ms.filter(m => MEDIDOS.includes(m.estado) && excluirDaAprendizagem(m)).length,
    n_em_maturacao: ms.filter(m => m.estado === 'em_maturacao').length,
    n_sem_vinculo: ms.filter(m => m.escopo === 'conta' || !(m.itens || []).length).length,
  }
}
// p = taxa de melhora medida nesta conta (Wilson); abaixo de min_n_prior medidas não há p (premissa não é calibração)
const pDe = cel => cel.n >= CFG_FOCO.min_n_prior ? { p: cel.taxa, p_baixo: cel.taxa_baixo, p_alto: cel.taxa_alto, fonte_p: `taxa de melhora medida nesta conta (${cel.melhorou} de ${cel.n})` }
  : { p: null, p_baixo: null, p_alto: null, fonte_p: `sem p: ${cel.n} medida(s) nesta conta (mínimo ${CFG_FOCO.min_n_prior})` }

// ── 4. Veredito por unidade (§ 4.2), limitado ao que a janela permite ──
// u: { efeito (celulaEfeito), share_esforco_pct, share_resultado_pct, tendencia? }; ctx: { R_alto, marco, sobrevivencia, risco, sem_alvo_pct, hoje }
export function vereditoFoco(u, { R_alto = false, marco = 0, sobrevivencia = false, risco = null, permitidos = Object.keys(ROTULO_VEREDITO), hoje = '' } = {}) {
  const M = u.efeito?.veredito || 'sem_amostra', T = u.tendencia, n = u.efeito?.n || 0
  const sE = u.share_esforco_pct ?? 0, sR = u.share_resultado_pct ?? 0
  const E_alto = sE >= CFG_FOCO.min_esforco_pct && sE > sR * CFG_FOCO.razao_esforco
  const semAlvo = (u.sem_alvo_pct ?? 0) >= CFG_FOCO.sem_alvo_pct
  const faltam = []
  let v = 'em_observacao', motivo
  if (risco) { v = 'manter'; motivo = `risco aberto (${risco}): risco nunca sai do foco` }
  else if (R_alto && (M === 'funciona' || (T?.estado === 'crescimento' && T.significativo && M !== 'nao_funciona')) && permitidos.includes('manter_e_escalar')) {
    v = 'manter_e_escalar'; motivo = M === 'funciona' ? 'concentra o resultado e as ações medidas melhoraram acima do habitual' : 'concentra o resultado e está crescendo com significância'
  } else if (R_alto) {
    v = 'manter'; motivo = 'concentra o resultado'
    if (!permitidos.includes('manter_e_escalar')) faltam.push(`marco ${marco}/45 d para «manter e escalar»`)
    else if (M !== 'funciona') faltam.push(`efeito medido: ${n}/${CFG_FOCO.min_n} medidas com veredito «funciona»`)
  } else if (E_alto && M === 'nao_funciona' && !sobrevivencia && permitidos.includes('pausado_por_evidencia')) {
    v = 'pausado_por_evidencia'; motivo = `consome ${pt(sE)}% do esforço com ${pt(sR)}% do resultado e as medidas não melhoraram (limite superior abaixo do habitual, n = ${n})`
  } else if (E_alto && (M === 'inconclusivo' || M === 'sem_amostra' || semAlvo || (M === 'nao_funciona' && !permitidos.includes('pausado_por_evidencia'))) && permitidos.includes('reduzir')) {
    v = 'reduzir'; motivo = semAlvo ? `esforço sem alvo: ${pt(u.sem_alvo_pct)}% das tarefas não citam anúncio — não dá para medir assim` : `consome ${pt(sE)}% do esforço com ${pt(sR)}% do resultado, sem efeito medido que justifique`
  } else {
    motivo = 'nenhum critério de veredito atingido'
    if (!E_alto) faltam.push('esforço não desproporcional ao resultado')
    if (M === 'nao_funciona' && sobrevivencia) faltam.push('conta em Sobrevivência: a piora é do estado da conta, não prova contra a ação')
    if (!permitidos.includes('reduzir')) faltam.push(`marco ${marco}/30 d para «reduzir»`)
    if (M === 'nao_funciona' && !permitidos.includes('pausado_por_evidencia')) faltam.push(`marco ${marco}/60 d para «pausado por evidência»`)
  }
  return { veredito: v, rotulo: ROTULO_VEREDITO[v], motivo, faltam, n, ...pDe(u.efeito || { n: 0 }), revisar_em: hoje ? addDias(hoje, CFG_FOCO.revisar_dias) : '' }
}

// ── 5. Custo de oportunidade (§ 4.4): estimativa pelo retorno passado; nunca previsão, nunca entra na prioridade ──
export function custoOportunidade(familias) {
  const comparaveis = familias.filter(f => f.efeito.n >= CFG_FOCO.min_n && f.esforco.tarefas > 0)
  if (!comparaveis.length) return { melhor: null, motivo: `nenhum tipo de ação com ${CFG_FOCO.min_n} medidas: custo de oportunidade não calculável` }
  const ret = f => f.efeito.ganho_liquido / f.esforco.tarefas
  const melhor = comparaveis.reduce((a, b) => ret(b) > ret(a) ? b : a)
  for (const f of familias) {
    if (f === melhor || !f.esforco.tarefas) { f.custo_oportunidade_reais = null; continue }
    const ru = f.efeito.n >= CFG_FOCO.min_n ? ret(f) : 0                         // sem amostra: retorno medido = 0 (só o que foi medido conta)
    f.custo_oportunidade_reais = r2(Math.max(0, f.esforco.tarefas * (ret(melhor) - ru)))
  }
  return { melhor: melhor.id, retorno_por_tarefa_reais: r2(ret(melhor)), premissa: `estimativa: se as tarefas tivessem o retorno médio por tarefa de «${melhor.rotulo}» nesta conta (retorno passado; não é previsão)` }
}

// ── 6. Montagem do foco da janela ──
// porItem: Map item → série; medidas: analisarCliente().medidas; risco: Map item → motivo; verba: Map item → R$ de Ads; tendencia: (id) → classificarEstado | null
export function montarFoco({ janela, ate, hoje = ate, porItem = new Map(), meta = new Map(), medidas = [], diasSerie = 0, lacunas = 0, risco = new Map(), verba = new Map(),
  estrategia = null, tendencia = () => null, base = null, fonteResultado = 'receita' }) {
  if (!JANELAS.includes(janela)) throw Object.assign(new Error('janela fora da lista (15, 30, 45, 60 ou 90)'), { status: 400 })
  const de = addDias(ate, -(janela - 1))
  const naJanela = medidas.filter(m => m.data >= de && m.data <= ate)
  // ponytail: o aprendizado precisa da medida madura — vale a data da tarefa dentro da janela, a medida pode terminar depois (declarado)
  const porFam = new Map()
  for (const m of naJanela) { const f = familiaDeDemanda(m.tipo); (porFam.get(f.id) || porFam.set(f.id, { id: f.id, rotulo: f.nome, ms: [] }).get(f.id)).ms.push(m) }
  const maxN = Math.max(0, ...[...porFam.values()].map(f => celulaEfeito(f.ms, base).n))
  const afirmar = oQueAfirmar(janela, { diasSerie, lacunas, medidasCompletas: naJanela.filter(m => MEDIDOS.includes(m.estado)).length, maxNFamilia: maxN })
  const ctxV = { marco: afirmar.marco_efetivo, sobrevivencia: estrategia === 'Sobrevivência', permitidos: afirmar.vereditos_permitidos, hoje }
  const totTarefas = naJanela.length

  // produtos (= anúncio enquanto produto.diagnostico_ligado está desligado — dito na resposta)
  const anuncios = receitaPorAnuncio(porItem, { de, ate, meta })
  const curvaP = curvaConcentracao(anuncios)
  const noTopo = new Set(curvaP.disponivel ? curvaP.topo.map(u => u.id) : [])
  const tarefasItem = new Map()
  for (const m of naJanela) for (const i of m.itens || []) (tarefasItem.get(i) || tarefasItem.set(i, []).get(i)).push(m)
  const totTarefasItem = [...tarefasItem.values()].reduce((t, l) => t + l.length, 0), totVerba = [...verba.values()].reduce((t, v) => t + v, 0)
  const produtos = (curvaP.disponivel ? curvaP.itens : []).map(u => {
    const ms = tarefasItem.get(u.id) || [], vb = verba.get(u.id) ?? null
    const partes = [totTarefasItem ? 100 * ms.length / totTarefasItem : null, totVerba ? 100 * (vb || 0) / totVerba : null].filter(x => x != null)
    const x = { tipo: 'produto', id: 'item:' + u.id, item_id: u.id, rotulo: u.rotulo, permalink: u.permalink,
      resultado: { valor_reais: u.valor, unidades: u.unidades, share_pct: u.share_pct, fonte: fonteResultado },
      esforco: { tarefas: ms.length, verba_ads_reais: vb, horas: 'NOT_COLLECTED' }, efeito: celulaEfeito(ms, base), tendencia: tendencia(u.id),
      share_resultado_pct: u.share_pct, share_esforco_pct: partes.length ? r1(partes.reduce((a, b) => a + b, 0) / partes.length) : 0, risco: risco.get(u.id) || null }
    x.veredito = vereditoFoco(x, { ...ctxV, R_alto: noTopo.has(u.id), risco: x.risco })
    return x
  })
  // anúncio com risco aberto que não vendeu na janela também aparece (risco nunca sai do foco)
  for (const [id, motivo] of risco) if (!produtos.some(p => p.item_id === id)) {
    const x = { tipo: 'produto', id: 'item:' + id, item_id: id, rotulo: meta.get(id)?.titulo || id, resultado: { valor_reais: 0, unidades: 0, share_pct: 0, fonte: fonteResultado }, esforco: { tarefas: (tarefasItem.get(id) || []).length, verba_ads_reais: verba.get(id) ?? null, horas: 'NOT_COLLECTED' }, efeito: celulaEfeito(tarefasItem.get(id) || [], base), risco: motivo }
    x.veredito = vereditoFoco(x, { ...ctxV, risco: motivo }); produtos.push(x)
  }

  // famílias: resultado = ganho líquido medido; só entra na curva com min_n medidas (abaixo: «ainda sem medida suficiente»)
  const familias = [...porFam.values()].map(f => {
    const ef = celulaEfeito(f.ms, base)
    return { tipo: 'familia', id: f.id, rotulo: f.rotulo, canal: canalDe(f.id), efeito: ef,
      esforco: { tarefas: f.ms.length, tarefas_sem_anuncio: ef.n_sem_vinculo, verba_ads_reais: f.id === 'ads' ? (totVerba || null) : null, horas: 'NOT_COLLECTED' },
      share_esforco_pct: totTarefas ? r1(100 * f.ms.length / totTarefas) : 0, sem_alvo_pct: f.ms.length ? r1(100 * ef.n_sem_vinculo / f.ms.length) : 0 }
  })
  const elegiveis = familias.filter(f => f.efeito.n >= CFG_FOCO.min_n)
  const curvaF = curvaConcentracao(elegiveis.map(f => ({ id: f.id, rotulo: f.rotulo, valor: f.efeito.ganho_liquido })))
  const topoF = new Set(curvaF.disponivel ? curvaF.topo.map(u => u.id) : [])
  for (const f of familias) {
    f.share_resultado_pct = curvaF.disponivel ? (curvaF.itens.find(i => i.id === f.id)?.share_pct ?? 0) : 0
    f.na_curva = f.efeito.n >= CFG_FOCO.min_n ? true : `ainda sem medida suficiente (${f.efeito.n}/${CFG_FOCO.min_n})`
    f.veredito = vereditoFoco(f, { ...ctxV, R_alto: topoF.has(f.id) })
  }
  const custo = custoOportunidade(familias)
  familias.sort((a, b) => b.esforco.tarefas - a.esforco.tarefas)

  // canais = soma das famílias (veredito fica por família: canal só agrega)
  const canais = Object.keys(CANAIS).map(k => {
    const fs = familias.filter(f => f.canal === k), ms = fs.flatMap(f => porFam.get(f.id).ms), ef = celulaEfeito(ms, base)
    return { tipo: 'canal', id: k, familias: fs.map(f => f.id), esforco: { tarefas: ms.length, verba_ads_reais: k === 'ads' ? (totVerba || null) : null }, efeito: ef,
      share_esforco_pct: totTarefas ? r1(100 * ms.length / totTarefas) : 0 }
  }).filter(c => c.esforco.tarefas || c.esforco.verba_ads_reais)

  const grupos = Object.fromEntries(Object.keys(ROTULO_VEREDITO).map(v => [v, [...produtos, ...familias].filter(u => u.veredito.veredito === v).map(u => ({ tipo: u.tipo, id: u.id, rotulo: u.rotulo, motivo: u.veredito.motivo }))]))
  return {
    janela, periodo: { de, ate }, afirmar, fonte_resultado: fonteResultado,
    curva_produtos: semItens(curvaP), curva_familias: semItens(curvaF), produtos, familias, canais, grupos, custo_oportunidade: custo,
    esforco_total: { tarefas: totTarefas, tarefas_sem_anuncio: naJanela.filter(m => !(m.itens || []).length).length, verba_ads_reais: totVerba || null, horas: 'NOT_COLLECTED' },
    leitura: leitura({ curvaP, familias, totTarefas, janela, afirmar }),
  }
}
const semItens = c => { if (!c.disponivel) return c; const { itens, ...resto } = c; return { ...resto, topo: c.topo.map(({ id, rotulo, valor, share_pct, acum_pct }) => ({ id, rotulo, valor, share_pct, acum_pct })) } }

function leitura({ curvaP, familias, totTarefas, janela, afirmar }) {
  const f = []
  if (!afirmar.afirmavel.curva) return `Janela de ${janela} dias: ${afirmar.motivos[0] || 'sem dados suficientes'}.`
  f.push(curvaP.disponivel ? `${curvaP.n_corte} de ${curvaP.n} anúncios (${pt(curvaP.share_corte_pct)}%) concentram a receita dos últimos ${janela} dias; 80% precisa de ${curvaP.n_80}.` : `Sem receita nos últimos ${janela} dias.`)
  const comEfeito = familias.filter(x => x.efeito.veredito === 'funciona').map(x => x.rotulo)
  if (comEfeito.length) f.push(`Com resultado medido acima do habitual: ${comEfeito.join(', ')} (associação ajustada, não prova de causa).`)
  const semAlvo = familias.filter(x => x.veredito.veredito === 'reduzir')
  if (semAlvo.length) f.push(`${semAlvo.map(x => `${x.rotulo} (${pt(x.share_esforco_pct)}% do esforço)`).join(', ')}: esforço sem resultado medido.`)
  if (totTarefas && !familias.some(x => x.efeito.n)) f.push(`${totTarefas} tarefa(s) na janela, nenhuma com medida completa.`)
  return f.join(' ')
}
export const diasDeSerie = (cob, ate) => cob?.de ? diasEntre(cob.de, ate) + 1 : 0
