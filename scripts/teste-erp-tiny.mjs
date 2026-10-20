process.env.PS_PROMO_MEMORIA = '1'                       // ANTES de qualquer import: nada aqui pode abrir data/db.sqlite
// Auto-teste do conector Tiny (M5). Sem rede: o HTTP é stub servindo as fixtures de scripts/fixtures/erp/tiny-*.json
// (construídas a partir da documentação). Nenhum token real; o token do teste é um marcador que não pode vazar em erro nem log.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { criarConectorTiny } = await import('../src/lib/erp-tiny.js')

const fx = nome => JSON.parse(readFileSync(new URL(`./fixtures/erp/${nome}`, import.meta.url), 'utf8'))
const L = fx('tiny-listagem.json'), D = fx('tiny-produto.json'), K = fx('tiny-produto-kit.json')
for (const f of [L, D, K]) assert.match(f._aviso, /não é captura real/)

let n = 0
const ok = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const TOKEN = 'tok-TESTE-nao-real-123'
const resp = (corpo, status = 200, headers = {}) => ({ status, headers, texto: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) })

// Roteador sobre as fixtures; `antes(req)` pode responder primeiro (erros, limites). Só GET em api.tiny.com.br/public-api/v3.
function criarAmbiente({ paginas = L.paginas, produtos = D.produtos, kits = K.kits, antes = null, token = async () => TOKEN, ...extra } = {}) {
  const chamadas = [], pausas = [], logs = []
  const http = async req => {
    chamadas.push(req)
    assert.equal(req.metodo, 'GET', 'conector é somente leitura')
    assert.equal(req.corpo, undefined)
    assert.equal(req.headers.Authorization, `Bearer ${TOKEN}`)
    assert.ok(req.url.startsWith('https://api.tiny.com.br/public-api/v3/'), req.url)
    const u = new URL(req.url)
    const r = antes?.(req, u, chamadas.length); if (r) return r
    const c = u.pathname.replace('/public-api/v3', ''); let m
    if (c === '/produtos') {
      if (u.searchParams.get('limit') === '1') return resp({ itens: [], paginacao: { limit: 1, offset: 0, total: 0 } })
      assert.equal(u.searchParams.get('limit'), '100')
      return resp(paginas[`${u.searchParams.get('situacao')}:${u.searchParams.get('offset')}`] ?? { itens: [] })
    }
    if ((m = c.match(/^\/produtos\/(\d+)\/kit$/))) return kits[m[1]] ? resp(kits[m[1]]) : resp({ mensagem: 'não encontrado' }, 404)
    if ((m = c.match(/^\/produtos\/(\d+)$/))) return produtos[m[1]] ? resp(produtos[m[1]]) : resp({ mensagem: 'não encontrado' }, 404)
    assert.fail(`GET inesperado: ${req.url}`)
  }
  let aguardou = 0, tokens = 0
  const limitador = { aguardar: async () => { aguardou++ }, registrar429: ms => pausas.push(ms) }
  const con = criarConectorTiny({ http, limitador, obterToken: async () => { tokens++; return token() }, log: (nivel, msg) => logs.push(`${nivel} ${msg}`), agora: () => '2026-10-05T12:00:00.000Z', ...extra })
  return { con, chamadas, pausas, logs, get aguardou() { return aguardou }, get tokens() { return tokens } }
}
async function varrerTudo(con, opcoes) {
  const paginas = []
  for await (const p of con.varrer(opcoes)) paginas.push(p)
  return { paginas, linhas: paginas.flatMap(p => p.linhas), kits: paginas.flatMap(p => p.kits), avisos: paginas.flatMap(p => p.avisos) }
}
const porSku = (linhas, sku) => linhas.find(l => l.sku === sku)
const caminhos = chamadas => chamadas.map(c => { const u = new URL(c.url); return u.pathname.replace('/public-api/v3', '') + u.search })
async function falha(promessa) { try { await promessa } catch (e) { return e } assert.fail('deveria ter lançado') }
async function falhaVarrer(con) { return falha((async () => { for await (const _ of con.varrer()) { /* consome */ } })()) }

await ok('contrato: testar/varrer/custoDoProduto; campo inválido é recusado na criação', async () => {
  const { con } = criarAmbiente()
  assert.deepEqual(Object.keys(con).sort(), ['custoDoProduto', 'testar', 'varrer'])
  assert.throws(() => criarAmbiente({ campoCusto: 'preco' }), /preco_custo ou custo_medio/)
  assert.throws(() => criarAmbiente({ campoCusto: '' }), /preco_custo ou custo_medio/)
})

await ok('listagem: situacao=A e depois I, offset anda pelo que veio, para em offset >= total; limitador antes de cada chamada', async () => {
  const amb = criarAmbiente()
  const { paginas, linhas } = await varrerTudo(amb.con)
  assert.deepEqual(caminhos(amb.chamadas), [
    '/produtos?limit=100&offset=0&situacao=A', '/produtos?limit=100&offset=3&situacao=A',
    '/produtos?limit=100&offset=0&situacao=I',
    '/produtos/2000', '/produtos/3000/kit',
  ])
  assert.equal(amb.aguardou, amb.chamadas.length, 'aguardar() antes de TODA chamada')
  assert.deepEqual(paginas.map(p => p.pagina), [1, 2, 3, 4])
  assert.ok(porSku(linhas, 'CAN-OLD'), 'inativo (situacao=I) entra')
  assert.ok(linhas.every(l => l.mlb === null), 'o ERP nunca define MLB')
  assert.deepEqual(amb.pausas, [])
})

await ok('para na página vazia quando a paginação não traz total', async () => {
  const p = { 'A:0': { itens: L.paginas['A:0'].itens.slice(0, 2) }, 'A:2': { itens: [] }, 'I:0': { itens: [] } }
  const amb = criarAmbiente({ paginas: p })
  const { linhas } = await varrerTudo(amb.con)
  assert.deepEqual(caminhos(amb.chamadas), ['/produtos?limit=100&offset=0&situacao=A', '/produtos?limit=100&offset=2&situacao=A', '/produtos?limit=100&offset=0&situacao=I'])
  assert.deepEqual(linhas.map(l => l.sku), ['CAN-001', 'CAN-002'])
})

await ok('situações configuráveis: só as pedidas, nunca a padrão da API', async () => {
  const amb = criarAmbiente({ situacoes: ['I'] })
  await varrerTudo(amb.con)
  assert.ok(caminhos(amb.chamadas).filter(c => c.startsWith('/produtos?')).every(c => c.endsWith('situacao=I')))
})

await ok('preco_custo (padrão): precoCusto, proveniência, data em ISO; SEM fallback para o custo médio, com dica', async () => {
  const { linhas } = await varrerTudo(criarAmbiente().con)
  const a = porSku(linhas, 'CAN-001')
  assert.deepEqual(a, { sku: 'CAN-001', mlb: null, custo: 36.32, campo: 'tiny.precos.precoCusto', id_externo: '1001', atualizado_na_fonte: '2026-10-01T17:30:00.000Z', variacao_de: null })
  const b = porSku(linhas, 'CAN-002')                                   // precoCusto null, médio 12,50
  assert.equal(b.custo, null, 'o médio NÃO é usado no lugar do preço de custo')
  assert.match(b.dica, /precoCustoMedio\) tem R\$ 12,50/)
  const c = porSku(linhas, 'CAN-003')                                   // 0 nos dois
  assert.equal(c.custo, null, 'zero vira null, nunca 0')
  assert.equal(c.dica, undefined, 'sem dica quando o outro campo também é vazio')
  assert.equal(porSku(linhas, 'CAN-OLD').custo, 20)
})

await ok('custo_medio: precoCustoMedio; preço de custo presente NÃO entra no lugar do médio vazio', async () => {
  const { linhas, kits } = await varrerTudo(criarAmbiente({ campoCusto: 'custo_medio' }).con)
  assert.equal(porSku(linhas, 'CAN-001').custo, 35.1)
  assert.equal(porSku(linhas, 'CAN-001').campo, 'tiny.precos.precoCustoMedio')
  assert.equal(porSku(linhas, 'CAN-002').custo, 12.5)
  const old = porSku(linhas, 'CAN-OLD')                                 // médio null, precoCusto 20
  assert.equal(old.custo, null)
  assert.match(old.dica, /precoCusto\) tem R\$ 20,00.*sem fallback/)
  assert.equal(porSku(linhas, 'CAMISA-P').custo, 17.5)
  assert.equal(porSku(linhas, 'CAMISA-M').custo, 17.9)
  assert.equal(kits[0].custo_proprio, null, 'kit sem médio: custo próprio null')
})

await ok('nulo, 0 e "0" → null; valor estranho segue BRUTO para o aplicarLote rejeitar (o conector não decide)', async () => {
  const precos = v => ({ preco: 10, precoCusto: v, precoCustoMedio: null })
  const itens = [['N1', null], ['N2', undefined], ['N3', 0], ['N4', '0'], ['N5', '0.0000'], ['X1', -3], ['X2', '12,50'], ['X3', '36.3200000000']]
    .map(([sku, v], i) => ({ id: 50 + i, sku, tipo: 'S', tipoVariacao: 'N', situacao: 'A', precos: precos(v) }))
  const { linhas } = await varrerTudo(criarAmbiente({ paginas: { 'A:0': { itens, paginacao: { total: itens.length } } }, situacoes: ['A'] }).con)
  for (const s of ['N1', 'N2', 'N3', 'N4', 'N5']) assert.equal(porSku(linhas, s).custo, null, s)
  assert.equal(porSku(linhas, 'X1').custo, -3)
  assert.equal(porSku(linhas, 'X2').custo, '12,50')
  assert.equal(porSku(linhas, 'X3').custo, '36.3200000000')
})

await ok('pai P ignorado com aviso; variações lidas do detalhe do pai (com variacao_de) quando a listagem não as traz', async () => {
  const { linhas, avisos } = await varrerTudo(criarAmbiente().con)
  assert.equal(porSku(linhas, 'CAMISA'), undefined, 'pai não tem custo próprio')
  assert.ok(avisos.some(a => /pai de variação ignorado.*CAMISA/.test(a)))
  assert.deepEqual(porSku(linhas, 'CAMISA-P'), { sku: 'CAMISA-P', mlb: null, custo: 18, campo: 'tiny.precos.precoCusto', id_externo: '2001', atualizado_na_fonte: null, variacao_de: 'CAMISA' })
  const m = porSku(linhas, 'CAMISA-M')
  assert.equal(m.custo, null); assert.equal(m.variacao_de, 'CAMISA'); assert.match(m.dica, /R\$ 17,90/)
})

await ok('variação V na listagem: linha normal e o detalhe do pai NÃO é buscado', async () => {
  const v = { id: 2001, sku: 'CAMISA-P', tipo: 'V', tipoVariacao: 'V', situacao: 'A', dataAlteracao: '2026-09-30T10:00:00-03:00', precos: { precoCusto: 18, precoCustoMedio: 17.5 } }
  const pai = L.paginas['A:3'].itens[0]
  const amb = criarAmbiente({ paginas: { 'A:0': { itens: [pai, v], paginacao: { total: 2 } } }, situacoes: ['A'] })
  const { linhas } = await varrerTudo(amb.con)
  assert.deepEqual(linhas.map(l => l.sku), ['CAMISA-P'])
  assert.equal(linhas[0].custo, 18); assert.equal(linhas[0].atualizado_na_fonte, '2026-09-30T13:00:00.000Z')
  assert.ok(!caminhos(amb.chamadas).includes('/produtos/2000'))
})

await ok('kit K: fora das linhas, estrutura por /produtos/{id}/kit, custo próprio do campo escolhido', async () => {
  const { linhas, kits } = await varrerTudo(criarAmbiente().con)
  assert.equal(porSku(linhas, 'KIT-2CAN'), undefined)
  assert.deepEqual(kits, [{ id_externo: '3000', sku: 'KIT-2CAN', custo_proprio: 70, componentes: [{ id_externo: '1001', quantidade: 2 }] }])
})

await ok('kit sem estrutura (404, lista vazia, quantidade inválida) → componentes null, nunca soma inventada', async () => {
  const k = id => ({ id, sku: `KIT-${id}`, tipo: 'K', tipoVariacao: 'N', situacao: 'A', precos: { precoCusto: 10 } })
  const pags = { 'A:0': { itens: [k(31), k(32), k(33)], paginacao: { total: 3 } } }
  const { kits, avisos } = await varrerTudo(criarAmbiente({ paginas: pags, situacoes: ['A'], kits: { 32: [], 33: [{ produto: { id: 1001 }, quantidade: 0 }] } }).con)
  assert.deepEqual(kits.map(x => x.componentes), [null, null, null])
  assert.ok(avisos.some(a => /3 kit\(s\) sem estrutura/.test(a)))
})

await ok('tetos de 200 (kits e pais) com prioridade para SKUs de anúncio; excedente vira aviso, não chamada', async () => {
  const kitsL = Array.from({ length: 201 }, (_, i) => ({ id: 5000 + i, sku: `K${i}`, tipo: 'K', tipoVariacao: 'N', situacao: 'A', precos: { precoCusto: 5 } }))
  const paisL = Array.from({ length: 201 }, (_, i) => ({ id: 7000 + i, sku: `P${i}`, tipo: 'V', tipoVariacao: 'P', situacao: 'A', precos: {} }))
  const kitsF = Object.fromEntries(kitsL.map(k => [k.id, [{ produto: { id: 1001 }, quantidade: 1 }]]))
  const prodF = Object.fromEntries(paisL.map(p => [p.id, { ...p, variacoes: [{ id: p.id + 1000, sku: `${p.sku}-U`, precos: { precoCusto: 3 } }] }]))
  const amb = criarAmbiente({ paginas: { 'A:0': { itens: [...kitsL, ...paisL], paginacao: { total: 402 } } }, situacoes: ['A'], kits: kitsF, produtos: prodF })
  const { linhas, kits, avisos } = await varrerTudo(amb.con, { prioridadeSkus: ['k200', 'P200 '] })
  const cs = caminhos(amb.chamadas)
  assert.equal(cs.filter(c => /\/kit$/.test(c)).length, 200)
  assert.equal(cs.filter(c => /^\/produtos\/7\d{3}$/.test(c)).length, 200)
  assert.ok(cs.includes('/produtos/5200/kit') && !cs.includes('/produtos/5199/kit'), 'kit prioritário entra, o último comum fica de fora')
  assert.ok(cs.includes('/produtos/7200') && !cs.includes('/produtos/7199'))
  assert.equal(kits.find(k => k.sku === 'K199').componentes, null)
  assert.equal(linhas.length, 200)
  assert.ok(avisos.some(a => /1 kit\(s\) além do teto de 200/.test(a)))
  assert.ok(avisos.some(a => /1 pai\(s\) além do teto de 200.*P199/.test(a)))
})

await ok('excedente dos tetos vai para a fila (pendentes_detalhe); pai não lido marca nao_fechar; kit além do teto diz o motivo', async () => {
  const kitsL = Array.from({ length: 201 }, (_, i) => ({ id: 5000 + i, sku: `K${i}`, tipo: 'K', tipoVariacao: 'N', situacao: 'A', precos: { precoCusto: 5 } }))
  const paisL = Array.from({ length: 201 }, (_, i) => ({ id: 7000 + i, sku: `P${i}`, tipo: 'V', tipoVariacao: 'P', situacao: 'A', precos: {} }))
  const prodF = Object.fromEntries(paisL.map(p => [p.id, { ...p, variacoes: [] }]))
  const { paginas, kits } = await varrerTudo(criarAmbiente({ paginas: { 'A:0': { itens: [...kitsL, ...paisL], paginacao: { total: 402 } } }, situacoes: ['A'], kits: {}, produtos: prodF }).con)
  const fim = paginas.at(-1)
  assert.deepEqual(fim.pendentes_detalhe, ['7200', '5200']); assert.equal(fim.nao_fechar, true)
  assert.match(kits.find(k => k.sku === 'K200').dica, /teto de detalhes por varredura/)
  const sem = await varrerTudo(criarAmbiente().con)
  assert.ok(!sem.paginas.some(p => p.nao_fechar || p.pendentes_detalhe?.length), 'sem excedente: fecha normalmente')
})

await ok('teto de 500 páginas: lança (varredura incompleta não pode fechar como completa)', async () => {
  const item = { id: 1, sku: 'LOOP', tipo: 'S', tipoVariacao: 'N', precos: { precoCusto: 1 } }
  const amb = criarAmbiente({ antes: (_r, u) => u.pathname.endsWith('/produtos') ? resp({ itens: [item], paginacao: { total: 1e9 } }) : null })
  const e = await falhaVarrer(amb.con)
  assert.equal(e.codigo, 'teto'); assert.equal(amb.chamadas.length, 500)
})

await ok('X-RateLimit: Remaining 0 num 200 pausa até o Reset; 429 pausa e repete; erro com Remaining 0 conta como limite', async () => {
  let k = 0
  const amb = criarAmbiente({ antes: (_r, u, i) => {
    if (!u.pathname.endsWith('/produtos')) return null
    k++
    if (k === 1) return { ...resp(L.paginas['A:0']), headers: { 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '7' } }
    if (k === 2) return resp('{"mensagem":"muitas requisições"}', 429, { 'x-ratelimit-reset': '3' })
    if (k === 3) return resp('{"mensagem":"x"}', 400, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': `${Date.parse('2026-10-05T12:00:05Z') / 1000}` })
    return null
  }, situacoes: ['A'] })
  const { linhas } = await varrerTudo(amb.con)
  assert.deepEqual(amb.pausas, [7000, 3000, 5000], 'reset em segundos e em epoch (contra o relógio injetado)')
  assert.equal(linhas.length, 5)
  assert.ok(amb.logs.every(l => l.startsWith('aviso tiny: limite de consulta')))
})

await ok('429 sem cabeçalho espera 60 s; desiste após 4 retentativas (5 chamadas) com codigo "limite"', async () => {
  const amb = criarAmbiente({ antes: () => resp('', 429) })
  const e = await falhaVarrer(amb.con)
  assert.equal(e.codigo, 'limite'); assert.equal(e.status, 429)
  assert.equal(amb.chamadas.length, 5); assert.deepEqual(amb.pausas, [60000, 60000, 60000, 60000])
})

await ok('5xx transitório: pausa crescente e repete; 4xx comum não é repetido', async () => {
  let k = 0
  const amb = criarAmbiente({ antes: () => (++k === 1 ? resp('indisponível', 503) : null), situacoes: ['I'] })
  assert.equal((await varrerTudo(amb.con)).linhas.length, 1)
  assert.deepEqual(amb.pausas, [2000])
  const amb2 = criarAmbiente({ antes: () => resp('{"mensagem":"parâmetro inválido"}', 400) })
  const e = await falhaVarrer(amb2.con)
  assert.equal(e.codigo, 'http'); assert.equal(amb2.chamadas.length, 1)
})

await ok('401: mensagem de permissão do módulo Produtos, sem repetir; testar() devolve ok:false', async () => {
  const amb = criarAmbiente({ antes: () => resp('{"mensagem":"não autorizado"}', 401) })
  const e = await falhaVarrer(amb.con)
  assert.equal(e.codigo, 'sem_permissao'); assert.match(e.message, /permissão de Leitura no módulo Produtos/)
  assert.equal(amb.chamadas.length, 1)
  const t = await criarAmbiente({ antes: () => resp('', 401) }).con.testar()
  assert.equal(t.ok, false); assert.equal(t.empresa, null); assert.match(t.erro, /permissão/)
})

await ok('invalid_grant ou token null → "reautorizar", sem laço e sem chamar o Tiny', async () => {
  const a = criarAmbiente({ token: async () => { throw new Error('invalid_grant: refresh expirado') } })
  const e = await falhaVarrer(a.con)
  assert.equal(e.codigo, 'reautorizar'); assert.equal(a.chamadas.length, 0); assert.equal(a.tokens, 1)
  const b = criarAmbiente({ token: async () => null })
  assert.equal((await falha(b.con.custoDoProduto('1001'))).codigo, 'reautorizar'); assert.equal(b.chamadas.length, 0)
  const t = await criarAmbiente({ token: async () => null }).con.testar()
  assert.equal(t.ok, false); assert.match(t.erro, /reautorizar/)
})

await ok('token nunca aparece em erro devolvido nem em log', async () => {
  const amb = criarAmbiente({ antes: (_r, _u, i) => (i <= 2 ? resp(`erro interno; Authorization: Bearer ${TOKEN}`, 500) : resp(`{"eco":"${TOKEN}","h":"Bearer ${TOKEN}"}`, 418)) })
  const e = await falhaVarrer(amb.con)
  assert.equal(e.status, 418)
  for (const texto of [e.message, JSON.stringify(e), ...amb.logs]) assert.ok(!texto.includes(TOKEN), texto)
  const t = await criarAmbiente({ antes: () => resp(`Bearer ${TOKEN}`, 403) }).con.testar()
  assert.ok(!JSON.stringify(t).includes(TOKEN))
})

await ok('testar(): GET /produtos?limit=1 → ok, empresa null', async () => {
  const amb = criarAmbiente()
  assert.deepEqual(await amb.con.testar(), { ok: true, empresa: null })
  assert.deepEqual(caminhos(amb.chamadas), ['/produtos?limit=1'])
})

await ok('custoDoProduto: simples, pai (variações), kit e 404 sem linha; id inválido nem chama o Tiny', async () => {
  const amb = criarAmbiente()
  assert.deepEqual((await amb.con.custoDoProduto('1001', { skuConhecido: 'OUTRO' })).linhas.map(l => [l.sku, l.custo]), [['CAN-001', 36.32]])
  assert.deepEqual((await amb.con.custoDoProduto(2000)).linhas.map(l => [l.sku, l.custo, l.variacao_de]), [['CAMISA-P', 18, 'CAMISA'], ['CAMISA-M', null, 'CAMISA']])
  assert.deepEqual(await amb.con.custoDoProduto('3000'), { linhas: [], kits: [{ id_externo: '3000', sku: 'KIT-2CAN', custo_proprio: 70, componentes: [{ id_externo: '1001', quantidade: 2 }] }] }, 'kit: estrutura para a soma do M7 (nunca o custo próprio direto)')
  assert.deepEqual(await amb.con.custoDoProduto('999'), { linhas: [] })
  const antes = amb.chamadas.length
  for (const id of ['../empresas', '1/kit', '', null]) assert.equal((await falha(amb.con.custoDoProduto(id))).codigo, 'id')
  assert.equal(amb.chamadas.length, antes)
})

console.log(`✔ teste-erp-tiny: ${n} casos (conector Tiny, somente leitura, fixtures sem rede) passaram`)
