// PREVISÃO DE COMPRAS e previsibilidade do ciclo de estoque — Algoritmo v1.6.0 (pedido do David, 13/10/2026: «gestão correta do negócio, compras, previsibilidade
// do ciclo do estoque»; bloco «Compras e previsibilidade» do relatório para TODOS os clientes). PURA sobre o diagnóstico (diagnosticarConta): nenhuma leitura de banco.
// Não é um segundo motor: não cria ação nem prioridade — o momento de repor continua sendo a regra estoque_ruptura e o gatilho ciclo_estoque_previsto (ponto de
// reposição do diagnóstico, com lead time + segurança); aqui só se projeta QUANTO e QUANDO pedir, com as premissas no texto (config/algoritmo.json → compras).
// Honestidade: estimativa, nunca promessa (intervalo conservador–base); dia sem coleta não é venda zero (lacuna = previsão parcial, declarada); lead time informado
// vence a premissa e a fonte vai junto; capital empatado só com custo cadastrado (custo do anúncio ou CMV % da conta), senão null ('—').
import { pseudoProdutos } from './produto-estoque.js'
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const r2 = n => Math.round(n * 100) / 100
const pct = x => String(Math.round(x * 100)).replace('.', ',')
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000)

// data comercial (config/algoritmo.json → sazonalidade) que vale para o anúncio: universal = curva A; senão palavra do título. O MESMO predicado de janelasComerciais.
export const eventoDoItem = (e, i) => e.universal ? i.curva === 'A' : (e.palavras || []).some(p => norm(i.titulo).includes(p))

// RITMO PREVISTO (vendas/dia) — a fórmula ÚNICA da previsão de compras e da segurança do sincronismo de estoque (V3 F6: segurança = dias × vBase):
// média simples dos 28 dias × tendência (14 d ÷ 28 d, limitada), aplicada uma vez; sem estoque, sem tendência para baixo e o base usa o ritmo de antes da falta.
// i = { u, u14, u0, vel_pond, estoque } · C = config/algoritmo.json → compras
export function ritmoPrevisto(i, C, janela = 28) {
  const [tMin, tMax] = C.tendencia_limites, v28 = (i.u || 0) / janela, estoque = Number.isFinite(i.estoque) ? Math.max(0, i.estoque) : null
  const ruptura = estoque === 0
  const bruto = i.u14 != null && v28 > 0 ? (i.u14 / 14) / v28 : 1
  const fTend = ruptura ? Math.max(1, Math.min(tMax, bruto)) : Math.min(tMax, Math.max(tMin, bruto))
  const vCons = v28 * Math.min(fTend, 1), vBase = ruptura ? Math.max(v28 * fTend, i.vel_pond || 0, (i.u0 || 0) / janela) : v28 * fTend
  return { v28, bruto, fTend, vCons, vBase, ruptura }
}

// diag = diagnosticarConta(c) · cfg = algoritmo (limiares, compras, sazonalidade) · hoje 'AAAA-MM-DD'
// fullParado = estoque do Full sem venda há ≥ full_estoque_antigo_dias: [{ item_id, inventory_id, disponivel, dias, titulo, preco, compartilhado }] (compartilhado = o
//   inventory_id também é de um anúncio que vendeu nos 28 d) · sugestaoFull(item) → { cenarios: { conservador, base } } | null (diagnostico-conta.js)
// → { disponivel, hoje, rotulo_pedido, parcial, premissas[], itens[], parado[], totais }
// produto (V3 F3): true = 1 linha por PRODUTO (estoque Σ dos estoques físicos contado 1×, demanda somada dos irmãos, prazo do representante; pseudoProdutos); false = 1 por
// anúncio; omitido = a chave cfg.produto.diagnostico_ligado. Sem i.produto nos itens (chave desligada em carregarBase) as duas saídas são idênticas.
export function preverCompras(diag, { cfg, hoje = diag?.hoje, fullParado = [], sugestaoFull = () => null, produto = cfg?.produto?.diagnostico_ligado === true } = {}) {
  if (!diag?.disponivel) return { disponivel: false, motivo: diag?.motivo || 'diagnóstico indisponível' }
  const porId = new Map((diag.itens || []).map(i => [String(i.id), i])), base = produto ? pseudoProdutos(diag.itens || []) : (diag.itens || [])
  const comProduto = base.some(i => i.produto_linha)
  // envio ao Full por ESTOQUE FÍSICO Full do produto (sugestaoFull sobre o representante daquele EF, que já conta o EF inteiro com a chave ligada)
  const envioFullDe = i => i.produto_linha ? (i.produto_linha.efs.filter(e => e.local === 'full').map(e => sugestaoFull(porId.get(String(e.representante)) || i)?.cenarios ?? null).find(Boolean) ?? null)
    : i.logistica === 'fulfillment' ? sugestaoFull(i)?.cenarios ?? null : null
  const L = cfg.limiares, C = cfg.compras, seg = L.estoque_seguranca_dias, ciclo = C.ciclo_compra_dias, [tMin, tMax] = C.tendencia_limites, DC = C.data_comercial
  const janela = 28, eventos = (cfg.sazonalidade || []).filter(e => e.data > hoje)
  const cmv = diag.custos?.cmv_pct
  const custoDe = i => i.custo_unitario != null ? { custo: i.custo_unitario, fonte: 'anuncio' } : cmv != null && i.preco > 0 ? { custo: i.preco * cmv / 100, fonte: 'cmv_conta' } : { custo: null, fonte: null }
  const relevante = i => i.status === 'active' || (i.status === 'paused' && i.estoque === 0)      // pausado por falta de estoque é ruptura; pausa com estoque é decisão

  const itens = []
  for (const i of base) {
    // ritmo = média SIMPLES dos 28 dias (o mesmo de cobertura, ponto de reposição, 📦 e 🔄); a tendência entra UMA vez, por cima dela (antes vel_pond já pesava os
    // últimos 7 dias e a tendência somava de novo: Sabre 14 da Agrinorte 0,32/dia virava 1,1/dia). Conservador = 28 d sem alta; base = 28 d × tendência.
    const estoque = Number.isFinite(i.estoque) ? Math.max(0, i.estoque) : null
    const { v28, bruto, fTend, vCons, vBase, ruptura } = ritmoPrevisto(i, C)
    if (!relevante(i) || !(v28 > 0)) continue
    const lead = i.lead_time_dias ?? L.lead_time_reposicao_dias, fonteLead = i.lead_time_fonte || 'premissa', horizonte = lead + ciclo + seg
    const evs = eventos.filter(e => eventoDoItem(e, i) && diasEntre(hoje, e.data) <= Math.max(...C.horizontes_dias, horizonte))   // só as datas que entram em alguma conta
    const extra = d => evs.filter(e => diasEntre(hoje, e.data) <= d).length * vBase * DC.dias_efeito * (DC.fator - 1)
    const cobertura = estoque == null ? null : estoque / v28                     // a MESMA cobertura do diagnóstico (🔄 e 📦 na mesma mensagem)
    const folga = cobertura == null ? null : cobertura - lead - seg
    const quando = folga == null ? null : folga <= 0 ? { agora: true, data: hoje, dias: 0 } : { agora: false, data: addDias(hoje, Math.floor(folga)), dias: Math.floor(folga) }
    if (!C.curvas.includes(i.curva) && !(quando && quando.dias <= ciclo)) continue   // curva C só quando o pedido cai dentro do próximo ciclo de compra
    const quanto = estoque == null ? null : {
      conservador: Math.max(0, Math.ceil(vCons * horizonte - estoque - 1e-9)), base: Math.max(0, Math.ceil(vBase * horizonte + extra(horizonte) - estoque - 1e-9)), cobre_dias: horizonte }
    const { custo, fonte: custoFonte } = custoDe(i)
    itens.push({
      id: i.id, titulo: i.titulo, permalink: i.permalink || '', curva: i.curva, logistica: i.logistica || '', estoque, ponto_reposicao: i.ponto_reposicao ?? null,
      no_ponto_de_pedido: i.ponto_reposicao != null && estoque != null && estoque <= i.ponto_reposicao,       // o MESMO corte do gatilho ciclo_estoque_previsto
      vendas_dia: r2(vBase), vendas_dia_28d: r2(v28), tendencia: { fator: r2(fTend), medido: r2(bruto), limitada: fTend !== bruto }, ruptura,
      datas_comerciais: evs.map(e => ({ evento: e.evento, data: e.data })),
      previsao: Object.fromEntries(C.horizontes_dias.map(d => [d, { conservador: Math.round(vCons * d), base: Math.round(vBase * d + extra(d)) }])),
      cobertura_dias: cobertura == null ? null : Math.round(cobertura), lead_time: { dias: lead, fonte: fonteLead }, seguranca_dias: seg,
      quando_pedir: quando, quanto_pedir: quanto,
      envio_full: envioFullDe(i),
      ...(i.produto_linha ? { produto: { chave: i.produto_linha.chave, n_anuncios: i.produto_linha.n_anuncios, itens: i.produto_linha.itens, modo: i.produto_linha.modo } } : {}),
      custo_unitario: custo == null ? null : r2(custo), custo_fonte: custoFonte,
      capital_empatado: custo == null || estoque == null ? null : r2(estoque * custo),
      valor_pedido: custo == null || !quanto ? null : { conservador: r2(quanto.conservador * custo), base: r2(quanto.base * custo) },
      receita_28d: i.r || 0,
    })
  }
  itens.sort((a, b) => (a.quando_pedir?.dias ?? Infinity) - (b.quando_pedir?.dias ?? Infinity) || b.receita_28d - a.receita_28d)

  // estoque PARADO do Full, com as travas do plano semanal: vendeu nos 28 d (contradição) ou inventário compartilhado com quem vendeu não é parado
  const vendeu = new Set((diag.itens || []).filter(i => (i.u || 0) > 0).map(i => String(i.id)))
  const parado = fullParado.filter(x => x.disponivel > 0 && !x.compartilhado && !vendeu.has(String(x.item_id))).map(x => {
    const { custo, fonte } = custoDe({ ...porId.get(String(x.item_id)), preco: porId.get(String(x.item_id))?.preco ?? x.preco })
    return { item_id: x.item_id, titulo: x.titulo || '', unidades: x.disponivel, dias_sem_venda: x.dias, custo_fonte: fonte, capital: custo == null ? null : r2(x.disponivel * custo) }
  })
  const soma = l => { const c = l.filter(x => x != null); return { valor: c.length ? r2(c.reduce((t, x) => t + x, 0)) : null, com_custo: c.length, total: l.length } }

  const lacunas = diag.data_quality?.cobertura?.pedidos?.lacunas?.length || 0
  const leadPremissa = itens.some(x => x.lead_time.fonte === 'premissa')
  const premissas = [
    'Previsão = vendas por dia dos últimos 28 dias × dias × tendência (vendas por dia dos últimos 14 dias ÷ últimos 28 dias, ' +
      `limitada entre ${String(tMin).replace('.', ',')} e ${String(tMax).replace('.', ',')}; aplicada uma vez, só no cenário base quando é alta).`,
    'Produto sem estoque: os dias parados não contam como queda (sem tendência para baixo); o cenário base usa o maior ritmo entre os 28 dias, o recente e os 28 dias anteriores (antes da falta).',
    `Data comercial do calendário dentro da janela: ${DC.dias_efeito} dias de venda ${pct(DC.fator - 1)} % acima do ritmo (premissa da casa: ainda sem 12 meses de histórico para medir).`,
    `Pedir com ${seg} dias de segurança (premissa da casa) antes do prazo de reposição; o pedido cobre prazo de reposição + ciclo de compra de ${ciclo} dias + segurança.`,
    leadPremissa ? `Prazo de reposição de ${L.lead_time_reposicao_dias} dias onde o prazo do fornecedor ou da produção não foi informado (premissa — informe o real).` : 'Prazo de reposição informado pelo cliente ou pela equipe.',
    comProduto ? 'Contamos o estoque uma vez por produto: no Mercado Livre, anúncios do mesmo produto vendem do mesmo estoque; Full e depósito próprio são separados (somados só para comprar); estoque fora do canal e pedidos já feitos ao fornecedor não são vistos.'
      : 'Estoque = disponível no anúncio do Mercado Livre (no Full, o estoque do Full); estoque em depósito fora do canal e pedidos já feitos não são vistos.',
    ...(comProduto && base.some(i => i.produto_linha?.modo === 'declarado') ? ['Onde o cliente informou o estoque físico, vale o número informado (fonte e data no produto).'] : []),
    ...(comProduto && base.some(i => i.produto_linha && !Number.isFinite(i.estoque) && (i.status === 'active') && (i.u || 0) > 0) ? [`${base.filter(i => i.produto_linha && !Number.isFinite(i.estoque) && i.status === 'active' && (i.u || 0) > 0).length} produto(s) com estoque próprio ainda não lido por local (Full com Flex ou Full e depósito do mesmo produto) ficaram sem sugestão de pedido: sem o número não há pedido, nunca zero; a leitura por local entra na coleta diária.`] : []),
    ...(comProduto && base.some(i => ['espelho_provavel', 'dividido'].includes(i.produto_linha?.modo)) ? ['Anúncios do mesmo produto em estoques próprios separados: o mesmo número em todos foi contado uma vez (premissa: estoque espelhado); números diferentes foram somados (premissa: estoque dividido).'] : []),
    'Estimativa, não promessa: conservador = sem alta de tendência e sem data comercial; base = com as duas.',
    ...(lacunas ? [`Parcial: ${lacunas} dia(s) sem coleta de pedidos nas janelas comparadas; dia sem coleta não é venda zero, então a previsão pode ficar abaixo do real.`] : []),
  ]
  return {
    disponivel: true, cliente: diag.cliente, hoje, rotulo_pedido: C.rotulo_pedido, parcial: lacunas ? { dias_sem_coleta: lacunas } : null, premissas, itens, parado,
    totais: {
      anuncios: itens.length, pedir_agora: itens.filter(x => x.quando_pedir?.agora).length, pedir_no_ciclo: itens.filter(x => x.quando_pedir && x.quando_pedir.dias <= ciclo).length,
      capital_empatado: soma(itens.filter(x => x.estoque != null).map(x => x.capital_empatado)), capital_parado: soma(parado.map(x => x.capital)),
    },
  }
}
