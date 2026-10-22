// HTTP dos encontros da consultoria e da jornada Place Prime (docs/desenho-place-prime.md § D). Loopback (guarda-local no server.js).
// Corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (senão prévia, nada gravado, nada no Notion); `por` = líder/consultor (403 no núcleo);
// mensagens fixas, nunca ecoam o valor recebido; prospect «[Comercial] …» e cliente fora da central = 404.
//   GET  /api/cliente/encontros?cliente=                         → { cliente, produto, contagens, encontros, trilha, calendario:{ligado:false,motivo}, tipos, processos, ia }
//   POST /api/cliente/encontros/registrar { cliente, data, tipo, consultor?, por, confirmar? }   → prévia | { ok, id, distribuicao }  (card pelo distribuir() de sempre)
//   POST /api/cliente/encontros/:tarefa_id { cliente, tipo?, consultor?, gravacao_url?, treinado?:[processo_id], por, confirmar? } → prévia | { ok, depois }
//   POST /api/cliente/encontros/:tarefa_id/transcricao { cliente, texto, consentimento:true, por, confirmar? } → prévia { sha256, bytes, candidatos } | { ok, … }
//   GET  /api/cliente/nao-executa?cliente=                       → { resumo, itens, treinado_nao_feito, cobertura }
//   GET  /api/agenda?por=consultor|cliente|semana&tipo=&consultor=&squad=&produto=&clientes=   → projeção { total, linhas, calendario }
//   GET  /api/encontros/quem-treina?tipo=&consultor=&squad=&produto=&clientes=              → { linhas, n_medidas, base, min_n, cobertura }
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const ID_CARD = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i
const POR = ['consultor', 'cliente', 'semana']
const opc = (b, k) => (Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined)

// deps: encontros (criarEncontros), clienteCanonico(nome) → nome|'' , escopo(query) → { clientes, erro }, medidas() → medidas do Merovíngio, wilson
export function criarRotasEncontros({ encontros, clienteCanonico, escopo, medidas = () => [], wilson }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const corpo = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto); if (!c) throw erro('informe "cliente"')
    const canon = ehProspecto(c) ? '' : clienteCanonico(c)
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const card = id => { const v = texto(id); if (!ID_CARD.test(v)) throw erro('encontro não encontrado para este cliente', 404); return v }
  const doEscopo = q => {
    const e = escopo({ tipo: um(q.tipo) || 'total', consultor: um(q.consultor), squad: um(q.squad), produto: um(q.produto), clientes: um(q.clientes) ? um(q.clientes).split(',').map(s => s.trim()).filter(Boolean) : [] })
    if (e.erro && !e.clientes.length) throw erro('escopo inválido (tipo, consultor, squad, produto ou clientes)')
    return e.clientes.filter(c => !ehProspecto(c))
  }

  r.get('/api/cliente/encontros', trata((req, res) => res.set('Cache-Control', 'no-store').json(encontros.painel(cliente(um(req.query.cliente))))))
  r.post('/api/cliente/encontros/registrar', trata(async (req, res) => {
    const b = corpo(req)
    res.json(await encontros.registrar({ cliente: cliente(b.cliente), data: texto(b.data), tipo: texto(b.tipo), consultor: texto(b.consultor), por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.post('/api/cliente/encontros/:tarefa_id/transcricao', trata(async (req, res) => {
    const b = corpo(req)
    res.json(await encontros.transcricao({ cliente: cliente(b.cliente), tarefa_id: card(req.params.tarefa_id), texto: b.texto, consentimento: b.consentimento === true, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.post('/api/cliente/encontros/:tarefa_id', trata((req, res) => {
    const b = corpo(req)
    res.json(encontros.salvarInfo({ cliente: cliente(b.cliente), tarefa_id: card(req.params.tarefa_id), tipo: opc(b, 'tipo') === undefined ? undefined : texto(b.tipo),
      consultor: opc(b, 'consultor'), gravacao_url: opc(b, 'gravacao_url'), treinado: opc(b, 'treinado'), por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.get('/api/cliente/nao-executa', trata((req, res) => res.set('Cache-Control', 'no-store').json(encontros.naoExecuta(cliente(um(req.query.cliente))))))
  r.get('/api/agenda', trata((req, res) => {
    const por = um(req.query.por) || 'consultor'
    if (!POR.includes(por)) throw erro('por deve ser consultor, cliente ou semana')
    res.set('Cache-Control', 'no-store').json(encontros.agenda({ clientes: doEscopo(req.query), por }))
  }))
  r.get('/api/encontros/quem-treina', trata((req, res) => res.set('Cache-Control', 'no-store').json(encontros.quemTreina({ clientes: doEscopo(req.query), medidas: medidas(), wilson }))))
  return r
}
