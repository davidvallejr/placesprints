// Relatório Semanal Place2u — individual por cliente.
// Uso:
//   node scripts/semanal.mjs --cliente "X" [--de 2026-09-01 --ate 2026-09-07]
//   node scripts/semanal.mjs --todos            # um relatório por cliente
//   flags: --sem-pdf
//          --perfil id[,id]  perfil(is) só nesta geração (ex.: direto,tecnico); sem a flag vale o perfil salvo do cliente
//          --interno         versão da EQUIPE: inclui tarefas não visíveis ao cliente, o checklist de coleta e a prontidão
//   Sem --interno o arquivo é o do CLIENTE (sem checklist).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from '../src/lib/env.js'
import { db } from '../src/lib/db.js'
import { montarSemanal } from '../src/lib/semanal.js'
import { renderSemanal } from '../src/lib/render-semanal.js'
import { listarPerfis } from '../src/lib/perfil-cliente.js'
import { idsPerfil } from '../src/rotas-perfil.js'

const arg = nome => { const i = process.argv.indexOf('--' + nome); return i > -1 ? process.argv[i + 1] : '' }
const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dir = join(ROOT, 'data', 'relatorios')
mkdirSync(dir, { recursive: true })

const clientes = process.argv.includes('--todos')
  ? db.prepare("SELECT DISTINCT cliente FROM tarefas WHERE arquivada = 0 AND cliente != '' ORDER BY cliente").all().map(r => r.cliente)
  : [arg('cliente')].filter(Boolean)

if (!clientes.length) { console.error('Informe --cliente "Nome" ou --todos'); process.exit(1) }

const interno = process.argv.includes('--interno')
const validos = listarPerfis().map(p => p.id)
const { ids: perfil, invalidos } = idsPerfil(arg('perfil'), validos)
if (invalidos.length) { console.error(`--perfil desconhecido: ${invalidos.join(', ')} (válidos: ${validos.join(', ')})`); process.exit(1) }

let faltando = 0
for (const cliente of clientes) {
  const dados = await montarSemanal({ cliente, de: arg('de'), ate: arg('ate'), interno, perfil: perfil.length ? perfil : undefined })
  const html = renderSemanal(dados, { inline: true, interno })
  // sufixos evitam que a versão interna ou um perfil avulso sobrescreva o arquivo do cliente
  const nome = `semanal-${slug(cliente)}-${dados.identificacao.de}${perfil.length ? '-' + slug(perfil.join('-')) : ''}${interno ? '-interno' : ''}`
  const htmlPath = join(dir, nome + '.html')
  writeFileSync(htmlPath, html)

  const pendentes = dados.prontidao.filter(i => i.estado === 'faltando')
  const selo = dados.pronto ? '✅ pronto para envio' : `❌ FALTANDO: ${pendentes.map(i => i.nome).join('; ')}`
  console.log(`${cliente} → ${htmlPath}\n  ${selo}`)
  if (!dados.pronto) faltando++

  if (!process.argv.includes('--sem-pdf') && existsSync(CHROME)) {
    const pdfPath = join(dir, nome + '.pdf')
    execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
      '--virtual-time-budget=9000', `--print-to-pdf=${pdfPath}`, 'file://' + htmlPath], { stdio: 'pipe', timeout: 60000 })
    console.log(`  PDF: ${pdfPath}`)
  }
}
if (faltando) console.log(`\n⚠ ${faltando} relatório(s) com itens faltando — complete a coleta antes de enviar.`)
