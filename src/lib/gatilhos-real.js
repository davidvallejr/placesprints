// Fiação REAL dos gatilhos ao cliente (src/lib/gatilhos.js + gatilhos-envio.js): banco, fontes que JÁ existem, Notion (só pelo relatorio-notion) e env do n8n.
// Todas as fontes são SÓ LEITURA do banco local: plano (acoes_plano com caminho 'cliente'), pendências por canal, estado da conta (Merovíngio), saúde gravada, diagnóstico,
// change-log de preço (meli_item_mudanca), promoções no ar (promo_oferta). Nada aqui chama o Mercado Livre. (O autoteste usa stubs; este arquivo não roda nos testes.)
import { db, agora, log, getEstado } from './db.js'
import { env } from './env.js'
import { notionReq } from './notion.js'
import { notificar } from './notificacoes.js'
import { voz } from './sistemas.js'
import { validarLiderOuConsultor } from './equipe.js'
import { descobrirFontes } from './descobrir.js'
import { resolverPaginaCliente, acharInformacoesDb, invalidarCliente } from './plano-informacoes.js'
import { nomesInternos } from './relatorio-brief-real.js'
import { pendenciasReal } from './pendencias-cliente-real.js'
import { lerSaude } from './saude-coleta.js'
import { diagnosticarConta, sugestaoFull, algoritmo } from './diagnostico-conta.js'
import { analisarCliente } from './impacto-tarefas.js'
import { avaliarEntrega, montarRelatorioFoco, auditarMensagem } from './plano-semana-texto.js'
import { classificarEstado, serieConta } from './retroalimentacao.js'
import { estadoDeHandle, dataNoFuso } from './relatorio-envio.js'
import { criarGatilhos, lerConfig, notificacaoDe } from './gatilhos.js'
import { alinhamentosReal } from './alinhamentos-real.js'
import { criarEnvio } from './gatilhos-envio.js'
import { criarVinculos } from './vinculos.js'
import { familiaDeDemanda, familiaCliente, norm } from './processos.js'
import { diaLocal } from './preco-historico.js'
import { listarConexoesColeta } from './meli-contas.js'
import { integracaoMlAtiva } from './integracao-ml.js'
import { preverCompras } from './compras-previsao.js'
import { lerCfgRelatorio } from './plano-semana-texto.js'
import { canalDe } from './semanal-resultados.js'
import { perfilInformacaoReal } from './perfil-informacao-real.js'
import { concorrentesDoCliente } from './concorrencia.js'
import { auditarTexto, codigosDe } from './relatorio-seguro.js'
import { buscarDestinos } from './gatilhos-destinos-notion.js'

const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
const ontem = () => { const d = new Date(`${dataNoFuso(Date.now())}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const vinculos = criarVinculos(db)
const diaMenos = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
const dia10 = v => /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : ''
const soBanco = fn => (...a) => { try { return fn(...a) } catch (e) { if (/no such table/i.test(String(e?.message))) return null; throw e } }   // tabela de outro módulo ausente num banco novo = fonte indisponível, não erro

// atividade da ASSESSORIA nos anúncios de uma mudança de preço (gatilhos.origemPreco decide a janela por mudança): tarefas do Notion vinculadas ao anúncio pelo
// MESMO vínculo do Merovíngio (vinculos.js: MLB citado no título/descrição/conteúdo, sufixo «· PS-…» da ação do plano, confirmado na tela; 'sugerido' nunca),
// tarefas de preço/desconto/oferta/promoção/cupom/margem SEM anúncio identificado (família ou palavra no tipo ou no título), publicações de Ofertas e promoções
// (oferta no ar, evento de promoção ou de preço riscado no change-log, preço riscado hoje; a oferta leva o preco_original para o origemPreco reconhecer o FIM de promoção que
// devolveu o preço cheio). Só a cancelada fica de fora (aguardando o cliente conta: a equipe aplica quando ele responde).
// Junto vão os carimbos que o origemPreco confere por mudança: sync do Notion (sync), última coleta de promoções concluída (promo_lida) e dias em que os anúncios foram lidos
// (leituras = dias de meli_coleta_dia.coletado_em: a coleta lê os anúncios e logo depois os pedidos, então uma lacuna na coleta alarga a janela até a última leitura anterior).
// Nenhuma tarefa lida para o cliente = null (origem não verificada). ponytail: 'ultimo_sync' é global; um sync por cliente pediria marca por quadro em sync_estado.
const FAMILIAS_PRECO = new Set(['precos', 'campanhas_desconto', 'cupom', 'oferta_relampago', 'custos'])
const CRIACAO = new Set(['cadastro', 'duplicacao', 'kits'])            // famílias de demanda que CRIAM anúncio (config/processos-curadoria.json → familias)
const RX_PRECO = /preci|preco|desconto|oferta|promo|cupom|margem/
export function atividadePreco(c, ids, { de, ate }) {
  const todas = db.prepare("SELECT id, titulo, descricao, conteudo, status, tipo_demanda, data_inicio, data_conclusao, last_edited FROM tarefas WHERE cliente = ? AND arquivada = 0").all(c)
  if (!todas.length) return null
  const conhecidos = new Set(db.prepare('SELECT item_id FROM meli_item WHERE cliente = ?').all(c).map(r => r.item_id)), alvo = new Set(ids.map(String)), lista = JSON.stringify([...alvo])
  const vmap = vinculos.vinculosDe(c, todas, conhecidos), tarefas = []
  for (const t of todas) {
    if (t.status === 'cancelada') continue
    const aberta = t.status !== 'concluida', itens = (vmap.get(t.id) || []).map(x => x.item_id)
    const preco = FAMILIAS_PRECO.has(familiaDeDemanda(t.tipo_demanda).id) || RX_PRECO.test(norm(t.tipo_demanda)) || RX_PRECO.test(norm(t.titulo))
    if (itens.some(i => alvo.has(i)) || (preco && !itens.length)) tarefas.push({ itens, aberta, preco, inicio: dia10(t.data_inicio), fim: aberta ? '' : dia10(t.data_conclusao) || diaLocal(t.last_edited) })
  }
  const execucoes = (soBanco(() => db.prepare('SELECT anuncio_id, criado_em, verificado_em FROM of_publicacao WHERE cliente = ? AND anuncio_id IN (SELECT value FROM json_each(?))').all(c, lista))() || [])
    .flatMap(r => [r.criado_em, r.verificado_em].map(diaLocal).filter(Boolean).map(dia => ({ item_id: r.anuncio_id, dia })))
  const leituras = [...new Set((soBanco(() => db.prepare('SELECT coletado_em FROM meli_coleta_dia WHERE cliente = ? AND coletado_em >= ?').all(c, diaMenos(de, 60)))() || []).map(r => diaLocal(r.coletado_em)).filter(Boolean))].sort()
  // eventos desde a leitura anterior à 1ª mudança −2 (a janela do origemPreco com lacuna na coleta); sem teto: evento de promoção depois da janela também conta
  const anterior = leituras.filter(d => d < diaMenos(de, -2)).at(-1), desde = anterior ? diaMenos(anterior, 2) : de
  const promocoes = [...(soBanco(() => db.prepare("SELECT item_id, inicio, fim, preco_original FROM promo_oferta WHERE cliente = ? AND status <> 'candidate' AND item_id IN (SELECT value FROM json_each(?))").all(c, lista))() || []).map(o => ({ item_id: o.item_id, inicio: diaLocal(o.inicio), fim: diaLocal(o.fim), ...(o.preco_original > 0 ? { preco_original: o.preco_original } : {}) })),
    ...db.prepare("SELECT item_id, dia, campo FROM meli_item_mudanca WHERE cliente = ? AND campo IN ('promocao','preco_original') AND dia >= MIN(?, ?) AND item_id IN (SELECT value FROM json_each(?))").all(c, desde, de, lista),
    ...db.prepare('SELECT item_id FROM meli_item WHERE cliente = ? AND preco_original > preco AND item_id IN (SELECT value FROM json_each(?))').all(c, lista).map(r => ({ item_id: r.item_id, inicio: '', fim: '' }))]   // preço riscado hoje
  const pc = soBanco(() => db.prepare('SELECT estado, concluida_em FROM promo_coleta WHERE cliente = ?').get(c))()
  return { tarefas, execucoes, promocoes, sync: diaLocal(getEstado('ultimo_sync') || ''), promo_lida: pc && pc.estado !== 'parcial' ? diaLocal(pc.concluida_em) : '', leituras }
}

// dados do PLANO SEMANAL (src/lib/plano-semana-texto.js monta o texto; aqui só leitura do banco): diagnóstico (vendas 28 d, cobertura, curva, logística, sugestaoFull),
// estoque parado no Full (última leitura dos últimos 7 dias, idade ≥ full_estoque_antigo_dias; trava 12/10: nunca o inventário que um anúncio que vende também usa —
// a coleta nova já agrupa por inventory_id, o histórico de 28 dias pega a leitura antiga), entregas da equipe que estão vendendo (impacto-tarefas.analisarCliente: só
// melhorou/lançamento sem confundidor de preço ou de estado; critérios em avaliarEntrega) e custos. Ausente = { disponivel:false, motivo }, nunca um plano inventado.
// estoque do Full sem venda há ≥ full_estoque_antigo_dias (última leitura dos 7 dias) com a trava do inventário COMPARTILHADO: o inventory_id que também é de um anúncio
// que vendeu nos 28 d (variações/duplicações sobre o mesmo estoque) não é parado — marcado `compartilhado`, quem lê descarta. Plano semanal e previsão de compras leem daqui.
export function fullParadoDe(c, hoje, itens) {
  const L = algoritmo.limiares, vendeu = JSON.stringify(itens.filter(i => (i.u || 0) > 0).map(i => i.id))
  const compartilhado = new Set((soBanco(() => db.prepare("SELECT DISTINCT inventory_id FROM meli_full_estoque WHERE cliente = ? AND dia >= date(?, '-28 day') AND item_id IN (SELECT value FROM json_each(?))").all(c, hoje, vendeu))() || []).map(r => r.inventory_id))
  return (soBanco(() => db.prepare(`SELECT f.item_id, f.inventory_id, f.disponivel, COALESCE(f.idade_dias, f.dias_sem_venda) dias, f.idade_dias, i.titulo, i.preco FROM meli_full_estoque f
    LEFT JOIN meli_item i ON i.cliente = f.cliente AND i.item_id = f.item_id
    WHERE f.cliente = ? AND f.dia = (SELECT MAX(dia) FROM meli_full_estoque WHERE cliente = ? AND dia >= date(?, '-7 day')) AND f.disponivel > 0 AND COALESCE(f.idade_dias, f.dias_sem_venda) >= ?`).all(c, c, hoje, L.full_estoque_antigo_dias))() || [])
    .map(x => ({ ...x, compartilhado: compartilhado.has(x.inventory_id) }))
}

// previsão de COMPRAS do cliente (compras-previsao.js, pura): o mesmo diagnóstico + estoque parado do Full + sugestaoFull; só leitura
export const comprasDoCliente = (c, { diag } = {}) => { diag = diag || diagnosticarConta(c); return preverCompras(diag, { cfg: algoritmo, fullParado: diag?.disponivel ? fullParadoDe(c, diag.hoje, diag.itens || []) : [], sugestaoFull }) }

// entregasMax: o plano semanal e o resumo ao consultor mostram as 3 de maior receita; o relatório focado recorta por data e por venda atual, então pede todas
export function dadosPlanoSemana(c, { diag, medidas: medidasProntas, entregasMax = 3 } = {}) {   // medidas: analisarCliente(c).medidas já lidas (o resumo ao consultor reaproveita)
  diag = diag || diagnosticarConta(c)
  if (!diag?.disponivel) return { disponivel: false, motivo: String(diag?.motivo || 'diagnostico_indisponivel').slice(0, 60) }
  const hoje = diag.hoje
  const itens = (diag.itens || []).map(i => ({ id: i.id, titulo: i.titulo, permalink: i.permalink, curva: i.curva, status: i.status, cobertura: i.cobertura, estoque: i.estoque, ponto_reposicao: i.ponto_reposicao,
    lead_time_dias: i.lead_time_dias, lead_time_fonte: i.lead_time_fonte, vel_dia: i.vel_dia, logistica: i.logistica, r: i.r, u: i.u, sug: sugestaoFull(i)?.cenarios || null,
    r0: i.r0, u0: i.u0, v: i.v, v0: i.v0, preco: i.preco, catalogo: !!i.catalogo, buy_box: i.buy_box, ptw: i.ptw ? { status: i.ptw.status || '', preco_para_ganhar: i.ptw.preco_para_ganhar ?? null, lido_em: i.ptw.lido_em || '' } : null,
    ...(i.produto ? { produto: i.produto } : {}) }))   // r0…ptw: blocos pedidos do relatório (Etapa 3); produto: V3 F3 (só com a chave), para 1 linha por estoque físico
  const fullBruto = fullParadoDe(c, hoje, itens), fullParado = fullBruto.filter(x => !x.compartilhado)
  const somaDesde = db.prepare('SELECT COALESCE(SUM(unidades),0) u, COALESCE(SUM(receita),0) r FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia >= ?')
  const somaPos = db.prepare("SELECT COALESCE(SUM(unidades),0) u FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia BETWEEN date(?,'+1 day') AND date(?,'+28 day')")
  const somaPre = db.prepare("SELECT COALESCE(SUM(unidades),0) u FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia BETWEEN date(?,'-28 day') AND date(?,'-1 day')")
  const cobPre = db.prepare("SELECT COUNT(*) n FROM meli_coleta_dia WHERE cliente = ? AND dia BETWEEN ? AND date(?,'-1 day')")
  const itemDe = db.prepare('SELECT titulo, permalink, criado_em FROM meli_item WHERE cliente = ? AND item_id = ?')
  let medidas = medidasProntas || []
  if (!medidasProntas) try { medidas = analisarCliente(c).medidas || [] } catch (e) { log('erro', `plano semanal ${c}: entregas ${String(e?.message ?? e).slice(0, 80)}`) }
  const vistos = new Set(), entregas = [], diasAte = d => Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T12:00:00Z`)) / 86_400_000)
  for (const m of medidas.filter(m => ['melhorou', 'lancamento'].includes(m.estado) && !m.confundido_preco && !m.confundido_estado && /^\d{4}-\d{2}-\d{2}/.test(String(m.data)))) for (const it of m.itens || []) {
    if (vistos.has(it)) continue; vistos.add(it)
    const i = itemDe.get(c, it); if (!i) continue
    // família da tarefa = familiaCliente (tipo; título quando o tipo é vazio/genérico): ela decide «criação» e o verbo. «Criamos» só quando a tarefa é de criação (cadastro,
    // duplicação, kit) e o anúncio nasceu junto (≥ data − 3); tarefa de criação nunca conta pelo anúncio-FONTE que ela cita (Moema 14/10: «Criar anúncio fora de catálogo»
    // virava «Otimizamos» o anúncio de catálogo de 2022). Janela anterior só desde a criação do anúncio (≥ 14 dias existindo para «não vinha vendendo»).
    const d10 = String(m.data).slice(0, 10), fam = familiaCliente(m.tipo, m.titulo).id, criacao = CRIACAO.has(fam), nasceu = String(i.criado_em || '').slice(0, 10)
    const des = somaDesde.get(c, it, m.data), criado = criacao && !!nasceu && nasceu >= diaMenos(d10, 3), desdePre = nasceu > diaMenos(d10, 28) ? nasceu : diaMenos(d10, 28)
    const pre = somaPre.get(c, it, m.data, m.data).u, pos = somaPos.get(c, it, m.data, m.data).u, acao = `${m.tipo || ''} ${m.titulo || ''}`
    const ok = avaliarEntrega({ criado, pre, pos, cobertura: cobPre.get(c, desdePre, d10).n, receitaDesde: des.r, kit: criacao || /kit/i.test(acao), diasDesde: diasAte(m.data), preInteiro: desdePre === diaMenos(d10, 28) })
    // tarefa/analista: só para o resumo INTERNO ao consultor (consultor-discord.js); o texto ao cliente (montarPlanoSemanal) nunca lê esses campos
    if (ok) entregas.push({ item_id: it, titulo: i.titulo, permalink: i.permalink, dia: d10, criado, ...ok, pre, pos, unidades: des.u, receita: des.r, acao, familia: fam, tarefa: m.titulo, analista: m.analista || '' })
  }
  entregas.sort((a, b) => b.receita - a.receita)
  return { disponivel: true, hoje, resumo: { gmv: diag.resumo.gmv, pedidos: diag.resumo.pedidos, variacao_pct: diag.resumo.variacao?.pct ?? null, unidades: diag.resumo.unidades, ticket: diag.resumo.ticket },
    itens, fullParado, entregas: entregas.slice(0, entregasMax), custosInformados: !!diag.custos_informados, relatorio: dadosRelatorio(c, { diag, medidas, fullBruto }) }
}

// tarefas do Mercado Livre concluídas nos últimos `dias` (hoje incluso: hoje − (dias − 1) … hoje), visíveis ao cliente, por FAMÍLIA de demanda (familiaCliente: tipo livre
// ou sem tipo = título ou «Outras ações»: o tipo cru pode ser jargão). Ausente ≠ zero: «lido» só com TODOS os quadros do cliente (DISTINCT tarefas.fonte) sincronizados até
// ontem pela marca do próprio quadro (sync_estado desde:<fonte>; a marca global 'ultimo_sync' dizia «lido» com o quadro da Bima parado desde 30/09) → senão null («sem a
// leitura»); cliente sem quadro nenhum = null. Concluída sem data de conclusão conta pela última edição (o MESMO fallback de atividadePreco).
// O 🛠️ do semanal (acoes_semana_dias) e o do relatório focado (foco_tarefas_dias) leem daqui.
// ponytail: quadro aposentado que continua em tarefas.fonte deixa o cliente «sem a leitura» até sair da base; marcar fonte inativa se isso acontecer
export function tarefasMlConcluidas(c, hoje, dias) {
  try {
    const desde = diaMenos(hoje, dias - 1), fontes = db.prepare('SELECT DISTINCT fonte FROM tarefas WHERE cliente = ?').all(c).map(r => r.fonte)
    if (!fontes.length || !fontes.every(f => diaLocal(getEstado(`desde:${f}`) || '') >= diaMenos(hoje, 1))) return null
    const fam = new Map()
    for (const t of db.prepare("SELECT tipo_demanda, titulo, processo, data_conclusao, last_edited FROM tarefas WHERE cliente = ? AND arquivada = 0 AND status = 'concluida' AND visivel_cliente = 1").all(c)) {
      const dia = dia10(t.data_conclusao) || diaLocal(t.last_edited); if (!(dia >= desde && dia <= hoje)) continue
      if (canalDe(t.processo) !== 'Mercado Livre') continue
      const k = familiaCliente(t.tipo_demanda, t.titulo)
      fam.set(k.id, { id: k.id, familia: k.nome, n: (fam.get(k.id)?.n || 0) + 1 })
    }
    return [...fam.values()].sort((a, b) => b.n - a.n || a.familia.localeCompare(b.familia, 'pt-BR'))
  } catch (e) { log('erro', `relatório ${c}: tarefas concluídas ${String(e?.name || 'Error')}`); return null }
}

// dados dos blocos do RELATÓRIO PERSONALIZADO (Etapa 3, 13/10/2026; texto em plano-semana-texto.js → SECOES). Só leitura e só projeção do que já existe — compras
// (preverCompras sobre o MESMO diagnóstico), funil 28 × 28 d (anúncios cobertos por visitas, como o diagnóstico), medições do Merovíngio dos últimos causa_janela_dias,
// tarefas do ML concluídas na semana (por família, sem título nem analista), ações do plano abertas, Ads da conta, promoções da última leitura e concorrentes cadastrados.
// Fonte ausente = null (o texto diz que não foi lido), nunca zero. Funil só com as duas janelas inteiras (dia sem coleta não é zero).
export function dadosRelatorio(c, { diag, medidas = [], fullBruto = [] }) {
  const R = lerCfgRelatorio(), hoje = diag.hoje, janelasOk = diag.resumo.variacao?.pct != null
  const compras = preverCompras(diag, { cfg: algoritmo, fullParado: fullBruto, sugestaoFull })
  const vis = (diag.itens || []).filter(i => i.visOk), soma = k => vis.reduce((t, i) => t + (i[k] || 0), 0), conv = (u, v) => v > 0 ? 100 * u / v : null
  const funil = janelasOk ? { visitas_pct: soma('v0') > 0 ? (soma('v') / soma('v0') - 1) * 100 : null, conv_antes: conv(soma('u0'), soma('v0')), conv_depois: conv(soma('u'), soma('v')), ticket_pct: diag.causal?.deltas?.ticket ?? null } : null
  const desde = diaMenos(hoje, R.causa_janela_dias), rec = medidas.filter(m => String(m.data || '').slice(0, 10) >= desde)
  const vendeu = m => m.estado === 'lancamento' && m.lancamento?.vendeu
  const noDiag = new Set((diag.itens || []).map(i => String(i.id)))
  const med = rec.filter(m => m.estado === 'melhorou' || vendeu(m)).sort((a, b) => (b.confianca?.score ?? -1) - (a.confianca?.score ?? -1) || (b.receita_alocada || 0) - (a.receita_alocada || 0))
    // bruto_pct / vendas_ok: a alta só RELATIVA ao controle (o anúncio caiu menos que os outros) não é «dando resultado» no relatório focado (Jula 14/10: visitas −13% e
    // vendas 3 → 0 viravam «+114%»); n_itens > 1 = medição de um grupo de anúncios (o texto diz «e mais N»)
    .map(m => ({ familia: familiaCliente(m.tipo, m.titulo).nome, data: String(m.data).slice(0, 10), estado: m.estado, efeito_pct: m.efeito_pct ?? 0, metrica: m.metrica_primaria === 'visitas' ? 'visitas' : 'vendas',
      confianca: m.confianca?.score ?? null, preco_junto: !!m.confundido_preco, reversao: !!m.reversao_provavel, item_id: (m.itens || []).find(x => noDiag.has(String(x))) || '', unidades: m.lancamento?.unidades ?? 0, dias: m.dias_pos ?? 0,
      bruto_pct: m.efeito_bruto_pct ?? null, vendas_ok: m.metricas?.unidades ? m.metricas.unidades.depois >= m.metricas.unidades.antes : null, n_itens: (m.itens || []).length }))
  const outras = { sem_alta: rec.filter(m => ['piorou', 'sem_efeito'].includes(m.estado) || (m.estado === 'lancamento' && !vendeu(m))).length, em_medicao: rec.filter(m => m.estado === 'em_maturacao').length }
  const tarefas = tarefasMlConcluidas(c, hoje, R.acoes_semana_dias)
  const acoes = db.prepare("SELECT regra, item_id, status FROM acoes_plano WHERE cliente = ? AND status IN ('proposta','aprovada','distribuida') ORDER BY score DESC").all(c)
  const ads = diag.data_quality?.cobertura?.ads && diag.ads ? { custo: diag.ads.custo, receita: diag.ads.receita, roas: diag.ads.roas, anterior: { custo: diag.ads.anterior?.custo ?? 0, roas: diag.ads.anterior?.roas ?? null } } : null
  // promoções da ÚLTIMA leitura concluída (promo_coleta); oferta no ar = status started com fim depois da meia-noite de hoje (fuso de São Paulo, como a coleta grava)
  const pc = soBanco(() => db.prepare('SELECT estado, concluida_em FROM promo_coleta WHERE cliente = ?').get(c))()
  let promocoes = null
  if (pc?.concluida_em) {
    const corte = Date.parse(`${hoje}T00:00:00-03:00`)
    const no_ar = (soBanco(() => db.prepare("SELECT o.item_id, o.nome, o.fim, i.titulo FROM promo_oferta o LEFT JOIN meli_item i ON i.cliente = o.cliente AND i.item_id = o.item_id WHERE o.cliente = ? AND o.status = 'started'").all(c))() || [])
      .filter(o => !o.fim || Date.parse(o.fim) > corte).map(o => ({ ...o, titulo: o.titulo || '' }))
    const noAr = new Set(no_ar.map(o => o.item_id))
    const elegiveis = new Set((soBanco(() => db.prepare("SELECT DISTINCT item_id FROM promo_oferta WHERE cliente = ? AND status = 'candidate'").all(c))() || []).map(r => r.item_id).filter(i => !noAr.has(i))).size
    promocoes = { lida_em: diaLocal(pc.concluida_em), parcial: pc.estado === 'parcial', no_ar, elegiveis }
  }
  return {
    compras: compras.disponivel ? { disponivel: true, ciclo_dias: algoritmo.compras.ciclo_compra_dias, seguranca_dias: algoritmo.limiares.estoque_seguranca_dias, data_comercial: algoritmo.compras.data_comercial, itens: compras.itens.slice(0, 20) } : { disponivel: false },
    tarefas, causa: { funil, medidas: med.slice(0, 10), outras }, acoes, ads, promocoes, concorrentes: soBanco(() => concorrentesDoCliente(db, c))() || [],
  }
}

// RELATÓRIO FOCADO (pedido do David, 14/10/2026: estoque e ruptura, o que a equipe fez e o que já está dando resultado) — os dados pelo MESMO caminho do lote semanal
// (diagnóstico → dadosPlanoSemana → dadosRelatorio; alinhamentos pelo predicado único; título de produto e mensagem inteira pelo auditor do relatório; rótulo = o do
// semanal: notificacao_json.rotulo ou o nome da central) e as tarefas na janela foco_tarefas_dias. SÓ LEITURA: nenhum lote, nenhum gatilho marcado, nada gravado.
// → { disponivel:false, motivo } | { disponivel:true, rotulo, texto, secoes, conferir, tem_conteudo, bloqueado?, motivo? } (bloqueado pelo auditor = texto '')
export function relatorioFoco(c, { hoje } = {}) {
  const diag = diagnosticarConta(c, hoje ? { hoje } : undefined), d = dadosPlanoSemana(c, { diag, entregasMax: Infinity })
  if (!d.disponivel) return { disponivel: false, motivo: d.motivo }
  const rotulo = notificacaoDe(db.prepare('SELECT notificacao_json FROM clientes_central WHERE cliente = ?').get(c)?.notificacao_json, lerConfig()).rotulo || c
  const al = alinhamentosReal().predicado(c), livre = (regra, it) => !al || !al({ item: it ? String(it) : '', regra, aviso: true }).sim
  const opts = { nomesInternos: nomesInternos(c), permitidos: [c, rotulo] }, R = lerCfgRelatorio()
  const p = montarRelatorioFoco({ rotulo, hoje: d.hoje, itens: d.itens, entregas: d.entregas, info: { ...d.relatorio, tarefas: tarefasMlConcluidas(c, d.hoje, R.foco_tarefas_dias) }, cfgRel: R,
    limiares: { ...algoritmo.limiares, min_unidades_item: algoritmo.foco.min_unidades_item, min_impacto_pct_gmv: algoritmo.foco.min_impacto_pct_gmv }, livre, tituloOk: t => !auditarTexto(t, opts).length })
  const viol = auditarMensagem(p.texto, auditarTexto, opts)
  return viol.length ? { disponivel: true, rotulo, ...p, texto: '', bloqueado: true, motivo: `conteudo:${codigosDe(viol).join(',')}` } : { disponivel: true, rotulo, ...p }
}

// integração ML DE FATO (12/10/2026), função única de integracao-ml.js com as leituras reais: conexão = a MESMA lista da coleta diária (sem erro/revogada, sem S90 fora de
// serviço), último dia de pedidos coletado e vendas na janela do diagnóstico (hoje−28 … hoje−1). Os gatilhos e o resumo do time (consultor-discord) usam esta mesma.
const ultimaColeta = db.prepare('SELECT MAX(dia) d FROM meli_coleta_dia WHERE cliente = ?'), vendasJanela = db.prepare('SELECT COALESCE(SUM(unidades), 0) u FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?')
// primeira coleta COMPLETA (14/10/2026): a coleta já cobre a janela de 28 dias do diagnóstico (o 1º dia coletado ≤ hoje − 28; a conexão nova faz o histórico na 1ª coleta).
// O urgente de estoque e preço nunca sai antes disso: cobertura e ritmo de uma janela incompleta não são o ritmo do cliente.
const primeiraColeta = db.prepare('SELECT MIN(dia) d FROM meli_coleta_dia WHERE cliente = ?')
export const coletaCompletaReal = c => { const d = primeiraColeta.get(c)?.d || '', h = new Date(`${dataNoFuso(Date.now())}T12:00:00Z`); h.setUTCDate(h.getUTCDate() - 28); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= h.toISOString().slice(0, 10) }
export const integracaoMlReal = c => integracaoMlAtiva(c, {
  conectado: x => listarConexoesColeta().some(r => r.cliente === x), ultimaColeta: x => ultimaColeta.get(x)?.d || '',
  vendas28d: (x, { de, ate }) => vendasJanela.get(x, de, ate).u, hoje: () => dataNoFuso(Date.now()) })

// fontes reais (só leitura do banco): a fiação do servidor e a prévia com dados reais (sem gravar nada) usam as MESMAS
export const fontesReais = () => ({
  // previsao = a previsão da regra (cenários em R$): o impacto do urgente de estoque e preço (14/10/2026) vem daqui, nunca de uma conta própria
  acoes: c => db.prepare("SELECT id, regra, item_id, dados_json, previsao_json FROM acoes_plano WHERE cliente = ? AND status IN ('proposta','aprovada','distribuida')").all(c).map(r => ({ id: r.id, regra: r.regra, item_id: r.item_id, dados: parse(r.dados_json, {}), previsao: parse(r.previsao_json, null) })),
  pendencias: c => pendenciasReal().avaliar(c),
  explicar: p => pendenciasReal().explicar(p),
  estadoConta: c => { const cob = db.prepare('SELECT MIN(dia) de FROM meli_coleta_dia WHERE cliente = ?').get(c); return classificarEstado({ serie: serieConta(c), ate: ontem(), cob: cob?.de ? { de: cob.de } : null }) },
  saude: c => lerSaude(c, { hoje: dataNoFuso(Date.now()) }),           // do_dia relativo a hoje (como plano-anuncios); leitura velha = pendente, nunca "hoje"
  diagnostico: c => diagnosticarConta(c),
  sugestaoFull,
  // pedido ao fornecedor (preverCompras sobre o MESMO diagnóstico): a quantidade do aviso de estoque é a do relatório focado e do 📦 do plano (14/10/2026)
  compras: (c, diag) => comprasDoCliente(c, { diag }),
  // quando os anúncios (estoque) foram lidos: o aviso diz a data quando a leitura não é de hoje
  leituraAnuncios: c => db.prepare("SELECT MAX(atualizado_em) em FROM meli_item WHERE cliente = ? AND atualizado_em <> ''").get(c)?.em || '',
  mudancasPreco: (c, { desde }) => db.prepare("SELECT m.item_id, m.dia, m.de, m.para, m.variacao_pct, m.fonte, i.titulo FROM meli_item_mudanca m LEFT JOIN meli_item i ON i.cliente = m.cliente AND i.item_id = m.item_id WHERE m.cliente = ? AND m.campo = 'preco' AND m.dia >= ? ORDER BY m.id DESC LIMIT 200").all(c, desde),
  promocoes: soBanco(c => db.prepare("SELECT o.item_id, o.nome, o.fim, o.status, i.titulo FROM promo_oferta o LEFT JOIN meli_item i ON i.cliente = o.cliente AND i.item_id = o.item_id WHERE o.cliente = ? AND o.status = 'started' AND o.fim <> '' LIMIT 500").all(c)),
  atividadePreco,
  planoSemana: c => dadosPlanoSemana(c),
  perfil: c => perfilInformacaoReal().ler(c).efetivo,                   // o que o cliente quer receber (ordem dos blocos, nível): Etapa 3 do relatório personalizado
  alinhado: c => alinhamentosReal().predicado(c),                       // alinhamentos com o cliente: o predicado único decide o que não vira aviso
  titulos: (c, ids) => { const l = [...new Set(ids.map(String))].slice(0, 200); return new Map(l.length ? db.prepare(`SELECT item_id, titulo FROM meli_item WHERE cliente = ? AND item_id IN (${l.map(() => '?').join(',')})`).all(c, ...l).map(r => [r.item_id, r.titulo]) : []) },
})

// universo dos gatilhos e do resumo do time = TODO cliente da central (o status Ativo e o prospect o núcleo filtra), SEM exigir base de tarefas sincronizada: «cada cliente Ativo
// com integração ML de fato» (decisões 4, 6 e 7 de 12/10/2026). Antes era equipe.clientesElegiveis (exige tarefa) e Cronometal/Christian Ponce, Ativos com ML, ficavam de fora.
export const clientesDaCentral = () => db.prepare('SELECT cliente, status_cs AS status FROM clientes_central').all()

// cfg/envio/central sobrescrevem a fiação só no scripts/alerta-impacto.mjs (prévia: urgente simulado ligado, SEM envio; o servidor usa o padrão)
export function criarGatilhosReal({ clienteCanonico, cfg = lerConfig(), envio: envioDado, central = c => buscarDestinos(c) } = {}) {
  const fontes = fontesReais()
  const envio = envioDado !== undefined ? envioDado : criarEnvio({ env, agora, webhook: cfg.webhook, notion: { req: notionReq }, destinos: { fontes: descobrirFontes, resolverPaginaCliente, acharInformacoesDb, invalidar: invalidarCliente }, estado: estadoDeHandle(db),
    notionCfg: { icone: cfg.notion.icone, status_aberto: cfg.notion.status_aberto }, log })
  return criarGatilhos({ handle: db, fontes, agora, nomesInternos, cfg, validarPor: validarLiderOuConsultor, elegiveis: clientesDaCentral, clienteCanonico, envio, log: (n, m) => log(n, voz('morpheus', m)), notificar, integracao: integracaoMlReal,
    coletaCompleta: coletaCompletaReal, central })
}
