// HTTP da aba «Do cliente» do /cliente (src/lib/aba-do-cliente.js). Loopback (guarda-local no server.js); molde rotas-pendencias.
// Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (senão prévia, nada gravado); `por` = líder, consultor ou o CS DESTE cliente
// (validado no núcleo → 403); prospect "[Comercial] …" = 400; cliente fora da central = 404; mensagens fixas, nunca ecoam o valor recebido.
//   GET  /api/cliente/do-cliente?cliente=                 → { cliente, hoje, resumo, itens[], acoes_cliente[], movidos[] }
//   POST /api/cliente/do-cliente/marcar { cliente, chave, acao: resolvido|movido|resposta, texto?, por, confirmar? } → prévia { ok, previa:true, efeito… } | { ok, id }
//   POST /api/cliente/do-cliente/lembrete { cliente, chave } → { ok, previa:true, texto, como_enviar } | { ok:false, motivo } — SÓ prepara; nada é gravado nem enviado
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: aba (criarAbaDoCliente), clienteCanonico(nome) → nome da central ou ''
export function criarRotasAbaDoCliente({ aba, clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('prospect do Comercial não é cliente')
    const canon = clienteCanonico(c)
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  r.get('/api/cliente/do-cliente', trata((req, res) => res.json(aba.ler(cliente(um(req.query.cliente))))))
  r.post('/api/cliente/do-cliente/marcar', trata((req, res) => { const b = json(req); res.json(aba.marcar({ ...b, cliente: cliente(b.cliente), chave: texto(b.chave) })) }))
  r.post('/api/cliente/do-cliente/lembrete', trata((req, res) => { const b = json(req); res.json(aba.lembrete({ cliente: cliente(b.cliente), chave: texto(b.chave) })) }))
  return r
}
