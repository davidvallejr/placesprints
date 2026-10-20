// Retroalimentação do Merovíngio: o sistema lê o ESTADO da conta (queda / estagnação / crescimento), diz o que fazer em cada um,
// APRENDE com o que já foi medido (o que funciona e o que não funciona, por tipo de tarefa e por estado da conta) e DEVOLVE isso ao plano
// de ação como fator de prioridade — o ciclo se fecha: plano → tarefas → medição → aprendizado → plano melhor.
//
// 100% determinístico e auditável (zero IA). Regras de honestidade:
//  • Todo efeito é associação temporal ajustada por controle (impacto-tarefas.js) — nunca causalidade comprovada.
//  • Sem amostra mínima o aprendizado fica NEUTRO (fator 1,0) e o texto diz "sem amostra" — nunca finge estatística.
//  • Dado que falta é declarado; nada é estimado em silêncio.
// Parte pura (sem banco) no topo, testável com séries sintéticas; a parte com banco (retroalimentar) no fim.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal, agora } from './db.js'
import { ROOT } from './env.js'
import { addDias, diasEntre, coberturaPedidos, cfgAtrib, qualidadeNoIntervalo } from './meli-serie.js'
import { medirEfeito, somarSeries, somaJanela, wilson, analisarCliente, excluirDaAprendizagem, precosDoCliente } from './impacto-tarefas.js'
import { nichoDe, SEM_NICHO } from './dimensoes.js'
import { historico } from './preco-historico.js'
import { algoritmo, diagnosticarConta } from './diagnostico-conta.js'
import { padroesGlobaisCache } from './calibracao.js'
import { familiaDeDemanda } from './processos.js'
import { duplicacoesDoCliente, aprenderDuplicacao, fatorPorObjetivo } from './duplicacao.js'

export const cfgRetro = JSON.parse(readFileSync(join(ROOT, 'config', 'retroalimentacao.json'), 'utf-8'))
export const ROTULO_ESTADO = { queda: 'Queda', estagnacao: 'Estagnação', crescimento: 'Crescimento', sem_base: 'Sem base de comparação' }
const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const pt = n => String(n).replace('.', ',')                                     // decimal brasileiro nos textos
const diaBR = iso => { const d = new Date(iso); return iso && !isNaN(d) ? d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '' }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const pctVar = (a, b) => b > 0 ? r1(100 * (a / b - 1)) : null
const mediana = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 }
const ESTADOS_MEDIDOS = ['melhorou', 'piorou', 'sem_efeito']

// ── 1. ESTADO da conta: queda / estagnação / crescimento ────────────────────
// serie: { unidades, receita } ({dia: n}); ate = último dia COMPLETO. Compara a receita de N dias com os N anteriores.
// Variação pequena sem significância (ruído de contagem) é ESTAGNAÇÃO — nunca um "crescimento" fabricado por oscilação.
export function classificarEstado({ serie, ate, N = cfgRetro.estado.janela_dias, cob = null, c = cfgRetro.estado, _confirmar = true }) {
  const aDe = addDias(ate, -(N - 1)), bAte = addDias(aDe, -1), bDe = addDias(bAte, -(N - 1))
  const janela = { atual: [aDe, ate], anterior: [bDe, bAte] }
  if (cob?.de && bDe < cob.de) return { estado: 'sem_base', rotulo: ROTULO_ESTADO.sem_base, motivo: `histórico de pedidos coletado só a partir de ${cob.de}; o período anterior começaria em ${bDe}`, janela }
  const ua = somaJanela(serie.unidades || {}, aDe, ate), ub = somaJanela(serie.unidades || {}, bDe, bAte)
  const ra = somaJanela(serie.receita || {}, aDe, ate), rb = somaJanela(serie.receita || {}, bDe, bAte)
  if (ub < c.min_unidades_base || !(rb > 0)) return { estado: 'sem_base', rotulo: ROTULO_ESTADO.sem_base, motivo: `só ${ub} unidade(s) vendida(s) no período anterior (mínimo ${c.min_unidades_base}) — a variação seria instável`, janela }
  const variacao = pctVar(ra, rb)
  const z = ua + ub > 0 ? (ua - ub) / Math.sqrt(ua + ub) : 0
  const significativo = Math.abs(z) >= c.z_significativo
  const forte = Math.abs(variacao) >= c.limiar_forte_pct
  let estado = variacao >= c.limiar_pct ? 'crescimento' : variacao <= -c.limiar_pct ? 'queda' : 'estagnacao'
  let dentroDoRuido = false, divergencia = false
  if (estado !== 'estagnacao') {
    // exige significância SEMPRE (receita −37% com 8→5 vendas é ruído) e que unidades e receita andem na MESMA direção
    // (receita −12% com unidades +28% é preço/ticket: não é "queda de vendas")
    if (z !== 0 && Math.sign(z) !== Math.sign(variacao)) { estado = 'estagnacao'; divergencia = true }
    else if (!significativo) { estado = 'estagnacao'; dentroDoRuido = true }
  }
  const out = {
    estado, rotulo: ROTULO_ESTADO[estado], forca: estado === 'estagnacao' ? null : forte ? 'forte' : 'moderada',
    variacao_pct: variacao, receita: { atual: r2(ra), anterior: r2(rb) }, unidades: { atual: ua, anterior: ub },
    z: r2(z), significativo, dentro_do_ruido: dentroDoRuido, divergencia_receita_unidades: divergencia, janela, janela_dias: N,
    recente_7d_pct: pctVar(somaJanela(serie.receita || {}, addDias(ate, -6), ate), somaJanela(serie.receita || {}, addDias(ate, -13), addDias(ate, -7))),
    confirmacao_28d: null, sinal_misto: null,
  }
  if (_confirmar && N !== 28) {
    const m = classificarEstado({ serie, ate, N: 28, cob, c, _confirmar: false })
    if (m.estado !== 'sem_base') {
      out.confirmacao_28d = { estado: m.estado, variacao_pct: m.variacao_pct }
      const oposto = (estado === 'queda' && m.estado === 'crescimento') || (estado === 'crescimento' && m.estado === 'queda')
      if (oposto) out.sinal_misto = `Sinal misto: nos últimos ${N} dias a conta está em ${ROTULO_ESTADO[estado].toLowerCase()} (${pt(variacao)}%), mas o mês de 28 dias aponta ${ROTULO_ESTADO[m.estado].toLowerCase()} (${pt(m.variacao_pct)}%) — pode ser oscilação recente; reavaliar em 7 dias antes de mudar o plano.`
      else if (estado !== 'estagnacao' && m.estado === 'estagnacao') out.sinal_misto = `Os últimos ${N} dias estão em ${ROTULO_ESTADO[estado].toLowerCase()} (${pt(variacao)}%), mas o mês de 28 dias ainda aparece estável (${pt(m.variacao_pct)}%) — a mudança é recente e ainda não está confirmada no mês.`
      else if (estado === 'estagnacao' && m.estado !== 'estagnacao') out.sinal_misto = `Os últimos ${N} dias estão estáveis (${pt(variacao)}%), mas o mês de 28 dias mostra ${ROTULO_ESTADO[m.estado].toLowerCase()} (${pt(m.variacao_pct)}%) — a ${m.estado === 'queda' ? 'queda aconteceu antes e se estabilizou (ou o mês anterior era atípico)' : 'alta aconteceu antes e parou'}: "estagnação" aqui não significa que a conta nunca se moveu.`
    }
  }
  return out
}

// ── 1b. ESTRATÉGIA da conta: Sobrevivência / Manutenção / Crescimento / Desenvolvimento ──
// Encaixe do ESTADO (classificarEstado) com a economia do Ads, a parcela da receita em ruptura e a cobertura da série: a primeira condição
// que casa decide, nesta ordem (Sobrevivência > Manutenção > Crescimento > Desenvolvimento; o que não casa cai em Manutenção, dito).
// Caixa, capacidade e mercado NÃO existem no sistema → toda classificação nasce PROVISÓRIA e declara o que falta. Nunca promete resultado.
// ctx: { estado (saída de classificarEstado), economia (diagnostico-conta.economiaAds | null), custos (bool), ads (bool: houve investimento no
//        período), metas (objeto | null), concentracao ({ concentracao_top1_pct } | null), cobertura_dias, share_ruptura_pct (parcela do GMV de
//        28 d em anúncios com estoque abaixo de queda.limiar_ruptura_dias), acoes ([{ regra, gatilho }] abertas), hoje }
export function classificarEstrategia(ctx, c = cfgRetro.estrategia) {
  const e = ctx.estado || {}, est = e.estado || 'sem_base', misto = !!e.sinal_misto, N = e.janela_dias || cfgRetro.estado.janela_dias
  const viavel = ctx.economia?.viavel ?? null                                                  // null = sem custos: nem viável nem inviável
  const rup = ctx.share_ruptura_pct ?? null, cob = ctx.cobertura_dias ?? null
  const acoes = ctx.acoes || [], regrasCad = new Set(c.desenvolvimento.regras_cadastro || [])
  const nCad = acoes.filter(a => regrasCad.has(String(a.regra || '').replace(/^anuncio_/, '')) || a.gatilho === 'G1').length
  const shareCad = acoes.length ? r1(100 * nCad / acoes.length) : null
  const S = c.sobrevivencia, D = c.desenvolvimento, v = e.variacao_pct == null ? '—' : (e.variacao_pct > 0 ? '+' : '') + pt(e.variacao_pct), limRup = cfgRetro.queda.limiar_ruptura_dias
  let classe, justificativa
  if (est === 'queda' && e.forca === 'forte') [classe, justificativa] = ['Sobrevivência', `queda forte: receita ${v}% nos últimos ${N} dias contra os ${N} anteriores (limiar ${cfgRetro.estado.limiar_forte_pct}%)`]
  else if (viavel === false) [classe, justificativa] = ['Sobrevivência', `economia do Ads inviável com os custos informados (ACOS permitido ${pt(ctx.economia.acos_max_pct)}% ≤ 0)${est !== 'sem_base' ? `; estado ${ROTULO_ESTADO[est].toLowerCase()} (${v}%)` : ''}`]
  else if (rup != null && rup >= S.share_ruptura_pct) [classe, justificativa] = ['Sobrevivência', `${pt(rup)}% da receita de 28 dias está em anúncios com estoque para menos de ${limRup} dias (limite ${S.share_ruptura_pct}%)`]
  else if (est === 'estagnacao') [classe, justificativa] = ['Manutenção', `estagnação: receita ${v}% nos últimos ${N} dias${e.dentro_do_ruido ? ' (dentro do ruído de contagem)' : ''}`]
  else if (est === 'queda' && misto) [classe, justificativa] = ['Manutenção', `queda moderada (${v}% em ${N} dias) com sinal misto no mês de 28 dias: o plano não muda antes da confirmação`]
  else if (est === 'crescimento' && (viavel === true || !ctx.ads)) [classe, justificativa] = ['Crescimento', `crescimento: receita ${v}% nos últimos ${N} dias${viavel === true ? `; economia do Ads viável (ROAS alvo ${pt(ctx.economia.roas_alvo)})` : '; sem investimento em Ads no período'}`]
  else if (est === 'sem_base') [classe, justificativa] = ['Desenvolvimento', `sem base de comparação: ${e.motivo || 'histórico insuficiente'}`]
  else if (cob != null && cob < D.min_dias_cobertura) [classe, justificativa] = ['Desenvolvimento', `${cob} dia(s) de série coletada (mínimo ${D.min_dias_cobertura} para ler a conta)`]
  else if (shareCad != null && shareCad > D.share_acoes_cadastro_pct) [classe, justificativa] = ['Desenvolvimento', `${pt(shareCad)}% das ${acoes.length} ações abertas são de cadastro ou produto novo (acima de ${D.share_acoes_cadastro_pct}%)`]
  else [classe, justificativa] = ['Manutenção', est === 'crescimento' ? `crescimento (${v}%) com investimento em Ads e sem custos informados: a economia do Ads não é verificável — manter até os custos entrarem` : `queda moderada (${v}% em ${N} dias) confirmada, abaixo do limiar forte (${cfgRetro.estado.limiar_forte_pct}%)`]
  if (cob != null && cob < D.min_dias_cobertura && classe !== 'Desenvolvimento') justificativa += `; só ${cob} dia(s) de série (mínimo ${D.min_dias_cobertura})`
  const faltam = (c.faltam_padrao || []).filter(k => ctx[k] == null)
  return {
    classe, justificativa,
    confianca: e.significativo === true && !misto ? 'fato' : 'hipotese',
    revisar_em: addDias(ctx.hoje || hojeLocal(), misto ? c.revisar_dias_sinal_misto : c.revisar_dias),
    provisoria: faltam.length > 0, faltam, condicoes_revisao: [...(c.condicoes_revisao || [])],
    evidencias: [
      { chave: 'estado', valor: est }, { chave: 'variacao_pct', valor: e.variacao_pct ?? null }, { chave: 'forca', valor: e.forca ?? null },
      { chave: 'significativo', valor: e.significativo ?? null }, { chave: 'sinal_misto', valor: misto }, { chave: 'economia_viavel', valor: viavel },
      { chave: 'custos_informados', valor: !!ctx.custos }, { chave: 'ads_no_periodo', valor: !!ctx.ads }, { chave: 'share_ruptura_pct', valor: rup },
      { chave: 'cobertura_dias', valor: cob }, { chave: 'acoes_abertas', valor: acoes.length }, { chave: 'share_acoes_cadastro_pct', valor: shareCad },
      { chave: 'concentracao_top1_pct', valor: ctx.concentracao?.concentracao_top1_pct ?? null }, { chave: 'metas', valor: ctx.metas ? 'cadastradas' : 'nenhuma' },
    ],
  }
}

// ── 2. APRENDIZADO: o que funciona e o que não funciona ─────────────────────
// medidas: [{ tipo, estado, estado_antes, efeito_pct, receita_alocada, ... }] — só melhorou / piorou / sem_efeito contam.
export function veredito(n, k, base = null, minN = cfgRetro.plano.min_n_aprendizado) {
  if (n < minN) return 'sem_amostra'
  const w = wilson(k, n), ref = base ?? cfgRetro.plano.taxa_base_padrao
  if (w.baixo > Math.max(ref, cfgRetro.veredito.piso_funciona)) return 'funciona'
  if (w.alto < ref) return 'nao_funciona'
  return 'inconclusivo'
}
function celula(ms, base = null) {
  const n = ms.length, k = ms.filter(x => x.estado === 'melhorou').length, p = ms.filter(x => x.estado === 'piorou').length
  const w = wilson(k, n)
  return {
    n, melhorou: k, piorou: p, sem_efeito: n - k - p, taxa: w.p, taxa_baixo: w.baixo, taxa_alto: w.alto,
    efeito_mediano_pct: mediana(ms.map(x => x.efeito_pct).filter(Number.isFinite)),
    receita_alocada: r2(ms.reduce((t, x) => t + (x.receita_alocada || 0), 0)),
    veredito: veredito(n, k, base),
  }
}
export const reversaoProvavel = excluirDaAprendizagem              // alias antigo: reversão à média, confundida pelo preço OU pelo estado ficam fora do aprendizado
// o Notion tem dezenas de grafias para a mesma tarefa ("Duplicar anúncios", "Duplicação de Anuncio"…): o sistema aprende por FAMÍLIA de demanda
const famDe = m => m.familia || familiaDeDemanda(m.tipo).nome
export const nomeFamilia = tipo => familiaDeDemanda(tipo).nome
export function aprender(medidas) {
  const todas = medidas.filter(m => ESTADOS_MEDIDOS.includes(m.estado) && m.tipo && m.tipo !== '(sem tipo)')
  const v = todas.filter(m => !excluirDaAprendizagem(m)).map(m => ({ ...m, familia: famDe(m) }))     // feita num pico (regressão à média), com o preço ou o estado do anúncio mexendo junto: fora do aprendizado
  const grupo = chave => {
    const g = new Map()
    for (const m of v) { const k = chave(m); if (k != null) (g.get(k) || g.set(k, []).get(k)).push(m) }
    return g
  }
  const ordenar = (a, b) => (b.taxa_baixo ?? -1) - (a.taxa_baixo ?? -1) || b.n - a.n
  const geral = celula(v), base = v.length >= cfgRetro.plano.min_n_aprendizado ? Math.min(geral.taxa, 0.5) : null   // "habitual" = a taxa de todas as tarefas medidas deste conjunto
  return {
    // cada excluída conta uma vez só: reversão → preço → estado (promoção, Ads, Full, estoque, pausa na janela; só existe em modo 'ativo')
    n: v.length, excluidas_reversao: todas.filter(m => m.reversao_provavel === true).length, excluidas_preco: todas.filter(m => m.confundido_preco === true && m.reversao_provavel !== true).length,
    excluidas_estado: todas.filter(m => m.confundido_estado === true && m.confundido_preco !== true && m.reversao_provavel !== true).length, geral, base,
    por_tipo: [...grupo(m => m.familia)].map(([tipo, ms]) => ({ tipo, ...celula(ms, base) })).sort(ordenar),
    por_estado: [...grupo(m => m.estado_antes || 'sem_base')].map(([estado, ms]) => ({ estado, ...celula(ms, base) })).sort(ordenar),
    por_tipo_estado: [...grupo(m => m.estado_antes && m.estado_antes !== 'sem_base' ? `${m.familia}\u0000${m.estado_antes}` : null)]
      .map(([k, ms]) => { const [tipo, estado] = k.split('\u0000'); return { tipo, estado, ...celula(ms, base) } }).sort(ordenar),
  }
}

// ── 3. FATORES que voltam ao plano de ação ──────────────────────────────────
// fator da regra = ajuste aprendido × peso do estado. O ajuste aprendido compara a taxa de melhora do TIPO de tarefa NESTE estado da conta com a
// taxa do mesmo tipo em geral (conta + base); só existe quando a diferença é conclusiva (Wilson) — o efeito do tipo em geral já está na
// probabilidade de sucesso do plano (calibracao.js::priorEfetivo), então aqui NÃO é contado de novo. Regras de risco ficam fora (só peso do estado).
// NICHO (opcional): a estimativa pontual encolhe em dois estágios — conta → nicho → base. A base é a de sempre (conta + outras contas); o nicho
// (outras contas do mesmo nicho, aprender()) puxa a estimativa só com min_n_aprendizado medidas do tipo × estado; abaixo disso fica a de sempre (e diz).
// O nicho nunca decide SE há ajuste (isso continua sendo o teste de Wilson do tipo × estado na base): só quanto.
export function fatoresDoPlano({ estado, apConta, apOutros, apNicho = null, nicho = null, estrategia = null, regras = algoritmo.regras, c = cfgRetro }) {
  const P = c.plano, K = P.k_pseudo
  const pesos = c.playbook[estado]?.pesos || {}
  const pesoEstrategia = estrategia ? (c.estrategia?.pesos?.[estrategia] ?? 1) : 1       // gancho declarado: 1,0 em todas as classes hoje (nenhum fator muda)
  const isentas = new Set(P.isentas_de_aprendizado || [])
  const celulaDe = (ap, tipo, est) => (est ? ap.por_tipo_estado.find(x => x.tipo === tipo && x.estado === est) : ap.por_tipo.find(x => x.tipo === tipo)) || { n: 0, melhorou: 0 }
  const soma = (tipo, est) => { const a = celulaDe(apConta, tipo, est), b = celulaDe(apOutros, tipo, est); return { n: a.n + b.n, k: a.melhorou + b.melhorou, conta: a, outros: b } }
  const out = {}
  for (const r of regras) {
    if (r.ativa === false) continue
    const tipo = nomeFamilia(r.tipo_demanda), pesoEstado = pesos[r.id] ?? 1
    let aprendido = 1, nivel = 'sem_amostra', pEst = null, texto = null, conta = null, outros = null
    if (isentas.has(r.id)) nivel = 'regra de risco: só o peso do estado'
    else if (estado && estado !== 'sem_base') {
      const t = soma(tipo, null), e = soma(tipo, estado)
      conta = { n: e.conta.n, melhorou: e.conta.melhorou }; outros = { n: e.outros.n, melhorou: e.outros.melhorou }
      if (t.n < P.min_n_aprendizado) nivel = 'sem_amostra'
      else if (e.n < P.min_n_aprendizado || t.n <= e.n || !(t.k > 0)) nivel = 'tipo (já está na probabilidade do plano)'
      else {
        const pT = t.k / t.n, w = wilson(e.k, e.n)
        pEst = (e.k + K * pT) / (e.n + K)
        if (w.baixo > pT || w.alto < pT) {
          let doNicho = ''
          if (apNicho) {
            const n = celulaDe(apNicho, tipo, estado)
            if (n.n >= P.min_n_aprendizado) {                    // conta → nicho → base: o nicho encolhe para a base; a conta, para o nicho
              const pN = (n.melhorou + K * pEst) / (n.n + K), cc = celulaDe(apConta, tipo, estado)
              pEst = (cc.melhorou + K * pN) / (cc.n + K)
              doNicho = `; no nicho "${nicho}": ${n.melhorou} de ${n.n}`
            } else doNicho = `; nicho "${nicho}" com ${n.n} medida(s) deste tipo neste estado (mínimo ${P.min_n_aprendizado}): sem ajuste pelo nicho`
          }
          aprendido = clamp(pEst / pT, P.ajuste_estado_min, P.ajuste_estado_max); nivel = 'tipo × estado'; texto = `"${tipo}" melhorou em ${e.k} de ${e.n} tarefas medidas em ${ROTULO_ESTADO[estado].toLowerCase()} contra ${t.k} de ${t.n} no geral${doNicho} → ×${r2(aprendido).toLocaleString('pt-BR')}`
        } else nivel = 'tipo × estado (sem diferença clara)'
      }
    }
    const fator = clamp(aprendido * pesoEstado * pesoEstrategia, P.fator_min, P.fator_max)
    const partes = []
    if (pesoEstado !== 1) partes.push(`em ${ROTULO_ESTADO[estado]?.toLowerCase() || 'estado desconhecido'} esta regra pesa ×${pesoEstado.toLocaleString('pt-BR')}`)
    if (pesoEstrategia !== 1) partes.push(`estratégia ${estrategia}: ×${pesoEstrategia.toLocaleString('pt-BR')}`)
    partes.push(texto || (nivel === 'sem_amostra' ? `sem amostra mínima de tarefas "${tipo}" medidas (${P.min_n_aprendizado}) — o aprendizado fica neutro` : nivel.startsWith('regra de risco') ? 'regra de risco: não é julgada por "vendas subiram"' : `aprendizado neutro (${nivel})`))
    out[r.id] = { regra: r.id, tipo_demanda: r.tipo_demanda, familia: tipo, fator: r2(fator), aprendido: r2(aprendido), peso_estado: pesoEstado, peso_estrategia: pesoEstrategia, nivel, p_estimada: pEst == null ? null : r2(pEst), conta, outros, motivo: partes.join('; ') }
  }
  return out
}
// aplica o fator na NOTA em escala de chances (odds): nunca passa de 100, não empata os melhores e mexe proporcionalmente em notas altas e baixas
export function ajustarNota(nota, fator) {
  if (!(fator > 0) || fator === 1 || nota <= 0 || nota >= 100) return nota
  const o = nota / (100 - nota) * fator
  return Math.round(100 * o / (1 + o))
}

// ── 4. PARETO 80/20 ─────────────────────────────────────────────────────────
export function paretoItens(itens, pct = cfgRetro.pareto.pct) {
  const lista = [...itens].filter(i => i.r > 0).sort((a, b) => b.r - a.r)
  const total = lista.reduce((t, i) => t + i.r, 0)
  if (!total) return { disponivel: false, motivo: 'sem receita nos anúncios acompanhados no período' }
  let acum = 0
  const topo = []
  for (const i of lista) {
    if (acum / total * 100 >= pct) break
    acum += i.r
    topo.push({ id: i.id, titulo: i.titulo, thumb: i.thumb, permalink: i.permalink, catalogo_origem: i.catalogo_origem || 'nao', receita: r2(i.r), share_pct: r1(100 * i.r / total), acum_pct: r1(100 * acum / total) })
  }
  const top1 = lista[0].r / total * 100
  return {
    disponivel: true, pct_alvo: pct, receita_total: r2(total), n_anuncios: lista.length, n_80: topo.length, pct_catalogo_80: r1(100 * topo.length / lista.length), itens: topo,
    concentracao_top1_pct: r1(top1),
    alerta: top1 >= cfgRetro.pareto.top1_alerta_pct ? `Um único anúncio responde por ${r1(top1)}% da receita — dependência alta: ruptura, perda da caixa de compra ou reprovação dele derruba a conta.` : null,
    leitura: `${topo.length} de ${lista.length} anúncios (${pt(r1(100 * topo.length / lista.length))}%) geram ${pct}% da receita do período. É aí que qualquer ação precisa começar.`,
  }
}
export function paretoTarefas(medidas, pct = cfgRetro.pareto.pct) {
  const v = medidas.filter(m => ESTADOS_MEDIDOS.includes(m.estado) && m.tipo && m.tipo !== '(sem tipo)' && !excluirDaAprendizagem(m))
  const ganhos = v.filter(m => m.estado === 'melhorou' && (m.receita_alocada || 0) > 0).sort((a, b) => b.receita_alocada - a.receita_alocada)
  const total = ganhos.reduce((t, m) => t + m.receita_alocada, 0)
  if (!v.length) return { disponivel: false, motivo: 'nenhuma tarefa com resultado medido ainda' }
  let acum = 0, n80 = 0
  for (const m of ganhos) { if (acum / total * 100 >= pct) break; acum += m.receita_alocada; n80++ }
  const tipos = new Map()
  for (const m of v) { const fam = famDe(m), o = tipos.get(fam) || tipos.set(fam, { tipo: fam, n: 0, melhorou: 0, piorou: 0, sem_efeito: 0, ganho: 0 }).get(fam); o.n++; o[m.estado]++; if (m.estado === 'melhorou') o.ganho += m.receita_alocada || 0 }
  let ac2 = 0
  const porTipo = [...tipos.values()].sort((a, b) => b.ganho - a.ganho).map(o => { ac2 += o.ganho; return { ...o, ganho: r2(o.ganho), share_pct: total ? r1(100 * o.ganho / total) : 0, acum_pct: total ? r1(100 * ac2 / total) : 0, taxa_melhora: r2(o.melhorou / o.n) } })
  const n_tipos_80 = (() => { let a = 0, n = 0; for (const t of porTipo) { if (total && a / total * 100 >= pct) break; a += t.ganho; n++ } return n })()
  const semEfeito = v.filter(m => m.estado === 'sem_efeito').length, piorou = v.filter(m => m.estado === 'piorou').length
  return {
    disponivel: true, pct_alvo: pct, n_medidas: v.length, n_melhorou: ganhos.length, ganho_total: r2(total),
    n_tarefas_80: total ? n80 : 0, pct_tarefas_80: total ? r1(100 * n80 / v.length) : null, n_tipos_80: total ? n_tipos_80 : 0, por_tipo: porTipo,
    top_tarefas: ganhos.slice(0, 10).map(m => ({ id: m.id, titulo: m.titulo, tipo: m.tipo, data: m.data, itens: m.itens, efeito_pct: m.efeito_pct, ganho: m.receita_alocada, confianca: m.confianca?.score ?? null })),
    desperdicio: { sem_efeito: semEfeito, piorou, pct: r1(100 * (semEfeito + piorou) / v.length) },
    leitura: total
      ? `${n80} de ${v.length} tarefas medidas (${pt(r1(100 * n80 / v.length))}%) concentram ${pct}% do ganho associado; ${n_tipos_80} tipo(s) de tarefa respondem por ${pct}% do total. ${semEfeito + piorou} tarefa(s) (${pt(r1(100 * (semEfeito + piorou) / v.length))}%) não tiveram efeito mensurável ou pioraram.`
      : `${v.length} tarefa(s) medidas, nenhuma com ganho associado positivo — ainda não há o que concentrar.`,
  }
}

// ── 5. COMBINAÇÕES: tarefas juntas no MESMO anúncio ─────────────────────────
// Episódio = tarefas no mesmo anúncio com no máximo `janela_episodio_dias` de intervalo entre elas e ≥ 2 tipos distintos.
// O episódio inteiro é medido como UMA intervenção (efeito do anúncio com controle e placebo, mesma função do motor): a data é a da
// primeira tarefa e a defasagem cobre o intervalo até a última. Preço (grandes: Map item → [dias] de mudança ≥ limiar, precosDoCliente): o anúncio que
// mudou de preço na janela sai do controle e a data vira placebo; episódio com tarefa fora do aprendizado (preço junto, reversão) não é medido.
export function combos({ medidas, porItem, cobertura, hoje, grandes = new Map(), params = cfgAtrib, c = cfgRetro.combos, N = params.janela_dias, baseHabitual = 0.1 }) {
  const doItem = new Map()
  for (const m of medidas) {
    if (m.escopo !== 'anuncios' || !m.tipo || m.tipo === '(sem tipo)') continue
    for (const i of m.itens || []) { const l = doItem.get(i) || doItem.set(i, []).get(i); if (!l.some(t => t.id === m.id)) l.push({ id: m.id, titulo: m.titulo, tipo: famDe(m), data: m.data, lag: m.lag, fora: excluirDaAprendizagem(m) }) }
  }
  const eps = new Map()
  for (const [item, lista] of doItem) {
    lista.sort((a, b) => a.data.localeCompare(b.data))
    let cur = []
    const fecha = () => {
      if (cur.length >= 2 && new Set(cur.map(t => t.tipo)).size >= 2) {
        const key = cur.map(t => t.id).sort().join('|')
        const e = eps.get(key) || eps.set(key, { tarefas: cur.slice(), itens: new Set() }).get(key)
        e.itens.add(item)
      }
      cur = []
    }
    for (const t of lista) { if (cur.length && diasEntre(cur.at(-1).data, t.data) > c.janela_episodio_dias) fecha(); cur.push(t) }
    fecha()
  }
  const medidos = []
  for (const e of eps.values()) {
    if (e.tarefas.some(t => t.fora)) continue
    const datas = e.tarefas.map(t => t.data).sort(), d1 = datas[0], dk = datas.at(-1)
    const lag = diasEntre(d1, dk) + Math.max(...e.tarefas.map(t => t.lag ?? params.lag_dias_padrao))
    const alvoIds = [...e.itens]
    const montar = ids => ({ unidades: somarSeries(ids.map(i => porItem.get(i)?.unidades || {})), receita: somarSeries(ids.map(i => porItem.get(i)?.receita || {})), visitas: null })
    let m
    for (const Nj of params.janelas_adaptativas || [N]) {
      const tocados = new Set(alvoIds)
      const naJanela = d => d >= addDias(d1, -Nj - 3) && d <= addDias(dk, lag + Nj + 3)
      for (const [item, l] of doItem) if (!tocados.has(item) && l.some(t => naJanela(t.data))) tocados.add(item)
      for (const [item, ds] of grandes) if (ds.some(naJanela)) tocados.add(item)
      const idsCtrl = [...porItem.keys()].filter(i => !tocados.has(i))
      const placebo = [...[...doItem].filter(([i]) => alvoIds.includes(i)).flatMap(([, l]) => l.map(t => t.data)), ...alvoIds.flatMap(i => grandes.get(i) || [])]
      m = medirEfeito({ alvo: montar(alvoIds), controle: idsCtrl.length ? montar(idsCtrl) : null, data: d1, N: Nj, lag, cobertura, hoje, escopo: 'anuncios', eventosPlacebo: placebo, params })
      if (m.estado !== 'sem_base' || m.causa === 'cobertura') break
    }
    medidos.push({ tipos: [...new Set(e.tarefas.map(t => t.tipo))].sort(), tarefas: e.tarefas, itens: alvoIds, data: d1, estado: m.estado, efeito_pct: m.efeito_pct ?? null })
  }
  const validos = medidos.filter(x => ESTADOS_MEDIDOS.includes(x.estado))
  const agrupar = chaveFn => {
    const g = new Map()
    for (const x of validos) for (const k of [].concat(chaveFn(x))) (g.get(k) || g.set(k, []).get(k)).push(x)
    return [...g].map(([chave, xs]) => {
      const cel = celula(xs.map(x => ({ estado: x.estado, efeito_pct: x.efeito_pct })))
      return { chave, tipos: chave.split(' + '), ...cel, amostra_pequena: xs.length < c.min_n, exemplos: xs.slice(0, 3).map(x => ({ itens: x.itens, data: x.data, estado: x.estado, efeito_pct: x.efeito_pct, tarefas: x.tarefas.map(t => t.titulo) })) }
    }).sort((a, b) => (b.taxa_baixo ?? -1) - (a.taxa_baixo ?? -1) || b.n - a.n)
  }
  const pares = t => { const o = []; for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) o.push(`${t[i]} + ${t[j]}`); return o }
  const comb = agrupar(x => x.tipos.join(' + ')), par = agrupar(x => x.tipos.length >= 3 ? pares(x.tipos) : [])   // par só nos episódios de 3+ tipos (com 2 tipos o par É a combinação)
  const base = new Map()
  for (const x of [...comb, ...par]) base.set(x.chave, x)
  const todos = [...base.values()]
  // "funciona junto" = amostra mínima E o limite inferior de Wilson acima da taxa habitual de melhora (2 de 3 não é padrão)
  const funcionam = todos.filter(x => x.n >= c.min_n && x.melhorou >= 2 && x.taxa_baixo > baseHabitual).sort((a, b) => (b.taxa_baixo ?? -1) - (a.taxa_baixo ?? -1) || b.n - a.n)
  const candidatas = todos.filter(x => x.n >= 2 && !funcionam.includes(x) && x.melhorou >= 2 && x.melhorou / x.n >= c.min_taxa_funciona)
  const pioram = todos.filter(x => x.n >= 3 && x.piorou >= c.min_piorou_alerta && x.piorou / x.n >= 0.34).sort((a, b) => b.piorou / b.n - a.piorou / a.n)
  return {
    n_episodios: eps.size, n_medidos: validos.length, n_sem_medida: medidos.length - validos.length, min_n: c.min_n,
    funcionam, candidatas, pioram, combinacoes: comb, pares: par,
    leitura: !eps.size ? 'Não há anúncio com duas ou mais tarefas de tipos diferentes na mesma quinzena — ainda não existe combinação para avaliar.'
      : !validos.length ? `${eps.size} episódio(s) de tarefas combinadas, mas nenhum com medida completa ainda (maturação ou base pequena).`
      : funcionam.length ? `${funcionam.length} combinação(ões) com melhora acima do habitual (mínimo ${c.min_n} casos).`
      : `${validos.length} episódio(s) medidos, mas nenhuma combinação atingiu ${c.min_n} ocorrências com melhora — amostra pequena para afirmar.`,
  }
}

// ── 6. A PIOR TAREFA — para fazer com cuidado ───────────────────────────────
export function piorTarefa({ apTodos, apConta, medidasConta, hoje = hojeLocal(), c = cfgRetro.pior_tarefa }) {
  const cand = apTodos.por_tipo.filter(x => x.n >= c.min_n && x.piorou >= c.min_piorou && x.piorou / x.n >= c.min_taxa_pior)
    .sort((a, b) => b.piorou / b.n - a.piorou / a.n || a.melhorou / a.n - b.melhorou / b.n)
  const tipos = cand.slice(0, 3).map(x => {
    const nc = apConta.por_tipo.find(t => t.tipo === x.tipo)
    return {
      tipo: x.tipo, n: x.n, melhorou: x.melhorou, piorou: x.piorou, sem_efeito: x.sem_efeito, taxa_piorou: r2(x.piorou / x.n), efeito_mediano_pct: x.efeito_mediano_pct,
      conta: nc ? { n: nc.n, melhorou: nc.melhorou, piorou: nc.piorou } : null,
      leitura: `"${x.tipo}": em ${x.n} tarefas medidas, ${x.melhorou} melhoraram, ${x.sem_efeito} ficaram sem efeito e ${x.piorou} foram seguidas de piora. Não é proibição — é a tarefa que exige piloto antes de ser replicada.`,
    }
  })
  const individuais = medidasConta.filter(m => m.estado === 'piorou' && (m.receita_alocada || 0) < 0 && !excluirDaAprendizagem(m) && m.data >= addDias(hoje, -90)).sort((a, b) => a.receita_alocada - b.receita_alocada).slice(0, 3)
    .map(m => ({ id: m.id, titulo: m.titulo, tipo: m.tipo, data: m.data, itens: m.itens, efeito_pct: m.efeito_pct, perda: m.receita_alocada, confianca: m.confianca?.score ?? null }))
  return {
    disponivel: tipos.length > 0 || individuais.length > 0, tipos, tarefas_individuais: individuais, cuidados: cfgRetro.cuidados_pior_tarefa,
    leitura: tipos.length ? `Tipo de tarefa mais associado a piora: ${tipos[0].tipo} (${tipos[0].piorou} de ${tipos[0].n}).` : individuais.length ? 'Nenhum tipo atinge amostra para ser chamado de pior; há tarefas individuais seguidas de piora (abaixo).' : `Sem amostra: nenhum tipo de tarefa tem ${c.min_n}+ medidas com piora relevante.`,
    aviso: 'Associação temporal ajustada — pode haver outra causa. Por isso a recomendação é piloto, não proibição.',
  }
}

// ── 7. QUEDA: motivos, ações, tarefas, atitudes ─────────────────────────────
// diag: saída de diagnosticarConta (28d × 28d) ou null; medidas: anotadas; execucao: { c14, p14, bloqueadas }.
export function diagnosticarQueda({ estado, diag, medidas, execucao, apConta, apOutros, hoje, c = cfgRetro }) {
  const Q = c.queda, motivos = [], push = m => motivos.push({ tipo: 'fato', interno: false, regras: [], tipos: [], itens: [], ...m })
  const itens = diag?.disponivel ? diag.itens : []
  const gmv = diag?.resumo?.gmv || 0
  const dAnuncio = i => ({ id: i.id, titulo: i.titulo, thumb: i.thumb, permalink: i.permalink, catalogo_origem: i.catalogo_origem || 'nao', delta: r2(i.r - i.r0), receita: i.r, receita_anterior: i.r0 })

  // elo rompido (visitas × conversão × ticket) — 28d × 28d, mesma definição dos relatórios
  const causal = diag?.causal
  if (causal?.disponivel && causal.ruptura && c.elos[causal.ruptura]) {
    const e = c.elos[causal.ruptura]
    push({ k: 'elo_rompido', rotulo: `Elo rompido: ${e.rotulo}`, texto: causal.leitura, evidencia: `faturamento ${causal.deltas.faturamento}% · visitas ${causal.deltas.visitas ?? '—'}% · conversão ${causal.deltas.conversao ?? '—'} p.p. · ticket ${causal.deltas.ticket ?? '—'}% (28 dias contra 28 anteriores)`, peso: 80, regras: e.regras, tipos: e.tipos, acao: e.acao })
  }
  // ruptura de estoque em anúncio relevante
  const rup = itens.filter(i => i.cobertura != null && i.cobertura < Q.limiar_ruptura_dias && i.curva !== 'C')
  const shareRup = rup.reduce((t, i) => t + (i.share_pct || 0), 0)
  if (rup.length && shareRup >= Q.min_share_ruptura_pct)
    push({ k: 'ruptura_estoque', rotulo: 'Estoque curto em anúncio que vende', texto: `${rup.length} anúncio(s) relevante(s) com estoque para menos de ${Q.limiar_ruptura_dias} dias, somando ${r1(shareRup)}% da receita.`, evidencia: rup.slice(0, 3).map(i => `${i.id}: ${i.cobertura} dia(s)`).join('; '), peso: 85, regras: ['estoque_ruptura'], tipos: ['Planejamento full'], itens: rup.slice(0, 5).map(dAnuncio), acao: 'Repor antes de zerar — ruptura derruba o ranking além da venda perdida.' })
  // catálogo / caixa de compra
  const bb = itens.filter(i => i.catalogo && i.buy_box === false)
  if (bb.length) push({ k: 'caixa_de_compra', rotulo: 'Caixa de compra perdida', texto: `${bb.length} anúncio(s) de catálogo sem a caixa de compra (${r1(bb.reduce((t, i) => t + (i.share_pct || 0), 0))}% da receita).`, evidencia: bb.slice(0, 3).map(i => i.id).join(', '), peso: 78, regras: ['catalogo_buybox'], tipos: ['Corrigir Anúncios'], itens: bb.slice(0, 5).map(dAnuncio), acao: 'Comparar oferta com a vencedora (preço, frete, Full) e igualar só se a margem permitir.' })
  // anúncio que vendia e parou/pausou
  const parados = itens.filter(i => i.r0 > 0 && i.status && i.status !== 'active')
  if (parados.length) push({ k: 'anuncio_inativo', rotulo: 'Anúncio que vendia está inativo', texto: `${parados.length} anúncio(s) que vendiam no período anterior estão fora do ar (${[...new Set(parados.map(i => i.status))].join(', ')}).`, evidencia: `receita perdida ≈ R$ ${Math.round(parados.reduce((t, i) => t + Math.max(0, i.r0 - i.r), 0)).toLocaleString('pt-BR')}`, peso: 82, tipos: ['Corrigir Anúncios'], itens: parados.slice(0, 5).map(dAnuncio), acao: 'Descobrir o motivo (pausa, moderação, estoque) e reativar.' })
  // concentração da perda
  const perdedores = itens.filter(i => i.r < i.r0).sort((a, b) => (a.r - a.r0) - (b.r - b.r0))
  const perdaTotal = perdedores.reduce((t, i) => t + (i.r0 - i.r), 0)
  if (perdedores.length >= 3 && perdaTotal > 0) {
    let acum = 0, n = 0
    for (const i of perdedores) { acum += i.r0 - i.r; n++; if (acum / perdaTotal * 100 >= Q.concentracao_top_pct) break }
    if (n <= Math.max(2, Math.ceil(perdedores.length * 0.25)))
      push({ k: 'perda_concentrada', rotulo: 'A queda está concentrada em poucos anúncios', texto: `${n} anúncio(s) respondem por ${Q.concentracao_top_pct}% da perda de receita (R$ ${Math.round(perdaTotal).toLocaleString('pt-BR')} no total entre os ${perdedores.length} que caíram).`, evidencia: perdedores.slice(0, n).map(i => `${i.id}: R$ ${Math.round(i.r0 - i.r)}`).join('; '), peso: 70, itens: perdedores.slice(0, n).map(dAnuncio), acao: 'Foco nesses anúncios antes de abrir qualquer frente nova.' })
  }
  // mercado × nossas mexidas: anúncios SEM tarefa recente também caíram?
  const tocados = new Set(medidas.filter(m => m.data >= addDias(hoje, -42)).flatMap(m => m.itens || []))
  // controle = anúncios SEM tarefa que estão no ar e com estoque: anúncio fechado/pausado/sem estoque cai por outro motivo e contaminaria o "mercado"
  const ctrl = itens.filter(i => !tocados.has(i.id) && (!i.status || i.status === 'active') && !(i.cobertura != null && i.cobertura < Q.limiar_ruptura_dias))
  const rCtrl0 = ctrl.reduce((t, i) => t + i.r0, 0), rCtrl = ctrl.reduce((t, i) => t + i.r, 0)
  const alvo = itens.filter(i => tocados.has(i.id))
  if (ctrl.length >= 3 && rCtrl0 >= Q.min_receita_controle && alvo.length) {
    const vc = pctVar(rCtrl, rCtrl0), va = pctVar(alvo.reduce((t, i) => t + i.r, 0), alvo.reduce((t, i) => t + i.r0, 0))
    if (vc != null && vc <= -Q.mercado_queda_controle_pct) push({ k: 'mercado', rotulo: 'A queda também atinge os anúncios que ninguém mexeu', texto: `Os ${ctrl.length} anúncios sem tarefa nas últimas semanas também caíram ${Math.abs(vc)}% — o movimento parece de MERCADO/sazonalidade, não de uma mexida nossa.`, evidencia: `sem tarefa: ${vc}% · com tarefa: ${va ?? '—'}%`, peso: 65, tipo: 'hipotese', acao: 'Não reverter o que foi feito por causa da queda; proteger margem e estoque e esperar a demanda voltar.' })
    else if (vc != null && va != null && vc > -3 && va <= -Q.mercado_queda_controle_pct && alvo.length >= Q.queda_nos_tocados_min_anuncios && alvo.reduce((t, i) => t + i.r0, 0) >= Q.min_receita_controle) push({ k: 'queda_nos_tocados', rotulo: 'A queda está nos anúncios em que mexemos', texto: `Os anúncios SEM tarefa recente ficaram estáveis (${vc}%), enquanto os ${alvo.length} que receberam tarefa caíram ${Math.abs(va)}%. Isso é um sinal de que alguma mudança pode ter atrapalhado.`, evidencia: `sem tarefa: ${vc}% · com tarefa: ${va}%`, peso: 60, interno: true, tipo: 'hipotese', tipos: [], acao: 'Revisar as mudanças feitas nesses anúncios (título, preço, foto) e reverter a que for suspeita, uma por vez.', itens: alvo.filter(i => i.r < i.r0).slice(0, 5).map(dAnuncio) })
  }
  // tarefas recentes seguidas de piora (já medidas)
  const piorou = medidas.filter(m => m.estado === 'piorou' && m.data >= addDias(hoje, -60) && !excluirDaAprendizagem(m)).sort((a, b) => (a.receita_alocada || 0) - (b.receita_alocada || 0))
  if (piorou.length) push({ k: 'tarefa_piorou', interno: true, rotulo: 'Tarefa recente seguida de piora', texto: `${piorou.length} tarefa(s) concluída(s) nos últimos 60 dias foram seguidas de piora medida no anúncio (ajustada pelo grupo de controle).`, evidencia: piorou.slice(0, 3).map(m => `${m.tipo} em ${m.data.split('-').reverse().join('/')} (${m.efeito_pct}%)`).join('; '), peso: 75, tipo: 'hipotese', acao: 'Reverter ou revisar a mudança do anúncio e NÃO replicar essa tarefa em outros anúncios até entender.', itens: [] })
  // Ads
  const ads = diag?.ads
  if (ads?.anterior?.custo > 0) {
    if (ads.custo_var_pct != null && ads.custo_var_pct <= -Q.ads_queda_investimento_pct && (ads.receita < ads.anterior.receita))
      push({ k: 'ads_menos_verba', rotulo: 'Menos investimento em Ads', texto: `O investimento em Ads caiu ${Math.abs(ads.custo_var_pct)}% e a receita atribuída a Ads também (R$ ${Math.round(ads.anterior.receita)} → R$ ${Math.round(ads.receita)}).`, evidencia: `ROAS ${ads.anterior.roas ?? '—'} → ${ads.roas ?? '—'}`, peso: 60, regras: ['ads_escalar'], tipos: ['Ajuste ADS'], acao: 'Recolocar verba onde o ROAS é maior que o da conta.' })
    else if (ads.roas != null && ads.anterior.roas && ads.roas <= ads.anterior.roas * (1 - Q.ads_queda_roas_pct / 100))
      push({ k: 'ads_eficiencia', rotulo: 'Ads ficou menos eficiente', texto: `O ROAS caiu de ${ads.anterior.roas} para ${ads.roas}.`, evidencia: `custo R$ ${Math.round(ads.anterior.custo)} → R$ ${Math.round(ads.custo)}`, peso: 58, regras: ['ads_reduzir', 'ads_otimizar_antes'], tipos: ['Ajuste ADS'], acao: 'Cortar verba dos anúncios abaixo do ROAS de equilíbrio e corrigir a conversão antes de gastar mais.' })
  }
  // execução da equipe (Notion)
  if (execucao && execucao.p14 >= Q.execucao_base_minima && execucao.c14 <= execucao.p14 * (1 - Q.execucao_queda_pct / 100))
    push({ k: 'execucao', interno: true, rotulo: 'A equipe entregou menos', texto: `Entregas caíram de ${execucao.p14} para ${execucao.c14} nas últimas duas semanas${execucao.bloqueadas ? ` e há ${execucao.bloqueadas} tarefa(s) bloqueadas` : ''}.${execucao.aguardando_cliente ? ` ${execucao.aguardando_cliente} aguardam retorno do cliente.` : ''}`, evidencia: 'tarefas concluídas no Notion (14 dias × 14 anteriores)', peso: 50, tipo: 'hipotese', acao: 'Destravar o que está bloqueado e retomar a cadência antes de mexer na estratégia.' })

  motivos.sort((a, b) => b.peso - a.peso)
  const principais = motivos.slice(0, 5)
  if (!principais.length) principais.push({ k: 'difusa', rotulo: 'Queda difusa', texto: 'Nenhuma causa isolada aparece nos dados disponíveis (elo, estoque, caixa de compra, Ads, mercado e tarefas foram checados).', evidencia: '', peso: 0, tipo: 'hipotese', regras: [], tipos: [], itens: [], acao: 'Investigar os três elos (tráfego, conversão, ticket) anúncio a anúncio nos 20% que vendem.' })

  const acoes = []
  for (const m of principais) for (const r of m.regras || []) { const desc = algoritmo.regras.find(x => x.id === r)?.descricao; if (desc && !acoes.some(a => a.regra === r)) acoes.push({ regra: r, descricao: desc, por_causa_de: m.k, interno: !!m.interno }) }
  const tarefas = []
  for (const m of principais) for (const t0 of m.tipos || []) {
    const t = nomeFamilia(t0)
    if (tarefas.some(x => x.tipo === t)) continue
    const ev = apConta.por_tipo_estado.find(x => x.tipo === t && x.estado === 'queda') || apConta.por_tipo.find(x => x.tipo === t) || apOutros.por_tipo.find(x => x.tipo === t) || null
    tarefas.push({ tipo: t, por_causa_de: m.k, veredito: ev?.veredito || 'sem_amostra', n: ev?.n || 0, melhorou: ev?.melhorou || 0 })
  }
  // tarefas com veredito "não funciona" vão para o fim (não se recomenda gastar o time nelas primeiro)
  const ordem = { funciona: 0, inconclusivo: 1, sem_amostra: 1, nao_funciona: 2 }
  tarefas.sort((a, b) => ordem[a.veredito] - ordem[b.veredito])
  const atitudes = [...c.playbook.queda.atitudes], atitudesInternas = []
  if (principais.some(m => m.k === 'tarefa_piorou' || m.k === 'queda_nos_tocados')) atitudesInternas.push('Antes de abrir tarefa nova: revisar as mudanças recentes nos anúncios que caíram — a causa pode ser uma delas (reverter UMA por vez).')
  if (principais.some(m => m.k === 'execucao')) atitudesInternas.push('Destravar o que está bloqueado e retomar a cadência antes de mexer na estratégia.')
  if (principais[0]?.k === 'mercado') atitudes.unshift('Como o movimento parece de mercado (os anúncios sem mudança também caíram), vamos manter o que funciona e proteger margem e estoque, em vez de mexer no que não está quebrado.')
  const aviso_janela = estado.confirmacao_28d && estado.confirmacao_28d.estado !== 'queda' ? 'Os motivos por anúncio abaixo comparam 28 dias com os 28 anteriores; a queda dos últimos 14 dias pode ainda não aparecer neles por inteiro.' : null
  return { disponivel: true, motivos: principais, acoes, tarefas, atitudes, atitudes_internas: atitudesInternas, aviso_janela, fonte_itens: diag?.disponivel ? 'janela de 28 dias contra 28 anteriores' : 'indisponível (sem diagnóstico por anúncio)' }
}

// ── 8. JOGADAS do estado (o que fazer em cada etapa), moduladas pelo que a conta já provou ──
export function jogadasDoEstado({ estado, apConta, apOutros, abertasPorRegra = {}, protegidos = [], c = cfgRetro }) {
  const pb = c.playbook[estado]
  if (!pb) return null
  const evTipo = t0 => { const t = nomeFamilia(t0), a = apConta.por_tipo.find(x => x.tipo === t), b = apOutros.por_tipo.find(x => x.tipo === t); return { conta: a ? { n: a.n, melhorou: a.melhorou, veredito: a.veredito } : null, outros: b ? { n: b.n, melhorou: b.melhorou, veredito: b.veredito } : null } }
  const vencedores = apConta.por_tipo.filter(x => x.veredito === 'funciona')
  const jogadas = pb.jogadas.map(j => {
    let tipos = j.tipos, extra = null
    if (j.k === 'replicar') {
      tipos = vencedores.map(x => x.tipo)
      extra = vencedores.length ? `Tipos que já funcionaram nesta conta: ${vencedores.map(x => `${x.tipo} (${x.melhorou} de ${x.n})`).join('; ')}.` : `Esta conta ainda não tem um tipo de tarefa com resultado medido (amostra mínima de ${c.plano.min_n_aprendizado} tarefas medidas) — usar a jogada 2 e medir.`
    }
    if (j.k === 'nao_mexer') extra = protegidos.length ? `${protegidos.length} anúncio(s) em janela de proteção: ${protegidos.slice(0, 4).map(p => `${p.item_id} até ${p.ate.split('-').reverse().join('/')}`).join('; ')}.` : 'Nenhum anúncio em janela de proteção agora.'
    const nomes = [...new Set(tipos.map(nomeFamilia))]
    return { k: j.k, titulo: j.titulo, porque: j.porque, extra, regras: j.regras.map(r => ({ regra: r, abertas: abertasPorRegra['anuncio_' + r] || 0 })), tipos: nomes.map(t => ({ tipo: t, ...evTipo(t) })) }
  })
  return { estado, rotulo: pb.rotulo, titulo: pb.titulo, leitura: pb.leitura, jogadas, atitudes: pb.atitudes }
}

// ── 9. banco: séries, anotação e orquestração ───────────────────────────────
export function serieConta(cliente) {
  const s = { unidades: {}, receita: {}, visitas: {} }
  for (const r of db.prepare('SELECT dia, SUM(unidades) u, SUM(receita) r, SUM(visitas) v FROM meli_serie_item WHERE cliente = ? GROUP BY dia').all(cliente)) { s.unidades[r.dia] = r.u || 0; s.receita[r.dia] = r.r || 0; s.visitas[r.dia] = r.v || 0 }
  return s
}
export const anotar = (medidas, serie, cob) => medidas.map(m => ({ ...m, estado_antes: classificarEstado({ serie, ate: addDias(m.data, -1), cob, _confirmar: false }).estado }))

const cacheGlobal = new WeakMap()
function medidasDosOutros(cliente) {
  const p = padroesGlobaisCache()
  let por = cacheGlobal.get(p)
  if (!por) {
    por = new Map()
    for (const a of p.analises || []) { const nicho = a.nicho ?? nichoDe(a.cliente); por.set(a.cliente, anotar(a.medidas.map(m => ({ ...m, cliente: a.cliente, nicho })), serieConta(a.cliente), a.cobertura)) }
    cacheGlobal.set(p, por)
  }
  return [...por].filter(([c]) => c !== cliente).flatMap(([, ms]) => ms)
}

const cacheDup = new WeakMap()
function duplicacoesDosOutros(cliente) {
  const p = padroesGlobaisCache()
  let por = cacheDup.get(p)
  if (!por) {
    por = new Map()
    for (const a of p.analises || []) { try { por.set(a.cliente, duplicacoesDoCliente(a.cliente, { analise: a })) } catch { /* cliente sem dado suficiente: fora da base de duplicação */ } }
    cacheDup.set(p, por)
  }
  return [...por].filter(([c]) => c !== cliente).flatMap(([, e]) => e)
}

export function execucaoDoCliente(cliente, hoje) {
  const fim = db.prepare(`SELECT NULLIF(data_conclusao,'') dc, last_edited le FROM tarefas WHERE arquivada = 0 AND cliente = ? AND status = 'concluida' AND titulo NOT LIKE '%· PS-%'`).all(cliente).map(r => r.dc || diaBR(r.le)).filter(Boolean)   // mesmo dia (fuso BR) do motor de atribuição
  const n = (a, b) => fim.filter(d => d >= a && d <= b).length
  return {
    c14: n(addDias(hoje, -13), hoje), p14: n(addDias(hoje, -27), addDias(hoje, -14)),
    bloqueadas: db.prepare("SELECT COUNT(*) n FROM tarefas WHERE arquivada = 0 AND cliente = ? AND status = 'bloqueada'").get(cliente).n,   // só impedimento interno
    aguardando_cliente: db.prepare("SELECT COUNT(*) n FROM tarefas WHERE arquivada = 0 AND cliente = ? AND status = 'dependencia_cliente'").get(cliente).n,
  }
}

// retrato do ciclo: o que o sistema pensava (estado, fatores aplicados) para o próximo ciclo poder se avaliar
export function registrarCiclo(cliente, retro, hoje = hojeLocal()) {
  const resumo = { estado: retro.estado.estado, variacao_pct: retro.estado.variacao_pct, recomendadas: Object.values(retro.fatores || {}).filter(f => f.fator !== 1).sort((a, b) => b.fator - a.fator).slice(0, 6).map(f => ({ regra: f.regra, fator: f.fator })), motivos: (retro.queda?.motivos || []).map(m => m.k),
    estrategia: retro.estrategia ? { classe: retro.estrategia.classe, provisoria: retro.estrategia.provisoria } : null }   // aditivo: cicloAnterior continua lendo só estado/recomendadas
  db.prepare('INSERT INTO retro_ciclo (cliente, dia, estado, variacao_pct, resumo_json, criado_em) VALUES (?,?,?,?,?,?) ON CONFLICT(cliente, dia) DO UPDATE SET estado = excluded.estado, variacao_pct = excluded.variacao_pct, resumo_json = excluded.resumo_json, criado_em = excluded.criado_em')
    .run(cliente, hoje, resumo.estado, resumo.variacao_pct ?? null, JSON.stringify(resumo), agora())
}
const ORDEM_ESTADO = { queda: 0, estagnacao: 1, crescimento: 2 }
export function cicloAnterior(cliente, estadoAtual, hoje, { minDias = 10 } = {}) {
  const r = db.prepare('SELECT * FROM retro_ciclo WHERE cliente = ? AND dia <= ? ORDER BY dia DESC LIMIT 1').get(cliente, addDias(hoje, -minDias))
  if (!r) return null
  const resumo = JSON.parse(r.resumo_json)
  const executadas = db.prepare("SELECT COUNT(*) n FROM acoes_plano WHERE cliente = ? AND status = 'distribuida' AND SUBSTR(distribuido_em, 1, 10) > ?").get(cliente, r.dia).n
  const a = ORDEM_ESTADO[r.estado], b = ORDEM_ESTADO[estadoAtual]
  return { dia: r.dia, estado: r.estado, variacao_pct: r.variacao_pct, evolucao: a == null || b == null ? 'sem_comparacao' : b > a ? 'melhorou' : b < a ? 'piorou' : 'igual', acoes_executadas_desde: executadas, recomendadas: resumo.recomendadas }
}
export const historicoCiclos = (cliente, n = 8) => db.prepare('SELECT dia, estado, variacao_pct FROM retro_ciclo WHERE cliente = ? ORDER BY dia DESC LIMIT ?').all(cliente, n)

// anúncios com tarefa que MELHOROU nos últimos 14 dias de janela: ficam protegidos (sem mexer até estabilizar)
function protegidosDe(medidas, hoje) {
  const m = new Map()
  for (const x of medidas) if (x.estado === 'melhorou' && x.janelas?.pos?.[1] && x.janelas.pos[1] >= addDias(hoje, -14)) for (const i of x.itens || []) m.set(i, { item_id: i, ate: addDias(x.janelas.pos[1], 14), tarefa: x.titulo })
  return [...m.values()]
}

// limites da leitura com a data em que o histórico do anúncio começou nesta conta e o limiar de preço do motor
const limitesDe = cliente => {
  const ini = historico.inicioHistorico(cliente)
  return cfgRetro.limites.map(l => l.replace('{inicio_historico}', ini ? ini.split('-').reverse().join('/') : 'a primeira coleta que registrar uma mudança (nenhuma registrada ainda nesta conta)')
    .replace('{limiar_preco}', pt(cfgAtrib.preco?.limiar_confundidor_pct ?? 3)))
}
export function retroalimentar(cliente, { hoje = hojeLocal(), diag = null, analise = null, globais = null, salvar = false } = {}) {
  const cob = coberturaPedidos(cliente)
  const serie = serieConta(cliente)
  // conta coletada (cobertura de pedidos, a mesma das telas) sem venda registrada não é "não coletada": o motivo distingue os dois
  if (!Object.keys(serie.unidades).length) return { disponivel: false, motivo: cob?.de ? `conta coletada (pedidos lidos de ${cob.de.split('-').reverse().join('/')} a ${cob.ate.split('-').reverse().join('/')}) sem venda registrada: sem série de vendas para ler o estado` : 'sem série de vendas coletada do Mercado Livre — conecte a conta e rode a coleta' }
  const ate = cob?.ate && cob.ate < addDias(hoje, -1) ? cob.ate : addDias(hoje, -1)
  let estado = classificarEstado({ serie, ate, cob }), semBasePorColeta = null
  // dia que falhou na coleta (ou truncado) NÃO é dia sem venda: a janela com buraco vira "sem base" (ou ao menos avisa)
  if (estado.janela) {
    const q = qualidadeNoIntervalo(cliente, estado.janela.anterior[0], ate)
    if (!q.completo) {
      if (estado.estado !== 'sem_base' && q.faltam.length > 3) { semBasePorColeta = `${q.faltam.length} dia(s) da janela sem coleta de pedidos — comparar vendas com buraco no histórico enganaria`; estado = { estado: 'sem_base', rotulo: ROTULO_ESTADO.sem_base, motivo: semBasePorColeta, janela: estado.janela } }
      else estado.aviso_coleta = `${q.faltam.length} dia(s) sem coleta e ${q.truncados} truncado(s) na janela — a variação pode estar subestimada`
    }
  }
  analise ??= analisarCliente(cliente, { hoje })
  const minhas = anotar(analise.medidas.map(m => ({ ...m, cliente })), serie, cob)
  const outras = globais ?? medidasDosOutros(cliente)
  const apConta = aprender(minhas), apOutros = aprender(outras), apTodos = aprender([...minhas, ...outras])
  try { diag ??= diagnosticarConta(cliente, { hoje }) } catch { diag = null }
  const itens = diag?.disponivel ? diag.itens : []
  // duplicação estratégica: o sistema aprende por FAMÍLIA (original + duplicatas) — objetivo, volume, aderência ao método e canibalização
  let duplic = null
  try {
    const minhasDup = duplicacoesDoCliente(cliente, { analise, hoje }), outrasDup = globais ? [] : duplicacoesDosOutros(cliente)
    const vd = (n, k, b) => veredito(n, k, b)
    const conta = aprenderDuplicacao(minhasDup, { minN: cfgRetro.plano.min_n_aprendizado, veredito: vd }), todas = aprenderDuplicacao([...minhasDup, ...outrasDup], { minN: cfgRetro.plano.min_n_aprendizado, veredito: vd })
    duplic = { episodios: minhasDup.slice(0, 25), conta, base: todas, fator_por_objetivo: fatorPorObjetivo(todas, { minN: cfgRetro.plano.min_n_aprendizado }) }
  } catch (e) { duplic = { erro: String(e.message).slice(0, 160) } }
  // ações abertas do plano (regra + gatilho de duplicação): contagem por regra para as jogadas e parcela de cadastro/G1 para a estratégia
  const abertas = db.prepare("SELECT regra, json_extract(dados_json, '$.duplicacao.gatilho') gatilho FROM acoes_plano WHERE cliente = ? AND status IN ('proposta','aprovada')").all(cliente)
  const abertasPorRegra = {}
  for (const a of abertas) abertasPorRegra[a.regra] = (abertasPorRegra[a.regra] || 0) + 1
  // ESTRATÉGIA (conta e por curva A/B/C): encaixe do estado com economia do Ads, ruptura e cobertura; sempre provisória (caixa/capacidade/mercado não existem)
  const limRup = cfgRetro.queda.limiar_ruptura_dias
  const shareRup = lista => { const tot = lista.reduce((t, i) => t + i.r, 0); return tot > 0 ? r1(100 * lista.filter(i => i.cobertura != null && i.cobertura < limRup).reduce((t, i) => t + i.r, 0) / tot) : null }
  const metasRow = db.prepare('SELECT metas_json FROM metas_cliente WHERE cliente = ? AND mes = ?').get(cliente, hoje.slice(0, 7))
  let metas = null; try { metas = metasRow ? JSON.parse(metasRow.metas_json) : null } catch { metas = null }
  const ctxConta = { economia: diag?.economia ?? null, custos: !!diag?.custos_informados, ads: (diag?.ads?.custo || 0) > 0, metas, cobertura_dias: cob?.dias ?? 0, acoes: abertas, hoje }
  const paretoI = paretoItens(itens)
  const estrategia = classificarEstrategia({ ...ctxConta, estado, concentracao: paretoI.disponivel ? { concentracao_top1_pct: paretoI.concentracao_top1_pct } : null, share_ruptura_pct: shareRup(itens) })
  const porGrupo = {}, seriesItem = itens.length ? itensSerie(cliente) : null
  for (const curva of ['A', 'B', 'C']) {
    const grupo = itens.filter(i => i.curva === curva)
    if (grupo.length < 2) { porGrupo[curva] = { curva, n_anuncios: grupo.length, estado: null, estrategia: null, motivo: `${grupo.length} anúncio(s) na curva ${curva} (mínimo 2 para ler o grupo)` }; continue }
    const eg = semBasePorColeta ? { estado: 'sem_base', motivo: semBasePorColeta } : classificarEstado({ serie: { unidades: somarSeries(grupo.map(i => seriesItem.get(i.id)?.unidades || {})), receita: somarSeries(grupo.map(i => seriesItem.get(i.id)?.receita || {})) }, ate, cob })
    porGrupo[curva] = { curva, n_anuncios: grupo.length, estado: { estado: eg.estado, variacao_pct: eg.variacao_pct ?? null, forca: eg.forca ?? null, significativo: !!eg.significativo, sinal_misto: eg.sinal_misto ?? null, motivo: eg.motivo ?? null },
      estrategia: classificarEstrategia({ ...ctxConta, estado: eg, concentracao: null, share_ruptura_pct: shareRup(grupo) }) }
  }
  // nicho da conta: só as OUTRAS contas do mesmo nicho (a conta já entra pela própria célula); sem nicho registrado = comportamento de sempre
  const nicho = nichoDe(cliente), apNicho = nicho !== SEM_NICHO ? aprender(outras.filter(m => m.nicho === nicho)) : null
  const fatores = estado.estado === 'sem_base' ? {} : fatoresDoPlano({ estado: estado.estado, apConta, apOutros, apNicho, nicho, estrategia: estrategia.classe })
  const protegidos = protegidosDe(analise.medidas, hoje)
  const queda = estado.estado === 'queda' ? diagnosticarQueda({ estado, diag, medidas: minhas, execucao: execucaoDoCliente(cliente, hoje), apConta, apOutros, hoje }) : null
  const out = {
    disponivel: true, cliente, hoje, estado, estrategia, estrategia_por_grupo: porGrupo, queda,
    jogadas: estado.estado === 'sem_base' ? null : jogadasDoEstado({ estado: estado.estado, apConta, apOutros, abertasPorRegra, protegidos }),
    aprendizado: { conta: apConta, outros_n: apOutros.n, geral_todos: apTodos.geral, por_tipo: apTodos.por_tipo.map(t => ({ ...t, conta: apConta.por_tipo.find(x => x.tipo === t.tipo) || null })), funciona: apTodos.por_tipo.filter(x => x.veredito === 'funciona').map(x => x.tipo), nao_funciona: apTodos.por_tipo.filter(x => x.veredito === 'nao_funciona').map(x => x.tipo) },
    pareto: { itens: paretoI, tarefas: { ...paretoTarefas(minhas.filter(m => m.data >= addDias(hoje, -90))), periodo_dias: 90 } },   // o ganho tem período: tarefas dos últimos 90 dias
    combos: combos({ medidas: analise.medidas, porItem: itensSerie(cliente), cobertura: cob, hoje, grandes: precosDoCliente(cliente).grandes, baseHabitual: apTodos.base ?? 0.1 }),
    pior_tarefa: piorTarefa({ apTodos, apConta, medidasConta: minhas, hoje }),
    risco_estoque: itens.filter(i => i.cobertura != null && i.cobertura < cfgRetro.queda.limiar_ruptura_dias && i.curva !== 'C' && i.u >= 3 && (!i.produto?.ligado || i.produto.representa_estoque !== false)).sort((a, b) => a.cobertura - b.cobertura).slice(0, 5).map(i => ({ id: i.id, titulo: i.titulo, thumb: i.thumb, permalink: i.permalink, cobertura_dias: i.cobertura, estoque: i.estoque })),   // F3: 1× por estoque físico (representante)
    protegidos, fatores, duplicacao: duplic,
    ciclo_anterior: cicloAnterior(cliente, estado.estado, hoje), historico: historicoCiclos(cliente),
    limites: limitesDe(cliente),
  }
  out.leitura = leituraExecutiva(out)
  if (salvar) registrarCiclo(cliente, out, hoje)
  return out
}

// séries por anúncio no formato do motor ({unidades, receita, visitas})
export function itensSerie(cliente) {
  const por = new Map()
  for (const r of db.prepare('SELECT item_id, dia, unidades, receita, visitas FROM meli_serie_item WHERE cliente = ?').all(cliente)) {
    const o = por.get(r.item_id) || { unidades: {}, receita: {}, visitas: {} }
    if (r.unidades) { o.unidades[r.dia] = r.unidades; o.receita[r.dia] = r.receita }
    if (r.visitas) o.visitas[r.dia] = r.visitas
    por.set(r.item_id, o)
  }
  return por
}

function leituraExecutiva(r) {
  const e = r.estado
  if (e.estado === 'sem_base') return `Sem leitura de estado: ${e.motivo}.`
  const quando = `${e.variacao_pct > 0 ? '+' : ''}${pt(e.variacao_pct)}% de receita nos últimos ${e.janela_dias} dias contra os ${e.janela_dias} anteriores`
  const base = e.estado === 'queda' ? `A conta está em QUEDA${e.forca === 'forte' ? ' forte' : ''} (${quando}).` : e.estado === 'crescimento' ? `A conta está em CRESCIMENTO${e.forca === 'forte' ? ' forte' : ''} (${quando}).` : e.dentro_do_ruido ? `A conta está em ESTAGNAÇÃO (${quando}; a oscilação está dentro do ruído de contagem).` : `A conta está em ESTAGNAÇÃO (${quando}).`
  const m0 = r.queda?.motivos?.find(m => !m.interno && m.k !== 'difusa')
  const causa = m0 ? (m0.tipo === 'fato' ? ` Causa mais provável: ${m0.rotulo.toLowerCase()}.` : ` Hipótese principal: ${m0.rotulo.toLowerCase()}.`) : ''
  const p = r.pareto.itens.disponivel ? ` ${r.pareto.itens.leitura}` : ''
  return base + causa + p
}
