// Autoteste do PlacePlan (montagem pura sobre o banco real — sem rede, sem escrita no Notion).
import assert from 'node:assert/strict'
import { montarPlacePlan, analistaDaConta } from '../src/lib/placeplan.js'
import { listaOficial } from '../src/lib/analistas.js'

const CLI = 'Damar Comercial'                       // cliente real com plano gerado
const ac = analistaDaConta(CLI)
assert.ok(ac.geral && ac.geral.nome_notion, 'analista geral da conta identificado')
const oficiais = new Set(listaOficial().map(o => o.nome))
assert.ok(oficiais.has(ac.geral.oficial), 'o analista da conta vem da lista OFICIAL do RH')
assert.ok(ac.geral.tarefas_90d >= 1)

const m = montarPlacePlan(CLI)
assert.ok(!m.erro && m.paginas.length >= 1)
for (const p of m.paginas) {
  assert.ok(/·\sPlacePlan$/.test(p.titulo), 'título com o marcador de dedupe · PlacePlan')
  assert.ok(p.capa.startsWith('https://'), 'capa externa definida')
  assert.ok(p.linhas.length >= 1)
  for (const l of p.linhas) {
    for (const k of ['what', 'why', 'where', 'when', 'who', 'how', 'how_much']) assert.ok(String(l[k]).length > 0, `5W2H completo (${k})`)
    assert.equal(l.resultado, '', 'Resultado fica vazio — preenchido na execução, nunca inventado')
    assert.ok(['Proposto', 'Aprovado'].includes(l.situacao))
    assert.ok(/^(Analista|Consultor) — |a definir/.test(l.who), 'Who = analista da conta (ou consultor/a definir)')
  }
}
// REGRESSÕES (06/10/2026): canal canônico e analista geral
import('../src/lib/placeplan.js').then(() => {})
const { canalCanonico } = await import('../src/lib/placeplan.js')
assert.equal(canalCanonico('Shopee 1'), 'Shopee'); assert.equal(canalCanonico('Shopee2'), 'Shopee'); assert.equal(canalCanonico('Shoppe'), 'Shopee')
assert.equal(canalCanonico('Tiktok'), 'TikTok Shop'); assert.equal(canalCanonico('Mercado Livre 2'), 'Mercado Livre')
assert.equal(canalCanonico('Geral'), null, "'Geral' não é bucket de canal")
assert.ok(!('Geral' in ac.por_canal), 'sem bucket literal Geral')
assert.ok(Object.values(ac.por_canal).every(c => c.tarefas_90d >= 3), 'bucket de canal só com amostra mínima')
const pg = m.paginas.find(p => p.canal === 'Geral')
if (pg) assert.equal(pg.analista?.oficial, ac.geral.oficial, 'ação sem canal → analista GERAL da conta')
// cliente sem plano não monta nada (nunca inventa)
assert.ok(montarPlacePlan('__nao_existe__').erro)
console.log(`✔ placeplan: ${m.paginas.length} página(s) 5W2H p/ ${CLI}; analista da conta ${ac.geral.nome_notion} (${ac.geral.tarefas_90d} tarefas/90d, oficial: ${ac.geral.oficial.split(' ').slice(0,2).join(' ')})`)
