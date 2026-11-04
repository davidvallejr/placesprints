// Neo — ajustes do próprio Algoritmo («Neo aprende sobre si», 04/11/2026; decisão do David: propõe e APLICA após 48 h sem veto; chave global nasce desligada).
// PURO: sem banco, sem disco, sem relógio — tudo entra por parâmetro. Nenhum segundo motor: o Neo só re-estima o que o Oráculo (priorEfetivo) e o Arquiteto
// (montarAcoes) já leem, e só com evidência numérica gravada por calibracao_dia (2 fotos consecutivas). algoritmo.json nunca muda: o resultado vai para
// config/algoritmo-aprendido.json (overrides por regra: p_sucesso, ativa).
//  proporAjustes({ fotos, priors, aprendido, isentas, abertas, cfg }) → [{ tipo, alvo, de, para, evidencia, aplicavel }]
//    tipos: ajustar_prior (premissa p_sucesso → taxa observada encolhida, passo limitado) · quarentena_regra (n ≥ 10 e Wilson alto < 0,25 nas 2 fotos → ativa:false)
//           · reativar_regra (em quarentena e Wilson baixo ≥ piso nas 2 fotos) · recuar_degrau (família com Brier > 0,30 nas 2 fotos; só registra: o executor F7 não existe)
//  aplicarNoAprendido(aprendido, proposta, { agora }) → novo objeto de overrides · reverterNoAprendido(aprendido, proposta) → volta ao «de»
//  vencidas(propostas, agoraISO) → as de estado 'proposta' com veto_ate ≤ agora e aplicavel

export const TIPOS = Object.freeze(['ajustar_prior', 'quarentena_regra', 'reativar_regra', 'recuar_degrau'])
const r2 = x => Math.round(x * 100) / 100
const clamp = (x, a, b) => Math.min(b, Math.max(a, x))
const resumoFoto = (dia, l) => ({ dia, n: l.n, acertos: l.acertos, taxa: l.taxa, taxa_baixo: l.taxa_baixo, taxa_alto: l.taxa_alto, brier: l.brier })

// fotos: { regra: [{ dia, linhas: [{ chave, n, acertos, taxa, taxa_baixo, taxa_alto, brier }] }, …] (mais recente primeiro), familia: [...] }
export function proporAjustes({ fotos = {}, priors = {}, aprendido = {}, isentas = [], abertas = new Set(), cfg = {} } = {}) {
  const need = Number(cfg.fotos_necessarias) || 2
  const P = { n_min: 30, delta_min: 0.15, passo_max: 0.2, k_pseudo: 5, ...(cfg.prior || {}) }
  const Q = { n_min: 10, taxa_alto_max: 0.25, ...(cfg.quarentena || {}) }
  const R = { taxa_baixo_min: 0.3, ...(cfg.reativar || {}) }
  const D = { n_min: 20, brier_max: 0.3, ...(cfg.degrau || {}) }
  const isenta = new Set(isentas), out = []
  const aberta = (tipo, alvo) => abertas.has(`${tipo}|${alvo}`)
  const serie = (escopo, chave) => {
    const fs = (fotos[escopo] || []).slice(0, need)
    if (fs.length < need) return null
    const ls = fs.map(f => ({ dia: f.dia, l: (f.linhas || []).find(x => x.chave === chave) }))
    return ls.every(x => x.l) ? ls : null
  }
  const chavesRegra = [...new Set((fotos.regra || []).slice(0, need).flatMap(f => (f.linhas || []).map(l => l.chave)))]
  for (const chave of chavesRegra) {
    if (isenta.has(chave)) continue
    const s = serie('regra', chave); if (!s) continue
    const evid = { fotos: s.map(x => resumoFoto(x.dia, x.l)) }, ultima = s[0].l
    const emQuarentena = aprendido[chave]?.ativa === false
    if (!emQuarentena && s.every(x => x.l.n >= Q.n_min && x.l.taxa_alto != null && x.l.taxa_alto < Q.taxa_alto_max)) {
      if (!aberta('quarentena_regra', chave)) out.push({ tipo: 'quarentena_regra', alvo: chave, de: { ativa: true }, para: { ativa: false }, evidencia: { ...evid, regra: `n ≥ ${Q.n_min} e Wilson alto < ${Q.taxa_alto_max} em ${need} fotos` }, aplicavel: true })
      continue
    }
    if (emQuarentena) {
      if (s.every(x => x.l.n >= Q.n_min && x.l.taxa_baixo != null && x.l.taxa_baixo >= R.taxa_baixo_min) && !aberta('reativar_regra', chave))
        out.push({ tipo: 'reativar_regra', alvo: chave, de: { ativa: false }, para: { ativa: true }, evidencia: { ...evid, regra: `Wilson baixo ≥ ${R.taxa_baixo_min} em ${need} fotos` }, aplicavel: true })
      continue
    }
    const origem = aprendido[chave]?.p_sucesso != null ? 'aprendido' : 'premissa'
    const pAtual = origem === 'aprendido' ? aprendido[chave].p_sucesso : priors[chave]
    if (pAtual == null || aberta('ajustar_prior', chave)) continue
    if (!s.every(x => x.l.n >= P.n_min && x.l.taxa != null && Math.abs(x.l.taxa - pAtual) >= P.delta_min)) continue
    const encolhido = (ultima.acertos + P.k_pseudo * pAtual) / (ultima.n + P.k_pseudo)
    const novo = r2(clamp(encolhido, pAtual - P.passo_max, pAtual + P.passo_max))
    if (novo === r2(pAtual) || novo <= 0 || novo >= 1) continue
    out.push({ tipo: 'ajustar_prior', alvo: chave, de: { p_sucesso: pAtual, origem }, para: { p_sucesso: novo }, evidencia: { ...evid, regra: `n ≥ ${P.n_min} e |taxa − p| ≥ ${P.delta_min} em ${need} fotos; encolhimento k=${P.k_pseudo}, passo ≤ ${P.passo_max}` }, aplicavel: true })
  }
  const chavesFam = [...new Set((fotos.familia || []).slice(0, need).flatMap(f => (f.linhas || []).map(l => l.chave)))]
  for (const chave of chavesFam) {
    const s = serie('familia', chave); if (!s || aberta('recuar_degrau', chave)) continue
    if (s.every(x => x.l.n >= D.n_min && x.l.brier != null && x.l.brier > D.brier_max))
      out.push({ tipo: 'recuar_degrau', alvo: chave, de: { degrau: 'atual' }, para: { degrau: 'recuar' }, evidencia: { fotos: s.map(x => resumoFoto(x.dia, x.l)), regra: `Brier > ${D.brier_max} com n ≥ ${D.n_min} em ${need} fotos` }, aplicavel: false })
  }
  return out
}

export function aplicarNoAprendido(aprendido = {}, p, { agora } = {}) {
  const novo = JSON.parse(JSON.stringify(aprendido || {}))
  const atual = { ...(novo[p.alvo] || {}) }, carimbo = { desde: agora, proposta_id: p.id ?? null }
  if (p.tipo === 'ajustar_prior') novo[p.alvo] = { ...atual, p_sucesso: p.para.p_sucesso, ...carimbo }
  else if (p.tipo === 'quarentena_regra') novo[p.alvo] = { ...atual, ativa: false, ...carimbo }
  else if (p.tipo === 'reativar_regra') { delete atual.ativa; novo[p.alvo] = { ...atual, ...carimbo } }
  else return novo                                              // recuar_degrau: só registra
  return novo
}

export function reverterNoAprendido(aprendido = {}, p) {
  const novo = JSON.parse(JSON.stringify(aprendido || {}))
  const atual = { ...(novo[p.alvo] || {}) }
  if (p.tipo === 'ajustar_prior') { if (p.de?.origem === 'aprendido' && p.de.p_sucesso != null) atual.p_sucesso = p.de.p_sucesso; else delete atual.p_sucesso }
  else if (p.tipo === 'quarentena_regra') delete atual.ativa
  else if (p.tipo === 'reativar_regra') atual.ativa = false
  else return novo
  const resto = Object.keys(atual).filter(k => k !== 'desde' && k !== 'proposta_id')
  if (resto.length) novo[p.alvo] = atual; else delete novo[p.alvo]
  return novo
}

export const vencidas = (propostas = [], agoraISO) => propostas.filter(p => p.estado === 'proposta' && p.aplicavel && p.veto_ate && p.veto_ate <= agoraISO)
