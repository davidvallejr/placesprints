// Exporta o relatório como HTML standalone (evidências embutidas em base64,
// pronto para enviar ao cliente) e PDF via Chrome headless.
// Uso: node scripts/exportar.mjs --cliente "X" --sprint "Sprint 2026-09" [--projeto "Y"] [--sem-pdf]
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from '../src/lib/env.js'
import { montarRelatorio } from '../src/lib/relatorio.js'
import { renderRelatorio } from '../src/lib/render-relatorio.js'

const arg = nome => {
  const i = process.argv.indexOf('--' + nome)
  return i > -1 ? process.argv[i + 1] : ''
}
const filtros = { cliente: arg('cliente'), projeto: arg('projeto'), sprint: arg('sprint') }

const dados = await montarRelatorio(filtros)
const html = renderRelatorio(dados, { inline: true })

const slug = s => (s || 'geral').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const hojeLocal = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) })()
const nome = `relatorio-${slug(filtros.cliente)}-${slug(filtros.sprint)}-${hojeLocal}`
const dir = join(ROOT, 'data', 'relatorios')
mkdirSync(dir, { recursive: true })

const htmlPath = join(dir, nome + '.html')
writeFileSync(htmlPath, html)
console.log('✔ HTML standalone:', htmlPath)

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
