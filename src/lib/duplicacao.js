// APRENDIZADO da duplicação estratégica. Uma duplicação é uma FAMÍLIA (anúncio original + duplicatas): o efeito que importa é o LÍQUIDO da família
// (o original pode perder o que a duplicata ganha — canibalização), medido com a mesma régua da atribuição (controle + ruído).
// Para cada duplicação concluída o sistema descobre as duplicatas (anúncios novos parecidos com o original, criados até 14 dias depois), infere o OBJETIVO
// (teste A/B, novos públicos, 1ª página, kit/combo, recuperação) a partir do card, confere se o método do treinamento foi seguido (objetivo, volume,
// variação real, pesquisa prévia, duplicata sem venda) e aprende quais objetivos/volumes funcionam em cada conta e na base (config/duplicacao.json).
// Tudo é associação temporal ajustada — nunca causalidade comprovada. Pura onde dá; o carregador com banco fica no fim.
import { db, hojeLocal } from './db.js'
import { addDias, diasEntre, coberturaPedidos, cfgAtrib } from './meli-serie.js'
import { medirEfeito, somarSeries, wilson, excluirDaAprendizagem, precosDoCliente } from './impacto-tarefas.js'
import { tokens } from './vinculos.js'
import { grafoDoCliente } from './produto-estoque-real.js'
import { algoritmo } from './diagnostico-conta.js'
const PRODUTO_LIGADO = () => algoritmo.produto?.diagnostico_ligado === true      // a MESMA chave (objeto) que carregarBase lê
import { duplicacao as PB, familiaDeDemanda, norm, volumeEsperado } from './processos.js'
export { volumeEsperado }                          // a regra mora em processos.js (pura): o fluxo de ofertas valida o briefing sem abrir banco

const r2 = n => Math.round(n * 100) / 100
const RX_TIPOS = PB.tipos.map(t => ({ ...t, rxs: t.rx.map(r => new RegExp(r, 'i')) }))
const ESTADOS = ['melhorou', 'piorou', 'sem_efeito']

// ── blocos puros ────────────────────────────────────────────────────────────
export function sobreposicao(a, b) {
  const A = new Set(a), B = new Set(b), comuns = [...A].filter(x => B.has(x)).length
  const menor = Math.min(A.size, B.size), uniao = A.size + B.size - comuns
  return { comuns, overlap: menor ? comuns / menor : 0, jaccard: uniao ? comuns / uniao : 0 }
}
export function classificarObjetivo(texto) {
  const t = norm(texto)
  // vence o tipo com MAIS pistas no texto ("recuperar posicionamento: curva A em queda" tem 3 de recuperação e 1 de 1ª página); empate fica com o 1º da lista
  const tp = RX_TIPOS.map(x => ({ x, pts: x.rxs.filter(r => r.test(t)).length })).filter(o => o.pts).sort((a, b) => b.pts - a.pts)[0]?.x
  return tp ? { id: tp.id, nome: tp.nome, fonte: 'card' } : { id: 'indefinido', nome: 'Sem objetivo definido no card', fonte: 'nenhuma' }
}
export const bucketVolume = n => n <= 1 ? '1 duplicata' : n <= 4 ? '2 a 4 duplicatas' : n <= 10 ? '5 a 10 duplicatas' : 'mais de 10 duplicatas'

// duplicatas = anúncios NOVOS (criados de 3 dias antes a 14 depois da tarefa) cujo título se parece com o de um original (3+ palavras e metade delas em comum)
// V3 F5: produtoDe (Map item_id → chave do produto do grafo; só com produto.diagnostico_ligado) — candidato criado na janela com o MESMO produto de um original vira filho
// por FATO (fonte 'produto', similaridade 1), mesmo com título diferente; o título por IDF fica de reserva para anúncio sem chave. Sem produtoDe a saída é a de sempre.
export function acharFilhos({ originais, candidatos, data, c = PB.aprendizado, produtoDe = null }) {
  const de = addDias(data, -3), ate = addDias(data, c.janela_filhos_dias), ids = new Set(originais.map(o => o.item_id)), out = []
  const prodOrig = produtoDe ? new Map(originais.map(o => [produtoDe.get(String(o.item_id)), o.item_id]).filter(([k]) => k)) : null
  // palavra comum a quase todos os anúncios da loja ("kit", "cachorro") não prova parentesco: o peso de cada palavra é o IDF no catálogo do cliente
  const toks = new Map(candidatos.map(it => [it.item_id, tokens(it.titulo)])), df = new Map()
  for (const tk of toks.values()) for (const w of tk) df.set(w, (df.get(w) || 0) + 1)
  const N = Math.max(1, candidatos.length), idf = w => Math.log(1 + N / (df.get(w) || 1))
  const peso = ws => ws.reduce((t, w) => t + idf(w), 0)
  const tkO = originais.map(o => ({ id: o.item_id, tk: tokens(o.titulo) }))
  for (const it of candidatos) {
    if (ids.has(it.item_id) || !it.criado_em || it.criado_em < de || it.criado_em > ate) continue
    const tk = toks.get(it.item_id) || []
    const orig = prodOrig?.get(produtoDe.get(String(it.item_id)))
    if (orig) { const o = tkO.find(x => x.id === orig); out.push({ item_id: it.item_id, titulo: it.titulo, criado_em: it.criado_em, original: orig, similaridade: 1, variacao_titulo: r2(1 - sobreposicao(o.tk, tk).jaccard), preco: it.preco ?? null, fonte: 'produto' }); continue }
    let melhor = null
    for (const o of tkO) {
      const s = sobreposicao(o.tk, tk)
      if (s.comuns < 3) continue
      const set = new Set(tk), comuns = o.tk.filter(w => set.has(w))
      const ov = peso(comuns) / Math.max(1e-9, Math.min(peso(o.tk), peso(tk)))      // sobreposição ponderada pelo IDF
      if (ov >= c.min_similaridade_filho && (!melhor || ov > melhor.overlap)) melhor = { overlap: ov, jaccard: s.jaccard, original: o.id }
    }
    if (melhor) out.push({ item_id: it.item_id, titulo: it.titulo, criado_em: it.criado_em, original: melhor.original, similaridade: r2(melhor.overlap), variacao_titulo: r2(1 - melhor.jaccard), preco: it.preco ?? null })
  }
  return out.sort((a, b) => b.similaridade - a.similaridade).slice(0, 15)     // teto: o método não passa de 10 por objetivo; mais que isso quase sempre é cadastro em lote, não duplicação
}

// o método do treinamento, conferido item a item (não é opinião: cada linha cita o dado)
export function aderenciaAoMetodo({ objetivo, filhos, originais, pesquisaPrevia, c = PB.aprendizado }) {
  const n = filhos.length, itens = []
  itens.push({ k: 'objetivo', ok: objetivo.id !== 'indefinido', texto: objetivo.id !== 'indefinido' ? `Objetivo definido: ${objetivo.nome}.` : 'Sem objetivo definido no card (regra de ouro: nunca duplique sem objetivo).' })
  const vol = volumeEsperado(objetivo.id, n)
  if (vol.ok != null) itens.push({ k: 'volume', ok: vol.ok, texto: vol.texto })
  const comVar = filhos.filter(f => f.variacao_titulo >= c.variacao_minima_titulo || (f.preco != null && originais.some(o => o.preco != null && Math.abs(f.preco / o.preco - 1) >= 0.03)))
  if (n) itens.push({ k: 'variacao', ok: comVar.length >= Math.ceil(n / 2), texto: `${comVar.length} de ${n} duplicata(s) com variação detectada (título com ≥ ${Math.round(c.variacao_minima_titulo * 100)}% de palavras diferentes ou preço ≥ 3% diferente); capa e categoria não são lidas pela API — conferir no card.` })
  if (['novos_publicos', 'kit_combo', 'primeira_pagina'].includes(objetivo.id)) itens.push({ k: 'pesquisa', ok: !!pesquisaPrevia, texto: pesquisaPrevia ? 'Há pesquisa de mercado concluída antes da duplicação.' : 'Não há pesquisa de mercado concluída nos 60 dias anteriores: a urgência oculta é SEMPRE do consultor (sem ela é aposta).' })
  const ok = itens.filter(i => i.ok === true).length, tot = itens.filter(i => i.ok != null).length
  return { itens, nota: tot ? r2(ok / tot) : null }
}

// efeito LÍQUIDO da família × efeito do original sozinho (canibalização). tocados: Map item → [datas] de tarefas E de mudança de preço ≥ limiar
// (sai do controle); datasPreco: mudanças de preço ≥ limiar da própria família (viram data de placebo, como em analisarCliente)
export function medirFamilia({ originais, filhos, data, porItem, tocados, cobertura, hoje, lag, datasPreco = [], params = cfgAtrib }) {
  const montar = ids => ({ unidades: somarSeries(ids.map(i => porItem.get(i)?.unidades || {})), receita: somarSeries(ids.map(i => porItem.get(i)?.receita || {})), visitas: null })
  const fam = [...originais, ...filhos]
  let m, mo
  for (const Nj of params.janelas_adaptativas || [params.janela_dias]) {
    const t = new Set(fam)
    for (const [item, datas] of tocados) if (!t.has(item) && datas.some(d => d >= addDias(data, -Nj - 3) && d <= addDias(data, lag + Nj + 3))) t.add(item)
    const idsCtrl = [...porItem.keys()].filter(i => !t.has(i))
    const controle = idsCtrl.length ? montar(idsCtrl) : null
    const base = { controle, data, N: Nj, lag, cobertura, hoje, escopo: 'anuncios', eventosPlacebo: [data, ...datasPreco], params }
    m = medirEfeito({ ...base, alvo: montar(fam) })
    mo = medirEfeito({ ...base, alvo: montar(originais) })
    if (m.estado !== 'sem_base' || m.causa === 'cobertura') break
  }
  const lim = params.limiar_efeito_pct
  return {
    estado: m.estado, efeito_pct: m.efeito_pct ?? null, receita_incremental: m.receita_incremental ?? null, motivo: m.motivo || null,
    original_estado: mo.estado, original_efeito_pct: mo.efeito_pct ?? null,
    // a família subiu (ou ficou) mas o original caiu: parte do ganho é só o público trocando de anúncio
    canibalizou: mo.efeito_pct != null && mo.efeito_pct <= -lim && m.estado !== 'piorou',
  }
}

// ── aprendizado: o que funciona (por objetivo, por volume, por aderência) ───
const cel = (eps, base) => {
  const n = eps.length, k = eps.filter(e => e.estado === 'melhorou').length, p = eps.filter(e => e.estado === 'piorou').length, w = wilson(k, n)
  return { n, melhorou: k, piorou: p, sem_efeito: n - k - p, taxa: w.p, taxa_baixo: w.baixo, taxa_alto: w.alto, canibalizou: eps.filter(e => e.canibalizou).length,
    efeito_mediano_pct: (() => { const a = eps.map(e => e.efeito_pct).filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null })() }
}
export function aprenderDuplicacao(episodios, { minN = 8, veredito = () => 'sem_amostra' } = {}) {
  // a medida da tarefa que não ensina (preço mexendo junto na janela, reversão à média) também não ensina o objetivo da duplicação
  const medidos = episodios.filter(e => ESTADOS.includes(e.estado) && !excluirDaAprendizagem(e))
  const geral = cel(medidos), base = medidos.length >= minN ? Math.min(geral.taxa, 0.5) : null
  const grupo = chave => { const g = new Map(); for (const e of medidos) { const k = chave(e); if (k != null) (g.get(k) || g.set(k, []).get(k)).push(e) } return [...g].map(([k, es]) => ({ chave: k, ...cel(es), veredito: veredito(es.length, es.filter(x => x.estado === 'melhorou').length, base) })).sort((a, b) => b.n - a.n) }
  const leituras = []
  const semObjetivo = episodios.filter(e => e.objetivo.id === 'indefinido').length
  if (semObjetivo) leituras.push(`${semObjetivo} de ${episodios.length} duplicação(ões) sem objetivo definido no card — a regra de ouro do método é nunca duplicar sem objetivo.`)
  const semVenda = episodios.flatMap(e => e.filhos.filter(f => f.sem_venda_14d))
  if (semVenda.length) leituras.push(`${semVenda.length} duplicata(s) com 14+ dias sem nenhuma venda: pausar ou revisar (duplicata ruim ativa dilui a saúde da conta).`)
  const semVar = episodios.filter(e => e.aderencia.itens.some(i => i.k === 'variacao' && i.ok === false)).length
  if (semVar) leituras.push(`${semVar} duplicação(ões) sem variação detectada na maioria das duplicatas (título e preço iguais): só trocar a descrição não é duplicação estratégica.`)
  const canib = medidos.filter(e => e.canibalizou).length
  if (canib) leituras.push(`${canib} de ${medidos.length} duplicação(ões) medidas canibalizaram o original (o original caiu enquanto a família subiu ou ficou).`)
  const por_objetivo = grupo(e => e.objetivo.id), por_volume = grupo(e => bucketVolume(e.n_filhos))
  for (const g of por_objetivo) if (g.veredito === 'funciona') leituras.push(`Objetivo "${PB.tipos.find(t => t.id === g.chave)?.nome || g.chave}": ${g.melhorou} de ${g.n} duplicações melhoraram o líquido da família (acima do habitual).`)
  for (const g of por_volume) if (g.veredito === 'nao_funciona') leituras.push(`Volume "${g.chave}": só ${g.melhorou} de ${g.n} melhoraram — abaixo do habitual; revisar o volume com o consultor.`)
  if (medidos.length < minN) leituras.push(`Amostra ainda pequena (${medidos.length} duplicação(ões) com resultado medido; o sistema só afirma o que funciona a partir de ${minN}).`)
  return { n: episodios.length, n_medidos: medidos.length, geral, base, por_objetivo, por_volume, leituras }
}
// ajuste do plano por OBJETIVO: só quando o objetivo difere de forma conclusiva do geral das duplicações (Wilson) e com amostra mínima
export function fatorPorObjetivo(aprendizado, { minN = 8, min = 0.85, max = 1.15 } = {}) {
  const out = {}
  const g = aprendizado.geral
  if (aprendizado.n_medidos < minN || !(g.taxa > 0)) return out
  for (const o of aprendizado.por_objetivo) {
    if (o.n < minN) continue
    const w = wilson(o.melhorou, o.n)
    if (w.baixo > g.taxa || w.alto < g.taxa) { const pE = (o.melhorou + 5 * g.taxa) / (o.n + 5); out[o.chave] = { fator: r2(Math.min(max, Math.max(min, pE / g.taxa))), n: o.n, melhorou: o.melhorou } }
  }
  return out
}

// ── carregador com banco ────────────────────────────────────────────────────
function seriesDoCliente(cliente) {
  const por = new Map()
  for (const r of db.prepare('SELECT item_id, dia, unidades, receita FROM meli_serie_item WHERE cliente = ?').all(cliente)) {
    const o = por.get(r.item_id) || { unidades: {}, receita: {} }
    if (r.unidades) { o.unidades[r.dia] = r.unidades; o.receita[r.dia] = r.receita }
    por.set(r.item_id, o)
  }
  return por
}
export function duplicacoesDoCliente(cliente, { analise, hoje = hojeLocal() } = {}) {
  const duplic = analise.medidas.filter(m => familiaDeDemanda(m.tipo).id === 'duplicacao')
  if (!duplic.length) return []
  const cobertura = coberturaPedidos(cliente), porItem = seriesDoCliente(cliente)
  // V3 F5: família pela chave do produto (grafo) quando a chave do produto está ligada; título como reserva
  let produtoDe = null
  if (PRODUTO_LIGADO()) { try { produtoDe = new Map([...grafoDoCliente(cliente, { hoje }).doItem].map(([id, x]) => [id, x.produto.chave])) } catch { produtoDe = null } }
  const itens = new Map(db.prepare('SELECT item_id, titulo, criado_em, status, preco FROM meli_item WHERE cliente = ?').all(cliente).map(r => [r.item_id, r]))
  const candidatos = [...itens.values()]
  const tocados = new Map(), { grandes } = precosDoCliente(cliente)
  for (const m of analise.medidas) for (const i of m.itens || []) (tocados.get(i) || tocados.set(i, []).get(i)).push(m.data)
  for (const [i, ds] of grandes) (tocados.get(i) || tocados.set(i, []).get(i)).push(...ds)       // anúncio que mudou de preço na janela não é controle
  const texto = db.prepare('SELECT titulo, descricao FROM tarefas WHERE id = ?')
  const pesquisa = db.prepare("SELECT 1 FROM tarefas WHERE cliente = ? AND arquivada = 0 AND status = 'concluida' AND (tipo_demanda LIKE '%esquisa%' OR titulo LIKE '%esquisa de mercado%' OR titulo LIKE '%rgência oculta%' OR titulo LIKE '%rgencia oculta%') AND COALESCE(NULLIF(data_conclusao, ''), SUBSTR(last_edited, 1, 10)) BETWEEN ? AND ? LIMIT 1")
  const out = []
  for (const m of duplic) {
    const t = texto.get(m.id) || {}
    const objetivo = classificarObjetivo(`${t.titulo || m.titulo} ${t.descricao || ''}`)
    const ligados = (m.itens || []).map(i => itens.get(i)).filter(Boolean)
    const novos = ligados.filter(i => i.criado_em && i.criado_em >= addDias(m.data, -3)), velhos = ligados.filter(i => !novos.includes(i))
    let originais = velhos
    if (!originais.length && novos.length) {      // só a duplicata foi citada: o original é o anúncio ANTIGO mais parecido
      const velhosCand = candidatos.filter(c => c.criado_em && c.criado_em < addDias(m.data, -3))
      const achados = novos.map(n => velhosCand.map(v => ({ v, s: sobreposicao(tokens(v.titulo), tokens(n.titulo)) })).filter(x => x.s.comuns >= 3 && x.s.overlap >= PB.aprendizado.min_similaridade_filho).sort((a, b) => b.s.overlap - a.s.overlap)[0]?.v).filter(Boolean)
      originais = [...new Map(achados.map(a => [a.item_id, a])).values()]
    }
    if (!originais.length) { out.push({ tarefa_id: m.id, titulo: m.titulo, data: m.data, objetivo, n_filhos: 0, filhos: [], originais: [], estado: 'sem_original', motivo: 'anúncio original não identificado no card', aderencia: { itens: [], nota: null }, efeito_pct: null, canibalizou: false, pesquisa_previa: false }); continue }
    const filhosAch = acharFilhos({ originais, candidatos, data: m.data, produtoDe })
    const filhos = [...new Map([...novos.filter(n => !originais.some(o => o.item_id === n.item_id)).map(n => ({ item_id: n.item_id, titulo: n.titulo, criado_em: n.criado_em, original: originais[0].item_id, similaridade: null, variacao_titulo: r2(1 - sobreposicao(tokens(originais[0].titulo), tokens(n.titulo)).jaccard), preco: n.preco })), ...filhosAch].map(f => [f.item_id, f])).values()]
    for (const f of filhos) {
      const idade = diasEntre(f.criado_em, hoje), vendas = Object.entries(porItem.get(f.item_id)?.unidades || {}).filter(([d]) => d >= f.criado_em).reduce((s, [, v]) => s + v, 0)
      f.unidades = vendas; f.idade_dias = idade
      f.sem_venda_14d = idade >= PB.aprendizado.dias_para_julgar_filho && vendas === 0 && (itens.get(f.item_id)?.status || '') === 'active'
    }
    const pesquisaPrevia = !!pesquisa.get(cliente, addDias(m.data, -60), m.data)
    const lag = Math.max(cfgAtrib.lag_dias_por_tipo?.['Duplicação de Títulos'] ?? cfgAtrib.lag_dias_padrao, filhos.length ? Math.max(...filhos.map(f => diasEntre(m.data, f.criado_em))) : 0)
    const fam = [...originais.map(o => o.item_id), ...filhos.map(f => f.item_id)]
    const medida = filhos.length ? medirFamilia({ originais: originais.map(o => o.item_id), filhos: filhos.map(f => f.item_id), data: m.data, porItem, tocados, cobertura, hoje, lag, datasPreco: fam.flatMap(i => grandes.get(i) || []) }) : { estado: 'sem_duplicata', motivo: 'nenhuma duplicata encontrada (anúncio novo parecido) nos 14 dias seguintes', efeito_pct: null, canibalizou: false }
    const objetivoFinal = objetivo.id !== 'indefinido' ? objetivo : (filhos.length === 1 ? { id: 'teste_ab', nome: 'Teste A/B (inferido: 1 duplicata)', fonte: 'volume' } : objetivo)
    out.push({
      tarefa_id: m.id, titulo: m.titulo, data: m.data, url: m.url, objetivo: objetivoFinal, objetivo_no_card: objetivo.id !== 'indefinido',
      originais: originais.map(o => ({ item_id: o.item_id, titulo: o.titulo })), filhos, n_filhos: filhos.length, pesquisa_previa: pesquisaPrevia,
      aderencia: aderenciaAoMetodo({ objetivo: objetivo, filhos, originais, pesquisaPrevia }), ...medida,
      confundido_preco: m.confundido_preco === true, confundido_estado: m.confundido_estado === true, reversao_provavel: m.reversao_provavel === true,      // da medida da tarefa: fora do aprendizado (aprenderDuplicacao)
    })
  }
  return out
}
