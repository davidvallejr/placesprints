// Autoteste da coleta de respostas dos clientes ao relatório (src/lib/respostas-relatorio.js + src/rotas-feedback.js; pedido do David de 13/10/2026): nenhuma rede real —
// o n8n é um fetch stub atrás do criarEnvio de verdade (mesma assinatura x-place-key/HMAC dos gatilhos), banco :memory:, servidor Express efêmero em loopback.
// Cobre: o exemplo REAL da União Dog (só «Vendas, Estoque, reposição, compras» é guardada; «Gi, coloca no Full…» e a imagem não); citação = certa; janela vencida não guarda;
// mensagem nossa nunca; mídia/apagada/figurinha nunca; resposta a outra mensagem nunca; âncora lembrada entre coletas; idempotência (status preservado); jid nunca gravado;
// temas; filtro operacional; rotas (415/403/404/400 sem eco, coletar com stub, lista com resumo, marcação); n8n ausente/erro; grupo compartilhado; prospect; tick diário.
// Achados da revisão (13/10): plano só por citação; conversa operacional realista nunca entra em nenhuma janela; lista curta exige assunto; telefone/menção mascarados;
// descartar = lápide; autor_hash vazio; temas com negação e palavra inteira; várias âncoras abertas (a pergunta vence).
// Rodar: node scripts/teste-respostas-relatorio.mjs
process.env.PS_DB_MEMORIA = '1'           // ANTES dos imports: se algum módulo vizinho abrir db.js, abre :memory:
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { criarEnvio } from '../src/lib/gatilhos-envio.js'
import { criarRespostas, lerConfig, filtrar, tipoAncora, operacional, opiniao, temasDe, validarMensagem, hash16, SCHEMA_FEEDBACK } from '../src/lib/respostas-relatorio.js'
import { criarRotasFeedback } from '../src/rotas-feedback.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const cfg = lerConfig()
const SECRET = 'segredo-de-teste-nunca-impresso-32c', URL_N8N = 'https://n8n.exemplo.test'
const LIDER = 'Líder Teste', SEGREDO = 'SEGREDO_NAO_ECOAR'
const G_UD = '120363041234567890@g.us', AUTOR = '5511987654321@s.whatsapp.net', G_B = '120363099999999999@g.us'
const ts = iso => Math.floor(Date.parse(iso) / 1000)
const msg = (o) => ({ grupo: G_UD, deMim: false, autor: AUTOR, nome: 'Fernanda Souza Lima', tipo: 'conversation', texto: '', cita_id: '', cita_texto: '', ...o })

// o exemplo REAL (União Dog, 12–13/10/2026, horário de Brasília)
const UD = [
  msg({ id: 'A_REL', deMim: true, autor: '', nome: 'Place2u', ts: ts('2026-10-12T13:19:00-03:00'), texto: 'Oie, tudo bem? 👋 Eu sou o *Merovíngio*, o assistente da Place2u. Este é o plano da semana da sua conta no Mercado Livre…' }),
  msg({ id: 'C_GI', ts: ts('2026-10-13T06:37:00-03:00'), texto: 'Bom dia! Gi, coloca no Full esse produto por favor?' }),
  msg({ id: 'C_IMG', ts: ts('2026-10-13T06:37:30-03:00'), tipo: 'imageMessage', texto: '' }),
  msg({ id: 'A_PERG', deMim: true, autor: '', nome: 'Place2u', ts: ts('2026-10-13T08:30:00-03:00'), texto: 'Oi, pessoal! 😊 Uma pergunta rápida para a gente construir o relatório semanal: O que você acha importante receber de informações toda semana?' }),
  msg({ id: 'C_RESP', ts: ts('2026-10-13T08:31:00-03:00'), texto: 'Vendas, Estoque, reposição, compras' }),
]

// n8n stub: devolve { mensagens } por grupo pedido; registra cada chamada
function criarN8n(porGrupo = {}) {
  const chamadas = []
  let resposta = null
  const fetch = async (url, init) => {
    const corpo = JSON.parse(init.body); chamadas.push({ url, headers: init.headers, corpo })
    if (resposta) return resposta
    const mensagens = corpo.grupos.flatMap(g => porGrupo[g] || [])
    return { ok: true, status: 200, json: async () => ({ mensagens }) }
  }
  return { fetch, chamadas, falhar: r => { resposta = r }, porGrupo }
}
function mundo({ grupos = { 'Uniaodog Artigos Pet': G_UD }, porGrupo = { [G_UD]: UD }, env = { PLACE_GATILHOS_URL: URL_N8N, PLACE_GATILHOS_SECRET: SECRET }, agora = '2026-10-13T21:00:00.000Z', extra = {} } = {}) {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT, notificacao_json TEXT)")
  for (const [c, g] of Object.entries(grupos)) h.prepare('INSERT INTO clientes_central VALUES (?,?,?)').run(c, 'Ativo', JSON.stringify({ canais: { whatsapp: { ligado: true, destino: g } } }))
  const n8n = criarN8n(porGrupo), relogio = { t: agora }
  const envio = criarEnvio({ env, fetch: n8n.fetch, agora: () => relogio.t, webhook: { timeout_ms: cfg.webhook.timeout_ms } })
  const validarPor = nome => /^l[ií]der teste$/i.test(String(nome).trim()) ? LIDER : ''
  const r = criarRespostas(h, { cfg, envio, agora: () => relogio.t, validarPor, ...extra })
  return { h, n8n, r, relogio }
}
const todasAsCelulas = h => ['feedback_relatorio', 'feedback_coleta'].flatMap(t => h.prepare(`SELECT * FROM ${t}`).all().flatMap(Object.values)).map(String).join('\n')

// ═════════ 1. o filtro (puro) ═════════════════════════════════════════════════════════════════════════
await ok('União Dog (exemplo real): só «Vendas, Estoque, reposição, compras» é guardada (janela da pergunta, provável); «Gi, coloca no Full…» e a imagem não; 2 âncoras', () => {
  const r = filtrar({ mensagens: UD.map(validarMensagem), cfg })
  assert.deepEqual(r.guardar.map(g => g.m.id), ['C_RESP'])
  assert.deepEqual({ a: r.guardar[0].ancora.id, t: r.guardar[0].ancora.tipo, rel: r.guardar[0].relacao, c: r.guardar[0].confianca }, { a: 'A_PERG', t: 'pergunta', rel: 'janela', c: 'provavel' })
  assert.deepEqual(r.ancoras.map(a => [a.id, a.tipo]), [['A_REL', 'relatorio'], ['A_PERG', 'pergunta']])
  assert.equal(r.lidas, 5); assert.equal(r.ignoradas, 4)
  assert.deepEqual(temasDe('Vendas, Estoque, reposição, compras', cfg), ['vendas', 'estoque_reposicao', 'compras'])
})
await ok('âncoras: plano (Merovíngio / Place Sprints) e pergunta (começo), sem depender de acento, caixa ou emoji; mensagem de cliente com essas palavras não é âncora', () => {
  assert.equal(tipoAncora('Oi, pessoal! 😊 Uma pergunta rápida para a gente…', cfg), 'pergunta')
  assert.equal(tipoAncora('oi pessoal!! uma pergunta rapida: o que…', cfg), 'pergunta')
  assert.equal(tipoAncora('Plano da semana — Place Sprints', cfg), 'relatorio'); assert.equal(tipoAncora('o merovingio separou 3 pontos', cfg), 'relatorio')
  assert.equal(tipoAncora('Uma pergunta rápida: oi, pessoal', cfg), '', 'a pergunta tem de COMEÇAR com o padrão'); assert.equal(tipoAncora('Bom dia, tudo bem?', cfg), '')
  const r = filtrar({ mensagens: [msg({ id: 'X1', ts: 100, texto: 'Esse Merovíngio é bom, gostei do relatório' }), msg({ id: 'X2', ts: 200, texto: 'Vendas e estoque' })].map(validarMensagem), cfg })
  assert.deepEqual(r.ancoras, []); assert.deepEqual(r.guardar, [], 'sem âncora nossa nada é guardado')
})
await ok('citação = certa (mesmo dias depois e sem vocabulário); resposta citando outra mensagem (não âncora) nunca, nem dentro da janela', () => {
  const base = UD.map(validarMensagem)
  const r = filtrar({ mensagens: [...base,
    msg({ id: 'C_CIT', ts: ts('2026-10-16T10:00:00-03:00'), tipo: 'extendedTextMessage', texto: 'Achei confuso', cita_id: 'A_REL', cita_texto: 'Oie…' }),
    msg({ id: 'C_OUTRA', ts: ts('2026-10-13T08:32:00-03:00'), tipo: 'extendedTextMessage', texto: 'Vendas e estoque, pode ser', cita_id: 'C_GI' })].map(validarMensagem), cfg })
  const g = Object.fromEntries(r.guardar.map(x => [x.m.id, x]))
  assert.deepEqual(Object.keys(g).sort(), ['C_CIT', 'C_RESP'])
  assert.deepEqual([g.C_CIT.relacao, g.C_CIT.confianca, g.C_CIT.ancora.tipo], ['citou', 'certa', 'relatorio'])
  assert.deepEqual(temasDe('Achei confuso', cfg), ['critica'])
})
await ok('janela vencida não guarda (pergunta 12 h desde 14/10; plano só por citação); dentro da janela da pergunta a resposta fica com ela', () => {
  const r = filtrar({ mensagens: [...UD, msg({ id: 'C_TARDE', ts: ts('2026-10-13T21:31:00-03:00'), texto: 'Vendas e estoque' }), msg({ id: 'C_REL', ts: ts('2026-10-13T12:00:00-03:00'), texto: 'Gostei do relatório da semana' })].map(validarMensagem), cfg })
  const ids = r.guardar.map(g => g.m.id)
  assert.ok(!ids.includes('C_TARDE'), '13 h depois da pergunta'); assert.ok(ids.includes('C_REL'))
  assert.equal(r.guardar.find(g => g.m.id === 'C_REL').ancora.id, 'A_PERG', '12:00 ainda está na janela da pergunta (08:30 + 12 h)')
  // 14/10: o relatório focado («Aqui é o Merovíngio» + pergunta no fim) é âncora de PERGUNTA; o semanal («Eu sou o Merovíngio») continua só por citação
  assert.equal(tipoAncora('Oie, tudo bem? 👋\n\nAqui é o *Merovíngio*, a inteligência do *Place Sprints* da Place2u. Trouxe um resumo rápido', cfg), 'pergunta')
  assert.equal(tipoAncora('Oie, tudo bem? 👋\n\nEu sou o *Merovíngio*, a inteligência do *Place Sprints* da Place2u.', cfg), 'relatorio')
  const soPlano = filtrar({ mensagens: [UD[0], msg({ id: 'C_P', ts: ts('2026-10-13T12:00:00-03:00'), texto: 'Gostei do relatório' }), msg({ id: 'C_P2', ts: ts('2026-10-13T13:20:00-03:00'), texto: 'Gostei do relatório' })].map(validarMensagem), cfg })
  assert.deepEqual(soPlano.guardar, [], 'plano: sem janela, só citação')
  const lista = filtrar({ mensagens: [UD[0], msg({ id: 'C_L', ts: ts('2026-10-12T14:00:00-03:00'), texto: 'Azul, verde' })].map(validarMensagem), cfg })
  assert.deepEqual(lista.guardar, [], 'lista curta sem vocabulário só vale na janela da PERGUNTA')
})
await ok('mensagem nossa nunca (nem citando a âncora); mídia, apagada, figurinha, texto vazio nunca — nem citando', () => {
  const extra = [
    msg({ id: 'M_NOSSA', deMim: true, ts: ts('2026-10-13T08:35:00-03:00'), texto: 'Vendas, estoque e compras, anotado!' }),
    msg({ id: 'M_NOSSA_CIT', deMim: true, ts: ts('2026-10-13T08:36:00-03:00'), tipo: 'extendedTextMessage', texto: 'Gostei da ideia', cita_id: 'A_PERG' }),
    msg({ id: 'M_IMG', ts: ts('2026-10-13T08:37:00-03:00'), tipo: 'imageMessage', texto: 'Vendas e estoque', cita_id: 'A_PERG' }),
    msg({ id: 'M_VID', ts: ts('2026-10-13T08:38:00-03:00'), tipo: 'videoMessage', texto: 'Gostei do relatório' }),
    msg({ id: 'M_STK', ts: ts('2026-10-13T08:39:00-03:00'), tipo: 'stickerMessage', texto: '' }),
    msg({ id: 'M_DEL', ts: ts('2026-10-13T08:40:00-03:00'), tipo: 'protocolMessage', texto: 'Gostei' }),
    msg({ id: 'M_VAZIO', ts: ts('2026-10-13T08:41:00-03:00'), tipo: 'conversation', texto: '   ', cita_id: 'A_PERG' }),
  ]
  const r = filtrar({ mensagens: [...UD, ...extra].map(validarMensagem), cfg })
  assert.deepEqual(r.guardar.map(g => g.m.id), ['C_RESP'])
  assert.equal(validarMensagem({ id: '', ts: 1 }), null); assert.equal(validarMensagem({ id: 'x', ts: 'abc' }), null); assert.equal(validarMensagem(null), null)
  assert.equal(validarMensagem({ id: 'x', ts: 1760000000000, deMim: 'true' }).deMim, false, 'deMim só com true literal'); assert.equal(validarMensagem({ id: 'x', ts: 1760000000000 }).ts, 1760000000, 'ms por engano vira s')
})
await ok('operacional × opinião: vocativo, pedido + produto/link/MLB, só link e «Olha o que eu encontrei!» nunca; pedido sem produto com vocabulário passa', () => {
  for (const t of ['Bom dia! Gi, coloca no Full esse produto por favor?', 'Gi, tudo certo com o relatório?', 'Ana: gostei do relatório', '@5511987654321 vê as vendas',
    'Olha o que eu encontrei! https://produto.mercadolivre.com.br/MLB-123', 'https://produto.mercadolivre.com.br/MLB-123', 'Pode subir o MLB-123456 hoje? Vendas caíram',
    'Pode trocar a foto desse produto? Vendas caíram', 'Consegue mandar o link? https://x.test/a vendas']) assert.equal(operacional(t, cfg), true, t)
  for (const t of ['Vendas, Estoque, reposição, compras', 'Pode mandar vendas e estoque toda semana', 'Ótimo, gostei do relatório', 'Sim, quero receber previsão de estoque',
    'Top! Ajuda muito', 'Pessoal, achei útil']) assert.equal(operacional(t, cfg), false, t)
  assert.equal(opiniao('Bom dia, tudo bem?', 'relatorio', cfg), false, 'saudação não é opinião («bom» de «bom dia» não conta)')
  assert.equal(opiniao('Ok, obrigado', 'pergunta', cfg), false, '«Ok, obrigado» não é lista de interesses')
  assert.equal(opiniao('Margem, giro', 'pergunta', cfg), true); assert.equal(opiniao('Margem, giro', 'relatorio', cfg), false, 'palavra da operação dá tema, nunca prova opinião')
  assert.equal(opiniao('Curva ABC, giro', 'pergunta', cfg), true, 'lista curta na pergunta'); assert.equal(opiniao('Curva ABC, giro', 'relatorio', cfg), false)
})
await ok('temas determinísticos (ordem do config): crítica tira o «gostei» de «não gostei»; dúvida por «?»; elogio; formato; vazio = []', () => {
  assert.deepEqual(temasDe('Não gostei, muito longo', cfg), ['critica'])
  assert.deepEqual(temasDe('Gostei! Queria ver margem e previsão de estoque', cfg), ['estoque_reposicao', 'margem_custos', 'previsao', 'elogio'])
  assert.deepEqual(temasDe('Como funciona o ACOS?', cfg), ['ads', 'duvida'])
  assert.deepEqual(temasDe('Pode ser semanal, em PDF, com o Full e as promoções', cfg), ['full', 'preco_promocao', 'formato_frequencia'])
  assert.deepEqual(temasDe('Frete e concorrentes, top demais', cfg), ['logistica', 'concorrencia', 'elogio'])
  assert.deepEqual(temasDe('Bom dia', cfg), [])
  for (const t of Object.keys(cfg.temas)) assert.ok(['vendas', 'estoque_reposicao', 'compras', 'full', 'logistica', 'anuncios', 'ads', 'preco_promocao', 'concorrencia', 'margem_custos', 'previsao', 'formato_frequencia', 'elogio', 'critica', 'duvida'].includes(t), t)
})

// ═════════ 1b. achados da revisão (13/10) ══════════════════════════════════════════════════════════════
const OPERACIONAIS = ['Pode subir o preço do tapete para 89,90?', 'O estoque do kit azul já chegou no Full?', 'Coloca no Full esse por favor', 'Bom dia, a promoção da black friday já está ativa?',
  'Recebi a nota do fornecedor, vou mandar a planilha de compras', 'Semana que vem estou de férias, qualquer coisa falem com a Ana no 13 99999-8888', 'Tapete azul, tamanho G',
  'Bom dia! Coloca no Full esse por favor?', 'Bom dia! 😊 Gi, coloca no Full esse por favor?', 'Gi bom dia, coloca no full esse por favor', 'Chegou estoque novo hoje', 'Enviei pro full hoje cedo',
  'Preciso de ajuda com a nota fiscal do pedido', 'Queria saber se o boleto já foi pago', 'Vou receber a mercadoria amanhã', 'Semana que vem mando as notas',
  'Boa tarde, a promoção do dia das crianças já está ativa?', 'Bom, vou verificar aqui', 'Pode baixar o preço daquele tapete?', 'Sobe o anúncio novo hoje?',
  'Bom dia @5511987654321 coloca no Full esse por favor', 'Oi @5511987654321, as vendas caíram, o que houve?', 'Achei ótimo o relatório, @5513999998888 me liga depois',
  'Bom dia, Gi', 'Ok, vou ver', 'Bom dia, enviei a nota fiscal', 'Obrigada, já paguei o boleto', 'Pessoal, reunião amanhã às 10h', 'Fernanda aqui, chegou a mercadoria', 'Bom dia, chegou a mercadoria']
await ok('conversa operacional realista (achados 1/5/6/7) não é guardada nem 1 h depois do plano nem 1 h depois da pergunta; a resposta real continua guardada', () => {
  for (const anc of [UD[0], UD[3]]) {
    const r = filtrar({ mensagens: [anc, ...OPERACIONAIS.map((t, i) => msg({ id: 'OP' + i, ts: anc.ts + 3600, texto: t }))].map(validarMensagem), cfg })
    assert.deepEqual(r.guardar.map(g => g.m.texto), [], `âncora ${anc.id}`)
  }
  for (const t of ['Bom dia! 😊 Gi, coloca no Full esse por favor?', 'Gi bom dia, coloca no full esse por favor', 'Oi @5511987654321, as vendas caíram, o que houve?', 'Achei ótimo o relatório, @5513999998888 me liga depois', 'Coloca no Full esse por favor'])
    assert.equal(operacional(t, cfg), true, t)
  const bons = ['Vendas, Estoque, reposição, compras', 'Curva ABC, giro', 'Acho importante saber vendas e estoque', 'Pode mandar vendas e estoque toda semana', 'Gostei do relatório da semana']
  const r = filtrar({ mensagens: [UD[3], ...bons.map((t, i) => msg({ id: 'OK' + i, ts: UD[3].ts + 600, texto: t }))].map(validarMensagem), cfg })
  assert.deepEqual(r.guardar.map(g => g.m.texto), bons)
})
await ok('várias âncoras abertas (achado 9): pergunta 08:30, plano 09:00, lista 09:05 → guardada com a pergunta', () => {
  const r = filtrar({ mensagens: [UD[3], msg({ id: 'A_REL2', deMim: true, ts: ts('2026-10-13T09:00:00-03:00'), texto: 'Plano da semana do Merovíngio' }),
    msg({ id: 'C_L2', ts: ts('2026-10-13T09:05:00-03:00'), texto: 'Curva ABC, giro de produtos' })].map(validarMensagem), cfg })
  assert.deepEqual(r.guardar.map(g => [g.m.id, g.ancora.id]), [['C_L2', 'A_PERG']])
})
await ok('temas (achado 8): negação vira crítica, não elogio; raízes curtas só casam a palavra inteira', () => {
  for (const [t, esperado] of [['Não achei útil', ['critica']], ['Nada útil', ['critica']], ['Não é bom', ['critica']], ['Nem útil', []], ['Ele enviou ontem', []], ['Vou reportar', []],
    ['Já estou acostumado', []], ['Vou utilizar', []], ['Metade chegou', []], ['A mensalidade', []], ['Muito útil', ['elogio']], ['Frete e envio', ['logistica']], ['Bater a meta', ['previsao']]])
    assert.deepEqual(temasDe(t, cfg), esperado, t)
})
await ok('privacidade (achados 2/4/7): menção @número e telefone digitado mascarados no texto guardado; autor_hash vazio', async () => {
  const { h, r } = mundo({ porGrupo: { [G_UD]: [...UD, msg({ id: 'C_FONE', ts: ts('2026-10-13T10:00:00-03:00'), tipo: 'extendedTextMessage', cita_id: 'A_REL',
    texto: '@5513988887777 gostei do plano, falem com a Ana no 13 99999-8888 ou +55 (11) 98765-4321' })] } })
  await r.coletar({ por: LIDER })
  const l = h.prepare("SELECT texto, autor_hash FROM feedback_relatorio WHERE msg_id = 'C_FONE'").get()
  assert.deepEqual(l, { texto: '@… gostei do plano, falem com a Ana no [telefone] ou [telefone]', autor_hash: '' })
  assert.ok(!/\d{4}/.test(todasAsCelulas(h).split('\n').filter(x => x.includes('Ana')).join()), 'nenhum número no texto')
  assert.ok(!JSON.stringify(r.listar()).includes('98888'), 'nem na lista')
})
await ok('descartar = lápide (achado 3): texto, 1º nome e temas apagados; a próxima coleta não regrava; descartada não volta', async () => {
  const { h, r } = mundo()
  await r.coletar({ por: LIDER }); r.marcar({ msg_id: 'C_RESP', status: 'descartado', por: LIDER })
  assert.deepEqual(h.prepare('SELECT texto, autor_nome, autor_hash, temas_json, status FROM feedback_relatorio').get(), { texto: '', autor_nome: '', autor_hash: '', temas_json: '[]', status: 'descartado' })
  assert.equal((await r.coletar({ por: LIDER })).guardadas, 0); assert.equal(h.prepare("SELECT texto FROM feedback_relatorio WHERE msg_id = 'C_RESP'").get().texto, '', 'recoleta não recoloca o texto')
  assert.throws(() => r.marcar({ msg_id: 'C_RESP', status: 'novo', por: LIDER }), e => e.status === 409)
  assert.ok(!todasAsCelulas(h).includes('Vendas, Estoque'))
})

// ═════════ 2. coleta com o n8n (stub) e o banco ══════════════════════════════════════════════════════
await ok('coleta: POST assinado a /webhook/place-respostas com { grupos, paginas } e x-place-key; grava 1 linha com hashes, 1º nome, temas e âncora; jid/participante/telefone nunca gravados', async () => {
  const { h, n8n, r } = mundo()
  const out = await r.coletar({ por: 'líder teste' })
  assert.deepEqual({ ok: out.ok, lidas: out.lidas, guardadas: out.guardadas, ignoradas: out.ignoradas }, { ok: true, lidas: 5, guardadas: 1, ignoradas: 4 })
  assert.deepEqual(out.por_cliente, [{ cliente: 'Uniaodog Artigos Pet', estado: 'ok', lidas: 5, guardadas: 1, repetidas: 0, ignoradas: 4 }])
  assert.equal(n8n.chamadas.length, 1); const c = n8n.chamadas[0]
  assert.equal(c.url, URL_N8N + '/webhook/place-respostas'); assert.equal(c.headers['x-place-key'], SECRET); assert.match(c.headers['x-place-sig'], /^[0-9a-f]{64}$/)
  assert.deepEqual(c.corpo, { grupos: [G_UD], paginas: cfg.webhook.paginas })
  const l = h.prepare('SELECT * FROM feedback_relatorio').all(); assert.equal(l.length, 1)
  assert.deepEqual({ ...l[0], coletado_em: 'x' }, { msg_id: 'C_RESP', cliente: 'Uniaodog Artigos Pet', grupo_hash: hash16(G_UD), autor_hash: '', autor_nome: 'Fernanda', texto: 'Vendas, Estoque, reposição, compras',
    recebido_em: '2026-10-13T11:31:00.000Z', ancora_id: 'A_PERG', ancora_tipo: 'pergunta', relacao: 'janela', confianca: 'provavel', temas_json: '["vendas","estoque_reposicao","compras"]', status: 'novo', nota_interna: '', status_por: '', status_em: '', coletado_em: 'x', origem: 'whatsapp' })
  const tudo = todasAsCelulas(h)
  for (const proibido of [G_UD, AUTOR, hash16(AUTOR), '987654321', '120363041234567890', 'Gi, coloca', 'Souza']) assert.ok(!tudo.includes(proibido), `nunca gravado: ${proibido}`)
  assert.ok(!JSON.stringify(out).includes('@g.us') && !JSON.stringify(out).includes('coloca'), 'resposta sem jid e sem texto ignorado')
  const col = h.prepare('SELECT * FROM feedback_coleta').get()
  assert.equal(col.ultimo_ts, ts('2026-10-13T08:31:00-03:00')); assert.deepEqual(JSON.parse(col.ancoras_json).map(a => [a.id, a.tipo, a.g]), [['A_PERG', 'pergunta', hash16(G_UD)], ['A_REL', 'relatorio', hash16(G_UD)]])
})
await ok('idempotência: recoletar não duplica nem apaga a marcação da equipe; âncora lembrada entre coletas (a resposta chega quando a âncora já saiu da página)', async () => {
  const { h, n8n, r, relogio } = mundo()
  await r.coletar({ por: LIDER }); r.marcar({ msg_id: 'C_RESP', status: 'implementar', nota: 'virar bloco de reposição', por: LIDER })
  const out = await r.coletar({ por: LIDER })
  assert.deepEqual([out.guardadas, out.repetidas], [0, 1]); assert.equal(h.prepare('SELECT COUNT(*) n FROM feedback_relatorio').get().n, 1)
  assert.deepEqual(h.prepare('SELECT status, nota_interna, status_por FROM feedback_relatorio').get(), { status: 'implementar', nota_interna: 'virar bloco de reposição', status_por: LIDER })
  // dia seguinte: a página só traz a citação ao plano e uma resposta à pergunta já fora da janela — a âncora vem do feedback_coleta
  relogio.t = '2026-10-15T21:00:00.000Z'
  n8n.porGrupo[G_UD] = [msg({ id: 'C_DEPOIS', ts: ts('2026-10-15T09:00:00-03:00'), tipo: 'extendedTextMessage', texto: 'Faltou a previsão de compras', cita_id: 'A_REL' }), msg({ id: 'C_FORA', ts: ts('2026-10-15T09:01:00-03:00'), texto: 'Vendas e estoque' })]
  const o2 = await r.coletar({ por: LIDER }); assert.equal(o2.guardadas, 1)
  assert.deepEqual(h.prepare("SELECT relacao, confianca, ancora_tipo, temas_json FROM feedback_relatorio WHERE msg_id = 'C_DEPOIS'").get(), { relacao: 'citou', confianca: 'certa', ancora_tipo: 'relatorio', temas_json: '["compras","previsao","critica"]' })
})
await ok('honestidade: sem PLACE_GATILHOS_URL/SECRET = pendente n8n_nao_configurado e nenhuma chamada; erro do n8n = falhou n8n_<status>; corpo sem lista = n8n_resposta_invalida; nada gravado', async () => {
  const a = mundo({ env: {} })
  assert.deepEqual(await a.r.coletar({ por: LIDER }), { ok: false, estado: 'pendente', motivo: 'n8n_nao_configurado', lidas: 0, guardadas: 0, repetidas: 0, ignoradas: 0, por_cliente: [] }); assert.equal(a.n8n.chamadas.length, 0)
  const b = mundo(); b.n8n.falhar({ ok: false, status: 500 })
  const o = await b.r.coletar({ por: LIDER }); assert.equal(o.ok, false); assert.deepEqual(o.por_cliente, [{ cliente: 'Uniaodog Artigos Pet', estado: 'falhou', motivo: 'n8n_500' }])
  b.n8n.falhar({ ok: true, status: 200, json: async () => ({ outra: 1 }) }); assert.equal((await b.r.coletar({ por: LIDER })).por_cliente[0].motivo, 'n8n_resposta_invalida')
  b.n8n.falhar({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } }); assert.equal((await b.r.coletar({ por: LIDER })).por_cliente[0].motivo, 'n8n_resposta_invalida')
  assert.equal(b.h.prepare('SELECT COUNT(*) n FROM feedback_relatorio').get().n, 0); assert.equal(b.h.prepare('SELECT COUNT(*) n FROM feedback_coleta').get().n, 0, 'falha não marca a coleta como feita')
  await assert.rejects(b.r.coletar({ por: 'Fulano' }), e => e.status === 403)
})
await ok('isolamento: mensagem de grupo que não foi pedido é descartada; grupo de 2 clientes não é lido; prospect «[Comercial] …» nunca; cliente sem grupo informado', async () => {
  const { h, n8n, r } = mundo({ grupos: { 'Uniaodog Artigos Pet': G_UD, 'Cliente B': G_B, 'Cliente C': G_B, '[Comercial] Lead X': '120363000000000001@g.us', 'Sem Grupo': '5511999999999' },
    porGrupo: { [G_UD]: [...UD, msg({ id: 'INTRUSA', grupo: '120363000000000001@g.us', ts: ts('2026-10-13T08:32:00-03:00'), texto: 'Vendas e estoque' })], [G_B]: UD.map(m => ({ ...m, grupo: G_B, id: 'B_' + m.id })) } })
  const out = await r.coletar({ por: LIDER })
  assert.deepEqual(n8n.chamadas.map(c => c.corpo.grupos), [[G_UD]], 'só o grupo exclusivo de um cliente vai ao n8n (prospect e grupo compartilhado fora; destino que não é @g.us fora)')
  assert.deepEqual(out.por_cliente.map(p => [p.cliente, p.estado, p.motivo || '']).sort(), [['Cliente B', 'ignorado', 'grupo_compartilhado'], ['Cliente C', 'ignorado', 'grupo_compartilhado'], ['Uniaodog Artigos Pet', 'ok', '']])
  assert.deepEqual(h.prepare('SELECT msg_id FROM feedback_relatorio').all().map(x => x.msg_id), ['C_RESP'])
  const so = await r.coletar({ por: LIDER, clientes: ['Sem Grupo'] }); assert.deepEqual(so.por_cliente, [{ cliente: 'Sem Grupo', estado: 'ignorado', motivo: 'sem_grupo_ml' }])
})
await ok('tick diário: sem n8n não roda; antes das 18:00 não roda; 1×/dia; nunca coletado entra; âncora/plano > 14 dias fica de fora; plano enviado (gatilho_lote) reabre a janela', async () => {
  assert.equal((await mundo({ env: {} }).r.tick({ agoraMs: Date.parse('2026-10-13T22:00:00Z') })).motivo, 'n8n_nao_configurado')
  let envio = ''
  const { r, n8n } = mundo({ extra: { ultimoEnvio: () => envio } })
  assert.equal((await r.tick({ agoraMs: Date.parse('2026-10-13T20:59:00Z') })).motivo, 'fora_da_hora', '17:59 em São Paulo')
  const t1 = await r.tick({ agoraMs: Date.parse('2026-10-13T21:00:00Z') }); assert.equal(t1.rodou, true); assert.equal(t1.guardadas, 1); assert.equal(n8n.chamadas.length, 1)
  assert.equal((await r.tick({ agoraMs: Date.parse('2026-10-13T23:00:00Z') })).motivo, 'ja_rodou_hoje')
  assert.equal((await r.tick({ agoraMs: Date.parse('2026-10-26T21:00:00Z') })).rodou, true, '13 dias depois da pergunta ainda coleta')
  assert.equal((await r.tick({ agoraMs: Date.parse('2026-10-28T21:00:00Z') })).motivo, 'sem_ancora_recente', '15 dias depois: parou')
  envio = '2026-10-27T12:00:00.000Z'
  assert.equal((await r.tick({ agoraMs: Date.parse('2026-10-29T21:00:00Z') })).rodou, true, 'o plano de terça saiu: volta a coletar')
})

// ═════════ 3. rotas HTTP (servidor efêmero em loopback) ═══════════════════════════════════════════
await ok('rotas: coletar (415/403/404/400 sem eco; lista de clientes), GET /api/feedback (resumo por tema/cliente/status, filtros), POST status (403/400/404/200)', async () => {
  const { r, n8n } = mundo({ grupos: { 'Uniaodog Artigos Pet': G_UD, 'Cliente B': G_B }, porGrupo: { [G_UD]: UD, [G_B]: [] } })
  const canon = c => ({ 'uniaodog artigos pet': 'Uniaodog Artigos Pet', 'cliente b': 'Cliente B' })[String(c).toLowerCase()] || ''
  const app = express(); app.use(express.json()); app.use(criarRotasFeedback({ respostas: r, quem: () => [LIDER], clienteCanonico: canon }))
  app.use((e, req, res, _n) => res.status(500).json({ erro: 'erro interno' }))
  const srv = app.listen(0, '127.0.0.1'); await new Promise(ok => srv.once('listening', ok))
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = (u, b, tipo = 'application/json') => fetch(base + u, { method: 'POST', headers: { 'content-type': tipo }, body: typeof b === 'string' ? b : JSON.stringify(b) }).then(async x => ({ st: x.status, j: await x.json() }))
  const get = u => fetch(base + u).then(async x => ({ st: x.status, j: await x.json() }))
  try {
    assert.equal((await post('/api/feedback/coletar', 'por=x', 'text/plain')).st, 415)
    const s403 = await post('/api/feedback/coletar', { por: SEGREDO }); assert.equal(s403.st, 403); assert.ok(!JSON.stringify(s403.j).includes(SEGREDO))
    const s404 = await post('/api/feedback/coletar', { por: LIDER, clientes: [SEGREDO] }); assert.equal(s404.st, 404); assert.ok(!JSON.stringify(s404.j).includes(SEGREDO))
    assert.equal((await post('/api/feedback/coletar', { por: LIDER, clientes: ['[Comercial] Uniaodog Artigos Pet'] })).st, 404, 'prospect nunca')
    assert.equal((await post('/api/feedback/coletar', { por: LIDER, clientes: 'Cliente B' })).st, 400); assert.equal((await post('/api/feedback/coletar', { por: LIDER, clientes: [] })).st, 400)
    assert.equal(n8n.chamadas.length, 0, 'nada chamou o n8n até aqui')
    const so = await post('/api/feedback/coletar', { por: LIDER, clientes: ['cliente b'] }); assert.equal(so.st, 200); assert.deepEqual(n8n.chamadas.at(-1).corpo.grupos, [G_B], 'a lista restringe os grupos')
    const c = await post('/api/feedback/coletar', { por: LIDER }); assert.equal(c.st, 200)
    assert.deepEqual([c.j.ok, c.j.lidas, c.j.guardadas, c.j.ignoradas], [true, 5, 1, 4]); assert.ok(!JSON.stringify(c.j).includes('@g.us'), 'sem jid')
    const l = await get('/api/feedback'); assert.equal(l.st, 200)
    assert.equal(l.j.total, 1); assert.deepEqual(Object.keys(l.j.itens[0]).sort(), ['ancora_tipo', 'autor_nome', 'cliente', 'confianca', 'msg_id', 'nota_interna', 'origem', 'recebido_em', 'relacao', 'status', 'status_em', 'status_por', 'temas', 'texto'])
    assert.deepEqual([l.j.resumo.por_tema.vendas, l.j.resumo.por_tema.compras, l.j.resumo.por_tema.ads], [1, 1, 0]); assert.deepEqual(l.j.resumo.por_cliente, [{ cliente: 'Uniaodog Artigos Pet', n: 1 }])
    assert.deepEqual(l.j.coleta, { configurado: true, ultima: '2026-10-13T21:00:00.000Z', clientes_lidos: 2, clientes_com_grupo: 2 }); assert.deepEqual(l.j.quem, [LIDER])
    assert.equal((await get('/api/feedback?tema=ads')).j.total, 1, 'o total é do recorte de status'); assert.equal((await get('/api/feedback?tema=ads')).j.itens.length, 0)
    assert.equal((await get('/api/feedback?tema=vendas')).j.itens.length, 1)
    const t400 = await get('/api/feedback?tema=' + SEGREDO); assert.equal(t400.st, 400); assert.ok(!JSON.stringify(t400.j).includes(SEGREDO))
    assert.equal((await get('/api/feedback?status=' + SEGREDO)).st, 400); assert.equal((await get('/api/feedback?cliente=' + SEGREDO)).st, 404)
    assert.equal((await post('/api/feedback/status', { msg_id: 'C_RESP', status: 'implementar', por: SEGREDO })).st, 403)
    assert.equal((await post('/api/feedback/status', { msg_id: 'C_RESP', status: SEGREDO, por: LIDER })).st, 400)
    const nf = await post('/api/feedback/status', { msg_id: SEGREDO, status: 'revisado', por: LIDER }); assert.equal(nf.st, 404); assert.ok(!JSON.stringify(nf.j).includes(SEGREDO))
    assert.equal((await post('/api/feedback/status', { msg_id: 'C_RESP', status: 'revisado', nota: { x: 1 }, por: LIDER })).st, 400)
    assert.deepEqual((await post('/api/feedback/status', { msg_id: 'C_RESP', status: 'descartado', nota: 'pedido ao consultor', por: 'líder teste' })).j, { ok: true, msg_id: 'C_RESP', status: 'descartado' })
    assert.equal((await get('/api/feedback')).j.total, 0, 'descartada sai da lista padrão')
    const lap = (await get('/api/feedback?status=descartado')).j.itens[0]
    assert.deepEqual([lap.nota_interna, lap.texto, lap.autor_nome, lap.temas], ['pedido ao consultor', '', '', []], 'lápide: nota fica, texto/nome/temas apagados')
    assert.equal((await post('/api/feedback/status', { msg_id: 'C_RESP', status: 'revisado', por: LIDER })).st, 409, 'descartada não volta')
  } finally { srv.close() }
})
await ok('schema: idempotente (2× no mesmo banco) e CHECKs fechados', () => {
  const h = new Database(':memory:'); h.exec(SCHEMA_FEEDBACK); h.exec(SCHEMA_FEEDBACK)
  assert.throws(() => h.prepare("INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, coletado_em) VALUES ('a','c','g','t','r','x','outro','janela','provavel','e')").run(), /CHECK/)
  assert.throws(() => h.prepare("INSERT INTO feedback_relatorio (msg_id, cliente, grupo_hash, texto, recebido_em, ancora_id, ancora_tipo, relacao, confianca, status, coletado_em) VALUES ('a','c','g','t','r','x','pergunta','janela','provavel','lixo','e')").run(), /CHECK/)
})


// resposta real da Agrinorte (13/10): remete ao relatório («você mencionou», «não foi mencionado») — entra; pedidos ao consultor seguem fora
{
  const R = await import('../src/lib/respostas-relatorio.js'); const cfgR = R.lerConfig()
  for (const t of ['estatistica de vendas , anuncios com estoque baixo... anuncio q nao ta performando.... tudo isso q vc mencionou acima', 'agora o item q vendeu muito nao foi mencionado repor estoque : Pistao 170']) { assert.equal(R.operacional(t, cfgR), false, t); assert.equal(R.opiniao(t, 'pergunta', cfgR), true, t) }
  for (const t of ['Gi, coloca no Full esse produto por favor?', 'O preço ficou acima do concorrente?', 'Bom dia, Gi']) assert.equal(!R.operacional(t, cfgR) && R.opiniao(t, 'pergunta', cfgR), false, t)
  console.log('✔ resposta que remete ao relatório (mencionou/mencionado) entra; pedido e frase solta não')
}
console.log(`\n✔ teste-respostas-relatorio: ${n} casos passaram`)
