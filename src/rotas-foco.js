// HTTP do Foco 80/20 + atribuição (F1, 22/10/2026; docs/desenho-merovingio-foco-8020.md § «Construído»). Loopback (guarda-local). SÓ LEITURA.
//   GET /api/cliente/foco?cliente=&janela=15|30|45|60|90[&item=MLB…] → focoDoCliente (lib/foco-real.js): concentração, unidades com veredito,
//       o que a janela consegue afirmar e a atribuição por anúncio. Prospect «[Comercial]» e cliente fora da central → 404 fixo; janela fora da lista → 400 fixo.
//       Mensagens nunca ecoam o valor recebido.
import { Router } from 'express'
import { JANELAS } from './lib/foco-8020.js'

const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const ITEM = /^[A-Z]{3}\d{6,}$/

// deps: foco(cliente, { janela, item }) → objeto · clienteCanonico(nome) → nome | ''
export function criarRotasFoco({ foco, clienteCanonico }) {
  const r = Router()
  r.get('/api/cliente/foco', (req, res, next) => {
    try {
      const c = um(req.query.cliente), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''
      if (!canon) return res.status(404).json({ erro: 'cliente não encontrado na central' })
      const janela = Number(um(req.query.janela) || 30)
      if (!JANELAS.includes(janela)) return res.status(400).json({ erro: 'janela deve ser 15, 30, 45, 60 ou 90' })
      const item = um(req.query.item)
      if (item && !ITEM.test(item)) return res.status(400).json({ erro: 'item deve ser o id do anúncio (ex.: MLB + números)' })
      res.set('Cache-Control', 'no-store').json(foco(canon, { janela, item: item || null }))
    } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) }
  })
  return r
}
