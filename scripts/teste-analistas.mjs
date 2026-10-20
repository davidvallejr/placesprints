// Autoteste do módulo de analistas (janelas de resultado + agregações reais, sem rede).
import assert from 'node:assert/strict'
import { visaoTime, clientesAtrasados, janelasResultado, tiposQueMovem, detalheAnalista, casadorOficial, listaOficial } from '../src/lib/analistas.js'

// janelasResultado: série sintética 10/dia antes, 13/dia depois da conclusão → +30% em toda janela
const serie = {}
const dia = n => { const d = new Date('2026-09-30T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
for (let i = -25; i <= -1; i++) serie[dia(i)] = 10
for (let i = 1; i <= 25; i++) serie[dia(i)] = 13
const j = janelasResultado(serie, dia(0))
for (const k of [1, 3, 5, 15, 20]) { assert.equal(j[k].antes, 10); assert.equal(j[k].depois, 13); assert.equal(j[k].delta_pct, 30) }
assert.equal(janelasResultado({}, dia(0))[5].delta_pct, 0)                    // série vazia: 0 → 0, nunca inventa
assert.equal(janelasResultado({ [dia(2)]: 5 }, dia(0))[3].delta_pct, null)    // base zero com depois>0 = sem base (não "+∞%")

// visão do time sobre o banco real: demo excluído, números coerentes
const v = visaoTime()
assert.ok(v.time.analistas > 3 && v.time.abertas > 100)
assert.ok(!v.analistas.some(a => ['Carlos Lima', 'Ana Souza', 'Bruna Alves'].includes(a.nome)), 'seed demo não pode entrar')
assert.ok(v.time.pct_sem_prazo >= 90, 'a cegueira de prazo existe e é declarada')
for (const a of v.analistas.slice(0, 5)) {
  assert.ok(a.concluidas28 <= a.concluidas90)
  if (a.mediana_dias != null) assert.ok(a.mediana_dias >= 0 && a.cobertura_duracao > 0)
}

// clientes com atraso (real + proxy) ordenados por gravidade
const c = clientesAtrasados()
assert.ok(c.clientes.length > 10)
for (let i = 1; i < Math.min(c.clientes.length, 20); i++) assert.ok(c.clientes[i - 1].gravidade >= c.clientes[i].gravidade)
assert.ok(c.cegueira.includes('Prazo'))
// dependência do cliente: contada à parte (fora de abertas/carga/gravidade) e a cegueira declara
assert.ok(Number.isInteger(v.time.dependencia_cliente) && v.time.dependencia_cliente >= 0)
assert.ok(c.cegueira.includes('aguardando o cliente não contam como atraso nem como carga'))

// tipos que movem: tipos reais + combos contam 1× por cliente
const t = tiposQueMovem()
assert.ok(t.tipos.length >= 5 && t.tipos[0].concluidas >= t.tipos.at(-1).concluidas)
assert.ok(t.combos.every(x => x.clientes >= 1 && x.combo.includes(' + ')))

// drill-down do analista mais ativo
const top = v.analistas[0]
const d = detalheAnalista(top.nome)
assert.equal(d.nome, top.nome)
assert.ok(d.clientes.length >= 1 && d.tipos.length >= 1)

// REGRESSÕES da revisão adversarial (out/2026):
// crédito 1× mesmo com 'X, X' (há 9 cards reais assim) → visão e detalhe COERENTES
for (const a2 of v.analistas.slice(0, 3)) {
  const det = detalheAnalista(a2.nome)
  assert.equal(det.concluidas90, a2.concluidas90, `visão×detalhe divergem p/ ${a2.nome}`)
  assert.equal(det.abertas, a2.abertas, `abertas divergem p/ ${a2.nome}`)
}
// detalhe aceita caixa/acento diferente (o LIKE cru zerava)
const dUp = detalheAnalista(top.nome.toUpperCase())
assert.equal(dUp.concluidas90, d.concluidas90, 'caixa alta não pode zerar o detalhe')

// LISTA OFICIAL (base de RH do Notion): só analistas de marketplace aparecem
if (listaOficial().length) {
  const of = casadorOficial()
  assert.equal(of('Vitória Oliveira'), 'Vitória de Jesus Rodrigues de Oliveira')   // subsequência de palavras
  assert.equal(of('renan matos'), 'Renan Matos Harze Da Silva')
  assert.equal(of('Bianca'), null, '1 palavra ambígua não casa')
  assert.equal(of('David Jesus'), null, 'quem não é analista fica fora')
  const nomes = new Set(listaOficial().map(o => o.nome))
  assert.ok(v.analistas.every(a2 => nomes.has(a2.nome)), 'painel só com nomes da lista oficial')
  assert.ok(v.lista_oficial.fora_total > 0, 'excluídos declarados')
}

console.log(`✔ analistas: janelas ±1/3/5/15/20 ok; ${v.time.analistas} analistas reais (demo fora); cegueira ${v.time.pct_sem_prazo}% declarada; top volume: ${top.nome} (${top.concluidas28}/28d, mediana ${top.mediana_dias}d em ${top.cobertura_duracao}% das concluídas)`)
console.log('  combos reais:', t.combos.slice(0, 3).map(x => `${x.combo} (${x.clientes} clientes)`).join(' · '))
