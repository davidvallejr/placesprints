// Auto-teste do conector Bling (M4, docs/integracao-custos-erp-SPEC.md 7.1/7.2/12). SEM REDE e SEM BANCO: HTTP, limitador e token
// são stubs; as respostas vêm de scripts/fixtures/erp/bling-*.json (construídas da documentação, não são captura real).
// Rodar: node scripts/teste-erp-bling.mjs
process.env.PS_PROMO_MEMORIA = '1'                       // defesa: este teste não importa o banco, mas se um dia importar, é em memória
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { criarConectorBling, lerEventoBling, CAMPO_BLING } = await import('../src/lib/erp-bling.js')

const fx = n => JSON.parse(readFileSync(new URL(`./fixtures/erp/bling-${n}.json`, import.meta.url), 'utf8'))
const P1 = fx('produtos-pagina-1'), P2 = fx('produtos-pagina-2'), DET = fx('produtos-detalhe').detalhes
const EMP = fx('empresa-dados-basicos'), ERR = fx('erros'), WH = fx('webhook-product-supplier-updated').evento
const TOKEN = 'tok-SEGREDO-123', TOKEN_NOVO = 'tok-NOVO-456'

let n = 0
const okA = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }
const ok = (nome, fn) => okA(nome, fn)

// completa a página até o limite (100) com itens simples, para provar que "página cheia" pede a próxima
const encher = data => [...data, ...Array.from({ length: 100 - data.length }, (_, i) => ({ id: 90000 + data[0].id + i, codigo: `PAD-${data[0].id}-${i}`, formato: 'S', situacao: 'A', precoCusto: 1 }))]
const PAGINAS = { 1: { data: encher(P1.data) }, 2: { data: encher(P2.data) } }
const resp = (status, obj) => ({ status, headers: {}, texto: typeof obj === 'string' ? obj : JSON.stringify(obj) })
const rotear = (paginas = PAGINAS) => ({ url }) => {
  const u = new URL(url)
  assert.equal(u.origin, 'https://api.bling.com.br')
  if (u.pathname === '/Api/v3/produtos') return resp(200, paginas[u.searchParams.get('pagina')] ?? { data: [] })
  if (u.pathname === '/Api/v3/empresas/me/dados-basicos') return resp(200, EMP)
  const m = u.pathname.match(/^\/Api\/v3\/produtos\/(\d+)$/)
  if (m) return DET[m[1]] ? resp(200, DET[m[1]]) : resp(404, ERR['404_NAO_CONFIRMADO'])
  return resp(500, 'rota inesperada no teste')
}
// conector com stubs que registram tudo (chamadas HTTP, esperas, 429 e pedidos de token)
const montar = (responder, extra = {}) => {
  const s = { chamadas: [], esperas: 0, r429: [], tokens: [] }
  const http = async req => { s.chamadas.push(req); return responder(req, s) }
  const limitador = { aguardar: async () => { s.esperas++ }, registrar429: ms => s.r429.push(ms) }
  const obterToken = extra.obterToken || (async (op = {}) => { s.tokens.push(op); return op.renovar ? TOKEN_NOVO : TOKEN })
  return { c: criarConectorBling({ http, limitador, obterToken, log: () => {}, ...extra }), s }
}
const colher = async it => { const out = []; for await (const p of it) out.push(p); return out }
const todas = pgs => ({ linhas: pgs.flatMap(p => p.linhas), kits: pgs.flatMap(p => p.kits), avisos: pgs.flatMap(p => p.avisos) })
const porSku = (ls, sku) => ls.filter(l => l.sku === sku)
const falha = async (p, codigo) => { try { await p } catch (e) { assert.equal(e.codigo, codigo, e.message); return e } assert.fail('deveria lançar ' + codigo) }

// ── varredura completa ───────────────────────────────────────────────────────────────────────────────────────
const { c, s } = montar(rotear())
const pgs = await colher(c.varrer({ prioridadeSkus: [] }))
const T = todas(pgs)
const listagens = s.chamadas.filter(r => /\/produtos\?/.test(r.url))

await ok('paginação: 2 páginas cheias + 1 vazia, parâmetros criterio=5/pagina/limite=100, para no vazio', () => {
  assert.equal(listagens.length, 3)
  listagens.forEach((r, i) => {
    const q = new URL(r.url).searchParams
    assert.equal(r.metodo, 'GET'); assert.equal(q.get('pagina'), String(i + 1)); assert.equal(q.get('limite'), '100'); assert.equal(q.get('criterio'), '5')
  })
  assert.deepEqual(pgs.map(p => p.pagina), [1, 2, 3])                  // 3 = lote final dos adiados (kits, variações, detalhes)
  assert.equal(porSku(T.linhas, 'PAD-1001-0').length, 1); assert.equal(porSku(T.linhas, 'PAD-2001-96').length, 1)
})
await ok('página menor que o limite encerra sem pedir a próxima', async () => {
  const { c: c2, s: s2 } = montar(rotear({ 1: { data: [P1.data[0]] } }))
  const p = await colher(c2.varrer())
  assert.equal(s2.chamadas.length, 1); assert.equal(p.length, 1); assert.equal(p[0].linhas[0].sku, 'CAM-001')
})
await ok('custo = precoCusto da raiz (fornecedor padrão), campo de proveniência fixo, mlb null, sem data inventada', () => {
  const [l] = porSku(T.linhas, 'CAM-001')
  assert.deepEqual(l, { sku: 'CAM-001', mlb: null, custo: 36.32, campo: CAMPO_BLING, id_externo: '1001', atualizado_na_fonte: null, variacao_de: null })
  assert.equal(CAMPO_BLING, 'bling.fornecedor_padrao.precoCusto')
})
await ok('precoCusto 0 na listagem → detalhe (fornecedor.precoCusto); precoCompra NUNCA vira custo', () => {
  assert.equal(porSku(T.linhas, 'CAM-002')[0].custo, 12.5)
  const [l] = porSku(T.linhas, 'CUSTO-NULL')                             // só precoCompra = 8 no Bling
  assert.equal(l.custo, null); assert.match(l.dica, /precoCompra 8 existe, mas não é usado como custo/)
  assert.ok(!T.linhas.some(x => x.custo === 8 || x.custo === 11 || x.custo === 30))
})
await ok('sem fornecedor padrão / custo vazio ou zero: LINHA com custo null (nunca 0, nunca pulada em silêncio)', () => {
  const [l] = porSku(T.linhas, 'SEM-FORN')
  assert.equal(l.custo, null); assert.match(l.dica, /sem precoCusto do fornecedor padrão/)
  assert.ok(T.linhas.every(x => x.custo !== 0 && x.custo !== '0'))
  assert.ok(T.kits.every(k => k.custo_proprio !== 0))
})
await ok('bruto repassado (quem valida é o aplicarLote): string decimal e negativo', () => {
  assert.equal(porSku(T.linhas, 'STR-CUSTO')[0].custo, '36.3200000000')
  assert.equal(porSku(T.linhas, 'NEG-1')[0].custo, -5)
})
await ok('produto sem código vira linha com sku vazio (aplicarLote rejeita sku_vazio); nada é inventado', () => {
  const ls = T.linhas.filter(x => x.id_externo === '1010')
  assert.equal(ls.length, 1); assert.equal(ls[0].sku, ''); assert.equal(ls[0].custo, 10)
})
await ok('pai V ignorado com aviso; variação com variacao_de = SKU do pai (pai em página POSTERIOR)', () => {
  assert.equal(porSku(T.linhas, 'PAI-V').length, 0)
  assert.ok(T.avisos.some(a => /pai de variação ignorado/.test(a)))
  const [v] = porSku(T.linhas, 'VAR-AZUL'); assert.equal(v.variacao_de, 'PAI-V'); assert.equal(v.custo, 20)
})
await ok('inativo entra; excluído (situacao E) fica de fora com aviso', () => {
  assert.equal(porSku(T.linhas, 'INATIVO-1')[0].custo, 15)
  assert.equal(porSku(T.linhas, 'EXCLUIDO-1').length, 0)
  assert.ok(T.avisos.some(a => /excluído/.test(a)))
})
await ok('kit E: vai para kits com componentes do detalhe; kit sem estrutura → componentes null (pendente); nunca em linhas', () => {
  const k = T.kits.find(x => x.sku === 'KIT-01')
  assert.deepEqual(k, { id_externo: '1006', sku: 'KIT-01', custo_proprio: 50, componentes: [{ id_externo: '1001', quantidade: 2 }, { id_externo: '1002', quantidade: 1 }] })
  assert.deepEqual(T.kits.find(x => x.sku === 'KIT-SEM'), { id_externo: '1007', sku: 'KIT-SEM', custo_proprio: null, componentes: null })
  assert.equal(porSku(T.linhas, 'KIT-01').length + porSku(T.linhas, 'KIT-SEM').length, 0)
})
await ok('só detalha quem precisa (sem custo e kits): 1002, 1003, 1006, 1007, 1011', () => {
  const det = s.chamadas.map(r => new URL(r.url).pathname.match(/\/produtos\/(\d+)$/)?.[1]).filter(Boolean).sort()
  assert.deepEqual(det, ['1002', '1003', '1006', '1007', '1011'])
})
await ok('enable-jwt: 1 e Authorization Bearer em TODAS as chamadas; limitador antes de cada uma; só GET', () => {
  assert.ok(s.chamadas.every(r => r.headers['enable-jwt'] === '1' && r.headers.Authorization === `Bearer ${TOKEN}` && r.metodo === 'GET' && r.timeoutMs === 20000))
  assert.equal(s.esperas, s.chamadas.length)
})
await ok('teto de detalhes: prioriza SKUs de anúncio; excedente sai em pendentes_detalhe com custo null (kit: componentes null)', async () => {
  const { c: c3, s: s3 } = montar(rotear(), { tetoDetalhes: 1 })
  const p = await colher(c3.varrer({ prioridadeSkus: ['custo-null'] }))   // caixa diferente casa (chave minúscula)
  const fim = p.at(-1), det = s3.chamadas.filter(r => /\/produtos\/\d+$/.test(r.url))
  assert.equal(det.length, 1); assert.match(det[0].url, /\/produtos\/1011$/)
  assert.deepEqual([...fim.pendentes_detalhe].sort(), ['1002', '1003', '1006', '1007'])
  const l = fim.linhas.find(x => x.sku === 'CAM-002'); assert.equal(l.custo, null); assert.match(l.dica, /detalhe pendente/)
  assert.equal(fim.kits.find(k => k.sku === 'KIT-01').componentes, null)
  assert.ok(fim.avisos.some(a => /teto de 1 detalhes/.test(a)))
})
await ok('detalhe 404 de UM produto não derruba a varredura: linha custo null + aviso', async () => {
  const { c: c4 } = montar(rotear({ 1: { data: [{ id: 4040, codigo: 'SUMIU', formato: 'S', situacao: 'A', precoCusto: 0 }] } }))
  const t = todas(await colher(c4.varrer()))
  assert.equal(porSku(t.linhas, 'SUMIU')[0].custo, null); assert.ok(t.avisos.some(a => /4040 falhou \(HTTP 404\)/.test(a)))
})

// ── erros, limites e credencial ──────────────────────────────────────────────────────────────────────────────
const seq = (...rs) => (req, st) => rs[Math.min(st.chamadas.length - 1, rs.length - 1)]
await ok('429 period=second: espera >= 1 s (via limitador) e tenta de novo', async () => {
  const { c: c5, s: s5 } = montar(seq(resp(429, ERR['429_segundo']), resp(429, ERR['429_segundo']), resp(200, EMP)))
  const r = await c5.testar()
  assert.equal(r.ok, true); assert.equal(s5.chamadas.length, 3); assert.equal(s5.r429.length, 2)
  assert.ok(s5.r429.every(ms => ms >= 1000 && ms < 1500))
})
await ok('429 por segundo insistente: no máximo 4 novas tentativas, depois erro (sem laço)', async () => {
  const { c: c6, s: s6 } = montar(() => resp(429, ERR['429_segundo']))
  const e = await falha(c6.custoDoProduto('1002'), 'http'); assert.equal(e.status, 429)
  assert.equal(s6.chamadas.length, 5); assert.equal(s6.r429.length, 4)
})
await ok('429 period=day: para na hora com limite_dia', async () => {
  const { c: c7, s: s7 } = montar(() => resp(429, ERR['429_dia_NAO_CONFIRMADO']))
  await falha(colher(c7.varrer()), 'limite_dia'); assert.equal(s7.chamadas.length, 1); assert.equal(s7.r429.length, 0)
})
await ok('401: renova UMA vez (obterToken {renovar:true}) e segue com o token novo', async () => {
  const { c: c8, s: s8 } = montar(req => req.headers.Authorization === `Bearer ${TOKEN_NOVO}` ? resp(200, DET['1002']) : resp(401, ERR['401_NAO_CONFIRMADO']))
  const r = await c8.custoDoProduto('1002')
  assert.equal(r.linhas[0].custo, 12.5); assert.equal(s8.chamadas.length, 2)
  assert.deepEqual(s8.tokens, [{}, { renovar: true }])
  assert.ok(s8.chamadas.every(x => x.headers['enable-jwt'] === '1'))
})
await ok('401 de novo após renovar → reautorizar, sem laço; o token nunca aparece no erro', async () => {
  const eco = { error: { type: 'invalid_token', description: `token Bearer ${TOKEN} recusado; access_token=${TOKEN_NOVO}` } }
  const { c: c9, s: s9 } = montar(() => resp(401, eco))
  const e = await falha(colher(c9.varrer()), 'reautorizar')
  assert.equal(s9.chamadas.length, 2); assert.equal(s9.tokens.filter(t => t.renovar).length, 1)
  assert.ok(!e.message.includes(TOKEN) && !e.message.includes(TOKEN_NOVO) && !/tok-/.test(e.message), e.message)
  const t = await c9.testar()
  assert.equal(t.ok, false); assert.equal(t.codigo, 'reautorizar'); assert.ok(!/tok-/.test(t.erro))
})
await ok('403 → reautorizar na primeira, sem renovar', async () => {
  const { c: c10, s: s10 } = montar(() => resp(403, ERR['403_NAO_CONFIRMADO']))
  await falha(c10.custoDoProduto('1'), 'reautorizar'); assert.equal(s10.chamadas.length, 1); assert.equal(s10.tokens.length, 1)
})
await ok('invalid_grant / token null: reautorizar sem chamar o Bling e sem laço', async () => {
  let pedidos = 0
  const { c: c11, s: s11 } = montar(() => resp(200, EMP), { obterToken: async () => { pedidos++; throw new Error(`invalid_grant refresh_token=${TOKEN}`) } })
  const e = await falha(colher(c11.varrer()), 'reautorizar')
  assert.equal(pedidos, 1); assert.equal(s11.chamadas.length, 0); assert.ok(!e.message.includes(TOKEN), e.message)
  const { c: c12, s: s12 } = montar(() => resp(200, EMP), { obterToken: async () => null })
  assert.equal((await c12.testar()).codigo, 'reautorizar'); assert.equal(s12.chamadas.length, 0)
})
await ok('outros 4xx não são repetidos; 5xx/rede viram erro http (o M7 marca erro e não fecha o sync)', async () => {
  const { c: c13, s: s13 } = montar(() => resp(400, { error: { type: 'VALIDATION_ERROR' } }))
  assert.equal((await falha(c13.custoDoProduto('1'), 'http')).status, 400); assert.equal(s13.chamadas.length, 1)
  const { c: c14 } = montar(() => { throw new Error('ECONNRESET') })
  await falha(colher(c14.varrer()), 'http')
})

// ── testar, custoDoProduto, gatilho do webhook ───────────────────────────────────────────────────────────────
await ok('testar(): GET /empresas/me/dados-basicos → empresa {id string, nome}', async () => {
  const { c: c15, s: s15 } = montar(rotear())
  assert.deepEqual(await c15.testar(), { ok: true, empresa: { id: 'd4475854366a36c86a37e792f9634a51', nome: 'Empresa Exemplo Ltda' } })
  assert.match(s15.chamadas[0].url, /\/Api\/v3\/empresas\/me\/dados-basicos$/)
})
await ok('custoDoProduto: linha do detalhe; kit vai para kits (soma é do M7); sem custo → null com dica; skuConhecido só sem campo codigo', async () => {
  const { c: c16 } = montar(rotear())
  assert.deepEqual((await c16.custoDoProduto('1002')).linhas, [{ sku: 'CAM-002', mlb: null, custo: 12.5, campo: CAMPO_BLING, id_externo: '1002', atualizado_na_fonte: null, variacao_de: null }])
  const k = await c16.custoDoProduto('1006'); assert.equal(k.linhas.length, 0); assert.equal(k.kits[0].componentes.length, 2)
  const z = (await c16.custoDoProduto('1003', { skuConhecido: 'OUTRO' })).linhas[0]; assert.equal(z.custo, null); assert.equal(z.sku, 'SEM-FORN')
  const { c: c17 } = montar(() => resp(200, { data: { id: 7, formato: 'S', situacao: 'A', precoCusto: 9.9 } }))
  assert.equal((await c17.custoDoProduto('7', { skuConhecido: 'SKU-7' })).linhas[0].sku, 'SKU-7')
  const { c: c18 } = montar(() => resp(200, { data: { id: 8, codigo: '', formato: 'S', situacao: 'A', precoCusto: 9.9 } }))
  assert.equal((await c18.custoDoProduto('8', { skuConhecido: 'SKU-8' })).linhas[0].sku, '')   // ERP diz "sem SKU": não se usa o antigo
})
await ok('lerEventoBling: product_supplier.updated do fornecedor padrão → id do produto; resto → null; codigo do fornecedor nunca vira SKU', () => {
  assert.deepEqual(lerEventoBling(WH), { evento_id: '01945e5a-0b6f-7c2e-9d1a-3f2b7c8d9e10', company_id: 'd4475854366a36c86a37e792f9634a51', data: '2026-10-05T12:00:00Z', id_externo: '1002' })
  assert.ok(!JSON.stringify(lerEventoBling(WH)).includes('FORN-CX-02'))
  assert.equal(lerEventoBling({ ...WH, event: 'product_supplier.created' }).id_externo, '1002')
  assert.equal(lerEventoBling({ ...WH, data: { ...WH.data, padrao: false } }), null)
  assert.equal(lerEventoBling({ ...WH, event: 'product_supplier.deleted' }), null)
  assert.equal(lerEventoBling({ ...WH, event: 'product.updated' }), null)
  assert.equal(lerEventoBling({ ...WH, eventId: '' }), null)
  assert.equal(lerEventoBling({ ...WH, data: { ...WH.data, produto: {} } }), null)
  assert.equal(lerEventoBling(null), null)
})

console.log(`✔ teste-erp-bling: ${n} verificações OK (paginação, campo sem fallback, custo vazio/zero como linha, 401/403 → reautorizar, 429, kits, gatilho)`)
