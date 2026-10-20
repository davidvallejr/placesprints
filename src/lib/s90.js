// Place Sprint 90 — núcleo da CONTA (fase F1): cadastro pela equipe, sessão, link de acesso de uso único, aceite dos termos, estados, exclusão LGPD,
// expurgo e ledger (s90_evento). Fábrica com tudo injetado (banco, relógio, avisos, conexão do ML, Mercado Pago, termos): o teste roda em banco em memória, sem rede.
// Nada aqui decide prioridade: o painel do cliente é PROJEÇÃO do que o motor já produziu (acoes_plano, fila 'esta_semana'); quem decide continua sendo o Algoritmo.
// Segurança: token de 128 bits só como SHA-256 no banco; link de uso único por UPDATE condicional; sessão de 30 dias deslizante; SQL parametrizado; erros com texto fixo.
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, chmodSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { chaveS90, ehChaveS90 } from './s90-chave.js'
import { limpa } from './comercial.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const sha = s => createHash('sha256').update(String(s)).digest('hex')
const novoToken = () => randomBytes(16).toString('base64url')          // 22 caracteres, 128 bits
const HOST_LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i
export const TOKEN_S90 = /^[A-Za-z0-9_-]{22}$/
const texto = v => typeof v === 'string' ? v : ''                       // objeto/array nunca vira "[object Object]"
const json = s => { try { return JSON.parse(s || '{}') } catch { return {} } }
const maisMeses = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }

// dias 1–30, 31–60, 61–90 (mesmos nomes da landing). A fase é só o calendário: a PROVA de cada fase é medida, nunca dada por concluída pela data.
export const FASES = [[30, 'Estruturação'], [60, 'Evolução'], [90, 'Consolidação']]
// mudanças manuais (rota interna da equipe). Pagamento, inadimplência e exclusão têm caminhos próprios.
const TRANSICOES = { pendente_pagamento: ['ativo', 'cancelado'], ativo: ['pausado', 'cancelado'], pausado: ['ativo', 'cancelado'], inadimplente: ['ativo', 'pausado', 'cancelado'] }
// estados em que o cliente ainda entra no painel (cancelado = só leitura até o expurgo)
const ESTADOS_SESSAO = new Set(['pendente_pagamento', 'ativo', 'inadimplente', 'pausado', 'cancelado'])

// deps: handle (better-sqlite3), cfg (config/sprint90.json), agora() ISO, hoje() AAAA-MM-DD, notificar, log,
//       termos() → { versao, hash, texto, rascunho } | null (sem o arquivo de termos: cadastro e aceite bloqueados de propósito; arquivo que começa com
//       "# RASCUNHO" = termos NÃO publicados: só conta de piloto/demonstração criada pela equipe (piloto = 1) cadastra e aceita),
//       conexao { status(chave), revogar(chave) async → bool, desconectar(chave, motivo), purgarPendentes(chave) },
//       mp (F3) { atualizarPreapproval(id, { status }) } | null, dirBackup (ledger diário; '' = não grava),
//       appPrincipal() → MELI_CLIENT_ID (conexão antiga tem app_id '' = app principal: comparar sempre o app EFETIVO)
export function criarS90({ handle, cfg, agora = () => new Date().toISOString(), hoje = () => agora().slice(0, 10), notificar = () => {}, log = () => {},
  termos = () => null, conexao = {}, mp = null, dirBackup = '', appPrincipal = () => '' }) {
  const { status: statusConexao = () => null, revogar = async () => false, desconectar = () => {}, purgarPendentes = () => 0 } = conexao
  const daqui = min => new Date(Date.parse(agora()) + min * 60e3).toISOString()
  const avisar = n => { try { notificar({ link: '/integracoes', ...n }) } catch { /* aviso é melhor esforço */ } }
  const ha = dias => new Date(Date.parse(agora()) - dias * 86400e3).toISOString()
  const existe = t => !!handle.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
  const app = id => String(id || '') || String(appPrincipal() || '')
  // aviso interno cita o cadastro sem dado do titular: S90/prospect só pelo id (o corpo do aviso de OUTRA conta não é alcançado pela exclusão)
  const rotuloCadastro = cli => ehChaveS90(cli) ? `Sprint 90 ${cli.slice(-8)}` : /^\[Comercial\] /.test(cli) ? `prospect ${cli.slice(-8)}` : cli

  const contaPorId = id => handle.prepare('SELECT * FROM s90_conta WHERE id = ?').get(String(id || '')) || null
  const contaPorChave = chave => handle.prepare('SELECT * FROM s90_conta WHERE chave = ?').get(String(chave || '')) || null
  const listar = () => handle.prepare("SELECT * FROM s90_conta WHERE estado <> 'excluido' ORDER BY criado_em DESC").all()
  // os termos que valem para ESTA conta: rascunho só serve à conta de piloto/demonstração
  const termosPara = c => { const t = termos(); return t && (!t.rascunho || c?.piloto === 1) ? t : null }

  function auditar(contaId, tipo, { ref = '', detalhe = {}, ip = '' } = {}) {
    handle.prepare('INSERT INTO s90_evento (conta_id, tipo, ref, detalhe_json, ip, em) VALUES (?,?,?,?,?,?)')
      .run(String(contaId), String(tipo), String(ref).slice(0, 120), JSON.stringify(detalhe).slice(0, 2000), String(ip).slice(0, 64), agora())
  }

  // ── turma fundadora: vagas = ativos/pausados/inadimplentes + pendentes de pagamento com menos de 24 h ──
  const ocupadas = (exceto = '') => handle.prepare(`SELECT COUNT(*) n FROM s90_conta WHERE id <> ? AND (estado IN ('ativo','pausado','inadimplente')
    OR (estado = 'pendente_pagamento' AND criado_em >= ?))`).get(String(exceto), new Date(Date.parse(agora()) - 24 * 3600e3).toISOString()).n
  const vagas = () => { const total = cfg.turma_fundadora?.vagas ?? 0, o = ocupadas(); return { total, ocupadas: o, restantes: Math.max(0, total - o) } }

  function normalizar(d = {}) {
    const nome = limpa(texto(d.nome), 120), loja = limpa(texto(d.loja), 80).replace(/·/g, '-'), email = limpa(texto(d.email), 160).toLowerCase()
    if (!nome || !loja) throw erro('informe o nome do responsável e o nome da loja')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw erro('e-mail inválido')
    const plano = texto(d.plano), p = ['fixo', 'crescimento'].includes(plano) ? cfg.planos?.[plano] : null
    if (!p || !Number.isInteger(p.centavos)) throw erro('plano inválido (fixo ou crescimento)')
    return { nome, email, telefone: limpa(texto(d.telefone), 40), loja, faixa: limpa(texto(d.faixa), 60), plano, preco_centavos: p.centavos, comissao_pct: p.comissao_pct || 0 }
  }
  // prévia da conta que a equipe vai criar: nada é gravado
  const previa = (d, { piloto = false } = {}) => { const t = termos(); return { ...normalizar(d), piloto: piloto === true, vagas: vagas(), termos_publicados: !!t && !t.rascunho, termos_rascunho: !!t?.rascunho } }

  // piloto === true (estrito): conta de piloto/demonstração, a única que pode nascer com os termos ainda em RASCUNHO
  function cadastrar(d, { por = '', ip = '', piloto = false } = {}) {
    const t = termos()
    if (!t || (t.rascunho && piloto !== true)) throw erro('Termos do Place Sprint 90 ainda não publicados: cadastro bloqueado.', 503)
    const n = normalizar(d)
    return handle.transaction(() => {
      if (ocupadas() >= (cfg.turma_fundadora?.vagas ?? 0)) throw erro('Turma completa: não há vagas.', 409)
      const id = randomBytes(4).toString('hex'), em = agora()
      handle.prepare(`INSERT INTO s90_conta (id, chave, nome, email, telefone, loja, faixa_faturamento, plano, preco_centavos, comissao_pct, estado, piloto, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,'pendente_pagamento',?,?,?)`).run(id, chaveS90(n.loja, id), n.nome, n.email, n.telefone, n.loja, n.faixa, n.plano, n.preco_centavos, n.comissao_pct, piloto === true ? 1 : 0, em, em)
      auditar(id, 'estado', { detalhe: { de: '', para: 'pendente_pagamento', por, origem: 'equipe', piloto: piloto === true }, ip })
      return contaPorId(id)
    }).immediate()
  }

  // ── sessão (cookie s90) ──
  function abrirSessao(contaId, origem = '') {
    const token = novoToken(), t = agora()
    handle.prepare('INSERT INTO s90_sessao (token_hash, conta_id, criado_em, expira_em, ultimo_uso_em, origem) VALUES (?,?,?,?,?,?)').run(sha(token), String(contaId), t, daqui(cfg.sessao_dias * 1440), t, String(origem))
    return { token, max_age_s: cfg.sessao_dias * 86400 }
  }
  // o link que abriu a sessão: 'painel' = "Guardar meu acesso" (uma sessão o gera e pode repassá-lo a outra pessoa) — só reconecta o vendedor já ligado
  const origemDaSessao = token => TOKEN_S90.test(String(token || '')) ? handle.prepare('SELECT origem FROM s90_sessao WHERE token_hash = ?').get(sha(token))?.origem || '' : ''
  function sessaoDe(token) {
    if (!TOKEN_S90.test(String(token || ''))) return null
    const h = sha(token), t = agora()
    // 30 dias deslizantes, mas com TETO absoluto desde o login (sessao_max_dias, padrão 90): cookie roubado não vive para sempre
    const s = handle.prepare("SELECT conta_id FROM s90_sessao WHERE token_hash = ? AND revogada_em = '' AND expira_em > ? AND criado_em > ?").get(h, t, ha(cfg.sessao_max_dias ?? 90))
    const c = s ? contaPorId(s.conta_id) : null
    if (!c || !ESTADOS_SESSAO.has(c.estado)) return null
    handle.prepare('UPDATE s90_sessao SET expira_em = ?, ultimo_uso_em = ? WHERE token_hash = ?').run(daqui(cfg.sessao_dias * 1440), t, h)   // 30 dias deslizantes
    return c
  }
  const encerrarSessao = token => TOKEN_S90.test(String(token || ''))
    ? handle.prepare("UPDATE s90_sessao SET revogada_em = ? WHERE token_hash = ? AND revogada_em = ''").run(agora(), sha(token)).changes : 0
  // "sair de todos os aparelhos" (cliente) e revogação pela equipe: derruba TODAS as sessões e todos os links ainda não usados da conta
  function revogarAcessos(contaId, { por = '', ip = '' } = {}) {
    const t = agora(), id = String(contaId || '')
    const r = handle.transaction(() => ({
      sessoes: handle.prepare("UPDATE s90_sessao SET revogada_em = ? WHERE conta_id = ? AND revogada_em = ''").run(t, id).changes,
      links: handle.prepare("UPDATE s90_acesso SET usado_em = ? WHERE conta_id = ? AND usado_em = ''").run(t, id).changes,
    }))()
    if (contaPorId(id)) auditar(id, 'revogacao', { detalhe: { por, ...r }, ip })
    return r
  }

  // ── link de acesso de USO ÚNICO (equipe: 15 min; painel/retorno: 30 dias) ──
  function gerarAcesso(contaId, { origem = 'equipe', por = '', ip = '' } = {}) {
    if (!['retorno', 'painel', 'equipe'].includes(origem)) throw erro('origem inválida')
    const c = contaPorId(contaId)
    if (!c || !ESTADOS_SESSAO.has(c.estado)) throw erro('conta não encontrada', 404)
    const token = novoToken(), expira = daqui(cfg.acesso_min[origem])
    handle.transaction(() => {
      handle.prepare("UPDATE s90_acesso SET usado_em = ? WHERE conta_id = ? AND usado_em = ''").run(agora(), c.id)   // link novo invalida os anteriores ainda não usados
      handle.prepare('INSERT INTO s90_acesso (token_hash, conta_id, origem, criado_em, expira_em) VALUES (?,?,?,?,?)').run(sha(token), c.id, origem, agora(), expira)
    })()
    auditar(c.id, 'novo_link', { ref: origem, detalhe: { por, expira_em: expira }, ip })
    return { token, expira_em: expira }
  }
  // o 2º uso, o link vencido e o inexistente dão a MESMA resposta (null): nada de oráculo
  function consumirAcesso(token, { ip = '' } = {}) {
    if (!TOKEN_S90.test(String(token || ''))) return null
    const h = sha(token), t = agora()
    const r = handle.prepare('SELECT conta_id, origem FROM s90_acesso WHERE token_hash = ?').get(h)
    if (!r || !handle.prepare("UPDATE s90_acesso SET usado_em = ? WHERE token_hash = ? AND usado_em = '' AND expira_em > ?").run(t, h, t).changes) return null
    const c = contaPorId(r.conta_id)
    if (!c || !ESTADOS_SESSAO.has(c.estado)) return null
    auditar(c.id, 'login', { ip })
    return { conta: c, ...abrirSessao(c.id, r.origem) }
  }

  // ── aceite dos termos + consentimento LGPD (checkbox próprio), registrados pelo PRÓPRIO cliente no painel ──
  const aceitePendente = c => { const t = termosPara(c); return !t || c.termos_versao !== t.versao || c.termos_hash !== t.hash }   // termo novo = aceite de novo
  function registrarAceite(contaId, { aceite, consentimento, ip = '', ua = '' } = {}) {
    if (aceite !== true || consentimento !== true) throw erro('Para continuar, aceite os termos e autorize o uso dos dados.')
    const c = contaPorId(contaId)
    if (!c || !ESTADOS_SESSAO.has(c.estado)) throw erro('conta não encontrada', 404)
    const t = termosPara(c)
    if (!t) throw erro('Termos em preparação: tente mais tarde.', 503)
    if (!aceitePendente(c)) return c
    const em = agora(), cv = `lgpd-${t.versao}`
    handle.transaction(() => {
      handle.prepare(`UPDATE s90_conta SET termos_versao = ?, termos_hash = ?, aceite_em = ?, aceite_ip = ?, aceite_ua = ?, consentimento_versao = ?, consentimento_em = ?, atualizado_em = ? WHERE id = ?`)
        .run(t.versao, t.hash, em, String(ip).slice(0, 64), String(ua).slice(0, 300), cv, em, em, c.id)
      auditar(c.id, 'aceite', { ref: t.versao, detalhe: { versao: t.versao, hash: t.hash, rascunho: !!t.rascunho, email: c.email, plano: c.plano, preco_centavos: c.preco_centavos, ua: String(ua).slice(0, 300) }, ip })
      auditar(c.id, 'consentimento', { ref: cv, ip })
    })()
    return contaPorId(c.id)
  }

  // ── estados (rota interna da equipe; no piloto sem Mercado Pago, "ativo" marca o dia 1 dos 90) ──
  function mudarEstado(id, estado, { por = '', motivo = '', ip = '' } = {}) {
    return handle.transaction(() => {
      const c = contaPorId(id)
      if (!c) throw erro('conta não encontrada', 404)
      if (!(TRANSICOES[c.estado] || []).includes(estado)) throw erro('mudança de estado não permitida', 409)
      if (estado === 'ativo' && c.estado === 'pendente_pagamento' && ocupadas(c.id) >= (cfg.turma_fundadora?.vagas ?? 0)) throw erro('Turma completa: não há vagas.', 409)
      const d = hoje(), t = agora(), inicio = estado === 'ativo' && !c.inicio_em ? d : c.inicio_em
      const travado = estado === 'ativo' && !c.preco_travado_ate ? maisMeses(inicio, cfg.turma_fundadora?.preco_travado_meses ?? 12) : c.preco_travado_ate
      handle.prepare('UPDATE s90_conta SET estado = ?, inicio_em = ?, preco_travado_ate = ?, cancelado_em = ?, atualizado_em = ? WHERE id = ?')
        .run(estado, inicio, travado, estado === 'cancelado' ? t : c.cancelado_em, t, c.id)
      auditar(c.id, 'estado', { detalhe: { de: c.estado, para: estado, por, motivo: limpa(texto(motivo), 200) }, ip })
      return contaPorId(c.id)
    }).immediate()
  }

  function diaFase(c) {
    if (!c?.inicio_em) return { dia: null, total: cfg.duracao_dias || 90, fase: null }
    const total = cfg.duracao_dias || 90
    const dia = Math.floor((Date.parse(hoje() + 'T12:00:00Z') - Date.parse(c.inicio_em + 'T12:00:00Z')) / 86400e3) + 1
    return { dia: dia >= 1 ? dia : null, total, fase: dia >= 1 ? (FASES.find(([ate]) => dia <= ate)?.[1] || 'Depois dos 90 dias') : null }
  }

  // ── conexão do Mercado Livre (callback do OAuth) ──
  const podeConectar = chave => { const c = contaPorChave(chave); return !!c && c.estado === 'ativo' && !aceitePendente(c) }
  // o link do OAuth (sig do HMAC) fica amarrado à SESSÃO que o pediu: só ela conclui a conexão, uma vez, em 10 min. Quem recebe o link de outra pessoa
  // e autoriza volta ao host S90 sem essa sessão → nada é trocado nem gravado (o link deixa de ser um bearer transferível)
  // volta: host LOOPBACK de quem pediu (a equipe testando em localhost) — o /meli/callback devolve code+state para lá; '' = host S90.
  // REPLACE: o link é determinístico por segundo (HMAC de chave+exp); a MESMA sessão pedindo de novo no mesmo segundo rearma o vínculo (outra sessão nunca o toca)
  function vincularConexao(contaId, sig, token, volta = '') {
    if (!sig || !TOKEN_S90.test(String(token || ''))) return false
    handle.prepare('INSERT OR REPLACE INTO s90_oauth (sig_hash, sessao_hash, conta_id, criado_em, expira_em, volta) VALUES (?,?,?,?,?,?)').run(sha(sig), sha(token), String(contaId), agora(), daqui(10), HOST_LOOPBACK.test(String(volta)) ? String(volta).toLowerCase() : '')
    return true
  }
  // nunca um host qualquer: só loopback (o redirect do callback não vira redirecionamento aberto)
  const voltaDaConexao = sig => { const v = sig ? handle.prepare("SELECT volta FROM s90_oauth WHERE sig_hash = ? AND usado_em = '' AND expira_em > ? AND volta <> '' LIMIT 1").get(sha(sig), agora())?.volta || '' : ''; return HOST_LOOPBACK.test(v) ? v : '' }
  const consumirConexao = (contaId, sig, token) => !!sig && TOKEN_S90.test(String(token || '')) && handle.prepare(
    "UPDATE s90_oauth SET usado_em = ? WHERE sig_hash = ? AND sessao_hash = ? AND conta_id = ? AND usado_em = '' AND expira_em > ?").run(agora(), sha(sig), sha(token), String(contaId), agora()).changes === 1
  // D17: o mesmo vendedor em dois cadastros é bloqueado (evita cobrança em dobro e a trava do revogarConexao). O ML revoga o APP inteiro para aquele
  // vendedor: se outra conexão do mesmo vendedor usa o mesmo app, revogar derrubaria a outra — então o token novo só é descartado (nunca gravado).
  // App comparado pelo EFETIVO ('' = principal): conexão antiga da central com app_id '' é o MESMO app, e revogar a derrubaria.
  // Prospect do Comercial ('[Comercial] …') não é cadastro pago: não bloqueia o S90 do mesmo vendedor (revogar um não derruba o outro: revogarConexao vê a outra linha).
  function aoConectar(chave, meliUserId, appId = '') {
    const outras = handle.prepare("SELECT cliente, app_id FROM meli_contas WHERE meli_user_id = ? AND cliente <> ? AND cliente NOT LIKE '[Comercial] %'").all(meliUserId, String(chave))
    if (!outras.length) return { bloquear: false, revogar: false }
    const revogarNovo = !outras.some(o => app(o.app_id) === app(appId))
    const c = contaPorChave(chave)
    if (c) auditar(c.id, 'conexao', { detalhe: { bloqueada: 'vendedor já conectado em outro cadastro', token_revogado: revogarNovo } })
    avisar({ tipo: 's90_seller_duplicado', nivel: 'alerta', titulo: 'Sprint 90: conta do Mercado Livre já conectada em outro cadastro', cliente: String(chave),
      corpo: `${rotuloCadastro(String(chave))} tentou conectar um vendedor que já está ligado a: ${outras.map(o => rotuloCadastro(o.cliente)).join(', ')}. Nada foi gravado${revogarNovo ? ' e a autorização nova foi revogada' : ' (a autorização nova não foi revogada para não derrubar a outra conexão)'}. Resolva com o cliente antes de cobrar.` })
    return { bloquear: true, revogar: revogarNovo }
  }

  // prioridades da semana = o corte do PRÓPRIO motor (dados.fila 'esta_semana'); o painel nunca re-seleciona nem reordena por conta própria
  // id e item_id são INTERNOS (a rota do "É intencional" acha a ação por eles; a projeção ao cliente, s90-texto.acaoParaCliente, tem lista fechada e não os leva — D11)
  const acoesDaSemana = chave => handle.prepare(`SELECT id, item_id, titulo, regra, status, prazo, score, dados_json, previsao_json FROM acoes_plano
    WHERE cliente = ? AND regra LIKE 'anuncio\\_%' ESCAPE '\\' AND status IN ('proposta','aprovada','distribuida') ORDER BY score DESC`).all(String(chave))
    .map(r => ({ id: r.id, item_id: r.item_id || '', titulo: r.titulo, regra: r.regra, status: r.status, prazo: r.prazo, dados: json(r.dados_json), previsao: json(r.previsao_json) }))
    .filter(a => a.dados.fila === 'esta_semana')

  // ── exclusão LGPD (ordem fixa, D16) ──
  // toda tabela do banco com a coluna `cliente` perde as linhas da chave (é o que garante "nada fica para trás" mesmo com tabela nova)
  // ponytail: varre sqlite_master a cada exclusão; dezenas de tabelas, poucas exclusões por dia
  const tabelasComCliente = () => handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all().map(r => r.name)
    .filter(t => handle.prepare(`PRAGMA table_info("${t.replace(/"/g, '""')}")`).all().some(col => col.name === 'cliente'))
  const ORFA = "substr(cliente, 1, 6) = '[S90] ' AND cliente NOT IN (SELECT chave FROM s90_conta)"
  // se: estados em que a exclusão ainda vale (o expurgo passa o estado pelo qual SELECIONOU a conta): o estado é conferido de novo depois de cada
  // await (Mercado Pago, ML) e dentro da transação — conta ativada no meio do caminho nunca é apagada
  async function excluir(id, { por = 'cliente', se = null } = {}) {
    const vale = c => !!c && c.estado !== 'excluido' && (!se || se.includes(c.estado))
    const nada = { ok: false, revogado: false, pendente: false }
    const c = contaPorId(id)
    if (!vale(c)) return nada
    // (1) assinatura no Mercado Pago ANTES de apagar: conta excluída nunca continua sendo cobrada
    if (c.mp_preapproval_id) {
      let cancelou = false
      try { cancelou = !!mp && !!(await mp.atualizarPreapproval(c.mp_preapproval_id, { status: 'cancelled' })) } catch { cancelou = false }
      if (!cancelou) {
        if (!vale(contaPorId(c.id))) return nada
        handle.prepare("UPDATE s90_conta SET estado = 'excluir_pendente', atualizado_em = ? WHERE id = ?").run(agora(), c.id)
        auditar(c.id, 'exclusao', { detalhe: { pendente: 'assinatura no Mercado Pago não cancelada', por } })
        avisar({ tipo: 's90_exclusao_pendente', nivel: 'erro', titulo: 'Sprint 90: exclusão agendada, assinatura não cancelada', corpo: `A conta ${c.id} pediu exclusão, mas a assinatura no Mercado Pago não foi cancelada. O expurgo diário tenta de novo; nada foi apagado ainda.`, cliente: c.chave, dedupeMin: 24 * 60 })
        return { ok: false, revogado: false, pendente: true }
      }
    }
    const abortou = () => { avisar({ tipo: 's90_exclusao_abortada', nivel: 'alerta', titulo: 'Sprint 90: exclusão abortada (a conta mudou de situação)', corpo: `A conta ${c.id} mudou de situação durante a exclusão (${por}); nada foi apagado. Confira a assinatura no Mercado Pago.`, cliente: c.chave }); return nada }
    if (!vale(contaPorId(c.id))) return abortou()
    // (2) revoga no ML (melhor esforço; a página só afirma o que o ML confirmou)
    const vendedor = statusConexao(c.chave)?.meli_user_id
    let revogado = false
    try { revogado = !!(await revogar(c.chave)) } catch { revogado = false }
    const apagou = handle.transaction(() => {
      if (!vale(contaPorId(c.id))) return false
      try { desconectar(c.chave, 'exclusão LGPD do titular') } catch { /* sem conexão: nada a desconectar */ }   // (3) S90 nunca vai para o arquivo
      if (existe('evidencias') && existe('tarefas')) handle.prepare('DELETE FROM evidencias WHERE tarefa_id IN (SELECT id FROM tarefas WHERE cliente = ?)').run(c.chave)   // FK evidencias → tarefas
      for (const t of tabelasComCliente()) handle.prepare(`DELETE FROM "${t.replace(/"/g, '""')}" WHERE cliente = ?`).run(c.chave)   // (4)
      // (4b) o que cita a chave fora da coluna cliente: cache da IA (escopo), aviso de OUTRA conta que a cite, webhooks crus do vendedor (se ninguém mais o usa)
      if (existe('ia_cache')) handle.prepare('DELETE FROM ia_cache WHERE instr(escopo, ?) > 0').run(c.chave)
      if (existe('notificacoes')) handle.prepare('DELETE FROM notificacoes WHERE instr(corpo, ?) > 0 OR instr(titulo, ?) > 0').run(c.chave, c.chave)
      if (vendedor != null && existe('meli_notificacoes')) handle.prepare('DELETE FROM meli_notificacoes WHERE user_id = ? AND NOT EXISTS (SELECT 1 FROM meli_contas WHERE CAST(meli_user_id AS TEXT) = ?)').run(String(vendedor), String(vendedor))
      handle.prepare('DELETE FROM s90_sessao WHERE conta_id = ?').run(c.id)                                                        // (5)
      handle.prepare('DELETE FROM s90_acesso WHERE conta_id = ?').run(c.id)
      handle.prepare('DELETE FROM s90_oauth WHERE conta_id = ?').run(c.id)
      handle.prepare("DELETE FROM s90_evento WHERE conta_id = ? AND tipo NOT IN ('aceite','consentimento')").run(c.id)            // o aceite fica: prova contratual (prazo fiscal)
      handle.prepare(`UPDATE s90_conta SET chave = ?, nome = '', email = '', telefone = '', loja = '', faixa_faturamento = '', mp_payer_email = '',
        estado = 'excluido', excluido_em = ?, atualizado_em = ? WHERE id = ?`).run(chaveS90('excluída', c.id), agora(), agora(), c.id)   // (6) anonimiza; faturas e pagamentos ficam
      handle.prepare('DELETE FROM sync_log WHERE instr(msg, ?) > 0').run(c.chave)                                                   // (7)
      return true
    })()
    if (!apagou) return abortou()
    try { purgarPendentes(c.chave) } catch { /* sem arquivo pendente */ }                                                         // (8)
    auditar(c.id, 'exclusao', { detalhe: { por, revogado } })
    return { ok: true, revogado, pendente: false }
  }

  // coleta em voo durante a exclusão grava DEPOIS dela com a chave antiga (que nenhuma conta aponta mais): a varredura diária apaga esses órfãos
  function varrerOrfaos() {
    return handle.transaction(() => {
      if (existe('evidencias') && existe('tarefas')) handle.prepare(`DELETE FROM evidencias WHERE tarefa_id IN (SELECT id FROM tarefas WHERE ${ORFA})`).run()
      let n = 0
      for (const t of tabelasComCliente()) n += handle.prepare(`DELETE FROM "${t.replace(/"/g, '""')}" WHERE ${ORFA}`).run().changes
      // sem coluna cliente: o cache da IA cita a chave no escopo (redigir() em voo durante a exclusão grava DEPOIS dela) — fica só o de conta viva
      if (existe('ia_cache')) n += handle.prepare("DELETE FROM ia_cache WHERE instr(escopo, '[S90] ') > 0 AND NOT EXISTS (SELECT 1 FROM s90_conta WHERE instr(ia_cache.escopo, s90_conta.chave) > 0)").run().changes
      return n
    })()
  }

  // ── expurgo diário (LGPD: necessidade). Cada conta isolada: uma exclusão que falha é avisada e não segura as outras, a purga de IP, os órfãos nem o prazo fiscal ──
  async function expurgar() {
    const r = { pendentes: 0, cancelados: 0, retentativas: 0, ips: 0, orfaos: 0, fiscais: 0, falhas: 0 }
    const falhou = (oque, e) => {
      r.falhas++
      try { log('erro', `Sprint 90: expurgo (${oque}) falhou: ${String(e?.message || e).replace(/["'`][\s\S]*$/, '…').slice(0, 120)}`) } catch { /* log é melhor esforço */ }
      avisar({ tipo: 's90_expurgo_falhou', nivel: 'erro', titulo: 'Sprint 90: expurgo diário com falha', corpo: `O expurgo não concluiu: ${oque}. As demais contas seguiram; o próximo ciclo tenta de novo.`, dedupeMin: 24 * 60 })
    }
    const corteIp = new Date(Date.parse(agora())); corteIp.setUTCMonth(corteIp.getUTCMonth() - (cfg.retencao?.eventos_ip_meses ?? 12))
    try { r.ips = handle.prepare("UPDATE s90_evento SET ip = '' WHERE ip <> '' AND em < ?").run(corteIp.toISOString()).changes } catch (e) { falhou('IPs de 12 meses', e) }
    const tenta = async (c, se) => { try { return (await excluir(c.id, { por: 'expurgo', se: [se] })).ok } catch (e) { falhou(`conta ${c.id}`, e); return false } }
    for (const c of handle.prepare("SELECT id, chave FROM s90_conta WHERE estado = 'pendente_pagamento' AND criado_em < ?").all(ha(cfg.expurgo_nao_pago_dias ?? 7)))
      if (!statusConexao(c.chave) && await tenta(c, 'pendente_pagamento')) r.pendentes++
    for (const c of handle.prepare("SELECT id FROM s90_conta WHERE estado = 'cancelado' AND cancelado_em <> '' AND cancelado_em < ?").all(ha(cfg.retencao?.pos_cancelamento_dias ?? 90)))
      if (await tenta(c, 'cancelado')) r.cancelados++
    for (const c of handle.prepare("SELECT id FROM s90_conta WHERE estado = 'excluir_pendente'").all())
      if (await tenta(c, 'excluir_pendente')) r.retentativas++
    try { r.orfaos = varrerOrfaos() } catch (e) { falhou('dados órfãos de contas excluídas', e) }
    // prazo fiscal (retencao.fiscal_anos): passado, some o que restou da conta excluída — aceite (e-mail, IP, UA), consentimento, faturas, pagamentos e a própria linha
    const corteFiscal = new Date(Date.parse(agora())); corteFiscal.setUTCFullYear(corteFiscal.getUTCFullYear() - (cfg.retencao?.fiscal_anos ?? 5))
    for (const c of handle.prepare("SELECT id FROM s90_conta WHERE estado = 'excluido' AND excluido_em <> '' AND excluido_em < ?").all(corteFiscal.toISOString())) {
      try {
        handle.transaction(() => {
          for (const t of ['s90_evento', 's90_fatura', 's90_pagamento', 's90_sessao', 's90_acesso', 's90_oauth']) handle.prepare(`DELETE FROM ${t} WHERE conta_id = ?`).run(c.id)
          handle.prepare('DELETE FROM s90_conta WHERE id = ?').run(c.id)
        })()
        r.fiscais++
      } catch (e) { falhou(`prazo fiscal da conta ${c.id}`, e) }
    }
    try { handle.prepare('DELETE FROM s90_oauth WHERE expira_em < ?').run(ha(1)) } catch (e) { falhou('vínculos de conexão vencidos', e) }
    return r
  }

  // ── ledger diário (contas, faturas, pagamentos, eventos/aceites): JSON 0600 em data/backups, 30 dias ──
  function exportarLedger(dia = hoje()) {
    if (!dirBackup) return { arquivo: null, contas: 0 }
    mkdirSync(dirBackup, { recursive: true })
    const tudo = t => handle.prepare(`SELECT * FROM ${t}`).all()
    const dados = { feito_em: agora(), contas: tudo('s90_conta'), faturas: tudo('s90_fatura'), pagamentos: tudo('s90_pagamento'), eventos: tudo('s90_evento') }
    const arquivo = join(dirBackup, `s90-${dia}.json`)
    writeFileSync(arquivo, JSON.stringify(dados), { mode: 0o600 })
    try { chmodSync(arquivo, 0o600) } catch { /* sistema sem chmod */ }
    for (const f of readdirSync(dirBackup).filter(x => /^s90-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().slice(0, -30)) try { unlinkSync(join(dirBackup, f)) } catch { /* já apagado */ }
    return { arquivo, contas: dados.contas.length }
  }

  return { cfg, termos, contaPorId, contaPorChave, listar, termosPara, auditar, vagas, previa, cadastrar, abrirSessao, sessaoDe, encerrarSessao, gerarAcesso, consumirAcesso,
    aceitePendente, registrarAceite, mudarEstado, diaFase, podeConectar, vincularConexao, voltaDaConexao, consumirConexao, origemDaSessao, aoConectar, acoesDaSemana, excluir, expurgar, exportarLedger, log,
    revogarAcessos }
}
