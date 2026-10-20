// Equipe, squads e escopo (seleção / consultor / squad / total).
// Fonte: central de clientes do Notion (texto livre por canal) + config/equipe.json.
// Regra de segurança herdada do resto do sistema: NUNCA casar pessoas por similaridade solta —
// só alias explícito ou um nome ser prefixo de palavras do outro (≥ 2 palavras), e ambíguo = não casa.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, agora } from './db.js'
import { ROOT } from './env.js'
import { clientesAtivos } from './descobrir.js'

export const equipeCfg = JSON.parse(readFileSync(join(ROOT, 'config', 'equipe.json'), 'utf-8'))
export const CANAIS = { ML: 'Mercado Livre', SHO: 'Shopee', AMZ: 'Amazon', TTK: 'TikTok Shop', Legacy: 'Legacy' }
const ORDEM_CANAIS = ['ML', 'SHO', 'AMZ', 'TTK', 'Legacy']

export const normNome = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim()

// ── usuários do Notion (id↔nome) ──────────────────────────────────────────
export function guardarUsuarios(pessoas) {
  const up = db.prepare(`INSERT INTO usuarios_notion (id, nome, nome_norm, vistas, visto_em) VALUES (?,?,?,1,?)
    ON CONFLICT(id) DO UPDATE SET nome = excluded.nome, nome_norm = excluded.nome_norm, vistas = vistas + 1, visto_em = excluded.visto_em`)
  const t = agora()
  db.transaction(() => { for (const p of pessoas || []) if (p?.id && p?.nome) up.run(p.id, p.nome, normNome(p.nome), t) })()
}

// id do usuário pelo nome canônico: override do config > colhido (o mais visto, se houver duplicata)
export function idDoUsuario(nomeCanonico) {
  const n = normNome(nomeCanonico)
  if (!n) return null
  for (const [nome, id] of Object.entries(equipeCfg.usuarios_notion || {})) if (nome !== '$comentario' && normNome(nome) === n) return id
  return db.prepare('SELECT id FROM usuarios_notion WHERE nome_norm = ? ORDER BY vistas DESC LIMIT 1').get(n)?.id || null
}

// ── resolvedor de nomes de pessoas ─────────────────────────────────────────
const prefixoDePalavras = (a, b) => {                       // a é prefixo de palavras de b (a ≥ 2 palavras)
  const ta = a.split(' '), tb = b.split(' ')
  return ta.length >= 2 && ta.length <= tb.length && ta.every((p, i) => p === tb[i])
}

export function criarResolvedor(nomesCrus) {
  const aliases = new Map(Object.entries(equipeCfg.aliases || {}).filter(([k]) => k !== '$comentario').map(([k, v]) => [normNome(k), v]))
  const colhidos = db.prepare('SELECT nome FROM usuarios_notion').all().map(r => r.nome)
  // universo de nomes depois dos aliases; canônico preferido = nome que existe como usuário do Notion
  const universo = new Map()                                  // norm → nome exibível
  for (const nome of [...nomesCrus, ...colhidos, ...aliases.values()]) {
    const final = aliases.get(normNome(nome)) || nome
    const n = normNome(final)
    if (n && !universo.has(n)) universo.set(n, String(final).replace(/\s+/g, ' ').trim())
  }
  const ehUsuario = new Set(colhidos.map(normNome))
  const lista = [...universo.keys()]
  const canonicoDe = n => {
    // só expande prefixo → extensão ÚNICA; duas extensões possíveis = ambíguo = não casa
    // (ex.: "Ana Paula" com "Ana Paula Souza" E "Ana Paula Lima" fica como está)
    const extensoes = lista.filter(o => o !== n && prefixoDePalavras(n, o))
    if (extensoes.length !== 1) return n
    const e = extensoes[0]
    return ehUsuario.has(n) && !ehUsuario.has(e) ? n : e
  }
  return nomeCru => {
    if (!nomeCru) return ''
    const alias = aliases.get(normNome(nomeCru))
    const n = normNome(alias || nomeCru)
    return n ? (universo.get(canonicoDe(n)) || universo.get(n) || String(alias || nomeCru).trim()) : ''
  }
}

// ── central → tabela clientes_central ──────────────────────────────────────
export async function sincronizarEquipe() {
  const clientes = await clientesAtivos()
  const up = db.prepare(`INSERT INTO clientes_central (cliente, status_cs, tier, nicho, canais_json, consultores_json, lideres_json, cnpj, cpf, responsavel, vencimentos_json, atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cliente) DO UPDATE SET status_cs=excluded.status_cs, tier=excluded.tier, nicho=excluded.nicho,
    canais_json=excluded.canais_json, consultores_json=excluded.consultores_json, lideres_json=excluded.lideres_json,
    cnpj=excluded.cnpj, cpf=excluded.cpf, responsavel=excluded.responsavel, vencimentos_json=excluded.vencimentos_json, atualizado_em=excluded.atualizado_em`)
  const t = agora()
  db.transaction(() => {
    for (const c of clientes) {
      const x = c.central
      up.run(c.nome, x.status, x.tier, x.nicho, JSON.stringify(x.canais), JSON.stringify(x.consultores), JSON.stringify(x.lideres), x.cnpj || '', x.cpf || '', x.responsavel || '', JSON.stringify(x.vencimentos || {}), t)
      guardarUsuarios(x.pessoas)
    }
    // poda: quem saiu da central (desmarcado "Ativo?") não pode continuar elegível com dados velhos
    if (clientes.length)
      db.prepare(`DELETE FROM clientes_central WHERE cliente NOT IN (${clientes.map(() => '?').join(',')})`).run(...clientes.map(c => c.nome))
  })()
  return clientes.length
}

// ── leitura enriquecida: nomes canônicos, principal, squads ────────────────
const squadNome = lider => `Squad ${lider}`

export function carregarClientes() {
  const rows = db.prepare('SELECT * FROM clientes_central ORDER BY cliente').all()
  const crus = []
  for (const r of rows) for (const k of ['consultores_json', 'lideres_json']) crus.push(...Object.values(JSON.parse(r[k])))
  const canon = criarResolvedor(crus)
  const squadsCfg = Object.entries(equipeCfg.squads || {}).filter(([k, v]) => k !== '$comentario' && v && typeof v === 'object')
  return rows.map(r => {
    const cons = {}, lids = {}
    for (const [k, v] of Object.entries(JSON.parse(r.consultores_json))) cons[k] = canon(v)
    for (const [k, v] of Object.entries(JSON.parse(r.lideres_json))) lids[k] = canon(v)
    const canais = ORDEM_CANAIS.filter(k => JSON.parse(r.canais_json).includes(k))
    const freq = {}
    for (const k of ORDEM_CANAIS) if (cons[k]) freq[cons[k]] = (freq[cons[k]] || 0) + 1
    const principal = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
    const squadDoCanal = k => {
      const l = lids[k], c = cons[k]
      const cfg = squadsCfg.find(([, d]) => (d.lider && canon(d.lider) === l) || (d.consultores || []).some(x => canon(x) === c))
      return cfg ? cfg[0] : (l ? squadNome(l) : '')
    }
    const squads = [...new Set(ORDEM_CANAIS.map(squadDoCanal).filter(Boolean))]
    const lidPrincipal = Object.entries(lids).sort((a, b) => ORDEM_CANAIS.indexOf(a[0]) - ORDEM_CANAIS.indexOf(b[0]))[0]?.[1] || ''
    return {
      cliente: r.cliente, status: r.status_cs, tier: r.tier, nicho: r.nicho, canais,
      cnpj: r.cnpj || '', cpf: r.cpf || '', contato: r.responsavel || '', vencimentos: JSON.parse(r.vencimentos_json || '{}'),
      consultores: cons, lideres: lids, principal, squads,
      cs_responsavel: r.cs_responsavel || '', health_score: r.health_score ?? null, hs_classificacao: r.hs_classificacao || '',   // cadastro (planilha/manual) — só leitura aqui
      squadPrincipal: squads[0] || (lidPrincipal ? squadNome(lidPrincipal) : ''),
      squadDoCanal,
      responsavelDoCanal: k => cons[k] || principal || '',
    }
  })
}

// quem pode encerrar tarefa por dependência do cliente: consultores ∪ líderes de TODOS os clientes da central (não só elegíveis)
// ∪ prestadores ativos com cargo de liderança/consultoria. Restrição de produto (não há login), não segurança.
const RX_CARGO_LIDER = /consultor|l[ií]der|coordena|gerente|diretor|ceo/i
// dono(s) da Place2u (config/equipe.json → donos): passam em toda validação de «quem pode» (15/10/2026)
export const donos = () => (equipeCfg.donos || []).filter(Boolean)
export const ehDono = nome => { const n = normNome(nome); return n ? donos().find(d => normNome(d) === n) || '' : '' }
export function lideresEConsultores() {
  const nomes = new Set(donos())
  for (const c of carregarClientes()) for (const n of [...Object.values(c.consultores), ...Object.values(c.lideres)]) if (n) nomes.add(n)
  const canon = criarResolvedor([...nomes])                     // o mesmo resolvedor de carregarClientes: prestador que é extensão única do nome da central cai no mesmo nome
  for (const p of db.prepare('SELECT nome, cargo FROM prestadores').all()) if (RX_CARGO_LIDER.test(p.cargo)) nomes.add(canon(p.nome))
  return [...nomes].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
export const validarLiderOuConsultor = nome => {               // nome canônico ou '' (sem acento/caixa, como ficha-nucleo.nomeOficial)
  const n = normNome(nome)
  return n ? lideresEConsultores().find(x => normNome(x) === n) || '' : ''
}

// clientes que podem receber plano: central ativa (fora dos excluídos) E com base de tarefas já sincronizada
export function clientesElegiveis() {
  const comBase = new Set(db.prepare('SELECT DISTINCT cliente FROM tarefas WHERE arquivada = 0').all().map(r => r.cliente))
  const excl = new Set((equipeCfg.status_cliente_excluidos || []).map(normNome))
  const todos = carregarClientes()
  return {
    elegiveis: todos.filter(c => comBase.has(c.cliente) && !excl.has(normNome(c.status))),
    ignorados: todos.filter(c => !comBase.has(c.cliente) || excl.has(normNome(c.status)))
      .map(c => ({ cliente: c.cliente, motivo: excl.has(normNome(c.status)) ? `status "${c.status}"` : 'sem tarefa sincronizada na base local (base não localizada ou sync pendente)' })),
  }
}

export function listarEquipe() {
  const { elegiveis } = clientesElegiveis()
  const consultores = new Map(), squads = new Map()
  for (const c of elegiveis) {
    const nomes = new Set([...Object.values(c.consultores), c.principal].filter(Boolean))
    for (const n of nomes) { const x = consultores.get(n) || { nome: n, clientes: 0 }; x.clientes++; consultores.set(n, x) }
    for (const s of c.squads) { const x = squads.get(s) || { nome: s, clientes: 0, consultores: new Set() }; x.clientes++; nomes.forEach(n => x.consultores.add(n)); squads.set(s, x) }
  }
  return {
    consultores: [...consultores.values()].sort((a, b) => b.clientes - a.clientes),
    squads: [...squads.values()].map(s => ({ ...s, consultores: [...s.consultores].sort() })).sort((a, b) => b.clientes - a.clientes),
    clientes: elegiveis.map(c => ({ cliente: c.cliente, tier: c.tier, nicho: c.nicho, canais: c.canais, consultor: c.principal, squad: c.squadPrincipal })),
  }
}

// ── escopo: seleção | consultor | squad | total ────────────────────────────
export function resolverEscopo({ tipo = 'total', clientes = [], consultor = '', squad = '' } = {}) {
  const { elegiveis, ignorados } = clientesElegiveis()
  let alvo = elegiveis, erro = ''
  if (tipo === 'selecao') {
    const pedidos = new Set(clientes.map(normNome))
    alvo = elegiveis.filter(c => pedidos.has(normNome(c.cliente)))
    const achados = new Set(alvo.map(c => normNome(c.cliente)))
    const faltou = clientes.filter(n => !achados.has(normNome(n)))
    if (faltou.length) erro = `não elegíveis/inexistentes: ${faltou.join(', ')}`
  } else if (tipo === 'consultor') {
    const n = normNome(consultor)
    if (!n) { erro = 'informe o consultor'; alvo = [] }   // vazio casaria todos os clientes SEM consultor
    else alvo = elegiveis.filter(c => Object.values(c.consultores).some(x => normNome(x) === n) || normNome(c.principal) === n)
  } else if (tipo === 'squad') {
    if (!squad) { erro = 'informe o squad'; alvo = [] }
    else alvo = elegiveis.filter(c => c.squads.includes(squad))
  } else if (tipo !== 'total') erro = `tipo de escopo inválido: ${tipo}`
  return { tipo, consultor, squad, clientes: alvo.map(c => c.cliente), registros: alvo, erro, ignorados }
}
