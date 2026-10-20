// Monitoramento diário das contas MERCADO LIVRE — mesma estrutura e mesmas regras da skill de
// monitoramento das contas Amazon (janelas, alertas, 3 blocos, consolidado, honestidade dos dados),
// com a lógica do Mercado Livre. Diferença de método: aqui a coleta é pela API OFICIAL das contas
// conectadas (série diária já coletada pelo Place Sprints + chamadas ao vivo só para reputação,
// perguntas e reclamações) — nada de raspar tela. Dia não coletado vira lacuna declarada, nunca zero.
import { db, hojeLocal } from './db.js'
import { chamar, relatorioAds } from './meli-api.js'
import { idDoVendedor, statusConexao, listarConexoes } from './meli-contas.js'
import { carregarClientes } from './equipe.js'

export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const r2 = n => Math.round(n * 100) / 100
export const pct = (a, b) => (b ? r2((a - b) / b * 100) : null)

// ── janelas (idênticas à skill Amazon) ──────────────────────────────────────
// Semana fechada: D-9 a D-3 × D-16 a D-10 (pedido pago ainda muda de status e a visita do ML chega com atraso).
// Mês até hoje: 1..D × 1..D do mês anterior, mais a versão 1..D-1 (D é parcial).
export function janelasMonitoramento(D) {
  const [a, m, d] = D.split('-').map(Number)
  const pm = m === 1 ? 12 : m - 1, pa = m === 1 ? a - 1 : a
  const ultimoAnt = new Date(pa, pm, 0).getDate()
  const mm = String(m).padStart(2, '0'), pmm = String(pm).padStart(2, '0')
  const dAnt = Math.min(d, ultimoAnt)
  const j = {
    semana_atual: { de: addDias(D, -9), ate: addDias(D, -3) },
    semana_anterior: { de: addDias(D, -16), ate: addDias(D, -10) },
    mes_atual: { de: `${a}-${mm}-01`, ate: D },
    mes_anterior: { de: `${pa}-${pmm}-01`, ate: `${pa}-${pmm}-${String(dAnt).padStart(2, '0')}` },
    ressalvas: [],
  }
  if (d > ultimoAnt) j.ressalvas.push(`o mês anterior tem só ${ultimoAnt} dias: comparação até ${ultimoAnt}/${pmm}`)
  if (d > 1) {
    j.mes_atual_d1 = { de: `${a}-${mm}-01`, ate: addDias(D, -1) }
    j.mes_anterior_d1 = { de: `${pa}-${pmm}-01`, ate: `${pa}-${pmm}-${String(Math.min(d - 1, ultimoAnt)).padStart(2, '0')}` }
  }
  j.ressalvas.push(`os dias ${addDias(D, -2).slice(8)} a ${D.slice(8)} do mês corrente ainda não estão assentados e o dia ${D.slice(8)} é parcial`)
  return j
}

const diasDe = ({ de, ate }) => { const out = []; for (let x = de; x <= ate; x = addDias(x, 1)) out.push(x); return out }

// ── vendas e tráfego de uma janela (banco local) ────────────────────────────
export function agregado(cliente, jan) {
  const esperados = diasDe(jan)
  const col = db.prepare('SELECT dia, pedidos, truncado FROM meli_coleta_dia WHERE cliente = ? AND dia BETWEEN ? AND ?').all(cliente, jan.de, jan.ate)
  const coletados = new Set(col.map(c => c.dia))
  const s = db.prepare('SELECT COALESCE(SUM(receita),0) r, COALESCE(SUM(unidades),0) u, COALESCE(SUM(visitas),0) v FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, jan.de, jan.ate)
  const pedidos = col.reduce((t, c) => t + c.pedidos, 0)
  // anúncios ATIVOS sem série de visitas cobrindo a janela → visitas (e conversão) parciais, declarado
  const semVisitas = db.prepare(`SELECT COUNT(*) n FROM meli_item WHERE cliente = ? AND status = 'active' AND (vis_de = '' OR vis_de > ? OR vis_ate < ?)`).get(cliente, jan.de, jan.ate).n
  return {
    de: jan.de, ate: jan.ate, faturamento: r2(s.r), unidades: s.u, pedidos, visitas: s.v,
    conversao: s.v ? r2(pedidos / s.v * 100) : null, ticket: pedidos ? r2(s.r / pedidos) : null,
    dias_faltando: esperados.filter(x => !coletados.has(x)), dias_truncados: col.filter(c => c.truncado).map(c => c.dia),
    anuncios_ativos_sem_visitas: semVisitas,
  }
}

export const porDia = (cliente, { de, ate }) => db.prepare(`SELECT c.dia, c.pedidos, COALESCE(SUM(s.receita),0) faturamento, COALESCE(SUM(s.unidades),0) unidades, COALESCE(SUM(s.visitas),0) visitas
  FROM meli_coleta_dia c LEFT JOIN meli_serie_item s ON s.cliente = c.cliente AND s.dia = c.dia
  WHERE c.cliente = ? AND c.dia BETWEEN ? AND ? GROUP BY c.dia ORDER BY c.dia`).all(cliente, de, ate).map(x => ({ ...x, faturamento: r2(x.faturamento) }))

// ── produtos (top 10 por faturamento, atual × anterior) ─────────────────────
function itensDaJanela(cliente, { de, ate }) {
  return db.prepare(`SELECT s.item_id, SUM(s.receita) receita, SUM(s.unidades) unidades, SUM(s.visitas) visitas,
      i.titulo, i.status, i.estoque, i.catalogo, i.visao_json, i.permalink, i.atualizado_em
    FROM meli_serie_item s LEFT JOIN meli_item i ON i.cliente = s.cliente AND i.item_id = s.item_id
    WHERE s.cliente = ? AND s.dia BETWEEN ? AND ? GROUP BY s.item_id HAVING SUM(s.receita) > 0 OR SUM(s.unidades) > 0
    ORDER BY receita DESC`).all(cliente, de, ate).map(x => {
    let cat = null
    try { cat = JSON.parse(x.visao_json || '{}').catalogo || null } catch { /* sem visão */ }
    return { item_id: x.item_id, titulo: x.titulo || '(título não sincronizado)', status: x.status || '?', estoque: x.estoque, catalogo: !!x.catalogo,
      catalogo_status: cat?.status || null, preco_para_ganhar: cat?.preco_para_ganhar ?? null,
      receita: r2(x.receita), unidades: x.unidades, visitas: x.visitas, permalink: x.permalink, item_atualizado_em: x.atualizado_em }
  })
}

// ── saúde da conta (AO VIVO na API: reputação, perguntas, reclamações) ──────
async function saude(cliente) {
  const id = idDoVendedor(cliente), out = { lacunas: [] }
  const u = await chamar(cliente, `/users/${id}`, { permitirFalha: true })
  if (u._erro) out.lacunas.push(`reputação indisponível (${u.status})`)
  else {
    const rep = u.seller_reputation || {}, met = rep.metrics || {}
    out.reputacao = {
      nivel: rep.level_id || null, medalha: rep.power_seller_status || null,
      vendas_periodo: met.sales?.completed ?? null, periodo: met.sales?.period || null,
      reclamacoes: met.claims ? { taxa: r2((met.claims.rate || 0) * 100), qtd: met.claims.value } : null,
      atrasos: met.delayed_handling_time ? { taxa: r2((met.delayed_handling_time.rate || 0) * 100), qtd: met.delayed_handling_time.value } : null,
      cancelamentos: met.cancellations ? { taxa: r2((met.cancellations.rate || 0) * 100), qtd: met.cancellations.value } : null,
    }
  }
  const q = await chamar(cliente, `/questions/search?seller_id=${id}&status=UNANSWERED&limit=50&api_version=4`, { permitirFalha: true })
  if (q._erro) out.lacunas.push(`perguntas indisponíveis (${q.status})`)
  else {
    const lista = q.questions || []
    const limite24 = Date.now() - 24 * 3600e3
    out.perguntas = { sem_resposta: q.total ?? lista.length, ha_mais_de_24h: lista.filter(p => p.date_created && Date.parse(p.date_created) < limite24).length, amostra_limitada: (q.total ?? 0) > lista.length }
  }
  const c = await chamar(cliente, `/post-purchase/v2/claims/search?${new URLSearchParams({ player_id: String(id), player_role: 'respondent', limit: '50' })}`, { permitirFalha: true })
  if (c._erro) out.lacunas.push(`reclamações indisponíveis (${c.status})`)
  else {
    const abertas = (c.data || c.results || []).filter(x => x.status === 'opened')
    out.reclamacoes = { abertas: abertas.length, em_mediacao: abertas.filter(x => x.stage === 'dispute').length, amostra_50: true }
  }
  return out
}

// ── uma conta ───────────────────────────────────────────────────────────────
export async function monitorarConta(cliente, { hoje = hojeLocal(), comAds = true, tetoAcos = null } = {}) {
  const con = statusConexao(cliente)
  if (!con) return { cliente, coletada: false, motivo: 'conta do Mercado Livre não conectada ao Place Sprints' }
  if (con.erro) return { cliente, coletada: false, motivo: `conexão com erro: ${String(con.erro).slice(0, 120)} — reconectar pelo botão no Notion` }
  const J = janelasMonitoramento(hoje)
  const ag = {}
  for (const k of ['semana_atual', 'semana_anterior', 'mes_atual', 'mes_anterior', 'mes_atual_d1', 'mes_anterior_d1']) if (J[k]) ag[k] = agregado(cliente, J[k])

  const itensAtual = itensDaJanela(cliente, J.semana_atual), itensAnt = itensDaJanela(cliente, J.semana_anterior)
  const top = itensAtual.slice(0, 10), topAnt = itensAnt.slice(0, 10)
  const antPorId = new Map(itensAnt.map(i => [i.item_id, i]))
  const sairamDoTop = topAnt.filter(i => !top.some(t => t.item_id === i.item_id)).map(i => ({ ...i, receita_atual: itensAtual.find(x => x.item_id === i.item_id)?.receita || 0 }))

  // estoque × venda: todo anúncio que vendeu na semana atual ou anterior
  const vendeu = new Map([...itensAnt, ...itensAtual].map(i => [i.item_id, i]))
  const estoque = [...vendeu.values()].map(i => {
    const atual = itensAtual.find(x => x.item_id === i.item_id)
    const vendaDia = atual ? atual.unidades / 7 : 0
    const cobertura = vendaDia > 0 && i.estoque != null ? r2(i.estoque / vendaDia) : null
    return { item_id: i.item_id, titulo: i.titulo, status: i.status, estoque: i.estoque, unidades_semana: atual?.unidades || 0, unidades_semana_ant: antPorId.get(i.item_id)?.unidades || 0, venda_dia: r2(vendaDia), cobertura_dias: cobertura, estoque_em: i.item_atualizado_em }
  })
  const ruptura = estoque.filter(e => e.estoque === 0 && (e.unidades_semana > 0 || e.unidades_semana_ant > 0))
  const riscoRuptura = estoque.filter(e => e.estoque > 0 && e.cobertura_dias != null && e.cobertura_dias < 14)
  const statusAnuncios = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM meli_item WHERE cliente = ? GROUP BY status').all(cliente).map(x => [x.status || '?', x.n]))
  const emRevisao = db.prepare(`SELECT item_id, titulo FROM meli_item WHERE cliente = ? AND status = 'under_review'`).all(cliente)
    .map(x => ({ ...x, vendeu: vendeu.has(x.item_id) }))
  const catalogoPerdendo = top.filter(t => t.catalogo && t.catalogo_status && !['winning', 'sharing_first_place'].includes(t.catalogo_status))

  const sau = await saude(cliente)

  const ads = {}, lacunas = [...sau.lacunas]
  if (comAds) {
    for (const k of ['semana_atual', 'semana_anterior', 'mes_atual', 'mes_anterior']) {
      try {
        const a = await relatorioAds(cliente, J[k])
        ads[k] = a.disponivel ? { ...a, tacos: ag[k].faturamento ? r2(a.investimento / ag[k].faturamento * 100) : null } : { disponivel: false, motivo: a.motivo }
      } catch (e) { ads[k] = { disponivel: false, motivo: e.message.slice(0, 120) }; lacunas.push(`Ads ${k}: ${e.message.slice(0, 80)}`) }
    }
  }
  for (const [k, a] of Object.entries(ag)) {
    if (a.dias_faltando.length) lacunas.push(`${k}: ${a.dias_faltando.length} dia(s) sem coleta de pedidos (${a.dias_faltando.slice(0, 5).join(', ')}${a.dias_faltando.length > 5 ? '…' : ''})`)
    if (a.dias_truncados.length) lacunas.push(`${k}: ${a.dias_truncados.length} dia(s) com mais de 1.000 pedidos (amostra)`)
  }
  const velhos = [...ruptura, ...riscoRuptura].filter(e => !e.estoque_em || Date.parse(e.estoque_em) < Date.now() - 36 * 3600e3)
  if (velhos.length) lacunas.push(`${velhos.length} anúncio(s) sinalizado(s) com estoque lido há mais de 36h — conferir no painel antes de agir`)
  if (ag.semana_atual.anuncios_ativos_sem_visitas) lacunas.push(`${ag.semana_atual.anuncios_ativos_sem_visitas} anúncio(s) ativo(s) sem série de visitas — conversão pode estar superestimada`)

  // ── alertas (mesma tabela da skill Amazon, traduzida para o ML) ──
  const alertas = []
  const A = (nivel, item, oque, acao) => alertas.push({ nivel, item_id: item?.item_id || '', produto: item?.titulo || '', oque, acao, peso: item?.unidades_semana ?? item?.receita ?? 0 })
  // tabela da skill: "ruptura de produto com venda na semana atual" = Crítico. Vendeu só na anterior e já está zerado = parou
  // por falta de estoque: relevante, mas é Atenção (a venda já foi perdida; a ação é repor) — evita afogar o crítico real.
  for (const r of ruptura) {
    if (r.unidades_semana > 0) A('Crítico', r, `Estoque zerado com venda na semana atual (${r.unidades_semana} un.; ${r.unidades_semana_ant} na anterior)`, 'Repor estoque / reativar o anúncio — consultor da conta')
    else A('Atenção', r, `Estoque zerado e parou de vender (${r.unidades_semana_ant} un. na semana anterior, 0 na atual)`, 'Avaliar reposição: a venda parou por falta de estoque')
  }
  const nivel = sau.reputacao?.nivel || ''
  if (nivel && !/^5_green|^4_light_green/.test(nivel)) A('Crítico', null, `Reputação fora do verde (${nivel})`, 'Investigar reclamações, atrasos e cancelamentos — consultor + cliente')
  for (const x of emRevisao) A(x.vendeu ? 'Crítico' : 'Atenção', x, 'Anúncio em revisão/moderação (under_review)', 'Abrir o anúncio no painel e corrigir a pendência')
  if ((sau.reclamacoes?.em_mediacao || 0) > 0) A('Crítico', null, `${sau.reclamacoes.em_mediacao} reclamação(ões) em mediação`, 'Responder dentro do prazo do ML')
  const quedaSem = pct(ag.semana_atual.faturamento, ag.semana_anterior.faturamento)
  const quedaMes = ag.mes_atual_d1 ? pct(ag.mes_atual_d1.faturamento, ag.mes_anterior_d1.faturamento) : null
  if (quedaSem != null && quedaSem <= -20) A('Atenção', null, `Faturamento da semana fechada ${quedaSem}% vs a anterior`, 'Diagnosticar visitas × conversão × ticket antes de agir')
  if (quedaMes != null && quedaMes <= -20) A('Atenção', null, `Mês até D-1 ${quedaMes}% vs o mesmo período do mês anterior`, 'Diagnosticar visitas × conversão × ticket antes de agir')
  for (const t of catalogoPerdendo) A('Atenção', t, `Catálogo: ${t.catalogo_status}${t.preco_para_ganhar ? ` (preço para ganhar R$ ${t.preco_para_ganhar})` : ''}`, 'Rever preço/frete/condição sem quebrar a margem')
  for (const r of riscoRuptura) A('Atenção', r, `Cobertura de ${r.cobertura_dias} dias no ritmo da semana atual (estoque ${r.estoque})`, 'Programar reposição')
  if ((sau.reclamacoes?.abertas || 0) > (sau.reclamacoes?.em_mediacao || 0)) A('Atenção', null, `${sau.reclamacoes.abertas - sau.reclamacoes.em_mediacao} reclamação(ões) aberta(s) sem mediação`, 'Resolver antes de virar mediação')
  if ((sau.perguntas?.ha_mais_de_24h || 0) > 0) A('Atenção', null, `${sau.perguntas.ha_mais_de_24h} pergunta(s) sem resposta há mais de 24h`, 'Responder hoje (perguntas sem resposta derrubam conversão)')
  if (tetoAcos && ads.semana_atual?.disponivel && ads.semana_atual.acos > tetoAcos) A('Atenção', null, `ACOS da semana ${ads.semana_atual.acos}% acima do teto de ${tetoAcos}%`, 'Rever campanhas de Ads')
  const positivos = []
  if (quedaSem != null && quedaSem >= 20) positivos.push(`Faturamento da semana fechada +${quedaSem}% vs a anterior`)
  if (quedaMes != null && quedaMes >= 20) positivos.push(`Mês até D-1 +${quedaMes}% vs o mesmo período do mês anterior`)
  const cA = ag.semana_atual.conversao, cB = ag.semana_anterior.conversao
  if (cA != null && cB != null && cA - cB >= 0.3) positivos.push(`Conversão subiu de ${cB}% para ${cA}%`)

  return {
    cliente, coletada: true, data: hoje, janelas: J, agregados: ag,
    variacao: { semana: quedaSem, mes_ate_d: pct(ag.mes_atual.faturamento, ag.mes_anterior.faturamento), mes_ate_d1: quedaMes },
    produtos: { top_atual: top, top_anterior: topAnt, sairam_do_top: sairamDoTop, linhas_atual: itensAtual.length },
    estoque: { sinalizados: [...ruptura, ...riscoRuptura], ruptura, risco: riscoRuptura, status_anuncios: statusAnuncios, em_revisao: emRevisao, base: 'estoque total do anúncio no último sync (próprio + Full não separados nesta versão)' },
    catalogo_perdendo: catalogoPerdendo, saude: sau, ads, teto_acos: tetoAcos,
    alertas: alertas.sort((a, b) => (a.nivel === 'Crítico' ? 0 : 1) - (b.nivel === 'Crítico' ? 0 : 1) || (b.peso || 0) - (a.peso || 0)), positivos, lacunas,
    vendas_por_dia: porDia(cliente, { de: J.mes_anterior.de < J.semana_anterior.de ? J.mes_anterior.de : J.semana_anterior.de, ate: hoje }),
  }
}

// contas conectadas com o consultor do canal ML (da central) — base da tabela de destinatários
export function contasMeli() {
  const cen = new Map(carregarClientes().map(c => [c.cliente, c]))
  return listarConexoes().map(c => ({ cliente: c.cliente, nickname: c.nickname || '', erro: c.erro || '', consultor_ml: cen.get(c.cliente)?.consultores?.ML || cen.get(c.cliente)?.principal || '' }))
}
