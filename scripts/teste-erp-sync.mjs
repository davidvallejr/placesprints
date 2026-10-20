// Auto-teste do orquestrador de sync de custos dos ERPs (M7, src/lib/erp-sync.js). Banco EM MEMÓRIA, conectores STUB (nenhuma
// chamada a Bling/Tiny/ML), núcleo real (custos-db.js). Casos: sync completo + fecharSyncCompleto, SKU duplicado entre páginas,
// falha no meio (não fecha, não marca "não visto", não mexe em ultimo_sync_ok_em), kits, lock por conta, "sincronizar agora",
// tick só a partir das 03:00 / 1×/dia / até 3 tentativas / plano executando / reautorizar, fila com backoff. Rodar: node scripts/teste-erp-sync.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // ANTES dos imports: o teste jamais abre data/db.sqlite
process.env.PS_BLING_WEBHOOK = '0'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const R = await import('../src/lib/promocoes-db.js')
const C = await import('../src/lib/custos-db.js')
const S = await import('../src/lib/erp-sync.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const logs = []; S.configurarLog((nivel, msg) => logs.push(`${nivel} ${msg}`))

// ── stubs ────────────────────────────────────────────────────────────────────
const L = (sku, custo, id = sku, o = {}) => ({ sku, mlb: null, custo, campo: 'bling.fornecedor_padrao.precoCusto', id_externo: String(id), atualizado_na_fonte: null, ...o })
const contas = new Map()                                  // `${cliente}/${fonte}` → { paginas, falharNaPagina, erro, segurar, produto, chamadas }
const conta = (cliente, fonte, cfg) => { const c = { paginas: [], chamadas: 0, produto: {}, ...cfg }; contas.set(`${cliente}/${fonte}`, c); return c }
const deps = {
  criarConector: (cliente, fonte) => {
    const c = contas.get(`${cliente}/${fonte}`)
    return {
      async testar() { return { ok: true, empresa: null } },
      async *varrer() {
        c.chamadas++
        for (let i = 0; i < c.paginas.length; i++) {
          if (c.segurar && i === 1) await c.segurar
          if (c.falharNaPagina === i + 1) throw new Error(c.erro || 'HTTP 500 do ERP')
          yield { pagina: i + 1, linhas: c.paginas[i].linhas || [], kits: c.paginas[i].kits || [], avisos: [], pendentes_detalhe: c.paginas[i].pendentes_detalhe, nao_fechar: c.paginas[i].nao_fechar }
        }
      },
      async custoDoProduto(id) { c.chamadas++; const p = typeof c.produto[id] === 'function' ? c.produto[id]() : c.produto[id]; if (p instanceof Error) throw p; return p?.componentes !== undefined ? { linhas: [], kits: [p] } : { linhas: p ? [p] : [] } },
    }
  },
  obterToken: async () => 'token-fake',
}
const efetivos = cl => C.custosEfetivos(cl)
const linhaErp = (cl, sku, fonte = 'bling') => R.db.prepare('SELECT * FROM erp_custos_sku WHERE cliente = ? AND sku_key = ? AND fonte = ?').get(cl, C.chaveSku(sku), fonte)
const rejeitada = (cl, sku, fonte = 'bling') => R.db.prepare('SELECT * FROM erp_rejeitadas WHERE cliente = ? AND fonte = ? AND sku = ?').all(cl, fonte, sku)
const conectar = (cl, fonte) => C.gravarEstadoFonte(cl, fonte, { estado: 'conectado' })
const hoje = (h, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d }
const esperarJob = async id => { for (let i = 0; i < 200 && S.statusJob(id)?.estado === 'rodando'; i++) await new Promise(r => setTimeout(r, 5)); return S.statusJob(id) }

const CL = 'Cliente Sync', OUTRO = 'Cliente Vizinho'
conectar(CL, 'bling'); conectar(CL, 'tiny')
C.aplicarLote({ cliente: OUTRO, fonte: 'bling', modo: 'parcial', lote_id: 'outro-1', linhas: [L('A1', 99)], origem: 'sync' })

// ── 1. sync completo ─────────────────────────────────────────────────────────
await okA('varredura completa aplica, deduplica entre páginas e fecha o completo', async () => {
  conta(CL, 'bling', { paginas: [
    { linhas: [L('A1', 10), L('B2', 20), L('C3', '36.3200000000'), L('E5', 7, 'e5a')] },
    { linhas: [L('D4', 5), L('b2', 20, 'B2'), L('E5', 8, 'e5b'), L('SEMCUSTO', null), L('ZERO', 0)], pendentes_detalhe: ['999'] },
  ] })
  const r = await S.sincronizarCliente(CL, 'bling', { motivo: 'manual', deps })
  assert.equal(r.ok, true); assert.equal(r.completo, true); assert.equal(r.paginas, 2)
  const m = efetivos(CL)
  assert.equal(m.get('a1'), 10); assert.equal(m.get('b2'), 20); assert.equal(m.get('c3'), 36.32); assert.equal(m.get('d4'), 5)
  assert.equal(m.has('e5'), false, 'SKU repetido com custos diferentes: nenhuma ocorrência vale')
  assert.equal(m.has('semcusto') || m.has('zero'), false, 'custo nulo/0 nunca vira custo')
  assert.ok(rejeitada(CL, 'E5').some(x => x.codigo === 'sku_duplicado_no_lote'), 'duplicado com custos diferentes é rejeitado')
  assert.equal(r.skus_duplicados, 2)
  const est = C.estadoFonte(CL, 'bling')
  assert.equal(est.estado, 'conectado'); assert.ok(est.ultimo_sync_ok_em); assert.equal(est.sync_estado, '')
  const resumo = est.ultimo_resumo
  assert.equal(resumo.paginas, 2); assert.equal(resumo.detalhes_pendentes, 1); assert.ok(!('rejeitadas_lista' in resumo))
  assert.ok(R.db.prepare("SELECT 1 FROM erp_fila WHERE cliente = ? AND fonte = 'bling' AND id_externo = '999' AND motivo = 'detalhe'").get(CL), 'excedente de detalhe vai para a fila')
  assert.equal(efetivos(OUTRO).get('a1'), 99, 'o outro cliente não é tocado')
})

await okA('SKU ausente no completo seguinte vira "não visto" (custo continua valendo, nada apagado)', async () => {
  contas.get(`${CL}/bling`).paginas = [{ linhas: [L('A1', 10), L('B2', 20), L('D4', 5)] }]
  await new Promise(r => setTimeout(r, 5))                // inicio do 2º sync > visto_em do 1º
  const r = await S.sincronizarCliente(CL, 'bling', { deps })
  assert.equal(r.ok, true); assert.ok(r.nao_vistos >= 1)
  assert.ok(linhaErp(CL, 'C3').nao_visto_desde, 'C3 marcado como não visto')
  assert.equal(efetivos(CL).get('c3'), 36.32, 'não visto NÃO apaga nem zera')
  assert.equal(linhaErp(CL, 'A1').nao_visto_desde, '')
})

// ── 2. falha no meio ─────────────────────────────────────────────────────────
await okA('falha no meio: aplica o que leu, não fecha, não marca não visto, não atualiza ultimo_sync_ok_em', async () => {
  const antes = C.estadoFonte(CL, 'bling')
  const rejE5 = rejeitada(CL, 'E5').length
  contas.get(`${CL}/bling`).paginas = [{ linhas: [L('A1', 11), L('B2', 20)] }, { linhas: [L('D4', 5)] }]
  Object.assign(contas.get(`${CL}/bling`), { falharNaPagina: 2, erro: 'HTTP 500 Authorization: Bearer abc.def.ghi access_token=segredo123 corpo cru' })
  await new Promise(r => setTimeout(r, 5))
  const r = await S.sincronizarCliente(CL, 'bling', { deps })
  assert.equal(r.ok, false); assert.equal(r.completo, false)
  assert.equal(efetivos(CL).get('a1'), 11, 'o que foi lido antes da falha é aplicado')
  assert.equal(linhaErp(CL, 'D4').nao_visto_desde, '', 'D4 não foi lido (falha), mas NÃO vira não visto')
  assert.equal(efetivos(CL).get('d4'), 5)
  const est = C.estadoFonte(CL, 'bling')
  assert.equal(est.ultimo_sync_ok_em, antes.ultimo_sync_ok_em, 'ultimo_sync_ok_em intacto')
  assert.equal(est.ultimo_resumo_json, antes.ultimo_resumo_json, 'resumo do último completo intacto')
  assert.equal(est.estado, 'erro'); assert.equal(est.sync_estado, '')
  assert.ok(est.ultimo_erro.includes('HTTP 500'))
  for (const s of ['abc.def.ghi', 'segredo123']) { assert.ok(!est.ultimo_erro.includes(s), 'erro sanitizado'); assert.ok(!r.erro.includes(s)); assert.ok(!logs.join('\n').includes(s), 'log sem token') }
  assert.equal(rejeitada(CL, 'E5').length, rejE5, 'rejeitadas antigas não são limpas por sync incompleto')
  assert.match(R.listarAuditoria(CL, { evento: 'custos_lote', limite: 1 })[0].detalhe, /· parcial ·/, 'o lido antes da falha entra como PARCIAL, nunca como completo')
  assert.match(R.listarAuditoria(CL, { evento: 'custos_sync', limite: 1 })[0].detalhe, /FALHOU/)
  Object.assign(contas.get(`${CL}/bling`), { falharNaPagina: 0 })
})

await okA('falha antes de ler qualquer coisa não grava nada', async () => {
  const c = conta(CL, 'tiny', { paginas: [{ linhas: [L('T1', 3, 't1', { campo: 'tiny.precos.precoCusto' })] }], falharNaPagina: 1, erro: 'ECONNRESET' })
  const r = await S.sincronizarCliente(CL, 'tiny', { deps })
  assert.equal(r.ok, false); assert.equal(r.lidas, 0); assert.equal(linhaErp(CL, 'T1', 'tiny'), undefined)
  assert.equal(C.estadoFonte(CL, 'tiny').ultimo_sync_ok_em, ''); assert.equal(c.chamadas, 1)
  c.falharNaPagina = 0
})

// ── 3. kits ──────────────────────────────────────────────────────────────────
await okA('kits: soma com todos os componentes; componente sem custo e sem estrutura ficam pendentes; divergência > 1% vai à quarentena', async () => {
  contas.get(`${CL}/bling`).paginas = [{
    linhas: [L('A1', 11), L('B2', 20), L('D4', 5), L('X1', 2, 'x1'), L('X2', '3.0000000000', 'x2'), L('X3', null, 'x3')],
    kits: [
      { id_externo: 'k1', sku: 'KIT1', custo_proprio: null, componentes: [{ id_externo: 'x1', quantidade: 2 }, { id_externo: 'x2', quantidade: 1 }] },
      { id_externo: 'k2', sku: 'KIT2', custo_proprio: 9, componentes: [{ id_externo: 'x1', quantidade: 1 }, { id_externo: 'x3', quantidade: 1 }] },
      { id_externo: 'k3', sku: 'KIT3', custo_proprio: 9, componentes: null },
      { id_externo: 'k4', sku: 'KIT4', custo_proprio: 10, componentes: [{ id_externo: 'x1', quantidade: 1 }, { id_externo: 'x2', quantidade: 1 }] },
      { id_externo: 'k5', sku: 'KIT5', custo_proprio: '5.0400', componentes: [{ id_externo: 'x1', quantidade: 1 }, { id_externo: 'x2', quantidade: 1 }] },
    ] }]
  await new Promise(r => setTimeout(r, 5))
  const r = await S.sincronizarCliente(CL, 'bling', { deps })
  assert.equal(r.ok, true); assert.equal(r.kits, 5); assert.equal(r.kits_pendentes, 2)
  const m = efetivos(CL)
  assert.equal(m.get('kit1'), 7, 'kit = 2×2 + 1×3')
  assert.equal(m.has('kit2'), false, 'componente sem custo: kit sem custo (nunca inventa)')
  assert.equal(m.has('kit3'), false, 'sem estrutura: kit sem custo, nem o custo próprio vale')
  assert.equal(m.get('kit5'), 5, 'divergência ≤ 1% aceita a soma')
  assert.ok(rejeitada(CL, 'KIT2').some(x => x.codigo === 'kit_componente_sem_custo'), 'código kit_componente_sem_custo')
  assert.ok(rejeitada(CL, 'KIT3').some(x => x.codigo === 'kit_sem_estrutura'), 'código kit_sem_estrutura')
  assert.equal(m.has('kit4'), false, 'kit divergente não entra como vigente')
  const q = C.listarQuarentena(CL).find(x => x.sku === 'KIT4' && x.fonte === 'bling')
  assert.ok(q, 'KIT4 em quarentena'); assert.equal(q.motivo, 'kit_divergente'); assert.equal(q.custo_proposto, 5, 'a proposta é a soma')
})

// ── 4. lock por conta + "sincronizar agora" ──────────────────────────────────
await okA('lock por (cliente, fonte): segundo sync = 409; outra fonte do mesmo cliente roda; job em memória', async () => {
  let soltar; const c = contas.get(`${CL}/bling`)
  c.segurar = new Promise(r => { soltar = r }); c.paginas = [{ linhas: [L('A1', 11)] }, { linhas: [L('B2', 20)] }]
  const p = S.sincronizarCliente(CL, 'bling', { deps })
  assert.equal(C.estadoFonte(CL, 'bling').sync_estado, 'rodando')
  assert.throws(() => S.iniciarSync(CL, 'bling', deps), e => e.status === 409)
  await assert.rejects(S.sincronizarCliente(CL, 'bling', { deps }), e => e.status === 409)
  assert.equal((await S.processarFila({ deps })).processados, 0, 'a fila não mexe numa conta em sync')
  const rt = await S.sincronizarCliente(CL, 'tiny', { deps })
  assert.equal(rt.ok, true, 'Tiny do mesmo cliente não divide o lock com o Bling')
  soltar(); c.segurar = null
  assert.equal((await p).ok, true)
  assert.equal(C.estadoFonte(CL, 'bling').sync_estado, '')
  const { job_id } = S.iniciarSync(CL, 'bling', deps)
  assert.equal(S.statusJob(job_id).estado, 'rodando')
  const j = await esperarJob(job_id)
  assert.equal(j.estado, 'concluido'); assert.equal(j.resultado.ok, true)
  assert.equal(S.statusJob('nao-existe'), null)
  assert.throws(() => S.iniciarSync(CL, 'sheets', deps), e => e.status === 400)
})

await okA('lock persistente: "rodando" recente bloqueia; parado há mais de 30 min é considerado morto', async () => {
  C.gravarEstadoFonte(CL, 'bling', { sync_estado: 'rodando', sync_iniciada_em: new Date(Date.now() - 10 * 60e3).toISOString() })
  assert.throws(() => S.iniciarSync(CL, 'bling', deps), e => e.status === 409)
  C.gravarEstadoFonte(CL, 'bling', { sync_estado: 'rodando', sync_iniciada_em: new Date(Date.now() - 31 * 60e3).toISOString() })
  assert.equal((await S.sincronizarCliente(CL, 'bling', { deps })).ok, true)
})

// ── 5. tick ──────────────────────────────────────────────────────────────────
const CT = 'Cliente Tick', CF = 'Cliente Falha', CR = 'Cliente Reaut', CP = 'Cliente Plano', CD = 'Cliente Pausado'
for (const c of [CT, CF, CR, CP, CD]) { conectar(c, 'bling'); conta(c, 'bling', { paginas: [{ linhas: [L('S1', 4)] }] }) }
contas.get(`${CF}/bling`).falharNaPagina = 1
C.gravarEstadoFonte(CR, 'bling', { estado: 'reautorizar' }); C.gravarEstadoFonte(CD, 'bling', { estado: 'pausado' })
R.db.prepare("INSERT INTO promo_plano (id, cliente, estado, criado_em, expira_em) VALUES ('pl-1', ?, 'executando', ?, ?)").run(CP, R.agora(), R.agora())
const chamadas = c => contas.get(`${c}/bling`).chamadas

await okA('tick antes das 03:00 não sincroniza', async () => {
  const r = await S.tickCustos({ agora: hoje(2, 59), deps })
  assert.equal(r.rodou, false); assert.equal(chamadas(CT), 0)
})

await okA('tick a partir das 03:00 (recupera se a máquina estava desligada): só contas conectadas; reautorizar/pausado/plano executando não rodam', async () => {
  const r = await S.tickCustos({ agora: hoje(15), deps })
  assert.equal(r.rodou, true)
  assert.equal(chamadas(CT), 1); assert.equal(efetivos(CT).get('s1'), 4)
  assert.equal(chamadas(CR), 0, 'reautorizar não roda'); assert.equal(chamadas(CD), 0, 'pausado não roda')
  assert.equal(chamadas(CP), 0); assert.ok(r.pulados.some(p => p.cliente === CP && /plano/.test(p.motivo)))
  assert.equal(chamadas(CF), 1); assert.equal(C.estadoFonte(CF, 'bling').estado, 'erro')
})

await okA('tick não repete no mesmo dia; falha é retentada até 3×; no dia seguinte recomeça', async () => {
  await S.tickCustos({ agora: hoje(15, 10), deps })
  await S.tickCustos({ agora: hoje(15, 20), deps })
  const r4 = await S.tickCustos({ agora: hoje(15, 30), deps })
  assert.equal(chamadas(CT), 1, 'sync OK hoje: não repete')
  assert.equal(chamadas(CF), 3, 'falha: 3 tentativas no dia')
  assert.ok(r4.pulados.some(p => p.cliente === CF && /esgotadas/.test(p.motivo)))
  const amanha = hoje(3, 5); amanha.setDate(amanha.getDate() + 1)
  await S.tickCustos({ agora: amanha, deps })
  assert.equal(chamadas(CT), 2, 'dia seguinte: roda de novo'); assert.equal(chamadas(CF), 4, 'dia seguinte: tentativas zeradas')
})

await okA('"sincronizar agora" manual roda com plano executando; reautorizar recusa', async () => {
  const { job_id } = S.iniciarSync(CP, 'bling', deps)
  assert.equal((await esperarJob(job_id)).estado, 'concluido')
  assert.throws(() => S.iniciarSync(CR, 'bling', deps), e => e.status === 409 && /reautoriz/.test(e.message))
  await assert.rejects(S.sincronizarCliente(CR, 'bling', { deps }), e => e.status === 409)
  assert.throws(() => S.iniciarSync('Cliente Sem Fonte', 'bling', deps), e => e.status === 409)
})

await okA('invalid_grant durante o sync → reautorizar, e o tick para de tentar', async () => {
  const CI = 'Cliente Grant'; conectar(CI, 'bling'); conta(CI, 'bling', { paginas: [{ linhas: [L('G1', 1)] }], falharNaPagina: 1, erro: 'invalid_grant: refresh token expirado' })
  const { job_id } = S.iniciarSync(CI, 'bling', deps)
  const j = await esperarJob(job_id)
  assert.equal(j.estado, 'erro'); assert.equal(C.estadoFonte(CI, 'bling').estado, 'reautorizar')
  await S.tickCustos({ agora: hoje(16), deps })
  assert.equal(chamadas(CI), 1, 'reautorizar não roda no tick')
})

await okA('keepalive do Tiny chama a renovação quando o refresh tem mais de 12 h (a qualquer hora)', async () => {
  const CK = 'Cliente Keep'; conectar(CK, 'tiny'); conta(CK, 'tiny', { paginas: [] })
  const pedidos = []; const d2 = { ...deps, obterToken: async (c, f) => { pedidos.push(`${c}/${f}`); return 'x' } }
  R.db.prepare("INSERT INTO erp_credenciais (cliente, fonte, refresh_emitido_em) VALUES (?, 'tiny', ?)").run(CK, new Date(hoje(1).getTime() - 13 * 3600e3).toISOString())
  await S.tickCustos({ agora: hoje(1), deps: d2 })
  assert.ok(pedidos.includes(`${CK}/tiny`), 'refresh velho: renova (mesmo antes das 03:00)')
  pedidos.length = 0
  R.db.prepare("UPDATE erp_credenciais SET refresh_emitido_em = ? WHERE cliente = ? AND fonte = 'tiny'").run(new Date(hoje(1).getTime() - 3600e3).toISOString(), CK)
  await S.tickCustos({ agora: hoje(1), deps: d2 })
  assert.ok(!pedidos.includes(`${CK}/tiny`), 'refresh recente: não renova')
})

// ── 6. fila ──────────────────────────────────────────────────────────────────
const enfileirar = (cl, id, motivo = 'gatilho') => R.db.prepare('INSERT INTO erp_fila (cliente, fonte, id_externo, motivo, enfileirado_em) VALUES (?,?,?,?,?)').run(cl, 'bling', id, motivo, R.agora())
const naFila = (cl, id) => R.db.prepare("SELECT * FROM erp_fila WHERE cliente = ? AND fonte = 'bling' AND id_externo = ?").get(cl, id)

await okA('fila: gatilho do Bling só com PS_BLING_WEBHOOK=1; detalhe sempre; aplica parcial e remove', async () => {
  const c = contas.get(`${CT}/bling`)
  c.produto = { p1: L('S1', 4.4, 'p1'), '999': L('DET', 6, '999') }
  R.db.prepare("DELETE FROM erp_fila WHERE cliente = ?").run(CL)
  enfileirar(CT, 'p1'); enfileirar(CT, '999', 'detalhe')
  let r = await S.processarFila({ deps })
  assert.equal(r.processados, 1); assert.ok(naFila(CT, 'p1'), 'webhook desligado: gatilho fica'); assert.equal(naFila(CT, '999'), undefined)
  assert.equal(efetivos(CT).get('det'), 6)
  process.env.PS_BLING_WEBHOOK = '1'
  r = await S.processarFila({ deps })
  assert.equal(r.processados, 1); assert.equal(naFila(CT, 'p1'), undefined); assert.equal(efetivos(CT).get('s1'), 4.4)
})

await okA('fila: coalescida (gatilho novo durante a leitura não se perde) e com backoff até 3 tentativas', async () => {
  const c = contas.get(`${CT}/bling`)
  // o M2 enfileira com INSERT OR IGNORE: um gatilho que chega DURANTE a leitura tem de sobreviver
  c.produto.p2 = () => { R.db.prepare("INSERT OR IGNORE INTO erp_fila (cliente, fonte, id_externo, motivo, enfileirado_em) VALUES (?, 'bling', 'p2', 'gatilho', ?)").run(CT, R.agora()); return L('S1', 4.4, 'p2') }
  enfileirar(CT, 'p2')
  assert.equal((await S.processarFila({ deps })).processados, 1)
  assert.ok(naFila(CT, 'p2'), 'gatilho mais novo do mesmo produto continua na fila')
  R.db.prepare("DELETE FROM erp_fila WHERE cliente = ? AND id_externo = 'p2'").run(CT)
  c.produto.p3 = new Error('HTTP 503')
  enfileirar(CT, 'p3')
  let r = await S.processarFila({ deps })
  assert.equal(r.falhas, 1); const f1 = naFila(CT, 'p3'); assert.equal(f1.tentativas, 1); assert.ok(f1.proxima_em > R.agora(), 'backoff')
  r = await S.processarFila({ deps }); assert.equal(r.falhas, 0, 'antes do backoff não tenta de novo')
  for (let i = 0; i < 2; i++) { R.db.prepare("UPDATE erp_fila SET proxima_em = '' WHERE cliente = ? AND id_externo = 'p3'").run(CT); r = await S.processarFila({ deps }) }
  assert.equal(r.esgotados, 1); assert.equal(naFila(CT, 'p3'), undefined, 'esgotou: sai da fila (nunca laço infinito)')
  assert.ok(C.estadoFonte(CT, 'bling').ultimo_resumo.avisos_fila.some(a => a.includes('p3')), 'vira aviso no resumo')
  process.env.PS_BLING_WEBHOOK = '0'
})

await okA('fila: itens de conta parada (reautorizar) não travam a fila das outras contas', async () => {
  const CZ = 'Cliente Parado'; C.gravarEstadoFonte(CZ, 'bling', { estado: 'reautorizar' })
  for (let i = 0; i < 25; i++) enfileirar(CZ, `z${i}`, 'detalhe')                       // mais que uma rodada inteira (20), e mais antigos
  R.db.prepare("UPDATE erp_fila SET enfileirado_em = '2000-01-01T00:00:00.000Z' WHERE cliente = ?").run(CZ)
  contas.get(`${CT}/bling`).produto.p4 = L('S4', 3.3, 'p4'); enfileirar(CT, 'p4', 'detalhe')
  assert.equal((await S.processarFila({ deps })).processados, 1); assert.equal(efetivos(CT).get('s4'), 3.3)
  assert.ok(naFila(CZ, 'z0'), 'o item da conta parada espera ela voltar (a varredura diária também cobre)')
})

// ── 7. contrato com o conector Bling real (M4) sobre as fixtures da doc (HTTP fake, sem rede) ──
await okA('contrato M4→M7: conector Bling real com fixtures (custo da raiz/detalhe, kit divergente, kit sem estrutura)', async () => {
  const { criarConectorBling } = await import('../src/lib/erp-bling.js')
  const fx = nome => JSON.parse(readFileSync(new URL(`./fixtures/erp/bling-${nome}.json`, import.meta.url), 'utf8'))
  const lista = [...fx('produtos-pagina-1').data, ...fx('produtos-pagina-2').data], DET = fx('produtos-detalhe').detalhes
  const resp = (status, obj) => ({ status, headers: {}, texto: JSON.stringify(obj) })
  const http = async ({ metodo, url }) => {
    assert.equal(metodo, 'GET', 'só leitura'); const u = new URL(url)
    assert.equal(u.origin, 'https://api.bling.com.br')
    if (u.pathname === '/Api/v3/produtos') return resp(200, { data: u.searchParams.get('pagina') === '1' ? lista : [] })
    const m = u.pathname.match(/^\/Api\/v3\/produtos\/(\d+)$/)
    return m && DET[m[1]] ? resp(200, DET[m[1]]) : resp(404, { error: { type: 'RESOURCE_NOT_FOUND' } })
  }
  const CX = 'Cliente Fixture'; conectar(CX, 'bling')
  const d2 = { criarConector: () => criarConectorBling({ http, limitador: { aguardar: async () => {}, registrar429: () => {} }, obterToken: async () => 'tok-fixture', log: () => {} }) }
  const r = await S.sincronizarCliente(CX, 'bling', { deps: d2 })
  assert.equal(r.ok, true, r.erro)
  const m = efetivos(CX)
  assert.equal(m.get('cam-001'), 36.32); assert.equal(m.get('cam-002'), 12.5, 'precoCusto 0 na raiz → detalhe do fornecedor padrão')
  assert.equal(m.get('str-custo'), 36.32); assert.equal(m.has('neg-1') || m.has('custo-null') || m.has('sem-forn'), false, 'sem custo / negativo nunca vira custo')
  assert.equal(m.has('kit-01'), false)
  const q = C.listarQuarentena(CX).find(x => x.sku === 'KIT-01')
  assert.equal(q?.motivo, 'kit_divergente'); assert.equal(q.custo_proposto, 85.14, 'soma 2×36,32 + 1×12,50')
  assert.ok(rejeitada(CX, 'KIT-SEM').some(x => x.codigo === 'kit_sem_estrutura'))
  assert.ok(!JSON.stringify(C.estadoFonte(CX, 'bling')).includes('tok-fixture'))
})

await okA('token null por falha transitória do M6 vira "erro" (o tick tenta de novo), não "reautorizar" (só o M6 marca)', async () => {
  const CN = 'Cliente Token Transitorio'; conectar(CN, 'bling')                       // conectado, mas sem token renovável agora: o M6 devolve null
  const r = await S.sincronizarCliente(CN, 'bling', { motivo: 'manual' })            // caminho padrão (M4 + M6 reais): falha ANTES de qualquer HTTP
  assert.equal(r.ok, false); assert.equal(C.estadoFonte(CN, 'bling').estado, 'erro')
})

// ── 8. regressões da revisão adversarial ─────────────────────────────────────
await okA('kit soma o VIGENTE do componente: componente em quarentena ou recusado deixa o kit pendente (nunca a soma com o valor cru)', async () => {
  const CK = 'Cliente Kit Vigente'; conectar(CK, 'bling')
  const kit = (sku, id, comps) => ({ id_externo: id, sku, custo_proprio: null, componentes: comps.map(([c, q]) => ({ id_externo: c, quantidade: q })) })
  const c = conta(CK, 'bling', { paginas: [{ linhas: [L('COMP', 10, 'c'), L('BASE', 100, 'b')], kits: [kit('KIT', 'k', [['c', 1], ['b', 1]])] }] })
  assert.equal((await S.sincronizarCliente(CK, 'bling', { deps })).ok, true); assert.equal(efetivos(CK).get('kit'), 110)
  c.paginas = [{ linhas: [L('COMP', 0.5, 'c'), L('BASE', 100, 'b')], kits: [kit('KIT', 'k', [['c', 1], ['b', 1]]), kit('KIT2', 'k2', [['c', 2]])] }]
  await new Promise(r => setTimeout(r, 5)); await S.sincronizarCliente(CK, 'bling', { deps })
  assert.equal(C.listarQuarentena(CK).find(x => x.sku === 'COMP')?.motivo, 'variacao_brusca'); assert.equal(efetivos(CK).get('comp'), 10)
  assert.equal(efetivos(CK).has('kit2'), false, 'kit novo com componente em quarentena: pendente, não 2×0,5')
  assert.equal(efetivos(CK).get('kit'), 110, 'kit existente não vira 100,5 com o valor em quarentena')
  assert.ok(rejeitada(CK, 'KIT2').some(x => x.codigo === 'kit_componente_sem_custo'))
  C.decidirQuarentena(CK, [{ sku: 'COMP', fonte: 'bling' }], 'recusar', 'dono')
  await new Promise(r => setTimeout(r, 5)); const r3 = await S.sincronizarCliente(CK, 'bling', { deps })
  assert.equal(r3.recusado_antes, 1); assert.equal(efetivos(CK).get('kit'), 110, 'valor recusado pelo dono não entra no kit')
  assert.ok(rejeitada(CK, 'KIT').some(x => x.codigo === 'kit_componente_sem_custo'))
  assert.equal(linhaErp(CK, 'KIT').nao_visto_desde, '', 'kit pendente está na fonte: não vira "não visto"')
})

await okA('conector com pendência que esconde SKU (nao_fechar): lê e aplica, mas NÃO fecha o completo nem marca "não visto"', async () => {
  const CN = 'Cliente Nao Fecha'; conectar(CN, 'tiny')
  const c = conta(CN, 'tiny', { paginas: [{ linhas: [L('V1', 3, 'v1'), L('V2', 4, 'v2')] }] })
  await S.sincronizarCliente(CN, 'tiny', { deps })
  c.paginas = [{ linhas: [L('V1', 3, 'v1')], pendentes_detalhe: ['77'], nao_fechar: true }]
  await new Promise(r => setTimeout(r, 5)); const r = await S.sincronizarCliente(CN, 'tiny', { deps })
  assert.equal(r.ok, true); assert.equal(r.completo, false); assert.equal(r.nao_vistos, 0)
  assert.equal(linhaErp(CN, 'V2', 'tiny').nao_visto_desde, '', 'variação de pai não lido não vira "não visto"')
  assert.ok(R.db.prepare("SELECT 1 FROM erp_fila WHERE cliente = ? AND fonte = 'tiny' AND id_externo = '77'").get(CN), 'excedente vai para a fila')
  assert.match(R.listarAuditoria(CN, { evento: 'custos_lote', limite: 1 })[0].detalhe, /· parcial ·/)
  R.db.prepare('DELETE FROM erp_fila WHERE cliente = ?').run(CN)
})

await okA('Tiny real: pais além do teto vão para a fila; o pai cuja VARIAÇÃO tem anúncio passa a entrar no teto', async () => {
  const { criarConectorTiny } = await import('../src/lib/erp-tiny.js')
  const CV = 'Cliente Variacoes'; conectar(CV, 'tiny')
  const pais = Array.from({ length: 201 }, (_, i) => ({ id: 7000 + i, sku: `P${i}`, tipo: 'V', tipoVariacao: 'P', situacao: 'A', precos: {} }))
  const resp = obj => ({ status: 200, headers: {}, texto: JSON.stringify(obj) })
  const http = async ({ url }) => {
    const u = new URL(url), m = u.pathname.match(/\/produtos\/(\d+)$/)
    if (m) { const p = pais[Number(m[1]) - 7000]; return resp({ ...p, variacoes: [{ id: Number(m[1]) + 1000, sku: `${p.sku}-U`, precos: { precoCusto: 3 } }] }) }
    return resp(u.searchParams.get('situacao') === 'A' ? { itens: pais, paginacao: { total: 201 } } : { itens: [] })
  }
  const d2 = { criarConector: () => criarConectorTiny({ http, limitador: { aguardar: async () => {}, registrar429: () => {} }, obterToken: async () => 'tok', log: () => {} }) }
  R.db.prepare("INSERT INTO promo_anuncio (cliente, item_id, sku, preco) VALUES (?, 'MLB9001', 'P200-U', 50)").run(CV)
  const naFilaTiny = id => R.db.prepare("SELECT 1 FROM erp_fila WHERE cliente = ? AND fonte = 'tiny' AND id_externo = ?").get(CV, String(id))
  const r1 = await S.sincronizarCliente(CV, 'tiny', { deps: d2 })
  assert.equal(r1.ok, true); assert.equal(r1.completo, false, 'pai não lido: varredura parcial não fecha como completa')
  assert.ok(naFilaTiny(7200), 'excedente do teto vai para a erp_fila (7.3)')
  assert.equal((await S.processarFila({ deps: d2 })).processados, 1); assert.equal(efetivos(CV).get('p200-u'), 3, 'a fila lê as variações do pai')
  await new Promise(r => setTimeout(r, 5)); await S.sincronizarCliente(CV, 'tiny', { deps: d2 })
  assert.ok(!naFilaTiny(7200) && naFilaTiny(7199), 'o pai da variação com anúncio entra no teto; outro vai para a fila')
  assert.equal(linhaErp(CV, 'P199-U', 'tiny').nao_visto_desde, '', 'variação do pai na fila não vira "não visto"')
  R.db.prepare('DELETE FROM erp_fila WHERE cliente = ?').run(CV)
})

await okA('fila resolve o kit relido (soma com os vigentes); kit além do teto do Bling fica pendente com o motivo do teto', async () => {
  const CQ = 'Cliente Kit Fila'; conectar(CQ, 'bling')
  const c = conta(CQ, 'bling', { paginas: [{ linhas: [L('Q1', 2, 'q1')] }] })
  await S.sincronizarCliente(CQ, 'bling', { deps })
  c.produto = { k9: { id_externo: 'k9', sku: 'KIT9', custo_proprio: null, componentes: [{ id_externo: 'q1', quantidade: 3 }] } }
  R.db.prepare("INSERT INTO erp_fila (cliente, fonte, id_externo, motivo, enfileirado_em) VALUES (?, 'bling', 'k9', 'detalhe', ?)").run(CQ, R.agora())
  assert.equal((await S.processarFila({ deps })).processados, 1); assert.equal(efetivos(CQ).get('kit9'), 6, 'kit = 3 × 2 (vigente do componente)')
  const { criarConectorBling } = await import('../src/lib/erp-bling.js')
  const fx = nome => JSON.parse(readFileSync(new URL(`./fixtures/erp/bling-${nome}.json`, import.meta.url), 'utf8'))
  const lista = [...fx('produtos-pagina-1').data, ...fx('produtos-pagina-2').data], DET = fx('produtos-detalhe').detalhes
  const http = async ({ url }) => { const u = new URL(url), m = u.pathname.match(/\/produtos\/(\d+)$/)
    return { status: m && !DET[m[1]] ? 404 : 200, headers: {}, texto: JSON.stringify(m ? DET[m[1]] ?? {} : { data: u.searchParams.get('pagina') === '1' ? lista : [] }) } }
  const CB = 'Cliente Teto Kit'; conectar(CB, 'bling')
  const d2 = { criarConector: () => criarConectorBling({ http, limitador: { aguardar: async () => {}, registrar429: () => {} }, obterToken: async () => 'tok', log: () => {}, tetoDetalhes: 1 }) }
  assert.equal((await S.sincronizarCliente(CB, 'bling', { deps: d2 })).ok, true)
  const rk = rejeitada(CB, 'KIT-01')[0]
  assert.equal(rk?.codigo, 'kit_sem_estrutura'); assert.match(rk.motivo, /teto de detalhes/); assert.doesNotMatch(rk.motivo, /não entregou a composição/)
  R.db.prepare('DELETE FROM erp_fila WHERE cliente = ?').run(CB)
})

await okA('desconectar durante o sync: o sync termina sem desfazer o "desconectado" e o tick não volta a sincronizar', async () => {
  const CD2 = 'Cliente Desconecta'; conectar(CD2, 'bling')
  let soltar; const c = conta(CD2, 'bling', { paginas: [{ linhas: [L('D1', 1)] }, { linhas: [L('D2', 2)] }], falharNaPagina: 2, erro: 'sem token: conexão removida' })
  for (const falhar of [2, 0]) {
    C.gravarEstadoFonte(CD2, 'bling', { estado: 'conectado' }); c.falharNaPagina = falhar
    c.segurar = new Promise(r => { soltar = r })
    const p = S.sincronizarCliente(CD2, 'bling', { deps })
    await new Promise(r => setTimeout(r, 5))
    C.gravarEstadoFonte(CD2, 'bling', { estado: 'desconectado' })                  // o que desconectarErp → marcarFonte grava
    soltar(); const r = await p
    const est = C.estadoFonte(CD2, 'bling')
    assert.equal(est.estado, 'desconectado', `falhar=${falhar}: o desconectar do dono vale`); assert.equal(est.sync_estado, '')
    assert.equal(r.ok, !falhar)
  }
  const antes = c.chamadas
  await S.tickCustos({ agora: hoje(17), deps })
  assert.equal(c.chamadas, antes, 'fonte desconectada não volta ao tick')
})

await okA('auditoria e log: sync auditado, nenhum token/segredo no log', async () => {
  assert.ok(R.listarAuditoria(CL, { evento: 'custos_sync' }).length >= 3)
  assert.ok(!/token-fake|segredo123|abc\.def\.ghi/.test(logs.join('\n')))
})

console.log(`✔ teste-erp-sync: ${n} verificações OK`)
