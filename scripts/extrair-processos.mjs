// Extrai do Manual do Analista (docx → texto) o catálogo de PROCESSOS: por processo e canal, o caminho, os passos e as atenções.
// Uso: node scripts/extrair-processos.mjs "/caminho/Manual_do_Analista_Place2u.docx" [saida.json]
// (textutil é do macOS; o resultado vai para config/processos-base.json e é revisto/curado em config/processos.json — este script NÃO sobrescreve a curadoria.)
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const docx = process.argv[2], saida = process.argv[3] || join(ROOT, 'config', 'processos-base.json')
if (!docx) { console.error('Informe o caminho do .docx do Manual do Analista'); process.exit(1) }
const tmp = join(mkdtempSync(join(tmpdir(), 'manual-')), 'manual.txt')
execFileSync('textutil', ['-convert', 'txt', '-output', tmp, docx])
const linhas = readFileSync(tmp, 'utf-8').split(/\r?\n/).map(l => l.replace(/\u00a0/g, ' ').trimEnd())

const CANAIS = [[/mercado livre|^ml$/i, 'ML'], [/shopee/i, 'SHO'], [/amazon/i, 'AMZ'], [/tiktok/i, 'TTK']]
const canalDe = t => CANAIS.find(([rx]) => rx.test(t))?.[1] || null
const canalPeloCaminho = c => /seller central|manage your inventory|menu lateral|seller\s*central/i.test(c) ? 'AMZ' : /central de vendedores|mercado livre|anunciar semelhante/i.test(c) ? 'ML' : /central do vendedor|shopee/i.test(c) ? 'SHO' : null
const RX_CAP = /^(\d+)\. (\S.*)$/, RX_PROC = /^(\d+\.\d+) (\S.*)$/, RX_PASSO = /^(\d+)\.(?:\t| {2,3})(\S.*)$/
const RX_BLOCO = /^(.+?) [–—-] (.+)$/

const caps = new Map(), procs = []
let cap = null, proc = null, bloco = null, passo = null, modo = 'texto'
const fechaPasso = () => { passo = null }
for (let k = 0; k < linhas.length; k++) {
  const l = linhas[k].trim()
  if (!l) continue
  let m
  if ((m = RX_PROC.exec(l)) && !RX_PASSO.test(l)) {                         // 6.1 Cadastro de Produtos
    if (m[1].split('.')[0] === '0' ) continue
    proc = { id: m[1], capitulo: cap, nome: m[2].replace(/\s+/g, ' '), descricao: '', blocos: [], atencoes: [], texto: [] }
    procs.push(proc); bloco = null; fechaPasso(); modo = 'descricao'; continue
  }
  if ((m = RX_CAP.exec(l)) && !RX_PASSO.test(linhas[k]) && !/[.:]$/.test(m[2]) && m[2].length < 70 && !RX_PROC.test(l)) {      // 6. Gestão de catálogo
    cap = { n: m[1], nome: m[2] }; caps.set(m[1], cap); proc = null; bloco = null; fechaPasso(); continue
  }
  if (!proc) continue
  if (/^Caminho:/i.test(l)) {
    // "Caminho:" sem título de bloco próprio (ex.: sub-rotina com um parágrafo de contexto antes): abre um bloco novo, herdando o canal do anterior
    if (!bloco || bloco.passos.length || bloco.caminho) {
      const prev = (linhas[k - 1] || '').trim()
      if (passo && prev && passo.texto.endsWith(prev)) passo.texto = passo.texto.slice(0, passo.texto.length - prev.length).trim()    // o parágrafo de contexto não é parte do último passo
      const titulo = (prev.length > 90 ? (prev.match(/^.{20,140}?[.:](?=\s|$)/)?.[0] || prev.slice(0, 90)) : prev) || 'Sub-rotina'
      bloco = { titulo, canal: null, plataforma: '', caminho: '', passos: [], atencoes: [] }   // sem título próprio: o canal sai do caminho (ou fica sem canal — nunca herdado do bloco anterior)
      proc.blocos.push(bloco); fechaPasso()
    }
    bloco.caminho = l.replace(/^Caminho:\s*/i, ''); bloco.canal ||= canalPeloCaminho(bloco.caminho); modo = 'passos'; continue
  }
  if ((m = RX_BLOCO.exec(l)) && (/^Caminho:/i.test((linhas[k + 1] || '').trim()) || /^1\.(?:\t| {2,3})\S/.test(linhas[k + 1] || ''))) {   // título de bloco: seguido de "Caminho:" ou direto do passo 1      // "Cadastro de Produtos – Shopee"
    bloco = { titulo: l, canal: canalDe(m[2]) || canalDe(l), plataforma: m[2].trim(), caminho: '', passos: [], atencoes: [] }
    proc.blocos.push(bloco); fechaPasso(); modo = 'passos'; continue
  }
  if (/^Atenção:/i.test(l)) { (bloco && modo === 'passos' ? bloco : proc).atencoes ? (bloco && modo === 'passos' ? bloco : proc).atencoes.push(l.replace(/^Atenção:\s*/i, '')) : null; if (bloco && modo === 'passos' && !bloco.atencoes) { /* já empurrado acima */ } continue }
  if (bloco && modo === 'passos' && (m = RX_PASSO.exec(linhas[k]))) { passo = { n: Number(m[1]), titulo: m[2].trim(), texto: '' }; bloco.passos.push(passo); continue }
  if (bloco && modo === 'passos' && passo) { passo.texto = (passo.texto ? passo.texto + ' ' : '') + l; continue }
  if (modo === 'descricao' && !proc.descricao) { proc.descricao = l; continue }
  proc.texto.push(l)
}
// atenção de bloco: normaliza (bloco.atencoes pode não existir)
for (const p of procs) for (const b of p.blocos) b.atencoes ||= []
const out = {
  fonte: 'Manual do Analista Place2u', extraido_em: new Date().toISOString().slice(0, 10),
  capitulos: [...caps.values()], processos: procs.map(p => ({ ...p, texto: p.texto.join('\n').slice(0, 6000) })),
}
writeFileSync(saida, JSON.stringify(out, null, 1) + '\n')
const comPassos = out.processos.filter(p => p.blocos.some(b => b.passos.length))
console.log(`${out.processos.length} processos (${comPassos.length} com passo a passo), ${out.capitulos.length} capítulos → ${saida}`)
for (const p of out.processos) console.log(p.id.padEnd(6), p.nome.padEnd(42).slice(0, 42), p.blocos.map(b => `${b.canal || '?'}:${b.passos.length}`).join(' ') || (p.texto ? `[texto ${p.texto.length}c]` : '—'))
