// Saúde da conta GRAVADA (fase 1): reputação, perguntas sem resposta, reclamações, atrasos de despacho e estoque Full — 1 linha/dia em meli_conta_saude
// + upsert das listas (meli_claim, meli_pergunta sem texto, meli_envio_atraso, meli_full_estoque). Só leitura no ML. Cada bloco chama a API com permitirFalha
// e classifica a falha: 401/403 → 'permissao_do_app'; 5xx/timeout/rede → 'indisponivel'; campo desconhecido → 'endpoint_nao_verificado'. Coluna fica NULL
// e o motivo vai em pendente_json — NUNCA zero quando a chamada falhou. Textos dos motivos em config/saude.json (nunca ecoam a resposta da API).
// Endpoints a verificar em conta real (docs/manual-integracao-ml.md § Saúde da conta): shipments.shipping_option.estimated_handling_limit.date e idade do estoque Full.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal, agora } from './db.js'
import { ROOT } from './env.js'
import { chamar, multiget } from './meli-api.js'
import { idDoVendedor, listarConexoesColeta } from './meli-contas.js'
import { addDias, diasEntre } from './meli-serie.js'
import { semChaveS90 } from './s90-chave.js'

export const CFG_SAUDE = JSON.parse(readFileSync(join(ROOT, 'config', 'saude.json'), 'utf-8'))
const sha1 = s => createHash('sha1').update(String(s)).digest('hex')
const r2 = x => Math.round(x * 100) / 100
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)

// classificação da falha (nunca ecoa corpo)
const motivoDe = r => !r || r._erro !== true ? '' : (r.status === 401 || r.status === 403) ? 'permissao_do_app' : 'indisponivel'
async function seguro(api, cliente, caminho) {
  try { return await api(cliente, caminho, { permitirFalha: true }) } catch { return { _erro: true, status: 0 } }   // rede/timeout = indisponível
}
// paginação com teto: devolve { itens, truncado, erro } — erro na 1ª página = bloco inteiro falhou; erro depois = amostra parcial (truncado)
async function paginar(api, cliente, montar, { chave, teto, pagina = CFG_SAUDE.pagina }) {
  const itens = []
  for (let p = 0; p < teto; p++) {
    const r = await seguro(api, cliente, montar(p * pagina, pagina))
    if (r._erro) return p === 0 ? { itens, erro: motivoDe(r), status: r.status } : { itens, truncado: true }
    const lote = r[chave] || r.results || r.data || []
    itens.push(...lote)
    const total = r.paging?.total ?? r.total
    if (!lote.length || lote.length < pagina || (total != null && itens.length >= total)) return { itens, truncado: false }
  }
  return { itens, truncado: true }
}

const upSaude = db.prepare(`INSERT INTO meli_conta_saude (cliente, dia, level_id, power_seller, taxa_claims, taxa_atraso, taxa_cancel, vendas_periodo, perguntas_abertas, perguntas_24h, claims_abertas, mediacoes, atrasos, fonte_json, pendente_json, coletado_em)
  VALUES (@cliente,@dia,@level_id,@power_seller,@taxa_claims,@taxa_atraso,@taxa_cancel,@vendas_periodo,@perguntas_abertas,@perguntas_24h,@claims_abertas,@mediacoes,@atrasos,@fonte_json,@pendente_json,@coletado_em)
  ON CONFLICT(cliente, dia) DO UPDATE SET level_id=excluded.level_id, power_seller=excluded.power_seller, taxa_claims=excluded.taxa_claims, taxa_atraso=excluded.taxa_atraso, taxa_cancel=excluded.taxa_cancel,
    vendas_periodo=excluded.vendas_periodo, perguntas_abertas=excluded.perguntas_abertas, perguntas_24h=excluded.perguntas_24h, claims_abertas=excluded.claims_abertas, mediacoes=excluded.mediacoes, atrasos=excluded.atrasos,
    fonte_json=excluded.fonte_json, pendente_json=excluded.pendente_json, coletado_em=excluded.coletado_em`)
const upClaim = db.prepare(`INSERT INTO meli_claim (cliente, claim_id, item_id, order_id, tipo, estagio, status, motivo, aberto_em, prazo_resposta, fechado_em, atualizado_em) VALUES (@cliente,@claim_id,@item_id,@order_id,@tipo,@estagio,@status,@motivo,@aberto_em,@prazo_resposta,@fechado_em,@atualizado_em)
  ON CONFLICT(cliente, claim_id) DO UPDATE SET item_id=COALESCE(excluded.item_id, item_id), order_id=COALESCE(excluded.order_id, order_id), tipo=excluded.tipo, estagio=excluded.estagio, status=excluded.status, motivo=excluded.motivo, prazo_resposta=excluded.prazo_resposta, fechado_em=excluded.fechado_em, atualizado_em=excluded.atualizado_em`)
const upPergunta = db.prepare(`INSERT INTO meli_pergunta (cliente, question_id, item_id, texto_hash, status, perguntado_em, respondido_em) VALUES (@cliente,@question_id,@item_id,@texto_hash,@status,@perguntado_em,@respondido_em)
  ON CONFLICT(cliente, question_id) DO UPDATE SET status=excluded.status, respondido_em=COALESCE(excluded.respondido_em, respondido_em)`)
const upAtraso = db.prepare(`INSERT INTO meli_envio_atraso (cliente, order_id, shipment_id, item_id, prazo_despacho, despachado_em, dias_atraso, status, coletado_em) VALUES (@cliente,@order_id,@shipment_id,@item_id,@prazo_despacho,@despachado_em,@dias_atraso,@status,@coletado_em)
  ON CONFLICT(cliente, order_id) DO UPDATE SET shipment_id=excluded.shipment_id, prazo_despacho=excluded.prazo_despacho, despachado_em=excluded.despachado_em, dias_atraso=excluded.dias_atraso, status=excluded.status, coletado_em=excluded.coletado_em`)
const upFull = db.prepare(`INSERT INTO meli_full_estoque (cliente, item_id, inventory_id, dia, disponivel, nao_disponivel, dias_sem_venda, idade_dias, fonte, pendente) VALUES (@cliente,@item_id,@inventory_id,@dia,@disponivel,@nao_disponivel,@dias_sem_venda,@idade_dias,@fonte,@pendente)
  ON CONFLICT(cliente, inventory_id, dia) DO UPDATE SET item_id=excluded.item_id, disponivel=excluded.disponivel, nao_disponivel=excluded.nao_disponivel, dias_sem_venda=excluded.dias_sem_venda, idade_dias=excluded.idade_dias, fonte=excluded.fonte, pendente=excluded.pendente`)

// dias desde a última venda do anúncio na série (estimativa: a série só cobre os dias coletados) — null sem venda registrada
function diasSemVenda(cliente, itemId, hoje) {
  const u = db.prepare('SELECT MAX(dia) d FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND unidades > 0').get(cliente, itemId)?.d
  return u ? diasEntre(u, hoje) : null
}

// ── uma conta, agora ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function coletarSaude(cliente, { api = chamar, hoje = hojeLocal(), agoraMs = Date.now() } = {}) {
  if (ehProspecto(cliente)) throw Object.assign(new Error('prospect do Comercial não é cliente: sem coleta de saúde'), { status: 400 })
  const id = idDoVendedor(cliente)
  if (!id) return { cliente, coletada: false, motivo: 'conta do Mercado Livre não conectada' }
  const t = agora(), pend = {}, fonte = {}
  const linha = { cliente, dia: hoje, level_id: null, power_seller: null, taxa_claims: null, taxa_atraso: null, taxa_cancel: null, vendas_periodo: null, perguntas_abertas: null, perguntas_24h: null, claims_abertas: null, mediacoes: null, atrasos: null, coletado_em: t }
  const escritas = []   // gravações das listas, aplicadas numa transação só depois de todas as leituras

  // 1) reputação
  const u = await seguro(api, cliente, `/users/${id}`)
  fonte.reputacao = { endpoint: '/users/{id}' }
  if (u._erro) pend.reputacao = motivoDe(u)
  else {
    const rep = u.seller_reputation || {}, m = rep.metrics || {}
    Object.assign(linha, { level_id: rep.level_id || null, power_seller: rep.power_seller_status || null, vendas_periodo: m.sales?.completed ?? null,
      taxa_claims: m.claims?.rate != null ? r2(m.claims.rate * 100) : null, taxa_atraso: m.delayed_handling_time?.rate != null ? r2(m.delayed_handling_time.rate * 100) : null, taxa_cancel: m.cancellations?.rate != null ? r2(m.cancellations.rate * 100) : null })
    fonte.reputacao.periodo = m.sales?.period || null
  }

  // 2) perguntas sem resposta (texto NÃO gravado: só hash)
  const q = await paginar(api, cliente, (off, lim) => `/questions/search?seller_id=${id}&status=UNANSWERED&limit=${lim}&offset=${off}&api_version=4`, { chave: 'questions', teto: CFG_SAUDE.teto_paginas.perguntas })
  fonte.perguntas = { endpoint: '/questions/search?status=UNANSWERED', truncado: !!q.truncado }
  if (q.erro) pend.perguntas = q.erro
  else {
    const limite = Date.now() - CFG_SAUDE.perguntas_limite_horas * 3600e3
    linha.perguntas_abertas = q.itens.length; linha.perguntas_24h = q.itens.filter(p => p.date_created && Date.parse(p.date_created) < limite).length
    const vistas = q.itens.map(p => String(p.id))
    escritas.push(() => {
      for (const p of q.itens) upPergunta.run({ cliente, question_id: String(p.id), item_id: p.item_id ? String(p.item_id) : null, texto_hash: p.text ? sha1(p.text) : null, status: 'UNANSWERED', perguntado_em: p.date_created || null, respondido_em: null })
      if (!q.truncado) db.prepare(`UPDATE meli_pergunta SET status = 'fechada' WHERE cliente = ? AND status = 'UNANSWERED' AND question_id NOT IN (${vistas.map(() => '?').join(',') || "''"})`).run(cliente, ...vistas)   // não listada = respondida ou fechada (quando não sabemos, não inventamos)
    })
  }

  // 3) reclamações (respondent = o vendedor)
  const c = await paginar(api, cliente, (off, lim) => `/post-purchase/v2/claims/search?${new URLSearchParams({ player_id: String(id), player_role: 'respondent', limit: String(lim), offset: String(off) })}`, { chave: 'data', teto: CFG_SAUDE.teto_paginas.claims })
  fonte.reclamacoes = { endpoint: '/post-purchase/v2/claims/search', truncado: !!c.truncado }
  if (c.erro) pend.reclamacoes = c.erro
  else {
    const abertas = c.itens.filter(x => x.status === 'opened')
    linha.claims_abertas = abertas.length; linha.mediacoes = abertas.filter(x => x.stage === 'dispute').length
    escritas.push(() => { for (const x of c.itens) upClaim.run({ cliente, claim_id: String(x.id), item_id: x.item_id ? String(x.item_id) : null, order_id: x.resource === 'order' && x.resource_id ? String(x.resource_id) : null, tipo: x.type || null, estagio: x.stage || null, status: x.status || null, motivo: x.reason_id || null, aberto_em: x.date_created || null, prazo_resposta: x.due_date || null, fechado_em: x.status === 'closed' ? x.last_updated || t : null, atualizado_em: t }) })
  }

  // 4) atrasos de despacho: pedidos pagos dos últimos N dias → envios ainda em ready_to_ship/handling com prazo de despacho vencido
  const de = addDias(hoje, -CFG_SAUDE.pedidos_dias)
  const o = await paginar(api, cliente, (off, lim) => `/orders/search?${new URLSearchParams({ seller: String(id), 'order.status': 'paid', 'order.date_created.from': `${de}T00:00:00.000-03:00`, sort: 'date_desc', limit: String(lim), offset: String(off) })}`, { chave: 'results', teto: CFG_SAUDE.teto_paginas.pedidos })
  fonte.atrasos = { endpoint: '/orders/search + /shipments/{id}', janela: { de, ate: hoje }, truncado: !!o.truncado, campo_prazo: 'shipping_option.estimated_handling_limit.date (a verificar)' }
  if (o.erro) pend.atrasos = o.erro
  else {
    const PENDENTES = new Set(['ready_to_ship', 'handling', 'pending'])
    // lista fechada de campos do pedido; quando a busca já traz shipping.status, só os pendentes vão ao /shipments
    const candidatos = o.itens.map(p => ({ order_id: String(p.id), shipment_id: p.shipping?.id ? String(p.shipping.id) : null, status: p.shipping?.status || null, item_id: p.order_items?.[0]?.item?.id ? String(p.order_items[0].item.id) : null }))
      .filter(p => p.shipment_id && (p.status == null || PENDENTES.has(p.status))).slice(0, CFG_SAUDE.teto_envios_por_coleta)
    let atrasos = 0, semCampo = false, falhou = false
    const linhas = []
    for (const p of candidatos) {
      const s = await seguro(api, cliente, `/shipments/${p.shipment_id}`)
      if (s._erro) { falhou = true; break }
      if (!PENDENTES.has(s.status)) continue
      const prazo = s.shipping_option?.estimated_handling_limit?.date || null   // a verificar em conta real (docs/manual-integracao-ml.md)
      if (!prazo) { semCampo = true; continue }
      // um relógio só para "venceu?" e "quantos dias": antes os dias saíam da data injetada (meio-dia no fuso do processo) e o vencimento do relógio real — discordavam
      const atrasoMs = agoraMs - Date.parse(prazo)
      if (atrasoMs > 0) { atrasos++; linhas.push({ cliente, order_id: p.order_id, shipment_id: p.shipment_id, item_id: p.item_id, prazo_despacho: prazo, despachado_em: null, dias_atraso: Math.ceil(atrasoMs / 86400e3), status: s.status, coletado_em: t }) }
    }
    if (falhou) pend.atrasos = 'indisponivel'
    else if (semCampo) pend.atrasos = 'endpoint_nao_verificado'
    else linha.atrasos = atrasos
    if (!falhou) escritas.push(() => { db.prepare('DELETE FROM meli_envio_atraso WHERE cliente = ?').run(cliente); for (const l of linhas) upAtraso.run(l) })   // a lista é "o que está atrasado hoje"
  }

  // 5) Full: estoque disponível/indisponível por inventory_id; idade do estoque = endpoint não verificado → dias_sem_venda estimado pela série
  const full = db.prepare("SELECT item_id FROM meli_item WHERE cliente = ? AND logistica = 'fulfillment' AND status = 'active'").all(cliente).map(x => x.item_id)
  fonte.full = { endpoint: '/items/bulk (id, inventory_id) + /inventories/{inventory_id}/stock/fulfillment', anuncios: full.length, idade: 'endpoint_nao_verificado' }
  if (!full.length) pend.full = 'sem_full'
  else {
    const inv = []
    let falhou = false
    try {
      const corpos = await multiget(cliente, full, 'id,inventory_id', { chamarFn: (c, caminho) => seguro(api, c, caminho) })
      if (corpos.parcial?.blocos_falhos) falhou = true          // lote inteiro falhou: Full pendente (tudo ou nada, como antes); item 404 dentro do bulk só fica de fora
      for (const b of corpos) if (b.inventory_id) inv.push({ item_id: String(b.id), inventory_id: String(b.inventory_id) })
    } catch { falhou = true }                                   // guarda do multiget: N anúncios Full e 0 lidos = 'indisponivel', nunca "sem Full"
    // anúncios que DIVIDEM o mesmo estoque no Full (mesmo inventory_id: catálogo + clássico, variações) são um estoque só:
    // 1 leitura por inventário e "dias sem venda" = a venda mais recente de QUALQUER um deles (antes: guardava o último anúncio lido e
    // o estoque de um campeão aparecia como "parado há 100+ dias" porque o outro anúncio do mesmo produto não vendia — Rotec, 12/10)
    const porInv = new Map(); for (const x of inv) porInv.set(x.inventory_id, [...(porInv.get(x.inventory_id) || []), x.item_id])
    const linhas = []
    for (const [inventory_id, itens] of porInv) {
      if (falhou) break
      const s = await seguro(api, cliente, `/inventories/${inventory_id}/stock/fulfillment`)
      if (s._erro) { falhou = true; break }
      const dias = itens.map(it => ({ it, d: diasSemVenda(cliente, it, hoje) })), comVenda = dias.filter(x => x.d != null).sort((a, b) => a.d - b.d)
      linhas.push({ cliente, item_id: (comVenda[0] || dias[0]).it, inventory_id, dia: hoje, disponivel: s.available_quantity ?? null, nao_disponivel: s.not_available_quantity ?? null, dias_sem_venda: comVenda.length ? comVenda[0].d : null, idade_dias: null, fonte: 'estimativa_serie', pendente: 'endpoint_nao_verificado' })
    }
    if (falhou) pend.full = 'indisponivel'
    else escritas.push(() => { for (const l of linhas) upFull.run(l) })
  }

  db.transaction(() => { upSaude.run({ ...linha, fonte_json: JSON.stringify(fonte), pendente_json: JSON.stringify(pend) }); for (const f of escritas) f() })()
  return { cliente, coletada: true, dia: hoje, pendente: pend, coletado_em: t }
}

// ── todas as contas em coleta (molde da etapa do notion-cliente): isolamento por cliente, teto de tempo, nunca lança ──
export async function coletarSaudeTodos({ tetoMs = 10 * 60_000, log = () => {}, api = chamar, hoje = hojeLocal() } = {}) {
  const inicio = Date.now(), out = { ok: 0, falhas: 0, pulados: 0 }
  for (const c of listarConexoesColeta()) {
    if (Date.now() - inicio > tetoMs) { out.pulados++; continue }
    try { const r = await coletarSaude(c.cliente, { api, hoje }); out.ok++; log('info', semChaveS90(`saúde da conta ok — ${c.cliente}${Object.keys(r.pendente || {}).length ? ` (pendente: ${Object.entries(r.pendente).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`)) }
    catch (e) { out.falhas++; log('erro', semChaveS90(`saúde da conta (${c.cliente}): ${String(e.message).slice(0, 160)}`)) }
  }
  return out
}

// ── leitura: último dia gravado (+ se é de hoje/ontem) e as listas abertas ──
export function lerSaude(cliente, { hoje = hojeLocal() } = {}) {
  const l = db.prepare('SELECT * FROM meli_conta_saude WHERE cliente = ? ORDER BY dia DESC LIMIT 1').get(cliente)
  if (!l) return { cliente, dia: null, do_dia: false, pendente: {}, fonte: {}, textos: CFG_SAUDE.pendente }
  let pendente = {}, fonte = {}
  try { pendente = JSON.parse(l.pendente_json || '{}'); fonte = JSON.parse(l.fonte_json || '{}') } catch { /* json defensivo */ }
  const limite = new Date(Date.now() - CFG_SAUDE.perguntas_limite_horas * 3600e3).toISOString()
  return {
    cliente, dia: l.dia, do_dia: l.dia === hoje || (CFG_SAUDE.aceita_ontem && l.dia === addDias(hoje, -1)), coletado_em: l.coletado_em,
    reputacao: { nivel: l.level_id, medalha: l.power_seller, taxa_claims: l.taxa_claims, taxa_atraso: l.taxa_atraso, taxa_cancel: l.taxa_cancel, vendas_periodo: l.vendas_periodo },
    perguntas: { abertas: l.perguntas_abertas, mais_de_24h: l.perguntas_24h }, reclamacoes: { abertas: l.claims_abertas, mediacoes: l.mediacoes }, atrasos: l.atrasos,
    pendente, fonte, textos: CFG_SAUDE.pendente,
    listas: {
      claims: db.prepare("SELECT claim_id, item_id, order_id, tipo, estagio, motivo, aberto_em, prazo_resposta FROM meli_claim WHERE cliente = ? AND status = 'opened' AND atualizado_em >= ? ORDER BY aberto_em").all(cliente, l.coletado_em),
      perguntas: db.prepare("SELECT question_id, item_id, perguntado_em, perguntado_em < ? AS mais_de_24h FROM meli_pergunta WHERE cliente = ? AND status = 'UNANSWERED' ORDER BY perguntado_em").all(limite, cliente),
      atrasos: db.prepare('SELECT order_id, shipment_id, item_id, prazo_despacho, dias_atraso, status FROM meli_envio_atraso WHERE cliente = ? ORDER BY prazo_despacho').all(cliente),
      full: db.prepare('SELECT item_id, inventory_id, disponivel, nao_disponivel, dias_sem_venda, idade_dias, fonte, pendente FROM meli_full_estoque WHERE cliente = ? AND dia = ? ORDER BY dias_sem_venda DESC').all(cliente, l.dia),
    },
  }
}
