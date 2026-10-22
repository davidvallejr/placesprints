// Autoteste da Comunicação em esteira (docs/desenho-comunicacao-esteira.md § 0, § 1.4 e § 2; F1 + tela só leitura, 22/10/2026). Puro + estático: sem rede, sem DOM;
// o banco é em memória (better-sqlite3 :memory:), nunca data/db.sqlite.
//  (1) src/lib/comunicacao-fila.js: mapeamento da § 1.4 por fonte; estados e estágios só da lista fechada; Time sem Auditado/Liberado («—»); um fato, um item
//      (ponto entregue não duplica o lote); prospect fora; faixa Cliente só com CAMPOS_ITEM e sem item interno; código cru ganha texto;
//  (2) gate: banco × arquivo com «conflito» quando divergem; chave nunca gravada = desligada; só mostra (nenhuma função de escrita exportada);
//  (3) toda acao aponta para uma rota POST que JÁ existe em src/rotas-*.js; lerFontes lê as 8 tabelas num handle injetado e marca a ausente em nao_lidos;
//  (4) rota: 400 com mensagem fixa para faixa inválida (sem eco), ?faixa=cliente devolve só a faixa Cliente;
//  (5) tela: 1 .btn-primario, ≤ 6 <th> por tabela, sem hex, sem emoji, sem style inline; app.get('/comunicacao') e criarRotasComunicacao montados; item no shell.
// Rodar: node scripts/teste-comunicacao.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import express from 'express'
import * as M from '../src/lib/comunicacao-fila.js'
import { criarRotasComunicacao } from '../src/rotas-comunicacao.js'

const { montarFila, montarGate, lerFontes, textoMotivo, ESTADOS, ESTAGIOS, CAMPOS_ITEM, FONTES } = M
const RAIZ = new URL('..', import.meta.url).pathname
const ler = p => readFileSync(RAIZ + p, 'utf8')
let ok = 0
const falhas = []
const caso = async (nome, fn) => { try { await fn(); ok++; console.log('✔', nome) } catch (e) { falhas.push(nome); console.error('✘', nome, '\n  ', e.message.split('\n').join('\n   ')) } }
const EMOJI = /\p{Extended_Pictographic}|[\u{2600}-\u{27BF}]/u
const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/
const T = '2026-10-20T12:00:00.000Z'

const FONTES_FX = {
  gatilho_lote: [
    { id: 'L1', cliente: 'Alfa', tipo: 'semanal', estado: 'entregue', motivo: '', origem: 'timer', por: '', canais_json: '["whatsapp"]', recibos_json: '{"whatsapp":{"estado":"entregue","em":"2026-10-20T12:01:00Z"}}', criado_em: T, tentado_em: T, enviado_em: T },
    { id: 'L2', cliente: 'Alfa', tipo: 'imediato', estado: 'falhou', motivo: 'n8n_502', origem: 'timer', por: '', canais_json: '["whatsapp"]', recibos_json: '{}', criado_em: T, tentado_em: T, enviado_em: '' },
    { id: 'L3', cliente: 'Beta', tipo: 'semanal', estado: 'pendente', motivo: 'n8n_nao_configurado', origem: 'timer', por: '', canais_json: '[]', recibos_json: '{}', criado_em: T, tentado_em: '', enviado_em: '' },
    { id: 'L4', cliente: 'Beta', tipo: 'semanal', estado: 'enviado', motivo: '', origem: 'timer', por: '', canais_json: '["whatsapp"]', recibos_json: '{}', criado_em: T, tentado_em: T, enviado_em: T },
    { id: 'LP', cliente: '[Comercial] Prospect', tipo: 'semanal', estado: 'pendente', motivo: '', origem: 'timer', por: '', canais_json: '[]', recibos_json: '{}', criado_em: T, tentado_em: '', enviado_em: '' },
  ],
  gatilho_cliente: [
    { id: 1, cliente: 'Alfa', tipo: 'ruptura', estado: 'agrupado', motivo: '', lote_id: '', canais_json: '[]', texto: 'Estoque acaba em 3 dias.', criado_em: T, atualizado_em: T, enviado_em: '', entregue_em: '', resolvido_em: '' },
    { id: 2, cliente: 'Beta', tipo: 'ruptura', estado: 'agrupado', motivo: '', lote_id: '', canais_json: '[]', texto: 'x', criado_em: T, atualizado_em: T, enviado_em: '', entregue_em: '', resolvido_em: '' },
    { id: 3, cliente: 'Alfa', tipo: 'promessa', estado: 'pendente', motivo: 'conteudo:promessa', lote_id: '', canais_json: '[]', texto: 'x', criado_em: T, atualizado_em: T, enviado_em: '', entregue_em: '', resolvido_em: '' },
    { id: 4, cliente: 'Alfa', tipo: 'reputacao', estado: 'pendente', motivo: 'cooldown', lote_id: '', canais_json: '[]', texto: 'x', criado_em: T, atualizado_em: T, enviado_em: '', entregue_em: '', resolvido_em: '' },
    { id: 5, cliente: 'Alfa', tipo: 'ads_sem_retorno', estado: 'interno', motivo: 'assessoria', lote_id: '', canais_json: '[]', texto: 'segredo interno', criado_em: T, atualizado_em: T, enviado_em: '', entregue_em: '', resolvido_em: '' },
    { id: 6, cliente: 'Alfa', tipo: 'ruptura', estado: 'entregue', motivo: '', lote_id: 'L1', canais_json: '[]', texto: 'x', criado_em: T, atualizado_em: T, enviado_em: T, entregue_em: T, resolvido_em: '' },
  ],
  relatorio_envio: [
    { id: 1, cliente: 'Alfa', de: '2026-10-09', ate: '2026-10-16', origem: 'agendado', estado: 'enviado', motivo: '', por: 'agendador', em: T },
    { id: 2, cliente: 'Beta', de: '2026-10-09', ate: '2026-10-16', origem: 'agendado', estado: 'bloqueado', motivo: 'vazio', por: 'agendador', em: T },
    { id: 3, cliente: 'Gama', de: '2026-10-09', ate: '2026-10-16', origem: 'manual', estado: 'falhou', motivo: 'notion_403', por: 'Ana', em: T },
  ],
  relatorio_programacao: [
    { cliente: 'Alfa', frequencia: 'semanal', proximo_envio: '2026-10-23', ativado_por: 'Ana', ativado_em: T, tentar_apos: '', falhas_seguidas: 0, pausado_motivo: '', atualizado_em: T },
    { cliente: 'Beta', frequencia: 'semanal', proximo_envio: '2026-10-23', ativado_por: '', ativado_em: '', tentar_apos: '', falhas_seguidas: 0, pausado_motivo: '', atualizado_em: T },
  ],
  alerta_cliente: [
    { id: 9, cliente: 'Beta', item: 'acesso', rotulo: 'Acesso ao ML', canal_rotulo: 'Mercado Livre', estado: 'pendente', motivo: 'nao_liberado', origem: '', por: '', tentar_apos: '', criado_em: T, atualizado_em: T, enviado_em: '', resolvido_em: '' },
    { id: 10, cliente: 'Beta', item: 'acesso', rotulo: 'Acesso', canal_rotulo: '', estado: 'pendente', motivo: 'fora_da_janela', origem: '', por: '', tentar_apos: '', criado_em: T, atualizado_em: T, enviado_em: '', resolvido_em: '' },
  ],
  consultor_aviso: [
    { id: 'C1', cliente: 'Alfa', tipo: 'interno_semanal', chave: '2026-W43', estado: 'entregue', motivo: '', criado_em: T, tentado_em: T, enviado_em: T, recibo_json: '{"discord":{"estado":"entregue","em":"2026-10-20T11:34:22Z"}}' },
    { id: 'C2', cliente: 'Beta', tipo: 'interno_semanal', chave: '2026-W43', estado: 'pendente', motivo: 'sem_destino', criado_em: T, tentado_em: '', enviado_em: '', recibo_json: '{}' },
  ],
  exec_ordem: [{ id: 'CH-1', cliente: 'Alfa', regra: 'estoque_sincronizar', operacao: 'estoque', estado: 'aprovada', aprovado_por: 'Ana', aprovado_em: T, executado_em: '', conferido_em: '', criado_em: T, atualizado_em: T }],
  incidente: [{ id: 1, sinal_id: 'trinity.disco', sistema: 'trinity', rotulo: 'Disco', nivel: 'critico', estado: 'aberto', dono: 'Head de canais', aberto_em: T, resolvido_em: '' }],
}
const LIB = { Alfa: { liberado_por: 'Ana', auto: false }, Beta: { liberado_por: '', auto: false } }
const GATE = { estado: { gatilhos_ligado: 'ligado', gatilhos_ligado_por: 'David do Valle · 2026-10-12T19:57:27.885Z', relatorio_agendador: 'ligado', alerta_auto: 'desligado' },
  configs: { relatorio_envio: { agendador_ligado: false }, alerta: { automatico_ligado: false }, gatilhos: { urgente: { na_hora_ligado: true }, consultor: { urgente_ligado: false } }, autogestao: { whatsapp_critico_ligado: false } } }
const F = montarFila({ fontes: FONTES_FX, liberacao: LIB, gate: GATE, agora: T })
const todos = [...F.faixas.cliente.itens, ...F.faixas.time.itens]
const por = id => todos.find(i => i.id === id)

await caso('§ 1.4 gatilho_lote: entregue → Enviado com Recibo; falhou → Falhou com Reenviar; pendente sem n8n → Falhou; enviado (2xx sem recibo) → Processando', () => {
  const l1 = por('lote:L1'); assert.equal(l1.estado, 'enviado'); assert.equal(l1.estagio, 'Recibo'); assert.equal(l1.historico, true); assert.equal(l1.estagios[5].em, '2026-10-20T12:01:00Z')
  const l2 = por('lote:L2'); assert.equal(l2.estado, 'falhou'); assert.equal(l2.motivo, 'o n8n respondeu 502'); assert.equal(l2.acao.rota, '/api/gatilhos/enviar'); assert.equal(l2.acao.previa, true)
  assert.equal(por('lote:L3').estado, 'falhou'); assert.match(por('lote:L3').falta, /n8n/)
  assert.equal(por('lote:L4').estado, 'processando'); assert.equal(por('lote:L4').estagio, 'Enviado')
})

await caso('§ 1.4 gatilho_cliente: agrupado liberado → Prontos; sem liberação → Aguardando você com Liberar cliente; conteudo:* → Aguardando com Auditado barrado; cooldown → Pausado; interno → faixa Time', () => {
  assert.equal(por('ponto:1').estado, 'prontos'); assert.match(por('ponto:1').falta, /liberado por Ana/)
  const p2 = por('ponto:2'); assert.equal(p2.estado, 'aguardando'); assert.deepEqual(p2.acao, { rotulo: 'Liberar cliente', rota: '/api/gatilhos/liberar', corpo: { clientes: ['Beta'] }, previa: false })
  const p3 = por('ponto:3'); assert.equal(p3.estado, 'aguardando'); assert.equal(p3.estagios[2].s, 'barrado'); assert.match(p3.motivo, /auditor/); assert.equal(p3.acao, null, 'ninguém libera texto barrado')
  assert.equal(por('ponto:4').estado, 'pausado')
  const p5 = por('ponto:5'); assert.equal(p5.faixa, 'time'); assert.equal(p5.estagios[2].s, 'na'); assert.equal(p5.estagios[3].s, 'na'); assert.equal(p5.previa, '', 'texto interno não vira prévia')
  assert.equal(por('ponto:6'), undefined, 'ponto entregue não duplica o lote (um fato, um item)')
})

await caso('§ 1.4 relatório, programação, alerta, consultor, ordem e incidente', () => {
  assert.equal(por('relatorio:1').estado, 'enviado'); assert.equal(por('relatorio:2').estado, 'nao_elegivel'); assert.equal(por('relatorio:2').motivo, 'nada a relatar no período')
  assert.equal(por('relatorio:3').estado, 'falhou'); assert.equal(por('relatorio:3').acao.rota, '/api/relatorio/enviar')
  assert.equal(por('programacao:Alfa').estado, 'prontos'); assert.equal(por('programacao:Beta').estado, 'aguardando'); assert.equal(por('programacao:Beta').acao.rota, '/api/relatorio/liberar')
  assert.equal(por('alerta:9').estado, 'aguardando'); assert.equal(por('alerta:10').estado, 'pausado')
  assert.equal(por('consultor:C1').estado, 'enviado'); assert.equal(por('consultor:C1').faixa, 'time'); assert.equal(por('consultor:C2').estado, 'aguardando'); assert.equal(por('consultor:C2').acao, null)
  assert.equal(por('ordem:CH-1').estado, 'processando'); assert.equal(por('ordem:CH-1').sistema, 'chaveiro'); assert.equal(por('incidente:1').estado, 'aguardando')
})

await caso('lista fechada: estados, estágios (6, na ordem), campos do item; prospect fora; contadores batem; faixa Cliente sem item interno nem texto interno', () => {
  for (const i of todos) { assert.ok(ESTADOS.includes(i.estado), i.id); assert.deepEqual(i.estagios.map(e => e.nome), [...ESTAGIOS]); assert.deepEqual(Object.keys(i).sort(), [...CAMPOS_ITEM].sort(), i.id + ': campos fora da lista') }
  assert.ok(!todos.some(i => /Comercial/.test(i.cliente)), 'prospect nunca entra')
  assert.ok(F.faixas.cliente.itens.every(i => i.faixa === 'cliente')); assert.ok(F.faixas.time.itens.every(i => i.faixa === 'time'))
  assert.doesNotMatch(JSON.stringify(F.faixas.cliente), /segredo interno|assessoria|itens_json|payload/)
  for (const f of ['cliente', 'time']) { const C = F.faixas[f].contadores; assert.equal(ESTADOS.reduce((s, e) => s + C[e], 0), C.todos + C.historico) }
  assert.deepEqual(F.nao_lidos, [])
  assert.equal(textoMotivo('xyz_novo'), 'código «xyz_novo» (ainda sem texto no dicionário)'); assert.equal(textoMotivo(''), '')
})

await caso('gate (§ 0): banco × arquivo; conflito só quando os dois existem e divergem; efeito = banco quando gravado; chave nunca gravada = desligada; só leitura', () => {
  const G = montarGate(GATE), g = id => G.find(x => x.id === id)
  assert.equal(g('relatorio_agendador').conflito, true); assert.equal(g('relatorio_agendador').efeito, true)
  assert.equal(g('alerta_auto').conflito, false); assert.equal(g('alerta_auto').efeito, false)
  assert.equal(g('gatilhos_ligado').arquivo, null); assert.equal(g('gatilhos_ligado').banco_por, 'David do Valle'); assert.equal(g('gatilhos_ligado').banco_desde, '2026-10-12')
  assert.equal(g('dossie_mensal_ligado').efeito, false); assert.match(g('dossie_mensal_ligado').nota, /nunca gravada/)
  assert.equal(g('urgente_na_hora').efeito, true); assert.equal(g('urgente_na_hora').banco, null)
  assert.deepEqual(Object.keys(M).filter(k => typeof M[k] === 'function').sort(), ['lerFontes', 'montarFila', 'montarGate', 'textoMotivo'], 'nenhuma função de escrita')
  assert.deepEqual(F.gate.map(x => x.id), G.map(x => x.id))
})

await caso('ações só em rotas POST que já existem em src/rotas-*.js', () => {
  const rotas = readdirSync(RAIZ + 'src').filter(f => /^rotas-.*\.js$/.test(f)).map(f => ler('src/' + f)).join('\n')
  const ditas = [...new Set(todos.filter(i => i.acao).map(i => i.acao.rota)), '/api/gatilhos/preparar-lote', '/api/alertas/enviar']
  for (const r of ditas) assert.ok(rotas.includes(`r.post('${r}'`), r + ' não existe')
  assert.doesNotMatch(ler('src/rotas-comunicacao.js'), /r\.(post|put|delete|patch)\(/, 'rotas-comunicacao não cria escrita')
  assert.doesNotMatch(ler('src/web/comunicacao.js'), /preparar-lote', \{[^}]*confirmar: true/, 'a tela nunca confirma o preparar-lote')
})

await caso('lerFontes: lê as 8 tabelas num handle injetado (memória); tabela ausente vira nao_lidos; liberação lida da central', () => {
  const h = new Database(':memory:')
  h.exec(`CREATE TABLE gatilho_lote (id, cliente, tipo, estado, motivo, origem, por, canais_json, recibos_json, criado_em, tentado_em, enviado_em);
    CREATE TABLE clientes_central (cliente, notificacao_json);
    INSERT INTO gatilho_lote VALUES ('X','Alfa','semanal','pendente','','timer','','[]','{}','${T}','','');
    INSERT INTO clientes_central VALUES ('Alfa','{"liberado_por":"Ana"}'), ('Beta','{"auto_liberado":{"regra":"r"},"auto_bloqueado":true}')`)
  const { fontes, liberacao } = lerFontes(h, Date.parse(T))
  assert.equal(fontes.gatilho_lote.length, 1); assert.equal(fontes.exec_ordem, null)
  assert.deepEqual(liberacao, { Alfa: { liberado_por: 'Ana', auto: false }, Beta: { liberado_por: '', auto: false } })
  const f = montarFila({ fontes, liberacao }); assert.deepEqual(f.nao_lidos, FONTES.filter(t => t !== 'gatilho_lote')); assert.equal(f.gate, null)
})

await caso('rota: GET /api/comunicacao/fila; ?faixa=cliente só a faixa Cliente; faixa inválida = 400 fixo sem eco', async () => {
  const app = express(); app.use(criarRotasComunicacao({ fila: () => F }))
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`
  try {
    const a = await (await fetch(base + '/api/comunicacao/fila')).json(); assert.deepEqual(Object.keys(a.faixas), ['cliente', 'time'])
    const c = await (await fetch(base + '/api/comunicacao/fila?faixa=cliente')).json(); assert.deepEqual(Object.keys(c.faixas), ['cliente'])
    const r = await fetch(base + '/api/comunicacao/fila?faixa=%3Cscript%3E'); assert.equal(r.status, 400); assert.doesNotMatch(await r.text(), /script/)
  } finally { srv.close() }
})

await caso('tela: 1 .btn-primario, ≤ 6 <th> por tabela, sem hex/emoji/style inline; página e API montadas; item Execução › Comunicação no shell', () => {
  const h = ler('src/web/comunicacao.html'), j = ler('src/web/comunicacao.js'), css = ler('src/web/tela-comunicacao.css'), sv = ler('src/server.js'), sh = ler('src/web/shell.js')
  assert.equal(((h + j).match(/btn-primario/g) || []).length, 1, 'exatamente um .btn-primario')
  for (const t of (h + j).match(/<thead>[\s\S]*?<\/thead>/g) || []) assert.ok((t.match(/<th>/g) || []).length <= 6, 'tabela com mais de 6 colunas')
  for (const [n, s] of [['html', h], ['js', j], ['css', css]]) { assert.doesNotMatch(s, HEX, n + ' com hex'); assert.doesNotMatch(s, EMOJI, n + ' com emoji') }
  assert.doesNotMatch(h + j, /style="/, 'style inline')
  assert.match(sv, /app\.get\('\/comunicacao'/); assert.match(sv, /criarRotasComunicacao\(/)
  assert.match(sh, /\['Execução', \[[^\n]*\['comunicacao', 'Comunicação', '\/comunicacao'\]/, 'item no submenu Execução')
})

console.log(`\n${falhas.length ? '✘' : '✔'} teste-comunicacao: ${ok} de ${ok + falhas.length} verificações passaram`)
process.exit(falhas.length ? 1 : 0)
