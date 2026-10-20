// Chaveiro F4+ — console único de execução de estratégias (docs/desenho-causalidade-executor.md § 3.3/6/7; docs/manual-integracao-ml.md § Chaveiro F4+). PURO: sem banco, sem rede.
// Catálogo FECHADO de operações no anúncio do Mercado Livre: cada uma com parâmetros validados, payload mínimo (lista fechada de campos), o que a releitura ao vivo
// compara antes de enviar (só os campos tocados), o que a conferência espera ler depois (2xx ≠ feito), a reversão (quando existe) e o que o Merovíngio mede.
// Não decide prioridade (Arquiteto) nem prevê (Oráculo): só monta, trava e confere. Estratégias = sequências nomeadas destas operações (config/estrategias.json).
// Doc do ML lida por curl em 15/10/2026 (developers.mercadolivre.com.br/pt_br): produto-sincronizacao-de-publicacoes (preço, status paused|active, título só sem vendas,
// shipping editável; PUT só com price é recusado com 400 quando o anúncio tem AUTOMAÇÃO DE PREÇO ativa, e price junto com outros campos é IGNORADO com 200 — por isso o
// preço sai SEMPRE sozinho e a conferência relê), automatizacoes-de-precos (GET /pricing-automation/items/{id}/automation), descricao-de-produtos, trabalhar-com-imagens
// (PUT pictures por id), atributos, custos-de-envio (free_shipping true|false quando não há a tag mandatory_free_shipping), introducao-ao-mercado-ads +
// product-ads-para-catalogo-e-user-products-leitura (Product Ads: SÓ LEITURA documentada → adaptador assistido).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { ATRIBUTOS_INTOCAVEIS } from './ofertas-ml.js'
import { checarPreservacao, CAMPOS_PRESERVAR, CAMPOS_PRESERVAR_TITULO } from './ofertas-preservacao.js'
import { validarEstoqueFisico, MOTIVOS_ESTOQUE_FISICO } from './produto-estoque.js'
import { TEXTO_CATALOGO } from './catalogo-cfg.js'
import { hashOrdem, idOrdem, classificarStatus, podeIr, ESTADOS_ABERTOS } from './chaveiro-estoque.js'

export const CFG = JSON.parse(readFileSync(join(ROOT, 'config', 'chaveiro.json'), 'utf-8'))
export const CFG_ESTRATEGIAS = JSON.parse(readFileSync(join(ROOT, 'config', 'estrategias.json'), 'utf-8'))
export { hashOrdem, idOrdem, classificarStatus, podeIr, ESTADOS_ABERTOS }

// ── catálogo fechado. escrita: automatico (o executor escreve) | delegado (outro executor que já existe escreve) | assistido (o sistema prepara, humano aplica) | f6 (fluxo próprio)
// doc: VERIFIED = endpoint e corpo na doc pública; NOT_VERIFIED = campo lido na doc, corpo de escrita sem exemplo — a conferência por releitura decide.
export const OPERACOES = {
  preco: { rotulo: 'Preço', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: false, reversivel: true, regra: 'preco_mudou_vendas_cairam', metrica: 'unidades e receita/dia (e margem estimada com custo)',
    params: { variacao_pct: { tipo: 'numero', min: -50, max: 50, rotulo: 'Variação (%)' }, novo_preco: { tipo: 'numero', min: 0.01, max: 10_000_000, rotulo: 'Preço novo (R$)' }, ao_piso: { tipo: 'bool', rotulo: 'Subir até o piso de margem' }, variacao_id: { tipo: 'texto', rotulo: 'Variação (id) — só para preço novo' }, decisao_cliente: { tipo: 'bool', rotulo: 'Sem custo: é decisão do cliente (registrada no Smith)' } } },
  status: { rotulo: 'Pausar / ativar', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: false, reversivel: true, regra: 'anuncio_restrito', metrica: 'unidades/dia',
    params: { acao: { tipo: 'escolha', opcoes: ['pausar', 'ativar'], obrigatorio: true, rotulo: 'Ação' }, decisao_reativar: { tipo: 'bool', rotulo: 'Pausado pelo vendedor: reativar é decisão registrada' } } },
  frete_gratis: { rotulo: 'Frete grátis', adaptador: 'ml_item', escrita: 'automatico', doc: 'NOT_VERIFIED', conteudo: false, reversivel: true, regra: 'frete_gratis', metrica: 'conversão e unidades',
    params: { ativar: { tipo: 'bool', obrigatorio: true, rotulo: 'Ativar frete grátis' } } },
  titulo: { rotulo: 'Título', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: true, reversivel: true, regra: 'oferta_titulo_descricao', metrica: 'visitas/dia e conversão',
    params: { titulo: { tipo: 'texto', max: 60, obrigatorio: true, rotulo: 'Título novo' } } },
  descricao: { rotulo: 'Descrição', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: true, reversivel: true, regra: 'oferta_titulo_descricao', metrica: 'conversão',
    params: { texto: { tipo: 'texto', max: 50000, obrigatorio: true, rotulo: 'Descrição (texto simples)' } } },
  atributos: { rotulo: 'Ficha (atributos)', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: true, reversivel: true, regra: 'oferta_ficha', metrica: 'visitas/dia',
    params: { atributos: { tipo: 'atributos', obrigatorio: true, rotulo: 'Atributos (id = valor)' } } },
  fotos: { rotulo: 'Fotos (ordem / capa)', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: true, reversivel: true, regra: 'conteudo_fotos', metrica: 'visitas/dia e conversão',
    params: { capa: { tipo: 'foto', rotulo: 'Nova capa (foto que já está no anúncio)' }, ordem: { tipo: 'fotos', rotulo: 'Nova ordem das fotos' } } },
  restaurar: { rotulo: 'Restaurar «como era»', adaptador: 'ml_item', escrita: 'automatico', doc: 'VERIFIED', conteudo: false, reversivel: true, regra: 'preco_mudou_vendas_cairam', metrica: 'unidades/dia',
    params: { snapshot: { tipo: 'snapshot', obrigatorio: true, rotulo: 'Fotografia «como era»' }, decisao_cliente: { tipo: 'bool', rotulo: 'Sem custo: preço é decisão do cliente' } } },
  duplicar: { rotulo: 'Duplicar anúncio', adaptador: 'ofertas', escrita: 'automatico', doc: 'VERIFIED (POST /items); User Products por categoria NOT_VERIFIED', conteudo: true, reversivel: false, regra: 'duplicacao_estrategica', metrica: 'receita da família (original + duplicata)',
    params: { quantidade: { tipo: 'inteiro', min: 1, max: 100000, obrigatorio: true, rotulo: 'Estoque da duplicata' }, titulo_novo: { tipo: 'texto', max: 60, rotulo: 'Título da duplicata' }, capa: { tipo: 'foto', rotulo: 'Capa da duplicata' } } },
  promocao: { rotulo: 'Promoção (plano aprovado em /promocoes)', adaptador: 'promocoes', escrita: 'delegado', doc: 'VERIFIED (promocoes-exec)', conteudo: false, reversivel: false, regra: 'promocao_giro', metrica: 'unidades e cobertura',
    params: { plano_id: { tipo: 'texto', max: 80, obrigatorio: true, rotulo: 'Plano de promoção aprovado' } } },
  ads: { rotulo: 'Product Ads', adaptador: 'ads', escrita: 'assistido', doc: 'NOT_VERIFIED (a doc pública só traz leitura)', conteudo: false, reversivel: false, regra: 'ads_entrar', metrica: 'ROAS/ACOS e unidades',
    params: { acao: { tipo: 'escolha', opcoes: ['ativar', 'pausar', 'orcamento', 'acos_alvo'], obrigatorio: true, rotulo: 'Ação' }, valor: { tipo: 'numero', min: 0, max: 1_000_000, rotulo: 'Valor (R$/dia ou ACOS %)' } } },
  estoque: { rotulo: 'Estoque (sincronismo F6)', adaptador: 'ml_estoque', escrita: 'f6', doc: 'ver § F6', conteudo: false, reversivel: false, regra: 'estoque_sincronizar', metrica: 'dias sem estoque, cancelamentos', rota: '/api/chaveiro/estoque', params: {} },
}
export const OPS_EXECUTAVEIS = Object.keys(OPERACOES).filter(k => ['automatico', 'delegado'].includes(OPERACOES[k].escrita))
const SUBESTADOS_MODERACAO = () => CFG.execucao.subestados_moderacao
const r2 = n => Math.round(Number(n) * 100) / 100
const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const ID_FOTO = /^[A-Za-z0-9_-]{2,60}$/
// textos FIXOS (nunca o valor recebido)
export const MOTIVOS = {
  chave_global: 'execução do Chaveiro desligada (config/chaveiro.json → execucao_ligada)',
  adaptador: 'esta operação está desligada para escrita (config/chaveiro.json → adaptadores_live)',
  parado: 'Chaveiro parado pelo botão de emergência',
  prospect: 'prospect do comercial não é cliente',
  integracao: 'cliente sem integração com o Mercado Livre ativa',
  sem_liberacao: 'operação não liberada para este cliente (falta a liberação do líder com o cliente informado)',
  cliente_informado: 'o cliente ainda não foi informado desta operação',
  estreia: 'estreia supervisionada: só o anúncio da estreia até 10 ordens conferidas sem divergência',
  teto_dia: 'teto de ordens por dia desta operação neste cliente atingido',
  confirmar: 'falta confirmar === true (confirmação explícita)',
  estado: 'a ordem não está aprovada para executar',
  hash: 'o conteúdo da ordem mudou depois de preparada (hash não confere): prepare de novo',
  assistido: 'operação assistida: o sistema prepara o passo a passo, a aplicação é humana no painel do Mercado Livre',
  f6: 'estoque segue o fluxo próprio do sincronismo (F6), com as travas dele',
  catalogo: 'anúncio de catálogo: conteúdo não é do vendedor por API',
  alinhado: 'anúncio com alinhamento vivo com o cliente: nada é escrito',
  divergente: 'o anúncio mudou fora do sistema desde a preparação: nada foi enviado',
  automacao: 'o anúncio tem automação de preço ativa no Mercado Livre: o preço não é escrito pelo sistema',
  automacao_nao_lida: 'não foi possível conferir a automação de preço do anúncio: nada foi enviado',
  leitura: 'não foi possível ler o anúncio ao vivo: nada foi enviado',
  nao_confirmou: 'o canal não confirmou depois das releituras: conferir no painel',
  payload: 'o Mercado Livre recusou o formato da escrita: nada é reenviado',
  permissao: 'sem permissão do app no Mercado Livre (reconectar a conta)',
  limite: 'limite de chamadas do Mercado Livre: tenta no próximo ciclo',
  incerto: 'resposta incerta do Mercado Livre: a conferência decide (nunca reenvio às cegas)',
  conflito: 'o Mercado Livre respondeu conflito: nada mais é enviado',
  aprovado_mudou: 'o que seria enviado ao vivo difere do aprovado: prepare de novo',
}

// ── parâmetros (lista fechada por operação) ──
const VALIDA = {
  numero: (v, d) => (typeof v === 'number' && Number.isFinite(v) && (d.min == null || v >= d.min) && (d.max == null || v <= d.max) ? v : undefined),
  inteiro: (v, d) => (Number.isInteger(v) && (d.min == null || v >= d.min) && (d.max == null || v <= d.max) ? v : undefined),
  bool: v => (typeof v === 'boolean' ? v : undefined),
  texto: (v, d) => (typeof v === 'string' && v.trim() && v.length <= (d.max ?? 200) ? v.trim() : undefined),
  escolha: (v, d) => (d.opcoes.includes(v) ? v : undefined),
  foto: v => (typeof v === 'string' && ID_FOTO.test(v) ? v : undefined),
  fotos: v => (Array.isArray(v) && v.length && v.length <= 12 && v.every(x => typeof x === 'string' && ID_FOTO.test(x)) && new Set(v).size === v.length ? v : undefined),
  snapshot: v => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : undefined),
  atributos: (v, _d, cfg) => (Array.isArray(v) && v.length && v.length <= 20 && v.every(a => a && typeof a.id === 'string' && cfg.execucao.atributos_permitidos.includes(a.id.toUpperCase()) && !ATRIBUTOS_INTOCAVEIS.includes(a.id.toUpperCase()) && typeof a.valor === 'string' && a.valor.trim() && a.valor.length <= 255)
    ? v.map(a => ({ id: a.id.toUpperCase(), valor: a.valor.trim() })) : undefined),
}
// → { ok, params, erros[] } (erros com o RÓTULO do parâmetro, nunca o valor recebido). Parâmetro desconhecido = erro.
export function validarParams(operacao, params = {}, { cfg = CFG } = {}) {
  const op = OPERACOES[operacao]
  if (!op) return { ok: false, params: {}, erros: ['operação fora da lista fechada'] }
  const out = {}, erros = []
  for (const k of Object.keys(params || {})) {
    const d = op.params[k]
    if (!d) { erros.push('parâmetro fora da lista desta operação'); continue }
    const v = VALIDA[d.tipo](params[k], d, cfg)
    if (v === undefined) erros.push(`${d.rotulo}: valor inválido`); else out[k] = v
  }
  for (const [k, d] of Object.entries(op.params)) if (d.obrigatorio && out[k] === undefined && !erros.some(e => e.startsWith(d.rotulo))) erros.push(`${d.rotulo}: obrigatório`)
  if (operacao === 'preco' && ['variacao_pct', 'novo_preco', 'ao_piso'].filter(k => out[k] !== undefined && out[k] !== false).length !== 1) erros.push('preço: informe UMA forma (variação %, preço novo ou subir ao piso)')
  if (operacao === 'fotos' && (out.capa === undefined) === (out.ordem === undefined)) erros.push('fotos: informe a nova capa OU a nova ordem')
  return { ok: erros.length === 0, params: out, erros }
}

// ── o que a releitura compara e a conferência espera: só os CAMPOS TOCADOS ──
export function tocado(item, campos, ids = {}) {
  const t = {}
  for (const c of campos) {
    if (c === 'preco') t.preco = item?.variations?.length ? Object.fromEntries(item.variations.map(v => [String(v.id), r2(v.price)])) : item?.price == null ? null : r2(item.price)
    if (c === 'status') t.status = item?.status ?? null
    if (c === 'frete_gratis') t.frete_gratis = item?.shipping ? !!item.shipping.free_shipping : null
    if (c === 'titulo') t.titulo = item?.title == null ? null : norm(item.title)
    if (c === 'descricao') t.descricao = item?._descricao?.plain_text == null ? null : norm(item._descricao.plain_text)
    if (c === 'atributos') t.atributos = Object.fromEntries((ids.atributos || []).map(id => [id, norm((item?.attributes || []).find(a => String(a.id).toUpperCase() === id)?.value_name ?? '') || null]))
    if (c === 'fotos') t.fotos = (item?.pictures || []).map(p => String(p.id))
  }
  return t
}
// conferência: lido × esperado × antes → 'confere' (bate) | 'aguardando' (ainda igual ao antes: propagação) | 'divergente' (virou outra coisa)
export function conferir(esperado, lido, antes) {
  const cs = Object.keys(esperado || {})
  if (!cs.length) return 'aguardando'                                                                       // nada esperado = nada a confirmar (nunca «confere» por vazio)
  if (cs.every(c => igual(lido[c], esperado[c]))) return 'confere'
  if (cs.every(c => igual(lido[c], esperado[c]) || igual(lido[c], antes[c]))) return 'aguardando'
  return 'divergente'
}
// a releitura ao vivo antes de enviar bate com o que foi aprovado? (só campos tocados)
export const conferePreparo = (antesAprovado, vivo) => Object.keys(antesAprovado).every(c => igual(antesAprovado[c], vivo[c]))

// corpo nunca leva campo proibido: estoque, exclusão, categoria, tipo; status só paused/active (nunca closed)
const PROIBIDOS = ['deleted', 'available_quantity', 'category_id', 'listing_type_id', 'seller_id', 'buying_mode']
export function assertCorpoSeguro(corpo, operacao) {
  for (const k of PROIBIDOS) if (corpo && k in corpo && operacao !== 'duplicar') throw new Error('payload proibido: campo fora da lista fechada')
  if (corpo && 'status' in corpo && !(operacao === 'status' && ['paused', 'active'].includes(corpo.status))) throw new Error('payload proibido: status só paused/active, e só na operação status')
  for (const a of corpo?.attributes || []) if (ATRIBUTOS_INTOCAVEIS.includes(String(a.id).toUpperCase()) && operacao !== 'duplicar') throw new Error('payload proibido: atributo intocável')
  return corpo
}

// ficha do anúncio (fato com fonte) para a preservação de Ofertas: o texto novo não pode perder o que o texto ATUAL afirma
const fichaDe = item => ({ atributos: (item?.attributes || []).filter(a => a.value_name).map(a => ({ atributo_id: a.id, valor_atual: a.value_name, fonte: 'anúncio' })) })
function perdeNoTexto(item, atual, novo, campos) {
  const f = fichaDe(item), antes = new Set(checarPreservacao(f, atual || '', { campos }).faltantes.map(x => x.campo))
  return checarPreservacao(f, novo, { campos }).faltantes.filter(x => !antes.has(x.campo))
}
const catalogoBloqueia = ctx => (ctx.catalogoOrigem && ctx.catalogoOrigem !== 'nao' ? `${MOTIVOS.catalogo} (${TEXTO_CATALOGO[ctx.catalogoOrigem] || TEXTO_CATALOGO.terceiros})` : '')

// preço novo de UM valor atual
function precoNovo(atual, p, ctx, cfg, { reversao = false } = {}) {
  const teto = (cfg.preco_max_var_pct_padrao ?? 10) / 100
  let novo = p.novo_preco != null ? p.novo_preco : p.variacao_pct != null ? atual * (1 + p.variacao_pct / 100) : null
  if (p.ao_piso) {
    if (ctx.piso == null) return { erro: 'subir ao piso exige custos informados (piso de margem)' }
    if (atual >= ctx.piso) return { erro: 'o preço já está no piso de margem ou acima: nada a subir' }
    novo = Math.min(ctx.piso, atual * (1 + teto))
  }
  novo = Math.round(novo * 100) / 100
  if (!(novo > 0)) return { erro: 'preço novo inválido' }
  if (!reversao && !p.sem_teto && Math.abs(novo / atual - 1) > teto + 1e-9) return { erro: `variação acima do teto de ${Math.round(teto * 100)}% por ordem` }
  if (ctx.piso != null && novo < ctx.piso && novo < atual) return { erro: 'preço novo abaixo do piso de margem (custos informados)' }
  if (Math.round(novo * 100) === Math.round(atual * 100)) return { erro: 'nada a mudar: o preço já é este' }
  return { novo }
}

// ── PLANEJAR uma operação sobre um anúncio (item = JSON do GET /items/{id}, ao vivo ou do cache) ──
// ctx: { catalogoOrigem, alinhado, piso, custos_informados, snapshot (restaurar), fisico/outros/sku (duplicar), plano (promocao), reversao }
// → { operacao, grupos[{ grupo, metodo, caminho, corpo }], diff[{ campo, de, para }], antes, esperado, ids, bloqueios[], avisos[], passo_a_passo[] }
export function planejar(operacao, params, item, ctx = {}, { cfg = CFG } = {}) {
  const op = OPERACOES[operacao], out = { operacao, grupos: [], diff: [], antes: {}, esperado: {}, ids: {}, bloqueios: [], avisos: [], passo_a_passo: [] }
  const bloq = m => (out.bloqueios.push(m), out)
  if (!op) return bloq('operação fora da lista fechada')
  if (!item?.id) return bloq(MOTIVOS.leitura)
  if (ctx.alinhado && operacao !== 'ads') return bloq(MOTIVOS.alinhado)
  if (op.conteudo && catalogoBloqueia(ctx)) return bloq(catalogoBloqueia(ctx))
  if (['closed', 'inactive', 'under_review'].includes(item.status) && operacao !== 'ads') return bloq('anúncio encerrado/inativo/em revisão: nenhuma alteração pelo sistema')
  const id = item.id, p = params || {}, vars = item.variations || []
  const grupo = (g, metodo, caminho, corpo) => out.grupos.push({ grupo: g, metodo, caminho, corpo: assertCorpoSeguro(corpo, operacao) })
  const toca = (campos, ids = {}) => { out.ids = { ...out.ids, ...ids }; Object.assign(out.antes, tocado(item, campos, out.ids)) }

  if (operacao === 'preco') {
    if (ctx.piso == null && !ctx.reversao && p.decisao_cliente !== true) return bloq('sem custo informado: o preço só sai com a confirmação explícita de «decisão do cliente» (registrada no Smith)')
    if (ctx.piso == null) out.avisos.push('sem custo informado: sem piso de margem; registrado como decisão do cliente')
    toca(['preco'])
    if (vars.length) {
      if (p.novo_preco != null && !p.variacao_id) return bloq('anúncio com variações: preço novo exige a variação (ou use variação %)')
      if (p.ao_piso) return bloq('anúncio com variações: subir ao piso é por variação (use preço novo por variação)')
      const corpo = []
      for (const v of vars) {
        const alvo = p.variacao_id ? String(v.id) === String(p.variacao_id) : true
        if (!alvo) { corpo.push({ id: v.id }); continue }                                                  // irmã listada só por id = preservada (sem id ela SAI do anúncio)
        const r = precoNovo(v.price, p, ctx, cfg, ctx)
        if (r.erro) return bloq(`variação: ${r.erro}`)
        corpo.push({ id: v.id, price: r.novo }); out.diff.push({ campo: `preço da variação ${v.id}`, de: v.price, para: r.novo })
      }
      if (p.variacao_id && !vars.some(v => String(v.id) === String(p.variacao_id))) return bloq('variação não encontrada no anúncio')
      out.esperado.preco = Object.fromEntries(vars.map(v => [String(v.id), r2(corpo.find(c => String(c.id) === String(v.id))?.price ?? v.price)]))
      grupo('preco', 'PUT', `/items/${id}`, { variations: corpo })                                        // SÓ o preço: preço junto com outro campo é ignorado pelo ML
    } else {
      if (item.price == null) return bloq('preço atual não lido')
      const r = precoNovo(item.price, p, ctx, cfg, ctx); if (r.erro) return bloq(r.erro)
      out.esperado.preco = r2(r.novo); out.diff.push({ campo: 'preço', de: item.price, para: r.novo })
      grupo('preco', 'PUT', `/items/${id}`, { price: r.novo })
    }
    out.avisos.push('antes de enviar, o sistema confere a automação de preço do anúncio no Mercado Livre (com automação ativa o preço não é escrito)')
  }

  if (operacao === 'status') {
    toca(['status'])
    if (p.acao === 'pausar') { if (item.status !== 'active') return bloq('só anúncio ativo pode ser pausado'); out.esperado.status = 'paused'; grupo('status', 'PUT', `/items/${id}`, { status: 'paused' }) }
    else {
      if (item.status !== 'paused') return bloq('só anúncio pausado pode ser ativado')
      const sub = item.sub_status || []
      if (sub.some(s => SUBESTADOS_MODERACAO().includes(s))) return bloq('pausado por moderação do Mercado Livre: caminho do cliente (corrigir e pedir revisão), nunca reativar por API')
      if (sub.includes('out_of_stock')) return bloq('pausado por falta de estoque: reposição, não reativação')
      if (p.decisao_reativar !== true) return bloq('pausado pelo vendedor: reativar só com a decisão registrada (decisao_reativar)')
      out.esperado.status = 'active'; grupo('status', 'PUT', `/items/${id}`, { status: 'active' })
    }
    out.diff.push({ campo: 'status', de: item.status, para: out.esperado.status })
  }

  if (operacao === 'frete_gratis') {
    toca(['frete_gratis'])
    const sh = item.shipping || {}
    if (sh.mode && sh.mode !== 'me2') return bloq('frete grátis por API só no Mercado Envios 2 (no ME1 o Mercado Livre não aplica o selo)')
    if (p.ativar === false && (sh.tags || []).includes('mandatory_free_shipping')) return bloq('frete grátis obrigatório neste anúncio (tag mandatory_free_shipping): não dá para desligar')
    if (!!sh.free_shipping === p.ativar) return bloq('nada a mudar: o frete grátis já está assim')
    out.esperado.frete_gratis = p.ativar; out.diff.push({ campo: 'frete grátis', de: !!sh.free_shipping, para: p.ativar })
    grupo('frete_gratis', 'PUT', `/items/${id}`, { shipping: { free_shipping: p.ativar } })
    out.avisos.push('NOT_VERIFIED: o corpo { shipping: { free_shipping } } não tem exemplo na doc pública; a conferência por releitura decide')
  }

  if (operacao === 'titulo') {
    toca(['titulo'])
    if ((item.sold_quantity ?? 0) > 0) return bloq('anúncio com vendas: o Mercado Livre não deixa mudar o título (doc «Sincronização e modificação de publicações»)')
    if (item.user_product_id) return bloq('anúncio no modelo User Products: o título vem do family_name do produto')
    const t = norm(p.titulo); if (t.length > cfg.execucao.titulo_max) return bloq('título acima do limite')
    const perde = perdeNoTexto(item, item.title, t, CAMPOS_PRESERVAR_TITULO)
    if (perde.length) return bloq(`o título novo perde o que o atual afirma: ${perde.map(x => x.campo).join(', ')}`)
    if (t === norm(item.title)) return bloq('nada a mudar: o título já é este')
    out.esperado.titulo = t; out.diff.push({ campo: 'título', de: item.title, para: t })
    grupo('titulo', 'PUT', `/items/${id}`, { title: t })
  }

  if (operacao === 'descricao') {
    toca(['descricao'])
    const t = String(p.texto)
    if (/<[a-z][\s\S]*>/i.test(t)) return bloq('descrição só aceita texto simples (sem HTML)')
    if (t.length > cfg.execucao.descricao_max) return bloq('descrição acima do limite')
    const atual = item._descricao?.plain_text
    if (atual == null && item._descricao_lida !== true) out.avisos.push('descrição atual não lida: a preservação compara só com a ficha na execução (releitura ao vivo)')
    const perde = perdeNoTexto(item, atual, t, CAMPOS_PRESERVAR)
    if (perde.length) return bloq(`a descrição nova perde o que a atual afirma: ${perde.map(x => x.campo).join(', ')}`)
    if (atual != null && norm(atual) === norm(t)) return bloq('nada a mudar: a descrição já é esta')
    out.esperado.descricao = norm(t); out.diff.push({ campo: 'descrição', de: atual == null ? '(não lida)' : String(atual).slice(0, 80), para: t.slice(0, 80) })
    grupo('descricao', atual != null ? 'PUT' : 'POST', `/items/${id}/description${atual != null ? '?api_version=2' : ''}`, { plain_text: t })
  }

  if (operacao === 'atributos') {
    const ids = p.atributos.map(a => a.id); toca(['atributos'], { atributos: ids })
    const muda = p.atributos.filter(a => norm(out.antes.atributos[a.id] ?? '') !== norm(a.valor))
    if (!muda.length) return bloq('nada a mudar: a ficha já tem estes valores')
    out.ids.atributos = muda.map(a => a.id); out.antes.atributos = Object.fromEntries(muda.map(a => [a.id, out.antes.atributos[a.id]]))
    out.esperado.atributos = Object.fromEntries(muda.map(a => [a.id, norm(a.valor)]))
    for (const a of muda) out.diff.push({ campo: `ficha ${a.id}`, de: out.antes.atributos[a.id], para: a.valor })
    grupo('ficha', 'PUT', `/items/${id}`, { attributes: muda.map(a => ({ id: a.id, value_name: a.valor })) })
  }

  if (operacao === 'fotos') {
    toca(['fotos'])
    if (vars.length) return bloq('anúncio com variações: a galeria é por variação (use Ofertas, que preserva as irmãs)')
    const atual = out.antes.fotos
    const nova = p.capa ? (atual.includes(p.capa) ? [p.capa, ...atual.filter(x => x !== p.capa)] : null) : p.ordem
    if (!nova) return bloq('a capa escolhida não é uma foto deste anúncio')
    if (nova.length !== atual.length || !nova.every(x => atual.includes(x))) return bloq('a nova ordem precisa ter exatamente as fotos que o anúncio já tem (troca de ordem/capa, nunca foto nova ou removida)')
    if (igual(nova, atual)) return bloq('nada a mudar: as fotos já estão nesta ordem')
    out.esperado.fotos = nova; out.diff.push({ campo: 'fotos', de: atual.join(', '), para: nova.join(', ') })
    grupo('galeria', 'PUT', `/items/${id}`, { pictures: nova.map(x => ({ id: x })) })
  }

  if (operacao === 'restaurar') {
    const s = ctx.snapshot
    if (!s) return bloq('fotografia «como era» não encontrada para este anúncio')
    const conteudoOk = !catalogoBloqueia(ctx), avisos = []
    // título
    if (s.titulo && norm(s.titulo) !== norm(item.title)) {
      if (!conteudoOk) avisos.push('título: catálogo, fica como está')
      else if ((item.sold_quantity ?? 0) > 0 || item.user_product_id) avisos.push('título: anúncio com vendas ou User Products, o Mercado Livre não deixa voltar')
      else { toca(['titulo']); out.esperado.titulo = norm(s.titulo); out.diff.push({ campo: 'título', de: item.title, para: s.titulo }); grupo('titulo', 'PUT', `/items/${id}`, { title: norm(s.titulo).slice(0, cfg.execucao.titulo_max) }) }
    }
    // fotos (só ids que o anúncio já teve; sem variações)
    if (Array.isArray(s.fotos) && s.fotos.length && !igual(s.fotos.map(String), (item.pictures || []).map(x => String(x.id)))) {
      if (!conteudoOk || vars.length) avisos.push('fotos: catálogo ou anúncio com variações, ficam como estão')
      else { toca(['fotos']); out.esperado.fotos = s.fotos.map(String); out.diff.push({ campo: 'fotos', de: out.antes.fotos.join(', '), para: s.fotos.join(', ') }); grupo('galeria', 'PUT', `/items/${id}`, { pictures: s.fotos.map(x => ({ id: String(x) })) }); out.avisos.push('fotos: o Mercado Livre precisa ainda ter as fotos antigas pelo id (NOT_VERIFIED para fotos removidas); a conferência decide') }
    }
    // ficha (lista fechada de atributos)
    const perm = cfg.execucao.atributos_permitidos, muda = Object.entries(s.atributos || {}).filter(([k, v]) => perm.includes(k) && v != null && v !== '' && norm((item.attributes || []).find(a => a.id === k)?.value_name ?? '') !== norm(v))
    if (muda.length) {
      if (!conteudoOk) avisos.push('ficha: catálogo, fica como está')
      else { toca(['atributos'], { atributos: muda.map(([k]) => k) }); out.esperado.atributos = Object.fromEntries(muda.map(([k, v]) => [k, norm(v)])); for (const [k, v] of muda) out.diff.push({ campo: `ficha ${k}`, de: out.antes.atributos[k], para: v }); grupo('ficha', 'PUT', `/items/${id}`, { attributes: muda.map(([k, v]) => ({ id: k, value_name: String(v) })) }) }
    }
    // descrição
    if (s.descricao != null && item._descricao?.plain_text != null && norm(s.descricao) !== norm(item._descricao.plain_text)) {
      if (!conteudoOk) avisos.push('descrição: catálogo, fica como está')
      else { toca(['descricao']); out.esperado.descricao = norm(s.descricao); out.diff.push({ campo: 'descrição', de: String(item._descricao.plain_text).slice(0, 80), para: String(s.descricao).slice(0, 80) }); grupo('descricao', 'PUT', `/items/${id}/description?api_version=2`, { plain_text: String(s.descricao) }) }
    } else if (s.descricao != null && item._descricao?.plain_text == null) avisos.push('descrição: a atual não foi lida, fica como está')
    // frete grátis
    const fs = s.frete?.free_shipping
    if (fs != null && item.shipping && !!fs !== !!item.shipping.free_shipping && item.shipping.mode === 'me2' && !(!fs && (item.shipping.tags || []).includes('mandatory_free_shipping'))) {
      toca(['frete_gratis']); out.esperado.frete_gratis = !!fs; out.diff.push({ campo: 'frete grátis', de: !!item.shipping.free_shipping, para: !!fs }); grupo('frete_gratis', 'PUT', `/items/${id}`, { shipping: { free_shipping: !!fs } })
    }
    // preço por último e SOZINHO (preço + outro campo = ignorado pelo ML). Volta a um estado que o anúncio já teve: sem teto de variação; piso e decisão do cliente valem.
    const precoSnap = vars.length ? null : s.preco
    if (vars.length && (s.variacoes || []).some(v => { const w = vars.find(x => String(x.id) === String(v.id)); return w && v.preco != null && Math.round(v.preco * 100) !== Math.round(w.price * 100) })) avisos.push('preço: anúncio com variações, use a operação preço por variação')
    if (precoSnap != null && item.price != null && Math.round(precoSnap * 100) !== Math.round(item.price * 100)) {
      if (ctx.piso == null && p.decisao_cliente !== true) avisos.push('preço: sem custo informado, só volta com «decisão do cliente»')
      else if (ctx.piso != null && precoSnap < ctx.piso && precoSnap < item.price) avisos.push('preço: o preço antigo fica abaixo do piso de margem de hoje, fica como está')
      else { toca(['preco']); out.esperado.preco = r2(precoSnap); out.diff.push({ campo: 'preço', de: item.price, para: precoSnap }); grupo('preco', 'PUT', `/items/${id}`, { price: r2(precoSnap) }) }
    }
    out.avisos.push(...avisos, 'status não é restaurado aqui (é a operação pausar/ativar)')
    if (!out.grupos.length) return bloq('nada a restaurar: os campos da lista fechada já estão como na fotografia (ou não podem voltar)')
  }

  if (operacao === 'duplicar') {
    if (item.catalog_listing) return bloq('anúncio de catálogo não se duplica pelo sistema')
    if (vars.length) return bloq('anúncio com variações: duplicação pelo sistema ainda não (variações exigem o modelo de família)')
    const sku = ctx.sku
    if (!sku) return bloq('anúncio sem SKU (SELLER_SKU): a duplicata precisa do SKU copiado para o estoque e a idempotência')
    const est = validarEstoqueFisico({ quantidade: p.quantidade, fisico: ctx.fisico ?? null, outros: ctx.outros ?? 0 })
    if (!est.ok) return bloq(MOTIVOS_ESTOQUE_FISICO[est.motivo])
    const titulo = norm(p.titulo_novo || item.title).slice(0, cfg.execucao.titulo_max)
    const perde = perdeNoTexto(item, item.title, titulo, CAMPOS_PRESERVAR_TITULO); if (perde.length) return bloq(`o título da duplicata perde o que o original afirma: ${perde.map(x => x.campo).join(', ')}`)
    const fotos = (item.pictures || []).map(x => String(x.id))
    if (p.capa && !fotos.includes(p.capa)) return bloq('a capa escolhida não é uma foto deste anúncio')
    const galeria = (p.capa ? [p.capa, ...fotos.filter(x => x !== p.capa)] : fotos).map(x => ({ picture_id: x }))
    if (!galeria.length) return bloq('anúncio sem fotos lidas')
    const atributos = (item.attributes || []).filter(a => a.value_name && !['SELLER_SKU', 'ITEM_CONDITION'].includes(String(a.id).toUpperCase())).map(a => ({ id: a.id, value_name: a.value_name }))
    const proposta = { titulo, categoria_id: item.category_id, preco: item.price, estoque: p.quantidade, sku, galeria, atributos, listing_type: item.listing_type_id, condicao: item.condition || 'new', descricao: item._descricao?.plain_text || undefined }
    out.grupos.push({ grupo: 'criar', metodo: 'POST', caminho: '/items', proposta })
    out.esperado.duplicata = { titulo, quantidade: p.quantidade, sku }
    out.diff.push({ campo: 'anúncio novo', de: '—', para: `${titulo} · ${p.quantidade} un · SKU ${sku}` })
    out.avisos.push('a duplicata nasce ATIVA (o POST /items cria o anúncio ativo; estoque pela F5: soma dos estoques próprios do produto ≤ físico informado); para pausar, uma ordem de status')
  }

  if (operacao === 'promocao') {
    const pl = ctx.plano
    if (!pl) return bloq('plano de promoção não encontrado neste cliente (gere o dry-run e aprove em /promocoes)')
    if (pl.estado !== 'aprovado') return bloq('o plano de promoção não está aprovado em /promocoes')
    const entrar = (pl.itens || []).filter(i => i.acao === 'ENTRAR'), itens = [...new Set(entrar.map(i => i.item_id))]
    if (!itens.includes(id)) return bloq('o plano de promoção não inclui este anúncio')
    if (itens.length > 1) return bloq('o plano de promoção toca mais de um anúncio: pelo Chaveiro, 1 anúncio por ordem')
    for (const i of entrar) out.diff.push({ campo: 'promoção', de: 'fora', para: `${i.campanha || i.pid}${i.aprovado?.preco != null ? ` · R$ ${i.aprovado.preco}` : ''}` })
    out.grupos.push({ grupo: 'promocao', delegado: true, plano_id: pl.id })
    out.esperado.promocao = { plano_id: pl.id }
    out.avisos.push('executado pelo promocoes-exec (as travas dele valem também: execução habilitada no cliente, plano aprovado e válido por 24 h, hash, 1 anúncio); nunca sai de campanha')
  }

  if (operacao === 'ads') {
    const v = p.valor
    out.passo_a_passo = [
      'Abra o painel do Mercado Livre › Publicidade › Product Ads.',
      `Localize o anúncio ${id}${item.title ? ` (${String(item.title).slice(0, 50)})` : ''} na campanha.`,
      p.acao === 'ativar' ? 'Ative o anúncio na campanha (ou inclua-o na campanha certa).' : p.acao === 'pausar' ? 'Pause o anúncio na campanha.' : p.acao === 'orcamento' ? `Ajuste o orçamento diário da campanha para R$ ${v ?? '—'}.` : `Ajuste o ACOS/ROAS alvo da campanha (ACOS ${v ?? '—'}%).`,
      'Volte aqui e marque «Fiz»: a coleta de Ads do dia seguinte confere a mudança (status/custo do anúncio).',
    ]
    out.diff.push({ campo: 'Product Ads', de: item.ads_status || '—', para: p.acao + (v != null ? ` ${v}` : '') })
    out.avisos.push(MOTIVOS.assistido)
  }

  if (operacao === 'estoque') return bloq(MOTIVOS.f6)
  return out
}

// reversão: o «antes» da ordem conferida vira o alvo (só campos tocados). Preço volta sem teto (estado que o anúncio já teve); piso continua valendo.
export function planejarReversao(ordem, itemVivo, ctx = {}, { cfg = CFG } = {}) {
  const pay = ordem.payload, antes = pay.antes || {}
  if (!OPERACOES[pay.operacao]?.reversivel) return { bloqueios: ['esta operação não tem reversão automática'], grupos: [] }
  const snap = { titulo: antes.titulo, fotos: antes.fotos, atributos: antes.atributos, descricao: antes.descricao, frete: antes.frete_gratis == null ? undefined : { free_shipping: antes.frete_gratis }, preco: typeof antes.preco === 'number' ? antes.preco : null }
  if (pay.operacao === 'status') return planejar('status', { acao: antes.status === 'active' ? 'ativar' : 'pausar', decisao_reativar: true }, itemVivo, { ...ctx, reversao: true }, { cfg })
  if (pay.operacao === 'preco' && antes.preco && typeof antes.preco === 'object') {          // preço por variação: volta cada variação tocada; irmãs listadas por id (preservadas)
    const vars = itemVivo.variations || [], alvo = v => antes.preco[String(v.id)]
    const corpo = vars.map(v => (alvo(v) != null && Math.round(alvo(v) * 100) !== Math.round(v.price * 100) ? { id: v.id, price: alvo(v) } : { id: v.id }))
    const out = { operacao: 'preco', grupos: [], diff: [], antes: tocado(itemVivo, ['preco']), esperado: { preco: Object.fromEntries(vars.map(v => [String(v.id), r2(alvo(v) ?? v.price)])) }, ids: {}, bloqueios: [], avisos: [], passo_a_passo: [] }
    if (!corpo.some(c => c.price != null)) return { ...out, bloqueios: ['nada a reverter: os preços já são os de antes'] }
    if (ctx.piso != null && corpo.some(c => c.price != null && c.price < ctx.piso && c.price < vars.find(v => v.id === c.id).price)) return { ...out, bloqueios: ['o preço de antes fica abaixo do piso de margem de hoje'] }
    out.grupos.push({ grupo: 'preco', metodo: 'PUT', caminho: `/items/${itemVivo.id}`, corpo: assertCorpoSeguro({ variations: corpo }, 'preco') })
    out.diff = corpo.filter(c => c.price != null).map(c => ({ campo: `preço da variação ${c.id}`, de: vars.find(v => v.id === c.id)?.price, para: c.price }))
    return out
  }
  return planejar('restaurar', { snapshot: '0000000000000000', decisao_cliente: true }, itemVivo, { ...ctx, snapshot: snap, reversao: true }, { cfg })
}

// ── TRAVAS (puras) de UMA execução ao vivo → { liberado, motivos[] }. Todas precisam passar; qualquer uma fechada = nada sai para o ML.
// liberacao = linha de exec_liberacao (cliente × operação) | null; ampliado = estreia superada (10 conferidas + 48 h sem veto)
export function verificarTravas({ cfg = CFG, operacao, parado = false, prospect = false, integracaoOk = false, liberacao = null, ampliado = false, item_id = '', executadasHoje = 0, confirmar, ordem = null, reversao = false } = {}) {
  const m = [], op = OPERACOES[operacao]
  if (!op) return { liberado: false, motivos: ['operação fora da lista fechada'] }
  if (op.escrita === 'assistido') m.push(MOTIVOS.assistido)
  if (op.escrita === 'f6') m.push(MOTIVOS.f6)
  if (cfg.execucao_ligada !== true) m.push(MOTIVOS.chave_global)
  if (cfg.adaptadores_live?.[operacao] !== true) m.push(MOTIVOS.adaptador)
  if (parado) m.push(MOTIVOS.parado)
  if (prospect) m.push(MOTIVOS.prospect)
  if (!integracaoOk) m.push(MOTIVOS.integracao)
  if (!liberacao || !liberacao.liberado_por || liberacao.revogado_em) m.push(MOTIVOS.sem_liberacao)
  else {
    if (!liberacao.cliente_informado_em) m.push(MOTIVOS.cliente_informado)
    if (!ampliado && liberacao.estreia_item !== item_id) m.push(MOTIVOS.estreia)
  }
  const teto = ampliado ? cfg.execucao.teto_dia_ampliado : cfg.execucao.teto_dia_estreia
  if (!reversao && executadasHoje >= teto) m.push(MOTIVOS.teto_dia)
  if (confirmar !== true) m.push(MOTIVOS.confirmar)
  if (!ordem || ordem.estado !== 'aprovada') m.push(MOTIVOS.estado)
  else if (hashOrdem(ordem.payload) !== ordem.hash) m.push(MOTIVOS.hash)
  return { liberado: m.length === 0, motivos: m }
}
// estreia superada (decisão D-C1): proposta registrada, 48 h corridas e sem veto
export const ampliado = (lib, agoraISO) => !!(lib && lib.ampliacao_proposta_em && !lib.vetado_em && lib.veto_ate && lib.veto_ate <= agoraISO)
// o Neo propõe ampliar quando a operação tem N ordens conferidas e nenhuma divergente/falha neste cliente
export const neoPropoe = ({ lib, conferidas, divergencias, cfg = CFG }) => !!(lib && lib.liberado_por && !lib.revogado_em && !lib.ampliacao_proposta_em && conferidas >= cfg.execucao.ordens_para_ampliar && divergencias === 0)

// ── ESTRATÉGIAS ──
// campos que uma pré-condição pode ler (item do diagnóstico do Arquiteto + contexto): lista fechada; dado ausente = NÃO atendida
export const CAMPOS_PRECONDICAO = {
  visitas_28d: i => i.v ?? null, unidades_28d: i => i.u ?? null, conv: i => i.conv ?? null,
  queda_unidades_pct: i => (i.u0 > 0 ? Math.round((100 * (i.u - i.u0)) / i.u0) : null),
  conv_vs_conta: i => (i.conv != null && i.benchmark_ref?.conv > 0 ? i.conv / i.benchmark_ref.conv : null),
  cobertura_dias: i => i.cobertura ?? null, curva: i => i.curva ?? null, estoque: i => i.estoque ?? null,
  frete_gratis: i => (i.frete_gratis == null ? null : !!i.frete_gratis), status: i => i.status ?? null,
  custos_informados: (_i, c) => !!c.custos_informados, abaixo_do_piso: (i, c) => (c.piso == null || i.preco == null ? null : i.preco < c.piso),
}
const OPS_PRE = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '==': (a, b) => a === b }
export function avaliarPrecondicoes(precondicoes = [], itemDiag, ctx = {}) {
  const falhas = []
  for (const p of precondicoes) {
    const f = CAMPOS_PRECONDICAO[p.campo], v = f && itemDiag ? f(itemDiag, ctx) : null
    if (!f || !OPS_PRE[p.op]) { falhas.push({ campo: p.campo, motivo: 'pré-condição fora da lista fechada' }); continue }
    if (v == null) { falhas.push({ campo: p.campo, motivo: 'sem dado no diagnóstico: não atendida (nunca presumida)' }); continue }
    if (!OPS_PRE[p.op](v, p.valor)) falhas.push({ campo: p.campo, motivo: `${p.campo} ${p.op} ${p.valor} não atendida (hoje ${typeof v === 'number' ? Math.round(v * 100) / 100 : v})` })
  }
  return { ok: falhas.length === 0, falhas }
}
const VALIDA_PARAM_EST = { numero: VALIDA.numero, inteiro: VALIDA.inteiro, texto: VALIDA.texto, foto: VALIDA.foto, snapshot: VALIDA.snapshot, bool: VALIDA.bool }
// valores da estratégia → passos com os parâmetros trocados. Parâmetro vazio sem padrão = o passo que depende dele é PULADO (com motivo), nunca inventado.
export function expandirEstrategia(est, valores = {}) {
  const erros = [], vals = {}
  for (const [k, d] of Object.entries(est.parametros || {})) {
    const bruto = valores[k] === '' || valores[k] == null ? d.padrao : valores[k]
    if (bruto == null) continue
    const v = VALIDA_PARAM_EST[d.tipo]?.(bruto, d)
    if (v === undefined) erros.push(`${d.rotulo || k}: valor inválido`); else vals[k] = v
  }
  for (const k of Object.keys(valores || {})) if (!(est.parametros || {})[k]) erros.push('parâmetro fora da lista desta estratégia')
  const passos = (est.passos || []).map((p, i) => {
    const params = {}, faltam = []
    for (const [k, v] of Object.entries(p.params || {})) {
      if (typeof v === 'string' && v.startsWith('$')) { const nome = v.slice(1); if (vals[nome] === undefined) faltam.push(est.parametros?.[nome]?.rotulo || nome); else params[k] = vals[nome] }
      else params[k] = v
    }
    return { passo: i + 1, operacao: p.operacao, params, opcional_se: p.opcional_se || '', pulado: faltam.length ? `sem valor para: ${faltam.join(', ')}` : '' }
  })
  return { ok: erros.length === 0, erros, passos }
}
// estratégia NOVA (do David, pela tela): lista fechada de operações (nada de f6/estoque), parâmetros literais validados pela própria operação ou '$' declarados; pré-condições fechadas
export function validarEstrategia(def = {}, { cfg = CFG } = {}) {
  const erros = []
  const nome = typeof def.nome === 'string' ? def.nome.trim() : ''
  if (!nome || nome.length > 60) erros.push('nome: 1 a 60 caracteres')
  if (!Array.isArray(def.passos) || !def.passos.length || def.passos.length > 6) erros.push('passos: de 1 a 6')
  const parametros = def.parametros && typeof def.parametros === 'object' ? def.parametros : {}
  for (const [k, d] of Object.entries(parametros)) if (!/^[a-z_]{2,30}$/.test(k) || !VALIDA_PARAM_EST[d?.tipo]) erros.push('parâmetro da estratégia com nome ou tipo inválido')
  for (const p of def.passos || []) {
    const op = OPERACOES[p?.operacao]
    if (!op || op.escrita === 'f6') { erros.push('operação fora da lista fechada (estoque segue o sincronismo F6)'); continue }
    const literais = {}, refs = []
    for (const [k, v] of Object.entries(p.params || {})) { if (typeof v === 'string' && v.startsWith('$')) refs.push([k, v.slice(1)]); else literais[k] = v }
    for (const [k, nome] of refs) { if (!parametros[nome]) erros.push(`passo ${op.rotulo}: parâmetro $${nome} não declarado`); if (!op.params[k]) erros.push(`passo ${op.rotulo}: parâmetro fora da lista`) }
    // literais pela validação da operação; o que vem por '$' é validado na hora de rodar (expandirEstrategia + validarParams)
    const porRef = new Set(refs.map(([k]) => op.params[k]?.rotulo)), comRef = refs.length > 0
    for (const e of validarParams(p.operacao, literais, { cfg }).erros) {
      const faltaCobertaPorRef = /: obrigatório$/.test(e) && porRef.has(e.replace(/: obrigatório$/, ''))
      const formaPorRef = comRef && /^(preço: informe UMA|fotos: informe)/.test(e)
      if (!faltaCobertaPorRef && !formaPorRef) erros.push(`passo ${op.rotulo}: ${e}`)
    }
  }
  for (const p of def.precondicoes || []) if (!CAMPOS_PRECONDICAO[p?.campo] || !OPS_PRE[p?.op]) erros.push('pré-condição fora da lista fechada')
  const janela = Number.isInteger(def.janela_dias) ? def.janela_dias : CFG.execucao.janela_medicao_dias
  if (janela < 7 || janela > 90) erros.push('janela de medição entre 7 e 90 dias')
  return { ok: erros.length === 0, erros, estrategia: { nome, objetivo: String(def.objetivo || '').slice(0, 300), parametros, passos: (def.passos || []).map(p => ({ operacao: p.operacao, params: p.params || {} })), precondicoes: def.precondicoes || [], kpi: String(def.kpi || 'unidades e receita').slice(0, 120), janela_dias: janela } }
}

// o que o Merovíngio mede depois (texto fixo por operação + janela)
export const medicaoDe = (operacao, janela = CFG.execucao.janela_medicao_dias) => `${OPERACOES[operacao]?.metrica || 'unidades'} nos ${janela} dias depois da conferência × os ${janela} antes, descontado o que os anúncios sem mudança fizeram (associação temporal, não prova de causa)`
// estado para a tela (exec_ordem não tem 'revertida' no CHECK: a reversão conferida fica registrada no resultado da original)
export const ROTULO_ESTADO = { preparada: 'preparada', aguardando_aprovacao: 'preparada', aprovada: 'aprovada', executando: 'enviada', em_conferencia: 'enviada', executada: 'conferida', divergente: 'divergente', falhou: 'falhou', recusada: 'recusada', cancelada: 'cancelada', obsoleta: 'obsoleta' }
export const estadoExibido = o => (o.estado === 'executada' && o.resultado?.revertida_por ? 'revertida' : ROTULO_ESTADO[o.estado] || o.estado)

// ── DDL (db.js executa; os testes sobem o mesmo texto em memória). exec_ordem / exec_evento são as MESMAS da F6 (chaveiro-estoque.js).
export const SCHEMA_EXECUTOR = `
CREATE TABLE IF NOT EXISTS exec_liberacao (             -- F4+: liberação por cliente × operação (líder + cliente informado), estreia em 1 anúncio e a ampliação do Neo com veto (D-C1)
  cliente TEXT NOT NULL, operacao TEXT NOT NULL CHECK (operacao IN ('preco','status','frete_gratis','titulo','descricao','atributos','fotos','restaurar','duplicar','promocao')),
  estreia_item TEXT NOT NULL DEFAULT '',
  liberado_por TEXT NOT NULL DEFAULT '', liberado_em TEXT NOT NULL DEFAULT '',
  cliente_informado_por TEXT NOT NULL DEFAULT '', cliente_informado_em TEXT NOT NULL DEFAULT '',
  ampliacao_proposta_em TEXT NOT NULL DEFAULT '', veto_ate TEXT NOT NULL DEFAULT '', vetado_por TEXT NOT NULL DEFAULT '', vetado_em TEXT NOT NULL DEFAULT '',
  revogado_por TEXT NOT NULL DEFAULT '', revogado_em TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, operacao));
CREATE TABLE IF NOT EXISTS exec_estrategia (            -- F4+: estratégia própria criada pela tela (mesma validação do catálogo config/estrategias.json)
  id TEXT PRIMARY KEY, nome TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 60), definicao_json TEXT NOT NULL,
  ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0,1)), por TEXT NOT NULL, em TEXT NOT NULL);
`
