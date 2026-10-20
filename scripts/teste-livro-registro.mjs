// Autoteste do LIVRO DE REGISTRO do cliente (src/lib/livro-registro.js; rotas em src/rotas-dossie.js): backfill a partir de TODAS as fontes com a data REAL do fato,
// idempotência (UNIQUE tipo+ref, 2ª passada = 0), trigger que barra UPDATE/DELETE, cadeia por cliente verificada e adulteração simulada detectada (conteúdo, elo,
// re-hash forjado, lacuna/cauda), sem telefone/jid (resposta do cliente só como sha256), anexo com sha256 do arquivo e URL assinada nunca guardada, teto de anexos
// por passada, listagem por período/tipo/página, etiqueta «Solicitação Seller» do Notion e a fiação (db.js, sync.js, server.js).
// Banco EM MEMÓRIA (PS_DB_MEMORIA=1 antes do import dinâmico do db.js): nunca abre data/db.sqlite, nunca chama rede. Rodar: node scripts/teste-livro-registro.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { criarLivro, SCHEMA_LIVRO, TIPOS_LIVRO, hashLinha, mascarar } from '../src/lib/livro-registro.js'
import { extrairTarefa } from '../src/lib/extrair.js'
import { criarRotasDossie } from '../src/rotas-dossie.js'
const { db } = await import('../src/lib/db.js')
db.exec((await import('../src/lib/consultor-discord.js')).SCHEMA_CONSULTOR)   // consultor_aviso nasce na fábrica do aviso ao consultor (não no db.js)

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const sha = b => createHash('sha256').update(b).digest('hex')
const raiz = mkdtempSync(join(tmpdir(), 'livro-'))
process.on('exit', () => rmSync(raiz, { recursive: true, force: true }))
let relogio = '2026-10-13T12:00:00.000Z'
const L = criarLivro({ handle: db, agora: () => relogio, raiz })
const PROSP = '[Comercial] Empresa X · 9'
const TEL = '(11) 98765-4321'

// ── mundo: todas as fontes que o livro lê ─────────────────────────────────────────────────────────
const tarefa = (id, cliente, o = {}) => db.prepare(`INSERT INTO tarefas (id, fonte, cliente, titulo, processo, responsavel, status, data_inicio, prazo, data_conclusao, url, prioridade, etiquetas, arquivada)
  VALUES (@id, 'f', @cliente, @titulo, @processo, @responsavel, @status, @data_inicio, @prazo, @data_conclusao, @url, @prioridade, @etiquetas, @arquivada)`)
  .run({ id, cliente, titulo: 'Card', processo: 'Mercado Livre', responsavel: 'Giovanna Torres', status: 'nao_iniciada', data_inicio: null, prazo: null, data_conclusao: null, url: `https://www.notion.so/${id}`, prioridade: '', etiquetas: '', arquivada: 0, ...o })
tarefa('t1', 'Acme', { titulo: `Otimizar título MLB123 — contato ${TEL}`, status: 'concluida', data_inicio: '2026-09-01', prazo: '2026-09-10', data_conclusao: '2026-09-05', etiquetas: 'Solicitação Seller' })
tarefa('t2', 'Acme', { titulo: 'Fotos novas do kit', status: 'dependencia_cliente' })
tarefa('t3', PROSP, { status: 'concluida', data_conclusao: '2026-09-02' })
tarefa('t4', 'Beta', { titulo: 'Campanha Ads', status: 'concluida', prioridade: 'Plano de Ação ' })
tarefa('t5', 'Acme', { titulo: 'Arquivada', arquivada: 1 })
db.prepare("INSERT INTO historico (tarefa_id, campo, de, para, em) VALUES ('t1','status','andamento','concluida','2026-09-05T13:00:00.000Z'), ('t1','responsavel','A','B','2026-09-04T13:00:00.000Z'), ('t3','status','nao_iniciada','concluida','2026-09-02T10:00:00.000Z')").run()
mkdirSync(join(raiz, 'evidencias', 't1'), { recursive: true })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('print do anúncio')])
writeFileSync(join(raiz, 'evidencias', 't1', 'a.png'), PNG)
const evid = (id, tarefa_id, o = {}) => db.prepare(`INSERT INTO evidencias (id, tarefa_id, tipo, url_origem, arquivo_local, legenda, criada_em) VALUES (@id, @tarefa_id, 'image', @url_origem, @arquivo_local, @legenda, @criada_em)`)
  .run({ id, tarefa_id, url_origem: '', arquivo_local: '', legenda: '', criada_em: '2026-09-04T10:00:00.000Z', ...o })
evid('e1', 't1', { arquivo_local: 'evidencias/t1/a.png', legenda: 'Antes da otimização' })
evid('e2', 't1', { url_origem: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/x.png?X-Amz-Signature=segredo123' })
evid('e3', 't4', { url_origem: 'https://drive.google.com/file/d/xyz?usp=sharing', criada_em: '2026-09-07T10:00:00.000Z' })
evid('e4', 't1', { arquivo_local: '../../etc/passwd' })   // caminho fora da pasta: nunca lido
evid('e5', 't3', { arquivo_local: 'evidencias/t1/a.png' }) // anexo do prospect: nunca entra
db.prepare("INSERT INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES ('Acme','MLB1','2026-09-06','preco','100','90',-10,'coleta','2026-09-06T05:00:00Z')").run()
db.prepare("INSERT INTO meli_item_snapshot (cliente, item_id, hash, capturado_em, origem, titulo, preco, status, fotos_json) VALUES ('Acme','MLB1','abc','2026-09-03T08:00:00.000Z','coleta','Kit Acme',100,'active','[1,2]')").run()
db.prepare("INSERT INTO tarefa_acomp (tarefa_id, item_id, fase, cliente, data_ref, capturado_em, atraso_dias, estado_json) VALUES ('t1','MLB1','antes','Acme','2026-09-05','2026-09-05T09:00:00.000Z',0,'{\"v\":1}')").run()
const relEnvio = (estado, em) => db.prepare("INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, page_url, hash, por, em) VALUES ('Acme','2026-09-05','2026-09-11','manual',?,'https://www.notion.so/abc?pvs=4','h1','David do Valle',?)").run(estado, em)
relEnvio('enviado', '2026-09-12T20:00:00.000Z'); relEnvio('falhou', '2026-09-13T20:00:00.000Z')
const lote = (id, tipo, estado, enviado_em) => db.prepare("INSERT INTO gatilho_lote (id, cliente, tipo, dia, hash, canais_json, estado, origem, criado_em, enviado_em, recibos_json) VALUES (?, 'Acme', ?, '2026-09-16', 'hh', '[\"whatsapp\"]', ?, 'automatico', ?, ?, ?)")
  .run(id, tipo, estado, enviado_em || '2026-09-16T11:00:00.000Z', enviado_em, JSON.stringify({ whatsapp: { estado: 'entregue', em: enviado_em, jid: '120363025@g.us' } }))
lote('L1', 'semanal', 'entregue', '2026-09-16T12:00:00.000Z'); lote('L2', 'semanal', 'montado', ''); lote('L3', 'imediato', 'enviado', '2026-09-17T12:00:00.000Z')
const gat = (tipo, enviado_em) => db.prepare("INSERT INTO gatilho_cliente (cliente, tipo, classe, assinatura, texto, estado, lote_id, criado_em, atualizado_em, enviado_em) VALUES ('Acme', ?, 'atencao', ?, 'Precisamos das fotos do kit para seguir.', 'entregue', 'L1', ?, ?, ?)").run(tipo, tipo, enviado_em, enviado_em, enviado_em)
gat('dependencia_vencida', '2026-09-16T12:00:00.000Z'); gat('ruptura_curva_a', '2026-09-16T12:00:00.000Z')
db.prepare("INSERT INTO consultor_aviso (id, cliente, tipo, chave, dia, texto, hash, estado, criado_em, enviado_em) VALUES ('c1','Acme','interno_semanal','2026-W38','2026-09-15','corpo','hc','entregue','2026-09-15T11:00:00Z','2026-09-15T11:30:00.000Z')").run()
const fb = (msg_id, texto, status) => db.prepare(`INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, autor_nome, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, temas_json, status, coletado_em)
  VALUES (?, 'Acme', 'g', 'Bruno', ?, '2026-09-17T14:00:00.000Z', 'L1', 'relatorio', 'citou', 'certa', '["critica"]', ?, '2026-09-17T18:00:00Z')`).run(msg_id, texto, status)
fb('m1', `Não vi resultado, me liga ${TEL}`, 'novo'); fb('m2', 'conversa operacional', 'descartado')
db.prepare(`INSERT INTO pendencia_cliente (cliente, canal, item, detalhe, desde, evidencia, gravidade, por, criada_em, resolvida_em, resolvida_por)
  VALUES ('Acme','ml','custos','cliente pediu retorno no ${TEL}','2026-08-01','https://drive.google.com/x?token=1','critico','Giovanna Torres','2026-08-02T10:00:00Z','2026-09-20T10:00:00.000Z','Giovanna Torres')`).run()
db.prepare("INSERT INTO tarefa_dependencia (tarefa_id, cliente, tipo, detalhe, evidencia, por, em, notion_ok) VALUES ('t2','Acme','fotos','Fotos do kit','', 'Giovanna Torres','2026-09-10T10:00:00.000Z',1)").run()
db.prepare(`INSERT INTO alinhamento (cliente, escopo, chave, tipo, motivo, por, origem, desde, revisar_em, estado, encerrado_em, encerrado_por, criado_em)
  VALUES ('Acme','anuncio','MLB1','intencional','pausado de propósito','Giovanna Torres','painel','2026-09-02','2026-10-02','encerrado','2026-09-25T10:00:00.000Z','Giovanna Torres','2026-09-02T10:00:00Z')`).run()
db.prepare("INSERT INTO alerta_cliente (cliente, item, canal, rotulo, canal_rotulo, assinatura, estado, page_url, hash, criado_em, atualizado_em, enviado_em) VALUES ('Acme','fotos','ml','Fotos dos produtos','Mercado Livre','s','enviado','https://www.notion.so/al1','ha','2026-09-18T10:00:00Z','2026-09-18T10:00:00Z','2026-09-18T10:00:00.000Z')").run()

const tudo = () => db.prepare('SELECT * FROM registro_cliente ORDER BY seq').all()
const um = (tipo, ref) => db.prepare('SELECT * FROM registro_cliente WHERE tipo = ? AND ref = ?').get(tipo, ref)

await ok('backfill: cada fonte vira o tipo certo, com a data REAL do fato (registrado_em = relógio do livro); arquivada, prospect, falhou/montado, descartado e gatilho que não cobra ficam fora', async () => {
  const r = await L.ingerir({ teto_arquivos: 100 })
  assert.deepEqual(r.por_tipo, { tarefa_criada: 3, tarefa_concluida: 2, tarefa_status: 1, alteracao_anuncio: 1, fotografia_anuncio: 1, medicao_tarefa: 1, relatorio_enviado: 1, plano_enviado: 1,
    aviso_enviado: 1, pendencia_cobrada: 2, resumo_time: 1, resposta_cliente: 1, pendencia_registrada: 2, pendencia_resolvida: 1, alinhamento: 2, anexo_tarefa: 4 })
  assert.equal(r.anexos_pendentes, 0)
  const fato = (tipo, ref) => um(tipo, ref)?.fato_em
  assert.deepEqual([fato('tarefa_criada', 't1'), fato('tarefa_criada', 't2'), fato('tarefa_concluida', 't1'), fato('tarefa_concluida', 't4')], ['2026-09-01', '', '2026-09-05', ''], 'sem data na fonte = vazio, nunca inventada')
  assert.equal(JSON.parse(um('tarefa_concluida', 't4').dados_json).data_fonte, 'ausente')
  assert.equal(fato('tarefa_status', 't1@2026-09-05T13:00:00.000Z'), '2026-09-05T13:00:00.000Z')
  assert.equal(fato('alteracao_anuncio', 'MLB1:2026-09-06:preco:coleta'), '2026-09-06')
  assert.equal(fato('fotografia_anuncio', 'MLB1:abc'), '2026-09-03T08:00:00.000Z')
  assert.equal(fato('medicao_tarefa', 't1:MLB1:antes'), '2026-09-05T09:00:00.000Z')
  assert.equal(fato('relatorio_enviado', 'rel:1'), '2026-09-12T20:00:00.000Z'); assert.equal(um('relatorio_enviado', 'rel:2'), undefined, 'falhou não entra')
  assert.deepEqual([fato('plano_enviado', 'lote:L1'), fato('aviso_enviado', 'lote:L3'), um('plano_enviado', 'lote:L2')], ['2026-09-16T12:00:00.000Z', '2026-09-17T12:00:00.000Z', undefined])
  assert.equal(fato('resumo_time', 'disc:c1'), '2026-09-15T11:30:00.000Z')
  assert.equal(fato('resposta_cliente', 'm1'), '2026-09-17T14:00:00.000Z'); assert.equal(um('resposta_cliente', 'm2'), undefined, 'descartada não entra')
  assert.deepEqual([fato('pendencia_registrada', 'pc:1'), fato('pendencia_resolvida', 'pc:1'), fato('pendencia_registrada', 'td:t2@2026-09-10T10:00:00.000Z')], ['2026-08-01', '2026-09-20T10:00:00.000Z', '2026-09-10T10:00:00.000Z'])
  assert.deepEqual([fato('alinhamento', 'al:1'), fato('alinhamento', 'al:1:encerrado')], ['2026-09-02', '2026-09-25T10:00:00.000Z'])
  assert.deepEqual([fato('pendencia_cobrada', 'gat:1'), fato('pendencia_cobrada', 'alerta:1'), um('pendencia_cobrada', 'gat:2')], ['2026-09-16T12:00:00.000Z', '2026-09-18T10:00:00.000Z', undefined])
  assert.ok(tudo().every(x => x.registrado_em === relogio), 'registrado_em = quando entrou no livro')
  assert.ok(!tudo().some(x => x.cliente === PROSP || x.ref === 't5' || x.ref === 'e5'), 'prospect e arquivada nunca entram')
  assert.deepEqual(JSON.parse(um('plano_enviado', 'lote:L1').dados_json).recibos, { whatsapp: 'entregue' }, 'do recibo só o estado (nunca o destino)')
})

await ok('sem telefone, jid nem texto do cliente: máscara em todo texto; da resposta do cliente só tipo, âncora, confiança e data (sem autor, temas nem hash do texto)', async () => {
  const s = JSON.stringify(tudo())
  for (const x of ['98765-4321', '@g.us', '120363025', 'Não vi resultado', 'conversa operacional', 'segredo123', 'X-Amz', 'token=1', 'usp=sharing', 'pvs=4']) assert.ok(!s.includes(x), `vazou "${x}"`)
  assert.match(um('tarefa_criada', 't1').resumo, /contato \[telefone\]/)
  assert.match(JSON.parse(um('pendencia_registrada', 'pc:1').dados_json).detalhe, /\[telefone\]/)
  const r = um('resposta_cliente', 'm1'); assert.equal(r.prova, ''); assert.deepEqual(JSON.parse(r.dados_json), { ancora_tipo: 'relatorio', confianca: 'certa', relacao: 'citou' })
  assert.ok(!s.includes('Bruno') && !s.includes(sha(`Não vi resultado, me liga ${TEL}`)), 'nem o nome do autor nem o hash do texto (texto curto sai do hash por dicionário)')
  assert.equal(mascarar('ID 5232624524 e 23998369045'), 'ID 5232624524 e 23998369045', 'id de anúncio sem formato de telefone fica')
  assert.deepEqual(['wa.me/5511987654321', 'https://api.whatsapp.com/send?phone=5511987654321&text=oi', '5511987654321', 'tel 11 98765 4321', 'fixo 11 3456 7890'].map(mascarar),
    ['[contato]', '[contato]&text=oi', '[telefone]', 'tel [telefone]', 'fixo [telefone]'], 'link do WhatsApp, celular com 55 sem formato e número separado por espaço')
  assert.deepEqual(['Kit 12 1234 unid', 'EAN 7891234567890', 'MLB5511987654321'].map(mascarar), ['Kit 12 1234 unid', 'EAN 7891234567890', 'MLB5511987654321'])
})

await ok('anexo: sha256 do arquivo local; URL assinada do Notion/S3 nunca guardada; URL externa sem query; caminho fora da pasta data/ nunca lido', async () => {
  assert.equal(um('anexo_tarefa', 'e1').prova, `arquivo:evidencias/t1/a.png#sha256:${sha(PNG)}`)
  assert.deepEqual([um('anexo_tarefa', 'e2').prova, JSON.parse(um('anexo_tarefa', 'e2').dados_json).arquivo], ['', 'indisponivel']); assert.match(um('anexo_tarefa', 'e2').resumo, /não guardado localmente/)
  assert.equal(um('anexo_tarefa', 'e3').prova, 'url:https://drive.google.com/file/d/xyz')
  assert.equal(um('anexo_tarefa', 'e4').prova, '', '../../etc/passwd nunca é lido')
  assert.equal(um('anexo_tarefa', 'e1').fato_em, '2026-09-04T10:00:00.000Z')
})

await ok('idempotente: 2ª passada = 0; registrar o mesmo (tipo, ref) devolve o existente; passadas simultâneas no processo são uma só', async () => {
  const antes = tudo().length
  assert.equal((await L.ingerir()).total, 0)
  const x = L.registrar({ cliente: 'Acme', tipo: 'tarefa_criada', ref: 't1', fato_em: '2030-01-01', resumo: 'outro' })
  assert.deepEqual([x.novo, x.seq], [false, um('tarefa_criada', 't1').seq])
  tarefa('t6', 'Acme', { titulo: 'Nova', data_inicio: '2026-10-01' })
  const [a, b] = [L.ingerir(), L.ingerir()]; assert.equal(a, b, 'mesma promessa'); assert.equal((await a).total, 1)
  assert.equal(tudo().length, antes + 1)
  assert.throws(() => L.registrar({ cliente: PROSP, tipo: 'nota', ref: 'x', resumo: 'y' }), /cliente inválido/)
  assert.throws(() => L.registrar({ cliente: 'Acme', tipo: 'inventado', ref: 'x', resumo: 'y' }), /tipo de registro inválido/)
})

await ok('à prova de alteração: o trigger barra UPDATE e DELETE (inclusive em massa); a cadeia de cada cliente começa vazia e verifica', async () => {
  assert.throws(() => db.prepare("UPDATE registro_cliente SET resumo = 'x' WHERE seq = 1").run(), /alteracao proibida/)
  assert.throws(() => db.prepare('DELETE FROM registro_cliente WHERE seq = 1').run(), /exclusao proibida/)
  assert.throws(() => db.prepare('DELETE FROM registro_cliente').run(), /exclusao proibida/)
  const primeiros = db.prepare('SELECT cliente, hash_anterior FROM registro_cliente r WHERE seq = (SELECT MIN(seq) FROM registro_cliente x WHERE x.cliente = r.cliente)').all()
  assert.deepEqual(primeiros.map(p => p.hash_anterior), ['', ''])
  const v = L.verificarCadeia(); assert.deepEqual([v.ok, v.clientes, v.quebra, v.lacunas], [true, 2, null, 0])
  const va = L.verificarCadeia('Acme'); assert.equal(va.ok, true); assert.equal(va.cabeca.hash, db.prepare("SELECT hash FROM registro_cliente WHERE cliente = 'Acme' ORDER BY seq DESC LIMIT 1").get().hash)
})

await ok('adulteração simulada (banco de teste sem os triggers) é detectada: conteúdo, re-hash forjado, linha apagada no meio e na cauda', async () => {
  const novo = () => { const h = new Database(':memory:'); h.exec(SCHEMA_LIVRO); const l = criarLivro({ handle: h }); for (const [c, i] of [['X', 1], ['Y', 1], ['X', 2], ['X', 3], ['Y', 2]]) l.registrar({ cliente: c, tipo: 'nota', ref: `${c}${i}`, fato_em: '2026-09-0' + i, resumo: `nota ${i}` }); h.exec('DROP TRIGGER trg_registro_sem_update; DROP TRIGGER trg_registro_sem_delete'); return { h, l } }
  const seqDe = (h, ref) => h.prepare("SELECT seq FROM registro_cliente WHERE ref = ?").get(ref).seq
  let { h, l } = novo(); assert.equal(l.verificarCadeia().ok, true)
  h.prepare("UPDATE registro_cliente SET resumo = 'nota adulterada' WHERE ref = 'X2'").run()
  assert.deepEqual(l.verificarCadeia().quebra, { cliente: 'X', seq: seqDe(h, 'X2'), motivo: 'conteudo', detalhe: l.verificarCadeia().quebra.detalhe })
  assert.equal(l.verificarCadeia('Y').ok, true, 'a cadeia do Y não depende do X')
  ;({ h, l } = novo())   // re-hash forjado: refaz o hash da linha alterada — o elo seguinte denuncia
  const r = h.prepare("SELECT * FROM registro_cliente WHERE ref = 'X2'").get(); r.resumo = 'forjada'
  h.prepare("UPDATE registro_cliente SET resumo = ?, hash = ? WHERE seq = ?").run(r.resumo, hashLinha(r.hash_anterior, r), r.seq)
  assert.deepEqual([l.verificarCadeia().quebra.seq, l.verificarCadeia().quebra.motivo], [seqDe(h, 'X3'), 'elo'])
  ;({ h, l } = novo()); const s3 = seqDe(h, 'X3'); h.prepare("DELETE FROM registro_cliente WHERE ref = 'X2'").run()
  const v = l.verificarCadeia(); assert.deepEqual([v.ok, v.quebra.seq, v.quebra.motivo, v.lacunas], [false, s3, 'elo', 1])
  ;({ h, l } = novo()); h.prepare("DELETE FROM registro_cliente WHERE ref = 'Y2'").run()   // última linha: nenhum elo depois dela — o contador global denuncia
  const c = l.verificarCadeia(); assert.deepEqual([c.ok, c.quebra, c.lacunas], [false, null, 1])
})

await ok('teto de anexos por passada: o resto fica para a próxima, com a contagem do que falta', async () => {
  for (const i of [6, 7, 8]) evid(`e${i}`, 't1', { arquivo_local: 'evidencias/t1/a.png', criada_em: `2026-09-0${i}T10:00:00.000Z` })
  const a = await L.ingerir({ teto_arquivos: 2 }); assert.deepEqual([a.por_tipo.anexo_tarefa, a.anexos_pendentes], [2, 1])
  const b = await L.ingerir({ teto_arquivos: 2 }); assert.deepEqual([b.por_tipo.anexo_tarefa, b.anexos_pendentes], [1, 0])
  assert.equal(L.verificarCadeia().ok, true)
})

await ok('listar: período pelo dia do fato (fato sem data cai no dia do registro), tipo, página, isolamento por cliente; período inválido = erro fixo', async () => {
  const s = L.listar({ cliente: 'Acme', de: '2026-09-01', ate: '2026-09-05' })
  assert.ok(s.itens.every(i => i.cliente === 'Acme' && i.fato_em >= '2026-09-01' && i.fato_em.slice(0, 10) <= '2026-09-05'))
  assert.deepEqual(s.itens.map(i => i.fato_em.slice(0, 10)), [...s.itens.map(i => i.fato_em.slice(0, 10))].sort(), 'ordem cronológica do fato')
  assert.ok(s.itens.some(i => i.tipo === 'anexo_tarefa') && !s.itens.some(i => i.ref === 't2'))
  const semData = L.listar({ cliente: 'Acme', de: '2026-10-13', ate: '2026-10-13', tipo: 'tarefa_criada' }); assert.deepEqual(semData.itens.map(i => [i.ref, i.fato_em]), [['t2', '']])
  const p1 = L.listar({ cliente: 'Acme', por_pagina: 3 }), p2 = L.listar({ cliente: 'Acme', por_pagina: 3, pagina: 2 })
  assert.equal(p1.itens.length, 3); assert.notEqual(p1.itens[0].seq, p2.itens[0].seq); assert.equal(p1.total, Object.values(p1.por_tipo).reduce((a, b) => a + b, 0))
  assert.ok(L.listar({ cliente: 'Beta' }).itens.every(i => i.cliente === 'Beta'))
  assert.throws(() => L.listar({ cliente: 'Acme', de: '2026-09-31x' }), /período inválido/); assert.throws(() => L.listar({ cliente: 'Acme', de: '2026-09-10', ate: '2026-09-01' }), /período inválido/)
  assert.throws(() => L.listar({ cliente: 'Acme', tipo: 'drop table' }), /tipo de registro inválido/)
})

await ok('etiqueta do Notion: «Tag» vira tarefas.etiquetas (sem tirar a Prioridade); «Solicitação Seller» marcada no livro pela etiqueta OU pela prioridade', async () => {
  const pg = { id: 'p1', properties: { Tarefas: { type: 'title', title: [{ plain_text: 'X' }] }, Prioridade: { type: 'select', select: { name: 'P1' } },
    Tag: { type: 'multi_select', multi_select: [{ name: 'Plano de Ação' }, { name: 'Solicitação Seller' }] } } }
  const { tarefa: t } = extrairTarefa(pg, { cliente: 'Acme' }); assert.deepEqual([t.etiquetas, t.prioridade], ['Plano de Ação, Solicitação Seller', 'P1'])
  assert.equal(JSON.parse(um('tarefa_criada', 't1').dados_json).solicitacao_seller, true)
  assert.deepEqual([JSON.parse(um('tarefa_criada', 't4').dados_json).solicitacao_seller, JSON.parse(um('tarefa_criada', 't4').dados_json).prioridade], [false, 'Plano de Ação'])
  tarefa('t7', 'Beta', { prioridade: 'Solicitação Seller' }); await L.ingerir(); assert.equal(JSON.parse(um('tarefa_criada', 't7').dados_json).solicitacao_seller, true)
})

await ok('rotas: GET livro (contrato, 404 prospect/desconhecido sem eco, 400 período/tipo) e GET verificar', async () => {
  const app = express(); app.use(express.json())
  const canon = nome => ['Acme', 'Beta'].find(c => c.toLowerCase() === String(nome).toLowerCase()) || ''
  app.use(criarRotasDossie({ livro: L, risco: {}, contratos: {}, quem: () => ['Giovanna Torres'], clienteCanonico: canon }))
  app.use((err, req, res, _n) => res.status(500).json({ erro: 'erro interno' }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const get = async p => { const r = await fetch(base + p); const t = await r.text(); return { status: r.status, j: JSON.parse(t), t } }
  try {
    const g = await get('/api/cliente/livro?cliente=acme&de=2026-09-01&ate=2026-09-30&por_pagina=5')
    assert.equal(g.status, 200); assert.deepEqual(Object.keys(g.j), ['cliente', 'de', 'ate', 'tipo', 'total', 'pagina', 'por_pagina', 'por_tipo', 'itens', 'tipos'])
    assert.deepEqual([g.j.cliente, g.j.itens.length, g.j.tipos], ['Acme', 5, TIPOS_LIVRO]); assert.deepEqual(Object.keys(g.j.itens[0]), ['seq', 'cliente', 'fato_em', 'registrado_em', 'tipo', 'ref', 'resumo', 'dados', 'prova', 'hash'])
    const p = await get('/api/cliente/livro?cliente=' + encodeURIComponent(PROSP)); assert.deepEqual([p.status, p.j.erro], [404, 'cliente não encontrado na central']); assert.ok(!p.t.includes('Empresa X'))
    const d = await get('/api/cliente/livro?cliente=Fantasma%3Cb%3E'); assert.equal(d.status, 404); assert.ok(!d.t.includes('Fantasma'))
    assert.equal((await get('/api/cliente/livro')).status, 400)
    const e = await get('/api/cliente/livro?cliente=Acme&de=%3Cscript%3E'); assert.equal(e.status, 400); assert.ok(!e.t.includes('script'))
    assert.equal((await get('/api/cliente/livro?cliente=Acme&tipo=xyz')).status, 400)
    const v = await get('/api/livro/verificar'); assert.deepEqual([v.status, v.j.ok, v.j.lacunas], [200, true, 0])
    const va = await get('/api/livro/verificar?cliente=Acme'); assert.deepEqual([va.j.ok, va.j.cliente, typeof va.j.cabeca.hash], [true, 'Acme', 'string'])
    assert.equal((await get('/api/livro/verificar?cliente=Fantasma')).status, 404)
  } finally { srv.close() }
})

await ok('resposta do cliente: só entra revisada ou depois de 7 dias sem descarte; descartada depois de registrada vira nota de retratação (a linha antiga fica)', async () => {
  const fb2 = (msg_id, status, coletado_em) => db.prepare(`INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, autor_nome, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, temas_json, status, coletado_em)
    VALUES (?, 'Acme', 'g', 'Bruno', 'ok', '2026-10-10T14:00:00.000Z', 'L1', 'pergunta', 'janela', 'provavel', '["critica"]', ?, ?)`).run(msg_id, status, coletado_em)
  fb2('m3', 'novo', '2026-10-10T18:00:00Z'); fb2('m4', 'revisado', '2026-10-12T18:00:00Z')
  await L.ingerir()
  assert.deepEqual([um('resposta_cliente', 'm3'), !!um('resposta_cliente', 'm4')], [undefined, true], 'nova há 3 dias = ainda pode ser descartada; revisada entra')
  db.prepare("UPDATE feedback_relatorio SET status = 'descartado', texto = '', autor_nome = '', temas_json = '[]', status_em = '2026-10-13T10:00:00.000Z' WHERE msg_id IN ('m1', 'm3')").run()   // lápide (respostas-relatorio.js)
  await L.ingerir()
  const n = um('nota', 'descarte:m1')
  assert.deepEqual([n?.fato_em, JSON.parse(n.dados_json), !!um('resposta_cliente', 'm1'), um('nota', 'descarte:m3')], ['2026-10-13T10:00:00.000Z', { msg_id: 'm1' }, true, undefined], 'só o que já estava no livro ganha a nota')
  relogio = '2026-10-20T12:00:00.000Z'; await L.ingerir(); relogio = '2026-10-13T12:00:00.000Z'
  assert.equal(um('resposta_cliente', 'm3'), undefined, 'descartada nunca entra, nem depois dos 7 dias')
  assert.equal(L.verificarCadeia('Acme').ok, true)
})

await ok('passada do cliente (dossiê) nunca pega carona na passada global em curso: entra na fila e registra os anexos dele', async () => {
  tarefa('tq', 'Quarto', { titulo: 'Card Q', status: 'concluida' }); mkdirSync(join(raiz, 'evidencias', 'q'), { recursive: true })
  for (let i = 0; i < 3; i++) { writeFileSync(join(raiz, 'evidencias', 'q', `${i}.png`), 'q' + i); evid(`q${i}`, 'tq', { arquivo_local: `evidencias/q/${i}.png` }) }
  for (let i = 0; i < 6; i++) evid(`z${i}`, 't4', { url_origem: `https://drive.google.com/z${i}` })   // anexos de outro cliente ANTES na ordem (rowid)
  const global = L.ingerir({ teto_arquivos: 2 }), doCliente = L.ingerir({ cliente: 'Quarto', teto_arquivos: 5000 })
  assert.notEqual(global, doCliente, 'pedidos diferentes = passadas diferentes')
  await doCliente
  assert.equal(db.prepare("SELECT COUNT(*) n FROM registro_cliente WHERE cliente = 'Quarto' AND tipo = 'anexo_tarefa'").get().n, 3)
  await L.ingerir({ teto_arquivos: 100 })
})

await ok('INSERT OR REPLACE não troca linha do livro (por seq nem por tipo+ref): o trigger barra a substituição', async () => {
  const ult = db.prepare("SELECT * FROM registro_cliente WHERE cliente = 'Acme' ORDER BY seq DESC LIMIT 1").get()
  const forjada = { ...ult, resumo: 'Contrato NÃO entregue (forjado)' }; forjada.hash = hashLinha(ult.hash_anterior, forjada)
  assert.throws(() => db.prepare('INSERT OR REPLACE INTO registro_cliente (seq, cliente, fato_em, registrado_em, tipo, ref, resumo, dados_json, prova, hash_anterior, hash) VALUES (@seq,@cliente,@fato_em,@registrado_em,@tipo,@ref,@resumo,@dados_json,@prova,@hash_anterior,@hash)').run({ ...forjada, ref: 'outro' }), /substituicao proibida/)
  assert.throws(() => db.prepare('INSERT OR REPLACE INTO registro_cliente (cliente, fato_em, registrado_em, tipo, ref, resumo, dados_json, prova, hash_anterior, hash) VALUES (@cliente,@fato_em,@registrado_em,@tipo,@ref,@resumo,@dados_json,@prova,@hash_anterior,@hash)').run(forjada), /substituicao proibida/)
  assert.equal(db.prepare('SELECT resumo FROM registro_cliente WHERE seq = ?').get(ult.seq).resumo, ult.resumo); assert.equal(L.verificarCadeia('Acme').ok, true)
})

await ok('fiação: db.js cria tabela + triggers + coluna etiquetas; sync.js ingere no fim; server.js monta rotas, upload de 7 MB antes do parser de 1 MB e o tick', async () => {
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'registro_cliente' ORDER BY name").all().map(r => r.name), ['trg_registro_sem_delete', 'trg_registro_sem_replace', 'trg_registro_sem_update'])
  assert.ok(db.prepare('PRAGMA table_info(tarefas)').all().some(c => c.name === 'etiquetas'))
  assert.deepEqual(JSON.parse(readFileSync(new URL('../config/mapeamento.json', import.meta.url))).propriedades.etiquetas, ['Tag', 'Tags', 'Etiquetas', 'Etiqueta'])
  const sync = readFileSync(new URL('../src/lib/sync.js', import.meta.url), 'utf8'); assert.match(sync, /ingerirLivro\(\{ origem: 'sync' \}\)/); assert.match(sync, /@etiquetas/)
  const srv = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.ok(srv.indexOf('app.use(ROTAS_UPLOAD, uploadJson)') > 0 && srv.indexOf('app.use(ROTAS_UPLOAD, uploadJson)') < srv.indexOf("app.use(express.json({ limit: '1mb' }))"), 'upload antes do parser global')
  assert.match(srv, /app\.use\(criarRotasDossie\(\{ livro: livroReal\(\), risco: riscoReal\(\), contratos: contratosReal\(\)/); assert.match(srv, /setInterval\(\(\) => ingerirLivro\(\{ origem: 'tick' \}\)/)
})

console.log(`\n${n} casos ok — livro de registro`)
