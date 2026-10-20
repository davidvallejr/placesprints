// Cadastro do cliente: campos do CS (responsável, health score, classificação, canais informados, observações) em clientes_central.
// A central continua vindo do Notion (equipe.sincronizarEquipe); este módulo NUNCA cria cliente — quem não casa vira pendência.
// Planilha "Base Clientes.xlsx" (abas "Lista Clientes" e "Relatórios") lida por python3+openpyxl; casamento de nome: exato → alias
// (config/clientes-aliases.json) → contenção por palavra inteira com ≥ 4 caracteres e candidato único; ambíguo = pendência.
// Contrato HTTP e regras em docs/cadastro-clientes.md.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { db, agora, hojeLocal, getEstado, setEstado } from './db.js'
import { ROOT } from './env.js'
import { validarLiderOuConsultor } from './equipe.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
export const CLASSIFICACOES = ['Saudável', 'Atenção', 'Risco', 'Dados insuficientes', 'Sem HS']
const GRAVIDADE = ['Risco', 'Atenção', 'Saudável', 'Dados insuficientes', 'Sem HS']   // ponytail: cliente com vários canais fica com a classificação mais grave (premissa declarada no doc)
export const CAMPOS = ['cs_responsavel', 'health_score', 'hs_classificacao', 'observacoes', 'canais_cs']   // lista fechada do POST
const CHAVE_PEND = 'cadastro:pendencias'

// ── normalização e casamento ──────────────────────────────────────────────────────────────────────────────────────────────
export const normalizar = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function lerAliases(caminho = join(ROOT, 'config', 'clientes-aliases.json')) {
  let j = {}
  try { j = JSON.parse(readFileSync(caminho, 'utf-8')) } catch { /* sem arquivo = sem alias */ }
  return new Map(Object.entries(j).filter(([k]) => k !== '$comentario').map(([k, v]) => [normalizar(k), String(v)]))
}

// nomesCentral: nomes exatos da central. Devolve { cliente, via: 'exato'|'alias'|'contem' } | { ambiguo: [...] } | null
export function casar(nome, nomesCentral, aliases = new Map()) {
  const n = normalizar(nome)
  if (!n) return null
  const porNorm = new Map(nomesCentral.map(c => [normalizar(c), c]))
  if (porNorm.has(n)) return { cliente: porNorm.get(n), via: 'exato' }
  const alvo = aliases.get(n)
  if (alvo && porNorm.has(normalizar(alvo))) return { cliente: porNorm.get(normalizar(alvo)), via: 'alias' }
  if (n.length < 4) return null
  const contem = (a, b) => b.length >= 4 && new RegExp(`(^| )${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(a)
  const cands = [...porNorm.entries()].filter(([c]) => contem(n, c) || contem(c, n)).map(([, nome]) => nome)
  if (cands.length === 1) return { cliente: cands[0], via: 'contem' }
  return cands.length ? { ambiguo: cands } : null
}

// ── planilha ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PY = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True, read_only=True)
out = {}
for ws in wb:
    linhas = [[c for c in r] for r in ws.iter_rows(values_only=True)]
    out[ws.title] = [[('' if v is None else v) for v in r] for r in linhas if any(v not in (None, '') for v in r)]
print(json.dumps(out, ensure_ascii=False, default=str))
`
export function lerPlanilha(caminho) {
  const saida = execFileSync('python3', ['-c', PY, caminho], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(saida)
}
const num = v => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const t = str(String(v ?? '')).replace(',', '.'); return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null }   // '—', '' → null, nunca 0
const vazio = v => { const t = str(String(v ?? '')); return !t || t === '—' || t === '-' }
const classe = v => CLASSIFICACOES.find(c => normalizar(c) === normalizar(v)) || ''

// abas → linhas por cliente (nome da planilha): { nome, canais:[{canal, cs, hs, classificacao}], relatorio:{frequencia, canais}|null }
export function interpretar(abas) {
  const lista = abas['Lista Clientes'] || [], rel = abas['Relatórios'] || []
  const porNome = new Map()
  const cab = (lista[0] || []).map(normalizar)
  const col = (rotulo, fallback) => { const i = cab.findIndex(c => c.startsWith(normalizar(rotulo))); return i >= 0 ? i : fallback }
  const iN = col('cliente', 0), iC = col('canal', 1), iCS = col('cs', 2), iHS = col('health', 3), iCl = col('classifica', 4)
  for (const r of lista.slice(1)) {
    const nome = str(String(r[iN] ?? '')); if (!nome) continue
    const e = porNome.get(nome) || { nome, canais: [], relatorio: null }
    e.canais.push({ canal: vazio(r[iC]) ? '' : str(String(r[iC])), cs: vazio(r[iCS]) ? '' : str(String(r[iCS])), hs: num(r[iHS]), classificacao: classe(r[iCl]) })
    porNome.set(nome, e)
  }
  for (const r of rel.slice(1)) {
    const nome = str(String(r[0] ?? '')); if (!nome) continue
    const e = porNome.get(nome) || { nome, canais: [], relatorio: null }
    e.relatorio = { canais: str(String(r[1] ?? '')), frequencia: str(String(r[2] ?? '')), hs: num(r[3]) }
    porNome.set(nome, e)
  }
  return [...porNome.values()]
}

// consolidação por cliente: HS = média simples dos canais com número (1 casa); classificação = a mais grave; CS = nomes distintos unidos por " / "
export function consolidar(e) {
  const hs = e.canais.map(c => c.hs).filter(v => v != null)
  const cls = e.canais.map(c => c.classificacao).filter(Boolean).sort((a, b) => GRAVIDADE.indexOf(a) - GRAVIDADE.indexOf(b))
  return {
    cs_responsavel: [...new Set(e.canais.map(c => c.cs).filter(Boolean))].join(' / '),
    health_score: hs.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length * 10) / 10 : null,
    hs_classificacao: cls[0] || (e.canais.length ? 'Sem HS' : ''),
    canais_cs: e.canais.filter(c => c.canal),
  }
}

// ── leitura/escrita na central ────────────────────────────────────────────────────────────────────────────────────────────
const nomesCentral = () => db.prepare('SELECT cliente FROM clientes_central ORDER BY cliente').all().map(r => r.cliente)
const SEL = db.prepare('SELECT * FROM clientes_central WHERE cliente = ?')
const UPD = db.prepare(`UPDATE clientes_central SET cs_responsavel = ?, health_score = ?, hs_classificacao = ?, hs_em = ?, canais_cs_json = ?, cadastro_fonte = ?, observacoes = ? WHERE cliente = ?`)
const parseJson = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }

export function lerCadastro(cliente) {
  const r = SEL.get(cliente)
  if (!r) throw erro('cliente não encontrado na central', 404)
  const prog = db.prepare('SELECT frequencia, proximo_envio, ativado_por, pausado_motivo FROM relatorio_programacao WHERE cliente = ?').get(cliente) || null   // só leitura (relatorio-envio.js é dono)
  return {
    cliente: r.cliente,
    central: { status: r.status_cs, tier: r.tier, nicho: r.nicho, canais: parseJson(r.canais_json, []), consultores: parseJson(r.consultores_json, {}), lideres: parseJson(r.lideres_json, {}),
      cnpj: r.cnpj || '', cpf: r.cpf || '', responsavel: r.responsavel || '', vencimentos: parseJson(r.vencimentos_json, {}), atualizado_em: r.atualizado_em },
    cadastro: { cs_responsavel: r.cs_responsavel || '', health_score: r.health_score ?? null, hs_classificacao: r.hs_classificacao || '', hs_em: r.hs_em || '',
      canais_cs: parseJson(r.canais_cs_json, []), cadastro_fonte: r.cadastro_fonte || '', observacoes: r.observacoes || '' },
    relatorio: prog,
    classificacoes: CLASSIFICACOES,
  }
}

// valida e normaliza os campos editáveis (lista fechada; '—'/'' em número = null; nunca 0 no lugar de null)
function validarCampos(campos) {
  if (!campos || typeof campos !== 'object' || Array.isArray(campos)) throw erro('informe "campos" como objeto')
  const extra = Object.keys(campos).filter(k => !CAMPOS.includes(k))
  if (extra.length) throw erro('campo fora da lista permitida')
  const out = {}
  if ('cs_responsavel' in campos) { if (typeof campos.cs_responsavel !== 'string') throw erro('"cs_responsavel" deve ser texto'); out.cs_responsavel = campos.cs_responsavel.trim().slice(0, 120) }
  if ('observacoes' in campos) { if (typeof campos.observacoes !== 'string') throw erro('"observacoes" deve ser texto'); out.observacoes = campos.observacoes.trim().slice(0, 4000) }
  if ('health_score' in campos) {
    const v = campos.health_score
    if (v === null || v === '' || v === '—') out.health_score = null
    else { const n = typeof v === 'number' ? v : num(v); if (n == null || n < 0 || n > 100) throw erro('"health_score" deve ser número entre 0 e 100, ou vazio'); out.health_score = Math.round(n * 10) / 10 }
  }
  if ('hs_classificacao' in campos) { const c = campos.hs_classificacao; if (c !== '' && c !== null && !CLASSIFICACOES.includes(c)) throw erro('"hs_classificacao" fora da lista'); out.hs_classificacao = c || '' }
  if ('canais_cs' in campos) {
    if (!Array.isArray(campos.canais_cs)) throw erro('"canais_cs" deve ser lista')
    out.canais_cs = campos.canais_cs.map(c => typeof c === 'string' ? { canal: c.trim().slice(0, 40) } : (c && typeof c === 'object' && typeof c.canal === 'string')
      ? { canal: c.canal.trim().slice(0, 40), cs: str(c.cs).slice(0, 120), hs: num(c.hs), classificacao: classe(c.classificacao) } : null)
    if (out.canais_cs.some(c => !c || !c.canal)) throw erro('"canais_cs": cada item precisa do nome do canal')
    if (out.canais_cs.length > 12) throw erro('"canais_cs": no máximo 12 canais')
  }
  return out
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function diferencas(atual, novos) {
  const mudancas = {}
  for (const [k, v] of Object.entries(novos)) if (!igual(atual[k], v)) mudancas[k] = { de: atual[k], para: v }
  return mudancas
}
function gravar(cliente, novos, fonte, hoje = hojeLocal()) {
  const atual = lerCadastro(cliente).cadastro
  const f = { ...atual, ...novos }
  const hsMudou = 'health_score' in novos && !igual(atual.health_score, novos.health_score) || 'hs_classificacao' in novos && atual.hs_classificacao !== novos.hs_classificacao
  UPD.run(f.cs_responsavel, f.health_score, f.hs_classificacao, hsMudou ? hoje : f.hs_em, JSON.stringify(f.canais_cs), fonte, f.observacoes, cliente)
}

// POST manual: prévia por padrão (nada gravado); confirmar === true grava; `por` = líder/consultor validado (403)
export function salvarCadastro({ cliente, por, campos, confirmar = false } = {}) {
  cliente = str(cliente)
  if (!cliente) throw erro('informe "cliente"')
  if (!SEL.get(cliente)) throw erro('cliente não encontrado na central', 404)
  if (!str(por)) throw erro('informe "por" (quem edita — líder ou consultor)')
  const nome = validarLiderOuConsultor(str(por))
  if (!nome) throw erro('só líderes e consultores editam o cadastro — escolha um nome da central', 403)
  const novos = validarCampos(campos)
  const mudancas = diferencas(lerCadastro(cliente).cadastro, novos)
  const previa = { ok: true, cliente, mudancas, n: Object.keys(mudancas).length }
  if (confirmar !== true) return { ...previa, previa: true }
  if (previa.n) gravar(cliente, novos, `manual ${hojeLocal()}`)
  return { ...previa, previa: false, gravado_por: nome, cadastro: lerCadastro(cliente).cadastro }
}

// ── importação da planilha ────────────────────────────────────────────────────────────────────────────────────────────────
// prévia por padrão; { confirmar: true } grava e guarda as pendências (não casados/ambíguos) em sync_estado
export function importarPlanilha(caminho, { confirmar = false, aliases = lerAliases(), nomes = nomesCentral(), abas = null, hoje = hojeLocal() } = {}) {
  const itens = interpretar(abas || lerPlanilha(caminho))
  const fonte = `planilha ${hoje}`
  const casados = [], pendencias = []
  const vistos = new Map()
  // 1º a aba Lista (dados por canal); depois os nomes que só estão em Relatórios (informativo: nunca mudam o cadastro, só se juntam ao cliente já casado)
  for (const e of [...itens.filter(e => e.canais.length), ...itens.filter(e => !e.canais.length)]) {
    const c = casar(e.nome, nomes, aliases)
    if (!c || c.ambiguo) { pendencias.push({ nome: e.nome, motivo: c ? 'ambiguo' : 'nao_encontrado', candidatos: c?.ambiguo || [], canais: e.canais.map(x => x.canal).filter(Boolean) }); continue }
    const ja = vistos.get(c.cliente)
    if (ja && !e.canais.length) { ja.relatorio = ja.relatorio || e.relatorio; continue }
    if (ja) { pendencias.push({ nome: e.nome, motivo: 'duplicado', candidatos: [c.cliente], canais: e.canais.map(x => x.canal).filter(Boolean) }); continue }   // dois nomes da Lista no mesmo cliente: o 1º vale, o 2º é pendência
    const mudancas = e.canais.length ? diferencas(lerCadastro(c.cliente).cadastro, consolidar(e)) : {}
    const x = { nome: e.nome, cliente: c.cliente, via: c.via, mudancas, relatorio: e.relatorio }
    vistos.set(c.cliente, x); casados.push(x)
  }
  const resumo = { aplicado: false, fonte, total: itens.length, casados: casados.length, pendencias: pendencias.length, mudam: casados.filter(x => Object.keys(x.mudancas).length).length }
  if (confirmar !== true) return { ...resumo, itens: casados, lista_pendencias: pendencias }
  db.transaction(() => {
    for (const x of casados) if (Object.keys(x.mudancas).length) gravar(x.cliente, Object.fromEntries(Object.entries(x.mudancas).map(([k, v]) => [k, v.para])), fonte, hoje)
    setEstado(CHAVE_PEND, JSON.stringify({ em: agora(), fonte, pendencias }))
  })()
  return { ...resumo, aplicado: true, itens: casados, lista_pendencias: pendencias }
}

export const pendenciasImportacao = () => parseJson(getEstado(CHAVE_PEND), { em: '', fonte: '', pendencias: [] })
