// HTTP dos alinhamentos com o cliente (exceções intencionais; src/lib/alinhamentos.js). Puro (só express): o núcleo entra por fábrica — o teste usa banco em memória.
// Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true (string "true" = prévia); `por` precisa ser líder/consultor (validado no núcleo → 403);
// mensagens fixas, nunca ecoam valor recebido; prospect "[Comercial] …" é inexistente (404).
//   GET  /api/cliente/alinhamentos?cliente=                         → { cliente, alinhamentos:[…vivos e vencidos, estado efetivo], tipos:[{id,rotulo,rotulo_cliente,permanente,acos}], revisao_dias_padrao,
//                                                                       revisao_dias_max, quem, anuncios:[{id,titulo}] (do cliente, p/ o formulário), regras:[{id,rotulo}] (p/ escopo conta) }
//   GET  /api/alinhamentos/tipos                                    → { tipos, revisao_dias_padrao, revisao_dias_max, quem } (diálogo de descarte, inclusive em lote no /planos)
//   POST /api/cliente/alinhamentos { cliente, escopo, chave?, regras?, tipo, motivo?, acos_alvo?, revisar_em?, permanente?, por, confirmar? } → prévia; confirmar:true grava (origem 'painel')
//   POST /api/cliente/alinhamentos/encerrar { cliente, id, por }        → { ok, id, estado:'encerrado' }
//   POST /api/cliente/alinhamentos/renovar { cliente, id, por, revisar_em? } → { ok, id, estado:'vivo', revisar_em }
import { Router } from 'express'
import { ROT_REGRA } from './lib/render-diagnostico-motor.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: alinhamentos (criarAlinhamentos), quem() → nomes que podem registrar (equipe.lideresEConsultores), clienteCanonico(nome) → nome da central ou '',
//       anuncios(cliente) → [{ id, titulo }] (só leitura do banco local; ausente = lista vazia)
export function criarRotasAlinhamentos({ alinhamentos, quem, clienteCanonico, anuncios = () => [] }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message, ...(e.codigos ? { codigos: e.codigos } : {}) }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    const canon = ehProspecto(c) ? '' : clienteCanonico(c)
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  // config/alinhamentos.json inválida: o núcleo vem desligado (config null) — toda rota responde 503 com o motivo, o resto do servidor segue de pé
  const C = alinhamentos.config
  const tipos = C ? Object.entries(C.tipos).map(([id, t]) => ({ id, rotulo: t.rotulo, rotulo_cliente: t.rotulo_cliente, permanente: C.permanente_permitido.includes(id), acos: id === 'campanha_visibilidade' })) : []
  const regras = Object.entries(ROT_REGRA).map(([id, rotulo]) => ({ id, rotulo }))
  const base = () => { if (!C) throw erro(`alinhamentos indisponíveis: ${alinhamentos.indisponivel || 'config/alinhamentos.json inválido'}`, 503); return { tipos, revisao_dias_padrao: C.revisao_dias_padrao, revisao_dias_max: C.revisao_dias_max, quem: quem() } }

  r.get('/api/alinhamentos/tipos', trata((req, res) => res.json(base())))
  r.get('/api/cliente/alinhamentos', trata((req, res) => {
    const c = cliente(um(req.query.cliente))
    res.json({ cliente: c, alinhamentos: alinhamentos.listar(c), ...base(), anuncios: anuncios(c) || [], regras })
  }))
  r.post('/api/cliente/alinhamentos', trata((req, res) => {
    const b = json(req)
    res.json(alinhamentos.registrar({ cliente: cliente(b.cliente), escopo: texto(b.escopo), chave: texto(b.chave), regras: b.regras, tipo: texto(b.tipo), motivo: b.motivo,
      acos_alvo: b.acos_alvo, revisar_em: texto(b.revisar_em), permanente: b.permanente === true, por: texto(b.por), origem: 'painel', confirmar: b.confirmar === true }))
  }))
  r.post('/api/cliente/alinhamentos/encerrar', trata((req, res) => {
    const b = json(req)
    res.json(alinhamentos.encerrar({ cliente: cliente(b.cliente), id: b.id, por: texto(b.por) }))
  }))
  r.post('/api/cliente/alinhamentos/renovar', trata((req, res) => {
    const b = json(req)
    res.json(alinhamentos.renovar({ cliente: cliente(b.cliente), id: b.id, por: texto(b.por), revisar_em: texto(b.revisar_em) }))
  }))
  return r
}
