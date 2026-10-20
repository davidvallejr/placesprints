// HTTP do Relatório de Sprints Place2u ao Notion do cliente (contrato: docs/contrato-relatorio-envio.md, prefixo /api/relatorio).
// Puro (só express): o núcleo entra por fábrica (src/lib/relatorio-envio.js) — o teste usa banco em memória e stub do Notion.
// Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (string "true" = prévia); `por` precisa ser líder/consultor
// (validado no núcleo → 403); mensagens fixas, nunca ecoam valor recebido; prospect "[Comercial] …" é inexistente; estado de negócio impeditivo é 200 com ok:false.
import { Router } from 'express'
import { FREQUENCIAS } from './lib/relatorio-envio.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''           // fronteira de confiança: objeto/array nunca vira '[object Object]'
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: relatorios (criarRelatorioEnvio), quem() → nomes que podem enviar/liberar (equipe.lideresEConsultores),
//       clienteCanonico?(nome) → nome da central ou '' (opcional: o núcleo também resolve)
export function criarRotasRelatorio({ relatorios, quem, clienteCanonico }) {
  const r = Router()
  // erro com status = validação/regra de negócio (mensagem fixa); sem status = falha interna → handler global do server.js (500 'erro interno', detalhe só no log)
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('cliente não encontrado na central', 404)
    const canon = clienteCanonico ? clienteCanonico(c) : c
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const estrito = v => v === true                                   // "true" (string), 1, "sim" … NÃO confirmam

  r.get('/api/relatorio/clientes', trata((req, res) => res.json({ ...relatorios.listar(), quem: quem() })))
  r.get('/api/relatorio/cliente', trata((req, res) => res.json({ ...relatorios.clienteDe(cliente(um(req.query.cliente))), frequencias: FREQUENCIAS, quem: quem() })))

  // { cliente, por, confirmar?, previa_id?, substituir?, sem_categoria?, confirmar_destino? } — sem confirmar:true é prévia (só leitura); origem é SEMPRE manual aqui
  r.post('/api/relatorio/enviar', trata(async (req, res) => {
    const b = json(req)
    res.json(await relatorios.enviar(cliente(b.cliente), { origem: 'manual', por: texto(b.por), confirmar: estrito(b.confirmar), previa_id: texto(b.previa_id),
      substituir: estrito(b.substituir), sem_categoria: estrito(b.sem_categoria), confirmar_destino: estrito(b.confirmar_destino) }))
  }))
  // { clientes[1..40], por, confirmar? } — prévia lista a ação por cliente; confirmar cria o job (sequencial, runner próprio)
  r.post('/api/relatorio/lote', trata(async (req, res) => { const b = json(req); res.json(await relatorios.lote({ clientes: b.clientes, por: texto(b.por), confirmar: estrito(b.confirmar) })) }))
  r.get('/api/relatorio/job/:id', trata((req, res) => { const j = relatorios.jobDe(String(req.params.id || '').slice(0, 60)); j ? res.json(j) : res.status(404).json({ erro: 'job não encontrado' }) }))

  // { cliente, frequencia, proximo_envio?, por, confirmar? } — proximo_envio ausente = próxima sexta; presente e que não seja texto (número, objeto, lista, null, false) = 400, nunca ignorado em silêncio
  r.post('/api/relatorio/programacao', trata((req, res) => {
    const b = json(req), c = cliente(b.cliente)
    if (b.proximo_envio !== undefined && typeof b.proximo_envio !== 'string') throw erro('data inválida (use AAAA-MM-DD, entre hoje e 60 dias)')
    res.json(relatorios.programar({ cliente: c, frequencia: texto(b.frequencia), proximo_envio: b.proximo_envio === undefined ? undefined : b.proximo_envio.trim(), por: texto(b.por), confirmar: estrito(b.confirmar) }))
  }))
  r.post('/api/relatorio/frequencia-lote', trata((req, res) => { const b = json(req); res.json(relatorios.frequenciaEmLote({ clientes: b.clientes, frequencia: texto(b.frequencia), por: texto(b.por), confirmar: estrito(b.confirmar) })) }))
  // { clientes?[], por, confirmar? } — omitido = todos os prontos; só libera quem tem diagnóstico "pronto"
  r.post('/api/relatorio/liberar', trata((req, res) => { const b = json(req); res.json(relatorios.liberar({ clientes: b.clientes, por: texto(b.por), confirmar: estrito(b.confirmar) })) }))

  // documento (PDF) num envio já feito: { cliente, de, ate, por, confirmar? } — prévia diz o que faria; confirmar gera o PDF do brief de hoje (mesma janela) e anexa à página
  r.post('/api/relatorio/anexar', trata(async (req, res) => { const b = json(req); res.json(await relatorios.anexar({ cliente: cliente(b.cliente), de: texto(b.de), ate: texto(b.ate), por: texto(b.por), confirmar: estrito(b.confirmar) })) }))
  // { desde, por, confirmar? } — todos os envios vivos sem documento desde a data; confirmar cria o job (acompanhe em /job/:id)
  r.post('/api/relatorio/anexar-lote', trata((req, res) => { const b = json(req); res.json(relatorios.anexarLote({ desde: texto(b.desde), por: texto(b.por), confirmar: estrito(b.confirmar) })) }))

  // diagnóstico das bases (somente leitura no Notion)
  r.post('/api/relatorio/diagnostico/verificar', trata((req, res) => { const b = json(req); res.json({ ok: true, job: relatorios.diagnosticar({ clientes: b.clientes }) }) }))
  r.get('/api/relatorio/diagnostico', trata((req, res) => res.json(relatorios.diagnostico())))
  r.get('/api/relatorio/diagnostico.csv', trata((req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="diagnostico-relatorios.csv"')
    res.send(relatorios.diagnosticoCsv())
  }))

  // interruptor geral do agendador (nasce desligado; é o freio de emergência, sem reiniciar o servidor)
  r.get('/api/relatorio/agendador', trata((req, res) => res.json(relatorios.agendadorEstado())))
  r.post('/api/relatorio/agendador', trata((req, res) => { const b = json(req); res.json(relatorios.agendador({ ligado: b.ligado, por: texto(b.por) })) }))
  return r
}
