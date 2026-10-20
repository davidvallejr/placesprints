#!/usr/bin/env node
// Backup do banco FORA do Mac (docs/plano-autogestao.md A7; D-A2: cifrado no Google Drive, 1 por dia, retenção 14, chave só no Mac).
// PRÉVIA POR PADRÃO (só lê tamanhos e configuração). --confirmar faz o backup.
//
// Como funciona (--confirmar):
//   1. só roda se o disco livre for ≥ 2× o banco (banco + WAL): a cópia temporária e a cifrada passam pelo disco do Mac antes de o Drive subir;
//   2. API de backup ONLINE do better-sqlite3 (consistente com o servidor gravando, WAL) para um temporário 0600 em $TMPDIR — NUNCA em data/;
//   3. quick_check no temporário; cifra com AES-256-GCM (chave de 32 bytes em ~/.place-sprints/backup.key, gerada 0600 na 1ª vez e NUNCA impressa)
//      direto para BACKUP_DIR/place-sprints-<AAAA-MM-DDTHHMM>.db.enc (via .parcial + rename);
//   4. relê o arquivo cifrado, decifra em memória de fluxo e confere o sha256 com o do temporário; só então aplica a retenção (14 mais novos) e apaga o temporário
//      (o temporário é apagado SEMPRE, com ou sem erro).
// Formato: 'PSBK1\0' (6 bytes) + iv (12) + texto cifrado + tag GCM (16).
// Restaurar/testar: node scripts/backup-banco.mjs --decifrar <arquivo.db.enc> --para <destino.sqlite>   (nunca sobre data/db.sqlite com o servidor de pé)
// Testes: --db <arquivo> --chave <arquivo>; BACKUP_DIR por env.
import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync, statfsSync, mkdirSync, writeFileSync, readFileSync, openSync, closeSync, readSync, renameSync, rmSync, readdirSync, chmodSync, accessSync, constants } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform, Writable } from 'node:stream'
import { ROOT } from '../src/lib/env.js'

const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }
const CONFIRMAR = args.includes('--confirmar'), RETER = Number(opt('reter', 14))
const DB = resolve(opt('db', join(ROOT, 'data', 'db.sqlite'))), CHAVE = resolve(opt('chave', join(homedir(), '.place-sprints', 'backup.key')))
const DESTINO = String(process.env.BACKUP_DIR || '').trim()
const MAGIC = Buffer.from('PSBK1\0'), RX_NOME = /^place-sprints-\d{4}-\d\d-\d\dT\d{4}\.db\.enc$/
const MB = b => (b / 1e6).toFixed(0) + ' MB'
const tam = p => { try { return statSync(p).size } catch { return 0 } }
const livre = p => { try { const f = statfsSync(p); return f.bavail * f.bsize } catch { return 0 } }
const shaArquivo = p => new Promise((ok, erro) => { const h = createHash('sha256'); createReadStream(p).on('data', d => h.update(d)).on('error', erro).on('end', () => ok(h.digest('hex'))) })

// chave: 32 bytes, 0600, pasta 0700; gerada só com --confirmar; nunca vai ao stdout/log
function lerChave({ criar }) {
  if (!existsSync(CHAVE)) {
    if (!criar) return null
    mkdirSync(dirname(CHAVE), { recursive: true, mode: 0o700 })
    writeFileSync(CHAVE, randomBytes(32), { mode: 0o600, flag: 'wx' })
    console.log(`  chave nova criada em ${CHAVE} (0600). Guarde uma cópia com o David (fora do Drive): sem ela o backup não abre.`)
  }
  const st = statSync(CHAVE)
  if ((st.mode & 0o077) !== 0) chmodSync(CHAVE, 0o600)
  const k = readFileSync(CHAVE)
  if (k.length !== 32) throw new Error('chave de backup com tamanho inválido (esperado 32 bytes)')
  return k
}

async function cifrar(origem, destino, chave) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', chave, iv), out = createWriteStream(destino, { mode: 0o600 })
  out.write(Buffer.concat([MAGIC, iv]))
  try { await pipeline(createReadStream(origem), c, out, { end: false }) } catch (e) { out.destroy(); throw e }
  await new Promise((ok, erro) => out.end(c.getAuthTag(), e => e ? erro(e) : ok()))
}
// decifra em fluxo: a tag está nos últimos 16 bytes; devolve o sha256 do texto claro (e grava em `para`, se pedido)
async function decifrar(arquivo, chave, para = null) {
  const total = tam(arquivo), fd = openSync(arquivo, 'r'), cab = Buffer.alloc(18), tag = Buffer.alloc(16)
  readSync(fd, cab, 0, 18, 0); readSync(fd, tag, 0, 16, total - 16); closeSync(fd)
  if (!cab.subarray(0, 6).equals(MAGIC)) throw new Error('arquivo não é um backup do Place Sprints')
  const d = createDecipheriv('aes-256-gcm', chave, cab.subarray(6, 18)); d.setAuthTag(tag)
  const h = createHash('sha256'), soma = new Transform({ transform(b, _, cb) { h.update(b); cb(null, b) } })
  const etapas = [createReadStream(arquivo, { start: 18, end: total - 17 }), d, soma]
  if (para) etapas.push(createWriteStream(para, { mode: 0o600 })); else etapas.push(new Writable({ write(_, __, cb) { cb() } }))
  await pipeline(...etapas)
  return h.digest('hex')
}

if (opt('decifrar')) {
  const para = opt('para'); if (!para) { console.error('informe --para <destino.sqlite>'); process.exit(2) }
  if (resolve(para) === resolve(join(ROOT, 'data', 'db.sqlite'))) { console.error('recusado: restaurar sobre data/db.sqlite é manual, com o servidor parado (docs/autogestao-instalar.md)'); process.exit(2) }
  const k = lerChave({ criar: false }); if (!k) { console.error('chave de backup não encontrada'); process.exit(2) }
  const s = await decifrar(resolve(opt('decifrar')), k, resolve(para))
  console.log(`decifrado em ${para} (sha256 ${s.slice(0, 12)}…)`); process.exit(0)
}

// 2× o banco (temporário + cifrado, que o Drive guarda no cache até subir) e ainda 1 GB de folga: o backup nunca leva o disco abaixo do freio do servidor (dev.sh)
const banco = tam(DB) + tam(DB + '-wal'), precisa = 2 * banco + 1e9, livreTmp = livre(tmpdir())
const destOk = !!DESTINO && existsSync(DESTINO) && statSync(DESTINO).isDirectory() && (() => { try { accessSync(DESTINO, constants.W_OK); return true } catch { return false } })()
const existentes = destOk ? readdirSync(DESTINO).filter(n => RX_NOME.test(n)).sort() : []
console.log(`Backup do banco — ${CONFIRMAR ? 'EXECUÇÃO' : 'PRÉVIA (nada é gravado; rode com --confirmar)'}`)
console.log(`  banco + WAL: ${MB(banco)} · disco livre: ${MB(livreTmp)} · exigido: ≥ ${MB(precisa)} (2× o banco + 1 GB de folga) → ${livreTmp >= precisa ? 'ok' : 'INSUFICIENTE'}`)
console.log(`  destino BACKUP_DIR: ${!DESTINO ? 'não configurado no .env (D-A2: pasta do Google Drive, ex.: …/Meu Drive/place-sprints-backup)' : destOk ? `${DESTINO} (${existentes.length} backup(s); retenção ${RETER})` : `INDISPONÍVEL (${DESTINO} não existe ou sem escrita)`}`)
console.log(`  chave: ${existsSync(CHAVE) ? 'presente' : 'ainda não criada (nasce no 1º --confirmar)'} em ${CHAVE}`)
if (!CONFIRMAR) process.exit(0)
if (!destOk) { console.error('Nada foi feito: BACKUP_DIR indisponível.'); process.exit(3) }
if (livreTmp < precisa || livre(DESTINO) < banco) { console.error('Nada foi feito: disco livre menor que 2× o banco + 1 GB (o backup não pode encher o disco).'); process.exit(3) }

const chave = lerChave({ criar: true })
const carimbo = new Date().toISOString().slice(0, 16).replace(':', '')
const tmp = join(tmpdir(), `ps-backup-${randomBytes(6).toString('hex')}.sqlite`), final = join(DESTINO, `place-sprints-${carimbo}.db.enc`), parcial = final + '.parcial'
try {
  closeSync(openSync(tmp, 'wx', 0o600))                                   // nasce 0600 antes de receber dado
  const src = new Database(DB, { readonly: true, fileMustExist: true }); src.pragma('busy_timeout = 30000')
  try { await src.backup(tmp) } finally { src.close() }
  const chk = new Database(tmp, { readonly: true }); const q = chk.pragma('quick_check', { simple: true }); chk.close()
  if (q !== 'ok') throw new Error('cópia não passou no quick_check')
  const shaClaro = await shaArquivo(tmp)
  await cifrar(tmp, parcial, chave)
  if (await decifrar(parcial, chave) !== shaClaro) throw new Error('backup cifrado não decifrou igual ao original')
  renameSync(parcial, final)
  const todos = readdirSync(DESTINO).filter(n => RX_NOME.test(n)).sort()
  const apagar = todos.slice(0, Math.max(0, todos.length - RETER))
  for (const n of apagar) rmSync(join(DESTINO, n))
  console.log(`  ok: ${final} (${MB(tam(final))}), conferido decifrando; ${apagar.length} antigo(s) removido(s) pela retenção de ${RETER}`)
  // Drive em streaming: os backups anteriores que já subiram saem do cache do Mac (evict); o de hoje sai amanhã. Melhor esforço: nunca falha o backup.
  const evict = process.env.FRIO_EVICT_BIN || join(ROOT, 'scripts', 'bin', 'frio-evict'); let despejados = 0
  if (existsSync(evict)) for (const n of todos.slice(-RETER)) if (join(DESTINO, n) !== final) try { execFileSync(evict, ['evict', join(DESTINO, n)], { stdio: 'ignore', timeout: 60_000 }); despejados++ } catch { /* não subiu ainda / já despejado */ }
  if (despejados) console.log(`  ${despejados} backup(s) anterior(es) despejado(s) do cache local do Drive`)
} catch (e) {
  console.error(`  backup falhou: ${String(e?.message || e).slice(0, 160)}`); process.exitCode = 1
} finally { for (const f of [tmp, tmp + '-journal', tmp + '-wal', tmp + '-shm', parcial]) rmSync(f, { force: true }) }
