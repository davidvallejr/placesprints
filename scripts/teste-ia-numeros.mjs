// Autoteste da conferência de números da IA (numerosFora) e do cache de redigir (src/lib/ia.js), revisão adversarial de 08/10/2026:
// achado 7 (saco global sem sinal, escala, fração lida como data, número por extenso, dígito de largura total) e achado 12 (cache gravava o template
// em falha/timeout e o hash ignorava o conteúdo do prompt). Banco EM MEMÓRIA, IA nunca chamada de verdade (só stub injetado).
// Rodar: node scripts/teste-ia-numeros.mjs
process.env.PS_DB_MEMORIA = '1'
process.env.ANTHROPIC_API_KEY = ''
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { db } = await import('../src/lib/db.js')
const { numerosFora, redigir, hashRedigir, PROMPT_VERSAO } = await import('../src/lib/ia.js')
const { ROOT } = await import('../src/lib/env.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
// evidência no molde do Photo K: receita 96.283, vendas −15%, ROAS 4,2735, 48 pedidos, conversão +12%
const EV = [
  { id: 'ev-1', valor: 96283, unidade: 'BRL', texto: 'Receita: 96283', periodo: '2026-09-07..2026-10-04' },
  { id: 'ev-2', valor: -15, unidade: '%', texto: 'Vendas: -15% sobre o período anterior' },
  { id: 'ev-3', valor: 4.2735, unidade: 'x', texto: 'ROAS: 4.2735' },
  { id: 'ev-4', valor: 48, unidade: null, texto: 'Pedidos pagos: 48' },
  { id: 'ev-5', valor: 12, unidade: '%', texto: 'Conversão: alta de 12%' },
  { id: 'ev-6', valor: 500, unidade: 'BRL', texto: 'Saldo em caixa: 500' },
  { id: 'ev-7', valor: 20, unidade: null, texto: 'Visitas de 20 para 10 por dia' },
]
const reprova = (texto, esperado) => { const f = numerosFora(texto, EV); assert.ok(f.length, `deveria reprovar: ${texto}`); if (esperado) assert.ok(f.includes(esperado), `${texto} → ${JSON.stringify(f)} sem ${esperado}`) }
const passa = texto => assert.deepEqual(numerosFora(texto, EV), [], texto)

await ok('achado 7 — sinal: alta citada sobre evidência de queda (e o inverso) reprova; sinal certo passa; sem sinal reconhecido vale como positivo', () => {
  for (const t of ['As vendas cresceram 15% no período.', 'As vendas subiram 15%.', 'Aumentou 15% a venda.', 'Alta de 15% nas vendas.', 'Vendas: +15%.']) reprova(t, '+15')
  for (const t of ['A conversão caiu 12%.', 'Queda de 12% na conversão.', 'Conversão recuou 12%.', 'Conversão: -12%.', 'Conversão: −12%.', 'Redução de 12% na conversão.']) reprova(t, '-12')
  for (const t of ['As vendas caíram 15%.', 'Queda de 15% nas vendas.', 'Vendas: -15%.', 'Vendas diminuíram cerca de 15%.', 'A conversão cresceu 12%.', 'Conversão: +12%.']) passa(t)
  passa('Visitas caíram de 20 para 10 por dia.')                              // nível de partida, não variação
  passa('Saldo em caixa de R$ 500.'); passa('ROAS 4,27 com 48 pedidos.')      // "caixa" não é "caiu"; número sem verbo de sinal
  // MUDOU (refutação do achado 7): "Variação das vendas de 15%" passava; agora número sem sinal reconhecido vale como positivo, e a evidência é −15 —
  // o texto omite a queda, então volta ao template (falha segura). Antes estava na lista de "passa".
  reprova('Variação das vendas de 15%.', '15')
})
await ok('achado 7 (refutação) — sinal fora da lista fechada: qualificador, sinônimo, elipse, substantivo, adjetivo, vírgula e locução não escondem a direção', () => {
  for (const t of ['As vendas cresceram em torno de 15%.', 'As vendas cresceram por volta de 15%.', 'As vendas melhoraram 15%.', 'As vendas saltaram 15%.', 'As vendas dispararam 15%.', 'Ganho de 15% nas vendas.',
    'O crescimento das vendas foi de 15%.', 'As vendas tiveram crescimento expressivo de 15%.', 'As vendas subiram, no período, 15%.', 'As vendas caíram mas a conversão melhorou 15%.']) reprova(t, '+15')
  for (const t of ['As vendas tiveram variação positiva de 15%.', 'As vendas ficaram 15% acima do período anterior.']) reprova(t)   // sem sinal ou com +: nunca confere com −15
  for (const t of ['A conversão caiu apenas 12%.', 'A conversão despencou 12%.', 'A conversão piorou 12%.', 'A conversão encolheu 12%.', 'As vendas caíram 15% e a conversão, 12%.',
    'A conversão caiu, no período, 12%.', 'A conversão ficou 12% abaixo do período anterior.', 'Conversão: –12%.', 'Conversão: ‑12%.']) reprova(t, '-12')   // en dash e hífen não separável são menos
  for (const t of ['A queda das vendas foi de 15%.', 'As vendas caíram em torno de 15%.', 'Vendas: –15%.', 'Variação negativa de 15% nas vendas.', 'As vendas ficaram 15% abaixo do período anterior.',
    'As vendas caíram 15% e a conversão subiu 12%.', 'Apesar da queda de 15% nas vendas, a conversão subiu 12%.', 'A receita caiu 15% enquanto o ROAS ficou em 4,27.',
    'As vendas caíram 15%, com 48 pedidos no período.', 'As vendas caíram 15% (48 pedidos).', 'Mesmo com a queda nas vendas, 48 pedidos foram pagos.', 'Conversão em alta de 12%.']) passa(t)
})
await ok('achado 7 (refutação) — nível não é direção: "margem baixa de 8%" (adjetivo), "caiu e está em", "caiu para", oração separada por vírgula', () => {
  const EV2 = [{ valor: 8, unidade: '%', texto: 'Margem pós-Ads: 8%' }, { valor: 1.2, unidade: '%', texto: 'Conversão da conta: 1.2%' }, { valor: 96283, texto: 'Receita: 96283', periodo: '2026-09-07..2026-10-04' }]
  for (const t of ['A margem baixa de 8% pede atenção.', 'Conversão baixa de 1,2%.', 'A conversão caiu e está em 1,2%.', 'A conversão caiu para 1,2%.', 'Apesar da queda nas visitas, a conversão foi de 1,2%.',
    'A margem está em 8%, mesmo com a queda nas visitas.']) assert.deepEqual(numerosFora(t, EV2), [], t)
  assert.deepEqual(numerosFora('A margem caiu 8%.', EV2), ['-8']); assert.deepEqual(numerosFora('Uma baixa de 1,2% na conversão.', EV2), ['-1.2'])
  // evidência em texto livre (payload JSON do resumo): direção por palavra só marca %; o "3" do título não vira −3
  const evJson = [{ texto: JSON.stringify({ kpis: { concluidas: 7 }, entregas: [{ titulo: 'Corrigir queda de conversão do kit 3 peças' }], riscos: ['Recuperar queda de 15% nas vendas'] }) }]
  assert.deepEqual(numerosFora('Foram concluídas 7 tarefas, entre elas o kit 3 peças.', evJson), [])
  assert.deepEqual(numerosFora('As vendas caíram 15%.', evJson), []); assert.deepEqual(numerosFora('As vendas cresceram 15%.', evJson), ['+15'])
})
await ok('achado 7 — escala: "R$ 48 mil" com receita de 96.283 reprova (48 existe como pedidos); "96 mil" / "96,3 mil" / "96.283" passam; "mil" sem algarismo reprova', () => {
  reprova('Receita de R$ 48 mil.', '48 mil'); reprova('Faturou 1,5 milhão.', '1.5 milhão'); reprova('Mil pedidos no mês.', 'mil')
  passa('Receita de R$ 96 mil.'); passa('Receita de R$ 96,3 mil.'); passa('Receita de R$ 96,28 mil.'); passa('Receita de R$ 96.283.')
  reprova('Receita caiu R$ 96 mil.', '-96 mil')                                // escala também respeita o sinal
  reprova('Receita de R$ 48k no período.', '48 k'); reprova('Receita de R$ 48K no período.', '48 k'); passa('Receita de R$ 96k.')   // "k" é mil (refutação)
})
await ok('achado 7 — datas: só data válida e em contexto sai do texto; "3/4 dos anúncios" é fração e confere numerador e denominador; data inválida é conferida', () => {
  assert.deepEqual(numerosFora('Em 3/4 dos anúncios a foto é fraca.', EV), ['3'], '3 é conferido (4 existe: ROAS 4,27 arredondado)')
  assert.deepEqual(numerosFora('Em 3/7 dos anúncios a foto é fraca.', EV), ['3', '7'])
  assert.deepEqual(numerosFora('Só 3/7 têm vídeo.', EV), ['3', '7'])
  assert.deepEqual(numerosFora('Revisar em 32/13.', EV), ['32', '13'])
  assert.deepEqual(numerosFora('Às 25:99.', EV), ['25', '99'])
  for (const t of ['Atualizado em 05/10/2026 às 14:30.', 'Período (07/09 a 04/10).', 'Revisar no dia 3/4.', 'De 3/4 a 10/4 sem coleta.', 'Janela 2026-09-07 a 2026-10-04.', 'Revisar em 05/11/26.']) passa(t)
  // refutação: fração depois de "de/em" seguida de qualquer palavra, e d/m de 2 dígitos sem forma de data, são conferidas
  assert.deepEqual(numerosFora('Em 3/7 deles a foto é fraca.', EV), ['3', '7']); assert.deepEqual(numerosFora('Em 3/4 anúncios a foto é fraca.', EV), ['3'])
  assert.deepEqual(numerosFora('Queda de 1/4 nas vendas.', EV), ['-1']); assert.deepEqual(numerosFora('Faltam fotos em 11/12 anúncios.', EV), ['11'], '12 existe (conversão)')
  // refutação (regressão b): intervalo com d/m de 1 dígito, depois de "(" ou ":", é data — o período em evidence não fornece 7 e 9
  for (const t of ['Período: 7/9 a 4/10.', 'Receita de R$ 96.283 (7/9 a 4/10).', 'Receita de R$ 96.283 entre 07/09 e 04/10.', 'Atualizado em 05/10 às 14:30.', 'Dados até 04/10.', 'Desde 07/09, a conversão subiu 12%.']) passa(t)
})
await ok('achado 7 — palavras: dobr*/tripl*/metade/"por cento"/números por extenso reprovam; "um/uma" (artigo) passa', () => {
  for (const [t, w] of [['As vendas dobraram.', 'dobraram'], ['A receita dobrou.', 'dobrou'], ['Triplicou o tráfego.', 'triplicou'], ['Ficou na metade.', 'metade'], ['Vinte por cento a mais.', 'vinte'], ['Vinte por cento a mais.', 'por cento'],
    ['Dois anúncios sem foto.', 'dois'], ['Quinze pedidos.', 'quinze'], ['Cem visitas.', 'cem'], ['Trezentos pedidos.', 'trezentos'], ['15 por cento.', 'por cento'],
    ['Zero pedidos no período.', 'zero'], ['As vendas duplicaram.', 'duplicaram'], ['A receita duplicou no período.', 'duplicou'], ['Um quarto dos anúncios sem foto.', 'um quarto'],
    ['Dezenas de pedidos.', 'dezenas'], ['Centenas de visitas.', 'centenas'], ['Milhares de visitas.', 'milhares']]) reprova(t, w)
  passa('Um anúncio concentra a receita de R$ 96.283 e uma campanha tem ROAS 4,27.')
})
await ok('achado 7 — NFKC: dígito de largura total é conferido ("１５" = 15); dígito não ASCII que o NFKC não converte reprova', () => {
  reprova('Vendas: ７７ unidades.', '77'); passa('Vendas: －１５％.'); passa('Pedidos: ４８.')
  reprova('Pedidos: ٤٨.')
})
await ok('achado 7 — legítimos: número exato e arredondamentos de 0/1/2 casas; sem evidence declarada nada a conferir', () => {
  for (const t of ['ROAS 4,2735.', 'ROAS 4,27.', 'ROAS 4,3.', 'ROAS 4.', 'Receita de R$ 96.283,00.']) passa(t)
  reprova('ROAS 5.', '5'); reprova('ROAS 4,28.', '4.28')
  assert.deepEqual(numerosFora('cresceu 99% e dobrou', null), [])
})

await ok('motor-res A7 — acento não esconde palavra reprovada ("quádruplo", "três", "milhão"); "R$ 0 mil"/"0 mil"/"0k" nunca rastreáveis (escala não produz 0 por arredondamento)', () => {
  reprova('Quádruplo de vendas.', 'quadruplo'); reprova('As vendas quadruplicaram.', 'quadruplicaram'); reprova('Três anúncios sem foto.', 'tres'); reprova('Um milhão de visitas.', 'milhao'); reprova('Dois milhões.', 'milhoes'); reprova('Dez dúzias.', 'duzias')
  reprova('Receita de R$ 0 mil.', '0 mil'); reprova('0 mil pedidos.', '0 mil'); reprova('Receita de R$ 0k.', '0 k'); reprova('Receita de R$ 0,0 mil.', '0.0 mil')
  assert.deepEqual(numerosFora('Receita de R$ 0 mil.', [{ valor: 0, texto: 'Receita: 0' }, { valor: 120, texto: 'Pedidos: 120' }]), ['0 mil'], 'nem a evidência 0 nem 120 (→ "0 mil" arredondado) rastreiam "0 mil"')
  passa('Receita de R$ 96 mil.'); passa('Saldo de R$ 0,5 mil.')   // escala com número ≠ 0 segue conferida (0,5 mil = 500, ev-6)
})

const base = { fatos: { roas: 4.27 }, instrucao: 'Escreva a leitura.', template: () => 'Texto determinístico.', evidence: [{ valor: 4.27, texto: 'ROAS: 4.27' }] }
const linha = escopo => db.prepare('SELECT hash, origem, texto FROM ia_cache WHERE escopo = ?').get(escopo)
await ok('achado 12 — cache: template (sem chave, timeout, falha, reprovação) nunca é gravado; a IA é tentada de novo; só texto aprovado da IA entra no cache', async () => {
  const sem = await redigir({ ...base, escopo: 't:sem' }); assert.equal(sem.origem, 'deterministico'); assert.equal(linha('t:sem'), undefined)
  const logOrig = console.error; console.error = () => {}
  const to = await redigir({ ...base, escopo: 't:to', chamar: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) } })
  console.error = logOrig
  assert.equal(to.origem, 'deterministico'); assert.match(to.motivo, /timeout/); assert.equal(linha('t:to'), undefined)
  const rep = await redigir({ ...base, escopo: 't:to', chamar: async () => ({ texto: 'O ROAS dobrou.', tokens: null }) }); assert.equal(rep.cache, false); assert.match(rep.motivo, /não rastreável: dobrou/); assert.equal(linha('t:to'), undefined)
  let chamadas = 0
  const ia = await redigir({ ...base, escopo: 't:to', chamar: async () => { chamadas++; return { texto: 'ROAS 4,27.', tokens: null } } })
  assert.equal(ia.origem, 'ia'); assert.equal(ia.cache, false); assert.equal(chamadas, 1, 'depois do timeout a IA é chamada de novo (antes: cache do template)')
  assert.equal(linha('t:to').origem, 'ia')
  const hit = await redigir({ ...base, escopo: 't:to', chamar: async () => { throw new Error('não deveria chamar') } }); assert.equal(hit.cache, true); assert.equal(hit.texto, 'ROAS 4,27.')
  // depois de um texto da IA no cache, uma falha com fatos novos não sobrescreve com o template
  console.error = () => {}
  const falha = await redigir({ ...base, fatos: { roas: 5 }, escopo: 't:to', chamar: async () => { throw new Error('boom') } }); console.error = logOrig
  assert.equal(falha.origem, 'deterministico'); assert.equal(linha('t:to').origem, 'ia')
})
await ok('achado 12 — hash: inclui versão e CONTEÚDO de config/prompt-diagnostico.md; muda quando o prompt muda', async () => {
  await redigir({ ...base, escopo: 't:hash', chamar: async () => ({ texto: 'ROAS 4,27.', tokens: null }) })
  const prompt = readFileSync(`${ROOT}/config/prompt-diagnostico.md`, 'utf-8')
  const h = { versaoPrompt: PROMPT_VERSAO, prompt, instrucao: base.instrucao, base: JSON.stringify(base.fatos) }
  assert.equal(linha('t:hash').hash, hashRedigir(h), 'o hash gravado é o do prompt em disco')
  assert.notEqual(hashRedigir({ ...h, prompt: prompt + '\n10. Regra nova.' }), hashRedigir(h))
  assert.notEqual(hashRedigir({ ...h, versaoPrompt: 'v3' }), hashRedigir(h))
  assert.notEqual(hashRedigir({ ...h, instrucao: 'outra' }), hashRedigir(h))
})

console.log(`\nteste-ia-numeros: ${n} verificações ok`)
