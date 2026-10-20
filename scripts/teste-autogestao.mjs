// Autoteste da autogestão (docs/plano-autogestao.md, ações 1–3). Banco EM MEMÓRIA ou temporário, pastas temporárias, n8n STUB local — nada sai para WhatsApp/Discord/n8n reais.
//  (1) limiares: avaliar() por sinal (idade '>', contagem '≥', disco 'menor'), sem leitura = sem_dado (nunca ok), tick parado 3×/6×;
//  (2) incidente: abre no crítico/atenção, 1 por sinal, atualiza, fecha com 2 leituras ok, reabre; aviso só crítico ou avisar_sempre («sem token» 3×), 1/hora por sinal;
//      WhatsApp do Head só crítico e atrás da chave (desligada = nenhuma chamada); batimento.json sem segredo; GET /api/saude só no loopback sem cabeçalho de proxy;
//  (3) vigia.sh: crítico → 1 POST ao n8n (tipo incidente, x-place-key, nunca na linha de comando nem no log), máx. 1/hora por sinal, dry-run sem chave; rotação server.log ≤ 20 MB e vigia.log ≤ 1 MB;
//  (4) freio de disco do dev.sh: não sobe, escreve o motivo uma vez;
//  (5) arquivamento: prévia não muda nada; só move > N dias COM sha256 no livro e que confere; confere no destino; grava 'frio:' antes de remover; idempotente; sem FRIO_DIR não faz nada;
//  (5b) arquivamento streaming (ajudante stub): não subiu/evict falha/evict sem liberar → nada removido; subiu+evict → frio: e remove; lote; disco baixo para;
//  (6) backup: cifrado AES-256-GCM decifra igual, chave 0600 nunca impressa, retenção 14, sem BACKUP_DIR não faz nada;
//  (7) nova tentativa do Notion só em timeout/rede (4xx/5xx com status sobem na hora).
// Rodar: node scripts/teste-autogestao.mjs
process.env.PS_DB_MEMORIA = '1'
const assert = (await import('node:assert/strict')).default
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, truncateSync, utimesSync, readdirSync } = await import('node:fs')
const { join } = await import('node:path')
const { tmpdir } = await import('node:os')
const { createHash, randomBytes } = await import('node:crypto')
const { execFile } = await import('node:child_process')
const http = await import('node:http')
const Database = (await import('better-sqlite3')).default
const { avaliar, nivelDe, reconciliar, contarSemToken, contasPresas, tocaWhatsapp } = await import('../src/lib/saude-sistema.js')
const { criarSaudeSistema, lerCfg } = await import('../src/lib/saude-sistema-real.js')
const { soLoopback } = await import('../src/rotas-saude-sistema.js')
const { resolverArquivo } = await import('../src/lib/frio.js')
const { ehErroRede, comRetentativaRede } = await import('../src/lib/sync.js')

const RAIZ = new URL('..', import.meta.url).pathname
const TMP = mkdtempSync(join(tmpdir(), 'ps-autogestao-'))
const NODE = process.execPath
const run = (cmd, args, env = {}) => new Promise(ok => execFile(cmd, args, { env: { ...process.env, ...env }, cwd: RAIZ, timeout: 60_000 }, (e, so, se) => ok({ code: e ? (e.code ?? 1) : 0, out: String(so), err: String(se) })))
const sha = b => createHash('sha256').update(b).digest('hex')
let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); rmSync(TMP, { recursive: true, force: true }); throw e } }
const CFG = lerCfg()

try {
// ═════════ (1) limiares ═════════
await ok('limiares: idade usa >, contagem ≥, disco menor; sem leitura = sem_dado; ticks 3×/6× do período', () => {
  const L = CFG.limiares
  assert.equal(nivelDe(26, L['trinity.coleta_ml']), 'ok'); assert.equal(nivelDe(26.1, L['trinity.coleta_ml']), 'atencao'); assert.equal(nivelDe(31, L['trinity.coleta_ml']), 'critico')
  assert.equal(nivelDe(3.5, L['trinity.notion_sync']), 'atencao'); assert.equal(nivelDe(27, L['trinity.notion_sync']), 'critico')
  assert.equal(nivelDe(0, L['trinity.tokens']), 'ok'); assert.equal(nivelDe(1, L['trinity.tokens']), 'atencao'); assert.equal(nivelDe(5, L['trinity.tokens']), 'critico')
  assert.equal(nivelDe(20, L['trinity.disco']), 'ok'); assert.equal(nivelDe(10, L['trinity.disco']), 'atencao'); assert.equal(nivelDe(2.6, L['trinity.disco']), 'critico')
  assert.equal(nivelDe(null, L['trinity.disco']), 'sem_dado'); assert.equal(nivelDe(undefined, L['morpheus.n8n']), 'sem_dado')
  const av = avaliar({ 'trinity.coleta_ml': 1, ticks: { coleta: 25, gatilhos: 70, consultor: 5 } }, CFG), por = Object.fromEntries(av.map(s => [s.id, s]))
  assert.equal(por['trinity.coleta_ml'].estado, 'ok'); assert.equal(por['trinity.notion_sync'].estado, 'sem_dado', 'sem leitura nunca é ok')
  assert.equal(por['tick.coleta'].estado, 'ok'); assert.equal(por['tick.gatilhos'].estado, 'critico'); assert.equal(por['tick.relatorios'].estado, 'sem_dado')
  assert.ok(av.every(s => ['trinity', 'morpheus', 'merovingio'].includes(s.sistema)), 'só sistemas do catálogo')
})

// ═════════ (2) incidentes (puro + fiação com banco em memória) ═════════
await ok('reconciliar: abre 1 por sinal, fecha com 2 oks, aviso só crítico/avisar_sempre e no máximo 1 por hora (pisca-pisca não repete)', () => {
  const t0 = Date.parse('2026-10-15T03:00:00Z'), crit = [{ id: 'trinity.disco', sistema: 'trinity', estado: 'critico', valor: 2 }], aten = [{ id: 'trinity.notion_sync', sistema: 'trinity', estado: 'atencao', valor: 4 }]
  let r = reconciliar({ avaliacao: [...crit, ...aten], cfg: CFG, agoraMs: t0 })
  assert.equal(r.abrir.length, 2); assert.deepEqual(r.avisar.map(a => a.sinal_id), ['trinity.disco'], 'atenção não avisa')
  const abertos = [{ id: 1, sinal_id: 'trinity.disco', nivel: 'critico', oks_seguidos: 0, ultimo_aviso_em: new Date(t0).toISOString() }]
  r = reconciliar({ abertos, avaliacao: crit, cfg: CFG, agoraMs: t0 + 5 * 6e4 }); assert.equal(r.abrir.length + r.avisar.length, 0, 'crítico que continua não reabre nem reavisa')
  r = reconciliar({ abertos, avaliacao: [{ ...crit[0], estado: 'ok' }], cfg: CFG, agoraMs: t0 }); assert.equal(r.fechar.length, 0); assert.equal(r.atualizar[0].oks_seguidos, 1)
  r = reconciliar({ abertos: [{ ...abertos[0], oks_seguidos: 1 }], avaliacao: [{ ...crit[0], estado: 'ok' }], cfg: CFG, agoraMs: t0 }); assert.equal(r.fechar.length, 1, '2ª leitura ok fecha')
  r = reconciliar({ avaliacao: crit, ultimosAvisos: { 'trinity.disco': new Date(t0).toISOString() }, cfg: CFG, agoraMs: t0 + 20 * 6e4 })
  assert.equal(r.abrir.length, 1); assert.equal(r.avisar.length, 0, 'reabriu dentro da hora: sem aviso')
  r = reconciliar({ avaliacao: crit, ultimosAvisos: { 'trinity.disco': new Date(t0).toISOString() }, cfg: CFG, agoraMs: t0 + 61 * 6e4 }); assert.equal(r.avisar.length, 1, 'depois de 1 h avisa de novo')
  r = reconciliar({ abertos: [{ id: 2, sinal_id: 'trinity.notion_sync', nivel: 'atencao', oks_seguidos: 0, ultimo_aviso_em: '' }], avaliacao: [{ ...aten[0], estado: 'critico' }], cfg: CFG, agoraMs: t0 })
  assert.equal(r.avisar[0]?.motivo, 'escalou'); assert.ok(r.atualizar[0].sla_ate, 'escalou: prazo de crítico')
  r = reconciliar({ abertos, avaliacao: [{ ...crit[0], estado: 'sem_dado' }], cfg: CFG, agoraMs: t0 }); assert.equal(r.fechar.length + r.atualizar.length, 0, 'sem leitura não fecha')
  assert.equal(contasPresas(contarSemToken(contarSemToken(contarSemToken({}, [{ cliente: 'A', erro: 'sem token (falha transitória)' }]), [{ cliente: 'A', erro: 'sem token (falha transitória)' }]), [{ cliente: 'A', erro: 'x transitória' }])), 1)
  assert.equal(contasPresas(contarSemToken({ A: 2 }, [])), 0, 'renovou: zera'); assert.equal(contasPresas(contarSemToken({ A: 2 }, [{ cliente: 'A', erro: 'invalid_grant' }])), 0, 'definitiva não conta (vira conexão caída)')
  assert.equal(tocaWhatsapp('critico', CFG), false, 'chave nasce desligada'); assert.equal(tocaWhatsapp('critico', { whatsapp_critico_ligado: true }), true); assert.equal(tocaWhatsapp('atencao', { whatsapp_critico_ligado: true }), false)
})

await ok('fiação: incidentes na tabela (dono Head de canais, SLA), «sem token» 3× vira incidente com aviso, n8n 502 conta, WhatsApp só crítico e só com a chave, batimento sem segredo', async () => {
  const h = new Database(':memory:'); h.exec('CREATE TABLE sync_log (em TEXT, nivel TEXT, msg TEXT)')
  let ms = Date.parse('2026-10-15T03:00:00Z'); const agora = () => new Date(ms).toISOString()
  const est = new Map([['ultimo_sync', new Date(ms - 30 * 36e5).toISOString()], ['coleta_ml_em', new Date(ms - 36e5).toISOString()]])
  const avisos = [], posts = [], dir = join(TMP, 'saude'); mkdirSync(dir)
  const env = { PLACE_GATILHOS_URL: 'http://stub', PLACE_GATILHOS_SECRET: 's'.repeat(40), HEAD_CANAIS_WHATSAPP: '+55 13 99999-0000' }
  const mk = cfg => criarSaudeSistema({ handle: h, getEstado: k => est.get(k), agora, notificar: a => avisos.push(a), cfg, env, dirDados: dir, discoGb: () => 50, envio: { postar: async (c, p) => { posts.push(p); return { ok: true, status: 200 } } } })
  const s = mk({ ...CFG, whatsapp_critico_ligado: true })
  for (let i = 0; i < 3; i++) h.prepare('INSERT INTO sync_log VALUES (?,?,?)').run(agora(), 'erro', 'gatilhos X: lote imediato falhou (n8n_502) · 1 canal(is)')
  for (let i = 0; i < 3; i++) s.registrarRenovacao([{ cliente: 'Acme', erro: 'sem token (falha transitória)' }])
  await s.reconciliarAgora()
  const ab = s.listar().abertos, porSinal = Object.fromEntries(ab.map(i => [i.sinal_id, i]))
  assert.deepEqual(Object.keys(porSinal).sort(), ['morpheus.n8n', 'trinity.notion_sync', 'trinity.tokens'])
  assert.equal(porSinal['trinity.tokens'].nivel, 'atencao'); assert.equal(porSinal['morpheus.n8n'].nivel, 'critico'); assert.equal(porSinal['trinity.notion_sync'].dono, 'Head de canais')
  assert.equal(Date.parse(porSinal['trinity.notion_sync'].sla_ate) - ms, 4 * 36e5, 'SLA do crítico: 4 h')
  assert.equal(avisos.length, 3, 'crítico + «sem token» (avisar_sempre)'); assert.ok(avisos.every(a => a.tipo === 'incidente' && a.link === '/integracoes'))
  assert.equal(posts.length, 2, 'WhatsApp só nos 2 críticos'); assert.ok(posts.every(p => p.tipo === 'incidente' && p.interno === true && p.canais.whatsapp.destino === '5513999990000'))
  await s.reconciliarAgora(); assert.equal(avisos.length, 3, 'nada novo: sem aviso'); assert.equal(s.listar().abertos.length, 3, 'sem duplicar incidente')
  est.set('ultimo_sync', agora()); await s.reconciliarAgora(); assert.equal(s.listar().abertos.length, 3, '1ª leitura ok não fecha')
  await s.reconciliarAgora(); assert.equal(s.listar().abertos.length, 2, '2ª leitura ok fecha'); assert.equal(s.listar().resolvidos[0].resolvido_por, 'auto')
  ms += 10 * 6e4; est.set('ultimo_sync', new Date(ms - 30 * 36e5).toISOString()); await s.reconciliarAgora()
  assert.equal(avisos.length, 3, 'reabriu em menos de 1 h: incidente novo sem aviso'); assert.equal(s.listar().abertos.length, 3)
  // chave desligada: monta e NÃO chama o n8n
  const antes = posts.length, d = mk({ ...CFG, whatsapp_critico_ligado: false })
  assert.deepEqual(await d.avisarWhatsapp({ sinal_id: 'trinity.disco', sistema: 'trinity', nivel: 'critico', valor: 1 }), { estado: 'desligado' }); assert.equal(posts.length, antes)
  // batimento para o vigia
  await s.tick(); const b = JSON.parse(readFileSync(join(dir, 'batimento.json'), 'utf8'))
  assert.equal(b.coleta_ml_s, Math.floor((ms - 10 * 6e4 - 36e5) / 1000)); assert.ok(b.em_s > 0 && b.ticks.saude === 0)
  assert.ok(!JSON.stringify(b).includes('s'.repeat(20)) && !JSON.stringify(b).includes('99999'), 'batimento sem segredo nem telefone')
  const e = s.estado(); assert.ok(['ok', 'atencao', 'critico'].includes(e.geral)); assert.equal(e.whatsapp_critico_ligado, true)
})

await ok('GET /api/saude: só conexão do loopback e sem cabeçalho de proxy (o túnel do cloudflared conecta no loopback)', () => {
  const req = (ip, headers = {}) => ({ socket: { remoteAddress: ip }, headers })
  assert.equal(soLoopback(req('127.0.0.1')), true); assert.equal(soLoopback(req('::1')), true); assert.equal(soLoopback(req('::ffff:127.0.0.1')), true)
  assert.equal(soLoopback(req('192.168.0.5')), false); assert.equal(soLoopback(req('127.0.0.1', { 'cf-connecting-ip': '1.2.3.4' })), false); assert.equal(soLoopback(req('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), false)
})

// ═════════ (3) vigia.sh com n8n stub ═════════
const recebidos = []; let falharN8n = false
const stub = http.createServer((q, r) => { let c = ''; q.on('data', d => c += d); q.on('end', () => { if (q.url === '/webhook/place-gatilhos') recebidos.push({ h: q.headers, b: JSON.parse(c) }); r.writeHead(falharN8n && q.url === '/webhook/place-gatilhos' ? 502 : 200); r.end('{}') }) })
await new Promise(o => stub.listen(0, '127.0.0.1', o))
const PORTA = stub.address().port, SEG = 'k'.repeat(40)
const V = join(TMP, 'vg'); mkdirSync(join(V, 'data'), { recursive: true })
writeFileSync(join(V, 'data', 'batimento.json'), '{"em_s":1}'); writeFileSync(join(V, 'data', 'server.log'), 'x\n')
const vigia = (agora, extra = {}) => run('/bin/bash', [join(RAIZ, 'scripts/vigia.sh')], { PS_DIR: V, VIGIA_ENV_ARQUIVO: '/dev/null', VIGIA_URL: `http://127.0.0.1:${PORTA}/api/saude`,
  PLACE_GATILHOS_URL: `http://127.0.0.1:${PORTA}`, PLACE_GATILHOS_SECRET: SEG, VIGIA_ENVIO_LIGADO: '1', VIGIA_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/123456/abcDEF', HEAD_CANAIS_WHATSAPP: '',
  VIGIA_BATIMENTO_MAX_MIN: '100000000', VIGIA_LOG_MAX_H: '100000000', VIGIA_DISCO_CRITICO_GB: '0', VIGIA_AGORA: String(agora), ...extra })
const crits = () => recebidos.filter(x => /CRITICO/.test(x.b.texto)).length
await ok('vigia: disco crítico → 1 aviso ao n8n (incidente interno, x-place-key); continua crítico ou pisca dentro da hora = sem novo aviso; depois de 1 h avisa de novo', async () => {
  const t0 = Math.floor(Date.now() / 1000), CHEIO = { VIGIA_DISCO_CRITICO_GB: '100000' }
  await vigia(t0, CHEIO); assert.equal(crits(), 1)
  const p = recebidos[0]; assert.equal(p.h['x-place-key'], SEG); assert.equal(p.b.tipo, 'incidente'); assert.equal(p.b.interno, true)
  assert.ok(p.b.canais.discord && !p.b.canais.whatsapp, 'só os destinos configurados'); assert.deepEqual(p.b.discord_mencionar_cargos, ['1517119651522547774']); assert.match(p.b.texto, /Trinity · CRITICO: Disco/)
  await vigia(t0 + 300, CHEIO); assert.equal(crits(), 1, 'continua crítico: sem repetir')
  await vigia(t0 + 600); assert.equal(recebidos.filter(x => /normalizado/.test(x.b.texto)).length, 1, 'volta ao normal avisa uma vez')
  await vigia(t0 + 900, CHEIO); assert.equal(crits(), 1, 'pisca-pisca dentro da hora: suprimido')
  await vigia(t0 + 1200); await vigia(t0 + 4000, CHEIO); assert.equal(crits(), 2, 'mais de 1 h depois: avisa')
  const vl = readFileSync(join(V, 'data', 'vigia.log'), 'utf8')
  assert.ok(!vl.includes(SEG) && !vl.includes('discord.com'), 'segredo e destino nunca no log'); assert.match(vl, /suprimido/)
  assert.match(readFileSync(join(RAIZ, 'scripts/vigia.sh'), 'utf8'), /-H @<\(printf 'x-place-key: %s\\n' "\$secret"\)/, 'segredo por substituição de processo, nunca em argv')
})
await ok('vigia: n8n 502 no aviso crítico → tenta de novo no ciclo seguinte enquanto crítico (nada tinha sido entregue)', async () => {
  const t = Math.floor(Date.now() / 1000) + 50_000, CHEIO = { VIGIA_DISCO_CRITICO_GB: '100000' }, a = crits()
  await vigia(t - 300); falharN8n = true; await vigia(t, CHEIO); assert.equal(crits(), a + 1); assert.match(readFileSync(join(V, 'data', 'vigia.log'), 'utf8'), /aviso disco FALHOU \(n8n 502\)/)
  falharN8n = false; await vigia(t + 300, CHEIO); assert.equal(crits(), a + 2, 'retentou e entregou')
  await vigia(t + 600, CHEIO); assert.equal(crits(), a + 2, 'entregue: não repete')
  await vigia(t + 900)
})
await ok('vigia: sem VIGIA_ENVIO_LIGADO=1 é dry-run (nada sai); servidor sem resposta = crítico', async () => {
  const antes = recebidos.length, t = Math.floor(Date.now() / 1000) + 99_999
  await vigia(t, { VIGIA_ENVIO_LIGADO: '', VIGIA_URL: 'http://127.0.0.1:9/api/saude' })
  assert.equal(recebidos.length, antes); assert.match(readFileSync(join(V, 'data', 'vigia.log'), 'utf8'), /\[dry-run\] aviso servidor montado e NAO enviado/)
  assert.match(readFileSync(join(V, 'data', 'vigia.estado'), 'utf8'), /^servidor critico /m)
})
await ok('vigia: rotação — server.log > 20 MB fica vazio com os últimos 5 MB em server.log.1; vigia.log > 1 MB volta a ≤ 1 MB', async () => {
  const sl = join(V, 'data', 'server.log'), vl = join(V, 'data', 'vigia.log')
  writeFileSync(sl, 'inicio\n'); truncateSync(sl, 21 * 1024 * 1024); writeFileSync(vl, 'x'.repeat(1_100_000))   // arquivo esparso: não ocupa 21 MB de disco
  await vigia(Math.floor(Date.now() / 1000))
  assert.equal(statSync(sl).size, 0); assert.equal(statSync(sl + '.1').size, 5 * 1024 * 1024); assert.ok(statSync(vl).size <= 1024 * 1024)
  rmSync(sl + '.1')
})

// ═════════ (4) freio de disco do dev.sh ═════════
await ok('dev.sh: com disco abaixo do freio não sobe (sai 75), escreve o motivo UMA vez (marcador)', async () => {
  const D = join(TMP, 'dev'); mkdirSync(join(D, 'data'), { recursive: true })
  const env = { PS_DIR: D, PS_FREIO_KB: '999999999999', PS_FREIO_ESPERA: '0' }
  const a = await run('/bin/zsh', [join(RAIZ, 'scripts/dev.sh')], env), b = await run('/bin/zsh', [join(RAIZ, 'scripts/dev.sh')], env)
  assert.equal(a.code, 75); assert.equal(b.code, 75); assert.match(a.out, /freio de disco: .* servidor NAO iniciado/); assert.equal(b.out, '', 'segunda vez: silêncio')
  assert.ok(existsSync(join(D, 'data', '.freio-disco')))
  assert.match(readFileSync(join(RAIZ, 'automacao/com.place2u.place-sprints.servidor.plist'), 'utf8'), /<key>ThrottleInterval<\/key><integer>30<\/integer>/)
})

// ═════════ (5) arquivamento para o frio ═════════
await ok('arquivamento: prévia não muda nada; só > 30 d com sha256 no livro que confere; confere no destino; frio: antes de remover; idempotente; sem FRIO_DIR nada', async () => {
  const A = join(TMP, 'arq'), DADOS = join(A, 'data'), FRIO = join(A, 'frio'), dbp = join(DADOS, 'db.sqlite'); mkdirSync(join(DADOS, 'evidencias', 't1'), { recursive: true }); mkdirSync(FRIO)
  const h = new Database(dbp); h.exec(`CREATE TABLE evidencias (id TEXT PRIMARY KEY, tarefa_id TEXT, tipo TEXT, url_origem TEXT DEFAULT '', arquivo_local TEXT DEFAULT '', legenda TEXT DEFAULT '', criada_em TEXT DEFAULT '');
    CREATE TABLE registro_cliente (seq INTEGER PRIMARY KEY, tipo TEXT, ref TEXT, prova TEXT)`)
  const velho = '2026-07-01T10:00:00.000Z', novo = new Date().toISOString(), arq = {}
  for (const [id, quando, livro] of [['ok', velho, 'certo'], ['semlivro', velho, null], ['mudou', velho, 'errado'], ['recente', novo, 'certo'], ['outro', velho, 'outrocaminho']]) {
    const conteudo = Buffer.from(`anexo ${id} ${randomBytes(8).toString('hex')}`), rel = `evidencias/t1/${id}.png`
    writeFileSync(join(DADOS, rel), conteudo); arq[id] = { rel, sha: sha(conteudo) }
    h.prepare('INSERT INTO evidencias (id, tarefa_id, tipo, arquivo_local, criada_em) VALUES (?,?,?,?,?)').run(id, 't1', 'image', rel, quando)
    if (livro) h.prepare('INSERT INTO registro_cliente (tipo, ref, prova) VALUES (?,?,?)').run('anexo_tarefa', id, `arquivo:${livro === 'outrocaminho' ? 'evidencias/t1/x.png' : rel}#sha256:${livro === 'errado' ? sha('outra coisa') : sha(conteudo)}`)
  }
  h.close()
  const S = join(RAIZ, 'scripts/arquivar-evidencias.mjs'), base = ['--db', dbp, '--dados', DADOS], estado = () => { const x = new Database(dbp, { readonly: true }); const r = Object.fromEntries(x.prepare('SELECT id, arquivo_local FROM evidencias').all().map(r => [r.id, r.arquivo_local])); x.close(); return r }
  const antes = estado()
  const p = await run(NODE, [S, ...base], { FRIO_DIR: FRIO }); assert.equal(p.code, 0); assert.match(p.out, /MOVÍVEIS .*: 2 anexo/, 'prévia sem --conferir não relê o hash (o «mudou» só cai na conferência)'); assert.deepEqual(estado(), antes, 'prévia não muda o banco')
  assert.equal(readdirSync(FRIO).length, 0, 'prévia não copia')
  const semFrio = await run(NODE, [S, ...base, '--confirmar', '--mesmo-disco'], { FRIO_DIR: join(A, 'nao-existe') }); assert.equal(semFrio.code, 3); assert.match(semFrio.out, /INDISPONÍVEL — FRIO_DIR não existe/); assert.deepEqual(estado(), antes)
  const sd = await run(NODE, [S, ...base, '--confirmar'], { FRIO_DIR: FRIO }); assert.equal(sd.code, 3, 'mesmo disco sem --mesmo-disco: recusa'); assert.deepEqual(estado(), antes)
  const c = await run(NODE, [S, ...base, '--confirmar', '--mesmo-disco'], { FRIO_DIR: FRIO }); assert.equal(c.code, 0, c.err); assert.match(c.out, /movidos: 1 .*divergentes \(ficaram\): 1/)
  const e = estado(); assert.equal(e.ok, `frio:${arq.ok.sha}.png`); assert.ok(!existsSync(join(DADOS, arq.ok.rel)), 'local removido só depois')
  assert.equal(sha(readFileSync(join(FRIO, `${arq.ok.sha}.png`))), arq.ok.sha, 'destino íntegro')
  for (const id of ['semlivro', 'mudou', 'recente', 'outro']) { assert.equal(e[id], arq[id].rel, `${id} fica`); assert.ok(existsSync(join(DADOS, arq[id].rel)), `${id} continua no Mac`) }
  assert.equal(resolverArquivo(e.ok, { raizDados: DADOS, env: { FRIO_DIR: FRIO } }), join(FRIO, `${arq.ok.sha}.png`), 'o dossiê acha o frio')
  assert.equal(resolverArquivo(e.ok, { raizDados: DADOS, env: {} }), null, 'Drive fora: null, nunca quebra'); assert.equal(resolverArquivo('../../etc/passwd', { raizDados: DADOS }), null)
  const c2 = await run(NODE, [S, ...base, '--confirmar', '--mesmo-disco'], { FRIO_DIR: FRIO }); assert.match(c2.out, /movidos: 0 /, 'idempotente'); assert.deepEqual(estado(), e)
  // destino adulterado com o mesmo nome: não sobrescreve nem remove o local
  const id2 = 'adulterado', conteudo = Buffer.from('prova verdadeira'), rel = `evidencias/t1/${id2}.png`; writeFileSync(join(DADOS, rel), conteudo); writeFileSync(join(FRIO, `${sha(conteudo)}.png`), 'falsificado')
  const w = new Database(dbp); w.prepare('INSERT INTO evidencias (id, tarefa_id, tipo, arquivo_local, criada_em) VALUES (?,?,?,?,?)').run(id2, 't1', 'image', rel, velho); w.prepare('INSERT INTO registro_cliente (tipo, ref, prova) VALUES (?,?,?)').run('anexo_tarefa', id2, `arquivo:${rel}#sha256:${sha(conteudo)}`); w.close()
  const c3 = await run(NODE, [S, ...base, '--confirmar', '--mesmo-disco'], { FRIO_DIR: FRIO }); assert.match(c3.out, /destino existente com hash diferente/); assert.ok(existsSync(join(DADOS, rel))); assert.equal(estado()[id2], rel)
  // teto da passada
  const c4 = await run(NODE, [S, ...base, '--confirmar', '--mesmo-disco', '--max-gb', '0.000000001'], { FRIO_DIR: FRIO }); assert.match(c4.out, /parou: teto da passada/)
})

// ═════════ (5b) arquivamento em streaming (Drive File Provider) com ajudante STUB ═════════
await ok('arquivamento streaming: não subiu → nada removido; subiu+evict ok → frio: e remove; evict falha → nada removido; disco baixo → para', async () => {
  const A = join(TMP, 'arqs'), DADOS = join(A, 'data'), FRIO = join(A, 'frio'), dbp = join(DADOS, 'db.sqlite'); mkdirSync(join(DADOS, 'evidencias', 't1'), { recursive: true }); mkdirSync(FRIO)
  // stub do scripts/bin/frio-evict: STUB_MODO = nao_subiu | ok | evict_falha | nao_libera; evict grava <arquivo>.evicted (alocado 0)
  const stubp = join(A, 'frio-evict-stub.mjs'); writeFileSync(stubp, `#!${NODE}
import fs from 'node:fs'; const [sub, ...arqs] = process.argv.slice(2), modo = process.env.STUB_MODO
const st = f => fs.existsSync(f) ? { arquivo: f, existe: true, uploaded: modo !== 'nao_subiu', alocado: fs.existsSync(f + '.evicted') && modo !== 'nao_libera' ? 0 : fs.statSync(f).size, download: fs.existsSync(f + '.evicted') ? 'NSURLUbiquitousItemDownloadingStatusNotDownloaded' : 'NSURLUbiquitousItemDownloadingStatusCurrent' } : { arquivo: f, existe: false }
if (sub === 'status') console.log(JSON.stringify(arqs.map(st)))
else { const s = st(arqs[0]); if (!s.uploaded) { console.error('nao_subiu'); process.exit(2) } if (modo === 'evict_falha') { console.error('evict_falhou: x'); process.exit(3) } fs.writeFileSync(arqs[0] + '.evicted', ''); console.log(JSON.stringify(st(arqs[0]))) }
`, { mode: 0o755 })
  const h = new Database(dbp); h.exec(`CREATE TABLE evidencias (id TEXT PRIMARY KEY, tarefa_id TEXT, tipo TEXT, url_origem TEXT DEFAULT '', arquivo_local TEXT DEFAULT '', legenda TEXT DEFAULT '', criada_em TEXT DEFAULT '');
    CREATE TABLE registro_cliente (seq INTEGER PRIMARY KEY, tipo TEXT, ref TEXT, prova TEXT)`)
  const arq = {}
  for (const id of ['a', 'b']) {
    const conteudo = Buffer.from(`anexo streaming ${id} ${randomBytes(8).toString('hex')}`), rel = `evidencias/t1/${id}.jpg`
    writeFileSync(join(DADOS, rel), conteudo); arq[id] = { rel, sha: sha(conteudo) }
    h.prepare('INSERT INTO evidencias (id, tarefa_id, tipo, arquivo_local, criada_em) VALUES (?,?,?,?,?)').run(id, 't1', 'image', rel, '2026-07-01T10:00:00.000Z')
    h.prepare('INSERT INTO registro_cliente (tipo, ref, prova) VALUES (?,?,?)').run('anexo_tarefa', id, `arquivo:${rel}#sha256:${sha(conteudo)}`)
  }
  h.close()
  const S = join(RAIZ, 'scripts/arquivar-evidencias.mjs'), base = [S, '--db', dbp, '--dados', DADOS, '--confirmar', '--streaming', '--espera-min', '0.01', '--intervalo-s', '0.1', '--evict-espera-s', '0.3']
  const estado = () => { const x = new Database(dbp, { readonly: true }); const r = Object.fromEntries(x.prepare('SELECT id, arquivo_local FROM evidencias').all().map(r => [r.id, r.arquivo_local])); x.close(); return r }
  const env = modo => ({ FRIO_DIR: FRIO, FRIO_EVICT_BIN: stubp, STUB_MODO: modo }), intacto = msg => { assert.deepEqual(estado(), { a: arq.a.rel, b: arq.b.rel }, msg); for (const id of ['a', 'b']) assert.ok(existsSync(join(DADOS, arq[id].rel)), `${msg}: ${id} continua no Mac`) }
  const dl = await run(NODE, [...base, '--min-livre-gb', '100000'], env('ok')); assert.equal(dl.code, 11, dl.err + dl.out); assert.match(dl.out, /parou: disco livre abaixo/); intacto('disco baixo'); assert.equal(readdirSync(FRIO).length, 0, 'disco baixo: nem copia')
  const ns = await run(NODE, base, env('nao_subiu')); assert.equal(ns.code, 11, ns.err + ns.out); assert.match(ns.out, /teto de espera .*2 arquivo\(s\) ainda não subiram/); intacto('não subiu')
  assert.equal(readdirSync(FRIO).filter(f => !f.endsWith('.evicted')).length, 2, 'cópias ficam no Drive para a próxima passada')
  const ef = await run(NODE, base, env('evict_falha')); assert.equal(ef.code, 11, ef.err + ef.out); assert.match(ef.out, /evict falhou/); intacto('evict falha')
  const nl = await run(NODE, base, env('nao_libera')); assert.equal(nl.code, 11, nl.err + nl.out); assert.match(nl.out, /evict não liberou/); intacto('evict sem liberar')
  for (const f of readdirSync(FRIO)) if (f.endsWith('.evicted')) rmSync(join(FRIO, f))
  const lote = await run(NODE, [...base, '--max-gb', String((statSync(join(DADOS, arq.a.rel)).size + 1) / 1e9)], env('ok')); assert.equal(lote.code, 0, lote.err + lote.out)
  let e = estado(); assert.equal(e.a, `frio:${arq.a.sha}.jpg`); assert.equal(e.b, arq.b.rel, 'lote: só 1 cabe'); assert.ok(!existsSync(join(DADOS, arq.a.rel)), 'a removido depois do frio:')
  const ok2 = await run(NODE, base, env('ok')); assert.equal(ok2.code, 0); e = estado(); assert.equal(e.b, `frio:${arq.b.sha}.jpg`); assert.ok(!existsSync(join(DADOS, arq.b.rel)))
  assert.match(readFileSync(join(DADOS, 'arquivar.log'), 'utf8'), /movidos: 1/, 'log em data/arquivar.log')
  const fim = await run(NODE, base, env('ok')); assert.equal(fim.code, 10, 'movíveis 0 → 10'); assert.deepEqual(estado(), e, 'idempotente')
  // mesmo conteúdo de um anexo já no frio (despejado): reaproveita o blob sem regravar por cima
  const dup = new Database(dbp), relc = 'evidencias/t1/c.jpg'; writeFileSync(join(DADOS, relc), readFileSync(join(FRIO, `${arq.a.sha}.jpg`)))
  dup.prepare('INSERT INTO evidencias (id, tarefa_id, tipo, arquivo_local, criada_em) VALUES (?,?,?,?,?)').run('c', 't1', 'image', relc, '2026-07-01T10:00:00.000Z'); dup.prepare('INSERT INTO registro_cliente (tipo, ref, prova) VALUES (?,?,?)').run('anexo_tarefa', 'c', `arquivo:${relc}#sha256:${arq.a.sha}`); dup.close()
  const dc = await run(NODE, base, env('ok')); assert.equal(dc.code, 0, dc.err + dc.out); assert.match(dc.out, /1 já estavam no Drive/); assert.equal(estado().c, `frio:${arq.a.sha}.jpg`); assert.ok(!existsSync(join(DADOS, relc)))
  // runner a cada 15 min
  assert.match(readFileSync(join(RAIZ, 'automacao/com.place2u.place-sprints.arquivar.plist'), 'utf8'), /<key>StartInterval<\/key><integer>900<\/integer>/)
})

// ═════════ (6) backup cifrado ═════════
await ok('backup: AES-256-GCM decifra igual ao banco, chave 0600 nunca impressa, retenção 14, sem BACKUP_DIR não faz nada', async () => {
  const B = join(TMP, 'bk'), dbp = join(B, 'db.sqlite'), dest = join(B, 'drive'), chave = join(B, 'chave', 'backup.key'); mkdirSync(dest, { recursive: true })
  const h = new Database(dbp); h.pragma('journal_mode = WAL'); h.exec('CREATE TABLE t (x TEXT)'); for (let i = 0; i < 500; i++) h.prepare('INSERT INTO t VALUES (?)').run(`linha ${i}`)
  for (let d = 1; d <= 15; d++) writeFileSync(join(dest, `place-sprints-2020-01-${String(d).padStart(2, '0')}T0230.db.enc`), 'velho')
  writeFileSync(join(dest, 'outro-arquivo.txt'), 'não é backup')
  const S = join(RAIZ, 'scripts/backup-banco.mjs'), base = [S, '--db', dbp, '--chave', chave]
  const pv = await run(NODE, base, { BACKUP_DIR: dest }); assert.equal(pv.code, 0); assert.match(pv.out, /PRÉVIA/); assert.ok(!existsSync(chave), 'prévia não cria a chave')
  const sem = await run(NODE, [...base, '--confirmar'], { BACKUP_DIR: '' }); assert.equal(sem.code, 3); assert.ok(!existsSync(chave))
  const r = await run(NODE, [...base, '--confirmar'], { BACKUP_DIR: dest }); assert.equal(r.code, 0, r.err + r.out)
  assert.equal(statSync(chave).mode & 0o777, 0o600); const k = readFileSync(chave); assert.equal(k.length, 32)
  assert.ok(![k.toString('hex'), k.toString('base64')].some(x => (r.out + r.err).includes(x)), 'chave nunca impressa')
  const encs = readdirSync(dest).filter(x => x.endsWith('.db.enc')).sort(); assert.equal(encs.length, 14, 'retenção 14'); assert.ok(existsSync(join(dest, 'outro-arquivo.txt')), 'só apaga backups')
  const novo = join(dest, encs.at(-1)), bytes = readFileSync(novo); assert.equal(bytes.subarray(0, 6).toString(), 'PSBK1\0'); assert.ok(!bytes.includes(Buffer.from('linha 42')), 'cifrado: sem texto claro')
  const para = join(B, 'restaurado.sqlite'), d = await run(NODE, [...base, '--decifrar', novo, '--para', para]); assert.equal(d.code, 0, d.err)
  const x = new Database(para, { readonly: true }); assert.equal(x.prepare('SELECT COUNT(*) n FROM t').get().n, 500); assert.equal(x.prepare("SELECT x FROM t WHERE rowid = 43").get().x, 'linha 42'); x.close()
  const adult = Buffer.from(bytes); adult[40] ^= 1; writeFileSync(join(B, 'adult.enc'), adult)
  const ad = await run(NODE, [...base, '--decifrar', join(B, 'adult.enc'), '--para', join(B, 'x.sqlite')]); assert.notEqual(ad.code, 0, 'adulterado não decifra (tag GCM)')
  assert.equal(readdirSync(tmpdir()).filter(f => f.startsWith('ps-backup-')).length, 0, 'temporário apagado')
  h.close()
})

// ═════════ (7) nova tentativa do Notion só em rede ═════════
await ok('Notion: timeout/rede tenta de novo com backoff; HTTP com status e token ausente sobem na hora', async () => {
  const to = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  assert.equal(ehErroRede(to), true); assert.equal(ehErroRede(new TypeError('fetch failed')), true)
  assert.equal(ehErroRede(Object.assign(new Error('Notion 400'), { status: 400 })), false); assert.equal(ehErroRede(Object.assign(new Error('NOTION_TOKEN ausente'), { status: 0 })), false)
  let n1 = 0, esperas = []; const r = await comRetentativaRede(async () => { if (++n1 < 3) throw to; return 'ok' }, { dormir: async ms => esperas.push(ms) })
  assert.equal(r, 'ok'); assert.equal(n1, 3); assert.equal(esperas.length, 2); assert.ok(esperas[1] > esperas[0])
  let n2 = 0; await assert.rejects(comRetentativaRede(async () => { n2++; throw Object.assign(new Error('Notion 404'), { status: 404 }) }, { dormir: async () => {} })); assert.equal(n2, 1)
  let n3 = 0; await assert.rejects(comRetentativaRede(async () => { n3++; throw to }, { dormir: async () => {} })); assert.equal(n3, 4, 'teto de 4 tentativas')
})

stub.close()
console.log(`\n${n} verificações da autogestão ok.`)
} finally { rmSync(TMP, { recursive: true, force: true }) }
