// HTTP do alerta de pendência crítica do cliente (docs/alerta-cliente.md, prefixo /api/alertas). Puro (só express): o núcleo entra por fábrica
// (src/lib/alerta-cliente.js) — o teste usa banco em memória e stub do Notion.
// Regras: corpo JSON obrigatório nos POST (415); `confirmar`/`confirmar_destino` só valem se forem EXATAMENTE true (string "true" = prévia); `por` precisa ser líder/consultor
// (validado no núcleo → 403); mensagens fixas, nunca ecoam o valor recebido; prospect "[Comercial] …" é inexistente (404); estado de negócio impeditivo é 200 com ok:false.
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''           // fronteira de confiança: objeto/array nunca vira '[object Object]'
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: alertas (criarAlertaCliente), quem() → nomes que podem enviar/ligar (equipe.lideresEConsultores), clienteCanonico?(nome) → nome da central ou ''
export function criarRotasAlertas({ alertas, quem, clienteCanonico }) {
  const r = Router()
  // erro com status = validação/regra de negócio (mensagem fixa); sem status = falha interna → handler global do server.js (500 'erro interno', detalhe só no log)
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('cliente não encontrado na central', 404)
    const canon = clienteCanonico ? clienteCanonico(c) : c
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const estrito = v => v === true                                   // "true" (string), 1, "sim" … NÃO confirmam
  const idAlerta = v => typeof v === 'number' || typeof v === 'string' ? v : undefined

  r.get('/api/alertas/cliente', trata((req, res) => res.json({ ...alertas.listarCliente(cliente(um(req.query.cliente))), quem: quem() })))
  r.get('/api/alertas/pendentes', trata((req, res) => res.json({ ...alertas.listarPendentes(), quem: quem() })))
  // { id, por, confirmar?, previa_id?, confirmar_destino? } — sem confirmar:true é prévia (só leitura); o líder decide: interruptor, janela e liberação não barram o envio manual
  r.post('/api/alertas/enviar', trata(async (req, res) => {
    const b = json(req)
    res.json(await alertas.enviar({ id: idAlerta(b.id), por: texto(b.por), confirmar: estrito(b.confirmar), previa_id: texto(b.previa_id), confirmar_destino: estrito(b.confirmar_destino) }))
  }))
  // interruptor do envio AUTOMÁTICO ao Notion do cliente (nasce desligado; o aviso interno com som não depende dele)
  r.get('/api/alertas/agendador', trata((req, res) => res.json(alertas.agendadorEstado())))
  r.post('/api/alertas/agendador', trata((req, res) => { const b = json(req); res.json(alertas.agendador({ ligado: b.ligado, por: texto(b.por) })) }))
  return r
}
