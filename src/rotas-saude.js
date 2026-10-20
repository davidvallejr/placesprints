// HTTP da Saúde da conta gravada (fase 1). Puro (só express): o núcleo entra por fábrica — o teste usa banco em memória e api stub.
//   GET  /api/cliente/saude?cliente=            → lerSaude(cliente): { cliente, dia, do_dia, coletado_em, reputacao, perguntas, reclamacoes, atrasos, pendente, fonte, textos, listas }
//   POST /api/cliente/saude/atualizar { cliente } → coletarSaude(cliente) agora (só leitura no ML) e devolve lerSaude
// Regras: corpo JSON (415); prospect "[Comercial] …" = 400 fixo; mensagens fixas, nunca ecoam valor recebido.
import { Router } from 'express'
import { coletarSaude, lerSaude } from './lib/saude-coleta.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

export function criarRotasSaude({ ler = lerSaude, coletar = coletarSaude } = {}) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('prospect do Comercial não é cliente: sem saúde da conta')
    return c
  }
  r.get('/api/cliente/saude', trata((req, res) => res.json(ler(cliente(um(req.query.cliente))))))
  r.post('/api/cliente/saude/atualizar', trata(async (req, res) => {
    const c = cliente(json(req).cliente)
    const r = await coletar(c)
    if (r.coletada === false) throw erro(r.motivo)
    res.json({ ...ler(c), coleta: r })
  }))
  return r
}
export const rotasSaude = criarRotasSaude()
