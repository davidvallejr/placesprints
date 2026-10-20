// Plano de execução das promoções — DRY-RUN é o único modo deste arquivo: ele só LÊ (GET ao vivo) e MONTA a lista
// exata de chamadas que seriam feitas. Quem executa é o promocoes-exec.js (travado por duas chaves).
//   • ignora started/pending e quem não é mais candidato (re-busca a oferta VIVA, offer_id incluso);
//   • pula relâmpago SMART (SEMPRE se a marca é da trilha painel; senão pelo nome vivo), LIGHTNING e campanha sem rebate (fluxo manual do dono) e MC negativa (exceto ordem direta/"Livre");
//   • pre-check por MARGEM (regra do dono de 24/08/2026): candidato vivo ABAIXO do APROVADO (bloco 'aprovado' do plano) não entra, ACIMA entra;
//   • hedge: entra em todas as campanhas equivalentes (mesmo preço e mesmo rebate) — o ML derruba campanha sem avisar —, menos a recusada 👤 ou barrada pelo dono;
//   • o plano expira em 24h e NUNCA contém saída de campanha (nenhuma chamada além de POST de entrada).
import crypto from 'node:crypto'
import { num, mesmoPreco, ehRebate, ehRelampagoSmart, smartSemNome, ehLightning, calcularMC, resolverCustos, parseStatusRegra } from './promocoes-mc.js'
import { regraDoAnuncio, precoReferencia, carregarEntrada, custoDoItem } from './promocoes-analista.js'
import { buscarOfertasDoItem, criarContexto } from './promocoes-coleta.js'
import * as repo from './promocoes-db.js'

export const VALIDADE_HORAS = 24
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const fPct = n => (n == null ? '—' : n.toFixed(1).replace('.', ',') + '%')
const fR = n => (n == null ? '—' : 'R$ ' + n.toFixed(2).replace('.', ','))
const TOL = 0.005

// regra do dono (24/08/2026): a régua é MARGEM, não igualdade de preço. Sem base de comparação = não entra (neutro, reversível).
export function precheckMargem(aprovado, vivo) {
  const mcAprov = num(aprovado?.mc_pct ?? aprovado?.mcPct)                          // o bloco 'aprovado' do plano usa mc_pct; mcPct = nome antigo
  if (mcAprov != null) {                                                            // a MC aprovada manda: sem como medir a MC viva NÃO se cai no preço (preço maior não implica MC maior: degrau de frete, tarifa)
    if (num(vivo?.mcPct) == null) return { entra: false, motivo: `MC viva não calculável (sem custo/tarifa/imposto agora): sem como comparar com a MC aprovada ${fPct(mcAprov)}` }
    return vivo.mcPct + TOL >= mcAprov ? { entra: true, motivo: `MC viva ${fPct(vivo.mcPct)} ≥ aprovada ${fPct(mcAprov)}` }
      : { entra: false, motivo: `MC viva ${fPct(vivo.mcPct)} < aprovada ${fPct(mcAprov)} (candidato vivo ${fR(vivo.preco)})` }
  }
  if (num(aprovado?.preco) != null && num(vivo?.preco) != null)
    return vivo.preco + TOL >= aprovado.preco ? { entra: true, motivo: `preço vivo ${fR(vivo.preco)} ≥ aprovado ${fR(aprovado.preco)} (sem MC para comparar)` }
      : { entra: false, motivo: `preço vivo ${fR(vivo.preco)} < aprovado ${fR(aprovado.preco)} (sem MC para comparar)` }
  return { entra: false, motivo: 'sem preço/MC aprovados para comparar com o candidato vivo' }
}

export const caminhoDeEntrada = itemId => `/seller-promotions/items/${itemId}?app_version=v2`
// invariante inegociável: o plano só contém POST de ENTRADA em seller-promotions/items/{MLB}; nada de DELETE/saída
export function assertSemSaida(itens) {
  for (const i of itens) {
    const c = i.chamada
    if (!c) continue
    if (c.metodo !== 'POST' || !/^\/seller-promotions\/items\/MLB\d+\?app_version=v2$/.test(c.caminho) || !c.corpo?.promotion_id || !c.corpo?.offer_id || /delete|sair|exit/i.test(JSON.stringify(c)))
      throw erro(`plano inválido: chamada fora da lista de ENTRADA (${c.metodo} ${c.caminho}) — o sistema nunca sai de campanha`, 500)
  }
}
// o hash cobre as chamadas E o que o executor usa como baseline do que a pessoa aprovou (números aprovados, ordem direta, trilha e — no hedge — a âncora de quem ele depende;
// a âncora só entra na conta quando existe: o hash dos planos sem hedge continua o mesmo)
export const hashPlano = itens => crypto.createHash('sha256').update(JSON.stringify(itens.filter(i => i.acao === 'ENTRAR').map(i => [i.chamada, i.aprovado ?? null, !!i.ordem_direta, i.via || 'api', ...(i.ancora ? [i.ancora] : [])]))).digest('hex')

// o nome da oferta viva é o que denuncia o relâmpago SMART: quando a oferta do anúncio vem sem nome, completa pela campanha (igual à coleta)
export const completarNomes = (viva, campanhas) => (viva?.ok ? { ...viva, ofertas: viva.ofertas.map(o => (o.nome ? o : { ...o, nome: campanhas?.get(o.pid)?.nome || '' })) } : viva)
const SEM_RECUSAS = { pares: new Set(), itens: new Set(), bloqueado: () => false }

// recusa 👤 / bloqueio do dono sobre uma decisão (o plano E o executor, que a relê antes de CADA POST). null = livre.
// o hedge NUNCA herda a origem 'humano' da âncora (escaparia do bloqueio de IGNORAR / Revisar do anúncio): o dele vale como 'hedge'; a âncora é conferida com a origem REAL dela (d.origem)
// o hedge só existe por causa da âncora: recusa 👤 ou bloqueio da âncora (inclusive POSTERIOR à aprovação) derruba o hedge também
export function barradoPeloDono(recusas, d) {
  if (recusas.bloqueado(d.item_id, d.pid, d.regra === 'HEDGE' ? 'hedge' : d.origem)) return { motivo: 'recusado_pelo_dono', detalhe: 'recusa 👤 ou bloqueio do dono (IGNORAR / Revisar toda rodada) cobre esta campanha — o plano não a inclui' }
  if (d.ancora && (recusas.pares.has(`${d.item_id}|${d.ancora}`) || recusas.bloqueado(d.item_id, d.ancora, d.origem))) return { motivo: 'ancora_recusada', detalhe: `a campanha-âncora (${d.ancora}) foi recusada ou barrada pelo dono: o hedge dela não entra sozinho` }
  return null
}

// predicado ÚNICO de elegibilidade de uma campanha do anúncio — a âncora E a expansão do hedge passam por aqui (o plano aprovado nunca mostra ENTRAR que o executor recusaria).
// { cand } = elegível; senão { acao, motivo, detalhe }
export function elegivel(ofertas, pid) {
  const doPid = ofertas.filter(o => o.pid === pid)
  const ativa = doPid.find(o => ['started', 'pending'].includes(o.status))
  if (ativa) return { acao: 'IGNORAR', motivo: 'ja_participa', detalhe: `já ${ativa.status === 'started' ? 'participa (started)' : 'programado (pending)'} — "já está ativo, não mexer"` }
  const cand = doPid.find(o => o.status === 'candidate')
  if (!cand) return { acao: 'IGNORAR', motivo: 'sem_candidato_vivo', detalhe: 'a oferta não é mais candidata ao vivo (ciclo trocou ou campanha saiu)' }
  if (ehLightning(cand)) return { acao: 'PULAR', motivo: 'lightning_fora_do_escopo', detalhe: 'LIGHTNING (sem rebate) não é executada por este sistema' }
  if (ehRelampagoSmart(cand)) return { acao: 'PULAR', motivo: 'relampago_smart_painel', detalhe: 'relâmpago SMART só entra pelo PAINEL (a API pública não aceita) — confira o preço na tela' }
  if (smartSemNome(cand)) return { acao: 'PULAR', motivo: 'relampago_nome_desconhecido', detalhe: 'SMART sem nome (nem na oferta nem na coleta): não dá para saber se é relâmpago (só painel) — falha fechado; confirme no painel' }
  if (!ehRebate(cand)) return { acao: 'PULAR', motivo: 'fora_do_rebate', detalhe: `${cand.tipo} não é campanha de rebate: exige preço/datas (fluxo manual do dono)` }
  if (!cand.offer_id) return { acao: 'PULAR', motivo: 'sem_offer_id', detalhe: 'o candidato vivo não trouxe offer_id' }
  if (!pid || pid === 'SEM-ID' || pid === cand.tipo) return { acao: 'PULAR', motivo: 'campanha_sem_id', detalhe: 'a oferta não trouxe id de campanha próprio (só o tipo): não há promotion_id real para enviar' }
  return { cand }
}

// ── montagem PURA do plano a partir das marcas e das ofertas VIVAS ───────────────────────────────────
// `recusas` = repo.recusasHumanas(cliente): recusa 👤 e bloqueio do dono (IGNORAR / Revisar toda rodada) são vinculantes — nem a marca nem o hedge as contornam
export function montarPlano({ cliente, decisoes, vivasPorItem, anuncios, regrasSku = [], custosSku = new Map(), custosCliente = null, config, recusas = SEM_RECUSAS, agora = new Date() }) {
  const itens = []
  const empurra = (base, acao, motivo, detalhe, extra = {}) => itens.push({ ...base, acao, motivo, detalhe, chamada: null, ...extra })
  const decididos = new Set(decisoes.map(d => `${d.item_id}|${d.pid}`))
  for (const d of decisoes) {
    const a = anuncios.get(d.item_id) || { item_id: d.item_id, sku: '', titulo: '' }
    // 'aprovado' = os números que a pessoa aprovou (pid, offer_id, preço, MC%): o executor compara SEMPRE contra este bloco, nunca contra marcas de agora
    const base = { item_id: d.item_id, sku: a.sku || '', titulo: a.titulo || '', pid: d.pid, campanha: d.pid, origem: d.origem, regra: d.regra, via: d.via, ordem_direta: !!d.ordem_direta, aprovado: { pid: d.pid, offer_id: d.offer_id || '', preco: d.preco ?? null, mc_pct: d.mc_pct ?? null }, hedge: false, ...(d.ancora ? { ancora: d.ancora } : {}) }
    if (d.via === 'painel') { empurra(base, 'PULAR', 'relampago_smart_painel', 'marca de trilha PAINEL (relâmpago SMART): só entra pelo PAINEL — a API pública não aceita; confira o preço na tela'); continue }
    const barr = barradoPeloDono(recusas, d)
    if (barr) { empurra(base, 'PULAR', barr.motivo, barr.detalhe); continue }
    const viva = vivasPorItem.get(d.item_id)
    if (!viva?.ok) { empurra(base, 'PULAR', viva?.underReview ? 'under_review' : 'leitura_falhou', viva?.underReview ? 'anúncio under_review: o ML não aceita promoção' : `não consegui ler as ofertas vivas (${viva?.erro || 'sem leitura'})`); continue }
    base.campanha = viva.ofertas.find(o => o.pid === d.pid && o.nome)?.nome || d.pid
    const el = elegivel(viva.ofertas, d.pid)
    if (!el.cand) { empurra(base, el.acao, el.motivo, el.detalhe); continue }
    const cand = el.cand
    // MC viva (com os custos de hoje) e regra do SKU
    const regraSku = regraDoAnuncio(a, regrasSku), rg = regraSku ? parseStatusRegra(regraSku.status) : { tipo: 'padrao' }
    const custos = resolverCustos({ custoSku: custoDoItem(a, custosSku), custosCliente, tarifaItem: a.tarifa, impostoPct: config.imposto_pct, precoRef: precoReferencia(a, viva.ofertas) })
    const m = custos.ok && cand.preco > 0 ? calcularMC({ preco: cand.preco, precoOriginal: cand.preco_original ?? precoReferencia(a, viva.ofertas), meliPct: cand.meli_pct, ...custos }) : null
    const vivo = { preco: cand.preco, mcPct: m?.ok ? m.mcPct : null, meliPct: cand.meli_pct, offer_id: cand.offer_id }
    base.vivo = vivo
    const livre = rg.tipo === 'livre'
    if (m?.ok && m.mc < 0 && !livre && !d.ordem_direta) { empurra(base, 'PULAR', 'mc_negativa', `MC negativa (${fPct(m.mcPct)}) — só entra com ORDEM DIRETA do dono ou SKU "Livre"`); continue }
    const pre = precheckMargem(base.aprovado, vivo)
    if (!pre.entra) { empurra(base, 'PULAR', 'precheck_margem', `${pre.motivo}${livre ? ' — SKU "Livre": desvio de preço não cancela sozinho, PERGUNTE ao dono' : ''}`); continue }
    const aviso = !custos.ok ? `${custos.estado}: MC desconhecida (decisão humana sem MC)` : m?.ok && m.mc < 0 ? `MC negativa aceita por ${livre ? 'SKU "Livre"' : 'ordem direta'}` : ''
    empurra(base, 'ENTRAR', 'ok', `${pre.motivo}${aviso ? ' — ' + aviso : ''}`, { vivo, aviso, chamada: { metodo: 'POST', caminho: caminhoDeEntrada(d.item_id), corpo: { promotion_id: d.pid, promotion_type: cand.tipo, offer_id: cand.offer_id } } })
    // hedge: campanhas equivalentes (mesmo preço e mesmo meli%), ainda candidatas, ainda não decididas — passam pelo MESMO predicado da âncora
    for (const o of viva.ofertas) {
      if (o.pid === d.pid || o.status !== 'candidate' || decididos.has(`${d.item_id}|${o.pid}`) || recusas.bloqueado(d.item_id, o.pid)) continue
      const h = elegivel(viva.ofertas, o.pid), q = h.cand || o, hb = { ...base, pid: o.pid, campanha: q.nome || o.pid, regra: 'HEDGE', hedge: true, ancora: d.ancora || d.pid }
      if (!mesmoPreco(q.preco, cand.preco) || !mesmoPreco(q.meli_pct, cand.meli_pct)) continue
      // inelegível some do plano (a expansão não foi escolhida pelo dono), MENOS o SMART sem nome: aparece como PULAR para o dono conferir no painel
      if (!h.cand) { if (h.motivo === 'relampago_nome_desconhecido') { decididos.add(`${d.item_id}|${o.pid}`); empurra(hb, 'PULAR', h.motivo, `hedge equivalente a ${base.campanha}: ${h.detalhe}`) } continue }
      decididos.add(`${d.item_id}|${o.pid}`)
      itens.push({ ...hb, acao: 'ENTRAR', motivo: 'hedge', detalhe: `campanha equivalente a ${base.campanha} (mesmo preço ${fR(h.cand.preco)} e rebate ${fPct(h.cand.meli_pct)}): entra junto — o ML derruba campanha sem avisar`,
        vivo: { ...vivo, offer_id: h.cand.offer_id }, chamada: { metodo: 'POST', caminho: caminhoDeEntrada(d.item_id), corpo: { promotion_id: o.pid, promotion_type: h.cand.tipo, offer_id: h.cand.offer_id } } })
    }
  }
  assertSemSaida(itens)
  const conta = acao => itens.filter(i => i.acao === acao).length
  const porMotivo = {}; for (const i of itens) if (i.acao !== 'ENTRAR') porMotivo[i.motivo] = (porMotivo[i.motivo] || 0) + 1
  const criado = new Date(agora)
  return {
    id: `PL-${criado.getTime().toString(36)}${crypto.randomBytes(2).toString('hex')}`, cliente, criado_em: criado.toISOString(),
    expira_em: new Date(criado.getTime() + VALIDADE_HORAS * 3600e3).toISOString(), itens, hash: hashPlano(itens),
    resumo: { entrar: conta('ENTRAR'), ignorar: conta('IGNORAR'), pular: conta('PULAR'), hedge: itens.filter(i => i.hedge && i.acao === 'ENTRAR').length, anuncios: new Set(itens.map(i => i.item_id)).size, por_motivo: porMotivo, validade_horas: VALIDADE_HORAS },
  }
}

export const planoExpirado = (plano, agoraMs = Date.now()) => Date.parse(plano.expira_em) <= agoraMs

// ── gera o plano: lê as marcas efetivas, re-busca cada anúncio AO VIVO (GET) e grava o dry-run ─────────
export async function gerarPlano(cliente, { por = '', deps = {}, aoProgredir } = {}) {
  const decisoes = repo.marcasEfetivas(cliente), coleta = repo.lerColeta(cliente)      // dona do estado: salvarPlano confere que a coleta/conta ML ainda são estas no fim
  if (!decisoes.length) throw erro('nenhuma marca efetiva para planejar: marque (👤) ou aprove sugestões do analista (🤖) antes', 409)
  const e = await carregarEntrada(cliente, deps)
  const ctx = await criarContexto(cliente, deps)
  const vivas = new Map(), ids = [...new Set(decisoes.map(d => d.item_id))]
  for (let i = 0; i < ids.length; i++) { aoProgredir?.({ fase: 'ofertas vivas', feitos: i, total: ids.length }); vivas.set(ids[i], completarNomes(await buscarOfertasDoItem(ctx, ids[i]), e.campanhas)) }
  const plano = montarPlano({ cliente, decisoes, vivasPorItem: vivas, anuncios: new Map(e.anuncios.map(a => [a.item_id, a])), regrasSku: e.regrasSku, custosSku: e.custosSku, custosCliente: e.custosCliente, config: e.config, recusas: repo.recusasHumanas(cliente), agora: deps.agora || new Date() })
  repo.salvarPlano({ ...plano, gerado_por: por }, { coleta })
  repo.auditar(cliente, 'plano', { autor: por, depois: { id: plano.id, ...plano.resumo }, detalhe: `dry-run — expira em ${plano.expira_em}` })
  return { ...plano, estado: 'dry-run' }
}

export function aprovarPlano(cliente, id, por = '', agoraMs = Date.now()) {
  const p = repo.lerPlano(cliente, id)
  const barra = (msg, status) => { repo.auditar(cliente, 'plano_aprovacao_bloqueada', { autor: por, detalhe: msg, depois: { plano: id } }); throw erro(msg, status) }       // toda tentativa barrada fica na auditoria
  if (!p) barra('plano não encontrado', 404)
  if (p.estado !== 'dry-run') barra(`plano já está "${p.estado}"`, 409)
  if (planoExpirado(p, agoraMs)) barra('plano expirado (24h) — gere um novo dry-run', 409)
  if (!p.itens.some(i => i.acao === 'ENTRAR')) barra('plano sem nenhuma entrada para aprovar', 409)
  if (!String(por).trim()) barra('informe quem está aprovando', 400)
  try { assertSemSaida(p.itens) } catch (e) { barra(e.message, e.status) }
  repo.atualizarPlano(cliente, id, { estado: 'aprovado', aprovado_por: String(por).slice(0, 80), aprovado_em: new Date(agoraMs).toISOString() })
  repo.auditar(cliente, 'plano_aprovado', { autor: por, depois: { id, ...p.resumo } })
  return repo.lerPlano(cliente, id)
}
