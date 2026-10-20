// HTTP das respostas dos clientes ao relatório (src/lib/respostas-relatorio.js; docs/respostas-relatorio.md). Loopback (guarda-local no server.js); molde rotas-catalogo.
// Regras: corpo JSON obrigatório nos POST (415); `por` validado no núcleo (403); mensagens fixas, nunca ecoam o valor recebido; prospect "[Comercial] …" = 404.
//   POST /api/feedback/coletar { clientes?: [nome], por }   → { ok, lidas, guardadas, repetidas, ignoradas, por_cliente:[{ cliente, estado, motivo?, lidas, guardadas, ignoradas }] } (sem jid nem texto)
//   GET  /api/feedback?status=&tema=&cliente=                → { total, itens, resumo: { por_tema, sem_tema, por_cliente, por_status }, temas, status, coleta, quem }
//   POST /api/feedback/status { msg_id, status, nota?, por } → { ok, msg_id, status }
// Perfil de informação do cliente (13/10/2026; src/lib/perfil-informacao.js) — o que cada cliente quer receber; `por` = líder/consultor ou o CS DESTE cliente (403, no núcleo);
// `confirmar` só vale se for EXATAMENTE true (senão = prévia, nada gravado):
//   GET  /api/perfil-informacao/matriz        → { carteira, com_perfil, pct_com_perfil, por_servico, por_nivel, por_tema:[{ tema, rotulo, base_fixa, n, pct_com_perfil, por_servico,
//                                                 clientes:[{ cliente, servico, posicao, fonte }], n_sugestao, sugestoes }], temas_padrao, ordem_sem_perfil, base_fixa, sugestoes, catalogo }
//   GET  /api/cliente/perfil-informacao?cliente= → { cliente, perfil|null, sugestao|null, efetivo:{ fonte, servico, nivel, temas, ordem }, historico, catalogo, quem }
//   POST /api/cliente/perfil-informacao { cliente, servico?, temas, nivel?, observacao?, fonte?: 'equipe'|'whatsapp', por, confirmar? }
//        → prévia { ok, previa:true, mudou, antes, depois } | { ok, previa:false, mudou, perfil } (mudou:false = igual ao salvo, nada gravado)
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: respostas (criarRespostas), quem() → nomes que podem decidir, clienteCanonico(nome) → nome da central ou ''
export function criarRotasFeedback({ respostas, quem = () => [], clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => { const c = texto(bruto), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }
  const clientes = v => {
    if (v === undefined || v === null) return null                                     // sem lista = todos os clientes com grupo do Mercado Livre
    if (!Array.isArray(v) || !v.length || v.length > 200 || v.some(x => typeof x !== 'string')) throw erro('"clientes" deve ser uma lista de nomes')
    return [...new Set(v.map(cliente))]
  }

  r.post('/api/feedback/coletar', trata(async (req, res) => { const b = json(req); res.json(await respostas.coletar({ clientes: clientes(b.clientes), por: texto(b.por) })) }))
  r.get('/api/feedback', trata((req, res) => {
    const c = um(req.query.cliente)
    res.json({ ...respostas.listar({ status: um(req.query.status), tema: um(req.query.tema), cliente: c ? cliente(c) : '' }), quem: quem() })
  }))
  r.post('/api/feedback/status', trata((req, res) => { const b = json(req); res.json(respostas.marcar({ msg_id: b.msg_id, status: texto(b.status), nota: b.nota, por: texto(b.por) })) }))
  return r
}

// deps: perfis (criarPerfilInformacao), quem() → nomes que podem registrar, clienteCanonico(nome) → nome da central ou ''
export function criarRotasPerfilInformacao({ perfis, quem = () => [], clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => { const c = texto(bruto), canon = c && !ehProspecto(c) ? clienteCanonico(c) : ''; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }

  r.get('/api/perfil-informacao/matriz', trata((req, res) => res.json({ ...perfis.matriz(), catalogo: perfis.catalogo() })))
  r.get('/api/cliente/perfil-informacao', trata((req, res) => res.json({ ...perfis.ler(cliente(um(req.query.cliente))), catalogo: perfis.catalogo(), quem: quem() })))
  r.post('/api/cliente/perfil-informacao', trata((req, res) => {
    const b = json(req)
    res.json(perfis.salvar({ cliente: cliente(b.cliente), servico: b.servico, temas: b.temas, nivel: b.nivel, observacao: b.observacao, fonte: b.fonte, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  return r
}
