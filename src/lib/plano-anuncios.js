// Plano de ação POR ANÚNCIO: diagnóstico → regras → ações priorizadas → previsão por hipótese → persistência.
// Cada ação responde: O QUE, ONDE (link do anúncio), POR QUÊ (evidência com número), IMPACTO (R$ estimado como
// HIPÓTESE), COMO (passos), QUAL MÉTRICA (baseline → meta) e QUAL RESULTADO ESPERADO (cenários com probabilidade).
// Nada é executado: o plano só propõe; mexer em preço, Ads ou estoque é sempre decisão humana.
import { db, agora, hojeLocal } from './db.js'
import { carregarClientes, normNome } from './equipe.js'
import { idAcao } from './plano-cliente.js'
import { prioridadeAcao, CLASSES_P } from './motor-ppc.js'
import { addDias, diasEntre, cfgAtrib } from './meli-serie.js'
import { algoritmo, diagnosticarConta, sugestaoFull, hipotesesUrgenciaOculta, descontoMaximoPct, custosDoCliente, margemPct, pctTxt } from './diagnostico-conta.js'
import { priorEfetivo } from './calibracao.js'
import { retroalimentar, cfgRetro, ajustarNota } from './retroalimentacao.js'
import { roteiro, ordemDoTipo, duplicacao as PBDUP } from './processos.js'
import { melhorProfissional } from './melhor-profissional.js'
import { origemCatalogo } from './catalogo.js'
import { CATALOGO, TEXTO_CATALOGO, regraBloqueada } from './catalogo-cfg.js'
import { ehChaveS90 } from './s90-chave.js'
import { classificarCaminho } from './chaveiro.js'
import { syncParaPlano } from './chaveiro-estoque-real.js'
import { lerSaude, CFG_SAUDE } from './saude-coleta.js'
import { emRuptura, riscoRuptura } from './lead-time.js'
import { alinhamentosReal } from './alinhamentos-real.js'
import { representaEstoque, representaProduto, estoqueDe, produtoLigado, envioDoProprio, coberturaProjetada, alocarEstoque } from './produto-estoque.js'

const L = algoritmo.limiares, F = algoritmo.foco, P = algoritmo.priors_efeito
const r1 = n => Math.round(n * 10) / 10, r2 = n => Math.round(n * 100) / 100
const brl = n => 'R$ ' + Math.round(n).toLocaleString('pt-BR')
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const curto = (t, n = 48) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n)
const dm = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const virg = n => String(n).replace('.', ',')
const reais = n => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fr0 = arr => arr.map(x => Math.round(x * 100) + '%').join(' / ')     // "20% / 40% / 60%" (frações conservador/base/otimista de um prior)
// mudanças do preço de lista do anúncio no período, para citar como histórico: "R$ 50,00 → R$ 55,00 em 03/10 (+10%)" (as 4 últimas; repricer muda todo dia)
// de onde vem o custo do anúncio (vínculo custo ↔ anúncio, custos-db): citado na evidência sempre que o custo entra numa conta de margem
const ROT_CUSTO = { manual: 'vínculo manual', sku: 'SKU igual', sku_normalizado: 'SKU normalizado', grupo: 'herdado do mesmo produto' }
const custoTxt = i => `custo do anúncio ${reais(i.custo_unitario)} (${ROT_CUSTO[i.custo_origem] || i.custo_origem || 'vínculo'})`
const historicoPreco = i => { const l = i.mudancas_preco_28d || []; return (l.length > 4 ? `${l.length - 4} mudança(s) anterior(es); ` : '') + l.slice(-4).map(e => `${reais(e.de)} → ${e.para == null ? '—' : reais(e.para)} ${e.incerteza ? `(${e.incerteza})` : 'em ' + dm(e.dia)}${e.pct != null ? ` (${e.pct > 0 ? '+' : ''}${virg(e.pct)}%)` : ''}`).join('; ') }

// ── previsão por hipótese: cenários × probabilidade ─────────────────────────
export function previsao({ regra, tipo = 'ganho', formula, premissas, valores, preco, prior, horizonte = 28 }) {
  // valores = { conservador, base, otimista } em UNIDADES no horizonte (ou R$ se tipo === 'risco_evitado')
  const em = k => tipo === 'risco_evitado' ? valores[k] : valores[k] * (preco || 0)
  const cen = k => ({ unidades: tipo === 'risco_evitado' ? null : r1(valores[k]), receita: r2(em(k)) })
  const c = { conservador: cen('conservador'), base: cen('base'), otimista: cen('otimista') }
  return {
    tipo, hipotese: true, formula, premissas, horizonte_dias: horizonte, cenarios: c,
    p_sucesso: r2(prior.p), p_fonte: prior.fonte, p_n: prior.n || 0,
    valor_esperado: r2(prior.p * c.base.receita),                   // base ponderada pela probabilidade
    esperado: { conservador: r2(prior.p * c.conservador.receita), base: r2(prior.p * c.base.receita), otimista: r2(c.otimista.receita) },
    aviso: 'Cenário a partir de premissas declaradas — não é promessa de resultado.',
  }
}

// gatilho de duplicação que nasce de DADO (G4 > G2 > G1); G3 e G5 exigem a pesquisa do consultor e ficam de fora
function gatilhoDuplicacao(i, bench, hoje) {
  if (i.curva === 'A' && i.r0 > 0 && i.r <= i.r0 * 0.8 && (!(i.v0 > 0) || i.v <= i.v0 * 0.9))
    return { g: 'G4', objetivo: 'recuperacao', evidencia: `curva A com receita ${brl(i.r)} contra ${brl(i.r0)} no período anterior (${r1(100 * (i.r / i.r0 - 1))}%)${i.v0 > 0 ? ` e visitas ${i.v} contra ${i.v0}` : ''}.` }
  if (bench && i.conv != null && i.v >= F.min_visitas_item && (i.u >= 1 || i.v >= 300) && i.conv < bench * (1 - L.ima_gap_conversao_pct / 100))
    return { g: 'G2', objetivo: 'teste_ab', evidencia: `${i.v} visitas em 28 dias com conversão ${pctTxt(i.conv)}% contra ${pctTxt(bench)}% da conta (${i.u} un) — potencial travado.` }
  if (i.criado_em && diasEntre(i.criado_em, hoje) <= 30 && i.u >= 1)
    return { g: 'G1', objetivo: 'teste_ab', evidencia: `anúncio criado há ${diasEntre(i.criado_em, hoje)} dia(s) (${i.criado_em}) com ${i.u} venda(s): produto novo entra com ao menos 2 anúncios.` }
  return null
}

// ── regras ─────────────────────────────────────────────────────────────────
// cada regra devolve 0..n "specs"; o construtor comum calcula prioridade, prazo, responsável e persiste
function regras(diag, ctx) {
  const out = [], it = diag.itens, bench = diag.benchmark?.conv, ads = diag.ads, eco = diag.economia
  const gmv = diag.resumo.gmv
  const rel = i => i.r >= gmv * F.min_impacto_pct_gmv / 100 || i.curva !== 'C'          // foco: só o que move dinheiro
  const roasConta = ads.roas
  // regra de preço: vendas/dia antes × DEPOIS da data da alta, no anúncio e no controle (anúncios SEM mudança de preço registrada nos 28 dias, nas
  // mesmas datas) — se o controle também caiu, o preço não explica a queda
  const limPreco = cfgAtrib.preco?.limiar_confundidor_pct ?? 3
  const somaU = (s, de, ate) => Object.entries(s || {}).reduce((t, [d, n]) => d >= de && d <= ate ? t + n : t, 0)
  // percentuais da conta (comissão, imposto, frete…): a margem por anúncio usa o custo do próprio anúncio no lugar do CMV% quando ele existe
  const cc = diag.custos ?? (diag.custos_informados ? custosDoCliente(diag.cliente) : null)
  // V3 F4: financeiro MEDIDO nos pedidos (i.financeiro / i.economia_real, que carregarBase só anexa com a chave) entra aqui SÓ com financeiro.margem_medida_nas_regras
  // ligada — nasce false e, com ela false, nenhuma regra muda (o plano sai idêntico). medida(i) = agregado do anúncio com margem (custo informado e cobertura ≥ mínimo)
  const MED = algoritmo.financeiro?.margem_medida_nas_regras === true
  const ecoReal = i => (MED ? i.economia_real || null : null), medida = i => (MED && i.financeiro?.margem_pct != null ? i.financeiro : null)
  // cobertura da série de pedidos (diagnostico-conta → data_quality.cobertura.pedidos, a mesma fonte que anula resumo.variacao): dia sem coleta não é zero.
  // Dia sem coleta ou truncado em QUALQUER das duas janelas → as regras de queda (28 d × 28 d e a do preço) não afirmam FATO; na janela atual → sem TACOS do anúncio
  const cobP = diag.data_quality?.cobertura?.pedidos, janelasIncompletas = !!(cobP?.lacunas?.length || cobP?.truncados)
  const semColAtual = (cobP?.lacunas || []).filter(d => d >= diag.periodo?.de && d <= diag.periodo?.ate).length
  // série de VISITAS do anúncio: a cobertura (série desde o início da janela e coletada até a véspera do fim) é decidida UMA vez, na origem (visitasCobrem →
  // visOk em carregarBase): conversão, benchmark e controle (visitas_sem_mudanca, só anúncios visOk) já saem sem o anúncio parado
  const semMud = i => !(i.mudancas_28d || []).length
  const tira = (c, l) => l.reduce((o, x) => ({ n: o.n - 1, u: o.u - x.u, v: o.v - x.v, u0: o.u0 - x.u0, v0: o.v0 - x.v0 }), c)
  const ctrlVis = diag.visitas_sem_mudanca

  for (const i of it) {
    if (!rel(i)) continue
    const nome = curto(i.titulo)
    // catálogo (config/algoritmo.json → catalogo): 'terceiros' não tem como alterar foto/título/descrição/ficha; 'proprio' só por sugestão de correção, com revisão do ML
    const org = origemCatalogo(i), TX = TEXTO_CATALOGO[org]

    // 1) ÍMÃ: vende e tem tráfego, mas converte abaixo do benchmark da conta
    if (bench && i.conv != null && i.v >= F.min_visitas_item && i.u >= F.min_unidades_item && i.conv < bench * (1 - L.ima_gap_conversao_pct / 100)) {
      const gapPp = bench - i.conv
      const sinais = []
      if (i.ptw?.preco_para_ganhar != null && i.preco != null && i.ptw.preco_para_ganhar < i.preco - 0.01) sinais.push({ causa: 'PREÇO/OFERTA', texto: `preço R$ ${i.preco.toFixed(2)} acima do preço para ganhar no catálogo (R$ ${i.ptw.preco_para_ganhar.toFixed(2)})` })
      if (!i.frete_gratis) sinais.push({ causa: 'ENTREGA', texto: 'sem frete grátis' })
      if (i.fotos != null && i.fotos < L.fotos_minimas && org !== 'terceiros') sinais.push({ causa: 'CONTEÚDO', texto: `só ${i.fotos} foto(s)` })               // catálogo de terceiros: foto não é do vendedor
      if (i.avaliacoes?.nota != null && i.avaliacoes.nota < L.nota_minima_avaliacao && org !== 'terceiros') sinais.push({ causa: 'CONFIANÇA', texto: `nota ${i.avaliacoes.nota} (${i.avaliacoes.total} avaliações)` })     // a nota é do produto do catálogo
      if ((i.cobertura_anuncio ?? i.cobertura) != null && (i.cobertura_anuncio ?? i.cobertura) <= 2) sinais.push({ causa: 'DISPONIBILIDADE', texto: `estoque para ${i.cobertura_anuncio ?? i.cobertura} dia(s)` })   // F3: o que o COMPRADOR vê é o número do anúncio
      const principal = sinais[0]?.causa || 'CONTEÚDO/TÍTULO (sem sinal objetivo — testar)'
      if (!(org === 'terceiros' && !sinais.length)) {          // catálogo de terceiros sem sinal editável (preço, entrega, disponibilidade): a ação não nasce
      const passoSinal = s => s.causa === 'CONTEÚDO' && org === 'proprio' ? `${TX} (${s.texto})` : `Tratar ${s.causa.toLowerCase()}: ${s.texto}`
      const pr = priorEfetivo('ima_conversao'), f = P.ima_conversao.fracao_gap
      const un = fr => i.v * (gapPp / 100) * fr
      out.push({ regra: 'ima_conversao', item: i, urgencia: 3, esforco: 3, causal: sinais.length ? 70 : 45, evidencia_tipo: 'fato',
        titulo: `Quebrar objeções de conversão: ${nome}`,
        problema: `Vende e tem tráfego, mas converte ${pctTxt(i.conv)}% contra ${pctTxt(bench)}% da própria conta — falta fechar ${pctTxt(gapPp)} pontos`,
        evidencia: `${i.u} un e ${i.v} visitas em 28 dias → conversão ${pctTxt(i.conv)}%; referência da conta ${pctTxt(bench)}% (${diag.benchmark.regra}). Sinais no anúncio: ${sinais.map(s => s.texto).join('; ') || 'nenhum objetivo'}.`,
        hipotese: `A objeção provável é ${principal}. ${sinais.length ? 'Os sinais acima são fatos do anúncio; a ligação com a conversão é HIPÓTESE a testar.' : 'Sem sinal objetivo: o teste define se é conteúdo, oferta ou confiança.'}`,
        como: [...(i.curva === 'A' && org === 'nao' ? ['Anúncio curva A é a missão principal da conta: prefira testar a mudança numa DUPLICATA (ver a ação de Duplicação estratégica) e manter o original intacto'] : []), ...(org === 'terceiros' ? [] : ['Abrir o anúncio como comprador (link) e listar as 3 dúvidas que ele teria antes de comprar']), ...sinais.map(passoSinal), ...(org === 'terceiros' ? [TX] : []), 'Registrar a mudança (data, o que mudou) no card e esperar 14 dias para medir', 'Conferir conversão do anúncio no mesmo período equivalente'],
        indicador: `conversão ${pctTxt(i.conv)}%`, meta: `conversão ≥ ${pctTxt(i.conv + gapPp * f[1])}% em 14 dias (fecha ~${Math.round(f[1] * 100)}% do gap)`, aceite: 'Mudança registrada com data e conversão comparada no mesmo período',
        prev: previsao({ regra: 'ima_conversao', formula: 'unidades extras = visitas × gap de conversão × fração do gap fechada', premissas: [`visitas 28d = ${i.v}`, `gap = ${pctTxt(gapPp)} p.p. até o benchmark da conta`, `fração do gap fechada: ${f.map(x => Math.round(x * 100) + '%').join(' / ')} (conservador/base/otimista)`, 'preço atual do anúncio'], valores: { conservador: un(f[0]), base: un(f[1]), otimista: un(f[2]) }, preco: i.preco, prior: pr }),
        demanda: 'Otimizar Anúncios', dimensao: 'Conversão e oferta' })
      }
    }

    // 1b) DUPLICAÇÃO ESTRATÉGICA (treinamento Place2u): a duplicata absorve o teste e o ORIGINAL não é tocado. Gatilhos que nascem de dado: G4 (curva A com queda de
    // relevância), G2 (potencial travado: visita sem conversão) e G1 (produto novo). G3 (multi-nicho) e G5 (kit/combo) dependem da pesquisa do consultor e NÃO nascem aqui.
    const gat = gatilhoDuplicacao(i, bench, diag.hoje)
    // V3 F5 (só com produto.diagnostico_ligado): a duplicata vende do MESMO estoque do produto — estoque físico de referência (EF) do original em ruptura = a ação não nasce
    // (Manual 5.2: disponibilidade antes de duplicar; conta em omitidas.estoque_nao_comporta); sem a chave, i.produto não existe e nada muda
    const dupSemEstoque = gat && produtoLigado(i) && emRuptura(i, L)
    if (dupSemEstoque && !regraBloqueada('duplicacao_estrategica', org)) ctx.omitir?.('estoque_nao_comporta')
    if (gat && !dupSemEstoque && !regraBloqueada('duplicacao_estrategica', org)) {          // a casa não duplica catálogo (config/prompt-estrategista.md): nem de terceiros nem próprio
      const pr = priorEfetivo('duplicacao_estrategica'), Pd = P.duplicacao_estrategica
      const tipo = PBDUP.tipos.find(t => t.id === gat.objetivo), g = PBDUP.gatilhos.find(x => x.id === gat.g)
      let valores, premissas, formula
      if (gat.g === 'G4') { const perdido = Math.max(1, i.u0 - i.u); valores = { conservador: perdido * Pd.recuperacao_pct[0] / 100, base: perdido * Pd.recuperacao_pct[1] / 100, otimista: perdido * Pd.recuperacao_pct[2] / 100 }; premissas = [`vendas ${i.u} contra ${i.u0} no período anterior (perdido ≈ ${perdido} un)`, `recuperação ${Pd.recuperacao_pct.join('% / ')}% do perdido (premissa)`]; formula = 'unidades recuperadas = vendas perdidas × fração recuperada pela duplicata' }
      else if (gat.g === 'G2') { const gapPp = Math.max(0, bench - i.conv); valores = { conservador: i.v * gapPp / 100 * Pd.fracao_gap[0], base: i.v * gapPp / 100 * Pd.fracao_gap[1], otimista: i.v * gapPp / 100 * Pd.fracao_gap[2] }; premissas = [`visitas 28d = ${i.v}`, `gap de conversão = ${pctTxt(gapPp)} p.p. até a média da conta`, `fração do gap capturada pela duplicata: ${Pd.fracao_gap.map(x => Math.round(x * 100) + '%').join(' / ')} (premissa)`]; formula = 'unidades extras = visitas × gap de conversão × fração capturada pela duplicata' }
      else { valores = { conservador: i.u * Pd.ganho_novo_pct[0] / 100, base: i.u * Pd.ganho_novo_pct[1] / 100, otimista: i.u * Pd.ganho_novo_pct[2] / 100 }; premissas = [`vendas 28d = ${i.u}`, `ganho de ${Pd.ganho_novo_pct.join('% / ')}% sobre as vendas atuais (premissa)`]; formula = 'unidades extras = vendas atuais × ganho de uma 2ª abordagem' }
      // V3 F5: cobertura projetada com a duplicata vendendo o previsto (extra = base ÷ 28 por dia), teto da previsão (ganho que não cabe no estoque não é ganho) e a divisão
      // sugerida caso o ML crie estoque separado (duplicata com título/capa novos nasce num UP novo: Σ = físico; Full fora). Só com o produto ligado.
      let estDup = null
      if (produtoLigado(i)) {
        const E = estoqueDe(i), extra = valores.base / 28, lead = i.lead_time_dias ?? L.lead_time_reposicao_dias, seg = L.estoque_seguranca_dias
        const cobPos = coberturaProjetada(E.estoque, E.vel, extra), teto = E.estoque == null ? null : Math.max(0, E.estoque - (E.vel || 0) * 28)
        if (teto != null) for (const k of ['conservador', 'base', 'otimista']) valores[k] = Math.min(valores[k], teto)
        const props = (i.produto.efs || []).filter(e => e.local === 'proprio'), declarado = i.produto.modo_proprio === 'declarado'
        const F = props.length && props.every(e => e.estoque != null) ? props.reduce((t, e) => t + e.estoque, 0) : null
        const div = F != null ? alocarEstoque(F, [...props.map(e => ({ chave: e.chave, v: e.vel })), { chave: 'zz:duplicata', v: extra }]) : null
        estDup = { estoque: E.estoque, cobertura: E.cobertura, cobertura_pos: cobPos, extra_dia: r2(extra), repor_junto: cobPos != null && cobPos < lead + seg, teto_unidades: teto == null ? null : r1(teto),
          fisico: F, fisico_fonte: F == null ? null : declarado ? 'declarado' : 'ml', divisao: div ? div.map(x => x.quantidade) : null,
          quantidade_proposta: { mesmo_up: props.length === 1 ? props[0].estoque ?? null : null, up_novo: div ? div.find(x => x.chave === 'zz:duplicata').quantidade : null }, outros_proprios: F }
        premissas = [...premissas, 'estoque compartilhado: a duplicata não soma estoque — vende do mesmo estoque do produto', ...(teto != null && teto < valores.otimista + 1e-9 ? [`ganho limitado ao que cabe no estoque (${r1(teto)} un além do ritmo atual)`] : [])]
      }
      out.push({ regra: 'duplicacao_estrategica', item: i, objetivo_dup: gat.objetivo, gatilho: gat.g, urgencia: gat.g === 'G4' ? 3 : 2, esforco: 3, causal: 45, evidencia_tipo: 'hipotese', papel: 'consultor+analista',
        titulo: `Duplicação estratégica (${tipo.nome.toLowerCase()}): ${nome}`,
        problema: `${g.nome}: ${g.descricao}`,
        // o consultor decide a variação de preço da duplicata sabendo o que o preço do original já fez
        evidencia: gat.evidencia + (historicoPreco(i) ? ` Histórico de preço do original (28 dias): ${historicoPreco(i)}.` : '') + (estDup && estDup.estoque != null ? ` A duplicata vende do mesmo estoque do produto: hoje ${estDup.estoque} un para ~${estDup.cobertura ?? '—'} dias; com a duplicata vendendo o previsto, ~${estDup.cobertura_pos ?? '—'} dias.${estDup.divisao ? ` Se o ML criar estoque separado, divisão sugerida: ${estDup.divisao.join(' / ')}.` : ''}` : ''),
        hipotese: 'Uma nova versão com variação deliberada (título, capa, categoria ou preço) amplia o alcance e testa a hipótese sem arriscar o histórico do original — HIPÓTESE; o teste é medir a família (original + duplicata) contra o grupo de controle.',
        como: ['Consultor: confirmar o objetivo e o volume e entregar o plano ao analista no plano de conta — ' + tipo.volume.texto + '; sem briefing do consultor não se duplica',
          'Analista: duplicar pelo roteiro do canal e variar DE VERDADE (título e palavras-chave, capa, categoria e/ou preço — mudar só a descrição não vale)',
          'Manter o anúncio original INTACTO: a duplicata absorve o teste',
          'Alinhar as palavras-chave ao nicho da duplicata e registrar no card a hipótese testada',
          'Monitorar por 14 dias e reportar ao consultor: escalar o que converte, pausar a duplicata que não converte', ...(estDup?.repor_junto ? ['Programar a reposição junto: com a duplicata vendendo, o estoque do produto não cobre o prazo de reposição'] : [])],
        indicador: `${i.u} un/28d${i.conv != null ? `, conversão ${pctTxt(i.conv)}%` : ''}`, meta: `família (original + duplicata) com vendas ≥ ${Math.max(i.u, i.u0)} un/28d sem o original perder mais de 10%`, aceite: 'Duplicata publicada com variação real, objetivo e volume definidos pelo consultor, original intacto e leitura de 14 dias registrada',
        prev: previsao({ regra: 'duplicacao_estrategica', formula, premissas: [...premissas, 'ganho da FAMÍLIA, descontando canibalização do original (não medida na previsão)'], valores, preco: i.preco, prior: pr }),
        demanda: 'Duplicar anúncios', dimensao: 'Demanda e visibilidade', ...(estDup ? { dados_extra: { estoque_duplicata: estDup } } : {}) })
    }

    // 2) CATÁLOGO: perdeu a caixa de compra ou preço acima do preço para ganhar
    const gapPtw = i.ptw?.preco_para_ganhar != null && i.preco != null ? i.preco - i.ptw.preco_para_ganhar : null
    if (i.catalogo && (i.buy_box === false || (gapPtw != null && gapPtw > 0.01)) && i.r > 0 && i.r >= gmv * 0.01) {     // i.r > 0: com GMV 0, "0 ≥ 0" passava sem venda
      const pr = priorEfetivo('catalogo_buybox'), f = P.catalogo_buybox.fracao_gap
      const perdido = Math.max(0, i.u0 - i.u), base = Math.max(perdido, i.u * 0.1)
      out.push({ regra: 'catalogo_buybox', item: i, urgencia: 4, esforco: 2, causal: gapPtw != null ? 75 : 55, evidencia_tipo: 'fato',
        titulo: `Recuperar a caixa de compra: ${nome}`,
        problema: `Anúncio de catálogo ${i.buy_box === false ? 'sem a caixa de compra' : 'acima do preço para ganhar'} — ${pctTxt(i.share_pct)}% do GMV da conta`,
        evidencia: `${i.buy_box === false ? 'buy box perdida' : 'buy box não confirmada'}${gapPtw != null ? `; seu preço R$ ${i.preco.toFixed(2)} vs preço para ganhar R$ ${i.ptw.preco_para_ganhar.toFixed(2)} (diferença R$ ${gapPtw.toFixed(2)})` : ''}; ${i.u} un em 28 dias vs ${i.u0} no período anterior.`,
        hipotese: 'A diferença de preço/condição (frete, Full, parcelamento) explica parte da perda de exposição no catálogo — HIPÓTESE; o teste é igualar a condição e medir vendas.',
        como: ['Abrir o produto de catálogo e comparar sua oferta com a vencedora (preço, frete, Full, parcelamento)', gapPtw != null ? `Avaliar chegar a R$ ${i.ptw.preco_para_ganhar.toFixed(2)} SOMENTE se a margem permitir (custos ${diag.custos_informados ? 'informados' : 'ainda não informados'})` : 'Avaliar ajuste de preço/condição conforme a margem', 'Registrar a mudança e medir vendas em 14 dias'],
        indicador: `${i.u} un/28d, buy box ${i.buy_box === false ? 'perdida' : 'não confirmada'}`, meta: `buy box recuperada e vendas ≥ ${Math.max(i.u, i.u0)} un/28d`, aceite: 'Condição ajustada com margem validada e buy box conferida',
        prev: previsao({ regra: 'catalogo_buybox', formula: 'unidades recuperadas = fração da queda de vendas (ou 10% do ritmo atual) recuperada com a caixa de compra', premissas: [`vendas ${i.u} vs ${i.u0} no período anterior`, `fração recuperada: ${f.map(x => Math.round(x * 100) + '%').join(' / ')}`], valores: { conservador: base * f[0], base: base * f[1] * 2, otimista: base * f[2] * 2 }, preco: i.preco, prior: pr }),
        demanda: 'Corrigir Anúncios', dimensao: 'Conversão e oferta' })
    }

    // 3) RUPTURA: cobertura menor que o prazo de reposição em anúncio relevante (predicado ÚNICO emRuptura, lead-time.js: corte crítico ou prazo informado, e sempre
    // abaixo do prazo — reposição que chega antes de zerar fica no ciclo, nunca «antes de zerar» com risco R$ 0)
    // V3 F3 (com a chave produto.diagnostico_ligado): UMA ação por ESTOQUE FÍSICO — só o anúncio representante do EF (representaEstoque), com o estoque contado 1× e a
    // demanda somada dos irmãos (estoqueDe); receita em risco = a do EF inteiro (riscoRuptura). EF Full com estoque próprio do mesmo produto → causa enviar_full (nunca «comprar»).
    const E = estoqueDe(i), multi = E.n > 1, efFull = produtoLigado(i) && i.produto.local === 'full'
    if (emRuptura(i, L) && (i.curva !== 'C') && E.u >= F.min_unidades_item && representaEstoque(i)) {
      const pr = priorEfetivo('estoque_ruptura')
      // prazo de reposição do anúncio (v1.6.0): o informado pelo cliente/equipe (lead_time_cliente) vence a premissa; o texto diz de onde veio
      const lead = i.lead_time_dias ?? L.lead_time_reposicao_dias, leadInformado = i.lead_time_fonte === 'cliente' || i.lead_time_fonte === 'equipe'
      const leadTxt = leadInformado ? `Prazo de reposição informado ${i.lead_time_fonte === 'cliente' ? 'pelo cliente' : 'pela equipe'}: ${lead} dias.` : `Prazo de reposição de referência: ${lead} dias (premissa — ajustar ao fornecedor).`
      const { dias: diasSemEstoque, cenarios: riscoCen, segue_flex: segueFlex } = riscoRuptura(i, L)      // a MESMA fórmula do impacto do aviso de estoque (gatilhos.js)
      const sug = sugestaoFull(i)
      // Full em ruptura com estoque PRÓPRIO do mesmo produto: enviar ao Full (teto = próprio − ponto de pedido do próprio), não comprar — desenho § 4.2/§ 8.6
      const efProprio = efFull ? i.produto.efs.find(e => e.local === 'proprio' && e.estoque > 0) : null, enviar = envioDoProprio(i, sug?.cenarios)
      const causa = enviar ? 'enviar_full' : 'comprar', grupoTxt = multi ? ` (${E.n} anúncios, mesmo estoque)` : ''
      out.push({ regra: 'estoque_ruptura', item: i, urgencia: 5, esforco: 3, causal: 85, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado',
        ...(produtoLigado(i) ? { produto: { chave: i.produto.chave, ef: i.produto.ef, n: E.n, irmaos: E.irmaos, modo: i.produto.modo }, causas: [{ causa, sinal: causa === 'enviar_full' ? `Full com ${E.estoque} un e ${efProprio.estoque} un no estoque próprio do mesmo produto` : `estoque ${E.estoque} un para ${i.cobertura} dia(s)` }] } : {}),
        titulo: `Repor estoque antes de zerar: ${nome}${grupoTxt}`,
        problema: `Estoque para ${i.cobertura} dia(s) no ritmo atual, com reposição levando ~${lead} dias — ${multi ? `produto em ${E.n} anúncios com o mesmo estoque, ${pctTxt(100 * E.r / Math.max(gmv, 1))}% do GMV` : `anúncio de ${pctTxt(i.share_pct)}% do GMV`}`,
        evidencia: `estoque ${E.estoque} un${efFull ? ' no Full' : ''}${multi ? ` (contado uma vez para ${E.n} anúncios)` : ''}; vende ${E.vel}/dia (${E.u} un em 28 dias${multi ? ', somando os anúncios' : ''}) → ${i.cobertura} dia(s) de cobertura. ${leadTxt}${efProprio ? ` Estoque próprio do mesmo produto: ${efProprio.estoque} un.` : ''}`,
        hipotese: segueFlex ? `O anúncio segue vendendo pelo Flex do estoque próprio enquanto o Full está com ${E.estoque} un${diasSemEstoque ? `; sem reposição, fica ~${diasSemEstoque} dia(s) sem vender` : ': sem receita em risco estimada'}; repor o Full pode melhorar entrega e exposição — HIPÓTESE.` : `Sem reposição, ${multi ? `os ${E.n} anúncios ficam` : 'o anúncio fica'} ~${diasSemEstoque} dia(s) sem vender; ruptura também derruba a exposição na busca — esse efeito é HIPÓTESE.`,
        como: [enviar ? `Enviar ao Full ${enviar.conservador === enviar.base ? enviar.base : `${enviar.conservador} a ${enviar.base}`} un do estoque próprio (tem ${efProprio.estoque} un no depósito; não precisa comprar)` : 'Confirmar estoque real e entrada prevista com o cliente', sug ? `Quantidade sugerida: ${sug.cenarios.conservador} (conservador) / ${sug.cenarios.base} (base) / ${sug.cenarios.crescimento} (crescimento) — ${sug.premissa}` : 'Calcular a quantidade com a demanda por dia', 'Se o anúncio é Full, agendar o envio; senão repor o estoque próprio', 'Não movimentar estoque sem autorização do cliente'],
        indicador: `cobertura ${i.cobertura} dia(s)`, meta: `cobertura ≥ ${L.cobertura_atencao_dias} dias antes de ${addDias(diag.hoje, lead)}`, aceite: 'Reposição confirmada com quantidade e data de entrada',
        prev: previsao({ regra: 'estoque_ruptura', tipo: 'risco_evitado', formula: 'receita em risco = receita por dia × dias sem estoque (prazo de reposição − cobertura)', premissas: [`receita/dia R$ ${r2(E.r / 28)}${multi ? ` (${E.n} anúncios do mesmo estoque)` : ''}`, `${diasSemEstoque} dia(s) sem estoque`, leadInformado ? `prazo de reposição informado (${lead} dias)` : 'prazo de reposição padrão — ajustar', ...(multi ? ['estoque contado uma vez por produto (anúncios do mesmo produto vendem do mesmo estoque)'] : []), ...(produtoLigado(i) ? i.produto.premissas.filter(p => /Flex|informado|espelh|dividido|variações|anúncio menos/.test(p)) : [])], valores: riscoCen, prior: pr }),
        demanda: 'Planejamento full', dimensao: 'Estoque e logística' })
    }
    // V3 F3: ESTOQUE DIVIDIDO — o mesmo produto em 2+ estoques PRÓPRIOS (UPs diferentes). confirmar_fisico: espelho provável sem declaração (pergunta ao cliente, só curva A/B,
    // teto 2 por plano); pool_zerando: dividido com um estoque em ruptura enquanto outro está acima do próprio ponto de pedido («um anúncio vai zerar enquanto o outro tem estoque»)
    if (produtoLigado(i) && representaProduto(i) && ['A', 'B'].includes(i.curva) && i.produto.u >= F.min_unidades_item && ['espelho_provavel', 'dividido'].includes(i.produto.modo_proprio)) {
      const P0 = i.produto, pr = priorEfetivo('estoque_dividido'), props = P0.efs.filter(e => e.local === 'proprio'), nProp = P0.modo_proprio === 'espelho_provavel' ? P0.efs.find(e => e.local === 'proprio')?.nos.length || 2 : props.length
      const base = { regra: 'estoque_dividido', urgencia: 4, esforco: 1, causal: 60, evidencia_tipo: 'hipotese', produto: { chave: P0.chave, ef: null, n: P0.n_anuncios, irmaos: P0.irmaos, modo: P0.modo }, demanda: 'Planejamento full', dimensao: 'Estoque e logística' }
      if (P0.modo_proprio === 'espelho_provavel') {
        out.push({ ...base, item: i, causas: [{ causa: 'confirmar_fisico', sinal: `o mesmo número (${P0.estoque_ef ?? P0.estoque} un) em ${nProp} anúncios com estoque próprio separado no Mercado Livre` }], confirmar_com: ['quantidade física com o cliente', 'se um ERP/sistema sincroniza o estoque entre os anúncios'],
          titulo: `Confirmar o estoque físico: ${nome} (${nProp} anúncios com o mesmo número)`,
          problema: `${nProp} anúncios do mesmo produto com estoque próprio separado no Mercado Livre e o mesmo número em todos — contamos uma vez (premissa: estoque espelhado); se nenhum sistema desconta a venda de um nos outros, o ML pode vender mais do que existe`,
          evidencia: `${nProp} anúncios com estoque próprio informado no ML e o mesmo número; vendas somadas ${P0.u} un em 28 dias (${brl(P0.r)}). Sem declaração do cliente nos últimos ${algoritmo.produto?.estoque_declarado_validade_dias ?? 7} dias.`,
          hipotese: 'O mesmo número em anúncios separados sugere estoque espelhado (contado uma vez) — PREMISSA; só o cliente confirma quantas unidades existem e se algum sistema atualiza os anúncios.',
          como: ['Perguntar ao cliente quantas unidades existem de verdade desse produto e se algum sistema (ERP) atualiza o estoque dos anúncios', 'Registrar a resposta em Produtos › estoque físico (vale 7 dias) — passa a valer no cálculo', 'Se um sistema sincroniza, registrar como alinhamento (estoque controlado fora)'],
          indicador: `${nProp} estoques próprios com o mesmo número`, meta: 'estoque físico informado pelo cliente ou sincronização confirmada', aceite: 'Resposta do cliente registrada (quantidade e fonte)',
          prev: { tipo: 'pendencia', hipotese: false, cenarios: { conservador: { receita: 0 }, base: { receita: 0 }, otimista: { receita: 0 } }, p_sucesso: pr.p, p_fonte: pr.fonte, valor_esperado: 0, esperado: { conservador: 0, base: 0, otimista: 0 }, aviso: 'Sem estimativa de receita: é pergunta ao cliente, pré-requisito da contagem certa do estoque.' } })
      } else {
        const rup = e => emRuptura({ cobertura: e.cobertura, lead_time_dias: e.lead, lead_time_fonte: e.lead_fonte }, L)
        const fraco = props.filter(rup).sort((a, b) => a.cobertura - b.cobertura)[0], forte = props.filter(e => e !== fraco && e.estoque != null && e.ponto != null && e.estoque > e.ponto).sort((a, b) => b.estoque - a.estoque)[0]
        const rep = fraco && forte ? it.find(x => String(x.id) === String(fraco.representante)) : null
        if (rep) {
          const k = riscoRuptura({ cobertura: fraco.cobertura, lead_time_dias: fraco.lead, r: fraco.r }, L), nomeF = curto(rep.titulo)
          out.push({ ...base, item: rep, tipo_prev: 'risco_evitado', causas: [{ causa: 'pool_zerando', sinal: `um anúncio com ${fraco.estoque} un (~${fraco.cobertura} dia(s)) e outro com ${forte.estoque} un do mesmo produto` }], confirmar_com: ['estoque físico de cada depósito com o cliente'],
            titulo: `Igualar o estoque entre os anúncios: ${nomeF} (um zera, outro tem ${forte.estoque} un)`,
            problema: `Um anúncio do produto fica sem estoque em ~${fraco.cobertura} dia(s) enquanto outro mostra ${forte.estoque} un do mesmo produto (estoques próprios separados no ML — premissa: estoque dividido)`,
            evidencia: `estoque fraco ${fraco.estoque} un, vende ${fraco.vel}/dia (${fraco.u} un em 28 dias); estoque forte ${forte.estoque} un (ponto de pedido ${forte.ponto} un). Receita do anúncio que zera: ${brl(fraco.r)} em 28 dias.`,
            hipotese: 'Igualar o estoque no painel (ou unificar os anúncios no mesmo produto do ML) mantém as vendas do anúncio que zera — HIPÓTESE; números diferentes podem ser um ERP com atraso.',
            como: [`Igualar o estoque no painel do Mercado Livre: mover parte das ${forte.estoque} un para o anúncio que zera (ou unificar os anúncios no mesmo produto)`, 'Confirmar com o cliente o estoque físico de cada depósito antes de mexer', 'Nunca alterar estoque sem autorização do cliente'],
            indicador: `cobertura ${fraco.cobertura} dia(s) no anúncio que zera`, meta: `cobertura ≥ ${L.cobertura_atencao_dias} dias nos dois anúncios`, aceite: 'Estoque igualado (ou anúncios unificados) e conferido na leitura seguinte',
            prev: previsao({ regra: 'estoque_dividido', tipo: 'risco_evitado', formula: 'receita em risco = receita por dia do anúncio que zera × dias sem estoque (prazo de reposição − cobertura)', premissas: [`receita/dia R$ ${r2(fraco.r / 28)}`, `${k.dias} dia(s) sem estoque`, 'o outro estoque do produto cobre a falta (premissa: estoque dividido)'], valores: k.cenarios, prior: pr }) })
        }
      }
    }

    // 4) FULL: quantidade sugerida para anúncio forte que não é Full (ou Full com cobertura curta)
    if (i.curva === 'A' && i.conv != null && bench && i.conv >= bench * 0.9 && i.logistica && i.logistica !== 'fulfillment' && E.vel >= 0.2 && representaEstoque(i)) {   // F3: 1 por estoque físico, velocidade do EF
      const pr = priorEfetivo('full_envio'), sug = sugestaoFull(i)
      if (sug) out.push({ regra: 'full_envio', item: i, urgencia: 3, esforco: 3, causal: 55, evidencia_tipo: 'hipotese',
        ...(produtoLigado(i) ? { produto: { chave: i.produto.chave, ef: i.produto.ef, n: E.n, irmaos: E.irmaos, modo: i.produto.modo } } : {}),
        titulo: `Avaliar envio ao Full: ${nome}${multi ? ` (${E.n} anúncios, mesmo estoque)` : ''}`,
        problema: 'Anúncio curva A com boa conversão fora do Full (logística atual: ' + i.logistica + ')',
        evidencia: `${i.u} un/28d${multi ? ` (${E.u} un somando os ${E.n} anúncios do mesmo estoque)` : ''}, conversão ${pctTxt(i.conv)}% (≥ benchmark); logística ${i.logistica}.`,
        hipotese: 'Full melhora entrega e exposição, mas o ganho depende de custo logístico e elegibilidade — HIPÓTESE; exige custos para decidir.',
        como: [`Quantidade sugerida (${sug.premissa}): ${sug.cenarios.conservador} / ${sug.cenarios.base} / ${sug.cenarios.crescimento} un`, 'Conferir elegibilidade e custo de armazenagem/envio com o cliente', 'Não movimentar estoque sem autorização explícita'],
        indicador: `logística ${i.logistica}`, meta: 'decisão de Full registrada com custo e quantidade', aceite: 'Decisão com custos validados pelo cliente',
        prev: previsao({ regra: 'full_envio', formula: 'unidades extras = fração do ritmo atual atribuída à melhor entrega (premissa)', premissas: ['ganho de 5%/10%/15% sobre as unidades atuais (premissa inicial)'], valores: { conservador: i.u * 0.05, base: i.u * 0.10, otimista: i.u * 0.15 }, preco: i.preco, prior: pr }),
        demanda: 'Planejamento full', dimensao: 'Estoque e logística' })
    }

    // 5) ADS por anúncio
    const a = i.ads
    const adsAtivo = a && a.custo > 0
    const beMed = ecoReal(i)?.roas_equilibrio ?? null, be = beMed ?? eco?.roas_breakeven     // F4 (chave): o ROAS de equilíbrio MEDIDO do anúncio vence o estimado da conta
    if (adsAtivo && a.custo >= L.ads_min_custo_avaliar && ((a.clicks >= L.ads_min_cliques_sem_venda && a.unidades === 0) || (roasConta && a.roas != null && a.roas < roasConta * L.ads_roas_vs_conta_reduzir) || (be && a.roas != null && a.roas < be))) {
      const pr = priorEfetivo('ads_reduzir')
      const ref = be ? `ROAS de equilíbrio ${be}${beMed != null ? ' medido nos pedidos' : ''}` : `ROAS da conta ${roasConta}`
      out.push({ regra: 'ads_reduzir', item: i, urgencia: 4, esforco: 1, causal: eco || beMed != null ? 85 : 60, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado',
        titulo: `Reduzir ou pausar Ads sem retorno: ${nome}`,
        problema: `Gastou ${brl(a.custo)} em 28 dias com ROAS ${a.roas ?? 0} (${ref}) e ${a.unidades} venda(s) atribuída(s)`,
        evidencia: `${a.clicks} cliques, ${a.prints} impressões (CTR ${pctTxt(a.ctr)}%), custo ${brl(a.custo)}, receita atribuída ${brl(a.receita)}, ROAS ${a.roas ?? 0}.`,
        hipotese: 'A verba desse anúncio rende menos que a média da conta — realocar para anúncios com ROAS maior é HIPÓTESE de ganho (atribuição de Ads não prova venda incremental).',
        como: ['Conferir se o anúncio converte organicamente (visitas e conversão) antes de decidir', 'Reduzir lance/orçamento ou pausar; não decidir por um único dia — avaliar a janela de 14 dias', 'Realocar a verba para anúncios com ROAS acima da conta'],
        indicador: `ROAS ${a.roas ?? 0}, custo ${brl(a.custo)}/28d`, meta: `custo evitado ≥ ${brl(a.custo * 0.5)}/mês sem queda de vendas orgânicas`, aceite: 'Mudança de verba registrada e vendas do anúncio comparadas em 14 dias',
        prev: previsao({ regra: 'ads_reduzir', tipo: 'risco_evitado', formula: 'custo evitado = parte do gasto de Ads sem retorno que pode ser realocada', premissas: [`custo atual ${brl(a.custo)}/28d`, 'realocação de 50% / 70% / 100% do gasto'], valores: { conservador: a.custo * 0.5, base: a.custo * 0.7, otimista: a.custo }, prior: pr }),
        demanda: 'Ajuste ADS', dimensao: 'Demanda e visibilidade' })
    } else if (adsAtivo && roasConta && a.roas != null && a.roas >= roasConta * L.ads_roas_vs_conta_escalar && a.custo >= 20 && (i.cobertura == null || i.cobertura >= L.cobertura_atencao_dias) && (i.conv == null || !bench || i.conv >= bench * 0.8)) {
      const pr = priorEfetivo('ads_escalar'), f = P.ads_escalar.fator_roas_marginal
      const extra = a.custo * 0.3                                        // sugestão de +30% de verba (premissa)
      out.push({ regra: 'ads_escalar', item: i, urgencia: 3, esforco: 1, causal: 65, evidencia_tipo: 'fato',
        titulo: `Aumentar investimento onde o retorno é maior: ${nome}`,
        problema: `ROAS ${a.roas} contra ${roasConta} da conta, com estoque e conversão saudáveis`,
        evidencia: `custo ${brl(a.custo)}, receita atribuída ${brl(a.receita)}, ROAS ${a.roas} (conta ${roasConta}); cobertura ${i.cobertura ?? '—'} dias; conversão ${pctTxt(i.conv)}%.`,
        hipotese: `O ROAS marginal tende a ficar abaixo do médio quando se aumenta a verba — por isso os cenários usam ${f.map(x => Math.round(x * 100) + '%').join(' / ')} do ROAS atual. Atribuição de Ads não prova venda incremental.`,
        como: [`Subir a verba em ~30% (+${brl(extra)}/mês) e acompanhar 7 dias antes de nova alta`, eco?.roas_alvo ? `Manter ROAS acima do alvo ${eco.roas_alvo}` : 'Informar custos para definir o ROAS alvo (sem ele não há limite econômico)', 'Não escalar por uma única venda nem pausar por um dia ruim'],
        indicador: `ROAS ${a.roas}, custo ${brl(a.custo)}/28d`, meta: `ROAS ≥ ${r1(a.roas * f[1])} com a verba maior`, aceite: 'Verba ajustada e ROAS do anúncio conferido em 7 e 14 dias',
        prev: previsao({ regra: 'ads_escalar', formula: 'receita extra = verba extra × ROAS atual × fator de ROAS marginal', premissas: [`verba extra ${brl(extra)}/28d`, `ROAS atual ${a.roas}`, `fator marginal ${f.join(' / ')}`], valores: { conservador: extra * a.roas * f[0] / (i.preco || 1), base: extra * a.roas * f[1] / (i.preco || 1), otimista: extra * a.roas * f[2] / (i.preco || 1) }, preco: i.preco, prior: pr }),
        demanda: 'Ajuste ADS', dimensao: 'Demanda e visibilidade' })
    }
    if (adsAtivo && bench && i.conv != null && i.conv < bench * 0.75 && a.custo >= L.ads_min_custo_avaliar && i.v >= F.min_visitas_item && !out.some(o => o.item === i && o.regra === 'ima_conversao')) {
      const pr = priorEfetivo('ads_otimizar_antes'), f = P.ads_otimizar_antes.fracao_gap, gapPp = bench - i.conv
      out.push({ regra: 'ads_otimizar_antes', item: i, urgencia: 3, esforco: 3, causal: 60, evidencia_tipo: 'fato',
        titulo: `Corrigir o anúncio antes de gastar mais em Ads: ${nome}`,
        problema: `Em Ads (${brl(a.custo)}/28d) com conversão ${pctTxt(i.conv)}% abaixo dos ${pctTxt(bench)}% da conta`,
        evidencia: `conversão ${pctTxt(i.conv)}% com ${i.v} visitas; custo de Ads ${brl(a.custo)}; benchmark da conta ${pctTxt(bench)}%.`,
        hipotese: 'Tráfego pago em oferta que converte mal desperdiça verba; corrigir a oferta antes eleva o retorno do mesmo gasto — HIPÓTESE.',
        como: ['Não aumentar a verba deste anúncio até a conversão subir', org === 'nao' ? 'Rodar a revisão de objeções do anúncio (conteúdo, preço, frete, confiança)' : org === 'terceiros' ? `Rodar a revisão de objeções do anúncio (preço, frete e caixa de compra). ${TX}` : `Rodar a revisão de objeções do anúncio (preço, frete, confiança). ${TX}`, 'Reavaliar o Ads após 14 dias com a nova conversão'],
        indicador: `conversão ${pctTxt(i.conv)}%`, meta: `conversão ≥ ${pctTxt(i.conv + gapPp * f[1])}%`, aceite: 'Correção registrada e conversão comparada em 14 dias',
        prev: previsao({ regra: 'ads_otimizar_antes', formula: 'unidades extras = visitas × gap × fração fechada', premissas: [`gap ${pctTxt(gapPp)} p.p.`, `fração ${f.map(x => Math.round(x * 100) + '%').join(' / ')}`], valores: { conservador: i.v * gapPp / 100 * f[0], base: i.v * gapPp / 100 * f[1], otimista: i.v * gapPp / 100 * f[2] }, preco: i.preco, prior: pr }),
        demanda: 'Otimizar Anúncios', dimensao: 'Conversão e oferta' })
    }
    if (!adsAtivo && i.curva !== 'C' && i.conv != null && bench && i.conv >= bench * 0.9 && (i.cobertura == null || i.cobertura >= L.cobertura_atencao_dias) && i.u >= F.min_unidades_item && roasConta) {
      const pr = priorEfetivo('ads_entrar'), f = P.ads_entrar.fator_roas_marginal
      const verba = Math.max(50, Math.round(i.r * 0.03 / 10) * 10)       // sugestão: ~3% da receita do anúncio (premissa)
      out.push({ regra: 'ads_entrar', item: i, urgencia: 2, esforco: 2, causal: eco ? 65 : 50, evidencia_tipo: 'hipotese',
        titulo: `Colocar em Ads (objetivo: crescimento): ${nome}`,
        problema: `Curva ${i.curva}, converte ${pctTxt(i.conv)}% (≥ benchmark) e tem estoque, mas não anuncia`,
        evidencia: `${i.u} un/28d, conversão ${pctTxt(i.conv)}% vs ${pctTxt(bench)}% da conta, cobertura ${i.cobertura ?? '—'} dias; sem gasto em Ads no período.`,
        hipotese: `Tráfego pago em anúncio que já converte bem deve multiplicar visitas qualificadas. ${eco ? `Limite econômico: ROAS alvo ${eco.roas_alvo}.` : 'SEM CUSTOS informados não há ROAS alvo: o teste usa o ROAS da conta (' + roasConta + ') só como referência relativa.'}`,
        como: [`Teste de crescimento com ~${brl(verba)} por 14 dias`, eco?.roas_alvo ? `Critério de aumento: ROAS ≥ ${eco.roas_alvo}; de redução: abaixo de ${eco.roas_breakeven}` : 'Informar custos para definir o ROAS alvo antes de escalar', 'Avaliar com janela de 7–14 dias (atribuição atrasa); não pausar por um dia ruim'],
        indicador: 'sem Ads', meta: eco?.roas_alvo ? `ROAS ≥ ${eco.roas_alvo}` : `ROAS próximo de ${r1(roasConta * f[1])}`, aceite: 'Teste de Ads com verba, janela e critério de decisão registrados',
        prev: previsao({ regra: 'ads_entrar', formula: 'receita de Ads = verba × ROAS da conta × fator marginal', premissas: [`verba ${brl(verba)}/28d (premissa: 3% da receita do anúncio)`, `ROAS da conta ${roasConta}`, `fator marginal ${f.join(' / ')}`, 'parte da receita já seria orgânica (sem prova de incremento)'], valores: { conservador: verba * roasConta * f[0] * 0.6 / (i.preco || 1), base: verba * roasConta * f[1] * 0.6 / (i.preco || 1), otimista: verba * roasConta * f[2] * 0.6 / (i.preco || 1) }, preco: i.preco, prior: pr }),
        demanda: 'Ajuste ADS', dimensao: 'Demanda e visibilidade' })
    }

    // 6) CONTEÚDO e FRETE (esforço baixo, só em anúncio relevante)
    if (i.curva !== 'C' && i.fotos != null && i.fotos < L.fotos_minimas && i.v >= F.min_visitas_item && !regraBloqueada('conteudo_fotos', org)) {
      const pr = priorEfetivo('conteudo_fotos'), g = P.conteudo_fotos.ganho_conv_pct
      out.push({ regra: 'conteudo_fotos', item: i, urgencia: 2, esforco: 1, causal: 50, evidencia_tipo: 'fato',
        titulo: `Completar as fotos do anúncio: ${nome}`, problema: `Anúncio curva ${i.curva} com só ${i.fotos} foto(s) (mínimo de referência ${L.fotos_minimas})`,
        evidencia: `${i.fotos} foto(s); ${i.u} un/28d; ${i.v} visitas.`, hipotese: 'Mais fotos (uso, medidas, kit) reduzem dúvidas e elevam a conversão — HIPÓTESE; o tamanho do efeito é a premissa de ganho declarada.',
        como: org === 'proprio' ? [`${TX} (só ${i.fotos} foto(s))`, 'Enviar a sugestão de correção das fotos (uso, escala/medidas, embalagem) pelo painel do vendedor e acompanhar a revisão', 'Medir conversão em 14 dias depois que a revisão for aplicada']
          : ['Adicionar fotos de uso, escala/medidas e o que vem na embalagem', 'Conferir a capa (fundo branco, produto inteiro)', 'Medir conversão em 14 dias'],
        indicador: `${i.fotos} foto(s)`, meta: `≥ ${L.fotos_minimas} fotos`, aceite: 'Fotos publicadas e conferidas no anúncio',
        prev: previsao({ regra: 'conteudo_fotos', formula: 'unidades extras = unidades atuais × ganho de conversão (premissa)', premissas: [`ganho de conversão ${g.join('% / ')}%`], valores: { conservador: i.u * g[0] / 100, base: i.u * g[1] / 100, otimista: i.u * g[2] / 100 }, preco: i.preco, prior: pr }),
        demanda: 'Melhorar Imagens', dimensao: 'Clique e atração' })
    }
    if (i.curva === 'A' && !i.frete_gratis && i.u >= F.min_unidades_item) {
      const pr = priorEfetivo('frete_gratis'), g = P.frete_gratis.ganho_conv_pct
      out.push({ regra: 'frete_gratis', item: i, urgencia: 2, esforco: 2, causal: 50, evidencia_tipo: 'fato',
        titulo: `Avaliar frete grátis: ${nome}`, problema: `Anúncio curva A (${pctTxt(i.share_pct)}% do GMV) sem frete grátis`,
        evidencia: `frete grátis: não; ${i.u} un/28d. O custo do frete depende de peso, preço e reputação.`, hipotese: 'Frete grátis eleva exposição e conversão no ML — HIPÓTESE de ganho; só vale se a margem comportar o frete.',
        como: ['Simular o custo do frete subsidiado com os custos do cliente', 'Se a margem comportar, ativar frete grátis e medir em 14 dias', diag.custos_informados ? 'Custos já informados: validar na margem' : 'Custos não informados: decisão depende deles'],
        indicador: 'sem frete grátis', meta: 'decisão de frete registrada com margem', aceite: 'Decisão com simulação de margem',
        prev: previsao({ regra: 'frete_gratis', formula: 'unidades extras = unidades atuais × ganho de conversão (premissa)', premissas: [`ganho ${g.join('% / ')}%`], valores: { conservador: i.u * g[0] / 100, base: i.u * g[1] / 100, otimista: i.u * g[2] / 100 }, preco: i.preco, prior: pr }),
        demanda: 'Corrigir Anúncios', dimensao: 'Conversão e oferta' })
    }

    // 7) PROMOÇÃO para girar estoque em excesso — só com custos (desconto máximo pela margem)
    const eR = ecoReal(i)                                                   // F4 (chave): desconto máximo MEDIDO (tarifa e frete reais + custo) vence o estimado
    if (i.cobertura != null && i.cobertura > L.cobertura_excesso_dias && i.estoque >= 20 && (diag.custos_informados || eR)) {
      const cmvItem = i.custo_unitario != null && i.preco > 0 ? r1(100 * i.custo_unitario / i.preco) : null
      const dmax = eR ? eR.desconto_max_pct : descontoMaximoPct(cc && cmvItem != null ? { ...cc, cmv_pct: cmvItem } : cc)
      const pr = priorEfetivo('promocao_giro')
      if (dmax > 3) out.push({ regra: 'promocao_giro', item: i, urgencia: 2, esforco: 2, causal: 55, evidencia_tipo: 'hipotese',
        titulo: `Promoção para girar estoque: ${nome}`, problema: `Cobertura de ${i.cobertura} dias (excesso) — capital parado`,
        evidencia: `estoque ${i.estoque} un, vende ${i.vel_dia}/dia → ${i.cobertura} dias. Desconto máximo que preserva a margem desejada: ${dmax}% (${eR ? `MEDIDO: tarifa observada ${virg(eR.t_pct)}%, frete ${reais(eR.frete_unit)}/un, ${custoTxt(i)}${eR.cruza_faixa_frete ? `; limitado à faixa de R$ ${algoritmo.financeiro.faixa_frete_gratis_brl ?? 79}` : ''}` : cmvItem != null ? `CMV do próprio anúncio: ${custoTxt(i)} = ${virg(cmvItem)}% do preço` : 'CMV% da conta'}).`, hipotese: 'Um desconto dentro do limite gira o excedente sem corroer a margem — HIPÓTESE; elasticidade do anúncio não medida.',
        como: [`Campanha com desconto de até ${Math.floor(dmax * 0.6)}% (60% do limite) por 7–14 dias`, 'Verificar elegibilidade da campanha no canal', 'Encerrar ao atingir a cobertura-alvo'],
        indicador: `cobertura ${i.cobertura} d`, meta: `cobertura ≤ ${L.cobertura_excesso_dias} dias`, aceite: 'Campanha registrada com desconto, período e critério de encerramento',
        prev: previsao({ regra: 'promocao_giro', formula: 'unidades extras = ritmo atual × aumento de giro com desconto (premissa)', premissas: ['giro +20% / +40% / +70% (premissa; sem elasticidade medida)'], valores: { conservador: i.u * 0.2, base: i.u * 0.4, otimista: i.u * 0.7 }, preco: (i.preco || 0) * (1 - dmax * 0.6 / 100), prior: pr }),
        demanda: 'Campanhas de Desconto', dimensao: 'Estoque e logística' })
    }

    // 7b) PREÇO SUBIU E AS VENDAS CAÍRAM: a coincidência é FATO (histórico de preço + vendas/dia nos 28 dias antes da alta × desde a alta), a causa é
    //     HIPÓTESE. Só com alta LÍQUIDA (1º "de" → último "para") ≥ limiar e o preço de hoje ainda acima do de antes (subiu e voltou não é "subiu"), ao
    //     menos N dias depois da alta (queda que veio antes da alta não é efeito dela) e o controle nas mesmas datas sem queda (senão é mercado).
    //     Margem: sem custo informado a revisão depende do cliente. Dia sem coleta conta zero nas vendas/dia do anúncio E do controle (encolhe os dois pela
    //     mesma fração, e o anúncio cruza o limiar com o controle ainda "estável"): com janelas incompletas não dispara, como as demais quedas.
    const mp = i.mudancas_preco_28d || [], de0 = Number(mp[0]?.de), fimP = diag.periodo?.ate
    const liquida = de0 > 0 && mp.at(-1)?.para != null ? 100 * (mp.at(-1).para / de0 - 1) : null
    const sub = liquida != null && liquida >= limPreco && i.preco > de0 ? mp.filter(e => e.pct != null && e.pct > 0).sort((a, b) => b.pct - a.pct)[0] : null
    const diasDep = sub && fimP ? diasEntre(sub.dia, fimP) + 1 : 0
    const jA = sub ? [addDias(sub.dia, -28), addDias(sub.dia, -1)] : null, jD = sub ? [sub.dia, fimP] : null
    const uA = sub ? somaU(i.vendas_dia, ...jA) : 0, uD = sub ? somaU(i.vendas_dia, ...jD) : 0, cA = sub ? somaU(diag.vendas_dia_sem_mudanca, ...jA) : 0, cD = sub ? somaU(diag.vendas_dia_sem_mudanca, ...jD) : 0
    const varDia = (d, a) => r1(100 * ((d / diasDep) / (a / 28) - 1))
    // ponytail: sem controle com volume mínimo a regra não dispara (conta que subiu tudo de uma vez fica com a leitura de causalidade da conta)
    const varCtrl = sub && cA >= cfgAtrib.min_unidades_controle ? varDia(cD, cA) : null, varItem = sub && uA > 0 ? varDia(uD, uA) : null
    if (!janelasIncompletas && sub && diasDep >= L.preco_min_dias_apos_alta && varCtrl != null && varCtrl > -L.preco_controle_max_queda_pct && uA >= F.min_unidades_item && varItem <= -L.preco_queda_unidades_pct) {
      const pr = priorEfetivo('preco_mudou_vendas_cairam'), f = P.preco_mudou_vendas_cairam.fracao_recuperada
      const velA = uA / 28, velD = uD / diasDep, queda = virg(-varItem), perdido = r1((velA - velD) * 28), quando = sub.incerteza ? `(${sub.incerteza})` : `em ${dm(sub.dia)}`, subiu = virg(sub.pct)
      const custoOk = diag.custos_informados || i.custo_unitario != null
      // margem nos dois preços (o de antes da alta e o atual) com o custo do anúncio; sem os percentuais da conta, só a parte do custo no preço
      const mAnt = margemPct(cc, sub.de, i.custo_unitario), mAtu = margemPct(cc, i.preco, i.custo_unitario), noPreco = p => (p > 0 ? `${virg(r1(100 * i.custo_unitario / p))}%` : '—')
      const passoMargem = mAnt != null && mAtu != null ? `Margem estimada ${virg(mAnt)}% no preço de antes (${reais(sub.de)}) e ${virg(mAtu)}% no atual (${reais(i.preco)}), com ${i.custo_unitario != null ? custoTxt(i) : 'o CMV% da conta'} e os percentuais da conta: voltar o preço só se a margem de antes couber`
        : i.custo_unitario != null ? `${custoTxt(i)} = ${noPreco(sub.de)} do preço de antes e ${noPreco(i.preco)} do atual; comissão, frete e imposto não informados: confirmar a margem com o cliente`
        : custoOk ? 'Conferir a margem do preço novo com os custos informados' : 'Custos não informados: confirmar a margem com o cliente antes de baixar o preço'
      const pago = i.preco_realizado_ant != null && i.preco_realizado_28d != null ? `; preço pago (receita ÷ unidades) ${reais(i.preco_realizado_ant)} → ${reais(i.preco_realizado_28d)}` : ''
      out.push({ regra: 'preco_mudou_vendas_cairam', item: i, urgencia: 4, esforco: 1, causal: 60, evidencia_tipo: 'fato',
        titulo: `Revisar o preço que subiu: ${nome}`,
        problema: `O preço subiu ${subiu}% ${quando} e as vendas caíram ${queda}% (vendas/dia nos ${diasDep} dias desde a alta contra os 28 dias antes dela), enquanto os anúncios sem mudança de preço variaram ${virg(varCtrl)}% nas mesmas datas`,
        evidencia: `Mudanças de preço registradas no período: ${historicoPreco(i)}${pago}; vendas ${uA} un nos 28 dias antes da alta → ${uD} un nos ${diasDep} dias desde ela; anúncios sem mudança de preço: ${cA} → ${cD} un nas mesmas datas (${virg(varCtrl)}% por dia).`,
        hipotese: 'A alta de preço e a queda de vendas no mesmo período são FATO; que o preço CAUSOU a queda é HIPÓTESE (concorrência, estoque ou posição também derrubam vendas) — o teste é UMA mudança de preço medida contra os anúncios sem mudança.',
        como: [`Revisar o preço: subiu ${subiu}% ${quando} e as vendas caíram ${queda}%. Fazer UMA mudança (voltar ou ajustar), sem mexer em título e fotos por 14 dias, e medir contra os anúncios sem mudança de preço`,
          passoMargem,
          'Registrar no card o preço antes e depois e a data da mudança'],
        indicador: `${virg(r2(velD))} un/dia desde a alta (antes ${virg(r2(velA))}) a ${reais(i.preco)}`, meta: `vendas ≥ ${Math.round(velD * 28 + perdido * f[1])} un/28d com título e fotos intocados`, aceite: 'Uma única mudança de preço registrada com data e vendas comparadas com os anúncios sem mudança de preço em 14 dias',
        prev: previsao({ regra: 'preco_mudou_vendas_cairam', formula: 'unidades recuperadas = vendas perdidas × fração recuperada ao revisar o preço', premissas: [`vendas/dia ${virg(r2(velD))} desde a alta contra ${virg(r2(velA))} nos 28 dias antes (perdido ≈ ${virg(perdido)} un em 28 dias)`, `fração recuperada ${f.map(x => Math.round(x * 100) + '%').join(' / ')} (premissa; elasticidade do anúncio NÃO medida)`, `preço de referência ${reais(sub.de)} (o de antes da alta, se voltar)`], valores: { conservador: perdido * f[0], base: perdido * f[1], otimista: perdido * f[2] }, preco: sub.de, prior: pr }),
        demanda: 'Atualizar Preços', dimensao: 'Conversão e oferta', ...(custoOk ? {} : { dependencia: 'Custos do cliente (margem)' }),
        // os MESMOS números da evidência, estruturados: o gatilho queda_por_preco (gatilhos.js) só projeta isto, nunca recalcula; fonte = de quem é a mudança (change-log)
        dados_extra: { evidencia_preco: { dia: sub.dia, de: sub.de, para: sub.para, subiu_pct: sub.pct, queda_pct: -varItem, controle_pct: varCtrl, dias_desde_alta: diasDep, fonte: sub.fonte || '', incerteza: sub.incerteza || '' } } })
    }

    // ── regras v1.4.0 (motor de diagnóstico, 08/10/2026), no molde da 7b: a queda é FATO, a causa é HIPÓTESE por sinal, o controle são os anúncios SEM mudança
    //    registrada (preço/título/fotos/capa — change-log) nos 28 dias. Sem controle com volume mínimo a regra NÃO dispara (queda geral é mercado, não o anúncio).
    const evs = i.mudancas_28d || [], mudouPreco = evs.some(e => e.campo === 'preco'), mudouConteudo = evs.some(e => ['titulo', 'fotos', 'thumb'].includes(e.campo))
    const diaEvs = campos => [...new Set(evs.filter(e => campos.includes(e.campo)).map(e => dm(e.dia)))].join(', ')
    // o próprio anúncio sai do controle quando não mudou (senão se compararia consigo mesmo)
    const C0 = ctrlVis, ctrl = C0 && semMud(i) && i.visOk ? tira(C0, [i]) : C0
    const ctrlOk = !!ctrl && ctrl.n >= 1 && ctrl.v0 >= F.min_visitas_item && ctrl.u0 >= cfgAtrib.min_unidades_controle
    const varPct = (x, y) => y > 0 ? r1(100 * (x / y - 1)) : null
    const varCtrlConv = ctrlOk && ctrl.v > 0 ? varPct(ctrl.u / ctrl.v, ctrl.u0 / ctrl.v0) : null, varCtrlVis = ctrlOk ? varPct(ctrl.v, ctrl.v0) : null
    const conv0 = i.visOk && i.v0 > 0 && i.u0 <= i.v0 ? 100 * i.u0 / i.v0 : null                 // conversão anterior do próprio anúncio (null se > 100%, como a atual)
    const fr = fr0

    // 11) QUEDA DE CONVERSÃO DO ANÚNCIO contra o próprio histórico, com os anúncios sem mudança estáveis. Causas por sinal: preço, conteúdo (não em catálogo de terceiros), disponibilidade, catálogo.
    //     FATO só com amostra: unidades da janela anterior ≥ o mínimo do controle da atribuição (3 → 2 unidades não é queda) e as duas janelas inteiras
    if (!janelasIncompletas && i.u0 >= cfgAtrib.min_unidades_controle && i.conv != null && conv0 != null && i.v >= F.min_visitas_item && i.v0 >= F.min_visitas_item && i.conv <= conv0 * (1 - L.queda_conversao_rel_pct / 100) && varCtrlConv != null && varCtrlConv > -L.controle_max_queda_pct) {
      const causas = []
      if (mudouPreco) causas.push({ causa: 'preco', sinal: `preço de lista mudou no período: ${historicoPreco(i)}` })
      if (mudouConteudo && org !== 'terceiros') causas.push({ causa: 'conteudo', sinal: `título/fotos/capa mudaram em ${diaEvs(['titulo', 'fotos', 'thumb'])}` })
      if ((i.cobertura_anuncio ?? i.cobertura) != null && (i.cobertura_anuncio ?? i.cobertura) <= 2) causas.push({ causa: 'disponibilidade', sinal: `estoque para ${i.cobertura_anuncio ?? i.cobertura} dia(s)` })   // F3: idem (número do anúncio)
      if (i.catalogo && i.buy_box === false) causas.push({ causa: 'catalogo', sinal: 'caixa de compra perdida' })
      if (!causas.length) causas.push({ causa: 'mercado_ou_concorrencia', sinal: 'nenhuma mudança registrada no anúncio no período' })
      const pr = priorEfetivo('queda_conversao_anuncio'), f = P.queda_conversao_anuncio.fracao_recuperada, gapPp = conv0 - i.conv
      const PASSO = { preco: 'Preço: conferir a mudança registrada e a margem; se foi alta, avaliar UMA correção medida contra os anúncios sem mudança', conteudo: 'Conteúdo: comparar título/fotos/capa anteriores com os atuais e restaurar o que mudou se nada justificar', disponibilidade: 'Disponibilidade: confirmar estoque e prazo de entrega (variação sem estoque não converte)', catalogo: 'Catálogo: recuperar a caixa de compra (preço/condição) — ver a ação de catálogo', mercado_ou_concorrencia: 'Sem sinal no anúncio: abrir como comprador, comparar com o concorrente que mais vende e registrar a hipótese no card' }
      out.push({ regra: 'queda_conversao_anuncio', item: i, urgencia: 4, esforco: 2, causal: causas[0].causa === 'mercado_ou_concorrencia' ? 45 : 65, evidencia_tipo: 'fato', causas, confirmar_com: ['visitas por origem (NOT_AVAILABLE)', 'perguntas (NOT_AUTHORIZED)', 'mudanças no card'],
        titulo: `Conversão caiu contra o próprio histórico: ${nome}`,
        problema: `Conversão ${pctTxt(i.conv)}% contra ${pctTxt(conv0)}% nos 28 dias anteriores (${virg(varPct(i.conv, conv0))}%), enquanto os anúncios sem mudança variaram ${virg(varCtrlConv)}%`,
        evidencia: `${i.u} un / ${i.v} visitas → ${pctTxt(i.conv)}%; antes ${i.u0} un / ${i.v0} visitas → ${pctTxt(conv0)}%. Controle (${ctrl.n} anúncio(s) sem mudança de preço/título/fotos/capa): ${virg(varCtrlConv)}% de conversão nas mesmas janelas. Sinais: ${causas.map(c => c.sinal).join('; ')}.`,
        hipotese: `A queda contra o próprio histórico com o controle estável é FATO; a causa provável é ${causas[0].causa.replace(/_/g, ' ')} — HIPÓTESE por sinal, a confirmar com as visitas por origem e as perguntas do anúncio (ainda não disponíveis no sistema) e as mudanças registradas no card.`,
        como: [...causas.map(c => PASSO[c.causa]), ...(org !== 'nao' ? [TX] : []), 'Fazer UMA mudança por vez e registrar no card a data e o que mudou', 'Medir a conversão em 14 dias contra os anúncios sem mudança'],
        indicador: `conversão ${pctTxt(i.conv)}% (antes ${pctTxt(conv0)}%)`, meta: `conversão ≥ ${pctTxt(i.conv + gapPp * f[1])}% em 14 dias`, aceite: 'Causa testada registrada com data e conversão comparada com o controle em 14 dias',
        prev: previsao({ regra: 'queda_conversao_anuncio', formula: 'unidades recuperadas = visitas × (conversão anterior − atual) × fração recuperada', premissas: [`visitas 28d = ${i.v}`, `gap ${pctTxt(gapPp)} p.p. até a conversão anterior`, `fração recuperada ${fr(f)} (premissa)`], valores: { conservador: i.v * gapPp / 100 * f[0], base: i.v * gapPp / 100 * f[1], otimista: i.v * gapPp / 100 * f[2] }, preco: i.preco, prior: pr }),
        demanda: 'Otimizar Anúncios', dimensao: 'Conversão e oferta' })
    }

    // 12) QUEDA DE EXPOSIÇÃO (visitas) contra o próprio histórico, com as visitas dos anúncios sem mudança estáveis; pausado ou sem estoque fica fora (outra regra explica)
    if (!janelasIncompletas && i.visOk && i.status === 'active' && (i.estoque == null || i.estoque > 0) && i.v0 >= F.min_visitas_item && i.v <= i.v0 * (1 - L.queda_visitas_pct / 100) && varCtrlVis != null && varCtrlVis > -L.controle_max_queda_pct) {
      const causas = []
      if (i.ads_ant?.custo > 0 && !(i.ads?.custo > 0)) causas.push({ causa: 'ads_desligou', sinal: `Ads: ${brl(i.ads_ant.custo)} na janela anterior e ${brl(i.ads?.custo || 0)} na atual` })
      if (liquida != null && liquida >= limPreco) causas.push({ causa: 'preco_subiu', sinal: `preço subiu ${virg(r1(liquida))}% no período (${historicoPreco(i)})` })
      if (mudouConteudo) causas.push({ causa: 'conteudo_mudou', sinal: `título/fotos/capa mudaram em ${diaEvs(['titulo', 'fotos', 'thumb'])}` })
      if (!causas.length) causas.push({ causa: 'sazonal', sinal: 'nenhuma mudança registrada no anúncio: demanda do produto ou posição na busca (não medidas)' })
      const pr = priorEfetivo('queda_exposicao_anuncio'), f = P.queda_exposicao_anuncio.fracao_recuperada, perdidas = i.v0 - i.v, convRef = (i.conv ?? conv0 ?? 0) / 100
      const PASSO = { ads_desligou: 'Ads: confirmar por que a campanha parou (verba, pausa, reprovação) e religar se o ROAS da janela anterior justificava', preco_subiu: 'Preço: o ML reentrega menos o anúncio que ficou mais caro que a concorrência — avaliar UMA correção medida', conteudo_mudou: 'Conteúdo: comparar título/capa anteriores com os atuais (palavra-chave perdida?) e restaurar se nada justificar', sazonal: 'Sem sinal no anúncio: comparar com o calendário comercial e com a busca do termo; registrar a hipótese no card' }
      out.push({ regra: 'queda_exposicao_anuncio', item: i, urgencia: 3, esforco: 2, causal: causas[0].causa === 'sazonal' ? 40 : 65, evidencia_tipo: 'fato', causas, confirmar_com: ['impressões orgânicas (NOT_AVAILABLE)', 'posição na busca (NOT_SUPPORTED)', 'histórico de Ads e mudanças no card'],
        titulo: `Visitas caíram contra o próprio histórico: ${nome}`,
        problema: `${i.v} visitas contra ${i.v0} nos 28 dias anteriores (${virg(varPct(i.v, i.v0))}%), enquanto os anúncios sem mudança variaram ${virg(varCtrlVis)}%`,
        evidencia: `visitas ${i.v0} → ${i.v}; unidades ${i.u0} → ${i.u}. Controle (${ctrl.n} anúncio(s) sem mudança): ${ctrl.v0} → ${ctrl.v} visitas (${virg(varCtrlVis)}%). Sinais: ${causas.map(c => c.sinal).join('; ')}.`,
        hipotese: `A queda de visitas com o controle estável é FATO; a causa provável é ${causas[0].causa.replace(/_/g, ' ')} — HIPÓTESE por sinal (a exposição depende da posição na busca do ML, que não é medida).`,
        como: [...causas.map(c => PASSO[c.causa]), ...(org !== 'nao' ? [TX] : []), 'Registrar no card o que mudou e a data', 'Medir visitas/dia em 14 dias contra os anúncios sem mudança'],
        indicador: `${pctTxt(i.v / 28)} visitas/dia (antes ${pctTxt(i.v0 / 28)})`, meta: `visitas/dia ≥ ${pctTxt((i.v + perdidas * f[1]) / 28)} em 14 dias`, aceite: 'Causa testada registrada e visitas/dia comparadas com o controle em 14 dias',     // pctTxt: 0,04/dia nunca vira 0
        prev: previsao({ regra: 'queda_exposicao_anuncio', formula: 'unidades recuperadas = visitas perdidas × fração recuperada × conversão do anúncio', premissas: [`visitas perdidas = ${perdidas}`, `fração recuperada ${fr(f)} (premissa)`, `conversão ${pctTxt(convRef * 100)}%`], valores: { conservador: perdidas * f[0] * convRef, base: perdidas * f[1] * convRef, otimista: perdidas * f[2] * convRef }, preco: i.preco, prior: pr }),
        demanda: 'Otimizar Anúncios', dimensao: 'Demanda e visibilidade' })
    }

    // 13) QUEDA DE CTR EM ADS contra a própria janela anterior, com o CTR de Ads da conta estável; em catálogo de terceiros a capa não é do vendedor (bloqueada no config).
    //     FATO só com cliques suficientes na janela anterior (4 → 3 cliques não é queda) e as janelas da conta inteiras (mesmo corte das demais quedas)
    const a0 = i.ads_ant, ctrConta = ads.ctr, ctrConta0 = ads.anterior?.ctr
    if (!janelasIncompletas && a && a0 && a0.clicks >= L.ads_min_cliques_sem_venda && a.prints >= L.ads_min_impressoes_ctr && a0.prints >= L.ads_min_impressoes_ctr && a.ctr != null && a0.ctr > 0 && a.ctr <= a0.ctr * (1 - L.queda_ctr_pct / 100)
      && ctrConta != null && ctrConta0 > 0 && varPct(ctrConta, ctrConta0) > -L.controle_max_queda_pct && !regraBloqueada('queda_ctr_ads', org)) {
      const pr = priorEfetivo('queda_ctr_ads'), f = P.queda_ctr_ads.fracao_recuperada
      const cliquesPerdidos = a.prints * (a0.ctr - a.ctr) / 100, convClique = a.clicks > 0 ? a.unidades / a.clicks : (i.conv ?? 0) / 100, risco = cliquesPerdidos * convClique * (i.preco || 0)
      out.push({ regra: 'queda_ctr_ads', item: i, urgencia: 3, esforco: 2, causal: 60, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas: [{ causa: 'capa_titulo_preco', sinal: `CTR ${pctTxt(a.ctr)}% contra ${pctTxt(a0.ctr)}% na janela anterior, com a conta em ${pctTxt(ctrConta)}% (antes ${pctTxt(ctrConta0)}%)` }, ...(mudouConteudo ? [{ causa: 'conteudo_mudou', sinal: `título/fotos/capa mudaram em ${diaEvs(['titulo', 'fotos', 'thumb'])}` }] : []), ...(mudouPreco ? [{ causa: 'preco', sinal: historicoPreco(i) }] : [])], confirmar_com: ['CTR orgânico (NOT_AVAILABLE)', 'mudanças de capa/título no card', 'preço dos concorrentes na busca (NOT_SUPPORTED)'],
        titulo: `CTR do Ads caiu contra o próprio histórico: ${nome}`,
        problema: `CTR de Ads ${pctTxt(a.ctr)}% contra ${pctTxt(a0.ctr)}% na janela anterior (${virg(varPct(a.ctr, a0.ctr))}%), com o CTR da conta em ${virg(varPct(ctrConta, ctrConta0))}%`,
        evidencia: `${a.prints} impressões e ${a.clicks} cliques (CTR ${pctTxt(a.ctr)}%) contra ${a0.prints} / ${a0.clicks} (CTR ${pctTxt(a0.ctr)}%); CTR de Ads da conta ${pctTxt(ctrConta0)}% → ${pctTxt(ctrConta)}%.`,
        hipotese: 'A queda do CTR com a conta estável é FATO; que a capa, o título ou o preço do anúncio patrocinado causaram a queda é HIPÓTESE — o CTR orgânico não é medido.',
        como: ['Comparar a capa e o título atuais com os da janela anterior (histórico do card) e com os 3 anúncios mais vendidos do termo', 'Trocar a capa (produto inteiro, fundo branco, benefício visível) OU o título — uma mudança por vez', ...(org === 'proprio' ? [TX] : []), 'Medir o CTR de Ads em 14 dias contra o CTR da conta'],
        indicador: `CTR de Ads ${pctTxt(a.ctr)}%`, meta: `CTR ≥ ${pctTxt(a.ctr + (a0.ctr - a.ctr) * f[1])}% em 14 dias`, aceite: 'Mudança registrada com data e CTR comparado com o da conta em 14 dias',
        prev: previsao({ regra: 'queda_ctr_ads', tipo: 'risco_evitado', formula: 'receita em risco = cliques que as impressões deixaram de gerar × conversão por clique × preço × fração recuperada', premissas: [`cliques perdidos ≈ ${Math.round(cliquesPerdidos)} (impressões × queda do CTR)`, `conversão por clique ${pctTxt(100 * convClique)}% (Ads; sem ela, a do anúncio)`, `fração recuperada ${fr(f)} (premissa)`], valores: { conservador: risco * f[0], base: risco * f[1], otimista: risco * f[2] }, prior: pr }),
        demanda: 'Melhorar Imagens', dimensao: 'Clique e atração' })
    }

    // 14) MARGEM NEGATIVA — só com custos (sem custo nunca se afirma prejuízo): antes de Ads (margemPct ≤ 0) ou depois de Ads: margem − custo de Ads ÷ receita TOTAL
    //     do anúncio (TACOS do anúncio, a mesma definição de margem_pos_ads da conta; Ads descontado uma vez) ≤ 0. ACOS acima da margem é OUTRO sinal ("vendas
    //     atribuídas a Ads sem margem": só as vendas do clique não se pagam), nunca margem negativa do anúncio: entra como causa à parte aqui ou no ads_reduzir do anúncio.
    //     Janela atual com QUALQUER dia sem coleta ou truncado: a receita lida é piso (o custo de Ads vem inteiro da API de Ads), o TACOS sai inflado e a margem
    //     com Ads, menor que a real — piso negativo não prova margem negativa → sem margem com Ads (null). A conta mostra o número marcado "parcial"; aqui não se afirma.
    //     ponytail: truncados chega somado das duas janelas (data_quality): truncado só na anterior também corta (conservador); separar quando a conta expuser por janela
    // F4 (chave): margem MEDIDA nos pedidos vence a estimada pelos percentuais da conta — DEPOIS do imposto quando o cliente informou o percentual (o mesmo que
    // margemPct desconta); só sem ele vale a margem antes do imposto (monotônica: ≤ 0 antes ⇒ ≤ 0 depois)
    const med = medida(i), depImp = med?.antes_do_imposto === false && med.margem_depois_imposto_pct != null
    const mPre = med ? (depImp ? med.margem_depois_imposto_pct : med.margem_pct) : cc ? margemPct(cc, i.preco, i.custo_unitario) : null
    // sem arredondar: a decisão (≤ 0) e o texto leem o valor inteiro (TACOS de 0,0033% não vira 0; margem de 0,04% não vira 0)
    const tacosItem = mPre != null && a?.custo > 0 && i.r > 0 && !semColAtual && !cobP?.truncados ? 100 * a.custo / i.r : null
    const mPos = tacosItem != null ? mPre - tacosItem : null
    const negAntes = mPre != null && mPre <= 0, negDepois = !negAntes && mPos != null && mPos <= 0
    const semMargemAds = mPre > 0 && a?.acos != null && a.acos > mPre ? { causa: 'vendas_ads_sem_margem', sinal: `vendas atribuídas a Ads sem margem: ACOS ${virg(a.acos)}% acima da margem de ${virg(mPre)}% antes de Ads` } : null
    // ponytail: sem margem negativa nem ads_reduzir no anúncio o sinal não vira ação própria (seria regra nova, declarada em config/algoritmo.json)
    if (!negAntes && !negDepois && semMargemAds) { const red = out.find(o => o.item === i && o.regra === 'ads_reduzir'); if (red) (red.causas ||= []).push(semMargemAds) }
    if (negAntes || negDepois) {
      const pr = priorEfetivo('margem_negativa'), f = P.margem_negativa.fracao_estancada, m = negAntes ? mPre : mPos, perda = i.u * Math.abs(m) / 100 * (i.preco || 0)
      const k = med?.completas, c2 = x => reais(x / 100)
      const base = med ? `nas vendas pagas de 28 dias com custo e frete lidos (${Math.round(med.cobertura * 100)}% da receita): receita ${c2(k.receita_c)}${k.reembolso_c ? ` − reembolsos ${c2(k.reembolso_c)}` : ''} − tarifas do ML ${c2(k.tarifa_c)} − frete ${c2(k.frete_c)} − custo ${c2(k.custo_c)} = ${c2(k.lucro_c)}${depImp ? ` − imposto informado ${c2(k.imposto_c)} = ${c2(k.lucro_c - k.imposto_c)} (margem medida ${pctTxt(mPre)}%, depois do imposto)` : ` (margem medida ${pctTxt(mPre)}%, antes do imposto)`}`
        : `${i.custo_unitario != null ? custoTxt(i) : `CMV ${virg(cc.cmv_pct)}% da conta`} + imposto ${virg(cc.imposto_pct)}% + comissão ${virg(cc.comissao_pct)}%${cc.frete_pct ? ` + frete ${virg(cc.frete_pct)}%` : ''}${cc.embalagem_pct ? ` + embalagem ${virg(cc.embalagem_pct)}%` : ''}${cc.outros_pct ? ` + outros ${virg(cc.outros_pct)}%` : ''} → margem ${pctTxt(mPre)}%`
      out.push({ regra: 'margem_negativa', item: i, urgencia: 5, esforco: 1, causal: 85, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas: [{ causa: negAntes ? 'preco_abaixo_do_custo' : 'ads_consome_a_margem', sinal: negAntes ? `margem ${med ? 'medida' : 'estimada'} ${pctTxt(mPre)}% antes de Ads` : `margem ${pctTxt(mPre)}% − TACOS do anúncio ${pctTxt(tacosItem)}% = ${pctTxt(mPos)}%` }, ...(semMargemAds ? [semMargemAds] : [])],
        confirmar_com: med ? ['custo vigente do produto com o cliente'] : ['custo vigente do produto com o cliente', 'comissão e frete reais do pedido (NOT_COLLECTED)'],
        titulo: `Margem negativa ${negAntes ? 'antes de Ads' : 'com Ads'}: ${nome}`,
        problema: `Margem de contribuição ${med ? 'medida nos pedidos' : 'estimada'} ${pctTxt(m)}% ${negAntes ? 'antes de Ads' : `depois de Ads (custo de Ads = ${pctTxt(tacosItem)}% da receita do anúncio)`} no preço ${reais(i.preco)}`,
        evidencia: `${base}${tacosItem != null ? `; custo de Ads ${brl(a.custo)} ÷ receita do anúncio ${brl(i.r)}: TACOS do anúncio ${pctTxt(tacosItem)}% → ${pctTxt(mPos)}% depois de Ads` : ''}${semMargemAds ? `; ACOS ${virg(a.acos)}% (só as vendas atribuídas a Ads)` : ''}; ${i.u} un em 28 dias.`,
        hipotese: med ? `A margem é MEDIDA nos pedidos (receita, tarifa e frete reais; ${depImp ? 'depois do imposto informado' : 'antes do imposto, não informado'}) com o custo informado pelo cliente (FATO condicionado ao custo); se o custo real for outro, o número muda — confirmar com o cliente antes de mexer no preço.`
          : 'A margem é estimativa com os custos informados (FATO condicionado a eles); se o custo real for outro, o número muda — confirmar com o cliente antes de mexer no preço.',
        como: [negAntes ? 'Corrigir o preço até a margem ficar > 0 (simular com os custos informados) ou tirar o anúncio da promoção; não vender abaixo do custo' : 'Reduzir ou pausar o Ads deste anúncio até o custo de Ads caber na margem; revisar o preço se a venda orgânica não segurar', 'Confirmar o custo vigente com o cliente', 'Registrar no card o preço/verba antes e depois'],
        indicador: `margem ${pctTxt(m)}%`, meta: 'margem de contribuição > 0 (e ≥ a desejada, se informada)', aceite: 'Preço ou verba corrigidos com data e margem recalculada > 0',
        prev: previsao({ regra: 'margem_negativa', tipo: 'risco_evitado', formula: 'perda evitada = unidades 28d × |margem| × preço × fração estancada', premissas: [`unidades 28d = ${i.u}`, `margem ${pctTxt(m)}%`, `fração estancada ${fr(f)} (premissa)`], valores: { conservador: perda * f[0], base: perda * f[1], otimista: perda * f[2] }, prior: pr }),
        demanda: 'Atualizar Preços', dimensao: 'Rentabilidade' })
    }

    // 15) ADS ABAIXO DA META DO MÊS (metas_cliente): ACOS acima do máximo ou ROAS abaixo da meta; não repete o anúncio que já recebeu ads_reduzir; sem meta, nada
    //     Anúncio com alinhamento de campanha de visibilidade com ACOS alvo (src/lib/alinhamentos.js): o alvo combinado com o cliente substitui a meta da conta
    const alvo = ctx.acosAlvo?.get(i.id), M = alvo != null ? { acos_max: alvo, roas: null } : diag.metas, rotM = alvo != null ? 'alvo alinhado com o cliente' : 'meta do mês'
    if (M && adsAtivo && a.custo >= L.ads_min_custo_avaliar && !out.some(o => o.item === i && o.regra === 'ads_reduzir')) {
      const fora = Mx => (Mx.acos_max != null && a.acos != null && a.acos > Mx.acos_max) || (Mx.roas != null && a.roas != null && a.roas < Mx.roas)
      const foraAcos = M.acos_max != null && a.acos != null && a.acos > M.acos_max, foraRoas = M.roas != null && a.roas != null && a.roas < M.roas
      if (!foraAcos && !foraRoas && alvo != null && diag.metas && fora(diag.metas)) ctx.alinhado?.()   // fora da meta da conta, dentro do alvo alinhado: não nasce e conta
      if (foraAcos || foraRoas) {
        const pr = priorEfetivo('ads_abaixo_meta'), f = P.ads_abaixo_meta.fracao_excedente
        const acosAlvo = M.acos_max ?? (M.roas ? r1(100 / M.roas) : null), excedente = acosAlvo != null ? Math.max(0, a.custo - a.receita * acosAlvo / 100) : a.custo * 0.3
        out.push({ regra: 'ads_abaixo_meta', item: i, urgencia: 3, esforco: 1, causal: 70, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas: [{ causa: foraAcos ? 'acos_acima_da_meta' : 'roas_abaixo_da_meta', sinal: foraAcos ? `ACOS ${a.acos}% > meta ${M.acos_max}%` : `ROAS ${a.roas} < meta ${M.roas}` }], confirmar_com: ['campanha e lance do anúncio no painel de Ads (NOT_SUPPORTED: id de campanha não coletado)'],
          titulo: `Ads fora ${alvo != null ? 'do' : 'da'} ${rotM}: ${nome}`,
          problema: `${foraAcos ? `ACOS ${a.acos}% contra o máximo de ${M.acos_max}%` : `ROAS ${a.roas} contra a meta ${M.roas}`} com ${brl(a.custo)} gastos em 28 dias`,
          evidencia: `custo ${brl(a.custo)}, receita atribuída ${brl(a.receita)}, ACOS ${a.acos ?? '—'}%, ROAS ${a.roas ?? '—'}; ${rotM}: ${[M.acos_max != null ? `ACOS ≤ ${M.acos_max}%` : '', M.roas != null ? `ROAS ≥ ${M.roas}` : ''].filter(Boolean).join(', ')}.`,
          hipotese: (alvo != null ? 'O alvo é o combinado com o cliente para a campanha de visibilidade (FATO)' : 'A meta é a cadastrada pelo time (FATO)') + '; que baixar lance ou verba traga o anúncio para a meta sem perder venda orgânica é HIPÓTESE (atribuição de Ads não prova incremento).',
          como: ['Baixar o lance/verba deste anúncio ou tirá-lo da campanha até o ACOS caber na meta', 'Realocar a verba para anúncios dentro da meta', 'Reavaliar em 7 e 14 dias (a atribuição atrasa)'],
          indicador: foraAcos ? `ACOS ${a.acos}%` : `ROAS ${a.roas}`, meta: foraAcos ? `ACOS ≤ ${M.acos_max}%` : `ROAS ≥ ${M.roas}`, aceite: 'Ajuste registrado com data e ACOS/ROAS do anúncio conferidos em 14 dias',
          prev: previsao({ regra: 'ads_abaixo_meta', tipo: 'risco_evitado', formula: 'custo excedente = custo − receita atribuída × ACOS alvo; parte realocável = excedente × fração', premissas: [acosAlvo != null ? `ACOS alvo ${acosAlvo}%` : 'sem ACOS alvo: 30% do custo (premissa)', `fração realocável ${fr(f)} (premissa)`], valores: { conservador: excedente * f[0], base: excedente * f[1], otimista: excedente * f[2] }, prior: pr }),
          demanda: 'Ajuste ADS', dimensao: 'Demanda e visibilidade' })
      }
    }
  }

  // 16) ANÚNCIO RESTRITO: pausado / em revisão / inativo que vendia no período anterior (fica fora do filtro de relevância atual: a receita de agora é zero por construção)
  const gmv0 = diag.resumo.gmv_anterior || 0
  for (const i of it.filter(x => ['paused', 'under_review', 'inactive'].includes(x.status) && x.r0 > 0 && x.r0 >= gmv0 * F.min_impacto_pct_gmv / 100)) {
    const pr = priorEfetivo('anuncio_restrito'), f = P.anuncio_restrito.fracao_recuperada, nome = curto(i.titulo), rot = { paused: 'pausado', under_review: 'em revisão', inactive: 'inativo' }[i.status]
    out.push({ regra: 'anuncio_restrito', item: i, urgencia: 4, esforco: 2, causal: 80, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas: [{ causa: 'pausa_ou_moderacao', sinal: `status ${i.status} na última leitura` }], confirmar_com: ['sub_status/moderação — NOT_COLLECTED', 'decisão do cliente (pausa intencional?)'],
      titulo: `Anúncio ${rot} que vendia: ${nome}`,
      problema: `Status ${i.status}; vendeu ${brl(i.r0)} (${i.u0} un) nos 28 dias anteriores e ${brl(i.r)} nos atuais`,
      evidencia: `status ${i.status} na última leitura do anúncio; receita ${brl(i.r0)} → ${brl(i.r)}; unidades ${i.u0} → ${i.u}.`,
      hipotese: 'O status é FATO; o motivo (pausa do cliente, falta de estoque, moderação do ML) não é coletado — confirmar antes de reativar.',
      como: ['Conferir no painel do vendedor o sub_status e o motivo (moderação, qualidade, estoque, pausa manual)', 'Se foi moderação: corrigir o que o ML apontou e pedir revisão; se foi pausa do cliente: registrar o motivo no card', 'Reativar e medir unidades em 14 dias'],
      indicador: `status ${i.status}`, meta: `anúncio ativo com vendas ≥ ${Math.round(i.u0 * f[1])} un/28d`, aceite: 'Motivo registrado e anúncio ativo (ou decisão de manter pausado registrada)',
      prev: previsao({ regra: 'anuncio_restrito', tipo: 'risco_evitado', formula: 'receita em risco = receita do período anterior × fração recuperada ao reativar', premissas: [`receita anterior ${brl(i.r0)}`, `fração recuperada ${fr0(f)} (premissa)`], valores: { conservador: i.r0 * f[0], base: i.r0 * f[1], otimista: i.r0 * f[2] }, prior: pr }),
      demanda: 'Corrigir Anúncios', dimensao: 'Conversão e oferta' })
  }

  // 17) CONCENTRAÇÃO DE RECEITA (ação de CONTA, item null): o nº 1 responde por ≥ limiar do GMV — problema (dependência) e oportunidade (diversificar). O 40 vive em
  //     config/retroalimentacao.json → pareto.top1_alerta_pct (Merovíngio); sem ele, o fallback de config/algoritmo.json
  const top = it.reduce((m, i) => !m || i.r > m.r ? i : m, null), limTop1 = cfgRetro.pareto?.top1_alerta_pct ?? L.pareto_top1_alerta_pct ?? 40
  if (top && gmv > 0 && top.share_pct >= limTop1) {
    const pr = priorEfetivo('concentracao_receita'), f = P.concentracao_receita.fracao_exposta
    out.push({ regra: 'concentracao_receita', item: null, alvo: top.id, urgencia: 3, esforco: 3, causal: 50, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas: [{ causa: 'dependencia_de_um_anuncio', sinal: `${pctTxt(top.share_pct)}% do GMV em ${top.id}` }], confirmar_com: ['estoque e prazo de reposição do campeão com o cliente', 'caixa de compra e status do campeão (leitura diária)'],
      titulo: `Receita concentrada em um anúncio (${pctTxt(top.share_pct)}% do GMV): ${curto(top.titulo, 40)}`,
      problema: `O anúncio ${top.id} responde por ${pctTxt(top.share_pct)}% do GMV de 28 dias (limiar ${limTop1}%) — ruptura, perda da caixa de compra ou moderação dele derruba a conta`,
      evidencia: `${brl(top.r)} de ${brl(gmv)} em 28 dias no anúncio ${top.id}${top.cobertura != null ? `; cobertura ${top.cobertura} dia(s)` : ''}${top.catalogo ? `; catálogo${top.buy_box === false ? ' SEM a caixa de compra' : ''}` : ''}.`,
      hipotese: 'A concentração é FATO; o risco é HIPÓTESE de um evento no campeão. A oportunidade é abrir uma segunda fonte de receita (duplicação estratégica, kit, segundo público) — ver as ações do próprio campeão.',
      como: ['Proteger o campeão: estoque (cobertura ≥ atenção), caixa de compra e status conferidos semanalmente; responder a qualquer moderação no dia', 'Consultor: definir a 2ª fonte de receita (duplicação estratégica com objetivo, kit ou segundo público) e o briefing ao analista', 'Medir a participação do nº 1 no GMV a cada 28 dias'],
      indicador: `top 1 = ${pctTxt(top.share_pct)}% do GMV`, meta: `top 1 ≤ ${limTop1}% do GMV sem o campeão cair`, aceite: 'Proteção do campeão registrada e 2ª fonte de receita definida pelo consultor',
      prev: previsao({ regra: 'concentracao_receita', tipo: 'risco_evitado', formula: 'receita exposta = receita do campeão × fração exposta a um evento em 28 dias', premissas: [`receita do campeão ${brl(top.r)}/28d`, `fração exposta ${fr0(f)} (premissa: nenhuma probabilidade de ruptura/moderação é medida)`], valores: { conservador: top.r * f[0], base: top.r * f[1], otimista: top.r * f[2] }, prior: pr }),
      demanda: 'Duplicar anúncios', dimensao: 'Demanda e visibilidade', dados_extra: { oportunidade: `Diversificar a receita: duplicação estratégica, kit ou segundo público do anúncio ${top.id}`, alvo_anuncio: { id: top.id, titulo: top.titulo, permalink: top.permalink, share_pct: top.share_pct } } })
  }

  // 18) SAÚDE DA CONTA (v1.5.0, 09/10/2026): leitura GRAVADA do dia (saude-coleta → lerSaude: hoje ou ontem). Bloco com pendente (403 = permissão do app, endpoint não
  //     verificado, API indisponível) ou sem linha do dia → a regra NÃO nasce: data_quality já declara o motivo e ausente nunca é zero. Limiares em config/algoritmo.json
  //     (os da reputação são premissa: limites públicos do nível verde, conferir no painel). Nada aqui responde, despacha ou mexe no Full: o cliente executa (Chaveiro: caminho cliente).
  const S = lerSaude(diag.cliente, { hoje: diag.hoje }), okS = k => !!S.do_dia && !S.pendente?.[k]
  const ticket = diag.resumo.ticket > 0 ? diag.resumo.ticket : null, dmS = S.dia ? dm(S.dia) : ''
  const NIVEL = { '5_green': 'verde', '4_light_green': 'verde-claro', '3_yellow': 'amarelo', '2_orange': 'laranja', '1_red': 'vermelho' }, nivelTxt = n => NIVEL[n] || (n ? 'sem nível' : '—')
  // anúncio sem venda nem Ads em 56 d não está em diag.itens — e Full parado há 60+ dias é justamente esse caso: item mínimo lido de meli_item (curva C, sem série)
  const itemDe = id => { const i = it.find(x => x.id === id); if (i) return i; const r = db.prepare('SELECT item_id, titulo, permalink, thumb, preco, catalogo, status FROM meli_item WHERE cliente = ? AND item_id = ?').get(diag.cliente, id); return r ? { id: r.item_id, titulo: r.titulo, permalink: r.permalink, thumb: r.thumb, preco: r.preco, catalogo: !!r.catalogo, status: r.status, curva: 'C', classe: 'C2', u: 0, r: 0, u0: 0, r0: 0, v: null, conv: null, custo_unitario: null } : null }
  // 18a) REPUTAÇÃO EM RISCO (conta): nível fora do verde OU, com amostra, taxa ≥ 80 % do limite do nível (limites = premissa)
  if (okS('reputacao')) {
    const R = S.reputacao, ROT = { reclamacoes: 'reclamações', atrasos: 'atrasos', cancelamentos: 'cancelamentos' }
    const lim = { reclamacoes: [R.taxa_claims, L.reputacao_claims_max_pct], atrasos: [R.taxa_atraso, L.reputacao_atraso_max_pct], cancelamentos: [R.taxa_cancel, L.reputacao_cancel_max_pct] }
    const amostra = R.vendas_periodo != null && R.vendas_periodo >= L.reputacao_min_vendas
    const causas = amostra ? Object.entries(lim).filter(([, [t, m]]) => t != null && t >= m * L.reputacao_fracao_alerta).map(([c, [t, m]]) => ({ causa: c, sinal: `${ROT[c]} ${pctTxt(t)}% contra o limite de ${m}% do nível verde (premissa; alerta a partir de ${Math.round(L.reputacao_fracao_alerta * 100)}% do limite)` })) : []
    const foraVerde = !!R.nivel && R.nivel !== '5_green'
    if (foraVerde) causas.unshift({ causa: 'nivel_fora_do_verde', sinal: `nível ${nivelTxt(R.nivel)} na leitura de ${dmS}` })
    if (causas.length) {
      const pr = priorEfetivo('reputacao_em_risco'), f = P.reputacao_em_risco.fracao_exposta
      const PASSO = { nivel_fora_do_verde: 'Abrir o painel de reputação do vendedor e anotar qual indicador tirou a conta do verde', reclamacoes: 'Reclamações: responder as abertas hoje e tratar a causa recorrente (produto, prazo, descrição)', atrasos: 'Atrasos: despachar hoje o que está vencido e ajustar a capacidade de expedição ao prazo', cancelamentos: 'Cancelamentos: conferir estoque real × anunciado e pausar o que não tem como entregar' }
      out.push({ regra: 'reputacao_em_risco', item: null, alvo: 'conta', urgencia: 4, esforco: 2, causal: 70, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas, confirmar_com: ['painel de reputação do vendedor (limites do nível por categoria)', 'listas gravadas do dia (reclamações e atrasos)'],
        titulo: foraVerde ? `Reputação fora do verde (${nivelTxt(R.nivel)}): recuperar o nível da conta` : 'Reputação em risco: taxa perto do limite do nível',
        problema: foraVerde ? `A conta está no nível ${nivelTxt(R.nivel)}${R.medalha ? ` (${R.medalha})` : ''} na leitura de ${dmS} — a exposição de todos os anúncios depende do nível` : `Taxa(s) da reputação a ${Math.round(L.reputacao_fracao_alerta * 100)}% ou mais do limite do nível verde: ${causas.map(c => ROT[c.causa]).join(', ')}`,
        evidencia: `Leitura de ${dmS}: nível ${nivelTxt(R.nivel)}, reclamações ${pctTxt(R.taxa_claims)}%, atrasos ${pctTxt(R.taxa_atraso)}%, cancelamentos ${pctTxt(R.taxa_cancel)}% sobre ${R.vendas_periodo ?? '—'} vendas do período da reputação. Limites do nível verde (premissa, conferir no painel): ${L.reputacao_claims_max_pct}% / ${L.reputacao_atraso_max_pct}% / ${L.reputacao_cancel_max_pct}%.${amostra ? '' : ` Amostra abaixo de ${L.reputacao_min_vendas} vendas: as taxas não foram avaliadas.`}`,
        hipotese: 'O nível e as taxas são FATO da leitura do dia; que a perda de nível derrube a exposição e as vendas é HIPÓTESE (a fração do GMV exposta é premissa).',
        como: [...causas.map(c => PASSO[c.causa]), 'Registrar no card o indicador e o valor na leitura de saúde seguinte'],
        indicador: `nível ${nivelTxt(R.nivel)}; reclamações ${pctTxt(R.taxa_claims)}%, atrasos ${pctTxt(R.taxa_atraso)}%, cancelamentos ${pctTxt(R.taxa_cancel)}%`, meta: `nível verde com todas as taxas abaixo de ${Math.round(L.reputacao_fracao_alerta * 100)}% do limite`, aceite: 'Leitura de saúde seguinte com o nível e as taxas registrados no card',
        prev: previsao({ regra: 'reputacao_em_risco', tipo: 'risco_evitado', formula: 'receita exposta = GMV de 28 dias × fração exposta à perda de nível', premissas: [`GMV 28d ${brl(gmv)}`, `fração exposta ${fr0(f)} (premissa: a queda de exposição por nível não é medida)`], valores: { conservador: gmv * f[0], base: gmv * f[1], otimista: gmv * f[2] }, prior: pr }),
        demanda: 'Reunião de Alinhamento', dimensao: 'Saúde da conta' })
    }
  }
  // 18b) ENVIO ATRASADO (conta, urgência 5): ≥ 1 pedido pago com prazo de despacho vencido e não despachado — "despachar hoje"; a pendência despacho_prazo ganha o mesmo dado
  if (okS('atrasos') && S.atrasos >= 1) {
    const pr = priorEfetivo('envio_atrasado'), f = P.envio_atrasado.fracao_em_risco, n = S.atrasos, lst = S.listas.atrasos.slice(0, 5), risco = ticket ? n * ticket : 0
    out.push({ regra: 'envio_atrasado', item: null, alvo: 'conta', urgencia: 5, esforco: 1, causal: 85, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado', causas: [{ causa: 'despacho_vencido', sinal: `${n} pedido(s) pago(s) com prazo de despacho vencido na leitura de ${dmS}` }], confirmar_com: ['painel de vendas do vendedor (envios pendentes)', 'capacidade de expedição com o cliente'],
      titulo: `Despachar hoje ${n} pedido(s) com prazo vencido`,
      problema: `${n} pedido(s) pago(s) dos últimos ${CFG_SAUDE.pedidos_dias} dias com prazo de despacho vencido e ainda não despachado(s)`,
      evidencia: `Leitura de ${dmS}: ${n} pedido(s) atrasado(s)${lst.length ? ` — ${lst.map(a => `${a.item_id || 'anúncio não identificado'}: ${a.dias_atraso} dia(s) de atraso`).join('; ')}${n > lst.length ? '; …' : ''}` : ''}.${ticket ? ` Ticket médio da conta ${reais(ticket)}.` : ' Ticket da conta não medido: sem valor em risco.'}`,
      hipotese: 'O atraso é FATO do envio; que o pedido vire cancelamento, reclamação ou queda de reputação é HIPÓTESE (a fração em risco é premissa).',
      como: ['Despachar hoje os pedidos atrasados — o despacho é do cliente; o sistema não movimenta pedidos', 'Se não há como despachar, avisar o comprador pelo canal e registrar o motivo no card', 'Conferir na leitura de saúde seguinte que o número de atrasos zerou'],
      indicador: `${n} pedido(s) atrasado(s)`, meta: '0 pedidos com prazo de despacho vencido na leitura seguinte', aceite: 'Pedidos despachados (ou motivo registrado) e leitura seguinte sem atraso',
      prev: previsao({ regra: 'envio_atrasado', tipo: 'risco_evitado', formula: 'receita em risco = pedidos atrasados × ticket médio × fração que viraria cancelamento ou reclamação', premissas: [`${n} pedido(s) atrasado(s)`, ticket ? `ticket médio ${reais(ticket)}` : 'ticket não medido: valor 0', `fração em risco ${fr0(f)} (premissa)`], valores: { conservador: risco * f[0], base: risco * f[1], otimista: risco * f[2] }, prior: pr }),
      demanda: 'Reunião de Alinhamento', dimensao: 'Saúde da conta', dependencia: 'Retorno do cliente' })
  }
  // 18c) RECLAMAÇÃO SEM RESPOSTA: mediação ou prazo < claim_prazo_horas; por anúncio quando a reclamação traz item_id, senão uma ação de conta
  if (okS('reclamacoes')) {
    const limite = Date.now() + L.claim_prazo_horas * 3600e3
    const urgentes = (S.listas.claims || []).filter(c => c.estagio === 'dispute' || (c.prazo_resposta && Date.parse(c.prazo_resposta) < limite))
    const grupos = new Map()
    for (const c of urgentes) { const k = c.item_id && itemDe(c.item_id) ? c.item_id : 'conta'; (grupos.get(k) || grupos.set(k, []).get(k)).push(c) }
    for (const [k, cs] of grupos) {
      const i = k === 'conta' ? null : itemDe(k), med = cs.filter(c => c.estagio === 'dispute').length, n = cs.length, preco = i?.preco > 0 ? i.preco : ticket
      const pr = priorEfetivo('reclamacao_sem_resposta'), f = P.reclamacao_sem_resposta.fracao_em_risco, risco = preco ? n * preco : 0, rot = med ? 'em mediação' : 'com prazo curto'
      out.push({ regra: 'reclamacao_sem_resposta', item: i, ...(i ? {} : { alvo: 'conta' }), urgencia: med ? 5 : 4, esforco: 1, causal: 80, evidencia_tipo: 'fato', tipo_prev: 'risco_evitado',
        causas: [...(med ? [{ causa: 'mediacao', sinal: `${med} reclamação(ões) em mediação` }] : []), ...(n > med ? [{ causa: 'prazo_curto', sinal: `${n - med} reclamação(ões) com menos de ${L.claim_prazo_horas} h para responder` }] : [])], confirmar_com: ['detalhe da reclamação no painel do vendedor (motivo e mensagens)'],
        titulo: i ? `Responder ${n} reclamação(ões) ${rot}: ${curto(i.titulo)}` : `Responder ${n} reclamação(ões) ${rot} sem anúncio identificado`,
        problema: `${n} reclamação(ões) aberta(s)${med ? `, ${med} em mediação` : ''} ${i ? 'no anúncio' : 'na conta'} na leitura de ${dmS}`,
        evidencia: `Leitura de ${dmS}: ${cs.map(c => c.estagio === 'dispute' ? 'mediação' : `prazo de resposta ${c.prazo_resposta ? dm(String(c.prazo_resposta).slice(0, 10)) : '—'}`).join('; ')}.${preco ? ` Valor de referência ${reais(preco)} por reclamação (${i?.preco > 0 ? 'preço do anúncio' : 'ticket médio da conta'}).` : ' Sem preço nem ticket: sem valor em risco.'}`,
        hipotese: 'A reclamação e o prazo são FATO do Mercado Livre; que a resposta no prazo evite a mediação e a perda do pedido é HIPÓTESE (a fração em risco é premissa).',
        como: ['Responder hoje pelo painel do vendedor com a solução (reenvio, devolução ou esclarecimento) — a resposta é do cliente', 'Se o motivo se repete, tratar a causa no anúncio (descrição, prazo, embalagem) e registrar no card', 'Conferir na leitura seguinte que a reclamação saiu de aberta ou de mediação'],
        indicador: `${n} reclamação(ões) aberta(s)${med ? `, ${med} em mediação` : ''}`, meta: 'reclamações respondidas dentro do prazo; nenhuma em mediação na leitura seguinte', aceite: 'Resposta registrada no painel e leitura seguinte sem reclamação urgente',
        prev: previsao({ regra: 'reclamacao_sem_resposta', tipo: 'risco_evitado', formula: 'valor em risco = reclamações urgentes × preço do anúncio (ou ticket) × fração em risco', premissas: [`${n} reclamação(ões)`, preco ? `preço de referência ${reais(preco)}` : 'sem preço: valor 0', `fração em risco ${fr0(f)} (premissa)`], valores: { conservador: risco * f[0], base: risco * f[1], otimista: risco * f[2] }, prior: pr }),
        demanda: 'Reunião de Alinhamento', dimensao: 'Saúde da conta', dependencia: 'Retorno do cliente' })
    }
  }
  // 18d) PERGUNTA SEM RESPOSTA (conta): ≥ perguntas_min_24h perguntas há mais de 24 h; com 403 (permissao_do_app) não nasce — o que falta no app está em data_quality
  if (okS('perguntas') && S.perguntas.mais_de_24h >= L.perguntas_min_24h) {
    const n = S.perguntas.mais_de_24h, H = CFG_SAUDE.perguntas_limite_horas, pr = priorEfetivo('pergunta_sem_resposta'), g = P.pergunta_sem_resposta.conversao_pergunta_pct
    const porItem = [...(S.listas.perguntas || []).filter(p => p.mais_de_24h).reduce((m, p) => m.set(p.item_id || 'anúncio não identificado', (m.get(p.item_id || 'anúncio não identificado') || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 5)
    out.push({ regra: 'pergunta_sem_resposta', item: null, alvo: 'conta', urgencia: 4, esforco: 1, causal: 60, evidencia_tipo: 'fato', causas: [{ causa: 'perguntas_sem_resposta', sinal: `${n} pergunta(s) sem resposta há mais de ${H} h` }], confirmar_com: ['caixa de perguntas do vendedor (o texto da pergunta não é gravado pelo sistema)'],
      titulo: `Responder ${n} pergunta(s) sem resposta há mais de ${H} h`,
      problema: `${n} de ${S.perguntas.abertas ?? n} pergunta(s) aberta(s) esperam resposta há mais de ${H} h na leitura de ${dmS}`,
      evidencia: `Leitura de ${dmS}: ${S.perguntas.abertas ?? '—'} pergunta(s) sem resposta, ${n} com mais de ${H} h${porItem.length ? ` — por anúncio: ${porItem.map(([id, k]) => `${id}: ${k}`).join('; ')}` : ''}.${ticket ? ` Ticket médio da conta ${reais(ticket)}.` : ' Ticket da conta não medido: sem cenário de venda.'}`,
      hipotese: 'A contagem é FATO; que parte das perguntas respondidas vire venda é HIPÓTESE (a conversão por pergunta é premissa).',
      como: ['Responder hoje as perguntas abertas pelo painel do vendedor — a resposta é do cliente', 'Anotar as dúvidas que se repetem e levar para a descrição e a ficha do anúncio (ação de conteúdo à parte)', `Conferir na leitura seguinte que nenhuma pergunta passa de ${H} h`],
      indicador: `${n} pergunta(s) há mais de ${H} h`, meta: `0 pergunta(s) sem resposta há mais de ${H} h na leitura seguinte`, aceite: 'Perguntas respondidas e leitura seguinte sem pergunta vencida',
      prev: previsao({ regra: 'pergunta_sem_resposta', formula: 'unidades = perguntas respondidas × conversão por pergunta (premissa)', premissas: [`${n} pergunta(s)`, `conversão por pergunta ${g.join('% / ')}% (premissa)`, ticket ? `ticket médio ${reais(ticket)}` : 'ticket não medido: receita 0'], valores: { conservador: n * g[0] / 100, base: n * g[1] / 100, otimista: n * g[2] / 100 }, preco: ticket || 0, prior: pr }),
      demanda: 'Reunião de Alinhamento', dimensao: 'Saúde da conta', dependencia: 'Retorno do cliente' })
  }
  // 18e) FULL COM ESTOQUE ANTIGO (anúncio): disponível > 0 e idade ≥ full_estoque_antigo_dias — idade_dias do Full quando existir; até lá, dias sem venda ESTIMADOS pela série
  //      (fonte declarada; evidência hipótese). Causa pelos custos: desconto que preserva a margem → promoção de giro (promocoes); senão retirada do Full ou informar custos (cliente).
  if (S.do_dia && !S.pendente?.full) {
    for (const fz of S.listas.full || []) {
      const idade = fz.idade_dias ?? fz.dias_sem_venda
      if (!(fz.disponivel > 0) || idade == null || idade < L.full_estoque_antigo_dias) continue
      const i = itemDe(fz.item_id); if (!i || (i.u || 0) > 0) continue       // trava (12/10): vendeu nos últimos 28 dias não é «parado» (o estoque compartilhado já vem por inventory_id da coleta)
      const estim = fz.idade_dias == null, org = origemCatalogo(i)
      const cmvItem = i.custo_unitario != null && i.preco > 0 ? r1(100 * i.custo_unitario / i.preco) : null
      const dmax = diag.custos_informados && cc ? descontoMaximoPct(cmvItem != null ? { ...cc, cmv_pct: cmvItem } : cc) : null, promo = dmax != null && dmax > 3
      const pr = priorEfetivo('full_estoque_antigo'), f = P.full_estoque_antigo.fracao_girada, precoPromo = promo ? (i.preco || 0) * (1 - dmax * 0.6 / 100) : (i.preco || 0)
      out.push({ regra: 'full_estoque_antigo', item: i, urgencia: 3, esforco: 2, causal: 55, evidencia_tipo: estim ? 'hipotese' : 'fato', executar_via: promo ? 'promocoes' : 'notion',
        causas: [promo ? { causa: 'giro_com_promocao', sinal: `desconto máximo que preserva a margem: ${virg(dmax)}%` } : { causa: 'retirada_do_full', sinal: diag.custos_informados ? 'sem desconto que preserve a margem: girar por promoção não cabe' : 'custos não informados: sem desconto seguro, a decisão é retirar ou informar custos' }],
        confirmar_com: ['idade do estoque no painel do Full (endpoint não verificado: o sistema estima pela série de vendas)', 'custo de armazenagem e tarifa de estoque antigo com o cliente'],
        titulo: `Estoque parado no Full há ${idade}+ dias: ${curto(i.titulo)}`,
        problema: `${fz.disponivel} un disponíveis no Full ${estim ? `sem venda registrada há ${idade} dia(s) (estimativa pela série de vendas)` : `com ${idade} dia(s) de idade`} — acima de ${L.full_estoque_antigo_dias} dias`,
        evidencia: `Leitura de ${dmS}: disponível ${fz.disponivel}${fz.nao_disponivel != null ? `, indisponível ${fz.nao_disponivel}` : ''}; ${estim ? `última venda registrada na série há ${idade} dia(s) — fonte: estimativa pela série de vendas (endpoint de idade do Full não verificado)` : `idade do estoque ${idade} dia(s) (leitura do Full)`}. ${promo ? `Desconto máximo que preserva a margem desejada: ${virg(dmax)}% (${cmvItem != null ? `CMV do próprio anúncio ${virg(cmvItem)}%` : 'CMV% da conta'}).` : diag.custos_informados ? 'Sem desconto que preserve a margem.' : 'Custos não informados: desconto seguro não existe.'}`,
        hipotese: `${estim ? 'A idade é ESTIMATIVA pela série (dias sem venda), não a leitura do Full; ' : 'A idade é leitura do Full; '}que girar por promoção ou retirar reduza o custo de armazenagem e recupere capital é HIPÓTESE (a fração girada é premissa).`,
        como: [promo ? `Promoção de giro com desconto de até ${Math.floor(dmax * 0.6)}% (60% do limite) por 14 dias` : 'Decidir com o cliente: retirar o estoque do Full ou informar custos para liberar uma promoção com margem', ...(org === 'terceiros' ? [TEXTO_CATALOGO.terceiros] : []), 'Conferir a idade real no painel do Full antes de agir', 'Medir unidades e disponível em 14 dias'],
        indicador: `${fz.disponivel} un parada(s) há ${idade} dia(s)${estim ? ' (estimativa)' : ''}`, meta: `disponível no Full ≤ ${Math.ceil(fz.disponivel * (1 - f[1]))} un em 14 dias`, aceite: 'Promoção ou retirada registrada com data e disponível conferido em 14 dias',
        prev: previsao({ regra: 'full_estoque_antigo', formula: 'unidades = disponível no Full × fração girada (premissa)', premissas: [`disponível ${fz.disponivel} un`, `fração girada ${fr0(f)} (premissa)`, promo ? `preço com desconto de ${Math.floor(dmax * 0.6)}%` : 'preço atual', ...(estim ? ['idade estimada pela série de vendas (endpoint não verificado)'] : [])], valores: { conservador: fz.disponivel * f[0], base: fz.disponivel * f[1], otimista: fz.disponivel * f[2] }, preco: precoPromo, prior: pr }),
        demanda: promo ? 'Campanhas de Desconto' : 'Planejamento full', dimensao: 'Estoque e logística', ...(diag.custos_informados ? {} : { dependencia: 'Custos do cliente (margem)' }) })
    }
  }

  // 8) SAZONALIDADE: um plano por janela relevante (anúncios curva A ou relacionados)
  for (const j of diag.janelas.filter(j => j.dias > 0 && j.n_produtos > 0 && j.estagio !== 'monitorar')) {
    const itens = it.filter(i => j.produtos.includes(i.id)).slice(0, 4)
    const pr = priorEfetivo('sazonal'), f = P.sazonal.fator_demanda
    for (const i of itens) {
      const nome = curto(i.titulo), org = origemCatalogo(i), TX = TEXTO_CATALOGO[org]
      const janelaDias = 14
      const base = i.vel_dia * janelaDias
      out.push({ regra: 'sazonal', alvo: j.evento, item: i, urgencia: j.dias <= 21 ? 4 : 3, esforco: 3, causal: 45, evidencia_tipo: 'hipotese',
        titulo: `${j.evento}: preparar ${nome}`, problema: `${j.evento} em ${j.dias} dias com este anúncio relacionado`,
        evidencia: `${j.evento} em ${j.data.split('-').reverse().join('/')} (${j.dias} dias); anúncio: ${i.u} un/28d, cobertura ${i.cobertura ?? '—'} dias. Limites: ${org === 'terceiros' ? '' : `conteúdo até ${j.limites.conteudo.split('-').reverse().join('/')}, `}reposição até ${j.limites.reposicao.split('-').reverse().join('/')}, campanha no ar até ${j.limites.campanha.split('-').reverse().join('/')}.`,
        hipotese: `${j.evidencia}.`, como: [org === 'nao' ? `Conteúdo e anúncio prontos até ${j.limites.conteudo.split('-').reverse().join('/')}` : org === 'terceiros' ? `Preço e caixa de compra conferidos até ${j.limites.campanha.split('-').reverse().join('/')}. ${TX}` : `${TX} Enviar a sugestão até ${j.limites.conteudo.split('-').reverse().join('/')}`, `Estoque garantido até ${j.limites.reposicao.split('-').reverse().join('/')} (cobertura atual ${i.cobertura ?? '—'} dias)`, `Campanha no ar até ${j.limites.campanha.split('-').reverse().join('/')}, com desconto só dentro da margem`, j.acao],
        indicador: `${i.u} un/28d`, meta: `vendas na janela ≥ ${Math.round(i.vel_dia * janelaDias * f[1])} un em ${janelaDias} dias`, aceite: org === 'terceiros' ? 'Estoque e campanha registrados antes dos limites' : 'Conteúdo, estoque e campanha registrados antes dos limites',
        prev: previsao({ regra: 'sazonal', formula: 'unidades extras = ritmo atual na janela × (fator de demanda − 1)', premissas: [`janela de ${janelaDias} dias`, `fator de demanda ${f.join(' / ')} (premissa do calendário comercial)`], valores: { conservador: base * (f[0] - 1), base: base * (f[1] - 1), otimista: base * (f[2] - 1) }, preco: i.preco, prior: pr, horizonte: janelaDias }),
        demanda: 'Campanhas de Desconto', dimensao: 'Demanda e visibilidade', prazoISO: (prazo => prazo > diag.hoje ? prazo : addDias(diag.hoje, 3))(org === 'terceiros' ? j.limites.reposicao : j.limites.conteudo) })
    }
  }

  // 9) URGÊNCIA OCULTA: hipóteses só para os 3 maiores campeões, prioridade baixa
  for (const i of it.filter(x => x.curva === 'A').slice(0, 3)) {
    const h = hipotesesUrgenciaOculta(i)[0], pr = priorEfetivo('urgencia_oculta'), g = P.urgencia_oculta.ganho_pct
    out.push({ regra: 'urgencia_oculta', item: i, urgencia: 1, esforco: 3, causal: 30, evidencia_tipo: 'hipotese',
      titulo: `Testar demanda oculta (${h.tipo.toLowerCase()}): ${curto(i.titulo, 40)}`, problema: 'Campeão de vendas com possível demanda ainda não explorada (kit, público ou termo de busca)',
      evidencia: `${i.u} un/28d, ${pctTxt(i.share_pct)}% do GMV. Nenhum dado observado sobre demanda oculta — tudo abaixo é HIPÓTESE ESTRATÉGICA.`, hipotese: h.hipotese,
      como: ['CONSULTOR (sempre): pesquisar a urgência oculta do produto — outros usos e funcionalidades, outros públicos, outras categorias e outras formas de busca; só com a pesquisa feita e os nichos de demanda real mapeados delegar ao analista (sem ela é aposta com o recurso do cliente)', h.teste, `Métrica: ${h.metrica}`, 'Não afirmar função ou benefício que o produto não tenha'],
      indicador: 'sem teste', meta: 'teste concluído em 14 dias com métrica registrada', aceite: 'Resultado do teste registrado (funcionou / não funcionou)',
      prev: previsao({ regra: 'urgencia_oculta', formula: 'ganho = unidades atuais × percentual de ganho do teste (premissa especulativa)', premissas: [`ganho ${g.join('% / ')}%`, 'sem evidência observada; probabilidade baixa'], valores: { conservador: i.u * g[0] / 100, base: i.u * g[1] / 100, otimista: i.u * g[2] / 100 }, preco: i.preco, prior: pr }),
      demanda: 'Criar Kits', dimensao: 'Demanda e visibilidade' })
  }

  // 10) CUSTOS: ação de conta que libera ROAS alvo e desconto máximo — só quando não há nem os percentuais da conta nem custo por anúncio (vínculo custo ↔ anúncio).
  //     F4 (chave): com tarifas e frete já MEDIDOS (cobertura ≥ mínimo), nasce também com o custo abaixo da cobertura mínima, listando os anúncios sem custo que somam
  //     80% da receita sem custo (Pareto medido) — a única peça que falta para o lucro
  const fc = MED ? diag.financeiro?.conta : null, minF = diag.financeiro?.minimo ?? 0.8
  // decisão pelos booleanos do agregar (cobertura CRUA ≥ mínimo): a cobertura exibida é arredondada e 79,5% nunca pode passar por 80%
  const tfMedido = !!fc && (fc.ok_taxas_frete ?? fc.cobertura_taxas_frete >= minF), semNenhum = !diag.custos_informados && !it.some(i => i.custo_unitario != null)
  if (tfMedido && (semNenhum || !(fc.ok_custo ?? fc.cobertura_custo >= minF))) {
    const sem = it.filter(i => i.custo_unitario == null && i.r > 0), tot = sem.reduce((t, i) => t + i.r, 0), lista = []
    let acum = 0; for (const i of sem) { if (acum >= tot * 0.8 || lista.length >= 10) break; lista.push(i); acum += i.r }
    out.push({ regra: 'cadastrar_custos', item: null, urgencia: 3, esforco: 1, causal: 80, evidencia_tipo: 'pendente',
      titulo: 'Informar o custo dos produtos que faltam para medir o lucro',
      problema: `Tarifas e frete já medimos; falta o custo de cada produto: ${Math.round((1 - fc.cobertura_custo) * 100)}% da receita de 28 dias está sem custo`,
      evidencia: `${Math.round(fc.cobertura_taxas_frete * 100)}% da receita com tarifa e frete lidos nos pedidos; custo informado em ${Math.round(fc.cobertura_custo * 100)}% (mínimo ${Math.round(minF * 100)}% para afirmar margem). ${lista.length} anúncio(s) somam ${Math.round(100 * acum / (tot || 1))}% da receita sem custo.`,
      hipotese: 'Com o custo destes produtos o plano passa a medir a margem de cada venda e a recusar Ads e promoção que destruam margem.',
      como: [`Pedir ao cliente o custo de: ${lista.map(i => `${curto(i.titulo, 40)} (${i.id})`).join('; ') || 'nenhum anúncio com venda sem custo'}`, 'Cadastrar na tela do cliente (Custos) ou ligar a planilha/ERP de custos', 'Regerar o plano'],
      indicador: `custo em ${Math.round(fc.cobertura_custo * 100)}% da receita`, meta: `custo em ≥ ${Math.round(minF * 100)}% da receita`, aceite: 'Custos salvos e margem medida exibida',
      prev: { tipo: 'pendencia', hipotese: false, cenarios: { conservador: { receita: 0 }, base: { receita: 0 }, otimista: { receita: 0 } }, p_sucesso: 0.9, p_fonte: 'ação administrativa', valor_esperado: 0, esperado: { conservador: 0, base: 0, otimista: 0 }, aviso: 'Sem estimativa de receita: é pré-requisito do lucro medido.' },
      demanda: 'Reunião de Alinhamento', dimensao: 'Rentabilidade' })
  } else if (semNenhum) {
    out.push({ regra: 'cadastrar_custos', item: null, urgencia: 3, esforco: 1, causal: 80, evidencia_tipo: 'pendente',
      titulo: 'Informar custos para liberar ROAS alvo e desconto máximo',
      problema: ads.custo > 0 ? `A conta investe ${brl(ads.custo)} em Ads/28 dias (ACOS ${pctTxt(ads.acos)}%, TACOS ${pctTxt(ads.tacos)}%) sem limite econômico definido` : 'A conta não tem Product Ads coletado e nenhum limite econômico definido (sem custos não existe ROAS alvo nem desconto máximo)',   // sem Ads o texto não imprime "null%"
      evidencia: 'Custos (CMV, comissão, impostos, frete, embalagem, margem desejada) não cadastrados — ROAS alvo, break-even e desconto máximo ficam em cenário.', hipotese: 'Com os custos, o plano passa a recusar Ads e promoção que destruam margem.',
      como: ['Reunir com o cliente: CMV, impostos, comissão do ML, frete subsidiado, embalagem e margem desejada', 'Cadastrar na tela do cliente (Custos)', 'Regerar o plano'],
      indicador: 'custos não informados', meta: 'custos cadastrados', aceite: 'Custos salvos e ROAS alvo calculado',
      prev: { tipo: 'pendencia', hipotese: false, cenarios: { conservador: { receita: 0 }, base: { receita: 0 }, otimista: { receita: 0 } }, p_sucesso: 0.9, p_fonte: 'ação administrativa', valor_esperado: 0, esperado: { conservador: 0, base: 0, otimista: 0 }, aviso: 'Sem estimativa de receita: é pré-requisito dos demais.' },
      demanda: 'Reunião de Alinhamento', dimensao: 'Rentabilidade' })
  }
  // V3 F3: SKU AUSENTE (conta) — anúncios ativos curva A/B sem SELLER_SKU oficial somando ≥ sku_ausente_min_pct_gmv do GMV (premissa): sem SKU o produto não junta anúncios
  //     de UPs diferentes, o custo por SKU e o estoque declarado não casam. Só com a chave produto.diagnostico_ligado (i.produto existe); assistido (card), teto 1
  const semSku = it.filter(i => produtoLigado(i) && i.status === 'active' && ['A', 'B'].includes(i.curva) && !i.produto.skus.length && i.produto.chaves_lidas !== false), rSem = semSku.reduce((t, i) => t + i.r, 0)
  if (semSku.length && rSem >= gmv * (L.sku_ausente_min_pct_gmv ?? 20) / 100) {
    const lista = semSku.slice(0, 10), pr = priorEfetivo('sku_ausente')
    out.push({ regra: 'sku_ausente', item: null, urgencia: 2, esforco: 2, causal: 60, evidencia_tipo: 'fato', refs_extra: lista.map(i => ({ titulo: i.titulo, url: i.permalink })),
      titulo: `Cadastrar o SKU nos ${semSku.length} anúncios que mais vendem sem SKU`,
      problema: `${semSku.length} anúncio(s) curva A/B sem SELLER_SKU somam ${pctTxt(100 * rSem / Math.max(gmv, 1))}% do GMV de 28 dias — sem SKU o sistema não junta o estoque do mesmo produto entre anúncios nem casa custo e estoque físico`,
      evidencia: `Sem SKU oficial (SELLER_SKU) na leitura dos anúncios: ${lista.map(i => `${curto(i.titulo, 40)} (${i.id}, ${brl(i.r)})`).join('; ')}${semSku.length > lista.length ? ` e mais ${semSku.length - lista.length}` : ''}.`,
      hipotese: 'Com o SKU cadastrado, anúncios do mesmo produto em cadastros diferentes passam a contar o mesmo estoque e o custo por SKU passa a valer — pré-requisito, não ganho de venda.',
      como: [`Cadastrar o SELLER_SKU (o mesmo código do estoque do cliente) em: ${lista.map(i => `${curto(i.titulo, 40)} (${i.id})`).join('; ')}`, 'Usar o MESMO código para anúncios do mesmo produto (tamanho/cor = códigos diferentes)', 'Na coleta seguinte, conferir em Produtos que os anúncios se juntaram'],
      indicador: `${semSku.length} anúncio(s) A/B sem SKU`, meta: 'todos os anúncios A/B com SELLER_SKU', aceite: 'SKU cadastrado e conferido na leitura seguinte',
      prev: { tipo: 'pendencia', hipotese: false, cenarios: { conservador: { receita: 0 }, base: { receita: 0 }, otimista: { receita: 0 } }, p_sucesso: pr.p, p_fonte: pr.fonte, valor_esperado: 0, esperado: { conservador: 0, base: 0, otimista: 0 }, aviso: 'Sem estimativa de receita: é cadastro, pré-requisito do produto por trás do anúncio.' },
      demanda: 'Corrigir Anúncios', dimensao: 'Estoque e logística' })
  }
  // V3 F6: SINCRONISMO DE ESTOQUE (Chaveiro) — diag.sync_estoque é a MESMA prévia da rota (chaveiro-estoque-real.syncParaPlano), anexada por gerarPlanoConta só com
  // produto.diagnostico_ligado (sem ela nada nasce). estoque_sincronizar: físico informado ≤ 24 h e o ML mostrando diferente do alvo (ou mais que o físico);
  // estoque_divergente: físico de 1–7 dias que, menos as vendas, difere do ML → contagem do cliente. Sem R$ (pendência): a prova é dias sem estoque/cancelamentos (marco).
  const SY = diag.sync_estoque, porIdIt = new Map(it.map(i => [String(i.id), i]))
  const specSync = (x, regra) => {
    const rep = porIdIt.get(String(x.representante)); if (!rep) return null
    const itens = [...new Set(x.pools.flatMap(p => p.itens.map(i => i.item_id)))], pr = priorEfetivo(regra), nomeP = curto(rep.titulo)
    const prev = { tipo: 'pendencia', hipotese: false, cenarios: { conservador: { receita: 0 }, base: { receita: 0 }, otimista: { receita: 0 } }, p_sucesso: pr.p, p_fonte: pr.fonte, valor_esperado: 0, esperado: { conservador: 0, base: 0, otimista: 0 }, aviso: 'Sem estimativa de receita: a prova é dias sem estoque e cancelamentos por falta de estoque (marco sync_estoque do Merovíngio).' }
    return { item: rep, produto: { chave: `sku:${x.sku}`, ef: `sync:sku:${x.sku}`, n: itens.length, irmaos: itens.filter(y => y !== rep.id), modo: 'declarado' }, prev, nomeP, itens }
  }
  for (const x of SY?.sincronizar || []) {
    const b = specSync(x, 'estoque_sincronizar'); if (!b) continue
    const alvo = x.plano.pools.map(p => `${p.de ?? '—'} → ${p.para}`).join(' · ')
    out.push({ regra: 'estoque_sincronizar', item: b.item, produto: b.produto, sync_liberado: SY.liberado === true, urgencia: x.plano.risco_vender_sem_estoque ? 5 : 4, esforco: 1, causal: 70, evidencia_tipo: 'fato',
      causas: [{ causa: 'alocar', sinal: `físico ${x.fisico.fisico} un (informado ${x.fisico.informado} − ${x.fisico.deduzido} vendidas), ML mostra ${x.plano.soma_mostrada ?? '—'} un` }],
      titulo: `Sincronizar o estoque do produto: ${b.nomeP}${b.itens.length > 1 ? ` (${b.itens.length} anúncios)` : ''}`,
      problema: x.plano.risco_vender_sem_estoque ? `O Mercado Livre mostra ${x.plano.soma_mostrada ?? '—'} un e o estoque físico é ${x.fisico.fisico} un: risco de vender sem estoque` : `Os anúncios do produto mostram um estoque diferente do físico informado (alvo ${x.plano.alvo_total} un)`,
      evidencia: `Estoque físico informado (${x.fisico.fonte}) ${x.fisico.informado} un há ${x.fisico.idade_h} h, menos ${x.fisico.deduzido} un vendidas desde então = ${x.fisico.fisico} un; segurança ${x.seguranca} un (${x.dias_protecao} dias × ${x.venda_prevista_dia}/dia). Por estoque: ${alvo}.`,
      hipotese: 'Dividir o físico entre os anúncios do produto pela venda evita vender sem estoque e o anúncio parado com estoque no outro — HIPÓTESE; o marco sync_estoque mede dias sem estoque e cancelamentos antes × depois.',
      como: [SY.liberado ? 'Revisar a prévia do sincronismo em Produtos e executar (líder, confirmar): o Chaveiro relê ao vivo, escreve e confere em todos os anúncios' : `Ajustar no painel do Mercado Livre: ${alvo} (sincronismo automático ainda não liberado para este cliente)`,
        'Nunca escrever acima do físico; Full fica fora (só por envio pelo painel)', 'Conferir na leitura seguinte'],
      indicador: `ML ${x.plano.soma_mostrada ?? '—'} un × físico ${x.fisico.fisico} un`, meta: `anúncios do produto somando ${x.plano.alvo_total} un`, aceite: 'Escrita conferida em todos os anúncios do produto',
      prev: b.prev, demanda: 'Planejamento full', dimensao: 'Estoque e logística', dados_extra: { sync_estoque: { sku: x.sku, fisico: x.fisico.fisico, alvo_total: x.plano.alvo_total, pools: x.plano.pools } } })
  }
  for (const x of SY?.divergente || []) {
    const b = specSync(x, 'estoque_divergente'); if (!b) continue
    out.push({ regra: 'estoque_divergente', item: b.item, produto: b.produto, urgencia: 3, esforco: 1, causal: 55, evidencia_tipo: 'fato', confirmar_com: ['contagem física com o cliente'],
      causas: [{ causa: 'contagem', sinal: `físico informado − vendas = ${x.fisico.fisico} un, ML mostra ${x.plano.soma_mostrada} un` }],
      titulo: `Confirmar o estoque físico: ${b.nomeP} (difere do Mercado Livre)`,
      problema: `O estoque informado há ${Math.round(x.fisico.idade_h / 24)} dia(s), menos as vendas desde então (${x.fisico.fisico} un), difere do que o Mercado Livre mostra (${x.plano.soma_mostrada} un)`,
      evidencia: `Informado ${x.fisico.informado} un (${x.fisico.fonte}), vendidas ${x.fisico.deduzido} un desde então; ML ${x.plano.soma_mostrada} un. Sem contagem recente o sincronismo não escreve.`,
      hipotese: 'Venda fora do Mercado Livre, entrada não informada ou ajuste no painel — PREMISSA; só a contagem do cliente resolve.',
      como: ['Pedir ao cliente a contagem do estoque físico deste produto (fora do Full)', 'Registrar em Produtos › estoque físico (vale 24 h para o sincronismo)', 'Nunca corrigir o estoque no ML sem a contagem'],
      indicador: `divergência ${Math.abs(x.plano.soma_mostrada - x.fisico.fisico)} un`, meta: 'contagem registrada e divergência zerada', aceite: 'Estoque físico informado de novo',
      prev: b.prev, demanda: 'Planejamento full', dimensao: 'Estoque e logística' })
  }
  return out
}

// ── construtor comum: prioridade, prazo, responsável, ID estável ────────────
const ESCALA_FIN = pct => pct >= 5 ? 100 : pct >= 3 ? 85 : pct >= 2 ? 70 : pct >= 1 ? 55 : pct >= 0.5 ? 40 : Math.max(0, Math.round(pct * 60))
// roteiro do Manual por regra: a Demanda do Notion é um "balde" (existe nos quadros), mas o passo a passo certo nem sempre é o da família dela.
// null = a ação não tem processo elementar no Manual (reposição é do cliente; Ads e custos não têm roteiro de tela): o card leva só o "como" da regra.
// catalogo_buybox: null — 'Anunciar no catálogo' é o roteiro de ENTRAR no catálogo, não de recuperar a caixa de compra (preço/condição); o card leva só o "como" da regra
const DEMANDA_ROTEIRO = { estoque_dividido: null, estoque_sincronizar: null, estoque_divergente: null, sku_ausente: 'Ajustar produto (Editar)', catalogo_buybox: null, frete_gratis: 'Ajustar produto (Editar)', conteudo_fotos: 'Ajustar produto (Editar)', estoque_ruptura: null, cadastrar_custos: null, urgencia_oculta: null, ads_entrar: null, ads_escalar: null, ads_reduzir: null, oferta_galeria: 'Ajustar produto (Editar)', oferta_preco: 'Ajustar produto (Editar)', preco_mudou_vendas_cairam: 'Ajustar produto (Editar)',
  queda_conversao_anuncio: 'Ajustar produto (Editar)', queda_exposicao_anuncio: 'Ajustar produto (Editar)', queda_ctr_ads: 'Ajustar produto (Editar)', margem_negativa: 'Ajustar produto (Editar)', ads_abaixo_meta: null, concentracao_receita: null, anuncio_restrito: null,
  reputacao_em_risco: null, envio_atrasado: null, reclamacao_sem_resposta: null, pergunta_sem_resposta: null, full_estoque_antigo: null }   // saúde da conta (v1.5.0): quem executa é o cliente; não há roteiro de tela no Manual
const TIPO_POR_REGRA = { estoque_ruptura: 'disponibilidade', full_envio: 'disponibilidade', estoque_dividido: 'disponibilidade', estoque_sincronizar: 'disponibilidade', estoque_divergente: 'disponibilidade', sku_ausente: 'cadastro', catalogo_buybox: 'saude', cadastrar_custos: 'saude', duplicacao_estrategica: 'cadastro', ima_conversao: 'otimizacao', conteudo_fotos: 'otimizacao', frete_gratis: 'otimizacao', ads_otimizar_antes: 'otimizacao', ads_entrar: 'trafego_promocao', ads_escalar: 'trafego_promocao', ads_reduzir: 'trafego_promocao', promocao_giro: 'trafego_promocao', sazonal: 'trafego_promocao', urgencia_oculta: 'expansao',
  oferta_galeria: 'otimizacao', oferta_titulo_descricao: 'otimizacao', oferta_completa: 'otimizacao', oferta_ficha: 'otimizacao', oferta_preco: 'otimizacao', oferta_cadastro: 'cadastro', preco_mudou_vendas_cairam: 'otimizacao',
  queda_conversao_anuncio: 'otimizacao', queda_exposicao_anuncio: 'otimizacao', queda_ctr_ads: 'otimizacao', margem_negativa: 'saude', ads_abaixo_meta: 'trafego_promocao', concentracao_receita: 'expansao', anuncio_restrito: 'saude',
  reputacao_em_risco: 'saude', envio_atrasado: 'saude', reclamacao_sem_resposta: 'saude', pergunta_sem_resposta: 'saude', full_estoque_antigo: 'disponibilidade' }
export const tipoDaRegra = regra => TIPO_POR_REGRA[String(regra).replace(/^anuncio_/, '')] || 'otimizacao'
const HORIZONTE = regra => ({ duplicacao_estrategica: ['30d', 10], estoque_ruptura: ['72h', 3], estoque_dividido: ['7d', 5], estoque_sincronizar: ['72h', 2], estoque_divergente: ['7d', 5], sku_ausente: ['30d', 14], ads_reduzir: ['7d', 7], catalogo_buybox: ['7d', 7], ima_conversao: ['7d', 10], ads_otimizar_antes: ['7d', 10], full_envio: ['7d', 10], cadastrar_custos: ['7d', 7], conteudo_fotos: ['7d', 7], ads_entrar: ['30d', 14], ads_escalar: ['7d', 7], frete_gratis: ['30d', 14], promocao_giro: ['30d', 14], sazonal: ['30d', 21], urgencia_oculta: ['30d', 21],
  oferta_galeria: ['7d', 10], oferta_titulo_descricao: ['7d', 7], oferta_completa: ['30d', 14], oferta_ficha: ['7d', 7], oferta_preco: ['7d', 7], oferta_cadastro: ['30d', 14], preco_mudou_vendas_cairam: ['7d', 7],
  queda_conversao_anuncio: ['7d', 7], queda_exposicao_anuncio: ['7d', 7], queda_ctr_ads: ['7d', 7], margem_negativa: ['72h', 3], ads_abaixo_meta: ['7d', 7], concentracao_receita: ['30d', 14], anuncio_restrito: ['72h', 3],
  reputacao_em_risco: ['7d', 7], envio_atrasado: ['72h', 1], reclamacao_sem_resposta: ['72h', 1], pergunta_sem_resposta: ['72h', 2], full_estoque_antigo: ['30d', 14] }[regra] || ['30d', 14])
// quando PARAR (reverter) por família da regra: o card diz o que faz a ação voltar atrás antes da data de revisão
const PARADA_POR_FAMILIA = { ads: 'ROAS do anúncio abaixo do equilíbrio (ou do da conta) por 7 dias → voltar a verba ao nível anterior', preco: 'vendas/dia abaixo do baseline por 14 dias → reverter o preço/condição', conteudo: 'conversão abaixo do baseline por 14 dias → restaurar a versão anterior', estoque: 'reposição confirmada ou cobertura ≥ atenção → encerrar', promocao: 'cobertura-alvo atingida ou margem abaixo do mínimo → encerrar a campanha', saude: 'sinal zerado na leitura de saúde seguinte (sem atraso, reclamação urgente ou pergunta vencida; nível verde) → encerrar', outro: 'sem melhora na data de revisão → reavaliar a hipótese no card' }
const familiaParada = regra => /^ads_|^queda_ctr_ads$/.test(regra) ? 'ads' : /^(reputacao_em_risco|envio_atrasado|reclamacao_sem_resposta|pergunta_sem_resposta)$/.test(regra) ? 'saude' : /preco|margem_negativa|catalogo_buybox|frete_gratis/.test(regra) ? 'preco' : /^(promocao_giro|sazonal|full_estoque_antigo)$/.test(regra) ? 'promocao' : /^(estoque_ruptura|full_envio|estoque_dividido|estoque_sincronizar|estoque_divergente)$/.test(regra) ? 'estoque' : /conteudo|ima_conversao|oferta_|queda_conversao|queda_exposicao|duplicacao/.test(regra) ? 'conteudo' : 'outro'
// ações que o módulo de Ofertas executa (plano → ofertas): o card ganha o escopo/objetivo com que o job nasce a partir da ação (POST /api/ofertas/jobs { acao_id })
export const VIA_OFERTA = {
  ima_conversao: { escopo: 'oferta_completa', objetivo: 'melhorar_conversao' }, conteudo_fotos: { escopo: 'galeria', objetivo: 'elevar_clique' },
  frete_gratis: { escopo: 'preco', objetivo: 'preservar_margem' },     // catalogo_buybox saiu: abria job de FICHA em catálogo, e a ficha do catálogo não é do vendedor (config/algoritmo.json → catalogo)
  duplicacao_estrategica: { escopo: 'oferta_completa', objetivo: 'lancar', duplicacao: true, exige_briefing_consultor: true },
}

// id estável da ação de uma spec (o mesmo antes do filtro de alinhamentos e no construtor): janela sazonal e job de oferta levam o alvo junto do anúncio
const idDaSpec = (cliente, s) => idAcao(cliente, 'anuncio_' + s.regra, s.alvo && s.item ? `${s.item.id}|${s.alvo}` : s.produto && s.produto.n > 1 ? (s.produto.ef || s.produto.chave) : s.item?.id || s.alvo || 'conta')
// construtor comum de UMA ação: prioridade = financeiro 40% + gravidade 20% + evidência causal 25% + facilidade 15%, fator do Merovíngio em odds, prazo, roteiro do
// Manual, sequência lógica e profissional sugerido. montarAcoes (regras do diagnóstico) e acaoDeOferta (jobs do módulo de Ofertas) passam pelos MESMOS cálculos.
function construirAcao(cliente, s, { hoje, gmv, retro = null, cli = null, periodo = '', custosInformados = true, protegidos = new Map(), pareto80 = new Set(), itensDiag = new Map() }) {
    const [horizonte, dias] = HORIZONTE(s.regra), ev = s.prev.valor_esperado || 0
    const pctGmv = 100 * ev / gmv
    const fin = ESCALA_FIN(pctGmv), grav = clamp(s.urgencia * 20, 0, 100), facil = clamp((6 - s.esforco) * 20, 0, 100)
    const notaBase = Math.round(fin * 0.40 + grav * 0.20 + s.causal * 0.25 + facil * 0.15)
    const rf = retro?.fatores?.[s.regra] || null
    const prot = s.item && cfgRetro.protecao.regras.includes(s.regra) ? protegidos.get(s.item.id) : null
    // o aprendizado da duplicação (por OBJETIVO: A/B, recuperação…) ajusta só as ações de duplicação, e só quando o objetivo difere de forma conclusiva do geral
    const fobj = s.objetivo_dup ? retro?.duplicacao?.fator_por_objetivo?.[s.objetivo_dup] : null
    const fator = (rf ? rf.fator * (prot ? cfgRetro.protecao.fator : 1) : (prot ? cfgRetro.protecao.fator : 1)) * (fobj?.fator ?? 1)
    // fator aplicado em escala de chances (odds): nunca passa de 100, não empata os melhores e mexe proporcionalmente em nota alta e baixa
    const nota = clamp(ajustarNota(notaBase, fator), 0, 100)
    const p = CLASSES_P.find(([lim]) => nota >= lim)[1]
    const prazo = s.prazoISO || addDias(hoje, dias)
    const regra = 'anuncio_' + s.regra
    const id = idDaSpec(cliente, s)
    const it = s.item, irmaos = s.produto?.n > 1 ? (s.produto.irmaos || []).map(x => itensDiag.get(String(x))).filter(Boolean) : []
    const janelaProva = algoritmo.regras.find(r => r.id === s.regra)?.prova?.janela_dias ?? 14
    // catálogo: nenhum job de galeria, ficha ou oferta completa (o módulo de Ofertas não altera o conteúdo do catálogo); preço segue valendo
    const viaOferta = VIA_OFERTA[s.regra] && !(it && origemCatalogo(it) !== 'nao' && CATALOGO.regras.sem_job_de_conteudo.includes(s.regra)) ? VIA_OFERTA[s.regra] : null
    const dados = {
      dimensao: s.dimensao, problema: s.problema, acao: s.como[0], evidencia_tipo: s.evidencia_tipo, evidencia: s.evidencia,
      fonte: s.fonte || 'API do Mercado Livre (pedidos, visitas, anúncios, Ads)', periodo: s.periodo || periodo,
      dependencia: s.regra === 'cadastrar_custos' ? 'Informações do cliente' : (s.regra.startsWith('ads_') || s.regra === 'promocao_giro' || s.regra === 'frete_gratis') && !custosInformados ? 'Custos do cliente (margem)' : s.dependencia || '—',
      indicador_inicial: s.indicador, meta: s.meta, criterio_aceite: s.aceite,
      impacto: clamp(Math.round(fin / 20), 1, 5), confianca: clamp(Math.round(s.causal / 20), 1, 5), urgencia: s.urgencia, esforco: s.esforco,
      logica: `Prioridade ${nota}/100 = impacto financeiro ${fin} ×40% + gravidade ${grav} ×20% + evidência causal ${s.causal} ×25% + facilidade ${facil} ×15% (valor esperado ${brl(ev)} = ${r2(pctGmv)}% do GMV)${nota !== notaBase ? `, ajustada pela retroalimentação (fator ${r2(fator).toLocaleString('pt-BR')}): nota base ${notaBase} → ${nota}` : ''}`,
      retro: retro ? { estado: retro.estado.estado, nota_base: notaBase, fator: r2(fator), motivo: [rf?.motivo, fobj ? `duplicação com objetivo "${s.objetivo_dup}": ${fobj.melhorou} de ${fobj.n} duplicações medidas melhoraram o líquido da família, diferente do geral → ×${fobj.fator}` : '', prot ? `anúncio protegido até ${prot.ate.split('-').reverse().join('/')} (uma tarefa recente o melhorou: não mexer no que está funcionando)` : ''].filter(Boolean).join('; '), nivel: rf?.nivel || null, protegido_ate: prot?.ate || null, pareto80: s.item ? pareto80.has(s.item.id) : null } : null,
      demanda_notion: s.demanda, refs: it ? [{ titulo: it.titulo, url: it.permalink }, ...irmaos.map(x => ({ titulo: x.titulo, url: x.permalink }))] : s.refs_extra || [],
      item: it ? { id: it.id, titulo: it.titulo, permalink: it.permalink, thumb: it.thumb, curva: it.curva, classe: it.classe, catalogo_origem: origemCatalogo(it) } : null,
      ...(it && origemCatalogo(it) !== 'nao' ? { catalogo: { origem: origemCatalogo(it), texto: TEXTO_CATALOGO[origemCatalogo(it)] } } : {}),
      onde: it ? `${it.permalink}` : 'Conta (toda a operação)', hipotese: s.hipotese, como: s.como, previsao: s.prev, causal_score: s.causal,
      prioridade: { p, nota, componentes: { financeiro: fin, gravidade: grav, causal: s.causal, facilidade: facil } },
      // inteligência de processos (Manual do Analista): o roteiro do canal (passo a passo, evidência, critério) vai junto para o card; a ordem segue a sequência lógica do plano
      processo: (() => { const dem = Object.hasOwn(DEMANDA_ROTEIRO, s.regra) ? DEMANDA_ROTEIRO[s.regra] : s.demanda; const r = dem ? roteiro({ demanda: dem, canal: 'ML' }) : null; return r ? { id: r.processo, nome: r.nome, fonte: r.fonte, caminho: r.caminho, passos: r.passos, atencao: r.atencao, evidencia: r.evidencia, criterio: r.criterio, prazo: r.prazo, dependencias: r.dependencias } : null })(),
      sequencia: ordemDoTipo(TIPO_POR_REGRA[s.regra] || 'otimizacao'),
      // quem melhor executa ESTA família de tarefa (medido pelo Merovíngio: resultado com prova, velocidade, volume, carga); sem prova, só o aviso
      profissional_sugerido: (() => { try { const r = melhorProfissional({ demanda: s.demanda, cliente }); return { familia: r.familia, recomendado: r.recomendado, aviso: r.aviso, topo: r.ranking.slice(0, 3).map(x => ({ nome: x.nome, score: x.score, n: x.n, melhorou: x.melhorou, mediana_dias: x.mediana_dias, prova: x.prova })) } } catch { return null } })(),
      ...(s.objetivo_dup ? { duplicacao: { gatilho: s.gatilho, objetivo: s.objetivo_dup, exige_briefing_consultor: true, original_intacto: true } } : {}),
      ...(s.regra === 'urgencia_oculta' ? { exige_pesquisa_consultor: true } : {}),
      ...(viaOferta ? { executar_via_oferta: viaOferta } : {}),
      // motor de diagnóstico (08/10/2026): entidade e nível, causas (sempre hipótese, cada uma com o sinal que a sustenta), o que confirma, quando parar,
      // quando revisar (prazo + janela da prova), de quem depende (montarAcoes preenche) e por onde executa (Ofertas / Promoções / Notion)
      // V3 F3: ação de PRODUTO (estoque de 2+ anúncios) — entidade produto com o id estável da chave e todos os irmãos; a medição (vinculos.js) liga cada irmão
      entidade: s.produto && s.produto.n > 1 ? { tipo: 'produto', id: s.produto.chave, ef: s.produto.ef, itens: [it.id, ...s.produto.irmaos], modo: s.produto.modo } : it ? { tipo: 'anuncio', id: it.id } : { tipo: 'conta', id: cliente },
      nivel: s.produto && s.produto.n > 1 ? 'produto' : it ? 'anuncio' : 'conta', ...(s.produto ? { produto: s.produto } : {}),
      causas_possiveis: (s.causas || []).map(c => ({ causa: c.causa, tipo: 'hipotese', sinal: c.sinal })),
      confirmar_com: s.confirmar_com || [],
      parada: s.parada || PARADA_POR_FAMILIA[familiaParada(s.regra)],
      prova_janela_dias: janelaProva, revisar_em: addDias(prazo, janelaProva),
      depende_de: [],
      executar_via: s.executar_via || (viaOferta ? 'oferta' : s.regra === 'promocao_giro' ? 'promocoes' : 'notion'),   // full_estoque_antigo declara por causa (promoções × cliente)
      ...(s.dados_extra || {}),
    }
    // Chaveiro F1: caminho declarado (automático/assistido/cliente/sem_caminho) — depois de dados, porque lê causas_possiveis e executar_via; nada é executado
    dados.execucao = classificarCaminho({ regra, dados }, { item: it, custosInformados, catalogoOrigem: it ? origemCatalogo(it) : 'nao', syncLiberado: s.sync_liberado === true })
    return {
      id, cliente, canal: 'Mercado Livre', canalK: 'ML', regra, mes: hoje.slice(0, 7), titulo: it ? `${s.titulo} (${it.id})` : s.titulo,
      horizonte, prazo, responsavel: cli?.responsavelDoCanal('ML') || '', squad: cli?.squadDoCanal('ML') || cli?.squadPrincipal || '',
      score: nota, item_id: it?.id || '', dados, previsao: s.prev,
    }
}

// retro = saída de retroalimentar(): o que o sistema aprendeu (estado da conta + tarefas já medidas) volta aqui como fator de prioridade.
// Sem retro (conta sem série, erro) o plano sai exatamente como antes — a retroalimentação só reordena, nunca bloqueia nem inventa ação.
const contextoRetro = retro => ({ protegidos: new Map((retro?.protegidos || []).map(x => [x.item_id, x])), pareto80: new Set((retro?.pareto?.itens?.itens || []).map(x => x.id)) })
const clienteDe = cliente => carregarClientes().find(c => normNome(c.cliente) === normNome(cliente))
// semConsultor (cliente do Place Sprint 90, autoatendimento): as regras que exigem pesquisa/briefing de consultor (config/algoritmo.json → foco.regras_exigem_consultor)
// saem NA GERAÇÃO, antes do corte de foco — as vagas da semana enchem com o que o próprio cliente executa ou aplica; o que saiu é contado em omitidas.exige_consultor
// Alinhamentos com o cliente (src/lib/alinhamentos.js — exceção intencional registrada): regra/anúncio alinhado NÃO nasce (conta em omitidas.alinhado), antes do teto
// e da fila; Ads por ACOS com alvo alinhado só nasce acima do alvo (o predicado decide, com o ACOS do anúncio); alinhamento vencido nasce com "observar"; descontinuado anota a
// promoção como queima de estoque. O descarte de UMA ação (janela sazonal, job de oferta) cobre só ela: o filtro pergunta com o id da spec.
// Ações DESCARTADAS no banco também saem antes do corte (omitidas.descartada): descartada não ocupa vaga no teto por regra nem na fila da semana.
// semConsultor (Sprint 90): o "observar: … revisar" é instrução interna — fica só em dados.alinhamento_vencido, nunca no problema que o painel do cliente projeta
const anotarAlinhamento = (a, al, { semConsultor = false } = {}) => {
  if (!al) return
  if (al.acima_do_alvo) a.dados.alinhamento = { tipo: al.acima_do_alvo.tipo, rotulo: al.acima_do_alvo.rotulo, desde: al.acima_do_alvo.desde, revisar_em: al.acima_do_alvo.revisar_em, acos_alvo: al.acima_do_alvo.acos_alvo, texto: `ACOS acima do alvo de ${virg(al.acima_do_alvo.acos_alvo)}% alinhado com o cliente em ${dm(al.acima_do_alvo.desde)}` }
  if (al.vencido) {
    const texto = `observar: alinhado em ${dm(al.vencido.desde)}, revisar`
    a.dados.alinhamento_vencido = { tipo: al.vencido.tipo, rotulo: al.vencido.rotulo, desde: al.vencido.desde, revisar_em: al.vencido.revisar_em, texto }
    if (!semConsultor) a.dados.problema = `${a.dados.problema} — ${texto}`
  }
  if (al.nota) { a.dados.alinhamento = { tipo: al.nota.tipo, rotulo: al.nota.rotulo, desde: al.nota.desde, texto: al.nota.texto }; a.dados.como = [al.nota.texto, ...a.dados.como]; a.dados.acao = al.nota.texto }
}
const idsDescartados = cliente => new Set(db.prepare("SELECT id FROM acoes_plano WHERE cliente = ? AND status = 'descartada'").all(cliente).map(r => r.id))
export function montarAcoes(cliente, diag, { hoje = diag.hoje, retro = null, semConsultor = false } = {}) {
  const cli = clienteDe(cliente)
  const omitidas = {}, conta = k => { omitidas[k] = (omitidas[k] || 0) + 1 }
  const exigeConsultor = new Set(semConsultor ? F.regras_exigem_consultor || [] : [])
  const alinhado = alinhamentosReal().predicado(cliente, { hoje })
  const acosAlvo = new Map()
  for (const i of diag.itens || []) { const al = alinhado({ item: i.id, regra: 'ads_abaixo_meta' }); if (al.sim && al.acos_alvo != null) acosAlvo.set(i.id, al.acos_alvo) }
  const marcas = new Map()
  const specs = regras(diag, { acosAlvo, alinhado: () => conta('alinhado'), omitir: conta }).filter(s => {
    if (exigeConsultor.has(s.regra)) { conta('exige_consultor'); return false }
    // Ads por ACOS com alvo alinhado: ads_abaixo_meta já foi avaliada contra o alvo; ads_reduzir/ads_abaixo_meta só ficam se o ACOS passou até do alvo (predicado, com acos)
    const al = alinhado({ item: s.item?.id, regra: s.regra, acao: idDaSpec(cliente, s), acos: s.item?.ads?.acos })
    if (al.sim) { conta('alinhado'); return false }
    if (al.acima_do_alvo || al.vencido || al.nota) marcas.set(s, al)
    return true
  })
  const gmv = Math.max(diag.resumo.gmv, 1)
  const br = iso => iso.split('-').reverse().join('/')
  const periodo = `${br(diag.periodo.de)} a ${br(diag.periodo.ate)} vs ${br(diag.periodo.anterior.de)} a ${br(diag.periodo.anterior.ate)}`
  const descartadas = idsDescartados(cliente)
  const itensDiag = new Map((diag.itens || []).map(i => [String(i.id), i]))
  const acoes = specs.map(s => { const a = construirAcao(cliente, s, { hoje, gmv, retro, cli, periodo, custosInformados: diag.custos_informados, ...contextoRetro(retro), itensDiag }); anotarAlinhamento(a, marcas.get(s), { semConsultor }); return a })
    .filter(a => !descartadas.has(a.id) || (conta('descartada'), false))
  // foco: ordem por prioridade; teto por tipo de regra (o que passa do teto é OMITIDO e contado, não some em silêncio);
  // só as N primeiras entram na semana, o resto fica na fila
  acoes.sort((a, b) => b.score - a.score)
  const cap = F.max_por_regra || {}, cont = {}
  const mantidas = acoes.filter(a => {
    const r = a.regra.replace(/^anuncio_/, '')
    cont[r] = (cont[r] || 0) + 1
    if (cap[r] && cont[r] > cap[r]) { omitidas[r] = (omitidas[r] || 0) + 1; return false }
    return true
  })
  // sequência lógica (Manual 5.2): cadastros e duplicações vêm ANTES das otimizações do mesmo anúncio — a otimização não pode ter prazo anterior ao da duplicação
  for (const d of mantidas.filter(a => a.regra === 'anuncio_duplicacao_estrategica' && a.item_id))
    for (const o of mantidas.filter(a => a.item_id === d.item_id && a !== d && a.dados.sequencia > d.dados.sequencia && a.prazo < addDias(d.prazo, 2))) { o.prazo = addDias(d.prazo, 2); o.dados.nota_sequencia = 'Prazo depois da duplicação estratégica deste anúncio: não se otimiza o que ainda será testado em duplicata (Manual 5.1)' }
  // dependências (config/algoritmo.json → dependencias): ação do MESMO anúncio que depende de outra ganha depende_de (ids) e prazo ≥ prazo da dependência + 2 dias;
  // a data de revisão acompanha o prazo. Nada é removido: Ads/promoção esperam ruptura, margem negativa e anúncio restrito serem tratados (Manual 5.2)
  const DEP = algoritmo.dependencias || {}
  for (const a of mantidas) {
    const deps = a.item_id ? DEP[a.regra.replace(/^anuncio_/, '')] : null
    if (!Array.isArray(deps)) continue
    for (const d of mantidas) if (d !== a && d.item_id === a.item_id && deps.includes(d.regra.replace(/^anuncio_/, ''))) {
      a.dados.depende_de.push(d.id)
      const min = addDias(d.prazo, 2)
      if (a.prazo < min) { a.prazo = min; a.dados.nota_dependencia = `Prazo depois de "${d.regra.replace(/^anuncio_/, '')}" do mesmo anúncio (${d.id}): saúde e disponibilidade vêm antes de tráfego e promoção (Manual 5.2)` }
    }
  }
  for (const a of mantidas) a.dados.revisar_em = addDias(a.prazo, a.dados.prova_janela_dias)   // a data de revisão acompanha o prazo final (sequência da duplicação e dependências mexem nele)
  mantidas.forEach((a, k) => { a.dados.fila = k < F.max_acoes_por_cliente_semana ? 'esta_semana' : 'fila'; a.dados.posicao = k + 1 })
  mantidas.omitidas = omitidas
  return mantidas
}

// ── persistência: IDs estáveis, decisão humana nunca sobrescrita, só regras anuncio_* ──
export function salvarAcoesAnuncio(cliente, acoes) {
  const t = agora()
  const ex = new Map(db.prepare("SELECT id, status FROM acoes_plano WHERE cliente = ? AND regra LIKE 'anuncio\\_%' ESCAPE '\\'").all(cliente).map(r => [r.id, r.status]))
  const ins = db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, item_id, previsao_json, algoritmo_versao, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'proposta', ?,?,?,?,?)`)
  const upd = db.prepare(`UPDATE acoes_plano SET titulo=?, horizonte=?, prazo=?, responsavel=?, squad=?, score=?, dados_json=?, item_id=?, previsao_json=?, algoritmo_versao=?, atualizado_em=?,
    status = CASE WHEN status = 'obsoleta' THEN 'proposta' ELSE status END WHERE id = ? AND status IN ('proposta','obsoleta','aprovada')`)
  const obs = db.prepare("UPDATE acoes_plano SET status = 'obsoleta', atualizado_em = ? WHERE id = ? AND status IN ('proposta','aprovada')")
  // ação que um job de Ofertas está executando (criada pela regra oferta_* ou ligada) segue o ciclo do JOB: regerar o plano não a torna obsoleta
  const emExecucao = new Set(db.prepare("SELECT acao_id FROM of_job WHERE cliente = ? AND acao_id <> '' AND estado <> 'cancelado'").all(cliente).map(r => r.acao_id))
  let novas = 0, mantidas = 0, obsoletas = 0, obsoletas_aprovadas = 0
  db.transaction(() => {
    const vistos = new Set()
    for (const a of acoes) {
      vistos.add(a.id)
      if (ex.has(a.id)) { upd.run(a.titulo, a.horizonte, a.prazo, a.responsavel, a.squad, a.score, JSON.stringify(a.dados), a.item_id, JSON.stringify(a.previsao), algoritmo.versao, t, a.id); mantidas++ }
      else { ins.run(a.id, a.cliente, a.canal, a.regra, a.mes, a.titulo, a.horizonte, a.prazo, a.responsavel, a.squad, a.score, JSON.stringify(a.dados), a.item_id, JSON.stringify(a.previsao), algoritmo.versao, t, t); novas++ }
    }
    for (const [id, st] of ex) if (!vistos.has(id) && !emExecucao.has(id) && ['proposta', 'aprovada'].includes(st)) { obs.run(t, id); obsoletas++; if (st === 'aprovada') obsoletas_aprovadas++ }
  })()
  // obsoletas_aprovadas: decisão humana que o novo diagnóstico fez sumir (ex.: conteúdo em catálogo de terceiros, config/algoritmo.json → catalogo) — a tela avisa, nada some em silêncio
  return { novas, mantidas, obsoletas, obsoletas_aprovadas }
}

// ── regras oferta_*: o job do módulo de Ofertas vira ação do plano pelas MESMAS contas (construirAcao: prioridade, prior calibrado por família, fator do
// Merovíngio, roteiro do Manual). A lente do diagnóstico do job (ofertas-diagnostico.js) é a evidência; sem leitura medida a ação nasce como hipótese.
const LENTE_OFERTA = { oferta_galeria: 'clique', oferta_titulo_descricao: 'descoberta', oferta_completa: 'conversao', oferta_ficha: 'qualidade', oferta_preco: 'viabilidade', oferta_cadastro: null }
const ESFORCO_OFERTA = { oferta_galeria: 3, oferta_titulo_descricao: 1, oferta_completa: 4, oferta_ficha: 1, oferta_preco: 1, oferta_cadastro: 4 }
const CAUSAL_OFERTA = { oferta_galeria: 50, oferta_titulo_descricao: 45, oferta_completa: 60, oferta_ficha: 45, oferta_preco: 65, oferta_cadastro: 35 }
const DIMENSAO_OFERTA = { oferta_galeria: 'Clique e atração', oferta_titulo_descricao: 'Demanda e visibilidade', oferta_completa: 'Conversão e oferta', oferta_ficha: 'Demanda e visibilidade', oferta_preco: 'Rentabilidade', oferta_cadastro: 'Demanda e visibilidade' }
const TITULO_OFERTA = { oferta_galeria: 'Oferta — galeria por posição', oferta_titulo_descricao: 'Oferta — título e descrição factuais', oferta_completa: 'Oferta completa pelo método', oferta_ficha: 'Oferta — ficha técnica factual', oferta_preco: 'Oferta — preço com margem', oferta_cadastro: 'Lançar anúncio novo' }
const SEVERIDADE_URGENCIA = { alta: 4, media: 3, baixa: 2, sem_dado: 2 }
const ROTULO_PROVA = algoritmo.metricas_prova || {}
function specOferta(regra, { job, item = null, b = {}, d = {} }) {
  const id = regra.replace(/^anuncio_/, ''), P0 = P[id] || {}, pr = priorEfetivo(id), lentes = d.lentes || {}
  const cfg = algoritmo.regras.find(r => r.id === id) || {}, prova = cfg.prova || { metrica: 'conversao', janela_dias: 14 }
  let L0 = LENTE_OFERTA[id] ? lentes[LENTE_OFERTA[id]] : null
  if (id === 'oferta_galeria' && (!L0 || L0.severidade === 'sem_dado')) L0 = lentes.qualidade || L0       // CTR orgânico não existe: sem Ads, a galeria se apoia na qualidade (fotos × briefing)
  const medido = !!L0 && L0.severidade !== 'sem_dado', problema = medido && L0.severidade !== 'baixa'
  const u = Number.isFinite(b.unidades) ? b.unidades : 0, preco = Number.isFinite(b.preco) ? b.preco : 0, conv = b.conversao?.valor ?? null
  const k3 = (f, arr) => ({ conservador: f(arr[0]), base: f(arr[1]), otimista: f(arr[2]) })
  const janela = prova.janela_dias, medir = `Medir ${ROTULO_PROVA[prova.metrica] || prova.metrica} em ${janela} dias após a publicação conferida (antes × depois com grupo de controle)`
  let prev, meta = `${ROTULO_PROVA[prova.metrica] || prova.metrica} melhor que o controle em ${janela} dias`
  if (id === 'oferta_cadastro') prev = previsao({ regra: id, formula: 'produto novo: nenhuma receita é estimada sem histórico', premissas: ['sem vendas anteriores no canal', 'o número que prova é a primeira venda e as visitas/dia em 28 dias'], valores: { conservador: 0, base: 0, otimista: 0 }, preco: 0, prior: pr })
  else if (id === 'oferta_preco') {
    const c = d.calculo_preco, alvo = c && !c.bloqueios?.length ? (c.abaixo_do_piso ? c.piso : c.preco_alvo?.preco ?? null) : null, dif = alvo != null && preco ? Math.max(0, alvo - preco) : 0
    prev = previsao({ regra: id, tipo: 'risco_evitado', formula: 'margem preservada = (preço proposto − preço atual) × unidades × fração das vendas mantida', premissas: [alvo == null ? 'preço sem custo/regra comercial válidos: nenhuma margem calculada (bloqueio declarado)' : `preço atual R$ ${preco} → proposto R$ ${alvo}`, `unidades 28d = ${u}`, `fração das vendas mantida ${P0.fracao_mantida.join(' / ')} (elasticidade NÃO medida — premissa)`], valores: k3(x => dif * u * x, P0.fracao_mantida), prior: pr })
    if (alvo != null) meta = `margem ≥ ${c.preco_alvo?.margem_pct ?? c.piso_margem_pct ?? '—'}% sem perder mais que ${Math.round(100 * (1 - P0.fracao_mantida[1]))}% das unidades`
  } else if (id === 'oferta_completa' && preco > 0 && (d.prioridade?.gap_receita || 0) > 0) {
    const gapUn = d.prioridade.gap_receita / preco
    prev = previsao({ regra: id, formula: 'unidades extras = gap de conversão até a conta (em unidades) × fração do gap fechada', premissas: [`gap até a conversão da própria conta ≈ ${pctTxt(gapUn)} un/28d (diagnóstico do job)`, `fração do gap fechada ${P0.fracao_gap.map(x => Math.round(x * 100) + '%').join(' / ')} (premissa)`, 'preço atual do anúncio'], valores: k3(x => gapUn * x, P0.fracao_gap), preco, prior: pr })
    // meta só quando o ganho previsto move a conversão lida no formato do texto (pctTxt): em ticket alto o gap em unidades é minúsculo e a meta saía "≥ 0%" ou igual ao atual
    if (conv != null && b.visitas) {
      const alvo = conv + 100 * gapUn * P0.fracao_gap[1] / b.visitas
      meta = alvo > conv && pctTxt(alvo) !== pctTxt(conv) ? `conversão ≥ ${pctTxt(alvo)}% em ${janela} dias`
        : `sem meta numérica: o ganho previsto (≈ ${pctTxt(gapUn * P0.fracao_gap[1])} un/28d) não move a conversão lida (${pctTxt(conv)}%) — a prova é só a medição antes × depois com grupo de controle em ${janela} dias`
    }
  } else {
    const g = P0.ganho_conv_pct || P0.ganho_pct || [0, 0, 0]
    prev = previsao({ regra: id, formula: 'unidades extras = unidades atuais × ganho (premissa)', premissas: [`unidades 28d = ${u}`, `ganho ${g.join('% / ')}% (premissa até haver medição suficiente desta família de ações)`], valores: k3(x => u * x / 100, g), preco, prior: pr })
  }
  const passos = {
    oferta_completa: ['Voz do cliente: ler perguntas e avaliações do anúncio (adaptador) e listar as objeções', 'Ângulo: aprovar a direção da oferta a partir das objeções (sem voz do cliente, o ângulo é hipótese)', 'Galeria por posição com a referência confirmada (GATE 0) — aprovada ANTES do título', 'Título e descrição depois das imagens, só com fatos da ficha', 'Ficha técnica com fonte e evidência', 'Preço com custo e regra comercial com fonte (centavos, nada presumido)'],
    oferta_galeria: ['Confirmar a referência visual do produto (GATE 0)', 'Aprovar a direção por posição (objeção de cada foto)', 'Gerar/escolher as imagens e aprovar a galeria', 'Reconferir pictures[0] 30–60 min depois de publicar'],
    oferta_titulo_descricao: ['Título factual (marca, modelo, variação) sem promessa', 'Descrição estruturada só com fatos da ficha'],
    oferta_ficha: ['Preencher atributos com fonte e evidência; identidade (MPN, fabricante, modelo) sem termo promocional', 'Publicar só o grupo ficha'],
    oferta_preco: ['Registrar custo vigente e regra comercial com fonte e validade', 'Preço recalculado no momento da publicação (mudança material volta à revisão)'],
    oferta_cadastro: ['Confirmar a referência visual (GATE 0)', 'Categoria e atributos obrigatórios com evidência', 'Preço sem bloqueio (custo + regra comercial)', 'Galeria aprovada', 'Criar pelo módulo (dry-run → live) e conferir status/sub_status'],
  }[id]
  const nome = curto(item?.titulo || `variante ${String(job.variante_id).slice(0, 8)}`)
  return {
    regra: id, item, alvo: item ? job.criado_em.slice(0, 7) : `variante:${job.variante_id}|${job.criado_em.slice(0, 7)}`,
    urgencia: id === 'oferta_cadastro' ? 3 : SEVERIDADE_URGENCIA[L0?.severidade] || 2, esforco: ESFORCO_OFERTA[id], causal: !medido ? 35 : problema ? CAUSAL_OFERTA[id] : CAUSAL_OFERTA[id] - 15,
    evidencia_tipo: problema && id !== 'oferta_cadastro' ? 'fato' : 'hipotese', titulo: `${TITULO_OFERTA[id]}: ${nome}`,
    problema: id === 'oferta_cadastro' ? 'Produto/variante sem anúncio no canal' : medido ? `${L0.sinal.replace(/_/g, ' ')} (${L0.severidade}) — leitura do módulo de Ofertas` : 'Execução pedida no módulo de Ofertas sem leitura medida da lente',
    evidencia: `${id === 'oferta_cadastro' ? 'produto novo: sem histórico — estratégia inicial, nenhuma leitura de desempenho é alegada' : L0?.evidencia || 'sem leitura da lente no período'}`,          // id, escopo e objetivo do job ficam em dados.oferta (acaoDeOferta), nunca no texto
    hipotese: L0?.hipotese || 'HIPÓTESE (sem sinal medido): só a medição antes × depois com controle dirá se a mudança funcionou',
    como: [...passos, 'Publicar pelo módulo de Ofertas (dry-run → aprovação versionada → live) e conferir por leitura do canal', medir],
    indicador: prova.metrica === 'conversao' ? (conv != null ? `conversão ${pctTxt(conv)}%` : 'conversão sem leitura') : prova.metrica === 'visitas_dia' ? (b.visitas != null && b.periodo?.dias ? `${pctTxt(b.visitas / b.periodo.dias)} visitas/dia` : 'visitas sem leitura') : prova.metrica === 'margem_pct' ? (b.margem_estimada_pct != null ? `margem ${pctTxt(b.margem_estimada_pct)}%` : 'margem não estimada (sem custo/regra)') : 'sem histórico',     // pt-BR, nunca 0 para valor ≠ 0
    meta, aceite: 'Publicação conferida por leitura do canal e resultado medido antes × depois com grupo de controle',
    prev, demanda: cfg.tipo_demanda, dimensao: DIMENSAO_OFERTA[id],
    fonte: 'Módulo Ofertas: linha de base do anúncio (série diária do ML) + diagnóstico em 5 lentes', periodo: b.periodo ? `${b.periodo.de.split('-').reverse().join('/')} a ${b.periodo.ate.split('-').reverse().join('/')}` : 'sem período (produto novo ou série não coletada)',
  }
}
// acao_id: a ação JÁ ligada ao job (o id não muda quando o diagnóstico é refeito). Sem ele, id = hash(cliente|regra|item|mês) — a mesma função do plano.
export function acaoDeOferta(cliente, { regra, job, item = null, baseline = {}, diagnostico = {}, hoje = hojeLocal(), retro = null, acao_id = '' }) {
  const s = specOferta(regra, { job, item, b: baseline, d: diagnostico })
  const gmv = db.prepare('SELECT SUM(receita) r FROM meli_serie_item WHERE cliente = ? AND dia BETWEEN ? AND ?').get(cliente, addDias(hoje, -28), addDias(hoje, -1))?.r || 0
  const a = construirAcao(cliente, s, { hoje, gmv: Math.max(gmv, 1), retro, cli: clienteDe(cliente), ...contextoRetro(retro) })
  if (acao_id) a.id = acao_id
  a.dados.oferta = { job_id: job.id, escopo: job.escopo, objetivo: job.objetivo, versao: job.proposta_versao || 0 }
  if (!gmv) a.dados.logica += ' — GMV da conta não coletado: impacto financeiro sem base'
  // alinhamento com o cliente: abrir o job é decisão humana (o job precisa da ação ligada), então a ação existe, mas NÃO entra na semana e conta em omitidas.alinhado
  const al = alinhamentosReal().predicado(cliente, { hoje })({ item: item?.id, regra: s.regra, acao: a.id })   // o descarte de outro job do mesmo anúncio não cobre este
  if (al.sim) {
    a.dados.alinhado = { tipo: al.tipo, rotulo: al.rotulo, desde: al.desde, revisar_em: al.revisar_em }
    a.dados.fila = 'fila'
    a.dados.nota_foco = `anúncio alinhado com o cliente (${al.rotulo}, desde ${dm(al.desde)}): a ação não entra na semana`
    a.omitidas = { alinhado: 1 }
    return a
  }
  anotarAlinhamento(a, al, { semConsultor: ehChaveS90(cliente) })
  // foco: o teto por regra vale para a semana — acima dele a ação fica na FILA (contada), nunca some; a decisão de abrir o job é humana
  const cap = F.max_por_regra?.[s.regra], acima = db.prepare("SELECT COUNT(*) n FROM acoes_plano WHERE cliente = ? AND regra = ? AND id <> ? AND status IN ('proposta','aprovada') AND score >= ?").get(cliente, a.regra, a.id, a.score).n
  a.dados.posicao_na_regra = acima + 1
  a.dados.fila = cap && acima >= cap ? 'fila' : 'esta_semana'
  if (a.dados.fila === 'fila') a.dados.nota_foco = `acima do teto de ${cap} ação(ões) "${s.regra}" por cliente: fica na fila desta regra`
  return a
}
// grava (ou atualiza) a ação de um job: nasce 'aprovada' (abrir o job é a decisão humana) e entra na distribuição normal (dry-run por padrão);
// distribuída/descartada nunca é reescrita; obsoleta volta a 'aprovada' porque o job a reabriu
export function salvarAcaoOferta(a, { delegado_a = '' } = {}) {
  const t = agora()
  const ex = db.prepare('SELECT status FROM acoes_plano WHERE id = ? AND cliente = ?').get(a.id, a.cliente)
  let changes = 1
  if (!ex) db.prepare(`INSERT INTO acoes_plano (id, cliente, canal, regra, mes, titulo, horizonte, prazo, responsavel, squad, score, dados_json, status, item_id, previsao_json, algoritmo_versao, delegado_a, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'aprovada', ?,?,?,?,?,?)`).run(a.id, a.cliente, a.canal, a.regra, a.mes, a.titulo, a.horizonte, a.prazo, a.responsavel, a.squad, a.score, JSON.stringify(a.dados), a.item_id, JSON.stringify(a.previsao), algoritmo.versao, delegado_a, t, t)
  else changes = db.prepare(`UPDATE acoes_plano SET titulo=?, horizonte=?, prazo=?, responsavel=?, squad=?, score=?, dados_json=?, item_id=?, previsao_json=?, algoritmo_versao=?, delegado_a = CASE WHEN ? <> '' THEN ? ELSE delegado_a END, atualizado_em=?,
    status = CASE WHEN status IN ('proposta','obsoleta') THEN 'aprovada' ELSE status END WHERE id = ? AND cliente = ? AND status IN ('proposta','obsoleta','aprovada')`)
    .run(a.titulo, a.horizonte, a.prazo, a.responsavel, a.squad, a.score, JSON.stringify(a.dados), a.item_id, JSON.stringify(a.previsao), algoritmo.versao, delegado_a, delegado_a, t, a.id, a.cliente).changes
  // atualizada = a linha mudou de fato (distribuída/descartada fica como está: nunca dizer "atualizada" sem ter gravado)
  return { novo: !ex, status: ex?.status || 'aprovada', atualizada: changes > 0 }
}

// ── previsão do plano inteiro (previsibilidade + probabilidade) ─────────────
export function previsaoDoPlano(diag, acoes) {
  const baseline = diag.resumo.baseline_28d, atual = diag.resumo.gmv
  const ativas = acoes.filter(a => a.previsao?.tipo === 'ganho')
  const porItem = new Map()
  for (const a of ativas) { const k = a.item_id || 'conta'; (porItem.get(k) || porItem.set(k, []).get(k)).push(a) }
  // ações no mesmo anúncio se sobrepõem: o ganho conjunto é menor que a soma (desconto por sobreposição)
  const soma = key => { let t = 0; for (const as of porItem.values()) { const s = as.reduce((x, a) => x + a.previsao.esperado[key], 0); t += s / (1 + F.desconto_por_sobreposicao * (as.length - 1)) } return t }
  const bruto = { conservador: soma('conservador'), base: soma('base'), otimista: soma('otimista') }
  const teto = baseline * F.teto_plausibilidade_uplift_pct / 100
  const lim = x => Math.min(x, teto)
  const risco = acoes.filter(a => a.previsao?.tipo === 'risco_evitado').reduce((t, a) => t + a.previsao.esperado.base, 0)
  const cen = k => ({ ganho: r2(lim(bruto[k])), faturamento: r2(baseline + lim(bruto[k])), uplift_pct: baseline > 0 ? r1(100 * lim(bruto[k]) / baseline) : null })
  return {
    horizonte_dias: 28, baseline: r2(baseline), ultimo_periodo: r2(atual),
    baseline_regra: `velocidade ponderada (30d×20% + 14d×30% + 7d×50%) × 28 dias = R$ ${Math.round(diag.resumo.velocidade_dia)}/dia`,
    cenarios: { conservador: cen('conservador'), base: cen('base'), otimista: cen('otimista') },
    teto_aplicado: bruto.otimista > teto || bruto.base > teto, teto_valor: r2(teto),
    receita_em_risco_evitada: r2(risco), n_acoes: ativas.length,
    metodo: 'Σ (probabilidade de sucesso × ganho do cenário) por ação, com desconto de 25% por ação adicional no mesmo anúncio e teto de plausibilidade; o conservador usa o cenário conservador ponderado, o otimista o cenário otimista sem ponderar.',
    aviso: 'Previsão por HIPÓTESE com premissas declaradas — não é promessa. A calibração com resultados medidos refina as probabilidades ao longo do tempo.',
  }
}

// ── orquestração ────────────────────────────────────────────────────────────
export function gerarPlanoConta(cliente, { hoje = hojeLocal(), salvar = true } = {}) {
  const diag = diagnosticarConta(cliente, { hoje })
  if (!diag.disponivel) return { disponivel: false, motivo: diag.motivo }
  let retro = null, retroErro = null
  try { const r = retroalimentar(cliente, { hoje, diag, salvar }); if (r.disponivel) retro = r } catch (e) { retroErro = e.message }   // sem retroalimentação o plano sai como antes (o erro vai no retorno)
  // V3 F6: a prévia do sincronismo de estoque entra no diagnóstico só com o produto ligado (a regra estoque_sincronizar lê a MESMA prévia da rota do Chaveiro)
  if (algoritmo.produto?.diagnostico_ligado === true) try { diag.sync_estoque = syncParaPlano(cliente, { hoje }) } catch { /* sem prévia, as regras de sincronismo não nascem */ }
  const acoes = montarAcoes(cliente, diag, { hoje, retro, semConsultor: ehChaveS90(cliente) })
  const prev = previsaoDoPlano(diag, acoes)
  const r = salvar ? salvarAcoesAnuncio(cliente, acoes) : null
  if (salvar) db.prepare(`INSERT INTO planos_cliente (cliente, gerado_em, plano_json) VALUES (?,?,?) ON CONFLICT(cliente) DO NOTHING`).run(cliente, agora(), '{}')
  return { disponivel: true, diagnostico: diag, acoes, previsao: prev, salvo: r, omitidas: acoes.omitidas || {}, algoritmo_versao: algoritmo.versao, retro, retro_erro: retroErro }
}
