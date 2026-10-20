// Mundo de teste das pendências do cliente: núcleo REAL (src/lib/pendencias-cliente.js) sobre banco :memory: e dependências STUB (tarefas, estoque do ML, conta, previsões).
// Nada de Notion, Mercado Livre ou data/db.sqlite. Usado por teste-pendencias-cliente.mjs e teste-pendencias-rotas.mjs.
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { criarPendencias, SCHEMA_PENDENCIAS, validarCatalogo } from '../../src/lib/pendencias-cliente.js'
import { faixaDe } from '../../src/lib/dependencia-cliente.js'
import { auditarTexto } from '../../src/lib/relatorio-seguro.js'

export const HOJE = '2026-10-08', AGORA = '2026-10-08T12:00:00.000Z', QUEM = ['Giovanna Torres', 'Carla Souza']
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
export const catalogoReal = () => validarCatalogo(JSON.parse(readFileSync(new URL('../../config/dependencias-cliente.json', import.meta.url), 'utf8')), { auditar: auditarTexto })
export const dia = k => { const d = new Date(HOJE + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10) }
let seq = 0
// tarefa em dependência como o listar() de dependencia-cliente devolve (dias/faixa derivados de `dias`)
export const tarefa = (o = {}) => {
  const dias = o.dias ?? 18
  return { id: 'T' + (++seq), titulo: 'Tarefa ' + seq, url: 'https://exemplo.test/t' + seq, cliente: 'Acme', processo: 'Shopee', tipo: '', tipo_rotulo: '', detalhe: '', desde: dia(-dias), desde_origem: 'registro', faixa: faixaDe(dias), ...o, dias }
}
export const itemMl = (o = {}) => ({ id: 'MLB' + (++seq), titulo: 'Produto ' + seq, curva: 'A', status: 'active', estoque: 3, cobertura: 3, u: 28, r: 2800, fotos: 8, catalogo: 0, custo_unitario: 5, atualizado_em: '2026-10-08T06:00:00.000Z', ...o })
export const baseMl = (itens, o = {}) => ({ itens, atualizado_em: '2026-10-08T06:00:00.000Z', janela_dias: 28, lead_time_dias: 21, fotos_minimas: 5, custos_conta_informados: true, ...o })

export function montar({ tarefas = [], base = null, conta = null, previsoes = {}, editavelConteudo, catalogo = catalogoReal(), invisiveis = [], saude = null, alinhado = null, idAcao = null } = {}) {
  const handle = new Database(':memory:'); handle.exec(SCHEMA_PENDENCIAS)
  const estado = { tarefas, base, conta, previsoes, hoje: HOJE, agora: AGORA, lidos: [] }
  const p = criarPendencias({
    handle, catalogo, auditar: auditarTexto, hoje: () => estado.hoje, agora: () => estado.agora,
    dependencias: { listar: ({ cliente }) => estado.tarefas.filter(t => t.cliente === cliente) },
    riscoEstoque: cliente => { estado.lidos.push(cliente); return cliente === 'Acme' ? estado.base : null },
    contasMl: cliente => cliente === 'Acme' ? estado.conta : null,
    visiveis: (cliente, ids) => new Set(ids.map(String).filter(id => !invisiveis.includes(id))),      // tarefa fora de `invisiveis` tem visivel_cliente = 1
    acoesPlano: (cliente, ids) => new Map(ids.filter(id => id in estado.previsoes).map(id => [id, estado.previsoes[id]])),
    validarPor: nome => QUEM.find(q => norm(q) === norm(nome)) || '',
    ...(editavelConteudo ? { editavelConteudo } : {}),
    ...(saude ? { saude: cliente => cliente === 'Acme' ? saude : null } : {}),      // v1.5.0: leitura de saúde da conta (lerSaude) sintética, só para 'Acme'
    ...(alinhado ? { alinhado, idAcao } : {}),                                       // alinhamentos com o cliente: predicado do núcleo (o teste passa o real sobre este handle)
  })
  return { p, handle, estado }
}
