// Guarda global do painel (middleware puro, testável sem abrir porta).
// 1) O header Host precisa ser loopback (barra DNS rebinding) — exceto nas rotas públicas (OAuth do ML e dos ERPs + webhooks, via túnel).
// 2) POST/PUT/DELETE com Origin só passa se a ORIGEM é a do PRÓPRIO painel: host:porta IGUAL ao header Host. "Ser localhost" não basta —
//    outra porta local (outro app de dev) é cross-origin e não pode mutar este painel. Sem Origin (curl, webhook servidor→servidor) segue.
const HOST_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
// fluxo OAuth do ML + webhooks (Notion e ML) + webhook de custos (só com wid opaco) + callback OAuth dos ERPs.
// SÓ as rotas exatas (barra final opcional, como o Express aceita): nenhum prefixo aberto. /meli/..%2findex.html,
// /webhook/meli/x, /webhook/custos (sem wid), /webhook/custos/x/y e /api/custos/* pelo túnel = 403.
// + webhook do provedor fiscal (Focus NFe → /webhook/nf/focus; cabeçalho do gatilho conferido em emissores/focus-nfe.js, 401 sempre igual; só age com nf.ligado).
// + recibo e lote diário dos gatilhos ao cliente (n8n → Place Sprints; HMAC sobre o corpo cru em src/rotas-gatilhos.js, 401 sempre igual).
export const ROTA_PUBLICA = /^\/(meli\/(conectar|callback)|webhook\/(notion|meli|nf\/focus)|webhook\/custos\/[A-Za-z0-9_-]{16,64}|erp\/callback|(api|webhook)\/gatilhos\/(recibo|lote-diario))\/?$/i
// reforço pelo túnel: barra/contrabarra codificada ou segmento '..' no caminho = 403 (o express.static decodifica e normaliza).
const CAMINHO_SUSPEITO = /%2f|%5c|(^|\/)\.\.(\/|$)/i

// diagnóstico comercial público: SÓ estas rotas e SÓ quando o Host é exatamente o host comercial configurado
// (COMERCIAL_PUBLIC_HOST). meli.place2u.com.br ou qualquer outro host não alcança a landing; a landing não alcança o painel.
export const ROTA_PUBLICA_COMERCIAL = /^\/((diagnostico|conectar|d\/[A-Za-z0-9_-]{22}(\/(excluir|contato))?|logo)\/?)?$/   // "/" só redireciona p/ /diagnostico (rotas-publicas)
// Place Sprint 90 (autoatendimento): SÓ estas rotas e SÓ quando o Host é exatamente SPRINT90_PUBLIC_HOST. Lista FECHADA da fase F1
// (cada fase acrescenta as suas rotas aqui, nunca um prefixo aberto); sem caixa-insensível de propósito (/C/PAINEL = 403).
// "/" serve a landing (ou leva ao /c/entrar); o painel interno, o estático e /api/* nunca passam por este host. O host S90 é EXCLUSIVO: nem as rotas
// públicas do ML/webhooks (ROTA_PUBLICA) passam por ele — /conectar/fim é a volta do OAuth do ML concluída com a sessão (rotas-sprint90.js).
// + "É intencional" (PLANO ATIVO 4): /c/api/acoes/{ref de 16 hex}/intencional — a ref é opaca (o id interno da ação nunca sai), nada além desse formato exato.
export const ROTA_PUBLICA_S90 = /^\/(c(\/(entrar|sair|painel|conectar(\/fim)?|termos|privacidade|acesso\/[A-Za-z0-9_-]{22}|api\/(resumo|acoes(\/[0-9a-f]{16}\/intencional)?|intencionais(\/[0-9a-f]{16}\/desfazer)?|aceite|acesso\/gerar|dados\/excluir)))?|logo)?\/?$/
const hostSemPorta = h => String(h || '').toLowerCase().replace(/:\d+$/, '')

// soHttps: no host S90 (sempre HTTPS pelo túnel) uma página em http:// do mesmo nome é injeção de rede, não a própria origem
export function mesmaOrigem(origin, host, soHttps = false) {
  try {
    const u = new URL(String(origin))                                   // "null" (iframe sandbox, file://) cai no catch
    return (soHttps ? u.protocol === 'https:' : /^https?:$/.test(u.protocol)) && !!host && u.host.toLowerCase() === String(host).toLowerCase()
  } catch { return false }
}

export function guardaLocal(req, res, next, hostComercial = process.env.COMERCIAL_PUBLIC_HOST, hostS90 = process.env.SPRINT90_PUBLIC_HOST) {
  const origin = req.headers.origin
  const hs = String(hostS90 || '').trim().toLowerCase(), noS90 = !!hs && hostSemPorta(req.headers.host) === hs
  if (origin && req.method !== 'GET' && !mesmaOrigem(origin, req.headers.host, noS90))
    return res.status(403).send('origem não permitida')               // POST cross-site (CSRF) não passa
  if (HOST_LOCAL.test(req.headers.host || '')) return next()
  const caminhos = [req.path, String(req.originalUrl ?? '').split('?')[0]], torto = caminhos.some(c => CAMINHO_SUSPEITO.test(c || ''))
  // host S90 EXCLUSIVO, ANTES das rotas públicas: o que não está na lista fechada dele é 403 aqui (o webhook de custos, montado antes do roteador S90, nunca o vê)
  if (noS90) return ROTA_PUBLICA_S90.test(req.path) && !torto ? next() : res.status(403).send('acesso restrito ao painel local')
  if (ROTA_PUBLICA.test(req.path) && !torto) return next()
  const hc = String(hostComercial || '').trim().toLowerCase()
  if (hc && hostSemPorta(req.headers.host) === hc && ROTA_PUBLICA_COMERCIAL.test(req.path) && !torto) return next()
  res.status(403).send('acesso restrito ao painel local')
}
