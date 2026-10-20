// HTTP do console de execução do Chaveiro (F4+ — src/lib/chaveiro-executor(-real).js). Loopback (guarda-local).
// Regras: cliente canônico da central, senão 404; prospect «[Comercial] …» = 400; corpo JSON nos POST (415); PRÉVIA por padrão — só age com confirmar === true;
// `por` validado no núcleo (líder do cliente para aprovar/executar/reverter/liberar; líder, consultor ou CS para preparar); mensagens fixas, sem eco do valor recebido.
// As ÚNICAS rotas que podem escrever no ML são /executar, /executar-lote e /reverter, e só depois de TODAS as travas (chave global, chave da operação, kill switch,
// liberação do cliente, estreia, teto, confirmar === true, hash, releitura ao vivo).
//   GET  /api/chaveiro/exec/painel?cliente=               → chave, kill switch, operações (liberação, estreia, Neo), estratégias, ordens, eventos
//   GET  /api/chaveiro/exec/anuncios?cliente=&q=           → anúncios do cliente (cache) com fotos e fotografias «como era»
//   GET  /api/chaveiro/exec/preset?cliente=&acao=          → console preenchido a partir de uma ação do plano (botão «Executar pelo Chaveiro»)
//   GET  /api/chaveiro/exec/marco?cliente=&ordem=          → medida do Merovíngio na data da conferência
//   POST /api/chaveiro/exec/previa    { cliente, itens[], operacao+params | estrategia+valores, acao_id? }   → diff por anúncio (só cache, nada escrito)
//   POST /api/chaveiro/exec/preparar  { …, por, confirmar }  → prévia | ordens aguardando aprovação (relê ao vivo, só GET)
//   POST /api/chaveiro/exec/aprovar   { cliente, ordens[], por } · /cancelar { cliente, ordens[], por }
//   POST /api/chaveiro/exec/executar  { cliente, ordem, por, confirmar } · /executar-lote { cliente, ordens[], por, confirmar } · /reverter { cliente, ordem, por, confirmar }
//   POST /api/chaveiro/exec/conferir  { cliente } (só leitura) · /feito { cliente, ordem, por } (assistido)
//   POST /api/chaveiro/exec/liberar   { cliente, operacao, por, cliente_informado, estreia_item, confirmar } · /revogar · /vetar { cliente, operacao, por, confirmar }
//   POST /api/chaveiro/exec/parar     { por, confirmar } · /retomar { por, confirmar }   (kill switch: para F4+ e o sincronismo de estoque F6)
//   POST /api/chaveiro/exec/estrategia { nome, objetivo, parametros, passos[], precondicoes[], kpi, janela_dias, por, confirmar } · /estrategia/desativar { id, por }
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => (typeof v === 'string' ? v.trim() : '')
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const ORDEM = /^CH-[0-9a-f]{10}$/

// deps: exec = módulo chaveiro-executor-real (ou stub nos testes) · clienteCanonico(nome) → nome | '' · validarPor(nome, cliente) → nome | ''
export function criarRotasChaveiroExecutor({ exec, clienteCanonico, validarPor = () => '' }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (ehProspecto(c)) throw erro('prospect do comercial não é cliente: sem execução')
    const canon = c ? clienteCanonico(c) : ''
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const ordem = v => { const o = texto(v); if (!ORDEM.test(o)) throw erro('informe a ordem (CH-…)'); return o }
  const pedido = b => ({ itens: Array.isArray(b.itens) ? b.itens.slice(0, 50) : [], operacao: texto(b.operacao), params: b.params && typeof b.params === 'object' && !Array.isArray(b.params) ? b.params : {},
    estrategia: texto(b.estrategia), valores: b.valores && typeof b.valores === 'object' && !Array.isArray(b.valores) ? b.valores : {}, acao_id: texto(b.acao_id) })
  r.get('/api/chaveiro/exec/painel', trata((req, res) => res.json(exec.painel(cliente(um(req.query.cliente))))))
  r.get('/api/chaveiro/exec/anuncios', trata((req, res) => res.json(exec.anuncios(cliente(um(req.query.cliente)), { q: um(req.query.q) }))))
  r.get('/api/chaveiro/exec/preset', trata((req, res) => res.json(exec.presetDaAcao(cliente(um(req.query.cliente)), um(req.query.acao)))))
  r.get('/api/chaveiro/exec/marco', trata(async (req, res) => res.json(await exec.marco(cliente(um(req.query.cliente)), ordem(um(req.query.ordem))))))
  r.post('/api/chaveiro/exec/previa', trata(async (req, res) => { const b = json(req); res.json(await exec.previa(cliente(b.cliente), pedido(b))) }))
  r.post('/api/chaveiro/exec/preparar', trata(async (req, res) => { const b = json(req); res.json(await exec.preparar(cliente(b.cliente), pedido(b), { por: texto(b.por), confirmar: b.confirmar === true, validarPor })) }))
  r.post('/api/chaveiro/exec/aprovar', trata((req, res) => { const b = json(req); res.json(exec.aprovar(cliente(b.cliente), { ordens: b.ordens, por: texto(b.por) })) }))
  r.post('/api/chaveiro/exec/cancelar', trata((req, res) => { const b = json(req); res.json(exec.cancelar(cliente(b.cliente), { ordens: b.ordens, por: texto(b.por) })) }))
  // confirmar repassado CRU: só o booleano true passa nas travas
  r.post('/api/chaveiro/exec/executar', trata(async (req, res) => { const b = json(req), c = cliente(b.cliente); res.json(await exec.executarOrdem(c, ordem(b.ordem), { por: texto(b.por), confirmar: b.confirmar })) }))
  r.post('/api/chaveiro/exec/executar-lote', trata(async (req, res) => { const b = json(req), c = cliente(b.cliente); res.json(await exec.executarLote(c, { ordens: b.ordens, por: texto(b.por), confirmar: b.confirmar })) }))
  r.post('/api/chaveiro/exec/reverter', trata(async (req, res) => { const b = json(req), c = cliente(b.cliente); res.json(await exec.reverter(c, ordem(b.ordem), { por: texto(b.por), confirmar: b.confirmar })) }))
  r.post('/api/chaveiro/exec/conferir', trata(async (req, res) => res.json(await exec.conferirOrdens({ cliente: cliente(json(req).cliente), forcar: true }))))
  r.post('/api/chaveiro/exec/feito', trata((req, res) => { const b = json(req); res.json(exec.marcarFeito(cliente(b.cliente), ordem(b.ordem), { por: texto(b.por) })) }))
  r.post('/api/chaveiro/exec/liberar', trata((req, res) => { const b = json(req); res.json(exec.liberar(cliente(b.cliente), { operacao: texto(b.operacao), por: texto(b.por), cliente_informado: b.cliente_informado === true, estreia_item: texto(b.estreia_item), confirmar: b.confirmar === true })) }))
  r.post('/api/chaveiro/exec/revogar', trata((req, res) => { const b = json(req); res.json(exec.revogar(cliente(b.cliente), { operacao: texto(b.operacao), por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.post('/api/chaveiro/exec/vetar', trata((req, res) => { const b = json(req); res.json(exec.vetar(cliente(b.cliente), { operacao: texto(b.operacao), por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.post('/api/chaveiro/exec/parar', trata((req, res) => { const b = json(req); res.json(exec.pararTudo({ por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.post('/api/chaveiro/exec/retomar', trata((req, res) => { const b = json(req); res.json(exec.retomar({ por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.post('/api/chaveiro/exec/estrategia', trata((req, res) => { const b = json(req); res.json(exec.salvarEstrategia({ nome: b.nome, objetivo: b.objetivo, parametros: b.parametros, passos: b.passos, precondicoes: b.precondicoes, kpi: b.kpi, janela_dias: b.janela_dias }, { por: texto(b.por), confirmar: b.confirmar === true })) }))
  r.post('/api/chaveiro/exec/estrategia/desativar', trata((req, res) => { const b = json(req); res.json(exec.desativarEstrategia(texto(b.id), { por: texto(b.por) })) }))
  return r
}
