// Prévia do «Plano para manter/retomar o ritmo de vendas» (tom aprovado pelo David em 12/10/2026) com dados reais — SÓ LEITURA, nada é gravado nem enviado.
// O texto é o MESMO do lote 'semanal' dos gatilhos: montarPlanoSemanal (src/lib/plano-semana-texto.js) alimentado por dadosPlanoSemana (src/lib/gatilhos-real.js).
// Uso: node scripts/previa-plano-semana.mjs "<cliente>" "<rótulo>" [--previa]   (sem os pontos que dependem da fila de gatilhos: preço, perguntas, retornos)
const { dadosPlanoSemana } = await import('../src/lib/gatilhos-real.js')
const { montarPlanoSemanal } = await import('../src/lib/plano-semana-texto.js')
const { algoritmo } = await import('../src/lib/diagnostico-conta.js')
const { hojeLocal } = await import('../src/lib/db.js')
const C = process.argv[2] || 'Uniaodog Artigos Pet', ROT = process.argv[3] || 'União Dog'
const d = dadosPlanoSemana(C)
if (!d.disponivel) { process.stdout.write(JSON.stringify({ texto: '', motivo: d.motivo })); process.exit(0) }
const p = montarPlanoSemanal({ rotulo: ROT, hoje: hojeLocal(), resumo: d.resumo, itens: d.itens, fullParado: d.fullParado, entregas: d.entregas, custosInformados: d.custosInformados, limiares: { ...algoritmo.limiares, min_unidades_item: algoritmo.foco.min_unidades_item }, previa: process.argv.includes('--previa') })
process.stdout.write(JSON.stringify({ texto: p.texto, n_acoes: p.n_acoes, blocos: p.blocos, chars: p.texto.length }))
