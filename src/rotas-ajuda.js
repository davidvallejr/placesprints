// GET /api/ajuda/:id?cliente= — texto do ícone (i) «Como fazer» (docs/ux/arquitetura-5-menus.md § C; F2, 21/10/2026).
// Fonte: config/ajuda.json (lido uma vez). Devolve o verbete + selo do sistema (config/sistemas.json) + estado.
// Estado: 'sem_leitura' com motivo até a F3 (src/lib/estrutura-estado.js lê as chaves de verdade); nunca «ligado» fingido.
// Erro nunca ecoa o id recebido. Nenhum dado de cliente sai daqui: o ?cliente= só volta como escopo da leitura futura.
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/env.js'
import { sistema } from './lib/sistemas.js'

export const VERBETES = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'config', 'ajuda.json'), 'utf-8')).verbetes)
const ID_OK = /^[a-z0-9_]{1,40}$/
const SEM_LEITURA = Object.freeze({ estado: 'sem_leitura', motivo: 'leitura do estado real chega na F3 (src/lib/estrutura-estado.js); até lá o texto diz onde a chave mora' })

// puro: verbete + selo + estado; null para id desconhecido
export function montarVerbete(id, { cliente = '' } = {}) {
  if (!ID_OK.test(String(id || ''))) return null
  const v = VERBETES[id]; if (!v) return null
  const s = sistema(v.sistema)
  return {
    id, ...v,
    sistema_nome: s.nome, sistema_papel: s.papel_curto,
    estado: { ...SEM_LEITURA, chave: v.chave, camada: v.camada, desde: v.desde || '', por: '', motivo_chave: v.motivo || '' },
    pre_requisitos: (v.pre_requisitos || []).map(p => ({ ...p, estado: 'sem_leitura' })),
    cliente: cliente ? String(cliente).slice(0, 120) : '',
  }
}

export function criarRotasAjuda() {
  const r = Router()
  r.get('/api/ajuda/:id', (req, res) => {
    const v = montarVerbete(req.params.id, { cliente: req.query.cliente })
    if (!v) return res.status(404).json({ erro: 'verbete desconhecido' })
    res.set('Cache-Control', 'no-store').json(v)
  })
  return r
}
