// Autoteste do encerramento por dependência do cliente: prévia sem escrita, PATCH idempotente com o corpo exato, registro que sobrevive ao sync,
// reabertura pelo sync, listagem com "desde"/faixa (hoje injetado) e rotas HTTP. Banco em memória + STUB do Notion que grava as chamadas —
// nunca toca o Notion real nem data/db.sqlite.
// Casos 10 (semântica nos consumidores) e 11 (fiação por grep) no fim: o banco em memória do db.js (PS_DB_MEMORIA=1) só entra por import() dinâmico.
// Rodar: node scripts/teste-dependencia-cliente.mjs
process.env.PS_DB_MEMORIA = '1'   // os imports estáticos não tocam db.js; equipe/consumidores entram por import() dinâmico (banco em memória com o schema inteiro)
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import express from 'express'
import { SCHEMA_DEPENDENCIA, SQL_REABERTURA, TIPOS, textoDe, faixaDe, FAIXAS, SEM_MOTIVO, COMENTARIO_PENDENTE, FALHA_LOCAL, desdeDe, criarDependencias } from '../src/lib/dependencia-cliente.js'
import { criarRotasDependencia } from '../src/rotas-dependencia.js'
import { OPCAO_NOTION_DEPENDENCIA } from '../src/lib/status-tarefa.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const fonte = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')
const falha = async (fn, rx, status = 400) => { let e; try { await fn() } catch (x) { e = x } assert.ok(e, 'devia ter falhado'); assert.match(e.message, rx); assert.equal(e.status, status); return e.message }
const ID = s => String(s).padEnd(32, '0')                        // ids no formato do Notion (32 hex) — distintos pelo prefixo
const IDS = n => Array.from({ length: n }, (_, i) => ID(String(i).padStart(3, '0')))   // n ids distintos (prefixo de 3 dígitos)
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const QUEM = ['Giovanna Torres', 'Carla Souza']
const OPCAO_NA_BASE = 'Aguardando devolutiva do cliente'          // grafia diferente da nossa: a comparação é sem caixa e o PATCH usa a da base
const MSG_SEM_OPCAO = `a base deste cliente não tem a opção '${OPCAO_NOTION_DEPENDENCIA}' — crie no Notion e tente de novo`

// ── stub do Notion: grava as chamadas e responde por roteiro ─────────────────────────────────────────────
const erroNotion = status => Object.assign(new Error(`Notion ${status}`), { status })
function stubNotion({ comentarios = 'ok' } = {}) {
  const chamadas = []
  const req = async (caminho, { method = 'GET', body, retry5xx } = {}) => {
    chamadas.push({ caminho, method, body, retry5xx })
    if (method === 'GET' && caminho === 'data_sources/ds-A') return { properties: { Nome: { type: 'title' }, Status: { type: 'status', status: { options: [{ name: 'Não iniciada' }, { name: OPCAO_NA_BASE }] } } } }
    if (method === 'GET' && caminho === 'data_sources/ds-B') return { properties: { Status: { type: 'status', status: { options: [{ name: 'Não iniciada' }, { name: 'Problemas na tarefa' }] } } } }
    if (method === 'GET' && caminho === 'data_sources/db-C') throw erroNotion(404)          // fonte antiga: id de database
    if (method === 'GET' && caminho === 'databases/db-C') return { data_sources: [{ id: 'ds-A' }] }
    if (method === 'PATCH' && caminho.startsWith('pages/')) {
      const id = caminho.slice(6)
      if (id.startsWith('403')) throw erroNotion(403)
      if (id.startsWith('404')) throw erroNotion(404)
      return { id, last_edited_time: '2026-10-07T12:00:00.000Z' }
    }
    if (method === 'POST' && caminho === 'comments') { if (comentarios === '403') throw erroNotion(403); return { id: 'c' + chamadas.length } }
    throw erroNotion(500)
  }
  return { req, chamadas, de: (m, c = '') => chamadas.filter(x => x.method === m && x.caminho.startsWith(c)) }
}

function montar({ comentarios, hoje = '2026-10-07' } = {}) {
  const h = new Database(':memory:')
  h.exec(`CREATE TABLE tarefas (id TEXT PRIMARY KEY, fonte TEXT NOT NULL, cliente TEXT NOT NULL DEFAULT '', titulo TEXT NOT NULL DEFAULT '', responsavel TEXT NOT NULL DEFAULT '',
      prazo TEXT, url TEXT NOT NULL DEFAULT '', sprint TEXT NOT NULL DEFAULT '', processo TEXT NOT NULL DEFAULT '', status_raw TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'nao_iniciada', last_edited TEXT NOT NULL DEFAULT '', arquivada INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE historico (tarefa_id TEXT NOT NULL, campo TEXT NOT NULL, de TEXT, para TEXT, em TEXT NOT NULL);`)
  h.exec(SCHEMA_DEPENDENCIA)
  const notion = stubNotion({ comentarios })
  let relogio = '2026-10-07T13:00:00.000Z'
  const dep = criarDependencias({ handle: h, notion, agora: () => relogio, hoje: () => hoje, validarPor: v => QUEM.find(q => norm(q) === norm(v)) || '', mapeamento: { propriedades: { status: ['Status'] } } })
  const tarefa = (id, { cliente = 'Damar', fonte = 'ds-A', status = 'andamento', status_raw = 'Em andamento', titulo = 'Tarefa ' + id.slice(0, 3), last_edited = '2026-10-01T10:00:00.000Z', arquivada = 0 } = {}) =>
    h.prepare('INSERT INTO tarefas (id, fonte, cliente, titulo, status_raw, status, last_edited, arquivada) VALUES (?,?,?,?,?,?,?,?)').run(id, fonte, cliente, titulo, status_raw, status, last_edited, arquivada)
  const t = id => h.prepare('SELECT * FROM tarefas WHERE id = ?').get(id)
  const reg = id => h.prepare('SELECT * FROM tarefa_dependencia WHERE tarefa_id = ?').get(id)
  const hist = id => h.prepare("SELECT * FROM historico WHERE tarefa_id = ? AND campo = 'status'").all(id)
  return { h, notion, dep, tarefa, t, reg, hist, relogio: v => { relogio = v } }
}
const CORPO = { tipo: 'fotos', detalhe: 'fotos dos 12 SKUs da linha Pet, pedidas em 25/09', evidencia: 'https://drive.google.com/x', por: 'giovanna torres' }

await ok('constantes: 11 tipos com rótulo, textoDe, régua 13/14/30 e rótulos das faixas', () => {
  assert.deepEqual(Object.keys(TIPOS), ['fotos', 'custos', 'acesso', 'aprovacao', 'produto', 'informacao', 'outro', 'documentos', 'regulatorio', 'logistica', 'atendimento'])   // 08/10: +4 tipos do catálogo de pendências do cliente
  assert.equal(textoDe({ tipo: 'fotos', detalhe: 'faltam 3' }), 'Fotos do produto: faltam 3')
  assert.equal(textoDe({ tipo: 'zzz', detalhe: 'x' }), 'Outro: x')
  assert.deepEqual([0, 13, 14, 29, 30, 90].map(d => faixaDe(d)), ['aguardando', 'aguardando', 'cobrar', 'cobrar', 'revisar', 'revisar'])
  assert.equal(faixaDe(7, { atencao: 5, revisar: 10 }), 'cobrar')
  assert.ok(FAIXAS.revisar.includes('replanejar'))
  assert.match(SCHEMA_DEPENDENCIA, /CREATE TABLE IF NOT EXISTS tarefa_dependencia/); assert.match(SCHEMA_DEPENDENCIA, /ix_tdep_cliente/)
  // desdeDe: o mais antigo vence (por dia); empate = registro > historico > ultima_edicao; sem nada = null
  assert.deepEqual(desdeDe({ registro_em: '2026-10-07T13:00:00.000Z', historico_em: '2026-09-23T08:00:00.000Z', last_edited: '2026-10-05T00:00:00.000Z' }), { desde: '2026-09-23', desde_origem: 'historico' })
  assert.deepEqual(desdeDe({ registro_em: '2026-10-07T13:00:00.000Z', last_edited: '2026-09-15T00:00:00.000Z' }), { desde: '2026-09-15', desde_origem: 'ultima_edicao' })
  assert.deepEqual(desdeDe({ registro_em: '2026-10-07T13:00:00.000Z', historico_em: '2026-10-07T13:00:00.000Z', last_edited: '2026-10-07T12:00:00.000Z' }), { desde: '2026-10-07', desde_origem: 'registro' })
  assert.deepEqual(desdeDe({ last_edited: '' }), { desde: null, desde_origem: 'ultima_edicao' })
})

await ok('1. prévia (sem confirmar): nenhuma escrita; mudam / já estavam / inválidas / bases sem a opção; fallback databases/{fonte}', async () => {
  const { h, notion, dep, tarefa } = montar()
  tarefa(ID('1')); tarefa(ID('2'), { status: 'dependencia_cliente', status_raw: 'Aguardando Devolutiva do Cliente' })
  tarefa(ID('3'), { cliente: 'Cliente B', fonte: 'ds-B' }); tarefa(ID('5'), { status: 'concluida', status_raw: 'Concluída' })
  tarefa(ID('6'), { fonte: 'db-C', status: 'bloqueada', status_raw: 'Problemas na tarefa' }); tarefa(ID('7'), { arquivada: 1 })
  const p = await dep.encerrar({ ...CORPO, ids: [ID('1'), ID('2'), ID('3'), ID('4'), ID('5'), ID('6'), ID('7')] })
  assert.deepEqual(p.mudam.map(x => x.id), [ID('1'), ID('6')]); assert.deepEqual(p.mudam[0], { id: ID('1'), titulo: 'Tarefa 100', cliente: 'Damar' })
  assert.deepEqual(p.ja_estavam.map(x => x.id), [ID('2')])
  assert.deepEqual(p.invalidas.map(x => [x.id, x.motivo]), [
    [ID('3'), MSG_SEM_OPCAO], [ID('4'), 'tarefa não encontrada ou arquivada'], [ID('5'), 'tarefa já encerrada — não cabe dependência'], [ID('7'), 'tarefa não encontrada ou arquivada']])
  assert.deepEqual(p.bases_sem_opcao, ['Cliente B'])
  assert.equal(notion.de('PATCH').length + notion.de('POST').length, 0, 'prévia não escreve no Notion')
  assert.deepEqual(notion.de('GET').map(c => c.caminho), ['data_sources/ds-A', 'data_sources/ds-B', 'data_sources/db-C', 'databases/db-C', 'data_sources/ds-A'])
  assert.equal(h.prepare('SELECT COUNT(*) n FROM tarefa_dependencia').get().n, 0); assert.equal(h.prepare('SELECT COUNT(*) n FROM historico').get().n, 0)
  assert.equal(h.prepare("SELECT status FROM tarefas WHERE id = ?").get(ID('1')).status, 'andamento')
  assert.equal(p.ok, undefined, 'prévia não é resultado')
})

const C2 = montar()
await ok('2. encerrar 2 ids: 1 GET da base (cache), PATCH com o corpo exato (grafia da base), tarefas + 1 historico + registro notion_ok=1, comentário ok', async () => {
  const { notion, dep, tarefa, t, reg, hist } = C2
  tarefa(ID('1')); tarefa(ID('2'), { status: 'bloqueada', status_raw: 'Problemas na tarefa' })
  const r = await dep.encerrar({ ...CORPO, ids: [ID('1'), ID('2')], confirmar: true })
  assert.deepEqual([r.ok, r.encerradas.length, r.ja_estavam.length, r.falhas.length, r.comentarios_pendentes], [true, 2, 0, 0, 0])
  assert.equal(notion.de('GET').length, 1, 'uma base no lote = um GET')
  const patches = notion.de('PATCH')
  assert.deepEqual(patches.map(p => p.caminho), [`pages/${ID('1')}`, `pages/${ID('2')}`])
  assert.deepEqual(patches[0].body, { properties: { Status: { status: { name: OPCAO_NA_BASE } } } })
  for (const id of [ID('1'), ID('2')]) {
    assert.deepEqual([t(id).status, t(id).status_raw, t(id).last_edited], ['dependencia_cliente', OPCAO_NA_BASE, '2026-10-07T12:00:00.000Z'], 'status muda; last_edited = o do PATCH (leitura velha do sync não rebaixa)')
    assert.equal(hist(id).length, 1); assert.equal(hist(id)[0].para, 'dependencia_cliente'); assert.equal(hist(id)[0].em, '2026-10-07T13:00:00.000Z')
    const d = reg(id)
    assert.deepEqual([d.cliente, d.tipo, d.detalhe, d.evidencia, d.por, d.em, d.notion_ok, d.notion_erro, d.notion_last_edited, d.comentario, d.reaberta_em],
      ['Damar', 'fotos', CORPO.detalhe, CORPO.evidencia, 'Giovanna Torres', '2026-10-07T13:00:00.000Z', 1, '', '2026-10-07T12:00:00.000Z', 'ok', ''])
  }
  assert.deepEqual([hist(ID('1'))[0].de, hist(ID('2'))[0].de, reg(ID('1')).status_antes, reg(ID('2')).status_antes], ['andamento', 'bloqueada', 'Em andamento', 'Problemas na tarefa'])
  const posts = notion.de('POST', 'comments')
  assert.equal(posts.length, 2); assert.equal(posts[0].retry5xx, false)
  assert.deepEqual(posts[0].body.parent, { page_id: ID('1') })
  assert.equal(posts[0].body.rich_text[0].text.content, `Encerrada por dependência do cliente — Fotos do produto: ${CORPO.detalhe} · evidência: ${CORPO.evidencia} · por Giovanna Torres (Place Sprints)`)
  assert.deepEqual(r.encerradas[0], { id: ID('1'), titulo: 'Tarefa 100', cliente: 'Damar', comentario: 'ok' })
})

await ok('3. repetir o lote: 0 PATCH, 0 historico novo, 0 comentário, ja_estavam; registro atualizado sem perder status_antes/notion_last_edited', async () => {
  const { notion, dep, reg, hist, relogio } = C2
  relogio('2026-10-08T09:00:00.000Z')
  const antes = notion.chamadas.length
  const r = await dep.encerrar({ ...CORPO, ids: [ID('1'), ID('2')], tipo: 'custos', detalhe: 'planilha de custos', evidencia: '', por: 'Carla Souza', confirmar: true })
  assert.deepEqual([r.encerradas.length, r.ja_estavam.length, r.falhas.length], [0, 2, 0])
  assert.equal(notion.chamadas.length, antes, 'nenhuma chamada ao Notion')
  assert.equal(hist(ID('1')).length, 1)
  const d = reg(ID('1'))
  assert.deepEqual([d.tipo, d.detalhe, d.evidencia, d.por, d.em, d.status_antes, d.notion_last_edited, d.comentario, d.notion_ok], ['custos', 'planilha de custos', '', 'Carla Souza', '2026-10-08T09:00:00.000Z', 'Em andamento', '2026-10-07T12:00:00.000Z', 'ok', 1])
})

await ok('4. base sem a opção: falha por item com a mensagem fixa, nenhum PATCH, tarefas/historico intocados, registro documenta a tentativa (notion_ok=0)', async () => {
  const { notion, dep, tarefa, t, reg, hist } = montar()
  tarefa(ID('3'), { cliente: 'Cliente B', fonte: 'ds-B' })
  const r = await dep.encerrar({ ...CORPO, ids: [ID('3')], confirmar: true })
  assert.deepEqual(r.falhas, [{ id: ID('3'), titulo: 'Tarefa 300', motivo: MSG_SEM_OPCAO }]); assert.equal(r.encerradas.length, 0)
  assert.equal(notion.de('PATCH').length + notion.de('POST').length, 0)
  assert.deepEqual([t(ID('3')).status, t(ID('3')).status_raw, hist(ID('3')).length], ['andamento', 'Em andamento', 0])
  assert.deepEqual([reg(ID('3')).notion_ok, reg(ID('3')).notion_erro, reg(ID('3')).cliente], [0, MSG_SEM_OPCAO, 'Cliente B'])
})

await ok('5. PATCH 403/404: falha com mensagem fixa (sem id, sem corpo do Notion), tarefas intacta, registro notion_ok=0, sem comentário', async () => {
  const { notion, dep, tarefa, t, reg, hist } = montar()
  tarefa(ID('403')); tarefa(ID('404'))
  const r = await dep.encerrar({ ...CORPO, ids: [ID('403'), ID('404')], confirmar: true })
  assert.deepEqual(r.falhas.map(f => f.motivo), ['a integração não tem permissão para editar esta base', 'card arquivado ou fora do acesso da integração'])
  assert.ok(!JSON.stringify(r.falhas.map(f => f.motivo)).includes('Notion 403'))
  assert.equal(notion.de('PATCH').length, 2); assert.equal(notion.de('POST').length, 0)
  assert.deepEqual([t(ID('403')).status, hist(ID('403')).length, reg(ID('403')).notion_ok, reg(ID('403')).notion_erro], ['andamento', 0, 0, 'a integração não tem permissão para editar esta base'])
  assert.equal(JSON.stringify(await dep.previa([ID('403')])).includes('"motivo"'), false, 'prévia não antecipa falha de PATCH (só a opção da base)')
})

await ok('6. comentário 403: item encerrado mesmo assim, comentário "pendente", 1 só POST no lote, comentarios_pendentes conta todos', async () => {
  const { notion, dep, tarefa, reg } = montar({ comentarios: '403' })
  tarefa(ID('1')); tarefa(ID('2')); tarefa(ID('3'))
  const r = await dep.encerrar({ ...CORPO, ids: [ID('1'), ID('2'), ID('3')], confirmar: true })
  assert.deepEqual([r.encerradas.length, r.falhas.length, r.comentarios_pendentes], [3, 0, 3])
  assert.equal(notion.de('POST', 'comments').length, 1, 'depois do 403 não insiste')
  assert.equal(notion.de('PATCH').length, 3)
  for (const id of [ID('1'), ID('2'), ID('3')]) { assert.equal(reg(id).comentario, COMENTARIO_PENDENTE); assert.equal(reg(id).notion_ok, 1) }
  assert.equal(r.encerradas[2].comentario, COMENTARIO_PENDENTE)
})

await ok('7. reabertura (SQL do sync): last_edited posterior ao PATCH preenche reaberta_em/para; anterior (leitura velha) não; só uma vez; sync.js usa a linha', () => {
  const { h, reg } = C2
  const marcar = h.prepare(SQL_REABERTURA)
  assert.equal(marcar.run('2026-10-08T10:00:00.000Z', 'Em andamento', ID('1'), '2026-10-07T11:59:59.000Z').changes, 0, 'leitura anterior ao PATCH não reabre')
  assert.equal(marcar.run('2026-10-08T10:00:00.000Z', 'Em andamento', ID('1'), '2026-10-07T12:00:00.000Z').changes, 0, 'igual também não')
  assert.equal(marcar.run('2026-10-08T10:00:00.000Z', 'Em andamento', ID('1'), '2026-10-07T12:00:01.000Z').changes, 1)
  assert.deepEqual([reg(ID('1')).reaberta_em, reg(ID('1')).reaberta_para, reg(ID('1')).notion_ok], ['2026-10-08T10:00:00.000Z', 'Em andamento', 1], 'o registro fica — se passou, passou')
  assert.equal(marcar.run('2026-10-09T10:00:00.000Z', 'Concluída', ID('1'), '2026-10-09T00:00:00.000Z').changes, 0, 'já reaberta: não regrava')
  assert.equal(marcar.run('2026-10-09T10:00:00.000Z', 'x', ID('2'), '2026-10-09T00:00:00.000Z').changes, 1)
  const s = fonte('src/lib/sync.js')
  assert.match(s, /import \{ SQL_REABERTURA \} from '\.\/dependencia-cliente\.js'/)
  assert.match(s, /if \(tarefa\.status !== 'dependencia_cliente'\) \(marcarReaberta \?\?= db\.prepare\(SQL_REABERTURA\)\)\.run\(agora\(\), tarefa\.status_raw, tarefa\.id, tarefa\.last_edited\)/)
  assert.ok(s.indexOf('upsertTarefa.run(tarefa)') < s.indexOf('marcarReaberta ??='), 'logo após o upsert')
  assert.match(fonte('src/lib/db.js'), /db\.exec\(SCHEMA_DEPENDENCIA\)/)
  // corrida sync × encerrar: página consultada ANTES do PATCH e gravada DEPOIS tem last_edited menor que o local → o sync pula (nunca rebaixa)
  const guarda = s.indexOf('if (anterior && anterior.last_edited > tarefa.last_edited) continue')
  assert.ok(guarda > -1 && guarda < s.indexOf('registrarMudancas(anterior, tarefa)'), 'guarda da leitura velha antes de registrarMudancas/upsert')
})

await ok('falha ao gravar localmente depois do PATCH aceito (banco ocupado): item em falhas com motivo fixo, tarefas/historico/registro intocados, sem comentário, lote segue', async () => {
  const { h, notion, dep, tarefa, t, reg, hist } = montar()
  tarefa(ID('1')); tarefa(ID('2'))
  h.exec(`CREATE TRIGGER trava BEFORE UPDATE ON tarefas WHEN NEW.id = '${ID('1')}' BEGIN SELECT RAISE(ABORT, 'database is locked'); END`)
  const r = await dep.encerrar({ ...CORPO, ids: [ID('1'), ID('2')], confirmar: true })
  assert.deepEqual(r.falhas, [{ id: ID('1'), titulo: 'Tarefa 100', motivo: FALHA_LOCAL }]); assert.deepEqual(r.encerradas.map(x => x.id), [ID('2')])
  assert.deepEqual([t(ID('1')).status, hist(ID('1')).length, reg(ID('1'))], ['andamento', 0, undefined], 'transação desfeita inteira')
  assert.equal(notion.de('PATCH').length, 2); assert.equal(notion.de('POST', 'comments').length, 1, 'sem gravação local não comenta')
  h.exec('DROP TRIGGER trava')
})

await ok('8. listar: desde/desde_origem (o mais antigo entre registro, historico e última edição), dias com hoje injetado, faixa 13/14/30, sem motivo, filtros por cliente e ids, reaberta some; registrar o motivo depois não zera o relógio', async () => {
  const { h, dep, tarefa, relogio } = montar({ hoje: '2026-10-07' })
  tarefa(ID('a')); relogio('2026-09-24T10:00:00.000Z')
  await dep.encerrar({ ...CORPO, ids: [ID('a')], confirmar: true })                                   // registro em 24/09 → 13 dias
  tarefa(ID('b'), { status: 'dependencia_cliente', status_raw: 'Aguardando Devolutiva do Cliente', last_edited: '2026-10-05T00:00:00.000Z' })
  h.prepare("INSERT INTO historico VALUES (?, 'status', 'andamento', 'bloqueada', '2026-09-01T08:00:00.000Z')").run(ID('b'))
  h.prepare("INSERT INTO historico VALUES (?, 'status', 'bloqueada', 'dependencia_cliente', '2026-09-23T08:00:00.000Z')").run(ID('b'))   // 14 dias
  h.prepare("INSERT INTO historico VALUES (?, 'sprint', 'S1', 'S2', '2026-10-06T08:00:00.000Z')").run(ID('b'))                            // outro campo não conta
  tarefa(ID('c'), { status: 'dependencia_cliente', status_raw: 'Aguardando Devolutiva do Cliente', last_edited: '2026-09-07T23:30:00.000Z' })   // 30 dias
  tarefa(ID('d'), { cliente: 'Outro', status: 'dependencia_cliente', status_raw: 'Aguardando Devolutiva do Cliente', last_edited: '2026-10-06T00:00:00.000Z' })
  tarefa(ID('e'))                                                                                         // andamento: não entra
  const todas = dep.listar()
  assert.deepEqual(todas.map(x => x.id), [ID('c'), ID('b'), ID('a'), ID('d')], 'mais antiga primeiro')
  const por = Object.fromEntries(todas.map(x => [x.id, x]))
  assert.deepEqual([por[ID('a')].desde, por[ID('a')].desde_origem, por[ID('a')].dias, por[ID('a')].faixa, por[ID('a')].tipo_rotulo, por[ID('a')].texto, por[ID('a')].por],
    ['2026-09-24', 'registro', 13, 'aguardando', 'Fotos do produto', `Fotos do produto: ${CORPO.detalhe}`, 'Giovanna Torres'])
  assert.deepEqual([por[ID('b')].desde, por[ID('b')].desde_origem, por[ID('b')].dias, por[ID('b')].faixa, por[ID('b')].tipo, por[ID('b')].detalhe, por[ID('b')].texto],
    ['2026-09-23', 'historico', 14, 'cobrar', '', SEM_MOTIVO, SEM_MOTIVO])
  assert.deepEqual([por[ID('c')].desde, por[ID('c')].desde_origem, por[ID('c')].dias, por[ID('c')].faixa, por[ID('c')].faixa_rotulo], ['2026-09-07', 'ultima_edicao', 30, 'revisar', FAIXAS.revisar])
  assert.equal(dep.listar({ cliente: 'Damar' }).length, 3); assert.equal(dep.listar({ cliente: 'Outro' })[0].id, ID('d'))
  assert.deepEqual(dep.listar({ ids: [ID('c'), ID('e')] }).map(x => x.id), [ID('c')])
  assert.equal(dep.listar({ hoje: '2026-10-21' }).find(x => x.id === ID('a')).faixa, 'cobrar', 'hoje injetado move a faixa')
  // "já estava" semanas depois: o registro (07/10) só acrescenta o motivo — desde continua o do historico (b) ou da última edição (c), e a faixa não volta a "aguardando"
  relogio('2026-10-07T13:00:00.000Z')
  const ja = await dep.encerrar({ ...CORPO, ids: [ID('b'), ID('c')], confirmar: true })
  assert.deepEqual([ja.ja_estavam.length, ja.encerradas.length], [2, 0])
  const dep2 = Object.fromEntries(dep.listar().map(x => [x.id, x]))
  assert.deepEqual([dep2[ID('b')].desde, dep2[ID('b')].desde_origem, dep2[ID('b')].dias, dep2[ID('b')].faixa, dep2[ID('b')].texto], ['2026-09-23', 'historico', 14, 'cobrar', `Fotos do produto: ${CORPO.detalhe}`])
  assert.deepEqual([dep2[ID('c')].desde, dep2[ID('c')].desde_origem, dep2[ID('c')].dias, dep2[ID('c')].faixa], ['2026-09-07', 'ultima_edicao', 30, 'revisar'])
  assert.deepEqual([dep2[ID('b')].registro_em, dep2[ID('b')].por], ['2026-10-07T13:00:00.000Z', 'Giovanna Torres'], 'a auditoria de quem/quando registrou fica em registro_em')
  h.prepare(SQL_REABERTURA).run('2026-10-08T00:00:00.000Z', 'Em andamento', ID('a'), '2026-10-08T00:00:00.000Z')   // o sync reabriu…
  h.prepare("UPDATE tarefas SET status = 'andamento', status_raw = 'Em andamento' WHERE id = ?").run(ID('a'))         // …e trouxe o status novo
  assert.equal(dep.listar({ cliente: 'Damar' }).length, 2, 'reaberta sai da lista')
  h.prepare("UPDATE tarefas SET status = 'dependencia_cliente' WHERE id = ?").run(ID('a'))
  assert.equal(dep.listar({ ids: [ID('a')] })[0].desde_origem, 'historico', 'de volta ao status sem registro ativo: o motivo antigo não é reaproveitado')
})

await ok('validação do núcleo: ids (1-100, formato), tipo, detalhe 3-300, evidência http(s), por obrigatório e da lista — mensagens fixas sem eco', async () => {
  const { dep, tarefa } = montar(); tarefa(ID('1'))
  const ruim = async (extra, rx) => { const m = await falha(() => dep.encerrar({ ...CORPO, ids: [ID('1')], ...extra }), rx); assert.ok(!/onerror|alert|script/.test(m)); return m }
  await ruim({ ids: [] }, /informe "ids"/); await ruim({ ids: 'x' }, /informe "ids"/); await ruim({ ids: undefined }, /informe "ids"/)
  await ruim({ ids: IDS(101) }, /máximo de 100 tarefas por vez/)
  await ruim({ ids: ['<img src=x onerror=alert(1)>'] }, /id de tarefa inválido/); await ruim({ ids: [{ a: 1 }] }, /id de tarefa inválido/)
  await ruim({ tipo: '<script>' }, /tipo de dependência desconhecido/); await ruim({ tipo: '__proto__' }, /tipo/); await ruim({ tipo: 'constructor' }, /tipo/)
  await ruim({ detalhe: 'ab' }, /descreva o que falta do cliente \(até 300 caracteres\)/); await ruim({ detalhe: 'x'.repeat(301) }, /até 300/)
  await ruim({ detalhe: { a: 1 } }, /descreva/); await ruim({ detalhe: ['fotos dos 12 SKUs'] }, /descreva/)   // objeto/array nunca vira '[object Object]' no card do cliente
  await ruim({ tipo: ['fotos'] }, /tipo de dependência/); await ruim({ por: { nome: 'Giovanna Torres' } }, /informe "por"/)
  await ruim({ evidencia: 'javascript:alert(1)' }, /link inválido/); await ruim({ evidencia: 'https://' + 'a'.repeat(600) }, /link inválido/)
  await ruim({ por: '' }, /informe "por"/); await ruim({ por: '<img src=x onerror=alert(1)>' }, /só líderes e consultores encerram por dependência do cliente — escolha um nome da central/)
  await ruim({ por: 'Analista Qualquer' }, /só líderes e consultores/)
  const p = await dep.encerrar({ ...CORPO, ids: IDS(100), evidencia: undefined })
  assert.equal(p.mudam.length + p.invalidas.length, 100, '100 cabe')
  assert.equal((await dep.encerrar({ ...CORPO, ids: [ID('1'), ID('1')] })).mudam.length, 1, 'id repetido conta uma vez')
})

// ── 9. rotas HTTP ────────────────────────────────────────────────────────────────────────────────────────
function subir(deps) {
  const app = express(); app.use(express.json()); app.use(criarRotasDependencia(deps))
  return new Promise(res => { const srv = app.listen(0, '127.0.0.1', () => res({ srv, base: `http://127.0.0.1:${srv.address().port}` })) })
}
const chama = async (base, caminho, corpo, tipo = 'application/json') => {
  const r = await fetch(base + caminho, corpo === undefined ? undefined : { method: 'POST', headers: tipo ? { 'Content-Type': tipo } : {}, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })
  return { status: r.status, j: await r.json().catch(() => ({})) }
}
{
  const { notion, dep, tarefa, reg } = montar()
  tarefa(ID('1')); tarefa(ID('403'))
  const { srv, base } = await subir({ dependencias: dep, quem: () => QUEM })
  const R = '/api/tarefas/dependencia-cliente'
  try {
    await ok('9a. POST: 415 sem JSON; 400 por validação com mensagem fixa (sem eco de "<img onerror>"); corpo não-objeto = 400', async () => {
      assert.equal((await chama(base, R, JSON.stringify({ ...CORPO, ids: [ID('1')] }), 'text/plain')).status, 415)
      assert.equal((await chama(base, R, [1, 2])).status, 400)
      const casos = [
        [{ ids: [] }, /informe "ids"/], [{ ids: IDS(101) }, /máximo de 100/], [{ ids: ['<img src=x onerror=alert(1)>'] }, /id de tarefa inválido/],
        [{ tipo: '<img src=x onerror=alert(1)>' }, /tipo de dependência/], [{ detalhe: '<b' }, /descreva o que falta/], [{ evidencia: 'javascript:<img src=x onerror=alert(1)>' }, /link inválido/],
        [{ por: '' }, /informe "por"/], [{ por: '<img src=x onerror=alert(1)>' }, /só líderes e consultores/],
      ]
      for (const [extra, rx] of casos) {
        const a = await chama(base, R, { ...CORPO, ids: [ID('1')], ...extra })
        assert.equal(a.status, 400, JSON.stringify(extra).slice(0, 40)); assert.match(a.j.erro, rx); assert.ok(!a.j.erro.includes('onerror'))
      }
      assert.equal(notion.de('PATCH').length, 0)
    })
    await ok('9b. POST sem confirmar = prévia 200 (0 PATCH); com confirmar lote misto = 200 com encerradas/falhas; cliente do registro vem de tarefas, não do corpo', async () => {
      const p = await chama(base, R, { ...CORPO, ids: [ID('1'), ID('403'), ID('f')] })
      assert.equal(p.status, 200); assert.deepEqual(p.j.mudam.map(x => x.id), [ID('1'), ID('403')]); assert.equal(p.j.invalidas.length, 1); assert.equal(notion.de('PATCH').length, 0)
      const r = await chama(base, R, { ...CORPO, ids: [ID('1'), ID('403'), ID('f')], cliente: 'Outro Cliente', confirmar: true })
      assert.equal(r.status, 200); assert.equal(r.j.ok, true)
      assert.deepEqual(r.j.encerradas.map(x => x.id), [ID('1')])
      assert.deepEqual(r.j.falhas.map(x => [x.id, x.motivo]), [[ID('403'), 'a integração não tem permissão para editar esta base'], [ID('f'), 'tarefa não encontrada ou arquivada']])
      assert.equal(r.j.comentarios_pendentes, 0)
      assert.equal(reg(ID('1')).cliente, 'Damar'); assert.equal(reg(ID('f')), undefined)
      assert.equal((await chama(base, R, { ...CORPO, ids: [ID('1')], confirmar: 'true' })).j.mudam?.length ?? -1, 0, 'confirmar precisa ser true de verdade (string = prévia)')
    })
    await ok('9c. GET ?cliente=: itens com desde/dias/faixa, tipos, quem e limiares; cliente desconhecido = lista vazia; sem cliente = carteira inteira', async () => {
      const g = await chama(base, R + '?cliente=Damar')
      assert.equal(g.status, 200); assert.equal(g.j.itens.length, 1)
      assert.deepEqual([g.j.itens[0].id, g.j.itens[0].tipo_rotulo, g.j.itens[0].desde, g.j.itens[0].desde_origem, g.j.itens[0].dias, g.j.itens[0].faixa], [ID('1'), 'Fotos do produto', '2026-10-07', 'registro', 0, 'aguardando'])
      assert.deepEqual(Object.keys(g.j.tipos), Object.keys(TIPOS)); assert.deepEqual(g.j.quem, QUEM); assert.deepEqual(g.j.limiares, { atencao: 14, revisar: 30 })
      assert.equal((await chama(base, R + '?cliente=Zzz')).j.itens.length, 0)
      assert.equal((await chama(base, R)).j.itens.length, 1)
      assert.equal((await chama(base, R + '?cliente[]=a&cliente[]=b')).status, 200, 'query repetida vira texto')
    })
  } finally { srv.close() }
}
await ok('9d. erro interno (sem status, ex.: SQLITE_BUSY) não vira 400 com a mensagem crua: vai ao handler global (500 "erro interno"); erro com status mantém a mensagem fixa', async () => {
  const { dep } = montar()
  const app = express(); app.use(express.json())
  app.use(criarRotasDependencia({ dependencias: { ...dep, listar: () => { throw new Error('SQLITE_BUSY: database is locked') }, encerrar: async () => { throw Object.assign(new Error('mensagem fixa'), { status: 400 }) } }, quem: () => QUEM }))
  app.use((err, req, res, _next) => res.status(500).json({ erro: 'erro interno' }))   // papel do handler global do server.js (detalhe sanitizado só no log)
  const srv = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  try {
    const g = await chama(base, '/api/tarefas/dependencia-cliente'); assert.equal(g.status, 500); assert.deepEqual(g.j, { erro: 'erro interno' })
    const p = await chama(base, '/api/tarefas/dependencia-cliente', { ids: [ID('1')] }); assert.equal(p.status, 400); assert.equal(p.j.erro, 'mensagem fixa')
  } finally { srv.close() }
})

await ok('equipe.lideresEConsultores: consultores ∪ líderes de TODA a central (não só elegíveis) ∪ prestadores com cargo de liderança; validar devolve o nome canônico', async () => {
  const { db } = await import('../src/lib/db.js')                 // PS_DB_MEMORIA=1: banco em memória com o schema inteiro (inclui tarefa_dependencia)
  const { lideresEConsultores, validarLiderOuConsultor } = await import('../src/lib/equipe.js')
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'tarefa_dependencia'").get()?.name, 'tarefa_dependencia', 'db.js roda SCHEMA_DEPENDENCIA')
  const cc = db.prepare('INSERT INTO clientes_central (cliente, status_cs, consultores_json, lideres_json, atualizado_em) VALUES (?,?,?,?,?)')
  cc.run('Damar', 'Ativo', '{"ML":"Giovanna Torres"}', '{"ML":"Carla Souza"}', 'x')
  cc.run('Antigo', 'Cancelado', '{"SHO":"Giovanna Torres","ML":""}', '{}', 'x')                        // não elegível, mas a pessoa continua consultora (e entra uma vez só)
  const pr = db.prepare("INSERT INTO prestadores (nome, nome_norm, cargo, area, atuacao_json, atualizado_em) VALUES (?,?,?,?,'[]','x')")
  pr.run('Marcelo Silva', 'marcelo silva', 'CEO', ''); pr.run('Dani Nunes', 'dani nunes', 'Analista de E-commerce', ''); pr.run('Bruna Lima', 'bruna lima', 'Coordenadora de projetos', ''); pr.run('Pedro Alves', 'pedro alves', 'Líder de squad', '')
  // 15/10/2026: o dono (config/equipe.json → donos) passa em toda validação e entra na lista
  assert.deepEqual(lideresEConsultores(), ['Bruna Lima', 'Carla Souza', 'David do Valle', 'David Do Valle Jr', 'Giovanna Torres', 'Marcelo Silva', 'Pedro Alves'])
  assert.equal(validarLiderOuConsultor('  GIOVANNA torres '), 'Giovanna Torres')
  assert.equal(validarLiderOuConsultor('Dani Nunes'), '', 'analista não encerra')
  assert.equal(validarLiderOuConsultor(''), ''); assert.equal(validarLiderOuConsultor('<img src=x onerror=1>'), '')
  const sv = fonte('src/server.js')
  assert.match(sv, /criarDependencias\(\{ handle: db, notion: \{ req: notionReq \}, agora, hoje: hojeLocal, validarPor: validarLiderOuConsultor, mapeamento/)
  assert.match(sv, /criarRotasDependencia\(\{ dependencias, quem: lideresEConsultores \}\)/)
  assert.match(sv, /limiares: \{ atencao: playbook\.limiares\.dependencia_atencao_dias, revisar: playbook\.limiares\.dias_parada \}/)
})

// ── 10. semântica nos consumidores (banco em memória do db.js; nada de Notion, nada de data/db.sqlite) ───────────────────────────────
await ok('10. consumidores: 1 andamento + 1 bloqueada + 1 dependência (prazo vencido, 20 dias) + 1 concluída → KPIs, riscos, snapshots, time, plano (bloqueio_interno × bloqueio_cliente), Eisenhower, semanal; registrar o motivo não zera o relógio', async () => {
  const { db, hojeLocal, agora } = await import('../src/lib/db.js')
  const { calcularKpis, riscos } = await import('../src/lib/metricas.js')
  const { gravarSnapshots } = await import('../src/lib/sync.js')
  const { visaoTime, clientesAtrasados } = await import('../src/lib/analistas.js')
  const { gerarPlanoCliente, dependenciasDe } = await import('../src/lib/plano-cliente.js')
  const { medirResultados } = await import('../src/lib/aprendizado.js')
  const { lerCliente } = await import('../src/lib/merovingio.js')
  const { classificarTarefa } = await import('../src/lib/eisenhower.js')
  const { volumeAtividades, situacaoDaConta } = await import('../src/lib/semanal-resultados.js')
  const HOJE = hojeLocal(), CLI = '__dep_teste__'
  const dia = k => { const d = new Date(HOJE + 'T12:00:00'); d.setDate(d.getDate() + k); return d.toISOString().slice(0, 10) }
  const ins = db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, status_raw, responsavel, prazo, data_conclusao, last_edited)
    VALUES (@id, 'teste', @cliente, @titulo, @status, @status_raw, @responsavel, @prazo, @data_conclusao, @last_edited)`)
  const semear = (cliente, id, o) => ins.run({ cliente, id, titulo: id, status_raw: '', responsavel: 'Fulano Teste', prazo: null, data_conclusao: null, last_edited: dia(-1) + 'T12:00:00.000Z', ...o })
  semear(CLI, 'dep-andamento', { status: 'andamento' })
  semear(CLI, 'dep-bloqueada', { status: 'bloqueada', status_raw: 'Problemas na tarefa', last_edited: dia(-2) + 'T12:00:00.000Z' })
  semear(CLI, ID('d1'), { status: 'dependencia_cliente', status_raw: OPCAO_NOTION_DEPENDENCIA, responsavel: '', prazo: dia(-5), last_edited: dia(-20) + 'T12:00:00.000Z' })   // prazo vencido, sem dono: NÃO é atraso nem falta de dono da equipe
  semear(CLI, 'dep-feita', { status: 'concluida', data_conclusao: dia(-3), last_edited: dia(-3) + 'T12:00:00.000Z' })

  const k = calcularKpis({ cliente: CLI })
  assert.deepEqual([k.planejadas, k.concluidas, k.bloqueadas, k.atrasadas, k.sem_responsavel, k.dependencia_cliente, k.dependencia_14d], [3, 1, 1, 0, 0, 1, 1], 'calcularKpis')
  const r = riscos({ cliente: CLI })
  assert.deepEqual([r.atrasadas.length, r.bloqueadas.map(t => t.id), r.sem_responsavel.length, r.dependencia_cliente.map(t => [t.id, t.desde])], [0, ['dep-bloqueada'], 0, [[ID('d1'), dia(-20)]]], 'riscos: dependência à parte, com desde')
  gravarSnapshots()
  const snap = db.prepare('SELECT planejadas, concluidas FROM snapshots WHERE cliente = ?').get(CLI)
  assert.deepEqual([snap.planejadas, snap.concluidas], [3, 1], 'gravarSnapshots não conta o que o cliente segura')
  const v = visaoTime().time
  assert.deepEqual([v.abertas, v.bloqueadas, v.atrasadas_reais, v.dependencia_cliente], [2, 1, 0, 1], 'visaoTime: fora de abertas/carga, contada à parte')
  const c = clientesAtrasados().clientes.find(x => x.cliente === CLI)
  assert.deepEqual([c.abertas, c.bloqueadas, c.atrasadas.length, c.gravidade], [2, 1, 0, 2], 'clientesAtrasados: gravidade sem a dependência (prazo vencido dela não conta)')
  assert.equal(classificarTarefa({ status: 'dependencia_cliente', titulo: 'x', tipo_demanda: '', prazo: dia(-5) }), null, 'fora da matriz Eisenhower')
  assert.ok(classificarTarefa({ status: 'bloqueada', titulo: 'x', tipo_demanda: '', prazo: null }), 'bloqueada continua na matriz')
  const depFotos = { id: ID('d1'), titulo: 'Fotos Pet', status: 'dependencia_cliente' }
  assert.equal(volumeAtividades({ de: dia(-7), ate: HOJE, dependencias: [depFotos] }).depende_cliente, 1)
  const sit = situacaoDaConta({ dependencias: [depFotos], hoje: HOJE })
  assert.equal(sit.nivel, 'ok'); assert.equal(sit.itens[0].texto, '1 tarefa(s) aguardam um retorno seu — veja Pontos de atenção'); assert.equal(sit.itens[0].tom, 'atencao')

  // plano: bloqueio_interno (1 bloqueada) e bloqueio_cliente (1 vencida, sem motivo registrado); pendência do tipo
  const cli = { cliente: CLI, status: 'Ativo', tier: '', nicho: '', canais: ['ML'], consultores: { ML: 'Fulano Teste' }, lideres: {}, principal: 'Fulano Teste', squads: [], squadPrincipal: '', squadDoCanal: () => '', responsavelDoCanal: () => 'Fulano Teste' }
  let g = gerarPlanoCliente(cli, { hoje: HOJE })
  const regra = (acoes, k) => acoes.find(a => a.regra === k)
  assert.equal(regra(g.acoes, 'bloqueio_interno').titulo, 'Destravar 1 tarefa(s) com impedimento interno')
  assert.equal(regra(g.acoes, 'bloqueio_cliente').titulo, 'Cobrar o cliente: 1 tarefa(s) aguardam retorno há 14+ dias (1× sem motivo registrado)')
  assert.deepEqual([g.plano.operacao.abertas, g.plano.operacao.bloqueadas, g.plano.operacao.dependencia_cliente, g.plano.operacao.dependencia_14d], [2, 1, 1, 1])
  assert.ok(g.plano.pendencias.some(p => p.item === 'Tipo da dependência não registrado em 1 tarefa(s)'), 'pendência do tipo')
  // o líder registra o motivo semanas depois ("já estava"): desde continua a última edição (20 dias) no listar E nos KPIs — mesmo número na tela e no relatório
  const dep = criarDependencias({ handle: db, notion: stubNotion(), agora, hoje: hojeLocal, validarPor: v => v, mapeamento: { propriedades: { status: ['Status'] } } })
  const ja = await dep.encerrar({ ...CORPO, ids: [ID('d1')], confirmar: true })
  assert.deepEqual([ja.ja_estavam.length, ja.encerradas.length], [1, 0], 'já na opção: só o registro, sem PATCH')
  const d = dependenciasDe(CLI, HOJE)
  assert.deepEqual([d.todas[0].desde, d.todas[0].desde_origem, d.todas[0].dias, d.todas[0].tipo_rotulo, d.vencidas.length], [dia(-20), 'ultima_edicao', 20, 'Fotos do produto', 1], 'registro não zera o relógio')
  assert.equal(calcularKpis({ cliente: CLI }).dependencia_14d, 1, 'metricas lê o mesmo desde')
  g = gerarPlanoCliente(cli, { hoje: HOJE })
  assert.equal(regra(g.acoes, 'bloqueio_cliente').titulo, 'Cobrar o cliente: 1 tarefa(s) aguardam retorno há 14+ dias (1× Fotos do produto)')
  assert.ok(!g.plano.pendencias.some(p => /Tipo da dependência/.test(JSON.stringify(p))), 'pendência some com o motivo registrado')
  // o cliente mexeu no card há 2 dias (última edição recente): deixa de ser vencida → bloqueio_cliente não dispara; bloqueio_interno fica
  db.prepare('UPDATE tarefas SET last_edited = ? WHERE id = ?').run(dia(-2) + 'T12:00:00.000Z', ID('d1'))
  g = gerarPlanoCliente(cli, { hoje: HOJE })
  assert.equal(regra(g.acoes, 'bloqueio_cliente'), undefined); assert.ok(regra(g.acoes, 'bloqueio_interno'))
  assert.equal(calcularKpis({ cliente: CLI }).dependencia_14d, 0)

  // Merovíngio: 5 dependências vencidas e 0 bloqueadas → cobrar_cliente (a equipe não está travada)
  const CLI2 = '__dep_merov__'
  for (let i = 0; i < 5; i++) semear(CLI2, `mv-dep-${i}`, { status: 'dependencia_cliente', status_raw: OPCAO_NOTION_DEPENDENCIA, last_edited: dia(-20) + 'T12:00:00.000Z' })
  for (let i = 0; i < 4; i++) semear(CLI2, `mv-and-${i}`, { status: 'andamento' })
  for (let i = 0; i < 3; i++) semear(CLI2, `mv-ok-${i}`, { status: 'concluida', data_conclusao: dia(-3) })
  const m = lerCliente({ reg: { cliente: CLI2, principal: 'Fulano Teste', vencimentos: {} }, plano: { _gerado_em: HOJE + 'T08:00:00', operacao: {}, fontes: [], ml: null }, acoes: [], hoje: HOJE })
  assert.equal(m.arquetipo.k, 'cobrar_cliente'); assert.ok(m.arquetipo.tese.includes('5 tarefa(s) aguardam retorno do cliente (5 há 14+ dias)'), m.arquetipo.tese)

  // condicaoAtiva (via medirResultados): bloqueio_interno mede bloqueada; bloqueio_cliente mede dependência vencida (14+ dias)
  const insAcao = (id, regraK, page) => db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, notion_page_id, notion_url, distribuido_em, criado_em, atualizado_em)
    VALUES (?, ?, '', ?, ?, ?, '72h', ?, '', '', 40, '{}', 'distribuida', ?, 'x', ?, ?, ?)`).run(id, CLI, regraK, HOJE.slice(0, 7), regraK, dia(-7), page, dia(-10) + 'T10:00:00', agora(), agora())
  insAcao('PS-dep0000001', 'bloqueio_interno', 'pg-di'); semear(CLI, 'pg-di', { status: 'concluida', titulo: 'Destravar · PS-dep0000001', data_conclusao: dia(-5) })
  insAcao('PS-dep0000002', 'bloqueio_cliente', 'pg-dc'); semear(CLI, 'pg-dc', { status: 'concluida', titulo: 'Cobrar · PS-dep0000002', data_conclusao: dia(-5) })
  medirResultados({ hoje: HOJE })
  const apr = id => db.prepare('SELECT resolveu, detalhe FROM aprendizado WHERE acao_id = ?').get(id)
  assert.deepEqual([apr('PS-dep0000001').resolveu, apr('PS-dep0000001').detalhe], [0, 'bloqueadas agora: 1'])
  assert.deepEqual([apr('PS-dep0000002').resolveu, apr('PS-dep0000002').detalhe], [1, 'aguardando o cliente há 14+ dias agora: 0'], 'dependência de 2 dias não é vencida → resolveu')
  db.prepare("DELETE FROM aprendizado WHERE acao_id = 'PS-dep0000002'").run()
  db.prepare('UPDATE tarefas SET last_edited = ? WHERE id = ?').run(dia(-20) + 'T12:00:00.000Z', ID('d1'))
  medirResultados({ hoje: HOJE })
  assert.equal(apr('PS-dep0000002').resolveu, 0, 'vencida de novo → persiste')
})

// ── 11. fiação por grep: a classe passa pelo helper único e por todos os pontos do plano ─────────────────────────────────────────────
await ok('11. fiação: nenhum módulo compara status por conta própria (lista de exceção explícita); mapeamento com 7 classes e a opção só em dependencia_cliente; sync/ficha/ui/index ligados', () => {
  const RX = /NOT IN \('concluida', ?'cancelada'\)|\['concluida', ?'cancelada'\]|!==? 'cancelada'/
  const EXCECAO = {                                                        // o próprio helper; cards com medição (plano §1 — acompanhamento.js:424 lista também concluídas)
    'src/lib/status-tarefa.js': () => true,
    'src/lib/acompanhamento.js': l => /processo LIKE '%ercado%' AND status != 'cancelada'/.test(l),
  }
  const dir = d => readdirSync(new URL('../' + d, import.meta.url)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`)
  for (const a of [...dir('src/lib'), ...dir('src'), 'src/web/app.js']) {
    fonte(a).split('\n').forEach((l, i) => { if (RX.test(l) && !EXCECAO[a]?.(l)) assert.fail(`${a}:${i + 1} compara status por conta própria — use status-tarefa.js (ABERTA_SQL/PLANEJADA_SQL/ehAberta/ehPlanejada)`) })
  }
  const m = JSON.parse(fonte('config/mapeamento.json')).status_normalizacao
  assert.deepEqual(Object.keys(m).filter(k => !k.startsWith('$')), ['nao_iniciada', 'andamento', 'validacao', 'concluida', 'bloqueada', 'dependencia_cliente', 'cancelada'])
  assert.deepEqual(Object.entries(m).filter(([k, v]) => !k.startsWith('$') && v.includes(OPCAO_NOTION_DEPENDENCIA)).map(([k]) => k), ['dependencia_cliente'])
  assert.equal(m.dependencia_cliente[0], OPCAO_NOTION_DEPENDENCIA, 'o 1º nome é o que grava no Notion')
  assert.ok(m.bloqueada.includes('Problemas na tarefa'), 'impedimento interno segue bloqueada')
  assert.match(fonte('src/lib/sync.js'), /\(marcarReaberta \?\?= db\.prepare\(SQL_REABERTURA\)\)\.run\(/)
  assert.match(fonte('src/lib/ficha-nucleo.js'), /a\?\.regra === 'bloqueio_cliente' \? 'consultor'/)
  assert.match(fonte('src/web/ui.css'), /\.t-dependencia_cliente/)
  const html = fonte('src/web/index.html')
  for (const s of ['id="btnDependencia"', 'id="selTodas"', 'data-chip="dependencia_cliente"', 'value="dependencia_cliente"']) assert.ok(html.includes(s), s)
})

console.log(`\n${n} verificações ok`)
