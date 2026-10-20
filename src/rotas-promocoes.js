// Rotas JSON do módulo "Promoções por cliente" (/api/promocoes/...). Toda rota exige `cliente` e checa que ele tem
// conta Mercado Livre conectada. Só GET em API externa; a única escrita ao vivo (promocoes-exec.js) está travada por
// duas chaves. Nenhuma rota devolve stack; toda entrada é validada (parâmetro repetido/NaN/lixo nunca vira 500).
import { Router } from 'express'
import * as repo from './lib/promocoes-db.js'
import * as A from './lib/promocoes-analista.js'
import { coletarPromocoes, coletaLigada } from './lib/promocoes-coleta.js'
import { gerarPlano, aprovarPlano, planoExpirado } from './lib/promocoes-plano.js'
import { executarPlano, sincronizarPosExecucao, recuperarPlanosPresos, verificarTravas, ESPERA_PROPAGACAO_MIN } from './lib/promocoes-exec.js'
import { parseCustosCsv, lerCusto, norm, ehRebate, ehRelampagoSmart, ehLightning, coberturaContinua, diaBR } from './lib/promocoes-mc.js'
import { custosEfetivosDetalhe, pendenciasCustos } from './lib/custos-db.js'

export const rotasPromocoes = Router()
export const depsPromocoes = {}                 // injetável: { chamar, api, espera, custosCliente, ... } (UI de teste / stubs)
recuperarPlanosPresos()                         // boot: plano que ficou 'executando' por queda do servidor (parado há > 10 min) é fechado com o que a auditoria provar que saiu

// ── validação de entrada ─────────────────────────────────────────────────────
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const primeiro = v => (Array.isArray(v) ? v[0] : v)
export const texto = (v, max = 500) => { const m = Number.isFinite(Number(max)) ? Number(max) : 500; const x = primeiro(v); return x == null || typeof x === 'object' ? '' : String(x).trim().slice(0, m) }
export const exigirTexto = (v, nome, max = 200) => { const t = texto(v, max); if (!t) throw erro(`informe "${nome}"`); return t }
// AUSENTE (undefined) => padrão declarado; PRESENTE porém inválido (''/null/false/[]/'abc'/fora da faixa) => 400 com mensagem.
// Nunca padrão silencioso, nunca coerção de ''/null/false/[] para 0 (que prendia no `min`: id:null desativava o aprendizado #1).
export const inteiro = (v, padrao, min, max, nome = 'valor') => {
  if (v === undefined) return padrao
  const x = v, n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*-?\d+\s*$/.test(x) ? Number(x) : NaN      // lista (parâmetro repetido/[1]) NÃO é escalar: 400
  if (!Number.isInteger(n) || n < min || n > max) throw erro(`"${nome}" deve ser um número inteiro entre ${min} e ${max}`)
  return n
}
export const itemId = v => { const t = texto(v, 20).toUpperCase(); if (!/^MLB\d{1,14}$/.test(t)) throw erro('anúncio inválido: use o código MLB (ex.: MLB1234567890)'); return t }
// Booleano: AUSENTE => `padrao`; reconhecido (true/false/1/0/sim/não/yes/no, qualquer caixa) => valor; o resto => 400 (nunca vira false calado).
const SIM = new Set(['1', 'true', 'sim', 's', 'yes']), NAO = new Set(['0', 'false', 'nao', 'não', 'n', 'no'])
export const simNao = (v, padrao = false, nome = 'valor') => {
  if (v === undefined) return padrao
  const s = typeof v === 'string' ? v.trim().toLowerCase() : typeof v === 'number' || typeof v === 'boolean' ? String(v) : ''     // lista/objeto/null => 400
  if (SIM.has(s)) return true
  if (NAO.has(s)) return false
  throw erro(`"${nome}" deve ser sim ou não (true, false, 1 ou 0)`)
}
const enumerado = (v, validos, padrao, nome) => {        // valor AUSENTE => padrão; presente fora da lista => 400 (nunca vira o padrão calado)
  if (v === undefined) return padrao
  const t = texto(v, 40).toLowerCase()
  if (!validos.includes(t)) throw erro(`"${nome}" deve ser um de: ${validos.join(', ')}`)
  return t
}
const pid = v => { const t = texto(v, 60); if (!/^[A-Za-z0-9_.\-~]{1,60}$/.test(t)) throw erro('campanha inválida'); return t }
const por = v => texto(v, 80) || 'operador'
const porObrigatorio = v => exigirTexto(v, 'por (nome de quem está aprovando/executando)', 80)
// GET lê a query; MUTAÇÃO (POST/PUT/DELETE) lê SÓ o corpo JSON — um POST "simples" cross-site (sem preflight) só consegue levar query string.
const dados = req => req.method === 'GET' || req.method === 'HEAD' ? { ...(req.query || {}) }
  : (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? { ...req.body } : {}
// mutação exige Content-Type: application/json (form/no-cors cross-site não consegue enviá-lo sem preflight, que este painel nunca aprova)
rotasPromocoes.use('/api/promocoes', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /^application\/json\b/i.test(req.headers['content-type'] || '')) return next()
  res.status(415).json({ erro: 'envie o corpo como JSON (Content-Type: application/json); parâmetros de mutação não vão na URL' })
})
const trata = fn => async (req, res) => {
  try { await fn(req, res) } catch (e) {
    if (!e.status) console.error('[promocoes]', e)
    res.status(e.status || 500).json({ erro: e.status ? e.message : 'erro interno no módulo de promoções (veja o log do servidor)', ...(e.status && e.extra ? e.extra : {}) })
  }
}
// ponytail: import dinâmico p/ o módulo de rotas não abrir o banco real ao ser importado em teste (depsPromocoes.conexoes = stub)
const conexoes = async () => (depsPromocoes.conexoes ? depsPromocoes.conexoes() : (await import('./lib/meli-contas.js')).listarConexoes())
// interruptor da coleta por cliente (perfil_cliente.coleta_promocoes; NULL = padrão da base): mesmo import dinâmico, stub em teste (depsPromocoes.coletaPromocoesDoCliente)
const coletaLigadaDe = async cliente => coletaLigada(depsPromocoes.coletaPromocoesDoCliente ? depsPromocoes.coletaPromocoesDoCliente(cliente) : (await import('./lib/perfil-cliente.js')).coletaPromocoesDoCliente(cliente))
const clienteConectado = async v => {
  const nome = exigirTexto(v, 'cliente')
  const lista = await conexoes()
  const c = lista.find(x => x.cliente === nome) || lista.find(x => norm(x.cliente) === norm(nome))
  if (!c) throw erro('cliente sem conta Mercado Livre conectada (conecte pela tela de integrações)', 404)
  return c.cliente
}
const exigirCliente = async req => clienteConectado(dados(req).cliente)

// ── jobs em memória (lock único, nomes próprios — não colide com o de rotas-planos.js) ──
const jobsPromo = new Map()
let jobPromoAtivo = null
function iniciarJobPromo(tipo, cliente, fn, por = '') {
  if (jobPromoAtivo && jobsPromo.get(jobPromoAtivo)?.estado === 'rodando') throw erro('já existe uma coleta/execução de promoções rodando — aguarde terminar', 409)
  const job = { id: `pj-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, tipo, cliente, por, estado: 'rodando', progresso: { fase: 'iniciando', feitos: 0, total: 0 }, inicio: new Date().toISOString(), resultado: null, erro: null }
  jobsPromo.set(job.id, job); jobPromoAtivo = job.id
  for (const k of [...jobsPromo.keys()].slice(0, -20)) jobsPromo.delete(k)
  Promise.resolve().then(() => fn(p => { job.progresso = p })).then(r => { job.resultado = r; job.estado = 'concluido' })
    .catch(e => { job.erro = e.message; job.estado = 'erro' }).finally(() => { job.fim = new Date().toISOString() })
  return job
}

// ── CSV: UTF-8 com BOM, ";", neutraliza injeção de fórmula (= + - @) em texto; número é número ──
export function paraCsv(linhas, colunas) {
  const cel = v => {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : ''
    let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x
    return `"${x}"`
  }
  return '﻿' + [colunas.map(cel).join(';'), ...linhas.map(l => colunas.map(c => cel(l[c])).join(';'))].join('\r\n')
}
const enviarCsv = (res, nome, linhas, colunas) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nome.replace(/[^a-z0-9._-]/gi, '_')}.csv"`)
  res.send(paraCsv(linhas, colunas))
}

// ── montagem das linhas por anúncio (compartilhada pelas rotas e pelo CSV) ───────────────────────
const marcasDeDecisoes = decisoes => { const m = new Map(); for (const d of decisoes) if (d.marcado && d.pid) { if (!m.has(d.item_id)) m.set(d.item_id, new Set()); m.get(d.item_id).add(d.pid) } return m }
async function contexto(cliente, extra = {}) {
  const e = await A.carregarEntrada(cliente, depsPromocoes)
  const decisoes = repo.lerDecisoes(cliente)
  const res = A.analisar({ ...e, marcasPorItem: marcasDeDecisoes(decisoes), ...extra })
  return { cliente, e, decisoes, res }
}
const partCand = (c, trilha, av) => ({
  pid: c.pid, nome: c.nome, tipo: c.tipo, preco: c.preco, meliPct: c.meliPct, mc: c.mc, mcPct: c.mcPct, fim: c.fim, offer_id: c.offer_id, trilha, semNome: !!c.semNome,
  // SMART sem nome pode ser relâmpago: nunca aparece como "passa piso" (o analista e o plano também a pulam)
  passaPiso: c.semNome ? false : av.regraTipo === 'livre' ? true : c.mcPct != null && c.mcPct >= Math.max(trilha === 'painel' ? av.pisoRelampago : av.piso, 0),
})
function montarLinhas({ cliente, e, decisoes, res }, { semRebate = false } = {}) {
  const efetivas = new Set(repo.marcasEfetivas(cliente).map(d => d.item_id))      // 'marcada' = o que de fato iria ao plano (hedge órfão / 🤖 aprovada vetada por recusa não contam)
  const porItem = new Map()
  for (const d of decisoes) { if (!porItem.has(d.item_id)) porItem.set(d.item_id, []); porItem.get(d.item_id).push(d) }
  const recs = new Map(); for (const r of res.recomendacoes) { if (!recs.has(r.item_id)) recs.set(r.item_id, []); recs.get(r.item_id).push(r) }
  const linhas = []
  for (const a of e.anuncios) {
    const av = res.avaliacoes.get(a.item_id), ofs = e.ofertasPorItem.get(a.item_id) || []
    const cands = [...av.candidatos.map(c => partCand(c, 'api', av)), ...av.relampago.candidatos.map(c => partCand(c, 'painel', av))]
    if (semRebate) for (const o of ofs.filter(o => o.status === 'candidate' && !ehRebate(o)))
      cands.push({ pid: o.pid, nome: o.nome || e.campanhas.get(o.pid)?.nome || o.pid, tipo: o.tipo, preco: o.preco, meliPct: o.meli_pct, mc: null, mcPct: null, fim: diaBR(o.fim) || diaBR(e.campanhas.get(o.pid)?.fim), offer_id: o.offer_id, trilha: 'api', passaPiso: false, semRebate: true })
    const participa = ofs.filter(o => ['started', 'pending'].includes(o.status))
    if (!cands.length && !participa.length) continue
    const ds = porItem.get(a.item_id) || []
    const analistaGravada = ds.filter(d => d.origem === 'analista' && d.marcado)
    // preco/mc_pct = os números da sugestão (a tela mostra e devolve no "Aprovar": a aprovação vale para ESTES números)
    const sugerida = analistaGravada.length ? analistaGravada.map(d => ({ pid: d.pid, regra: d.regra, motivo: d.motivo, obs: d.obs, aprovado: d.aprovado, via: d.via, gravada: true, preco: d.preco ?? null, mc_pct: d.mc_pct ?? null }))
      : (recs.get(a.item_id) || []).map(r => ({ pid: r.pid, regra: r.regra, motivo: r.motivo, obs: r.obs, aprovado: false, via: r.via, gravada: false, preco: r.preco ?? null, mc_pct: r.mc_pct ?? null }))
    const humanas = ds.filter(d => d.origem === 'humano' && d.pid).map(d => ({ pid: d.pid, marcado: d.marcado, por: d.por, em: d.em, ordem_direta: d.ordem_direta, motivo: d.motivo, estado: d.estado }))
    const semMarcaRow = ds.find(d => d.origem === 'analista' && !d.marcado && d.regra === 'SEM_MARCA' && d.via === 'api')
    const melhor = [...cands].filter(c => !c.semRebate).sort((x, y) => (y.mcPct ?? -Infinity) - (x.mcPct ?? -Infinity) || (y.meliPct || 0) - (x.meliPct || 0))[0] || cands[0] || null
    const efetivaMarcada = efetivas.has(a.item_id)
    const motivo = av.motivoSemMarca
    const situacao = efetivaMarcada ? 'marcada' : sugerida.length ? 'sugerida' : (!cands.length && participa.some(o => ehRebate(o))) ? 'participando'
      : av.estado === 'sem_custo' ? 'sem_custo' : ['abaixo_piso', 'mc_negativa'].includes(motivo?.codigo) ? 'abaixo_piso' : participa.some(o => ehRebate(o)) ? 'participando' : 'sem_marca'
    linhas.push({
      item_id: a.item_id, sku: a.sku, titulo: a.titulo, permalink: a.permalink, curva: a.curva, fat30: a.fat30, estoque: a.estoque, status: a.status, under_review: a.under_review, protegido: a.protegido,
      atual: av.atual ? { nome: av.atual.nome, preco: av.atual.preco, mcPct: av.atual.mcPct } : null, vigente: av.vigente, melhor,
      custo: { ok: av.custos.ok, estado: av.custos.estado || 'ok', faltando: av.custos.faltando || [], modo: av.custos.modo || '', origem: a.custo_resolvido?.origem || '', sku_custo: a.custo_resolvido?.sku_custo || '' }, piso: av.piso, regraSku: av.regraSku, estado: av.estado,
      sugerida, marcadas: humanas, motivoSemMarca: semMarcaRow?.motivo || motivo?.texto || '', avisoP: av.avisoP, avisos: av.avisos, outras: av.outras,
      candidatos: cands, situacao, participa: participa.map(o => ({ nome: o.nome || e.campanhas.get(o.pid)?.nome || o.pid, tipo: o.tipo, status: o.status, preco: o.preco, meliPct: o.meli_pct, fim: o.fim })),
    })
  }
  const ordem = { A: 0, B: 1, C: 2 }
  return linhas.sort((x, y) => (ordem[x.curva] ?? 3) - (ordem[y.curva] ?? 3) || (y.fat30 || 0) - (x.fat30 || 0))
}

// ── clientes com conta ML (atalho do seletor) ──────────────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/clientes', trata(async (req, res) => {
  const lista = await conexoes()
  res.json(await Promise.all(lista.map(async c => ({ cliente: c.cliente, nickname: c.nickname, coleta: repo.lerColeta(c.cliente)?.concluida_em || null, coleta_ligada: await coletaLigadaDe(c.cliente) }))))
}))

// ── resumo: KPIs + invariante + pendências honestas ───────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/resumo', trata(async (req, res) => {
  const cliente = await exigirCliente(req)
  const ctx = await contexto(cliente), { e, decisoes } = ctx
  const coleta = repo.lerColeta(cliente), fresca = repo.coletaFresca(cliente)
  const porItemEfetivo = new Set(repo.marcasEfetivas(cliente).map(d => d.item_id))      // KPI "Marcadas" = o que de fato iria ao plano (mesma régua de gerarPlano)
  const recusas = repo.recusasHumanas(cliente), sugestoesPendentes = decisoes.filter(d => d.origem === 'analista' && d.marcado && !d.aprovado && d.pid)
  const participando = new Set(), participandoRebate = new Set()
  for (const [id, ofs] of e.ofertasPorItem) { const at = ofs.filter(o => ['started', 'pending'].includes(o.status)); if (at.length) participando.add(id); if (at.some(o => ehRebate(o))) participandoRebate.add(id) }
  const inv = coleta ? await A.lerInvariante(cliente, { ...depsPromocoes, entrada: e }) : null
  const r = ctx.res.resumo
  const pend = []
  if (!coleta) pend.push({ codigo: 'SEM_COLETA', estado: 'NEEDS_EXTERNAL_DATA', texto: 'Nenhuma coleta feita ainda — rode "Coletar agora".' })
  else if (!fresca.fresca) pend.push({ codigo: 'COLETA_VELHA', estado: 'ATENCAO', texto: `${fresca.motivo}. O analista não analisa foto velha: refaça a coleta.` })
  if (r.sem_custo) pend.push({ codigo: 'SEM_CUSTO', estado: 'NEEDS_EXTERNAL_DATA', texto: `${r.sem_custo} anúncio(s) com campanha de rebate elegível e SEM CUSTO ou sem tarifa/frete coletada (o motivo está em cada anúncio): nada é recomendado nem inferido até cadastrar o custo (aba Custos, ou planilha/Bling/Tiny em Integrações → Custos) ou coletar a tarifa.` })
  if (e.config.imposto_pct == null && !e.custosCliente?.imposto_pct) pend.push({ codigo: 'SEM_IMPOSTO', estado: 'NEEDS_EXTERNAL_DATA', texto: 'Alíquota de imposto não configurada para este cliente — sem ela nenhuma MC é calculada (aba Custos → Configuração).' })
  const skusSemCusto = [...new Set(e.anuncios.filter(a => a.sku && !(A.custoDoItem(a, e.custosSku) > 0)).map(a => a.sku.toLowerCase()))].length
  if (skusSemCusto && !e.custosCliente) pend.push({ codigo: 'CUSTOS_NAO_CADASTRADOS', estado: 'ATENCAO', texto: `${skusSemCusto} SKU(s) sem custo cadastrado e sem fallback percentual (custos_cliente): se surgir campanha de rebate para eles, ficam "SEM CUSTO" e nada é recomendado.` })
  if (r.under_review) pend.push({ codigo: 'UNDER_REVIEW', estado: 'NOT_AVAILABLE', texto: `${r.under_review} anúncio(s) under_review: o ML recusa promoção até a revisão terminar (ação do dono).` })
  if (!e.vendas.disponivel) pend.push({ codigo: 'SEM_VENDAS', estado: 'NEEDS_EXTERNAL_DATA', texto: e.vendas.motivo })
  else if (e.vendas.ate && (Date.parse(e.hoje) - Date.parse(e.vendas.ate)) / 86400000 > 3) pend.push({ codigo: 'VENDAS_VELHAS', estado: 'ATENCAO', texto: `Série de vendas (curva ABC e faturamento 30d) vai só até ${e.vendas.ate} — atualize a coleta de vendas do cliente.` })
  if (e.vendas.disponivel && e.vendas.cobertura && !e.vendas.cobertura.completa) pend.push({ codigo: 'VENDAS_INCOMPLETAS', estado: 'ATENCAO', texto: `Faturamento 30d calculado com ${e.vendas.cobertura.dias_com_dado} de 30 dias coletados${e.vendas.cobertura.dias_truncados ? ` (${e.vendas.cobertura.dias_truncados} truncado(s))` : ''}: curva ABC e ganho/mês estão SUBESTIMADOS até recoletar as vendas.` })
  for (const l of coleta?.limites || []) pend.push({ codigo: l.codigo, estado: l.estado, texto: l.texto })
  pend.push(...pendenciasCustos(cliente))       // CUSTO_* das fontes externas (custo velho, erro, reautorizar, quarentena, rejeitadas, não vistos)
  res.json({
    cliente, hoje: e.hoje, config: e.config, coleta: coleta && { estado: coleta.estado, concluida_em: coleta.concluida_em, resumo: coleta.resumo }, frescor: fresca, vendas: e.vendas, custos_cliente: e.custosCliente ? { imposto_pct: e.custosCliente.imposto_pct ?? null } : null,
    coleta_ligada: await coletaLigadaDe(cliente),      // false = a madrugada não coleta este cliente (a tela avisa: "ligue em Cliente → Configurar"); a coleta manual continua livre
    kpis: {
      elegiveis: r.com_elegivel, elegiveis_ge_piso: r.com_elegivel_ge_piso,
      // sugeridas = o que "Aprovar" de fato aprova; as barradas por recusa 👤/IGNORAR/Revisar toda rodada (recusasHumanas) ficam à parte (a rota as barra e audita)
      marcadas: porItemEfetivo.size, sugeridas: new Set(sugestoesPendentes.filter(d => !recusas.bloqueado(d.item_id, d.pid)).map(d => d.item_id)).size, sugeridas_barradas: new Set(sugestoesPendentes.filter(d => recusas.bloqueado(d.item_id, d.pid)).map(d => d.item_id)).size,
      aprovadas_analista: decisoes.filter(d => d.origem === 'analista' && d.marcado && d.aprovado).length, cobertura_incerta: r.cobertura_incerta,
      participando: participando.size, participando_rebate: participandoRebate.size, descobertos: r.descobertos, sem_custo: r.sem_custo, skus_sem_custo: skusSemCusto, rebate_pior: r.rebate_pior, lembretes: r.lembretes, under_review: r.under_review,
    },
    invariante: inv, execucao: { habilitada: !!e.config.execucao_habilitada, max_itens: e.config.execucao_max_itens }, pendencias: pend,
    // o que "Aprovar todas" mostra e devolve: cada sugestão 🤖 aprovável COM os números exibidos (a rota só aprova se ainda forem estes)
    sugestoes_pendentes: sugestoesPendentes.filter(d => !recusas.bloqueado(d.item_id, d.pid)).map(d => ({ item_id: d.item_id, pid: d.pid, preco: d.preco ?? null, mc_pct: d.mc_pct ?? null })),
  })
}))

// ── coleta (job) ───────────────────────────────────────────────────────────────────────────────────
rotasPromocoes.post('/api/promocoes/coletar', trata(async (req, res) => {
  const cliente = await exigirCliente(req), comVendas = simNao(dados(req).vendas, false, 'vendas'), quem = exigirTexto(dados(req).por, 'por (seu nome: quem disparou a coleta)', 80)      // quem disparou fica na auditoria e no job (nunca 'sistema' quando a tela mandou o nome)
  const job = iniciarJobPromo('coleta', cliente, async prog => {
    let vendas = null
    if (comVendas) {
      try { const { coletarCliente } = await import('./lib/meli-serie.js'); vendas = await coletarCliente(cliente, { aoProgredir: p => prog({ ...p, fase: `vendas: ${p.fase}` }) }) }
      catch (e) { vendas = { erro: e.message.slice(0, 160) } }
    }
    const r = await coletarPromocoes(cliente, { aoProgredir: prog, deps: depsPromocoes, por: quem })
    return { ...r, vendas }
  }, quem)
  res.json({ job: job.id })
}))
rotasPromocoes.get('/api/promocoes/job/:id', trata(async (req, res) => {
  const cliente = await exigirCliente(req), j = jobsPromo.get(texto(req.params.id, 40))
  if (!j || j.cliente !== cliente) throw erro('job não encontrado', 404)
  res.json(j)
}))

// ── elegíveis ───────────────────────────────────────────────────────────────────────────────────────
function filtrar(linhas, q) {
  const curvas = texto(q.curva, 20).toUpperCase().split(/[,\s]+/).filter(x => ['A', 'B', 'C'].includes(x))
  const sit = texto(q.situacao, 30), camp = texto(q.campanha, 80), busca = norm(texto(q.q, 80)), soPiso = simNao(q.so_piso, false, 'so_piso')
  const base = linhas.filter(l => sit === 'participando' ? true : l.candidatos.length > 0)
  const filtradas = base.filter(l => (!curvas.length || curvas.includes(l.curva)) && (!sit || l.situacao === sit)
    && (!camp || l.candidatos.some(c => c.pid === camp || norm(c.nome).includes(norm(camp)))) && (!soPiso || l.candidatos.some(c => c.passaPiso && !c.semRebate))
    && (!busca || norm(`${l.sku} ${l.item_id} ${l.titulo}`).includes(busca)))
  const totais = {}; for (const l of base) totais[l.situacao] = (totais[l.situacao] || 0) + 1
  return { filtradas, totais, total_base: base.length }
}
rotasPromocoes.get('/api/promocoes/elegiveis', trata(async (req, res) => {
  const cliente = await exigirCliente(req)
  const linhas = montarLinhas(await contexto(cliente), { semRebate: simNao(req.query.sem_rebate, false, 'sem_rebate') })
  const { filtradas, totais, total_base } = filtrar(linhas, req.query)
  const limite = inteiro(req.query.limite, 50, 1, 200, 'limite'), pagina = inteiro(req.query.pagina, 1, 1, 10_000, 'pagina')
  const coleta = repo.coletaFresca(cliente)
  res.json({ total: filtradas.length, total_base, totais, pagina, limite, itens: filtradas.slice((pagina - 1) * limite, pagina * limite), coleta })
}))

// ── marcar / desmarcar (humano) ────────────────────────────────────────────────────────────────────
rotasPromocoes.post('/api/promocoes/marcar', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  const item = itemId(b.item_id), camp = pid(b.pid)
  const m = b.marcado === null || b.marcado === 'limpar' ? null : b.marcado === true || b.marcado === 1 || b.marcado === '1' ? true : b.marcado === false || b.marcado === 0 || b.marcado === '0' ? false : undefined
  if (m === undefined) throw erro('"marcado" deve ser true (marca), false (recusa) ou null (limpa)')
  const c = await contexto(cliente), anuncio = c.e.anuncios.find(a => a.item_id === item)
  if (!anuncio) throw erro('anúncio não encontrado na última coleta', 404)
  const oferta = (c.e.ofertasPorItem.get(item) || []).find(o => o.pid === camp && o.status === 'candidate')
  if (m === true && !oferta) throw erro('esta campanha não está como candidata na última coleta — refaça a coleta antes de marcar', 409)
  const av = c.res.avaliacoes.get(item), cand = [...av.candidatos, ...av.relampago.candidatos].find(x => x.pid === camp)
  const via = oferta && ehRelampagoSmart(oferta) ? 'painel' : 'api'
  const ordem = simNao(b.ordem_direta, false, 'ordem_direta')
  const d = repo.marcarHumano(cliente, { item_id: item, pid: camp, marcado: m, via, ordem_direta: m === true && ordem, motivo: texto(b.motivo, 500), obs: texto(b.obs, 1000),
    offer_id: oferta?.offer_id || '', preco: oferta?.preco ?? null, meli_pct: oferta?.meli_pct ?? null, mc: cand?.mc ?? null, mc_pct: cand?.mcPct ?? null }, por(b.por))
  res.json({ ok: true, decisao: d })
}))
rotasPromocoes.post('/api/promocoes/aprovar-analista', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  // a aprovação vale para os NÚMEROS que o dono viu: cada item traz {item_id, pid, preco, mc_pct} da tela. "todos: true" (aprovar o que o servidor tiver agora, números
  // que ninguém viu) não existe mais — "Aprovar todas" envia a lista exibida (/resumo.sugestoes_pendentes)
  if (b.todos !== undefined) throw erro('"todos" não é aceito: envie "itens" com a lista exibida ({item_id, pid, preco, mc_pct} de cada sugestão) — a aprovação vale para os números que você viu')
  if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > 2000) throw erro('informe "itens" (lista de {item_id, pid, preco, mc_pct} exibidos na tela, máx. 2000)')
  const numero = (v, nome) => { if (v === null || (typeof v === 'number' && Number.isFinite(v))) return v; throw erro(`"${nome}" de cada item deve ser o número exibido na tela (ou null quando a tela mostrou "—")`) }
  const pares = b.itens.map(i => ({ item_id: itemId(i?.item_id), pid: pid(i?.pid), preco: numero(i?.preco, 'preco'), mc_pct: numero(i?.mc_pct, 'mc_pct') }))
  const bl = repo.recusasHumanas(cliente), barradas = pares.filter(p => bl.bloqueado(p.item_id, p.pid)).length      // recusa 👤 / bloqueio do dono nunca vira aprovação (aprovarAnalista audita)
  const mudaram = [], aprovadas = repo.aprovarAnalista(cliente, pares, por(b.por), mudaram)
  if (mudaram.length) throw Object.assign(erro(`${mudaram.length} sugestão(ões) 🤖 mudaram desde que a tela carregou (ex.: ${mudaram[0].item_id}/${mudaram[0].pid}${mudaram[0].atual ? `: preço ${mudaram[0].visto.preco ?? '—'} → ${mudaram[0].atual.preco ?? '—'}, MC% ${mudaram[0].visto.mc_pct ?? '—'} → ${mudaram[0].atual.mc_pct ?? '—'}` : ': não existe mais'}) — NADA foi aprovado. Recarregue a tela, confira os números novos e aprove de novo.`, 409),
    { extra: { codigo: 'numeros_mudaram', numeros_mudaram: mudaram.slice(0, 200), aprovadas: 0 } })
  res.json({ aprovadas, bloqueadas_por_recusa: barradas })
}))
rotasPromocoes.post('/api/promocoes/protegido', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  if (b.protegido === undefined) throw erro('informe "protegido" (true ou false) — sem ele a proteção do anúncio não é alterada')
  repo.definirProtegido(cliente, itemId(b.item_id), simNao(b.protegido, false, 'protegido'), por(b.por))
  res.json({ ok: true })
}))

// ── analista (dry-run por padrão; aplicar só com aplicar === true) ──────────────────────────────────
rotasPromocoes.post('/api/promocoes/analista', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  res.json(await A.rodarAnalista(cliente, { aplicar: b.aplicar === true, por: por(b.por), permitirColetaVelha: b.permitir_coleta_velha === true, deps: depsPromocoes }))
}))

// ── participando, cobertura, rebate pior, relâmpago ─────────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/participando', trata(async (req, res) => {
  const cliente = await exigirCliente(req)
  const dias = inteiro(req.query.dias, repo.getConfig(cliente).dias_vigia, 1, 60, 'dias')
  const { e, res: r } = await contexto(cliente, { dias })
  const linhas = []
  for (const a of e.anuncios) {
    const ofs = e.ofertasPorItem.get(a.item_id) || [], ativos = ofs.filter(o => ['started', 'pending'].includes(o.status))
    if (!ativos.length) continue
    const cob = coberturaContinua(ofs, e.hoje, { campanhas: e.campanhas }), av = r.avaliacoes.get(a.item_id)
    linhas.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, fat30: a.fat30, protegido: a.protegido, status: a.status, cobreAte: cob.cobreAte, cobreAteRebate: cob.cobreAteRebate, cobreAteSemRebate: cob.cobreAteSemRebate, suspeita: cob.suspeita, avisosData: cob.avisos,
      vigente: av?.vigente || null, ofertas: ativos.map(o => ({ nome: o.nome || e.campanhas.get(o.pid)?.nome || o.pid, tipo: o.tipo, status: o.status, preco: o.preco, meliPct: o.meli_pct, fim: o.fim || e.campanhas.get(o.pid)?.fim || '', rebate: ehRebate(o) })) })
  }
  linhas.sort((x, y) => (y.fat30 || 0) - (x.fat30 || 0))
  const coleta = repo.lerColeta(cliente)
  res.json({ dias, hoje: e.hoje, participando: linhas, cobertura: r.vigias.cobertura, rebate_pior: r.vigias.rebatePior, derrubadas: coleta?.resumo?.derrubadas || null, coleta: repo.coletaFresca(cliente) })
}))
rotasPromocoes.get('/api/promocoes/relampago', trata(async (req, res) => {
  const cliente = await exigirCliente(req)
  const { e, res: r, decisoes } = await contexto(cliente)
  const linhas = []
  let lightning = 0
  for (const a of e.anuncios) {
    const av = r.avaliacoes.get(a.item_id), ofs = e.ofertasPorItem.get(a.item_id) || []
    lightning += ofs.filter(o => o.status === 'candidate' && ehLightning(o)).length
    const vivas = ofs.filter(o => ehRelampagoSmart(o) && ['started', 'pending'].includes(o.status))
    if (!av.relampago.candidatos.length && !vivas.length) continue
    const ds = decisoes.filter(d => d.item_id === a.item_id && d.via === 'painel' && d.marcado)
    linhas.push({ item_id: a.item_id, sku: a.sku, titulo: a.titulo, curva: a.curva, fat30: a.fat30, piso: av.pisoRelampago, custo: { ok: av.custos.ok, estado: av.custos.estado || 'ok' },
      candidatos: av.relampago.candidatos.map(c => partCand(c, 'painel', av)), vivas: vivas.map(o => ({ nome: o.nome, status: o.status, preco: o.preco, meliPct: o.meli_pct })),
      sugerida: av.relampago.marcaria ? { pid: av.relampago.marcaria.pid, motivo: av.relampago.marcaria.motivo } : null, motivoSemMarca: av.relampago.motivoSemMarca?.texto || '', marcadas: ds.map(d => ({ pid: d.pid, origem: d.origem, por: d.por })) })
  }
  linhas.sort((x, y) => (y.fat30 || 0) - (x.fat30 || 0))
  res.json({ itens: linhas, lightning_ignoradas: lightning, avisos: ['Relâmpago SMART só entra pelo PAINEL do Mercado Livre — este sistema nunca o executa por API.', 'LIGHTNING (sem rebate) nunca é recomendada (regra do dono, 02/09/2026).', 'O dia/hora do slot só existe no painel; a tela manda no preço (confira antes de entrar).'] })
}))

// ── regras por SKU ──────────────────────────────────────────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/regras-sku', trata(async (req, res) => res.json(repo.listarRegrasSku(await exigirCliente(req)))))
rotasPromocoes.post('/api/promocoes/regras-sku', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  repo.salvarRegraSku(cliente, { mlb: texto(b.mlb, 20), sku: texto(b.sku, 80), status: texto(b.status, 80), nota: texto(b.nota, 500) }, por(b.por))
  res.json({ ok: true, regras: repo.listarRegrasSku(cliente) })
}))
rotasPromocoes.delete('/api/promocoes/regras-sku', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  repo.removerRegraSku(cliente, { mlb: texto(b.mlb, 20), sku: texto(b.sku, 80) }, por(b.por))
  res.json({ ok: true, regras: repo.listarRegrasSku(cliente) })
}))

// ── custos por SKU + configuração ───────────────────────────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/custos', trata(async (req, res) => {
  const cliente = await exigirCliente(req)
  const { e, res: r } = await contexto(cliente)
  const semCusto = new Map()
  for (const s of r.vigias.semCusto) { const k = s.sku || s.item_id; const x = semCusto.get(k) || { sku: s.sku, itens: [], faltando: s.faltando }; x.itens.push(s.item_id); semCusto.set(k, x) }
  const cad = new Map()
  for (const a of e.anuncios) if (a.sku && !(A.custoDoItem(a, e.custosSku) > 0)) { const x = cad.get(a.sku.toLowerCase()) || { sku: a.sku, anuncios: 0, fat30: 0 }; x.anuncios++; x.fat30 += a.fat30 || 0; cad.set(a.sku.toLowerCase(), x) }
  // skus = só o manual (compatibilidade); skus_efetivos = o que o analista de fato usa, com fonte/campo/frescor ({ total, itens } até 1.000)
  res.json({ skus: repo.listarCustosSku(cliente), skus_efetivos: custosEfetivosDetalhe(cliente, { limite: 1000 }), custos_pendencias: pendenciasCustos(cliente),
    sem_custo: [...semCusto.values()], skus_sem_custo: [...cad.values()].sort((x, y) => y.fat30 - x.fat30).slice(0, 500), percentuais: e.custosCliente, config: e.config })
}))
rotasPromocoes.post('/api/promocoes/custos/importar', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  let linhas, rejeitadas = []
  if (Array.isArray(b.linhas)) {
    if (b.linhas.length > 20000) throw erro('máximo de 20.000 linhas por importação')
    // mesma regra do texto colado (lerCusto): custo ausente/''/null/NaN/≤0/booleano/lista é REJEITADO com motivo — nunca vira 0 (MC inflada)
    linhas = []; b.linhas.forEach((l, i) => {
      const sku = typeof l?.sku === 'string' || typeof l?.sku === 'number' ? String(l.sku).trim() : '', c = lerCusto(l?.custo)
      if (!sku || sku.length > 80) rejeitadas.push({ linha: i + 1, motivo: 'SKU vazio ou longo demais' })
      else if (c.motivo) rejeitadas.push({ linha: i + 1, motivo: c.motivo })
      else linhas.push({ sku, custo: c.custo })
    })
  } else {
    if (typeof b.texto !== 'string' || !b.texto.trim()) throw erro('cole o texto (SKU;custo por linha) ou envie "linhas"')
    if (b.texto.length > 900_000) throw erro('texto longo demais (máx. 900.000 caracteres): divida a importação — cortar no meio truncaria o último custo')
    ;({ linhas, rejeitadas } = parseCustosCsv(b.texto))
  }
  if (!linhas.length) throw Object.assign(erro(`nenhuma linha válida${rejeitadas.length ? ` (${rejeitadas.length} rejeitada(s): ${rejeitadas[0].motivo})` : ''}`), { extra: { rejeitadas: rejeitadas.slice(0, 50), total_rejeitadas: rejeitadas.length } })
  res.json({ importados: repo.importarCustosSku(cliente, linhas, texto(b.fonte, 80) || 'importação', por(b.por)), rejeitadas: rejeitadas.slice(0, 50), total_rejeitadas: rejeitadas.length })
}))
rotasPromocoes.get('/api/promocoes/config', trata(async (req, res) => res.json(repo.getConfig(await exigirCliente(req)))))
rotasPromocoes.post('/api/promocoes/config', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req), patch = {}
  for (const k of ['piso_mc', 'piso_relampago', 'imposto_pct', 'dias_vigia', 'janela_cobertura_dias', 'hedge_cobertura', 'execucao_max_itens']) if (k in b) patch[k] = typeof b[k] === 'string' && b[k].trim() === '' ? null : b[k]
  if ('execucao_habilitada' in b) {
    // ligar a execução exige a frase inteira — não existe botão para isso na tela (ver docs/promocoes-por-cliente.md)
    const ligar = simNao(b.execucao_habilitada, undefined, 'execucao_habilitada')          // lixo (null/[1]/'abc') => 400, nunca coerção p/ 0/1
    if (ligar && b.habilitacao !== 'HABILITAR EXECUCAO REAL') {
      repo.auditar(cliente, 'execucao_bloqueada', { autor: por(b.por), detalhe: 'tentativa de LIGAR a execução sem a frase de habilitação (ou com frase errada)', depois: { campo: 'execucao_habilitada' } })     // tentativa barrada também é auditada
      throw erro('para LIGAR a execução envie também habilitacao: "HABILITAR EXECUCAO REAL" (veja o doc de segurança)', 403)
    }
    patch.execucao_habilitada = ligar ? 1 : 0
  }
  res.json(repo.setConfig(cliente, patch, por(b.por)))
}))

// ── interrogatório e aprendizados ───────────────────────────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/interrogatorio', trata(async (req, res) => {
  const cliente = await exigirCliente(req), { e, decisoes, res: r } = await contexto(cliente)
  res.json({ ...A.interrogar({ avaliacoes: r.avaliacoes, decisoes, anuncios: e.anuncios, aprendizados: e.aprendizados, ofertasPorItem: e.ofertasPorItem, campanhas: e.campanhas }), lembretes: r.vigias.lembretes, aprendizados: repo.listarAprendizados(cliente) })
}))
rotasPromocoes.get('/api/promocoes/aprendizados', trata(async (req, res) => res.json(repo.listarAprendizados(await exigirCliente(req)))))
rotasPromocoes.post('/api/promocoes/aprendizados', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  const id = repo.registrarAprendizado(cliente, { padrao: texto(b.padrao, 60), escopo_tipo: enumerado(b.escopo_tipo, ['item', 'sku', 'global'], 'global', 'escopo_tipo'), escopo_valor: texto(b.escopo_valor, 80), contexto: texto(b.contexto, 2000), resposta: texto(b.resposta, 2000), regra_destilada: texto(b.regra_destilada, 1000), acao: enumerado(b.acao, ['nota', 'ignorar', 'regra_sku'], 'nota', 'acao'), parametro: texto(b.parametro, 80) }, por(b.por))
  res.json({ ok: true, id, aprendizados: repo.listarAprendizados(cliente) })
}))
rotasPromocoes.post('/api/promocoes/aprendizados/desativar', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  const id = inteiro(b.id, undefined, 1, 1e9, 'id')                // id ausente/null/''/0/-3 NUNCA vira o aprendizado #1
  if (id === undefined) throw erro('informe "id" do aprendizado')
  res.json({ ok: true, regra_desfeita: repo.desativarAprendizado(cliente, id, por(b.por)) })      // '' = não havia regra por SKU deste aprendizado
}))

// ── plano (dry-run → aprovação → [execução travada] → sync) ─────────────────────────────────────────
const vistaPlano = (cliente, p) => p && ({ ...p, expirado: p.estado === 'dry-run' || p.estado === 'aprovado' ? planoExpirado(p) : false, execucao_habilitada: !!repo.getConfig(cliente).execucao_habilitada, espera_propagacao_min: ESPERA_PROPAGACAO_MIN })
rotasPromocoes.post('/api/promocoes/plano', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  if (!repo.marcasEfetivas(cliente).length) throw erro('nenhuma marca efetiva (👤 sua, ou 🤖 já aprovada) para planejar', 409)
  const job = iniciarJobPromo('plano', cliente, prog => gerarPlano(cliente, { por: por(b.por), deps: depsPromocoes, aoProgredir: prog }))
  res.json({ job: job.id })
}))
rotasPromocoes.get('/api/promocoes/plano', trata(async (req, res) => {
  const cliente = await exigirCliente(req), id = texto(req.query.id, 40)
  recuperarPlanosPresos(cliente)                                  // plano preso em 'executando' é fechado ANTES de ser lido
  const p = id ? repo.lerPlano(cliente, id) : repo.ultimoPlano(cliente)
  if (!p) return res.json({ plano: null })
  res.json({ plano: vistaPlano(cliente, p) })
}))
rotasPromocoes.get('/api/promocoes/planos', trata(async (req, res) => { const cliente = await exigirCliente(req); recuperarPlanosPresos(cliente); res.json(repo.listarPlanos(cliente, inteiro(req.query.limite, 20, 1, 100, 'limite'))) }))
// quem aprova/executa é obrigatório; faltar é tentativa barrada e também fica na auditoria (promo_auditoria)
const quemObrigatorio = (cliente, evento, v, plano) => { try { return porObrigatorio(v) } catch (e) { repo.auditar(cliente, evento, { detalhe: e.message, depois: { plano } }); throw e } }
rotasPromocoes.post('/api/promocoes/plano/aprovar', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req), id = exigirTexto(b.id, 'id', 40)
  res.json({ plano: vistaPlano(cliente, aprovarPlano(cliente, id, quemObrigatorio(cliente, 'plano_aprovacao_bloqueada', b.por, id))) })
}))
// A execução ao vivo está TRAVADA por duas chaves (config do cliente + confirmar === true). Sem as duas, devolve 403 {erro, motivo} ANTES de criar o job e NADA é chamado.
rotasPromocoes.post('/api/promocoes/plano/executar', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req), id = exigirTexto(b.id, 'id', 40)
  const confirmar = req.body?.confirmar                        // valor BRUTO: só `true` (booleano) abre a chave 2
  const quem = quemObrigatorio(cliente, 'execucao_bloqueada', b.por, id)
  const barra = (detalhe, e) => { repo.auditar(cliente, 'execucao_bloqueada', { autor: quem, detalhe, depois: { plano: id } }); throw e }
  const t = verificarTravas({ cliente, config: repo.getConfig(cliente), confirmar, plano: repo.lerPlano(cliente, id) })      // as travas que não dependem de rede, na hora (o executor as confere de novo)
  if (!t.liberado) barra(t.motivos.join(' | '), Object.assign(erro(`execução BLOQUEADA: ${t.motivos.join('; ')}`, 403), { extra: { motivo: t.motivos.join(' | ') } }))
  let job
  try { job = iniciarJobPromo('execucao', cliente, () => executarPlano(cliente, id, { confirmar, por: quem, deps: depsPromocoes })) } catch (e) { barra(e.message, e) }      // lock global (409)
  res.json({ job: job.id })
}))
rotasPromocoes.post('/api/promocoes/plano/sync', trata(async (req, res) => {
  const cliente = await exigirCliente(req), b = dados(req)
  res.json(await sincronizarPosExecucao(cliente, exigirTexto(b.id, 'id', 40), { deps: depsPromocoes, por: exigirTexto(b.por, 'por (seu nome: quem pediu o sync)', 80) }))      // o autor entra na auditoria (nunca 'sistema')
}))

// ── auditoria e exportação ──────────────────────────────────────────────────────────────────────────
rotasPromocoes.get('/api/promocoes/auditoria', trata(async (req, res) => {
  const cliente = await exigirCliente(req)
  res.json(repo.listarAuditoria(cliente, { limite: inteiro(req.query.limite, 200, 1, 1000, 'limite'), evento: texto(req.query.evento, 40), item_id: texto(req.query.item_id, 20).toUpperCase() }))
}))
rotasPromocoes.get('/api/promocoes/exportar.csv', trata(async (req, res) => {
  const cliente = await exigirCliente(req), tipo = texto(req.query.tipo, 20) || 'elegiveis'
  if (tipo === 'auditoria') {
    const l = repo.listarAuditoria(cliente, { limite: 1000 }).map(a => ({ Quando: a.em, Evento: a.evento, Anúncio: a.item_id, Campanha: a.pid, Autor: a.autor, Antes: a.antes_json, Depois: a.depois_json, Detalhe: a.detalhe }))
    return enviarCsv(res, 'promocoes-auditoria', l, ['Quando', 'Evento', 'Anúncio', 'Campanha', 'Autor', 'Antes', 'Depois', 'Detalhe'])
  }
  if (tipo === 'plano') {
    const p = texto(req.query.id, 40) ? repo.lerPlano(cliente, texto(req.query.id, 40)) : repo.ultimoPlano(cliente)
    if (!p) throw erro('plano não encontrado', 404)
    const l = p.itens.map(i => ({ Empresa: cliente, MLB: i.item_id, SKU: i.sku, Campanha: i.campanha, Ação: i.acao, Motivo: i.motivo, Detalhe: i.detalhe, Método: i.chamada?.metodo || '', Caminho: i.chamada?.caminho || '', Corpo: i.chamada ? JSON.stringify(i.chamada.corpo) : '' }))
    return enviarCsv(res, `promocoes-plano-${p.id}`, l, ['Empresa', 'MLB', 'SKU', 'Campanha', 'Ação', 'Motivo', 'Detalhe', 'Método', 'Caminho', 'Corpo'])
  }
  if (tipo === 'descobertos') {
    const dias = inteiro(req.query.dias, repo.getConfig(cliente).dias_vigia, 1, 60, 'dias')      // o CSV segue a janela escolhida na tela (7/14/...), não só a da config
    const { res: r } = await contexto(cliente, { dias })
    const l = r.vigias.cobertura.alertas.map(a => ({ Empresa: cliente, MLB: a.item_id, SKU: a.sku, Curva: a.curva, 'Faturamento 30d': a.fat30, 'Cobre até': a.cobreAte || 'DESCOBERTO', 'Cobre até (com rebate)': a.cobreAteRebate || '', 'Cobre até (sem rebate)': a.cobreAteSemRebate || '', Saída: a.saida, 'Preço manual sugerido': a.precoManual ?? '', Nota: a.manualNota }))
    return enviarCsv(res, 'promocoes-descobertos', l, ['Empresa', 'MLB', 'SKU', 'Curva', 'Faturamento 30d', 'Cobre até', 'Cobre até (com rebate)', 'Cobre até (sem rebate)', 'Saída', 'Preço manual sugerido', 'Nota'])
  }
  if (tipo !== 'elegiveis') throw erro('tipo inválido: elegiveis | plano | auditoria | descobertos')
  const linhas = filtrar(montarLinhas(await contexto(cliente), { semRebate: simNao(req.query.sem_rebate, false, 'sem_rebate') }), req.query).filtradas
  const l = linhas.map(x => ({
    Empresa: cliente, Curva: x.curva, 'Faturamento 30d': x.fat30, SKU: x.sku, MLB: x.item_id, Anúncio: x.titulo, 'Campanha atual': x.atual?.nome || '', 'MC atual %': x.atual?.mcPct ?? '',
    'Melhor elegível': x.melhor?.nome || '', Preço: x.melhor?.preco ?? '', 'Rebate %': x.melhor?.meliPct ?? '', 'MC R$': x.melhor?.mc ?? '', 'MC %': x.melhor?.mcPct ?? '', 'Piso %': x.piso,
    Custo: x.custo.ok ? 'ok' : `${x.custo.estado} (${x.custo.faltando.join(', ')})`, Sugestão: x.sugerida.map(s => `${s.regra}:${s.pid}${s.aprovado ? ' (aprovada)' : ''}`).join(' | '),
    Marcada: x.marcadas.filter(m => m.marcado).map(m => `${m.pid} por ${m.por}`).join(' | '), Situação: x.situacao, Obs: x.sugerida[0]?.obs || x.motivoSemMarca || '',
  }))
  enviarCsv(res, 'promocoes-elegiveis', l, ['Empresa', 'Curva', 'Faturamento 30d', 'SKU', 'MLB', 'Anúncio', 'Campanha atual', 'MC atual %', 'Melhor elegível', 'Preço', 'Rebate %', 'MC R$', 'MC %', 'Piso %', 'Custo', 'Sugestão', 'Marcada', 'Situação', 'Obs'])
}))
