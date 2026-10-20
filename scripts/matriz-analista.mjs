// Matriz Eisenhower de um analista — uso interno da liderança.
// Uso: node scripts/matriz-analista.mjs --responsavel "Kenia Jubileu" [--de 2026-09-01 --ate 2026-09-30] [--sem-pdf]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from '../src/lib/env.js'
import { workloadAnalista } from '../src/lib/analista.js'
import { renderMatrizAnalista } from '../src/lib/render-matriz-analista.js'

const arg = nome => { const i = process.argv.indexOf('--' + nome); return i > -1 ? process.argv[i + 1] : '' }
const responsavel = arg('responsavel')
if (!responsavel) { console.error('Informe --responsavel "Nome exato como aparece no Notion"'); process.exit(1) }

const dados = workloadAnalista(responsavel, { de: arg('de'), ate: arg('ate') })
if (!dados.total_geral) {
  console.error(`Nenhuma tarefa encontrada para "${responsavel}". Rode "node scripts/sync.mjs --completo" primeiro, ou confira o nome exato em /api/opcoes.`)
  process.exit(1)
}

const html = renderMatrizAnalista(dados)
const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const dir = join(ROOT, 'data', 'relatorios')
mkdirSync(dir, { recursive: true })
const nome = `matriz-${slug(responsavel)}-${dados.gerado_em}`
const htmlPath = join(dir, nome + '.html')
writeFileSync(htmlPath, html)
console.log('✔ HTML:', htmlPath)

console.log(`\n${responsavel} — ${dados.total_aberto} tarefa(s) em aberto de ${dados.clientes_distintos || dados.diagnostico.clientes_distintos} cliente(s)`)
console.log(`  Fazer: ${dados.resumo.fazer.n} (${dados.resumo.fazer.minutos}min) · Agendar: ${dados.resumo.agendar.n} (${dados.resumo.agendar.minutos}min) · Delegar: ${dados.resumo.delegar.n} · Eliminar: ${dados.resumo.eliminar.n}`)
console.log(`  ${dados.diagnostico.pct_sem_prazo}% sem prazo · ${dados.diagnostico.pct_backlog_top3_clientes}% do backlog em 3 clientes · idade média ${dados.diagnostico.idade_media_dias ?? '—'} dia(s)`)

if (!process.argv.includes('--sem-pdf')) {
  const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(CHROME)) {
    const pdfPath = join(dir, nome + '.pdf')
    execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
      '--virtual-time-budget=9000', `--print-to-pdf=${pdfPath}`, 'file://' + htmlPath], { stdio: 'pipe', timeout: 60000 })
    console.log('✔ PDF:', pdfPath)
  } else {
    console.log('⚠ Chrome não encontrado — abra o HTML e use Imprimir → Salvar como PDF.')
  }
}
