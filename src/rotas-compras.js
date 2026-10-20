// HTTP do PRAZO DE REPOSIÇÃO (lead time) e da PREVISÃO DE COMPRAS — Algoritmo v1.6.0 (src/lib/lead-time.js, src/lib/compras-previsao.js). Loopback (guarda-local no server.js).
// Regras: corpo JSON nos POST (415); `por` validado no núcleo (403: líder/consultor ou o CS deste cliente); `confirmar` só vale se for EXATAMENTE true (senão = prévia,
// nada gravado); mensagens fixas, nunca ecoam o valor recebido; prospect "[Comercial] …" ou nome fora da central = 404.
//   GET  /api/cliente/lead-time?cliente=  → { cliente, conta|null, por_anuncio:[{ chave, dias, fonte, por, atualizado_em }], premissa:{ dias, seguranca_dias }, quem }
//   POST /api/cliente/lead-time { cliente, chave?: '*'|MLB…|SKU, dias, fonte?: 'cliente'|'equipe', por, confirmar? }
//        → prévia { ok, previa:true, mudou, antes, depois } | { ok, previa:false, mudou, antes?, depois } (mudou:false = igual ao salvo, nada gravado)
//   GET  /api/cliente/compras?cliente=    → preverCompras(diagnóstico): { disponivel, rotulo_pedido, parcial, premissas, itens, parado, totais } | { disponivel:false, motivo }
// Concorrentes por anúncio (src/lib/concorrencia.js; bloco 🆚 do relatório personalizado, 13/10/2026):
//   GET  /api/cliente/concorrentes?cliente= → { cliente, concorrentes:[{ item_id, url, preco, observado_em }] (última observação de cada link), quem }
//   POST /api/cliente/concorrentes { cliente, item_id: MLB…, url: https…, preco, observado_em?: AAAA-MM-DD (padrão hoje), por, confirmar? }
//        → prévia { ok, previa:true, novo, depois } | { ok, previa:false, novo, depois } (mesmo link no mesmo dia = só atualiza o preço)
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: leadTime (criarLeadTime), compras(cliente) → preverCompras, premissa { dias, seguranca_dias }, quem() → nomes que podem registrar, clienteCanonico(nome) → nome | ''
export function criarRotasCompras({ leadTime, compras, premissa, quem = () => [], clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => { const c = texto(bruto), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }

  r.get('/api/cliente/lead-time', trata((req, res) => res.json({ ...leadTime.ler(cliente(um(req.query.cliente))), premissa, quem: quem() })))
  r.post('/api/cliente/lead-time', trata((req, res) => {
    const b = json(req)
    res.json(leadTime.salvar({ cliente: cliente(b.cliente), chave: b.chave, dias: b.dias, fonte: b.fonte, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.get('/api/cliente/compras', trata((req, res) => res.json(compras(cliente(um(req.query.cliente))))))
  return r
}

// deps: concorrencia (criarConcorrencia), quem() → nomes que podem registrar, clienteCanonico(nome) → nome | ''
export function criarRotasConcorrencia({ concorrencia, quem = () => [], clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => { const c = texto(bruto), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }
  r.get('/api/cliente/concorrentes', trata((req, res) => res.json({ ...concorrencia.ler(cliente(um(req.query.cliente))), quem: quem() })))
  r.post('/api/cliente/concorrentes', trata((req, res) => {
    const b = json(req)
    res.json(concorrencia.registrar({ cliente: cliente(b.cliente), item_id: b.item_id, url: b.url, preco: b.preco, observado_em: b.observado_em, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  return r
}
