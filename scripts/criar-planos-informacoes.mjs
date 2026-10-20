// Cria a base "Informações" (schema clonado de um cliente que já tem, com
// status→select por limitação da API do Notion) nos clientes ativos que
// ainda não têm essa base — pré-requisito pro Plano de Ação aparecer.
// Uso: node scripts/criar-planos-informacoes.mjs --cliente "01Smart"   (teste 1)
//      node scripts/criar-planos-informacoes.mjs --todos               (os 37)
import { env } from '../src/lib/env.js'
import { lerBlocos, notionGet } from '../src/lib/notion.js'
import { descobrirFontes } from '../src/lib/descobrir.js'
import { resolverPaginaCliente, invalidarCliente } from '../src/lib/plano-informacoes.js'

const SCHEMA = {
  'Lista': { title: {} },
  'Status': { select: { options: [
    { name: 'Concluído', color: 'green' }, { name: 'Em Andamento', color: 'blue' }, { name: 'Pendente', color: 'orange' },
  ] } },
  'Secção': { select: { options: [
    { name: 'Marketplaces Ativos', color: 'gray' }, { name: 'Onboard', color: 'green' },
    { name: 'Plano de Ação', color: 'red' }, { name: 'Alinhamentos', color: 'yellow' },
  ] } },
  'Status 1': { select: { options: [
    { name: 'Plano de acao padrao', color: 'pink' }, { name: 'Reuniões', color: 'blue' },
    { name: 'Ferramentas', color: 'purple' }, { name: 'Planejamento', color: 'red' }, { name: 'Videos', color: 'blue' },
  ] } },
  'Link': { url: {} },
}

async function api(caminho, body) {
  const r = await fetch(`https://api.notion.com/v1/${caminho}`, {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': env.NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(`Notion ${r.status}: ${d.message || JSON.stringify(d).slice(0, 200)}`)
  return d
}

async function jaTemInformacoes(paginaId) {
  const blocos = await lerBlocos(paginaId, 0)
  return blocos.some(b => b.type === 'child_database' && /informa/i.test(b.child_database?.title || ''))
}

async function criarPara(cliente) {
  const [f] = await descobrirFontes({ filtroCliente: cliente })
  if (!f) return { ok: false, motivo: 'não encontrado/ativo na central' }
  const pagina = await resolverPaginaCliente({ cliente: f.cliente, paginaClienteId: f.paginaClienteId, tarefasDbId: f.dbId, tarefasModo: f.modo })
  if (!pagina) return { ok: false, motivo: 'página real do cliente não resolvida' }
  if (await jaTemInformacoes(pagina)) return { ok: true, acao: 'já existia — nada a fazer' }
  const criado = await api('databases', {
    parent: { type: 'page_id', page_id: pagina },
    title: [{ type: 'text', text: { content: 'Informações' } }],
    initial_data_source: { properties: SCHEMA },
  })
  invalidarCliente('', pagina)                       // zera o cache de "sem Informações" (info_vazio, 6 h no relatório em lote): a base acabou de nascer
  return { ok: true, acao: 'criada', url: criado.url }
}

const arg = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : '' }
const CLIENTES_SEM_PLANO = [
  '01Smart', 'Abdul Imports', 'Amavi Brasil', 'Brás Estampas', 'Cryart Papelaria Premium LTDA', 'Daflon',
  'Dama da Noite Lingerie', 'Droga Lima', 'Dualyn', 'D’Calice', 'Elevare Cosméticos', 'Eleven Brindes',
  'Emporio Neves', 'FENPASTORE', 'H1 Editora', 'Hyper Variedades', 'Infopatos', 'JT Ferramentas',
  'JV Iluminação', 'Kairos', 'Laloui Cosmetics', 'Lellis Rocha', 'Lúcio Emílio Cosmo Morilla Caetano',
  'Mania de Vender Barato', 'Marlene Decore', 'Ouro Cão Pet Shop', 'Ouropack', 'Papelaria Couto',
  'Papelaria Pavani', 'Pavio Decor', 'Reino Natural', 'Rudi Servicos e Comercio', 'Setefarma',
  'Space Print', 'Thermic', 'VM Comercial', 'Áurea Cosméticos',
]

const alvos = arg('cliente') ? [arg('cliente')] : process.argv.includes('--todos') ? CLIENTES_SEM_PLANO : []
if (!alvos.length) { console.error('Uso: --cliente "Nome" (teste) ou --todos (os 37)'); process.exit(1) }

let ok = 0, falhas = 0
for (const c of alvos) {
  try {
    const r = await criarPara(c)
    console.log(`${r.ok ? '✔' : '✕'} ${c}: ${r.acao || r.motivo}${r.url ? ' — ' + r.url : ''}`)
    r.ok ? ok++ : falhas++
  } catch (e) { console.log(`✕ ${c}: ${e.message}`); falhas++ }
}
console.log(`\n${ok} ok, ${falhas} falha(s) de ${alvos.length}`)
