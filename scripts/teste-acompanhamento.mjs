// Autoteste do acompanhamento por tarefa (antes × 24h × 48h × 72h × 1 semana × hoje): séries SINTÉTICAS, só funções puras.
import assert from 'node:assert/strict'
import { metricasDaJanela, compararComBase, quadroAntesDepois, sinalObservado, serieGrafico, mudancasNoAnuncio, fasesPendentes, agregarAnuncios, somarSeries, MARCOS, vereditoCartao, ORDEM_FAMILIA, rotuloEvento, construirQuadro } from '../src/lib/acompanhamento.js'
import { microGrafico, mediaMovel } from '../src/lib/micro-grafico.js'
import { addDias } from '../src/lib/meli-serie.js'

const D = '2026-09-20', HOJE = '2026-10-05', ULT = '2026-10-04'
const dias = (de, ate) => { const a = []; for (let d = de; d <= ate; d = addDias(d, 1)) a.push(d); return a }
const serie = (f, de = addDias(D, -40), ate = ULT) => Object.fromEntries(dias(de, ate).map((d, i) => [d, f(d, i)]))
const todos = () => true

// 1) janela: médias por dia, ticket, conversão; lacuna de cobertura → null COM motivo (nunca zero)
{
  const s = { unidades: serie(() => 2), receita: serie(() => 100), visitas: serie(() => 40), ads: null }
  const m = metricasDaJanela(s, '2026-09-21', '2026-09-23', { pedidos: todos, visitas: todos })
  assert.equal(m.valores.unidades, 2); assert.equal(m.valores.receita, 100); assert.equal(m.valores.ticket, 50); assert.equal(m.valores.visitas, 40); assert.equal(m.valores.conversao, 5)
  assert.equal(m.valores.ads_prints, undefined); assert.match(m.motivos.ads_prints, /sem dado diário de Ads/)
  const lac = metricasDaJanela(s, '2026-09-21', '2026-09-23', { pedidos: todos, visitas: d => d !== '2026-09-22' })
  assert.equal(lac.valores.visitas, undefined); assert.match(lac.motivos.visitas, /não coletadas/); assert.equal(lac.valores.unidades, 2, 'pedidos continuam')
  // visitas sem série (null) → motivo próprio
  assert.match(metricasDaJanela({ ...s, visitas: null }, '2026-09-21', '2026-09-23', { pedidos: todos }).motivos.visitas, /não coletadas para este anúncio/)
  // conversão > 100% (visitas em outro anúncio do mesmo produto) é descartada
  const alta = metricasDaJanela({ unidades: serie(() => 5), receita: serie(() => 250), visitas: serie(() => 2) }, '2026-09-21', '2026-09-23', { pedidos: todos, visitas: todos })
  assert.equal(alta.valores.conversao, null); assert.match(alta.motivos.conversao, /vendas > visitas/)
  // Ads: zeros coletados são zeros (≠ não coletado); CTR/CPC/ROAS só com denominador
  const ads = { prints: serie(() => 1000), clicks: serie(() => 20), custo: serie(() => 10), receita: serie(() => 50), unidades: serie(() => 1) }
  const a = metricasDaJanela({ ...s, ads }, '2026-09-21', '2026-09-23', { pedidos: todos, visitas: todos, ads: todos })
  assert.equal(a.valores.ads_ctr, 2); assert.equal(a.valores.ads_cpc, 0.5); assert.equal(a.valores.ads_roas, 5)
  const z = metricasDaJanela({ ...s, ads: { prints: {}, clicks: {}, custo: {}, receita: {}, unidades: {} } }, '2026-09-21', '2026-09-23', { pedidos: todos, visitas: todos, ads: todos })
  assert.equal(z.valores.ads_custo, 0); assert.equal(z.valores.ads_roas, null); assert.match(z.motivos.ads_roas, /sem investimento/)
}

// 2) quadro: efeito plantado a partir de D+1 → todos os marcos mostram a subida; D e hoje não entram; ajuste por controle
{
  const alvo = { unidades: serie((d) => d > D ? 15 : 10), receita: serie((d) => (d > D ? 15 : 10) * 50), visitas: serie((d) => d > D ? 300 : 200), ads: null }
  const ctrlFlat = { unidades: serie(() => 30), visitas: serie(() => 600) }
  const q = quadroAntesDepois({ serie: alvo, controle: ctrlFlat, data: D, ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  assert.deepEqual(q.marcos.map(m => m.rotulo), ['24h', '48h', '72h', '1 semana'])
  for (const m of q.marcos) { assert.equal(m.estado, 'ok'); assert.equal(m.deltas.unidades.pct, 50); assert.equal(m.deltas.visitas.pct, 50); assert.equal(m.ajustado.unidades, 50) }
  assert.equal(q.marcos[0].de, addDias(D, 1)); assert.equal(q.marcos[0].ate, addDias(D, 1)); assert.equal(q.marcos[3].ate, addDias(D, 7))
  assert.equal(q.base.valores.unidades, 10); assert.equal(q.janela_base.ate, addDias(D, -1), 'o dia D fica fora da base')
  assert.equal(q.hoje.atualizado_ate, ULT); assert.equal(q.hoje.deltas.unidades.pct, 50)
  assert.equal(q.hoje.ajustado.unidades, 50, 'hoje com 14 dias ainda é ajustado')
  const longo = quadroAntesDepois({ serie: alvo, controle: ctrlFlat, data: '2026-09-10', ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  assert.match(longo.hoje.sem_ajuste, /sem ajuste pelo grupo de controle/, 'janela longa não é ajustada'); assert.deepEqual(longo.hoje.ajustado, {})
  // o MERCADO sobe 50% junto: variação observada +50%, mas ajustada ≈ 0 (a tarefa não leva o mérito)
  const mercado = { unidades: serie((d) => d > D ? 45 : 30), visitas: serie((d) => d > D ? 900 : 600) }
  const qm = quadroAntesDepois({ serie: alvo, controle: mercado, data: D, ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  assert.equal(qm.marcos[3].deltas.unidades.pct, 50); assert.equal(qm.marcos[3].ajustado.unidades, 0)
  // sem controle: não existe ajuste (nunca inventa)
  const sc = quadroAntesDepois({ serie: alvo, controle: null, data: D, ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  assert.deepEqual(sc.marcos[0].ajustado, {})
  // tarefa concluída ontem: marcos ainda não fecharam → 'aguardando' com a data em que fecham
  const rec = quadroAntesDepois({ serie: alvo, controle: ctrlFlat, data: ULT, ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  assert.equal(rec.marcos[0].estado, 'aguardando'); assert.equal(rec.marcos[0].disponivel_em, addDias(ULT, 2)); assert.equal(rec.hoje.estado, 'aguardando')
  // base pequena: variação percentual vira null com motivo (não um +400% de 1 para 5)
  const peq = { unidades: serie((d) => d > D ? 1 : 0), receita: serie((d) => d > D ? 50 : 0), visitas: null }
  const qp = quadroAntesDepois({ serie: peq, data: D, ultimoCompleto: ULT, cob: { pedidos: todos } })
  assert.equal(qp.marcos[0].deltas.unidades.pct, null, 'base zero → sem variação percentual'); assert.equal(qp.marcos[0].deltas.unidades.motivo, 'base zero'); assert.equal(qp.marcos[0].deltas.unidades.abs, 1)
  // marco 1 semana fecha só com os 7 dias completos
  const meio = quadroAntesDepois({ serie: alvo, controle: ctrlFlat, data: addDias(ULT, -4), ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  assert.deepEqual(meio.marcos.map(m => m.estado), ['ok', 'ok', 'ok', 'aguardando'])
  // leitura descritiva: nunca "efeito"
  const s = sinalObservado(q); assert.equal(s.sinal, 'positivo'); assert.equal(s.ajustado_pct, 50)
  assert.equal(sinalObservado(rec).sinal, 'sem_leitura')
}

// 2b) percentual só com base e janela suficientes: 1 venda no 1º dia contra 5 vendas em 14 dias NÃO é "+178%"
{
  const un = serie(d => d === addDias(D, -3) ? 5 : d === addDias(D, 1) ? 1 : 0)
  const pe = { unidades: un, receita: Object.fromEntries(Object.entries(un).map(([d, n]) => [d, n * 50])), visitas: serie(() => 3), ads: null }
  const q = quadroAntesDepois({ serie: pe, data: D, ultimoCompleto: ULT, cob: { pedidos: todos, visitas: todos } })
  for (const k of ['unidades', 'receita', 'ticket', 'visitas']) assert.equal(q.marcos[0].deltas[k]?.pct ?? null, null, `${k}: base pequena não gera percentual`)
  assert.equal(q.marcos[0].deltas.conversao?.pontos ?? null, null, 'taxa com poucas visitas na base: sem pontos')
  assert.equal(sinalObservado(q).sinal, 'sem_leitura')
  // janela curta demais para a base: base de 14 vendas em 14 dias (1/dia) e 1 dia de janela espera ~1 venda (< 3): sem percentual; com 7 dias, vale
  const u2 = serie(d => d < D ? 1 : 2)
  const p2 = { unidades: u2, receita: Object.fromEntries(Object.entries(u2).map(([d, n]) => [d, n * 50])), visitas: null, ads: null }
  const q2 = quadroAntesDepois({ serie: p2, data: D, ultimoCompleto: ULT, cob: { pedidos: todos } })
  assert.equal(q2.marcos[0].deltas.unidades.pct, null); assert.match(q2.marcos[0].deltas.unidades.motivo, /janela curta/)
  assert.equal(q2.marcos[3].deltas.unidades.pct, 100, '7 dias: percentual aparece')
}
// 2c) o gráfico não desenha dia não coletado como zero
{
  const alvo = { unidades: serie(() => 5), visitas: serie(() => 40), ads: null }
  const g = serieGrafico({ serie: alvo, data: D, ultimoCompleto: ULT, cob: { visitas: d => d !== addDias(D, 2), pedidos: todos } })
  assert.equal(g.visitas, null, 'buraco na série de visitas: sem série (cai para unidades)'); assert.equal(g.unidades.length, g.dias.length)
}

// 3) fases devidas: d1 só a partir de D+2; captura tardia registra o atraso; o que já existe não repete
{
  assert.deepEqual(fasesPendentes({ data: '2026-10-04', hoje: '2026-10-05' }), [])
  assert.deepEqual(fasesPendentes({ data: '2026-10-03', hoje: '2026-10-05' }).map(f => f.fase), ['d1'])
  assert.deepEqual(fasesPendentes({ data: '2026-10-01', hoje: '2026-10-05' }).map(f => f.fase), ['d1', 'd2', 'd3'])
  const tard = fasesPendentes({ data: '2026-09-25', hoje: '2026-10-05' })
  assert.equal(tard.length, 4); assert.equal(tard.find(f => f.fase === 'd1').atraso_dias, 8); assert.equal(tard.find(f => f.fase === 'd7').atraso_dias, 2)
  assert.deepEqual(fasesPendentes({ data: '2026-09-25', hoje: '2026-10-05', capturadas: ['d1', 'd2'] }).map(f => f.fase), ['d3', 'd7'])
  assert.equal(MARCOS.length, 4)
}

// 4) agregação de vários anúncios: visitas só se TODOS cobrem; Ads só dos coletados, declarado
{
  const mk = (cobV, ads) => ({ unidades: { [D]: 1 }, receita: { [D]: 10 }, visitas: { [D]: 5 }, ads, cob: { ...(cobV ? { visitas: cobV } : {}), ...(ads ? { ads: ['2026-06-01', ULT] } : {}) } })
  const zero = { prints: { [D]: 100 }, clicks: { [D]: 4 }, custo: { [D]: 2 }, receita: { [D]: 9 }, unidades: { [D]: 1 } }
  const series = new Map([['A', mk(['2026-06-01', ULT], zero)], ['B', mk(['2026-06-01', ULT], null)], ['C', mk(null, null)]])
  const ab = agregarAnuncios(series, ['A', 'B'], { de: '2026-06-01', ate: ULT })
  assert.ok(ab.visitas_ok); assert.equal(ab.serie.visitas[D], 10); assert.deepEqual(ab.ads_itens, { com: 1, total: 2 }); assert.equal(ab.serie.ads.prints[D], 100)
  const abc = agregarAnuncios(series, ['A', 'B', 'C'], { de: '2026-06-01', ate: ULT })
  assert.equal(abc.visitas_ok, false); assert.equal(abc.serie.visitas, null); assert.equal(abc.cob.visitas(D), false)
  assert.equal(abc.cob.pedidos('2026-05-01'), false, 'dia antes da cobertura de pedidos não é zero, é não coletado')
  assert.deepEqual(somarSeries([{ a: 1 }, { a: 2, b: 3 }]), { a: 3, b: 3 }); assert.equal(somarSeries([null, null]), null)
}

// 5) o que mudou NO anúncio (só com fotografia); capa comparada sem o sufixo de tamanho
{
  const antes = { titulo: 'Coleira G', preco: 59.9, fotos: 3, estoque: 10, status: 'active', frete_gratis: 0, tipo_anuncio: 'gold_special', logistica: 'cross_docking', thumb: 'https://http2.mlstatic.com/D_123-I.jpg' }
  const ms = mudancasNoAnuncio(antes, { ...antes, titulo: 'Coleira Gatos G Antipulgas', fotos: 7, thumb: 'https://http2.mlstatic.com/D_123-O.jpg' })
  assert.deepEqual(ms.map(x => x.campo), ['titulo', 'fotos']); assert.equal(ms[1].antes, 3); assert.equal(ms[1].agora, 7)
  assert.equal(mudancasNoAnuncio(null, antes), null, 'sem fotografia do antes não inventa diferença')
  assert.deepEqual(mudancasNoAnuncio(antes, antes), [])
}

// 6) micro gráfico: só números válidos, marcador no índice certo, sem NaN
{
  const alvo = { unidades: serie((d) => d > D ? 15 : 10), visitas: serie((d) => d > D ? 300 : 200), ads: null }
  const g = serieGrafico({ serie: alvo, data: D, ultimoCompleto: ULT })
  assert.equal(g.dias[g.n_antes], D); assert.equal(g.visitas.length, g.dias.length); assert.equal(g.base.visitas, 200); assert.equal(g.ads_clicks, null)
  const svg = microGrafico({ valores: g.visitas, marcadorIdx: g.n_antes, base: g.base.visitas, sinal: 'positivo', rotulo: 'Visitas <b>&"' })
  assert.match(svg, /^<svg /); assert.ok(!/NaN|undefined|Infinity/.test(svg)); assert.match(svg, /&lt;b&gt;&amp;&quot;/, 'título escapado'); assert.equal((svg.match(/<polyline/g) || []).length, 2)
  assert.equal(microGrafico({ valores: [1, 2] }), '', 'poucos pontos: sem gráfico'); assert.equal(microGrafico({ valores: [0, 0, 0, 0, 0] }).includes('NaN'), false)
  assert.deepEqual(mediaMovel([3, 3, 6]).map(x => Math.round(x * 10) / 10), [3, 3, 4])
  const fut = serieGrafico({ serie: alvo, data: addDias(ULT, 5), ultimoCompleto: ULT })
  assert.equal(fut.n_antes, fut.dias.length, 'tarefa de hoje: só o "antes" existe, o marcador cai fora e o gráfico não desenha "depois"')
  assert.equal(microGrafico({ valores: fut.visitas, marcadorIdx: fut.n_antes, base: fut.base.visitas }).includes('stroke-dasharray:2 2'), false)
  assert.equal(serieGrafico({ serie: alvo, data: addDias(ULT, 60), ultimoCompleto: addDias(ULT, -80) }), null, 'sem nenhum dia completo no período: sem série')
}

// 7) micro gráfico com EVENTOS (mudanças no anúncio): um <circle> por evento válido, rótulo escapado, assinatura antiga intacta, passa na allow-list da tela
{
  const svgSeguro = svg => typeof svg === 'string' && /^<svg class="micro" [^>]*>[\s\S]*<\/svg>$/.test(svg) && !/<script|<foreignObject|\son\w+\s*=|javascript:|<a[\s>]|<image|<use/i.test(svg)   // = src/web/acomp.js
  const v = [3, 4, 3, 4, 3, 5, 8, 9, 10]
  const com = microGrafico({ valores: v, marcadorIdx: 5, base: 3.5, sinal: 'positivo', rotulo: 'Visitas', eventos: [{ idx: 2, rotulo: 'Preço <b>"R$" & cia' }, { idx: 99, rotulo: 'fora' }, { idx: 'a', rotulo: 'x' }, { idx: -1, rotulo: 'y' }, null] })
  assert.equal((com.match(/<circle /g) || []).length, 1, 'só o índice válido vira ponto'); assert.match(com, /<title>Preço &lt;b&gt;&quot;R\$&quot; &amp; cia<\/title><\/circle>/)
  assert.ok(svgSeguro(com), 'a tela aceita o SVG com pontos'); assert.ok(!/NaN|undefined/.test(com))
  const sem = microGrafico({ valores: v, marcadorIdx: 5, base: 3.5, sinal: 'positivo', rotulo: 'Visitas' })
  assert.equal((sem.match(/<circle/g) || []).length, 0); assert.equal(sem, microGrafico({ valores: v, marcadorIdx: 5, base: 3.5, sinal: 'positivo', rotulo: 'Visitas', eventos: [] }), 'sem eventos = SVG de antes')
  // construirQuadro: eventos do histórico na janela do gráfico viram um ponto por DIA (rótulos juntos); fora da janela, nada
  const series = new Map([['A', { unidades: serie(() => 2), receita: serie(() => 100), visitas: serie(() => 40), ads: null, cob: { visitas: [addDias(D, -40), ULT] } }]])
  const evs = new Map([['A', [{ dia: addDias(D, 3), campo: 'preco', de: 50, para: 54, pct: 8, fonte: 'coleta' }, { dia: addDias(D, 3), campo: 'titulo', de: 'a', para: 'b', pct: null, fonte: 'coleta' }, { dia: '2020-01-01', campo: 'fotos', de: 3, para: 5, pct: null, fonte: 'coleta' }]]])
  const q = construirQuadro({ series, cobPedidos: { de: addDias(D, -40), ate: ULT }, ids: ['A'], data: D, ultimoCompleto: ULT, eventos: evs })
  assert.equal((q.grafico.svg.match(/<circle /g) || []).length, 1); assert.equal(q.grafico.eventos, 1)
  assert.match(q.grafico.svg, /23\/09 · Preço: R\$ 50,00 → R\$ 54,00; Título mudou/); assert.match(q.grafico.svg, /ponto = mudança no anúncio/)
  assert.doesNotMatch(construirQuadro({ series, cobPedidos: { de: addDias(D, -40), ate: ULT }, ids: ['A'], data: D, ultimoCompleto: ULT }).grafico.svg, /circle|ponto =/, 'sem histórico: gráfico de antes')
  assert.equal(rotuloEvento({ campo: 'estoque_zero', de: 5, para: 0 }), 'Estoque zerou'); assert.equal(rotuloEvento({ campo: 'preco_original', de: 80, para: null }), 'Preço "de": R$ 80,00 → removido')
  assert.equal(rotuloEvento({ campo: 'fotos', de: 3, para: 7, incerteza: 'mudou entre 02/10 e 05/10' }), 'Fotos: 3 → 7 (mudou entre 02/10 e 05/10)'); assert.equal(rotuloEvento({ campo: 'frete_gratis', de: 0, para: 1 }), 'Frete grátis ligado')
  // 7b) ESTADO (promoção, Ads, Full, estoque, pausa): rótulo próprio e marcador losango (<rect> girado) em vez do ponto; passa na allow-list; sem `estado`, o ponto de sempre
  assert.equal(rotuloEvento({ campo: 'promocao', de: 'nenhuma', para: 'SMART −15%' }), 'Promoção: entrou (SMART −15%)'); assert.equal(rotuloEvento({ campo: 'promocao', de: 'SMART −15%', para: 'nenhuma' }), 'Promoção: saiu (SMART −15%)')
  assert.equal(rotuloEvento({ campo: 'ads', de: 'active', para: 'sem_anuncio' }), 'Ads: anunciando → sem anúncio de Ads'); assert.equal(rotuloEvento({ campo: 'ads', de: 'hold', para: 'active' }), 'Ads: retido pelo ML → anunciando')
  const los = microGrafico({ valores: v, marcadorIdx: 5, base: 3.5, sinal: 'positivo', rotulo: 'Visitas', eventos: [{ idx: 2, rotulo: 'Promoção: entrou', estado: true }, { idx: 6, rotulo: 'Preço' }] })
  assert.equal((los.match(/<rect /g) || []).length, 1); assert.equal((los.match(/<circle /g) || []).length, 1); assert.match(los, /<rect [^>]*transform="rotate\(45 [\d.]+ [\d.]+\)"[^>]*><title>Promoção: entrou<\/title><\/rect>/)
  assert.ok(svgSeguro(los), 'a tela aceita o losango'); assert.ok(!/NaN|undefined/.test(los))
  const evE = new Map([['A', [{ dia: addDias(D, 2), campo: 'promocao', de: 'nenhuma', para: 'SMART −15%', pct: null, fonte: 'promo' }, { dia: addDias(D, 4), campo: 'logistica', de: 'xd_drop_off', para: 'drop_off', pct: null, fonte: 'coleta' }]]])
  const qe = construirQuadro({ series, cobPedidos: { de: addDias(D, -40), ate: ULT }, ids: ['A'], data: D, ultimoCompleto: ULT, eventos: evE })
  assert.equal((qe.grafico.svg.match(/<rect /g) || []).length, 1, 'promoção = losango'); assert.equal((qe.grafico.svg.match(/<circle /g) || []).length, 1, 'logística sem cruzar o Full = ponto comum'); assert.equal(qe.grafico.eventos, 2)
  assert.match(qe.grafico.svg, /22\/09 · Promoção: entrou \(SMART −15%\)/); assert.match(qe.grafico.svg, /losango = mudança de estado/)
}

// 8) "O que mudou no anúncio" COM DATA: a última mudança do campo depois da fotografia; estoque só quando cruza o zero; sem evento, a data fica null
{
  const antes = { titulo: 'Coleira G', preco: 53, fotos: 3, estoque: 10, status: 'active', frete_gratis: 0, tipo_anuncio: 'gold_special', logistica: 'cross_docking', thumb: 'x-I.jpg' }
  const eventos = [{ dia: '2026-10-01', campo: 'preco', de: 50, para: 53 }, { dia: '2026-10-04', campo: 'fotos', de: 3, para: 7, incerteza: 'mudou entre 02/10 e 04/10' }, { dia: '2026-10-05', campo: 'preco', de: 53, para: 57.24 }, { dia: '2026-10-06', campo: 'estoque_zero', de: 10, para: 0 }]
  const ms = mudancasNoAnuncio(antes, { ...antes, preco: 57.24, fotos: 7, estoque: 0, tipo_anuncio: 'gold_pro' }, { eventos, desde: '2026-10-02' })
  const por = Object.fromEntries(ms.map(m => [m.campo, m]))
  assert.equal(por.preco.em, '2026-10-05', 'a mudança de 01/10 é anterior à fotografia'); assert.equal(por.fotos.em, '2026-10-04'); assert.equal(por.fotos.incerteza, 'mudou entre 02/10 e 04/10')
  assert.equal(por.estoque.em, '2026-10-06'); assert.equal(por.tipo_anuncio.em, null, 'tipo de anúncio não tem histórico: sem data inventada')
  assert.equal(mudancasNoAnuncio(antes, { ...antes, estoque: 7 }, { eventos, desde: '2026-10-02' })[0].em, null, 'estoque 10 → 7 não cruzou o zero: o evento do zero não é dele')
  assert.equal(mudancasNoAnuncio(antes, { ...antes, preco: 57.24 }, { eventos, desde: '2026-10-05' })[0].em, null, 'a coleta do dia da fotografia já está no "antes"')
  assert.equal(mudancasNoAnuncio(antes, { ...antes, preco: 57.24 })[0].em, null, 'sem histórico: em = null')
}

// 9) VEREDITO do cartão: tabela estado × sinal × lançamento × andamento × preço (título, família, linha)
{
  const SINAIS = { positivo: { sinal: 'positivo', metrica: 'unidades', pct: 25, marco: '1 semana' }, negativo: { sinal: 'negativo', metrica: 'visitas', pct: -30, marco: 'hoje' }, estavel: { sinal: 'estavel', metrica: 'unidades', pct: 4, marco: '72h' }, sem_leitura: { sinal: 'sem_leitura', motivo: 'ainda sem marco completo para ler' } }
  const hojeOk = { estado: 'ok', rotulo: 'hoje', dias: 9, valores: { unidades: 3, receita: 219.22 }, deltas: { receita: { pct: 12 }, unidades: { pct: 41 }, visitas: { pct: -40 }, conversao: { pontos: 0.02 }, ticket: { pct: -2 } }, ajustado: { unidades: 37 } }
  const Q = { hoje: hojeOk, marcos: [], base: { valores: { unidades: 2 } } }
  const card = (medido, sinal = 'sem_leitura', extra = {}) => ({ medido, sinal: SINAIS[sinal], quadro: Q, precos: { eventos: [], tarefa_de_preco: false, confundidor: false, variacao_pct: null, historico: true }, itens: [], ...extra })
  const v = (...a) => vereditoCartao(card(...a))
  const TITULOS = {
    piorou: () => 'Caiu: visitas/dia −40% (ajustado pelo controle)',
    melhorou: () => 'Melhorou: vendas/dia +41% (ajustado pelo controle)',
    sem_efeito: s => ({ positivo: 'Variação dentro do ruído: vendas/dia +25% em 1 semana, mas os anúncios sem tarefa oscilaram igual', negativo: 'Variação dentro do ruído: visitas/dia −30% até ontem, mas os anúncios sem tarefa oscilaram igual' })[s] || 'Sem efeito distinguível do ruído',
    em_maturacao: s => `Em maturação, ${({ positivo: 'sinal inicial de alta', negativo: 'sinal inicial de queda', estavel: 'sem variação', sem_leitura: 'ainda sem marco completo' })[s]} · fecha em 15/10`,
    sem_base: s => `Sem base para medir (poucas vendas e visitas antes da tarefa) · observado: ${({ positivo: 'vendas/dia +25% em 1 semana', negativo: 'visitas/dia −30% até ontem', estavel: 'vendas/dia +4% em 72h', sem_leitura: 'ainda sem marco completo' })[s]}; sem controle não vira efeito`,
    sem_controle: s => TITULOS.sem_base(s).replace('poucas vendas e visitas antes da tarefa', 'sem grupo de controle'),
    variacao_conta: s => TITULOS.sem_base(s).replace('poucas vendas e visitas antes da tarefa', 'tarefa da conta inteira, sem anúncio'),
  }
  const MED = { piorou: { metrica_primaria: 'visitas', efeito_pct: -40.2 }, melhorou: { metrica_primaria: 'unidades', efeito_pct: 41.3 }, sem_efeito: { efeito_pct: 3 }, em_maturacao: { janelas: { pos: ['2026-09-30', '2026-10-14'] } }, sem_base: { causa: 'unidades' }, sem_controle: {}, variacao_conta: {} }
  const FAM = { piorou: 'piorou', melhorou: 'melhorou', sem_efeito: 'sem_efeito', em_maturacao: 'maturando', sem_base: 'sem_base', sem_controle: 'sem_base', variacao_conta: 'sem_base' }
  for (const estado of Object.keys(TITULOS)) for (const s of Object.keys(SINAIS)) {
    const r = v({ estado, ...MED[estado] }, s)
    assert.equal(r.titulo, TITULOS[estado](s), `${estado} × ${s}`); assert.equal(r.familia, FAM[estado], `${estado} × ${s}: família`)
    assert.equal(v({ estado, ...MED[estado], reversao_provavel: true }, s).titulo, TITULOS[estado](s) + ' · possível reversão à média', `${estado} × ${s}: reversão`)
  }
  assert.equal(v({ estado: 'em_maturacao', ...MED.em_maturacao }, 'sem_leitura', ).titulo, TITULOS.em_maturacao('sem_leitura'))
  assert.equal(vereditoCartao({ ...card({ estado: 'em_maturacao' }), sinal: { sinal: 'sem_leitura', motivo: 'base pequena demais para ler variação percentual' } }).titulo, 'Em maturação, base pequena para ler a variação', 'sem janela: sem "fecha em"')
  assert.equal(v({ estado: 'piorou', metrica_primaria: 'unidades', efeito_pct: null }).titulo, 'Caiu: vendas/dia (ajustado pelo controle)', 'sem efeito numérico não inventa número')
  // lançamento: vendeu × não vendeu (sem repetir a venda na linha)
  const lv = v({ estado: 'lancamento', dias_pos: 14, lancamento: { unidades: 12, receita: 640.4, vendeu: true, primeira_venda_dias: 3 } })
  assert.deepEqual([lv.familia, lv.titulo], ['lancou', 'Lançou e vendeu: 12 un (R$ 640) em 14 dias · 1ª venda no dia 3']); assert.doesNotMatch(lv.linha, /vendeu/)
  assert.equal(v({ estado: 'lancamento', dias_pos: 14, lancamento: { unidades: 0, receita: 0, vendeu: false, primeira_venda_dias: null } }).titulo, 'Lançou, ainda sem venda em 14 dias')
  // em andamento: data da fotografia do antes e base
  const and = vereditoCartao({ medido: { estado: 'em_andamento' }, sinal: { sinal: 'sem_leitura', motivo: 'tarefa ainda não concluída' }, quadro: { base: { valores: { unidades: 2.14 } }, marcos: [], hoje: null }, itens: [{ antes_fotografia: { capturado_em: '2026-10-06T12:00:00Z' } }, { antes_fotografia: null }], precos: { eventos: [], historico: false } })
  assert.deepEqual([and.familia, and.titulo, and.linha], ['andamento', 'Em andamento: antes fotografado em 06/10 · base 2,1 vendas/dia', 'preço: sem histórico neste período'])
  assert.equal(vereditoCartao({ medido: { estado: 'em_andamento' }, sinal: {}, quadro: { base: { valores: {} }, marcos: [], hoje: null }, itens: [] }).titulo, 'Em andamento: antes ainda não fotografado')
  // tarefa aberta: o cartão manda o evento de preço sem dia relativo (não há conclusão) → "em dd/mm", nunca "N dia(s) antes da conclusão"
  const andP = vereditoCartao({ medido: { estado: 'em_andamento' }, sinal: {}, quadro: { base: { valores: {} }, marcos: [], hoje: null }, itens: [], precos: { eventos: [{ dia: '2026-10-03', dia_rel: null, de: 50, para: 54, pct: 8 }], historico: true } })
  assert.equal(andP.linha, 'preço subiu 8% em 03/10 (pode ter interferido)')
  assert.deepEqual(ORDEM_FAMILIA, ['piorou', 'melhorou', 'lancou', 'sem_efeito', 'maturando', 'andamento', 'sem_base'])
  // linha: só os segmentos com dado, na ordem vendas · faturamento · vendas/dia · visitas · conversão · ticket · preço · controle
  assert.equal(v({ estado: 'melhorou', ...MED.melhorou }).linha, 'vendeu 27 un (R$ 1.973) em 9 dias · faturamento/dia +12% · vendas/dia +41% · visitas/dia −40% · conversão estável · preço inalterado · descontado o controle: +37%')
  const Q2 = { hoje: { ...hojeOk, valores: { unidades: 0, receita: 0 }, dias: 7, deltas: { unidades: { pct: 20 }, receita: { pct: -5 }, conversao: { pontos: 0.84 } }, ajustado: {} }, marcos: [], base: { valores: {} } }
  assert.equal(vereditoCartao({ ...card({ estado: 'sem_efeito' }), quadro: Q2 }).linha, 'sem venda nos 7 dias · faturamento/dia −5% · vendas/dia +20% · conversão +0,8 p.p. · ticket caiu: vende mais e fatura menos (preço/promoção) · preço inalterado')
  assert.equal(vereditoCartao({ ...card({ estado: 'sem_efeito' }), quadro: { ...Q2, hoje: { ...Q2.hoje, deltas: { ticket: { pct: 6 } } } } }).linha, 'sem venda nos 7 dias · ticket +6% · preço inalterado')
  assert.equal(vereditoCartao({ ...card({ estado: 'em_maturacao' }), quadro: { hoje: { estado: 'aguardando' }, marcos: [{ estado: 'aguardando' }], base: { valores: {} } } }).linha, 'preço inalterado', 'sem marco completo: só o preço')
  // preço: evento que não é da tarefa, a própria tarefa, dia antes da conclusão, data incerta, preço pago, sem histórico
  const P = (precos, med = { estado: 'melhorou', ...MED.melhorou }) => vereditoCartao({ ...card(med), quadro: { hoje: null, marcos: [], base: { valores: {} } }, precos: { eventos: [], historico: true, ...precos } }).linha
  assert.equal(P({ eventos: [{ dia: '2026-09-23', dia_rel: 3, de: 50, para: 54, pct: 8 }] }), 'preço subiu 8% no dia 3 (pode ter interferido)')
  assert.equal(P({ tarefa_de_preco: true, eventos: [{ dia: '2026-09-20', dia_rel: 0, de: 50, para: 44, pct: -12 }] }), 'preço −12% no dia 0 (a própria tarefa)')
  assert.equal(P({ eventos: [{ dia: '2026-09-18', dia_rel: -2, de: 50, para: 49.99, pct: -0.02 }, { dia: '2026-09-25', dia_rel: 5, de: 49.99, para: 47, pct: -5.98 }] }), 'preço caiu 6% no dia 5 (pode ter interferido) (+1 outra(s))', 'o maior evento; 1 centavo também conta')
  assert.equal(P({ eventos: [{ dia: '2026-09-18', dia_rel: -2, de: 50, para: 49.99, pct: -0.02 }] }), 'preço caiu R$ 0,01 2 dia(s) antes da conclusão (pode ter interferido)', 'centavos aparecem em reais, não como 0%')
  assert.equal(P({ eventos: [{ dia: '2026-09-22', dia_rel: 2, de: 50, para: 50.4, pct: 0.8 }] }), 'preço subiu 0,8% no dia 2 (pode ter interferido)')
  assert.equal(P({ eventos: [{ dia: '2026-09-25', dia_rel: 5, de: 50, para: 55, pct: 10, incerteza: 'mudou entre 21/09 e 25/09' }] }), 'preço subiu 10% mudou entre 21/09 e 25/09 (pode ter interferido)')
  assert.equal(P({ confundidor: true, variacao_pct: 9.2 }), 'preço pago variou +9% na janela (pode ter interferido)')
  assert.equal(P({ historico: false }), 'preço: sem histórico neste período'); assert.equal(P({}), 'preço inalterado')
  assert.equal(vereditoCartao({ medido: { estado: 'melhorou' }, sinal: {}, quadro: null }).linha, '', 'sem quadro nem preço: linha vazia (nada inventado)')
  // ESTADO na janela (promoção, Ads, Full, estoque, pausa): um segmento por evento, depois do preço; "a própria tarefa" nos campos de intervenção;
  // sem evento, nada (as linhas acima provam que o cartão sem `estado` não muda)
  const E = (estado, med = { estado: 'melhorou', ...MED.melhorou }) => vereditoCartao({ ...card(med), quadro: { hoje: null, marcos: [], base: { valores: {} } }, precos: { eventos: [], historico: true }, estado: { eventos: [], intervencao: [], confundidor: false, ...estado } }).linha
  assert.equal(E({ eventos: [{ dia: '2026-09-23', dia_rel: 3, campo: 'promocao', de: 'nenhuma', para: 'SMART −15%' }], confundidor: true }), 'preço inalterado · entrou em promoção no dia 3 (pode ter interferido)')
  assert.equal(E({ eventos: [{ dia: '2026-09-20', dia_rel: 0, campo: 'ads', de: 'paused', para: 'active' }], intervencao: ['ads'] }), 'preço inalterado · Ads ligado no dia 0 (a própria tarefa)')
  assert.equal(E({ eventos: [{ dia: '2026-09-18', dia_rel: -2, campo: 'logistica', de: 'xd_drop_off', para: 'fulfillment' }, { dia: '2026-09-24', dia_rel: 4, campo: 'status', de: 'active', para: 'paused' }] }), 'preço inalterado · foi para o Full 2 dia(s) antes da conclusão (pode ter interferido) · anúncio pausado no dia 4 (pode ter interferido)')
  assert.equal(E({ eventos: [{ dia: '2026-09-25', dia_rel: null, campo: 'estoque_zero', de: 5, para: 0 }] }), 'preço inalterado · estoque zerou em 25/09 (pode ter interferido)', 'tarefa aberta: sem dia relativo')
  assert.equal(E({ eventos: [{ dia: '2026-09-26', dia_rel: 6, campo: 'promocao', de: 'SMART −15%', para: 'nenhuma', incerteza: 'mudou entre 24/09 e 26/09' }] }), 'preço inalterado · saiu da promoção mudou entre 24/09 e 26/09 (pode ter interferido)')
  const cinco = Array.from({ length: 5 }, (_, i) => ({ dia: addDias(D, i + 1), dia_rel: i + 1, campo: 'ads', de: i % 2 ? 'active' : 'paused', para: i % 2 ? 'paused' : 'active' }))
  assert.equal(E({ eventos: cinco }), 'preço inalterado · Ads ligado no dia 1 (pode ter interferido) · Ads desligado no dia 2 (pode ter interferido) · Ads ligado no dia 3 (pode ter interferido) (+2 outro(s) evento(s))')
  assert.equal(E({}), 'preço inalterado', 'sem evento de estado: nenhum segmento')
}
console.log('teste-acompanhamento: OK')
