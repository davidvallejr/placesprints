// Autoteste do plano por anúncio: diagnóstico SINTÉTICO → ações → previsão (sem rede, sem banco real: db.js em memória).
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports do projeto (dinâmicos abaixo): db.js abre :memory:
import assert from 'node:assert/strict'
const { montarAcoes, previsaoDoPlano, acaoDeOferta } = await import('../src/lib/plano-anuncios.js')
const { classificarCurvas, benchmarkConversao, sugestaoFull, economiaAds, descontoMaximoPct, algoritmo, margemPct } = await import('../src/lib/diagnostico-conta.js')

const HOJE = '2026-10-05'
const item = (o) => ({ id: 'MLB1', titulo: 'Produto de teste', permalink: 'https://produto.mercadolivre.com.br/MLB-1-x-_JM', thumb: '', preco: 50, estoque: 400, fotos: 8, frete_gratis: true, catalogo: false,
  u: 20, r: 1000, v: 300, u0: 20, r0: 1000, v0: 300, visOk: true, conv: 6.7, vel_dia: 0.71, cobertura: 560, ads: null, ads_ant: null, buy_box: null, logistica: '', avaliacoes: null, ptw: null, ...o })
// vendas por dia de 28 dias antes da alta (dia `alta`) até o fim do período (04/10): `antes` un/dia antes, `depois` un/dia desde a alta
const serieAlta = (antes, depois, alta = '2026-09-20', fim = '2026-10-04') => { const o = {}; for (let t = Date.parse(alta + 'T12:00:00Z') - 28 * 864e5; t <= Date.parse(fim + 'T12:00:00Z'); t += 864e5) { const d = new Date(t).toISOString().slice(0, 10); o[d] = d < alta ? antes : depois } return o }
function diagDe(itens, extra = {}) {
  classificarCurvas(itens, null); const b = benchmarkConversao(itens); classificarCurvas(itens, b?.conv)
  const gmv = itens.reduce((t, i) => t + i.r, 0)
  return { disponivel: true, cliente: '__teste__', hoje: HOJE, periodo: { de: '2026-09-07', ate: '2026-10-04', anterior: { de: '2026-08-10', ate: '2026-09-06' } },
    resumo: { gmv, gmv_anterior: gmv, delta_pct: 0, conversao_conta: b?.conv, velocidade_dia: gmv / 28, baseline_28d: gmv, anuncios_ativos: itens.length, curvas: { A: 1, B: 0, C: 0 } },
    benchmark: b, ads: { custo: 0, receita: 0, roas: null, acos: null, ctr: null, tacos: null, clicks: 0, prints: 0, anterior: { roas: null } }, economia: null, custos_informados: false, itens, janelas: [], pendencias: [], algoritmo_versao: algoritmo.versao,
    vendas_dia_sem_mudanca: serieAlta(5, 5), ...extra }
}
const regras = a => a.map(x => x.regra.replace('anuncio_', ''))

// 1) ímã: vende, tem tráfego, converte 40% abaixo do benchmark → ação com evidência, hipótese, passos e cenários
{
  const bom = item({ id: 'MLB10', r: 5000, u: 100, v: 600, conv: 16.7 })
  const ima = item({ id: 'MLB11', r: 3000, u: 30, v: 500, conv: 6, frete_gratis: false, fotos: 3 })
  const acoes = montarAcoes('__teste__', diagDe([bom, ima]), { hoje: HOJE })
  const a = acoes.find(x => x.regra === 'anuncio_ima_conversao' && x.item_id === 'MLB11')
  assert.ok(a, 'ímã deve disparar'); assert.ok(a.dados.evidencia.includes('conversão') && a.dados.como.length >= 3 && a.dados.hipotese)
  assert.ok(a.previsao.cenarios.conservador.receita < a.previsao.cenarios.base.receita && a.previsao.cenarios.base.receita < a.previsao.cenarios.otimista.receita)
  assert.ok(a.dados.como.some(c => /frete/i.test(c)), 'trata o sinal objetivo de frete')
  assert.ok(!acoes.some(x => x.regra === 'anuncio_ima_conversao' && x.item_id === 'MLB10'), 'anúncio que converte bem não é ímã')
  assert.ok(a.titulo.includes('MLB11'), 'título cita o ID do anúncio (permite medir depois)')
}
// 2) ruptura: cobertura < prazo de reposição em campeão → risco evitado, prioridade alta; curva C irrelevante NÃO gera ação
{
  const campeao = item({ id: 'MLB20', r: 9000, u: 120, estoque: 6, cobertura: 1, vel_dia: 4.3 })
  const ruido = item({ id: 'MLB21', r: 20, u: 4, estoque: 1, cobertura: 1, vel_dia: 0.14 })
  const acoes = montarAcoes('__teste__', diagDe([campeao, ruido]), { hoje: HOJE })
  const rup = acoes.filter(x => x.regra === 'anuncio_estoque_ruptura')
  assert.equal(rup.length, 1); assert.equal(rup[0].item_id, 'MLB20'); assert.equal(rup[0].previsao.tipo, 'risco_evitado'); assert.equal(rup[0].horizonte, '72h')
  assert.ok(acoes[0].regra === 'anuncio_estoque_ruptura', 'ruptura de campeão lidera a prioridade')
  // prazo INFORMADO (v1.6.0, predicado único emRuptura): 60 dias com 19 de cobertura = ruptura (antes: nada, só o 🔄); 3 dias com 5 de cobertura = a reposição chega
  // antes de zerar → não é ruptura (antes: «antes de zerar» com risco R$ 0 e «~0 dia sem vender»); a premissa (21 d) não amplia o corte de 10 d
  const lento = item({ id: 'MLB22', r: 6000, u: 90, estoque: 61, cobertura: 19, vel_dia: 3.2, lead_time_dias: 60, lead_time_fonte: 'cliente' })
  const rapido = item({ id: 'MLB23', r: 5000, u: 80, estoque: 14, cobertura: 5, vel_dia: 2.9, lead_time_dias: 3, lead_time_fonte: 'cliente' })
  const premissa = item({ id: 'MLB24', r: 4000, u: 70, estoque: 30, cobertura: 12, vel_dia: 2.5, lead_time_dias: 21, lead_time_fonte: 'premissa' })
  const r2 = montarAcoes('__teste__', diagDe([lento, rapido, premissa]), { hoje: HOJE }).filter(x => x.regra === 'anuncio_estoque_ruptura')
  assert.deepEqual(r2.map(x => x.item_id), ['MLB22'])
  assert.match(r2[0].dados.hipotese, /fica ~41 dia\(s\) sem vender/); assert.ok(r2[0].previsao.cenarios.base.receita > 0, 'risco evitado > 0')
}
// 3) Ads: reduzir só com custo relevante e retorno ruim; sem custos NÃO inventa ROAS alvo
{
  const ruim = item({ id: 'MLB30', r: 2000, ads: { prints: 9000, clicks: 80, custo: 120, receita: 40, unidades: 1, ctr: 0.9, roas: 0.33, acos: 300 } })
  const bom = item({ id: 'MLB31', r: 4000, ads: { prints: 9000, clicks: 200, custo: 100, receita: 900, unidades: 18, ctr: 2.2, roas: 9, acos: 11 } })
  const d = diagDe([ruim, bom], { ads: { custo: 220, receita: 940, roas: 4.27, acos: 23, ctr: 1.6, tacos: 3, clicks: 280, prints: 18000, anterior: { roas: 5 } } })
  const acoes = montarAcoes('__teste__', d, { hoje: HOJE })
  assert.ok(acoes.some(x => x.regra === 'anuncio_ads_reduzir' && x.item_id === 'MLB30'))
  assert.ok(acoes.some(x => x.regra === 'anuncio_ads_escalar' && x.item_id === 'MLB31'))
  assert.ok(acoes.some(x => x.regra === 'anuncio_cadastrar_custos'), 'sem custos → ação de cadastrar custos')
  const esc = acoes.find(x => x.regra === 'anuncio_ads_escalar'); assert.ok(/sem ele|Informar custos/i.test(esc.dados.como.join(' ')) , 'sem custos o texto não inventa ROAS alvo')
}
// 4) custos: break-even, ROAS alvo e desconto máximo (exemplo do roteiro: margem 30%, desejada 10% → ACOS 20%, ROAS 5)
{
  const e = economiaAds({ cmv_pct: 50, imposto_pct: 6, comissao_pct: 14, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 })
  assert.equal(e.margem_pre_ads_pct, 30); assert.equal(e.acos_max_pct, 20); assert.equal(e.roas_alvo, 5); assert.equal(e.roas_breakeven, 3.33)
  assert.equal(economiaAds({ cmv_pct: 70, imposto_pct: 10, comissao_pct: 20, margem_desejada_pct: 5 }).viavel, false, 'ACOS ≤ 0 = oferta inviável')
  assert.equal(economiaAds(null), null)
  assert.ok(descontoMaximoPct({ cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 8, embalagem_pct: 2, margem_desejada_pct: 10 }) > 20)
}
// 5) Full: quantidade só com crescimento OBSERVADO (teto) e nunca negativa
{
  const s = sugestaoFull(item({ vel_dia: 2, estoque: 10, u: 56, u0: 28 }))
  assert.ok(s.cenarios.conservador <= s.cenarios.base && s.cenarios.base <= s.cenarios.crescimento); assert.equal(s.tendencia_obs_pct, 100)
  assert.ok(s.cenarios.crescimento <= Math.ceil(2 * 1.4 * 37 - 10) , 'crescimento limitado ao teto')
  assert.equal(sugestaoFull(item({ vel_dia: 0 })), null); assert.equal(sugestaoFull(item({ vel_dia: 1, estoque: 5000 })).cenarios.base, 0)
}
// 6) foco: no máximo N ações na semana, IDs estáveis e únicos, teto por regra, e a mesma entrada gera os mesmos IDs
{
  const muitos = Array.from({ length: 30 }, (_, k) => item({ id: 'MLB' + (100 + k), r: 4000 - k * 50, u: 40, frete_gratis: false }))
  const d = diagDe(muitos), a1 = montarAcoes('__teste__', d, { hoje: HOJE }), a2 = montarAcoes('__teste__', d, { hoje: HOJE })
  assert.equal(a1.filter(x => x.dados.fila === 'esta_semana').length, algoritmo.foco.max_acoes_por_cliente_semana)
  assert.deepEqual(a1.map(x => x.id), a2.map(x => x.id)); assert.equal(new Set(a1.map(x => x.id)).size, a1.length)
  assert.ok(a1.filter(x => x.regra === 'anuncio_frete_gratis').length <= algoritmo.foco.max_por_regra.frete_gratis)
  assert.ok((a1.omitidas.frete_gratis || 0) > 0, 'o que passa do teto é contado como omitido')
  assert.ok(a1.every(x => /^PS-[0-9a-f]{10}$/.test(x.id)) && a1.every(x => x.dados.prioridade.p))
}
// 7) previsão do plano: baseline ± cenários, teto de plausibilidade, risco evitado à parte e desconto por sobreposição
{
  const itens = [item({ id: 'MLB40', r: 6000, u: 60, v: 400, conv: 3, frete_gratis: false, fotos: 2 }), item({ id: 'MLB41', r: 6000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB42', r: 900, u: 10, estoque: 3, cobertura: 4, vel_dia: 0.36, v: 80, conv: 12.5 })]
  const d = diagDe(itens), a = montarAcoes('__teste__', d, { hoje: HOJE }), p = previsaoDoPlano(d, a)
  assert.ok(p.cenarios.conservador.faturamento <= p.cenarios.base.faturamento && p.cenarios.base.faturamento <= p.cenarios.otimista.faturamento)
  assert.ok(p.cenarios.otimista.ganho <= p.teto_valor + 0.01, 'teto de plausibilidade respeitado')
  const soma = a.filter(x => x.previsao.tipo === 'ganho').reduce((t, x) => t + x.previsao.esperado.base, 0)
  assert.ok(p.cenarios.base.ganho <= soma + 0.01, 'sobreposição nunca soma mais que as partes')
  assert.ok(p.receita_em_risco_evitada > 0 && p.cenarios.base.faturamento === Math.round((p.baseline + p.cenarios.base.ganho) * 100) / 100, 'risco evitado fica fora do ganho')
  assert.ok(p.aviso.includes('não é promessa'))
}
// 8) honestidade: probabilidade sempre com fonte declarada; hipótese marcada; nunca receita sem premissas
{
  const a = montarAcoes('__teste__', diagDe([item({ id: 'MLB50', r: 8000, u: 50, v: 600, conv: 3, frete_gratis: false })]), { hoje: HOJE })
  assert.ok(a.every(x => x.previsao.p_fonte && x.previsao.p_sucesso > 0 && x.previsao.p_sucesso <= 1))
  assert.ok(a.filter(x => x.previsao.tipo !== 'pendencia').every(x => Array.isArray(x.previsao.premissas) && x.previsao.premissas.length && x.previsao.formula))
  assert.ok(a.filter(x => x.regra === 'anuncio_urgencia_oculta').every(x => x.dados.evidencia_tipo === 'hipotese'))
}
// 9) duplicação estratégica (treinamento Place2u): nasce só de DADO (G4 curva A em queda > G2 potencial travado > G1 produto novo); G3/G5 exigem o consultor e NUNCA nascem sozinhas
{
  const dup = a => a.filter(x => x.regra === 'anuncio_duplicacao_estrategica')
  const queda = item({ id: 'MLB60', r: 5000, r0: 8000, u: 50, u0: 80, v: 400, v0: 700, conv: 12.5 })
  const saudavel = item({ id: 'MLB61', r: 4000, r0: 4000, u: 60, u0: 60, v: 360, v0: 360, conv: 16.7 })
  const a1 = montarAcoes('__teste__', diagDe([queda, saudavel, item({ id: 'MLB62', r: 3500, u: 55, v: 330, conv: 16.7 })]), { hoje: HOJE })
  const d1 = dup(a1)
  assert.equal(d1.length, 1, 'só a curva A em queda dispara; a saudável não'); assert.equal(d1[0].item_id, 'MLB60')
  assert.deepEqual([d1[0].dados.duplicacao.gatilho, d1[0].dados.duplicacao.objetivo], ['G4', 'recuperacao'])
  assert.ok(/^Consultor:/.test(d1[0].dados.como[0]) && d1[0].dados.como.some(c => /^Analista:/.test(c)) && d1[0].dados.como.some(c => /INTACTO/.test(c)), 'consultor define, analista executa, original intacto')
  assert.equal(d1[0].dados.duplicacao.exige_briefing_consultor, true); assert.equal(d1[0].dados.demanda_notion, 'Duplicar anúncios')
  assert.ok(d1[0].dados.processo?.passos.length > 0 && d1[0].dados.processo.id === '6.17', 'o card leva o roteiro do Manual (processo 6.17)')
  assert.ok(d1[0].previsao.premissas.some(x => /premissa/.test(x)), 'previsão declara que a fração recuperada é premissa')
  // G1: produto novo (≤30 dias) com venda
  const novo = montarAcoes('__teste__', diagDe([item({ id: 'MLB63', r: 3000, u: 30, v: 300, conv: 20, criado_em: '2026-09-25' }), item({ id: 'MLB64', r: 9000, u: 120, v: 600, conv: 20 })]), { hoje: HOJE })
  assert.deepEqual(dup(novo).map(x => [x.item_id, x.dados.duplicacao.gatilho]), [['MLB63', 'G1']])
  // G3/G5 nunca nascem do plano automático
  const todas = [a1, novo].flatMap(dup); assert.ok(todas.every(x => ['G1', 'G2', 'G4'].includes(x.dados.duplicacao.gatilho)), 'G3 (multi-nicho) e G5 (kit) exigem a pesquisa do consultor')
  // teto por regra: 8 curvas A em queda geram no máximo 3 duplicações (o excedente é contado em omitidas)
  const muitos = Array.from({ length: 8 }, (_, k) => item({ id: 'MLB7' + k, r: 6000 - k * 10, r0: 9000, u: 50, u0: 80, v: 400, v0: 700, conv: 12.5 }))
  const am = montarAcoes('__teste__', diagDe(muitos), { hoje: HOJE })
  assert.ok(dup(am).length <= 3 && (am.omitidas.duplicacao_estrategica || 0) >= 1, 'teto de duplicações por plano')
  // sequência lógica: a otimização do MESMO anúncio não vence antes da duplicação (Manual 5.1)
  const ambos = item({ id: 'MLB80', r: 5000, r0: 9000, u: 50, u0: 90, v: 500, v0: 800, conv: 6, frete_gratis: false, fotos: 3 })
  const as = montarAcoes('__teste__', diagDe([ambos, item({ id: 'MLB81', r: 9000, u: 150, v: 600, conv: 25 })]), { hoje: HOJE })
  const dd = as.find(x => x.regra === 'anuncio_duplicacao_estrategica' && x.item_id === 'MLB80'), oo = as.find(x => x.regra === 'anuncio_ima_conversao' && x.item_id === 'MLB80')
  assert.ok(dd && oo, 'o mesmo anúncio recebe duplicação e otimização'); assert.ok(oo.prazo >= dd.prazo && oo.dados.sequencia > dd.dados.sequencia, 'otimização depois da duplicação')
  // retroalimentação por objetivo: só mexe na duplicação do objetivo que difere de forma conclusiva
  const estado = { estado: 'estagnacao' }
  const base = montarAcoes('__teste__', diagDe([queda, saudavel]), { hoje: HOJE, retro: { estado, fatores: {}, protegidos: [], duplicacao: { fator_por_objetivo: {} } } })
  const ruim = montarAcoes('__teste__', diagDe([queda, saudavel]), { hoje: HOJE, retro: { estado, fatores: {}, protegidos: [], duplicacao: { fator_por_objetivo: { recuperacao: { fator: 0.85, n: 10, melhorou: 1 } } } } })
  const nota = a => dup(a)[0].score
  assert.ok(nota(ruim) < nota(base), 'objetivo que não funciona desce na fila'); assert.ok(/duplicação com objetivo "recuperacao"/.test(dup(ruim)[0].dados.retro.motivo))
  const outroObj = montarAcoes('__teste__', diagDe([queda, saudavel]), { hoje: HOJE, retro: { estado, fatores: {}, protegidos: [], duplicacao: { fator_por_objetivo: { novos_publicos: { fator: 0.85, n: 10, melhorou: 1 } } } } })
  assert.equal(nota(outroObj), nota(base), 'fator de OUTRO objetivo não mexe nesta duplicação')
}
// 10) roteiro do Manual por regra: só processo elementar de verdade; reposição/Ads/custos não recebem roteiro de outra família
{
  const campeao = item({ id: 'MLB90', r: 9000, u: 120, estoque: 6, cobertura: 1, vel_dia: 4.3 }), cat = item({ id: 'MLB91', r: 4000, u: 50, v: 400, conv: 12.5, catalogo: true, buy_box: { status: 'competing', vencendo: false, preco_vencedor: 45 } })
  const a = montarAcoes('__teste__', diagDe([campeao, cat, item({ id: 'MLB92', r: 3000, u: 30, v: 500, conv: 6, frete_gratis: false, fotos: 3 })]), { hoje: HOJE })
  const proc = regra => a.find(x => x.regra === 'anuncio_' + regra)?.dados.processo
  assert.equal(proc('estoque_ruptura'), null, 'reposição não ganha o roteiro de Planejamento FULL')
  assert.equal(proc('ima_conversao')?.id, '6.7', 'otimização leva o passo a passo de editar o anúncio no ML')
  assert.ok(!a.some(x => x.dados.processo && !x.dados.processo.passos.length), 'processo no card sempre com passos')
  for (const x of a) if (x.dados.processo) assert.ok(['mapa', 'manual'].includes(x.dados.processo.fonte) && x.dados.processo.criterio && x.dados.processo.evidencia.length, 'fonte, critério e evidência no processo')
}
// 11) preço subiu e as vendas caíram (preco_mudou_vendas_cairam): coincidência = FATO, causa = HIPÓTESE; vendas/dia antes × DEPOIS da data da alta, no anúncio
//     e no controle SEM mudança de preço nas mesmas datas (estável); alta líquida com o preço ainda acima e ao menos 7 dias depois dela
{
  const ev = pct => [{ dia: '2026-09-20', de: 50, para: Math.round(50 * (100 + pct)) / 100, pct, fonte: 'coleta' }]
  const subiu = () => item({ id: 'MLB300', preco: 55, r: 4000, r0: 6000, u: 30, u0: 50, v: 300, v0: 400, conv: 10, mudancas_preco_28d: ev(10), preco_realizado_ant: 50, preco_realizado_28d: 55, vendas_dia: serieAlta(5, 3) })
  const ctrl = () => [item({ id: 'MLB301', r: 3000, u: 40, u0: 40 }), item({ id: 'MLB302', r: 2500, u: 30, u0: 31 })]
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE })
  const regra = a => a.filter(x => x.regra === 'anuncio_preco_mudou_vendas_cairam')
  const a = da([subiu(), ...ctrl()]), [p] = regra(a)
  assert.ok(p && p.item_id === 'MLB300', 'preço subiu 10% e vendas −40% com o controle estável: dispara')
  assert.equal(p.dados.acao, 'Revisar o preço: subiu 10% em 20/09 e as vendas caíram 40%. Fazer UMA mudança (voltar ou ajustar), sem mexer em título e fotos por 14 dias, e medir contra os anúncios sem mudança de preço')
  assert.equal(p.dados.evidencia_tipo, 'fato'); assert.match(p.dados.hipotese, /FATO.*HIPÓTESE/)
  assert.match(p.dados.evidencia, /R\$ 50,00 → R\$ 55,00 em 20\/09 \(\+10%\).*preço pago.*vendas 140 un nos 28 dias antes da alta → 45 un nos 15 dias desde ela; anúncios sem mudança de preço: 140 → 75 un nas mesmas datas \(0% por dia\)/)
  assert.equal(p.dados.dependencia, 'Custos do cliente (margem)', 'sem custo informado a revisão depende da margem do cliente')
  // 12/10/2026: os MESMOS números da evidência, estruturados, para o gatilho queda_por_preco projetar (nunca recalcular); fonte = de quem é a mudança no change-log
  assert.deepEqual(p.dados.evidencia_preco, { dia: '2026-09-20', de: 50, para: 55, subiu_pct: 10, queda_pct: 40, controle_pct: 0, dias_desde_alta: 15, fonte: 'coleta', incerteza: '' })
  assert.ok(p.previsao.p_fonte && p.previsao.premissas.some(x => /elasticidade do anúncio NÃO medida/.test(x)) && p.previsao.cenarios.base.receita > 0)
  assert.equal(p.dados.demanda_notion, 'Atualizar Preços'); assert.ok(p.dados.processo?.passos.length > 0, 'card leva o roteiro de editar o anúncio')
  assert.equal(da([subiu(), ...ctrl()], { custos_informados: true }).find(x => x.regra === 'anuncio_preco_mudou_vendas_cairam').dados.dependencia, '—')
  // o controle sem mudança de preço também caiu nas mesmas datas (mercado): não é o preço; preço que caiu ou subiu abaixo do limiar: não dispara
  assert.equal(regra(da([subiu(), ...ctrl()], { vendas_dia_sem_mudanca: serieAlta(5, 3) })).length, 0)
  assert.equal(regra(da([{ ...subiu(), mudancas_preco_28d: ev(-10) }, ...ctrl()])).length, 0)
  assert.equal(regra(da([{ ...subiu(), mudancas_preco_28d: ev(2) }, ...ctrl()])).length, 0)
  // subiu e VOLTOU (líquido 0, preço de hoje = o de antes): não pede "voltar ou ajustar" um preço que já voltou
  const idaVolta = [{ dia: '2026-09-12', de: 50, para: 55, pct: 10, fonte: 'coleta' }, { dia: '2026-09-15', de: 55, para: 50, pct: -9.09, fonte: 'coleta' }]
  assert.equal(regra(da([{ ...subiu(), preco: 50, mudancas_preco_28d: idaVolta, vendas_dia: serieAlta(5, 3, '2026-09-12') }, ...ctrl()])).length, 0)
  // alta no último dia do período: a queda de 28 dias veio ANTES dela (causalidade reversa) — menos de 7 dias depois, não dispara
  assert.equal(regra(da([{ ...subiu(), mudancas_preco_28d: [{ ...ev(10)[0], dia: '2026-10-04' }], vendas_dia: serieAlta(5, 3, '2026-10-04') }, ...ctrl()], { vendas_dia_sem_mudanca: serieAlta(5, 5, '2026-10-04') })).length, 0)
  // queda que veio antes da alta e não continuou depois dela: vendas/dia iguais antes × depois da alta, não dispara (mesmo com u 50 → 30 no 28d × 28d)
  assert.equal(regra(da([{ ...subiu(), vendas_dia: serieAlta(3, 3) }, ...ctrl()])).length, 0)
  // a duplicação estratégica (G4, curva A em queda) cita o histórico de preço do original
  const dup = a.find(x => x.regra === 'anuncio_duplicacao_estrategica' && x.item_id === 'MLB300')
  assert.ok(dup && /Histórico de preço do original \(28 dias\): R\$ 50,00 → R\$ 55,00 em 20\/09 \(\+10%\)/.test(dup.dados.evidencia), dup?.dados.evidencia)
}
// 12) custo POR ANÚNCIO (vínculo custo ↔ anúncio, diagnóstico: custo_unitario/custo_origem): margem no preço que subiu, CMV do próprio anúncio no giro e
//     "cadastrar custos" só quando não há nem percentuais da conta nem custo por anúncio
{
  const ev = [{ dia: '2026-09-20', de: 50, para: 55, pct: 10, fonte: 'coleta' }]
  const subiu = o => item({ id: 'MLB300', preco: 55, r: 4000, r0: 6000, u: 30, u0: 50, v: 300, v0: 400, conv: 10, mudancas_preco_28d: ev, preco_realizado_ant: 50, preco_realizado_28d: 55, cobertura: 20, vendas_dia: serieAlta(5, 3), ...o })
  const ctrl = () => [item({ id: 'MLB301', r: 3000, u: 40, u0: 40, cobertura: 20 }), item({ id: 'MLB302', r: 2500, u: 30, u0: 31, cobertura: 20 })]
  const preco = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE }).find(x => x.regra === 'anuncio_preco_mudou_vendas_cairam')
  const CC = { cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  // só o custo do anúncio (sem percentuais): não depende mais do cliente, e diz quanto do preço é custo
  const so = preco([subiu({ custo_unitario: 30, custo_origem: 'manual' }), ...ctrl()])
  assert.equal(so.dados.dependencia, '—')
  assert.equal(so.dados.como[1], 'custo do anúncio R$ 30,00 (vínculo manual) = 60% do preço de antes e 54,5% do atual; comissão, frete e imposto não informados: confirmar a margem com o cliente')
  // custo do anúncio + percentuais da conta: margem nos dois preços
  assert.equal(preco([subiu({ custo_unitario: 30, custo_origem: 'sku_normalizado' }), ...ctrl()], { custos_informados: true, custos: CC }).dados.como[1],
    'Margem estimada 18% no preço de antes (R$ 50,00) e 23,5% no atual (R$ 55,00), com custo do anúncio R$ 30,00 (SKU normalizado) e os percentuais da conta: voltar o preço só se a margem de antes couber')
  assert.match(preco([subiu(), ...ctrl()], { custos_informados: true, custos: CC }).dados.como[1], /^Margem estimada 38% no preço de antes \(R\$ 50,00\) e 38% no atual \(R\$ 55,00\), com o CMV% da conta/)
  // promoção de giro: o CMV do próprio anúncio entra no desconto máximo
  const giro = montarAcoes('__teste__', diagDe([item({ id: 'MLB310', custo_unitario: 10, custo_origem: 'sku' })], { custos_informados: true, custos: CC }), { hoje: HOJE }).find(x => x.regra === 'anuncio_promocao_giro')
  assert.ok(giro, 'estoque em excesso com custos: promoção de giro')
  assert.match(giro.dados.evidencia, new RegExp(`Desconto máximo que preserva a margem desejada: ${descontoMaximoPct({ ...CC, cmv_pct: 20 })}% \\(CMV do próprio anúncio: custo do anúncio R\\$ 10,00 \\(SKU igual\\) = 20% do preço\\)`))
  assert.ok(descontoMaximoPct({ ...CC, cmv_pct: 20 }) > descontoMaximoPct(CC), 'custo do anúncio abaixo do CMV% da conta libera mais desconto')
  // cadastrar custos: some com custo por anúncio, aparece sem nenhum dos dois
  const cad = itens => montarAcoes('__teste__', diagDe(itens), { hoje: HOJE }).some(x => x.regra === 'anuncio_cadastrar_custos')
  assert.equal(cad([item({ id: 'MLB320' })]), true); assert.equal(cad([item({ id: 'MLB320', custo_unitario: 12, custo_origem: 'manual' })]), false)
}
// ── v1.4.0 (motor de diagnóstico, 08/10/2026): as fixtures acima têm u=u0 e v=v0 e não trazem `visitas_sem_mudanca`, então as regras de queda não disparam nos blocos 1–12 ──
const addD = (iso, k) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10) }
// 13) queda de conversão do anúncio contra o próprio histórico: FATO com o controle (anúncios sem mudança) estável; controle que também caiu = mercado, não dispara; sem controle, nada
{
  const ctrlEstavel = { n: 3, u: 100, v: 1000, u0: 100, v0: 1000 }, ctrlCaiu = { n: 3, u: 60, v: 1000, u0: 100, v0: 1000 }
  const caiu = o => item({ id: 'MLB400', r: 4000, u: 20, v: 400, conv: 5, u0: 40, v0: 400, r0: 8000, mudancas_28d: [{ dia: '2026-09-25', campo: 'thumb', de: 'a', para: 'b', pct: null, fonte: 'coleta' }], ...o })
  const outro = () => item({ id: 'MLB401', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE }).filter(x => x.regra === 'anuncio_queda_conversao_anuncio')
  const [q] = da([caiu(), outro()], { visitas_sem_mudanca: ctrlEstavel })
  assert.ok(q && q.item_id === 'MLB400', 'conversão 10% → 5% com o controle estável: dispara')
  assert.equal(q.dados.evidencia_tipo, 'fato'); assert.deepEqual(q.dados.causas_possiveis, [{ causa: 'conteudo', tipo: 'hipotese', sinal: 'título/fotos/capa mudaram em 25/09' }])
  assert.ok(q.dados.confirmar_com.some(c => /NOT_AVAILABLE/.test(c)) && q.dados.entidade.tipo === 'anuncio' && q.dados.nivel === 'anuncio' && q.dados.parada && q.dados.revisar_em === addD(q.prazo, 14) && q.dados.executar_via === 'notion' && Array.isArray(q.dados.depende_de))
  assert.ok(q.previsao.premissas.some(x => /premissa/.test(x)) && q.previsao.cenarios.base.receita > 0 && q.previsao.p_fonte)
  assert.equal(da([caiu(), outro()], { visitas_sem_mudanca: ctrlCaiu }).length, 0, 'controle caiu 40%: é mercado, não dispara')
  assert.equal(da([caiu(), outro()]).length, 0, 'sem controle não dispara')
  // sem mudança registrada: o próprio anúncio é descontado do controle; causa "mercado ou concorrência"
  const semMud = da([caiu({ mudancas_28d: [] }), outro()], { visitas_sem_mudanca: { n: 4, u: 120, v: 1400, u0: 140, v0: 1400 } })
  assert.equal(semMud.length, 1); assert.equal(semMud[0].dados.causas_possiveis[0].causa, 'mercado_ou_concorrencia'); assert.match(semMud[0].dados.evidencia, /Controle \(3 anúncio\(s\)/)
  // catálogo de terceiros: regra FILTRADA — nasce, mas sem a causa de conteúdo (a foto não é do vendedor)
  const ter = da([caiu({ catalogo: true, catalogo_origem: 'terceiros' }), outro()], { visitas_sem_mudanca: ctrlEstavel })
  assert.equal(ter.length, 1); assert.ok(!ter[0].dados.causas_possiveis.some(c => c.causa === 'conteudo'), 'em catálogo de terceiros a causa de conteúdo não entra')
}
// 14) queda de exposição (visitas) com o controle estável; Ads que estava ligado e desligou é a causa provável; pausado ou sem estoque fica fora (outra regra explica)
{
  const ADS0 = { prints: 5000, clicks: 100, custo: 80, receita: 300, unidades: 5, ctr: 2, roas: 3.75 }
  const caiu = o => item({ id: 'MLB410', r: 3000, u: 30, v: 300, conv: 10, u0: 50, v0: 500, r0: 5000, status: 'active', ads: null, ads_ant: ADS0, ...o })
  const outro = () => item({ id: 'MLB411', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })
  const ctrl = { n: 3, u: 130, v: 1300, u0: 150, v0: 1500 }      // inclui o próprio anúncio (sem mudança): o motor o desconta → 1000 × 1000 visitas, estável
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE }).filter(x => x.regra === 'anuncio_queda_exposicao_anuncio')
  const [q] = da([caiu(), outro()], { visitas_sem_mudanca: ctrl })
  assert.ok(q && q.item_id === 'MLB410', 'visitas 500 → 300 (−40%) com o controle estável: dispara')
  assert.equal(q.dados.causas_possiveis[0].causa, 'ads_desligou'); assert.match(q.dados.causas_possiveis[0].sinal, /R\$ 80/)
  assert.match(q.dados.evidencia, /Controle \(2 anúncio\(s\) sem mudança\): 1000 → 1000 visitas \(0%\)/)
  assert.equal(da([caiu({ status: 'paused' }), outro()], { visitas_sem_mudanca: ctrl }).length, 0, 'pausado: outra regra explica')
  assert.equal(da([caiu({ estoque: 0 }), outro()], { visitas_sem_mudanca: ctrl }).length, 0, 'sem estoque: é ruptura, não exposição')
  assert.equal(da([caiu(), outro()], { visitas_sem_mudanca: { n: 3, u: 130, v: 900, u0: 150, v0: 1500 } }).length, 0, 'controle caiu 40%: não dispara')
  assert.equal(da([caiu({ ads_ant: null }), outro()], { visitas_sem_mudanca: ctrl })[0].dados.causas_possiveis[0].causa, 'sazonal', 'sem sinal no anúncio: sazonal/mercado (hipótese)')
}
// 15) CTR de Ads caiu contra a própria janela anterior com o CTR da conta estável; catálogo de terceiros (capa não é do vendedor) não nasce; conta que caiu junto, não; poucas impressões, não
{
  const ADS = { prints: 5000, clicks: 50, custo: 100, receita: 500, unidades: 5, ctr: 1, roas: 5, acos: 20 }, ADS0 = { prints: 5000, clicks: 100, custo: 100, receita: 500, unidades: 5, ctr: 2, roas: 5 }
  const it = o => item({ id: 'MLB420', r: 4000, u: 40, v: 400, conv: 10, u0: 40, v0: 400, ads: ADS, ads_ant: ADS0, ...o })
  const outro = () => item({ id: 'MLB421', r: 5000, u: 100, v: 600, conv: 16.7 })
  const conta = { custo: 100, receita: 500, roas: 5, acos: 20, ctr: 1.5, tacos: 2, clicks: 150, prints: 10000, anterior: { roas: 5, ctr: 1.5 } }
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE }).filter(x => x.regra === 'anuncio_queda_ctr_ads')
  const [q] = da([it(), outro()], { ads: conta })
  assert.ok(q, 'CTR 2% → 1% com a conta em 1,5% → 1,5%: dispara'); assert.equal(q.previsao.tipo, 'risco_evitado'); assert.equal(q.dados.demanda_notion, 'Melhorar Imagens')
  assert.match(q.dados.problema, /CTR de Ads 1% contra 2%/); assert.ok(q.dados.confirmar_com.some(c => /NOT_AVAILABLE/.test(c)) && q.dados.parada.includes('ROAS'))
  assert.equal(da([it({ catalogo: true, catalogo_origem: 'terceiros' }), outro()], { ads: conta }).length, 0, 'catálogo de terceiros: a capa não é do vendedor')
  assert.equal(da([it(), outro()], { ads: { ...conta, ctr: 1, anterior: { roas: 5, ctr: 2 } } }).length, 0, 'a conta inteira caiu 50%: não é este anúncio')
  assert.equal(da([it({ ads: { ...ADS, prints: 500 } }), outro()], { ads: conta }).length, 0, 'abaixo do mínimo de impressões: sem leitura')
}
// 16) margem negativa SÓ com custos: antes de Ads (CMV alto) ou com Ads (margem − ACOS ≤ 0); sem custos nunca nasce (nada de "prejuízo" sem custo)
{
  const CC = { cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE }).filter(x => x.regra === 'anuncio_margem_negativa')
  const antes = da([item({ id: 'MLB430', r: 4000, u: 80 })], { custos_informados: true, custos: { ...CC, cmv_pct: 90 } })
  assert.equal(antes.length, 1); assert.match(antes[0].titulo, /antes de Ads/); assert.equal(antes[0].dados.urgencia, 5); assert.equal(antes[0].previsao.tipo, 'risco_evitado'); assert.match(antes[0].dados.problema, /-12%/)
  // (revisão 08/10: a fixture antiga — Ads R$ 100 sobre R$ 4.000 de receita, ACOS 40% — encodava o erro margem − ACOS; com Ads, a margem desconta o custo de Ads
  //  sobre a receita TOTAL do anúncio. Mesmos 40% e −2%, agora com o custo de Ads em 40% da receita do anúncio)
  const comAds = da([item({ id: 'MLB431', r: 4000, u: 80, ads: { prints: 5000, clicks: 100, custo: 1600, receita: 4000, unidades: 80, ctr: 2, roas: 2.5, acos: 40 } })], { custos_informados: true, custos: CC })
  assert.equal(comAds.length, 1); assert.match(comAds[0].titulo, /com Ads/); assert.equal(comAds[0].dados.causas_possiveis[0].causa, 'ads_consome_a_margem'); assert.match(comAds[0].dados.evidencia, /TACOS do anúncio 40% → -2%/)
  assert.equal(da([item({ id: 'MLB430', r: 4000, u: 80 })]).length, 0, 'sem custos não nasce')
  assert.equal(da([item({ id: 'MLB432', r: 4000, u: 80, custo_unitario: 60, custo_origem: 'manual' })], { custos_informados: true, custos: CC }).length, 1, 'custo do próprio anúncio acima do preço: margem negativa')
}
// 17) Ads abaixo da META do mês (metas_cliente): ACOS 35% com acos_max 20 dispara; sem meta, nada; meta só de GMV não é meta de Ads; o anúncio já reduzido pelo equilíbrio não repete
{
  const ADS = { prints: 5000, clicks: 100, custo: 100, receita: 285, unidades: 5, ctr: 2, roas: 2.85, acos: 35 }
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE })
  const regra = a => a.filter(x => x.regra === 'anuncio_ads_abaixo_meta')
  const [q] = regra(da([item({ id: 'MLB440', r: 4000, u: 80, ads: ADS })], { metas: { gmv: null, roas: null, acos_max: 20, margem_pct: null } }))
  assert.ok(q, 'ACOS 35% > meta 20%: dispara'); assert.match(q.dados.problema, /ACOS 35% contra o máximo de 20%/); assert.equal(q.previsao.tipo, 'risco_evitado'); assert.equal(q.dados.demanda_notion, 'Ajuste ADS')
  assert.equal(regra(da([item({ id: 'MLB440', r: 4000, u: 80, ads: ADS })])).length, 0, 'sem meta não nasce')
  assert.equal(regra(da([item({ id: 'MLB440', r: 4000, u: 80, ads: ADS })], { metas: { gmv: 100, roas: null, acos_max: null, margem_pct: null } })).length, 0, 'meta só de GMV não é meta de Ads')
  assert.equal(regra(da([item({ id: 'MLB440', r: 4000, u: 80, ads: ADS })], { metas: { gmv: null, roas: 4, acos_max: null, margem_pct: null } })).length, 1, 'ROAS 2,85 < meta 4: dispara')
  const reduzido = da([item({ id: 'MLB441', r: 4000, u: 80, ads: { ...ADS, roas: 1, receita: 100, acos: 100 } })], { metas: { gmv: null, roas: null, acos_max: 20, margem_pct: null }, ads: { custo: 100, receita: 100, roas: 5, acos: 20, ctr: 2, tacos: 2, clicks: 100, prints: 5000, anterior: { roas: 5 } } })
  assert.ok(reduzido.some(x => x.regra === 'anuncio_ads_reduzir') && !regra(reduzido).length, 'ads_reduzir já cobre o anúncio: não duplica')
}
// 18) concentração de receita (ação de CONTA, item null) com o top 1 ≥ 40% do GMV; anúncio pausado que vendia (anuncio_restrito) com confirmar_com NOT_COLLECTED
{
  const da = itens => montarAcoes('__teste__', diagDe(itens), { hoje: HOJE })
  const conc = da([item({ id: 'MLB450', r: 6000, u: 120 }), item({ id: 'MLB451', r: 2000, u: 40 }), item({ id: 'MLB452', r: 2000, u: 40 })]).find(x => x.regra === 'anuncio_concentracao_receita')
  assert.ok(conc, 'top 1 com 60% do GMV: dispara'); assert.equal(conc.item_id, ''); assert.deepEqual(conc.dados.entidade, { tipo: 'conta', id: '__teste__' }); assert.equal(conc.dados.nivel, 'conta')
  assert.match(conc.dados.problema, /60% do GMV/); assert.ok(conc.dados.oportunidade && conc.dados.alvo_anuncio.id === 'MLB450' && conc.previsao.tipo === 'risco_evitado' && conc.dados.evidencia_tipo === 'fato')
  assert.ok(!da([item({ id: 'MLB450', r: 3000, u: 60 }), item({ id: 'MLB451', r: 3500, u: 70 }), item({ id: 'MLB452', r: 3500, u: 70 })]).some(x => x.regra === 'anuncio_concentracao_receita'), 'top 1 com 35%: não dispara')
  const rest = da([item({ id: 'MLB461', r: 5000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB460', status: 'paused', r: 0, u: 0, r0: 3000, u0: 60, v: null, v0: null, visOk: false, conv: null })]).find(x => x.regra === 'anuncio_anuncio_restrito')
  assert.ok(rest && rest.item_id === 'MLB460', 'pausado que vendia R$ 3.000: dispara'); assert.equal(rest.dados.evidencia_tipo, 'fato'); assert.ok(rest.dados.confirmar_com.some(c => /NOT_COLLECTED/.test(c))); assert.equal(rest.horizonte, '72h'); assert.equal(rest.previsao.tipo, 'risco_evitado')
  assert.ok(!da([item({ id: 'MLB461', r: 5000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB460', status: 'active', r: 0, u: 0, r0: 3000, u0: 60 })]).some(x => x.regra === 'anuncio_anuncio_restrito'), 'ativo não é restrito')
}
// 19) dependências (config → dependencias): ruptura → ímã e margem negativa → ads_escalar no MESMO anúncio ganham depende_de e prazo ≥ dependência + 2 dias; nada some.
//     (ruptura + ads_escalar no mesmo anúncio é impossível por construção: ads_escalar já exige cobertura ≥ atenção.) Todas as regras v1.4.0 declaram dados/kpi/prova/tipo_demanda,
//     prior como premissa e teto por regra; limiares novos rotulados em `premissas`; a versão subiu DE PROPÓSITO
{
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE })
  const a1 = da([item({ id: 'MLB470', r: 9000, u: 90, v: 1500, conv: 6, estoque: 3, cobertura: 1, vel_dia: 3.2, frete_gratis: false }), item({ id: 'MLB471', r: 5000, u: 100, v: 600, conv: 16.7 })])
  const rup = a1.find(x => x.regra === 'anuncio_estoque_ruptura' && x.item_id === 'MLB470'), ima = a1.find(x => x.regra === 'anuncio_ima_conversao' && x.item_id === 'MLB470')
  assert.ok(rup && ima, 'o mesmo anúncio recebe ruptura e ímã'); assert.deepEqual(ima.dados.depende_de, [rup.id]); assert.ok(ima.prazo >= addD(rup.prazo, 2) && ima.dados.revisar_em === addD(ima.prazo, ima.dados.prova_janela_dias)); assert.deepEqual(rup.dados.depende_de, [])
  assert.ok(a1.some(x => x.regra === 'anuncio_estoque_ruptura') && a1.some(x => x.regra === 'anuncio_ima_conversao'), 'dependência nunca remove ação')
  const CC = { cmv_pct: 90, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const a2 = da([item({ id: 'MLB472', r: 4000, u: 80, v: 500, conv: 16, cobertura: 30, ads: { prints: 9000, clicks: 200, custo: 100, receita: 900, unidades: 18, ctr: 2.2, roas: 9, acos: 11 } })], { custos_informados: true, custos: CC, ads: { custo: 220, receita: 940, roas: 4.27, acos: 23, ctr: 1.6, tacos: 3, clicks: 280, prints: 18000, anterior: { roas: 5 } } })
  const neg = a2.find(x => x.regra === 'anuncio_margem_negativa'), esc = a2.find(x => x.regra === 'anuncio_ads_escalar')
  assert.ok(neg && esc, 'margem negativa e escalar no mesmo anúncio'); assert.deepEqual(esc.dados.depende_de, [neg.id]); assert.ok(esc.prazo >= addD(neg.prazo, 2), 'escalar espera a margem')
  const NOVAS = ['queda_conversao_anuncio', 'queda_exposicao_anuncio', 'queda_ctr_ads', 'margem_negativa', 'ads_abaixo_meta', 'concentracao_receita', 'anuncio_restrito']
  assert.equal(algoritmo.versao, '1.6.0')
  for (const id of NOVAS) {
    const r = algoritmo.regras.find(x => x.id === id); assert.ok(r && r.dados.length && r.kpi && r.tipo_demanda && r.justificativa && r.prova?.metrica && r.prova?.janela_dias && r.adicionada_em === '2026-10-08', 'regra declarada: ' + id)
    assert.ok(algoritmo.priors_efeito[id]?.p_sucesso > 0 && algoritmo.priors_efeito[id].premissa === true && algoritmo.priors_efeito[id].fonte, 'prior como premissa: ' + id)
    assert.ok(algoritmo.foco.max_por_regra[id] >= 1, 'teto por regra: ' + id)
  }
  for (const k of ['queda_conversao_rel_pct', 'queda_visitas_pct', 'queda_ctr_pct', 'controle_max_queda_pct', 'pareto_top1_alerta_pct', 'ads_min_impressoes_ctr', 'lead_time_reposicao_dias']) assert.ok(algoritmo.premissas.limiares.includes(k) && typeof algoritmo.limiares[k] === 'number', 'limiar rotulado como premissa: ' + k)
  assert.deepEqual(algoritmo.dependencias.ads_escalar, ['estoque_ruptura', 'margem_negativa', 'anuncio_restrito'])
}
// 20) Place Sprint 90 (autoatendimento): semConsultor tira NA GERAÇÃO as regras de foco.regras_exigem_consultor (contadas em omitidas.exige_consultor) e
//     as vagas da semana não ficam vazias; sem a flag nada muda
{
  const EXIGE = algoritmo.foco.regras_exigem_consultor
  const its = () => [item({ id: 'MLB900', r: 30000, r0: 48000, u: 300, u0: 480, v: 2400, v0: 4200, conv: 12.5 }), ...Array.from({ length: 10 }, (_, k) => item({ id: 'MLB9' + (10 + k), r: 2000 - k * 50, u: 40, v: 900, conv: 4.4, frete_gratis: false, fotos: 2 }))]
  const base = montarAcoes('__teste__', diagDe(its()), { hoje: HOJE }), s90 = montarAcoes('__teste__', diagDe(its()), { hoje: HOJE, semConsultor: true })
  assert.ok(base.some(x => EXIGE.includes(regras([x])[0])), 'fixture gera regra que exige consultor')
  assert.ok(!s90.some(x => EXIGE.includes(regras([x])[0])) && s90.omitidas.exige_consultor > 0, 'semConsultor: nenhuma nasce, todas contadas')
  assert.equal(s90.filter(x => x.dados.fila === 'esta_semana').length, algoritmo.foco.max_acoes_por_cliente_semana, 'as 5 vagas não ficam vazias')
  assert.deepEqual(montarAcoes('__teste__', diagDe(its()), { hoje: HOJE, semConsultor: false }).map(x => x.id), base.map(x => x.id), 'sem a flag o plano é o mesmo')
}
// 21) margem com Ads = margem pré − custo de Ads ÷ receita TOTAL do anúncio (TACOS do anúncio, a mesma definição da conta); ACOS acima da margem é outro sinal
//     ("vendas atribuídas a Ads sem margem"), nunca "margem negativa do anúncio"
{
  const CC = { cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }    // margem pré-Ads 38%
  const da = (itens, extra) => montarAcoes('__teste__', diagDe(itens, extra), { hoje: HOJE })
  // repro da revisão: margem 38%, receita 28.000, Ads R$ 1.000 com R$ 2.000 atribuídos → ACOS 50% (38 − 50 = −12%, errado); TACOS 3,6% → ≈ 34,4%
  const a = da([item({ id: 'MLB480', r: 28000, u: 560, ads: { prints: 20000, clicks: 400, custo: 1000, receita: 2000, unidades: 40, ctr: 2, roas: 2, acos: 50 } })], { custos_informados: true, custos: CC, economia: economiaAds(CC) })
  assert.ok(!a.some(x => x.regra === 'anuncio_margem_negativa'), 'margem 38% − TACOS 3,6% ≈ 34,4% > 0: não é margem negativa')
  const red = a.find(x => x.regra === 'anuncio_ads_reduzir' && x.item_id === 'MLB480')
  assert.ok(red, 'ROAS 2 abaixo do equilíbrio 2,63: reduzir Ads')
  const sinal = red.dados.causas_possiveis.find(c => c.causa === 'vendas_ads_sem_margem')
  assert.ok(sinal && /vendas atribuídas a Ads sem margem/.test(sinal.sinal) && /ACOS 50%/.test(sinal.sinal), 'ACOS > margem vira sinal separado no Ads do anúncio')
  assert.ok(!a.some(x => /margem negativa/i.test(JSON.stringify(x.dados))), 'nada chama isso de margem negativa')
  // com o custo de Ads comendo a margem da receita TOTAL: dispara, com a conta declarada e o sinal de ACOS como causa à parte
  const [n] = da([item({ id: 'MLB481', r: 2000, u: 40, ads: { prints: 5000, clicks: 100, custo: 800, receita: 1000, unidades: 20, ctr: 2, roas: 1.25, acos: 80 } })], { custos_informados: true, custos: CC }).filter(x => x.regra === 'anuncio_margem_negativa')
  assert.ok(n, 'margem 38% − TACOS 40% = −2%: dispara'); assert.match(n.dados.problema, /-2%/); assert.match(n.dados.evidencia, /custo de Ads R\$ 800 ÷ receita do anúncio R\$ 2\.000: TACOS do anúncio 40% → -2% depois de Ads/)
  assert.deepEqual(n.dados.causas_possiveis.map(c => c.causa), ['ads_consome_a_margem', 'vendas_ads_sem_margem'])
  // mesmo corte da conta: janela ATUAL com mais dias sem coleta que o máximo → receita incompleta infla o TACOS → sem margem com Ads; lacuna só na anterior não muda nada
  const comLacunas = lacunas => da([item({ id: 'MLB481', r: 2000, u: 40, ads: { prints: 5000, clicks: 100, custo: 800, receita: 1000, unidades: 20, ctr: 2, roas: 1.25, acos: 80 } })], { custos_informados: true, custos: CC, data_quality: { cobertura: { pedidos: { lacunas, truncados: 0 } } } }).some(x => x.regra === 'anuncio_margem_negativa')
  assert.equal(comLacunas(['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']), false, '4 dias sem coleta na janela atual: TACOS do anúncio não é afirmado')
  assert.equal(comLacunas(['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23']), true, 'lacunas só na janela anterior: a margem com Ads segue valendo')
}
// 22) amostra mínima nas regras de queda (FATO só com volume): 3 → 2 unidades em 150 visitas (−33,5%) e 4 → 3 cliques em 1.000 impressões (−25%) não disparam
{
  const ctrlEstavel = { n: 3, u: 100, v: 1000, u0: 100, v0: 1000 }
  const mud = [{ dia: '2026-09-25', campo: 'thumb', de: 'a', para: 'b', pct: null, fonte: 'coleta' }]
  const outro = () => item({ id: 'MLB491', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })
  const conv = (u0, u) => montarAcoes('__teste__', diagDe([item({ id: 'MLB490', r: 100 * u, u, v: 150, conv: Math.round(1000 * u / 150) / 10, u0, v0: 150, r0: 100 * u0, mudancas_28d: mud }), outro()], { visitas_sem_mudanca: ctrlEstavel }), { hoje: HOJE }).filter(x => x.regra === 'anuncio_queda_conversao_anuncio')
  assert.equal(conv(3, 2).length, 0, '3 → 2 unidades: amostra abaixo do mínimo, não é FATO')
  assert.equal(conv(12, 8).length, 1, 'controle: 12 → 8 unidades (≥ mínimo) dispara')
  const ADS0 = { prints: 1000, clicks: 4, custo: 50, receita: 200, unidades: 2, ctr: 0.4, roas: 4 }, ADS = { prints: 1000, clicks: 3, custo: 50, receita: 200, unidades: 2, ctr: 0.3, roas: 4, acos: 25 }
  const conta = { custo: 100, receita: 500, roas: 5, acos: 20, ctr: 1.5, tacos: 2, clicks: 150, prints: 10000, anterior: { roas: 5, ctr: 1.5 } }
  const ctr = (a, a0) => montarAcoes('__teste__', diagDe([item({ id: 'MLB492', r: 4000, u: 40, v: 400, conv: 10, u0: 40, v0: 400, ads: a, ads_ant: a0 }), outro()], { ads: conta }), { hoje: HOJE }).filter(x => x.regra === 'anuncio_queda_ctr_ads')
  assert.equal(ctr(ADS, ADS0).length, 0, '4 → 3 cliques: amostra abaixo do mínimo, não é FATO')
  assert.equal(ctr({ ...ADS, prints: 10000, clicks: 30, ctr: 0.3 }, { ...ADS0, prints: 10000, clicks: 40, ctr: 0.4 }).length, 1, 'controle: 40 → 30 cliques em 10.000 impressões dispara')
}
// 23) dia sem coleta ou truncado em qualquer das janelas (data_quality.cobertura.pedidos, a mesma fonte da variação da conta): nenhuma regra de queda afirma FATO
{
  const mud = [{ dia: '2026-09-25', campo: 'thumb', de: 'a', para: 'b', pct: null, fonte: 'coleta' }]
  const ADS = { prints: 5000, clicks: 50, custo: 100, receita: 500, unidades: 5, ctr: 1, roas: 5, acos: 20 }, ADS0 = { prints: 5000, clicks: 100, custo: 100, receita: 500, unidades: 5, ctr: 2, roas: 5 }
  const itens = () => [item({ id: 'MLB500', r: 4000, u: 20, v: 400, conv: 5, u0: 40, v0: 400, r0: 8000, mudancas_28d: mud }),
    item({ id: 'MLB501', r: 3000, u: 30, v: 300, conv: 10, u0: 50, v0: 500, r0: 5000, status: 'active', mudancas_28d: mud }),
    item({ id: 'MLB502', r: 4000, u: 40, v: 400, conv: 10, u0: 40, v0: 400, ads: ADS, ads_ant: ADS0 }), item({ id: 'MLB503', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })]
  const base = { visitas_sem_mudanca: { n: 3, u: 100, v: 1000, u0: 100, v0: 1000 }, ads: { custo: 100, receita: 500, roas: 5, acos: 20, ctr: 1.5, tacos: 2, clicks: 150, prints: 10000, anterior: { roas: 5, ctr: 1.5 } } }
  const QUEDAS = ['anuncio_queda_conversao_anuncio', 'anuncio_queda_exposicao_anuncio', 'anuncio_queda_ctr_ads']
  const quedas = pedidos => montarAcoes('__teste__', diagDe(itens(), { ...base, data_quality: { cobertura: { pedidos } } }), { hoje: HOJE }).filter(x => QUEDAS.includes(x.regra)).map(x => x.regra).sort()
  assert.deepEqual(quedas({ de: '2026-05-01', ate: '2026-10-04', lacunas: [], truncados: 0 }), [...QUEDAS].sort(), 'janelas inteiras: as 3 quedas disparam')
  assert.deepEqual(quedas({ de: '2026-05-01', ate: '2026-10-04', lacunas: ['2026-09-15'], truncados: 0 }), [], '1 dia sem coleta: nenhuma queda')
  assert.deepEqual(quedas({ de: '2026-05-01', ate: '2026-10-04', lacunas: [], truncados: 1 }), [], '1 dia truncado: nenhuma queda')
}
// 24) texto ao cliente sem promessa de posição ("ranking"), sem nome interno e sem id de job: ruptura, queda de exposição sem sinal e ação de Ofertas
{
  const RUIM = /ranking|Merov|Notion|\bjob\b|escopo|3e0c980e/i
  const rup = montarAcoes('__teste__', diagDe([item({ id: 'MLB510', r: 9000, u: 120, estoque: 6, cobertura: 1, vel_dia: 4.3 })]), { hoje: HOJE }).find(x => x.regra === 'anuncio_estoque_ruptura')
  assert.ok(rup && !RUIM.test(rup.dados.hipotese) && /exposição na busca/.test(rup.dados.hipotese), rup?.dados.hipotese)
  const exp = montarAcoes('__teste__', diagDe([item({ id: 'MLB511', r: 3000, u: 30, v: 300, conv: 10, u0: 50, v0: 500, r0: 5000, status: 'active' }), item({ id: 'MLB512', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })], { visitas_sem_mudanca: { n: 3, u: 130, v: 1300, u0: 150, v0: 1500 } }), { hoje: HOJE }).find(x => x.regra === 'anuncio_queda_exposicao_anuncio')
  assert.ok(exp && exp.dados.causas_possiveis[0].causa === 'sazonal', 'queda de exposição sem sinal no anúncio')
  for (const t of [exp.dados.hipotese, exp.dados.causas_possiveis[0].sinal]) assert.ok(!RUIM.test(t) && /posição na busca/.test(t), t)
  const job = { id: '3e0c980e-0000-4000-8000-000000000001', escopo: 'galeria', objetivo: 'elevar_clique', variante_id: 'v1', criado_em: '2026-10-05T10:00:00', proposta_versao: 1 }
  const of = acaoDeOferta('__teste__', { regra: 'anuncio_oferta_galeria', job, item: item({ id: 'MLB513' }), baseline: { unidades: 10, preco: 50 }, diagnostico: { lentes: {} }, hoje: HOJE })
  for (const t of [of.titulo, of.dados.problema, of.dados.evidencia, of.dados.hipotese, of.dados.criterio_aceite, ...of.previsao.premissas]) assert.ok(!RUIM.test(t), t)
  assert.ok(of.previsao.premissas.some(x => /medição suficiente desta família de ações/.test(x)))
  assert.deepEqual([of.dados.oferta.job_id, of.dados.oferta.escopo, of.dados.oferta.objetivo], [job.id, 'galeria', 'elevar_clique'], 'o job continua em dados.oferta')
}
// 25) série de VISITAS parada (visOk false): a cobertura é decidida UMA vez, na origem (visitasCobrem em carregarBase, fronteira testada em
//     teste-diagnostico-conta-rev); o plano só lê visOk — o anúncio parado não afirma queda de exposição nem de conversão como FATO, e o controle
//     (visitas_sem_mudanca) chega sem ele. (Rodada anterior: o plano relia vis_ate do banco com vis_ate > fim; a releitura saiu com o critério na origem.)
{
  const somaCtrl = l => ({ n: l.length, u: l.reduce((t, i) => t + i.u, 0), v: l.reduce((t, i) => t + i.v, 0), u0: l.reduce((t, i) => t + i.u0, 0), v0: l.reduce((t, i) => t + i.v0, 0) })
  const acoesDe = itens => montarAcoes('__teste__', diagDe(itens, { visitas_sem_mudanca: somaCtrl(itens.filter(i => i.visOk)) }), { hoje: HOJE })   // como carregarBase: controle só com visOk
  const quedas = itens => acoesDe(itens).filter(x => /queda_(exposicao|conversao)_anuncio/.test(x.regra)).map(x => `${x.item_id}:${x.regra.replace('anuncio_queda_', '')}`).sort()
  const exp = o => item({ id: 'MLB600', r: 3000, u: 30, v: 300, conv: 10, u0: 50, v0: 500, r0: 5000, status: 'active', ...o })        // visitas −40%
  const conv = o => item({ id: 'MLB603', r: 2000, u: 20, v: 400, conv: 5, u0: 40, v0: 400, r0: 4000, ...o })         // conversão 10% → 5%
  const ctrl = item({ id: 'MLB602', r: 5000, u: 100, v: 1000, conv: 10, u0: 100, v0: 1000 })
  assert.deepEqual(quedas([exp(), conv(), ctrl]), ['MLB600:exposicao_anuncio', 'MLB603:conversao_anuncio'], 'séries cobertas: as duas quedas disparam')
  assert.deepEqual(quedas([exp({ visOk: false }), conv({ visOk: false }), ctrl]), [], 'série parada: nenhuma queda vira FATO (mesmo com números de visitas no item)')
  const parado = item({ id: 'MLB601', r: 4000, u: 100, v: 500, conv: 20, u0: 100, v0: 1000, status: 'active', visOk: false })
  const a = acoesDe([exp(), ctrl, parado]).filter(x => x.regra === 'anuncio_queda_exposicao_anuncio')
  assert.deepEqual(a.map(x => x.item_id), ['MLB600'], 'o parado não dispara; o coberto dispara com o controle sem o parado')
  assert.match(a[0].dados.evidencia, /Controle \(1 anúncio\(s\) sem mudança\): 1000 → 1000 visitas \(0%\)/)
}
// 26) dia sem coleta ou truncado na janela ATUAL (qualquer quantidade): receita do anúncio incompleta, TACOS inflado → nenhuma margem negativa com Ads como FATO;
//     a regra do preço (vendas/dia de pedidos, onde dia sem coleta conta zero) segue o mesmo corte das demais quedas
{
  const CC = { cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const neg = pedidos => montarAcoes('__teste__', diagDe([item({ id: 'MLB481', r: 2000, u: 40, ads: { prints: 5000, clicks: 100, custo: 800, receita: 1000, unidades: 20, ctr: 2, roas: 1.25, acos: 80 } })], { custos_informados: true, custos: CC, data_quality: { cobertura: { pedidos } } }), { hoje: HOJE }).some(x => x.regra === 'anuncio_margem_negativa')
  assert.equal(neg({ lacunas: [], truncados: 0 }), true, 'janela inteira: margem 38% − TACOS 40% dispara')
  assert.equal(neg({ lacunas: ['2026-10-04'], truncados: 0 }), false, '1 dia sem coleta na janela atual: a receita lida é piso, a margem com Ads não é afirmada')
  assert.equal(neg({ lacunas: [], truncados: 1 }), false, '1 dia truncado: idem')
  const ev = [{ dia: '2026-09-20', de: 50, para: 55, pct: 10, fonte: 'coleta' }]
  const subiu = item({ id: 'MLB300', preco: 55, r: 4000, r0: 6000, u: 30, u0: 50, v: 300, v0: 400, conv: 10, mudancas_preco_28d: ev, vendas_dia: serieAlta(5, 3) })
  const preco = pedidos => montarAcoes('__teste__', diagDe([subiu, item({ id: 'MLB301', r: 3000, u: 40, u0: 40 })], { data_quality: { cobertura: { pedidos } } }), { hoje: HOJE }).some(x => x.regra === 'anuncio_preco_mudou_vendas_cairam')
  assert.equal(preco({ lacunas: [], truncados: 0 }), true, 'janelas inteiras: dispara')
  assert.equal(preco({ lacunas: ['2026-09-27'], truncados: 0 }), false, '1 dia sem coleta: o dia some do anúncio e do controle, a queda não é FATO')
  assert.equal(preco({ lacunas: [], truncados: 2 }), false, 'dia truncado: idem')
}
// 27) texto corrido sem código de estado da API (NOT_*): os códigos ficam só em confirmar_com (campo estruturado)
{
  const ctrlEstavel = { n: 3, u: 100, v: 1000, u0: 100, v0: 1000 }
  const [q] = montarAcoes('__teste__', diagDe([item({ id: 'MLB490', r: 800, u: 8, v: 150, conv: 5.3, u0: 12, v0: 150, r0: 1200, mudancas_28d: [{ dia: '2026-09-25', campo: 'thumb', de: 'a', para: 'b', pct: null, fonte: 'coleta' }] }), item({ id: 'MLB491', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })], { visitas_sem_mudanca: ctrlEstavel }), { hoje: HOJE }).filter(x => x.regra === 'anuncio_queda_conversao_anuncio')
  assert.ok(q, 'queda de conversão dispara')
  for (const t of [q.titulo, q.dados.problema, q.dados.evidencia, q.dados.hipotese, ...q.dados.como]) assert.doesNotMatch(t, /NOT_[A-Z]/, t)
  assert.match(q.dados.hipotese, /visitas por origem e as perguntas do anúncio \(ainda não disponíveis no sistema\)/)
  assert.ok(q.dados.confirmar_com.some(c => /NOT_AVAILABLE/.test(c)), 'confirmar_com mantém o código')
}
// 28) percentual minúsculo no TEXTO nunca sai "0%": conversão de 0,01% no ímã e participação de 0,001% do GMV saem com 2 algarismos significativos; valores normais
//     com vírgula. (Rodada anterior: "< 0,1%" — trocado porque igualava valores diferentes na mesma frase, ver o caso 29.)
{
  const bom = item({ id: 'MLB700', r: 5000, u: 100, v: 600, conv: 16.7 }), cauda = item({ id: 'MLB701', r: 3000, u: 3, v: 30000, conv: 0.01 })
  const ima = montarAcoes('__teste__', diagDe([bom, cauda]), { hoje: HOJE }).find(x => x.regra === 'anuncio_ima_conversao' && x.item_id === 'MLB701')
  assert.ok(ima, 'ímã dispara')
  assert.match(ima.dados.problema, /converte 0,01% contra 0,34% da própria conta — falta fechar 0,33 pontos/); assert.doesNotMatch(ima.dados.problema, /converte 0%/)
  assert.match(ima.dados.evidencia, /conversão 0,01%/)
  // a ordem do diagnóstico sintético põe o anúncio minúsculo como curva A (antes 0%): o texto do frete cita a participação dele
  const fr = montarAcoes('__teste__', diagDe([item({ id: 'MLB702', r: 1, u: 5, frete_gratis: false }), item({ id: 'MLB703', r: 100000, u: 500 })]), { hoje: HOJE }).find(x => x.regra === 'anuncio_frete_gratis' && x.item_id === 'MLB702')
  assert.ok(fr && fr.dados.problema === 'Anúncio curva A (0,001% do GMV) sem frete grátis', fr?.dados.problema)
  const conc = montarAcoes('__teste__', diagDe([item({ id: 'MLB704', r: 6234 }), item({ id: 'MLB705', r: 3766 })]), { hoje: HOJE }).find(x => x.regra === 'anuncio_concentracao_receita')
  assert.match(conc.dados.problema, /responde por 62,3% do GMV/)
}
// 29) conta de ticket alto (conversões abaixo de 0,1%): o texto não iguala anúncio e benchmark, o gap não vira "0 pontos" e a meta é um número; TACOS e CTR
//     minúsculos nos textos de Ads e da margem saem > 0 e com vírgula; margem de 0,04% não é "margem negativa" (o arredondamento não cria o zero que a regra lê)
{
  const bom = item({ id: 'MLB10', r: 100000, u: 20, v: 50000, conv: 0.04, preco: 5000 }), fraco = item({ id: 'MLB11', r: 15000, u: 3, v: 15000, conv: 0.02, preco: 5000 })
  const d = diagDe([bom, fraco]); assert.equal(d.benchmark.conv, 0.04)
  const ima = montarAcoes('__teste__', d, { hoje: HOJE }).find(x => x.regra === 'anuncio_ima_conversao' && x.item_id === 'MLB11')
  assert.equal(ima.dados.problema, 'Vende e tem tráfego, mas converte 0,02% contra 0,04% da própria conta — falta fechar 0,02 pontos')
  assert.equal(ima.dados.meta, 'conversão ≥ 0,026% em 14 dias (fecha ~30% do gap)')
  assert.ok(ima.previsao.premissas.includes('gap = 0,02 p.p. até o benchmark da conta'), ima.previsao.premissas.join(' | '))
  const CC = { cmv_pct: 90, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 0 }
  const neg = montarAcoes('__teste__', diagDe([item({ id: 'MLB20', r: 30000, u: 600, ads: { prints: 2000, clicks: 3, custo: 1, receita: 0, unidades: 0, ctr: 0.15, roas: 0, acos: null } })], { custos_informados: true, custos: CC }), { hoje: HOJE }).find(x => x.regra === 'anuncio_margem_negativa')
  assert.match(neg.dados.evidencia, /TACOS do anúncio 0,0033% → -12% depois de Ads/); assert.doesNotMatch(neg.dados.evidencia, /TACOS do anúncio 0%/)
  const red = montarAcoes('__teste__', diagDe([item({ id: 'MLB21', r: 3000, u: 30, ads: { prints: 30000000, clicks: 30, custo: 40, receita: 0, unidades: 0, ctr: 0.0001, roas: 0, acos: null } })]), { hoje: HOJE }).find(x => x.regra === 'anuncio_ads_reduzir')
  assert.match(red.dados.evidencia, /\(CTR 0,0001%\)/)
  const quase = { ...CC, cmv_pct: 50, comissao_pct: 43.96 }                       // 100 − 50 − 6 − 43,96 = 0,04
  assert.equal(margemPct(quase, 100), 0.04)
  assert.ok(!montarAcoes('__teste__', diagDe([item({ id: 'MLB22', r: 3000, u: 30 })], { custos_informados: true, custos: quase }), { hoje: HOJE }).some(x => x.regra === 'anuncio_margem_negativa'), 'margem 0,04% > 0: não é margem negativa')
}
// 30) ação de Ofertas (oferta completa) em ticket alto: a premissa do gap em unidades e a meta de conversão saem no formato pt-BR sem virar 0; meta só quando
//     o ganho previsto MOVE a conversão lida (senão a ação declara que não tem meta numérica); o indicador imprime a conversão com vírgula
{
  const job = { id: '3e0c980e-0000-4000-8000-000000000002', escopo: 'oferta_completa', objetivo: 'melhorar_conversao', variante_id: 'v2', criado_em: '2026-10-05T10:00:00', proposta_versao: 1 }
  const per = { de: '2026-09-07', ate: '2026-10-04', dias: 28 }
  const de = (baseline, gap_receita) => acaoDeOferta('__teste__', { regra: 'anuncio_oferta_completa', job, item: item({ id: 'MLB514', preco: baseline.preco }), baseline: { periodo: per, ...baseline }, diagnostico: { lentes: {}, prioridade: { gap_receita } }, hoje: HOJE })
  const alto = de({ unidades: 3, preco: 5000, visitas: 15000, conversao: { valor: 0.02 } }, 150)       // gap = 0,03 un/28d
  assert.ok(alto.previsao.premissas.includes('gap até a conversão da própria conta ≈ 0,03 un/28d (diagnóstico do job)'), alto.previsao.premissas.join(' | '))
  assert.equal(alto.dados.indicador_inicial, 'conversão 0,02%')
  assert.match(alto.dados.meta, /^sem meta numérica: o ganho previsto \(≈ 0,009 un\/28d\) não move a conversão lida \(0,02%\)/); assert.doesNotMatch(alto.dados.meta, /≥ 0%/)
  const um = de({ unidades: 24, preco: 50, visitas: 2000, conversao: { valor: 1.2 } }, 50)              // alvo 1,215% imprime igual ao atual (1,2%)
  assert.match(um.dados.meta, /^sem meta numérica/); assert.doesNotMatch(um.dados.meta, /≥ 1[.,]2%/)
  const real = de({ unidades: 24, preco: 50, visitas: 2000, conversao: { valor: 1.2 } }, 600)           // alvo 1,38% → 1,4% > 1,2%
  assert.match(real.dados.meta, /^conversão ≥ 1,4% em \d+ dias$/)
}
// 31) GMV 0 (anúncio no foco só por Ads): curva C, não A — "campeão de vendas" (urgência oculta) e caixa de compra ("0 ≥ 0") não nascem sem venda; o gasto de Ads sem venda continua sendo fato
{
  const so = item({ id: 'MLB800', r: 0, u: 0, u0: 0, r0: 0, v: 400, conv: 0, catalogo: true, buy_box: false, ads: { prints: 5000, clicks: 40, custo: 50, receita: 0, unidades: 0, ctr: 0.8, roas: 0, acos: null } })
  const d = diagDe([so]); assert.equal(so.curva, 'C', 'antes: tudo caía em A com GMV 0')
  const regras = montarAcoes('__teste__', d, { hoje: HOJE }).map(x => x.regra)
  assert.ok(!regras.includes('anuncio_urgencia_oculta') && !regras.includes('anuncio_catalogo_buybox'), regras.join(', '))
  assert.ok(regras.includes('anuncio_ads_reduzir'))
  assert.equal(classificarCurvas([item({ id: 'MLB801', r: 500 }), item({ id: 'MLB802', r: 0 })], null).map(i => i.curva).join(''), 'AC', 'com receita a curva segue como sempre')
}
// 32) "visitas/dia" da queda de exposição e o PDF do plano nunca imprimem 0 para valor ≠ 0 (pctTxt): 1 visita em 28 dias é 0,036/dia; TACOS 0,00036% e conversão 0,0036% no documento
{
  const { renderPlanoConta } = await import('../src/lib/render-plano-conta.js')
  const exp = montarAcoes('__teste__', diagDe([item({ id: 'MLB900', r: 100, u: 1, v: 1, conv: 100, u0: 50, v0: 500, r0: 5000, status: 'active' }), item({ id: 'MLB901', r: 5000, u: 100, v: 600, conv: 16.7, u0: 100, v0: 600 })], { visitas_sem_mudanca: { n: 3, u: 130, v: 1300, u0: 150, v0: 1500 } }), { hoje: HOJE }).find(x => x.regra === 'anuncio_queda_exposicao_anuncio')
  assert.ok(exp, 'queda de exposição dispara'); assert.equal(exp.dados.indicador_inicial, '0,036 visitas/dia (antes 17,9)'); assert.doesNotMatch(exp.dados.meta, /≥ 0 /)
  const cauda = item({ id: 'MLB910', r: 100, u: 1, v: 28000, conv: 0.0036, ads: { prints: 1000000, clicks: 1, custo: 1, receita: 1, unidades: 0, ctr: 0.0001, roas: 1, acos: 100 } })
  const d = diagDe([cauda], { ads: { custo: 1, receita: 1, roas: 1, acos: 100, ctr: 0.0001, tacos: 0.00036, clicks: 1, prints: 1000000, anterior: { roas: null } } })
  assert.equal(d.resumo.conversao_conta, 0.0036)
  const prev = { cenarios: { conservador: { ganho: 0, faturamento: 0, uplift_pct: 0 }, base: { ganho: 0, faturamento: 0, uplift_pct: 0 }, otimista: { ganho: 0, faturamento: 0, uplift_pct: 0 } }, baseline: 0, ultimo_periodo: 0, baseline_regra: '', receita_em_risco_evitada: 0, n_acoes: 0 }
  const html = renderPlanoConta({ diag: { ...d, causal: null }, acoes: montarAcoes('__teste__', d, { hoje: HOJE }), previsao: prev, custos: null })
  assert.ok(html.includes('TACOS 0,00036%') && html.includes('conversão de 0,0036%') && html.includes('CTR de Ads da conta: <b>0,0001%</b>'), 'antes: "TACOS 0%", "conversão de 0%" e CTR "0%"')
  assert.doesNotMatch(html, /TACOS 0%|conversão de 0%|ACOS 0%/)
  assert.ok(html.includes('ACOS 100%'), 'valores normais seguem')
}
console.log('✔ plano-anuncios: ímã, ruptura, Ads, custos/ROAS alvo, Full, foco/IDs estáveis, previsão com teto e sobreposição, honestidade das premissas, preço subiu × vendas caíram, custo por anúncio na margem')
console.log('✔ plano-anuncios v1.4.0: queda de conversão/exposição/CTR com controle, amostra mínima e janelas inteiras, margem com Ads pelo TACOS do anúncio (ACOS como sinal à parte), margem negativa só com custos, Ads abaixo da meta, concentração (conta), anúncio restrito, dependências e declarações')
// 33) Chaveiro F1: toda ação gerada declara o caminho (dados.execucao.caminho ∈ CAMINHOS), sem custos o preço fica assistido, Ofertas/Promoções coerentes
{
  const { CAMINHOS, OPERACOES } = await import('../src/lib/chaveiro.js')
  const bom = item({ id: 'MLB10', r: 5000, u: 100, v: 600, conv: 16.7 })
  const ima = item({ id: 'MLB11', r: 3000, u: 30, v: 500, conv: 6, frete_gratis: false, fotos: 3 })
  const acoes = montarAcoes('__teste__', diagDe([bom, ima]), { hoje: HOJE })
  assert.ok(acoes.length)
  for (const a of acoes) {
    const ex = a.dados.execucao
    assert.ok(ex && CAMINHOS.includes(ex.caminho), a.regra); assert.ok(OPERACOES[ex.adaptador].includes(ex.operacao) || ex.adaptador === 'nenhum', a.regra)
    if (a.dados.executar_via === 'oferta') assert.equal(ex.adaptador, 'ofertas', a.regra)
    if (a.dados.executar_via === 'promocoes') assert.equal(ex.adaptador, 'promocoes', a.regra)
    if (ex.adaptador === 'ml_item') assert.equal(ex.caminho, 'assistido', a.regra + ': diag sem custos')
  }
}
console.log('✔ plano-anuncios: Chaveiro F1 — caminho declarado em toda ação')
// ── v1.5.0 (09/10/2026): regras de SAÚDE DA CONTA lidas da leitura GRAVADA (lerSaude; banco :memory: com SCHEMA_SAUDE). Cada regra dispara com saúde sintética e NÃO dispara
//    sem linha do dia, com o bloco pendente (403/endpoint/indisponível) ou com leitura velha; Full só com idade (ou dias sem venda estimados) ≥ limiar e disponível > 0, fonte declarada ──
const { db: dbS } = await import('../src/lib/db.js')
const { CAMINHOS: CAM_S } = await import('../src/lib/chaveiro.js')
const { ordemDoTipo } = await import('../src/lib/processos.js')
const REG_S =['reputacao_em_risco', 'envio_atrasado', 'reclamacao_sem_resposta', 'pergunta_sem_resposta', 'full_estoque_antigo']
const T_S = `${HOJE}T06:00:00.000Z`
// grava a leitura do dia de um cliente sintético: linha de meli_conta_saude + listas (claims, perguntas, atrasos, Full) + meli_item do anúncio Full fora do diagnóstico
function gravarSaude(cli, { dia = HOJE, linha = {}, pendente = {}, claims = [], perguntas = [], atrasos = [], full = [], itens = [] } = {}) {
  const l = { level_id: '3_yellow', power_seller: null, taxa_claims: 1.8, taxa_atraso: 3, taxa_cancel: 0.5, vendas_periodo: 120, perguntas_abertas: 3, perguntas_24h: 2, claims_abertas: 2, mediacoes: 1, atrasos: 2, ...linha }
  dbS.prepare('INSERT INTO meli_conta_saude (cliente, dia, level_id, power_seller, taxa_claims, taxa_atraso, taxa_cancel, vendas_periodo, perguntas_abertas, perguntas_24h, claims_abertas, mediacoes, atrasos, fonte_json, pendente_json, coletado_em) VALUES (@c,@dia,@level_id,@power_seller,@taxa_claims,@taxa_atraso,@taxa_cancel,@vendas_periodo,@perguntas_abertas,@perguntas_24h,@claims_abertas,@mediacoes,@atrasos,\'{}\',@pend,@t)').run({ c: cli, dia, ...l, pend: JSON.stringify(pendente), t: T_S })
  for (const x of claims) dbS.prepare("INSERT INTO meli_claim (cliente, claim_id, item_id, order_id, tipo, estagio, status, motivo, aberto_em, prazo_resposta, fechado_em, atualizado_em) VALUES (?,?,?,NULL,'claim',?,'opened',NULL,?,?,NULL,?)").run(cli, x.id, x.item_id ?? null, x.estagio || 'claim_opened', T_S, x.prazo ?? null, T_S)
  for (const x of perguntas) dbS.prepare("INSERT INTO meli_pergunta (cliente, question_id, item_id, texto_hash, status, perguntado_em, respondido_em) VALUES (?,?,?,NULL,'UNANSWERED',?,NULL)").run(cli, x.id, x.item_id ?? null, x.em)
  for (const x of atrasos) dbS.prepare("INSERT INTO meli_envio_atraso (cliente, order_id, shipment_id, item_id, prazo_despacho, despachado_em, dias_atraso, status, coletado_em) VALUES (?,?,?,?,?,NULL,?,'ready_to_ship',?)").run(cli, x.order, 's' + x.order, x.item_id ?? null, addD(HOJE, -x.dias), x.dias, T_S)
  for (const x of full) dbS.prepare("INSERT INTO meli_full_estoque (cliente, item_id, inventory_id, dia, disponivel, nao_disponivel, dias_sem_venda, idade_dias, fonte, pendente) VALUES (?,?,?,?,?,0,?,?,?,?)").run(cli, x.item_id, 'INV' + x.item_id, dia, x.disponivel, x.dias_sem_venda ?? null, x.idade_dias ?? null, x.idade_dias != null ? 'full' : 'estimativa_serie', x.idade_dias != null ? '' : 'endpoint_nao_verificado')
  for (const x of itens) dbS.prepare("INSERT INTO meli_item (cliente, item_id, titulo, permalink, thumb, preco, status, estoque, fotos, catalogo, atualizado_em) VALUES (?,?,?,?,'',?,'active',30,6,?,?)").run(cli, x.id, x.titulo || 'Produto Full parado', `https://produto.mercadolivre.com.br/${x.id}-x-_JM`, x.preco ?? 80, x.catalogo ? 1 : 0, T_S)
}
const ANTIGA = '2026-10-03T10:00:00.000Z'   // há mais de 24 h (lerSaude compara com o relógio real; 03/10/2026 já passou)
const PRAZO_CURTO = `${HOJE}T12:00:00.000Z`  // prazo de resposta já vencido/perto: < agora + 24 h
const daS = (cli, itens, extra = {}, ticket = 50) => { const d = diagDe(itens, { cliente: cli, ...extra }); d.resumo.ticket = ticket; return montarAcoes(cli, d, { hoje: HOJE }) }
const BOM = () => item({ id: 'MLB10', r: 5000, u: 100, v: 600, conv: 16.7 })
// 34) as 5 regras disparam com a leitura sintética do dia; números, causas e caminhos do Chaveiro conferidos; Full fora do diagnóstico entra pelo item mínimo
{
  const C = '__saude_ok__'
  gravarSaude(C, { claims: [{ id: 'c1', item_id: 'MLB10', estagio: 'dispute' }, { id: 'c2', item_id: null, prazo: PRAZO_CURTO }, { id: 'c3', item_id: 'MLB10', prazo: '2030-01-01T00:00:00.000Z' }],
    perguntas: [{ id: 'q1', item_id: 'MLB10', em: ANTIGA }, { id: 'q2', item_id: 'MLB10', em: ANTIGA }, { id: 'q3', item_id: 'MLB10', em: new Date().toISOString() }],
    atrasos: [{ order: 'o1', item_id: 'MLB10', dias: 2 }, { order: 'o2', item_id: 'MLB10', dias: 1 }],
    full: [{ item_id: 'MLB700', disponivel: 30, dias_sem_venda: 75 }, { item_id: 'MLB701', disponivel: 0, dias_sem_venda: 90 }, { item_id: 'MLB702', disponivel: 5, dias_sem_venda: 20 }], itens: [{ id: 'MLB700' }, { id: 'MLB701' }, { id: 'MLB702' }] })
  const a = daS(C, [BOM()])
  for (const r of REG_S) assert.ok(a.some(x => x.regra === 'anuncio_' + r), 'dispara: ' + r)
  const rep = a.find(x => x.regra === 'anuncio_reputacao_em_risco')
  assert.equal(rep.item_id, ''); assert.equal(rep.dados.entidade.tipo, 'conta'); assert.deepEqual(rep.dados.causas_possiveis.map(c => c.causa), ['nivel_fora_do_verde', 'reclamacoes'], 'amarelo + reclamações 1,8% ≥ 80% de 2%; atrasos 3% < 12% e cancelamentos 0,5% < 1,6% ficam fora')
  assert.match(rep.dados.problema, /nível amarelo/); assert.doesNotMatch(JSON.stringify(rep.dados), /3_yellow/, 'enum do ML traduzido'); assert.equal(rep.previsao.tipo, 'risco_evitado'); assert.equal(rep.previsao.cenarios.base.receita, 500, 'GMV 5.000 × 10%'); assert.ok(rep.previsao.premissas.some(p => /premissa/.test(p)))
  assert.equal(rep.dados.execucao.caminho, 'assistido'); assert.equal(rep.dados.execucao.adaptador, 'notion'); assert.equal(rep.horizonte, '7d'); assert.equal(rep.dados.sequencia, ordemDoTipo('saude'))
  const env = a.find(x => x.regra === 'anuncio_envio_atrasado')
  assert.equal(env.dados.urgencia, 5); assert.equal(env.horizonte, '72h'); assert.match(env.titulo, /^Despachar hoje 2 pedido\(s\)/); assert.equal(env.previsao.cenarios.base.receita, 30, '2 × ticket 50 × 30%'); assert.match(env.dados.evidencia, /MLB10: 2 dia\(s\) de atraso; MLB10: 1 dia\(s\) de atraso/); assert.doesNotMatch(env.dados.evidencia, /\bo1\b/, 'id do pedido não vai ao texto')
  assert.equal(env.dados.execucao.caminho, 'cliente'); assert.equal(env.dados.execucao.adaptador, 'pendencia'); assert.equal(env.dados.dependencia, 'Retorno do cliente'); assert.match(env.dados.parada, /leitura de saúde seguinte/)
  const recl = a.filter(x => x.regra === 'anuncio_reclamacao_sem_resposta')
  assert.equal(recl.length, 2, 'uma por anúncio (mediação em MLB10) + uma de conta (prazo curto sem anúncio); a de prazo longo fica fora')
  const rItem = recl.find(x => x.item_id === 'MLB10'), rConta = recl.find(x => !x.item_id)
  assert.equal(rItem.dados.urgencia, 5); assert.deepEqual(rItem.dados.causas_possiveis.map(c => c.causa), ['mediacao']); assert.equal(rItem.previsao.cenarios.base.receita, 30, '1 × preço 50 × 60%')
  assert.equal(rConta.dados.urgencia, 4); assert.deepEqual(rConta.dados.causas_possiveis.map(c => c.causa), ['prazo_curto']); assert.equal(rConta.dados.entidade.tipo, 'conta'); assert.ok(recl.every(x => x.dados.execucao.caminho === 'cliente'))
  const per = a.find(x => x.regra === 'anuncio_pergunta_sem_resposta')
  assert.match(per.titulo, /^Responder 2 pergunta\(s\) sem resposta há mais de 24 h$/); assert.match(per.dados.evidencia, /por anúncio: MLB10: 2/); assert.equal(per.previsao.tipo, 'ganho'); assert.equal(per.previsao.cenarios.base.unidades, 0.2, '2 × 10%'); assert.equal(per.dados.execucao.caminho, 'cliente')
  const full = a.filter(x => x.regra === 'anuncio_full_estoque_antigo')
  assert.deepEqual(full.map(x => x.item_id), ['MLB700'], 'disponível 0 e 20 dias ficam fora; MLB700 não está em diag.itens e entra pelo meli_item')
  const f = full[0]; assert.equal(f.dados.evidencia_tipo, 'hipotese', 'idade estimada pela série = hipótese'); assert.match(f.dados.evidencia, /fonte: estimativa pela série de vendas \(endpoint de idade do Full não verificado\)/); assert.match(f.titulo, /há 75\+ dias/)
  assert.deepEqual(f.dados.causas_possiveis.map(c => c.causa), ['retirada_do_full'], 'sem custos: decisão do cliente'); assert.equal(f.dados.execucao.caminho, 'cliente'); assert.equal(f.dados.executar_via, 'notion'); assert.equal(f.dados.dependencia, 'Custos do cliente (margem)'); assert.equal(f.dados.demanda_notion, 'Planejamento full')
  assert.equal(f.previsao.cenarios.base.unidades, 7.5, '30 × 25%'); assert.equal(f.dados.item.curva, 'C'); assert.match(f.dados.meta, /≤ 23 un/)
  for (const x of a) assert.ok(CAM_S.includes(x.dados.execucao.caminho), x.regra)
}
// 35) com custos informados o Full vira promoção de giro (caminho automático · promocoes) e depende de margem_negativa do MESMO anúncio; sem desconto que preserve a margem, continua retirada
{
  const C = '__saude_full__'
  gravarSaude(C, { linha: { level_id: '5_green', taxa_claims: 0.5, atrasos: 0, claims_abertas: 0, mediacoes: 0, perguntas_24h: 0 }, full: [{ item_id: 'MLB710', disponivel: 40, idade_dias: 70, dias_sem_venda: 10 }] })
  const CC = { cmv_pct: 40, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const a = daS(C, [BOM(), item({ id: 'MLB710', r: 0, u: 0, v: 400, conv: 0, preco: 100 })], { custos_informados: true, custos: CC })
  const f = a.find(x => x.regra === 'anuncio_full_estoque_antigo'); assert.ok(f, 'idade_dias do Full (sem estimativa) dispara')
  assert.equal(f.dados.evidencia_tipo, 'fato'); assert.match(f.dados.evidencia, /idade do estoque 70 dia\(s\) \(leitura do Full\)/); assert.deepEqual(f.dados.causas_possiveis.map(c => c.causa), ['giro_com_promocao'])
  assert.equal(f.dados.execucao.caminho, 'automatico'); assert.equal(f.dados.execucao.adaptador, 'promocoes'); assert.equal(f.dados.executar_via, 'promocoes'); assert.equal(f.dados.demanda_notion, 'Campanhas de Desconto'); assert.equal(f.dados.dependencia, '—')
  assert.ok(f.previsao.cenarios.base.receita < 40 * 0.25 * 100, 'receita no preço com desconto'); assert.deepEqual(f.dados.depende_de, [], 'sem margem negativa no anúncio, nada a esperar')
  assert.ok(!a.some(x => REG_S.slice(0, 4).map(r => 'anuncio_' + r).includes(x.regra)), 'conta saudável: nenhuma das 4 regras de conta')
  const NEG = { cmv_pct: 90, imposto_pct: 6, comissao_pct: 16, frete_pct: 0, embalagem_pct: 0, outros_pct: 0, margem_desejada_pct: 10 }
  const b = daS(C, [BOM(), item({ id: 'MLB710', r: 0, u: 0, v: 400, conv: 0, preco: 100 })], { custos_informados: true, custos: NEG })
  const neg = b.find(x => x.regra === 'anuncio_margem_negativa' && x.item_id === 'MLB710'), f2 = b.find(x => x.regra === 'anuncio_full_estoque_antigo')
  // trava de 12/10 (de propósito): o fixture vendia 30 un em 28 dias com o estoque «parado» — contradição. Parado agora é sem venda em 28 dias, e margem negativa sem
  // venda não tem perda a estancar (não vira ação): o Full não espera nada; quando a margem negativa existir no mesmo anúncio, o Full continua esperando por ela
  assert.ok(f2); assert.deepEqual(f2.dados.causas_possiveis.map(c => c.causa), ['retirada_do_full']); assert.match(f2.dados.causas_possiveis[0].sinal, /sem desconto que preserve a margem/)
  if (neg) { assert.deepEqual(f2.dados.depende_de, [neg.id]); assert.ok(f2.prazo >= addD(neg.prazo, 2), 'Full espera a margem') } else assert.deepEqual(f2.dados.depende_de, [])
  // vendeu nos últimos 28 dias: nunca «parado no Full», nem com a idade do estoque acima do limiar
  assert.ok(!daS(C, [BOM(), item({ id: 'MLB710', r: 3000, u: 30, v: 400, conv: 7.5, preco: 100 })], { custos_informados: true, custos: CC }).some(x => x.regra === 'anuncio_full_estoque_antigo'), 'vendeu em 28 dias não é parado')
}
// 36) sem linha do dia nenhuma das 5 nasce; leitura velha (3 dias) idem; bloco PENDENTE (403 nas perguntas, endpoint não verificado nos atrasos, API indisponível) não vira regra —
//     e um bloco pendente não cala os outros; amostra mínima da reputação: taxa só conta com vendas_periodo ≥ 10; nível verde com taxas baixas não nasce
{
  assert.ok(!daS('__sem_saude__', [BOM()]).some(x => REG_S.map(r => 'anuncio_' + r).includes(x.regra)), 'sem linha: nada')
  gravarSaude('__saude_velha__', { dia: addD(HOJE, -3), atrasos: [{ order: 'v1', item_id: 'MLB10', dias: 1 }], full: [{ item_id: 'MLB720', disponivel: 9, dias_sem_venda: 99 }], itens: [{ id: 'MLB720' }] })
  assert.ok(!daS('__saude_velha__', [BOM()]).some(x => REG_S.map(r => 'anuncio_' + r).includes(x.regra)), 'leitura de 3 dias atrás não vale')
  gravarSaude('__saude_pend__', { linha: { perguntas_abertas: null, perguntas_24h: null, atrasos: null, claims_abertas: null, mediacoes: null, level_id: null, taxa_claims: null, taxa_atraso: null, taxa_cancel: null, vendas_periodo: null },
    pendente: { perguntas: 'permissao_do_app', atrasos: 'endpoint_nao_verificado', reclamacoes: 'indisponivel', reputacao: 'indisponivel', full: 'indisponivel' },
    atrasos: [{ order: 'p1', item_id: 'MLB10', dias: 4 }], perguntas: [{ id: 'pq1', item_id: 'MLB10', em: ANTIGA }], claims: [{ id: 'pc1', item_id: 'MLB10', estagio: 'dispute' }], full: [{ item_id: 'MLB730', disponivel: 9, dias_sem_venda: 99 }], itens: [{ id: 'MLB730' }] })
  assert.ok(!daS('__saude_pend__', [BOM()]).some(x => REG_S.map(r => 'anuncio_' + r).includes(x.regra)), 'tudo pendente: nada nasce, mesmo com listas gravadas')
  gravarSaude('__saude_parcial__', { linha: { perguntas_abertas: null, perguntas_24h: null, level_id: '5_green', taxa_claims: 0.2, taxa_atraso: 1, taxa_cancel: 0, claims_abertas: 0, mediacoes: 0, atrasos: 1 }, pendente: { perguntas: 'permissao_do_app' }, perguntas: [{ id: 'xq1', item_id: 'MLB10', em: ANTIGA }], atrasos: [{ order: 'x1', item_id: 'MLB10', dias: 1 }] })
  const parcial = daS('__saude_parcial__', [BOM()]).map(x => x.regra)
  assert.ok(!parcial.includes('anuncio_pergunta_sem_resposta') && parcial.includes('anuncio_envio_atrasado') && !parcial.includes('anuncio_reputacao_em_risco'), '403 só nas perguntas: atraso dispara, pergunta não, verde com taxas baixas não')
  gravarSaude('__saude_amostra__', { linha: { level_id: '5_green', taxa_claims: 1.9, taxa_atraso: 1, taxa_cancel: 0, vendas_periodo: 5, atrasos: 0, claims_abertas: 0, mediacoes: 0, perguntas_24h: 0 } })
  assert.ok(!daS('__saude_amostra__', [BOM()]).some(x => x.regra === 'anuncio_reputacao_em_risco'), '5 vendas: taxa de 1,9% não é avaliada (amostra mínima 10)')
  gravarSaude('__saude_taxa__', { linha: { level_id: '5_green', taxa_claims: 1.9, taxa_atraso: 1, taxa_cancel: 0, vendas_periodo: 50, atrasos: 0, claims_abertas: 0, mediacoes: 0, perguntas_24h: 0 } })
  const t = daS('__saude_taxa__', [BOM()]).find(x => x.regra === 'anuncio_reputacao_em_risco'); assert.ok(t, '50 vendas: 1,9% ≥ 80% de 2% dispara mesmo no verde'); assert.deepEqual(t.dados.causas_possiveis.map(c => c.causa), ['reclamacoes']); assert.match(t.titulo, /^Reputação em risco: taxa perto do limite/)
}
// 37) declarações v1.5.0: as 5 regras existem no Algoritmo com dados/kpi/prova/tipo_demanda, prior como premissa e teto; limiares novos rotulados em premissas; mantidas em catálogo; caminho no Chaveiro
{
  assert.equal(algoritmo.versao, '1.6.0')
  const { CFG: CHAV } = await import('../src/lib/chaveiro.js')
  for (const id of REG_S) {
    const r = algoritmo.regras.find(x => x.id === id); assert.ok(r && r.dados.length && r.kpi && r.tipo_demanda && r.justificativa && r.prova?.metrica && r.prova?.janela_dias && r.adicionada_em === '2026-10-09', 'regra declarada: ' + id)
    assert.ok(algoritmo.priors_efeito[id]?.p_sucesso > 0 && algoritmo.priors_efeito[id].premissa === true && algoritmo.priors_efeito[id].fonte, 'prior como premissa: ' + id)
    assert.ok(algoritmo.foco.max_por_regra[id] >= 1, 'teto por regra: ' + id); assert.ok(algoritmo.catalogo.regras.mantidas.includes(id), 'mantida em catálogo: ' + id); assert.ok(CHAV.caminho_por_regra[id], 'caminho declarado: ' + id)
    assert.ok(algoritmo.metricas_prova[r.prova.metrica], 'métrica de prova rotulada: ' + id)
  }
  for (const k of ['reputacao_claims_max_pct', 'reputacao_atraso_max_pct', 'reputacao_cancel_max_pct', 'reputacao_fracao_alerta', 'reputacao_min_vendas', 'claim_prazo_horas', 'full_estoque_antigo_dias']) assert.ok(algoritmo.premissas.limiares.includes(k) && typeof algoritmo.limiares[k] === 'number', 'limiar rotulado como premissa: ' + k)
  assert.equal(typeof algoritmo.limiares.perguntas_min_24h, 'number'); assert.deepEqual(algoritmo.dependencias.full_estoque_antigo, ['margem_negativa'])
  assert.deepEqual(Object.keys(CHAV.caminho_por_regra.full_estoque_antigo.operacao_por_causa), ['giro_com_promocao', 'retirada_do_full'])
}
console.log('✔ plano-anuncios v1.5.0: saúde da conta gravada — reputação em risco (nível/taxa com amostra), envio atrasado, reclamação sem resposta (mediação/prazo, por anúncio ou conta), pergunta sem resposta (403 não nasce), Full com estoque antigo (estimativa declarada, promoção × retirada, depende de margem); sem linha/pendente/leitura velha nada nasce')

// 38) ALINHAMENTOS com o cliente (10/10/2026, src/lib/alinhamentos.js): anúncio pausado de propósito (pausa_producao) ou boi de piranha → anuncio_restrito não nasce e conta
//     em omitidas.alinhado; ja_informado não tira a regra (só silencia aviso); ação DESCARTADA no banco sai antes do teto/fila (posições renumeradas, omitidas.descartada)
{
  const { db } = await import('../src/lib/db.js')
  const C = '__alinhado__'
  const pausado = () => diagDe([item({ id: 'MLB461', r: 5000, u: 100, v: 600, conv: 16.7 }), item({ id: 'MLB460', status: 'paused', r: 0, u: 0, r0: 3000, u0: 60, v: null, v0: null, visOk: false, conv: null })])
  const al = (chave, tipo, estado = 'vivo') => db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, tipo, por, origem, desde, revisar_em, estado, criado_em) VALUES (?, 'anuncio', ?, ?, 'Consultor', 'painel', '2026-10-01', '2026-11-01', ?, '2026-10-01')").run(C, chave, tipo, estado)
  const restrito = () => montarAcoes(C, pausado(), { hoje: HOJE })
  const tem = l => l.some(x => x.regra === 'anuncio_anuncio_restrito' && x.item_id === 'MLB460')
  assert.ok(tem(restrito()), 'sem alinhamento: o pausado que vendia vira ação')
  al('MLB460', 'ja_informado'); assert.ok(tem(restrito()), 'ja_informado: a regra continua')
  al('MLB460', 'pausa_producao')
  const r = restrito(); assert.ok(!tem(r), 'pausa de produção alinhada: não nasce'); assert.equal(r.omitidas.alinhado, 1)
  db.prepare('DELETE FROM alinhamento WHERE cliente = ?').run(C); al('MLB460', 'boi_de_piranha'); assert.ok(!tem(restrito()), 'boi de piranha: não nasce')
  db.prepare('DELETE FROM alinhamento WHERE cliente = ?').run(C); al('MLB460', 'pausa_producao', 'encerrado'); assert.ok(tem(restrito()), 'encerrado não vale')
  // descartada não ocupa vaga: some da lista, conta em omitidas.descartada e as posições seguem 1..n
  const camp = id => item({ id, r: 9000, u: 120, estoque: 6, cobertura: 1, vel_dia: 4.3 })
  const d = () => diagDe(['MLB471', 'MLB472', 'MLB473', 'MLB474', 'MLB475', 'MLB476'].map(camp))
  const a0 = montarAcoes(C, d(), { hoje: HOJE }), top = a0[0]
  db.prepare("INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, score, dados_json, status, item_id, criado_em, atualizado_em) VALUES (?, ?, 'Mercado Livre', ?, '2026-10', 't', '72h', ?, 1, '{}', 'descartada', ?, 'x', 'x')").run(top.id, C, top.regra, HOJE, top.item_id)
  const a1 = montarAcoes(C, d(), { hoje: HOJE })
  assert.ok(!a1.some(x => x.id === top.id)); assert.equal(a1.omitidas.descartada, 1); assert.equal(a1.length, a0.length - 1)
  assert.equal(a1.filter(x => x.dados.fila === 'esta_semana').length, Math.min(5, a1.length)); assert.deepEqual(a1.map(x => x.dados.posicao), a1.map((_, k) => k + 1))
  db.prepare('DELETE FROM alinhamento WHERE cliente = ?').run(C); db.prepare('DELETE FROM acoes_plano WHERE cliente = ?').run(C)
}
console.log('✔ plano-anuncios: alinhamentos — pausa de produção/boi de piranha alinhados não geram anúncio restrito (omitidas.alinhado), ja_informado mantém a regra, encerrado não vale; descartada sai antes do teto/fila')

// 36) V3 F4 — financeiro MEDIDO nos pedidos nas regras SÓ com financeiro.margem_medida_nas_regras (nasce false). Desligada: plano IDÊNTICO com ou sem o financeiro no
//     diagnóstico. Ligada: margem_negativa pela margem medida (fato, só com cobertura ≥ 0,8 — o agregado já devolve margem null abaixo), ads_reduzir pelo ROAS de equilíbrio
//     medido, promocao_giro pelo desconto máximo medido (sem custos da conta) e cadastrar_custos com o Pareto dos anúncios sem custo.
{
  assert.equal(algoritmo.financeiro.margem_medida_nas_regras, false, 'a chave nasce desligada')
  const fin = (o = {}) => ({ receita_c: 200000, receita_total_c: 200000, cobertura: 0.9, cobertura_taxas_frete: 0.95, cobertura_custo: 0.9, margem_pct: -8, lucro_c: -14400, antes_do_imposto: true,
    completas: { receita_c: 180000, reembolso_c: 0, tarifa_c: 21600, frete_c: 14400, custo_c: 158400, lucro_c: -14400 }, motivo: '', ...o })
  const eco = o => ({ t_pct: 12, frete_unit: 8, cruza_faixa_frete: false, desconto_max_pct: 0, roas_equilibrio: null, ...o })
  const itens = () => [
    item({ id: 'MLB900', r: 2000, u: 40, preco: 50, custo_unitario: 39.6, custo_origem: 'sku', financeiro: fin(), economia_real: eco({ margem_pct: -8 }) }),
    item({ id: 'MLB901', r: 5000, u: 100, preco: 50, custo_unitario: 20, custo_origem: 'sku', ads: { prints: 5000, clicks: 100, custo: 500, receita: 900, unidades: 18, ctr: 2, roas: 1.8, acos: 55.6 },
      financeiro: fin({ margem_pct: 25, lucro_c: 45000 }), economia_real: eco({ margem_pct: 25, roas_equilibrio: 4, desconto_max_pct: 30 }) }),
    item({ id: 'MLB902', r: 3000, u: 60, preco: 50, estoque: 500, cobertura: 233, vel_dia: 2.1, custo_unitario: 15, custo_origem: 'sku', financeiro: fin({ margem_pct: 40, lucro_c: 72000 }), economia_real: eco({ margem_pct: 40, roas_equilibrio: 2.5, desconto_max_pct: 35 }) }),
    item({ id: 'MLB903', r: 9000, u: 90, preco: 100 }), item({ id: 'MLB904', r: 1000, u: 10, preco: 100 }),
  ]
  const sem = l => l.map(({ financeiro, economia_real, ...x }) => x)
  const extra = { financeiro: { minimo: 0.8, conta: { cobertura_taxas_frete: 0.95, cobertura_custo: 0.5 } } }
  const resumo = a => a.map(x => JSON.stringify([x.id, x.regra, x.titulo, x.score, x.dados, x.previsao]))
  const off = montarAcoes('__teste__', diagDe(itens(), extra), { hoje: HOJE }), base = montarAcoes('__teste__', diagDe(sem(itens())), { hoje: HOJE })
  assert.deepEqual(resumo(off), resumo(base), 'chave desligada: plano IDÊNTICO com ou sem o financeiro medido no diagnóstico')
  assert.ok(!off.some(x => ['anuncio_margem_negativa', 'anuncio_promocao_giro', 'anuncio_cadastrar_custos', 'conta_cadastrar_custos'].includes(x.regra)))
  algoritmo.financeiro.margem_medida_nas_regras = true
  try {
    const on = montarAcoes('__teste__', diagDe(itens(), extra), { hoje: HOJE }), de = (r, id) => on.find(x => x.regra.endsWith(r) && (id == null || x.item_id === id))
    const m = de('margem_negativa', 'MLB900')
    assert.ok(m, 'margem medida −8% com cobertura 90%: nasce sem custos da conta'); assert.match(m.dados.problema, /medida nos pedidos -8%/)
    assert.match(m.dados.evidencia, /90% da receita\): receita R\$ 1\.800,00 − tarifas do ML R\$ 216,00 − frete R\$ 144,00 − custo R\$ 1\.584,00 = R\$ -144,00/)
    assert.ok(!JSON.stringify(m.dados).includes('NOT_COLLECTED'), 'comissão e frete do pedido já são medidos'); assert.equal(m.dados.causas_possiveis[0].causa, 'preco_abaixo_do_custo')
    const r = de('ads_reduzir', 'MLB901'); assert.ok(r, 'ROAS 1,8 abaixo do equilíbrio MEDIDO 4'); assert.match(r.dados.problema, /ROAS de equilíbrio 4 medido nos pedidos/)
    const g = de('promocao_giro', 'MLB902'); assert.ok(g, 'sem custos da conta, o desconto máximo medido libera a promoção de giro'); assert.match(g.dados.evidencia, /35% \(MEDIDO: tarifa observada 12%, frete R\$ 8,00\/un/)
    const c = de('cadastrar_custos'); assert.ok(c, 'custo em 50% da receita com tarifa e frete medidos: pede o custo que falta'); assert.match(c.dados.problema, /Tarifas e frete já medimos; falta o custo de cada produto: 50%/)
    assert.match(c.dados.como[0], /MLB903/); assert.doesNotMatch(c.dados.como[0], /MLB904/, 'Pareto: só os que somam 80% da receita sem custo')
    // cobertura < 0,8: o agregado devolve margem null → não há margem medida, e sem custos da conta nada se afirma
    const baixa = montarAcoes('__teste__', diagDe([item({ id: 'MLB905', r: 2000, u: 40, preco: 50, financeiro: fin({ cobertura: 0.5, margem_pct: null, lucro_c: null, completas: null }) })]), { hoje: HOJE })
    assert.ok(!baixa.some(x => x.regra === 'anuncio_margem_negativa'), 'cobertura 50%: margem «parcial», nunca fato')
    // revisão F4: imposto informado (10%) com margem antes do imposto de 8% → depois do imposto −2%: margem_negativa NASCE e o texto diz «depois do imposto»
    const comImp = fin({ margem_pct: 8, lucro_c: 14400, margem_depois_imposto_pct: -2, lucro_depois_imposto_c: -3600, antes_do_imposto: false,
      completas: { receita_c: 180000, reembolso_c: 0, tarifa_c: 21600, frete_c: 14400, custo_c: 129600, lucro_c: 14400, imposto_c: 18000 } })
    const imp = montarAcoes('__teste__', diagDe([item({ id: 'MLB906', r: 2000, u: 40, preco: 50, custo_unitario: 32.4, custo_origem: 'sku', financeiro: comImp })]), { hoje: HOJE }).find(x => x.regra === 'anuncio_margem_negativa')
    assert.ok(imp, 'margem −2% depois do imposto informado: nasce (antes ficava em 8% e não nascia)')
    assert.match(imp.dados.evidencia, /− imposto informado R\$ 180,00 = R\$ -36,00 \(margem medida -2%, depois do imposto\)/); assert.match(imp.dados.hipotese, /depois do imposto informado/)
    assert.doesNotMatch(imp.dados.evidencia, /antes do imposto/)
    // revisão F4: cobertura de taxas+frete exibida 0,8 por arredondamento, mas abaixo do mínimo (ok_taxas_frete falso): cadastrar_custos NÃO diz «já medimos»
    const quase = montarAcoes('__teste__', diagDe(itens(), { financeiro: { minimo: 0.8, conta: { cobertura_taxas_frete: 0.8, ok_taxas_frete: false, cobertura_custo: 0.5, ok_custo: false } } }), { hoje: HOJE })
    assert.ok(!quase.some(x => x.regra.endsWith('cadastrar_custos') && /já medimos/.test(x.dados.problema)))
  } finally { algoritmo.financeiro.margem_medida_nas_regras = false }
}
console.log('✔ plano-anuncios: V3 F4 — chave desligada = plano idêntico; ligada = margem medida (fato só com cobertura ≥ 0,8), ROAS de equilíbrio e desconto máximo medidos, Pareto dos custos que faltam')
