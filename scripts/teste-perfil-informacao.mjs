// Autoteste do PERFIL DE INFORMAÇÃO do cliente (src/lib/perfil-informacao.js) + seed (scripts/seed-perfil-informacao.mjs) + rotas (src/rotas-feedback.js):
// lista fechada (tema/serviço/nível/fonte), prévia por padrão, histórico append-only e nota no livro a cada mudança (igual = nada), sugestão pelas respostas que nunca
// sobrescreve a equipe nem muda o relatório, matriz da carteira (contagem, % com perfil, serviço, temas padrão, ordem), seed idempotente (perfis + feedback curado
// origem 'equipe' com resposta_cliente no livro, sem duplicar na ingestão), sem telefone em lugar nenhum; HTTP 415/404/403 sem eco.
// Banco EM MEMÓRIA (sem db.js). Rodar: node scripts/teste-perfil-informacao.mjs
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { SCHEMA_LIVRO, criarLivro, temContato } from '../src/lib/livro-registro.js'
import { SCHEMA_FEEDBACK, criarRespostas } from '../src/lib/respostas-relatorio.js'
import { SCHEMA_PERFIL_INFO, criarPerfilInformacao, lerConfig, paraFeedback } from '../src/lib/perfil-informacao.js'
import { criarRotasPerfilInformacao } from '../src/rotas-feedback.js'
import { SEED, aplicarSeed, POR } from './seed-perfil-informacao.mjs'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const cfg = lerConfig(), TEMAS = Object.keys(cfg.temas)
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
let relogio = 0
const agora = () => new Date(Date.UTC(2026, 9, 13, 12, 0, relogio++)).toISOString()
const banco = () => { const h = new Database(':memory:'); h.exec(SCHEMA_LIVRO); h.exec(SCHEMA_FEEDBACK); h.exec(SCHEMA_PERFIL_INFO); h.exec(SCHEMA_PERFIL_INFO); return h }
const montar = (h, { quem = ['Giovanna Torres', POR], clientes = ['Acme', 'Beta', 'Gama', 'Delta'] } = {}) => {
  const livro = criarLivro({ handle: h, agora })
  return { livro, p: criarPerfilInformacao(h, { livro, agora, validarPor: nome => quem.find(x => norm(x) === norm(nome)) || '', clientes: () => clientes }) }
}
const erroDe = (fn, status, rx) => { try { fn() } catch (e) { assert.equal(e.status, status, e.message); if (rx) assert.match(e.message, rx); return e.message } assert.fail('não lançou') }
const conta = (h, t, w = '1 = 1', ...a) => h.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${w}`).get(...a).n
const fb = (h, id, cliente, temas, status = 'novo', recebido = '2026-10-10T10:00:00.000Z') => h.prepare(`INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, temas_json, status, coletado_em)
  VALUES (?, ?, 'g', 't', ?, 'a', 'pergunta', 'janela', 'provavel', ?, ?, '2026-10-10T11:00:00.000Z')`).run(id, cliente, recebido, JSON.stringify(temas), status)
const P = { servico: 'assessoria', temas: ['estoque_reposicao', 'vendas'], nivel: 'didatico', observacao: 'Quer aprender', por: 'giovanna torres' }

await ok('lista fechada: tema, serviço, nível e fonte fora da lista = 400 sem ecoar; sugestão não se grava; observação com telefone/> 500 = 400; prospect 400; quem não pode = 403', () => {
  const { p } = montar(banco())
  for (const [campos, rx] of [[{ temas: ['vendas', 'xyz_secreto'] }, /lista fechada/], [{ temas: ['vendas', 'vendas'] }, /repetido/], [{ temas: 'vendas' }, /lista fechada/],
    [{ servico: 'gestao' }, /serviço/], [{ nivel: 'basico' }, /nível/], [{ fonte: 'sugestao' }, /sugestão não se grava/], [{ fonte: 'notion' }, /fonte/],
    [{ observacao: 'ligar no (11) 98765-4321' }, /telefone/], [{ observacao: 'x'.repeat(501) }, /500/], [{ observacao: 42 }, /texto/]]) {
    const m = erroDe(() => p.salvar({ cliente: 'Acme', ...P, ...campos }), 400, rx)
    assert.doesNotMatch(m, /xyz_secreto|gestao|basico|98765/, 'mensagem não ecoa o valor')
  }
  erroDe(() => p.salvar({ cliente: '[Comercial] Empresa X', ...P }), 400)
  erroDe(() => p.salvar({ cliente: 'Acme', ...P, por: 'Fulano' }), 403)
  assert.equal(p.salvar({ cliente: 'Acme', ...P, temas: TEMAS }).mudou, true, 'todos os temas da lista valem')
})

await ok('salvar: prévia não grava; confirmar grava perfil + histórico + nota no livro (evento preferencia_cliente); igual = nada; mudança = 2ª linha com «antes»; histórico append-only; cadeia íntegra', () => {
  const h = banco(), { p, livro } = montar(h)
  const v = p.salvar({ cliente: 'Acme', ...P })
  assert.deepEqual([v.previa, v.mudou, v.antes, v.depois.por, v.depois.temas], [true, true, null, 'Giovanna Torres', ['estoque_reposicao', 'vendas']])
  assert.deepEqual([conta(h, 'perfil_informacao'), conta(h, 'perfil_informacao_hist'), conta(h, 'registro_cliente')], [0, 0, 0])
  const g = p.salvar({ cliente: 'Acme', ...P, confirmar: true })
  assert.deepEqual([g.previa, g.mudou, g.perfil.temas, g.perfil.fonte, g.perfil.por], [false, true, ['estoque_reposicao', 'vendas'], 'equipe', 'Giovanna Torres'])
  const nota = h.prepare("SELECT * FROM registro_cliente WHERE tipo = 'nota'").get(), d = JSON.parse(nota.dados_json)
  assert.equal(nota.ref, 'perfil-info:1'); assert.match(nota.resumo, /registrada: Assessoria; Estoque e reposição, Vendas; nível didático \(fonte equipe; por Giovanna Torres\)/)
  assert.deepEqual([d.evento, d.temas, d.antes], ['preferencia_cliente', ['estoque_reposicao', 'vendas'], null])
  assert.deepEqual(p.salvar({ cliente: 'Acme', ...P, confirmar: true }), { ok: true, previa: false, mudou: false, cliente: 'Acme', perfil: g.perfil }, 'igual = nada muda')
  assert.deepEqual([conta(h, 'perfil_informacao_hist'), conta(h, 'registro_cliente')], [1, 1])
  p.salvar({ cliente: 'Acme', ...P, temas: ['vendas', 'estoque_reposicao'], confirmar: true })            // só a ORDEM mudou: é mudança
  const ult = h.prepare("SELECT dados_json, resumo FROM registro_cliente WHERE ref = 'perfil-info:2'").get()
  assert.deepEqual(JSON.parse(ult.dados_json).antes.temas, ['estoque_reposicao', 'vendas']); assert.match(ult.resumo, /alterada/)
  const l = p.ler('Acme'); assert.deepEqual([l.historico.length, l.historico[0].antes.temas, l.perfil.temas], [2, ['estoque_reposicao', 'vendas'], ['vendas', 'estoque_reposicao']])
  assert.throws(() => h.prepare('UPDATE perfil_informacao_hist SET por = ?').run('x'), /alteracao proibida/)
  assert.throws(() => h.prepare('DELETE FROM perfil_informacao_hist').run(), /exclusao proibida/)
  assert.equal(livro.verificarCadeia('Acme').ok, true)
  assert.throws(() => h.prepare("INSERT INTO perfil_informacao (cliente, nivel, fonte, por, atualizado_em) VALUES ('Z', 'basico', 'equipe', 'x', 'y')").run(), /CHECK/)
})

await ok('sugestão: respostas não descartadas viram temas da lista (na ordem em que apareceram); nunca sobrescreve a equipe; não muda o relatório até alguém salvar', () => {
  const h = banco(), { p } = montar(h)
  fb(h, 'm1', 'Beta', ['compras', 'elogio', 'anuncios'], 'novo', '2026-10-09T10:00:00.000Z')
  fb(h, 'm2', 'Beta', ['previsao', 'preco_promocao', 'full', 'logistica'], 'revisado', '2026-10-10T10:00:00.000Z')
  fb(h, 'm3', 'Beta', ['concorrencia'], 'descartado')
  fb(h, 'm4', 'Acme', ['ads', 'margem_custos'])
  const s = p.ler('Beta')
  assert.equal(s.perfil, null); assert.deepEqual(s.sugestao.temas, ['compras_previsao', 'anuncios_performance', 'promocoes', 'logistica_full']); assert.equal(s.sugestao.fonte, 'sugestao')
  assert.deepEqual([s.efetivo.fonte, s.efetivo.temas], ['padrao', []], 'sugestão não vira relatório sozinha')
  p.salvar({ cliente: 'Acme', ...P, confirmar: true })
  const a = p.ler('Acme'); assert.equal(a.sugestao, null); assert.deepEqual(a.perfil.temas, P.temas, 'perfil da equipe intacto apesar das respostas'); assert.equal(a.efetivo.fonte, 'equipe')
  assert.equal(conta(h, 'perfil_informacao', "fonte = 'sugestao'"), 0, 'sugestão nunca é gravada')
  const m = p.matriz(); assert.deepEqual(m.sugestoes.map(x => x.cliente), ['Beta'])
  const t = m.por_tema.find(x => x.tema === 'ads'); assert.deepEqual([t.n, t.n_sugestao], [0, 0], 'resposta de quem tem perfil não vira sugestão')
  assert.deepEqual(m.por_tema.find(x => x.tema === 'promocoes').sugestoes, ['Beta'])
})

await ok('matriz: conta por tema (quais, posição, serviço), % da carteira e dos perfis, por nível; inativo e prospect fora; temas padrão = mais pedidos (empate = config); ordem do relatório', () => {
  const h = banco(), { p } = montar(h, { clientes: ['Acme', 'Beta', 'Gama', 'Delta', '[Comercial] X'] })
  p.salvar({ cliente: 'Acme', servico: 'assessoria', temas: ['ads', 'vendas'], por: POR, confirmar: true })
  p.salvar({ cliente: 'Beta', servico: 'consultoria', temas: ['vendas', 'concorrencia', 'ads'], nivel: 'completo', por: POR, confirmar: true })
  p.salvar({ cliente: 'Gama', temas: [], por: POR, confirmar: true })
  p.salvar({ cliente: 'Inativo', servico: 'assessoria', temas: ['margem_custos'], por: POR, confirmar: true })     // fora da carteira ativa
  const m = p.matriz()
  assert.deepEqual([m.carteira, m.com_perfil, m.pct_com_perfil], [4, 3, 75])
  assert.deepEqual(m.por_servico, { assessoria: 1, consultoria: 1, sem_servico: 1 }); assert.deepEqual(m.por_nivel, { padrao: 2, didatico: 0, completo: 1 })
  const T = Object.fromEntries(m.por_tema.map(t => [t.tema, t]))
  assert.deepEqual([T.vendas.n, T.ads.n, T.concorrencia.n, T.margem_custos.n, T.vendas.pct_com_perfil], [2, 2, 1, 0, 66.7])
  assert.deepEqual(T.ads.clientes.map(c => [c.cliente, c.posicao, c.servico]), [['Acme', 1, 'assessoria'], ['Beta', 3, 'consultoria']])
  assert.deepEqual(T.vendas.por_servico, { assessoria: 1, consultoria: 1, sem_servico: 0 })
  assert.deepEqual(m.temas_padrao, ['vendas', 'ads', 'concorrencia'], 'empate vendas × ads: vale a ordem do config')
  assert.deepEqual(m.por_tema.slice(0, 3).map(t => t.tema), ['vendas', 'ads', 'concorrencia'])
  assert.deepEqual(m.ordem_sem_perfil, ['vendas', 'estoque_reposicao', 'compras_previsao', 'acoes_realizadas'], 'sem perfil: só a base fixa')
  assert.deepEqual(p.ler('Beta').efetivo.ordem, ['vendas', 'concorrencia', 'ads', 'estoque_reposicao', 'compras_previsao', 'acoes_realizadas'], 'pedidos no topo + resto da base')
  assert.deepEqual(p.ler('Gama').efetivo.ordem, cfg.base_fixa)
  assert.ok(!JSON.stringify(m).includes('Comercial') && !JSON.stringify(m).includes('Inativo'))
})

await ok('seed: prévia não grava; confirmar grava 9 perfis + 8 feedbacks curados (origem equipe, revisado, sem grupo/autor/telefone) + livro; 2ª rodada não muda nada; ingestão do livro não duplica; cliente fora da central', async () => {
  const h = banco(), nomes = SEED.map(s => s.cliente), { p, livro } = montar(h, { quem: [POR], clientes: nomes })
  assert.equal(SEED.length, 9); assert.ok(SEED.every(s => s.temas.every(t => TEMAS.includes(t))), 'seed na lista fechada')
  const v = aplicarSeed(p)
  assert.deepEqual([v.filter(r => r.perfil === 'novo').length, v.filter(r => r.feedback === 'novo').length, v.filter(r => r.erro).length], [9, 8, 0])
  assert.deepEqual([conta(h, 'perfil_informacao'), conta(h, 'feedback_relatorio'), conta(h, 'registro_cliente')], [0, 0, 0], 'prévia não grava')
  const g = h.transaction(() => aplicarSeed(p, { confirmar: true }))()
  assert.equal(g.filter(r => r.perfil === 'gravado').length, 9)
  assert.deepEqual([conta(h, 'perfil_informacao'), conta(h, 'perfil_informacao_hist'), conta(h, 'feedback_relatorio', "origem = 'equipe' AND status = 'revisado' AND grupo_hash = '' AND autor_nome = ''")], [9, 9, 8])
  assert.deepEqual([conta(h, 'registro_cliente', "tipo = 'nota'"), conta(h, 'registro_cliente', "tipo = 'resposta_cliente'")], [9, 8])
  const mc = p.ler('Master Cogumelos'); assert.deepEqual([mc.perfil.nivel, mc.perfil.temas], ['didatico', TEMAS])
  assert.deepEqual([p.ler('Uniaodog Artigos Pet').perfil.fonte, p.ler('Photo K').perfil.temas], ['whatsapp', []])
  const ag = h.prepare("SELECT texto, temas_json, nota_interna, recebido_em FROM feedback_relatorio WHERE cliente = 'Agrinorte'").get()
  assert.match(ag.texto, /Pistão 170/); assert.match(ag.nota_interna, /margem de segurança/); assert.equal(ag.recebido_em, '2026-10-13')
  assert.deepEqual(JSON.parse(ag.temas_json), [...paraFeedback(['vendas', 'estoque_reposicao', 'anuncios_performance']), 'critica'])
  assert.deepEqual(JSON.parse(h.prepare("SELECT temas_json FROM feedback_relatorio WHERE cliente = 'Photo K'").get().temas_json), ['elogio'])
  const ref = h.prepare("SELECT resumo, fato_em FROM registro_cliente WHERE tipo = 'resposta_cliente' AND cliente = 'LS Importados'").get()
  assert.match(ref.resumo, /colhido pela equipe/); assert.doesNotMatch(ref.resumo, /citou/); assert.equal(ref.fato_em, '2026-10-13')
  // dia que não existe (o V8 aceita 31/02 e rola para março) nunca vira feedback
  for (const dia of ['2026-02-31', '2026-13-01', '2026-10-1']) assert.throws(() => p.registrarFeedbackEquipe({ cliente: 'Agrinorte', texto: 'x', temas: [], dia, por: POR }), /"dia" precisa ser AAAA-MM-DD/)
  // idempotente
  const de_novo = aplicarSeed(p), antes = conta(h, 'registro_cliente')
  assert.ok(de_novo.every(r => r.perfil === 'igual ao salvo' && (r.feedback ?? 'já registrado') === 'já registrado'), 'nada muda na prévia')
  h.transaction(() => aplicarSeed(p, { confirmar: true }))()
  assert.deepEqual([conta(h, 'perfil_informacao_hist'), conta(h, 'feedback_relatorio'), conta(h, 'registro_cliente')], [9, 8, antes])
  h.exec(`CREATE TABLE tarefas (id TEXT, cliente TEXT, titulo TEXT, processo TEXT, responsavel TEXT, data_inicio TEXT, prazo TEXT, tipo_demanda TEXT, prioridade TEXT, etiquetas TEXT, url TEXT,
    arquivada INTEGER, status TEXT, data_conclusao TEXT); CREATE TABLE evidencias (id TEXT, tarefa_id TEXT, tipo TEXT, url_origem TEXT, arquivo_local TEXT, legenda TEXT, criada_em TEXT)`)   // o mínimo que a varredura do livro lê
  const ing = await livro.ingerir(); assert.equal(ing.por_tipo.resposta_cliente || 0, 0, 'a ingestão pula o que o seed já registrou'); assert.equal(livro.verificarCadeia().ok, true)
  // sem telefone em lugar nenhum
  for (const t of ['perfil_informacao', 'perfil_informacao_hist', 'feedback_relatorio', 'registro_cliente'])
    for (const linha of h.prepare(`SELECT * FROM ${t}`).all()) for (const v of Object.values(linha)) assert.ok(!temContato(String(v)), `${t} com contato`)
  // matriz pós-seed
  const m = p.matriz(), T = Object.fromEntries(m.por_tema.map(t => [t.tema, t.n]))
  assert.deepEqual([m.carteira, m.com_perfil, m.pct_com_perfil, T.vendas, T.estoque_reposicao, T.anuncios_performance, T.ads, T.concorrencia], [9, 9, 100, 5, 5, 5, 3, 2])
  assert.deepEqual(m.por_servico, { assessoria: 5, consultoria: 3, sem_servico: 1 })
  // a tela de respostas enxerga a origem
  const lst = criarRespostas(h, { agora }).listar({ cliente: 'Agrinorte' }); assert.equal(lst.itens[0].origem, 'equipe')
  // cliente fora da central: prévia pula; confirmar aborta tudo
  const h2 = banco(), { p: p2 } = montar(h2, { quem: [POR] }), existe = c => c !== 'Photo K'
  assert.match(aplicarSeed(p2, { existe }).find(r => r.cliente === 'Photo K').erro, /fora|não está/)
  assert.throws(() => h2.transaction(() => aplicarSeed(p2, { confirmar: true, existe }))(), /fora da central/)
  assert.deepEqual([conta(h2, 'perfil_informacao'), conta(h2, 'registro_cliente')], [0, 0], 'erro no meio desfaz tudo')
})

await ok('HTTP: matriz e leitura; POST prévia → confirmar; 415 sem JSON; 404 cliente fora da central/prospect sem eco; 403 quem não pode; 400 tema fora da lista', async () => {
  const h = banco(), { p } = montar(h)
  const app = express(); app.use(express.json())
  app.use(criarRotasPerfilInformacao({ perfis: p, quem: () => ['Giovanna Torres'], clienteCanonico: c => ['Acme', 'Beta'].find(x => norm(x) === norm(c)) || '' }))
  app.use((e, req, res, next) => res.status(500).json({ erro: 'interno' }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, tipo = 'application/json') => { const r = await fetch(base + rota, corpo === undefined ? {} : { method: 'POST', headers: { 'content-type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); const t = await r.text(); return { status: r.status, j: JSON.parse(t), t } }
  try {
    const pv = await chama('/api/cliente/perfil-informacao', { cliente: 'acme', ...P })
    assert.deepEqual([pv.status, pv.j.previa, pv.j.cliente], [200, true, 'Acme']); assert.equal(conta(h, 'perfil_informacao'), 0)
    const cf = await chama('/api/cliente/perfil-informacao', { cliente: 'Acme', ...P, confirmar: true }); assert.deepEqual([cf.j.previa, cf.j.perfil.nivel], [false, 'didatico'])
    assert.equal((await chama('/api/cliente/perfil-informacao', { cliente: 'Acme', ...P, temas: ['vendas'], confirmar: 'true' })).j.previa, true, 'confirmar só com true literal')
    const g = await chama('/api/cliente/perfil-informacao?cliente=Acme'); assert.deepEqual([g.status, g.j.perfil.temas, g.j.quem, g.j.catalogo.temas.length], [200, P.temas, ['Giovanna Torres'], TEMAS.length])
    const m = await chama('/api/perfil-informacao/matriz'); assert.deepEqual([m.status, m.j.com_perfil, m.j.temas_padrao], [200, 1, ['vendas', 'estoque_reposicao']])
    assert.equal((await chama('/api/cliente/perfil-informacao', 'cliente=Acme', 'text/plain')).status, 415)
    for (const c of ['Fantasma Ltda', '[Comercial] Acme']) { const r = await chama('/api/cliente/perfil-informacao?cliente=' + encodeURIComponent(c)); assert.equal(r.status, 404); assert.doesNotMatch(r.t, /Fantasma|Comercial/) }
    assert.equal((await chama('/api/cliente/perfil-informacao', { cliente: 'Beta', ...P, por: 'Hacker' })).status, 403)
    const t = await chama('/api/cliente/perfil-informacao', { cliente: 'Beta', ...P, temas: ['<script>'] }); assert.equal(t.status, 400); assert.doesNotMatch(t.t, /script/)
  } finally { srv.close() }
})

console.log(`\n✔ teste-perfil-informacao: ${n} casos passaram`)
