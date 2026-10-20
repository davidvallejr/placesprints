// Chaveiro F4+ com banco e API (núcleo puro em chaveiro-executor.js). As tabelas são as da F6 (exec_ordem, exec_evento) + exec_liberacao e exec_estrategia.
// PRÉVIA: só o cache do banco (meli_item + a última fotografia «como era»), nenhuma chamada ao ML. PREPARAR (confirmar === true): relê o anúncio ao vivo (GET) e grava a ordem
// aguardando aprovação com o «antes» lido ao vivo e o hash. APROVAR: líder. EXECUTAR: a ÚNICA função deste módulo que escreve no Mercado Livre (executarOrdem) — e só depois
// de TODAS as travas (verificarTravas) + releitura ao vivo coerente com o aprovado + automação de preço conferida; preço sempre sozinho; nunca status closed, nunca DELETE.
// Duplicar escreve pelo criarAnuncio de Ofertas (idempotente por SKU); promoção pelo executarPlano de Promoções (as travas deles valem também). CONFERIR: só leitura (2xx ≠ feito).
// Conferida = marco do Merovíngio: meli_item_mudanca fonte «chaveiro» (atribuição § 8, fonte 1) + fotografia «como era» de origem chaveiro. Logs/avisos assinados pelo Chaveiro.
import { db, agora, hojeLocal, getEstado, setEstado, log } from './db.js'
import { voz } from './sistemas.js'
import { notificar } from './notificacoes.js'
import { validarLider, criarApiEstoque } from './chaveiro-estoque-real.js'
import { alinhamentosReal } from './alinhamentos-real.js'
import { criarCatalogo } from './catalogo-db.js'
import { origemCatalogo } from './catalogo.js'
import { custosDoCliente, descontoMaximoPct } from './diagnostico-conta.js'
import { vinculosCusto } from './custos-db.js'
import { snapshotDeLinha } from './anuncio-historico.js'
import { chaveSku } from './produto-estoque.js'
import { priorEfetivo } from './calibracao.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import * as X from './chaveiro-executor.js'

const ALG = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8'))
const E = () => X.CFG.execucao
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => (typeof v === 'string' ? v.trim() : '')
const parse = (t, d) => { try { return JSON.parse(t) } catch { return d } }
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const lg = (nivel, msg) => { try { log(nivel, voz('chaveiro', msg)) } catch { /* log nunca derruba a execução */ } }
const avisar = (titulo, corpo, cliente, nivel = 'info', sistema = 'chaveiro') => { try { notificar({ tipo: 'chaveiro_execucao', nivel, titulo, corpo, cliente, sistema }) } catch { /* aviso nunca derruba */ } }
const MLB = /^MLB\d{1,14}$/
const CHAVE_PARADO = 'chaveiro_execucao_parado'
export const parado = () => getEstado(CHAVE_PARADO) === '1'
const catalogoDb = criarCatalogo(db)

// ── leituras (isolamento por cliente em TODA consulta) ──
const ultimaFoto = (cliente, id) => db.prepare('SELECT * FROM meli_item_snapshot WHERE cliente = ? AND item_id = ? ORDER BY capturado_em DESC LIMIT 1').get(cliente, id)
// anúncio a partir do cache (meli_item + última fotografia): o MESMO formato do GET /items/{id}, marcado _fonte 'cache'
export function itemDoCache(cliente, id) {
  const m = db.prepare('SELECT * FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, id); if (!m) return null
  const s = ultimaFoto(cliente, id), f = s ? snapshotDeLinha(s) : null
  return { id, title: m.titulo, price: m.preco, status: m.status, sub_status: [], sold_quantity: m.vendidos ?? null, catalog_listing: !!m.catalogo, category_id: m.category_id || f?.categoria || '', listing_type_id: m.tipo_anuncio || f?.tipo_anuncio || '',
    pictures: (f?.fotos || []).map(x => ({ id: String(x) })), attributes: Object.entries(f?.atributos || {}).map(([k, v]) => ({ id: k, value_name: v })),
    variations: (f?.variacoes || []).map(v => ({ id: v.id, price: v.preco, picture_ids: v.picture_ids || [] })),
    shipping: { free_shipping: !!m.frete_gratis, mode: f?.frete?.mode ?? null, tags: [] }, _descricao: f?.descricao != null ? { plain_text: f.descricao } : null, _descricao_lida: f?.descricao != null,
    _fonte: 'cache', _cache_em: s?.capturado_em || m.atualizado_em || '' }
}
async function lerVivo(api, cliente, id, { descricao = false } = {}) {
  const r = await api.get(cliente, `/items/${id}?include_attributes=all`)
  if (r.status !== 200 || r.corpo?.id !== id) return null
  const it = r.corpo
  if (descricao) { const d = await api.get(cliente, `/items/${id}/description`); it._descricao_lida = d.status === 200 || d.status === 404; it._descricao = d.status === 200 && typeof d.corpo?.plain_text === 'string' ? { plain_text: d.corpo.plain_text } : null }
  return it
}
const precisaDescricao = op => ['descricao', 'restaurar', 'duplicar'].includes(op)

// contexto da operação: catálogo, alinhamento, piso de margem (custos), fotografia (restaurar), SKU/físico (duplicar), plano (promoção)
function contexto(cliente, item, operacao, params = {}, { hoje = hojeLocal() } = {}) {
  const ctx = { catalogoOrigem: item.catalog_listing ? origemCatalogo({ id: item.id, catalogo: 1 }, catalogoDb.contexto(cliente)) : 'nao' }
  try {
    const al = alinhamentosReal()
    ctx.alinhado = al.predicado(cliente, { hoje })({ item: item.id }).sim || al.vivos(cliente, { hoje }).some(r => r.escopo === 'anuncio' && r.chave === item.id)
  } catch { ctx.alinhado = true }                                                                                // sem conseguir ler os alinhamentos = trata como alinhado (não escreve)
  const custos = custosDoCliente(cliente); ctx.custos_informados = !!custos
  if (custos && item.price > 0) {
    let cu = null; try { cu = vinculosCusto.custosDosAnuncios(cliente, [{ item_id: item.id }]).get(item.id)?.custo ?? null } catch { cu = null }
    const dmax = descontoMaximoPct(cu != null ? { ...custos, cmv_pct: (100 * cu) / item.price } : custos)
    ctx.piso = dmax == null ? null : Math.ceil(item.price * (1 - dmax / 100) * 100) / 100                     // premissa: custos da conta (+ custo do anúncio quando vinculado); fixos por unidade não caem com o preço
  } else ctx.piso = null
  if (operacao === 'restaurar' && params.snapshot) { const s = db.prepare('SELECT * FROM meli_item_snapshot WHERE cliente = ? AND item_id = ? AND hash = ?').get(cliente, item.id, params.snapshot); ctx.snapshot = s ? snapshotDeLinha(s) : null }
  if (operacao === 'duplicar') {
    ctx.sku = str((item.attributes || []).find(a => String(a.id).toUpperCase() === 'SELLER_SKU')?.value_name || item.seller_custom_field || '')
    const k = ctx.sku ? chaveSku(ctx.sku) : ''
    const decl = k ? db.prepare('SELECT quantidade, em FROM produto_estoque_declarado WHERE cliente = ? AND sku = ?').get(cliente, k) : null
    const validade = (ALG.produto?.estoque_declarado_validade_dias ?? 7) * 86_400_000
    ctx.fisico = decl && Date.now() - Date.parse(decl.em) <= validade ? decl.quantidade : null
    // outros estoques próprios do mesmo SKU (um por produto do ML; Full fora): o original conta
    const linhas = k ? db.prepare("SELECT item_id, user_product_id, sku, estoque, logistica, status FROM meli_anuncio_up WHERE cliente = ? AND status IN ('active','paused') AND logistica != 'fulfillment'").all(cliente).filter(a => chaveSku(a.sku || '') === k) : []
    const porPool = new Map(); for (const a of linhas) { const p = a.user_product_id || a.item_id; porPool.set(p, Math.max(porPool.get(p) ?? 0, a.estoque || 0)) }
    ctx.outros = [...porPool.values()].reduce((t, x) => t + x, 0)
  }
  if (operacao === 'promocao' && params.plano_id) { try { ctx.plano = db.prepare('SELECT id, estado, itens_json FROM promo_plano WHERE cliente = ? AND id = ?').get(cliente, params.plano_id); if (ctx.plano) ctx.plano = { id: ctx.plano.id, estado: ctx.plano.estado, itens: parse(ctx.plano.itens_json, []) } } catch { ctx.plano = null } }
  return ctx
}

// Oráculo: a previsão da ação do plano deste anúncio (mesma regra) e a chance da regra (prior calibrado); nada inventado para operação avulsa
function oraculo(cliente, item_id, operacao, acao_id = '') {
  const regra = X.OPERACOES[operacao]?.regra
  let acao = null
  try {
    acao = acao_id ? db.prepare('SELECT id, regra, previsao_json FROM acoes_plano WHERE cliente = ? AND id = ?').get(cliente, acao_id)
      : db.prepare("SELECT id, regra, previsao_json FROM acoes_plano WHERE cliente = ? AND item_id = ? AND status IN ('proposta','aprovada','distribuida') AND regra IN (?, ?) ORDER BY score DESC LIMIT 1").get(cliente, item_id, regra, `anuncio_${regra}`)
  } catch { acao = null }
  const prev = acao ? parse(acao.previsao_json, null) : null
  let chance = null; try { const p = priorEfetivo(acao?.regra || regra); chance = p ? { p: Math.round(p.p * 100) / 100, fonte: p.fonte } : null } catch { chance = null }
  return prev?.cenarios ? { acao_id: acao.id, faixa: { conservador: prev.cenarios.conservador?.receita ?? null, base: prev.cenarios.base?.receita ?? null, otimista: prev.cenarios.otimista?.receita ?? null }, horizonte_dias: prev.horizonte_dias ?? null, hipotese: prev.hipotese !== false, chance, premissas: (prev.premissas || []).slice(0, 3) }
    : { acao_id: '', faixa: null, chance, nota: 'operação avulsa: sem previsão do Oráculo para este anúncio (só a medição do Merovíngio dirá)' }
}

// diagnóstico do Arquiteto por anúncio (pré-condições das estratégias); falha = sem dado (pré-condição não atendida)
async function diagnostico(cliente) {
  try { const { diagnosticarConta } = await import('./diagnostico-conta.js'); const d = diagnosticarConta(cliente); return { itens: new Map((d.itens || []).map(i => [i.id, i])), custos_informados: !!d.custos_informados } } catch { return { itens: new Map(), custos_informados: false } }
}
function estrategiaPorId(id) {
  const c = X.CFG_ESTRATEGIAS.estrategias.find(e => e.id === id); if (c) return { ...c, origem: 'catalogo' }
  const r = db.prepare('SELECT * FROM exec_estrategia WHERE id = ? AND ativa = 1').get(id)
  return r ? { id: r.id, ...parse(r.definicao_json, {}), origem: 'propria', por: r.por } : null
}
export const listarEstrategias = () => [...X.CFG_ESTRATEGIAS.estrategias.map(e => ({ ...e, origem: 'catalogo' })), ...db.prepare('SELECT * FROM exec_estrategia WHERE ativa = 1 ORDER BY em DESC').all().map(r => ({ id: r.id, ...parse(r.definicao_json, {}), origem: 'propria', por: r.por, em: r.em }))]

// passos de um pedido: operação avulsa (1 passo) ou estratégia expandida
function passosDo(pedido) {
  if (pedido.estrategia) {
    const est = estrategiaPorId(str(pedido.estrategia)); if (!est) throw erro('estratégia não encontrada', 404)
    const x = X.expandirEstrategia(est, pedido.valores || {}); if (!x.ok) throw erro(x.erros.join('; '))
    return { estrategia: est, passos: x.passos }
  }
  const op = str(pedido.operacao); if (!X.OPERACOES[op]) throw erro('operação fora da lista fechada')
  return { estrategia: null, passos: [{ passo: 1, operacao: op, params: pedido.params || {}, opcional_se: '', pulado: '' }] }
}
function validarItens(cliente, itens) {
  const ids = [...new Set((Array.isArray(itens) ? itens : []).map(str))]
  if (!ids.length) throw erro('selecione ao menos um anúncio')
  if (ids.length > E().teto_ordens_por_lote) throw erro(`no máximo ${E().teto_ordens_por_lote} anúncios por lote`)
  if (ids.some(i => !MLB.test(i))) throw erro('anúncio inválido: use o código MLB')
  const conhecidos = new Set(db.prepare(`SELECT item_id FROM meli_item WHERE cliente = ? AND item_id IN (${ids.map(() => '?').join(',')})`).all(cliente, ...ids).map(r => r.item_id))
  if (ids.some(i => !conhecidos.has(i))) throw erro('anúncio não encontrado neste cliente', 404)       // isolamento: só anúncio coletado deste cliente
  return ids
}
// um passo sobre um anúncio → linha da prévia/preparo
function linhaDoPasso(cliente, item, p, { diag = null, acao_id = '' } = {}) {
  const v = X.validarParams(p.operacao, p.params)
  if (p.pulado) return { item_id: item.id, passo: p.passo, operacao: p.operacao, situacao: 'pulado', bloqueios: [p.pulado], diff: [] }
  if (p.opcional_se === 'ativo' && item.status === 'active') return { item_id: item.id, passo: p.passo, operacao: p.operacao, situacao: 'pulado', bloqueios: ['já está ativo'], diff: [] }
  if (!v.ok) return { item_id: item.id, passo: p.passo, operacao: p.operacao, situacao: 'bloqueado', bloqueios: v.erros, diff: [] }
  const ctx = contexto(cliente, item, p.operacao, v.params), pl = X.planejar(p.operacao, v.params, item, ctx)
  return { item_id: item.id, passo: p.passo, operacao: p.operacao, rotulo: X.OPERACOES[p.operacao].rotulo, escrita: X.OPERACOES[p.operacao].escrita, doc: X.OPERACOES[p.operacao].doc, params: v.params,
    situacao: pl.bloqueios.length ? 'bloqueado' : X.OPERACOES[p.operacao].escrita === 'assistido' ? 'assistido' : 'pronto', bloqueios: pl.bloqueios, avisos: pl.avisos, diff: pl.diff, passo_a_passo: pl.passo_a_passo,
    plano: pl, piso: ctx.piso ?? null, custos_informados: ctx.custos_informados, catalogo: ctx.catalogoOrigem, oraculo: oraculo(cliente, item.id, p.operacao, acao_id), medicao: X.medicaoDe(p.operacao), _diag: diag }
}

// ── PRÉVIA (só cache; nenhuma chamada ao ML) ──
export async function previa(cliente, pedido = {}) {
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  const ids = validarItens(cliente, pedido.itens), { estrategia, passos } = passosDo(pedido)
  const dg = estrategia?.precondicoes?.length ? await diagnostico(cliente) : null
  const anuncios = []
  for (const id of ids) {
    const item = itemDoCache(cliente, id), linhas = passos.map(p => linhaDoPasso(cliente, item, p, { acao_id: str(pedido.acao_id) }))
    const pre = estrategia ? X.avaliarPrecondicoes(estrategia.precondicoes || [], dg?.itens.get(id) || null, { custos_informados: dg?.custos_informados, piso: linhas.find(l => l.piso != null)?.piso ?? null }) : { ok: true, falhas: [] }
    const recentes = db.prepare("SELECT COUNT(*) n FROM exec_ordem WHERE cliente = ? AND item_id = ? AND estado = 'executada' AND conferido_em >= ?").get(cliente, id, new Date(Date.now() - E().janela_medicao_dias * 86_400_000).toISOString()).n
    anuncios.push({ item_id: id, titulo: item.title, fonte: 'cache', cache_em: item._cache_em, precondicoes: pre, aviso_medicao: recentes ? `este anúncio já teve ${recentes} execução(ões) conferida(s) nos últimos ${E().janela_medicao_dias} dias: o efeito vai aparecer como conjunto no Merovíngio` : '',
      passos: linhas.map(({ plano, _diag, ...l }) => ({ ...l, grupos: (plano?.grupos || []).map(g => ({ grupo: g.grupo, metodo: g.metodo, caminho: g.caminho })) })) })
  }
  return { cliente, previa: true, escrita: false, estrategia: estrategia ? { id: estrategia.id, nome: estrategia.nome, kpi: estrategia.kpi, janela_dias: estrategia.janela_dias, holdout: estrategia.holdout || '' } : null, anuncios,
    nota: 'Prévia do cache (última coleta e última fotografia do anúncio): nada foi lido ao vivo nem escrito. Ao preparar, o anúncio é relido ao vivo; ao executar, relido de novo e comparado com o aprovado.' }
}

// ── ordens ──
const evento = (ordem_id, cliente, de, para, por, detalhe = {}) => db.prepare('INSERT INTO exec_evento (ordem_id, cliente, de, para, por, detalhe_json, em) VALUES (?,?,?,?,?,?,?)').run(ordem_id, cliente, de, para, String(por || 'sistema').slice(0, 80), JSON.stringify(detalhe).slice(0, 4000), agora())
function transicionar(ordem, para, por, detalhe = {}, extra = {}) {
  if (!X.podeIr(ordem.estado, para)) throw erro(`transição inválida da ordem (${ordem.estado} → ${para})`, 409)
  const cols = Object.keys(extra).filter(k => ['aprovado_por', 'aprovado_em', 'executado_em', 'conferir_em', 'conferido_em', 'conferencias', 'resultado_json', 'erro'].includes(k))
  const r = db.prepare(`UPDATE exec_ordem SET estado = ?, atualizado_em = ?${cols.map(c => `, ${c} = ?`).join('')} WHERE id = ? AND cliente = ? AND estado = ?`).run(para, agora(), ...cols.map(c => extra[c]), ordem.id, ordem.cliente, ordem.estado)
  if (!r.changes) throw erro('a ordem mudou de estado no meio (outra execução?): nada foi feito', 409)
  evento(ordem.id, ordem.cliente, ordem.estado, para, por, detalhe)
  Object.assign(ordem, extra, { estado: para })
  return ordem
}
const DO_EXECUTOR = "adaptador != 'ml_estoque' AND json_extract(payload_json, '$.executor') = 'f4'"
const lerOrdem = (cliente, id) => { const r = db.prepare(`SELECT * FROM exec_ordem WHERE id = ? AND cliente = ? AND ${DO_EXECUTOR}`).get(id, cliente); return r ? { ...r, payload: parse(r.payload_json, {}), resultado: parse(r.resultado_json, {}) } : null }
const liberacaoDe = (cliente, op) => db.prepare('SELECT * FROM exec_liberacao WHERE cliente = ? AND operacao = ?').get(cliente, op) || null
const contagem = (cliente, op) => db.prepare(`SELECT SUM(estado = 'executada') conferidas, SUM(estado IN ('divergente','falhou')) divergencias FROM exec_ordem WHERE cliente = ? AND operacao = ? AND ${DO_EXECUTOR}`).get(cliente, op)
const executadasHoje = (cliente, op, hoje) => db.prepare(`SELECT COUNT(*) n FROM exec_ordem WHERE cliente = ? AND operacao = ? AND executado_em >= ? AND json_extract(payload_json, '$.reverte') IS NULL AND ${DO_EXECUTOR}`).get(cliente, op, `${hoje}T00:00:00`).n

// PREPARAR: confirmar !== true → prévia; com confirmar, relê cada anúncio AO VIVO e grava uma ordem por passo × anúncio (aguardando aprovação). Nada vai ao ML aqui além de GET.
export async function preparar(cliente, pedido = {}, { por = '', confirmar = false, validarPor = null, api = null, agoraISO = agora() } = {}) {
  if (confirmar !== true) return previa(cliente, pedido)
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  const quem = (validarPor ? validarPor(str(por), cliente) : '') || validarLider(str(por), cliente)
  if (!quem) throw erro('somente líder, consultor ou o CS deste cliente preparam ordens', 403)
  const ids = validarItens(cliente, pedido.itens), { estrategia, passos } = passosDo(pedido)
  const dg = estrategia?.precondicoes?.length ? await diagnostico(cliente) : null
  api ||= criarApiEstoque({ tokenValido: (await import('./meli-contas.js')).tokenValido })
  const execucao = X.idOrdem(`${cliente}|${estrategia?.id || passos[0].operacao}|${ids.join(',')}|${agoraISO}`).replace('CH-', 'EX-')
  const criadas = [], ignoradas = []
  for (const id of ids) {
    const precisaVivo = passos.some(p => X.OPERACOES[p.operacao]?.adaptador === 'ml_item' || p.operacao === 'duplicar')
    const vivo = precisaVivo ? await lerVivo(api, cliente, id, { descricao: passos.some(p => precisaDescricao(p.operacao)) }) : itemDoCache(cliente, id)
    if (!vivo) { ignoradas.push({ item_id: id, motivo: X.MOTIVOS.leitura }); continue }
    if (estrategia) { const pre = X.avaliarPrecondicoes(estrategia.precondicoes || [], dg?.itens.get(id) || null, { custos_informados: dg?.custos_informados, piso: contexto(cliente, vivo, 'preco').piso }); if (!pre.ok) { ignoradas.push({ item_id: id, motivo: `pré-condição: ${pre.falhas.map(f => f.motivo).join('; ')}` }); continue } }
    const aberta = db.prepare(`SELECT id FROM exec_ordem WHERE cliente = ? AND item_id = ? AND estado IN ('preparada','aguardando_aprovacao','aprovada','executando','em_conferencia') AND ${DO_EXECUTOR}`).get(cliente, id)
    if (aberta) { ignoradas.push({ item_id: id, motivo: 'já existe uma ordem aberta neste anúncio: uma intervenção por vez' }); continue }
    for (const p of passos) {
      const l = linhaDoPasso(cliente, vivo, p, { acao_id: str(pedido.acao_id) })
      if (l.situacao === 'pulado') { ignoradas.push({ item_id: id, passo: p.passo, motivo: l.bloqueios.join('; ') }); continue }
      if (l.situacao === 'bloqueado') { ignoradas.push({ item_id: id, passo: p.passo, motivo: l.bloqueios.join('; ') }); continue }
      const payload = { executor: 'f4', operacao: p.operacao, params: l.params, grupos: l.plano.grupos, antes: l.plano.antes, esperado: l.plano.esperado, ids: l.plano.ids, passo_a_passo: l.plano.passo_a_passo,
        decisao_cliente: l.params.decisao_cliente === true && l.piso == null ? { por: quem, em: agoraISO } : null, estrategia: estrategia ? { id: estrategia.id, nome: estrategia.nome, passo: p.passo, de: passos.length, kpi: estrategia.kpi, janela_dias: estrategia.janela_dias, holdout: estrategia.holdout || '' } : null,
        execucao, acao_id: str(pedido.acao_id), piso: l.piso, lido_em: agoraISO, previa_em: agoraISO }
      const hash = X.hashOrdem(payload), chave = `${cliente}|f4|${p.operacao}|${id}|${hash}`, oid = X.idOrdem(chave), em = agora()
      const op = X.OPERACOES[p.operacao]
      const r = db.prepare(`INSERT INTO exec_ordem (id, cliente, acao_id, regra, item_id, produto, caminho, adaptador, operacao, payload_json, snapshot_antes_json, hash, chave_idem, estado, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,'',?,?,?,?,?,?,?,'aguardando_aprovacao',?,?) ON CONFLICT(chave_idem) DO NOTHING`).run(oid, cliente, str(pedido.acao_id), estrategia ? `estrategia:${estrategia.id}` : `chaveiro:${p.operacao}`, id,
        op.escrita === 'assistido' ? 'assistido' : 'automatico', op.adaptador, p.operacao, JSON.stringify(payload), JSON.stringify({ item_id: id, antes: l.plano.antes, lido_em: agoraISO }), hash, chave, em, em)
      if (r.changes) evento(oid, cliente, '', 'aguardando_aprovacao', quem, { operacao: p.operacao, item_id: id, diff: l.diff.slice(0, 10), estrategia: estrategia?.id || null })
      criadas.push({ id: oid, item_id: id, operacao: p.operacao, passo: p.passo })
    }
  }
  if (criadas.length) lg('info', `${criadas.length} ordem(ns) preparada(s) para ${cliente} (aguardando aprovação do líder)`)
  return { cliente, previa: false, execucao, criadas, ignoradas }
}

// APROVAR: só o líder do cliente. Registra quem aprovou com o hash (o que foi aprovado é o que sai).
export function aprovar(cliente, { ordens = [], por = '' } = {}) {
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  const quem = validarLider(str(por), cliente); if (!quem) throw erro('somente o líder do cliente aprova ordens do Chaveiro', 403)
  const ids = [...new Set((Array.isArray(ordens) ? ordens : []).map(str))].filter(i => /^CH-[0-9a-f]{10}$/.test(i)).slice(0, E().teto_ordens_por_lote)
  if (!ids.length) throw erro('informe as ordens (CH-…)')
  const out = []
  for (const id of ids) {
    const o = lerOrdem(cliente, id); if (!o) { out.push({ id, ok: false, motivo: 'ordem não encontrada neste cliente' }); continue }
    if (o.estado !== 'aguardando_aprovacao') { out.push({ id, ok: false, motivo: 'a ordem não está aguardando aprovação' }); continue }
    if (X.hashOrdem(o.payload) !== o.hash) { out.push({ id, ok: false, motivo: X.MOTIVOS.hash }); continue }
    transicionar(o, 'aprovada', quem, { hash: o.hash }, { aprovado_por: quem, aprovado_em: agora() }); out.push({ id, ok: true })
  }
  return { cliente, aprovadas: out.filter(x => x.ok).length, resultado: out }
}
export function cancelar(cliente, { ordens = [], por = '' } = {}) {
  const quem = validarLider(str(por), cliente); if (!quem) throw erro('somente o líder do cliente cancela ordens do Chaveiro', 403)
  let n = 0
  for (const id of (Array.isArray(ordens) ? ordens : []).map(str)) { const o = lerOrdem(cliente, id); if (o && ['preparada', 'aguardando_aprovacao', 'aprovada'].includes(o.estado)) { transicionar(o, 'cancelada', quem, { motivo: 'cancelada pelo líder' }); n++ } }
  return { cliente, canceladas: n }
}

// ── adaptadores reais (injetáveis nos testes) ──
let apiReal = null
async function apiPadrao() { if (!apiReal) { const { tokenValido } = await import('./meli-contas.js'); apiReal = criarApiEstoque({ tokenValido, tentativas: E().tentativas_429 }) } return apiReal }
async function integracaoPadrao(cliente) { const { integracaoMlReal } = await import('./gatilhos-real.js'); return integracaoMlReal(cliente).ok }
async function mlPadrao() { const { adaptadorMLPronto } = await import('./ofertas-ml.js'); return adaptadorMLPronto() }
async function promoPadrao() { const m = await import('./promocoes-exec.js'); return { executarPlano: m.executarPlano, sincronizarPosExecucao: m.sincronizarPosExecucao, lerPlano: (await import('./promocoes-db.js')).lerPlano } }

// EXECUTAR UMA ordem — a ÚNICA função do F4+ que escreve no Mercado Livre. por = líder do cliente; confirmar === true. deps: api {get,put,post}, ml (criarAnuncio), promo, integracao
export async function executarOrdem(cliente, ordem_id, { por = '', confirmar, api = null, ml = null, promo = null, integracao = null, cfg = X.CFG, agoraISO = agora(), hoje = hojeLocal() } = {}) {
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  const ordem = lerOrdem(cliente, str(ordem_id)); if (!ordem) throw erro('ordem não encontrada neste cliente', 404)
  const quem = validarLider(str(por), cliente); if (!quem) throw erro('somente o líder do cliente executa ordens do Chaveiro', 403)
  const opId = ordem.payload.operacao, lib = liberacaoDe(cliente, opId), reversao = !!ordem.payload.reverte
  const integracaoOk = await (integracao || integracaoPadrao)(cliente).catch(() => false)
  const t = X.verificarTravas({ cfg, operacao: opId, parado: parado(), integracaoOk, liberacao: lib, ampliado: X.ampliado(lib, agoraISO), item_id: ordem.item_id, executadasHoje: executadasHoje(cliente, opId, hoje), confirmar, ordem, reversao })
  if (!t.liberado) { lg('aviso', `ordem ${ordem.id} de ${cliente} NÃO executada: ${t.motivos.join(' | ')}`); return { ok: false, executado: false, motivos: t.motivos, ordem: ordem.id } }
  transicionar(ordem, 'executando', quem, { hash: ordem.hash })
  let tentou = false
  const falha = (para, motivo, detalhe = {}) => {
    transicionar(ordem, para, quem, { motivo, ...detalhe }, { erro: motivo, resultado_json: JSON.stringify(detalhe), ...(tentou ? { executado_em: agora() } : {}) })
    lg(para === 'recusada' ? 'aviso' : 'erro', `ordem ${ordem.id} de ${cliente}: ${motivo}`)
    if (para !== 'recusada') avisar(`ordem do Chaveiro ${para}: ${ordem.item_id}`, motivo, cliente, 'alerta')
    return { ok: false, executado: false, estado: para, motivos: [motivo], ordem: ordem.id }
  }
  const emConferencia = (resultado, parou = null) => {
    transicionar(ordem, 'em_conferencia', quem, { enviados: (resultado.enviados || []).length, parou }, { executado_em: agora(), conferir_em: new Date(Date.now() + E().conferir_apos_min * 60_000).toISOString(), resultado_json: JSON.stringify({ ...resultado, parou }), erro: parou || '' })
    lg('info', `ordem ${ordem.id} de ${cliente} (${opId} em ${ordem.item_id}) enviada; conferência por releitura em ${E().conferir_apos_min} min`)
    return { ok: true, executado: true, estado: 'em_conferencia', ordem: ordem.id, parou, resultado }
  }

  // promoção: delega ao executor de Promoções (as travas dele valem também); a conferência lê o plano depois
  if (opId === 'promocao') {
    promo ||= await promoPadrao()
    const pl = promo.lerPlano(cliente, ordem.payload.params.plano_id)
    const itens = [...new Set((pl?.itens || []).filter(i => i.acao === 'ENTRAR').map(i => i.item_id))]
    if (!pl || itens.length !== 1 || itens[0] !== ordem.item_id) return falha('recusada', 'o plano de promoção mudou ou não é só deste anúncio: nada foi enviado')
    if (parado()) return falha('recusada', X.MOTIVOS.parado)
    let r; try { tentou = true; r = await promo.executarPlano(cliente, pl.id, { confirmar: true, por: quem }) } catch (e) { return falha(e.status === 403 || e.status === 409 ? 'recusada' : 'falhou', 'o executor de Promoções recusou ou falhou: veja a auditoria de /promocoes', { status: e.status || 0 }) }
    if (r.nada_enviado) { tentou = false; return falha('recusada', 'o executor de Promoções não enviou nada (o plano continua aprovado lá)') }
    return emConferencia({ plano_id: pl.id, estado_plano: r.estado, resumo: r.resumo })
  }

  api ||= await apiPadrao()
  const vivo = await lerVivo(api, cliente, ordem.item_id, { descricao: precisaDescricao(opId) || 'descricao' in (ordem.payload.antes || {}) })
  if (!vivo) return falha('falhou', X.MOTIVOS.leitura)
  // releitura ao vivo × o «antes» aprovado (só campos tocados): mudou fora do sistema = não envia
  const vivoTocado = X.tocado(vivo, Object.keys(ordem.payload.antes || {}), ordem.payload.ids || {})
  if (!X.conferePreparo(ordem.payload.antes || {}, vivoTocado)) return falha('divergente', X.MOTIVOS.divergente, { aprovado: ordem.payload.antes, lido: vivoTocado })
  // catálogo / alinhamento / regras da operação de novo sobre o anúncio VIVO: o que sairia tem de ser o aprovado
  const params = ordem.payload.params || {}
  const ctx = contexto(cliente, vivo, opId, params, { hoje })
  if (ctx.alinhado) return falha('recusada', X.MOTIVOS.alinhado)
  if (!reversao) {
    const pl = X.planejar(opId, params, vivo, ctx, { cfg })
    if (pl.bloqueios.length) return falha('recusada', pl.bloqueios[0])
    const semProposta = gs => gs.map(g => ({ ...g, proposta: g.proposta ? { ...g.proposta, descricao: undefined } : undefined }))
    if (JSON.stringify(semProposta(pl.grupos)) !== JSON.stringify(semProposta(ordem.payload.grupos))) return falha('recusada', X.MOTIVOS.aprovado_mudou)
  }

  // duplicar: criarAnuncio de Ofertas (idempotente por SKU; F5: estoque ≤ físico relido agora)
  if (opId === 'duplicar') {
    const g = ordem.payload.grupos[0]
    if (parado()) return falha('recusada', X.MOTIVOS.parado)
    ml ||= await mlPadrao()
    tentou = true
    const r = await ml.criarAnuncio(cliente, g.proposta, { live: true, chave_idem: ordem.chave_idem, excluir_ids: [ordem.item_id], publicacao_anterior: ordem.resultado?.criar || null })
    evento(ordem.id, cliente, 'executando', 'executando', quem, { metodo: 'POST', caminho: '/items', estado: r.estado, classe: r.classe_erro || null })
    if (r.estado === 'em_conferencia' && r.anuncio_id) return emConferencia({ anuncio_novo: r.anuncio_id, recuperado: !!r.recuperado, enviados: [{ grupo: 'criar', status: 201 }] })
    if (['aguardando_canal'].includes(r.estado)) return emConferencia({ criar: { classe_erro: r.classe_erro }, enviados: [{ grupo: 'criar', status: 0 }] }, X.MOTIVOS.incerto)
    return falha(r.estado === 'rejeitado' || r.estado === 'pendente_dados' ? 'recusada' : 'falhou', r.estado === 'rejeitado' ? 'Ofertas recusou a criação antes de enviar' : r.estado === 'pendente_dados' ? 'faltam dados para criar a duplicata' : X.MOTIVOS.payload, { estado: r.estado, classe: r.classe_erro || null })
  }

  // preço: automação de preço no ML conferida antes (com automação ativa, PUT só de price = 400; a doc manda verificar)
  if (ordem.payload.grupos.some(g => g.grupo === 'preco')) {
    const a = await api.get(cliente, `/pricing-automation/items/${ordem.item_id}/automation`)
    if (a.status === 200 && String(a.corpo?.status || '').toUpperCase() === 'ACTIVE') return falha('recusada', X.MOTIVOS.automacao)
    if (a.status !== 200 && a.status !== 404) return falha('recusada', X.MOTIVOS.automacao_nao_lida, { status: a.status })   // ponytail: 404 = sem automação (NOT_VERIFIED); outro status = não envia
  }
  // escrita: um envio por grupo, na ordem aprovada; kill switch relido antes de CADA envio; 2xx ≠ feito (a conferência decide)
  const enviados = []; let parou = null
  for (const g of ordem.payload.grupos) {
    if (parado()) { parou = X.MOTIVOS.parado; break }
    X.assertCorpoSeguro(g.corpo, opId)
    if (![`/items/${ordem.item_id}`, `/items/${ordem.item_id}/description`, `/items/${ordem.item_id}/description?api_version=2`].includes(g.caminho) || !['PUT', 'POST'].includes(g.metodo) || (g.metodo === 'POST' && !g.caminho.endsWith('/description'))) { parou = X.MOTIVOS.payload; break }   // só o próprio anúncio; POST só para criar a descrição
    tentou = true
    const res = g.metodo === 'POST' ? await api.post(cliente, g.caminho, g.corpo) : g.metodo === 'PUT' ? await api.put(cliente, g.caminho, g.corpo, {}) : { status: 0 }
    const classe = X.classificarStatus(res.status)
    evento(ordem.id, cliente, 'executando', 'executando', quem, { grupo: g.grupo, metodo: g.metodo, caminho: g.caminho, status: res.status, classe, avisos: (res.corpo?.warnings || []).slice?.(0, 3) || null })
    if (classe === 'enviado' || classe === 'incerto') enviados.push({ grupo: g.grupo, status: res.status, classe })
    if (classe !== 'enviado') { parou = X.MOTIVOS[classe] || X.MOTIVOS.incerto; break }
  }
  if (!enviados.length) return falha(parou === X.MOTIVOS.parado ? 'recusada' : 'falhou', parou || X.MOTIVOS.incerto, { enviados })
  return emConferencia({ enviados }, parou)
}

// marco do Merovíngio na conferência: change-log fonte «chaveiro» por campo tocado (atribuição § 8: execução do sistema = fonte 1)
const CAMPO_LOG = { preco: 'preco', status: 'status', frete_gratis: 'frete_gratis', titulo: 'titulo', descricao: 'descricao', atributos: 'atributos', fotos: 'fotos' }
function gravarMarco(ordem, lido) {
  const dia = hojeLocal(), em = agora(), ins = db.prepare("INSERT OR IGNORE INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,?,?,?,?,'chaveiro',?)")
  for (const [c, para] of Object.entries(ordem.payload.esperado || {})) {
    const campo = CAMPO_LOG[c]; if (!campo) continue
    const de = ordem.payload.antes?.[c], txt = v => (v == null ? null : typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v).slice(0, 300))
    const pct = c === 'preco' && typeof de === 'number' && typeof para === 'number' && de > 0 ? Math.round((10000 * (para - de)) / de) / 100 : null
    try { ins.run(ordem.cliente, ordem.item_id, dia, campo, c === 'descricao' ? null : txt(de), c === 'descricao' ? null : txt(lido[c] ?? para), pct, em) } catch { /* o marco nunca derruba a conferência */ }
  }
  if (ordem.payload.decisao_cliente) try { db.prepare("INSERT INTO preco_decisao (cliente, ref, decisor, por, em) VALUES (?,?,'cliente',?,?) ON CONFLICT (cliente, ref) DO UPDATE SET decisor = 'cliente', por = excluded.por, em = excluded.em").run(ordem.cliente, `ml:${ordem.item_id}:${dia}`, ordem.payload.decisao_cliente.por, em) } catch { /* Smith: tabela ausente não derruba */ }
}

// CONFERIR (só leitura): ordens em conferência vencidas. ml_item → releitura dos campos tocados; duplicar → o anúncio novo; promoção → o plano (sync de Promoções). Nunca reenvia.
export async function conferirOrdens({ cliente = null, api = null, promo = null, agoraISO = agora(), forcar = false } = {}) {
  const ordens = db.prepare(`SELECT * FROM exec_ordem WHERE estado = 'em_conferencia' AND ${DO_EXECUTOR}${cliente ? ' AND cliente = ?' : ''}${forcar ? '' : ' AND conferir_em <= ?'}`).all(...[cliente, forcar ? null : agoraISO].filter(x => x != null))
  const resultados = []
  for (const r of ordens) {
    const o = { ...r, payload: parse(r.payload_json, {}), resultado: parse(r.resultado_json, {}) }, op = o.payload.operacao, n = (o.conferencias || 0) + 1
    let veredito = 'aguardando', det = {}
    try {
      if (op === 'promocao') {
        promo ||= await promoPadrao()
        let s = null; try { s = await promo.sincronizarPosExecucao(o.cliente, o.payload.params.plano_id) } catch { s = null }   // 409 = ainda na janela de propagação
        if (s) { det = { sync: s }; veredito = s.entrou > 0 ? 'confere' : s.suspeito ? 'aguardando' : s.nao_provado > 0 ? 'divergente' : 'aguardando' }
      } else {
        api ||= await apiPadrao()
        if (op === 'duplicar') {
          const novo = o.resultado.anuncio_novo
          const it = novo ? await lerVivo(api, o.cliente, novo) : null
          det = { anuncio_novo: novo || null, status: it?.status || null }
          veredito = it && ['active', 'paused'].includes(it.status) && String(it.title || '').replace(/\s+/g, ' ').trim() === o.payload.esperado.duplicata.titulo ? 'confere' : it && it.status === 'closed' ? 'divergente' : 'aguardando'
        } else if (op === 'ads') {                                                                              // assistido: a prova é a coleta de Ads (status do anúncio na campanha); orçamento/ACOS não se confere por anúncio
          const a = db.prepare("SELECT status FROM meli_ads_item WHERE cliente = ? AND item_id = ? AND periodo = 'atual'").get(o.cliente, o.item_id)
          const quer = { ativar: 'active', pausar: 'paused' }[o.payload.params?.acao]
          det = { ads_status: a?.status ?? null }; veredito = quer && a?.status === quer ? 'confere' : 'aguardando'
        } else {
          const it = await lerVivo(api, o.cliente, o.item_id, { descricao: 'descricao' in (o.payload.esperado || {}) })
          if (it) { const lido = X.tocado(it, Object.keys(o.payload.esperado || {}), o.payload.ids || {}); det = { lido }; veredito = X.conferir(o.payload.esperado, lido, o.payload.antes) }
        }
      }
    } catch { veredito = 'aguardando' }
    const extra = { conferencias: n, conferido_em: agora(), resultado_json: JSON.stringify({ ...o.resultado, conferencia: det }) }
    if (veredito === 'confere') {
      transicionar(o, 'executada', 'sistema', { conferencia: det }, extra)
      if (!['promocao', 'duplicar'].includes(op)) gravarMarco(o, det.lido || {})
      if (o.payload.reverte) marcarRevertida(o)
      if (!['promocao', 'duplicar'].includes(op)) try { const { capturarSnapshot } = await import('./anuncio-historico.js'); await capturarSnapshot(o.cliente, o.item_id, { origem: 'chaveiro', api: { lerItem: (c, id) => api.get(c, `/items/${id}?include_attributes=all`).then(x => (x.status === 200 ? x.corpo : { _erro: true, status: x.status })), lerDescricao: (c, id) => api.get(c, `/items/${id}/description`).then(x => (x.status === 200 ? x.corpo : { _erro: true })) } }) } catch { /* fotografia é melhor esforço */ }
      lg('info', `ordem ${o.id} de ${o.cliente} conferida (${op} em ${o.item_id}): o Merovíngio mede a partir de hoje`)
      avisar(`Chaveiro: ${X.OPERACOES[op]?.rotulo || op} aplicado e conferido em ${o.item_id}`, X.medicaoDe(op, o.payload.estrategia?.janela_dias), o.cliente)
    } else if (veredito === 'divergente') {
      transicionar(o, 'divergente', 'sistema', { conferencia: det }, { ...extra, erro: 'depois do envio o anúncio mostra outra coisa: conferir no painel' })
      avisar(`Chaveiro: divergência depois do envio em ${o.item_id}`, 'o anúncio mostra outra coisa que não o enviado: conferir no painel antes de qualquer nova ordem', o.cliente, 'alerta')
    } else if (n >= E().conferencias_max) {
      transicionar(o, 'falhou', 'sistema', { conferencia: det }, { ...extra, erro: X.MOTIVOS.nao_confirmou })
      avisar(`Chaveiro: o Mercado Livre não confirmou em ${o.item_id}`, X.MOTIVOS.nao_confirmou, o.cliente, 'alerta')
    } else {
      db.prepare('UPDATE exec_ordem SET conferencias = ?, conferido_em = ?, conferir_em = ?, resultado_json = ?, atualizado_em = ? WHERE id = ? AND cliente = ?').run(n, extra.conferido_em, new Date(Date.now() + (op === 'ads' ? 24 * 60 : E().conferir_intervalo_min) * 60_000).toISOString(), extra.resultado_json, agora(), o.id, o.cliente)
      evento(o.id, o.cliente, 'em_conferencia', 'em_conferencia', 'sistema', { tentativa: n })
    }
    resultados.push({ ordem: o.id, cliente: o.cliente, veredito, tentativa: n })
  }
  return { conferidas: resultados.length, resultados }
}
function marcarRevertida(rev) {
  const orig = lerOrdem(rev.cliente, rev.payload.reverte); if (!orig) return
  db.prepare('UPDATE exec_ordem SET resultado_json = ?, atualizado_em = ? WHERE id = ? AND cliente = ?').run(JSON.stringify({ ...orig.resultado, revertida_por: rev.id, revertida_em: agora() }), agora(), orig.id, orig.cliente)
  evento(orig.id, orig.cliente, 'executada', 'revertida', 'sistema', { por_ordem: rev.id })
}

// REVERTER: só ordem conferida, reversível, do próprio Chaveiro → ordem nova (aprovada pelo líder neste ato) que volta ao «antes» lido ao vivo na preparação; executa com as MESMAS travas
export async function reverter(cliente, ordem_id, { por = '', confirmar, api = null, ...deps } = {}) {
  const quem = validarLider(str(por), cliente); if (!quem) throw erro('somente o líder do cliente reverte ordens do Chaveiro', 403)
  const o = lerOrdem(cliente, str(ordem_id)); if (!o) throw erro('ordem não encontrada neste cliente', 404)
  if (o.estado !== 'executada' || o.resultado?.revertida_por || o.payload.reverte) throw erro('só ordem conferida e ainda não revertida pode ser revertida', 409)
  if (!X.OPERACOES[o.payload.operacao]?.reversivel) throw erro('esta operação não tem reversão automática (duplicata: pausar por uma ordem de status; promoção: nunca sai de campanha pelo sistema)', 409)
  api ||= await apiPadrao()
  const vivo = await lerVivo(api, cliente, o.item_id, { descricao: 'descricao' in (o.payload.antes || {}) }); if (!vivo) throw erro(X.MOTIVOS.leitura, 502)
  const pl = X.planejarReversao(o, vivo, contexto(cliente, vivo, o.payload.operacao, {}))
  if (pl.bloqueios?.length) throw erro(pl.bloqueios[0], 409)
  const previa = { ordem: o.id, diff: pl.diff, grupos: pl.grupos.map(g => ({ grupo: g.grupo, metodo: g.metodo, caminho: g.caminho })) }
  if (confirmar !== true) return { previa: true, ...previa }
  const payload = { executor: 'f4', operacao: o.payload.operacao, params: o.payload.params, grupos: pl.grupos, antes: pl.antes, esperado: pl.esperado, ids: pl.ids || o.payload.ids || {}, reverte: o.id, execucao: o.payload.execucao, lido_em: agora(), previa_em: agora() }
  const hash = X.hashOrdem(payload), chave = `${cliente}|f4|reverter|${o.id}|${hash}`, id = X.idOrdem(chave), em = agora()
  db.prepare(`INSERT INTO exec_ordem (id, cliente, acao_id, regra, item_id, produto, caminho, adaptador, operacao, payload_json, snapshot_antes_json, hash, chave_idem, estado, aprovado_por, aprovado_em, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,'','automatico',?,?,?,?,?,?,'aprovada',?,?,?,?) ON CONFLICT(chave_idem) DO NOTHING`).run(id, cliente, o.acao_id, `reverter:${o.id}`, o.item_id, o.adaptador, o.payload.operacao, JSON.stringify(payload), JSON.stringify({ item_id: o.item_id, antes: pl.antes }), hash, chave, quem, em, em, em)
  evento(id, cliente, '', 'aprovada', quem, { reverte: o.id, diff: pl.diff.slice(0, 10) })
  const r = await executarOrdem(cliente, id, { por: quem, confirmar, api, ...deps })
  return { previa: false, ordem_reversao: id, ...previa, execucao: r }
}

// lote: 1 por vez, na ordem dos passos; para no 1º que não sai (estratégia: o resto fica aprovado, nada mais é enviado); teto por lote
export async function executarLote(cliente, { ordens = [], por = '', confirmar, ...deps } = {}) {
  const ids = [...new Set((Array.isArray(ordens) ? ordens : []).map(str))].filter(i => /^CH-[0-9a-f]{10}$/.test(i)).slice(0, E().teto_ordens_por_lote)
  const lidas = ids.map(i => lerOrdem(cliente, i)).filter(Boolean).sort((a, b) => (a.payload.execucao || '').localeCompare(b.payload.execucao || '') || a.item_id.localeCompare(b.item_id) || (a.payload.estrategia?.passo || 1) - (b.payload.estrategia?.passo || 1))
  const out = []
  for (const o of lidas) {
    const r = await executarOrdem(cliente, o.id, { por, confirmar, ...deps })
    out.push({ ordem: o.id, item_id: o.item_id, operacao: o.payload.operacao, ...r })
    if (!r.executado || r.parou) { out.push({ parada: true, motivo: 'execução parou nesta ordem: as seguintes ficam como estão (nada mais foi enviado)' }); break }
  }
  return { cliente, executadas: out.filter(x => x.executado).length, resultado: out }
}

// assistido (Ads): o humano aplicou no painel → registro (a coleta de Ads do dia seguinte é a prova; nada é escrito pelo sistema)
export function marcarFeito(cliente, ordem_id, { por = '' } = {}) {
  const quem = validarLider(str(por), cliente); if (!quem) throw erro('somente o líder do cliente marca uma ordem assistida como feita', 403)
  const o = lerOrdem(cliente, str(ordem_id)); if (!o || o.caminho !== 'assistido') throw erro('ordem assistida não encontrada neste cliente', 404)
  if (o.estado !== 'aprovada') throw erro('a ordem assistida precisa estar aprovada', 409)
  transicionar(o, 'executando', quem, { assistido: true }); transicionar(o, 'em_conferencia', quem, { assistido: true, nota: 'aplicado no painel pelo humano; a coleta de Ads confere' }, { executado_em: agora(), conferir_em: new Date(Date.now() + 86_400_000).toISOString() })
  return { ok: true, ordem: o.id, estado: 'em_conferencia' }
}

// ── LIBERAÇÃO por cliente × operação (líder + cliente informado), estreia em 1 anúncio; revogar; veto ao Neo; kill switch ──
export function liberar(cliente, { operacao = '', por = '', cliente_informado = false, estreia_item = '', confirmar = false } = {}) {
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  const op = str(operacao); if (!X.OPS_EXECUTAVEIS.includes(op)) throw erro('operação sem escrita pelo sistema (assistida ou fluxo próprio)')
  const lider = validarLider(str(por), cliente); if (!lider) throw erro('somente o líder do cliente libera uma operação do Chaveiro', 403)
  if (cliente_informado !== true) throw erro('informe que o cliente foi avisado (cliente_informado: true): «passamos a aplicar esta mudança pelo sistema, com aprovação e conferência»')
  const item = str(estreia_item); if (!MLB.test(item) || !db.prepare('SELECT 1 FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, item)) throw erro('informe o anúncio da estreia (MLB deste cliente)', 404)
  const atual = liberacaoDe(cliente, op), r = { ok: true, cliente, operacao: op, estreia_item: item, liberado_por: lider, ja_liberado: !!(atual && atual.liberado_por && !atual.revogado_em) }
  if (confirmar !== true) return { ...r, previa: true }
  const em = agora()
  db.prepare(`INSERT INTO exec_liberacao (cliente, operacao, estreia_item, liberado_por, liberado_em, cliente_informado_por, cliente_informado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(cliente, operacao) DO UPDATE SET estreia_item = excluded.estreia_item, liberado_por = excluded.liberado_por, liberado_em = excluded.liberado_em, cliente_informado_por = excluded.cliente_informado_por,
    cliente_informado_em = excluded.cliente_informado_em, revogado_por = '', revogado_em = '', atualizado_em = excluded.atualizado_em`).run(cliente, op, item, lider, em, lider, em, em)
  evento('liberacao', cliente, atual?.liberado_por && !atual.revogado_em ? 'liberada' : 'fechada', 'liberada', lider, { operacao: op, estreia_item: item })
  lg('info', `operação ${op} LIBERADA para ${cliente} por ${lider} (estreia em ${item})`)
  return { ...r, previa: false }
}
export function revogar(cliente, { operacao = '', por = '', confirmar = false } = {}) {
  const op = str(operacao), lider = validarLider(str(por), cliente); if (!lider) throw erro('somente o líder do cliente revoga uma operação do Chaveiro', 403)
  if (!X.OPS_EXECUTAVEIS.includes(op)) throw erro('operação fora da lista')
  if (confirmar !== true) return { ok: true, previa: true, cliente, operacao: op }
  db.prepare("UPDATE exec_liberacao SET revogado_por = ?, revogado_em = ?, atualizado_em = ? WHERE cliente = ? AND operacao = ?").run(lider, agora(), agora(), cliente, op)
  let n = 0; for (const o of db.prepare(`SELECT id FROM exec_ordem WHERE cliente = ? AND operacao = ? AND estado IN ('preparada','aguardando_aprovacao','aprovada') AND ${DO_EXECUTOR}`).all(cliente, op)) { try { transicionar(lerOrdem(cliente, o.id), 'cancelada', lider, { motivo: 'operação revogada no cliente' }); n++ } catch { /* mudou no meio */ } }
  evento('liberacao', cliente, 'liberada', 'revogada', lider, { operacao: op, canceladas: n })
  lg('aviso', `operação ${op} REVOGADA para ${cliente} por ${lider}`)
  return { ok: true, previa: false, cliente, operacao: op, canceladas: n }
}
// Neo (D-C1): com 10 ordens conferidas e nenhuma divergência, propõe ampliar além do anúncio da estreia; vale depois de 48 h sem veto do líder
export function neoAvaliar(cliente, { agoraISO = agora() } = {}) {
  const propostas = []
  for (const lib of db.prepare('SELECT * FROM exec_liberacao WHERE cliente = ?').all(cliente)) {
    const c = contagem(cliente, lib.operacao)
    if (!X.neoPropoe({ lib, conferidas: c.conferidas || 0, divergencias: c.divergencias || 0 })) continue
    const ate = new Date(Date.parse(agoraISO) + E().veto_horas * 3_600_000).toISOString()
    db.prepare("UPDATE exec_liberacao SET ampliacao_proposta_em = ?, veto_ate = ?, atualizado_em = ? WHERE cliente = ? AND operacao = ? AND ampliacao_proposta_em = ''").run(agoraISO, ate, agoraISO, cliente, lib.operacao)
    evento('liberacao', cliente, 'estreia', 'ampliacao_proposta', 'Neo', { operacao: lib.operacao, conferidas: c.conferidas, veto_ate: ate })
    avisar(`Neo: propõe ampliar ${X.OPERACOES[lib.operacao].rotulo} além da estreia`, `${c.conferidas} ordens conferidas sem divergência. Sem veto do líder até ${ate.slice(0, 16).replace('T', ' ')}Z, a operação passa a valer para todos os anúncios deste cliente (teto ${E().teto_dia_ampliado}/dia).`, cliente, 'alerta', 'neo')
    propostas.push(lib.operacao)
  }
  return propostas
}
export function vetar(cliente, { operacao = '', por = '', confirmar = false } = {}) {
  const lider = validarLider(str(por), cliente); if (!lider) throw erro('somente o líder do cliente veta a ampliação', 403)
  const lib = liberacaoDe(cliente, str(operacao)); if (!lib?.ampliacao_proposta_em) throw erro('não há proposta de ampliação para esta operação', 404)
  if (confirmar !== true) return { ok: true, previa: true }
  db.prepare('UPDATE exec_liberacao SET vetado_por = ?, vetado_em = ?, atualizado_em = ? WHERE cliente = ? AND operacao = ?').run(lider, agora(), agora(), cliente, lib.operacao)
  evento('liberacao', cliente, 'ampliacao_proposta', 'vetada', lider, { operacao: lib.operacao })
  return { ok: true, previa: false }
}
// KILL SWITCH: para o executor F4+ E o sincronismo de estoque (F6) na hora; cancela o que estava na fila (aguardando/aprovada). O que já está em conferência só é lido.
export function pararTudo({ por = '', confirmar = false } = {}) {
  const quem = validarLider(str(por)); if (!quem) throw erro('somente um líder para o Chaveiro', 403)
  if (confirmar !== true) return { ok: true, previa: true, parado: parado() }
  setEstado(CHAVE_PARADO, '1'); setEstado('chaveiro_estoque_parado', '1')
  let n = 0; for (const o of db.prepare(`SELECT id, cliente FROM exec_ordem WHERE estado IN ('preparada','aguardando_aprovacao','aprovada') AND ${DO_EXECUTOR}`).all()) { try { transicionar(lerOrdem(o.cliente, o.id), 'cancelada', quem, { motivo: X.MOTIVOS.parado }); n++ } catch { /* */ } }
  lg('aviso', `Chaveiro PARADO por ${quem} (${n} ordem(ns) cancelada(s); sincronismo de estoque parado também)`)
  avisar('Chaveiro parado (botão de emergência)', `por ${quem}`, '', 'alerta')
  return { ok: true, previa: false, parado: true, canceladas: n }
}
export function retomar({ por = '', confirmar = false } = {}) {
  const quem = validarLider(str(por)); if (!quem) throw erro('somente um líder retoma o Chaveiro', 403)
  if (confirmar !== true) return { ok: true, previa: true, parado: parado() }
  setEstado(CHAVE_PARADO, '0'); lg('info', `Chaveiro (execução F4+) retomado por ${quem}; o sincronismo de estoque retoma pelo botão dele`)
  return { ok: true, previa: false, parado: false }
}

// estratégia própria (tela): mesma validação; líder grava
export function salvarEstrategia(def, { por = '', confirmar = false } = {}) {
  const v = X.validarEstrategia(def); if (!v.ok) throw erro(v.erros.join('; '))
  if (confirmar !== true) return { ok: true, previa: true, estrategia: v.estrategia }
  const quem = validarLider(str(por)); if (!quem) throw erro('somente um líder cria estratégias', 403)
  const id = 'propria_' + X.idOrdem(`${v.estrategia.nome}|${agora()}`).slice(3)
  db.prepare('INSERT INTO exec_estrategia (id, nome, definicao_json, por, em) VALUES (?,?,?,?,?)').run(id, v.estrategia.nome, JSON.stringify({ ...v.estrategia, id }), quem, agora())
  return { ok: true, previa: false, id, estrategia: v.estrategia }
}
export function desativarEstrategia(id, { por = '' } = {}) {
  const quem = validarLider(str(por)); if (!quem) throw erro('somente um líder desativa estratégias', 403)
  return { ok: db.prepare('UPDATE exec_estrategia SET ativa = 0 WHERE id = ?').run(str(id)).changes > 0 }
}

// ── PAINEL do console: chave, kill switch, operações (live global, liberação, estreia, contagem, Neo), estratégias, ordens e eventos ──
export function painel(cliente, { agoraISO = agora(), hoje = hojeLocal() } = {}) {
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  try { neoAvaliar(cliente, { agoraISO }) } catch { /* proposta é melhor esforço */ }
  const ops = Object.entries(X.OPERACOES).map(([k, d]) => {
    const lib = liberacaoDe(cliente, k), c = X.OPS_EXECUTAVEIS.includes(k) ? contagem(cliente, k) : { conferidas: 0, divergencias: 0 }, amp = X.ampliado(lib, agoraISO)
    return { operacao: k, rotulo: d.rotulo, escrita: d.escrita, doc: d.doc, reversivel: d.reversivel, params: d.params, live_global: X.CFG.adaptadores_live?.[k] === true,
      liberacao: lib ? { liberado_por: lib.liberado_por, liberado_em: lib.liberado_em, estreia_item: lib.estreia_item, cliente_informado_em: lib.cliente_informado_em, revogado_em: lib.revogado_em, ampliacao_proposta_em: lib.ampliacao_proposta_em, veto_ate: lib.veto_ate, vetado_em: lib.vetado_em } : null,
      ampliado: amp, conferidas: c.conferidas || 0, divergencias: c.divergencias || 0, para_ampliar: E().ordens_para_ampliar, teto_dia: amp ? E().teto_dia_ampliado : E().teto_dia_estreia, executadas_hoje: X.OPS_EXECUTAVEIS.includes(k) ? executadasHoje(cliente, k, hoje) : 0 }
  })
  const ordens = db.prepare(`SELECT * FROM exec_ordem WHERE cliente = ? AND ${DO_EXECUTOR} ORDER BY criado_em DESC LIMIT 60`).all(cliente).map(r => { const p = parse(r.payload_json, {}), res = parse(r.resultado_json, {})
    return { id: r.id, item_id: r.item_id, operacao: r.operacao, rotulo: X.OPERACOES[r.operacao]?.rotulo || r.operacao, caminho: r.caminho, estado: r.estado, estado_exibido: X.estadoExibido({ estado: r.estado, resultado: res }), estrategia: p.estrategia, reverte: p.reverte || '',
      reversivel: X.OPERACOES[r.operacao]?.reversivel && r.estado === 'executada' && !res.revertida_por && !p.reverte, criado_em: r.criado_em, aprovado_por: r.aprovado_por, executado_em: r.executado_em, conferido_em: r.conferido_em, erro: r.erro,
      diff: (p.grupos || []).length ? Object.keys(p.esperado || {}).map(c => ({ campo: c, de: p.antes?.[c] ?? null, para: p.esperado[c] })) : [], passo_a_passo: p.passo_a_passo || [] } })
  const eventos = db.prepare("SELECT ordem_id, de, para, por, detalhe_json, em FROM exec_evento WHERE cliente = ? AND (ordem_id IN (SELECT id FROM exec_ordem WHERE cliente = ? AND json_extract(payload_json, '$.executor') = 'f4') OR ordem_id = 'liberacao') ORDER BY id DESC LIMIT 60").all(cliente, cliente).map(e => ({ ...e, detalhe: parse(e.detalhe_json, {}), detalhe_json: undefined }))
  return { cliente, ligado: X.CFG.execucao_ligada === true, parado: parado(), limites: { teto_ordens_por_lote: E().teto_ordens_por_lote, teto_dia_estreia: E().teto_dia_estreia, teto_dia_ampliado: E().teto_dia_ampliado, preco_max_var_pct: X.CFG.preco_max_var_pct_padrao, veto_horas: E().veto_horas },
    operacoes: ops, estrategias: listarEstrategias(), ordens, eventos }
}
// anúncios do cliente para o seletor (cache; receita 28 d primeiro)
export function anuncios(cliente, { q = '', hoje = hojeLocal() } = {}) {
  if (ehProspecto(cliente)) throw erro(X.MOTIVOS.prospect)
  const de = new Date(Date.parse(hoje + 'T12:00:00Z') - 28 * 86_400_000).toISOString().slice(0, 10), busca = str(q).toLowerCase().slice(0, 60)
  const l = db.prepare(`SELECT i.item_id, i.titulo, i.preco, i.status, i.catalogo, i.frete_gratis, COALESCE(SUM(s.receita), 0) r28, COALESCE(SUM(s.unidades), 0) u28 FROM meli_item i LEFT JOIN meli_serie_item s ON s.cliente = i.cliente AND s.item_id = i.item_id AND s.dia >= ?
    WHERE i.cliente = ? AND i.status IN ('active','paused') GROUP BY i.item_id ORDER BY r28 DESC, i.item_id LIMIT 400`).all(de, cliente)
  return { cliente, anuncios: l.filter(a => !busca || a.item_id.toLowerCase().includes(busca) || String(a.titulo).toLowerCase().includes(busca)).slice(0, 60).map(a => ({ ...a, r28: Math.round(a.r28 * 100) / 100,
    fotos: (snapshotDeLinha(ultimaFoto(cliente, a.item_id) || { fotos_json: '[]' }).fotos || []).slice(0, 12), snapshots: db.prepare('SELECT hash, capturado_em, origem, titulo, preco FROM meli_item_snapshot WHERE cliente = ? AND item_id = ? ORDER BY capturado_em DESC LIMIT 8').all(cliente, a.item_id) })) }
}
// Merovíngio: a medida do marco de uma ordem conferida (antes × depois com controle e placebo, a mesma das tarefas)
export async function marco(cliente, ordem_id, { hoje = hojeLocal() } = {}) {
  const o = lerOrdem(cliente, str(ordem_id)); if (!o) throw erro('ordem não encontrada neste cliente', 404)
  if (o.estado !== 'executada') return { ordem: o.id, estado: 'sem_marco', motivo: 'a ordem ainda não foi conferida' }
  const { medirMarco } = await import('./impacto-tarefas.js')
  const dia = String(o.conferido_em).slice(0, 10)
  const m = await medirMarco(cliente, o.item_id, dia, { hoje, tipo: X.OPERACOES[o.payload.operacao]?.rotulo || o.payload.operacao })
  return { ordem: o.id, item_id: o.item_id, dia, operacao: o.payload.operacao, medida: m ? { estado: m.estado, efeito_pct: m.efeito_pct ?? null, efeito_bruto_pct: m.efeito_bruto_pct ?? null, metrica: m.metrica_primaria ?? null, confianca: m.confianca ?? null, motivo: m.motivo ?? null } : null,
    rotulo: 'associação temporal ajustada pelo controle, não prova de causa' }
}
// preset do console a partir de uma ação do plano com caminho automático (botão «Executar pelo Chaveiro»)
const OP_DO_PLANO = { 'ml_item:preco': 'preco', 'ml_item:frete_gratis': 'frete_gratis', 'ml_item:status_ativar': 'status', 'promocoes:plano': 'promocao', 'ml_estoque:alocar': 'estoque' }
const OP_DO_ESCOPO = { titulo_descricao: 'titulo', galeria: 'fotos', ficha: 'atributos', preco: 'preco' }       // oferta_completa/cadastro seguem por Ofertas (conteúdo gerado + aprovação campo a campo)
export function presetDaAcao(cliente, acao_id) {
  const a = db.prepare('SELECT id, regra, item_id, dados_json FROM acoes_plano WHERE cliente = ? AND id = ?').get(cliente, str(acao_id)); if (!a) throw erro('ação do plano não encontrada neste cliente', 404)
  const regra = String(a.regra).replace(/^anuncio_/, ''), ex = parse(a.dados_json, {}).execucao || {}
  const operacao = regra === 'duplicacao_estrategica' ? 'duplicar' : ex.adaptador === 'ofertas' ? OP_DO_ESCOPO[X.CFG.caminho_por_regra[regra]?.escopo] || '' : OP_DO_PLANO[`${ex.adaptador}:${ex.operacao}`] || ''
  return { acao_id: a.id, regra: a.regra, item_id: a.item_id || '', caminho: ex.caminho || 'sem_caminho', operacao, params: operacao === 'status' ? { acao: 'ativar' } : operacao === 'frete_gratis' ? { ativar: true } : {},
    nota: operacao ? '' : 'ação sem operação equivalente no console: siga pelo caminho dela (Ofertas, Notion ou pendência)' }
}

// TICK (10 min): só com a chave global ligada e o kill switch solto. Confere as ordens vencidas (só leitura) e avalia o Neo. Nunca executa sozinho (ordem sempre aprovada e executada pelo líder).
export async function tickExecutor({ api = null, promo = null } = {}) {
  if (X.CFG.execucao_ligada !== true) return { ligado: false }
  const conf = await conferirOrdens({ api, promo })
  for (const { cliente } of db.prepare('SELECT DISTINCT cliente FROM exec_liberacao').all()) try { neoAvaliar(cliente) } catch { /* */ }
  return { ligado: true, conferidas: conf.conferidas }
}
