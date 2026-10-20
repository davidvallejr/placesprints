// HTTP de saída da integração de custos (Bling/Tiny) — a ÚNICA porta de rede para ERP.
// Allowlist FIXA de hosts (nada vindo do banco ou do payload: anti-SSRF), só HTTPS, sem seguir redirect,
// só leitura (GET; POST apenas no endpoint de token do OAuth), teto de 5 MB por resposta e timeout de 20 s.
// Conectores e OAuth recebem `http` por injeção (deps): os testes usam fake e nunca tocam a rede.
import { setTimeout as dormir } from 'node:timers/promises'

export const HOSTS_ERP = Object.freeze(['api.bling.com.br', 'www.bling.com.br', 'api.tiny.com.br', 'accounts.tiny.com.br'])
export const TETO_BYTES = 5 * 1024 * 1024
export const TIMEOUT_MS = 20_000

const falha = (msg, code) => Object.assign(new Error(msg), { code })
const soLeitura = (metodo, u) => metodo === 'GET' || (metodo === 'POST' && /\/(oauth|openid-connect)\/token$/.test(u.pathname))

// http({ metodo, url, headers, corpo, timeoutMs }) → { status, headers /* minúsculos */, texto }
export const httpPadrao = async ({ metodo = 'GET', url, headers = {}, corpo, timeoutMs = TIMEOUT_MS } = {}) => {
  let u
  try { u = new URL(String(url)) } catch { throw falha('URL de ERP inválida', 'HOST_NAO_PERMITIDO') }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || !HOSTS_ERP.includes(u.hostname))
    throw falha(`host fora da allowlist de ERP: ${u.hostname || '?'}`, 'HOST_NAO_PERMITIDO')
  const m = String(metodo).toUpperCase()
  if (!soLeitura(m, u)) throw falha(`${m} não permitido: a integração só LÊ do ERP`, 'METODO_NAO_PERMITIDO')
  const ms = Math.min(Math.max(Number(timeoutMs) || TIMEOUT_MS, 1), TIMEOUT_MS)
  try {
    const r = await fetch(u, { method: m, headers, body: corpo, redirect: 'manual', signal: AbortSignal.timeout(ms) })
    if (Number(r.headers.get('content-length')) > TETO_BYTES) { await r.body?.cancel().catch(() => {}); throw falha('resposta do ERP acima de 5 MB', 'RESPOSTA_GRANDE') }
    const partes = []
    let total = 0
    if (r.body) for await (const p of r.body) {          // conta os bytes de verdade (content-length pode faltar ou mentir)
      total += p.length
      if (total > TETO_BYTES) throw falha('resposta do ERP acima de 5 MB', 'RESPOSTA_GRANDE')
      partes.push(p)
    }
    return { status: r.status, headers: Object.fromEntries(r.headers), texto: Buffer.concat(partes).toString('utf8') }
  } catch (e) {
    if (e.code === 'RESPOSTA_GRANDE') throw e
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw falha(`o ERP não respondeu em ${ms / 1000} s (${u.hostname})`, 'TIMEOUT')
    throw falha(`falha de rede com ${u.hostname}: ${e.cause?.code || 'erro de conexão'}`, 'REDE')
  }
}

// Limitador de saída por ESPAÇAMENTO mínimo (sem rajada): porSegundo/porMinuto viram o intervalo entre chamadas da conta;
// `global` = teto do processo: número (req/s, um limitador compartilhado por valor, ex. 30) ou outro limitador.
// registrar429 pausa a conta (padrão 1 s se o ERP não diz quanto).
// ponytail: em memória e por processo — reinício zera (aceitável: processo único, Mac local).
const globaisPorTaxa = new Map()
export function criarLimitador({ porSegundo, porMinuto, global } = {}) {
  if (typeof global === 'number') {
    if (!globaisPorTaxa.has(global)) globaisPorTaxa.set(global, criarLimitador({ porSegundo: global }))
    global = globaisPorTaxa.get(global)
  }
  const intervalo = Math.max(porSegundo > 0 ? 1000 / porSegundo : 0, porMinuto > 0 ? 60_000 / porMinuto : 0)
  let proximo = 0, pausaAte = 0
  return {
    async aguardar() {
      const t = Date.now(), vez = Math.max(t, proximo, pausaAte)
      proximo = vez + intervalo                          // reserva a vez antes de dormir: chamadas concorrentes enfileiram
      if (vez > t) await dormir(vez - t)
      while (Date.now() < pausaAte) await dormir(pausaAte - Date.now())   // 429 chegou enquanto esperava
      if (global) await global.aguardar()
    },
    registrar429(retryAfterMs) {
      const ms = Number(retryAfterMs) > 0 ? Number(retryAfterMs) : 1000
      pausaAte = Math.max(pausaAte, Date.now() + ms)
    },
  }
}

// Texto de erro que pode ir para banco/tela/log: tira tokens, segredos e o `code` do OAuth, corta em 300 caracteres.
export function sanitizar(texto) {
  return String(texto ?? '')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer ***')
    .replace(/\bBasic\s+[A-Za-z0-9+/=_-]+/gi, 'Basic ***')
    .replace(/eyJ[\w-]*\.[\w-]+\.[\w-]*/g, '***')                                            // JWT solto
    .replace(/("?(?:access_token|refresh_token|id_token|client_secret|client_id|code|token|segredo|secret)"?\s*[:=]\s*"?)[^"&\s,;}]+/gi, '$1***')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .slice(0, 300)
}
