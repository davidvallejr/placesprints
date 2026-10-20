// HTTP da COBERTURA de execução do plano (Chaveiro, F1): qual caminho cada ação do plano tem hoje. Só leitura; nada é executado por aqui.
//   GET /api/cliente/execucao?cliente=  → { cliente, cobertura, acoes:[{ id, titulo, regra, status, prazo, caminho, adaptador, operacao, motivo, pendencias }] }
// Ações antigas (sem dados.execucao) saem com caminho 'sem_caminho' — a cobertura as conta assim também. Prospect "[Comercial] …" nunca é cliente (400 fixo).
import { Router } from 'express'
import { lerAcoes } from './lib/plano-cliente.js'
import { cobertura, CFG } from './lib/chaveiro.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const STATUS = ['proposta', 'aprovada', 'distribuida']

export function criarRotasChaveiro({ ler = lerAcoes, cobrir = cobertura } = {}) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  r.get('/api/cliente/execucao', trata((req, res) => {
    const cliente = um(req.query.cliente)
    if (!cliente) throw erro('informe "cliente"')
    if (ehProspecto(cliente)) throw erro('prospect do Comercial não é cliente: sem execução do plano')
    const acoes = ler({ clientes: [cliente], status: STATUS })          // isolamento: só as ações deste cliente
    res.json({ cliente, cobertura: cobrir(acoes), acoes: acoes.map(a => { const x = a.dados?.execucao || {}; return {
      id: a.id, titulo: a.titulo, regra: a.regra, status: a.status, prazo: a.prazo,
      caminho: x.caminho || 'sem_caminho', adaptador: x.adaptador || null, operacao: x.operacao || null, motivo: x.motivo || (/^anuncio_/.test(a.regra) ? CFG.motivos.sem_execucao : CFG.motivos.regra_operacional), pendencias: Array.isArray(x.pendencias) ? x.pendencias : [] } }) })
  }))
  return r
}
export const rotasChaveiro = criarRotasChaveiro()
