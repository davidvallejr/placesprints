// PlacePlan — a dinâmica pedida pelo David (06/10/2026, exemplo União Dog):
//   1. Quando o plano do cliente é criado, nasce uma PÁGINA na base "Informações" do cliente
//      (aba Plano de Ação), com CAPA e o plano descrito numa tabela 5W2H — uma página por
//      canal/mês, no formato real das páginas feitas à mão ("Outubro/26 ML": heading
//      "Plano de Ação" + tabela What/Why/Where/When/Who/How/How Much/Situação/Resultado).
//   2. Esse plano depois vira TAREFAS detalhadas no quadro "Tarefas - {Cliente}", cada linha
//      atribuída ao ANALISTA DA CONTA (o analista oficial que mais executa naquele cliente/canal),
//      com o link da página do plano no corpo da tarefa.
// Segurança: dryRun por padrão; dedupe pelo sufixo "· PlacePlan" no título da página do mês/canal;
// nunca cria opção nova de select na base do cliente; desfazer = lixeira do Notion.
import { db, agora, hojeLocal, getEstado, setEstado } from './db.js'
import { notionReq } from './notion.js'
import { descobrirFontes } from './descobrir.js'
import { resolverPaginaCliente, acharInformacoesDb } from './plano-informacoes.js'
import { lerPlano, lerAcoes, playbook } from './plano-cliente.js'
import { casadorOficial, listaOficial } from './analistas.js'
import { criarResolvedor, normNome, idDoUsuario, equipeCfg } from './equipe.js'
import { esquemaInformacoes, valorPropriedade } from './relatorio-notion.js'

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const rotuloMes = ym => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`         // "Outubro/26"
const SUFIXO_CANAL = { 'Mercado Livre': 'ML', Shopee: 'Shopee', Amazon: 'Amazon', 'TikTok Shop': 'TikTok', Legacy: 'Legacy', Geral: 'Geral', '': 'Geral' }
const CAPAS = [   // capas padrão (Unsplash, mesmo tipo usado nas páginas feitas à mão)
  'https://images.unsplash.com/photo-1512758017271-d7b84c2113f1?ixlib=rb-4.0.3&q=80&fm=jpg&crop=entropy&cs=tinysrgb',
  'https://images.unsplash.com/photo-1460925895917-afdab827c52f?ixlib=rb-4.0.3&q=80&fm=jpg&crop=entropy&cs=tinysrgb',
  'https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&q=80&fm=jpg&crop=entropy&cs=tinysrgb',
  'https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?ixlib=rb-4.0.3&q=80&fm=jpg&crop=entropy&cs=tinysrgb',
]
const brData = iso => iso ? iso.split('-').reverse().join('/') : '—'
const ROTULO_H = { '72h': 'até 72 horas', '7d': 'até 7 dias', '30d': 'até 30 dias', '90d': 'até 90 dias' }

// processo cru das tarefas → rótulo canônico de canal das ações (o mesmo de CANAIS em equipe.js)
export function canalCanonico(processo) {
  const p = normNome(processo)
  if (/^mercado ?livre/.test(p)) return 'Mercado Livre'
  if (/^shop+e+/.test(p)) return 'Shopee'
  if (/^amazon/.test(p)) return 'Amazon'
  if (/^tik ?tok|^tik$/.test(p)) return 'TikTok Shop'
  if (/^legacy/.test(p)) return 'Legacy'
  return null                                                   // 'Geral', 'Interno', ERPs… não são canal de ação
}
const MIN_AMOSTRA_CANAL = 3                                      // bucket de canal com menos que isso não sobrepõe o analista geral

// ── analista da conta: quem de fato executa este cliente (90 dias, lista oficial) ──
export function analistaDaConta(cliente, { hoje = hojeLocal() } = {}) {
  const corte = new Date(hoje + 'T12:00:00'); corte.setDate(corte.getDate() - 89)
  const rows = db.prepare(`SELECT responsavel, processo FROM tarefas
    WHERE arquivada = 0 AND fonte != 'demo' AND fonte != 's90' AND cliente = ? AND responsavel != '' AND titulo NOT LIKE '%· PS-%'
      AND COALESCE(NULLIF(data_conclusao,''), DATE(last_edited, 'localtime')) >= ?`).all(cliente, corte.toISOString().slice(0, 10))
  const nomes = rows.flatMap(r => r.responsavel.split(',').map(x => x.trim())).filter(Boolean)
  const canon = criarResolvedor(nomes)
  const oficial = casadorOficial()
  const conta = (lista) => {
    const freq = new Map()                                      // oficial → { n, notionNome mais comum }
    for (const r of lista) for (const nomeCru of new Set(r.responsavel.split(',').map(x => x.trim()).filter(Boolean))) {
      const curto = canon(nomeCru)
      const ofc = curto ? oficial(curto) : null
      if (!ofc) continue
      const f = freq.get(ofc) || { oficial: ofc, n: 0, curtos: new Map() }
      f.n++; f.curtos.set(curto, (f.curtos.get(curto) || 0) + 1)
      freq.set(ofc, f)
    }
    const top = [...freq.values()].sort((a, b) => b.n - a.n || a.oficial.localeCompare(b.oficial))[0]
    if (!top) return null
    const curto = [...top.curtos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    return { oficial: top.oficial, nome_notion: curto, notion_id: idDoUsuario(curto), tarefas_90d: top.n }
  }
  const porCanal = {}
  for (const canal of new Set(rows.map(r => canalCanonico(r.processo)).filter(Boolean))) {
    const c = conta(rows.filter(r => canalCanonico(r.processo) === canal))
    if (c && c.tarefas_90d >= MIN_AMOSTRA_CANAL) porCanal[canal] = c
  }
  return { geral: conta(rows), por_canal: porCanal }
}

// ── montagem (pura): páginas 5W2H por canal a partir das ações abertas ──────
export function montarPlacePlan(cliente, { hoje = hojeLocal() } = {}) {
  const plano = lerPlano(cliente)
  if (!plano) return { erro: 'plano não gerado para este cliente — gere antes de publicar o PlacePlan' }
  const acoes = lerAcoes({ clientes: [cliente], status: ['proposta', 'aprovada'] })
  if (!acoes.length) return { erro: 'nenhuma ação aberta (proposta/aprovada) — nada a publicar' }
  const analistas = analistaDaConta(cliente, { hoje })
  const mes = hoje.slice(0, 7)
  const porCanal = new Map()
  for (const a of acoes) {
    const canal = a.canal || 'Geral'
    porCanal.set(canal, [...(porCanal.get(canal) || []), a])
  }
  const paginas = [...porCanal.entries()].map(([canal, lista], i) => {
    const quem = (canal !== 'Geral' && analistas.por_canal[canal]) || analistas.geral
    const linhas = lista.sort((x, y) => y.score - x.score).map(a => ({
      what: a.titulo,
      why: a.dados.problema,
      where: canal,
      when: `${MESES[Number(mes.slice(5, 7)) - 1]} — até ${brData(a.prazo)}`,
      who: quem ? `Analista — ${quem.nome_notion}` : (a.responsavel ? `Consultor — ${a.responsavel}` : 'a definir'),
      how: a.dados.acao,
      how_much: ROTULO_H[a.horizonte] || a.horizonte,
      situacao: a.status === 'aprovada' ? 'Aprovado' : 'Proposto',
      resultado: '',                                            // preenchido na execução — nunca inventado
      _id: a.id,
    }))
    return {
      canal, titulo: `${rotuloMes(mes)} ${SUFIXO_CANAL[canal] || canal} · PlacePlan`,
      capa: CAPAS[i % CAPAS.length], analista: quem, linhas,
    }
  })
  return { cliente, mes, paginas, analistas }
}

// ── publicação na base "Informações" do cliente (dryRun por padrão) ─────────
const cel = txt => [{ type: 'text', text: { content: String(txt || '').slice(0, 1900) } }]

async function infoDbDe(cliente) {
  const f = (await descobrirFontes()).find(x => x.cliente === cliente)
  if (!f) throw new Error('base de tarefas do cliente não localizada')
  const pagina = await resolverPaginaCliente({ cliente, paginaClienteId: f.paginaClienteId, tarefasDbId: f.dbId, tarefasModo: f.modo })
  if (!pagina) throw new Error('página do cliente não resolvida')
  const infoDb = await acharInformacoesDb(pagina)
  if (!infoDb) throw new Error('base "Informações" não encontrada na página do cliente')
  const resolved = await notionReq(`databases/${infoDb}`).catch(() => null)
  const dsId = resolved?.data_sources?.[0]?.id || infoDb
  return { f, infoDb, dsId }
}

// propriedades da página do mês/canal a partir do esquema lido da base: título, Status (só se for `select`, como sempre foi) e Secção (`select` OU `status`:
// antes só `status` era reconhecida e nas bases `select` a categoria nunca era gravada). Usa SÓ opções que já existem na base (grafias variam por cliente).
export function propriedadesPlacePlan(props, titulo) {
  const esq = esquemaInformacoes(props)
  const tituloProp = esq.titulo?.chave
  const statusEnt = esq.status?.tipo === 'select' ? esq.status : null
  const opcao = (ent, alvo) => ent?.opcoes.find(o => /pendente|plano de acao/.test(normNome(o)) && normNome(o).includes(normNome(alvo).split(' ')[0]))
  const properties = { [tituloProp]: { title: [{ type: 'text', text: { content: titulo } }] } }
  const stPend = opcao(statusEnt, 'Pendente')
  if (stPend) properties[statusEnt.chave] = valorPropriedade(statusEnt, stPend)
  const secPlano = opcao(esq.secao, 'Plano de Acao')
  if (secPlano) properties[esq.secao.chave] = valorPropriedade(esq.secao, secPlano)
  return { tituloProp, properties }
}

export async function publicarPlacePlan(cliente, { dryRun = true, hoje = hojeLocal() } = {}) {
  const m = montarPlacePlan(cliente, { hoje })
  if (m.erro) return m
  const { dsId } = await infoDbDe(cliente)
  const schema = await notionReq(`data_sources/${dsId}`)
  const props = schema.properties || {}
  const tituloProp = esquemaInformacoes(props).titulo?.chave

  // dedupe: páginas "· PlacePlan" já existentes deste mês
  const existentes = new Map()
  let cursor
  do {
    const r = await notionReq(`data_sources/${dsId}/query`, { method: 'POST', body: { page_size: 100, filter: { property: tituloProp, title: { contains: 'PlacePlan' } }, ...(cursor ? { start_cursor: cursor } : {}) } })
    for (const pg of r.results) existentes.set((pg.properties[tituloProp]?.title || []).map(t => t.plain_text).join('').trim(), { id: pg.id, url: pg.url })
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)

  const rel = { cliente, dryRun, paginas: [], ja_existiam: [], erros: [] }
  const CABECALHO = ['What (O que)', 'Why (Por que)', 'Where (Onde)', 'When (Quando)', 'Who (Quem)', 'How (Como)', 'How Much (Quanto tempo)', 'Situação', 'Resultado']
  for (const p of m.paginas) {
    const ja = existentes.get(p.titulo)
    if (ja) { rel.ja_existiam.push({ titulo: p.titulo, url: ja.url, page_id: ja.id, canal: p.canal }); continue }
    const { properties } = propriedadesPlacePlan(props, p.titulo)
    const payload = {
      parent: { data_source_id: dsId },
      cover: { type: 'external', external: { url: p.capa } },
      icon: { type: 'emoji', emoji: '🗺️' },
      properties,
      children: [
        { object: 'block', type: 'heading_1', heading_1: { rich_text: cel('Plano de Ação') } },
        { object: 'block', type: 'table', table: { table_width: 9, has_column_header: true, has_row_header: false, children: [
          { object: 'block', type: 'table_row', table_row: { cells: CABECALHO.map(cel) } },
          ...p.linhas.slice(0, 40).map(l => ({ object: 'block', type: 'table_row', table_row: { cells: [l.what, l.why, l.where, l.when, l.who, l.how, l.how_much, l.situacao, l.resultado].map(cel) } })),
        ] } },
        ...(p.linhas.length > 40 ? [{ object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji: '⚠️' }, rich_text: cel(`Mostrando as 40 ações de maior prioridade de ${p.linhas.length} — as demais seguem no painel do Place Sprints.`) } }] : []),
        { object: 'block', type: 'paragraph', paragraph: { rich_text: cel(`Gerado pelo Place Sprints em ${brData(hoje)} a partir do diagnóstico do cliente — cada linha vira uma tarefa detalhada no quadro, atribuída ao analista da conta.`) } },
      ],
    }
    const resumo = { titulo: p.titulo, canal: p.canal, linhas: Math.min(40, p.linhas.length), cortadas: Math.max(0, p.linhas.length - 40), analista: p.analista?.nome_notion || null }
    if (dryRun) { rel.paginas.push({ ...resumo, previa: true }); continue }
    try {
      const pg = await notionReq('pages', { method: 'POST', body: payload, retry5xx: false })
      rel.paginas.push({ ...resumo, url: pg.url, page_id: pg.id })
    } catch (e) { rel.erros.push({ titulo: p.titulo, erro: e.message.slice(0, 200) }) }
  }
  if (!dryRun && (rel.paginas.length || rel.ja_existiam.length)) {
    const atual = JSON.parse(getEstado(`placeplan:${cliente}`) || '{}')
    for (const p of [...rel.paginas, ...rel.ja_existiam]) atual[p.canal] = { titulo: p.titulo, url: p.url, page_id: p.page_id, mes: m.mes, em: agora() }
    setEstado(`placeplan:${cliente}`, JSON.stringify(atual))
  }
  return rel
}

export const placeplanDe = cliente => JSON.parse(getEstado(`placeplan:${cliente}`) || '{}')
