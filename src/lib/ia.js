// Camada inteligente: a IA SÓ REDIGE. Nunca calcula, nunca decide prioridade, nunca recebe custos brutos.
// Regras de economia e honestidade:
//   1. recebe apenas payload compacto (fatos já decididos pelas regras), nunca a base inteira;
//   2. cache por escopo+hash (fatos + instrução + versão e conteúdo do prompt): só texto da IA aprovado é gravado; template (sem chave, falha, reprovação) nunca;
//   3. sem ANTHROPIC_API_KEY (ou com falha/timeout), devolve o template determinístico com o motivo — nunca sucesso simulado;
//   4. todo número do texto da IA precisa existir em `evidence` (numerosFora); senão volta ao template;
//   5. o texto passa pelo auditor (relatorio-seguro): subconjunto interno (promessa, causalidade, efeito observado, valor quebrado,
//      segredo, URL interna) ou o crivo completo quando o destino é o cliente.
// Prompt base versionado em config/prompt-diagnostico.md (único lido em execução; config/prompt-estrategista.md continua como spec).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, agora } from './db.js'
import { env, ROOT } from './env.js'
import { auditarTexto, codigosDe } from './relatorio-seguro.js'

export const PROMPT_VERSAO = 'v2'           // v1 = prompt embutido no código (resumo do sprint); v2 = config/prompt-diagnostico.md
const TIMEOUT_MS = 20000
let promptBaseCache = null
const promptBase = () => (promptBaseCache ??= readFileSync(join(ROOT, 'config', 'prompt-diagnostico.md'), 'utf-8'))

// subconjunto do auditor para texto INTERNO: ids (PS-/MLB) e nomes da equipe são permitidos; promessa, causalidade, "efeito observado", valor quebrado, segredo e URL interna não
export const CRIVO_INTERNO = new Set(['promessa', 'causalidade', 'efeito_observado', 'valor_invalido', 'segredo', 'url_interna'])
export const auditarInterno = (texto, opts = {}) => auditarTexto(texto, opts).filter(v => CRIVO_INTERNO.has(v.codigo))

// ── números rastreáveis: todo número do texto precisa existir em evidence[].valor / texto / periodo / unidade, com o mesmo sinal ──
// Texto e evidência passam por NFKC ("１５" → 15). pt-BR: "1.234,56" → 1234.56, "9,99" → 9.99. Escala: "48 mil"/"48k" → 48000 (aceita o arredondamento
// de 0/1/2 casas na escala: 96.283 → "96 mil"). Datas/horas só saem quando válidas (dia 1-31, mês 1-12; hh ≤ 23, mm ≤ 59) E em forma de data: com ano,
// intervalo ("7/9 a 4/10", "entre 07/09 e 04/10"), depois de "dia/desde/a partir de/data/prazo", ou depois de "em/de/até" fechando a oração ("em 05/10.").
// Fora disso "d/m" é fração e os dois números são conferidos ("em 3/4 anúncios", "1/4 nas vendas", "10/12 anúncios").
// Sinal (falha segura): sinal explícito (- − – ‑ — +) ou direção por palavra; número SEM sinal reconhecido vale como positivo — então só confere com
// evidência negativa quem a marca (menos explícito, ou palavra de queda na oração). Direção = última palavra de alta/queda entre a vírgula/número
// anterior e o número; "caíram 15% e a conversão, 12%" (elipse: só conectores antes de um %) herda a direção da frase; verbo de direção seguido de
// "está/ficou/foi…" é nível ("caiu e está em 1,2%"), substantivo não ("a queda foi de 15%"); "para 10" e "de 20 para 10" são nível; "12% abaixo" é queda.
// "alta/baixa" só são direção como substantivo ("uma alta de", "Conversão: alta de"), não como adjetivo ("margem baixa de 8%").
// Reprovados sempre: dobr*/duplic*/tripl*/quadrupl*/quintupl*, metade, terço, "um quarto", zero, "por cento", números por extenso, dezenas/centenas/
// milhares, dígito não ASCII — conferidos SEM acento ("quádruplo", "três", "milhão" caem igual). Escala com zero ("R$ 0 mil", "0 k") nunca rastreia: arredondar
// uma evidência à escala não produz 0. ponytail: heurística de palavras com teto conhecido — direção fora da lista sobre evidência POSITIVA passa ("A conversão
// minguou 12%"); sobre evidência negativa reprova (template). O saco é global por chamada; quem chama manda só as evidências citadas. "um/uma" ficam fora (artigo).
const RX_PTBR_MILHAR = /\b\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/g
const dataValida = (d, m) => d >= 1 && d <= 31 && m >= 1 && m <= 12
const ehData = (antes, depois) => /^\s*(?:a|até|ate|[-–—])\s*\d{1,2}\/\d{1,2}(?![\d/])/iu.test(depois)        // 1ª ponta de "7/9 a 4/10"
  || /(?<![\d/])\d{1,2}\/\d{1,2}\s*(?:a|até|ate|[-–—])\s*$/iu.test(antes)                                       // 2ª ponta
  || (/(?<!\p{L})entre\s+$/iu.test(antes) && /^\s+e\s+\d{1,2}\/\d{1,2}(?![\d/])/u.test(depois)) || /(?<!\p{L})entre\s+\d{1,2}\/\d{1,2}\s+e\s+$/iu.test(antes)
  || /(?<!\p{L})(?:dias?|desde|partir\s+de|data|prazo|vencimento)\s+$/iu.test(antes)
  || (/(?<!\p{L})(?:em|de|até|ate)\s+$/iu.test(antes) && /^\s*(?:[.;:!?),]|$|(?:às|as)\s+\d)/u.test(depois))
const semDatas = s => s
  .replace(/(?<!\d)\d{4}-(\d{2})-(\d{2})(?!\d)/g, (x, m, d) => (dataValida(+d, +m) ? ' ' : x))
  .replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g, (x, d, m, a, i, s) =>
    (dataValida(+d, +m) && (a || ehData(s.slice(Math.max(0, i - 24), i), s.slice(i + x.length))) ? ' ' : x))
  .replace(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, (x, h, m) => (+h <= 23 && +m <= 59 ? ' ' : x))
const canonico = s => semDatas(String(s ?? '').normalize('NFKC')).replace(RX_PTBR_MILHAR, m => m.replace(/\./g, '').replace(',', '.')).replace(/(\d),(\d)/g, '$1.$2')
const SINAL = '+\\-−‐‑‒–—'                                                 // ASCII, U+2212, U+2010..U+2014 (o NFKC não converte os traços)
const RX_NUM = new RegExp(`(?:(?<![\\p{L}\\p{N}])([${SINAL}]))?(\\d+(?:\\.\\d+)?)(?:\\s*(mil|milh(?:ão|ao|ões|oes)|bilh(?:ão|ao|ões|oes)|bi|mi|k)(?![\\p{L}\\p{N}]))?`, 'giu')
const ESCALA = { mil: 1e3, k: 1e3, mi: 1e6, milhao: 1e6, milhoes: 1e6, bi: 1e9, bilhao: 1e9, bilhoes: 1e9 }
const SUBST = String.raw`(?<=(?:^|[:(,]|(?<!\p{L})(?:uma|a|na|da|de|em|com|houve|teve|tiveram|registr\p{L}*|apresent\p{L}*|sofr\p{L}*))\s*)`   // "alta/baixa" substantivo
const QUEDA = String.raw`ca[ií](?:u|ram|ndo|a|am|em|da|das|do|dos|r|ria)?|quedas?|recu(?:o|os|ou|aram|ando|ar|a|am)|diminu\p{L}*|redu[zçc]\p{L}*|baix(?:ou|aram|ando|ar)|retra(?:iu|[ií]ram|indo|ir|[cç](?:ão|ao|ões|oes))|perd(?:eu|eram|endo|er|a|as|ido)|despenc\p{L}*|desab(?:ou|aram|ando|ar)|tomb(?:ou|aram|ando|o)|afund\p{L}*|encolh\p{L}*|pior(?:ou|aram|a|as|ando|ar)|decl[ií]n\p{L}*|negativ\p{L}*|derrub\p{L}*|${SUBST}baixas?`
const ALTA = String.raw`cresc\p{L}*|sub(?:iu|iram|ida|idas|indo|ir|ia|ido)|aument\p{L}*|avan[cç]\p{L}*|elev(?:ou|aram|ando|ar|a[cç](?:ão|ao|ões|oes))|melhor(?:ou|aram|a|as|ando|ar)|salt(?:ou|aram|ando|o|os)|dispar(?:ou|aram|ando|ada|adas)|ganh\p{L}*|positiv\p{L}*|expan\p{L}*|recuper\p{L}*|${SUBST}altas?`
const RX_DIR = new RegExp(String.raw`(?<!\p{L})(?:(${QUEDA})|(${ALTA}))(?!\p{L})`, 'giu')
const RX_ESTADO = /(?<!\p{L})(?:é|foi|foram|era|eram|est(?:á|ão|ao|ava|avam)|fic(?:ou|aram|a|am)|fech(?:ou|aram|a)|seg(?:ue|uem)|permanec\p{L}*|mant(?:eve|iveram|ém)|ating(?:iu|iram|e)|cheg(?:ou|aram|a))(?!\p{L})/iu
const RX_VERBO = /(?:ou|aram|eram|iram|eu|iu|ndo|ar|er|ir|am|em)$/iu
const RX_FIM = /[.;!?](?=\s|$)|[\n"“”{}[\]()]/gu                           // fim de frase, de string JSON ou parêntese: direção não atravessa
const RX_NIVEL = new RegExp(`^\\s*%?\\s*(?:para|até|ate|a)\\s+(?:r\\$\\s*)?[${SINAL}]?\\d`, 'iu')   // "caiu de 20 para 10": 20 é o nível de partida
const RX_ELIPSE = /^[\s%]*(?:(?:e|r\$|de|em|cerca|quase|apenas|só|aproximadamente)[\s%]*)*$/iu
function ultimaDirecao(s) {
  let d = 0, fim = 0, verbo = false
  for (const m of s.matchAll(RX_DIR)) { d = m[1] ? -1 : 1; fim = m.index + m[0].length; verbo = RX_VERBO.test(m[0]) }
  return d && verbo && RX_ESTADO.test(s.slice(fim)) ? 0 : d
}
function direcao(c, ini, fim) {
  const depois = c.slice(fim)
  if (RX_NIVEL.test(depois)) return 0
  if (/^\s*(?:%|p\.?\s?p\.?)\s*(?:abaixo|a\s+menos|menor|inferior)(?!\p{L})/iu.test(depois)) return -1
  let corte = 0, frase = c.slice(0, ini)
  for (const m of frase.matchAll(RX_FIM)) corte = m.index + m[0].length
  frase = frase.slice(corte)
  if (/(?:(?<!\p{L})para|\d\s*%?\s*(?:a|até|ate))\s+(?:r\$\s*)?$/iu.test(frase)) return 0     // "para 10", "de 20 a 10": nível de chegada
  corte = 0
  for (const m of frase.matchAll(/,|\d+(?:\.\d+)?/g)) corte = m.index + m[0].length
  const trecho = frase.slice(corte)
  return ultimaDirecao(trecho) || (/^\s*%/.test(depois) && RX_ELIPSE.test(trecho) ? ultimaDirecao(frase) : 0)
}
const RX_REPROVADO = /(?<![\p{L}\p{N}])(?:(?:dobr|duplic|tripl|quadrupl|quintupl)\p{L}*|metade|ter[cç]os?|um\s+(?:quarto|quinto|d[eé]cimo)|zeros?|dezenas?|centenas?|milhar(?:es)?|por\s*cento|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dez[ea]sseis|dez[ea]ssete|dezoito|dez[ea]nove|vinte|trinta|quarenta|cinq[uü]enta|sessenta|setenta|oitenta|noventa|cem|cento|(?:duz|trez|quatroc|quinh|seisc|setec|oitoc|novec)ent[oa]s|d[uú]zias?)(?![\p{L}\p{N}])|(?<!\p{N}\s*)(?<![\p{L}\p{N}])(?:mil|milh(?:ao|oes)|bilh(?:ao|oes))(?![\p{L}\p{N}])|(?![0-9])\p{Nd}/giu
const semAcento = s => s.normalize('NFD').replace(/\p{M}/gu, '')
function tokensDe(s) {
  const c = canonico(s), out = []
  for (const m of c.matchAll(RX_NUM)) {
    const n = Number(m[2]); if (!Number.isFinite(n)) continue
    const fim = m.index + m[0].length, sinal = m[1] ? (m[1] === '+' ? 1 : -1) : direcao(c, m.index, fim)
    const esc = m[3] ? ESCALA[m[3].toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')] : 1
    out.push({ n, esc, sinal, porPalavra: !m[1] && !!sinal, pct: /^\s*(?:%|p\.?\s?p)/iu.test(c.slice(fim)), valor: esc === 1 ? n : Math.round(n * esc * 100) / 100, rot: (sinal > 0 ? '+' : sinal < 0 ? '-' : '') + m[2] + (m[3] ? ' ' + m[3].toLowerCase() : '') })
  }
  return out
}
const arred = (x, c) => Math.round(x * 10 ** c) / 10 ** c
export function numerosFora(texto, evidence) {
  if (evidence == null) return []                                   // sem base de conferência declarada: nada a conferir (quem chama decide)
  const ok = new Set(), brutos = []
  const addNum = v => { if (!Number.isFinite(v)) return; brutos.push(v); const s = v < 0 ? -1 : 1; for (const c of [2, 1, 0]) ok.add(s * arred(Math.abs(v), c)); ok.add(v) }   // só arredondamentos de apresentação (0/1/2 casas): piso/teto aceitariam 4,27 → 5
  // evidência em texto livre (títulos do payload do resumo): direção por palavra só vale para %; "queda de conversão do kit 3 peças" não torna o 3 negativo
  const addTxt = s => tokensDe(s).forEach(t => { addNum((t.sinal || 1) * t.valor); if (t.porPalavra && !t.pct) addNum(t.valor) })
  for (const e of Array.isArray(evidence) ? evidence : []) {
    if (typeof e === 'number') { addNum(e); continue }
    if (typeof e === 'string') { addTxt(e); continue }
    if (!e || typeof e !== 'object') continue
    if (typeof e.valor === 'number') addNum(e.valor); else if (typeof e.valor === 'string') addTxt(e.valor)
    for (const k of ['texto', 'periodo', 'unidade']) if (typeof e[k] === 'string') addTxt(e[k])
  }
  const confere = t => { const s = t.sinal || 1                      // sem sinal reconhecido = positivo: evidência negativa só confere com a queda marcada
    if (t.esc > 1 && t.n === 0) return false                           // "R$ 0 mil": zero com escala nunca é rastreável
    return ok.has(s * t.valor) || (t.esc > 1 && brutos.some(v => (v < 0 ? -1 : 1) === s && [0, 1, 2].some(c => arred(Math.abs(v) / t.esc, c) === t.n))) }
  const fora = tokensDe(texto).filter(t => !confere(t)).map(t => t.rot)
  for (const m of semAcento(String(texto ?? '').normalize('NFKC')).matchAll(RX_REPROVADO)) fora.push(m[0].toLowerCase().replace(/\s+/g, ' '))
  return [...new Set(fora)]
}

const custoEstimado = tokens => {
  const pIn = Number(env.AI_PRECO_ENTRADA), pOut = Number(env.AI_PRECO_SAIDA)      // preço por 1 milhão de tokens; sem os dois, null (nunca inventa custo)
  if (!tokens || !(pIn > 0) || !(pOut > 0)) return null
  return Math.round(((tokens.entrada || 0) * pIn + (tokens.saida || 0) * pOut) / 1e6 * 10000) / 10000
}
const montarPrompt = (instrucao, fatos) => `${promptBase()}\n\n## Instrução\n${instrucao || 'Redija o texto pedido a partir dos fatos.'}\n\n## Fatos (JSON)\n${JSON.stringify(fatos)}`

async function chamarAnthropic({ prompt, maxTokens }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env.AI_MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const data = await r.json()
  return { texto: data.content?.map(c => c.text).join('') || '', tokens: data.usage ? { entrada: data.usage.input_tokens ?? 0, saida: data.usage.output_tokens ?? 0 } : null }
}

// hash do cache: versão + conteúdo do prompt base + instrução + fatos (editar config/prompt-diagnostico.md invalida o cache)
export const hashRedigir = ({ versaoPrompt, prompt, instrucao, base }) => createHash('sha256').update(JSON.stringify([versaoPrompt, prompt, instrucao, base])).digest('hex').slice(0, 24)

// redigir({ fatos, instrucao, escopo, template, versaoPrompt, evidence, maxTokens, crivo, nomesInternos, permitidos, chamar, hashBase })
//   template: string ou função(fatos) → texto determinístico (sempre o fallback). evidence: lista para numerosFora (null = não conferir números).
//   crivo: 'interno' (padrão) | 'cliente' (auditor completo). chamar: injeção para teste ({ prompt, maxTokens } → { texto, tokens }); sem ela, só com ANTHROPIC_API_KEY.
//   → { texto, origem: 'ia'|'deterministico', motivo, tokens: { entrada, saida }|null, custo_estimado|null, cache }
export async function redigir({ fatos, instrucao = '', escopo = '', template = '', versaoPrompt = PROMPT_VERSAO, evidence = null, maxTokens = 600, crivo = 'interno', nomesInternos = [], permitidos = [], chamar = null, hashBase = null } = {}) {
  const det = () => (typeof template === 'function' ? String(template(fatos) ?? '') : String(template ?? ''))
  const hash = hashRedigir({ versaoPrompt, prompt: promptBase(), instrucao, base: hashBase ?? JSON.stringify(fatos ?? null) })
  const cache = escopo ? db.prepare('SELECT * FROM ia_cache WHERE escopo = ?').get(escopo) : null
  if (cache && cache.hash === hash) return { texto: cache.texto, origem: cache.origem, motivo: 'cache', tokens: null, custo_estimado: null, cache: true }
  const chamada = typeof chamar === 'function' ? chamar : env.ANTHROPIC_API_KEY ? chamarAnthropic : null
  let out
  if (!chamada) out = { texto: det(), origem: 'deterministico', motivo: 'sem ANTHROPIC_API_KEY', tokens: null, custo_estimado: null }
  else {
    try {
      const r = await chamada({ prompt: montarPrompt(instrucao, fatos), maxTokens })
      const texto = String(r?.texto ?? '').trim(), tokens = r?.tokens || null, custo = custoEstimado(tokens)
      const fora = texto ? numerosFora(texto, evidence) : []
      const viol = texto && !fora.length ? (crivo === 'cliente' ? auditarTexto(texto, { nomesInternos, permitidos }) : auditarInterno(texto, { nomesInternos, permitidos })) : []
      out = !texto ? { texto: det(), origem: 'deterministico', motivo: 'IA devolveu vazio', tokens, custo_estimado: custo }
        : fora.length ? { texto: det(), origem: 'deterministico', motivo: `número não rastreável: ${fora.slice(0, 3).join(', ')}`, tokens, custo_estimado: custo }
        : viol.length ? { texto: det(), origem: 'deterministico', motivo: `auditor: ${codigosDe(viol).join(', ')}`, tokens, custo_estimado: custo }
        : { texto, origem: 'ia', motivo: '', tokens, custo_estimado: custo }
    } catch (e) {
      const m = String(e?.name === 'TimeoutError' ? 'timeout de 20 s' : e?.message || e).slice(0, 160)
      console.error('[ia] falha na chamada:', m)                    // antes o catch engolia o motivo
      out = { texto: det(), origem: 'deterministico', motivo: `IA indisponível: ${m}`, tokens: null, custo_estimado: null }
    }
  }
  if (escopo && out.origem === 'ia') db.prepare(`INSERT INTO ia_cache (escopo, hash, prompt_versao, texto, gerado_em, origem) VALUES (?,?,?,?,?,?)
    ON CONFLICT(escopo) DO UPDATE SET hash=excluded.hash, prompt_versao=excluded.prompt_versao, texto=excluded.texto, gerado_em=excluded.gerado_em, origem=excluded.origem`)
    .run(escopo, hash, versaoPrompt, out.texto, agora(), out.origem)
  return { ...out, cache: false }
}

// ── resumo executivo do relatório de sprint (comportamento de sempre, agora via redigir) ──
function resumoDeterministico(p) {
  const k = p.kpis
  const partes = []
  partes.push(`No período, foram planejadas ${k.planejadas} tarefas e concluídas ${k.concluidas} (${k.pct_conclusao}% de conclusão${k.esforco_planejado !== k.planejadas ? `; em esforço, ${k.pct_esforco}%` : ''}).`)
  if (p.entregas.length) partes.push(`Principais entregas: ${p.entregas.slice(0, 4).map(e => e.titulo).join('; ')}.`)
  if (k.andamento) partes.push(`${k.andamento} tarefa(s) seguem em andamento${k.validacao ? ` e ${k.validacao} em validação` : ''}.`)
  const alertas = []
  if (k.bloqueadas) alertas.push(`${k.bloqueadas} bloqueada(s)`)
  if (k.atrasadas) alertas.push(`${k.atrasadas} atrasada(s)`)
  if (alertas.length) partes.push(`Pontos de atenção: ${alertas.join(' e ')}${p.riscos[0] ? ` — destaque para "${p.riscos[0]}"` : ''}.`)
  if (k.dependencia_cliente) partes.push(`${k.dependencia_cliente} tarefa(s) aguardam retorno do cliente.`)   // fora de "Pontos de atenção": não é falha da equipe
  if (k.cobertura_evidencias) partes.push(`${k.cobertura_evidencias}% das entregas possuem evidência anexada.`)
  if (p.proximos.length) partes.push(`Foco do próximo ciclo: ${p.proximos.slice(0, 3).join('; ')}.`)
  return partes.join(' ')
}
const INSTRUCAO_RESUMO = 'Escreva o resumo executivo de um relatório de sprint para o CLIENTE de uma consultoria. 1 parágrafo de 4 a 7 frases cobrindo: avanço alcançado, principais entregas, impacto percebido, riscos e foco do próximo ciclo. Não invente nada além dos dados.'

// Texto ao CLIENTE é determinístico até uma revisão específica da IA no crivo cliente (docs/motor-diagnostico.md §4.7): a IA só entra com IA_RESUMO_SPRINT=1 no .env
// (opt-in explícito, lido na chamada); sem ela, o template com motivo 'ia_ao_cliente_desligada' — e nenhuma rede, mesmo com ANTHROPIC_API_KEY.
export async function resumoExecutivo(filtros, payload) {
  if (process.env.IA_RESUMO_SPRINT !== '1') return { texto: resumoDeterministico(payload), origem: 'deterministico', motivo: 'ia_ao_cliente_desligada', tokens: null, custo_estimado: null, cache: false }
  const escopo = `resumo:${filtros.cliente || '*'}:${filtros.projeto || '*'}:${filtros.sprint || '*'}`
  const hashBase = JSON.stringify(payload)                            // o hash é do payload ORIGINAL (a continuidade abaixo não o altera)
  const cache = db.prepare('SELECT texto FROM ia_cache WHERE escopo = ?').get(escopo)
  if (cache?.texto) payload.resumo_anterior = cache.texto.slice(0, 600)   // continuidade sem reenviar histórico
  return redigir({ fatos: payload, instrucao: INSTRUCAO_RESUMO, escopo, template: () => resumoDeterministico(payload), hashBase, evidence: [{ texto: hashBase }], maxTokens: 500, crivo: 'cliente' })
}
