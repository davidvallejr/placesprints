// HTTP do cadastro do cliente (CS responsável, health score, classificação, canais informados, observações). Puro (só express): o núcleo entra por
// fábrica (src/lib/cadastro-clientes.js) — o teste usa banco em memória. Regras: corpo JSON obrigatório no POST (415); `confirmar` só vale se for
// EXATAMENTE true; `por` precisa ser líder/consultor (validado no núcleo → 403); lista fechada de campos; mensagens fixas, nunca ecoam valor recebido.
//   GET  /api/cliente/cadastro?cliente=   → { cliente, central:{…só leitura…}, cadastro:{…}, relatorio:{frequencia…}|null, classificacoes, quem }
//   POST /api/cliente/cadastro { cliente, por, campos:{cs_responsavel?, health_score?, hs_classificacao?, observacoes?, canais_cs?}, confirmar? } → prévia; confirmar:true grava
//   GET  /api/cadastro/pendencias         → { em, fonte, pendencias:[{nome, motivo, candidatos, canais}] } da última importação aplicada
import { Router } from 'express'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''           // fronteira de confiança: objeto/array nunca vira '[object Object]'
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// deps: cadastro ({ lerCadastro, salvarCadastro, pendenciasImportacao }), quem() → nomes que podem editar, clienteCanonico(nome) → nome da central ou ''
export function criarRotasCadastro({ cadastro, quem, clienteCanonico }) {
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

  r.get('/api/cliente/cadastro', trata((req, res) => res.json({ ...cadastro.lerCadastro(cliente(um(req.query.cliente))), quem: quem() })))
  r.post('/api/cliente/cadastro', trata((req, res) => {
    const b = json(req)
    res.json(cadastro.salvarCadastro({ cliente: cliente(b.cliente), por: texto(b.por), campos: b.campos, confirmar: b.confirmar === true }))
  }))
  r.get('/api/cadastro/pendencias', trata((req, res) => res.json(cadastro.pendenciasImportacao())))
  return r
}
