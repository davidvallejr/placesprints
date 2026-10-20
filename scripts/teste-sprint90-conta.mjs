// Autoteste da CONTA do Place Sprint 90 (fase F1, teste 2 do desenho): chave fora do prospect e da central, dentro da coleta e fora de backup/arquivo/restauração;
// cadastro pela equipe (termos obrigatórios; rascunho só para piloto), aceite registrado, vagas em transação, sessão só por hash, link de uso único que vence,
// sair revoga, vendedor duplicado bloqueado, exclusão LGPD na ordem (MP → revogação → apaga tudo da chave → anonimiza, faturas ficam, purga de tokens em arquivo),
// MP fora = exclusão agendada, expurgo (7 dias / 90 dias / IPs de 12 meses), ledger 0600; HTTP: cookie, isolamento A × B (?cliente= ignorado), rotas internas.
// Banco em memória, relógio injetado, revogação/MP falsos: nada chama o ML nem o Mercado Pago. Rodar: node scripts/teste-sprint90-conta.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
process.env.PS_OFERTAS_MEMORIA = '1'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, statSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const { db } = await import('../src/lib/db.js')
const { env, ROOT } = await import('../src/lib/env.js')
const { criarS90 } = await import('../src/lib/s90.js')
const { ehChaveS90 } = await import('../src/lib/s90-chave.js')
const { ehChaveProspecto } = await import('../src/lib/comercial.js')
const MC = await import('../src/lib/meli-contas.js')
const { criarRotasSprint90 } = await import('../src/rotas-sprint90.js')
const { guardaLocal } = await import('../src/lib/guarda-local.js')

const cfg = { ...JSON.parse(readFileSync(join(ROOT, 'config', 'sprint90.json'), 'utf8')), turma_fundadora: { vagas: 4, preco_travado_meses: 12 } }
let AGORA = Date.parse('2026-10-08T12:00:00.000Z')
const agora = () => new Date(AGORA).toISOString(), hoje = () => agora().slice(0, 10)
let TERMOS = { versao: 's90-v1', hash: 'h1', texto: '## Termos\n\ntexto', rascunho: false }
const ordem = [], avisos = []
let mpOk = true
const mp = { atualizarPreapproval: async (id, b) => { ordem.push(`mp:${b.status}`); return mpOk } }
const dirLedger = mkdtempSync(join(tmpdir(), 's90-ledger-'))
const s90 = criarS90({ handle: db, cfg, agora, hoje, notificar: n => avisos.push(n), termos: () => TERMOS, mp, dirBackup: dirLedger,
  conexao: { status: MC.statusConexao, revogar: async chave => { ordem.push('revogar'); return true }, desconectar: MC.desconectar, purgarPendentes: MC.purgarPendentesDe } })
const sha = t => createHash('sha256').update(t).digest('hex')
const conectarFalso = (chave, user = 999, app = 'app-teste') => MC.salvarConexao(chave, { user_id: user, access_token: 'tk-falso', refresh_token: 'rf-falso', expires_in: 21600, scope: 'read write', app_id: app }, { nickname: 'NICK' })
const nova = (o = {}, opts = {}) => s90.cadastrar({ nome: 'Ana Teste', loja: 'Loja Teste', email: 'ana@teste.com', plano: 'fixo', ...o }, { por: 'Líder Teste', ...opts })
const aceitar = c => s90.registrarAceite(c.id, { aceite: true, consentimento: true, ip: '1.2.3.4', ua: 'UA-teste' })

// 1) chave: nunca é prospect; entra na coleta (listarConexoes); fora do backup, do arquivo e da restauração
const c1 = nova()
assert.ok(ehChaveS90(c1.chave) && /^\[S90\] Loja Teste · [0-9a-f]{8}$/.test(c1.chave)); assert.ok(!ehChaveProspecto(c1.chave), 'S90 nunca é prospect do Comercial')
assert.equal(c1.estado, 'pendente_pagamento'); assert.equal(c1.preco_centavos, cfg.planos.fixo.centavos); assert.equal(c1.piloto, 0)
conectarFalso(c1.chave)
assert.ok(MC.listarConexoes().some(x => x.cliente === c1.chave), 'conta S90 entra na coleta diária/renovação (listarConexoes)')
assert.equal(db.prepare('SELECT COUNT(*) n FROM clientes_central WHERE cliente = ?').get(c1.chave).n, 0, 'nunca na central')
const bk = MC.backupConexoes('2099-01-01')
assert.equal(bk.n, 0, 'conexão S90 fica fora do backup de tokens'); assert.ok(bk.pulado)
MC.desconectar(c1.chave)
assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_contas_arquivo WHERE cliente = ?').get(c1.chave).n, 0, 'desconectar S90 não arquiva tokens')
db.prepare('INSERT INTO meli_contas_arquivo (cliente, linha_json, motivo, arquivado_em) VALUES (?,?,?,?)').run(c1.chave, JSON.stringify({ cliente: c1.chave, meli_user_id: 1, access_token: 'x', refresh_token: 'y', expira_em: agora(), erro: '' }), 'teste', agora())
assert.deepEqual(MC.restaurarConexoes({ clientes: [c1.chave], origem: 'arquivada' }), [], 'restauração recusa chave S90')
db.prepare('DELETE FROM meli_contas_arquivo WHERE cliente = ?').run(c1.chave)

// 2) cadastro: termos obrigatórios; rascunho só para piloto/demonstração; validação; vagas em transação; e-mail repetido = outro cadastro
TERMOS = null
assert.throws(() => nova(), e => e.status === 503 && /não publicados/.test(e.message), 'sem termos = cadastro bloqueado (503)')
TERMOS = { versao: 's90-v1', hash: 'h-rasc', texto: '# RASCUNHO\n\nx', rascunho: true }
assert.throws(() => nova(), e => e.status === 503, 'termos em RASCUNHO: conta normal bloqueada')
assert.throws(() => nova({}, { piloto: 'true' }), e => e.status === 503, 'piloto só com true estrito')
const piloto = nova({ loja: 'Loja Piloto' }, { piloto: true })
assert.equal(piloto.piloto, 1)
assert.ok(s90.aceitePendente(piloto) && !!s90.termosPara(piloto), 'piloto pode aceitar o rascunho')
assert.throws(() => aceitar(c1), e => e.status === 503, 'conta normal NÃO aceita rascunho')
aceitar(piloto); assert.ok(!s90.aceitePendente(s90.contaPorId(piloto.id)))
assert.equal(JSON.parse(db.prepare("SELECT detalhe_json FROM s90_evento WHERE conta_id = ? AND tipo = 'aceite'").get(piloto.id).detalhe_json).rascunho, true, 'aceite registra que era rascunho')
TERMOS = { versao: 's90-v1', hash: 'h1', texto: '## Termos\n\ntexto', rascunho: false }
assert.ok(s90.aceitePendente(s90.contaPorId(piloto.id)), 'termo publicado (hash novo) pede aceite de novo')
for (const ruim of [{ email: 'x' }, { nome: '' }, { loja: { $ne: 1 } }, { plano: 'premium' }]) assert.throws(() => nova(ruim), e => e.status === 400, JSON.stringify(ruim))
const antes = db.prepare('SELECT COUNT(*) n FROM s90_conta').get().n
const c2 = nova({ email: 'ana@teste.com', loja: 'Outra Loja' })                    // mesmo e-mail: outro cadastro, resposta neutra
assert.notEqual(c2.id, c1.id); const c3 = nova({ loja: 'Terceira', plano: 'crescimento' })
assert.equal(c3.comissao_pct, cfg.planos.crescimento.comissao_pct); assert.equal(s90.vagas().restantes, 0)
assert.throws(() => nova({ loja: 'Quinta' }), e => e.status === 409 && /Turma completa/.test(e.message), '5º cadastro com 4 vagas recusado')
assert.equal(db.prepare('SELECT COUNT(*) n FROM s90_conta').get().n, antes + 2, 'recusado não deixa linha')
assert.equal(s90.previa({ nome: 'X', loja: 'Y', email: 'x@y.com', plano: 'fixo' }).vagas.restantes, 0); assert.equal(db.prepare('SELECT COUNT(*) n FROM s90_conta').get().n, antes + 2, 'prévia não grava')

// 3) aceite: precisa dos dois checkboxes; grava versão, hash, IP, UA, consentimento e os eventos
assert.throws(() => s90.registrarAceite(c1.id, { aceite: true, consentimento: false }), /aceite os termos/)
assert.throws(() => s90.registrarAceite(c1.id, { aceite: 'true', consentimento: true }), /aceite os termos/)
const a1 = aceitar(c1)
assert.deepEqual([a1.termos_versao, a1.termos_hash, a1.aceite_ip, a1.aceite_ua, a1.consentimento_versao], ['s90-v1', 'h1', '1.2.3.4', 'UA-teste', 'lgpd-s90-v1']); assert.ok(a1.aceite_em && a1.consentimento_em)
const evA = JSON.parse(db.prepare("SELECT detalhe_json FROM s90_evento WHERE conta_id = ? AND tipo = 'aceite'").get(c1.id).detalhe_json)
assert.deepEqual([evA.versao, evA.hash, evA.email, evA.plano, evA.preco_centavos], ['s90-v1', 'h1', 'ana@teste.com', 'fixo', cfg.planos.fixo.centavos])
assert.equal(db.prepare("SELECT COUNT(*) n FROM s90_evento WHERE conta_id = ? AND tipo = 'consentimento'").get(c1.id).n, 1)

// 4) estados: ativar marca o dia 1 e o preço travado; transição inválida recusada; dia/fase pelo calendário
assert.ok(!s90.podeConectar(c1.chave), 'pendente não conecta')
assert.throws(() => s90.mudarEstado(c1.id, 'excluido', { por: 'X' }), e => e.status === 409)
const at = s90.mudarEstado(c1.id, 'ativo', { por: 'Líder Teste', motivo: 'piloto sem MP' })
assert.deepEqual([at.estado, at.inicio_em, at.preco_travado_ate], ['ativo', '2026-10-08', '2027-10-08']); assert.ok(s90.podeConectar(c1.chave))
AGORA += 35 * 86400e3; assert.deepEqual(s90.diaFase(s90.contaPorId(c1.id)), { dia: 36, total: 90, fase: 'Evolução' }); AGORA -= 35 * 86400e3

// 5) sessão e link de acesso
const L1 = s90.gerarAcesso(c1.id, { origem: 'equipe', por: 'Líder Teste' })
assert.match(L1.token, /^[A-Za-z0-9_-]{22}$/)
assert.ok(db.prepare('SELECT 1 FROM s90_acesso WHERE token_hash = ?').get(sha(L1.token)) && !db.prepare('SELECT 1 FROM s90_acesso WHERE token_hash = ?').get(L1.token), 'link: só o hash no banco')
const login = s90.consumirAcesso(L1.token, { ip: '5.6.7.8' })
assert.equal(login.conta.id, c1.id); assert.equal(s90.consumirAcesso(L1.token), null, 'link de uso único: 2º uso = nada')
assert.ok(db.prepare('SELECT 1 FROM s90_sessao WHERE token_hash = ?').get(sha(login.token)) && !JSON.stringify(db.prepare('SELECT * FROM s90_sessao').all()).includes(login.token), 'sessão: só o hash')
assert.equal(s90.sessaoDe(login.token).id, c1.id); assert.equal(s90.sessaoDe('x'.repeat(22)), null); assert.equal(s90.sessaoDe("' OR 1=1 --"), null)
const L2 = s90.gerarAcesso(c1.id, { origem: 'equipe' }); AGORA += 16 * 60e3
assert.equal(s90.consumirAcesso(L2.token), null, 'link da equipe vence em 15 min')
AGORA += 20 * 86400e3; assert.ok(s90.sessaoDe(login.token), 'dia 20: sessão viva e o prazo desliza')
AGORA += 25 * 86400e3; assert.ok(s90.sessaoDe(login.token), 'dia 45: viva porque foi usada no dia 20 (30 dias deslizantes)')
AGORA += 31 * 86400e3; assert.equal(s90.sessaoDe(login.token), null, '31 dias sem uso: sessão vencida'); AGORA = Date.parse('2026-10-08T12:00:00.000Z')
const L3 = s90.gerarAcesso(c1.id, { origem: 'painel' }), s3 = s90.consumirAcesso(L3.token)
assert.equal(s90.encerrarSessao(s3.token), 1); assert.equal(s90.sessaoDe(s3.token), null, 'sair revoga a sessão')

// 6) mesmo vendedor em dois cadastros: bloqueado; só revoga o token novo se nenhuma outra conexão usa o mesmo app
aceitar(c2); s90.mudarEstado(c2.id, 'ativo', { por: 'X' })
conectarFalso(c1.chave, 777, 'app-principal')
assert.deepEqual(s90.aoConectar(c2.chave, 777, 'app-principal'), { bloquear: true, revogar: false }, 'mesmo app: não revoga (derrubaria a outra conexão)')
assert.deepEqual(s90.aoConectar(c2.chave, 777, 'outro-app'), { bloquear: true, revogar: true })
assert.deepEqual(s90.aoConectar(c2.chave, 778, 'app-principal'), { bloquear: false, revogar: false })
assert.ok(avisos.some(a => a.tipo === 's90_seller_duplicado' && a.link === '/integracoes'))
assert.deepEqual(s90.aoConectar(c1.chave, 777, 'app-principal'), { bloquear: false, revogar: false }, 'reconexão da própria chave não é duplicata')

// 7) exclusão LGPD: ordem fixa, tudo da chave some (toda tabela com coluna cliente), anonimiza, faturas e aceite ficam, purga de tokens em arquivo
const tabelasCliente = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all().map(r => r.name).filter(t => db.prepare(`PRAGMA table_info("${t}")`).all().some(c => c.name === 'cliente'))
const t0 = agora()
db.prepare(`INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, dados_json, criado_em, atualizado_em) VALUES ('PS-aaaaaaaaaa', ?, 'anuncio_frete_gratis', '2026-10', 't', '7d', '2026-10-15', '{"fila":"esta_semana"}', ?, ?)`).run(c1.chave, t0, t0)
db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo) VALUES ('s90-teste', 's90', ?, 't')`).run(c1.chave)
db.prepare(`INSERT INTO notificacoes (tipo, titulo, cliente, criado_em) VALUES ('x', 'x', ?, ?)`).run(c1.chave, t0)
db.prepare(`INSERT INTO s90_relatorio (cliente, de, ate, html, gerado_em, origem) VALUES (?, '2026-10-01', '2026-10-07', '<p>x</p>', ?, 'teste')`).run(c1.chave, t0)
db.prepare(`INSERT INTO s90_fatura (id, conta_id, competencia, tipo, valor_centavos, estado, criado_em, atualizado_em) VALUES ('f1', ?, '2026-10', 'assinatura', 99700, 'paga', ?, ?)`).run(c1.id, t0, t0)
db.prepare(`INSERT INTO sync_log (em, nivel, msg) VALUES (?, 'info', ?)`).run(t0, `Mercado Livre conectado — ${c1.chave} (NICK)`)
db.prepare("UPDATE s90_conta SET mp_preapproval_id = 'pre-1' WHERE id = ?").run(c1.id)
const DIR_BK = join(ROOT, 'data', 'backups'); mkdirSync(DIR_BK, { recursive: true })
const arqPend = join(DIR_BK, `meli_pendente-teste-s90-${Date.now()}.json`), arqOutro = join(DIR_BK, `meli_pendente-teste-s90-outro-${Date.now()}.json`)
try {
  writeFileSync(arqPend, JSON.stringify({ cliente: c1.chave, access_token: 'x' }), { mode: 0o600 }); writeFileSync(arqOutro, JSON.stringify({ cliente: '[S90] __outro__ · ffffffff' }), { mode: 0o600 })
  // MP fora: exclusão AGENDADA, nada apagado
  mpOk = false; ordem.length = 0
  let r = await s90.excluir(c1.id)
  assert.deepEqual(r, { ok: false, revogado: false, pendente: true }); assert.deepEqual(ordem, ['mp:cancelled'], 'sem cancelar a assinatura, não revoga nem apaga')
  assert.equal(s90.contaPorId(c1.id).estado, 'excluir_pendente'); assert.ok(db.prepare('SELECT 1 FROM acoes_plano WHERE cliente = ?').get(c1.chave), 'nada apagado ainda')
  assert.equal(s90.sessaoDe(s90.consumirAcesso(s90.gerarAcesso(c2.id).token).token).id, c2.id)
  // MP ok (via expurgo, que retenta): cancela ANTES, revoga, apaga
  mpOk = true; ordem.length = 0
  const ex = await s90.expurgar()
  assert.equal(ex.retentativas, 1); assert.deepEqual(ordem, ['mp:cancelled', 'revogar'], 'ordem: assinatura no MP → revogação no ML')
  for (const t of tabelasCliente()) assert.equal(db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE cliente = ?`).get(c1.chave).n, 0, `exclusão: ${t} ainda tem a chave`)
  const ap = s90.contaPorId(c1.id)
  assert.deepEqual([ap.estado, ap.nome, ap.email, ap.loja, ap.telefone], ['excluido', '', '', '', '']); assert.ok(ap.excluido_em && !ap.chave.includes('Loja Teste'))
  assert.equal(db.prepare('SELECT COUNT(*) n FROM s90_fatura WHERE conta_id = ?').get(c1.id).n, 1, 'faturas ficam (prazo fiscal)')
  assert.deepEqual(db.prepare('SELECT DISTINCT tipo FROM s90_evento WHERE conta_id = ? ORDER BY tipo').all(c1.id).map(r => r.tipo), ['aceite', 'consentimento', 'exclusao'], 'só aceite, consentimento e o registro da exclusão ficam')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM s90_sessao WHERE conta_id = ?').get(c1.id).n + db.prepare('SELECT COUNT(*) n FROM s90_acesso WHERE conta_id = ?').get(c1.id).n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_log WHERE instr(msg, ?) > 0').get(c1.chave).n, 0, 'log com a chave apagado')
  assert.ok(!existsSync(arqPend) && existsSync(arqOutro), 'purga só o par de tokens em arquivo DESTA chave')
  assert.deepEqual(await s90.excluir(c1.id), { ok: false, revogado: false, pendente: false }, 'excluir de novo não faz nada')
} finally { for (const f of [arqPend, arqOutro]) try { unlinkSync(f) } catch { /* já apagado */ } }

// 8) expurgo: pendente > 7 dias sem conexão sai; recente fica; cancelada > 90 dias sai; IP de evento > 12 meses vira ''
{
  db.prepare("UPDATE s90_conta SET estado = 'cancelado' WHERE id = ?").run(c3.id)     // libera vaga para os casos abaixo
  const velho = nova({ loja: 'Pendente Velho' }), recente = nova({ loja: 'Pendente Recente' })
  db.prepare('UPDATE s90_conta SET criado_em = ? WHERE id = ?').run(new Date(AGORA - 8 * 86400e3).toISOString(), velho.id)
  db.prepare('UPDATE s90_conta SET cancelado_em = ? WHERE id = ?').run(new Date(AGORA - 91 * 86400e3).toISOString(), c3.id)
  db.prepare("INSERT INTO s90_evento (conta_id, tipo, ip, em) VALUES (?, 'login', '9.9.9.9', ?)").run(c2.id, new Date(AGORA - 400 * 86400e3).toISOString())
  db.prepare("INSERT INTO s90_evento (conta_id, tipo, ip, em) VALUES (?, 'login', '8.8.8.8', ?)").run(c2.id, agora())
  const r = await s90.expurgar()
  assert.deepEqual([r.pendentes, r.cancelados], [1, 1]); assert.ok(r.ips >= 1)
  assert.equal(s90.contaPorId(velho.id).estado, 'excluido'); assert.equal(s90.contaPorId(recente.id).estado, 'pendente_pagamento'); assert.equal(s90.contaPorId(c3.id).estado, 'excluido')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM s90_evento WHERE ip = '9.9.9.9'").get().n, 0); assert.equal(db.prepare("SELECT COUNT(*) n FROM s90_evento WHERE ip = '8.8.8.8'").get().n, 1)
  const lg = s90.exportarLedger('2026-10-08')
  assert.ok(existsSync(lg.arquivo) && (statSync(lg.arquivo).mode & 0o777) === 0o600, 'ledger 0600'); assert.ok(JSON.parse(readFileSync(lg.arquivo, 'utf8')).eventos.length > 0)
}

// 9) HTTP: cookie, uso único pelo POST (o GET não gasta), isolamento A × B, ?cliente= ignorado, internas com prévia + confirmar estrito + "por"
const HS = 'sprint90.teste.example'
const envOriginal = { ...env }
env.SPRINT90_PUBLIC_HOST = HS; env.MELI_CLIENT_ID ||= 'app-teste'; env.PUBLIC_BASE_URL ||= 'https://exemplo.test'
const outra = nova({ loja: 'Loja B' }); aceitar(outra); s90.mudarEstado(outra.id, 'ativo', { por: 'X' })
for (const [cli, titulo] of [[c2.chave, 'Ação da A'], [outra.chave, 'Ação da B'], ['[Comercial] Prospect · deadbeef', 'Ação do prospect'], ['Cliente da Central', 'Ação da central']])
  db.prepare(`INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, score, dados_json, criado_em, atualizado_em) VALUES (?, ?, 'anuncio_frete_gratis', '2026-10', ?, '7d', '2026-10-15', 50, ?, ?, ?)`)
    .run('PS-' + createHash('sha1').update(cli).digest('hex').slice(0, 10), cli, titulo, JSON.stringify({ fila: 'esta_semana', problema: 'Sem frete grátis', como: ['Ativar o frete grátis'] }), agora(), agora())
const rotas = criarRotasSprint90({ s90, hostS90: () => env.SPRINT90_PUBLIC_HOST, validarPor: n => (n === 'Líder Teste' ? n : ''), conectarLink: chave => `https://exemplo.test/meli/conectar?c=${Buffer.from(chave).toString('base64url')}`,
  leitura: { conexao: MC.statusConexao, cobertura: () => ({ dias: 0 }), diagnostico: async () => ({ disponivel: false }), nomesInternos: async () => ['Giovanna Torres'] } })
const app = express()
app.use((req, res, next) => guardaLocal(req, res, next, '', HS)); app.use(express.json()); app.use(rotas)
app.use((req, res) => res.status(404).send('fim'))
const srv = await new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
const porta = srv.address().port
const req = (method, path, { host = `localhost:${porta}`, cookie, body, origin, headers = {} } = {}) => new Promise((ok, falha) => {
  const dados = body ? JSON.stringify(body) : null
  const r = http.request({ host: '127.0.0.1', port: porta, method, path, headers: { host, ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...(dados ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } : {}), ...headers } }, res => {
    let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }))
  })
  r.on('error', falha); if (dados) r.write(dados); r.end()
})
const entrar = async (contaId, opts = {}) => {
  const { token } = s90.gerarAcesso(contaId, { origem: 'equipe' })
  let r = await req('GET', `/c/acesso/${token}`, opts)
  assert.equal(r.status, 200); assert.ok(!r.headers['set-cookie'], 'o GET do link não abre sessão nem gasta o uso único')
  r = await req('POST', `/c/acesso/${token}`, opts)
  assert.equal(r.status, 303); assert.equal(r.headers.location, '/c/painel')
  const ck = r.headers['set-cookie'][0]
  // A13 (08/10): no host S90 o cookie passou a ser __Host-s90 (Path=/, Secure, sem Domain); no loopback segue s90 com Path=/c
  assert.match(ck, opts.host === HS ? /^__Host-s90=[A-Za-z0-9_-]{22}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/ : /^s90=[A-Za-z0-9_-]{22}; Path=\/c; HttpOnly; SameSite=Lax; Max-Age=2592000/)
  assert.equal((await req('POST', `/c/acesso/${token}`, opts)).status, 404, 'POST de novo: link já usado')
  return { ck, cookie: ck.split(';')[0] }
}
try {
  const A = await entrar(c2.id)
  assert.ok(!/Secure/.test(A.ck), 'http://localhost: cookie sem Secure (documentado)')
  const Asec = await entrar(c2.id, { headers: { 'x-forwarded-proto': 'https' } }); assert.match(Asec.ck, /; Secure$/, 'atrás do túnel (X-Forwarded-Proto https): Secure')
  const Ahost = await entrar(c2.id, { host: HS, origin: `https://${HS}` }); assert.match(Ahost.ck, /; Secure$/, 'pelo host S90: Secure')
  let r = await req('GET', `/c/api/resumo?cliente=${encodeURIComponent(outra.chave)}`, { cookie: A.cookie })
  assert.equal(r.status, 200); const res1 = r.json()
  assert.equal(res1.conta.loja, 'Outra Loja', '?cliente= ignorado: a sessão de A só vê A'); assert.ok(!('chave' in res1.conta) && !('email' in res1.conta) && !('id' in res1.conta))
  r = await req('GET', '/c/api/acoes?cliente=' + encodeURIComponent(outra.chave), { cookie: A.cookie })
  const titulos = r.json().acoes.map(a => a.titulo)
  assert.deepEqual(titulos, ['Ação da A'], 'só as ações de A (nunca de B, do prospect ou da central)'); assert.ok(!r.text.includes('PS-'), 'id da ação não sai')
  r = await req('POST', '/c/api/aceite', { cookie: A.cookie, body: { aceite: true, consentimento: true, cliente: outra.chave }, origin: `http://localhost:${porta}` })
  assert.equal(r.status, 200); assert.equal(s90.contaPorId(outra.id).aceite_ip, '1.2.3.4', 'body.cliente ignorado: B intacta')
  assert.equal((await req('GET', '/c/api/resumo')).status, 401); assert.equal((await req('GET', '/c/api/resumo', { cookie: 's90=' + 'A'.repeat(22) })).json().erro, 'Sua sessão expirou: entre de novo pelo seu link.', '401 com mensagem fixa')
  assert.equal((await req('GET', '/c/painel')).headers.location, '/c/entrar', 'página sem sessão → /c/entrar')
  r = await req('GET', '/c/painel', { cookie: A.cookie }); assert.equal(r.status, 200); assert.match(r.headers['content-security-policy'], /script-src 'nonce-/); assert.equal(r.headers['cache-control'], 'no-store')
  assert.match(r.headers['set-cookie'][0], /Max-Age=2592000/, 'cookie renovado (30 dias deslizantes)')
  r = await req('POST', '/c/api/aceite', { cookie: A.cookie, body: { aceite: true }, origin: 'https://evil.example' }); assert.equal(r.status, 403, 'CSRF: Origin de fora = 403')
  r = await req('POST', '/c/api/acesso/gerar', { cookie: A.cookie, body: {}, origin: `http://localhost:${porta}` }); assert.equal(r.status, 200)
  const guardado = r.json(); assert.match(guardado.url, new RegExp(`^http://localhost:${porta}/c/acesso/[A-Za-z0-9_-]{22}$`)); assert.ok(guardado.expira_em > agora())
  r = await req('GET', '/c/conectar', { cookie: A.cookie }); assert.equal(r.status, 302); assert.match(r.headers.location, /^https:\/\/exemplo\.test\/meli\/conectar\?c=/, 'conectar: direto no redirect, link nunca exibido')
  r = await req('POST', '/c/sair', { cookie: A.cookie, origin: `http://localhost:${porta}` }); assert.equal(r.status, 303); assert.match(r.headers['set-cookie'][0], /Max-Age=0/)
  assert.equal((await req('GET', '/c/api/resumo', { cookie: A.cookie })).status, 401, 'depois de sair a sessão não vale')
  // exclusão pelo titular via HTTP: confirmar estrito
  const B = await entrar(outra.id)
  assert.equal((await req('POST', '/c/api/dados/excluir', { cookie: B.cookie, body: { confirmar: 'true' }, origin: `http://localhost:${porta}` })).status, 400)
  r = await req('POST', '/c/api/dados/excluir', { cookie: B.cookie, body: { confirmar: true }, origin: `http://localhost:${porta}` })
  assert.equal(r.status, 200); assert.equal(r.json().ok, true); assert.match(r.json().mensagem, /Apagamos os seus dados/); assert.equal(s90.contaPorId(outra.id).estado, 'excluido')
  assert.equal((await req('GET', '/c/api/resumo', { cookie: B.cookie })).status, 401, 'conta excluída: sessão morta')
  // limite por IP no POST do link (10 em 15 min)
  let ultimo
  for (let i = 0; i < 11; i++) ultimo = await req('POST', `/c/acesso/${'Z'.repeat(22)}`, { headers: { 'cf-connecting-ip': '7.7.7.7' } })
  assert.equal(ultimo.status, 429, 'força bruta no link: 429')
  // rotas internas (loopback)
  r = await req('GET', '/api/sprint90/contas'); assert.equal(r.status, 200); const lista = r.json()
  assert.equal(lista.ligado, true); assert.ok(lista.contas.every(c => c.estado !== 'excluido')); assert.ok(!JSON.stringify(lista).includes('token'))
  const corpo = { nome: 'Novo', loja: 'Loja Nova', email: 'novo@teste.com', plano: 'fixo' }, O = { origin: `http://localhost:${porta}` }
  assert.equal((await req('POST', '/api/sprint90/contas', { ...O, body: { ...corpo, por: 'Fulano', confirmar: true } })).status, 403, '"por" fora de líder/consultor = 403')
  const n0 = db.prepare('SELECT COUNT(*) n FROM s90_conta').get().n
  r = await req('POST', '/api/sprint90/contas', { ...O, body: { ...corpo, por: 'Líder Teste', confirmar: 'true' } })
  assert.equal(r.json().previa, true); assert.equal(db.prepare('SELECT COUNT(*) n FROM s90_conta').get().n, n0, 'confirmar "true" (string) = só prévia')
  r = await req('POST', '/api/sprint90/contas', { ...O, body: { ...corpo, por: 'Líder Teste', confirmar: true } })
  assert.equal(r.status, 200); const criada = r.json().conta; assert.equal(criada.estado, 'pendente_pagamento')
  r = await req('POST', `/api/sprint90/contas/${criada.id}/acesso`, { ...O, body: { por: 'Líder Teste' } })
  const ac = r.json(); assert.match(ac.url, new RegExp(`^https://${HS.replace(/\./g, '\\.')}/c/acesso/[A-Za-z0-9_-]{22}$`)); assert.equal(ac.email.estado, 'pendente', 'e-mail: sempre pendente (canal só no painel)')
  // A24: nada de "url_local" com o MESMO token (testar no computador da equipe gastava o uso único do cliente)
  assert.ok(!('url_local' in ac) && !JSON.stringify(ac).includes('localhost'), 'A24: link da equipe sem url_local'); assert.ok(!readFileSync(join(ROOT, 'src', 'web', 'integracoes.js'), 'utf8').includes('url_local'), 'A24: a tela não convida a testar o link do cliente')
  assert.equal((await req('POST', '/api/sprint90/contas/zzzz/acesso', { ...O, body: { por: 'Líder Teste' } })).status, 404)
  r = await req('POST', `/api/sprint90/contas/${criada.id}/estado`, { ...O, body: { estado: 'ativo', por: 'Líder Teste' } }); assert.equal(r.status, 400, 'motivo obrigatório')
  r = await req('POST', `/api/sprint90/contas/${criada.id}/estado`, { ...O, body: { estado: 'ativo', por: 'Líder Teste', motivo: 'piloto' } }); assert.equal(r.json().conta.estado, 'ativo')
  r = await req('POST', '/api/sprint90/contas', { ...O, body: { ...corpo, por: 'Líder Teste' }, headers: { 'content-type': 'text/plain' } }); assert.ok([400, 415].includes(r.status), 'POST sem JSON recusado')
  assert.equal((await req('GET', '/api/sprint90/contas', { host: HS })).status, 403, 'interna pelo host S90: barrada na guarda')
  // sem a env: nada existe
  env.SPRINT90_PUBLIC_HOST = ''
  assert.equal((await req('GET', '/c/entrar')).text, 'fim', 'sem SPRINT90_PUBLIC_HOST /c/* não existe'); assert.equal((await req('GET', '/api/sprint90/contas')).text, 'fim')
} finally { srv.close(); Object.assign(env, envOriginal); rmSync(dirLedger, { recursive: true, force: true }) }
// ═════════ 10) achados de segurança/LGPD de 08/10 (A2–A24): cada bloco falha sem a correção ═════════
{
  const { log } = await import('../src/lib/db.js')
  const P = await import('../src/lib/s90-paginas.js')
  const env0 = { ...env }
  env.MELI_CLIENT_ID = 'APP-PRINCIPAL'                                    // app principal efetivo (conexão antiga da central tem app_id '')
  const rede = [], fetch0 = globalThis.fetch
  globalThis.fetch = async (url, o = {}) => { rede.push(`${(o.method || 'GET').toUpperCase()} ${url}`); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) }
  const avisos2 = []
  const cfg9 = { ...cfg, turma_fundadora: { vagas: 200, preco_travado_meses: 12 } }
  const deps = { handle: db, cfg: cfg9, agora, hoje, notificar: n => avisos2.push(n), termos: () => TERMOS, mp: null, dirBackup: '', appPrincipal: () => env.MELI_CLIENT_ID,
    conexao: { status: MC.statusConexao, revogar: MC.revogarConexao, desconectar: MC.desconectar, purgarPendentes: MC.purgarPendentesDe } }
  const s9 = criarS90(deps)
  const ativa = (loja, { ip = '', ua = '' } = {}) => { const c = s9.cadastrar({ nome: 'Titular', loja, email: `${loja.replace(/\W/g, '').toLowerCase()}@x.com`, plano: 'fixo' }, { por: 'Líder Teste' }); s9.registrarAceite(c.id, { aceite: true, consentimento: true, ip, ua }); return s9.mudarEstado(c.id, 'ativo', { por: 'Líder Teste' }) }
  const conta = (sql, ...a) => db.prepare(sql).get(...a).n
  try {
    // A2: conexão antiga da central (app_id '') é do MESMO app principal — nem o bloqueio do S90 nem a exclusão S90 a revogam
    MC.salvarConexao('Cliente Legado A2', { user_id: 333, access_token: 'a', refresh_token: 'b', expires_in: 21600, scope: 'read write', app_id: '' }, { nickname: 'L' })
    const b2 = ativa('Loja B A2')
    assert.deepEqual(s9.aoConectar(b2.chave, 333, 'APP-PRINCIPAL'), { bloquear: true, revogar: false }, 'A2: central com app_id "" = app principal: o token novo não é revogado (derrubaria a central)')
    const c2b = ativa('Loja C A2'); conectarFalso(c2b.chave, 444, 'APP-PRINCIPAL')
    MC.salvarConexao('Central Legado 444', { user_id: 444, access_token: 'a', refresh_token: 'b', expires_in: 21600, scope: 'read write', app_id: '' }, {})
    rede.length = 0
    const ex2 = await s9.excluir(c2b.id)
    assert.equal(ex2.ok, true); assert.equal(ex2.revogado, false); assert.ok(!rede.some(x => x.startsWith('DELETE')), 'A2: exclusão S90 não revoga o app da central legada do mesmo vendedor')
    assert.equal(MC.outraConexaoDoApp(444, 'APP-PRINCIPAL'), 'Central Legado 444'); assert.equal(MC.outraConexaoDoApp(444, 'outro-app'), null)

    // A19: o lead do diagnóstico público ('[Comercial] …') não bloqueia o S90 pago do mesmo vendedor
    MC.salvarConexao('[Comercial] Loja da Joana · deadbee1', { user_id: 777001, access_token: 'a', refresh_token: 'b', expires_in: 21600, scope: 'read', app_id: 'APP-PRINCIPAL' }, {})
    assert.deepEqual(s9.aoConectar(ativa('Loja da Joana').chave, 777001, 'APP-PRINCIPAL'), { bloquear: false, revogar: false }, 'A19: prospect não bloqueia o S90')

    // A7: exclusão alcança o que cita a chave fora da coluna cliente (ia_cache, aviso de OUTRA conta, webhooks crus do vendedor); aviso novo cita só ids
    const a7 = ativa('Loja Alfa'); conectarFalso(a7.chave, 888, 'APP-PRINCIPAL')
    const b7 = ativa('Loja Beta')
    s9.aoConectar(b7.chave, 888, 'APP-PRINCIPAL')
    const av7 = avisos2.findLast(a => a.tipo === 's90_seller_duplicado')
    assert.ok(av7.corpo.includes(`Sprint 90 ${a7.id}`) && !av7.corpo.includes('Loja Alfa') && !av7.corpo.includes('Loja Beta'), 'A7: o aviso cita os cadastros S90 só pelo id')
    db.prepare("INSERT INTO notificacoes (tipo, titulo, corpo, cliente, criado_em) VALUES ('s90_seller_duplicado', 't', ?, ?, ?)").run(`${b7.chave} tentou conectar um vendedor que já está ligado a: ${a7.chave}`, b7.chave, agora())
    db.prepare("INSERT INTO meli_notificacoes (topic, resource, user_id, application_id, corpo, recebido_em) VALUES ('orders', '/orders/1', '888', 'APP-PRINCIPAL', '{}', ?)").run(agora())
    db.prepare("INSERT INTO ia_cache (escopo, hash, prompt_versao, texto, gerado_em, origem) VALUES (?, 'h', 'v', 'A Loja Alfa concentra a receita.', ?, 'ia')").run(`diagnostico:${a7.chave}:interno`, agora())
    assert.equal((await s9.excluir(a7.id)).ok, true)
    assert.equal(conta('SELECT COUNT(*) n FROM ia_cache WHERE instr(escopo, ?) > 0', a7.chave), 0, 'A7: ia_cache da chave apagado')
    assert.equal(conta('SELECT COUNT(*) n FROM notificacoes WHERE instr(corpo, ?) > 0', a7.chave), 0, 'A7: aviso de outra conta que citava a chave apagado')
    assert.equal(conta("SELECT COUNT(*) n FROM meli_notificacoes WHERE user_id = '888'"), 0, 'A7: webhooks crus do vendedor (sem outra conexão) apagados')

    // A3: coleta em voo grava DEPOIS da exclusão com a chave antiga → o expurgo diário varre os órfãos; log() nunca grava a loja
    const a3 = ativa('Loja Secreta'), chaveA3 = a3.chave
    assert.equal((await s9.excluir(a3.id)).ok, true)
    db.prepare("INSERT INTO meli_item (cliente, item_id, titulo) VALUES (?, 'MLB1', 'Produto da Loja Secreta')").run(chaveA3)
    db.prepare("INSERT INTO meli_serie_item (cliente, item_id, dia, unidades, receita) VALUES (?, 'MLB1', '2026-10-01', 3, 150)").run(chaveA3)
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo) VALUES ('t-orfa-a3', 's90', ?, 't')").run(chaveA3)
    db.prepare("INSERT INTO evidencias (id, tarefa_id, tipo) VALUES ('e-orfa-a3', 't-orfa-a3', 'image')").run()
    const viva = ativa('Loja Viva A3')
    for (const cli of [viva.chave, 'Cliente Central A3']) db.prepare("INSERT INTO meli_item (cliente, item_id, titulo) VALUES (?, 'MLB2', 'x')").run(cli)
    // A3/A7 (revisão): redigir() em voo durante a exclusão grava o cache da IA DEPOIS dela, com a chave antiga no escopo (ia_cache não tem coluna cliente)
    const iaCache = escopo => db.prepare("INSERT INTO ia_cache (escopo, hash, prompt_versao, texto, gerado_em, origem) VALUES (?, 'h', 'v', 'A Loja Secreta concentra a receita.', ?, 'ia')").run(escopo, agora())
    for (const cli of [chaveA3, viva.chave, 'Cliente Central A3']) iaCache(`diagnostico:${cli}:interno`)
    const c0 = console.log; console.log = () => {}
    try { log('erro', `coleta de pedidos ${chaveA3} 2026-05-12: Conta Mercado Livre não conectada`) } finally { console.log = c0 }
    assert.equal(conta("SELECT COUNT(*) n FROM sync_log WHERE instr(msg, 'Loja Secreta') > 0"), 0, 'A3/A7: log() grava a chave S90 só como id')
    const r3 = await s9.expurgar()
    assert.ok(r3.orfaos >= 3, 'A3: órfãos varridos'); assert.equal(r3.falhas, 0)
    for (const t of ['meli_item', 'meli_serie_item', 'tarefas']) assert.equal(conta(`SELECT COUNT(*) n FROM ${t} WHERE cliente = ?`, chaveA3), 0, `A3: ${t} órfão apagado`)
    assert.equal(conta("SELECT COUNT(*) n FROM evidencias WHERE id = 'e-orfa-a3'"), 0)
    assert.equal(conta("SELECT COUNT(*) n FROM meli_item WHERE item_id = 'MLB2'"), 2, 'A3: conta S90 viva e cliente da central intactos')
    assert.equal(conta('SELECT COUNT(*) n FROM ia_cache WHERE instr(escopo, ?) > 0', chaveA3), 0, 'A3/A7: cache da IA gravado depois da exclusão é varrido pelo expurgo')
    for (const cli of [viva.chave, 'Cliente Central A3']) assert.equal(conta('SELECT COUNT(*) n FROM ia_cache WHERE escopo = ?', `diagnostico:${cli}:interno`), 1, 'cache de conta viva e da central fica')

    // A1 (revisão): a volta do OAuth só vai a um host LOOPBACK gravado pela sessão que pediu (nunca um host qualquer); a sessão guarda o link que a abriu
    {
      const cv = ativa('Loja Volta'), sx = s9.abrirSessao(cv.id).token
      s9.vincularConexao(cv.id, 'sig-evil', sx, 'evil.example'); assert.equal(s9.voltaDaConexao('sig-evil'), '', 'volta nunca é um host qualquer (redirecionamento aberto)')
      s9.vincularConexao(cv.id, 'sig-local', sx, 'localhost:3012'); assert.equal(s9.voltaDaConexao('sig-local'), 'localhost:3012')
      assert.ok(s9.consumirConexao(cv.id, 'sig-local', sx)); assert.equal(s9.voltaDaConexao('sig-local'), '', 'vínculo usado: sem volta')
      assert.equal(s9.origemDaSessao(s9.consumirAcesso(s9.gerarAcesso(cv.id, { origem: 'painel' }).token).token), 'painel', '"Guardar meu acesso" marca a sessão')
      assert.equal(s9.origemDaSessao(s9.consumirAcesso(s9.gerarAcesso(cv.id).token).token), 'equipe'); assert.equal(s9.origemDaSessao('x'), '')
    }

    // A4: trocar o vendedor na mesma conta S90 apaga o plano do vendedor anterior (o painel nunca projeta anúncio de outra conta do ML)
    const a4 = ativa('Loja D'); conectarFalso(a4.chave, 555000, 'APP-PRINCIPAL')
    const acao = (id, st) => db.prepare(`INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, status, dados_json, criado_em, atualizado_em) VALUES (?, ?, 'anuncio_frete_gratis', '2026-10', 't', '7d', '2026-10-15', ?, ?, ?, ?)`)
      .run(id, a4.chave, st, JSON.stringify({ fila: 'esta_semana', item: { id: 'MLB555000111', titulo: 'Produto SECRETO do vendedor 555' } }), agora(), agora())
    acao('PS-555aaa0001', 'proposta'); acao('PS-555bbb0001', 'distribuida')
    assert.equal(s9.acoesDaSemana(a4.chave).length, 2)
    conectarFalso(a4.chave, 666000, 'APP-PRINCIPAL')
    assert.equal(s9.acoesDaSemana(a4.chave).length, 0, 'A4: plano do vendedor anterior sai na troca de vendedor')
    acao('PS-666aaa0001', 'proposta'); conectarFalso(a4.chave, 666000, 'APP-PRINCIPAL')
    assert.equal(s9.acoesDaSemana(a4.chave).length, 1, 'A4: reconexão do MESMO vendedor não mexe no plano')

    // A5: revogação por conta; link novo invalida os anteriores; teto absoluto da sessão
    const a5 = ativa('Loja Vitima')
    const sA = s9.consumirAcesso(s9.gerarAcesso(a5.id).token), sB = s9.consumirAcesso(s9.gerarAcesso(a5.id).token)
    const guardado = s9.gerarAcesso(a5.id, { origem: 'painel' }), novoDaEquipe = s9.gerarAcesso(a5.id, { origem: 'equipe' })
    assert.equal(s9.consumirAcesso(guardado.token), null, 'A5: link novo invalida os anteriores ainda não usados')
    assert.deepEqual(s9.revogarAcessos(a5.id, { por: 'Líder Teste' }), { sessoes: 2, links: 1 })
    assert.equal(s9.sessaoDe(sA.token), null); assert.equal(s9.sessaoDe(sB.token), null); assert.equal(s9.consumirAcesso(novoDaEquipe.token), null, 'A5: revogar derruba sessões e links abertos')
    const sC = s9.consumirAcesso(s9.gerarAcesso(a5.id).token)
    for (let i = 0; i < 3; i++) { AGORA += 29 * 86400e3; assert.ok(s9.sessaoDe(sC.token), `dia ${29 * (i + 1)}: viva (30 dias deslizantes)`) }
    AGORA += 29 * 86400e3; assert.equal(s9.sessaoDe(sC.token), null, 'A5: teto absoluto de 90 dias desde o login')
    AGORA = Date.parse('2026-10-08T12:00:00.000Z')

    // A9: o painel não promete exportação que a F1 não tem
    const painel = P.paginaPainel({ nonce: 'n' })
    assert.ok(!/exportar e excluir meus dados pelo painel|consulta, exportação e exclusão/i.test(painel), 'A9: sem promessa de exportação pelo painel')
    assert.ok(!readFileSync(join(ROOT, 'src', 'web', 'integracoes.js'), 'utf8').includes('leitura, exportação e exclusão'), 'A9: confirmação da equipe sem exportação')
    assert.match(painel, /\/c\/sair\?todos=1/, 'A5: "Sair de todos os aparelhos" no painel')

    // A12: conta ativada durante o await do Mercado Pago (ou antes da vez dela) nunca é apagada pelo expurgo
    const s12 = criarS90({ ...deps, mp: { atualizarPreapproval: async () => { await new Promise(ok => setTimeout(ok, 30)); return true } } })
    const p1 = s12.cadastrar({ nome: 'P', loja: 'Pendente Um', email: 'p1@x.com', plano: 'fixo' }), p2 = s12.cadastrar({ nome: 'P', loja: 'Pendente Dois', email: 'p2@x.com', plano: 'fixo' })
    db.prepare("UPDATE s90_conta SET criado_em = ?, mp_preapproval_id = CASE WHEN id = ? THEN 'pre-p1' ELSE '' END WHERE id IN (?, ?)").run(new Date(AGORA - 8 * 86400e3).toISOString(), p1.id, p1.id, p2.id)
    setTimeout(() => { s12.mudarEstado(p1.id, 'ativo', { por: 'webhook' }); s12.mudarEstado(p2.id, 'ativo', { por: 'webhook' }) }, 5)
    const r12 = await s12.expurgar()
    assert.deepEqual([s12.contaPorId(p1.id).estado, s12.contaPorId(p2.id).estado], ['ativo', 'ativo'], 'A12: ativada no meio do expurgo continua ativa')
    assert.equal(r12.pendentes, 0); assert.ok(avisos2.some(a => a.tipo === 's90_exclusao_abortada'), 'A12: a equipe é avisada (assinatura já cancelada no MP)')

    // A18: conta S90 cancelada sai da coleta diária, das promoções de madrugada e da renovação preventiva
    const a18 = ativa('Loja Cancelada'); conectarFalso(a18.chave, 181818, 'APP-PRINCIPAL'); s9.mudarEstado(a18.id, 'cancelado', { por: 'Líder Teste', motivo: 'teste' })
    const viva18 = ativa('Loja Ativa A18'); conectarFalso(viva18.chave, 181819, 'APP-PRINCIPAL')
    const coleta = MC.listarConexoesColeta().map(x => x.cliente)
    assert.ok(!coleta.includes(a18.chave) && coleta.includes(viva18.chave), 'A18: cancelada fora da coleta; ativa dentro')
    db.prepare('UPDATE meli_contas SET expira_em = ? WHERE cliente = ?').run(new Date(Date.now() - 1000).toISOString(), a18.chave)
    rede.length = 0
    const rp = await MC.renovarPreventivo({ clientes: [a18.chave] })
    assert.deepEqual([rp.renovadas, rp.ok, rp.falhas.length, rede.length], [0, 0, 0, 0], 'A18: cancelada não renova token')

    // A20: uma exclusão que lança não derruba o expurgo (outras contas, purga de IP); FK evidencias → tarefas não trava mais a exclusão
    const x20 = s9.cadastrar({ nome: 'X', loja: 'Loja X20', email: 'x@x.com', plano: 'fixo' }), y20 = s9.cadastrar({ nome: 'Y', loja: 'Loja Y20', email: 'y@x.com', plano: 'fixo' })
    db.prepare('UPDATE s90_conta SET criado_em = ? WHERE id IN (?, ?)').run(new Date(AGORA - 8 * 86400e3).toISOString(), x20.id, y20.id)
    db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo) VALUES ('t-x20', 's90', ?, 't')").run(x20.chave)
    db.prepare("INSERT INTO evidencias (id, tarefa_id, tipo) VALUES ('e-x20', 't-x20', 'image')").run()
    db.prepare("INSERT INTO acoes_plano (id, cliente, regra, mes, titulo, horizonte, prazo, dados_json, criado_em, atualizado_em) VALUES ('PS-x20a000001', ?, 'anuncio_frete_gratis', '2026-10', 't', '7d', '2026-10-15', '{}', ?, ?)").run(x20.chave, agora(), agora())
    db.prepare("INSERT INTO s90_evento (conta_id, tipo, ip, em) VALUES (?, 'login', '9.9.9.20', '2020-01-01T00:00:00.000Z')").run(y20.id)
    db.exec(`CREATE TEMP TRIGGER t_falha_x20 BEFORE DELETE ON acoes_plano WHEN OLD.id = 'PS-x20a000001' BEGIN SELECT RAISE(ABORT, 'falha de teste'); END`)
    const c1log = console.log; console.log = () => {}
    let r20
    try { r20 = await s9.expurgar() } finally { console.log = c1log }
    assert.ok(r20.falhas >= 1, 'A20: a falha é contada e avisada'); assert.ok(avisos2.some(a => a.tipo === 's90_expurgo_falhou'))
    assert.equal(s9.contaPorId(x20.id).estado, 'pendente_pagamento', 'a conta que lançou fica intacta (transação desfeita)')
    assert.equal(s9.contaPorId(y20.id).estado, 'excluido', 'A20: a conta seguinte é expurgada mesmo assim')
    assert.equal(conta("SELECT COUNT(*) n FROM s90_evento WHERE ip = '9.9.9.20'"), 0, 'A20: purga de IP independente das exclusões')
    db.exec('DROP TRIGGER t_falha_x20')
    await s9.expurgar()
    assert.equal(s9.contaPorId(x20.id).estado, 'excluido', 'FK evidencias → tarefas: a exclusão apaga as evidências antes da tarefa')
    assert.equal(conta("SELECT COUNT(*) n FROM evidencias WHERE id = 'e-x20'"), 0)

    // A21: a poda do sync_log roda (rowid; a coluna id não existe)
    db.transaction(() => { const st = db.prepare("INSERT INTO sync_log (em, nivel, msg) VALUES (?, 'info', 'carga')"); for (let i = 0; i < 6000; i++) st.run(agora()) })()
    const c2log = console.log; console.log = () => {}
    try { for (let i = 0; i < 200; i++) log('info', 'poda') } finally { console.log = c2log }
    assert.ok(conta('SELECT COUNT(*) n FROM sync_log') < 5200, 'A21: sync_log podado para as últimas 5000 linhas')

    // A22: expurgo_nao_pago_dias da config vale (antes: 7 dias fixos no código)
    const s22 = criarS90({ ...deps, cfg: { ...cfg9, expurgo_nao_pago_dias: 30 } })
    const p22 = s22.cadastrar({ nome: 'P', loja: 'Pendente 22', email: 'p22@x.com', plano: 'fixo' })
    db.prepare('UPDATE s90_conta SET criado_em = ? WHERE id = ?').run(new Date(AGORA - 10 * 86400e3).toISOString(), p22.id)
    await s22.expurgar()
    assert.equal(s22.contaPorId(p22.id).estado, 'pendente_pagamento', 'A22: com 30 dias configurados, a pendente de 10 dias fica')

    // A8: passado o prazo fiscal (retencao.fiscal_anos), some o resto da conta excluída: aceite com e-mail/IP/UA, faturas, pagamentos e a linha
    const a8 = ativa('Loja Alfa A8', { ip: '200.1.1.1', ua: 'Mozilla/5.0 (Ana)' })
    db.prepare(`INSERT INTO s90_fatura (id, conta_id, competencia, tipo, valor_centavos, estado, criado_em, atualizado_em) VALUES ('f-a8', ?, '2026-10', 'assinatura', 99700, 'paga', ?, ?)`).run(a8.id, agora(), agora())
    assert.equal((await s9.excluir(a8.id)).ok, true)
    AGORA += 4 * 365 * 86400e3; await s9.expurgar()
    assert.ok(s9.contaPorId(a8.id) && conta('SELECT COUNT(*) n FROM s90_fatura WHERE conta_id = ?', a8.id) === 1, 'dentro do prazo fiscal: aceite e fatura ficam')
    AGORA += 2 * 365 * 86400e3
    const r8 = await s9.expurgar()
    assert.ok(r8.fiscais >= 1); assert.equal(s9.contaPorId(a8.id), null, 'A8: a linha da conta sai no fim do prazo fiscal')
    for (const t of ['s90_evento', 's90_fatura']) assert.equal(conta(`SELECT COUNT(*) n FROM ${t} WHERE conta_id = ?`, a8.id), 0, `A8: ${t} da conta apagado`)
    const dirL = mkdtempSync(join(tmpdir(), 's90-a8-'))
    try { const lg = criarS90({ ...deps, dirBackup: dirL }).exportarLedger('2032-10-08'); assert.ok(!readFileSync(lg.arquivo, 'utf8').includes('200.1.1.1'), 'A8: o ledger diário deixa de levar o aceite') } finally { rmSync(dirL, { recursive: true, force: true }) }
    AGORA = Date.parse('2026-10-08T12:00:00.000Z')
  } finally { globalThis.fetch = fetch0; Object.assign(env, env0) }
}

// ═════════ 11) HTTP dos achados (A1, A5, A10, A13, A23, A26): OAuth amarrado à sessão, sair de todos, http → https, cookie __Host-, cache do resumo, raiz leva ao painel ═════════
{
  const { linkConectar } = await import('../src/lib/meli-link.js')
  const env0 = { ...env }
  env.SPRINT90_PUBLIC_HOST = HS; env.PUBLIC_BASE_URL ||= 'https://exemplo.test'
  const s11 = criarS90({ handle: db, cfg: { ...cfg, turma_fundadora: { vagas: 300, preco_travado_meses: 12 } }, agora, hoje, termos: () => TERMOS, conexao: { status: MC.statusConexao, revogar: async () => false, desconectar: MC.desconectar } })
  const ativa = loja => { const c = s11.cadastrar({ nome: 'T', loja, email: 't@x.com', plano: 'fixo' }); s11.registrarAceite(c.id, { aceite: true, consentimento: true }); return s11.mudarEstado(c.id, 'ativo', { por: 'L' }) }
  const concluidas = []
  let diagChamadas = 0
  const rotas11 = criarRotasSprint90({ s90: s11, hostS90: () => env.SPRINT90_PUBLIC_HOST, validarPor: n => (n === 'Líder Teste' ? n : ''), conectarLink: chave => linkConectar(chave, 10 / 1440),
    concluirConexao: async a => { concluidas.push(a); return { ok: true } },
    landing: () => join(ROOT, 'assets', 'sprint90', 'landing.html'),
    leitura: { conexao: MC.statusConexao, cobertura: () => ({ dias: 5, ate: '2026-10-07' }), diagnostico: async () => { diagChamadas++; return { disponivel: false } }, nomesInternos: async () => [] } })
  const app11 = express()
  app11.use((req, res, next) => guardaLocal(req, res, next, '', HS)); app11.use(express.json()); app11.use(rotas11); app11.use((req, res) => res.status(404).send('fim'))
  const srv11 = await new Promise(ok => { const s = app11.listen(0, '127.0.0.1', () => ok(s)) })
  const porta11 = srv11.address().port
  const pedir = (method, path, { host = HS, cookie, body, origin = `https://${HS}`, headers = {} } = {}) => new Promise((ok, falha) => {
    const dados = body ? JSON.stringify(body) : null
    const r = http.request({ host: '127.0.0.1', port: porta11, method, path, headers: { host, ...(cookie ? { cookie } : {}), ...(method !== 'GET' && origin ? { origin } : {}), ...(dados ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(dados) } : {}), ...headers } }, res => {
      let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }))
    })
    r.on('error', falha); if (dados) r.write(dados); r.end()
  })
  const login = async contaId => { const r = await pedir('POST', `/c/acesso/${s11.gerarAcesso(contaId).token}`); assert.equal(r.status, 303); return r.headers['set-cookie'][0].split(';')[0] }
  try {
    const A = ativa('Loja Atacante'), V = ativa('Loja Vitima 11')
    const ckA = await login(A.id), ckV = await login(V.id)
    assert.match(ckA, /^__Host-s90=[A-Za-z0-9_-]{22}$/, 'A13: cookie __Host- no host S90')
    // A1: o link do OAuth fica amarrado à sessão que o pediu; a volta só conclui com ELA, uma vez, em 10 min
    let r = await pedir('GET', '/c/conectar', { cookie: ckA })
    assert.equal(r.status, 302)
    const u = new URL(r.headers.location), state = `${u.searchParams.get('c')}.${u.searchParams.get('exp')}.${u.searchParams.get('sig')}`
    assert.ok(Number(u.searchParams.get('exp')) - Date.now() / 1000 <= 601, 'A1: link do OAuth S90 vale 10 minutos (antes: 1 dia)')
    const fim = `/c/conectar/fim?${new URLSearchParams({ code: 'CODE-VITIMA', state })}`
    r = await pedir('GET', fim); assert.equal(r.status, 302); assert.equal(r.headers.location, '/c/entrar', 'A1: quem autorizou sem a sessão dona do link cai na entrada')
    r = await pedir('GET', fim, { cookie: ckV }); assert.equal(r.status, 403, 'A1: a sessão de OUTRA conta não conclui o link alheio')
    assert.equal(concluidas.length, 0, 'A1: nenhum código trocado nem gravado sem a sessão dona')
    r = await pedir('GET', `/c/conectar/fim?${new URLSearchParams({ code: 'X', state: state.replace(/\.[0-9a-f]{32}$/, '.' + '0'.repeat(32)) })}`, { cookie: ckA }); assert.equal(r.status, 403, 'state forjado')
    const ckA2 = await login(A.id)
    r = await pedir('GET', fim, { cookie: ckA2 }); assert.equal(r.status, 403, 'A1: outra sessão da MESMA conta também não (o vínculo é por sessão)')
    r = await pedir('GET', fim, { cookie: ckA }); assert.equal(r.status, 303); assert.equal(r.headers.location, '/c/painel?conectado=1')
    assert.deepEqual(concluidas, [{ chave: A.chave, code: 'CODE-VITIMA', state }], 'a sessão dona conclui')
    r = await pedir('GET', fim, { cookie: ckA }); assert.equal(r.status, 403, 'A1: uso único'); assert.equal(concluidas.length, 1)
    // A10: http no host S90 vira https antes de qualquer rota; POST em http não gasta o link; HSTS
    r = await pedir('GET', '/c/entrar?x=1', { headers: { 'x-forwarded-proto': 'http' } }); assert.equal(r.status, 301); assert.equal(r.headers.location, `https://${HS}/c/entrar?x=1`)
    const tk = s11.gerarAcesso(V.id).token
    r = await pedir('POST', `/c/acesso/${tk}`, { headers: { 'x-forwarded-proto': 'http' } }); assert.equal(r.status, 400); assert.ok(!r.headers['set-cookie'])
    r = await pedir('POST', `/c/acesso/${tk}`); assert.equal(r.status, 303, 'A10: o link não foi gasto pelo POST em http')
    assert.equal(r.headers['strict-transport-security'], 'max-age=31536000', 'A10/A13: HSTS no host S90')
    // A13: dois cookies de sessão (plantado + legítimo) = sem sessão; o nome antigo "s90=" no host S90 não vale
    assert.equal((await pedir('GET', '/c/api/resumo', { cookie: `${ckA}; ${ckV}` })).status, 401, 'A13: cookie duplicado = sem sessão (nunca vence o primeiro)')
    assert.equal((await pedir('GET', '/c/api/resumo', { cookie: ckV.replace('__Host-s90', 's90') })).status, 401, 'A13: no host S90 só __Host-s90')
    assert.equal((await pedir('POST', '/c/api/aceite', { cookie: ckV, body: {}, origin: `http://${HS}` })).status, 403, 'A13: Origin http:// no host S90 = 403')
    // A26: raiz do host S90 com sessão leva ao painel; sem sessão, a landing
    r = await pedir('GET', '/', { cookie: ckV }); assert.equal(r.status, 302); assert.equal(r.headers.location, '/c/painel', 'A26: cliente com sessão volta ao painel')
    r = await pedir('GET', '/'); assert.equal(r.status, 200); assert.match(r.text, /<html/i)
    // A23: números do diagnóstico em cache por conta (até chegar coleta nova); leitura com limite por IP
    conectarFalso(V.chave, 1111, 'APP-PRINCIPAL')
    const h23 = { 'cf-connecting-ip': '23.23.23.23' }
    assert.equal((await pedir('GET', '/c/api/resumo', { cookie: ckV, headers: h23 })).status, 200); assert.equal((await pedir('GET', '/c/api/resumo', { cookie: ckV, headers: h23 })).status, 200)
    assert.equal(diagChamadas, 1, 'A23: o 2º resumo usa o cache (o diagnóstico bloqueia o processo inteiro)')
    let ult; for (let i = 0; i < 30; i++) ult = await pedir('GET', '/c/api/resumo', { cookie: ckV, headers: h23 })
    assert.equal(ult.status, 429, 'A23: resumo em laço = 429')
    // A5: "sair de todos os aparelhos" derruba as outras sessões e os links guardados; a equipe também derruba pela rota interna
    const ckV2 = await login(V.id), guardado = s11.gerarAcesso(V.id, { origem: 'painel' })
    r = await pedir('POST', '/c/sair?todos=1', { cookie: ckV2 }); assert.equal(r.status, 303)
    assert.equal((await pedir('GET', '/c/api/acoes', { cookie: ckV, headers: { 'cf-connecting-ip': '5.5.5.5' } })).status, 401, 'A5: a outra sessão caiu')
    assert.equal((await pedir('POST', `/c/acesso/${guardado.token}`)).status, 404, 'A5: o link guardado caiu')
    const ckA3 = await login(A.id)
    r = await pedir('POST', `/api/sprint90/contas/${A.id}/revogar`, { host: `localhost:${porta11}`, origin: `http://localhost:${porta11}`, body: { por: 'Líder Teste' } })
    assert.equal(r.status, 200); assert.ok(r.json().sessoes >= 2, 'A5: rota interna derruba as sessões da conta')
    assert.equal((await pedir('GET', '/c/api/acoes', { cookie: ckA3, headers: { 'cf-connecting-ip': '6.6.6.6' } })).status, 401)
    assert.equal((await pedir('POST', `/api/sprint90/contas/${A.id}/revogar`, { host: `localhost:${porta11}`, origin: `http://localhost:${porta11}`, body: { por: 'Fulano' } })).status, 403, '"por" de líder/consultor')
  } finally { srv11.close(); Object.assign(env, env0) }
}
console.log('✔ sprint90-conta (+ achados 08/10: app efetivo, prospect não bloqueia, exclusão alcança ia_cache/avisos/webhooks e órfãos, troca de vendedor limpa o plano, revogação por conta e teto de sessão, sem promessa de exportação, expurgo isolado por conta e sem corrida com o MP, cancelada fora da coleta, poda do log, prazo fiscal; HTTP: OAuth amarrado à sessão, http→https, cookie __Host-, cache do resumo, raiz → painel): chave fora do prospect/central e dentro da coleta, fora de backup/arquivo/restauração; cadastro com termos (rascunho só piloto), aceite registrado, vagas em transação; sessão e link só por hash, uso único que vence, 30 dias deslizantes, sair revoga; vendedor duplicado bloqueado; exclusão na ordem (MP → ML → tudo da chave), MP fora = agendada; expurgo e ledger 0600; HTTP com cookie seguro, isolamento A × B e internas com prévia + confirmar estrito')

// migração: banco antigo com s90_conta sem a coluna piloto (criada por teste que abriu o banco real antes da coluna existir) ganha a coluna no boot
{
  const Database = (await import('better-sqlite3')).default
  const { SCHEMA_S90 } = await import('../src/lib/s90-schema.js')
  const velho = new Database(':memory:')
  velho.exec(SCHEMA_S90.replace(/\n\s*piloto INTEGER[^\n]*\n/, '\n'))
  assert.ok(!velho.prepare('PRAGMA table_info(s90_conta)').all().some(c => c.name === 'piloto'), 'fixture: tabela antiga sem piloto')
  const { readFileSync } = await import('node:fs')
  assert.match(readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8'), /\['s90_conta', 'piloto', 'INTEGER NOT NULL DEFAULT 0'\]/, 'db.js migra s90_conta.piloto')
  console.log('✔ sprint90-conta: migração aditiva de s90_conta.piloto declarada')
}
