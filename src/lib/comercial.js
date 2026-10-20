// Comercial — diagnóstico de conta para PROSPECT (pré-venda), sem Notion e sem ser cliente:
// o closer cadastra nome + empresa, o sistema gera um LINK de conexão (o mesmo OAuth seguro
// do Mercado Livre já usado com clientes), o prospect autoriza leitura, e o sistema emite a
// análise diagnóstica + plano de ação da conta (funil, causalidade, ancoragem) para a conversa
// comercial. Regra de ouro intacta: sem conexão autorizada não existe número — o cadastro fica
// "aguardando conexão" e o link é o único caminho (nunca raspar, nunca inventar).
import { randomBytes } from 'node:crypto'
import { db, agora, hojeLocal } from './db.js'
import { env } from './env.js'
import { linkConectar } from './meli-link.js'
import { statusConexao, desconectar, revogarConexao } from './meli-contas.js'
import './notificacoes.js'                 // garante a tabela: o aviso do prospect (empresa, nome) é apagado junto com o cadastro (LGPD)
import { appComercialPronto } from './meli-oauth.js'
import { comComparativo, relatorioNegocio } from './meli-api.js'
import { causalidadeVendas, tendencia, serieDiaria } from './motor-ppc.js'

db.exec(`CREATE TABLE IF NOT EXISTS prospectos (
  id TEXT PRIMARY KEY,                  -- hex curto
  nome TEXT NOT NULL, empresa TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '',
  chave_conexao TEXT NOT NULL,          -- chave usada em conexoes ("[Comercial] Empresa · id")
  criado_em TEXT NOT NULL, criado_por TEXT NOT NULL DEFAULT ''
)`)

{ const cols = new Set(db.prepare('PRAGMA table_info(prospectos)').all().map(c => c.name))
  for (const [col, def] of [['token_publico', "''"], ['origem', "'closer'"], ['consentimento_em', "''"], ['consentimento_versao', "''"], ['quer_contato_em', "''"], ['utm_json', "''"], ['reputacao_json', "''"], ['formulario_json', "''"], ['expira_em', "''"]])
    if (!cols.has(col)) db.exec(`ALTER TABLE prospectos ADD COLUMN ${col} TEXT NOT NULL DEFAULT ${def}`) }

// ── campos extras do formulário público (16/10/2026) — os MESMOS da landing de referência lp.place2u.com.br/analise-diagnostica (docs/landing-referencia.md).
// Lista fechada: nada fora dela entra em formulario_json; selects/checkboxes validados contra as opções; só o painel e o relatório interno mostram.
export const CAMPOS_FORMULARIO = {
  nicho: { rotulo: 'Nicho em que atua', max: 120 },
  canais: { rotulo: 'Já vende nos marketplaces? Se sim, quais?', multi: true, opcoes: ['Mercado Livre', 'Amazon', 'Americanas marketplace', 'Shopee', 'Olist', 'Magazine Luiza', 'Outros', 'Ainda não vendo nos marketplaces'] },
  funcionarios: { rotulo: 'Quantos funcionários tem na sua empresa?', opcoes: ['1 a 5', '6 a 10', 'Mais de 10'] },
  faturamento: { rotulo: 'O faturamento mensal da sua empresa? (Loja Física e online)', opcoes: ['Até R$7.000', 'R$7mil a R$40mil', 'R$40mil a R$100mil', 'R$100mil a R$300mil', 'R$300mil a R$1 milhão', 'Acima de R$1 milhão'] },
}
// { ok:true, dados } ou { ok:false, erro } — a mensagem nunca ecoa o valor recebido
export function formularioLimpo(b = {}) {
  const dados = {}
  for (const [k, c] of Object.entries(CAMPOS_FORMULARIO)) {
    const falta = `Preencha «${c.rotulo}».`, invalido = `Escolha uma opção válida em «${c.rotulo}».`
    if (c.multi) {
      const v = [].concat(b[k] ?? []).map(x => limpa(x, 60))
      if (!v.length) return { ok: false, erro: falta }
      if (v.some(x => !c.opcoes.includes(x))) return { ok: false, erro: invalido }
      dados[k] = [...new Set(v)]
    } else {
      const v = limpa(b[k], c.max || 60)
      if (!v) return { ok: false, erro: falta }
      if (c.opcoes && !c.opcoes.includes(v)) return { ok: false, erro: invalido }
      dados[k] = v
    }
  }
  return { ok: true, dados }
}

// ── UTMs (origem da campanha, 16/10/2026): só a lista fechada, valores curtos; gravadas no cadastro e mostradas no painel ──
export const CHAVES_UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']
export function utmLimpa(obj) {
  const o = {}
  for (const k of CHAVES_UTM) { const v = String(obj?.[k] ?? '').replace(/[\u0000-\u001f\u007f<>"']/g, '').trim().slice(0, 120); if (v) o[k] = v }
  return o
}
// 3 cadastros em 24 h por e-mail: o 4º recebe 429 com mensagem fixa (teste do David criou 16 «fulano@…» num dia)
export const LIMITE_EMAIL_24H = 3
export const MSG_LIMITE_EMAIL = 'Este e-mail já gerou diagnósticos hoje. Abra o link que você recebeu ou tente novamente amanhã.'
export function cadastrosPorEmail24h(email) {
  const e = limpa(email, 160).toLowerCase()
  if (!e) return 0
  return db.prepare('SELECT COUNT(*) n FROM prospectos WHERE lower(email) = ? AND criado_em >= ?').get(e, new Date(Date.now() - 24 * 3600e3).toISOString()).n
}
// coleta de 90 d em andamento (callback do OAuth / «Ler os dados»): a página do lead diz «estamos lendo» em vez de «sem dados»
export const coletaEmCurso = new Set()

// v2: o termo deixou de prometer "somente leitura" quando o app principal (com escrita) é que autoriza; '-ro' = app comercial só leitura
export const versaoConsentimento = () => `lgpd-v2-2026-10${appComercialPronto() ? '-ro' : ''}`
export const infraMeliPronta = () => !!(env.MELI_CLIENT_ID && env.PUBLIC_BASE_URL)
export const ehChaveProspecto = chave => /^\[Comercial\] .+ · [0-9a-f]{8}$/.test(String(chave || ''))
const novoToken = () => randomBytes(16).toString('base64url')       // 22 chars, 128 bits — inadivinhável

export const limpa = (v, max) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function cadastrarProspecto({ nome, empresa, email = '', telefone = '', origem = 'closer', consentimento = false, utm = null, formulario = null }) {
  const n = limpa(nome, 120), e = limpa(empresa, 120)
  if (!n || !e) throw new Error('informe nome e empresa')
  if (origem === 'publico' && !consentimento) throw new Error('é preciso aceitar o uso dos dados para gerar o diagnóstico')
  const id = randomBytes(4).toString('hex')
  const chave = `[Comercial] ${e} · ${id}`                         // isola da base de clientes
  const u = utmLimpa(utm)
  const f = formulario ? formularioLimpo(formulario) : null                // só a lista fechada entra; inválido = erro (o POST já validou antes)
  if (f && !f.ok) throw new Error(f.erro)
  db.prepare(`INSERT INTO prospectos (id, nome, empresa, email, telefone, chave_conexao, criado_em, token_publico, origem, consentimento_em, consentimento_versao, utm_json, formulario_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, n, e, limpa(email, 160), limpa(telefone, 40), chave, agora(), novoToken(), origem === 'publico' ? 'publico' : 'closer',
      consentimento ? agora() : '', consentimento ? versaoConsentimento() : '', Object.keys(u).length ? JSON.stringify(u) : '', f ? JSON.stringify(f.dados) : '')
  return prospecto(id)
}
// reputação/nível lidos ao vivo (/users/{id}) no fim da coleta do prospect — guardados no cadastro (somem com ele, LGPD). Falha = motivo declarado, nunca zero.
export function gravarReputacao(id, rep) { db.prepare('UPDATE prospectos SET reputacao_json = ? WHERE id = ?').run(JSON.stringify(rep || {}), String(id)) }
export async function lerReputacaoProspecto(id, { api } = {}) {
  const p = prospecto(id)
  if (!p?.conectado) return null
  const { chamar } = await import('./meli-api.js'); const { idDoVendedor } = await import('./meli-contas.js')
  const uid = idDoVendedor(p.chave_conexao)
  const u = uid ? await (api || chamar)(p.chave_conexao, `/users/${uid}`, { permitirFalha: true }).catch(() => ({ _erro: true, status: 0 })) : { _erro: true, status: 0 }
  const rep = u?._erro ? { lida: false, motivo: (u.status === 401 || u.status === 403) ? 'permissao_do_app' : 'indisponivel', em: agora() }
    : (() => { const r = u.seller_reputation || {}, m = r.metrics || {}
      return { lida: true, em: agora(), nivel: r.level_id || null, medalha: r.power_seller_status || null, vendas_periodo: m.sales?.completed ?? null, periodo: m.sales?.period || null,
        taxa_claims: m.claims?.rate != null ? Math.round(m.claims.rate * 10000) / 100 : null, taxa_atraso: m.delayed_handling_time?.rate != null ? Math.round(m.delayed_handling_time.rate * 10000) / 100 : null,
        taxa_cancel: m.cancellations?.rate != null ? Math.round(m.cancellations.rate * 10000) / 100 : null } })()
  gravarReputacao(id, rep)
  return rep
}
const json = (s, padrao) => { try { return s ? JSON.parse(s) : padrao } catch { return padrao } }

// ── cadastros de TESTE (prévia + confirmar; só líder/dono — validado na rota): lead público SEM conexão cujo e-mail se repete ≥ 3× ou é de domínio/nome de teste ──
const RX_TESTE = /@(teste?\.com|exemplo\.com|example\.(com|org|net)|mailinator\.com|loja\.com)$|^(fulano|teste?|foo|bar|abc)[.@]/i
export function listarCadastrosTeste() {
  const vezes = {}
  for (const r of db.prepare("SELECT lower(email) e FROM prospectos WHERE origem = 'publico' AND email <> ''").all()) vezes[r.e] = (vezes[r.e] || 0) + 1
  return db.prepare(`SELECT id, nome, empresa, email, criado_em FROM prospectos WHERE origem = 'publico'
    AND chave_conexao NOT IN (SELECT cliente FROM meli_contas) ORDER BY criado_em DESC`).all()
    .filter(p => (p.email && vezes[p.email.toLowerCase()] >= 3) || RX_TESTE.test(p.email || '') || /^(fulano|teste)$/i.test(p.nome))
    .map(p => ({ ...p, motivo: p.email && vezes[p.email.toLowerCase()] >= 3 ? `e-mail repetido ${vezes[p.email.toLowerCase()]}×` : 'domínio ou nome de teste' }))
}
export function apagarCadastrosTeste({ confirmar = false, apenas = null } = {}) {   // apenas: Set de ids para restringir (testes/seleção)
  const lista = listarCadastrosTeste().filter(p => !apenas || apenas.has(p.id))
  if (confirmar !== true) return { previa: true, total: lista.length, cadastros: lista }
  db.transaction(() => { for (const p of lista) { db.prepare('DELETE FROM prospectos WHERE id = ?').run(p.id); apagarLogs(`· ${p.id}`) } })()
  return { ok: true, apagados: lista.length }
}

export const prospectoPorToken = token => {
  if (!/^[A-Za-z0-9_-]{22}$/.test(String(token || ''))) return null
  const r = db.prepare('SELECT id FROM prospectos WHERE token_publico = ?').get(String(token))
  return r ? prospecto(r.id) : null
}
// o lead pede contato na página do resultado → aparece 🔥 no painel interno (o número do comercial nunca é exposto)
export function marcarQuerContato(id) {
  return db.prepare("UPDATE prospectos SET quer_contato_em = ? WHERE id = ? AND quer_contato_em = ''").run(agora(), String(id)).changes
}
// relógio da página pública: grava expira_em na 1ª abertura conectada (= agora + minutos) e devolve a ISO gravada; nunca sobrescreve (o timer não ressuscita)
export function garantirExpiracao(id, minutos, agoraMs = Date.now()) {
  db.prepare("UPDATE prospectos SET expira_em = ? WHERE id = ? AND expira_em = ''").run(new Date(agoraMs + minutos * 60e3).toISOString(), String(id))
  return db.prepare('SELECT expira_em FROM prospectos WHERE id = ?').get(String(id))?.expira_em || ''
}

export const prospectoPorChave = chave => {
  const r = db.prepare('SELECT id FROM prospectos WHERE chave_conexao = ?').get(String(chave || ''))
  return r ? prospecto(r.id) : null
}
// lead público repetido (mesmo e-mail em 24h) reaproveita o cadastro — evita duplicata e spam
export function prospectoRecentePorEmail(email) {
  const e = limpa(email, 160).toLowerCase()
  if (!e) return null
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString()
  const r = db.prepare("SELECT id FROM prospectos WHERE lower(email) = ? AND origem = 'publico' AND criado_em >= ? ORDER BY criado_em DESC LIMIT 1").get(e, desde)
  return r ? prospecto(r.id) : null
}

export function prospecto(id) {
  const p = db.prepare('SELECT * FROM prospectos WHERE id = ?').get(String(id))
  if (!p) return null
  const conexao = statusConexao(p.chave_conexao)
  let link = null, link_erro = null
  if (infraMeliPronta()) { try { link = linkConectar(p.chave_conexao, p.origem === 'publico' ? 1 : 14) } catch (e) { link_erro = e.message } }
  else link_erro = 'Integração Mercado Livre não configurada (MELI_CLIENT_ID / PUBLIC_BASE_URL no .env) — o link nasce sozinho quando configurar.'
  return {
    ...p, conectado: !!conexao && !conexao.erro, nickname: conexao?.nickname || '',
    conexao_erro: conexao?.erro || null, link, link_erro,
    utm: json(p.utm_json, {}), reputacao: json(p.reputacao_json, null), formulario: json(p.formulario_json, null), coletando: coletaEmCurso.has(p.chave_conexao),
  }
}

export const listarProspectos = () => db.prepare('SELECT id FROM prospectos ORDER BY criado_em DESC').all().map(r => prospecto(r.id))

// log com a chave (empresa/nickname) sai junto com o prospect (LGPD); instr = sem curinga do LIKE
const apagarLogs = chave => db.prepare('DELETE FROM sync_log WHERE instr(msg, ?) > 0').run(chave)

let revogar = revogarConexao                                       // injetável: os testes nunca chamam o ML de verdade
export const _revogacao = f => { revogar = f || revogarConexao }

// 1º revoga no ML (melhor esforço, token guardado); depois apaga tudo numa transação — o callback do OAuth
// recheca o prospect na mesma transação em que grava, então não sobra conexão órfã.
export async function removerProspecto(id) {
  const p = db.prepare('SELECT chave_conexao FROM prospectos WHERE id = ?').get(String(id))
  if (!p) return { ok: false, revogado: false }
  let revogado = false
  try { revogado = !!(await revogar(p.chave_conexao)) } catch { /* sem conexão ou ML fora: apaga mesmo assim */ }
  db.transaction(() => {
    db.prepare('DELETE FROM prospectos WHERE id = ?').run(String(id))
    try { desconectar(p.chave_conexao) } catch { /* sem conexão: nada a apagar */ }   // tokens do prospect não ficam órfãos
    apagarLogs(p.chave_conexao)
    for (const t of ['notificacoes', 'promo_auditoria', 'tarefa_item', 'retro_ciclo']) { try { db.prepare(`DELETE FROM ${t} WHERE cliente = ?`).run(p.chave_conexao) } catch { /* tabela inexistente neste banco */ } }   // o que o próprio apagamento gerou (auditoria da limpeza) também sai
  })()
  return { ok: true, revogado }
}

// LGPD (necessidade): lead público que nunca conectou a conta não tem diagnóstico a entregar — some em 7 dias
export function expurgarLeadsAbandonados() {
  const limite = new Date(Date.now() - 7 * 86400e3).toISOString()
  const fora = db.prepare(`DELETE FROM prospectos WHERE origem = 'publico' AND criado_em < ?
    AND chave_conexao NOT IN (SELECT cliente FROM meli_contas) RETURNING chave_conexao`).all(limite)
  for (const r of fora) apagarLogs(r.chave_conexao)
  return fora.length
}

// varredura de segurança: conexão de prospect sem prospect (corrida, exclusão antiga) não fica guardando token
export const limparConexoesOrfas = () =>
  db.prepare("DELETE FROM meli_contas WHERE cliente LIKE '[Comercial] %' AND cliente NOT IN (SELECT chave_conexao FROM prospectos)").run().changes

// diagnóstico ao vivo da conta conectada (28d × 28d) — só com autorização do prospect
export async function diagnosticoProspecto(id, { hoje = hojeLocal() } = {}) {
  const p = prospecto(id)
  if (!p) throw new Error('prospect não encontrado')
  if (!p.conectado) return { prospecto: p, disponivel: false, motivo: p.conexao_erro || 'conta ainda não conectada — envie o link ao prospect' }
  const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  const janela = { de: addD(hoje, -28), ate: addD(hoje, -1) }
  let r
  try { r = await comComparativo(p.chave_conexao, janela, relatorioNegocio) }
  catch (e) {                                                      // token revogado/expirado: mensagem acionável (não "botão no Notion")
    return { prospecto: { id: p.id, nome: p.nome, empresa: p.empresa }, disponivel: false,
      motivo: 'Conexão perdida ou acesso revogado no Mercado Livre — gere e reenvie o link de conexão.' }
  }
  if (!r?.atual?.disponivel) return { prospecto: p, disponivel: false, motivo: 'conta conectada mas sem dados no período' }
  const causal = causalidadeVendas(r.atual, r.anterior)
  const ticket = x => x?.vendas ? Math.round(x.faturamento / x.vendas * 100) / 100 : null
  return {
    prospecto: { id: p.id, nome: p.nome, empresa: p.empresa },
    disponivel: true, janela_atual: janela, gerado_em: hoje,
    numeros: {
      atual: { ...r.atual, ticket: ticket(r.atual) }, anterior: r.anterior ? { ...r.anterior, ticket: ticket(r.anterior) } : null,
      parcial: r.atual.parcial || r.anterior?.parcial || false,
    },
    causalidade: causal,
    // sem período anterior não há comparação — dizer isso, nunca "sem ruptura" (que seria conclusão inventada)
    leitura: causal?.disponivel === false ? `Comparação indisponível: ${causal.motivo}.` : (causal?.leitura || 'Comparação indisponível.'),
    nota: 'Diagnóstico de leitura (nada é alterado na conta). Números da API oficial do Mercado Livre com a autorização do titular; comparação de períodos completos e equivalentes.',
  }
}
