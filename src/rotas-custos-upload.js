// HTTP da planilha de custos subida na tela (src/lib/custos-upload.js). Loopback (guarda-local: Origin de mutação = o próprio painel).
//   POST /api/cliente/custos/upload            multipart/form-data { cliente, arquivo (.csv | .xlsx, ≤ 5 MB) } → PRÉVIA (nada gravado) { previa:true, upload_id, criterios, anuncios[], sem_par[], conflitos[], quarentena[], invalidas[], efeito }
//   POST /api/cliente/custos/upload/confirmar  JSON { upload_id, por, confirmar, cliente? } → confirmar === true grava (aplicarLote + vínculos + livro + lead-time) | senão = prévia de novo
// Regras: cliente canônico da central (senão 404; prospect = 400); 415 para corpo que não é multipart/JSON e para arquivo que não é CSV/XLSX; 413 acima de 5 MB;
// `por` = líder, consultor ou o CS do cliente (403); mensagens fixas — nunca ecoam o valor recebido nem o nome do arquivo.
import express, { Router } from 'express'
import { LIMITE_BYTES } from './lib/custos-upload.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')

export function criarRotasCustosUpload({ upload, clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const cliente = bruto => {
    const c = texto(bruto)
    if (/^\s*\[Comercial\]/i.test(c)) throw erro('prospect do comercial não tem custos: só cliente da central')
    const canon = c ? clienteCanonico(c) : ''
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const cru = express.raw({ type: () => true, limit: LIMITE_BYTES + 256 * 1024 })        // multipart cru; o teto do parser cobre o arquivo + o envelope
  r.post('/api/cliente/custos/upload', (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    if (!/^multipart\/form-data\b/i.test(req.headers['content-type'] || '')) return res.status(415).json({ erro: 'envie a planilha como multipart/form-data (campos «cliente» e «arquivo»)' })
    cru(req, res, e => e ? res.status(e.status === 413 || e.type === 'entity.too.large' ? 413 : 400).json({ erro: e.status === 413 || e.type === 'entity.too.large' ? 'arquivo acima de 5 MB: divida a planilha ou tire colunas que não são de custo' : 'envio inválido' }) : next())
  }, trata(async (req, res) => {
    let fd
    try { fd = await new Response(req.body, { headers: { 'content-type': req.headers['content-type'] } }).formData() } catch { throw erro('envio multipart inválido') }
    const arq = fd.get('arquivo')
    if (!arq || typeof arq === 'string') throw erro('envie o arquivo da planilha no campo «arquivo»')
    if (arq.size > LIMITE_BYTES) throw erro('arquivo acima de 5 MB: divida a planilha ou tire colunas que não são de custo', 413)
    const c = cliente(typeof fd.get('cliente') === 'string' ? fd.get('cliente') : '')
    res.json(upload.previa({ cliente: c, nome: arq.name || '', buffer: Buffer.from(await arq.arrayBuffer()) }))
  }))
  r.post('/api/cliente/custos/upload/confirmar', trata((req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415)
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const c = texto(b.cliente) ? cliente(b.cliente) : ''
    res.json(upload.confirmar({ cliente: c, upload_id: b.upload_id, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  return r
}
