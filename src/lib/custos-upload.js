// Planilha de custos subida na tela (/cliente › Configurar › «Subir planilha de custos», 15/10/2026 — pedido do David: «se eu subir uma planilha de custos você
// consegue associar automaticamente ao anúncio?»). Não é um 2º motor de custo: lê o arquivo, monta um LOTE e o entrega à porta ÚNICA (custos-db.aplicarLote,
// fonte 'upload', precedência manual > upload > bling > tiny > sheets) e a ligação custo ↔ anúncio é a resolução única de custo-vinculo.js
// (MLB explícito na linha = vínculo manual > SKU oficial exato (promo_anuncio + meli_anuncio_up, anúncio e variação) > SKU normalizado de chave única >
// irmãos do mesmo user_product_id/inventory_id > título parecido = só SUGESTÃO).
// PRÉVIA = a MESMA gravação rodada numa transação desfeita no fim (ROLLBACK): o que a prévia mostra é exatamente o que o Confirmar grava, e nada fica no banco.
// Arquivo: CSV (; , tab — UTF-8 ou Windows-1252) ou XLSX (zip + XML lidos aqui, com zlib do Node: sem dependência nova; .xls antigo = 415, salvar como .xlsx/.csv).
// O original fica em data/custos-upload/<sha256(cliente)[:16]>/<sha256>.<ext> (≤ 5 MB) + .json de metadados; no banco só o lote, o histórico e o livro (resumo + hash).
import { createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { lerCusto } from './promocoes-mc.js'
import { indiceVinculo } from './vinculos.js'
import { chavesF1, juntarChaves, skuForte } from './custo-vinculo.js'

export const LIMITE_BYTES = 5 * 1024 * 1024
const MAX_LINHAS = 20000, MAX_LISTA = 500
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const sha = b => createHash('sha256').update(b).digest('hex')
const r2 = n => Math.round(n * 100) / 100
const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ── tipo pelo conteúdo (nunca só pela extensão) ────────────────────────────────
export function tipoArquivo(buf, nome = '') {
  const ext = String(nome).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) return ext === 'xlsx' || !ext ? 'xlsx' : null           // zip: só como .xlsx
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) return null                                               // .xls antigo (OLE): salvar como .xlsx/.csv
  if (!['csv', 'txt', ''].includes(ext)) return null
  return buf.subarray(0, 8192).includes(0) ? null : 'csv'                                                                // binário não é CSV
}

// ── CSV (RFC 4180: aspas, "" e quebra de linha dentro de aspas) ───────────────
function decodificar(buf) {
  const b = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b) } catch { return new TextDecoder('windows-1252').decode(b) }   // Excel BR salva CSV em 1252
}
export function lerCsv(buf) {
  const t = decodificar(buf), primeira = t.split(/\r?\n/).find(l => l.trim()) || ''
  const conta = c => primeira.split('"').filter((_, i) => i % 2 === 0).join('').split(c).length - 1
  const sep = [';', '\t', ','].sort((a, b) => conta(b) - conta(a))[0]
  const linhas = []; let lin = [], cel = '', aspas = false
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (aspas) { if (ch === '"') { if (t[i + 1] === '"') { cel += '"'; i++ } else aspas = false } else cel += ch; continue }
    if (ch === '"' && !cel.trim()) { aspas = true; cel = '' }
    else if (ch === sep) { lin.push(cel); cel = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; lin.push(cel); linhas.push(lin); lin = []; cel = '' }
    else cel += ch
    if (linhas.length > MAX_LINHAS + 50) break
  }
  if (cel || lin.length) { lin.push(cel); linhas.push(lin) }
  return linhas.map(l => l.map(c => c.trim()))
}

// ── XLSX: zip (diretório central) + sharedStrings + 1ª aba. ponytail: sem estilos/datas/fórmulas (lê o valor em cache <v>); basta p/ SKU, MLB, custo e texto ──
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
const xmlTxt = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m)
function zip(buf) {
  let e = buf.length - 22
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--
  if (e < 0) throw erro('XLSX inválido (arquivo zip corrompido): salve de novo no Excel ou exporte como CSV')
  const n = buf.readUInt16LE(e + 10), ents = new Map()
  let p = buf.readUInt32LE(e + 16)
  for (let i = 0; i < n && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32)
    ents.set(buf.toString('utf8', p + 46, p + 46 + nl), { metodo: buf.readUInt16LE(p + 10), tam: buf.readUInt32LE(p + 20), local: buf.readUInt32LE(p + 42) })
    p += 46 + nl + xl + cl
  }
  return nome => {
    const x = ents.get(nome); if (!x) return null
    const h = x.local, ini = h + 30 + buf.readUInt16LE(h + 26) + buf.readUInt16LE(h + 28), dado = buf.subarray(ini, ini + x.tam)
    if (x.metodo === 0) return dado.toString('utf8')
    if (x.metodo !== 8) throw erro('XLSX com compressão não suportada: exporte como CSV')
    return inflateRawSync(dado, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8')            // teto contra zip-bomba
  }
}
const colIdx = ref => { let n = 0; for (const ch of ref) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
export function lerXlsx(buf) {
  const ler = zip(buf), wb = ler('xl/workbook.xml')
  if (!wb) throw erro('XLSX inválido (sem planilha dentro): salve de novo no Excel ou exporte como CSV')
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]
  const alvo = rid && (ler('xl/_rels/workbook.xml.rels') || '').match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"|<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))
  const caminho = alvo ? (alvo[1] || alvo[2]).replace(/^\/?(xl\/)?/, 'xl/') : 'xl/worksheets/sheet1.xml'
  const folha = ler(caminho) || ler('xl/worksheets/sheet1.xml')
  if (!folha) throw erro('XLSX sem a primeira aba legível: exporte como CSV')
  const sst = [...(ler('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlTxt([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')))
  const linhas = []
  for (const row of folha.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(row[1].match(/\br="(\d+)"/)?.[1] || linhas.length + 1) - 1, lin = []
    if (r > MAX_LINHAS + 50) break
    let k = 0
    for (const c of (row[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = c[1].match(/\br="([A-Z]+)\d+"/)?.[1], t = c[1].match(/\bt="(\w+)"/)?.[1] || 'n', v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      const i = ref ? colIdx(ref) : k
      k = i + 1
      lin[i] = t === 's' ? sst[Number(v)] ?? '' : t === 'inlineStr' ? xmlTxt([...(c[2] || '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''))
        : t === 'str' || t === 'b' ? xmlTxt(v ?? '') : t === 'e' || v == null ? '' : Number(v)
    }
    linhas[r] = Array.from(lin, x => x ?? '')
  }
  return Array.from(linhas, l => l || [])
}

// ── colunas: nome normalizado (sem acento/pontuação) × listas por campo; menor posto vence, uma coluna por campo ──
const CAMPOS = {
  custo: [/^(custo unitario|custo unit|custo por unidade|preco de custo|valor de custo|custo do produto|custo produto|custo medio|cmv|custo)$/, /\b(custo|cmv)\b/],
  mlb: [/^(mlb|id mlb|codigo mlb|anuncio|id anuncio|id do anuncio|codigo do anuncio|cod anuncio|item id|itemid|id ml|id mercado livre|numero do anuncio|n anuncio)$/, /\bmlb\b/, /\banuncio\b(?!.*\b(titulo|nome|descricao)\b)/],
  sku: [/^(sku|seller sku|sku do vendedor|sku vendedor|codigo|cod|codigo do produto|codigo produto|cod produto|referencia|ref|codigo interno|codigo sku|part number)$/, /\bsku\b/, /^(cod|codigo|ref|referencia)\b/],
  titulo: [/^(titulo|nome|descricao|produto|nome do produto|titulo do anuncio|descricao do produto)$/, /\b(titulo|nome|descricao)\b/],
  kit: [/^(kit|qtd kit|qtde kit|quantidade kit|quantidade no kit|quantidade do kit|unidades por kit|unidades no kit|itens no kit|quantidade|qtd|qtde|unidades)$/, /\bkit\b/],
  fornecedor: [/^(fornecedor|fabricante|marca fornecedor)$/, /\b(fornecedor|fabricante)\b/],
  prazo: [/^(prazo|prazo de reposicao|prazo reposicao|lead time|leadtime|prazo do fornecedor|prazo fornecedor|dias de reposicao|reposicao dias)$/, /\b(prazo|lead time|reposicao)\b/],
  ncm: [/^(ncm|codigo ncm)$/, /\bncm\b/],
}
export const NOMES_CAMPO = { custo: 'custo', mlb: 'anúncio (MLB)', sku: 'SKU', titulo: 'título', kit: 'kit / quantidade', fornecedor: 'fornecedor', prazo: 'prazo de reposição (dias)', ncm: 'NCM' }
export function detectarColunas(linhas) {
  for (let r = 0; r < Math.min(linhas.length, 10); r++) {
    const cab = (linhas[r] || []).map(semAcento)
    if (!cab.some(Boolean)) continue
    const pares = []
    cab.forEach((h, i) => { if (h && !/\bestoque\b/.test(h) && !/\bpreco de venda\b|^preco$|^valor de venda$/.test(h)) for (const [campo, regs] of Object.entries(CAMPOS)) { const p = regs.findIndex(re => re.test(h)); if (p >= 0) pares.push({ campo, i, p }) } })
    const col = {}, usada = new Set()
    for (const x of pares.sort((a, b) => a.p - b.p || a.i - b.i)) if (!(x.campo in col) && !usada.has(x.i)) { col[x.campo] = x.i; usada.add(x.i) }
    if ('custo' in col && ('sku' in col || 'mlb' in col || 'titulo' in col)) return { linha_cabecalho: r, colunas: col, nomes: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, String(linhas[r][i] ?? '').trim().slice(0, 60)])) }
  }
  throw erro('não encontrei as colunas: a planilha precisa de uma coluna de custo (custo, custo unitário, preço de custo ou CMV) e uma de SKU (ou código/referência) ou de anúncio (MLB), com o nome na primeira linha')
}

// ── células → linhas normalizadas (custo BR "R$ 1.234,56" e internacional "1,234.56"; ambíguo "1.234" nunca adivinhado) ──
const txtCel = v => typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v ?? '').normalize('NFC').replace(/ /g, ' ').replace(/[​-‍﻿]/g, '').trim()
export function mlbDe(v) {
  const t = txtCel(v).toUpperCase().replace(/[\s-]/g, '')
  const m = t.match(/MLB(\d{1,14})(?!\d)/) || t.match(/^(\d{6,14})$/)        // MLB123…, mlb-123…, link do anúncio ou só os números
  return m ? `MLB${m[1]}` : t ? null : ''                                     // null = preenchido e inválido; '' = vazio
}
const MOTIVO_CUSTO = [[/ambíguo/, 'custo ambíguo (milhar ou decimal?): escreva 1200 ou 1.200,00'], [/zero ou negativo/, 'custo zero ou negativo não é custo'], [/acima/, 'custo acima de R$ 10.000.000'], [/./, 'custo não numérico (use 12,50 ou R$ 1.234,56)']]
export function normalizarLinhas(linhas, det) {
  const c = det.colunas, cel = (l, k) => k in c ? l[c[k]] : '', out = [], invalidas = []
  let em_branco = 0
  for (let r = det.linha_cabecalho + 1; r < linhas.length; r++) {
    const l = linhas[r] || [], n = r + 1
    if (!l.some(v => txtCel(v))) continue
    if (out.length + invalidas.length + em_branco >= MAX_LINHAS) { invalidas.push({ linha: n, motivo: `acima de ${MAX_LINHAS} linhas: o resto do arquivo não foi lido` }); break }
    const sku = txtCel(cel(l, 'sku')), mlb = mlbDe(cel(l, 'mlb')), titulo = txtCel(cel(l, 'titulo')).slice(0, 200), bruto = cel(l, 'custo')
    if (typeof bruto !== 'number' && !txtCel(bruto)) { em_branco++; continue }                           // modelo ainda não preenchido: não é erro
    const cu = lerCusto(typeof bruto === 'number' ? bruto : txtCel(bruto))
    if (cu.motivo) { invalidas.push({ linha: n, sku: sku.slice(0, 80), motivo: MOTIVO_CUSTO.find(([re]) => re.test(cu.motivo))[1] }); continue }
    if (mlb === null) { invalidas.push({ linha: n, sku: sku.slice(0, 80), motivo: 'anúncio inválido: use MLB seguido de números (ou só os números)' }); continue }
    if (sku.length > 80) { invalidas.push({ linha: n, motivo: 'SKU com mais de 80 caracteres' }); continue }
    if (!sku && !mlb && !titulo) { invalidas.push({ linha: n, motivo: 'linha sem SKU, sem anúncio e sem título' }); continue }
    const kitN = Number(String(txtCel(cel(l, 'kit'))).match(/^\d+/)?.[0] || 0), prazoN = Number(String(txtCel(cel(l, 'prazo'))).match(/\d+/)?.[0] || 0)
    out.push({ linha: n, sku, mlb, titulo, custo: Number(cu.custo.toFixed(4)), kit: Number.isInteger(kitN) && kitN > 1 && kitN <= 100 ? kitN : null,
      fornecedor: txtCel(cel(l, 'fornecedor')).slice(0, 80), prazo_dias: prazoN >= 1 && prazoN <= 365 ? prazoN : null, ncm: txtCel(cel(l, 'ncm')).replace(/\D/g, '').slice(0, 8) })
  }
  return { linhas: out, invalidas, em_branco }
}

// ── fábrica com banco ─────────────────────────────────────────────────────────
// deps: handle (o MESMO banco do custos-db) · nucleo { aplicarLote, vinculosCusto, getCfgCustos, chaveSku } · dir (data/custos-upload) · validarPor(nome, cliente) → nome | ''
//       · curvas(cliente) → Map(item_id → 'A'|'B'|'C') · tarifas(cliente) → Map(item_id → R$ por unidade) · livro { registrar } · leadTime { salvar } · recalcular(cliente) → resumo
export function criarUploadCustos({ handle: h, nucleo, dir, validarPor = () => '', curvas = () => new Map(), tarifas = () => new Map(), livro = null, leadTime = null, recalcular = null, agora = () => new Date().toISOString() }) {
  const { aplicarLote, vinculosCusto, getCfgCustos, chaveSku } = nucleo
  const tenta = (sql, ...p) => { try { return h.prepare(sql).all(...p) } catch { return [] } }
  const hc = cliente => sha(String(cliente)).slice(0, 16)

  function anunciosDe(cliente) {
    const promo = tenta('SELECT item_id, sku, user_product_id, titulo, preco, preco_original FROM promo_anuncio WHERE cliente = ?', cliente)
    const f1 = chavesF1(tenta('SELECT item_id, variacao_id, sku, sku_fonte, user_product_id, inventory_id FROM meli_anuncio_up WHERE cliente = ?', cliente))
    const m = juntarChaves(promo, f1)
    for (const r of tenta('SELECT item_id, titulo, preco, status FROM meli_item WHERE cliente = ?', cliente)) {
      const a = m.get(r.item_id) || m.set(r.item_id, { item_id: r.item_id, sku: '', user_product_id: '', skus: [], grupos: [] }).get(r.item_id)
      a.titulo ||= r.titulo || ''; if (r.preco > 0) a.preco = r.preco; a.status = r.status || ''
    }
    return m
  }

  // lote para o aplicarLote + vínculos manuais das linhas com MLB. Conflitos (mesmo SKU/MLB com 2 custos, SKU da linha ≠ SKU do anúncio) não entram.
  function montar(cliente, linhas) {
    const an = anunciosDe(cliente), conflitos = [], lote = [], vinculos = [], porLinha = new Map()
    const precoDe = a => a && (a.preco_original > 0 ? a.preco_original : a.preco > 0 ? a.preco : null)
    const dup = (campo, chave) => { const g = new Map(); for (const l of linhas) { const k = chave(l); if (k) (g.get(k) || g.set(k, []).get(k)).push(l) } return [...g.values()].filter(x => new Set(x.map(l => l.custo)).size > 1).flat().map(l => ({ l, campo })) }
    const ruins = new Map([...dup('sku', l => chaveSku(l.sku)), ...dup('mlb', l => l.mlb)].map(x => [x.l.linha, x.campo]))
    for (const l of linhas) {
      if (ruins.has(l.linha)) { conflitos.push({ linha: l.linha, sku: l.sku, mlb: l.mlb, tipo: ruins.get(l.linha) === 'sku' ? 'sku_duplicado' : 'mlb_duplicado', motivo: `o mesmo ${ruins.get(l.linha) === 'sku' ? 'SKU' : 'anúncio'} aparece com custos diferentes: nenhuma das linhas vale` }); continue }
      const campo = l.kit ? `upload.kit:${l.kit}` : 'upload.coluna_custo'
      if (l.mlb) {
        const a = an.get(l.mlb)
        if (!a) { conflitos.push({ linha: l.linha, sku: l.sku, mlb: l.mlb, tipo: 'mlb_fora', motivo: 'o anúncio da linha não é deste cliente (ou não está na coleta): nada foi casado' }); continue }
        const doAnuncio = a.skus.map(chaveSku)
        if (l.sku && doAnuncio.length && !doAnuncio.includes(chaveSku(l.sku))) { conflitos.push({ linha: l.linha, sku: l.sku, mlb: l.mlb, tipo: 'sku_mlb', motivo: 'o SKU da linha não é o SKU do anúncio no Mercado Livre: nada foi casado (corrija a planilha)' }); continue }
        const unico = a.sku || (new Set(doAnuncio).size === 1 ? a.skus[0] : '')
        // sem SKU na linha: o do anúncio; anúncio sem SKU único: a chave do custo é o próprio MLB. SKU que o anúncio não tem (ou o MLB) = vínculo MANUAL (o MLB manda)
        const sku = l.sku || unico || l.mlb
        if (!doAnuncio.includes(chaveSku(sku))) vinculos.push({ item_id: l.mlb, sku })
        lote.push({ sku, custo: l.custo, linha: l.linha, campo, preco_ref: precoDe(a) ?? undefined, ...(a.sku && chaveSku(sku) === chaveSku(a.sku) ? { mlb: l.mlb } : {}) })
        porLinha.set(l.linha, { chave: chaveSku(sku), mlb: l.mlb })
      } else if (l.sku) {
        const k = chaveSku(l.sku), alvo = [...an.values()].find(a => a.skus.some(s => chaveSku(s) === k) || a.skus.some(s => skuForte(s) === skuForte(l.sku)))
        lote.push({ sku: l.sku, custo: l.custo, linha: l.linha, campo, preco_ref: precoDe(alvo) ?? undefined })
        porLinha.set(l.linha, { chave: k })
      }                                                                        // só título: não grava (sem chave); vira sugestão
    }
    return { an, lote, vinculos, conflitos, porLinha }
  }

  // roda a gravação de verdade; gravar=false desfaz tudo no fim (prévia = o que o Confirmar faria)
  const DESFAZ = Symbol('previa')
  function rodar(cliente, m, { gravar, por, lote_id }) {
    let out
    const corpo = () => {
      const R = aplicarLote({ cliente, fonte: 'upload', modo: 'parcial', lote_id, linhas: m.lote, origem: 'upload', por: por || 'prévia' })
      const ef = vinculosCusto.custosDosAnuncios(cliente, [...m.an.keys()].map(item_id => ({ item_id })))
      const vinc = []
      for (const v of m.vinculos) {
        try { vinculosCusto.vincular({ cliente, item_id: v.item_id, sku_custo: v.sku, por: por || 'prévia' }); vinc.push(v.item_id) }
        catch { /* custo em quarentena/rejeitado: sem custo vigente, o vínculo não nasce (aprovar a quarentena e subir de novo) */ }
      }
      out = { R, depois: vinc.length ? vinculosCusto.custosDosAnuncios(cliente, [...m.an.keys()].map(item_id => ({ item_id }))) : ef, vinc }
      if (!gravar) throw DESFAZ
    }
    try { h.transaction(corpo)() } catch (e) { if (e !== DESFAZ) throw e }
    return out
  }

  function analisar(cliente, arq, { gravar = false, por = '' } = {}) {
    const linhasBrutas = arq.tipo === 'xlsx' ? lerXlsx(arq.buf) : lerCsv(arq.buf)
    const det = detectarColunas(linhasBrutas), norm = normalizarLinhas(linhasBrutas, det)
    const m = montar(cliente, norm.linhas)
    const ids = [...m.an.keys()], antes = vinculosCusto.custosDosAnuncios(cliente, ids.map(item_id => ({ item_id })))
    const { R, depois, vinc } = rodar(cliente, m, { gravar, por, lote_id: `upload-${arq.sha.slice(0, 12)}` })
    const chavesUp = new Set([...m.porLinha.values()].map(x => x.chave)), cur = (() => { try { return curvas(cliente) || new Map() } catch { return new Map() } })()
    const tar = (() => { try { return tarifas(cliente) || new Map() } catch { return new Map() } })()
    const quarentena = R.quarentena_lista.map(q => ({ linha: q.linha, sku: q.sku, motivo: q.motivo, codigo: q.codigo }))
    const rejeitadas = R.rejeitadas_lista
    // linha → critério: MLB explícito; senão a melhor origem dos anúncios que ficaram com a chave dela; SKU só de variação = 'variacao'; nada = sem par
    const ORD = ['sku', 'sku_normalizado', 'grupo'], porChave = new Map()
    for (const [id, r] of depois) if (chavesUp.has(r.chave)) (porChave.get(r.chave) || porChave.set(r.chave, []).get(r.chave)).push({ id, ...r })
    const criterios = { mlb: 0, sku: 0, sku_normalizado: 0, grupo: 0, manual: 0, variacao: 0, sem_par: 0 }, semPar = [], linhaDaChave = new Map()
    const semCustoDepois = [...m.an.values()].filter(a => !depois.has(a.item_id) && !['closed', 'inactive'].includes(a.status))
    const busca = indiceVinculo(semCustoDepois, { tamanhos: true })
    const presa = new Set([...quarentena, ...rejeitadas].map(x => x.linha))
    for (const l of norm.linhas) {
      const x = m.porLinha.get(l.linha)
      if (!x && m.conflitos.some(c => c.linha === l.linha)) continue
      if (x && presa.has(l.linha)) continue
      if (x) linhaDaChave.set(x.chave, l)
      const hits = x ? porChave.get(x.chave) || [] : []
      // 'manual' = a chave só vale por um vínculo manual feito antes (Promoções › Custos)
      let c = x?.mlb && hits.some(hh => hh.id === x.mlb) ? 'mlb' : ORD.find(o => hits.some(hh => hh.origem === o)) || (hits.length ? 'manual' : null)
      // SKU de variação: o anúncio ficou com custo (variações de mesmo custo) = 'sku'; custos diferentes entre as variações = 'variacao' (vale na venda da variação)
      if (!c && x) { const dono = [...m.an.values()].find(a => a.skus.some(s => chaveSku(s) === x.chave)); if (dono) c = depois.has(dono.item_id) ? 'sku' : 'variacao' }
      criterios[c || 'sem_par']++
      if (!c) semPar.push({ linha: l.linha, sku: l.sku, titulo: l.titulo, custo: l.custo,
        sugestoes: busca(l.titulo || l.sku).slice(0, 3).map(s => ({ item_id: s.item_id, titulo: m.an.get(s.item_id)?.titulo || '', semelhanca: Math.round(100 * s.score) })) })
    }
    const anuncios = []
    for (const [id, r] of depois) {
      if (!chavesUp.has(r.chave)) continue
      const a = m.an.get(id), preco = a?.preco > 0 ? a.preco : null, t = tar.get(id) ?? null, l = linhaDaChave.get(r.chave)
      const kits = l?.kit ? tenta("SELECT COUNT(*) n FROM kit_componente WHERE cliente = ? AND kit = ?", cliente, `item:${id}`)[0]?.n || 0 : 0
      anuncios.push({ item_id: id, titulo: a?.titulo || '', preco, custo: r.custo, custo_antes: antes.get(id)?.custo ?? null, origem: m.vinculos.some(v => v.item_id === id) || l?.mlb === id ? 'mlb' : r.origem,
        tarifa: t, margem: preco != null && t != null ? r2(preco - r.custo - t) : null, margem_pct: preco != null && t != null ? r2(100 * (preco - r.custo - t) / preco) : null,
        curva: cur.get(id) || null, linha: l?.linha ?? null, kit: l?.kit ? { quantidade: l.kit, componentes_registrados: kits } : null, fornecedor: l?.fornecedor || '', prazo_dias: l?.prazo_dias ?? null })
    }
    anuncios.sort((x, y) => ('AB'.includes(x.curva || 'C') ? 0 : 1) - ('AB'.includes(y.curva || 'C') ? 0 : 1) || (x.curva || 'Z').localeCompare(y.curva || 'Z') || x.item_id.localeCompare(y.item_id))
    const ab = ids.filter(id => ['A', 'B'].includes(cur.get(id)))
    const porOrigem = anuncios.reduce((o, a) => (o[a.origem] = (o[a.origem] || 0) + 1, o), {})
    const cfg = getCfgCustos(cliente), avisos = []
    if (!cfg.ordem_fontes.includes('upload')) avisos.push('a ordem de fontes de custo deste cliente não inclui «upload»: o custo é gravado mas não vale até incluir (Integrações › Custos)')
    if (!cur.size) avisos.push('curva ABC indisponível agora (diagnóstico sem dados): o efeito na curva A/B aparece como —')
    if (norm.linhas.some(l => l.ncm)) avisos.push('NCM não é gravado aqui: regra fiscal vem só do contador do cliente (Configurar › Nota fiscal)')
    const conflitos = [...m.conflitos, ...rejeitadas.filter(r => r.codigo === 'sku_duplicado_no_lote' || r.codigo === 'conflito_sku_mlb').map(r => ({ linha: r.linha, sku: r.sku, tipo: r.codigo, motivo: r.motivo }))]
    const invalidas = [...norm.invalidas, ...rejeitadas.filter(r => !['sku_duplicado_no_lote', 'conflito_sku_mlb'].includes(r.codigo)).map(r => ({ linha: r.linha, sku: r.sku, motivo: r.motivo }))]
    return {
      colunas: det.nomes, linhas: { total: norm.linhas.length + norm.invalidas.length + norm.em_branco, validas: norm.linhas.length, em_branco: norm.em_branco, invalidas: invalidas.length },
      criterios, anuncios_por_origem: porOrigem, total_anuncios: anuncios.length, anuncios: anuncios.slice(0, MAX_LISTA),
      sem_par: semPar.slice(0, MAX_LISTA), total_sem_par: semPar.length, conflitos: conflitos.slice(0, MAX_LISTA), quarentena: quarentena.slice(0, MAX_LISTA), invalidas: invalidas.slice(0, MAX_LISTA),
      efeito: cur.size ? { curva_ab: ab.length, curva_ab_com_custo_antes: ab.filter(id => antes.has(id)).length, curva_ab_com_custo_depois: ab.filter(id => depois.has(id)).length,
        curva_ab_passam_a_ter_margem: ab.filter(id => !antes.has(id) && depois.has(id)).length } : null,
      lote: { recebidas: R.recebidas, novas: R.novas, alteradas: R.alteradas, inalteradas: R.inalteradas, em_quarentena: R.em_quarentena, rejeitadas: R.rejeitadas, recusado_antes: R.recusado_antes },
      vinculos_mlb: vinc.length, prazos: anuncios.filter(a => a.prazo_dias).length, avisos, _anuncios: anuncios,
    }
  }

  const exigirCliente = c => { if (typeof c !== 'string' || !c.trim() || /^\s*\[Comercial\]/i.test(c)) throw erro('cliente inválido: só cliente da central'); return c }
  const pasta = cliente => join(dir, hc(cliente))
  function previa({ cliente, nome = '', buffer }) {
    exigirCliente(cliente)
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw erro('envie o arquivo da planilha (campo «arquivo»)')
    if (buffer.length > LIMITE_BYTES) throw erro('arquivo acima de 5 MB: divida a planilha ou tire colunas que não são de custo', 413)
    const tipo = tipoArquivo(buffer, nome)
    if (!tipo) throw erro('tipo de arquivo não aceito: envie .csv ou .xlsx (o .xls antigo: abra no Excel e salve como .xlsx)', 415)
    const s = sha(buffer), id = `${hc(cliente)}-${s}`
    const r = analisar(cliente, { buf: buffer, tipo, sha: s })                 // lança 400 (colunas) antes de guardar arquivo inútil
    mkdirSync(pasta(cliente), { recursive: true })
    const base = join(pasta(cliente), s)
    if (!existsSync(`${base}.${tipo}`)) writeFileSync(`${base}.${tipo}`, buffer)
    writeFileSync(`${base}.json`, JSON.stringify({ cliente, nome: String(nome).replace(/[^\w.\- ()À-ú]/g, '_').slice(0, 120), tipo, bytes: buffer.length, sha256: s, em: agora() }))
    const { _anuncios, ...vis } = r
    return { previa: true, upload_id: id, arquivo: { nome: String(nome).slice(0, 120), tipo, bytes: buffer.length, sha256: s }, ...vis, gravavel: r.lote.recebidas > 0 }
  }

  function confirmar({ cliente = '', upload_id, por, confirmar: ok } = {}) {
    const mm = typeof upload_id === 'string' ? upload_id.match(/^([0-9a-f]{16})-([0-9a-f]{64})$/) : null
    if (!mm) throw erro('upload_id inválido: faça a prévia de novo')
    const meta = (() => { try { return JSON.parse(readFileSync(join(dir, mm[1], `${mm[2]}.json`), 'utf8')) } catch { return null } })()
    if (!meta || hc(meta.cliente) !== mm[1] || (cliente && cliente !== meta.cliente)) throw erro('upload não encontrado para este cliente: faça a prévia de novo', 404)
    const buf = (() => { try { return readFileSync(join(dir, mm[1], `${mm[2]}.${meta.tipo}`)) } catch { return null } })()
    if (!buf || sha(buf) !== mm[2]) throw erro('arquivo da prévia não encontrado ou alterado: faça a prévia de novo', 404)
    const arq = { buf, tipo: meta.tipo, sha: mm[2] }
    if (ok !== true) { const { _anuncios, ...vis } = analisar(meta.cliente, arq); return { previa: true, upload_id, ...vis } }
    const quem = typeof por === 'string' ? por.trim() : ''
    if (!quem) throw erro('informe "por" (quem confirma — líder, consultor ou o CS do cliente)')
    const valido = validarPor(quem, meta.cliente)
    if (!valido) throw erro('somente líder, consultor ou o CS deste cliente confirmam a planilha de custos', 403)
    const nomePor = String(valido === true ? quem : valido).slice(0, 80)
    const r = analisar(meta.cliente, arq, { gravar: true, por: nomePor })
    // prazo de reposição informado na planilha → lead-time por anúncio (fonte cliente), pela porta do lead-time
    let prazos = 0
    if (leadTime) for (const a of r._anuncios) if (a.prazo_dias) { try { if (leadTime.salvar({ cliente: meta.cliente, chave: a.item_id, dias: a.prazo_dias, fonte: 'cliente', por: nomePor, confirmar: true })?.mudou) prazos++ } catch { /* chave fora da coleta: fica sem prazo */ } }
    const resumo = `Planilha de custos aplicada (${meta.tipo.toUpperCase()}, por ${nomePor}): ${r.total_anuncios} anúncio(s) com custo, ${r.lote.novas + r.lote.alteradas} SKU(s) novos/alterados, ${r.lote.em_quarentena} em quarentena, ${r.linhas.invalidas} linha(s) inválida(s), ${r.total_sem_par} sem par`
    let registro = null
    try { registro = livro?.registrar({ cliente: meta.cliente, tipo: 'nota', ref: `custos_upload:${hc(meta.cliente)}:${mm[2]}`, fato_em: agora(), resumo,
      dados: { origem: 'custos_upload', arquivo_sha256: mm[2], bytes: meta.bytes, tipo: meta.tipo, criterios: r.criterios, lote: r.lote, anuncios: r.total_anuncios, vinculos_mlb: r.vinculos_mlb, por: nomePor }, prova: `sha256:${mm[2]}` }) || null } catch { registro = null }
    let diagnostico = null
    try { diagnostico = recalcular ? recalcular(meta.cliente) : null } catch { diagnostico = { recalculado: false, motivo: 'diagnóstico indisponível agora: recalcula na próxima leitura' } }
    const { _anuncios, ...vis } = r
    return { previa: false, upload_id, ...vis, prazos_gravados: prazos, livro: registro ? { seq: registro.seq, novo: registro.novo } : null, diagnostico }
  }

  return { previa, confirmar }
}
