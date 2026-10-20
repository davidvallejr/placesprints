// CLI: node scripts/notion-cliente.mjs [--completo] [--cliente "Nome"] [--so-descoberta]
// Lê o Notion de todos os clientes da central (página, filhos, base Informações) para o banco real — só leitura no Notion.
// --so-descoberta: só roda a descoberta das fontes (quadros «Tarefas» pela página do cliente) e relata, sem ler Informações.
import { db } from '../src/lib/db.js'
import { descobrirFontes } from '../src/lib/descobrir.js'
import { notionCliente } from '../src/lib/notion-cliente-real.js'

const arg = k => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : undefined }
const completo = process.argv.includes('--completo'), filtro = arg('--cliente')

if (process.argv.includes('--so-descoberta')) {
  const f = await descobrirFontes()
  const desc = db.prepare("SELECT chave, valor FROM sync_estado WHERE chave LIKE 'fonte_descoberta:%'").all()
  console.log(`\n${f.length} fonte(s); ${desc.length} achada(s) pela página do cliente:`)
  for (const d of desc) { const j = JSON.parse(d.valor); console.log(`  - ${d.chave.slice(17)} → «${j.titulo}»`) }
  process.exit(0)
}

const clientes = db.prepare('SELECT cliente FROM clientes_central ORDER BY cliente').all().map(r => r.cliente).filter(c => !/^\s*\[Comercial\]/i.test(c) && (!filtro || c.toLowerCase().includes(filtro.toLowerCase())))
const itens = []
for (const c of clientes) { const r = await notionCliente.lerCliente(c, { completo }); itens.push(r); console.log(`${r.estado.padEnd(16)} ${c}${r.linhas != null ? ` · ${r.linhas} linha(s), ${r.filhos} filho(s)` : ''}${r.erro ? ` · ${r.erro}` : ''}`) }
const por = e => itens.filter(i => i.estado === e)
console.log(`\n${itens.length} cliente(s): ${por('ok').length} com Informações, ${por('sem_informacoes').length} com página sem a base, ${por('sem_pagina').length} sem página, ${por('pagina_invalida').length} página inválida, ${por('erro').length} com erro`)
if (por('erro').length) console.log('Erros: ' + por('erro').map(i => `${i.cliente} (${i.erro})`).join(' · '))
