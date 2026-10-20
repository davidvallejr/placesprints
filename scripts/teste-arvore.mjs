// Autoteste da árvore de diagnóstico de anúncio — as regras do David como casos canônicos.
import assert from 'node:assert/strict'
import { diagnosticoAnuncio, ancoragem } from '../src/lib/arvore-anuncio.js'

// 1) caiu a IMPRESSÃO → ficha técnica/título/ADS (não a capa)
let r = diagnosticoAnuncio({ impressoes: { antes: 10000, depois: 6000 }, cliques: { antes: 200, depois: 120 }, pedidos: { antes: 10, depois: 6 } })
let a = r.achados.find(x => x.etapa === 'exposicao')
assert.ok(a && /ficha técnica/i.test(a.mexa_em.join(' ')) && /ADS/i.test(a.mexa_em.join(' ')))
assert.ok(!r.achados.some(x => x.etapa === 'clique'), 'CTR estável (2%) — não mandar mexer na capa')

// 2) impressão estável, caiu o CLIQUE → FOTO DE CAPA primeiro (uma variável por vez)
r = diagnosticoAnuncio({ impressoes: { antes: 10000, depois: 10200 }, cliques: { antes: 250, depois: 120 }, pedidos: { antes: 8, depois: 4 } })
a = r.achados.find(x => x.etapa === 'clique')
assert.ok(a && /FOTO DE CAPA/i.test(a.mexa_em[0]), 'capa é o alvo nº 1')
assert.ok(!r.achados.some(x => x.etapa === 'exposicao'))

// 3) clique bom, CONVERSÃO ruim → frete/carrossel/oferta/concorrente/logística (nunca a capa)
r = diagnosticoAnuncio({ impressoes: { antes: 10000, depois: 10000 }, cliques: { antes: 300, depois: 310 }, pedidos: { antes: 9, depois: 2 }, frete_gratis: false, imagens_carrossel: 2, prazo_dias: 8 })
a = r.achados.find(x => x.etapa === 'conversao')
assert.ok(a)
const tx = a.mexa_em.join(' | ')
assert.ok(/FRETE/.test(tx) && /CARROSSEL/.test(tx) && /LOGÍSTICA/.test(tx) && /Ancoragem/i.test(tx))
assert.ok(!r.achados.some(x => x.etapa === 'clique'), 'CTR saudável — capa fica quieta')

// 4) ANCORAGEM — o caso canônico: nós 70→49 (30%), concorrente 67→49 (27%): ele vence
const anc = ancoragem({ de: 70, por: 49 }, { de: 67, por: 49 })
assert.equal(anc.gravidade, 'alta')
assert.ok(/mais crível/.test(anc.veredito), 'âncora menor com mesmo preço final é mais crível')
assert.ok(/70/.test(anc.evidencia) && /67/.test(anc.evidencia))
// âncora saudável quando a nossa é igual/menor
assert.equal(ancoragem({ de: 65, por: 49 }, { de: 70, por: 49 }).gravidade, 'ok')
// sem concorrente = pedir o dado, nunca julgar sozinho
assert.equal(ancoragem({ de: 70, por: 49 }, null).gravidade, 'info')
// "de" menor que "por" é inválido → ignorado
assert.equal(ancoragem({ de: 40, por: 49 }, { de: 67, por: 49 }), null)

// 5) dados faltando = declarados, nunca inventados
r = diagnosticoAnuncio({ impressoes: { antes: 1000, depois: 900 } })
assert.ok(r.faltando.length >= 2)

// 6) tudo saudável → veredito ok único
r = diagnosticoAnuncio({ impressoes: { antes: 1000, depois: 1050 }, cliques: { antes: 30, depois: 32 }, pedidos: { antes: 5, depois: 6 } })
assert.ok(r.achados.length === 1 && r.achados[0].gravidade === 'ok')

// REGRESSÕES da revisão adversarial (06/10/2026)
// #0 CRÍTICO: campo vazio (null) NÃO vira zero — antes inventava "CTR 0%"/"conversão 0%"
r = diagnosticoAnuncio({ impressoes: { antes: 10000, depois: 10000 }, cliques: { antes: null, depois: null }, pedidos: { antes: null, depois: null } })
assert.ok(!r.achados.some(x => ['clique', 'conversao'].includes(x.etapa)), 'vazio não gera achado inventado')
assert.ok(r.faltando.some(f => /cliques/.test(f)) && r.faltando.some(f => /pedidos/.test(f)), 'vazio vira "faltando"')
// #5 strings via API comparadas como NÚMERO ('7' >= '49' era true como texto)
assert.equal(ancoragem({ de: '7', por: '49' }, null), null, '"de" menor que "por" é inválido mesmo em string')
assert.equal(ancoragem({ de: '70', por: '49' }, { de: '67', por: '49' }).gravidade, 'alta')
// #11 impressão E CTR caindo: o achado de capa NÃO é engolido
r = diagnosticoAnuncio({ impressoes: { antes: 10000, depois: 5000 }, cliques: { antes: 500, depois: 50 }, pedidos: { antes: 20, depois: 2 } })
assert.ok(r.achados.some(x => x.etapa === 'exposicao') && r.achados.some(x => x.etapa === 'clique'))
// #10 conversão nunca chama o CTR de "saudável" quando o clique caiu
r = diagnosticoAnuncio({ impressoes: { antes: 10000, depois: 10000 }, cliques: { antes: 500, depois: 150 }, pedidos: { antes: 25, depois: 2 } })
const conv = r.achados.find(x => x.etapa === 'conversao')
assert.ok(!conv || !/\(saudável\)/.test(conv.evidencia), 'sem "saudável" com CTR em queda')
// #23 proxy cliques→visitas declarado
if (conv) assert.ok(/sobre cliques/.test(conv.evidencia))
// #21 antes=0 informado ≠ ausente
r = diagnosticoAnuncio({ impressoes: { antes: 0, depois: 5000 } })
assert.ok(r.faltando.some(f => /anúncio novo/.test(f)))
// #22 metade do par de/por declarada
r = diagnosticoAnuncio({ meu: { de: null, por: 49 } })
assert.ok(r.faltando.some(f => /informe o "de" E o "por"/.test(f)))

console.log('✔ arvore-anuncio: impressão→ficha/ADS, clique→capa, conversão→frete/carrossel/ancoragem; caso 70→49 × 67→49 reconhecido')
