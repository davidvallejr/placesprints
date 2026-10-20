// Estado do anúncio como EVENTO do change-log (meli_item_mudanca): promoção e Ads nascem aqui como diffs puros; Full, estoque zerado e status
// já são gravados pela coleta (campos logistica/estoque_zero/status). Módulo SEM imports: promocoes-db.js (banco em memória nos testes) e
// meli-serie.js usam sem abrir banco nenhum. Regra de todos os diffs: sem leitura anterior não há evento; só cruzar fronteira vira evento.

export const SEM_PROMOCAO = 'nenhuma'
export const ROTULO_ADS = { active: 'anunciando', paused: 'pausado', idle: 'inativo', hold: 'retido pelo ML', deleted: 'excluído', sem_anuncio: 'sem anúncio de Ads' }

// 'nenhuma' | '<TIPO> −X%' da oferta started de MENOR preço (X = 1 − preço ÷ preço original, inteiro); sem preços: só '<TIPO>'
export function estadoPromocao(ofertas) {
  const vivas = (ofertas || []).filter(o => o && o.status === 'started')
  if (!vivas.length) return SEM_PROMOCAO
  const o = [...vivas].sort((a, b) => (a.preco ?? Infinity) - (b.preco ?? Infinity) || String(a.tipo || '').localeCompare(String(b.tipo || '')))[0]
  const tipo = String(o.tipo || 'PROMOCAO').toUpperCase().replace(/\s+/g, '_')
  const pct = Number(o.preco) > 0 && Number(o.preco_original) > 0 ? Math.round((1 - Number(o.preco) / Number(o.preco_original)) * 100) : null
  return pct != null && pct > 0 ? `${tipo} −${pct}%` : tipo
}
export const tipoPromocao = estado => (estado && estado !== SEM_PROMOCAO ? String(estado).replace(/ −\d+%$/, '') : '')

// antes/depois: Map item_id → estado ('nenhuma' | 'TIPO −X%'); lidosAntes: anúncios já lidos na coleta anterior (sem leitura anterior não há "de").
// Evento ao cruzar a fronteira 'nenhuma' ou ao mudar o TIPO; só o % mudando não é evento (isso já aparece no campo preco).
export function diffPromocao(antes, depois, lidosAntes) {
  const out = []
  for (const [item_id, para] of depois) {
    if (!lidosAntes.has(item_id)) continue
    const de = antes.get(item_id) ?? SEM_PROMOCAO
    if (de === para || tipoPromocao(de) === tipoPromocao(para)) continue
    out.push({ item_id, campo: 'promocao', de, para, pct: null })
  }
  return out
}

// antes/depois: Map item_id → status cru do Product Ad (active | paused | idle | hold | deleted); 'sem_anuncio' = fora da lista.
// Fronteira 'active' (ligou ou desligou): idle ↔ hold não gera evento. Foto anterior vazia = 1ª coleta: nada (regra do "de" nulo).
// ponytail: foto anterior VAZIA de verdade (conta sem nenhum Product Ad) é indistinguível da 1ª coleta — o histórico de Ads dessa conta começa
// na 2ª mudança; se isso aparecer, marcar a 1ª coleta de Ads em sync_estado e passar { primeira } em vez de inferir pelo tamanho
export function diffAds(antes, depois) {
  const out = []
  if (!antes.size) return out
  const ativo = s => s === 'active'
  const vistos = new Set()
  for (const [item_id, para] of depois) {
    vistos.add(item_id)
    const de = antes.get(item_id) ?? 'sem_anuncio'
    if (ativo(de) !== ativo(para)) out.push({ item_id, campo: 'ads', de, para, pct: null })
  }
  for (const [item_id, de] of antes) if (!vistos.has(item_id) && ativo(de)) out.push({ item_id, campo: 'ads', de, para: 'sem_anuncio', pct: null })
  return out
}

// o evento muda o que importa para a leitura e para o Merovíngio? (por campo)
export function cruzaFronteira(ev) {
  const de = String(ev?.de ?? ''), para = String(ev?.para ?? '')
  switch (ev?.campo) {
    case 'promocao': return de === SEM_PROMOCAO || para === SEM_PROMOCAO
    case 'ads': return true
    case 'logistica': return de === 'fulfillment' || para === 'fulfillment'
    case 'estoque_zero': return true
    case 'status': return de === 'active' || para === 'active'
    default: return false
  }
}

// Estado do campo no dia `dia`, voltando no change-log a partir do valor ATUAL: o 1º evento depois do dia diz o "de"; sem evento, vale o atual.
// Antes do início do histórico (dia < inicio) não há como saber: null (a tela mostra "—"). eventos: lista do anúncio em ordem de dia.
export function estadoEm(eventos, campo, dia, atual, inicio) {
  if (inicio && dia < inicio) return null
  const depois = (eventos || []).filter(e => e.campo === campo && e.dia > dia).sort((a, b) => a.dia.localeCompare(b.dia))
  return depois.length ? depois[0].de : atual
}

// ── leitura cruzada do anúncio (Folha do anúncio, com os 4 tópicos marcados): só MONTA FRASES do que os motores já mediram ──
// Nada aqui decide, prioriza ou promete: fato = dado medido ('—' quando falta); hipótese = o que o plano já escreveu + a coincidência de data,
// sempre marcada como hipótese. Pura: a folha passa os blocos prontos (promo, oferta, ads, full), as ações anuncio_* do plano e os eventos da janela.
// ponytail: cópia de diaLocal (preco-historico.js) — módulo sem imports. Carimbo com fuso (publicado_em = toISOString) vira o dia do Brasil; dia/fim já são locais
const diaLocal = s => /(Z|[+-]\d\d:?\d\d)$/i.test(String(s)) ? new Date(s).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : String(s).slice(0, 10)
const dm = d => d ? `${diaLocal(d).slice(8, 10)}/${diaLocal(d).slice(5, 7)}` : '—'
const brl = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dec = (n, c = 1) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c })
const sinal = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(Math.round(n)) + '%'

// texto curto de um evento do change-log, por campo (a Folha e o cartão de tarefa usam o mesmo vocabulário)
export function textoEvento(ev) {
  const de = ev?.de == null ? '' : String(ev.de), para = ev?.para == null ? '' : String(ev.para)
  switch (ev?.campo) {
    case 'promocao': return para !== SEM_PROMOCAO && de === SEM_PROMOCAO ? `entrou em promoção (${para})` : para === SEM_PROMOCAO ? 'saiu da promoção' : `promoção mudou para ${para}`
    case 'ads': return para === 'active' ? 'Ads ligado' : de === 'active' ? (para === 'paused' ? 'Ads pausado' : 'Ads desligado') : `Ads: ${ROTULO_ADS[de] || de || '—'} → ${ROTULO_ADS[para] || para || '—'}`
    case 'logistica': return para === 'fulfillment' ? 'foi para o Full' : de === 'fulfillment' ? 'saiu do Full' : `logística mudou (${de || '—'} → ${para || '—'})`
    case 'estoque_zero': return Number(para) === 0 ? 'estoque zerou' : 'estoque voltou'
    case 'status': return para === 'active' ? 'reativado' : de === 'active' ? 'pausado' : `status ${de || '—'} → ${para || '—'}`
    case 'preco': return ev.pct != null ? `preço ${sinal(ev.pct)}` : `preço ${de || '—'} → ${para || '—'}`
    case 'preco_original': return para ? 'preço riscado mudou' : 'preço riscado saiu'
    case 'titulo': return 'título mudou'
    case 'fotos': return `fotos ${de || '—'} → ${para || '—'}`
    case 'thumb': return 'capa mudou'
    case 'frete_gratis': return Number(para) ? 'ganhou frete grátis' : 'perdeu frete grátis'
    case 'descricao': return 'descrição mudou'
    case 'atributos': return 'ficha mudou'
    case 'categoria': return `categoria ${de || '—'} → ${para || '—'}`
    case 'tipo_anuncio': return `tipo de anúncio ${de || '—'} → ${para || '—'}`
    default: return `${ev?.campo || 'campo'} mudou`
  }
}

// ponytail: o limite de ruptura (10 d) vive em full-metricas.js (LIM_RISCO_DIAS); este módulo não importa nada, então repete só o número da frase
const LIM_RISCO_LEITURA = 10
// item: linha de diagnosticarConta().itens (28 d) ou null (sem venda nem Ads em 56 d). promo: { estado, tipo, desconto_pct, fim, desde, candidatas } | null (não coletado).
// ads: { status, custo, receita, roas, unidades, desde } | null (Ads não coletado na conta). full: { no_full, logistica_rotulo, cobertura_dias, risco_ruptura } | null.
// oferta: { estado_rotulo, publicado_em } | null. acoes: ações anuncio_* abertas [{ id, regra, titulo, status, p, problema, hipotese }]. eventos: da janela, em ordem de dia.
export function leituraAnuncio(item, { promo = null, oferta = null, ads = null, full = null, acoes = [], eventos = [], bench = null, hoje = '' } = {}) {
  const fatos = [], hipoteses = []
  // vendas (28 d × 28 anteriores)
  if (!item) fatos.push('Vendas: sem venda registrada nos últimos 56 dias')
  else fatos.push(`${item.u} un em 28 dias${item.u0 > 0 ? ` (${sinal((item.u / item.u0 - 1) * 100)} sobre os 28 anteriores)` : ' (sem venda nos 28 anteriores)'}`)
  // conversão contra a média da própria conta
  if (item?.conv != null) {
    const dif = bench?.conv > 0 ? Math.round((item.conv / bench.conv - 1) * 100) : null
    fatos.push(dif == null ? `Conversão ${dec(item.conv)}% (sem média da conta para comparar)` : dif === 0 ? `Conversão ${dec(item.conv)}%, na média da conta (${dec(bench.conv)}%)` : `Conversão ${dec(item.conv)}%, ${Math.abs(dif)}% ${dif > 0 ? 'acima' : 'abaixo'} da média da conta (${dec(bench.conv)}%)`)
  }
  else fatos.push('Conversão —: visitas não coletadas para este anúncio')
  // Ads (28 d)
  if (!ads) fatos.push('Ads —: Ads não coletado nesta conta')
  else if (ads.custo > 0) fatos.push(`Ads gastou ${brl(ads.custo)} em 28 dias com ROAS ${ads.roas == null ? '—' : dec(ads.roas)} (${ads.unidades ?? 0} venda(s) atribuída(s))`)
  else if (ads.status === 'active') fatos.push(`Ads anunciando${ads.desde ? ` desde ${dm(ads.desde)}` : ''}, sem gasto em 28 dias`)
  else fatos.push('Sem Ads nos últimos 28 dias')
  // promoção (estado da última coleta)
  if (!promo) fatos.push('Promoção —: promoções não coletadas para este cliente')
  else if (promo.estado === 'started') fatos.push(`Em promoção ${promo.tipo || 'PROMOCAO'}${promo.desconto_pct > 0 ? ` −${Math.round(promo.desconto_pct)}%` : ''}${promo.desde ? ` desde ${dm(promo.desde)}` : ''}${promo.fim ? ` (até ${dm(promo.fim)})` : ''}`)
  else fatos.push(`Fora de promoção${promo.candidatas > 0 ? ` · ${promo.candidatas} campanha(s) candidata(s)` : ''}`)
  // Full / cobertura de estoque
  if (!full || full.no_full == null) fatos.push('Full —: logística não coletada')
  else if (full.no_full) fatos.push(`No Full${full.cobertura_dias != null ? `, ${full.cobertura_dias} dias de estoque no ritmo atual` : ''}`)
  else fatos.push(`Fora do Full (${full.logistica_rotulo || '—'})`)
  if (full?.risco_ruptura) fatos.push(`Risco de ruptura: menos de ${LIM_RISCO_LEITURA} dias de estoque`)
  if (oferta?.estado_rotulo) fatos.push(`Ofertas Estratégicas: ${oferta.estado_rotulo}${oferta.publicado_em ? ` (publicada em ${dm(oferta.publicado_em)})` : ''}`)
  // coincidência: queda (u < 0,85·u0) E evento que cruza fronteira na janela — fato (as datas) + hipótese (nunca causa)
  const cruzou = (eventos || []).filter(cruzaFronteira)
  if (item && item.u0 > 0 && item.u < 0.85 * item.u0 && cruzou.length) {
    const lista = cruzou.map(e => `${textoEvento(e)} em ${dm(e.dia)}`).join('; ')
    fatos.push(`A queda coincide com: ${lista}`)
    hipoteses.push(`Hipótese: ${cruzou.length === 1 ? textoEvento(cruzou[0]) : 'essas mudanças'} pode explicar a queda. Não medido; compare com os anúncios que não mudaram`)
  }
  // plano: só o que já está salvo (nunca inventa ação, prioridade ou preço)
  const lista = (acoes || []).map(a => ({ id: a.id, regra: a.regra, titulo: a.titulo, status: a.status, p: a.p ?? null }))
  if (lista.length) {
    fatos.push(`O plano já propõe: ${lista.map(a => `${a.titulo} (${[a.p, a.status].filter(Boolean).join(', ')})`).join(' · ')}`)
    for (const a of acoes) { if (a.problema) hipoteses.push(`${a.titulo}: ${a.problema}`); if (a.hipotese) hipoteses.push(a.hipotese) }
  } else fatos.push('Nenhuma ação do plano para este anúncio')
  return { fatos, hipoteses, acoes: lista, eventos: (eventos || []).map(e => ({ dia: e.dia, campo: e.campo, texto: textoEvento(e) })) }
}
