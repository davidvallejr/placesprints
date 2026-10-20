// Orquestração ponta a ponta do módulo Ofertas Estratégicas (spec §3, §8, §10, §11, §12). Liga os núcleos puros entre si e ao banco:
//   importarExistente → prepararEstrategia → revisar/aprovar → publicar (dry-run | live) → conferir → monitorar
// Cada etapa grava of_evento (auditoria) e, na publicação, uma of_publicacao por grupo enviado (falha parcial é por grupo).
// Deps injetadas (criarFluxo): of = criarOfertas(h); h = handle SQLite com of_* e as tabelas meli_* (série, Ads, item, contas);
// ml = criarAdaptadorML; imagens = criarProvedorImagens; agora/hoje injetáveis (o teste anda no tempo). Nada aqui chama rede sozinho.
// Honestidade: sem credencial/dado o resultado é um estado nomeado com pendência ('falha_recuperavel', 'aguardando_canal', 'pendente_dados'),
// nunca sucesso simulado. Dinheiro: números em reais já arredondados pelos núcleos (o cálculo em centavos é de ofertas-preco.js).
// Motor único (CLAUDE.md): com `motor` injetado (ofertas-algoritmo.js, sempre passado em fluxoPronto; abrirJob e prepararEstrategia chamam motor.sincronizar)
// o job vira/se liga a uma ação do plano (acao_id), ganha responsável pela ficha/medição e é medido pelo Merovíngio (impacto-tarefas.execucoesOfertas); a estrutura estratégica (etapas do método, título depois da galeria, sequência do Manual, briefing da duplicação,
// número que prova) vale com ou sem motor. Sem motor (autotestes de mecânica) nada de plano é criado — e nada é decidido aqui.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { CAMPOS_POR_ESCOPO, ESTADOS, OBJETIVOS, regraDoJob } from './ofertas.js'
import { checarPreservacao, CAMPOS_PRESERVAR_TITULO, ROTULO_PRESERVAR } from './ofertas-preservacao.js'
import { criarPreco, CFG_OFERTAS } from './ofertas-preco.js'
import { criarDiagnostico } from './ofertas-diagnostico.js'
import { ESTADO_POR_CLASSE, ESPERA_PROPAGACAO_MIN } from './ofertas-ml.js'
import { compilarPredicado } from './filtros.js'
import { ordemDoTipo, duplicacao as PBDUP, volumeEsperado } from './processos.js'
import { origemCatalogo } from './catalogo.js'
import { CATALOGO, escopoDeConteudo } from './catalogo-cfg.js'
import { criarCatalogo } from './catalogo-db.js'

const ALG = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8'))      // só leitura: regras/prova (o cálculo de prioridade é do motor)
const ENCERRADOS = new Set(['publicado_confirmado', 'monitorando', 'cancelado'])
// tipo na sequência lógica do Manual (saúde → disponibilidade → cadastros e duplicações → otimização → …): o motor grava dados.tipo; sem ele, anúncio novo = cadastro
const tipoDoJob = job => job.dados?.tipo || (job.dados?.duplicacao || regraDoJob(job) === 'oferta_cadastro' ? 'cadastro' : 'otimizacao')

const CANAL_CFG = { ML: 'mercadolivre', SHO: 'shopee', MAG: 'magalu', AMZ: 'amazon', TTK: 'tiktok' }   // chave do canal (of_*) → chave da config/ofertas.json
const GRUPO_DO_CAMPO = { galeria: 'galeria', atributos: 'ficha', titulo: 'titulo', preco: 'preco', descricao: 'descricao' }
const CAMPO_DO_GRUPO = Object.fromEntries(Object.entries(GRUPO_DO_CAMPO).map(([c, g]) => [g, c]))
const PENDENCIA_CLASSE = {
  credencial_expirada: 'credencial do Mercado Livre expirada ou revogada: reconectar a conta em Integrações e retomar',
  sem_permissao: 'a conta/app não tem permissão para esta operação (403): conferir escopos da conexão',
  validacao_rejeitada: 'o canal rejeitou o conteúdo: corrigir a proposta e reenviar só o grupo rejeitado',
  limite_uso: 'limite de uso da API do canal: aguardar e retomar (nada foi reenviado)',
  processamento_pendente: 'o canal não confirmou: conferir por leitura antes de reenviar',
  transitorio: 'erro transitório do canal: retomar mais tarde',
}
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const r2 = n => Math.round(Number(n) * 100) / 100
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const txt = (v, max = 300) => String(v ?? '').trim().slice(0, max)

export function criarFluxo({ of, h, ml, imagens = null, motor = null, diagnosticoConta = null, cfg = CFG_OFERTAS, agora = () => new Date().toISOString(), hoje = () => new Date().toISOString().slice(0, 10) }) {
  if (!of || !h || !ml) throw new Error('criarFluxo exige of, h e ml')
  const precoMotor = criarPreco({ cfg, agora })
  const L = cfg.limiares_diagnostico
  // CTR de referência = o da PRÓPRIA conta (diagnosticarConta → ads.ctr, injetado em fluxoPronto); sem diagnóstico da conta → null (lente de clique fica sem_dado)
  const ctrConta = cliente => { try { return diagnosticoConta?.(cliente)?.ads?.ctr ?? null } catch { return null } }
  const listaCampos = l => l.map(c => `${ROTULO_PRESERVAR[c.campo] || c.campo} (${c.valor})`).join(', ')
  const catalogoDb = criarCatalogo(h)
  const tabela = nome => !!h.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome)
  const evento = (cliente, entidade, id, acao, por, det) => of.registrarEvento(cliente, entidade, id, acao, por || 'sistema', det || {})
  // kill switch do Chaveiro (F4+, «Parar tudo») vale também para a publicação live de Ofertas; sem a tabela (banco de teste mínimo) = solto
  const paradoChaveiro = () => { try { return h.prepare("SELECT valor FROM sync_estado WHERE chave = 'chaveiro_execucao_parado'").get()?.valor === '1' } catch { return false } }

  // ── dados já coletados do canal (meli_*): série, Ads e item — nunca chama a API aqui ────────────────────────
  function dadosCanal(cliente, item_id, { dias = 28 } = {}) {
    const ate = addDias(hoje(), -1), de = addDias(ate, -(dias - 1))
    const serie = tabela('meli_serie_item') ? h.prepare('SELECT dia, unidades, receita, visitas FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia BETWEEN ? AND ? ORDER BY dia').all(cliente, item_id, de, ate) : []
    const a = tabela('meli_ads_dia') ? h.prepare('SELECT SUM(prints) prints, SUM(clicks) clicks, SUM(custo) custo, SUM(receita) receita, SUM(unidades) unidades, COUNT(*) n FROM meli_ads_dia WHERE cliente = ? AND item_id = ? AND dia BETWEEN ? AND ?').get(cliente, item_id, de, ate) : null
    const item = tabela('meli_item') ? h.prepare('SELECT * FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, item_id) : null
    return { de, ate, dias, serie, ads: a?.n ? { prints: a.prints, clicks: a.clicks, custo: r2(a.custo), receita: r2(a.receita), unidades: a.unidades } : null, item }
  }
  // benchmark de conversão = a PRÓPRIA conta (anúncios com visitas suficientes no período), nunca número de mercado
  function benchmarkConta(cliente, { de, ate }) {
    if (!tabela('meli_serie_item')) return null
    const r = h.prepare(`SELECT SUM(u) u, SUM(v) v, COUNT(*) n FROM (SELECT item_id, SUM(unidades) u, SUM(visitas) v FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ? GROUP BY item_id HAVING SUM(visitas) >= ?)`).get(cliente, de, ate, L.min_visitas_para_ler_conversao * 3)
    return r?.v > 0 ? { conv: r2(100 * r.u / r.v), n: r.n, fonte: `taxa agregada de ${r.n} anúncio(s) da própria conta com visitas suficientes em ${de}–${ate}` } : null
  }
  // catalogo_origem ('nao'|'proprio'|'terceiros'): marcação manual do cliente/anúncio (catalogo-db); sem tabela (banco de teste mínimo) ou sem marcação, catálogo é de terceiros
  const origemDe = (cliente, id, catalogo) => !catalogo ? 'nao' : origemCatalogo({ id, catalogo: 1 }, catalogoDb.contexto(cliente))
  const itemDiag = (anuncio, dc, cliente = anuncio?.cliente) => {
    const it = anuncio?.snapshot?.item
    if (it) return { id: it.id, titulo: it.title, preco: it.price, estoque: it.available_quantity ?? null, fotos: (it.pictures || []).length, criado_em: it.date_created || dc.item?.criado_em || null, status: it.status, catalogo: !!it.catalog_listing, catalogo_origem: origemDe(cliente, it.id, it.catalog_listing) }
    const m = dc.item
    return m ? { id: m.item_id, titulo: m.titulo, preco: m.preco, estoque: m.estoque, fotos: m.fotos, criado_em: m.criado_em, status: m.status, catalogo: !!m.catalogo, catalogo_origem: origemDe(cliente, m.item_id, m.catalogo) } : {}
  }

  // ── contexto de um job: variante, produto, anúncio, ficha, custos, regra ────────────────────────────────────
  function custosPara(cliente, variante_id) {
    const c = of.custoVigente(cliente, variante_id)
    if (c.bloqueios.length) return null
    return c.origem === 'of_custo' ? { custo_compra: c.custo_compra, frete_entrada: c.frete_entrada, embalagem: c.embalagem, preparo: c.preparo, outros: c.outros, fonte: c.fonte, inicio_vigencia: c.inicio_vigencia } : { custo_compra: c.total, fonte: c.fonte }
  }
  function regraPara(cliente, anuncio) {
    const canal = anuncio?.canal || 'ML', conta = anuncio?.conta_id || '', modalidade = anuncio?.snapshot?.item?.listing_type_id || ''
    for (const [c, m] of [[conta, modalidade], [conta, ''], ['', modalidade], ['', '']]) { const r = of.regraCanal(cliente, { canal, conta_id: c, modalidade: m }); if (r) return r }
    return null
  }
  function contexto(cliente, job) {
    const variante = of.obterVariante(cliente, job.variante_id)
    if (!variante) throw erro('variante do job não encontrada', 404)
    const produto = of.obterProduto(cliente, variante.produto_id)
    const anuncio = job.anuncio_id ? of.obterAnuncio(cliente, job.anuncio_id) : null
    // duplicação: o anúncio ORIGINAL é só referência (linha de base, categoria, voz do cliente) — ele nunca é alterado; o job cria a duplicata
    const origem = !anuncio && job.dados?.duplicacao?.anuncio_origem ? of.obterAnuncio(cliente, job.dados.duplicacao.anuncio_origem) : null
    const atributos = of.listarAtributos(cliente, { variante_id: variante.id, canal: anuncio?.canal || '' })
    const ficha = { nome: produto?.nome, marca: produto?.marca, modelo: produto?.modelo, cor: variante.cor, tamanho: variante.tamanho, material: variante.material, quantidade_kit: variante.quantidade_kit, descricao_base: produto?.descricao_base, descricao_atual: anuncio?.snapshot?.descricao?.plain_text ?? null, referencia_confirmada: variante.referencia_confirmada, atributos }
    return { variante, produto, anuncio, origem, ficha, custos: custosPara(cliente, variante.id), regra: regraPara(cliente, anuncio || origem), canal_cfg: CANAL_CFG[anuncio?.canal || 'ML'] || 'mercadolivre' }
  }
  // diagnóstico em 5 lentes do anúncio do job (ou do original, na duplicação) — a MESMA leitura alimenta a proposta e a prioridade da ação do plano
  function diagnosticoDoJob(cliente, job, ctx = contexto(cliente, job)) {
    const ref = ctx.anuncio || ctx.origem
    const dc = ref ? dadosCanal(cliente, ref.anuncio_id) : { serie: [], ads: null, item: null, de: '', ate: '' }
    const D = criarDiagnostico({ serie: dc.serie, ads: dc.ads, item: itemDiag(ref, dc, cliente), cfg, agora })
    const b = D.baseline(), bench = ref ? benchmarkConta(cliente, dc) : null
    const d = D.diagnosticar(b, { custos: ctx.custos, regra: ctx.regra, ficha: ctx.ficha, benchmark_conv: bench?.conv ?? null, ctr_conta: ref ? ctrConta(cliente) : null, canal: ctx.canal_cfg })
    return { ctx, dc, D, b, bench, d, ref }
  }
  const itemDoAnuncio = a => a ? { id: a.anuncio_id, titulo: a.titulo_atual || a.snapshot?.item?.title || '', permalink: a.url || a.snapshot?.item?.permalink || '', thumb: a.snapshot?.item?.thumbnail || '' } : null
  // P.R.O.V.A.: o número que prova o job (métrica principal da regra + janela) com o valor de partida medido na linha de base
  function provaDoJob(job, b) {
    const regra = job.dados?.regra || regraDoJob(job), r = ALG.regras.find(x => x.id === regra), p = r?.prova || { metrica: 'conversao', janela_dias: L.janela_padrao_dias }
    const vd = b?.visitas != null && b?.periodo?.dias ? r2(b.visitas / b.periodo.dias) : null
    const valor = { conversao: b?.conversao?.valor ?? null, visitas_dia: vd, margem_pct: b?.margem_estimada_pct ?? null, unidades: b?.unidades ?? null, receita_familia: b?.receita ?? null, primeira_venda: null }[p.metrica] ?? null
    return { regra, metrica: p.metrica, rotulo: ALG.metricas_prova?.[p.metrica] || p.metrica, janela_dias: p.janela_dias, valor_inicial: valor, kpi: r?.kpi || '',
      base: b?.periodo ? `${b.periodo.de} a ${b.periodo.ate}` : 'sem histórico (produto novo ou série não coletada)', como: 'antes × depois com grupo de controle a partir da publicação conferida (Merovíngio, fonte "ofertas") — associação temporal, nunca causalidade' }
  }
  // sequência do Manual: job de tipo anterior (cadastro/duplicação antes da otimização) EM ABERTO na mesma variante segura este
  function bloqueioSequencia(cliente, job) {
    const minha = ordemDoTipo(tipoDoJob(job))
    const antes = of.listarJobs(cliente, { variante_id: job.variante_id }).find(o => o.id !== job.id && !ENCERRADOS.has(o.estado) && ordemDoTipo(tipoDoJob(o)) < minha)
    return antes ? `sequência do Manual: ${tipoDoJob(antes) === 'cadastro' ? 'cadastro/duplicação' : tipoDoJob(antes)} em aberto para esta variante (job ${antes.id.slice(0, 8)}, ${ESTADOS[antes.estado].rotulo}) — a otimização espera (saúde → disponibilidade → cadastros e duplicações → otimização)` : null
  }
  // ordem do método entre jobs da mesma variante: sequência do Manual (cadastro/duplicação antes da otimização) e IMA (título DEPOIS das imagens:
  // título/descrição avulsos esperam a galeria/oferta completa em aberto no mesmo anúncio). Vale no preparo e na publicação live.
  function bloqueioOrdem(cliente, job) {
    const seq = bloqueioSequencia(cliente, job)
    if (seq || job.escopo !== 'titulo_descricao' || !job.anuncio_id) return seq
    const g = of.listarJobs(cliente, { variante_id: job.variante_id }).find(o => o.id !== job.id && o.anuncio_id === job.anuncio_id && !ENCERRADOS.has(o.estado) && ['galeria', 'imagem_avulsa', 'oferta_completa'].includes(o.escopo))
    return g ? `método IMA: galeria em aberto neste anúncio (job ${g.id.slice(0, 8)}, ${ESTADOS[g.estado].rotulo}) — o título e a descrição vêm DEPOIS das imagens publicadas` : null
  }
  // duplicação estratégica: objetivo do método + volume dentro do previsto + hipótese + variação real, definidos pelo consultor (config/duplicacao.json)
  const briefingValido = b => !!b && PBDUP.tipos.some(t => t.id === b.objetivo) && volumeEsperado(b.objetivo, b.volume).ok === true && !!b.hipotese && b.variacoes?.length > 0
  const VIVO = j => !['cancelado', 'publicado_confirmado', 'monitorando'].includes(j.estado)
  const escopoBase = e => e === 'imagem_avulsa' ? 'galeria' : e

  // ── 0) abrir job pelo MOTOR ÚNICO: a partir de uma ação do plano (acao_id → escopo/objetivo da regra) ou ligado/convertido em ação (sincronizar);
  // um job vivo por anúncio e escopo (nem ação nem medida em dobro); duplicação só com briefing do consultor; responsável = ficha > prova medida > analista ──
  function abrirJob(cliente, { variante_id = '', anuncio_id = '', escopo = '', objetivo = '', modo = 'publicar_apos_aprovacao', solicitante, responsavel = '', acao_id = '', briefing = null } = {}) {
    let dados = {}, regraAcao = ''
    const alvoCatalogo = anuncio_id ? of.obterAnuncio(cliente, anuncio_id) : null          // guardado antes de a duplicação trocar o anúncio pelo original
    if (acao_id) {
      if (!motor) throw erro('abrir job a partir de uma ação do plano exige o motor do algoritmo', 409)
      const acao = motor.acaoDoPlano(cliente, acao_id)
      if (!acao) throw erro('ação do plano não encontrada neste cliente', 404)
      if (!['proposta', 'aprovada', 'distribuida'].includes(acao.status)) throw erro(`ação do plano em "${acao.status}": não pode ser executada`, 409)
      regraAcao = acao.regra.replace(/^anuncio_/, '')
      const via = motor.viaOferta(regraAcao)
      if (!via && !regraAcao.startsWith('oferta_')) throw erro('esta ação do plano não é executada pelo módulo de Ofertas', 409)
      if (via) {
        escopo ||= via.escopo; objetivo ||= via.objetivo
        if (escopo !== via.escopo || objetivo !== via.objetivo) throw erro(`a ação do plano define escopo "${via.escopo}" e objetivo "${via.objetivo}"`)
      }
      const an = anuncio_id ? of.obterAnuncio(cliente, anuncio_id) : null
      if (acao.item_id && !an) throw erro('informe o anúncio importado da ação do plano (importar-anuncio antes de abrir o job)')
      if (acao.item_id && an.anuncio_id !== acao.item_id) throw erro('o anúncio informado não é o anúncio da ação do plano')
      if (via?.duplicacao) {
        if (!briefingValido(briefing)) throw erro('duplicação estratégica exige o briefing do consultor: objetivo do método, volume dentro do previsto, hipótese e variações (config/duplicacao.json)')
        dados = { duplicacao: { anuncio_origem: an.id, item_origem: an.anuncio_id, gatilho: acao.dados?.duplicacao?.gatilho || '' }, briefing: { objetivo: briefing.objetivo, volume: briefing.volume, hipotese: txt(briefing.hipotese), variacoes: briefing.variacoes.slice(0, 20).map(v => txt(v, 200)), por: solicitante, em: agora() } }
        variante_id = an.variante_id; anuncio_id = ''                // o original fica intacto: o job cria a duplicata
      }
      dados.regra = regraAcao
    }
    // catálogo de TERCEIROS: título, descrição, ficha e galeria são do catálogo do ML — nenhum job de conteúdo (preço segue valendo). Catálogo próprio abre: a proposta é o texto da sugestão de correção
    if (alvoCatalogo && escopoDeConteudo(escopo) && origemDe(cliente, alvoCatalogo.anuncio_id, alvoCatalogo.snapshot?.item ? alvoCatalogo.snapshot.item.catalog_listing : dadosCanal(cliente, alvoCatalogo.anuncio_id).item?.catalogo) === 'terceiros') throw erro(CATALOGO.mensagem_bloqueio_ofertas, 409)
    const ext = id => id ? of.obterAnuncio(cliente, id)?.anuncio_id || '' : ''
    const meuExt = ext(anuncio_id), minhaVar = variante_id || (anuncio_id ? of.obterAnuncio(cliente, anuncio_id)?.variante_id : '') || ''
    const conflito = of.listarJobs(cliente).find(o => VIVO(o) && ((acao_id && o.acao_id === acao_id) || (!dados.duplicacao && !o.dados?.duplicacao && escopoBase(o.escopo) === escopoBase(escopo)
      && (meuExt ? ext(o.anuncio_id) === meuExt : !o.anuncio_id && o.variante_id === minhaVar))))
    if (conflito) throw erro(`já existe um job vivo para este anúncio e escopo (job ${conflito.id.slice(0, 8)}, ${ESTADOS[conflito.estado].rotulo}): uma ação por problema — continue nele ou cancele-o`, 409)
    let job = of.abrir({ cliente, variante_id, anuncio_id, escopo, objetivo, modo, solicitante, responsavel, acao_id, dados })
    if (!motor) return { job, acao: null }
    const { b, d, ref } = diagnosticoDoJob(cliente, job)
    const resp = motor.responsavelPadrao({ cliente, escopo, demanda: motor.demandaDaRegra(regraAcao || regraDoJob(job)) })
    const nome = txt(responsavel, 80) || resp.nome
    const s = motor.sincronizar({ cliente, job: { ...job, responsavel: nome }, item: itemDoAnuncio(ref), baseline: b, diagnostico: d })
    job = of.atualizarJob(cliente, job.id, { acao_id: s.acao.id, responsavel: nome, dados: { regra: s.regra, tipo: s.tipo, ligacao: s.ligacao, prova: provaDoJob({ ...job, dados: { ...job.dados, regra: s.regra } }, b),
      responsavel_origem: txt(responsavel, 80) ? 'indicado pelo solicitante' : resp.origem, ranking_profissional: resp.ranking } }, { por: solicitante })
    return { job, acao: s.acao }
  }
  // bloco de preço no contrato da proposta, recalculado agora (reais, 2 casas vindas do motor)
  function blocoPreco(ctx, { preco_atual, margem_alvo_pct, preco_fixo } = {}) {
    if (!ctx.custos || !ctx.regra) return { preco_proposto: null, piso: null, margem_prevista_pct: null, composicao: [], simulacao: true, bloqueios: [!ctx.custos ? 'custo_ausente' : 'regra_ausente'], fontes: {}, pendencias: [`${!ctx.custos ? 'custo' : 'regra comercial'} ausente — preço automático bloqueado (critério 4)`] }
    const ads_modo = ctx.regra.ads_pct != null ? 'pct_receita' : 'nenhum'
    const c = precoMotor.calcular({ custos: ctx.custos, regra: ctx.regra, preco: preco_atual, margem_alvo_pct, ads_modo })
    const proposto = c.bloqueios.length ? null : preco_fixo != null ? r2(preco_fixo) : c.preco_alvo?.preco ?? (c.abaixo_do_piso ? c.piso : preco_atual ?? null)
    return { preco_proposto: proposto, piso: c.piso, margem_prevista_pct: proposto == null ? null : precoMotor.avaliar(proposto, { custos: ctx.custos, regra: ctx.regra, ads_modo }).margem_pct, composicao: c.composicao, simulacao: c.simulacao, bloqueios: c.bloqueios, fontes: c.fontes, pendencias: c.pendencias, calculado_em: agora() }
  }

  // ── 1) importar anúncio existente: snapshot, atributos da categoria, baseline; variante/produto por CHAVE EXTERNA (variante_id ou SKU exato), nunca por nome ──
  async function importarExistente(cliente, anuncio_id, { por, variante_id = '', conta_id = '' } = {}) {
    const imp = await ml.importarAnuncio(cliente, anuncio_id)
    if (!imp.ok) return { ok: false, anuncio_id, estado: ESTADO_POR_CLASSE[imp.classe] || 'falha_recuperavel', classe: imp.classe, erro: imp.erro, pendencias: [PENDENCIA_CLASSE[imp.classe] || imp.erro] }
    const it = imp.item, contaCliente = conta_id || String(h.prepare("SELECT meli_user_id FROM meli_contas WHERE cliente = ?").get(cliente)?.meli_user_id || '')
    // isolamento: GET /items é público — anúncio de OUTRA conta não entra na base deste cliente (seria vínculo errado e 403 na publicação)
    if (contaCliente && it.seller_id != null && String(it.seller_id) !== contaCliente) return { ok: false, anuncio_id, estado: 'falha_recuperavel', classe: 'sem_permissao', erro: 'anúncio pertence a outra conta do Mercado Livre', pendencias: ['o anúncio não é da conta conectada deste cliente: confira o id ou conecte a conta certa em Integrações'] }
    const conta = contaCliente || String(it.seller_id || '')
    const skuItem = (it.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name || it.seller_custom_field || ''
    const marca = imp.atributos.find(a => a.id === 'BRAND')?.value_name || '', gtin = imp.atributos.find(a => a.id === 'GTIN')?.value_name || '', modelo = imp.atributos.find(a => a.id === 'MODEL')?.value_name || ''
    // alvo: uma linha por variação externa (preço/estoque/fotos são por variação); sem variação, o item inteiro
    const alvos = imp.variacoes.length ? imp.variacoes.map(v => ({ variacao: String(v.id), sku: v.sku || '', preco: v.preco, estoque: v.estoque, combinacao: v.combinacao })) : [{ variacao: '', sku: skuItem, preco: imp.preco, estoque: imp.estoque, combinacao: [] }]
    const resultado = { ok: true, anuncio_id: imp.anuncio_id, categoria: { id: imp.categoria_id, nome: imp.categoria?.nome || '', atributos: imp.categoria?.atributos?.length || 0 }, status_canal: imp.status, catalogo: imp.catalog_listing, user_product: !!imp.user_product_id, itens: [], pendencias: [], criados: { produtos: 0, variantes: 0 } }
    const existenteSku = s => s ? h.prepare('SELECT id, produto_id FROM of_variante WHERE cliente = ? AND sku = ?').get(cliente, s) : null
    let produto_id = ''
    for (const alvo of alvos) {
      let vid = variante_id && alvos.length === 1 ? variante_id : ''
      const sku = alvo.sku || (alvo.variacao ? `${imp.anuncio_id}:${alvo.variacao}` : imp.anuncio_id)    // sem SELLER_SKU: chave externa vira SKU provisório (pendência declarada)
      if (!vid) { const ex = existenteSku(sku); if (ex) { vid = ex.id; produto_id ||= ex.produto_id } }
      if (!vid) {
        if (!produto_id) { produto_id = of.criarProduto(cliente, { nome: imp.titulo, marca, modelo, gtin, categoria_canal: imp.categoria_id, descricao_base: '' }, { por }).id; resultado.criados.produtos++ }
        const cor = alvo.combinacao.find(c => /COLOR|COR/i.test(c.id))?.valor || '', tamanho = alvo.combinacao.find(c => /SIZE|TAMANHO/i.test(c.id))?.valor || ''
        vid = of.criarVariante(cliente, { produto_id, sku, cor, tamanho, estoque: alvo.estoque ?? null }, { por }).id; resultado.criados.variantes++
        if (!alvo.sku) resultado.pendencias.push(`${sku}: anúncio sem SELLER_SKU — SKU provisório pela chave externa; informe o SKU real na variante`)
      }
      const a = of.vincularAnuncio(cliente, { variante_id: vid, canal: 'ML', conta_id: conta, anuncio_id: imp.anuncio_id, variacao_externa_id: alvo.variacao, catalogo_id: imp.catalog_product_id || '', categoria_id: imp.categoria_id, url: imp.permalink, titulo_atual: imp.titulo, preco_atual: alvo.preco, estoque_canal: alvo.estoque, status_canal: imp.status, snapshot: { item: it, descricao: imp.item?._descricao ?? (imp.descricao != null ? { plain_text: imp.descricao } : null), lido_em: agora(), hash: imp.snapshot_hash } }, { por })
      // ficha: atributos da categoria com o valor atual do item (fonte vazia = ainda não é fato com evidência)
      const atuais = new Map(imp.atributos.map(x => [x.id, x.value_name]))
      for (const ca of imp.categoria?.atributos || []) if (!ca.oculto || atuais.has(ca.id)) of.upsertAtributo(cliente, { variante_id: vid, canal: 'ML', categoria_id: imp.categoria_id, atributo_id: ca.id, nome: ca.nome, tipo: ca.tipo, unidade: ca.unidade, valor_atual: atuais.get(ca.id) ?? '', obrigatorio: ca.obrigatorio, editavel: ca.editavel }, { por })
      const dc = dadosCanal(cliente, imp.anuncio_id)
      const D = criarDiagnostico({ serie: dc.serie, ads: dc.ads, item: itemDiag(a, dc, cliente), cfg, agora })
      const baseline = D.baseline()
      evento(cliente, 'anuncio', a.id, 'importado', por, { anuncio_id: imp.anuncio_id, variacao: alvo.variacao, variante_id: vid, novo: a.novo, mudancas: a.mudancas, baseline: { periodo: baseline.periodo, visitas: baseline.visitas, unidades: baseline.unidades, receita: baseline.receita } })
      resultado.itens.push({ anuncio: a.id, variacao_externa_id: alvo.variacao, variante_id: vid, sku, novo: a.novo, mudancas: a.mudancas, baseline })
    }
    if (imp.catalog_listing) resultado.pendencias.push('anúncio de CATÁLOGO: capa e ficha compartilhadas — galeria não editável pelo item (pendência identificada)')
    return resultado
  }

  // ── 2) estratégia: GATE 0 → diagnóstico (5 lentes) → proposta v1 no escopo (preço calculado só com custo+regra; senão bloqueio declarado) ──
  function prepararEstrategia(cliente, job_id, { por, margem_alvo_pct } = {}) {
    let job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    const permitidos = ['rascunho', 'validando_entrada', 'pendente_dados', 'referencia_confirmada', 'rejeitado']
    if (!permitidos.includes(job.estado)) throw erro(`job em "${ESTADOS[job.estado].rotulo}": a estratégia já foi preparada (use revisar) ou o job está encerrado`, 409)
    const ordem = bloqueioOrdem(cliente, job)
    if (ordem) throw erro(ordem, 409)
    if (job.estado === 'rejeitado') job = of.transicionar(cliente, job_id, 'em_producao', { por, motivo: 'nova rodada após reprovação' })
    else {
      if (job.estado === 'rascunho' || job.estado === 'pendente_dados') job = of.transicionar(cliente, job_id, 'validando_entrada', { por })
      if (job.estado === 'validando_entrada') {
        const pend = []
        if (!job.referencia_confirmada) pend.push('referencia_nao_confirmada')
        if (!job.anuncio_id && !['oferta_completa'].includes(job.escopo)) pend.push('sem_anuncio_vinculado')
        if (pend.length) return { job: of.transicionar(cliente, job_id, 'pendente_dados', { por, motivo: `faltam: ${pend.join(', ')}`, pendencias: pend }), pendencias: pend }
        job = of.transicionar(cliente, job_id, 'referencia_confirmada', { por })
      }
    }
    const { ctx, dc, D, b, bench, d, ref } = diagnosticoDoJob(cliente, job)
    // motor único: a ação do plano é recalculada com o diagnóstico novo (mesmo id) antes de qualquer proposta
    if (motor) {
      const s = motor.sincronizar({ cliente, job, item: itemDoAnuncio(ref), baseline: b, diagnostico: d })
      job = of.atualizarJob(cliente, job_id, { acao_id: s.acao.id, dados: { regra: s.regra, tipo: s.tipo, ligacao: s.ligacao, prova: provaDoJob({ ...job, dados: { ...job.dados, regra: s.regra } }, b) } }, { por })
    }
    const prop = D.proporProposta({ escopo: job.escopo, objetivo: job.objetivo, baseline: b, diagnostico: d, ficha: ctx.ficha, custos: ctx.custos, regra: ctx.regra, canal: ctx.canal_cfg, margem_alvo_pct })
    const { pendencias, estrategia, ...conteudo } = prop
    if (Array.isArray(conteudo.galeria) && !conteudo.galeria.length) delete conteudo.galeria   // imagens reais entram por revisar (provedor); lista vazia não é campo a aprovar
    if (conteudo.preco) conteudo.preco = { ...conteudo.preco, calculado_em: agora() }
    const temCampo = Object.keys(conteudo).some(k => k !== 'mudancas')
    if (!temCampo) return { job: of.transicionar(cliente, job_id, 'pendente_dados', { por, motivo: 'nenhuma proposta possível no escopo com os dados atuais', pendencias: pendencias.length ? pendencias : ['sem_dados_para_proposta'] }), pendencias, diagnostico: d }
    const explicacao = explicarSync(prop)
    const versao = of.novaVersao(cliente, job_id, { conteudo, baseline: { ...b, snapshot: ctx.anuncio?.snapshot?.item ? { item: ctx.anuncio.snapshot.item, hash: ctx.anuncio.snapshot.hash || '' } : null, dados_canal: { de: dc.de, ate: dc.ate }, benchmark_conta: bench }, diagnostico: { ...d, proposta_pendencias: pendencias, estrategia, explicacao }, por })
    job = of.transicionar(cliente, job_id, job.estado === 'em_producao' ? 'em_revisao' : 'estrategia_preparada', { por })
    evento(cliente, 'job', job_id, 'estrategia_preparada', por, { versao: versao.versao, campos: Object.keys(conteudo).filter(k => k !== 'mudancas'), pendencias, preco_bloqueios: conteudo.preco?.bloqueios || [] })
    return { job, versao, pendencias, diagnostico: d }
  }
  const explicarSync = prop => [`Escopo ${prop.estrategia?.escopo} · objetivo ${prop.estrategia?.objetivo} (${prop.estrategia?.tipo}).`, ...prop.mudancas.map(m => `${m.campo}: ${m.problema} — ${m.evidencia} → ${m.acao}; medir ${m.metrica} em ${m.janela_dias} dias.`), prop.pendencias.length ? `Pendências: ${prop.pendencias.join('; ')}` : ''].filter(Boolean).join(' ')

  // ── 3) revisar: o operador edita campos do escopo (título, descrição, atributos, preço, galeria) → nova versão (aprovações anteriores caem) ──
  function revisar(cliente, job_id, edicoes = {}, { por } = {}) {
    const job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!job.proposta) throw erro('sem proposta: prepare a estratégia antes de revisar', 409)
    if (!edicoes || typeof edicoes !== 'object' || Array.isArray(edicoes)) throw erro('edicoes deve ser um objeto')
    const permitidos = CAMPOS_POR_ESCOPO[job.escopo], fora = Object.keys(edicoes).filter(k => !permitidos.includes(k))
    if (fora.length) throw erro(`escopo "${job.escopo}" não permite editar: ${fora.join(', ')}`)
    const ctx = contexto(cliente, job), atual = job.proposta.conteudo, conteudo = { ...atual }, mudancas = [...(atual.mudancas || [])]
    const reg = (campo, de, para, nota) => mudancas.push({ campo, de, para, problema: 'revisão do operador', evidencia: nota || 'edição manual', hipotese: null, acao: 'conteúdo revisado antes da aprovação', metrica: null, janela_dias: null, confusores: [], origem: 'revisao', por, em: agora() })
    // preservação (Trocar/Preservar): texto do operador que perde cor/kit/tamanho (título) ou qualquer fato com fonte (descrição) vira pendência da versão — não bloqueia a edição
    const pendencias = []
    if ('titulo' in edicoes) {
      const t = txt(edicoes.titulo, 200); if (!t) throw erro('titulo vazio'); reg('titulo', atual.titulo ?? null, t); conteudo.titulo = t
      const pr = checarPreservacao(ctx.ficha, t, { campos: CAMPOS_PRESERVAR_TITULO }); if (!pr.ok) pendencias.push(`título revisado não preserva ${listaCampos(pr.faltantes)} da ficha — revisar antes de publicar`)
    }
    if ('descricao' in edicoes) {
      const d = String(edicoes.descricao ?? '').trim().slice(0, 50000); if (!d) throw erro('descricao vazia'); reg('descricao', (atual.descricao ?? '').slice(0, 120), d.slice(0, 120)); conteudo.descricao = d
      const pr = checarPreservacao(ctx.ficha, d); if (!pr.ok) pendencias.push(`descrição revisada não preserva ${listaCampos(pr.faltantes)} da ficha — revisar antes de publicar`)
    }
    if ('atributos' in edicoes) {
      if (!Array.isArray(edicoes.atributos)) throw erro('atributos deve ser uma lista de { atributo_id, valor_proposto, fonte, evidencia }')
      const lista = edicoes.atributos.map(a => ({ atributo_id: txt(a?.atributo_id, 80), nome: txt(a?.nome, 120), valor_atual: a?.valor_atual ?? null, valor_proposto: txt(a?.valor_proposto, 1000), fonte: txt(a?.fonte, 120), evidencia: txt(a?.evidencia, 500) })).filter(a => a.atributo_id && a.valor_proposto)
      if (!lista.length) throw erro('nenhum atributo com atributo_id e valor_proposto')
      for (const a of lista) if (!a.fonte || !a.evidencia) throw erro(`${a.atributo_id}: valor proposto exige fonte e evidência`)
      reg('atributos', (atual.atributos || []).map(a => a.atributo_id), lista.map(a => a.atributo_id)); conteudo.atributos = lista
    }
    if ('preco' in edicoes) {
      const p = Number(edicoes.preco?.preco_proposto ?? edicoes.preco)
      if (!(p > 0)) throw erro('preco: informe preco_proposto > 0')
      const bloco = blocoPreco(ctx, { preco_atual: ctx.anuncio?.preco_atual ?? null, preco_fixo: p })
      if (bloco.piso != null && p < bloco.piso) bloco.pendencias = [...(bloco.pendencias || []), `preço ${p} abaixo do piso ${bloco.piso}: não publicável`]
      reg('preco', atual.preco?.preco_proposto ?? null, bloco.preco_proposto, `margem prevista ${bloco.margem_prevista_pct ?? '—'}%`); conteudo.preco = bloco
    }
    if ('galeria' in edicoes) {
      if (!Array.isArray(edicoes.galeria)) throw erro('galeria deve ser uma lista de { imagem_id, ordem, papel }')
      const aprovadas = new Map(of.listarImagens(cliente, { variante_id: job.variante_id }).filter(i => i.status === 'aprovada' || i.papel === 'original').map(i => [i.id, i]))
      const g = edicoes.galeria.map((x, i) => ({ imagem_id: txt(x?.imagem_id, 60), ordem: Number.isInteger(x?.ordem) ? x.ordem : i, papel: txt(x?.papel, 30) || aprovadas.get(txt(x?.imagem_id, 60))?.papel || '' }))
      for (const x of g) if (!aprovadas.has(x.imagem_id)) throw erro('galeria: toda imagem precisa ser uma candidata APROVADA (ou o original confirmado) desta variante')
      if (!g.length) throw erro('galeria vazia')
      reg('galeria', (atual.galeria || []).map(x => x.imagem_id), g.map(x => x.imagem_id)); conteudo.galeria = g
    }
    if (!mudancas.some(m => m.origem === 'revisao' && m.em === mudancas.at(-1)?.em)) throw erro('nada editado')
    // pendências da proposta: a edição de um campo substitui as pendências anteriores DESSE campo (título/descrição) pelas conferidas agora
    const diag = job.proposta.diagnostico || {}
    const anteriores = (diag.proposta_pendencias || []).filter(p => !(('titulo' in edicoes && /^título/.test(p)) || ('descricao' in edicoes && /^descrição/.test(p))))
    const v = of.novaVersao(cliente, job_id, { conteudo: { ...conteudo, mudancas }, baseline: job.proposta.baseline, diagnostico: { ...diag, proposta_pendencias: [...anteriores, ...pendencias] }, por })
    evento(cliente, 'job', job_id, 'revisado', por, { versao: v.versao, campos: Object.keys(edicoes), pendencias })
    return { versao: v, job: of.obterJob(cliente, job_id), pendencias }
  }

  // ── 4) aprovar campo a campo (presa à versão). Tudo aprovado → aprovado_publicar; modo publicar_apos_aprovacao → na_fila (sem clique redundante) ──
  function aprovar(cliente, job_id, { versao, campos, autor } = {}) {
    let job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!['estrategia_preparada', 'em_revisao', 'aprovado_publicar', 'na_fila'].includes(job.estado)) throw erro(`job em "${ESTADOS[job.estado].rotulo}": não está em aprovação`, 409)
    const ap = of.aprovar({ cliente, job_id, versao, campos, autor })
    if (job.estado === 'estrategia_preparada') for (const e of ['estrategia_aprovada', 'em_producao', 'em_revisao']) job = of.transicionar(cliente, job_id, e, { por: autor, motivo: 'direção aprovada pelo operador' })
    let enfileirado = false
    if (!ap.campos_pendentes.length && job.estado === 'em_revisao') {
      job = of.transicionar(cliente, job_id, 'aprovado_publicar', { por: autor })
      if (job.modo === 'publicar_apos_aprovacao') { job = of.transicionar(cliente, job_id, 'na_fila', { por: autor, motivo: 'modo publicar após aprovação: enfileirado automaticamente' }); enfileirado = true }
    }
    return { aprovacao: ap, job, enfileirado, campos_pendentes: ap.campos_pendentes }
  }
  function reprovar(cliente, job_id, { motivo, autor } = {}) {
    const job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!txt(motivo)) throw erro('reprovação exige motivo curto (reaproveitado na próxima rodada)')
    if (!['estrategia_preparada', 'em_revisao'].includes(job.estado)) throw erro(`job em "${ESTADOS[job.estado].rotulo}": não está em aprovação`, 409)
    return { job: of.transicionar(cliente, job_id, 'rejeitado', { por: autor, motivo: txt(motivo) }) }
  }
  function cancelar(cliente, job_id, { motivo, por } = {}) {
    const job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    return { job: of.transicionar(cliente, job_id, 'cancelado', { por, motivo: txt(motivo) || 'cancelado pelo solicitante' }) }
  }

  // ── 5) publicar: dry-run por padrão. Live só com job aprovado (aprovação válida para a versão); preço recalculado no momento; mudança material → nova versão, volta à revisão ──
  const publicacaoMestre = (cliente, job) => of.listarPublicacoes(cliente, job.id).filter(p => p.operacao === 'atualizar' && p.versao === job.proposta_versao).at(-1) || null
  async function publicar(cliente, job_id, { live = false, por = 'sistema', confirmar = false } = {}) {
    let job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!job.proposta) throw erro('sem proposta: prepare a estratégia antes', 409)
    live = live === true
    if (!job.anuncio_id) return { estado: 'pendente_dados', motivo: 'job sem anúncio vinculado: criação de anúncio novo pelo adaptador ainda exige galeria aprovada e categoria — importe/vincule um anúncio ou aguarde a criação assistida', pendencias: ['anuncio_nao_vinculado'] }
    const ctx = contexto(cliente, job), anuncio = ctx.anuncio
    const retomando = ['falha_parcial', 'falha_recuperavel'].includes(job.estado)
    if (live) {
      if (paradoChaveiro()) throw erro('Chaveiro parado pelo botão de emergência: nenhuma publicação live sai (retome em /cliente › Executar)', 409)
      if (!['aprovado_publicar', 'na_fila', 'falha_parcial', 'falha_recuperavel'].includes(job.estado)) throw erro(`publicação live só com job aprovado para publicar (está em "${ESTADOS[job.estado].rotulo}")`, 409)
      // GATE 0 ANTES de qualquer envio: a retomada (falha_*) não passa por transicionar antes do PUT, e a referência pode ter sido contestada depois da aprovação
      if (!job.referencia_confirmada) throw erro('GATE 0: a referência da variante foi contestada/revogada depois da aprovação — nada é enviado; confirme a referência e reaprove', 409)
      const ordem = bloqueioOrdem(cliente, job)                     // um cadastro/galeria aberto DEPOIS do preparo também segura o envio
      if (ordem) throw erro(ordem, 409)
      if (job.campos_pendentes?.length) throw erro(`aprovação incompleta na versão ${job.proposta_versao}: faltam ${job.campos_pendentes.join(', ')}`, 409)
      if (!job.aprovacoes.some(a => a.valida && a.proposta_versao === job.proposta_versao)) throw erro('nenhuma aprovação válida para a versão atual', 409)
    }
    // preço recalculado AGORA (custo/regra podem ter mudado desde a aprovação)
    let conteudo = { ...job.proposta.conteudo }
    const recalculo = conteudo.preco ? blocoPreco(ctx, { preco_atual: anuncio?.preco_atual ?? null, preco_fixo: conteudo.preco.preco_proposto }) : null
    const material = recalculo && (recalculo.piso !== conteudo.preco.piso || (recalculo.bloqueios || []).length !== (conteudo.preco.bloqueios || []).length || recalculo.simulacao !== conteudo.preco.simulacao || (recalculo.piso != null && conteudo.preco.preco_proposto < recalculo.piso))
    if (material && live) {
      const v = of.novaVersao(cliente, job_id, { conteudo: { ...conteudo, preco: recalculo, mudancas: [...(conteudo.mudancas || []), { campo: 'preco', de: conteudo.preco.preco_proposto, para: recalculo.preco_proposto, problema: 'custo ou regra mudaram desde a aprovação', evidencia: `piso ${conteudo.preco.piso} → ${recalculo.piso}; bloqueios ${(recalculo.bloqueios || []).join(',') || 'nenhum'}`, hipotese: null, acao: 'reaprovar o preço recalculado', metrica: null, janela_dias: null, confusores: [], origem: 'recalculo', em: agora() }] }, baseline: job.proposta.baseline, diagnostico: job.proposta.diagnostico, por })
      job = of.obterJob(cliente, job_id)
      if (!['em_revisao'].includes(job.estado)) job = of.transicionar(cliente, job_id, 'em_revisao', { por, motivo: 'preço recalculado mudou materialmente: reaprovar' })
      evento(cliente, 'job', job_id, 'preco_recalculado', por, { versao: v.versao, de: conteudo.preco.preco_proposto, para: recalculo.preco_proposto })
      return { estado: 'em_revisao', motivo: 'o preço recalculado no momento da publicação mudou materialmente (custo/regra): nova versão criada, aprovação anterior invalidada', versao: v.versao, job }
    }
    const mestre = publicacaoMestre(cliente, job)
    const anterior = mestre?.resposta?.iniciado_em ? { em: mestre.resposta.finalizado_em || mestre.resposta.iniciado_em, grupos_enviados: mestre.resposta.grupos_enviados || [], classe_erro: mestre.resposta.classe_erro || null } : null
    if (retomando && mestre?.resposta?.retomar?.length) { const manter = new Set(mestre.resposta.retomar.map(g => CAMPO_DO_GRUPO[g]).filter(Boolean)); conteudo = Object.fromEntries(Object.entries(conteudo).filter(([k]) => k === 'mudancas' || manter.has(k))) }
    const imgs = conteudo.galeria ? of.listarImagens(cliente, { variante_id: job.variante_id }).filter(i => conteudo.galeria.some(g => g.imagem_id === i.id)).map(i => ({ imagem_id: i.id, caminho_local: i.caminho_local || undefined, url: i.url || undefined, papel: i.papel, ordem: conteudo.galeria.find(g => g.imagem_id === i.id)?.ordem ?? 0, picture_id: mestre?.resposta?.imagens?.find(x => x.imagem_id === i.id)?.picture_id })) : []
    const chave = [cliente, anuncio.conta_id, anuncio.anuncio_id, job.proposta_versao, 'atualizar'].join('|')
    // live: credencial/permissão conferidas ANTES de qualquer envio — conta caída é falha recuperável nomeada, não "rejeitado"
    let cap = null
    if (live) {
      cap = await ml.consultarCapacidades(cliente, { anuncio_id: anuncio.anuncio_id })
      if (Object.values(cap.pode).every(v => !v)) {
        const motivo = txt(cap.observacoes.join(' | ') || 'nenhuma operação disponível na conta', 300), pend = cap.erro ? [PENDENCIA_CLASSE[cap.erro] || motivo] : [motivo]
        if (['aprovado_publicar', 'falha_parcial', 'falha_recuperavel'].includes(job.estado)) job = of.transicionar(cliente, job_id, 'na_fila', { por, motivo: 'publicação solicitada' })
        job = of.transicionar(cliente, job_id, 'publicando', { por }); job = of.transicionar(cliente, job_id, 'falha_recuperavel', { por, motivo, pendencias: pend })
        evento(cliente, 'job', job_id, 'publicacao_bloqueada', por, { classe: cap.erro || 'sem_permissao', motivo })
        return { estado: 'falha_recuperavel', live: true, classe_erro: cap.erro || 'credencial_expirada', motivo, pendencias: pend, payload: [], diff: [], job }
      }
    }
    // retomada: o item já carrega as mudanças do envio anterior — a comparação com o snapshot do diagnóstico acusaria o próprio envio; a conferência por leitura cobre
    const snapshotDiag = retomando ? null : job.proposta.baseline?.snapshot || null
    const r = await ml.publicar({ cliente, anuncio_id: anuncio.anuncio_id, escopo: job.escopo, proposta: conteudo, versao: job.proposta_versao, chave_idem: chave, live, snapshot_diagnostico: snapshotDiag, variacao_externa_id: anuncio.variacao_externa_id || '', imagens: imgs, publicacao_anterior: anterior, capacidades: cap })
    if (retomando) (r.pendencias ||= []).push('retomada: mudança externa não comparada com o snapshot do diagnóstico (o item já traz o envio anterior); a conferência por leitura valida o resultado')
    const lite = { estado: r.estado, motivo: r.motivo || null, payload: r.payload || (r.grupos || []).filter(g => g.corpo).map(g => ({ grupo: g.grupo, metodo: g.metodo, caminho: g.caminho, corpo: g.corpo })), diff: r.diff || [], bloqueios: r.validacao?.bloqueios || [], pendencias: r.pendencias || [], divergencias: r.divergencias || [], uploads_pendentes: r.uploads_pendentes || 0, preco_recalculado: recalculo ? { preco_proposto: recalculo.preco_proposto, piso: recalculo.piso, margem_prevista_pct: recalculo.margem_prevista_pct, bloqueios: recalculo.bloqueios, divergente: !!material } : null }
    if (!live) { evento(cliente, 'job', job_id, 'publicacao_dry_run', por, { estado: r.estado, grupos: lite.payload.map(p => p.grupo), bloqueios: lite.bloqueios.length, divergencias: lite.divergencias.length }); return { ...lite, live: false, job } }
    // live: estados pré-envio (nada saiu) voltam da fila; depois publicando → resultado por grupo
    if (['aprovado_publicar', 'falha_parcial', 'falha_recuperavel'].includes(job.estado)) job = of.transicionar(cliente, job_id, 'na_fila', { por, motivo: retomando ? 'retomada após falha' : 'publicação solicitada' })
    if (r.estado === 'rejeitado') return { ...lite, live: true, job: of.transicionar(cliente, job_id, 'em_revisao', { por, motivo: `canal recusou a proposta antes do envio: ${txt(r.motivo, 200)}` }) }
    if (r.estado === 'pendente_dados') return { ...lite, live: true, job: of.transicionar(cliente, job_id, 'pendente_dados', { por, motivo: txt(r.motivo, 200), pendencias: r.pendencias }) }
    if (r.estado === 'conflito_externo') return { ...lite, live: true, job: of.transicionar(cliente, job_id, 'conflito_externo', { por, motivo: txt(r.motivo, 300), pendencias: r.pendencias }) }
    if (['falha_recuperavel', 'aguardando_canal'].includes(r.estado) && !r.registros?.length) {   // nem leu o item: nada enviado
      job = of.transicionar(cliente, job_id, 'publicando', { por }); job = of.transicionar(cliente, job_id, r.estado, { por, motivo: txt(r.motivo || r.erro, 300), pendencias: r.pendencias })
      return { ...lite, live: true, classe_erro: r.classe_erro || null, job }
    }
    job = of.transicionar(cliente, job_id, 'publicando', { por, motivo: `enviando ${r.grupos.filter(g => g.corpo).map(g => g.grupo).join(', ')}` })
    const m = of.registrarPublicacao(cliente, { job_id, canal: 'ML', conta_id: anuncio.conta_id, anuncio_id: anuncio.anuncio_id, versao: job.proposta_versao, operacao: 'atualizar', payload: lite.payload, diff: r.diff, snapshot_antes: r.snapshot_antes_json ? JSON.parse(r.snapshot_antes_json) : {} })
    for (const reg of r.registros || []) {
      const p = of.registrarPublicacao(cliente, { job_id, canal: 'ML', conta_id: anuncio.conta_id, anuncio_id: anuncio.anuncio_id, versao: job.proposta_versao, operacao: `grupo:${reg.etapa}`, payload: reg.payload_json ? JSON.parse(reg.payload_json) : {} })
      of.atualizarPublicacao(cliente, p.id, { estado: reg.estado === 'enviado' ? 'enviada' : reg.estado === 'falha' ? 'falhou' : 'preparada', resposta: { status: reg.status, classe: reg.classe, resposta: reg.resposta_json ? JSON.parse(reg.resposta_json) : null, em: reg.em }, erro: reg.estado === 'falha' ? `${reg.classe}: ${reg.erro}` : '' })
    }
    const enviados = [...new Set([...(anterior?.grupos_enviados || []), ...(r.grupos_enviados || [])])]
    const resposta = { estado: r.estado, classe_erro: r.classe_erro || null, erro: r.erro || null, grupos_enviados: enviados, retomar: r.retomar || [], imagens: [...(mestre?.resposta?.imagens || []), ...(r.imagens || [])], conferencia: r.conferencia || null, iniciado_em: r.iniciado_em, finalizado_em: r.finalizado_em, pendencias: r.pendencias }
    const estadoPub = r.estado === 'em_conferencia' ? 'aceita' : r.estado === 'aguardando_canal' ? 'processando' : 'falhou'
    const erroPub = r.estado === 'falha_parcial' ? `publicação PARCIAL: enviados ${enviados.join(', ') || 'nenhum'}; retomar ${(r.retomar || []).join(', ') || 'nada'} — ${r.classe_erro}: ${r.erro || ''}` : `${r.classe_erro || r.estado}: ${r.erro || r.pendencias?.at(-1) || ''}`
    of.atualizarPublicacao(cliente, m.id, { estado: estadoPub, resposta, erro: estadoPub === 'falhou' ? txt(erroPub, 500) : '' })
    const motivo = r.estado === 'em_conferencia' ? `API aceitou ${enviados.join(', ')}: conferir após propagação (${ESPERA_PROPAGACAO_MIN} min)` : txt(r.erro || r.pendencias?.at(-1) || r.estado, 300)
    job = of.transicionar(cliente, job_id, r.estado, { por, motivo, pendencias: r.pendencias })
    evento(cliente, 'job', job_id, 'publicado_live', por, { estado: r.estado, grupos_enviados: enviados, retomar: r.retomar, classe_erro: r.classe_erro || null })
    return { ...lite, live: true, classe_erro: r.classe_erro || null, grupos_enviados: enviados, retomar: r.retomar || [], conferencia: r.conferencia || null, publicacao_id: m.id, job }
  }

  // ── 6) conferir por LEITURA do canal: verificado | processando | divergente por campo; falha_parcial só retoma o necessário ──
  function esperadoDe(payload, variacao_externa_id) {
    const e = { variacao_externa_id }
    for (const g of payload || []) {
      const c = g.corpo || {}
      if (c.title != null) e.titulo = c.title
      if (c.price != null) e.preco = c.price
      if (c.plain_text != null) e.descricao = c.plain_text
      if (c.attributes) e.atributos = c.attributes.map(a => ({ atributo_id: a.id, valor: a.value_name }))
      if (g.grupo === 'galeria') e.galeria = (c.variations ? c.variations.find(v => String(v.id) === String(variacao_externa_id))?.picture_ids : (c.pictures || []).map(p => p.id)) || []
      if (g.grupo === 'preco' && c.variations) e.preco = c.variations.find(v => v.price != null)?.price
    }
    return e
  }
  async function conferir(cliente, job_id, { por = 'sistema' } = {}) {
    let job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!['em_conferencia', 'aguardando_canal', 'falha_parcial'].includes(job.estado)) throw erro(`job em "${ESTADOS[job.estado].rotulo}": nada a conferir`, 409)
    const anuncio = of.obterAnuncio(cliente, job.anuncio_id), m = publicacaoMestre(cliente, job)
    if (!m) throw erro('sem publicação registrada para a versão atual', 409)
    const esperado = { ...esperadoDe(m.payload, anuncio.variacao_externa_id || ''), enviado_em: m.resposta?.finalizado_em || m.resposta?.iniciado_em || m.criado_em }
    const r = await ml.conferirPublicado(cliente, anuncio.anuncio_id, esperado)
    if (!r.ok) {
      const alvo = job.estado === 'em_conferencia' ? 'aguardando_canal' : job.estado === 'aguardando_canal' ? 'falha_recuperavel' : null
      if (alvo) job = of.transicionar(cliente, job_id, alvo, { por, motivo: `conferência falhou (${r.classe}): ${txt(r.erro, 200)}`, pendencias: [PENDENCIA_CLASSE[r.classe] || r.erro] })
      return { ok: false, classe: r.classe, erro: r.erro, job }
    }
    // publicação por grupo recebe o veredito do canal
    const porGrupo = {}
    for (const c of r.campos) (porGrupo[c.grupo] ||= []).push(c)
    for (const p of of.listarPublicacoes(cliente, job_id).filter(p => p.versao === job.proposta_versao && p.operacao.startsWith('grupo:'))) {
      const cs = porGrupo[p.operacao.slice(6)]
      if (!cs) continue
      const est = cs.some(c => c.estado === 'divergente') ? 'divergente' : cs.every(c => c.estado === 'verificado') ? 'verificada' : 'processando'
      of.atualizarPublicacao(cliente, p.id, { estado: est, resposta: { campos: cs, lido_em: r.lido_em }, erro: est === 'divergente' ? cs.filter(c => c.divergencia).map(c => c.divergencia).join(' | ').slice(0, 500) : '', verificado_em: r.lido_em, por })
    }
    of.vincularAnuncio(cliente, { canal: 'ML', conta_id: anuncio.conta_id, anuncio_id: anuncio.anuncio_id, variacao_externa_id: anuncio.variacao_externa_id, status_canal: r.status_canal, snapshot: r.snapshot_depois_json ? { ...JSON.parse(r.snapshot_depois_json), lido_em: r.lido_em } : undefined }, { por })
    const divergentes = [...new Set(r.divergencias.map(c => c.grupo))]
    if (r.conclusivo && !divergentes.length) {
      of.atualizarPublicacao(cliente, m.id, { estado: 'verificada', resposta: { ...m.resposta, conferencia: r }, verificado_em: r.lido_em, por })
      if (job.estado !== 'em_conferencia') job = of.transicionar(cliente, job_id, 'em_conferencia', { por, motivo: 'leitura conclusiva' })
      job = of.transicionar(cliente, job_id, 'publicado_confirmado', { por, motivo: `conferido: ${r.campos.length} campo(s) iguais ao aprovado` })
    } else if (r.conclusivo) {
      of.atualizarPublicacao(cliente, m.id, { estado: 'divergente', resposta: { ...m.resposta, conferencia: r, retomar: divergentes }, erro: r.divergencias.map(c => c.divergencia || c.campo).join(' | ').slice(0, 500), por })
      if (job.estado !== 'em_conferencia') job = of.transicionar(cliente, job_id, 'em_conferencia', { por, motivo: 'leitura conclusiva' })
      job = of.transicionar(cliente, job_id, 'falha_parcial', { por, motivo: `divergência após publicação em ${divergentes.join(', ')}: avisar o operador ANTES de regravar`, pendencias: r.divergencias.map(c => `${c.campo}: ${c.divergencia || 'difere do enviado'}`) })
    } else if (job.estado === 'em_conferencia') job = of.transicionar(cliente, job_id, 'aguardando_canal', { por, motivo: `canal ainda propagando: reconferir em ${r.reconferir_em}`, pendencias: [`reconferir_em:${r.reconferir_em}`] })
    evento(cliente, 'job', job_id, 'conferido', por, { conclusivo: r.conclusivo, divergentes, campos: r.campos.map(c => `${c.campo}:${c.estado}`) })
    return { ok: true, conclusivo: r.conclusivo, reconferir_em: r.reconferir_em, campos: r.campos, divergencias: r.divergencias, job }
  }

  // ── 7) monitorar: antes × depois pela série já coletada; associação temporal, NUNCA causalidade; estoque/preço/campanha declarados ──
  function monitorar(cliente, job_id, { por = 'sistema', janela = L.janela_padrao_dias } = {}) {
    let job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!['publicado_confirmado', 'monitorando'].includes(job.estado)) throw erro(`job em "${ESTADOS[job.estado].rotulo}": o acompanhamento começa depois de publicado e conferido`, 409)
    const anuncio = of.obterAnuncio(cliente, job.anuncio_id), dia = (job.publicado_em || agora()).slice(0, 10), ontem = addDias(hoje(), -1)
    const antes = { de: addDias(dia, -janela), ate: addDias(dia, -1) }, depois = { de: dia, ate: addDias(dia, janela - 1) > ontem ? ontem : addDias(dia, janela - 1) }
    const soma = (de, ate) => {
      const s = tabela('meli_serie_item') ? h.prepare('SELECT COUNT(*) dias, SUM(unidades) u, SUM(receita) r, SUM(visitas) v FROM meli_serie_item WHERE cliente = ? AND item_id = ? AND dia BETWEEN ? AND ?').get(cliente, anuncio.anuncio_id, de, ate) : { dias: 0 }
      const a = tabela('meli_ads_dia') ? h.prepare('SELECT COUNT(*) dias, SUM(custo) c, SUM(receita) r, SUM(clicks) k, SUM(prints) p FROM meli_ads_dia WHERE cliente = ? AND item_id = ? AND dia BETWEEN ? AND ?').get(cliente, anuncio.anuncio_id, de, ate) : { dias: 0 }
      const vis = s.v ?? null
      return { de, ate, dias_coletados: s.dias || 0, unidades: s.dias ? s.u : null, receita: s.dias ? r2(s.r) : null, visitas: s.dias ? vis : null, conversao_pct: s.dias && vis > 0 ? r2(100 * s.u / vis) : null, ads: a.dias ? { custo: r2(a.c), receita: r2(a.r), cliques: a.k, impressoes: a.p, ctr_pct: a.p > 0 ? r2(100 * a.k / a.p) : null, base: 'receita atribuída a Ads' } : null }
    }
    const A = soma(antes.de, antes.ate), D = soma(depois.de, depois.ate)
    const delta = k => A[k] != null && D[k] != null ? r2(D[k] - A[k]) : null
    const atual = tabela('meli_item') ? h.prepare('SELECT preco, estoque FROM meli_item WHERE cliente = ? AND item_id = ?').get(cliente, anuncio.anuncio_id) : null
    if (job.estado === 'publicado_confirmado') job = of.transicionar(cliente, job_id, 'monitorando', { por, motivo: `janela de ${janela} dias a partir de ${dia}` })
    const r = { janela_dias: janela, publicado_em: job.publicado_em, antes: A, depois: D, delta: { unidades: delta('unidades'), receita: delta('receita'), visitas: delta('visitas'), conversao_pct: delta('conversao_pct') },
      completo: depois.ate >= addDias(dia, janela - 1) && D.dias_coletados >= janela, confusores: { preco_atual: atual?.preco ?? anuncio.preco_atual ?? null, preco_na_publicacao: anuncio.snapshot?.item?.price ?? null, estoque_atual: atual?.estoque ?? anuncio.estoque_canal ?? null, campanha_ads_no_periodo: !!(D.ads && D.ads.custo > 0), sazonalidade: 'não avaliada automaticamente' },
      nota: 'associação temporal entre a publicação e as métricas; nenhuma causalidade é atribuída automaticamente (testes sequenciais não são A/B).', dia_ausente: 'dia sem linha na série = não coletado, não zero' }
    evento(cliente, 'job', job_id, 'monitorado', por, { janela, antes: { de: A.de, ate: A.ate, receita: A.receita }, depois: { de: D.de, ate: D.ate, receita: D.receita }, completo: r.completo })
    return { ...r, job }
  }

  // ── matriz de capacidades do cliente: o que está realmente disponível (nada presumido) ─────────────────────
  async function capacidades(cliente) {
    const conta = tabela('meli_contas') ? h.prepare('SELECT meli_user_id, nickname, escopos, erro, expira_em FROM meli_contas WHERE cliente = ?').get(cliente) : null
    const ml_cap = await ml.consultarCapacidades(cliente)
    const dados = { serie: tabela('meli_serie_item') ? !!h.prepare('SELECT 1 FROM meli_serie_item WHERE cliente = ? LIMIT 1').get(cliente) : false, ads: tabela('meli_ads_dia') ? !!h.prepare('SELECT 1 FROM meli_ads_dia WHERE cliente = ? LIMIT 1').get(cliente) : false }
    const variantes = of.listarVariantes(cliente), memo = {}, comCusto = variantes.filter(v => !of.custoVigente(cliente, v.id, { memo }).bloqueios.length).length   // memo: uma leitura dos custos para todas
    const regras = h.prepare('SELECT canal, conta_id, modalidade, fonte, validade, comissao_pct, tributos_pct, margem_min_pct FROM of_regra_canal WHERE cliente = ?').all(cliente).map(r => ({ ...r, expirada: Date.parse(r.validade) < Date.parse(agora()), tributo_parametrizado: r.tributos_pct != null }))
    const prov = imagens ? imagens.disponivel() : { provedor: 'nenhum', pendente: 'provedor de imagens não configurado' }
    return {
      cliente, consultado_em: agora(),
      canais: {
        ML: { conectado: !!conta, conta: conta ? { id: conta.meli_user_id, nickname: conta.nickname, erro: conta.erro || '' } : null, escopos: ml_cap.escopos, pode: ml_cap.pode, observacoes: ml_cap.observacoes, dados_coletados: dados, estado: !conta ? 'nao_conectado' : conta.erro ? 'reconectar' : ml_cap.pode.atributos ? 'leitura_e_escrita' : 'somente_leitura' },
        SHO: { estado: 'nao_implementado', motivo: 'adaptador Shopee não implementado neste módulo' }, AMZ: { estado: 'nao_implementado', motivo: 'adaptador Amazon não implementado' }, MAG: { estado: 'nao_implementado', motivo: 'adaptador Magalu não implementado' }, TTK: { estado: 'nao_implementado', motivo: 'adaptador TikTok Shop não implementado' },
      },
      custos: { variantes: variantes.length, com_custo: comCusto, sem_custo: variantes.length - comCusto, fonte: 'of_custo (vigência) > módulo de custos por SKU (ERP/planilha)' },
      regras_comerciais: { cadastradas: regras.length, vigentes: regras.filter(r => !r.expirada).length, lista: regras, nota: 'preço automático exige regra com fonte, validade e tributo parametrizado; nada é presumido' },
      imagens: prov, drive: imagens?.drive ? { estado: imagens.drive.estado, faltando: imagens.drive.faltando } : { estado: 'pendente', faltando: ['provedor não carregado'] },
      referencia: { variantes_confirmadas: variantes.filter(v => v.referencia_confirmada).length, nota: 'GATE 0: produção e publicação só com referência visual confirmada' },
    }
  }

  // ── lista da seção 3 (anúncios do cliente) com filtro avançado (painel 'ofertas'); lista, totais e CSV saem da MESMA função (critério 16) ──
  function listaAnuncios(cliente, def) {
    const per = def?.periodo?.resolvido
    if (!per) throw erro('informe o período (preset ou datas)')
    const campoData = def.periodo.campo || 'data_venda'
    const temSerie = tabela('meli_serie_item')
    const somas = temSerie ? new Map(h.prepare('SELECT item_id, SUM(unidades) u, SUM(receita) r FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ? GROUP BY item_id').all(cliente, per.de, per.ate).map(x => [x.item_id, x])) : new Map()
    const thumbs = tabela('meli_item') ? new Map(h.prepare('SELECT item_id, thumb, criado_em, catalogo FROM meli_item WHERE cliente = ?').all(cliente).map(x => [x.item_id, x])) : new Map()
    const catCtx = catalogoDb.contexto(cliente)
    const rows = h.prepare(`SELECT a.*, v.sku, v.consultor, v.analista, v.prioridade, v.cor, v.tamanho, v.referencia_confirmada, p.nome produto_nome, p.marca FROM of_anuncio a
      LEFT JOIN of_variante v ON v.id = a.variante_id AND v.cliente = a.cliente LEFT JOIN of_produto p ON p.id = v.produto_id AND p.cliente = a.cliente WHERE a.cliente = ?`).all(cliente)
    const jobDe = h.prepare("SELECT id, estado, escopo, publicado_em, atualizado_em FROM of_job WHERE cliente = ? AND anuncio_id = ? AND estado NOT IN ('cancelado') ORDER BY atualizado_em DESC LIMIT 1")
    const otimDe = h.prepare('SELECT MAX(pr.criado_em) em FROM of_proposta pr JOIN of_job j ON j.id = pr.job_id AND j.cliente = pr.cliente WHERE pr.cliente = ? AND j.anuncio_id = ?')
    const itens = rows.map(a => {
      const snap = (() => { try { return JSON.parse(a.snapshot_json || '{}') } catch { return {} } })(), it = snap.item || {}
      const s = somas.get(a.anuncio_id) || {}, job = jobDe.get(cliente, a.id), m = thumbs.get(a.anuncio_id)
      let margem = null, margem_fonte = ''
      if (a.variante_id && a.preco_atual != null) {
        const ctx = { custos: custosPara(cliente, a.variante_id), regra: regraPara(cliente, { canal: a.canal, conta_id: a.conta_id, snapshot: snap }) }
        if (ctx.custos && ctx.regra) { const c = precoMotor.calcular({ custos: ctx.custos, regra: ctx.regra, preco: a.preco_atual, ads_modo: ctx.regra.ads_pct != null ? 'pct_receita' : 'nenhum' }); if (!c.bloqueios.length) { margem = c.margem_pct; margem_fonte = `${c.simulacao ? 'simulação' : 'cálculo'} · regra ${ctx.regra.fonte} · custo ${ctx.custos.fonte || ''}` } else margem_fonte = `bloqueado: ${c.bloqueios.join(', ')}` } else margem_fonte = !ctx.custos ? 'sem custo' : 'sem regra comercial'
      }
      return {
        foto: it.thumbnail || it.secure_thumbnail || m?.thumb || (it.pictures?.[0]?.secure_url ?? ''), cliente, canal: a.canal, conta: a.conta_id, produto: a.produto_nome || it.title || '', marca: a.marca || '', sku: a.sku || '', variacao: [a.cor, a.tamanho].filter(Boolean).join(' / '), variacao_externa_id: a.variacao_externa_id,
        catalogo_origem: origemCatalogo({ id: a.anuncio_id, catalogo: it.catalog_listing ?? m?.catalogo }, catCtx), anuncio_id: a.anuncio_id, anuncio: a.id, variante_id: a.variante_id, categoria: a.categoria_id, url: a.url, titulo: a.titulo_atual, preco: a.preco_atual, margem_pct: margem, margem_fonte, estoque: a.estoque_canal, status_canal: a.status_canal,
        vendas_unidades: s.u ?? (temSerie ? 0 : null), faturamento: s.r != null ? r2(s.r) : (temSerie ? 0 : null), consultor: a.consultor || '', analista: a.analista || '', prioridade: a.prioridade || '', referencia_confirmada: !!a.referencia_confirmada,
        status: job?.estado || '', status_rotulo: job ? ESTADOS[job.estado]?.rotulo : 'sem job', escopo: job?.escopo || '', job_id: job?.id || '',
        ultima_sincronizacao: a.sincronizado_em, criado_em: (it.date_created || m?.criado_em || '').slice(0, 10), otimizado_em: (otimDe.get(cliente, a.id)?.em || '').slice(0, 10), publicado_em: (job?.publicado_em || '').slice(0, 10),
        importado: true,
      }
    })
    // os anúncios do Mercado Livre que a coleta já conhece entram na lista mesmo sem importação: dá para selecionar e otimizar daqui
    // (o job importa o anúncio na hora de abrir). Margem só depois de importar, com custo e regra comercial — nunca estimada aqui.
    if (tabela('meli_item')) {
      const ja = new Set(rows.filter(a => a.canal === 'ML').map(a => a.anuncio_id))
      const skuDe = tabela('promo_anuncio') ? new Map(h.prepare("SELECT item_id, sku FROM promo_anuncio WHERE cliente = ? AND sku != ''").all(cliente).map(x => [x.item_id, x.sku])) : new Map()
      for (const m of h.prepare('SELECT * FROM meli_item WHERE cliente = ?').all(cliente)) {   // * : bancos de teste têm menos colunas
        if (ja.has(m.item_id)) continue
        const s = somas.get(m.item_id) || {}
        itens.push({
          foto: m.thumb || '', cliente, canal: 'ML', conta: '', produto: m.titulo || '', marca: '', sku: skuDe.get(m.item_id) || '', variacao: '', variacao_externa_id: '',
          catalogo_origem: origemCatalogo({ id: m.item_id, catalogo: m.catalogo }, catCtx), anuncio_id: m.item_id, anuncio: '', variante_id: '', categoria: '', url: m.permalink || '', titulo: m.titulo || '', preco: m.preco, margem_pct: null, margem_fonte: 'importe o anúncio para calcular (custo + regra comercial)', estoque: m.estoque, status_canal: m.status || '',
          vendas_unidades: s.u ?? (temSerie ? 0 : null), faturamento: s.r != null ? r2(s.r) : (temSerie ? 0 : null), consultor: '', analista: '', prioridade: '', referencia_confirmada: false,
          status: '', status_rotulo: 'não importado', escopo: '', job_id: '',
          ultima_sincronizacao: m.atualizado_em || '', criado_em: (m.criado_em || '').slice(0, 10), otimizado_em: '', publicado_em: '',
          importado: false,
        })
      }
    }
    const passa = compilarPredicado(def)
    const filtrados = itens.filter(passa).filter(i => campoData === 'data_venda' || (i[campoData] && i[campoData] >= per.de && i[campoData] <= per.ate)).sort((x, y) => (y.faturamento || 0) - (x.faturamento || 0))
    const totais = { anuncios: filtrados.length, vendas_unidades: filtrados.reduce((t, i) => t + (i.vendas_unidades || 0), 0), faturamento: r2(filtrados.reduce((t, i) => t + (i.faturamento || 0), 0)), com_margem: filtrados.filter(i => i.margem_pct != null).length, jobs_ativos: filtrados.filter(i => i.status && !['monitorando', 'rejeitado'].includes(i.status)).length, sem_referencia: filtrados.filter(i => !i.referencia_confirmada).length }
    return { cliente, periodo: { ...per, campo: campoData, nota: campoData === 'data_venda' ? 'vendas/faturamento somados no período (dia do pedido); preço, margem e estoque são os ATUAIS (última sincronização)' : `linhas com ${campoData} dentro do período` }, totais, total_sem_filtro: itens.length, itens: filtrados.slice(0, 1000), serie_disponivel: temSerie }
  }

  // ── imagens: gerar candidatas (pendente sem provedor) e registrar cada uma em of_imagem ──────────────────────
  async function gerarImagens(cliente, { job_id, papel = 'capa', briefing = '', n = 1, por } = {}) {
    const job = of.obterJob(cliente, job_id)
    if (!job) throw erro('job não encontrado', 404)
    if (!job.referencia_confirmada) throw erro('GATE 0: referência visual não confirmada — nenhuma imagem é gerada', 409)
    if (!imagens) return { estado: 'pendente', motivo: 'provedor de imagens não configurado no servidor', candidatas: [] }
    const refs = of.listarImagens(cliente, { variante_id: job.variante_id }).filter(i => i.papel === 'original' && i.url).map(i => i.url)
    const ctx = contexto(cliente, job)
    const g = cfg.galeria_padrao[CANAL_CFG[ctx.anuncio?.canal || 'ML']] || cfg.galeria_padrao.mercadolivre
    // Trocar/Preservar (skill oferta-mkt): a lista PRESERVAR só traz fatos da ficha com fonte; "proibido inventar" vale para briefing padrão e do operador
    const pres = checarPreservacao(ctx.ficha, '').preservar
    const texto = `${briefing || `Imagem "${papel}" do produto da referência, ${g.formato} ${g.resolucao}${papel === 'capa' && !g.texto_permitido.capa ? ', fundo branco, sem texto nem logo' : ''}. Não alterar o produto.`}`
      + `${pres.length ? ` PRESERVAR (fatos da ficha, com fonte): ${pres.map(p => `${ROTULO_PRESERVAR[p.campo]} ${p.valor}`).join('; ')}.` : ''} Proibido inventar: nenhum atributo, acessório, texto ou variação que não esteja na ficha e na referência confirmada.`
    const r = await imagens.gerar({ cliente, variante: job.variante_id, job: job.id, referencias: refs, briefing: texto, n, papel, versao: job.proposta_versao || 1 })
    const registradas = []
    for (const c of r.candidatas || []) if (c.caminho_local) registradas.push(of.registrarImagem(cliente, { variante_id: job.variante_id, job_id: job.id, caminho_local: c.caminho_local, papel, versao: c.versao, hash: c.tecnico?.hash, largura: c.tecnico?.largura, altura: c.tecnico?.altura, bytes: c.tecnico?.bytes, fonte: c.fonte, prompt: c.prompt }, { por }))
    evento(cliente, 'job', job_id, 'imagens_geradas', por, { estado: r.estado, papel, pedidas: n, registradas: registradas.length, custo: r.custo ?? null, custo_fonte: r.custo_fonte, motivo: r.motivo || null, classe: r.classe || null })
    return { estado: r.estado, motivo: r.motivo || null, pendencia: r.pendencia || (r.estado === 'pendente' ? r.motivo : null), custo: r.custo ?? null, custo_fonte: r.custo_fonte || null, tentativa: r.tentativa, candidatas: registradas, referencias_usadas: refs.length }
  }

  return { abrirJob, importarExistente, prepararEstrategia, revisar, aprovar, reprovar, cancelar, publicar, conferir, monitorar, capacidades, listaAnuncios, gerarImagens, contexto, blocoPreco, CANAL_CFG, GRUPO_DO_CAMPO }
}

// ── pronto para o servidor (lazy: o teste nunca abre data/db.sqlite) ───────────────────────────────────────────
let pronto = null
export async function fluxoPronto() {
  if (pronto) return pronto
  const [{ ofertas }, { db, hojeLocal }, { adaptadorMLPronto }, { provedorImagensPronto }, { criarMotorOfertas }, { diagnosticarConta }] = await Promise.all([import('./ofertas.js'), import('./db.js'), import('./ofertas-ml.js'), import('./ofertas-imagens.js'), import('./ofertas-algoritmo.js'), import('./diagnostico-conta.js')])
  // motor único: o servidor SEMPRE injeta o motor (job → ação do plano → medida do Merovíngio); só os autotestes de mecânica rodam sem ele.
  // diagnosticoConta: CTR da própria conta (diagnosticarConta) para a lente de clique — nunca um CTR universal
  pronto = criarFluxo({ of: ofertas, h: db, ml: await adaptadorMLPronto(), imagens: await provedorImagensPronto(), motor: criarMotorOfertas({ hoje: hojeLocal }), diagnosticoConta: c => diagnosticarConta(c, { hoje: hojeLocal() }), hoje: hojeLocal })
  return pronto
}
export { OBJETIVOS }
