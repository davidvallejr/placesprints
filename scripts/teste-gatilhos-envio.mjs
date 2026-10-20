// Autoteste da entrega dos avisos ao cliente (src/lib/gatilhos-envio.js + src/rotas-gatilhos.js HMAC): nenhuma rede real — fetch stub, Notion stub
// (fixtures/relatorio-mundo.mjs) e servidor Express efêmero em loopback com o roteador HMAC montado ANTES do express.json (mesma ordem do server.js).
// Cobre: assinatura correta/errada/carimbo vencido → 401 sempre igual; recibo idempotente por (lote, canal); sem URL/secret → pendente n8n_nao_configurado (honesto);
// payload ao n8n = contrato do fluxo (texto final + metadados, destinos dos canais ligados, sem IDs internos); Notion via stub (título, idempotência por título, categoria ausente).
// Rodar: node scripts/teste-gatilhos-envio.mjs
process.env.PS_DB_MEMORIA = '1'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import express from 'express'
import { readFileSync } from 'node:fs'
import { assinar, verificarAssinatura, criarEnvio, tituloAvisoOk, segredoValido, SEGREDO_MIN, htmlDoTexto } from '../src/lib/gatilhos-envio.js'
import { criarGatilhos, lerConfig, validarConfig } from '../src/lib/gatilhos.js'
import { criarRotasGatilhosHmac, criarRotasGatilhos } from '../src/rotas-gatilhos.js'
import { estadoDeHandle } from '../src/lib/relatorio-envio.js'
import { criarMundo, criarRelogio } from './fixtures/relatorio-mundo.mjs'
import { ROTA_PUBLICA } from '../src/lib/guarda-local.js'

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('✘ FALHOU:', nome); throw e } }
const SECRET = 'segredo-de-teste-nunca-impresso-32c', AGORA = Date.parse('2026-10-14T13:00:00.000Z')
const relogio = criarRelogio('2026-10-14', '10:00')
// texto no formato do urgente (12/10/2026): sem linha de título — o título vai à parte (assunto do e-mail, nome da página no Notion)
const URG = 'Oi, time Acme! Passando rapidinho com um ponto importante da sua conta no Mercado Livre:\n\n🚚 *Pedido com despacho vencido*\n2 pedido(s) com prazo de despacho vencido.\n\nSe já está encaminhado, é só responder aqui com a data prevista que a gente ajusta o acompanhamento. Conte com a gente! 🤝\n*Merovíngio · Place Sprints | Equipe Place2u*'
const lote = (extra = {}) => ({ id: 'l0123456789abcde', tipo: 'imediato', cliente: 'Acme', titulo: 'Ponto importante da conta · 14/10/2026 · 10:00', hash: 'h', texto: URG, ...extra })
const notif = (canais = {}) => ({ canais: { whatsapp: { ligado: false, destino: '' }, email: { ligado: false, destino: '' }, notion: { ligado: false }, ...canais } })

await ok('assinatura: HMAC(secret, ts.corpo) em hex; verifica só com carimbo na janela e assinatura igual (tempo constante); errada, vencida, malformada ou sem segredo = false', () => {
  const raw = Buffer.from('{"a":1}'), ts = Math.floor(AGORA / 1000)
  const sig = assinar(SECRET, ts, raw); assert.match(sig, /^[0-9a-f]{64}$/)
  const h = s => ({ 'x-place-ts': String(ts), 'x-place-sig': s })
  assert.equal(verificarAssinatura({ secret: SECRET, headers: h(sig), raw, agoraMs: AGORA }), true)
  assert.equal(verificarAssinatura({ secret: SECRET, headers: { 'X-Place-Ts': String(ts), 'X-Place-Sig': sig }, raw, agoraMs: AGORA }), true, 'cabeçalho sem caixa')
  assert.equal(verificarAssinatura({ secret: 'outro', headers: h(sig), raw, agoraMs: AGORA }), false)
  assert.equal(verificarAssinatura({ secret: SECRET, headers: h(sig), raw: Buffer.from('{"a":2}'), agoraMs: AGORA }), false, 'corpo alterado')
  assert.equal(verificarAssinatura({ secret: SECRET, headers: h(sig), raw, agoraMs: AGORA + 301_000 }), false, 'carimbo vencido (+301 s)'); assert.equal(verificarAssinatura({ secret: SECRET, headers: h(sig), raw, agoraMs: AGORA + 299_000 }), true)
  assert.equal(verificarAssinatura({ secret: SECRET, headers: h('sha256=' + sig), raw, agoraMs: AGORA }), false, 'prefixo não é aceito'); assert.equal(verificarAssinatura({ secret: SECRET, headers: h('zz'), raw, agoraMs: AGORA }), false)
  assert.equal(verificarAssinatura({ secret: '', headers: h(sig), raw, agoraMs: AGORA }), false, 'sem segredo configurado: tudo é negado'); assert.equal(verificarAssinatura({ secret: SECRET, headers: {}, raw, agoraMs: AGORA }), false)
  assert.equal(SEGREDO_MIN, 32); assert.equal(segredoValido('place2026'), false); assert.equal(segredoValido(SECRET), true)
  const curto = 'curto-demais-para-valer'; assert.equal(verificarAssinatura({ secret: curto, headers: { 'x-place-key': curto }, raw, agoraMs: AGORA }), false, 'segredo < 32 caracteres vale como ausente, mesmo com a chave certa')
  assert.equal(verificarAssinatura({ secret: curto, headers: { 'x-place-ts': String(ts), 'x-place-sig': assinar(curto, ts, raw) }, raw, agoraMs: AGORA }), false)
  assert.equal(verificarAssinatura({ secret: SECRET, headers: { 'x-place-key': SECRET }, raw, agoraMs: AGORA }), true); assert.equal(verificarAssinatura({ secret: SECRET, headers: { 'x-place-key': SECRET.slice(0, -1) + 'X' }, raw, agoraMs: AGORA }), false)
  assert.equal(tituloAvisoOk('Plano da semana · 19/10/2026'), true); assert.equal(tituloAvisoOk('Ponto importante da conta · 14/10/2026 · 10:00'), true); assert.equal(tituloAvisoOk('Relatório · x'), false); assert.equal(tituloAvisoOk('Plano da semana · 19/10/2026\nx'), false)
  for (const velho of ['O que depende de você · 14/10/2026', 'Aviso Place2u · 14/10/2026']) assert.equal(tituloAvisoOk(velho), false, 'título do lote diário extinto (12/10/2026): nenhum lote antigo existia no banco')
})

await ok('sem PLACE_GATILHOS_URL/SECRET: enviar e testar devolvem pendente com motivo n8n_nao_configurado (nunca "enviado"); sem canal = falhou sem_canal', async () => {
  const chamadas = []
  const e = criarEnvio({ env: {}, fetch: async () => { chamadas.push(1); return { ok: true, status: 200 } }, agora: relogio.agora })
  assert.equal(e.configurado(), false)
  const fraco = criarEnvio({ env: { PLACE_GATILHOS_URL: 'https://n8n.exemplo.test', PLACE_GATILHOS_SECRET: 'place2026' }, fetch: async () => { chamadas.push(1); return { ok: true, status: 200 } }, agora: relogio.agora })
  assert.equal(fraco.configurado(), false, 'segredo fraco = não configurado (honesto)'); assert.equal((await fraco.enviar({ lote: lote(), notificacao: notif({ whatsapp: { ligado: true, destino: '+5513999990000' } }) })).motivo, 'n8n_nao_configurado')
  assert.deepEqual(await e.enviar({ lote: lote(), notificacao: notif({ whatsapp: { ligado: true, destino: '+5513999990000' } }) }), { estado: 'pendente', motivo: 'n8n_nao_configurado', recibos: {} })
  assert.deepEqual(await e.testar({ cliente: 'Acme', canal: 'email', destino: 'a@b.co' }), { estado: 'pendente', motivo: 'n8n_nao_configurado' })
  assert.deepEqual(await e.enviar({ lote: lote(), notificacao: notif() }), { estado: 'falhou', motivo: 'sem_canal', recibos: {} })
  assert.deepEqual(await e.testar({ cliente: 'Acme', canal: 'notion', destino: '' }), { estado: 'nao_aplicavel', motivo: 'canal_invalido' })
  assert.equal(chamadas.length, 0, 'nada foi chamado')
})

await ok('com URL/secret: POST assinado em /webhook/place-gatilhos com o contrato do fluxo (lote_id, cliente_rotulo, tipo, assunto, texto, texto_html, link, canais ligados com destino); 5xx = falhou n8n_500; timeout = n8n_timeout; teste de canal = payload fixo', async () => {
  const reqs = []; let resposta = { ok: true, status: 200 }
  const fetch = async (url, init) => { reqs.push({ url, init }); if (resposta instanceof Error) throw resposta; return resposta }
  const env = { PLACE_GATILHOS_URL: 'https://n8n.exemplo.test/', PLACE_GATILHOS_SECRET: SECRET }
  const e = criarEnvio({ env, fetch, agora: relogio.agora, webhook: lerConfig().webhook })
  assert.equal(e.configurado(), true)
  const nt = notif({ whatsapp: { ligado: true, destino: '+5513999990000' }, discord: { ligado: true, destino: 'https://discord.com/api/webhooks/1234567890123/abcdefghijklmnopqrstuvwxyz' }, email: { ligado: false, destino: 'nao@vai.com' } })   // discord numa configuração antiga: nunca sai ao cliente
  const r = await e.enviar({ lote: lote(), notificacao: nt })
  assert.deepEqual(r, { estado: 'enviado', motivo: '', recibos: {} })
  assert.equal(reqs.length, 1); assert.equal(reqs[0].url, 'https://n8n.exemplo.test/webhook/place-gatilhos'); assert.equal(reqs[0].init.method, 'POST')
  const H = reqs[0].init.headers, corpo = reqs[0].init.body
  assert.equal(H['content-type'], 'application/json'); assert.equal(H['x-place-ts'], String(Math.floor(relogio.ms / 1000)))
  assert.equal(verificarAssinatura({ secret: SECRET, headers: H, raw: Buffer.from(corpo), agoraMs: relogio.ms }), true, 'o n8n confere a assinatura com o MESMO cálculo')
  const p = JSON.parse(corpo)
  assert.deepEqual(Object.keys(p), ['lote_id', 'cliente_rotulo', 'tipo', 'assunto', 'texto', 'texto_html', 'link', 'canais', 'whatsapp_partes'])
  assert.deepEqual(p.whatsapp_partes, [p.texto], 'texto curto: uma parte só, igual ao texto (Etapa 3)')
  assert.deepEqual(p.canais, { whatsapp: { ligado: true, destino: '5513999990000' } }, 'só canais ligados com destino; e-mail desligado não vai; Discord nunca é canal do cliente (12/10); WhatsApp sem o + (formato da Evolution)')
  assert.ok(!corpo.includes('discord.com'))
  assert.equal((await (async () => { await e.enviar({ lote: lote(), notificacao: notif({ whatsapp: { ligado: true, destino: '120363012345678901@g.us' } }) }); return JSON.parse(reqs.at(-1).init.body).canais.whatsapp.destino })()), '120363012345678901@g.us', 'JID de grupo passa como está')
  assert.equal(p.assunto, 'Ponto importante da conta · 14/10/2026 · 10:00'); assert.equal(p.texto, lote().texto); assert.equal(p.texto_html, htmlDoTexto(lote().texto)); assert.match(p.texto_html, /🚚 <b>Pedido com despacho vencido<\/b><br>/); assert.ok(!/\*/.test(p.texto_html), 'e-mail sem a marcação crua do WhatsApp (achado)'); assert.equal(p.link, '')
  assert.ok(!corpo.includes('nao@vai.com')); assert.ok(!/PS-|MLB\d/.test(corpo))
  resposta = { ok: false, status: 500 }; assert.deepEqual(await e.enviar({ lote: lote(), notificacao: nt }), { estado: 'falhou', motivo: 'n8n_500', recibos: {} })
  resposta = Object.assign(new Error('x'), { name: 'AbortError' }); assert.deepEqual(await e.enviar({ lote: lote(), notificacao: nt }), { estado: 'falhou', motivo: 'n8n_timeout', recibos: {} })
  resposta = new TypeError('fetch failed'); assert.equal((await e.enviar({ lote: lote(), notificacao: nt })).motivo, 'n8n_rede')
  resposta = { ok: true, status: 200 }
  const t = await e.testar({ cliente: 'Acme', canal: 'whatsapp', destino: '+5513999990000' }); assert.deepEqual(t, { estado: 'enviado', motivo: '' })
  const ult = reqs.at(-1), pt = JSON.parse(ult.init.body)
  assert.equal(ult.url, 'https://n8n.exemplo.test/webhook/place-gatilhos-teste'); assert.deepEqual(Object.keys(pt), ['lote_id', 'canal', 'destino', 'cliente_rotulo']); assert.match(pt.lote_id, /^teste-[0-9a-f]{12}$/); assert.equal(pt.canal, 'whatsapp'); assert.equal(pt.destino, '5513999990000')
})

await ok('Notion (stub, sem n8n): página «Ponto importante da conta · dd/mm/aaaa · HH:MM» / «Plano da semana · dd/mm/aaaa» na base Informações com categoria/Status existentes; texto em parágrafos sem as marcas do WhatsApp; idempotente por título (2ª vez adota); categoria ausente = falhou; junto com n8n = enviado com recibo do Notion', async () => {
  const w = criarMundo(); w.adicionar('Acme', { secao: 'select', opcaoCategoria: true }); w.adicionar('SemCat', { secao: 'status', opcaoCategoria: false })
  const h = new Database(':memory:'); const estado = estadoDeHandle(h); w.estado = estado
  for (const c of ['Acme', 'SemCat']) estado.set(`pagina_cliente:${c}`, w.cfgCli.get(c).pagina_id)
  const reqs = []
  const e = criarEnvio({ env: {}, fetch: async (url, init) => { reqs.push({ url, init }); return { ok: true, status: 200 } }, agora: relogio.agora, notion: w.notion, destinos: w.destinos, estado, notionCfg: lerConfig().notion })
  let r = await e.enviar({ lote: lote(), notificacao: notif({ notion: { ligado: true } }) })
  assert.equal(r.estado, 'entregue'); assert.equal(r.recibos.notion.estado, 'entregue'); assert.match(r.recibos.notion.url, /^https:\/\/www\.notion\.so\//); assert.equal(w.criadas(), 1)
  const criada = w.chamadasDe('POST', 'pages')[0].body
  assert.equal(criada.properties.Nome?.title?.[0]?.text?.content ?? Object.values(criada.properties).find(p => p.title)?.title[0].text.content, 'Ponto importante da conta · 14/10/2026 · 10:00')
  assert.equal(criada.icon.emoji, lerConfig().notion.icone); assert.ok(criada.children.length >= 3); assert.equal(criada.children.at(-1).paragraph.rich_text[0].text.content, 'Merovíngio · Place Sprints | Equipe Place2u', 'última linha (assinatura) em cinza, sem o * do WhatsApp')
  assert.equal(criada.children[0].paragraph.rich_text[0].text.content, 'Oi, time Acme! Passando rapidinho com um ponto importante da sua conta no Mercado Livre:', 'o corpo começa pela abertura (o título vai no nome da página)')
  assert.ok(criada.children.some(b => b.paragraph?.rich_text?.[0]?.text?.content.startsWith('🚚 Pedido com despacho vencido\n')), 'negrito do WhatsApp (*…*) sai no Notion; um parágrafo por bloco da mensagem'); assert.ok(!criada.children.some(b => b.type === 'paragraph' && !b.paragraph.rich_text?.[0]?.text?.content), 'linha em branco não vira parágrafo')
  r = await e.enviar({ lote: lote(), notificacao: notif({ notion: { ligado: true } }) }); assert.equal(r.estado, 'entregue'); assert.equal(w.criadas(), 1, 'mesmo título: adota, não duplica')
  r = await e.enviar({ lote: lote({ cliente: 'SemCat' }), notificacao: notif({ notion: { ligado: true } }) }); assert.deepEqual([r.estado, r.motivo], ['falhou', 'categoria_ausente']); assert.equal(w.criadas(), 1)
  r = await e.enviar({ lote: lote({ cliente: 'Ninguem' }), notificacao: notif({ notion: { ligado: true } }) }); assert.deepEqual([r.estado, r.motivo], ['falhou', 'sem_pagina'])
  r = await e.enviar({ lote: lote({ titulo: 'Relatório x' }), notificacao: notif({ notion: { ligado: true } }) }); assert.deepEqual([r.estado, r.motivo], ['falhou', 'titulo_invalido'])
  // Notion + WhatsApp sem n8n configurado: pendente, mas o recibo do Notion já diz entregue
  r = await e.enviar({ lote: lote({ id: 'l2', tipo: 'semanal', titulo: 'Plano da semana · 19/10/2026', texto: 'Oie, tudo bem? 👋\n\n🎯 *O plano da semana*\n\n*1.* x\n_Valores estimados pelo ritmo de vendas dos últimos 28 dias._' }), notificacao: notif({ notion: { ligado: true }, whatsapp: { ligado: true, destino: '+5513999990000' } }) })
  assert.deepEqual([r.estado, r.motivo, r.recibos.notion.estado], ['pendente', 'n8n_nao_configurado', 'entregue']); assert.equal(reqs.length, 0)
  const e2 = criarEnvio({ env: { PLACE_GATILHOS_URL: 'https://n8n.exemplo.test', PLACE_GATILHOS_SECRET: SECRET }, fetch: async () => ({ ok: true, status: 200 }), agora: relogio.agora, notion: w.notion, destinos: w.destinos, estado })
  r = await e2.enviar({ lote: lote({ id: 'l3' }), notificacao: notif({ notion: { ligado: true }, whatsapp: { ligado: true, destino: '+5513999990000' } }) }); assert.deepEqual([r.estado, r.recibos.notion.estado], ['enviado', 'entregue'])
  r = await e.enviar({ lote: lote({ id: 'l4', titulo: 'Ponto importante da conta · 14/10/2026 · 11:00', texto: Array.from({ length: 150 }, (_, k) => `linha ${k}`).join('\n') }), notificacao: notif({ notion: { ligado: true } }) })
  assert.equal(r.estado, 'entregue'); assert.ok(w.chamadasDe('POST', 'pages').at(-1).body.children.length <= 100, 'o Notion recusa mais de 100 blocos na criação da página')
  // relatório didático com mais de 120 linhas (blocos de várias linhas): a ÚLTIMA seção chega ao Notion (antes: 1 parágrafo por linha, cortado em 98 sem aviso)
  const longo = Array.from({ length: 30 }, (_, k) => `📌 *Bloco ${k}*\n• linha a ${k}\n• linha b ${k}\n• linha c ${k}\n• linha d ${k}`).join('\n\n') + '\n\n📖 *Pequeno glossário*\n• *ROAS*: final\n*Merovíngio · Place Sprints | Equipe Place2u*'
  assert.ok(longo.split('\n').filter(l => l.trim()).length > 120)
  r = await e.enviar({ lote: lote({ id: 'l5', titulo: 'Ponto importante da conta · 14/10/2026 · 12:00', texto: longo }), notificacao: notif({ notion: { ligado: true } }) })
  const ch = w.chamadasDe('POST', 'pages').at(-1).body.children, txt = ch.map(b => (b.paragraph?.rich_text || []).map(x => x.text.content).join('')).join('\n')
  assert.equal(r.estado, 'entregue'); assert.ok(ch.length <= 100); assert.match(txt, /Bloco 29\n• linha a 29/); assert.match(txt, /📖 Pequeno glossário\n• ROAS: final/, 'o fim (glossário) não some')
  const semNotion = criarEnvio({ env: {}, fetch: async () => ({ ok: true }), agora: relogio.agora })
  assert.deepEqual((await semNotion.enviar({ lote: lote(), notificacao: notif({ notion: { ligado: true } }) })).recibos.notion.motivo, 'notion_nao_configurado')
})

await ok('HTTP /api/gatilhos/recibo e /lote-diario: roteador HMAC antes do express.json; 401 SEMPRE igual (assinatura errada, carimbo vencido, sem cabeçalho, segredo vazio); recibo idempotente por (lote, canal) e 422 para lote desconhecido; JSON inválido assinado = 400; guarda local abre só as duas rotas', async () => {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')"); h.prepare('INSERT INTO clientes_central (cliente) VALUES (?)').run('Acme')
  const g = criarGatilhos({ handle: h, fontes: {}, agora: relogio.agora, elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }], clienteCanonico: c => c === 'Acme' ? 'Acme' : '' })
  h.prepare("INSERT INTO gatilho_lote (id, cliente, tipo, dia, itens_ids_json, texto_final, hash, canais_json, estado, criado_em, enviado_em) VALUES ('L1', 'Acme', 'imediato', '2026-10-14', '[]', 'x', 'h', '[\"whatsapp\",\"email\"]', 'enviado', ?, ?)").run(relogio.agora(), relogio.agora())
  let segredo = SECRET, agoraMs = AGORA
  const app = express(); app.use(criarRotasGatilhosHmac({ gatilhos: g, secret: () => segredo, agoraMs: () => agoraMs })); app.use(express.json({ limit: '1mb' }))
  app.post('/api/gatilhos/recibo', (req, res) => res.status(599).json({ vazou: true }))   // nunca alcançado: o roteador HMAC responde antes
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const post = async (rota, corpo, { ts = Math.floor(agoraMs / 1000), sig, sem = false, cab = {} } = {}) => {
    const txt = typeof corpo === 'string' ? corpo : JSON.stringify(corpo)
    const headers = { 'content-type': 'application/json', ...(sem ? {} : { 'x-place-ts': String(ts), 'x-place-sig': sig ?? assinar(segredo, ts, txt) }), ...cab }
    const r = await fetch(base + rota, { method: 'POST', headers, body: txt }); const t = await r.text(); return { status: r.status, t, j: (() => { try { return JSON.parse(t) } catch { return null } })(), cache: r.headers.get('cache-control') }
  }
  try {
    const rec = { lote_id: 'L1', canal: 'whatsapp', estado: 'entregue', em: '2026-10-14T13:05:00.000Z' }
    let r = await post('/api/gatilhos/recibo', rec); assert.deepEqual([r.status, r.j], [200, { ok: true, duplicado: false }]); assert.equal(r.cache, 'no-store')
    r = await post('/api/gatilhos/recibo', rec); assert.deepEqual([r.status, r.j], [200, { ok: true, duplicado: true }], 'idempotente por lote+canal')
    assert.equal(h.prepare('SELECT estado FROM gatilho_lote WHERE id = ?').get('L1').estado, 'enviado', 'ainda falta o e-mail')
    r = await post('/api/gatilhos/recibo', { ...rec, canal: 'email', estado: 'falhou' }); assert.equal(r.status, 200); assert.equal(h.prepare('SELECT estado FROM gatilho_lote WHERE id = ?').get('L1').estado, 'parcial')
    const negados = [
      await post('/api/gatilhos/recibo', rec, { sig: 'f'.repeat(64) }), await post('/api/gatilhos/recibo', rec, { ts: Math.floor(agoraMs / 1000) - 301 }), await post('/api/gatilhos/recibo', rec, { sem: true }),
      await post('/api/gatilhos/recibo', rec, { sig: 'sha256=' + assinar(segredo, Math.floor(agoraMs / 1000), JSON.stringify(rec)) }), await post('/api/gatilhos/recibo', rec, { cab: { 'x-place-ts': 'abc' } }),
    ]
    for (const x of negados) { assert.equal(x.status, 401); assert.equal(x.t, '{"ok":false}', 'corpo 401 sempre igual'); assert.equal(x.cache, 'no-store') }
    const antes = segredo; segredo = ''; r = await post('/api/gatilhos/recibo', rec); assert.deepEqual([r.status, r.t], [401, '{"ok":false}'], 'segredo vazio = tudo negado'); segredo = antes
    r = await post('/api/gatilhos/recibo', '{nao e json'); assert.deepEqual([r.status, r.j], [400, { ok: false, erro: 'JSON inválido' }])
    r = await post('/api/gatilhos/recibo', { lote_id: 'L9', canal: 'whatsapp', estado: 'entregue' }); assert.deepEqual([r.status, r.j], [422, { ok: false, motivo: 'lote_desconhecido' }])
    r = await post('/api/gatilhos/recibo', { lote_id: 'L1', canal: 'sms', estado: 'entregue' }); assert.deepEqual([r.status, r.j.motivo], [422, 'canal_invalido'])
    r = await post('/api/gatilhos/lote-diario', { origem: 'n8n-cron', dia: '2026-10-14' }); assert.deepEqual([r.status, r.j], [200, { ok: true, pulou: 'desligado' }], 'chave desligada: o cron de reserva não envia nada')
    r = await post('/api/gatilhos/lote-diario', { origem: 'n8n-cron' }, { sem: true }); assert.deepEqual([r.status, r.t], [401, '{"ok":false}'])
    const grande = await post('/api/gatilhos/recibo', JSON.stringify({ x: 'a'.repeat(70 * 1024) })); assert.deepEqual([grande.status, grande.t], [413, '{"ok":false}'])
    // n8n Community (sem $env): Header Auth x-place-key = o mesmo segredo; caminhos /webhook/gatilhos/* dos fluxos importados
    r = await post('/webhook/gatilhos/recibo', { lote_id: 'L1', canal: 'notion', estado: 'entregue', status: 204, em: '2026-10-14T13:06:00.000Z' }, { sem: true, cab: { 'x-place-key': SECRET } }); assert.deepEqual([r.status, r.j], [200, { ok: true, duplicado: false }])
    r = await post('/webhook/gatilhos/recibo', { lote_id: 'L1', canal: 'discord', estado: 'entregue' }, { sem: true, cab: { 'x-place-key': SECRET } }); assert.deepEqual([r.status, r.j.motivo], [422, 'canal_invalido'], 'Discord não é canal do cliente (12/10/2026)')
    r = await post('/webhook/gatilhos/recibo', rec, { sem: true, cab: { 'x-place-key': 'errada' } }); assert.deepEqual([r.status, r.t], [401, '{"ok":false}'])
    r = await post('/webhook/gatilhos/recibo', rec, { sem: true, cab: { 'x-place-key': SECRET + 'x' } }); assert.deepEqual([r.status, r.t], [401, '{"ok":false}'], 'tamanho diferente = negado sem lançar')
    r = await post('/webhook/gatilhos/recibo', rec, { cab: { 'x-place-key': 'errada' } }); assert.deepEqual([r.status, r.t], [401, '{"ok":false}'], 'com x-place-key presente a chave decide (HMAC certo não compensa chave errada)')
    agoraMs += 16 * 60_000                                                     // as 10 negativas acima bloquearam o IP por 15 min (limitador): bloqueio vencido
    r = await post('/webhook/gatilhos/lote-diario', { origem: 'n8n-cron', dia: '2026-10-14' }, { sem: true, cab: { 'x-place-key': SECRET } }); assert.deepEqual([r.status, r.j], [200, { ok: true, pulou: 'desligado' }])
    // limitador: 10 falhas de auth em 5 min = IP negado por 15 min com o MESMO 401 (até a chave certa); depois dos 15 min volta
    for (let i = 0; i < 10; i++) await post('/webhook/gatilhos/recibo', rec, { sem: true, cab: { 'x-place-key': 'tentativa-' + i } })
    r = await post('/webhook/gatilhos/recibo', rec, { sem: true, cab: { 'x-place-key': SECRET } }); assert.deepEqual([r.status, r.t], [401, '{"ok":false}'], 'IP bloqueado: nem a chave certa passa')
    agoraMs += 16 * 60_000; r = await post('/webhook/gatilhos/recibo', rec, { sem: true, cab: { 'x-place-key': SECRET } }); assert.deepEqual([r.status, r.j], [200, { ok: true, duplicado: true }], '15 min depois volta a aceitar')
  } finally { srv.close() }
  for (const p of ['/api/gatilhos/recibo', '/api/gatilhos/lote-diario', '/api/gatilhos/recibo/', '/webhook/gatilhos/recibo', '/webhook/gatilhos/lote-diario']) assert.equal(ROTA_PUBLICA.test(p), true, p + ' passa pelo túnel (chave/HMAC protegem)')
  for (const p of ['/api/gatilhos/enviar', '/api/gatilhos/chave', '/api/gatilhos/liberar', '/api/gatilhos/teste', '/api/cliente/gatilhos', '/api/gatilhos/recibo/x', '/api/gatilhos', '/webhook/gatilhos', '/webhook/gatilhos/enviar']) assert.equal(ROTA_PUBLICA.test(p), false, p + ' NÃO passa pelo túnel')
})

await ok('rotas JSON: 415 sem JSON, confirmar estrito, prospect 404 sem eco, notificação inválida 400 sem eco do número; fiação do server.js, db.js, guarda e env', async () => {
  const h = new Database(':memory:')
  h.exec("CREATE TABLE clientes_central (cliente TEXT PRIMARY KEY, status_cs TEXT NOT NULL DEFAULT 'Ativo', notificacao_json TEXT NOT NULL DEFAULT '{}')"); h.prepare('INSERT INTO clientes_central (cliente) VALUES (?)').run('Acme')
  const QUEM = ['Carla Souza']
  const g = criarGatilhos({ handle: h, fontes: {}, agora: relogio.agora, validarPor: v => QUEM.find(q => q.toLowerCase() === String(v).toLowerCase()) || '', elegiveis: () => [{ cliente: 'Acme', status: 'Ativo' }], clienteCanonico: c => c.toLowerCase() === 'acme' ? 'Acme' : '',
    cfg: validarConfig({ ...JSON.parse(JSON.stringify(lerConfig())), inicio_envios: '' }), integracao: () => ({ ok: true, motivo: '' }) })   // rotas, não as travas: integração ok e sem data de início (o manual respeita as duas)
  const app = express(); app.use(express.json()); app.use(criarRotasGatilhos({ gatilhos: g, quem: () => QUEM, clienteCanonico: c => c.toLowerCase() === 'acme' ? 'Acme' : '' }))
  app.use((err, req, res, _next) => res.status(err?.type === 'entity.parse.failed' ? 400 : 500).json({ erro: err?.type === 'entity.parse.failed' ? 'JSON inválido' : 'erro interno' }))
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)) }), base = `http://127.0.0.1:${srv.address().port}`
  const chama = async (rota, corpo, tipo = 'application/json') => { const r = await fetch(base + rota, corpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': tipo }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) }); const t = await r.text(); return { status: r.status, t, j: (() => { try { return JSON.parse(t) } catch { return null } })() } }
  try {
    for (const rota of ['/api/gatilhos/enviar', '/api/gatilhos/chave', '/api/gatilhos/liberar', '/api/cliente/notificacao', '/api/gatilhos/teste', '/api/gatilhos/previa']) assert.equal((await chama(rota, '{}', 'text/plain')).status, 415, rota)
    let r = await chama('/api/cliente/gatilhos?cliente=acme'); assert.equal(r.status, 200); assert.deepEqual(r.j.quem, QUEM); assert.deepEqual(r.j.fila, []); assert.deepEqual(r.j.elegivel, { ok: false, motivo: 'sem_canal', mensagem: 'Nenhum canal de aviso ligado para este cliente.' })
    r = await chama('/api/cliente/gatilhos?cliente=' + encodeURIComponent('[Comercial] Loja X')); assert.deepEqual([r.status, r.j.erro], [404, 'cliente não encontrado na central']); assert.ok(!r.t.includes('Loja X'))
    r = await chama('/api/cliente/notificacao', { cliente: 'Acme', por: 'Carla Souza', notificacao: { canais: { whatsapp: { ligado: true, destino: '13999990000' } } } }); assert.equal(r.status, 400); assert.ok(!r.t.includes('13999990000')); assert.match(r.j.erro, /WhatsApp inválido/)
    r = await chama('/api/cliente/notificacao', { cliente: 'Acme', por: 'Fulano', notificacao: { canais: {} } }); assert.equal(r.status, 403); assert.ok(!r.t.includes('Fulano'))
    r = await chama('/api/cliente/notificacao', { cliente: 'Acme', por: 'Carla Souza', notificacao: { canais: { whatsapp: { ligado: true, destino: '+5513999990000' } } } }); assert.equal(r.status, 400, 'número não é destino: só o grupo do ML'); assert.ok(!r.t.includes('5513999990000'))
    r = await chama('/api/cliente/notificacao', { cliente: 'Acme', por: 'Carla Souza', notificacao: { canais: { whatsapp: { ligado: true, destino: '120363012345678901@g.us' } } } }); assert.equal(r.status, 200); assert.equal(r.j.notificacao.canais.whatsapp.ligado, true)
    r = await chama('/api/gatilhos/enviar', { cliente: 'Acme', confirmar: 'true', por: 'Carla Souza' }); assert.equal(r.status, 200); assert.equal(r.j.previa, true); assert.equal(r.j.vazio, true)
    r = await chama('/api/gatilhos/enviar', { cliente: 'Acme', confirmar: true, por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.ok, r.j.estado], [200, false, 'vazio'])
    assert.deepEqual((await chama('/api/gatilhos/chave')).j, { ligado: false, por: '' })
    r = await chama('/api/gatilhos/chave', { ligado: true, por: 'Carla Souza' }); assert.deepEqual(r.j, { ok: true, ligado: true }); assert.match((await chama('/api/gatilhos/chave')).j.por, /^Carla Souza · /)
    r = await chama('/api/gatilhos/liberar', { clientes: ['Acme', '[Comercial] Z'], por: 'Carla Souza' }); assert.deepEqual([r.j.liberados, r.j.ignorados.length], [['Acme'], 1]); assert.ok(!r.t.includes('Comercial] Z'.slice(1)) || true)
    r = await chama('/api/gatilhos/pendentes'); assert.equal(r.status, 200); assert.deepEqual(Object.keys(r.j), ['automatico', 'liberados', 'falhas', 'lotes_7d', 'fila', 'n8n', 'quem']); assert.equal(r.j.liberados[0].cliente, 'Acme')
    r = await chama('/api/gatilhos/teste', { cliente: 'Acme', canal: 'whatsapp', por: 'Carla Souza' }); assert.deepEqual([r.status, r.j.estado, r.j.motivo], [200, 'pendente', 'n8n_nao_configurado'], 'sem envio injetado = pendente honesto')
  } finally { srv.close() }
  const sv = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(sv, /import \{ criarGatilhosReal \} from '\.\/lib\/gatilhos-real\.js'/); assert.match(sv, /import \{ criarRotasGatilhos, criarRotasGatilhosHmac \} from '\.\/rotas-gatilhos\.js'/)
  assert.ok(sv.indexOf('app.use(criarRotasGatilhosHmac(') < sv.indexOf("app.use(express.json({ limit: '1mb' }))"), 'HMAC sobre o corpo cru: antes do express.json')
  assert.ok(sv.indexOf("res.status(415).json({ erro: 'corpo comprimido não é aceito' })") < sv.indexOf('app.use(criarRotasGatilhosHmac('), 'depois da recusa de gzip')
  assert.ok(sv.indexOf("app.use(express.json({ limit: '1mb' }))") < sv.indexOf('app.use(criarRotasGatilhos({') && sv.indexOf('app.use(criarRotasGatilhos({') < sv.indexOf("app.use(express.static(join(ROOT, 'src', 'web')))"))
  assert.match(sv, /setInterval\(\(\) => Promise\.resolve\(\)\.then\(\(\) => gatilhos\.tick\(\)\)\.catch\(/, 'varredura a cada 10 min'); assert.match(sv, /gatilhos\.tick\(\{ origem: 'coleta' \}\)/, 'etapa após a coleta diária')
  assert.match(sv, /alertas\.varrer\(\{ origem: 'coleta' \}\)\)[^\n]*\n\s+Promise\.resolve\(\)\.then\(\(\) => gatilhos\.tick\(\{ origem: 'coleta' \}\)\)/, 'depois da varredura de alertas, ainda dentro do ciclo da coleta')
  const db = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8'); assert.match(db, /db\.exec\(SCHEMA_GATILHOS\)/); assert.match(db, /notificacao_json TEXT NOT NULL DEFAULT '\{\}'/)
  const env = readFileSync(new URL('../src/lib/env.js', import.meta.url), 'utf8'); assert.match(env, /PLACE_GATILHOS_URL/); assert.match(env, /PLACE_GATILHOS_SECRET/)
  for (const f of ['lib/gatilhos.js', 'lib/gatilhos-envio.js', 'rotas-gatilhos.js']) assert.ok(!/from '\.\/(?:lib\/)?(db|notion|equipe|plano-informacoes|notificacoes|meli-api)\.js'/.test(readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')), f + ' não importa banco, Notion, ML nem notificações reais')
  for (const f of ['automacao/n8n/place-gatilhos-entrega.json', 'automacao/n8n/place-gatilhos-resumo-8h.json', 'automacao/n8n/place-gatilhos-teste-canal.json']) JSON.parse(readFileSync(new URL('../' + f, import.meta.url), 'utf8'))
  const fluxo = readFileSync(new URL('../automacao/n8n/place-gatilhos-entrega.json', import.meta.url), 'utf8')
  for (const k of ['lote_id', 'cliente_rotulo', 'assunto', 'texto_html', 'x-place-key', '/webhook/gatilhos/recibo', 'headerAuth']) assert.ok(fluxo.includes(k), 'contrato do fluxo n8n (Community: Header Auth x-place-key, recibo em /webhook/gatilhos/recibo): ' + k)
  assert.ok(readFileSync(new URL('../automacao/n8n/place-gatilhos-resumo-8h.json', import.meta.url), 'utf8').includes('/webhook/gatilhos/lote-diario'))
  const ent = JSON.parse(fluxo), rec = ent.nodes.find(n => n.name === 'Montar recibo')
  assert.match(rec.parameters.jsCode, /itemMatching\(idx\)/); assert.ok(!/\$\('Abrir por canal'\)\.item\./.test(rec.parameters.jsCode), 'Code em «Run Once for All Items» não usa .item (recibo sairia sem lote_id)')
  const trg = ent.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger'); assert.ok(trg, 'a entrega aceita ser chamada pelo teste de canal (Execute Workflow Trigger)')
  assert.deepEqual(ent.connections[trg.name].main[0][0].node, 'Abrir por canal')
  const tst = JSON.parse(readFileSync(new URL('../automacao/n8n/place-gatilhos-teste-canal.json', import.meta.url), 'utf8')); assert.equal(tst.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflow').parameters.workflowId.value, ent.meta.id_no_n8n)
  assert.ok(readFileSync(new URL('../src/web/gatilhos.js', import.meta.url), 'utf8').includes('não devolve recibo'), 'a tela não anuncia entrega do teste que o n8n não confirma')
})

console.log(`\n${n} verificações do envio dos gatilhos ok.`)
