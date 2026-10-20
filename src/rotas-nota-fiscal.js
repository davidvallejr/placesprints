// HTTP da nota fiscal (V3 F8, src/lib/nota-fiscal-real.js). Loopback (guarda-local), exceto o webhook do provedor (rota pública exata, assinatura no adaptador).
// Regras: corpo JSON nos POST (415); `confirmar` só vale se for EXATAMENTE true (senão prévia, nada gravado nem enviado); `por` = líder/consultor (403 no núcleo);
// mensagens fixas, nunca ecoam o valor recebido; prospect "[Comercial] …" e cliente fora da central = 404; toda leitura/escrita filtra pelo cliente da URL/corpo.
//   GET  /api/cliente/nf?cliente=                         → estado (chaves, dados fiscais sem token/certificado, termo, regras, certificado, contagem, automática, sinais)
//   GET  /api/cliente/nf/notas?cliente=&estado=           → { cliente, notas:[projeção: comprador mascarado] }
//   GET  /api/cliente/nf/eventos?cliente=&ref=            → { cliente, ref, eventos }
//   POST /api/cliente/nf/config      { cliente, dados:{cnpj,razao_social,ie,uf,regime,serie,ambiente,emissor,politica,vendedor_apelido,cert_ref,token_ref,contador}, por, confirmar }
//   POST /api/cliente/nf/termo       { cliente, aceito_por, aceito_em, por, confirmar }
//   POST /api/cliente/nf/regras      { cliente, csv, contador, por, confirmar }             (CSV do contador; prévia lista erros por linha/campo, sem eco)
//   POST /api/cliente/nf/certificado { cliente, base64, senha, por, confirmar }             (≤ 5 MB; vai ao provedor; nunca gravado nem logado)
//   POST /api/cliente/nf/rascunhos   { cliente, por, confirmar }                            (pedidos pagos sem nota → rascunho)
//   POST /api/cliente/nf/aprovar     { cliente, refs[], por, confirmar }
//   POST /api/cliente/nf/emitir      { cliente, refs?, por, confirmar }                     (chave nf.ligado; sem ela = pendente)
//   POST /api/cliente/nf/consultar   { cliente, ref }
//   POST /api/cliente/nf/cancelar    { cliente, ref, justificativa, por, confirmar }
//   POST /api/cliente/nf/carta       { cliente, ref, correcao, por, confirmar }
//   POST /api/cliente/nf/anexar      { cliente, ref, por, confirmar }                       (chave nf.envio_ml_ligado)
//   POST /webhook/nf/focus                                                                   (cabeçalho do gatilho; 401 sempre igual)
import express, { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
export const ROTA_CERTIFICADO = '/api/cliente/nf/certificado'
export const certificadoJson = express.json({ limit: '7mb' })

// deps: nf (criarNotaFiscal), quem() → nomes que podem aprovar, clienteCanonico(nome) → nome da central ou ''
export function criarRotasNotaFiscal({ nf, quem = () => [], clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    const canon = ehProspecto(c) ? '' : clienteCanonico(c)
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const conf = b => b.confirmar === true

  r.get('/api/cliente/nf', trata((req, res) => res.json({ ...nf.estado(cliente(um(req.query.cliente))), quem: quem() })))
  r.get('/api/cliente/nf/notas', trata((req, res) => { const c = cliente(um(req.query.cliente)); res.json({ cliente: c, notas: nf.listar(c, { estado: um(req.query.estado) }) }) }))
  r.get('/api/cliente/nf/eventos', trata((req, res) => { const c = cliente(um(req.query.cliente)), ref = um(req.query.ref); res.json({ cliente: c, ref, eventos: nf.eventos(c, ref) }) }))
  r.post('/api/cliente/nf/config', trata((req, res) => { const b = json(req); res.json(nf.configurar({ cliente: cliente(b.cliente), dados: b.dados, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/termo', trata((req, res) => { const b = json(req); res.json(nf.aceitarTermo({ cliente: cliente(b.cliente), aceito_por: b.aceito_por, aceito_em: b.aceito_em, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/regras', trata((req, res) => { const b = json(req); res.json(nf.importarRegras({ cliente: cliente(b.cliente), csv: b.csv, contador: b.contador, por: texto(b.por), confirmar: conf(b) })) }))
  r.post(ROTA_CERTIFICADO, trata(async (req, res) => { const b = json(req); res.json(await nf.certificado({ cliente: cliente(b.cliente), base64: b.base64, senha: b.senha, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/rascunhos', trata(async (req, res) => {
    const b = json(req), c = cliente(b.cliente)
    if (!conf(b)) return res.json({ previa: true, cliente: c, pedidos: nf.pendentes(c) })
    res.json(await nf.gerar({ cliente: c, por: texto(b.por) }))
  }))
  r.post('/api/cliente/nf/aprovar', trata((req, res) => { const b = json(req); res.json(nf.aprovar({ cliente: cliente(b.cliente), refs: b.refs, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/emitir', trata(async (req, res) => { const b = json(req); res.json(await nf.emitir({ cliente: cliente(b.cliente), refs: b.refs, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/consultar', trata(async (req, res) => { const b = json(req); res.json(await nf.consultar({ cliente: cliente(b.cliente), ref: texto(b.ref) })) }))
  r.post('/api/cliente/nf/cancelar', trata(async (req, res) => { const b = json(req); res.json(await nf.cancelar({ cliente: cliente(b.cliente), ref: texto(b.ref), justificativa: b.justificativa, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/carta', trata(async (req, res) => { const b = json(req); res.json(await nf.cartaCorrecao({ cliente: cliente(b.cliente), ref: texto(b.ref), correcao: b.correcao, por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/cliente/nf/anexar', trata(async (req, res) => {
    const b = json(req), c = cliente(b.cliente)
    if (!conf(b)) return res.json({ previa: true, cliente: c, ref: texto(b.ref) })
    res.json(await nf.anexar({ cliente: c, ref: texto(b.ref), por: texto(b.por) }))
  }))
  return r
}

// webhook do provedor (montado ANTES do parser global; corpo JSON ≤ 256 KB); 401 sempre igual, sem detalhe
export function criarRotaWebhookNota({ nf, log = () => {} }) {
  const r = Router()
  r.post('/webhook/nf/focus', express.json({ limit: '256kb' }), async (req, res) => {
    try { res.json(await nf.webhook('focus', req.headers, req.body && typeof req.body === 'object' ? req.body : {})) }
    catch (e) { if (e?.status === 401) return res.status(401).json({ erro: 'não autorizado' }); if (e?.status) return res.status(e.status).json({ erro: 'notificação inválida' }); log('erro', `Chaveiro · nota fiscal · webhook: ${String(e?.message || e).slice(0, 120)}`); res.status(500).json({ erro: 'falha' }) }
  })
  return r
}
