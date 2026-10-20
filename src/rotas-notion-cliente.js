// HTTP do Notion do cliente no painel (docs/notion-cliente.md). Puro (só express): o núcleo entra por fábrica (src/lib/notion-cliente.js).
//   GET  /api/cliente/notion?cliente=            → { cliente, pagina:{page_id,url,titulo,filhos[],lido_em,erro}|null, informacoes[], secoes[], quem }
//   POST /api/cliente/notion/atualizar { cliente, por }        → lê UM cliente agora (completo) e devolve { cliente, estado, lido_em, filhos, linhas }
//   POST /api/notion/atualizar-todos { por, confirmar? }       → prévia (lista) sem confirmar:true; com ele cria o job { job, total }
//   GET  /api/notion/job/:id
// Regras: corpo JSON (415); `por` líder/consultor (403); `confirmar` só vale se for EXATAMENTE true; mensagens fixas, nunca ecoam valor; prospect = 404.
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])

export function criarRotasNotionCliente({ nc, quem }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }

  r.get('/api/cliente/notion', trata((req, res) => res.json({ ...nc.lerLocal(um(req.query.cliente)), quem: quem() })))
  r.post('/api/cliente/notion/atualizar', trata(async (req, res) => { const b = json(req); res.json(await nc.lerCliente(um(b.cliente), { por: texto(b.por), completo: true })) }))
  r.post('/api/notion/atualizar-todos', trata((req, res) => { const b = json(req); res.json(nc.lerTodos({ por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.get('/api/notion/job/:id', trata((req, res) => { const j = nc.jobDe(String(req.params.id || '').slice(0, 60)); j ? res.json(j) : res.status(404).json({ erro: 'job não encontrado' }) }))
  return r
}
