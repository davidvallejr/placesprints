// Autoteste do NÚCLEO de custos por SKU (M1, src/lib/custos-db.js + ganchos em promocoes-db.js). Spec: docs/integracao-custos-erp-SPEC.md §4, §5, §11.1, §12.
// Banco EM MEMÓRIA, sem rede, sem porta. Rodar: node scripts/teste-custos-nucleo.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // tem de vir ANTES dos imports dinâmicos (o módulo lê isto no carregamento)
import assert from 'node:assert/strict'
const R = await import('../src/lib/promocoes-db.js')
const C = await import('../src/lib/custos-db.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const pausa = ms => new Promise(r => setTimeout(r, ms))
const logs = []; C.configurarLog((nivel, msg) => logs.push(`${nivel} ${msg}`))
const lote = (cliente, linhas, o = {}) => C.aplicarLote({ cliente, fonte: 'sheets', modo: 'parcial', lote_id: 'L' + Math.random().toString(36).slice(2, 8), linhas, origem: 'webhook', ...o })
const vig = (cliente, sku, fonte = 'sheets') => R.db.prepare('SELECT * FROM erp_custos_sku WHERE cliente = ? AND sku_key = ? AND fonte = ?').get(cliente, C.chaveSku(sku), fonte)
const hist = (cliente, sku) => C.historicoSku(cliente, sku).map(h => h.evento).reverse()
const anuncio = (cliente, item_id, sku, preco, preco_original = null, fat30 = 0) => R.db.prepare('INSERT INTO promo_anuncio (cliente, item_id, sku, preco, preco_original, fat30) VALUES (?,?,?,?,?,?)').run(cliente, item_id, sku, preco, preco_original, fat30)
const codigo = (r, sku) => r.rejeitadas_lista.filter(x => x.sku === sku).map(x => x.codigo)

// ── normalização declarada ───────────────────────────────────────────────────
ok('SKU: NBSP vira espaço, zero-width some, espaços internos/zeros/hífens/caixa preservados, 81 caracteres inválido', () => {
  assert.equal(C.normalizarSku('\u00A0 AB\u200B-01\uFEFF '), 'AB-01')
  assert.equal(C.normalizarSku('AB\u00A0 01'), 'AB  01')
  assert.equal(C.normalizarSku('  007 Kit  Azul '), '007 Kit  Azul')
  assert.equal(C.normalizarSku('x'.repeat(80)).length, 80)
  assert.equal(C.normalizarSku('x'.repeat(81)), '')
  assert.equal(C.normalizarSku(''), ''); assert.equal(C.normalizarSku(null), ''); assert.equal(C.normalizarSku({}), ''); assert.equal(C.normalizarSku(true), '')
  assert.equal(C.normalizarSku(12345), '12345')
  assert.equal(C.chaveSku('Abc-1'), C.chaveSku('aBC-1'))
  assert.equal(C.normalizarMlb(' mlb123 '), 'MLB123'); assert.equal(C.normalizarMlb('MLBU123'), ''); assert.equal(C.normalizarMlb('MLB' + '1'.repeat(15)), ''); assert.equal(C.normalizarMlb(123), '')
})

// ── custo de máquina: nada inválido vira custo ─────────────────────────────────
ok('lerCustoMaquina: códigos e formato canônico', () => {
  const cod = v => C.lerCustoMaquina(v).codigo
  for (const v of ['', '  ', null, undefined]) assert.equal(cod(v), 'custo_ausente', String(v))
  for (const v of [NaN, Infinity, -Infinity, true, false, [], {}, '1,234', 'R$ 12,50', '12,5', '1.234,56', 'abc', '-1', '1e3', '.5']) assert.equal(cod(v), 'custo_invalido', String(v))
  for (const v of [0, -1, '0', '0.00001', 0.00004, -0]) assert.equal(cod(v), 'custo_zero_ou_negativo', String(v))
  for (const v of [1e7 + 1, '10000000.01', 1e21]) assert.equal(cod(v), 'custo_acima_maximo', String(v))
  assert.deepEqual(C.lerCustoMaquina('36.3200000000'), { custo: 36.32, custo_txt: '36.32' })
  assert.deepEqual(C.lerCustoMaquina(12.34567), { custo: 12.3457, custo_txt: '12.3457' })
  assert.deepEqual(C.lerCustoMaquina(0.00005), { custo: 0.0001, custo_txt: '0.0001' })
  assert.deepEqual(C.lerCustoMaquina(1e7), { custo: 1e7, custo_txt: '10000000' })
  assert.ok(C.lerCustoMaquina(0).motivo)
})

ok('custos inválidos são rejeitados com código e NÃO alteram o vigente (custo_mantido registrado)', () => {
  const A = 'Cli Invalidos'
  assert.equal(lote(A, [{ sku: 'K1', custo: 10 }]).novas, 1)
  const ruins = ['', null, undefined, NaN, Infinity, 0, -1, true, [], '1,234', 'R$ 12,50', 1e8]
  for (const v of ruins) {
    const r = lote(A, [{ sku: 'K1', custo: v, line: 9 }])
    assert.equal(r.rejeitadas, 1, String(v)); assert.equal(r.aceitas, 0)
    assert.ok(['custo_ausente', 'custo_invalido', 'custo_zero_ou_negativo', 'custo_acima_maximo'].includes(r.rejeitadas_lista[0].codigo))
    assert.equal(r.rejeitadas_lista[0].linha, 9)
    assert.equal(vig(A, 'K1').custo, 10)
  }
  assert.equal(C.custosEfetivos(A).get('k1'), 10)
  const rj = R.db.prepare('SELECT * FROM erp_rejeitadas WHERE cliente = ?').get(A)
  assert.equal(rj.custo_mantido, 10); assert.equal(rj.chave, 'sku:k1'); assert.ok(rj.custo_txt.length <= 40)
  assert.deepEqual(hist(A, 'K1'), ['novo'], 'rejeição não escreve histórico de valor')
  assert.equal(lote(A, [{ sku: 'K1', custo: 11 }]).alteradas, 1)
  assert.equal(R.db.prepare('SELECT COUNT(*) n FROM erp_rejeitadas WHERE cliente = ?').get(A).n, 0, 'linha aceita limpa a rejeição dela')
})

ok('CHECK do SQLite barra INSERT direto de custo 0 / negativo / acima do teto', () => {
  const ins = c => R.db.prepare("INSERT INTO erp_custos_sku (cliente, sku_key, fonte, sku, custo, custo_txt, recebido_em, visto_em, hash) VALUES ('X','a','sheets','a',?,'0','t','t','h')").run(c)
  assert.throws(() => ins(0), /CHECK/); assert.throws(() => ins(-5), /CHECK/); assert.throws(() => ins(1e7 + 1), /CHECK/)
  assert.throws(() => R.db.prepare("INSERT INTO erp_custos_sku (cliente, sku_key, fonte, sku, custo, custo_txt, recebido_em, visto_em, hash) VALUES ('X','a','omie','a',1,'1','t','t','h')").run(), /CHECK/)
  assert.throws(() => R.db.prepare("INSERT INTO erp_quarentena (cliente, sku_key, fonte, sku, motivo, custo_proposto, custo_txt, recebido_em) VALUES ('X','a','sheets','a','m',0,'0','t')").run(), /CHECK/)
})

// ── identidade da linha: SKU/MLB ─────────────────────────────────────────────
ok('códigos de identidade: sku_vazio, sku_invalido, mlb_invalido (MLBU), mlb_sem_sku, conflito_sku_mlb; MLB com SKU do anúncio casa', () => {
  const A = 'Cli Ident'
  anuncio(A, 'MLB100', 'SKU-A', 50); anuncio(A, 'MLB200', '', 50); anuncio(A, 'MLB300', 'Sku-C', 50)
  const r = lote(A, [
    { custo: 5, line: 2 }, { sku: '  \u200B ', mlb: null, custo: 5, line: 3 },
    { sku: { x: 1 }, custo: 5, line: 4 }, { sku: 'x'.repeat(81), custo: 5, line: 5 },
    { sku: 'S1', mlb: 'MLBU123', custo: 5, line: 6 }, { mlb: 'abc', custo: 5, line: 7 },
    { mlb: 'MLB999', custo: 5, line: 8 }, { mlb: 'MLB200', custo: 5, line: 9 },
    { sku: 'OUTRO', mlb: 'MLB100', custo: 5, line: 10 },
    { mlb: 'mlb300', custo: 7, line: 11 },                      // sem SKU: usa o do anúncio
    { sku: 'sku-a', mlb: 'MLB100', custo: 8, line: 12 },        // caixa diferente casa
    { sku: 'NOVO', mlb: 'MLB200', custo: 9, line: 13 },         // anúncio sem SKU: aceita pelo SKU da linha e guarda mlb_dica
    null, 'lixo',
  ])
  const porLinha = Object.fromEntries(r.rejeitadas_lista.map(x => [x.linha, x.codigo]))
  assert.equal(porLinha[2], 'sku_vazio'); assert.equal(porLinha[3], 'sku_vazio'); assert.equal(porLinha[4], 'sku_invalido'); assert.equal(porLinha[5], 'sku_invalido')
  assert.equal(porLinha[6], 'mlb_invalido'); assert.equal(porLinha[7], 'mlb_invalido'); assert.equal(porLinha[8], 'mlb_sem_sku'); assert.equal(porLinha[9], 'mlb_sem_sku')
  assert.equal(porLinha[10], 'conflito_sku_mlb')
  assert.match(r.rejeitadas_lista.find(x => x.linha === 10).motivo, /SKU-A.*OUTRO/)
  assert.equal(r.rejeitadas, 11, 'null e string também viram sku_vazio, nunca exceção')
  assert.equal(r.aceitas, 3)
  assert.equal(vig(A, 'Sku-C').custo, 7); assert.equal(vig(A, 'Sku-C').mlb_dica, 'MLB300')
  assert.equal(vig(A, 'SKU-A').custo, 8); assert.equal(vig(A, 'NOVO').mlb_dica, 'MLB200')
  assert.equal(vig(A, 'OUTRO'), undefined, 'conflito não grava nada')
  assert.equal(R.db.prepare("SELECT chave FROM erp_rejeitadas WHERE cliente = ? AND codigo = 'conflito_sku_mlb'").get(A).chave, 'mlb:MLB100')
})

ok('SKU repetido no lote: custos iguais vale um; diferentes (ou um inválido) rejeita TODAS; caixa diferente é o mesmo SKU', () => {
  const A = 'Cli Dup'
  const r = lote(A, [{ sku: 'D1', custo: 10 }, { sku: 'd1', custo: '10.00' }, { sku: 'D2', custo: 10 }, { sku: 'D2', custo: 11 }, { sku: 'D3', custo: 5 }, { sku: 'D3', custo: '' }])
  assert.equal(r.aceitas, 1); assert.equal(r.duplicadas_iguais, 1); assert.equal(vig(A, 'D1').custo, 10)
  assert.deepEqual(codigo(r, 'D2'), ['sku_duplicado_no_lote', 'sku_duplicado_no_lote']); assert.equal(vig(A, 'D2'), undefined)
  assert.deepEqual(codigo(r, 'D3'), ['sku_duplicado_no_lote', 'sku_duplicado_no_lote']); assert.equal(vig(A, 'D3'), undefined)
})

// ── quarentena ───────────────────────────────────────────────────────────────
ok('variacao_brusca: 51% sim, 50% não, primeiro valor não passa pela variação; quarentena NÃO troca o vigente', () => {
  const A = 'Cli Var'
  assert.equal(lote(A, [{ sku: 'V1', custo: 10 }, { sku: 'V2', custo: 10 }, { sku: 'V3', custo: 0.3 }, { sku: 'V4', custo: 1000 }]).novas, 4)
  const r = lote(A, [{ sku: 'V1', custo: 15, line: 2 }, { sku: 'V2', custo: 15.1, line: 3 }, { sku: 'V3', custo: 0.45, line: 4 }, { sku: 'V4', custo: 4.99, line: 5 }])
  assert.equal(r.alteradas, 2, '50% exato (inclusive 0,3→0,45 com ponto flutuante) não é brusca')
  assert.equal(r.em_quarentena, 2)
  assert.deepEqual(r.quarentena_lista.map(q => [q.sku, q.codigo, q.linha, q.variacao_pct]), [['V2', 'variacao_brusca', 3, 51], ['V4', 'variacao_brusca', 5, -99.5]])
  assert.match(r.quarentena_lista[0].motivo, /variação de \+51% sobre R\$ 10,00 \(limite 50%\)/)
  assert.equal(vig(A, 'V2').custo, 10); assert.equal(C.custosEfetivos(A).get('v2'), 10)
  assert.equal(C.listarQuarentena(A)[0].custo_vigente != null, true)
})

ok('custo_ge_preco usa o MENOR preço cheio entre os anúncios do SKU (preco_original, senão preco); sem anúncio, pula', () => {
  const A = 'Cli Preco'
  anuncio(A, 'MLB1', 'P1', 80, 120); anuncio(A, 'MLB2', 'p1', 90, 0); anuncio(A, 'MLB3', 'P1', 70, null)
  const r = lote(A, [{ sku: 'P1', custo: 70 }, { sku: 'SEMANUNCIO', custo: 99999 }])
  assert.equal(r.em_quarentena, 1); assert.equal(r.quarentena_lista[0].codigo, 'custo_ge_preco')
  assert.equal(C.listarQuarentena(A)[0].preco_ref, 70)
  assert.equal(r.novas, 1, 'sem anúncio conhecido a checagem é pulada')
  assert.equal(lote(A, [{ sku: 'P1', custo: 69.99 }]).novas, 1)
  C.setCfgCustos(A, { quarentena_custo_ge_preco: 0 }, 'dono')
  assert.equal(lote(A, [{ sku: 'P1', custo: 75 }]).alteradas, 1, 'desligado pelo dono')
})

ok('kit_divergente (soma vs custo próprio > 1%) e kits pendentes (kit_sem_estrutura / kit_componente_sem_custo)', () => {
  const A = 'Cli Kit'
  const r = lote(A, [{ sku: 'KIT1', custo: 20, kit_custo_proprio: 20.1 }, { sku: 'KIT2', custo: 20, kit_custo_proprio: '25.00' },
    { sku: 'KIT3', custo: null, kit_pendente: 'kit_sem_estrutura' }, { sku: 'KIT4', custo: null, kit_pendente: 'kit_componente_sem_custo', dica: 'componente C9 sem custo' }], { origem: 'sync', modo: 'completo' })
  assert.equal(r.novas, 1); assert.equal(vig(A, 'KIT1').custo, 20)
  assert.equal(r.quarentena_lista[0].codigo, 'kit_divergente'); assert.equal(C.listarQuarentena(A)[0].custo_proposto, 20, 'a soma é a proposta')
  assert.deepEqual(r.rejeitadas_lista.map(x => x.codigo), ['kit_sem_estrutura', 'kit_componente_sem_custo'])
  assert.match(r.rejeitadas_lista[1].motivo, /C9/)
  assert.equal(C.reconciliacao(A, 'kits_pendentes').total, 2)
})

ok('aprovar troca o vigente e registra histórico completo (novo→alterado→quarentena→aprovado); recusar não reabre com o mesmo valor e reabre com outro', () => {
  const A = 'Cli Decisao'
  lote(A, [{ sku: 'Q1', custo: 10 }]); lote(A, [{ sku: 'Q1', custo: 12 }])
  assert.equal(lote(A, [{ sku: 'Q1', custo: 100 }]).em_quarentena, 1)
  assert.equal(vig(A, 'Q1').custo, 12)
  assert.deepEqual(C.decidirQuarentena(A, [{ sku: 'q1', fonte: 'sheets' }, { sku: 'NADA', fonte: 'sheets' }, { sku: 'Q1', fonte: 'omie' }], 'aprovar', 'dono'), { aprovados: 1, recusados: 0, ignorados: 2 })
  assert.equal(vig(A, 'Q1').custo, 100); assert.equal(C.listarQuarentena(A).length, 0)
  assert.deepEqual(hist(A, 'Q1'), ['novo', 'alterado', 'quarentena', 'aprovado'])
  assert.equal(C.historicoSku(A, 'Q1')[0].por, 'dono')
  assert.equal(lote(A, [{ sku: 'Q1', custo: 100 }]).inalteradas, 1, 'depois de aprovado, o mesmo valor é inalterado')
  assert.equal(lote(A, [{ sku: 'Q1', custo: 5 }]).em_quarentena, 1)
  assert.deepEqual(C.decidirQuarentena(A, [{ sku: 'Q1', fonte: 'sheets' }], 'recusar', 'dono'), { aprovados: 0, recusados: 1, ignorados: 0 })
  assert.equal(vig(A, 'Q1').custo, 100); assert.equal(C.listarQuarentena(A, { estado: 'recusada' }).length, 1)
  const h = C.historicoSku(A, 'Q1').length
  const r = lote(A, [{ sku: 'Q1', custo: 5 }])
  assert.equal(r.recusado_antes, 1); assert.equal(r.em_quarentena, 0); assert.equal(C.historicoSku(A, 'Q1').length, h, 'recusado antes: ignorado em silêncio')
  assert.equal(lote(A, [{ sku: 'Q1', custo: 4 }]).em_quarentena, 1, 'valor diferente reabre')
  assert.equal(C.listarQuarentena(A)[0].custo_proposto, 4)
  assert.throws(() => C.decidirQuarentena(A, [{ sku: 'Q1', fonte: 'sheets' }], 'talvez', 'x'), e => e.status === 400)
  assert.throws(() => C.decidirQuarentena(A, [], 'aprovar', 'x'), e => e.status === 400)
})

ok('nova proposta substitui a pendente; valor aceito depois derruba a pendente; reafirmar o vigente derruba a pendente', () => {
  const A = 'Cli Subst'
  lote(A, [{ sku: 'S1', custo: 10 }]); lote(A, [{ sku: 'S1', custo: 30 }]); lote(A, [{ sku: 'S1', custo: 40 }])
  assert.equal(C.listarQuarentena(A).length, 1); assert.equal(C.listarQuarentena(A)[0].custo_proposto, 40)
  assert.equal(lote(A, [{ sku: 'S1', custo: 12 }]).alteradas, 1); assert.equal(C.listarQuarentena(A).length, 0)
  lote(A, [{ sku: 'S1', custo: 50 }]); assert.equal(C.listarQuarentena(A).length, 1)
  assert.equal(lote(A, [{ sku: 'S1', custo: 12 }]).inalteradas, 1); assert.equal(C.listarQuarentena(A).length, 0)
})

// ── inalterado, idempotência, histórico ─────────────────────────────────────────
{                                                                             // inalterado só atualiza visto_em; reaplicar o mesmo lote_id é idempotente
  const A = 'Cli Idem'
  const linhas = [{ sku: 'I1', custo: 10, line: 2 }, { sku: 'I2', custo: 10, line: 3 }, { sku: 'I3', custo: '', line: 4 }]
  const r1 = C.aplicarLote({ cliente: A, fonte: 'sheets', modo: 'parcial', lote_id: 'LOTE-1', linhas, origem: 'webhook' })
  lote(A, [{ sku: 'I2', custo: 100 }])                                       // I2 vai para quarentena
  const antes = vig(A, 'I1'), nHist = R.db.prepare('SELECT COUNT(*) n FROM erp_custos_hist WHERE cliente = ?').get(A).n
  await pausa(5)
  const r2 = C.aplicarLote({ cliente: A, fonte: 'sheets', modo: 'parcial', lote_id: 'LOTE-1', linhas, origem: 'webhook' })
  ok('mesmo lote reaplicado', () => {
    assert.equal(r1.novas, 2); assert.equal(r2.novas, 0); assert.equal(r2.inalteradas, 2); assert.equal(r2.rejeitadas, 1)
    const depois = vig(A, 'I1')
    assert.notEqual(depois.visto_em, antes.visto_em); assert.equal(depois.recebido_em, antes.recebido_em); assert.equal(depois.hash, antes.hash)
    assert.equal(R.db.prepare('SELECT COUNT(*) n FROM erp_custos_hist WHERE cliente = ?').get(A).n, nHist, 'nada novo no histórico')
    assert.equal(R.db.prepare('SELECT COUNT(*) n FROM erp_rejeitadas WHERE cliente = ?').get(A).n, 1)
  })
  ok('mesma proposta de quarentena não duplica histórico (o vigente reafirmado derrubou a anterior)', () => {
    assert.equal(C.listarQuarentena(A).length, 0)
    assert.equal(lote(A, [{ sku: 'I2', custo: 100 }]).em_quarentena, 1)
    const h = C.historicoSku(A, 'I2').length
    assert.equal(lote(A, [{ sku: 'I2', custo: 100 }]).em_quarentena, 1)
    assert.equal(C.historicoSku(A, 'I2').length, h); assert.equal(C.listarQuarentena(A).length, 1)
  })
}

// ── envio completo: nunca apaga ─────────────────────────────────────────────────
{
  const A = 'Cli Completo'
  lote(A, [{ sku: 'C1', custo: 1 }, { sku: 'C2', custo: 2 }, { sku: 'C3', custo: 3 }, { sku: 'C4', custo: '' }], { modo: 'completo' })
  await pausa(5)
  const inicio = new Date().toISOString()
  await pausa(2)
  lote(A, [{ sku: 'C1', custo: 1 }, { sku: 'C3', custo: 3.5 }], { modo: 'completo' })
  ok('sync incompleto (fecharSyncCompleto não chamado) não marca nada', () => {
    assert.equal(R.db.prepare("SELECT COUNT(*) n FROM erp_custos_sku WHERE cliente = ? AND nao_visto_desde <> ''").get(A).n, 0)
  })
  const f = C.fecharSyncCompleto(A, 'sheets', inicio)
  ok('fecharSyncCompleto marca nao_visto_desde, NÃO apaga nem zera, remove rejeitadas antigas', () => {
    assert.deepEqual(f, { nao_vistos: 1, rejeitadas_removidas: 1 })
    assert.equal(vig(A, 'C2').custo, 2); assert.equal(vig(A, 'C2').nao_visto_desde, inicio)
    assert.equal(C.custosEfetivos(A).get('c2'), 2)
    assert.equal(C.reconciliacao(A, 'nao_visto').itens[0].sku, 'C2')
    assert.equal(vig(A, 'C1').nao_visto_desde, '')
    assert.ok(C.pendenciasCustos(A).some(p => p.codigo === 'CUSTO_NAO_VISTO'))
  })
  lote(A, [{ sku: 'C2', custo: 2 }])
  ok('reaparição limpa nao_visto_desde', () => assert.equal(vig(A, 'C2').nao_visto_desde, ''))
  ok('inicioISO inválido = 400', () => assert.throws(() => C.fecharSyncCompleto(A, 'sheets', 'ontem'), e => e.status === 400))
}
{                                                                             // linha REJEITADA no completo: o SKU está na fonte (não é "não visto")
  const A = 'Cli Rejeitada Vista', sync = (linhas, lote_id) => C.aplicarLote({ cliente: A, fonte: 'bling', modo: 'completo', lote_id, origem: 'sync', linhas })
  anuncio(A, 'MLB777', 'OUTRO', 50)
  sync([{ sku: 'P2', custo: 20 }, { sku: 'P3', custo: 5 }, { sku: 'P4', custo: 6 }, { sku: 'P5', custo: 7 }], 'r1')
  await pausa(5)
  const inicio = new Date().toISOString()
  await pausa(2)
  const r = sync([{ sku: 'P2', custo: null }, { sku: 'P3', custo: 1 }, { sku: 'P3', custo: 2 }, { sku: 'P4', custo: null, kit_pendente: 'kit_componente_sem_custo' }, { sku: 'P5', mlb: 'MLB777', custo: 7 }], 'r2')
  const f = C.fecharSyncCompleto(A, 'bling', inicio)
  ok('rejeitada (vazio, duplicada, kit pendente, conflito) atualiza visto_em, mantém o custo e não vira "não visto"', () => {
    assert.equal(r.rejeitadas, 5); assert.equal(f.nao_vistos, 0)
    for (const [s, c] of [['P2', 20], ['P3', 5], ['P4', 6], ['P5', 7]]) { assert.equal(vig(A, s, 'bling').custo, c, s); assert.equal(vig(A, s, 'bling').nao_visto_desde, '', s) }
    assert.ok(!C.pendenciasCustos(A).some(p => p.codigo === 'CUSTO_NAO_VISTO'))
  })
}

// ── precedência ──────────────────────────────────────────────────────────────
ok('precedência manual > bling > tiny > sheets; ordem alterada; fonte removida; quarentena de uma fonte não conta', () => {
  const A = 'Cli Prec'
  C.aplicarLote({ cliente: A, fonte: 'sheets', modo: 'completo', lote_id: 's', origem: 'webhook', linhas: [{ sku: 'P1', custo: 4 }, { sku: 'P2', custo: 4 }, { sku: 'P3', custo: 4 }, { sku: 'P4', custo: 4 }] })
  C.aplicarLote({ cliente: A, fonte: 'tiny', modo: 'completo', lote_id: 't', origem: 'sync', linhas: [{ sku: 'P1', custo: 3, campo: 'tiny.precos.precoCusto' }, { sku: 'P2', custo: 3 }, { sku: 'P3', custo: 3 }] })
  C.aplicarLote({ cliente: A, fonte: 'bling', modo: 'completo', lote_id: 'b', origem: 'sync', linhas: [{ sku: 'P1', custo: 2, campo: 'bling.fornecedor_padrao.precoCusto', id_externo: 991 }, { sku: 'P2', custo: 2 }] })
  R.importarCustosSku(A, [{ sku: 'p1', custo: 1 }], 'colagem', 'dono')
  let m = C.custosEfetivos(A)
  assert.deepEqual([...m].sort(), [['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4]])
  const d = C.custosEfetivosDetalhe(A).itens.find(x => x.sku === 'p1')
  assert.equal(d.fonte, 'manual'); assert.equal(d.campo, 'colagem')
  assert.deepEqual(d.perdedoras.map(x => x.fonte).sort(), ['bling', 'sheets', 'tiny'])
  assert.equal(C.custosEfetivosDetalhe(A, { fonte: 'bling' }).total, 1)
  assert.equal(C.custosEfetivosDetalhe(A, { q: 'P4' }).itens[0].fonte, 'sheets')
  assert.equal(C.skuPorIdExterno(A, 'bling', '991'), 'P1'); assert.equal(C.skuPorIdExterno(A, 'bling', 'x'), null)
  C.setCfgCustos(A, { ordem_fontes: ['sheets', 'tiny', 'bling', 'manual'] }, 'dono')
  m = C.custosEfetivos(A); assert.equal(m.get('p1'), 4); assert.equal(m.get('p3'), 4)
  C.setCfgCustos(A, { ordem_fontes: ['bling', 'tiny'] }, 'dono')
  m = C.custosEfetivos(A); assert.equal(m.get('p1'), 2); assert.equal(m.get('p3'), 3); assert.equal(m.has('p4'), false, 'fonte fora da lista não é consumida (nem o manual)')
  C.setCfgCustos(A, { ordem_fontes: '["manual","bling","tiny","sheets"]' }, 'dono')
  assert.equal(C.aplicarLote({ cliente: A, fonte: 'bling', modo: 'parcial', lote_id: 'b2', origem: 'fila', linhas: [{ sku: 'P3', custo: 50 }] }).novas, 1)
  assert.equal(C.aplicarLote({ cliente: A, fonte: 'bling', modo: 'parcial', lote_id: 'b3', origem: 'fila', linhas: [{ sku: 'P3', custo: 500 }] }).em_quarentena, 1)
  assert.equal(C.custosEfetivos(A).get('p3'), 50, 'vigente do bling vence; a quarentena do bling não existe como vigente')
  assert.equal(C.descartarCusto(A, 'p3', 'bling', 'dono').custo_antes, 50)
  assert.equal(C.custosEfetivos(A).get('p3'), 3, 'descartado: volta para a próxima fonte')
  assert.equal(hist(A, 'P3').at(-1), 'descartado')
  assert.throws(() => C.descartarCusto(A, 'p3', 'bling', 'dono'), e => e.status === 404)
  assert.throws(() => C.descartarCusto(A, 'p3', 'manual', 'dono'), e => e.status === 400)
})

ok('custosEfetivos ignora custo ≤ 0 / não numérico mesmo inserido por fora (camada manual) e cai para a próxima fonte', () => {
  const A = 'Cli Fora'
  R.db.prepare("INSERT INTO promo_custos_sku (cliente, sku, custo, fonte, atualizado_em) VALUES (?, 'Z1', 0, 'x', 't'), (?, 'Z2', -3, 'x', 't'), (?, 'Z3', 'abc', 'x', 't')").run(A, A, A)
  lote(A, [{ sku: 'Z1', custo: 9 }])
  const m = C.custosEfetivos(A)
  assert.equal(m.get('z1'), 9); assert.equal(m.has('z2'), false); assert.equal(m.has('z3'), false)
})

ok('custosEfetivos é drop-in do Map antigo (mesmas chaves e valores sem ERP)', () => {
  const A = 'Cli DropIn'
  R.importarCustosSku(A, [{ sku: 'Abc', custo: 10 }, { sku: 'DEF-02', custo: 2.5 }], 'colagem', 'dono')
  const antigo = new Map(R.listarCustosSku(A).map(c => [String(c.sku).toLowerCase(), c.custo]))
  assert.deepEqual([...C.custosEfetivos(A)].sort(), [...antigo].sort())
})

// ── ganchos em promocoes-db.js ───────────────────────────────────────────────────
ok('importarCustosSku grava "manual" no histórico (com proveniência) sem mudar o retorno; mesmo valor não repete', () => {
  const A = 'Cli Manual'
  assert.equal(R.importarCustosSku(A, [{ sku: 'M\u00A01', custo: 10 }, { sku: 'M2', custo: 5 }], 'colagem', 'dono'), 2)
  assert.equal(R.importarCustosSku(A, [{ sku: 'M\u00A01', custo: 10 }, { sku: 'M2', custo: 7.5 }], 'planilha', 'dono'), 2)
  const h = C.historicoSku(A, 'M 1')
  assert.equal(h.length, 1, 'chave do gancho = chaveSku (NBSP normalizado)'); assert.equal(h[0].fonte, 'manual'); assert.equal(h[0].evento, 'manual'); assert.equal(h[0].campo, 'colagem')
  const h2 = C.historicoSku(A, 'm2')
  assert.deepEqual(h2.map(x => [x.custo_antes, x.custo_depois, x.variacao_pct, x.campo, x.por]), [[5, 7.5, 50, 'planilha', 'dono'], [null, 5, null, 'colagem', 'dono']])
  assert.deepEqual(Object.fromEntries(R.listarCustosSku(A).map(c => [c.sku, c.custo])), { 'M\u00A01': 10, M2: 7.5 })
})

ok('limparPromocoesDoCliente (troca de conta ML) preserva custos/histórico/quarentena/config e limpa conflito_sku_mlb, mlb_sem_sku e mlb_dica', () => {
  const A = 'Cli Troca'
  anuncio(A, 'MLB10', 'T1', 100)
  lote(A, [{ sku: 'T1', mlb: 'MLB10', custo: 10 }, { sku: 'T9', mlb: 'MLB10', custo: 10 }, { mlb: 'MLB77', custo: 3 }, { sku: 'T2', custo: '' }])
  lote(A, [{ sku: 'T1', mlb: 'MLB10', custo: 99 }])                          // quarentena (variação e ≥ preço)
  C.setCfgCustos(A, { limiar_variacao_pct: 30 }, 'dono')
  R.importarCustosSku(A, [{ sku: 'T3', custo: 1 }], 'colagem', 'dono')
  const nHist = R.db.prepare('SELECT COUNT(*) n FROM erp_custos_hist WHERE cliente = ?').get(A).n
  R.limparPromocoesDoCliente(A, 'teste')
  assert.equal(vig(A, 'T1').custo, 10); assert.equal(vig(A, 'T1').mlb_dica, '')
  assert.equal(C.listarQuarentena(A)[0].mlb_dica, '')
  assert.equal(R.db.prepare('SELECT COUNT(*) n FROM erp_custos_hist WHERE cliente = ?').get(A).n, nHist)
  assert.deepEqual(R.db.prepare('SELECT codigo FROM erp_rejeitadas WHERE cliente = ?').all(A).map(r => r.codigo), ['custo_ausente'])
  assert.equal(C.getCfgCustos(A).limiar_variacao_pct, 30)
  assert.equal(C.custosEfetivos(A).get('t3'), 1)
  assert.equal(R.db.prepare('SELECT COUNT(*) n FROM promo_anuncio WHERE cliente = ?').get(A).n, 0)
})

// ── isolamento ───────────────────────────────────────────────────────────────
ok('dados de cada cliente separados (vigente, quarentena, rejeitadas, config, histórico)', () => {
  const A = 'Iso A', B = 'Iso B'
  lote(A, [{ sku: 'SAME', custo: 10 }, { sku: 'RJ', custo: 0 }]); lote(B, [{ sku: 'SAME', custo: 20 }])
  lote(A, [{ sku: 'SAME', custo: 100 }])
  C.setCfgCustos(B, { ordem_fontes: ['tiny'] }, 'dono')
  assert.equal(C.custosEfetivos(A).get('same'), 10); assert.equal(C.custosEfetivos(B).has('same'), false)
  assert.equal(C.listarQuarentena(B).length, 0); assert.equal(C.listarQuarentena(A).length, 1)
  assert.equal(C.reconciliacao(B, 'rejeitadas').total, 0)
  assert.deepEqual(C.getCfgCustos(A).ordem_fontes, ['manual', 'upload', 'bling', 'tiny', 'sheets'])
  assert.equal(C.historicoSku(B, 'SAME').length, 1)
  assert.equal(C.decidirQuarentena(B, [{ sku: 'SAME', fonte: 'sheets' }], 'aprovar', 'x').ignorados, 1, 'B não decide a quarentena de A')
  assert.equal(vig(A, 'SAME').custo, 10)
})

// ── impacto nas aprovações ─────────────────────────────────────────────────────
ok('impacto conta SKU alterado com aprovação de promoção (aprovado=1 e marcado=1) e audita', () => {
  const A = 'Cli Impacto'
  anuncio(A, 'MLB5', 'IMP', 500); anuncio(A, 'MLB6', 'NAOAP', 500)
  R.db.prepare("INSERT INTO promo_decisao (cliente, item_id, pid, origem, marcado, aprovado, em) VALUES (?, 'MLB5', 'P-1', 'analista', 1, 1, 't'), (?, 'MLB6', 'P-1', 'analista', 1, 0, 't')").run(A, A)
  assert.equal(lote(A, [{ sku: 'imp', custo: 10 }, { sku: 'NAOAP', custo: 10 }]).impacto.skus_com_aprovacao_afetada, 1)
  assert.equal(lote(A, [{ sku: 'IMP', custo: 10 }]).impacto.skus_com_aprovacao_afetada, 0, 'inalterado não afeta')
  assert.match(R.listarAuditoria(A, { evento: 'custos_lote' })[1].detalhe, /1 SKU\(s\) com aprovação de promoção afetada/)
})

// ── reconciliação ──────────────────────────────────────────────────────────────
ok('reconciliação: listas, cobertura e disponivel=false sem promo_anuncio', () => {
  const A = 'Cli Recon'
  let r = C.reconciliacao(A, 'anuncio_sem_custo')
  assert.equal(r.disponivel, false); assert.match(r.motivo, /coleta de promoções/); assert.deepEqual(r.itens, [])
  assert.equal(C.reconciliacao(A, 'rejeitadas').disponivel, true)
  assert.throws(() => C.reconciliacao(A, 'tudo'), e => e.status === 400)
  anuncio(A, 'MLB1', 'R1', 100, null, 600); anuncio(A, 'MLB2', '', 100, null, 300); anuncio(A, 'MLB3', 'R3', 100, null, 100); anuncio(A, 'MLB4', 'R\u00A01', 100, null, 0)
  lote(A, [{ sku: 'r1', custo: 10 }, { sku: 'SOBRA', custo: 1 }, { sku: 'X', mlb: 'MLB1', custo: 5 }])
  C.aplicarLote({ cliente: A, fonte: 'tiny', modo: 'parcial', lote_id: 't', origem: 'sync', linhas: [{ sku: 'R1', custo: 11 }] })
  r = C.reconciliacao(A, 'anuncio_sem_custo')
  // plano §4 (resolução única): SKU do ML com NBSP casa pelo SKU NORMALIZADO (chave única), igual ao consumidor — antes ficava sem custo
  assert.deepEqual(r.itens.map(a => a.item_id), ['MLB3'])
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB4', sku: 'R\u00A01' }).origem, 'sku_normalizado')
  assert.deepEqual(r.cobertura, { anuncios_total: 4, anuncios_sem_sku: 1, anuncios_sem_custo: 1, cobertura_receita_pct: 60 })
  assert.deepEqual(C.reconciliacao(A, 'anuncio_sem_sku').itens.map(a => a.item_id), ['MLB2'])
  assert.deepEqual(C.reconciliacao(A, 'sku_erp_sem_anuncio').itens.map(a => a.sku), ['SOBRA'])
  assert.equal(C.reconciliacao(A, 'conflito').itens[0].codigo, 'conflito_sku_mlb')
  const dv = C.reconciliacao(A, 'divergencia_fontes').itens
  assert.equal(dv.length, 1); assert.equal(dv[0].efetiva, 11)
  assert.equal(C.reconciliacao(A, 'rejeitadas', { limite: 1 }).itens.length, 1)
  const res = C.resumoCustos(A)
  assert.equal(res.efetivo.skus_com_custo, 2); assert.deepEqual(res.efetivo.por_fonte, { manual: 0, upload: 0, bling: 0, tiny: 1, sheets: 1 })
  assert.equal(res.efetivo.cobertura_receita_pct, 60); assert.equal(res.reconciliacao_disponivel, true)
  assert.equal(res.fontes.sheets.contagens.skus, 2); assert.equal(res.fontes.sheets.contagens.rejeitadas, 1)
})

// ── estado da fonte e frescor ──────────────────────────────────────────────────
ok('pendências de frescor por fonte (ERP 3 dias, planilha 14), erro, reautorizar, quarentena, rejeitadas', () => {
  const A = 'Cli Fresco', agoraMs = Date.parse('2026-10-05T12:00:00Z'), dia = 86400e3, iso = ms => new Date(ms).toISOString()
  assert.deepEqual(C.pendenciasCustos(A, agoraMs), [], 'tudo desconectado: nada a cobrar')
  C.gravarEstadoFonte(A, 'sheets', { estado: 'conectado', ultimo_sync_ok_em: iso(agoraMs - 13.9 * dia) })
  C.gravarEstadoFonte(A, 'bling', { estado: 'conectado', ultimo_sync_ok_em: iso(agoraMs - 2.9 * dia) })
  C.gravarEstadoFonte(A, 'tiny', { estado: 'conectado' })
  let p = C.pendenciasCustos(A, agoraMs)
  assert.deepEqual(p.map(x => x.codigo), ['CUSTO_FONTE_VELHA'], 'tiny conectado que nunca sincronizou é velho')
  assert.match(p[0].texto, /Tiny nunca sincronizaram/)
  C.gravarEstadoFonte(A, 'sheets', { ultimo_sync_ok_em: iso(agoraMs - 14.1 * dia) })
  C.gravarEstadoFonte(A, 'bling', { ultimo_sync_ok_em: iso(agoraMs - 3.1 * dia), estado: 'erro', ultimo_erro: 'falhou: Bearer abc.def access_token=XYZ123' })
  C.gravarEstadoFonte(A, 'tiny', { estado: 'reautorizar', ultimo_sync_ok_em: iso(agoraMs) })
  p = C.pendenciasCustos(A, agoraMs)
  assert.deepEqual(p.map(x => x.codigo).sort(), ['CUSTO_FONTE_ERRO', 'CUSTO_FONTE_VELHA', 'CUSTO_FONTE_VELHA', 'CUSTO_REAUTORIZAR'])
  assert.ok(!JSON.stringify(p).includes('abc.def') && !JSON.stringify(p).includes('XYZ123'), 'erro sanitizado')
  assert.ok(p.every(x => x.codigo && x.estado && x.texto))
  const res = C.resumoCustos(A, agoraMs)
  assert.equal(res.fontes.sheets.velha, true); assert.equal(res.fontes.sheets.idade_dias, 14.1); assert.equal(res.fontes.tiny.velha, false)
  C.setCfgCustos(A, { velho_dias_sheets: 20, velho_dias_erp: 5 }, 'dono')
  assert.equal(C.pendenciasCustos(A, agoraMs).filter(x => x.codigo === 'CUSTO_FONTE_VELHA').length, 0)
  C.gravarEstadoFonte(A, 'bling', { estado: 'pausado' }); C.gravarEstadoFonte(A, 'tiny', { estado: 'desconectado' })
  lote(A, [{ sku: 'F1', custo: 1 }, { sku: 'F2', custo: 'x' }]); lote(A, [{ sku: 'F1', custo: 9 }])
  assert.deepEqual(C.pendenciasCustos(A, agoraMs).map(x => x.codigo), ['CUSTO_QUARENTENA', 'CUSTO_REJEITADO'])
  assert.throws(() => C.gravarEstadoFonte(A, 'sheets', { estado: 'feliz' }), e => e.status === 400)
  assert.throws(() => C.gravarEstadoFonte(A, 'sheets', { segredo: 'x' }), e => e.status === 400)
  assert.equal(C.estadoFonte('Ninguem', 'tiny').estado, 'desconectado')
})

ok('lote do webhook marca a fonte viva (ultimo_sync_ok_em); sync/fila não (quem fecha a varredura é o orquestrador)', () => {
  const A = 'Cli Vivo'
  C.aplicarLote({ cliente: A, fonte: 'tiny', modo: 'completo', lote_id: 'x', origem: 'sync', linhas: [{ sku: 'A', custo: 1 }] })
  assert.equal(C.estadoFonte(A, 'tiny').ultimo_sync_ok_em, '')
  lote(A, [{ sku: 'A', custo: '' }])
  assert.equal(C.estadoFonte(A, 'sheets').estado, 'conectado'); assert.ok(C.estadoFonte(A, 'sheets').ultimo_sync_ok_em)
})

// ── config, argumentos, poda, log ───────────────────────────────────────────────
ok('setCfgCustos valida tipos, rejeita desconhecido e audita; getCfgCustos devolve defaults do dono', () => {
  const A = 'Cli Cfg'
  assert.deepEqual(C.getCfgCustos(A).ordem_fontes, ['manual', 'upload', 'bling', 'tiny', 'sheets'])
  assert.equal(C.getCfgCustos(A).limiar_variacao_pct, 50); assert.equal(C.getCfgCustos(A).campo_custo_tiny, 'preco_custo')
  for (const p of [{ ordem_fontes: ['bling', 'bling'] }, { ordem_fontes: ['omie'] }, { ordem_fontes: 'x' }, { limiar_variacao_pct: 0 }, { limiar_variacao_pct: true }, { velho_dias_erp: 1.5 },
    { campo_custo_tiny: 'medio' }, { quarentena_custo_ge_preco: 2 }, { qualquer: 1 }, null, []])
    assert.throws(() => C.setCfgCustos(A, p, 'x'), e => e.status === 400, JSON.stringify(p))
  const c = C.setCfgCustos(A, { limiar_variacao_pct: '30,5', campo_custo_tiny: 'custo_medio', quarentena_custo_ge_preco: false }, 'dono')
  assert.equal(c.limiar_variacao_pct, 30.5); assert.equal(c.campo_custo_tiny, 'custo_medio'); assert.equal(c.quarentena_custo_ge_preco, 0)
  assert.equal(R.listarAuditoria(A, { evento: 'custos_config' })[0].autor, 'dono')
})

ok('argumentos inválidos do aplicarLote lançam 400 (erro de programação), linha ruim nunca', () => {
  const base = { cliente: 'Cli Arg', fonte: 'sheets', modo: 'parcial', lote_id: 'a', linhas: [], origem: 'webhook' }
  for (const p of [{ fonte: 'manual' }, { fonte: 'omie' }, { modo: 'x' }, { origem: 'x' }, { linhas: null }, { cliente: '' }])
    assert.throws(() => C.aplicarLote({ ...base, ...p }), e => e.status === 400, JSON.stringify(p))
  assert.equal(C.aplicarLote({ ...base, linhas: [undefined, 5, [], { sku: 'OBJ', custo: { valueOf: () => 3 } }] }).rejeitadas, 4)
})

ok('podarCustos: histórico > 24 meses, lotes > 30 dias, eventos > 7 dias, state > 1 dia, rejeitadas acima de 5.000', () => {
  const A = 'Cli Poda', agoraMs = Date.parse('2026-10-05T00:00:00Z')
  const ins = (em) => R.db.prepare("INSERT INTO erp_custos_hist (cliente, sku_key, sku, fonte, evento, em) VALUES (?, 'a', 'a', 'sheets', 'novo', ?)").run(A, em)
  ins('2024-10-04T00:00:00.000Z'); ins('2024-10-06T00:00:00.000Z')
  R.db.prepare("INSERT INTO erp_lotes (cliente, fonte, lote_id, corpo_hash, resumo_json, recebido_em) VALUES (?, 'sheets', 'v', 'h', '{}', '2026-09-01T00:00:00Z'), (?, 'sheets', 'n', 'h', '{}', '2026-09-20T00:00:00Z')").run(A, A)
  R.db.prepare("INSERT INTO erp_eventos_vistos (fonte, evento_id, em) VALUES ('bling', 'e1', '2026-09-27T00:00:00Z'), ('bling', 'e2', '2026-10-01T00:00:00Z')").run()
  R.db.prepare("INSERT INTO erp_oauth_state (nonce, cliente, fonte, criado_em) VALUES ('n1', ?, 'tiny', '2026-10-03T00:00:00Z'), ('n2', ?, 'tiny', '2026-10-04T12:00:00Z')").run(A, A)
  const rj = R.db.prepare("INSERT INTO erp_rejeitadas (cliente, fonte, chave, codigo, motivo, em) VALUES (?, 'tiny', ?, 'custo_ausente', 'm', ?)")
  R.db.transaction(() => { for (let i = 0; i < 5003; i++) rj.run(A, `linha:${i}`, new Date(agoraMs - i * 1000).toISOString()) })()
  const r = C.podarCustos(agoraMs)
  assert.deepEqual(r, { historico: 1, lotes: 1, eventos: 1, oauth_state: 1, rejeitadas: 3 })
  assert.equal(R.db.prepare("SELECT COUNT(*) n FROM erp_rejeitadas WHERE cliente = ? AND chave IN ('linha:0','linha:5002')").get(A).n, 1, 'fica a mais nova')
})

ok('log injetado só leva contagens (nunca SKU, custo ou corpo)', () => {
  assert.ok(logs.length > 10)
  assert.ok(logs.every(l => !/SAME|IMP|R\$|"sku"/.test(l)), logs.find(l => /SAME|IMP|R\$|"sku"/.test(l)))
})

console.log(`✔ teste-custos-nucleo: ${n} verificações OK`)
