// Rotas do Plano de Ação por cliente: equipe/escopo, geração, ações, distribuição no Notion, documento e CSV.
// Segurança: só aceita acesso local (o painel interno não pode ser exposto pelo túnel do OAuth do ML) e
// só escreve no Notion com { confirmar: true } explícito — sem isso é sempre pré-visualização.
import { Router } from 'express'
import { db } from './lib/db.js'
import { ABERTA_SQL } from './lib/status-tarefa.js'
import { NAO_S90_SQL } from './lib/s90-chave.js'
import { listarEquipe, sincronizarEquipe, resolverEscopo, carregarClientes, clientesElegiveis, normNome, CANAIS, validarLiderOuConsultor } from './lib/equipe.js'
import { serieDiaria, tendencia, projecaoMes, causalidadeVendas, causalidadeOperacao, prioridadeAcao, caracteristicas, statusRenovacao, panoramaMeta, PESOS_PROB } from './lib/motor-ppc.js'
import { hojeLocal, agora } from './lib/db.js'
import { analisarCliente, padroesGlobais, agruparPadroes, agruparDimensoes, medidasDoGrupo, fraseEstado } from './lib/impacto-tarefas.js'
import { normalizarNicho, regiaoDe, UFS, SEM_NICHO, SEM_UF } from './lib/dimensoes.js'
import { carteiraPorProduto, PRODUTOS, SEM_PRODUTO, ROTULO_PRODUTO } from './lib/produto.js'
import { registrarPendenciasProduto } from './lib/cadastro-clientes.js'
import { gmvPortfolio, maisVendidos } from './lib/gmv.js'
import { coletarCliente, coberturaPedidos, cfgAtrib, addDias, diasEntre } from './lib/meli-serie.js'
import { historico } from './lib/preco-historico.js'
import { gerarPlanoConta, previsaoDoPlano } from './lib/plano-anuncios.js'
import { diagnosticarConta, custosDoCliente, economiaAds, algoritmo } from './lib/diagnostico-conta.js'
import { renderPlanoConta } from './lib/render-plano-conta.js'
import { saudeRegras, compararPrevisaoRealizado, padroesGlobaisCache } from './lib/calibracao.js'
import { env } from './lib/env.js'
import { linkConectar } from './lib/meli-link.js'
import { listarConexoes } from './lib/meli-contas.js'
import { gerarPlanosEscopo, lerPlano, lerAcoes, acoesDoEscopo, marcarStatus, playbook } from './lib/plano-cliente.js'
import { distribuir, desfazer } from './lib/distribuir-notion.js'
import { renderPlanoCliente } from './lib/render-plano-cliente.js'
import { pendenciasReal } from './lib/pendencias-cliente-real.js'
import { lerCliente as merovingioCliente, padroesDaBase } from './lib/merovingio.js'
import { visaoTime, clientesAtrasados, tiposQueMovem, detalheAnalista, sincronizarAnalistasOficiais, listaOficial } from './lib/analistas.js'
import { montarPlacePlan, publicarPlacePlan, placeplanDe, analistaDaConta } from './lib/placeplan.js'
import { diagnosticoAnuncio } from './lib/arvore-anuncio.js'
import { medirResultados, estatisticas, historicoPorRegra } from './lib/aprendizado.js'
import { cadastrarProspecto, listarProspectos, removerProspecto, diagnosticoProspecto, infraMeliPronta, coletaEmCurso, lerReputacaoProspecto, apagarCadastrosTeste } from './lib/comercial.js'
import { perfilDoCliente, salvarPerfil, listarPerfis, listarObjetivos } from './lib/perfil-cliente.js'
import { criarRotasPerfil } from './rotas-perfil.js'
import { criarRotasFicha } from './rotas-ficha.js'
import { ficha, sincronizarPrestadores, PAPEIS, CANAIS_FICHA, LINKS, papelDaAcao } from './lib/ficha-cliente.js'
import { ROTULOS as ROTULOS_FILTRO, definicao as definicaoFiltro, desserializar as lerFiltro, validar as validarFiltro, resolverPeriodo, chips as chipsFiltro, compilarPredicado, compilarSQL, criarFiltrosSalvos, PAINEIS as PAINEIS_FILTRO } from './lib/filtros.js'
import { anunciosDoCliente } from './lib/anuncios.js'
import { folhaDoCliente, csvDaFolha } from './lib/folha-anuncio.js'
import { diagnosticoDoCliente, validarContrato, memoDiagnostico } from './lib/diagnostico-motor.js'
import { paginaDiagnostico } from './lib/render-diagnostico-motor.js'
import { redigir } from './lib/ia.js'
import { nomesInternos } from './lib/relatorio-brief-real.js'
import { coletaLigada } from './lib/promocoes-coleta.js'
import { listaOficial as analistasOficiais } from './lib/analistas.js'
import { retroalimentar } from './lib/retroalimentacao.js'
import { catalogo as catalogoProcessos, extras as extrasProcessos, processoCompleto, roteiro as roteiroProcesso, curadoria as curadoriaProcessos, duplicacao as playbookDuplicacao, familiaDeDemanda } from './lib/processos.js'
import { listarNotificacoes, marcarLidas, notificar } from './lib/notificacoes.js'
import { montarDiagnosticoComercial } from './lib/diagnostico-comercial.js'
import { renderDiagnosticoComercial } from './lib/render-diagnostico-comercial.js'
import { cartoesDoCliente, capturarAcompanhamento, sugestoesDeVinculo, vinculosCliente } from './lib/acompanhamento.js'
import { origemCatalogo } from './lib/catalogo.js'
import { TEXTO_CATALOGO } from './lib/catalogo-cfg.js'
import { criarCatalogo } from './lib/catalogo-db.js'

export const SCORE_MIN_PADRAO = 11
export const rotasPlanos = Router()
const catalogoDb = criarCatalogo(db)

// ── jobs em memória (geração e distribuição são lentas: rodam em segundo plano) ──
const jobs = new Map()
let ativo = null
function iniciar(tipo, escopo, fn) {
  if (ativo && jobs.get(ativo)?.estado === 'rodando') { const e = new Error('já existe um job rodando — aguarde terminar'); e.status = 409; throw e }
  const job = { id: Date.now().toString(36), tipo, escopo: { tipo: escopo.tipo, consultor: escopo.consultor, squad: escopo.squad, clientes: escopo.clientes.length }, estado: 'rodando', progresso: { feitos: 0, total: 0 }, inicio: new Date().toISOString(), resultado: null, erro: null }
  jobs.set(job.id, job); ativo = job.id
  for (const k of [...jobs.keys()].slice(0, -20)) jobs.delete(k)
  fn(p => { job.progresso = p }).then(r => { job.resultado = r; job.estado = 'concluido' })
    .catch(e => { job.erro = e.message; job.estado = 'erro' }).finally(() => { job.fim = new Date().toISOString() })
  return job
}
const trata = fn => async (req, res) => {
  try { await fn(req, res) } catch (e) { res.status(e.status || 400).json({ erro: e.message }) }
}

// ── filtro avançado (?f=) nas rotas que devolvem linhas calculadas ───────────
// Lido uma vez por rota e validado contra o painel DELA (filtro de outro painel = 400 pela trata). Sem ?f= a rota devolve exatamente o de antes.
// O filtro recorta o que se vê; nunca muda o que o algoritmo vê (as ações continuam sendo geradas sobre a conta inteira).
const lerF = (req, painel) => req.query.f ? lerFiltro(String([].concat(req.query.f)[0]), { painel, hoje: hojeLocal() }) : null
const filtroNaResposta = (f, extra = {}) => ({ chips: chipsFiltro(f), periodo: f.periodo?.resolvido || null, ...extra })
// predicado + período em memória: acessor (linha, campo) → valor; datas: campo do período → (linha) → AAAA-MM-DD. Sem data para o campo, o período não filtra (a rota avisa).
export function aplicarFiltro(linhas, f, acessor, datas = {}) {
  if (!f) return linhas
  const pred = compilarPredicado(f, acessor), r = f.periodo?.resolvido, dataDe = r && datas[f.periodo.campo]
  return linhas.filter(o => pred(o) && (!dataDe || (d => d && d >= r.de && d <= r.ate)(String(dataDe(o) || '').slice(0, 10))))
}
// separa as condições que a rota consegue avaliar das que não alcança: estas SAEM da árvore e viram aviso — nunca filtram em silêncio (zerar a lista fingindo que filtrou)
export function alcance(f, campos) {
  const fora = new Set()
  const poda = n => n.itens ? (its => its.length ? { ...n, itens: its } : null)(n.itens.map(poda).filter(Boolean)) : campos.includes(n.campo) ? n : (fora.add(n.campo), null)
  return { f: { ...f, arvore: f.arvore ? poda(f.arvore) : null }, fora: [...fora] }
}
// campos cujo valor na linha é uma LISTA de nomes ("Ana, Bruno"): "é igual a" vira "contém" e "é um de" vira OU de "contém" (mesma regra do /api/gmv)
export const arvoreListas = (f, campos) => !f?.arvore ? f : { ...f, arvore: JSON.parse(JSON.stringify(f.arvore), (k, v) => v && campos.includes(v.campo) ? (v.operador === 'igual' ? { ...v, operador: 'contem' } : v.operador === 'em' ? { op: 'OU', itens: v.valor.map(x => ({ campo: v.campo, operador: 'contem', valor: x })) } : v) : v) }
const avisoFiltro = (f, { fora = [], periodo = '', mais = '' } = {}) => [
  fora.length ? `${fora.map(c => PAINEIS_FILTRO[f.painel].campos[c]?.rotulo || c).join(', ')}: não alcança esta visão (condição ignorada)` : '',
  f.periodo && periodo ? `o período não se aplica a esta visão (${periodo})` : '', mais,
].filter(Boolean).join('; ') || undefined
// ações do plano (painel 'distribuicao'): consultor é o responsável da ação; prioridade é o score
const ACESSOR_ACAO = (a, c) => c === 'consultor' ? a.responsavel : c === 'prioridade' ? a.score : a[c]
export const aplicarFiltroAcoes = (acoes, f) => aplicarFiltro(acoes, f, ACESSOR_ACAO, { prazo: a => a.prazo, criado_em: a => a.criado_em })

const escopoDe = o => {
  const e = resolverEscopo({ tipo: o.tipo || 'total', clientes: o.clientes || [], consultor: o.consultor || '', squad: o.squad || '', produto: o.produto || '' })
  if (e.erro) { const x = new Error(e.erro); x.status = 400; throw x }
  return e
}
// GET aceita ?tipo=&consultor=&squad=&cliente=A&cliente=B
const escopoDaQuery = q => escopoDe({ tipo: q.tipo || (q.cliente ? 'selecao' : 'total'), consultor: q.consultor, squad: q.squad, produto: typeof q.produto === 'string' ? q.produto : '', clientes: [].concat(q.cliente || []) })

// ── equipe e escopo ──────────────────────────────────────────────────────────
rotasPlanos.get('/api/planos/equipe', trata((req, res) => res.json({ ...listarEquipe(), ignorados: resolverEscopo({}).ignorados })))
rotasPlanos.post('/api/planos/equipe/sincronizar', trata(async (req, res) => {
  const clientes = await sincronizarEquipe()
  cacheBusca = { em: 0, lista: null }          // a busca não pode servir lista velha logo após sincronizar
  const pend = registrarPendenciasProduto(carregarClientes())   // tier fora de config/produtos.json → cadastro:pendencias (produto_nao_mapeado)
  res.json({ ok: true, clientes, produto_nao_mapeado: pend })
}))
rotasPlanos.post('/api/planos/escopo', trata((req, res) => {
  const e = escopoDe(req.body || {})
  res.json({ clientes: e.clientes, n: e.clientes.length, ignorados: e.ignorados.length })
}))

// ── geração / pré-visualização / distribuição (jobs) ─────────────────────────
rotasPlanos.post('/api/planos/gerar', trata((req, res) => {
  const e = escopoDe(req.body?.escopo || {})
  if (!e.clientes.length) return res.status(400).json({ erro: 'o escopo não tem clientes' })
  const job = iniciar('gerar', e, async p => {
    const r = await gerarPlanosEscopo(e, { atualizarPlanos: req.body?.atualizarPlanos !== false, comML: req.body?.comML !== false, aoProgredir: p })
    try { medirResultados() } catch { /* aprendizado nunca bloqueia a geração */ }   // DEPOIS do sync dos planos do mês
    return r
  })
  res.json({ job: job.id })
}))

// ações do escopo que entram na distribuição: proposta/aprovada, com prioridade mínima, e (opcional) só os ids marcados
function selecionarAcoes(body, e) {
  const min = Number.isFinite(Number(body.scoreMin)) ? Number(body.scoreMin) : SCORE_MIN_PADRAO
  const ids = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids) : null
  let sel = acoesDoEscopo(e).filter(a => (ids ? ids.has(a.id) : a.score >= min))
    .filter(a => !body.somenteAnuncios || a.regra.startsWith('anuncio_'))
  // playbook da consultoria §12: 3-5 tarefas bem explicadas por vez — mais que isso dispersa o cliente.
  // Vale só na seleção automática; ids explícitos (prévia confirmada / escolha manual) passam como estão.
  if (!ids) {
    const cap = playbook.max_acoes_distribuir_por_cliente || 5, porCliente = {}
    sel = sel.filter(a => (porCliente[a.cliente] = (porCliente[a.cliente] || 0) + 1) <= cap)   // já vem por score DESC
  }
  return sel
}
rotasPlanos.post('/api/planos/distribuir', trata((req, res) => {
  const e = escopoDe(req.body?.escopo || {})
  const acoes = selecionarAcoes(req.body || {}, e)
  if (!acoes.length) return res.status(400).json({ erro: 'nenhuma ação elegível no escopo (gere os planos ou reduza a prioridade mínima)' })
  const real = req.body?.confirmar === true                       // qualquer outro valor = pré-visualização
  const job = iniciar(real ? 'distribuir' : 'previa', e, p => distribuir(acoes, { dryRun: !real, aoProgredir: p }))
  res.json({ job: job.id, real, acoes: acoes.length })
}))
rotasPlanos.get('/api/planos/job/:id', trata((req, res) => {
  const j = jobs.get(req.params.id)
  if (!j) return res.status(404).json({ erro: 'job não encontrado' })
  res.json(j)
}))
rotasPlanos.post('/api/planos/desfazer', trata(async (req, res) => {
  if (!Array.isArray(req.body?.ids) || !req.body.ids.length) return res.status(400).json({ erro: 'informe "ids"' })
  res.json(await desfazer(req.body.ids))
}))

// ── leitura ──────────────────────────────────────────────────────────────────
const linhaCsv = (a, plano) => ({
  ID: a.id, Cliente: a.cliente, Conta: a.canal || 'Geral', 'SKU/anúncio': '—',
  'Evidência': `[${a.dados.evidencia_tipo}] ${a.dados.evidencia}`, 'Problema/oportunidade': a.dados.problema, 'Ação específica': a.dados.acao,
  'Responsável': a.responsavel || 'responsável a definir', Prazo: a.prazo, 'Dependência': a.dados.dependencia,
  'Indicador inicial': a.dados.indicador_inicial, Meta: a.dados.meta, 'Critério de aceite': a.dados.criterio_aceite, Status: a.status,
  Squad: a.squad, Horizonte: a.horizonte, Prioridade: a.score, 'Fonte': a.dados.fonte, 'Link Notion': a.notion_url || '',
})
// quem recebe a tarefa quando a ação for ao Notion — só o que dá para saber barato (escolha na aprovação > ficha); sem isso vale o analista da conta (resolvido na distribuição)
function recebeAcao(a) {
  if (a.delegado_a && ficha.ehAtivo(a.delegado_a)) return { nome: ficha.nomeOficial(a.delegado_a), origem: 'escolhido na aprovação' }
  const canalK = Object.entries(CANAIS).find(([, v]) => v === a.canal)?.[0] || '', papel = papelDaAcao(a)
  const f = ficha.prestadorDaFicha(a.cliente, canalK, papel) || (papel !== 'analista' ? ficha.prestadorDaFicha(a.cliente, canalK, 'analista') : null)
  return f ? { nome: f.nome, origem: 'ficha do cliente', notion: !!f.notion } : null
}
const resumoAcao = a => ({ recebe: recebeAcao(a), sugerido: a.dados.profissional_sugerido ? { nome: a.dados.profissional_sugerido.recomendado?.nome || null, motivo: a.dados.profissional_sugerido.recomendado?.motivo || null, aviso: a.dados.profissional_sugerido.aviso || '', topo: (a.dados.profissional_sugerido.topo || []).slice(0, 3) } : null, executar_via_oferta: a.dados.executar_via_oferta || null, caminho: a.dados.execucao?.caminho || null, delegado_a: a.delegado_a || '', roteiro: a.dados.processo ? { id: a.dados.processo.id, nome: a.dados.processo.nome } : null, id: a.id, cliente: a.cliente, canal: a.canal, titulo: a.titulo, horizonte: a.horizonte, prazo: a.prazo, responsavel: a.responsavel, squad: a.squad, score: a.score, status: a.status, notion_url: a.notion_url, regra: a.regra, erro: a.erro, tipo: a.dados.evidencia_tipo, evidencia: a.dados.evidencia, problema: a.dados.problema, acao: a.dados.acao, indicador: a.dados.indicador_inicial, meta: a.dados.meta, aceite: a.dados.criterio_aceite, dependencia: a.dados.dependencia, logica: a.dados.logica })

function acoesDaQuery(q, f = null) {
  const e = escopoDaQuery(q)
  const status = q.status ? String(q.status).split(',') : ['proposta', 'aprovada', 'distribuida']
  const min = Number(q.scoreMin) || 0
  return aplicarFiltroAcoes(lerAcoes({ clientes: e.clientes, status, squad: e.tipo === 'squad' ? e.squad : '', consultor: e.tipo === 'consultor' ? e.consultor : '', horizonte: q.horizonte || '' }).filter(a => a.score >= min), f)
}
// sem ?f= devolve o array de sempre; com ?f= devolve { acoes, filtro } (um array não carrega o campo "filtro")
rotasPlanos.get('/api/planos/acoes', trata((req, res) => {
  const f = lerF(req, 'distribuicao'), acoes = acoesDaQuery(req.query, f).map(resumoAcao)
  res.json(f ? { acoes, filtro: filtroNaResposta(f) } : acoes)
}))
// descartar exige { por (líder/consultor), motivo_tipo (lista de config/alinhamentos.json), motivo? (≤200, auditado), revisar_em? (padrão +30 d), permanente? (só descontinuado) }
// e grava um alinhamento por ação (origem 'descarte'); o lote de /planos usa o mesmo motivo para todas. Reabrir (proposta) encerra o alinhamento do descarte.
rotasPlanos.post('/api/planos/acoes/status', trata((req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const txt = v => typeof v === 'string' ? v : ''
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.some(id => typeof id !== 'string')) return res.status(400).json({ erro: 'informe "ids"' })
  if (b.status === 'descartada' && !txt(b.motivo_tipo).trim()) return res.status(400).json({ erro: 'informe "motivo_tipo" (motivo da lista) para descartar' })
  res.json({ alteradas: marcarStatus(b.ids, b.status, { por: txt(b.por), motivo_tipo: txt(b.motivo_tipo).trim(), motivo: txt(b.motivo), revisar_em: txt(b.revisar_em), permanente: b.permanente === true }) })
}))
rotasPlanos.get('/api/planos/acoes.csv', trata((req, res) => {
  const linhas = acoesDaQuery(req.query, lerF(req, 'distribuicao')).map(a => linhaCsv(a))   // a exportação respeita o filtro ativo
  const cols = Object.keys(linhaCsv({ dados: {}, ...{} }, null))
  const cel = v => { let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return `"${x}"` }
  const csv = '﻿' + [cols.map(cel).join(';'), ...linhas.map(l => cols.map(c => cel(l[c])).join(';'))].join('\r\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="plano-de-acao.csv"')
  res.send(csv)
}))

// planos gerados por cliente (tabela do painel)
rotasPlanos.get('/api/planos/clientes', trata((req, res) => {
  const e = escopoDaQuery(req.query), f = lerF(req, 'distribuicao')
  const planos = new Map(db.prepare('SELECT cliente, gerado_em FROM planos_cliente').all().map(r => [r.cliente, r.gerado_em]))
  const cont = new Map()
  // as contagens seguem as ações filtradas; a lista de clientes continua sendo o escopo inteiro (cliente sem ação no filtro aparece com 0)
  for (const a of aplicarFiltroAcoes(lerAcoes({ clientes: e.clientes, status: ['proposta', 'aprovada', 'distribuida'], squad: e.tipo === 'squad' ? e.squad : '', consultor: e.tipo === 'consultor' ? e.consultor : '' }), f)) {
    const c = cont.get(a.cliente) || { n: 0, distribuidas: 0, h72: 0, topo: 0 }
    c.n++; if (a.status === 'distribuida') c.distribuidas++; if (a.horizonte === '72h') c.h72++; c.topo = Math.max(c.topo, a.score)
    cont.set(a.cliente, c)
  }
  const comFicha = new Map(db.prepare('SELECT cliente, COUNT(*) n FROM ficha_prestador GROUP BY cliente').all().map(r => [r.cliente, r.n]))
  const clientes = e.registros.map(c => ({ n_ficha: comFicha.get(c.cliente) || 0, cliente: c.cliente, tier: c.tier, canais: c.canais, consultor: c.principal, squad: c.squadPrincipal, hs: c.health_score, hs_classe: c.hs_classificacao, gerado_em: planos.get(c.cliente) || null, ...(cont.get(c.cliente) || { n: 0, distribuidas: 0, h72: 0, topo: 0 }) }))
  res.json(f ? { clientes, filtro: filtroNaResposta(f) } : clientes)
}))

// visão geral para a liderança: onde está o gargalo da base inteira
rotasPlanos.get('/api/planos/insights', trata((req, res) => {
  const q = (sql, ...p) => db.prepare(sql).all(...p)
  const f = lerF(req, 'distribuicao')
  // o painel 'distribuicao' tem coluna para todo campo e data: o filtro entra direto no SQL (lista fechada, parametrizado). As tarefas do Notion não são ações: ficam fora do filtro (aviso)
  const { where, args } = f ? compilarSQL(f) : { where: '1=1', args: [] }
  const abertas = q(`SELECT COUNT(*) n, SUM(prazo IS NULL OR prazo = '') sem FROM tarefas WHERE arquivada = 0 AND ${ABERTA_SQL}`)[0]
  res.json({
    tarefas_abertas: abertas.n, sem_prazo: abertas.sem || 0, pct_sem_prazo: abertas.n ? Math.round(100 * (abertas.sem || 0) / abertas.n) : 0,
    por_status: q(`SELECT status, COUNT(*) n FROM acoes_plano WHERE ${NAO_S90_SQL} AND ${where} GROUP BY status`, ...args),
    por_regra: q(`SELECT regra, COUNT(*) n, ROUND(AVG(score)) score_medio FROM acoes_plano WHERE ${NAO_S90_SQL} AND status IN ('proposta','aprovada','distribuida') AND ${where} GROUP BY regra ORDER BY n DESC`, ...args),
    por_squad: q(`SELECT COALESCE(NULLIF(squad,''),'(sem squad)') squad, COUNT(*) n FROM acoes_plano WHERE ${NAO_S90_SQL} AND status IN ('proposta','aprovada','distribuida') AND ${where} GROUP BY 1 ORDER BY n DESC`, ...args),
    sem_responsavel: q(`SELECT COUNT(*) n FROM acoes_plano WHERE ${NAO_S90_SQL} AND status IN ('proposta','aprovada') AND (responsavel IS NULL OR responsavel = '') AND ${where}`, ...args)[0].n,
    ...(f ? { filtro: filtroNaResposta(f, { aviso: 'tarefas_abertas, sem_prazo e pct_sem_prazo contam as tarefas do Notion da base inteira: o filtro de ações não as alcança' }) } : {}),
  })
}))

// ── busca de cliente (nome ou CNPJ/CPF) — parcial, mínimo 3 caracteres, no máx. 12 resultados ──
const soDigitos = v => String(v || '').replace(/\D+/g, '')
let cacheBusca = { em: 0, lista: null }
function indiceBusca() {
  if (!cacheBusca.lista || Date.now() - cacheBusca.em > 60_000) {
    const ok = new Set(clientesElegiveis().elegiveis.map(c => c.cliente))
    cacheBusca = {
      em: Date.now(),
      lista: carregarClientes().map(c => ({
        cliente: c.cliente, tier: c.tier, canais: c.canais, consultor: c.principal, squad: c.squadPrincipal,
        cnpj: c.cnpj, cpf: c.cpf, elegivel: ok.has(c.cliente),
        _norm: normNome(c.cliente), _dig: soDigitos(c.cnpj) + '|' + soDigitos(c.cpf),
      })),
    }
  }
  return cacheBusca.lista
}
rotasPlanos.get('/api/clientes/busca', trata((req, res) => {
  const q = String(req.query.q || '').trim()
  const dig = soDigitos(q)
  const semPont = q.replace(/[\s.\-\/]+/g, '')                                      // pontuação de CNPJ/CPF não conta
  const porDoc = dig.length >= 3 && dig.length >= semPont.length - 3                 // consulta majoritariamente numérica = documento
  if ((porDoc ? dig.length : normNome(q).length) < 3) return res.json({ min: 3, resultados: [] })
  const n = normNome(q)
  const achados = indiceBusca()
    .filter(c => porDoc ? c._dig.includes(dig) : c._norm.includes(n))
    .slice(0, 12).map(({ _norm, _dig, ...c }) => c)
  res.json({ min: 3, resultados: achados })
}))

// ── painel de um cliente: central + plano + ações classificadas + motor P→P→C ──
rotasPlanos.get('/api/cliente/painel', trata((req, res) => {
  const nome = String([].concat(req.query.cliente || '')[0] || '')
  const reg = carregarClientes().find(c => normNome(c.cliente) === normNome(nome))
  if (!reg) return res.status(404).json({ erro: 'cliente não encontrado na central' })
  const hoje = hojeLocal()
  const eleg = clientesElegiveis()
  const elegivel = eleg.elegiveis.some(c => c.cliente === reg.cliente)
  const motivo_inelegivel = elegivel ? null : (eleg.ignorados.find(i => i.cliente === reg.cliente)?.motivo || 'fora da base elegível')
  const plano = lerPlano(reg.cliente)
  const acoesCruas = lerAcoes({ clientes: [reg.cliente], status: ['proposta', 'aprovada', 'distribuida', 'descartada'] })
  const hist = historicoPorRegra()
  const acoes = acoesCruas.map(a => ({ ...resumoAcao(a), prioridade: prioridadeAcao(a), carac: caracteristicas(a), historico: hist.get(a.regra)?.medidas ? hist.get(a.regra).nota : null }))
  const merovingio = merovingioCliente({ reg, plano, acoes: acoesCruas, hoje: hojeLocal() })

  // Previsibilidade da EXECUÇÃO (Notion, sempre disponível): série de entregas concluídas
  const linhas = db.prepare(`SELECT COALESCE(NULLIF(data_conclusao, ''), SUBSTR(last_edited, 1, 10)) d, (data_conclusao IS NULL OR data_conclusao = '') estimada
    FROM tarefas WHERE arquivada = 0 AND status = 'concluida' AND cliente = ? AND titulo NOT LIKE '%· PS-%'`).all(reg.cliente)
  const serie = serieDiaria(linhas.map(r => r.d))
  const temPlanoMes = !acoes.some(a => a.regra === 'sem_plano_mes' && ['proposta', 'aprovada', 'distribuida'].includes(a.status))
  const execucao = {
    tendencia: tendencia(serie, hoje),
    mes: projecaoMes(serie, hoje),
    // datas estimadas (campo "Concluído em" vazio → última edição do card) são declaradas, não escondidas
    datas: { concluidas: linhas.length, estimadas: linhas.filter(r => r.estimada).length },
    causalidade: plano ? causalidadeOperacao({
      c28: plano.operacao.c28, p28: plano.operacao.p28, abertas: plano.operacao.abertas,
      bloqueadas: plano.operacao.bloqueadas, paradas: plano.operacao.paradas, dependenciasVencidas: plano.operacao.dependencia_14d,
      semResponsavel: plano.operacao.sem_responsavel, temPlanoMes,
    }) : null,
  }
  // Vendas: usa o comparativo coletado na última geração (plano.ml) — sem chamada de API no load
  const vendas = plano?.ml?.atual && plano?.ml?.anterior
    ? { disponivel: true, janela: plano.ml.janela_atual, causalidade: causalidadeVendas(plano.ml.atual, plano.ml.anterior, { preco: historico.resumoPrecos28d(reg.cliente, { ate: plano.ml.janela_atual?.ate, limiar: cfgAtrib.preco.limiar_confundidor_pct }) }), atual: plano.ml.atual, anterior: plano.ml.anterior }
    : { disponivel: false, motivo: 'conta do canal não conectada — o motor liga sozinho quando o cliente autorizar (botão no Notion)' }

  // Score de probabilidade operacional (nome do roteiro: não é probabilidade estatística calibrada):
  // liga quando o time cadastra a meta de entregas do mês; meta de GMV espera o canal conectado.
  const metasRow = db.prepare('SELECT metas_json FROM metas_cliente WHERE cliente = ? AND mes = ?').get(reg.cliente, hoje.slice(0, 7))
  const metas = metasRow ? JSON.parse(metasRow.metas_json) : {}
  let probabilidade
  if (Number(metas.entregas) > 0) {
    probabilidade = { base: 'entregas', metas, ...panoramaMeta({
      meta: Number(metas.entregas), realizado: execucao.mes.realizado, diasRestantes: execucao.mes.diasRestantes,
      mediaAtual: execucao.mes.velocidade, indiceTendencia: execucao.tendencia.indice }) }
  } else probabilidade = { base: null, metas, tem_meta: false, pesos: PESOS_PROB, motivo: 'cadastre a meta de entregas do mês para ligar o score agora; conversão, tráfego, estoque e Ads entram quando o canal conectar — sempre com a cobertura declarada' }
  probabilidade.gmv_aguardando_canal = Number(metas.gmv) > 0 && !vendas.disponivel

  res.json({
    cliente: reg.cliente, tier: reg.tier, produto: reg.produto || '', nicho: reg.nicho, canais: reg.canais, cnpj: reg.cnpj, cpf: reg.cpf,
    contato: reg.contato, consultor: reg.principal, squad: reg.squadPrincipal, elegivel, motivo_inelegivel, hoje,
    plano_gerado_em: plano?._gerado_em || null, resumo: plano?.resumo?.texto || '',
    pendencias: plano?.pendencias || [], execucao, vendas,
    renovacao: statusRenovacao(reg.vencimentos, hoje),
    probabilidade_meta: probabilidade,
    merovingio,
    acoes,
  })
}))

// ── gestão por analista: volume, velocidade (com fidelidade declarada), atraso real + proxy ──
rotasPlanos.get('/api/analistas/visao', trata(async (req, res) => {
  const f = lerF(req, 'analistas')
  if (!listaOficial().length) await sincronizarAnalistasOficiais()   // primeira vez: puxa a base oficial do Notion
  const v = visaoTime()
  if (!f) return res.json(v)
  // a linha é por PESSOA: só "analista" alcança; cliente/canal/status não existem na linha e o período não recalcula as janelas fixas (28/90 dias)
  const { f: f2, fora } = alcance(f, ['analista'])
  res.json({ ...v, analistas: aplicarFiltro(v.analistas, f2, a => a.nome), filtro: filtroNaResposta(f, { aviso: avisoFiltro(f, { fora, periodo: 'as janelas de 28 e 90 dias são fixas', mais: 'os totais do time (time, lista_oficial) seguem a base inteira' }) }) })
}))
rotasPlanos.post('/api/analistas/sincronizar', trata(async (req, res) => res.json({ ok: true, analistas: await sincronizarAnalistasOficiais() })))
rotasPlanos.get('/api/analistas/clientes-atrasados', trata((req, res) => {
  const f = lerF(req, 'analistas'), r = clientesAtrasados()
  if (!f) return res.json(r)
  // linha por cliente com a lista de analistas: "analista é igual a X" = X está entre eles; canal/status das tarefas não estão na linha; o período não se aplica (foto de hoje)
  const { f: f2, fora } = alcance(f, ['cliente', 'analista'])
  res.json({ ...r, clientes: aplicarFiltro(r.clientes, arvoreListas(f2, ['analista']), (c, campo) => campo === 'analista' ? c.analistas.join(', ') : c.cliente), filtro: filtroNaResposta(f, { aviso: avisoFiltro(f, { fora, periodo: 'é a foto das tarefas abertas hoje' }) }) })
}))
rotasPlanos.get('/api/analistas/tipos', trata((req, res) => {
  const f = lerF(req, 'analistas'), r = tiposQueMovem()
  if (!f) return res.json(r)
  const { fora } = alcance(f, [])      // linha por TIPO de tarefa: nenhum campo do painel alcança — devolve tudo e diz isso
  res.json({ ...r, filtro: filtroNaResposta(f, { aviso: avisoFiltro(f, { fora, periodo: 'a janela de 90 dias é fixa' }) || 'o filtro não se aplica a esta visão (linhas por tipo de tarefa)' }) })
}))
rotasPlanos.get('/api/analistas/detalhe', trata((req, res) => {
  const nome = String([].concat(req.query.nome || '')[0] || '').trim()
  if (nome.length < 3) return res.status(400).json({ erro: 'informe "nome" (mín. 3 caracteres)' })
  res.json(detalheAnalista(nome))
}))

// ── árvore de diagnóstico de anúncio (números digitados pelo consultor) ────
rotasPlanos.post('/api/anuncio/diagnostico', trata((req, res) => res.json(diagnosticoAnuncio(req.body || {}))))

// ── aprendizado: mede resultado das ações executadas e devolve a taxa por regra ──
rotasPlanos.get('/api/aprendizado', trata((req, res) => res.json({ medicao: medirResultados(), estatisticas: estatisticas() })))

// ── comercial: prospect → link de conexão → diagnóstico da conta (sem Notion) ──
// etapa do prospect (a mesma leitura da tela): pediu contato > pronto (dados lidos) > conectado > erro de conexão > aguardando
export const etapaProspecto = p => p.quer_contato_em ? 'pediu_contato' : p.conectado ? (p.dados_lidos && !p.sem_vendas ? 'pronto' : 'conectado') : p.conexao_erro ? 'erro' : 'aguardando'   // lida sem vendas conta como «conectado» no funil (não é apresentável)
rotasPlanos.get('/api/comercial/prospectos', trata((req, res) => {
  const f = lerF(req, 'comercial')
  // «dados lidos» = a MESMA regra do relatório (montarDiagnosticoComercial): coleta de pedidos registrada OU série gravada. Conta lida sem venda
  // (ex.: conta de teste) é «lida, sem vendas» — não «sem dados» (16/10/2026: 2 testes do David ficaram «Conectado, sem dados» com 90 d coletados e 0 pedidos).
  const prospectos = listarProspectos().map(p => { const serie = !!db.prepare('SELECT 1 FROM meli_serie_item WHERE cliente = ? LIMIT 1').get(p.chave_conexao), cob = !!coberturaPedidos(p.chave_conexao).de
    return { ...p, dados_lidos: serie || cob, sem_vendas: cob && !serie } }).map(p => ({ ...p, etapa: etapaProspecto(p) }))
  res.json({ infra_pronta: infraMeliPronta(), host_publico: process.env.COMERCIAL_PUBLIC_HOST || '', prospectos: aplicarFiltro(prospectos, f, (p, c) => p[c], { criado_em: p => p.criado_em }), ...(f ? { filtro: filtroNaResposta(f) } : {}) })
}))
// cadastros de TESTE (lead público sem conexão, e-mail repetido ≥ 3× ou domínio/nome de teste): prévia por padrão; `confirmar: true` apaga; só líder/dono
rotasPlanos.post('/api/comercial/apagar-testes', trata((req, res) => {
  const b = req.body || {}, por = String(b.por || '').trim()
  if (!validarLiderOuConsultor(por)) return res.status(403).json({ erro: 'só líder, consultor ou dono da Place2u pode apagar cadastros' })
  res.json(apagarCadastrosTeste({ confirmar: b.confirmar === true }))
}))
// lê os itens, pedidos, visitas e Ads da conta do prospect (90 dias) para o relatório de diagnóstico; os dados somem com o cadastro (LGPD)
rotasPlanos.post('/api/comercial/coletar', trata((req, res) => {
  const id = String(req.body?.id || ''), p = listarProspectos().find(x => x.id === id)
  if (!p) return res.status(404).json({ erro: 'prospect não encontrado' })
  if (!p.conectado) return res.status(409).json({ erro: 'a conta ainda não está conectada' })
  coletaEmCurso.add(p.chave_conexao)
  const job = iniciar('coletar', { tipo: 'cliente', consultor: '', squad: '', clientes: [p.chave_conexao] }, async prog => {
    let r
    try { r = await coletarCliente(p.chave_conexao, { dias: 90, aoProgredir: prog }); await lerReputacaoProspecto(p.id).catch(() => null) } finally { coletaEmCurso.delete(p.chave_conexao) }
    try { notificar({ tipo: 'diagnostico_pronto', nivel: 'sucesso', titulo: `Diagnóstico pronto: ${p.empresa}`, corpo: 'Os dados da conta foram lidos. Abra o Comercial e emita o relatório (PDF) para apresentar.', cliente: p.chave_conexao, link: '/comercial' }) } catch { /* aviso é melhor esforço */ }
    return { itens: r.itens, dias_pedidos: r.dias_pedidos }
  })
  res.json({ job: job.id })
}))
// relatório de diagnóstico para APRESENTAR ao prospect (HTML; o PDF é /comercial/diagnostico.pdf)
rotasPlanos.get('/comercial/diagnostico', (req, res) => {
  try {
    const d = montarDiagnosticoComercial(String([].concat(req.query.id || '')[0] || ''))
    if (!d.disponivel) return res.status(409).send(`<pre style="font:14px system-ui;padding:24px;white-space:pre-wrap">${String(d.motivo).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`)
    res.send(renderDiagnosticoComercial(d))
  } catch (e) { res.status(e.status || 400).send('<pre>Não foi possível montar o diagnóstico.</pre>') }
})
rotasPlanos.post('/api/comercial/prospectos', trata((req, res) => res.json(cadastrarProspecto(req.body || {}))))
rotasPlanos.post('/api/comercial/remover', trata(async (req, res) => res.json(await removerProspecto(String(req.body?.id || '')))))   // revoga no ML (melhor esforço) e apaga
rotasPlanos.get('/api/comercial/diagnostico', trata(async (req, res) => res.json(await diagnosticoProspecto(String([].concat(req.query.id || '')[0] || '')))))

// ── PlacePlan: página 5W2H com capa na base "Informações" do cliente ───────
// confirmar !== true é SEMPRE pré-visualização (nada é criado no Notion)
rotasPlanos.post('/api/placeplan/publicar', trata(async (req, res) => {
  const cliente = String(req.body?.cliente || '')
  if (!cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  const real = req.body?.confirmar === true
  res.json(await publicarPlacePlan(cliente, { dryRun: !real }))
}))
rotasPlanos.get('/api/placeplan/previa', trata((req, res) => {
  const cliente = String([].concat(req.query.cliente || '')[0] || '')
  const m = montarPlacePlan(cliente)
  if (m.erro) return res.status(400).json(m)
  res.json({ ...m, publicados: placeplanDe(cliente), analista_conta: analistaDaConta(cliente) })
}))

// ── padrões da base (liderança): onde o sistema inteiro trava — processo, não cliente ──
rotasPlanos.get('/api/merovingio/padroes', trata((req, res) => res.json(padroesDaBase())))

// ── metas (entrada do time; o motor nunca inventa) ─────────────────────────
rotasPlanos.post('/api/cliente/metas', trata((req, res) => {
  const { cliente, metas } = req.body || {}
  const mes = String(req.body?.mes || hojeLocal().slice(0, 7))
  if (!/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ erro: 'mes deve ser YYYY-MM' })
  if (!cliente || typeof metas !== 'object') return res.status(400).json({ erro: 'informe "cliente" e "metas"' })
  const reg = carregarClientes().find(c => normNome(c.cliente) === normNome(String(cliente)))
  if (!reg) return res.status(404).json({ erro: 'cliente não encontrado na central' })
  const limpas = {}
  for (const k of ['gmv', 'pedidos', 'margem_pct', 'roas', 'acos_max', 'conversao', 'entregas']) {
    const v = Number(metas[k])
    if (Number.isFinite(v) && v > 0) limpas[k] = v
  }
  db.prepare(`INSERT INTO metas_cliente (cliente, mes, metas_json, atualizado_em) VALUES (?,?,?,?)
    ON CONFLICT(cliente, mes) DO UPDATE SET metas_json = excluded.metas_json, atualizado_em = excluded.atualizado_em`)
    .run(reg.cliente, mes, JSON.stringify(limpas), agora())        // nome canônico — senão a meta fica invisível p/ sempre
  res.json({ ok: true, mes, metas: limpas })
}))

// ── perfil do cliente (como o Relatório Semanal é escrito) e objetivo: GET/POST /api/cliente/perfil ──
rotasPlanos.use(criarRotasPerfil({
  perfilDoCliente, salvarPerfil, listarPerfis, listarObjetivos,
  clienteCanonico: nome => carregarClientes().find(c => normNome(c.cliente) === normNome(nome))?.cliente || null,   // nome oficial, como nas metas
  coletaPromocoesPadrao: () => coletaLigada(null),                                                                   // o que "padrão da base" significa hoje (config/promocoes.json)
}))

// ── inteligência de processos: o MAPA por canal (passo a passo do Manual do Analista), a sequência lógica e o playbook da duplicação estratégica ──
rotasPlanos.get('/api/processos', trata((req, res) => {
  const cfg = curadoriaProcessos
  res.json({ canais: cfg.canais, sequencia: cfg.sequencia_logica, regras_gerais: cfg.regras_gerais, mapa: Object.fromEntries(Object.keys(cfg.mapa).map(k => [k, catalogoProcessos({ canal: k })])), extras: Object.fromEntries(Object.keys(cfg.mapa).map(k => [k, extrasProcessos({ canal: k })])), familias: cfg.familias.map(f => ({ id: f.id, nome: f.nome })), duplicacao: playbookDuplicacao })
}))
rotasPlanos.get('/api/processos/roteiro', trata((req, res) => {
  const demanda = String([].concat(req.query.demanda || '')[0] || '').slice(0, 200), canal = String([].concat(req.query.canal || 'ML')[0])
  if (!Object.hasOwn(curadoriaProcessos.canais, canal)) return res.status(400).json({ erro: 'canal desconhecido' })
  res.json({ familia: familiaDeDemanda(demanda), roteiro: roteiroProcesso({ demanda, canal }) })
}))
// um processo do Manual, completo e estruturado (passos numerados, evidência, critério), para pessoa ou máquina executar: /api/processos/6.1?canal=ML
rotasPlanos.get('/api/processos/:id(\\d+\\.\\d+)', trata((req, res) => {
  const canal = String([].concat(req.query.canal || 'ML')[0])
  if (!Object.hasOwn(curadoriaProcessos.canais, canal)) return res.status(400).json({ erro: 'canal desconhecido' })
  const p = processoCompleto(req.params.id, canal)
  if (!p) return res.status(404).json({ erro: 'processo sem passo a passo neste canal' })
  res.json(p)
}))

// ── ficha do cliente (prestadores do Notion + links das contas) e delegação na aprovação ──
rotasPlanos.use(criarRotasFicha({
  ficha, sincronizarPrestadores, papeis: PAPEIS, canais: CANAIS_FICHA, links: LINKS,
  clienteCanonico: nome => carregarClientes().find(c => normNome(c.cliente) === normNome(nome))?.cliente || null,
  // o link da conta do ML sai da conexão OAuth (perfil público do vendedor) — só sugestão: vira link da ficha quando alguém salva
  sugestoesDoCliente: cliente => { const c = db.prepare('SELECT nickname FROM meli_contas WHERE cliente = ?').get(cliente); return c?.nickname ? { ml: `https://perfil.mercadolivre.com.br/${encodeURIComponent(c.nickname)}` } : {} },
  canaisDoCliente: cliente => carregarClientes().find(c => c.cliente === cliente)?.canais || [],
  delegar: (ids, nome) => { const t = agora(); return db.transaction(() => ids.reduce((n, id) => n + db.prepare("UPDATE acoes_plano SET delegado_a = ?, atualizado_em = ? WHERE id = ? AND status IN ('proposta','aprovada')").run(nome, t, id).changes, 0))() },
}))

// ── resultado de uma ação executada (antes/depois — alimenta o aprendizado futuro) ──
rotasPlanos.post('/api/planos/acoes/resultado', trata((req, res) => {
  const { id, antes, depois, observacao } = req.body || {}
  if (!id) return res.status(400).json({ erro: 'informe "id"' })
  if (!String(antes || '').trim() && !String(depois || '').trim() && !String(observacao || '').trim())
    return res.status(400).json({ erro: 'informe pelo menos um dos campos: antes, depois, observacao' })
  const r = db.prepare('UPDATE acoes_plano SET resultado_json = ?, atualizado_em = ? WHERE id = ?')
    .run(JSON.stringify({ antes: String(antes || ''), depois: String(depois || ''), observacao: String(observacao || ''), registrado_em: agora() }), agora(), String(id))
  if (!r.changes) return res.status(404).json({ erro: 'ação não encontrada' })
  res.json({ ok: true })
}))

// ── Central de Integrações: só fluxos oficiais; Amazon/Shopee declarados como pendentes de app ──
const REQUISITOS = {
  amazon: { nome: 'Amazon', fluxo: 'SP-API + Login With Amazon (fluxo oficial de autorização)', requisitos: ['Conta Amazon Seller Central do cliente', 'Registro de desenvolvedor SP-API aprovado pela Amazon (Place2u)', 'App com client_id/client_secret (LWA) cadastrado', 'PUBLIC_BASE_URL (https) para o redirect OAuth'] },
  shopee: { nome: 'Shopee', fluxo: 'Shopee Open Platform (fluxo oficial de autorização de loja)', requisitos: ['Conta de desenvolvedor na Shopee Open Platform aprovada', 'App com partner_id/partner_key', 'PUBLIC_BASE_URL (https) para o redirect', 'Autorização da loja do cliente pelo fluxo oficial'] },
}
rotasPlanos.get('/api/integracoes', trata((req, res) => {
  const hoje = new Date()
  const conexoes = new Map(listarConexoes().map(c => [c.cliente, c]))
  const arquivadas = new Set(db.prepare('SELECT cliente, linha_json FROM meli_contas_arquivo ORDER BY id DESC').all().filter(r => { try { return !JSON.parse(r.linha_json).erro } catch { return false } }).map(r => r.cliente))   // desconectadas pelo painel (e que não estavam mortas): dá para restaurar
  const mlConfigurado = !!(env.MELI_CLIENT_ID && env.MELI_CLIENT_SECRET && env.PUBLIC_BASE_URL)
  // TODOS os clientes cadastrados na central (consultoria e assessoria, qualquer plano): todos podem ganhar o link de conexão do Mercado Livre,
  // mesmo quando o ML ainda não consta nos canais deles na central (opera_ml=false só informa; não bloqueia o link)
  const clientes = carregarClientes().map(c => {
    const cx = conexoes.get(c.cliente)
    const expira = cx?.expira_em ? new Date(cx.expira_em) : null
    const statusML = !cx ? 'desconectado'
      : cx.erro ? 'erro'
      // O access_token do ML vale ~6 h e a renovação é automática — isso NÃO é problema (antes toda conta aparecia "expirando").
      // "Expirando" agora = a conta NÃO foi renovada há mais de 24 h (a renovação preventiva falhou/parou) — risco real do refresh.
      : cx.atualizado_em && (hoje - new Date(cx.atualizado_em)) > 24 * 3600e3 ? 'expirando'
      : 'conectado'
    return {
      cliente: c.cliente, canais: c.canais, consultor: c.principal, cnpj: c.cnpj, tier: c.tier, situacao: c.status, opera_ml: c.canais.includes('ML'),
      ml: { status: statusML, restauravel: !cx && arquivadas.has(c.cliente), nickname: cx?.nickname || '', seller_id: cx?.meli_user_id || null, conectado_em: cx?.conectado_em || '', expira_em: cx?.expira_em || '', erro: cx?.erro || '' },
      amazon: { status: c.canais.includes('AMZ') ? 'aguardando_app' : 'nao_opera' },
      shopee: { status: c.canais.includes('SHO') ? 'aguardando_app' : 'nao_opera' },
    }
  })
  const base = env.PUBLIC_BASE_URL || 'https://SEU-DOMINIO'
  res.json({
    ml: {
      configurado: mlConfigurado,
      app_id: env.MELI_CLIENT_ID || '',
      // valores para colar no DevCenter do Mercado Livre (o secret NUNCA sai do servidor)
      devcenter: { redirect_uri: `${base}/meli/callback`, notificacoes_url: `${base}/webhook/meli`, pkce: 'suportado (S256) — pode marcar "PKCE necessário"' },
      checklist: {
        'ID do aplicativo (MELI_CLIENT_ID)': !!env.MELI_CLIENT_ID,
        'Chave secreta (MELI_CLIENT_SECRET)': !!env.MELI_CLIENT_SECRET,
        'Domínio público https (PUBLIC_BASE_URL)': !!env.PUBLIC_BASE_URL,
        'Chave de criptografia dos tokens (MELI_TOKEN_KEY)': !!env.MELI_TOKEN_KEY,
        'Segredo dos links de conexão (MELI_LINK_SECRET)': !!env.MELI_LINK_SECRET,
      },
      notificacoes_recebidas: db.prepare('SELECT COUNT(*) n FROM meli_notificacoes').get().n,
      pendente_config: mlConfigurado ? [] : ['MELI_CLIENT_SECRET (colar no .env — chave secreta do app)', 'PUBLIC_BASE_URL https (túnel nomeado do Cloudflare ou domínio próprio)'].filter((_, i) => i === 0 ? !env.MELI_CLIENT_SECRET : !env.PUBLIC_BASE_URL),
    },
    amazon: { configurado: false, ...REQUISITOS.amazon },
    shopee: { configurado: false, ...REQUISITOS.shopee },
    clientes,
  })
}))
// links de conexão em lote (CSV): quem ainda não conectou (ou todos / só com erro), filtrável por plano — para mandar a todos de uma vez
rotasPlanos.get('/api/integracoes/links.csv', trata((req, res) => {
  if (!(env.MELI_CLIENT_ID && env.MELI_CLIENT_SECRET && env.PUBLIC_BASE_URL))
    return res.status(409).json({ erro: 'integração do Mercado Livre ainda não configurada no .env (MELI_CLIENT_ID, MELI_CLIENT_SECRET, PUBLIC_BASE_URL)' })
  const quais = ['desconectado', 'erro', 'todos'].includes(String(req.query.status)) ? String(req.query.status) : 'desconectado'
  const tier = String([].concat(req.query.tier || '')[0] || '')
  const conexoes = new Map(listarConexoes().map(c => [c.cliente, c]))
  const excl = new Set(['Desligado', 'Processo de Desligamento'])
  const linhas = carregarClientes().filter(c => (!tier || c.tier === tier) && (req.query.desligados === '1' || !excl.has(c.status))).map(c => {
    const cx = conexoes.get(c.cliente), st = !cx ? 'desconectado' : cx.erro ? 'erro' : 'conectado'
    return { c, st }
  }).filter(({ st }) => quais === 'todos' || st === quais)
    .map(({ c, st }) => ({ 'Cliente': c.cliente, 'Plano': c.tier, 'Situação': c.status, 'Consultor': c.principal || '', 'Canais': c.canais.join(' · '), 'Mercado Livre hoje': st, 'Link de conexão (60 dias)': linkConectar(c.cliente) }))
  const cols = ['Cliente', 'Plano', 'Situação', 'Consultor', 'Canais', 'Mercado Livre hoje', 'Link de conexão (60 dias)']
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="links-de-conexao-mercado-livre.csv"')
  res.send('\ufeff' + [cols.map(csvSeguro).join(';'), ...linhas.map(l => cols.map(k => csvSeguro(l[k])).join(';'))].join('\r\n'))
}))
rotasPlanos.post('/api/integracoes/meli/link', trata((req, res) => {
  const cliente = String(req.body?.cliente || '')
  if (!cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  if (!(env.MELI_CLIENT_ID && env.MELI_CLIENT_SECRET && env.PUBLIC_BASE_URL))
    return res.status(409).json({ erro: 'integração do Mercado Livre ainda não configurada no .env (MELI_CLIENT_ID, MELI_CLIENT_SECRET, PUBLIC_BASE_URL)' })
  res.json({ url: linkConectar(cliente), validade_dias: 60, nota: 'envie este link ao cliente (ou use o botão da página dele no Notion) — ele autoriza no site oficial do Mercado Livre; nenhuma senha passa pelo sistema' })
}))

// ── vendas reais do canal conectado: mais vendidos (visão do comprador), resultado das tarefas, GMV ──
// coleta de pedidos (coberturaPedidos, a mesma cobertura das telas) OU série já gravada: conta coletada sem venda não é "ainda não coletada"
const conectadoComDados = c => !!coberturaPedidos(c).de || !!db.prepare('SELECT 1 FROM meli_serie_item WHERE cliente = ? LIMIT 1').get(c)
const estaConectado = c => !!db.prepare('SELECT 1 FROM meli_contas WHERE cliente = ?').get(c)
// conectado mas sem coleta NÃO é "não conectado": a tela oferece "Coletar dados agora" em vez de pedir nova conexão
const semDados = c => ({ disponivel: false, conectado: estaConectado(c), motivo: estaConectado(c) ? 'conta conectada, mas os dados do Mercado Livre ainda não foram coletados' : 'conta do Mercado Livre não conectada' })
// chave de prospect do Comercial ('[Comercial] …') nunca é cliente: rotas de cliente a tratam como inexistente (não gera plano, vínculo nem acompanhamento para ela)
const ehProspecto = c => /^\[Comercial\] /.test(String(c || ''))
const nomeCliente = q => { const c = String([].concat(q.cliente || '')[0] || ''); return ehProspecto(c) ? '' : c }
rotasPlanos.get('/api/cliente/vendas', trata((req, res) => {
  const cliente = nomeCliente(req.query), dias = Math.min(90, Math.max(7, Number(req.query.dias) || 28))
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  res.json({ disponivel: true, dias, cobertura: coberturaPedidos(cliente), itens: maisVendidos(cliente, { dias }) })
}))
rotasPlanos.get('/api/cliente/impacto', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  res.json({ disponivel: true, ...analisarCliente(cliente) })
}))
rotasPlanos.post('/api/cliente/coletar', trata((req, res) => {
  const cliente = (c => ehProspecto(c) ? '' : c)(String(req.body?.cliente || ''))
  if (!cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  // depois da coleta: fotografias do acompanhamento (antes das tarefas abertas, marcos das concluídas) — só banco, sem nova chamada ao ML
  const job = iniciar('coletar', { tipo: 'cliente', consultor: '', squad: '', clientes: [cliente] }, async p => { const r = await coletarCliente(cliente, { aoProgredir: p }); try { r.acompanhamento = capturarAcompanhamento(cliente) } catch (e) { r.acompanhamento = { erro: String(e.message).slice(0, 120) } }; return r })
  res.json({ job: job.id })
}))

// ── avisos do sistema (cliente conectou, vínculo caiu…): a tela consulta a cada poucos segundos ──
rotasPlanos.get('/api/notificacoes', trata((req, res) => res.json(listarNotificacoes({ desde: req.query.desde, limite: req.query.limite }))))
rotasPlanos.post('/api/notificacoes/lidas', trata((req, res) => res.json({ ok: true, marcadas: marcarLidas(Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : null) })))

// ── acompanhamento por TAREFA: o anúncio (imagem), antes × 24h × 48h × 72h × 1 semana × hoje, micro gráfico; só o que gerou resultado ──
rotasPlanos.get('/api/cliente/tarefas-anuncio', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  const dias = Math.min(180, Math.max(7, Number(req.query.dias) || 60))
  const tarefaId = req.query.tarefa ? String([].concat(req.query.tarefa)[0]) : null
  res.json({ disponivel: true, ...cartoesDoCliente(cliente, { dias, soResultado: ['1', 'true'].includes(String([].concat(req.query.resultado || '')[0])), tarefaId, limite: Math.min(200, Math.max(1, Number(req.query.limite) || 80)) }) })
}))
// retroalimentação do Merovíngio: estado da conta (queda / estagnação / crescimento), o que fazer, o que funciona e o que não, 80/20, combinações
rotasPlanos.get('/api/cliente/retroalimentacao', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  res.json(retroalimentar(cliente))
}))
// vínculo tarefa → anúncio: sugestões (nunca entram em medição sozinhas) e confirmação pela equipe
rotasPlanos.get('/api/cliente/vinculos', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  if (!estaConectado(cliente)) return res.json(semDados(cliente))
  res.json({ disponivel: true, ...sugestoesDeVinculo(cliente) })
}))
rotasPlanos.post('/api/cliente/vinculo', trata((req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const por = typeof b.por === 'string' ? b.por.trim().slice(0, 80) : ''
  const args = { tarefa_id: String(b.tarefa_id || ''), item_id: String(b.item_id || ''), por }
  if (!args.tarefa_id || !args.item_id) return res.status(400).json({ erro: 'informe "tarefa_id" e "item_id"' })
  if (b.acao === 'confirmar') return res.json(vinculosCliente.confirmar(args))
  if (b.acao === 'recusar') { if (!por) return res.status(400).json({ erro: 'informe "por" (quem recusou)' }); return res.json(vinculosCliente.recusar(args)) }
  if (b.acao === 'remover') return res.json(vinculosCliente.remover(args))
  res.status(400).json({ erro: '"acao" deve ser confirmar, recusar ou remover' })
}))
// recalcula o acompanhamento e o plano (com a retroalimentação) sem nova coleta
rotasPlanos.post('/api/cliente/acompanhar', trata((req, res) => {
  const cliente = (c => ehProspecto(c) ? '' : c)(String(req.body?.cliente || ''))
  if (!cliente || !conectadoComDados(cliente)) return res.status(409).json({ erro: 'conta do Mercado Livre não conectada ou sem coleta' })
  const job = iniciar('acompanhar', { tipo: 'cliente', consultor: '', squad: '', clientes: [cliente] }, async () => ({ acompanhamento: capturarAcompanhamento(cliente), plano: (({ salvo, retro_erro }) => ({ salvo, retro_erro }))(gerarPlanoConta(cliente)) }))
  res.json({ job: job.id })
}))
rotasPlanos.get('/api/resultados/padroes', trata((req, res) => {
  const f = lerF(req, 'resultados')
  const p = padroesGlobais()
  const { analises, ...resto } = p
  // nicho/região/nicho × tipo entram NO FIM da resposta (contrato de ordem das chaves de antes preservado)
  if (!f) return res.json({
    ...resto,
    mensurabilidade: analises.map(a => ({ cliente: a.cliente, ...a.resumo, nao_mensuraveis: a.nao_mensuraveis, cobertura: a.cobertura })),
    medidas: analises.flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente }))).filter(m => ['melhorou', 'piorou', 'lancamento'].includes(m.estado)).slice(0, 80),
    ...agruparDimensoes(analises.flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente })))),
    carteira_produto: carteiraProduto(p.clientes),
  })
  // com filtro: as MEDIDAS são recortadas (cliente, analista — lista de nomes —, tipo, canal, data de conclusão) e os agrupamentos são recalculados pelo mesmo
  // agruparPadroes (mesma ordem). Toda medição é do Mercado Livre (único canal conectado): canal ≠ ML esvazia. A cobertura por cliente não é recalculada.
  const todas = analises.flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente })))
  const medidas = aplicarFiltro(todas, arvoreListas(f, ['analista']), (m, c) => c === 'canal' ? 'ML' : m[c], { data_conclusao: m => m.data })
  const clientes = new Set(medidas.map(m => m.cliente))
  res.json({
    ...resto, ...agruparPadroes(medidas),
    mensurabilidade: analises.filter(a => clientes.has(a.cliente)).map(a => ({ cliente: a.cliente, ...a.resumo, nao_mensuraveis: a.nao_mensuraveis, cobertura: a.cobertura })),
    medidas: medidas.filter(m => ['melhorou', 'piorou', 'lancamento'].includes(m.estado)).slice(0, 80),
    filtro: filtroNaResposta(f, { aviso: 'O filtro recorta as tarefas medidas; os totais de contas conectadas e a cobertura de medição continuam da base inteira (não são recalculados pelo recorte). Toda medição é do Mercado Livre.' }),
    ...agruparDimensoes(medidas),
    carteira_produto: carteiraProduto(p.clientes),
  })
}))
// clientes Ativos da central (fora dos status excluídos, com ou sem quadro) × contas conectadas, por produto: base inteira, o filtro não recalcula
function carteiraProduto(conectados) {
  const { elegiveis, ignorados } = clientesElegiveis(), ativos = new Set([...elegiveis.map(c => c.cliente), ...ignorados.filter(i => !/^status/.test(i.motivo)).map(i => i.cliente)])
  return carteiraPorProduto(carregarClientes().filter(c => ativos.has(c.cliente)), conectados)
}

// ── paginação no servidor (50 por linha de página): página que não é inteiro ≥ 1 ou passa da última → 400 (a mensagem não repete o valor) ──
const POR_PAGINA = 50
function paginaDe(query, total) {
  const cru = String([].concat(query.pagina ?? '1')[0])
  if (!/^\d{1,6}$/.test(cru) || Number(cru) < 1) throw Object.assign(new Error('página inválida (inteiro a partir de 1)'), { status: 400 })
  const pagina = Number(cru), paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (pagina > paginas) throw Object.assign(new Error('página fora da faixa'), { status: 400 })
  return { pagina, paginas, inicio: (pagina - 1) * POR_PAGINA }
}
const um1 = (q, k) => String([].concat(q[k] ?? '')[0] ?? '').trim()

// drill-down de uma linha das tabelas de /resultados: as tarefas medidas daquele grupo, PIOROU PRIMEIRO, 50 por página (análise em cache de 5 min).
// Mesma regra de grupo de agruparPadroes/agruparDimensoes (medidasDoGrupo); as confundidas pelo preço aparecem com o aviso (estão fora do padrão).
const GRUPOS_DRILL = ['tipo', 'analista', 'nicho', 'regiao', 'uf', 'nicho_tipo', 'produto'], ESTADOS_DRILL = ['piorou', 'melhorou', 'sem_efeito']
rotasPlanos.get('/api/resultados/tarefas', trata((req, res) => {
  const grupo = um1(req.query, 'grupo'), chave = um1(req.query, 'chave').slice(0, 200), estado = um1(req.query, 'estado')
  if (!GRUPOS_DRILL.includes(grupo)) return res.status(400).json({ erro: 'grupo inválido (tipo, analista, nicho, regiao, uf, nicho_tipo ou produto)' })
  if (!chave) return res.status(400).json({ erro: 'informe "chave"' })
  if (estado && !ESTADOS_DRILL.includes(estado)) return res.status(400).json({ erro: 'estado inválido (piorou, melhorou ou sem_efeito)' })
  const f = lerF(req, 'resultados')
  const todas = (padroesGlobaisCache().analises || []).filter(a => !ehProspecto(a.cliente)).flatMap(a => a.medidas.map(m => ({ ...m, cliente: a.cliente })))
  const recorte = f ? aplicarFiltro(todas, arvoreListas(f, ['analista']), (m, c) => c === 'canal' ? 'ML' : m[c], { data_conclusao: m => m.data }) : todas
  const doGrupo = medidasDoGrupo(recorte, grupo, chave)
  const lista = (estado ? doGrupo.filter(m => m.estado === estado) : doGrupo).sort((a, b) => ESTADOS_DRILL.indexOf(a.estado) - ESTADOS_DRILL.indexOf(b.estado)
    || (a.estado === 'piorou' ? (a.receita_alocada ?? 0) - (b.receita_alocada ?? 0) : Math.abs(b.receita_alocada ?? 0) - Math.abs(a.receita_alocada ?? 0)) || String(b.data).localeCompare(String(a.data)))
  const { pagina, paginas, inicio } = paginaDe(req.query, lista.length)
  const item = db.prepare('SELECT titulo, thumb, permalink FROM meli_item WHERE cliente = ? AND item_id = ?')
  const pct = v => `${v > 0 ? '+' : ''}${String(v).replace('.', ',')}%`
  const linhas = lista.slice(inicio, inicio + POR_PAGINA).map(m => {
    const i0 = m.itens?.[0], it = i0 ? item.get(m.cliente, i0) : null
    return {
      id: m.id, titulo: m.titulo, url: m.url || '', tipo: m.tipo, analista: m.analista, cliente: m.cliente, nicho: m.nicho || SEM_NICHO, regiao: m.regiao || SEM_UF, data: m.data, data_estimada: !!m.data_estimada,
      estado: m.estado, efeito_pct: m.efeito_pct ?? null, receita: m.receita_alocada ?? null, confianca: m.confianca ? { score: m.confianca.score, classe: m.confianca.classe } : null,
      anuncio: i0 ? { item_id: i0, titulo: it?.titulo || '', thumb: it?.thumb || '', permalink: it?.permalink || '' } : null, itens_extra: Math.max(0, (m.itens?.length || 0) - 1),
      aviso_preco: m.confundido_preco ? `preço variou ${m.variacao_preco_pct == null ? '' : pct(m.variacao_preco_pct) + ' '}na janela: o efeito pode ser do preço (fora do aprendizado)`
        : !m.intervencao_preco && m.eventos_preco?.length ? `preço mudou ${m.eventos_preco.length} vez(es) na janela (abaixo do limiar: segue no aprendizado com menos confiança)` : null,
      // estado (promoção, Ads, Full, estoque, pausa) na janela: só os eventos que NÃO são a própria intervenção da família da tarefa
      aviso_estado: m.confundido_estado ? `${(m.eventos_estado || []).filter(e => !(m.intervencao_estado || []).includes(e.campo)).map(e => `${fraseEstado(e)} em ${String(e.dia).slice(8, 10)}/${String(e.dia).slice(5, 7)}`).join('; ')}: o efeito pode ser desse evento, não da tarefa (fora do aprendizado)` : null,
    }
  })
  res.json({ grupo, chave, estado: estado || null, total: lista.length, pagina, paginas, por_pagina: POR_PAGINA,
    contagem: Object.fromEntries(ESTADOS_DRILL.map(e => [e, doGrupo.filter(m => m.estado === e).length])), linhas,
    ...(f ? { filtro: filtroNaResposta(f) } : {}), aviso: 'Associação temporal ajustada por controle e ruído — não é causalidade comprovada. Toda medição é do Mercado Livre.' })
}))

// cronologia de preços do cliente (histórico do anúncio, campo preço): cada mudança com a tarefa que coincide — a medida do motor cuja janela contém a
// mudança no mesmo anúncio (marcarPreco) — e vendas/dia 7 dias antes → depois (observado, sem controle). Prospect do Comercial nunca é cliente: 400.
const ROT_FONTE = { coleta: 'coleta diária', promo: 'promoção', acomp: 'fotografia do acompanhamento', ofertas: 'Ofertas Estratégicas', webhook: 'notificação do Mercado Livre' }
rotasPlanos.get('/api/cliente/precos', trata((req, res) => {
  const cliente = um1(req.query, 'cliente')
  if (ehProspecto(cliente)) return res.status(400).json({ erro: 'prospect do Comercial não é cliente: sem cronologia de preços' })
  if (!cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  const dias = Math.min(365, Math.max(7, Number(um1(req.query, 'dias')) || 90)), hoje = hojeLocal(), de = addDias(hoje, -dias)
  const evs = historico.eventosAnuncio(cliente, { de, campos: ['preco'] }), desde = historico.inicioHistorico(cliente)
  const medidas = evs.size ? analisarCliente(cliente, { hoje }).medidas : []
  const coincide = (item, dia) => medidas.filter(m => (m.eventos_preco || []).some(e => e.item_id === item && e.dia === dia))
    .sort((a, b) => (b.intervencao_preco === true) - (a.intervencao_preco === true) || Math.abs(diasEntre(a.data, dia)) - Math.abs(diasEntre(b.data, dia)))[0] || null
  // vendas/dia: 7 dias antes (D−7..D−1) × até 7 depois (D+1.., até o último dia completo); o dia da mudança fica fora; fora da coleta é null, não zero
  const cob = coberturaPedidos(cliente), ult = cob?.ate && cob.ate < addDias(hoje, -1) ? cob.ate : addDias(hoje, -1)
  const un = new Map()
  if (evs.size) for (const r of db.prepare('SELECT item_id, dia, unidades FROM meli_serie_item WHERE cliente = ? AND item_id IN (SELECT value FROM json_each(?))').all(cliente, JSON.stringify([...evs.keys()]))) (un.get(r.item_id) || un.set(r.item_id, {}).get(r.item_id))[r.dia] = r.unidades || 0
  const soma = (s, a, b) => { let t = 0; for (let d = a; d <= b; d = addDias(d, 1)) t += s?.[d] || 0; return t }
  const r2 = x => Math.round(x * 100) / 100
  const vendasDia = (item, dia) => {
    const aDe = addDias(dia, -7), dDe = addDias(dia, 1), dAte = addDias(dia, 7) < ult ? addDias(dia, 7) : ult
    const antes = cob?.de && aDe >= cob.de ? r2(soma(un.get(item), aDe, addDias(dia, -1)) / 7) : null
    const n = dAte >= dDe ? diasEntre(dDe, dAte) + 1 : 0, depois = n ? r2(soma(un.get(item), dDe, dAte) / n) : null
    return { antes, depois, dias_depois: n, variacao_pct: antes > 0 && depois != null ? Math.round(1000 * (depois / antes - 1)) / 10 : null }
  }
  const itens = new Map(db.prepare('SELECT item_id, titulo, thumb, permalink, catalogo FROM meli_item WHERE cliente = ?').all(cliente).map(r => [r.item_id, r])), catCtx = catalogoDb.contexto(cliente)
  const linhas = [...evs].flatMap(([item_id, l]) => l.map(e => {
    const t = coincide(item_id, e.dia), it = itens.get(item_id) || {}
    return { item_id, titulo: it.titulo || '', thumb: it.thumb || '', permalink: it.permalink || '', catalogo_origem: origemCatalogo({ id: item_id, catalogo: it.catalogo }, catCtx), dia: e.dia, ...(e.incerteza ? { incerteza: e.incerteza } : {}), de: e.de, para: e.para, variacao_pct: e.pct,
      fonte: e.fonte, origem: ROT_FONTE[e.fonte] || e.fonte, tarefa: t ? { id: t.id, titulo: t.titulo, tipo: t.tipo, url: t.url || '', tarefa_de_preco: !!t.intervencao_preco, etiqueta: t.intervencao_preco ? 'a própria tarefa' : 'pode ter interferido' } : null,
      vendas_dia: vendasDia(item_id, e.dia) }
  }))
  // piores efeitos primeiro (maior queda de vendas/dia); sem leitura no fim; empate pela mudança mais recente
  linhas.sort((a, b) => (a.vendas_dia.variacao_pct ?? 1e9) - (b.vendas_dia.variacao_pct ?? 1e9) || b.dia.localeCompare(a.dia))
  const { pagina, paginas, inicio } = paginaDe(req.query, linhas.length)
  res.json({ disponivel: true, cliente, dias, de, ate: hoje, desde, total: linhas.length, pagina, paginas, por_pagina: POR_PAGINA, eventos: linhas.slice(inicio, inicio + POR_PAGINA),
    aviso: `${desde ? `Histórico registrado desde ${desde.split('-').reverse().join('/')} (uma leitura por dia, na coleta das 4–6h). Antes disso: preço realizado nos dias com venda e promoções.` : 'A coleta ainda não registrou mudança de preço nesta conta (uma leitura por dia, na coleta das 4–6h). Até lá: preço realizado nos dias com venda e promoções.'} Mudança que vai e volta no mesmo dia não aparece. 7 dias antes → depois é variação observada, sem grupo de controle; não é efeito.` })
}))
rotasPlanos.get('/api/gmv', trata((req, res) => {
  const f = req.query.f ? lerFiltro(String([].concat(req.query.f)[0]), { painel: 'gmv', hoje: hojeLocal() }) : null
  // "analista é igual a X" vale para qualquer analista que tenha trabalhado o cliente no período (a linha traz todos os nomes)
  const arv = f?.arvore ? JSON.parse(JSON.stringify(f.arvore), (k, v) => v && v.campo === 'analista' && v.operador === 'igual' ? { ...v, operador: 'contem' } : v) : null
  const pred = arv ? compilarPredicado({ ...f, arvore: arv }) : null
  const r = gmvPortfolio({ dias: [14, 28, 56].includes(Number(req.query.dias)) ? Number(req.query.dias) : 28, periodo: f?.periodo?.resolvido ? { ...f.periodo.resolvido, comparar: f.periodo.comparar } : null, filtro: pred })
  res.json(f ? { ...r, filtro: { chips: chipsFiltro(f), periodo: f.periodo?.resolvido || null, serializado: String([].concat(req.query.f)[0]) } } : r)
}))

// ── filtros avançados (E/OU, operadores, período explícito, favoritos) — a mesma gramática em todos os painéis ──
const filtrosSalvos = criarFiltrosSalvos(db)
const opcoesDe = (painel, nome) => {
  const cl = carregarClientes()
  switch (nome) {
    case 'clientes': return cl.map(c => c.cliente)
    case 'consultores': return [...new Set(cl.flatMap(c => [...Object.values(c.consultores), c.principal]).filter(Boolean))].sort()
    case 'analistas': case 'responsaveis': { const of = analistasOficiais().map(a => a.nome); return of.length ? of : [...new Set(db.prepare("SELECT DISTINCT responsavel v FROM tarefas WHERE arquivada = 0 AND responsavel != ''").all().flatMap(r => r.v.split(',').map(s => s.trim())))].sort() }
    case 'canais': return Object.entries(CANAIS).filter(([k]) => k !== 'Legacy').map(([k, v]) => ({ id: k, rotulo: v }))
    case 'canais_rotulo': return Object.values(CANAIS).filter(v => v !== 'Legacy')
    case 'processos': return db.prepare("SELECT DISTINCT processo v FROM tarefas WHERE arquivada = 0 AND processo != '' ORDER BY v").all().map(r => r.v)
    case 'projetos': return db.prepare("SELECT DISTINCT projeto v FROM tarefas WHERE arquivada = 0 AND projeto != '' ORDER BY v").all().map(r => r.v)
    case 'sprints': return db.prepare("SELECT DISTINCT sprint v FROM tarefas WHERE arquivada = 0 AND sprint != '' ORDER BY v").all().map(r => r.v)
    case 'status_tarefa': return Object.keys(ROTULOS_FILTRO.status_tarefa).map(id => ({ id, rotulo: ROTULOS_FILTRO.status_tarefa[id] }))   // as 7 classes de status-tarefa.js
    case 'status_acao': return ['proposta', 'aprovada', 'distribuida', 'descartada', 'obsoleta'].map(id => ({ id, rotulo: ROTULOS_FILTRO.status_acao[id] || id }))
    case 'horizontes': return ['72h', '7d', '30d', '90d'].map(id => ({ id, rotulo: ROTULOS_FILTRO.horizontes[id] || id }))
    case 'status_anuncio': return ['active', 'paused', 'closed', 'under_review'].map(id => ({ id, rotulo: ROTULOS_FILTRO.status_anuncio[id] || id }))
    case 'curvas': return ['A', 'B', 'C']
    case 'sim_nao': return [{ id: '1', rotulo: 'Sim' }, { id: '0', rotulo: 'Não' }]            // campos bool do painel 'folha'
    case 'logistica': return ['fulfillment', 'cross_docking', 'drop_off', 'xd_drop_off', 'self_service', 'not_specified'].map(id => ({ id, rotulo: ROTULOS_FILTRO.logistica[id] || id }))
    case 'nichos': return [...new Set([...db.prepare('SELECT nicho FROM clientes_central').all().map(r => normalizarNicho(r.nicho)), SEM_NICHO])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    case 'produtos': return [...PRODUTOS, SEM_PRODUTO].map(id => ({ id, rotulo: ROTULO_PRODUTO[id] }))
    case 'ufs': return [...UFS, SEM_UF]
    case 'regioes': return [...new Set(UFS.map(regiaoDe)), SEM_UF]
    case 'etapas_comercial': return ['aguardando', 'erro', 'conectado', 'pronto', 'pediu_contato'].map(id => ({ id, rotulo: ROTULOS_FILTRO.etapas_comercial[id] || id }))   // = etapaProspecto ("coletando" é estado de job, não do prospect)
    default: return []
  }
}
rotasPlanos.get('/api/filtros/definicao', trata((req, res) => {
  const painel = String([].concat(req.query.painel || '')[0])
  if (!Object.hasOwn(PAINEIS_FILTRO, painel)) return res.status(400).json({ erro: 'painel desconhecido' })
  const d = definicaoFiltro(painel)
  res.json({ ...d, campos: d.campos.map(c => ({ ...c, valores: c.opcoes ? opcoesDe(painel, c.opcoes) : null })), salvos: filtrosSalvos.listar(painel), hoje: hojeLocal() })
}))
rotasPlanos.get('/api/filtros/periodo', trata((req, res) => res.json(resolverPeriodo({ preset: String([].concat(req.query.preset || 'ultimos_90_dias')[0]), de: String([].concat(req.query.de || '')[0]), ate: String([].concat(req.query.ate || '')[0]) }, hojeLocal()))))
rotasPlanos.post('/api/filtros/validar', trata((req, res) => { const d = validarFiltro(req.body || {}, { hoje: hojeLocal() }); res.json({ ok: true, definicao: d, chips: chipsFiltro(d) }) }))
rotasPlanos.get('/api/filtros/salvos', trata((req, res) => res.json(filtrosSalvos.listar(String([].concat(req.query.painel || '')[0])))))
rotasPlanos.post('/api/filtros/salvos', trata((req, res) => {
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return res.status(415).json({ erro: 'envie o corpo como JSON' })
  const b = req.body || {}
  res.json({ ok: true, ...filtrosSalvos.salvar({ painel: String(b.painel || ''), nome: String(b.nome || ''), definicao: b.definicao || {}, por: String(b.por || '') }) })
}))
rotasPlanos.post('/api/filtros/salvos/usar', trata((req, res) => { filtrosSalvos.usar(req.body?.id); res.json({ ok: true }) }))
rotasPlanos.delete('/api/filtros/salvos/:id', trata((req, res) => res.json({ ok: true, removidos: filtrosSalvos.remover(req.params.id, String([].concat(req.query.painel || '')[0])) })))

// anúncios do cliente no período (data da venda), com comparações explícitas e a árvore de condições aplicada aos números calculados
rotasPlanos.get('/api/cliente/anuncios', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  const f = req.query.f ? lerFiltro(String([].concat(req.query.f)[0]), { painel: 'cliente', hoje: hojeLocal() }) : validarFiltro({ painel: 'cliente', periodo: { campo: 'data_venda', preset: String([].concat(req.query.preset || 'ultimos_90_dias')[0]), de: req.query.de, ate: req.query.ate, comparar: 'anterior' } }, { hoje: hojeLocal() })
  if (!f.periodo) f.periodo = validarFiltro({ painel: 'cliente', periodo: { campo: 'data_venda', preset: 'ultimos_90_dias', comparar: 'anterior' } }, { hoje: hojeLocal() }).periodo
  res.json({ disponivel: true, ...anunciosDoCliente(cliente, f), filtro: { chips: chipsFiltro(f), serializado: req.query.f || null } })
}))

// ── Folha do anúncio (Resumo do cliente): uma linha por anúncio com os tópicos marcados (?blocos=anuncios,ads,full,metricas), filtro do painel 'folha'
// em ?ff= (o ?f= da mesma tela é do painel 'cliente'), ordem e página; JSON paginado (50) e CSV saem da MESMA folhaDoCliente. Prospect do Comercial
// nunca é cliente (400); erros de validação nunca repetem o valor recebido (lib/folha-anuncio.js). ──
const PERIODO_FOLHA = () => validarFiltro({ painel: 'folha', periodo: { campo: 'data_venda', preset: 'ultimos_90_dias', comparar: 'anterior' } }, { hoje: hojeLocal() }).periodo
const pedidoFolha = (req, csv) => {
  const cliente = um1(req.query, 'cliente')
  if (ehProspecto(cliente)) throw Object.assign(new Error('prospect do Comercial não é cliente: sem folha do anúncio'), { status: 400 })
  if (!cliente) throw Object.assign(new Error('informe "cliente"'), { status: 400 })
  if (!conectadoComDados(cliente)) return null
  const f = req.query.ff ? lerFiltro(um1(req.query, 'ff'), { painel: 'folha', hoje: hojeLocal() }) : validarFiltro({ painel: 'folha' }, { hoje: hojeLocal() })
  if (!f.periodo) f.periodo = PERIODO_FOLHA()
  const blocos = um1(req.query, 'blocos').split(',').map(s => s.trim()).filter(Boolean)
  return { ...folhaDoCliente(cliente, f, { blocos, ordem: um1(req.query, 'ordem') || 'faturamento', pagina: um1(req.query, 'pagina') || '1', csv }), filtro: { chips: chipsFiltro(f), serializado: req.query.ff ? um1(req.query, 'ff') : null } }
}
rotasPlanos.get('/api/cliente/folha', trata((req, res) => { const r = pedidoFolha(req, false); res.json(r || semDados(um1(req.query, 'cliente'))) }))
rotasPlanos.get('/api/cliente/folha.csv', trata((req, res) => {
  const r = pedidoFolha(req, true)
  if (!r) return res.status(409).json(semDados(um1(req.query, 'cliente')))
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  // só ASCII no filename: o Node recusa cabeçalho fora do Latin-1 (nome com letra grega/cirílica/CJK viraria 400 com a mensagem interna)
  res.setHeader('Content-Disposition', `attachment; filename="folha-do-anuncio-${r.cliente.normalize('NFD').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${r.periodo.de}-${r.periodo.ate}.csv"`)
  res.send(csvDaFolha(r))
}))

// ── PLANO DA CONTA POR ANÚNCIO: gerar, ler, documento (HTML/PDF) e planilha (CSV) ──
const acoesAnuncio = cliente => lerAcoes({ clientes: [cliente], status: ['proposta', 'aprovada', 'distribuida', 'descartada'] })
  .filter(a => a.regra.startsWith('anuncio_'))
  .map(a => ({ ...a, previsao: a.previsao_json ? JSON.parse(a.previsao_json) : null }))
// catálogo próprio × terceiros AO VIVO (a marcação pode mudar depois que a ação foi gravada): nunca fica o selo velho no plano
const comOrigem = (cliente, acoes) => { const o = catalogoDb.origensDe(cliente, acoes.map(a => a.item_id)); for (const a of acoes) if (a.dados.item) a.dados.item.catalogo_origem = o.get(a.item_id) ?? a.dados.item.catalogo_origem ?? 'nao'; return acoes }
const resumoAnuncio = a => ({ id: a.id, regra: a.regra.replace('anuncio_', ''), titulo: a.titulo, item_id: a.item_id, score: a.score, prioridade: a.dados.prioridade?.p, fila: a.dados.fila, status: a.status, horizonte: a.horizonte, prazo: a.prazo, responsavel: a.responsavel, evidencia_tipo: a.dados.evidencia_tipo, permalink: a.dados.item?.permalink || '', thumb: a.dados.item?.thumb || '', classe: a.dados.item?.classe || '', catalogo_origem: a.dados.item?.catalogo_origem || 'nao', catalogo_texto: TEXTO_CATALOGO[a.dados.item?.catalogo_origem] || '', previsao: a.previsao ? { tipo: a.previsao.tipo, cenarios: a.previsao.cenarios, p_sucesso: a.previsao.p_sucesso, valor_esperado: a.previsao.valor_esperado } : null, notion_url: a.notion_url })
rotasPlanos.get('/api/plano-conta', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  if (!conectadoComDados(cliente)) return res.json(semDados(cliente))
  const diag = diagnosticarConta(cliente), acoes = comOrigem(cliente, acoesAnuncio(cliente))
  const ativas = acoes.filter(a => !['descartada', 'obsoleta'].includes(a.status))
  res.json({ disponivel: true, gerado: acoes.length > 0, resumo: diag.resumo, ads: diag.ads, economia: diag.economia, custos_informados: diag.custos_informados, benchmark: diag.benchmark,
    previsao: ativas.length ? previsaoDoPlano(diag, ativas) : null, acoes: acoes.map(resumoAnuncio), pendencias: diag.pendencias, algoritmo_versao: algoritmo.versao })
}))
rotasPlanos.post('/api/plano-conta/gerar', trata((req, res) => {
  const cliente = (c => ehProspecto(c) ? '' : c)(String(req.body?.cliente || ''))
  if (!conectadoComDados(cliente)) return res.status(409).json({ erro: 'conta do Mercado Livre não conectada ou sem coleta — conecte e atualize os dados primeiro' })
  const r = gerarPlanoConta(cliente)
  res.json({ ok: true, salvo: r.salvo, n_acoes: r.acoes.length, esta_semana: r.acoes.filter(a => a.dados.fila === 'esta_semana').length, omitidas: r.omitidas, previsao: r.previsao })
}))
rotasPlanos.get('/plano-conta', (req, res) => {
  try {
    const cliente = nomeCliente(req.query)
    if (!cliente || !conectadoComDados(cliente)) return res.status(404).send('<pre>Cliente sem conta do Mercado Livre conectada ou sem coleta de dados.</pre>')
    const acoes = comOrigem(cliente, acoesAnuncio(cliente))
    if (!acoes.length) return res.status(404).send('<pre>Plano ainda não gerado para este cliente. Gere na tela do cliente (Plano da conta por anúncio).</pre>')
    const diag = diagnosticarConta(cliente), ativas = acoes.filter(a => !['descartada', 'obsoleta'].includes(a.status)).sort((a, b) => b.score - a.score)
    res.send(renderPlanoConta({ diag, acoes: ativas, previsao: previsaoDoPlano(diag, ativas), custos: custosDoCliente(cliente), omitidas: {} }))
  } catch (e) { res.status(400).send('<pre>Não foi possível montar o documento.</pre>') }
})
const csvSeguro = v => { let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' '); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return `"${x}"` }
rotasPlanos.get('/api/plano-conta/acoes.csv', trata((req, res) => {
  const cliente = nomeCliente(req.query)
  const linhas = comOrigem(cliente, acoesAnuncio(cliente)).filter(a => a.status !== 'obsoleta').sort((a, b) => b.score - a.score).map(a => {
    const d = a.dados, c = a.previsao?.cenarios
    return { 'ID': a.id, 'Cliente': a.cliente, 'Anúncio (MLB)': a.item_id, 'Link do anúncio': d.item?.permalink || '', 'Curva/Potencial': d.item?.classe || '', 'Catálogo': { proprio: 'catálogo próprio', terceiros: 'catálogo de terceiros' }[d.item?.catalogo_origem] || '', 'Regra': a.regra.replace('anuncio_', ''),
      'Ação': a.titulo, 'Por quê (evidência)': `[${d.evidencia_tipo}] ${d.evidencia}`, 'Hipótese': d.hipotese || '', 'Como': (d.como || []).join(' | '),
      'Baseline': d.indicador_inicial, 'Meta': d.meta, 'Critério de aceite': d.criterio_aceite,
      'Impacto conservador (R$)': c?.conservador.receita ?? '', 'Impacto base (R$)': c?.base.receita ?? '', 'Impacto otimista (R$)': c?.otimista.receita ?? '',
      'Probabilidade': a.previsao ? Math.round(a.previsao.p_sucesso * 100) + '%' : '', 'Fonte da probabilidade': a.previsao?.p_fonte || '', 'Valor esperado (R$)': a.previsao?.valor_esperado ?? '',
      'Prioridade': d.prioridade?.p || '', 'Score': a.score, 'Fila': d.fila === 'esta_semana' ? 'esta semana' : 'fila', 'Status': a.status, 'Responsável': a.responsavel || 'responsável a definir', 'Prazo': a.prazo, 'Link Notion': a.notion_url || '' }
  })
  const cols = linhas.length ? Object.keys(linhas[0]) : ['ID']
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="plano-da-conta-por-anuncio.csv"')
  res.send('﻿' + [cols.map(csvSeguro).join(';'), ...linhas.map(l => cols.map(c => csvSeguro(l[c])).join(';'))].join('\r\n'))
}))

// ── MOTOR DE DIAGNÓSTICO (contrato JSON das 11 chaves, relatório em PT e planilha) — projeção do Algoritmo, sem POST: a geração segue POST /api/plano-conta/gerar ──
const pedidoDiagnostico = q => {
  const bruto = String([].concat(q.cliente || '')[0] || '')
  if (ehProspecto(bruto)) throw Object.assign(new Error('prospect do Comercial não é cliente: sem diagnóstico'), { status: 400 })
  if (!bruto) throw Object.assign(new Error('informe "cliente"'), { status: 400 })
  return diagnosticoDoCliente(bruto)
}
// o contrato vem do memo de diagnosticoDoCliente (cliente, hoje, carimbo das ações/coleta); a validação e o HTML ficam presos à MESMA geração (objeto/gerado_em)
const validados = new WeakMap()
rotasPlanos.get('/api/cliente/diagnostico', trata((req, res) => {
  const j = pedidoDiagnostico(req.query)
  let v = validados.get(j); if (!v) { v = validarContrato(j); validados.set(j, v) }
  // erro aqui é estrutural (texto ruim já foi neutralizado na montagem); as frases são fixas, nunca ecoam o valor recebido
  if (!v.ok) return res.status(500).json({ erro: 'contrato do diagnóstico inválido', erros: v.erros })
  res.json(j)
}))
rotasPlanos.get('/diagnostico-motor', trata(async (req, res) => {
  const j = pedidoDiagnostico(req.query)
  const para = um1(req.query, 'para') === 'cliente' ? 'cliente' : 'interno'
  if (!j.disponivel) return res.status(404).send('<pre>Cliente sem conta do Mercado Livre conectada ou sem coleta de dados.</pre>')
  const html = await memoDiagnostico(JSON.stringify(['html', j.cliente, para, j.gerado_em]), async () => {
    let nomes = []; try { nomes = para === 'cliente' ? nomesInternos(j.cliente) : [] } catch { nomes = [] }
    // IA só no relatório interno (leitura executiva redigida, números conferidos contra as evidências citadas); ao cliente, texto determinístico — redigir nunca é chamado
    return paginaDiagnostico(j, { para, nomesInternos: nomes, redigir })
  })
  res.send(html)
}))
rotasPlanos.get('/api/cliente/diagnostico.csv', trata((req, res) => {
  const j = pedidoDiagnostico(req.query)
  if (!j.disponivel) return res.status(409).json(semDados(j.cliente))
  const E = new Map(j.evidence.map(e => [e.id, e]))
  const linhas = j.actions.map(a => ({ 'ID': a.id, 'Cliente': j.cliente, 'Entidade': `${a.entidade.tipo}:${a.entidade.id}`, 'Regra': a.regra, 'O quê': a.o_que, 'Por quê (evidência)': (a.por_que.evidence_ids || []).map(id => E.get(id)).filter(Boolean).map(e => `[${e.tipo}] ${e.texto}`).join(' | '),
    'Hipótese': a.por_que.hipotese || '', 'Indicador': a.metrica_sucesso.indicador, 'Meta': a.metrica_sucesso.meta, 'Parada': a.parada, 'Revisar em': a.revisar_em || '', 'Depende de': (a.depende_de || []).join(' '), 'Limites': (a.limites || []).join(' | '),
    'Prioridade': a.prioridade.p || '', 'Nota': a.prioridade.nota ?? '', 'Valor esperado (R$)': a.previsao?.valor_esperado ?? '', 'Probabilidade': a.previsao?.p_sucesso != null ? Math.round(a.previsao.p_sucesso * 100) + '%' : '', 'Executar via': a.executar_via, 'Responsável': a.responsavel || 'responsável a definir', 'Prazo': a.prazo || '', 'Horizonte': a.horizonte || '', 'Status': a.status }))
  const cols = linhas.length ? Object.keys(linhas[0]) : ['ID']
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="diagnostico-acoes.csv"')
  res.send('﻿' + [cols.map(csvSeguro).join(';'), ...linhas.map(l => cols.map(c => csvSeguro(l[c])).join(';'))].join('\r\n'))
}))

// ── custos do cliente (liberam ROAS alvo, break-even e desconto máximo) ──
rotasPlanos.get('/api/cliente/custos', trata((req, res) => {
  const c = custosDoCliente(nomeCliente(req.query))
  res.json({ informados: !!c, custos: c, economia: economiaAds(c) })
}))
rotasPlanos.post('/api/cliente/custos', trata((req, res) => {
  const cliente = String(req.body?.cliente || '')
  if (!cliente) return res.status(400).json({ erro: 'informe "cliente"' })
  const limpos = {}
  for (const k of ['cmv_pct', 'imposto_pct', 'comissao_pct', 'frete_pct', 'embalagem_pct', 'outros_pct', 'margem_desejada_pct']) {
    const v = Number(req.body?.custos?.[k])
    if (req.body?.custos?.[k] !== '' && req.body?.custos?.[k] != null && Number.isFinite(v) && v >= 0 && v <= 100) limpos[k] = v
  }
  if (limpos.cmv_pct == null || limpos.imposto_pct == null || limpos.comissao_pct == null) return res.status(400).json({ erro: 'informe ao menos CMV, impostos e comissão (em % do preço de venda, entre 0 e 100)' })
  db.prepare(`INSERT INTO custos_cliente (cliente, custos_json, atualizado_em) VALUES (?,?,?) ON CONFLICT(cliente) DO UPDATE SET custos_json = excluded.custos_json, atualizado_em = excluded.atualizado_em`).run(cliente, JSON.stringify(limpos), agora())
  res.json({ ok: true, custos: limpos, economia: economiaAds(limpos) })
}))

// ── metodologia viva: regras, saúde, calibração ──
rotasPlanos.get('/api/metodologia', trata((req, res) => {
  res.json({ versao: algoritmo.versao, foco: algoritmo.foco, limiares: algoritmo.limiares, ritual: algoritmo.ritual, regra_de_entrada: algoritmo.regra_de_entrada, regras: saudeRegras(), calibracao: compararPrevisaoRealizado() })
}))

// ── documento do plano (HTML; /plano.pdf é servido no server.js com o mesmo servirPdf) ──
rotasPlanos.get('/plano', (req, res) => {
  try {
    const cliente = String([].concat(req.query.cliente || '')[0] || '')
    const plano = cliente && lerPlano(cliente)
    if (!plano) return res.status(404).send('<pre>Plano não gerado para este cliente. Gere no painel de planos (/planos).</pre>')
    let pendencias = []                                    // o que depende do cliente, com a explicação (avaliador único; leitura local). Falha: o documento sai sem a seção.
    try { pendencias = pendenciasReal().avaliar(cliente).itens } catch { pendencias = [] }
    res.send(renderPlanoCliente(plano, lerAcoes({ clientes: [cliente] }), { pendencias, pendenciasEm: hojeLocal() }))
  } catch (e) { res.status(400).send('<pre>Não foi possível montar o plano.</pre>') }
})
