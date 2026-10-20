// ╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║  NÃO TESTADO EM PRODUÇÃO — a primeira execução deve ser SUPERVISIONADA, com 1 anúncio.                ║
// ║  Este é o ÚNICO arquivo do módulo que escreve em API externa (POST de ENTRADA em campanha).           ║
// ║  Está TRAVADO por duas chaves, e as duas precisam estar abertas ao mesmo tempo:                       ║
// ║    1) promo_config.execucao_habilitada = 1 PARA AQUELE CLIENTE (nasce 0; só se liga de propósito);     ║
// ║    2) confirmar === true explícito na chamada (qualquer outro valor — "true", 1, "sim" — é recusado). ║
// ║  Além disso: plano APROVADO, não expirado (24h), com hash íntegro, limite de anúncios por execução    ║
// ║  (execucao_max_itens, padrão 1) e nenhuma chamada que não seja POST de entrada. NUNCA sai de campanha.║
// ║  Executa EXATAMENTE as chamadas do plano aprovado (nada novo ao vivo), contra os NÚMEROS aprovados;   ║
// ║  claim atômico do plano; chave 1 relida antes de CADA POST; sem reenvio na janela de propagação.      ║
// ║  Lições do dono embutidas: 2xx ≠ entrou · propagação leva ~30 min · 409/504/400 podem ter gravado ·   ║
// ║  "0 entraram" numa leva com POSTs OK é suspeita, não veredito · nunca limpar marcas em massa.         ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝
import { assertSemSaida, hashPlano, planoExpirado, montarPlano, completarNomes, barradoPeloDono } from './promocoes-plano.js'
import { buscarOfertasDoItem } from './promocoes-coleta.js'
import { carregarEntrada } from './promocoes-analista.js'
import * as repo from './promocoes-db.js'

export const ESPERA_PROPAGACAO_MIN = 30
// kill switch do Chaveiro (F4+, «Parar tudo»): relido antes de CADA POST e antes do claim; banco sem sync_estado (testes de promoção em memória) = solto
const paradoChaveiro = () => { try { return repo.db.prepare("SELECT valor FROM sync_estado WHERE chave = 'chaveiro_execucao_parado'").get()?.valor === '1' } catch { return false } }
const dormir = ms => new Promise(r => setTimeout(r, ms))
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })

// ── as duas chaves (+ plano íntegro): pura, testável, nunca chama rede ──────────────────────────────
export function verificarTravas({ cliente, config, confirmar, plano, agoraMs = Date.now() }) {
  const motivos = []
  if (config?.execucao_habilitada !== 1) motivos.push('execução DESLIGADA para este cliente (promo_config.execucao_habilitada ≠ 1) — chave 1 fechada')
  if (confirmar !== true) motivos.push('falta confirmar === true (confirmação explícita) — chave 2 fechada')
  if (!plano) motivos.push('plano inexistente')
  else {
    if (plano.cliente !== cliente) motivos.push('o plano é de outro cliente')
    if (plano.estado !== 'aprovado') motivos.push(`o plano está "${plano.estado}" — só plano APROVADO executa`)
    if (planoExpirado(plano, agoraMs)) motivos.push('plano expirado (validade de 24h) — gere um novo dry-run')
    try { assertSemSaida(plano.itens) } catch (e) { motivos.push(e.message) }
    if (hashPlano(plano.itens) !== plano.hash) motivos.push('o conteúdo do plano mudou depois de gerado (hash não confere)')
    const entrar = plano.itens.filter(i => i.acao === 'ENTRAR')
    if (!entrar.length) motivos.push('o plano não tem nenhuma entrada')
    const max = Number(config?.execucao_max_itens) || 1
    const anuncios = new Set(entrar.map(i => i.item_id)).size
    if (anuncios > max) motivos.push(`supervisão: este plano toca ${anuncios} anúncios e o limite por execução é ${max} (promo_config.execucao_max_itens) — a primeira execução é com 1 anúncio`)
  }
  return { liberado: motivos.length === 0, motivos }
}

// 2xx ≠ entrou. 409/5xx/timeout: pode ter gravado (incerto). 4xx claro: recusado.
export function classificarResposta(status) {
  if (status >= 200 && status < 300) return 'enviado'
  if (status === 409 || status === 0 || status >= 500 || status === 400) return 'incerto'          // 400 também já gravou no ML (família do "400/504/409 grava")
  return 'recusado'
}
// prova = a campanha PEDIDA aparece started/pending na oferta viva do anúncio
export function avaliarProva(ofertasVivas, pid) {
  const o = (ofertasVivas || []).find(x => x.pid === pid && ['started', 'pending'].includes(x.status))
  return o ? { provado: true, status: o.status, preco: o.preco } : { provado: false }
}

// prova RÁPIDA (a de 28/09/2026): /items/{id}/prices mostra uma promoção NOVA no preço esperado, mesmo antes de a listagem de campanhas propagar
export const precosResumo = corpo => (Array.isArray(corpo?.prices) ? corpo.prices.map(p => ({ amount: Number(p?.amount), type: String(p?.type || ''), fim: p?.conditions?.end_time || null })) : null)     // corpo fora do formato = baseline DESCONHECIDO (null), nunca "sem preços"
export function avaliarProvaPrecos(antes, depois, esperado) {
  if (!(esperado > 0) || !depois?.length || !Array.isArray(antes)) return { provado: false }          // sem baseline conhecido (GET de antes falhou) nada se prova por preço
  const novo = depois.find(p => p.type !== 'standard' && Math.abs(p.amount - esperado) <= 0.01 && !(antes || []).some(a => a.type === p.type && Math.abs(a.amount - p.amount) <= 0.005 && a.fim === p.fim))
  return novo ? { provado: true, preco: novo.amount, fim: novo.fim } : { provado: false }
}

// ── API real (a única com POST). Os testes injetam um stub em deps.api e NUNCA usam esta ──────────────
async function criarApi(cliente) {
  const { chamar } = await import('./meli-api.js'), { tokenValido } = await import('./meli-contas.js')
  // PRÉ-ENVIO (nada saiu para a rede): o executor chama ANTES do exec_pre — falhar aqui é 'nao_enviada', não tentativa
  const prepararPost = async () => { const token = await tokenValido(cliente); if (!token) throw new Error('conta Mercado Livre não conectada'); return token }
  return Object.assign(async (metodo, caminho, corpo, tokenPronto) => {
    if (metodo === 'GET') { const r = await chamar(cliente, caminho, { permitirFalha: true }); return r?._erro ? { status: r.status, erro: true, corpo: r.corpo } : { status: 200, corpo: r } }
    if (metodo !== 'POST') throw new Error('o executor só faz GET e POST de entrada')
    const token = tokenPronto || await prepararPost()
    try {
      const r = await fetch(`https://api.mercadolibre.com${caminho}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(30_000) })
      return { status: r.status, corpo: (await r.text().catch(() => '')).slice(0, 400) }
    } catch (e) { return { status: 0, corpo: String(e.message).slice(0, 200) } }
  }, { prepararPost })
}
const ctxDoApi = (cliente, api, espera) => ({ cliente, espera, tentativas: 1, chamadas: 0, chamar: async (_c, caminho) => { const r = await api('GET', caminho); return r.erro ? { _erro: true, status: r.status, corpo: r.corpo } : r.corpo } })

const naoEnviada = (item_id, pid, campanha, resposta, extra = {}) => ({ item_id, pid, campanha, chamada: null, status_http: null, classe: 'nao_enviada', resposta, prova: null, ...extra })
const estadoSemProva = c => (c.classe === 'recusado' ? 'recusado' : c.classe === 'incerto' ? 'incerto_conferir' : 'enviado_sem_prova_ainda')
const resumir = chamadas => ({
  chamadas: chamadas.filter(c => c.chamada).length, entrou_provado: chamadas.filter(c => c.estado_final === 'entrou').length,
  sem_prova_ainda: chamadas.filter(c => c.estado_final === 'enviado_sem_prova_ainda').length, incertas: chamadas.filter(c => c.estado_final === 'incerto_conferir').length,
  recusadas: chamadas.filter(c => c.estado_final === 'recusado').length, nao_enviadas: chamadas.filter(c => c.estado_final === 'nao_enviada').length,
  nota: `"entrou" só com prova de campanha. Propagação do ML leva ~${ESPERA_PROPAGACAO_MIN} min: sincronize depois disso (o sync lê de novo, nunca limpa marcas em massa).`,
})

export async function executarPlano(cliente, planoId, { confirmar, por = '', deps = {} } = {}) {
  const plano = repo.lerPlano(cliente, planoId), config = repo.getConfig(cliente)
  const barra = (motivos, status = 403) => {                                                     // toda tentativa barrada fica na auditoria
    repo.auditar(cliente, 'execucao_bloqueada', { autor: por, detalhe: motivos.join(' | '), depois: { plano: planoId } })
    throw erro(`execução BLOQUEADA: ${motivos.join('; ')}`, status)
  }
  const t = verificarTravas({ cliente, config, confirmar, plano, agoraMs: deps.agoraMs ?? Date.now() })
  if (!t.liberado) barra(t.motivos)
  if (!String(por).trim()) barra(['informe quem está executando'], 400)
  if (paradoChaveiro()) barra(['Chaveiro parado pelo botão de emergência (retome em /cliente › Executar)'], 409)
  // claim ATÔMICO: só uma execução por plano (o lock de job é em memória). Daqui em diante o plano SEMPRE termina gravado (executado | executado_parcial | erro; ou volta a 'aprovado' se nada foi enviado);
  // se o processo cair no meio, o resultado parcial já está no plano e recuperarPlanosPresos fecha o estado
  if (!repo.reivindicarPlano(cliente, planoId)) barra(['o plano não está mais "aprovado": outra execução o reivindicou'], 409)
  const alvo = new Map(plano.itens.filter(i => i.acao === 'ENTRAR').map(i => [`${i.item_id}|${i.pid}`, i]))     // o plano manda no ESCOPO: só estas chamadas, nenhuma outra
  const chamadas = [], motivos = new Map()
  let interrompido = null, falha = null
  // resultado PARCIAL no plano a cada POST (e a cada anúncio): queda do servidor no meio não apaga o que já saiu; é também o sinal de vida do plano 'executando'
  const salvarParcial = () => { const cs = chamadas.map(c => ({ ...c, estado_final: c.estado_final || (c.chamada ? estadoSemProva(c) : 'nao_enviada') })); repo.salvarParcialPlano(cliente, planoId, { por, parcial: true, chamadas: cs, resumo: resumir(cs) }) }
  // só o sinal de vida (sem regravar o resultado): barato o bastante para cada GET do read-back
  const sinalDeVida = () => repo.db.prepare("UPDATE promo_plano SET executando_em=? WHERE id=? AND cliente=? AND estado='executando'").run(repo.agora(), planoId, cliente)
  try {
    const api = deps.api || await criarApi(cliente)
    const apiGet = async caminho => { try { return await api('GET', caminho) } catch (err) { return { status: 0, erro: true, corpo: String(err.message).slice(0, 200) } } }     // GET que falha nunca derruba o laço
    const ctx = ctxDoApi(cliente, api, deps.espera ?? 300)
    const e = await carregarEntrada(cliente, deps)
    // baseline = o que a pessoa APROVOU (bloco 'aprovado' de cada item do plano), nunca as marcas de agora (que podem ter sido regravadas depois da aprovação)
    // hedge: carrega a âncora (plano antigo sem o campo: a âncora é o aprovado.pid, que no hedge é o da campanha marcada) — recusa/bloqueio da âncora POSTERIOR à aprovação barra o hedge aqui (montarPlano)
    const decisoes = [...alvo.values()].map(i => ({ item_id: i.item_id, pid: i.pid, origem: i.origem, regra: i.regra, via: i.via, ordem_direta: !!i.ordem_direta, ancora: i.ancora || (i.hedge && i.aprovado?.pid !== i.pid ? i.aprovado?.pid : '') || '',
      offer_id: i.aprovado?.offer_id || '', preco: i.aprovado?.preco ?? null, mc_pct: i.aprovado?.mc_pct ?? i.aprovado?.mcPct ?? null }))
    laco: for (const item of [...new Set([...alvo.values()].map(i => i.item_id))]) {
      salvarParcial()                                                                // sinal de vida por anúncio (um plano grande não pode parecer parado)
      // re-busca AO VIVO + re-roda as mesmas regras (offer_id troca de ciclo; pre-check por margem de novo; recusa 👤 relida)
      const viva = completarNomes(await buscarOfertasDoItem(ctx, item), e.campanhas)
      const antesPrecos = await apiGet(`/items/${item}/prices`)
      const fresco = montarPlano({ cliente, decisoes: decisoes.filter(d => d.item_id === item), vivasPorItem: new Map([[item, viva]]), anuncios: new Map(e.anuncios.map(a => [a.item_id, a])), regrasSku: e.regrasSku, custosSku: e.custosSku, custosCliente: e.custosCliente, config, recusas: repo.recusasHumanas(cliente) })
      for (const x of fresco.itens.filter(x => x.acao !== 'ENTRAR')) motivos.set(`${x.item_id}|${x.pid}`, `${x.acao}/${x.motivo}: ${x.detalhe}`)
      for (const it of fresco.itens.filter(x => x.acao === 'ENTRAR')) {
        const planejado = alvo.get(`${it.item_id}|${it.pid}`)
        if (!planejado) { chamadas.push(naoEnviada(item, it.pid, it.campanha, 'campanha/hedge novo ao vivo, FORA do plano aprovado: não enviada — gere e aprove um novo plano', { fora_do_plano: true })); continue }
        if (it.chamada.corpo.promotion_type !== planejado.chamada?.corpo?.promotion_type) { chamadas.push(naoEnviada(item, it.pid, it.campanha, 'o tipo da campanha mudou desde o dry-run: não enviada — gere e aprove um novo plano')); continue }
        if (repo.getConfig(cliente).execucao_habilitada !== 1) { interrompido = 'a chave 1 (execucao_habilitada) foi DESLIGADA durante a execução: o restante não foi enviado'; break laco }     // desligar é o botão de parada
        if (paradoChaveiro()) { interrompido = 'Chaveiro parado pelo botão de emergência: o restante não foi enviado'; break laco }
        // recusa 👤 / IGNORAR / Revisar relidos antes de CADA POST (o dono pode recusar entre o POST da âncora e o do hedge) — mesma regra do plano, inclusive a da âncora
        const barr = barradoPeloDono(repo.recusasHumanas(cliente), decisoes.find(d => d.item_id === item && d.pid === it.pid))
        if (barr) { chamadas.push(naoEnviada(item, it.pid, it.campanha, `PULAR/${barr.motivo}: ${barr.detalhe} (relido antes do POST)`)); continue }
        if (repo.tentativaRecente(cliente, item, it.pid, ESPERA_PROPAGACAO_MIN, deps.agoraMs ?? Date.now())) { chamadas.push(naoEnviada(item, it.pid, it.campanha, `já houve tentativa de POST deste anúncio × campanha há menos de ${ESPERA_PROPAGACAO_MIN} min (propagação do ML): não reenvia — confira /items/${item}/prices e o painel`)); continue }
        assertSemSaida([it])
        // pré-envio (token): falha AQUI não saiu para a rede — nao_enviada, sem exec_pre (não conta como tentativa nem trava o reenvio)
        let token
        try { token = await api.prepararPost?.() } catch (err) { chamadas.push(naoEnviada(item, it.pid, it.campanha, `falha ANTES do envio (${String(err.message).slice(0, 200)}): nada saiu para o ML — resolva e execute de novo`, { pre_envio: true })); continue }
        repo.auditar(cliente, 'exec_pre', { item_id: item, pid: it.pid, autor: por, depois: { chamada: it.chamada, plano: planoId } })
        let r
        try { r = await api('POST', it.chamada.caminho, it.chamada.corpo, token) } catch (err) { r = { status: 0, corpo: err.message } }       // depois do exec_pre: falha = incerto (pode ter saído)
        const classe = classificarResposta(r.status)
        chamadas.push({ item_id: item, pid: it.pid, campanha: it.campanha, chamada: it.chamada, preco_esperado: it.vivo?.preco ?? null, status_http: r.status, classe, resposta: String(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo || '')).slice(0, 300), prova: null, antes_preco: antesPrecos.erro ? null : precosResumo(antesPrecos.corpo) })
        repo.auditar(cliente, 'exec_post', { item_id: item, pid: it.pid, autor: por, depois: { status: r.status, classe } })
        salvarParcial()
        await dormir(deps.espera ?? 1500)
      }
    }
    // read-back: 1 leitura depois da espera curta (o imediato "mente ~45s"); prova só se a CAMPANHA PEDIDA aparece
    if (chamadas.some(c => c.chamada)) await dormir(deps.esperaReadback ?? 45_000)
    for (const c of chamadas.filter(x => x.chamada)) {
      sinalDeVida()                                                                  // read-back longo (centenas de GETs) não pode parecer queda para recuperarPlanosPresos
      const viva = await buscarOfertasDoItem(ctx, c.item_id)
      const pr = viva.ok ? avaliarProva(viva.ofertas, c.pid) : { provado: false }
      const depois = await apiGet(`/items/${c.item_id}/prices`)                         // read-back do estado do preço
      c.depois_preco = depois.erro ? null : precosResumo(depois.corpo)
      const pp = pr.provado || depois.erro ? { provado: false } : avaliarProvaPrecos(c.antes_preco, c.depois_preco, c.preco_esperado)
      c.prova = pr.provado ? { via: 'campanha', campanha: pr.status, preco: pr.preco } : pp.provado ? { via: 'prices', preco: pp.preco, fim: pp.fim } : null
      c.estado_final = c.prova ? 'entrou' : estadoSemProva(c)
    }
  } catch (err) { falha = err }
  // SEMPRE grava o que aconteceu — resultado parcial, estado e auditoria — mesmo com falha no meio (os POSTs já enviados não se perdem)
  for (const [k, i] of alvo) if (!chamadas.some(c => `${c.item_id}|${c.pid}` === k))
    chamadas.push(naoEnviada(i.item_id, i.pid, i.campanha, interrompido ? 'execução interrompida: ' + interrompido : falha ? `execução interrompida por erro (${falha.message})` : `o pre-check ao vivo barrou — ${motivos.get(k) || 'margem/estado mudou desde o dry-run'}`))
  for (const c of chamadas) c.estado_final ||= c.chamada ? estadoSemProva(c) : 'nao_enviada'      // prova que não chegou a ser lida = sem prova, nunca "entrou"
  // trilha POR CHAMADA de tudo que não saiu (o resumo deduplica/trunca e devolverPlano zera o resultado): item, campanha e motivo
  for (const c of chamadas.filter(x => x.estado_final === 'nao_enviada')) repo.auditar(cliente, 'exec_nao_enviada', { item_id: c.item_id, pid: c.pid, autor: por, detalhe: c.resposta, depois: { plano: planoId, ...(c.pre_envio ? { pre_envio: true } : {}), ...(c.fora_do_plano ? { fora_do_plano: true } : {}) } })
  const enviadas = chamadas.filter(c => c.chamada).length
  const resumo = resumir(chamadas)
  // NUNCA 'executado' com 0 chamadas: uma leitura ao vivo que falhou (503) ou um pre-check que barrou tudo não pode queimar a aprovação de 24h — o claim volta para 'aprovado'
  if (!enviadas && !falha && !interrompido && repo.devolverPlano(cliente, planoId)) {
    const motivo = [...new Set(chamadas.map(c => c.resposta))].join(' | ')
    repo.auditar(cliente, 'execucao_nao_iniciada', { autor: por, detalhe: motivo, depois: { plano: planoId, estado: 'aprovado', ...resumo } })
    return { plano: planoId, estado: 'nao_iniciada', plano_estado: 'aprovado', nada_enviado: true, motivo, aviso: `NADA foi enviado ao Mercado Livre: o plano continua APROVADO (vale até ${plano.expira_em}) — resolva o motivo e execute de novo`, resumo, chamadas }
  }
  const estado = enviadas ? (falha || interrompido ? 'executado_parcial' : 'executado') : 'erro'      // sem POST: 'erro' (nada foi enviado), nunca 'executado'
  const executadoEm = new Date().toISOString()
  repo.atualizarPlano(cliente, planoId, { estado, executado_em: executadoEm, resultado: { por, executado_em: executadoEm, chamadas, resumo, ...(falha ? { erro: falha.message } : {}), ...(interrompido ? { interrompido } : {}) } })
  for (const c of chamadas.filter(x => x.estado_final === 'entrou')) marcarEstado(cliente, c.item_id, c.pid, 'executada')
  repo.auditar(cliente, falha || interrompido ? 'execucao_erro' : 'execucao', { autor: por, detalhe: falha?.message || interrompido || '', depois: { plano: planoId, estado, ...resumo } })
  if (falha) throw erro(`execução interrompida por erro (${falha.message}) — plano gravado como "${estado}" com o que já foi enviado: confira /items/{id}/prices e o painel antes de qualquer nova tentativa`, 500)
  return { plano: planoId, estado, resumo, chamadas, ...(interrompido ? { interrompido } : {}) }
}

function marcarEstado(cliente, itemId, pid, estado) {
  repo.db.prepare("UPDATE promo_decisao SET estado = ? WHERE cliente = ? AND item_id = ? AND pid = ? AND marcado = 1").run(estado, cliente, itemId, pid)
}

// ── plano preso em 'executando' (queda/reinício no meio da execução) ────────────────────────────────────────
// Só o claim grava 'executando' e o lock de job é em memória: sem isto o plano ficava preso (sync 409, reexecução barrada). Plano sem sinal de vida há > PLANO_PRESO_MIN
// vira 'executado_parcial' com as chamadas reconstruídas da auditoria (exec_pre = tentativa de POST, exec_post = resposta) — a resposta do ML NÃO foi guardada, então nada vira "entrou":
// o sync/conferência no painel decide. Sem nenhum exec_pre (nada saiu) o estado é 'erro'. Idempotente (UPDATE condicional ao estado) e nunca lança.
export const PLANO_PRESO_MIN = 10
export function recuperarPlanosPresos(cliente = null, { agoraMs = Date.now() } = {}) {
  const recuperados = []
  try {
    for (const { id, cliente: cli } of repo.planosPresos(PLANO_PRESO_MIN, cliente, agoraMs)) {
      const plano = repo.lerPlano(cli, id)
      const pres = repo.listarAuditoria(cli, { evento: 'exec_pre', limite: 1000 }).filter(a => a.depois?.plano === id).reverse()        // cronológico
      const posts = repo.listarAuditoria(cli, { evento: 'exec_post', limite: 1000 }).reverse()
      const guardadas = new Map((plano.resultado?.chamadas || []).filter(c => c.chamada).map(c => [`${c.item_id}|${c.pid}`, c]))        // o parcial gravado a cada POST (traz a resposta do ML)
      const ems = []                                                                                                                  // quando saiu o último POST: a espera de propagação do sync conta daí
      const chamadas = pres.map(pre => {
        const post = posts.find(p => p.item_id === pre.item_id && p.pid === pre.pid && p.id > pre.id), g = guardadas.get(`${pre.item_id}|${pre.pid}`)
        ems.push(post?.em || pre.em)
        const c = g || { item_id: pre.item_id, pid: pre.pid, campanha: plano.itens.find(i => i.item_id === pre.item_id && i.pid === pre.pid)?.campanha || pre.pid, chamada: pre.depois.chamada,
          status_http: post?.depois?.status ?? null, classe: post?.depois?.classe || 'incerto', prova: null,
          resposta: post ? 'recuperada da auditoria após queda do servidor (a resposta do ML não foi guardada)' : 'o servidor caiu entre a tentativa e a resposta: o POST pode ter saído — confira /items/{id}/prices e o painel' }
        return { ...c, estado_final: c.estado_final || estadoSemProva(c), tentativa_em: pre.em }
      })
      for (const i of plano.itens.filter(x => x.acao === 'ENTRAR')) if (!chamadas.some(c => c.item_id === i.item_id && c.pid === i.pid))
        chamadas.push({ ...naoEnviada(i.item_id, i.pid, i.campanha, 'execução interrompida por queda do servidor antes deste POST: não enviada'), estado_final: 'nao_enviada' })
      const enviadas = chamadas.filter(c => c.chamada).length, estado = enviadas ? 'executado_parcial' : 'erro'
      const executadoEm = ems.sort().pop() || new Date(agoraMs).toISOString(), erroMsg = 'processo interrompido durante a execução (plano ficou "executando" sem sinal de vida)'
      if (!repo.resolverPlanoPreso(cli, id, estado, executadoEm, { por: plano.resultado?.por || '', executado_em: executadoEm, chamadas, resumo: resumir(chamadas), erro: erroMsg, recuperado: true })) continue
      repo.auditar(cli, 'execucao_recuperada', { autor: 'sistema', detalhe: `${erroMsg}: ${enviadas} chamada(s) reconstruída(s) da auditoria — confira /items/{id}/prices e o painel antes de qualquer nova tentativa`, depois: { plano: id, estado, ...resumir(chamadas) } })
      recuperados.push({ cliente: cli, plano: id, estado, chamadas: enviadas })
    }
  } catch (e) { console.error('[promocoes] recuperarPlanosPresos', e) }
  return recuperados
}

// ── sync pós-execução: SÓ LEITURA (GET). Espera a propagação; nunca limpa marcas em massa por leitura precoce ──
export async function sincronizarPosExecucao(cliente, planoId, { deps = {}, por = 'sistema' } = {}) {
  recuperarPlanosPresos(cliente, { agoraMs: deps.agoraMs ?? Date.now() })                       // plano preso em 'executando' vira sincronizável antes de ser lido
  const plano = repo.lerPlano(cliente, planoId)
  if (!plano) throw erro('plano não encontrado', 404)
  if (!['executado', 'executado_parcial', 'erro'].includes(plano.estado) || !plano.resultado) throw erro('só se sincroniza plano já executado', 409)     // parcial/erro também: pode haver POST enviado para conferir
  const agoraMs = deps.agoraMs ?? Date.now()
  const faltam = Math.ceil((Date.parse(plano.executado_em) + ESPERA_PROPAGACAO_MIN * 60e3 - agoraMs) / 60e3)
  if (faltam > 0) throw erro(`espere a propagação do ML: faltam ~${faltam} min (leitura precoce faz parecer que nada entrou)`, 409)
  const api = deps.api || await criarApi(cliente)
  const ctx = ctxDoApi(cliente, api, deps.espera ?? 300)
  const enviadas = plano.resultado.chamadas.filter(c => c.chamada && ['enviado', 'incerto'].includes(c.classe))
  const leituras = []
  for (const c of enviadas) {
    const viva = await buscarOfertasDoItem(ctx, c.item_id)
    leituras.push({ ...c, lido: viva.ok, provado: viva.ok && avaliarProva(viva.ofertas, c.pid).provado })
  }
  const entrou = leituras.filter(l => l.provado), naoProvou = leituras.filter(l => l.lido && !l.provado), semLeitura = leituras.filter(l => !l.lido)
  const suspeito = enviadas.length > 0 && entrou.length === 0               // "0 viraram Participando" com POSTs OK é suspeita, não veredito
  for (const l of entrou) marcarEstado(cliente, l.item_id, l.pid, 'executada')
  if (!suspeito) for (const l of naoProvou) marcarEstado(cliente, l.item_id, l.pid, 'nao_entrou')   // só linha a linha, nunca em massa, nunca apaga a marca
  const sync = { em: new Date(agoraMs).toISOString(), enviadas: enviadas.length, entrou: entrou.length, nao_provado: naoProvou.length, sem_leitura: semLeitura.length, suspeito,
    aviso: suspeito ? 'SUSPEITO: nenhuma das chamadas aparece como participação — NÃO conclua que falhou nem refaça escrita: confira /items/{id}/prices e o painel do ML' : '' }
  repo.atualizarPlano(cliente, planoId, { resultado: { ...plano.resultado, sync } })
  repo.auditar(cliente, 'sync_pos_execucao', { autor: por, depois: { plano: planoId, ...sync } })
  return sync
}
