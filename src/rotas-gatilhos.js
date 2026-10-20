// HTTP dos gatilhos do Merovíngio ao cliente (docs/desenho-gatilhos-n8n.md seção 5). Puro (só express): o núcleo entra por fábrica (src/lib/gatilhos.js).
// Dois roteadores: (a) JSON (depois do express.json): prévia, envio manual, liberação, chave, configuração por cliente, teste de canal, listagens;
// (b) HMAC sobre o corpo CRU (montado ANTES do express.json, como o webhook de custos): recibo do n8n e lote diário do cron de reserva — 401 SEMPRE igual.
// Regras: corpo JSON obrigatório nos POST (415); `confirmar` só vale se for EXATAMENTE true; `por` validado no núcleo (403); mensagens fixas, nunca ecoam o valor
// recebido (número, e-mail e webhook do cliente jamais vão a log ou a mensagem de erro); prospect "[Comercial] …" = 404; impedimento de negócio = 200 com ok:false.
import express, { Router } from 'express'
import { verificarAssinatura } from './lib/gatilhos-envio.js'
import { buscarDestinos as buscarDestinosCentral } from './lib/gatilhos-destinos-notion.js'
import { preencherVazios } from './lib/gatilhos.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const texto = v => typeof v === 'string' ? v.trim() : ''
const um = v => texto([].concat(v ?? '')[0])
const ehProspecto = c => /^\s*\[Comercial\]/i.test(c)
const LIMITE_CORPO = 64 * 1024

// deps: gatilhos (criarGatilhos), quem() → nomes que podem decidir (equipe.lideresEConsultores), clienteCanonico?(nome) → nome da central ou ''
export function criarRotasGatilhos({ gatilhos, quem = () => [], clienteCanonico, buscarDestinos = buscarDestinosCentral }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const json = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const cliente = bruto => {
    const c = texto(bruto)
    if (!c) throw erro('informe "cliente"')
    if (ehProspecto(c)) throw erro('cliente não encontrado na central', 404)
    const canon = clienteCanonico ? clienteCanonico(c) : c
    if (!canon) throw erro('cliente não encontrado na central', 404)
    return canon
  }
  const estrito = v => v === true
  const lista = v => Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean) : []

  r.get('/api/cliente/gatilhos', trata(async (req, res) => res.json({ ...(await gatilhos.listarCliente(cliente(um(req.query.cliente)))), quem: quem() })))
  r.post('/api/cliente/notificacao', trata((req, res) => { const b = json(req); res.json(gatilhos.configurar({ cliente: cliente(b.cliente), por: texto(b.por), notificacao: b.notificacao })) }))
  // preencher destinos VAZIOS com a base Clientes do Notion, SÓ Mercado Livre (grupo «Id whatsapp meli» e e-mail): lido no servidor, nada sobrescrito,
  // nenhum canal ligado; a resposta diz só QUAIS canais foram preenchidos e de onde (nunca o valor). Salva pelo mesmo configurar (valida e audita).
  // O Discord («Webhook ML» + «Discord ID Consultor ML») é canal INTERNO da equipe: a resposta diz só se a central tem cada um (interno), nunca vira canal do cliente.
  r.post('/api/cliente/notificacao/central', trata(async (req, res) => {
    const b = json(req), c = cliente(b.cliente), por = texto(b.por)
    const r0 = await buscarDestinos(c)
    if (!r0.achado) return res.json({ ok: false, motivo: r0.motivo })
    const atual = gatilhos.notificacao(c), interno = { discord: !!r0.destinos?.interno?.discord, consultor: !!r0.destinos?.interno?.consultor }
    const { canais, preenchidos } = preencherVazios(atual.canais, r0.sugestao)          // o MESMO preenchimento da liberação em lote
    if (!preenchidos.length) return res.json({ ok: true, preenchidos, invalidos: r0.destinos.invalidos, interno })
    gatilhos.configurar({ cliente: c, por, notificacao: { canais, ritmo: atual.ritmo, silencio: atual.silencio, fuso: atual.fuso, ...(atual.rotulo ? { rotulo: atual.rotulo } : {}) } })   // só a lista fechada de configurar (liberado_* é do liberar)
    res.json({ ok: true, preenchidos, invalidos: r0.destinos.invalidos, interno })
  }))
  // liberação em LOTE (decisão do David, 12/10/2026; rodar depois do reinício): { por, confirmar } — sem confirmar:true é prévia (nada gravado). Para cada cliente Ativo com
  // integração ML de fato: preenche o grupo «Id whatsapp meli» vazio pela central, liga o WhatsApp se o grupo existe, mantém o urgente desligado e libera. Resposta:
  // { ok, previa, liberados[], sem_grupo_ml[], sem_integracao[{ cliente, motivo }], invalidos[], nao_lidos[{ cliente, motivo }] } — nunca o valor do destino. Idempotente.
  r.post('/api/gatilhos/preparar-lote', trata(async (req, res) => { const b = json(req); res.json(await gatilhos.prepararLote({ por: texto(b.por), confirmar: estrito(b.confirmar), central: buscarDestinos })) }))
  r.get('/api/gatilhos/pendentes', trata((req, res) => res.json({ ...gatilhos.listarGeral(), quem: quem() })))
  r.post('/api/gatilhos/liberar', trata((req, res) => { const b = json(req); res.json(gatilhos.liberar({ clientes: lista(b.clientes), por: texto(b.por), liberar: b.liberar !== false })) }))
  r.get('/api/gatilhos/chave', trata((req, res) => res.json(gatilhos.chaveEstado())))
  r.post('/api/gatilhos/chave', trata((req, res) => { const b = json(req); res.json(gatilhos.chave({ ligado: b.ligado, por: texto(b.por) })) }))
  // prévia: { cliente, tipo: 'semanal' (padrão) | 'imediato' } monta EXATAMENTE o texto que sairia (o plano desta semana já montado volta igual) SEM gravar nem enviar
  r.post('/api/gatilhos/previa', trata(async (req, res) => { const b = json(req); res.json(await gatilhos.enviar({ cliente: cliente(b.cliente), tipo: texto(b.tipo) || 'semanal', confirmar: false })) }))
  // manual: { cliente, por, confirmar:true, lote_id? | tipo?, hash? } — sem confirmar:true é prévia; o líder decide (ignora chave, janela e liberação; exige canal e cliente Ativo)
  r.post('/api/gatilhos/enviar', trata(async (req, res) => {
    const b = json(req)
    res.json(await gatilhos.enviar({ cliente: cliente(b.cliente), por: texto(b.por), confirmar: estrito(b.confirmar), lote_id: texto(b.lote_id), tipo: texto(b.tipo) || 'semanal', hash: texto(b.hash) }))
  }))
  r.post('/api/gatilhos/teste', trata(async (req, res) => { const b = json(req); res.json(await gatilhos.testar({ cliente: cliente(b.cliente), canal: texto(b.canal), por: texto(b.por) })) }))
  return r
}

// Aviso INTERNO ao consultor no Discord (src/lib/consultor-discord.js; só loopback): estado + prévia do resumo semanal por cliente e a chave própria (nasce desligada).
// deps: consultor (criarConsultorDiscord), clienteCanonico?(nome) → nome da central ou ''
export function criarRotasConsultor({ consultor, clienteCanonico }) {
  const r = Router()
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { e?.status ? res.status(e.status).json({ erro: e.message }) : next(e) } }
  const cliente = bruto => { const c = texto(bruto); if (!c) throw erro('informe "cliente"'); const canon = ehProspecto(c) ? '' : clienteCanonico ? clienteCanonico(c) : c; if (!canon) throw erro('cliente não encontrado na central', 404); return canon }
  // ?previa=1 monta o resumo desta semana SEM gravar (o desta semana já montado volta igual) com as partes EXATAS que saem (cargos + consultor no topo da 1ª); sem ela, só o estado (leve)
  r.get('/api/cliente/consultor-discord', trata(async (req, res) => res.json(await consultor.listarCliente(cliente(um(req.query.cliente)), { previa: um(req.query.previa) === '1' }))))
  r.get('/api/consultor-discord/chave', trata((req, res) => res.json(consultor.chaveEstado())))
  r.post('/api/consultor-discord/chave', trata((req, res) => {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro('envie o corpo como JSON (Content-Type: application/json)', 415)
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
    res.json(consultor.chave({ ligado: b.ligado, por: texto(b.por) }))
  }))
  return r
}

// deps: gatilhos, consultor? (recibo de lote_id da tabela consultor_aviso; tick antes do plano no cron de reserva), secret() → PLACE_GATILHOS_SECRET atual ('' = tudo 401),
// janelaS, agoraMs(), log(nivel, msg). Corpo cru ≤ 64 KB; sem inflar.
export function criarRotasGatilhosHmac({ gatilhos, consultor = null, secret, janelaS = 300, agoraMs = () => Date.now(), log = () => {} }) {
  const r = Router()
  const NEGADO = res => res.status(401).set('Cache-Control', 'no-store').json({ ok: false })
  const raw = express.raw({ type: () => true, limit: LIMITE_CORPO, inflate: false })
  const corpo = req => Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  // ponytail: limitador de falhas de auth em memória (10 falhas em 5 min = IP negado por 15 min), mesma régua de custos-webhook.js sem importar o banco; bloqueado responde o MESMO 401
  const falhas = new Map(), MIN = 60_000
  const ipDe = req => String(req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || '').slice(0, 64)
  const bloqueado = (ip, t) => (falhas.get(ip)?.bloqueado_ate ?? 0) > t
  const falhou = (ip, t) => {
    let f = falhas.get(ip); if (!f || t - f.inicio > 5 * MIN) f = { inicio: t, n: 0, bloqueado_ate: 0 }
    if (++f.n >= 10) f.bloqueado_ate = t + 15 * MIN
    if (falhas.size >= 10_000 && !falhas.has(ip)) for (const [k, v] of falhas) if (Math.max(v.inicio + 5 * MIN, v.bloqueado_ate) < t) falhas.delete(k)
    falhas.set(ip, f)
  }
  const autentica = (req, res, next) => {
    const ip = ipDe(req), t = agoraMs()
    if (bloqueado(ip, t)) return NEGADO(res)
    if (verificarAssinatura({ secret: secret(), headers: req.headers, raw: corpo(req), agoraMs: t, janelaS })) return next()
    falhou(ip, t); NEGADO(res)
  }
  const parse = raw => { try { const j = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); return j && typeof j === 'object' && !Array.isArray(j) ? j : null } catch { return null } }

  // n8n → recibo por canal: { lote_id, canal, estado: entregue | falhou, em }; idempotente por (lote_id, canal). Dois caminhos iguais: /webhook/gatilhos/* (o que os fluxos
  // importados chamam pelo host do túnel) e /api/gatilhos/* (desenho, seção 5)
  r.post(['/webhook/gatilhos/recibo', '/api/gatilhos/recibo'], raw, autentica, (req, res) => {
    const p = parse(corpo(req)); if (!p) return res.status(400).set('Cache-Control', 'no-store').json({ ok: false, erro: 'JSON inválido' })
    const rec = { lote_id: texto(p.lote_id), canal: texto(p.canal), estado: texto(p.estado), em: texto(p.em) }
    let out = gatilhos.registrarRecibo(rec)
    if (!out.ok && out.motivo === 'lote_desconhecido' && consultor) out = consultor.registrarRecibo(rec)   // lote do aviso interno ao consultor (canal discord)
    log(out.ok ? 'info' : 'aviso', `gatilhos: recibo ${texto(p.canal).slice(0, 12)} → ${out.ok ? (out.duplicado ? 'duplicado' : 'ok') : out.motivo}`)
    res.status(out.ok ? 200 : 422).set('Cache-Control', 'no-store').json(out)
  })
  // cron de reserva do n8n (caminho com nome histórico «lote-diario»; o fluxo deve chamar na TERÇA 09:05 desde 12/10/2026): o Place Sprints roda os MESMOS ticks, com as mesmas
  // travas (inicio_envios, integração ML, só semanal: o plano só dentro da janela de terça no fuso de cada cliente); idempotente por (cliente, semana ISO)
  r.post(['/webhook/gatilhos/lote-diario', '/api/gatilhos/lote-diario'], raw, autentica, async (req, res, next) => {
    try {
      const cons = consultor ? await consultor.tick({ origem: 'n8n-cron' }) : null                       // o resumo ao consultor (08:30) antes do plano ao cliente (09:00)
      const out = await gatilhos.tick({ origem: 'n8n-cron' }); res.set('Cache-Control', 'no-store').json({ ok: true, ...out, ...(cons ? { consultor: cons } : {}) })
    } catch (e) { next(e) }
  })
  r.use((err, req, res, _next) => {                                      // corpo grande = 413; gzip/aborto = 400; corpo fixo, nunca a mensagem do parser
    const st = err?.type === 'entity.too.large' ? 413 : 400
    log('aviso', `gatilhos ${String(req.path || '').slice(0, 24)} → ${st}`)
    res.status(st).set('Cache-Control', 'no-store').json({ ok: false })
  })
  return r
}
