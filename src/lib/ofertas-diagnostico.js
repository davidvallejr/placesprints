// Diagnóstico e proposta do módulo Ofertas (spec §8, critérios 7, 8). PURO: recebe série/Ads/item injetados (mesma forma de diagnostico-conta.js:
// meli_serie_item, meli_ads_item, meli_item), nunca lê banco nem rede. Lentes separadas (descoberta · clique · conversão · viabilidade · qualidade),
// cada sinal com evidência e severidade; ausência de dado ≠ zero. A proposta só mexe no ESCOPO pedido ('ficha' não toca título/preço/estoque/imagens).
// Textos: só fato da ficha com fonte; MPN/fabricante/modelo nunca recebem termo promocional (ehPromocional). IA opcional: explica/varia texto, não calcula.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { CFG_OFERTAS, criarPreco } from './ofertas-preco.js'
import { origemCatalogo } from './catalogo.js'
import { CATALOGO, TEXTO_CATALOGO } from './catalogo-cfg.js'
import { checarPreservacao, CAMPOS_PRESERVAR_TITULO, ROTULO_PRESERVAR } from './ofertas-preservacao.js'   // puro: ofertas.js abriria o banco no import (relatorio-brief importa este módulo)

const L = CFG_OFERTAS.limiares_diagnostico
// CTR de referência é o da PRÓPRIA conta × fator do Algoritmo (config/algoritmo.json, da G1 — só leitura). Fallback 0,6 só se a chave sumir do config.
const FATOR_CTR_BAIXO = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')).limiares?.ads_ctr_vs_conta_baixo ?? 0.6
const listaCampos = l => l.map(c => `${ROTULO_PRESERVAR[c.campo] || c.campo} (${c.valor})`).join(', ')
const r2 = n => Math.round(n * 100) / 100
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const num = v => Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null
const soma = (lista, k) => lista.some(x => num(x[k]) != null) ? lista.reduce((t, x) => t + (num(x[k]) ?? 0), 0) : null   // nenhum dia com o campo → null, não 0

// ── termos proibidos (config/ofertas.json): palavra/frase inteira, sem acento e sem caixa ──
// "top" do config SEGUE vetado como elogio/promessa: elogio ANTES ou DEPOIS, colado ou separado só por pontuação ("Qualidade Top", "Qualidade-Top", "Top Qualidade",
// "Top-Qualidade", "Top: Qualidade", "Top (Qualidade)", "Top de Alta Qualidade", "Top de/da Linha", "Top de Verdade", "Top Demais", "Top Venda(s)", "Top Seller",
// "Top 1/10", "Top-10", "Top Um/Dez", "Top Nº1", "Top Nr 1", "Top Número Um", "Top Primeiro Lugar", "Top Premium", "Top Best Seller", "Top Quality", "Top de Primeira",
// "Top Sucesso/Campeão de Vendas", "Top Superior/Absoluto/Líder", "Super-Top", "8 em 1 Top") é sempre vetado, em qualquer categoria. "Premium" só conta DEPOIS do top
// ("Premium Top Com Bojo" é a peça premium). Sem elogio, "top" é PEÇA DE ROUPA só com contexto de vestuário: (a) a palavra vizinha (pulando e/com/quantidade) é peça
// ("Top Cropped", "Short e Top", "Top com Bojo", "Kit 3 Top"); (b) abre o texto e uma das 3 palavras seguintes é vocabulário de moda ("Top Feminino…", "Top Canelado…",
// "Top Um Ombro"); (c) o produto é de vestuário/moda praia/fitness (ctx.vestuario, da ficha) e o "top" vem seguido de palavra. Fora disso ("Top Quality", "Top Laranja"
// sem ficha de moda — cor não é vocabulário de top, vem da ficha —, "Chave … Top Laranja") → vetado. Dúvida (no fim, sem peça) → vetado. Entre o "top" e a peça vizinha
// de DEPOIS pode haver vocabulário de moda ("Kit Top Feminino + Legging"); antes não ("Legging Feminina Top" é dúvida no fim).
// Número ANTES do top é quantidade com kit/conjunto/lote/pack/par/combo antes no texto ou logo depois de "+", ",", "e", "com" ("Kit Legging + 1 Top", "Lote 10 Top",
// "Kit 3 Top" — contado = peça, mesmo no fim); sem esse contexto é ranking ("10 Top Fitness"). Número DEPOIS separado por vírgula/parêntese ("Short e Top, 2 Peças") é
// quantidade; colado, com espaço ou hífen é ranking.
// ponytail: vizinhança de 1 palavra (3 só no início); ampliar PECA_TOP/MODA_TOP/ELOGIO com caso real, nunca o contrário
const PECA_TOP = new Set(['cropped', 'fitness', 'bojo', 'short', 'shorts', 'legging', 'leggings', 'macaquinho', 'biquini', 'faixa', 'nadador', 'alcinha', 'regata'])
const MODA_TOP = new Set(['feminino', 'feminina', 'esportivo', 'esportiva', 'academia', 'canelado', 'canelada', 'treino', 'ginastica', 'yoga', 'pilates', 'praia', 'sutia', 'alca', 'alcas', 'ombro', 'infantil', 'juvenil',
  'malha', 'suplex', 'renda', 'cetim', 'basico', 'basica', 'liso', 'lisa', 'estampado', 'estampada', 'decote', 'ciganinha', 'tomara',
  'alto', 'medio', 'media', 'baixo', 'baixa', 'impacto', 'sustentacao', 'compressao', 'triangulo', 'cortininha', 'dry', 'fit', 'frente', 'unica', 'unico', 'costura', 'floral', 'cruzado', 'cruzada', 'transpassado', 'transpassada'])   // vale com "top" abrindo o texto, ou entre o "top" e a peça seguinte
const LIGA_TOP = new Set(['e', 'com', 'c', 'sem'])
const P = '[^a-z0-9]'                                         // separador = qualquer pontuação/espaço (palavrasDe divide igual)
const NUM_EXT = String.raw`(?:um|tres|cinco|dez|vinte|cem|mil)(?!${P}+(?:ombro|alca|lado)\b)`   // ranking por extenso; "Top Um Ombro", "Top Uma Alça" são peça
const QUALIF = String.raw`(?:(?:de|da|do|das|dos|em|na|no|nas|nos|com|pela|pelo|pelas|pelos|por)${P}+)?(?:(?:alta|altissima|otima|boa|excelente|maxima|melhor|primeira|muita)${P}+)?`   // "Top nas Vendas", "Top com Qualidade", "Top pela Qualidade"
const ELOGIO = String.raw`#\s*(?:\d+|um)|(?:n|nr)\s*(?:[º°]|o\.?|\.)?\s*(?:\d+|um)|numero${P}*(?:\d+|${NUM_EXT})|primeiro${P}+lugar|de${P}+primeira|best${P}*sellers?|${QUALIF}(?:linha|qualidade|quality|vendas?|vendid[oa]s?|mais${P}+vendid[oa]s?|sellers?|verdade|sucesso|campe(?:ao|oes|a|as)|lider(?:es)?|superior|absolut[oa])|demais`   // "Top nos Mais Vendidos"
const TOP_DEPOIS = new RegExp(String.raw`^(?:${P}*(?:${ELOGIO}|premium)|(?:\s+|-)?(?:\d+|${NUM_EXT}))(?![a-z0-9])`)
const TOP_ANTES = new RegExp(String.raw`(?<![a-z0-9])(?:${ELOGIO}|super|muito|bem|mega|ultra)${P}*$`)
const TOP_ANTES_NUM = /(?<![a-z0-9])\d{1,2}(?:\s+|-)?$/
const RX_QTD_CTX = /(?:^|[^a-z0-9])(?:kits?|conjuntos?|lotes?|packs?|par(?:es)?|combos?)(?![a-z0-9])/           // contexto de kit em qualquer ponto antes do "top"
const RX_QTD_LIGA = /(?:[+,]|(?:^|[^a-z0-9])(?:e|com|c|leve|pague))[^a-z0-9]*\d{1,2}(?:\s+|-)?$/               // "+ 1 Top", ", 1 Top", "e 1 Top", "com 1 Top"
const palavrasDe = s => s.split(/[^a-z0-9]+/).filter(Boolean)
function trechoTop(ns, ini, fim, vestuario = false) {         // [ini, fim) do "top" em ns → trecho vetado (com a promessa colada) ou null (peça de roupa)
  const pre = ns.slice(0, ini), pos = ns.slice(fim)
  const qtd = TOP_ANTES_NUM.test(pre) && (RX_QTD_CTX.test(pre) || RX_QTD_LIGA.test(pre))   // "Kit 3 Top", "+ 1 Top": o número conta a peça
  const a = pre.match(TOP_ANTES) || (qtd ? null : pre.match(TOP_ANTES_NUM)), d = pos.match(TOP_DEPOIS)
  if (a || d) return [a ? a.index : ini, fim + (d ? d[0].length : 0)]
  if (qtd) return null
  const antes = palavrasDe(pre), depois = palavrasDe(pos), vizinha = (ps, moda = false) => ps.find(p => !LIGA_TOP.has(p) && !/^\d+$/.test(p) && !(moda && MODA_TOP.has(p)))
  if (PECA_TOP.has(vizinha([...antes].reverse())) || PECA_TOP.has(vizinha(depois, true))) return null
  if (!antes.length && depois.slice(0, 3).some(p => MODA_TOP.has(p))) return null
  return depois.length && vestuario ? null : [ini, fim]
}
// vestuário pela ficha: categoria em texto (nome/caminho, quando a ficha trouxer) ou atributo que só a categoria de roupa do ML tem (o importador grava os atributos da categoria)
// (a raiz "Calçados, Roupas e Bolsas" não conta: calçado e bolsa não são vestuário; tabela de medidas idem, calçado também tem)
// ponytail: id de categoria solto (MLB…) não diz nada sem o caminho; quando a ficha levar categoria_canal com caminho, entra aqui sem mudar a regra
const RX_VESTUARIO = /\broupas?\b|\bvestuario\b|\bmoda (?:praia|fitness|intima)\b|\blingerie\b/
const ATR_VESTUARIO = new Set(['GARMENT_TYPE', 'SLEEVE_TYPE', 'NECKLINE_TYPE', 'SWIMWEAR_TYPE'])
const ehVestuario = f => RX_VESTUARIO.test(norm([f?.categoria, f?.categoria?.nome, f?.categoria?.caminho, f?.categoria_caminho].filter(x => typeof x === 'string').join(' ')).replace(/calcados, roupas e bolsas/g, ''))
  || (f?.atributos || []).some(x => ATR_VESTUARIO.has(String(x?.atributo_id).toUpperCase()))
const TODOS_TERMOS = Object.entries(CFG_OFERTAS.termos_proibidos).filter(([k]) => !k.startsWith('$')).flatMap(([, v]) => v)
// FONTE ÚNICA da lista de proibidos dos prompts (diagnostico-motor → derived_prompts[].restricoes.proibido): "top" sai como a regra acima, nunca a palavra solta
// (senão "Top Fitness Nadador" vira proibição de "top")
export const TERMOS_PROIBIDOS_PROMPT = TODOS_TERMOS.map(t => norm(t) === 'top' ? 'top como elogio ou promessa (top 1, top 10, top de linha, top de qualidade, qualidade top, top premium, top best seller); "top" peça de roupa é permitido' : t)
const termo = t => norm(t) === 'top' ? { t, top: true, rx: /(^|[^a-z0-9])top(?![a-z])/g }       // "top1" também é "top" (dígito colado = promessa)
  : { t, top: false, rx: new RegExp(`(^|[^a-z0-9])${norm(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'g') }
const RX = TODOS_TERMOS.map(termo)
function trechos(ns, lista = RX, { vestuario = false } = {}) {   // ns já normalizado → [{ t, ini, fim }] de cada ocorrência vetada
  const out = []
  for (const { t, top, rx } of lista) for (const m of ns.matchAll(rx)) {
    const r = top ? trechoTop(ns, m.index + m[1].length, m.index + m[0].length, vestuario) : [m.index + m[1].length, m.index + m[0].length]
    if (r) out.push({ t, ini: r[0], fim: r[1] })
  }
  return out
}
// ctx = { vestuario } (montarTituloDetalhado/diagnosticar/montarDescricao passam o da ficha); sem ctx, a regra mais estrita
export function termosPromocionais(texto, termos = null, ctx = {}) {
  const n = norm(texto)
  return n ? [...new Set(trechos(n, termos ? termos.map(termo) : RX, ctx).map(x => x.t))] : []
}
export const ehPromocional = (texto, termos = null, ctx = {}) => termosPromocionais(texto, termos, ctx).length > 0
// só para VARIANTE (cor/tamanho): retira o trecho vetado e devolve o resto com acento/caixa originais. O lugar do termo fica marcado (BURACO) até aparar consumir:
// preposição colada ao buraco pertencia ao termo ("Azul de Presente de Rosa" → "Azul Rosa"); "e/ou/com" colado só fica quando liga dois lados limpos ("Rosa Presente e
// Azul" → "Rosa e Azul"; "Rosa, Presente e Azul" → "Rosa, Azul"; "e Presente e" → um "e"); separador colado ao buraco cola no vizinho ("Rosa Presente/Azul" → "Rosa/Azul").
// Sobra = token sem letra/número (qualquer pontuação ou símbolo: & • ★ ! * ~ = > ✓ .; "%"/"°" depois de número ficam) ou conectivo solto (e, ou, e/ou, com, de, p/, c/…):
// sai das pontas do campo E das pontas de cada grupo entre parênteses/colchetes/aspas (grupo que esvazia sai inteiro; aspas em volta do que sobrou saem); no meio,
// pontuação dobrada vira uma, pontuação solta que não é separador ("!", "*", "★", ".") e conectivo dobrado ("ou ou", "e e", "com com") somem, e vírgula/ponto-e-vírgula/
// dois-pontos não ficam com espaço antes ("Rosa , Azul" → "Rosa, Azul"). Repete até limpar (a retirada pode juntar um termo novo). Nome/marca/modelo nunca passam aqui:
// tirar a palavra inventaria produto ou marca.
const SEP = '-–—,;:|/+&•·'
const RX_SEP_DOBRADO = new RegExp(`\\s*([${SEP}])(?:\\s*[${SEP}])+`, 'g')
const RX_SEP_UM = new RegExp(`^[${SEP}]$`)
const RX_COLA_INI = /^[-–—/+&|•·]/, RX_COLA_FIM = /[-–—/+&|•·]$/      // separador que cola nos dois lados (vírgula/ponto-e-vírgula/dois-pontos não: ficam com espaço depois)
const BURACO = ''                                               // marca do termo retirado (retirarTermos); aparar sempre a consome
const temConteudo = t => /[\p{L}\p{N}]/u.test(t)
const PREP = t => /^(?:de|da|do|das|dos|para|pra|p\/|c\/)$/i.test(t ?? '')
const COORD = t => /^(?:e|ou|e\/ou|com)$/i.test(t ?? '')
const SOBRA = t => !temConteudo(t) || PREP(t) || COORD(t)
const CONECTIVO = t => temConteudo(t) && SOBRA(t)
const limpo = t => t != null && t !== BURACO && !SOBRA(t) && /^[\p{L}\p{N}("“„«‘']/u.test(t) && /[\p{L}\p{N})”“»’'%°]$/u.test(t)   // lado que um "e" pode ligar
const RX_PONTA = /^[[\p{P}\p{S}]--[\(\[\{"“„«‘'%]]+|[[\p{P}\p{S}]--[\)\]\}"”“»’'%°]]+$/gv   // pontuação colada na ponta (parêntese/aspas/% ficam)
function aparar(s) {
  let tk = s.split(/\s+/).filter(Boolean)
  for (;;) {                                                                                                // conectivo colado ao buraco
    tk = tk.filter((t, i, a) => !(t === BURACO && a[i - 1] === BURACO))
    const i = tk.findIndex((t, i, a) => (PREP(t) || COORD(t)) && (a[i - 1] === BURACO || a[i + 1] === BURACO))
    if (i < 0) break
    if (PREP(tk[i])) { tk[i] = BURACO; continue }                                                           // "de [Presente]" → o "de" era do termo
    const s0 = tk[i + 1] === BURACO ? i : i - 1, L = tk[s0 - 1], R = tk[s0 + 2]
    tk.splice(s0, 2, !COORD(L) && !COORD(R) && limpo(L) && limpo(R) ? tk[i] : BURACO)                       // "Rosa e [x] Azul" → "Rosa e Azul"; "e [x] e" → "e"; "Rosa, [x] e Azul" → "Rosa, Azul"
  }
  const out = []
  for (let i = 0; i < tk.length; i++) {
    const t = tk[i], p = out.at(-1), q = tk[i + 1]
    if (t !== BURACO) out.push(t)
    else if (p && q && q !== BURACO && temConteudo(p) && temConteudo(q) && (RX_COLA_INI.test(q) || RX_COLA_FIM.test(p))) { out[out.length - 1] = RX_COLA_FIM.test(p) && RX_COLA_INI.test(q) ? p + q.slice(1) : p + q; i++ }   // "Rosa [x] /Azul" → "Rosa/Azul"
  }
  tk = out
    .filter((t, i, a) => temConteudo(t) || RX_SEP_UM.test(t) || (/^[%°]$/.test(t) && /\d$/.test(a[i - 1] ?? '')))   // "Rosa ! Azul", "Rosa ★ Azul" → "Rosa Azul" (separador e "100 %" ficam)
    .filter((t, i, a) => !(i && !temConteudo(t) && !temConteudo(a[i - 1])))                               // "Rosa - - Azul" → "Rosa - Azul"
    .filter((t, i, a) => !(i && CONECTIVO(t) && CONECTIVO(a[i - 1])))                                      // "Azul ou ou Rosa" → "Azul ou Rosa"
  while (tk.length && SOBRA(tk[0])) tk.shift()
  while (tk.length && SOBRA(tk.at(-1))) tk.pop()
  return tk.join(' ').replace(/\s+(?=[,;:])/g, '').replace(RX_PONTA, '')
}
function limparSobras(s) {
  let r = s.replace(/['‘]\s*['’]/g, ' '), antes
  do {                                                        // de dentro para fora: "(Ideal p/ )" → "(Ideal)"; "( & )", "(!)", "„“" → nada
    antes = r
    r = r.replace(/([([{])([^()[\]{}]*)([)\]}])/g, (m, a, x, f) => (x = aparar(x)) ? a + x + f : ' ')
      .replace(/(["“„«])([^"“”„«»]*)(["”“»])/g, (m, a, x) => ` ${aparar(x)} `)
  } while (r !== antes)
  r = r.replace(new RegExp(`\\s*([${SEP}])(?:\\s*${BURACO}\\s*)?(?:\\s*[${SEP}])+`, 'g'), (m, c) => (/^\s/.test(m) ? ' ' : '') + ` ${BURACO} ` + c)   // "Rosa, [x], Azul" → "Rosa, Azul" (o buraco fica para aparar consumir)
  r = aparar(r.replace(RX_SEP_DOBRADO, (m, c) => (/^\s/.test(m) ? ' ' : '') + c))
  return (r.match(/["“”„«»]/g) || []).length % 2 ? r.replace(/["“”„«»]/g, '').trim() : r   // aspa órfã: a outra metade saiu junto com o termo
}
function retirarTermos(texto, ctx = {}) {
  let s = String(texto ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
  const removidos = new Set()
  for (;;) {
    const n = [], ix = []                                     // n = texto normalizado caractere a caractere; ix[k] = posição em s
    for (let i = 0; i < s.length; i++) for (const c of s[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()) { n.push(c); ix.push(i) }
    const achados = trechos(n.join(''), RX, ctx)
    if (!achados.length) return { valor: s, removidos: [...removidos] }
    const corta = new Array(s.length).fill(false)
    for (const { t, ini, fim } of achados) { removidos.add(t); for (let k = ini; k < fim; k++) corta[ix[k]] = true }
    s = limparSobras(s.split('').map((c, i) => (corta[i] ? (corta[i - 1] ? '' : ` ${BURACO} `) : c)).join(''))   // cada trecho cortado vira UM buraco
  }
}
// atributos de identidade: representam o produto real (spec §2) — nunca espaço de campanha; GTIN nunca é alterado pela proposta
const ID_SEM_PROMO = new Set(['MPN', 'MANUFACTURER', 'MODEL', 'ALPHANUMERIC_MODEL', 'BRAND', 'LINE', 'FABRICANTE', 'MODELO', 'MARCA'])
const INTOCAVEIS = new Set(['GTIN', 'EAN', 'SELLER_SKU', 'ANATEL_HOMOLOGATION_NUMBER', 'ANVISA_REGISTRATION'])
const limparTitulo = s => String(s ?? '').replace(/\s+/g, ' ').trim()

export function criarDiagnostico({ serie = [], ads = null, item = null, atributosCategoria = [], perguntas = [], avaliacoes = [], cfg = CFG_OFERTAS, agora = () => new Date().toISOString() } = {}) {
  const precoMotor = criarPreco({ cfg, agora })
  const sev = (cond, alta, media) => cond == null ? 'sem_dado' : cond >= alta ? 'alta' : cond >= media ? 'media' : 'baixa'

  // ── linha de base ANTES de alterar (spec §8) — cada métrica declara denominador e disponibilidade ──
  function baseline(anuncio = {}) {
    const s = anuncio.serie ?? serie, a = anuncio.ads ?? ads, it = anuncio.item ?? item ?? {}
    const dias = s.length, visitas = soma(s, 'visitas'), unidades = soma(s, 'unidades'), receita = soma(s, 'receita'), pedidos = soma(s, 'pedidos')
    const cancel = soma(s, 'cancelamentos'), devol = soma(s, 'devolucoes')
    const conv = visitas != null && visitas > 0 && unidades != null ? r2(100 * unidades / visitas) : null
    const adsB = a && (num(a.prints) != null || num(a.custo) != null) ? {
      impressoes: num(a.prints), cliques: num(a.clicks), custo: num(a.custo), receita: num(a.receita), unidades: num(a.unidades),
      ctr_pct: num(a.prints) > 0 && num(a.clicks) != null ? r2(100 * a.clicks / a.prints) : null,
      acos_pct: num(a.receita) > 0 && num(a.custo) != null ? r2(100 * a.custo / a.receita) : null,
      roas: num(a.custo) > 0 && num(a.receita) != null ? r2(a.receita / a.custo) : null, base: 'receita atribuída a Ads (não é a receita total)' } : null
    const criado = it.criado_em ? (Date.parse(agora()) - Date.parse(it.criado_em)) / 86400e3 : null
    const novo = !it.id || (dias === 0 && (criado == null || criado <= L.produto_novo_dias))
    return {
      periodo: dias ? { de: s[0]?.dia ?? null, ate: s[dias - 1]?.dia ?? null, dias } : null, produto_novo: novo,
      visitas, impressoes_ads: adsB?.impressoes ?? null, cliques_ads: adsB?.cliques ?? null, pedidos, unidades, receita: receita == null ? null : r2(receita),
      conversao: conv == null ? { valor: null, numerador: 'unidades', denominador: 'visitas', motivo: visitas == null ? 'visitas não coletadas' : visitas === 0 ? 'sem visitas no período' : 'unidades não coletadas' } : { valor: conv, numerador: 'unidades', denominador: 'visitas', invalida: conv > 100 },
      preco: num(it.preco), estoque: num(it.estoque), cancelamentos: cancel, devolucoes: devol, ads: adsB, fotos: num(it.fotos), titulo: it.titulo ?? null, catalogo: !!it.catalogo, catalogo_origem: origemCatalogo({ catalogo: it.catalogo, catalogo_origem: it.catalogo_origem }), status: it.status ?? null,
      margem_estimada_pct: null,                                  // preenchida em diagnosticar quando há custos+regra
      disponibilidade: Object.fromEntries([['visitas', visitas], ['unidades', unidades], ['receita', receita], ['pedidos', pedidos], ['cancelamentos', cancel], ['devolucoes', devol], ['ads', adsB], ['estoque', num(it.estoque)], ['preco', num(it.preco)]].map(([k, v]) => [k, v == null ? 'ausente' : 'disponivel'])),
      capturado_em: agora(),
    }
  }

  // ── lentes separadas; cada uma { sinal, evidencia, severidade, hipotese } ──
  function diagnosticar(b, contexto = {}) {
    const { custos, regra, ficha, benchmark_conv, ctr_conta, canal = 'mercadolivre' } = contexto
    const semDado = (txt) => ({ sinal: 'sem_dado', evidencia: txt, severidade: 'sem_dado', hipotese: null })
    // catálogo (config/algoritmo.json → catalogo): em catálogo de TERCEIROS título, foto, descrição e ficha não são do vendedor — a hipótese de conteúdo vira o texto do catálogo;
    // em catálogo PRÓPRIO o conteúdo só muda por sugestão de correção, com revisão do ML
    const cat = b.catalogo_origem || 'nao'
    const hipC = (texto, apenasPreco) => cat === 'terceiros' ? (apenasPreco || TEXTO_CATALOGO.terceiros) : cat === 'proprio' ? `${texto} ${TEXTO_CATALOGO.proprio}` : texto
    const lentes = {}
    if (b.produto_novo) {
      const e = 'produto novo: sem histórico — estratégia inicial, nenhuma leitura de desempenho é alegada'
      Object.assign(lentes, { descoberta: semDado(e), clique: semDado(e), conversao: semDado(e) })
    } else {
      // descoberta: visitas/dia (orgânico não tem impressão na API; só Ads)
      const vd = b.visitas != null && b.periodo ? r2(b.visitas / b.periodo.dias) : null
      lentes.descoberta = vd == null ? semDado('visitas não coletadas no período: descoberta não medida')
        : { sinal: vd < L.visitas_dia_baixa ? 'pouca_descoberta' : 'descoberta_ok', evidencia: `${b.visitas} visitas em ${b.periodo.dias} dias (${vd}/dia)${b.impressoes_ads != null ? `; Ads: ${b.impressoes_ads} impressões` : '; impressões orgânicas não disponíveis na API'}`,
          severidade: vd < L.visitas_dia_baixa ? (b.receita > 0 ? 'media' : 'alta') : 'baixa', hipotese: vd < L.visitas_dia_baixa ? hipC('termos de busca/categoria/atributos obrigatórios podem não cobrir como o comprador procura (HIPÓTESE: medir visitas após ficha+título)') : null }
      // clique: só com Ads (CTR orgânico não existe na API); referência = CTR da PRÓPRIA conta × fator do Algoritmo — nenhum número universal
      const a = b.ads, ctrC = num(ctr_conta), limCtr = ctrC != null ? r2(ctrC * FATOR_CTR_BAIXO) : null
      lentes.clique = !a || a.impressoes == null ? semDado('CTR orgânico não disponível e sem Ads: clique não medido')
        : a.impressoes < L.min_impressoes_para_ler_ctr ? semDado(`Ads com ${a.impressoes} impressões (< ${L.min_impressoes_para_ler_ctr}): CTR sem leitura confiável`)
        : limCtr == null ? semDado(`CTR da conta não disponível: CTR Ads ${a.ctr_pct}% fica sem referência da própria conta (nenhum limiar universal é aplicado)`)
        : { sinal: a.ctr_pct < limCtr ? 'muitas_impressoes_poucos_cliques' : 'clique_ok', evidencia: `CTR Ads ${a.ctr_pct}% (${a.cliques} cliques / ${a.impressoes} impressões) vs ${ctrC}% da conta (referência ${FATOR_CTR_BAIXO}× = ${limCtr}%)`,
          severidade: a.ctr_pct < limCtr ? 'alta' : 'baixa', hipotese: a.ctr_pct < limCtr ? hipC('capa e posicionamento (título/preço exibido) não atraem o clique — testar capa e primeira linha do título (HIPÓTESE)') : null }
      // conversão: visitas sem venda → preço/frete/prazo/confiança; abaixo do benchmark DA CONTA
      const c = b.conversao
      lentes.conversao = c.valor == null || b.visitas < L.min_visitas_para_ler_conversao ? semDado(c.valor == null ? c.motivo : `${b.visitas} visitas (< ${L.min_visitas_para_ler_conversao}): conversão sem leitura confiável`)
        : c.invalida ? semDado('conversão > 100%: visitas registradas em outro anúncio do mesmo produto — denominador inválido')
        : b.unidades === 0 ? { sinal: 'visitas_sem_venda', evidencia: `${b.visitas} visitas e 0 unidades`, severidade: 'alta', hipotese: hipC('preço, frete, prazo ou confiança (fotos/avaliações/ficha) — avaliar os quatro antes de mexer em imagem (HIPÓTESE)', 'preço, frete, prazo e caixa de compra (HIPÓTESE). ' + TEXTO_CATALOGO.terceiros) }
        : benchmark_conv != null && c.valor < benchmark_conv ? { sinal: 'conversao_abaixo_da_conta', evidencia: `conversão ${c.valor}% vs ${benchmark_conv}% da conta (unidades/visitas)`, severidade: sev(benchmark_conv / Math.max(c.valor, 0.01), 2, 1.3), hipotese: hipC('oferta perde para os irmãos da conta: preço/frete/ficha/galeria — comparar com o anúncio irmão de melhor conversão (HIPÓTESE)', 'oferta perde para os irmãos da conta: preço, frete e caixa de compra (HIPÓTESE). ' + TEXTO_CATALOGO.terceiros) }
        : { sinal: 'conversao_ok', evidencia: `conversão ${c.valor}% (unidades/visitas)${benchmark_conv != null ? ` vs ${benchmark_conv}% da conta` : ' — sem benchmark da conta'}`, severidade: 'baixa', hipotese: null }
    }
    // viabilidade: estoque e margem (margem só com custos+regra; nunca estimada)
    let calc = null
    if (custos && regra) { calc = precoMotor.calcular({ custos, regra, preco: b.preco, ads_modo: regra.ads_pct != null ? 'pct_receita' : 'nenhum' }); b.margem_estimada_pct = calc.margem_pct }   // mesma base de Ads da proposta: a lente não pode mostrar margem diferente do bloco de preço
    lentes.viabilidade = b.estoque === 0 ? { sinal: 'sem_estoque', evidencia: 'estoque 0 no canal', severidade: 'alta', hipotese: 'falta de estoque não se corrige com imagem/texto: repor antes de qualquer otimização' }
      : !calc ? semDado(`custo${regra ? '' : ' e regra comercial'} não informado${regra ? '' : 's'}: margem não estimada (critério 4: preço automático bloqueado; imagem/ficha seguem)`)
      : calc.bloqueios.length ? semDado(`preço bloqueado: ${calc.bloqueios.join(', ')}`)
      : calc.abaixo_do_piso ? { sinal: 'preco_abaixo_do_piso', evidencia: `preço R$ ${b.preco} < piso R$ ${calc.piso} (margem ${calc.margem_pct}% vs mínima ${calc.piso_margem_pct}%)`, severidade: 'alta', hipotese: 'preservar margem: subir ao piso ou reduzir custo/frete antes de investir em tráfego' }
      : { sinal: 'margem_ok', evidencia: `margem estimada ${calc.margem_pct}%${calc.piso != null ? ` (piso R$ ${calc.piso})` : ''}${calc.simulacao ? ' — SIMULAÇÃO (dado incompleto)' : ''}`, severidade: 'baixa', hipotese: null }
    // qualidade/fidelidade: ficha, galeria, título, termos proibidos em identidade, referência confirmada
    const q = []
    const atrs = ficha?.atributos || []
    const obrigVazios = atrs.filter(x => x.obrigatorio && !x.valor_atual && !x.valor_proposto)
    if (obrigVazios.length) q.push(`${obrigVazios.length} atributo(s) obrigatório(s) vazio(s): ${obrigVazios.slice(0, 5).map(x => x.nome || x.atributo_id).join(', ')}`)
    const vest = { vestuario: ehVestuario(ficha) }               // o mesmo contexto do título: "Conjunto Top Canelado" é peça no título E na identidade
    const promo = atrs.filter(x => ID_SEM_PROMO.has(String(x.atributo_id).toUpperCase()) && ehPromocional(x.valor_atual, null, vest))
    if (promo.length) q.push(`termo promocional em campo de identidade: ${promo.map(x => `${x.atributo_id}="${String(x.valor_atual).slice(0, 40)}"`).join('; ')}`)
    const gal = cfg.galeria_padrao[canal]
    if (b.fotos != null && gal && b.fotos < gal.quantidade) q.push(`${b.fotos} foto(s) vs ${gal.quantidade} do briefing padrão do canal`)
    if (b.titulo && limparTitulo(b.titulo).length > L.titulo_max_chars_padrao) q.push(`título com ${limparTitulo(b.titulo).length} caracteres (observação do canal: ${L.titulo_max_chars_padrao})`)
    const vtf = termosPromocionais(b.titulo, null, vest)
    if (b.titulo && vtf.length) q.push(`título com termo vetado: ${vtf.join(', ')}`)
    if (ficha && ficha.referencia_confirmada === false) q.push('referência visual do produto NÃO confirmada: produção/publicação da variante bloqueadas (critério 5)')
    lentes.qualidade = cat === 'terceiros' ? { sinal: 'conteudo_do_catalogo', evidencia: TEXTO_CATALOGO.terceiros, severidade: 'baixa', hipotese: null }     // ficha, fotos e título não são do vendedor: nada a cobrar
      : !ficha && b.fotos == null && !b.titulo ? semDado('ficha e anúncio não carregados: qualidade não avaliada')
      : q.length ? { sinal: 'qualidade_com_pendencias', evidencia: q.join(' · '), severidade: promo.length || obrigVazios.length || ficha?.referencia_confirmada === false ? 'alta' : 'media', hipotese: 'ficha factual completa e galeria no briefing são pré-requisito; corrigir antes de medir efeito de preço/Ads' }
      : { sinal: 'qualidade_ok', evidencia: 'atributos obrigatórios preenchidos, identidade sem termo promocional, galeria no briefing', severidade: 'baixa', hipotese: null }
    // prioridade por impacto: receita × gap de conversão (até o benchmark da conta); produto novo → sem histórico, prioridade declarada pelo objetivo
    const gap = benchmark_conv != null && b.conversao.valor != null && b.visitas ? Math.max(0, (benchmark_conv - b.conversao.valor) / 100 * b.visitas) * (b.preco || 0) : 0
    const prioridade = b.produto_novo ? { score: 0, motivo: 'produto novo: sem receita/gap medidos — prioridade vem do objetivo (lançar) e do estoque disponível' }
      : { score: r2((b.receita || 0) * (1 + gap / Math.max(b.receita || 0, 1))), receita: b.receita, gap_receita: r2(gap), motivo: `impacto = receita do período (R$ ${r2(b.receita || 0)}) × (1 + gap de conversão até a conta: R$ ${r2(gap)})` }
    return { lentes, prioridade, calculo_preco: calc, gerado_em: agora() }
  }

  // ── textos determinísticos a partir da ficha (só fato com fonte) ──
  // fato = valor com fonte; valor PROPOSTO ainda exige evidência (valor atual já está publicado no canal)
  const fato = x => x && x.fonte && (x.valor_proposto ? !!x.evidencia : !!x.valor_atual)
  const atrPor = (ficha, ...ids) => (ficha?.atributos || []).find(x => ids.includes(String(x.atributo_id).toUpperCase()) && fato(x))
  const valor = x => String(x?.valor_proposto ?? x?.valor_atual ?? '').trim()
  // título ≤ max a partir da ficha; o que NÃO coube (cor/kit/tamanho = identidade da variante) volta em `cortados` — nunca corte silencioso (G4 consome)
  function montarTituloDetalhado(ficha, { max = L.titulo_max_chars_padrao } = {}) {
    const partes = [['nome', ficha?.nome], ['marca', valor(atrPor(ficha, 'BRAND', 'MARCA')) || ficha?.marca], ['modelo', valor(atrPor(ficha, 'MODEL', 'MODELO')) || ficha?.modelo],
      ['cor', valor(atrPor(ficha, 'COLOR', 'COR')) || ficha?.cor], ['quantidade_kit', ficha?.quantidade_kit > 1 ? `Kit ${ficha.quantidade_kit} un` : ''], ['tamanho', valor(atrPor(ficha, 'SIZE', 'TAMANHO')) || ficha?.tamanho]]
      .map(([c, v]) => [c, limparTitulo(v)]).filter(([, v]) => v)
    let t = ''
    const vistos = new Set(), naoCoube = [], ctx = { vestuario: ehVestuario(ficha) }   // "top" peça de roupa pela categoria/atributos da ficha (trechoTop)
    for (const [campo, original] of partes) {
      const variante = CAMPOS_PRESERVAR_TITULO.includes(campo), vetados = termosPromocionais(original, null, ctx)
      // nome/marca/modelo entram inteiros ou não entram ("Papel de Presente" → "Papel de" seria outro produto); a ausência fica registrada
      if (vetados.length && !variante) { naoCoube.push({ campo, valor: original, motivo: `contém termo vetado (${vetados.join(', ')}): fora do título, sem cortar palavra` }); continue }
      const { valor: p, removidos } = retirarTermos(original, ctx)     // variante: termo vetado sai sozinho; o resto do campo fica
      let coube = true, juncao = []
      if (p && !vistos.has(p)) {
        vistos.add(p)
        const cand = t ? `${t} ${p}` : p
        juncao = termosPromocionais(cand, null, ctx)                    // conferência do título INTEIRO a cada campo ("Short e Top" + "10" = "top 10"; "Top" no fim + "Qualidade"): nunca sai com termo vetado
        if (!juncao.length && cand.length <= max) t = cand
        else coube = false
      }
      const retirado = removidos.length ? `termo vetado retirado: ${removidos.join(', ')}` : ''
      if (juncao.length) naoCoube.push({ campo, valor: original, motivo: `${retirado ? `${retirado}; ` : ''}junto do texto anterior formaria termo vetado (${juncao.join(', ')}): fora do título` })
      else if (!variante) continue
      else if (retirado) naoCoube.push({ campo, valor: original, motivo: `${retirado}${coube ? '' : `; o resto não coube em ${max} caracteres`}` })
      else if (!coube) naoCoube.push({ campo, valor: campo === 'quantidade_kit' ? ficha.quantidade_kit : p })
    }
    const falt = new Set(checarPreservacao(ficha, t, { campos: CAMPOS_PRESERVAR_TITULO }).faltantes.map(f => f.campo))   // variante cortada só se o título final realmente não a traz
    return { titulo: t, cortados: naoCoube.filter(c => !CAMPOS_PRESERVAR_TITULO.includes(c.campo) || falt.has(c.campo)) }
  }
  const montarTitulo = (ficha, opts) => montarTituloDetalhado(ficha, opts).titulo
  function montarDescricao(ficha) {
    const ctx = { vestuario: ehVestuario(ficha) }
    const atrs = (ficha?.atributos || []).filter(fato).filter(x => !ehPromocional(valor(x), null, ctx))
    const sec = []
    if (ficha?.nome) sec.push(`${ficha.nome}${ficha.marca ? ` — ${ficha.marca}` : ''}${ficha.modelo ? ` ${ficha.modelo}` : ''}`)
    const variacao = [['Cor', ficha?.cor], ['Tamanho', ficha?.tamanho], ['Material', ficha?.material], ['Kit', ficha?.quantidade_kit > 1 ? `${ficha.quantidade_kit} un` : '']].filter(([, v]) => v && !ehPromocional(String(v), null, ctx))
    if (variacao.length) sec.push('VARIAÇÃO\n' + variacao.map(([k, v]) => `${k}: ${v}`).join(' · '))       // identidade da variante (dado do cliente): a descrição não pode omitir
    if (ficha?.descricao_base && !ehPromocional(ficha.descricao_base, null, ctx)) sec.push(ficha.descricao_base.trim())
    if (atrs.length) sec.push('ESPECIFICAÇÕES\n' + atrs.map(x => `- ${x.nome || x.atributo_id}: ${valor(x)}${x.unidade ? ` ${x.unidade}` : ''}`).join('\n'))
    const emb = atrPor(ficha, 'PACKAGE_CONTENT', 'CONTEUDO_EMBALAGEM', 'ACCESSORIES_INCLUDED')
    if (emb) sec.push(`CONTEÚDO DA EMBALAGEM\n${valor(emb)}`)
    if (ficha?.observacoes) sec.push(`OBSERVAÇÕES\n${String(ficha.observacoes).trim()}`)
    return { texto: sec.join('\n\n'), fontes: atrs.map(x => ({ atributo_id: x.atributo_id, fonte: x.fonte, evidencia: x.evidencia || '' })) }
  }

  // ── proposta no CONTRATO (conteudo_json): só o escopo pedido; cada mudança com problema/evidência/hipótese/ação/métrica/janela/confusores ──
  function proporProposta({ escopo = 'oferta_completa', objetivo = 'melhorar_conversao', baseline: b, diagnostico: d, ficha = null, custos = null, regra = null, canal = 'mercadolivre', margem_alvo_pct } = {}) {
    const lentes = d?.lentes || {}
    const janela = L.janela_padrao_dias
    const confusores = ['estoque', 'preço', 'campanha/Ads', 'sazonalidade', 'alteração externa do canal']
    const incluiBruto = k => escopo === 'oferta_completa' || escopo === k || (k === 'titulo' && escopo === 'titulo_descricao') || (k === 'descricao' && escopo === 'titulo_descricao') || (k === 'galeria' && escopo === 'imagem_avulsa')
    const semConteudo = b?.catalogo_origem === 'terceiros'          // catálogo de TERCEIROS: título, descrição, ficha e galeria não são do vendedor; só o preço é proposto
    const inclui = k => incluiBruto(k) && !(semConteudo && k !== 'preco')
    const out = { mudancas: [], pendencias: [], estrategia: { tipo: b?.produto_novo ? 'inicial' : 'otimizacao', escopo, objetivo, prioridade: d?.prioridade || null, canal } }
    if (semConteudo && ['titulo', 'descricao', 'ficha', 'galeria'].some(incluiBruto)) out.pendencias.push(CATALOGO.mensagem_bloqueio_ofertas)
    const ev = lente => lentes[lente]?.evidencia || 'sem leitura da lente'
    const hip = lente => lentes[lente]?.hipotese || (b?.produto_novo ? 'estratégia inicial: sem histórico, a hipótese é a do objetivo' : 'sem hipótese específica da lente')

    if (inclui('titulo') && ficha) {
      const { titulo: para, cortados } = montarTituloDetalhado(ficha), de = b?.titulo ?? null
      if (para && para !== de) {
        out.titulo = para
        out.mudancas.push({ campo: 'titulo', de, para, problema: lentes.descoberta?.sinal === 'pouca_descoberta' ? 'pouca descoberta' : lentes.qualidade?.sinal === 'qualidade_com_pendencias' ? 'título fora do padrão factual' : 'título a partir da ficha confirmada',
          evidencia: ev('descoberta'), hipotese: hip('descoberta'), acao: 'título factual (marca, modelo, variação) ≤ 60 caracteres, sem promessa', metrica: 'visitas/dia', janela_dias: janela, confusores, cortados })
        // preservação: corte por falta de espaço e qualquer identidade ausente viram pendência da proposta — nunca erro silencioso
        const porTamanho = cortados.filter(c => !c.motivo), vetados = cortados.filter(c => c.motivo)
        if (porTamanho.length) out.pendencias.push(`título não coube em ${L.titulo_max_chars_padrao} caracteres: ${listaCampos(porTamanho)} omitido(s) — revisar antes de publicar`)
        for (const c of vetados) out.pendencias.push(`título: ${listaCampos([c])} — ${c.motivo} — revisar antes de publicar`)
        const outros = checarPreservacao(ficha, para, { campos: CAMPOS_PRESERVAR_TITULO }).faltantes.filter(f => !cortados.some(c => c.campo === f.campo))
        if (outros.length) out.pendencias.push(`título não preserva ${listaCampos(outros)} da ficha — revisar antes de publicar`)
      } else if (!para) out.pendencias.push('título: ficha sem fatos com fonte suficientes')
    }
    if (inclui('descricao') && ficha) {
      const desc = montarDescricao(ficha)
      if (desc.texto) {
        out.descricao = desc.texto
        out.mudancas.push({ campo: 'descricao', de: ficha.descricao_atual ?? null, para: desc.texto, problema: lentes.conversao?.sinal || 'descrição a partir da ficha', evidencia: ev('conversao'), hipotese: hip('conversao'),
          acao: `descrição estruturada só com fatos da ficha (${desc.fontes.length} atributo(s) com fonte)`, metrica: 'conversão (unidades/visitas)', janela_dias: janela, confusores, fontes: desc.fontes })
        const pres = checarPreservacao(ficha, desc.texto)
        if (!pres.ok) out.pendencias.push(`descrição não preserva ${listaCampos(pres.faltantes)} da ficha — revisar antes de publicar`)
      }
    }
    if (inclui('ficha') && ficha) {
      const atributos = []
      for (const x of ficha.atributos || []) {
        const id = String(x.atributo_id).toUpperCase(), prop = x.valor_proposto
        if (prop == null || prop === '' || prop === x.valor_atual) continue
        if (INTOCAVEIS.has(id)) { out.pendencias.push(`${x.atributo_id}: divergência de identificador registrada — exige validação humana, nunca substituído pela proposta`); continue }
        if (!x.evidencia || !x.fonte) { out.pendencias.push(`${x.atributo_id}: valor proposto sem evidência/fonte — não entra`); continue }
        const vetados = ID_SEM_PROMO.has(id) ? termosPromocionais(prop, null, { vestuario: ehVestuario(ficha) }) : []
        if (vetados.length) { out.pendencias.push(`${x.atributo_id}: REPROVADO — termo promocional em campo de identidade (${vetados.join(', ')})`); continue }
        if (x.editavel === 0 || x.editavel === false) { out.pendencias.push(`${x.atributo_id}: não editável no canal — pendência, não alteração`); continue }
        atributos.push({ atributo_id: x.atributo_id, nome: x.nome || x.atributo_id, valor_atual: x.valor_atual ?? null, valor_proposto: prop, fonte: x.fonte, evidencia: x.evidencia })
        out.mudancas.push({ campo: `atributo:${x.atributo_id}`, de: x.valor_atual ?? null, para: prop, problema: x.valor_atual ? 'atributo divergente da ficha confirmada' : 'atributo vazio', evidencia: x.evidencia, hipotese: hip('descoberta'),
          acao: 'preencher com o fato da ficha (fonte declarada)', metrica: 'visitas/dia e cobertura de atributos obrigatórios', janela_dias: janela, confusores })
      }
      out.atributos = atributos
    }
    if (inclui('preco')) {
      if (!custos || !regra) out.pendencias.push(`preço: ${!custos ? 'custo' : 'regra comercial'} ausente — preço automático bloqueado (critério 4)`)
      else {
        const c = precoMotor.calcular({ custos, regra, preco: b?.preco, margem_alvo_pct, ads_modo: regra.ads_pct != null ? 'pct_receita' : 'nenhum' })
        const proposto = c.bloqueios.length ? null : objetivo === 'preservar_margem' && c.abaixo_do_piso ? c.piso : c.preco_alvo?.preco ?? (c.abaixo_do_piso ? c.piso : b?.preco ?? null)
        out.preco = { preco_proposto: proposto, piso: c.piso, margem_prevista_pct: proposto == null ? null : precoMotor.avaliar(proposto, { custos, regra, ads_modo: regra.ads_pct != null ? 'pct_receita' : 'nenhum' }).margem_pct, composicao: c.composicao, simulacao: c.simulacao, bloqueios: c.bloqueios, fontes: c.fontes, pendencias: c.pendencias }
        if (proposto != null && proposto !== b?.preco) out.mudancas.push({ campo: 'preco', de: b?.preco ?? null, para: proposto, problema: lentes.viabilidade?.sinal || 'preço', evidencia: ev('viabilidade'), hipotese: hip('viabilidade'),
          acao: c.abaixo_do_piso ? 'subir ao piso de margem mínima' : 'preço para a margem alvo, arredondado operacionalmente', metrica: 'margem de contribuição estimada e unidades', janela_dias: janela, confusores })
      }
    }
    if (inclui('galeria')) {
      const g = cfg.galeria_padrao[canal]
      if (!g) out.pendencias.push(`galeria: canal ${canal} sem briefing padrão configurado`)
      else {
        out.galeria = []                                                  // imagens reais vêm de ofertas-imagens.js; aqui vai só o briefing por papel
        const papeis = escopo === 'imagem_avulsa' ? g.papeis.slice(0, 1) : g.papeis
        out.mudancas.push({ campo: 'galeria', de: b?.fotos ?? null, para: `${papeis.length} imagem(ns): ${papeis.join(', ')} (${g.formato} ${g.resolucao})`, problema: lentes.clique?.sinal || lentes.qualidade?.sinal || 'galeria',
          evidencia: ev(lentes.clique?.sinal === 'muitas_impressoes_poucos_cliques' ? 'clique' : 'qualidade'), hipotese: hip('clique'), acao: `produzir galeria por papel com referência confirmada; texto na capa: ${g.texto_permitido.capa ? 'permitido' : 'NÃO permitido'}`,
          metrica: b?.ads?.impressoes != null ? 'CTR Ads' : 'visitas/dia e conversão (CTR orgânico indisponível)', janela_dias: janela, confusores, briefing: { papeis, formato: g.formato, resolucao: g.resolucao, texto_permitido: g.texto_permitido, observacao: g.observacao } })
      }
    }
    if (lentes.viabilidade?.sinal === 'sem_estoque') out.pendencias.unshift('estoque 0: nenhuma mudança corrige falta de estoque — repor antes de publicar')
    return out
  }

  // ── IA opcional: explica a proposta / sugere variações de título a partir dos FATOS; sem ia (chave) → template determinístico ──
  async function explicar(proposta, { ia = null, baseline: b = null } = {}) {
    const fatos = { escopo: proposta.estrategia?.escopo, objetivo: proposta.estrategia?.objetivo, prioridade: proposta.estrategia?.prioridade?.motivo, mudancas: proposta.mudancas.map(m => ({ campo: m.campo, problema: m.problema, evidencia: m.evidencia, acao: m.acao, metrica: m.metrica })), pendencias: proposta.pendencias }
    const det = [`Escopo ${fatos.escopo} com objetivo ${fatos.objetivo}.`, fatos.prioridade ? `Priorizado porque ${fatos.prioridade}.` : '',
      ...fatos.mudancas.map(m => `${m.campo}: ${m.problema} (${m.evidencia}) → ${m.acao}; medir ${m.metrica}.`), fatos.pendencias.length ? `Pendências: ${fatos.pendencias.join('; ')}` : ''].filter(Boolean).join(' ')
    if (typeof ia !== 'function') return { texto: det, origem: 'deterministico' }
    try {
      const texto = await ia(`Explique em português, para a operação de um cliente de marketplace, a proposta abaixo. Use SÓ os fatos dados; não invente números, não prometa ranking, indexação ou vendas; não calcule preço. Até 6 frases.\n\nFATOS:\n${JSON.stringify(fatos)}`)
      return typeof texto === 'string' && texto.trim() && !ehPromocional(texto, CFG_OFERTAS.termos_proibidos.promessas) ? { texto: texto.trim(), origem: 'ia' } : { texto: det, origem: 'deterministico', motivo: 'IA devolveu vazio ou promessa vetada' }
    } catch (e) { return { texto: det, origem: 'deterministico', motivo: `IA indisponível: ${String(e?.message || e).slice(0, 120)}` } }
  }

  return { baseline, diagnosticar, proporProposta, explicar, montarTitulo, montarTituloDetalhado, montarDescricao }
}
