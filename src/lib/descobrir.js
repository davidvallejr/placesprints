// Descoberta das fontes de tarefas — realidade do workspace Place2u:
// as bases chamam-se "Tarefas - {Cliente}" e o vínculo confiável é o TÍTULO
// (o campo "ID Database Tarefas" da central está vazio em todos os ativos).
// Estratégia: central de clientes (ativos + página do cliente) × busca de
// data sources por título; o campo ID, se preenchido, prevalece.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { env, ROOT } from './env.js'
import { resolverFontes, consultarPaginas, lerBlocos } from './notion.js'
import { log, getEstado, setEstado } from './db.js'
import { resolverPaginaCliente } from './plano-informacoes.js'

export const fontesCfg = JSON.parse(readFileSync(join(ROOT, 'config', 'fontes.json'), 'utf-8'))
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const compacto = s => norm(s).replace(/[^a-z0-9]/g, '')

// Sufixos jurídicos/genéricos comuns em razão social — removidos só nas
// variantes de comparação (o nome original do cliente nunca é alterado).
const RX_SUFIXO = /\s*\b(ltda\.?( me)?|eireli|me|epp|s\/?a\.?)\s*$/i

// Nomes candidatos para casar um cliente da central com o título de uma base:
// nome completo, sem parênteses finais, e o trecho antes de um hífen interno
// (razão social costuma vir como "Nome Curto - Sócio" ou "Marca (Apelido)").
function candidatosNome(nomeCentral) {
  const base = String(nomeCentral || '').trim()
  const semParen = base.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  const antesDoHifen = base.split(/\s+[-–—]\s+/)[0].trim()
  const semParenAntesHifen = semParen.split(/\s+[-–—]\s+/)[0].trim()
  const brutos = new Set([base, semParen, antesDoHifen, semParenAntesHifen])
  for (const b of [...brutos]) brutos.add(b.replace(RX_SUFIXO, '').trim())
  return [...brutos].filter(Boolean)
}

async function buscarDataSourcesTarefas() {
  const lista = []   // [{ id, titulo, nomeBase }]
  let cursor
  do {
    const r = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': env.NOTION_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Tarefas', filter: { value: 'data_source', property: 'object' }, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    })
    if (!r.ok) throw new Error(`busca de bases: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const d = await r.json()
    for (const ds of d.results) {
      const titulo = (ds.title?.map(t => t.plain_text).join('') || ds.name || '').trim()
      const m = titulo.match(/^\s*(?:🛠️\s*)?tarefas\s*[-–—]\s*(.+)$/i)
      if (m) lista.push({ id: ds.id, titulo, nomeBase: m[1].trim() })
    }
    cursor = d.has_more ? d.next_cursor : undefined
  } while (cursor)
  return lista
}

// Acha a base de um cliente em 3 camadas, da mais para a menos estrita —
// nunca por similaridade "solta" (isso já causou falso positivo real:
// "Christian Ponce" quase casou com a base "Christian Henrique" só pelo
// primeiro nome). Cada camada exige o nome inteiro (ou uma variante sua)
// batendo por completo — nunca uma palavra solta em comum.
function acharBase(nomeCentral, bases, porNorm, porCompacto) {
  const cands = candidatosNome(nomeCentral)
  for (const cd of cands) { const achou = porNorm.get(norm(cd)); if (achou) return { base: achou, camada: 'exato' } }
  for (const cd of cands) { const achou = porCompacto.get(compacto(cd)); if (achou) return { base: achou, camada: 'compacto' } }
  for (const cd of cands) {
    const tc = norm(cd).split(' ').filter(Boolean)
    if (tc.join('').length < 3) continue
    for (const b of bases) {
      const tb = norm(b.nomeBase).split(' ').filter(Boolean)
      const curto = tc.length <= tb.length ? tc : tb
      const longo = tc.length <= tb.length ? tb : tc
      if (curto.length && longo.slice(0, curto.length).join(' ') === curto.join(' '))
        return { base: b, camada: 'prefixo' }
    }
  }
  return null
}

export async function clientesAtivos() {
  const P = fontesCfg.clientes_props
  const clientes = []
  for (const fonte of await resolverFontes(fontesCfg.clientes_db)) {
    for await (const pg of consultarPaginas(fonte)) {
      const props = pg.properties || {}
      if (!props[P.ativo]?.checkbox) continue
      const texto = c => props[c]?.rich_text?.map(t => t.plain_text).join('').replace(/\s+/g, ' ').trim() || ''
      // equipe por canal (texto livre) + canais que o cliente opera (Canal <X> = canal do Discord)
      const CANAIS = { ML: 'MercadoLivre', SHO: 'Shopee', AMZ: 'Amazon', TTK: 'TikTok', Legacy: 'Legacy' }
      const consultores = {}, lideres = {}, canais = []
      for (const [k, nomeCanal] of Object.entries(CANAIS)) {
        const c = texto(`Consultor ${k}`), l = texto(`Líder ${k}`)
        if (c) consultores[k] = c
        if (l) lideres[k] = l
        if (c || l || texto(`Canal ${nomeCanal}`)) canais.push(k)
      }
      clientes.push({
        nome: (props[P.nome]?.title?.map(t => t.plain_text).join('') || 'Sem nome').trim(),
        paginaClienteId: texto(P.id_pagina_cliente) || pg.id,
        dbIdCampo: texto(P.id_database_tarefas),
        central: {
          status: props.Status?.select?.name || '', tier: props.Produtos?.select?.name || '', nicho: props.Nicho?.select?.name || '',
          canais, consultores, lideres,
          pessoas: (props.Consultor?.people || []).map(u => ({ id: u.id, nome: u.name || '' })),  // usuários Notion (id→nome)
          cnpj: texto('CNPJ'), cpf: texto('CPF'), responsavel: texto('Nome do Responsável'),
          // vencimento de contrato por canal (alimenta a preparação de renovação do playbook)
          vencimentos: Object.fromEntries(Object.keys(CANAIS).map(k => [k, (props[`Venc Contrato ${k}`]?.date?.start || '').slice(0, 10)]).filter(([, v]) => v)),
        },
      })
    }
  }
  return clientes
}

// Devolve [{ dbId, modo, cliente, paginaClienteId }]. `filtroCliente` (nome
// exato ou trecho, sem acento/caixa) limita a descoberta — útil p/ testes.
// Mapeamentos manuais confirmados (ver config/fontes.json → "apelidos")
// entram como candidato extra de nome, prevalecendo sobre a heurística.
export async function descobrirFontes({ filtroCliente } = {}) {
  const fontes = []
  for (const b of fontesCfg.bases || []) {
    fontes.push({ dbId: b.db_id, modo: null, cliente: b.cliente || '', projeto: b.projeto || '', paginaClienteId: '' })
  }
  if (!fontesCfg.clientes_db) return fontes

  const [clientes, bases] = await Promise.all([clientesAtivos(), buscarDataSourcesTarefas()])
  const porNorm = new Map(bases.map(b => [norm(b.nomeBase), b]))
  const porCompacto = new Map(bases.map(b => [compacto(b.nomeBase), b]))
  const apelidos = fontesCfg.apelidos || {}   // "Nome na central": "nome real da base"

  const alvo = filtroCliente ? norm(filtroCliente) : null
  const semBase = []
  for (const c of clientes) {
    if (alvo && !norm(c.nome).includes(alvo)) continue
    if (c.dbIdCampo) {
      fontes.push({ dbId: c.dbIdCampo, modo: null, cliente: c.nome, projeto: '', paginaClienteId: c.paginaClienteId })
      continue
    }
    const nomeParaBusca = apelidos[c.nome] ? `${c.nome} ${apelidos[c.nome]}`.trim() : c.nome
    const achou = apelidos[c.nome]
      ? { base: porNorm.get(norm(apelidos[c.nome])) || porCompacto.get(compacto(apelidos[c.nome])), camada: 'apelido' }
      : acharBase(nomeParaBusca, bases, porNorm, porCompacto)
    if (achou?.base) {
      fontes.push({ dbId: achou.base.id, modo: 'data_source', cliente: c.nome, projeto: '', paginaClienteId: c.paginaClienteId })
    } else {
      semBase.push(c.nome)
    }
  }
  // 2ª chance: o quadro pode estar DENTRO da página do cliente com outro título (filho de 1º nível «Tarefas…»/«Demandas…»)
  const aindaSem = []
  for (const nome of semBase) {
    const c = clientes.find(x => x.nome === nome)
    const r = await descobrirQuadroNaPagina({ cliente: nome, paginaClienteId: c?.paginaClienteId || '' })
    if (r.fonte) fontes.push({ dbId: r.fonte.dbId, modo: r.fonte.modo, cliente: nome, projeto: '', paginaClienteId: c?.paginaClienteId || '' })
    else { aindaSem.push(nome); if (r.ambiguos) log('aviso', `${nome}: mais de um quadro de tarefas na página do cliente (${r.ambiguos.join(' · ')}) — cadastre o db_id em config/fontes.json → "bases"`) }
  }
  if (aindaSem.length) log('aviso', `${aindaSem.length} cliente(s) ativo(s) sem base "Tarefas - {Cliente}" localizável: ${aindaSem.join(' · ')} — confirme o nome real da base e cadastre em config/fontes.json → "apelidos", ou o db_id em "bases"`)
  return fontes
}

// Quadro de tarefas achado pela PÁGINA do cliente: filho de 1º nível (child_database) cujo título começa com "Tarefas" ou contém
// "Tarefas"/"Demandas". Um só candidato → vira fonte e fica em sync_estado (fonte_descoberta:{cliente}, sem tocar config/fontes.json);
// mais de um → { ambiguos: [títulos] }; nenhum/sem página → {}. Só leitura no Notion. deps injetáveis (teste).
const RX_QUADRO = /tarefas|demandas/i
export async function descobrirQuadroNaPagina({ cliente, paginaClienteId }, deps = {}) {
  const { lerFilhos = id => lerBlocos(id, 0), resolverPagina = resolverPaginaCliente, fontesDe = resolverFontes, get = getEstado, set = setEstado } = deps
  const chave = `fonte_descoberta:${cliente}`
  try {
    const lembrado = get(chave)
    if (lembrado) { const j = JSON.parse(lembrado); if (j?.ds_id) return { fonte: { dbId: j.ds_id, modo: 'data_source', titulo: j.titulo }, lembrado: true } }
    const pagina = await resolverPagina({ cliente, paginaClienteId })
    if (!pagina) return {}
    const cands = (await lerFilhos(pagina)).filter(b => b.type === 'child_database' && RX_QUADRO.test(b.child_database?.title || '')).map(b => ({ id: b.id, titulo: String(b.child_database?.title || '').trim() }))
    if (!cands.length) return {}
    if (cands.length > 1) return { ambiguos: cands.map(c => c.titulo) }
    const ds = (await fontesDe(cands[0].id))[0]
    if (!ds) return {}
    set(chave, JSON.stringify({ db_id: cands[0].id, ds_id: ds.id, titulo: cands[0].titulo, em: new Date().toISOString() }))
    log('info', `${cliente}: quadro «${cands[0].titulo}» achado na página do cliente (fonte_descoberta)`)
    return { fonte: { dbId: ds.id, modo: ds.modo === 'data_source' ? 'data_source' : null, titulo: cands[0].titulo } }
  } catch (e) {
    log('aviso', `${cliente}: descoberta pela página falhou (${e?.status !== undefined ? `Notion ${e.status}` : String(e?.message ?? e).slice(0, 80)})`)
    return {}
  }
}
