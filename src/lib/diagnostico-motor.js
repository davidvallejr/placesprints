// Motor de diagnóstico de marketplaces (v1.4.0, 08/10/2026; v1.5.0 em 09/10 traz as regras de saúde da conta para issues/actions pelo mesmo fluxo) — PROJEÇÃO do Algoritmo no contrato JSON das 11 chaves. Nunca um segundo motor:
// os números vêm de diagnosticarConta (DEFINICOES), as ações das regras do plano (acoes_plano), o estado/estratégia da retroalimentação,
// a tese do Merovíngio. Este módulo só organiza, cita evidência e deriva prompts; não decide nada e não chama IA (a IA só redige, em ia.js).
// montarDiagnostico é PURA (recebe tudo); diagnosticoDoCliente lê o banco (somente leitura: retroalimentar com salvar:false).
// Só Mercado Livre: Amazon/Shopee/TikTok = NOT_SUPPORTED declarado. Dado ausente é null com motivo, nunca zero. Sem custos, nunca lucro/prejuízo.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, hojeLocal, agora } from './db.js'
import { ROOT } from './env.js'
import { diagnosticarConta, qualidadeDados, DEFINICOES, ESTADOS_BLOQUEIO, algoritmo, margemPct } from './diagnostico-conta.js'
import { CFG_SAUDE } from './saude-coleta.js'
import { lerAcoes, lerPlano } from './plano-cliente.js'
import { retroalimentar, cfgRetro } from './retroalimentacao.js'
import { qualidadeNoIntervalo, diasEntre } from './meli-serie.js'
import { lerCliente as merovingioCliente } from './merovingio.js'
import { carregarClientes, normNome } from './equipe.js'
import { checarPreservacao, CAMPOS_PRESERVAR_TITULO, ROTULO_PRESERVAR } from './ofertas-preservacao.js'
import { origemCatalogo } from './catalogo.js'
import { TEXTO_CATALOGO } from './catalogo-cfg.js'
import { auditarInterno } from './ia.js'
import { alinhamentosReal } from './alinhamentos-real.js'
import { TERMOS_PROIBIDOS_PROMPT } from './ofertas-diagnostico.js'   // fonte única dos proibidos ("top" como elogio, nunca a palavra solta)

const CFG_OFERTAS = JSON.parse(readFileSync(join(ROOT, 'config', 'ofertas.json'), 'utf-8'))
const DUPLICACAO = JSON.parse(readFileSync(join(ROOT, 'config', 'duplicacao.json'), 'utf-8'))
export const VERSAO = algoritmo.versao
export const CANAIS_SUPORTADOS = { mercadolivre: 'SUPPORTED', amazon: 'NOT_SUPPORTED', shopee: 'NOT_SUPPORTED', tiktok: 'NOT_SUPPORTED' }
export const TIPOS_EVIDENCIA = ['fato', 'hipotese', 'projecao', 'pendente']
export const TIPOS_PROMPT = ['titulo_descricao', 'imagens', 'atributos', 'oferta_kit', 'campanha', 'preco', 'plano_conta']
export const EXECUTORES = ['oferta', 'promocoes', 'notion']
// regras que são OPORTUNIDADE (expansão); todo o resto é problema (issue). ads_escalar entrou por ser expansão de tráfego, não problema.
export const REGRAS_OPORTUNIDADE = new Set(['ads_entrar', 'ads_escalar', 'urgencia_oculta', 'duplicacao_estrategica', 'full_envio', 'oferta_cadastro', 'concentracao_receita', 'sazonal'])
// prompts derivados por regra (tipo de texto/imagem que a ação pede). Catálogo de terceiros: só 'campanha' e 'preco' sobrevivem (origemCatalogo).
export const PROMPT_POR_REGRA = {
  ima_conversao: ['titulo_descricao', 'imagens'], conteudo_fotos: ['imagens'], oferta_galeria: ['imagens'], oferta_ficha: ['atributos'], oferta_titulo_descricao: ['titulo_descricao'],
  oferta_completa: ['imagens', 'titulo_descricao', 'atributos'], urgencia_oculta: ['oferta_kit'], duplicacao_estrategica: ['titulo_descricao'],
  ads_entrar: ['campanha'], ads_escalar: ['campanha'], ads_reduzir: ['campanha'], ads_otimizar_antes: ['campanha'], ads_abaixo_meta: ['campanha'], queda_ctr_ads: ['imagens'],
  preco_mudou_vendas_cairam: ['preco'], margem_negativa: ['preco'], oferta_preco: ['preco'], catalogo_buybox: ['preco'],
}
const PROMPTS_CATALOGO_TERCEIROS = new Set(['campanha', 'preco'])
const PROIBIDO = [...TERMOS_PROIBIDOS_PROMPT, 'inventar característica', 'prometer resultado']

const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 10)
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const semId = t => String(t || '').replace(/\s*\((?:MLB|MLA|MLM|MLC)\w+\)\s*$/, '')
// métricas que só existem neste contrato (agregados por curva): fórmula declarada aqui, nunca número solto
const DEF_LOCAL = {
  n_anuncios: { texto: 'Anúncios na curva', formula: 'contagem dos anúncios com venda ou Ads em 56 dias classificados na curva (classificarCurvas)', denominador: null, periodo: '28 dias', fonte: 'meli_serie_item + meli_item' },
  share_pct: { texto: 'Participação na receita', formula: 'receita (do anúncio ou da curva) ÷ GMV da conta × 100', denominador: 'GMV', periodo: '28 dias', fonte: 'meli_serie_item' },
  conversao_curva: { texto: 'Conversão da curva', formula: 'Σ unidades ÷ Σ visitas dos anúncios da curva cobertos por visitas no período inteiro (visOk); null sem anúncio coberto', denominador: 'visitas dos anúncios cobertos', periodo: '28 dias', fonte: 'meli_serie_item' },
}
const UNIDADE = { receita: 'BRL', pedidos: 'pedidos', unidades: 'un', ticket: 'BRL', preco_pago: 'BRL', conversao_anuncio: '%', conversao_conta: '%', conversao_curva: '%', ctr_ads: '%', cpc: 'BRL', custo_por_pedido_ads: 'BRL', acos: '%', roas: 'x', tacos: '%', participacao_publicidade: '%', margem_pre_ads: '%', margem_pos_ads: '%', margem_medida: '%', cobertura: 'dias', giro: 'x', ponto_reposicao: 'un', variacao: '%', n_anuncios: 'anúncios', share_pct: '%', reclamacoes: 'reclamações', atrasos: 'pedidos', perguntas: 'perguntas', reputacao: '%' }
const TIPO_METRICA = { ponto_reposicao: 'projecao', margem_pre_ads: 'projecao', margem_pos_ads: 'projecao' }   // estimativas com premissa/percentuais informados; o resto é medido
// métricas somadas (ou divididas) sobre a série diária de pedidos: dia sem coleta na janela não é dia sem venda → parcial, e acima do corte, null com motivo
const DA_SERIE = new Set(['receita', 'pedidos', 'unidades', 'ticket', 'preco_pago', 'conversao_anuncio', 'conversao_conta', 'conversao_curva', 'share_pct', 'tacos', 'participacao_publicidade', 'cobertura', 'giro', 'ponto_reposicao'])
// ponytail: mesmo corte de retroalimentar (> 3 dias sem coleta → sem base); quando config/retroalimentacao.json → estado.max_dias_sem_coleta existir, ele vence
const MAX_SEM_COLETA = cfgRetro.estado?.max_dias_sem_coleta ?? 3

// ── contrato: montagem PURA ───────────────────────────────────────────────────
// montarDiagnostico(cliente, { hoje, diag, acoes, plano, retro, merov, ofertas, ambiente, avisos })
//   diag = diagnosticarConta() · acoes = linhas de acoes_plano hidratadas (dados objeto; previsao objeto ou previsao_json) · plano = lerPlano() · retro = retroalimentar()
//   merov = merovingio.lerCliente() · ofertas = { porItem: Map<item_id, { ficha, referencia_confirmada, voz_coletada, titulo_proposto, briefing }> } · ambiente = { fal_key }
//   coleta = { atual: {faltam[], truncados}, anterior: {…} } (qualidadeNoIntervalo de cada janela); sem ela, as lacunas saem de data_quality (truncados = total das duas janelas: teto conservador)
//   alinhamentos = alinhamentos.listar(cliente) (vivos + vencidos): exceções intencionais combinadas com o cliente → account_diagnosis.alinhamentos[] (NÃO viram estado de
//   análise bloqueada: o enum ESTADOS_BLOQUEIO é do dado, não da decisão). Motivo livre é INTERNO: o render ao cliente mostra só o rótulo do tipo e "conforme alinhado em dd/mm".
export function montarDiagnostico(cliente, { hoje = hojeLocal(), diag, acoes = [], plano = null, retro = null, merov = null, ofertas = null, ambiente = {}, avisos = [], coleta = null, alinhamentos = [] } = {}) {
  if (!diag?.disponivel) return indisponivel(cliente, { hoje, diag, avisos })
  const dq = diag.data_quality, per = diag.periodo, janela = `${per.de}..${per.ate}`, janelaAnt = `${per.anterior.de}..${per.anterior.ate}`
  const evs = new Map()
  const ev = ({ chave, tipo = 'fato', valor = null, unidade = null, texto = '', fonte = '', periodo = janela, motivo }) => {
    const id = 'ev-' + sha(`${cliente}|${chave}|${periodo}`)
    if (!evs.has(id)) evs.set(id, { id, tipo, chave, valor, unidade, texto, fonte, periodo, ...(motivo ? { motivo } : {}) })
    return id
  }
  // qualidade da coleta por janela (chave = a string do período da métrica): dias da janela, dias sem coleta, dias truncados
  const dqp = dq.cobertura?.pedidos || {}
  const qJanela = (de, ate, q) => ({ dias: diasEntre(de, ate) + 1, faltam: (q?.faltam ?? (dqp.lacunas || []).filter(d => d >= de && d <= ate)).length, truncados: q?.truncados ?? (dqp.truncados || 0) })
  const qualidade = { [janela]: qJanela(per.de, per.ate, coleta?.atual), [janelaAnt]: qJanela(per.anterior.de, per.anterior.ate, coleta?.anterior) }
  // métrica = { valor|null, formula, denominador, periodo, fonte, motivo?, evidence_id, parcial? } — valor não nulo gera evidência; nulo leva motivo (ausente ≠ zero).
  // Métrica da série de pedidos com dia sem coleta/truncado na janela: parcial {dias_cobertos, dias, dias_sem_coleta, dias_truncados} e evidência 'pendente'; acima de MAX_SEM_COLETA, null com motivo.
  // `serie` = a janela de pedidos sobre a qual a métrica soma/divide (padrão: o próprio período). TACOS e participação têm período de Ads mas dividem pela
  // receita da janela de pedidos: a qualidade é a DESSA janela. Métrica da série nunca fica sem qualidade (sem ela o corte não valia e o número saía como fato).
  const met = (defKey, valor, { chave = `conta:${defKey}`, motivo = '', texto = '', periodo = janela, serie = periodo, tipo = TIPO_METRICA[defKey] || 'fato', extra = {}, parcial: parcialDado = null } = {}) => {
    const d = DEFINICOES[defKey] || DEF_LOCAL[defKey]
    let v = num(valor)
    const q = DA_SERIE.has(defKey) ? qualidade[serie] || qualidade[janela] : null
    if (v != null && q?.faltam > MAX_SEM_COLETA) { v = null; motivo = `${q.faltam} dia(s) da janela sem coleta de pedidos (acima de ${MAX_SEM_COLETA}): somar o buraco como venda zero enganaria` }
    const m = { valor: v, formula: d.formula, denominador: d.denominador, periodo: d.periodo, fonte: d.fonte, evidence_id: null, ...extra }
    if (v == null) m.motivo = motivo || (d.formula == null ? 'NOT_COLLECTED: lido ao vivo, ainda não gravado' : 'sem dado no período')
    else {
      const parc = parcialDado || (q && (q.faltam || q.truncados) ? { dias_cobertos: q.dias - q.faltam, dias: q.dias, dias_sem_coleta: q.faltam, dias_truncados: q.truncados } : null)
      const mot = parc ? `parcial: ${parc.dias_cobertos} de ${parc.dias} dias coletados${parc.dias_truncados ? `, ${parc.dias_truncados} dia(s) truncado(s)` : ''}` : ''
      if (parc) m.parcial = parc
      m.evidence_id = ev({ chave, tipo: parc ? 'pendente' : tipo, valor: v, unidade: UNIDADE[defKey] || null, texto: (texto || `${d.texto}: ${v}${UNIDADE[defKey] === '%' ? '%' : ''}`) + (mot ? ` (${mot})` : ''), fonte: d.fonte, periodo, motivo: mot })
    }
    return m
  }
  const R = diag.resumo, A = diag.ads, E = diag.economia, custos = diag.custos_informados
  const FM = diag.financeiro?.conta?.margem_pct != null ? diag.financeiro.conta : null      // só existe com a chave financeiro.margem_medida_nas_regras (carregarBase)
  const adsJanela = dq.cobertura?.ads?.janela ? `${dq.cobertura.ads.janela.de}..${dq.cobertura.ads.janela.ate}` : janela
  const semAds = !(A?.custo > 0 || A?.prints > 0)
  const mAds = (k, v, o = {}) => met(k, semAds ? null : v, { motivo: semAds ? 'sem Product Ads coletado na conta' : o.motivo || 'sem base (cliques/receita atribuída = 0)', periodo: adsJanela, serie: janela, ...o })
  const dqS = dq.saude || null, perSaude = dqS?.do_dia ? `${dqS.dia}..${dqS.dia}` : janela
  const motSaude = k => { const sin = dqS?.sinais?.[k] || 'pendente:sem_coleta'; const mot = sin.replace(/^pendente:/, ''); return sin === 'disponivel' ? 'lido no dia, sem ocorrência' : mot === 'permissao_do_app' ? `NOT_AUTHORIZED: ${CFG_SAUDE.pendente[mot]}` : `NOT_COLLECTED: ${CFG_SAUDE.pendente[mot] || 'sem leitura de saúde do dia'}` }
  const conta = {
    receita: met('receita', R.gmv, { extra: { anterior: num(R.gmv_anterior) } }),
    receita_anterior: met('receita', R.gmv_anterior, { chave: 'conta:receita_anterior', periodo: janelaAnt }),
    pedidos: met('pedidos', R.pedidos, { motivo: 'nenhum dia da janela foi coletado' }),
    unidades: met('unidades', R.unidades),
    ticket: met('ticket', R.ticket, { motivo: 'sem pedidos coletados na janela' }),
    conversao_conta: met('conversao_conta', R.conversao_conta, { motivo: 'nenhum anúncio curva A/B com visitas suficientes no período inteiro' }),
    variacao: met('variacao', R.variacao?.pct, { motivo: R.variacao?.motivo || 'sem período anterior' }),
    ctr_ads: mAds('ctr_ads', A.ctr, { extra: { anterior: semAds ? null : num(A.anterior?.ctr) } }),
    cpc: mAds('cpc', A.cpc), custo_por_pedido_ads: mAds('custo_por_pedido_ads', A.custo_por_pedido),
    acos: mAds('acos', A.acos), roas: mAds('roas', A.roas, { extra: { anterior: semAds ? null : num(A.anterior?.roas) } }), tacos: mAds('tacos', A.tacos), participacao_publicidade: mAds('participacao_publicidade', A.participacao_pct),
    // V3 F4: com financeiro.margem_medida_nas_regras ligada e cobertura ≥ mínimo, a margem MEDIDA nos pedidos (fato) vence a estimada pelos percentuais (projeção)
    margem_pre_ads: FM ? met('margem_medida', FM.margem_pct, { chave: 'conta:margem_pre_ads', tipo: 'fato' }) : met('margem_pre_ads', custos ? E?.margem_pre_ads_pct : null, { motivo: 'custos não informados (CMV, comissão, imposto)', periodo: 'custos vigentes' }),
    // margem − TACOS: o corte de dias sem coleta (parcial/null) já vem de diagnosticarConta (margem_pos_ads_motivo/_parcial), com o mesmo MAX_SEM_COLETA
    margem_pos_ads: FM ? met('margem_medida', FM.margem_pos_ads_pct, { chave: 'conta:margem_pos_ads', tipo: 'fato', motivo: 'sem Product Ads na mesma janela dos pedidos' })
      : met('margem_pos_ads', custos ? diag.margem_pos_ads_pct : null, { motivo: !custos ? 'custos não informados' : diag.margem_pos_ads_motivo || 'sem TACOS (custo de Ads ÷ receita total): sem Product Ads coletado ou sem receita no período', periodo: 'custos vigentes', parcial: diag.margem_pos_ads_parcial || null }),
    cancelamentos: met('cancelamentos', null), devolucoes: met('devolucoes', null),
    // saúde da conta gravada (diag.resumo.* vem de lerSaude): sem linha do dia → NOT_COLLECTED; bloco pendente → motivo fixo do config (nunca zero)
    reclamacoes: met('reclamacoes', R.reclamacoes, { motivo: motSaude('reclamacoes'), periodo: perSaude }),
    atrasos: met('atrasos', R.atrasos, { motivo: motSaude('atrasos'), periodo: perSaude }),
    perguntas: met('perguntas', R.perguntas?.mais_de_24h, { motivo: motSaude('perguntas'), periodo: perSaude, extra: { abertas: num(R.perguntas?.abertas) } }),
    reputacao: met('reputacao', R.reputacao?.taxa_claims, { motivo: motSaude('reputacao'), periodo: perSaude, texto: R.reputacao ? `Reputação ${R.reputacao.nivel || '—'}${R.reputacao.medalha ? ` (${R.reputacao.medalha})` : ''}: reclamações ${R.reputacao.taxa_claims ?? '—'}%, atrasos ${R.reputacao.taxa_atraso ?? '—'}%, cancelamentos ${R.reputacao.taxa_cancel ?? '—'}%` : '', extra: { nivel: R.reputacao?.nivel ?? null, medalha: R.reputacao?.medalha ?? null, taxa_atraso: num(R.reputacao?.taxa_atraso), taxa_cancel: num(R.reputacao?.taxa_cancel), vendas_periodo: num(R.reputacao?.vendas_periodo) } }),
  }
  const itens = diag.itens || []
  const porCurva = {}
  for (const c of ['A', 'B', 'C']) {
    const g = itens.filter(i => i.curva === c), cob = g.filter(i => i.visOk && i.v > 0)
    const rec = g.reduce((t, i) => t + (i.r || 0), 0), un = g.reduce((t, i) => t + (i.u || 0), 0), vis = cob.reduce((t, i) => t + i.v, 0), uc = cob.reduce((t, i) => t + i.u, 0)
    porCurva[c] = {
      n_anuncios: met('n_anuncios', g.length, { chave: `curva:${c}:n_anuncios` }),
      receita: met('receita', r2(rec), { chave: `curva:${c}:receita`, motivo: 'sem anúncio na curva' }),
      unidades: met('unidades', un, { chave: `curva:${c}:unidades` }),
      share_pct: met('share_pct', R.gmv > 0 ? r1(100 * rec / R.gmv) : null, { chave: `curva:${c}:share_pct`, motivo: 'sem GMV no período' }),
      conversao: met('conversao_curva', vis > 0 ? r2(100 * uc / vis) : null, { chave: `curva:${c}:conversao`, motivo: 'nenhum anúncio da curva coberto por visitas' }),
      estrategia: retro?.estrategia_por_grupo?.[c]?.estrategia ? { classe: retro.estrategia_por_grupo[c].estrategia.classe, provisoria: retro.estrategia_por_grupo[c].estrategia.provisoria, faltam: retro.estrategia_por_grupo[c].estrategia.faltam } : null,
    }
  }
  const anuncios = itens.map(i => {
    const k = key => `anuncio:${i.id}:${key}`, temAds = !!i.ads && (i.ads.custo > 0 || i.ads.prints > 0)
    const mi = (key, v, o = {}) => met(key, v, { chave: k(key), ...o })
    return {
      entidade: { tipo: 'anuncio', id: i.id }, titulo: i.titulo, permalink: i.permalink || '', curva: i.curva, classe: i.classe, status: i.status || '', catalogo_origem: i.catalogo_origem || 'nao', category_id: i.category_id || '',
      benchmark_ref: i.benchmark_ref || null,
      metrics: {
        receita: mi('receita', i.r, { extra: { anterior: num(i.r0) } }), unidades: mi('unidades', i.u, { extra: { anterior: num(i.u0) } }), share_pct: mi('share_pct', i.share_pct),
        preco_pago: mi('preco_pago', i.preco_realizado_28d, { motivo: 'sem venda no período' }),
        conversao_anuncio: mi('conversao_anuncio', i.conv, { motivo: i.conv_invalida ? 'conversão acima de 100%: visitas registradas em outro anúncio do mesmo produto' : !i.visOk ? 'visitas não cobrem o período inteiro' : 'sem visita no período' }),
        cobertura: mi('cobertura', i.cobertura, { motivo: i.estoque == null ? 'estoque não lido' : 'sem venda no período (sem ritmo para calcular)' }),
        giro: mi('giro', i.giro, { motivo: 'sem estoque' }), ponto_reposicao: mi('ponto_reposicao', i.ponto_reposicao, { motivo: 'sem venda no período' }),
        ctr_ads: mi('ctr_ads', temAds ? i.ads.ctr : null, { motivo: temAds ? 'sem impressões' : 'sem Product Ads neste anúncio', periodo: adsJanela, extra: { anterior: num(i.ads_ant?.ctr) } }),
        acos: mi('acos', temAds ? i.ads.acos : null, { motivo: temAds ? 'sem receita atribuída' : 'sem Product Ads neste anúncio', periodo: adsJanela }),
        roas: mi('roas', temAds ? i.ads.roas : null, { motivo: temAds ? 'sem custo' : 'sem Product Ads neste anúncio', periodo: adsJanela }),
        cpc: mi('cpc', temAds && i.ads.clicks > 0 ? r2(i.ads.custo / i.ads.clicks) : null, { motivo: temAds ? 'sem cliques' : 'sem Product Ads neste anúncio', periodo: adsJanela }),
        margem_pre_ads: i.financeiro?.margem_pct != null ? mi('margem_medida', i.financeiro.margem_pct, { tipo: 'fato', chave: k('margem_pre_ads') }) : mi('margem_pre_ads', custos ? margemPct(diag.custos, i.preco, i.custo_unitario) : null, { motivo: 'custos não informados', periodo: 'custos vigentes' }),
      },
    }
  })
  // ── ações (regras do plano) → evidências, issues, opportunities, actions, listing/campaign ──
  const unDe = new Map((diag.itens || []).map(i => [i.id, i.u]))
  // ação antiga de "campeão de vendas" (urgencia_oculta) cujo anúncio não vendeu na janela atual: o gerador já não a produz; aqui ela sai do contrato (regra: zero medido nunca vira "campeão")
  const vivas = acoes.filter(a => a && !['descartada', 'obsoleta'].includes(a.status) && !(String(a.regra || '').endsWith('urgencia_oculta') && a.item_id && unDe.has(a.item_id) && !(unDe.get(a.item_id) > 0)))
  const vivasIds = new Set(vivas.map(a => a.id))
  const acts = vivas.map(a => {
    const d = a.dados || {}, regra = String(a.regra || '').replace(/^anuncio_/, '')
    const prev = a.previsao ?? (a.previsao_json ? seguroJson(a.previsao_json) : null)
    const ent = d.entidade || (a.item_id ? { tipo: 'anuncio', id: a.item_id } : { tipo: 'conta', id: cliente })
    const ids = []
    if (d.evidencia) ids.push(ev({ chave: `acao:${a.id}:evidencia`, tipo: TIPOS_EVIDENCIA.includes(d.evidencia_tipo) ? d.evidencia_tipo : 'hipotese', texto: d.evidencia, fonte: d.fonte || 'regra do plano', periodo: d.periodo || janela }))
    if (prev && ['ganho', 'risco_evitado'].includes(prev.tipo)) ids.push(ev({ chave: `acao:${a.id}:previsao`, tipo: 'projecao', valor: num(prev.valor_esperado), unidade: 'BRL', texto: `${prev.tipo === 'risco_evitado' ? 'risco evitado' : 'ganho'} esperado (${prev.formula || 'hipótese'}; premissas: ${(prev.premissas || []).join('; ')}) — cenário base ${prev.cenarios?.base?.receita ?? '—'}`, fonte: `previsão por hipótese, p=${prev.p_sucesso ?? '—'} (${prev.p_fonte || 'premissa'})`, periodo: `${prev.horizonte_dias || 28} dias` }))
    // dependência descartada/obsoleta (salvarAcoesAnuncio não reescreve as distribuídas): sai de depende_de e vira rótulo, nunca um id órfão que derrube o contrato
    const dep = [].concat(d.depende_de || []), depVivas = dep.filter(id => vivasIds.has(id))
    const limites = [
      ...(d.dependencia && d.dependencia !== '—' ? [`depende de: ${d.dependencia}`] : []),
      ...(depVivas.length < dep.length ? ['dependência encerrada (descartada ou obsoleta): a ação segue sem ela'] : []),
      ...(d.catalogo?.texto ? [d.catalogo.texto] : []),
      ...(d.duplicacao?.exige_briefing_consultor ? ['exige briefing do consultor (objetivo e volume da duplicação)'] : []),
      ...(d.exige_pesquisa_consultor ? ['exige pesquisa do consultor (urgência oculta)'] : []),
      'nada é executado pelo motor: preço, Ads, estoque e conteúdo são decisão humana',
    ]
    return {
      id: a.id, regra, entidade: ent, nivel: d.nivel || ent.tipo, o_que: a.titulo, por_que: { evidence_ids: ids, evidencia_tipo: d.evidencia_tipo || null, hipotese: d.hipotese || '', problema: d.problema || '' },
      como: d.como || [], responsavel: a.responsavel || '', delegado_a: a.delegado_a || '', prazo: a.prazo, horizonte: a.horizonte, depende_de: depVivas, limites,
      metrica_sucesso: { indicador: d.indicador_inicial || '', meta: d.meta || '', aceite: d.criterio_aceite || '' }, parada: d.parada || '', revisar_em: d.revisar_em || null,
      prioridade: { p: d.prioridade?.p ?? null, nota: d.prioridade?.nota ?? a.score ?? null, componentes: d.prioridade?.componentes ?? null, fila: d.fila || null },
      previsao: prev ? { tipo: prev.tipo, hipotese: prev.hipotese !== false, valor_esperado: num(prev.valor_esperado), p_sucesso: num(prev.p_sucesso), p_fonte: prev.p_fonte || '', cenarios: prev.cenarios || null, horizonte_dias: prev.horizonte_dias ?? null, aviso: prev.aviso || '' } : null,
      executar_via: EXECUTORES.includes(d.executar_via) ? d.executar_via : 'notion', status: a.status, causas_possiveis: d.causas_possiveis || [], confirmar_com: d.confirmar_com || [], processo: d.processo ? { id: d.processo.id, nome: d.processo.nome } : null, catalogo_origem: d.item?.catalogo_origem || 'nao', _dados: d,
    }
  })
  const problema = x => ({ acao_id: x.id, regra: x.regra, entidade: x.entidade, nivel: x.nivel, texto: x.por_que.problema || x.o_que, evidencia_tipo: x.por_que.evidencia_tipo, evidence_ids: x.por_que.evidence_ids, causas_possiveis: x.causas_possiveis, confirmar_com: x.confirmar_com, prioridade: x.prioridade.p, confianca: x._dados.confianca == null || x._dados.confianca === '' ? null : clamp15(x._dados.confianca) })
  const issues = acts.filter(x => !REGRAS_OPORTUNIDADE.has(x.regra)).map(problema)
  const opportunities = acts.filter(x => REGRAS_OPORTUNIDADE.has(x.regra)).map(x => ({ ...problema(x), texto: x._dados.oportunidade || x.por_que.hipotese || x.o_que, oportunidade: x._dados.oportunidade || null }))
  const porItem = new Map()
  for (const x of acts) if (x.entidade.tipo === 'anuncio') (porItem.get(x.entidade.id) || porItem.set(x.entidade.id, []).get(x.entidade.id)).push(x)
  const anuncioDe = id => anuncios.find(a => a.entidade.id === id)
  const listing_diagnoses = [...porItem].map(([id, lst]) => {
    const an = anuncioDe(id)
    return { entidade: { tipo: 'anuncio', id }, nivel: 'anuncio', titulo: an?.titulo || lst[0]._dados.item?.titulo || '', curva: an?.curva || lst[0]._dados.item?.curva || null, catalogo_origem: an?.catalogo_origem || lst[0].catalogo_origem,
      evidence_ids: an ? Object.values(an.metrics).map(m => m.evidence_id).filter(Boolean) : [],
      problemas: lst.map(x => ({ regra: x.regra, problema: x.por_que.problema || x.o_que, evidence_ids: x.por_que.evidence_ids, confianca: clamp15(x._dados.confianca), causas_possiveis: x.causas_possiveis, confirmar_com: x.confirmar_com, oportunidade: REGRAS_OPORTUNIDADE.has(x.regra) })) }
  })
  const campaign_diagnoses = {
    granularidade: 'anuncio',
    itens: anuncios.filter(a => a.metrics.ctr_ads.valor != null || a.metrics.acos.valor != null || a.metrics.roas.valor != null).map(a => ({
      entidade: a.entidade, titulo: a.titulo, ctr: a.metrics.ctr_ads, cpc: a.metrics.cpc, acos: a.metrics.acos, roas: a.metrics.roas, evidence_ids: ['ctr_ads', 'cpc', 'acos', 'roas'].map(k => a.metrics[k].evidence_id).filter(Boolean),
      regras: (porItem.get(a.entidade.id) || []).filter(x => /^ads_|^queda_ctr_ads$/.test(x.regra)).map(x => ({ acao_id: x.id, regra: x.regra, problema: x.por_que.problema || x.o_que })),
    })),
    conta: { ctr: conta.ctr_ads, cpc: conta.cpc, custo_por_pedido: conta.custo_por_pedido_ads, acos: conta.acos, roas: conta.roas, tacos: conta.tacos, participacao_publicidade: conta.participacao_publicidade, economia: E ? { roas_alvo: E.roas_alvo, acos_max_pct: E.acos_max_pct, viavel: E.viavel, nota: E.nota } : null, meta: diag.metas ? { roas: diag.metas.roas, acos_max: diag.metas.acos_max } : null,
      evidence_ids: [
        num(E?.roas_alvo) != null && ev({ chave: 'conta:roas_alvo', tipo: 'projecao', valor: num(E.roas_alvo), unidade: 'x', texto: `ROAS alvo pelos custos informados: ${num(E.roas_alvo)}`, fonte: 'custos_cliente (economiaAds)', periodo: 'custos vigentes' }),
        num(E?.acos_max_pct) != null && ev({ chave: 'conta:acos_max_pct', tipo: 'projecao', valor: num(E.acos_max_pct), unidade: '%', texto: `ACOS máximo pelos custos informados: ${num(E.acos_max_pct)}%`, fonte: 'custos_cliente (economiaAds)', periodo: 'custos vigentes' }),
        num(diag.metas?.roas) != null && ev({ chave: 'conta:meta_roas', valor: num(diag.metas.roas), unidade: 'x', texto: `Meta de ROAS do mês: ${num(diag.metas.roas)}`, fonte: 'metas_cliente', periodo: hoje.slice(0, 7) }),
        num(diag.metas?.acos_max) != null && ev({ chave: 'conta:meta_acos_max', valor: num(diag.metas.acos_max), unidade: '%', texto: `Meta de ACOS máximo do mês: ${num(diag.metas.acos_max)}%`, fonte: 'metas_cliente', periodo: hoje.slice(0, 7) }),
      ].filter(Boolean) },
    pendencia: { estado: 'NOT_SUPPORTED', item: 'campanhas de Product Ads', motivo: 'a leitura é por anúncio: id de campanha, orçamento e palavra-chave não são coletados nesta versão' + (semAds ? '; esta conta não tem Product Ads coletado' : '') },
  }
  // ── diagnóstico da conta: estado + estratégia (retroalimentação), causal (diagnóstico), concentração (pareto), tese do Merovíngio ──
  const est = retro?.estado || null
  const idEstado = est ? ev({ chave: 'conta:estado', tipo: est.significativo === true && !est.sinal_misto ? 'fato' : 'hipotese', valor: num(est.variacao_pct), unidade: '%', texto: `${est.rotulo || est.estado}: ${est.motivo || ''}`.trim(), fonte: 'retroalimentação (classificarEstado)', periodo: est.janela ? `${est.janela.anterior?.[0] || ''}..${est.janela.atual?.[1] || ''}` : janela }) : null
  const par = retro?.pareto?.itens?.disponivel ? retro.pareto.itens : null
  const idConc = par ? ev({ chave: 'conta:concentracao_top1', valor: num(par.concentracao_top1_pct), unidade: '%', texto: par.leitura, fonte: 'retroalimentação (paretoItens)' }) : null
  const idsConc = par ? [idConc, ...[['conta:concentracao_n80', par.n_80, 'Anúncios que somam 80% da receita'], ['conta:concentracao_n', par.n_anuncios, 'Anúncios com receita no período']].filter(([, v]) => num(v) != null)
    .map(([chave, v, t]) => ev({ chave, valor: num(v), unidade: null, texto: `${t}: ${num(v)}`, fonte: 'retroalimentação (paretoItens)' }))] : []
  // cobertura da coleta (data_quality): contagens viram evidência; sem coleta de pedidos (de nulo) não nasce nada e o relatório mostra "—"
  const cob = dq.cobertura || {}
  const idsCob = [
    ...(cob.pedidos?.de ? [ev({ chave: 'cobertura:pedidos_lacunas', valor: (cob.pedidos.lacunas || []).length, unidade: 'dias', texto: `Dias sem coleta de pedidos nas janelas comparadas: ${(cob.pedidos.lacunas || []).length}`, fonte: 'meli_coleta_dia' }),
      ev({ chave: 'cobertura:pedidos_truncados', valor: num(cob.pedidos.truncados) ?? 0, unidade: 'dias', texto: `Dias truncados pela API nas janelas comparadas: ${num(cob.pedidos.truncados) ?? 0}`, fonte: 'meli_coleta_dia' })] : []),
    ...(num(cob.visitas?.anuncios_total) > 0 ? [ev({ chave: 'cobertura:visitas_cobertos', valor: num(cob.visitas.anuncios_cobertos) ?? 0, unidade: null, texto: `Anúncios com visitas no período inteiro: ${num(cob.visitas.anuncios_cobertos) ?? 0}`, fonte: 'meli_serie_item (visitas)' }),
      ev({ chave: 'cobertura:visitas_total', valor: num(cob.visitas.anuncios_total), unidade: null, texto: `Anúncios lidos: ${num(cob.visitas.anuncios_total)}`, fonte: 'meli_item' })] : []),
  ]
  const account_diagnosis = {
    estado: est ? { estado: est.estado, rotulo: est.rotulo, variacao_pct: num(est.variacao_pct), forca: est.forca ?? null, significativo: est.significativo ?? null, sinal_misto: !!est.sinal_misto, motivo: est.motivo || '', aviso_coleta: est.aviso_coleta || null } : { estado: null, motivo: retro === null ? 'retroalimentação indisponível (sem série coletada ou erro declarado em avisos)' : 'sem estado' },
    estrategia: retro?.estrategia ? { ...retro.estrategia } : null,
    por_grupo: retro?.estrategia_por_grupo || null,
    causal: diag.causal || null,
    concentracao: par ? { top1_pct: par.concentracao_top1_pct, n_80: par.n_80, n_anuncios: par.n_anuncios, alerta: par.alerta, itens: par.itens.map(i => ({ id: i.id, titulo: i.titulo, share_pct: i.share_pct, acum_pct: i.acum_pct })), evidence_ids: idsConc } : null,
    alinhamentos: (alinhamentos || []).map(a => ({ id: a.id, tipo: a.tipo, rotulo: a.rotulo, rotulo_cliente: a.rotulo_cliente, texto_cliente: a.texto_cliente, escopo: a.escopo, chave: a.chave, regras: a.regras || [],
      motivo: a.motivo || '', acos_alvo: a.acos_alvo ?? null, por: a.por, origem: a.origem, desde: a.desde, revisar_em: a.revisar_em || null, permanente: !!a.permanente, estado: a.estado })),
    leitura_merovingio: merov?.arquetipo ? { arquetipo: merov.arquetipo.rotulo, tese: merov.arquetipo.tese, falsificador: merov.falsificador || null } : merov?.motivo ? { arquetipo: null, tese: null, motivo: merov.motivo } : null,
    evidence_ids: [conta.receita.evidence_id, conta.variacao.evidence_id, conta.conversao_conta.evidence_id, conta.roas.evidence_id, conta.acos.evidence_id, conta.tacos.evidence_id, conta.margem_pos_ads.evidence_id, idEstado, idConc].filter(Boolean),
  }
  // ── prompts derivados ──
  const derived_prompts = []
  for (const x of acts) {
    const tipos = x.entidade.tipo === 'conta' ? ['plano_conta'] : PROMPT_POR_REGRA[x.regra] || []
    const terceiros = x.entidade.tipo === 'anuncio' && (anuncioDe(x.entidade.id)?.catalogo_origem || x.catalogo_origem) === 'terceiros'
    for (const tipo of tipos) {
      if (terceiros && !PROMPTS_CATALOGO_TERCEIROS.has(tipo)) continue
      derived_prompts.push(promptDerivado(tipo, x, { cliente, diag, retro, ofertas, ambiente, acts, anuncio: x.entidade.tipo === 'anuncio' ? anuncioDe(x.entidade.id) : null }))
    }
  }
  // ── plano de revisão ──
  const review_plan = {
    ritual: algoritmo.ritual,
    proximas_revisoes: [
      ...acts.filter(x => x.revisar_em).map(x => ({ acao_id: x.id, em: x.revisar_em, o_que_conferir: `${x.metrica_sucesso.indicador || 'indicador'} → meta: ${x.metrica_sucesso.meta || '—'}; parada: ${x.parada || '—'}` })),
      ...(retro?.estrategia?.revisar_em ? [{ acao_id: 'conta', em: retro.estrategia.revisar_em, o_que_conferir: `estado da conta (${est?.rotulo || '—'}) e estratégia ${retro.estrategia.classe}${retro.estrategia.provisoria ? ` (provisória: faltam ${retro.estrategia.faltam.join(', ')})` : ''}; ${(retro.estrategia.condicoes_revisao || []).join(' ')}` }] : []),
    ].sort((a, b) => String(a.em).localeCompare(String(b.em))),
    ciclo_anterior: retro?.ciclo_anterior || null,
    sinal_misto: !!est?.sinal_misto,
  }
  const actions = acts.map(({ _dados, causas_possiveis, confirmar_com, catalogo_origem, ...x }) => x).sort((a, b) => (b.prioridade.nota ?? 0) - (a.prioridade.nota ?? 0))
  return {
    versao: VERSAO, canal: 'mercadolivre', cliente, gerado_em: agora(), periodo: { de: per.de, ate: per.ate, anterior: per.anterior, dias: 28 }, canais_suportados: { ...CANAIS_SUPORTADOS },
    disponivel: true, avisos,
    data_quality: { ...dq, evidence_ids: idsCob },
    metrics: { conta, por_curva: porCurva, anuncios },
    evidence: [...evs.values()],
    account_diagnosis, listing_diagnoses, campaign_diagnoses, issues, opportunities, actions, derived_prompts, review_plan,
    plano_cliente: plano ? { gerado_em: plano.gerado_em || plano._gerado_em || null, n_acoes: plano.resumo?.n_acoes ?? null, gargalos: plano.diagnostico?.gargalos || [], riscos: plano.diagnostico?.riscos || [] } : null,
  }
}
const clamp15 = n => { const v = n == null || n === '' ? NaN : Number(n); return Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 3 }
const seguroJson = s => { try { return JSON.parse(s) } catch { return null } }

// conta sem dados do Mercado Livre: contrato mínimo honesto (data_quality com tudo indisponível + 3 canais NOT_SUPPORTED), nunca zeros
function indisponivel(cliente, { hoje, diag, avisos, conta = null }) {
  return {
    versao: VERSAO, canal: 'mercadolivre', cliente, gerado_em: agora(), periodo: null, canais_suportados: { ...CANAIS_SUPORTADOS },
    disponivel: false, motivo: diag?.motivo || 'sem dados coletados do Mercado Livre', avisos,
    data_quality: qualidadeDados({ conta, hoje }),
    metrics: { conta: {}, por_curva: { A: {}, B: {}, C: {} }, anuncios: [] }, evidence: [],
    account_diagnosis: { estado: { estado: null, motivo: 'sem dados' }, estrategia: null, por_grupo: null, causal: null, concentracao: null, evidence_ids: [] },
    listing_diagnoses: [], campaign_diagnoses: { granularidade: 'anuncio', itens: [], conta: null, pendencia: { estado: 'NOT_SUPPORTED', item: 'campanhas de Product Ads', motivo: 'conta sem dados coletados' } },
    issues: [], opportunities: [], actions: [], derived_prompts: [],
    review_plan: { ritual: algoritmo.ritual, proximas_revisoes: [], ciclo_anterior: null, sinal_misto: false },
  }
}

// ── prompt derivado de UMA ação: texto determinístico (a IA, quando existir, só reescreve), insumos usados, restrições e o que falta ──
const ROT_TIPO = { titulo_descricao: 'título e descrição', imagens: 'galeria de imagens', atributos: 'ficha técnica', oferta_kit: 'kit', campanha: 'Product Ads', preco: 'preço', plano_conta: 'plano da conta' }
function promptDerivado(tipo, x, { cliente, diag, retro, ofertas, ambiente, acts, anuncio }) {
  const id = x.entidade.id, of = x.entidade.tipo === 'anuncio' ? ofertas?.porItem?.get?.(id) || null : null
  const ficha = of?.ficha || null
  const preservar = ficha ? checarPreservacao(ficha, '').preservar : []
  const faltam = [], insumos = { entidade: x.entidade, regra: x.regra, acao: x.o_que, evidencia_ids: x.por_que.evidence_ids, causas_possiveis: x.causas_possiveis.map(c => c.causa), processo: x.processo, metrica_sucesso: x.metrica_sucesso, parada: x.parada }
  const deConteudo = ['titulo_descricao', 'imagens', 'atributos', 'oferta_kit'].includes(tipo)
  if (deConteudo) {
    if (!ficha) faltam.push({ item: 'ficha do produto (módulo de Ofertas)', estado: 'NOT_COLLECTED', como_obter: 'cadastrar produto e variante no módulo de Ofertas e vincular o anúncio (of_anuncio)' })
    else if (!of.referencia_confirmada) faltam.push({ item: 'GATE 0: referência confirmada pelo dono', estado: 'NEEDS_EXTERNAL_DATA', como_obter: 'o dono confirma a folha de bases da variante no módulo de Ofertas (confirmarReferencia)' })
    if (ficha) insumos.ficha = { nome: ficha.nome || '', marca: ficha.marca || '', modelo: ficha.modelo || '', cor: ficha.cor || '', tamanho: ficha.tamanho || '', material: ficha.material || '', quantidade_kit: ficha.quantidade_kit ?? null, atributos_com_fonte: (ficha.atributos || []).filter(a => a.fonte).length }
    if (tipo !== 'atributos' && !of?.voz_coletada) faltam.push({ item: 'voz do cliente (perguntas e avaliações do anúncio)', estado: 'NOT_AUTHORIZED', como_obter: 'escopo de perguntas não autorizado no app do Mercado Livre (403): solicitar a permissão ou registrar perguntas/avaliações no job de Ofertas' })
  }
  if (tipo === 'imagens') {
    const g = CFG_OFERTAS.galeria_padrao.mercadolivre
    insumos.galeria = { papeis: g.papeis, quantidade: g.quantidade, formato: g.formato, resolucao: g.resolucao, texto_permitido: g.texto_permitido, observacao: g.observacao }
    if (!ambiente?.fal_key) faltam.push({ item: 'FAL_KEY (geração de imagens)', estado: 'NEEDS_EXTERNAL_DATA', como_obter: 'adicionar FAL_KEY ao .env e reiniciar o servidor; sem ela a galeria fica como briefing para produção manual' })
  }
  if (tipo === 'titulo_descricao' && ficha && of?.titulo_proposto) {
    const c = checarPreservacao(ficha, of.titulo_proposto, { campos: CAMPOS_PRESERVAR_TITULO })
    if (!c.ok) faltam.push({ item: `título proposto perde ${c.faltantes.map(f => `${ROTULO_PRESERVAR[f.campo] || f.campo}=${f.valor}`).join(', ')}`, estado: 'NEEDS_EXTERNAL_DATA', como_obter: 'o título de 60 caracteres não traz um dado da ficha com fonte: o consultor decide o que fica (o corte nunca é silencioso)' })
  }
  if (x.regra === 'duplicacao_estrategica') {
    insumos.duplicacao = { definicao: DUPLICACAO.definicao, objetivo: x._dados.duplicacao?.objetivo || null, gatilho: x._dados.duplicacao?.gatilho || null, tipo: DUPLICACAO.tipos.find(t => t.id === x._dados.duplicacao?.objetivo)?.volume?.texto || null }
    if (!of?.briefing) faltam.push({ item: 'briefing do consultor (objetivo, volume e variações da duplicação)', estado: 'NEEDS_EXTERNAL_DATA', como_obter: 'o consultor registra o briefing no job de Ofertas (config/duplicacao.json); o texto só nasce depois' })
  }
  if (tipo === 'preco' && !diag.custos_informados) faltam.push({ item: 'custos do cliente (CMV, comissão, imposto)', estado: 'NEEDS_EXTERNAL_DATA', como_obter: 'informar na tela do cliente (Custos); sem eles não existe margem, piso nem desconto máximo' })
  if (tipo === 'campanha') insumos.ads = { ctr: anuncio?.metrics.ctr_ads.valor ?? null, acos: anuncio?.metrics.acos.valor ?? null, roas: anuncio?.metrics.roas.valor ?? null, meta: diag.metas ? { roas: diag.metas.roas, acos_max: diag.metas.acos_max } : null, roas_alvo: diag.economia?.roas_alvo ?? null }
  if (tipo === 'plano_conta') insumos.conta = { estado: retro?.estado?.rotulo || null, estrategia: retro?.estrategia ? { classe: retro.estrategia.classe, provisoria: retro.estrategia.provisoria, faltam: retro.estrategia.faltam } : null, n_acoes: acts.length }
  // todo trecho LIVRE (texto da regra gravado na ação, valor da ficha, nome do cliente, rótulos da retroalimentação) passa pelo auditor interno ANTES de entrar no texto:
  // reprovado (valor quebrado "null%", promessa, causalidade…) → frase fixa neutra + insumo faltante (prompt pendente). Um texto ruim nunca derruba o contrato inteiro.
  let reprovados = 0
  const livre = (t, neutro) => { const v = String(t ?? '').trim(); if (!v) return neutro; if (auditarInterno(v).length) { reprovados++; return neutro } return v }
  const n0 = (v, padrao) => num(v) ?? padrao
  const presLivre = preservar.length ? preservar.map(p => `${ROTULO_PRESERVAR[p.campo] || p.campo}=${p.valor} (${p.fonte})`).join('; ') : 'nenhum dado da ficha com fonte'
  const pres = () => livre(presLivre, 'os dados da ficha com fonte (ver restricoes.preservar)')
  const c0 = x.causas_possiveis[0]
  const sinal = () => livre(c0 ? `${c0.causa} (hipótese; sinal: ${c0.sinal})` : x.por_que.problema || x.o_que, 'o motivo registrado na ação')
  const oQue = () => livre(x.o_que, 'a ação registrada'), porQue = () => livre(x.por_que.problema || x.por_que.hipotese, ''), hipo = () => livre(x.por_que.hipotese || x.o_que, 'hipótese registrada na ação')
  const ind = (padrao) => livre(x.metrica_sucesso.indicador, padrao), parada = (padrao) => livre(x.parada, padrao)
  const janela = (padrao) => n0(x._dados.prova_janela_dias, padrao)
  const nomeCli = () => livre(cliente, 'da conta'), estadoTxt = () => livre(retro?.estado?.rotulo, 'sem leitura')
  const estrTxt = () => retro?.estrategia ? livre(`, estratégia ${retro.estrategia.classe}${retro.estrategia.provisoria ? ` (provisória: faltam ${(retro.estrategia.faltam || []).join(', ')})` : ''}`, '') : ''
  const roasAlvo = num(diag.economia?.roas_alvo)
  const texto = {
    titulo_descricao: () => `Redigir título (até 60 caracteres) e descrição do anúncio ${id} a partir dos fatos da ficha, na ordem do método: imagens primeiro, título depois. Motivo da ação: ${sinal()}. Preservar: ${pres()}. Sem termo promocional, sem termo de promessa, sem característica que não esteja na ficha. Medir: ${ind('conversão')} em ${janela(14)} dias.`,
    imagens: () => `Produzir ${CFG_OFERTAS.galeria_padrao.mercadolivre.quantidade} imagens para o anúncio ${id} na ordem ${CFG_OFERTAS.galeria_padrao.mercadolivre.papeis.join(', ')} (${CFG_OFERTAS.galeria_padrao.mercadolivre.formato} ${CFG_OFERTAS.galeria_padrao.mercadolivre.resolucao}; capa sem texto), só com referência confirmada pelo dono. Motivo da ação: ${sinal()}. Preservar na imagem: ${pres()}. Nenhuma característica inventada. Medir: ${ind('conversão e CTR de Ads')} em ${janela(14)} dias.`,
    atributos: () => `Preencher a ficha técnica do anúncio ${id} com fonte e evidência por atributo; identidade (MPN, fabricante, modelo) sem termo promocional. Motivo da ação: ${sinal()}. Preservar: ${pres()}. Atributo sem fonte não entra. Medir: ${ind('visitas/dia')} em ${janela(14)} dias.`,
    oferta_kit: () => `Propor um kit (2 a 3 unidades) a partir do anúncio ${id}, como hipótese a testar com a pesquisa do consultor (urgência oculta). Motivo: ${hipo()}. Preservar a identidade do produto: ${pres()}. Sem termo promocional e sem estimativa de vendas no texto. Medir: unidades do kit e ticket médio em 14 dias.`,
    campanha: () => `Ajustar o anúncio ${id} no Product Ads (por anúncio: id de campanha não é coletado, NOT_SUPPORTED). Motivo: ${sinal()}. Limite: ${parada('reavaliar na data de revisão')}. ${roasAlvo ? `ROAS alvo ${roasAlvo} (custos informados).` : 'Sem custos informados não existe ROAS alvo: comparar com o ROAS da própria conta.'} Medir: ${ind('ROAS e ACOS')} em ${janela(7)} dias.`,
    preco: () => `Revisar o preço do anúncio ${id}: ${sinal()}. Uma única mudança, sem mexer em título e fotos por 14 dias, comparada com os anúncios sem mudança de preço. ${diag.custos_informados ? 'Margem pelos custos informados.' : 'Sem custos informados: nenhuma afirmação de margem.'} Parada: ${parada('reverter se vendas/dia caírem abaixo do baseline')}.`,
    plano_conta: () => `Redigir o resumo do plano da conta de ${nomeCli()}: estado ${estadoTxt()}${estrTxt()}, ${acts.length} ação(ões) priorizada(s). Esta ação: ${oQue()}${(p => p ? ` — ${p}` : '')(porQue())}. Usar só os números das evidências citadas; coincidência no tempo é hipótese, nunca causa; sem termo de promessa.`,
  }[tipo]()   // só os trechos do template escolhido passam pelo auditor (e contam como reprovados)
  if (reprovados) faltam.push({ item: 'texto de origem da ação fora do padrão (valor ausente, promessa ou causalidade): substituído por frase neutra', estado: 'NOT_AVAILABLE', como_obter: 'corrigir a regra que gerou o texto e regerar o plano da conta (POST /api/plano-conta/gerar); até lá o prompt usa a frase neutra' })
  return {
    id: 'dp-' + sha(`${cliente}|${x.id}|${tipo}`), tipo, rotulo: ROT_TIPO[tipo], entidade: x.entidade, acao_id: x.id, estado: faltam.length ? 'pendente' : 'pronto',
    insumos, restricoes: { preservar, proibido: [...PROIBIDO] }, insumos_faltantes: faltam, texto,
  }
}

// ── validador do contrato: escrito à mão, sem dependência; cada falha é uma frase fixa (nunca ecoa o valor recebido) ──
const ENUM_CANAL = ['SUPPORTED', 'NOT_SUPPORTED']
export function validarContrato(json) {
  const erros = []
  const falha = m => { erros.push(m) }
  if (!json || typeof json !== 'object') return { ok: false, erros: ['contrato não é um objeto'] }
  const tipos = { versao: 'string', canal: 'string', cliente: 'string', gerado_em: 'string', canais_suportados: 'object', data_quality: 'object', metrics: 'object', evidence: 'array', account_diagnosis: 'object', listing_diagnoses: 'array', campaign_diagnoses: 'object', issues: 'array', opportunities: 'array', actions: 'array', derived_prompts: 'array', review_plan: 'object' }
  for (const [k, t] of Object.entries(tipos)) {
    if (!(k in json)) { falha(`falta a chave "${k}"`); continue }
    if (t === 'array' ? !Array.isArray(json[k]) : (typeof json[k] !== t || json[k] === null || Array.isArray(json[k]))) falha(`chave "${k}" com tipo errado`)
  }
  if (erros.length) return { ok: false, erros }
  if (json.versao !== VERSAO) falha('versao diferente da do algoritmo')
  if (json.canal !== 'mercadolivre') falha('canal fora da lista suportada')
  if (typeof json.disponivel !== 'boolean') falha('disponivel ausente ou não booleano')
  const dataStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (json.disponivel === true && !(json.periodo && typeof json.periodo === 'object' && dataStr(json.periodo.de) && dataStr(json.periodo.ate) && json.periodo.anterior && typeof json.periodo.anterior === 'object' && dataStr(json.periodo.anterior.de) && dataStr(json.periodo.anterior.ate))) falha('periodo incompleto')
  for (const c of Object.keys(CANAIS_SUPORTADOS)) if (!ENUM_CANAL.includes(json.canais_suportados[c])) falha(`canais_suportados sem "${c}" válido`)
  if (json.canais_suportados.mercadolivre !== 'SUPPORTED') falha('mercadolivre precisa ser SUPPORTED')
  const dq = json.data_quality
  if (!Array.isArray(dq.fontes) || !dq.cobertura || typeof dq.cobertura !== 'object' || !Array.isArray(dq.analises_bloqueadas) || !Array.isArray(dq.incompatibilidades)) falha('data_quality incompleto (fontes, cobertura, analises_bloqueadas, incompatibilidades)')
  else {
    for (const f of dq.fontes) if (!f || !['disponivel', 'parcial', 'indisponivel'].includes(f.status)) { falha('fonte de data_quality com status fora do enum'); break }
    for (const b of dq.analises_bloqueadas) if (!b || !ESTADOS_BLOQUEIO.includes(b.estado)) { falha('análise bloqueada com estado fora do enum'); break }
    for (const b of dq.analises_bloqueadas) if (b && !(typeof b.analise === 'string' && b.analise && typeof b.motivo === 'string' && b.motivo && typeof b.como_obter === 'string' && b.como_obter)) { falha('análise bloqueada sem analise/motivo/como_obter'); break }
  }
  const ids = new Set()
  for (const e of json.evidence) {
    if (!e || typeof e !== 'object') { falha('evidência não é objeto'); continue }
    if (typeof e.id !== 'string' || !/^ev-[0-9a-f]{10}$/.test(e.id)) falha('evidência com id fora do formato')
    else if (ids.has(e.id)) falha('evidência com id repetido'); else ids.add(e.id)
    if (!TIPOS_EVIDENCIA.includes(e.tipo)) falha('evidência com tipo fora do enum')
    if (typeof e.chave !== 'string' || !e.chave) falha('evidência sem chave')
    if (e.valor != null && !(typeof e.valor === 'number' && Number.isFinite(e.valor))) falha('evidência com valor não numérico ou não finito')
  }
  const cita = (id, onde) => { if (id == null) return; if (typeof id !== 'string' || !ids.has(id)) falha(`evidence_id órfão em ${onde}`) }
  const citaLista = (lista, onde) => { if (!Array.isArray(lista)) { falha(`${onde} sem lista de evidence_ids`); return } for (const id of lista) cita(id, onde) }
  const metrica = (m, onde) => {
    if (!m || typeof m !== 'object') { falha(`métrica inválida em ${onde}`); return }
    if (!('valor' in m)) { falha(`métrica sem valor em ${onde}`); return }
    if (m.valor != null && typeof m.valor !== 'number') falha(`métrica com valor não numérico em ${onde}`)
    else if (typeof m.valor === 'number' && !Number.isFinite(m.valor)) falha(`métrica com valor não finito em ${onde}`)
    if (m.valor == null && m.evidence_id != null) falha(`métrica nula com evidence_id em ${onde}`)
    if (typeof m.valor === 'number' && (typeof m.formula !== 'string' || !m.formula)) falha(`métrica com valor e sem fórmula em ${onde}`)
    if (m.valor === 0 && m.motivo) falha(`métrica com valor 0 e motivo em ${onde} (ausente é null)`)
    if (m.valor == null && !m.motivo) falha(`métrica nula sem motivo em ${onde}`)
    if (typeof m.valor === 'number' && !m.evidence_id) falha(`métrica com valor sem evidence_id em ${onde}`)
    cita(m.evidence_id, onde)
  }
  const M = json.metrics
  if (!M.conta || typeof M.conta !== 'object' || !M.por_curva || typeof M.por_curva !== 'object' || !Array.isArray(M.anuncios)) falha('metrics incompleto (conta, por_curva, anuncios)')
  else {
    for (const [k, m] of Object.entries(M.conta)) metrica(m, `metrics.conta.${k}`)
    for (const c of ['A', 'B', 'C']) { if (!M.por_curva[c] || typeof M.por_curva[c] !== 'object') { falha(`metrics.por_curva sem curva ${c}`); continue } for (const [k, m] of Object.entries(M.por_curva[c])) if (k !== 'estrategia') metrica(m, `metrics.por_curva.${c}.${k}`) }
    for (const a of M.anuncios) { if (!a?.entidade?.id || a.entidade.tipo !== 'anuncio' || !a.metrics) { falha('anúncio de metrics sem entidade/metrics'); continue } for (const [k, m] of Object.entries(a.metrics)) metrica(m, `metrics.anuncios[].${k}`) }
  }
  const AD = json.account_diagnosis
  citaLista(AD.evidence_ids, 'account_diagnosis')
  if (AD.concentracao?.evidence_ids) citaLista(AD.concentracao.evidence_ids, 'account_diagnosis.concentracao')
  if (dq.evidence_ids) citaLista(dq.evidence_ids, 'data_quality')
  const conf15 = c => Number.isInteger(c) && c >= 1 && c <= 5
  const estr = (e, onde) => { if (!e) return; if (!Array.isArray(e.faltam)) falha(`${onde}: estratégia sem lista faltam`); else if (e.faltam.length && e.provisoria !== true) falha(`${onde}: estratégia com pendências precisa ser provisória`); if (typeof e.classe !== 'string') falha(`${onde}: estratégia sem classe`) }
  estr(AD.estrategia, 'account_diagnosis')
  for (const [c, g] of Object.entries(AD.por_grupo || {})) estr(g?.estrategia, `account_diagnosis.por_grupo.${c}`)
  for (const l of json.listing_diagnoses) {
    if (!l?.entidade?.id || l.entidade.tipo !== 'anuncio' || l.nivel !== 'anuncio' || !Array.isArray(l.problemas)) { falha('listing_diagnoses com entidade/nivel/problemas inválidos'); continue }
    citaLista(l.evidence_ids || [], 'listing_diagnoses')
    for (const p of l.problemas) { if (!p?.regra || !conf15(p.confianca)) falha('problema de anúncio sem regra ou confiança fora de 1..5 (inteiro)'); citaLista(p.evidence_ids, 'listing_diagnoses.problemas'); if (!Array.isArray(p.causas_possiveis) || !Array.isArray(p.confirmar_com)) falha('problema de anúncio sem causas_possiveis/confirmar_com') }
  }
  const C = json.campaign_diagnoses
  if (C.granularidade !== 'anuncio') falha('campaign_diagnoses.granularidade precisa ser "anuncio"')
  if (!C.pendencia || C.pendencia.estado !== 'NOT_SUPPORTED') falha('campaign_diagnoses.pendencia precisa declarar NOT_SUPPORTED')
  if (!Array.isArray(C.itens)) falha('campaign_diagnoses.itens não é lista'); else for (const it of C.itens) { citaLista(it.evidence_ids, 'campaign_diagnoses.itens'); for (const k of ['ctr', 'cpc', 'acos', 'roas']) if (it[k]) metrica(it[k], `campaign_diagnoses.itens[].${k}`) }
  if (C.conta != null) {
    if (typeof C.conta !== 'object') falha('campaign_diagnoses.conta não é objeto')
    else { for (const k of ['ctr', 'cpc', 'custo_por_pedido', 'acos', 'roas', 'tacos', 'participacao_publicidade']) if (k in C.conta) metrica(C.conta[k], `campaign_diagnoses.conta.${k}`); if (C.conta.evidence_ids) citaLista(C.conta.evidence_ids, 'campaign_diagnoses.conta') }
  }
  // ações primeiro (ids únicos), depois quem aponta para elas: issues, opportunities, depende_de, revisões e prompts
  const acoesIds = new Set()
  for (const a of json.actions) { if (a && typeof a.id === 'string') { if (acoesIds.has(a.id)) falha('ação com id repetido'); acoesIds.add(a.id) } }
  for (const [nome, lista] of [['issues', json.issues], ['opportunities', json.opportunities]]) for (const i of lista) {
    if (!i?.acao_id || !i.regra || !i.entidade) falha(`${nome} com item sem acao_id/regra/entidade`); else if (!acoesIds.has(i.acao_id)) falha(`${nome} aponta para ação inexistente`)
    if (i && i.confianca != null && !conf15(i.confianca)) falha(`${nome} com confiança fora de 1..5 (inteiro)`)
    citaLista(i?.evidence_ids, nome)
  }
  for (const a of json.actions) {
    if (!a || typeof a.id !== 'string') { falha('ação sem id'); continue }
    if (!a.entidade || !['anuncio', 'conta'].includes(a.entidade.tipo) || !a.entidade.id) falha('ação com entidade inválida')
    if (!a.o_que || !a.por_que || typeof a.por_que !== 'object') falha('ação sem o_que/por_que'); else citaLista(a.por_que.evidence_ids, 'actions.por_que')
    if (!EXECUTORES.includes(a.executar_via)) falha('ação com executar_via fora de oferta/promocoes/notion')
    if (!Array.isArray(a.depende_de) || !Array.isArray(a.limites)) falha('ação sem depende_de/limites em lista')
    else if (a.depende_de.some(id => !acoesIds.has(id))) falha('ação com depende_de para ação inexistente')
    if (!a.prioridade || (a.prioridade.p != null && !['P0', 'P1', 'P2', 'P3'].includes(a.prioridade.p))) falha('ação com prioridade fora de P0..P3')
    if (!a.metrica_sucesso || typeof a.metrica_sucesso !== 'object') falha('ação sem metrica_sucesso')
    if (a.previsao && ['ganho', 'risco_evitado'].includes(a.previsao.tipo) && a.previsao.hipotese !== true) falha('previsão de ganho/risco precisa ser declarada como hipótese')
  }
  for (const p of json.derived_prompts) {
    if (!TIPOS_PROMPT.includes(p?.tipo)) falha('prompt derivado com tipo fora do enum')
    if (!['pronto', 'pendente'].includes(p?.estado)) falha('prompt derivado com estado fora do enum')
    if (p?.estado === 'pendente' && !(Array.isArray(p.insumos_faltantes) && p.insumos_faltantes.length)) falha('prompt pendente sem insumos_faltantes')
    if (p?.estado === 'pronto' && Array.isArray(p.insumos_faltantes) && p.insumos_faltantes.length) falha('prompt pronto com insumos_faltantes')
    if (!acoesIds.has(p?.acao_id)) falha('prompt derivado aponta para ação inexistente')
    if (!p?.restricoes || !Array.isArray(p.restricoes.preservar) || !Array.isArray(p.restricoes.proibido)) falha('prompt derivado sem restricoes.preservar/proibido')
    if (typeof p?.texto !== 'string' || !p.texto) falha('prompt derivado sem texto'); else if (auditarInterno(p.texto).length) falha('texto de prompt derivado reprovado no auditor interno')
    for (const f of p?.insumos_faltantes || []) if (!f?.item || !ESTADOS_BLOQUEIO.includes(f.estado) || !f.como_obter) falha('insumo faltante sem item/estado/como_obter')
  }
  const RP = json.review_plan
  if (!RP.ritual || typeof RP.ritual !== 'object' || !Array.isArray(RP.proximas_revisoes) || typeof RP.sinal_misto !== 'boolean') falha('review_plan incompleto (ritual, proximas_revisoes, sinal_misto)')
  else for (const r of RP.proximas_revisoes) { if (!r?.acao_id || !r.em || !r.o_que_conferir) falha('revisão sem acao_id/em/o_que_conferir'); else if (r.acao_id !== 'conta' && !acoesIds.has(r.acao_id)) falha('revisão aponta para ação inexistente') }
  return { ok: erros.length === 0, erros }
}

// ── leitura do banco (somente leitura) ──────────────────────────────────────
const tenta = (avisos, passo, fn) => { try { return fn() } catch (e) { avisos.push({ passo, motivo: String(e?.message || e).slice(0, 160) }); return null } }
// ficha/estado das Ofertas por anúncio do ML: GATE 0 (referência confirmada), voz do cliente coletada, título proposto na última proposta, briefing da duplicação
function lerOfertasDoCliente(cliente) {
  const porItem = new Map()
  const rows = db.prepare(`SELECT a.id ofa_id, a.anuncio_id, v.id variante_id, v.cor, v.tamanho, v.material, v.quantidade_kit, v.referencia_confirmada, p.nome, p.marca, p.modelo
    FROM of_anuncio a LEFT JOIN of_variante v ON v.cliente = a.cliente AND v.id = a.variante_id LEFT JOIN of_produto p ON p.cliente = v.cliente AND p.id = v.produto_id
    WHERE a.cliente = ? AND a.canal = 'ML'`).all(cliente)
  if (!rows.length) return { porItem }
  const atrs = new Map()
  for (const x of db.prepare('SELECT variante_id, atributo_id, valor_atual, valor_proposto, fonte, evidencia FROM of_atributo WHERE cliente = ?').all(cliente)) (atrs.get(x.variante_id) || atrs.set(x.variante_id, []).get(x.variante_id)).push(x)
  const jobs = new Map()
  for (const j of db.prepare("SELECT id, anuncio_id, dados_json FROM of_job WHERE cliente = ? AND estado NOT IN ('cancelado','rejeitado') ORDER BY atualizado_em").all(cliente)) jobs.set(j.anuncio_id, j)
  for (const r of rows) {
    const j = jobs.get(r.ofa_id), d = j ? seguroJson(j.dados_json) || {} : {}
    let titulo_proposto = null
    if (j) { const c = seguroJson(db.prepare('SELECT conteudo_json FROM of_proposta WHERE cliente = ? AND job_id = ? ORDER BY versao DESC LIMIT 1').get(cliente, j.id)?.conteudo_json || '') ; titulo_proposto = typeof c?.titulo === 'string' ? c.titulo : typeof c?.titulo?.para === 'string' ? c.titulo.para : null }
    porItem.set(r.anuncio_id, {
      ficha: r.variante_id ? { nome: r.nome || '', marca: r.marca || '', modelo: r.modelo || '', cor: r.cor || '', tamanho: r.tamanho || '', material: r.material || '', quantidade_kit: r.quantidade_kit, atributos: atrs.get(r.variante_id) || [] } : null,
      referencia_confirmada: !!r.referencia_confirmada, voz_coletada: d.voz_cliente?.estado === 'coletada', titulo_proposto, briefing: d.briefing || null,
    })
  }
  return { porItem }
}

// memo do contrato: cada GET recalculava tudo (95–310 ms quente, 1,7 s frio, 1,6–1,9 MB) e travava o event loop. Chave = (cliente, hoje, carimbo das ações e da última coleta);
// ponytail: memo em processo com TTL curto e teto de entradas — custos, metas e ofertas mudam o contrato só depois do TTL; vira invalidação explícita se isso incomodar
const MEMO_TTL_MS = 60_000, MEMO_MAX = 24
const memo = new Map()
export function memoDiagnostico(chave, fn) {
  const t = Date.now(), m = memo.get(chave)
  if (m && t - m.em < MEMO_TTL_MS) return m.valor
  const valor = fn()
  memo.delete(chave); memo.set(chave, { em: t, valor })
  if (valor && typeof valor.then === 'function') valor.then(null, () => { if (memo.get(chave)?.valor === valor) memo.delete(chave) })   // promessa rejeitada não fica no memo
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value)
  return valor
}
export const limparMemoDiagnostico = () => memo.clear()
// carimbo barato do que muda o contrato entre gerações: ações do plano (quantidade + última atualização) e a última coleta de pedidos/Ads
export function carimboDiagnostico(cliente) {
  const a = db.prepare('SELECT COUNT(*) n, MAX(atualizado_em) em FROM acoes_plano WHERE cliente = ?').get(cliente)
  const c = db.prepare('SELECT MAX(coletado_em) em FROM meli_coleta_dia WHERE cliente = ?').get(cliente)
  const ads = db.prepare('SELECT MAX(coletado_em) em FROM meli_ads_item WHERE cliente = ?').get(cliente)
  // alinhamentos: id + estado + data de revisão de cada linha aberta (renovar vivo→vivo só muda revisar_em — COUNT/MAX(id) não percebiam)
  let al = ''; try { const r = db.prepare("SELECT COUNT(*) n, GROUP_CONCAT(id || '.' || estado || '.' || revisar_em, ',') g FROM (SELECT id, estado, revisar_em FROM alinhamento WHERE cliente = ? AND estado <> 'encerrado' ORDER BY id)").get(cliente); al = `|${r.n}.${sha(r.g || '')}` } catch { /* banco sem a tabela */ }
  return `${a?.n || 0}|${a?.em || ''}|${c?.em || ''}|${ads?.em || ''}${al}`
}

export function diagnosticoDoCliente(cliente, { hoje = hojeLocal(), memo: usarMemo = true } = {}) {
  if (!usarMemo) return gerarDiagnostico(cliente, { hoje })
  let carimbo = ''; try { carimbo = carimboDiagnostico(cliente) } catch { return gerarDiagnostico(cliente, { hoje }) }   // sem carimbo, sem memo
  return memoDiagnostico(JSON.stringify(['contrato', cliente, hoje, carimbo]), () => gerarDiagnostico(cliente, { hoje }))
}
function gerarDiagnostico(cliente, { hoje }) {
  const avisos = []
  const diag = tenta(avisos, 'diagnosticarConta', () => diagnosticarConta(cliente, { hoje }))
  if (!diag?.disponivel) {
    const conta = tenta(avisos, 'meli_contas', () => db.prepare('SELECT escopos, erro, atualizado_em FROM meli_contas WHERE cliente = ?').get(cliente) || null)
    return indisponivel(cliente, { hoje, diag, avisos, conta })
  }
  const acoes = tenta(avisos, 'lerAcoes', () => lerAcoes({ clientes: [cliente], status: ['proposta', 'aprovada', 'distribuida'] }).map(a => ({ ...a, previsao: a.previsao_json ? seguroJson(a.previsao_json) : null }))) || []
  const plano = tenta(avisos, 'lerPlano', () => lerPlano(cliente))
  const retro = tenta(avisos, 'retroalimentar', () => { const r = retroalimentar(cliente, { hoje, diag, salvar: false }); return r?.disponivel ? r : null })
  const merov = tenta(avisos, 'merovingio', () => { const reg = carregarClientes().find(c => normNome(c.cliente) === normNome(cliente)); return reg ? merovingioCliente({ reg, plano, acoes, hoje }) : null })
  const ofertas = tenta(avisos, 'ofertas', () => lerOfertasDoCliente(cliente))
  const coleta = tenta(avisos, 'qualidade da coleta', () => ({ atual: qualidadeNoIntervalo(cliente, diag.periodo.de, diag.periodo.ate), anterior: qualidadeNoIntervalo(cliente, diag.periodo.anterior.de, diag.periodo.anterior.ate) }))
  const alinhamentos = tenta(avisos, 'alinhamentos', () => alinhamentosReal().listar(cliente, { hoje })) || []
  return montarDiagnostico(cliente, { hoje, diag, acoes, plano, retro, merov, ofertas, ambiente: { fal_key: !!String(process.env.FAL_KEY || '').trim() }, avisos, coleta, alinhamentos })
}

// texto de catálogo por origem (para quem renderiza sem importar o config)
export const textoCatalogo = origem => TEXTO_CATALOGO[origem] || ''
export { origemCatalogo, semId }
