// Provedor de imagens do módulo Ofertas: sem rede, sem banco. Sem FAL_KEY → 'pendente' (nunca sucesso);
// verificarTecnico com PNG/JPEG sintéticos; candidatas salvas sem sobrescrever; Drive pendente com o que falta.
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { criarProvedorImagens, verificarTecnico, lerDimensoes, slug, REGRAS_CANAL } from '../src/lib/ofertas-imagens.js'

let n = 0
const caso = async (nome, fn) => { try { await fn(); n++ } catch (e) { console.error('FALHOU:', nome); throw e } }

// PNG sintético VÁLIDO (assinatura + IHDR + IDAT + IEND com CRC): cinza 8 bits
const CRC = (() => { const t = new Int32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c } return b => { let c = -1; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 } })()
const chunk = (tipo, dados) => { const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const td = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td)); return Buffer.concat([len, td, crc]) }
function png(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((w + 1) * h, 0x80); for (let y = 0; y < h; y++) raw[y * (w + 1)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// JPEG sintético mínimo: SOI + SOF0 com dimensões (só o cabeçalho, suficiente para a leitura de dimensões)
const jpeg = (w, h) => Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(9), Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03]), Buffer.alloc(9), Buffer.from([0xFF, 0xD9])])

const raiz = mkdtempSync(join(tmpdir(), 'ofertas-img-'))
const fetchProibido = async () => { throw new Error('o teste não pode chamar rede') }

await caso('sem FAL_KEY → disponivel() pendente e gerar() pendente, nunca sucesso, com tentativa registrada', async () => {
  const p = criarProvedorImagens({ env: {}, fetch: fetchProibido, raiz })
  assert.deepEqual(p.disponivel().provedor, 'nenhum'); assert.equal(p.disponivel().pendente, 'FAL_KEY ausente: configurar no .env')
  const r = await p.gerar({ cliente: 'Cliente A', variante: 'SKU-1', job: 'job1', referencias: ['https://x/y.jpg'], briefing: 'capa', n: 4 })
  assert.equal(r.estado, 'pendente'); assert.deepEqual(r.candidatas, []); assert.match(r.motivo, /FAL_KEY/)
  assert.equal(p.tentativas.length, 1); assert.equal(p.tentativas[0].provedor, 'nenhum'); assert.equal(p.tentativas[0].custo, null)
  assert.equal(readdirSync(raiz).length, 0, 'nada gravado')
})
await caso('com chave: chamada fal.run com referência, salva candidatas, verifica, custo só com FAL_CUSTO_IMAGEM', async () => {
  const chamadas = []
  const fetch = async (url, init = {}) => {
    chamadas.push({ url, init })
    if (url.startsWith('https://fal.run/')) { assert.equal(init.headers.Authorization, 'Key segredo'); const b = JSON.parse(init.body); assert.deepEqual(b.image_urls, ['https://cdn.exemplo/base.jpg']); assert.equal(b.aspect_ratio, '1:1'); return { ok: true, status: 200, text: async () => JSON.stringify({ images: [{ url: 'https://fal.media/a.png', width: 1200, height: 1200 }, { url: 'https://fal.media/b.png' }], description: 'ok' }) } }
    if (url === 'https://fal.media/a.png') return { ok: true, status: 200, arrayBuffer: async () => png(1200, 1200) }
    if (url === 'https://fal.media/b.png') return { ok: true, status: 200, arrayBuffer: async () => png(1200, 871) }
    throw new Error('url inesperada ' + url)
  }
  const p = criarProvedorImagens({ env: { FAL_KEY: 'segredo', FAL_CUSTO_IMAGEM: '0.2' }, fetch, raiz })
  assert.equal(p.disponivel().provedor, 'fal'); assert.equal(p.disponivel().modelo, 'fal-ai/nano-banana/edit')
  const r = await p.gerar({ cliente: 'Cliente Á', variante: 'SKU 1', job: 'job-1', referencias: ['https://drive.google.com/file/d/x/view', 'https://cdn.exemplo/base.jpg'], briefing: 'capa limpa', n: 2, papel: 'capa' })
  assert.equal(r.estado, 'ok'); assert.equal(r.candidatas.length, 2); assert.equal(r.custo, 0.4)
  assert.ok(r.candidatas[0].caminho_local.startsWith(join(raiz, 'cliente-a', 'sku-1', 'job-1'))); assert.ok(existsSync(r.candidatas[0].caminho_local))
  assert.equal(r.candidatas[0].tecnico.ok, true); assert.equal(r.candidatas[0].tecnico.quadrado, true); assert.ok(r.candidatas[0].tecnico.a_confirmar.some(x => /texto/.test(x)))
  assert.equal(r.candidatas[1].tecnico.ok, false); assert.match(r.candidatas[1].tecnico.problemas[0], /não quadrada/)
  assert.equal(r.candidatas[0].fonte, 'fal:fal-ai/nano-banana/edit'); assert.equal(r.candidatas[0].prompt, 'capa limpa')
  // mesma rodada de novo: nunca sobrescreve (sufixo)
  const r2 = await p.gerar({ cliente: 'Cliente Á', variante: 'SKU 1', job: 'job-1', referencias: ['https://cdn.exemplo/base.jpg'], briefing: 'capa limpa', n: 2, papel: 'capa' })
  assert.notEqual(r2.candidatas[0].caminho_local, r.candidatas[0].caminho_local); assert.ok(existsSync(r.candidatas[0].caminho_local))
  assert.equal(p.tentativas.length, 2); assert.equal(p.tentativas[0].n_recebidas, 2)
})
await caso('limite do provedor (429) e chave inválida (401) → classes e pendências certas, nada salvo', async () => {
  for (const [status, classe] of [[429, 'limite_uso'], [401, 'credencial_invalida'], [402, 'saldo_insuficiente'], [500, 'transitorio']]) {
    const p = criarProvedorImagens({ env: { FAL_KEY: 'k' }, fetch: async () => ({ ok: false, status, text: async () => JSON.stringify({ detail: 'x' }) }), raiz })
    const r = await p.gerar({ cliente: 'c', variante: 'v', job: `j${status}`, referencias: ['https://a/b.jpg'], briefing: 'b' })
    assert.equal(r.estado, 'falha'); assert.equal(r.classe, classe); assert.equal(p.tentativas[0].estado, 'falha'); assert.equal(r.candidatas.length, 0)
    if (status === 429) assert.match(r.pendencia, /preservado/)
  }
  const p = criarProvedorImagens({ env: { FAL_KEY: 'k' }, fetch: async () => { throw new Error('ECONNRESET') }, raiz })
  assert.equal((await p.gerar({ cliente: 'c', variante: 'v', job: 'j', referencias: ['https://a/b.jpg'], briefing: 'b' })).classe, 'transitorio')
  assert.equal((await p.gerar({ cliente: 'c', variante: 'v', job: 'j', referencias: ['https://drive.google.com/file/d/1/view'], briefing: 'b' })).estado, 'erro')
})
await caso('verificarTecnico: PNG/JPEG sintéticos, regras do canal, hash estável', () => {
  const ok = verificarTecnico(png(1200, 1200), { papel: 'capa' })
  assert.equal(ok.ok, true); assert.equal(ok.formato, 'png'); assert.equal(ok.largura, 1200); assert.equal(ok.quadrado, true); assert.equal(ok.hash.length, 64)
  assert.equal(ok.hash, verificarTecnico(png(1200, 1200)).hash)
  const pequena = verificarTecnico(png(400, 400))
  assert.equal(pequena.ok, false); assert.match(pequena.problemas[0], /abaixo do mínimo 500/)
  const j = verificarTecnico(jpeg(1600, 900), { papel: 'capa' })
  assert.equal(j.formato, 'jpeg'); assert.equal(j.largura, 1600); assert.equal(j.altura, 900); assert.equal(j.ok, false)
  assert.equal(verificarTecnico(jpeg(1600, 900), { papel: 'beneficio' }).ok, true)        // só a capa exige quadrado
  assert.equal(verificarTecnico(Buffer.from('nada')).ok, false)
  assert.equal(lerDimensoes(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(4), Buffer.alloc(6), Buffer.from([0xB0, 0x04, 0x67, 0x03])])).largura, 1200)
  assert.equal(verificarTecnico(png(600, 600), { regras: { ...REGRAS_CANAL.ML, formatos: ['jpeg'] } }).problemas[0].includes('formato png'), true)
})
await caso('Drive pendente com lista do que falta; slug sem acento', async () => {
  const p = criarProvedorImagens({ env: {}, fetch: fetchProibido, raiz })
  assert.equal(p.drive.estado, 'pendente'); assert.ok(p.drive.faltando.length >= 2)
  for (const f of ['listarPasta', 'baixar', 'subir']) assert.equal((await p.drive[f]()).estado, 'pendente')
  assert.equal(slug('Relógio Ação/ 01Smart'), 'relogio-acao-01smart')
})

rmSync(raiz, { recursive: true, force: true })
console.log(`teste-ofertas-imagens: ${n} casos OK`)
