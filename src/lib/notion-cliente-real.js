// Instância única do Notion do cliente sobre o banco e o Notion reais (server.js, sync.js e scripts/notion-cliente.mjs usam a mesma).
import { db, agora, getEstado, setEstado, log } from './db.js'
import { notionReq } from './notion.js'
import { descobrirFontes, clientesAtivos } from './descobrir.js'
import { resolverPaginaCliente } from './plano-informacoes.js'
import { carregarClientes, normNome, validarLiderOuConsultor } from './equipe.js'
import { criarNotionCliente } from './notion-cliente.js'

const TTL_MS = 10 * 60_000
let memo = null
// fontes dos quadros + clientes da central SEM quadro (também têm página): a leitura do Notion do cliente não depende de ter «Tarefas - X»
async function fontes() {
  if (memo && Date.now() - memo.em < TTL_MS) return memo.lista
  const [f, ativos] = await Promise.all([descobrirFontes(), clientesAtivos()])
  const lista = f.slice()
  for (const c of ativos) if (!lista.some(x => x.cliente === c.nome)) lista.push({ dbId: '', modo: null, cliente: c.nome, projeto: '', paginaClienteId: c.paginaClienteId })
  memo = { em: Date.now(), lista }
  return lista
}

export const notionCliente = criarNotionCliente({
  handle: db, notion: { req: notionReq }, fontes, resolverPaginaCliente,
  estado: { get: getEstado, set: setEstado },
  clienteCanonico: nome => carregarClientes().find(c => normNome(c.cliente).trim() === normNome(nome).trim())?.cliente || '',
  validarPor: validarLiderOuConsultor, agora, log,
})
