// Autoteste do livro de execução + runner («Neo aprende sobre si», Fase 1). Banco EM MEMÓRIA; o runner roda sobre uma pasta temporária com 2 fixtures.
//  (1) livro: abrir/fechar grava 1 linha com ms/ok/total/falhas/versão; fechar 2× não duplica; resumo (n, p50, p95, taxa_falha); ultima({ok:true}) ignora a vermelha; contar; podar; gravar nunca lança;
//  (2) saúde: sem livro os 3 sinais novos são sem_dado (nunca ok); com livro, suíte verde recente = ok, 3 boots = atenção, coleta de 300 min = crítico; estado() expõe execucoes e versao;
//  (3) runner: pasta com 1 teste verde + 1 vermelho → sai 1, imprime ✓/✗ e o nome do vermelho; --sem-banco não grava; só verde → sai 0; --so filtra.
// Rodar: node scripts/teste-execucao-sistema.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const { execFile } = await import('node:child_process')
const Database = (await import('better-sqlite3')).default
const { criarLivroExecucao, gravar, SCHEMA_EXECUCAO, versaoGit } = await import('../src/lib/execucao-sistema.js')
const { criarSaudeSistema, lerCfg } = await import('../src/lib/saude-sistema-real.js')
const { avaliar } = await import('../src/lib/saude-sistema.js')

const RAIZ = new URL('..', import.meta.url).pathname
const run = (args, env = {}) => new Promise(ok => execFile(process.execPath, args, { env: { ...process.env, ...env }, cwd: RAIZ, timeout: 60_000 }, (e, so, se) => ok({ code: e ? (e.code ?? 1) : 0, out: String(so) + String(se) })))
let n = 0, falhou = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log(`✓ ${nome}`) } catch (e) { falhou++; console.log(`✗ ${nome}\n  ${e.message}`) } }

// relógio controlado
let t = Date.parse('2026-11-04T10:00:00.000Z')
const agora = () => new Date(t).toISOString()

await ok('livro: abrir/fechar, resumo, ultima, contar, podar, gravar nunca lança', () => {
  const h = new Database(':memory:')
  const livro = criarLivroExecucao({ handle: h, agora, versao: 'abc123' })
  const e = livro.abrir('trinity', 'coleta_ml', { origem: 'teste' }); t += 90 * 6e4
  const id = e.fechar({ ok: 40, total: 44, falhas: 4, detalhe: { dia_fechado: true } })
  assert.ok(id > 0); assert.equal(e.fechar({ ok: 1 }), null, 'fechar 2× não duplica')
  const l = h.prepare('SELECT * FROM execucao_sistema').all(); assert.equal(l.length, 1)
  assert.equal(l[0].ms, 90 * 6e4); assert.equal(l[0].versao, 'abc123'); assert.deepEqual(JSON.parse(l[0].detalhe_json), { origem: 'teste', dia_fechado: true })
  t += 36e5; livro.abrir('trinity', 'coleta_ml').fechar({ ok: 44, total: 44, falhas: 0 })
  const r = livro.resumo('coleta_ml', 7); assert.equal(r.n, 2); assert.equal(r.p50_ms, 0); assert.equal(r.p95_ms, 90 * 6e4); assert.equal(r.taxa_falha, 4 / 88)
  assert.equal(livro.resumo('nada', 7).n, 0); assert.equal(livro.resumo('nada').p95_ms, null)
  livro.gravar({ sistema: 'arquiteto', operacao: 'testes', inicio: agora(), fim: agora(), ms: 5, ok: 10, total: 12, falhas: 2 })
  assert.equal(livro.ultima('testes').falhas, 2); assert.equal(livro.ultima('testes', { ok: true }), null, 'nenhuma verde ainda')
  t += 1000; livro.gravar({ sistema: 'arquiteto', operacao: 'testes', inicio: agora(), fim: agora(), ms: 5, ok: 12, total: 12, falhas: 0 })
  assert.equal(livro.ultima('testes', { ok: true }).ok, 12)
  for (let i = 0; i < 3; i++) livro.gravar({ sistema: 'trinity', operacao: 'boot', inicio: agora(), fim: agora(), ms: 0 })
  assert.equal(livro.contar('boot', 24), 3)
  t += 200 * 864e5; assert.equal(livro.podar(180), 7, 'poda o que passou de 180 d (2 coletas + 2 testes + 3 boots)'); assert.equal(h.prepare('SELECT COUNT(*) n FROM execucao_sistema').get().n, 0)
  assert.equal(gravar({ prepare() { throw new Error('banco fechado') } }, { sistema: 'x', operacao: 'y', inicio: agora() }), null, 'gravar nunca lança')
  assert.equal(typeof versaoGit(RAIZ), 'string'); assert.equal(versaoGit('/nao/existe'), '')
})

await ok('saúde: sinais novos sem_dado sem livro; ok/atenção/crítico com livro; estado() expõe execucoes e versao', () => {
  const cfg = lerCfg()
  for (const id of ['trinity.coleta_duracao', 'trinity.reinicios', 'arquiteto.testes']) assert.ok(cfg.limiares[id], `limiar ${id} em config/autogestao.json`)
  const h = new Database(':memory:'); h.exec('CREATE TABLE sync_log (em TEXT, nivel TEXT, msg TEXT)')
  const est = new Map(), getEstado = k => est.get(k)
  const sem = criarSaudeSistema({ handle: h, getEstado, agora, cfg, env: {}, discoGb: () => 20 })
  const av = Object.fromEntries(avaliar(sem.sinais(), cfg).map(s => [s.id, s.estado]))
  assert.deepEqual([av['trinity.coleta_duracao'], av['trinity.reinicios'], av['arquiteto.testes']], ['sem_dado', 'sem_dado', 'sem_dado'])
  const livro = criarLivroExecucao({ handle: h, agora, versao: 'v1' })
  const com = criarSaudeSistema({ handle: h, getEstado, agora, cfg, env: {}, discoGb: () => 20, livro })
  livro.gravar({ sistema: 'arquiteto', operacao: 'testes', inicio: agora(), fim: agora(), ms: 1, ok: 5, total: 5, falhas: 0 })
  const c = livro.abrir('trinity', 'coleta_ml'); t += 300 * 6e4; c.fechar({ ok: 1, total: 1, falhas: 0 })
  for (let i = 0; i < 3; i++) livro.gravar({ sistema: 'trinity', operacao: 'boot', inicio: agora(), fim: agora(), ms: 0 })
  const av2 = Object.fromEntries(avaliar(com.sinais(), cfg).map(s => [s.id, s.estado]))
  assert.equal(av2['arquiteto.testes'], 'ok'); assert.equal(av2['trinity.reinicios'], 'atencao'); assert.equal(av2['trinity.coleta_duracao'], 'critico')
  t += 40 * 36e5; assert.equal(Object.fromEntries(avaliar(com.sinais(), cfg).map(s => [s.id, s.estado]))['arquiteto.testes'], 'atencao', '40 h sem suíte verde')
  const e = com.estado(); assert.equal(e.versao, 'v1'); assert.equal(e.execucoes.coleta_ml.n, 1); assert.equal(e.execucoes.testes.n, 1)
})

await ok('runner: 1 verde + 1 vermelho sai 1 e nomeia o vermelho; --so filtra; só verde sai 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-testar-'))
  writeFileSync(join(dir, 'teste-verde.mjs'), "if (process.env.PS_DB_MEMORIA !== '1') process.exit(3); console.log('ok')\n")
  writeFileSync(join(dir, 'teste-vermelho.mjs'), "console.error('explodiu de propósito'); process.exit(1)\n")
  const r = await run([join(RAIZ, 'scripts', 'testar.mjs'), '--sem-banco', '--dir', dir])
  assert.equal(r.code, 1); assert.match(r.out, /✓ teste-verde/); assert.match(r.out, /✗ teste-vermelho/); assert.match(r.out, /1\/2 ok/); assert.match(r.out, /explodiu de propósito/)
  const so = await run([join(RAIZ, 'scripts', 'testar.mjs'), '--sem-banco', '--dir', dir, '--so', 'verde'])
  assert.equal(so.code, 0); assert.match(so.out, /1\/1 ok/); assert.doesNotMatch(so.out, /vermelho/)
  rmSync(dir, { recursive: true, force: true })
})

console.log(`\n${n} ok, ${falhou} falha(s)`)
process.exit(falhou ? 1 : 0)
