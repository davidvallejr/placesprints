// HTTP do SINCRONISMO DE ESTOQUE do Chaveiro (V3 F6 — docs/desenho-v3-erp.md § A; src/lib/chaveiro-estoque(-real).js). Loopback (guarda-local).
// Regras: cliente canônico da central, senão 404; prospect «[Comercial] …» = 400; corpo JSON nos POST (415); PRÉVIA por padrão — só age com confirmar === true;
// `por` validado no núcleo (líder do cliente para liberar/executar/parar); mensagens fixas, sem eco. A ÚNICA rota que pode escrever no ML é /executar, e só depois de
// todas as travas (chave global, kill switch, liberação, estreia, teto, hash, físico ≤ 24 h, releitura ao vivo).
//   GET  /api/chaveiro/estoque/ordens?cliente=          → { ligado, parado, politica, ordens[], eventos[] }
//   POST /api/chaveiro/estoque/previa   { cliente }     → prévia (o que seria escrito, por anúncio; nenhuma chamada ao ML)
//   POST /api/chaveiro/estoque/preparar { cliente, por, confirmar } → prévia | ordens gravadas (aguardando aprovação; nada vai ao ML)
//   POST /api/chaveiro/estoque/executar { cliente, ordem, por, confirmar } → { executado, motivos[] | enviados[] }
//   POST /api/chaveiro/estoque/conferir { cliente }     → conferência das ordens vencidas (só leitura)
//   POST /api/chaveiro/estoque/liberar  { cliente, por, cliente_informado, produto, nivel?, confirmar } · /revogar { cliente, por, confirmar }
//   POST /api/chaveiro/estoque/regra    { cliente, produto|'*', dias_protecao, maximo_por_anuncio, nao_escrever, por, confirmar }
//   POST /api/chaveiro/estoque/parar    { por, confirmar } (kill switch) · /retomar { por, confirmar }
//   GET  /api/chaveiro/estoque/marco?cliente=           → marco sync_estoque (Merovíngio: dias sem estoque, cancelamentos, unidades antes × depois com controle)
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: sync = módulo chaveiro-estoque-real (ou stub nos testes) · clienteCanonico(nome) → nome | '' · validarPor(nome, cliente) → nome | '' (líder/consultor/CS: preparar e regra)
export function criarRotasChaveiroEstoque({ sync, clienteCanonico, validarPor = () => '' }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (ehProspecto(c)) throw erro('prospect do comercial não é cliente: sem sincronismo de estoque')
    const canon = c ? clienteCanonico(c) : ''
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const conf = b => b.confirmar === true
  r.get('/api/chaveiro/estoque/ordens', trata((req, res) => res.json(sync.ordensDoCliente(cliente(um(req.query.cliente))))))
  r.get('/api/chaveiro/estoque/marco', trata((req, res) => res.json(sync.marcoSyncEstoque(cliente(um(req.query.cliente))))))
  r.post('/api/chaveiro/estoque/previa', trata((req, res) => res.json(sync.previaSync(cliente(json(req).cliente)))))
  r.post('/api/chaveiro/estoque/preparar', trata((req, res) => { const b = json(req); res.json(sync.prepararOrdens(cliente(b.cliente), { por: texto(b.por), confirmar: conf(b), validarPor })) }))
  r.post('/api/chaveiro/estoque/executar', trata(async (req, res) => {
    const b = json(req), c = cliente(b.cliente), ordem = texto(b.ordem)
    if (!/^CH-[0-9a-f]{10}$/.test(ordem)) throw erro('informe a ordem (CH-…)')
    res.json(await sync.executarOrdem(c, ordem, { por: texto(b.por), confirmar: b.confirmar }))      // confirmar repassado CRU: só o booleano true passa nas travas
  }))
  r.post('/api/chaveiro/estoque/conferir', trata(async (req, res) => res.json(await sync.conferirOrdens({ cliente: cliente(json(req).cliente) }))))
  r.post('/api/chaveiro/estoque/liberar', trata((req, res) => { const b = json(req); res.json(sync.liberarCliente(cliente(b.cliente), { por: texto(b.por), cliente_informado: b.cliente_informado === true, produto: texto(b.produto), nivel: texto(b.nivel) || 'executar_com_aprovacao', confirmar: conf(b) })) }))
  r.post('/api/chaveiro/estoque/revogar', trata((req, res) => { const b = json(req); res.json(sync.revogarCliente(cliente(b.cliente), { por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/chaveiro/estoque/regra', trata((req, res) => { const b = json(req); res.json(sync.salvarRegra(cliente(b.cliente), { produto: texto(b.produto) || '*', dias_protecao: b.dias_protecao, maximo_por_anuncio: b.maximo_por_anuncio, nao_escrever: b.nao_escrever === true, por: texto(b.por), confirmar: conf(b), validarPor })) }))
  r.post('/api/chaveiro/estoque/parar', trata((req, res) => { const b = json(req); res.json(sync.pararSync({ por: texto(b.por), confirmar: conf(b) })) }))
  r.post('/api/chaveiro/estoque/retomar', trata((req, res) => { const b = json(req); res.json(sync.retomarSync({ por: texto(b.por), confirmar: conf(b) })) }))
  return r
}
