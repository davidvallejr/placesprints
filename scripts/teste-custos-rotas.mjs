// Auto-teste do M8 (src/rotas-custos.js, API de gestão dos custos por SKU — SPEC seção 10.1/12). Banco EM MEMÓRIA, sem rede externa:
// o roteador real roda num Express em porta efêmera de loopback (com o guard global e o express.json, como no server.js) e os
// módulos M1/M2/M3/M6/M7 são stubs que seguem as assinaturas congeladas (seção 11.1). Nada de porta 3012, ERP, Google ou ML.
// Rodar: node scripts/teste-custos-rotas.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // ANTES dos imports dinâmicos (o promocoes-db lê isto no carregamento)
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
const R = await import('../src/lib/promocoes-db.js')
const G = await import('../src/lib/guarda-local.js')
const { env } = await import('../src/lib/env.js')
const Rotas = await import('../src/rotas-custos.js')
const express = (await import('express')).default
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const okA = async (nome, fn) => { try { await fn(); n++; console.log(`✔ ${nome}`) } catch (e) { console.error('FALHOU:', nome); throw e } }

// ── stubs (assinaturas congeladas da seção 11.1) ─────────────────────────────────────────────────────────
const HC = 'Cliente Ótimo', HB = 'Outro Cliente', URL_PUB = 'https://tunel.exemplo.test'
const chamadas = []
const reg = (nome, fn) => (...a) => { chamadas.push({ nome, a }); return fn(...a) }
const chamou = nome => chamadas.filter(c => c.nome === nome)
const novoSegredo = () => randomBytes(32).toString('hex')
const segredosEmitidos = []
let wh = null, rodando = false
const nucleo = {
  resumoCustos: reg('resumoCustos', () => ({ fontes: { sheets: { estado: 'conectado', ultimo_sync_ok_em: '2026-10-05T10:00:00Z', idade_dias: 0.1, velha: false, ultimo_erro: '', contagens: { skus: 3, rejeitadas: 1, quarentena: 1, nao_vistos: 0 } }, bling: { estado: 'desconectado' }, tiny: { estado: 'desconectado' } }, efetivo: { skus_com_custo: 3, por_fonte: { manual: 0, bling: 0, tiny: 0, sheets: 3 } } })),
  getCfgCustos: reg('getCfgCustos', () => ({ ordem_fontes: ['manual', 'bling', 'tiny', 'sheets'], limiar_variacao_pct: 50, quarentena_custo_ge_preco: 1, campo_custo_tiny: 'preco_custo', velho_dias_erp: 3, velho_dias_sheets: 14 })),
  setCfgCustos: reg('setCfgCustos', () => undefined),
  pendenciasCustos: reg('pendenciasCustos', () => [{ codigo: 'CUSTO_QUARENTENA', estado: 'ATENCAO', texto: '1 custo em quarentena' }]),
  reconciliacao: reg('reconciliacao', (c, lista) => ({ lista, disponivel: false, motivo: 'rode a coleta de promoções do cliente', total: 0, itens: [], cobertura: null })),
  custosEfetivosDetalhe: reg('custosEfetivosDetalhe', () => ({ total: 0, itens: [] })),
  historicoSku: reg('historicoSku', () => []),
  listarQuarentena: reg('listarQuarentena', () => [{ sku: 'X1', fonte: 'sheets', motivo: 'variacao_brusca' }]),
  decidirQuarentena: reg('decidirQuarentena', (c, itens, d) => ({ aprovados: d === 'aprovar' ? itens.length : 0, recusados: d === 'recusar' ? itens.length : 0, ignorados: 0 })),
  descartarCusto: reg('descartarCusto', () => ({ descartado: true })),
}
const webhook = {
  gerarWebhook: reg('gerarWebhook', (c, f) => {
    if (wh) throw Object.assign(new Error('webhook já existe: use rotacionar'), { status: 409 })
    wh = { wid: randomBytes(16).toString('base64url'), segredo: novoSegredo(), ativo: true }; segredosEmitidos.push(wh.segredo)
    return { wid: wh.wid, url: `${URL_PUB}/webhook/custos/${wh.wid}`, segredo: wh.segredo }
  }),
  rotacionarSegredo: reg('rotacionarSegredo', () => { wh.segredo = novoSegredo(); segredosEmitidos.push(wh.segredo); return { wid: wh.wid, url: `${URL_PUB}/webhook/custos/${wh.wid}`, segredo: wh.segredo } }),
  desativarWebhook: reg('desativarWebhook', () => { wh.ativo = false }),
  // vazamento SIMULADO (segredo_cifrado/segredo): a rota tem de filtrar mesmo se o M2 errar
  statusWebhook: reg('statusWebhook', () => wh && { ativo: wh.ativo, url: `${URL_PUB}/webhook/custos/${wh.wid}`, criado_em: '2026-10-05T10:00:00Z', rotacionado_em: '', ultimo_uso_em: '', segredo_cifrado: 'v1.vazado', segredo: wh.segredo }),
}
const scriptReal = ({ url, segredo }) => {
  if (!/^https:\/\//.test(url) || !/^[0-9a-f]{64}$/.test(segredo)) throw new Error(`entrada inválida para o Apps Script (segredo=${segredo})`)
  return `var WEBHOOK_URL = ${JSON.stringify(url)};\nvar WEBHOOK_SECRET = ${JSON.stringify(segredo)};\nfunction instalar() {}`
}
const script = { gerarScriptApps: reg('gerarScriptApps', a => scriptReal(a)) }
const credenciais = {
  salvarAppGlobal: reg('salvarAppGlobal', () => undefined),
  salvarCredenciaisApp: reg('salvarCredenciaisApp', () => undefined),
  urlAutorizacao: reg('urlAutorizacao', (c, f) => `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=abc&state=st-${f}`),
  desconectarErp: reg('desconectarErp', () => undefined),
  statusCredenciais: reg('statusCredenciais', () => ({ conectado: false, modo_app: 'global', escopos: [], company_id: '', expira_em: '', client_secret_cifrado: 'v1.vazado', access_token_cifrado: 'v1.vazado2', refresh_token: 'rt-vazado' })),
}
const sync = {
  iniciarSync: reg('iniciarSync', (c, f) => { if (rodando) throw Object.assign(new Error('já existe uma sincronização rodando para esta conta'), { status: 409 }); rodando = true; return { job_id: 'ej-1' } }),
  statusJob: reg('statusJob', id => (id === 'ej-1' ? { id, estado: 'rodando', fonte: 'bling' } : null)),       // sem `cliente`: a rota usa o próprio mapa de dono
}
Object.assign(Rotas.depsCustos, { conexoes: () => [{ cliente: HC, nickname: 'x' }, { cliente: HB, nickname: 'y' }], nucleo, webhook, script, credenciais, sync })
env.PUBLIC_BASE_URL = URL_PUB

// ── servidor de teste: guard global + json + rotas (mesma ordem do server.js) ────────────────────────────
const app = express(); app.use(G.guardaLocal); app.use(express.json({ limit: '1mb' })); app.use(Rotas.rotasCustos)
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`
const bruto = async (metodo, caminho, { corpo, tipo = 'application/json', headers = {} } = {}) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: { ...(tipo ? { 'Content-Type': tipo } : {}), ...headers }, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })
  const texto = await r.text(), json = (r.headers.get('content-type') || '').includes('json') ? JSON.parse(texto) : null
  assert.ok(!/\bat .+:\d+:\d+|"stack"/.test(texto), `resposta com stack em ${metodo} ${caminho}: ${texto.slice(0, 200)}`)
  return { status: r.status, json, texto, cache: r.headers.get('cache-control') }
}
const get = c => bruto('GET', c), post = (c, corpo, o) => bruto('POST', c, { corpo, ...o }), q = encodeURIComponent(HC)
const espera = async (r, status, re) => { assert.equal(r.status, status, `esperado ${status}, veio ${r.status}: ${r.texto.slice(0, 200)}`); if (re) assert.match(r.json?.erro || '', re) }

// ═══ entrada lixo em TODAS as rotas: '', null, [], repetido, objeto, cliente sem conta ML ════════════════
const GETS = ['/api/custos/resumo?', '/api/custos/skus?', '/api/custos/historico?sku=A&', '/api/custos/quarentena?', '/api/custos/reconciliacao?lista=conflito&', '/api/custos/pendencias?', '/api/custos/job/ej-1?']
await okA('GET: cliente ausente, vazio, repetido, em lista ou objeto => 400; cliente sem conta ML => 404 (sem stack)', async () => {
  for (const g of GETS) {
    for (const lixo of ['', 'cliente=', 'cliente=%20%20', `cliente=${q}&cliente=${q}`, `cliente[]=${q}`, `cliente[a]=${q}`]) await espera(await get(g + lixo), 400)
    await espera(await get(g + 'cliente=Desconhecido'), 404, /sem conta Mercado Livre/)
  }
})
const POSTS = {
  '/api/custos/quarentena/decidir': { itens: [{ sku: 'X1', fonte: 'sheets' }], decisao: 'aprovar' },
  '/api/custos/descartar': { sku: 'X1', fonte: 'sheets' },
  '/api/custos/config': { limiar_variacao_pct: 60 },
  '/api/custos/fontes/sheets/webhook': { acao: 'desativar' },
  '/api/custos/erp/credenciais': { fonte: 'tiny', client_id: 'id-1234', client_secret: 'sec-1234' },
  '/api/custos/erp/autorizar': { fonte: 'bling' },
  '/api/custos/erp/desconectar': { fonte: 'bling' },
  '/api/custos/fontes/sincronizar': { fonte: 'tiny' },
}
await okA('POST: cliente "", null, [], [x], {} => 400; cliente sem conta ML => 404; corpo em lista => 400; nada chega ao módulo', async () => {
  const antes = chamadas.length
  for (const [c, base] of Object.entries(POSTS)) {
    for (const lixo of ['', '   ', null, [], [HC], {}, 7.5]) await espera(await post(c, { ...base, cliente: lixo, por: 'David' }), lixo === 7.5 ? 404 : 400)
    await espera(await post(c, { ...base, por: 'David' }), 400, /informe "cliente"/)
    await espera(await post(c, [{ ...base, cliente: HC, por: 'David' }]), 400)
    await espera(await post(c, { ...base, cliente: 'Desconhecido', por: 'David' }), 404)
  }
  assert.equal(chamadas.length, antes, 'entrada inválida nunca chama o núcleo/ERP')
})
await okA('POST: "por" obrigatório em toda mutação (ausente, "", null, lista => 400, nada chega ao módulo)', async () => {
  const antes = chamadas.length
  for (const [c, base] of Object.entries({ ...POSTS, '/api/custos/erp/app-global': { fonte: 'bling', client_id: 'id-1234', client_secret: 'sec-1234' } }))
    for (const por of [undefined, '', '  ', null, ['David']]) await espera(await post(c, { ...base, cliente: HC, por }), 400, /por/)
  assert.equal(chamadas.length, antes)
})
await okA('mutação sem Content-Type JSON => 415; POST com Origin de outra porta => 403 (guard global)', async () => {
  const r = await post('/api/custos/descartar', `cliente=${q}&sku=X1&fonte=sheets&por=David`, { tipo: 'application/x-www-form-urlencoded' })
  await espera(r, 415, /JSON/)
  const r2 = await post('/api/custos/descartar', { cliente: HC, sku: 'X1', fonte: 'sheets', por: 'David' }, { headers: { Origin: 'http://localhost:3005' } })
  assert.equal(r2.status, 403)
  assert.equal(chamou('descartarCusto').length, 0)
})

// ═══ leituras ════════════════════════════════════════════════════════════════════════════════════════════
await okA('cliente casa sem acento/caixa e o módulo recebe SEMPRE o nome canônico (isolamento por cliente)', async () => {
  await espera(await get('/api/custos/pendencias?cliente=cliente%20otimo'), 200)
  assert.equal(chamou('pendenciasCustos').at(-1).a[0], HC)
  await espera(await get(`/api/custos/pendencias?cliente=${encodeURIComponent(HB)}`), 200)
  assert.equal(chamou('pendenciasCustos').at(-1).a[0], HB)
})
await okA('GET /skus: fonte/limite/offset/q validados (lixo => 400); "" = todas; repassa ao núcleo', async () => {
  for (const lixo of ['fonte=xyz', 'fonte=sheets&fonte=tiny', 'limite=0', 'limite=1001', 'limite=abc', 'limite=5&limite=6', 'limite=', 'offset=-1', 'offset=1.5', `q=${'x'.repeat(81)}`]) await espera(await get(`/api/custos/skus?cliente=${q}&${lixo}`), 400)
  await espera(await get(`/api/custos/skus?cliente=${q}&fonte=&q=`), 200)
  assert.deepEqual(chamou('custosEfetivosDetalhe').at(-1).a, [HC, { fonte: undefined, q: undefined, limite: 200, offset: 0 }])
  await espera(await get(`/api/custos/skus?cliente=${q}&fonte=SHEETS&q=abc&limite=10&offset=5`), 200)
  assert.deepEqual(chamou('custosEfetivosDetalhe').at(-1).a, [HC, { fonte: 'sheets', q: 'abc', limite: 10, offset: 5 }])
})
await okA('GET /historico: sku obrigatório, 81 caracteres => 400 (nunca cortado para outro SKU)', async () => {
  await espera(await get(`/api/custos/historico?cliente=${q}`), 400, /sku/)
  await espera(await get(`/api/custos/historico?cliente=${q}&sku=${'S'.repeat(81)}`), 400, /longo demais/)
  const r = await get(`/api/custos/historico?cliente=${q}&sku=%20ABC-1%20&limite=5`)
  await espera(r, 200); assert.deepEqual(chamou('historicoSku').at(-1).a, [HC, 'ABC-1', 5]); assert.deepEqual(r.json, { sku: 'ABC-1', itens: [] })
})
await okA('GET /quarentena e /reconciliacao: enumerados estritos; as 9 listas aceitas', async () => {
  await espera(await get(`/api/custos/quarentena?cliente=${q}&estado=xyz`), 400)
  const r = await get(`/api/custos/quarentena?cliente=${q}`); await espera(r, 200)
  assert.equal(r.json.estado, 'pendente'); assert.equal(r.json.itens.length, 1)
  await espera(await get(`/api/custos/reconciliacao?cliente=${q}`), 400, /lista/)
  for (const lixo of ['lista=foo', 'lista=conflito&lista=quarentena', 'lista=conflito&limite=1001']) await espera(await get(`/api/custos/reconciliacao?cliente=${q}&${lixo}`), 400)
  for (const l of ['sku_erp_sem_anuncio', 'anuncio_sem_custo', 'anuncio_sem_sku', 'conflito', 'rejeitadas', 'quarentena', 'nao_visto', 'kits_pendentes', 'divergencia_fontes']) {
    const x = await get(`/api/custos/reconciliacao?cliente=${q}&lista=${l}`); await espera(x, 200); assert.equal(x.json.lista, l)
  }
})

// ═══ webhook da planilha: segredo UMA vez, no-store, nunca no resumo nem no log ═════════════════════════
await okA('gerar sem PUBLIC_BASE_URL (ou com http) => 409 e NADA é gerado', async () => {
  for (const u of ['', 'http://tunel.exemplo.test']) {
    env.PUBLIC_BASE_URL = u
    await espera(await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'gerar', por: 'David' }), 409, /PUBLIC_BASE_URL/)
  }
  env.PUBLIC_BASE_URL = URL_PUB
  assert.equal(chamou('gerarWebhook').length, 0)
  await espera(await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'apagar', por: 'David' }), 400, /acao/)
})
let segredo1
await okA('gerar: devolve URL + segredo + Apps Script pronto, com Cache-Control: no-store; 2ª geração => 409 (use rotacionar)', async () => {
  const r = await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'gerar', por: 'David' })
  await espera(r, 200); assert.equal(r.cache, 'no-store')
  segredo1 = r.json.segredo
  assert.match(segredo1, /^[0-9a-f]{64}$/); assert.match(r.json.url, /^https:\/\/tunel\.exemplo\.test\/webhook\/custos\/[A-Za-z0-9_-]{22}$/)
  assert.ok(r.json.script.includes(segredo1) && r.json.script.includes(r.json.url), 'script pronto com URL e segredo preenchidos')
  assert.deepEqual(chamou('gerarWebhook').at(-1).a, [HC, 'sheets'])
  await espera(await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'gerar', por: 'David' }), 409, /rotacionar/)
})
await okA('GET /resumo: monta fontes + webhook + credenciais e NUNCA mostra segredo/token (mesmo se o módulo vazar)', async () => {
  const r = await get(`/api/custos/resumo?cliente=${q}`); await espera(r, 200)
  for (const s of [...segredosEmitidos, 'v1.vazado', 'rt-vazado', 'segredo', 'secret', 'token', 'cifrad']) assert.ok(!r.texto.includes(s), `resumo vazou "${s.slice(0, 8)}"`)
  assert.equal(r.json.cliente, HC); assert.equal(r.json.fontes.sheets.webhook.ativo, true); assert.equal(r.json.fontes.sheets.contagens.skus, 3)
  assert.deepEqual(Object.keys(r.json.fontes.bling.credenciais).sort(), ['company_id', 'conectado', 'escopos', 'expira_em', 'modo_app'])
  assert.equal(r.json.cfg.limiar_variacao_pct, 50); assert.equal(r.json.pendencias[0].codigo, 'CUSTO_QUARENTENA')
  assert.equal(r.json.reconciliacao_disponivel, false); assert.match(r.json.reconciliacao_motivo, /coleta de promoções/)
  assert.equal(r.json.efetivo.skus_com_custo, 3)
})
await okA('rotacionar: segredo novo (≠ anterior) uma vez; desativar: sem segredo; auditoria com "por" e sem segredo', async () => {
  const r = await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'rotacionar', por: 'David' })
  await espera(r, 200); assert.equal(r.cache, 'no-store'); assert.notEqual(r.json.segredo, segredo1); assert.ok(r.json.script.includes(r.json.segredo))
  const d = await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'desativar', por: 'Ana' })
  await espera(d, 200); assert.equal(d.json.webhook.ativo, false)
  for (const s of segredosEmitidos) assert.ok(!d.texto.includes(s))
  const aud = R.listarAuditoria(HC, { evento: 'custos_gestao' }).filter(a => a.detalhe.startsWith('webhook'))
  assert.deepEqual(aud.map(a => `${a.detalhe.split(' (')[0]}:${a.autor}`).sort(), ['webhook da planilha: desativar:Ana', 'webhook da planilha: gerar:David', 'webhook da planilha: rotacionar:David'])
  assert.ok(!JSON.stringify(aud).match(/[0-9a-f]{64}/), 'auditoria sem segredo')
})
await okA('Apps Script falha DEPOIS de gerar: o segredo ainda é devolvido (com aviso), e o log não o contém', async () => {
  const logs = [], orig = console.error
  console.error = (...a) => logs.push(a.join(' '))
  script.gerarScriptApps = () => { throw new Error(`segredo inválido: ${segredosEmitidos.at(-1)}`) }
  try {
    const r = await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'rotacionar', por: 'David' })
    await espera(r, 200); assert.equal(r.json.script, null); assert.match(r.json.aviso, /não aparecem de novo/); assert.match(r.json.segredo, /^[0-9a-f]{64}$/)
  } finally { console.error = orig; script.gerarScriptApps = reg('gerarScriptApps', a => scriptReal(a)) }
  assert.ok(logs.length && logs.every(l => !segredosEmitidos.some(s => l.includes(s))), 'log sem segredo')
})
await okA('sem ERP_TOKEN_KEY (erro ERP_SEM_CHAVE do M2/M6) => 409 com instrução, nunca 500', async () => {
  const g = webhook.rotacionarSegredo, s = credenciais.salvarCredenciaisApp
  webhook.rotacionarSegredo = () => { throw new Error('ERP_SEM_CHAVE') }
  credenciais.salvarCredenciaisApp = () => { throw Object.assign(new Error('sem chave'), { code: 'ERP_SEM_CHAVE' }) }
  try {
    await espera(await post('/api/custos/fontes/sheets/webhook', { cliente: HC, acao: 'rotacionar', por: 'David' }), 409, /ERP_TOKEN_KEY/)
    await espera(await post('/api/custos/erp/credenciais', { cliente: HC, fonte: 'tiny', client_id: 'id-1234', client_secret: 'sec-1234', por: 'David' }), 409, /ERP_TOKEN_KEY/)
  } finally { webhook.rotacionarSegredo = g; credenciais.salvarCredenciaisApp = s }
})

// ═══ credenciais de ERP: validadas, nunca ecoadas ═══════════════════════════════════════════════════════
const SEC = 'Sup3rS3cr3t0-do-app-' + randomBytes(6).toString('hex')
await okA('app global: só Bling; client_id/secret obrigatórios e sem espaço; erro NÃO ecoa o valor; resposta {ok:true} sem eco', async () => {
  await espera(await post('/api/custos/erp/app-global', { fonte: 'tiny', client_id: 'id-1234', client_secret: SEC, por: 'David' }), 400, /fonte/)
  await espera(await post('/api/custos/erp/app-global', { fonte: 'bling', client_secret: SEC, por: 'David' }), 400, /client_id/)
  for (const ruim of [`${SEC} x`, null, ['a'], 'abc', 12345678]) {
    const r = await post('/api/custos/erp/app-global', { fonte: 'bling', client_id: 'id-1234', client_secret: ruim, por: 'David' })
    await espera(r, 400, /client_secret/); assert.ok(!r.texto.includes(SEC))
  }
  assert.equal(chamou('salvarAppGlobal').length, 0)
  const r = await post('/api/custos/erp/app-global', { fonte: 'bling', client_id: ' id-1234 ', client_secret: ` ${SEC} `, por: 'David', cliente: 'ignorado' })
  await espera(r, 200); assert.equal(r.texto, '{"ok":true}')
  assert.deepEqual(chamou('salvarAppGlobal').at(-1).a, ['bling', { client_id: 'id-1234', client_secret: SEC }, 'David'])
})
await okA('credenciais por cliente: Tiny só "proprio"; Bling exige modo_app; global não aceita chaves; resposta {ok:true} sem eco', async () => {
  const base = { cliente: HC, por: 'David' }
  await espera(await post('/api/custos/erp/credenciais', { ...base, fonte: 'tiny', modo_app: 'global', client_id: 'id-1234', client_secret: SEC }), 400, /modo_app/)
  await espera(await post('/api/custos/erp/credenciais', { ...base, fonte: 'bling', client_id: 'id-1234', client_secret: SEC }), 400, /modo_app/)
  await espera(await post('/api/custos/erp/credenciais', { ...base, fonte: 'bling', modo_app: 'proprio', client_id: 'id-1234' }), 400, /client_secret/)
  await espera(await post('/api/custos/erp/credenciais', { ...base, fonte: 'bling', modo_app: 'global', client_secret: SEC }), 400, /global/)
  await espera(await post('/api/custos/erp/credenciais', { ...base, fonte: 'sheets', modo_app: 'proprio', client_id: 'id-1234', client_secret: SEC }), 400, /fonte/)
  assert.equal(chamou('salvarCredenciaisApp').length, 0)
  const t = await post('/api/custos/erp/credenciais', { ...base, fonte: 'TINY', client_id: 'tiny-api-1234', client_secret: SEC })
  await espera(t, 200); assert.equal(t.texto, '{"ok":true}')
  assert.deepEqual(chamou('salvarCredenciaisApp').at(-1).a, [HC, 'tiny', { modo_app: 'proprio', client_id: 'tiny-api-1234', client_secret: SEC }, 'David'])
  const g = await post('/api/custos/erp/credenciais', { ...base, fonte: 'bling', modo_app: 'global' })
  await espera(g, 200); assert.deepEqual(chamou('salvarCredenciaisApp').at(-1).a, [HC, 'bling', { modo_app: 'global' }, 'David'])
})
await okA('autorizar devolve o link (com state do M6); desconectar avisa onde desinstalar; ambos auditados', async () => {
  await espera(await post('/api/custos/erp/autorizar', { cliente: HC, fonte: 'sheets', por: 'David' }), 400, /fonte/)
  const a = await post('/api/custos/erp/autorizar', { cliente: HC, fonte: 'bling', por: 'David' })
  await espera(a, 200); assert.match(a.json.url, /^https:\/\/www\.bling\.com\.br\/.*state=st-bling$/)
  const d = await post('/api/custos/erp/desconectar', { cliente: HC, fonte: 'bling', por: 'David' })
  await espera(d, 200); assert.match(d.json.aviso, /Minhas Instalações/); assert.deepEqual(chamou('desconectarErp').at(-1).a, [HC, 'bling', 'David'])
  const det = R.listarAuditoria(HC, { evento: 'custos_gestao' }).filter(x => x.autor === 'David').map(x => x.detalhe)
  assert.ok(det.some(x => /^bling: link de autorização/.test(x)) && det.some(x => /^bling: desconectar/.test(x)))
})

// ═══ sincronizar agora + job ═════════════════════════════════════════════════════════════════════════════
await okA('sincronizar: planilha/fonte lixo => 400; ERP => 202 {job_id}; já rodando => 409; job só para o próprio cliente', async () => {
  await espera(await post('/api/custos/fontes/sincronizar', { cliente: HC, fonte: 'sheets', por: 'David' }), 400, /planilha/)
  await espera(await post('/api/custos/fontes/sincronizar', { cliente: HC, fonte: 'sap', por: 'David' }), 400, /fonte/)
  const r = await post('/api/custos/fontes/sincronizar', { cliente: HC, fonte: 'bling', por: 'David' })
  await espera(r, 202); assert.deepEqual(r.json, { job_id: 'ej-1' }); assert.deepEqual(chamou('iniciarSync').at(-1).a.slice(0, 2), [HC, 'bling'])
  await espera(await post('/api/custos/fontes/sincronizar', { cliente: HC, fonte: 'bling', por: 'David' }), 409, /rodando/)
  const j = await get(`/api/custos/job/ej-1?cliente=${q}`); await espera(j, 200); assert.equal(j.json.estado, 'rodando')
  await espera(await get(`/api/custos/job/ej-1?cliente=${encodeURIComponent(HB)}`), 404, /job/)
  await espera(await get(`/api/custos/job/nao-existe?cliente=${q}`), 404, /job/)
})

// ═══ quarentena em lote, descarte, configuração ═════════════════════════════════════════════════════════
await okA('decidir quarentena em lote: itens/decisão estritos (lixo => 400, nada decidido); lote válido normalizado', async () => {
  const base = { cliente: HC, por: 'David', decisao: 'aprovar' }
  for (const itens of [undefined, null, [], 'X1', [null], [['X1', 'sheets']], [{ sku: 'X1' }], [{ sku: 'X1', fonte: 'manual' }], [{ sku: '', fonte: 'sheets' }], [{ sku: ['X1'], fonte: 'sheets' }], Array.from({ length: 2001 }, () => ({ sku: 'X', fonte: 'sheets' }))])
    await espera(await post('/api/custos/quarentena/decidir', { ...base, itens }), 400)
  for (const decisao of [undefined, '', 'talvez', null, ['aprovar']]) await espera(await post('/api/custos/quarentena/decidir', { ...base, decisao, itens: [{ sku: 'X1', fonte: 'sheets' }] }), 400, /decisao/)
  assert.equal(chamou('decidirQuarentena').length, 0)
  const r = await post('/api/custos/quarentena/decidir', { ...base, decisao: 'Recusar', itens: [{ sku: ' X1 ', fonte: 'SHEETS' }, { sku: 'X2', fonte: 'bling' }, { sku: 'X3', fonte: 'tiny', extra: 1 }] })
  await espera(r, 200); assert.deepEqual(r.json, { aprovados: 0, recusados: 3, ignorados: 0 })
  assert.deepEqual(chamou('decidirQuarentena').at(-1).a, [HC, [{ sku: 'X1', fonte: 'sheets' }, { sku: 'X2', fonte: 'bling' }, { sku: 'X3', fonte: 'tiny' }], 'recusar', 'David'])
})
await okA('descartar: fonte externa obrigatória (manual => 400), sku obrigatório; válido repassa com "por"', async () => {
  for (const b of [{ fonte: 'sheets' }, { sku: 'X1' }, { sku: 'X1', fonte: 'manual' }, { sku: null, fonte: 'sheets' }]) await espera(await post('/api/custos/descartar', { cliente: HC, por: 'David', ...b }), 400)
  const r = await post('/api/custos/descartar', { cliente: HC, por: 'David', sku: 'X1', fonte: 'tiny' })
  await espera(r, 200); assert.deepEqual(r.json, { ok: true, descartado: true }); assert.deepEqual(chamou('descartarCusto').at(-1).a, [HC, 'X1', 'tiny', 'David'])
})
await okA('config: presente porém inválido => 400 (null, [], repetição, fora da faixa, texto); patch só com o enviado', async () => {
  const lixos = [{}, { ordem_fontes: null }, { ordem_fontes: [] }, { ordem_fontes: 'manual,bling' }, { ordem_fontes: ['bling', 'bling'] }, { ordem_fontes: ['erp'] },
    { limiar_variacao_pct: null }, { limiar_variacao_pct: 0 }, { limiar_variacao_pct: '50%' }, { limiar_variacao_pct: [50] }, { quarentena_custo_ge_preco: 'talvez' }, { quarentena_custo_ge_preco: null },
    { campo_custo_tiny: 'medio' }, { campo_custo_tiny: null }, { velho_dias_erp: 0 }, { velho_dias_erp: '3.5' }, { velho_dias_sheets: null }, { velho_dias_sheets: 366 }]
  for (const b of lixos) await espera(await post('/api/custos/config', { cliente: HC, por: 'David', ...b }), 400)
  assert.equal(chamou('setCfgCustos').length, 0)
  const r = await post('/api/custos/config', { cliente: HC, por: 'David', ordem_fontes: ['manual', 'sheets'], limiar_variacao_pct: '75', quarentena_custo_ge_preco: false, campo_custo_tiny: 'CUSTO_MEDIO', velho_dias_sheets: '7', desconhecido: 1 })
  await espera(r, 200); assert.equal(r.json.ok, true); assert.ok(r.json.cfg)
  assert.deepEqual(chamou('setCfgCustos').at(-1).a, [HC, { ordem_fontes: ['manual', 'sheets'], limiar_variacao_pct: 75, quarentena_custo_ge_preco: 0, campo_custo_tiny: 'custo_medio', velho_dias_sheets: 7 }, 'David'])
})
await okA('erro 400 do núcleo passa com a mensagem; erro inesperado => 500 genérico, sem stack, e o log sai sem token', async () => {
  const s = nucleo.setCfgCustos, p = nucleo.pendenciasCustos, logs = [], orig = console.error
  nucleo.setCfgCustos = () => { throw Object.assign(new Error('limiar acima do permitido pelo núcleo'), { status: 400 }) }
  nucleo.pendenciasCustos = () => { throw new Error('falhou com Authorization: Bearer abc.def.ghi e refresh_token=rt123') }
  console.error = (...a) => logs.push(a.join(' '))
  try {
    await espera(await post('/api/custos/config', { cliente: HC, por: 'David', limiar_variacao_pct: 900 }), 400, /núcleo/)
    const r = await get(`/api/custos/pendencias?cliente=${q}`)
    await espera(r, 500); assert.deepEqual(r.json, { erro: 'erro interno no módulo de custos (veja o log do servidor)' })
  } finally { nucleo.setCfgCustos = s; nucleo.pendenciasCustos = p; console.error = orig }
  assert.ok(logs.length && logs.every(l => !l.includes('abc.def.ghi') && !l.includes('rt123')), `log sem token: ${logs}`)
})

srv.close()
console.log(`✔ teste-custos-rotas: ${n} verificações OK`)
