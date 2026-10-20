// Fiação REAL do livro de registro, do cliente em risco e do contrato/pagamentos: banco local, relógio, pasta data/ e quem pode registrar
// (líder/consultor da central + o CS responsável do cadastro DAQUELE cliente). A ingestão roda no fim de cada sync (sync.js) e no tick de 10 min do server.js
// (pega coleta, relatórios, planos, avisos e respostas recém-gravados). O autoteste usa as fábricas com banco em memória; este arquivo não roda nos testes.
import { join } from 'node:path'
import { db, agora, hojeLocal, log } from './db.js'
import { ROOT } from './env.js'
import { lideresEConsultores, carregarClientes, normNome, equipeCfg } from './equipe.js'
import { criarLivro } from './livro-registro.js'
import { criarRisco } from './risco-cliente.js'
import { criarContratos } from './contrato-cliente.js'

const RAIZ = join(ROOT, 'data')
export function quemDossie() {
  const cs = db.prepare("SELECT DISTINCT cs_responsavel FROM clientes_central WHERE cs_responsavel <> ''").all()
    .flatMap(r => r.cs_responsavel.split('/').map(x => x.trim())).filter(Boolean)   // CS de vários canais vem unido por " / " (cadastro-clientes.js)
  return [...new Set([...lideresEConsultores(), ...cs])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
// quem pode gerar/marcar/registrar para ESTE cliente: líder ou consultor (qualquer cliente) ou o CS do cadastro DESTE cliente (cs_responsavel, vários unidos por " / ")
export const validarDossie = (nome, cliente) => {
  const n = normNome(nome).trim()
  if (!n) return ''
  const lc = lideresEConsultores().find(x => normNome(x).trim() === n)
  if (lc || !cliente) return lc || ''
  const cs = db.prepare('SELECT cs_responsavel FROM clientes_central WHERE cliente = ?').get(cliente)?.cs_responsavel || ''
  return cs.split('/').map(x => x.trim()).find(x => x && normNome(x).trim() === n) || ''
}
const excluidos = () => new Set((equipeCfg.status_cliente_excluidos || []).map(normNome))
export const clientesAtivos = () => { const ex = excluidos(); return carregarClientes().filter(c => !ex.has(normNome(c.status))).map(c => c.cliente) }

let livro = null, risco = null, contratos = null
export const livroReal = () => livro ||= criarLivro({ handle: db, agora, raiz: RAIZ })
export const riscoReal = () => risco ||= criarRisco({ handle: db, livro: livroReal(), hoje: hojeLocal, agora, validarPor: validarDossie, clientes: clientesAtivos })
export const contratosReal = () => contratos ||= criarContratos({ handle: db, livro: livroReal(), raiz: RAIZ, agora, hoje: hojeLocal, validarPor: validarDossie })

// varredura incremental (nunca derruba quem chamou). teto_arquivos: prints com sha256 por passada (o backfill dos ~57 mil anexos se completa em várias passadas)
export async function ingerirLivro({ origem = 'tick', teto_arquivos = 500 } = {}) {
  try {
    const r = await livroReal().ingerir({ teto_arquivos })
    if (r.total || r.anexos_pendentes) log('info', `livro de registro (${origem}): ${r.total} fato(s) novo(s)${r.anexos_pendentes ? `, ${r.anexos_pendentes} anexo(s) para as próximas passadas` : ''}`)
    return r
  } catch (e) { log('erro', `livro de registro (${origem}): ${String(e?.message ?? e).slice(0, 160)}`); return null }
}
