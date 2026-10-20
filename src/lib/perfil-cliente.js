// Perfil e objetivo do cliente no Relatório Semanal v2 (config/perfis-cliente.json + tabela perfil_cliente).
// Cliente com 1+ perfis: o PRIMEIRO vence conflitos de texto/número; booleanos fazem OU. Sem perfil salvo: o 'padrao' da config.
// O banco entra por fábrica (criarPerfis(handle)); os exports prontos usam o banco real, ou um banco em memória com
// PS_PERFIL_MEMORIA=1 (o autoteste nunca abre data/db.sqlite — mesmo padrão de PS_PROMO_MEMORIA em promocoes-db.js).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ROOT } from './env.js'

export const SCHEMA_PERFIL = `CREATE TABLE IF NOT EXISTS perfil_cliente (
  cliente TEXT PRIMARY KEY, perfis_json TEXT NOT NULL DEFAULT '[]', objetivo TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT '',
  tarefas_no_relatorio INTEGER,                      -- NULL = vale o perfil; 1 = lista as tarefas no relatório; 0 = relatório só de resultados
  coleta_promocoes INTEGER                           -- interruptor da coleta de promoções do ML: NULL = padrão da base (config/promocoes.json); 1 liga; 0 desliga
)`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })   // mensagens nunca repetem o valor recebido (voltam dentro de HTML)
const ENUMS = { densidade: ['completa', 'media', 'enxuta'], provas: ['completa', 'media', 'minima'], linguagem: ['padrao', 'simples', 'tecnica'], tom: ['neutro', 'parceria', 'tranquilizador'] }

// config editável à mão: erro de digitação derruba o carregamento com mensagem clara, não gera relatório errado
function validar(c) {
  const falha = m => { throw new Error(`config/perfis-cliente.json: ${m}`) }
  const base = c.regras_base || falha('falta "regras_base"')
  for (const [k, v] of Object.entries(base)) if (ENUMS[k] && !ENUMS[k].includes(v)) falha(`regras_base.${k} inválido`)
  for (const [id, p] of Object.entries(c.perfis || falha('falta "perfis"'))) {
    if (!p.rotulo) falha(`perfil "${id}" sem rótulo`)
    for (const [k, v] of Object.entries(p.regras || {})) {
      if (!Object.hasOwn(base, k)) falha(`perfil "${id}": regra desconhecida "${k}"`)
      if (typeof v !== typeof base[k]) falha(`perfil "${id}": regra "${k}" com tipo errado`)
      if (ENUMS[k] && !ENUMS[k].includes(v)) falha(`perfil "${id}": valor inválido em "${k}"`)
    }
  }
  for (const [id, o] of Object.entries(c.objetivos || falha('falta "objetivos"'))) if (!o.rotulo || !o.metrica) falha(`objetivo "${id}" incompleto`)
  if (!c.padrao?.perfis?.length || !c.padrao.perfis.every(i => Object.hasOwn(c.perfis, i)) || !Object.hasOwn(c.objetivos, c.padrao.objetivo)) falha('"padrao" aponta para perfil/objetivo inexistente')
  return c
}
export const cfg = validar(JSON.parse(readFileSync(join(ROOT, 'config', 'perfis-cliente.json'), 'utf-8')))
// id válido = chave PRÓPRIA da config: 'constructor', '__proto__', 'toString' (herdados de Object) nunca passam
const temPerfil = id => Object.hasOwn(cfg.perfis, id), temObjetivo = id => Object.hasOwn(cfg.objetivos, id)
export const janelaResultadosDias = () => Number.isInteger(cfg.janela_resultados_dias) && cfg.janela_resultados_dias > 0 ? cfg.janela_resultados_dias : 45

const validosP = () => Object.keys(cfg.perfis).join(', ')
const idsUnicos = x => [...new Set([].concat(x ?? []).flatMap(s => String(s).split(',')).map(s => s.trim()).filter(Boolean))]   // 'direto,tecnico' | ['direto'] -> ids únicos, na ordem

export function mesclarRegras(ids) {
  const lista = idsUnicos(ids)
  if (!lista.length) throw erro('informe ao menos um perfil')
  if (lista.some(i => !temPerfil(i))) throw erro(`perfil desconhecido — válidos: ${validosP()}`)
  const out = { ...cfg.regras_base }, definidas = new Set()
  for (const id of lista) for (const [k, v] of Object.entries(cfg.perfis[id].regras || {})) {
    if (typeof v === 'boolean') out[k] = out[k] || v                  // booleanos: qualquer perfil liga
    else if (!definidas.has(k)) { out[k] = v; definidas.add(k) }      // texto/número: o primeiro perfil que DEFINE vence (conflito = só quando 2 definem)
  }
  return out
}

export const listarPerfis = () => Object.entries(cfg.perfis).map(([id, p]) => ({ id, rotulo: p.rotulo, descricao: p.descricao || '', regras: mesclarRegras([id]), definicao: cfg.status_definicoes || '' }))
export const listarObjetivos = () => Object.entries(cfg.objetivos).map(([id, o]) => ({ id, rotulo: o.rotulo, metrica: o.metrica, descricao: o.descricao || '' }))

const objetivoDe = id => ({ id, rotulo: cfg.objetivos[id].rotulo, metrica: cfg.objetivos[id].metrica })
const lerJson = s => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : [] } catch { return [] } }

export function criarPerfis(handle) {
  handle.exec(SCHEMA_PERFIL)    // idempotente (em produção o db.js já criou); necessário para o banco em memória do teste
  const colunas = new Set(handle.prepare('PRAGMA table_info(perfil_cliente)').all().map(c => c.name))                                                    // banco criado antes destas colunas
  if (!colunas.has('tarefas_no_relatorio')) handle.exec('ALTER TABLE perfil_cliente ADD COLUMN tarefas_no_relatorio INTEGER')
  if (!colunas.has('coleta_promocoes')) handle.exec('ALTER TABLE perfil_cliente ADD COLUMN coleta_promocoes INTEGER')
  const linha = cliente => handle.prepare('SELECT perfis_json, objetivo, tarefas_no_relatorio, coleta_promocoes FROM perfil_cliente WHERE cliente = ?').get(cliente)
  // interruptor da coleta de promoções: 1 | 0 | null (null = padrão da base, decidido por promocoes-coleta.coletaLigada)
  const coletaPromocoesDoCliente = cliente => linha(cliente)?.coleta_promocoes ?? null

  // ov = { perfis, objetivo } troca o perfil só para essa geração (não grava); id desconhecido no override = erro (pedido inválido)
  function perfilDoCliente(cliente, ov = {}) {
    const row = linha(cliente), avisos = []
    let ids = idsUnicos(row ? lerJson(row.perfis_json) : [])
    const orig = ids.length
    ids = ids.filter(temPerfil)                                     // perfil salvo e depois removido da config: não derruba o relatório
    if (ids.length < orig) avisos.push(`${orig - ids.length} perfil(is) salvo(s) não existe(m) mais na config e foi(ram) ignorado(s)`)
    let objetivo = row?.objetivo
    if (row && !temObjetivo(objetivo)) { avisos.push('objetivo salvo não existe mais na config — usando o padrão'); objetivo = null }
    const origem = row && ids.length ? 'banco' : 'padrao'
    if (!ids.length) ids = [...cfg.padrao.perfis]
    if (!objetivo || !temObjetivo(objetivo)) objetivo = cfg.padrao.objetivo
    const ovIds = idsUnicos(ov.perfis)
    if (ovIds.length) { mesclarRegras(ovIds); ids = ovIds }         // mesclarRegras valida
    if (ov.objetivo) { if (!temObjetivo(ov.objetivo)) throw erro(`objetivo desconhecido — válidos: ${Object.keys(cfg.objetivos).join(', ')}`); objetivo = ov.objetivo }
    // lista de tarefas no relatório: o perfil define o padrão; a escolha explícita do cliente (1/0) ou do override desta geração vence
    const regras = mesclarRegras(ids)
    const tnr = ov.tarefas_no_relatorio !== undefined ? ov.tarefas_no_relatorio : row?.tarefas_no_relatorio
    const tarefasOverride = tnr === 1 || tnr === true ? true : tnr === 0 || tnr === false ? false : null
    if (tarefasOverride !== null) regras.lista_tarefas = tarefasOverride
    return {
      cliente,
      perfis: ids.map(id => ({ id, rotulo: cfg.perfis[id].rotulo, descricao: cfg.perfis[id].descricao || '' })),
      primario: ids[0], objetivo: objetivoDe(objetivo), regras, origem, tarefas_override: tarefasOverride, coleta_promocoes: row?.coleta_promocoes ?? null,
      ...(ovIds.length || ov.objetivo || ov.tarefas_no_relatorio !== undefined ? { override: true } : {}), avisos,
    }
  }

  // liga/desliga: undefined mantém o que está salvo; null volta ao padrão; true/false força (mesma régua para tarefas_no_relatorio e coleta_promocoes)
  const ligaDesliga = (nome, v, atual) => {
    if (v === undefined) return atual
    if (v === null) return null
    if (v === true || v === false) return v ? 1 : 0
    throw erro(`"${nome}" deve ser true, false ou null`)
  }
  function salvarPerfil({ cliente, perfis, objetivo, por, tarefas_no_relatorio, coleta_promocoes } = {}) {
    cliente = String(cliente ?? '').trim(); por = String(por ?? '').trim().slice(0, 80)
    if (!cliente) throw erro('informe "cliente"')
    if (!por) throw erro('informe "por" (quem está alterando — fica registrado junto do perfil)')
    const ids = idsUnicos(perfis)
    if (!ids.length) throw erro('informe "perfis": ao menos um id (o primeiro é o primário)')
    mesclarRegras(ids)                                              // valida os ids
    const obj = objetivo ?? linha(cliente)?.objetivo ?? cfg.padrao.objetivo
    if (!temObjetivo(obj)) throw erro(`objetivo desconhecido — válidos: ${Object.keys(cfg.objetivos).join(', ')}`)
    const salvo = linha(cliente)
    const tnr = ligaDesliga('tarefas_no_relatorio', tarefas_no_relatorio, salvo?.tarefas_no_relatorio ?? null)
    const cp = ligaDesliga('coleta_promocoes', coleta_promocoes, salvo?.coleta_promocoes ?? null)
    handle.prepare(`INSERT INTO perfil_cliente (cliente, perfis_json, objetivo, atualizado_em, por, tarefas_no_relatorio, coleta_promocoes) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(cliente) DO UPDATE SET perfis_json = excluded.perfis_json, objetivo = excluded.objetivo, atualizado_em = excluded.atualizado_em, por = excluded.por,
        tarefas_no_relatorio = excluded.tarefas_no_relatorio, coleta_promocoes = excluded.coleta_promocoes`)
      .run(cliente, JSON.stringify(ids), obj, new Date().toISOString(), por, tnr, cp)
    return perfilDoCliente(cliente)
  }
  return { perfilDoCliente, salvarPerfil, coletaPromocoesDoCliente }
}

// ponytail: import dinâmico só para não abrir o banco real quando em memória (top-level await, Node 22)
const handlePadrao = process.env.PS_PERFIL_MEMORIA === '1' ? new Database(':memory:') : (await import('./db.js')).db
export const { perfilDoCliente, salvarPerfil, coletaPromocoesDoCliente } = criarPerfis(handlePadrao)
