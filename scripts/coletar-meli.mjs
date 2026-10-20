// Coleta a série diária (pedidos + visitas por anúncio) do Mercado Livre dos clientes conectados.
//   node scripts/coletar-meli.mjs                     → todos os conectados
//   node scripts/coletar-meli.mjs --cliente "Nome"    → um cliente
import { coletarCliente } from '../src/lib/meli-serie.js'
import { listarConexoes } from '../src/lib/meli-contas.js'
const i = process.argv.indexOf('--cliente')
const alvos = i >= 0 ? [process.argv[i + 1]] : listarConexoes().filter(c => !c.erro).map(c => c.cliente)
for (const c of alvos) {
  const t0 = Date.now()
  try {
    const r = await coletarCliente(c, { aoProgredir: p => process.stdout.write(`\r  ${c}: ${p.fase} ${p.feitos}/${p.total}`.padEnd(70)) })
    console.log(`\n✔ ${c}: ${r.itens} anúncios · ${r.dias_pedidos} dia(s) de pedidos · ${r.itens_com_visitas} com visitas (${r.citados_em_tarefas} citados em tarefas) · ${Math.round((Date.now() - t0) / 1000)}s`)
  } catch (e) { console.log(`\n✖ ${c}: ${e.message}`) }
}
