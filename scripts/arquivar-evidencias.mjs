#!/usr/bin/env node
// Arquivamento dos anexos para o armazenamento FRIO (docs/plano-autogestao.md A4; D-A1: pasta do Google Drive da Place2u, .env FRIO_DIR).
// PRÉVIA POR PADRÃO (só leitura: o banco abre readonly, nada é copiado nem removido). --confirmar faz de verdade.
//
// Regra (nada é apagado sem conferência):
//   1. só anexo de card (evidencias) com MAIS de --dias (30) E com sha256 no livro de registro (registro_cliente.tipo = 'anexo_tarefa', prova
//      'arquivo:<o mesmo caminho>#sha256:<hex>'); sem hash no livro = fica no Mac;
//   2. relê o arquivo local e confere com o hash do livro (divergente = fica no Mac, listado);
//   3. copia para FRIO_DIR/<sha256><.ext> (via .parcial + rename), RELÊ NO DESTINO e confere o sha256 (destino já existente com o mesmo hash é reaproveitado);
//   4. só então grava evidencias.arquivo_local = 'frio:<sha256><.ext>' (compare-and-set: só se o caminho ainda é o local) e por último remove o arquivo do Mac.
//   Idempotente: o que já é 'frio:' não entra; rodar de novo continua de onde parou.
// Disco: para antes de copiar se o disco livre cair abaixo de --min-livre-gb (1,5) e por passada move no máximo --max-gb (2) — o Drive para
//   computador guarda o arquivo no cache local até subir; espere a sincronização entre passadas (docs/autogestao-instalar.md).
// STREAMING (Drive para computador em «Fazer streaming»; ligado sozinho quando FRIO_DIR está em ~/Library/CloudStorage/, ou --streaming):
//   o FRIO_DIR fica no MESMO volume do Mac (File Provider) e a cópia ocupa o cache local até o Drive subir. Por passada, 1 lote de no máximo
//   --max-gb (0,4): copia e confere o sha256 no destino → espera o Drive subir cada arquivo (scripts/bin/frio-evict status; a cada --intervalo-s 30,
//   teto --espera-min 120) → despeja (evict) e confere alocado ≈ 0 → SÓ ENTÃO grava 'frio:' e remove o original. O que não subir no teto fica
//   (cópia no Drive, original no Mac, banco igual) e volta na próxima passada. Disco livre nunca abaixo de 1 GB. Log: data/arquivar.log (≤ 1 MB).
//   Saída (só streaming + --confirmar): 0 = moveu algo, 10 = nada movível (acabou), 11 = sem progresso (Drive lento/disco/falhas).
//   Ajudante: FRIO_EVICT_BIN (testes) ou scripts/bin/frio-evict (swiftc -O scripts/frio-evict.swift -o scripts/bin/frio-evict); sem binário, usa `swift` interpretado.
// Uso: node scripts/arquivar-evidencias.mjs [--confirmar] [--dias 30] [--max-gb 2] [--min-livre-gb 1.5] [--conferir]  (--conferir: a prévia também confere os hashes; lento)
//      Testes: --db <arquivo> --dados <pasta data/>.
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync, statfsSync, copyFileSync, renameSync, unlinkSync, accessSync, constants, readdirSync, rmSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep, extname } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { setTimeout as dormir } from 'node:timers/promises'
import { ROOT } from '../src/lib/env.js'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }
const CONFIRMAR = args.includes('--confirmar'), CONFERIR = args.includes('--conferir') || CONFIRMAR
const DADOS = resolve(opt('dados', join(ROOT, 'data'))), DB = resolve(opt('db', join(DADOS, 'db.sqlite')))
const FRIO = String(process.env.FRIO_DIR || '').trim()
const STREAMING = args.includes('--streaming') || (!!FRIO && resolve(FRIO).startsWith(join(homedir(), 'Library', 'CloudStorage') + sep))
const DIAS = Number(opt('dias', 30)), MAX_B = Number(opt('max-gb', STREAMING ? 0.4 : 2)) * 1e9
const MIN_LIVRE = STREAMING ? Math.max(1, Number(opt('min-livre-gb', 1.5))) : Number(opt('min-livre-gb', 1.5))   // streaming: nunca abaixo de 1 GB
const ESPERA_MS = Number(opt('espera-min', 120)) * 60_000, INTERVALO_MS = Number(opt('intervalo-s', 30)) * 1000, EVICT_ESPERA_MS = Number(opt('evict-espera-s', 60)) * 1000
const ALOCADO_OK = 64 * 1024                                                                  // «≈ 0» depois do evict (só metadados)
const LOG = join(DADOS, 'arquivar.log')
const GB = b => (b / 1e9).toFixed(2).replace('.', ',') + ' GB'
const livreGb = () => { try { const f = statfsSync(DADOS); return f.bavail * f.bsize / 1e9 } catch { return 0 } }
const sha = abs => new Promise((ok, erro) => { const h = createHash('sha256'); createReadStream(abs).on('data', d => h.update(d)).on('error', erro).on('end', () => ok(h.digest('hex'))) })
const RX_PROVA = /^arquivo:(.+)#sha256:([0-9a-f]{64})$/

if (!(DIAS >= 1) || !(MAX_B > 0) || !(MIN_LIVRE >= 0) || !(ESPERA_MS >= 0) || !(INTERVALO_MS > 0)) { console.error('parâmetros inválidos'); process.exit(2) }

// destino frio: existe? é pasta? dá para escrever? no mesmo disco do Mac (não libera nada)?
function estadoFrio() {
  if (!FRIO) return { ok: false, motivo: 'FRIO_DIR não configurado no .env (decisão D-A1: pasta do Google Drive da Place2u, ex.: ~/Library/CloudStorage/GoogleDrive-<conta>/Meu Drive/place-sprints-frio)' }
  if (!existsSync(FRIO)) return { ok: false, motivo: `FRIO_DIR não existe neste Mac (${FRIO}) — instale o Google Drive para computador e crie a pasta` }
  if (!statSync(FRIO).isDirectory()) return { ok: false, motivo: 'FRIO_DIR não é uma pasta' }
  try { accessSync(FRIO, constants.W_OK) } catch { return { ok: false, motivo: 'FRIO_DIR sem permissão de escrita' } }
  const mesmoDisco = statSync(FRIO).dev === statSync(DADOS).dev
  return { ok: true, mesmoDisco }
}

const db = new Database(DB, { readonly: !CONFIRMAR, fileMustExist: true })
db.pragma('busy_timeout = 30000')
const corte = new Date(Date.now() - DIAS * 86_400_000).toISOString()
// a prova do livro é por evidência (ref = evidencias.id); só o caminho local ainda não arquivado
const linhas = db.prepare(`SELECT e.id, e.arquivo_local, e.criada_em, lv.prova FROM evidencias e
  LEFT JOIN registro_cliente lv ON lv.tipo = 'anexo_tarefa' AND lv.ref = e.id
  WHERE e.arquivo_local LIKE 'evidencias/%' ORDER BY e.criada_em, e.rowid`).all()

const base = DADOS, c = { total: linhas.length, recentes: 0, sem_hash: 0, ausente: 0, fora_de_data: 0, movivel: 0, bytes_movivel: 0, bytes_sem_hash: 0, bytes_recentes: 0 }
const plano = []
for (const l of linhas) {
  const abs = resolve(base, l.arquivo_local)
  if (!abs.startsWith(join(base, 'evidencias') + sep)) { c.fora_de_data++; continue }
  if (!existsSync(abs)) { c.ausente++; continue }
  const st = statSync(abs), quando = l.criada_em || st.mtime.toISOString()
  if (quando >= corte) { c.recentes++; c.bytes_recentes += st.size; continue }
  const m = RX_PROVA.exec(l.prova || '')
  if (!m || m[1] !== l.arquivo_local) { c.sem_hash++; c.bytes_sem_hash += st.size; continue }
  c.movivel++; c.bytes_movivel += st.size
  plano.push({ id: l.id, rel: l.arquivo_local, abs, hash: m[2], bytes: st.size, ext: (extname(l.arquivo_local).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [''])[0] })
}
// relatórios em data/relatorios com mais de N dias: NÃO entram (não têm sha256 no livro) — só informados
let bytesRel = 0
try { const walk = d => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else { const s = statSync(p); if (s.mtime.toISOString() < corte) bytesRel += s.size } } }; walk(join(DADOS, 'relatorios')) } catch { /* sem pasta */ }

const fr = estadoFrio()
// log: em streaming + --confirmar cada linha também vai para data/arquivar.log (com hora; > 1 MB → últimos 512 KB)
const LOGAR = STREAMING && CONFIRMAR
if (LOGAR) try { if (statSync(LOG).size > 1_048_576) writeFileSync(LOG, readFileSync(LOG).subarray(-524_288)) } catch { /* sem log ainda */ }
const _log = console.log
console.log = (...a) => { _log(...a); if (LOGAR) try { appendFileSync(LOG, `${new Date().toISOString()} ${a.join(' ')}\n`) } catch { /* log nunca derruba a passada */ } }
console.log(`Arquivamento para o frio — ${CONFIRMAR ? 'EXECUÇÃO' : 'PRÉVIA (nada é copiado nem removido; rode com --confirmar)'}${STREAMING ? ` · STREAMING (lote ${GB(MAX_B)}, espera até ${ESPERA_MS / 60_000} min)` : ''}`)
console.log(`  disco livre agora: ${GB(livreGb() * 1e9)} · corte: anexos criados antes de ${corte.slice(0, 10)} (${DIAS} dias)`)
console.log(`  anexos com arquivo no Mac: ${c.total} · recentes: ${c.recentes} (${GB(c.bytes_recentes)}) · sem sha256 no livro (ficam): ${c.sem_hash} (${GB(c.bytes_sem_hash)}) · arquivo ausente: ${c.ausente}${c.fora_de_data ? ` · caminho fora de data/evidencias: ${c.fora_de_data}` : ''}`)
console.log(`  MOVÍVEIS (> ${DIAS} dias e com sha256 no livro): ${c.movivel} anexo(s) = ${GB(c.bytes_movivel)} liberáveis`)
console.log(`  data/relatorios com > ${DIAS} dias: ${GB(bytesRel)} (não movidos: sem sha256 no livro)`)
console.log(`  destino frio: ${fr.ok ? `${FRIO}${fr.mesmoDisco && !STREAMING ? ' — ATENÇÃO: mesmo disco do Mac (modo espelho do Drive?): mover para lá NÃO libera espaço' : ''}` : `INDISPONÍVEL — ${fr.motivo}`}`)

if (!CONFIRMAR && !CONFERIR) process.exit(0)
if (CONFIRMAR && !fr.ok) { console.error('Nada foi feito: o destino frio não está disponível.'); process.exit(3) }
if (CONFIRMAR && STREAMING) { const s = await streaming(); db.close(); process.exit(s) }
if (CONFIRMAR && fr.mesmoDisco && !args.includes('--mesmo-disco')) { console.error('Nada foi feito: o destino está no mesmo disco (passe --mesmo-disco se for de propósito).'); process.exit(3) }

const casar = CONFIRMAR ? db.prepare("UPDATE evidencias SET arquivo_local = ? WHERE id = ? AND arquivo_local = ?") : null
const r = { movidos: 0, bytes: 0, reaproveitados: 0, divergentes: [], falhas: [], parou: '' }
for (const p of plano) {
  if (CONFIRMAR && r.bytes + p.bytes > MAX_B) { r.parou = `teto da passada (${GB(MAX_B)})`; break }
  if (CONFIRMAR && livreGb() - p.bytes / 1e9 < MIN_LIVRE) { r.parou = `disco livre abaixo de ${MIN_LIVRE} GB`; break }
  let local
  try { local = await sha(p.abs) } catch { r.falhas.push(`${p.id}: ilegível`); continue }
  if (local !== p.hash) { r.divergentes.push(p.id); continue }                     // o arquivo mudou depois do livro: não é a prova registrada — fica
  if (!CONFIRMAR) continue
  const nome = p.hash + p.ext, dest = join(FRIO, nome), tmp = dest + '.parcial'
  try {
    if (existsSync(dest)) { if (await sha(dest) !== p.hash) { r.falhas.push(`${p.id}: destino existente com hash diferente`); continue } r.reaproveitados++ }
    else {
      copyFileSync(p.abs, tmp)
      if (await sha(tmp) !== p.hash) { rmSync(tmp, { force: true }); r.falhas.push(`${p.id}: cópia não conferiu`); continue }
      renameSync(tmp, dest)
      if (await sha(dest) !== p.hash) { r.falhas.push(`${p.id}: destino não conferiu após renomear`); continue }   // não remove o local
    }
    const ch = casar.run(`frio:${nome}`, p.id, p.rel).changes
    if (ch !== 1) { r.falhas.push(`${p.id}: caminho mudou no banco durante a passada`); continue }          // a cópia fica no frio; o local também
    unlinkSync(p.abs)
    r.movidos++; r.bytes += p.bytes
  } catch (e) { rmSync(tmp, { force: true }); r.falhas.push(`${p.id}: ${String(e?.code || e?.name || 'erro')}`) }
}
if (CONFERIR && !CONFIRMAR) console.log(`  conferência dos hashes (prévia): ${plano.length - r.divergentes.length - r.falhas.length} batem com o livro, ${r.divergentes.length} divergente(s), ${r.falhas.length} ilegível(is)`)
if (CONFIRMAR) {
  console.log(`  movidos: ${r.movidos} (${GB(r.bytes)})${r.reaproveitados ? `, ${r.reaproveitados} já estavam no frio com o mesmo hash` : ''} · divergentes (ficaram): ${r.divergentes.length} · falhas: ${r.falhas.length}${r.parou ? ` · parou: ${r.parou}` : ''}`)
  if (r.falhas.length) console.log('  ' + r.falhas.slice(0, 20).join('\n  '))
  console.log(`  disco livre agora: ${GB(livreGb() * 1e9)} (o Drive libera o cache local depois de subir)`)
}
db.close()

// ═════════ streaming: copia o lote → espera subir → evict → confere → 'frio:' → remove o original ═════════
function ajudante(sub, arquivos) {
  const bin = process.env.FRIO_EVICT_BIN || join(ROOT, 'scripts', 'bin', 'frio-evict')
  const [cmd, pre] = existsSync(bin) ? [bin, []] : ['swift', [join(ROOT, 'scripts', 'frio-evict.swift')]]   // ponytail: sem binário, interpretado (lento)
  return JSON.parse(execFileSync(cmd, [...pre, sub, ...arquivos], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] }))
}
// «alocado ≈ 0»: até 64 KB de metadados, e nunca mais que metade do próprio arquivo (anexo pequeno não passa sem ter sido despejado)
function liberou(s, bytes) { return s?.alocado >= 0 && s.alocado <= Math.min(ALOCADO_OK, bytes / 2) }
function statusDe(arquivos) { const m = new Map(); for (let i = 0; i < arquivos.length; i += 200) for (const s of ajudante('status', arquivos.slice(i, i + 200))) m.set(s.arquivo, s); return m }

async function streaming() {
  if (!plano.length) { console.log('  movíveis: 0 — nada a arquivar'); return 10 }
  const r = { movidos: 0, bytes: 0, reaproveitados: 0, divergentes: 0, falhas: [], parou: '' }, lote = []
  const qFrio = db.prepare("SELECT 1 FROM evidencias WHERE arquivo_local = ? LIMIT 1").pluck(), jaNoFrio = nome => qFrio.get(`frio:${nome}`) === 1
  let bytesLote = 0
  // 1) copia o lote (sha256 conferido no destino)
  for (const p of plano) {
    if (bytesLote + p.bytes > MAX_B) { if (!lote.length) r.parou = `anexo maior que o lote (${GB(p.bytes)})`; break }
    if (livreGb() - p.bytes / 1e9 < MIN_LIVRE) { r.parou = `disco livre abaixo de ${MIN_LIVRE} GB`; break }
    let local
    try { local = await sha(p.abs) } catch { r.falhas.push(`${p.id}: ilegível`); continue }
    if (local !== p.hash) { r.divergentes++; continue }
    const nome = p.hash + p.ext, dest = join(FRIO, nome), tmp = dest + '.parcial'
    try {
      // destino já no Drive (anexos com o mesmo conteúdo = mesmo sha256): NUNCA regrava por cima (rename sobre item despejado trava no File Provider).
      //   já referenciado por 'frio:' no banco (conferido quando entrou) e despejado → reaproveita sem baixar; senão relê o hash (baixa se preciso).
      if (existsSync(dest)) {
        const ja = statusDe([dest]).get(dest), despejado = ja?.download && ja.download !== 'NSURLUbiquitousItemDownloadingStatusCurrent'
        // ponytail: nome = sha256 só é gravado pelo próprio script após conferir; passada anterior pode ter caído antes do 'frio:' —
        //   despejado + uploaded + mesmo tamanho basta (reler forçaria o download e o File Provider devolve -11).
        const confiavel = despejado && ja.uploaded && (jaNoFrio(nome) || ja.tamanho === p.bytes)
        if (!confiavel && await sha(dest) !== p.hash) { r.falhas.push(`${p.id}: destino existente com hash diferente`); continue }
        r.reaproveitados++
      } else {
        copyFileSync(p.abs, tmp)
        if (await sha(tmp) !== p.hash) { rmSync(tmp, { force: true }); r.falhas.push(`${p.id}: cópia não conferiu`); continue }
        renameSync(tmp, dest)
        if (await sha(dest) !== p.hash) { r.falhas.push(`${p.id}: destino não conferiu após renomear`); continue }
      }
      lote.push({ ...p, nome, dest }); bytesLote += p.bytes
    } catch (e) { rmSync(tmp, { force: true }); r.falhas.push(`${p.id}: ${String(e?.code || e?.name || 'erro')}`) }
  }
  console.log(`  lote copiado e conferido: ${lote.length} arquivo(s) = ${GB(bytesLote)}${r.reaproveitados ? ` (${r.reaproveitados} já estavam no Drive)` : ''} · disco livre: ${GB(livreGb() * 1e9)}${r.parou ? ` · parou: ${r.parou}` : ''}`)
  // 2) espera o Drive subir; cada um que subiu: evict → confere alocado ≈ 0 → 'frio:' → remove o original
  const casar = db.prepare("UPDATE evidencias SET arquivo_local = ? WHERE id = ? AND arquivo_local = ?")
  const t0 = Date.now(); let pend = lote.slice(), ultimo = 0
  while (pend.length) {
    let st
    try { st = statusDe(pend.map(p => p.dest)) } catch (e) { r.falhas.push(`ajudante status: ${String(e?.message || e).slice(0, 120)}`); break }
    for (const p of pend.slice()) {
      const s = st.get(p.dest)
      if (!s?.existe) { r.falhas.push(`${p.id}: cópia sumiu do Drive`); pend = pend.filter(x => x !== p); continue }
      if (!s.uploaded) continue
      let depois
      try { depois = ajudante('evict', [p.dest]) } catch (e) {
        let ja; try { ja = statusDe([p.dest]).get(p.dest) } catch { /* sem status */ }                                                 // mesmo sha256 já despejado por outro anexo do lote
        if (ja?.uploaded && liberou(ja, p.bytes)) depois = ja; else { r.falhas.push(`${p.id}: evict falhou (${String(e?.stderr || e?.message || '').trim().slice(0, 80)})`); pend = pend.filter(x => x !== p); continue } }
      for (const fim = Date.now() + EVICT_ESPERA_MS; !liberou(depois, p.bytes) && Date.now() < fim;) { await dormir(Math.min(2000, INTERVALO_MS)); depois = statusDe([p.dest]).get(p.dest) }
      pend = pend.filter(x => x !== p)
      if (!liberou(depois, p.bytes)) { r.falhas.push(`${p.id}: evict não liberou o disco (alocado ${depois?.alocado})`); continue }
      if (casar.run(`frio:${p.nome}`, p.id, p.rel).changes !== 1) { r.falhas.push(`${p.id}: caminho mudou no banco durante a passada`); continue }
      unlinkSync(p.abs); r.movidos++; r.bytes += p.bytes
    }
    if (!pend.length) break
    const dt = Date.now() - t0
    if (dt >= ESPERA_MS) { r.parou = `teto de espera (${ESPERA_MS / 60_000} min): ${pend.length} arquivo(s) ainda não subiram — ficam para a próxima passada`; break }
    if (Date.now() - ultimo >= 5 * 60_000 || dt < INTERVALO_MS) { ultimo = Date.now(); console.log(`  aguardando o Drive: ${lote.length - pend.length}/${lote.length} prontos, ${GB(r.bytes)} liberados em ${Math.round(dt / 60_000)} min · disco livre ${GB(livreGb() * 1e9)}`) }
    await dormir(INTERVALO_MS)
  }
  const min = (Date.now() - t0) / 60_000
  console.log(`  movidos: ${r.movidos} (${GB(r.bytes)}) em ${min.toFixed(1).replace('.', ',')} min${r.movidos && min > 0 ? ` (~${(r.bytes / 1e6 / min).toFixed(1).replace('.', ',')} MB/min)` : ''} · divergentes (ficaram): ${r.divergentes} · falhas: ${r.falhas.length}${r.parou ? ` · parou: ${r.parou}` : ''}`)
  if (r.falhas.length) console.log('  ' + r.falhas.slice(0, 20).join('\n  '))
  console.log(`  disco livre agora: ${GB(livreGb() * 1e9)} · restam movíveis: ${plano.length - r.movidos}`)
  return r.movidos ? 0 : 11
}
