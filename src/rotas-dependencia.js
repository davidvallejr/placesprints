// HTTP do encerramento por dependência do cliente: POST (prévia por padrão; confirmar:true executa) e GET (lista por cliente + rótulos + quem pode encerrar).
// Puro (só express): o núcleo entra por fábrica (src/lib/dependencia-cliente.js) — o teste usa banco em memória e stub do Notion.
import { Router } from 'express'
import { TIPOS } from './lib/dependencia-cliente.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const um = v => String([].concat(v ?? '')[0] ?? '').trim()

// deps: dependencias (criarDependencias: encerrar valida o corpo, listar, limiares), quem() -> nomes que podem encerrar (equipe.lideresEConsultores)
export function criarRotasDependencia({ dependencias, quem }) {
  const r = Router()
  // erro com status = validação/Notion (mensagem fixa); sem status = falha interna (SQLITE_BUSY…) → handler global do server.js (500 'erro interno', detalhe só no log)
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }

  // corpo { ids[], tipo, detalhe, evidencia?, por, confirmar? } — sem confirmar devolve a prévia; lote misto é 200 (só validação do corpo é 4xx)
  r.post('/api/tarefas/dependencia-cliente', trata(async (req, res) => res.json(await dependencias.encerrar(json(req)))))
  r.get('/api/tarefas/dependencia-cliente', trata((req, res) =>
    res.json({ itens: dependencias.listar({ cliente: um(req.query.cliente) }), tipos: TIPOS, quem: quem(), limiares: dependencias.limiares })))
  return r
}
