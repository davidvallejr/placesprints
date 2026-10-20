// Financeiro por pedido (V3 F4 — docs/desenho-v3-produto-estoque-financeiro.md § 5). PURO: sem banco, sem rede; lucro-real.js lê o banco e chama daqui.
// Princípios: centavos INTEGER nas somas (arredondamento só na saída); nenhuma alíquota presumida; ausente = null (tarifa, frete, custo ou reembolso faltando
// deixa o lucro da linha null — faltar SUPERESTIMA o lucro); «lucro» só com custo informado; número exibido só com cobertura ≥ mínimo (senão «parcial (x%)»).
// Cupom: só informativo (quem financia é NOT_VERIFIED). Linha cancelada nem chega aqui (o leitor filtra status = 'paid').
import { ratearPorReceita } from './produto-estoque.js'

const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100
// cobertura exibida arredondada PARA BAIXO (79,5% nunca vira «80%»); a decisão usa os booleanos ok_* do agregar, calculados sobre o valor cru
const piso2 = n => Math.floor(n * 100 + 1e-9) / 100
const pctTxt = x => `${Math.round(x * 100)}%`

// frete do vendedor por linha: o custo do envio (meli_envio_custo.custo_vendedor_c) rateado pela receita entre as linhas pagas do MESMO envio (pacote de 3 pedidos
// desconta o frete UMA vez). Envio não lido, pendente ou linha sem envio = null. ponytail: o rateio usa as linhas carregadas (a mesma janela); pacote que cruza a borda
// da janela ou com um pedido cancelado põe o frete inteiro nas linhas pagas da janela.
export function fretesDasLinhas(linhas, envios) {
  const porEnvio = new Map(), out = linhas.map(() => null)
  linhas.forEach((l, k) => { if (l.envio_id) (porEnvio.get(l.envio_id) || porEnvio.set(l.envio_id, []).get(l.envio_id)).push(k) })
  for (const [id, ks] of porEnvio) {
    const e = envios.get(id); if (e?.custo_vendedor_c == null) continue
    ratearPorReceita(e.custo_vendedor_c, ks.map(k => linhas[k].preco_unit_c * linhas[k].quantidade)).forEach((c, j) => { out[ks[j]] = c })
  }
  return out
}

// linha paga → números da linha (centavos). l = meli_pedido_item; frete_c (fretesDasLinhas); custo_unit_c (custo vigente × 100; null sem custo)
// porUnidade: sale_fee × quantidade (PREMISSA até conciliar; conciliarTarifa decide); imposto_pct só se informado pelo cliente.
export function linhaFinanceira(l, { frete_c = null, custo_unit_c = null, imposto_pct = null, porUnidade = true } = {}) {
  const q = l.quantidade, receita_c = l.preco_unit_c * q
  const tarifa_c = l.tarifa_c == null ? null : porUnidade ? l.tarifa_c * q : l.tarifa_c
  const custo_c = custo_unit_c == null ? null : custo_unit_c * q, reembolso_c = l.reembolso_c ?? null
  const lucro_antes_imposto_c = [tarifa_c, frete_c, custo_c, reembolso_c].includes(null) ? null : receita_c - reembolso_c - tarifa_c - frete_c - custo_c
  const imposto_c = imposto_pct == null ? null : Math.round(receita_c * imposto_pct / 100)
  return { item_id: l.item_id, variacao_id: l.variacao_id || '', order_id: l.order_id, envio_id: l.envio_id || '', dia: l.dia, quantidade: q, receita_c, tarifa_c, frete_c, custo_c,
    reembolso_c, cupom_c: l.cupom_c ?? null, imposto_c, lucro_antes_imposto_c, lucro_c: lucro_antes_imposto_c == null || imposto_c == null ? null : lucro_antes_imposto_c - imposto_c }
}

// agregação com cobertura (pedido → anúncio → produto → conta). fins = linhaFinanceira[]; chaveDe(linha|{item_id}) → chave do grupo.
// semLinhas: Map(item_id → receita em centavos dos dias da janela SEM linhas de pedido) — entra no denominador: dia sem linha nunca vira «coberto».
// ads: Map(item_id → custo de Ads em centavos na MESMA janela) — só margem pós-Ads (taxa, nunca lucro extrapolado). minimo = financeiro.cobertura_minima.
// Saída por chave: somas cruas + coberturas + números EXIBÍVEIS (null abaixo do mínimo, com motivo). margem = lucro ÷ receita COBERTA (mesmo denominador; nunca extrapola).
export function agregar(fins, chaveDe, { semLinhas = new Map(), ads = new Map(), minimo = 0.8 } = {}) {
  const acc = new Map()
  const de = k => acc.get(k) || acc.set(k, { linhas: 0, unidades: 0, receita_c: 0, sem_linhas_c: 0, cupom_c: 0, reembolso_c: 0, reembolso_nulo: 0, ads_c: 0, ads: false, itens: new Set(),
    tarifa: { c: 0, receita_c: 0 }, frete: { c: 0, receita_c: 0, unidades: 0 }, custo: { c: 0, receita_c: 0 }, tf: { receita_c: 0, tarifa_c: 0, frete_c: 0, reembolso_c: 0 },
    ok: { receita_c: 0, reembolso_c: 0, tarifa_c: 0, frete_c: 0, custo_c: 0, lucro_c: 0, imposto_c: 0, sem_imposto: 0 }, envios: new Set(), envios_sem_frete: new Set() }).get(k)
  for (const f of fins) {
    const a = de(chaveDe(f)); a.itens.add(f.item_id)
    a.linhas++; a.unidades += f.quantidade; a.receita_c += f.receita_c; a.cupom_c += f.cupom_c || 0
    if (f.reembolso_c == null) a.reembolso_nulo++; else a.reembolso_c += f.reembolso_c
    if (f.tarifa_c != null) { a.tarifa.c += f.tarifa_c; a.tarifa.receita_c += f.receita_c }
    if (f.envio_id) { a.envios.add(f.envio_id); if (f.frete_c == null) a.envios_sem_frete.add(f.envio_id) }
    if (f.frete_c != null) { a.frete.c += f.frete_c; a.frete.receita_c += f.receita_c; a.frete.unidades += f.quantidade }
    if (f.custo_c != null) { a.custo.c += f.custo_c; a.custo.receita_c += f.receita_c }
    if (f.tarifa_c != null && f.frete_c != null && f.reembolso_c != null) { a.tf.receita_c += f.receita_c; a.tf.tarifa_c += f.tarifa_c; a.tf.frete_c += f.frete_c; a.tf.reembolso_c += f.reembolso_c }
    if (f.lucro_antes_imposto_c != null) {
      const o = a.ok; o.receita_c += f.receita_c; o.reembolso_c += f.reembolso_c; o.tarifa_c += f.tarifa_c; o.frete_c += f.frete_c; o.custo_c += f.custo_c; o.lucro_c += f.lucro_antes_imposto_c
      if (f.imposto_c == null) o.sem_imposto++; else o.imposto_c += f.imposto_c
    }
  }
  for (const [item_id, c] of semLinhas) { const a = de(chaveDe({ item_id })); a.sem_linhas_c += c; a.itens.add(item_id) }
  for (const [item_id, c] of ads) { const k = chaveDe({ item_id }); if (acc.has(k)) { const a = acc.get(k); a.ads_c += c; a.ads = true } }
  const out = new Map()
  for (const [k, a] of acc) {
    const total = a.receita_c + a.sem_linhas_c, cob = x => (total > 0 ? x / total : null), o = a.ok
    const cobertura = cob(o.receita_c), cobertura_taxas_frete = cob(a.tf.receita_c), cobertura_custo = cob(a.custo.receita_c)
    const okL = cobertura != null && cobertura >= minimo, okTF = cobertura_taxas_frete != null && cobertura_taxas_frete >= minimo, okC = cobertura_custo != null && cobertura_custo >= minimo
    const margem = okL && o.receita_c > 0 ? r1(100 * o.lucro_c / o.receita_c) : null
    const comImposto = okL && !o.sem_imposto && o.receita_c > 0                                  // imposto informado em TODAS as linhas completas
    const motivos = []
    if (a.sem_linhas_c) motivos.push(`dias sem linhas de pedido: ${pctTxt(a.sem_linhas_c / total)} da receita`)
    if (a.custo.receita_c < a.receita_c) motivos.push(`custo não informado em ${pctTxt((a.receita_c - a.custo.receita_c) / total)} da receita`)
    if (a.envios_sem_frete.size) motivos.push(`frete não lido em ${a.envios_sem_frete.size} de ${a.envios.size} envio(s)`)
    if (a.tarifa.receita_c < a.receita_c) motivos.push(`tarifa ausente em ${pctTxt((a.receita_c - a.tarifa.receita_c) / total)} da receita`)
    if (a.reembolso_nulo) motivos.push(`${a.reembolso_nulo} linha(s) sem o valor de reembolso`)
    out.set(k, {
      chave: k, itens: [...a.itens].sort(), linhas: a.linhas, unidades: a.unidades, receita_c: a.receita_c, receita_sem_linhas_c: a.sem_linhas_c, receita_total_c: total,
      cupom_c: a.cupom_c, reembolso_c: a.reembolso_c, reembolso_nulo: a.reembolso_nulo, cobertura: cobertura == null ? null : piso2(cobertura), cobertura_taxas_frete: cobertura_taxas_frete == null ? null : piso2(cobertura_taxas_frete),
      cobertura_custo: cobertura_custo == null ? null : piso2(cobertura_custo), ok_lucro: okL, ok_taxas_frete: okTF, ok_custo: okC,
      // a receita que cada número cobre (a tela mostra «R$ X sobre R$ Y (z%)»): linhas completas (lucro, margem) e linhas com tarifa+frete+reembolso (receita líquida)
      receita_coberta_c: o.receita_c, receita_tf_c: a.tf.receita_c, custo_receita_c: a.custo.receita_c,
      // exibíveis (null abaixo do mínimo): receita líquida de taxas e frete existe SEM custo; lucro e margem só com custo e cobertura
      receita_liquida_c: okTF ? a.tf.receita_c - a.tf.reembolso_c - a.tf.tarifa_c - a.tf.frete_c : null, taxas_c: okTF ? a.tf.tarifa_c : null, frete_c: okTF ? a.tf.frete_c : null,
      custo_c: okC ? a.custo.c : null,
      lucro_c: okL ? o.lucro_c : null, margem_pct: margem,
      completas: okL ? { receita_c: o.receita_c, reembolso_c: o.reembolso_c, tarifa_c: o.tarifa_c, frete_c: o.frete_c, custo_c: o.custo_c, lucro_c: o.lucro_c, imposto_c: comImposto ? o.imposto_c : null } : null,
      // imposto só se informado em todas as linhas completas; senão o lucro fica «antes do imposto» (rótulo). margem_pct é SEMPRE antes do imposto (DEFINICOES margem_medida)
      lucro_depois_imposto_c: comImposto ? o.lucro_c - o.imposto_c : null, margem_depois_imposto_pct: comImposto ? r1(100 * (o.lucro_c - o.imposto_c) / o.receita_c) : null, antes_do_imposto: !comImposto,
      ads_c: a.ads ? a.ads_c : null,
      // somas CRUAS do que foi lido (cada uma com a sua cobertura ao lado): só o DRE mostra assim, «Tarifas R$ X (92% da receita)»
      soma: { tarifa_c: a.tarifa.c, tarifa_receita_c: a.tarifa.receita_c, frete_c: a.frete.c, frete_receita_c: a.frete.receita_c, custo_c: a.custo.c, custo_receita_c: a.custo.receita_c },
      margem_pos_ads_pct: margem != null && a.ads && total > 0 ? r1(margem - 100 * a.ads_c / total) : null,     // Ads ÷ receita TOTAL (o mesmo TACOS da conta), descontado uma vez
      // insumos do economiaReal: razão de tarifa OBSERVADA nas vendas (inclui o custo fixo do ML, rotulado) e frete medido por unidade
      t_obs: a.tarifa.receita_c > 0 ? a.tarifa.c / a.tarifa.receita_c : null, frete_unit_c: a.frete.unidades > 0 ? a.frete.c / a.frete.unidades : null,
      motivo: okL ? '' : motivos.join('; ') || 'sem venda com linhas de pedido na janela',
    })
  }
  return out
}

// visão Lucro (V3 F4): só números EXIBÍVEIS do agregar (null abaixo da cobertura mínima, com o motivo) — a tela nunca recalcula. Com o imposto informado em todas as
// linhas completas, lucro e margem saem DEPOIS do imposto (antes_do_imposto = false); senão, antes (o rótulo diz qual). Cada número leva a receita que ele cobre.
export const resumoFin = a => { if (!a) return null; const dep = a.antes_do_imposto === false
  return { receita_c: a.receita_total_c, receita_sem_linhas_c: a.receita_sem_linhas_c, taxas_c: a.taxas_c, frete_c: a.frete_c, taxas_frete_c: a.taxas_c == null ? null : a.taxas_c + a.frete_c, custo_c: a.custo_c,
    receita_liquida_c: a.receita_liquida_c, lucro_c: dep ? a.lucro_depois_imposto_c : a.lucro_c, margem_pct: dep ? a.margem_depois_imposto_pct : a.margem_pct,
    margem_pos_ads_pct: a.margem_pos_ads_pct == null ? null : dep ? r1(a.margem_pos_ads_pct - a.margem_pct + a.margem_depois_imposto_pct) : a.margem_pos_ads_pct, antes_do_imposto: a.antes_do_imposto,
    cobertura: a.cobertura, cobertura_taxas_frete: a.cobertura_taxas_frete, cobertura_custo: a.cobertura_custo, receita_coberta_c: a.receita_coberta_c, receita_tf_c: a.receita_tf_c, custo_receita_c: a.custo_receita_c, motivo: a.motivo } }

// economia por anúncio a um preço p (§ 5.4): lucro_unit(p) = p × (1 − t − i) − c − f. t = razão de tarifa observada nas vendas (o custo fixo do ML vem embutido: premissa
// rotulada), f = frete medido por unidade, c = custo informado, i = imposto informado (sem ele: «antes do imposto»). Só com custo e taxas+frete cobertos ≥ mínimo.
// preco_minimo = (c + f) / (1 − t − i − m); desconto_max_pct = max(0, 1 − preco_minimo / p) × 100. Abaixo da faixa do frete grátis (R$ 79, limite público) tarifa e frete
// mudam: o desconto para na faixa e a nota manda recalcular (cruza_faixa_frete).
export function economiaReal(a, { preco, custo_unit = null, imposto_pct = null, margem_desejada_pct = null, faixa = 79, minimo = 0.8 } = {}) {
  if (!(preco > 0) || custo_unit == null || !a || a.t_obs == null || a.frete_unit_c == null || !(a.ok_taxas_frete ?? a.cobertura_taxas_frete >= minimo)) return null
  const t = a.t_obs, f = a.frete_unit_c / 100, c = custo_unit, i = (imposto_pct ?? 0) / 100, m = (margem_desejada_pct ?? 0) / 100
  const lucro_unit = preco * (1 - t - i) - c - f, margem_pct = r1(100 * lucro_unit / preco)
  const folga = 1 - t - i - m, preco_minimo = folga > 0 ? r2((c + f) / folga) : null
  const cruza = preco_minimo != null && preco_minimo < faixa && faixa <= preco
  let desconto = preco_minimo == null ? 0 : Math.max(0, r1((1 - preco_minimo / preco) * 100))
  if (cruza) desconto = Math.min(desconto, Math.max(0, r1((1 - faixa / preco) * 100)))
  return { preco, t_pct: r1(100 * t), frete_unit: r2(f), custo_unit: c, imposto_pct, margem_desejada_pct, lucro_unit: r2(lucro_unit), margem_pct, acos_equilibrio_pct: margem_pct,
    roas_equilibrio: margem_pct > 0 ? r2(100 / margem_pct) : null, acos_alvo_pct: margem_desejada_pct != null ? r1(margem_pct - margem_desejada_pct) : null, preco_minimo, desconto_max_pct: desconto, cruza_faixa_frete: cruza,
    premissas: ['tarifa = razão observada nas vendas de 28 dias (inclui o custo fixo por unidade do ML)', 'frete = custo do vendedor medido por unidade em 28 dias', imposto_pct == null ? 'antes do imposto (não informado)' : `imposto informado ${imposto_pct}%`,
      ...(cruza ? [`abaixo de R$ ${faixa} a tarifa e o frete mudam: desconto limitado à faixa — recalcular com a tabela do ML antes de descer`] : [])] }
}

// semântica do sale_fee (§ 5.2) SEM chamada nova: cada linha com q ≥ 2 vota comparando a tarifa com a de uma venda q = 1 do MESMO anúncio, variação, preço, tipo e depósito
// (o custo fixo e a logística se cancelam). razão ≈ 1 → por_unidade (a tarifa veio por unidade: × q no total); ≈ q → por_linha; resto → indeterminado.
// Decide com ≥ min_votos e ≥ acordo_min de concordância; sem decisão vale a PREMISSA (config) e o rótulo diz «não conciliada». Confirmação definitiva: billing CV (F7).
export function conciliarTarifa(linhas, { min_votos = 5, acordo_min = 0.9, tol = 0.1 } = {}) {
  const chave = l => [l.item_id, l.variacao_id || '', l.preco_unit_c, l.tipo_anuncio || '', l.deposito_node || '', l.deposito_store || ''].join('|')
  const um = new Map(); for (const l of linhas) if (l.quantidade === 1 && l.tarifa_c > 0 && !um.has(chave(l))) um.set(chave(l), l.tarifa_c)
  const votos = { por_unidade: 0, por_linha: 0, indeterminado: 0 }
  for (const l of linhas) {
    if (!(l.quantidade >= 2) || l.tarifa_c == null) continue
    const t1 = um.get(chave(l)); if (!t1) continue
    const r = l.tarifa_c / t1
    votos[Math.abs(r - 1) <= tol ? 'por_unidade' : Math.abs(r - l.quantidade) <= tol * l.quantidade ? 'por_linha' : 'indeterminado']++
  }
  const n = votos.por_unidade + votos.por_linha + votos.indeterminado, melhor = votos.por_unidade >= votos.por_linha ? 'por_unidade' : 'por_linha'
  const decidida = n >= min_votos && votos[melhor] / n >= acordo_min
  return { semantica: decidida ? melhor : null, decidida, votos, n }
}

// DRE mensal simples (§ 5.5), competência = dia da venda, só os dias do mês COM linhas de pedido (sem extrapolar). gmv_c = receita bruta desses dias (pagas + cancelados;
// dreDoCliente: por dia, pagas + max(série − pagas, linhas 'cancelled'));
// conta = agregar(linhas pagas desses dias) na chave única; dias = { total, com_linhas, sem_linhas: [] }; ads_c null = «—» (Ads por dia não coletado).
// Cancelados = bruta − linhas pagas. Margem só das linhas com custo e frete lidos, com a %.
export function dreMensal({ mes, dias, gmv_c, conta, imposto_pct = null, ads_c = null, minimo = 0.8, tarifa_rotulo = '' }) {
  const c = conta || { receita_c: 0, reembolso_c: 0, linhas: 0, completas: null, cobertura: null }
  const cob = x => (c.receita_c > 0 ? piso2(x / c.receita_c) : null), raw = c.soma || {}
  const liquida = c.receita_c - c.reembolso_c
  const linhas = [
    { chave: 'receita_bruta', rotulo: 'Receita bruta de vendas', valor_c: gmv_c, nota: 'pedidos dos dias com linhas: GMV + os cancelados até 2 dias após a venda (que já saíram do GMV)' },
    { chave: 'cancelados', rotulo: '(−) Cancelados', valor_c: gmv_c - c.receita_c, nota: 'parcial: a busca de cancelados do ML ainda não foi verificada; cancelado até 2 dias após a venda só aparece com a linha do pedido já gravada' },
    { chave: 'reembolsos', rotulo: '(−) Reembolsos', valor_c: c.reembolso_c, nota: c.reembolso_nulo ? `parcial: ${c.reembolso_nulo} linha(s) sem o valor` : 'só o que vem nos pagamentos do pedido' },
    { chave: 'receita_liquida', rotulo: '= Receita líquida', valor_c: liquida, nota: '' },
    { chave: 'tarifas', rotulo: '(−) Tarifas de venda do ML', valor_c: raw.tarifa_receita_c ? raw.tarifa_c : null, cobertura: cob(raw.tarifa_receita_c ?? 0), nota: tarifa_rotulo },
    { chave: 'frete', rotulo: '(−) Frete pago pelo vendedor', valor_c: raw.frete_receita_c ? raw.frete_c : null, cobertura: cob(raw.frete_receita_c ?? 0), nota: raw.frete_receita_c ? '' : '—: frete ainda não lido' },
    { chave: 'ads', rotulo: '(−) Ads', valor_c: ads_c, nota: ads_c == null ? '—: Ads por dia ainda não coletado (fica fora)' : '' },
    { chave: 'custo', rotulo: '(−) Custo dos produtos', valor_c: raw.custo_receita_c ? raw.custo_c : null, cobertura: cob(raw.custo_receita_c ?? 0), nota: raw.custo_receita_c ? '' : '—: sem custo informado' },
    { chave: 'impostos', rotulo: '(−) Impostos', valor_c: imposto_pct == null ? null : Math.round(liquida * imposto_pct / 100), nota: imposto_pct == null ? 'não incluídos (percentual não informado)' : `${imposto_pct}% informado` },
  ]
  const ok = c.cobertura != null && c.cobertura >= minimo && c.completas
  const margem_c = ok ? c.completas.lucro_c - (imposto_pct == null ? 0 : Math.round(c.completas.receita_c * imposto_pct / 100)) - (ads_c ?? 0) : null
  linhas.push({ chave: 'margem', rotulo: `= Margem de contribuição das vendas com custo e frete lidos (${c.cobertura == null ? '—' : pctTxt(c.cobertura)} da receita)`, valor_c: margem_c, cobertura: c.cobertura,
    nota: ok ? `${imposto_pct == null ? 'antes do imposto; ' : ''}${ads_c == null ? 'sem Ads' : 'com Ads'}` : `parcial (${c.cobertura == null ? '0%' : pctTxt(c.cobertura)}): ${c.motivo || 'sem linhas'}` })
  return { mes, parcial: dias.sem_linhas.length ? { dias_sem_linhas: dias.sem_linhas.length, dias: dias.total, lista: dias.sem_linhas } : null, linhas,
    fora: ['armazenagem e entrada no Full', 'custo logístico de devolução', 'cupom do vendedor', 'despesas fixas da empresa'].map(x => `${x} (NOT_COLLECTED)`), rodape: 'Não é lucro líquido.' }
}
