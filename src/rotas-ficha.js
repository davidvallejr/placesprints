// HTTP da ficha do cliente e da delegação: /api/ficha, /api/prestadores, /api/planos/acoes/delegar.
// Puro (só express): as dependências com banco entram por fábrica — o teste usa stubs e nunca abre o banco real.
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => String([].concat(v ?? '')[0] ?? '').trim()

// deps: canaisDoCliente(cliente) -> ['ML','SHO'…] (colunas da tela), ficha (lerFicha, salvarFicha, listarPrestadores, nomeOficial), sincronizarPrestadores(), clienteCanonico(nome), sugestoesDoCliente(cliente) -> {ml?: url},
//       papeis, canais, links (rótulos para a tela), delegar(ids, nomeOuVazio) -> n
export function criarRotasFicha({ ficha, sincronizarPrestadores, clienteCanonico, sugestoesDoCliente, canaisDoCliente = () => [], papeis, canais, links, delegar }) {
  const r = Router()
  const trata = fn => async (req, res) => { try { await fn(req, res) } catch (e) { res.status(e.status || 400).json({ erro: e.message }) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }

  r.get('/api/ficha', trata((req, res) => {
    const nome = um(req.query.cliente)
    if (!nome) throw erro('informe "cliente"')
    const cliente = clienteCanonico(nome)
    if (!cliente) throw erro('cliente não encontrado na central', 404)
    res.json({ ficha: ficha.lerFicha(cliente), sugestoes: sugestoesDoCliente(cliente) || {}, canais_cliente: canaisDoCliente(cliente) || [], prestadores: ficha.listarPrestadores(), papeis, canais, links })
  }))
  r.post('/api/ficha', trata((req, res) => {
    const b = json(req)
    const cliente = clienteCanonico(texto(b.cliente))
    if (!cliente) throw erro('cliente não encontrado na central', 404)
    res.json({ ok: true, ficha: ficha.salvarFicha({ cliente, links: b.links, prestadores: b.prestadores, observacao: texto(b.observacao), por: texto(b.por) }) })
  }))
  r.get('/api/prestadores', trata((req, res) => res.json({ prestadores: ficha.listarPrestadores(), papeis, canais })))
  r.post('/api/prestadores/sincronizar', trata(async (req, res) => res.json({ ok: true, prestadores: await sincronizarPrestadores() })))

  // delegar na APROVAÇÃO: o prestador escolhido vale para essas ações e vai como Responsável no card do Notion ('' = voltar ao automático)
  r.post('/api/planos/acoes/delegar', trata((req, res) => {
    const b = json(req)
    if (!Array.isArray(b.ids) || !b.ids.length) throw erro('informe "ids"')
    if (b.ids.length > 500) throw erro('máximo de 500 ações por vez')
    const nome = texto(b.prestador)
    const oficial = nome ? ficha.nomeOficial(nome) : ''
    if (nome && !oficial) throw erro('prestador não encontrado entre os ativos do Notion (sincronize os prestadores)')
    res.json({ ok: true, alteradas: delegar(b.ids.map(String), oficial || '') })
  }))
  return r
}
