// Link de conexão assinado (HMAC) — o botão no Notion de cada cliente aponta
// para uma URL que só é válida para AQUELE cliente e expira sozinha. Sem
// sessão de servidor: o "state" do OAuth carrega a própria assinatura.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env.js'

const CHAVE_DEV = 'troque-este-segredo-antes-de-produzir'
let avisoEmitido = false

function segredo() {
  if (!env.MELI_LINK_SECRET && !avisoEmitido) {
    avisoEmitido = true
    console.warn('⚠ MELI_LINK_SECRET ausente no .env — usando segredo de DESENVOLVIMENTO. ' +
      'Gere um definitivo antes de enviar links reais aos clientes: openssl rand -hex 32')
  }
  return env.MELI_LINK_SECRET || CHAVE_DEV
}

function assinar(cliente, exp) {
  return createHmac('sha256', segredo()).update(`${cliente}|${exp}`).digest('hex').slice(0, 32)
}

// Gera o link que vai no botão do Notion. Padrão: 60 dias de validade —
// republicado a cada rodada semanal, então na prática nunca expira em uso.
export function linkConectar(cliente, dias = 60) {
  if (!env.PUBLIC_BASE_URL) throw new Error('PUBLIC_BASE_URL ausente no .env — configure o domínio público antes de gerar links (veja README, seção "Integração Mercado Livre").')
  const exp = Math.floor(Date.now() / 1000) + dias * 86400
  const c = Buffer.from(cliente, 'utf8').toString('base64url')
  const sig = assinar(cliente, exp)
  return `${env.PUBLIC_BASE_URL}/meli/conectar?c=${c}&exp=${exp}&sig=${sig}`
}

// Empacota os 3 campos num único "state" opaco para ir e voltar no OAuth.
export const empacotarState = (c, exp, sig) => `${c}.${exp}.${sig}`
export const desempacotarState = state => String(state || '').split('.')

export function validar(cBase64, exp, sig) {
  if (!cBase64 || !exp || !sig) return { ok: false, motivo: 'link incompleto' }
  let cliente
  try { cliente = Buffer.from(cBase64, 'base64url').toString('utf8') } catch { return { ok: false, motivo: 'link inválido' } }
  if (Math.floor(Date.now() / 1000) > Number(exp)) return { ok: false, motivo: 'link expirado — peça ao seu consultor para gerar um novo' }
  const esperado = Buffer.from(assinar(cliente, exp)), recebido = Buffer.from(String(sig))
  if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return { ok: false, motivo: 'assinatura inválida' }
  return { ok: true, cliente }
}
