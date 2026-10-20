// HTTP das pendências do cliente por canal (contrato: docs/contrato-pendencias-cliente.md). Puro (só express): o núcleo entra por fábrica
// (src/lib/pendencias-cliente.js) — o teste usa banco em memória e dependências stub.
// Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (string "true" = prévia); `por` precisa ser líder/consultor
// (validado no núcleo → 403); prospect "[Comercial] …" nunca é cliente (400); mensagens fixas, nunca ecoam o valor recebido; estado de negócio impeditivo é 200 com ok:false.
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''             // fronteira de confiança: objeto/array nunca vira '[object Object]'
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: pendencias (criarPendencias), quem() → nomes que podem registrar/resolver (equipe.lideresEConsultores), clienteCanonico(nome) → nome da central ou ''
export function criarRotasPendencias({ pendencias, quem, clienteCanonico }) {
  const r = Router()
  // erro com status = validação/regra de negócio (mensagem fixa); sem status = falha interna → handler global do server.js (500 'erro interno', detalhe só no log)
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('cliente inválido para pendências')
    const canon = clienteCanonico ? clienteCanonico(c) : c
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }

  r.get('/api/cliente/pendencias', trata((req, res) => res.json(pendencias.avaliar(cliente(um(req.query.cliente)), { paraCliente: false }))))
  r.get('/api/pendencias/catalogo', trata((req, res) => res.json({ ...pendencias.catalogo(), quem: quem() })))
  // { cliente, item, canal, detalhe (≤300), desde?, evidencia?, gravidade?, por, confirmar? } — sem confirmar:true é prévia (nada é gravado)
  r.post('/api/pendencias/registrar', trata((req, res) => { const b = json(req); res.json(pendencias.registrar({ ...b, cliente: cliente(b.cliente) })) }))
  // { registro_id, por, nota?, confirmar? }
  r.post('/api/pendencias/resolver', trata((req, res) => res.json(pendencias.resolver(json(req)))))
  return r
}
