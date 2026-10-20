// Folha do anúncio (Resumo do cliente): UMA linha por anúncio com os tópicos marcados — anúncios (ofertas e promoções) · Ads · Full · métricas — e,
// com os quatro marcados, a leitura cruzada de cada anúncio (estado-anuncio.leituraAnuncio). Só LÊ e COMPÕE o que os motores já produzem, nenhum
// motor novo: linhasDoPeriodo (anuncios.js), diagnosticarConta (28 d: benchmark, cobertura, sugestão de Full), promo_oferta/promo_coleta, of_job,
// ações anuncio_* do plano, custosDosAnuncios e o change-log (eventosAnuncio). Em lote: ~10 consultas por pedido, sem N+1; a leitura só para a página.
// Honestidade por bloco: dado não coletado é null (a tela mostra "—"), nunca 0; cada bloco diz quando foi coletado e o que não cobre.
// JSON paginado (50) e CSV saem da MESMA função (csv: true devolve a lista inteira, teto de 5.000). Mensagens de erro nunca repetem o valor recebido.
import { db, hojeLocal, agora } from './db.js'
import { linhasDoPeriodo } from './anuncios.js'
import { diagnosticarConta, sugestaoFull } from './diagnostico-conta.js'
import { calcularFull, LIM_RISCO_DIAS, MIN_UN_RISCO } from './full-metricas.js'
import { historico, diaLocal } from './preco-historico.js'
import { vinculosCusto } from './custos-db.js'
import { lerAcoes } from './plano-cliente.js'
import { ESTADOS as ESTADOS_JOB } from './ofertas.js'
import { compilarPredicado, chips as chipsFiltro, ROTULOS } from './filtros.js'
import { addDias } from './meli-serie.js'
import { leituraAnuncio, cruzaFronteira, ROTULO_ADS, SEM_PROMOCAO } from './estado-anuncio.js'
import { coletaLigada } from './promocoes-coleta.js'
import { coletaPromocoesDoCliente } from './perfil-cliente.js'

export const BLOCOS = ['anuncios', 'ads', 'full', 'metricas']
export const POR_PAGINA = 50, TETO_CSV = 5000
const JANELA_EVENTOS_DIAS = 30
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const r2 = n => Math.round(n * 100) / 100
const br = iso => iso ? diaLocal(iso).split('-').reverse().join('/') : '—'   // carimbo UTC (concluida_em, atualizado_em) vira o dia do Brasil, como a hora
const hhmm = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h') }
const delta = (a, b) => b > 0 ? r2((a / b - 1) * 100) : null
const pctDesconto = (preco, original) => Number(preco) > 0 && Number(original) > 0 && Number(preco) < Number(original) ? Math.round((1 - Number(preco) / Number(original)) * 100) : null
const mediana = xs => { const v = xs.filter(x => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : r2((v[v.length / 2 - 1] + v[v.length / 2]) / 2)) : null }
const ehProspecto = c => /^\[Comercial\] /.test(String(c || ''))

// ordens disponíveis: cada uma só vale com o bloco dela marcado; null (—) vai sempre para o fim; desempate pelo MLB (paginação estável)
const ORDENS = {
  faturamento: { bloco: null, chave: r => r.metricas.faturamento, dir: -1 },               // padrão: vale com qualquer tópico (é a ordem base da folha, como em "Anúncios no período")
  variacao: { bloco: 'metricas', chave: r => r.metricas.delta_faturamento_pct, dir: 1 },            // piores variações primeiro
  conversao: { bloco: 'metricas', chave: r => r.metricas.conversao, dir: -1 },
  desconto: { bloco: 'anuncios', chave: r => r.anuncios.promocao.desconto_pct, dir: -1 },
  ads_custo: { bloco: 'ads', chave: r => r.ads?.custo ?? null, dir: -1 },
  roas: { bloco: 'ads', chave: r => r.ads?.custo > 0 ? r.ads.roas : null, dir: 1 },               // crescente, só quem tem gasto (os demais no fim)
  cobertura: { bloco: 'full', chave: r => r.full.cobertura_dias, dir: 1 },
}
export const ORDENS_FOLHA = Object.fromEntries(Object.entries(ORDENS).map(([k, o]) => [k, o.bloco]))

// campos do painel 'folha' (lib/filtros.js) lidos da linha composta; bool vira 1/0 (null = não coletado: "—" nunca casa)
const bool = v => v == null ? null : v ? 1 : 0
const ACESSO = {
  curva: r => r.curva, em_promocao: r => r.anuncios.promocao.estado == null ? null : bool(r.anuncios.promocao.estado === 'started'),
  com_ads: r => r.ads ? bool(r.ads.custo > 0) : null, roas: r => r.ads?.roas ?? null,
  no_full: r => bool(r.full.no_full), risco_ruptura: r => r.full.no_full == null ? null : bool(r.full.risco_ruptura), tem_acao_plano: r => bool(r.acoes.length > 0),
  faturamento: r => r.metricas.faturamento, variacao_pct: r => r.metricas.delta_faturamento_pct, conversao: r => r.metricas.conversao,
}

function validarBlocos(blocos) {
  const lista = [].concat(blocos ?? []).map(b => String(b ?? '').trim()).filter(Boolean)
  if (lista.some(b => !BLOCOS.includes(b))) throw erro('tópico desconhecido')
  const canon = BLOCOS.filter(b => lista.includes(b))
  if (!canon.length) throw erro('marque ao menos um tópico')
  return canon
}
function validarPagina(pagina, total) {
  const cru = String(pagina ?? '1').trim()
  if (!/^\d{1,6}$/.test(cru) || Number(cru) < 1) throw erro('página fora da faixa')
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (Number(cru) > paginas) throw erro('página fora da faixa')
  return { pagina: Number(cru), paginas }
}
// "desde": dia do último evento do campo que cruzou a fronteira na janela de 30 d; null = nenhuma mudança registrada na janela (o estado vem de antes dela
// ou de antes do início do histórico — a ressalva do bloco diz desde quando o histórico existe). Não olha o estado no início da janela (estadoEm):
// o evento registrado é fato mesmo quando o histórico começou depois do início da janela.
const desdeDe = (evs, campo) => [...evs].reverse().find(e => e.campo === campo && cruzaFronteira(e))?.dia ?? null

// ── a folha ───────────────────────────────────────────────────────────────────
// def: filtro validado do painel 'folha' (periodo.resolvido obrigatório). blocos: subconjunto de BLOCOS. ordem: chave de ORDENS. pagina: inteiro ≥ 1 (texto ok).
export function folhaDoCliente(cliente, def, { blocos, ordem = 'faturamento', pagina = 1, csv = false, hoje = hojeLocal() } = {}) {
  const t0 = Date.now()
  if (typeof cliente !== 'string' || !cliente.trim()) throw erro('informe "cliente"')
  if (ehProspecto(cliente)) throw erro('prospect do Comercial não é cliente: sem folha do anúncio')
  const marcados = validarBlocos(blocos)
  const ord = ORDENS[ordem]
  if (!ord || !Object.hasOwn(ORDENS, ordem)) throw erro('ordenação indisponível')
  if (ord.bloco && !marcados.includes(ord.bloco)) throw erro('ordenação indisponível para os tópicos marcados')
  const per = def?.periodo?.resolvido
  if (!per) throw erro('informe o período (preset ou datas)')
  const leituraCruzada = marcados.length === BLOCOS.length

  // 1) linhas do período (vendas, visitas, preço mudou, curva) + 2) diagnóstico de 28 d (uma vez por pedido)
  const { itens: linhas, cobertura: cob } = linhasDoPeriodo(cliente, per)
  const diag = diagnosticarConta(cliente, { hoje })
  const diagPor = new Map((diag.itens || []).map(i => [i.id, i])), bench = diag.benchmark || null
  const j28 = diag.periodo || { de: addDias(addDias(hoje, -1), -27), ate: addDias(hoje, -1) }
  // 3) Ads por anúncio (28 d atual × anterior, foto da última coleta)
  const ads = { atual: new Map(), anterior: new Map() }
  let adsColetadoEm = ''
  for (const a of db.prepare('SELECT item_id, periodo, de, ate, status, prints, clicks, custo, receita, unidades, coletado_em FROM meli_ads_item WHERE cliente = ?').all(cliente)) { ads[a.periodo]?.set(a.item_id, a); if (a.coletado_em > adsColetadoEm) adsColetadoEm = a.coletado_em }
  const adsColetado = ads.atual.size > 0
  const janelaAds = adsColetado ? (a => ({ de: a.de, ate: a.ate }))(ads.atual.values().next().value) : null
  // 4) promoções: carimbo da coleta + ofertas vivas e candidatas por anúncio
  const coleta = db.prepare("SELECT estado, concluida_em FROM promo_coleta WHERE cliente = ?").get(cliente) || null
  const promoColetada = !!coleta?.concluida_em
  const ofertasPor = new Map()
  if (promoColetada) for (const o of db.prepare("SELECT item_id, tipo, nome, status, preco, preco_original, fim FROM promo_oferta WHERE cliente = ? AND status IN ('started','candidate','pending')").all(cliente)) (ofertasPor.get(o.item_id) || ofertasPor.set(o.item_id, []).get(o.item_id)).push(o)
  // 5) Ofertas Estratégicas: o último job (não cancelado) por anúncio
  const jobPor = new Map()
  for (const j of db.prepare("SELECT a.anuncio_id, j.id job_id, j.estado, j.publicado_em, j.atualizado_em FROM of_anuncio a JOIN of_job j ON j.anuncio_id = a.id AND j.cliente = a.cliente WHERE a.cliente = ? AND a.canal = 'ML' AND j.estado <> 'cancelado' ORDER BY j.atualizado_em").all(cliente)) jobPor.set(j.anuncio_id, j)
  // 6) ações anuncio_* abertas do plano (sempre: o filtro "com ação no plano" precisa delas); 7) custo por anúncio em lote; 8) change-log da janela (30 d)
  const acoesPor = new Map()
  for (const a of lerAcoes({ clientes: [cliente], status: ['proposta', 'aprovada', 'distribuida'] })) if (a.regra.startsWith('anuncio_') && a.item_id)
    (acoesPor.get(a.item_id) || acoesPor.set(a.item_id, []).get(a.item_id)).push({ id: a.id, regra: a.regra.replace(/^anuncio_/, ''), titulo: a.titulo, status: a.status, p: a.dados?.prioridade?.p ?? null, score: a.score, problema: a.dados?.problema || '', hipotese: a.dados?.hipotese || '' })
  for (const l of acoesPor.values()) l.sort((a, b) => b.score - a.score)
  const custoPor = vinculosCusto.custosDosAnuncios(cliente, linhas.map(l => ({ item_id: l.anuncio_id })))
  const deJanela = addDias(hoje, -JANELA_EVENTOS_DIAS), de28 = addDias(hoje, -28)
  const eventosPor = historico.eventosAnuncio(cliente, { de: deJanela }), inicioHist = historico.inicioHistorico(cliente)
  const ultimaLeitura = db.prepare('SELECT MAX(atualizado_em) m FROM meli_item WHERE cliente = ?').get(cliente)?.m || null
  const logisticaColetada = linhas.some(l => l.logistica)

  // ── linha composta (todos os blocos, para filtrar e ordenar; a saída projeta só os marcados) ──
  const compor = l => {
    const d = diagPor.get(l.anuncio_id) || null, evs = eventosPor.get(l.anuncio_id) || []
    const vivas = (ofertasPor.get(l.anuncio_id) || []).filter(o => o.status === 'started').sort((a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity))
    const estadoPromo = !promoColetada ? null : vivas.length ? 'started' : SEM_PROMOCAO
    const v = vivas[0]
    const promocao = { estado: estadoPromo, tipo: v ? String(v.tipo || 'PROMOCAO').toUpperCase() : null, nome: v?.nome || null, desconto_pct: v ? pctDesconto(v.preco, v.preco_original) : null, preco: v?.preco ?? null, preco_original: v?.preco_original ?? null, fim: v?.fim ? String(v.fim).slice(0, 10) : null,
      desde: estadoPromo == null ? null : desdeDe(evs, 'promocao') }
    const job = jobPor.get(l.anuncio_id) || null
    const a = ads.atual.get(l.anuncio_id), a0 = ads.anterior.get(l.anuncio_id)
    const blocoAds = !adsColetado ? null : a
      ? { status: a.status || 'idle', status_rotulo: ROTULO_ADS[a.status] || a.status || '—', custo: r2(a.custo), receita: r2(a.receita), roas: a.custo > 0 ? r2(a.receita / a.custo) : null, acos: a.receita > 0 ? r2(100 * a.custo / a.receita) : null,
          ctr: a.prints ? r2(100 * a.clicks / a.prints) : null, unidades: a.unidades, custo_var_pct: a0?.custo > 0 ? r2((a.custo / a0.custo - 1) * 100) : null, desde: desdeDe(evs, 'ads') }
      : { status: 'sem_anuncio', status_rotulo: ROTULO_ADS.sem_anuncio, custo: null, receita: null, roas: null, acos: null, ctr: null, unidades: null, custo_var_pct: null, desde: desdeDe(evs, 'ads') }
    const noFull = l.logistica ? l.logistica === 'fulfillment' : null
    const risco = noFull === true && d?.cobertura != null && d.cobertura < LIM_RISCO_DIAS && d.u >= MIN_UN_RISCO   // risco do bloco Full = só anúncio no Full (mesma régua de calcularFull)
    const sug = noFull && d?.cobertura != null && d.cobertura < LIM_RISCO_DIAS ? sugestaoFull(d) : null
    const full = { no_full: noFull, logistica: l.logistica || null, logistica_rotulo: l.logistica ? (ROTULOS.logistica[l.logistica] || l.logistica) : null, estoque: l.estoque ?? null, cobertura_dias: d?.cobertura ?? null, risco_ruptura: noFull == null ? null : risco,
      sugestao: sug ? { ...sug.cenarios, premissa: sug.premissa } : null, desde: noFull == null ? null : desdeDe(evs, 'logistica') }
    const metricas = { unidades: l.vendas_unidades, faturamento: l.faturamento, delta_faturamento_pct: delta(l.faturamento, l.anterior.faturamento), visitas: l.visitas, conversao: l.conversao, preco_realizado: l.vendas_unidades > 0 ? r2(l.faturamento / l.vendas_unidades) : null, curva: l.curva }
    const custo = custoPor.get(l.anuncio_id)
    return {
      anuncio_id: l.anuncio_id, titulo: l.titulo, permalink: l.permalink, thumb: l.thumb, sku: l.sku, status_anuncio: l.status_anuncio, preco: l.preco, estoque: l.estoque, curva: l.curva, catalogo_origem: l.catalogo_origem,
      anuncios: { promocao, candidatas: promoColetada ? (ofertasPor.get(l.anuncio_id) || []).filter(o => o.status !== 'started').length : null,
        oferta: job ? { job_id: job.job_id, estado: job.estado, estado_rotulo: ESTADOS_JOB[job.estado]?.rotulo || job.estado, otimizado_em: job.atualizado_em || null, publicado_em: job.publicado_em || null } : null,
        preco: l.preco, preco_original: l.preco_original, mudancas_preco_28d: evs.filter(e => e.campo === 'preco' && e.dia >= de28).length, custo: custo ? { custo: custo.custo, origem: custo.origem } : null },
      ads: blocoAds, full, metricas, acoes: acoesPor.get(l.anuncio_id) || [], diag: d, eventos: evs, fat_ant: l.anterior.faturamento,   // os 4 últimos são internos (filtro, ordem, totais, leitura): a saída projeta só os blocos
    }
  }
  const todas = linhas.map(compor)
  const passa = compilarPredicado(def, (r, campo) => ACESSO[campo] ? ACESSO[campo](r) : null)
  const cmp = (x, y) => { const a = ord.chave(x), b = ord.chave(y); if (a == null && b == null) return x.anuncio_id.localeCompare(y.anuncio_id); if (a == null) return 1; if (b == null) return -1; return (a - b) * ord.dir || x.anuncio_id.localeCompare(y.anuncio_id) }
  const filtradas = todas.filter(passa).sort(cmp)
  const total = filtradas.length
  const { pagina: pag, paginas } = csv ? { pagina: 1, paginas: 1 } : validarPagina(pagina, total)
  const fatia = csv ? filtradas.slice(0, TETO_CSV) : filtradas.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA)

  // ── totais por bloco (sobre TODAS as linhas filtradas, não só a página; no máximo 4 por bloco; null = não coletado) ──
  const soma = (lista, f) => lista.reduce((t, r) => t + (f(r) || 0), 0)
  const totais = {}
  if (marcados.includes('anuncios')) totais.anuncios = { em_promocao: promoColetada ? filtradas.filter(r => r.anuncios.promocao.estado === 'started').length : null, candidatas: promoColetada ? filtradas.filter(r => r.anuncios.candidatas > 0).length : null,
    com_oferta_ativa: filtradas.filter(r => r.anuncios.oferta).length, desconto_mediano_pct: promoColetada ? mediana(filtradas.map(r => r.anuncios.promocao.desconto_pct)) : null }
  if (marcados.includes('ads')) { const c = soma(filtradas, r => r.ads?.custo), rec = soma(filtradas, r => r.ads?.receita); totais.ads = adsColetado ? { custo: r2(c), receita: r2(rec), roas: c > 0 ? r2(rec / c) : null, anunciando: filtradas.filter(r => r.ads?.status === 'active').length } : { custo: null, receita: null, roas: null, anunciando: null } }
  if (marcados.includes('full')) {
    const ids = new Set(filtradas.map(r => r.anuncio_id)), cf = logisticaColetada ? calcularFull((diag.itens || []).filter(i => ids.has(i.id)), new Map(linhas.map(l => [l.anuncio_id, l.logistica]))) : { disponivel: false }
    totais.full = { no_full: logisticaColetada ? filtradas.filter(r => r.full.no_full).length : null, share_receita_pct: cf.share_pct ?? null, cobertura_dias: cf.cobertura_dias ?? null, risco_ruptura: logisticaColetada ? filtradas.filter(r => r.full.risco_ruptura).length : null }
  }
  if (marcados.includes('metricas')) {
    const vis = soma(filtradas, r => r.metricas.visitas), uCob = soma(filtradas, r => r.metricas.visitas != null ? r.metricas.unidades : 0), fat = soma(filtradas, r => r.metricas.faturamento)   // conversão só dos cobertos
    totais.metricas = { unidades: soma(filtradas, r => r.metricas.unidades), faturamento: r2(fat), delta_faturamento_pct: delta(fat, soma(filtradas, r => r.fat_ant)), conversao: vis > 0 ? r2(100 * uCob / vis) : null }
  }

  // ── honestidade por bloco: data da coleta e o que não cobre ──
  const ligada = coletaLigada(coletaPromocoesDoCliente(cliente))
  const honestidade = {}
  if (marcados.includes('anuncios')) honestidade.anuncios = { disponivel: promoColetada, coletado_em: coleta?.concluida_em || null, ressalva: promoColetada
    ? `Promoções lidas em ${br(coleta.concluida_em)} às ${hhmm(coleta.concluida_em)} (uma leitura por coleta; o estado é o da última). Candidatas = campanhas em que o Mercado Livre aceita o anúncio. Ofertas = último job de Ofertas Estratégicas por anúncio. Histórico de entrada e saída de promoção desde ${inicioHist ? br(inicioHist) : 'a 1ª coleta de promoções depois da implantação'}.`
    : `Promoções não coletadas para este cliente${ligada ? ' (a próxima coleta da madrugada, ou o botão em Promoções, preenche)' : ' — coleta desligada para este cliente; ligue em Cliente → Configurar'}: promoção, desconto e candidatas aparecem como —.` }
  if (marcados.includes('ads')) honestidade.ads = { disponivel: adsColetado, coletado_em: adsColetadoEm || null, janela: janelaAds, ressalva: adsColetado
    ? `Ads dos últimos 28 dias (${br(janelaAds.de)}–${br(janelaAds.ate)}), não do período escolhido; a leitura por dia ainda não grava. Orçamento e campanhas não são coletados. Histórico de Ads ligado/desligado desde ${inicioHist ? br(inicioHist) : 'a 1ª coleta de Ads depois da implantação'}.`
    : 'Ads não coletado nesta conta (sem Product Ads ou sem permissão de leitura): aparece —.' }
  if (marcados.includes('full')) { const semLog = linhas.filter(l => !l.logistica).length; honestidade.full = { disponivel: logisticaColetada, coletado_em: ultimaLeitura, ressalva: logisticaColetada
    ? `Full = logística fulfillment na última leitura do anúncio${ultimaLeitura ? ` (${br(ultimaLeitura)})` : ''}; dias de estoque = estoque ÷ ritmo de venda de 28 dias, só para anúncios com venda ou Ads em 56 dias (os demais aparecem como —).${semLog ? ` Logística não coletada em ${semLog} anúncio(s).` : ''} Data de entrada no Full só a partir de ${inicioHist ? br(inicioHist) : 'da 1ª coleta depois da implantação'}.`
    : 'Logística não coletada para esta conta: Full aparece como —.' } }
  if (marcados.includes('metricas')) { const cobre = cob?.de && cob?.ate && per.de >= cob.de && per.ate <= cob.ate, comVis = filtradas.filter(r => r.metricas.visitas != null).length; honestidade.metricas = { disponivel: true, coletado_em: cob?.ate || null,
    ressalva: `Visitas só dos 200 anúncios que mais vendem e dos citados em tarefas (${comVis} de ${total} anúncios com visitas no período); os demais aparecem como —, e a conversão da conta usa só esses.`,
    aviso_cobertura: cobre ? '' : `A coleta de pedidos cobre ${br(cob?.de)}–${br(cob?.ate)}: parte do período pedido não tem dado (não é zero, é não coletado).` } }

  // ── saída: só os blocos marcados; leitura só com os 4 ──
  const projetar = r => {
    const o = { anuncio_id: r.anuncio_id, titulo: r.titulo, permalink: r.permalink, thumb: r.thumb, sku: r.sku, status_anuncio: r.status_anuncio, preco: r.preco, estoque: r.estoque, curva: r.curva, catalogo_origem: r.catalogo_origem }
    for (const b of marcados) o[b] = r[b]
    if (leituraCruzada) o.leitura = leituraAnuncio(r.diag, { promo: r.anuncios.promocao.estado == null ? null : { ...r.anuncios.promocao, candidatas: r.anuncios.candidatas }, oferta: r.anuncios.oferta, ads: r.ads, full: r.full, acoes: r.acoes, eventos: r.eventos, bench, hoje })
    return o
  }
  return {
    disponivel: true, cliente, blocos: marcados, leitura_cruzada: leituraCruzada,
    periodo: { de: per.de, ate: per.ate, rotulo: per.rotulo, anterior: { de: per.anterior.de, ate: per.anterior.ate, rotulo: per.anterior.rotulo }, data: 'data_venda' }, janela_28d: { de: j28.de, ate: j28.ate },
    pagina: pag, paginas, por_pagina: csv ? fatia.length : POR_PAGINA, total, total_sem_filtro: todas.length, ordem, csv_limitado: csv && total > TETO_CSV,
    honestidade, totais, itens: fatia.map(projetar), filtro: { chips: chipsFiltro(def) }, gerado_em: agora(), ms: Date.now() - t0,
  }
}

// ── CSV = a tela: as colunas dos blocos marcados (e a leitura achatada com os 4); ';', vírgula decimal, BOM; nulo sai vazio, nunca 0; defesa contra fórmula ──
const cel = v => { let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(x) && !/^-\d+(,\d+)?$/.test(x)) x = "'" + x; return `"${x}"` }   // número negativo não é fórmula: fica número na planilha
const num = v => v == null ? '' : String(v).replace('.', ',')
const COLS = {
  base: [['Anúncio (MLB)', r => r.anuncio_id], ['Título', r => r.titulo], ['Link', r => r.permalink], ['SKU', r => r.sku], ['Status', r => r.status_anuncio], ['Preço (R$)', r => num(r.preco)], ['Estoque', r => num(r.estoque)], ['Curva', r => r.curva]],
  anuncios: [['Promoção', r => r.anuncios.promocao.estado == null ? '' : r.anuncios.promocao.estado === 'started' ? 'em promoção' : 'sem promoção'], ['Tipo da promoção', r => r.anuncios.promocao.tipo], ['Desconto (%)', r => num(r.anuncios.promocao.desconto_pct)], ['Preço na promoção (R$)', r => num(r.anuncios.promocao.preco)],
    ['Fim da promoção', r => r.anuncios.promocao.fim], ['Em promoção desde', r => r.anuncios.promocao.desde], ['Campanhas candidatas', r => num(r.anuncios.candidatas)], ['Ofertas (estado)', r => r.anuncios.oferta?.estado_rotulo], ['Ofertas (publicada em)', r => r.anuncios.oferta?.publicado_em],
    ['Preço original (R$)', r => num(r.anuncios.preco_original)], ['Mudanças de preço (28 d)', r => num(r.anuncios.mudancas_preco_28d)], ['Custo (R$)', r => num(r.anuncios.custo?.custo)], ['Origem do custo', r => r.anuncios.custo?.origem]],
  ads: [['Ads (status)', r => r.ads?.status_rotulo], ['Ads custo 28 d (R$)', r => num(r.ads?.custo)], ['Ads receita 28 d (R$)', r => num(r.ads?.receita)], ['ROAS', r => num(r.ads?.roas)], ['ACOS (%)', r => num(r.ads?.acos)], ['CTR (%)', r => num(r.ads?.ctr)], ['Unidades por Ads', r => num(r.ads?.unidades)], ['Variação do custo (%)', r => num(r.ads?.custo_var_pct)], ['Ads desde', r => r.ads?.desde]],
  full: [['No Full', r => r.full.no_full == null ? '' : r.full.no_full ? 'sim' : 'não'], ['Logística', r => r.full.logistica_rotulo], ['Dias de estoque', r => num(r.full.cobertura_dias)], ['Risco de ruptura', r => r.full.risco_ruptura == null ? '' : r.full.risco_ruptura ? 'sim' : 'não'], ['Sugestão de envio (base)', r => num(r.full.sugestao?.base)], ['No Full desde', r => r.full.desde]],
  metricas: [['Unidades', r => num(r.metricas.unidades)], ['Faturamento (R$)', r => num(r.metricas.faturamento)], ['Variação vs anterior (%)', r => num(r.metricas.delta_faturamento_pct)], ['Visitas', r => num(r.metricas.visitas)], ['Conversão (%)', r => num(r.metricas.conversao)], ['Preço realizado (R$)', r => num(r.metricas.preco_realizado)]],
  leitura: [['Leitura: fatos', r => r.leitura.fatos.join(' | ')], ['Leitura: hipóteses', r => r.leitura.hipoteses.join(' | ')], ['Leitura: ações do plano', r => r.leitura.acoes.map(a => `${a.titulo} (${[a.p, a.status].filter(Boolean).join(', ')})`).join(' | ')], ['O que mudou (30 d)', r => r.leitura.eventos.map(e => `${br(e.dia)} ${e.texto}`).join(' | ')]],
}
export function csvDaFolha(r) {
  const cols = [...COLS.base, ...r.blocos.flatMap(b => COLS[b]), ...(r.leitura_cruzada ? COLS.leitura : [])]
  const cab = `Folha do anúncio · ${r.cliente} · ${r.periodo.rotulo} · tópicos: ${r.blocos.join(', ')} · ${Object.values(r.honestidade).map(h => h.ressalva).join(' ')}`
  return '﻿' + [cel(cab), cols.map(([n]) => cel(n)).join(';'), ...r.itens.map(it => cols.map(([, f]) => cel(f(it))).join(';'))].join('\r\n')
}
