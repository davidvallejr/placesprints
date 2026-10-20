// Chaveiro · sincronismo de estoque com banco e API (V3 F6 — docs/desenho-v3-erp.md § A). O núcleo PURO está em chaveiro-estoque.js; aqui só leitura do banco,
// ordens/eventos (exec_ordem/exec_evento), política por cliente (exec_politica), regras (produto_regra_estoque) e o adaptador da API (injetável: os testes usam stub).
// ESCRITA NO MERCADO LIVRE só em executarOrdem, e só depois de TODAS as travas: chave global sync_estoque_ligado + kill switch solto + cliente liberado (líder + cliente
// informado + adaptador ml_estoque) + produto da estreia + teto do dia + confirmar === true + hash íntegro + físico ≤ 24 h + releitura ao vivo (x-version) coerente com a prévia.
// Conferência depois em TODOS os irmãos; nunca reverte ao snapshot; nunca reenvia às cegas. Logs e avisos internos assinados pelo Chaveiro.
import { db, agora, hojeLocal, getEstado, setEstado, log } from './db.js'
import { voz } from './sistemas.js'
import { notificar } from './notificacoes.js'
import { carregarClientes, normNome, ehDono } from './equipe.js'
import { alinhamentosReal } from './alinhamentos-real.js'
import { chaveSku } from './produto-estoque.js'
import { ritmoPrevisto } from './compras-previsao.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import * as CE from './chaveiro-estoque.js'

const ALG = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8'))
const S = CE.SYNC
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => (typeof v === 'string' ? v.trim() : '')
const parse = (t, d) => { try { return JSON.parse(t) } catch { return d } }
const diaMenos = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const lg = (nivel, msg) => { try { log(nivel, voz('chaveiro', msg)) } catch { /* log nunca derruba a execução */ } }
const CHAVE_PARADO = 'chaveiro_estoque_parado'
export const parado = () => getEstado(CHAVE_PARADO) === '1'
export const syncLigado = (cfg = CE.CFG) => cfg.sync_estoque_ligado === true && !parado()

// líder do cliente (liberação, execução, kill switch): líder da central daquele cliente, ou prestador com cargo de liderança. Restrição de produto (não há login).
const RX_LIDER = /l[ií]der|coordena|gerente|diretor|ceo/i
export function validarLider(nome, cliente = '') {
  const n = normNome(nome); if (!n) return ''
  const dono = ehDono(nome); if (dono) return dono                         // o dono libera, aprova e executa em qualquer cliente
  const c = cliente ? carregarClientes().find(x => normNome(x.cliente) === normNome(cliente)) : null
  const daCentral = c ? Object.values(c.lideres || {}) : carregarClientes().flatMap(x => Object.values(x.lideres || {}))
  const hit = daCentral.find(x => normNome(x) === n); if (hit) return hit
  try { const p = db.prepare('SELECT nome, cargo FROM prestadores').all().find(x => normNome(x.nome) === n && RX_LIDER.test(x.cargo || '')); return p ? p.nome : '' } catch { return '' }
}

// ── política por cliente ──
export function politicaDe(cliente) {
  const r = db.prepare('SELECT * FROM exec_politica WHERE cliente = ?').get(cliente)
  return r ? { ...r, adaptadores: parse(r.adaptadores_live_json, {}), produtos: parse(r.produtos_json, []) } : null
}
const executadasSemDivergencia = cliente => db.prepare("SELECT COUNT(*) n FROM exec_ordem WHERE cliente = ? AND adaptador = 'ml_estoque' AND estado = 'executada'").get(cliente).n
const teveDivergencia = cliente => db.prepare("SELECT COUNT(*) n FROM exec_ordem WHERE cliente = ? AND adaptador = 'ml_estoque' AND estado IN ('divergente','falhou')").get(cliente).n > 0

// ── leitura do banco (isolamento por cliente em TODA consulta) ──
function dados(cliente, { hoje = hojeLocal() } = {}) {
  const arestas = db.prepare(`SELECT u.item_id, u.variacao_id, u.user_product_id, u.inventory_id, u.sku, u.sku_fonte, u.estoque, u.logistica, u.flex, u.tags,
      COALESCE(NULLIF(i.status, ''), u.status) status, u.lido_em, i.titulo, i.permalink FROM meli_anuncio_up u LEFT JOIN meli_item i ON i.cliente = u.cliente AND i.item_id = u.item_id WHERE u.cliente = ?`).all(cliente)
  const vinculos = db.prepare('SELECT origem, produto, tipo FROM produto_vinculo WHERE cliente = ?').all(cliente)
  const upEstoque = db.prepare('SELECT user_product_id, local, quantidade, lojas, lido_em FROM meli_up_estoque WHERE cliente = ?').all(cliente)
  const declarados = db.prepare('SELECT sku, quantidade, fonte, em FROM produto_estoque_declarado WHERE cliente = ? ORDER BY sku').all(cliente)
  const regras = db.prepare('SELECT produto, dias_protecao, maximo_por_anuncio, nao_escrever FROM produto_regra_estoque WHERE cliente = ?').all(cliente)
  const linhas = db.prepare("SELECT item_id, variacao_id, dia, quantidade, status FROM meli_pedido_item WHERE cliente = ? AND dia >= ?").all(cliente, diaMenos(hoje, 35))
  const serie = new Map(db.prepare('SELECT item_id, SUM(unidades) u, SUM(CASE WHEN dia >= ? THEN unidades ELSE 0 END) u14, SUM(receita) r FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ? GROUP BY item_id')
    .all(diaMenos(hoje, 14), cliente, diaMenos(hoje, 28), diaMenos(hoje, 1)).map(r => [r.item_id, r]))
  return { arestas, vinculos, upEstoque, declarados, regras, linhas, serie }
}
const regraDe = (regras, sku) => { const r = regras.find(x => x.produto === sku) || regras.find(x => x.produto === '*') || {}; return { dias_protecao: r.dias_protecao ?? null, maximo_por_anuncio: r.maximo_por_anuncio ?? null, nao_escrever: r.nao_escrever === 1 } }

// venda de um pool em 28 d: variação = linhas de pedido da variação (sem linhas, a venda do anúncio ÷ nº de variações dele — premissa); anúncio = a série (soma os irmãos: catálogo + clássico)
function vendaDoPool(pool, { linhas, serie, arestas, hoje }) {
  const de = diaMenos(hoje, 28), de14 = diaMenos(hoje, 14), out = { u: 0, u14: 0, r: 0 }
  for (const it of pool.itens) {
    if (it.variacao_id) {
      const l = linhas.filter(x => x.item_id === it.item_id && x.variacao_id === it.variacao_id && x.status === 'paid' && x.dia >= de && x.dia < hoje)
      if (l.length) { out.u += l.reduce((t, x) => t + x.quantidade, 0); out.u14 += l.filter(x => x.dia >= de14).reduce((t, x) => t + x.quantidade, 0) }
      else { const s = serie.get(it.item_id), nv = Math.max(1, arestas.filter(a => a.item_id === it.item_id && a.variacao_id).length); out.u += (s?.u || 0) / nv; out.u14 += (s?.u14 || 0) / nv }
      out.r += (serie.get(it.item_id)?.r || 0) / Math.max(1, arestas.filter(a => a.item_id === it.item_id && a.variacao_id).length)
    } else { const s = serie.get(it.item_id); out.u += s?.u || 0; out.u14 += s?.u14 || 0; out.r += s?.r || 0 }
  }
  return out
}

// ── PRÉVIA (só leitura do banco; nenhuma chamada ao ML): por produto com estoque físico informado, o que cada anúncio mostraria ──
// → { cliente, ligado, parado, politica, produtos[{ sku, fisico, pools[], plano, situacao, motivos[] }], linhas[{ sku, anuncio, variacao, titulo, de, para, escrita }], premissas[] }
export function previaSync(cliente, { hoje = hojeLocal(), agoraISO = agora(), cfg = CE.CFG } = {}) {
  if (ehProspecto(cliente)) throw erro(CE.MOTIVOS.prospect)
  const d = dados(cliente, { hoje }), pol = politicaDe(cliente), alinhado = alinhamentosReal().predicado(cliente, { hoje })
  const tituloDe = id => d.arestas.find(a => a.item_id === id)?.titulo || id
  const produtos = [], linhas = []
  for (const decl of d.declarados) {
    const sku = decl.sku, regra = regraDe(d.regras, sku)
    const { pools: todos, fora } = CE.poolsDoSku({ sku, arestas: d.arestas, vinculos: d.vinculos, upEstoque: d.upEstoque, hoje, validadeDias: ALG.produto?.leitura_stock_validade_dias ?? 2 })
    const alinhados = todos.filter(p => p.itens.some(i => alinhado({ item: i.item_id, regra: 'estoque_sincronizar' }).sim))
    const pools = todos.filter(p => !alinhados.includes(p))
    const fis = CE.fisicoAgora({ fonte: decl, linhas: d.linhas, pools, agoraISO, validadeHoras: S.validade_fisico_horas })
    const vend = pools.map(p => ({ p, ...vendaDoPool(p, { ...d, hoje }) }))
    const tot = vend.reduce((t, x) => ({ u: t.u + x.u, u14: t.u14 + x.u14 }), { u: 0, u14: 0 })
    const { vBase } = ritmoPrevisto({ u: tot.u, u14: tot.u14, estoque: fis.fisico }, ALG.compras)
    const seg = CE.segurancaUn(vBase, regra.dias_protecao ?? S.dias_protecao_padrao)
    const plano = CE.planejarSync({ fisico: fis.fisico, seguranca: seg, vBase, pools: vend.map(x => ({ chave: x.p.chave, v: x.u / 28, mostrado: x.p.mostrado })), regra })
    const motivos = [...(fis.fisico == null ? [CE.MOTIVOS.sem_fisico] : !fis.valido ? [CE.MOTIVOS.fisico_vencido] : []), ...(regra.nao_escrever ? [CE.MOTIVOS.nao_escrever] : []), ...(!pools.length ? [CE.MOTIVOS.sem_pool] : []),
      ...(fora.length ? [`${fora.length} estoque(s) no Full fora do sincronismo`] : []), ...(alinhados.length ? [CE.MOTIVOS.alinhado] : [])]
    const tol = Math.max(S.tolerancia_un, Math.ceil((fis.fisico || 0) * S.tolerancia_pct / 100))
    // divergente: o físico não vale mais para escrever (> 24 h, dentro da validade do diagnóstico) e, menos as vendas desde então, difere do ML além da tolerância
    const divergente = fis.fisico != null && !fis.valido && fis.idade_h <= 24 * (ALG.produto?.estoque_declarado_validade_dias ?? 7) && plano.soma_mostrada != null && Math.abs(plano.soma_mostrada - fis.fisico) > tol
    const situacao = regra.nao_escrever ? 'nao_escrever' : !pools.length ? 'sem_pool' : fis.fisico == null ? 'sem_fisico' : !fis.valido ? (divergente ? 'divergente' : 'fisico_vencido') : plano.escreve ? 'escreveria' : 'sem_mudanca'
    const rep = [...vend].sort((a, b) => b.r - a.r || a.p.chave.localeCompare(b.p.chave))[0]?.p.itens[0]?.item_id || ''
    produtos.push({ sku, representante: rep, fisico: fis, venda_prevista_dia: Math.round(vBase * 100) / 100, seguranca: seg, dias_protecao: regra.dias_protecao ?? S.dias_protecao_padrao, maximo_por_anuncio: regra.maximo_por_anuncio,
      pools: pools.map(p => ({ chave: p.chave, up: p.up, itens: p.itens, mostrado: p.mostrado, fonte: p.fonte, lojas: p.lojas, divergente: p.divergente, lido_em: p.lido_em })), fora, alinhados: alinhados.map(p => p.chave),
      plano, situacao, divergente, receita_28d: Math.round(vend.reduce((t, x) => t + x.r, 0) * 100) / 100, motivos })
    for (const pl of plano.pools || []) {
      const pool = pools.find(p => p.chave === pl.chave)
      pool.itens.forEach((it, k) => linhas.push({ sku, anuncio: it.item_id, variacao: it.variacao_id, titulo: tituloDe(it.item_id), de: it.estoque ?? pl.de, para: pl.para, pool: pl.chave,
        escrita: k === 0 ? 'escreve' : 'replica', situacao }))
    }
  }
  return { cliente, hoje, ligado: cfg.sync_estoque_ligado === true, parado: parado(), politica: pol ? { nivel: pol.nivel, ml_estoque: pol.adaptadores.ml_estoque === 1, produtos: pol.produtos, max_ordens_dia: pol.max_ordens_dia, liberado_por: pol.liberado_por, cliente_informado_em: pol.cliente_informado_em } : null,
    produtos, linhas: linhas.slice(0, 500),
    premissas: ['Fonte do estoque: o físico informado (cliente, equipe, ERP ou planilha), nunca o número do anúncio no Mercado Livre.', `Desconta as vendas pagas desde a informação (desde a véspera do dia informado — desconta a mais, nunca a menos); escreve só com a informação de até ${S.validade_fisico_horas} h.`,
      `Segurança = ${S.dias_protecao_padrao} dias × venda prevista (ajustável por cliente/produto); a segurança nunca zera o anúncio: 0 só com o físico zerado, depois do aviso «vai zerar em N dias».`,
      'Divisão entre os estoques próprios do produto pela venda de 28 dias (soma = alvo); catálogo e clássico no mesmo produto do ML recebem 1 escrita (o ML replica). Full e Flex independente ficam fora.',
      'Prévia: nada foi escrito. A escrita só acontece com a chave global ligada, o cliente liberado (líder + cliente informado), o produto na estreia e a releitura ao vivo coerente.'] }
}

// regras do plano (Arquiteto) sobre a MESMA prévia: o que sincronizar e o que pedir de contagem — um motor só
export function syncParaPlano(cliente, { hoje = hojeLocal() } = {}) {
  let p; try { p = previaSync(cliente, { hoje }) } catch { return { sincronizar: [], divergente: [], liberado: false } }
  const pol = p.politica
  return { liberado: !!(pol && pol.ml_estoque && pol.liberado_por && pol.cliente_informado_em && ['executar_com_aprovacao', 'executar_e_avisar'].includes(pol.nivel)),
    sincronizar: p.produtos.filter(x => x.situacao === 'escreveria'), divergente: p.produtos.filter(x => x.situacao === 'divergente') }
}

// ── ordens ──
const evento = (ordem_id, cliente, de, para, por, detalhe = {}) => db.prepare('INSERT INTO exec_evento (ordem_id, cliente, de, para, por, detalhe_json, em) VALUES (?,?,?,?,?,?,?)').run(ordem_id, cliente, de, para, String(por || 'sistema').slice(0, 80), JSON.stringify(detalhe).slice(0, 4000), agora())
function transicionar(ordem, para, por, detalhe = {}, extra = {}) {
  if (!CE.podeIr(ordem.estado, para)) throw erro(`transição inválida da ordem (${ordem.estado} → ${para})`, 409)
  const cols = Object.keys(extra).filter(k => ['aprovado_por', 'aprovado_em', 'executado_em', 'conferir_em', 'conferido_em', 'conferencias', 'resultado_json', 'erro', 'aviso_em'].includes(k))
  const r = db.prepare(`UPDATE exec_ordem SET estado = ?, atualizado_em = ?${cols.map(c => `, ${c} = ?`).join('')} WHERE id = ? AND cliente = ? AND estado = ?`).run(para, agora(), ...cols.map(c => extra[c]), ordem.id, ordem.cliente, ordem.estado)
  if (!r.changes) throw erro('a ordem mudou de estado no meio (outra execução?): nada foi feito', 409)
  evento(ordem.id, ordem.cliente, ordem.estado, para, por, detalhe)
  Object.assign(ordem, extra, { estado: para })
  return ordem
}
const lerOrdem = (cliente, id) => { const r = db.prepare('SELECT * FROM exec_ordem WHERE id = ? AND cliente = ?').get(id, cliente); return r ? { ...r, payload: parse(r.payload_json, {}), resultado: parse(r.resultado_json, {}) } : null }
export function ordensDoCliente(cliente, { limite = 50 } = {}) {
  const ordens = db.prepare("SELECT * FROM exec_ordem WHERE cliente = ? AND adaptador = 'ml_estoque' ORDER BY criado_em DESC LIMIT ?").all(cliente, limite).map(r => ({ id: r.id, produto: r.produto, estado: r.estado, criado_em: r.criado_em, executado_em: r.executado_em, conferido_em: r.conferido_em, erro: r.erro, aviso_em: r.aviso_em,
    pools: (parse(r.payload_json, {}).pools || []).map(p => ({ chave: p.chave, de: p.de, para: p.para, itens: p.itens.map(i => i.item_id) })), resultado: parse(r.resultado_json, {}) }))
  const eventos = db.prepare('SELECT ordem_id, de, para, por, detalhe_json, em FROM exec_evento WHERE cliente = ? ORDER BY id DESC LIMIT 100').all(cliente).map(e => ({ ...e, detalhe: parse(e.detalhe_json, {}), detalhe_json: undefined }))
  const pol = politicaDe(cliente)
  return { cliente, ligado: CE.CFG.sync_estoque_ligado === true, parado: parado(), politica: pol, ordens, eventos, executadas: executadasSemDivergencia(cliente) }
}

// PREPARAR: prévia por padrão; confirmar === true grava as ordens (aguardando aprovação) dos produtos que mudariam — nada vai ao ML aqui. Aviso «vai zerar» registrado.
export function prepararOrdens(cliente, { por = '', confirmar = false, hoje = hojeLocal(), agoraISO = agora(), validarPor = null } = {}) {
  const p = previaSync(cliente, { hoje, agoraISO })
  const prontos = p.produtos.filter(x => x.situacao === 'escreveria' && x.fisico.valido)
  const montar = x => { const payload = { sku: x.sku, fonte: { quantidade: x.fisico.informado, em: x.fisico.em, fonte: x.fisico.fonte }, fisico: x.fisico.fisico, seguranca: x.seguranca, venda_prevista_dia: x.venda_prevista_dia,
    maximo_por_anuncio: x.maximo_por_anuncio ?? null, alvo_total: x.plano.alvo_total, previa_em: agoraISO, pools: x.pools.map(pl => ({ chave: pl.chave, up: pl.up, itens: pl.itens.map(i => ({ item_id: i.item_id, variacao_id: i.variacao_id })), de: pl.mostrado, lido_em: pl.lido_em || x.fisico.em, para: x.plano.pools.find(q => q.chave === pl.chave)?.para ?? 0,
    })), aviso_zerar: x.plano.aviso_zerar }
    return payload }
  if (confirmar !== true) return { ...p, previa: true, ordens_a_preparar: prontos.map(x => x.sku) }
  const quem = validarPor ? validarPor(str(por), cliente) : validarLider(str(por), cliente)
  if (!quem) throw erro('somente líder, consultor ou o CS deste cliente preparam ordens de estoque', 403)
  const criadas = [], ignoradas = []
  for (const x of prontos) {
    const payload = montar(x), hash = CE.hashOrdem(payload), chave = `${cliente}|ml_estoque|${x.sku}|${x.fisico.em}|${hash}`, id = CE.idOrdem(chave), em = agora()
    const aberta = db.prepare(`SELECT id, estado FROM exec_ordem WHERE cliente = ? AND produto = ? AND adaptador = 'ml_estoque' AND estado IN (${CE.ESTADOS_ABERTOS.map(() => '?').join(',')}) AND id != ?`).all(cliente, x.sku, ...CE.ESTADOS_ABERTOS, id)
    if (aberta.some(o => ['executando', 'em_conferencia'].includes(o.estado))) { ignoradas.push({ sku: x.sku, motivo: CE.MOTIVOS.outra_aberta }); continue }
    db.transaction(() => {
      for (const o of aberta) { const ord = lerOrdem(cliente, o.id); transicionar(ord, 'obsoleta', quem, { motivo: 'nova prévia do mesmo produto' }) }
      const r = db.prepare(`INSERT INTO exec_ordem (id, cliente, regra, item_id, produto, caminho, adaptador, operacao, payload_json, snapshot_antes_json, hash, chave_idem, estado, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,'automatico','ml_estoque','alocar',?,?,?,?,'aguardando_aprovacao',?,?) ON CONFLICT(chave_idem) DO NOTHING`).run(id, cliente, 'estoque_sincronizar', x.representante, x.sku, JSON.stringify(payload), JSON.stringify({ pools: payload.pools.map(pl => ({ chave: pl.chave, de: pl.de })), em: agoraISO }), hash, chave, em, em)
      if (r.changes) evento(id, cliente, '', 'aguardando_aprovacao', quem, { sku: x.sku, alvo_total: payload.alvo_total, pools: payload.pools.length })
    })()
    if (x.plano.aviso_zerar && !lerOrdem(cliente, id)?.aviso_em) avisarZerar(cliente, id, x)
    criadas.push({ id, sku: x.sku })
  }
  if (criadas.length) lg('info', `${criadas.length} ordem(ns) de estoque preparada(s) para ${cliente} (aguardando aprovação)`)
  return { ...p, previa: false, criadas, ignoradas }
}
function avisarZerar(cliente, ordem_id, x) {
  const d = x.plano.aviso_zerar?.dias
  try { notificar({ tipo: 'sync_estoque_aviso', nivel: 'alerta', titulo: `estoque vai zerar${d != null ? ` em ~${d} dia(s)` : ''}: ${x.sku}`, corpo: `Físico informado menos as vendas: ${x.fisico.fisico} un; venda prevista ${x.venda_prevista_dia}/dia. Antes de qualquer 0 no Mercado Livre, este aviso.`, cliente, sistema: 'chaveiro', dedupeMin: 60 * 12 }) } catch { /* aviso nunca derruba */ }
  db.prepare('UPDATE exec_ordem SET aviso_em = ? WHERE id = ? AND cliente = ?').run(agora(), ordem_id, cliente)
  evento(ordem_id, cliente, 'aviso', 'aviso', 'sistema', { aviso_zerar: x.plano.aviso_zerar })
}

// ── adaptador da API (o real usa o token do cliente; os testes injetam { get, put }) ──
export function criarApiEstoque({ fetchFn = fetch, tokenValido, espera = 1500, tentativas = S.tentativas_429 } = {}) {
  const dormir = ms => new Promise(r => setTimeout(r, ms))
  async function chamar(cliente, metodo, caminho, corpo = null, headers = {}) {
    const token = await tokenValido(cliente); if (!token) return { status: 401, corpo: null, headers: {} }
    for (let k = 0; ; k++) {
      let r
      try { r = await fetchFn(`https://api.mercadolibre.com${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(corpo ? { body: JSON.stringify(corpo) } : {}), signal: AbortSignal.timeout(30_000) }) }
      catch { return { status: 0, corpo: null, headers: {} } }
      // 429 = não processado: espera e tenta de novo (GET e PUT); 5xx só no GET (PUT com 5xx pode ter gravado: a conferência decide, nunca reenvio)
      if ((r.status === 429 || (metodo === 'GET' && r.status >= 500)) && k < tentativas) { await dormir(espera * 2 ** k + Math.floor(Math.random() * 300)); continue }
      const txt = await r.text().catch(() => ''), h = {}
      for (const n of ['x-version']) { const v = r.headers?.get?.(n); if (v != null) h[n] = v }
      return { status: r.status, corpo: parse(txt, null), headers: h }
    }
  }
  // post: só o executor F4+ (chaveiro-executor-real.js: descrição nova) usa; o sincronismo de estoque só faz GET e PUT. Nunca DELETE.
  return { get: (c, caminho) => chamar(c, 'GET', caminho), put: (c, caminho, corpo, headers) => chamar(c, 'PUT', caminho, corpo, headers), post: (c, caminho, corpo) => chamar(c, 'POST', caminho, corpo) }
}
let apiReal = null
async function apiPadrao() { if (!apiReal) { const { tokenValido } = await import('./meli-contas.js'); apiReal = criarApiEstoque({ tokenValido }) } return apiReal }
async function integracaoPadrao(cliente) { const { integracaoMlReal } = await import('./gatilhos-real.js'); return integracaoMlReal(cliente).ok }
const sellerPadrao = cliente => db.prepare('SELECT meli_user_id FROM meli_contas WHERE cliente = ?').get(cliente)?.meli_user_id || null

// leitura ao vivo de um pool (UP: /stock com x-version; sem UP: o anúncio/variação) + status de todos os irmãos
async function lerPool(api, cliente, pool) {
  let stock = null
  if (pool.up) { const r = await api.get(cliente, `/user-products/${pool.up}/stock`); if (r.status !== 200) return { erro: r.status }; stock = CE.lerStock(r.corpo, r.headers); if (!stock) return { erro: 'formato' } }
  const irmaos = []
  for (const id of [...new Set(pool.itens.map(i => i.item_id))]) {
    const r = await api.get(cliente, `/items/${id}?attributes=id,status,sub_status,available_quantity,variations`)
    if (r.status !== 200 || !r.corpo) return { erro: r.status }
    const vs = pool.itens.filter(i => i.item_id === id && i.variacao_id).map(i => (r.corpo.variations || []).find(v => String(v.id) === String(i.variacao_id)))
    irmaos.push({ item_id: id, variacoes: (r.corpo.variations || []).map(v => String(v.id)), status: r.corpo.status, sub_status: r.corpo.sub_status || [], qtd: vs.length ? (vs.every(Boolean) ? vs.reduce((t, v) => t + (v.available_quantity ?? 0), 0) : null) : r.corpo.available_quantity ?? null })
  }
  const vivo = stock ? stock.proprio : irmaos[0]?.qtd ?? null
  return { stock, irmaos, vivo }
}
const pausadoPeloVendedor = i => !['active', 'paused'].includes(i.status) || (i.status === 'paused' && !(i.sub_status || []).includes('out_of_stock'))

// vendas desde `desde` (ISO) por pool, pela busca de pedidos ao vivo (todas exceto canceladas); páginas além do teto = não conferido (null)
async function vendasDesde(api, cliente, seller, desde, pools) {
  const membros = new Map(pools.flatMap(p => p.itens.map(i => [`${i.item_id}|${i.variacao_id || ''}`, p.chave]))), por = new Map(pools.map(p => [p.chave, { total: 0, depois: [] }]))
  for (let pg = 0; pg < S.paginas_pedidos_max; pg++) {
    const r = await api.get(cliente, `/orders/search?seller=${seller}&order.date_created.from=${encodeURIComponent(desde)}&sort=date_asc&limit=50&offset=${pg * 50}`)
    if (r.status !== 200 || !Array.isArray(r.corpo?.results)) return null
    for (const o of r.corpo.results) {
      if (o.status === 'cancelled') continue
      for (const oi of o.order_items || []) { const k = membros.get(`${oi.item?.id}|${oi.item?.variation_id ?? ''}`) ?? membros.get(`${oi.item?.id}|`); if (k) { const x = por.get(k); x.total += oi.quantity || 0; x.depois.push({ em: o.date_created, q: oi.quantity || 0 }) } }
    }
    if (r.corpo.results.length < 50) return por
  }
  return null
}
const somaDesde = (x, iso) => (x?.depois || []).filter(e => String(e.em) >= iso).reduce((t, e) => t + e.q, 0)

// EXECUTAR uma ordem (a ÚNICA função que faz PUT de estoque no ML). por = líder do cliente; confirmar === true.
// deps (testes): api { get, put }, integracao(cliente) → bool, seller(cliente) → id
export async function executarOrdem(cliente, ordem_id, { por = '', confirmar, api = null, integracao = null, seller = null, agoraISO = agora(), cfg = CE.CFG, hoje = hojeLocal() } = {}) {
  if (ehProspecto(cliente)) throw erro(CE.MOTIVOS.prospect)
  const ordem = lerOrdem(cliente, str(ordem_id)); if (!ordem || ordem.adaptador !== 'ml_estoque') throw erro('ordem não encontrada neste cliente', 404)
  const quem = validarLider(str(por), cliente)                                                                // sempre um líder de verdade (o tick usa o líder que liberou)
  if (!quem) throw erro('somente o líder do cliente executa ordens de estoque', 403)
  const pol = politicaDe(cliente), sku = ordem.produto, d = dados(cliente, { hoje }), decl = d.declarados.find(x => x.sku === sku) || null
  const fis = CE.fisicoAgora({ fonte: decl, linhas: d.linhas, pools: ordem.payload.pools || [], agoraISO })
  const integracaoOk = await (integracao || integracaoPadrao)(cliente).catch(() => false)
  const hojeIni = `${hoje}T00:00:00`
  const executadasHoje = db.prepare("SELECT COUNT(*) n FROM exec_ordem WHERE cliente = ? AND adaptador = 'ml_estoque' AND executado_em >= ?").get(cliente, hojeIni).n
  const t = CE.verificarTravas({ cfg, parado: parado(), politica: pol, ordem, confirmar, executadasHoje, integracaoOk, prospect: false, fisico: fis, regra: regraDe(d.regras, sku), sku })
  if (decl && ordem.payload.fonte?.em !== decl.em) t.motivos.push('o estoque físico foi informado de novo depois da prévia: prepare de novo'), t.liberado = false
  if (!t.liberado) { lg('aviso', `ordem ${ordem.id} de ${cliente} NÃO executada: ${t.motivos.join(' | ')}`); return { ok: false, executado: false, motivos: t.motivos, ordem: ordem.id } }
  // aviso antes de escrever 0
  if (ordem.payload.pools.some(p => p.para === 0 && (p.de == null || p.de > 0)) && !ordem.aviso_em) {
    avisarZerar(cliente, ordem.id, { sku, plano: { aviso_zerar: ordem.payload.aviso_zerar || { dias: null, zera: true } }, fisico: fis, venda_prevista_dia: ordem.payload.venda_prevista_dia })
    return { ok: false, executado: false, motivos: [CE.MOTIVOS.aviso_zerar], ordem: ordem.id }
  }
  api ||= await apiPadrao()
  const vendedor = (seller || sellerPadrao)(cliente)
  if (ordem.estado !== 'aprovada') transicionar(ordem, 'aprovada', quem, { hash: ordem.hash }, { aprovado_por: quem, aprovado_em: agora() })   // aprovação do líder registrada (hash conferido nas travas)
  transicionar(ordem, 'executando', quem, { hash: ordem.hash })
  let tentouPut = false                                                                                         // PUT com resposta incerta/400 pode ter gravado: conta no teto do dia
  const falha = (para, motivo, detalhe = {}) => { transicionar(ordem, para, quem, { motivo, ...detalhe }, { erro: motivo, resultado_json: JSON.stringify({ ...detalhe }), ...(tentouPut ? { executado_em: agora() } : {}) }); lg(para === 'recusada' ? 'aviso' : 'erro', `ordem ${ordem.id} de ${cliente}: ${motivo}`)
    if (para !== 'recusada') try { notificar({ tipo: 'sync_estoque', nivel: 'alerta', titulo: `ordem de estoque ${para}: ${sku}`, corpo: motivo, cliente, sistema: 'chaveiro' }) } catch { /* */ }
    return { ok: false, executado: false, estado: para, motivos: [motivo], ordem: ordem.id } }
  if (!vendedor) return falha('falhou', CE.MOTIVOS.permissao)
  // 1) tipo de conta AO VIVO
  const u = await api.get(cliente, `/users/${vendedor}`)
  if (u.status !== 200) return falha('falhou', u.status === 401 || u.status === 403 ? CE.MOTIVOS.permissao : CE.MOTIVOS.incerto, { status: u.status })
  const multiorigem = (u.corpo?.tags || []).includes('warehouse_management')
  // 2) releitura ao vivo de cada pool + irmãos
  const vivos = new Map()
  for (const pl of ordem.payload.pools) {
    const l = await lerPool(api, cliente, pl)
    if (l.erro) return falha('falhou', CE.MOTIVOS.incerto, { pool: pl.chave, leitura: l.erro })
    if (l.stock?.recusa === 'full' || l.stock?.so_selling_address && multiorigem) return falha('recusada', CE.MOTIVOS.full, { pool: pl.chave })
    if (l.stock?.recusa === 'multi_deposito') return falha('recusada', CE.MOTIVOS.multi_deposito, { pool: pl.chave })
    if (l.irmaos.some(pausadoPeloVendedor)) return falha('recusada', CE.MOTIVOS.pausado, { pool: pl.chave })
    if (multiorigem && (!pl.up || !l.stock?.x_version || !l.stock?.local)) return falha('recusada', CE.MOTIVOS.sem_pool, { pool: pl.chave })
    vivos.set(pl.chave, l)
  }
  const alinhado = alinhamentosReal().predicado(cliente, { hoje })
  if (ordem.payload.pools.some(pl => pl.itens.some(i => alinhado({ item: i.item_id, regra: 'estoque_sincronizar' }).sim))) return falha('recusada', CE.MOTIVOS.alinhado)
  // 3) vendas desde a informação do físico (desconta do físico) e desde a prévia (explica a queda desde a prévia)
  // UMA busca desde o mais antigo entre a informação do físico e as leituras «de» da prévia; cada soma filtra pela própria data
  const desdeBusca = [ordem.payload.fonte.em, ...ordem.payload.pools.map(pl => pl.lido_em || ordem.payload.previa_em)].filter(Boolean).sort()[0]
  const vend = await vendasDesde(api, cliente, vendedor, desdeBusca, ordem.payload.pools)
  if (!vend) return falha('recusada', CE.MOTIVOS.vendas_nao_conferidas)
  for (const pl of ordem.payload.pools) if (!CE.conferePrevia({ de: pl.de, lido: vivos.get(pl.chave).vivo, vendasDesde: somaDesde(vend.get(pl.chave), pl.lido_em || ordem.payload.previa_em) }))
    return falha('divergente', CE.MOTIVOS.divergente, { pool: pl.chave, previa: pl.de, lido: vivos.get(pl.chave).vivo })
  // 4) alvo recalculado AO VIVO (físico − vendas ao vivo − segurança), nunca acima do aprovado
  const vendidos = [...vend.values()].reduce((t, x) => t + somaDesde(x, ordem.payload.fonte.em), 0), fisicoVivo = Math.max(0, ordem.payload.fonte.quantidade - vendidos)
  const vel = new Map(ordem.payload.pools.map(pl => [pl.chave, Math.max(0, pl.para)]))                          // peso = a divisão aprovada (a venda de 28 d já está nela)
  const vivoPlano = CE.planejarSync({ fisico: fisicoVivo, seguranca: ordem.payload.seguranca, vBase: ordem.payload.venda_prevista_dia, pools: ordem.payload.pools.map(pl => ({ chave: pl.chave, v: vel.get(pl.chave) || 0.0001, mostrado: vivos.get(pl.chave).vivo })),
    regra: { maximo_por_anuncio: ordem.payload.maximo_por_anuncio ?? undefined } })
  const alvo = new Map(ordem.payload.pools.map(pl => [pl.chave, Math.min(pl.para, vivoPlano.pools.find(q => q.chave === pl.chave)?.para ?? 0)]))
  if (ordem.payload.pools.every(pl => alvo.get(pl.chave) === vivos.get(pl.chave).vivo)) return falha('recusada', CE.MOTIVOS.sem_mudanca, { fisico_vivo: fisicoVivo })
  // 5) escrita: primeiro os que DIMINUEM, releitura, depois os que aumentam (com o que vendeu no meio descontado)
  const enviados = [], ordemPools = [...ordem.payload.pools].sort((a, b) => (alvo.get(a.chave) - vivos.get(a.chave).vivo) - (alvo.get(b.chave) - vivos.get(b.chave).vivo))
  let parou = null
  for (const pl of ordemPools) {
    if (parado()) { parou = { para: 'falhou', motivo: CE.MOTIVOS.parado }; break }                            // kill switch relido antes de CADA PUT
    let l = vivos.get(pl.chave), q = alvo.get(pl.chave)
    if (q > l.vivo) {                                                                                            // aumenta: relê agora e desconta o que vendeu desde a 1ª leitura
      const n = await lerPool(api, cliente, pl); if (n.erro) { parou = { para: 'falhou', motivo: CE.MOTIVOS.incerto }; break }
      if (n.vivo > l.vivo) { parou = { para: 'divergente', motivo: CE.MOTIVOS.divergente }; break }
      q = Math.max(n.vivo, q - (l.vivo - n.vivo)); l = n
    }
    if (q === l.vivo) continue
    let tent = 0, res
    for (;;) {
      const pay = CE.payloadDoPool(pl, q, { multiorigem, x_version: l.stock?.x_version, local: l.stock?.local, variacoes: l.irmaos.find(i => i.item_id === pl.itens[0]?.item_id)?.variacoes })
      if (!pay) { parou = { para: 'recusada', motivo: CE.MOTIVOS.sem_pool }; break }
      tentouPut = true
      res = await api.put(cliente, pay.caminho, pay.corpo, pay.headers)
      const classe = CE.classificarStatus(res.status)
      evento(ordem.id, cliente, 'executando', 'executando', quem, { pool: pl.chave, de: l.vivo, para: q, metodo: pay.metodo, caminho: pay.caminho, status: res.status, classe, x_version_enviado: pay.headers['x-version'] || null, x_version_recebido: res.headers?.['x-version'] || null })
      if (classe === 'conflito' && tent < 1) {                                                                  // 409: relê (versão nova) e recomeça UMA vez, sem forçar
        tent++; const n = await lerPool(api, cliente, pl); if (n.erro || n.vivo > l.vivo) { parou = { para: 'divergente', motivo: CE.MOTIVOS.conflito }; break }
        q = Math.max(0, q - (l.vivo - n.vivo)); l = n; continue
      }
      if (classe === 'enviado' || classe === 'incerto') enviados.push({ pool: pl.chave, up: pl.up, itens: pl.itens, de: l.vivo, para: q, status: res.status, classe })
      if (classe !== 'enviado') parou = { para: classe === 'incerto' ? null : classe === 'conflito' ? 'divergente' : 'falhou', motivo: CE.MOTIVOS[classe] || CE.MOTIVOS.incerto }
      break
    }
    if (parou) break
  }
  const resultado = { multiorigem, fisico_vivo: fisicoVivo, vendidos_desde_informacao: vendidos, enviados }
  if (!enviados.length) return falha(parou?.para || 'falhou', parou?.motivo || CE.MOTIVOS.incerto, resultado)
  const confEm = new Date(Date.parse(agora()) + S.conferir_apos_min * 60_000).toISOString()
  transicionar(ordem, 'em_conferencia', quem, { enviados: enviados.length, parou: parou?.motivo || null }, { executado_em: agora(), conferir_em: confEm, resultado_json: JSON.stringify({ ...resultado, parou: parou?.motivo || null }), erro: parou?.motivo || '' })
  lg('info', `ordem ${ordem.id} de ${cliente}: ${enviados.length} escrita(s) enviada(s) (${multiorigem ? 'seller_warehouse' : 'item'}); conferência a partir de ${confEm.slice(11, 16)}Z`)
  return { ok: true, executado: true, estado: 'em_conferencia', enviados: enviados.map(e => ({ pool: e.pool, de: e.de, para: e.para, status: e.status })), parou: parou?.motivo || null, ordem: ordem.id }
}

// CONFERIR (só leitura): ordens em conferência vencidas — lido × escrito × vendas desde a escrita, em TODOS os irmãos. 3 tentativas incertas = falhou. Nunca reenvia.
export async function conferirOrdens({ cliente = null, api = null, seller = null, agoraISO = agora(), forcar = false } = {}) {
  const ordens = db.prepare(`SELECT * FROM exec_ordem WHERE adaptador = 'ml_estoque' AND estado = 'em_conferencia'${cliente ? ' AND cliente = ?' : ''}${forcar ? '' : ' AND conferir_em <= ?'}`).all(...[cliente, forcar ? null : agoraISO].filter(x => x != null))
  if (!ordens.length) return { conferidas: 0, resultados: [] }
  api ||= await apiPadrao()
  const resultados = []
  for (const r of ordens) {
    const ordem = { ...r, payload: parse(r.payload_json, {}), resultado: parse(r.resultado_json, {}) }, env = ordem.resultado.enviados || []
    const vendedor = (seller || sellerPadrao)(ordem.cliente), vend = vendedor ? await vendasDesde(api, ordem.cliente, vendedor, ordem.executado_em, env.map(e => ({ chave: e.pool, itens: e.itens }))) : null
    let estado = 'confere'; const det = []
    for (const e of env) {
      const l = await lerPool(api, ordem.cliente, { chave: e.pool, up: e.up, itens: e.itens })
      const vd = vend ? vend.get(e.pool)?.total ?? 0 : null
      const leituras = l.erro ? [null] : [l.vivo, ...l.irmaos.map(i => i.qtd)]
      const vs = leituras.map(x => (vd == null ? (x == null ? 'aguardando' : x > e.para ? 'divergente' : x === e.para ? 'confere' : 'aguardando') : CE.conferirPool({ esperado: e.para, lido: x, vendasDesde: vd })))
      const v = vs.includes('divergente') ? 'divergente' : vs.every(x => x === 'confere') ? 'confere' : 'aguardando'
      det.push({ pool: e.pool, esperado: e.para, lido: l.erro ? null : l.vivo, irmaos: l.erro ? [] : l.irmaos.map(i => ({ item_id: i.item_id, qtd: i.qtd })), vendas: vd, veredito: v })
      if (v === 'divergente') estado = 'divergente'; else if (v === 'aguardando' && estado === 'confere') estado = 'aguardando'
    }
    const n = (ordem.conferencias || 0) + 1, extra = { conferencias: n, conferido_em: agora(), resultado_json: JSON.stringify({ ...ordem.resultado, conferencia: det }) }
    if (estado === 'confere') { transicionar(ordem, 'executada', 'sistema', { conferencia: det }, extra); lg('info', `ordem ${ordem.id} de ${ordem.cliente}: escrita conferida em todos os anúncios do produto ${ordem.produto}`)
      try { notificar({ tipo: 'sync_estoque', titulo: `estoque sincronizado e conferido: ${ordem.produto}`, corpo: det.map(x => `${x.pool}: ${x.esperado} un`).join('; '), cliente: ordem.cliente, sistema: 'chaveiro' }) } catch { /* */ } }
    else if (estado === 'divergente') { transicionar(ordem, 'divergente', 'sistema', { conferencia: det }, { ...extra, erro: CE.MOTIVOS.divergente }); try { notificar({ tipo: 'sync_estoque', nivel: 'alerta', titulo: `estoque divergente depois da escrita: ${ordem.produto}`, corpo: CE.MOTIVOS.divergente, cliente: ordem.cliente, sistema: 'chaveiro' }) } catch { /* */ } }
    else if (n >= S.conferencias_max) { transicionar(ordem, 'falhou', 'sistema', { conferencia: det }, { ...extra, erro: CE.MOTIVOS.nao_confirmou }); try { notificar({ tipo: 'sync_estoque', nivel: 'alerta', titulo: `estoque não confirmado: ${ordem.produto}`, corpo: CE.MOTIVOS.nao_confirmou, cliente: ordem.cliente, sistema: 'chaveiro' }) } catch { /* */ } }
    else { db.prepare('UPDATE exec_ordem SET conferencias = ?, conferido_em = ?, conferir_em = ?, resultado_json = ?, atualizado_em = ? WHERE id = ? AND cliente = ?').run(n, extra.conferido_em, new Date(Date.parse(agora()) + S.conferir_apos_min * 60_000).toISOString(), extra.resultado_json, agora(), ordem.id, ordem.cliente); evento(ordem.id, ordem.cliente, 'em_conferencia', 'em_conferencia', 'sistema', { tentativa: n, conferencia: det }) }
    resultados.push({ ordem: ordem.id, cliente: ordem.cliente, veredito: estado, tentativa: n })
  }
  return { conferidas: resultados.length, resultados }
}

// ── POLÍTICA: liberação por cliente (líder + cliente informado), estreia em 1 produto, ampliação só com 10 ordens conferidas sem divergência ──
export function liberarCliente(cliente, { por = '', cliente_informado = false, produto = '', nivel = 'executar_com_aprovacao', confirmar = false } = {}) {
  if (ehProspecto(cliente)) throw erro(CE.MOTIVOS.prospect)
  const lider = validarLider(str(por), cliente); if (!lider) throw erro('somente o líder do cliente libera o sincronismo de estoque', 403)
  if (cliente_informado !== true) throw erro('informe que o cliente foi avisado do sincronismo (cliente_informado: true): «passamos a ajustar o estoque dos seus anúncios a partir do estoque que você informa»')
  if (!['executar_com_aprovacao', 'executar_e_avisar'].includes(nivel)) throw erro('nível inválido: executar_com_aprovacao ou executar_e_avisar')
  const sku = chaveSku(str(produto)); if (!sku || !db.prepare('SELECT 1 FROM produto_estoque_declarado WHERE cliente = ? AND sku = ?').get(cliente, sku)) throw erro('informe o SKU do produto da estreia (com estoque físico informado)', 404)
  const atual = politicaDe(cliente), conferidas = executadasSemDivergencia(cliente), ja = atual?.produtos || []
  const novos = [...new Set([...ja, sku])]
  if (novos.length > 1 && (conferidas < S.ordens_para_ampliar || teveDivergencia(cliente))) throw erro(`estreia supervisionada: o 2º produto só entra depois de ${S.ordens_para_ampliar} ordens conferidas sem divergência neste cliente`, 409)
  if (nivel === 'executar_e_avisar' && (conferidas < S.ordens_para_ampliar || teveDivergencia(cliente))) throw erro(`execução sem aprovação a cada ordem só depois de ${S.ordens_para_ampliar} ordens conferidas sem divergência`, 409)
  const max = novos.length > 1 ? Math.max(atual?.max_ordens_dia ?? 1, 1) : S.max_ordens_dia_estreia
  const r = { ok: true, cliente, nivel, produtos: novos, max_ordens_dia: max, liberado_por: lider, conferidas }
  if (confirmar !== true) return { ...r, previa: true }
  const em = agora()
  db.prepare(`INSERT INTO exec_politica (cliente, nivel, adaptadores_live_json, max_ordens_dia, produtos_json, liberado_por, liberado_em, cliente_informado_por, cliente_informado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(cliente) DO UPDATE SET nivel = excluded.nivel, adaptadores_live_json = excluded.adaptadores_live_json, max_ordens_dia = excluded.max_ordens_dia, produtos_json = excluded.produtos_json, liberado_por = excluded.liberado_por,
    liberado_em = excluded.liberado_em, cliente_informado_por = excluded.cliente_informado_por, cliente_informado_em = excluded.cliente_informado_em, atualizado_em = excluded.atualizado_em`)
    .run(cliente, nivel, JSON.stringify({ ...(atual?.adaptadores || {}), ml_estoque: 1 }), max, JSON.stringify(novos), lider, em, lider, em, em)
  evento('politica', cliente, atual ? atual.nivel : 'propor', nivel, lider, { produtos: novos, max_ordens_dia: max })
  lg('info', `sincronismo de estoque LIBERADO para ${cliente} por ${lider} (produtos: ${novos.join(', ')}; ${max} ordem/dia)`)
  return { ...r, previa: false }
}
export function revogarCliente(cliente, { por = '', confirmar = false } = {}) {
  const quem = validarLider(str(por), cliente); if (!quem) throw erro('somente o líder do cliente revoga o sincronismo de estoque', 403)
  if (confirmar !== true) return { ok: true, previa: true, cliente }
  const em = agora(), atual = politicaDe(cliente)
  db.prepare(`INSERT INTO exec_politica (cliente, nivel, adaptadores_live_json, atualizado_em) VALUES (?, 'propor', '{}', ?) ON CONFLICT(cliente) DO UPDATE SET nivel = 'propor', adaptadores_live_json = ?, atualizado_em = excluded.atualizado_em`)
    .run(cliente, em, JSON.stringify({ ...(atual?.adaptadores || {}), ml_estoque: 0 }))
  cancelarAbertas(cliente, quem, 'sincronismo revogado para o cliente')
  evento('politica', cliente, atual?.nivel || 'propor', 'propor', quem, { ml_estoque: 0 })
  lg('aviso', `sincronismo de estoque REVOGADO para ${cliente} por ${quem}`)
  return { ok: true, previa: false, cliente }
}
function cancelarAbertas(cliente, por, motivo) {
  const l = db.prepare(`SELECT id, cliente FROM exec_ordem WHERE adaptador = 'ml_estoque' AND estado IN ('preparada','aguardando_aprovacao','aprovada')${cliente ? ' AND cliente = ?' : ''}`).all(...(cliente ? [cliente] : []))
  for (const o of l) { const ord = lerOrdem(o.cliente, o.id); try { transicionar(ord, 'cancelada', por, { motivo }) } catch { /* mudou no meio */ } }
  return l.length
}
// KILL SWITCH: para tudo na hora (nenhum PUT sai; o tick e a execução releem a chave antes de cada escrita) e cancela o que estava na fila
export function pararSync({ por = '', confirmar = false } = {}) {
  const quem = validarLider(str(por)); if (!quem) throw erro('somente um líder para o sincronismo de estoque', 403)
  if (confirmar !== true) return { ok: true, previa: true, parado: parado() }
  setEstado(CHAVE_PARADO, '1'); const n = cancelarAbertas(null, quem, CE.MOTIVOS.parado)
  lg('aviso', `sincronismo de estoque PARADO por ${quem} (${n} ordem(ns) na fila cancelada(s))`)
  try { notificar({ tipo: 'sync_estoque', nivel: 'alerta', titulo: 'sincronismo de estoque parado (botão de emergência)', corpo: `por ${quem}`, sistema: 'chaveiro' }) } catch { /* */ }
  return { ok: true, previa: false, parado: true, canceladas: n }
}
export function retomarSync({ por = '', confirmar = false } = {}) {
  const quem = validarLider(str(por)); if (!quem) throw erro('somente um líder retoma o sincronismo de estoque', 403)
  if (confirmar !== true) return { ok: true, previa: true, parado: parado() }
  setEstado(CHAVE_PARADO, '0'); lg('info', `sincronismo de estoque retomado por ${quem}`)
  return { ok: true, previa: false, parado: false }
}
// regra por cliente/produto: dias de proteção (segurança = dias × venda prevista), máximo por anúncio, não escrever. Prévia por padrão.
export function salvarRegra(cliente, { produto = '*', dias_protecao = null, maximo_por_anuncio = null, nao_escrever = false, por = '', confirmar = false, validarPor = null } = {}) {
  const p = produto === '*' ? '*' : chaveSku(str(produto)); if (!p || p.length > 80) throw erro('informe o produto (SKU) ou * para a conta toda')
  const dp = dias_protecao == null || dias_protecao === '' ? null : Number(dias_protecao), mx = maximo_por_anuncio == null || maximo_por_anuncio === '' ? null : Number(maximo_por_anuncio)
  if (dp != null && !(dp >= 0 && dp <= 60)) throw erro('dias de proteção entre 0 e 60')
  if (mx != null && !(Number.isInteger(mx) && mx >= 1 && mx <= 100000)) throw erro('máximo por anúncio inteiro entre 1 e 100.000')
  const r = { ok: true, cliente, produto: p, dias_protecao: dp, maximo_por_anuncio: mx, nao_escrever: nao_escrever === true }
  if (confirmar !== true) return { ...r, previa: true }
  const quem = (validarPor ? validarPor(str(por), cliente) : '') || validarLider(str(por), cliente); if (!quem) throw erro('somente líder, consultor ou o CS deste cliente mudam a regra de estoque', 403)
  db.prepare(`INSERT INTO produto_regra_estoque (cliente, produto, dias_protecao, maximo_por_anuncio, nao_escrever, por, em) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(cliente, produto) DO UPDATE SET dias_protecao = excluded.dias_protecao, maximo_por_anuncio = excluded.maximo_por_anuncio, nao_escrever = excluded.nao_escrever, por = excluded.por, em = excluded.em`).run(cliente, p, dp, mx, nao_escrever === true ? 1 : 0, String(quem).slice(0, 80), agora())
  return { ...r, previa: false }
}

// TICK (10 min): só com a chave global ligada e o kill switch solto. Confere as ordens vencidas (só leitura) e, no nível executar_e_avisar (só depois de 10 ordens
// conferidas sem divergência), prepara e executa dentro do teto do dia — por = o líder que liberou o cliente.
export async function tickEstoque({ api = null, cfg = CE.CFG } = {}) {
  if (!syncLigado(cfg)) return { ligado: false }
  const conf = await conferirOrdens({ api })
  const auto = db.prepare("SELECT cliente, liberado_por FROM exec_politica WHERE nivel = 'executar_e_avisar' AND liberado_por != ''").all()
  const exec = []
  for (const p of auto) {
    if (!syncLigado(cfg)) break
    try {
      const r = prepararOrdens(p.cliente, { por: p.liberado_por, confirmar: true, validarPor: () => p.liberado_por })
      for (const o of r.criadas) exec.push(await executarOrdem(p.cliente, o.id, { por: p.liberado_por, confirmar: true, api, cfg }))
    } catch (e) { lg('erro', `tick de estoque (${p.cliente}): ${String(e?.message).slice(0, 160)}`) }
  }
  return { ligado: true, conferidas: conf.conferidas, executadas: exec.filter(x => x.executado).length }
}

// MEROVÍNGIO — marco «sync_estoque»: N dias antes × depois da 1ª escrita conferida do cliente; tratados = anúncios das ordens executadas, controle = demais ativos.
// dias sem estoque (eventos estoque_zero do change-log), cancelamentos (linhas canceladas) e unidades (série). Associação, nunca causa.
export function marcoSyncEstoque(cliente, { hoje = hojeLocal(), N = 28 } = {}) {
  const ex = db.prepare("SELECT payload_json, executado_em FROM exec_ordem WHERE cliente = ? AND adaptador = 'ml_estoque' AND estado = 'executada' ORDER BY executado_em").all(cliente)
  if (!ex.length) return { cliente, estado: 'sem_marco', motivo: 'nenhuma escrita de estoque conferida ainda' }
  const data = ex[0].executado_em.slice(0, 10), tratados = new Set(ex.flatMap(o => (parse(o.payload_json, {}).pools || []).flatMap(p => p.itens.map(i => i.item_id))))
  const ativos = db.prepare("SELECT item_id FROM meli_item WHERE cliente = ? AND status = 'active'").all(cliente).map(r => r.item_id).filter(id => !tratados.has(id))
  const janela = (ids, de, ate) => {
    if (!ids.length) return null
    const ph = ids.map(() => '?').join(','), u = db.prepare(`SELECT COALESCE(SUM(unidades), 0) u FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ? AND item_id IN (${ph})`).get(cliente, de, ate, ...ids).u
    const c = db.prepare(`SELECT COALESCE(SUM(quantidade), 0) q FROM meli_pedido_item WHERE cliente = ? AND status = 'cancelled' AND dia BETWEEN ? AND ? AND item_id IN (${ph})`).get(cliente, de, ate, ...ids).q
    let zero = 0
    for (const id of ids) {
      const ev = db.prepare("SELECT dia, para FROM meli_item_mudanca WHERE cliente = ? AND item_id = ? AND campo = 'estoque_zero' AND dia <= ? ORDER BY dia").all(cliente, id, ate)
      let z = ev.filter(e => e.dia < de).map(e => Number(e.para) <= 0).pop() ?? false, ini = de
      for (const e of ev.filter(e => e.dia >= de)) { const agoraZ = Number(e.para) <= 0; if (z && !agoraZ) zero += diasEntre(ini, e.dia); if (!z && agoraZ) ini = e.dia; z = agoraZ }
      if (z) zero += diasEntre(ini, ate) + 1
    }
    return { unidades: u, cancelados: c, dias_sem_estoque: zero }
  }
  const antesDe = diaMenos(data, N), antesAte = diaMenos(data, 1), depoisDe = data, depoisAte = diaMenos(data, -(N - 1)), completo = depoisAte < hoje
  const ate = completo ? depoisAte : diaMenos(hoje, 1)
  const g = ids => ({ antes: janela(ids, antesDe, antesAte), depois: janela(ids, depoisDe, ate), completo, n: ids.length })
  return { cliente, data, ...CE.medirSyncEstoque({ tratado: g([...tratados]), controle: g(ativos), N }) }
}
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000)
