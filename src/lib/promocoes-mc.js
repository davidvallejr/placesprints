// Regras PURAS do módulo "Promoções por cliente" (porte de controle-promocoes-ml + analista-promocoes).
// Sem rede, sem banco e sem relógio implícito: tudo que depende de "hoje" recebe por parâmetro.
// É aqui que nascem a MC, o preço vigente, a cobertura contínua e a curva ABC — nada disso é inventado:
// faltou custo/imposto/tarifa => o resultado é "SEM CUSTO" (nunca um número otimista).

const r2 = n => Math.round(n * 100) / 100
export const num = v => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
export const mesmoPreco = (a, b) => num(a) != null && num(b) != null && Math.abs(a - b) < 0.005

// ── tipos de campanha (regras-promocoes.md §1) ──────────────────────────────
// REBATE = meli_percentage > 0 em SMART / PRICE_MATCHING / MARKETPLACE_CAMPAIGN. DEAL, SELLER_CAMPAIGN, cupom,
// PRICE_DISCOUNT (e LIGHTNING, Pix) ficam FORA. Tipo desconhecido com meli% > 0 conta como rebate (definição primária)
// e é sinalizado na coleta como "tipo novo".
export const TIPOS_REBATE = new Set(['SMART', 'PRICE_MATCHING', 'MARKETPLACE_CAMPAIGN'])
export const TIPOS_FORA_REBATE = new Set(['DEAL', 'SELLER_CAMPAIGN', 'SELLER_COUPON_CAMPAIGN', 'PRICE_DISCOUNT', 'LIGHTNING', 'BANK', 'COFINANCED'])
const NAO_MEXE_PRECO = new Set(['PRICE_MATCHING', 'BANK', 'COFINANCED'])        // não entram no preço vigente nem na cobertura
const ehCupom = tipo => /COUPON|CUPOM/.test(String(tipo || '').toUpperCase())
export const naoMexePreco = o => NAO_MEXE_PRECO.has(o.tipo) || ehCupom(o.tipo)
export const naoCobre = naoMexePreco
export const ehRebate = o => num(o.meli_pct) > 0 && !TIPOS_FORA_REBATE.has(o.tipo)
export const tipoRebateConhecido = tipo => TIPOS_REBATE.has(tipo)
export const ehRelampago = o => /relampago/.test(norm(o.nome))
export const ehLightning = o => o.tipo === 'LIGHTNING' || String(o.pid || '').startsWith('LGH-')
export const ehRelampagoSmart = o => o.tipo === 'SMART' && ehRelampago(o)       // entrada só pelo PAINEL (§14)
// SMART sem nome (avaliar DEPOIS de completarNomes): o nome é o único detector de relâmpago — sem ele não se sabe; falha fechado (plano/executor pulam, analista não recomenda)
export const smartSemNome = o => o.tipo === 'SMART' && !String(o.nome || '').trim()

// ── datas: tudo vira "dia no Brasil" (UTC−3) para comparar ───────────────────
export function diaBR(s) {
  if (!s) return null
  const t = String(s)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) return t.slice(0, 10)      // sem fuso = já é horário local
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10)
}

// ── frete: degrau por faixa (se houver), senão valor único ───────────────────
// faixas = [{ ate: 79, valor: 0 }, { ate: 100, valor: 20.45 }, ..., { ate: null, valor: 23.25 }] — "ate" é exclusivo; null = última.
export function freteNoPreco(preco, { frete = null, faixas = null } = {}) {
  if (Array.isArray(faixas) && faixas.length) {
    const ord = [...faixas].sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity))
    const f = ord.find(x => x.ate == null || preco < x.ate) || ord[ord.length - 1]
    return num(f.valor)
  }
  return num(frete)
}

// ── MC = preço − (comissão − rebate) − frete − custo − imposto ───────────────
// rebate = meli% × preço ORIGINAL (§4). comissão = preço × % + taxa fixa. Todos os campos R$ já resolvidos.
export function calcularMC({ preco, precoOriginal, meliPct = 0, comissaoPct, taxaFixa = 0, frete, faixasFrete = null, custo, impostoPct }) {
  const p = num(preco)
  const faltando = []
  if (!(p > 0)) return { ok: false, estado: 'SEM PREÇO', faltando: ['preço'] }
  if (num(custo) == null) faltando.push('custo')
  if (num(impostoPct) == null) faltando.push('imposto')
  if (num(comissaoPct) == null) faltando.push('comissão')
  const f = freteNoPreco(p, { frete, faixas: faixasFrete })
  if (f == null) faltando.push('frete')
  if (faltando.length) return { ok: false, estado: faltando.includes('custo') || faltando.includes('imposto') ? 'SEM CUSTO' : 'SEM TARIFA/FRETE', faltando }
  const original = num(precoOriginal) ?? p
  const rebate = (num(meliPct) || 0) / 100 * original
  const comissao = p * comissaoPct / 100 + (num(taxaFixa) || 0)
  const imposto = p * impostoPct / 100
  const mc = p - (comissao - rebate) - f - custo - imposto
  return { ok: true, preco: p, mc: r2(mc), mcPct: r2(mc / p * 100), comissao: r2(comissao), rebate: r2(rebate), frete: r2(f), imposto: r2(imposto), custo: r2(custo) }
}

// Custo por SKU (R$) vence; sem ele, o fallback é custos_cliente em PERCENTUAIS. Nenhum dos dois => "SEM CUSTO".
// Custos "fixos por unidade" (CMV, embalagem, frete, outros) não caem com o desconto: valem % do preço de REFERÊNCIA
// (preço cheio); comissão e imposto incidem no preço de venda (mesma convenção de descontoMaximoPct em diagnostico-conta.js).
export function resolverCustos({ custoSku = null, custosCliente = null, tarifaItem = null, impostoPct = null, precoRef = null }) {
  const faltando = []
  const imposto = num(impostoPct) ?? num(custosCliente?.imposto_pct)
  if (imposto == null) faltando.push('imposto')
  let modo = null, custo = null, comissaoPct = null, taxaFixa = 0, frete = null, faixasFrete = null
  const ref = num(precoRef)
  const pctDeRef = pct => (num(pct) != null && ref > 0 ? ref * pct / 100 : null)
  if (num(custoSku) != null && custoSku > 0) {                                  // custo 0 NÃO é custo (ERP exporta 0 p/ "não preenchido"): cai em SEM CUSTO
    modo = 'sku'
    custo = custoSku + (pctDeRef(custosCliente?.embalagem_pct) || 0) + (pctDeRef(custosCliente?.outros_pct) || 0)
    comissaoPct = num(tarifaItem?.comissao_pct) ?? num(custosCliente?.comissao_pct)
    taxaFixa = num(tarifaItem?.taxa_fixa) || 0
    if (tarifaItem?.faixas?.length) faixasFrete = tarifaItem.faixas
    else frete = num(tarifaItem?.frete) ?? pctDeRef(custosCliente?.frete_pct)
    if (comissaoPct == null) faltando.push('comissão')
    if (frete == null && !faixasFrete) faltando.push('frete')
  } else if (custosCliente && num(custosCliente.cmv_pct) != null && num(custosCliente.comissao_pct) != null) {
    modo = 'percentual'
    custo = (pctDeRef(custosCliente.cmv_pct) ?? 0) + (pctDeRef(custosCliente.embalagem_pct) || 0) + (pctDeRef(custosCliente.outros_pct) || 0)
    if (!(ref > 0)) faltando.push('preço de referência')
    comissaoPct = custosCliente.comissao_pct
    frete = pctDeRef(custosCliente.frete_pct)
    if (frete == null) faltando.push('frete')
  } else faltando.push('custo')
  if (faltando.length) return { ok: false, estado: faltando.includes('custo') || faltando.includes('imposto') ? 'SEM CUSTO' : 'SEM TARIFA/FRETE', faltando }
  return { ok: true, modo, custo, impostoPct: imposto, comissaoPct, taxaFixa, frete, faixasFrete }
}

// Preço mínimo (arredondado p/ cima, centavos) que entrega a margem-alvo, respeitando o degrau de frete.
// p·(1 − c − i − alvo) = taxaFixa − rebate + frete + custo   (MC% cresce com o preço dentro de cada faixa)
export function precoParaMargem(alvoPct, c) {
  if (!c?.ok) return null
  const den = 1 - c.comissaoPct / 100 - c.impostoPct / 100 - alvoPct / 100
  if (!(den > 0)) return null
  const faixas = c.faixasFrete?.length ? [...c.faixasFrete].sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity)) : [{ ate: null, valor: c.frete }]
  let melhor = null, lo = 0
  for (const f of faixas) {
    const alvo = ((c.taxaFixa || 0) + f.valor + c.custo) / den
    const p = Math.ceil(Math.max(alvo, lo) * 100) / 100
    if (p > 0 && (f.ate == null || p < f.ate) && (melhor == null || p < melhor)) melhor = p
    lo = f.ate ?? lo
  }
  return melhor
}

// ── preço vigente (§13-bis): MENOR price entre os STARTED que mexem no preço; sem nenhum, o preço original ──
// NUNCA o price de um candidato (comparar o slot com ele mesmo produz "0%"/negativos falsos).
export function precoVigente(ofertas, precoOriginal) {
  const ativos = ofertas.filter(o => o.status === 'started' && !naoMexePreco(o) && num(o.preco) > 0)
  if (!ativos.length) return { preco: num(precoOriginal), origem: 'original', oferta: null, empatadas: [] }
  const min = ativos.reduce((a, b) => (b.preco < a.preco ? b : a))
  return { preco: min.preco, origem: 'campanha', oferta: min, empatadas: ativos.filter(o => mesmoPreco(o.preco, min.preco)) }
}

// ── cobertura contínua (§12): mescla started+pending; lacuna corta; data > 60 dias é suspeita ──
// Data da OFERTA primeiro, senão a da campanha (relâmpago fica fora do fallback). Mescla se próximo.início ≤ fim + 1 dia.
export function coberturaContinua(ofertas, hoje, { campanhas = new Map(), maxDias = 60 } = {}) {
  const montar = filtro => {
    const iv = [], avisos = []
    for (const o of ofertas) {
      if (!['started', 'pending'].includes(o.status) || naoCobre(o) || !filtro(o)) continue
      const camp = campanhas.get(o.pid) || null
      let fim = diaBR(o.fim), fonteFim = 'oferta'
      if (!fim && camp?.fim && !ehRelampago({ nome: o.nome || camp.nome })) { fim = diaBR(camp.fim); fonteFim = 'campanha' }
      const ini = diaBR(o.inicio) || (o.status === 'started' ? hoje : diaBR(camp?.inicio))
      if (!fim || !ini) { avisos.push(`${o.pid}: sem data de ${!fim ? 'fim' : 'início'} (${o.status})`); continue }
      iv.push({ ini, fim, pid: o.pid, fonteFim })
    }
    iv.sort((a, b) => (a.ini < b.ini ? -1 : a.ini > b.ini ? 1 : 0))
    const blocos = []
    for (const x of iv) {
      const ult = blocos[blocos.length - 1]
      if (ult && x.ini <= addDias(ult.fim, 1)) { if (x.fim > ult.fim) { ult.fim = x.fim; ult.fonteFim = x.fonteFim } ult.pids.push(x.pid) }
      else blocos.push({ ini: x.ini, fim: x.fim, fonteFim: x.fonteFim, pids: [x.pid] })
    }
    const atual = blocos.find(b => b.ini <= hoje && hoje <= b.fim)
    return { cobreAte: atual?.fim ?? null, fonteFim: atual?.fonteFim ?? null, voltaEm: atual ? null : blocos.find(b => b.ini > hoje)?.ini ?? null, blocos, avisos }
  }
  const total = montar(() => true)
  return {
    cobreAte: total.cobreAte, fonteFim: total.fonteFim, voltaEm: total.voltaEm, blocos: total.blocos, avisos: total.avisos,
    cobreAteRebate: montar(o => ehRebate(o)).cobreAte, cobreAteSemRebate: montar(o => !ehRebate(o)).cobreAte,   // plano 213: separar com × sem rebate
    descoberto: total.cobreAte === null,
    suspeita: total.cobreAte !== null && diasEntre(hoje, total.cobreAte) > maxDias,
  }
}

// ── a marca 👤 ainda VINCULA o analista? Só enquanto a campanha marcada for candidata ou estiver ativa (started/pending) no anúncio ──
// Campanha que acabou/saiu da lista não prende o anúncio para sempre (decisão do dono, 05/10/2026); a marca NÃO é revogada, só deixa de ser veto.
// Sem leitura confiável das ofertas (anúncio fora da coleta, sem leitura, com erro ou under_review) nada é presumido: a marca segue valendo (falha fechado).
export const STATUS_OFERTA_VIVA = ['candidate', 'started', 'pending']
export const marcaHumanaViva = (anuncio, ofertas, pid) => !anuncio || !anuncio.lido_em || !!anuncio.oferta_erro || !!anuncio.under_review || anuncio.status === 'under_review'
  || (ofertas || []).some(o => o.pid === pid && STATUS_OFERTA_VIVA.includes(o.status))

// ── curva ABC por faturamento 30d de pedidos PAGOS: A < 80% acumulado, B < 95%, C o resto (+ sem venda) ──
// Mesma convenção de diagnostico-conta.js (acumulado ANTES do anúncio) — o maior anúncio nunca cai fora da A.
export function curvaABC(itens) {
  const total = itens.reduce((t, i) => t + Math.max(0, num(i.fat) || 0), 0)
  const out = new Map()
  let acum = 0
  for (const i of [...itens].sort((a, b) => (num(b.fat) || 0) - (num(a.fat) || 0))) {
    const fat = Math.max(0, num(i.fat) || 0)
    const antes = total ? acum / total * 100 : 100
    out.set(i.id, { curva: fat > 0 && antes < 80 ? 'A' : fat > 0 && antes < 95 ? 'B' : 'C', fat: r2(fat), share: total ? r2(fat / total * 100) : 0, semVenda: fat === 0 })
    acum += fat
  }
  return out
}

// ── "campanha derrubada antes do prazo" (comparar_rodadas): started/pending com fim futuro que sumiram ──
// anterior/atual = { participacoes: [{ item_id, pid, status, fim }], itens: [item_id lidos na rodada] }
export function compararRodadas(anterior, atual, hoje) {
  const chave = p => `${p.item_id}|${p.pid}`
  const naAtual = new Set(atual.participacoes.filter(p => ['started', 'pending'].includes(p.status)).map(chave))
  const lidos = new Set(atual.itens)
  const derrubadas = [], vencidas = [], semPrazo = [], saiuDaColeta = new Set()
  for (const p of anterior.participacoes) {
    if (!['started', 'pending'].includes(p.status) || naAtual.has(chave(p))) continue
    if (!lidos.has(p.item_id)) { saiuDaColeta.add(p.item_id); continue }       // "fora da carga" ≠ "descoberto": exige varredura viva
    const fim = diaBR(p.fim)
    if (!fim) semPrazo.push({ ...p })
    else if (fim > hoje) derrubadas.push({ ...p, fim })
    else vencidas.push({ ...p, fim })
  }
  return { derrubadas, vencidas, semPrazo, saiuDaColeta: [...saiuDaColeta] }
}

// ── regra por SKU (aba "Regras por SKU" do dono): Livre | N% | Revisar toda rodada ──
export function parseStatusRegra(texto) {
  const t = String(texto || '').trim()
  if (/^livre\b/i.test(t)) return { tipo: 'livre' }
  if (/^revisar\b/i.test(t)) return { tipo: 'revisar' }
  const m = t.match(/^(\d{1,2}(?:[.,]\d+)?)\s*%$/)
  if (m) return { tipo: 'piso', piso: Number(m[1].replace(',', '.')) }
  return { tipo: 'desconhecido' }
}

// ── importação de custos por SKU a partir de texto colado (CSV ; , tab) ──────
// "1.234,56" (BR) e "1,234.56" (US) saem certos (o ÚLTIMO separador é o decimal); lixo e AMBÍGUO => null, nunca adivinhar:
// "1,234" / "1.234" pode ser mil duzentos e trinta e quatro ou 1,234 — quem importa decide (escreva 1234 ou 1,234.00).
export function parseNumeroBR(v) {
  const t = String(v ?? '').replace(/R\$/gi, '').replace(/\s+/g, '')
  if (!/^\d[\d.,]*$/.test(t)) return null
  const ult = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'))
  if (ult < 0) return Number(t)
  const sep = t[ult], outro = sep === ',' ? '.' : ',', cabeca = t.slice(0, ult), cauda = t.slice(ult + 1)
  const grupos = (s, c) => new RegExp(`^\\d{1,3}(?:\\${c}\\d{3})+$`).test(s)              // milhar válido: 1.234 / 1.234.567
  if (cabeca.includes(outro)) return grupos(cabeca, outro) && /^\d+$/.test(cauda) ? Number(`${cabeca.replaceAll(outro, '')}.${cauda}`) : null
  if (cabeca.includes(sep)) return grupos(t, sep) ? Number(t.replaceAll(sep, '')) : null   // separador repetido só pode ser milhar
  if (!/^\d+$/.test(cabeca) || !/^\d+$/.test(cauda)) return null
  if (cauda.length === 3 && /^[1-9]\d{0,2}$/.test(cabeca)) return null                     // "1,234" / "1.234": ambíguo
  return Number(`${cabeca}.${cauda}`)
}
// Custo de SKU: só número FINITO > 0. Ausente/vazio/null/NaN/0/negativo/booleano/lista NUNCA viram custo (0 viraria MC inflada em
// vez de SEM CUSTO). Devolve { custo } ou { motivo } — quem importa registra o motivo em 'rejeitadas'.
export const CUSTO_MAX = 1e7
export function lerCusto(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseNumeroBR(v) : null     // número JSON é número (1.234 não é "mil")
  if (n == null || !Number.isFinite(n)) {
    if (typeof v === 'string' && /^\s*(R\$)?\s*[1-9]\d{0,2}[.,]\d{3}\s*$/i.test(v)) return { motivo: `custo ambíguo ("${v.trim().slice(0, 20)}": milhar ou decimal?) — escreva 1200 ou 1.200,00` }
    return { motivo: v == null || (typeof v === 'string' && !v.trim()) ? 'custo ausente' : 'custo inválido ou ambíguo (use 12,50 ou 1.234,56)' }
  }
  if (n <= 0) return { motivo: 'custo zero ou negativo não é custo válido' }
  if (n > CUSTO_MAX) return { motivo: 'custo acima de R$ 10.000.000' }
  return { custo: n }
}
export function parseCustosCsv(texto) {
  const linhas = [], rejeitadas = []
  const cel = s => String(s ?? '').trim().replace(/^["']|["']$/g, '')
  let primeira = true                                                                 // só a 1ª linha NÃO vazia pode ser cabeçalho
  String(texto || '').split(/\r?\n/).forEach((cru, i) => {
    const l = cru.trim()
    if (!l) return
    const sep = l.includes('\t') ? '\t' : l.includes(';') ? ';' : ','
    const partes = l.split(sep), sku = cel(partes[0])
    // cabeçalho = rótulo puro: 1ª linha, SEM nenhum dígito (um SKU "SKU-001" ou custo "1.234" ambíguo NÃO é cabeçalho: vira linha normal e, se falhar, aparece em 'rejeitadas')
    const cabecalho = primeira && !/\d/.test(l) && /sku|c[oó]digo/i.test(sku); primeira = false
    if (cabecalho) return
    const rej = motivo => rejeitadas.push({ linha: i + 1, texto: l.slice(0, 80), motivo })
    if (!sku || sku.length > 80) rej('SKU vazio ou longo demais')
    else if (partes.length < 2) rej('sem separador entre SKU e custo (use SKU;custo)')           // nunca fatiar o SKU p/ "inventar" um custo
    else if (partes.length > 2) rej(sep === ',' ? 'vírgulas demais: ambíguo (decimal ou separador?) — use ";" entre o SKU e o custo' : 'mais de duas colunas: envie só SKU;custo (num export SKU;Estoque;Custo a 2ª coluna NÃO é o custo)')
    else { const c = lerCusto(cel(partes[1])); if (c.motivo) rej(c.motivo); else linhas.push({ sku, custo: c.custo }) }
  })
  return { linhas, rejeitadas }
}

export { r2 }
