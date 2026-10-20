// Autoteste do "melhor profissional para a tarefa": ranking por família com prova estatística (Wilson × taxa habitual), receita incremental,
// velocidade, volume, experiência no cliente e carga; sem amostra mínima não afirma "melhor". Só funções puras (sem banco, sem rede).
import assert from 'node:assert/strict'
import { rankear, PESOS } from '../src/lib/melhor-profissional.js'

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const prest = ['Ana Souza', 'Bruno Lima', 'Carla Dias'].map(nome => ({ nome }))
const canon = s => prest.find(p => p.nome.toLowerCase().startsWith(String(s).toLowerCase().split(' ')[0]))?.nome || null
const med = (analista, estado, extra = {}) => ({ tipo: 'Otimizar Anúncios', analista, estado, receita_incremental: estado === 'melhorou' ? 300 : 0, cliente: 'X', data: '2026-09-01', ...extra })
const conc = (responsavel, ini, fim, tipo = 'Otimizar Anúncios') => ({ responsavel, tipo_demanda: tipo, cliente: 'X', data_inicio: ini, data_conclusao: fim })

ok('soma de pesos = 1 e componentes conhecidos', () => { assert.ok(Math.abs(Object.values(PESOS).reduce((a, b) => a + b, 0) - 1) < 1e-9); assert.deepEqual(Object.keys(PESOS), ['resultado', 'velocidade', 'volume', 'experiencia_cliente', 'carga']) })

ok('com prova: quem melhora acima da taxa habitual da família vira recomendado, com motivo e evidência; o fraco fica marcado', () => {
  const medidas = [...[...Array(12)].map((_, i) => med('Ana', i < 9 ? 'melhorou' : 'sem_efeito')), ...[...Array(20)].map(() => med('Bruno', 'piorou')), ...[...Array(10)].map(() => med('Carla', 'sem_efeito'))]
  const r = rankear({ familia: 'otimizar', cliente: 'X', medidas, concluidas: [conc('Ana', '2026-09-01', '2026-09-03'), conc('Bruno', '2026-09-01', '2026-09-10')], abertas: [{ responsavel: 'Ana' }], prestadores: prest, canon, minN: 8 })
  assert.equal(r.recomendado?.nome, 'Ana Souza'); assert.match(r.recomendado.motivo, /9 de 12 melhoraram/); assert.equal(r.aviso, '')
  assert.ok(r.base_familia != null && r.base_familia <= 0.5)
  const bruno = r.ranking.find(x => x.nome === 'Bruno Lima'); assert.equal(bruno.fraco, true); assert.equal(bruno.prova, false)
  assert.ok(r.ranking[0].evidencia.some(e => /melhoraram as vendas/.test(e)) && r.ranking[0].evidencia.some(e => /receita incremental/.test(e)) && r.ranking[0].evidencia.some(e => /dia\(s\) na mediana/.test(e)))
  assert.equal(r.ranking[0].componentes.experiencia_cliente, 0.6, 'experiência no cliente normalizada pelo maior (12 de 20)')
})
ok('sem amostra mínima: ninguém é "recomendado"; aviso explica; ordem por volume/velocidade segue como contexto', () => {
  const medidas = [med('Ana', 'melhorou'), med('Ana', 'melhorou'), med('Bruno', 'piorou')]
  const r = rankear({ familia: 'otimizar', medidas, concluidas: [conc('Carla', '2026-09-01', '2026-09-02'), conc('Carla', '2026-09-03', '2026-09-04'), conc('Carla', '2026-09-05', '2026-09-05')], abertas: [], prestadores: prest, canon, minN: 8 })
  assert.equal(r.recomendado, null); assert.match(r.aviso, /sem prova suficiente/); assert.equal(r.base_familia, null)
  assert.ok(r.ranking.length === 3 && r.ranking.every(l => !l.prova))
  assert.equal(r.ranking.find(l => l.nome === 'Carla Dias').concluidas_fam90, 3)
})
ok('família isola: medidas de outra família não contam; reversão provável e estados não medidos ficam de fora', () => {
  const medidas = [...[...Array(10)].map(() => med('Ana', 'melhorou', { tipo: 'Duplicar anúncios' })), ...[...Array(10)].map(() => med('Bruno', 'melhorou', { reversao_provavel: true })), med('Carla', 'em_maturacao')]
  const r = rankear({ familia: 'otimizar', medidas, concluidas: [], abertas: [], prestadores: prest, canon, minN: 8 })
  assert.equal(r.n_medidas_familia, 0); assert.equal(r.recomendado, null)
  const dup = rankear({ familia: 'duplicacao', medidas, concluidas: [], abertas: [], prestadores: prest, canon, minN: 8 })
  assert.equal(dup.n_medidas_familia, 10); assert.equal(dup.recomendado?.nome, 'Ana Souza')
})
ok('cards com vários responsáveis dão crédito a cada um; nome que não casa com prestador ativo não entra; carga penaliza', () => {
  const medidas = [...[...Array(10)].map(() => med('Ana, Bruno', 'melhorou')), ...[...Array(10)].map(() => med('Zé Ninguém', 'melhorou'))]
  const r = rankear({ familia: 'otimizar', medidas, concluidas: [], abertas: [...Array(9)].map(() => ({ responsavel: 'Bruno' })), prestadores: prest, canon, minN: 8 })
  assert.equal(r.ranking.find(l => l.nome === 'Ana Souza').n, 10); assert.equal(r.ranking.find(l => l.nome === 'Bruno Lima').n, 10)
  assert.ok(!r.ranking.some(l => /Ninguém/.test(l.nome)))
  assert.ok(r.ranking.find(l => l.nome === 'Ana Souza').score > r.ranking.find(l => l.nome === 'Bruno Lima').score, 'mesma prova, Bruno carregado fica atrás')
})
ok('nicho (opt-in): só as medidas do nicho contam; sem amostra no nicho, o aviso diz qual nicho; sem nicho, nada muda', () => {
  const medidas = [...[...Array(12)].map((_, i) => med('Ana', i < 9 ? 'melhorou' : 'sem_efeito', { nicho: 'Pet' })), ...[...Array(20)].map(() => med('Bruno', 'piorou', { nicho: 'Moda' })), ...[...Array(10)].map(() => med('Carla', 'sem_efeito', { nicho: 'Moda' }))]
  const todos = rankear({ familia: 'otimizar', medidas, concluidas: [], abertas: [], prestadores: prest, canon, minN: 8 })
  assert.equal(todos.n_medidas_familia, 42); assert.equal(todos.nicho, null)
  const moda = rankear({ familia: 'otimizar', medidas, concluidas: [], abertas: [], prestadores: prest, canon, minN: 8, nicho: 'Moda' })
  assert.equal(moda.n_medidas_familia, 30); assert.equal(moda.nicho, 'Moda'); assert.ok(!moda.ranking.some(l => l.nome === 'Ana Souza' && l.n > 0), 'as medidas de Pet não contam em Moda')
  const pet = rankear({ familia: 'otimizar', medidas, concluidas: [], abertas: [], prestadores: prest, canon, minN: 8, nicho: 'Pet' })
  assert.equal(pet.ranking.find(l => l.nome === 'Ana Souza').n, 12); assert.equal(pet.ranking.find(l => l.nome === 'Bruno Lima')?.n ?? 0, 0)
  const cos = rankear({ familia: 'otimizar', medidas, concluidas: [], abertas: [], prestadores: prest, canon, minN: 8, nicho: 'Cosméticos' })
  assert.equal(cos.recomendado, null); assert.match(cos.aviso, /só 0 tarefa\(s\).*no nicho "Cosméticos"/)
})
ok('canal (opt-in): fora do ML não há medição ("sem medição para Shopee"), volume e velocidade recortados pelo processo do card; ML = medidas de sempre', () => {
  const medidas = [...Array(12)].map((_, i) => med('Ana', i < 9 ? 'melhorou' : 'sem_efeito'))
  const concluidas = [{ ...conc('Carla', '2026-09-01', '2026-09-02'), processo: 'Shopee 2' }, { ...conc('Carla', '2026-09-03', '2026-09-04'), processo: 'Shopee' }, { ...conc('Bruno', '2026-09-01', '2026-09-05'), processo: 'Mercado Livre' }]
  const sho = rankear({ familia: 'otimizar', medidas, concluidas, abertas: [], prestadores: prest, canon, minN: 8, canal: 'SHO' })
  assert.equal(sho.n_medidas_familia, 0); assert.equal(sho.recomendado, null); assert.match(sho.aviso, /^sem medição para Shopee/); assert.equal(sho.canal, 'SHO')
  assert.equal(sho.ranking.find(l => l.nome === 'Carla Dias').concluidas_fam90, 2); assert.equal(sho.ranking.find(l => l.nome === 'Bruno Lima')?.concluidas90 ?? 0, 0, 'card do ML não conta no volume da Shopee')
  const ml = rankear({ familia: 'otimizar', medidas, concluidas, abertas: [], prestadores: prest, canon, minN: 8, canal: 'ML' })
  assert.equal(ml.n_medidas_familia, 12); assert.equal(ml.ranking.find(l => l.nome === 'Bruno Lima').concluidas_fam90, 1); assert.equal(ml.ranking.find(l => l.nome === 'Carla Dias')?.concluidas90 ?? 0, 0)
})
console.log(`\nteste-melhor-profissional: ${n} verificações ok`)
