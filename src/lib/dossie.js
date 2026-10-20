// PRESTAÇÃO DE CONTAS (versão cliente) e DOSSIÊ DE DEFESA (versão interna/jurídica) — pedido do David, 13/10/2026: o relatório que o Manoel montou à mão para a
// Juliana (09/10/2026) vira padrão para qualquer cliente/período, inclusive em risco, jurídico, reclamação ou reembolso. Etapa 2 (a 1 é o livro de registro).
// montarDossie é PURO sobre os dados injetados (fiação em dossie-real.js): mesma ordem e tom do relatório do Manoel (capa → 01 Resumo … 18 Fontes); números iguais
// às fontes; ausente = "—" com o motivo; nunca causa — associação com controle e ressalva. A versão defesa acrescenta D1–D7 (tese de obrigação de MEIO, as 9 perguntas,
// cronologia do livro com seq/hash, tentativas de contato, colaboração × obstrução, varredura de admissão de erro, inventário de provas) e o STATUS pela definition of done.
// criarDossies (fábrica sem import de banco) gera os arquivos, guarda em dossie_gerado + data/dossies/{cliente}/ e registra cada geração no livro; tick mensal p/ risco aberto.
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { mascarar, solicitacaoSeller } from './livro-registro.js'
import { ehAberta, ehDependencia, ROTULOS } from './status-tarefa.js'
import { auditarTexto } from './relatorio-seguro.js'

export const VERSOES = ['cliente', 'defesa']
export const SCHEMA_DOSSIE = `
CREATE TABLE IF NOT EXISTS dossie_gerado (       -- cada geração da prestação de contas / dossiê de defesa (src/lib/dossie.js); a geração também entra no livro de registro
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,
  versao TEXT NOT NULL CHECK (versao IN ('cliente','defesa')),
  de TEXT NOT NULL, ate TEXT NOT NULL,
  gerado_em TEXT NOT NULL, por TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','mensal')),
  competencia TEXT NOT NULL DEFAULT '',            -- 'mm/aaaa' na geração mensal
  arquivo_pdf TEXT NOT NULL DEFAULT '', arquivo_doc TEXT NOT NULL DEFAULT '',   -- relativos a data/ (dossies/<cliente>/…)
  sha256_pdf TEXT NOT NULL DEFAULT '', sha256_doc TEXT NOT NULL DEFAULT '',
  bytes_pdf INTEGER NOT NULL DEFAULT 0, pdf_motivo TEXT NOT NULL DEFAULT '',    -- pdf_motivo: por que não há PDF (Chrome ausente, timeout)
  status TEXT NOT NULL CHECK (status IN ('completo','incompleto','n/a')),       -- definition of done da defesa; 'n/a' na versão cliente
  pendencias_json TEXT NOT NULL DEFAULT '[]',
  livro_seq INTEGER, livro_hash TEXT NOT NULL DEFAULT '',                       -- último elo do livro do cliente no momento da geração (impresso no documento)
  notion_json TEXT NOT NULL DEFAULT '{}'           -- envio da versão cliente ao Notion do cliente (url, em, por)
);
CREATE INDEX IF NOT EXISTS ix_dossie_cli ON dossie_gerado (cliente, id);
CREATE TABLE IF NOT EXISTS dossie_mensal (       -- envio mensal ao #growth (idempotente por cliente × competência)
  cliente TEXT NOT NULL, competencia TEXT NOT NULL,
  ids_json TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL DEFAULT 'gerado' CHECK (estado IN ('gerado','pendente','enviado','falhou')),
  motivo TEXT NOT NULL DEFAULT '', tentativas INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL, tentado_em TEXT NOT NULL DEFAULT '', enviado_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, competencia)
);
`

// ── formatação (pt-BR) ────────────────────────────────────────────────────────────────────────────
const DIA = /^\d{4}-\d{2}-\d{2}$/
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
const proxMes = m => { const [a, b] = m.split('-').map(Number); return b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}` }
const r2 = x => Math.round(x * 100) / 100
const fmt = c => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c })
const F0 = fmt(0), F1 = fmt(1), F2 = fmt(2)
export const brl = v => v == null || !Number.isFinite(v) ? '—' : `R$ ${F2.format(v)}`
const int = v => v == null || !Number.isFinite(v) ? '—' : F0.format(v)
const pct = v => v == null || !Number.isFinite(v) ? '—' : `${F1.format(v)}%`
const var_ = v => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${F1.format(v)}%`
export const dm = iso => DIA.test(String(iso ?? '').slice(0, 10)) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—'
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const faixa = (a, b) => `${dm(a).slice(0, 5)}–${dm(b)}`
const mesRot = m => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`
const corta = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const limpo = (s, n = 160) => corta(mascarar(s), n)
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ehML = t => /mercado/i.test(t?.processo || '')
const plural = (n, um, varios) => `${int(n)} ${n === 1 ? um : varios}`
const h12 = h => String(h || '').slice(0, 12)
const diaIso = v => String(v ?? '').slice(0, 10)
// valor de uma mudança do anúncio em texto de gente (preço em R$, sim/não, status e Ads em português, promoção pelo tipo, capa sem URL)
const STATUS_ANUNCIO = { active: 'ativo', paused: 'pausado', closed: 'encerrado', inactive: 'inativo', under_review: 'em revisão' }
const ADS_ESTADO = { active: 'ativo', paused: 'pausado', idle: 'parado', hold: 'retido', sem_anuncio: 'fora do Ads' }
const LOGISTICA = { fulfillment: 'Full', xd_drop_off: 'agência/coleta', cross_docking: 'coleta', drop_off: 'agência', self_service: 'Flex' }
const ROT_CAMPO = { preco: 'Preço', preco_original: 'Preço original', titulo: 'Título', fotos: 'Fotos', thumb: 'Capa', descricao: 'Descrição', atributos: 'Ficha técnica', frete_gratis: 'Frete grátis', status: 'Status', promocao: 'Promoção', ads: 'Product Ads', logistica: 'Logística/Full', estoque_zero: 'Estoque' }
const PROMO = { DEAL: 'campanha', PRICE_DISCOUNT: 'desconto de preço', LIGHTNING: 'oferta relâmpago', DOD: 'oferta do dia', MARKETPLACE_CAMPAIGN: 'campanha do Mercado Livre', SMART: 'campanha automática', SELLER_CAMPAIGN: 'campanha do vendedor', VOLUME: 'desconto por volume', PRE_NEGOTIATED: 'desconto negociado' }
export function valMud(campo, v) {
  const s = String(v ?? '').trim()
  if (!s) return '—'
  if (campo === 'preco' || campo === 'preco_original') return Number.isFinite(Number(s)) ? brl(Number(s)) : limpo(s, 60)
  if (campo === 'frete_gratis') return s === '1' || s === 'true' ? 'com frete grátis' : s === '0' || s === 'false' ? 'sem frete grátis' : limpo(s, 60)
  if (campo === 'estoque_zero') return Number.isFinite(Number(s)) ? `${int(Number(s))} un.` : limpo(s, 60)
  if (campo === 'fotos') return Number.isFinite(Number(s)) ? plural(Number(s), 'foto', 'fotos') : limpo(s, 60)
  if (campo === 'thumb') return /^https?:/i.test(s) ? 'imagem de capa' : limpo(s, 60)
  if (campo === 'status') return STATUS_ANUNCIO[s] || limpo(s, 60)
  if (campo === 'ads') return ADS_ESTADO[s] || limpo(s, 60)
  if (campo === 'logistica') return LOGISTICA[s] || limpo(s, 60)
  if (campo === 'promocao') return s === 'nenhuma' ? 'sem promoção' : limpo(s.replace(/^[A-Z_]+/, k => PROMO[k] || k.toLowerCase().replace(/_/g, ' ')), 60)
  return limpo(s, 60)
}
const sha = b => createHash('sha256').update(b).digest('hex')
export const competenciaDe = iso => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
export const mesAnterior = hoje => { const ini = `${hoje.slice(0, 7)}-01`, ate = addDias(ini, -1); return { de: `${ate.slice(0, 7)}-01`, ate, competencia: competenciaDe(ate) } }

// ── blocos (o renderizador só conhece estes tipos; todo texto é escapado lá) ──────────────────────────
const kpis = itens => ({ t: 'kpis', itens })
const tabela = (cab, linhas, { vazio = 'Nada registrado no período.', nota = '', num = [] } = {}) => ({ t: 'tabela', cab, linhas, vazio, nota, num })
const p = (texto, classe = '') => ({ t: 'p', texto, classe })
const lista = itens => ({ t: 'lista', itens })
const aviso = (nivel, titulo, texto = '') => ({ t: 'aviso', nivel, titulo, texto })
const h3 = texto => ({ t: 'h3', texto })
const sec = (num, id, titulo, blocos, fonte = '') => ({ num, id, titulo, blocos, fonte })

// ── comercial: uma janela [a, b] das fontes de pedidos (meli_coleta_dia + meli_serie_item) e visitas (só anúncios com visitas coletadas na janela inteira) ──
// «Dia sem coleta não é zero»: média diária = soma ÷ dias COLETADOS; sem nenhum dia coletado, os números são null ("—").
function janelaComercial(dados, a, b) {
  const itens = new Map((dados.itens || []).map(i => [i.item_id, i]))
  const cobre = i => !!i?.vis_de && i.vis_de <= a && !!i.vis_ate && i.vis_ate >= addDias(b, -1)
  let coletados = 0, truncados = 0, pedidos = 0
  const diasCol = new Set()
  for (const c of dados.coleta || []) if (c.dia >= a && c.dia <= b) { coletados++; diasCol.add(c.dia); pedidos += Number(c.pedidos) || 0; if (c.truncado) truncados++ }
  let receita = 0, unidades = 0, vis = 0, uVis = 0
  for (const s of dados.serie || []) {
    if (s.dia < a || s.dia > b) continue
    if (diasCol.has(s.dia)) { receita += Number(s.receita) || 0; unidades += Number(s.unidades) || 0 }
    if (cobre(itens.get(s.item_id))) { vis += Number(s.visitas) || 0; if (diasCol.has(s.dia)) uVis += Number(s.unidades) || 0 }
  }
  const comVis = [...itens.values()].filter(cobre).length, dias = diasEntre(a, b) + 1, ok = coletados > 0
  return {
    de: a, ate: b, dias, coletados, truncados,
    receita: ok ? r2(receita) : null, pedidos: ok ? pedidos : null, unidades: ok ? unidades : null,
    visitas: comVis ? vis : null, anuncios_com_visitas: comVis, conversao: comVis && vis > 0 && ok ? r2(100 * uVis / vis) : null,
    preco_medio: ok && unidades ? r2(receita / unidades) : null,
    dia_receita: ok ? r2(receita / coletados) : null, dia_pedidos: ok ? r2(pedidos / coletados) : null, dia_unidades: ok ? r2(unidades / coletados) : null, dia_visitas: comVis ? r2(vis / dias) : null,
  }
}
function mesesDe(de, ate) {
  const out = []
  for (let m = de.slice(0, 7); m <= ate.slice(0, 7); m = proxMes(m)) {
    const ini = `${m}-01`, fim = addDias(`${proxMes(m)}-01`, -1), a = ini < de ? de : ini, b = fim > ate ? ate : fim
    out.push({ mes: m, de: a, ate: b, cortado: a !== ini || b !== fim })
  }
  return out
}

// ── varredura de admissão de erro: frases da config (sem acento, minúsculas) nos textos que o sistema guarda ──
export function varrerAdmissao(textos, frases) {
  const fs = (frases || []).map(f => norm(f).trim()).filter(Boolean)
  const achados = []
  // uma ocorrência por texto (com todas as frases que ele contém); o trecho (com acentos) sai do texto original pelo mapa de posições do texto normalizado
  for (const x of textos) {
    const orig = String(x.texto ?? ''), mapa = []
    let n = ''
    for (let k = 0; k < orig.length; k++) { const c = norm(orig[k]); for (const _ of c) mapa.push(k); n += c }
    const hits = []
    for (const f of fs) {
      const m = new RegExp(`(^|[^a-z0-9])${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?=$|[^a-z0-9])`).exec(n)
      if (m) hits.push({ f, i: m.index + m[1].length })
    }
    if (!hits.length) continue
    const i = mapa[Math.min(...hits.map(h => h.i))] ?? 0
    achados.push({ fonte: x.fonte, ref: x.ref || '', data: x.data || '', frase: hits.map(h => h.f).join(', '), trecho: limpo(orig.slice(Math.max(0, i - 60), i + 120), 180) })
  }
  return achados
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// montarDossie(cliente, { de, ate, versao, cfg }, dados) → { versao, capa, secoes, numeros, status, pendencias, cabeca }
// ════════════════════════════════════════════════════════════════════════════════════════════════════
export function montarDossie(cliente, { de, ate, versao = 'cliente', cfg = {} } = {}, dados = {}) {
  if (!VERSOES.includes(versao)) throw Object.assign(new Error('versão inválida (cliente ou defesa)'), { status: 400 })
  const defesa = versao === 'defesa', hoje = dados.hoje || ate
  const C = { janela_resposta_dias: 7, prazo_pendencia_dias: 3, max_evidencias: 8, max_bytes_evidencia: 1_500_000, max_exemplos: 4, dias_registro_tardio: 3, frases_admissao: [], ...cfg }
  const eq = dados.equipe || {}
  const consultor = eq.consultor || '', cs = eq.cs || ''
  // versão cliente: card marcado «Exibir ao cliente = não» (visivel_cliente = 0) nunca aparece — nem nas contagens, prints e medições; a defesa vê tudo
  const ocultas = new Set(defesa ? [] : (dados.tarefas || []).filter(t => t.visivel_cliente === 0).map(t => t.id))
  const tarefas = (dados.tarefas || []).filter(t => !ocultas.has(t.id))
  const noPer = d => !!d && d >= de && d <= ate
  const concl = tarefas.filter(t => t.status === 'concluida' && noPer(t.data_conclusao)).sort((a, b) => a.data_conclusao.localeCompare(b.data_conclusao) || String(a.titulo).localeCompare(String(b.titulo)))
  const conclSemData = tarefas.filter(t => t.status === 'concluida' && !t.data_conclusao && noPer(t.data_inicio))
  const abertas = tarefas.filter(t => ehAberta(t) && (!t.data_inicio || t.data_inicio <= ate))   // backlog ativo (status-tarefa.js); aguardando o cliente vai na seção 11
  const criadas = tarefas.filter(t => noPer(t.data_inicio))
  const porCanal = l => Object.entries(l.reduce((m, t) => (m[t.processo || 'Geral'] = (m[t.processo || 'Geral'] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])
  const canaisTxt = l => porCanal(l).map(([c, n]) => `${c}: ${int(n)}`).join(' · ') || '—'

  // ── comercial ──
  const meses = mesesDe(de, ate).map(m => ({ ...m, ...janelaComercial(dados, m.de, m.ate) }))
  const total = janelaComercial(dados, de, ate)
  const mesesCheios = meses.filter(m => m.coletados > 0)
  const primeiro = mesesCheios[0], ultimo = mesesCheios.at(-1)
  const ritmo = primeiro && ultimo && primeiro !== ultimo && primeiro.dia_receita > 0 ? r2((ultimo.dia_receita / primeiro.dia_receita - 1) * 100) : null
  const tendencia = ritmo == null ? 'sem_base' : ritmo >= 5 ? 'crescimento' : ritmo <= -5 ? 'queda' : 'estabilidade'
  const parcialTxt = m => m.coletados < m.dias ? `${int(m.coletados)} de ${int(m.dias)} dia(s) coletados` : m.cortado ? `${dm(m.de)} a ${dm(m.ate)}` : ''

  // ── anúncios trabalhados (ML): vínculo tarefa → MLB do sistema (citado no card, ação do plano ou confirmado; nunca sugerido) ──
  const conclML = concl.filter(ehML)
  const porMlb = new Map()
  for (const t of conclML) for (const id of t.itens || []) { const x = porMlb.get(id) || { n: 0, tarefas: [] }; x.n++; x.tarefas.push(t); porMlb.set(id, x) }
  const intervencoes = [...porMlb.values()].reduce((s, x) => s + x.n, 0)
  const tituloItem = new Map((dados.itens || []).map(i => [i.item_id, i.titulo]))

  // ── medições (Merovíngio): só as do período; com controle = comparáveis ──
  const medidas = (dados.medidas || []).filter(m => noPer(m.data) && !ocultas.has(m.id))
  const comp = medidas.filter(m => ['melhorou', 'sem_efeito', 'piorou'].includes(m.estado) && m.controle)
  const contaEst = e => comp.filter(m => m.estado === e).length

  // ── comunicação ──
  // resposta = mensagem do cliente no grupo (coletor); conversa = retorno colhido pela EQUIPE em conversa (origem 'equipe'): nunca é citação da nossa mensagem nem resposta a um
  // envio — fica fora de respostas, das tentativas de contato e da prova D4, numa linha própria
  const todas = (dados.respostas || []).slice().sort((a, b) => String(a.recebido_em).localeCompare(String(b.recebido_em)))
  const respostas = todas.filter(r => r.origem !== 'equipe'), conversas = todas.filter(r => r.origem === 'equipe')
  const rels = (dados.relatorios || []).filter(r => noPer(String(r.em).slice(0, 10)))
  const lotes = (dados.lotes || []).filter(l => noPer(String(l.enviado_em).slice(0, 10)))
  const cobr = (dados.cobrancas || []).filter(g => noPer(String(g.enviado_em).slice(0, 10)))
  const resumos = (dados.resumos || []).filter(r => noPer(String(r.enviado_em).slice(0, 10)))
  const respPer = respostas.filter(r => noPer(String(r.recebido_em).slice(0, 10))), convPer = conversas.filter(r => noPer(String(r.recebido_em).slice(0, 10)))
  const TEMA = t => String(t || '').replace(/_/g, ' ')

  // ── pendências do cliente ──
  const pend = dados.pendencias || { itens: [], registros: [], dependencias: [] }
  const regs = pend.registros || [], deps = pend.dependencias || []
  const resolvidas = regs.filter(r => r.resolvida_em).length + deps.filter(d => d.reaberta_em).length
  const emAberto = regs.filter(r => !r.resolvida_em).length + deps.filter(d => !d.reaberta_em).length

  const numeros = {
    meses: meses.map(m => ({ mes: m.mes, de: m.de, ate: m.ate, receita: m.receita, pedidos: m.pedidos, unidades: m.unidades, visitas: m.visitas, conversao: m.conversao, coletados: m.coletados, dias: m.dias })),
    total: { receita: total.receita, pedidos: total.pedidos, unidades: total.unidades, visitas: total.visitas, conversao: total.conversao, coletados: total.coletados, dias: total.dias },
    ritmo_pct: ritmo, tendencia, tarefas_concluidas: concl.length, tarefas_concluidas_ml: conclML.length, tarefas_abertas: abertas.length,
    mlbs_distintos: porMlb.size, intervencoes, medicoes_comparaveis: comp.length,
  }

  const secoes = []
  // ═══ 01 Resumo executivo ═══
  {
    const c1 = `Execução: ${plural(concl.length, 'tarefa concluída', 'tarefas concluídas')} no período (${canaisTxt(concl)})${conclML.length ? `, com ${plural(porMlb.size, 'anúncio', 'anúncios')} do Mercado Livre identificado(s) nos cards e ${plural(intervencoes, 'intervenção', 'intervenções')}` : ''}. Base: cards do Notion com data de conclusão.`
    const c2 = ritmo == null
      ? (total.dia_receita != null ? `Comercial: faturamento médio de ${brl(total.dia_receita)} por dia coletado no período; não há dois meses com coleta para comparar o ritmo.` : 'Comercial: não há vendas coletadas do Mercado Livre neste período (integração ou coleta indisponível).')
      : `Comercial: o faturamento médio diário passou de ${brl(primeiro.dia_receita)} (${mesRot(primeiro.mes)}) para ${brl(ultimo.dia_receita)} (${mesRot(ultimo.mes)}${ultimo.cortado || ultimo.coletados < ultimo.dias ? ', parcial' : ''}), variação de ${var_(ritmo)}. Base: pedidos pagos coletados do Mercado Livre, normalizados por dia.`
    const c3 = comp.length
      ? `Medição: ${plural(comp.length, 'tarefa do Mercado Livre foi medida', 'tarefas do Mercado Livre foram medidas')} com grupo de controle — ${int(contaEst('melhorou'))} com melhora associada, ${int(contaEst('sem_efeito'))} sem efeito distinguível e ${int(contaEst('piorou'))} com piora associada; ${int(medidas.length - comp.length)} ainda em maturação ou sem base suficiente.`
      : `Medição: nenhuma tarefa do período tem ainda medição comparável com grupo de controle (${int(medidas.length)} em maturação, sem base ou sem anúncio identificado).`
    const correta = tendencia === 'queda'
      ? 'Conclusão correta: é possível demonstrar trabalho contínuo e registrado; o ritmo de vendas caiu no período e nenhuma ação isolada explica sozinha essa variação sem comparação específica e controle.'
      : tendencia === 'crescimento'
        ? 'Conclusão correta: é possível demonstrar trabalho contínuo e crescimento; não é possível atribuir com certeza todo o crescimento a cada otimização sem comparação específica e controle.'
        : 'Conclusão correta: é possível demonstrar trabalho contínuo e registrado; não é possível atribuir com certeza a variação das vendas a cada otimização sem comparação específica e controle.'
    secoes.push(sec('01', 'resumo', 'Resumo executivo', [
      kpis([
        { rotulo: 'Faturamento no período', valor: brl(total.receita), sub: `${int(total.coletados)} de ${int(total.dias)} dia(s) coletados` },
        { rotulo: 'Pedidos pagos', valor: int(total.pedidos), sub: `${int(total.unidades)} unidade(s)` },
        { rotulo: 'Visitas', valor: int(total.visitas), sub: total.anuncios_com_visitas ? `${int(total.anuncios_com_visitas)} anúncio(s) com visitas coletadas` : 'visitas não coletadas no período inteiro' },
        { rotulo: 'Tarefas concluídas', valor: int(concl.length), sub: `${int(abertas.length)} em aberto no fim do período` },
      ]),
      tabela(['Mês', 'Faturamento', 'Pedidos', 'Visitas', 'Conversão'], meses.map(m => [mesRot(m.mes) + (parcialTxt(m) ? ' *' : ''), brl(m.receita), int(m.pedidos), int(m.visitas), pct(m.conversao)]),
        { num: [1, 2, 3, 4], nota: meses.some(parcialTxt) ? `* Mês parcial — ${meses.filter(parcialTxt).map(m => `${mesRot(m.mes)}: ${parcialTxt(m)}`).join('; ')}.` : '' }),
      h3('Três conclusões fundamentadas'),
      lista([c1, c2, c3]),
      aviso('info', correta),
    ], 'F1 Notion · F2 Pedidos do Mercado Livre · F3 Visitas · F6 Livro de registro'))
  }
  // ═══ 02 Visão comercial ═══
  secoes.push(sec('02', 'comercial', 'Visão comercial', [
    tabela(['Mês', 'Vendas brutas', 'Qtd. de vendas', 'Unidades', 'Visitas', 'Conversão', 'Preço médio', 'Canceladas'],
      meses.map(m => [mesRot(m.mes) + (parcialTxt(m) ? ' *' : ''), brl(m.receita), int(m.pedidos), int(m.unidades), int(m.visitas), pct(m.conversao), brl(m.preco_medio), '—']), { num: [1, 2, 3, 4, 5, 6, 7] }),
    h3('Média diária — para comparar o ritmo entre meses de tamanhos diferentes'),
    tabela(['Mês', 'Faturamento/dia', 'Vendas/dia', 'Unidades/dia', 'Visitas/dia', 'Dias coletados'],
      meses.map(m => [mesRot(m.mes), brl(m.dia_receita), m.dia_pedidos == null ? '—' : F1.format(m.dia_pedidos), m.dia_unidades == null ? '—' : F1.format(m.dia_unidades), m.dia_visitas == null ? '—' : F1.format(m.dia_visitas), `${int(m.coletados)}/${int(m.dias)}`]), { num: [1, 2, 3, 4, 5] }),
    p(`${meses.some(parcialTxt) ? `* Mês parcial — ${meses.filter(parcialTxt).map(m => `${mesRot(m.mes)}: ${parcialTxt(m)}`).join('; ')}. ` : ''}Vendas brutas = soma de preço × quantidade dos pedidos pagos do dia. Canceladas: — (a coleta registra só pedidos pagos; o cancelamento não é coletado por dia). Conversão = unidades ÷ visitas, só nos anúncios com visitas coletadas no mês inteiro. Dia sem coleta não entra como zero.${ate >= addDias(hoje, -2) ? ` Os dias a partir de ${dm(addDias(hoje, -2))} ainda podem mudar: a coleta relê os pedidos até 3 dias depois.` : ''}`, 'nota'),
  ], 'F2 Pedidos do Mercado Livre · F3 Visitas'))
  // ═══ 03 Execução registrada ═══
  {
    const blocos = [kpis([
      { rotulo: 'Concluídas', valor: int(concl.length), sub: canaisTxt(concl) },
      { rotulo: 'Criadas no período', valor: int(criadas.length), sub: 'pela data de início no Notion' },
      { rotulo: 'Em aberto', valor: int(abertas.length), sub: 'no fim do período' },
    ])]
    for (const m of meses) {
      const l = concl.filter(t => t.data_conclusao >= m.de && t.data_conclusao <= m.ate)
      blocos.push(h3(`${mesRot(m.mes)} · ${plural(l.length, 'tarefa concluída', 'tarefas concluídas')}`))
      blocos.push(tabela(['Conclusão', 'Canal', 'Tarefa', 'Demanda', 'Responsável'], l.map(t => [dm(t.data_conclusao), t.processo || 'Geral', limpo(t.titulo, 110), t.tipo_demanda || '—', corta(t.responsavel, 40) || '—'])))
    }
    blocos.push(p(`Concluído comprova o encerramento no Notion; a prova técnica de cada edição exige o histórico do Mercado Livre (seção 09).${conclSemData.length ? ` ${plural(conclSemData.length, 'tarefa iniciada no período está concluída', 'tarefas iniciadas no período estão concluídas')} sem data de conclusão no Notion e fica(m) fora da cronologia.` : ''}`, 'nota'))
    secoes.push(sec('03', 'execucao', 'Execução registrada', blocos, 'F1 Notion (data de conclusão do card)'))
  }
  // ═══ 04 Solicitações diretas do cliente ═══
  {
    const sol = tarefas.filter(t => solicitacaoSeller(t.etiquetas, t.prioridade) && (noPer(t.data_inicio) || noPer(t.data_conclusao) || ((ehAberta(t) || ehDependencia(t)) && (!t.data_inicio || t.data_inicio <= ate))))
      .sort((a, b) => String(a.data_inicio || a.data_conclusao).localeCompare(String(b.data_inicio || b.data_conclusao)))
    numeros.solicitacoes = sol.length
    numeros.solicitacoes_concluidas = sol.filter(t => t.status === 'concluida').length
    secoes.push(sec('04', 'solicitacoes', 'Solicitações diretas do cliente', [
      p(`${plural(sol.length, 'solicitação registrada', 'solicitações registradas')} com a etiqueta «Solicitação Seller» no Notion; ${int(numeros.solicitacoes_concluidas)} concluída(s).`),
      tabela(['Demanda', 'Data', 'Conclusão', 'Responsável'], sol.map(t => [limpo(t.titulo, 110), dm(t.data_inicio), t.status === 'concluida' ? dm(t.data_conclusao) : `em aberto (${t.status_raw || t.status})`, corta(t.responsavel, 40) || '—']),
        { vazio: 'Nenhuma tarefa com a etiqueta «Solicitação Seller» no período.' }),
    ], 'F1 Notion (etiqueta «Solicitação Seller»)'))
  }
  // ═══ 05 Anúncios trabalhados ═══
  {
    const semMlb = conclML.filter(t => !(t.itens || []).length).length
    const vezes = [...porMlb.values()].reduce((m, x) => (m[Math.min(x.n, 3)] = (m[Math.min(x.n, 3)] || 0) + 1, m), {})
    secoes.push(sec('05', 'anuncios', 'Anúncios trabalhados', [
      kpis([
        { rotulo: 'Intervenções', valor: int(intervencoes), sub: 'tarefa × anúncio' },
        { rotulo: 'Anúncios distintos', valor: int(porMlb.size), sub: 'MLBs do Mercado Livre' },
        { rotulo: 'Tarefas ML sem anúncio identificado', valor: int(semMlb), sub: `de ${int(conclML.length)} concluídas no Mercado Livre` },
      ]),
      tabela(['Trabalhado', 'Anúncios'], [['1 vez', int(vezes[1] || 0)], ['2 vezes', int(vezes[2] || 0)], ['3 vezes ou mais', int(vezes[3] || 0)]], { num: [1] }),
      p('O anúncio entra quando o código MLB (ou o link) está no card, quando a tarefa nasceu de uma ação do plano por anúncio, ou quando a equipe confirmou o vínculo. Semelhança de texto nunca conta.', 'nota'),
    ], 'F1 Notion · vínculo tarefa ↔ anúncio'))
  }
  // ═══ 06 Rastreabilidade dos MLBs ═══
  secoes.push(sec('06', 'rastreabilidade', 'Rastreabilidade dos MLBs', [
    tabela(['MLB', 'Anúncio', 'Vezes', 'Tarefas (conclusão)'], [...porMlb].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
      .map(([id, x]) => [id, limpo(tituloItem.get(id) || '—', 70), `${x.n}×`, x.tarefas.map(t => `${limpo(t.titulo, 60)} (${dm(t.data_conclusao)})`).join(' · ')]),
    { vazio: 'Nenhum anúncio identificado nos cards concluídos do Mercado Livre neste período.' }),
  ], 'F1 Notion · vínculo tarefa ↔ anúncio'))
  // ═══ 07 Exemplos de anúncios (antes → depois) ═══
  {
    const ORD = { melhorou: 0, sem_efeito: 1, piorou: 2 }
    const escolhidos = comp.slice().sort((a, b) => ORD[a.estado] - ORD[b.estado] || Math.abs(b.efeito_pct || 0) - Math.abs(a.efeito_pct || 0)).slice(0, C.max_exemplos)
    const blocos = []
    const met = (m, k, f) => m?.metricas?.[k] ? `${f(m.metricas[k].antes)} → ${f(m.metricas[k].depois)}` : '—'
    const EST = { melhorou: 'melhora associada', sem_efeito: 'sem efeito distinguível', piorou: 'piora associada' }
    for (const m of escolhidos) {
      blocos.push(h3(`${limpo(m.titulo, 90)} · ${(m.itens || []).join(', ') || 'conta'}`))
      blocos.push(tabela(['Indicador (média por dia)', 'Antes → depois'], [
        ['Faturamento', met(m, 'receita', brl)], ['Unidades', met(m, 'unidades', v => F1.format(v))], ['Visitas', met(m, 'visitas', v => F1.format(v))], ['Conversão', met(m, 'conversao', pct)],
      ]))
      blocos.push(p(`Concluída em ${dm(m.data)}; janelas ${dm(m.janelas?.pre?.[0])}–${dm(m.janelas?.pre?.[1])} × ${dm(m.janelas?.pos_medida?.[0] || m.janelas?.pos?.[0])}–${dm(m.janelas?.pos_medida?.[1] || m.janelas?.pos?.[1])}. Efeito ajustado pelo grupo de controle (anúncios que ninguém tocou), medido em ${m.metrica_primaria === 'visitas' ? 'visitas' : 'unidades vendidas'}: ${var_(m.efeito_pct)} — ${EST[m.estado]}.`, 'nota'))
    }
    // completa com mudanças COMPROVADAS do anúncio (histórico do ML), variação bruta sem controle — nunca mais que o teto
    const CONTEUDO = new Set(['titulo', 'fotos', 'thumb', 'descricao', 'atributos'])
    const usados = new Set(escolhidos.flatMap(m => m.itens || []))
    const brutos = []
    for (const mu of (dados.mudancas || []).filter(x => CONTEUDO.has(x.campo) && noPer(x.dia)).sort((a, b) => b.dia.localeCompare(a.dia))) {
      if (escolhidos.length + brutos.length >= C.max_exemplos) break
      if (usados.has(mu.item_id)) continue
      const antes = [addDias(mu.dia, -14), addDias(mu.dia, -1)], depois = [addDias(mu.dia, 1), addDias(mu.dia, 14)]
      if (depois[1] > ate) continue                                                     // janela depois ainda não fechou: não é exemplo
      const ja = (dados.coleta || []).filter(c => (c.dia >= antes[0] && c.dia <= antes[1]) || (c.dia >= depois[0] && c.dia <= depois[1])).length
      if (ja < 28) continue                                                             // exige as duas janelas inteiras coletadas
      const soma = ([a, b], k) => (dados.serie || []).filter(s => s.item_id === mu.item_id && s.dia >= a && s.dia <= b).reduce((t, s) => t + (Number(s[k]) || 0), 0)
      usados.add(mu.item_id); brutos.push(mu)
      blocos.push(h3(`Mudança de ${(ROT_CAMPO[mu.campo] || mu.campo).toLowerCase()} · ${mu.item_id}`))
      blocos.push(tabela(['Indicador (14 dias)', 'Antes → depois'], [
        ['Faturamento', `${brl(r2(soma(antes, 'receita')))} → ${brl(r2(soma(depois, 'receita')))}`], ['Unidades', `${int(soma(antes, 'unidades'))} → ${int(soma(depois, 'unidades'))}`],
        ['Visitas', `${int(soma(antes, 'visitas'))} → ${int(soma(depois, 'visitas'))}`]]))
      blocos.push(p(`Mudança lida no anúncio em ${dm(mu.dia)}: «${valMud(mu.campo, mu.de)}» → «${valMud(mu.campo, mu.para)}». Variação bruta, sem grupo de controle.`, 'nota'))
    }
    numeros.exemplos = escolhidos.length + brutos.length
    if (!blocos.length) blocos.push(p('— Nenhum exemplo disponível: no período não há medição com grupo de controle concluída nem mudança de conteúdo com as duas janelas de 14 dias coletadas.', 'mudo'))
    blocos.push(aviso('info', 'Ressalva', 'Os exemplos mostram associação temporal entre a ação e os números do anúncio; não equivale à comprovação de causalidade. Preço, promoção, estoque, sazonalidade e o mercado também mexem nas vendas.'))
    secoes.push(sec('07', 'exemplos', 'Exemplos de anúncios', blocos, 'F2 Pedidos · F3 Visitas · F5 Histórico do anúncio · medição com grupo de controle'))
  }
  // ═══ 08 Evidências de execução (prints dos cards) ═══
  {
    const porTarefa = new Map(concl.map(t => [t.id, t]))
    const vistos = new Set(), ev = []
    const peso = t => (solicitacaoSeller(t.etiquetas, t.prioridade) ? 0 : 2) + ((t.itens || []).length ? 0 : 1)
    // ponytail: o print de um card pode ser de ferramenta interna (bot do Discord com o WhatsApp do cliente, tela do ERP) e nada no arquivo distingue — a versão CLIENTE
    // nunca embute imagem: lista o card, a data e a impressão digital (sha256); a defesa (interna) embute. Seleção manual de prints ao cliente: quando houver tela para aprovar.
    for (const e of (dados.evidencias || []).filter(e => porTarefa.has(e.tarefa_id) && e.abs && Number(e.bytes) <= C.max_bytes_evidencia)
      .sort((a, b) => peso(porTarefa.get(a.tarefa_id)) - peso(porTarefa.get(b.tarefa_id)) || porTarefa.get(b.tarefa_id).data_conclusao.localeCompare(porTarefa.get(a.tarefa_id).data_conclusao))) {
      if (vistos.has(e.tarefa_id) || ev.length >= C.max_evidencias) continue
      vistos.add(e.tarefa_id); const t = porTarefa.get(e.tarefa_id)
      ev.push({ abs: e.abs, arquivo: e.arquivo, sha256: e.sha256, no_livro: e.no_livro !== false, titulo: limpo(t.titulo, 90), concluida: dm(t.data_conclusao), legenda: `${limpo(t.titulo, 90)} · concluída em ${dm(t.data_conclusao)}${e.criada_em ? ` · anexado em ${dm(e.criada_em)}` : ''}` })
    }
    const totalAnexos = (dados.evidencias_total ?? (dados.evidencias || []).length)
    const noLivro = ev.filter(e => e.no_livro).length
    numeros.evidencias = ev.length
    numeros.evidencias_no_livro = noLivro
    const livroTxt = !ev.length ? '' : noLivro === ev.length ? ' Cada um tem a impressão digital (sha256) registrada no livro de registro.' : ` ${int(noLivro)} de ${int(ev.length)} já têm a impressão digital (sha256) registrada no livro de registro; os demais entram nas próximas passadas do livro.`
    secoes.push(sec('08', 'evidencias', 'Evidências de execução', [
      p(`${plural(totalAnexos, 'anexo guardado', 'anexos guardados')} nos cards concluídos do período; abaixo, ${plural(ev.length, 'exemplo', 'exemplos')} (um por tarefa, solicitações do cliente e anúncios identificados primeiro).${livroTxt}`),
      !ev.length ? p('— Nenhum print guardado localmente nos cards concluídos do período.', 'mudo')
        : defesa ? { t: 'imagens', itens: ev }
          : tabela(['Tarefa', 'Concluída em', 'Impressão digital do print (sha256)'], ev.map(e => [e.titulo, e.concluida, h12(e.sha256)]), { nota: 'Os prints ficam guardados nos cards; a impressão digital prova que o arquivo não mudou desde o registro.' }),
    ], 'F1 Notion (anexos dos cards) · F6 Livro de registro'))
  }
  // ═══ 09 Histórico do anúncio ═══
  {
    const ROT = ROT_CAMPO
    const FONTE = { coleta: 'leitura diária do anúncio', promo: 'coleta de promoções', ads: 'coleta de Ads', acomp: 'acompanhamento da tarefa', snapshot: 'fotografia do anúncio' }
    const mud = (dados.mudancas || []).filter(m => noPer(m.dia)).sort((a, b) => b.dia.localeCompare(a.dia))
    const porCampo = Object.entries(mud.reduce((m, x) => (m[x.campo] = (m[x.campo] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])
    numeros.mudancas = mud.length
    secoes.push(sec('09', 'historico', 'Evidências no histórico do anúncio', [
      p(`${plural(mud.length, 'alteração registrada', 'alterações registradas')} nos anúncios do Mercado Livre no período, lidas do próprio anúncio: ${porCampo.map(([c, n]) => `${ROT[c] || c} ${int(n)}`).join(' · ') || '—'}.${dados.fotografias ? ` ${plural(dados.fotografias, 'fotografia completa', 'fotografias completas')} de anúncio guardadas no período.` : ''} A leitura registra O QUE mudou no anúncio, de qualquer origem (assessoria, cliente, promoção ou o próprio Mercado Livre); quem fez cada mudança não vem do canal.`),
      tabela(['Dia', 'MLB', 'Campo', 'De → para', 'Lido por'], mud.slice(0, 25).map(m => [dm(m.dia), m.item_id, ROT[m.campo] || m.campo, `${valMud(m.campo, m.de)} → ${valMud(m.campo, m.para)}`, FONTE[m.fonte] || m.fonte]),
        { vazio: 'Nenhuma alteração de anúncio registrada no período.', nota: mud.length > 25 ? `As 25 mais recentes de ${int(mud.length)}; a lista completa está no livro de registro.` : '' }),
    ], 'F5 Histórico do anúncio (alterações e fotografias)'))
  }
  // ═══ 10 Comunicação ═══
  {
    const recibo = l => Object.entries(l.recibos || {}).map(([k, v]) => `${k}: ${v}`).join(', ')
    const linhas = [
      ...rels.map(r => [dm(r.em), 'Relatório no Notion', `período ${dm(r.de)} a ${dm(r.ate)}`, r.estado]),
      ...lotes.map(l => [dm(l.enviado_em), l.tipo === 'semanal' ? 'Plano semanal' : 'Aviso', (l.canais || []).join(', ') || '—', recibo(l) || l.estado]),
      ...(defesa ? resumos.map(r => [dm(r.enviado_em), 'Resumo interno ao time (Discord)', r.chave || '—', r.estado]) : []),
    ].sort((a, b) => a[0].split('/').reverse().join('').localeCompare(b[0].split('/').reverse().join('')))
    numeros.envios = rels.length + lotes.length
    numeros.respostas = respPer.length
    secoes.push(sec('10', 'comunicacao', 'Comunicação registrada', [
      kpis([
        { rotulo: 'Relatórios no Notion', valor: int(rels.length), sub: 'publicados no período' },
        { rotulo: 'Planos e avisos', valor: int(lotes.length), sub: 'enviados com recibo' },
        { rotulo: defesa ? 'Respostas do cliente' : 'Suas respostas registradas', valor: int(respPer.length), sub: 'ao relatório ou ao plano' },
      ]),
      tabela(['Data', 'O quê', 'Detalhe', 'Recibo'], linhas, { vazio: 'Nenhum envio registrado pelo sistema no período (relatórios e mensagens enviados fora do sistema não aparecem aqui).' }),
      ...(respPer.length ? [h3('Respostas registradas'), tabela(['Data', 'Respondeu a', 'Temas'], respPer.map(r => [dm(r.recebido_em), r.ancora_tipo === 'pergunta' ? 'pergunta do relatório' : 'plano da semana', (r.temas || []).map(TEMA).join(', ') || '—']))] : []),
      ...(convPer.length ? [h3('Retornos colhidos pela equipe em conversa'), tabela(['Data', 'Origem', 'Temas'], convPer.map(r => [dm(r.recebido_em), 'conversa com a equipe (não é citação de mensagem)', (r.temas || []).map(TEMA).join(', ') || '—']))] : []),
    ], 'F4 Envios do sistema (relatórios, planos e avisos com recibo) · respostas coletadas do grupo do Mercado Livre'))
  }
  // ═══ 11 O que depende do cliente ═══
  {
    const itens = pend.itens || []
    const blocos = [p(defesa
      ? `${plural(itens.length, 'pendência do cliente aberta', 'pendências do cliente abertas')} hoje; no histórico, ${int(resolvidas)} resolvida(s) e ${int(emAberto)} registrada(s) em aberto. ${plural(cobr.length, 'cobrança enviada', 'cobranças enviadas')} no período.`
      : `Itens que dependem de uma ação da sua equipe para seguirmos no ritmo combinado. ${int(resolvidas)} item(ns) já atendido(s).`)]
    blocos.push(tabela(defesa ? ['Item', 'Canal', 'Desde', 'Gravidade', 'Evidência'] : ['Item', 'Canal', 'Desde', 'O que precisamos'],
      itens.map(x => defesa ? [x.rotulo, x.canal_rotulo, x.desde && !x.desde_aproximado ? dm(x.desde) : '— (data aproximada)', x.gravidade_rotulo || x.gravidade, limpo(x.evidencia, 120)]
        : [x.rotulo, x.canal_rotulo, x.desde && !x.desde_aproximado ? dm(x.desde) : '—', limpo(x.o_que_precisamos, 160) || '—']), { vazio: 'Nada pendente do seu lado neste momento.' }))
    if (defesa && cobr.length) blocos.push(h3('Cobranças enviadas'), tabela(['Enviada em', 'Aviso', 'Resolvido'], cobr.map(g => [dm(g.enviado_em), limpo(g.texto, 140), g.resolvido_em ? dm(g.resolvido_em) : 'não'])))
    if (pend.erro) blocos.push(p(`— Avaliação das pendências indisponível: ${pend.erro}.`, 'mudo'))
    secoes.push(sec('11', 'depende', 'O que depende do cliente', blocos, 'Pendências do cliente (catálogo por canal, tarefas aguardando o cliente e registros da equipe)'))
  }
  // ═══ 12 Product Ads ═══
  {
    const ads = dados.ads || []
    const janelas = [...new Map(ads.map(a => [`${a.de}|${a.ate}`, { de: a.de, ate: a.ate, periodo: a.periodo }])).values()].sort((a, b) => a.de.localeCompare(b.de))
    const tot = j => { const l = ads.filter(a => a.de === j.de && a.ate === j.ate); const s = k => l.reduce((t, a) => t + (Number(a[k]) || 0), 0)
      return { custo: r2(s('custo')), receita: r2(s('receita')), clicks: s('clicks'), prints: s('prints'), unidades: s('unidades'), anuncios: l.filter(a => a.custo > 0).length } }
    const tj = janelas.map(j => ({ ...j, ...tot(j) }))
    numeros.ads = tj.map(j => ({ de: j.de, ate: j.ate, custo: j.custo, receita: j.receita }))
    const ult = janelas.at(-1)
    const top = ult ? ads.filter(a => a.de === ult.de && a.ate === ult.ate && a.custo > 0).sort((a, b) => b.custo - a.custo).slice(0, 10) : []
    secoes.push(sec('12', 'ads', 'Product Ads', [
      tabela(['Janela', 'Investimento', 'Receita atribuída', 'ACOS', 'ROAS', 'Cliques', 'Impressões', 'Anúncios com gasto'],
        tj.map(j => [faixa(j.de, j.ate), brl(j.custo), brl(j.receita), j.receita > 0 ? pct(100 * j.custo / j.receita) : '—', j.custo > 0 ? F2.format(j.receita / j.custo) : '—', int(j.clicks), int(j.prints), int(j.anuncios)]),
        { num: [1, 2, 3, 4, 5, 6, 7], vazio: '— Product Ads não coletado para este cliente (sem campanha ativa ou sem leitura de Ads).' }),
      ...(top.length ? [h3(`Estrutura: anúncios com maior investimento (${dm(ult.de)} a ${dm(ult.ate)})`),
        tabela(['MLB', 'Anúncio', 'Investimento', 'Receita', 'ACOS', 'Cliques'], top.map(a => [a.item_id, limpo(tituloItem.get(a.item_id) || '—', 60), brl(a.custo), brl(a.receita), a.receita > 0 ? pct(100 * a.custo / a.receita) : '—', int(a.clicks)]), { num: [2, 3, 4, 5] })] : []),
      p('Dados por anúncio, nas janelas de 28 dias que a coleta lê do Mercado Ads. Campanha: não suportado pela coleta atual (a leitura disponível é por anúncio, não por campanha) — a leitura por campanha fica nos painéis do Mercado Ads.', 'nota'),
    ], 'F4 Mercado Ads (por anúncio)'))
  }
  // ═══ 13 Evolução comparável ═══
  {
    const base = mesesCheios[0]
    secoes.push(sec('13', 'evolucao', 'Evolução comparável', [
      tabela(['Mês', 'Faturamento/dia', 'vs 1º mês', 'Vendas/dia', 'vs 1º mês', 'Conversão'], meses.map(m => [mesRot(m.mes) + (parcialTxt(m) ? ' *' : ''), brl(m.dia_receita),
        base && m !== base && base.dia_receita > 0 && m.dia_receita != null ? var_((m.dia_receita / base.dia_receita - 1) * 100) : '—', m.dia_pedidos == null ? '—' : F1.format(m.dia_pedidos),
        base && m !== base && base.dia_pedidos > 0 && m.dia_pedidos != null ? var_((m.dia_pedidos / base.dia_pedidos - 1) * 100) : '—', pct(m.conversao)]), { num: [1, 2, 3, 4, 5] }),
      p('Normalizado por dia coletado: meses de tamanhos diferentes e o mês parcial ficam comparáveis. A variação é do conjunto da conta e inclui sazonalidade, preço e mercado.', 'nota'),
    ], 'F2 Pedidos · F3 Visitas'))
  }
  // ═══ 14 Fotografia recente ═══
  {
    const a = addDias(ate, -6) < de ? de : addDias(ate, -6), j = janelaComercial(dados, a, ate)
    const NIVEL = { '1_red': 'vermelha', '2_orange': 'laranja', '3_yellow': 'amarela', '4_light_green': 'verde-claro', '5_green': 'verde' }
    const sd = dados.saude, ativos = (dados.itens || []).filter(i => i.status === 'active').length
    numeros.recente = { de: a, ate, receita: j.receita, pedidos: j.pedidos }
    secoes.push(sec('14', 'recente', 'Fotografia recente', [
      kpis([
        { rotulo: `Faturamento ${dm(a).slice(0, 5)}–${dm(ate).slice(0, 5)}`, valor: brl(j.receita), sub: `${int(j.coletados)} de ${int(j.dias)} dia(s) coletados` },
        { rotulo: 'Pedidos pagos', valor: int(j.pedidos), sub: `ticket médio ${j.pedidos ? brl(r2(j.receita / j.pedidos)) : '—'}` },
        { rotulo: 'Conversão', valor: pct(j.conversao), sub: j.anuncios_com_visitas ? `${int(j.anuncios_com_visitas)} anúncio(s) com visitas` : 'sem visitas coletadas' },
        { rotulo: 'Anúncios ativos', valor: int(ativos), sub: `reputação ${sd?.level_id ? NIVEL[sd.level_id] || sd.level_id : '—'}${sd?.dia ? ` em ${dm(sd.dia)}` : ''}` },
      ]),
    ], 'F2 Pedidos · F3 Visitas · saúde da conta (coleta diária)'))
  }
  // ═══ 15 Rentabilidade e governança ═══
  {
    const e = dados.economia, adsUlt = numeros.ads.at(-1)
    const tacos = adsUlt && adsUlt.de >= de && adsUlt.ate <= ate ? (() => { const j = janelaComercial(dados, adsUlt.de, adsUlt.ate); return j.receita > 0 && j.coletados === j.dias ? r2(100 * adsUlt.custo / j.receita) : null })() : null
    secoes.push(sec('15', 'rentabilidade', 'Rentabilidade e governança', e ? [
      kpis([
        { rotulo: 'Margem antes de Ads', valor: pct(e.margem_pre_ads_pct), sub: 'pelos custos informados' },
        { rotulo: 'ACOS máximo', valor: pct(e.acos_max_pct), sub: `preserva a margem desejada de ${pct(e.margem_desejada_pct)}` },
        { rotulo: 'ROAS mínimo', valor: e.roas_alvo != null ? F2.format(e.roas_alvo) : '—', sub: `equilíbrio em ${e.roas_breakeven != null ? F2.format(e.roas_breakeven) : '—'}` },
        { rotulo: 'TACOS (Ads ÷ faturamento)', valor: pct(tacos), sub: adsUlt ? `${dm(adsUlt.de)} a ${dm(adsUlt.ate)}` : 'sem Ads coletado' },
      ]),
      p(`Simulação com a margem INFORMADA pelo cliente${dados.custos_em ? ` (atualizada em ${dm(dados.custos_em)})` : ''}: CMV, comissão, imposto, frete, embalagem e outros em % do preço. Contribuição não é lucro líquido (despesas fixas ficam fora). Exige validação de custos antes de qualquer decisão de preço ou verba.`, 'nota'),
    ] : [
      aviso('atencao', 'Não validado', 'Os custos do cliente (CMV, comissão, imposto, frete, embalagem e margem desejada) não foram informados: não existe ACOS máximo, ROAS mínimo nem margem por anúncio. As leituras de Ads da seção 12 são de volume, não de rentabilidade.'),
    ], 'Custos informados pelo cliente · F4 Mercado Ads · F2 Pedidos'))
  }
  // ═══ 16 Resposta às solicitações ═══
  {
    const sol = tarefas.filter(t => solicitacaoSeller(t.etiquetas, t.prioridade) && (noPer(t.data_inicio) || noPer(t.data_conclusao)))
      .sort((a, b) => String(a.data_conclusao || a.data_inicio).localeCompare(String(b.data_conclusao || b.data_inicio)))
    const temas = new Map()
    for (const r of [...respPer, ...convPer]) for (const t of r.temas || []) if (!temas.has(t)) temas.set(t, r)
    const linhas = [
      ...(defesa ? (dados.riscos || []).filter(r => r.estado === 'aberto').map(r => [`${r.motivo_rotulo}${r.descricao ? `: ${limpo(r.descricao, 120)}` : ''}`, `em risco desde ${dm(r.desde)} (marcado por ${r.por})`, 'Marcação interna (livro de registro)']) : []),
      ...sol.map(t => [limpo(t.titulo, 110), t.status === 'concluida' ? `Concluída em ${dm(t.data_conclusao)}` : `Em aberto (${t.status_raw || t.status})`, `Card no Notion${t.anexos ? ` · ${plural(t.anexos, 'anexo', 'anexos')}` : ''}`]),
      ...[...temas].map(([t, r]) => [`Tema citado pelo cliente: ${TEMA(t)}`, `Registrado ${r.origem === 'equipe' ? 'na conversa' : 'na resposta'} de ${dm(r.recebido_em)}`, r.origem === 'equipe' ? 'Conversa com a equipe (registrada pela equipe)' : 'Resposta ao relatório (grupo do Mercado Livre)']),
    ]
    secoes.push(sec('16', 'respostas', 'Resposta às solicitações', [
      tabela(['Tema cobrado', 'Situação', 'Base documental'], linhas, { vazio: 'Nenhuma solicitação direta ou tema cobrado registrado no período.' }),
    ], 'F1 Notion · respostas do cliente'))
  }
  // ═══ 17 Plano de continuidade ═══
  // só ações APROVADAS (aprovada = a distribuir; distribuida = virou tarefa no Notion): proposta do algoritmo que ninguém aprovou nunca é compromisso. Da distribuída valem o
  // status, o prazo e o responsável da TAREFA; dono = cliente quando a ação é do caminho «cliente» (estoque, custos…); sem responsável = consultor da capa.
  // Cliente: só o que está em aberto e no prazo (vencida sai — reprazar é da equipe). Defesa: tudo o que está aberto, com a situação real (vencida inclusive).
  {
    const ST = t => ROTULOS[t] ? ROTULOS[t].toLowerCase() : String(t || '').replace(/_/g, ' ')
    const emAbertoT = st => !st || ehAberta({ status: st }) || ehDependencia({ status: st })   // tarefa ainda não entregue (status-tarefa.js); sem tarefa = ação aprovada a distribuir
    const plano = (dados.plano || []).filter(a => ['aprovada', 'distribuida'].includes(a.status) && emAbertoT(a.tarefa_status))
      .map(a => { const prazo = a.tarefa_prazo || a.prazo || '', doCliente = a.caminho === 'cliente'
        return { ...a, prazo, vencida: !!prazo && prazo < hoje, resp: doCliente ? (defesa ? 'Cliente' : 'Sua equipe') : corta(a.tarefa_responsavel || a.responsavel, 40) || consultor || '—' } })
      .filter(a => defesa || (a.prazo && !a.vencida))
      .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 8)
    const sit = a => a.status === 'aprovada' ? 'aprovada, a iniciar' : defesa ? `tarefa ${ST(a.tarefa_status) || 'sem status lido'}`
      : a.tarefa_status === 'nao_iniciada' ? 'agendada' : a.tarefa_status === 'dependencia_cliente' ? 'aguardando sua equipe' : 'em execução'
    numeros.plano = plano.length
    secoes.push(sec('17', 'continuidade', 'Plano de continuidade', [
      tabela(['Ação', 'Responsável', 'Prazo', 'Situação'], plano.map(a => [limpo(a.titulo, 120), a.resp, dm(a.prazo), defesa && a.vencida ? `${sit(a)} · VENCIDA` : sit(a)]),
        { vazio: '— Sem ações aprovadas em aberto para o próximo período.' }),
      p('Método de cada ação: registrar o dado observado → hipótese → ação autorizada → prazo de observação → resultado medido (antes × depois com controle). Hipótese é hipótese: não há promessa de vendas ou posição.', 'nota'),
    ], 'Plano de ação aprovado'))
  }
  // ═══ 18 Fontes e critérios ═══
  {
    const lv = dados.livro || {}, prim = lv.primeiro_registro || ''
    secoes.push(sec('18', 'fontes', 'Fontes e critérios', [
      tabela(['Fonte', 'O que é', 'Cobertura neste documento'], [
        ['F1 Notion', 'Cards de tarefa dos quadros do cliente (título, canal, responsável, status, datas, etiquetas, anexos)', `${int(tarefas.length)} card(s) no período; ${int(conclSemData.length)} concluído(s) sem data`],
        ['F2 Pedidos do Mercado Livre', 'Pedidos pagos lidos por dia no Mercado Livre (vendas brutas, quantidade, unidades)', `${int(total.coletados)} de ${int(total.dias)} dia(s) coletados${total.truncados ? `; ${int(total.truncados)} truncado(s)` : ''}`],
        ['F3 Visitas', 'Visitas por anúncio por dia (mais vendidos e anúncios citados em tarefas)', total.anuncios_com_visitas ? `${int(total.anuncios_com_visitas)} anúncio(s) com o período inteiro` : 'sem cobertura no período inteiro'],
        ['F4 Envios e Ads', 'Relatórios, planos e avisos enviados pelo sistema com recibo; Mercado Ads por anúncio', `${int(numeros.envios)} envio(s); ${int((numeros.ads || []).length)} janela(s) de Ads`],
        ['F5 Histórico do anúncio', 'Mudanças lidas do próprio anúncio (preço, título, fotos, frete, status, promoção, Ads, Full) e fotografias completas', `${int(numeros.mudancas || 0)} mudança(s)`],
        ['F6 Livro de registro', 'Registro imutável e encadeado por cliente de cada fato acima (data da fonte, data de entrada no livro e hash)', lv.cabeca ? `${prim ? `desde ${dm(prim)}; ` : ''}último elo seq ${lv.cabeca.seq} · ${h12(lv.cabeca.hash)}${lv.verificacao ? (lv.verificacao.ok ? ' · cadeia íntegra' : ' · CADEIA COM QUEBRA') : ''}` : '— livro ainda sem registros deste cliente'],
      ]),
      lista([
        `Período: ${dm(de)} a ${dm(ate)}. Mês parcial é declarado na tabela; média diária usa só dias coletados (dia sem coleta não é zero).`,
        'Número ausente aparece como — com o motivo; nada é estimado em silêncio.',
        'Antes × depois de tarefa: associação temporal ajustada por grupo de controle e ruído; nunca comprovação de causalidade.',
        'Rentabilidade só com custos informados pelo cliente; sem eles, "não validado".',
        ...(prim ? [`Livro de registro: começou em ${dm(prim)}; o que aconteceu antes foi importado das fontes nesse dia. O hash prova que nada mudou depois da entrada no livro, não a data original do fato — essa vem da fonte.`] : []),
        `Documento gerado em ${dm(hoje)} pela Place2u a partir das fontes acima; a impressão digital (sha256) deste arquivo entra no livro de registro.`,
      ]),
    ], ''))
  }

  // ════════ versão DEFESA ════════
  let status = 'n/a', pendencias = []
  if (defesa) {
    const lv = dados.livro || { itens: [], cabeca: null, verificacao: null }
    const contrato = dados.contrato || null, pagamentos = dados.pagamentos || []
    const prazo = addDias(hoje, C.prazo_pendencia_dias)
    // varredura: tarefas (registro interno) × textos que NÓS enviamos (planos, avisos, cobranças, resumos ao time)
    const textosTarefas = tarefas.map(t => ({ fonte: 'tarefa', ref: t.titulo, data: t.data_conclusao || t.data_inicio, texto: [t.titulo, t.texto].filter(Boolean).join('\n') }))
    const textosEnviados = [...lotes.map(l => ({ fonte: l.tipo === 'semanal' ? 'plano semanal enviado' : 'aviso enviado', ref: `lote ${l.id}`, data: l.enviado_em, texto: l.texto })),
      ...cobr.map(g => ({ fonte: 'cobrança enviada', ref: `aviso ${g.id}`, data: g.enviado_em, texto: g.texto })), ...resumos.map(r => ({ fonte: 'resumo ao time (Discord)', ref: `resumo ${r.id}`, data: r.enviado_em, texto: r.texto }))].filter(x => x.texto)
    const achTarefas = varrerAdmissao(textosTarefas, C.frases_admissao), achEnviados = varrerAdmissao(textosEnviados, C.frases_admissao)
    const LIMITE = 'Limite: conversas da equipe no WhatsApp/Discord não são lidas pelo sistema; a varredura cobre só os textos guardados aqui (cards do Notion, planos, avisos, cobranças e resumos enviados).'
    // tentativas de contato: cada envio × resposta registrada em até N dias. Só dá para afirmar «sem resposta» quando o coletor de respostas PODIA captá-la: envio que é
    // âncora do coletor (mensagem nossa no grupo do Mercado Livre com a assinatura da assessoria ou a pergunta do relatório — `ancora`, marcado na coleta), feito depois
    // que o coletor começou a ler este cliente (`coletor.desde`) e com a janela já fechada. O resto é «resposta não verificável pelo sistema», nunca silêncio.
    const coletor = dados.coletor || {}
    const envios = [...rels.map(r => ({ em: r.em, oque: 'Relatório no Notion', ancora: false })), ...lotes.map(l => ({ em: l.enviado_em, oque: l.tipo === 'semanal' ? 'Plano semanal' : 'Aviso', ancora: !!l.ancora })),
      ...cobr.map(g => ({ em: g.enviado_em, oque: 'Cobrança de pendência', ancora: !!g.ancora }))].sort((a, b) => String(a.em).localeCompare(String(b.em)))
    const tentativas = envios.map(e => { const lim = addDias(diaIso(e.em), C.janela_resposta_dias); const r = respostas.find(x => x.recebido_em >= e.em && diaIso(x.recebido_em) <= lim)
      return { ...e, resposta: r?.recebido_em || '', verificavel: e.ancora && !!coletor.desde && String(e.em) >= coletor.desde && lim < hoje } })
    const verificaveis = tentativas.filter(t => t.verificavel).length
    const semResposta = tentativas.filter(t => t.verificavel && !t.resposta).length, naoVerif = tentativas.filter(t => !t.verificavel && !t.resposta).length
    const abertasHoje = (pend.itens || []).length
    const relTarefas = concl.filter(t => /relat[oó]rio|reuni[aã]o/i.test(`${t.tipo_demanda} ${t.titulo}`))
    // balanço (só o que o histórico prova)
    const acessoRegs = [...deps.filter(d => d.tipo === 'acesso').map(d => ({ em: d.em, txt: 'tarefa aguardando acesso do cliente', fim: d.reaberta_em })), ...regs.filter(r => r.item === 'acesso_conta').map(r => ({ em: r.desde || r.criada_em, txt: `pendência de acesso (${r.canal})`, fim: r.resolvida_em })),
      ...(dados.conta_ml?.erro ? [{ em: dados.conta_ml.atualizado_em, txt: 'conexão do Mercado Livre com erro de autorização', fim: '' }] : [])]
    const estoque = (dados.cobrancas || []).filter(g => ['ruptura_curva_a', 'ciclo_estoque_previsto'].includes(g.tipo) && noPer(String(g.enviado_em).slice(0, 10)))
    // custos: só é «aguardando o cliente» quando há PEDIDO registrado (cobrança enviada, em qualquer data, ou pendência/tarefa de custos com data exata); sem isso, «sem registro de pedido»
    const custosCobr = (dados.cobrancas || []).filter(g => g.tipo === 'custos_nao_informados' && g.enviado_em).sort((a, b) => String(a.enviado_em).localeCompare(String(b.enviado_em)))
    const custosPedido = custosCobr[0]?.enviado_em || [...regs.filter(r => /custo/i.test(r.item) && r.desde).map(r => r.desde), ...deps.filter(d => /custo/i.test(d.tipo) && d.em).map(d => d.em)].sort()[0] || ''
    const pausas = (dados.mudancas || []).filter(m => m.campo === 'status' && noPer(m.dia) && /paused|inactive|closed/i.test(String(m.para)))
      .map(m => { const t = tarefas.find(t => (t.itens || []).includes(m.item_id) && t.data_conclusao && Math.abs(diasEntre(t.data_conclusao, m.dia)) <= 3); return { ...m, tarefa: t?.titulo || '' } })
    const respCertas = respPer.filter(r => r.confianca === 'certa')   // só a resposta que CITOU a nossa mensagem prova colaboração; a provável (janela de tempo) fica à parte
    const balanco = [
      ['Respostas do cliente a relatórios e planos', `${plural(respCertas.length, 'com citação da nossa mensagem', 'com citação da nossa mensagem')}${respPer.length > respCertas.length ? ` · ${int(respPer.length - respCertas.length)} provável(is) só pela janela de tempo` : ''}${convPer.length ? ` · ${plural(convPer.length, 'retorno colhido', 'retornos colhidos')} pela equipe em conversa (não é citação)` : ''}`, respCertas.length ? 'colaboração' : 'sem registro'],
      ['Envios sem resposta captada em ' + C.janela_resposta_dias + ' dias', `${int(semResposta)} de ${plural(verificaveis, 'envio verificável', 'envios verificáveis')}${naoVerif ? `; ${int(naoVerif)} sem verificação possível (fora do alcance do coletor)` : ''}`, semResposta ? 'sem resposta captada (coletor limitado)' : '—'],
      ['Pendências do cliente (histórico)', `${int(resolvidas)} resolvida(s) · ${int(emAberto)} em aberto`, emAberto ? 'aguardando o cliente' : resolvidas ? 'colaboração' : '—'],
      ['Custos (CMV, comissão, imposto…)', dados.economia ? `informados${dados.custos_em ? ` em ${dm(dados.custos_em)}` : ''}` : custosPedido ? `não informados — pedido registrado em ${dm(custosPedido)}${custosCobr.length ? ` (${plural(custosCobr.length, 'cobrança enviada', 'cobranças enviadas')})` : ''}` : 'não informados; nenhum pedido registrado no sistema',
        dados.economia ? 'colaboração' : custosPedido ? 'aguardando o cliente' : 'sem registro de pedido'],
      ['Estoque após aviso de ruptura', estoque.length ? `${int(estoque.length)} aviso(s); ${int(estoque.filter(g => g.resolvido_em).length)} resolvido(s) depois` : 'nenhum aviso de estoque enviado', estoque.some(g => !g.resolvido_em) ? 'aguardando o cliente' : '—'],
      ['Acesso à conta', acessoRegs.length ? acessoRegs.map(a => `${a.txt} desde ${dm(a.em)}${a.fim ? ` (resolvido ${dm(a.fim)})` : ''}`).join('; ') : 'nenhum registro de falta de acesso', acessoRegs.some(a => !a.fim) ? 'aguardando o cliente' : '—'],
      ['Anúncios pausados', pausas.length ? `${int(pausas.length)}: ${int(pausas.filter(x => x.tarefa).length)} com tarefa da equipe na data · ${int(pausas.filter(x => !x.tarefa).length)} sem tarefa da equipe (cliente ou plataforma)` : 'nenhuma pausa lida no período', '—'],
    ]
    const ent = contrato?.entregaveis || []
    // definition of done
    const dod = [
      { id: 'contrato', item: 'Contrato assinado (arquivo) cadastrado', ok: !!contrato?.arquivo_sha256, critico: true, responsavel: cs || 'CS responsável', detalhe: contrato ? (contrato.arquivo_sha256 ? `sha256 ${h12(contrato.arquivo_sha256)}` : 'cadastrado sem o arquivo') : 'não cadastrado' },
      { id: 'conferencia_entregaveis', item: 'Conferência item a item dos entregáveis do contrato com a execução', ok: false, critico: false, responsavel: consultor || 'Consultor', detalhe: ent.length ? `${plural(ent.length, 'entregável', 'entregáveis')} no contrato; o sistema não confere item a item` : 'sem lista de entregáveis cadastrada' },
      { id: 'clausula_meio', item: 'Cláusula de obrigação de meio conferida no contrato', ok: contrato?.obrigacao_meio === true, critico: false, responsavel: 'Jurídico', detalhe: contrato?.obrigacao_meio === false ? 'contrato marcado sem obrigação de meio' : contrato?.obrigacao_meio ? 'sim' : 'não informada' },
      { id: 'execucao', item: 'Prova de execução datada no período', ok: concl.length > 0, critico: true, responsavel: consultor || 'Consultor', detalhe: `${int(concl.length)} tarefa(s) concluída(s) com data` },
      { id: 'resultado', item: 'Prova de resultado (vendas coletadas do canal)', ok: total.coletados > 0, critico: true, responsavel: consultor || 'Consultor', detalhe: `${int(total.coletados)} de ${int(total.dias)} dia(s) coletados` },
      { id: 'livro', item: 'Livro de registro íntegro', ok: !!lv.cabeca && lv.verificacao?.ok === true, critico: true, responsavel: 'Tecnologia', detalhe: !lv.cabeca ? 'livro sem registros deste cliente' : lv.verificacao?.ok ? `seq ${lv.cabeca.seq} · ${h12(lv.cabeca.hash)}` : `quebra no seq ${lv.verificacao?.quebra?.seq ?? '—'}${lv.verificacao?.lacunas ? `; ${lv.verificacao.lacunas} lacuna(s)` : ''}` },
      { id: 'varredura', item: 'Varredura de admissão de erro declarada', ok: true, critico: true, responsavel: 'Sistema', detalhe: `${int(achTarefas.length + achEnviados.length)} ocorrência(s); limite declarado` },
      { id: 'revisar_frases', item: 'Revisar com o jurídico as frases encontradas na varredura', ok: !(achTarefas.length + achEnviados.length), critico: false, responsavel: `Jurídico + ${consultor || 'consultor'}`, detalhe: 'seção D6' },
      { id: 'balanco', item: 'Balanço colaboração × obstrução', ok: true, critico: true, responsavel: 'Sistema', detalhe: 'seção D5' },
      ...(!dados.economia && !custosPedido ? [{ id: 'pedido_custos', item: 'Prova do pedido de custos ao cliente (print/e-mail)', ok: false, critico: false, responsavel: consultor || 'Consultor', detalhe: 'custos não informados e nenhum pedido registrado no sistema' }] : []),
      { id: 'pagamentos', item: 'Comprovantes de pagamento', ok: pagamentos.length > 0, critico: false, responsavel: 'Financeiro', detalhe: `${int(pagamentos.length)} registrado(s)` },
      { id: 'acesso_conta', item: 'Prova da concessão de acesso à conta', ok: !!dados.conta_ml && !dados.conta_ml.erro, critico: false, responsavel: consultor || 'Consultor', detalhe: dados.conta_ml ? (dados.conta_ml.erro ? 'conexão do Mercado Livre com erro' : 'conexão do Mercado Livre autorizada pelo cliente') : 'sem conexão do Mercado Livre registrada' },
      { id: 'gravacoes', item: 'Gravações ou atas das reuniões com o cliente', ok: false, critico: false, responsavel: consultor || 'Consultor', detalhe: 'o sistema não guarda reuniões' },
      { id: 'conversas', item: 'Conversas do WhatsApp/Discord com o cliente (prints)', ok: false, critico: false, responsavel: consultor || 'Consultor', detalhe: 'o sistema não lê essas conversas' },
    ]
    pendencias = dod.filter(i => !i.ok).map(i => ({ id: i.id, item: i.item, critico: i.critico, responsavel: i.responsavel, prazo, detalhe: i.detalhe }))
    status = pendencias.some(x => x.critico) ? 'incompleto' : 'completo'
    numeros.pendencias = pendencias.length
    numeros.pendencias_criticas = pendencias.filter(x => x.critico).length
    numeros.admissao = { tarefas: achTarefas.length, enviados: achEnviados.length }
    numeros.contatos = { envios: tentativas.length, verificaveis, sem_resposta: semResposta, nao_verificaveis: naoVerif }

    const tiposExec = [...new Set(concl.map(t => t.tipo_demanda).filter(Boolean))]
    const alem = ent.length ? tiposExec.filter(t => !ent.some(e => norm(e).includes(norm(t)) || norm(t).includes(norm(e)))) : []
    // Q8 pela leitura do balanço: «colaboração»/«aguardando o cliente» são fatos com registro; «sem registro…»/«sem resposta captada…» não provam nada
    const leituras = balanco.map(b => b[2]).filter(x => x !== '—'), provadas = leituras.filter(x => x === 'colaboração' || x === 'aguardando o cliente')
    const sitBalanco = provadas.length ? (provadas.length === leituras.length ? 'PROVADO' : 'PARCIAL') : 'SEM REGISTRO'
    const pendTxt = pendencias.map(x => `${x.item} — ${x.responsavel}, até ${dm(x.prazo)}${x.critico ? ' (crítico)' : ''}`)
    const perguntas = [
      ['1. O contrato foi cumprido?', `${contrato ? `Contrato cadastrado (vigência ${dm(contrato.inicio)} a ${contrato.fim ? dm(contrato.fim) : 'indeterminado'}${ent.length ? `; ${plural(ent.length, 'entregável', 'entregáveis')}` : ''}). No período: ${plural(concl.length, 'tarefa concluída', 'tarefas concluídas')}, ${plural(rels.length, 'relatório', 'relatórios')}, ${plural(lotes.length, 'plano/aviso', 'planos/avisos')} enviados.` : `Sem contrato cadastrado. Execução no período: ${plural(concl.length, 'tarefa concluída', 'tarefas concluídas')}.`} O sistema prova a execução, não o cumprimento: só vira PROVADO depois da conferência item a item dos entregáveis pelo consultor (definition of done).`, contrato || concl.length ? 'PARCIAL' : 'PENDENTE', 'Seções 03, 10 · contrato'],
      ['2. Houve erro?', achTarefas.length ? `A varredura encontrou ${plural(achTarefas.length, 'frase', 'frases')} a revisar nos cards (D6).` : `A varredura de ${plural(textosTarefas.length, 'card', 'cards')} não achou nenhuma das ${int((C.frases_admissao || []).length)} frases da lista. A varredura procura frases de uma lista e não prova que não houve erro (limite em D6).`, achTarefas.length ? 'ATENÇÃO' : 'SEM OCORRÊNCIA NA VARREDURA (limite em D6)', 'D6'],
      ['3. Algum colaborador afirmou falha?', `${achEnviados.length ? `${plural(achEnviados.length, 'ocorrência', 'ocorrências')} nos textos enviados pela equipe (D6).` : `Nenhuma frase de admissão nos ${plural(textosEnviados.length, 'texto enviado', 'textos enviados')} pela equipe.`} ${LIMITE}`, achEnviados.length ? 'ATENÇÃO' : 'PARCIAL', 'D6'],
      ['4. O que o cliente respondia?', respPer.length || resolvidas || convPer.length ? `${plural(respCertas.length, 'resposta que citou a nossa mensagem', 'respostas que citaram a nossa mensagem')}${respCertas.length ? ` (temas: ${[...new Set(respCertas.flatMap(r => r.temas || []))].map(TEMA).join(', ') || '—'})` : ''}${respPer.length > respCertas.length ? `; ${plural(respPer.length - respCertas.length, 'resposta provável', 'respostas prováveis')} só pela janela de tempo (não contam como prova)` : ''}; ${plural(resolvidas, 'pendência resolvida', 'pendências resolvidas')} no histórico${convPer.length ? `; ${plural(convPer.length, 'retorno colhido', 'retornos colhidos')} pela equipe em conversa (registro da equipe, não é citação nem prova de resposta)` : ''}.` : 'Nenhuma resposta do cliente registrada pelo sistema no período.', respCertas.length || resolvidas ? 'PROVADO' : respPer.length || convPer.length ? 'PARCIAL' : 'SEM REGISTRO', 'Seção 10 · D4'],
      ['5. O que o cliente NÃO respondia?', `${int(semResposta)} de ${plural(verificaveis, 'envio verificável', 'envios verificáveis')} sem resposta captada em ${C.janela_resposta_dias} dias${naoVerif ? ` (${plural(naoVerif, 'outro envio não tem', 'outros envios não têm')} como ser verificado pelo coletor)` : ''}; ${plural(abertasHoje, 'pendência do cliente aberta', 'pendências do cliente abertas')} hoje${abertasHoje ? ` (${(pend.itens || []).slice(0, 4).map(x => x.rotulo).join(', ')})` : ''}; ${plural(emAberto, 'registro', 'registros')} de pendência em aberto no histórico.`, emAberto || abertasHoje ? 'PROVADO' : semResposta ? 'PARCIAL' : 'SEM REGISTRO', 'D4 · D5 · seção 11'],
      ['6. Os relatórios foram enviados?', `${rels.length || lotes.length ? `${plural(rels.length, 'relatório', 'relatórios')} no Notion e ${plural(lotes.length, 'plano/aviso', 'planos/avisos')} com recibo${envios.length ? `, de ${dm(envios[0].em)} a ${dm(envios.at(-1).em)}` : ''}.` : 'Nenhum envio pelo sistema no período.'}${relTarefas.length ? ` ${plural(relTarefas.length, 'tarefa de relatório/reunião concluída', 'tarefas de relatório/reunião concluídas')} no Notion (o card prova o encerramento; o envio ao cliente se prova com o print ou o link).` : ''}${rels.length || lotes.length ? '' : ' Relatórios enviados por fora precisam ser anexados.'}`, rels.length || lotes.length ? 'PROVADO' : relTarefas.length ? 'PARCIAL' : 'PENDENTE', 'Seções 03 e 10'],
      ['7. O "sem acesso" está documentado?', acessoRegs.length ? acessoRegs.map(a => `${a.txt} desde ${dm(a.em)}${a.fim ? `, resolvido ${dm(a.fim)}` : ', em aberto'}`).join('; ') + '.' : 'Nenhum registro de falta de acesso no sistema. Se o cliente alega que houve, trazer os prints da conversa.', acessoRegs.length ? 'PROVADO' : 'SEM REGISTRO', 'D5'],
      ['8. Colaboração × obstrução?', (balanco.filter(b => b[2] !== '—').map(b => `${b[0]}: ${b[1]}`).join('; ') || 'Nada registrado') + '.', sitBalanco, 'D5'],
      ['9. O que falta trazer?', pendTxt.length ? pendTxt.join('; ') + '.' : 'Nada.', pendencias.some(x => x.critico) ? 'PENDENTE' : pendencias.length ? 'PARCIAL' : 'PROVADO', 'D1 · D7'],
    ]
    const tese = contrato
      ? `A Place2u presta assessoria com obrigação de MEIO${contrato.obrigacao_meio === true ? ', como consta do contrato cadastrado' : contrato.obrigacao_meio === false ? ' — ATENÇÃO: o contrato cadastrado está marcado sem obrigação de meio; o jurídico precisa conferir a cláusula' : ' (cláusula ainda não conferida no contrato cadastrado)'}: compromete-se a executar com diligência o método (diagnóstico, plano, execução, medição e comunicação), não a garantir faturamento.${contrato.clausula_reembolso ? ` Cláusula de reembolso: «${limpo(contrato.clausula_reembolso, 300)}».` : ''}`
      : 'A Place2u presta assessoria com obrigação de MEIO: compromete-se a executar com diligência o método (diagnóstico, plano, execução, medição e comunicação), não a garantir faturamento. O contrato ainda não está cadastrado no sistema (pendente).'
    const prim = lv.primeiro_registro || ''
    const livroDesde = prim ? `O livro deste cliente começou em ${dm(prim)}: os fatos com data anterior foram importados das fontes nesse dia. O hash prova que nada mudou DEPOIS da entrada no livro (coluna «Entrou no livro» da D3), não a data original do fato — essa vem da fonte (data do Notion, editável pela equipe; data do canal).` : 'Livro sem registros deste cliente.'
    const obstrucoes = balanco.filter(b => b[2] === 'aguardando o cliente').map(b => b[0])
    const D1 = sec('D1', 'status', 'Status do dossiê e tese', [
      status === 'completo' ? aviso('ok', 'COMPLETO', 'Todos os itens críticos da definition of done têm prova no sistema.') : aviso('critico', 'INCOMPLETO — não enviar ainda', `Falta(m) ${plural(pendencias.filter(x => x.critico).length, 'item crítico', 'itens críticos')}: ${pendencias.filter(x => x.critico).map(x => x.item).join('; ')}.`),
      h3('Tese'), p(tese),
      lista([
        `Toda afirmação deste dossiê aponta a prova datada: seção, data da fonte, data de entrada no livro e hash. ${livroDesde}`,
        obstrucoes.length ? `Onde a execução dependia de uma ação do cliente, o registro mostra quando foi pedido e quando — ou se — foi atendido (D5: ${obstrucoes.join('; ')}); o atraso que decorre disso não é da assessoria.`
          : 'Nenhuma dependência do cliente tem pedido registrado no sistema neste período (D5): este dossiê não atribui atraso ao cliente sem essa prova.',
        ent.length ? `Entregáveis do contrato: ${ent.map(e => limpo(e, 60)).join('; ')}.${alem.length ? ` Demandas executadas fora dessa lista (possível entrega acima do contratado — conferir): ${alem.join('; ')}.` : ''}` : `Tipos de demanda executados no período: ${tiposExec.join('; ') || '—'} (sem lista de entregáveis cadastrada para comparar).`,
      ]),
      h3('Definition of done'),
      tabela(['Item', 'Situação', 'Detalhe', 'Responsável', 'Prazo'], dod.map(i => [i.item + (i.critico ? ' (crítico)' : ''), i.ok ? 'ok' : 'PENDENTE', i.detalhe, i.ok ? '—' : i.responsavel, i.ok ? '—' : dm(prazo)])),
    ], 'Contrato · livro de registro · todas as seções')
    const D2 = sec('D2', 'perguntas', 'As 9 perguntas', [tabela(['Pergunta', 'Resposta do registro', 'Situação', 'Base'], perguntas)], 'Respostas automáticas onde há prova; PENDENTE com responsável e prazo onde não há')
    const itensLivro = (lv.itens || [])
    // cronologia: um fato por linha, exceto rajadas do MESMO tipo no mesmo dia — anexos do mesmo card e fotografias de anúncio — que viram uma linha com a contagem,
    // o 1º e o último seq e os dois hashes (cada fato continua no livro, verificável em GET /api/cliente/livro). ponytail: sem isso, 1 print = 1 linha (170 páginas).
    const diaDe = r => String(r.fato_em || r.registrado_em).slice(0, 10)
    const chaveGrupo = r => r.tipo === 'anexo_tarefa' ? `a|${diaDe(r)}|${String(r.resumo).split('»')[0]}` : r.tipo === 'fotografia_anuncio' ? `f|${diaDe(r)}`
      : r.tipo === 'alteracao_anuncio' && r.dados?.fonte === 'promo' ? `p|${diaDe(r)}` : ''
    const TIPO = { tarefa_criada: 'tarefa criada', tarefa_concluida: 'tarefa concluída', tarefa_status: 'status', anexo_tarefa: 'anexo', alteracao_anuncio: 'anúncio', fotografia_anuncio: 'fotografia',
      medicao_tarefa: 'medição', relatorio_enviado: 'relatório', plano_enviado: 'plano', aviso_enviado: 'aviso', resumo_time: 'resumo ao time', resposta_cliente: 'resposta', pendencia_registrada: 'pendência',
      pendencia_cobrada: 'cobrança', pendencia_resolvida: 'pendência resolvida', alinhamento: 'alinhamento', risco_marcado: 'risco', risco_encerrado: 'risco encerrado', contrato: 'contrato', pagamento: 'pagamento', documento_gerado: 'documento', nota: 'nota' }
    const grupos = []
    for (const r of itensLivro) { const k = chaveGrupo(r), g = grupos.at(-1); if (k && g?.k === k) g.l.push(r); else grupos.push({ k, l: [r] }) }
    // «registrado depois»: entrou no livro mais de N dias depois da data do fato, já com o livro deste cliente funcionando (fora da importação inicial) — data retroativa na fonte
    const tardio = r => !!r.fato_em && !!prim && diaIso(r.registrado_em) > diaIso(prim) && diasEntre(diaIso(r.fato_em), diaIso(r.registrado_em)) > C.dias_registro_tardio
    const retratadas = new Map((lv.retratadas || []).map(x => [x.ref, x.em]))
    const linhaCron = ({ l }) => { const a = l[0], z = l.at(-1), data = a.fato_em ? dm(a.fato_em) : 'sem data na fonte'
      const entrou = `${dm(a.registrado_em)}${l.some(tardio) ? ' · registrado depois' : ''}`
      const retr = a.tipo === 'resposta_cliente' && retratadas.has(a.ref) ? `[RETRATADA — descartada pela equipe em ${dm(retratadas.get(a.ref))}: não conta como resposta] ` : ''
      if (l.length === 1) return [String(a.seq), data, entrou, TIPO[a.tipo] || a.tipo, retr + limpo(a.resumo, 170), h12(a.hash)]
      const mlbs = [...new Set(l.map(r => r.dados?.item_id).filter(Boolean))]
      const txt = a.tipo === 'anexo_tarefa' ? `${int(l.length)} anexos no card ${limpo(String(a.resumo).replace(/^Anexo \([^)]*\) no card /, '').split('»')[0] + '»', 120)}`
        : a.tipo === 'fotografia_anuncio' ? `${int(l.length)} fotografias completas de ${plural(mlbs.length, 'anúncio', 'anúncios')}`
        : `${int(l.length)} alterações de preço/promoção lidas pela coleta de promoções em ${plural(mlbs.length, 'anúncio', 'anúncios')} (${mlbs.slice(0, 6).join(', ')}${mlbs.length > 6 ? ', …' : ''})`
      return [`${a.seq}–${z.seq}`, data, entrou, TIPO[a.tipo] || a.tipo, txt, `${h12(a.hash)} … ${h12(z.hash)}`] }
    const D3 = sec('D3', 'cronologia', 'Cronologia completa do livro de registro', [
      p(`${plural(itensLivro.length, 'fato registrado', 'fatos registrados')} no período (pela data da fonte; sem data na fonte, pela data em que entrou no livro), em ${plural(grupos.length, 'linha', 'linhas')}: anexos do mesmo card no mesmo dia, fotografias do mesmo dia e alterações de preço/promoção da coleta de promoções do mesmo dia aparecem juntos, com o 1º e o último seq e hash (cada fato continua no livro). ${lv.cabeca ? `Último elo do cliente no momento da geração: seq ${lv.cabeca.seq} · hash ${h12(lv.cabeca.hash)}.` : 'Livro sem registros deste cliente.'} ${lv.verificacao ? (lv.verificacao.ok ? 'Verificação da cadeia: íntegra.' : `Verificação da cadeia: QUEBRA (${lv.verificacao.quebra ? `seq ${lv.verificacao.quebra.seq}, ${lv.verificacao.quebra.motivo}` : `${lv.verificacao.lacunas} lacuna(s)`}).`) : ''}`),
      p(`${livroDesde} «Registrado depois» = entrou no livro mais de ${plural(C.dias_registro_tardio, 'dia', 'dias')} depois da data do fato, já com o livro funcionando (data retroativa na fonte).${lv.anexos_pendentes ? ` ${plural(lv.anexos_pendentes, 'anexo do cliente ainda não entrou', 'anexos do cliente ainda não entraram')} no livro (a varredura continua nas próximas passadas).` : ''}`, 'nota'),
      tabela(['Seq', 'Data do fato', 'Entrou no livro', 'Tipo', 'Fato', 'Hash'], grupos.map(linhaCron),
        { vazio: '— Nenhum fato do período no livro (a varredura do livro ainda não passou por este cliente ou o período está vazio).' }),
    ], 'F6 Livro de registro (append-only, encadeado por cliente)')
    const D4 = sec('D4', 'contato', 'Tentativas de contato', [
      p(`${plural(tentativas.length, 'envio ao cliente', 'envios ao cliente')} no período; ${plural(verificaveis, 'verificável', 'verificáveis')} pelo coletor de respostas, ${int(semResposta)} deles sem resposta captada em ${C.janela_resposta_dias} dias. O coletor só capta a resposta no grupo do Mercado Livre que cita a nossa mensagem-âncora (plano com a assinatura da assessoria ou a pergunta do relatório) ou cai na janela da pergunta${coletor.desde ? `, e lê este cliente desde ${dm(coletor.desde)}` : ' — e ainda não leu este cliente'}. Relatório no Notion, e-mail, outro canal ou janela ainda aberta: «resposta não verificável pelo sistema», nunca silêncio.`),
      tabela(['Enviado em', 'O quê', 'Resposta'], tentativas.map(t => [dm(t.em), t.oque, t.resposta ? `respondeu em ${dm(t.resposta)}` : t.verificavel ? `sem resposta captada em ${C.janela_resposta_dias} dias` : 'resposta não verificável pelo sistema']), { vazio: 'Nenhum envio registrado pelo sistema no período.' }),
    ], 'F4 Envios do sistema · respostas coletadas')
    const D5 = sec('D5', 'balanco', 'Colaboração × obstrução', [
      tabela(['Ponto', 'O que o histórico prova', 'Leitura'], balanco),
      ...(pausas.length ? [h3('Pausas de anúncio lidas no canal'), tabela(['Dia', 'MLB', 'De → para', 'Tarefa da equipe na data (±3 dias)'], pausas.map(m => [dm(m.dia), m.item_id, `${valMud('status', m.de)} → ${valMud('status', m.para)}`, m.tarefa ? limpo(m.tarefa, 90) : 'nenhuma']))] : []),
      p('Só entra o que o histórico do sistema prova; o que não está registrado aparece como "sem registro", nunca como fato.', 'nota'),
    ], 'Pendências · cobranças · respostas · histórico do anúncio')
    const D6 = sec('D6', 'varredura', 'Varredura de admissão de erro', [
      p(`${plural(textosTarefas.length, 'card lido', 'cards lidos')} e ${plural(textosEnviados.length, 'texto enviado pela equipe', 'textos enviados pela equipe')} lido(s), contra ${plural((C.frases_admissao || []).length, 'frase de risco', 'frases de risco')} da configuração. Resultado: ${achTarefas.length + achEnviados.length ? `${plural(achTarefas.length + achEnviados.length, 'ocorrência', 'ocorrências')} para revisar com o jurídico antes de enviar.` : 'nenhuma ocorrência.'}`),
      tabela(['Fonte', 'Data', 'Frase', 'Trecho'], [...achEnviados, ...achTarefas].map(a => [`${a.fonte}${a.ref ? ` · ${limpo(a.ref, 50)}` : ''}`, dm(a.data), a.frase, a.trecho]), { vazio: 'Nenhuma frase de admissão de erro encontrada.' }),
      aviso('atencao', 'Limite declarado', LIMITE),
    ], 'Cards do Notion · textos enviados · config/dossie.json')
    const provas = Object.entries(itensLivro.reduce((m, r) => { const k = r.tipo; m[k] ||= { n: 0, hash: 0 }; m[k].n++; if (/sha256:|^url:|^https?:/.test(String(r.prova))) m[k].hash++; return m }, {}))
    const docs = [...(contrato ? [['Contrato', contrato.arquivo_sha256 ? `${contrato.arquivo} · sha256 ${h12(contrato.arquivo_sha256)}` : 'sem arquivo', dm(contrato.atualizado_em)]] : []),
      ...pagamentos.map(pg => ['Pagamento ' + brl(pg.valor_centavos / 100), pg.sha256 ? `${pg.arquivo} · sha256 ${h12(pg.sha256)}` : 'sem comprovante', dm(pg.data)])]
    const D7 = sec('D7', 'inventario', 'Inventário de provas', [
      h3('Disponíveis no sistema'),
      tabela(['Tipo de fato', 'Registros no período', 'Com prova verificável (hash/URL)'], provas.map(([k, v]) => [k.replace(/_/g, ' '), int(v.n), int(v.hash)]), { num: [1, 2], vazio: '— Livro sem fatos no período.' }),
      tabela(['Documento', 'Arquivo e impressão digital', 'Data'], docs, { vazio: 'Nenhum documento (contrato/comprovante) cadastrado.' }),
      h3('Pendentes'),
      tabela(['Prova', 'Responsável sugerido', 'Prazo', 'Crítico'], pendencias.map(x => [x.item, x.responsavel, dm(x.prazo), x.critico ? 'sim' : 'não']), { vazio: 'Nenhuma prova pendente.' }),
    ], 'F6 Livro de registro · contrato e pagamentos')
    secoes.unshift(D1, D2)
    secoes.push(D3, D4, D5, D6, D7)
  }

  const lv = dados.livro || {}
  return {
    versao, cliente, de, ate, hoje, status, pendencias, numeros,
    cabeca: lv.cabeca ? { seq: lv.cabeca.seq, hash: lv.cabeca.hash } : null,
    capa: {
      documento: defesa ? 'Dossiê de defesa · confidencial' : 'Relatório de assessoria marketplace',
      eyebrow: defesa ? `Dossiê de defesa · ${hoje.slice(0, 4)}` : `Prestação de contas · ${hoje.slice(0, 4)}`,
      titulo: defesa ? ['Registro, prova', 'e cronologia', 'do trabalho feito.'] : ['Execução,', 'desempenho', 'e próximos passos.'],
      subtitulo: defesa ? 'Dossiê com a tese de obrigação de meio, as provas datadas e o que ainda falta trazer.' : 'Análise consolidada das ações registradas pela assessoria e dos indicadores da operação no Mercado Livre.',
      cliente, consultor: consultor || '—', cs: cs || '—', periodo: `${dm(de)} a ${dm(ate)}`,
      bases: 'Base: Notion · painéis Mercado Livre · Mercado Ads · livro de registro',
      confidencial: defesa, status: defesa ? status : null,
      livro: lv.cabeca ? `Livro: seq ${lv.cabeca.seq} · ${h12(lv.cabeca.hash)}` : '',
    },
    secoes,
  }
}

// ── auditoria da versão CLIENTE: o MESMO auditor do relatório ao Notion do cliente (relatorio-seguro.js) sobre todo texto do documento. Liberado só o que o formato do
// Manoel exige: código MLB e id de anúncio/item de outro canal nos títulos dos cards (Shopee 10–11 dígitos, TikTok 19, «ID do Item: …», «ID do Produto: …») — o documento vai
// ao Notion do PRÓPRIO cliente, então o id da conta dele não vaza para terceiro; continua barrado o número com cara de celular (DDD + 9 + 8 dígitos), CPF/CNPJ formatado, hash e
// id interno —, nome dos responsáveis (nenhuma lista de nomes internos é passada), a palavra «Notion» (a base citada na capa e na seção 03) e a frase fixa «Concluído comprova
// o encerramento…». Limites de bloco do Notion não valem (o documento vai como PDF anexo). Barrado = não publica; a prévia mostra código e trecho.
const LIBERA = [/\bML[ABCMUV]U?\d{6,}\b/g, /\bID do (?:Produto|Item)\b/gi, /(?<![\d.\/-])(?![1-9]{2}9\d{8}(?!\d))\d{10,19}(?![\d.\/-])/g, /\bNotion\b/g, /Concluído comprova o encerramento/g]
const textosDe = o => typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(textosDe) : o && typeof o === 'object' ? Object.entries(o).filter(([k]) => !['t', 'id', 'classe', 'nivel', 'num', 'abs', 'arquivo'].includes(k)).flatMap(([, v]) => textosDe(v)) : []
export function auditarCliente(d) {
  const out = []
  for (const bruto of new Set(textosDe([d.capa, d.secoes]))) {
    const t = LIBERA.reduce((x, rx) => x.replace(rx, ' '), bruto)
    for (const v of auditarTexto(t)) if (!['limite', 'tipo_bloco'].includes(v.codigo) && out.length < 20 && !out.some(o => o.codigo === v.codigo && o.trecho === v.trecho)) out.push({ codigo: v.codigo, trecho: v.trecho })
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// criarDossies — gera, guarda, lista e entrega (manual e mensal). Sem import de banco: tudo entra por injeção.
// deps: handle, livro (criarLivro), coletar(cliente, {de, ate, versao}) → dados, render { gerar(dossie, { dir, base }) → { pdf, doc, pdf_motivo } },
//       raiz (pasta data/), agora() ISO, hoje() AAAA-MM-DD, hora() HH:MM, validarPor(nome, cliente) → canônico|'' (líder/consultor ou o CS DESTE cliente), validarChave(nome) (líder/consultor),
//       risco { abertos() }, envio { postar(caminho, payload), configurado() }, cargos [{id}], estado { get, set }, notificar(o), publicarNotion?({cliente, titulo, caminho}) → {url},
//       slug(cliente), cfg (config/dossie.json), log
// ════════════════════════════════════════════════════════════════════════════════════════════════════
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const CHAVE = 'dossie_mensal_ligado'
export function criarDossies({ handle: h, livro, coletar, render, raiz, agora = () => new Date().toISOString(), hoje = () => new Date().toISOString().slice(0, 10), hora = () => '00:00',
  validarPor = () => '', validarChave = () => '', risco = { abertos: () => [] }, envio = null, cargos = [], estado, notificar = () => {}, publicarNotion = null,
  slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cliente', cfg = {}, log = () => {} }) {
  const M = { dia: 1, hora: '09:00', webhook: '/webhook/place-dossie', max_tentativas: 3, max_bytes_arquivo: 8 * 1024 * 1024, ...(cfg.mensal || {}) }
  const base = resolve(raiz)
  const ins = h.prepare(`INSERT INTO dossie_gerado (cliente, versao, de, ate, gerado_em, por, origem, competencia, arquivo_pdf, arquivo_doc, sha256_pdf, sha256_doc, bytes_pdf, pdf_motivo, status, pendencias_json, livro_seq, livro_hash, notion_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  const publico = r => r && ({ id: r.id, cliente: r.cliente, versao: r.versao, de: r.de, ate: r.ate, gerado_em: r.gerado_em, por: r.por, origem: r.origem, competencia: r.competencia,
    status: r.status, pendencias: JSON.parse(r.pendencias_json || '[]'), sha256_pdf: r.sha256_pdf, sha256_doc: r.sha256_doc, bytes_pdf: r.bytes_pdf, pdf: !!r.arquivo_pdf, pdf_motivo: r.pdf_motivo,
    doc: !!r.arquivo_doc, doc_formato: String(r.arquivo_doc).split('.').pop(), livro: r.livro_seq ? { seq: r.livro_seq, hash: r.livro_hash } : null, notion: JSON.parse(r.notion_json || '{}'),
    pdf_url: r.arquivo_pdf ? `/api/dossie/${r.id}/pdf` : '', doc_url: r.arquivo_doc ? `/api/dossie/${r.id}/doc` : '' })
  const periodo = (de, ate) => {
    if (!DIA.test(String(de)) || !DIA.test(String(ate)) || Number.isNaN(Date.parse(de + 'T12:00:00Z')) || Number.isNaN(Date.parse(ate + 'T12:00:00Z'))) throw erro('período inválido (use AAAA-MM-DD)')
    if (de > ate) throw erro('"de" precisa ser antes de "ate"')
    if (ate > hoje()) throw erro('"ate" não pode estar no futuro')
    if (diasEntre(de, ate) + 1 > (cfg.max_periodo_dias || 400)) throw erro('período longo demais')
  }
  const hashArq = p => sha(readFileSync(p))
  const rel = abs => abs.slice(base.length + 1)

  // gera UMA versão: monta → renderiza (PDF + .doc) → guarda → registra no livro. Falha do PDF não derruba (fica o .doc e o motivo).
  async function gerar({ cliente, versao, de, ate, por, origem = 'manual', competencia = '' }) {
    if (!VERSOES.includes(versao)) throw erro('versão inválida (cliente ou defesa)')
    periodo(de, ate)
    const p_ = origem === 'mensal' ? por : validarPor(String(por ?? '').trim(), cliente)
    if (!p_) throw erro('quem gera precisa ser líder, consultor ou o CS deste cliente', 403)
    const dados = await coletar(cliente, { de, ate, versao })
    const d = montarDossie(cliente, { de, ate, versao, cfg }, dados)
    const notion = versao === 'cliente' ? { auditoria: auditarCliente(d) } : {}
    const em = agora()
    const dir = join(base, 'dossies', slug(cliente))
    mkdirSync(dir, { recursive: true })
    const nome = `${versao === 'defesa' ? 'dossie-defesa' : 'prestacao-contas'}-${de}_${ate}-${em.replace(/[^0-9]/g, '').slice(0, 14)}-${randomBytes(2).toString('hex')}`
    const r = await render.gerar(d, { dir, base: nome })
    const pdfAbs = r.pdf ? resolve(r.pdf) : '', docAbs = resolve(r.doc)
    if ((pdfAbs && !pdfAbs.startsWith(base + sep)) || !docAbs.startsWith(base + sep)) throw erro('caminho de arquivo fora da pasta de dados', 500)
    const s_pdf = pdfAbs ? hashArq(pdfAbs) : '', s_doc = hashArq(docAbs), bytes = pdfAbs ? statSync(pdfAbs).size : 0
    const id = h.transaction(() => {
      const id = Number(ins.run(cliente, versao, de, ate, em, p_, origem, competencia, pdfAbs ? rel(pdfAbs) : '', rel(docAbs), s_pdf, s_doc, bytes, r.pdf_motivo || '', d.status,
        JSON.stringify(d.pendencias), d.cabeca?.seq ?? null, d.cabeca?.hash || '', JSON.stringify(notion)).lastInsertRowid)
      livro.registrar({ cliente, tipo: 'documento_gerado', ref: `dossie:${id}`, fato_em: em,
        resumo: `${versao === 'defesa' ? `Dossiê de defesa gerado (${d.status.toUpperCase()})` : 'Prestação de contas gerada'} para ${dm(de)} a ${dm(ate)}${origem === 'mensal' ? ` (mensal ${competencia})` : ''} por ${p_}; PDF ${s_pdf ? h12(s_pdf) : 'indisponível'} · Word ${h12(s_doc)}`,
        dados: { dossie_id: id, versao, de, ate, origem, competencia, status: d.status, sha256_pdf: s_pdf, sha256_doc: s_doc, pendencias: d.pendencias.length, livro_seq: d.cabeca?.seq ?? null, por: p_ },
        prova: `arquivo:${rel(docAbs)}#sha256:${s_doc}` })
      return id
    }).immediate()
    log('info', `dossiê ${versao} #${id} gerado (${origem}${s_pdf ? '' : `, sem PDF: ${r.pdf_motivo}`}${r.doc_motivo ? `, Word em .doc HTML: ${r.doc_motivo}` : ''})`)
    return publico(h.prepare('SELECT * FROM dossie_gerado WHERE id = ?').get(id))
  }

  const listar = cliente => h.prepare('SELECT * FROM dossie_gerado WHERE cliente = ? ORDER BY id DESC LIMIT 100').all(cliente).map(publico)
  const ler = id => { const n = Number(id); return Number.isInteger(n) && n > 0 ? h.prepare('SELECT * FROM dossie_gerado WHERE id = ?').get(n) || null : null }
  // arquivo para download: só o que está dentro de data/dossies (caminho relativo gravado pelo próprio gerador)
  function arquivo(id, tipo) {
    const r = ler(id)
    if (!r) throw erro('documento não encontrado', 404)
    const relp = tipo === 'pdf' ? r.arquivo_pdf : tipo === 'doc' ? r.arquivo_doc : null
    if (relp === null) throw erro('formato inválido (pdf ou doc)')
    if (!relp) throw erro('este documento não tem o arquivo nesse formato', 404)
    const abs = resolve(base, relp)
    if (!abs.startsWith(join(base, 'dossies') + sep)) throw erro('documento não encontrado', 404)
    const nome = `${r.versao === 'defesa' ? 'Dossie-defesa' : 'Prestacao-de-contas'}-${slug(r.cliente)}-${r.de}_${r.ate}.${tipo}`
    const ext = relp.split('.').pop()   // Word: .rtf (textutil do macOS) ou .doc HTML (fallback)
    return { abs, nome: nome.replace(/\.doc$/, `.${ext}`), mime: { pdf: 'application/pdf', rtf: 'application/rtf', doc: 'application/msword' }[ext] || 'application/octet-stream', versao: r.versao, cliente: r.cliente }
  }

  // versão CLIENTE ao Notion do cliente (prévia por padrão); a de defesa nunca sai do sistema (só para o #growth, no mensal)
  async function enviarNotion({ id, por, confirmar = false }) {
    const r = ler(id)
    if (!r) throw erro('documento não encontrado', 404)
    if (r.versao !== 'cliente') throw erro('o dossiê de defesa nunca sai do sistema', 403)
    if (!r.arquivo_pdf) throw erro('este documento não tem PDF para anexar (gere de novo com o Chrome disponível)', 409)
    const p_ = validarPor(String(por ?? '').trim(), r.cliente)
    if (!p_) throw erro('quem envia precisa ser líder, consultor ou o CS deste cliente', 403)
    const titulo = `Relatório de Sprints Place2u · Prestação de contas · ${dm(r.de)} a ${dm(r.ate)}`
    const nj = JSON.parse(r.notion_json || '{}')
    if (!Array.isArray(nj.auditoria)) throw erro('documento gerado antes da auditoria de texto: gere de novo para enviar ao Notion', 409)
    if (nj.auditoria.length) return { ok: false, previa: true, titulo, cliente: r.cliente, motivo: 'auditoria', codigos: [...new Set(nj.auditoria.map(v => v.codigo))], violacoes: nj.auditoria }
    if (confirmar !== true) return { ok: true, previa: true, titulo, cliente: r.cliente, ja_enviado: nj.url || '' }
    if (!publicarNotion) throw erro('envio ao Notion indisponível neste servidor', 503)
    const res = await publicarNotion({ cliente: r.cliente, titulo, caminho: resolve(base, r.arquivo_pdf) })
    if (!res?.ok) return { ok: false, previa: false, motivo: res?.motivo || 'falhou' }
    const em = agora()
    h.transaction(() => {
      h.prepare('UPDATE dossie_gerado SET notion_json = ? WHERE id = ?').run(JSON.stringify({ ...nj, url: res.url || '', em, por: p_ }), r.id)
      livro.registrar({ cliente: r.cliente, tipo: 'relatorio_enviado', ref: `dossie-notion:${r.id}`, fato_em: em, resumo: `Prestação de contas (${dm(r.de)} a ${dm(r.ate)}) publicada no Notion do cliente com o PDF anexo (por ${p_})`,
        dados: { dossie_id: r.id, sha256_pdf: r.sha256_pdf, por: p_ }, prova: String(res.url || '').split(/[?#]/)[0] })
    }).immediate()
    return { ok: true, previa: false, url: res.url || '' }
  }

  // ── chave do mensal ──
  const ligado = () => estado.get(CHAVE) === 'ligado'
  function chave({ ligado: l, por }) {
    if (typeof l !== 'boolean') throw erro('informe "ligado" (verdadeiro ou falso)')
    const p_ = validarChave(String(por ?? '').trim())
    if (!p_) throw erro('somente líder ou consultor da central liga ou desliga o dossiê mensal', 403)
    estado.set(CHAVE, l ? 'ligado' : 'desligado'); estado.set(`${CHAVE}_por`, `${p_} · ${agora()}`)
    log('info', `dossiê mensal ${l ? 'LIGADO' : 'DESLIGADO'} por ${p_}`)
    return { ok: true, ligado: l }
  }
  // com cliente: só as linhas DESTE cliente (tela do cliente); sem cliente: a visão geral de /planos
  const mensalEstado = (cliente = '') => ({ ligado: ligado(), ...(cliente ? {} : { por: estado.get(`${CHAVE}_por`) || '' }), n8n: { configurado: !!envio?.configurado?.() }, agenda: { dia: M.dia, hora: M.hora, fuso: M.fuso || 'America/Sao_Paulo' },
    envios: h.prepare(`SELECT cliente, competencia, estado, motivo, tentativas, tentado_em, enviado_em FROM dossie_mensal ${cliente ? 'WHERE cliente = ?' : ''} ORDER BY criado_em DESC LIMIT 30`).all(...(cliente ? [cliente] : [])) })

  // ── mensal: dia M.dia a partir de M.hora, mês anterior, cada cliente com risco ABERTO; idempotente por (cliente, competência) ──
  // A chave e o risco aberto são conferidos DE NOVO antes de gerar e antes de postar (a geração demora; alguém pode desligar ou encerrar no meio): se não valem mais, 'pendente'.
  // Falha no meio da geração guarda os ids já gerados: a próxima tentativa gera só a versão que falta.
  const MOTIVO = { n8n_nao_configurado: 'entrega n8n não configurada (PLACE_GATILHOS_URL/SECRET)' }
  const naoVale = cliente => !ligado() ? 'chave_desligada' : !risco.abertos().some(r => r.cliente === cliente) ? 'sem_risco_aberto' : ''
  const marcarPendente = (cliente, competencia, motivo) => h.prepare(`INSERT INTO dossie_mensal (cliente, competencia, estado, motivo, criado_em, tentado_em) VALUES (?,?,'pendente',?,?,?)
    ON CONFLICT(cliente, competencia) DO UPDATE SET estado = 'pendente', motivo = excluded.motivo, tentado_em = excluded.tentado_em`).run(cliente, competencia, motivo, agora(), agora())
  let emCurso = null
  async function passadaMensal() {
    if (!ligado()) return { pulou: 'desligado' }
    const dia = hoje()
    if (Number(dia.slice(8, 10)) !== Number(M.dia) || hora() < M.hora) return { pulou: 'fora_do_dia' }
    const { de, ate, competencia } = mesAnterior(dia)
    const clientes = [...new Set(risco.abertos().map(r => r.cliente))]
    const out = []
    for (const cliente of clientes) {
      const ler_ = () => h.prepare('SELECT * FROM dossie_mensal WHERE cliente = ? AND competencia = ?').get(cliente, competencia)
      const linha = ler_()
      if (linha && (linha.estado === 'enviado' || linha.tentativas >= M.max_tentativas)) continue
      const nv = naoVale(cliente)
      if (nv) { marcarPendente(cliente, competencia, nv); out.push({ cliente, estado: 'pendente', motivo: nv }); continue }
      try {
        const ids = JSON.parse(linha?.ids_json || '[]'), feitas = new Set(ids.map(id => ler(id)?.versao).filter(Boolean))
        for (const versao of VERSOES.filter(v => !feitas.has(v))) {
          ids.push((await gerar({ cliente, versao, de, ate, por: 'Sistema (mensal)', origem: 'mensal', competencia })).id)
          h.prepare(`INSERT INTO dossie_mensal (cliente, competencia, ids_json, criado_em) VALUES (?,?,?,?)
            ON CONFLICT(cliente, competencia) DO UPDATE SET ids_json = excluded.ids_json`).run(cliente, competencia, JSON.stringify(ids), agora())
        }
        if (feitas.size < VERSOES.length) h.prepare("UPDATE dossie_mensal SET estado = 'gerado', motivo = '' WHERE cliente = ? AND competencia = ?").run(cliente, competencia)
        out.push({ cliente, ...(await entregarMensal(ler_())) })
      } catch (e) {
        h.prepare(`INSERT INTO dossie_mensal (cliente, competencia, estado, motivo, tentativas, criado_em, tentado_em) VALUES (?,?,'falhou','geracao',1,?,?)
          ON CONFLICT(cliente, competencia) DO UPDATE SET estado = 'falhou', motivo = 'geracao', tentativas = tentativas + 1, tentado_em = excluded.tentado_em`).run(cliente, competencia, agora(), agora())
        log('erro', `dossiê mensal ${cliente}: ${String(e?.message ?? e).replace(/["'`][\s\S]*$/, '…').slice(0, 120)}`)
        notificar({ tipo: 'dossie_mensal', nivel: 'erro', titulo: 'Dossiê mensal não foi gerado', corpo: `${cliente} · ${competencia}: falha na geração (detalhe no log).`, cliente, link: `/cliente?cliente=${encodeURIComponent(cliente)}&aba=configurar`, dedupeMin: 24 * 60 })
        out.push({ cliente, estado: 'falhou', motivo: 'geracao' })
      }
    }
    return { competencia, clientes: out }
  }
  async function entregarMensal(linha) {
    const nv = naoVale(linha.cliente)
    if (nv) { marcarPendente(linha.cliente, linha.competencia, nv); return { estado: 'pendente', motivo: nv } }
    const ids = JSON.parse(linha.ids_json || '[]'), docs = ids.map(id => ler(id)).filter(Boolean)
    const def = docs.find(d => d.versao === 'defesa'), pend = def ? JSON.parse(def.pendencias_json || '[]') : []
    const marca = (cargos || []).map(c => String(c.id ?? c)).filter(x => /^\d{15,21}$/.test(x))
    const arquivos = [], grandes = []
    for (const d of docs) {
      if (!d.arquivo_pdf) { grandes.push(`${d.versao}: sem PDF (${d.pdf_motivo || 'indisponível'})`); continue }
      if (d.bytes_pdf > M.max_bytes_arquivo) { grandes.push(`${d.versao}: PDF acima de ${Math.round(M.max_bytes_arquivo / 1048576)} MB — baixar no painel (/cliente › Configurar)`); continue }
      arquivos.push({ nome: `${d.versao === 'defesa' ? 'Dossie-defesa' : 'Prestacao-de-contas'}-${slug(d.cliente)}-${linha.competencia.replace('/', '-')}.pdf`, mime: 'application/pdf', base64: readFileSync(resolve(base, d.arquivo_pdf)).toString('base64') })
    }
    const texto = corta(`${marca.map(id => `<@&${id}>`).join(' ')} 📁 Morpheus · Prestação de contas mensal · ${linha.cliente} · ${linha.competencia} — dossiê de defesa: ${def ? def.status.toUpperCase() : 'NÃO GERADO'}${pend.length ? ` (${plural(pend.length, 'prova pendente', 'provas pendentes')}: ${pend.map(x => x.item).join('; ')})` : ''}${def?.livro_seq ? ` · livro seq ${def.livro_seq} · ${h12(def.livro_hash)}` : ''}${grandes.length ? ` · ${grandes.join(' · ')}` : ''}`, 1900)
    const em = agora()
    if (!envio?.configurado?.()) {
      h.prepare("UPDATE dossie_mensal SET estado = 'pendente', motivo = 'n8n_nao_configurado', tentado_em = ? WHERE cliente = ? AND competencia = ?").run(em, linha.cliente, linha.competencia)
      notificar({ tipo: 'dossie_mensal', nivel: 'alerta', titulo: 'Dossiê mensal gerado, mas não entregue ao #growth', corpo: `${linha.cliente} · ${linha.competencia}: ${MOTIVO.n8n_nao_configurado}.`, cliente: linha.cliente, link: `/cliente?cliente=${encodeURIComponent(linha.cliente)}&aba=configurar`, dedupeMin: 24 * 60 })
      return { estado: 'pendente', motivo: 'n8n_nao_configurado' }
    }
    // id: chave de idempotência para o n8n descartar a repetição (timeout depois de o n8n já ter postado vira nova tentativa aqui)
    const r = await envio.postar(M.webhook, { id: `${linha.cliente}|${linha.competencia}`, cliente_rotulo: linha.cliente, competencia: linha.competencia, texto, discord_mencionar_cargos: marca, arquivos })
    if (r?.ok) {
      h.transaction(() => {
        h.prepare("UPDATE dossie_mensal SET estado = 'enviado', motivo = '', tentativas = tentativas + 1, tentado_em = ?, enviado_em = ? WHERE cliente = ? AND competencia = ?").run(em, em, linha.cliente, linha.competencia)
        livro.registrar({ cliente: linha.cliente, tipo: 'nota', ref: `dossie-mensal:${linha.competencia}`, fato_em: em, resumo: `Prestação de contas e dossiê de defesa de ${linha.competencia} entregues ao canal interno da equipe (#growth)`,
          dados: { ids, competencia: linha.competencia, status_defesa: def?.status || '', arquivos: arquivos.length }, prova: '' })
      }).immediate()
      return { estado: 'enviado' }
    }
    const motivo = `n8n_${r?.status ?? r?.erro ?? 'erro'}`
    h.prepare("UPDATE dossie_mensal SET estado = 'falhou', motivo = ?, tentativas = tentativas + 1, tentado_em = ? WHERE cliente = ? AND competencia = ?").run(motivo, em, linha.cliente, linha.competencia)
    notificar({ tipo: 'dossie_mensal', nivel: 'erro', titulo: 'Dossiê mensal não foi entregue ao #growth', corpo: `${linha.cliente} · ${linha.competencia}: o n8n recusou a entrega (${motivo}); nova tentativa no próximo ciclo, até ${M.max_tentativas}.`, cliente: linha.cliente, link: `/cliente?cliente=${encodeURIComponent(linha.cliente)}&aba=configurar`, dedupeMin: 24 * 60 })
    return { estado: 'falhou', motivo }
  }
  const tickMensal = () => emCurso ||= passadaMensal().finally(() => { emCurso = null })

  return { gerar, listar, ler: id => publico(ler(id)), arquivo, enviarNotion, chave, mensalEstado, tickMensal, montar: montarDossie }
}
