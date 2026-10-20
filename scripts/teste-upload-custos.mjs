// Autoteste da PLANILHA DE CUSTOS subida na tela (src/lib/custos-upload.js + src/rotas-custos-upload.js + extensão F1 de custo-vinculo.js).
// Banco EM MEMÓRIA, sem rede além de uma porta local efêmera. Rodar: node scripts/teste-upload-custos.mjs
process.env.PS_PROMO_MEMORIA = '1'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
const R = await import('../src/lib/promocoes-db.js')
const C = await import('../src/lib/custos-db.js')
const U = await import('../src/lib/custos-upload.js')
const { SCHEMA_PRODUTO } = await import('../src/lib/produto-estoque.js')
const { criarRotasCustosUpload } = await import('../src/rotas-custos-upload.js')
assert.equal(R.EM_MEMORIA, true, 'o teste jamais pode abrir o banco real')
const db = R.db
db.exec(SCHEMA_PRODUTO)
db.exec(`CREATE TABLE IF NOT EXISTS meli_item (cliente TEXT, item_id TEXT, titulo TEXT, thumb TEXT DEFAULT '', preco REAL, status TEXT DEFAULT 'active', catalogo INTEGER DEFAULT 0, PRIMARY KEY (cliente, item_id))`)

let n = 0
const casos = []
const caso = (nome, fn) => casos.push([nome, fn])
const A = 'Pet Teste', B = 'Vizinho Teste'
const item = (c, id, titulo, preco) => db.prepare('INSERT INTO meli_item (cliente, item_id, titulo, preco) VALUES (?,?,?,?)').run(c, id, titulo, preco)
const promo = (c, id, sku, preco, up = '') => db.prepare('INSERT INTO promo_anuncio (cliente, item_id, sku, preco, user_product_id) VALUES (?,?,?,?,?)').run(c, id, sku, preco, up)
const f1 = (c, id, varId, sku, fonte, up = '', inv = '') => db.prepare("INSERT INTO meli_anuncio_up (cliente, item_id, variacao_id, user_product_id, inventory_id, sku, sku_fonte, status, lido_em) VALUES (?,?,?,?,?,?,?,'active','2026-10-15')").run(c, id, varId, up, inv, sku, fonte)
// anúncios do cliente A: um por critério
item(A, 'MLB1001', 'Peitoral Azul Tamanho P', 100); promo(A, 'MLB1001', 'SKU-A', 100, 'MLBU9')                // SKU exato (promo)
item(A, 'MLB1002', 'Guia Retrátil 5 metros', 1500); f1(A, 'MLB1002', '', 'GUIA-5M', 'seller_sku')                // SKU exato só no F1
item(A, 'MLB1003', 'Cinto de Segurança Pet', 60); f1(A, 'MLB1003', '', 'CINTO SEG', 'seller_sku')              // SKU normalizado
item(A, 'MLB1004', 'Peitoral Azul Tamanho P Kit', 120); f1(A, 'MLB1004', '', '', '', 'MLBU9')                  // mesmo produto do 1001 (grupo)
item(A, 'MLB1005', 'Bebedouro Portátil', 90); f1(A, 'MLB1005', '11', 'VAR-P', 'variacao'); f1(A, 'MLB1005', '12', 'VAR-G', 'variacao')   // variações com custos diferentes
item(A, 'MLB1012', 'Bolinha Pet', 25); f1(A, 'MLB1012', '31', 'BOL-P', 'variacao'); f1(A, 'MLB1012', '32', 'BOL-G', 'variacao')   // variações de MESMO custo
item(A, 'MLB1006', 'Comedouro Lento', 70); f1(A, 'MLB1006', '21', 'V6-P', 'variacao'); f1(A, 'MLB1006', '22', 'V6-G', 'variacao')        // só uma variação na planilha
item(A, 'MLB1007', 'Cama Pet Redonda', 150)                                                                       // sem SKU: só pelo MLB
item(A, 'MLB1008', 'Coleira Azul Tamanho Grande Nylon', 40)                                                       // só título parecido (sugestão)
item(A, 'MLB1009', 'Kit 3 Bolinhas', 45); f1(A, 'MLB1009', '', 'KIT-3', 'seller_sku')
item(A, 'MLB1010', 'Tapete Higiênico', 50); f1(A, 'MLB1010', '', 'TAP-1', 'seller_sku')                         // custo ≥ preço → quarentena
item(A, 'MLB1011', 'Escova Pet', 30); f1(A, 'MLB1011', '', 'ESC-1', 'seller_custom_field')                        // campo livre NÃO é SKU oficial
item(B, 'MLB2001', 'Outro cliente', 99); promo(B, 'MLB2001', 'SKU-A', 99)
db.prepare("INSERT INTO kit_componente (cliente, kit, componente, quantidade, modo, fonte, em) VALUES (?, 'item:MLB1009', 'sku:BOLA', 3, 'pre_montado', 'declarado', '2026-10-15')").run(A)

const CSV = ['Planilha de custos — Pet Teste',                                                      // linha de título antes do cabeçalho
  'Código;ID do Anúncio;Descrição;Preço de Custo;Qtd Kit;Fornecedor;Prazo de reposição;NCM',
  'SKU-A;;Peitoral;"R$ 25,50";;Fornecedor X;15 dias;4201.00.90',
  'guia-5m;;;R$ 1.234,56;;;;',
  'CINTO-SEG;;;12.5;;;;',
  'VAR-P;;;10;;;;', 'VAR-G;;;11;;;;', 'V6-P;;;9;;;;', 'BOL-P;;;5;;;;', 'BOL-G;;;5,00;;;;',
  ';mlb-1007;Cama;30,00;;;;',
  ';;Coleira Azul Grande;8;;;;',
  'KIT-3;;Kit;20;3;;;',
  'TAP-1;;;60;;;;',
  'DUP;;;10;;;;', 'DUP;;;12;;;;',
  ';MLB2001;;5;;;;',
  'OUTRO;MLB1001;;5;;;;',
  'ESC-1;;;7;;;;',
  'ZERO;;;0;;;;', 'AMB;;;1.234;;;;', 'VAZIO;;;;;;;', ''].join('\r\n')

// XLSX mínimo (zip deflate + sharedStrings + inlineStr + número) com o MESMO conteúdo
function xlsx(linhas) {
  const sst = [], idx = s => { let i = sst.indexOf(s); if (i < 0) { i = sst.length; sst.push(s) } return i }
  const col = i => String.fromCharCode(65 + i), x = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const rows = linhas.map((l, r) => `<row r="${r + 1}">${l.map((v, i) => v === '' ? '' : typeof v === 'number' ? `<c r="${col(i)}${r + 1}"><v>${v}</v></c>`
    : i === 2 ? `<c r="${col(i)}${r + 1}" t="inlineStr"><is><t>${x(v)}</t></is></c>` : `<c r="${col(i)}${r + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`).join('')
  const arquivos = {
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Custos" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst>${sst.map(s => `<si><r><t>${x(s)}</t></r></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
  }
  arquivos['xl/sharedStrings.xml'] = `<sst>${sst.map(s => `<si><r><t>${x(s)}</t></r></si>`).join('')}</sst>`
  const locais = [], centrais = []; let off = 0
  for (const [nome, txt] of Object.entries(arquivos)) {
    const dado = deflateRawSync(Buffer.from(txt)), nb = Buffer.from(nome)
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(dado.length, 18); h.writeUInt32LE(txt.length, 22); h.writeUInt16LE(nb.length, 26)
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(dado.length, 20); c.writeUInt32LE(txt.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42)
    locais.push(h, nb, dado); centrais.push(c, nb); off += 30 + nb.length + dado.length
  }
  const cd = Buffer.concat(centrais), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(centrais.length / 2, 8); e.writeUInt16LE(centrais.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16)
  return Buffer.concat([...locais, cd, e])
}

const dir = mkdtempSync(join(tmpdir(), 'ps-upload-'))
const livro = [], prazos = [], recalc = []
const up = U.criarUploadCustos({ handle: db, nucleo: { aplicarLote: C.aplicarLote, vinculosCusto: C.vinculosCusto, getCfgCustos: C.getCfgCustos, chaveSku: C.chaveSku }, dir,
  validarPor: (n, c) => (n === 'Lider' || (n === 'CS A' && c === A) ? n : ''), curvas: () => new Map([['MLB1001', 'A'], ['MLB1002', 'A'], ['MLB1007', 'B'], ['MLB1008', 'A'], ['MLB1010', 'C']]),
  tarifas: () => new Map([['MLB1001', 12]]), livro: { registrar: e => { livro.push(e); return { seq: livro.length, novo: true } } },
  leadTime: { salvar: b => { prazos.push(b); return { mudou: true } } }, recalcular: c => { recalc.push(c); return { recalculado: true } } })
const contagem = () => ['erp_custos_sku', 'custo_vinculo', 'erp_custos_hist', 'promo_auditoria', 'erp_quarentena', 'erp_rejeitadas'].map(t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n).join(',')

let pv
caso('CSV: título antes do cabeçalho, colunas com nomes variados, BR/internacional, linha em branco não é erro, inválidas com motivo', () => {
  const linhas = U.lerCsv(Buffer.from('﻿' + CSV)), det = U.detectarColunas(linhas)
  assert.equal(det.linha_cabecalho, 1)
  assert.deepEqual(Object.keys(det.colunas).sort(), ['custo', 'fornecedor', 'kit', 'mlb', 'ncm', 'prazo', 'sku', 'titulo'])
  assert.equal(det.nomes.custo, 'Preço de Custo'); assert.equal(det.nomes.mlb, 'ID do Anúncio'); assert.equal(det.nomes.sku, 'Código')
  const nl = U.normalizarLinhas(linhas, det)
  const porSku = Object.fromEntries(nl.linhas.map(l => [l.sku || l.mlb || l.titulo, l]))
  assert.equal(porSku['SKU-A'].custo, 25.5); assert.equal(porSku['guia-5m'].custo, 1234.56); assert.equal(porSku['CINTO-SEG'].custo, 12.5)
  assert.equal(porSku['SKU-A'].prazo_dias, 15); assert.equal(porSku['SKU-A'].ncm, '42010090'); assert.equal(porSku['KIT-3'].kit, 3); assert.equal(porSku.MLB1007.custo, 30)
  assert.equal(nl.em_branco, 1)
  assert.equal(U.mlbDe('1234567890'), 'MLB1234567890'); assert.equal(U.mlbDe('https://produto.mercadolivre.com.br/MLB-1234567890-peitoral'), 'MLB1234567890'); assert.equal(U.mlbDe('abc'), null); assert.equal(U.mlbDe(''), '')
  assert.deepEqual(nl.invalidas.map(i => i.sku), ['ZERO', 'AMB']); assert.match(nl.invalidas[1].motivo, /ambíguo/)
  assert.equal(U.normalizarLinhas(U.lerCsv(Buffer.from('sku,custo\nX,"1,234.56"')), U.detectarColunas(U.lerCsv(Buffer.from('sku,custo\nX,"1,234.56"')))).linhas[0].custo, 1234.56, 'internacional entre aspas')
  assert.equal(U.lerCsv(Buffer.from('sku;custo\nÇA;1', 'latin1'))[1][0], 'ÇA', 'Windows-1252 do Excel')
  assert.throws(() => U.detectarColunas([['nome', 'preço']]), /coluna de custo/)
})

caso('prévia: cada critério de associação (MLB > SKU exato > SKU normalizado > grupo > variação), título só SUGESTÃO, kit, conflitos, quarentena — e NADA gravado', () => {
  const antes = contagem()
  pv = up.previa({ cliente: A, nome: 'custos.csv', buffer: Buffer.from(CSV) })
  assert.equal(contagem(), antes, 'prévia não grava (transação desfeita)')
  assert.equal(pv.previa, true); assert.match(pv.upload_id, /^[0-9a-f]{16}-[0-9a-f]{64}$/)
  const a = Object.fromEntries(pv.anuncios.map(x => [x.item_id, x]))
  assert.equal(a.MLB1001.origem, 'sku'); assert.equal(a.MLB1001.custo, 25.5)
  assert.equal(a.MLB1002.origem, 'sku', 'SKU oficial do F1 (meli_anuncio_up) casa exato')
  assert.equal(a.MLB1003.origem, 'sku_normalizado')
  assert.equal(a.MLB1004.origem, 'grupo', 'irmão do mesmo user_product_id herda')
  assert.equal(a.MLB1005, undefined, 'variações com custos diferentes: sem custo único do anúncio')
  assert.equal(a.MLB1006.origem, 'sku', 'variação única com custo vale para o anúncio'); assert.equal(a.MLB1006.custo, 9)
  assert.equal(a.MLB1012.origem, 'sku', 'variações de mesmo custo: o anúncio tem custo'); assert.equal(a.MLB1012.custo, 5)
  assert.equal(a.MLB1007.origem, 'mlb'); assert.equal(a.MLB1007.custo, 30)
  assert.equal(a.MLB1008, undefined, 'título parecido nunca casa sozinho')
  assert.equal(a.MLB1011, undefined, 'seller_custom_field não é SKU oficial')
  assert.deepEqual(a.MLB1009.kit, { quantidade: 3, componentes_registrados: 1 })
  assert.equal(a.MLB1001.margem, 62.5, 'preço − custo − tarifa conhecida'); assert.equal(a.MLB1002.margem, null, 'sem tarifa = —')
  assert.equal(a.MLB1001.curva, 'A')
  assert.equal(pv.criterios.mlb, 1); assert.equal(pv.criterios.sku, 6); assert.equal(pv.criterios.sku_normalizado, 1); assert.equal(pv.criterios.variacao, 2)
  assert.ok(pv.criterios.sem_par >= 2)
  const sug = pv.sem_par.find(s => s.titulo === 'Coleira Azul Grande')
  assert.equal(sug.sugestoes[0].item_id, 'MLB1008', 'sugestão pelo título')
  assert.deepEqual(pv.conflitos.map(c => c.tipo).sort(), ['mlb_fora', 'sku_duplicado', 'sku_duplicado', 'sku_mlb'])
  assert.deepEqual(pv.quarentena.map(q => q.sku), ['TAP-1']); assert.match(pv.quarentena[0].motivo, /preço cheio/)
  assert.equal(pv.efeito.curva_ab, 4); assert.equal(pv.efeito.curva_ab_passam_a_ter_margem, 3)
  assert.equal(pv.prazos, 2, 'o irmão do mesmo produto herda o prazo da linha'); assert.ok(pv.avisos.some(x => /NCM/.test(x)))
  assert.ok(readdirSync(dir).length === 1, 'original guardado na pasta do cliente')
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB1001' }).custo, null)
})

caso('XLSX com o mesmo conteúdo dá a mesma prévia', () => {
  const linhas = U.lerCsv(Buffer.from(CSV)).map(l => l.map((v, i) => i === 3 && /^\d+$/.test(v) ? Number(v) : v))
  const px = up.previa({ cliente: A, nome: 'custos.xlsx', buffer: xlsx(linhas) })
  assert.deepEqual(px.criterios, pv.criterios); assert.equal(px.total_anuncios, pv.total_anuncios)
  assert.equal(px.anuncios.find(x => x.item_id === 'MLB1003').custo, 12.5)
})

caso('confirmar: sem confirmar = prévia; "por" fora do cliente = 403; confirmar:true grava pelo aplicarLote (fonte upload), vínculo do MLB, livro, prazo, recálculo', () => {
  const antes = contagem()
  assert.equal(up.confirmar({ upload_id: pv.upload_id, por: 'Lider' }).previa, true); assert.equal(contagem(), antes)
  assert.throws(() => up.confirmar({ upload_id: pv.upload_id, por: 'Fulano', confirmar: true }), e => e.status === 403)
  assert.throws(() => up.confirmar({ upload_id: pv.upload_id, por: 'Lider', confirmar: true, cliente: B }), e => e.status === 404, 'upload de outro cliente')
  assert.throws(() => up.confirmar({ upload_id: 'x', por: 'Lider', confirmar: true }), /upload_id inválido/)
  const r = up.confirmar({ upload_id: pv.upload_id, por: 'CS A', confirmar: true })
  assert.equal(r.previa, false)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM erp_custos_sku WHERE cliente = ? AND fonte = 'upload'").get(A).n, r.lote.novas)
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB1001' }).custo, 25.5)
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB1004' }).origem, 'grupo')
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB1007' }).origem, 'manual')
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB1005', sku: 'VAR-G' }).custo, 11, 'a venda da variação usa o custo dela (lucro F4)')
  assert.equal(C.vinculosCusto.custoDoAnuncio(A, { item_id: 'MLB1010' }).custo, null, 'quarentena não vale')
  assert.equal(db.prepare("SELECT COUNT(*) n FROM erp_quarentena WHERE cliente = ? AND fonte = 'upload'").get(A).n, 1)
  assert.equal(livro.length, 1); assert.equal(livro[0].tipo, 'nota'); assert.match(livro[0].prova, /^sha256:[0-9a-f]{64}$/); assert.ok(!JSON.stringify(livro[0]).includes('Fornecedor X'), 'o arquivo não vai ao livro')
  assert.deepEqual(prazos.map(p => [p.chave, p.dias, p.fonte]).sort(), [['MLB1001', 15, 'cliente'], ['MLB1004', 15, 'cliente']])
  assert.deepEqual(recalc, [A])
  assert.equal(C.vinculosCusto.custoDoAnuncio(B, { item_id: 'MLB2001' }).custo, null, 'isolamento: o vizinho com o mesmo SKU continua sem custo')
  assert.equal(C.historicoSku(A, 'SKU-A')[0].fonte, 'upload')
})

caso('precedência: manual > upload > bling > tiny > sheets', () => {
  C.aplicarLote({ cliente: A, fonte: 'bling', lote_id: 'b1', origem: 'sync', linhas: [{ sku: 'GUIA-5M', custo: 999 }] })
  assert.equal(C.custosEfetivos(A).get('guia-5m'), 1234.56, 'upload vence o Bling')
  R.importarCustosSku(A, [{ sku: 'GUIA-5M', custo: 40 }], 'colagem', 'dono')
  assert.equal(C.custosEfetivos(A).get('guia-5m'), 40, 'manual vence o upload')
})

// ── HTTP ────────────────────────────────────────────────────────────────────
const app = express(); app.use(express.json())
app.use(criarRotasCustosUpload({ upload: up, clienteCanonico: c => [A, B].find(x => x.toLowerCase() === c.toLowerCase()) || '' }))
const srv = app.listen(0), base = `http://127.0.0.1:${srv.address().port}`
const multi = (cliente, nome, buf, tipo = 'text/csv') => { const f = new FormData(); f.set('cliente', cliente); f.set('arquivo', new Blob([buf], { type: tipo }), nome); return fetch(base + '/api/cliente/custos/upload', { method: 'POST', body: f }) }
caso('HTTP: multipart prévia; 415 tipo errado e corpo não multipart; 413 acima de 5 MB; 404 cliente fora da central; confirmar só JSON; sem eco', async () => {
  let r = await multi(A, 'custos.csv', Buffer.from(CSV)); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.previa, true)
  r = await multi(A, 'contrato.pdf', Buffer.from('%PDF-1.4 <script>')); assert.equal(r.status, 415); assert.ok(!(await r.text()).includes('contrato'), 'sem eco do nome')
  r = await multi(A, 'velho.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2])); assert.equal(r.status, 415)
  r = await fetch(base + '/api/cliente/custos/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert.equal(r.status, 415)
  r = await multi(A, 'grande.csv', Buffer.alloc(U.LIMITE_BYTES + 10, 'a')); assert.equal(r.status, 413)
  r = await multi('Cliente <b>Fantasma</b>', 'custos.csv', Buffer.from(CSV)); assert.equal(r.status, 404); assert.ok(!(await r.text()).includes('Fantasma'))
  r = await multi('[Comercial] Lead', 'custos.csv', Buffer.from(CSV)); assert.equal(r.status, 400)
  r = await fetch(base + '/api/cliente/custos/upload/confirmar', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }); assert.equal(r.status, 415)
  r = await fetch(base + '/api/cliente/custos/upload/confirmar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ upload_id: j.upload_id, por: 'Lider' }) })
  assert.equal(r.status, 200); assert.equal((await r.json()).previa, true, 'sem confirmar:true = prévia')
})

for (const [nome, fn] of casos) { try { await fn(); n++; console.log('✔', nome) } catch (e) { console.error('FALHOU:', nome); srv.close(); rmSync(dir, { recursive: true, force: true }); throw e } }
srv.close(); rmSync(dir, { recursive: true, force: true })
assert.ok(!existsSync(dir))
console.log(`\n✔ teste-upload-custos: ${n} casos passaram`)
