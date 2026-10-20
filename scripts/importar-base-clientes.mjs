// Importa a planilha do CS (Base Clientes.xlsx) para o cadastro da central. Prévia por padrão; --aplicar grava.
//   node scripts/importar-base-clientes.mjs ~/Desktop/Base\ Clientes.xlsx            → prévia (nada gravado)
//   node scripts/importar-base-clientes.mjs ~/Desktop/Base\ Clientes.xlsx --aplicar  → grava e guarda as pendências
// Nunca cria cliente: quem não casa (ou casa com mais de um) sai na lista de pendências — ajuste config/clientes-aliases.json e rode de novo.
import { importarPlanilha } from '../src/lib/cadastro-clientes.js'

const args = process.argv.slice(2)
const aplicar = args.includes('--aplicar')
const caminho = args.find(a => !a.startsWith('--'))
if (!caminho) { console.error('uso: node scripts/importar-base-clientes.mjs <planilha.xlsx> [--aplicar]'); process.exit(2) }

const r = importarPlanilha(caminho, { confirmar: aplicar })
const fmt = v => v == null || v === '' ? '—' : Array.isArray(v) ? v.map(c => c.canal || c).join(', ') : String(v)
console.log(`${aplicar ? 'APLICADO' : 'PRÉVIA'} · fonte "${r.fonte}" · ${r.total} nomes na planilha · ${r.casados} casados (${r.mudam} com mudança) · ${r.pendencias} pendências\n`)
for (const x of r.itens) {
  const m = Object.entries(x.mudancas)
  console.log(`${m.length ? '*' : ' '} ${x.nome}  →  ${x.cliente}  [${x.via}]`)
  for (const [k, { de, para }] of m) console.log(`      ${k}: ${fmt(de)} → ${fmt(para)}`)
}
if (r.lista_pendencias.length) {
  console.log('\nPendências (não gravadas):')
  for (const p of r.lista_pendencias) console.log(`  - ${p.nome} · ${p.motivo}${p.candidatos.length ? ' · candidatos: ' + p.candidatos.join(' | ') : ''}${p.canais.length ? ' · canais: ' + p.canais.join(', ') : ''}`)
}
