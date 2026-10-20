// Autoteste do aprendizado da DUPLICAÇÃO ESTRATÉGICA (treinamento Place2u): objetivo inferido do card, volume do método, achar duplicatas (anúncios novos
// parecidos, ponderados pelo IDF), aderência ao método, efeito líquido da família com canibalização, aprendizado por objetivo/volume e fator do plano.
// Séries SINTÉTICAS com efeito plantado (sem rede; só funções puras).
import assert from 'node:assert/strict'
import { sobreposicao, classificarObjetivo, volumeEsperado, bucketVolume, acharFilhos, aderenciaAoMetodo, medirFamilia, aprenderDuplicacao, fatorPorObjetivo } from '../src/lib/duplicacao.js'
import { cfgAtrib, addDias } from '../src/lib/meli-serie.js'
import { veredito } from '../src/lib/retroalimentacao.js'
import { tokens } from '../src/lib/vinculos.js'
import { duplicacao as PB } from '../src/lib/processos.js'

let n = 0
const ok = (nome, fn) => { try { fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const HOJE = '2026-10-05', ATE = '2026-10-04', COB = { de: '2026-05-09', ate: ATE }
const serie = (base, de, ate, f = () => 1, amp = 0.15) => { const s = {}; for (let d = de, i = 0; d <= ate; d = addDias(d, 1), i++) s[d] = Math.max(0, Math.round(base * f(d) * (1 + amp * Math.sin(i * 1.7)))); return s }
const comReceita = (u, preco = 50) => ({ unidades: u, receita: Object.fromEntries(Object.entries(u).map(([d, x]) => [d, x * preco])) })

ok('objetivo vem do card: cada tipo do treinamento é reconhecido; sem pista = indefinido (regra de ouro: nunca duplicar sem objetivo)', () => {
  assert.equal(classificarObjetivo('Duplicar anúncio para teste A/B de título').id, 'teste_ab')
  assert.equal(classificarObjetivo('Criar 6 anúncios por nicho e público (urgência oculta)').id, 'novos_publicos')
  assert.equal(classificarObjetivo('Duplicar para conquistar a primeira página da busca').id, 'primeira_pagina')
  assert.equal(classificarObjetivo('Montar kit e combo de 3 unidades').id, 'kit_combo')
  assert.equal(classificarObjetivo('Recuperar posicionamento: curva A em queda').id, 'recuperacao')
  const sem = classificarObjetivo('Duplicar anúncio'); assert.equal(sem.id, 'indefinido'); assert.equal(sem.fonte, 'nenhuma')
})
ok('volume do método: A/B = 2 anúncios no total; nichos 5–10; recuperação 1–3; objetivo desconhecido não opina', () => {
  assert.equal(volumeEsperado('teste_ab', 1).ok, true, '1 duplicata + original = 2 no total')
  assert.equal(volumeEsperado('teste_ab', 2).ok, false)
  assert.equal(volumeEsperado('novos_publicos', 3).ok, false); assert.equal(volumeEsperado('novos_publicos', 7).ok, true); assert.equal(volumeEsperado('novos_publicos', 11).ok, false)
  assert.equal(volumeEsperado('recuperacao', 3).ok, true); assert.equal(volumeEsperado('recuperacao', 4).ok, false)
  assert.equal(volumeEsperado('kit_combo', 40).ok, true, 'kit/combo não tem teto')
  assert.equal(volumeEsperado('indefinido', 3).ok, null)
  assert.deepEqual([1, 2, 4, 5, 10, 11].map(bucketVolume), ['1 duplicata', '2 a 4 duplicatas', '2 a 4 duplicatas', '5 a 10 duplicatas', '5 a 10 duplicatas', 'mais de 10 duplicatas'])
})
ok('sobreposição de títulos: palavras em comum, overlap sobre o menor e jaccard', () => {
  const a = tokens('Ração Premium Cães Adultos Frango 10kg'), b = tokens('Ração Premium Cães Adultos Carne 15kg')
  const s = sobreposicao(a, b); assert.ok(s.comuns >= 3 && s.overlap > s.jaccard && s.jaccard < 1)
  assert.equal(sobreposicao(a, a).jaccard, 1); assert.equal(sobreposicao(a, tokens('Pneu aro 15 Pirelli')).comuns, 0)
})
ok('achar duplicatas: só anúncio NOVO (−3..+14 dias), parecido (≥ 65%, 3+ palavras) — palavra comum a toda a loja não prova parentesco', () => {
  const orig = { item_id: 'M1', titulo: 'Ração Premium Cães Adultos Frango 10kg', criado_em: '2026-01-10' }
  const data = '2026-09-10'
  const cand = [orig,
    { item_id: 'F1', titulo: 'Ração Premium Cães Adultos Frango 10kg Original Saco', criado_em: '2026-09-12', preco: 120 },       // filho
    { item_id: 'F2', titulo: 'Ração Premium Cães Adultos Frango Grande 10 kg', criado_em: '2026-09-20' },                       // filho (10 dias depois)
    { item_id: 'X1', titulo: 'Ração Premium Cães Adultos Frango 10kg', criado_em: '2026-08-01' },                              // parecido mas ANTIGO
    { item_id: 'X2', titulo: 'Ração Premium Cães Adultos Frango 10kg', criado_em: '2026-09-30' },                              // parecido mas fora da janela (+20d)
    { item_id: 'X3', titulo: 'Coleira Cães Adultos Premium Reforçada', criado_em: '2026-09-11' },                               // poucas palavras em comum
    ...Array.from({ length: 30 }, (_, k) => ({ item_id: 'L' + k, titulo: `Kit Cães Acessório ${k} Pet`, criado_em: '2026-01-01' })),
    { item_id: 'X4', titulo: 'Kit Cães Brinquedo Pet', criado_em: '2026-09-11' }]                                               // só palavras genéricas da loja
  const f = acharFilhos({ originais: [orig], candidatos: cand, data })
  assert.deepEqual(f.map(x => x.item_id).sort(), ['F1', 'F2'])
  assert.ok(f.every(x => x.original === 'M1' && x.similaridade >= PB.aprendizado.min_similaridade_filho))
  assert.equal(f.find(x => x.item_id === 'F1').preco, 120)
  const lote = Array.from({ length: 40 }, (_, k) => ({ item_id: 'B' + k, titulo: `Ração Premium Cães Adultos Frango 10kg lote ${k}`, criado_em: '2026-09-11' }))
  assert.ok(acharFilhos({ originais: [orig], candidatos: [orig, ...lote], data }).length <= 15, 'cadastro em lote não vira 40 duplicatas')
})
ok('aderência ao método: objetivo, volume, variação real (título/preço) e pesquisa prévia (urgência oculta é do consultor)', () => {
  const orig = [{ item_id: 'M1', preco: 100 }]
  const boa = aderenciaAoMetodo({ objetivo: { id: 'novos_publicos', nome: 'Novos públicos' }, filhos: Array.from({ length: 6 }, (_, k) => ({ item_id: 'F' + k, variacao_titulo: 0.5, preco: 100 })), originais: orig, pesquisaPrevia: true })
  assert.equal(boa.nota, 1); assert.ok(boa.itens.every(i => i.ok === true))
  const ruim = aderenciaAoMetodo({ objetivo: { id: 'indefinido' }, filhos: [{ item_id: 'F1', variacao_titulo: 0.05, preco: 100 }, { item_id: 'F2', variacao_titulo: 0.0, preco: 101 }], originais: orig, pesquisaPrevia: false })
  assert.equal(ruim.itens.find(i => i.k === 'objetivo').ok, false); assert.equal(ruim.itens.find(i => i.k === 'variacao').ok, false, 'só trocar a descrição não é variação')
  assert.equal(ruim.itens.find(i => i.k === 'volume'), undefined, 'sem objetivo não há volume para conferir')
  const semPesq = aderenciaAoMetodo({ objetivo: { id: 'novos_publicos', nome: 'x' }, filhos: [{ item_id: 'F1', variacao_titulo: 0.6, preco: 100 }], originais: orig, pesquisaPrevia: false })
  assert.equal(semPesq.itens.find(i => i.k === 'pesquisa').ok, false); assert.ok(semPesq.nota < 1)
  const precoDiferente = aderenciaAoMetodo({ objetivo: { id: 'teste_ab', nome: 'x' }, filhos: [{ item_id: 'F1', variacao_titulo: 0.0, preco: 120 }], originais: orig, pesquisaPrevia: false })
  assert.equal(precoDiferente.itens.find(i => i.k === 'variacao').ok, true, 'preço ≥ 3% diferente conta como variação')
})

// ── efeito líquido da família: série sintética com o efeito plantado ────────────────────────────────────────────
const DATA = addDias(ATE, -30)       // a duplicação foi feita há 30 dias
const montarCenario = ({ origDepois, filhoDepois }) => {
  const porItem = new Map()
  const f = (depois) => d => d > DATA ? depois : 1
  porItem.set('O', comReceita(serie(10, COB.de, ATE, f(origDepois))))
  porItem.set('F', comReceita(serie(10, addDias(DATA, 1), ATE, () => filhoDepois)))
  for (let k = 0; k < 6; k++) porItem.set('C' + k, comReceita(serie(10 + k, COB.de, ATE)))        // controle: estável
  return porItem
}
const medir = porItem => medirFamilia({ originais: ['O'], filhos: ['F'], data: DATA, porItem, tocados: new Map(), cobertura: COB, hoje: HOJE, lag: 7 })
ok('família: duplicata que soma vendas sem tirar do original = melhorou, sem canibalização', () => {
  const m = medir(montarCenario({ origDepois: 1, filhoDepois: 1 }))
  assert.equal(m.estado, 'melhorou'); assert.ok(m.efeito_pct > 20, 'efeito ' + m.efeito_pct); assert.equal(m.canibalizou, false)
})
ok('família: a duplicata só rouba o público do original (original cai, família estável) = canibalização detectada, não "ganho"', () => {
  const m = medir(montarCenario({ origDepois: 0.45, filhoDepois: 0.55 }))
  assert.equal(m.canibalizou, true, 'original ' + m.original_efeito_pct + '%, família ' + m.efeito_pct + '%'); assert.notEqual(m.estado, 'piorou')
  assert.ok(m.original_efeito_pct <= -cfgAtrib.limiar_efeito_pct)
})
ok('família: nada muda = sem efeito; tudo cai = piorou (e não é canibalização)', () => {
  const nada = medir(montarCenario({ origDepois: 1, filhoDepois: 0 }))
  assert.ok(['sem_efeito', 'sem_base'].includes(nada.estado), nada.estado)
  const cai = medir(montarCenario({ origDepois: 0.4, filhoDepois: 0 }))
  assert.equal(cai.estado, 'piorou'); assert.equal(cai.canibalizou, false)
})

// ── aprendizado por objetivo e volume ────────────────────────────────────────────────────────────────────────
const ep = (objetivo, n_filhos, estado, extra = {}) => ({ objetivo: { id: objetivo }, n_filhos, estado, efeito_pct: estado === 'melhorou' ? 25 : estado === 'piorou' ? -25 : 2, canibalizou: false, filhos: [], aderencia: { itens: [], nota: null }, ...extra })
ok('aprendizado: só afirma a partir da amostra mínima; leituras citam objetivo sem definição, duplicata sem venda, sem variação e canibalização', () => {
  const poucos = aprenderDuplicacao([ep('teste_ab', 1, 'melhorou'), ep('teste_ab', 1, 'melhorou')], { minN: 8, veredito })
  assert.equal(poucos.base, null); assert.ok(poucos.leituras.some(l => /Amostra ainda pequena/.test(l)))
  const eps = [...Array(10)].map((_, i) => ep('recuperacao', 2, i < 8 ? 'melhorou' : 'sem_efeito')), outros = [...Array(10)].map((_, i) => ep('novos_publicos', 6, i < 1 ? 'melhorou' : 'piorou'))
  const ap = aprenderDuplicacao([...eps, ...outros, ep('indefinido', 1, 'sem_efeito', { filhos: [{ sem_venda_14d: true }], aderencia: { itens: [{ k: 'variacao', ok: false }], nota: 0 } }), ep('teste_ab', 1, 'melhorou', { canibalizou: true })], { minN: 8, veredito })
  assert.ok(ap.base != null && ap.base <= 0.5, 'a taxa de base nunca passa de 50%')
  assert.equal(ap.por_objetivo.find(o => o.chave === 'recuperacao').veredito, 'funciona')
  assert.equal(ap.por_objetivo.find(o => o.chave === 'novos_publicos').veredito, 'nao_funciona')
  for (const rx of [/sem objetivo definido/, /sem nenhuma venda|14\+ dias sem/, /sem variação detectada/, /canibalizaram o original/, /Objetivo "Recuperar posicionamento/]) assert.ok(ap.leituras.some(l => rx.test(l)), String(rx))
})
ok('fator do plano por objetivo: só objetivo conclusivamente diferente do geral, limitado a 0,85–1,15, nunca com amostra pequena', () => {
  const eps = [...Array(12)].map((_, i) => ep('recuperacao', 2, i < 10 ? 'melhorou' : 'sem_efeito')), ruins = [...Array(12)].map((_, i) => ep('novos_publicos', 6, i < 1 ? 'melhorou' : 'piorou'))
  const todas = aprenderDuplicacao([...eps, ...ruins], { minN: 8, veredito })
  const f = fatorPorObjetivo(todas, { minN: 8 })
  assert.ok(f.recuperacao.fator > 1 && f.recuperacao.fator <= 1.15); assert.ok(f.novos_publicos.fator < 1 && f.novos_publicos.fator >= 0.85)
  assert.deepEqual(fatorPorObjetivo(aprenderDuplicacao(eps.slice(0, 5), { minN: 8, veredito }), { minN: 8 }), {}, 'amostra pequena não mexe no plano')
  // episódio cuja tarefa saiu do aprendizado (preço mexendo junto, reversão à média) não conta: o preço não rebaixa o objetivo
  const comPreco = aprenderDuplicacao([...eps, ...ruins.map(e => ({ ...e, confundido_preco: true }))], { minN: 8, veredito })
  assert.equal(comPreco.n_medidos, eps.length); assert.ok(!comPreco.por_objetivo.some(o => o.chave === 'novos_publicos'))
  const comEstado = aprenderDuplicacao([...eps, ...ruins.map(e => ({ ...e, confundido_estado: true }))], { minN: 8, veredito })   // promoção/Ads/Full na janela da tarefa: também não ensina o objetivo
  assert.equal(comEstado.n_medidos, eps.length); assert.ok(!comEstado.por_objetivo.some(o => o.chave === 'novos_publicos'))
  const iguais = aprenderDuplicacao([...Array(10)].map((_, i) => ep('teste_ab', 1, i < 5 ? 'melhorou' : 'piorou')).concat([...Array(10)].map((_, i) => ep('kit_combo', 3, i < 5 ? 'melhorou' : 'piorou'))), { minN: 8, veredito })
  assert.deepEqual(fatorPorObjetivo(iguais, { minN: 8 }), {}, 'objetivos iguais ao geral não ajustam nada')
})
console.log(`\nteste-duplicacao: ${n} verificações ok`)
