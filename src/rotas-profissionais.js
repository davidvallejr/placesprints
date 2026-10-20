// Melhor profissional para a tarefa e melhores tarefas por profissional (o que o Merovíngio mediu por pessoa × família).
import { Router } from 'express'
import { melhorProfissional, melhoresTarefasDe } from './lib/melhor-profissional.js'
import { curadoria } from './lib/processos.js'
import { normalizarNicho } from './lib/dimensoes.js'
import { RX_CANAL } from './lib/melhor-profissional.js'

export const rotasProfissionais = Router()
const trata = fn => async (req, res) => { try { await fn(req, res) } catch (e) { res.status(e.status || 400).json({ erro: e.message }) } }
const um = v => String([].concat(v ?? '')[0] ?? '').trim().slice(0, 200)

// GET /api/profissionais/melhor?demanda=Otimizar%20Anúncios (ou &familia=otimizar)&cliente=&candidatos=a,b&nicho=Pet&canal=SHO (nicho e canal: opt-in)
rotasProfissionais.get('/api/profissionais/melhor', trata((req, res) => {
  const demanda = um(req.query.demanda), familia = um(req.query.familia)
  if (!demanda && !familia) return res.status(400).json({ erro: 'informe "demanda" ou "familia"' })
  if (familia && !curadoria.familias.some(f => f.id === familia)) return res.status(400).json({ erro: 'família desconhecida' })
  const canal = um(req.query.canal) || null
  if (canal && !Object.hasOwn(RX_CANAL, canal)) return res.status(400).json({ erro: 'canal desconhecido (ML, SHO, AMZ ou TTK)' })
  const candidatos = um(req.query.candidatos) ? um(req.query.candidatos).split(',').map(s => s.trim()).filter(Boolean).slice(0, 50) : null
  res.json(melhorProfissional({ demanda, familia: familia || null, cliente: um(req.query.cliente) || null, candidatos, nicho: um(req.query.nicho) ? normalizarNicho(um(req.query.nicho)) : null, canal }))
}))
// GET /api/profissionais/tarefas?nome=Danielle%20Bernardo%20Nunes — em que famílias a pessoa tem prova de resultado
rotasProfissionais.get('/api/profissionais/tarefas', trata((req, res) => {
  const nome = um(req.query.nome); if (!nome) return res.status(400).json({ erro: 'informe "nome"' })
  res.json({ nome, familias: melhoresTarefasDe(nome) })
}))
