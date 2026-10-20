// PLANO B do Relatório de Sprints Place2u (09/10/2026): quando a base Informações do cliente não aceita a página (Secção do tipo status sem a opção —
// o Notion não cria opção de status pela API —, ou sem página/sem base), o MESMO relatório (mesmo brief, mesmos blocos auditados) vira UMA tarefa no quadro
// «Tarefas - {Cliente}»: Canal Geral, Demanda Relatório, Responsável Pamela, Descrição = resumo, corpo = blocos. Nunca um segundo motor: quem decide é relatorio-envio.montarPlano.
// (a) PURO: mapa de propriedades do quadro (o MESMO de distribuir-notion.js, que importa daqui), resumo, propriedades da tarefa, Pamela.
// (b) fábrica criarRelatorioTarefa: resolve o quadro pela lista de fontes, consulta por título (dedupe), cria em lotes de ≤100 blocos. O corpo de erro do Notion nunca sai daqui.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { auditarTexto } from './relatorio-seguro.js'
import { rt, urlDe, RX_ID, ICONE } from './relatorio-notion.js'

// igual a equipe.normNome (aquele módulo importa o banco): acentos fora, tudo que não é letra/número vira espaço
export const normQuadro = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const lerMapeamento = (caminho = join(ROOT, 'config', 'mapeamento.json')) => JSON.parse(readFileSync(caminho, 'utf-8'))

// ── propriedades do quadro (nomes em config/mapeamento.json) — fonte única para distribuir-notion.js e para a tarefa do relatório ─────────────
export const achaProp = (props, candidatos, tipos) => {
  for (const nome of candidatos) if (props[nome] && tipos.includes(props[nome].type)) return { nome, def: props[nome] }
  return null
}
export function mapearPropsQuadro(props, P = {}) {
  const titulo = Object.keys(props).find(k => props[k].type === 'title')
  const data = Object.keys(props).find(k => props[k].type === 'date' && /^data$/i.test(k.trim()))
  return {
    titulo, data,
    canal: achaProp(props, ['Canal', ...(P.processo || [])], ['select']),
    demanda: achaProp(props, P.tipo_demanda || ['Demandas'], ['select']),
    tag: achaProp(props, ['Tag', 'Etiqueta'], ['select', 'multi_select']),
    desc: achaProp(props, P.descricao || ['Descrição'], ['rich_text']),
    resp: achaProp(props, P.responsavel || ['Responsável'], ['people']),
  }
}
// só opção JÁ existente (comparação sem acento/espaço)
export function opcaoExistente(p, desejado) {
  if (!p || !desejado) return null
  const opts = p.def.select?.options || p.def.multi_select?.options || p.def.status?.options || []
  const n = normQuadro(desejado)
  return opts.find(o => normQuadro(o.name) === n)?.name || null
}

// ── Pamela: usuário do Notion pelo nome normalizado (nome inteiro OU primeiro nome); 0 ou 2+ ids = sem responsável, com aviso ────────────
export function acharResponsavel(usuarios, nome) {
  const alvo = normQuadro(nome)
  if (!alvo) return { id: '', aviso: '' }
  const ids = new Map()
  for (const u of Array.isArray(usuarios) ? usuarios : []) {
    const n = normQuadro(u?.nome)
    if (!n || !RX_ID.test(String(u?.id || ''))) continue
    if (n === alvo || n.split(' ')[0] === alvo) ids.set(String(u.id), u.nome)
  }
  if (ids.size === 1) return { id: [...ids.keys()][0], nome: [...ids.values()][0], aviso: '' }
  if (ids.size === 0) return { id: '', aviso: `Responsável «${nome}» sem usuário do Notion identificado: a tarefa nasce sem responsável.` }
  return { id: '', aviso: `Há ${ids.size} usuários do Notion chamados «${nome}»: a tarefa nasce sem responsável (fixe o id em config/equipe.json → usuarios_notion).` }
}

// ── resumo do relatório para a Descrição: abertura + 1 linha por seção, ≤ max ─────────────────────────────────────────────────────────
const txt = v => v === null || v === undefined ? '' : String(v).trim()
const lista = v => Array.isArray(v) ? v : []
const val = v => v === null || v === undefined || txt(v) === '' ? '—' : typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : txt(v)
const dm = iso => { const m = txt(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : txt(iso) }
export function resumoDoBrief(B, max = 1900) {
  const ab = B?.abertura || {}, res = B?.resultados || {}, conc = B?.atividades?.concluido || {}, px = B?.proximos || {}
  const linhas = []
  const abertura = [txt(ab.cabecalho), txt(ab.frase)].filter(Boolean).join('. ').replace(/\.\./g, '.')
  if (abertura) linhas.push(abertura)
  const rl = lista(res.linhas).filter(l => txt(l?.rotulo))
  linhas.push('Resultados: ' + (res.disponivel !== false && rl.length ? rl.map(l => `${txt(l.rotulo)} ${val(l.atual)}${txt(l?.variacao?.texto) ? ` (${txt(l.variacao.texto)})` : ''}`).join('; ') : txt(res.motivo) || 'números não disponíveis neste período') + '.')
  const grupos = lista(conc.grupos).filter(g => txt(g?.rotulo))
  const total = Number(conc.total) || 0
  linhas.push('Concluído: ' + (grupos.length ? grupos.map(g => txt(g.rotulo)).join('; ') : total > 0 ? `${total} ${total === 1 ? 'ação concluída' : 'ações concluídas'}` : 'nenhuma ação concluída neste período') + '.')
  const itens = lista(px.itens).filter(i => txt(i?.rotulo))
  linhas.push('Próximos passos: ' + (itens.length ? itens.map(i => `${dm(i.quando) ? dm(i.quando) + ' ' : ''}${txt(i.rotulo)}`).join('; ') : txt(px.vazio) || 'sem datas futuras confirmadas') + '.')
  let s = linhas.map(l => l.replace(/\.\.$/, '.')).join('\n')     // «motivo.» já termina em ponto
  if (s.length > max) { let corte = s.lastIndexOf(' ', max - 1); if (corte < max - 200) corte = max - 1; s = s.slice(0, corte).trimEnd() + '…' }
  return s
}

export const tituloTarefaOk = (t, prefixo) => { const s = String(t ?? ''); return s.startsWith(`${prefixo} · `) && s.length > prefixo.length + 3 && s.length <= 200 && !/[\r\n]/.test(s) }
const valorOpcao = (p, nome) => ({ [p.def.type]: { name: nome } })

// monta propriedades + avisos da tarefa (puro). quadro = { props, pm } · cfg = config.fallback_tarefa · usuarios = [{ id, nome }]
export function montarTarefa({ brief, quadro, cfg, usuarios = [], hoje = '', nomesInternos = [], cliente = '' }) {
  const avisos = [], props = quadro.props || {}, pm = quadro.pm || mapearPropsQuadro(props)
  const titulo = `${cfg.titulo_prefixo} · ${txt(brief?.titulo)}`
  const descricao = resumoDoBrief(brief, cfg.descricao_max)
  const violacoes = [...auditarTexto(titulo, { nomesInternos, permitidos: [cliente] }), ...auditarTexto(descricao, { nomesInternos, permitidos: [cliente] })]
  if (!tituloTarefaOk(titulo, cfg.titulo_prefixo)) violacoes.push({ codigo: 'titulo', bloco: '', trecho: '' })
  const propriedades = { [pm.titulo]: { title: rt(titulo) } }
  // Canal e Demanda: select cria a opção ao enviar; status só usa opção que já existe (o Notion não cria opção de status pela API)
  const opcao = (chave, desejado, candidatosStatus) => {
    let p = pm[chave]
    if (!p) p = achaProp(props, candidatosStatus, ['status'])
    if (!p) { avisos.push(`O quadro não tem a coluna ${chave === 'canal' ? 'Canal' : 'Demanda'}: a tarefa nasce sem ela.`); return }
    const existente = opcaoExistente(p, desejado)
    if (existente) { propriedades[p.nome] = valorOpcao(p, existente); return }
    if (p.def.type === 'select') { propriedades[p.nome] = valorOpcao(p, desejado); return }
    avisos.push(`A coluna «${p.nome}» é do tipo Status e não tem a opção «${desejado}»: a tarefa nasce sem ela.`)
  }
  const P = quadro.mapeamento || {}
  opcao('canal', cfg.canal, ['Canal', ...(P.processo || [])])
  opcao('demanda', cfg.demanda, P.tipo_demanda || ['Demandas', 'Demanda'])
  const resp = acharResponsavel(usuarios, cfg.responsavel)
  if (resp.aviso) avisos.push(resp.aviso)
  if (!pm.resp) avisos.push('O quadro não tem a coluna Responsável (pessoas): a tarefa nasce sem responsável.')
  else if (resp.id) propriedades[pm.resp.nome] = { people: [{ id: resp.id }] }
  if (pm.desc) propriedades[pm.desc.nome] = { rich_text: rt(descricao) }
  if (pm.data && /^\d{4}-\d{2}-\d{2}$/.test(hoje)) propriedades[pm.data] = { date: { start: hoje } }
  return { titulo, descricao, propriedades, avisos, violacoes, responsavel: resp.id ? (resp.nome || cfg.responsavel) : '', canal: propriedades[pm.canal?.nome] ? cfg.canal : '', demanda: cfg.demanda }
}

// ── fábrica ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// deps: notion.req · fontes() → [{ cliente, dbId, modo }] (descobrirFontes) · mapeamento (config/mapeamento.json) · agora()
export function criarRelatorioTarefa({ notion, fontes, mapeamento = lerMapeamento(), agora = () => new Date().toISOString() }) {
  const req = (...a) => notion.req(...a)
  const TTL = 10 * 60_000
  const cache = new Map()                                           // cliente → { em, q }
  const invalidarCaches = () => cache.clear()

  // quadro «Tarefas - {Cliente}»: null quando não há fonte, a base não responde (400/404/403) ou não tem coluna de título; 5xx/rede sobem
  async function quadroDe(cliente, { forcar = false } = {}) {
    const hit = cache.get(cliente)
    if (!forcar && hit && Date.parse(agora()) - hit.em < TTL) return hit.q
    const f = ((await fontes()) || []).find(x => x?.cliente === cliente && RX_ID.test(String(x.dbId || '')))
    let q = null
    if (f) {
      let rota = f.modo === 'data_source' ? `data_sources/${f.dbId}` : `databases/${f.dbId}`
      let s
      try {
        s = await req(rota)
        if (!s?.properties && RX_ID.test(String(s?.data_sources?.[0]?.id || ''))) { rota = `data_sources/${s.data_sources[0].id}`; s = await req(rota) }
      } catch (e) { if ([400, 403, 404].includes(e?.status)) s = null; else throw e }
      const props = s?.properties
      if (props && typeof props === 'object') {
        const pm = mapearPropsQuadro(props, mapeamento.propriedades || {})
        if (pm.titulo) q = { cliente, rota, modoDS: rota.startsWith('data_sources'), id: rota.split('/')[1], props, pm, mapeamento: mapeamento.propriedades || {}, url: urlDe({ url: s.url, id: f.dbId }) }
      }
    }
    cache.set(cliente, { em: Date.parse(agora()), q })
    return q
  }
  // páginas vivas com este título exato (mais nova primeiro) — dedupe antes de criar
  async function acharPorTitulo(q, titulo) {
    const r = await req(`${q.rota}/query`, { method: 'POST', body: { filter: { property: q.pm.titulo, title: { equals: titulo } }, page_size: 10 } })
    return (Array.isArray(r?.results) ? r.results : []).filter(p => p && !p.archived && !p.in_trash && RX_ID.test(String(p.id || '')))
      .map(p => ({ id: p.id, url: urlDe(p), created_time: p.created_time || '' })).sort((a, b) => String(b.created_time).localeCompare(String(a.created_time)))
  }
  // cria a tarefa: propriedades + até 100 blocos numa chamada; o resto em PATCH por lotes. retry5xx:false (repetir o POST duplicaria); quem chama consulta por título.
  async function criar({ quadro: q, tarefa, blocos }) {
    const t = String(tarefa?.titulo ?? '')
    if (!q || !t.trim() || t.length > 200 || /[\r\n]/.test(t)) throw Object.assign(new Error('título inválido'), { codigo: 'titulo_invalido' })
    const LOTE = 100, filhos = Array.isArray(blocos) ? blocos : []
    const body = { parent: q.modoDS ? { data_source_id: q.id } : { database_id: q.id }, icon: { type: 'emoji', emoji: ICONE }, properties: tarefa.propriedades, children: filhos.slice(0, LOTE) }
    const pg = await req('pages', { method: 'POST', body, retry5xx: false })
    if (!RX_ID.test(String(pg?.id || ''))) throw Object.assign(new Error('resposta sem id'), { status: 502 })
    let aviso = ''
    for (let i = LOTE; i < filhos.length; i += LOTE) {
      try { await req(`blocks/${pg.id}/children`, { method: 'PATCH', body: { children: filhos.slice(i, i + LOTE) }, retry5xx: false }) }
      catch { aviso = 'A tarefa foi criada, mas parte do relatório não foi anexada: confira no Notion.'; break }
    }
    return { id: pg.id, url: urlDe(pg), aviso }
  }
  return { quadroDe, acharPorTitulo, criar, invalidarCaches }
}
