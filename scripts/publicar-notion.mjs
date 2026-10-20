// Rotina semanal completa: sync → relatório semanal por cliente (PDF premium) →
// publica no Notion (barra de progresso na página + linha no quadro com o PDF).
// Uso: node scripts/publicar-notion.mjs [--todos | --cliente "X"] [--sem-sync] [--sem-notion]
// É esta rotina que o agendamento semanal executa (ver automacao/).
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT, env } from '../src/lib/env.js'
import { log } from '../src/lib/db.js'
import { sincronizar } from '../src/lib/sync.js'
import { montarSemanal } from '../src/lib/semanal.js'
import { renderSemanal } from '../src/lib/render-semanal.js'
import { planoDoMes } from '../src/lib/metricas.js'
import { hojeLocal } from '../src/lib/db.js'
import { listarClientesCentral, atualizarBarraProgresso, subirPdf, criarLinhaRelatorio, garantirBotaoMeli } from '../src/lib/notion-publicar.js'
import { sincronizarPlanos, resolverPaginaCliente } from '../src/lib/plano-informacoes.js'

const arg = nome => { const i = process.argv.indexOf('--' + nome); return i > -1 ? process.argv[i + 1] : '' }
const slug = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const dir = join(ROOT, 'data', 'relatorios')
mkdirSync(dir, { recursive: true })

if (!env.NOTION_TOKEN) { console.error('NOTION_TOKEN ausente — configure o .env antes de publicar no Notion.'); process.exit(1) }

// 1. sincroniza (incremental) para publicar sempre sobre dados frescos
if (!process.argv.includes('--sem-sync')) await sincronizar()

// 2. clientes-alvo
const filtro = arg('cliente')
const alvos = await listarClientesCentral({ filtroCliente: filtro })
if (!alvos.length) { console.error(filtro ? `Cliente "${filtro}" não encontrado/ativo na central.` : 'Nenhum cliente ativo na central.'); process.exit(1) }

const anoMes = hojeLocal().slice(0, 7)
let publicados = 0, pendentes = 0

for (const c of alvos) {
  try {
    // 3. página real do cliente + plano oficial do mês (base Informações)
    const paginaReal = await resolverPaginaCliente({ cliente: c.nome, paginaClienteId: c.paginaClienteId, tarefasDbId: c.tarefasDbId, tarefasModo: c.tarefasModo })
    await sincronizarPlanos({ cliente: c.nome, paginaClienteId: c.paginaClienteId, tarefasDbId: c.tarefasDbId, tarefasModo: c.tarefasModo, meses: [anoMes] }).catch(() => {})
    // o que vai ao cliente é SEMPRE a versão do cliente (sem checklist de coleta); o perfil vem do cadastro do cliente
    const semanal = await montarSemanal({ cliente: c.nome, interno: false })
    const html = renderSemanal(semanal, { inline: true, interno: false })
    const nome = `semanal-${slug(c.nome)}-${semanal.identificacao.de}`
    const htmlPath = join(dir, nome + '.html')
    writeFileSync(htmlPath, html)
    let pdfPath = ''
    if (existsSync(CHROME)) {
      pdfPath = join(dir, nome + '.pdf')
      execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
        '--virtual-time-budget=9000', `--print-to-pdf=${pdfPath}`, 'file://' + htmlPath], { stdio: 'pipe', timeout: 60000 })
    }

    const resultado = {}
    if (!process.argv.includes('--sem-notion')) {
      // 4. barra de progresso do plano do mês na página real do cliente
      const plano = planoDoMes({ cliente: c.nome, anoMes })
      if (paginaReal && plano) {
        const r = await atualizarBarraProgresso(c.nome, paginaReal, plano)
        resultado.barra = r.acao || r.motivo
      }
      // botão de conexão com o Mercado Livre (ou selo de já conectado)
      if (paginaReal) {
        const rMeli = await garantirBotaoMeli(c.nome, paginaReal)
        resultado.meli = rMeli.acao || rMeli.motivo
      }
      // 5. linha no quadro com o PDF anexado
      if (c.tarefasDbId && pdfPath) {
        const uploadId = await subirPdf(pdfPath)
        const linha = await criarLinhaRelatorio({ tarefasDbId: c.tarefasDbId, tarefasModo: c.tarefasModo, semanal, fileUploadId: uploadId })
        resultado.linha = linha.url
      }
    }

    // log INTERNO de prontidão: mostra à equipe o que falta coletar (não aparece no PDF nem na linha do Notion)
    const selo = semanal.pronto ? '✅ pronto' : `⚠ checklist incompleto: ${semanal.prontidao.filter(i => i.estado === 'faltando').map(i => i.nome).join('; ')}`
    console.log(`${c.nome} → ${selo}`)
    if (resultado.barra) console.log(`  barra de progresso: ${resultado.barra}`)
    if (resultado.linha) console.log(`  linha no quadro: ${resultado.linha}`)
    if (resultado.meli) console.log(`  botão Mercado Livre: ${resultado.meli}`)
    if (!semanal.pronto) pendentes++
    publicados++
  } catch (e) {
    log('erro', `publicação ${c.nome}: ${e.message}`)
    console.error(`✕ ${c.nome}: ${e.message}`)
  }
}

console.log(`\n${publicados} cliente(s) processado(s)${pendentes ? ` · ${pendentes} com checklist incompleto` : ''}.`)
