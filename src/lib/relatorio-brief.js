// Relatório de Sprints Place2u enviado ao Notion do cliente — CONTEÚDO (o "brief").
// O brief é uma PROJEÇÃO de montarSemanal (semanal.js): lê o que o motor já calculou e escolhe o que o cliente pode ler. Nunca decide, prioriza,
// mede nem estima nada por conta própria (CLAUDE.md: tudo passa pelo Algoritmo/Merovíngio). Contrato: docs/contrato-relatorio-envio.md;
// desenho: docs/desenho-relatorio-notion.md (Parte A). Config: config/relatorio-brief.json.
// Núcleo SEM banco/rede: o que depende deles entra por fábrica (criarBrief) — o autoteste usa dados sintéticos e nunca toca Notion nem Mercado Livre.
// Honestidade: dado não coletado = "—" + motivo (nunca zero); sem promessa; associação ≠ causalidade; sem nome de analista, ID, link ou jargão.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { RX_JARGAO, TIPO_OFERTA, STATUS_OFERTA } from './render-semanal.js'
import { canalDe } from './semanal-resultados.js'
import { SEM_MOTIVO } from './dependencia-cliente.js'
import { cruzaFronteira, SEM_PROMOCAO } from './estado-anuncio.js'
import { termosPromocionais } from './ofertas-diagnostico.js'
import { CFG_OFERTAS } from './ofertas-preco.js'
import { CATEGORIA, auditarTexto, achaPromessa, achaCausal, achaEfeitoObservado, achaJargao, ID_INTERNO, criarDetectorNomes, limpaTexto } from './relatorio-seguro.js'   // a 2ª camada (pura): o brief usa as MESMAS regras para não divergir dela
import { acosDaAcao } from './alinhamentos.js'
import { pendenciaParaCliente, resumoCurto, ordemPendencias, textosDaPendencia, fatoParaCliente } from './pendencias-texto.js'   // texto ÚNICO das pendências do cliente (o mesmo do PDF semanal, do relatório do sprint e do documento do plano)

// ── config (validada na carga: erro de digitação derruba o carregamento com mensagem clara, não gera relatório errado) ──
const CAMPOS_ANUNCIO = ['preco', 'titulo', 'fotos', 'thumb', 'frete_gratis', 'promocao', 'ads', 'logistica']
export function validarCfg(c) {
  const falha = m => { throw new Error(`config/relatorio-brief.json: ${m}`) }
  const inteiro = (v, min, max) => Number.isInteger(v) && v >= min && v <= max
  if (!inteiro(c.janela?.dias, 1, 31)) falha('"janela.dias" deve ser inteiro entre 1 e 31')
  if (!['ontem', 'hoje'].includes(c.janela?.termina_em)) falha('"janela.termina_em" deve ser "ontem" ou "hoje"')
  // o título da página é `${titulo_prefixo} · período`; tituloOk (relatorio-notion) exige que comece pela CATEGORIA fixa — um prefixo trocado quebraria TODO envio, então falha já na carga
  if (typeof c.titulo_prefixo !== 'string' || !c.titulo_prefixo.startsWith(CATEGORIA) || c.titulo_prefixo.length > 120 || /[\r\n]/.test(c.titulo_prefixo) || /placeplan/i.test(c.titulo_prefixo)) falha(`"titulo_prefixo" deve começar por "${CATEGORIA}" (uma linha, até 120 caracteres)`)
  if (!inteiro(c.horizonte_dias, 1, 60)) falha('"horizonte_dias" deve ser inteiro entre 1 e 60')
  if (!inteiro(c.radar_dias, 1, 180) || c.radar_dias <= c.horizonte_dias) falha('"radar_dias" deve ser inteiro maior que "horizonte_dias"')
  if (!(Number.isFinite(c.preco_min_pct) && c.preco_min_pct >= 0)) falha('"preco_min_pct" deve ser número >= 0')
  if (!inteiro(c.hoje_timeout_ms, 1000, 120000)) falha('"hoje_timeout_ms" deve ser inteiro entre 1000 e 120000')
  if (!inteiro(c.limites?.informado_caracteres, 20, 300)) falha('"limites.informado_caracteres" deve ser inteiro entre 20 e 300')
  for (const k of ['titulo_caracteres', 'atividades_concluidas', 'atividades_andamento', 'promocoes_no_ar', 'resultados_desenvolvimento', 'mudancas', 'proximos', 'radar', 'depende'])
    if (!inteiro(c.limites?.[k], 1, 200)) falha(`"limites.${k}" deve ser inteiro entre 1 e 200`)
  if (!Array.isArray(c.regras_acao_cliente) || !c.regras_acao_cliente.length || !c.regras_acao_cliente.every(r => typeof r === 'string' && /^[a-z0-9_]+\*?$/.test(r))) falha('"regras_acao_cliente" deve ser lista de ids (sufixo * = prefixo)')
  for (const g of ['sempre', 'so_fronteira']) if (!Array.isArray(c.campos_mudanca?.[g]) || !c.campos_mudanca[g].every(x => CAMPOS_ANUNCIO.includes(x))) falha(`"campos_mudanca.${g}" com campo desconhecido`)
  return c
}
export const cfgBrief = validarCfg(JSON.parse(readFileSync(join(ROOT, 'config', 'relatorio-brief.json'), 'utf-8')))

// ── utilidades puras (datas em dias inteiros por Date.UTC: o fuso da máquina nunca entra) ──
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })   // mensagens fixas: nunca repetem o valor recebido
const ISO = /^\d{4}-\d{2}-\d{2}$/
const ehData = s => { if (typeof s !== 'string' || !ISO.test(s)) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s }   // '2026-02-30' rola para março: o ida e volta pega
const somarDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }
const dm = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const dma = iso => `${dm(iso)}/${iso.slice(0, 4)}`
const rotuloPeriodo = (de, ate) => de.slice(0, 4) === ate.slice(0, 4) ? `${dm(de)} a ${dma(ate)}` : `${dma(de)} a ${dma(ate)}`
const diaSP = s => {   // dia no fuso do Brasil: carimbo com fuso (Z / -03:00) é convertido; data sem fuso já é local
  s = String(s || '')
  if (!/(Z|[+-]\d\d:?\d\d)$/i.test(s)) return ehData(s.slice(0, 10)) ? s.slice(0, 10) : ''
  const d = new Date(s)
  return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
const horaSP = iso => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(11, 16)
const nv = v => typeof v === 'number' && Number.isFinite(v)
const nz = v => nv(v) && v >= 0 ? v : null                                   // não coletado / negativo = null (vira "—"), nunca zero
const r2 = n => Math.round(n * 100) / 100
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const lcFirst = s => s ? s[0].toLowerCase() + s.slice(1) : s
const ucFirst = s => s ? s[0].toUpperCase() + s.slice(1) : s
const fmtNum = (v, max = 2) => nv(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: max }) : '—'
const fmtMoeda = v => !nv(v) ? '—' : v === 0 ? 'R$ 0' : 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })   // zero real = "R$ 0": "R$ 0,00" é o sinal de null coercido (PROIBIDOS.lixo)
const fmtPct = v => nv(v) ? fmtNum(v) + '%' : '—'
const sinalPct = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 1)}%`
const anuncios = n => n === 1 ? '1 anúncio' : `${n} anúncios`

// janela do relatório: dias FECHADOS (termina_em 'ontem' = hoje−1; o dia em andamento fica fora da comparação) e a janela anterior de mesma duração
export function janelaDoRelatorio(hoje, cfg = cfgBrief) {
  if (!ehData(hoje)) throw erro('data de referência inválida')
  const ate = cfg.janela.termina_em === 'hoje' ? hoje : somarDias(hoje, -1), de = somarDias(ate, -(cfg.janela.dias - 1))
  const anterior = { de: somarDias(de, -cfg.janela.dias), ate: somarDias(de, -1) }
  return { de, ate, anterior, rotulo: rotuloPeriodo(de, ate), rotulo_anterior: rotuloPeriodo(anterior.de, anterior.ate) }
}

// ── filtro client-safe ───────────────────────────────────────────────────────────────────────────────────────────
// Toda string visível ao cliente passa por aqui: na origem (seg/limparTitulo) e, no fim, pelo auditor (auditarBrief). `rx.test(texto)`.
// Promessa, causalidade, jargão, ID e nome vêm das MESMAS funções da 2ª camada (relatorio-seguro.js): o que ela barraria, esta camada já rebaixa
// (título → "Ajuste de rotina", texto livre → descartado) em vez de deixar o auditor travar o relatório inteiro. Nunca devolvem o texto.
const PROMESSAS = CFG_OFERTAS.termos_proibidos?.promessas || []
const RX_DOMINIO = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|app|io|gov|edu)(?:\.br)?\b\S*/i         // "loja.com.br/produto?token=abc", "lista.mercadolivre.com.br/_CustId_1"
export const PROIBIDOS = [
  { id: 'sem_motivo', rx: /sem motivo registrado|registre pela tela|painel executivo/i },
  { id: 'id_interno', rx: ID_INTERNO },
  { id: 'notion', rx: /notion|fonte oficial|place sprints/i },
  { id: 'sistema', rx: /\b(backlog|algoritmo|merov[ií]ngio|payload|dry-?run|webhook)\b/i },
  { id: 'jargao', rx: { test: t => RX_JARGAO.test(t) || achaJargao(t) !== null } },
  { id: 'bloqueio_cru', rx: /\bbloqueio\s*:/i },
  { id: 'comprovado', rx: /comprovad/i },
  { id: 'efeito_observado', rx: { test: t => achaEfeitoObservado(t) !== null } },                  // espaço duplo / NBSP / zero-width já normalizados
  { id: 'causalidade', rx: { test: t => /\b(causou|provocou|causado por)\b/i.test(t) || achaCausal(t) !== null } },
  { id: 'vocabulario_interno', rx: /\bcards?\b|respons[aá]vel|analista|\bconsultor(?:a|es|as)?\b|renova[çc][ãa]o|vencimento|churn|mensalidade|fict[ií]cio|uso interno/i },   // "consultoria" é o serviço, não a pessoa
  { id: 'promessa', rx: { test: t => termosPromocionais(t, PROMESSAS).length > 0 || /\bgarantid[oa]s?\b|\bgarantimos\b|\btop ?1\b|\bn[úu]mero ?1\b/i.test(t) || achaPromessa(t) !== null } },   // "garantia" (atributo do anúncio) não é promessa
  { id: 'url', rx: { test: t => /https?:\/\/|\blocalhost\b|127\.0\.0\.1|\bwww\./i.test(t) || RX_DOMINIO.test(t) } },
  { id: 'segredo', rx: /\b(secret_|ntn_[a-z0-9]|bearer\s+[a-z0-9])/i },
  { id: 'lixo', rx: { test: t => /undefined|\bNaN\b|\[object|R\$ ?0,00\b/.test(t) || /\b(?:null|infinity)\b/i.test(t) } },
]
// nomes de analista/consultor/líder: o detector da 2ª camada (nome completo + cada nome/sobrenome de 3+ letras; e-mail ignorado; `permitidos` = nome do cliente, token a token;
// palavras comuns como Rosa/Lava/Silva/Lima só valem junto do nome completo). Devolve null se não há o que procurar; `.test(texto)` normaliza sozinho.
export function regexNomes(nomes, permitidos = []) {
  const d = criarDetectorNomes(nomes, permitidos)
  return d.vazio ? null : d
}
// id da 1ª regra violada (ou null). Nunca devolve o texto.
function violacao(texto, rxNomes) {
  const t = limpaTexto(texto)
  for (const p of PROIBIDOS) if (p.rx.test(t)) return p.id
  return rxNomes && rxNomes.test(String(texto ?? '')) ? 'nome_interno' : null
}
// 2ª camada sobre um texto avulso (título, motivo, texto do card): true = ela barraria
const segunda = (texto, ctx) => auditarTexto(texto, { nomesInternos: ctx.nomes, permitidos: ctx.permitidos }).length > 0

const RX_VALOR_SOLTO = /^(?:(?:resultado|impacto|ganho)\s*:?\s*)?[-+−]?\s*\d[\d.,]*\s*$/i                  // "Resultado: 0", "12": número sem unidade nem contexto não é resultado
const GENERICO = canal => canal ? `Ajuste de rotina — ${canal}` : 'Ajuste de rotina'
const RX_URL_TITULO = [/\bhttps?:\/\/\S*/gi, /\bhttps?:/gi, /\bwww\.\S+/gi, new RegExp(RX_DOMINIO.source, 'gi')]   // ANTES das demais substituições: elas desfazem "//" e deixariam "https: shopee.com.br/…"
// Título de card/ação limpo para o cliente: 1ª linha; sem URL/domínio, "· PS-…", "(MLB…)", ids de 10+ dígitos, "ID do Produto: …" nem o sufixo "(n)" (que vira chave de grupo);
// corta em `limite` caracteres na palavra; se ainda violar PROIBIDOS, nome interno ou a 2ª camada vira "Ajuste de rotina — {canal}" e conta em ctx.omitidos.titulos_genericos.
// Regra de ouro: nenhum título real trava o relatório — no pior caso vira "Ajuste de rotina".
// ctx opcional: { rxNomes, nomes (internos, p/ a 2ª camada), permitidos (nome do cliente), omitidos, limite }.
export function limparTitulo(texto, canal = '', ctx = {}) {
  const limite = ctx.limite || cfgBrief.limites.titulo_caracteres
  let s = String(texto ?? '').split(/\r?\n/)[0]
  const semUrl = RX_URL_TITULO.reduce((acc, rx) => acc.replace(rx, ' '), s)
  if (semUrl !== s) s = semUrl.replace(/(?:^|\s)(?:ver|veja|acessar|acesse|link|site|url)\s*[:\-–—]?\s*$/i, '')   // "Ver https://…" → sobra só o verbo solto
  s = s
    .replace(/\s*[·•|\-–—]?\s*\bPS-[0-9a-f]{4,}\b/gi, '')
    .replace(/\(\s*MLB[A-Z]?\s*[-:]?\s*\d+\s*\)/gi, '').replace(/MLB[A-Z]?\s*[-:]?\s*\d{6,}\w*/gi, '')   // MLB123…, MLBU123…, "MLB: 123…"
    .replace(/\bID do Produto:?\s*\S*/gi, '')
    .replace(/\(\s*\d{10,}\w*\s*\)/g, '').replace(/\b\d{10,}\w*/g, '')                                      // ids soltos de 10+ dígitos (e o sufixo colado: 123…v)
    .replace(/\(\s*\)/g, '').replace(/\s+/g, ' ')
    .replace(/\s*\(\s*\d{1,3}(?:\s*\/\s*\d{1,3})?\s*\)\s*$/, '')                                          // "(n)" / "(1/2)" no fim = chave de grupo
    .replace(/([:;,])\s*[-–—/]+\s*/g, '$1 ').replace(/([-–—·|])(?:\s+[-–—·|])+/g, '$1').replace(/(?:\s+[-–—/&+,;]+)+\s*$/, '')   // pontuação que sobrou da remoção
    .replace(/^[\s·:;,+\-–—|/]+|[\s·:;,+\-–—|/]+$/g, '')
  if (s.length > limite) { const c = s.slice(0, limite - 1), i = c.lastIndexOf(' '); s = c.slice(0, i > limite * 0.5 ? i : limite - 1).replace(/[\s·:;,+\-–—|]+$/, '') + '…' }
  s = ucFirst(s)
  // motivo do rebaixamento: só contagem interna (omitidos), para o time ver o que mais vira "Ajuste de rotina" e ajustar a regra — nunca o texto
  const motivo = s.replace(/[^\p{L}]/gu, '').length < 3 ? 'sem_letras' : violacao(s, ctx.rxNomes) || (segunda(s, ctx) ? 'segunda_camada' : null)
  if (motivo) {
    if (ctx.omitidos) {
      ctx.omitidos.titulos_genericos = (ctx.omitidos.titulos_genericos || 0) + 1
      const por = ctx.omitidos.titulos_genericos_por ||= {}; por[motivo] = (por[motivo] || 0) + 1
    }
    return GENERICO(canal)
  }
  return s
}
const ehGenerico = t => /^Ajuste de rotina(?: — |$)/.test(t)
const chaveTitulo = t => norm(t).replace(/[^a-z0-9]+/g, ' ').trim()

// Percorre toda string visível (fora de `_interno` e do nome do cliente). Devolve [{ regra, caminho }] — vazio = seguro. Nunca ecoa o texto.
function* textosVisiveis(o, caminho = '') {
  if (typeof o === 'string') yield [caminho, o]
  else if (Array.isArray(o)) for (let i = 0; i < o.length; i++) yield* textosVisiveis(o[i], `${caminho}[${i}]`)
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== '_interno' && k !== 'cliente') yield* textosVisiveis(v, caminho ? `${caminho}.${k}` : k)
}
// Texto de gabarito (fixo do brief, ou já checado por nome NA ORIGEM — seg/limparTitulo): um sobrenome que é palavra comum ("Dias" em "últimos 14 dias") não pode
// derrubar todo relatório do cliente. As regras estáticas de PROIBIDOS valem para tudo; o filtro de NOMES vale só para o texto que vem do motor e dos cards.
const GABARITO = /^(titulo|rodape\[\d+\]|abertura\.(cabecalho|frase)|qualidade\.motivos\[\d+\]|resultados\.(motivo|linhas\[\d+\]\..+|hoje\..+)|desenvolvimento\.vazio_\w+|proximos\.(vazio|agenda\.resumo))$/
export function auditarBrief(brief, ctx = {}) {
  const rxN = regexNomes(ctx.nomes, [brief?.cliente]), out = []
  for (const [caminho, t] of textosVisiveis(brief)) {
    const gabarito = GABARITO.test(caminho) || (/^depende\.itens\[\d+\]\.rotulo$/.test(caminho) && t.startsWith('Repor estoque de '))
    const regra = violacao(t, gabarito ? null : rxN)
    if (regra) out.push({ regra, caminho })
  }
  return out
}
export class BriefInseguro extends Error {
  constructor(violacoes) { super('O relatório contém texto interno e não foi gerado'); this.name = 'BriefInseguro'; this.code = 'BRIEF_INSEGURO'; this.status = 422; this.violacoes = violacoes }
}
export const semInterno = ({ _interno, ...resto }) => resto                   // o que vai adiante (Notion): nunca `_interno`

// ── projeção ─────────────────────────────────────────────────────────────────────────────────────────────────────
const LINHAS_ML = [['faturamento', 'Faturamento'], ['vendas', 'Pedidos pagos'], ['ticket_medio', 'Ticket médio'], ['visitas', 'Visitas aos anúncios'], ['conversao', 'Conversão'], ['cancelamentos', 'Pedidos cancelados']]
const LINHAS_ADS = [['investimento', 'Investimento em anúncios (Ads)'], ['roas', 'Retorno dos anúncios (ROAS)']]
const LINHAS_ADS_EXTRA = [['acos', 'ACOS'], ['tacos', 'TACOS']]
const GLOSSA = new Set(['conversao', 'roas', 'ticket_medio'])                   // linguagem "simples": uma linha de explicação nestes indicadores
const FRASE_MOTIVO = [[/pela API d[oa]s? /i, 'pelo '], [/API d[oa]s? /i, '']]
const motivoCliente = (m, generico) => {                                        // motivo do motor → frase do cliente (RX_JARGAO / erro cru de API cai no genérico)
  let t = String(m ?? '').trim()
  if (!t || RX_JARGAO.test(t)) return generico
  for (const [rx, por] of FRASE_MOTIVO) t = t.replace(rx, por)
  return t.replace(/\.$/, '')
}
const MOTIVO_GENERICO = 'não disponível nesta geração do relatório'

// delta do motor ({ valor, bom, pontos }) → { texto, sinal }; sem delta = null ("—" na célula)
const variacaoDe = d => !d || !nv(d.valor) ? null
  : { texto: `${d.valor > 0 ? '▲' : d.valor < 0 ? '▼' : '='} ${fmtNum(Math.abs(d.valor), 1)}${d.pontos ? ' p.p.' : '%'}`, sinal: d.valor === 0 ? 'igual' : d.bom ? 'bom' : 'ruim' }
const formatar = (unidade, v) => unidade === 'moeda' ? fmtMoeda(v) : unidade === 'pct' ? fmtPct(v) : fmtNum(v)

// valores do período ANTERIOR, do dado bruto do motor (a mesma fonte e o mesmo tratamento do período atual; ticket nulo se não houve venda)
function valoresAnteriores(s, fonte) {
  const out = {}
  if (fonte === 'api') {
    const a = s.negocio_comparativo?.anterior
    if (a && a.disponivel !== false && a.parcial !== true) Object.assign(out, { faturamento: nz(a.faturamento), vendas: nz(a.vendas), ticket_medio: a.vendas > 0 ? nz(a.preco_medio_venda) : null, visitas: nz(a.visitas), conversao: nz(a.conversao), cancelamentos: nz(a.vendas_canceladas) })
  } else if (fonte === 'manual') {
    for (const k of ['faturamento', 'vendas', 'ticket_medio', 'visitas', 'conversao']) out[k] = nz(s.crescimento?.[k]?.anterior)
  }
  const ap = s.ads_comparativo?.anterior
  if (ap?.disponivel) {
    const inv = nz(ap.investimento), rec = nz(ap.receita), fat = fonte === 'api' ? nz(s.negocio_comparativo?.anterior?.faturamento) : nz(s.crescimento?.faturamento?.anterior)
    Object.assign(out, { investimento: inv, roas: nz(ap.roas) ?? (inv > 0 && rec != null ? r2(rec / inv) : null), acos: nz(ap.acos) ?? (rec > 0 && inv != null ? r2(100 * inv / rec) : null), tacos: inv != null && fat ? r2(inv / fat * 100) : null })
  }
  return out
}

export function projetarBrief(semanal, ctx = {}) {
  const cfg = ctx.cfg || cfgBrief, L = cfg.limites
  const s = semanal || {}
  const hoje = ctx.hoje
  const J = janelaDoRelatorio(hoje, cfg)
  const cliente = String(ctx.cliente ?? s.identificacao?.cliente ?? '')
  const hora = ctx.hora || (ctx.agora ? horaSP(ctx.agora) : '00:00')
  const regras = s.perfil?.regras || {}, lista = regras.lista_tarefas === true || cfg.listar_tarefas_sempre === true   // 09/10: tarefas executadas por nome em todo relatório curto
  const permitidos = [cliente]                                                    // o nome do cliente não é vazamento ("DG da Silva" não barra "Silva")
  const rxN = regexNomes(ctx.nomes, permitidos)
  const omitidos = {}, avisos = []
  const conta = (k, n = 1) => { omitidos[k] = (omitidos[k] || 0) + n }
  const ctx2 = { nomes: ctx.nomes, permitidos }                                   // 2ª camada (relatorio-seguro) aplicada já aqui: nada que ela barre chega ao auditor final
  const seg = (texto, fallback, chave = 'textos') => { const t = String(texto ?? '').trim(); if (!t) return fallback; if (violacao(t, rxN) || segunda(t, ctx2)) { conta(chave); return fallback } return t }   // texto livre: se violar, cai no fallback
  const limpar = (t, canal) => limparTitulo(t, canal, { rxNomes: rxN, nomes: ctx.nomes, permitidos, omitidos, limite: L.titulo_caracteres })
  const canalNome = p => seg(canalDe(p) || String(p ?? '').trim(), 'Outros canais', 'canais')
  const fim14 = somarDias(hoje, cfg.horizonte_dias), fimRadar = somarDias(hoje, cfg.radar_dias)
  // alinhamentos com o cliente (src/lib/alinhamentos.js): o predicado do núcleo decide; aqui só se projeta (texto fixo do tipo ou omitido, conta em omitidos.alinhado)
  const al = typeof ctx.alinhado === 'function' ? ctx.alinhado : null

  // ações do plano: ids das que NÃO são do cliente (regra fora da lista branca) — o card distribuído delas é rotina interna e nunca vira atividade nem próximo passo
  const regraOk = r => cfg.regras_acao_cliente.some(x => x.endsWith('*') ? String(r).startsWith(x.slice(0, -1)) : r === x)
  const planoTodas = (ctx.acoesPlano || []).filter(a => a && (!a.cliente || a.cliente === cliente))      // isolamento por cliente também aqui
  const idsInternos = new Set(planoTodas.filter(a => !regraOk(a.regra)).map(a => String(a.id || '').toUpperCase()).filter(Boolean))
  const idPS = t => (/\bPS-[0-9a-f]{4,}\b/i.exec(String(t ?? '')) || [])[0]?.toUpperCase() || ''

  // ── 1. Resultados ────────────────────────────────────────────────────────────────────────────────────────────
  const R = s.resultados || {}, ml = R.ml || {}, ads = R.ads || {}
  const mlOk = !!ml.disponivel
  const marcaML = (s.identificacao?.marketplaces || []).some(m => canalDe(m) === 'Mercado Livre')
  const semCanalML = !s.meli_conectado && (s.identificacao?.marketplaces || []).length > 0 && !marcaML      // conta sem nenhum canal Mercado Livre: a frase do ML não se aplica
  const fraseML = semCanalML ? 'Ainda não há integração automática de números de vendas para os canais desta conta; nenhum número foi estimado'
    : motivoCliente(ml.motivo, 'Os números do Mercado Livre não estão disponíveis nesta geração do relatório; nada foi estimado')
  const MOTIVO_RESULTADOS = 'Os números do Mercado Livre não estão disponíveis nesta geração do relatório; nada foi estimado.'
  const resultados = { disponivel: mlOk, motivo: mlOk ? null : seg(ucFirst(fraseML) + '.', MOTIVO_RESULTADOS, 'motivos'), linhas: [], hoje: null, nao_coletado: [], outros: [] }
  if (mlOk) {
    const ant = valoresAnteriores(s, ml.fonte)
    // período anterior com mais de 1.000 pedidos = só uma amostra: comparar total × amostra inventaria uma variação; a coluna fica "—" e a frase abaixo avisa
    const antAmostra = ml.fonte === 'api' && s.negocio_comparativo?.anterior?.parcial === true
    const porChave = (bloco, c) => (bloco.metricas || []).find(m => m.chave === c)
    const sem = new Map()                                                        // motivo → rótulos sem valor (agrupados: uma frase por motivo)
    const linhaDe = (bloco, [chave, rotulo]) => {
      const m = porChave(bloco, chave)
      if (!m) return null
      const l = { chave, rotulo, atual: formatar(m.unidade, m.valor), anterior: formatar(m.unidade, ant[chave]), variacao: bloco === ml && antAmostra ? null : variacaoDe(m.delta) }
      // investir mais ou menos em Ads não é bom nem ruim por si: variação NEUTRA (sinal 'igual'), para a coluna não sugerir "dado não coletado" onde há dado
      if (!l.variacao && chave === 'investimento' && nv(m.valor) && nv(ant[chave]) && ant[chave] !== 0) {
        const pct = Math.round(((m.valor - ant[chave]) / Math.abs(ant[chave])) * 1000) / 10
        l.variacao = { texto: `${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${fmtNum(Math.abs(pct), 1)}%`, sinal: 'igual' }
      }
      if (regras.linguagem === 'simples' && GLOSSA.has(chave) && m.explicacao) { const g = seg(m.explicacao, '', 'glossas'); if (g) l.glossa = g }
      if (!nv(m.valor)) { const mot = motivoCliente(m.motivo, MOTIVO_GENERICO); sem.set(mot, [...(sem.get(mot) || []), lcFirst(rotulo)]) }
      return l
    }
    resultados.linhas = LINHAS_ML.map(c => linhaDe(ml, c)).filter(Boolean)
    if (ads.disponivel) resultados.linhas.push(...[...LINHAS_ADS, ...(regras.metricas_extras ? LINHAS_ADS_EXTRA : [])].map(c => linhaDe(ads, c)).filter(Boolean))
    else if (ads.motivo) sem.set(motivoCliente(ads.motivo, MOTIVO_GENERICO), ['anúncios patrocinados (Ads)'])
    if (antAmostra) sem.set('o período anterior tem mais de 1.000 pedidos e só uma amostra foi lida; a variação não é calculada', ['período anterior para comparação'])
    else if (resultados.linhas.length && !Object.values(ant).some(v => v != null)) sem.set('não retornado pelo Mercado Livre', ['período anterior para comparação'])
    resultados.nao_coletado = [...sem].map(([mot, rots]) => seg(`${rots.join(', ')}: ${mot}`, `${rots.join(', ')}: ${MOTIVO_GENERICO}`, 'motivos'))
    const h = ctx.hojeNegocio
    if (h && nv(h.faturamento) && nv(h.pedidos ?? h.vendas)) resultados.hoje = { ate_hora: hora, faturamento: fmtMoeda(h.faturamento), pedidos: h.pedidos ?? h.vendas }
  }
  // outros canais (sem API): só o que a equipe informou; sem dado = uma linha honesta (apenas quando o bloco principal existe — senão o motivo já diz tudo)
  for (const c of R.outros || []) {
    if (!c?.canal) continue
    const canal = seg(c.canal, '', 'canais'); if (!canal) continue
    const dado = (c.metricas || []).filter(m => nv(m.valor) && ['faturamento', 'vendas', 'visitas', 'conversao'].includes(m.chave))
    if (c.fonte === 'manual' && dado.length) resultados.outros.push({ canal, texto: `${dado.map(m => `${m.rotulo.toLowerCase()} ${formatar(m.unidade, m.valor)}`).join(' · ')} (informado pela equipe)` })
    else if (mlOk) resultados.outros.push({ canal, texto: 'sem integração automática; nenhum número informado nesta semana' })
  }

  // qualidade: ML conectado mas sem resposta = o envio agendado adia e tenta de novo; o manual pede confirmação
  const falhouML = !!s.meli_conectado && !s.negocio_comparativo?.atual
  const qualidade = { ok: !falhouML, motivos: falhouML ? ['O Mercado Livre não respondeu na geração deste relatório'] : [] }

  // ── 2. Atividades ────────────────────────────────────────────────────────────────────────────────────────────
  const acoes = (s.acoes || []).filter(a => { if (idsInternos.has(idPS(a.titulo))) { conta('rotina_interna'); return false } return true })
  const porCanal = new Map(), grupos = new Map()
  for (const a of acoes) {
    const canal = canalNome(a.processo)
    porCanal.set(canal, (porCanal.get(canal) || 0) + 1)
    if (!lista) continue
    const rotulo = limpar(a.titulo, canal), k = `${chaveTitulo(rotulo)}|${canal}`
    const g = grupos.get(k) || grupos.set(k, { rotulo, canal, quando: a.data || null, fim: null, n: 0 }).get(k)
    g.n++
    if (a.data) { if (!g.quando || a.data < g.quando) g.quando = a.data; if (!g.fim || a.data > g.fim) g.fim = a.data }
  }
  const limConcl = Math.min(L.atividades_concluidas, regras.max_acoes > 0 ? regras.max_acoes : Infinity)
  const gruposConcl = [...grupos.values()].map(g => ({ rotulo: g.rotulo, canal: g.canal, quando: g.quando, ...(g.fim && g.fim !== g.quando ? { fim: g.fim } : {}), n: g.n }))
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)) || b.n - a.n).slice(0, limConcl)
  if (grupos.size > limConcl) conta('grupos_concluidos', grupos.size - limConcl)

  const abertas = (s.proximos || []).filter(p => p && !idsInternos.has(idPS(p.titulo)))
  const andamento = abertas.filter(p => (p.status === 'andamento' || p.status === 'validacao') && !p.dependencia_cliente)
  const futuro = d => (ehData(d) && d >= hoje ? d : null)
  const gAnd = new Map()
  for (const p of andamento) {
    const canal = canalNome(p.processo), rotulo = limpar(p.titulo, canal), k = `${chaveTitulo(rotulo)}|${canal}`
    const g = gAnd.get(k) || gAnd.set(k, { rotulo, canal, previsto: null, n: 0 }).get(k)
    g.n++
    const d = [futuro(p.data_planejada), futuro(p.prazo)].filter(Boolean).sort()[0] || null
    if (d && (!g.previsto || d < g.previsto)) g.previsto = d
  }
  // promoções (relatorioOfertas): "no ar" = started e ainda dentro do prazo; "programada" = pending (vai em Próximos passos). Candidata/encerrada nunca.
  const ofertas = (ctx.ofertas ?? s.ofertas)
  const promos = (ofertas?.disponivel !== false ? (ofertas?.promocoes || []) : []).map(p => ({ status: String(p?.status).toLowerCase(), tipo: TIPO_OFERTA[String(p?.tipo).toUpperCase()] || 'Outra promoção', inicio: diaSP(p?.inicio), fim: diaSP(p?.fim) }))
    .filter(p => STATUS_OFERTA[p.status])
  const noAr = [...new Map(promos.filter(p => p.status === 'started' && (!p.fim || p.fim >= hoje)).map(p => [`${p.tipo}|${p.fim}`, { rotulo: p.tipo, ate: p.fim || null }])).values()].slice(0, L.promocoes_no_ar)
  const atividades = {
    lista,
    concluido: { total: acoes.length, por_canal: [...porCanal].map(([canal, n]) => ({ canal, n })).sort((a, b) => b.n - a.n || a.canal.localeCompare(b.canal)), grupos: gruposConcl },
    andamento: { total: andamento.length, itens: lista ? [...gAnd.values()].slice(0, L.atividades_andamento).map(g => ({ rotulo: g.n > 1 ? `${g.rotulo} (${g.n} tarefas)` : g.rotulo, canal: g.canal, previsto: g.previsto })) : [], promocoes: noAr },
  }
  if (s.atividades?.bloqueadas > 0) avisos.push(`${s.atividades.bloqueadas} tarefa(s) bloqueada(s) não listada(s) ao cliente`)
  if (s.atividades?.atrasadas > 0) avisos.push(`${s.atividades.atrasadas} tarefa(s) atrasada(s) não listada(s) ao cliente`)

  // ── 3. Desenvolvimento ───────────────────────────────────────────────────────────────────────────────────────
  const TR = s.tarefas_resultado || {}
  const limRes = Math.min(L.resultados_desenvolvimento, regras.max_resultados > 0 ? regras.max_resultados : Infinity)
  const devRes = []
  for (const it of TR.itens || []) {
    if (devRes.length >= limRes) break
    if (idsInternos.has(idPS(it.titulo))) continue
    const informado = it.tipo !== 'medido'                                        // qualquer valor que não seja "medido" é tratado como informado
    const mt = it.metrica || {}
    const texto = seg(mt.texto, '', 'resultados'), rotM = seg(mt.rotulo, '', 'resultados')
    if (!texto || !rotM) { conta('resultados_descartados'); continue }           // texto livre do card com algo interno: o item sai, nunca vai "editado"
    // texto livre do card (resultado alcançado / impacto) é a única coisa que a equipe escreve à mão e o cliente lê: só entra se for CURTO, tiver letras (não "n/a") e não for um
    // número solto ("Resultado: 0"). Causalidade e promessa ("graças a", "por causa de", "trouxe R$ …", "100% certo") já foram barradas por seg() nas duas camadas.
    if (informado && (texto.length > L.informado_caracteres || texto.replace(/[^\p{L}]/gu, '').length < 3 || RX_VALOR_SOLTO.test(texto))) { conta('resultados_descartados'); continue }
    const nivel = it.confianca?.nivel
    const selo = informado ? 'informado' : (nivel === 'baixa' || /hip[óo]tese/i.test(rotM)) ? 'hipotese' : 'medido'
    const canal = canalNome(it.canal)
    devRes.push({ rotulo: limpar(it.titulo, canal), canal, quando: it.concluida_em || null, metrica: { rotulo: rotM, texto }, selo,
      confianca: !informado && it.confianca ? { nivel: it.confianca.nivel, pct: it.confianca.pct ?? null } : null })
  }
  const diasJanRes = /últimos (\d+) dias/.exec(TR.nota || '')?.[1]
  const vazioRes = devRes.length ? null
    : `Nenhuma tarefa concluída ${diasJanRes ? `nos últimos ${diasJanRes} dias` : 'no período analisado'} tem efeito medido ou informado até agora. Só medimos o efeito de ajustes em anúncios do Mercado Livre identificados na tarefa.`

  // mudanças nos anúncios (change-log meli_item_mudanca): só campos client-safe, agrupadas por dia, sem item, id nem nome de produto
  const sempre = new Set(cfg.campos_mudanca.sempre), fronteira = new Set(cfg.campos_mudanca.so_fronteira)
  const evs = []
  const empilha = (item, e) => { if (e && typeof e === 'object') evs.push({ item: item ?? e.item_id ?? '', ...e }) }
  if (ctx.eventos instanceof Map) for (const [item, l] of ctx.eventos) for (const e of l || []) empilha(item, e)
  else if (Array.isArray(ctx.eventos)) for (const e of ctx.eventos) empilha(null, e)
  else if (ctx.eventos && typeof ctx.eventos === 'object') for (const [item, l] of Object.entries(ctx.eventos)) for (const e of l || []) empilha(item, e)
  const vistosEv = new Set(), gMud = new Map()
  const DIRECAO = {
    promocao: e => String(e.para) === SEM_PROMOCAO ? 'saiu' : 'entrou',
    ads: e => String(e.para) === 'active' ? 'ligado' : String(e.para) === 'paused' ? 'pausado' : 'desligado',
    logistica: e => String(e.para) === 'fulfillment' ? 'entrou' : 'saiu',
    frete_gratis: e => Number(e.para) ? 'ativou' : 'removeu',
  }
  for (const e of evs) {
    if (!(e.dia >= J.de && e.dia <= J.ate) || !(sempre.has(e.campo) || (fronteira.has(e.campo) && cruzaFronteira(e)))) continue
    if (e.campo === 'preco' && !(nv(e.pct) && Math.abs(e.pct) >= cfg.preco_min_pct)) continue
    if (e.campo === 'promocao' && String(e.de) !== SEM_PROMOCAO && String(e.para) !== SEM_PROMOCAO) continue
    const dedupe = `${e.item}|${e.dia}|${e.campo}|${e.de}|${e.para}`
    if (vistosEv.has(dedupe)) continue                                           // o mesmo evento visto por duas fontes (coleta + acompanhamento) conta uma vez
    vistosEv.add(dedupe)
    // anúncio alinhado com o cliente: a mudança sai rotulada com o texto fixo do tipo ("conforme alinhado em dd/mm") ou é omitida (config → relatorio)
    const ali = al && e.item ? al({ item: String(e.item) }) : null
    if (ali?.sim && ali.relatorio === 'omitir') { conta('alinhado'); continue }
    const k = `${e.dia}|${e.campo}|${DIRECAO[e.campo]?.(e) || ''}${ali?.sim ? `|al${ali.id}` : ''}`
    const g = gMud.get(k) || gMud.set(k, { dia: e.dia, campo: e.campo, dir: DIRECAO[e.campo]?.(e) || '', itens: new Set(), pcts: [], incertezas: [], alinhado: ali?.sim ? lcFirst(ali.texto_cliente).replace(/\.$/, '') : '' }).get(k)
    g.itens.add(e.item || `#${g.itens.size}`)
    if (nv(e.pct)) g.pcts.push(e.pct)
    g.incertezas.push(e.incerteza || '')
  }
  const TEXTO_MUD = {
    preco: g => { const p = [...g.pcts].sort((a, b) => Math.abs(a) - Math.abs(b)), fmt = v => sinalPct(v), faixa = p.length > 1 && p[0] !== p.at(-1) ? `${fmt(p[0])} a ${fmt(p.at(-1))}` : fmt(p[0]); return `Preço ajustado em ${anuncios(g.itens.size)} (${faixa})` },
    titulo: g => `Título atualizado em ${anuncios(g.itens.size)}`,
    fotos: g => `Fotos atualizadas em ${anuncios(g.itens.size)}`,
    thumb: g => `Foto de capa trocada em ${anuncios(g.itens.size)}`,
    frete_gratis: g => g.dir === 'ativou' ? `Frete grátis ativado em ${anuncios(g.itens.size)}` : `Frete grátis removido de ${anuncios(g.itens.size)}`,
    promocao: g => g.itens.size === 1 ? `1 anúncio ${g.dir === 'entrou' ? 'entrou em' : 'saiu da'} promoção` : `${g.itens.size} anúncios ${g.dir === 'entrou' ? 'entraram em' : 'saíram da'} promoção`,
    ads: g => `Ads ${g.dir} em ${anuncios(g.itens.size)}`,
    logistica: g => g.itens.size === 1 ? `1 anúncio ${g.dir === 'entrou' ? 'passou a ser enviado' : 'deixou de ser enviado'} pelo Full` : `${g.itens.size} anúncios ${g.dir === 'entrou' ? 'passaram a ser enviados' : 'deixaram de ser enviados'} pelo Full`,
  }
  const ORDEM_CAMPO = Object.keys(TEXTO_MUD)
  const mudTodas = [...gMud.values()].sort((a, b) => a.dia.localeCompare(b.dia) || ORDEM_CAMPO.indexOf(a.campo) - ORDEM_CAMPO.indexOf(b.campo)).map(g => {
    const unica = g.incertezas.every(x => x && x === g.incertezas[0]) ? g.incertezas[0] : ''     // fotografia não diária (acompanhamento): a data é uma faixa, e o texto diz isso
    return { quando: g.dia, texto: TEXTO_MUD[g.campo](g) + (unica ? ` — ${unica}` : '') + (g.alinhado ? ` — ${g.alinhado}` : '') }
  })
  if (mudTodas.length > L.mudancas) conta('mudancas_omitidas', mudTodas.length - L.mudancas)
  const mudancas = mudTodas.slice(-L.mudancas)                                    // as mais recentes, em ordem de data
  let vazioMud = null
  if (!mudancas.length && s.meli_conectado) {
    const ini = ctx.inicioHistorico ?? null
    vazioMud = !ini || ini > J.de
      ? 'O histórico de mudanças dos anúncios desta conta ainda não cobre toda a semana; não afirmamos que não houve mudanças.'
      : 'Nenhuma mudança relevante de preço, promoção, Ads ou Full registrada nesta semana.'
  }
  const desenvolvimento = { resultados: devRes, vazio_resultados: vazioRes, mudancas, vazio_mudancas: vazioMud }

  // ── 5. Depende de você ───────────────────────────────────────────────────────────────────────────────────────
  const gDep = new Map()
  for (const p of abertas.filter(p => p.dependencia_cliente)) {
    const registrado = p.dependencia_cliente !== SEM_MOTIVO && p.motivo_registrado !== false       // sem registro (SEM_MOTIVO) o texto interno NUNCA sai: vira "aguardamos um retorno seu"
    const rotuloT = limpar(p.titulo, canalNome(p.processo))
    const k = registrado ? `r|${chaveTitulo(p.dependencia_cliente)}` : `n|${chaveTitulo(rotuloT)}`
    const g = gDep.get(k) || gDep.set(k, { registrado, texto: p.dependencia_cliente, rotuloT, n: 0, desde: null, dias: null, aprox: false }).get(k)
    g.n++
    if (ehData(p.desde) && (!g.desde || p.desde < g.desde)) { g.desde = p.desde; g.aprox = p.desde_aproximado === true; g.dias = g.aprox ? null : nv(p.dias_aguardando) ? p.dias_aguardando : null }   // data aproximada (última edição do card) não leva contagem de dias
  }
  const itensDep = [...gDep.values()].sort((a, b) => String(a.desde ?? '9').localeCompare(String(b.desde ?? '9'))).map(g => {
    const neutro = `${ehGenerico(g.rotuloT) ? (g.n > 1 ? 'Tarefas' : 'Uma tarefa') : g.rotuloT}${g.n > 1 ? ` (${g.n} tarefas)` : ''} — aguardamos um retorno seu sobre ${g.n > 1 ? 'estas tarefas' : 'esta tarefa'}`   // sem registro do motivo: o texto interno nunca sai
    return { rotulo: g.registrado ? seg(g.texto, neutro, 'dependencias') : neutro, desde: g.desde, dias: g.dias, ...(g.aprox ? { desde_aproximado: true } : {}) }
  })
  const riscoTodos = (s.risco_estoque || []).filter(i => i && nv(i.cobertura_dias))
  const risco = al ? riscoTodos.filter(i => !al({ item: String(i.id ?? ''), regra: 'estoque_ruptura', aviso: true }).sim) : riscoTodos   // descontinuado/pausado combinado: não se pede reposição
  if (risco.length < riscoTodos.length) conta('alinhado', riscoTodos.length - risco.length)
  const limiarRuptura = ctx.limiarRupturaDias ?? 10
  if (risco.length) {
    const curto = t => { if (t.length <= 40) return t; const i = t.lastIndexOf(' ', 40); return t.slice(0, i > 20 ? i : 40).replace(/[\s·:;,+\-–—|…]+$/, '') + '…' }
    const nomes = risco.slice(0, 2).map(i => curto(limpar(i.titulo, ''))).filter(t => !ehGenerico(t))
    const n = risco.length
    itensDep.push({ rotulo: `Repor estoque de ${n === 1 ? '1 anúncio que mais vende' : `${n} anúncios que mais vendem`} (estoque para menos de ${limiarRuptura} dias)${nomes.length ? `: ${nomes.join(', ')}${n > nomes.length ? ` (+${n - nomes.length})` : ''}` : ''}`, desde: null, dias: null })
  }
  const depende = { itens: itensDep.length > L.depende ? [...itensDep.slice(0, L.depende - (risco.length ? 1 : 0)), ...(risco.length ? [itensDep.at(-1)] : [])] : itensDep }

  // ── 5b. Pendências do cliente (avaliador único, injetado): ao LADO de `itens`, que não muda. Com pendências, o relatório mostra só elas (tarefa e estoque já estão nelas). ──
  // Toda string passa pelas duas camadas; o texto que violar descarta SÓ aquela pendência (conta em omitidos.pendencias), nunca o relatório. Sem pendência = comportamento anterior.
  const linguagem = ['simples', 'tecnica'].includes(regras.linguagem) ? regras.linguagem : 'padrao'
  const brutas = (Array.isArray(ctx.pendencias) ? ctx.pendencias : []).filter(p => p && typeof p === 'object').sort(ordemPendencias)
  const limpas = []                                                                 // { c: forma do cliente, evid: evidência datada (só alimenta o resumo do alerta) }
  for (const p of brutas) {
    const c = pendenciaParaCliente(p), evid = fatoParaCliente(p)     // data aproximada: o fato é reconstruído sem contagem de dias
    if (!c.rotulo || !c.por_que_importa || !c.efeito_se_atrasar || !c.o_que_precisamos) { conta('pendencias'); continue }       // sem os textos do catálogo não há explicação: fora
    if (textosDaPendencia(c).some(t => violacao(t, rxN) || segunda(t, ctx2))) { conta('pendencias'); continue }
    limpas.push({ c, evid })
  }
  const mostradas = limpas.slice(0, L.depende)
  depende.pendencias = mostradas.map(x => x.c)
  depende.mais = limpas.length - mostradas.length                                   // quantas ficaram além do teto (honesto: o relatório diz que há mais)
  depende.linguagem = linguagem
  const alertas = mostradas.filter(x => x.c.gravidade === 'critico').map(({ c, evid }) => {
    const r = resumoCurto(evid)                                                     // o resumo é só reforço: se tropeçar no auditor, sai o resumo, não o alerta
    return { rotulo: c.rotulo, canal_rotulo: c.canal_rotulo, desde: c.desde, dias: c.dias, desde_aproximado: c.desde_aproximado, resumo: r && !violacao(r, rxN) && !segunda(r, ctx2) ? r : '' }
  })
  if (ctx.pendenciasFalhou) avisos.push('Pendências do cliente indisponíveis nesta geração: o relatório usou a lista de tarefas e de estoque anterior')

  // ── 4. Próximos passos (SÓ data futura) ──────────────────────────────────────────────────────────────────────
  const cand = []                                                                 // { quando, fim?, rotulo, origem, radar? }
  const grupoAcao = new Map()
  for (const a of planoTodas) {
    if (!['aprovada', 'distribuida'].includes(a.status) || !regraOk(a.regra) || !ehData(a.prazo) || a.prazo < hoje || a.prazo > fimRadar) continue
    // combinado com o cliente que não se faz: não é próximo passo — exceto Ads acima do ACOS alvo combinado (acosDaAcao: a ação ads_* gravada com o alvo já é "acima")
    if (al && al({ item: a.item_id || '', regra: a.regra, acao: a.id, acos: acosDaAcao(a) }).sim) { conta('alinhado'); continue }
    const calendario = a.regra === 'calendario'
    if (!calendario && a.prazo > fim14) continue
    const canal = canalNome(a.canal)
    if (calendario) {
      const bruto = String(a.titulo ?? ''), data = /\((\d{2}\/\d{2})\/\d{4}\)/.exec(bruto)?.[1]          // a data da ocasião ("27/11") é conteúdo, não sufixo a limpar
      const base = limpar(bruto.replace(/\s*\(\d{2}\/\d{2}\/\d{4}\)/, ''), canal), t = data && !ehGenerico(base) ? `${base} (${data})` : base
      if (ehGenerico(t)) { conta('proximos_descartados'); continue }
      cand.push({ quando: a.prazo, rotulo: a.prazo > fim14 ? `No radar: ${lcFirst(t)}` : t, origem: 'calendario', radar: a.prazo > fim14, aprovada: a.status === 'aprovada' })
      continue
    }
    const bruto = String(a.titulo ?? ''), i = bruto.indexOf(': ')
    const prefixo = i > 0 ? limpar(bruto.slice(0, i), canal) : '', k = `${a.prazo}|${a.regra}|${prefixo ? chaveTitulo(prefixo) : chaveTitulo(limpar(bruto, canal))}`
    const g = grupoAcao.get(k) || grupoAcao.set(k, { quando: a.prazo, prefixo, unico: limpar(bruto, canal), n: 0, aprovada: true }).get(k)
    g.n++
    if (a.status !== 'aprovada') g.aprovada = false
  }
  for (const g of grupoAcao.values()) {
    const rotulo = g.n > 1 && g.prefixo && !ehGenerico(g.prefixo) ? `${g.prefixo} em ${g.n} anúncios` : g.unico
    if (ehGenerico(rotulo)) { conta('proximos_descartados'); continue }
    cand.push({ quando: g.quando, rotulo, origem: 'acao', aprovada: g.aprovada })
  }
  // tarefas com data planejada: o card distribuído do plano (sufixo PS-…) é a MESMA coisa que a ação — nunca aparece duas vezes; reposição vai em "Depende de você"
  const tarefasFut = []
  let vencidas = 0
  for (const p of abertas) {
    if (p.status !== 'nao_iniciada' && p.status !== 'andamento') continue
    const d = ehData(p.data_planejada) ? p.data_planejada : null
    if (!d) continue
    if (d < hoje) { vencidas++; continue }
    if (d > fim14 || p.status === 'andamento') continue
    if (idPS(p.titulo) || /\brepor\b|reposi[çc]/i.test(p.titulo) || /^relat[óo]rio\b/i.test(String(p.titulo).trim())) continue
    tarefasFut.push({ ...p, d })
  }
  if (vencidas) avisos.push(`${vencidas} tarefa(s) aberta(s) com data planejada vencida (não aparecem ao cliente)`)
  let agenda = null
  if (lista) {
    const gT = new Map()
    for (const p of tarefasFut) {
      const canal = canalNome(p.processo), rotulo = limpar(p.titulo, canal)
      if (ehGenerico(rotulo)) { conta('proximos_descartados'); continue }
      const k = chaveTitulo(rotulo), g = gT.get(k) || gT.set(k, { rotulo, quando: p.d, fim: p.d, n: 0 }).get(k)
      g.n++; if (p.d < g.quando) g.quando = p.d; if (p.d > g.fim) g.fim = p.d
    }
    for (const g of gT.values()) cand.push({ quando: g.quando, ...(g.fim !== g.quando ? { fim: g.fim } : {}), rotulo: g.n > 1 ? `${g.rotulo} (${g.n} tarefas)` : g.rotulo, origem: 'tarefa' })
  } else if (tarefasFut.length) {
    const p7 = tarefasFut.filter(p => p.d <= somarDias(hoje, 7)).length, p8 = tarefasFut.length - p7, total = tarefasFut.length
    const partes = [p7 && `${p7} nos próximos 7 dias`, p8 && `${p8} na semana seguinte`].filter(Boolean).join(', ')
    agenda = { p7, p8_14: p8, total, ate: fim14, resumo: `${total} ${total === 1 ? 'ação já agendada' : 'ações já agendadas'} pela equipe (${partes})` }
  }
  for (const p of promos) {                                                       // promoção programada / fim da campanha em vigor
    if (p.status === 'pending' && p.inicio >= hoje && p.inicio <= fim14) cand.push({ quando: p.inicio, ...(p.fim && p.fim > p.inicio ? { fim: p.fim } : {}), rotulo: `Início da promoção: ${p.tipo}`, origem: 'promocao' })
    else if (p.status === 'started' && p.fim && p.fim >= hoje && p.fim <= fim14) cand.push({ quando: p.fim, rotulo: `Fim da promoção em vigor: ${p.tipo}`, origem: 'promocao' })
  }
  const ORDEM_ORIGEM = ['promocao', 'acao', 'tarefa', 'calendario']
  const unicos = [], jaVisto = new Set()                                          // dedupe por data + texto; vale a 1ª (a de maior prioridade de origem)
  for (const c of cand.sort((a, b) => a.quando.localeCompare(b.quando) || ORDEM_ORIGEM.indexOf(a.origem) - ORDEM_ORIGEM.indexOf(b.origem))) {
    const k = `${c.quando}|${chaveTitulo(c.rotulo)}`
    if (!jaVisto.has(k)) { jaVisto.add(k); unicos.push(c) }
  }
  // `previsto`: o prazo de uma ação só APROVADA (ainda não distribuída como tarefa) é meta da equipe, não compromisso agendado — a página diz "previsto". Radar já é provisório pelo texto.
  const itensProx = unicos.filter(c => !c.radar).slice(0, L.proximos).map(({ radar, aprovada, ...c }) => aprovada ? { ...c, previsto: true } : c)
  const radar = unicos.filter(c => c.radar).slice(0, L.radar).map(({ radar: _, aprovada: __, ...c }) => c)
  const proximos = { itens: itensProx, radar, agenda, vazio: itensProx.length || radar.length || agenda ? null : `Sem datas futuras confirmadas para os próximos ${cfg.horizonte_dias} dias.` }

  // ── 0. Abertura (colorida pelo RESULTADO, nunca pelo semáforo de prazo) ─────────────────────────────────────────
  const nPontos = limpas.length || depende.itens.length                           // com pendências do avaliador conta elas (todas, mesmo as além do teto); sem, a lista anterior
  const nudge = nPontos ? `${nPontos === 1 ? '1 ponto aguarda' : `${nPontos} pontos aguardam`} o seu retorno — veja Depende de você`
    : itensProx.length ? `Próximo marco: ${dm(itensProx[0].quando)} — ${itensProx[0].rotulo}` : ''
  const est = s.desempenho?.estado
  let abertura
  if (!mlOk) {
    abertura = { tom: 'cinza', cabecalho: marcaML || s.meli_conectado ? 'Números do Mercado Livre indisponíveis' : 'Números de vendas indisponíveis', frase: resultados.motivo, nudge }
  } else if (!est || est.estado === 'sem_base' || !nv(est.variacao_pct) || !nv(est.janela_dias)) {
    abertura = { tom: 'cinza', cabecalho: 'Sem base de comparação', frase: 'Ainda não há base de comparação suficiente para a leitura da conta; nada foi estimado.', nudge }
  } else {
    const tom = { crescimento: 'verde', estagnacao: 'amarelo', queda: 'laranja' }[est.estado] || 'cinza'
    const nomeEstado = { crescimento: 'crescimento', estagnacao: 'estagnação', queda: 'queda' }[est.estado] || 'sem leitura'
    const m0 = est.estado === 'queda' ? (s.desempenho.queda?.motivos || []).find(m => !m.interno && m.k !== 'difusa' && m.rotulo) : null
    const causa = m0 ? seg(`${m0.tipo === 'fato' ? 'Causa mais provável' : 'Hipótese principal'}: ${lcFirst(String(m0.rotulo))}.`, '', 'causas') : ''
    // o estado da conta é lido em 14 dias x 14; a tabela abaixo é de 7 dias fechados: quando as janelas diferem, a frase diz isso para os dois números não parecerem contradição
    const fat = resultados.linhas?.find(l => l.chave === 'faturamento')
    const sete = fat?.variacao && est.janela_dias !== 7 ? ` Na tabela abaixo, só os 7 dias fechados: faturamento ${fat.variacao.texto}.` : ''
    abertura = { tom, cabecalho: `Conta em ${nomeEstado}${est.forca === 'forte' ? ' forte' : ''}`,
      frase: `Faturamento ${sinalPct(est.variacao_pct)} nos últimos ${est.janela_dias} dias (${fmtMoeda(est.receita?.atual)} contra ${fmtMoeda(est.receita?.anterior)})${est.dentro_do_ruido ? '; oscilação dentro do normal' : ''}.${sete}${causa ? ' ' + causa : ''}`, nudge }
  }

  // ── modo ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const temAtividade = atividades.concluido.total > 0 || atividades.andamento.total > 0 || noAr.length > 0
  const temProximos = itensProx.length > 0 || radar.length > 0 || !!agenda
  const temOutroConteudo = temAtividade || temProximos || nPontos > 0 || devRes.length > 0 || mudancas.length > 0
  const modo = mlOk ? 'completo' : temOutroConteudo ? 'sem_resultados' : 'vazio'
  if (modo === 'vazio') qualidade.motivos.push('Nada a informar nesta semana: sem números do canal, sem atividades, sem próximos passos e sem pendências do cliente')

  // ── rodapé ───────────────────────────────────────────────────────────────────────────────────────────────────
  const rodape = [
    `Últimos ${cfg.janela.dias} dias fechados: ${J.rotulo}${mlOk ? `, comparados com ${J.rotulo_anterior}. O dia de hoje não entra na comparação` : ''}.`,
    '“—” significa que o dado não foi coletado nesta semana; nunca é zero.',
    'Leitura indicativa dos números; não representa promessa de resultado futuro. A associação entre ações e números não prova causa.',
  ]
  const avisoML = mlOk && ml.aviso ? seg(motivoCliente(ml.aviso, ''), '', 'rodape') : ''                    // único trecho dinâmico do rodapé: checado por nome na origem
  if (avisoML) rodape.push(/[.!?]$/.test(avisoML) ? avisoML : avisoML + '.')
  if (mlOk && ml.fonte === 'manual' && !ml.aviso) rodape.push('Os números do Mercado Livre foram informados pela equipe a partir do painel do canal.')
  for (const a of s.avisos || []) avisos.push(a)                                  // avisos do motor (erros do ML etc.): só no _interno

  return {
    versao: 1, cliente, hoje, hora,
    janela: { de: J.de, ate: J.ate, anterior: J.anterior, rotulo: J.rotulo },
    titulo: `${cfg.titulo_prefixo} · ${J.rotulo}`,
    modo, qualidade, abertura, alertas, resultados, atividades, desenvolvimento, proximos, depende,
    rodape,
    _interno: { avisos, omitidos },
  }
}

// ── fábrica: o que depende de banco/rede entra por aqui (molde: criarDependencias) ─────────────────────────────────
// deps: montarSemanal(args) · hoje() 'AAAA-MM-DD' · agora() ISO · lerAcoes({clientes,status}) · eventos(cliente,{de,ate}) → Map · inicioHistorico(cliente)
//       negocioHoje(cliente, dia) → { faturamento, vendas } · listarOfertas?(cliente) (só se o motor não trouxe) · nomesInternos(cliente) → string[] · limiarRupturaDias?
//       pendencias?: { avaliar(cliente, { hoje }) → { itens: Pendencia[] } } — o avaliador único (pendencias-cliente.js); sem ele ou se falhar, o relatório usa a lista anterior de "Depende de você"
//       alinhado?(cliente, dia) → predicado do núcleo dos alinhamentos com o cliente: mudança de anúncio alinhado sai rotulada ("conforme alinhado em dd/mm") ou omitida;
//         reposição de anúncio alinhado e próximo passo coberto saem (omitidos.alinhado)
export function criarBrief({ montarSemanal, hoje, agora, lerAcoes, eventos, inicioHistorico, negocioHoje, listarOfertas, nomesInternos, limiarRupturaDias, pendencias, alinhado, cfg = cfgBrief }) {
  async function gerar(cliente, opts = {}) {
    if (typeof cliente !== 'string' || !cliente.trim() || /^\[Comercial\]\s/.test(cliente.trim())) throw erro('cliente inválido')   // prospect nunca é cliente
    const c = cliente.trim()
    const dia = opts.hoje ?? hoje()
    const J = janelaDoRelatorio(dia, cfg)                                          // valida o formato E a data real ANTES de qualquer chamada ao motor (RangeError de toISOString)
    const agoraIso = opts.agora ?? agora()
    if (isNaN(new Date(agoraIso))) throw erro('horário de geração inválido')
    const semanal = await montarSemanal({ cliente: c, de: J.de, ate: J.ate, interno: false, leve: true })
    const acoesPlano = (await lerAcoes({ clientes: [c], status: ['aprovada', 'distribuida'] })) || []
    const evs = (await eventos(c, { de: J.de, ate: J.ate })) ?? new Map()
    const ini = (await inicioHistorico(c)) ?? null
    const nomes = (await nomesInternos?.(c)) || []
    let ofertas
    if (!semanal?.ofertas && listarOfertas) { try { ofertas = await listarOfertas(c) } catch { ofertas = undefined } }
    let hojeNegocio = null                                                         // o dia em andamento é cortesia: falhou/demorou = a linha some
    if (negocioHoje && semanal?.meli_conectado && semanal?.resultados?.ml?.fonte === 'api' && J.ate < dia) {
      let t
      try {
        const r = await Promise.race([Promise.resolve(negocioHoje(c, dia)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error('tempo')), cfg.hoje_timeout_ms) })])
        if (r && r.disponivel !== false && nv(r.faturamento) && nv(r.pedidos ?? r.vendas)) hojeNegocio = { faturamento: r.faturamento, pedidos: r.pedidos ?? r.vendas }
      } catch { hojeNegocio = null } finally { clearTimeout(t) }
    }
    let pend = [], pendenciasFalhou = false                                        // leitura local, sem Mercado Livre: se falhar, o curto sai como antes (e o aviso fica no _interno)
    if (pendencias?.avaliar) { try { pend = (await pendencias.avaliar(c, { hoje: dia }))?.itens || [] } catch { pend = []; pendenciasFalhou = true } }
    const brief = projetarBrief(semanal, { cliente: c, hoje: dia, hora: horaSP(agoraIso), acoesPlano, eventos: evs, inicioHistorico: ini, hojeNegocio, nomes, ofertas, limiarRupturaDias, pendencias: pend, pendenciasFalhou,
      alinhado: alinhado ? alinhado(c, dia) : null, cfg })
    const violacoes = auditarBrief(brief, { nomes })
    if (violacoes.length) throw new BriefInseguro(violacoes)                      // 2ª camada: o que escapou da limpeza na origem NUNCA segue adiante (mensagem sem eco)
    return brief
  }
  return { gerar }
}
