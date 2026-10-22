// HTTP da fila do dia — «Hoje» (F5, 21/10/2026; docs/ux/arquitetura-5-menus.md § B). Loopback (guarda-local). SÓ LEITURA: nenhuma rota de escrita nasce aqui —
// cada item da fila aponta para a rota de escrita que já existe (/api/planos/acoes/status, /api/planos/distribuir, /api/chaveiro/exec/aprovar|vetar,
// /api/cliente/preco/decisao, /api/cliente/do-cliente/lembrete, /api/gatilhos/preparar-lote, /api/integracoes/meli/link, /api/meli/restaurar).
//   GET /api/fila?por=<papel>&quem=<nome>&etapa=<1..10>  → montarFila (papel fora da lista = líder; etapa fora de 1..10 = sem filtro)
import { Router } from 'express'
import { PAPEIS } from './lib/fila.js'

const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])

// deps: fila = criarFilaReal(...) → { montar({ por, quem, etapa }) }
export function criarRotasFila({ fila }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  r.get('/api/fila', trata((req, res) => {
    const por = um(req.query.por).toLowerCase(), etapa = Number(um(req.query.etapa))
    res.set('Cache-Control', 'no-store').json(fila.montar({ por: PAPEIS.includes(por) ? por : 'lider', quem: um(req.query.quem).slice(0, 80), etapa: Number.isInteger(etapa) && etapa >= 1 && etapa <= 10 ? etapa : null }))
  }))
  return r
}
