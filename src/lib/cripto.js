// Criptografia simétrica (AES-256-GCM) para credenciais sensíveis em repouso —
// tokens do Mercado Livre dão acesso real à conta do cliente (pedidos, ADS),
// por isso não ficam em texto puro no SQLite como o resto dos dados espelhados.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto'
import { env } from './env.js'

const CHAVE_DEV = 'chave-de-desenvolvimento-TROQUE-antes-de-produzir'
let avisoEmitido = false

function chave() {
  if (!env.MELI_TOKEN_KEY && !avisoEmitido) {
    avisoEmitido = true
    console.warn('⚠ MELI_TOKEN_KEY ausente no .env — usando chave de DESENVOLVIMENTO. ' +
      'Gere uma definitiva antes de conectar contas reais: openssl rand -hex 32')
  }
  // ponytail (15/10): scrypt é caro de propósito (~centenas de ms); derivar 1× por segredo — a coleta decifrava o token a cada dia de pedidos e travava o processo
  const base = env.MELI_TOKEN_KEY || CHAVE_DEV
  if (cacheChave.base !== base) { cacheChave.base = base; cacheChave.k = scryptSync(base, 'place-sprints-meli-v1', 32) }
  return cacheChave.k
}
const cacheChave = { base: null, k: null }

export function cifrar(texto) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chave(), iv)
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
  const tag = c.getAuthTag()
  return [iv, tag, enc].map(b => b.toString('base64')).join('.')
}

export function decifrar(str) {
  const [iv, tag, enc] = String(str).split('.').map(b => Buffer.from(b, 'base64'))
  const d = createDecipheriv('aes-256-gcm', chave(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

// ── Segredos da integração de custos (tokens Bling/Tiny, client_secret, segredo do webhook) ─────────────
// Chave PRÓPRIA (ERP_TOKEN_KEY; aceita MELI_TOKEN_KEY como fallback) e NUNCA a de desenvolvimento: sem chave,
// falha fechado (ERP_SEM_CHAVE, a rota responde 409). Derivada uma vez por valor (scrypt custa ~19 ms).
// Perder/trocar a chave = tokens ilegíveis = reconectar todos os ERPs e regerar os webhooks (guarde backup).
let chavesErpCache = { base: null }
function chavesErp() {
  const base = env.ERP_TOKEN_KEY || env.MELI_TOKEN_KEY
  if (!base) throw Object.assign(new Error('ERP_TOKEN_KEY ausente no .env — gere com: openssl rand -hex 32 (e guarde um backup) antes de conectar ERPs'), { code: 'ERP_SEM_CHAVE', status: 409 })
  if (chavesErpCache.base !== base) {
    const aes = scryptSync(base, 'place-sprints-erp-v1', 32)
    chavesErpCache = { base, aes, hmac: createHmac('sha256', aes).update('place-sprints-erp-hmac-v1').digest() }   // subchave: HMAC não reusa a chave do AES
  }
  return chavesErpCache
}
const cifraInvalida = () => Object.assign(new Error('segredo cifrado ilegível (adulterado ou cifrado com outra ERP_TOKEN_KEY)'), { code: 'ERP_CIFRA_INVALIDA' })

// Formato v1.<iv>.<tag>.<enc> (base64url). Nunca loga nem devolve o texto.
export function cifrarSegredo(texto) {
  const { aes } = chavesErp()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', aes, iv)
  const enc = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
  return ['v1', ...[iv, c.getAuthTag(), enc].map(b => b.toString('base64url'))].join('.')
}

export function decifrarSegredo(str) {
  const { aes } = chavesErp()
  const p = String(str ?? '').split('.')
  if (p.length !== 4 || p[0] !== 'v1') throw cifraInvalida()
  const [iv, tag, enc] = p.slice(1).map(b => Buffer.from(b, 'base64url'))
  if (iv.length !== 12 || tag.length !== 16) throw cifraInvalida()
  try {
    const d = createDecipheriv('aes-256-gcm', aes, iv, { authTagLength: 16 })
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  } catch { throw cifraInvalida() }
}

// HMAC com subchave da ERP_TOKEN_KEY (state assinado do OAuth dos ERPs). Mesma falha fechada sem chave.
export const hmacErp = msg => createHmac('sha256', chavesErp().hmac).update(String(msg)).digest('base64url')
