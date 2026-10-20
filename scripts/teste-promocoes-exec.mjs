process.env.PS_PROMO_MEMORIA = '1'                       // ANTES de qualquer import: o banco é em memória, nunca data/db.sqlite
// Regressão da frente EXEC (plano, aprovação, executor, recusas humanas). Cada caso FALHARIA no código antigo.
// Sem rede: toda API é stub (GET de leitura + POST gravado em memória); nada chama o Mercado Livre.
import assert from 'node:assert/strict'
const R = await import('../src/lib/promocoes-db.js')
const P = await import('../src/lib/promocoes-plano.js')
const X = await import('../src/lib/promocoes-exec.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const HOJE = '2026-10-05'
const auds = (cliente, evento) => R.listarAuditoria(cliente, { evento, limite: 1000 })

// ── stubs ───────────────────────────────────────────────────────────────────────────────────────────
const raw = (pid, o = {}) => ({ id: pid, type: 'SMART', ref_id: `OFF-${pid}`, status: 'candidate', price: 100, original_price: 120, meli_percentage: 5, name: `Camp ${pid}`, ...o })
function criarMl(vivas, { falhaPrices = false, aoPost = null } = {}) {
  const log = { posts: [] }
  const api = async (metodo, caminho, corpo) => {
    if (metodo === 'GET') {
      let m
      if ((m = caminho.match(/^\/seller-promotions\/items\/(MLB\d+)\?app_version=v2$/))) return vivas[m[1]] === 503 ? { status: 503, erro: true, corpo: 'indisponível' } : { status: 200, corpo: vivas[m[1]] }     // vivas[id] = 503: a leitura ao vivo falha
      if (/^\/items\/MLB\d+\/prices$/.test(caminho)) { if (falhaPrices) throw new Error('fetch failed'); return { status: 200, corpo: { prices: [{ amount: 120, type: 'standard', conditions: {} }] } } }
      assert.fail(`GET inesperado: ${caminho}`)
    }
    assert.equal(metodo, 'POST', 'só GET e POST de entrada')
    assert.match(caminho, /^\/seller-promotions\/items\/MLB\d+\?app_version=v2$/)
    log.posts.push({ caminho, corpo }); aoPost?.(caminho, corpo)
    return { status: 200, corpo: '{}' }
  }
  return Object.assign(api, { log })
}
const depsDe = ml => ({ api: ml, chamar: async (_c, caminho) => (await ml('GET', caminho)).corpo, espera: 0, esperaReadback: 0, custosCliente: null, hoje: HOJE })

// anúncios com custo 45, imposto 10%, comissão 15%, frete 10 => MC viva a R$ 100 (original 120, rebate 5%) = 26%
const anuncio = (cliente, id) => R.db.prepare(`INSERT INTO promo_anuncio (cliente, item_id, sku, titulo, status, preco, preco_original, tarifa_json, lido_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(cliente, id, `${id}-SKU`, `Anúncio ${id}`, 'active', 100, 120, JSON.stringify({ comissao_pct: 15, taxa_fixa: 0, frete: 10 }), '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z')
async function preparar(cliente, { itens = ['MLB1'], vivas, maxItens = 5, antes = null, aprovar = true } = {}) {
  for (const id of itens) anuncio(cliente, id)
  R.importarCustosSku(cliente, itens.map(id => ({ sku: `${id}-SKU`, custo: 45 })), 't')
  R.setConfig(cliente, { imposto_pct: 10, execucao_habilitada: 1, execucao_max_itens: maxItens })
  for (const id of itens) R.marcarHumano(cliente, { item_id: id, pid: 'P1', marcado: true, preco: 100, mc_pct: 26, offer_id: 'OFF-P1' }, 'dono')
  antes?.(cliente)
  const ml = criarMl(vivas), deps = depsDe(ml)
  const plano = await P.gerarPlano(cliente, { por: 'dono', deps })
  if (aprovar) P.aprovarPlano(cliente, plano.id, 'dono')
  return { ml, deps, plano }
}
const executar = (cliente, planoId, deps, extra = {}) => X.executarPlano(cliente, planoId, { confirmar: true, por: 'dono', deps, ...extra })
const entram = plano => plano.itens.filter(i => i.acao === 'ENTRAR').map(i => `${i.pid}${i.hedge ? '*' : ''}`)

// ═══ idx 1 — o executor só envia o que está no plano aprovado (hedge/oferta nova ao vivo = nao_enviada) ═══
await okA('idx1: hedge e ofertas novas ao vivo FORA do plano aprovado não são enviadas', async () => {
  const vivas = { MLB1: [raw('P1')] }
  const { ml, deps, plano } = await preparar('Exec A', { vivas })
  assert.deepEqual(entram(plano), ['P1'])
  vivas.MLB1 = [raw('P1'), raw('P2'), raw('P3')]                                    // depois da aprovação o ML lista campanhas novas, mesmo preço e rebate
  const r = await executar('Exec A', plano.id, deps)
  assert.deepEqual(ml.log.posts.map(p => p.corpo.promotion_id), ['P1'], 'só a chamada aprovada sai')
  const fora = r.chamadas.filter(c => c.fora_do_plano)
  assert.deepEqual(fora.map(c => c.pid).sort(), ['P2', 'P3']); assert.ok(fora.every(c => c.estado_final === 'nao_enviada' && /novo plano/.test(c.resposta)))
  assert.equal(R.lerPlano('Exec A', plano.id).estado, 'executado')
})

// ═══ idx 2 — relâmpago SMART: trilha painel é SEMPRE pulada; o nome vivo é completado pela campanha ═══
await okA('idx2: via painel => PULAR sempre; oferta viva sem nome é completada pela campanha antes do relâmpago', async () => {
  const base = { cliente: 'M', vivasPorItem: new Map([['MLB1', { ok: true, ofertas: [{ pid: 'PREL', offer_id: 'O', tipo: 'SMART', nome: '', status: 'candidate', preco: 100, preco_original: 120, meli_pct: 5 }] }]]),
    anuncios: new Map([['MLB1', { item_id: 'MLB1', sku: 'S', titulo: 'T', tarifa: { comissao_pct: 15, taxa_fixa: 0, frete: 10 } }]]), custosSku: new Map([['s', 45]]), config: { imposto_pct: 10 } }
  const painel = P.montarPlano({ ...base, decisoes: [{ item_id: 'MLB1', pid: 'PREL', origem: 'analista', marcado: true, regra: 'RELAMPAGO', via: 'painel', preco: 100, mc_pct: 26 }] })
  assert.equal(painel.itens[0].acao, 'PULAR'); assert.equal(painel.itens[0].motivo, 'relampago_smart_painel'); assert.equal(painel.resumo.entrar, 0)
  // gerarPlano: oferta SEM nome + campanha 'Relâmpago' na coleta => PULAR (antes: ENTRAR, POST pela API)
  const { plano } = await preparar('Exec B', { vivas: { MLB1: [raw('P1', { name: '' })] }, aprovar: false, antes: c => R.db.prepare(`INSERT INTO promo_campanha (cliente, pid, tipo, nome, atualizado_em) VALUES (?,?,?,?,?)`).run(c, 'P1', 'SMART', 'OFERTAS RELÂMPAGOS Outubro', '2026-10-05T10:00:00Z') })
  assert.equal(plano.itens[0].motivo, 'relampago_smart_painel'); assert.equal(plano.resumo.entrar, 0)
})

// ═══ idx 6 — marcasEfetivas: a recusa 👤 e a marca 👤 vencem a aprovação do analista ═══
const linha = (pid, o = {}) => ({ item_id: 'MLB1', pid, marcado: true, regra: 'R2', via: 'api', preco: 100, mc_pct: 31, mc: 31, meli_pct: 5, offer_id: `O-${pid}`, ...o })
await okA('idx6: recusa 👤 posterior e marca 👤 no mesmo anúncio vencem a aprovação 🤖', () => {
  const c = 'Ef 1'
  R.substituirDecisoesAnalista(c, [linha('A')], 'r1'); assert.equal(R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'A' }], 'dono'), 1)
  assert.deepEqual(R.marcasEfetivas(c).map(d => d.pid), ['A'])
  R.marcarHumano(c, { item_id: 'MLB1', pid: 'A', marcado: false }, 'dono')            // o dono recusa depois de aprovar
  assert.deepEqual(R.marcasEfetivas(c), [], 'recusa vence')
  assert.equal(R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'A' }], 'dono'), 0, 'recusado não vira aprovação'); assert.equal(auds(c, 'aprova_analista_bloqueada').length, 1)
  R.marcarHumano(c, { item_id: 'MLB1', pid: 'A', marcado: null }, 'dono')             // limpar a recusa devolve a decisão ao analista
  assert.deepEqual(R.marcasEfetivas(c).map(d => d.pid), ['A'])
  R.marcarHumano(c, { item_id: 'MLB1', pid: 'B', marcado: true, preco: 100 }, 'dono')  // marca 👤 em OUTRA campanha do anúncio: humano manda, uma marcação por anúncio
  assert.deepEqual(R.marcasEfetivas(c).map(d => `${d.origem}:${d.pid}`), ['humano:B'])
})

// ═══ idx 10 / 16 / 21 — aprovação vale para os NÚMEROS aprovados ═══
await okA('idx10/16: rodada com preço/MC novos REVOGA a aprovação (com auditoria); números iguais mantêm', () => {
  const c = 'Ef 2'
  R.substituirDecisoesAnalista(c, [linha('C1')], 'r1'); R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'C1' }], 'dono')
  R.substituirDecisoesAnalista(c, [linha('C1')], 'r2')
  assert.deepEqual(R.marcasEfetivas(c).map(d => `${d.pid}:${d.preco}:${d.mc_pct}`), ['C1:100:31'], 'mesmos números: aprovação mantida')
  const out = R.substituirDecisoesAnalista(c, [linha('C1', { preco: 82, mc_pct: 21.34 })], 'r3')
  assert.equal(out.aprovacoes_revogadas, 1); assert.deepEqual(R.marcasEfetivas(c), [], 'número novo não herda a aprovação')
  const d = R.lerDecisoes(c).find(x => x.pid === 'C1'); assert.equal(d.aprovado, false); assert.equal(d.aprovado_por, '')
  const rev = auds(c, 'aprovacao_revogada'); assert.equal(rev.length, 1); assert.equal(rev[0].antes.preco, 100); assert.equal(rev[0].depois.preco, 82); assert.match(rev[0].detalhe, /recalculou/)
  R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'C1' }], 'dono')                       // aprova os números novos; campanha que some da rodada também perde a aprovação
  R.substituirDecisoesAnalista(c, [linha('OUTRA')], 'r4')
  assert.deepEqual(R.marcasEfetivas(c), []); assert.equal(auds(c, 'aprovacao_revogada').length, 2)
  R.substituirDecisoesAnalista(c, [linha('OUTRA')], 'r5'); R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'OUTRA' }], 'dono')
  R.substituirDecisoesAnalista(c, [linha('OUTRA', { via: 'painel' })], 'r6'); assert.deepEqual(R.marcasEfetivas(c), [], 'trocar a trilha (api→painel) também revoga')
})
await okA('idx21: o executor usa o baseline do PLANO aprovado — re-marcar depois não reescreve a margem aprovada', async () => {
  const c = 'Exec C', vivas = { MLB1: [raw('P1')] }
  const { ml, deps, plano } = await preparar(c, { vivas })
  assert.equal(R.lerPlano(c, plano.id).itens[0].aprovado.mc_pct, 26)
  assert.deepEqual(Object.keys(R.lerPlano(c, plano.id).itens[0].aprovado).sort(), ['mc_pct', 'offer_id', 'pid', 'preco'])
  R.importarCustosSku(c, [{ sku: 'MLB1-SKU', custo: 60 }], 't')                         // custo sobe: MC viva cai para 11%
  R.marcarHumano(c, { item_id: 'MLB1', pid: 'P1', marcado: true, preco: 100, mc_pct: 11, offer_id: 'x' }, 'outra pessoa')     // alguém re-marca com a MC nova
  const r = await executar(c, plano.id, deps)
  assert.equal(ml.log.posts.length, 0, 'MC viva 11% < aprovada 26%: nada é enviado'); assert.match(r.chamadas[0].resposta, /precheck_margem/)
  // adulterar o baseline guardado no plano quebra o hash
  const c2 = 'Exec C2', { deps: d2, plano: p2 } = await preparar(c2, { vivas: { MLB1: [raw('P1')] } })
  const itens = R.lerPlano(c2, p2.id).itens; itens[0].aprovado.mc_pct = 1
  R.db.prepare('UPDATE promo_plano SET itens_json = ? WHERE id = ?').run(JSON.stringify(itens), p2.id)
  await assert.rejects(executar(c2, p2.id, d2), /hash não confere/)
})

// ═══ idx 19 — recusa 👤, IGNORAR e Revisar-toda-rodada são vinculantes para o hedge ═══
await okA('idx19: o hedge não entra em campanha recusada nem em anúncio barrado pelo dono', async () => {
  const vivas = { MLB1: [raw('P1'), raw('P2'), raw('P3')] }
  const { plano } = await preparar('Hedge 1', { vivas, aprovar: false, antes: c => R.marcarHumano(c, { item_id: 'MLB1', pid: 'P3', marcado: false }, 'dono') })
  assert.deepEqual(entram(plano), ['P1', 'P2*'], 'P3 foi recusada pelo dono')
  const ign = await preparar('Hedge 2', { vivas, aprovar: false, antes: c => R.registrarAprendizado(c, { acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'não mexer' }, 'dono') })
  assert.deepEqual(entram(ign.plano), ['P1'], 'IGNORAR: a marca 👤 explícita vale, o hedge não')
  const rev = await preparar('Hedge 3', { vivas, aprovar: false, antes: c => R.salvarRegraSku(c, { sku: 'MLB1-SKU', status: 'Revisar toda rodada' }, 'dono') })
  assert.deepEqual(entram(rev.plano), ['P1'], 'Revisar toda rodada: idem')
  // contrato único: recusasHumanas
  const b = R.recusasHumanas('Hedge 1'); assert.ok(b.pares.has('MLB1|P3')); assert.equal(b.bloqueado('MLB1', 'P3'), true); assert.equal(b.bloqueado('MLB1', 'P2'), false)
  const bi = R.recusasHumanas('Hedge 3'); assert.ok(bi.itens.has('MLB1')); assert.equal(bi.bloqueado('MLB1', 'P9'), true); assert.equal(bi.bloqueado('MLB1', 'P9', 'humano'), false)
  // marca 🤖 aprovada em anúncio barrado não é efetiva
  const c = 'Hedge 4'; R.substituirDecisoesAnalista(c, [linha('A')], 'r1'); R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'A' }], 'dono')
  R.registrarAprendizado(c, { acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'não mexer' }, 'dono'); assert.deepEqual(R.marcasEfetivas(c), [])
  // e a recusa feita DEPOIS do plano aprovado barra a entrada no executor
  const e = await preparar('Hedge 5', { vivas: { MLB1: [raw('P1')] } })
  R.marcarHumano('Hedge 5', { item_id: 'MLB1', pid: 'P1', marcado: false }, 'dono')
  const r = await executar('Hedge 5', e.plano.id, e.deps)
  assert.equal(e.ml.log.posts.length, 0); assert.match(r.chamadas[0].resposta, /recusado_pelo_dono/)
})

// ═══ idx 20 — claim atômico, falha no meio grava parcial, sem reenvio na janela de propagação ═══
await okA('idx20: claim atômico; GET de prices que falha não derruba; falha no meio grava resultado parcial; plano novo não reenvia', async () => {
  const c0 = 'Exec D0', pre = await preparar(c0, { vivas: { MLB1: [raw('P1')] } })
  assert.equal(R.reivindicarPlano(c0, pre.plano.id), true); assert.equal(R.reivindicarPlano(c0, pre.plano.id), false, 'só uma execução por plano')
  await assert.rejects(executar(c0, pre.plano.id, pre.deps), /só plano APROVADO/); assert.equal(pre.ml.log.posts.length, 0)
  // GET /prices que lança: o POST segue e o resultado fica gravado
  const c1 = 'Exec D1', vivas1 = { MLB1: [raw('P1')] }, p1 = await preparar(c1, { vivas: vivas1 })
  const ml1 = criarMl(vivas1, { falhaPrices: true }), r1 = await executar(c1, p1.plano.id, depsDe(ml1))
  assert.equal(ml1.log.posts.length, 1); assert.equal(r1.chamadas[0].antes_preco, null); assert.equal(R.lerPlano(c1, p1.plano.id).estado, 'executado')
  assert.equal(X.precosResumo({ prices: {} }), null, 'corpo fora do formato = baseline desconhecido (não lança depois do POST)')
  assert.equal(X.avaliarProvaPrecos(null, [{ amount: 90, type: 'promotion', fim: 'y' }], 90).provado, false, 'sem baseline conhecido nada se prova por preço')
  // falha no meio (depois do POST): o plano NÃO fica 'aprovado' e o que foi enviado não se perde
  const c2 = 'Exec D2', vivas2 = { MLB1: [raw('P1')] }, p2 = await preparar(c2, { vivas: vivas2 })
  const queda = { valueOf() { throw new Error('queda no meio') } }
  await assert.rejects(executar(c2, p2.plano.id, { ...p2.deps, esperaReadback: queda }), /queda no meio/)
  const gravado = R.lerPlano(c2, p2.plano.id)
  assert.equal(gravado.estado, 'executado_parcial'); assert.equal(gravado.resultado.chamadas.filter(c => c.chamada).length, 1); assert.match(gravado.resultado.erro, /queda no meio/)
  assert.equal(auds(c2, 'execucao_erro').length, 1); assert.equal(p2.ml.log.posts.length, 1)
  await assert.rejects(executar(c2, p2.plano.id, p2.deps), /só plano APROVADO/); assert.equal(p2.ml.log.posts.length, 1, 're-executar o mesmo plano não repete o POST')
  // plano B gerado na hora: o item × campanha já teve POST há instantes => nada é reenviado
  const planoB = await P.gerarPlano(c2, { por: 'dono', deps: p2.deps }); P.aprovarPlano(c2, planoB.id, 'dono')
  const rB = await executar(c2, planoB.id, p2.deps)
  assert.equal(p2.ml.log.posts.length, 1, 'janela de propagação: sem segundo POST'); assert.match(rB.chamadas[0].resposta, /propagação/)
  // o sync lê plano parcial
  assert.equal(typeof (await X.sincronizarPosExecucao(c2, p2.plano.id, { deps: { api: p2.ml, espera: 0, agoraMs: Date.now() + 31 * 60e3 } })).enviadas, 'number')
})

// ═══ idx 42 — desligar a chave 1 durante a execução interrompe os POSTs seguintes ═══
await okA('idx42: execucao_habilitada é relida antes de CADA POST', async () => {
  const c = 'Exec E', vivas = { MLB1: [raw('P1')], MLB2: [raw('P1')] }
  const base = await preparar(c, { itens: ['MLB1', 'MLB2'], vivas, maxItens: 2 })
  const ml = criarMl(vivas, { aoPost: () => R.setConfig(c, { execucao_habilitada: 0 }, 'dono') })           // o dono desliga logo depois do 1º POST
  const r = await executar(c, base.plano.id, depsDe(ml))
  assert.equal(ml.log.posts.length, 1, 'o 2º POST não sai'); assert.match(r.interrompido, /DESLIGADA/); assert.equal(r.estado, 'executado_parcial')
  assert.equal(r.chamadas.find(x => x.item_id === 'MLB2').estado_final, 'nao_enviada'); assert.equal(R.lerPlano(c, base.plano.id).estado, 'executado_parcial'); assert.equal(auds(c, 'execucao_erro').length, 1)
})

// ═══ idx 43 — tentativa barrada fica na auditoria (aprovação, executor) ═══
await okA('idx43: aprovação barrada (expirado, repetida, sem nome, inexistente) e execução barrada geram auditoria', async () => {
  const c = 'Aud 1', pre = await preparar(c, { vivas: { MLB1: [raw('P1')] }, aprovar: false })
  assert.throws(() => P.aprovarPlano(c, pre.plano.id, 'dono', Date.now() + 25 * 3600e3), /expirado/)
  assert.throws(() => P.aprovarPlano(c, pre.plano.id, ''), /quem está aprovando/)
  assert.throws(() => P.aprovarPlano(c, 'PL-nao-existe', 'dono'), /não encontrado/)
  P.aprovarPlano(c, pre.plano.id, 'dono'); assert.throws(() => P.aprovarPlano(c, pre.plano.id, 'dono'), /já está "aprovado"/)
  assert.equal(auds(c, 'plano_aprovacao_bloqueada').length, 4)
  R.setConfig(c, { execucao_habilitada: 0 }, 'dono')
  await assert.rejects(executar(c, pre.plano.id, pre.deps), /DESLIGADA/); await assert.rejects(X.executarPlano(c, pre.plano.id, { confirmar: true, por: '', deps: pre.deps }), /BLOQUEADA/)
  assert.equal(auds(c, 'execucao_bloqueada').length, 2); assert.equal(pre.ml.log.posts.length, 0)
})

// ═══ rev2 idx 3 / 4 — o hedge morre com a âncora (plano, executor e marcasEfetivas) ═══
await okA('rev2/3: recusa da âncora ou bloqueio do anúncio DEPOIS da aprovação barra o hedge no executor (que não herda o "humano" da âncora)', async () => {
  const vivas = { MLB1: [raw('P1'), raw('P2')] }
  const a = await preparar('Anc 1', { vivas })
  assert.deepEqual(entram(a.plano), ['P1', 'P2*']); assert.equal(R.lerPlano('Anc 1', a.plano.id).itens.find(i => i.pid === 'P2').ancora, 'P1', 'o item de hedge carrega a âncora')
  R.marcarHumano('Anc 1', { item_id: 'MLB1', pid: 'P1', marcado: false }, 'dono')              // o dono recusa a âncora depois de aprovar
  const r = await executar('Anc 1', a.plano.id, a.deps)
  assert.equal(a.ml.log.posts.length, 0, 'âncora recusada: o hedge dela (mesmo preço e rebate) não entra sozinho')
  assert.match(r.chamadas.find(c => c.pid === 'P1').resposta, /recusado_pelo_dono/); assert.match(r.chamadas.find(c => c.pid === 'P2').resposta, /ancora_recusada/)
  // variante: IGNORAR o anúncio depois da aprovação — a marca 👤 explícita vale (o dono decide caso a caso), mas o hedge NÃO herda o "humano" para escapar do bloqueio
  const b = await preparar('Anc 2', { vivas })
  R.registrarAprendizado('Anc 2', { acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'não mexer' }, 'dono')
  const rb = await executar('Anc 2', b.plano.id, b.deps)
  assert.deepEqual(b.ml.log.posts.map(p => p.corpo.promotion_id), ['P1']); assert.match(rb.chamadas.find(c => c.pid === 'P2').resposta, /recusado_pelo_dono/)
  // o hash cobre a âncora: adulterá-la invalida o plano
  const c = await preparar('Anc 4', { vivas }), itens = R.lerPlano('Anc 4', c.plano.id).itens; itens.find(i => i.pid === 'P2').ancora = 'OUTRA'
  R.db.prepare('UPDATE promo_plano SET itens_json = ? WHERE id = ?').run(JSON.stringify(itens), c.plano.id)
  await assert.rejects(executar('Anc 4', c.plano.id, c.deps), /hash não confere/); assert.equal(c.ml.log.posts.length, 0)
})
await okA('rev2/4: marcasEfetivas — o hedge 🤖 aprovado não sobra sozinho se a âncora foi recusada, revogada ou não é conhecida', async () => {
  const c = 'Anc 3', hedge = (o = {}) => linha('B', { regra: 'HEDGE', ancora: 'A', ...o })
  R.substituirDecisoesAnalista(c, [linha('A'), hedge()], 'r1'); R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'A' }, { item_id: 'MLB1', pid: 'B' }], 'dono')
  assert.deepEqual(R.marcasEfetivas(c).map(d => d.pid).sort(), ['A', 'B']); assert.equal(R.lerDecisoes(c).find(d => d.pid === 'B').ancora, 'A', 'a âncora fica persistida')
  R.marcarHumano(c, { item_id: 'MLB1', pid: 'A', marcado: false }, 'dono')                       // recusa a âncora depois de aprovar as duas
  assert.deepEqual(R.marcasEfetivas(c), [], 'hedge morre com a âncora recusada (mesma regra de aplicarHumanos)')
  await assert.rejects(P.gerarPlano(c, { por: 'dono', deps: depsDe(criarMl({})) }), /nenhuma marca efetiva/)
  R.marcarHumano(c, { item_id: 'MLB1', pid: 'A', marcado: null }, 'dono'); assert.deepEqual(R.marcasEfetivas(c).map(d => d.pid).sort(), ['A', 'B'])
  R.substituirDecisoesAnalista(c, [linha('A', { preco: 80, mc_pct: 20 }), hedge()], 'r2')       // a rodada recalcula a âncora: a aprovação dela é REVOGADA — o hedge (mesmos números) não sobra
  assert.deepEqual(R.marcasEfetivas(c), [], 'âncora revogada')
  R.substituirDecisoesAnalista(c, [linha('A'), hedge()], 'r3'); R.aprovarAnalista(c, [{ item_id: 'MLB1', pid: 'A' }, { item_id: 'MLB1', pid: 'B' }], 'dono')
  R.db.prepare("UPDATE promo_decisao SET ancora = '' WHERE cliente = ? AND pid = 'B'").run(c)  // linha antiga, de antes da coluna: sem âncora conhecida o hedge não vale (falha fechado)
  assert.deepEqual(R.marcasEfetivas(c).map(d => d.pid), ['A'])
})

// ═══ rev2 idx 5 — a MC aprovada manda: MC viva não calculável não cai no ramo de preço ═══
await okA('rev2/5: pre-check com MC aprovada e MC viva não calculável => NÃO entra', async () => {
  const sem = P.precheckMargem({ preco: 100, mc_pct: 26 }, { preco: 100, mcPct: null })
  assert.equal(sem.entra, false); assert.match(sem.motivo, /MC viva não calculável/)
  assert.equal(P.precheckMargem({ preco: 100, mc_pct: 26 }, { preco: 150 }).entra, false, 'preço maior não implica MC maior')
  assert.equal(P.precheckMargem({ preco: 100, mc_pct: null }, { preco: 100, mcPct: null }).entra, true, 'marca humana sem MC aprovada: o ramo de preço continua')
  const { ml, deps, plano } = await preparar('Prec 1', { vivas: { MLB1: [raw('P1')] } })
  R.db.prepare("UPDATE promo_anuncio SET tarifa_json = '' WHERE cliente = ? AND item_id = 'MLB1'").run('Prec 1')       // a recoleta deixou o anúncio sem tarifa/frete
  const r = await executar('Prec 1', plano.id, deps)
  assert.equal(ml.log.posts.length, 0); assert.match(r.chamadas[0].resposta, /precheck_margem.*MC viva não calculável/)
})

// ═══ rev2 idx 21 — plano preso em 'executando' ═══
await okA('rev2/21: resultado parcial a cada POST; plano preso em executando é recuperado pela auditoria e vira sincronizável', async () => {
  const c = 'Preso 1', vivas = { MLB1: [raw('P1'), raw('P2')] }                                  // 1 anúncio, 2 POSTs (marca + hedge): o salvamento é por POST, não só por anúncio
  const base = await preparar(c, { vivas })
  let visto = null
  const ml = criarMl(vivas, { aoPost: (_c, corpo) => { if (corpo.promotion_id === 'P2') visto = R.lerPlano(c, base.plano.id) } })        // o que o banco guarda NO MOMENTO do 2º POST (= o que sobraria numa queda)
  await executar(c, base.plano.id, depsDe(ml))
  assert.equal(visto.estado, 'executando'); assert.ok(visto.executando_em); assert.equal(visto.resultado.parcial, true)
  assert.equal(visto.resultado.chamadas.filter(x => x.chamada).length, 1, 'o POST de P1 já estava gravado no plano antes do POST de P2'); assert.equal(visto.resultado.resumo.chamadas, 1)
  // queda: o plano volta ao estado preso (sem resultado), mas a auditoria exec_pre/exec_post continua
  const preso = min => R.db.prepare("UPDATE promo_plano SET estado='executando', executando_em=?, resultado_json='', executado_em='' WHERE id=?").run(new Date(Date.now() - min * 60e3).toISOString(), base.plano.id)
  preso(5); assert.deepEqual(X.recuperarPlanosPresos(c), [], 'parado há 5 min ainda pode estar vivo'); assert.equal(R.lerPlano(c, base.plano.id).estado, 'executando')
  preso(20)
  assert.deepEqual(X.recuperarPlanosPresos(c), [{ cliente: c, plano: base.plano.id, estado: 'executado_parcial', chamadas: 2 }])
  const rec = R.lerPlano(c, base.plano.id)
  assert.equal(rec.estado, 'executado_parcial'); assert.equal(rec.resultado.recuperado, true); assert.equal(rec.resultado.resumo.chamadas, 2)
  assert.ok(rec.resultado.chamadas.every(x => x.chamada && x.classe === 'enviado' && x.status_http === 200 && x.estado_final === 'enviado_sem_prova_ainda'), 'nada vira "entrou" sem prova')
  assert.ok(rec.executado_em && Date.parse(rec.executado_em) <= Date.now()); assert.equal(auds(c, 'execucao_recuperada').length, 1)
  assert.deepEqual(X.recuperarPlanosPresos(c), [], 'idempotente')
  assert.equal((await X.sincronizarPosExecucao(c, base.plano.id, { deps: { api: ml, espera: 0, agoraMs: Date.now() + 31 * 60e3 } })).enviadas, 2, 'o sync lê o plano recuperado')
  // sync/leitura de plano preso recupera ANTES de ler
  preso(20); assert.equal((await X.sincronizarPosExecucao(c, base.plano.id, { deps: { api: ml, espera: 0, agoraMs: Date.now() + 31 * 60e3 } })).enviadas, 2); assert.equal(R.lerPlano(c, base.plano.id).estado, 'executado_parcial')
  // preso SEM nenhum exec_pre (nada saiu): 'erro', com a nota de que não foi enviado
  const p2 = await preparar('Preso 2', { vivas: { MLB1: [raw('P1')] } }); assert.equal(R.reivindicarPlano('Preso 2', p2.plano.id), true)
  R.db.prepare("UPDATE promo_plano SET executando_em = ? WHERE id = ?").run(new Date(Date.now() - 60 * 60e3).toISOString(), p2.plano.id)
  assert.deepEqual(X.recuperarPlanosPresos(), [{ cliente: 'Preso 2', plano: p2.plano.id, estado: 'erro', chamadas: 0 }], 'sem cliente = todos os clientes')
  assert.equal(R.lerPlano('Preso 2', p2.plano.id).resultado.chamadas[0].estado_final, 'nao_enviada')
})

// ═══ rev2 idx 22 — execução vazia não queima a aprovação ═══
await okA('rev2/22: nenhum POST (leitura ao vivo 503 / pre-check barrou tudo) devolve o plano a aprovado — nunca "executado" com 0 chamadas', async () => {
  const c = 'Vazio 1', { deps, plano } = await preparar(c, { vivas: { MLB1: [raw('P1')] } })
  const ml503 = criarMl({ MLB1: 503 }), r = await executar(c, plano.id, depsDe(ml503))
  assert.equal(ml503.log.posts.length, 0); assert.equal(r.estado, 'nao_iniciada'); assert.equal(r.plano_estado, 'aprovado'); assert.equal(r.nada_enviado, true); assert.match(r.motivo, /leitura_falhou/); assert.match(r.aviso, /NADA foi enviado/)
  const lido = R.lerPlano(c, plano.id); assert.equal(lido.estado, 'aprovado'); assert.equal(lido.resultado, null); assert.equal(lido.executando_em, '')
  assert.equal(auds(c, 'execucao_nao_iniciada').length, 1); assert.match(auds(c, 'execucao_nao_iniciada')[0].detalhe, /leitura_falhou/); assert.equal(auds(c, 'execucao').length, 0)
  const r2 = await executar(c, plano.id, deps)                                                   // a falha do ML era transitória: o MESMO plano aprovado ainda executa
  assert.equal(r2.estado, 'executado'); assert.equal(deps.api.log.posts.length, 1)
  // pre-check que barra todos os itens: idem
  const v = { MLB1: [raw('P1')] }, p = await preparar('Vazio 2', { vivas: v })
  v.MLB1 = [raw('P1', { price: 92 })]                                                            // MC viva abaixo da aprovada
  const rp = await executar('Vazio 2', p.plano.id, p.deps)
  assert.equal(p.ml.log.posts.length, 0); assert.equal(rp.estado, 'nao_iniciada'); assert.match(rp.motivo, /precheck_margem/); assert.equal(R.lerPlano('Vazio 2', p.plano.id).estado, 'aprovado')
  // interrupção (chave 1 desligada pelo dono) antes do 1º POST continua 'erro' — é decisão, não falha transitória: o plano NÃO volta sozinho a aprovado
  const q = await preparar('Vazio 3', { vivas: { MLB1: [raw('P1')] } })
  const rq = await executar('Vazio 3', q.plano.id, { ...q.deps, api: async (m, cam) => { if (/\/prices$/.test(cam)) R.setConfig('Vazio 3', { execucao_habilitada: 0 }, 'dono'); return q.ml(m, cam) } })
  assert.equal(q.ml.log.posts.length, 0); assert.equal(rq.estado, 'erro'); assert.match(rq.interrompido, /DESLIGADA/); assert.equal(R.lerPlano('Vazio 3', q.plano.id).estado, 'erro')
})

// ═══ rev2 idx 23 — hedge sem nome: falha fechado ═══
await okA('rev2/23: hedge SMART sem nome (oferta e coleta) não passa como não-relâmpago — no plano e no executor', async () => {
  // só SMART sem nome é o buraco: ehRelampagoSmart exige tipo SMART + nome com "relâmpago"; PRICE_MATCHING/MARKETPLACE sem nome continuam entrando
  const { plano } = await preparar('Rel 1', { vivas: { MLB1: [raw('P1'), raw('PREL', { name: '' })] }, aprovar: false })
  assert.deepEqual(entram(plano), ['P1']); const x = plano.itens.find(i => i.pid === 'PREL'); assert.equal(x.acao, 'PULAR'); assert.equal(x.motivo, 'relampago_nome_desconhecido'); assert.equal(plano.resumo.hedge, 0)
  const pm = await preparar('Rel 1b', { vivas: { MLB1: [raw('P1'), raw('PM', { name: '', type: 'PRICE_MATCHING' })] }, aprovar: false }); assert.deepEqual(entram(pm.plano), ['P1', 'PM*'])
  // com o nome vindo da campanha da coleta (não é relâmpago) o hedge entra normalmente
  const ok = await preparar('Rel 2', { vivas: { MLB1: [raw('P1'), raw('PREL', { name: '' })] }, aprovar: false, antes: c => R.db.prepare(`INSERT INTO promo_campanha (cliente, pid, tipo, nome, atualizado_em) VALUES (?,?,?,?,?)`).run(c, 'PREL', 'SMART', 'Campanha comum', '2026-10-05T10:00:00Z') })
  assert.deepEqual(entram(ok.plano), ['P1', 'PREL*'])
  // executor: o hedge aprovado perde o nome ao vivo (e não há campanha na coleta) => não é enviado
  const vivas = { MLB1: [raw('P1'), raw('P2')] }, e = await preparar('Rel 3', { vivas }); assert.deepEqual(entram(e.plano), ['P1', 'P2*'])
  vivas.MLB1 = [raw('P1'), raw('P2', { name: '' })]
  const r = await executar('Rel 3', e.plano.id, e.deps)
  assert.deepEqual(e.ml.log.posts.map(p => p.corpo.promotion_id), ['P1']); assert.match(r.chamadas.find(c => c.pid === 'P2').resposta, /relampago_nome_desconhecido/)
  // hedge de marca do analista (regra HEDGE) com a oferta sem nome: idem (montarPlano puro)
  const pura = P.montarPlano({ cliente: 'M', vivasPorItem: new Map([['MLB1', { ok: true, ofertas: [{ pid: 'PH', offer_id: 'O', tipo: 'SMART', nome: '', status: 'candidate', preco: 100, preco_original: 120, meli_pct: 5 }] }]]),
    anuncios: new Map([['MLB1', { item_id: 'MLB1', sku: 'S', titulo: 'T', tarifa: { comissao_pct: 15, taxa_fixa: 0, frete: 10 } }]]), custosSku: new Map([['s', 45]]), config: { imposto_pct: 10 },
    decisoes: [{ item_id: 'MLB1', pid: 'PH', origem: 'analista', marcado: true, regra: 'HEDGE', ancora: 'PA', via: 'api', preco: 100, mc_pct: 26 }] })
  assert.equal(pura.itens[0].acao, 'PULAR'); assert.equal(pura.itens[0].motivo, 'relampago_nome_desconhecido')
})

// ═══ rev3 — relâmpago desconhecido, recusas por POST, pré-envio, sinal de vida, auditoria por chamada, predicado único ═══
const MC = await import('../src/lib/promocoes-mc.js')
await okA('rev3/1: âncora SMART sem nome (oferta e coleta) => PULAR relampago_nome_desconhecido, no plano e no executor', async () => {
  assert.equal(MC.smartSemNome({ tipo: 'SMART', nome: '  ' }), true); assert.equal(MC.smartSemNome({ tipo: 'SMART', nome: 'Camp' }), false); assert.equal(MC.smartSemNome({ tipo: 'PRICE_MATCHING', nome: '' }), false)
  const { plano } = await preparar('R3 1', { vivas: { MLB1: [raw('P1', { name: '' })] }, aprovar: false })       // marca 👤 em campanha escondida da listagem (sem nome em lugar nenhum)
  assert.equal(plano.itens[0].acao, 'PULAR'); assert.equal(plano.itens[0].motivo, 'relampago_nome_desconhecido'); assert.equal(plano.resumo.entrar, 0)
  const vivas = { MLB1: [raw('P1')] }, e = await preparar('R3 1b', { vivas })                                // aprovado com nome; o nome some ao vivo
  vivas.MLB1 = [raw('P1', { name: '' })]
  const r = await executar('R3 1b', e.plano.id, e.deps)
  assert.equal(e.ml.log.posts.length, 0); assert.match(r.chamadas[0].resposta, /relampago_nome_desconhecido/); assert.equal(R.lerPlano('R3 1b', e.plano.id).estado, 'aprovado')
})
await okA('rev3/12: recusa 👤 e IGNORAR feitos ENTRE o POST da âncora e o do hedge barram os POSTs seguintes do mesmo anúncio', async () => {
  const c = 'R3 12', vivas = { MLB1: [raw('P1'), raw('P2'), raw('P3')] }, base = await preparar(c, { vivas })
  assert.deepEqual(entram(base.plano), ['P1', 'P2*', 'P3*'])
  const ml = criarMl(vivas, { aoPost: (_c, corpo) => { if (corpo.promotion_id !== 'P1') return
    R.marcarHumano(c, { item_id: 'MLB1', pid: 'P2', marcado: false }, 'dono'); R.registrarAprendizado(c, { acao: 'ignorar', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'não mexer' }, 'dono') } })
  const r = await executar(c, base.plano.id, depsDe(ml))
  assert.deepEqual(ml.log.posts.map(p => p.corpo.promotion_id), ['P1'], 'P2 recusada e P3 (hedge em anúncio IGNORAR) não saem')
  for (const pid of ['P2', 'P3']) assert.match(r.chamadas.find(x => x.pid === pid).resposta, /recusado_pelo_dono.*relido antes do POST/)
})
await okA('rev3/13: falha ANTES do envio (token) = nao_enviada, sem exec_pre, plano volta a aprovado e reenvio não fica travado', async () => {
  const c = 'R3 13', { ml, deps, plano } = await preparar(c, { vivas: { MLB1: [raw('P1')] } })
  const semToken = Object.assign((...a) => ml(...a), { prepararPost: async () => { throw new Error('conta Mercado Livre não conectada') } })
  const r = await executar(c, plano.id, { ...deps, api: semToken })
  assert.equal(ml.log.posts.length, 0); assert.equal(r.estado, 'nao_iniciada'); assert.equal(R.lerPlano(c, plano.id).estado, 'aprovado')
  assert.equal(r.chamadas[0].pre_envio, true); assert.match(r.chamadas[0].resposta, /ANTES do envio.*não conectada/)
  assert.equal(auds(c, 'exec_pre').length, 0); assert.equal(R.tentativaRecente(c, 'MLB1', 'P1', X.ESPERA_PROPAGACAO_MIN), false)
  let tk = null                                                                                    // token resolvido no pré-envio é o que vai no POST (sem segunda renovação entre exec_pre e a rede)
  const comToken = Object.assign((m, cam, corpo, t) => { if (m === 'POST') tk = t; return ml(m, cam, corpo) }, { prepararPost: async () => 'TK' })
  assert.equal((await executar(c, plano.id, { ...deps, api: comToken })).estado, 'executado'); assert.equal(ml.log.posts.length, 1); assert.equal(tk, 'TK')
})
await okA('rev3/14: o read-back grava sinal de vida — execução lenta viva não é fechada como queda', async () => {
  const c = 'R3 14', vivas = { MLB1: [raw('P1'), raw('P2')] }, base = await preparar(c, { vivas })
  const ml = criarMl(vivas); let k = 0, rec = null
  const api = async (m, cam, corpo) => {
    if (m === 'GET' && ml.log.posts.length === 2 && /^\/seller-promotions\/items\//.test(cam)) {          // read-back
      if (++k === 1) R.db.prepare('UPDATE promo_plano SET executando_em = ? WHERE id = ?').run(new Date(Date.now() - 20 * 60e3).toISOString(), base.plano.id)     // 20 min sem sinal até aqui
      else rec = X.recuperarPlanosPresos(c)
    }
    return ml(m, cam, corpo)
  }
  const r = await executar(c, base.plano.id, { ...depsDe(ml), api })
  assert.deepEqual(rec, [], 'o plano ainda executando não é recuperado'); assert.equal(auds(c, 'execucao_recuperada').length, 0); assert.equal(r.estado, 'executado')
})
await okA('rev3/15: execução barrada que volta a aprovado deixa UMA linha de auditoria por chamada (item, campanha, motivo)', async () => {
  const c = 'R3 15', vivas = { MLB1: [raw('P1')], MLB2: [raw('P1')] }, { ml, deps, plano } = await preparar(c, { itens: ['MLB1', 'MLB2'], vivas, maxItens: 2 })
  vivas.MLB1 = [raw('P1', { price: 92 })]; vivas.MLB2 = 503                                         // MLB1: margem caiu; MLB2: leitura falhou
  const r = await executar(c, plano.id, deps)
  assert.equal(ml.log.posts.length, 0); assert.equal(r.plano_estado, 'aprovado')
  const linhas = auds(c, 'exec_nao_enviada').map(a => `${a.item_id}|${a.pid}|${a.detalhe.match(/precheck_margem|leitura_falhou/)?.[0]}|${a.depois.plano}`).sort()
  assert.deepEqual(linhas, [`MLB1|P1|precheck_margem|${plano.id}`, `MLB2|P1|leitura_falhou|${plano.id}`])
})
await okA('rev3/16: a expansão do hedge usa o predicado da âncora — sem id próprio e já participando não viram ENTRAR', async () => {
  const vivas = { MLB1: [raw('P1'), raw('X', { id: '' }), raw('P3', { status: 'started', ref_id: 'OFF-P3-velho' }), raw('P3')] }     // 'X' sem id => pid = tipo (SMART); P3 já started
  const { ml, deps, plano } = await preparar('R3 16', { vivas })
  assert.deepEqual(entram(plano), ['P1']); assert.equal(plano.resumo.hedge, 0)
  assert.equal(P.elegivel([{ pid: 'SMART', tipo: 'SMART', nome: 'C', status: 'candidate', offer_id: 'O', meli_pct: 5 }], 'SMART').motivo, 'campanha_sem_id')
  await executar('R3 16', plano.id, deps)
  assert.deepEqual(ml.log.posts.map(p => p.corpo.promotion_id), ['P1'], 'o que o plano mostra como ENTRAR é o que o executor envia')
})

// ═══ idx 43 / 50 — rotas: 403 {erro, motivo} antes do job, e auditoria de tudo que é barrado ═══
const express = (await import('express')).default
const Rotas = await import('../src/rotas-promocoes.js')
const app = express(); app.use(express.json({ limit: '1mb' })); app.use(Rotas.rotasPromocoes)
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`
const http = async (metodo, caminho, corpo) => { const r = await fetch(BASE + caminho, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }); return { status: r.status, json: await r.json() } }
await okA('idx43/50: /plano/executar bloqueado responde 403 {erro,motivo} sem job; lock, por e frase errada auditados', async () => {
  const H1 = 'Http Um', H2 = 'Http Dois'
  const v1 = { MLB1: [raw('P1')] }, v2 = { MLB1: [raw('P1')] }
  const p1 = await preparar(H1, { vivas: v1 }), p2 = await preparar(H2, { vivas: v2 })
  const lento = async (_c, caminho) => { await new Promise(r => setTimeout(r, 60)); return (await p2.ml('GET', caminho)).corpo }
  Object.assign(Rotas.depsPromocoes, { conexoes: () => [{ cliente: H1 }, { cliente: H2 }], api: p1.ml, chamar: lento, espera: 0, esperaReadback: 0, custosCliente: null, hoje: HOJE })
  // chave 1 desligada => 403 imediato, nenhum job, nenhuma chamada
  R.setConfig(H1, { execucao_habilitada: 0 }, 'dono')
  const b1 = await http('POST', '/api/promocoes/plano/executar', { cliente: H1, id: p1.plano.id, confirmar: true, por: 'dono' })
  assert.equal(b1.status, 403); assert.match(b1.json.erro, /BLOQUEADA/); assert.match(b1.json.motivo, /DESLIGADA/); assert.equal(b1.json.job, undefined)
  assert.equal((await http('POST', '/api/promocoes/plano/executar', { cliente: H1, id: p1.plano.id, confirmar: 'true', por: 'dono' })).status, 403)
  assert.equal(auds(H1, 'execucao_bloqueada').length, 2)
  // sem 'por' => 400 + auditoria; frase errada ao ligar => 403 + auditoria
  assert.equal((await http('POST', '/api/promocoes/plano/executar', { cliente: H1, id: p1.plano.id, confirmar: true })).status, 400); assert.equal(auds(H1, 'execucao_bloqueada').length, 3)
  assert.equal((await http('POST', '/api/promocoes/plano/aprovar', { cliente: H1, id: p1.plano.id })).status, 400); assert.equal(auds(H1, 'plano_aprovacao_bloqueada').length, 1)
  assert.equal((await http('POST', '/api/promocoes/config', { cliente: H1, execucao_habilitada: 1, habilitacao: 'errada', por: 'dono' })).status, 403); assert.equal(auds(H1, 'execucao_bloqueada').length, 4)
  // lock global: um job rodando (plano de outro cliente) => 409 + auditoria, e NADA é chamado
  R.setConfig(H1, { execucao_habilitada: 1 }, 'dono')
  const job = await http('POST', '/api/promocoes/plano', { cliente: H2, por: 'dono' }); assert.equal(job.status, 200)
  const lock = await http('POST', '/api/promocoes/plano/executar', { cliente: H1, id: p1.plano.id, confirmar: true, por: 'dono' })
  assert.equal(lock.status, 409); assert.equal(auds(H1, 'execucao_bloqueada').length, 5); assert.equal(p1.ml.log.posts.length, 0)
  for (let i = 0; i < 200; i++) { const j = (await http('GET', `/api/promocoes/job/${job.json.job}?cliente=${encodeURIComponent(H2)}`)).json; if (j.estado !== 'rodando') break; await new Promise(r => setTimeout(r, 25)) }
  // com tudo aberto a rota cria o job (executa com o stub, que só aceita POST de entrada)
  const ok = await http('POST', '/api/promocoes/plano/executar', { cliente: H1, id: p1.plano.id, confirmar: true, por: 'dono' }); assert.equal(ok.status, 200); assert.ok(ok.json.job)
  for (let i = 0; i < 200; i++) { const j = (await http('GET', `/api/promocoes/job/${ok.json.job}?cliente=${encodeURIComponent(H1)}`)).json; if (j.estado !== 'rodando') { assert.equal(j.estado, 'concluido', j.erro); break } await new Promise(r => setTimeout(r, 25)) }
  assert.equal(p1.ml.log.posts.length, 1)
  // 'Aprovar todas' não aprova campanha recusada pelo dono
  const H3 = 'Http Tres'; R.substituirDecisoesAnalista(H3, [linha('A'), linha('B', { item_id: 'MLB2' })], 'r1'); R.marcarHumano(H3, { item_id: 'MLB1', pid: 'A', marcado: false }, 'dono')
  Rotas.depsPromocoes.conexoes = () => [{ cliente: H3 }]
  const ap = await http('POST', '/api/promocoes/aprovar-analista', { cliente: H3, por: 'dono', itens: R.lerDecisoes(H3).filter(d => d.origem === 'analista').map(d => ({ item_id: d.item_id, pid: d.pid, preco: d.preco, mc_pct: d.mc_pct })) })     // lista exibida com os números (contrato rev3 #4)
  assert.equal(ap.json.aprovadas, 1); assert.equal(ap.json.bloqueadas_por_recusa, 1); assert.deepEqual(R.marcasEfetivas(H3).map(d => d.pid), ['B'])
})
await okA('rev2/21: GET /plano e GET /planos fecham o plano preso em executando ANTES de ler', async () => {
  const H = 'Preso 3', p = await preparar(H, { vivas: { MLB1: [raw('P1')] } }), p2 = await preparar('Preso 4', { vivas: { MLB1: [raw('P1')] } })
  Rotas.depsPromocoes.conexoes = () => [{ cliente: H }, { cliente: 'Preso 4' }]
  const parado = (c, id) => { assert.equal(R.reivindicarPlano(c, id), true); R.db.prepare('UPDATE promo_plano SET executando_em = ? WHERE id = ?').run(new Date(Date.now() - 60 * 60e3).toISOString(), id) }
  parado(H, p.plano.id); parado('Preso 4', p2.plano.id)
  assert.equal((await http('GET', `/api/promocoes/plano?cliente=${encodeURIComponent(H)}&id=${p.plano.id}`)).json.plano.estado, 'erro')
  assert.equal((await http('GET', `/api/promocoes/planos?cliente=${encodeURIComponent('Preso 4')}`)).json[0].estado, 'erro')
  assert.equal(auds(H, 'execucao_recuperada').length, 1); assert.equal(auds('Preso 4', 'execucao_recuperada').length, 1)
})
srv.close()
console.log(`✔ teste-promocoes-exec: ${n} casos (um por achado da frente EXEC) passaram`)
