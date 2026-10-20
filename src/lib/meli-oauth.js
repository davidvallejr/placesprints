// OAuth2 do Mercado Livre (authorization code) — fluxo padrão documentado em
// https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao
import { createHash, createHmac } from 'node:crypto'
import { env } from './env.js'

export const redirectUri = () => `${env.PUBLIC_BASE_URL}/meli/callback`

// Dois apps: o principal (clientes; tem escopos de escrita) e, opcional, o COMERCIAL só leitura para prospects.
// Prospect só usa o comercial com ID + segredo no .env; a conexão guarda o app que emitiu o token (meli_contas.app_id).
export const appComercialPronto = () => !!(env.MELI_CLIENT_ID_COMERCIAL && env.MELI_CLIENT_SECRET_COMERCIAL)
const appPrincipal = () => ({ id: env.MELI_CLIENT_ID, secret: env.MELI_CLIENT_SECRET })
const appComercial = () => ({ id: env.MELI_CLIENT_ID_COMERCIAL, secret: env.MELI_CLIENT_SECRET_COMERCIAL })
const appPara = prospecto => prospecto && appComercialPronto() ? appComercial() : appPrincipal()
const appPorId = id => id && id === env.MELI_CLIENT_ID_COMERCIAL ? appComercial() : appPrincipal()   // '' = conexão antiga = principal

// PKCE (S256) sem estado: o code_verifier é derivado do state com um segredo do servidor —
// imprevisível para terceiros e recomputável no callback, sem nada a guardar entre as duas pernas.
// Enviar PKCE é aceito pelo Mercado Livre mesmo quando o app não o exige, então vai sempre.
const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const pkceVerifier = state => b64url(createHmac('sha256', env.MELI_LINK_SECRET || env.MELI_CLIENT_SECRET || 'dev').update('pkce|' + String(state)).digest())

export function urlAutorizacao(state, prospecto = false) {
  const app = appPara(prospecto)
  if (!app.id) throw new Error('MELI_CLIENT_ID ausente no .env — crie o app em developers.mercadolivre.com.br (veja README).')
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: app.id,
    redirect_uri: redirectUri(),
    state,
    code_challenge: b64url(createHash('sha256').update(pkceVerifier(state)).digest()),
    code_challenge_method: 'S256',
  })
  return `https://auth.mercadolivre.com.br/authorization?${p}`
}

async function pedirToken(body) {
  const r = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  })
  const dados = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`Mercado Livre OAuth ${r.status}: ${dados.message || dados.error || JSON.stringify(dados).slice(0, 200)}`)
  return dados   // { access_token, token_type, expires_in, scope, user_id, refresh_token }
}

// devolve também app_id: renovação e revogação precisam do MESMO app que emitiu o token
export async function trocarCodigo(code, state, prospecto = false) {
  const app = appPara(prospecto)
  const tok = await pedirToken({
    grant_type: 'authorization_code',
    client_id: app.id,
    client_secret: app.secret,
    code,
    redirect_uri: redirectUri(),
    ...(state ? { code_verifier: pkceVerifier(state) } : {}),
  })
  return { ...tok, app_id: app.id }
}

// Refresh tokens do ML são de uso único — cada renovação devolve um novo,
// que precisa substituir o anterior no banco (feito em meli-contas.js).
export const renovarToken = (refreshToken, appId = '') => {
  const app = appPorId(appId)
  return pedirToken({
    grant_type: 'refresh_token',
    client_id: app.id,
    client_secret: app.secret,
    refresh_token: refreshToken,
  })
}

// Remove a autorização do app na conta do usuário. true só com 2xx do ML (quem chama trata como melhor esforço).
export async function revogarAutorizacao(accessToken, userId, appId = '') {
  const r = await fetch(`https://api.mercadolibre.com/users/${encodeURIComponent(userId)}/applications/${encodeURIComponent(appId || env.MELI_CLIENT_ID)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) })
  return r.ok
}

// o apelido é só rótulo: falha de rede/JSON NÃO pode perder uma conexão que acabou de consumir o código de autorização
export async function buscarPerfil(accessToken, userId) {
  try {
    const r = await fetch(`https://api.mercadolibre.com/users/${userId}`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) })
    if (!r.ok) return { nickname: '' }
    return await r.json().catch(() => ({ nickname: '' }))
  } catch { return { nickname: '' } }
}
