// Autoteste da renovação do token do ML (o refresh_token é de USO ÚNICO).
// Simula a API do ML com um fetch falso: a 1ª renovação com um refresh_token vale; reusar o MESMO refresh_token = invalid_grant
// (conta "queimada"), exatamente o que acontecia quando servidor e script de CLI renovavam a mesma conta juntos.
// Tudo dentro de uma transação revertida: nenhuma conta real é tocada.
import assert from 'node:assert/strict'
import { db } from '../src/lib/db.js'
import { cifrar } from '../src/lib/cripto.js'
import { tokenValido, renovarPreventivo, desconectar, restaurarConexoes, backupConexoes } from '../src/lib/meli-contas.js'
import { listarNotificacoes } from '../src/lib/notificacoes.js'

const agoraIso = () => new Date().toISOString()
process.env.MELI_CLIENT_ID = process.env.MELI_CLIENT_ID || 'app-teste'; process.env.MELI_CLIENT_SECRET = process.env.MELI_CLIENT_SECRET || 'segredo-teste'
const CLI = '__renov_teste__'
const usados = new Set(); let chamadas = 0, falhaRede = false
globalThis.fetch = async (url, opts) => {
  if (!String(url).includes('/oauth/token')) return { ok: true, status: 200, json: async () => ({}), text: async () => '' }
  chamadas++
  await new Promise(r => setTimeout(r, 120))                     // latência: abre a janela da corrida
  if (falhaRede) throw new Error('fetch failed (rede caiu)')
  const body = new URLSearchParams(String(opts.body))
  const rt = body.get('refresh_token')
  if (usados.has(rt)) return { ok: false, status: 400, text: async () => '{"message":"Error validating grant. Your authorization code or refresh token may be expired or it was already used","error":"invalid_grant"}', json: async () => ({ message: 'Error validating grant. Your authorization code or refresh token may be expired or it was already used', error: 'invalid_grant' }) }
  usados.add(rt)                                                  // uso único: queima
  return { ok: true, status: 200, json: async () => ({ access_token: 'AT-' + rt + '-novo', refresh_token: 'RT-' + chamadas, expires_in: 21600, user_id: 1, scope: 'offline_access read' }) }
}

db.exec('BEGIN')
const antesN0 = listarNotificacoes().ultimo_id
try {
  const semear = (exp = new Date(Date.now() - 1000).toISOString()) => {
    db.prepare('DELETE FROM meli_contas WHERE cliente = ?').run(CLI); usados.clear()
    db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id)
      VALUES (?, 1, 'teste', ?, ?, ?, 'offline_access', ?, ?, '', '')`).run(CLI, cifrar('AT-velho'), cifrar('RT-0'), exp, new Date().toISOString(), new Date().toISOString())
  }
  // 1) 5 chamadas simultâneas, mesmo processo → UMA renovação só; todas recebem o token novo
  semear(); chamadas = 0
  const r1 = await Promise.all([1, 2, 3, 4, 5].map(() => tokenValido(CLI)))
  assert.equal(chamadas, 1, 'renovação única no processo'); assert.ok(r1.every(t => t === r1[0] && t.includes('novo')))
  assert.equal(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, '', 'sem erro')

  // 2) OUTRO processo já renovou (linha fresca no banco): não renova de novo, só usa — era o que queimava o refresh
  semear(); chamadas = 0
  db.prepare('UPDATE meli_contas SET expira_em = ? WHERE cliente = ?').run(new Date(Date.now() + 3 * 3600e3).toISOString(), CLI)
  await tokenValido(CLI); assert.equal(chamadas, 0, 'token fresco no banco → nenhuma chamada ao ML')

  // 3) TRAVA de outro processo ativa + token renovado por ele durante a espera → usa o resultado dele, sem chamar o ML
  semear(); chamadas = 0
  db.prepare("INSERT OR REPLACE INTO meli_renovacao_trava (cliente, dono, em) VALUES (?, 'outro-processo', ?)").run(CLI, Date.now())
  setTimeout(() => db.prepare('UPDATE meli_contas SET expira_em = ?, access_token = ? WHERE cliente = ?').run(new Date(Date.now() + 6 * 3600e3).toISOString(), cifrar('AT-do-outro'), CLI), 1500)
  const t3 = await tokenValido(CLI)
  assert.equal(t3, 'AT-do-outro'); assert.equal(chamadas, 0, 'não renova por cima do outro processo')

  // 4) trava ÓRFÃ (processo morreu) é tomada após o prazo — a conta não fica presa para sempre
  semear(); chamadas = 0
  db.prepare("INSERT OR REPLACE INTO meli_renovacao_trava (cliente, dono, em) VALUES (?, 'morto', ?)").run(CLI, Date.now() - 60_000)
  assert.ok((await tokenValido(CLI)).includes('novo')); assert.equal(chamadas, 1)

  // 5) erro TRANSITÓRIO (rede) NÃO derruba a conta; a próxima tentativa funciona
  semear(); falhaRede = true
  assert.equal(await tokenValido(CLI), null)
  assert.equal(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, '', 'soluço de rede não marca "reconectar"')
  falhaRede = false; assert.ok((await tokenValido(CLI)).includes('novo'), 'recupera sozinha')

  // 6) refresh_token QUEIMADO (invalid_grant) é definitivo e fica visível para reconectar
  semear(); usados.add('RT-0')
  assert.equal(await tokenValido(CLI), null)
  assert.match(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, /validating grant|OAuth 400/)

  // 7) renovação PREVENTIVA: renova o que vence em < 90 min e deixa quieto o que está fresco
  semear(new Date(Date.now() + 30 * 60e3).toISOString()); chamadas = 0
  const rp = await renovarPreventivo({ margemMin: 90, clientes: [CLI] })   // SÓ a conta de teste: o autoteste nunca renova (nem queima) conta real
  assert.ok(rp.renovadas >= 1 && chamadas >= 1, 'vencendo em 30 min → renovada preventivamente')
  // 8) a preventiva é DE VERDADE: conta que vence em 30 min é renovada antes, e conta fresca (6 h) fica quieta
  assert.equal(rp.renovadas, 1, 'só a conta de teste foi renovada')
  chamadas = 0; semear(new Date(Date.now() + 5 * 3600e3).toISOString())
  const rf = await renovarPreventivo({ margemMin: 90, clientes: [CLI] })
  assert.equal(rf.renovadas, 0); assert.equal(chamadas, 0, 'fresca não gasta refresh_token')

  // 9) CORRIDA: outro processo gravou o token novo um instante antes de este receber "invalid_grant" → a conexão está VIVA (sem erro, sem aviso)
  semear(); chamadas = 0
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/oauth/token')) {
      db.prepare('UPDATE meli_contas SET access_token = ?, refresh_token = ?, expira_em = ? WHERE cliente = ?').run(cifrar('AT-DO-OUTRO'), cifrar('RT-DO-OUTRO'), new Date(Date.now() + 6 * 3600e3).toISOString(), CLI)
      return { ok: false, status: 400, text: async () => '{"message":"Error validating grant","error":"invalid_grant"}', json: async () => ({ message: 'Error validating grant', error: 'invalid_grant' }) }
    }
    return fetchOriginal(url, opts)
  }
  const antesN = listarNotificacoes().ultimo_id
  assert.equal(await tokenValido(CLI), 'AT-DO-OUTRO', 'usa o token que o outro processo gravou')
  assert.equal(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, '', 'conta saudável NÃO cai por corrida')
  assert.equal(listarNotificacoes({ desde: antesN }).itens.length, 0, 'sem alarme falso')
  globalThis.fetch = fetchOriginal

  // 10) queda DEFINITIVA vira aviso (uma vez só em 12 h), com o caminho para reconectar
  semear(); usados.add('RT-0')
  assert.equal(await tokenValido(CLI), null)
  assert.match(db.prepare("SELECT erro FROM meli_contas WHERE cliente = ?").get(CLI).erro, /validating grant/)
  let av = listarNotificacoes({ desde: antesN0 }).itens.filter(n => n.tipo === 'conexao_caiu' && n.cliente === CLI)
  assert.equal(av.length, 1); assert.equal(av[0].nivel, 'erro'); assert.equal(av[0].link, '/integracoes')
  semear(); usados.add('RT-0'); await tokenValido(CLI)
  assert.equal(listarNotificacoes({ desde: antesN0 }).itens.filter(n => n.tipo === 'conexao_caiu' && n.cliente === CLI).length, 1, 'não repete o aviso dentro da janela (a 1ª queda do teste já avisou)')

  // 11) desconectar um CLIENTE arquiva a linha (restaurável sem o cliente autorizar de novo); restaurar nunca sobrescreve conexão viva
  semear(); desconectar(CLI, 'teste')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_contas WHERE cliente = ?').get(CLI).n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_contas_arquivo WHERE cliente = ?').get(CLI).n, 1)
  assert.deepEqual(restaurarConexoes({ clientes: [CLI], origem: 'arquivada' }), [CLI])
  assert.equal(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, '')
  assert.deepEqual(restaurarConexoes({ clientes: [CLI], origem: 'arquivada' }), [], 'já existe: não sobrescreve')
  // prospect (LGPD): apaga de vez, sem arquivo
  const PROS = '[Comercial] Teste · deadbeef'
  db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id) VALUES (?, 2, 'p', ?, ?, ?, '', ?, ?, '', '')`).run(PROS, cifrar('a'), cifrar('b'), new Date(Date.now() + 3600e3).toISOString(), agoraIso(), agoraIso())
  desconectar(PROS)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meli_contas_arquivo WHERE cliente = ?').get(PROS).n, 0, 'prospect não é arquivado')
  // backup diário: só clientes (nunca prospect), arquivo com permissão restrita
  // data no futuro: backupConexoes guarda só os 14 nomes mais novos de data/backups e um fixture «2000-01-01» era podado no mesmo instante quando já havia 14 backups reais (21/10/2026)
  const b = backupConexoes('2999-12-31')
  assert.ok(b.n >= 1 && b.arquivo.endsWith('meli_contas-2999-12-31.json'))
  assert.ok(!JSON.parse((await import('node:fs')).readFileSync(b.arquivo, 'utf-8')).linhas.some(l => l.cliente.startsWith('[Comercial]')))
  ;(await import('node:fs')).unlinkSync(b.arquivo)
  // 12) invalid_client (segredo do app errado no .env) NÃO marca a conta como caída — é o app, não o cliente
  semear(); const fetch0 = globalThis.fetch
  globalThis.fetch = async (url, opts) => String(url).includes('/oauth/token') ? { ok: false, status: 401, text: async () => '', json: async () => ({ error: 'invalid_client', message: 'invalid client credentials' }) } : fetch0(url, opts)
  assert.equal(await tokenValido(CLI), null); assert.equal(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, '', 'credencial do app errada não derruba a conta')
  assert.ok(listarNotificacoes({ desde: antesN0 }).itens.some(n => n.tipo === 'meli_credencial'), 'mas avisa que a credencial do app foi recusada')
  globalThis.fetch = fetch0

  // 13) conta em erro é retomada pela preventiva depois de 6 h (falso alarme resolvido por outro processo volta sozinha)
  semear(); db.prepare("UPDATE meli_contas SET erro = 'Mercado Livre OAuth 400: Error validating grant', atualizado_em = ? WHERE cliente = ?").run(new Date(Date.now() - 7 * 3600e3).toISOString(), CLI)
  chamadas = 0; const rr = await renovarPreventivo({ margemMin: 90, clientes: [CLI] })
  assert.equal(rr.recuperadas, 1); assert.equal(db.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(CLI).erro, ''); assert.ok(chamadas >= 1)
  semear(); db.prepare("UPDATE meli_contas SET erro = 'x', atualizado_em = ? WHERE cliente = ?").run(new Date().toISOString(), CLI)
  chamadas = 0; await renovarPreventivo({ margemMin: 90, clientes: [CLI] }); assert.equal(chamadas, 0, 'erro recente (< 6 h) não é martelado')

  // 14) revogar o app de um prospect derrubaria a conexão de um CLIENTE do mesmo seller: não revoga
  const { revogarConexao } = await import('../src/lib/meli-contas.js')
  const COM = '[Comercial] Mesmo seller · cafe0001'
  db.prepare(`INSERT INTO meli_contas (cliente, meli_user_id, nickname, access_token, refresh_token, expira_em, escopos, conectado_em, atualizado_em, erro, app_id) VALUES (?, 1, 'p', ?, ?, ?, '', ?, ?, '', '')`).run(COM, cifrar('a'), cifrar('b'), new Date(Date.now() + 3600e3).toISOString(), agoraIso(), agoraIso())
  semear()
  let revogou = false; globalThis.fetch = async (url, opts) => { if (opts?.method === 'DELETE') revogou = true; return fetch0(url, opts) }
  assert.equal(await revogarConexao(COM), false); assert.equal(revogou, false, 'mesmo seller e app de um cliente: NÃO revoga'); globalThis.fetch = fetch0
  db.prepare('DELETE FROM meli_contas WHERE cliente = ?').run(COM)

  // 15) trocar a conta do ML de um cliente arquiva a conexão antiga e avisa
  const { salvarConexao } = await import('../src/lib/meli-contas.js')
  semear(); salvarConexao(CLI, { user_id: 999, access_token: 'n', refresh_token: 'm', expires_in: 21600, scope: '' }, { nickname: 'OUTRA' })
  assert.match(db.prepare('SELECT motivo FROM meli_contas_arquivo WHERE cliente = ? ORDER BY id DESC LIMIT 1').get(CLI).motivo, /conta ML trocada/, 'a conexão antiga ficou guardada')
  assert.ok(listarNotificacoes({ desde: antesN0 }).itens.some(n => n.tipo === 'conta_trocada' && n.nivel === 'alerta'))
  // 16) backup nunca é regravado vazio nem perde conta que já tinha
  const b1 = backupConexoes('2000-01-02'), fs = await import('node:fs')
  const dado = JSON.parse(fs.readFileSync(b1.arquivo, 'utf-8')); dado.linhas.push({ ...dado.linhas[0], cliente: '__so_no_backup__' }); fs.writeFileSync(b1.arquivo, JSON.stringify(dado))
  const b2 = backupConexoes('2000-01-02'); assert.ok(JSON.parse(fs.readFileSync(b2.arquivo, 'utf-8')).linhas.some(l => l.cliente === '__so_no_backup__'), 'regravar o snapshot não perde conta que ele já tinha')
  fs.unlinkSync(b2.arquivo)
  console.log('✔ renovação ML: preventiva de verdade, corrida não derruba conta viva, queda definitiva avisa uma vez, desconectar arquiva (prospect não), backup diário')
  console.log('✔ renovação ML: 1 renovação por conta (5 chamadas simultâneas), trava entre processos, soluço de rede não desconecta, invalid_grant visível, preventiva ok')
} finally { db.exec('ROLLBACK') }
