// Place Sprint 90 — HTTP da fase F1 (docs/contrato-sprint90-f1.md): painel do cliente /c/* (identidade, leitura) e rotas internas /api/sprint90/* (equipe).
// SEM SPRINT90_PUBLIC_HOST NADA DISTO EXISTE (o roteador só passa adiante). Pelo túnel, a guarda (src/lib/guarda-local.js → ROTA_PUBLICA_S90) só deixa o host exato
// alcançar a lista fechada; aqui, por reforço, /c/* responde só no host S90 ou no loopback, /api/sprint90/* só no loopback, e todo o resto do host S90 é 404.
// /c/api/* deriva o cliente SÓ da sessão (cookie s90): ?cliente= e body.cliente são ignorados. Mensagens de erro fixas, nunca ecoam valor recebido.
import { Router } from 'express'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { env, ROOT } from './lib/env.js'
import { db, agora, hojeLocal, log } from './lib/db.js'
import { notificar } from './lib/notificacoes.js'
import { criarS90, TOKEN_S90 } from './lib/s90.js'
import { acaoParaCliente } from './lib/s90-texto.js'
import * as P from './lib/s90-paginas.js'
import { chaveIp, ipDe } from './rotas-publicas.js'
import { statusConexao, revogarConexao, desconectar, purgarPendentesDe, salvarConexao, outraConexaoDoApp } from './lib/meli-contas.js'
import { linkConectar, validar as validarLink, desempacotarState } from './lib/meli-link.js'
import { trocarCodigo, buscarPerfil, revogarAutorizacao } from './lib/meli-oauth.js'
import { infraMeliPronta } from './lib/comercial.js'
import { enviarEmail } from './lib/email.js'
import { validarLiderOuConsultor } from './lib/equipe.js'
import { alinhamentosReal } from './lib/alinhamentos-real.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const hostDe = req => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '')
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/
const texto = v => (typeof v === 'string' ? v.trim() : '')
const diaBR = iso => { const d = new Date(iso || NaN); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) }   // AAAA-MM-DD em Brasília (o banco guarda UTC)
const ESTADO_TEXTO = { pendente_pagamento: 'aguardando ativação', ativo: 'ativa', inadimplente: 'pausada (pagamento em aberto)', pausado: 'pausada', cancelado: 'cancelada', excluir_pendente: 'exclusão agendada', excluido: 'excluída' }
const dm = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''
// ref OPACA da ação para o cliente (D11: o id interno nunca sai): hash da chave da conta + id — a ref de uma conta não acha nada em outra
const refAcao = (chave, id) => createHash('sha256').update(`${chave}|${id}`).digest('hex').slice(0, 16)
const FORA = 'Duplicação estratégica, urgência oculta e concentração de receita exigem pesquisa feita por um especialista e ficam com a assessoria Place2u, fora do autoatendimento.'
const MSG = { sessao: 'Sua sessão expirou: entre de novo pelo seu link.', limite: 'Muitas tentativas. Espere alguns minutos e tente de novo.', json: 'Envie o corpo como JSON.',
  reconecta: 'Este acesso só reconecta a conta do Mercado Livre que já está ligada a este painel. Para ligar uma conta do Mercado Livre, peça um link de acesso à Place2u.' }

// termos versionados (redação: frente F0). Sem o arquivo, cadastro e aceite ficam bloqueados DE PROPÓSITO; arquivo que começa com "# RASCUNHO"
// = não publicado (rascunho: true) — só a conta de piloto/demonstração criada pela equipe cadastra e aceita (src/lib/s90.js → termosPara)
export function lerTermos(cfg, arquivo = join(ROOT, 'config', 'termos-sprint90.md')) {
  try {
    const t = readFileSync(arquivo, 'utf8')
    return t.trim() ? { versao: cfg.termos_versao, hash: createHash('sha256').update(t).digest('hex'), texto: t, rascunho: /^#\s*RASCUNHO\b/i.test(t.trimStart()) } : null
  } catch { return null }
}

// limite por IP (IPv6 pelo /64): memória do processo, reinício zera — mesmo teto conhecido de rotas-publicas.js
function criarLimite() {
  const janelas = new Map()
  return (nome, max, ms) => req => {
    const k = `${nome}|${chaveIp(ipDe(req))}`, t = Date.now(), l = (janelas.get(k) || []).filter(x => x > t - ms)
    if (l.length >= max) return false
    l.push(t); janelas.set(k, l)
    if (janelas.size > 5000) janelas.clear()
    return true
  }
}

// deps: s90 (criarS90), hostS90() → host público ('' = desligado), leitura { conexao(chave), cobertura(chave), diagnostico(chave) async, nomesInternos(chave) async },
//       conectarLink(chave) → URL assinada (OAuth do ML, 10 min) | lança, concluirConexao({ chave, code, state, vendedor? }) async → { ok } | { status, msg } (troca o código, D17, grava;
//       vendedor = só este meli_user_id pode ser gravado — sessão de "Guardar meu acesso"),
//       infraPronta() → bool, validarPor(nome) → nome canônico | '', landing() → caminho do arquivo | ''
//       alinhamentos (criarAlinhamentos; null = "É intencional" indisponível, 503): o cliente marca a prioridade como intencional → alinhamento origem 's90_cliente'
export function criarRotasSprint90({ s90, hostS90 = () => env.SPRINT90_PUBLIC_HOST, leitura, conectarLink, concluirConexao = async () => ({ status: 503, msg: 'A conexão com o Mercado Livre está em configuração. Tente mais tarde.' }),
  infraPronta = () => true, validarPor, landing = () => '', log: lg = () => {}, alinhamentos = null }) {
  const r = Router(), pode = criarLimite()
  const noHostS90 = req => !!hostS90() && hostDe(req) === hostS90()
  const proto = req => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
  const https = req => noHostS90(req) || proto(req) === 'https'
  // cookie no host S90: __Host-s90 (Secure, Path=/, sem Domain — um subdomínio irmão não planta nem sombreia a sessão); no loopback: s90, Path=/c,
  // Secure só atrás do túnel (X-Forwarded-Proto https) — em http://localhost o navegador descartaria um cookie Secure. HttpOnly e SameSite=Lax sempre.
  const nomeCookie = req => noHostS90(req) ? '__Host-s90' : 's90'
  const cookie = (req, res, token, maxAge) => res.append('Set-Cookie', noHostS90(req)
    ? `__Host-s90=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
    : `s90=${token}; Path=/c; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${https(req) ? '; Secure' : ''}`)
  // mais de um cookie de sessão no mesmo pedido (cookie plantado + o legítimo) = sem sessão: nunca "vence o primeiro"
  const tokenDoCookie = req => {
    const nome = nomeCookie(req), achados = String(req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.slice(0, nome.length + 1) === `${nome}=`).map(x => x.slice(nome.length + 1))
    return achados.length === 1 && TOKEN_S90.test(achados[0]) ? achados[0] : ''
  }
  const trata = fn => async (req, res, next) => { try { await fn(req, res) } catch (e) { if (e?.status && !res.headersSent) return res.status(e.status).json({ erro: e.message }); next(e) } }
  const corpoJson = req => { if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw erro(MSG.json, 415); return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {} }
  const sessao = api => (req, res, next) => {
    const token = tokenDoCookie(req), conta = s90.sessaoDe(token)
    if (!conta) return api ? res.status(401).json({ erro: MSG.sessao }) : res.redirect(302, '/c/entrar')
    req.s90 = { conta, token }
    next()
  }
  const limitar = (nome, max, ms, api) => (req, res, next) => pode(nome, max, ms)(req) ? next()
    : api ? res.status(429).json({ erro: MSG.limite }) : res.status(429).send(P.paginaErro('Muitas tentativas', MSG.limite, { nonce: P.cabecalhos(res) }))

  // ── interruptor geral + host: sem a env nada existe; /c/* só no host S90 ou loopback ──
  r.use((req, res, next) => {
    if (!hostS90()) {
      // env definida mas Sprint 90 DESLIGADO (config/sprint90.json inválido): a guarda segue reservando o host da env para a lista fechada (com "/"),
      // então nada desse host pode seguir adiante — o estático serviria o painel interno em "/". No loopback, Integrações recebe o motivo real.
      const reservado = env.SPRINT90_PUBLIC_HOST
      if (reservado && hostDe(req) === reservado) return res.status(503).send(P.paginaErro('Em manutenção', 'O painel volta em instantes. Se precisar, fale com a Place2u.', { nonce: P.cabecalhos(res) }))
      if (reservado && /^\/api\/sprint90(\/|$)/.test(req.path) && LOOPBACK.test(hostDe(req))) return res.status(503).json({ erro: 'config/sprint90.json inválido: Sprint 90 desligado até o arquivo ser corrigido (e o servidor reiniciado pelo fluxo combinado).' })
      return next()
    }
    if (noHostS90(req)) {
      // o host S90 só existe em HTTPS: http (zona sem "Always Use HTTPS", link colado sem esquema) vira https ANTES de qualquer rota — POST em http
      // nunca gasta o link de uso único nem grava cookie que o navegador descartaria; HSTS em toda resposta
      res.set('Strict-Transport-Security', 'max-age=31536000')
      if (proto(req) === 'http') return ['GET', 'HEAD'].includes(req.method) ? res.redirect(301, `https://${hostS90()}${req.originalUrl}`) : res.status(400).send('Use https.')
    }
    if (req.path === '/' && noHostS90(req)) {
      if (s90.sessaoDe(tokenDoCookie(req))) return res.set('Cache-Control', 'no-store').redirect(302, '/c/painel')   // quem já é cliente volta ao painel, não à página de venda
      const f = landing(); return f ? res.set('Cache-Control', 'no-cache').sendFile(f) : res.redirect(302, '/c/entrar')
    }
    if (/^\/c(\/|$)/.test(req.path)) {
      if (!noHostS90(req) && !LOOPBACK.test(hostDe(req))) return res.status(404).end()
      res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' })   // no-referrer faria o navegador mandar Origin: null no POST de formulário (a guarda barra)
      return rotasC(req, res, next)
    }
    if (/^\/api\/sprint90(\/|$)/.test(req.path)) return LOOPBACK.test(hostDe(req)) ? rotasInternas(req, res, next) : res.status(404).end()
    if (noHostS90(req) && req.path !== '/logo') return res.status(404).send(P.paginaErro('Página não encontrada', 'Confira o endereço.', { nonce: P.cabecalhos(res) }))
    next()
  })

  // ═════════ painel do cliente ═════════
  const rotasC = Router()
  rotasC.get(['/c', '/c/'], (req, res) => res.redirect(302, '/c/painel'))
  rotasC.get('/c/entrar', (req, res) => res.send(P.paginaEntrar({ nonce: P.cabecalhos(res), saiu: req.query.saiu === '1' })))
  rotasC.get('/c/termos', (req, res) => res.send(P.paginaTermos({ nonce: P.cabecalhos(res), termos: s90.termos() })))
  rotasC.get('/c/privacidade', (req, res) => res.send(P.paginaTermos({ nonce: P.cabecalhos(res), termos: s90.termos(), privacidade: true })))
  // o GET não gasta o link (pré-visualização do WhatsApp/e-mail abriria e queimaria o uso único); só o POST do botão consome
  rotasC.get('/c/acesso/:token', (req, res) => TOKEN_S90.test(req.params.token) ? res.send(P.paginaAcesso({ nonce: P.cabecalhos(res) })) : res.status(404).send(P.paginaErro('Link inválido', 'Peça um novo link à Place2u.', { nonce: P.cabecalhos(res) })))
  rotasC.post('/c/acesso/:token', limitar('acesso', 10, 15 * 60e3, false), (req, res) => {
    const r1 = s90.consumirAcesso(req.params.token, { ip: ipDe(req) })
    if (!r1) return res.status(404).send(P.paginaErro('Link inválido, vencido ou já usado', 'Cada link abre o painel uma vez. Se você já entrou por ele, use o mesmo navegador; se não, peça um novo link à Place2u.', { nonce: P.cabecalhos(res) }))
    cookie(req, res, r1.token, r1.max_age_s)
    res.redirect(303, '/c/painel')
  })
  // ?todos=1: "sair de todos os aparelhos" — derruba todas as sessões da conta e os links guardados ainda não usados
  rotasC.post('/c/sair', (req, res) => {
    const tk = tokenDoCookie(req), c = req.query.todos === '1' ? s90.sessaoDe(tk) : null
    if (c) s90.revogarAcessos(c.id, { por: 'cliente', ip: ipDe(req) }); else s90.encerrarSessao(tk)
    cookie(req, res, '', 0); res.redirect(303, '/c/entrar?saiu=1')
  })
  rotasC.get('/c/painel', sessao(false), (req, res) => {
    cookie(req, res, req.s90.token, s90.cfg.sessao_dias * 86400)          // renova o prazo do cookie junto com o da sessão (30 dias deslizantes)
    res.send(P.paginaPainel({ nonce: P.cabecalhos(res) }))
  })
  // sessão aberta por "Guardar meu acesso" (link que uma sessão gera e pode REPASSAR: "seu painel grátis") só reconecta o vendedor já ligado à conta —
  // quem recebe o link de um assinante nunca liga o próprio vendedor à conta dele. Ligar um vendedor: link da equipe (entregue ao titular) ou retorno do pagamento.
  const soReconecta = req => s90.origemDaSessao(req.s90.token) === 'painel'
  // conexão do ML: só com sessão, conta ativa e aceite. O link (10 min) vai no redirect e fica AMARRADO a esta sessão (s90_oauth): a volta do ML só é
  // concluída em /c/conectar/fim com a mesma sessão, uma vez — repassado a outra pessoa, ele não liga o vendedor dela a esta conta
  rotasC.get('/c/conectar', sessao(false), (req, res) => {
    const c = req.s90.conta, nonce = P.cabecalhos(res), indisponivel = () => res.status(503).send(P.paginaErro('Conexão indisponível', 'A conexão com o Mercado Livre está em configuração. Tente mais tarde.', { nonce }))
    if (!s90.podeConectar(c.chave)) return res.status(409).send(P.paginaErro('Conexão indisponível', s90.aceitePendente(c) ? 'Aceite os termos no painel antes de conectar.' : 'A conexão fica disponível com a conta ativa.', { nonce }))
    if (soReconecta(req) && !leitura.conexao(c.chave)) return res.status(409).send(P.paginaErro('Conexão indisponível', MSG.reconecta, { nonce }))
    if (!infraPronta()) return indisponivel()
    let url
    try { url = conectarLink(c.chave) } catch { return indisponivel() }
    let sig = ''
    try { sig = new URL(url).searchParams.get('sig') || '' } catch { /* link sem assinatura: o fim recusa */ }
    s90.vincularConexao(c.id, sig, req.s90.token, noHostS90(req) ? '' : String(req.headers.host || ''))   // no loopback (teste/piloto da equipe) o callback devolve para cá
    res.redirect(302, url)
  })
  // volta do OAuth (o /meli/callback do host do ML só repassa code + state para cá, sem trocar nada): sem a sessão dona do state = /c/entrar, nada gravado
  rotasC.get('/c/conectar/fim', sessao(false), trata(async (req, res) => {
    const c = req.s90.conta, nonce = P.cabecalhos(res), falha = (st, msg) => res.status(st).send(P.paginaErro('Não foi possível conectar', msg, { nonce }))
    const code = texto(req.query.code), state = texto(req.query.state), [cb, exp, sig] = desempacotarState(state), v = validarLink(cb, exp, sig)
    if (!code || !v.ok || v.cliente !== c.chave || !s90.consumirConexao(c.id, sig, req.s90.token))
      return falha(403, 'Esta autorização não pertence a esta sessão, venceu ou já foi usada. Volte ao painel e use o botão "Conectar o Mercado Livre" de novo.')
    if (!s90.podeConectar(c.chave)) return falha(409, 'A conexão fica disponível com a conta ativa e os termos aceitos.')
    const vendedor = soReconecta(req) ? String(leitura.conexao(c.chave)?.meli_user_id ?? '') : ''
    if (soReconecta(req) && !vendedor) return falha(409, MSG.reconecta)
    const r1 = await concluirConexao({ chave: c.chave, code, state, ...(vendedor ? { vendedor } : {}) })
    if (!r1?.ok) return falha(r1?.status || 500, r1?.msg || 'Não foi possível concluir a conexão. Tente novamente em alguns minutos.')
    res.redirect(303, '/c/painel?conectado=1')
  }))

  const projecaoConta = c => ({ loja: c.loja, plano: c.plano, plano_rotulo: s90.cfg.planos?.[c.plano]?.rotulo || c.plano, preco_centavos: c.preco_centavos, comissao_pct: c.comissao_pct,
    estado: c.estado, estado_texto: ESTADO_TEXTO[c.estado] || c.estado, inicio_em: c.inicio_em, preco_travado_ate: c.preco_travado_ate, ...s90.diaFase(c) })
  const projecaoConexao = cx => !cx ? { estado: 'sem_conexao' } : { estado: cx.erro ? 'caida' : 'conectada', nickname: cx.nickname || '', desde: diaBR(cx.conectado_em) }
  // números do diagnóstico em cache por conta (o diagnóstico roda síncrono no SQLite e bloqueia o processo inteiro): vale até chegar coleta nova (dias/ate) ou 15 min
  // ponytail: memória do processo, reinício zera; teto de 500 contas
  const cacheNumeros = new Map()
  rotasC.get('/c/api/resumo', sessao(true), limitar('leitura', 30, 60e3, true), trata(async (req, res) => {
    const c = req.s90.conta, cx = leitura.conexao(c.chave), aceitePendente = s90.aceitePendente(c), t = s90.termosPara(c)
    const base = { conta: projecaoConta(c), aceite_pendente: aceitePendente, termos_disponiveis: !!t, termos_versao: t?.versao || '', pode_conectar: s90.podeConectar(c.chave) && infraPronta(), conexao: projecaoConexao(cx) }
    if (aceitePendente || !cx) return res.json({ ...base, leitura: null, numeros: null, prioridades: 0 })
    const cob = leitura.cobertura(c.chave) || {}
    let numeros = null
    const k = `${cob.dias || 0}|${cob.ate || ''}`, hit = cacheNumeros.get(c.chave)
    if (hit && hit.k === k && Date.now() - hit.em < 15 * 60e3) numeros = hit.numeros
    else try {
      const d = await leitura.diagnostico(c.chave)
      if (d?.disponivel) numeros = { faturamento_28d: d.resumo.gmv, variacao_pct: d.resumo.variacao?.pct ?? null, pedidos: d.resumo.pedidos, ticket: d.resumo.ticket, anuncios_ativos: d.resumo.anuncios_ativos, conversao_pct: d.resumo.conversao_conta ?? null }
      if (cacheNumeros.size >= 500) cacheNumeros.clear()
      cacheNumeros.set(c.chave, { k, em: Date.now(), numeros })
    } catch (e) { lg('aviso', `Sprint 90: resumo sem diagnóstico (conta ${c.id}): ${String(e?.message || '').replace(/["'`][\s\S]*$/, '…').slice(0, 120)}`) }
    res.json({ ...base, leitura: { lendo: !cob.dias, dias: cob.dias || 0, ate: cob.ate || null }, numeros, prioridades: s90.acoesDaSemana(c.chave).length })
  }))
  // "Marcado por você como intencional em dd/mm; revisamos em dd/mm": só o que o PRÓPRIO cliente marcou (origem s90_cliente) — o predicado do núcleo é a única leitura
  const marcado = (al, a) => { const x = al ? al({ item: a.item_id || '', regra: a.regra }) : null; return x?.sim && x.origem === 's90_cliente' ? textoIntencional(x) : null }
  const textoIntencional = x => ({ desde: x.desde, revisar_em: x.revisar_em, texto: `${x.origem === 's90_cliente' ? 'Marcado por você' : 'Já combinado'} como intencional em ${dm(x.desde)}${x.revisar_em ? `; revisamos em ${dm(x.revisar_em)}` : ''}` })
  const motivosIntencional = () => alinhamentos?.config ? Object.entries(alinhamentos.config.tipos_s90).map(([id, rotulo]) => ({ id, rotulo })) : []
  rotasC.get('/c/api/acoes', sessao(true), limitar('leitura', 30, 60e3, true), trata(async (req, res) => {
    const c = req.s90.conta
    if (s90.aceitePendente(c)) return res.json({ acoes: [], fora_do_autoatendimento: FORA, motivos_intencional: [] })
    let nomes = []
    try { nomes = (await leitura.nomesInternos(c.chave)) || [] } catch { nomes = [] }
    const al = alinhamentos ? alinhamentos.predicado(c.chave) : null
    const acoes = s90.acoesDaSemana(c.chave).map(a => ({ ...acaoParaCliente(a, { nomesInternos: nomes, permitidos: [c.loja] }), ref: refAcao(c.chave, a.id), intencional: marcado(al, a) }))
    const omitidas = acoes.reduce((t, a) => t + a.linhas_omitidas, 0)
    if (omitidas) lg('aviso', `Sprint 90: ${omitidas} trecho(s) do plano omitido(s) na projeção ao cliente (conta ${c.id})`)   // frequente = o texto do motor tem bug
    res.json({ acoes: acoes.map(({ linhas_omitidas, ...a }) => a), fora_do_autoatendimento: FORA, motivos_intencional: motivosIntencional() })
  }))
  // "É intencional" (PLANO ATIVO 4, 1ª decisão do cliente no painel): o cliente diz que a prioridade é de propósito, com um motivo da LISTA FECHADA (config/alinhamentos.json →
  // tipos_s90) → alinhamento origem 's90_cliente', revisão padrão (+30 d), escopo = o anúncio da ação (ou a conta) e a regra dela. Cliente SÓ da sessão; a ação precisa estar
  // nas prioridades DESTA conta (ref opaca) — de outra conta = 404. Repetir não duplica: devolve o que já está marcado. Mensagens fixas, nunca ecoam o valor recebido.
  rotasC.post('/c/api/acoes/:ref/intencional', sessao(true), limitar('decisao', 20, 60e3, true), trata((req, res) => {
    const b = corpoJson(req), c = req.s90.conta
    if (!alinhamentos?.config) throw erro('Indisponível agora. Tente mais tarde.', 503)
    if (s90.aceitePendente(c)) throw erro('Aceite os termos no Resumo antes.', 409)
    const ref = String(req.params.ref), a = /^[0-9a-f]{16}$/.test(ref) ? s90.acoesDaSemana(c.chave).find(x => refAcao(c.chave, x.id) === ref) : null
    if (!a) throw erro('Prioridade não encontrada.', 404)
    const tipo = texto(b.motivo_tipo)
    if (!Object.hasOwn(alinhamentos.config.tipos_s90, tipo)) throw erro('Escolha um motivo da lista.')
    const ja = alinhamentos.alinhado(c.chave, { item: a.item_id || '', regra: a.regra })
    const x = ja.sim ? ja : alinhamentos.registrar({ cliente: c.chave, escopo: a.item_id ? 'anuncio' : 'conta', chave: a.item_id || '', regras: [a.regra], tipo, origem: 's90_cliente', confirmar: true }).alinhamento
    if (!ja.sim) lg('info', `Sprint 90: prioridade marcada como intencional pelo cliente (conta ${c.id}, ${tipo})`)
    res.json({ ok: true, intencional: textoIntencional(x) })
  }))
  // o que o PRÓPRIO cliente marcou como intencional (origem s90_cliente; vivo ou vencido) e o desfazer: a marca sobrevive à regeneração do plano (a ação vira obsoleta),
  // então a lista é dos alinhamentos, não das ações. Ref opaca por conta (id interno nunca sai); de outra conta ou de outra origem = 404. Desfazer = encerrar (só s90_cliente).
  const refIntencional = (chave, id) => refAcao(chave, `alinhamento:${id}`)
  const marcacoes = c => alinhamentos?.config ? alinhamentos.listar(c.chave).filter(a => a.origem === 's90_cliente') : []
  rotasC.get('/c/api/intencionais', sessao(true), limitar('leitura', 30, 60e3, true), trata((req, res) => {
    const c = req.s90.conta, T = alinhamentos?.config?.tipos_s90 || {}
    res.json({ intencionais: marcacoes(c).map(a => ({ ref: refIntencional(c.chave, a.id), motivo: Object.hasOwn(T, a.tipo) ? T[a.tipo] : '', anuncio: a.escopo === 'anuncio' ? a.chave : '',
      estado: a.estado === 'vivo' ? 'valendo' : 'em_revisao', texto: textoIntencional(a).texto })) })
  }))
  rotasC.post('/c/api/intencionais/:ref/desfazer', sessao(true), limitar('decisao', 20, 60e3, true), trata((req, res) => {
    corpoJson(req)
    const c = req.s90.conta
    if (!alinhamentos?.config) throw erro('Indisponível agora. Tente mais tarde.', 503)
    const ref = String(req.params.ref), a = /^[0-9a-f]{16}$/.test(ref) ? marcacoes(c).find(x => refIntencional(c.chave, x.id) === ref) : null
    if (!a) throw erro('Marcação não encontrada.', 404)
    alinhamentos.encerrar({ cliente: c.chave, id: a.id, origem: 's90_cliente' })
    lg('info', `Sprint 90: marcação de intencional desfeita pelo cliente (conta ${c.id})`)
    res.json({ ok: true })
  }))
  rotasC.post('/c/api/aceite', sessao(true), trata((req, res) => {
    const b = corpoJson(req)
    s90.registrarAceite(req.s90.conta.id, { aceite: b.aceite, consentimento: b.consentimento, ip: ipDe(req), ua: String(req.headers['user-agent'] || '') })
    res.json({ ok: true })
  }))
  rotasC.post('/c/api/acesso/gerar', sessao(true), limitar('guardar', 5, 3600e3, true), trata((req, res) => {
    corpoJson(req)
    const a = s90.gerarAcesso(req.s90.conta.id, { origem: 'painel', ip: ipDe(req) })
    res.json({ url: `${noHostS90(req) ? `https://${hostS90()}` : `http://${req.headers.host}`}/c/acesso/${a.token}`, expira_em: a.expira_em })
  }))
  rotasC.post('/c/api/dados/excluir', sessao(true), trata(async (req, res) => {
    if (corpoJson(req).confirmar !== true) throw erro('Confirme a exclusão.')
    const r1 = await s90.excluir(req.s90.conta.id, { por: 'cliente' })
    lg('info', `Sprint 90: exclusão pedida pelo titular (conta ${req.s90.conta.id})${r1.pendente ? ' — agendada (assinatura no Mercado Pago)' : r1.revogado ? ' — autorização revogada no ML' : ''}`)
    if (!r1.pendente) cookie(req, res, '', 0)
    res.json({ ok: r1.ok, pendente: r1.pendente, revogado: r1.revogado, mensagem: r1.pendente
      ? 'Recebemos o seu pedido. A exclusão termina assim que a assinatura for cancelada no Mercado Pago.'
      : `Apagamos os seus dados. ${r1.revogado ? 'A autorização no Mercado Livre foi revogada.' : 'Para remover também a autorização, acesse as configurações de segurança da sua conta do Mercado Livre (aplicativos autorizados).'} Faturas, pagamentos e o registro do aceite ficam guardados pelo prazo fiscal.` })
  }))
  // erro inesperado numa página do painel: página genérica (nunca stack); da API: o handler global (500 'erro interno')
  rotasC.use((err, req, res, next) => /^\/c\/api\//.test(req.path) ? next(err) : (lg('erro', `Sprint 90 ${req.method} ${req.path}: ${String(err?.message || '').slice(0, 120)}`), res.status(500).send(P.paginaErro('Algo deu errado', 'Tente de novo em alguns minutos.', { nonce: P.cabecalhos(res) }))))
  rotasC.use((req, res) => res.status(404).send(P.paginaErro('Página não encontrada', 'Confira o endereço.', { nonce: P.cabecalhos(res) })))

  // ═════════ rotas internas da equipe (loopback) ═════════
  const rotasInternas = Router()
  const porValido = b => { const p = validarPor(texto(b.por)); if (!p) throw erro('informe "por": nome de um líder ou consultor', 403); return p }
  const contaDaRota = id => { const c = /^[0-9a-f]{8}$/.test(id) ? s90.contaPorId(id) : null; if (!c || c.estado === 'excluido') throw erro('conta não encontrada', 404); return c }
  const linhaInterna = c => ({ id: c.id, chave: c.chave, loja: c.loja, nome: c.nome, email: c.email, telefone: c.telefone, plano: c.plano, preco_centavos: c.preco_centavos, comissao_pct: c.comissao_pct, piloto: c.piloto === 1,
    estado: c.estado, aceite_em: c.aceite_em, termos_versao: c.termos_versao, inicio_em: c.inicio_em, preco_travado_ate: c.preco_travado_ate, criado_em: c.criado_em, conexao: projecaoConexao(leitura.conexao(c.chave)) })
  rotasInternas.get('/api/sprint90/contas', trata((req, res) => {
    const t = s90.termos()
    res.json({ ligado: true, host: hostS90(), termos: { existe: !!t, publicados: !!t && !t.rascunho, rascunho: !!t?.rascunho, versao: t?.versao || '' }, vagas: s90.vagas(), contas: s90.listar().map(linhaInterna) })
  }))
  // criar conta: prévia por padrão; só grava com confirmar === true (string "true" = prévia) e "por" de líder/consultor.
  // piloto === true marca conta de piloto/demonstração: a única que nasce (e aceita) com os termos ainda em RASCUNHO
  rotasInternas.post('/api/sprint90/contas', trata((req, res) => {
    const b = corpoJson(req), por = porValido(b)
    if (b.confirmar !== true) return res.json({ previa: true, conta: s90.previa(b, { piloto: b.piloto }) })
    const c = s90.cadastrar(b, { por, piloto: b.piloto })
    lg('info', `Sprint 90: conta ${c.id} criada pela equipe (${por})${c.piloto ? ' — piloto/demonstração' : ''}`)
    res.json({ previa: false, conta: linhaInterna(c) })
  }))
  // link de acesso para a equipe ENTREGAR (15 min, uso único; mostrado uma vez; invalida os links anteriores ainda não usados). E-mail: pendente (canal só no painel).
  // Sem "url_local": testar o link no computador da equipe gastaria o uso único do cliente (e abriria a sessão dele no navegador da equipe).
  rotasInternas.post('/api/sprint90/contas/:id/acesso', trata((req, res) => {
    const b = corpoJson(req), por = porValido(b), c = contaDaRota(req.params.id)
    const a = s90.gerarAcesso(c.id, { origem: 'equipe', por })
    res.json({ url: `https://${hostS90()}/c/acesso/${a.token}`, expira_em: a.expira_em, email: enviarEmail(), nota: 'Entregue o link ao cliente por um canal seu: vale 15 minutos, abre o painel uma vez e invalida os links anteriores. Não abra para testar: isso gasta o acesso do cliente.' })
  }))
  // derruba todas as sessões e links ainda não usados da conta (cookie roubado, ex-funcionário do cliente, computador compartilhado)
  rotasInternas.post('/api/sprint90/contas/:id/revogar', trata((req, res) => {
    const b = corpoJson(req), por = porValido(b), c = contaDaRota(req.params.id)
    const r1 = s90.revogarAcessos(c.id, { por })
    lg('info', `Sprint 90: acessos da conta ${c.id} derrubados pela equipe (${por}): ${r1.sessoes} sessão(ões), ${r1.links} link(s)`)
    res.json({ ok: true, ...r1 })
  }))
  rotasInternas.post('/api/sprint90/contas/:id/estado', trata((req, res) => {
    const b = corpoJson(req), por = porValido(b), c = contaDaRota(req.params.id)
    if (!texto(b.motivo)) throw erro('informe "motivo"')
    const n = s90.mudarEstado(c.id, texto(b.estado), { por, motivo: b.motivo })
    lg('info', `Sprint 90: conta ${c.id} ${c.estado} → ${n.estado} (${por})`)
    res.json({ conta: linhaInterna(n) })
  }))
  return r
}

// ── instância real ──
// config inválida (vírgula sobrando…) desliga SÓ o Sprint 90: o import nunca derruba o servidor (painel interno, callback do ML, funil comercial, coleta)
export function lerConfigS90(arquivo = join(ROOT, 'config', 'sprint90.json')) {
  try { const c = JSON.parse(readFileSync(arquivo, 'utf8')); return c && typeof c === 'object' && !Array.isArray(c) ? c : null } catch { return null }
}
const cfgS90 = lerConfigS90()
if (!cfgS90 && env.SPRINT90_PUBLIC_HOST) log('erro', 'config/sprint90.json inválido ou ausente: Sprint 90 desligado até o arquivo ser corrigido (e o servidor reiniciado pelo fluxo combinado)')
// host público efetivo ('' = Sprint 90 desligado): a env E uma config válida. server.js (callback do ML, timers) pergunta só a ele
export const hostS90Publico = () => cfgS90 ? env.SPRINT90_PUBLIC_HOST : ''
export const s90 = criarS90({ handle: db, cfg: cfgS90 || {}, agora, hoje: hojeLocal, notificar, log, termos: () => cfgS90 ? lerTermos(cfgS90) : null, appPrincipal: () => env.MELI_CLIENT_ID,
  conexao: { status: statusConexao, revogar: revogarConexao, desconectar, purgarPendentes: purgarPendentesDe }, dirBackup: join(ROOT, 'data', 'backups') })

// fim do OAuth da conta S90 (chamado por /c/conectar/fim, JÁ com a sessão dona do state conferida): troca o código, D17 na transação, grava;
// aviso interno + 1ª leitura e plano por anúncio em segundo plano (SEM gerarPlanosEscopo: ele chama o Notion e abortaria antes do plano)
async function concluirConexaoML({ chave, code, state, vendedor = '' }) {
  const rotulo = `Sprint 90 ${chave.slice(-8)}`                                     // log: só o id (sem loja nem nickname)
  try {
    const tok = await trocarCodigo(code, state, false)
    const perfil = await buscarPerfil(tok.access_token, tok.user_id)
    const jaTinha = !!statusConexao(chave)                                          // reconexão ≠ conta nova (o aviso diz qual dos dois)
    // a exclusão/pausa pode ter ocorrido durante os awaits: recheca e grava na MESMA transação (nada de conexão órfã)
    let duplicado = null, outroVendedor = false
    const gravou = db.transaction(() => {
      if (!s90.podeConectar(chave)) return false
      if (vendedor && String(tok.user_id) !== String(vendedor)) { outroVendedor = true; return false }   // "Guardar meu acesso" só reconecta o vendedor já ligado
      duplicado = s90.aoConectar(chave, tok.user_id, tok.app_id)
      if (duplicado.bloquear) return false
      salvarConexao(chave, tok, perfil); return true
    })()
    if (duplicado?.bloquear) {
      // só revoga se nenhuma outra conexão do mesmo vendedor usa o mesmo app (o ML revoga o app inteiro para o vendedor)
      if (duplicado.revogar) revogarAutorizacao(tok.access_token, tok.user_id, tok.app_id).catch(() => {})
      log('aviso', `Mercado Livre: ${rotulo} bloqueado — vendedor já conectado em outro cadastro (nada gravado)`)
      return { status: 409, msg: 'Esta conta do Mercado Livre já está conectada em outro cadastro. Fale com a Place2u.' }
    }
    if (!gravou) {
      if (!outraConexaoDoApp(tok.user_id, tok.app_id)) revogarAutorizacao(tok.access_token, tok.user_id, tok.app_id).catch(() => {})   // melhor esforço: não deixa a autorização viva no ML
      if (outroVendedor) { log('aviso', `Mercado Livre: ${rotulo} — acesso guardado tentou ligar OUTRO vendedor (nada gravado)`); return { status: 409, msg: MSG.reconecta } }
      log('info', `Mercado Livre: ${rotulo} excluído durante a conexão — nada gravado`)
      return { status: 410, msg: 'Este cadastro não está ativo para conectar. Volte ao painel.' }
    }
    log('info', `Mercado Livre conectado — ${rotulo}`)
    const conta = s90.contaPorChave(chave)
    try { notificar({ tipo: jaTinha ? 's90_reconectado' : 's90_conectado', nivel: 'sucesso', titulo: `Sprint 90: ${jaTinha ? 'reconexão' : 'conta conectada'} — ${conta?.loja || rotulo}`, corpo: `Conta ${perfil.nickname || tok.user_id} autorizou o Mercado Livre. Primeira leitura e plano por anúncio em andamento.`, cliente: chave, link: '/integracoes' }) } catch { /* aviso é melhor esforço */ }
    try { if (conta) s90.auditar(conta.id, 'conexao', { detalhe: { reconexao: jaTinha } }) } catch { /* registro é melhor esforço */ }
    setImmediate(async () => {
      try {
        const { coletarCliente } = await import('./lib/meli-serie.js')
        const { gerarPlanoConta } = await import('./lib/plano-anuncios.js')
        const { capturarAcompanhamento } = await import('./lib/acompanhamento.js')
        await coletarCliente(chave)
        try { capturarAcompanhamento(chave) } catch (e) { log('aviso', `acompanhamento inicial (${rotulo}): ${e.message}`) }
        const pc = gerarPlanoConta(chave)                                            // semConsultor: as regras que exigem consultor saem na geração (plano-anuncios.js)
        log('info', `Sprint 90: primeiro plano por anúncio gerado — ${rotulo} (${pc.disponivel ? pc.acoes.length + ' ações' : 'sem dados ainda'})`)
      } catch (e) {
        log('erro', `Sprint 90: primeira leitura (${rotulo}): ${e.message}`)
        try { notificar({ tipo: 'coleta_falhou', nivel: 'erro', titulo: `Sprint 90: conectou, mas a primeira leitura falhou — ${conta?.loja || rotulo}`, corpo: 'A conexão está ativa; a coleta diária tenta de novo de madrugada.', cliente: chave, link: '/integracoes', dedupeMin: 60 }) } catch { /* sem aviso */ }
      }
    })
    return { ok: true }
  } catch (e) {
    log('erro', `Mercado Livre callback (${rotulo}): ${e.message}`)
    return { status: 500, msg: 'Não foi possível concluir a conexão. Tente novamente em alguns minutos.' }
  }
}

export const rotasSprint90 = criarRotasSprint90({
  s90, log, hostS90: hostS90Publico, concluirConexao: concluirConexaoML,
  leitura: {
    conexao: statusConexao,
    cobertura: chave => db.prepare('SELECT COUNT(*) dias, MAX(dia) ate FROM meli_coleta_dia WHERE cliente = ?').get(chave),
    diagnostico: async chave => (await import('./lib/diagnostico-conta.js')).diagnosticarConta(chave),     // só banco (nunca chama o ML numa rota pública)
    nomesInternos: async chave => (await import('./lib/relatorio-brief-real.js')).nomesInternos(chave),
  },
  conectarLink: chave => linkConectar(chave, 10 / 1440), infraPronta: infraMeliPronta, validarPor: validarLiderOuConsultor,   // 10 min (A1: o link é amarrado à sessão)
  alinhamentos: alinhamentosReal(),
  landing: () => { const f = join(ROOT, 'assets', 'sprint90', 'landing.html'); return existsSync(f) ? f : '' },
})
