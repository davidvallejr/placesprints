// Autoteste do "É intencional" do Place Sprint 90 (PLANO ATIVO 4 — alinhamentos com o cliente): o próprio cliente marca uma prioridade como intencional com um motivo
// da LISTA FECHADA (config/alinhamentos.json → tipos_s90) → alinhamento origem 's90_cliente', revisão padrão +30 d, regra suprimida no plano seguinte.
// Cobre: cliente SÓ da sessão; ref opaca (o id interno da ação nunca sai); ação de OUTRA conta = 404; motivo fora da lista = 400 sem eco; corpo não JSON = 415;
// repetir não duplica; o painel mostra "Marcado por você como intencional em dd/mm; revisamos em dd/mm"; sem o núcleo = 503.
// Banco em memória, mini-app em porta efêmera, nada chama o ML nem o Mercado Pago. Rodar: node scripts/teste-sprint90-intencional.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: db.js abre :memory:
process.env.PS_OFERTAS_MEMORIA = '1'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createHash } from 'node:crypto'
import { readFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const { db } = await import('../src/lib/db.js')
const { env, ROOT } = await import('../src/lib/env.js')
const { criarS90 } = await import('../src/lib/s90.js')
const MC = await import('../src/lib/meli-contas.js')
const { criarRotasSprint90 } = await import('../src/rotas-sprint90.js')
const { guardaLocal } = await import('../src/lib/guarda-local.js')
const { criarAlinhamentos } = await import('../src/lib/alinhamentos.js')
assert.equal(db.name, ':memory:', 'o teste jamais pode abrir o banco real')

const HOJE = '2026-10-08', agora = () => `${HOJE}T12:00:00.000Z`
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'sprint90.json'), 'utf8'))
const s90 = criarS90({ handle: db, cfg, agora, hoje: () => HOJE, notificar: () => {}, termos: () => ({ versao: 's90-v1', hash: 'h1', texto: '## Termos', rascunho: false }), mp: { atualizarPreapproval: async () => true },
  dirBackup: mkdtempSync(join(tmpdir(), 's90-int-')), conexao: { status: MC.statusConexao, revogar: async () => true, desconectar: MC.desconectar, purgarPendentes: MC.purgarPendentesDe } })
const A = criarAlinhamentos({ handle: db, hoje: () => HOJE, agora, validarPor: () => '' })
const conta = loja => { const c = s90.cadastrar({ nome: 'Ana Teste', loja, email: `${loja.replace(/\W/g, '')}@teste.com`, plano: 'fixo' }, { por: 'Líder Teste' }); s90.registrarAceite(c.id, { aceite: true, consentimento: true, ip: '1.2.3.4', ua: 'UA' }); s90.mudarEstado(c.id, 'ativo', { por: 'X' }); return s90.contaPorId(c.id) }
const cA = conta('Loja A'), cB = conta('Loja B')
const acao = (id, cliente, item) => db.prepare(`INSERT INTO acoes_plano (id, cliente, regra, item_id, mes, titulo, horizonte, prazo, score, dados_json, criado_em, atualizado_em)
  VALUES (?, ?, 'anuncio_anuncio_restrito', ?, '2026-10', 'Reativar anúncio pausado', '7d', '2026-10-15', 50, ?, ?, ?)`).run(id, cliente, item, JSON.stringify({ fila: 'esta_semana', problema: 'Anúncio pausado com venda relevante' }), agora(), agora())
acao('PS-a0a0a0a0a0', cA.chave, 'MLB111'); acao('PS-b0b0b0b0b0', cB.chave, 'MLB222')
const ref = (chave, id) => createHash('sha256').update(`${chave}|${id}`).digest('hex').slice(0, 16)

const HS = 'sprint90.teste.example'
env.SPRINT90_PUBLIC_HOST = HS; env.MELI_CLIENT_ID ||= 'app-teste'
const leitura = { conexao: MC.statusConexao, cobertura: () => ({ dias: 0 }), diagnostico: async () => ({ disponivel: false }), nomesInternos: async () => ['Giovanna Torres'] }
const montar = alinhamentos => {
  const app = express()
  app.use((req, res, next) => guardaLocal(req, res, next, '', HS)); app.use(express.json())
  app.use(criarRotasSprint90({ s90, hostS90: () => env.SPRINT90_PUBLIC_HOST, validarPor: () => '', conectarLink: () => 'https://exemplo.test', leitura, alinhamentos }))
  return new Promise(ok => { const s = app.listen(0, '127.0.0.1', () => ok(s)) })
}
const srv = await montar(A), srvSem = await montar(null)
const pedir = (s, method, path, { cookie, body, cru, origin = true } = {}) => new Promise((ok, falha) => {
  const porta = s.address().port, dados = cru ?? (body ? JSON.stringify(body) : null)
  const r = http.request({ host: '127.0.0.1', port: porta, method, path, headers: { host: `localhost:${porta}`, ...(origin ? { origin: `http://localhost:${porta}` } : {}), ...(cookie ? { cookie } : {}),
    ...(dados ? { 'content-type': cru ? 'text/plain' : 'application/json', 'content-length': Buffer.byteLength(dados) } : {}) } }, res => {
    let t = ''; res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: t, json: () => JSON.parse(t) }))
  })
  r.on('error', falha); if (dados) r.write(dados); r.end()
})
const entrar = async (s, contaId) => {
  const r = await pedir(s, 'POST', `/c/acesso/${s90.gerarAcesso(contaId, { origem: 'equipe' }).token}`)
  assert.equal(r.status, 303)
  return r.headers['set-cookie'][0].split(';')[0]
}
let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }

try {
  const ckA = await entrar(srv, cA.id), ckB = await entrar(srv, cB.id)
  const url = r => `/c/api/acoes/${r}/intencional`
  const rA = ref(cA.chave, 'PS-a0a0a0a0a0'), rB = ref(cB.chave, 'PS-b0b0b0b0b0')

  await ok('lista: cada prioridade leva uma ref opaca (16 hex, nunca o id interno) e a lista fechada de motivos na voz do cliente', async () => {
    const r = await pedir(srv, 'GET', '/c/api/acoes', { cookie: ckA })
    assert.equal(r.status, 200); const j = r.json()
    assert.equal(j.acoes.length, 1); assert.equal(j.acoes[0].ref, rA); assert.equal(j.acoes[0].intencional, null)
    assert.ok(!r.text.includes('PS-'), 'id interno da ação não sai'); assert.ok(!/MLB222|Loja B/.test(r.text), 'nada da outra conta')
    assert.deepEqual(j.motivos_intencional.map(m => m.id), ['intencional', 'pausa_producao', 'boi_de_piranha', 'descontinuado_queima_estoque', 'campanha_visibilidade', 'teste'])
    assert.ok(j.motivos_intencional.every(m => m.rotulo && !/ja_informado|outro/.test(m.id)), 'sem "já informado" (não há consultor) nem "outro" (sem texto livre)')
  })

  await ok('isolamento: a sessão de A não marca ação de B (404, nada gravado); a ref de B também não acha nada pela sessão de A; sem sessão = 401', async () => {
    let r = await pedir(srv, 'POST', url(rB), { cookie: ckA, body: { motivo_tipo: 'teste' } })
    assert.equal(r.status, 404); assert.equal(r.json().erro, 'Prioridade não encontrada.')
    r = await pedir(srv, 'POST', url(ref(cA.chave, 'PS-b0b0b0b0b0')), { cookie: ckA, body: { motivo_tipo: 'teste' } }); assert.equal(r.status, 404, 'id de B com a chave de A também não')
    r = await pedir(srv, 'POST', url('0'.repeat(16)), { cookie: ckA, body: { motivo_tipo: 'teste' } }); assert.equal(r.status, 404)
    assert.equal((await pedir(srv, 'POST', url(rA), { body: { motivo_tipo: 'teste' } })).status, 401)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 0)
  })

  await ok('motivo fora da lista = 400 com mensagem fixa (sem eco); "já informado" e "outro" não são do cliente; corpo não JSON = 415; CSRF = 403', async () => {
    for (const m of ['ja_informado', 'outro', '<script>x</script>', '', 'toString', '__proto__']) {
      const r = await pedir(srv, 'POST', url(rA), { cookie: ckA, body: { motivo_tipo: m } })
      assert.equal(r.status, 400, m); assert.equal(r.json().erro, 'Escolha um motivo da lista.'); assert.ok(!r.text.includes('script'))
    }
    assert.equal((await pedir(srv, 'POST', url(rA), { cookie: ckA, cru: 'motivo_tipo=teste' })).status, 415)
    const porta = srv.address().port
    const csrf = await new Promise(okk => { const rq = http.request({ host: '127.0.0.1', port: porta, method: 'POST', path: url(rA), headers: { host: `localhost:${porta}`, origin: 'https://evil.example', cookie: ckA, 'content-type': 'application/json' } }, res => { res.resume(); okk(res.statusCode) }); rq.end('{"motivo_tipo":"teste"}') })
    assert.equal(csrf, 403)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 0)
  })

  await ok('marcar: grava alinhamento origem s90_cliente (por "cliente", anúncio da ação, regra dela, revisão +30 d); o plano seguinte não recria a regra; repetir não duplica; o painel mostra o texto', async () => {
    let r = await pedir(srv, 'POST', url(rA), { cookie: ckA, body: { motivo_tipo: 'pausa_producao', cliente: cB.chave } })
    assert.equal(r.status, 200); assert.equal(r.json().intencional.texto, 'Marcado por você como intencional em 08/10; revisamos em 07/11')
    const al = db.prepare('SELECT * FROM alinhamento').all()
    assert.equal(al.length, 1); assert.deepEqual([al[0].cliente, al[0].origem, al[0].por, al[0].escopo, al[0].chave, al[0].tipo, al[0].revisar_em, JSON.parse(al[0].regras_json)[0]],
      [cA.chave, 's90_cliente', 'cliente', 'anuncio', 'MLB111', 'pausa_producao', '2026-11-07', 'anuncio_restrito'], 'body.cliente ignorado: a conta é a da sessão')
    assert.equal(A.alinhado(cA.chave, { item: 'MLB111', regra: 'anuncio_anuncio_restrito' }).sim, true, 'o predicado do plano vê o alinhamento: a regra não renasce')
    assert.equal(A.alinhado(cB.chave, { item: 'MLB222', regra: 'anuncio_anuncio_restrito' }).sim, false, 'B intacta')
    r = await pedir(srv, 'POST', url(rA), { cookie: ckA, body: { motivo_tipo: 'teste' } }); assert.equal(r.status, 200); assert.equal(db.prepare('SELECT COUNT(*) n FROM alinhamento').get().n, 1, 'repetir não duplica')
    const lista = (await pedir(srv, 'GET', '/c/api/acoes', { cookie: ckA })).json()
    assert.equal(lista.acoes[0].intencional.texto, 'Marcado por você como intencional em 08/10; revisamos em 07/11')
    assert.equal((await pedir(srv, 'GET', '/c/api/acoes', { cookie: ckB })).json().acoes[0].intencional, null, 'B não vê a marca de A')
  })

  await ok('sem o núcleo dos alinhamentos a rota responde 503 (nada gravado) e a lista não oferece motivos', async () => {
    const ck = await entrar(srvSem, cB.id)
    assert.equal((await pedir(srvSem, 'POST', url(rB), { cookie: ck, body: { motivo_tipo: 'teste' } })).status, 503)
    assert.deepEqual((await pedir(srvSem, 'GET', '/c/api/acoes', { cookie: ck })).json().motivos_intencional, [])
  })

  await ok('ciclo de vida: o cliente lista o que marcou (sobrevive à regeneração do plano, ref opaca) e desfaz (encerra só origem s90_cliente); outra conta = 404; a central gerencia a chave S90', async () => {
    const lista = async ck => (await pedir(srv, 'GET', '/c/api/intencionais', { cookie: ck })).json().intencionais
    const la = await lista(ckA)
    assert.equal(la.length, 1); assert.deepEqual([la[0].motivo, la[0].anuncio, la[0].estado, la[0].texto], ['Pausei de propósito (produção ou fornecedor)', 'MLB111', 'valendo', 'Marcado por você como intencional em 08/10; revisamos em 07/11'])
    assert.match(la[0].ref, /^[0-9a-f]{16}$/); assert.ok(!/"id"|PS-|alinhamento:/.test(JSON.stringify(la)), 'id interno não sai')
    assert.deepEqual(await lista(ckB), [], 'B não vê a marca de A')
    db.prepare("UPDATE acoes_plano SET status = 'obsoleta' WHERE id = 'PS-a0a0a0a0a0'").run()                // o plano regerado tira a ação: a marca continua listada
    assert.equal((await lista(ckA)).length, 1)
    // alinhamento da EQUIPE na mesma conta: não aparece para o cliente e não se desfaz pelo painel dele
    const idEq = db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, regras_json, tipo, por, origem, desde, revisar_em, criado_em) VALUES (?, 'anuncio', 'MLB111', '[\"frete_gratis\"]', 'outro', 'Equipe', 'painel', ?, '2026-11-07', ?)").run(cA.chave, HOJE, agora()).lastInsertRowid
    assert.equal((await lista(ckA)).length, 1)
    const des = r => `/c/api/intencionais/${r}/desfazer`
    assert.equal((await pedir(srv, 'POST', des(ref(cA.chave, `alinhamento:${idEq}`)), { cookie: ckA, body: {} })).status, 404, 'só o que o próprio cliente marcou')
    assert.equal((await pedir(srv, 'POST', des(la[0].ref), { cookie: ckB, body: {} })).status, 404, 'a sessão de B não desfaz a marca de A')
    assert.equal((await pedir(srv, 'POST', des(la[0].ref), { cookie: ckA, cru: 'x' })).status, 415)
    const r = await pedir(srv, 'POST', des(la[0].ref), { cookie: ckA, body: {} }); assert.equal(r.status, 200); assert.deepEqual(r.json(), { ok: true })
    assert.deepEqual(db.prepare("SELECT origem, estado, encerrado_por FROM alinhamento WHERE cliente = ? ORDER BY id").all(cA.chave).map(x => [x.origem, x.estado, x.encerrado_por]), [['s90_cliente', 'encerrado', 'cliente'], ['painel', 'vivo', '']])
    assert.equal(A.alinhado(cA.chave, { item: 'MLB111', regra: 'anuncio_anuncio_restrito' }).sim, false, 'a recomendação volta no próximo plano')
    assert.deepEqual(await lista(ckA), []); assert.equal((await pedir(srv, 'POST', des(la[0].ref), { cookie: ckA, body: {} })).status, 404, 'desfazer de novo = 404')
    db.prepare('DELETE FROM alinhamento WHERE id = ?').run(idEq)
    // a central (rotas de alinhamentos) aceita a chave S90 de uma conta existente: listar, encerrar e renovar deixam de dar 404
    assert.match(readFileSync(join(ROOT, 'src', 'server.js'), 'utf8'), /const clienteOuS90 = nome => clienteDaCentral\(nome\) \|\| \(ehChaveS90\(nome\) && db\.prepare\('SELECT 1 FROM s90_conta WHERE chave = \?'\)[\s\S]*?criarRotasAlinhamentos\(\{ alinhamentos: alinhamentosReal\(\), quem: lideresEConsultores, clienteCanonico: clienteOuS90,/)
  })

  await ok('painel: botão "É intencional" (secundário) com select do motivo e "Confirmar"; o texto da marca vem do servidor; montado por DOM, sem innerHTML', async () => {
    const P = await import('../src/lib/s90-paginas.js'), h = P.paginaPainel({ nonce: 'n' })
    assert.match(h, /'É intencional'/); assert.match(h, /'\/c\/api\/acoes\/' \+ a\.ref \+ '\/intencional'/); assert.match(h, /motivo_tipo: sel\.value/); assert.match(h, /'Por que é de propósito\?'/)
    assert.match(h, /j\.intencional\.texto/); assert.doesNotMatch(h.slice(h.indexOf('function blocoIntencional')), /innerHTML/)
    assert.match(h, /api\('\/c\/api\/intencionais'\)/); assert.match(h, /'\/c\/api\/intencionais\/' \+ m\.ref \+ '\/desfazer'/); assert.match(h, /'Desfazer'/)
  })
} finally { srv.close(); srvSem.close() }
console.log(`\n${n} verificações do "É intencional" (Sprint 90) ok.`)
