// GMV do portfólio (plataforma conectada) e quanto dele está associado ao trabalho da equipe.
// GMV = soma de (preço unitário × quantidade) dos pedidos PAGOS do canal — bruto: antes de cancelamentos,
// devoluções, tarifas e frete; não é lucro nem repasse. Só clientes COM conta conectada têm GMV medido;
// os demais aparecem como "não conectado" — nunca estimados.
import { db, hojeLocal } from './db.js'
import { carregarClientes, normNome } from './equipe.js'
import { analisarCliente, analistasDe, excluirDaAprendizagem } from './impacto-tarefas.js'
import { addDias, diasEntre, coberturaPedidos, qualidadeNoIntervalo, cfgAtrib } from './meli-serie.js'
import { equipeCfg } from './equipe.js'
import { origemCatalogo, editavelConteudo } from './catalogo.js'
import { criarCatalogo } from './catalogo-db.js'

const r2 = n => Math.round(n * 100) / 100
const catalogoDb = criarCatalogo(db)
const soma = (cliente, de, ate, campo = 'receita') => db.prepare(`SELECT COALESCE(SUM(${campo}),0) v FROM meli_serie_item WHERE cliente = ? AND dia >= ? AND dia <= ?`).get(cliente, de, ate).v

export function conectadosComDados() {
  return db.prepare("SELECT DISTINCT cliente FROM meli_serie_item WHERE cliente NOT LIKE '[Comercial] %'").all().map(r => r.cliente)
}

// parte do ganho/receita de uma tarefa que cai dentro do período (proporcional aos dias da janela medida)
function parteNoPeriodo(m, de, ate) {
  const [a, b] = m.janelas?.pos_medida || m.janelas?.pos || []
  if (!a || !m.dias_pos) return 0
  const ini = a > de ? a : de, fim = b < ate ? b : ate
  const dias = diasEntre(ini, fim) + 1
  return dias > 0 ? (m.receita_alocada || 0) * Math.min(dias, m.dias_pos) / m.dias_pos : 0
}

export function gmvPortfolio({ dias = 28, hoje = hojeLocal(), periodo = null, filtro = null } = {}) {
  // periodo (lib/filtros.js, resolvido): intervalo explícito + comparação escolhida; sem ele, os últimos N dias até ontem e os N anteriores
  const ate = periodo ? periodo.ate : addDias(hoje, -1), de = periodo ? periodo.de : addDias(ate, -(dias - 1))
  const comp = periodo ? (periodo[periodo.comparar || 'anterior'] || periodo.anterior) : null
  const anteAte = comp ? comp.ate : addDias(de, -1), anteDe = comp ? comp.de : addDias(anteAte, -(dias - 1))
  if (periodo) dias = Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / 86400000) + 1
  const excl = new Set((equipeCfg.status_cliente_excluidos || []).map(normNome))
  const todos = carregarClientes()
  const comML = todos.filter(c => c.canais.includes('ML') && !excl.has(normNome(c.status)))
  const conectados = new Set(conectadosComDados())
  const noPeriodo = (m, a, b) => { const [x, y] = m.janelas?.pos_medida || m.janelas?.pos || []; return !!x && x <= b && y >= a }

  const clientes = []
  for (const c of comML) {
    if (!conectados.has(c.cliente)) continue
    const cob = coberturaPedidos(c.cliente), qual = qualidadeNoIntervalo(c.cliente, anteDe, ate)
    const gmv = soma(c.cliente, de, ate), ant = soma(c.cliente, anteDe, anteAte)
    const an = analisarCliente(c.cliente, { hoje })
    // medida que o motor tira do aprendizado (preço mexendo junto, reversão à média) não é ganho/perda de ninguém: fica à parte em "fora_aprendizado"
    const dentro = (est, a, b, fora = false) => an.medidas.filter(m => m.estado === est && excluirDaAprendizagem(m) === fora).reduce((t, m) => t + parteNoPeriodo(m, a, b), 0)
    const ganho = dentro('melhorou', de, ate), perda = dentro('piorou', de, ate), lanc = dentro('lancamento', de, ate)
    const ganhoA = dentro('melhorou', anteDe, anteAte), perdaA = dentro('piorou', anteDe, anteAte), lancA = dentro('lancamento', anteDe, anteAte)
    const fora = dentro('melhorou', de, ate, true) + dentro('piorou', de, ate, true)
    const analistas = new Map()
    for (const m of an.medidas) {
      if (!noPeriodo(m, de, ate)) continue                                  // só tarefas cuja janela de medição toca o período
      const parte = ['melhorou', 'piorou', 'lancamento'].includes(m.estado) ? parteNoPeriodo(m, de, ate) : 0
      const nomes = analistasDe(m.analista); if (!nomes.length) nomes.push('(sem responsável)')
      for (const nome of nomes) {                                          // cada pessoa do card; o valor é dividido entre elas
        const k = normNome(nome), a = analistas.get(k) || { nome, tarefas: 0, ganho: 0, perda: 0, lancamentos: 0, fora_aprendizado: 0 }
        a.tarefas++
        if (m.estado !== 'lancamento' && excluirDaAprendizagem(m)) a.fora_aprendizado += parte / nomes.length
        else if (m.estado === 'melhorou') a.ganho += parte / nomes.length; else if (m.estado === 'piorou') a.perda += parte / nomes.length; else if (m.estado === 'lancamento') a.lancamentos += parte / nomes.length
        analistas.set(k, a)
      }
    }
    clientes.push({
      cliente: c.cliente, consultor: c.consultores?.ML || c.principal || '(consultor a definir)', squad: c.squadPrincipal || '',
      gmv: r2(gmv), anterior: r2(ant), delta_pct: ant > 0 ? r2((gmv / ant - 1) * 100) : null,
      unidades: soma(c.cliente, de, ate, 'unidades'),
      // histórico confiável = todos os dias dos dois períodos coletados, nenhum truncado, e coleta de hoje ou ontem
      cobertura_ok: qual.completo && cob.ate >= addDias(hoje, -2), qualidade: { faltam: qual.faltam.length, truncados: qual.truncados, ultimo_dia: cob.ate }, cobertura: cob,
      ganho: r2(ganho), perda: r2(perda), lancamentos: r2(lanc), fora_aprendizado: r2(fora), delta_assoc: r2((ganho + perda + lanc) - (ganhoA + perdaA + lancA)),
      tarefas_medidas: an.resumo.melhorou + an.resumo.piorou + an.resumo.sem_efeito + an.resumo.lancamento, tarefas_total: an.resumo.mensuraveis,
      sem_estimativa: an.medidas.filter(m => ['melhorou', 'piorou'].includes(m.estado) && m.receita_estimavel === false).length,
      analistas: [...analistas.values()].map(a => ({ ...a, ganho: r2(a.ganho), perda: r2(a.perda), lancamentos: r2(a.lancamentos), fora_aprendizado: r2(a.fora_aprendizado) })).sort((x, y) => (y.ganho + y.lancamentos) - (x.ganho + x.lancamentos)),
    })
  }

  // filtro avançado (lib/filtros.js) sobre as linhas calculadas: cliente, consultor, analista (qualquer analista do cliente), faturamento (gmv), variação
  const antesDoFiltro = clientes.length
  if (filtro) { const sel = clientes.filter(c => filtro({ cliente: c.cliente, consultor: c.consultor, canal: 'ML', faturamento: c.gmv, variacao_pct: c.delta_pct, analista: c.analistas.map(a => a.nome).join(', ') })); clientes.length = 0; clientes.push(...sel) }
  const agrega = (lista, chaveFn, extra) => {
    const g = new Map()
    for (const c of lista) { const k = chaveFn(c); (g.get(k) || g.set(k, []).get(k)).push(c) }
    return [...g.entries()].map(([nome, cs]) => {
      const gmv = cs.reduce((t, c) => t + c.gmv, 0), ant = cs.reduce((t, c) => t + c.anterior, 0)
      const ganho = cs.reduce((t, c) => t + c.ganho, 0), perda = cs.reduce((t, c) => t + c.perda, 0), lanc = cs.reduce((t, c) => t + c.lancamentos, 0)
      return { nome, clientes: cs.length, gmv: r2(gmv), anterior: r2(ant), delta_pct: ant > 0 ? r2((gmv / ant - 1) * 100) : null,
        ganho: r2(ganho), perda: r2(perda), lancamentos: r2(lanc), liquido: r2(ganho + perda), pct_associado: gmv > 0 ? r2(100 * (ganho + perda) / gmv) : null, ...(extra ? extra(cs) : {}), lista: cs }
    }).sort((a, b) => b.gmv - a.gmv)
  }
  const carteira = new Map()
  for (const c of comML) { const k = c.consultores?.ML || c.principal || '(consultor a definir)'; carteira.set(k, (carteira.get(k) || 0) + 1) }
  const consultores = agrega(clientes, c => c.consultor, cs => ({ clientes_na_carteira: carteira.get(cs[0].consultor) || cs.length }))
  for (const [nome, n] of carteira) if (!consultores.some(c => c.nome === nome)) consultores.push({ nome, clientes: 0, clientes_na_carteira: n, gmv: 0, anterior: 0, delta_pct: null, ganho: 0, perda: 0, lancamentos: 0, liquido: 0, pct_associado: null, lista: [] })

  const mapaA = new Map()
  for (const c of clientes) for (const a of c.analistas) {
    const k = normNome(a.nome), x = mapaA.get(k) || { nome: a.nome, tarefas: 0, ganho: 0, perda: 0, lancamentos: 0, fora_aprendizado: 0, clientes: [] }
    x.tarefas += a.tarefas; x.ganho += a.ganho; x.perda += a.perda; x.lancamentos += a.lancamentos; x.fora_aprendizado += a.fora_aprendizado
    x.clientes.push({ cliente: c.cliente, consultor: c.consultor, tarefas: a.tarefas, ganho: a.ganho, lancamentos: a.lancamentos, perda: a.perda })
    mapaA.set(k, x)
  }
  const analistas = [...mapaA.values()].map(a => ({ ...a, ganho: r2(a.ganho), perda: r2(a.perda), lancamentos: r2(a.lancamentos), fora_aprendizado: r2(a.fora_aprendizado) })).sort((x, y) => (y.ganho + y.lancamentos) - (x.ganho + x.lancamentos))

  const gmv = clientes.reduce((t, c) => t + c.gmv, 0), ant = clientes.reduce((t, c) => t + c.anterior, 0)
  const ganho = clientes.reduce((t, c) => t + c.ganho, 0), perda = clientes.reduce((t, c) => t + c.perda, 0), lanc = clientes.reduce((t, c) => t + c.lancamentos, 0)
  const deltaAssoc = clientes.reduce((t, c) => t + c.delta_assoc, 0)
  const forasDaCentral = [...conectados].filter(n => !todos.some(c => c.cliente === n))
  return {
    periodo: { de, ate, dias, anterior: { de: anteDe, ate: anteAte } },
    cobertura: { clientes_ml: comML.length, conectados: antesDoFiltro, filtrados: clientes.length, sem_conexao: comML.length - clientes.length, historico_incompleto: clientes.filter(c => !c.cobertura_ok).length, fora_da_central: forasDaCentral },
    total: {
      gmv: r2(gmv), anterior: r2(ant), delta_pct: ant > 0 ? r2((gmv / ant - 1) * 100) : null, variacao: r2(gmv - ant),
      ganho: r2(ganho), perda: r2(perda), liquido: r2(ganho + perda), lancamentos: r2(lanc),
      fora_aprendizado: r2(clientes.reduce((t, c) => t + c.fora_aprendizado, 0)),      // R$ de medidas fora do aprendizado (preço junto, reversão): de ninguém
      associado: r2(ganho + perda), pct_associado: gmv > 0 ? r2(100 * (ganho + perda) / gmv) : null,
      // a VARIAÇÃO do GMV é comparada com a VARIAÇÃO do que está associado ao trabalho (nível atual − nível do período anterior)
      variacao_associada: r2(deltaAssoc), restante: r2((gmv - ant) - deltaAssoc),
    },
    consultores, analistas, clientes, atualizado_em: db.prepare('SELECT MAX(coletado_em) m FROM meli_coleta_dia').get().m,
    metodo: { janela_dias: cfgAtrib.janela_dias, limiar_efeito_pct: cfgAtrib.limiar_efeito_pct },
  }
}

// ── mais vendidos com a visão do comprador (dados já coletados — sem chamada à API) ──
export function maisVendidos(cliente, { dias = 28, top = 12, hoje = hojeLocal() } = {}) {
  const ate = addDias(hoje, -1), de = addDias(ate, -(dias - 1)), anteAte = addDias(de, -1), anteDe = addDias(anteAte, -(dias - 1))
  const linhas = db.prepare(`SELECT i.*, 
      COALESCE((SELECT SUM(unidades) FROM meli_serie_item s WHERE s.cliente = i.cliente AND s.item_id = i.item_id AND s.dia BETWEEN ? AND ?),0) u,
      COALESCE((SELECT SUM(receita)  FROM meli_serie_item s WHERE s.cliente = i.cliente AND s.item_id = i.item_id AND s.dia BETWEEN ? AND ?),0) r,
      COALESCE((SELECT SUM(visitas)  FROM meli_serie_item s WHERE s.cliente = i.cliente AND s.item_id = i.item_id AND s.dia BETWEEN ? AND ?),0) v,
      COALESCE((SELECT SUM(unidades) FROM meli_serie_item s WHERE s.cliente = i.cliente AND s.item_id = i.item_id AND s.dia BETWEEN ? AND ?),0) u0,
      COALESCE((SELECT SUM(visitas)  FROM meli_serie_item s WHERE s.cliente = i.cliente AND s.item_id = i.item_id AND s.dia BETWEEN ? AND ?),0) v0
    FROM meli_item i WHERE i.cliente = ? ORDER BY r DESC LIMIT ?`).all(de, ate, de, ate, de, ate, anteDe, anteAte, anteDe, anteAte, cliente, top)
  const catCtx = catalogoDb.contexto(cliente)
  return linhas.filter(l => l.u > 0).map(l => {
    const visao = l.visao_json ? JSON.parse(l.visao_json) : null
    const temVis = !!l.vis_de && l.vis_de <= de && l.vis_ate >= addDias(ate, -1)      // cobertura de visitas cobre o período inteiro
    let conv = temVis && l.v > 0 ? r2(100 * l.u / l.v) : null
    const diasEst = l.u > 0 && l.estoque != null ? Math.round(l.estoque / (l.u / dias)) : null
    const flags = []
    // conversão acima de 100% é impossível por anúncio: as visitas estão registradas em outro anúncio do mesmo produto (catálogo/variação)
    if (conv != null && conv > 100) { flags.push({ tom: 'atencao', texto: `só ${l.v} visita(s) registradas para ${l.u} venda(s) — as visitas devem estar em outro anúncio do mesmo produto (catálogo ou variação); conversão não calculada` }); conv = null }
    if (conv != null && conv < 1) flags.push({ tom: 'ruim', texto: `conversão ${conv}% — abaixo de 1% indica problema no anúncio ou no preço` })
    if (temVis && l.v0 > 0 && l.v < l.v0 * 0.8) flags.push({ tom: 'ruim', texto: `visitas ${Math.round((l.v / l.v0 - 1) * 100)}% vs período anterior` })
    if (l.u0 > 0 && l.u < l.u0 * 0.8) flags.push({ tom: 'ruim', texto: `vendas ${Math.round((l.u / l.u0 - 1) * 100)}% vs período anterior` })
    if (diasEst != null && diasEst < 10) flags.push({ tom: 'ruim', texto: `estoque para ~${diasEst} dia(s) no ritmo atual` })
    const ptw = visao?.catalogo
    if (ptw?.status === 'competing' && ptw.preco_para_ganhar != null && l.preco != null && ptw.preco_para_ganhar < l.preco - 0.01) flags.push({ tom: 'atencao', texto: `catálogo: preço para ganhar R$ ${ptw.preco_para_ganhar.toFixed(2)} (o seu: R$ ${l.preco.toFixed(2)})` })
    const freteBoost = ptw?.boosts?.some(b => b.id === 'free_shipping' && b.status === 'boosted')
    if (!l.frete_gratis && !freteBoost) flags.push({ tom: 'atencao', texto: 'sem frete grátis' })
    if (l.fotos != null && l.fotos < 5 && editavelConteudo({ id: l.item_id, catalogo: l.catalogo }, catCtx)) flags.push({ tom: 'atencao', texto: `só ${l.fotos} foto(s) no anúncio` })   // catálogo de terceiros: foto não é do vendedor
    if (visao?.avaliacoes?.nota != null && visao.avaliacoes.nota < 4.3) flags.push({ tom: 'atencao', texto: `nota ${visao.avaliacoes.nota} em ${visao.avaliacoes.total} avaliações` })
    return {
      item_id: l.item_id, titulo: l.titulo, permalink: l.permalink, thumb: l.thumb, preco: l.preco, estoque: l.estoque, fotos: l.fotos,
      frete_gratis: !!l.frete_gratis, catalogo: !!l.catalogo, catalogo_origem: origemCatalogo({ id: l.item_id, catalogo: l.catalogo }, catCtx), status: l.status,
      unidades: l.u, receita: r2(l.r), visitas: temVis ? l.v : null, conversao: conv,
      unidades_anterior: l.u0, visitas_anterior: temVis ? l.v0 : null,
      avaliacoes: visao?.avaliacoes || null, catalogo_info: ptw || null, flags,
    }
  })
}
