// HTTP do "Como era" do anúncio (Parte B, fase 1; sem Restaurar — fase 3). Só leitura do banco + uma captura sob demanda (leitura do ML, nunca escrita).
//   GET  /api/cliente/anuncio/historico?cliente=&item=  → { cliente, item, snapshots:[{ hash, capturado_em, origem, resumo, sem_descricao }], mudancas:[...piorouDepoisDe] }
//   POST /api/cliente/anuncio/snapshot { cliente, item }  → captura agora (origem 'coleta') e devolve o resultado de capturarSnapshot
//   GET  /api/cliente/anuncio/fotos?cliente=&item=MLB…  → { item_id, fotos:[{ url, ordem }] (capa + até 7), total, fonte:'snapshot'|'ml'|'capa', lido_em }
//        galeria da tela do cliente (lib/anuncio-fotos.js): fotografia ≤ 7 d → leitura do ML (só GET) → só a capa; falha do ML nunca vira 500
// Prospect "[Comercial] …" nunca é cliente (400 fixo). Isolamento: o anúncio precisa estar em meli_item DESTE cliente (404 sem ecoar o valor).
import { Router } from 'express'
import { db } from './lib/db.js'
import { historicoAnuncio } from './lib/anuncio-historico.js'
import { criarFotosAnuncio } from './lib/anuncio-fotos.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const ITEM = /^[A-Z]{3}\d{6,}$/
// leitura ao vivo das fotos: detalhesItens (meli-api.js, GET /items com o token do cliente); import tardio para o teste não tocar em tokens
const lerItemML = async (cliente, id) => { const { detalhesItens } = await import('./lib/meli-api.js'); return (await detalhesItens(cliente, [id]))[0] || { _erro: true } }

export function criarRotasHistorico({ hist = historicoAnuncio, handle = db, fotos = null } = {}) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const doCliente = handle.prepare('SELECT 1 FROM meli_item WHERE cliente = ? AND item_id = ?')
  const galeria = fotos || criarFotosAnuncio({ handle, lerItem: lerItemML })
  const validar = (cliente, item, sem = 'sem histórico de anúncio', padrao = ITEM) => {
    if (!cliente) throw erro('informe "cliente"')
    if (ehProspecto(cliente)) throw erro('prospect do Comercial não é cliente: ' + sem)
    if (!padrao.test(item)) throw erro('informe "item" (id do anúncio, ex.: MLB + números)')
    if (!doCliente.get(cliente, item)) throw erro('anúncio não encontrado neste cliente', 404)
  }
  r.get('/api/cliente/anuncio/historico', trata(async (req, res) => {
    const cliente = um(req.query.cliente), item = um(req.query.item).toUpperCase()
    validar(cliente, item)
    res.json({ cliente, item, snapshots: hist.resumoSnapshots(cliente, item), mudancas: await hist.piorouDepoisDe(cliente, item), restaurar: 'Restaurar chega na fase 3' })
  }))
  r.get('/api/cliente/anuncio/fotos', trata(async (req, res) => {
    const cliente = um(req.query.cliente), item = um(req.query.item).toUpperCase()
    validar(cliente, item, 'sem fotos de anúncio', /^MLB\d+$/)
    res.json(await galeria.fotos(cliente, item))
  }))
  r.post('/api/cliente/anuncio/snapshot', trata(async (req, res) => {
    const cliente = texto(req.body?.cliente), item = texto(req.body?.item).toUpperCase()
    validar(cliente, item)
    res.json(await hist.capturarSnapshot(cliente, item, { origem: 'coleta' }))
  }))
  return r
}
export const rotasHistorico = criarRotasHistorico()
