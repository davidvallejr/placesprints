// Orquestrador do sync de custos dos ERPs (M7, spec docs/integracao-custos-erp-SPEC.md, 7.4). SOMENTE LEITURA: varre o ERP
// pelo conector (M4 Bling / M5 Tiny) e grava custo local só pela porta única aplicarLote (M1). Nada aqui chama o ML nem escreve no ERP.
// - lock por (cliente, fonte): Map em memória + erp_fontes.sync_estado='rodando' (morto após 30 min). NÃO divide lock com a coleta do ML.
// - falha no meio: aplica o que leu como PARCIAL, não fecha o completo (nenhum SKU vira "não visto"), não mexe em ultimo_sync_ok_em.
// - tick: a partir das 03:00 locais (recupera se a máquina estava desligada), estado por cliente×fonte na tabela, até 3 tentativas/dia.
import { randomUUID } from 'node:crypto'
import { db, agora, auditar } from './promocoes-db.js'
import { aplicarLote, fecharSyncCompleto, estadoFonte, gravarEstadoFonte, getCfgCustos, chaveSku, lerCustoMaquina, skuPorIdExterno, podarCustos } from './custos-db.js'
import { httpPadrao, criarLimitador, sanitizar } from './erp-http.js'
import { criarConectorBling } from './erp-bling.js'
import { criarConectorTiny } from './erp-tiny.js'

export const FONTES_SYNC = ['bling', 'tiny']              // a planilha é push (webhook): não tem varredura
const TAM_BLOCO = 500, MORTO_MS = 30 * 60e3, HORA_TICK = 3, MAX_TENTATIVAS_DIA = 3, CONCORRENCIA_TICK = 2
const FILA_POR_RODADA = 20, FILA_MAX_TENTATIVAS = 3, KEEPALIVE_TINY_MS = 12 * 3600e3, MAX_JOBS = 20

let log = () => {}
export function configurarLog(fn) { log = typeof fn === 'function' ? fn : () => {} }

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const chave = (cliente, fonte) => `${cliente}\u0000${fonte}`
const diaLocal = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10) }
// invalid_grant / empresa inativa / refresh vencido (conectores lançam codigo 'reautorizar'): só um novo consentimento resolve, sem laço
const ehReautorizar = e => e?.codigo === 'reautorizar' || /invalid_grant|empresa inativa/i.test(String(e?.message || ''))

// ── lock por (cliente, fonte) ────────────────────────────────────────────────
const rodando = new Map()
function ocupado(cliente, fonte, agoraMs = Date.now()) {
  if (rodando.has(chave(cliente, fonte))) return true
  const e = estadoFonte(cliente, fonte)
  return e.sync_estado === 'rodando' && agoraMs - Date.parse(e.sync_iniciada_em) < MORTO_MS   // '' → NaN → livre
}
function validarInicio(cliente, fonte) {
  if (!cliente || typeof cliente !== 'string') throw erro('informe o cliente')
  if (!FONTES_SYNC.includes(fonte)) throw erro('fonte inválida para sincronizar (bling ou tiny; a planilha envia sozinha pelo webhook)')
  const est = estadoFonte(cliente, fonte).estado
  if (est === 'reautorizar') throw erro(`${fonte} precisa ser reautorizado pelo cliente antes de sincronizar`, 409)
  if (est === 'desconectado') throw erro(`${fonte} não está conectado para este cliente`, 409)
  if (ocupado(cliente, fonte)) throw erro('já existe uma sincronização desta fonte rodando para este cliente — aguarde terminar', 409)
}

// ── conector (injetável; o padrão monta M4/M5 com a infra do M6) ──────────────
const limitadores = new Map()                          // 1 por conta: varredura e fila dividem a mesma taxa
// ponytail: import dinâmico do OAuth (M6) — ele lê o .env e a chave de cripto; os testes injetam criarConector/obterToken e nunca o carregam
const tokenValido = async (cliente, fonte, opcoes = {}) => (await import('./erp-credenciais.js')).obterTokenValido(cliente, fonte, opcoes)
// null do M6 SEM o estado 'reautorizar' = renovação falhou agora (rede, 5xx/429 no /oauth/token, app não cadastrado): os conectores
// leriam null como "reautorizar" e a conta pararia até um novo consentimento à toa. Vira erro comum (o tick tenta de novo).
const tokenDoConector = async (cliente, fonte, opcoes) => {
  const t = await tokenValido(cliente, fonte, opcoes)
  const est = t == null ? estadoFonte(cliente, fonte).estado : ''
  if (est === 'desconectado') throw new Error('a fonte foi desconectada durante a sincronização: nada mais é lido')   // fim, não erro transitório
  if (t == null && est !== 'reautorizar')
    throw new Error('sem token válido do ERP agora (renovação falhou: rede, limite ou app não cadastrado — veja o erro da credencial no cartão); nova tentativa no próximo ciclo')
  return t
}
// identidade da conexão: desconectar zera conectado_em e reconectar grava outro; sem credencial (testes com stub) = ''
const conexaoDe = (cliente, fonte) => db.prepare('SELECT conectado_em FROM erp_credenciais WHERE cliente = ? AND fonte = ?').get(cliente, fonte)?.conectado_em ?? ''
async function obterConector(cliente, fonte, deps) {
  if (deps.criarConector) return deps.criarConector(cliente, fonte)
  const k = chave(cliente, fonte)
  if (!limitadores.has(k)) limitadores.set(k, criarLimitador(fonte === 'bling' ? { porSegundo: 2.5, global: 30 } : { porMinuto: 25, global: 30 }))
  // o Bling pede { renovar: true } depois de um 401: repassa ao M6 (renova sob lock por conta)
  const base = { http: httpPadrao, limitador: limitadores.get(k), obterToken: o => tokenDoConector(cliente, fonte, o), log: (n, m) => log(n, m) }
  return fonte === 'bling' ? criarConectorBling(base) : criarConectorTiny({ ...base, campoCusto: getCfgCustos(cliente).campo_custo_tiny })
}
const obterToken = (cliente, fonte, deps) => deps.obterToken ? deps.obterToken(cliente, fonte) : tokenValido(cliente, fonte)

// ── deduplicação da varredura inteira e kits ─────────────────────────────────
// SKU repetido: custos canônicos iguais → vale um; diferentes → TODAS as ocorrências vão juntas no MESMO lote e o aplicarLote
// rejeita todas (sku_duplicado_no_lote, 5.3.5). Nunca "o último ganha em silêncio".
const canonico = l => { const c = lerCustoMaquina(l?.custo); return c.custo_txt ?? `x:${c.codigo}:${String(l?.custo)}` }
function agrupar(linhas) {
  const porChave = new Map(), grupos = []
  for (const l of linhas) {
    const k = chaveSku(l?.sku)
    if (!k) { grupos.push([l]); continue }                // sem SKU válido: o aplicarLote rejeita (sku_vazio / sku_invalido)
    if (!porChave.has(k)) porChave.set(k, [])
    porChave.get(k).push(l)
  }
  let duplicados = 0
  for (const g of porChave.values()) {
    if (g.length > 1) duplicados++
    grupos.push(g.length > 1 && g.every(l => canonico(l) === canonico(g[0])) ? [g[0]] : g)
  }
  return { grupos, duplicados }
}
function blocos(grupos) {                               // ~500 por lote, sem nunca partir um grupo de duplicados
  const out = []; let atual = []
  for (const g of grupos) {
    if (atual.length && atual.length + g.length > TAM_BLOCO) { out.push(atual); atual = [] }
    atual.push(...g)
  }
  if (atual.length) out.push(atual)
  return out
}
// Kit (5.9): Σ(quantidade × custo VIGENTE do componente), só se TODOS os componentes têm custo vigente. Sem estrutura ou com
// componente sem custo = linha sem custo com o código do kit (rejeitada; o kit fica pendente). Custo próprio divergente > 1% da soma:
// o aplicarLote põe em quarentena (kit_divergente) com a soma como proposta. Nunca inventa número.
// custoDe(id do componente) → número | null: vem de custoLidoAgora (varredura) ou custoVigente (fila).
function linhasDeKits(kits, fonte, custoDe) {
  return kits.map(k => {
    const base = { sku: k?.sku ?? '', mlb: null, campo: `${fonte}.kit.soma_componentes`, id_externo: String(k?.id_externo ?? ''), atualizado_na_fonte: null }
    const comps = Array.isArray(k?.componentes) ? k.componentes : []
    if (!comps.length || comps.some(c => !(Number(c?.quantidade) > 0) || c?.id_externo == null || c.id_externo === ''))
      return { ...base, custo: null, kit_pendente: 'kit_sem_estrutura', dica: typeof k?.dica === 'string' && k.dica ? k.dica : 'o ERP não entregou a composição do kit' }
    const custos = comps.map(c => custoDe(String(c.id_externo)))
    const faltam = custos.filter(c => !(c > 0)).length
    if (faltam) return { ...base, custo: null, kit_pendente: 'kit_componente_sem_custo', dica: `${faltam} componente(s) sem custo vigente (ausente, rejeitado, em quarentena ou recusado)` }
    const soma = Number(comps.reduce((s, c, i) => s + Number(c.quantidade) * custos[i], 0).toFixed(4))
    return { ...base, custo: soma, kit_custo_proprio: lerCustoMaquina(k.custo_proprio).custo ?? null }
  })
}
const stVigKey = db.prepare('SELECT custo, custo_txt, visto_em FROM erp_custos_sku WHERE cliente = ? AND fonte = ? AND sku_key = ?')
const stVigId = db.prepare('SELECT sku_key, custo FROM erp_custos_sku WHERE cliente = ? AND fonte = ? AND id_externo = ? LIMIT 2')
const stQPend = db.prepare("SELECT 1 FROM erp_quarentena WHERE cliente = ? AND fonte = ? AND sku_key = ? AND estado = 'pendente'")
// varredura: o componente vale só se o custo LIDO agora virou o vigente (aceito ou inalterado). Lido que foi para a quarentena, que o dono
// já recusou, que foi rejeitado ou duplicado = sem custo. id em 2+ SKUs = ambíguo = sem custo.
function custoLidoAgora(cliente, fonte, inicio, grupos) {
  const lido = new Map()
  for (const g of grupos) {
    if (g.length !== 1) continue                          // SKU duplicado com custos diferentes: rejeitado
    const id = String(g[0]?.id_externo ?? ''), key = chaveSku(g[0]?.sku)
    if (id && key) lido.set(id, lido.has(id) && lido.get(id)?.key !== key ? null : { key, txt: lerCustoMaquina(g[0].custo).custo_txt })
  }
  return id => {
    const x = lido.get(id), v = x?.txt ? stVigKey.get(cliente, fonte, x.key) : null
    return v && v.custo_txt === x.txt && v.visto_em >= inicio && !stQPend.get(cliente, fonte, x.key) ? v.custo : null
  }
}
// fila (kit relido sozinho): vigente da fonte, sem quarentena pendente; id em 2+ SKUs = ambíguo = sem custo
const custoVigente = (cliente, fonte) => id => {
  const vs = stVigId.all(cliente, fonte, id)
  return vs.length === 1 && !stQPend.get(cliente, fonte, vs[0].sku_key) ? vs[0].custo : null
}
// ponytail: vínculo variação→pai só em memória (o banco não guarda o pai). Serve para o teto de detalhes do Tiny priorizar o pai cujas
// VARIAÇÕES têm anúncio; após reiniciar, a 1ª varredura prioriza só pelo SKU do pai (o excedente vai à fila de qualquer jeito).
// Persistir o pai (coluna) se a ordem do teto passar a importar.
const paiDe = new Map()                                   // chave(cliente, fonte) → Map<sku_key da variação, sku do pai>
function lembrarPais(cliente, fonte, linhas) {
  const k = chave(cliente, fonte)
  for (const l of linhas) if (l?.variacao_de && chaveSku(l.sku)) { if (!paiDe.has(k)) paiDe.set(k, new Map()); paiDe.get(k).set(chaveSku(l.sku), String(l.variacao_de)) }
}

const CONTAGENS = ['recebidas', 'aceitas', 'novas', 'alteradas', 'inalteradas', 'recusado_antes', 'em_quarentena', 'rejeitadas']
function somar(r, x) {
  for (const c of CONTAGENS) r[c] += Number(x?.[c]) || 0
  r.skus_com_aprovacao_afetada += Number(x?.impacto?.skus_com_aprovacao_afetada) || 0
  r.quarentena_lista.push(...(x?.quarentena_lista || []).slice(0, 200 - r.quarentena_lista.length))
  r.rejeitadas_lista.push(...(x?.rejeitadas_lista || []).slice(0, 200 - r.rejeitadas_lista.length))
}
function enfileirarDetalhes(cliente, fonte, ids) {      // excedente do teto de detalhes da varredura (M4/M5) → worker da fila
  if (!Array.isArray(ids) || !ids.length) return
  const ins = db.prepare("INSERT INTO erp_fila (cliente, fonte, id_externo, motivo, enfileirado_em) VALUES (?,?,?,'detalhe',?) ON CONFLICT(cliente, fonte, id_externo) DO NOTHING")
  for (const id of ids.slice(0, 5000)) if ((typeof id === 'string' || typeof id === 'number') && String(id).length <= 64 && String(id) !== '') ins.run(cliente, fonte, String(id), agora())
}

// ── sync de uma conta ────────────────────────────────────────────────────────
export async function sincronizarCliente(cliente, fonte, { motivo = 'manual', deps = {} } = {}) {
  validarInicio(cliente, fonte)                         // síncrono: o lock é tomado antes do primeiro await
  const k = chave(cliente, fonte), inicio = agora(), t0 = Date.now(), syncId = randomUUID(), conexao = conexaoDe(cliente, fonte)
  rodando.set(k, t0)
  const r = { ok: false, completo: false, motivo, fonte, sync_id: syncId, inicio, paginas: 0, lidas: 0, kits: 0, kits_pendentes: 0, skus_duplicados: 0,
    ...Object.fromEntries(CONTAGENS.map(c => [c, 0])), skus_com_aprovacao_afetada: 0, nao_vistos: 0, detalhes_pendentes: 0, duracao_ms: 0,
    avisos: [], quarentena_lista: [], rejeitadas_lista: [] }
  let falha = null
  try {
    gravarEstadoFonte(cliente, fonte, { sync_estado: 'rodando', sync_iniciada_em: inicio, ultimo_sync_em: inicio })
    const linhas = [], kits = []
    let naoFechar = false                                 // o conector deixou SKUs desconhecidos na fila (pais do Tiny além do teto)
    try {
      const con = await obterConector(cliente, fonte, deps)
      const anuncios = db.prepare("SELECT DISTINCT sku FROM promo_anuncio WHERE cliente = ? AND sku <> ''").all(cliente).map(x => x.sku)
      const pais = paiDe.get(k) || new Map()               // + pai das variações com anúncio (teto de detalhes do Tiny)
      const prioridadeSkus = [...anuncios, ...anuncios.map(s => pais.get(chaveSku(s))).filter(Boolean)]
      for await (const pg of con.varrer({ prioridadeSkus })) {
        r.paginas++
        if (Array.isArray(pg?.linhas)) linhas.push(...pg.linhas)
        if (Array.isArray(pg?.kits)) kits.push(...pg.kits)
        for (const a of pg?.avisos || []) if (r.avisos.length < 20) r.avisos.push(String(a).slice(0, 200))
        enfileirarDetalhes(cliente, fonte, pg?.pendentes_detalhe)
        if (pg?.nao_fechar) naoFechar = true
      }
    } catch (e) { falha = e }
    r.lidas = linhas.length; r.kits = kits.length
    lembrarPais(cliente, fonte, linhas)
    const modo = falha || naoFechar ? 'parcial' : 'completo'
    let n = 0
    const aplicar = grupos => { for (const bloco of blocos(grupos)) somar(r, aplicarLote({ cliente, fonte, modo, lote_id: `sync-${syncId}-${++n}`, linhas: bloco, origem: 'sync', por: `sync ${motivo}` })) }
    // 1º os itens simples; os kits DEPOIS (5.9), somando o custo que cada componente tem como VIGENTE após este envio. Item simples com o
    // SKU de um kit vai junto do kit no 2º passo, para o aplicarLote ver a duplicidade.
    const doKit = new Set(kits.map(x => chaveSku(x?.sku)).filter(Boolean)), ehDoKit = g => doKit.has(chaveSku(g[0]?.sku))
    const { grupos } = agrupar(linhas), simples = grupos.filter(g => !ehDoKit(g))
    aplicar(simples)
    // kits só com a varredura inteira (componente "sem custo" numa leitura incompleta seria rejeição falsa)
    const kitLinhas = falha ? [] : linhasDeKits(kits, fonte, custoLidoAgora(cliente, fonte, inicio, simples))
    r.kits_pendentes = kitLinhas.filter(l => l.kit_pendente).length
    aplicar(agrupar([...grupos.filter(ehDoKit).flat(), ...kitLinhas]).grupos)
    r.skus_duplicados = agrupar([...linhas, ...kitLinhas]).duplicados
    if (!falha) {
      r.ok = true
      // só fecha o completo (marca "não visto") quando a varredura viu TODOS os SKUs; com pendência que esconde SKU, nada vira "não visto"
      if (naoFechar) r.avisos.push('completo não fechado: há produtos com variações pendentes na fila (nenhum SKU vira "não visto" nesta rodada)')
      else { r.nao_vistos = Number(fecharSyncCompleto(cliente, fonte, inicio)?.nao_vistos) || 0; r.completo = true }
    }
  } catch (e) { falha ??= e }
  r.duracao_ms = Date.now() - t0
  try {
    r.detalhes_pendentes = db.prepare("SELECT COUNT(*) n FROM erp_fila WHERE cliente = ? AND fonte = ? AND motivo = 'detalhe'").get(cliente, fonte).n
    const { quarentena_lista, rejeitadas_lista, ...curto } = r
    if (!r.ok) r.erro = sanitizar(falha?.message || falha)
    // o dono desconectou/reconectou (ou pausou) durante o sync: o estado é dele — o sync só solta o lock (e guarda o resumo, se leu tudo)
    const atual = estadoFonte(cliente, fonte).estado, estado = e => atual === 'pausado' ? {} : { estado: e }
    if (atual === 'desconectado' || conexaoDe(cliente, fonte) !== conexao)
      gravarEstadoFonte(cliente, fonte, { sync_estado: '', sync_iniciada_em: '', ...(r.ok && { ultimo_resumo: curto }) })
    else if (r.ok) gravarEstadoFonte(cliente, fonte, { ...estado('conectado'), sync_estado: '', sync_iniciada_em: '', ultimo_sync_ok_em: agora(), ultimo_erro: '', ultimo_resumo: curto })
    else {
      const reaut = ehReautorizar(falha) || atual === 'reautorizar'   // o M6 pode ter marcado durante o sync
      gravarEstadoFonte(cliente, fonte, { ...estado(reaut ? 'reautorizar' : 'erro'), sync_estado: '', sync_iniciada_em: '', ultimo_erro: r.erro })
    }
    auditar(cliente, 'custos_sync', { autor: `sync ${motivo}`, detalhe: `${fonte}: ${r.completo ? 'completo' : r.ok ? 'lido, completo NÃO fechado (pendências na fila)' : 'FALHOU (parcial, não fechado)'} — ${r.aceitas} aceitas, ${r.rejeitadas} rejeitadas, ${r.em_quarentena} em quarentena, ${r.nao_vistos} não vistos${r.ok ? '' : ` — ${r.erro}`}` })
  } finally { rodando.delete(k) }
  log(r.ok ? 'info' : 'erro', `custos ${fonte} (${cliente}): ${r.completo ? 'sync completo' : r.ok ? 'sync lido, completo não fechado (pendências na fila)' : `sync falhou — ${r.erro}`} ·${r.paginas} pág., ${r.aceitas} aceitas, ${r.rejeitadas} rejeitadas, ${r.em_quarentena} quarentena, ${r.duracao_ms} ms`)
  return r
}

// ── "Sincronizar agora": job em memória (máx. 20, como jobsPromo); o estado persistente fica em erp_fontes ──
const jobs = new Map()
export function iniciarSync(cliente, fonte, deps = {}) {
  validarInicio(cliente, fonte)                         // 400/409 síncronos (já rodando = 409)
  const job = { id: `cj-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, cliente, fonte, estado: 'rodando', inicio: agora(), fim: '', resultado: null, erro: null }
  jobs.set(job.id, job)
  for (const id of [...jobs.keys()].slice(0, -MAX_JOBS)) jobs.delete(id)
  sincronizarCliente(cliente, fonte, { motivo: 'manual', deps })
    .then(r => { job.resultado = r; job.estado = r.ok ? 'concluido' : 'erro'; job.erro = r.ok ? null : r.erro })
    .catch(e => { job.estado = 'erro'; job.erro = sanitizar(e.message) })
    .finally(() => { job.fim = agora() })
  return { job_id: job.id }
}
export const statusJob = id => { const j = jobs.get(String(id ?? '')); return j ? { ...j } : null }

// ── tick agendado (server.js chama de 10 em 10 min) ──────────────────────────
let tickRodando = false, ultimaPoda = ''
export async function tickCustos({ agora: quando = new Date(), deps = {} } = {}) {
  if (tickRodando) return { rodou: false, motivo: 'tick anterior ainda rodando', sincronizados: [], pulados: [] }
  tickRodando = true
  const r = { rodou: false, motivo: '', sincronizados: [], pulados: [], keepalive: 0 }
  try {
    const dia = diaLocal(quando)
    if (ultimaPoda !== dia) { ultimaPoda = dia; try { podarCustos(quando.getTime()) } catch (e) { log('erro', `poda de custos: ${sanitizar(e.message)}`) } }
    const fontes = db.prepare("SELECT cliente, fonte, ultimo_sync_ok_em, tentativas_dia, tentativas_dia_data FROM erp_fontes WHERE fonte IN ('bling','tiny') AND estado IN ('conectado','erro') ORDER BY cliente, fonte").all()
    // keepalive do Tiny (refresh vale 1 dia): renova se o refresh tem mais de 12 h, a qualquer hora. invalid_grant → o M6 marca 'reautorizar'
    const emitido = db.prepare("SELECT refresh_emitido_em FROM erp_credenciais WHERE cliente = ? AND fonte = 'tiny'")
    for (const f of fontes.filter(x => x.fonte === 'tiny' && !ocupado(x.cliente, 'tiny'))) {
      const em = Date.parse(emitido.get(f.cliente)?.refresh_emitido_em || '')
      if (em && quando - em < KEEPALIVE_TINY_MS) continue
      try { await obterToken(f.cliente, 'tiny', deps); r.keepalive++ } catch (e) { log('aviso', `keepalive Tiny (${f.cliente}): ${sanitizar(e.message)}`) }
    }
    if (quando.getHours() < HORA_TICK) { r.motivo = 'antes das 03:00'; return r }
    const executando = db.prepare("SELECT 1 FROM promo_plano WHERE cliente = ? AND estado = 'executando' LIMIT 1")
    const fila = []
    for (const f of fontes) {
      const tent = f.tentativas_dia_data === dia ? Number(f.tentativas_dia) || 0 : 0
      const pulo = Number.isFinite(Date.parse(f.ultimo_sync_ok_em)) && diaLocal(f.ultimo_sync_ok_em) === dia ? 'já sincronizou hoje'
        : tent >= MAX_TENTATIVAS_DIA ? 'tentativas do dia esgotadas'
        : executando.get(f.cliente) ? 'plano de promoção executando'
        : ocupado(f.cliente, f.fonte) ? 'sincronização em andamento' : ''
      if (pulo) r.pulados.push({ cliente: f.cliente, fonte: f.fonte, motivo: pulo }); else fila.push({ ...f, tent })
    }
    r.rodou = true
    await Promise.all(Array.from({ length: CONCORRENCIA_TICK }, async () => {
      for (let f; (f = fila.shift());) {
        try {
          gravarEstadoFonte(f.cliente, f.fonte, { tentativas_dia: f.tent + 1, tentativas_dia_data: dia })
          const s = await sincronizarCliente(f.cliente, f.fonte, { motivo: 'agendado', deps })
          r.sincronizados.push({ cliente: f.cliente, fonte: f.fonte, ok: s.ok })
        } catch (e) { r.pulados.push({ cliente: f.cliente, fonte: f.fonte, motivo: sanitizar(e.message) }) }
      }
    }))
    return r
  } finally { tickRodando = false }
}

// ── worker da fila (server.js chama de 5 em 5 s): gatilhos do webhook Bling (só com PS_BLING_WEBHOOK=1) e detalhes pendentes ──
let filaRodando = false
export async function processarFila({ deps = {} } = {}) {
  if (filaRodando) return { processados: 0, falhas: 0, esgotados: 0 }
  filaRodando = true
  const r = { processados: 0, falhas: 0, esgotados: 0 }
  try {
    const gatilhoLigado = process.env.PS_BLING_WEBHOOK === '1'
    // só itens processáveis: conta parada (reautorizar/pausada/desconectada) ou gatilho com o webhook desligado ficam na fila SEM ocupar
    // as 20 vagas da rodada — senão 20 itens velhos de uma conta parada travariam a fila de todas as outras
    const itens = db.prepare(`SELECT q.* FROM erp_fila q JOIN erp_fontes f ON f.cliente = q.cliente AND f.fonte = q.fonte
      WHERE q.proxima_em <= ? AND f.estado IN ('conectado','erro') AND (q.motivo <> 'gatilho' OR ?) ORDER BY q.enfileirado_em LIMIT ?`).all(agora(), gatilhoLigado ? 1 : 0, FILA_POR_RODADA)
    const voltar = db.prepare(`INSERT INTO erp_fila (cliente, fonte, id_externo, motivo, enfileirado_em, tentativas, proxima_em) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(cliente, fonte, id_externo) DO UPDATE SET tentativas = excluded.tentativas, proxima_em = excluded.proxima_em`)
    for (const it of itens) {
      if (!FONTES_SYNC.includes(it.fonte) || (it.motivo === 'gatilho' && !gatilhoLigado)) continue
      if (!['conectado', 'erro'].includes(estadoFonte(it.cliente, it.fonte).estado) || ocupado(it.cliente, it.fonte)) continue   // a varredura cobre
      // tira da fila ANTES de ler: gatilho que chegar durante a leitura (o M2 faz INSERT OR IGNORE) entra de novo e não se perde.
      // ponytail: queda do processo no meio perde o item; a varredura diária é a garantia
      db.prepare('DELETE FROM erp_fila WHERE cliente = ? AND fonte = ? AND id_externo = ?').run(it.cliente, it.fonte, it.id_externo)
      try {
        const con = await obterConector(it.cliente, it.fonte, deps)
        const { linhas, kits } = (await con.custoDoProduto(it.id_externo, { skuConhecido: skuPorIdExterno(it.cliente, it.fonte, it.id_externo) })) || {}
        const simples = Array.isArray(linhas) ? linhas : []
        lembrarPais(it.cliente, it.fonte, simples)
        // kit relido (ex.: além do teto da varredura): soma com o vigente de cada componente (5.9), nunca o custo próprio direto
        const todas = [...simples, ...linhasDeKits(Array.isArray(kits) ? kits : [], it.fonte, custoVigente(it.cliente, it.fonte))]
        if (todas.length)
          aplicarLote({ cliente: it.cliente, fonte: it.fonte, modo: 'parcial', lote_id: `fila-${randomUUID()}`, linhas: agrupar(todas).grupos.flat(), origem: 'fila', por: `fila ${it.motivo}` })
        r.processados++
      } catch (e) {
        const tent = (Number(it.tentativas) || 0) + 1
        if (tent >= FILA_MAX_TENTATIVAS) {
          avisarNoResumo(it.cliente, it.fonte, `produto ${it.id_externo} (${it.motivo}) desistido após ${tent} tentativas: ${sanitizar(e.message).slice(0, 120)}`)
          r.esgotados++
        } else {
          voltar.run(it.cliente, it.fonte, it.id_externo, it.motivo, it.enfileirado_em, tent, new Date(Date.now() + 60e3 * 2 ** (tent - 1)).toISOString())   // backoff 1, 2 min
          r.falhas++
        }
      }
    }
    return r
  } finally { filaRodando = false }
}
function avisarNoResumo(cliente, fonte, aviso) {         // item que esgota vira aviso no resumo da fonte (nunca laço infinito)
  const res = estadoFonte(cliente, fonte).ultimo_resumo || {}
  res.avisos_fila = [...(Array.isArray(res.avisos_fila) ? res.avisos_fila : []), aviso].slice(-20)
  gravarEstadoFonte(cliente, fonte, { ultimo_resumo: res })
  log('aviso', `fila de custos (${cliente}/${fonte}): ${aviso}`)
}
