// Publica (ou atualiza) o botão "Conectar Mercado Livre" na página de cada
// cliente — rápido, sem gerar PDF nem tocar no relatório semanal. Rode isto
// quando quiser lançar a integração para os clientes AGORA, sem esperar a
// rotina de sexta-feira.
//
// Uso:
//   node scripts/meli-botoes.mjs --todos
//   node scripts/meli-botoes.mjs --cliente "Damar"
import { env } from '../src/lib/env.js'
import { listarClientesCentral, garantirBotaoMeli } from '../src/lib/notion-publicar.js'
import { resolverPaginaCliente } from '../src/lib/plano-informacoes.js'

if (!env.NOTION_TOKEN) { console.error('NOTION_TOKEN ausente — configure o .env.'); process.exit(1) }
if (!env.MELI_CLIENT_ID || !env.PUBLIC_BASE_URL) {
  console.error('Configure MELI_CLIENT_ID/MELI_CLIENT_SECRET/PUBLIC_BASE_URL no .env antes de publicar os botões (veja README, seção "Integração Mercado Livre").')
  process.exit(1)
}

const arg = nome => { const i = process.argv.indexOf('--' + nome); return i > -1 ? process.argv[i + 1] : '' }
const filtro = arg('cliente')
const alvos = await listarClientesCentral({ filtroCliente: filtro })
if (!alvos.length) { console.error(filtro ? `Cliente "${filtro}" não encontrado/ativo.` : 'Nenhum cliente ativo encontrado.'); process.exit(1) }

let ok = 0, falhas = 0
for (const c of alvos) {
  try {
    const pagina = await resolverPaginaCliente({ cliente: c.nome, paginaClienteId: c.paginaClienteId, tarefasDbId: c.tarefasDbId, tarefasModo: c.tarefasModo })
    if (!pagina) { console.log(`✕ ${c.nome}: página do cliente não resolvida`); falhas++; continue }
    const r = await garantirBotaoMeli(c.nome, pagina)
    console.log(`${r.ok ? '✔' : '✕'} ${c.nome}: ${r.acao || r.motivo}`)
    r.ok ? ok++ : falhas++
  } catch (e) {
    console.log(`✕ ${c.nome}: ${e.message}`)
    falhas++
  }
}
console.log(`\n${ok} botão(ões) publicado(s)${falhas ? ` · ${falhas} falha(s)` : ''}.`)
