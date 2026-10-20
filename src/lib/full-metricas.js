// Métricas do Full (Mercado Livre Fulfillment) por conta: só entra o anúncio cuja logística coletada é 'fulfillment'.
// Honestidade: "logística ainda não coletada" (campo vazio em todos os anúncios) é diferente de "nenhum anúncio no Full".
import { db, hojeLocal } from './db.js'
import { carregarBase, portaoColeta } from './diagnostico-conta.js'

const r1 = n => Math.round(n * 10) / 10
const r2 = n => Math.round(n * 100) / 100
const var_ = (a, b) => b > 0 ? r1(100 * (a / b - 1)) : null
export const LIM_RISCO_DIAS = 10, MIN_UN_RISCO = 3      // risco de ruptura = cobertura < 10 dias com ≥ 3 un vendidas em 28 d (a Folha do anúncio usa os mesmos limites)

// itens: saída de carregarBase().itens; logistica: Map(item_id → logistic_type). Pura (testada em scripts/teste-full.mjs).
export function calcularFull(itens, logistica) {
  const coletada = [...logistica.values()].some(v => v)
  if (!coletada) return { disponivel: false, motivo: 'a logística (Full ou não) dos anúncios ainda não foi coletada — rode a coleta do Mercado Livre desta conta' }
  const full = itens.filter(i => logistica.get(i.id) === 'fulfillment'), fora = itens.filter(i => logistica.get(i.id) !== 'fulfillment')
  const total = itens.reduce((t, i) => t + i.r, 0), total0 = itens.reduce((t, i) => t + i.r0, 0)
  if (!full.length) return { disponivel: true, tem_full: false, anuncios_total: itens.length, leitura: 'Nenhum anúncio com venda no período está no Full.' }
  const s = (l, k) => l.reduce((t, i) => t + (i[k] || 0), 0)
  const rF = s(full, 'r'), rF0 = s(full, 'r0'), uF = s(full, 'u'), uF0 = s(full, 'u0')
  const visOk = l => l.length > 0 && l.every(i => i.visOk)
  const conv = l => visOk(l) && s(l, 'v') > 0 ? r2(100 * s(l, 'u') / s(l, 'v')) : null
  const velTotal = uF / 28, estoque = s(full, 'estoque')
  const risco = full.filter(i => i.cobertura != null && i.cobertura < LIM_RISCO_DIAS && i.u >= MIN_UN_RISCO).sort((a, b) => a.cobertura - b.cobertura)
    .slice(0, 5).map(i => ({ id: i.id, titulo: i.titulo, thumb: i.thumb, permalink: i.permalink, estoque: i.estoque, cobertura_dias: i.cobertura, unidades_28d: i.u }))
  const share = total > 0 ? r1(100 * rF / total) : null, share0 = total0 > 0 ? r1(100 * rF0 / total0) : null
  const cF = conv(full), cO = conv(fora)
  return {
    disponivel: true, tem_full: true, anuncios_full: full.length, anuncios_total: itens.length,
    receita: { atual: r2(rF), anterior: r2(rF0), pct: var_(rF, rF0) }, unidades: { atual: uF, anterior: uF0, pct: var_(uF, uF0) },
    share_pct: share, share_anterior_pct: share0,
    estoque_total: estoque, cobertura_dias: velTotal > 0 ? Math.round(estoque / velTotal) : null,
    conversao: { full: cF, fora_do_full: cO }, risco_ruptura: risco,
    leitura: `${full.length} anúncio(s) no Full responderam por ${share ?? '—'}% da receita do período${var_(rF, rF0) != null ? ` (${var_(rF, rF0) > 0 ? '+' : ''}${String(var_(rF, rF0)).replace('.', ',')}% sobre o período anterior)` : ''}.${risco.length ? ` ${risco.length} deles com estoque para menos de ${LIM_RISCO_DIAS} dias.` : ''}`,
  }
}

export function metricasFull(cliente, { hoje = hojeLocal() } = {}) {
  const base = carregarBase(cliente, { hoje })
  const portao = portaoColeta(cliente, base)        // o portão do diagnóstico: "sem coleta" é decidido pela cobertura de pedidos, nunca pelos anúncios lidos
  if (portao.bloqueio) return portao.bloqueio
  if (!base.itens.length) return { disponivel: false, motivo: 'conta coletada, sem venda nem Ads no período: nada a medir no Full' }
  const logistica = new Map(db.prepare('SELECT item_id, logistica FROM meli_item WHERE cliente = ?').all(cliente).map(r => [r.item_id, r.logistica || '']))
  return { ...calcularFull(base.itens, logistica), periodo: { de: base.de, ate: base.ate, anterior: base.anterior } }
}
