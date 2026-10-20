// Autoteste do aprendizado (retroalimentação) — semeia ação distribuída + tarefa concluída e mede.
import assert from 'node:assert/strict'
import { db, agora } from '../src/lib/db.js'
import { medirResultados, estatisticas } from '../src/lib/aprendizado.js'

const CLI = '__aprend_teste__'
const limpar = () => { db.prepare('DELETE FROM tarefas WHERE cliente = ?').run(CLI); db.prepare('DELETE FROM acoes_plano WHERE cliente = ?').run(CLI); db.prepare('DELETE FROM aprendizado WHERE cliente = ?').run(CLI) }
const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
db.exec('BEGIN')                                  // isolamento: nada do teste (nem a medição das ações REAIS) persiste
try {
  // ação distribuída há 10 dias; a tarefa "· PS-" foi concluída há 5; e hoje NÃO há mais tarefa sem dono → resolveu
  db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, notion_page_id, notion_url, distribuido_em, criado_em, atualizado_em)
    VALUES ('PS-teste00001', ?, '', 'sem_responsavel', ?, 'Atribuir responsável', '72h', ?, '', '', 40, '{}', 'distribuida', 'x', 'x', ?, ?, ?)`)
    .run(CLI, dia(0).slice(0, 7), dia(-7), dia(-10) + 'T10:00:00', agora(), agora())
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, data_conclusao, last_edited)
    VALUES ('apr-1', 'teste', ?, 'Atribuir responsável · PS-teste00001', 'concluida', 'Fulano', ?, ?)`).run(CLI, dia(-5), dia(-5) + 'T12:00:00.000Z')
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, last_edited)
    VALUES ('apr-2', 'teste', ?, 'tarefa com dono', 'andamento', 'Fulano', ?)`).run(CLI, dia(-1) + 'T12:00:00.000Z')
  const m1 = medirResultados()
  assert.ok(m1.medidas >= 1)
  const reg = db.prepare('SELECT * FROM aprendizado WHERE acao_id = ?').get('PS-teste00001')
  assert.equal(reg.resolveu, 1, 'condição sumiu (nenhuma tarefa sem dono) → resolveu')
  assert.ok(reg.dias_para_concluir >= 4 && reg.dias_para_concluir <= 6)
  // idempotente: segunda medição não duplica
  const m2 = medirResultados()
  assert.equal(db.prepare('SELECT COUNT(*) n FROM aprendizado WHERE acao_id = ?').get('PS-teste00001').n, 1)
  // estatística: com 1 caso, taxa = null e nota declara amostra insuficiente (mínimo 5)
  const est = estatisticas().find(e => e.regra === 'sem_responsavel')
  assert.ok(est && (est.taxa === null ? /insuficiente/.test(est.nota) : est.medidas >= 5))
  // REGRESSÕES (06/10/2026)
  // #1 sem_plano_mes mede o mês que a AÇÃO mirava (não o mês da medição)
  db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, notion_page_id, notion_url, distribuido_em, criado_em, atualizado_em)
    VALUES ('PS-teste00002', ?, '', 'sem_plano_mes', '2026-09', 'Plano de setembro', '7d', ?, '', '', 21, '{}', 'distribuida', 'pg-2', 'x', ?, ?, ?)`)
    .run(CLI, dia(-20), dia(-30) + 'T10:00:00', agora(), agora())
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, data_conclusao, last_edited)
    VALUES ('pg-2', 'teste', ?, 'card renomeado sem sufixo', 'concluida', 'Fulano', ?, ?)`).run(CLI, dia(-10), dia(-10) + 'T12:00:00.000Z')
  db.prepare("INSERT OR REPLACE INTO planos_acao (cliente, ano_mes, canal, status, acoes_json, url, atualizado_em) VALUES (?, '2026-09', 'ML', '', '[]', '', ?)").run(CLI, agora())
  medirResultados()
  const r2 = db.prepare('SELECT * FROM aprendizado WHERE acao_id = ?').get('PS-teste00002')
  assert.ok(r2, '#17 tarefa achada pelo page_id mesmo sem o sufixo no título')
  assert.equal(r2.resolveu, 1, '#1 plano de SETEMBRO registrado → resolveu (antes media outubro e dava 0)')

  // DEPENDÊNCIA DO CLIENTE (07/10/2026)
  // card da ação em dependencia_cliente: nem concluído nem falha — conta em aguardando_cliente, nada é medido até o cliente entregar
  const insAcao = (id, regra, page) => db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, notion_page_id, notion_url, distribuido_em, criado_em, atualizado_em)
    VALUES (?, ?, '', ?, ?, ?, '72h', ?, '', '', 40, '{}', 'distribuida', ?, 'x', ?, ?, ?)`).run(id, CLI, regra, dia(0).slice(0, 7), regra, dia(-7), page, dia(-10) + 'T10:00:00', agora(), agora())
  insAcao('PS-teste00003', 'bloqueio_interno', 'pg-3')
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, last_edited) VALUES ('pg-3', 'teste', ?, 'Destravar · PS-teste00003', 'dependencia_cliente', 'Fulano', ?)`).run(CLI, dia(-1) + 'T12:00:00.000Z')
  const m3 = medirResultados()
  assert.ok(m3.aguardando_cliente >= 1, 'aguardando_cliente declarado no retorno')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM aprendizado WHERE acao_id = ?').get('PS-teste00003').n, 0, 'nada medido enquanto o cliente não entrega')
  // o cliente entregou e o card foi concluído há 5 dias; sobrou 1 bloqueada interna → bloqueio_interno NÃO resolveu
  db.prepare("UPDATE tarefas SET status = 'concluida', data_conclusao = ? WHERE id = 'pg-3'").run(dia(-5))
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, last_edited) VALUES ('apr-4', 'teste', ?, 'travada', 'bloqueada', 'Fulano', ?)`).run(CLI, dia(-1) + 'T12:00:00.000Z')
  medirResultados()
  const r3 = db.prepare('SELECT * FROM aprendizado WHERE acao_id = ?').get('PS-teste00003')
  assert.equal(r3.resolveu, 0, 'bloqueio_interno mede bloqueadas internas')
  assert.ok(r3.detalhe.includes('bloqueadas agora: 1'))
  // bloqueio_cliente mede dependência VENCIDA (14+ dias), não bloqueada: com 1 dependência de 20 dias → persiste; sem → resolveu
  insAcao('PS-teste00004', 'bloqueio_cliente', 'pg-4')
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, data_conclusao, last_edited) VALUES ('pg-4', 'teste', ?, 'Cobrar · PS-teste00004', 'concluida', 'Fulano', ?, ?)`).run(CLI, dia(-5), dia(-5) + 'T12:00:00.000Z')
  db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, status, responsavel, last_edited) VALUES ('apr-5', 'teste', ?, 'espera fotos', 'dependencia_cliente', 'Fulano', ?)`).run(CLI, dia(-20) + 'T12:00:00.000Z')
  medirResultados()
  const r4 = db.prepare('SELECT * FROM aprendizado WHERE acao_id = ?').get('PS-teste00004')
  assert.equal(r4.resolveu, 0, 'dependência vencida ainda existe → não resolveu')
  assert.ok(r4.detalhe.includes('aguardando o cliente há 14+ dias agora: 1'), r4.detalhe)
  db.prepare("DELETE FROM aprendizado WHERE acao_id = 'PS-teste00004'").run()
  db.prepare("UPDATE tarefas SET status = 'andamento' WHERE id = 'apr-5'").run()   // o cliente entregou: a tarefa voltou ao backlog
  medirResultados()
  assert.equal(db.prepare('SELECT resolveu FROM aprendizado WHERE acao_id = ?').get('PS-teste00004').resolveu, 1, 'sem dependência vencida → resolveu (a bloqueada interna não entra)')
  console.log('✔ aprendizado: mede resolveu=1, idempotente, amostra mínima declarada (nunca finge estatística); dependência do cliente: aguardando_cliente, bloqueio_interno × bloqueio_cliente separados')
} finally { db.exec('ROLLBACK') }
