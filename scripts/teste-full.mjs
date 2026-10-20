// Autoteste das métricas do Full: logística não coletada ≠ "sem Full"; participação, variação e risco de ruptura.
import assert from 'node:assert/strict'
import { calcularFull } from '../src/lib/full-metricas.js'
const I = (id, extra) => ({ id, titulo: 'P ' + id, thumb: '', permalink: '', r: 1000, r0: 800, u: 20, u0: 16, v: 400, v0: 380, visOk: true, estoque: 100, cobertura: 140, ...extra })
const L = o => new Map(Object.entries(o))
// 1) nenhuma logística coletada → indisponível (NÃO "sem Full")
{ const r = calcularFull([I('A')], L({ A: '' })); assert.equal(r.disponivel, false); assert.match(r.motivo, /ainda não foi coletada/) }
// 2) coletada e nenhum no Full
{ const r = calcularFull([I('A'), I('B')], L({ A: 'cross_docking', B: 'xd_drop_off' })); assert.equal(r.disponivel, true); assert.equal(r.tem_full, false) }
// 3) Full com participação, variação e ruptura
{
  const itens = [I('A', { r: 3000, r0: 2000, u: 60, u0: 40, estoque: 12, cobertura: 6 }), I('B', { r: 1000, r0: 1000, u: 20, u0: 20 }), I('C', { r: 1000, r0: 1000, u: 20, u0: 20, estoque: 9, cobertura: 3, ...{ } })]
  const r = calcularFull(itens, L({ A: 'fulfillment', B: 'cross_docking', C: 'fulfillment' }))
  assert.equal(r.anuncios_full, 2); assert.equal(r.receita.atual, 4000); assert.equal(r.receita.anterior, 3000); assert.equal(r.receita.pct, 33.3)
  assert.equal(r.share_pct, 80); assert.equal(r.share_anterior_pct, 75)
  assert.deepEqual(r.risco_ruptura.map(x => x.id), ['C', 'A'], 'ordenado pela menor cobertura')
  assert.equal(r.conversao.full, 10); assert.equal(r.conversao.fora_do_full, 5)
  assert.equal(r.estoque_total, 21); assert.match(r.leitura, /2 anúncio\(s\) no Full/)
  // sem cobertura de visitas em algum anúncio: conversão não é inventada
  const sv = calcularFull([I('A', { visOk: false }), I('B')], L({ A: 'fulfillment', B: 'cross_docking' })); assert.equal(sv.conversao.full, null)
  // anúncio com pouca venda e pouco estoque não vira alarme de ruptura
  const peq = calcularFull([I('A', { u: 1, estoque: 1, cobertura: 1 })], L({ A: 'fulfillment' })); assert.equal(peq.risco_ruptura.length, 0)
}
console.log('teste-full: OK')
