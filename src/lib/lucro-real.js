// V3 F4 (14/10/2026) — financeiro com banco: coleta do frete por envio (GET /shipments/{id}/costs, SÓ LEITURA), linhas de dias fechados e cancelamentos (meli-serie.js)
// e a leitura «lucro por pedido → anúncio → produto → conta» + DRE mensal sobre o núcleo PURO (lucro.js). docs/desenho-v3-produto-estoque-financeiro.md § 2.5 e § 5.
// Não é um segundo motor: as regras só leem isto com financeiro.margem_medida_nas_regras = true (nasce DESLIGADA; carregarBase anexa i.financeiro/i.economia_real).
// A aba Produtos (visão Lucro) e o DRE são projeções internas. NENHUMA escrita no Mercado Livre; falha de leitura nunca vira zero (pendente com o motivo).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal, agora } from './db.js'
import { ROOT } from './env.js'
import { addDias, completarLinhas, marcarCancelados } from './meli-serie.js'
import { vinculosCusto } from './custos-db.js'
import { fretesDasLinhas, linhaFinanceira, agregar, conciliarTarifa, dreMensal } from './lucro.js'

const CFG_FIN = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')).financeiro || {}
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))

// ── coleta: frete do vendedor por envio ───────────────────────────────────────────────────────────────────────────────────────────
// envios das linhas dos últimos 28 d sem leitura, com pendente 'teto' ou com falha lida há ≥ 3 dias, do mais recente ao mais antigo; teto por cliente/coleta.
// Sucesso: Σ senders[].cost (o que o vendedor pagou; real: 8,15 com desconto mandatory de 30%). Falha: 401/403 = permissao_do_app, resto = indisponivel; senders vazio =
// sem_remetente — sempre custo NULL, nunca 0. O que passa do teto fica 'teto' e é lido na próxima coleta. 1 envio de pacote = 1 chamada para N pedidos.
export async function coletarFretes(cliente, { hoje = hojeLocal(), dias = CFG_FIN.backfill_dias ?? 28, teto = CFG_FIN.frete_teto_por_coleta ?? 300, chamarFn = null, pausaMs = 200 } = {}) {
  const velho = new Date(Date.now() - 3 * 864e5).toISOString()
  const fila = db.prepare(`SELECT p.envio_id, MAX(p.dia) d FROM meli_pedido_item p LEFT JOIN meli_envio_custo e ON e.cliente = p.cliente AND e.envio_id = p.envio_id
    WHERE p.cliente = ? AND p.dia >= ? AND p.envio_id != '' AND (e.envio_id IS NULL OR e.pendente = 'teto' OR (e.pendente != '' AND e.lido_em <= ?))
    GROUP BY p.envio_id ORDER BY d DESC, p.envio_id`).all(cliente, addDias(hoje, -dias), velho).map(r => r.envio_id).filter(id => /^\d{1,20}$/.test(id))
  const vez = fila.slice(0, Math.max(0, teto)), resto = fila.slice(vez.length)
  if (vez.length && !chamarFn) chamarFn = (await import('./meli-api.js')).chamar
  const grava = db.prepare(`INSERT INTO meli_envio_custo (cliente, envio_id, custo_vendedor_c, desconto_c, pendente, lido_em) VALUES (?,?,?,?,?,?)
    ON CONFLICT(cliente, envio_id) DO UPDATE SET custo_vendedor_c = excluded.custo_vendedor_c, desconto_c = excluded.desconto_c, pendente = excluded.pendente, lido_em = excluded.lido_em`)
  const c = x => Math.round(x * 100), ok = x => typeof x === 'number' && Number.isFinite(x)
  let lidos = 0, falhas = 0
  for (const [k, id] of vez.entries()) {
    if (k && pausaMs) await new Promise(r => setTimeout(r, pausaMs))
    let r; try { r = await chamarFn(cliente, `/shipments/${id}/costs`, { permitirFalha: true }) } catch { r = { _erro: true, status: 0 } }
    const s = Array.isArray(r?.senders) ? r.senders : null
    if (!r || r._erro || !s || s.some(x => !ok(x?.cost))) { falhas++; grava.run(cliente, id, null, null, r?.status === 401 || r?.status === 403 ? 'permissao_do_app' : 'indisponivel', agora()); continue }
    if (!s.length) { falhas++; grava.run(cliente, id, null, null, 'sem_remetente', agora()); continue }
    const desc = s.flatMap(x => (Array.isArray(x.discounts) ? x.discounts : [])).filter(d => ok(d?.promoted_amount))
    grava.run(cliente, id, s.reduce((t, x) => t + c(x.cost), 0), desc.length ? desc.reduce((t, d) => t + c(d.promoted_amount), 0) : null, '', agora()); lidos++
  }
  const marcaTeto = db.prepare("INSERT OR IGNORE INTO meli_envio_custo (cliente, envio_id, custo_vendedor_c, desconto_c, pendente, lido_em) VALUES (?,?,NULL,NULL,'teto',?)")
  db.transaction(() => { for (const id of resto) marcaTeto.run(cliente, id, agora()) })()
  return { lidos, falhas, para_amanha: resto.length, teto }
}

// as 3 etapas da coleta financeira (só leitura), cada uma com try próprio: falha de uma nunca derruba as outras nem a coleta diária
export async function coletarFinanceiro(cliente, { hoje = hojeLocal() } = {}) {
  const out = {}
  for (const [k, fn] of [['linhas', () => completarLinhas(cliente, { hoje, dias: CFG_FIN.backfill_dias ?? 28, teto: CFG_FIN.backfill_dias_por_coleta ?? 10 })],
    ['cancelados', () => marcarCancelados(cliente, { hoje })], ['fretes', () => coletarFretes(cliente, { hoje })]]) {
    try { out[k] = await fn() } catch (e) { out[k] = { erro: String(e?.message).slice(0, 160) } }
  }
  return out
}

// ── leitura ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// custos da conta lidos crus (o imposto e a margem desejada valem mesmo sem CMV/comissão, que o financeiro mede)
function custosConta(cliente) {
  let c = {}; try { c = JSON.parse(db.prepare('SELECT custos_json FROM custos_cliente WHERE cliente = ?').get(cliente)?.custos_json || '{}') || {} } catch { c = {} }
  return { imposto_pct: num(c.imposto_pct), margem_desejada_pct: num(c.margem_desejada_pct) }
}
// semântica do sale_fee nas vendas dos últimos 90 d (comparação q ≥ 2 × q = 1 do mesmo anúncio e preço; zero chamada). Sem decisão: a PREMISSA do config.
export function semanticaTarifa(cliente, { hoje = hojeLocal() } = {}) {
  const linhas = db.prepare("SELECT item_id, variacao_id, preco_unit_c, tipo_anuncio, deposito_node, deposito_store, quantidade, tarifa_c FROM meli_pedido_item WHERE cliente = ? AND status = 'paid' AND tarifa_c IS NOT NULL AND dia >= ?").all(cliente, addDias(hoje, -90))
  const min = CFG_FIN.conciliar_min_votos ?? 5, c = conciliarTarifa(linhas, { min_votos: min, acordo_min: CFG_FIN.conciliar_acordo_min ?? 0.9 })
  const por_unidade = c.decidida ? c.semantica === 'por_unidade' : CFG_FIN.sale_fee_por_unidade !== false
  return { ...c, por_unidade, rotulo: c.decidida ? `tarifa conciliada nas vendas (${c.semantica === 'por_unidade' ? 'por unidade' : 'por linha'}; ${c.n} comparações)`
    : `tarifa não conciliada: PREMISSA ${por_unidade ? 'por unidade' : 'por linha'} (${c.n} de ${min} comparações necessárias)` }
}
function diasJanela(cliente, de, ate) {
  const m = new Map(db.prepare('SELECT dia, linhas FROM meli_coleta_dia WHERE cliente = ? AND dia BETWEEN ? AND ?').all(cliente, de, ate).map(r => [r.dia, r.linhas])), sem = []
  let total = 0
  for (let d = de; d <= ate; d = addDias(d, 1)) { total++; if (m.get(d) !== 1) sem.push(d) }
  return { total, com_linhas: total - sem.length, sem_linhas: sem }
}

// janela [de, ate] (padrão: os mesmos 28 dias fechados do diagnóstico). Devolve as linhas financeiras e `por(chaveDe)` → agregar (anúncio, produto, conta).
// Só linhas PAGAS (cancelada sai da receita). Custo: o do anúncio pela resolução única de custo-vinculo; o SKU da venda só sem custo do anúncio ou na variação
// com custo próprio (ver custo() abaixo). Ads só da foto 'atual' com a MESMA janela (senão pós-Ads fica null). Dia sem linhas entra no denominador.
export function financeiroDoCliente(cliente, { hoje = hojeLocal(), de = null, ate = null } = {}) {
  ate ||= addDias(hoje, -1); de ||= addDias(ate, -27)
  const linhas = db.prepare(`SELECT order_id, item_id, variacao_id, dia, quantidade, preco_unit_c, tarifa_c, seller_sku, envio_id, cupom_c, reembolso_c FROM meli_pedido_item
    WHERE cliente = ? AND status = 'paid' AND dia BETWEEN ? AND ? ORDER BY dia, order_id, item_id, variacao_id`).all(cliente, de, ate)
  const envios = new Map(db.prepare(`SELECT envio_id, custo_vendedor_c, pendente FROM meli_envio_custo WHERE cliente = ? AND envio_id IN
    (SELECT DISTINCT envio_id FROM meli_pedido_item WHERE cliente = ? AND dia BETWEEN ? AND ? AND envio_id != '')`).all(cliente, cliente, de, ate).map(r => [r.envio_id, r]))
  const semLinhas = new Map(db.prepare(`SELECT s.item_id, SUM(s.receita) r FROM meli_serie_item s LEFT JOIN meli_coleta_dia d ON d.cliente = s.cliente AND d.dia = s.dia
    WHERE s.cliente = ? AND s.dia BETWEEN ? AND ? AND s.receita > 0 AND COALESCE(d.linhas, 0) = 0 GROUP BY s.item_id`).all(cliente, de, ate).map(r => [r.item_id, Math.round(r.r * 100)]))
  const gmv_c = Math.round(db.prepare('SELECT COALESCE(SUM(receita), 0) r FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, de, ate).r * 100)
  const ads = new Map(db.prepare("SELECT item_id, custo FROM meli_ads_item WHERE cliente = ? AND periodo = 'atual' AND de = ? AND ate = ? AND custo > 0").all(cliente, de, ate).map(r => [r.item_id, Math.round(r.custo * 100)]))
  // custo da linha (desenho § 5.2): o do ANÚNCIO primeiro (manual > SKU exato > SKU forte > grupo do produto — o mesmo do diagnóstico); o SKU da VENDA só quando o
  // anúncio não tem custo, ou na variação cujo SKU tem custo PRÓPRIO (casado pelo SKU dela, não herdado do grupo)
  const memo = {}, custoDe = new Map()
  const custo = l => {
    const k = `${l.item_id}|${l.variacao_id || ''}|${l.seller_sku || ''}`
    if (!custoDe.has(k)) {
      const an = vinculosCusto.custoDoAnuncio(cliente, { item_id: l.item_id }, memo), ve = l.seller_sku ? vinculosCusto.custoDoAnuncio(cliente, { item_id: l.item_id, sku: l.seller_sku }, memo) : null
      const x = l.variacao_id && ve?.custo != null && ['sku', 'sku_normalizado'].includes(ve.origem) ? ve.custo : an.custo ?? ve?.custo ?? null
      custoDe.set(k, x == null ? null : Math.round(x * 100))
    }
    return custoDe.get(k)
  }
  const cc = custosConta(cliente), tarifa = semanticaTarifa(cliente, { hoje }), fretes = fretesDasLinhas(linhas, envios), minimo = CFG_FIN.cobertura_minima ?? 0.8
  const fins = linhas.map((l, k) => linhaFinanceira(l, { frete_c: fretes[k], custo_unit_c: custo(l), imposto_pct: cc.imposto_pct, porUnidade: tarifa.por_unidade }))
  const idsEnvio = new Set(linhas.map(l => l.envio_id).filter(Boolean)), pend = {}
  for (const id of idsEnvio) { const e = envios.get(id), m = !e ? 'nao_lido' : e.custo_vendedor_c == null ? e.pendente || 'indisponivel' : ''; if (m) pend[m] = (pend[m] || 0) + 1 }
  return {
    cliente, de, ate, minimo, gmv_c, imposto_pct: cc.imposto_pct, margem_desejada_pct: cc.margem_desejada_pct, tarifa, fins, semLinhas, ads, dias: diasJanela(cliente, de, ate),
    envios: { total: idsEnvio.size, lidos: idsEnvio.size - Object.values(pend).reduce((t, n) => t + n, 0), pendentes: pend },
    premissas: [tarifa.rotulo, 'frete do pacote rateado pela receita das linhas do mesmo envio', 'custo vigente aplicado às vendas passadas',
      cc.imposto_pct == null ? 'antes do imposto (percentual não informado)' : `imposto informado: ${cc.imposto_pct}% da receita`,
      'cupom não descontado (quem financia não é verificado): só informativo', 'cancelamentos: a busca de cancelados do ML não foi verificada (pode faltar)'],
    por: chaveDe => agregar(fins, chaveDe, { semLinhas, ads, minimo }),
  }
}

// GET /api/cliente/dre: DRE simples do mês até a margem de contribuição. Só os dias fechados COM linhas de pedido (sem extrapolar); dia sem linhas = «parcial: N dias».
// Ads: «—» — meli_ads_dia não cobre o mês (coletarAdsDia a consertar). ponytail: quando a coleta de Ads por dia cobrir o mês inteiro, somar aqui.
export function dreDoCliente(cliente, mes, { hoje = hojeLocal() } = {}) {
  const ini = `${mes}-01`, fim = addDias(`${addDias(ini, 32).slice(0, 7)}-01`, -1), ate = fim < hoje ? fim : addDias(hoje, -1)
  if (ate < ini) return { cliente, mes, disponivel: false, motivo: 'o mês ainda não tem dia fechado' }
  const f = financeiroDoCliente(cliente, { hoje, de: ini, ate }), com = new Set()
  for (let d = ini; d <= ate; d = addDias(d, 1)) if (!f.dias.sem_linhas.includes(d)) com.add(d)
  if (!com.size) return { cliente, mes, disponivel: false, motivo: 'nenhum dia fechado do mês tem linhas de pedido ainda (a coleta grava as linhas a partir da F1 e completa os dias anteriores aos poucos): sem dado não é zero' }
  // receita bruta por dia = pagas + cancelados, e cancelados = max(série − pagas, linhas 'cancelled'): o cancelado DEPOIS da última recoleta continua na série (série − pagas);
  // o cancelado até D+2 já saiu da série, mas a recoleta guardou a linha como 'cancelled'. O max não conta o mesmo pedido duas vezes.
  const porDia = q => new Map(db.prepare(q).all(cliente, ini, ate).map(r => [r.dia, r.c]))
  const serie = porDia('SELECT dia, ROUND(SUM(receita) * 100) c FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ? GROUP BY dia')
  const canc = porDia("SELECT dia, SUM(preco_unit_c * quantidade) c FROM meli_pedido_item WHERE cliente = ? AND status = 'cancelled' AND dia BETWEEN ? AND ? GROUP BY dia")
  const pagas = new Map(); for (const x of f.fins) if (com.has(x.dia)) pagas.set(x.dia, (pagas.get(x.dia) || 0) + x.receita_c)
  let bruta_c = 0; for (const d of com) { const p = pagas.get(d) || 0; bruta_c += p + Math.max(0, (serie.get(d) || 0) - p, canc.get(d) || 0) }
  const conta = agregar(f.fins.filter(x => com.has(x.dia)), () => 'conta', { minimo: f.minimo }).get('conta')      // só os dias com linhas (o mesmo recorte da receita bruta)
  return { cliente, disponivel: true, de: ini, ate, ...dreMensal({ mes, dias: f.dias, gmv_c: bruta_c, conta, imposto_pct: f.imposto_pct, ads_c: null, minimo: f.minimo, tarifa_rotulo: f.tarifa.rotulo }), premissas: f.premissas }
}
