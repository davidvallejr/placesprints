// GET /api/ajuda/:id?cliente= — texto do ícone (i) «Como fazer» (docs/ux/arquitetura-5-menus.md § C; F2, 21/10/2026).
// Fonte: config/ajuda.json (lido uma vez). Devolve o verbete + selo do sistema (config/sistemas.json) + estado.
// Estado (F3): lido de src/lib/estrutura-estado.js pelo contexto real (deps.contexto) — a linha da estrutura cujo `ajuda` é este verbete dá
// ligado/desligado/pronto/pendente/erro, desde, por e o que falta; cada pré-requisito GLOBAL (env.*, chaves, cargos, plists) é resolvido por verificar();
// os por cliente ficam 'sem_leitura' com o motivo. Sem contexto (testes, verbete sem estrutura) o estado é 'sem_leitura' — nunca «ligado» fingido.
// Erro nunca ecoa o id recebido. Nenhum dado de cliente sai daqui: o ?cliente= só volta como escopo.
import { Router } from 'express'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './lib/env.js'
import { sistema } from './lib/sistemas.js'
import { montarEstrutura, verificar } from './lib/estrutura-estado.js'

export const VERBETES = Object.freeze(JSON.parse(readFileSync(join(ROOT, 'config', 'ajuda.json'), 'utf-8')).verbetes)
const ID_OK = /^[a-z0-9_]{1,40}$/
const SEM_LEITURA = Object.freeze({ estado: 'sem_leitura', motivo: 'estado real não lido nesta chamada (a tela de Estruturas, F3, lê pelo contexto do servidor); o texto diz onde a chave mora' })

// puro: verbete + selo + estado; null para id desconhecido. ctx = contexto de estrutura-estado (opcional)
export function montarVerbete(id, { cliente = '', ctx = null } = {}) {
  if (!ID_OK.test(String(id || ''))) return null
  const v = VERBETES[id]; if (!v) return null
  const s = sistema(v.sistema)
  const linha = ctx ? montarEstrutura(ctx).linhas.find(l => l.ajuda === id) : null
  const estado = linha
    ? { estado: linha.estado, chave: v.chave, camada: `${v.camada}${linha.reinicio_pendente ? ' — o arquivo mudou depois do início do servidor: reinício pendente' : ''}`, desde: linha.desde || linha.nasceu || v.desde || '', por: linha.por || '', motivo_chave: v.motivo || '', falta: linha.falta, detalhe: linha.detalhe, motivo: '' }
    : { ...SEM_LEITURA, chave: v.chave, camada: v.camada, desde: v.desde || '', por: '', motivo_chave: v.motivo || '', falta: [] }
  return {
    id, ...v,
    sistema_nome: s.nome, sistema_papel: s.papel_curto,
    estado,
    pre_requisitos: (v.pre_requisitos || []).map(p => { const r = ctx ? verificar(p.verificar, ctx) : { estado: 'sem_leitura', motivo: SEM_LEITURA.motivo }; return { ...p, estado: r.estado, motivo: r.motivo || '' } }),
    cliente: cliente ? String(cliente).slice(0, 120) : '',
  }
}

// deps: contexto() → ctx real (src/lib/estrutura-estado-real.js); ausente = estado sem_leitura
export function criarRotasAjuda({ contexto = null } = {}) {
  const r = Router()
  r.get('/api/ajuda/:id', (req, res) => {
    let ctx = null; try { ctx = contexto ? contexto() : null } catch { ctx = null }   // leitura do estado nunca derruba a ajuda: cai para sem_leitura
    const v = montarVerbete(req.params.id, { cliente: req.query.cliente, ctx })
    if (!v) return res.status(404).json({ erro: 'verbete desconhecido' })
    res.set('Cache-Control', 'no-store').json(v)
  })
  return r
}
