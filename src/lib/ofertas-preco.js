// Preço e viabilidade do módulo Ofertas (spec §7). PURO: sem banco, sem rede. A IA nunca entra aqui — ela só explica o resultado.
// Regras: centavos inteiros no cálculo; nenhuma alíquota/comissão presumida (tudo vem de of_regra_canal com fonte/validade); desconto contado UMA vez
// (na receita considerada, nunca de novo no custo); Ads por % da receita total ≠ ACOS sobre receita atribuída; fórmula simplificada P×(1−t)−C só quando
// TODAS as incidências percentuais têm a MESMA base (receita considerada) e as tarifas são lineares — senão simula preço a preço com as regras reais.
// Sem dado confiável → simulacao=true (bloqueia aprovação automática do preço; o integrador respeita isso).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'

export const CFG_OFERTAS = JSON.parse(readFileSync(join(ROOT, 'config', 'ofertas.json'), 'utf-8'))
export const BLOQUEIOS = ['custo_ausente', 'denominador_nao_positivo', 'regra_vencida', 'regra_ausente', 'tributo_nao_parametrizado']
const COMPONENTES_CUSTO = ['custo_compra', 'frete_entrada', 'embalagem', 'preparo', 'outros']
const PCT_RECEITA = ['comissao_pct', 'tributos_pct', 'promo_pct', 'devolucao_pct']        // incidem sobre a receita considerada (preço após desconto)

const num = v => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) ? Number(v) : null
export const aCentavos = v => Math.round(Number((num(v) * 100).toFixed(6)))              // R$ → centavos inteiros (meio centavo sobe; toFixed evita 1,005×100 = 100,4999…)
export const aReais = c => Math.round(c) / 100
const pctDe = (centavos, pct) => Math.round(centavos * pct / 100)                        // percentual aplicado em centavos, arredondado ao centavo

// tarifa/subsídio: número (linear) ou tabela por faixa [{ate|a_partir_de, valor}] em R$ (não linear → simulação)
const ehTabela = v => Array.isArray(v)
function tabelaEm(tabela, precoC) {
  const p = aReais(precoC)
  for (const f of tabela) {
    const ate = num(f.ate), de = num(f.a_partir_de)
    if ((ate == null || p <= ate) && (de == null || p >= de)) return aCentavos(f.valor ?? 0)
  }
  return 0
}
const fixoEm = (v, precoC) => v == null ? 0 : ehTabela(v) ? tabelaEm(v, precoC) : aCentavos(v)

// arredondamento operacional: 'centavos' (83,333… → 83,33) ou 'final' (menor preço ≥ exato terminado em um dos finais: 83,333… → 83,90)
export function arredondarPreco(valor, cfg = CFG_OFERTAS.arredondamento_preco) {
  const c = Math.round(num(valor) * 100)
  if (!Number.isFinite(c)) return null
  if (cfg?.modo !== 'final') return aReais(c)
  const finais = (cfg.finais || ['90']).map(f => Number(String(f).padStart(2, '0').slice(-2))).sort((a, b) => a - b)
  const base = Math.floor(c / 100) * 100
  for (const salto of [0, 100]) for (const f of finais) if (base + salto + f >= c) return aReais(base + salto + f)
  return aReais(c)
}

export function criarPreco({ cfg = CFG_OFERTAS, agora = () => new Date().toISOString() } = {}) {
  const arred = v => arredondarPreco(v, cfg.arredondamento_preco)

  // ── validação das entradas: devolve o que está faltando, sem presumir nada ──
  function validar(custos, regra) {
    const bloqueios = [], nao_informados = [], notas = []
    const cc = custos && typeof custos === 'object' ? custos : {}
    if (num(cc.custo_compra) == null || num(cc.custo_compra) <= 0) bloqueios.push('custo_ausente')
    for (const k of COMPONENTES_CUSTO.slice(1)) if (num(cc[k]) == null) nao_informados.push(k)
    if (!regra || typeof regra !== 'object' || num(regra.comissao_pct) == null) bloqueios.push('regra_ausente')
    else {
      if (num(regra.tributos_pct) == null) bloqueios.push('tributo_nao_parametrizado')
      if (regra.validade && String(regra.validade) < agora()) bloqueios.push('regra_vencida')
      if (!regra.fonte) notas.push('regra sem fonte declarada')
      for (const k of ['promo_pct', 'devolucao_pct', 'desconto_pct']) if (num(regra[k]) == null) nao_informados.push(k)
    }
    return { bloqueios, nao_informados, notas }
  }

  // ── uma avaliação em centavos para um preço dado (as regras reais, inclusive tabela por faixa) ──
  function avaliar(precoC, { custos, regra, ads_modo, acos_pct, receita_ads_share }) {
    const d = num(regra?.desconto_pct) ?? 0
    const descontoC = pctDe(precoC, d), receitaC = precoC - descontoC                      // desconto UMA vez: aqui e só aqui
    const comp = [{ item: 'preco', valor: precoC, base: 'preco_cheio' }]
    if (descontoC) comp.push({ item: 'desconto', valor: -descontoC, base: 'preco_cheio' })
    comp.push({ item: 'receita_considerada', valor: receitaC, base: 'preco_apos_desconto' })
    let deducoes = 0
    const ded = (item, valor, base) => { if (valor) { comp.push({ item, valor: -valor, base }); deducoes += valor } }
    const baseCom = regra?.base_comissao || 'receita'
    ded('comissao', pctDe(baseCom === 'preco_cheio' ? precoC : receitaC, num(regra?.comissao_pct) ?? 0), baseCom === 'preco_cheio' ? 'preco_cheio' : 'receita_considerada')
    ded('tarifa_fixa', fixoEm(regra?.tarifa_fixa, precoC), ehTabela(regra?.tarifa_fixa) ? 'tabela_por_faixa' : 'fixa')
    ded('tributos', pctDe(receitaC, num(regra?.tributos_pct) ?? 0), 'receita_considerada')
    ded('frete_vendedor', fixoEm(regra?.frete_vendedor, precoC), ehTabela(regra?.frete_vendedor) ? 'tabela_por_faixa' : 'fixa')
    ded('promo', pctDe(receitaC, num(regra?.promo_pct) ?? 0), 'receita_considerada')
    ded('devolucao', pctDe(receitaC, num(regra?.devolucao_pct) ?? 0), 'receita_considerada')
    // Ads: % da receita total (verba) OU ACOS × receita atribuída a anúncios (share) — nunca ACOS sobre todas as vendas
    if (ads_modo === 'pct_receita') ded('ads', pctDe(receitaC, num(regra?.ads_pct) ?? 0), 'receita_considerada')
    else if (ads_modo === 'acos') ded('ads', pctDe(pctDe(receitaC, (num(receita_ads_share) ?? 0) * 100), num(acos_pct) ?? 0), 'receita_atribuida_ads')
    let custoC = 0
    for (const k of COMPONENTES_CUSTO) { const v = aCentavos(custos?.[k] ?? 0); if (v) { comp.push({ item: k, valor: -v, base: 'unitario' }); custoC += v } }
    const contribC = receitaC - deducoes - custoC
    comp.push({ item: 'contribuicao', valor: contribC, base: 'receita_considerada' })
    const margemExata = receitaC > 0 ? contribC / receitaC * 100 : null
    return { preco: aReais(precoC), receita_considerada: aReais(receitaC), contribuicao: aReais(contribC), margem_pct: margemExata == null ? null : Math.round(margemExata * 100) / 100, margem_exata: margemExata,
      composicao: comp.map(c => ({ ...c, valor: aReais(c.valor) })) }
  }

  // simula vários preços com as regras reais (tabelas por faixa, subsídio condicional) — é o caminho quando a fórmula fechada não vale
  function simularFaixa(precos, regra, extra = {}) {
    return (precos || []).map(p => avaliar(aCentavos(p), { regra, ...extra })).filter(x => Number.isFinite(x.preco))
  }

  // todas as % na mesma base (receita considerada) e tarifas lineares → fórmula fechada; senão busca o menor preço que atinge a margem
  const linear = regra => !ehTabela(regra?.tarifa_fixa) && !ehTabela(regra?.frete_vendedor) && (regra?.base_comissao || 'receita') === 'receita'
  function precoParaMargem(m, ctx) {
    const { custos, regra } = ctx
    if (num(m) == null) return { preco: null, bloqueio: null, motivo: 'margem não informada' }
    const d = (num(regra?.desconto_pct) ?? 0) / 100
    let t = PCT_RECEITA.reduce((s, k) => s + (num(regra?.[k]) ?? 0), 0) / 100
    if (ctx.ads_modo === 'pct_receita') t += (num(regra?.ads_pct) ?? 0) / 100
    if (ctx.ads_modo === 'acos') t += ((num(ctx.acos_pct) ?? 0) / 100) * (num(ctx.receita_ads_share) ?? 0)
    const C = COMPONENTES_CUSTO.reduce((s, k) => s + aCentavos(custos?.[k] ?? 0), 0)
    if (linear(regra)) {
      const F = fixoEm(regra?.tarifa_fixa, 0) + fixoEm(regra?.frete_vendedor, 0)
      const den = (1 - d) * (1 - t - m / 100)                                                 // P·(1−d)·(1−t−m) = C + F
      if (den <= 1e-9) return { preco: null, bloqueio: 'denominador_nao_positivo',          // tolerância: 1 − 0,7 − 0,3 dá 5e-17 em ponto flutuante
        motivo: `1 − t − m = ${Math.round((1 - t - m / 100) * 10000) / 100}% ≤ 0: não existe preço que pague ${m}% de margem com ${Math.round(t * 10000) / 100}% de incidências` }
      return { preco: aReais((C + F) / den), metodo: 'formula_simplificada', exato: (C + F) / den / 100 }
    }
    // não linear: varredura de R$ 1 em R$ 1 até achar margem ≥ m, depois refina ao centavo (margem não é monótona com faixa — pega o MENOR preço que atinge)
    const teto = Math.max(C * 50, 100000), atinge = c => { const a = avaliar(c, ctx); return a.margem_exata != null && a.margem_exata >= m }   // margem EXATA, não a arredondada
    for (let p = 100; p <= teto; p += 100) {
      if (!atinge(p)) continue
      for (let c = p - 99; c <= p; c++) if (atinge(c)) return { preco: aReais(c), metodo: 'simulacao_faixa', exato: c / 100 }
    }
    return { preco: null, bloqueio: 'denominador_nao_positivo', motivo: `nenhum preço até R$ ${aReais(teto)} atinge ${m}% de margem com as regras informadas` }
  }

  // ── API principal ──
  function calcular({ custos, regra, preco, margem_alvo_pct, ads_modo = 'nenhum', acos_pct, receita_ads_share } = {}) {
    const v = validar(custos, regra), ctx = { custos, regra, ads_modo, acos_pct, receita_ads_share }
    const bloqueios = [...v.bloqueios], pendencias = [...v.notas]
    if (!['pct_receita', 'acos', 'nenhum'].includes(ads_modo)) pendencias.push(`ads_modo desconhecido (${String(ads_modo).slice(0, 20)}): Ads não considerado`)
    if (ads_modo === 'acos' && (num(acos_pct) == null || num(receita_ads_share) == null)) pendencias.push('ACOS exige acos_pct e receita_ads_share (parcela da receita vinda de Ads): Ads contado como zero')
    if (ads_modo === 'pct_receita' && num(regra?.ads_pct) == null) pendencias.push('ads_pct ausente na regra: Ads contado como zero')
    const margemMin = num(regra?.margem_min_pct), margemAlvo = num(margem_alvo_pct) ?? num(regra?.margem_alvo_pct)
    if (margemMin == null) pendencias.push('margem_min_pct ausente na regra: sem piso')
    const fontes = { regra: regra ? { fonte: regra.fonte || '', consultado_em: regra.consultado_em || '', validade: regra.validade || '', modalidade: regra.modalidade || '' } : null,
      custos: custos ? { fonte: custos.fonte || '', inicio_vigencia: custos.inicio_vigencia || '' } : null,
      bases: { comissao: regra?.base_comissao || 'receita', percentuais: 'receita_considerada (preço após desconto)', ads: ads_modo }, nao_informados: v.nao_informados }
    const base = { bloqueios, pendencias, fontes, metodo: linear(regra) ? 'formula_simplificada' : 'simulacao_faixa', simulacao: true,
      contribuicao: null, margem_pct: null, composicao: [], piso: null, preco_alvo: null, preco_para_margem: () => ({ preco: null, bloqueio: bloqueios[0] }) }
    if (bloqueios.length) return base                                                          // sem custo/regra válidos não existe número — nem "aproximado"

    const pm = m => precoParaMargem(m, ctx)
    const piso = margemMin == null ? null : pm(margemMin)
    if (piso?.bloqueio) bloqueios.push(piso.bloqueio)
    let alvo = null
    if (margemAlvo != null) {
      const e = pm(margemAlvo)
      if (e.bloqueio) bloqueios.push(e.bloqueio)
      else { const op = arred(e.preco), r = avaliar(aCentavos(op), ctx); alvo = { margem_alvo_pct: margemAlvo, exato: Math.round(e.exato * 1e6) / 1e6, preco: op, margem_pct: r.margem_pct, contribuicao: r.contribuicao, metodo: e.metodo } }
    }
    const aval = num(preco) != null && num(preco) > 0 ? avaliar(aCentavos(preco), ctx) : null
    const simulacao = v.nao_informados.length > 0 || pendencias.length > 0 || bloqueios.length > 0 || !regra.fonte || !regra.validade
    return { ...base, ...(aval || {}), preco: aval?.preco ?? null, piso: piso?.preco ?? null, piso_margem_pct: margemMin, preco_alvo: alvo,
      abaixo_do_piso: aval && piso?.preco != null ? aval.preco < piso.preco : null, bloqueios: [...new Set(bloqueios)], simulacao,
      preco_para_margem: m => { const e = pm(m); return e.bloqueio ? e : { ...e, operacional: arred(e.preco), margem_operacional_pct: avaliar(aCentavos(arred(e.preco)), ctx).margem_pct } } }
  }

  return { calcular, simularFaixa: (precos, regra, extra) => simularFaixa(precos, regra, extra), arredondar: arred, avaliar: (p, ctx) => avaliar(aCentavos(p), ctx), validar }
}

export const preco = criarPreco()
