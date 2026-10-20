// Anúncios do cliente com vendas, visitas e Ads num PERÍODO explícito (data da venda = dia do pedido no Mercado Livre), comparados com o período
// anterior e com o mesmo período do ano passado, e filtrados pela árvore de condições de lib/filtros.js (predicado em memória: os números do
// período são calculados, não colunas). Nunca inventa: dia sem coleta não vira zero (a cobertura é declarada), e sem conexão o painel diz isso.
import { db } from './db.js'
import { compilarPredicado } from './filtros.js'
import { coberturaPedidos } from './meli-serie.js'
import { historico } from './preco-historico.js'
import { origemCatalogo } from './catalogo.js'
import { criarCatalogo } from './catalogo-db.js'
import { visitasCobrem } from './diagnostico-conta.js'

const r2 = n => Math.round(n * 100) / 100
const catalogoDb = criarCatalogo(db)
const sku = visao => { try { const v = JSON.parse(visao || '{}'); return v.seller_custom_field || v.sku || (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name || '' } catch { return '' } }

// soma por anúncio no intervalo [de, ate]; dias fora da cobertura de pedidos não existem na série (coleta declara até onde foi)
function somasPorItem(cliente, de, ate) {
  const por = new Map()
  for (const r of db.prepare('SELECT item_id, SUM(unidades) u, SUM(receita) r, SUM(visitas) v FROM meli_serie_item WHERE cliente = ? AND dia >= ? AND dia <= ? GROUP BY item_id').all(cliente, de, ate)) por.set(r.item_id, { unidades: r.u || 0, receita: r.r || 0, visitas: r.v || 0 })
  for (const r of db.prepare('SELECT item_id, SUM(custo) c, SUM(clicks) k, SUM(prints) p, SUM(receita) ar FROM meli_ads_dia WHERE cliente = ? AND dia >= ? AND dia <= ? GROUP BY item_id').all(cliente, de, ate)) { const o = por.get(r.item_id) || { unidades: 0, receita: 0, visitas: 0 }; o.ads_custo = r.c || 0; o.ads_clicks = r.k || 0; o.ads_prints = r.p || 0; o.ads_receita = r.ar || 0; por.set(r.item_id, o) }
  return por
}
const curvas = itens => {                                  // A/B/C por faturamento acumulado no período (80% / 95%)
  const total = itens.reduce((t, i) => t + i.faturamento, 0); let acum = 0
  for (const i of [...itens].sort((a, b) => b.faturamento - a.faturamento)) { acum += i.faturamento; i.curva = !total || !i.faturamento ? 'C' : acum / total <= 0.8 ? 'A' : acum / total <= 0.95 ? 'B' : 'C' }
}
const delta = (a, b) => b > 0 ? r2((a / b - 1) * 100) : null

// Linhas de TODOS os anúncios do cliente no período (sem filtro, sem ordem): vendas, visitas, Ads, preço mudou e curva A/B/C. Núcleo de
// anunciosDoCliente e da Folha do anúncio (folha-anuncio.js) — a mesma montagem, nunca duas. per: periodo.resolvido de lib/filtros.js.
export function linhasDoPeriodo(cliente, per) {
  const cob = coberturaPedidos(cliente)
  const atual = somasPorItem(cliente, per.de, per.ate), ant = somasPorItem(cliente, per.anterior.de, per.anterior.ate), ano = somasPorItem(cliente, per.ano_anterior.de, per.ano_anterior.ate)
  // preço no período (histórico do anúncio): mudou? variação líquida do 1º "de" ao último "para" — sem histórico, 0 e null (não é "não mudou": a tela declara o início)
  const evPreco = historico.eventosAnuncio(cliente, { de: per.de, ate: per.ate, campos: ['preco'] })
  const varPreco = l => { const de = Number(l[0].de), para = l.at(-1).para; return de > 0 && para != null ? r2((para / de - 1) * 100) : null }
  const catCtx = catalogoDb.contexto(cliente)
  const itens = db.prepare('SELECT item_id, titulo, permalink, thumb, preco, preco_original, status, estoque, criado_em, logistica, visao_json, vis_de, vis_ate, catalogo FROM meli_item WHERE cliente = ?').all(cliente).map(it => {
    const s = atual.get(it.item_id) || {}, a = ant.get(it.item_id) || {}, y = ano.get(it.item_id) || {}
    // visitas só com cobertura do período INTEIRO (visitasCobrem, o critério do diagnóstico e de Mais vendidos: série desde vis_de e coletada até a véspera do fim —
    // a série é dos 200 que mais vendem + citados em tarefas; parada antes do fim inflaria a conversão): fora dela é "—" (null), nunca 0; a conversão idem
    const visitas = (x, p) => visitasCobrem(it, p.de, p.ate) ? (x.visitas || 0) : null
    const vis = visitas(s, per)
    return {
      anuncio_id: it.item_id, titulo: it.titulo, permalink: it.permalink, thumb: it.thumb, sku: sku(it.visao_json), status_anuncio: it.status, canal: 'ML', catalogo_origem: origemCatalogo({ id: it.item_id, catalogo: it.catalogo }, catCtx), logistica: it.logistica || '', preco: it.preco, preco_original: it.preco_original ?? null, estoque: it.estoque, criado_em: it.criado_em,
      vendas_unidades: s.unidades || 0, faturamento: r2(s.receita || 0), visitas: vis, conversao: vis ? r2(100 * (s.unidades || 0) / vis) : null, ads_custo: r2(s.ads_custo || 0), ads_clicks: s.ads_clicks || 0, ads_prints: s.ads_prints || 0,
      preco_mudou: evPreco.has(it.item_id) ? 1 : 0, variacao_preco_pct: evPreco.has(it.item_id) ? varPreco(evPreco.get(it.item_id)) : null,
      anterior: { vendas_unidades: a.unidades || 0, faturamento: r2(a.receita || 0), visitas: visitas(a, per.anterior) }, ano_anterior: { vendas_unidades: y.unidades || 0, faturamento: r2(y.receita || 0), visitas: visitas(y, per.ano_anterior) },
    }
  })
  curvas(itens)
  return { itens, cobertura: cob }
}

// def: filtro validado de lib/filtros.js (painel 'cliente') com periodo.resolvido; devolve itens filtrados, totais e comparações EXPLÍCITAS
export function anunciosDoCliente(cliente, def) {
  const per = def?.periodo?.resolvido
  if (!per) throw Object.assign(new Error('informe o período (preset ou datas)'), { status: 400 })
  const { itens, cobertura: cob } = linhasDoPeriodo(cliente, per)
  const passa = compilarPredicado(def)
  const filtrados = itens.filter(passa).sort((a, b) => b.faturamento - a.faturamento)
  const somaVis = (lista, pega) => lista.reduce((t, i) => t + (pega(i) ?? 0), 0)     // só os cobertos; anuncios_com_visitas declara quantos
  const tot = lista => {
    const vis = somaVis(lista, i => i.visitas), uCob = lista.reduce((t, i) => t + (i.visitas != null ? i.vendas_unidades : 0), 0)      // conversão só dos cobertos (unidades ÷ visitas dos mesmos anúncios)
    return { anuncios: lista.length, vendas_unidades: lista.reduce((t, i) => t + i.vendas_unidades, 0), faturamento: r2(lista.reduce((t, i) => t + i.faturamento, 0)), visitas: vis, anuncios_com_visitas: lista.filter(i => i.visitas != null).length, conversao: vis > 0 ? r2(100 * uCob / vis) : null, ads_custo: r2(lista.reduce((t, i) => t + i.ads_custo, 0)) }
  }
  const totais = tot(filtrados), totAnt = { faturamento: r2(filtrados.reduce((t, i) => t + i.anterior.faturamento, 0)), vendas_unidades: filtrados.reduce((t, i) => t + i.anterior.vendas_unidades, 0), visitas: somaVis(filtrados, i => i.anterior.visitas) }, totAno = { faturamento: r2(filtrados.reduce((t, i) => t + i.ano_anterior.faturamento, 0)), vendas_unidades: filtrados.reduce((t, i) => t + i.ano_anterior.vendas_unidades, 0), visitas: somaVis(filtrados, i => i.ano_anterior.visitas) }
  const cobre = x => cob && x.de >= cob.de && x.ate <= cob.ate
  return {
    cliente, periodo: { ...per, data: 'data_venda', rotulo_data: 'Data da venda (dia do pedido no Mercado Livre)' }, cobertura: cob,
    aviso: !cobre(per) ? `A coleta de pedidos cobre ${cob?.de?.split('-').reverse().join('/') || '—'}–${cob?.ate?.split('-').reverse().join('/') || '—'}: parte do período pedido não tem dado (não é zero, é não coletado).` : '',
    totais, comparacoes: {
      anterior: { ...per.anterior, ...totAnt, delta_faturamento_pct: delta(totais.faturamento, totAnt.faturamento), delta_unidades_pct: delta(totais.vendas_unidades, totAnt.vendas_unidades), coberto: cobre(per.anterior) },
      ano_anterior: { ...per.ano_anterior, ...totAno, delta_faturamento_pct: delta(totais.faturamento, totAno.faturamento), delta_unidades_pct: delta(totais.vendas_unidades, totAno.vendas_unidades), coberto: cobre(per.ano_anterior) },
    },
    total_sem_filtro: itens.length, itens: filtrados.slice(0, 500),
  }
}
