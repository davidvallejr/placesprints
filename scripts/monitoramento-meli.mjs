// Monitoramento diário Mercado Livre (estrutura e regras da skill de monitoramento Amazon, lógica do ML).
//   node scripts/monitoramento-meli.mjs                      → todas as contas conectadas
//   node scripts/monitoramento-meli.mjs --conta "Damar Comercial" --conta "Rotec"
//   node scripts/monitoramento-meli.mjs --sem-ads --saida ~/Desktop/monitoramento-meli
// Só LEITURA. Gera 1 .md por conta (3 blocos) + o consolidado. Não envia e-mail nem mensagem a ninguém.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { hojeLocal } from '../src/lib/db.js'
import { monitorarConta, contasMeli } from '../src/lib/monitoramento-meli.js'
import { renderConta, renderConsolidado, nomeArquivo } from '../src/lib/monitoramento-render.js'

const a = process.argv.slice(2), val = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : '' }
const pedidas = a.flatMap((x, i) => x === '--conta' ? [a[i + 1]] : [])
const dia = val('--dia') || hojeLocal()
const saida = (val('--saida') || join(homedir(), 'Desktop', 'monitoramento-meli', dia)).replace(/^~/, homedir())
mkdirSync(saida, { recursive: true })
const todas = contasMeli()
const fila = pedidas.length ? pedidas.map(n => todas.find(c => c.cliente.toLowerCase() === n.toLowerCase()) || { cliente: n }) : todas
console.log(`Monitoramento ML ${dia} — ${fila.length} conta(s) → ${saida}`)
const res = []
for (const c of fila) {
  try {
    const r = await monitorarConta(c.cliente, { hoje: dia, comAds: !a.includes('--sem-ads') })
    writeFileSync(join(saida, nomeArquivo(r, dia)), renderConta(r))
    res.push(r)
    console.log(`  ${r.coletada ? '✔' : '✘'} ${c.cliente}${r.coletada ? ` — ${r.alertas.filter(x => x.nivel === 'Crítico').length} crítico(s), ${r.alertas.filter(x => x.nivel === 'Atenção').length} atenção, ${r.lacunas.length} lacuna(s)` : ` — ${r.motivo}`}`)
  } catch (e) { res.push({ cliente: c.cliente, coletada: false, motivo: e.message.slice(0, 120) }); console.log(`  ✘ ${c.cliente} — ${e.message.slice(0, 100)}`) }
}
writeFileSync(join(saida, `${dia}-consolidado.md`), renderConsolidado(res, dia))
console.log(`Consolidado: ${join(saida, `${dia}-consolidado.md`)}`)
