// HTTP do livro de registro, do cliente em risco e do contrato/pagamentos (base da Prestação de contas e do Dossiê de defesa). Loopback (guarda-local no server.js).
// Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (senão = prévia, nada gravado); `por` = líder/consultor ou o CS DESTE cliente (403, validado no núcleo);
// mensagens fixas, nunca ecoam o valor recebido; prospect "[Comercial] …" e cliente fora da central = 404.
//   GET  /api/cliente/livro?cliente=&de=&ate=&tipo=&pagina=&por_pagina=  → { cliente, de, ate, tipo, total, pagina, por_pagina, por_tipo, itens:[{ seq, fato_em, registrado_em, tipo, ref, resumo, dados, prova, hash }], tipos }
//   GET  /api/livro/verificar?cliente=                                    → { ok, cliente, clientes, registros, quebra:{cliente,seq,motivo,detalhe}|null, lacunas, cabeca? }
//   GET  /api/cliente/risco?cliente=                                      → { cliente, riscos, motivos, quem }
//   POST /api/cliente/risco { cliente, motivo, descricao?, desde?, por, confirmar? }          → prévia | { ok, risco }
//   POST /api/cliente/risco/encerrar { cliente, id, por, nota?, confirmar? }                  → prévia | { ok, risco }
//   GET  /api/risco                                                       → { abertos, sugestoes:[{ cliente, sinais:[{id,rotulo,desde}], risco_aberto }], motivos, quem }
//   GET  /api/cliente/contrato?cliente=                                   → { cliente, contrato|null, pagamentos, quem }
//   POST /api/cliente/contrato { cliente, inicio?, fim?, canais?, entregaveis?, valor_mensal_centavos?, obrigacao_meio?, clausula_reembolso?, arquivo?:{base64}, por, confirmar? }
//   POST /api/cliente/pagamento { cliente, data, valor_centavos, referencia?, arquivo?:{base64}, por, confirmar? }
// Arquivo ≤ 5 MB em base64: o server.js monta `uploadJson` (limite 7 MB) nas duas rotas de upload ANTES do express.json global de 1 MB.
// Prestação de contas / Dossiê de defesa (Etapa 2, src/lib/dossie.js; só com `dossies` injetado):
//   POST /api/cliente/dossie { cliente, versao:'cliente'|'defesa', de, ate, por }  → { ok, dossie:{ id, versao, status, pendencias, sha256_pdf, sha256_doc, pdf, pdf_motivo, pdf_url, doc_url, livro } }
//   GET  /api/cliente/dossies?cliente=                    → { cliente, itens:[dossie…], mensal:{ ligado, n8n, agenda, envios só deste cliente } }
//   GET  /api/dossie/:id/pdf | /api/dossie/:id/doc        → arquivo (attachment; Word = .rtf application/rtf, ou .doc HTML application/msword sem textutil). SÓ loopback, nas duas versões
//   POST /api/dossie/:id/notion { por, confirmar? }       → prévia { titulo } | { ok, url } | barrado { ok:false, previa:true, motivo:'auditoria', codigos, violacoes } — só a versão CLIENTE (defesa = 403)
//   GET  /api/dossie/mensal                               → { ligado, por, n8n:{configurado}, agenda, envios }
//   POST /api/dossie/mensal { ligado, por }               → { ok, ligado } — líder/consultor; a chave nasce DESLIGADA
import express, { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

export const ROTAS_UPLOAD = ['/api/cliente/contrato', '/api/cliente/pagamento']
export const uploadJson = express.json({ limit: '7mb' })
const HOST_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

// deps: livro (criarLivro), risco (criarRisco), contratos (criarContratos), quem() → nomes que podem registrar, clienteCanonico(nome) → nome da central ou ''
export function criarRotasDossie({ livro, risco, contratos, dossies = null, quem = () => [], clienteCanonico }) {
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

  r.get('/api/cliente/livro', trata((req, res) => {
    const q = req.query
    res.json({ ...livro.listar({ cliente: cliente(um(q.cliente)), de: um(q.de), ate: um(q.ate), tipo: um(q.tipo), pagina: um(q.pagina), por_pagina: um(q.por_pagina) }), tipos: livro.tipos })
  }))
  r.get('/api/livro/verificar', trata((req, res) => { const c = um(req.query.cliente); res.json(livro.verificarCadeia(c ? cliente(c) : '')) }))

  r.get('/api/cliente/risco', trata((req, res) => { const c = cliente(um(req.query.cliente)); res.json({ cliente: c, riscos: risco.listar(c), motivos: risco.motivos, quem: quem() }) }))
  r.post('/api/cliente/risco', trata((req, res) => {
    const b = json(req)
    res.json(risco.marcar({ cliente: cliente(b.cliente), motivo: texto(b.motivo), descricao: b.descricao, desde: texto(b.desde), por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.post('/api/cliente/risco/encerrar', trata((req, res) => {
    const b = json(req)
    res.json(risco.encerrar({ cliente: cliente(b.cliente), id: b.id, por: texto(b.por), nota: b.nota, confirmar: b.confirmar === true }))
  }))
  r.get('/api/risco', trata((req, res) => res.json({ abertos: risco.abertos(), sugestoes: risco.sugestoes(), motivos: risco.motivos, quem: quem(), ...(dossies ? { mensal: dossies.mensalEstado() } : {}) })))

  r.get('/api/cliente/contrato', trata((req, res) => { const c = cliente(um(req.query.cliente)); res.json({ cliente: c, ...contratos.ler(c), quem: quem() }) }))
  r.post('/api/cliente/contrato', trata((req, res) => {
    const b = json(req)
    res.json(contratos.salvarContrato({ cliente: cliente(b.cliente), inicio: b.inicio, fim: b.fim, canais: b.canais, entregaveis: b.entregaveis, valor_mensal_centavos: b.valor_mensal_centavos,
      obrigacao_meio: b.obrigacao_meio, clausula_reembolso: b.clausula_reembolso, arquivo: b.arquivo, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  r.post('/api/cliente/pagamento', trata((req, res) => {
    const b = json(req)
    res.json(contratos.registrarPagamento({ cliente: cliente(b.cliente), data: b.data, valor_centavos: b.valor_centavos, referencia: b.referencia, arquivo: b.arquivo, por: texto(b.por), confirmar: b.confirmar === true }))
  }))
  if (!dossies) return r
  const loopback = req => { if (!HOST_LOCAL.test(String(req.headers.host || ''))) throw erro('acesso restrito ao painel local', 403) }
  r.post('/api/cliente/dossie', trata(async (req, res) => {
    loopback(req)
    const b = json(req)
    res.json({ ok: true, dossie: await dossies.gerar({ cliente: cliente(b.cliente), versao: texto(b.versao), de: texto(b.de), ate: texto(b.ate), por: texto(b.por) }) })
  }))
  r.get('/api/cliente/dossies', trata((req, res) => { const c = cliente(um(req.query.cliente)); res.json({ cliente: c, itens: dossies.listar(c), mensal: dossies.mensalEstado(c) }) }))
  r.get('/api/dossie/:id/:formato(pdf|doc)', trata((req, res) => {
    loopback(req)
    const a = dossies.arquivo(req.params.id, req.params.formato)
    res.set({ 'Content-Type': a.mime, 'Content-Disposition': `attachment; filename="${a.nome}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.sendFile(a.abs)
  }))
  r.post('/api/dossie/:id/notion', trata(async (req, res) => { loopback(req); const b = json(req); res.json(await dossies.enviarNotion({ id: req.params.id, por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.get('/api/dossie/mensal', trata((req, res) => res.json(dossies.mensalEstado())))
  r.post('/api/dossie/mensal', trata((req, res) => { const b = json(req); res.json(dossies.chave({ ligado: b.ligado, por: texto(b.por) })) }))
  return r
}
