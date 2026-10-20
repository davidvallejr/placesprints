// V3 F9 — fiação com banco dos 8 relatórios (núcleo PURO em relatorios-ciclo.js). baseDoCliente lê SÓ o que já existe: diagnóstico (Arquiteto/Oráculo), produto por trás do
// anúncio + previsão de compras por produto (produtosDoCliente), financeiro por pedido F4 (lucro-real), saúde gravada, linhas de pedido, notas, razão de estoque e pedidos
// ao fornecedor. Nada aqui chama o Mercado Livre; nada muda plano, aviso ou texto ao cliente. Escrita local só em estoque_mov / compra_fornecedor (prévia por padrão,
// confirmar === true grava, `por` validado). Isolamento: toda consulta por cliente = ?.
import { createHash } from 'node:crypto'
import { db, hojeLocal, agora } from './db.js'
import { algoritmo, diagnosticarConta } from './diagnostico-conta.js'
import { produtosDoCliente } from './produto-estoque-real.js'
import { ehChaveProduto } from './produto-estoque.js'
import { comprasDoCliente } from './gatilhos-real.js'
import { financeiroDoCliente, dreDoCliente } from './lucro-real.js'
import { resumoFin, agregar } from './lucro.js'
import { priorEfetivo } from './calibracao.js'
import { recebiveisDeNotas } from './nota-fiscal.js'
import { addDias } from './meli-serie.js'
import { NOMES, montarRelatorio, ESTADOS_COMPRA, TRANSICOES_COMPRA, blocosTerca } from './relatorios-ciclo.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const reais = v => Math.round((v || 0) * 100)
// local da venda pelo depósito da linha (order_items[].stock): loja preenchida = depósito do vendedor; só nó = centro do ML (Full). Premissa rotulada no relatório.
export const localDaLinha = l => (l.deposito_store ? 'proprio' : l.deposito_node ? 'full' : 'desconhecido')

// ── base única dos 8 relatórios (cache curto: o diagnóstico é caro) ─────────────────────────────────────────────────────────────────────
const cache = new Map()        // ponytail: cache por processo de 2 min; invalidado ao gravar movimento/compra
export function baseDoCliente(cliente, { hoje = hojeLocal(), semCache = false } = {}) {
  const k = `${cliente}|${hoje}`, c = cache.get(k)
  if (!semCache && c && Date.now() - c.em < 120_000) return c.B
  const B = montarBase(cliente, hoje); cache.set(k, { em: Date.now(), B }); return B
}
const invalidar = cliente => { for (const k of cache.keys()) if (k.startsWith(cliente + '|')) cache.delete(k) }

function montarBase(cliente, hoje) {
  const diag = diagnosticarConta(cliente, { hoje })
  if (!diag?.disponivel) return { cliente, hoje, disponivel: false, motivo: diag?.motivo || 'diagnóstico indisponível' }
  const { de, ate } = diag.periodo, mes = hoje.slice(0, 7)
  const prod = produtosDoCliente(cliente, diag, { cfg: algoritmo })
  const porId = new Map(diag.itens.map(i => [String(i.id), i]))
  const fin = financeiroDoCliente(cliente, { hoje, de, ate }), minimo = fin.minimo
  const serie = (a, b) => Math.round(db.prepare('SELECT COALESCE(SUM(receita), 0) r FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, a, b).r * 100)
  const coleta = (a, b) => db.prepare('SELECT COUNT(*) n FROM meli_coleta_dia WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, a, b).n

  // linhas pagas da janela com o local do depósito (Full × próprio) — logística e razão
  const linhas = db.prepare("SELECT order_id, item_id, dia, quantidade, deposito_node, deposito_store FROM meli_pedido_item WHERE cliente = ? AND status = 'paid' AND dia BETWEEN ? AND ?").all(cliente, de, ate)
  const itemProduto = new Map()   // ponytail: produtosDoCliente devolve até 20 anúncios por produto; acima disso o anúncio fica fora do recorte por produto (a conta inteira continua certa)
  for (const p of prod.produtos || []) for (const a of p.anuncios) itemProduto.set(a.id, p.chave)
  const local = { full: { un: 0, pedidos: 0 }, proprio: { un: 0, pedidos: 0 }, desconhecido: { un: 0, pedidos: 0 }, dias: fin.dias.com_linhas }, pedSet = { full: new Set(), proprio: new Set(), desconhecido: new Set() }
  const saida = new Map()
  for (const l of linhas) {
    const lc = localDaLinha(l); local[lc].un += l.quantidade; pedSet[lc].add(l.order_id)
    const pk = itemProduto.get(l.item_id); if (!pk) continue
    const s = saida.get(pk) || saida.set(pk, { full: 0, proprio: 0, desconhecido: 0, ped: new Set() }).get(pk); s[lc] += l.quantidade; if (lc === 'proprio') s.ped.add(l.order_id)
  }
  for (const x of Object.keys(pedSet)) local[x].pedidos = pedSet[x].size

  const finP = fin.por(l => itemProduto.get(l.item_id) ?? `item:${l.item_id}`)
  const produtos = (prod.produtos || []).map(p => {
    const its = p.anuncios.map(a => porId.get(a.id)).filter(Boolean), rep = [...its].sort((a, b) => (b.u || 0) - (a.u || 0))[0] || {}
    const somaLocal = l => p.efs.filter(e => e.local === l).reduce((t, e) => (t == null || e.estoque == null ? null : t + e.estoque), 0)
    const u14 = its.reduce((t, i) => t + (i.u14 || 0), 0), receita_c = reais(p.receita_28d)
    const comAds = its.filter(i => i.ads), s = saida.get(p.chave)
    return { chave: p.chave, nome: p.nome, curva: p.curva, situacao: p.situacao, estoque: p.estoque_total ?? null, local: { full: somaLocal('full'), proprio: somaLocal('proprio') },
      u: p.u_28d || 0, u14, receita_c, receita14_c: p.u_28d > 0 ? Math.round(receita_c * u14 / p.u_28d) : null,
      custo_unit_c: p.custo_unitario != null ? reais(p.custo_unitario) : null, lead: { dias: rep.lead_time_dias ?? algoritmo.limiares.lead_time_reposicao_dias, fonte: rep.lead_time_fonte || 'premissa' },
      pedir: p.pedir && Number.isInteger(p.pedir.base) ? p.pedir : null, fin: p.financeiro || resumoFin(finP.get(p.chave)),
      ads: comAds.length ? { custo_c: comAds.reduce((t, i) => t + reais(i.ads.custo), 0), receita_c: comAds.reduce((t, i) => t + reais(i.ads.receita), 0) } : null,
      saida: s ? { full: s.full, proprio: s.proprio, desconhecido: s.desconhecido, pedidos_proprio: s.ped.size } : null }
  })

  // mês corrente (até ontem): série, linhas, financeiro com os dias sem linhas no denominador, Ads só com cobertura do mês inteiro, compras registradas
  const ini = `${mes}-01`, fimMes = addDias(`${addDias(ini, 32).slice(0, 7)}-01`, -1), ontem = addDias(hoje, -1), ateM = fimMes < ontem ? fimMes : ontem
  const dias_total = Number(fimMes.slice(8, 10)), dias_fechados = ateM >= ini ? Number(ateM.slice(8, 10)) : 0
  let mesFin = null, dias_linhas = 0
  if (dias_fechados) { const fm = financeiroDoCliente(cliente, { hoje, de: ini, ate: ateM }); mesFin = resumoFin(fm.por(() => 'conta').get('conta')); dias_linhas = fm.dias.com_linhas }
  const cf = db.prepare('SELECT * FROM compra_fornecedor WHERE cliente = ? ORDER BY criado_em').all(cliente)
  const doMes = cf.filter(c => ['pedida', 'recebida'].includes(c.estado) && (c.pedida_em || '').slice(0, 7) === mes)
  const compras = !cf.length ? { c: null, m: 'nenhuma compra registrada no Place Sprints (compras fora do sistema não são vistas)' }
    : doMes.some(c => !Number.isInteger(c.valor_c)) ? { c: null, m: 'compra do mês sem valor registrado' } : { c: doMes.reduce((t, c) => t + c.valor_c, 0), m: '' }
  const ads_c = adsDoMes(cliente, ini, ateM)

  // saúde: a última leitura COM valor de cada sinal (a última linha pode ter falhado inteira)
  const sTaxa = db.prepare('SELECT dia, taxa_atraso FROM meli_conta_saude WHERE cliente = ? AND taxa_atraso IS NOT NULL ORDER BY dia DESC LIMIT 1').get(cliente)
  const sAtr = db.prepare('SELECT dia, atrasos FROM meli_conta_saude WHERE cliente = ? AND atrasos IS NOT NULL ORDER BY dia DESC LIMIT 1').get(cliente)
  const sUlt = db.prepare('SELECT pendente_json FROM meli_conta_saude WHERE cliente = ? ORDER BY dia DESC LIMIT 1').get(cliente)
  let pend = {}; try { pend = JSON.parse(sUlt?.pendente_json || '{}') } catch { pend = {} }
  const fretes = db.prepare(`SELECT custo_vendedor_c FROM meli_envio_custo WHERE cliente = ? AND custo_vendedor_c IS NOT NULL AND envio_id IN
    (SELECT DISTINCT envio_id FROM meli_pedido_item WHERE cliente = ? AND dia BETWEEN ? AND ? AND envio_id != '')`).all(cliente, cliente, de, ate)
  const adsJ = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(custo), 0) custo, COALESCE(SUM(receita), 0) receita FROM meli_ads_item WHERE cliente = ? AND periodo = 'atual' AND de = ? AND ate = ?").get(cliente, de, ate)
  let notas = []; try { notas = db.prepare('SELECT estado, total_c, order_ids, pago_em FROM nota_fiscal WHERE cliente = ?').all(cliente) } catch { notas = [] }
  const comprasA = comprasDoCliente(cliente, { diag })
  const lead = db.prepare("SELECT dias, fonte FROM lead_time_cliente WHERE cliente = ? AND chave = '*'").get(cliente) || null
  const movs = db.prepare('SELECT * FROM estoque_mov WHERE cliente = ? ORDER BY fato_em, id').all(cliente)
  const comContagem = new Set(movs.filter(m => m.origem === 'contagem').map(m => m.produto))
  const vendas_razao = comContagem.size ? db.prepare("SELECT item_id, dia, quantidade, deposito_node, deposito_store FROM meli_pedido_item WHERE cliente = ? AND status = 'paid' AND dia >= ?").all(cliente, addDias(hoje, -120))
    .map(l => ({ produto: itemProduto.get(l.item_id) ?? `item:${l.item_id}`, dia: l.dia, quantidade: l.quantidade, local: localDaLinha(l) })).filter(v => comContagem.has(v.produto)) : []

  // lucro por pedido (últimos 30) e por anúncio (30 de maior receita)
  const porPedido = agregar(fin.fins, f => f.order_id, { minimo }), diaPed = new Map(fin.fins.map(f => [f.order_id, f.dia]))
  const pedidos = [...porPedido.values()].sort((a, b) => (diaPed.get(b.chave) || '').localeCompare(diaPed.get(a.chave) || '') || b.chave.localeCompare(a.chave)).slice(0, 30)
    .map(a => ({ order_id: a.chave, dia: diaPed.get(a.chave), receita_c: a.receita_c, lucro_c: a.lucro_c, motivo: a.motivo }))
  const finI = fin.por(l => l.item_id)
  const anuncios = diag.itens.filter(i => (i.u || 0) > 0).sort((a, b) => b.r - a.r).slice(0, 30)
    .map(i => ({ id: i.id, titulo: String(i.titulo || '').slice(0, 60), receita_c: reais(i.r), receita14_c: i.u > 0 ? Math.round(reais(i.r) * (i.u14 || 0) / i.u) : null, estoque: i.estoque ?? null, fin: resumoFin(finI.get(i.id)) }))

  const fr = algoritmo.priors_efeito?.ads_escalar?.fator_roas_marginal || [0.5, 0.7, 0.9]
  return {
    cliente, hoje, mes, disponivel: true,
    janela: { de, ate, dias: 28, dias_coleta: coleta(de, ate) },
    cfg: { C: algoritmo.compras, L: algoritmo.limiares, minimo, fator_roas_marginal: [fr[0], fr[1]] },
    chances: Object.fromEntries(['estoque_ruptura', 'ads_escalar', 'margem_negativa', 'envio_atrasado'].map(r => [r, priorEfetivo(r)])),
    conta: {
      receita28_c: serie(de, ate), receita14_c: serie(addDias(ate, -13), ate), fin: resumoFin(fin.por(() => 'conta').get('conta')),
      ads: adsJ.n ? { custo_c: reais(adsJ.custo), receita_c: reais(adsJ.receita) } : null,
      mes: { ini, ate: ateM, dias_total, dias_fechados, dias_coleta: dias_fechados ? coleta(ini, ateM) : 0, receita_c: dias_fechados ? serie(ini, ateM) : null, fin: mesFin, dias_linhas, ads_c, compras_c: compras.c, compras_motivo: compras.m },
      dre: dreDoCliente(cliente, mes, { hoje }),
      saude: { taxa_atraso: sTaxa?.taxa_atraso ?? null, dia_taxa: sTaxa?.dia || '', atrasos: sAtr?.atrasos ?? null, dia_atrasos: sAtr?.dia || '', atrasos_motivo: pend.atrasos ? `pendente: ${pend.atrasos}` : '' },
      envios: fin.envios, frete_medio_c: fretes.length ? Math.round(fretes.reduce((t, r) => t + r.custo_vendedor_c, 0) / fretes.length) : null,
      local, recebiveis: notas.length ? recebiveisDeNotas(notas, { hoje }) : null,
      parado: comprasA?.parado || [], parado_lido: !!db.prepare('SELECT 1 FROM meli_full_estoque WHERE cliente = ? AND dia >= ? LIMIT 1').get(cliente, addDias(hoje, -7)),
      lead_conta: lead,
    },
    produtos, compras_forn: cf, movs, vendas_razao, pedidos, anuncios, premissas_fin: fin.premissas,
  }
}

// Ads do mês: só quando a série diária (meli_ads_dia) cobre o mês inteiro de TODOS os anúncios com Ads na janela; anúncio sem gasto com Ads coletado = 0 de fato
function adsDoMes(cliente, ini, ate) {
  if (ate < ini) return null
  const comAds = db.prepare("SELECT DISTINCT item_id FROM meli_ads_item WHERE cliente = ? AND custo > 0").all(cliente).map(r => r.item_id)
  if (!db.prepare('SELECT 1 FROM meli_ads_item WHERE cliente = ? LIMIT 1').get(cliente)) return null
  if (!comAds.length) return 0
  const cob = new Set(db.prepare('SELECT item_id FROM meli_ads_cobertura WHERE cliente = ? AND de <= ? AND ate >= ?').all(cliente, ini, ate).map(r => r.item_id))
  if (!comAds.every(i => cob.has(i))) return null
  return Math.round(db.prepare('SELECT COALESCE(SUM(custo), 0) c FROM meli_ads_dia WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, ini, ate).c * 100)
}

export const relatorioDoCliente = (cliente, nome, opts = {}) => montarRelatorio(nome, baseDoCliente(cliente, opts))
export const todosDoCliente = (cliente, opts = {}) => { const B = baseDoCliente(cliente, opts); return Object.fromEntries(NOMES.map(n => [n, montarRelatorio(n, B)])) }
// blocos curtos do relatório de terça (chave algoritmo.relatorios_ciclo.blocos_terca_ligado, NASCE DESLIGADA: sem ela nem a base é calculada)
export function blocosTercaDoCliente(cliente, { ligado = algoritmo.relatorios_ciclo?.blocos_terca_ligado === true, hoje = hojeLocal() } = {}) {
  if (!ligado) return []
  const B = baseDoCliente(cliente, { hoje })
  return blocosTerca(Object.fromEntries(['lucro', 'caixa', 'ciclo_compras', 'ciclo_estoque'].map(n => [n, montarRelatorio(n, B)])), { ligado })
}

// ── escrita local: razão de estoque e pedidos ao fornecedor (prévia por padrão; confirmar === true grava) ───────────────────────────────────
const DATA = /^\d{4}-\d{2}-\d{2}$/
const LOCAIS = ['proprio', 'full', 'transito_full'], ORIGENS_MANUAIS = ['compra', 'devolucao', 'ajuste', 'envio_full', 'contagem']
const sha = s => createHash('sha256').update(String(s)).digest('hex')
const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max
export function criarErp({ agora: relogio = agora, hoje: hojeFn = hojeLocal, validarPor = () => '' } = {}) {
  const autoriza = (por, cliente) => { const p = validarPor(String(por ?? ''), cliente); if (!p) throw erro('sem permissão para registrar (líder, consultor ou o CS deste cliente)', 403); return p }
  const insMov = db.prepare(`INSERT INTO estoque_mov (cliente, produto, local, origem, ref, quantidade, custo_unit_c, fato_em, por, registrado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  const jaMov = db.prepare('SELECT 1 FROM estoque_mov WHERE cliente = ? AND origem = ? AND ref = ?')

  function registrarMov({ cliente, produto, local, origem, quantidade, custo_unit_c = null, fato_em, por, confirmar } = {}) {
    if (!ehChaveProduto(produto)) throw erro('produto inválido')
    if (!ORIGENS_MANUAIS.includes(origem)) throw erro('origem inválida')
    if (!LOCAIS.includes(local) || (origem === 'envio_full' && local !== 'proprio')) throw erro('local inválido (envio ao Full sai do próprio)')
    if (origem === 'contagem' ? !inteiro(quantidade, 0, 1e6) : !inteiro(quantidade, -1e6, 1e6) || quantidade === 0) throw erro('quantidade inválida')
    if (['compra', 'envio_full'].includes(origem) && quantidade < 0) throw erro('quantidade inválida')
    if (custo_unit_c != null && !inteiro(custo_unit_c, 0, 1e9)) throw erro('custo inválido (centavos)')
    const dia = fato_em ?? hojeFn(); if (!DATA.test(String(dia)) || dia > hojeFn()) throw erro('data inválida (AAAA-MM-DD, até hoje)')
    const base = origem === 'contagem' ? `cont:${produto}:${local}:${dia}` : `${origem}:${dia}:${sha([produto, local, quantidade, custo_unit_c].join('|')).slice(0, 16)}`
    // envio ao Full = saída do próprio + entrada no Full (premissa: entrada confirmada; o trânsito fica para a leitura do Full)
    const movs = origem === 'envio_full' ? [{ local: 'proprio', q: -quantidade, ref: base + ':saida' }, { local: 'full', q: quantidade, ref: base + ':entrada' }] : [{ local, q: quantidade, ref: base }]
    const repetido = movs.some(m => jaMov.get(cliente, origem, m.ref))
    if (confirmar !== true) return { ok: true, previa: true, repetido, movimentos: movs.map(m => ({ produto, local: m.local, origem, quantidade: m.q, fato_em: dia })) }
    if (repetido) throw erro('movimento já registrado', 409)
    const p = autoriza(por, cliente), em = relogio()
    db.transaction(() => { for (const m of movs) insMov.run(cliente, produto, m.local, origem, m.ref, m.q, custo_unit_c, dia, p, em) })()
    invalidar(cliente)
    return { ok: true, previa: false, movimentos: movs.length }
  }

  const lerCompra = (cliente, id) => db.prepare('SELECT * FROM compra_fornecedor WHERE cliente = ? AND id = ?').get(cliente, id)
  function salvarCompra({ cliente, id = '', produto, estado, fornecedor = '', qtd_sugerida_cons = null, qtd_sugerida_base = null, pedir_ate = '', qtd_pedida = null, valor_c = null,
    pedida_em = '', prevista_em = '', qtd_recebida = null, recebida_em = '', por, confirmar } = {}) {
    if (!ESTADOS_COMPRA.includes(estado)) throw erro('estado inválido')
    const antes = id ? lerCompra(cliente, String(id)) : null
    if (id && !antes) throw erro('pedido não encontrado', 404)
    if (!antes && !['sugerida', 'pedida'].includes(estado)) throw erro('pedido novo nasce sugerido ou pedido')
    if (antes && !TRANSICOES_COMPRA[antes.estado].includes(estado)) throw erro('mudança de estado não permitida', 409)
    const prodK = antes?.produto ?? produto; if (!ehChaveProduto(prodK)) throw erro('produto inválido')
    const h = hojeFn(), data = (v, nome) => { if (v && (!DATA.test(String(v)) || (nome !== 'prevista_em' && v > h))) throw erro(`${nome} inválida`); return v || '' }
    const d = { ...(antes || {}), cliente, produto: prodK, estado, fornecedor: String(fornecedor || antes?.fornecedor || '').slice(0, 80) }
    if (estado === 'sugerida') {
      if (!inteiro(qtd_sugerida_cons, 0, 1e6) || !inteiro(qtd_sugerida_base, 0, 1e6) || qtd_sugerida_base < qtd_sugerida_cons) throw erro('quantidade sugerida inválida')
      Object.assign(d, { qtd_sugerida_cons, qtd_sugerida_base, pedir_ate: data(pedir_ate, 'prevista_em') })
    }
    if (estado === 'pedida') {
      if (!inteiro(qtd_pedida, 1, 1e6)) throw erro('quantidade pedida inválida')
      if (valor_c != null && !inteiro(valor_c, 0, 1e11)) throw erro('valor inválido (centavos)')
      Object.assign(d, { qtd_pedida, valor_c, pedida_em: data(pedida_em, 'pedida_em') || h, prevista_em: data(prevista_em, 'prevista_em') })
    }
    if (estado === 'recebida') {
      if (!inteiro(qtd_recebida, 1, 1e6)) throw erro('quantidade recebida inválida')
      const r = data(recebida_em, 'recebida_em') || h; if (antes.pedida_em && r < antes.pedida_em) throw erro('recebida antes de pedida')
      Object.assign(d, { qtd_recebida, recebida_em: r })
    }
    const novoId = antes?.id || 'CF-' + sha([cliente, prodK, relogio(), Math.random()].join('|')).slice(0, 10)
    if (confirmar !== true) return { ok: true, previa: true, antes: antes || null, depois: { ...d, id: novoId } }
    const p = autoriza(por, cliente), em = relogio()
    db.transaction(() => {
      if (!antes) db.prepare(`INSERT INTO compra_fornecedor (cliente, id, produto, fornecedor, estado, qtd_sugerida_cons, qtd_sugerida_base, pedir_ate, qtd_pedida, valor_c, pedida_em, prevista_em, por, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(cliente, novoId, prodK, d.fornecedor, estado, d.qtd_sugerida_cons ?? null, d.qtd_sugerida_base ?? null, d.pedir_ate || '', d.qtd_pedida ?? null, d.valor_c ?? null, d.pedida_em || '', d.prevista_em || '', p, em, em)
      else db.prepare(`UPDATE compra_fornecedor SET estado = ?, fornecedor = ?, qtd_pedida = ?, valor_c = ?, pedida_em = ?, prevista_em = ?, qtd_recebida = ?, recebida_em = ?, por = ?, atualizado_em = ?
        WHERE cliente = ? AND id = ? AND estado = ?`).run(estado, d.fornecedor, d.qtd_pedida ?? null, d.valor_c ?? null, d.pedida_em || '', d.prevista_em || '', d.qtd_recebida ?? null, d.recebida_em || '', p, em, cliente, novoId, antes.estado)
      // recebida → entrada no razão (local próprio; custo unitário = valor ÷ quantidade pedida, quando há valor)
      if (estado === 'recebida') insMov.run(cliente, prodK, 'proprio', 'compra', novoId, qtd_recebida, Number.isInteger(d.valor_c) && d.qtd_pedida ? Math.round(d.valor_c / d.qtd_pedida) : null, d.recebida_em, p, em)
    })()
    invalidar(cliente)
    return { ok: true, previa: false, id: novoId, estado }
  }
  const listarCompras = cliente => db.prepare('SELECT id, produto, fornecedor, estado, qtd_sugerida_cons, qtd_sugerida_base, pedir_ate, qtd_pedida, valor_c, pedida_em, prevista_em, qtd_recebida, recebida_em, atualizado_em FROM compra_fornecedor WHERE cliente = ? ORDER BY atualizado_em DESC').all(cliente)
  const listarMovs = (cliente, { limite = 200 } = {}) => db.prepare('SELECT id, produto, local, origem, quantidade, custo_unit_c, fato_em, por, registrado_em FROM estoque_mov WHERE cliente = ? ORDER BY id DESC LIMIT ?').all(cliente, limite)
  return { registrarMov, salvarCompra, listarCompras, listarMovs }
}
