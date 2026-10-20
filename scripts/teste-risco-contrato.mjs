// Autoteste do cliente EM RISCO (src/lib/risco-cliente.js) e do CONTRATO/PAGAMENTOS (src/lib/contrato-cliente.js) + rotas (src/rotas-dossie.js): marcação só por
// líder/consultor/CS (403), prévia por padrão, um risco aberto por motivo (409), descrição sem telefone, encerramento; tudo no livro de registro com a data do fato;
// sinais SÓ sugeridos (nada é marcado sozinho; data aproximada e prospect nunca); upload base64 ≤ 5 MB com PDF/PNG/JPG conferido pelos bytes, guardado por sha256
// (mesmo arquivo = mesmo caminho; mesma versão do contrato = um registro só); pagamento idempotente; HTTP: 415, 404 sem eco, 7 MB só nas rotas de upload.
// Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes do import dinâmico do db.js); arquivos numa pasta temporária apagada no fim. Rodar: node scripts/teste-risco-contrato.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import express from 'express'
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { criarLivro } from '../src/lib/livro-registro.js'
import { criarRisco, MOTIVOS_RISCO } from '../src/lib/risco-cliente.js'
import { criarContratos, MAX_ARQUIVO } from '../src/lib/contrato-cliente.js'
import { criarRotasDossie, uploadJson, ROTAS_UPLOAD } from '../src/rotas-dossie.js'
const { db } = await import('../src/lib/db.js')

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const sha = b => createHash('sha256').update(b).digest('hex')
const raiz = mkdtempSync(join(tmpdir(), 'dossie-'))
process.on('exit', () => rmSync(raiz, { recursive: true, force: true }))
const HOJE = '2026-10-13', agora = () => '2026-10-13T12:00:00.000Z'
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const QUEM = ['Giovanna Torres', 'Ana Paula (CS)']
const validarPor = nome => QUEM.find(x => norm(x) === norm(nome)) || ''
const PROSP = '[Comercial] Empresa X · 9'
const livro = criarLivro({ handle: db, agora })
const risco = criarRisco({ handle: db, livro, hoje: () => HOJE, agora, validarPor, clientes: () => ['Acme', 'Beta', 'Gama', PROSP] })
const contratos = criarContratos({ handle: db, livro, raiz, agora, hoje: () => HOJE, validarPor })
const doLivro = tipo => db.prepare('SELECT * FROM registro_cliente WHERE tipo = ? ORDER BY seq').all(tipo)
const erroDe = (fn, status, rx) => { try { fn() } catch (e) { assert.equal(e.status, status); if (rx) assert.match(e.message, rx); return e.message } assert.fail('não lançou') }
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n'), PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('img')]), JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const b64 = b => ({ base64: b.toString('base64') })

await ok('marcar risco: prévia não grava; confirmar grava, normaliza quem marcou e entra no livro com a data do fato', async () => {
  const p = risco.marcar({ cliente: 'Acme', motivo: 'reembolso', descricao: 'Pediu o dinheiro de volta na reunião', desde: '2026-10-10', por: 'giovanna torres' })
  assert.deepEqual([p.previa, p.registro.por, p.registro.motivo_rotulo], [true, 'Giovanna Torres', MOTIVOS_RISCO.reembolso])
  assert.deepEqual([db.prepare('SELECT COUNT(*) n FROM risco_cliente').get().n, doLivro('risco_marcado').length], [0, 0])
  const r = risco.marcar({ cliente: 'Acme', motivo: 'reembolso', descricao: 'Pediu o dinheiro de volta na reunião', desde: '2026-10-10', por: 'giovanna torres', confirmar: true })
  assert.deepEqual([r.previa, r.risco.estado, r.risco.por, r.risco.desde], [false, 'aberto', 'Giovanna Torres', '2026-10-10'])
  const l = doLivro('risco_marcado'); assert.equal(l.length, 1); assert.deepEqual([l[0].ref, l[0].fato_em, l[0].cliente], [`risco:${r.risco.id}`, '2026-10-10', 'Acme'])
  assert.match(l[0].resumo, /Pedido de reembolso \(por Giovanna Torres\)/)
  assert.equal(risco.marcar({ cliente: 'Acme', motivo: 'juridico', por: 'Ana Paula (CS)', confirmar: true }).risco.desde, HOJE, 'CS também marca; desde padrão = hoje')
})

await ok('marcar risco: um aberto por motivo (409), quem não é da central (403), motivo/desde/descrição inválidos (400) — mensagens fixas, sem eco', async () => {
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'reembolso', por: 'Giovanna Torres', confirmar: true }), 409)
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'reclamacao', por: 'Fulano<b>', confirmar: true }), 403, /líder, consultor ou o CS deste cliente/)
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'DROP', por: 'Giovanna Torres' }), 400, /motivo inválido/)
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'outro', desde: '2026-12-01', por: 'Giovanna Torres' }), 400, /até hoje/)
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'outro', desde: '13/10/2026', por: 'Giovanna Torres' }), 400)
  const m = erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'outro', descricao: 'ligar (11) 98765-4321', por: 'Giovanna Torres' }), 400, /telefone/); assert.ok(!m.includes('98765'))
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'outro', descricao: 'whats 11987654321', por: 'Giovanna Torres' }), 400, /telefone/)
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'outro', descricao: 'x'.repeat(501), por: 'Giovanna Torres' }), 400, /500/)
  erroDe(() => risco.marcar({ cliente: 'Acme', motivo: 'outro', descricao: 42, por: 'Giovanna Torres' }), 400, /texto/)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM risco_cliente WHERE cliente = 'Acme'").get().n, 2)
})

await ok('encerrar risco: prévia, confirmar (livro risco_encerrado), já encerrado = 409, id de outro cliente = 404; depois o mesmo motivo pode reabrir', async () => {
  const id = risco.listar('Acme').find(r => r.motivo === 'reembolso').id
  assert.equal(risco.encerrar({ cliente: 'Acme', id, por: 'Giovanna Torres', nota: 'Acordo fechado' }).previa, true)
  erroDe(() => risco.encerrar({ cliente: 'Beta', id, por: 'Giovanna Torres', confirmar: true }), 404)
  erroDe(() => risco.encerrar({ cliente: 'Acme', id: 'abc', por: 'Giovanna Torres' }), 400)
  const e = risco.encerrar({ cliente: 'Acme', id, por: 'Giovanna Torres', nota: 'Acordo fechado', confirmar: true })
  assert.deepEqual([e.risco.estado, e.risco.encerrado_por, e.risco.nota_encerramento], ['encerrado', 'Giovanna Torres', 'Acordo fechado'])
  const l = doLivro('risco_encerrado'); assert.deepEqual([l.length, l[0].ref, l[0].fato_em], [1, `risco:${id}`, agora()])
  erroDe(() => risco.encerrar({ cliente: 'Acme', id, por: 'Giovanna Torres', confirmar: true }), 409)
  assert.equal(risco.marcar({ cliente: 'Acme', motivo: 'reembolso', por: 'Giovanna Torres' }).previa, true, 'motivo livre de novo')
  assert.deepEqual(risco.abertos().map(r => [r.cliente, r.motivo]), [['Acme', 'juridico']])
  assert.equal(livro.verificarCadeia('Acme').ok, true)
})

await ok('sinais SÓ sugerem (nada é marcado): queda forte, reputação vermelha atual, HS em risco, resposta crítica 30 d, pendência exata ≥ 30 d, alinhamento vencido; prospect e fora da central nunca', async () => {
  const antes = db.prepare('SELECT COUNT(*) n FROM risco_cliente').get().n
  const gat = (cliente, tipo, estado) => db.prepare("INSERT INTO gatilho_cliente (cliente, tipo, classe, assinatura, estado, criado_em, atualizado_em) VALUES (?, ?, 'critico', ?, ?, '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z')").run(cliente, tipo, cliente + tipo + estado, estado)
  gat('Acme', 'queda_forte_conta', 'interno'); gat('Gama', 'queda_forte_conta', 'resolvido'); gat(PROSP, 'queda_forte_conta', 'interno'); gat('Delta', 'queda_forte_conta', 'interno')
  const saude = (cliente, dia, level) => db.prepare("INSERT INTO meli_conta_saude (cliente, dia, level_id, coletado_em) VALUES (?, ?, ?, ?)").run(cliente, dia, level, dia + 'T05:00:00Z')
  saude('Beta', '2026-10-01', '5_green'); saude('Beta', '2026-10-12', '1_red'); saude('Gama', '2026-10-01', '1_red'); saude('Gama', '2026-10-12', '5_green'); saude('Gama', '2026-10-13', null)
  db.prepare("INSERT INTO clientes_central (cliente, atualizado_em, hs_classificacao, hs_em) VALUES ('Beta', ?, 'Risco', '2026-10-05'), ('Gama', ?, 'Atenção', '2026-10-05')").run(agora(), agora())
  const fb = (id, cliente, em, temas, status = 'novo') => db.prepare(`INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, temas_json, status, coletado_em)
    VALUES (?, ?, 'g', 't', ?, 'a', 'relatorio', 'citou', 'certa', ?, ?, ?)`).run(id, cliente, em, JSON.stringify(temas), status, em)
  fb('f1', 'Acme', '2026-10-11T10:00:00Z', ['critica', 'vendas']); fb('f2', 'Gama', '2026-08-01T10:00:00Z', ['critica']); fb('f3', 'Gama', '2026-10-11T10:00:00Z', ['critica'], 'descartado')
  const pend = (cliente, desde, resolvida = '') => db.prepare("INSERT INTO pendencia_cliente (cliente, canal, item, desde, gravidade, por, criada_em, resolvida_em) VALUES (?, 'ml', 'custos', ?, 'critico', 'Giovanna Torres', ?, ?)").run(cliente, desde, agora(), resolvida)
  pend('Acme', '2026-09-01'); pend('Gama', '2026-10-05'); pend('Gama', '2026-08-01', '2026-09-01T10:00:00Z'); pend('Gama', '')
  db.prepare("INSERT INTO tarefas (id, fonte, cliente, titulo, status) VALUES ('tg1','f','Gama','Fotos','dependencia_cliente'), ('tg2','f','Gama','Fotos 2','concluida')").run()
  db.prepare("INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, por, em, notion_ok) VALUES ('tg1','Gama','fotos','x','Giovanna Torres','2026-09-01T10:00:00Z',1), ('tg2','Gama','fotos','x','Giovanna Torres','2026-08-01T10:00:00Z',1)").run()
  db.prepare("INSERT INTO alinhamento (cliente, escopo, chave, tipo, por, origem, desde, revisar_em, estado, criado_em) VALUES ('Beta','anuncio','MLB1','intencional','Giovanna Torres','painel','2026-09-01','2026-10-01','vivo', ?), ('Gama','anuncio','MLB2','intencional','Giovanna Torres','painel','2026-09-01','2026-11-01','vivo', ?)").run(agora(), agora())
  const s = risco.sugestoes()
  const mapa = Object.fromEntries(s.map(x => [x.cliente, x.sinais.map(y => y.id).sort()]))
  assert.deepEqual(mapa, { Acme: ['pendencia_30d', 'queda_forte_conta', 'resposta_critica'], Beta: ['alinhamento_vencido', 'health_score', 'reputacao_vermelha'], Gama: ['pendencia_30d'] })
  assert.match(s.find(x => x.cliente === 'Gama').sinais[0].rotulo, /^1 pendência/, 'só a tarefa ainda aguardando o cliente conta')
  assert.deepEqual(s.map(x => [x.cliente, x.risco_aberto]), [['Acme', true], ['Beta', false], ['Gama', false]])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM risco_cliente').get().n, antes, 'sugerir nunca marca')
})

await ok('contrato: prévia não grava nada; confirmar guarda o PDF por sha256 (bytes iguais), o vigente e o livro; a mesma versão de novo não duplica o registro', async () => {
  const corpo = { cliente: 'Acme', inicio: '2026-03-01', fim: '2027-02-28', canais: ['Mercado Livre', 'Shopee'], entregaveis: ['Otimização de anúncios', 'Relatório mensal'], valor_mensal_centavos: 350000,
    obrigacao_meio: true, clausula_reembolso: 'Sem reembolso de mensalidades já executadas.', arquivo: b64(PDF), por: 'Ana Paula (CS)' }
  const p = contratos.salvarContrato(corpo)
  assert.deepEqual([p.previa, p.contrato.arquivo, p.contrato.obrigacao_meio], [true, { tipo: 'pdf', bytes: PDF.length, sha256: sha(PDF) }, true])
  assert.deepEqual([existsSync(join(raiz, 'dossies')), contratos.ler('Acme').contrato, doLivro('contrato').length], [false, null, 0])
  const c = contratos.salvarContrato({ ...corpo, confirmar: true }).contrato
  assert.equal(c.arquivo, join('dossies', 'docs', `${sha(PDF)}.pdf`)); assert.ok(readFileSync(join(raiz, c.arquivo)).equals(PDF))
  assert.deepEqual([c.arquivo_sha256, c.canais, c.obrigacao_meio, c.valor_mensal_centavos, c.por], [sha(PDF), ['Mercado Livre', 'Shopee'], true, 350000, 'Ana Paula (CS)'])
  const l = doLivro('contrato'); assert.equal(l.length, 1); assert.equal(l[0].prova, `arquivo:${c.arquivo}#sha256:${sha(PDF)}`); assert.match(l[0].resumo, /R\$ 3\.500,00\/mês; obrigação de meio: sim; arquivo anexado/)
  contratos.salvarContrato({ ...corpo, confirmar: true }); assert.equal(doLivro('contrato').length, 1, 'mesma versão = um registro')
  const sem = contratos.salvarContrato({ ...corpo, arquivo: undefined, valor_mensal_centavos: 400000, confirmar: true }).contrato
  assert.deepEqual([sem.arquivo, sem.arquivo_sha256, doLivro('contrato').length], [c.arquivo, sha(PDF), 2], 'sem arquivo novo mantém o anterior; versão nova = registro novo')
  assert.equal(readdirSync(join(raiz, 'dossies', 'docs')).length, 1, 'mesmo arquivo, um só no disco')
  // A → B → A: voltar à versão anterior é uma mudança e entra no livro (antes: o ref pelo conteúdo já existia e a volta sumia, deixando B como «último» no livro)
  const volta = contratos.salvarContrato({ ...corpo, confirmar: true }).contrato
  assert.deepEqual([volta.valor_mensal_centavos, doLivro('contrato').length], [350000, 3])
  assert.match(doLivro('contrato').at(-1).resumo, /R\$ 3\.500,00\/mês; obrigação de meio: sim/, 'o último registro do livro = o vigente')
  contratos.salvarContrato({ ...corpo, confirmar: true }); assert.equal(doLivro('contrato').length, 3, 'regravar a versão vigente não registra de novo')
})

await ok('arquivo: só PDF/PNG/JPG pelos bytes (nome não decide), base64 válido, data URL aceita, ≤ 5 MB (413); campos do contrato validados', async () => {
  const base = { cliente: 'Beta', por: 'Giovanna Torres' }
  erroDe(() => contratos.salvarContrato({ ...base, arquivo: { base64: Buffer.from('<html>pdf de mentira</html>').toString('base64'), nome: 'contrato.pdf' } }), 400, /PDF, PNG ou JPG/)
  erroDe(() => contratos.salvarContrato({ ...base, arquivo: { base64: '%%%não é base64' } }), 400, /base64/)
  erroDe(() => contratos.salvarContrato({ ...base, arquivo: 123 }), 400)
  erroDe(() => contratos.salvarContrato({ ...base, arquivo: b64(Buffer.concat([PDF, Buffer.alloc(MAX_ARQUIVO)])) }), 413)
  assert.equal(contratos.salvarContrato({ ...base, arquivo: `data:image/png;base64,${PNG.toString('base64')}` }).contrato.arquivo.tipo, 'png')
  assert.equal(contratos.salvarContrato({ ...base, arquivo: b64(JPG) }).contrato.arquivo.tipo, 'jpg')
  erroDe(() => contratos.salvarContrato({ ...base, inicio: '2026-05-01', fim: '2026-04-01' }), 400, /antes/)
  erroDe(() => contratos.salvarContrato({ ...base, valor_mensal_centavos: 3500.5 }), 400, /centavos/)
  erroDe(() => contratos.salvarContrato({ ...base, canais: 'ML' }), 400)
  erroDe(() => contratos.salvarContrato({ ...base, obrigacao_meio: 'sim' }), 400)
  erroDe(() => contratos.salvarContrato({ ...base, clausula_reembolso: 'falar no (11) 98765-4321' }), 400, /telefone/)
  erroDe(() => contratos.salvarContrato({ ...base, por: 'Desconhecido' }), 403)
  assert.equal(contratos.ler('Beta').contrato, null, 'nada gravado')
})

await ok('pagamento: prévia; confirmar grava + comprovante por sha256 + livro com a data do pagamento; repetido = 409; data futura e valor inválido = 400', async () => {
  const corpo = { cliente: 'Acme', data: '2026-09-05', valor_centavos: 350000, referencia: 'Mensalidade set/2026', arquivo: b64(JPG), por: 'Giovanna Torres' }
  assert.equal(contratos.registrarPagamento(corpo).previa, true); assert.equal(contratos.ler('Acme').pagamentos.length, 0)
  const p = contratos.registrarPagamento({ ...corpo, confirmar: true }).pagamento
  assert.deepEqual([p.valor_centavos, p.sha256, p.arquivo], [350000, sha(JPG), join('dossies', 'docs', `${sha(JPG)}.jpg`)])
  const l = doLivro('pagamento'); assert.deepEqual([l.length, l[0].fato_em, l[0].ref], [1, '2026-09-05', `pg:${p.id}`]); assert.match(l[0].resumo, /R\$ 3\.500,00 em 05\/09\/2026 \(Mensalidade set\/2026\); comprovante anexado/)
  erroDe(() => contratos.registrarPagamento({ ...corpo, confirmar: true }), 409)
  erroDe(() => contratos.registrarPagamento({ ...corpo, data: '2026-11-01' }), 400, /futuro/)
  erroDe(() => contratos.registrarPagamento({ ...corpo, valor_centavos: -1 }), 400)
  erroDe(() => contratos.registrarPagamento({ ...corpo, valor_centavos: '350000' }), 400)
  erroDe(() => contratos.registrarPagamento({ ...corpo, data: undefined }), 400)
  assert.equal(contratos.registrarPagamento({ cliente: 'Acme', data: '2026-10-05', valor_centavos: 350000, por: 'Giovanna Torres', confirmar: true }).pagamento.arquivo, '', 'sem comprovante também registra')
  assert.equal(livro.verificarCadeia().ok, true)
})

await ok('rotas: 415 sem JSON, 404 prospect/desconhecido sem eco, 403, confirmar "true" = prévia, contrato de ~4 MB passa só nas rotas de upload (o resto segue em 1 MB)', async () => {
  const app = express()
  app.use(ROTAS_UPLOAD, uploadJson); app.use(express.json({ limit: '1mb' }))   // mesma ordem do server.js
  app.use(criarRotasDossie({ livro, risco, contratos, quem: () => QUEM, clienteCanonico: nome => ['Acme', 'Beta', 'Gama'].find(c => norm(c) === norm(nome)) || '' }))
  app.use((err, req, res, _n) => res.status(err?.type === 'entity.too.large' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 500).json({ erro: 'x' }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, tipo = 'application/json') => { const r = await fetch(base + rota, corpo === undefined ? {} : { method: 'POST', headers: { 'content-type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); const t = await r.text(); return { status: r.status, j: JSON.parse(t), t } }
  try {
    for (const rota of ['/api/cliente/risco', '/api/cliente/risco/encerrar', '/api/cliente/contrato', '/api/cliente/pagamento']) assert.equal((await chama(rota, '{}', 'text/plain')).status, 415, rota)
    const p = await chama('/api/cliente/risco', { cliente: PROSP, motivo: 'outro', por: 'Giovanna Torres' }); assert.deepEqual([p.status, p.j.erro], [404, 'cliente não encontrado na central']); assert.ok(!p.t.includes('Empresa X'))
    const d = await chama('/api/cliente/contrato?cliente=', undefined); assert.equal(d.status, 400)
    assert.equal((await chama('/api/cliente/contrato?cliente=Fantasma', undefined)).status, 404)
    const q = await chama('/api/cliente/risco', { cliente: 'gama', motivo: 'reclamacao', por: 'Quem<script>' }); assert.equal(q.status, 403); assert.ok(!q.t.includes('script'))
    const pv = await chama('/api/cliente/risco', { cliente: 'gama', motivo: 'reclamacao', por: 'Giovanna Torres', confirmar: 'true' }); assert.deepEqual([pv.status, pv.j.previa], [200, true])
    const cf = await chama('/api/cliente/risco', { cliente: 'gama', motivo: 'reclamacao', por: 'Giovanna Torres', confirmar: true }); assert.deepEqual([cf.status, cf.j.risco.cliente], [200, 'Gama'])
    const g = await chama('/api/risco', undefined); assert.deepEqual(Object.keys(g.j), ['abertos', 'sugestoes', 'motivos', 'quem']); assert.ok(g.j.abertos.some(r => r.cliente === 'Gama'))
    const gr = await chama('/api/cliente/risco?cliente=Gama', undefined); assert.deepEqual(Object.keys(gr.j), ['cliente', 'riscos', 'motivos', 'quem'])
    const enc = await chama('/api/cliente/risco/encerrar', { cliente: 'Gama', id: cf.j.risco.id, por: 'Giovanna Torres', confirmar: true }); assert.equal(enc.j.risco.estado, 'encerrado')
    const grande = Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)])
    const up = await chama('/api/cliente/contrato', { cliente: 'Gama', arquivo: b64(grande), por: 'Giovanna Torres' }); assert.deepEqual([up.status, up.j.previa, up.j.contrato.arquivo.bytes], [200, true, grande.length])
    assert.equal((await chama('/api/cliente/risco', { cliente: 'Gama', motivo: 'outro', descricao: 'x'.repeat(2 * 1024 * 1024), por: 'Giovanna Torres' })).status, 413, 'as outras rotas seguem no limite de 1 MB')
    const pg = await chama('/api/cliente/pagamento', { cliente: 'Gama', data: '2026-10-01', valor_centavos: 100, por: 'Giovanna Torres', confirmar: true }); assert.equal(pg.status, 200)
    const gc = await chama('/api/cliente/contrato?cliente=Gama', undefined); assert.deepEqual([Object.keys(gc.j), gc.j.contrato, gc.j.pagamentos.length], [['cliente', 'contrato', 'pagamentos', 'quem'], null, 1])
  } finally { srv.close() }
})

await ok('quem pode: líder/consultor em qualquer cliente; CS só no cliente do próprio cadastro (validarDossie real); risco e contrato passam o cliente ao validador', async () => {
  const { validarDossie } = await import('../src/lib/livro-registro-real.js')
  db.prepare("INSERT INTO prestadores (nome, nome_norm, cargo, atualizado_em) VALUES ('Lia Lider', 'lia lider', 'Líder de squad', ?)").run(agora())
  db.prepare("INSERT INTO clientes_central (cliente, atualizado_em, cs_responsavel) VALUES ('Zeta', ?, 'Carla CS / Duda CS'), ('Omega', ?, 'Outra CS')").run(agora(), agora())
  assert.deepEqual([validarDossie('carla cs', 'Zeta'), validarDossie('Duda CS', 'Zeta'), validarDossie('Outra CS', 'Omega')], ['Carla CS', 'Duda CS', 'Outra CS'])
  assert.deepEqual([validarDossie('Carla CS', 'Omega'), validarDossie('Carla CS', ''), validarDossie('', 'Zeta')], ['', '', ''], 'CS de outro cliente (ou sem cliente) = não')
  assert.deepEqual([validarDossie('lia lider', 'Omega'), validarDossie('Lia Lider', 'Zeta')], ['Lia Lider', 'Lia Lider'])
  const soZeta = (nome, cliente) => cliente === 'Zeta' ? 'Carla CS' : ''
  const r2 = criarRisco({ handle: db, livro, hoje: () => HOJE, agora, validarPor: soZeta, clientes: () => [] })
  erroDe(() => r2.marcar({ cliente: 'Omega', motivo: 'outro', por: 'Carla CS' }), 403); assert.equal(r2.marcar({ cliente: 'Zeta', motivo: 'outro', por: 'Carla CS' }).previa, true)
  const c2 = criarContratos({ handle: db, livro, raiz, agora, hoje: () => HOJE, validarPor: soZeta })
  erroDe(() => c2.salvarContrato({ cliente: 'Omega', por: 'Carla CS' }), 403); erroDe(() => c2.registrarPagamento({ cliente: 'Omega', data: '2026-10-01', valor_centavos: 1, por: 'Carla CS' }), 403)
  assert.equal(c2.salvarContrato({ cliente: 'Zeta', por: 'Carla CS' }).previa, true)
})

console.log(`\n${n} casos ok — cliente em risco, contrato e pagamentos`)
