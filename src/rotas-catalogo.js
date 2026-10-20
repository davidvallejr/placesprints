// HTTP do anúncio de CATÁLOGO próprio × terceiros (marcação manual; padrão seguro = terceiros). Puro (só express): o núcleo entra por fábrica
// (src/lib/catalogo-db.js) — o teste usa banco em memória. Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (string "true" = prévia);
// `por` precisa ser líder/consultor (validado no núcleo → 403); mensagens fixas, nunca ecoam valor recebido; prospect "[Comercial] …" é inexistente.
//   GET  /api/cliente/catalogo?cliente=              → { cliente, padrao, total, ativos, terceiros, proprio, excecoes:[{item_id,origem,por,em,titulo}], textos, quem }
//   POST /api/cliente/catalogo { cliente, proprio: true|false|null, por, confirmar? }                 → prévia; confirmar:true grava perfil_cliente.catalogo_proprio
//   POST /api/anuncio/catalogo-origem { cliente, item_id, origem: 'proprio'|'terceiros'|null, por, confirmar? } → prévia; confirmar:true grava a exceção do anúncio
import { Router } from 'express'
import { CATALOGO } from './lib/catalogo-cfg.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''           // fronteira de confiança: objeto/array nunca vira '[object Object]'
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: catalogo (criarCatalogo), quem() → nomes que podem marcar (equipe.lideresEConsultores), clienteCanonico(nome) → nome da central ou ''
export function criarRotasCatalogo({ catalogo, quem, clienteCanonico }) {
  const r = Router()
  // erro com status = validação/regra de negócio (mensagem fixa); sem status = falha interna → handler global do server.js (500 'erro interno', detalhe só no log)
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    const canon = ehProspecto(c) ? '' : clienteCanonico(c)
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const estrito = v => v === true                                   // "true" (string), 1, "sim" … NÃO confirmam

  r.get('/api/cliente/catalogo', trata((req, res) =>
    res.json({ ...catalogo.resumo(cliente(um(req.query.cliente))), textos: { terceiros: CATALOGO.texto_terceiros, proprio: CATALOGO.texto_proprio }, quem: quem() })))
  r.post('/api/cliente/catalogo', trata((req, res) => {
    const b = json(req)
    res.json(catalogo.definirPadrao({ cliente: cliente(b.cliente), proprio: b.proprio, por: texto(b.por), confirmar: estrito(b.confirmar) }))
  }))
  r.post('/api/anuncio/catalogo-origem', trata((req, res) => {
    const b = json(req)
    res.json(catalogo.definirExcecao({ cliente: cliente(b.cliente), item_id: texto(b.item_id), origem: b.origem, por: texto(b.por), confirmar: estrito(b.confirmar) }))
  }))
  return r
}
