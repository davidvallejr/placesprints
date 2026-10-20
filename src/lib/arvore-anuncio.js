// Árvore de diagnóstico de ANÚNCIO — as regras do David (06/10/2026), codificadas:
//   • caiu a IMPRESSÃO  → ficha técnica, título, categoria e até ADS (visibilidade/indexação)
//   • caiu o CLIQUE/CTR → mexe na FOTO DE CAPA (e no preço exibido) — não sair mexendo em tudo
//   • clique bom + CONVERSÃO ruim → frete, carrossel (imagens além da capa), oferta "de/por",
//     promoção, concorrente/mercado, logística e ANCORAGEM — ex.: nós "de 70 por 49" e o
//     concorrente "de 67 por 49": o desconto dele é MENOR em %, mas a âncora mais próxima do
//     preço real é mais crível no cérebro do cliente, e a venda migra.
// Funciona com números DIGITADOS pelo consultor (painel do canal) — nenhuma coleta automática
// é fingida. Todo veredito cita a evidência e o que falta. Determinístico e testável.
const r1 = n => Math.round(n * 10) / 10
const varPct = (dep, ant) => (ant == null || dep == null || !ant) ? null : r1((dep - ant) / Math.abs(ant) * 100)
const num = v => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null }

const REF = { ctr_pct: 1, conversao_pct: 1, queda_pct: -10 }     // referências do playbook (CTR/CVR < 1% = problema)

// m: { impressoes: {antes, depois}, cliques: {antes, depois}, visitas: {antes, depois},
//      pedidos: {antes, depois}, frete_gratis: bool|null, imagens_carrossel: int|null,
//      meu: {de, por}|null, concorrente: {de, por}|null, prazo_dias: int|null }
export function diagnosticoAnuncio(entrada = {}) {
  const j = k => ({ antes: num(entrada[k]?.antes), depois: num(entrada[k]?.depois) })
  const imp = j('impressoes'), cli = j('cliques'), vis = j('visitas'), ped = j('pedidos')
  const ctr = {
    antes: imp.antes && cli.antes != null ? r1(cli.antes / imp.antes * 100) : null,
    depois: imp.depois && cli.depois != null ? r1(cli.depois / imp.depois * 100) : null,
  }
  const baseVis = { antes: vis.antes ?? cli.antes, depois: vis.depois ?? cli.depois }   // sem visitas, cliques aproximam
  const conv = {
    antes: baseVis.antes && ped.antes != null ? r1(ped.antes / baseVis.antes * 100) : null,
    depois: baseVis.depois && ped.depois != null ? r1(ped.depois / baseVis.depois * 100) : null,
  }
  const achados = [], faltando = []
  const add = (etapa, gravidade, veredito, mexa_em, evidencia) => achados.push({ etapa, gravidade, veredito, mexa_em, evidencia })

  // 1. EXPOSIÇÃO (impressões)
  const dImp = varPct(imp.depois, imp.antes)
  if (dImp == null) faltando.push(imp.antes === 0 && imp.depois != null
    ? 'impressões: período anterior zerado (anúncio novo?) — comparação de exposição indisponível, avaliando só o período atual'
    : 'impressões (antes × depois) — sem elas não dá para julgar a exposição')
  else if (dImp <= REF.queda_pct)
    add('exposicao', 'alta', `Impressões caíram ${Math.abs(dImp)}% — o anúncio está aparecendo menos`,
      ['Ficha técnica (atributos completos)', 'Título (palavras-chave reais de busca)', 'Categoria correta', 'ADS (cobertura e lances)'],
      `Impressões ${imp.antes} → ${imp.depois}. Regra da casa: caiu a impressão, olhar ficha técnica, título e até ADS — o problema é visibilidade/indexação, não a capa.`)

  // 2. CLIQUE (CTR) — só faz sentido julgar com exposição presente
  const dCtr = ctr.antes != null && ctr.depois != null ? r1(ctr.depois - ctr.antes) : null
  const ctrBaixo = ctr.depois != null && ctr.depois < REF.ctr_pct
  if (ctr.depois == null) faltando.push('cliques (antes × depois) — sem eles não dá para julgar a capa')
  else if ((dCtr != null && dCtr <= -0.2) || ctrBaixo)
    add('clique', 'alta', dCtr != null && dCtr <= -0.2
      ? (dImp != null && dImp <= REF.queda_pct ? `Além da exposição, o CTR também caiu ${Math.abs(dCtr)} ponto(s) — a capa também é suspeita` : `CTR caiu ${Math.abs(dCtr)} ponto(s) com exposição estável — o anúncio aparece mas não atrai o clique`)
      : `CTR em ${ctr.depois}% (referência: abaixo de ${REF.ctr_pct}% indica problema)`,
      ['FOTO DE CAPA (o alvo nº 1 — trocar e testar, não mexer em tudo)', 'Preço exibido / "de-por" visível na vitrine'],
      `CTR ${ctr.antes ?? '—'}% → ${ctr.depois}%. Regra da casa: caiu o clique, mexe SOMENTE na foto de capa primeiro — uma variável por vez para saber o que funcionou.`)

  // 3. CONVERSÃO (visita → pedido) — clique bom mas não compra
  const dConv = conv.antes != null && conv.depois != null ? r1(conv.depois - conv.antes) : null
  const convBaixa = conv.depois != null && conv.depois < REF.conversao_pct
  if (conv.depois == null) faltando.push('pedidos (antes × depois) — sem eles não dá para julgar a conversão')
  else if (dConv != null && dConv <= -0.2 || convBaixa) {
    const cliqueCaiu = achados.some(a => a.etapa === 'clique')
    const proxy = vis.depois == null && cli.depois != null ? ' (calculada sobre cliques — sem o dado de visitas)' : ''
    const checklist = [
      entrada.frete_gratis === false ? 'FRETE (sem frete grátis — primeiro suspeito)' : 'Frete (condição vs concorrente)',
      (entrada.imagens_carrossel != null && entrada.imagens_carrossel < 4) ? `CARROSSEL (só ${entrada.imagens_carrossel} imagem(ns) além da capa — mostrar uso, medidas, detalhes)` : 'Carrossel (imagens complementares: uso, medidas, detalhes)',
      'Oferta "de/por" e promoção ativa', 'Concorrente/mercado (preço e condição hoje)',
      entrada.prazo_dias != null && entrada.prazo_dias > 5 ? `LOGÍSTICA (prazo de ${entrada.prazo_dias} dias afasta compra)` : 'Logística (prazo de entrega)',
      'Ancoragem (ver bloco abaixo)',
    ]
    add('conversao', 'alta', dConv != null && dConv <= -0.2 ? `Conversão caiu ${Math.abs(dConv)} ponto(s) com clique saudável — a visita chega e não compra` : `Conversão em ${conv.depois}% (referência: abaixo de ${REF.conversao_pct}% indica problema)`,
      checklist,
      `Conversão ${conv.antes ?? '—'}% → ${conv.depois}%${proxy}${ctr.depois != null ? `; CTR ${ctr.depois}%${cliqueCaiu ? ' (também em queda — atacar a capa primeiro, uma variável por vez)' : ' (saudável)'}` : ''}. ${cliqueCaiu ? 'Com clique e conversão caindo juntos, priorize a capa e reavalie a conversão depois.' : 'A objeção está DENTRO do anúncio ou na oferta — não em atrair gente.'}`)
  }

  // 4. ANCORAGEM — o caso 70→49 vs 67→49
  const metade = (x, quem) => x && (num(x.de) == null) !== (num(x.por) == null) ? `${quem}: informe o "de" E o "por" — com só um dos dois a ancoragem não é avaliada` : null
  for (const f of [metade(entrada.meu, 'sua oferta'), metade(entrada.concorrente, 'concorrente')]) if (f) faltando.push(f)
  const anc = ancoragem(entrada.meu, entrada.concorrente)
  if (anc) achados.push(anc)
  else if (entrada.meu?.de && !entrada.concorrente?.de) faltando.push('"de/por" do concorrente — sem ele a ancoragem não é comparável')

  if (!achados.length && !faltando.length)
    add('geral', 'ok', 'Nenhuma ruptura nas etapas medidas (exposição, clique e conversão estáveis/acima da referência)', ['Manter e monitorar no ritual de métricas'], 'Funil sem queda > 10% e taxas acima das referências do playbook.')
  return { achados, faltando, funil: { impressoes: imp, ctr, visitas: baseVis, conversao: conv }, referencia: REF }
}

// Âncora crível vale mais que desconto grande: com o MESMO preço final, a âncora mais próxima
// do preço praticado parece mais real — desconto % menor pode converter MAIS.
export function ancoragem(meu, conc) {
  const d = x => { const de = x && num(x.de), por = x && num(x.por)
    return de && por && de >= por ? { de, por, desconto: r1((de - por) / de * 100) } : null }
  const m = d(meu), c = d(conc)
  if (!m) return null
  if (!c) return { etapa: 'ancoragem', gravidade: 'info', veredito: `Sua oferta: de ${m.de} por ${m.por} (${m.desconto}% de desconto)`, mexa_em: ['Levantar o "de/por" do concorrente para comparar a credibilidade da âncora'], evidencia: 'Sem o concorrente, a ancoragem não é julgável — desconto grande com âncora inflada pode converter menos que desconto pequeno com âncora crível.' }
  const mesmaFaixa = Math.abs(m.por - c.por) / Math.max(m.por, c.por) <= 0.05
  if (mesmaFaixa && c.de < m.de)
    return { etapa: 'ancoragem', gravidade: 'alta',
      veredito: `Ancoragem frágil: vocês "de ${m.de} por ${m.por}" (${m.desconto}%) × concorrente "de ${c.de} por ${c.por}" (${c.desconto}%) — o desconto dele é menor, mas a âncora mais baixa é mais crível e leva a venda`,
      mexa_em: [`Aproximar a âncora do preço real de mercado (ex.: "de ${Math.round((c.de + m.por) / 2)}" em vez de "de ${m.de}")`, 'Validar a elegibilidade da promoção no canal', 'Não competir inflando o "de" — o cliente percebe'],
      evidencia: `Mesmo preço final (~${m.por}). No cérebro do cliente, "de ${c.de}" parece desconto real; "de ${m.de}" parece inflado — e ele compra do concorrente. (Caso-regra da casa: 70→49 perde de 67→49.)` }
  if (c.desconto > m.desconto && c.por < m.por)
    return { etapa: 'ancoragem', gravidade: 'media', veredito: `Concorrente mais agressivo: ${c.desconto}% (por ${c.por}) × seus ${m.desconto}% (por ${m.por})`, mexa_em: ['Revisar preço/margem antes de cobrir — nunca baixar sem piso de margem validado'], evidencia: `Diferença de preço final: ${r1(m.por - c.por)}.` }
  return { etapa: 'ancoragem', gravidade: 'ok', veredito: `Ancoragem saudável: sua âncora (de ${m.de}) está ${c.de >= m.de ? 'igual ou abaixo da' : 'próxima à'} do concorrente (de ${c.de})`, mexa_em: [], evidencia: `Vocês ${m.desconto}% × concorrente ${c.desconto}%, preços finais ${m.por} × ${c.por}.` }
}
