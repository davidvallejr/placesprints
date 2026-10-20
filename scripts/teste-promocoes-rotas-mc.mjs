// Regressão da frente ROTAS/MC do módulo Promoções: custos (parse/rejeição), validação de entrada das rotas, setConfig tipado,
// guard anti-CSRF e "mutação só lê o corpo JSON". Um caso por achado corrigido (4, 17, 26, 27, 28, 45, 47, 48, 49, 53).
// Banco EM MEMÓRIA, sem rede; o guard é testado contra o middleware com req/res simulados (sem abrir porta). As rotas usam
// Express em porta efêmera de loopback (mesma técnica do teste-promocoes.mjs). Rodar: node scripts/teste-promocoes-rotas-mc.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // tem de vir ANTES dos imports dinâmicos (o módulo lê isto no carregamento)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const M = await import('../src/lib/promocoes-mc.js')
const R = await import('../src/lib/promocoes-db.js')
const G = await import('../src/lib/guarda-local.js')
const Rotas = await import('../src/rotas-promocoes.js')
const express = (await import('express')).default
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')

let n = 0
const ok = (nome, fn) => { try { fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }

// ── servidor de teste: json + rotas (o guard global é testado à parte, como função) ──────────────────────
const HC = 'Cliente Rotas', HOJE = '2026-10-05'
const app = express(); app.use(express.json({ limit: '1mb' })); app.use(Rotas.rotasPromocoes)
const srv = await new Promise(r => { const sv = app.listen(0, '127.0.0.1', () => r(sv)) })
const BASE = `http://127.0.0.1:${srv.address().port}`
Object.assign(Rotas.depsPromocoes, { conexoes: () => [{ cliente: HC, nickname: 'x' }], hoje: HOJE, custosCliente: null, coletaPromocoesDoCliente: () => null })   // interruptor: null = padrão da base (sem abrir perfil_cliente do banco real)
const bruto = async (metodo, caminho, { corpo, tipo = 'application/json' } = {}) => {
  const r = await fetch(BASE + caminho, { method: metodo, headers: tipo ? { 'Content-Type': tipo } : {}, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })
  const t = r.headers.get('content-type') || '', json = t.includes('json')
  return { status: r.status, json: json ? await r.json() : null, texto: json ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer()) }
}
const post = (c, corpo) => bruto('POST', c, { corpo }), get = c => bruto('GET', c), q = encodeURIComponent(HC)

// ── dados sintéticos (mesma forma do teste-promocoes.mjs) ────────────────────────────────────────────────
const of = (item_id, pid, o = {}) => ({ item_id, pid, offer_id: `OFFER-${item_id}-${pid}`, tipo: 'SMART', subtipo: '', nome: `Camp ${pid}`, status: 'candidate', preco: 100, preco_original: 120, meli_pct: 5, seller_pct: 0, inicio: '', fim: '2026-12-31T23:59:59', min_preco: null, max_preco: null, sugerido: null, fonte: 'item', ...o })
const an = (item_id, o = {}) => ({ item_id, sku: `${item_id}-SKU`, sku_fonte: 'teste', titulo: `Anúncio ${item_id}`, permalink: '', status: 'active', sub_status: '', under_review: false, preco: 100, preco_original: 120, estoque: 10, categoria: 'MLB1', tipo_anuncio: 'gold_special', catalogo: false, user_product_id: '', curva: 'C', fat30: 0, unid30: 0, protegido: false, lido_em: '2026-10-05T10:00:00Z', oferta_erro: '', tarifa: { comissao_pct: 15, taxa_fixa: 0, frete: 10 }, tarifa_json: '', tarifa_estado: '', ...o })
const coletaSint = (cliente, anuncios, ofertas) => {
  const id = 'T' + Math.random().toString(36).slice(2, 7)
  R.iniciarColeta(cliente, id)
  R.gravarColeta(cliente, { coletaId: id, campanhas: [], anuncios: anuncios.map(a => ({ ...a, under_review: 0, catalogo: 0, tarifa_json: JSON.stringify(a.tarifa), tarifa_estado: '' })), ofertasPorItem: R.agruparPorItem(ofertas), resumo: {}, limites: [] })
}
// MLB1: anúncio comum; MLB9: protegido com campanha started que acaba em 15/10 (HOJE+10) — só aparece como "descoberto" em janela >= 11 dias
coletaSint(HC, [an('MLB1'), an('MLB9')], [of('MLB9', 'PX', { status: 'started', preco: 90, inicio: '2026-10-01', fim: '2026-10-15T23:59:59' })])
R.definirProtegido(HC, 'MLB9', true, 'teste')
const custosDe = () => Object.fromEntries(R.listarCustosSku(HC).map(c => [c.sku, c.custo]))

// ═══ idx 4 / 17 / 26 — custo ausente/vazio/null/NaN/≤0 nunca vira custo válido ═══════════════════════════
await okA('custos por "linhas": ausente, "", null, "  ", [], 0, "0,00", false, negativo e texto lixo são REJEITADOS com motivo; só custo > 0 entra', async () => {
  const linhas = [{ sku: 'A' }, { sku: 'B', custo: '' }, { sku: 'C', custo: null }, { sku: 'D', custo: '  ' }, { sku: 'E', custo: [] }, { sku: 'F', custo: 0 },
    { sku: 'G', custo: '0,00' }, { sku: 'H', custo: false }, { sku: 'I', custo: 'NaN' }, { sku: 'J', custo: -3 }, { sku: 'OK1', custo: '12,50' }, { sku: 'OK2', custo: 7 }, { sku: 'OK3', custo: '1.234,56' }]
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, linhas })
  assert.equal(r.status, 200); assert.equal(r.json.importados, 3); assert.equal(r.json.total_rejeitadas, 10)
  assert.ok(r.json.rejeitadas.length === 10 && r.json.rejeitadas.every(x => x.linha > 0 && x.motivo), 'a resposta lista cada rejeitada com motivo')
  assert.deepEqual(custosDe(), { OK1: 12.5, OK2: 7, OK3: 1234.56 }, 'nenhum custo 0 gravado')
})
await okA('texto colado: "SKU;0", "SKU;" e custo ambíguo ("1,234") são rejeitados; "R$ 8" e "1.234,56" entram', async () => {
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, texto: 'AB;0\nAB2;\nAB3;1,234\nOKT;R$ 8\nOKU;1.234,56' })
  assert.equal(r.json.importados, 2); assert.equal(r.json.total_rejeitadas, 3)
  assert.equal(custosDe().OKT, 8); assert.equal(custosDe().OKU, 1234.56); assert.ok(!('AB' in custosDe()) && !('AB3' in custosDe()))
})
await okA('importação 100% inválida => 400 com a lista "rejeitadas" na resposta (nada gravado)', async () => {
  const antes = JSON.stringify(custosDe())
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, linhas: [{ sku: 'Z' }, { sku: 'Y', custo: 0 }] })
  assert.equal(r.status, 400); assert.equal(r.json.total_rejeitadas, 2); assert.equal(r.json.rejeitadas.length, 2); assert.match(r.json.erro, /nenhuma linha válida/)
  assert.equal(JSON.stringify(custosDe()), antes)
})
await okA('custo válido NUNCA é sobrescrito por linha inválida', async () => {
  await post('/api/promocoes/custos/importar', { cliente: HC, linhas: [{ sku: 'KEEP', custo: 10 }] })
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, linhas: [{ sku: 'KEEP', custo: null }, { sku: 'KEEP', custo: 0 }, { sku: 'OUTRO', custo: 5 }] })
  assert.equal(r.json.importados, 1); assert.equal(custosDe().KEEP, 10)
})
await okA('texto > 900.000 caracteres é recusado (cortar no meio truncaria o último custo)', async () => {
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, texto: `${'S'.repeat(80)};1\n`.repeat(11_300) })       // ~915 mil caracteres (< 1 MB do body JSON)
  assert.equal(r.status, 400); assert.match(r.json.erro, /longo demais/)
})
ok('resolverCustos: custo de SKU 0 (ou legado gravado como 0) => SEM CUSTO, nunca MC inflada', () => {
  const c = M.resolverCustos({ custoSku: 0, tarifaItem: { comissao_pct: 15, frete: 10 }, impostoPct: 10, precoRef: 120 })
  assert.equal(c.ok, false); assert.equal(c.estado, 'SEM CUSTO'); assert.ok(c.faltando.includes('custo'))
  assert.equal(M.resolverCustos({ custoSku: 45, tarifaItem: { comissao_pct: 15, frete: 10 }, impostoPct: 10, precoRef: 120 }).ok, true)
})
await okA('linha legada com custo 0 no banco aparece como SKU SEM custo na aba Custos (e não como cadastrada)', async () => {
  R.importarCustosSku(HC, [{ sku: 'MLB1-SKU', custo: 0 }], 'legado')      // como o bug antigo gravava
  const d = (await get(`/api/promocoes/custos?cliente=${q}`)).json
  assert.ok(d.skus_sem_custo.some(s => s.sku === 'MLB1-SKU'), 'custo 0 não conta como cadastrado')
})
ok('lerCusto: só número finito > 0 (ambíguo explica como escrever)', () => {
  assert.match(M.lerCusto('1.200').motivo, /milhar ou decimal/); assert.match(M.lerCusto('R$ 1,234').motivo, /1200/)
  for (const v of [undefined, null, '', '  ', [], {}, true, false, 0, '0', '0,00', -1, NaN, Infinity, 'abc', '1,234', 2e7]) assert.ok(M.lerCusto(v).motivo, `lerCusto(${String(v)}) deve ser rejeitado`)
  assert.equal(M.lerCusto(1.234).custo, 1.234, 'número JSON é número (não é "mil duzentos")'); assert.equal(M.lerCusto('12,50').custo, 12.5)
})

// ═══ idx 27 — linha sem separador / vírgulas demais não vira SKU truncado com custo inventado ═══════════
ok('parseCustosCsv: "10234", "55" e "ABC,12,50" são rejeitados (nunca {sku:"1023",custo:10234})', () => {
  const r = M.parseCustosCsv('10234\n55\nABC,12,50\nAB-3,7.5\nAB-4;3')
  assert.deepEqual(r.linhas, [{ sku: 'AB-3', custo: 7.5 }, { sku: 'AB-4', custo: 3 }])
  assert.equal(r.rejeitadas.length, 3); assert.ok(r.rejeitadas.every(x => x.motivo))
})
await okA('importação por texto de uma coluna de SKUs numéricos não sobrescreve o custo do SKU "1023"', async () => {
  await post('/api/promocoes/custos/importar', { cliente: HC, linhas: [{ sku: '1023', custo: 50 }] })
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, texto: '10234\nCERTO;3' })
  assert.equal(r.json.importados, 1); assert.equal(custosDe()['1023'], 50); assert.ok(!('1023' in custosDe()) === false)
})

// ═══ idx 45 — formato BR × US; ambíguo rejeita ═══════════════════════════════════════════════════════════
ok('parseNumeroBR: "1.234,56" e "1,234.56" => 1234.56; "0.500" => 0.5; ambíguo/lixo => null', () => {
  const casos = { '1.234,56': 1234.56, '1,234.56': 1234.56, 'R$ 1,234.56': 1234.56, '1.234.567,89': 1234567.89, '1,234,567.89': 1234567.89, '12,5': 12.5, '12.50': 12.5, '0.500': 0.5, '0,500': 0.5, '1234': 1234, '1.234.567': 1234567 }
  for (const [v, esperado] of Object.entries(casos)) assert.equal(M.parseNumeroBR(v), esperado, `parseNumeroBR(${v})`)
  for (const v of ['1,234', '1.234', '1.23.456', '1.234,56,7', '1,234.567,89', '12,', '.5', '-5', '1e3', 'x', '', null, undefined]) assert.equal(M.parseNumeroBR(v), null, `parseNumeroBR(${v}) deve ser null`)
})

// ═══ idx 28 — guard anti-CSRF: Origin presente == host:porta do próprio painel ═══════════════════════════
const guarda = req => {
  const out = { next: false }
  const res = { status(c) { out.status = c; return this }, send(t) { out.corpo = t; return this } }
  G.guardaLocal({ method: 'GET', path: '/x', ...req, headers: { ...req.headers } }, res, () => { out.next = true })
  return out
}
ok('guard: POST com Origin de OUTRA porta local (localhost:3005 → painel :3012) é bloqueado', () => {
  for (const origin of ['http://localhost:3005', 'http://127.0.0.1:3009', 'http://[::1]:3007', 'http://localhost']) {
    const r = guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host: 'localhost:3012', origin } })
    assert.equal(r.next, false, origin); assert.equal(r.status, 403, origin)
  }
})
ok('guard: mesma origem (localhost e 127.0.0.1, cada um com o seu host) e requisição sem Origin passam', () => {
  assert.equal(guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host: 'localhost:3012', origin: 'http://localhost:3012' } }).next, true)
  assert.equal(guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host: '127.0.0.1:3012', origin: 'http://127.0.0.1:3012' } }).next, true)
  assert.equal(guarda({ method: 'DELETE', path: '/api/promocoes/regras-sku', headers: { host: '[::1]:3012', origin: 'http://[::1]:3012' } }).next, true)
  assert.equal(guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host: 'LOCALHOST:3012', origin: 'http://localhost:3012' } }).next, true, 'caixa do host não importa')
  assert.equal(guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host: 'localhost:3012' } }).next, true, 'curl/servidor→servidor: sem Origin')
})
ok('guard: Origin localhost com Host 127.0.0.1 (ou o contrário), "null", lixo e esquema estranho são bloqueados', () => {
  for (const [host, origin] of [['127.0.0.1:3012', 'http://localhost:3012'], ['localhost:3012', 'http://127.0.0.1:3012'], ['localhost:3012', 'null'], ['localhost:3012', 'lixo'], ['localhost:3012', 'file://localhost:3012'], ['localhost:3012', 'https://evil.example']])
    assert.equal(guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host, origin } }).status, 403, `${host} × ${origin}`)
})
ok('guard: GET com Origin estranho segue (não muta); Host não-loopback continua barrado', () => {
  assert.equal(guarda({ method: 'GET', path: '/api/promocoes/resumo', headers: { host: 'localhost:3012', origin: 'http://localhost:3005' } }).next, true)
  const r = guarda({ method: 'GET', path: '/api/promocoes/resumo', headers: { host: 'evil.example' } }); assert.equal(r.next, false); assert.equal(r.status, 403)
})
ok('guard: rotas públicas (/meli/, /webhook/notion, /webhook/meli) seguem funcionando pelo túnel; o resto do túnel é barrado', () => {
  const tunel = 'abc-123.trycloudflare.com'
  assert.equal(guarda({ method: 'POST', path: '/webhook/notion', headers: { host: tunel } }).next, true)
  assert.equal(guarda({ method: 'POST', path: '/webhook/meli', headers: { host: tunel } }).next, true)
  assert.equal(guarda({ method: 'GET', path: '/meli/callback', headers: { host: tunel } }).next, true)
  assert.equal(guarda({ method: 'GET', path: '/meli/conectar', headers: { host: tunel } }).next, true)
  assert.equal(guarda({ method: 'POST', path: '/webhook/notion', headers: { host: tunel, origin: `https://${tunel}` } }).next, true, 'same-origin pelo túnel')
  assert.equal(guarda({ method: 'POST', path: '/api/promocoes/config', headers: { host: tunel } }).status, 403)
  assert.equal(guarda({ method: 'GET', path: '/promocoes', headers: { host: tunel } }).status, 403)
})
ok('guard: webhook de custos (só com wid de 16–64) e /erp/callback passam pelo túnel; sem wid, caminho extra, prefixo aberto e /api/custos/* = 403', () => {
  const tunel = 'abc-123.trycloudflare.com', wid = 'AbCdEfGhIjKlMnOpQrStUv'          // 22 caracteres base64url, como o gerarWebhook
  assert.equal(guarda({ method: 'POST', path: `/webhook/custos/${wid}`, headers: { host: tunel } }).next, true)
  assert.equal(guarda({ method: 'POST', path: `/webhook/custos/${'a'.repeat(64)}`, headers: { host: tunel } }).next, true)
  assert.equal(guarda({ method: 'GET', path: '/erp/callback', headers: { host: tunel } }).next, true)
  for (const path of ['/webhook/custos', '/webhook/custos/', `/webhook/custos/${wid}/x`, '/webhook/custos/x/y', '/webhook/custos/curto', `/webhook/custos/${'a'.repeat(65)}`,
    `/webhook/custos/${wid}.json`, '/webhook/custosX', '/erp/callbackX', '/erp/callback/x', '/erp/autorizar', '/api/custos/resumo', '/api/custos/fontes/sheets/webhook', '/webhook/meliXYZ', '/webhook/notionX'])
    assert.equal(guarda({ method: 'POST', path, headers: { host: tunel } }).status, 403, path)
  assert.equal(guarda({ method: 'POST', path: '/webhook/meli/', headers: { host: tunel } }).next, true, 'barra final opcional (o Express aceita)')
})
ok('regressão idx 34: só rotas públicas EXATAS pelo túnel; %2F/%5C/".." (qualquer caixa) = 403; loopback segue livre', () => {
  const tunel = 'meli.place2u.com.br', wid = 'AbCdEfGhIjKlMnOpQrStUv'
  for (const [method, path] of [['GET', '/meli/conectar'], ['GET', '/meli/callback'], ['GET', '/MELI/Callback'], ['POST', '/webhook/notion'], ['POST', '/webhook/meli'],
    ['POST', `/webhook/custos/${wid}`], ['GET', '/erp/callback'], ['GET', '/erp/callback/']])
    assert.equal(guarda({ method, path, originalUrl: `${path}?code=a%2Fb&state=x%5Cy`, headers: { host: tunel } }).next, true, `${path} (query com %2F não importa)`)
  for (const path of ['/meli/..%2findex.html', '/meli/..%2Findex.html', '/meli/conectar%2f..%2fapp.js', '/webhook/meli/..%2f..%2fintegracoes.js', '/webhook/meli/..%5Capp.js',
    '/webhook/meli/%5c', '/meli/../index.html', '/meli/callback/..', '/webhook/notion/x', '/webhook/meli/x', '/meli/', '/meli/outra', '/meli', `/webhook/custos/${wid}/..`, '/index.html', '/integracoes.js'])
    assert.equal(guarda({ method: 'GET', path, headers: { host: tunel } }).status, 403, path)
  // reforço: mesmo se o caminho casasse, %2F/%5C/".." no originalUrl derruba (montagem em sub-roteador muda o req.path)
  for (const originalUrl of ['/meli/conectar%2F', '/x/..%5c/meli/callback', '/a/../meli/callback'])
    assert.equal(guarda({ method: 'GET', path: '/meli/callback', originalUrl, headers: { host: tunel } }).status, 403, originalUrl)
  assert.equal(guarda({ method: 'GET', path: '/meli/..%2findex.html', headers: { host: 'localhost:3012' } }).next, true, 'no loopback o painel segue livre')
})
ok('guard: o server.js usa o guard compartilhado (nenhum regex "qualquer porta localhost" sobrou)', () => {
  const src = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(src, /import \{ guardaLocal \} from '\.\/lib\/guarda-local\.js'/); assert.match(src, /app\.use\(guardaLocal\)/); assert.doesNotMatch(src, /ORIGEM_LOCAL/)
})

// ═══ idx 28 — mutação lê SÓ o corpo JSON (nunca a query) e exige Content-Type: application/json ═════════
await okA('POST de config só com query string (sem corpo/Content-Type) => 415 e NADA muda (nem imposto 0, nem execução ligada)', async () => {
  assert.equal((await post('/api/promocoes/config', { cliente: HC, imposto_pct: 10 })).json.imposto_pct, 10)
  const ataque = `/api/promocoes/config?cliente=${q}&imposto_pct=0&execucao_habilitada=1&habilitacao=${encodeURIComponent('HABILITAR EXECUCAO REAL')}&execucao_max_itens=500`
  assert.equal((await bruto('POST', ataque, { tipo: null })).status, 415)
  assert.equal((await bruto('POST', ataque, { tipo: 'text/plain', corpo: '{}' })).status, 415, 'no-cors/form-simples vira text/plain ou urlencoded')
  assert.equal((await bruto('POST', ataque, { tipo: 'application/x-www-form-urlencoded', corpo: 'a=1' })).status, 415)
  const c = (await get(`/api/promocoes/config?cliente=${q}`)).json
  assert.equal(c.imposto_pct, 10); assert.equal(c.execucao_habilitada, 0); assert.equal(c.execucao_max_itens, 1)
})
await okA('com Content-Type JSON mas parâmetros na URL: a query é IGNORADA (cliente e campos só valem no corpo)', async () => {
  const semCliente = await bruto('POST', `/api/promocoes/config?cliente=${q}&imposto_pct=0`, { corpo: '{}' })
  assert.equal(semCliente.status, 400); assert.match(semCliente.json.erro, /cliente/)
  const r = await post(`/api/promocoes/config?imposto_pct=0&piso_mc=99`, { cliente: HC })     // corpo só tem o cliente: nada a alterar
  assert.equal(r.status, 200); assert.equal(r.json.imposto_pct, 10); assert.equal(r.json.piso_mc, 20)
  assert.equal((await post(`/api/promocoes/custos/importar?cliente=${q}&texto=${encodeURIComponent('SKU-Q;0,01')}`, { cliente: HC })).status, 400)
  assert.ok(!('SKU-Q' in custosDe()))
})
await okA('GET continua lendo a query; DELETE com corpo JSON funciona; outros métodos sem JSON => 415', async () => {
  assert.equal((await get(`/api/promocoes/config?cliente=${q}`)).status, 200)
  await post('/api/promocoes/regras-sku', { cliente: HC, sku: 'REG-1', status: 'Livre' })
  assert.equal((await bruto('DELETE', '/api/promocoes/regras-sku', { corpo: { cliente: HC, sku: 'REG-1' } })).status, 200)
  assert.equal((await bruto('DELETE', `/api/promocoes/regras-sku?cliente=${q}&sku=REG-1`, { tipo: null })).status, 415)
})

// ═══ idx 47 — inteiro(): ausente => padrão; presente inválido => 400 (nunca coerção p/ 0 preso no min) ═══
ok('inteiro: ausente => padrão; "", null, false, [], 0, -3, "abc", fora da faixa => 400', () => {
  assert.equal(Rotas.inteiro(undefined, 7, 1, 60, 'dias'), 7); assert.equal(Rotas.inteiro('14', 7, 1, 60, 'dias'), 14); assert.equal(Rotas.inteiro(14, 7, 1, 60, 'dias'), 14)
  for (const v of ['', null, false, true, [], ['7'], ['3', '4'], {}, 0, -3, 'abc', '7.5', 61, '61', NaN]) {
    assert.throws(() => Rotas.inteiro(v, 7, 1, 60, 'dias'), e => e.status === 400 && /dias/.test(e.message), `inteiro(${JSON.stringify(v)})`)
  }
})
await okA('POST /aprendizados/desativar: id null/""/false/0/-3/[]/ausente => 400 e o aprendizado #1 NÃO é desativado', async () => {
  const id = R.registrarAprendizado(HC, { padrao: 'x', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'ignorar mesmo', acao: 'ignorar' }, 'dono')
  for (const v of [null, '', false, 0, -3, [], 'abc', 1.5]) assert.equal((await post('/api/promocoes/aprendizados/desativar', { cliente: HC, id: v })).status, 400, `id=${JSON.stringify(v)}`)
  assert.equal((await post('/api/promocoes/aprendizados/desativar', { cliente: HC })).status, 400)
  assert.equal(R.listarAprendizados(HC).find(a => a.id === id).ativo, true)
  assert.equal((await post('/api/promocoes/aprendizados/desativar', { cliente: HC, id })).status, 200)
  assert.equal(R.listarAprendizados(HC).find(a => a.id === id).ativo, false)
})
await okA('GET com parâmetro presente porém inválido => 400 (dias=, limite=abc), ausente => padrão', async () => {
  assert.equal((await get(`/api/promocoes/participando?cliente=${q}&dias=`)).status, 400)
  assert.equal((await get(`/api/promocoes/participando?cliente=${q}&dias=0`)).status, 400)
  assert.equal((await get(`/api/promocoes/participando?cliente=${q}`)).status, 200)
  assert.equal((await get(`/api/promocoes/auditoria?cliente=${q}&limite=abc`)).status, 400)
  assert.equal((await get(`/api/promocoes/elegiveis?cliente=${q}&pagina=-1`)).status, 400)
})

// ═══ idx 48 — simNao()/enums: nada de padrão silencioso ═════════════════════════════════════════════════
ok('simNao: ausente => padrão; true/false/1/0/sim/não/yes/no (qualquer caixa) reconhecidos; o resto => 400', () => {
  assert.equal(Rotas.simNao(undefined), false); assert.equal(Rotas.simNao(undefined, true), true)
  for (const v of ['1', 'true', 'True', 'TRUE', 'sim', 'Sim', 'yes', 1, true]) assert.equal(Rotas.simNao(v, false, 'x'), true, String(v))
  for (const v of ['0', 'false', 'False', 'nao', 'não', 'no', 0, false]) assert.equal(Rotas.simNao(v, true, 'x'), false, String(v))
  for (const v of ['', null, [], ['sim'], [1], {}, 'talvez', 'on', 2, 'ture']) assert.throws(() => Rotas.simNao(v, false, 'protegido'), e => e.status === 400 && /protegido/.test(e.message), `simNao(${JSON.stringify(v)})`)
})
await okA('POST /protegido: "True"/"yes" protegem, "nao" remove; omitido ou "talvez" => 400 SEM mexer na proteção', async () => {
  const prot = () => R.lerAnuncios(HC).find(a => a.item_id === 'MLB1').protegido
  R.definirProtegido(HC, 'MLB1', true, 'teste'); assert.equal(prot(), true)
  assert.equal((await post('/api/promocoes/protegido', { cliente: HC, item_id: 'MLB1' })).status, 400); assert.equal(prot(), true, 'omitido NÃO remove a proteção')
  assert.equal((await post('/api/promocoes/protegido', { cliente: HC, item_id: 'MLB1', protegido: 'talvez' })).status, 400); assert.equal(prot(), true)
  assert.equal((await post('/api/promocoes/protegido', { cliente: HC, item_id: 'MLB1', protegido: 'True' })).status, 200); assert.equal(prot(), true, '"True" antes virava false e removia a proteção')
  assert.equal((await post('/api/promocoes/protegido', { cliente: HC, item_id: 'MLB1', protegido: 'yes' })).status, 200); assert.equal(prot(), true)
  assert.equal((await post('/api/promocoes/protegido', { cliente: HC, item_id: 'MLB1', protegido: 'nao' })).status, 200); assert.equal(prot(), false)
})
await okA('POST /aprendizados: acao "Ignorar" + escopo "Item" valem como ignorar/item; valor desconhecido => 400 (nunca "nota"/"global" calado)', async () => {
  const antes = R.listarAprendizados(HC).length
  const r = await post('/api/promocoes/aprendizados', { cliente: HC, acao: 'Ignorar', escopo_tipo: 'Item', escopo_valor: 'MLB1', resposta: 'não re-propor' })
  assert.equal(r.status, 200)
  const a = R.listarAprendizados(HC).find(x => x.id === r.json.id); assert.equal(a.acao, 'ignorar'); assert.equal(a.escopo_tipo, 'item')
  assert.equal((await post('/api/promocoes/aprendizados', { cliente: HC, acao: 'ignora', escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'x' })).status, 400)
  assert.equal((await post('/api/promocoes/aprendizados', { cliente: HC, acao: 'ignorar', escopo_tipo: 'anuncio', escopo_valor: 'MLB1', resposta: 'x' })).status, 400)
  assert.equal((await post('/api/promocoes/aprendizados', { cliente: HC, acao: null, escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'x' })).status, 400)
  assert.equal(R.listarAprendizados(HC).length, antes + 1, 'os 400 não gravaram nada')
  assert.equal((await post('/api/promocoes/aprendizados', { cliente: HC, escopo_tipo: 'item', escopo_valor: 'MLB1', resposta: 'só nota' })).status, 200, 'acao AUSENTE => padrão declarado (nota)')
})

// ═══ idx 49 — setConfig tipado: false/[]/true/[5] não viram número ══════════════════════════════════════
ok('setConfig (lib): booleano/lista/objeto/texto não numérico são rejeitados; imposto_pct:false NÃO vira 0%', () => {
  const C = 'Cliente Cfg'
  R.setConfig(C, { imposto_pct: 10, piso_mc: 20 }, 't')
  for (const v of [false, true, [], [5], {}, 'abc', '1e2', '-5', Infinity, NaN]) {
    for (const k of ['imposto_pct', 'piso_mc', 'piso_relampago', 'dias_vigia', 'execucao_max_itens']) assert.throws(() => R.setConfig(C, { [k]: v }, 't'), /inválido/, `${k}=${JSON.stringify(v)}`)
  }
  assert.equal(R.getConfig(C).imposto_pct, 10); assert.equal(R.getConfig(C).piso_mc, 20)
  assert.equal(R.setConfig(C, { imposto_pct: '12,5' }, 't').imposto_pct, 12.5, 'string numérica de <input> segue valendo')
  assert.equal(R.setConfig(C, { imposto_pct: '' }, 't').imposto_pct, null, 'vazio limpa só onde é permitido (imposto)')
  assert.throws(() => R.setConfig(C, { piso_mc: '' }, 't'), /vazio/)
  assert.equal(R.setConfig(C, { hedge_cobertura: false }, 't').hedge_cobertura, 0); assert.equal(R.setConfig(C, { hedge_cobertura: '1' }, 't').hedge_cobertura, 1)
  for (const v of ['talvez', [], [1], {}, 'abc']) assert.throws(() => R.setConfig(C, { hedge_cobertura: v }, 't'), /inválido/)
  assert.throws(() => R.setConfig(C, { piso_mc: 150 }, 't'), /inválido/); assert.throws(() => R.setConfig(C, { dias_vigia: 1.5 }, 't'), /inteiro/)
})
await okA('POST /config: tipos lixo => 400 sem alterar nada; execucao_habilitada:[1] NÃO liga a execução (nem com a frase)', async () => {
  const antes = JSON.stringify((await get(`/api/promocoes/config?cliente=${q}`)).json)
  for (const corpo of [{ imposto_pct: false }, { piso_mc: [] }, { piso_relampago: true }, { dias_vigia: [5] }, { execucao_max_itens: {} },
    { execucao_habilitada: [1], habilitacao: 'HABILITAR EXECUCAO REAL' }, { execucao_habilitada: null, habilitacao: 'HABILITAR EXECUCAO REAL' }, { execucao_habilitada: 'abc' }, { hedge_cobertura: 'talvez' }])
    assert.equal((await post('/api/promocoes/config', { cliente: HC, ...corpo })).status, 400, JSON.stringify(corpo))
  assert.equal(JSON.stringify((await get(`/api/promocoes/config?cliente=${q}`)).json), antes, 'nenhum 400 deixou rastro')
  assert.equal((await post('/api/promocoes/config', { cliente: HC, execucao_habilitada: true })).status, 403, 'ligar continua exigindo a frase')
  assert.equal((await post('/api/promocoes/config', { cliente: HC, imposto_pct: '12,5', hedge_cobertura: '0' })).json.imposto_pct, 12.5)
  assert.equal((await post('/api/promocoes/config', { cliente: HC, imposto_pct: 10, hedge_cobertura: 1 })).json.imposto_pct, 10)
})

// ═══ idx 53 — CSV de descobertos segue a janela escolhida (?dias=) ═════════════════════════════════════════
await okA('exportar.csv?tipo=descobertos&dias=14 inclui o protegido que vence em 10 dias; dias=7 e o padrão da config (7) não', async () => {
  const csv = dias => get(`/api/promocoes/exportar.csv?cliente=${q}&tipo=descobertos${dias === undefined ? '' : `&dias=${dias}`}`)
  const c14 = await csv(14), c7 = await csv(7), padrao = await csv()
  assert.equal(c14.status, 200); assert.ok(c14.texto.includes('MLB9'), 'janela de 14 dias enxerga o vencimento em 15/10')
  assert.ok(!c7.texto.includes('MLB9')); assert.ok(!padrao.texto.includes('MLB9'))
  assert.equal((await csv('abc')).status, 400); assert.equal((await csv(0)).status, 400)
  const tela = (await get(`/api/promocoes/participando?cliente=${q}&dias=14`)).json
  assert.ok(tela.cobertura.alertas.some(a => a.item_id === 'MLB9'), 'o CSV bate com o que a tela mostra na mesma janela')
})

// ═══ rev2 #19 / #20 — parseCustosCsv: nada descartado em silêncio; 3+ colunas nunca usam a 2ª como custo ═══════════
ok('rev2 #19: cabeçalho = 1ª linha não vazia SEM dígitos; "SKU-001;1.234" e "CODIGO1;abc" aparecem em rejeitadas (não somem como "cabeçalho")', () => {
  const r = M.parseCustosCsv('SKU-001;1.234\nSKU-002;12,50')
  assert.deepEqual(r.linhas, [{ sku: 'SKU-002', custo: 12.5 }]); assert.equal(r.rejeitadas.length, 1)
  assert.equal(r.rejeitadas[0].linha, 1); assert.match(r.rejeitadas[0].motivo, /ambíguo/); assert.match(r.rejeitadas[0].texto, /SKU-001/)
  const s = M.parseCustosCsv('CODIGO1;abc\nOK;3'); assert.equal(s.rejeitadas.length, 1); assert.equal(s.rejeitadas[0].linha, 1); assert.deepEqual(s.linhas, [{ sku: 'OK', custo: 3 }])
  const h = M.parseCustosCsv('\n\nSKU;Custo\nA;5\nsku;custo\nB;6')                                  // cabeçalho depois de linhas vazias vale; um 2º "cabeçalho" no meio é linha rejeitada COM motivo
  assert.deepEqual(h.linhas, [{ sku: 'A', custo: 5 }, { sku: 'B', custo: 6 }]); assert.equal(h.rejeitadas.length, 1); assert.equal(h.rejeitadas[0].linha, 5)
  assert.deepEqual(M.parseCustosCsv('Código;Custo (R$)\nX;2').linhas, [{ sku: 'X', custo: 2 }], 'cabeçalho de verdade segue sendo ignorado')
})
ok('rev2 #20: linha com 3+ colunas separadas por ";" ou tab é REJEITADA com motivo (estoque nunca vira custo); só o modo de 2 colunas entra', () => {
  const r = M.parseCustosCsv('A;100;12,50\nB\t5\t9,90\nC,100,12.50\nD;7\nE;8;')
  assert.deepEqual(r.linhas, [{ sku: 'D', custo: 7 }]); assert.equal(r.rejeitadas.length, 4); assert.ok(r.rejeitadas.every(x => x.motivo))
  assert.match(r.rejeitadas[0].motivo, /duas colunas/); assert.match(r.rejeitadas[1].motivo, /duas colunas/); assert.match(r.rejeitadas[2].motivo, /vírgulas demais/)
  assert.match(r.rejeitadas[3].motivo, /duas colunas/, 'coluna final vazia também é 3ª coluna: num SKU;Estoque;Custo o custo vazio faria o estoque virar custo')
  const x = M.parseCustosCsv('SKU;Estoque;Custo\nA;100;12,50'); assert.deepEqual(x.linhas, []); assert.equal(x.rejeitadas.length, 1)
})
await okA('rev2 #20: POST /custos/importar com export "SKU;Estoque;Custo" => 400 e nada gravado', async () => {
  const antes = JSON.stringify(custosDe())
  const r = await post('/api/promocoes/custos/importar', { cliente: HC, texto: 'ZZ1;100;12,50\nZZ2;5;9,90' })
  assert.equal(r.status, 400); assert.equal(r.json.total_rejeitadas, 2); assert.match(r.json.rejeitadas[0].motivo, /duas colunas/); assert.equal(JSON.stringify(custosDe()), antes)
})

// ═══ rev2 #24 — /coletar e /plano/sync exigem "por" e gravam o autor (auditoria + job) ════════════════════════
await okA('rev2 #24: /coletar e /plano/sync => 400 sem "por"; com "por" a auditoria e o job levam o nome (nunca "sistema"/"operador")', async () => {
  const dep = Rotas.depsPromocoes, salvo = { ...dep }
  const stub = async (_c, caminho) => {
    if (/^\/seller-promotions\/users\/123\?/.test(caminho)) return { results: [], paging: { total: 0 } }
    if (/^\/items\/bulk\?ids=/.test(caminho)) return caminho.match(/ids=([^&]+)/)[1].split(',').map(id => ({ id, status_code: 200, body: { id, title: id, price: 100, status: 'active', category_id: 'MLB1', listing_type_id: 'gold_special', attributes: [], seller_custom_field: '', variations: [], user_product_id: '' } }))
    if (/^\/seller-promotions\/items\/MLB\d+/.test(caminho)) return []
    return { _erro: true, status: 404, corpo: 'não previsto' }
  }
  Object.assign(dep, { chamar: stub, uid: 123, espera: 0, api: async () => ({ erro: false, corpo: [] }) })
  try {
    for (const por of [undefined, '', '   ', [], null]) assert.equal((await post('/api/promocoes/coletar', { cliente: HC, por })).status, 400, `coletar por=${JSON.stringify(por)}`)
    const j = await post('/api/promocoes/coletar', { cliente: HC, por: 'Marcia' }); assert.equal(j.status, 200)
    let job; for (let i = 0; i < 400; i++) { job = (await get(`/api/promocoes/job/${j.json.job}?cliente=${q}`)).json; if (job.estado !== 'rodando') break; await new Promise(r => setTimeout(r, 15)) }
    assert.equal(job.estado, 'concluido', job.erro); assert.equal(job.por, 'Marcia', 'o job guarda quem disparou')
    const aud = R.listarAuditoria(HC, { evento: 'coleta' }); assert.equal(aud[0].autor, 'Marcia'); assert.ok(!aud.some(a => ['sistema', 'operador'].includes(a.autor)))
    R.salvarPlano({ id: 'PL-SYNC', cliente: HC, criado_em: '2026-10-01T00:00:00Z', expira_em: '2026-10-02T00:00:00Z', gerado_por: 'x', hash: 'h', itens: [], resumo: {} })
    R.atualizarPlano(HC, 'PL-SYNC', { estado: 'executado', resultado: { chamadas: [] }, executado_em: '2020-01-01T00:00:00Z' })
    for (const por of [undefined, '', '  ']) assert.equal((await post('/api/promocoes/plano/sync', { cliente: HC, id: 'PL-SYNC', por })).status, 400, `sync por=${JSON.stringify(por)}`)
    assert.equal(R.listarAuditoria(HC, { evento: 'sync_pos_execucao' }).length, 0, 'sync barrado não deixa rastro de sync')
    const s = await post('/api/promocoes/plano/sync', { cliente: HC, id: 'PL-SYNC', por: 'Marcia' }); assert.equal(s.status, 200, JSON.stringify(s.json))
    assert.equal(R.listarAuditoria(HC, { evento: 'sync_pos_execucao' })[0].autor, 'Marcia')
  } finally { for (const k of Object.keys(dep)) delete dep[k]; Object.assign(dep, salvo) }
})

// ═══ rev2 UI #9/#7/#32 — /resumo: "sugeridas" exclui o que a recusa do dono barra; expõe barradas, aprovações 🤖 e cobertura incerta ═══
await okA('rev2 UI #9/#7/#32: kpis.sugeridas não conta par recusado por 👤 (vai em sugeridas_barradas); aprovadas_analista e cobertura_incerta existem', async () => {
  const linha = (item_id, pid) => ({ item_id, pid, marcado: true, regra: 'REGRA', via: 'api', preco: 90, mc_pct: 20 })
  R.substituirDecisoesAnalista(HC, [linha('MLB31', 'P1'), linha('MLB32', 'P2')], 'RUI', 'analista')
  R.marcarHumano(HC, { item_id: 'MLB31', pid: 'P1', marcado: false, via: 'api' }, 'David')          // o dono recusou DEPOIS da sugestão
  let k = (await get(`/api/promocoes/resumo?cliente=${q}`)).json.kpis
  assert.equal(k.sugeridas, 1, 'só MLB32 é aprovável'); assert.equal(k.sugeridas_barradas, 1, 'MLB31 está barrado pela recusa'); assert.equal(k.aprovadas_analista, 0); assert.equal(typeof k.cobertura_incerta, 'number')
  const ap = await post('/api/promocoes/aprovar-analista', { cliente: HC, por: 'David', itens: [{ item_id: 'MLB31', pid: 'P1', preco: 90, mc_pct: 20 }, { item_id: 'MLB32', pid: 'P2', preco: 90, mc_pct: 20 }] })     // lista exibida com os números (contrato rev3 #4)
  assert.deepEqual({ aprovadas: ap.json.aprovadas, barradas: ap.json.bloqueadas_por_recusa }, { aprovadas: 1, barradas: 1 }, 'a rota barra exatamente o que o KPI separou')
  k = (await get(`/api/promocoes/resumo?cliente=${q}`)).json.kpis
  assert.equal(k.aprovadas_analista, 1); assert.equal(k.sugeridas, 0); assert.equal(k.sugeridas_barradas, 1)
})

// ═══ rev3 #4 — aprovar 🤖 vale pelos NÚMEROS que o dono viu (aba velha não aprova número novo) ═══════════
await okA('rev3 #4: /aprovar-analista só aprova se preço/MC exibidos == os da sugestão agora; senão 409 numeros_mudaram e NADA é aprovado', async () => {
  const C4 = 'Cli Rev3 Quatro', q4 = encodeURIComponent(C4), conex = Rotas.depsPromocoes.conexoes
  Rotas.depsPromocoes.conexoes = () => [{ cliente: HC, nickname: 'x' }, { cliente: C4, nickname: 'y' }]
  try {
    const lin = (item_id, pid, preco, mc_pct) => ({ item_id, pid, marcado: true, regra: 'R1', via: 'api', preco, mc_pct })
    R.substituirDecisoesAnalista(C4, [lin('MLB71', 'P1', 95, 30.68), lin('MLB72', 'P2', 50, 25)], 'r1')
    const pend = (await get(`/api/promocoes/resumo?cliente=${q4}`)).json.sugestoes_pendentes
    assert.deepEqual([...pend].sort((a, b) => a.item_id.localeCompare(b.item_id)), [{ item_id: 'MLB71', pid: 'P1', preco: 95, mc_pct: 30.68 }, { item_id: 'MLB72', pid: 'P2', preco: 50, mc_pct: 25 }], '/resumo expõe a lista exibida COM os números')
    R.substituirDecisoesAnalista(C4, [lin('MLB71', 'P1', 88, 27), lin('MLB72', 'P2', 50, 25)], 'r2')      // outra aba / recoleta + aplicar analista recalculou P1
    const r = await post('/api/promocoes/aprovar-analista', { cliente: C4, por: 'David', itens: pend })
    assert.equal(r.status, 409); assert.equal(r.json.codigo, 'numeros_mudaram'); assert.match(r.json.erro, /NADA foi aprovado/)
    assert.deepEqual(r.json.numeros_mudaram.map(m => [m.item_id, m.atual]), [['MLB71', { preco: 88, mc_pct: 27 }]])
    assert.ok(R.lerDecisoes(C4).every(d => !d.aprovado), 'tela velha: nem o par que não mudou é aprovado (tudo ou nada)')
    assert.equal(R.listarAuditoria(C4, { evento: 'aprova_analista_numeros_mudaram' }).length, 1)
    for (const corpo of [{ todos: true }, { itens: [{ item_id: 'MLB71', pid: 'P1' }] }, { itens: [{ item_id: 'MLB71', pid: 'P1', preco: '88', mc_pct: 27 }] }])
      assert.equal((await post('/api/promocoes/aprovar-analista', { cliente: C4, por: 'David', ...corpo })).status, 400, `sem os números vistos => 400: ${JSON.stringify(corpo)}`)
    assert.equal((await post('/api/promocoes/aprovar-analista', { cliente: C4, por: 'David', itens: [{ item_id: 'MLB79', pid: 'PX', preco: 1, mc_pct: 1 }] })).status, 409, 'sugestão que sumiu também mudou')
    const ok = await post('/api/promocoes/aprovar-analista', { cliente: C4, por: 'David', itens: [{ item_id: 'MLB71', pid: 'P1', preco: 88, mc_pct: 27 }] })
    assert.equal(ok.status, 200); assert.equal(ok.json.aprovadas, 1)
    assert.deepEqual(R.marcasEfetivas(C4).map(d => `${d.pid}:${d.preco}:${d.mc_pct}`), ['P1:88:27'], 'grava os números que o dono viu')
  } finally { Rotas.depsPromocoes.conexoes = conex }
})

// ═══ rev3 #11 — KPI "Marcadas" e situação "marcada" = marcasEfetivas (o que de fato iria ao plano) ═══════
await okA('rev3 #11: hedge 🤖 aprovado com a âncora revogada não conta como "Marcada" (KPI nem situação)', async () => {
  const C11 = 'Cli Rev3 Onze', q11 = encodeURIComponent(C11), conex = Rotas.depsPromocoes.conexoes
  Rotas.depsPromocoes.conexoes = () => [{ cliente: HC, nickname: 'x' }, { cliente: C11, nickname: 'y' }]
  try {
    coletaSint(C11, [an('MLB61')], [of('MLB61', 'CURTA'), of('MLB61', 'LONGA')])
    const lin = (pid, preco, extra = {}) => ({ item_id: 'MLB61', pid, marcado: true, regra: 'R2', via: 'api', preco, mc_pct: 20, ...extra })
    R.substituirDecisoesAnalista(C11, [lin('CURTA', 100), lin('LONGA', 100, { regra: 'HEDGE', ancora: 'CURTA' })], 'r1')
    R.aprovarAnalista(C11, [{ item_id: 'MLB61', pid: 'CURTA' }, { item_id: 'MLB61', pid: 'LONGA' }], 'dono')
    assert.equal((await get(`/api/promocoes/resumo?cliente=${q11}`)).json.kpis.marcadas, 1)
    R.substituirDecisoesAnalista(C11, [lin('CURTA', 98), lin('LONGA', 100, { regra: 'HEDGE', ancora: 'CURTA' })], 'r2')     // a âncora mudou de preço: revogada; o hedge fica aprovado=1
    assert.deepEqual(R.marcasEfetivas(C11), [], 'hedge órfão não vai ao plano')
    assert.equal((await get(`/api/promocoes/resumo?cliente=${q11}`)).json.kpis.marcadas, 0, 'KPI não promete o que o plano recusaria')
    const l = (await get(`/api/promocoes/elegiveis?cliente=${q11}`)).json.itens.find(i => i.item_id === 'MLB61')
    assert.ok(l, 'a linha aparece'); assert.notEqual(l.situacao, 'marcada'); assert.equal(l.situacao, 'sugerida')
    assert.deepEqual(l.sugerida.map(s => [s.pid, s.preco]).sort(), [['CURTA', 98], ['LONGA', 100]], 'a sugestão leva os números (a tela os mostra no Aprovar)')
  } finally { Rotas.depsPromocoes.conexoes = conex }
})

// ═══ rev3 #17 — corpo JSON acima do limite = 413 com mensagem clara (o handler REAL de server.js) ═════════
await okA('rev3 #17: corpo > 1 MB => 413 "corpo grande demais" (não 500 "erro interno"); JSON ruim 400; charset ruim 415; nada disso é log de erro', async () => {
  const fonte = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')       // importar server.js abriria o banco real e a porta 3012: extrai o handler do fonte
  const m = /app\.use\(((?:\(err, req, res, next\)) => \{[\s\S]*?\n\})\)/.exec(fonte); assert.ok(m, 'handler de erro não encontrado em server.js')
  const iJson = fonte.indexOf("app.use(express.json({ limit: '1mb' }))"), iRotas = fonte.indexOf('app.use(rotasPromocoes)')
  assert.ok(iJson > 0 && iJson < iRotas && iRotas < m.index, 'ordem: express.json → rotas → handler de erro')
  // o handler delega ao proximoErro (declarado logo depois dele em server.js): o código REAL dos dois entra no mesmo escopo, sem reimplementar nada
  const p = /const proximoErro = \(err, req, res, next\) => \{[\s\S]*?\n\}/.exec(fonte); assert.ok(p && p.index > m.index, 'proximoErro não encontrado após o handler em server.js')
  const niveis = [], msgs = [], handler = new Function('log', 'sanitizarErp', `${p[0]}\nreturn (${m[1]})`)((nivel, msg) => { niveis.push(nivel); msgs.push(msg) }, (await import('../src/lib/erp-http.js')).sanitizar)
  const app2 = express(); app2.use(express.json({ limit: '1mb' })); app2.use(Rotas.rotasPromocoes); app2.use(handler)
  const sv = await new Promise(r => { const s = app2.listen(0, '127.0.0.1', () => r(s)) })
  try {
    const url = `http://127.0.0.1:${sv.address().port}/api/promocoes/custos/importar`, envia = (body, tipo = 'application/json') => fetch(url, { method: 'POST', headers: { 'Content-Type': tipo }, body })
    const grande = JSON.stringify({ cliente: HC, por: 'David', linhas: Array.from({ length: 30000 }, (_, i) => ({ sku: `SKU-${i}-xxxxxxxx`, custo: 12.5 })) })
    assert.ok(grande.length > 1024 * 1024)
    const r = await envia(grande); assert.equal(r.status, 413); assert.match((await r.json()).erro, /grande demais \(máx\. 1 MB\): divida/)
    const r2 = await envia('{lixo'); assert.equal(r2.status, 400); assert.equal((await r2.json()).erro, 'JSON inválido')
    const r3 = await envia('{}', 'application/json; charset=klingon'); assert.equal(r3.status, 415); assert.equal((await r3.json()).erro, 'requisição inválida')
    assert.ok(!niveis.includes('erro'), `erro de quem chamou não é "erro" do servidor: ${niveis}`)
    // regressão idx 37: o JSON.parse do Node 22 ecoa um trecho do corpo na mensagem — segredo colado sem aspas não pode ir ao log
    msgs.length = 0
    const r4 = await envia('{"fonte":"bling","client_id":"abc","client_secret":SEGREDOxyz9876543210ABCDEF,"por":"x"}'); assert.equal(r4.status, 400)
    assert.deepEqual(msgs, ['POST /api/promocoes/custos/importar → 400'], 'parse: só método, rota e status')
    await envia('{}', 'application/json; charset=klingon')                                // mensagem do parser traz "KLINGON" entre aspas
    const res = { status() { return this }, json() { return this } }
    handler(new Error('falhou: Bearer abc.def.ghi client_secret=SEGREDO123 eco ..."t_secret":SEGREDOxyz"...'), { method: 'POST', path: '/api/x' }, res)
    const tudo = msgs.join('\n')
    for (const s of ['SEGREDOxyz', 'SEGREDO123', 'abc.def.ghi', 'KLINGON', '"t_secret"']) assert.ok(!tudo.includes(s), `vazou no log: ${s}`)
    assert.ok(msgs.some(l => l.startsWith('POST /api/x → 500: falhou: Bearer ***')), msgs.join(' | '))
  } finally { sv.close() }
})

// ═══ decisão 3 (folha do anúncio): a lista e o resumo dizem se a coleta da madrugada está ligada para o cliente (null = padrão da base; 0 = desligada) ═════
await okA('coleta_ligada em /api/promocoes/clientes e /api/promocoes/resumo: boolean pelo interruptor do cliente, sem abrir o banco real', async () => {
  const dep = Rotas.depsPromocoes, salvo = dep.coletaPromocoesDoCliente
  try {
    let l = (await get('/api/promocoes/clientes')).json; assert.equal(l[0].cliente, HC); assert.equal(l[0].coleta_ligada, true, 'null = padrão da base (coleta_para_todos)')
    assert.equal((await get(`/api/promocoes/resumo?cliente=${q}`)).json.coleta_ligada, true)
    dep.coletaPromocoesDoCliente = c => (c === HC ? 0 : null)
    l = (await get('/api/promocoes/clientes')).json; assert.equal(l[0].coleta_ligada, false)
    assert.equal((await get(`/api/promocoes/resumo?cliente=${q}`)).json.coleta_ligada, false)
    assert.equal(typeof (await get(`/api/promocoes/resumo?cliente=${q}`)).json.coleta, 'object', 'o resto do resumo continua')
  } finally { dep.coletaPromocoesDoCliente = salvo }
})

srv.close()
console.log(`✔ teste-promocoes-rotas-mc: ${n} verificações OK`)
