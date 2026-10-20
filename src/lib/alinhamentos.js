// Registro de alinhamentos com o cliente (exceções intencionais; PLANO ATIVO 4, pontos do Adriano): "pausado de propósito", "ACOS 30% é visibilidade",
// "indisponível é boi de piranha", "descontinuado queimando estoque no Full", "o consultor já informou o seller". Camada ÚNICA, consumida por todos
// (plano por anúncio, plano por cliente, diagnóstico, relatório, gatilhos): não decide nada — só responde "esta regra/entidade está alinhada?" pelo predicado.
// Núcleo SEM import de banco (molde catalogo-db/gatilhos): handle, relógio, auditor e validação de quem registra entram pela fábrica; a fiação real está em
// alinhamentos-real.js; o autoteste roda em :memory:. Mensagens de erro fixas (nunca ecoam o valor recebido); prospect "[Comercial] …" nunca é cliente.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { auditarTexto, codigosDe } from './relatorio-seguro.js'

export const ESCOPOS = ['anuncio', 'campanha_ads', 'regra', 'conta', 'sku']
export const ORIGENS = ['painel', 'descarte', 's90_cliente', 'notion']
export const ESTADOS = ['vivo', 'vencido', 'encerrado']

// ── configuração (config/alinhamentos.json), validada na carga ──────────────────────────────────────────────────────────────
export function validarConfig(c) {
  const falha = m => { throw new Error(`config/alinhamentos.json: ${m}`) }
  if (!c || typeof c !== 'object' || !c.tipos || typeof c.tipos !== 'object') falha('JSON inválido (falta "tipos")')
  for (const k of ['revisao_dias_padrao', 'revisao_dias_max', 'motivo_max']) if (!Number.isInteger(c[k]) || c[k] < 1) falha(`"${k}" precisa ser inteiro ≥ 1`)
  for (const [id, t] of Object.entries(c.tipos)) {
    if (!/^[a-z_]{2,40}$/.test(id)) falha('id de tipo inválido')
    for (const k of ['rotulo', 'rotulo_cliente', 'texto_cliente']) if (typeof t[k] !== 'string' || !t[k].trim()) falha(`tipo ${id}: "${k}" precisa ser um texto`)
    if (!t.texto_cliente.includes('{data}')) falha(`tipo ${id}: "texto_cliente" precisa ter {data}`)
    if (!(t.suprime === 'todas' || (Array.isArray(t.suprime) && t.suprime.every(r => /^[a-z_]+\*?$/.test(r))))) falha(`tipo ${id}: "suprime" precisa ser "todas" ou lista de regras`)
    if (!['rotular', 'omitir'].includes(t.relatorio)) falha(`tipo ${id}: "relatorio" precisa ser rotular ou omitir`)
    if (t.so_avisos !== undefined && t.so_avisos !== true) falha(`tipo ${id}: "so_avisos" só pode ser true`)
  }
  const s90 = c.tipos_s90 && typeof c.tipos_s90 === 'object' && !Array.isArray(c.tipos_s90) ? Object.entries(c.tipos_s90) : []
  if (!s90.length || s90.some(([t, r]) => !c.tipos[t] || c.tipos[t].so_avisos || typeof r !== 'string' || !r.trim())) falha('"tipos_s90" precisa mapear tipos existentes (sem os que só silenciam avisos) → rótulo na voz do cliente')
  if (!Array.isArray(c.permanente_permitido) || c.permanente_permitido.some(t => !c.tipos[t])) falha('"permanente_permitido" precisa listar tipos existentes')
  if (!Array.isArray(c.regras_acos)) falha('"regras_acos" precisa ser uma lista')
  return c
}
export const lerConfig = () => validarConfig(JSON.parse(readFileSync(join(ROOT, 'config', 'alinhamentos.json'), 'utf-8')))
// config inválida NÃO derruba o processo (db.js só importa alinhamentos-schema.js): o registro fica desligado — predicado "não alinhado", escrita 503 com o motivo
const CARGA = (() => { try { return { cfg: lerConfig(), erro: '' } } catch (e) {
  const erro = String(e?.message ?? e).slice(0, 200)
  console.error(`[alinhamentos] ${erro} — registro de alinhamentos DESLIGADO até a config ser corrigida`)
  return { cfg: null, erro }
} })()
export const CFG = CARGA.cfg, CFG_ERRO = CARGA.erro
export const TIPOS = CFG ? Object.keys(CFG.tipos) : []

export { SCHEMA_ALINHAMENTO } from './alinhamentos-schema.js'

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const RX_DIA = /^\d{4}-\d{2}-\d{2}$/
const RX_CHAVE = { anuncio: /^[A-Z]{3}\d{1,15}$/, campanha_ads: /^[\w-]{1,40}$/, regra: /^[a-z_]{2,60}$/, sku: /^[\w.\-/ ]{1,60}$/ }
// regra do plano por anúncio vem com o prefixo "anuncio_" (acoes_plano.regra) ou sem (specs/config); "anuncio_restrito" é o id de uma regra, não um prefixo
const REGRAS_ALG = new Set(JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')).regras.map(r => r.id))
export const normRegra = r => { const s = String(r ?? ''); return s.startsWith('anuncio_') && !REGRAS_ALG.has(s) ? s.slice(8) : s }
// lista FECHADA do que o painel (HTTP) pode citar em "regras"/escopo regra: as regras do Algoritmo + as de conta do plano por cliente (plano-cliente.js) + 'queda_conta'
// (o gatilho de queda da conta). Curinga ('ads_*') só na config (suprime); teste-alinhamentos confere esta lista contra o código de plano-cliente e gatilhos.
export const REGRAS_CONTA = ['backlog_parado', 'bloqueio_cliente', 'bloqueio_interno', 'calendario', 'ml_alta_cancelamento', 'ml_conectar', 'ml_conversao_baixa', 'ml_queda_conversao',
  'ml_queda_faturamento', 'pendencia_cliente', 'plano_mes_atrasado', 'queda_cadencia', 'renovacao', 'sem_entrega', 'sem_plano_mes', 'sem_responsavel', 'queda_conta']
const REGRAS_OK = new Set([...REGRAS_ALG, ...REGRAS_CONTA])
// ACOS de uma ação ads_* do plano para o predicado (acima do alvo da campanha de visibilidade = não coberta): o ACOS medido do anúncio; sem leitura, a ação gravada
// com dados.alinhamento.acos_alvo já foi criada pelo plano ACIMA do alvo (plano-anuncios.anotarAlinhamento), então conta como acima (Infinity). A comparação mora no predicado.
export const acosDaAcao = (acao, item) => Number.isFinite(item?.ads?.acos) ? item.ads.acos : acao?.dados?.alinhamento?.acos_alvo != null ? Infinity : undefined
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const dm = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : ''
// o que o cliente/relatório lê: template fixo do tipo — nunca o motivo livre
export const textoCliente = (tipo, desde) => CFG && Object.hasOwn(CFG.tipos, tipo) ? CFG.tipos[tipo].texto_cliente.replace('{data}', dm(desde)) : ''
const IGNORA_AUDITOR = new Set(['causalidade', 'efeito_observado'])   // motivo interno descreve a causa ("por causa da produção"): só nome, ID, promessa, jargão, segredo e afins barram

// deps: handle (better-sqlite3), hoje() 'AAAA-MM-DD', agora() ISO, auditar(texto, opts) (relatorio-seguro), nomesInternos(cliente) → [nomes], validarPor(nome) → nome canônico ou ''
export function criarAlinhamentos({ handle: h, hoje = () => new Date().toISOString().slice(0, 10), agora = () => new Date().toISOString(), auditar = auditarTexto, nomesInternos = () => [], validarPor = () => '', cfg = CFG, cfgErro = CFG_ERRO } = {}) {
  if (!cfg) {   // config inválida: nada é alinhado (o plano, os avisos e o relatório seguem normais), toda escrita responde 503 com o motivo
    const fora = () => { throw erro(`alinhamentos indisponíveis: ${cfgErro || 'config/alinhamentos.json inválido'}`, 503) }, nao = () => ({ sim: false })
    return { config: null, indisponivel: cfgErro || 'config/alinhamentos.json inválido', tipos: [], listar: () => [], vivos: () => [], predicado: () => nao, alinhado: nao,
      registrar: fora, encerrar: fora, renovar: fora, encerrarDaAcao: () => 0, vencer: () => ({ vencidos: 0, reabertas: 0 }) }
  }
  const T = cfg.tipos, ACOS = new Set((cfg.regras_acos || []).map(normRegra))
  const hidratar = r => ({ ...r, regras: (() => { try { return JSON.parse(r.regras_json || '[]') } catch { return [] } })(), regras_json: undefined, permanente: !!r.permanente })
  // estado EFETIVO: vivo com revisar_em já chegado é vencido mesmo antes do tick diário gravar (o predicado nunca depende do relógio do servidor)
  const efetivo = (r, dia) => r.estado === 'vivo' && !r.permanente && r.revisar_em && r.revisar_em <= dia ? 'vencido' : r.estado
  const resumo = (r, dia) => ({ id: r.id, escopo: r.escopo, chave: r.chave, regras: r.regras, tipo: r.tipo, rotulo: T[r.tipo]?.rotulo || r.tipo, rotulo_cliente: T[r.tipo]?.rotulo_cliente || '',
    texto_cliente: textoCliente(r.tipo, r.desde), motivo: r.motivo, acos_alvo: r.acos_alvo, por: r.por, origem: r.origem, acao_id: r.acao_id, desde: r.desde, revisar_em: r.revisar_em,
    permanente: r.permanente, estado: efetivo(r, dia), encerrado_em: r.encerrado_em, criado_em: r.criado_em })
  const linhas = (cliente, dia) => {
    if (!str(cliente) || ehProspecto(cliente)) return []
    return h.prepare("SELECT * FROM alinhamento WHERE cliente = ? AND estado IN ('vivo','vencido') ORDER BY desde DESC, id DESC").all(cliente).map(hidratar).map(r => ({ ...r, ef: efetivo(r, dia) }))
  }

  // vivos + vencidos (não encerrados), com estado efetivo — lista do painel e do diagnóstico
  function listar(cliente, { hoje: dia = hoje() } = {}) { return linhas(cliente, dia).map(r => resumo(r, dia)) }
  function vivos(cliente, { hoje: dia = hoje() } = {}) { return listar(cliente, { hoje: dia }).filter(r => r.estado === 'vivo') }

  // ── predicado único ─────────────────────────────────────────────────────────────────────────────────────────────
  // aviso = quem pergunta fala COM o cliente (gatilhos, relatório, pendências): o tipo so_avisos (ja_informado) silencia ali — as regras listadas ou, sem lista, todas
  // da entidade — e NUNCA tira a regra do plano (exceto o descarte: a ação descartada não renasce em outro id)
  const ENTIDADE = new Set(['anuncio', 'campanha_ads', 'sku'])
  const cobreRegra = (r, regra, aviso) => {
    if (!regra) return ENTIDADE.has(r.escopo) && !r.regras.length      // "esta entidade está alinhada?": só alinhamento da entidade INTEIRA (sem lista de regras); descarte/S90 citam a regra e não casam
    const soAviso = !!T[r.tipo]?.so_avisos && r.origem !== 'descarte'
    if (soAviso && !aviso) return false
    const lista = r.regras.length ? r.regras : r.escopo === 'regra' ? [r.chave] : soAviso ? 'todas' : T[r.tipo]?.suprime ?? []
    return lista === 'todas' || lista.some(p => p.endsWith('*') ? regra.startsWith(p.slice(0, -1)) : p === regra)
  }
  // o descarte de UMA ação por alvo (calendário, pendência, janela sazonal, job de oferta) cobre só ela quando quem pergunta diz o id — na conta e no anúncio
  const outraAcao = (r, q) => r.origem === 'descarte' && r.acao_id && q.acao && q.acao !== r.acao_id
  const cobreEntidade = (r, q) => r.escopo === 'anuncio' ? !!q.item && q.item === r.chave && !outraAcao(r, q)
    : r.escopo === 'campanha_ads' ? !!q.campanha && q.campanha === r.chave
    : r.escopo === 'sku' ? !!q.sku && q.sku === r.chave
    : r.escopo === 'regra' ? true
    : !outraAcao(r, q)
  // predicado(cliente, {hoje}) → (q = { item, regra, campanha, sku, acao, aviso, acos }) → { sim, tipo, rotulo, desde, revisar_em, acos_alvo, ... } | { sim:false, vencido?, nota?, acima_do_alvo? }
  // aviso:true = consumidor que fala com o cliente (gatilhos, relatório, pendências); sem a flag = o plano (ja_informado não tira regra)
  // acos = ACOS do anúncio: nas regras de ACOS (config → regras_acos), a campanha de visibilidade com acos_alvo NÃO cobre quando acos > alvo (o combinado estourou: o plano
  // recomenda e o cliente é avisado). É a ÚNICA definição de "acima do alvo"; sem acos na pergunta, o alinhamento cobre (o plano usa acos_alvo para medir a regra)
  // UMA leitura do banco por cliente (montarAcoes pergunta por spec); prospect / cliente vazio → nunca alinhado
  function predicado(cliente, { hoje: dia = hoje() } = {}) {
    const rs = linhas(cliente, dia)
    return (q = {}) => {
      const regra = q.regra ? normRegra(q.regra) : '', qq = { ...q, item: q.item ? String(q.item) : '' }
      const daEntidade = rs.filter(r => cobreEntidade(r, qq))
      const cobre = daEntidade.filter(r => cobreRegra(r, regra, q.aviso === true))
      const acima = r => r.acos_alvo != null && q.acos != null && ACOS.has(regra) && Number(q.acos) > r.acos_alvo
      const vivos = cobre.filter(r => r.ef === 'vivo'), vivo = vivos.filter(r => !acima(r)).sort((a, b) => (b.acos_alvo != null) - (a.acos_alvo != null))[0]   // outro alinhamento sem alvo (intencional) segue cobrindo
      if (vivo) return { sim: true, id: vivo.id, tipo: vivo.tipo, rotulo: T[vivo.tipo]?.rotulo || vivo.tipo, desde: vivo.desde, revisar_em: vivo.revisar_em, permanente: vivo.permanente, acos_alvo: vivo.acos_alvo ?? null, origem: vivo.origem,
        texto_cliente: textoCliente(vivo.tipo, vivo.desde), relatorio: T[vivo.tipo]?.relatorio || 'rotular' }
      const out = { sim: false }
      const ac = vivos.find(acima)
      if (ac) out.acima_do_alvo = { id: ac.id, tipo: ac.tipo, rotulo: T[ac.tipo]?.rotulo || ac.tipo, desde: ac.desde, revisar_em: ac.revisar_em, acos_alvo: ac.acos_alvo }
      const venc = cobre.find(r => r.ef === 'vencido')
      if (venc) out.vencido = { id: venc.id, tipo: venc.tipo, rotulo: T[venc.tipo]?.rotulo || venc.tipo, desde: venc.desde, revisar_em: venc.revisar_em }
      const anot = regra && daEntidade.find(r => r.ef === 'vivo' && T[r.tipo]?.anotar?.[regra])
      if (anot) out.nota = { id: anot.id, tipo: anot.tipo, rotulo: T[anot.tipo].rotulo, desde: anot.desde, texto: T[anot.tipo].anotar[regra] }
      return out
    }
  }
  const alinhado = (cliente, q = {}, opts = {}) => predicado(cliente, opts)(q)

  // ── escrita ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const clienteOk = c => { c = str(c); if (!c) throw erro('informe "cliente"'); if (ehProspecto(c)) throw erro('prospect do Comercial não é cliente: alinhamento só para cliente'); return c }
  const quem = (por, origem) => {
    if (origem === 's90_cliente') return 'cliente'
    if (!str(por)) throw erro('informe "por" (quem registra — líder ou consultor)')
    const n = validarPor(str(por))
    if (!n) throw erro('só líderes e consultores registram alinhamento — escolha um nome da central', 403)
    return n.slice(0, 80)
  }
  // normaliza e valida TUDO (prévia e gravação passam aqui); devolve a linha pronta
  function normalizar(e = {}) {
    const dia = hoje(), cliente = clienteOk(e.cliente)
    const origem = e.origem ?? 'painel'
    if (!ORIGENS.includes(origem)) throw erro('"origem" fora da lista')
    const escopo = str(e.escopo)
    // campanha_ads e sku existem na tabela, mas nenhum consumidor pergunta por campanha nem por SKU: aceitar seria um alinhamento que não suprime nada
    if (!['anuncio', 'regra', 'conta'].includes(escopo)) throw erro('"escopo" precisa ser anuncio, regra ou conta (campanha de Ads e SKU ainda não são lidos pelo plano)')
    let chave = escopo === 'conta' ? '' : escopo === 'anuncio' ? str(e.chave).toUpperCase() : escopo === 'regra' ? normRegra(str(e.chave)) : str(e.chave)
    if (escopo !== 'conta' && !RX_CHAVE[escopo].test(chave)) throw erro(escopo === 'anuncio' ? 'informe o anúncio no formato MLB123456789' : '"chave" inválida para o escopo')
    if (e.regras != null && !Array.isArray(e.regras)) throw erro('"regras" precisa ser uma lista')
    const regras = [...new Set((e.regras || []).map(r => normRegra(str(r))))]
    if (regras.length > 20 || regras.some(r => !/^[a-z_]{2,60}$/.test(r))) throw erro('"regras" inválidas (até 20 ids de regra, sem curinga)')
    if (origem === 'painel' && [...regras, ...(escopo === 'regra' ? [chave] : [])].some(r => !REGRAS_OK.has(r))) throw erro('"regras" fora da lista de regras do plano')
    const tipo = str(e.tipo)
    if (!Object.hasOwn(T, tipo)) throw erro('"tipo" fora da lista de motivos')
    if (escopo === 'conta' && !regras.length && (T[tipo].suprime === 'todas' || T[tipo].so_avisos)) throw erro('para a conta inteira, informe as regras cobertas (este tipo cobriria o plano todo)')
    if (e.motivo != null && typeof e.motivo !== 'string') throw erro('"motivo" precisa ser texto')
    const motivo = str(e.motivo).replace(/\s+/g, ' ')
    if (motivo.length > cfg.motivo_max) throw erro(`"motivo" passa de ${cfg.motivo_max} caracteres`)
    if (motivo) {
      const viol = auditar(motivo, { nomesInternos: nomesInternos(cliente) || [], permitidos: [cliente] }).filter(v => !IGNORA_AUDITOR.has(v.codigo))
      if (viol.length) throw Object.assign(erro('motivo reprovado pelo auditor: tire nome de pessoa, ID, promessa e termos técnicos'), { codigos: codigosDe(viol) })
    }
    let acos_alvo = null
    if (e.acos_alvo != null && e.acos_alvo !== '') {
      if (tipo !== 'campanha_visibilidade') throw erro('"acos_alvo" só vale para campanha de visibilidade')
      acos_alvo = Number(e.acos_alvo)
      if (!Number.isFinite(acos_alvo) || acos_alvo <= 0 || acos_alvo > 300) throw erro('"acos_alvo" precisa ser um percentual entre 0 e 300')
      acos_alvo = Math.round(acos_alvo * 10) / 10
    }
    const permanente = e.permanente === true
    if (permanente && !cfg.permanente_permitido.includes(tipo)) throw erro('alinhamento permanente só para produto descontinuado — os demais têm data de revisão')
    let revisar_em = ''
    if (!permanente) {
      revisar_em = e.revisar_em == null || e.revisar_em === '' ? addDias(dia, cfg.revisao_dias_padrao) : str(e.revisar_em)
      if (!RX_DIA.test(revisar_em) || revisar_em <= dia || revisar_em > addDias(dia, cfg.revisao_dias_max)) throw erro(`"revisar_em" precisa ser uma data (AAAA-MM-DD) depois de hoje e em até ${cfg.revisao_dias_max} dias`)
    }
    const acao_id = origem === 'descarte' ? str(e.acao_id).slice(0, 40) : ''
    return { cliente, escopo, chave, regras, tipo, motivo, acos_alvo, origem, acao_id, desde: dia, revisar_em, permanente, por: quem(e.por, origem) }
  }

  // registrar(e) → prévia (nada gravado) sem confirmar === true; com confirmar === true grava e devolve o id
  function registrar(e = {}) {
    const n = normalizar(e)
    const previa = { ...n, rotulo: T[n.tipo].rotulo, texto_cliente: textoCliente(n.tipo, n.desde) }
    if (e.confirmar !== true) return { ok: true, previa: true, alinhamento: previa }
    const id = h.prepare(`INSERT INTO alinhamento (cliente, escopo, chave, regras_json, tipo, motivo, acos_alvo, por, origem, acao_id, desde, revisar_em, permanente, estado, criado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'vivo', ?)`).run(n.cliente, n.escopo, n.chave, JSON.stringify(n.regras), n.tipo, n.motivo, n.acos_alvo, n.por, n.origem, n.acao_id, n.desde, n.revisar_em, n.permanente ? 1 : 0, agora()).lastInsertRowid
    return { ok: true, previa: false, id: Number(id), alinhamento: { id: Number(id), ...previa, estado: 'vivo' } }
  }

  const idOk = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw erro('informe "id" do alinhamento'); return n }
  // a ação descartada volta à fila como 'proposta' (encerrar ou vencer o alinhamento do descarte): sem isso o id determinístico da ação a tiraria de toda geração
  const reabrirAcao = (acao_id, cliente) => { try { return h.prepare("UPDATE acoes_plano SET status = 'proposta', atualizado_em = ? WHERE id = ? AND cliente = ? AND status = 'descartada'").run(agora(), acao_id, cliente).changes } catch { return 0 /* banco sem acoes_plano (teste de módulo) */ } }
  // encerrar: vivo/vencido → encerrado (a regra volta a nascer na próxima geração do plano; descarte devolve a ação à fila na mesma transação).
  // origem 's90_cliente' = o próprio cliente do Sprint 90 desfaz o que ELE marcou (só linhas dessa origem; por = 'cliente')
  function encerrar({ cliente, id, por, origem = 'painel' } = {}) {
    cliente = clienteOk(cliente); id = idOk(id)
    if (!['painel', 's90_cliente'].includes(origem)) throw erro('"origem" fora da lista')
    const nome = quem(por, origem)
    const r = h.prepare(`SELECT origem, acao_id FROM alinhamento WHERE id = ? AND cliente = ? AND estado IN ('vivo','vencido')${origem === 's90_cliente' ? " AND origem = 's90_cliente'" : ''}`).get(id, cliente)
    if (!r) throw erro('alinhamento não encontrado ou já encerrado neste cliente', 404)
    let reaberta = 0
    h.transaction(() => {
      h.prepare("UPDATE alinhamento SET estado = 'encerrado', encerrado_em = ?, encerrado_por = ? WHERE id = ? AND cliente = ?").run(agora(), nome, id, cliente)
      if (r.origem === 'descarte' && r.acao_id) reaberta = reabrirAcao(r.acao_id, cliente)
    })()
    return { ok: true, id, estado: 'encerrado', acao_reaberta: reaberta > 0 }
  }
  // renovar: vivo/vencido → vivo com nova data de revisão (padrão +30 d); permanente continua permanente
  function renovar({ cliente, id, por, revisar_em } = {}) {
    cliente = clienteOk(cliente); id = idOk(id)
    const nome = quem(por, 'painel'), dia = hoje()
    const r = h.prepare("SELECT tipo, permanente FROM alinhamento WHERE id = ? AND cliente = ? AND estado IN ('vivo','vencido')").get(id, cliente)
    if (!r) throw erro('alinhamento não encontrado ou já encerrado neste cliente', 404)
    let nova = ''
    if (!r.permanente) {
      nova = revisar_em == null || revisar_em === '' ? addDias(dia, cfg.revisao_dias_padrao) : str(revisar_em)
      if (!RX_DIA.test(nova) || nova <= dia || nova > addDias(dia, cfg.revisao_dias_max)) throw erro(`"revisar_em" precisa ser uma data (AAAA-MM-DD) depois de hoje e em até ${cfg.revisao_dias_max} dias`)
    }
    h.prepare("UPDATE alinhamento SET estado = 'vivo', revisar_em = ?, por = ? WHERE id = ? AND cliente = ?").run(nova, nome, id, cliente)
    return { ok: true, id, estado: 'vivo', revisar_em: nova }
  }
  // reabrir uma ação descartada encerra o alinhamento que o descarte gravou (chamado por plano-cliente.marcarStatus, dentro da transação dele)
  const encerrarDaAcao = (cliente, acao_id, por = '') => h.prepare("UPDATE alinhamento SET estado = 'encerrado', encerrado_em = ?, encerrado_por = ? WHERE cliente = ? AND acao_id = ? AND origem = 'descarte' AND estado IN ('vivo','vencido')")
    .run(agora(), String(por).slice(0, 80), cliente, acao_id).changes

  // tick diário: vivo → vencido em revisar_em; o descarte vencido devolve a ação à fila como 'proposta' (o plano seguinte a marca "observar: alinhado em dd/mm, revisar")
  function vencer(dia = hoje()) {
    const venc = h.prepare("SELECT id, cliente, acao_id, origem FROM alinhamento WHERE estado = 'vivo' AND permanente = 0 AND revisar_em <> '' AND revisar_em <= ?").all(dia)
    let reabertas = 0
    h.transaction(() => {
      const up = h.prepare("UPDATE alinhamento SET estado = 'vencido' WHERE id = ? AND estado = 'vivo'")
      for (const r of venc) {
        up.run(r.id)
        if (r.origem === 'descarte' && r.acao_id) reabertas += reabrirAcao(r.acao_id, r.cliente)
      }
    })()
    return { vencidos: venc.length, reabertas }
  }

  return { config: cfg, tipos: TIPOS, listar, vivos, predicado, alinhado, registrar, encerrar, renovar, encerrarDaAcao, vencer }
}
