// Relatório Semanal Place2u (v2) — layout editorial premium, estruturado por PERFIL do cliente.
// Contrato de dados: docs/relatorio-semanal-contrato.md (r.perfil, r.resultados, r.atividades,
// r.tarefas_resultado, r.situacao + campos legados: acoes, otimizacoes, atencao, plano, graficos...).
// inline=true  → evidências em base64 (arquivo standalone para enviar ao cliente).
// interno=true → acrescenta AO FINAL o checklist de coleta e a checagem de prontidão (uso da equipe).
// Regras de honestidade: sem número inventado ("—" + motivo), "causa provável" nunca "comprovada",
// MEDIDO (motor de atribuição) separado de INFORMADO (campos do card), canal sem API só mostra dado informado.
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ROOT } from './env.js'
import { ehFrio, resolverArquivo } from './frio.js'
import { FONTES, CSS, esc, brData, capa, barraPlano, secTitulo, rodape } from './estilo-editorial.js'
import { criarSecoesResultado } from './render-semanal-resultados.js'
import { linhasDePendencia, ordemPendencias } from './pendencias-texto.js'   // texto único das pendências do cliente (o mesmo do relatório curto, do sprint e do plano)

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
// Só http(s) vira link: esc() não neutraliza "javascript:" em href/src.
const urlOk = u => { const s = String(u ?? '').trim(); return /^https?:\/\//i.test(s) ? s : '' }
const link = (u, html) => urlOk(u) ? `<a href="${esc(urlOk(u))}" target="_blank" rel="noopener">${html}</a>` : html
// "Print" = imagem ou PDF (bloco 'file' só quando o arquivo é imagem/PDF). Bookmark/embed é LINK de anúncio (vira chip via
// linksDeAnuncio em semanal.js), nunca miniatura nem contagem de print; planilha/vídeo também não é print. semanal.js usa a mesma regra.
export const ehPrint = ev => ev?.tipo === 'image' || ev?.tipo === 'pdf'
  || (ev?.tipo === 'file' && /\.(png|jpe?g|gif|webp|pdf)(\?|#|$)/i.test(String(ev.arquivo_local || ev.url_origem || '')))
// motivo que vai ao cliente: nome de arquivo/config, "transcrito" ou erro cru de API (código HTTP) nunca saem — falha fechada no genérico
export const RX_JARGAO = /metricas-semanais|config\/|\.json\b|transcrit|\bAPI\b[^.]*\bretornou\b|\bretornou\s+\d{3}\b|\b(HTTP|status)\s*\d{3}\b/i
const paraCliente = (t, generico) => { const s = String(t ?? '').trim(); return s && RX_JARGAO.test(s) ? generico : s }
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s
const MOTIVO_GENERICO = 'Os números deste bloco não estão disponíveis nesta geração do relatório; nada foi estimado.'

function srcEv(ev, inline) {
  // anexo no armazenamento frio (autogestão A4): embutido se a pasta do Drive estiver acessível; senão a caixa 📎, nunca <img> quebrada
  if (ehFrio(ev.arquivo_local)) { const p = resolverArquivo(ev.arquivo_local), mime = MIME[extname(ev.arquivo_local).toLowerCase()]; return p && mime ? `data:${mime};base64,${readFileSync(p).toString('base64')}` : null }
  if (ev.arquivo_local) {
    let arquivo = ev.arquivo_local
    let mime = MIME[extname(arquivo).toLowerCase()]
    if (!mime && existsSync(join(ROOT, 'data', arquivo + '.png'))) {
      arquivo += '.png'; mime = 'image/png'   // miniatura da 1ª página do PDF
    }
    if (!mime) return null   // arquivo sem prévia → caixa 📎, nunca <img> quebrada
    if (inline) {
      const p = join(ROOT, 'data', arquivo)
      return existsSync(p) ? `data:${mime};base64,${readFileSync(p).toString('base64')}` : null
    }
    return `/${arquivo}`
  }
  return ev.tipo === 'image' ? urlOk(ev.url_origem) || null : null
}

const ICONE = { recebido: '✓', parcial: '△', faltando: '✕', opcional: '·' }
const ROTULO = { recebido: 'Recebido', parcial: 'Parcial', faltando: 'Faltando', opcional: 'Opcional' }

// ── formatação: nada de NaN/undefined/zero-como-fato — sem valor finito, "—" ─
const num = v => typeof v === 'number' && Number.isFinite(v)
const fmtNum = v => num(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'
const fmtMoeda = v => num(v) ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const fmtPct = v => num(v) ? fmtNum(v) + '%' : '—'
const valorFmt = m => !num(m.valor) ? '—' : m.unidade === 'moeda' ? fmtMoeda(m.valor) : m.unidade === 'pct' ? fmtPct(m.valor) : fmtNum(m.valor)
const plural = (n, um, varios) => `${fmtNum(n)} ${n === 1 ? um : varios}`
const corta = (s, n) => {
  s = String(s ?? '')
  if (s.length <= n) return s
  const i = s.lastIndexOf(' ', n)
  return s.slice(0, i > n * 0.6 ? i : n).trimEnd() + '…'
}
// delta no formato do contrato: { valor, bom, pontos }
const badge = d => {
  if (!d || !num(d.valor)) return ''
  const seta = d.valor > 0 ? '▲' : d.valor < 0 ? '▼' : '='
  return ` <span class="comp ${d.valor === 0 ? 'igual' : d.bom ? 'bom' : 'ruim'}">${seta} ${fmtNum(Math.abs(d.valor))}${d.pontos ? ' pontos' : '%'}</span>`
}
const chips = links => {
  const l = (links || []).filter(x => urlOk(x?.url))
  if (!l.length) return ''
  const vistos = {}
  return `<div class="chips">${l.map(x => {
    vistos[x.rotulo] = (vistos[x.rotulo] || 0) + 1
    const n = l.filter(y => y.rotulo === x.rotulo).length > 1 ? ` ${vistos[x.rotulo]}` : ''
    return `<a class="chip" href="${esc(urlOk(x.url))}" target="_blank" rel="noopener">🔗 Ver anúncio — ${esc(x.rotulo)}${n}</a>`
  }).join('')}</div>`
}
// JSON dentro de <script>: "<" escapado para que um nome de canal nunca feche a tag.
const jsonSeguro = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

// ── perfil: padrão só entra se r.perfil faltar (geração antiga). O normal vem de perfil-cliente.js ─
// ponytail: espelha o perfil "analítico"; fonte da verdade é config/perfis-cliente.json
const REGRAS_PADRAO = {
  densidade: 'completa', provas: 'completa', linguagem: 'padrao', tom: 'neutro', glossario: false, metodologia: true,
  graficos: true, tabela_otimizacoes: true, mostrar_equipe: false, links_abertos: false, situacao_da_conta: false,
  metricas_extras: false, max_acoes: 0, max_resultados: 0, max_otimizacoes: 0,
  lista_tarefas: true,   // geração antiga, sem r.perfil: mantém a lista de tarefas como sempre foi
}
// miniaturas por escopo: tarefas que geraram resultado / ações concluídas / prints de canal
const PROVAS = { completa: { tarefas: Infinity, acoes: Infinity, canais: Infinity }, media: { tarefas: 2, acoes: 1, canais: 2 }, minima: { tarefas: 1, acoes: 0, canais: 0 } }
// promoções do Mercado Livre (seller-promotions): status e tipo da API → rótulo do cliente; tipo desconhecido = "Outra promoção"
export const STATUS_OFERTA = { started: 'Ativa', pending: 'Programada' }
export const TIPO_OFERTA = { SMART: 'Campanha do Mercado Livre', DEAL: 'Oferta do dia/Campanha', LIGHTNING: 'Relâmpago', UNHEALTHY_STOCK: 'Acelere o estoque (Full)',
  PRICE_DISCOUNT: 'Desconto no preço', SELLER_CAMPAIGN: 'Campanha do vendedor', SELLER_COUPON_CAMPAIGN: 'Cupom do vendedor',
  MARKETPLACE_CAMPAIGN: 'Campanha do marketplace', PRICE_MATCHING: 'Preço competitivo' }

// ── textos por linguagem (padrao | simples | tecnica) ───────────────────
const T_BASE = {
  resSub: 'Mercado Livre, anúncios (Ads) e demais canais — números do período, cada um com a sua fonte.',
  volSub: 'Quanto trabalho foi feito na semana e como ele se distribui.',
  tarSub: 'Tarefas concluídas com efeito medido ou informado, conforme o objetivo do cliente.',
  notaMedido: '“Medido” é a comparação antes × depois feita com os dados do canal: aponta a causa provável, não uma prova. “Informado” é o resultado registrado pela equipe no card.',
  acoesSub: 'O que saiu do papel — com evidência anexada no card correspondente.',
  otimSub: 'O que foi otimizado, alterado ou melhorado — e o efeito que a equipe registrou no card (informado, não medido).',
  atencaoSub: 'O que pede decisão ou ação — sem eufemismo.',
  certeza: 'Confiança',
}
const T_ENXUTA = {
  notaMedido: '“Medido”: causa provável, comparando antes e depois. “Informado”: registrado pela equipe no card.',
}
const T_SIMPLES = {
  resSub: 'Quanto você vendeu, quanto veio dos anúncios e o que aconteceu nos outros canais — com a explicação de cada número no fim deste bloco.',
  volSub: 'Quanto trabalho a equipe fez na semana.',
  tarSub: 'Tarefas que a equipe terminou e que provavelmente ajudaram o seu objetivo.',
  notaMedido: '“Medido” quer dizer que comparamos as vendas de antes e depois da tarefa — é a explicação mais provável, não uma garantia. “Informado” quer dizer que a equipe anotou o resultado no card.',
  acoesSub: 'O que foi feito nesta semana, com o print que mostra o trabalho.',
  otimSub: 'O que foi melhorado nos anúncios e o efeito que a equipe anotou no card.',
  atencaoSub: 'O que precisa de uma decisão ou de uma ação.',
  certeza: 'Grau de certeza',
}
const T_TECNICA = {
  resSub: 'Métricas por canal, com variação sobre o período anterior de mesma duração, fórmulas e fonte do dado.',
  tarSub: 'Tarefas com efeito medido (associação temporal ajustada por controle e placebo) ou informado (campo do card).',
  notaMedido: 'Medido: efeito antes × depois da conclusão, ajustado por grupo de controle e ruído histórico — associação temporal, causa provável, sem prova experimental. Informado: campo do card, sem medição automática.',
}

// ── siglas, "por que importa" e fórmulas (texto de apoio fixo, nunca dado) ─
const SIGLAS = {
  ROAS: 'retorno: quanto volta em vendas para cada R$ 1 gasto em anúncios',
  ACOS: 'quanto do valor vendido pelos anúncios foi gasto neles',
  TACOS: 'quanto do faturamento total foi gasto em anúncios',
  CTR: 'de cada 100 exibições, quantas viraram clique',
  CPC: 'quanto custa cada clique',
}
const IMPORTA = [
  [/roas/i, 'Mostra se o dinheiro investido em anúncios está voltando em vendas.'],
  [/tacos/i, 'Mostra o peso dos anúncios sobre todo o faturamento, não só sobre o que veio deles.'],
  [/acos/i, 'Quanto menor, menos se gasta em anúncio para cada real vendido por ele.'],
  [/\bctr\b/i, 'Mostra se o anúncio chama atenção o bastante para ser clicado.'],
  [/\bcpc\b/i, 'Mostra quanto cada visita vinda de anúncio custa.'],
  [/invest/i, 'É o dinheiro que saiu para anunciar; precisa ser lido junto com o que voltou.'],
  [/impress/i, 'Mostra o alcance: quantas vezes o anúncio foi exibido.'],
  [/clique/i, 'Mostra quantas pessoas se interessaram o bastante para clicar.'],
  [/atribu/i, 'Mostra quanto da venda passou por um anúncio patrocinado.'],
  [/conver/i, 'Mostra quantos visitantes viram compradores; pequenas melhorias aqui vendem mais sem precisar de mais visitas.'],
  [/visita/i, 'É a porta de entrada: sem visita não há venda.'],
  [/ticket|pre[cç]o.?m[eé]dio/i, 'Mostra quanto cada venda rende, em média.'],
  [/cancel|devol/i, 'Venda cancelada é dinheiro que não entra; acompanhar ajuda a achar a causa.'],
  [/unidad/i, 'Mostra o volume físico vendido, independentemente do preço.'],
  [/faturamento|receita/i, 'É o total vendido no período — a medida mais direta do tamanho do negócio.'],
  [/venda/i, 'Mostra quantos pedidos foram fechados.'],
]
const FORMULAS = [
  [/roas/i, 'receita atribuída ÷ investimento'],
  [/tacos/i, 'investimento em Ads ÷ faturamento total × 100'],
  [/acos/i, 'investimento ÷ receita atribuída × 100'],
  [/\bctr\b/i, 'cliques ÷ impressões × 100'],
  [/\bcpc\b/i, 'investimento ÷ cliques'],
  [/conver/i, 'vendas ÷ visitas × 100 (variação em pontos percentuais)'],
  [/unidade.*(ticket|pre[cç]o)|(ticket|pre[cç]o).*unidade/i, 'faturamento ÷ unidades'],
  [/ticket|pre[cç]o.?m[eé]dio/i, 'faturamento ÷ vendas'],
]
const casa = (tabela, m) => { const t = `${m.chave ?? ''} ${m.rotulo ?? ''}`; return tabela.find(([rx]) => rx.test(t))?.[1] || '' }

// ── blocos ──────────────────────────────────────────────────────────────
const rotuloMetrica = (x, m) => {
  const t = String(m.rotulo ?? m.chave ?? '')
  return esc(t) + (x.simples ? siglasNovas(x, t) : '')
}
// siglas explicadas só na 1ª vez em que aparecem no relatório (linguagem simples)
function siglasNovas(x, texto) {
  const novas = Object.entries(SIGLAS).filter(([s]) => new RegExp(`\\b${s}\\b`).test(texto) && !x.siglas.has(s))
  novas.forEach(([s]) => x.siglas.add(s))
  return novas.length ? ` <span class="sigla">(${esc(novas.map(([s, d]) => `${s} = ${d}`).join('; '))})</span>` : ''
}
function tile(x, m, cls) {
  const sem = !num(m.valor)
  const f = x.regras.metricas_extras ? casa(FORMULAS, m) : ''
  return `<div class="met${cls ? ' ' + cls : ''}${sem ? ' sem-dado' : ''}"><div class="v"><span class="n">${valorFmt(m)}</span>${sem ? '' : badge(m.delta)}</div>
    <div class="r">${rotuloMetrica(x, m)}</div>${f ? `<div class="formula">= ${esc(f)}</div>` : ''}</div>`
}
function selo(c) {
  const f = c.fonte
  const partes = []
  if (f === 'api') partes.push(`dados da API do ${c.canal}`)
  else if (f === 'manual') partes.push('informado pela equipe')
  else if (f === 'print' || c.prints) partes.push('print do painel')
  if (c.tem_api === false) partes.push('canal sem integração via API')
  if (!partes.length) partes.push('sem dado neste período')
  const cls = f === 'api' ? 'api' : (f === 'manual' || f === 'print' || c.prints) ? 'manual' : 'sem'
  return `<span class="selo ${cls}">${esc(partes.join(' · '))}</span>`
}
// bloco de um canal: cabeçalho + selo da fonte + motivo + grade COMPLETA de métricas ("—" quando sem valor)
function blocoCanal(x, c) {
  const vis = (c.metricas || []).filter(m => m && (x.regras.metricas_extras || !m.extra))
  x.exibidas.push(...vis)
  // "—" na grade + o porquê: motivos iguais são agrupados (nunca uma linha por tile). Bloco indisponível (c.motivo) mostra UM
  // motivo, o do bloco: o motivo por métrica só vale quando o bloco tem dado e aquela métrica não veio (contrato).
  const grupos = new Map()
  if (!c.motivo) for (const m of vis) if (!num(m.valor) && m.motivo) {
    const mot = paraCliente(m.motivo, 'não disponível nesta geração do relatório')
    grupos.set(mot, [...(grupos.get(mot) || []), String(m.rotulo ?? m.chave ?? '')])
  }
  const motivos = [c.motivo ? cap(paraCliente(c.motivo, MOTIVO_GENERICO)) : (!vis.some(m => num(m.valor)) && !grupos.size ? 'Sem dado informado para este período.' : ''),
    ...[...grupos].map(([mot, nomes]) => nomes.length === vis.length ? cap(mot) : `${nomes.join(', ')}: ${mot}`)]
    .filter((t, i, a) => t && a.indexOf(t) === i)
  const H = c.h || 3
  return `<div class="${c.tag}">
    <div class="canal-cab"><h${H}>${esc(c.canal)}</h${H}>${selo(c)}</div>
    ${motivos.map(t => `<p class="motivo">△ ${esc(t)}</p>`).join('')}
    ${vis.length ? `<div class="met-grade">${vis.map(m => tile(x, m, c.cls)).join('')}</div>` : '<p class="vazio">— Nenhuma métrica neste bloco.</p>'}
    ${paraCliente(c.aviso, '') ? `<div class="aviso">△ ${esc(paraCliente(c.aviso, ''))}</div>` : ''}
    ${c.extra || ''}
  </div>`
}

function secResultados(x) {
  const { r, regras } = x
  const R = r.resultados || {}
  const per = R.periodo || {}, ant = R.anterior
  const mostraListas = regras.links_abertos || regras.densidade === 'completa'   // produtos mais vendidos / ofertas ativas
  const prov = x.prov

  // destaques positivos (parceria: em evidência com texto próprio)
  const dest = (R.destaques || []).filter(d => d?.rotulo).slice(0, regras.densidade === 'enxuta' ? 3 : 5)
  const rel = (R.acoes_relacionadas || []).filter(Boolean)
  const destaques = dest.length ? `
  <div class="destaques">
    <span class="eyebrow" style="color:var(--sage)">Resultados em destaque</span>
    <h3>${regras.tom === 'parceria' ? 'O que melhorou na sua conta' : 'O que melhorou nesta semana'}</h3>
    ${dest.map(d => `<div class="destaque-item"><span>${esc(d.rotulo)}</span>${badge(d.delta)}</div>`).join('')}
    ${regras.lista_tarefas && rel.length && regras.densidade !== 'enxuta' ? `<div class="relacionadas"><b>Ações executadas no mesmo período:</b> ${esc(rel.join(' · '))}</div>` : ''}
  </div>` : ''

  const ml = R.ml || { canal: 'Mercado Livre', metricas: [], motivo: 'Resultados do Mercado Livre não disponíveis nesta geração do relatório.' }
  const ads = R.ads || { canal: 'Mercado Livre Ads', metricas: [], motivo: 'Resultados de Ads não disponíveis nesta geração do relatório.' }
  const adsAcoes = (ads.acoes || r.ads?.acoes || []).filter(Boolean)
  // prints de canal: o perfil limita as miniaturas (excedente vira "+ N prints no card", inclusive com 0); canal cuja ÚNICA
  // fonte é o print mostra ao menos 1 — o número está nele, e o motivo do bloco diz isso
  const provasCanal = (evs, fonte) => x.thumbs(evs, fonte === 'print' ? Math.max(1, prov.canais) : prov.canais)
  const temPrint = evs => (evs || []).some(ehPrint)

  const tabelaProdutos = mostraListas && r.produtos_top?.length ? `<p style="margin-top:14px"><span class="rotulo">Produtos mais vendidos</span></p>
    <table><thead><tr><th>Produto</th><th style="width:80px">Unidades</th><th style="width:110px">Receita</th></tr></thead>
    <tbody>${r.produtos_top.map(p => `<tr><td>${link(p.url, esc(p.titulo))}</td><td>${fmtNum(p.unidades)}</td><td>${fmtMoeda(p.receita)}</td></tr>`).join('')}</tbody></table>` : ''
  // promoções: só ativas (started) e programadas (pending), em português; candidata/encerrada ficam fora. Contagem = linhas exibidas.
  const o = r.ofertas
  const ofertas = o?.disponivel ? (o.promocoes || []).filter(p => STATUS_OFERTA[String(p?.status).toLowerCase()])
    .map(p => ({ ...p, status: String(p.status).toLowerCase() })).sort((a, b) => (a.status !== 'started') - (b.status !== 'started')) : []
  const nProg = ofertas.filter(p => p.status === 'pending').length, nAtivas = ofertas.length - nProg
  const tabelaOfertas = mostraListas && ofertas.length ? `<p style="margin-top:14px"><span class="rotulo">${nProg ? 'Ofertas ativas e programadas' : 'Ofertas ativas'} no Mercado Livre</span> &nbsp;${[nAtivas && plural(nAtivas, 'ativa', 'ativas'), nProg && plural(nProg, 'programada', 'programadas')].filter(Boolean).join(' · ')}</p>
    <table><thead><tr><th>Tipo</th><th>Situação</th><th style="width:90px">Início</th><th style="width:90px">Fim</th></tr></thead>
    <tbody>${ofertas.map(p => `<tr><td>${esc(TIPO_OFERTA[String(p.tipo).toUpperCase()] || 'Outra promoção')}</td><td>${STATUS_OFERTA[p.status]}</td><td>${esc(brData(p.inicio))}</td><td>${esc(brData(p.fim))}</td></tr>`).join('')}</tbody></table>
    ${num(o.total) && o.total > (o.promocoes || []).length ? `<div class="tab-mais">Consulta limitada às ${fmtNum((o.promocoes || []).length)} primeiras das ${fmtNum(o.total)} promoções da conta; outras ativas podem não aparecer aqui.</div>` : ''}` : ''

  const mlHtml = blocoCanal(x, {
    tag: 'canal-bloco ml fixo', canal: ml.canal || 'Mercado Livre', fonte: ml.fonte, motivo: ml.motivo, aviso: ml.aviso, metricas: ml.metricas,
    prints: temPrint(r.evidMetricas),
    extra: tabelaProdutos + provasCanal(r.evidMetricas, ml.fonte),
  })
  const adsHtml = blocoCanal(x, {
    tag: 'canal-bloco ads fixo', cls: 'ads', canal: ads.canal || 'Mercado Livre Ads', fonte: ads.fonte, motivo: ads.motivo, aviso: ads.aviso, metricas: ads.metricas,
    prints: temPrint(r.ads?.evidencias),
    extra: (adsAcoes.length && regras.lista_tarefas ? `<p style="font-size:13px"><span class="rotulo">Campanhas e ações da semana</span> &nbsp;${esc(adsAcoes.join(' · '))}</p>` : '')
      + provasCanal(r.ads?.evidencias, ads.fonte) + tabelaOfertas,
  })
  const outros = (R.outros || []).filter(c => c?.canal)
  const subs = outros.map(c => blocoCanal(x, {
    tag: 'sub-canal', h: 4, cls: 'outros', canal: c.canal, fonte: c.fonte, tem_api: c.tem_api, motivo: c.motivo, aviso: c.aviso, metricas: c.metricas,
    prints: temPrint(c.evidencias),
    extra: (num(c.acoes_semana) && regras.lista_tarefas ? `<p class="mono acoes-canal">${plural(c.acoes_semana, 'AÇÃO CONCLUÍDA', 'AÇÕES CONCLUÍDAS')} NO CANAL NA SEMANA</p>` : '')
      + provasCanal(c.evidencias, c.fonte),
  }))
  const outrosHtml = `<div class="canal-bloco outros">
    <div class="canal-cab"><h3>Outros canais</h3><span class="selo sem">${outros.length ? 'só dado informado — sem integração via API' : 'nenhum outro canal'}</span></div>
    ${subs.length ? subs.join('') : '<p class="vazio">Nenhum outro canal além do Mercado Livre aparece nas tarefas desta semana.</p>'}
  </div>`

  // dia em andamento (periodo_parcial, frente DADOS): o período atual não tem a mesma duração do anterior — dizer até que hora vai
  const parcial = R.periodo_parcial?.ate_hora ? `INCLUI HOJE ATÉ ${esc(R.periodo_parcial.ate_hora)} (DIA EM ANDAMENTO)` : ''
  const comp = `<p class="mono comp-linha">${per.de ? `PERÍODO ${esc(brData(per.de))} A ${esc(brData(per.ate))} · ` : ''}${ant?.de
    ? `VARIAÇÕES ▲▼ COMPARAM COM ${esc(brData(ant.de))} A ${esc(brData(ant.ate))}, ${parcial || 'DE MESMA DURAÇÃO'}`
    : `SEM PERÍODO ANTERIOR PARA COMPARAR${parcial ? ` · ${parcial}` : ''}`}</p>`

  return `<section data-sec="resultados">
  ${secTitulo(x.n(), 'Resultados', x.T.resSub)}
  ${comp}
  ${destaques}
  ${mlHtml}${adsHtml}${outrosHtml}
  ${regras.glossario ? glossario(x) : ''}
</section>`
}

function glossario(x) {
  const vistos = new Set(), linhas = []
  for (const m of x.exibidas) {
    const k = String(m.rotulo ?? m.chave ?? '').trim().toLowerCase()   // por rótulo: "ROAS" do ML Ads e "ROAS" da Shopee (ads_roas) são o mesmo termo
    if (vistos.has(k)) continue
    vistos.add(k)
    const imp = casa(IMPORTA, m)
    if (!m.explicacao && !imp) continue
    linhas.push(`<dt>${esc(m.rotulo)}</dt><dd>${m.explicacao ? `<span class="significa"><b>O que significa:</b> ${esc(m.explicacao)}</span>` : ''}${imp ? `<span class="importa"><b>Por que importa:</b> ${esc(imp)}</span>` : ''}</dd>`)
  }
  return linhas.length ? `<div class="glossario"><span class="eyebrow">Glossário</span><h3>O que cada número significa</h3><dl>${linhas.join('')}</dl></div>` : ''
}

function secVolume(x) {
  const { r, regras } = x
  const A = r.atividades
  const cnt = v => fmtNum(v)
  const stat = (n, lbl, sub, cls = '') => `<div class="stat"><div class="num${cls ? ' ' + cls : ''}">${n}</div><div class="lbl">${esc(lbl)}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`
  let corpo
  if (!A) {
    corpo = '<p class="vazio">— Volume de atividades indisponível nesta geração do relatório.</p>'
  } else {
    const c = A.concluidas || {}, ce = A.com_evidencia || {}
    const subConc = [num(c.anterior) ? `semana anterior: ${fmtNum(c.anterior)}` : 'sem semana anterior para comparar', num(c.pct) ? badge({ valor: c.pct, bom: c.pct > 0 }) : ''].join(' ')
    const risco = v => num(v) ? (v > 0 ? 'risco' : 'bom') : ''
    corpo = `<div class="stats">
      ${stat(cnt(c.atual), 'Ações concluídas', subConc)}
      ${stat(cnt(A.otimizacoes), 'Otimizações')}
      ${stat(cnt(A.acoes_ads), 'Ações de Ads')}
      ${stat(cnt(A.em_andamento), 'Em andamento')}
      ${stat(cnt(A.atrasadas), 'Atrasadas', '', risco(A.atrasadas))}
      ${stat(cnt(A.bloqueadas), 'Bloqueadas', '', risco(A.bloqueadas))}
      ${A.depende_cliente > 0 ? stat(cnt(A.depende_cliente), 'Aguardando você') : ''}
      ${stat(num(ce.n) && num(ce.de) && ce.de > 0 ? `${fmtNum(ce.n)}/${fmtNum(ce.de)}` : '—', 'Com print anexado', num(ce.pct) ? `${fmtNum(ce.pct)}% das concluídas` : '')}
    </div>`
  }
  const pc = (A?.por_canal || r.graficos?.por_canal || []).filter(c => c?.canal && num(c.n))
  const max = Math.max(1, ...pc.map(c => c.n))
  const porCanal = !pc.length ? '<p class="vazio">Sem distribuição por canal neste período.</p>'
    : regras.densidade === 'enxuta'
      ? `<p class="por-canal-linha"><span class="rotulo">Ações concluídas por canal</span> &nbsp;${pc.map(c => `${esc(c.canal)} <b>${fmtNum(c.n)}</b>`).join(' · ')}</p>`
      : `<div class="por-canal"><p class="rotulo">Ações concluídas por canal</p>
    ${pc.map(c => `<div class="linha"><span>${esc(c.canal)}</span><span class="barra"><i style="width:${Math.round(100 * c.n / max)}%"></i></span><b>${fmtNum(c.n)}</b></div>`).join('')}</div>`

  const eq = (A?.equipe || []).filter(e => e?.nome)
  const equipe = regras.mostrar_equipe ? `<div class="equipe"><p class="rotulo">Quem cuidou da sua conta</p>${eq.length
    ? `<ul>${eq.map(e => `<li><b>${esc(e.nome)}</b> — ${plural(e.n, 'ação concluída', 'ações concluídas')}</li>`).join('')}</ul>`
    : '<p class="vazio">Nenhum responsável registrado nas ações concluídas.</p>'}</div>` : ''

  // gráficos só com regras.graficos: faturamento semanal e ações por canal (nunca "entregas por dia")
  const hist = (r.graficos?.faturamento_hist || []).filter(h => num(h?.faturamento) && typeof h.de === 'string')
  const graf = regras.graficos && (pc.length || hist.length)
  if (graf) x.script = scriptGraficos({ por_canal: pc, faturamento_hist: hist })

  return `<section data-sec="volume"${graf ? '' : ' class="sec-curta"'}>
  ${secTitulo(x.n(), 'Volume de atividades', x.T.volSub)}
  ${corpo}
  ${porCanal}
  ${equipe}
  ${graf ? `<div class="grade-2" style="margin-top:18px">
    ${pc.length ? '<div class="grafico-caixa"><canvas id="gCanais"></canvas><div class="explica">AÇÕES DA SEMANA POR CANAL.</div></div>' : ''}
    ${hist.length ? '<div class="grafico-caixa"><canvas id="gFat"></canvas><div class="explica">FATURAMENTO SEMANAL — evolução das últimas semanas registradas.</div></div>' : ''}
  </div>` : ''}
</section>`
}

function scriptGraficos(G) {
  return `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0"></script>
<script>
const G = ${jsonSeguro(G)};
const C = { ink:'#1a1612', accent:'#ff6b1a', accentDeep:'#d4550e', sage:'#5f7355', gold:'#b8924a', blood:'#c0392b', cinza:'#8a8378' }
if (window.Chart) {
  if (window.ChartDataLabels) Chart.register(ChartDataLabels)
  Chart.defaults.animation = false   // pintura síncrona: o PDF nunca captura gráfico pela metade
  Chart.defaults.font.family = "'Inter',sans-serif"
  Chart.defaults.color = C.ink
  if (Chart.defaults.plugins.datalabels) Chart.defaults.plugins.datalabels.display = false
  Chart.defaults.font.size = 11
  const grade = { color: 'rgba(26,22,18,.07)' }
  const brDia = d => d.slice(8, 10) + '/' + d.slice(5, 7)
  const corCanal = [C.accent, C.sage, C.gold, C.blood, C.cinza, C.accentDeep]
  const elCanais = document.getElementById('gCanais')
  if (elCanais) new Chart(elCanais, {
    type: 'doughnut',
    data: { labels: G.por_canal.map(x => x.canal), datasets: [{ data: G.por_canal.map(x => x.n), backgroundColor: G.por_canal.map((_, i) => corCanal[i % corCanal.length]), borderColor: '#fffdfa', borderWidth: 3 }] },
    options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } },
      datalabels: { display: true, color: '#fff', font: { weight: 700 } } } }
  })
  const elFat = document.getElementById('gFat')
  if (elFat) new Chart(elFat, {
    type: 'bar',
    data: { labels: G.faturamento_hist.map(x => 'sem. ' + brDia(x.de)), datasets: [{ label: 'Faturamento', data: G.faturamento_hist.map(x => x.faturamento), backgroundColor: C.sage, borderRadius: 3, maxBarThickness: 44 }] },
    options: { plugins: { legend: { display: false },
      datalabels: { display: true, anchor: 'end', align: 'top', font: { weight: 700 }, formatter: v => 'R$ ' + Math.round(v).toLocaleString('pt-BR') } },
      scales: { y: { beginAtZero: true, grace: '15%', grid: grade, ticks: { callback: v => 'R$ ' + Number(v).toLocaleString('pt-BR') } }, x: { grid: { display: false } } } }
  })
}
</script>`
}

function itemResultado(x, it) {
  const { regras } = x
  const medido = it.tipo === 'medido'   // qualquer outro valor é tratado como informado (nunca promove a "medido")
  const baixa = it.confianca && (it.confianca.nivel === 'baixa' || (num(it.confianca.pct) && it.confianca.pct < 40))
  const m = it.metrica || {}
  const cf = it.confianca
  const enxuta = regras.densidade === 'enxuta'
  const titulo = regras.links_abertos ? link(it.url, esc(it.titulo)) : esc(it.titulo)
  const resumo = it.resumo ? (enxuta ? corta(it.resumo, 110) : it.resumo) : ''
  const provas = x.thumbs(it.evidencias, x.prov.tarefas)
  return `<div class="entrega resultado" data-resultado="1"><div class="res-txt">
    <h3>${titulo}</h3>
    <div class="lm">
      <span class="tag ${!medido ? 't-informado' : baixa ? 't-hipotese' : 't-medido'}">${!medido ? 'Informado pela equipe' : baixa ? 'Medido · hipótese, confiança baixa' : it.confianca ? 'Medido · causa provável' : 'Medido · observação direta'}</span>
      ${it.canal ? `<span class="tag t-proc">${esc(it.canal)}</span>` : ''}
      ${it.responsavel ? `<span>${esc(it.responsavel)}</span>` : ''}${it.concluida_em ? `<span>${esc(brData(it.concluida_em))}</span>` : ''}
      ${regras.links_abertos && urlOk(it.url) ? link(it.url, 'card no Notion ↗') : ''}
    </div>
    <div class="res-metrica"><span class="rotulo">${esc(m.rotulo ?? 'Resultado')}${x.simples ? siglasNovas(x, String(m.rotulo ?? '')) : ''}</span><div class="res-valor">${esc(m.texto ?? '—')}</div></div>
    ${resumo ? `<p>${esc(resumo)}</p>` : ''}
    ${cf && cf.nivel ? `<p class="mono confianca">${esc(x.T.certeza.toUpperCase())}: ${esc(String(cf.nivel).toUpperCase())}${num(cf.pct) ? ` (${fmtNum(cf.pct)}/100)` : ''}</p>` : ''}
    ${regras.metodologia && it.metodo ? `<p class="metodo"><span class="rotulo">Como medimos</span> &nbsp;${esc(it.metodo)}</p>` : ''}
    ${regras.links_abertos ? chips(it.links) : ''}
  </div>${provas ? `<div class="res-prova">${provas}</div>` : ''}</div>`
}

function secTarefas(x) {
  const { r, regras } = x
  const TR = r.tarefas_resultado || {}
  const itens = Array.isArray(TR.itens) ? TR.itens.filter(i => i?.titulo) : []
  const lim = regras.max_resultados > 0 ? regras.max_resultados : Infinity
  const obj = TR.objetivo || r.perfil?.objetivo
  const cont = [
    num(TR.sem_efeito) && TR.sem_efeito > 0 ? `${plural(TR.sem_efeito, 'tarefa medida', 'tarefas medidas')} SEM EFEITO DISTINGUÍVEL` : '',
    num(TR.em_maturacao) && TR.em_maturacao > 0 ? `${fmtNum(TR.em_maturacao)} AINDA SEM JANELA PARA MEDIR` : '',
  ].filter(Boolean)
  const metodologia = regras.metodologia ? metodologiaBox(x) : ''
  return `<section data-sec="tarefas">
  ${secTitulo(x.n(), 'Tarefas que geraram resultado', x.T.tarSub)}
  ${obj?.rotulo ? `<p class="objetivo">Objetivo acompanhado: <b>${esc(obj.rotulo)}</b></p>` : ''}
  <p class="nota-honesta">${esc(x.T.notaMedido)}</p>
  ${itens.length ? itens.slice(0, lim).map(it => itemResultado(x, it)).join('')
    : `<p class="vazio">${esc(TR.nota || 'Nenhuma tarefa com resultado medido ou informado nesta semana.')}</p>`}
  ${itens.length > lim ? `<div class="tab-mais">+ ${plural(itens.length - lim, 'tarefa com resultado não exibida', 'tarefas com resultado não exibidas')} neste resumo.</div>` : ''}
  ${itens.length && TR.nota ? `<p class="vazio">${esc(TR.nota)}</p>` : ''}
  ${cont.length ? `<p class="mono cont-linha">${cont.join(' · ')}</p>` : ''}
  ${metodologia}
</section>`
}

function metodologiaBox(x) {
  const R = x.r.resultados || {}, per = R.periodo, ant = R.anterior, hora = R.periodo_parcial?.ate_hora
  return `<div class="metodologia"><span class="rotulo">Como medimos</span>
  <ul>
    ${per?.de && ant?.de ? `<li><b>Período:</b> ${esc(brData(per.de))} a ${esc(brData(per.ate))}, comparado com ${esc(brData(ant.de))} a ${esc(brData(ant.ate))} (${hora ? `inclui hoje até ${esc(hora)} — dia em andamento` : 'mesma duração'}).</li>` : ''}
    <li><b>Fontes:</b> API do Mercado Livre quando a conta está conectada; números informados pela equipe e prints dos painéis nos demais casos. Canais sem integração via API só mostram dado informado.</li>
    <li><b>Resultado medido:</b> compara a janela antes e depois da conclusão da tarefa (com defasagem para o canal reindexar), desconta o que aconteceu com anúncios da mesma conta que não foram mexidos e compara com as oscilações normais da conta. É associação ajustada: indica a causa provável, sem pretender provar causa e efeito.</li>
    <li><b>Confiança:</b> nota de 0 a 100 que pesa ordem no tempo, corroboração por visitas, intensidade do efeito, histórico do tipo de tarefa e ausência de explicação concorrente. Critério sem dado sai da conta.</li>
    <li><b>Resultado informado:</b> registrado pela equipe nos campos do card; não passa pelo cálculo acima.</li>
  </ul></div>`
}

function secAcoes(x) {
  const { r, regras } = x
  const acoes = r.acoes || []
  const lim = regras.max_acoes > 0 ? regras.max_acoes : Infinity
  const lista = acoes.slice(0, lim)
  const enxuta = regras.densidade === 'enxuta', media = regras.densidade === 'media'
  const tit = a => regras.links_abertos ? link(a.url, esc(a.titulo)) : esc(a.titulo)
  let corpo
  if (!acoes.length) {
    corpo = `<p class="vazio">Nenhuma ação concluída registrada neste período${x.interno ? ' — verifique status e datas de conclusão no Notion' : ''}.</p>`
  } else if (enxuta) {
    corpo = `<table><thead><tr><th>Ação</th><th style="width:120px">Canal</th><th style="width:110px">Quem</th><th style="width:78px">Data</th><th style="width:44px">Print</th></tr></thead>
    <tbody>${lista.map(a => `<tr data-acao="1"><td>${tit(a)}</td><td>${esc(a.processo)}</td><td>${esc(a.responsavel)}</td><td>${esc(brData(a.data))}</td>
      <td>${(a.evidencias || []).some(ehPrint) ? '✓' : '—'}</td></tr>`).join('')}</tbody></table>`
  } else {
    corpo = lista.map(a => `
  <div class="entrega" data-acao="1">
    <h3>${esc(a.titulo)}</h3>
    <div class="lm">
      <span class="tag t-concluida">Concluída</span>
      <span class="tag t-proc">${esc(a.processo)}</span>
      <span>${esc(a.responsavel)}</span><span>${esc(brData(a.data))}</span>
      ${a.url ? link(a.url, 'card no Notion ↗') : ''}
    </div>
    ${a.descricao && !media ? `<p>${esc(a.descricao)}</p>` : ''}
    ${a.resultado ? `<p><span class="rotulo">Resultado informado</span> &nbsp;${esc(a.resultado)}</p>` : ''}
    ${a.impacto ? `<p><span class="rotulo">Impacto informado</span> &nbsp;${esc(a.impacto)}</p>` : ''}
    ${chips(a.links)}
    ${x.thumbs(a.evidencias, x.prov.acoes)}
  </div>`).join('')
  }
  return `<section data-sec="acoes">
  ${secTitulo(x.n(), 'Ações concluídas na semana', x.T.acoesSub)}
  ${corpo}
  ${acoes.length > lim ? `<div class="tab-mais">+ ${plural(acoes.length - lim, 'ação concluída não listada', 'ações concluídas não listadas')} neste resumo.</div>` : ''}
</section>`
}

function secOtimizacoes(x) {
  const { r, regras } = x
  if (!regras.tabela_otimizacoes) return ''
  const ot = r.otimizacoes || []
  const lim = regras.max_otimizacoes > 0 ? regras.max_otimizacoes : Infinity
  return `<section data-sec="otimizacoes">
  ${secTitulo(x.n(), 'Otimizações da semana', x.T.otimSub)}
  ${ot.length ? `<table>
    <thead><tr><th>Otimização / melhoria</th><th style="width:120px">Frente</th><th>O que mudou</th><th>Efeito informado pela equipe</th></tr></thead>
    <tbody>${ot.slice(0, lim).map(o => `<tr>
      <td><b>${esc(o.titulo)}</b>${o.evidencias ? ` <span class="mono" style="font-size:9px;color:var(--sage)">✓ ${esc(o.evidencias)} print(s)</span>` : ''}</td>
      <td>${esc(o.processo)}</td>
      <td>${esc(o.mudanca || '—')}</td>
      <td>${esc(o.efeito || '— não informado no card')}</td></tr>`).join('')}</tbody>
  </table>
  ${ot.length > lim ? `<div class="tab-mais">+ ${ot.length - lim} otimização(ões) detalhadas nas ações concluídas.</div>` : ''}
  ${r.efeito_vendas ? `<div class="dep" style="border-left-color:var(--sage);background:#eef2e9;color:#3c4a33">
    <b>Registro da equipe sobre o resultado da semana (informado):</b> ${esc(r.efeito_vendas)}</div>` : ''}`
    : '<p class="vazio">Nenhuma otimização concluída no período.</p>'}
</section>`
}

function secAtencao(x) {
  const { r, regras } = x
  // cliente que não prioriza a lista de tarefas não recebe atraso/bloqueio interno/"sem print": só o que depende DELE
  const atencao = regras.lista_tarefas ? (r.atencao || []) : (r.atencao || []).filter(p => /depende de voc/i.test(p.tipo))
  const itens = atencao.map(p => {
    // semanal.js grava '—' quando o card não tem responsável; o prazo não se repete se o texto já o traz ("(prazo 01/10/2026)")
    // "Depende de você" não mostra responsável nem prazo: a cobrança é do consultor e o texto já traz "desde"
    const resp = String(p.responsavel ?? '').trim().replace(/^[—–-]$/, '')
    const quem = /depende de voc/i.test(p.tipo) ? '' : [resp ? esc(resp) : 'responsável a definir',
      p.prazo && !String(p.texto ?? '').includes(brData(p.prazo)) ? `prazo ${esc(brData(p.prazo))}` : ''].filter(Boolean).join(' · ')
    const texto = regras.links_abertos ? link(p.url, esc(p.texto)) : esc(p.texto)
    return `<li><b>${esc(p.tipo)}:</b> ${texto}${quem ? ` <span class="quem">— ${quem}</span>` : ''}</li>`
  })
  if (regras.links_abertos) {   // proativo: o que depende do cliente fica visível, com o card clicável (sem repetir o que a atenção já trouxe)
    const jaTem = p => atencao.some(a => /depende de voc/i.test(a.tipo) && ((a.url && a.url === p.url) || String(a.texto ?? '').includes(p.titulo)))
    for (const p of (r.proximos || [])) if (p.dependencia_cliente && !jaTem(p))
      itens.push(`<li class="depende"><b>Depende de você:</b> ${link(p.url, esc(p.titulo))} — ${esc(p.dependencia_cliente)}</li>`)
  }
  return `<section data-sec="atencao" class="sec-curta">
  ${secTitulo(x.n(), 'Pontos de atenção', x.T.atencaoSub)}
  ${itens.length ? `<ul class="pt-atencao">${itens.join('')}</ul>` : '<p class="vazio">Nenhum ponto de atenção na semana. ✓</p>'}
</section>`
}

// Pontos que dependem do cliente, com a explicação: por que importa, o que acontece se atrasar, o que precisamos e o impacto possível (ou "não estimado").
// Só aparece com pendência (r.pendencias, do avaliador); o título NÃO repete a string "Depende de você", que o proativo já usa em "Pontos de atenção".
// Respeita a linguagem do perfil (rótulos das linhas); o texto das linhas é o do catálogo, igual nos quatro relatórios.
const SUB_PEND = {
  padrao: 'O que a equipe precisa receber para seguir, por que importa e o que está em jogo — só o que foi medido ou previsto.',
  simples: 'O que precisamos de você para seguir, por que isso importa e o que muda se demorar.',
  tecnica: 'Pendências por canal, com a premissa de cada estimativa e o impacto quando há medida ou previsão.',
}
const MAX_PEND = 8
function secPendencias(x) {
  const { r, regras } = x
  const todas = (Array.isArray(r.pendencias) ? r.pendencias : []).filter(p => p && typeof p === 'object' && p.rotulo).sort(ordemPendencias)
  if (!todas.length) return ''
  const ling = ['simples', 'tecnica'].includes(regras.linguagem) ? regras.linguagem : 'padrao', itens = todas.slice(0, MAX_PEND)
  return `<section data-sec="pendencias" class="sec-curta">
  ${secTitulo(x.n(), 'Pontos que dependem de você', SUB_PEND[ling])}
  ${itens.map(p => { const L = linhasDePendencia(p, { linguagem: ling }); return `<div class="pend ${esc(L.gravidade)}">
    <div class="pend-cab"><b>${esc(L.titulo)}</b><span class="pend-meta">${[L.canal, L.quando].filter(Boolean).map(esc).join(' · ')}</span></div>
    <dl>${L.linhas.map(l => `<dt>${esc(l.rotulo)}</dt><dd>${esc(l.texto)}</dd>`).join('')}</dl></div>` }).join('')}
  ${todas.length > itens.length ? `<div class="tab-mais">+ ${plural(todas.length - itens.length, 'ponto', 'pontos')} aguardando retorno, além dos acima.</div>` : ''}
</section>`
}

// semáforo derivado só de fatos; verde exige 0 atrasadas e 0 bloqueadas (confere aqui também)
const situacaoVerde = r => r.situacao?.nivel === 'ok' && !(r.atividades?.atrasadas > 0) && !(r.atividades?.bloqueadas > 0)
// atrasadas/bloqueadas vêm de UMA fonte na página inteira (r.atividades, a mesma do tile do Volume): situação, abertura e tile
// dizem os mesmos números (uma tarefa bloqueada com prazo vencido conta nas duas)
const pendencias = A => num(A?.atrasadas) && num(A?.bloqueadas) ? `atrasadas: ${fmtNum(A.atrasadas)} · bloqueadas: ${fmtNum(A.bloqueadas)}` : ''
function secSituacao(x) {
  const { r, regras } = x
  if (!regras.situacao_da_conta || !r.situacao) return ''
  const s = r.situacao, verde = situacaoVerde(r), A = r.atividades
  const titulo = !verde && (A?.atrasadas > 0 || A?.bloqueadas > 0) && pendencias(A) ? `Pontos em atenção — ${pendencias(A)}` : s.titulo
  return `<div class="situacao ${verde ? 'ok' : 'atencao'}" data-sec="situacao">
  <span class="eyebrow">Situação da conta em 1 olhar</span>
  <div class="semaforo"><span class="luz ${verde ? 'ok' : 'atencao'}"></span><b>${esc(titulo || (verde ? 'Tudo em dia' : 'Pontos em atenção'))}</b>
    <span class="selo ${verde ? 'api' : 'manual'}">${verde ? 'verde' : 'amarelo'}</span></div>
  ${(s.itens || []).length ? `<ul>${s.itens.map(i => `<li class="${i.tom === 'ok' ? 'ok' : 'atencao'}"><span class="ic">${i.tom === 'ok' ? '✓' : '△'}</span><span>${esc(i.texto)}</span></li>`).join('')}</ul>` : ''}
</div>`
}

// frase de abertura: curta, factual, sem promessa e sem adjetivo vazio
function abertura(x) {
  const { r, regras } = x
  const A = r.atividades || {}, per = r.identificacao?.periodo
  const n = A.concluidas?.atual
  const acoes = num(n) ? plural(n, 'ação concluída', 'ações concluídas') : ''
  const plano = r.plano?.total && num(r.plano.pct) ? `${r.plano.pct}% do plano do mês executado` : ''
  let t
  if (!regras.lista_tarefas) {   // relatório de resultados: abre pelo estado da conta, não pela contagem de ações
    const base = r.desempenho?.leitura || `Resumo dos resultados${per ? ` de ${per}` : ''}.`
    t = regras.tom === 'parceria' ? `Nesta semana, acompanhamos juntos como a sua conta está. ${base}`
      : regras.tom === 'tranquilizador' ? `Este é o retrato dos resultados da sua conta${per ? ` na semana de ${per}` : ''}. ${base}`
      : `${per ? `Semana de ${per}: ` : ''}${base}`
  } else if (regras.tom === 'parceria') {
    t = `Nesta semana, o time da Place2u ${num(n) ? `concluiu ${plural(n, 'ação', 'ações')} na sua conta` : 'trabalhou na sua conta'}. Abaixo estão os números da conta, o que foi feito e o que segue em andamento, para acompanharmos juntos.`
  } else if (regras.tom === 'tranquilizador') {
    const sit = r.situacao ? (situacaoVerde(r) ? ` Nenhuma tarefa atrasada ou bloqueada.${A.depende_cliente > 0 ? ` ${plural(A.depende_cliente, 'aguarda', 'aguardam')} um retorno seu.` : ''}`
      : pendencias(A) ? ` ${cap(pendencias(A))}.` : '') : ''
    t = `Este é o retrato da sua conta${per ? ` na semana de ${per}` : ' nesta semana'}: o que foi feito, o que está em andamento e o que pede atenção.${sit}`
  } else {
    const partes = [acoes, plano].filter(Boolean)
    t = partes.length ? `${per ? `Semana de ${per}` : 'Semana'}: ${partes.join(' e ')}.` : `Resumo da semana${per ? ` de ${per}` : ''}.`
  }
  return `<p class="abertura">${esc(t)}</p>`
}

function secInterno(x) {
  const { r } = x
  const pf = r.perfil
  return `<section class="interno" data-sec="interno">
  <div class="interno-tag">Uso interno — não enviar ao cliente</div>
  ${pf ? `<p class="mono" style="font-size:10px;margin-bottom:12px">PERFIL APLICADO: ${esc((pf.perfis || []).map(p => p.rotulo).join(' + ') || '—')} · OBJETIVO: ${esc(pf.objetivo?.rotulo || '—')}${pf.origem === 'padrao' ? ' · PADRÃO (CLIENTE SEM PERFIL SALVO)' : ''}${pf.override ? ' · OVERRIDE DESTA GERAÇÃO' : ''}</p>${(pf.avisos || []).map(a => `<div class="aviso">△ ${esc(a)}</div>`).join('')}` : ''}
  <div class="sec-titulo"><h2>Checklist de coleta</h2><div class="sub">Cada item auditado automaticamente a partir do Notion — nada aqui é preenchido à mão.</div></div>
  <table>
    <thead><tr><th style="width:26px">#</th><th style="width:230px">Item</th><th style="width:104px">Situação</th><th>Detalhe</th></tr></thead>
    <tbody>${(r.prontidao || []).map(i => `<tr><td class="mono">${esc(i.n)}</td><td><b>${esc(i.nome)}</b></td>
      <td><span class="tag t-${esc(i.estado)}">${ICONE[i.estado] ?? ''} ${esc(ROTULO[i.estado] ?? i.estado)}</span></td>
      <td>${esc(i.detalhe)}</td></tr>`).join('')}</tbody>
  </table>
  ${(r.avisos || []).map(a => `<div class="aviso">△ ${esc(a)}</div>`).join('')}
  <div class="verdict${r.pronto ? '' : ' alerta'}" style="margin-top:18px">
    <span class="eyebrow">Checagem de prontidão</span>
    <p>${r.pronto
      ? 'Todos os itens obrigatórios do checklist de coleta foram recebidos — relatório pronto para envio ao cliente.'
      : 'Há itens do checklist de coleta FALTANDO. Complete a coleta antes de enviar — relatório sem evidência é opinião.'}</p>
  </div>
</section>`
}

const CSS_SEMANAL = `
  canvas{max-height:250px}
  .grade-2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
  @media(max-width:720px){.grade-2{grid-template-columns:1fr}}
  .grafico-caixa .explica{font-family:'JetBrains Mono',monospace;font-size:9.5px;color:var(--rule);margin-top:8px;letter-spacing:.03em}

  /* abertura, situação da conta (semáforo) */
  .abertura{font-family:'Playfair Display',serif;font-size:17px;line-height:1.5;border-left:3px solid var(--accent);padding:4px 0 4px 18px;margin:0 0 26px}
  .situacao{border:1px solid rgba(42,37,32,.18);border-left:6px solid var(--sage);background:#fffdfa;padding:16px 22px;margin-bottom:28px}
  .situacao.atencao{border-left-color:var(--gold);background:#fdf8ea}
  .semaforo{display:flex;align-items:center;gap:12px;margin:8px 0 10px;font-family:'Playfair Display',serif;font-size:19px;flex-wrap:wrap}
  .luz{width:18px;height:18px;border-radius:50%;background:var(--sage);flex:none}
  .luz.atencao{background:var(--gold)}
  .situacao ul{list-style:none} .situacao li{font-size:13px;margin:5px 0;display:flex;gap:8px}
  .situacao li .ic{font-weight:700;width:14px;flex:none}
  .situacao li.ok .ic{color:var(--sage)} .situacao li.atencao .ic{color:#9a6b10}

  /* pontos que dependem do cliente */
  .pend{border:1px solid rgba(42,37,32,.14);border-left:4px solid var(--gold);background:#fffdfa;padding:12px 18px;margin-bottom:12px;break-inside:avoid;page-break-inside:avoid}
  .pend.critico{border-left-color:var(--blood)}
  .pend-cab{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
  .pend-meta{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--rule)}
  .pend dl{display:grid;grid-template-columns:160px 1fr;gap:4px 14px;font-size:12.5px;margin:0}
  .pend dt{font-weight:600;color:var(--rule)} .pend dd{margin:0}
  @media(max-width:640px){.pend dl{grid-template-columns:1fr}}

  /* resultados por canal */
  .comp-linha{font-size:9.5px;color:var(--rule);letter-spacing:.04em;margin:-4px 0 14px}
  .canal-bloco{background:#fffdfa;border:1px solid rgba(42,37,32,.12);border-top:3px solid var(--sage);padding:16px 18px 12px;margin-bottom:16px}
  .canal-bloco.ads{border-top-color:var(--gold)} .canal-bloco.outros{border-top-color:var(--accent)}
  .canal-cab{display:flex;justify-content:space-between;align-items:baseline;gap:6px 12px;flex-wrap:wrap;margin-bottom:10px}
  .canal-cab h3{font-size:18px} .canal-cab h4{font-family:'Playfair Display',serif;font-weight:500;font-size:16px}
  .selo{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;
    border:1px solid var(--rule);border-radius:3px;padding:2px 8px;color:var(--rule);white-space:nowrap}
  .selo.api{border-color:var(--sage);color:#3c4a33;background:#eef2e9}
  .selo.manual{border-color:var(--gold);color:#6b5320;background:#fbf3df}
  .selo.sem{border-style:dashed;color:var(--cinza)}
  .motivo{font-size:12px;color:var(--rule);margin:0 0 10px}
  .canal-bloco .met-grade{grid-template-columns:repeat(auto-fit,minmax(148px,1fr))} .met .v .n{white-space:nowrap}
  .met.sem-dado .v{color:var(--cinza)}
  .met .formula{font-family:'JetBrains Mono',monospace;font-size:8.5px;color:var(--rule);margin-top:5px;letter-spacing:.02em}
  .met .r .sigla{display:block;text-transform:none;letter-spacing:0;font-family:'Inter',sans-serif;font-size:10px;line-height:1.35;margin-top:3px;color:var(--rule)}
  .sub-canal{border-top:1px dashed rgba(42,37,32,.25);padding-top:12px;margin-top:12px}
  .acoes-canal{font-size:9.5px;letter-spacing:.06em;color:var(--rule);margin:6px 0}
  .glossario{background:var(--paper-deep);border-left:3px solid var(--accent);padding:16px 20px;margin-top:6px}
  .glossario h3{font-size:17px;margin:4px 0 10px}
  .glossario dl{display:grid;grid-template-columns:170px 1fr;gap:9px 16px;font-size:12px}
  .glossario dt{font-weight:700} .glossario dd span{display:block}
  .glossario .importa{color:var(--rule);margin-top:2px}
  @media(max-width:640px){.glossario dl{grid-template-columns:1fr}}

  /* volume de atividades */
  .por-canal{margin-top:14px}
  .por-canal .linha{display:grid;grid-template-columns:160px 1fr 34px;gap:10px;align-items:center;font-size:12px;margin:5px 0}
  .por-canal .barra{height:10px;background:rgba(26,22,18,.08);border-radius:5px;overflow:hidden;display:block}
  .por-canal .barra i{display:block;height:100%;background:var(--accent)}
  .equipe{margin-top:16px} .equipe ul{list-style:none;font-size:13px;margin-top:6px} .equipe li{margin:3px 0}

  /* tarefas que geraram resultado */
  .objetivo{font-size:13px;margin:0 0 10px}
  .nota-honesta{font-size:12px;color:var(--rule);background:var(--paper-deep);padding:9px 14px;margin-bottom:14px;border-left:3px solid var(--gold)}
  .entrega.resultado{border-top-color:var(--sage)}
  .res-metrica{margin:8px 0 6px}
  .res-valor{font-family:'Playfair Display',serif;font-size:27px;line-height:1.15;color:var(--ink)}
  .t-medido{background:var(--sage);color:var(--paper)} .t-informado{background:var(--gold);color:#fff} .t-hipotese{background:var(--cinza);color:#fff}
  .confianca{font-size:9.5px;letter-spacing:.07em;color:var(--rule)}
  .metodo{font-size:12px;color:var(--rule)}
  .quem{color:var(--rule);font-size:12px}
  .cont-linha{font-size:9.5px;letter-spacing:.05em;color:var(--rule);margin-top:10px}
  .metodologia{background:var(--paper-deep);border-left:3px solid var(--accent);padding:14px 20px;margin-top:14px;font-size:12px}
  .metodologia ul{list-style:none;margin-top:6px} .metodologia li{margin:6px 0}

  /* apêndice da equipe */
  .interno{border:2px dashed var(--blood);padding:20px 22px;margin-top:44px;break-before:page;page-break-before:always}
  .interno-tag{display:inline-block;background:var(--blood);color:#fff;font-family:'JetBrains Mono',monospace;font-size:10px;
    letter-spacing:.14em;text-transform:uppercase;padding:4px 12px;margin-bottom:14px}

  /* densidade enxuta (perfil direto): mesmo conteúdo, menos espaço */
  .enxuta{font-size:13px}
  .enxuta header.capa{padding:20px 0 14px;margin-bottom:18px} .enxuta .capa h1{font-size:34px}
  .enxuta .faixa{margin-bottom:16px!important} .enxuta .capa-meta{margin-top:12px;padding-top:8px}
  .enxuta section{margin-bottom:16px} .enxuta .sec-titulo .eyebrow{display:none} .enxuta .sec-titulo{margin-bottom:10px} .enxuta .sec-titulo h2{font-size:19px}
  .enxuta .abertura{font-size:15px;margin-bottom:16px}
  .enxuta .canal-bloco{padding:10px 14px 6px;margin-bottom:10px} .enxuta .met-grade{gap:8px;grid-template-columns:repeat(auto-fit,minmax(124px,1fr))}
  .enxuta .met{padding:8px 10px} .enxuta .met .v{font-size:17px}
  .enxuta .entrega{padding:10px 14px 8px;margin-bottom:10px} .enxuta .res-valor{font-size:21px}
  .enxuta .thumb,.enxuta .thumb-arquivo{width:120px} .enxuta .thumb img,.enxuta .thumb-arquivo{height:76px;width:120px}
  .enxuta .tagline,.enxuta .sec-titulo .sub{display:none} .enxuta .por-canal-linha{font-size:12px;margin-top:10px}
  .enxuta .stats{padding:10px 0;grid-template-columns:repeat(7,1fr);gap:8px} .enxuta .stat .num{font-size:24px}
  .enxuta .destaques{padding:10px 16px;margin-bottom:12px} .enxuta .destaque-item{padding:3px 0}
  .enxuta .sub-canal{padding-top:8px;margin-top:8px} .enxuta .motivo{margin-bottom:6px}
  .enxuta .entrega.resultado{display:flex;gap:14px;align-items:flex-start} .enxuta .res-txt{flex:1;min-width:0} .enxuta .res-prova{flex:none}
  .enxuta .res-prova .thumbs{margin-top:0}
  @media(max-width:640px){.enxuta .entrega.resultado{display:block}.enxuta .stats{grid-template-columns:repeat(auto-fit,minmax(96px,1fr))}}
  .enxuta .plano{padding:12px 16px;margin-bottom:16px} .enxuta tbody td{padding:6px 8px 6px 0}

  /* impressão: A4; blocos curtos nunca partem; títulos nunca ficam órfãos no pé da página */
  @page{size:A4;margin:10mm}
  .sec-curta,.met-grade,.sub-canal,.entrega,.plano,.situacao,.abertura,.destaques,.glossario,.metodologia,
  .grafico-caixa,.stats,.met,.thumb,.por-canal .linha,footer,tr,.nota-honesta,.sec-titulo,.canal-cab{break-inside:avoid;page-break-inside:avoid}   /* .sec-titulo é flex: sem isso o Chrome separa o rótulo da Seção do título */
  .sec-titulo,.canal-cab,.motivo{break-after:avoid;page-break-after:avoid}
  @media print{ .t-medido,.t-informado,.t-hipotese,.selo,.luz,.situacao{-webkit-print-color-adjust:exact;print-color-adjust:exact} }`

export function renderSemanal(r, opcoes = {}) {
  const inline = !!opcoes.inline, interno = !!opcoes.interno
  const regras = { ...REGRAS_PADRAO, ...(r.perfil?.regras || {}) }
  const simples = regras.linguagem === 'simples', tecnica = regras.linguagem === 'tecnica'
  const id = r.identificacao || {}
  const cliente = String(id.cliente || 'Cliente')

  // só prints (ehPrint): bookmark/embed vira chip de link, nunca caixa 📎. Limite 0 ("minima") ainda avisa "+ N prints no card".
  const thumbs = (evs, max = Infinity) => {
    const todas = (evs || []).filter(ehPrint), l = todas.slice(0, max)
    if (!todas.length) return ''
    const mais = todas.length > l.length ? `<div class="tab-mais">+ ${plural(todas.length - l.length, 'print', 'prints')} no card</div>` : ''
    if (!l.length) return mais
    return `<div class="thumbs">${l.map(ev => {
      const src = srcEv(ev, inline)
      const caixa = `<div class="thumb-arquivo">📎 ${ev.tipo === 'pdf' ? 'PDF' : ev.tipo === 'image' ? 'imagem' : 'arquivo'}</div>`
      const img = src ? `<img src="${esc(src)}" alt="${esc(ev.legenda || 'print')}" loading="lazy">` : caixa
      return `<div class="thumb">${!inline && ev.arquivo_local && !ehFrio(ev.arquivo_local) ? `<a href="/${esc(ev.arquivo_local)}" target="_blank">${img}</a>` : img}
        ${ev.legenda ? `<div class="leg">${esc(ev.legenda)}</div>` : ''}
        ${ev.criada_em ? `<div class="leg">${esc(brData(ev.criada_em))}</div>` : ''}</div>`
    }).join('')}</div>${mais}`
  }

  let cont = 0
  const x = {
    r, regras, inline, interno, simples, tecnica, thumbs,
    T: { ...T_BASE, ...(regras.densidade === 'enxuta' ? T_ENXUTA : {}), ...(simples ? T_SIMPLES : tecnica ? T_TECNICA : {}) },
    prov: PROVAS[regras.provas] || PROVAS.completa,
    exibidas: [], siglas: new Set(), script: '',
    n: () => String(++cont).padStart(2, '0'),   // numeração segue as seções que de fato aparecem
  }

  // perfil direto (densidade enxuta): resultados e atenção primeiro; os demais seguem a ordem do contrato
  const enxuta = regras.densidade === 'enxuta'
  // Cliente que PRIORIZA tarefas (regras.lista_tarefas): lista de tarefas + as seções de resultado. Os demais: só resultados —
  // faturamento, crescimento/queda, métricas da conta/Ads/Full, tarefas que geraram venda no detalhe, combinações, tarefa de cuidado, 80/20.
  const ordem = !regras.lista_tarefas
    ? ['situacao', 'resultados', 'desempenho', 'full', 'venda_detalhe', 'combos', 'pior', 'pareto', 'atencao', 'pendencias']
    : enxuta
      ? ['situacao', 'resultados', 'desempenho', 'tarefas', 'venda_detalhe', 'atencao', 'pendencias', 'volume', 'plano', 'acoes', 'otimizacoes', 'combos', 'pior', 'pareto', 'full']
      : ['situacao', 'resultados', 'desempenho', 'full', 'volume', 'plano', 'tarefas', 'venda_detalhe', 'acoes', 'otimizacoes', 'combos', 'pior', 'pareto', 'atencao', 'pendencias']
  const novas = criarSecoesResultado({ esc, num, fmtNum, fmtMoeda, urlOk, brData, secTitulo, plural, corta })
  const secoes = {
    situacao: secSituacao, resultados: secResultados, volume: secVolume, tarefas: secTarefas,
    acoes: secAcoes, otimizacoes: secOtimizacoes, atencao: secAtencao, pendencias: secPendencias,
    desempenho: novas.desempenho, full: novas.full, venda_detalhe: novas.venda_detalhe, combos: novas.combos, pior: novas.pior, pareto: novas.pareto,
    plano: x => barraPlano(r.plano, {
      extraHtml: r.plano_oficial?.length
        ? `PLANO OFICIAL DO MÊS (5W2H): ${r.plano_oficial.reduce((s, p) => s + (p.acoes || []).length, 0)} AÇÕES — ` +
          r.plano_oficial.map(p => p.url
            ? `<a href="${esc(urlOk(p.url))}" target="_blank" rel="noopener">${esc(p.canal)} (${(p.acoes || []).length}) ↗</a>`
            : `${esc(p.canal)} (${(p.acoes || []).length})`).join(' · ')
        : '',
    }),
  }
  const corpo = ordem.map(k => secoes[k](x)).join('\n')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório Semanal — ${esc(cliente)} · ${esc(id.periodo || '')}</title>
${FONTES}
<style>${CSS}${CSS_SEMANAL}${novas.CSS}
</style>
</head>
<body>
<div class="pagina${enxuta ? ' enxuta' : ''}">

${capa({
    documento: 'Relatório Semanal',
    titulo: cliente.replace(/\s*—.*$/, ''),
    tituloEm: cliente.includes('—') ? cliente.split('—').slice(1).join('—').trim() : '',
    subtitulo: `${(id.marketplaces || []).length ? id.marketplaces.join(' + ') : 'Marketplace a identificar'} · ${id.periodo || ''}`,
    meta: [
      `Tipo <b>${esc(id.tipo || 'Semanal')}</b>`,
      `Gerado em <b>${esc(id.gerado_em || '—')}</b>`,
      ...(interno ? [`Notion sincronizado <b>${esc(id.ultima_atualizacao || '—')}</b>`, 'Versão <b>uso interno</b>'] : []),
    ],
  })}

${abertura(x)}

${corpo}

${interno ? rodape(`Relatório Semanal · ${id.periodo || ''}`) : `<footer><span>Place2u · Performance Estratégica em Marketplaces</span><span>Relatório Semanal · ${esc(id.periodo || '')}</span><span>Fonte: Mercado Livre (API) e registros da Place2u</span></footer>`}
${interno ? secInterno(x) : ''}
</div>
${x.script}
</body></html>`
}
