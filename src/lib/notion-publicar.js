// Publicação de volta no Notion (o Notion segue sendo a casa do cliente):
//   1. barra de progresso do Plano de Ação do mês — callout fixado na página
//      de cada cliente, atualizado a cada execução (block id cacheado);
//   2. linha semanal no quadro do cliente com o PDF do relatório anexado
//      (File Upload API) + entregáveis detalhados no corpo da página.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { getEstado, setEstado, log } from './db.js'
import { env } from './env.js'
import { resolverFontes, NotionError } from './notion.js'
import { descobrirFontes } from './descobrir.js'
import { rotuloMes } from './marca.js'
import { mapeamento } from './extrair.js'
import { linkConectar } from './meli-link.js'
import { statusConexao } from './meli-contas.js'

const CFG_LINHA = mapeamento.linha_relatorio_semanal || {}

const V = () => env.NOTION_VERSION

async function api(caminho, { method = 'GET', body, headers = {}, raw } = {}) {
  const r = await fetch(`https://api.notion.com/v1/${caminho}`, {
    signal: AbortSignal.timeout(60_000), // sem timeout, um socket morto (Mac dormiu) trava o processo para sempre
    method,
    headers: { Authorization: `Bearer ${env.NOTION_TOKEN}`, 'Notion-Version': V(), ...(raw ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) throw new NotionError(`Notion ${r.status} em ${caminho}: ${(await r.text()).slice(0, 300)}`, r.status)
  return r.json()
}

// ── clientes ativos com base de tarefas resolvida (mesma descoberta do sync)
export async function listarClientesCentral({ filtroCliente } = {}) {
  const fontes = await descobrirFontes({ filtroCliente })
  return fontes.filter(f => f.cliente).map(f => ({
    nome: f.cliente, ativo: true,
    tarefasDbId: f.dbId, tarefasModo: f.modo,
    paginaClienteId: f.paginaClienteId || '',
  }))
}

// ── 1. barra de progresso na página do cliente ────────────────────────────
const MARCADOR = '📊 Plano de Ação'

function textoBarra(plano) {
  const blocos = Math.round(plano.pct / 10)
  const barra = '▓'.repeat(blocos) + '░'.repeat(10 - blocos)
  return `${MARCADOR} ${rotuloMes(plano.anoMes)} — ${barra} ${plano.pct}% · ` +
    `${plano.concluidas}/${plano.total} ações · esforço ${plano.esforco_concluido}/${plano.esforco}` +
    (plano.bloqueadas ? ` · ⚠ ${plano.bloqueadas} bloqueada(s)` : '') +
    (plano.dependencia_cliente ? ` · ${plano.dependencia_cliente} aguardando o cliente` : '') +
    ` · atualizado ${new Date().toLocaleDateString('pt-BR')}`
}

export async function atualizarBarraProgresso(clienteNome, paginaId, plano) {
  if (!plano || !paginaId) return { ok: false, motivo: 'sem página ou plano' }
  const conteudo = {
    callout: {
      rich_text: [{ type: 'text', text: { content: textoBarra(plano) } }],
      icon: { type: 'emoji', emoji: '📊' },
      color: plano.pct >= 70 ? 'green_background' : plano.pct >= 40 ? 'orange_background' : 'red_background',
    },
  }
  const chave = `barra:${paginaId}`
  const blocoId = getEstado(chave)

  if (blocoId) {
    try {
      await api(`blocks/${blocoId}`, { method: 'PATCH', body: conteudo })
      return { ok: true, acao: 'atualizada' }
    } catch (e) { if (e.status !== 404) throw e /* bloco apagado → recria */ }
  }
  // procura um callout nosso já existente no topo da página
  const filhos = await api(`blocks/${paginaId}/children?page_size=50`)
  const existente = (filhos.results || []).find(b => b.type === 'callout' &&
    b.callout?.rich_text?.[0]?.plain_text?.startsWith(MARCADOR))
  if (existente) {
    await api(`blocks/${existente.id}`, { method: 'PATCH', body: conteudo })
    setEstado(chave, existente.id)
    return { ok: true, acao: 'atualizada' }
  }
  const criado = await api(`blocks/${paginaId}/children`, {
    method: 'PATCH', body: { children: [{ object: 'block', type: 'callout', ...conteudo }] },
  })
  setEstado(chave, criado.results?.[0]?.id || '')
  return { ok: true, acao: 'criada' }
}

// ── 1b. botão "Conectar Mercado Livre" na página do cliente ───────────────
const MARCADOR_MELI = 'Mercado Livre'

function textoBotaoMeli(status) {
  if (status && !status.erro) return `✅ Mercado Livre conectado — ${status.nickname || status.meli_user_id} (desde ${new Date(status.conectado_em).toLocaleDateString('pt-BR')})`
  if (status?.erro) return `⚠️ Conexão com o Mercado Livre expirou — clique para reconectar`
  return `🛒 Conectar conta do Mercado Livre — clique aqui para autorizar`
}

export async function garantirBotaoMeli(clienteNome, paginaId) {
  if (!paginaId) return { ok: false, motivo: 'sem página do cliente' }
  const status = statusConexao(clienteNome)
  const precisaLink = !status || status.erro
  let link = ''
  if (precisaLink) {
    try { link = linkConectar(clienteNome) }
    catch (e) { return { ok: false, motivo: e.message } }
  }
  const texto = textoBotaoMeli(status)
  const richText = precisaLink
    ? [{ type: 'text', text: { content: texto, link: { url: link } } }]
    : [{ type: 'text', text: { content: texto } }]
  const conteudo = { callout: { rich_text: richText, icon: { type: 'emoji', emoji: '🛒' }, color: status && !status.erro ? 'green_background' : 'blue_background' } }

  const chave = `meli-botao:${paginaId}`
  const blocoId = getEstado(chave)
  if (blocoId) {
    try { await api(`blocks/${blocoId}`, { method: 'PATCH', body: conteudo }); return { ok: true, acao: 'atualizado' } }
    catch (e) { if (e.status !== 404) throw e }
  }
  const filhos = await api(`blocks/${paginaId}/children?page_size=50`)
  const existente = (filhos.results || []).find(b => b.type === 'callout' &&
    b.callout?.rich_text?.some(t => t.plain_text?.includes(MARCADOR_MELI)))
  if (existente) {
    await api(`blocks/${existente.id}`, { method: 'PATCH', body: conteudo })
    setEstado(chave, existente.id)
    return { ok: true, acao: 'atualizado' }
  }
  const criado = await api(`blocks/${paginaId}/children`, {
    method: 'PATCH', body: { children: [{ object: 'block', type: 'callout', ...conteudo }] },
  })
  setEstado(chave, criado.results?.[0]?.id || '')
  return { ok: true, acao: 'criado' }
}

// ── 2. upload do PDF (File Upload API) ────────────────────────────────────
export async function subirPdf(caminhoPdf) {
  const buf = readFileSync(caminhoPdf)
  if (buf.length > 19 * 1024 * 1024) throw new Error('PDF acima de ~20MB — reduza as evidências')
  const criado = await api('file_uploads', { method: 'POST', body: { mode: 'single_part', filename: basename(caminhoPdf), content_type: 'application/pdf' } })
  const form = new FormData()
  form.append('file', new Blob([buf], { type: 'application/pdf' }), basename(caminhoPdf))
  await api(`file_uploads/${criado.id}/send`, { method: 'POST', body: form, raw: true })
  return criado.id
}

// ── 3. linha semanal no quadro do cliente, com PDF + entregáveis ──────────
const rt = s => [{ type: 'text', text: { content: String(s).slice(0, 1900) } }]

// Acha, no schema real da base, a primeira propriedade candidata cujo tipo
// aceite o valor configurado (select/status) — evita gravar num campo errado
// quando o nome bate mas o tipo não é o esperado.
function acharPropSelect(props, candidatos) {
  for (const nome of candidatos || []) {
    const p = props[nome]
    if (p && (p.type === 'select' || p.type === 'status')) return { nome, tipo: p.type }
  }
  return null
}

export async function criarLinhaRelatorio({ tarefasDbId, tarefasModo, semanal, fileUploadId }) {
  const [fonte] = tarefasModo === 'data_source'
    ? [{ id: tarefasDbId, modo: 'data_source' }]
    : await resolverFontes(tarefasDbId)
  const schema = await api(fonte.modo === 'data_source' ? `data_sources/${fonte.id}` : `databases/${fonte.id}`)
  const props = schema.properties || {}
  const tituloProp = Object.keys(props).find(k => props[k].type === 'title') || 'Name'
  const titulo = `Relatório Semanal — ${semanal.identificacao.periodo}`

  const properties = { [tituloProp]: { title: rt(titulo) } }
  const dataProp = Object.keys(props).find(k => props[k].type === 'date' && /^data$/i.test(k))
  if (dataProp) properties[dataProp] = { date: { start: semanal.identificacao.ate } }

  // Canal = "Relatório" e Demandas = "Relatório Semanal" — é assim que o
  // consultor identifica e filtra essas linhas no quadro do cliente.
  const canalProp = acharPropSelect(props, CFG_LINHA.canal?.propriedade)
  if (canalProp && CFG_LINHA.canal?.valor) properties[canalProp.nome] = { [canalProp.tipo]: { name: CFG_LINHA.canal.valor } }
  const demandaProp = acharPropSelect(props, CFG_LINHA.demanda?.propriedade)
  if (demandaProp && CFG_LINHA.demanda?.valor) properties[demandaProp.nome] = { [demandaProp.tipo]: { name: CFG_LINHA.demanda.valor } }

  const k = { concluidas: semanal.acoes.length, abertas: semanal.atividades.em_andamento }
  const resumo = [
    `${k.concluidas} ${k.concluidas === 1 ? 'entrega concluída' : 'entregas concluídas'} na semana`,
    `${k.abertas} ${k.abertas === 1 ? 'ação em andamento' : 'ações em andamento'}`,
  ]
  if (semanal.plano?.total) resumo.push(`plano do mês em ${semanal.plano.pct}% de execução`)

  const children = [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: rt(`Relatório Semanal — ${semanal.identificacao.periodo}`) } },
    { object: 'block', type: 'paragraph', paragraph: { rich_text: rt(`${resumo.join(', ')}.`) } },
    { object: 'block', type: 'heading_3', heading_3: { rich_text: rt('Entregas da semana') } },
    ...(semanal.acoes.length ? semanal.acoes.slice(0, 20).map(a => ({
      object: 'block', type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: rt(`${a.titulo} — ${a.processo} · ${a.responsavel}` +
        (a.resultado ? ` · resultado informado pela equipe: ${a.resultado}` : '') + (a.impacto ? ` · impacto informado pela equipe: ${a.impacto}` : '')) },
    })) : [{ object: 'block', type: 'paragraph', paragraph: { rich_text: rt('Sem entregas concluídas no período.') } }]),
    ...(semanal.atencao.length ? [
      { object: 'block', type: 'heading_3', heading_3: { rich_text: rt('Pontos de atenção') } },
      ...semanal.atencao.slice(0, 10).map(p => ({
        object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(`${p.tipo}: ${p.texto}`) },
      }))] : []),
    { object: 'block', type: 'heading_3', heading_3: { rich_text: rt('Relatório completo') } },
    { object: 'block', type: 'file', file: { type: 'file_upload', file_upload: { id: fileUploadId } } },
  ]

  const pagina = await api('pages', {
    method: 'POST',
    body: {
      parent: fonte.modo === 'data_source' ? { data_source_id: fonte.id } : { database_id: fonte.id },
      icon: { type: 'emoji', emoji: '📈' },
      properties, children,
    },
  })
  return { url: pagina.url, id: pagina.id }
}

export function registrarPublicacao(cliente, resultado) {
  log('info', `publicado no Notion — ${cliente}: barra ${resultado.barra || '—'}, linha ${resultado.linha || '—'}`)
}
