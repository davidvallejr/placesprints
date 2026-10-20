// HTTP do perfil do cliente e do Relatório Semanal v2: o parse de ?perfil=/?interno= e a API /api/cliente/perfil.
// Puro (só express): as dependências com banco entram por fábrica, então o teste usa stubs
// (scripts/teste-semanal-rotas.mjs) e nunca abre o banco real. A regra de negócio mora em lib/perfil-cliente.js.
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''            // número/objeto no corpo não vira texto "válido"
const um = v => String([].concat(v ?? '')[0] ?? '').trim()          // ?x=a&x=b chega como array: vale o primeiro

// "direto,tecnico" | ['direto','tecnico'] -> ids únicos, na ordem (o 1º é o primário); `invalidos` = fora da config
export function idsPerfil(bruto, validos) {
  const ids = [...new Set([].concat(bruto ?? []).flatMap(s => String(s).split(',')).map(s => s.trim()).filter(Boolean))]
  return { ids, invalidos: ids.filter(i => !validos.includes(i)) }
}

// Query de /semanal (e /semanal.pdf, e a CLI) -> argumentos de montarSemanal. Sem ?interno é SEMPRE a versão do cliente.
// A mensagem de erro não repete o valor recebido (ela volta dentro de HTML).
export function opcoesSemanal(q, validos) {
  const { ids, invalidos } = idsPerfil(q.perfil, validos)
  if (invalidos.length) throw erro(`perfil desconhecido — válidos: ${validos.join(', ')}`)
  return { cliente: um(q.cliente), de: um(q.de), ate: um(q.ate), interno: ['1', 'true'].includes(um(q.interno)), perfil: ids.length ? ids : undefined }
}

// deps: { perfilDoCliente, salvarPerfil, listarPerfis, listarObjetivos } de lib/perfil-cliente.js,
//       clienteCanonico(nome) -> nome oficial na central | null e
//       coletaPromocoesPadrao() -> true|false (config/promocoes.json coleta_para_todos) | null quando ninguém informa — a tela diz o que "padrão da base" significa hoje
export function criarRotasPerfil({ perfilDoCliente, salvarPerfil, listarPerfis, listarObjetivos, clienteCanonico, coletaPromocoesPadrao = () => null }) {
  const r = Router()
  const trata = fn => async (req, res) => {
    try { await fn(req, res) } catch (e) { res.status(e.status || 400).json({ erro: e.message }) }
  }

  // perfil efetivo + o que a tela precisa para montar os seletores (rótulos e descrições vêm da config, não da UI)
  r.get('/api/cliente/perfil', trata(async (req, res) => {
    const nome = um(req.query.cliente)
    if (!nome) throw erro('informe "cliente"')
    const cliente = clienteCanonico(nome)
    if (!cliente) throw erro('cliente não encontrado na central', 404)
    res.json({ perfil: await perfilDoCliente(cliente), perfis: listarPerfis(), objetivos: listarObjetivos(), coleta_promocoes_padrao: coletaPromocoesPadrao() ?? null })
  }))

  // mutação lê SÓ o corpo JSON (a query é ignorada); o guard global já barra Origin diferente do Host
  r.post('/api/cliente/perfil', trata(async (req, res) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || ''))
      throw erro('envie o corpo como JSON (Content-Type: application/json)', 415)
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    const nome = texto(b.cliente)
    if (!nome) throw erro('informe "cliente"')
    const por = texto(b.por).slice(0, 80)
    if (!por) throw erro('informe "por" (seu nome — fica registrado junto do perfil)')
    const validosP = listarPerfis().map(p => p.id), validosO = listarObjetivos().map(o => o.id)
    const perfis = [...new Set(Array.isArray(b.perfis) ? b.perfis : [])]
    if (!perfis.length) throw erro('informe "perfis": ao menos um id (o primeiro é o primário)')
    if (!perfis.every(i => validosP.includes(i))) throw erro(`"perfis" tem id desconhecido — válidos: ${validosP.join(', ')}`)
    if (!validosO.includes(b.objetivo)) throw erro(`"objetivo" deve ser um de: ${validosO.join(', ')}`)
    const cliente = clienteCanonico(nome)
    if (!cliente) throw erro('cliente não encontrado na central', 404)
    // liga/desliga (true/false/null; ausente = mantém): lista de tarefas no relatório e coleta de promoções do ML
    const flags = {}
    for (const k of ['tarefas_no_relatorio', 'coleta_promocoes']) {
      if (b[k] === undefined) continue
      if (b[k] !== null && typeof b[k] !== 'boolean') throw erro(`"${k}" deve ser true, false ou null`)
      flags[k] = b[k]
    }
    res.json({ ok: true, perfil: await salvarPerfil({ cliente, perfis, objetivo: b.objetivo, por, ...flags }) })
  }))

  return r
}
