// HTTP do progresso do processo (F4, 21/10/2026; docs/ux/arquitetura-5-menus.md § D). Loopback (guarda-local). SÓ LEITURA: nenhuma rota de escrita nasce aqui —
// o botão de cada etapa aponta para a tela onde a rota de escrita já existe.
//   GET /api/cliente/progresso?cliente=                      → progressoCliente(contexto real); 404 com mensagem fixa (nunca ecoa o nome)
//   GET /api/progresso?tipo=&consultor=&squad=&cliente=A&cliente=B → progressoCarteira pelo MESMO resolverEscopo de /planos (tipo total | selecao | consultor | squad)
import { Router } from 'express'

const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: progresso = criarProgressoReal(...) → { cliente(c), carteira(escopo) } · clienteCanonico(nome) → nome | ''
export function criarRotasProgresso({ progresso, clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  r.get('/api/cliente/progresso', trata((req, res) => {
    const c = um(req.query.cliente), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''
    if (!canon) return res.status(404).json({ erro: 'cliente não encontrado na central' })
    res.set('Cache-Control', 'no-store').json(progresso.cliente(canon))
  }))
  r.get('/api/progresso', trata((req, res) => {
    const qq = req.query || {}, clientes = [].concat(qq.cliente || []).map(texto).filter(Boolean)
    const escopo = { tipo: texto(qq.tipo) || (clientes.length ? 'selecao' : 'total'), consultor: texto(qq.consultor), squad: texto(qq.squad), ...(texto(qq.produto) ? { produto: texto(qq.produto) } : {}), clientes }
    res.set('Cache-Control', 'no-store').json(progresso.carteira(escopo))
  }))
  return r
}
