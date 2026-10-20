process.env.PS_PROMO_MEMORIA = '1'                       // ANTES de qualquer import: o módulo lê isto no carregamento (nunca toca data/db.sqlite)
// Regressão da frente ANALISTA (promocoes-analista.js): um caso por achado confirmado da revisão adversarial. Sintético, sem rede, banco em memória.
// Rodar: node scripts/teste-promocoes-analista.mjs
import assert from 'node:assert/strict'
const R = await import('../src/lib/promocoes-db.js')
const A = await import('../src/lib/promocoes-analista.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }

const HOJE = '2026-10-05'
const of = (item_id, pid, o = {}) => ({ item_id, pid, offer_id: `OFFER-${item_id}-${pid}`, tipo: 'SMART', subtipo: '', nome: `Camp ${pid}`, status: 'candidate', preco: 100, preco_original: 120, meli_pct: 5, seller_pct: 0, inicio: '', fim: '2026-12-31T23:59:59', min_preco: null, max_preco: null, sugerido: null, fonte: 'item', ...o })
const an = (item_id, o = {}) => ({ item_id, sku: `${item_id}-SKU`, sku_fonte: 'teste', titulo: `Anúncio ${item_id}`, permalink: '', status: 'active', sub_status: '', under_review: false, preco: 100, preco_original: 120, estoque: 10, categoria: 'MLB1', tipo_anuncio: 'gold_special', catalogo: false, user_product_id: '', curva: 'A', fat30: 1000, unid30: 10, protegido: false, lido_em: '2026-10-05T10:00:00Z', oferta_erro: '', tarifa: { comissao_pct: 15, taxa_fixa: 0, frete: 10 }, tarifa_json: '', tarifa_estado: '', ...o })
const CFG = { piso_mc: 20, piso_relampago: 19, imposto_pct: 10, dias_vigia: 7, janela_cobertura_dias: 3, hedge_cobertura: 1, execucao_habilitada: 0, execucao_max_itens: 1 }
// comissão 15% + frete 10 + imposto 10%, preço 100, original 120, rebate 5% (=6): MC = 71 − custo
const custosDe = mapa => new Map(Object.entries(mapa).map(([k, v]) => [k.toLowerCase(), v]))
const rodar = (anuncios, ofertas, extra = {}) => A.analisar({
  hoje: HOJE, config: { ...CFG, ...(extra.config || {}) }, anuncios, campanhas: extra.campanhas || [], ofertasPorItem: R.agruparPorItem(ofertas),
  regrasSku: extra.regras || [], aprendizados: extra.aprendizados || [], custosSku: extra.custos || new Map(), custosCliente: null, recusas: extra.recusas || null,
})
const marcas = res => res.recomendacoes.map(r => `${r.item_id}:${r.pid}:${r.regra}`)
const MANUAL_ATE_07 = id => of(id, 'MAN', { tipo: 'PRICE_DISCOUNT', nome: 'Manual', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-07' })
const coletaSint = (cliente, anuncios, ofertas, campanhas = []) => {
  const id = 'T' + Math.random().toString(36).slice(2, 7)
  R.iniciarColeta(cliente, id)
  R.gravarColeta(cliente, { coletaId: id, campanhas: campanhas.map(c => ({ tipo: '', subtipo: '', nome: '', status: '', inicio: '', fim: '', prazo: '', rebate: 0, relampago: 0, origem: 'listagem', ...c })),
    anuncios: anuncios.map(a => ({ ...a, under_review: a.under_review ? 1 : 0, catalogo: 0, tarifa_json: JSON.stringify(a.tarifa), tarifa_estado: '' })), ofertasPorItem: R.agruparPorItem(ofertas), resumo: {}, limites: [] })
  return id
}
const preparar = (cliente, custos) => { R.setConfig(cliente, { imposto_pct: 10 }); R.importarCustosSku(cliente, Object.entries(custos).map(([sku, custo]) => ({ sku, custo })), 'teste') }

// ═══ [0] invariante verde sem o analista ter rodado sobre a coleta atual ═══════════════════════════════════════════
await okA('[0] decisão velha não fecha a rodada: nova coleta sem re-rodar o analista => vermelho com motivo explícito', async () => {
  const C = 'Cli Invariante', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'X0-SKU': 60 })                                            // MC 11% < piso => SEM_MARCA "abaixo do piso"
  coletaSint(C, [an('X0')], [of('X0', 'C1', { inicio: '2026-10-01' })])
  const r1 = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.equal(r1.invariante.ok, true, JSON.stringify(r1.invariante.itens)); assert.equal(r1.invariante.analista_rodou_na_coleta, true)
  coletaSint(C, [an('X0')], [of('X0', 'C1', { inicio: '2026-10-01', meli_pct: 25 })])           // coleta nova FRESCA: o ML liberou rebate 25% (MC 35%)
  const inv = await A.lerInvariante(C, deps)
  assert.equal(inv.ok, false, 'a decisão da coleta anterior não prova nada'); assert.equal(inv.analista_rodou_na_coleta, false)
  assert.equal(inv.itens.find(i => i.id === 'analista_fora_da_coleta').encontrado, 1); assert.match(inv.itens.find(i => i.id === 'analista_fora_da_coleta').rotulo, /analista não rodou sobre esta coleta/)
  assert.equal(inv.itens.find(i => i.id === 'elegiveis_sem_decisao').encontrado, 1, 'e a elegível nova segue sem decisão')
  const r2 = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.equal(r2.invariante.ok, true); assert.deepEqual(marcas({ recomendacoes: r2.recomendacoes }), ['X0:C1:R2'])
  // sem marcador (alguém apagou) => vermelho
  R.db.prepare("DELETE FROM promo_alerta WHERE cliente = ? AND tipo = 'rodada'").run(C)
  assert.equal((await A.lerInvariante(C, deps)).ok, false)
})
ok('[0] recusa humana de OUTRA campanha não decide a trilha inteira', () => {
  const res = rodar([an('X2')], [of('X2', 'C1', { inicio: '2026-10-01' }), of('X2', 'C2', { inicio: '2026-10-01', meli_pct: 4 })], { custos: custosDe({ 'X2-SKU': 45 }) })
  const dec = [{ item_id: 'X2', pid: 'C2', origem: 'humano', marcado: false, via: 'api' }]
  const { efetivas } = A.aplicarHumanos(res.recomendacoes, dec)
  assert.deepEqual(efetivas.map(r => r.pid), ['C1'])
  const rodada = { rodada_id: 'R', coleta_id: 'K' }
  const inv = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: dec, alertas: A.alertasDeVigias(res.vigias).map(a => ({ ...a, rodada_id: 'R' })), efetivas, coletaId: 'K', rodada })
  assert.equal(inv.itens[0].encontrado, 1, 'só a recusa de C2 não decide C1; falta a linha do analista')
  const comLinha = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: [...dec, ...efetivas.map(r => ({ ...r, origem: 'analista', marcado: true, rodada_id: 'R' }))], alertas: [], efetivas, coletaId: 'K', rodada })
  assert.equal(comLinha.itens[0].encontrado, 0)
  const outraRodada = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: efetivas.map(r => ({ ...r, origem: 'analista', marcado: true, rodada_id: 'ANTIGA' })), alertas: A.alertasDeVigias(res.vigias).map(a => ({ ...a, rodada_id: 'ANTIGA' })), efetivas, coletaId: 'K', rodada })
  assert.equal(outraRodada.itens[0].encontrado, 1, 'linha de OUTRA rodada não conta'); assert.equal(outraRodada.itens[1].encontrado, 2, 'alerta de outra rodada não conta (X2 está descoberto nas duas janelas)')
  const alertaVelho = A.invariante({ avaliacoes: res.avaliacoes, vigias: { ...res.vigias, rebatePior: [{ chave: 'Z|empate', item_id: 'Z' }] }, decisoes: [], alertas: [{ tipo: 'rebate_pior', chave: 'Z|empate', rodada_id: 'ANTIGA' }], efetivas: [], coletaId: 'K', rodada })
  assert.equal(alertaVelho.itens[2].encontrado, 1, 'alerta de outra rodada não conta')
  const preco = A.invariante({ avaliacoes: res.avaliacoes, vigias: res.vigias, decisoes: [{ ...efetivas[0], origem: 'analista', marcado: true, rodada_id: 'R', preco: 77 }], alertas: [], efetivas, coletaId: 'K', rodada })
  assert.equal(preco.itens[0].encontrado, 1, 'linha gravada com preço diferente do recálculo = rodada velha')
})
await okA('contrato (a): só aplica sobre coleta concluída; parcial/erro nunca', async () => {
  const C = 'Cli Contrato A', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'X0-SKU': 45 })
  coletaSint(C, [an('X0')], [of('X0', 'C1', { inicio: '2026-10-01' })])
  for (const estado of ['parcial', 'erro', 'rodando']) {
    R.db.prepare('UPDATE promo_coleta SET estado = ? WHERE cliente = ?').run(estado, C)
    await assert.rejects(A.rodarAnalista(C, { aplicar: true, deps }), new RegExp(estado))
    const seco = await A.rodarAnalista(C, { aplicar: false, deps })
    assert.equal(seco.invariante.ok, false, `coleta ${estado} nunca fecha`)
  }
  assert.equal(R.lerDecisoes(C).length, 0, 'nada foi gravado sobre coleta não concluída')
  R.db.prepare("UPDATE promo_coleta SET estado = 'concluida', concluida_em = '2026-01-01T00:00:00Z' WHERE cliente = ?").run(C)
  await assert.rejects(A.rodarAnalista(C, { aplicar: true, permitirColetaVelha: true, deps }), /foto velha/, 'concluída mas velha (>12h): nem com o antigo "permitir coleta velha"')
})

// ═══ [3] [7] PRICE_MATCHING não é saída de cobertura (regra de 14/09) ═══════════════════════════════════════════════
const PM = id => of(id, 'PM', { tipo: 'PRICE_MATCHING', nome: 'Saia na frente', inicio: '2026-10-01', fim: '2026-12-31' })
ok('[3] vigia: única elegível PRICE_MATCHING => SUGERIR MANUAL (nunca MARCAR); manual sugerida segue', () => {
  const res = rodar([an('P3')], [MANUAL_ATE_07('P3'), PM('P3')], { custos: custosDe({ 'P3-SKU': 45 }) })
  const al = res.vigias.cobertura.alertas
  assert.equal(al.length, 1); assert.equal(al[0].saida, 'SUGERIR MANUAL'); assert.equal(al[0].melhorCobre, null); assert.equal(al[0].marcaCobre, false)
  assert.match(al[0].manualNota, /PRICE_MATCHING[\s\S]*não cobre/); assert.ok(al[0].precoManual > 0)
})
ok('[3] hedge: PRICE_MATCHING de maior vigência não vira HEDGE', () => {
  const res = rodar([an('H3')], [of('H3', 'CURTA', { inicio: '2026-10-01', fim: '2026-10-07T23:59:59', meli_pct: 5 }), { ...PM('H3'), meli_pct: 4.9 }], { custos: custosDe({ 'H3-SKU': 45 }) })
  assert.deepEqual(marcas(res), ['H3:CURTA:R2'])
})
ok('[7] vigia: PRICE_MATCHING com fim 12/10 também não cobre (variante do achado)', () => {
  const res = rodar([an('P7')], [MANUAL_ATE_07('P7'), { ...PM('P7'), fim: '2026-10-12', meli_pct: 8 }], { custos: custosDe({ 'P7-SKU': 45 }) })
  assert.equal(res.vigias.cobertura.alertas[0].saida, 'SUGERIR MANUAL'); assert.equal(res.vigias.cobertura.alertas[0].marcaCobre, false)
  // e uma candidata que COBRE de verdade ainda resolve (a regra não virou "nunca MARCAR")
  const ok2 = rodar([an('P7')], [MANUAL_ATE_07('P7'), PM('P7'), of('P7', 'SM', { inicio: '2026-10-01', fim: '2026-12-31' })], { custos: custosDe({ 'P7-SKU': 45 }) })
  assert.equal(ok2.vigias.cobertura.alertas[0].saida, 'MARCAR'); assert.equal(ok2.vigias.cobertura.alertas[0].melhorCobre.pid, 'SM')
})

// ═══ [8] [23] início da candidata: sem lacuna ═══════════════════════════════════════════════════════════════════════
ok('[8] vigia e R1C: campanha que abre depois da lacuna não cobre; R1C só com candidata que continua a cobertura', () => {
  const futura = of('F8', 'FUT', { inicio: '2026-10-20', fim: '2026-11-30' })
  const res = rodar([an('F8')], [of('F8', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-06' }), futura], { custos: custosDe({ 'F8-SKU': 45 }) })
  const a = res.vigias.cobertura.alertas[0]
  assert.equal(a.saida, 'SUGERIR MANUAL'); assert.equal(a.abreDepois[0].inicio, '2026-10-20'); assert.match(a.manualNota, /abre DEPOIS da lacuna[\s\S]*2026-10-20/)
  // R1C: a atual (SMART, MC maior) vence HOJE; a candidata só abre em 20/10 => não marca (e o motivo avisa)
  const atual = of('R8', 'ATUAL', { status: 'started', meli_pct: 8, inicio: '2026-09-01', fim: '2026-10-05' })
  const r = rodar([an('R8')], [atual, of('R8', 'NOVA', { meli_pct: 5, inicio: '2026-10-20' })], { custos: custosDe({ 'R8-SKU': 45 }) })
  assert.equal(r.recomendacoes.length, 0); assert.match(r.avaliacoes.get('R8').motivoSemMarca.texto, /cobertura vence 2026-10-05/)
  const r2 = rodar([an('R8')], [atual, of('R8', 'NOVA', { meli_pct: 5, inicio: '2026-10-06' })], { custos: custosDe({ 'R8-SKU': 45 }) })
  assert.deepEqual(marcas(r2), ['R8:NOVA:R1C'])
})
ok('[23] vigia: início vem da campanha quando a oferta não traz data; sem nenhuma data não prova cobertura', () => {
  const camp = [{ pid: 'FUT', nome: 'Sazonal', inicio: '2026-10-15', fim: '2026-10-30', status: 'pending' }]
  const res = rodar([an('F23')], [MANUAL_ATE_07('F23'), of('F23', 'FUT', { fim: '' })], { custos: custosDe({ 'F23-SKU': 45 }), campanhas: camp })
  const a = res.vigias.cobertura.alertas[0]
  assert.equal(a.saida, 'SUGERIR MANUAL'); assert.deepEqual(a.abreDepois.map(c => c.inicio), ['2026-10-15']); assert.equal(a.melhorCobre, null)
  const semData = rodar([an('F23')], [MANUAL_ATE_07('F23'), of('F23', 'SD', { inicio: '' })], { custos: custosDe({ 'F23-SKU': 45 }) })
  assert.equal(semData.vigias.cobertura.alertas[0].saida, 'SUGERIR MANUAL'); assert.match(semData.vigias.cobertura.alertas[0].manualNota, /sem data de início/)
  const aberta = rodar([an('F23')], [MANUAL_ATE_07('F23'), of('F23', 'AB', { inicio: '' })], { custos: custosDe({ 'F23-SKU': 45 }), campanhas: [{ pid: 'AB', nome: 'Aberta', status: 'started', fim: '2026-12-31' }] })
  assert.equal(aberta.vigias.cobertura.alertas[0].saida, 'MARCAR', 'campanha iniciada (status started) abre hoje')
})

// ═══ [9] recusa 👤 / IGNORAR / Revisar valem também no vigia ════════════════════════════════════════════════════════
ok('[9] vigia: item em IGNORAR ou Revisar toda rodada nunca recebe MARCAR', () => {
  const ofs = id => [MANUAL_ATE_07(id), of(id, 'A', { inicio: '2026-10-01' })]
  const ign = rodar([an('Q9')], ofs('Q9'), { custos: custosDe({ 'Q9-SKU': 45 }), aprendizados: [{ ativo: true, acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'Q9', resposta: 'ignorar', em: '2026-09-04T00:00:00Z' }] })
  assert.equal(ign.vigias.cobertura.alertas[0].saida, 'SUGERIR MANUAL'); assert.match(ign.vigias.cobertura.alertas[0].manualNota, /IGNORAR\/Revisar/)
  const rev = rodar([an('Q9')], ofs('Q9'), { custos: custosDe({ 'Q9-SKU': 45 }), regras: [{ mlb: '', sku: 'Q9-SKU', status: 'Revisar toda rodada' }] })
  assert.equal(rev.vigias.cobertura.alertas[0].saida, 'SUGERIR MANUAL'); assert.equal(rev.vigias.cobertura.alertas[0].marcaCobre, false)
  const livre = rodar([an('Q9')], ofs('Q9'), { custos: custosDe({ 'Q9-SKU': 45 }) })
  assert.equal(livre.vigias.cobertura.alertas[0].saida, 'MARCAR', 'controle: sem recusa nem portão o vigia continua marcando')
})
await okA('[9] vigia (banco): campanha recusada pelo dono => SUGERIR MANUAL, e a nota diz por quê', async () => {
  const C = 'Cli Recusa', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'Q9-SKU': 45 })
  coletaSint(C, [an('Q9')], [MANUAL_ATE_07('Q9'), of('Q9', 'A', { inicio: '2026-10-01' })])
  R.definirProtegido(C, 'Q9', true, 'teste')
  assert.equal((await A.rodarAnalista(C, { aplicar: false, deps })).vigias.cobertura.alertas[0].saida, 'MARCAR')
  R.marcarHumano(C, { item_id: 'Q9', pid: 'A', marcado: false }, 'dono')
  const r = await A.rodarAnalista(C, { aplicar: false, deps })
  assert.equal(r.recomendacoes.length, 0)
  assert.equal(r.vigias.cobertura.alertas[0].saida, 'SUGERIR MANUAL'); assert.equal(r.vigias.cobertura.alertas[0].melhorCobre, null); assert.match(r.vigias.cobertura.alertas[0].manualNota, /recusada pelo dono/)
})

// ═══ [11] as duas janelas do vigia ══════════════════════════════════════════════════════════════════════════════════
await okA('[11] vigia roda 7 e 14 dias: ambos persistidos (janela na chave) e provados no invariante', async () => {
  const C = 'Cli Janelas', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'P11-SKU': 45 })
  coletaSint(C, [an('P11')], [of('P11', 'D', { tipo: 'DEAL', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-10-15' })])      // cobre só até D+10: fora dos 7d, dentro dos 14d
  R.definirProtegido(C, 'P11', true, 'teste')
  const res = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.deepEqual(res.vigias.coberturaJanelas.map(j => [j.dias, j.alertas.length]), [[7, 0], [14, 1]])
  assert.equal(res.vigias.cobertura.alertas.length, 0, 'a janela da tela segue sendo a configurada (7)')
  assert.deepEqual(R.lerAlertas(C, 'cobertura').map(a => a.chave), ['P11|14d']); assert.equal(R.lerAlertas(C, 'cobertura')[0].detalhe.janela_dias, 14)
  assert.equal(res.invariante.ok, true, JSON.stringify(res.invariante.itens)); assert.deepEqual(res.invariante.readback.janelas, [{ dias: 7, descobertos: 0 }, { dias: 14, descobertos: 1 }])
  R.db.prepare("DELETE FROM promo_alerta WHERE cliente = ? AND tipo = 'cobertura'").run(C)
  const inv = await A.lerInvariante(C, deps)
  assert.equal(inv.ok, false); assert.deepEqual(inv.itens.find(i => i.id === 'protegidos_sem_alerta').ids, ['P11 (14d)'], 'a janela de 14 dias tem prova própria')
  assert.deepEqual(A.janelasVigia({ dias_vigia: 10 }), [10, 14]); assert.deepEqual(A.janelasVigia({ dias_vigia: 30 }), [14, 30])
})

// ═══ [22] cobertura herdada da campanha-mãe é suspeita ══════════════════════════════════════════════════════════════
ok('[22] vigia: cobertura só da campanha-mãe a mais de 60 dias => alerta "CONFIRMAR COBERTURA", nunca coberto', () => {
  const imp = of('S22', 'IMP', { status: 'started', nome: 'Impulsione', fim: '', inicio: '', meli_pct: 3 })
  const res = rodar([an('S22')], [imp], { campanhas: [{ pid: 'IMP', nome: 'Impulsione', fim: '2027-02-20', status: 'started' }], custos: custosDe({ 'S22-SKU': 45 }) })
  const a = res.vigias.cobertura.alertas
  assert.equal(a.length, 1); assert.equal(a[0].incerta, true); assert.equal(a[0].saida, 'CONFIRMAR COBERTURA'); assert.equal(a[0].suspeita, true); assert.equal(a[0].precoManual, null)
  assert.match(a[0].manualNota, /campanha-mãe[\s\S]*\/items\/S22\/prices/); assert.equal(res.resumo.cobertura_incerta, 1); assert.equal(res.resumo.descobertos, 0)
  assert.equal(res.vigias.coberturaJanelas.every(j => j.alertas.length === 1), true, 'vale nas duas janelas')
  // controle: data EXPLÍCITA da oferta (ex.: manual de 90 dias) é legítima — sem alerta
  const manual = rodar([an('S22')], [of('S22', 'MAN', { tipo: 'PRICE_DISCOUNT', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2027-01-15' })], { custos: custosDe({ 'S22-SKU': 45 }) })
  assert.equal(manual.vigias.cobertura.alertas.length, 0)
})

// ═══ [24] [35] R1C pela cobertura contínua ══════════════════════════════════════════════════════════════════════════
ok('[24] R1C: PRICE_MATCHING (fim da campanha-mãe) não mascara o fim da SMART que sustenta o preço', () => {
  const smart = of('R24', 'SM', { status: 'started', preco: 90, meli_pct: 8, inicio: '2026-09-01', fim: '2026-10-07' })
  const pmOn = of('R24', 'PM', { tipo: 'PRICE_MATCHING', nome: 'Saia na frente', status: 'started', preco: 100, meli_pct: 8, inicio: '2026-09-01', fim: '' })
  const nova = of('R24', 'NOVA', { meli_pct: 3, inicio: '2026-10-01' })                                                         // MC 23,6% < atual 29,6% (PM), ≥ piso
  const res = rodar([an('R24')], [smart, pmOn, nova], { campanhas: [{ pid: 'PM', nome: 'Saia na frente', fim: '2027-02-20', status: 'started' }], custos: custosDe({ 'R24-SKU': 45 }) })
  assert.deepEqual(marcas(res), ['R24:NOVA:R1C']); assert.match(res.recomendacoes[0].motivo, /vence em 2026-10-07/)
})
ok('[35] R1C: cobertura contínua por manual/DEAL derruba o gatilho (migração desnecessária)', () => {
  const smart = of('R35', 'SM', { status: 'started', meli_pct: 12, inicio: '2026-09-01', fim: '2026-10-05' })                    // MC 34,4%: vence HOJE
  const manual = of('R35', 'MAN', { tipo: 'PRICE_DISCOUNT', meli_pct: 0, status: 'started', inicio: '2026-10-01', fim: '2026-11-04' })
  const res = rodar([an('R35')], [smart, manual, of('R35', 'FUT', { meli_pct: 5, inicio: '2026-10-01' })], { custos: custosDe({ 'R35-SKU': 45 }) })
  assert.equal(res.recomendacoes.length, 0); assert.equal(res.avaliacoes.get('R35').motivoSemMarca.codigo, 'atual_melhor')
  const sem = rodar([an('R35')], [smart, of('R35', 'FUT', { meli_pct: 5, inicio: '2026-10-01' })], { custos: custosDe({ 'R35-SKU': 45 }) })
  assert.deepEqual(marcas(sem), ['R35:FUT:R1C'], 'controle: sem a manual a cobertura acaba hoje e R1C continua valendo')
})

// ═══ [36] hedge não sobra sozinho ═══════════════════════════════════════════════════════════════════════════════════
ok('[36] dono recusa a âncora: o hedge some junto (e o SEM_MARCA explica que foi recusa)', () => {
  const res = rodar([an('HG')], [of('HG', 'CURTA', { inicio: '2026-10-01', fim: '2026-10-07T23:59:59', meli_pct: 5 }), of('HG', 'LONGA', { inicio: '2026-10-01', fim: '2026-12-31', meli_pct: 4.9 })], { custos: custosDe({ 'HG-SKU': 45 }) })
  assert.deepEqual(marcas(res), ['HG:CURTA:R2', 'HG:LONGA:HEDGE']); assert.equal(res.recomendacoes[1].ancora, 'CURTA')
  const a = A.aplicarHumanos(res.recomendacoes, [{ item_id: 'HG', pid: 'CURTA', origem: 'humano', marcado: false, via: 'api' }])
  assert.deepEqual(a.efetivas, []); assert.deepEqual(a.ignoradas.map(i => i.porque), ['humano_recusou', 'humano_recusou'])
  const b = A.aplicarHumanos(res.recomendacoes, [{ item_id: 'HG', pid: 'LONGA', origem: 'humano', marcado: false, via: 'api' }])
  assert.deepEqual(b.efetivas.map(r => r.pid), ['CURTA'], 'recusar só o hedge mantém a âncora')
})

await okA('[36] (banco) hedge e relâmpago gravados fecham o read-back; recusar a âncora depois reabre a rodada até re-rodar', async () => {
  const C = 'Cli Hedge', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'HG-SKU': 45, 'RL-SKU': 51.5 })
  coletaSint(C, [an('HG'), an('RL')], [of('HG', 'CURTA', { inicio: '2026-10-01', fim: '2026-10-07T23:59:59', meli_pct: 5 }), of('HG', 'LONGA', { inicio: '2026-10-01', fim: '2026-12-31', meli_pct: 4.9 }), of('RL', 'P-R', { nome: 'Relâmpago', meli_pct: 5 })])
  const ap = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.deepEqual(ap.recomendacoes.map(r => `${r.item_id}:${r.pid}:${r.regra}`).sort(), ['HG:CURTA:R2', 'HG:LONGA:HEDGE', 'RL:P-R:RELAMPAGO'])
  assert.equal(ap.invariante.ok, true, JSON.stringify(ap.invariante.itens)); assert.equal(ap.invariante.readback.elegiveis_ge_piso, 2, 'HG (api) + RL (painel)')
  R.marcarHumano(C, { item_id: 'HG', pid: 'CURTA', marcado: false }, 'dono')
  assert.equal((await A.lerInvariante(C, deps)).ok, false, 'a recusa nova torna as linhas gravadas obsoletas')
  const r2 = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.deepEqual(r2.recomendacoes.map(r => r.item_id), ['RL']); assert.equal(r2.invariante.ok, true, JSON.stringify(r2.invariante.itens))
  assert.ok(R.lerDecisoes(C).some(d => d.item_id === 'HG' && d.regra === 'SEM_MARCA' && /recusado pelo dono/.test(d.motivo)))
})

// ═══ [37] [38] interrogatório ═══════════════════════════════════════════════════════════════════════════════════════
ok('[37] interrogatório: SKU "Livre" nunca recebe pergunta de MC/custo', () => {
  const regras = [{ mlb: '', sku: 'L1-SKU', status: 'Livre' }, { mlb: '', sku: 'L2-SKU', status: 'Livre' }]
  const anuncios = [an('L1'), an('L2')]
  const ofs = [of('L1', 'A', { meli_pct: 20 }), of('L1', 'B', { meli_pct: 5 }), of('L2', 'A', { meli_pct: 20 }), of('L2', 'B', { meli_pct: 5 })]
  const res = rodar(anuncios, ofs, { regras, custos: custosDe({ 'L1-SKU': 200 }) })                                     // L1: MC muito negativa; L2: sem custo
  assert.deepEqual(marcas(res), ['L1:A:LIVRE', 'L2:A:LIVRE'])
  const dec = [{ item_id: 'L1', pid: 'B', origem: 'humano', marcado: true, via: 'api' }, { item_id: 'L2', pid: 'B', origem: 'humano', marcado: true, via: 'api' }]
  const q = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: dec, anuncios, ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  assert.deepEqual(q.grupos.map(g => g.padrao), ['campanha_diferente']); assert.equal(q.grupos[0].n, 2)
  assert.ok(!q.grupos[0].itens.some(i => /vira "Livre"|falta cadastrar o custo/.test(i.pergunta))); assert.match(q.grupos[0].itens[0].explicacao, /maior rebate/)
  // Livre que já participa: a marca do dono em outra campanha vira "ja_ativo"
  const ofs3 = [of('L1', 'ATIVA', { status: 'started', meli_pct: 3, inicio: '2026-10-01' }), of('L1', 'B', { meli_pct: 5 })]
  const res3 = rodar([an('L1')], ofs3, { regras })
  const q3 = A.interrogar({ avaliacoes: res3.avaliacoes, decisoes: [dec[0]], anuncios: [an('L1')], ofertasPorItem: R.agruparPorItem(ofs3), campanhas: [] })
  assert.equal(q3.grupos[0].padrao, 'ja_ativo')
})
ok('[38] interrogatório de relâmpago usa o piso do relâmpago (19%), não o do rebate (20%)', () => {
  const ofs = [of('RL', 'P-R', { nome: 'Relâmpago', meli_pct: 5 })]
  const res = rodar([an('RL')], ofs, { custos: custosDe({ 'RL-SKU': 51.5 }) })                                              // MC 19,5%: ≥ 19 (relâmpago), < 20 (rebate)
  const rl = res.recomendacoes.find(r => r.regra === 'RELAMPAGO'); assert.ok(rl); assert.equal(rl.mc_pct, 19.5)
  const q = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: [{ item_id: 'RL', pid: 'P-R', origem: 'humano', marcado: false, via: 'painel' }], anuncios: [an('RL')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  const it = q.grupos.find(g => g.padrao === 'recusa').itens[0]
  assert.equal(it.piso, 19); assert.match(it.pergunta, /MC 19,5% ≥ piso 19,0%/); assert.doesNotMatch(it.pergunta, /20,0%/)
  const res2 = rodar([an('RL')], [of('RL', 'P-R', { nome: 'Relâmpago', meli_pct: 5 })], { custos: custosDe({ 'RL-SKU': 55 }) })   // 16%: abaixo dos dois pisos
  const q2 = A.interrogar({ avaliacoes: res2.avaliacoes, decisoes: [{ item_id: 'RL', pid: 'P-R', origem: 'humano', marcado: true, via: 'painel' }], anuncios: [an('RL')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  assert.equal(q2.grupos[0].padrao, 'abaixo_piso'); assert.equal(q2.grupos[0].itens[0].piso, 19)
})

// ═══ [39] SUGERIR MANUAL respeita o desconto mínimo de 5% ═══════════════════════════════════════════════════════════
ok('[39] manual sugerida nunca passa de 95% do preço cheio; sem como fechar => 3 saídas com teto e MC no teto', () => {
  const alerta = (custo, extra = {}) => rodar([an('M39', extra.an)], [MANUAL_ATE_07('M39')], { custos: custosDe({ 'M39-SKU': custo }) }).vigias.cobertura.alertas[0]
  const a = alerta(51)                                                                                                   // preço-alvo 115,10 = 4,1% de desconto sobre R$ 120
  assert.equal(a.precoManual, null); assert.equal(a.precoTeto, 114); assert.ok(a.mcNoTeto != null && a.mcNoTeto < 22)
  assert.match(a.manualNota, /desconto mínimo de 5%[\s\S]*teto R\$ 114,00[\s\S]*3 saídas/)
  const b = alerta(40)                                                                                                   // preço-alvo ≈ R$ 94,34: cabe
  assert.ok(b.precoManual > 0 && b.precoManual <= 114); assert.match(b.manualNota, /≈ R\$ 94,34/)
  const c = alerta(45, { an: { preco: null, preco_original: null } })
  const sem = rodar([an('M39', { preco: null, preco_original: null })], [{ ...MANUAL_ATE_07('M39'), preco: null, preco_original: null }], { custos: custosDe({ 'M39-SKU': 45 }) }).vigias.cobertura.alertas[0]
  assert.equal(sem.precoManual, null); assert.match(sem.manualNota, /sem preço cheio[\s\S]*sem sugestão de preço/)
  assert.ok(c)
})

// ═══ 2ª revisão (rev2) — frente ANALISTA: índices 0, 1, 14, 15, 17 ════════════════════════════════════════════════════
// rev2 [0] marca 👤 só trava o anúncio enquanto a campanha marcada é candidata/ativa; de campanha encerrada libera o analista (com nota), sem revogar a marca
await okA('rev2 [0] marca 👤 em campanha ATIVA segue travando o anúncio (vigia de cobertura trata); em campanha ENCERRADA libera o analista com nota', async () => {
  const deps = { hoje: HOJE, custosCliente: null }
  const marcaA = C => { R.marcarHumano(C, { item_id: 'X0', pid: 'A', marcado: true, preco: 95, offer_id: 'o' }, 'dono'); R.db.prepare("UPDATE promo_decisao SET estado = 'executada' WHERE cliente = ? AND item_id = 'X0' AND pid = 'A'").run(C) }
  // controle: A ainda started => a marca continua protegendo a participação (B, melhor, não é recomendada)
  const C0 = 'Cli Marca Ativa'
  preparar(C0, { 'X0-SKU': 45 })
  coletaSint(C0, [an('X0')], [of('X0', 'A', { status: 'started', inicio: '2026-09-01' }), of('X0', 'B', { meli_pct: 8, inicio: '2026-10-01' })])
  marcaA(C0)
  const r0 = await A.rodarAnalista(C0, { aplicar: false, deps })
  assert.deepEqual(r0.recomendacoes, []); assert.deepEqual(r0.ignoradas_por_humano.map(i => `${i.pid}:${i.porque}`), ['B:humano_marcou']); assert.deepEqual(r0.marcas_humanas_liberadas, [])
  // A saiu da lista (acabou/saiu): o anúncio volta ao analista, que explica por quê; a marca 👤 segue gravada e não é revogada
  for (const sufixo of ['sumiu', 'finished']) {
    const C = `Cli Marca Encerrada ${sufixo}`
    preparar(C, { 'X0-SKU': 45 })
    coletaSint(C, [an('X0')], [of('X0', 'B', { meli_pct: 8, inicio: '2026-10-01' }), ...(sufixo === 'finished' ? [of('X0', 'A', { status: 'finished', inicio: '2026-09-01', fim: '2026-10-01' })] : [])])
    marcaA(C)
    const seco = await A.rodarAnalista(C, { aplicar: false, deps })
    assert.deepEqual(seco.recomendacoes.map(r => `${r.pid}:${r.regra}`), ['B:R2'], sufixo); assert.deepEqual(seco.ignoradas_por_humano, [])
    assert.deepEqual(seco.marcas_humanas_liberadas.map(m => m.pid), ['A']); assert.equal(seco.invariante.ok, true, JSON.stringify(seco.invariante.itens))
    assert.equal(seco.interrogatorio.grupos.some(g => g.tipo === 'ele_marcou'), false, 'o interrogatório não repete "marcou A e eu não marcaria"')
    const ap = await A.rodarAnalista(C, { aplicar: true, deps })
    assert.equal(ap.invariante.ok, true, JSON.stringify(ap.invariante.itens))
    const gravada = R.lerDecisoes(C).find(d => d.origem === 'analista' && d.marcado && d.item_id === 'X0')
    assert.equal(gravada.pid, 'B'); assert.ok(gravada.obs.includes(A.NOTA_LIBERADA), 'a linha gravada explica a reavaliação')
    assert.ok(R.lerDecisoes(C).some(d => d.origem === 'humano' && d.marcado && d.pid === 'A' && d.estado === 'executada'), 'a decisão humana não é revogada')
    // o dono aprova B: a marca 👤 antiga não veta a aprovação no plano (marcasEfetivas) — senão a recomendação nunca chegaria à execução
    assert.equal(R.aprovarAnalista(C, [{ item_id: 'X0', pid: 'B' }], 'dono'), 1)
    assert.deepEqual(R.marcasEfetivas(C).map(d => `${d.origem}:${d.pid}`).sort(), ['analista:B', 'humano:A'])
  }
  // sem leitura confiável das ofertas nada é presumido: a marca segue valendo (falha fechado)
  const ofB = R.agruparPorItem([of('X0', 'B')]), marcaH = [{ item_id: 'X0', pid: 'A', origem: 'humano', marcado: true, via: 'api' }]
  for (const falha of [{ oferta_erro: 'HTTP 500' }, { lido_em: '' }, { under_review: true }]) assert.equal(A.marcasHumanasVivas(marcaH, [an('X0', falha)], ofB).get('X0')?.has('A'), true, JSON.stringify(falha))
  assert.equal(A.marcasHumanasVivas(marcaH, [], ofB).get('X0')?.has('A'), true, 'anúncio fora da coleta')
  assert.equal(A.marcasHumanasVivas(marcaH, [an('X0')], ofB).get('X0'), undefined, 'leitura boa e A fora da lista: liberada')
  const semVivas = A.aplicarHumanos([{ item_id: 'X0', pid: 'B', regra: 'R2', via: 'api' }], marcaH, null, new Map())
  assert.deepEqual(semVivas.efetivas.map(r => r.pid), ['B']); assert.deepEqual(semVivas.liberadas.map(d => d.pid), ['A'])
  assert.deepEqual(A.aplicarHumanos([{ item_id: 'X0', pid: 'B', regra: 'R2', via: 'api' }], marcaH).efetivas, [], 'sem `vivas` (chamada antiga) toda marca 👤 vale')
})

// rev2 [1] o invariante fica VERMELHO quando entradas que mudam a decisão mudam depois da rodada (selo das entradas + marca gravada × recálculo)
await okA('rev2 [1] custo/piso/regra/aprendizado/marca 👤/custos_cliente mudam depois da rodada => "rodada desatualizada"; refazer o analista fecha', async () => {
  const C = 'Cli Selo', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'X1-SKU': 45 })
  coletaSint(C, [an('X1')], [of('X1', 'A', { inicio: '2026-10-01' })])
  const verde = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.equal(verde.invariante.ok, true, JSON.stringify(verde.invariante.itens)); assert.equal(verde.recomendacoes[0].mc_pct, 26)
  const marcador = () => R.lerAlertas(C, 'rodada')[0].detalhe
  assert.match(marcador().entrada_hash, /^[0-9a-f]{16}$/); assert.deepEqual(Object.keys(marcador().entrada_partes), ['config', 'custos', 'regras', 'aprendizados', 'marcas_humanas', 'ofertas', 'anuncios'])
  assert.equal((await A.lerInvariante(C, deps)).ok, true, 'sem mudança nenhuma o selo não oscila')
  const muda = [
    ['custos', () => R.importarCustosSku(C, [{ sku: 'X1-SKU', custo: 46 }], 'teste'), 'marca_desatualizada'],             // MC 26% -> 25%: mesmo pid/regra/preço, outro número gravado
    ['config', () => R.setConfig(C, { piso_mc: 21 })],                                                                      // não muda a marca (25% ≥ 21%), só o selo pega
    ['regras', () => R.salvarRegraSku(C, { sku: 'OUTRO-SKU', status: 'Livre' })],
    ['aprendizados', () => R.registrarAprendizado(C, { acao: 'ignorar', escopo_tipo: 'sku', escopo_valor: 'ZZ-SKU', resposta: 'nao mexer' }, 'dono')],
    ['marcas_humanas', () => R.marcarHumano(C, { item_id: 'X1', pid: 'ZZ', marcado: false }, 'dono')],
  ]
  for (const [parte, mexe, extra] of muda) {
    mexe()
    const inv = await A.lerInvariante(C, deps), it = inv.itens.find(i => i.id === 'rodada_desatualizada')
    assert.equal(inv.ok, false, `${parte}: o invariante tem de ficar vermelho`); assert.equal(it.encontrado, 1, parte); assert.ok(it.ids.includes(parte), `${parte}: ${JSON.stringify(it.ids)}`)
    assert.match(it.rotulo, /rodada desatualizada/); if (extra) assert.equal(inv.itens.find(i => i.id === extra).encontrado, 1, extra)
    assert.equal((await A.rodarAnalista(C, { aplicar: true, deps })).invariante.ok, true, `${parte}: refazer o analista fecha`)
  }
  // custos_cliente efetivos (percentuais do cliente) também entram no selo
  const comPct = await A.lerInvariante(C, { ...deps, custosCliente: { cmv_pct: 40, comissao_pct: 15, imposto_pct: 10, frete_pct: 0, embalagem_pct: 1 } })
  assert.equal(comPct.ok, false); assert.ok(comPct.itens.find(i => i.id === 'rodada_desatualizada').ids.includes('custos'))
  // marcador de versão anterior (sem selo): fail-closed
  const d = marcador(); delete d.entrada_hash; delete d.entrada_partes
  R.db.prepare("UPDATE promo_alerta SET detalhe_json = ? WHERE cliente = ? AND tipo = 'rodada'").run(JSON.stringify(d), C)
  const velho = await A.lerInvariante(C, deps); assert.equal(velho.ok, false); assert.match(velho.itens.find(i => i.id === 'rodada_desatualizada').ids[0], /sem selo/)
})
ok('rev2 [1] (puro) marca gravada com MC% diferente, ou que saiu das elegíveis (custo/piso mudaram), é "marca desatualizada" — mesmo com pid/regra/preço iguais', () => {
  const ofs = [of('X1', 'A', { inicio: '2026-10-01' })], rodada = { rodada_id: 'R', coleta_id: 'K' }
  const res = rodar([an('X1')], ofs, { custos: custosDe({ 'X1-SKU': 45 }) }), efetivas = res.recomendacoes
  const grava = (extra = {}, lista = efetivas) => lista.map(r => ({ ...r, origem: 'analista', marcado: true, rodada_id: 'R', ...extra }))
  const inv = (resX, decisoes, efs) => A.invariante({ avaliacoes: resX.avaliacoes, vigias: resX.vigias, decisoes, alertas: A.alertasDeVigias(resX.vigias).map(a => ({ ...a, rodada_id: 'R' })), efetivas: efs, coletaId: 'K', rodada })
  assert.equal(inv(res, grava(), efetivas).ok, true)
  const mcOutra = inv(res, grava({ mc_pct: 20 }), efetivas)
  assert.equal(mcOutra.itens[0].encontrado, 1, 'MC% gravada ≠ recalculada: a elegível não está decidida'); assert.equal(mcOutra.itens.find(i => i.id === 'marca_desatualizada').encontrado, 1)
  // custo subiu: MC 11% < piso — o item sai das elegíveis, o laço antigo nem o visitava e a linha velha ficava "aprovável"
  const nova = rodar([an('X1')], ofs, { custos: custosDe({ 'X1-SKU': 60 }) })
  assert.deepEqual(nova.recomendacoes, []); assert.equal(nova.avaliacoes.get('X1').elegiveisPiso.length, 0)
  const velha = inv(nova, grava(), [])
  assert.equal(velha.itens[0].encontrado, 0, 'o laço antigo (só itens elegíveis) não via nada'); assert.deepEqual(velha.itens.find(i => i.id === 'marca_desatualizada').ids, ['X1:A']); assert.equal(velha.ok, false)
  // piso subiu para 30%: idem
  const piso = rodar([an('X1')], ofs, { custos: custosDe({ 'X1-SKU': 45 }), config: { piso_mc: 30 } })
  assert.equal(inv(piso, grava(), []).ok, false)
})

// rev2 [14] o vigia respeita a marca 👤 do dono em item IGNORAR / Revisar toda rodada (não manda "criar a manual")
await okA('rev2 [14] protegido em Revisar/IGNORAR + marca 👤 do dono cobrindo => MARCAR com marcaCobre; as candidatas SEM marca continuam barradas', async () => {
  const deps = { hoje: HOJE, custosCliente: null }
  for (const via of ['revisar', 'ignorar']) {
    const C = `Cli Vigia Humano ${via}`
    preparar(C, { 'Q14-SKU': 45 })
    coletaSint(C, [an('Q14')], [MANUAL_ATE_07('Q14'), of('Q14', 'A', { inicio: '2026-10-01', meli_pct: 5 }), of('Q14', 'B', { inicio: '2026-10-01', meli_pct: 9 })])
    R.definirProtegido(C, 'Q14', true, 'teste')
    if (via === 'revisar') R.salvarRegraSku(C, { sku: 'Q14-SKU', status: 'Revisar toda rodada' }, 'dono')
    else R.registrarAprendizado(C, { acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'Q14', resposta: 'nao mexer' }, 'dono')
    const sem = (await A.rodarAnalista(C, { aplicar: false, deps })).vigias.cobertura.alertas[0]
    assert.equal(sem.saida, 'SUGERIR MANUAL', `${via}: sem marca do dono o portão vale`); assert.equal(sem.marcaCobre, false); assert.match(sem.manualNota, /IGNORAR\/Revisar/)
    R.marcarHumano(C, { item_id: 'Q14', pid: 'A', marcado: true, preco: 100, offer_id: 'o' }, 'dono')
    const r = await A.rodarAnalista(C, { aplicar: true, deps })
    const al = r.vigias.cobertura.alertas[0]
    assert.equal(al.saida, 'MARCAR', via); assert.equal(al.marcaCobre, true, via); assert.equal(al.melhorCobre.pid, 'A', 'só a candidata que o dono marcou conta; B (melhor MC, sem marca) segue barrada')
    assert.doesNotMatch(al.manualNota || '', /crie a manual/); assert.equal(r.invariante.ok, true, JSON.stringify(r.invariante.itens))
  }
  // recusa explícita 👤 da mesma campanha ainda vence (humano recusou != humano marcou)
  const C = 'Cli Vigia Humano recusa'
  preparar(C, { 'Q14-SKU': 45 })
  coletaSint(C, [an('Q14')], [MANUAL_ATE_07('Q14'), of('Q14', 'A', { inicio: '2026-10-01' })])
  R.definirProtegido(C, 'Q14', true, 'teste'); R.salvarRegraSku(C, { sku: 'Q14-SKU', status: 'Revisar toda rodada' }, 'dono'); R.marcarHumano(C, { item_id: 'Q14', pid: 'A', marcado: false }, 'dono')
  assert.equal((await A.rodarAnalista(C, { aplicar: false, deps })).vigias.cobertura.alertas[0].saida, 'SUGERIR MANUAL')
})

// rev2 [15] o read-back conta anúncios DISTINTOS na janela principal; a outra janela vai à parte (não soma 7d + 14d)
await okA('rev2 [15] 2 protegidos descobertos nas duas janelas => read-back 2 (não 4), igual ao KPI; a janela de 14d aparece separada', async () => {
  const C = 'Cli Readback Janelas', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'X15-SKU': 45, 'Y15-SKU': 45 })
  coletaSint(C, [an('X15'), an('Y15')], [MANUAL_ATE_07('X15'), MANUAL_ATE_07('Y15')])
  R.definirProtegido(C, 'X15', true, 'teste'); R.definirProtegido(C, 'Y15', true, 'teste')
  const r = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.equal(r.resumo.descobertos, 2); assert.equal(r.invariante.ok, true, JSON.stringify(r.invariante.itens))
  const rb = r.invariante.readback
  assert.equal(rb.protegidos_descobertos, 2, 'o mesmo número do KPI "Descobertos"'); assert.equal(rb.com_alerta_cobertura, 2)
  assert.equal(rb.janela_principal, 7); assert.deepEqual(rb.outras_janelas, [{ dias: 14, descobertos: 2 }]); assert.deepEqual(rb.janelas, [{ dias: 7, descobertos: 2 }, { dias: 14, descobertos: 2 }])
  // alerta de uma janela apagado: o número do read-back segue por anúncio distinto (1 de 2 com alerta na principal)
  R.db.prepare("DELETE FROM promo_alerta WHERE cliente = ? AND tipo = 'cobertura' AND chave = 'X15|7d'").run(C)
  const inv = await A.lerInvariante(C, deps)
  assert.equal(inv.readback.protegidos_descobertos, 2); assert.equal(inv.readback.com_alerta_cobertura, 1); assert.deepEqual(inv.itens.find(i => i.id === 'protegidos_sem_alerta').ids, ['X15 (7d)'])
})

// rev2 [17] interrogatório: hedge descartado pela recusa da âncora não vira pergunta "sem decisão sua"
ok('rev2 [17] dono recusa a âncora (CURTA): só a pergunta de recusa; o hedge (LONGA) que o sistema descartou não é perguntado', () => {
  const ofs = [of('HG', 'CURTA', { inicio: '2026-10-01', fim: '2026-10-07T23:59:59', meli_pct: 5 }), of('HG', 'LONGA', { inicio: '2026-10-01', fim: '2026-12-31', meli_pct: 4.9 })]
  const res = rodar([an('HG')], ofs, { custos: custosDe({ 'HG-SKU': 45 }) })
  assert.deepEqual(marcas(res), ['HG:CURTA:R2', 'HG:LONGA:HEDGE'])
  const dec = [{ item_id: 'HG', pid: 'CURTA', origem: 'humano', marcado: false, via: 'api' }]
  const q = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: dec, anuncios: [an('HG')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  assert.deepEqual(q.grupos.map(g => g.padrao), ['recusa']); assert.deepEqual(q.grupos[0].itens.map(i => i.pid), ['CURTA']); assert.equal(q.divergem, 1)
  // controle: recusar só o hedge mantém a pergunta da âncora (sem decisão sobre ela)
  const q2 = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: [{ item_id: 'HG', pid: 'LONGA', origem: 'humano', marcado: false, via: 'api' }], anuncios: [an('HG')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  assert.deepEqual(q2.grupos.map(g => `${g.padrao}:${g.itens.map(i => i.pid)}`).sort(), ['recusa:LONGA', 'sem_decisao:CURTA'])
})

// ═══ 3ª revisão (rev3) — frente ANALISTA: índices 0, 6, 7, 8, 9, 10 ════════════════════════════════════════════════════
ok('rev3 [0] interrogatório: marca 👤 ou 🤖 aprovada já executada/programada (started/pending) é estado esperado — não vira "eu não marcaria"', () => {
  const ofs = [of('X0', 'A', { status: 'started', inicio: '2026-09-01' }), of('X0', 'B', { meli_pct: 8, inicio: '2026-10-01' })]
  const res = rodar([an('X0')], ofs, { custos: custosDe({ 'X0-SKU': 45 }) })
  const q = dec => A.interrogar({ avaliacoes: res.avaliacoes, decisoes: dec, anuncios: [an('X0')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  for (const dec of [[{ item_id: 'X0', pid: 'A', origem: 'humano', marcado: true, via: 'api' }], [{ item_id: 'X0', pid: 'A', origem: 'analista', marcado: true, aprovado: true, via: 'api' }]]) {
    const r = q(dec)
    assert.equal(r.grupos.some(g => g.tipo === 'ele_marcou'), false, `${dec[0].origem}: ${JSON.stringify(r.grupos)}`); assert.equal(r.divergem, 0, dec[0].origem)
  }
  for (const status of ['pending']) assert.equal(A.interrogar({ avaliacoes: res.avaliacoes, decisoes: [{ item_id: 'X0', pid: 'A', origem: 'humano', marcado: true, via: 'api' }], anuncios: [an('X0')], ofertasPorItem: R.agruparPorItem([{ ...ofs[0], status }, ofs[1]]), campanhas: [] }).divergem, 0, status)
  // 🤖 aprovada de campanha ENCERRADA (A sumiu da leitura) não é mais "marca do dono": o analista reavalia e pergunta da B, não "marcou A e eu não marcaria"
  const ofs2 = [ofs[1]], res2 = rodar([an('X0')], ofs2, { custos: custosDe({ 'X0-SKU': 45 }) })
  const q2 = A.interrogar({ avaliacoes: res2.avaliacoes, decisoes: [{ item_id: 'X0', pid: 'A', origem: 'analista', marcado: true, aprovado: true, via: 'api' }], anuncios: [an('X0')], ofertasPorItem: R.agruparPorItem(ofs2), campanhas: [] })
  assert.deepEqual(q2.grupos.map(g => `${g.padrao}:${g.itens.map(i => i.pid)}`), ['sem_decisao:B'])
  // controle: marca 👤 em CANDIDATA que eu não marcaria continua sendo perguntada
  const ofs3 = [of('X0', 'C', { meli_pct: 3, inicio: '2026-10-01' }), ofs[1]], res3 = rodar([an('X0')], ofs3, { custos: custosDe({ 'X0-SKU': 45 }) })
  assert.deepEqual(A.interrogar({ avaliacoes: res3.avaliacoes, decisoes: [{ item_id: 'X0', pid: 'C', origem: 'humano', marcado: true, via: 'api' }], anuncios: [an('X0')], ofertasPorItem: R.agruparPorItem(ofs3), campanhas: [] }).grupos.map(g => g.padrao), ['campanha_diferente'])
})
ok('rev3 [6] interrogatório: marca de RELÂMPAGO se explica pela trilha painel; marca só no relâmpago não cala a pergunta da trilha API', () => {
  const ofs = [of('RL9', 'N', { inicio: '2026-10-01' }), of('RL9', 'REL1', { nome: 'Oferta relâmpago 1', meli_pct: 8 }), of('RL9', 'REL2', { nome: 'Oferta relâmpago 2', meli_pct: 7 })]
  const res = rodar([an('RL9')], ofs, { custos: custosDe({ 'RL9-SKU': 45 }) })                    // N: MC 26% (api) · REL1 29,6% (painel) · REL2 28,4%
  assert.deepEqual(marcas(res).sort(), ['RL9:N:R2', 'RL9:REL1:RELAMPAGO'])
  const q = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: [{ item_id: 'RL9', pid: 'REL2', origem: 'humano', marcado: true, via: 'painel' }], anuncios: [an('RL9')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: [] })
  const it = q.grupos.find(g => g.padrao === 'campanha_diferente').itens[0]
  assert.equal(it.pid, 'REL2'); assert.match(it.explicacao, /Oferta relâmpago 1 \(MC 29,6%\)/); assert.doesNotMatch(it.explicacao, /Camp N|26,0%/)
  assert.deepEqual(q.grupos.find(g => g.padrao === 'sem_decisao')?.itens.map(i => i.pid), ['N'], 'a trilha API (N) segue sem decisão do dono')
  // relâmpago já no ar (ja_ativo) + "atual_melhor" na API: a pergunta do relâmpago não fala em migração da API
  const ofs2 = [of('RL9', 'REL0', { nome: 'Oferta relâmpago 0', status: 'started', meli_pct: 5 }), of('RL9', 'ATUAL', { status: 'started', meli_pct: 10, inicio: '2026-09-01' }),
    of('RL9', 'NOVA', { inicio: '2026-10-01' }), of('RL9', 'REL2', { nome: 'Oferta relâmpago 2', meli_pct: 7 })]
  const res2 = rodar([an('RL9')], ofs2, { custos: custosDe({ 'RL9-SKU': 45 }) })
  assert.equal(res2.avaliacoes.get('RL9').motivoSemMarca.codigo, 'atual_melhor'); assert.equal(res2.avaliacoes.get('RL9').relampago.motivoSemMarca.codigo, 'ja_ativo')
  const q2 = A.interrogar({ avaliacoes: res2.avaliacoes, decisoes: [{ item_id: 'RL9', pid: 'REL2', origem: 'humano', marcado: true, via: 'painel' }], anuncios: [an('RL9')], ofertasPorItem: R.agruparPorItem(ofs2), campanhas: [] })
  assert.deepEqual(q2.grupos.map(g => g.padrao), ['outro']); assert.match(q2.grupos[0].itens[0].explicacao, /relâmpago SMART/); assert.doesNotMatch(q2.grupos[0].itens[0].pergunta, /migrar/)
})
ok('rev3 [7] relâmpago SMART sem preço no slot => "sem preço no slot — confira no painel", nunca "MC -Infinity%"', () => {
  const sem = of('RS7', 'REL', { nome: 'OFERTAS RELÂMPAGOS IMPERDÍVEIS', preco: null })
  const res = rodar([an('RS7')], [sem], { custos: custosDe({ 'RS7-SKU': 45 }) })
  const m = res.avaliacoes.get('RS7').relampago.motivoSemMarca
  assert.equal(m.codigo, 'sem_preco'); assert.match(m.texto, /sem preço no slot — confira no painel/); assert.doesNotMatch(m.texto, /Infinity|NaN/)
  // misto: um slot com preço (abaixo do piso) e um sem — diz as duas coisas, com número finito
  const res2 = rodar([an('RS7')], [sem, of('RS7', 'REL2', { nome: 'Oferta relâmpago', meli_pct: 1, preco: 80 })], { custos: custosDe({ 'RS7-SKU': 45 }) })      // MC ≈ 7,8% < 19%
  const m2 = res2.avaliacoes.get('RS7').relampago.motivoSemMarca
  assert.equal(m2.codigo, 'abaixo_piso'); assert.match(m2.texto, /melhor MC \d+,\d%[\s\S]*1 slot\(s\) sem preço no slot/); assert.doesNotMatch(m2.texto, /Infinity|NaN/)
  // e o interrogatório não pergunta de CUSTO quando o que falta é o preço
  const q = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: [{ item_id: 'RS7', pid: 'REL', origem: 'humano', marcado: true, via: 'painel' }], anuncios: [an('RS7')], ofertasPorItem: R.agruparPorItem([sem]), campanhas: [] })
  assert.deepEqual(q.grupos.map(g => g.padrao), ['sem_preco']); assert.match(q.grupos[0].itens[0].pergunta, /sem preço no slot/); assert.doesNotMatch(q.grupos[0].itens[0].pergunta, /custo/)
})
ok('rev3 [8] SUGERIR MANUAL menciona a candidata que continua a cobertura a décimos do piso (MC e quanto falta) — regra 31/08, 02/09, 04/09-b', () => {
  const cob = custo => rodar([an('C8')], [MANUAL_ATE_07('C8'), of('C8', 'COB', { inicio: '2026-10-05', fim: '2026-11-04' })], { custos: custosDe({ 'C8-SKU': custo }) }).vigias.cobertura.alertas[0]
  const a = cob(51.3)                                                                                                      // MC 19,7% < piso 20%
  assert.equal(a.saida, 'SUGERIR MANUAL'); assert.equal(a.melhorCobre, null, 'nunca marca sozinho (não é banda automática)')
  assert.match(a.manualNota, /Camp COB continuaria a cobertura[\s\S]*MC 19,7%[\s\S]*faltam 0,3 ponto\(s\) para o piso 20,0%[\s\S]*decisão sua/)
  assert.doesNotMatch(cob(52.5).manualNota, /continuaria a cobertura/, 'controle: 1,5 ponto abaixo não é "décimos"')
})
ok('rev3 [9] vigia rebate pior: PRICE_MATCHING não disputa o preço com a SMART (regra de 14/09)', () => {
  const vig = ofs => A.vigiaRebatePior({ anuncios: [an('V9')], ofertasPorItem: R.agruparPorItem(ofs), campanhas: new Map(), hoje: HOJE })
  const smart = of('V9', 'SM', { status: 'started', meli_pct: 5 })
  assert.deepEqual(vig([smart, of('V9', 'PM', { tipo: 'PRICE_MATCHING', status: 'started', meli_pct: 8 })]), [], 'PM started pelo mesmo preço não é "empate"')
  assert.deepEqual(vig([smart, of('V9', 'PM', { tipo: 'PRICE_MATCHING', meli_pct: 8 })]), [], 'PM candidata não é "elegível melhor"')
  assert.deepEqual(vig([smart, of('V9', 'SM2', { meli_pct: 8 })]).map(x => x.tipo), ['elegivel_melhor'], 'controle: SMART melhor continua alertando')
})
await okA('rev3 [10] SMART sem nome (nem na oferta nem na campanha): o analista não marca por API, avisa e grava SEM_MARCA; com nome na campanha decide normalmente', async () => {
  const semNome = of('S10', 'P-MLB18055120', { nome: '', inicio: '2026-10-01' })
  const res = rodar([an('S10')], [semNome], { custos: custosDe({ 'S10-SKU': 45 }) })
  const av = res.avaliacoes.get('S10')
  assert.deepEqual(res.recomendacoes, []); assert.deepEqual(av.elegiveisPiso, []); assert.equal(av.motivoSemMarca.codigo, 'smart_sem_nome')
  assert.ok(av.avisos.some(t => t.includes(A.TXT_SMART_SEM_NOME))); assert.equal(av.candidatos[0].semNome, true)
  // o nome vem da campanha (mesma regra do completarNomes do plano): relâmpago vai para o painel, campanha comum segue pela API
  const rel = rodar([an('S10')], [semNome], { custos: custosDe({ 'S10-SKU': 45 }), campanhas: [{ pid: 'P-MLB18055120', nome: 'OFERTAS RELÂMPAGOS IMPERDÍVEIS' }] })
  assert.deepEqual(rel.recomendacoes.map(r => `${r.pid}:${r.regra}:${r.via}`), ['P-MLB18055120:RELAMPAGO:painel'])
  const comum = rodar([an('S10')], [semNome], { custos: custosDe({ 'S10-SKU': 45 }), campanhas: [{ pid: 'P-MLB18055120', nome: 'Wearables Geral Out' }] })
  assert.deepEqual(marcas(comum), ['S10:P-MLB18055120:R2'])
  // hedge/R2 nunca escolhe a SMART sem nome ao lado de uma conhecida
  assert.deepEqual(marcas(rodar([an('S10')], [semNome, of('S10', 'K', { meli_pct: 3, inicio: '2026-10-01' })], { custos: custosDe({ 'S10-SKU': 45 }) })), ['S10:K:R2'])
  // vigia: nunca "MARCAR" a SMART sem nome como cobertura — avisa
  const vig = rodar([an('S10')], [MANUAL_ATE_07('S10'), semNome], { custos: custosDe({ 'S10-SKU': 45 }) }).vigias.cobertura.alertas[0]
  assert.equal(vig.saida, 'SUGERIR MANUAL'); assert.match(vig.manualNota, /SMART sem nome — confirme no painel se é relâmpago/)
  // interrogatório: o dono marcou a SMART sem nome => pergunta própria
  const q = A.interrogar({ avaliacoes: res.avaliacoes, decisoes: [{ item_id: 'S10', pid: 'P-MLB18055120', origem: 'humano', marcado: true, via: 'api' }], anuncios: [an('S10')], ofertasPorItem: R.agruparPorItem([semNome]), campanhas: [] })
  assert.deepEqual(q.grupos.map(g => g.padrao), ['smart_sem_nome'])
  // banco: a rodada grava SEM_MARCA com o aviso e o invariante fecha
  const C = 'Cli SMART sem nome', deps = { hoje: HOJE, custosCliente: null }
  preparar(C, { 'S10-SKU': 45 }); coletaSint(C, [an('S10')], [semNome])
  const ap = await A.rodarAnalista(C, { aplicar: true, deps })
  assert.deepEqual(ap.recomendacoes, []); assert.equal(ap.invariante.ok, true, JSON.stringify(ap.invariante.itens))
  assert.ok(R.lerDecisoes(C).some(d => d.item_id === 'S10' && d.regra === 'SEM_MARCA' && d.motivo.includes(A.TXT_SMART_SEM_NOME)))
})

console.log(`✔ teste-promocoes-analista: ${n} verificações OK (achados 0, 3, 7, 8, 9, 11, 22, 23, 24, 35, 36, 37, 38, 39 + contrato a; rev2 0, 1, 14, 15, 17; rev3 0, 6, 7, 8, 9, 10)`)
