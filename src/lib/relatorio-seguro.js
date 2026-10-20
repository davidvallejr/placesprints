// Auditor de conteúdo do Relatório de Sprints Place2u: roda ANTES de qualquer escrita no Notion do cliente e barra o que ele nunca pode ler
// (motivo interno, id, nome de analista, jargão, promessa, causalidade afirmada, valor quebrado, segredo, URL local, bloco de tipo não permitido).
// PURO (sem banco, sem rede, sem Notion). A limpeza na ORIGEM é do brief (limparTitulo); este módulo é a rede de proteção:
// se ele bloqueia com frequência, o brief tem bug. O trecho ofensivo só aparece na prévia interna — nunca no log (o log conta o código).
// O brief usa as MESMAS funções (achaPromessa, achaCausal, achaJargao, ID_INTERNO, criarDetectorNomes, auditarTexto) para que as duas camadas não divirjam:
// o que a camada 2 barraria, a camada 1 já rebaixa para "Ajuste de rotina" em vez de travar o relatório inteiro.
export const CATEGORIA = 'Relatório de Sprints Place2u'   // título/categoria fixos: a única ocorrência aceita da palavra "Sprints"
export const MAX_TOPO = 60                                // design do brief (a API aceita 100); acima disso o brief virou documento
export const MAX_ARRAY = 100, MAX_NIVEIS = 2, MAX_RICH = 1900, MAX_CORPO = 450_000

export const TIPOS_PERMITIDOS = new Set(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'callout', 'bulleted_list_item', 'numbered_list_item',
  'table', 'table_row', 'divider', 'toggle', 'quote'])

// ── normalização ─────────────────────────────────────────────────────────────────────────────────────────────────
// limpaTexto: o que se checa é o texto "como o leitor vê": zero-width e hífen suave somem, NBSP/espaço duplo viram um espaço (a quebra de linha fica: "Bloqueio:" no início da linha),
// letras de largura total (Ｇ) viram ASCII e os travessões/hífens especiais viram "-". norm: o mesmo, sem acento e em minúsculas.
const cc = (...cods) => cods.map(c => String.fromCharCode(c)).join('')      // (sem escapes \u no fonte: ferramentas de edição os convertem em caractere cru)
const ZW = new RegExp(`[${cc(0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF, 0xAD)}]`, 'g')
export const limpaTexto = s => String(s ?? '').replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(ZW, '')
  .replace(new RegExp(`[${cc(0x2010)}-${cc(0x2015, 0x2212)}]`, 'g'), '-').replace(/[^\S\n]+/g, ' ')
const norm = s => limpaTexto(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const normEspaco = s => norm(String(s ?? '').replace(ZW, ' '))   // zero-width como separador: 'Giovanna<ZWSP>Torres' (entre as palavras) ainda é o nome
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// mesmo regex de render-semanal.js:23 (a frente de conteúdo o exporta; teste-relatorio-seguro compara quando a exportação existir)
export const RX_JARGAO = /metricas-semanais|config\/|\.json\b|transcrit|\bAPI\b[^.]*\bretornou\b|\bretornou\s+\d{3}\b|\b(HTTP|status)\s*\d{3}\b/i
// "Sprint(s)": a palavra só é jargão quando é o PRODUTO/serviço Place Sprints ("Place Sprints", "sprints" no plural) ou o jargão de gestão ("sprint de/da/do…", "a sprint", "sprint 3").
// Nome de campanha como "Sprint Black Friday" é título legítimo do dia a dia e passa. O título/categoria fixos (CATEGORIA) são tirados antes de checar.
const RX_JARGAO_EXTRA = /\b(notion|backlog|payload|webhook|endpoint|dry-?run|merov[ií]ngio|algoritmo|sync|p_sucesso|score|sprints)\b|\b(?:planilha|painel|sistema|ferramenta|relat[óo]rio|documento|dashboard)s?\s+intern[oa]s?\b|\buso interno\b|\bsprint\s+(?:de|da|do|das|dos|planning|review|backlog|semanal|quinzenal|atual|anterior|n[º°o]?\s*\d|\d)|\b(?:o|a|na|no|da|do|nesta|neste|esta|este|cada|nossa|nosso|minha|meu|essa|esse)\s+sprint\b/i
export const achaJargao = texto => { const s = limpaTexto(texto).split(CATEGORIA).join(''); return s.match(RX_JARGAO)?.[0] || s.match(RX_JARGAO_EXTRA)?.[0] || null }

// ── IDs ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// tarefa PS-…, anúncio ML (MLB/MLBU/MLA/MLM/MLC… com espaço, hífen ou dois-pontos entre a sigla e os dígitos; a sequência de 6+ dígitos pode ter espaço/ponto), "ID do Produto",
// sequências de 10+ dígitos (CPF/CNPJ/telefone/pedido), CPF e CNPJ formatados, hash de 32 hex e UUID; job de Ofertas ("job 3e0c980e"), fragmento de variante sem anúncio
// ("variante 7c1e9a42", título de oferta_cadastro) e ids do contrato do diagnóstico (ev-/dp- + 10 hex).
export const ID_INTERNO = /PS-[0-9a-f]{6,}|\b(?:job|variante) [0-9a-f]{8}\b|\b(?:ev|dp)-[0-9a-f]{10}\b|\bML[ABCMUV]U?[\s:_-]*\d(?:[\s.]?\d){5,}|\b(?:MCO|MEC|MPE)[\s:_-]*\d{6,}|ID do Produto|\d{10,}|\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b[0-9a-f]{32}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

// ── promessa e causalidade ───────────────────────────────────────────────────────────────────────────────────────
// "não é garantia", "sem comprovação" são ressalvas honestas — só vale como promessa se NÃO houver negação na mesma frase, logo antes
const comNegacao = (texto, i) => /\b(n[ãa]o|nem|sem|nunca|jamais|nada|nenhum[a]?)\b[^.!?;]{0,30}$/i.test(texto.slice(Math.max(0, i - 40), i))
// regexes sobre texto SEM acento e em minúsculas (norm). "garantia/garantias" (substantivo: atributo do anúncio) NÃO é promessa; garantido/garantimos/garante/garantir é.
// "comprovante"/"comprovação" (documento, tarefa de conferência) também não: só a afirmação (comprova, comprovou, comprovado…).
const PROMESSA_COM_RESSALVA = [/\bgarant(?!ias?\b)\w*/g, /\bgarantias? d[eao]s? (?:resultados?|vendas?|lucros?|ranking|aumentos?|faturamento)\b/g, /\bcomprov(?:ad\w*|a|am|ou|aram|ara|amos|aremos)\b/g, /\bcertez[ao]\b/g, /\bcertamente\b/g, /\bassegur\w*/g, /\bsem duvida\b/g, /\b100 ?% ?(?:certo|garantid\w*|seguro|eficaz)\b/g,
  /\bsucesso (?:total|absoluto|garantido)\b/g]
const PROMESSA_DURA = /\bvai (?:vender|aumentar|subir|dobrar|crescer|bombar|explodir|decolar)\b|\b(?:dobrara|aumentara|crescera|subira|vendera|multiplicara)\b|\branking\b|\brankear\b|\bprimeira posicao\b|\bprimeiro lugar\b|\b1[º°o]? ?lugar\b|\btop ?1\b|\bnumero (?:um|1)\b|\blider (?:da|de|do) (?:categoria|mercado|nicho|segmento|vendas)\b|\b(?:chegar|subir|ficar|alcancar|manter)\s+(?:ao|no|na)\s+(?:topo|primeira pagina)\b/
export function achaPromessa(texto) {
  const n = norm(texto), bruto = limpaTexto(texto)
  for (const rx of PROMESSA_COM_RESSALVA) for (const m of n.matchAll(rx)) if (!comNegacao(n, m.index)) return m[0]
  return n.match(PROMESSA_DURA)?.[0] || bruto.match(/\bn[º°]\s*1\b/i)?.[0] || null
}
const CAUSAL_DURO = /\bcausou\b|\bprovocou\b|\bresultado direto\b|\bfoi causad[oa]\b/
const CAUSAL_COM_RESSALVA = [/\bgracas a\w*/g, /\bpor causa (?:de|da|do|das|dos|desta|deste|dessa|desse|disso)\b/g, /\bdevido a\w*/g, /\bgerou\b/g, /\btrouxe\b/g, /\bocasionou\b/g, /\bimpactou\b/g,
  /\bresultou (?:em|no|na)\b/g, /\b(?:provocad|causad)[oa]s?\b/g, /\befeito direto\b/g, /\bconsequencia\b/g, /\bem decorrencia\b/g, /\bdecorrente d[aeo]s?\b/g,
  /\bresultados? d[aeo]s? (?:nossa |nosso )?(?:otimizacao|acao|acoes|trabalho|mudanca|ajuste|tarefa|estrategia|campanha|promocao|alteracao|atualizacao)\b/g]
// "Quanto cada R$ 1 investido em anúncios trouxe de vendas" (definição do ROAS, texto fixo do motor) é pergunta/definição, não afirmação de causa: "quanto … trouxe/gerou" na mesma frase é aceito
const comoDefinicao = (n, i) => /\bquanto\b[^.!?;]{0,70}$/.test(n.slice(Math.max(0, i - 80), i))
export function achaCausal(texto) {
  const n = norm(texto)
  const duro = n.match(CAUSAL_DURO)?.[0]; if (duro) return duro
  for (const rx of CAUSAL_COM_RESSALVA) for (const m of n.matchAll(rx)) if (!comNegacao(n, m.index) && !(/^(?:trouxe|gerou)$/.test(m[0]) && comoDefinicao(n, m.index))) return m[0]
  return null
}
export const achaEfeitoObservado = texto => norm(texto).match(/efeito ?observad\w*/)?.[0] || null   // espaço duplo/NBSP/zero-width já normalizados
const primeiro = (rx, texto) => texto.match(rx)?.[0] || null

// ── nomes internos ───────────────────────────────────────────────────────────────────────────────────────────────
// Cada nome vira (a) o nome COMPLETO (palavras separadas por qualquer não-alfanumérico: "Giovanna_Torres", "GIOVANNA-TORRES", "Torres, Giovanna" não — a ordem é a do nome — e também colado) e
// (b) cada TOKEN de 3+ letras ("feito pela Giovanna", "G. Torres", "Gio Torres" → Torres). Decisões, para não degradar título à toa nem vazar analista:
//  • string com "@" é e-mail, não pessoa: ignorada (os tokens "com/gmail/br/comercial" derrubavam títulos "com …");
//  • `permitidos` (o nome do cliente) tira o token que existe dentro dele, token a token ("DG da Silva" não bloqueia "Silva");
//  • token que é palavra comum (cor, verbo, cidade, sobrenome-palavra: Rosa, Lava, Silva, Lima, Dias…) só vale junto com o nome completo — se o nome interno tem só essa palavra, vale sozinha;
//  • primeiro nome ("Sara", "Giovanna") NUNCA entra na lista de comuns: é como a equipe se refere a um colega e vazaria o analista.
export const PALAVRAS_COMUNS = new Set(['rosa', 'lava', 'silva', 'lima', 'flor', 'pedra', 'campos', 'costa', 'rocha', 'dias', 'santos', 'cruz', 'leite', 'branco'])
const PARTICULAS = new Set(['del', 'van', 'von', 'der', 'den', 'das', 'dos', 'filho', 'neto'])
const palavrasDe = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean)
const MEMO_DETECTOR = new Map()
export function criarDetectorNomes(nomesInternos, permitidos = []) {
  const chave = JSON.stringify([nomesInternos, permitidos])
  const feito = MEMO_DETECTOR.get(chave); if (feito) return feito
  const perm = (Array.isArray(permitidos) ? permitidos : [permitidos]).map(palavrasDe).filter(p => p.length)
  const permTokens = new Set(perm.flat()), permFrases = perm.map(p => ` ${p.join(' ')} `)
  const completos = new Set(), tokens = new Set()
  for (const bruto of Array.isArray(nomesInternos) ? nomesInternos : []) {
    if (typeof bruto !== 'string' || bruto.includes('@')) continue
    const ws = palavrasDe(bruto)
    if (ws.join('').length < 3) continue
    if (!permFrases.some(f => f.includes(` ${ws.join(' ')} `))) {                        // o nome inteiro só existe dentro do nome do cliente: não é vazamento
      completos.add(ws.map(esc).join('[^a-z0-9]+'))
      if (ws.length > 1) completos.add(ws.map(esc).join(''))                           // "GiovannaTorres"
    }
    for (const w of ws) if (w.length >= 3 && !PARTICULAS.has(w) && !/^\d+$/.test(w) && !permTokens.has(w) && !(PALAVRAS_COMUNS.has(w) && ws.length > 1)) tokens.add(esc(w))
  }
  const rx = alts => alts.size ? new RegExp(`(^|[^a-z0-9])(${[...alts].join('|')})(?=$|[^a-z0-9])`) : null
  const rxs = [rx(completos), rx(tokens)].filter(Boolean)
  // achar(texto) → trecho normalizado ou null. As duas leituras do texto: zero-width removido ('Not<ZWSP>ion') e zero-width como espaço ('Giovanna<ZWSP>Torres').
  const d = { vazio: !rxs.length, achar(texto) {
    if (!rxs.length) return null
    for (const t of [norm(texto), normEspaco(texto)]) for (const r of rxs) { const m = r.exec(t); if (m) return m[2] }
    return null
  }, test(texto) { return d.achar(texto) !== null },
  exec(texto) { const a = d.achar(texto); return a === null ? null : [a, '', a] } }          // compatível com o RegExp que regexNomes devolvia (m[2] = o nome achado)
  if (MEMO_DETECTOR.size >= 64) MEMO_DETECTOR.delete(MEMO_DETECTOR.keys().next().value)
  MEMO_DETECTOR.set(chave, d)
  return d
}

// cada regra: acha(texto, ctx) → trecho ofensivo (string) ou null. `texto` já passou por limpaTexto; ctx = { nomes: detector de nomes internos, bruto: texto como veio }
export const PROIBICOES = [
  { codigo: 'sem_motivo', descricao: 'dependência sem motivo registrado (texto interno do painel)', acha: t => primeiro(/sem motivo registrado|registre pela tela|painel executivo/i, t) },
  { codigo: 'id_interno', descricao: 'ID interno (tarefa PS-…, anúncio MLB…, produto, 10+ dígitos, CPF/CNPJ, hash, página do Notion)', acha: t => primeiro(ID_INTERNO, t) },
  { codigo: 'analista', descricao: 'nome de analista, consultor, líder ou responsável da equipe (nome completo ou qualquer nome/sobrenome)', acha: (t, ctx) => ctx.nomes.achar(ctx.bruto) },
  { codigo: 'bloqueio_cru', descricao: 'cabeçalho cru "Bloqueio:" do painel', acha: t => primeiro(/(^|\n)\s*bloqueio\b|\bbloqueio\s*:/i, t) },
  { codigo: 'jargao', descricao: 'jargão técnico (arquivo, API, HTTP, Notion, sync…) — "Sprints" só no título/categoria fixos', acha: achaJargao },
  { codigo: 'promessa', descricao: 'promessa de resultado (garantido, assegura, certeza, sem dúvida, comprova, ranking, top 1, vai vender, dobrará…)', acha: achaPromessa },
  { codigo: 'causalidade', descricao: 'causalidade afirmada (causou, graças a, por causa de, devido a, gerou, trouxe, efeito direto, consequência…)', acha: achaCausal },
  { codigo: 'efeito_observado', descricao: '"efeito observado" (resultado informado nunca vira observado)', acha: achaEfeitoObservado },
  { codigo: 'valor_invalido', descricao: 'valor quebrado (undefined, NaN, null, Infinity, [object …])', acha: t => primeiro(/\bundefined\b|\bnull\b|\binfinity\b|\[object/i, t) || primeiro(/\bNaN\b/, t) },
  { codigo: 'segredo', descricao: 'segredo (token do Notion, Bearer, access_token, credencial do ML)', acha: t => primeiro(/\bsecret_|\bntn_|\bBearer\s|access_token|APP_USR|\bsk-[A-Za-z0-9]{10,}|\bxox[bp]-/i, t) },
  { codigo: 'url_interna', descricao: 'URL local ou de rede interna', acha: t => primeiro(/localhost|127\.0\.0\.1|\[::1\]|:3012|\b192\.168\.|\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\.local\b/i, t) },
  { codigo: 'tipo_bloco', descricao: 'tipo de bloco fora da lista (arquivo, embed, bookmark, link_preview, child_page…)', acha: () => null },   // checado pela estrutura
  { codigo: 'limite', descricao: 'limite do Notion/do desenho (100 por lista, 2 níveis, 1900 por trecho, 60 blocos de topo, corpo 450 KB)', acha: () => null },   // idem
]

// ── estrutura dos blocos ─────────────────────────────────────────────────────────────────────────────
const filhosDe = b => { const c = b?.[b?.type]; return Array.isArray(c?.children) ? c.children : Array.isArray(b?.children) ? b.children : [] }
const richDe = b => { const c = b?.[b?.type]; return Array.isArray(c?.rich_text) ? c.rich_text : [] }
export const textoDeRich = rich => (Array.isArray(rich) ? rich : []).map(t => t?.text?.content ?? t?.plain_text ?? '').join('')
// texto "plano" de um bloco (tabela: células separadas por " | ") — o que a prévia mostra ao líder
export function textoDoBloco(b) {
  if (!b || typeof b !== 'object') return ''
  if (b.type === 'table_row') return (b.table_row?.cells || []).map(textoDeRich).join(' | ')
  return textoDeRich(richDe(b))
}
function linksDe(b) {
  const rich = b?.type === 'table_row' ? (b.table_row?.cells || []).flat() : richDe(b)
  return rich.map(t => t?.text?.link?.url).filter(Boolean)
}
// percorre em profundidade; caminho "3" (topo) ou "3.1" (filho). fn(bloco, caminho, nivel)
function andar(blocos, fn, caminho = '', nivel = 1) {
  (Array.isArray(blocos) ? blocos : []).forEach((b, i) => {
    const c = caminho ? `${caminho}.${i}` : String(i)
    fn(b, c, nivel)
    andar(filhosDe(b), fn, c, nivel + 1)
  })
}
// linhas de texto de toda a página (para a prévia): tabela vira uma linha por table_row
export function linhasDeTexto(blocos) {
  const out = []
  andar(blocos, b => { if (b?.type !== 'table' && b?.type !== 'divider') { const t = textoDoBloco(b); if (t) out.push(t) } })
  return out
}

export function limitesNotion(blocos, { maxTopo = MAX_TOPO } = {}) {
  const v = []
  const arr = Array.isArray(blocos) ? blocos : []
  if (arr.length > maxTopo) v.push({ codigo: 'limite', bloco: '', motivo: `mais de ${maxTopo} blocos de topo` })
  let corpo = 0
  try { corpo = JSON.stringify(arr).length } catch { v.push({ codigo: 'limite', bloco: '', motivo: 'corpo não serializável' }) }
  if (corpo > MAX_CORPO) v.push({ codigo: 'limite', bloco: '', motivo: 'corpo acima de 450 KB' })
  const checaLista = (lista, caminho) => { if (lista.length > MAX_ARRAY) v.push({ codigo: 'limite', bloco: caminho, motivo: 'mais de 100 blocos numa lista' }) }
  checaLista(arr, '')
  andar(arr, (b, c, nivel) => {
    if (nivel > MAX_NIVEIS) v.push({ codigo: 'limite', bloco: c, motivo: 'mais de 2 níveis de aninhamento' })
    const f = filhosDe(b); if (f.length) checaLista(f, c)
    const rich = b?.type === 'table_row' ? (b.table_row?.cells || []).flat() : richDe(b)
    if (rich.some(t => String(t?.text?.content ?? '').length > MAX_RICH)) v.push({ codigo: 'limite', bloco: c, motivo: 'trecho de texto acima de 1900 caracteres' })
  })
  return v
}

const trecho = (texto, achado) => {
  const i = norm(texto).indexOf(norm(achado)); const base = i >= 0 ? i : 0
  const t = texto.slice(Math.max(0, base - 20), base + String(achado).length + 20).replace(/\s+/g, ' ').trim()
  return t.length > 80 ? t.slice(0, 80) + '…' : t
}

// auditarBlocos(blocos, { nomesInternos:[string], permitidos:[string]|string, maxTopo }) → [{ codigo, bloco, trecho }] (vazio = pode escrever)
// `bloco` é o caminho ("3" ou "3.1"); no máximo uma ocorrência por (código, bloco). `permitidos` = nome do cliente (palavras que só existem dentro dele não são vazamento).
export function auditarBlocos(blocos, { nomesInternos = [], permitidos = [], maxTopo = MAX_TOPO } = {}) {
  const nomes = criarDetectorNomes(nomesInternos, permitidos)
  const out = [], visto = new Set()
  const add = (codigo, bloco, texto = '', achado = '') => {
    const k = `${codigo}|${bloco}`; if (visto.has(k)) return; visto.add(k)
    out.push({ codigo, bloco, trecho: achado ? trecho(texto, achado) : '' })
  }
  andar(blocos, (b, c) => {
    if (!b || typeof b !== 'object' || !TIPOS_PERMITIDOS.has(b.type)) { add('tipo_bloco', c); return }
    const bruto = [textoDoBloco(b), ...linksDe(b)].join('\n')
    if (!bruto.trim()) return
    const texto = limpaTexto(bruto)
    for (const r of PROIBICOES) {
      if (r.codigo === 'tipo_bloco' || r.codigo === 'limite') continue
      const achado = r.acha(texto, { nomes, bruto })
      if (achado) add(r.codigo, c, bruto, achado)
    }
  })
  for (const l of limitesNotion(blocos, { maxTopo })) add(l.codigo, l.bloco)
  return out
}

// o mesmo crivo para uma linha avulsa (o título da página também é lido pelo cliente)
export const auditarTexto = (texto, opts = {}) =>
  auditarBlocos([{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: String(texto ?? '') } }] } }], opts)

// resumo para o log: só os códigos (nunca o trecho)
export const codigosDe = violacoes => [...new Set(violacoes.map(v => v.codigo))]
