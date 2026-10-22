// Gatilhos do Merovíngio ao cliente (docs/desenho-gatilhos-n8n.md, F1+F2): projeta fontes que JÁ existem (plano com caminho 'cliente', pendências por canal,
// estado da conta, saúde gravada, diagnóstico, change-log de preço, promoções) em itens de aviso e os agrupa em mensagens (1 lote = 1 mensagem).
// Decisões do David (12/10/2026): SÓ MERCADO LIVRE; ao cliente (grupo de WhatsApp do ML, e-mail ou Notion — Discord é canal INTERNO da equipe) vai o PLANO SEMANAL
// (lote 'semanal', TERÇA 09:00 no fuso do cliente desde as decisões finais de 12/10/2026 — antes segunda —, idempotente por semana ISO, texto de plano-semana-texto.js) e, entre um e outro, SÓ o urgente na hora (lote
// 'imediato', ritmo 'hora' no catálogo: ruptura A/B com ≤ urgente.ruptura_max_dias de estoque, despacho vencido, reclamação, reputação, anúncio restrito, queda por
// preço). O lote diário e o título «O que depende de você» acabaram: o não urgente do cliente entra no plano semanal.
// Decisões finais (12/10/2026): SÓ SEMANAL — o urgente na hora nasce DESLIGADO (ritmo.critico_na_hora = false) e o config trava o lote imediato (urgente.na_hora_ligado = false;
// os urgentes entram no plano de terça): nada sai sozinho fora da janela de terça; nenhum envio (automático, manual confirmado ou teste de canal) antes de config.inicio_envios; só cliente com integração ML de fato (integracao-ml.js, injetada como «integracao»).
// Liberação em lote (prepararLote): preenche o grupo «Id whatsapp meli» vazio pela central, liga o WhatsApp, mantém o urgente desligado e libera.
// NÃO é um segundo motor: nenhuma condição nasce aqui, só a leitura das fontes e o template fixo do catálogo (config/gatilhos.json).
// Molde de alerta-cliente.js: tudo injetado (handle better-sqlite3, fontes, relógio, auditor, envio); o autoteste roda em :memory:; a fiação real está em gatilhos-real.js.
// Regras: dedupe por (cliente, tipo, assinatura) viva + cooldown por tipo; texto auditado (relatorio-seguro) ANTES de gravar; chave global NASCE DESLIGADA; só cliente
// liberado por líder ou consultor da central, Ativo, com canal ligado e dentro da janela/silêncio no fuso dele (Intl) recebe; itens_json é interno e nunca sai; número/e-mail nunca vão a log.
// Limiares (cobertura crítica, lead time, reputação, Full antigo, impacto mínimo) vêm de config/algoritmo.json → limiares/foco: este módulo não tem número próprio de decisão.
// Resolução honesta: só a fonte lida com sucesso NESTA passada resolve item; «Resolvido: …» só quando não há item vivo do mesmo tipo; tipos de janela (preço, promoção) nunca "resolvem".
// Dono (pedido do David, 12/10/2026): ao cliente só vai o que DEPENDE do cliente (dono 'cliente' no catálogo). Dono 'assessoria' é detectado igual, fica no estado 'interno'
// (nunca entra em lote, prévia ou envio) e vira notificação interna 'aviso_assessoria' para a equipe. Mudança de preço só é «do cliente» com origem verificada (origemPreco).
// URGENTE DE ESTOQUE E PREÇO com impacto em R$ (pedido do David, 14/10/2026): com cfg.urgente.na_hora_ligado, o lote 'imediato' leva SÓ os tipos de cfg.urgente.tipos (ruptura,
// estoque zerado, compra, aumento de preço do cliente), 1 mensagem por cliente por dia com até teto.itens_urgente pontos, o impacto de cada ponto = previsão da regra do plano do
// item (acoes_plano.previsao_json) ou a MESMA fórmula sobre o diagnóstico (lead-time.riscoRuptura), produto avisado não volta antes de repeticao_dias salvo piora, e a liberação
// é automática pela regra registrada (cliente com integração ML, primeira coleta completa e grupo do ML; canal desligado de propósito fica fora). O plano semanal não muda.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ROOT } from './env.js'
import { auditarTexto, codigosDe } from './relatorio-seguro.js'
import { dataNoFuso, horaNoFuso, estadoDeHandle } from './relatorio-envio.js'
import { nomeCurto } from './pendencias-cliente.js'
import { idsDe } from './alerta-cliente.js'
import { SCHEMA_GATILHOS } from './gatilhos-schema.js'
import { acosDaAcao } from './alinhamentos.js'
import { janelaInteira as janela28, montarPlanoSemanal, montarUrgente, semFixos, auditarMensagem as auditarLinhas, nomesDe, diasTxt, TITULO, dividirMensagem, lerCfgRelatorio, foraDoAr, premissaCompras, PREMISSA_PRODUTO } from './plano-semana-texto.js'
import { MOTIVOS_INTEGRACAO } from './integracao-ml.js'
import { emRuptura, riscoRuptura } from './lead-time.js'
import { representaEstoque, estoqueDe, sufixoAnuncios, envioDoProprio } from './produto-estoque.js'   // V3 F3: 1 linha por estoque físico, números do produto; sem i.produto, nada muda

export { SCHEMA_GATILHOS }
export const CLASSES = ['critico', 'atencao', 'info']
// ritmo: 'hora' = urgente (lote imediato, cooldown por classe; sai na hora só com urgente.na_hora_ligado no config E ritmo.critico_na_hora no cliente, senão vai no plano); 'semanal' = entra no plano de terça; 'interno' = dono assessoria, nunca sai
export const RITMOS = ['hora', 'semanal', 'interno']
// canais AO CLIENTE (12/10/2026): o Discord do cliente é só da equipe (o cliente não está lá) — saiu daqui e virou o canal do aviso interno ao consultor
export const CANAIS_N8N = ['whatsapp', 'email']
export const CANAIS = [...CANAIS_N8N, 'notion']
export const TIPOS = ['ruptura_curva_a', 'estoque_zerado', 'ciclo_estoque_previsto', 'envio_full_sugerido', 'full_estoque_antigo', 'envio_atrasado', 'reclamacao_mediacao', 'perguntas_sem_resposta',
  'reputacao_em_risco', 'queda_forte_conta', 'queda_conta', 'preco_alterado_drastico', 'queda_por_preco', 'anuncio_restrito', 'oferta_terminando', 'ads_sem_retorno', 'custos_nao_informados', 'dependencia_vencida',
  'promocao_encerrada']
export const LOTES = ['imediato', 'semanal', 'compras']   // compras = micro-relatório de compras (15/10/2026): só pelo scripts/micro-compras.mjs, que passa o composer
export const DONOS = ['cliente', 'assessoria']
const VIVOS = ['pendente', 'agrupado', 'enviado', 'entregue', 'suprimido', 'falhou', 'interno']     // interno = só para a equipe (dono assessoria ou origem não verificada): nunca sai
const NIVEL_INTERNO = { critico: 'alerta', atencao: 'info', info: 'info' }
// mudança de preço feita FORA da assessoria: só o change-log da coleta/webhook do canal (ofertas, promo, acomp, ads e uma futura 'chaveiro' são do próprio sistema)
export const FONTES_PRECO_EXTERNAS = ['coleta', 'webhook']
const RANK = { critico: 0, atencao: 1, info: 2 }
const COLUNAS = ['classe', 'assinatura', 'itens_json', 'texto', 'estado', 'motivo', 'lote_id', 'canais_json', 'avisado_resolucao', 'enviado_em', 'entregue_em', 'resolvido_em', 'recibo_json']
const COLUNAS_LOTE = ['estado', 'motivo', 'canais_json', 'tentado_em', 'enviado_em', 'recibos_json', 'por', 'origem']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const WHATS = /^\d{8,25}@g\.us$/        // SÓ o grupo do cliente no Mercado Livre («Id whatsapp meli», JID …@g.us da Evolution): número ou contato digitado à mão nunca é destino (12/10)
const ALG = JSON.parse(readFileSync(join(ROOT, 'config', 'algoritmo.json'), 'utf-8')), LIM = ALG.limiares, FOCO = ALG.foco
const COB = { estado: 'estadoConta', preco: 'mudancasPreco' }                           // fonte do catálogo → chave de cobertura
const BLOCO_SAUDE = { envio_atrasado: 'atrasos', reclamacao_mediacao: 'reclamacoes', perguntas_sem_resposta: 'perguntas', reputacao_em_risco: 'reputacao', full_estoque_antigo: 'full' }
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/

// gatilho → regra do plano que ele projeta: o alinhamento com o cliente (src/lib/alinhamentos.js) fala a língua das regras; o predicado é a ÚNICA decisão de exceção
const REGRA_DO_TIPO = { ruptura_curva_a: 'estoque_ruptura', estoque_zerado: 'anuncio_restrito', ciclo_estoque_previsto: 'estoque_ruptura', envio_full_sugerido: 'full_envio', full_estoque_antigo: 'full_estoque_antigo',
  envio_atrasado: 'envio_atrasado', reclamacao_mediacao: 'reclamacao_sem_resposta', perguntas_sem_resposta: 'pergunta_sem_resposta', reputacao_em_risco: 'reputacao_em_risco',
  queda_forte_conta: 'queda_conta', queda_conta: 'queda_conta', preco_alterado_drastico: 'preco_mudou_vendas_cairam', queda_por_preco: 'preco_mudou_vendas_cairam', anuncio_restrito: 'anuncio_restrito', oferta_terminando: 'promocao_giro',
  ads_sem_retorno: 'ads_reduzir', custos_nao_informados: 'cadastrar_custos', dependencia_vencida: 'bloqueio_cliente', promocao_encerrada: 'preco_mudou_vendas_cairam' }
// linha de gatilho → ação do plano semanal que a contém (a linha só é marcada como enviada se a ação entrou no texto); os demais tipos semanais são blocos próprios
const BLOCO_DO_TIPO = { ruptura_curva_a: 'ruptura', ciclo_estoque_previsto: 'ciclo', full_estoque_antigo: 'parado', custos_nao_informados: 'custos' }
const NIVEL = { '5_green': 'verde', '4_light_green': 'verde-claro', '3_yellow': 'amarelo', '2_orange': 'laranja', '1_red': 'vermelho' }
// urgente de estoque e preço (14/10): o MESMO produto conta uma vez por família (avisado como ruptura não volta como «hora de pedir» na mesma semana, salvo piora)
// anuncio_restrito (⏸️ do plano) entra na família só para a memória do que foi dito: o pausado sem estoque avisado no plano não volta no urgente do dia seguinte (achado de 14/10)
const FAMILIA = { ruptura_curva_a: 'estoque', estoque_zerado: 'estoque', ciclo_estoque_previsto: 'estoque', anuncio_restrito: 'estoque', queda_por_preco: 'preco', preco_alterado_drastico: 'preco' }
const idDe = x => String(x?.id ?? x?.item_id ?? '')
// piora relevante desde o aviso: estoque zerou ou caiu para menos da metade da cobertura avisada; preço subiu de novo
export const piorou = (fam, cur, snap) => fam === 'estoque' ? (cur.estoque === 0 && snap.estoque !== 0) || (Number.isFinite(cur.cobertura) && Number.isFinite(snap.cobertura) && cur.cobertura < snap.cobertura / 2)
  : fam === 'preco' ? Number(cur.para) > Number(snap.para) + 0.005 : false
// impacto em R$ de uma linha (soma dos produtos dela): só com o número de TODOS os produtos que a linha DIZ (avisado:true = dito há pouco, fora do texto; sem dado = sem número, nunca zero inventado)
export function impactoDaLinha(itens) {
  const l = (Array.isArray(itens) ? itens : []).filter(x => x && !x.avisado)
  if (!l.length || !l.every(x => x.impacto && Number.isFinite(x.impacto.c) && Number.isFinite(x.impacto.b))) return null
  return { c: l.reduce((t, x) => t + x.impacto.c, 0), b: l.reduce((t, x) => t + x.impacto.b, 0), dias: Math.max(...l.map(x => x.impacto.dias || 0)), fonte: [...new Set(l.map(x => x.impacto.fonte))].join('+') }
}

// ── configuração (config/gatilhos.json), validada na carga ──────────────────────────────────────────────────────────────
const fusoValido = f => { try { new Intl.DateTimeFormat('en-CA', { timeZone: f }); return true } catch { return false } }
// {k} = valor; {k|singular|plural} = forma escolhida pelo número em vals[k] (o catálogo concorda «1 anúncio que vendia está» × «2 anúncios que vendiam estão»)
const preencher = (t, vals) => String(t).replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (m, k, um, varios) => Object.hasOwn(vals, k) ? (Number(vals[k]) === 1 ? um : varios) : m).replace(/\{(\w+)\}/g, (m, k) => Object.hasOwn(vals, k) ? String(vals[k]) : m)
export function validarConfig(c, { auditar = auditarTexto } = {}) {
  const falha = m => { throw new Error(`config/gatilhos.json: ${m}`) }
  if (!c || typeof c !== 'object' || Array.isArray(c)) falha('JSON inválido')
  if (!fusoValido(c.fuso_padrao)) falha('"fuso_padrao" precisa ser um fuso IANA válido')
  for (const k of ['inicio', 'fim']) if (!HHMM.test(String(c.janela?.[k]))) falha(`"janela.${k}" precisa ser HH:MM`)
  if (!(c.janela.inicio < c.janela.fim)) falha('"janela.inicio" precisa ser antes de "janela.fim"')
  if (!Number.isInteger(c.semanal?.dia_semana) || c.semanal.dia_semana < 0 || c.semanal.dia_semana > 6) falha('"semanal.dia_semana" precisa ser 0..6 (1 = segunda, 2 = terça)')
  // nenhum envio automático antes desta data (AAAA-MM-DD, no fuso do cliente); vazio/ausente = sem trava de início
  if (c.inicio_envios !== undefined && c.inicio_envios !== '' && !(/^\d{4}-\d{2}-\d{2}$/.test(String(c.inicio_envios)) && !Number.isNaN(Date.parse(c.inicio_envios + 'T12:00:00Z')))) falha('"inicio_envios" precisa ser AAAA-MM-DD (ou vazio)')
  for (const k of ['hora', 'ate']) if (!HHMM.test(String(c.semanal?.[k]))) falha(`"semanal.${k}" precisa ser HH:MM`)
  if (!(c.semanal.hora < c.semanal.ate)) falha('"semanal.hora" precisa ser antes de "semanal.ate"')
  for (const k of ['de', 'ate']) if (!HHMM.test(String(c.silencio_padrao?.[k]))) falha(`"silencio_padrao.${k}" precisa ser HH:MM`)
  if (!Array.isArray(c.status_elegiveis) || !c.status_elegiveis.length) falha('"status_elegiveis" precisa ser uma lista de textos')
  for (const k of CLASSES) if (!Number.isInteger(c.cooldown_por_classe?.[k]) || c.cooldown_por_classe[k] < 1) falha(`"cooldown_por_classe.${k}" precisa ser inteiro ≥ 1`)
  const num = (k, v, min, max) => { if (typeof v !== 'number' || v < min || v > max) falha(`"${k}" fora do intervalo ${min}..${max}`) }
  num('teto.lotes_imediatos_dia', c.teto?.lotes_imediatos_dia, 1, 20); num('teto.itens_urgente', c.teto?.itens_urgente, 1, 5); num('teto.lista_nomes', c.teto?.lista_nomes, 1, 10)
  num('retry_min', c.retry_min, 1, 1440); num('preco_drastico_pct', c.preco_drastico_pct, 1, 100); num('dependencia_dias', c.dependencia_dias, 1, 365)
  num('oferta_fim_dias', c.oferta_fim_dias, 1, 30); num('preco_janela_dias', c.preco_janela_dias, 1, 14)
  // corte do URGENTE (política de mensagem do David, não diagnóstico): a ruptura do Algoritmo (cobertura_critica_dias) continua no plano semanal
  // ausente (14/10/2026) = sem corte de mensagem: a ruptura do urgente é o predicado do Algoritmo (lead-time.emRuptura)
  if (c.urgente?.ruptura_max_dias !== undefined) num('urgente.ruptura_max_dias', c.urgente.ruptura_max_dias, 0, LIM.cobertura_critica_dias)
  // na_hora_ligado false = nada sai na hora (os urgentes entram no plano de terça); true = o urgente de estoque e preço sai na hora para todo cliente elegível (14/10/2026)
  if (c.urgente?.na_hora_ligado !== undefined && typeof c.urgente.na_hora_ligado !== 'boolean') falha('"urgente.na_hora_ligado" precisa ser verdadeiro ou falso')
  // urgente de estoque e preço (14/10/2026): lista FECHADA de tipos do cliente que saem na hora, início próprio, janela de repetição e a regra da liberação automática
  if (c.urgente.inicio_envios !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(String(c.urgente.inicio_envios)) && !Number.isNaN(Date.parse(c.urgente.inicio_envios + 'T12:00:00Z')))) falha('"urgente.inicio_envios" precisa ser AAAA-MM-DD')
  num('urgente.repeticao_dias', c.urgente.repeticao_dias, 1, 30)
  if (c.urgente.liberacao_automatica !== undefined && (typeof c.urgente.liberacao_automatica !== 'string' || c.urgente.liberacao_automatica.length > 200)) falha('"urgente.liberacao_automatica" precisa ser o texto da regra (ou vazio)')
  num('preco_origem.fim_promocao_dias', c.preco_origem?.fim_promocao_dias, 1, 60); num('preco_origem.fim_promocao_tolerancia_pct', c.preco_origem?.fim_promocao_tolerancia_pct, 0, 5)
  const proprios = ['ruptura_dias', 'lead_time_dias_premissa', 'full_dias_sem_venda', 'reputacao_limites_pct', 'reputacao_fracao_limite', 'ads_min_cliques_sem_venda', 'preco_vendas_queda_pct'].filter(k => k in c)
  if (proprios.length) falha(`limiar próprio não é permitido (vem de config/algoritmo.json → limiares): ${proprios.join(', ')}`)
  for (const k of ['rodape', 'titulo', 'resumo_hora_padrao']) if (k in c) falha(`"${k}" saiu em 12/10/2026 (lote diário extinto; o texto do plano semanal e do urgente é fixo em plano-semana-texto.js)`)
  if (typeof c.webhook?.caminho !== 'string' || !c.webhook.caminho.startsWith('/') || typeof c.webhook?.caminho_teste !== 'string' || !c.webhook.caminho_teste.startsWith('/')) falha('"webhook.caminho"/"caminho_teste" precisam começar com /')
  num('webhook.janela_s', c.webhook.janela_s, 30, 3600); num('webhook.timeout_ms', c.webhook.timeout_ms, 1000, 120000)
  const g = c.gatilhos
  if (!g || typeof g !== 'object') falha('falta "gatilhos"')
  for (const t of TIPOS) {
    const x = g[t]; if (!x) falha(`gatilho "${t}" ausente do catálogo`)
    if (!DONOS.includes(x.dono)) falha(`gatilho "${t}": dono inválido (cliente ou assessoria)`)
    if (!CLASSES.includes(x.classe)) falha(`gatilho "${t}": classe inválida`)
    if (!RITMOS.includes(x.ritmo)) falha(`gatilho "${t}": ritmo inválido`)
    if ((x.dono === 'assessoria') !== (x.ritmo === 'interno')) falha(`gatilho "${t}": dono assessoria ⇔ ritmo interno`)
    if (x.ritmo === 'hora' && x.classe !== 'critico') falha(`gatilho "${t}": ritmo hora (urgente) exige classe critico`)
    if (typeof x.template !== 'string' || !x.template.trim()) falha(`gatilho "${t}": template ausente`)
    if (typeof x.rotulo !== 'string' || !x.rotulo.trim()) falha(`gatilho "${t}": rotulo ausente`)
    if (x.cooldown_dias !== undefined && !(Number.isInteger(x.cooldown_dias) && x.cooldown_dias >= 1)) falha(`gatilho "${t}": cooldown_dias inválido`)
    if (x.sem_resolucao !== undefined && x.sem_resolucao !== true) falha(`gatilho "${t}": sem_resolucao só pode ser true`)
    const v = ['1', '2'].flatMap(n => auditar(preencher(x.template, Object.fromEntries(['n', 'd', 'lista', 'x', 'y', 'lead', 'de', 'para', 'data', 'anuncio', 'nivel', 'metrica', 'prazo', 'desde', 'rotulo', 'precisamos', 'vendas', 'gasto', 'ate', 'ctrl', 'link', 'fecho'].map(k => [k, n])))))   // singular e plural
    if (v.length) falha(`gatilho "${t}": o template não passa no auditor (${codigosDe(v).join(', ')})`)
  }
  const extras = Object.keys(g).filter(k => !TIPOS.includes(k)); if (extras.length) falha(`gatilhos fora da lista fechada: ${extras.join(', ')}`)
  if (!Array.isArray(c.urgente?.tipos) || !c.urgente.tipos.length || c.urgente.tipos.some(t => !TIPOS.includes(t) || c.gatilhos?.[t]?.dono !== 'cliente')) falha('"urgente.tipos" precisa ser uma lista de tipos do catálogo com dono cliente')
  return Object.freeze(c)
}
export const lerConfig = (caminho = join(ROOT, 'config', 'gatilhos.json')) => validarConfig(JSON.parse(readFileSync(caminho, 'utf-8')))

// ── puras ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const str = v => typeof v === 'string' ? v.trim() : ''
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
export const sha = s => createHash('sha256').update(String(s)).digest('hex').slice(0, 16)
const dm = iso => iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—'
const dma = iso => `${dm(iso)}/${iso.slice(0, 4)}`
const brl = v => Number.isFinite(v) ? Math.round(v).toLocaleString('pt-BR') : '—'
const brl2 = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
const pct1 = v => Number.isFinite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// semana ISO 8601 de uma data 'AAAA-MM-DD' (idempotência do plano semanal) e dia da semana (0 = domingo, 1 = segunda)
const diaSemana = iso => new Date(`${iso}T12:00:00Z`).getUTCDay()
export const semanaIso = iso => {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7))   // quinta da mesma semana decide o ano
  const ano = d.getUTCFullYear(), ordinal = Math.round((d - Date.UTC(ano, 0, 1, 12)) / 86_400_000) + 1
  return `${ano}-W${String(Math.floor((ordinal - 1) / 7) + 1).padStart(2, '0')}`
}
const segundaDa = iso => addDias(iso, -((diaSemana(iso) + 6) % 7))
const curto = t => nomeCurto(t, 40) || 'produto'
// nomes repetidos (variações/anúncios com o mesmo título) contam uma vez: a lista ao cliente nunca repete o mesmo nome; com un = [singular, plural] o «e mais N»
// conta ANÚNCIOS (não nomes), para fechar com o {n} do texto («em 19 anúncios: A, B e C e mais 16 anúncios»)
export const listaNomes = (nomes, max = 3, un) => {
  if (!un) return juntar(nomes.map(curto), max)
  const c = nomes.map(curto), vis = [...new Set(c)].slice(0, max), resto = c.filter(x => !vis.includes(x)).length
  return juntar(vis, max) + (resto ? ` e mais ${resto} ${resto === 1 ? un[0] : un[1]}` : '')
}
function juntar(linhas, max = 3, sep = ', ') {
  const u = [...new Set(linhas.filter(Boolean))], l = u.slice(0, max), extra = u.length - l.length
  const base = l.length > 1 ? `${l.slice(0, -1).join(sep)} e ${l.at(-1)}` : l[0] || ''
  return extra > 0 ? `${base} e mais ${extra}` : base
}
// origem de UMA mudança de preço (pedido do David, 12/10/2026: ao cliente só o que ele fez, nunca acusar o cliente do que pode ter sido a equipe).
// m = { item_id, dia, fonte }; at = atividade da assessoria lida (fonte atividadePreco) ou null quando não deu para ler.
// Janela [início, dia+1]: início = dia−2; quando a coleta tem LACUNA antes da detecção (última leitura dos anúncios — at.leituras, dias de meli_coleta_dia — antes de dia−1),
// início = última leitura antes da detecção −2 (achado de 12/10: a coleta não rodou de 10 a 12/10 e o change-log grava o dia em que VIU a mudança). Vale para tudo na janela.
// → 'sistema' (fonte do próprio sistema) | 'fim_de_promocao' (preço novo ≈ preco_original de uma promoção que terminou nos últimos fim_promocao_dias, tolerância
//   fim_promocao_tolerancia_pct: a promoção acabou e o preço voltou ao cheio — nunca ao cliente; item interno «avaliar renovar»; achado da União Dog, 12/10)
//   | 'assessoria' (tarefa da equipe vinculada ao anúncio ativa na janela, ou publicação de Ofertas) | 'promocao' (promoção no ar
//   ou mudando na janela, preço riscado que mudou ou existe hoje) | 'nao_verificada' (sem leitura das tarefas, leitura anterior dos anúncios desconhecida, Notion sem sync
//   até o fim da janela, promoções não lidas desde o dia da mudança ou com evento depois da janela (a coleta de promoções data o evento pelo dia em que roda),
//   tarefa de preço na janela sem anúncio identificado, tarefa concluída sem data no anúncio ou de preço) | 'externa' (vai ao cliente)
export function origemPreco(m, at, { fimPromocaoDias = 14, toleranciaPct = 1 } = {}) {
  if (!FONTES_PRECO_EXTERNAS.includes(m?.fonte)) return 'sistema'
  if (!at || !/^\d{4}-\d{2}-\d{2}$/.test(String(m.dia))) return 'nao_verificada'
  const antes = (at.leituras || []).filter(d => d < m.dia).sort().at(-1) || ''
  const de = antes && antes < addDias(m.dia, -1) ? addDias(antes, -2) : addDias(m.dia, -2), ate = addDias(m.dia, 1), dentro = d => !!d && d >= de && d <= ate
  const para = Number(m.para), voltouAoCheio = p => p.preco_original > 0 && Number.isFinite(para) && p.fim && p.fim <= m.dia && p.fim >= addDias(m.dia, -fimPromocaoDias)
    && Math.abs(para - p.preco_original) <= p.preco_original * toleranciaPct / 100
  if ((at.promocoes || []).some(p => p.item_id === m.item_id && voltouAoCheio(p))) return 'fim_de_promocao'
  // tarefa aberta: [início (sem início = desde sempre), hoje]; concluída: [início ou conclusão, conclusão]; a concluída sem data conhecida não é situável (não verificável)
  const ativa = t => t.aberta ? (!t.inicio || t.inicio <= ate) : !!t.fim && t.fim >= de && (t.inicio || t.fim) <= ate
  const todas = at.tarefas || [], tarefas = todas.filter(ativa), doItem = t => (t.itens || []).includes(m.item_id), precoSem = t => t.preco && !(t.itens || []).length
  if (tarefas.some(doItem) || (at.execucoes || []).some(e => e.item_id === m.item_id && dentro(e.dia))) return 'assessoria'
  const promos = (at.promocoes || []).filter(p => p.item_id === m.item_id)
  if (promos.some(p => p.dia ? dentro(p.dia) : (!p.inicio || p.inicio <= ate) && (!p.fim || p.fim >= de))) return 'promocao'
  if (!antes || !(String(at.sync || '') >= ate) || !(String(at.promo_lida || '') >= m.dia) || promos.some(p => p.campo === 'promocao' && p.dia > ate)
    || tarefas.some(precoSem) || todas.some(t => !t.aberta && !t.fim && (doItem(t) || precoSem(t)))) return 'nao_verificada'
  return 'externa'
}
// quando a mudança de preço aconteceu, no texto ao cliente: com lacuna na coleta (última leitura dos anúncios antes da detecção < dia−1) o change-log grava o dia em que
// a coleta VIU a mudança, não o dia em que ela aconteceu → «entre {última leitura + 1} e {detecção}»; sem lacuna, «em {dia}» (achado de 12/10: coleta parada de 10 a 12/10)
export function quandoMudou(dia, leituras = []) {
  const antes = leituras.filter(d => d < dia).sort().at(-1)
  return antes && antes < addDias(dia, -1) ? `entre ${dm(addDias(antes, 1))} e ${dm(dia)}` : `em ${dm(dia)}`
}
// hora HH:MM dentro de [inicio, fim) e fora do silêncio [de, ate) — silêncio pode cruzar a meia-noite (21:00 → 07:00)
export function dentroDaJanela(hora, { janela, silencio }) {
  const h = String(hora)
  if (!(h >= janela.inicio && h < janela.fim)) return false
  if (!silencio) return true
  const { de, ate } = silencio
  return de < ate ? !(h >= de && h < ate) : !(h >= de || h < ate)
}

// ── validação da configuração de avisos do cliente (lista FECHADA; mensagens nunca ecoam o valor) ───────────────────────────
export function validarNotificacao(b, cfg) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw erro('informe "notificacao" como objeto')
  const extra = Object.keys(b).filter(k => !['canais', 'ritmo', 'silencio', 'fuso', 'rotulo'].includes(k)); if (extra.length) throw erro('campo fora da lista permitida')
  const out = { canais: {}, ritmo: { critico_na_hora: false }, silencio: { ...cfg.silencio_padrao } }     // urgente na hora NASCE DESLIGADO (12/10/2026: só semanal)
  const canais = b.canais ?? {}
  if (typeof canais !== 'object' || Array.isArray(canais)) throw erro('"canais" precisa ser um objeto')
  for (const k of Object.keys(canais)) if (!CANAIS.includes(k)) throw erro('canal fora da lista permitida')
  for (const k of CANAIS) {
    const c = canais[k] ?? {}
    if (typeof c !== 'object' || Array.isArray(c)) throw erro(`"canais.${k}" precisa ser um objeto`)
    const ligado = c.ligado === true, destino = str(c.destino)
    if (k === 'notion') { out.canais[k] = { ligado }; continue }
    if (ligado && !destino) throw erro(`canal ${k} ligado sem destino`)
    if (destino) {
      if (k === 'whatsapp' && !WHATS.test(destino)) throw erro('WhatsApp inválido: use o id do grupo do cliente no Mercado Livre (…@g.us), como está em «Id whatsapp meli» na base Clientes')
      if (k === 'email' && (destino.length > 254 || !EMAIL.test(destino))) throw erro('e-mail inválido')
    }
    out.canais[k] = { ligado, destino }
  }
  const r = b.ritmo ?? {}
  if (typeof r !== 'object' || Array.isArray(r)) throw erro('"ritmo" precisa ser um objeto')
  if (r.critico_na_hora !== undefined) { if (typeof r.critico_na_hora !== 'boolean') throw erro('"ritmo.critico_na_hora" precisa ser verdadeiro ou falso'); out.ritmo.critico_na_hora = r.critico_na_hora }

  const s = b.silencio ?? {}
  if (typeof s !== 'object' || Array.isArray(s)) throw erro('"silencio" precisa ser um objeto')
  for (const k of ['de', 'ate']) if (s[k] !== undefined) { if (!HHMM.test(String(s[k]))) throw erro(`"silencio.${k}" precisa ser HH:MM`); out.silencio[k] = s[k] }
  if (out.silencio.de === out.silencio.ate) throw erro('silêncio: início e fim não podem ser iguais (silenciaria o cliente o dia inteiro)')
  if (b.fuso !== undefined) { if (typeof b.fuso !== 'string' || !fusoValido(b.fuso)) throw erro('"fuso" precisa ser um fuso IANA válido'); out.fuso = b.fuso }
  // como o cliente é chamado na mensagem («Oi, time União Dog!»); vazio = nome da central
  if (b.rotulo !== undefined) { const r0 = str(b.rotulo); if (typeof b.rotulo !== 'string' || r0.length > 60 || /[\r\n\t*_~`]/.test(r0)) throw erro('"rotulo" precisa ser um nome de até 60 caracteres, sem quebra de linha nem formatação'); if (r0) out.rotulo = r0 }
  return out
}
export const notificacaoDe = (json, cfg) => {
  let n = {}; try { n = JSON.parse(json || '{}') || {} } catch { n = {} }
  const canais = {}; for (const k of CANAIS) canais[k] = { ligado: n.canais?.[k]?.ligado === true, ...(k === 'notion' ? {} : { destino: str(n.canais?.[k]?.destino) }) }
  return { liberado_por: str(n.liberado_por), liberado_em: str(n.liberado_em), canais, ritmo: { critico_na_hora: n.ritmo?.critico_na_hora === true },
    silencio: { de: HHMM.test(String(n.silencio?.de)) ? n.silencio.de : cfg.silencio_padrao.de, ate: HHMM.test(String(n.silencio?.ate)) ? n.silencio.ate : cfg.silencio_padrao.ate }, fuso: fusoValido(n.fuso) && n.fuso ? n.fuso : cfg.fuso_padrao,
    rotulo: typeof n.rotulo === 'string' && n.rotulo.trim() && !/[\r\n\t*_~`]/.test(n.rotulo) ? n.rotulo.trim().slice(0, 60) : '',
    // liberação automática do urgente (14/10): auto_liberado = marca que SÓ autoLiberar grava; auto_bloqueado = revogado ou destino trocado (a regra nunca religa)
    auto_liberado: !!n.auto_liberado?.regra, auto_bloqueado: n.auto_bloqueado === true }
}
// nome do cliente na saudação sem rótulo cadastrado: o nome da central sem a razão social no fim («Prisma Indústria e Comércio LTDA» → «Prisma», «Moema Comercio» → «Moema»).
// O cliente liberado pela regra automática nunca teve rótulo cadastrado por alguém (achado de 14/10). ponytail: lista fixa de palavras; nome inteiro dessas palavras fica como está
const SOCIAL = new Set(['ltda', 'me', 'eireli', 'epp', 'sa', 'comercio', 'comercial', 'industria', 'e', 'de', 'cosmeticos', 'confeccoes', 'servicos'])
export const rotuloPadrao = nome => {
  const w = String(nome ?? '').trim().split(/\s+/), chave = p => p.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[./]/g, '')
  while (w.length > 1 && SOCIAL.has(chave(w.at(-1)))) w.pop()
  return w.join(' ')
}
export const canaisLigados = n => CANAIS.filter(k => n?.canais?.[k]?.ligado)
// destinos VAZIOS ← sugestão da base Clientes do Notion (gatilhos-destinos-notion.sugerirCanais), só nos canais pedidos; nada é sobrescrito nem ligado aqui.
// Um preenchimento só: a rota /api/cliente/notificacao/central (WhatsApp e e-mail) e a liberação em lote (só o grupo «Id whatsapp meli»). O valor nunca volta ao HTTP.
export function preencherVazios(canais, sugestao = {}, so = CANAIS_N8N) {
  const preenchidos = []
  const out = Object.fromEntries(Object.entries(canais).map(([k, v]) => {
    const sug = sugestao?.[k]
    if (so.includes(k) && k !== 'notion' && !v.destino && sug?.destino) { preenchidos.push({ canal: k, origem: sug.origem }); return [k, { ligado: v.ligado, destino: sug.destino }] }
    return [k, v]
  }))
  return { canais: out, preenchidos }
}

// ── fábrica ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// deps: handle (better-sqlite3 com clientes_central), fontes (todas opcionais; ausente = o gatilho dessa fonte não nasce e a cobertura diz 'indisponivel'):
//   cliente(c) → { status, notificacao_json } | null · salvarNotificacao(c, json) · acoes(c) → [{ id, regra, item_id, dados }] abertas · pendencias(c) → { itens, tarefas } · explicar(p)
//   estadoConta(c) → classificarEstado() · saude(c) → lerSaude() · diagnostico(c) → diagnosticarConta() · sugestaoFull(item) · mudancasPreco(c, { desde }) → [{ item_id, titulo, dia, de, para, variacao_pct, fonte }]
//   promocoes(c) → [{ item_id, titulo, nome, fim, status }] · titulos(c, ids) → Map · planoSemana(c) → dadosPlanoSemana() (dados do plano semanal; ausente = sem plano)
//   perfil(c) → perfil-informacao.ler(c).efetivo { ordem, temas, nivel, fonte } (Etapa 3: relatório personalizado; ausente = texto do tom aprovado sem personalização)
//   alinhado(c) → predicado do núcleo dos alinhamentos (q → { sim, … }): entidade/regra/conta alinhada com o cliente NÃO gera aviso; item vivo que passa a ser coberto
//   vira 'suprimido' motivo 'alinhado' (nunca 'resolvido', nunca linha «Resolvido»); sem a fonte nada é suprimido
// envio: { enviar({ lote, cliente, notificacao, texto, titulo }) → { estado, motivo, recibos }, testar({ cliente, canal, destino }) → { estado, motivo } } (gatilhos-envio.js)
// agora() ISO; auditar(texto, opts); nomesInternos(c) (sync/async); validarPor(nome) → nome|''; elegiveis() → [{ cliente, status }]; clienteCanonico?(nome); estado? (padrão: sync_estado do handle)
// integracao(c) → { ok, motivo } = integracao-ml.integracaoMlAtiva com as leituras reais (gatilhos-real.js); SEM ela nada sai sozinho (não dá para confirmar a integração)
// coletaCompleta(c) → bool: a primeira coleta cobriu a janela de 28 dias (urgente nunca sai antes; sem a leitura = não confirma); central(c) → buscarDestinos (grupo «Id whatsapp meli»
// da base Clientes do Notion) para a liberação automática do urgente
export function criarGatilhos({ handle, fontes = {}, agora = () => new Date().toISOString(), auditar = auditarTexto, nomesInternos = () => [], cfg = lerConfig(), estado, validarPor = () => '',
  elegiveis = () => [], clienteCanonico, envio = null, log = () => {}, notificar = () => {}, integracao = () => ({ ok: false, motivo: 'sem_conexao_ml' }), coletaCompleta = () => false, central = null }) {
  handle.exec(SCHEMA_GATILHOS)
  estado = estado || estadoDeHandle(handle)
  // migração (12/10/2026): o Discord deixou de ser canal ao cliente — a configuração gravada perde só o canal discord; whatsapp, e-mail, Notion e a liberação ficam
  try {
    for (const r of handle.prepare("SELECT cliente, notificacao_json FROM clientes_central WHERE notificacao_json LIKE '%discord%'").all()) {
      let n; try { n = JSON.parse(r.notificacao_json) } catch { continue }
      if (n?.canais && typeof n.canais === 'object' && Object.hasOwn(n.canais, 'discord')) { delete n.canais.discord; handle.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(JSON.stringify(n), r.cliente) }
    }
  } catch { /* handle sem clientes_central (autoteste de outro módulo) */ }
  // migração (12/10/2026, «só semanal»): o urgente na hora passou a nascer desligado. A configuração gravada antes trazia critico_na_hora: true por PADRÃO (a tela vinha
  // marcada; ninguém escolheu) — passa a false UMA vez (marca em sync_estado); quem marcar «Urgente sai na hora» na tela depois disso fica marcado
  if (estado.get('gatilhos_migracao_urgente_desligado') !== '1') {
    try {
      for (const r of handle.prepare("SELECT cliente, notificacao_json FROM clientes_central WHERE notificacao_json LIKE '%critico_na_hora%'").all()) {
        let n; try { n = JSON.parse(r.notificacao_json) } catch { continue }
        if (n?.ritmo?.critico_na_hora === true) { n.ritmo.critico_na_hora = false; handle.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(JSON.stringify(n), r.cliente) }
      }
      estado.set('gatilhos_migracao_urgente_desligado', '1')
    } catch { /* handle sem clientes_central */ }
  }
  const agoraMs = () => Date.parse(agora())
  const F = fontes
  const cat = cfg.gatilhos
  const cooldownDias = tipo => cat[tipo].cooldown_dias ?? cfg.cooldown_por_classe[cat[tipo].classe]
  const donoDe = tipo => cat[tipo]?.dono || 'assessoria'          // tipo fora do catálogo nunca vai ao cliente
  const paraCliente = r => donoDe(r.tipo) === 'cliente' && r.estado !== 'interno'
  const urgente = tipo => cat[tipo]?.ritmo === 'hora'                 // urgente = lote imediato; o resto do cliente vai no plano semanal
  const naHora = () => cfg.urgente.na_hora_ligado === true, naLista = tipo => cfg.urgente.tipos.includes(tipo)   // 14/10: o lote imediato leva SÓ os tipos da lista
  const padraoDe = tipo => donoDe(tipo) === 'assessoria' ? 'interno' : urgente(tipo) ? 'pendente' : 'agrupado'
  const voltaFila = r => padraoDe(r.tipo)   // linha que sai de um lote cancelado/vencido

  // ── clientes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const normNome = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const selCliente = F.cliente || (c => { try { return handle.prepare('SELECT status_cs AS status, notificacao_json FROM clientes_central WHERE cliente = ?').get(c) || null } catch { return null } })
  const salvarNotif = F.salvarNotificacao || ((c, json) => handle.prepare('UPDATE clientes_central SET notificacao_json = ? WHERE cliente = ?').run(json, c))
  function mapaElegiveis() {
    const st = new Set(cfg.status_elegiveis.map(normNome)), m = new Map()
    for (const x of elegiveis() || []) if (x && typeof x.cliente === 'string' && x.cliente.trim() && !ehProspecto(x.cliente) && typeof x.status === 'string' && st.has(normNome(x.status))) m.set(normNome(x.cliente), x.cliente)
    return m
  }
  const exigirCliente = bruto => {
    const s = str(bruto); if (!s) throw erro('informe "cliente"')
    if (ehProspecto(s) || s.length > 200) throw erro('cliente não encontrado na central', 404)
    const c = clienteCanonico ? clienteCanonico(s) : mapaElegiveis().get(normNome(s))
    if (!c) throw erro('cliente não encontrado na central', 404)
    return c
  }
  const notificacao = c => notificacaoDe(selCliente(c)?.notificacao_json, cfg)
  const fusoDe = c => notificacao(c).fuso
  const hojeDe = (c, ms = agoraMs()) => dataNoFuso(ms, fusoDe(c))
  const horaDe = (c, ms = agoraMs()) => horaNoFuso(ms, fusoDe(c))
  const ligado = () => estado.get('gatilhos_ligado') === 'ligado'
  // integração ML de fato (função única de integracao-ml.js, injetada); erro de leitura = não confirma (nada sai), com motivo próprio
  const integracaoDe = c => { try { const r = integracao(c); return r && typeof r.ok === 'boolean' ? { ok: r.ok, motivo: r.ok ? '' : String(r.motivo || 'sem_conexao_ml') } : { ok: false, motivo: 'integracao_indisponivel' } } catch (e) { log('erro', `gatilhos ${c}: integração ML ${String(e?.name || 'Error')}`); return { ok: false, motivo: 'integracao_indisponivel' } } }
  // nenhum envio antes do início (no fuso do cliente): o plano semanal por inicio_envios; o urgente de estoque e preço pelo início próprio (urgente.inicio_envios)
  const antesDoInicio = (c, tipo = 'semanal') => { const ini = tipo !== 'semanal' && cfg.urgente.inicio_envios ? cfg.urgente.inicio_envios : cfg.inicio_envios; return !!ini && hojeDe(c) < ini }
  const coletaOk = c => { try { return coletaCompleta(c) === true } catch { return false } }
  const exigirPor = bruto => {           // decisão de produto (não há login): líder OU consultor da central, como relatorio-envio e alerta-cliente
    if (!str(bruto)) throw erro('informe "por" (quem está decidindo — líder ou consultor)')
    const p = validarPor(str(bruto)); if (!p) throw erro('somente líder ou consultor da central decide sobre avisos ao cliente', 403)
    return String(p).slice(0, 80)
  }

  // ── banco ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const selId = handle.prepare('SELECT * FROM gatilho_cliente WHERE id = ?')
  const vivosDe = handle.prepare(`SELECT * FROM gatilho_cliente WHERE cliente = ? AND estado IN (${VIVOS.map(s => `'${s}'`).join(',')}) ORDER BY id`)
  const ins = handle.prepare(`INSERT INTO gatilho_cliente (cliente, tipo, classe, assinatura, itens_json, texto, estado, motivo, criado_em, atualizado_em) VALUES (@cliente, @tipo, @classe, @assinatura, @itens_json, @texto, @estado, @motivo, @em, @em)`)
  const selLote = handle.prepare('SELECT * FROM gatilho_lote WHERE id = ?')
  const insLote = handle.prepare(`INSERT INTO gatilho_lote (id, cliente, tipo, dia, itens_ids_json, texto_final, hash, canais_json, estado, origem, por, criado_em) VALUES (@id, @cliente, @tipo, @dia, @itens_ids_json, @texto_final, @hash, @canais_json, 'montado', @origem, @por, @em)`)
  function atualizar(id, campos) {
    const ks = Object.keys(campos).filter(k => COLUNAS.includes(k)); if (!ks.length) return
    handle.prepare(`UPDATE gatilho_cliente SET ${ks.map(k => `${k} = @${k}`).join(', ')}, atualizado_em = @em WHERE id = @id`).run({ ...Object.fromEntries(ks.map(k => [k, campos[k]])), id, em: agora() })
  }
  function atualizarLote(id, campos) {
    const ks = Object.keys(campos).filter(k => COLUNAS_LOTE.includes(k)); if (!ks.length) return
    handle.prepare(`UPDATE gatilho_lote SET ${ks.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...Object.fromEntries(ks.map(k => [k, campos[k]])), id })
  }
  // cooldown só no urgente: o não urgente sai no plano de terça, que já é o ritmo dele (uma mensagem por semana)
  const cooldownAtivo = (c, tipo) => urgente(tipo) && !!handle.prepare("SELECT 1 FROM gatilho_cliente WHERE cliente = ? AND tipo = ? AND enviado_em <> '' AND enviado_em >= ? LIMIT 1").get(c, tipo, new Date(agoraMs() - cooldownDias(tipo) * 86_400_000).toISOString())
  const lotesNoDia = (c, dia, tipo) => handle.prepare("SELECT COUNT(*) n FROM gatilho_lote WHERE cliente = ? AND dia = ? AND tipo = ? AND estado <> 'montado'").get(c, dia, tipo).n
  const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
  // o que JÁ FOI DITO ao cliente por PRODUTO (gatilho_avisado, gravado no envio): família|anúncio → estado no envio, nos últimos urgente.repeticao_dias
  const memoAvisados = (c, ms = agoraMs()) => new Map(handle.prepare('SELECT familia, item_id, snap_json FROM gatilho_avisado WHERE cliente = ? AND enviado_em >= ?')
    .all(c, new Date(ms - cfg.urgente.repeticao_dias * 86_400_000).toISOString()).map(r => [`${r.familia}|${r.item_id}`, parse(r.snap_json, {})]))
  const selLoteProduto = handle.prepare('SELECT item_id, snap_json FROM gatilho_lote_produto WHERE lote_id = ?'), insLoteProduto = handle.prepare('INSERT OR IGNORE INTO gatilho_lote_produto (lote_id, item_id, snap_json) VALUES (?,?,?)')
  const insAvisado = handle.prepare(`INSERT INTO gatilho_avisado (cliente, familia, item_id, snap_json, enviado_em, lote_id) VALUES (?,?,?,?,?,?)
    ON CONFLICT(cliente, familia, item_id) DO UPDATE SET snap_json = excluded.snap_json, enviado_em = excluded.enviado_em, lote_id = excluded.lote_id`)

  // ── detecção: projeção das fontes em itens { tipo, classe, assinatura, itens (interno), vals } ─────────────────────────
  const item = (tipo, ids, vals, itens, classe = cat[tipo].classe) => ({ tipo, classe, assinatura: sha(`${tipo}|${[...ids].map(String).sort().join(',')}`), itens, vals })
  const titulosDe = (c, ids) => { try { return F.titulos ? F.titulos(c, ids) || new Map() : new Map() } catch { return new Map() } }
  const predicadoDe = c => typeof F.alinhado === 'function' ? F.alinhado(c) : null
  // atividade da assessoria nos anúncios das mudanças (tarefas vinculadas, publicações de Ofertas, promoções): lida UMA vez; sem a fonte ou com erro, toda origem é 'nao_verificada'
  const origensDe = (c, muds) => {
    const ext = muds.filter(m => FONTES_PRECO_EXTERNAS.includes(m.fonte) && /^\d{4}-\d{2}-\d{2}$/.test(String(m.dia)))
    let at = null
    if (ext.length && typeof F.atividadePreco === 'function') {
      const dias = ext.map(m => m.dia).sort()
      try { at = F.atividadePreco(c, [...new Set(ext.map(m => m.item_id))], { de: addDias(dias[0], -2), ate: addDias(dias.at(-1), 1) }) || null } catch (e) { at = null; log('erro', `gatilhos ${c}: atividade da assessoria ${String(e?.message ?? e).replace(/["'`][\s\S]*$/, '…').slice(0, 100)}`) }
    }
    const op = { fimPromocaoDias: cfg.preco_origem.fim_promocao_dias, toleranciaPct: cfg.preco_origem.fim_promocao_tolerancia_pct }
    return Object.assign(m => origemPreco(m, at, op), { quando: dia => quandoMudou(dia, at?.leituras || []) })
  }
  function detectar(c, cobertura, semLeitura = new Set(), alinhados = new Set(), al = predicadoDe(c)) {     // semLeitura: tipos cuja fonte/bloco NÃO foi lido nesta passada (ausente ≠ zero: não detecta nem resolve)
    const out = [], ms = agoraMs(), hoje = hojeDe(c, ms)
    // urgente ligado: produto já DITO nos últimos urgente.repeticao_dias e sem piora sai do texto (avisado:true em itens_json; a assinatura segue com todos os produtos, então a
    // resolução não muda); piora:true = já dito e piorou. Achado de 14/10: o dedupe era por linha e o produto já avisado voltava junto com outro produto novo da mesma linha
    const memo = naHora() ? memoAvisados(c, ms) : new Map()
    const marca = (fam, x) => { const s = memo.get(`${fam}|${idDe(x)}`); return !s ? {} : piorou(fam, x, s) ? { piora: true } : { avisado: true } }
    const separar = (fam, l) => { const m = new Map(l.map(i => [i, marca(fam, i)])), novos = l.filter(i => !m.get(i).avisado); return { mostrar: novos.length ? novos : l, m } }
    // alinhamento com o cliente (aviso:true — ja_informado silencia aqui): entidade coberta sai da lista; conta/regra coberta não gera o aviso. alinhados = tipos em que algo saiu por isso
    const livre = (tipo, lista, idDe = x => x.id, regraDe = () => REGRA_DO_TIPO[tipo], extra = () => ({})) => {
      if (!al) return lista
      const fica = lista.filter(x => !al({ item: idDe(x) ? String(idDe(x)) : '', regra: regraDe(x), aviso: true, ...extra(x) }).sim)
      if (fica.length < lista.length) alinhados.add(tipo)
      return fica
    }
    const contaLivre = tipo => { if (al && al({ regra: REGRA_DO_TIPO[tipo], aviso: true }).sim) { alinhados.add(tipo); return false } return true }
    const fonte = (nome, fn) => { if (typeof F[nome] !== 'function') { cobertura[nome] = 'indisponivel'; return } try { fn(); cobertura[nome] = cobertura[nome] || 'ok' } catch (e) { cobertura[nome] = 'erro'; log('erro', `gatilhos ${c}: fonte ${nome} ${String(e?.message ?? e).replace(/["'`][\s\S]*$/, '…').slice(0, 100)}`) } }
    let diag = null, acoes = [], janelaInteira = false
    // impacto em R$ (14/10): previsão da regra do plano do item (ação aberta) → { c, b, dias, fonte } | null; sem a janela de 28 d inteira coletada, sem número
    const prevDe = (regra, id) => acoes.find(a => String(a.item_id) === String(id) && String(a.regra).endsWith(regra) && a.previsao?.cenarios)?.previsao
    // zero CALCULADO (a reposição chega antes de zerar) é zero; sem dado (janela incompleta, número ausente) é null — nunca o contrário
    const imp = (c0, b0, dias, fonte) => janelaInteira && Number.isFinite(c0) && Number.isFinite(b0) && dias > 0 ? { c: Math.max(0, Math.round(c0)), b: Math.max(0, Math.round(b0)), dias, fonte } : null
    const daPrev = (p, dias, k = 1) => imp(p.cenarios.conservador?.receita * k, p.cenarios.base?.receita * k, dias, 'plano')
    fonte('acoes', () => { acoes = F.acoes(c) || [] })
    fonte('diagnostico', () => {
      diag = F.diagnostico(c); if (!diag?.disponivel) { cobertura.diagnostico = diag?.motivo ? `pendente:${String(diag.motivo).slice(0, 40)}` : 'indisponivel'; return }
      const its = (diag.itens || []).filter(i => i && i.id), ab = its.filter(i => ['A', 'B'].includes(i.curva) && i.status === 'active' && representaEstoque(i))
      // QUANTIDADE (achado de 14/10: o aviso usava a conta de envio ao Full para tudo e saía com outro número que o relatório focado para o mesmo produto): fora do Full, o
      // pedido ao fornecedor de preverCompras (quanto_pedir: prazo + ciclo de compra + folga, a MESMA do focado e do 📦 do plano, com a premissa dela no texto); no Full, o
      // envio (sugestaoFull). Sem a previsão de compras, sem número. Nomes resolvidos contra a CONTA inteira (variações com o mesmo começo de título não se confundem).
      const sug = i => { try { return typeof F.sugestaoFull === 'function' ? F.sugestaoFull(i) : null } catch { return null } }
      const porNome = l => [...l.reduce((m, i) => m.set(curto(i.titulo), [...(m.get(curto(i.titulo)) || []), i]), new Map())]
      let cp = null
      if (typeof F.compras === 'function') try { cp = F.compras(c, diag) } catch (e) { log('erro', `gatilhos ${c}: previsão de compras ${String(e?.name || 'Error')}`) }
      const compraDe = new Map(); for (const x of (cp?.disponivel ? cp.itens || [] : [])) for (const id of x.produto?.itens || [x.id]) if (!compraDe.has(String(id))) compraDe.set(String(id), x)   // F3: a linha do produto vale para os irmãos
      const CC = { ciclo_dias: ALG.compras.ciclo_compra_dias, seguranca_dias: LIM.estoque_seguranca_dias, data_comercial: ALG.compras.data_comercial }
      const pedido = i => { const q = compraDe.get(String(i.id))?.quanto_pedir; return q && Number.isInteger(q.conservador) && Number.isInteger(q.base) && q.conservador > 0 ? q : null }
      const faixaQ = s => s.conservador === s.base ? `${s.base}` : `${s.conservador} a ${s.base}`
      const premissaPedido = l => premissaCompras(l.map(i => compraDe.get(String(i.id))), CC, diag.hoje).premissa
      // leitura dos anúncios de OUTRO dia (coleta de madrugada que não rodou hoje): o texto diz a data do estoque que cita (achado de 14/10: «tem 4 un (~2 dias)» lido 36 h antes)
      let lido = ''
      if (typeof F.leituraAnuncios === 'function') try { const em = F.leituraAnuncios(c), d = em ? dataNoFuso(Date.parse(em), fusoDe(c)) : ''; if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < hoje) lido = `\nEstoque conforme a leitura de ${dm(d)}.` } catch { /* sem a data: sem a frase */ }
      const ruptTodos = ab.filter(i => emRuptura(i, LIM))            // o MESMO predicado da regra estoque_ruptura e do 📦 (lead-time.js)
      // IMPACTO EM R$ (pedido do David, 14/10/2026) por produto: a previsão da regra do plano do item (ação aberta, acoes_plano.previsao_json) ou, sem ação, a MESMA fórmula
      // sobre o diagnóstico de hoje. Sem a janela de 28 dias inteira coletada (primeira coleta incompleta ou dia sem coleta na janela) não há número: dia sem coleta não é zero.
      janelaInteira = janela28(diag)
      // R$ da ruptura = a fórmula da regra estoque_ruptura (riscoRuptura) sobre o diagnóstico de HOJE: a previsão gravada é essa mesma conta, mas a ação 'distribuida' guarda a
      // do dia da decisão (é a base do previsto × realizado do Merovíngio; salvarAcoesAnuncio não a reescreve) e contradizia o estoque citado na mesma mensagem (achado de 14/10)
      const impRuptura = i => { const k = riscoRuptura(i, LIM); return imp(k.cenarios.conservador, k.cenarios.base, k.lead, 'diagnostico') }
      // URGENTE: sem urgente.ruptura_max_dias (14/10) é todo campeão A/B em ruptura pelo Algoritmo; com ele, só quem tem ≤ esse número de dias (o resto fica no 📦 de terça).
      // Linha no tom do plano: «• nome: tem N un[ no Full] (~d dias) → [vai faltar no Full: ]sugerimos enviar|repor *conservador a base un*» + link
      const rupt = livre('ruptura_curva_a', ruptTodos.filter(i => cfg.urgente.ruptura_max_dias == null || i.cobertura <= cfg.urgente.ruptura_max_dias)).sort((a, b) => a.cobertura - b.cobertura)
      const cicloTodos = ab.filter(i => !ruptTodos.includes(i) && Number.isFinite(i.ponto_reposicao) && Number.isFinite(estoqueDe(i).estoque) && estoqueDe(i).estoque <= i.ponto_reposicao), ciclo = livre('ciclo_estoque_previsto', cicloTodos)
      const ehF = i => i.logistica === 'fulfillment', sepR = separar('estoque', rupt), sepC = separar('estoque', ciclo), visR = sepR.mostrar.slice(0, cfg.teto.lista_nomes), visC = sepC.mostrar.slice(0, cfg.teto.lista_nomes)
      // UMA premissa do pedido ao fornecedor para o 📦 e o 🛒 da mesma mensagem (montarUrgente não repete a linha igual)
      const pedR = visR.filter(i => !ehF(i) && pedido(i)), pedC = visC.filter(pedido), premPed = pedR.length + pedC.length ? premissaPedido([...pedR, ...pedC]) : ''
      if (rupt.length) {
        const { mostrar, m } = sepR, vis = visR, nomes = nomesDe(vis, its)
        const qR = i => { if (!ehF(i)) return pedido(i); const s = sug(i)?.cenarios; return s && Number.isInteger(s.conservador) && Number.isInteger(s.base) ? s : null }
        const envP = i => (ehF(i) ? envioDoProprio(i, qR(i)) : null)            // F3: Full acabando com estoque próprio do mesmo produto → enviar do depósito, não comprar
        const linha = (i, k) => { const env = envP(i), s = env || qR(i), full = ehF(i), q = s ? faixaQ(s) : null
          return `• ${nomes[k]}${sufixoAnuncios(i)}: tem ${estoqueDe(i).estoque} un${full ? ' no Full' : ''} (${diasTxt(i.cobertura)})${env ? ` e ${env.proprio} un no seu estoque` : ''}${full ? ` → vai faltar no Full${q ? `: sugerimos enviar *${q} un*${env ? ' do seu estoque (não precisa comprar)' : ''}` : ''}` : q ? ` → sugerimos repor *${q} un*` : ''}${i.permalink ? `\n  ${i.permalink}` : ''}` }
        // premissa do R$ e da quantidade, sempre no bloco (achado de 14/10: o R$ depende do prazo de reposição e a mensagem sem 🛒 não o dizia): fora do Full, a do pedido ao
        // fornecedor; senão o prazo usado; no Full, quantos dias o envio cobre e que a estimativa supõe nada enviado no período
        const fulls = vis.filter(ehF), leads = [...new Set(vis.map(i => i.lead_time_dias ?? LIM.lead_time_reposicao_dias))].sort((a, b) => a - b)
        const dFull = fulls.map(i => sug(i)).map(s => s ? s.cobertura_planejada + s.seguranca : NaN).find(Number.isFinite)
        const fecho = [pedR.length ? premPed : `Consideramos ${leads.length > 1 ? `${leads[0]} a ${leads.at(-1)}` : leads[0]} dias até a reposição chegar (se for outro prazo, conta pra gente).`,
          fulls.length ? `No Full, ${dFull ? `o envio sugerido cobre ~${dFull} dias de venda e ` : ''}a estimativa considera que nada é enviado nesse período.` : '',
          vis.some(i => estoqueDe(i).n > 1) ? PREMISSA_PRODUTO : ''].filter(Boolean).join('\n')
        out.push(item('ruptura_curva_a', rupt.map(i => i.id), { lista: vis.map(linha).join('\n') + (mostrar.length > vis.length ? `\n• e mais ${mostrar.length - vis.length} ${mostrar.length - vis.length === 1 ? 'produto' : 'produtos'} com estoque no fim` : '') + lido, fecho },
          rupt.map(i => ({ id: i.id, cobertura: i.cobertura, estoque: estoqueDe(i).estoque, full: ehF(i), repor: (envP(i) || qR(i))?.conservador ?? null, impacto: impRuptura(i), ...(estoqueDe(i).n > 1 ? { produto: i.produto.chave, irmaos: estoqueDe(i).irmaos } : {}), ...m.get(i) }))))
      }
      // CAMPEÃO QUE ZEROU (14/10): curva A/B pausado com estoque 0 e venda nos últimos 28 dias acima do impacto mínimo — a condição do «Já fora do ar por falta de estoque» do relatório
      // focado (foraDoAr pela venda de 28 d). Impacto por SEMANA parado = a fórmula da regra anuncio_restrito (receita × fração recuperada, ÷ 4) com a receita dos ÚLTIMOS 28 dias
      // — a que o texto mostra. A previsão gravada da regra usa a receita do período ANTERIOR (feita para o pausado há tempo): no campeão que acabou de zerar ela contradiz o fato
      // do texto (Photo K, 14/10: vendeu R$ 9,6 mil em 28 dias e a previsão dava R$ 200–390 por semana), então aqui vale sempre o diagnóstico de hoje
      const zer = livre('estoque_zerado', foraDoAr(its, { min_impacto_pct_gmv: FOCO.min_impacto_pct_gmv }, { campo: 'r' }).filter(i => i.status === 'paused' && i.estoque === 0 && ['A', 'B'].includes(i.curva)))   // campeão = curva A/B (como a ruptura)
      if (zer.length) {
        const { mostrar, m } = separar('estoque', zer), vis = mostrar.slice(0, cfg.teto.lista_nomes), nomes = nomesDe(vis, its), f = ALG.priors_efeito.anuncio_restrito.fracao_recuperada
        const impZ = i => { const r = estoqueDe(i).r; return imp(r * f[0] / 4, r * f[1] / 4, 7, 'diagnostico') }   // F3: receita do estoque físico inteiro
        out.push(item('estoque_zerado', zer.map(i => i.id), { n: mostrar.length, lista: vis.map((i, k) => `• ${nomes[k]}${sufixoAnuncios(i)}: sem estoque e pausado; nos últimos 28 dias vendeu *R$ ${brl(estoqueDe(i).r)}* (${estoqueDe(i).u || 0} ${(estoqueDe(i).u || 0) === 1 ? 'unidade' : 'unidades'})${i.permalink ? `\n  ${i.permalink}` : ''}`).join('\n') + (mostrar.length > vis.length ? `\n• e mais ${mostrar.length - vis.length} ${mostrar.length - vis.length === 1 ? 'anúncio' : 'anúncios'} sem estoque` : '') + lido },
          zer.map(i => ({ id: i.id, estoque: 0, impacto: impZ(i), ...m.get(i) }))))
      }
      // prazo do texto = o MESMO do ponto de reposição de cada anúncio (v1.6.0: informado pelo cliente/equipe vence a premissa); prazos diferentes viram «14 a 21»
      const leads = [...new Set(ciclo.map(i => i.lead_time_dias ?? LIM.lead_time_reposicao_dias))].sort((x, y) => x - y), leadTxt = leads.length > 1 ? `${leads[0]} a ${leads.at(-1)}` : leads[0]
      // impacto da compra: a fórmula da ruptura com a folga de segurança do ponto de reposição (receita que o pedido feito agora protege em prazo + segurança dias)
      const impCiclo = i => { const k = riscoRuptura(i, LIM, { folga: LIM.estoque_seguranca_dias }); return imp(k.cenarios.conservador, k.cenarios.base, k.lead + LIM.estoque_seguranca_dias, 'diagnostico') }
      if (ciclo.length) {
        // uma linha por ANÚNCIO (achado de 14/10: o agrupamento pelo nome cortado em 40 caracteres juntava variações diferentes numa linha sem link); título idêntico a outro
        // anúncio da conta (o nome não diferencia) leva o link, como no relatório focado. ponytail: títulos iguais até 90 caracteres e diferentes depois ficam sem link
        const { mostrar, m } = sepC, vis = visC, nomes = nomesDe(vis, its), tn = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
        const nTit = its.reduce((mp, x) => mp.set(tn(x.titulo), (mp.get(tn(x.titulo)) || 0) + 1), new Map()), link = i => nTit.get(tn(i.titulo)) > 1 && i.permalink
        const lista = vis.map((i, k) => { const q = pedido(i); return `• ${nomes[k]}${sufixoAnuncios(i)}: tem ${estoqueDe(i).estoque} un${ehF(i) ? ' no Full' : ''}${Number.isFinite(i.cobertura) ? ` (${diasTxt(i.cobertura)})` : ''}${q ? ` → pedir *${faixaQ(q)} un*` : ''}${link(i) ? `\n  ${i.permalink}` : ''}` }).join('\n')
          + (mostrar.length > vis.length ? `\n• e mais ${mostrar.length - vis.length} ${mostrar.length - vis.length === 1 ? 'produto' : 'produtos'}` : '') + lido
        out.push(item('ciclo_estoque_previsto', ciclo.map(i => i.id), { lista, lead: leadTxt, fecho: (pedC.length ? premPed : `Consideramos ${leadTxt} dias entre o pedido e a chegada (se for outro prazo, conta pra gente).`) + (vis.some(i => estoqueDe(i).n > 1) ? `\n${PREMISSA_PRODUTO}` : '') },
          ciclo.map(i => ({ id: i.id, estoque: estoqueDe(i).estoque, cobertura: i.cobertura, ponto_reposicao: i.ponto_reposicao, repor: pedido(i)?.conservador ?? null, impacto: impCiclo(i), ...(estoqueDe(i).n > 1 ? { produto: i.produto.chave, irmaos: estoqueDe(i).irmaos } : {}), ...m.get(i) }))))
      }
      // sugestão de envio ao Full: SÓ a ação full_envio do plano (curva A, conversão ≥ 0,9 × benchmark, logística conhecida fora do Full), conferida na leitura de hoje;
      // anúncio em ruptura/hora de repor fica no aviso de reposição; quantidade da regra limitada ao estoque próprio. Sem a leitura do plano o tipo não nasce nem resolve.
      if (cobertura.acoes !== 'ok') semLeitura.add('envio_full_sugerido')
      else if (typeof F.sugestaoFull === 'function') {
        const plano = new Set(acoes.filter(a => /full_envio$/.test(String(a.regra)) && a.item_id).map(a => String(a.item_id))), repoe = new Set([...ruptTodos, ...cicloTodos])
        const cand = livre('envio_full_sugerido', ab.filter(i => plano.has(String(i.id)) && i.logistica && i.logistica !== 'fulfillment' && !repoe.has(i)))
        // quantidade no MESMO formato do 📦 do plano («*conservador a base un*»), nunca mais que o estoque próprio; a premissa (ritmo de 28 dias) é a nota do plano
        const faixa = g => { let c = 0, b = 0, lim = false
          for (const i of g) { const s = sug(i)?.cenarios, e = Math.max(0, i.estoque ?? 0); if (!Number.isInteger(s?.conservador)) return null
            const b0 = Number.isInteger(s.base) ? Math.max(s.base, s.conservador) : s.conservador; lim ||= e < b0; c += Math.min(s.conservador, e); b += Math.min(b0, e) }
          return c > 0 ? `*${c === b ? b : `${c} a ${b}`} un*${lim ? ' (limitado ao estoque atual)' : ''}` : null }
        const full = porNome(cand).map(([nome, g]) => ({ nome, g, x: faixa(g) })).filter(f => f.x)
        if (full.length) out.push(item('envio_full_sugerido', full.flatMap(f => f.g.map(i => i.id)), { n: full.length, lista: juntar(full.map(f => `${f.nome}: enviar ${f.x}`), cfg.teto.lista_nomes, '; ') }, full.flatMap(f => f.g.map(i => ({ id: i.id, cenarios: sug(i)?.cenarios ?? null, estoque: i.estoque })))))
      }
      // mesma condição da regra anuncio_restrito do plano (plano-anuncios.js): pausado/revisão/inativo com venda relevante no período anterior; 'closed' é decisão do cliente
      const gmv0 = its.reduce((t, i) => t + (i.r0 || 0), 0)
      const restr = livre('anuncio_restrito', its.filter(i => ['paused', 'under_review', 'inactive'].includes(i.status) && (i.r0 || 0) > 0 && i.r0 >= gmv0 * FOCO.min_impacto_pct_gmv / 100))
      // urgente ligado: o pausado já dito (no urgente ou no ⏸️ de um plano) e sem piora sai da lista, como nos outros avisos de estoque (memória por produto, 14/10)
      if (restr.length) { const { mostrar: rs, m } = separar('estoque', restr), vis = rs.slice(0, cfg.teto.lista_nomes), nomes = nomesDe(vis, its)
        // ponytail (13/10): pausado POR FALTA DE ESTOQUE (o ML pausa sozinho) pede reposição, não «conferir a situação» (Bee Bikini: 10 de 10 sem estoque)
        const se = rs.filter(i => i.estoque === 0).length, fecho = se === rs.length ? (se === 1 ? 'Está sem estoque: repor faz ele voltar para a busca.' : 'Estão sem estoque: repor faz eles voltarem para a busca.') : se ? `${se} deles ${se === 1 ? 'está' : 'estão'} sem estoque (repor traz de volta); nos outros, vale conferir a situação na sua conta.` : 'Vale conferir a situação na sua conta.'
        out.push(item('anuncio_restrito', restr.map(i => i.id), { n: rs.length, lista: vis.map((i, k) => `• ${nomes[k]}${i.permalink ? `\n  ${i.permalink}` : ''}`).join('\n') + (rs.length > vis.length ? `\n• e mais ${rs.length - vis.length}` : ''), fecho }, restr.map(i => ({ id: i.id, status: i.status, estoque: i.estoque, ...m.get(i) })))) }
    })
    fonte('saude', () => {
      const s = F.saude(c)
      if (!s?.dia || s.do_dia === false) { cobertura.saude = s?.dia ? 'pendente:leitura_velha' : 'pendente:sem_coleta'; return }   // leitura velha não é "hoje" (regra 18 do plano: do_dia)
      const pend = s.pendente || {}, L = s.listas || {}
      for (const [t, b] of Object.entries(BLOCO_SAUDE)) if (pend[b]) semLeitura.add(t)
      if (!pend.atrasos && s.atrasos > 0 && contaLivre('envio_atrasado')) out.push(item('envio_atrasado', (L.atrasos || []).map(a => a.order_id), { n: s.atrasos }, (L.atrasos || []).map(a => ({ order_id: a.order_id, prazo: a.prazo_despacho }))))
      if (!pend.reclamacoes) {
        const alvo = (L.claims || []).filter(k => /mediat|dispute/i.test(String(k.estagio || '')) || (k.prazo_resposta && Date.parse(k.prazo_resposta) - ms < 24 * 3600e3))
        if (alvo.length && contaLivre('reclamacao_mediacao')) { const prazos = alvo.map(k => k.prazo_resposta).filter(Boolean).sort(); out.push(item('reclamacao_mediacao', alvo.map(k => k.claim_id), { n: alvo.length, prazo: prazos[0] ? ` até ${dm(prazos[0])}` : '' }, alvo.map(k => ({ claim_id: k.claim_id, estagio: k.estagio })))) }
      }
      if (!pend.perguntas && s.perguntas?.mais_de_24h > 0 && contaLivre('perguntas_sem_resposta')) { const q = (L.perguntas || []).filter(p => p.mais_de_24h); out.push(item('perguntas_sem_resposta', q.length ? q.map(p => p.question_id) : [s.perguntas.mais_de_24h], { n: s.perguntas.mais_de_24h }, q.map(p => ({ question_id: p.question_id })))) }
      if (!pend.reputacao && s.reputacao?.nivel) {
        // projeção da regra reputacao_em_risco do plano: fora do verde OU, com amostra mínima, taxa ≥ fração do limite (limiares de algoritmo.json, premissa)
        const r = s.reputacao, foraVerde = r.nivel !== cfg.reputacao_nivel_verde, amostra = r.vendas_periodo != null && r.vendas_periodo >= LIM.reputacao_min_vendas
        const LR = { claims: LIM.reputacao_claims_max_pct, atraso: LIM.reputacao_atraso_max_pct, cancel: LIM.reputacao_cancel_max_pct }
        const taxas = [['claims', 'reclamações', r.taxa_claims], ['atraso', 'envios atrasados', r.taxa_atraso], ['cancel', 'cancelamentos', r.taxa_cancel]].filter(([, , v]) => Number.isFinite(v))
          .map(([k, rot, v]) => ({ k, rot, v, lim: LR[k], razao: v / LR[k] })).sort((a, b) => b.razao - a.razao)
        const pior = taxas[0]
        // ponytail (13/10): ao CLIENTE, «fora do verde» só a partir do amarelo; verde-claro com taxas abaixo da fração não é risco que ele possa agir (a regra interna do plano continua olhando qualquer nível ≠ verde)
        const taxaAlerta = !!(amostra && pior && pior.razao >= LIM.reputacao_fracao_alerta), nivelAlerta = foraVerde && (cfg.reputacao_niveis_cliente || ['3_yellow', '2_orange', '1_red']).includes(r.nivel)
        if ((nivelAlerta || taxaAlerta) && contaLivre('reputacao_em_risco')) {
          const m = pior || { rot: 'reclamações', v: null, lim: LR.claims }
          out.push({ ...item('reputacao_em_risco', [`${r.nivel}|${m.rot}|${Math.round((m.v ?? 0) * 10)}`], { nivel: NIVEL[r.nivel] || String(r.nivel), metrica: taxaAlerta ? `; taxa de ${m.rot} em ${pct1(m.v)}% (limite ${pct1(m.lim)}%)` : ' no termômetro de reputação do Mercado Livre' }, [{ nivel: r.nivel, taxa_claims: r.taxa_claims, taxa_atraso: r.taxa_atraso, taxa_cancel: r.taxa_cancel }]) })
        }
      }
      // mesma condição da regra full_estoque_antigo do plano: bloco Full lido, disponível > 0 e idade (idade_dias; até lá, dias sem venda estimados) ≥ limiar
      // trava (12/10): produto que vendeu nos últimos 28 dias nunca é «parado» (estoque compartilhado no Full já vem agrupado por inventory_id da coleta); sem o diagnóstico não dá para conferir: não detecta nem resolve
      const idade = f => f.idade_dias ?? f.dias_sem_venda, vendeu = diag?.disponivel ? new Set((diag.itens || []).filter(i => (i.u || 0) > 0).map(i => String(i.id))) : null
      if (!vendeu) semLeitura.add('full_estoque_antigo')
      const full = pend.full || !vendeu ? [] : livre('full_estoque_antigo', (L.full || []).filter(f => f.disponivel > 0 && Number.isFinite(idade(f)) && idade(f) >= LIM.full_estoque_antigo_dias && !vendeu.has(String(f.item_id))), f => f.item_id)
      if (full.length) { const tt = titulosDe(c, full.map(f => f.item_id).filter(Boolean)); out.push(item('full_estoque_antigo', full.map(f => f.inventory_id || f.item_id), { n: full.length, d: LIM.full_estoque_antigo_dias, lista: listaNomes(full.map(f => tt.get(f.item_id) || 'produto em Full'), cfg.teto.lista_nomes, ['produto', 'produtos']) }, full.map(f => ({ item_id: f.item_id, inventory_id: f.inventory_id, dias_sem_venda: f.dias_sem_venda })))) }
    })
    fonte('estadoConta', () => {
      const e = F.estadoConta(c); if (!e || e.estado !== 'queda' || e.sinal_misto) return
      const forte = e.forca === 'forte' && e.significativo, tipo = forte ? 'queda_forte_conta' : 'queda_conta', j = e.janela?.atual || []
      if (!contaLivre(tipo)) return
      out.push(item(tipo, [e.forca || 'moderada'], { x: pct1(Math.abs(e.variacao_pct)), n: e.janela_dias, de: dm(j[0] || ''), ate: dm(j[1] || '') }, [{ variacao_pct: e.variacao_pct, z: e.z, janela: e.janela }]))
    })
    fonte('mudancasPreco', () => {
      // só o FATO (de/para/%/data) de uma mudança dos últimos preco_janela_dias (vai no plano de terça; antes era ontem/hoje). A regra preco_mudou_vendas_cairam mede uma
      // alta de ≥ 7 dias atrás: nunca é a mesma mudança, então não há frase causal aqui.
      // Só mudança feita FORA da assessoria (origemPreco): 'externa' vai ao cliente; 'nao_verificada' fica só para a equipe (interno); assessoria/promoção/sistema não viram aviso;
      // 'fim_de_promocao' (o preço voltou ao cheio porque a promoção acabou) vira o item interno promocao_encerrada («avaliar renovar»), nunca ao cliente.
      // «em anúncio curva A/B»: só anúncio PRESENTE no diagnóstico com curva A/B (fora dele = sem venda nem Ads em 56 dias); sem diagnóstico não detecta nem resolve
      if (!diag?.disponivel) { semLeitura.add('preco_alterado_drastico'); semLeitura.add('promocao_encerrada'); return }
      const curva = new Map((diag.itens || []).map(i => [i.id, i.curva]))
      const grandes = (F.mudancasPreco(c, { desde: addDias(hoje, -cfg.preco_janela_dias) }) || []).filter(m => FONTES_PRECO_EXTERNAS.includes(m.fonte) && Number.isFinite(m.variacao_pct) && Math.abs(m.variacao_pct) >= cfg.preco_drastico_pct)
      const origem = origensDe(c, grandes), fimPromo = new Map()
      for (const m of livre('preco_alterado_drastico', grandes, m => m.item_id)) {
        const o = origem(m)
        if (o === 'fim_de_promocao') { if (!fimPromo.has(m.item_id)) fimPromo.set(m.item_id, m); continue }
        if (!['A', 'B'].includes(curva.get(m.item_id)) || !['externa', 'nao_verificada'].includes(o)) continue
        out.push({ ...item('preco_alterado_drastico', [`${m.item_id}|${m.dia}|${m.para}`], { anuncio: curto(m.titulo || 'anúncio'), de: brl2(Number(m.de)), para: brl2(Number(m.para)), x: `${m.variacao_pct > 0 ? '+' : '−'}${pct1(Math.abs(m.variacao_pct))}`, data: origem.quando(m.dia) },
          [{ item_id: m.item_id, dia: m.dia, de: m.de, para: m.para, fonte: m.fonte, origem: o, aumento: Number(m.para) > Number(m.de), impacto: (p => p ? daPrev(p, p.horizonte_dias || 28) : null)(prevDe('preco_mudou_vendas_cairam', m.item_id)), ...marca('preco', m) }]), ...(o === 'nao_verificada' ? { interno: 'origem_nao_verificada' } : {}) })
      }
      if (fimPromo.size) { const u = [...fimPromo.values()]
        out.push(item('promocao_encerrada', u.map(m => `${m.item_id}|${m.dia}`), { n: u.length, lista: listaNomes(u.map(m => m.titulo || 'anúncio'), cfg.teto.lista_nomes, ['anúncio', 'anúncios']) }, u.map(m => ({ item_id: m.item_id, dia: m.dia, de: m.de, para: m.para, origem: 'fim_de_promocao' })))) }
    })
    fonte('promocoes', () => {
      const lim = new Date(ms + cfg.oferta_fim_dias * 86_400_000).toISOString().slice(0, 10)
      const vivas = livre('oferta_terminando', (F.promocoes(c) || []).filter(p => (p.status || 'started') === 'started' && p.fim && String(p.fim).slice(0, 10) >= hoje && String(p.fim).slice(0, 10) <= lim), p => p.item_id)
      if (vivas.length) out.push(item('oferta_terminando', vivas.map(p => `${p.item_id}|${String(p.fim).slice(0, 10)}`), { n: vivas.length, data: dm(vivas.map(p => String(p.fim).slice(0, 10)).sort().at(-1)), lista: listaNomes(vivas.map(p => p.titulo || p.nome || 'promoção'), cfg.teto.lista_nomes, ['promoção', 'promoções']) }, vivas.map(p => ({ item_id: p.item_id, fim: p.fim }))))
    })
    if (cobertura.acoes === 'ok') {
      if (acoes.some(a => /cadastrar_custos$/.test(String(a.regra)) && a.dados?.execucao?.caminho === 'cliente') && contaLivre('custos_nao_informados')) out.push(item('custos_nao_informados', ['custos'], {}, []))
      // queda depois de mudança de preço: SÓ a ação da regra preco_mudou_vendas_cairam (≥ 7 dias depois da alta, vendas −15%, controle estável), com os números da
      // evidência da própria ação (dados.evidencia_preco); sem número não nasce. A mudança medida passa pelo mesmo filtro de origem do preço drástico.
      const ev = a => { const e = a.dados?.evidencia_preco; return e && /^\d{4}-\d{2}-\d{2}$/.test(String(e.dia)) && Number(e.de) > 0 && Number(e.para) > 0 && Number.isFinite(e.queda_pct) && e.queda_pct > 0 ? e : null }
      const qp = acoes.filter(a => /preco_mudou_vendas_cairam$/.test(String(a.regra)) && a.item_id && ev(a)).map(a => ({ a, e: ev(a), m: { item_id: a.item_id, dia: ev(a).dia, fonte: ev(a).fonte, para: ev(a).para } }))
      if (qp.length) {
        const origem = origensDe(c, qp.map(x => x.m)), tt = titulosDe(c, qp.filter(x => !x.a.dados?.item?.titulo).map(x => x.a.item_id))
        const fimPromo = []
        for (const { a, e, m } of livre('queda_por_preco', qp, x => x.a.item_id)) {
          const o = origem(m)
          // trava 1 (12/10): a queda veio depois que a PROMOÇÃO terminou e o preço voltou ao cheio — nunca ao cliente; vira o aviso interno «avaliar renovar», com a queda medida
          if (o === 'fim_de_promocao') { fimPromo.push({ a, e }); continue }
          if (!['externa', 'nao_verificada'].includes(o)) continue        // tarefa da equipe, promoção, sistema: nunca ao cliente
          const ctrl = Number.isFinite(e.controle_pct) && e.controle_pct > LIM.preco_controle_max_queda_pct ? `subiram ${pct1(e.controle_pct)}%` : 'ficaram estáveis'
          const perma = (diag?.itens || []).find(i => i.id === a.item_id)?.permalink || a.dados?.item?.permalink || ''
          out.push({ ...item('queda_por_preco', [`${a.item_id}|${e.dia}`], { anuncio: curto(a.dados?.item?.titulo || tt.get(a.item_id) || 'anúncio'), data: origem.quando(e.dia), de: brl2(Number(e.de)), para: brl2(Number(e.para)), y: pct1(e.queda_pct), ctrl, link: perma ? `\n  ${perma}` : '' },
            [{ item_id: a.item_id, acao: a.id, regra: a.regra, dia: e.dia, de: e.de, para: e.para, queda_pct: e.queda_pct, controle_pct: e.controle_pct ?? null, fonte: e.fonte, origem: o, aumento: Number(e.para) > Number(e.de), impacto: a.previsao?.cenarios ? daPrev(a.previsao, a.previsao.horizonte_dias || 28) : null, ...marca('preco', { item_id: a.item_id, para: e.para }) }]), ...(o === 'nao_verificada' ? { interno: 'origem_nao_verificada' } : {}) })
        }
        if (fimPromo.length) out.push(item('promocao_encerrada', fimPromo.map(({ a, e }) => `${a.item_id}|${e.dia}|queda`), { n: fimPromo.length,
          lista: juntar(fimPromo.map(({ a, e }) => `${curto(a.dados?.item?.titulo || tt.get(a.item_id) || 'anúncio')} (vendas −${pct1(e.queda_pct)}% desde então)`), cfg.teto.lista_nomes) },
          fimPromo.map(({ a, e }) => ({ item_id: a.item_id, acao: a.id, dia: e.dia, de: e.de, para: e.para, queda_pct: e.queda_pct, origem: 'fim_de_promocao' }))))
      }
      // ACOS do anúncio na pergunta: campanha de visibilidade com o ACOS acima do alvo combinado NÃO silencia o aviso (o predicado compara; acosDaAcao lê o diagnóstico ou a ação)
      const ads = livre('ads_sem_retorno', acoes.filter(a => /ads_(reduzir|abaixo_meta)$/.test(String(a.regra)) && a.item_id), a => a.item_id, a => a.regra, a => ({ acos: acosDaAcao(a, (diag?.itens || []).find(i => i.id === a.item_id)) }))
      if (ads.length) {
        const custo = diag ? ads.reduce((t, a) => t + ((diag.itens || []).find(i => i.id === a.item_id)?.ads?.custo || 0), 0) : null
        out.push(item('ads_sem_retorno', ads.map(a => a.item_id), { n: new Set(ads.map(a => a.item_id)).size, gasto: custo > 0 ? ` (R$ ${brl(custo)} em 28 dias)` : '' }, ads.map(a => ({ item_id: a.item_id, regra: a.regra }))))
      }
    }
    fonte('pendencias', () => {
      const av = F.pendencias(c) || {}
      let depLivre = null                                     // conta alinhada para a cobrança do cliente: lida uma vez, só se algum item disparar
      for (const p of av.itens || []) {
        // SÓ Mercado Livre (12/10): o grupo de WhatsApp é o do ML — pendência de Shopee, Amazon, TikTok ou Magalu nunca entra aqui (o consultor trata no canal dele)
        if (!['ml', 'geral'].includes(p.canal) || p.fonte !== 'tarefa' || p.desde_aproximado || !Number.isFinite(p.dias) || p.dias < cfg.dependencia_dias || p.item === 'retorno_pendente') continue
        if (!(depLivre ??= contaLivre('dependencia_vencida'))) continue
        const ids = idsDe(p, av.tarefas || []), ex = typeof F.explicar === 'function' ? F.explicar(p) : null
        out.push(item('dependencia_vencida', [p.item, p.canal, ...ids], { rotulo: p.rotulo, desde: dm(p.desde), precisamos: str(ex?.o_que_precisamos) }, [{ item: p.item, canal: p.canal, tarefas: ids }]))
      }
    })
    return out
  }

  // ── avaliação: detecta, audita, deduplica, aplica cooldown, resolve ────────────────────────────────────────────────────
  async function avaliar(bruto) {
    const c = exigirCliente(bruto), cobertura = {}, semLeitura = new Set(), alinhados = new Set(), res = { cliente: c, novos: 0, resolvidos: 0, reabertos: 0, suprimidos: 0, alinhados: 0, internos: 0, itens: [] }
    const al = predicadoDe(c), internosNovos = []
    // migração (12/10/2026): linha de tipo que virou dono 'assessoria' e ainda não saiu (pendente/agrupado/falhou, ou esperando cooldown) passa a 'interno' — não some, não vira «Resolvido»
    for (const r of vivosDe.all(c)) if (donoDe(r.tipo) === 'assessoria' && (['pendente', 'agrupado', 'falhou'].includes(r.estado) || (r.estado === 'suprimido' && r.motivo === 'cooldown'))) {
      atualizar(r.id, { estado: 'interno', motivo: 'assessoria', lote_id: '' }); res.internos++; internosNovos.push(r)
    } else if (donoDe(r.tipo) === 'cliente' && !urgente(r.tipo) && (r.estado === 'pendente' || (r.estado === 'suprimido' && ['cooldown', 'teto_diario'].includes(r.motivo)))) {
      atualizar(r.id, { estado: 'agrupado', motivo: '' })                // migração (12/10): o não urgente não tem cooldown nem lote imediato — espera o plano de terça
    }
    const atuais = detectar(c, cobertura, semLeitura, alinhados, al)
    const nomes = (await nomesInternos(c)) || [], opt = { nomesInternos: nomes, permitidos: [c] }
    const vivos = vivosDe.all(c)
    // resolve só o que a fonte LIDA nesta passada deixou de apontar (fonte indisponível/pendente/erro mantém tudo como está: dia sem coleta não é zero)
    const lido = tipo => cobertura[COB[cat[tipo].fonte] || cat[tipo].fonte] === 'ok' && !semLeitura.has(tipo)
    // o que saiu da detecção porque passou a ser coberto por alinhamento com o cliente NÃO resolveu: fica 'suprimido' motivo 'alinhado' (vivo, então o tipo nunca ganha
    // linha «Resolvido»; avisado_resolucao = 1 para não aparecer depois). Quando o alinhamento acaba e a condição persiste, a mesma assinatura reabre logo abaixo.
    // A fonte pode já chegar filtrada pelo MESMO predicado (pendências avaliadas com ele; ação alinhada que virou obsoleta no plano): por isso a linha que sumiu também
    // pergunta ao predicado pelos itens dela (itens_json: item_id/id e regra) ou, sem anúncio, pela regra do tipo na conta.
    const coberta = r => {
      if (!al) return false
      const its = parse(r.itens_json, []), comItem = its.filter(x => x && (x.item_id || x.id))
      return comItem.length ? comItem.some(x => al({ item: String(x.item_id || x.id), regra: x.regra || REGRA_DO_TIPO[r.tipo], aviso: true }).sim) : al({ regra: REGRA_DO_TIPO[r.tipo], aviso: true }).sim
    }
    for (const r of vivos) if (lido(r.tipo) && !atuais.some(a => a.tipo === r.tipo && a.assinatura === r.assinatura)) {
      if (alinhados.has(r.tipo) || coberta(r)) { if (!(r.estado === 'suprimido' && r.motivo === 'alinhado')) { atualizar(r.id, { estado: 'suprimido', motivo: 'alinhado', avisado_resolucao: 1 }); res.alinhados++ } continue }
      // tipo de janela, dono assessoria ou linha interna: resolve sem nunca virar «Resolvido» ao cliente
      atualizar(r.id, { estado: 'resolvido', resolvido_em: agora(), motivo: '', ...(cat[r.tipo].sem_resolucao || donoDe(r.tipo) === 'assessoria' || r.estado === 'interno' ? { avisado_resolucao: 1 } : {}) }); res.resolvidos++
    }
    // URGENTE de estoque e preço (14/10): linha que já saiu e segue de pé volta à fila do aviso quando tem produto a DIZER (detectar marca avisado:true o que já foi dito nos
    // últimos urgente.repeticao_dias sem piora, pela memória por produto gatilho_avisado): 'piora' (estoque zerou ou caiu a menos da metade; preço subiu de novo) ou 'repeticao'
    // (o produto saiu da memória; preço é janela: sai uma vez); o texto que volta só tem esses produtos, com o número de agora. Só com o urgente ligado.
    const rearmar = (r, a) => {
      if (!naHora() || !naLista(a.tipo) || !FAMILIA[a.tipo] || !['enviado', 'entregue'].includes(r.estado) || !a.itens.some(x => !x.avisado)) return ''       // só estoque e preço
      return a.itens.some(x => x.piora) ? 'piora' : cat[a.tipo].sem_resolucao ? '' : 'repeticao'
    }
    for (const a of atuais) {
      const texto = preencher(cat[a.tipo].template, a.vals).replace(/[^\S\n]+$/gm, '').trim()     // a quebra de linha fica (lista com link por linha)
      // só para a equipe: dono assessoria (motivo 'assessoria') ou mudança de preço de origem não verificada (motivo 'origem_nao_verificada'); texto interno, sem auditor, nunca sai
      const interno = donoDe(a.tipo) === 'assessoria' ? 'assessoria' : a.interno || ''
      const viol = interno ? [] : auditar(semFixos(texto), opt)          // o link do anúncio do próprio cliente (…/MLB-123…) não é ID interno; o resto passa pelo crivo
      const padrao = interno ? 'interno' : padraoDe(a.tipo)
      let r = vivos.find(x => x.tipo === a.tipo && x.assinatura === a.assinatura), volta = ''
      const itensJ = JSON.stringify(a.itens)
      if (r && interno) {
        const virou = ['pendente', 'agrupado', 'falhou'].includes(r.estado) || (r.estado === 'suprimido' && ['cooldown', 'alinhado'].includes(r.motivo))   // ainda não saiu: passa a interno
        if (virou) { atualizar(r.id, { estado: 'interno', motivo: interno, texto, classe: a.classe, lote_id: '', avisado_resolucao: 0 }); res.internos++; internosNovos.push(r) }
        else if (r.estado === 'interno' && (r.texto !== texto || r.classe !== a.classe || r.motivo !== interno)) atualizar(r.id, { texto, classe: a.classe, motivo: interno })
      } else if (r && r.estado === 'interno') {
        // a origem do preço foi verificada agora (fora da assessoria): a linha entra no fluxo do cliente, com auditor e cooldown como um item novo
        const cd = cooldownAtivo(c, a.tipo)
        atualizar(r.id, viol.length ? { estado: 'suprimido', motivo: `conteudo:${codigosDe(viol).join(',')}`, texto: '' } : { estado: cd ? 'suprimido' : padrao, motivo: cd ? 'cooldown' : '', texto, classe: a.classe }); res.reabertos++
      } else if (r) {
        if (r.estado === 'suprimido' && r.motivo === 'cooldown' && !cooldownAtivo(c, a.tipo)) { atualizar(r.id, { estado: padrao, motivo: '' }); res.reabertos++ }
        else if (r.estado === 'suprimido' && r.motivo === 'alinhado') { cooldownAtivo(c, a.tipo) ? atualizar(r.id, { motivo: 'cooldown', avisado_resolucao: 0 }) : (atualizar(r.id, { estado: padrao, motivo: '', avisado_resolucao: 0 }), res.reabertos++) }   // alinhamento acabou e a condição persiste
        else if (['pendente', 'agrupado'].includes(r.estado) && (r.texto !== texto || r.classe !== a.classe || r.itens_json !== itensJ) && !viol.length) atualizar(r.id, { texto, classe: a.classe, estado: padrao, itens_json: itensJ })   // mesmo assunto, número atualizado (ainda não saiu)
        else if (!viol.length && (volta = rearmar(r, a))) { atualizar(r.id, { estado: padrao, motivo: volta, texto, classe: a.classe, itens_json: itensJ, lote_id: '' }); res.reabertos++ }
        // não urgente que já saiu e continua de pé: entra de novo no próximo plano semanal (é o plano da semana, não um aviso único) com o número atualizado
        else if (!urgente(a.tipo) && ['enviado', 'entregue', 'falhou'].includes(r.estado) && r.texto !== texto && !viol.length) atualizar(r.id, { texto, classe: a.classe })
      } else {
        const estadoNovo = interno ? 'interno' : viol.length ? 'suprimido' : cooldownAtivo(c, a.tipo) ? 'suprimido' : padrao
        const motivo = interno || (viol.length ? `conteudo:${codigosDe(viol).join(',')}` : estadoNovo === 'suprimido' ? 'cooldown' : '')
        if (viol.length) log('aviso', `gatilhos ${c}: ${a.tipo} suprimido por conteúdo (${codigosDe(viol).join(',')})`)
        ins.run({ cliente: c, tipo: a.tipo, classe: a.classe, assinatura: a.assinatura, itens_json: itensJ, texto: viol.length ? '' : texto, estado: estadoNovo, motivo, em: agora() })
        res.novos++; if (estadoNovo === 'suprimido') res.suprimidos++
        if (interno) { res.internos++; internosNovos.push(a) }
      }
    }
    // aviso INTERNO à equipe (sino com som): uma notificação por passada com o que virou interno agora; dedupe de 24 h por (tipo, cliente) no notificar, com um tipo
    // por nível — o crítico (alerta) nunca é engolido por um info do mesmo dia. ponytail: outro interno do mesmo nível no dia fica só na lista «Só para a equipe» (nunca some de lá)
    if (internosNovos.length) {
      const tipos = [...new Set(internosNovos.map(x => x.tipo))], pior = internosNovos.map(x => cat[x.tipo]?.classe || x.classe).sort((x, y) => RANK[x] - RANK[y])[0]
      try { notificar({ tipo: pior === 'critico' ? 'aviso_assessoria_critico' : 'aviso_assessoria', nivel: NIVEL_INTERNO[pior] || 'info', titulo: `Só para a equipe (não vai ao cliente): ${tipos.length === 1 ? rotulo(tipos[0]) : `${tipos.length} avisos`} · ${c}`, corpo: tipos.map(rotulo).join('; '), cliente: c, link: `/cliente?cliente=${encodeURIComponent(c)}&aba=resumo`, dedupeMin: 24 * 60 }) }
      catch (e) { log('erro', `gatilhos ${c}: notificação interna ${String(e?.name || 'Error')}`) }
    }
    res.itens = vivosDe.all(c).map(publico); res.cobertura = cobertura
    return res
  }

  // ── lotes (1 lote = 1 mensagem): 'semanal' = plano de terça (idempotente por cliente + semana ISO); 'imediato' = urgente (até teto.itens_urgente pontos) ──
  const rotulo = tipo => cat[tipo]?.rotulo || tipo
  const rotuloCliente = c => notificacao(c).rotulo || rotuloPadrao(c)
  const tituloDe = (tipo, dia, hora) => tipo === 'semanal' ? `${TITULO.semanal} · ${dma(dia)}` : `${TITULO.imediato} · ${dma(dia)} · ${hora}`
  const nomesDe0 = c => { try { const x = nomesInternos(c); return Array.isArray(x) ? x : [] } catch { return [] } }
  // o texto inteiro passa pelo auditor; só as frases FIXAS aprovadas e os links de anúncio do ML saem do crivo (plano-semana-texto.js explica por quê)
  const auditarMensagem = (c, texto) => auditarLinhas(texto, auditar, { nomesInternos: nomesDe0(c), permitidos: [c, rotuloCliente(c)] })
  function montarLote(bruto, tipo = 'semanal', { gravar = true, origem = 'automatico', por = '', compor = null } = {}) {
    if (!LOTES.includes(tipo)) throw erro('tipo de lote inválido (imediato, semanal ou compras)')
    if (tipo === 'compras' && typeof compor !== 'function') throw erro('o micro-relatório de compras sai só pelo scripts/micro-compras.mjs')
    const c = exigirCliente(bruto), ms = agoraMs(), dia = hojeDe(c, ms), hora = horaDe(c, ms), vivos = vivosDe.all(c)
    const vazio = extra => ({ vazio: true, cliente: c, tipo, dia, texto_final: '', linhas: [], itens: [], n: 0, ...extra })
    let id, base, texto_final, extra = {}, avisar = []
    if (tipo === 'semanal') {
      const semana = semanaIso(dia)
      // o plano da semana já existe (pendente, falhou ou enviado): prévia e envio devolvem ESSE lote — o que o líder lê é o que sai (hash). O plano cancelado porque uma
      // linha mudou antes do reenvio (conteudo_mudou) não encerra a semana: remonta com o id da tentativa seguinte (a 1ª tentativa mantém o id de sempre). Idem o lote que
      // VENCEU sem sair (lote_vencido): a semana ISO começa na segunda, então um envio manual de segunda que falhou/ficou pendente não pode travar o plano de terça
      let ja
      for (let k = 0; ; k++) { id = sha(k ? `${c}|${semana}|semanal|${k}` : `${c}|${semana}|semanal`); ja = selLote.get(id); if (!(ja?.estado === 'falhou' && ['conteudo_mudou', 'lote_vencido'].includes(ja.motivo))) break }
      if (ja) return { ...publicoLote(ja), ja_existia: true }
      let d = null
      try { d = typeof F.planoSemana === 'function' ? F.planoSemana(c) : null } catch (e) { log('erro', `gatilhos ${c}: plano semanal ${String(e?.message ?? e).replace(/["'`][\s\S]*$/, '…').slice(0, 100)}`) }
      if (!d?.disponivel) return vazio({ semana, motivo: 'sem_dados' })          // sem diagnóstico não há plano (dia sem coleta não é zero)
      // linhas não urgentes do cliente que continuam de pé (novas ou já mandadas em outra semana); preço (janela) sai uma vez só. Os URGENTES que ainda não saíram (pendentes,
      // fora de lote) vão junto: na terça o plano sai antes do urgente e leva esses pontos (uma mensagem só, nunca o mesmo ponto duas vezes no mesmo tick); com «urgente
      // na hora» desligado, é por aqui que despacho vencido, reclamação, reputação, anúncio restrito e queda por preço chegam ao cliente
      // a ruptura em cooldown (urgente de ontem) também: o 📦 do plano fala dela pelo diagnóstico, então a linha é marcada como dita (achado de 14/10: senão o urgente do dia seguinte repetia)
      const semanais = vivos.filter(r => r.texto && paraCliente(r) && (urgente(r.tipo) ? (r.estado === 'pendente' || (BLOCO_DO_TIPO[r.tipo] && r.estado === 'suprimido' && r.motivo === 'cooldown')) && r.lote_id === ''
        : ['pendente', 'agrupado', 'enviado', 'entregue', 'falhou'].includes(r.estado) && !(cat[r.tipo].sem_resolucao && r.enviado_em)))
      // o que saiu no urgente nos últimos 7 dias não volta como novidade: ruptura vira «lembrete» no 📦; queda por preço que continua vira bloco «Lembrete: …»
      const sete = new Date(ms - 7 * 86_400_000).toISOString(), urgSemana = vivos.filter(r => urgente(r.tipo) && paraCliente(r) && ['enviado', 'entregue'].includes(r.estado) && r.enviado_em >= sete)
      const al = predicadoDe(c), livre = (regra, it) => !al || !al({ item: it ? String(it) : '', regra, aviso: true }).sim
      const memoS = memoAvisados(c, ms), todoDito = r => { const l = parse(r.itens_json, []); return l.length > 0 && l.every(x => { const s = memoS.get(`estoque|${idDe(x)}`); return !!s && !piorou('estoque', x, s) }) }
      // título de produto que o auditor reprova (ex.: «Nº1» = promessa) tira só a linha daquele produto; o resto do plano sai (antes derrubava a mensagem inteira)
      const barrados = new Set(), tituloOk = t => { const ok = !auditar(t, { nomesInternos: nomesDe0(c), permitidos: [c, rotuloCliente(c)] }).length; if (!ok) barrados.add(t); return ok }
      // perfil de informação (Etapa 3): ordem dos blocos (pedidos no topo) e nível; sem a fonte (ou com erro de leitura) o texto é o do tom aprovado, sem personalização
      let perfil = null
      if (typeof F.perfil === 'function') try { perfil = F.perfil(c) || null } catch (e) { log('erro', `gatilhos ${c}: perfil de informação ${String(e?.name || 'Error')}`) }
      const p = montarPlanoSemanal({ rotulo: rotuloCliente(c), hoje: dia, resumo: d.resumo, itens: d.itens, fullParado: d.fullParado, entregas: d.entregas, custosInformados: d.custosInformados,
        limiares: { ...LIM, min_unidades_item: FOCO.min_unidades_item, min_impacto_pct_gmv: FOCO.min_impacto_pct_gmv }, tituloOk, maxLinhas: cfg.teto.lista_nomes, perfil, info: d.relatorio || {},
        // ⏸️ cujos produtos TODOS já foram ditos no urgente dos últimos dias (campeão zerado) e não pioraram = lembrete, não novidade (achado de 14/10)
        extras: [...semanais.map(r => ({ id: r.id, tipo: r.tipo, texto: r.texto, ...(r.tipo === 'anuncio_restrito' && todoDito(r) ? { lembrete: true } : {}) })), ...urgSemana.filter(r => r.tipo === 'queda_por_preco').map(r => ({ tipo: r.tipo, texto: r.texto, lembrete: true }))],
        jaAvisados: urgSemana.filter(r => r.tipo === 'ruptura_curva_a').flatMap(r => parse(r.itens_json, []).map(x => x.id)), livre })
      if (barrados.size) log('aviso', `gatilhos ${c}: ${barrados.size} produto(s) fora do plano semanal pelo auditor do título`)   // o título não vai ao log
      if (!p.texto) return vazio({ semana })                                     // com perfil, sai com qualquer bloco que traga dado (não só com ação no plano)
      // só a linha que ENTROU no texto é marcada como enviada: a do bloco do diagnóstico (📦 🔄 💡 📊) se o bloco entrou; a linha de gatilho se ela mesma entrou (teto por bloco)
      base = semanais.filter(r => BLOCO_DO_TIPO[r.tipo] ? p.blocos.includes(BLOCO_DO_TIPO[r.tipo]) : p.usados.includes(r.id))
      texto_final = p.texto; extra = { semana, blocos: p.blocos, n_acoes: p.n_acoes, ...(p.secoes ? { secoes: p.secoes, perfil: { fonte: perfil.fonte || '', nivel: perfil.nivel || 'padrao' } } : {}) }
    } else if (tipo === 'compras') {
      // MICRO-RELATÓRIO DE COMPRAS (15/10/2026): texto do composer do script (montarMicroCompras sobre o diagnóstico do DIA, sem depender de ação do plano), mesmo piso em R$
      // do urgente; sem linha de gatilho_cliente (base vazia): os produtos ditos vão para gatilho_lote_produto e, no envio, para a memória gatilho_avisado (família estoque)
      const m = compor(c, { dia }) || {}
      if (!m.texto) return vazio({ motivo: m.motivo || 'nada_de_compras' })
      if ((cfg.urgente.impacto_min_reais || 0) > 0 && (m.total?.b ?? 0) < cfg.urgente.impacto_min_reais) return vazio({ motivo: 'abaixo_do_piso', total: m.total || null })
      base = []; avisar = Array.isArray(m.avisar) ? m.avisar : []; texto_final = m.texto
      extra = { total: m.total || null, n: m.n, resto: m.resto || 0, teto_dia: lotesNoDia(c, dia, 'compras') >= cfg.teto.lotes_imediatos_dia }
      id = sha(`${c}|${dia}|compras|${sha(texto_final)}`)
    } else {
      // URGENTE de ESTOQUE e PREÇO (14/10/2026): só os tipos de cfg.urgente.tipos, fora de lote; preço só quando SUBIU (o que baixou espera o plano de terça); produto avisado
      // nos últimos urgente.repeticao_dias numa linha da mesma família (enviada, mesmo que já resolvida) não volta, salvo piora; maior impacto em R$ primeiro; até
      // teto.itens_urgente pontos, o resto vira «e mais N» e sai no próximo aviso (1 mensagem por dia: teto.lotes_imediatos_dia)
      // o produto já dito sem piora saiu do texto na detecção (avisado:true, memória por produto): linha só com produtos já ditos não vai
      const subiu = r => FAMILIA[r.tipo] !== 'preco' || parse(r.itens_json, []).every(x => x.aumento === true), temNovo = r => parse(r.itens_json, []).some(x => x && !x.avisado)
      const cand = vivos.filter(r => r.lote_id === '' && r.texto && paraCliente(r) && naLista(r.tipo) && ['pendente', 'agrupado'].includes(r.estado) && subiu(r) && temNovo(r))
        .map(r => ({ r, imp: impactoDaLinha(parse(r.itens_json, [])) })).sort((a, b) => RANK[a.r.classe] - RANK[b.r.classe] || (b.imp?.b ?? -1) - (a.imp?.b ?? -1) || a.r.id - b.r.id)
      const vai = cand.slice(0, cfg.teto.itens_urgente); base = vai.map(x => x.r)
      if (!base.length) return vazio()
      const u = montarUrgente({ rotulo: rotuloCliente(c), itens: vai.map(x => ({ tipo: x.r.tipo, texto: x.r.texto, impacto: x.imp })), max: cfg.teto.itens_urgente, resto: cand.length - vai.length })
      // ponytail (14/10): aviso cujo total em jogo (cenário base) fica abaixo de urgente.impacto_min_reais não sai (R$ 4 a 8 não justifica mensagem); o produto espera o plano de terça
      if ((cfg.urgente.impacto_min_reais || 0) > 0 && (u.total?.b ?? 0) < cfg.urgente.impacto_min_reais) return vazio()
      texto_final = u.texto; extra = { total: u.total, resto: cand.length - vai.length, teto_dia: lotesNoDia(c, dia, 'imediato') >= cfg.teto.lotes_imediatos_dia }
      id = sha(`${c}|${dia}|imediato|${base.map(r => r.id).sort().join(',')}`)
    }
    const viol = auditarMensagem(c, texto_final)
    if (viol.length) { log('aviso', `gatilhos ${c}: lote ${tipo} bloqueado por conteúdo (${codigosDe(viol).join(',')})`); return { bloqueado: true, cliente: c, tipo, dia, motivo: `conteudo:${codigosDe(viol).join(',')}`, texto_final: '', linhas: [], itens: [], n: 0 } }
    const rel = lerCfgRelatorio(), n_partes = dividirMensagem(texto_final, { max: rel.whatsapp_max_caracteres, continua: rel.continua }).length   // WhatsApp: em quantas mensagens sai
    const out = { id, cliente: c, tipo, dia, titulo: tituloDe(tipo, dia, hora), linhas: texto_final.split('\n'), texto_final, hash: sha(texto_final), itens: base.map(publico), n: extra.n_acoes ?? base.length, n_partes, estado: 'previa', ...extra }
    if (!gravar) return out
    if (tipo !== 'semanal' && lotesNoDia(c, dia, tipo) >= cfg.teto.lotes_imediatos_dia) { for (const r of base) if (r.motivo !== 'teto_diario') atualizar(r.id, { motivo: 'teto_diario' }); return { ...out, teto: true, motivo: 'teto_diario', estado: 'teto' } }
    if (selLote.get(id)) return { ...publicoLote(selLote.get(id)), ja_existia: true }
    handle.transaction(() => {
      insLote.run({ id, cliente: c, tipo, dia, itens_ids_json: JSON.stringify(base.map(r => r.id)), texto_final, hash: out.hash, canais_json: JSON.stringify(canaisLigados(notificacao(c))), origem, por, em: agora() })
      for (const r of base) atualizar(r.id, { lote_id: id, motivo: '', ...(r.estado === 'suprimido' ? { estado: 'pendente' } : {}) })
      for (const a of avisar) if (a && a.id) insLoteProduto.run(id, String(a.id), JSON.stringify(a.snap || {}))
    })()
    return { ...out, estado: 'montado' }
  }

  // ── elegibilidade (automático): chave global, cliente Ativo, não prospect, liberado por líder, canal ligado, janela/silêncio no fuso do cliente ─
  // tipo 'imediato' (urgente de estoque e preço, 14/10/2026): sem liberado_por quando a regra da liberação automática está no config e o grupo do ML está ligado; exige a
  // primeira coleta completa; o início é urgente.inicio_envios. O plano semanal (tipo 'semanal') não muda.
  function elegivel(bruto, { manual = false, tipo = 'semanal' } = {}) {
    const c = exigirCliente(bruto), row = selCliente(c), urg = tipo !== 'semanal'   // compras (micro) segue as regras do urgente
    if (!row) return { ok: false, motivo: 'cliente_inelegivel' }
    if (!cfg.status_elegiveis.map(normNome).includes(normNome(row.status))) return { ok: false, motivo: 'cliente_inelegivel' }
    const n = notificacao(c)
    if (!canaisLigados(n).length) return { ok: false, motivo: 'sem_canal' }
    // manual (decisão do líder, com prévia): ignora chave, liberação e janela, mas NÃO a integração ML de fato nem o início (decisões 3 e 6: nenhum envio antes de inicio_envios)
    if (manual) { const i = integracaoDe(c); return !i.ok ? { ok: false, motivo: i.motivo } : antesDoInicio(c, tipo) ? { ok: false, motivo: 'antes_do_inicio' } : urg && !coletaOk(c) ? { ok: false, motivo: 'coleta_incompleta' } : { ok: true } }
    if (!ligado()) return { ok: false, motivo: 'interruptor_desligado' }
    if (!n.liberado_por && !(urg && autoLiberado(n))) return { ok: false, motivo: 'nao_liberado' }
    const i = integracaoDe(c); if (!i.ok) return { ok: false, motivo: i.motivo }          // só cliente com integração ML de fato (12/10/2026)
    if (urg && !coletaOk(c)) return { ok: false, motivo: 'coleta_incompleta' }
    if (antesDoInicio(c, tipo)) return { ok: false, motivo: 'antes_do_inicio' }
    if (!dentroDaJanela(horaDe(c), { janela: cfg.janela, silencio: n.silencio })) return { ok: false, motivo: 'fora_da_janela' }
    return { ok: true }
  }
  // liberação AUTOMÁTICA do urgente (regra registrada em cfg.urgente.liberacao_automatica): só quem a REGRA liberou (marca auto_liberado, gravada só por autoLiberar) com o grupo
  // do ML ligado e sem auto_bloqueado (revogado ou destino trocado: achado de 14/10 — «Revogar» e a troca de grupo não paravam o urgente); o plano semanal exige liberado_por
  const autoLiberado = n => !!str(cfg.urgente.liberacao_automatica) && n.auto_liberado && !n.auto_bloqueado && n.canais.whatsapp.ligado && WHATS.test(n.canais.whatsapp.destino)
  const MSG = {
    interruptor_desligado: 'A chave geral dos avisos automáticos está desligada: nada sai sozinho.', nao_liberado: 'O cliente ainda não foi liberado (líder ou consultor) para receber avisos.',
    cliente_inelegivel: 'Só clientes Ativos recebem avisos.', sem_canal: 'Nenhum canal de aviso ligado para este cliente.', fora_da_janela: `Fora da janela de envio (${cfg.janela.inicio} às ${cfg.janela.fim}) ou dentro do silêncio do cliente.`,
    cooldown: 'Já houve um aviso urgente deste tipo recentemente: o assunto espera o próximo ciclo.', teto_diario: 'Limite diário de avisos urgentes deste cliente atingido: sai amanhã.',
    sem_dados: 'Sem o diagnóstico da conta (vendas e estoque do Mercado Livre) não há plano da semana para montar agora.',
    n8n_nao_configurado: 'A automação de entrega (n8n) ainda não está configurada: configure PLACE_GATILHOS_URL e PLACE_GATILHOS_SECRET.', conteudo: 'O texto não passou na auditoria de conteúdo: nada foi enviado.',
    retry_janela: 'Este lote foi tentado há menos de 5 minutos (ou está saindo agora): aguarde antes de tentar de novo.', vazio: 'Nada a avisar para este cliente agora.', canal_notion_sem_teste: 'O Notion não passa pelo n8n: use a prévia e o envio manual.',
    alinhado: 'Coberto por um alinhamento com o cliente: o aviso não sai enquanto o alinhamento valer.',
    coleta_incompleta: 'A primeira coleta do Mercado Livre ainda não cobriu os 28 dias: o aviso de estoque e preço espera a coleta completa.',
    piora: 'Piorou desde o último aviso (estoque zerou ou caiu a menos da metade; preço subiu de novo): volta no próximo aviso de estoque e preço.',
    repeticao: 'Continua de pé depois de uma semana do aviso: volta no próximo aviso de estoque e preço.',
    ...MOTIVOS_INTEGRACAO, integracao_indisponivel: 'Não deu para conferir a integração com o Mercado Livre agora: nada sai sozinho até conferir.',
    antes_do_inicio: `Os envios (automáticos, manuais e o teste de canal) começam em ${cfg.inicio_envios ? cfg.inicio_envios.split('-').reverse().join('/') : '—'}${cfg.urgente.inicio_envios ? ` (o aviso de estoque e preço, em ${cfg.urgente.inicio_envios.split('-').reverse().join('/')})` : ''}: até lá, só a prévia.`,
    assessoria: 'Trabalho da assessoria: só para a equipe, nunca vai ao cliente.',
    origem_nao_verificada: 'Não deu para confirmar que a mudança de preço foi feita fora da Place2u (tarefas, promoções ou anúncios sem leitura recente, ou tarefa de preço sem anúncio): só a equipe vê; confira antes de falar com o cliente.',
    conteudo_mudou: 'Um ponto deste lote mudou antes do reenvio (alinhado ou resolvido): o lote foi cancelado e os demais pontos voltaram à fila.',
    lote_vencido: 'A mensagem de um dia anterior não saiu; os pontos voltaram à fila (urgente: no próximo aviso; o resto: no plano da próxima terça).',
  }
  const textoMotivo = cod => MSG[String(cod ?? '').split(':')[0]] || (cod ? 'Motivo registrado no log do servidor.' : '')

  // ── envio de um lote (delegado ao gatilhos-envio.js injetado); sem retry dentro de retry_min ───────────────────────────
  const emVoo = new Set()                  // ponytail: lock em memória por lote (processo único); tick + clique manual no mesmo lote = um só POST ao n8n
  async function enviarLote(loteId, { origem = 'automatico', por = '' } = {}) {
    const l = selLote.get(str(loteId)); if (!l) throw erro('lote não encontrado', 404)
    if (['entregue', 'enviado'].includes(l.estado)) return { ok: false, estado: l.estado, motivo: 'ja_enviado', mensagem: 'este lote já saiu' }
    if (emVoo.has(l.id) || (l.tentado_em && agoraMs() - Date.parse(l.tentado_em) < cfg.retry_min * 60_000)) return { ok: false, estado: l.estado, motivo: 'retry_janela', mensagem: MSG.retry_janela }
    if (!envio) return { ok: false, estado: 'pendente', motivo: 'n8n_nao_configurado', mensagem: MSG.n8n_nao_configurado }
    // o texto do lote é congelado: se alguma linha saiu dele (alinhada → suprimido, resolvida, tirada do lote), reenviar falaria de algo que não vale mais.
    // O lote é cancelado (conteudo_mudou) e as linhas vivas voltam à fila: o imediato remonta no mesmo tick; o plano semanal remonta (nova tentativa) dentro da janela de terça.
    const idsLote = parse(l.itens_ids_json, []), linhas = idsLote.map(id => selId.get(id))
    // linha que virou dono 'assessoria' (ou interna) também cancela: o que é da equipe nunca sai, nem num lote montado antes
    if (linhas.some(r => !r || r.lote_id !== l.id || ['suprimido', 'resolvido', 'interno'].includes(r.estado) || !paraCliente(r))) {
      atualizarLote(l.id, { estado: 'falhou', motivo: 'conteudo_mudou' })
      for (const r of linhas) if (r && r.lote_id === l.id && ['pendente', 'agrupado', 'falhou'].includes(r.estado)) atualizar(r.id, { lote_id: '', estado: voltaFila(r), motivo: voltaFila(r) === 'interno' ? 'assessoria' : '' })
      if (l.tipo === 'semanal') estado.set(`gatilhos_semanal:${l.cliente}`, '')    // o plano não some até a outra terça: dentro da janela ele remonta (nova tentativa, montarLote)
      log('info', `gatilhos ${l.cliente}: lote ${l.tipo} cancelado antes do reenvio (conteúdo mudou)`)
      return { ok: false, estado: 'falhou', motivo: 'conteudo_mudou', mensagem: MSG.conteudo_mudou }
    }
    emVoo.add(l.id)
    try {
      // urgente de cliente liberado SÓ pela regra automática (sem liberado_por): só o grupo do ML («alerta de estoque e preço ao grupo do ML»), nunca e-mail/Notion
      const n0 = notificacao(l.cliente), n = l.tipo === 'compras' || (l.tipo === 'imediato' && !n0.liberado_por) ?   // micro de compras: só WhatsApp (pedido do David)
       { ...n0, canais: Object.fromEntries(Object.entries(n0.canais).map(([k, v]) => [k, k === 'whatsapp' ? v : { ...v, ligado: false }])) } : n0
      const canais = canaisLigados(n), ids = idsLote
      // reenvio (manual): o canal que já tem recibo 'entregue' não recebe de novo; o recibo 'falhou' sai antes de postar, para o recibo novo daquele canal ser aceito
      const antigos = Object.fromEntries(Object.entries(parse(l.recibos_json, {})).filter(([, v]) => v?.estado === 'entregue'))
      const nEnvio = { ...n, canais: Object.fromEntries(Object.entries(n.canais).map(([k, v]) => [k, antigos[k] ? { ...v, ligado: false } : v])) }
      const titulo = TITULO[l.tipo] ? tituloDe(l.tipo, l.dia, horaDe(l.cliente, Date.parse(l.criado_em) || agoraMs())) : l.texto_final.split('\n')[0]
      let r
      try { r = await envio.enviar({ lote: { id: l.id, tipo: l.tipo, cliente: l.cliente, texto: l.texto_final, titulo, hash: l.hash }, notificacao: nEnvio }) }
      catch (e) { log('erro', `gatilhos ${l.cliente}: envio do lote falhou (${String(e?.name || 'Error')})`); r = { estado: 'falhou', motivo: 'erro_interno', recibos: {} } }
      const em = agora(), recibos = { ...antigos, ...(r.recibos || {}) }
      const saiu = ['enviado', 'entregue'].includes(r.estado), algumEntregue = saiu || Object.values(recibos).some(x => x?.estado === 'entregue')   // parcial com Notion entregue já conta para o cooldown
      atualizarLote(l.id, { estado: r.estado, motivo: r.motivo || '', canais_json: JSON.stringify(canais), tentado_em: em, enviado_em: algumEntregue && !l.enviado_em ? em : l.enviado_em, recibos_json: JSON.stringify(recibos), origem, por })
      for (const id of ids) {
        const row = selId.get(id)
        if (['suprimido', 'resolvido', 'interno'].includes(row?.estado)) continue   // alinhada/resolvida/interna durante o envio: nunca volta a 'enviado'
        atualizar(id, { estado: saiu ? r.estado : r.estado === 'falhou' ? 'falhou' : 'pendente', motivo: r.motivo || '', canais_json: JSON.stringify(canais), ...(algumEntregue ? { enviado_em: em } : {}), ...(r.estado === 'entregue' ? { entregue_em: em } : {}) })
        // memória por PRODUTO do que foi dito (dedupe do urgente de estoque e preço): os produtos que a linha disse (avisado:true ficou fora do texto), com o estado do envio
        if (algumEntregue && row && FAMILIA[row.tipo]) for (const x of parse(row.itens_json, [])) if (x && !x.avisado && idDe(x))
          insAvisado.run(l.cliente, FAMILIA[row.tipo], idDe(x), JSON.stringify(Object.fromEntries(['estoque', 'cobertura', 'para'].filter(k => x[k] !== undefined).map(k => [k, x[k]]))), em, l.id)
      }
      if (algumEntregue) for (const p of selLoteProduto.all(l.id)) insAvisado.run(l.cliente, 'estoque', p.item_id, p.snap_json, em, l.id)   // micro de compras: produtos ditos
      log(/^n8n_(5\d\d|timeout|rede)$/.test(r.motivo || '') ? 'erro' : 'info', `gatilhos ${l.cliente}: lote ${l.tipo} ${r.estado}${r.motivo ? ` (${r.motivo})` : ''} · ${canais.length} canal(is)`)
      if (['falhou', 'parcial'].includes(r.estado)) notificar({ tipo: 'gatilho_falhou', nivel: 'alerta', titulo: `Aviso ao cliente não entregue${r.estado === 'parcial' ? ' em todos os canais' : ''}: ${l.cliente}`, corpo: textoMotivo(r.motivo) || 'A entrega falhou; veja o log.', cliente: l.cliente, link: `/cliente?cliente=${encodeURIComponent(l.cliente)}&aba=do-cliente&sec=secGatilhos`, dedupeMin: 120 })
      fecharLote(l.id)
      return { ok: saiu, estado: r.estado, motivo: r.motivo || '', mensagem: textoMotivo(r.motivo), lote_id: l.id }   // pendente (n8n não configurado) e parcial NÃO são sucesso
    } finally { emVoo.delete(l.id) }
  }
  // recibo por canal (n8n → /api/gatilhos/recibo, ou Notion direto): idempotente por (lote, canal); o lote fecha quando todos os canais responderam
  function registrarRecibo({ lote_id, canal, estado: est, em } = {}) {
    const l = selLote.get(str(lote_id)); if (!l) return { ok: false, motivo: 'lote_desconhecido' }
    if (!CANAIS.includes(canal)) return { ok: false, motivo: 'canal_invalido' }
    if (!['entregue', 'falhou'].includes(est)) return { ok: false, motivo: 'estado_invalido' }
    const recibos = parse(l.recibos_json, {})
    if (recibos[canal]) return { ok: true, duplicado: true }
    recibos[canal] = { estado: est, em: /^\d{4}-\d{2}-\d{2}T/.test(String(em)) ? String(em).slice(0, 24) : agora() }
    atualizarLote(l.id, { recibos_json: JSON.stringify(recibos) })
    fecharLote(l.id)
    // o provedor recusou: o lote NÃO é reenviado sozinho (reenviar mandaria de novo aos canais que entregaram); a equipe decide pelo «Reenviar», que só vai aos canais sem entrega
    if (est === 'falhou') notificar({ tipo: 'gatilho_falhou', nivel: 'alerta', titulo: `Aviso ao cliente não entregue (${canal}): ${l.cliente}`, corpo: 'O provedor recusou a mensagem (recibo do n8n). Nada é reenviado sozinho: confira o destino e use «Reenviar» (só vai aos canais sem entrega).', cliente: l.cliente, link: `/cliente?cliente=${encodeURIComponent(l.cliente)}&aba=do-cliente&sec=secGatilhos`, dedupeMin: 120 })
    return { ok: true, duplicado: false }
  }
  function fecharLote(id) {
    const l = selLote.get(id), canais = parse(l.canais_json, []), recibos = parse(l.recibos_json, {})
    if (!canais.length || l.estado !== 'enviado') return           // só um lote que de fato saiu pelo n8n espera recibos; pendente/falhou/parcial (n8n falhou)/entregue já estão fechados
    const ests = canais.map(k => recibos[k]?.estado).filter(Boolean)
    if (!ests.length) return
    const todos = ests.length === canais.length, entregues = ests.filter(e => e === 'entregue').length
    const novo = entregues === canais.length ? 'entregue' : !entregues && todos ? 'falhou' : entregues ? (todos ? 'parcial' : 'enviado') : 'enviado'
    if (novo !== l.estado) atualizarLote(id, { estado: novo })
    const em = agora()
    for (const id2 of parse(l.itens_ids_json, [])) {
      const r = selId.get(id2); if (!r || ['resolvido'].includes(r.estado) || r.lote_id !== id) continue      // linha que voltou à fila (piora/repetição) não é deste lote
      if (entregues && r.estado !== 'entregue') atualizar(id2, { estado: 'entregue', entregue_em: em, recibo_json: JSON.stringify(recibos) })
      else if (novo === 'falhou' && r.estado !== 'falhou') atualizar(id2, { estado: 'falhou', motivo: 'entrega_falhou', recibo_json: JSON.stringify(recibos) })
    }
  }

  // ── chave global, liberação, configuração por cliente ─────────────────────────────────────────────────────────────────
  function chave(body = {}) {
    if (typeof body.ligado !== 'boolean') throw erro('informe "ligado" (verdadeiro ou falso)')
    const por = exigirPor(body.por)
    estado.set('gatilhos_ligado', body.ligado ? 'ligado' : 'desligado'); estado.set('gatilhos_ligado_por', `${por} · ${agora()}`)
    log('info', `avisos automáticos ao cliente ${body.ligado ? 'LIGADOS' : 'DESLIGADOS'} por ${por}`)
    return { ok: true, ligado: body.ligado }
  }
  function liberar(body = {}) {
    const por = exigirPor(body.por), lib = body.liberar !== false
    if (!Array.isArray(body.clientes) || !body.clientes.length || body.clientes.length > 200) throw erro('informe "clientes" (lista de 1 a 200 nomes)')
    const liberados = [], ignorados = []
    for (const bruto of body.clientes) {
      let c; try { c = exigirCliente(bruto) } catch { ignorados.push({ cliente: str(bruto).slice(0, 80), motivo: 'cliente_inelegivel' }); continue }
      const row = selCliente(c), n = parse(row?.notificacao_json, {})
      if (lib && !canaisLigados(notificacaoDe(row?.notificacao_json, cfg)).length) { ignorados.push({ cliente: c, motivo: 'sem_canal' }); continue }
      // revogar também para o urgente da regra automática: tira a marca auto_liberado e bloqueia a regra (nunca religa sozinha); liberar de novo tira o bloqueio
      const { auto_liberado: _a, auto_bloqueado: _b, ...resto } = n && typeof n === 'object' ? n : {}
      salvarNotif(c, JSON.stringify({ ...(lib ? resto : { ...resto, auto_bloqueado: true }), liberado_por: lib ? por : '', liberado_em: lib ? agora() : '' }))
      liberados.push(c)
    }
    log('info', `avisos ao cliente: ${lib ? 'liberados' : 'revogados'} ${liberados.length} cliente(s) por ${por}`)
    return { ok: true, liberar: lib, liberados, ignorados }
  }
  function configurar(body = {}) {
    const c = exigirCliente(body.cliente), por = exigirPor(body.por), nova = validarNotificacao(body.notificacao, cfg)
    const atual = parse(selCliente(c)?.notificacao_json, {})
    // destino novo (número, e-mail, webhook) exige liberação nova: quem liberou leu outro destino
    const mudouDestino = !!str(atual.liberado_por) && CANAIS_N8N.some(k => str(atual.canais?.[k]?.destino) !== nova.canais[k].destino)
    // grupo do WhatsApp trocado (ou apagado) também desfaz a liberação AUTOMÁTICA do urgente e bloqueia a regra (quem a regra liberou leu outro grupo); destino igual mantém as marcas
    const mudouGrupo = str(atual.canais?.whatsapp?.destino) !== nova.canais.whatsapp.destino
    const auto = mudouGrupo ? { auto_bloqueado: true } : { ...(atual.auto_liberado ? { auto_liberado: atual.auto_liberado } : {}), ...(atual.auto_bloqueado === true ? { auto_bloqueado: true } : {}) }
    salvarNotif(c, JSON.stringify({ ...nova, ...auto, liberado_por: mudouDestino ? '' : str(atual.liberado_por), liberado_em: mudouDestino ? '' : str(atual.liberado_em) }))
    log('info', `avisos ao cliente ${c}: configuração salva por ${por} (${canaisLigados(nova).join(',') || 'nenhum canal'})${mudouDestino ? ' · destino mudou: liberação revogada' : ''}`)   // nunca o destino
    return { ok: true, cliente: c, notificacao: notificacao(c) }
  }
  async function testar(body = {}) {
    const c = exigirCliente(body.cliente), por = exigirPor(body.por), canal = str(body.canal)
    if (!CANAIS.includes(canal)) throw erro('canal fora da lista permitida')
    if (canal === 'notion') return { ok: false, estado: 'nao_aplicavel', motivo: 'canal_notion_sem_teste', mensagem: MSG.canal_notion_sem_teste }
    if (antesDoInicio(c)) return { ok: false, estado: 'antes_do_inicio', motivo: 'antes_do_inicio', mensagem: MSG.antes_do_inicio }   // nenhum envio ao cliente antes de inicio_envios (decisão 3)
    const n = notificacao(c), d = n.canais[canal]
    if (!d?.ligado || !d.destino) return { ok: false, estado: 'sem_canal', motivo: 'sem_canal', mensagem: MSG.sem_canal }
    if (!envio?.testar) return { ok: false, estado: 'pendente', motivo: 'n8n_nao_configurado', mensagem: MSG.n8n_nao_configurado }
    const r = await envio.testar({ cliente: c, canal, destino: d.destino })
    log('info', `avisos ao cliente ${c}: teste do canal ${canal} → ${r.estado} (por ${por})`)
    return { ok: r.estado === 'enviado', ...r, mensagem: r.mensagem || textoMotivo(r.motivo) }
  }

  // ── envio MANUAL: prévia por padrão; confirmar === true + líder envia (ignora chave, janela e liberação; exige canal, cliente Ativo, integração ML e inicio_envios) ──
  async function enviar(body = {}) {
    const c = exigirCliente(body.cliente), tipo = str(body.tipo) || 'semanal'
    const compor = typeof body.compor === 'function' ? body.compor : null   // só por código (scripts/micro-compras.mjs); JSON nunca traz função
    if (body.confirmar !== true) return { ...montarLote(c, tipo, { gravar: false, compor }), previa: true, elegivel: elegivel(c, { manual: true, tipo }) }
    const por = exigirPor(body.por)
    const e = elegivel(c, { manual: true, tipo }); if (!e.ok) return { ok: false, estado: e.motivo, motivo: e.motivo, mensagem: textoMotivo(e.motivo) }
    let l
    if (str(body.lote_id)) { l = selLote.get(str(body.lote_id)); if (!l || l.cliente !== c) throw erro('lote não encontrado', 404) }
    else {
      // hash conferido ANTES de gravar (um 409 não deixa lote «montado» para trás); vale também para o diário que já existia
      if (str(body.hash) && montarLote(c, tipo, { gravar: false, compor }).hash !== str(body.hash)) throw erro('o conteúdo mudou desde a prévia — gere de novo', 409)
      const m = montarLote(c, tipo, { gravar: true, origem: 'manual', por, compor })
      if (m.vazio) return { ok: false, estado: 'vazio', motivo: 'vazio', mensagem: MSG.vazio }
      if (m.bloqueado || m.teto) return { ok: false, estado: m.bloqueado ? 'bloqueado' : 'teto', motivo: m.motivo, mensagem: textoMotivo(m.motivo) }
      l = selLote.get(m.id)
    }
    return enviarLote(l.id, { origem: 'manual', por })
  }

  // ── automático: varredura de 10 min (urgente na hora) + plano semanal na terça 09:00–20:00 no fuso do cliente; sai no 1º if se a chave está desligada ──
  // Fora da janela de terça o plano espera a próxima terça (não se «recupera» em outro dia); idempotente por (cliente, semana ISO).
  const janelaSemanal = c => { const dia = hojeDe(c), h = horaDe(c); return diaSemana(dia) === cfg.semanal.dia_semana && h >= cfg.semanal.hora && h < cfg.semanal.ate }
  // Pós-coleta (origem 'coleta'): a DETECÇÃO roda para todo cliente elegível, com a chave desligada e sem liberação — é ela que gera o aviso interno da equipe
  // (dono assessoria, origem não verificada); a chave, a liberação e o canal barram só o ENVIO ao cliente (elegivel).
  let rodando = false
  async function tick({ origem = 'timer', forcarSemanal = false } = {}) {
    const todos = origem === 'coleta'
    if (!ligado() && !todos) return { pulou: 'desligado' }
    if (rodando) return { pulou: 'em_andamento' }
    rodando = true
    const res = { pulou: '', origem, avaliados: 0, imediatos: 0, semanais: 0, retentados: 0, falhas: 0, lotes: [] }
    try {
      // liberação automática do urgente de estoque e preço na detecção diária (pós-coleta): quem conectou o ML entra aqui (o envio ainda exige a primeira coleta completa)
      if (todos && naHora() && ligado() && typeof central === 'function') { try { res.auto = await autoLiberar({ central }) } catch (e) { log('erro', `gatilhos: liberação automática ${String(e?.name || 'Error')}`) } }
      for (const c of [...mapaElegiveis().values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
        try {
          const n = notificacao(c); if (!todos && !n.liberado_por && !canaisLigados(n).length) continue   // no timer, avaliação completa (diagnóstico) só para quem pode receber; pós-coleta e GET /api/cliente/gatilhos avaliam qualquer um
          await avaliar(c); res.avaliados++
          // plano semanal (e) e urgente de estoque e preço (eu, 14/10/2026: só com urgente.na_hora_ligado no config, para todo cliente elegível — a caixa por cliente saiu)
          const e = elegivel(c), eu = naHora() ? elegivel(c, { tipo: 'imediato' }) : { ok: false }; if (!e.ok && !eu.ok) continue
          const dia = hojeDe(c), semana = semanaIso(dia), chaveSemana = `gatilhos_semanal:${c}`
          // lote que já tem recibo do n8n (WhatsApp/e-mail) NUNCA sai de novo sozinho: algum canal pode ter entregado, e o reenvio iria a todos (achado crítico: o plano
          // 'parcial' por recibo saía a cada tick). A equipe é avisada no recibo 'falhou' e reenvia pelo botão, que só vai aos canais sem entrega.
          const comRecibo = l => Object.keys(parse(l.recibos_json, {})).some(k => CANAIS_N8N.includes(k))
          // lote de dia anterior que não saiu (pendente/falhou/parcial) venceu: os pontos voltam à fila e entram no próximo lote (o texto de ontem não é "hoje")
          for (const l of handle.prepare("SELECT * FROM gatilho_lote WHERE cliente = ? AND dia < ? AND estado IN ('pendente','falhou','parcial')").all(c, dia)) {
            if (comRecibo(l)) continue
            atualizarLote(l.id, { estado: 'falhou', motivo: 'lote_vencido' })
            for (const id of parse(l.itens_ids_json, [])) { const r = selId.get(id); if (r && r.lote_id === l.id && ['pendente', 'falhou'].includes(r.estado)) atualizar(id, { lote_id: '', estado: voltaFila(r), motivo: voltaFila(r) === 'interno' ? 'assessoria' : 'lote_vencido' }) }
          }
          // lote do dia que ficou pendente/falhou/parcial SEM recibo do n8n (a chamada ao n8n falhou de fato): retenta (retry_min e o teto diário já valem); n8n ainda sem credencial não vale tentativa
          for (const l of handle.prepare("SELECT id, tipo, motivo, recibos_json FROM gatilho_lote WHERE cliente = ? AND dia = ? AND estado IN ('pendente','falhou','parcial')").all(c, dia)) {
            if (comRecibo(l) || l.motivo === 'conteudo_mudou' || (l.motivo === 'n8n_nao_configurado' && !envio?.configurado?.())) continue   // cancelado (conteudo_mudou) é final: as linhas já voltaram à fila
            if (l.tipo !== 'semanal' ? !eu.ok || (e.ok && diaSemana(dia) === cfg.semanal.dia_semana) : !e.ok) continue      // sem urgente.na_hora_ligado o imediato nunca sai sozinho («Reenviar» manual continua); no dia do plano, só o plano
            if (l.tipo === 'semanal' && !janelaSemanal(c) && !forcarSemanal) continue                       // o plano não sai fora da janela de terça
            const r = await enviarLote(l.id, { origem }); if (r.ok) { res.retentados++; res.lotes.push({ cliente: c, id: l.id, tipo: 'retry', estado: r.estado }) }
          }
          // na terça, o plano sai ANTES do urgente e leva os urgentes pendentes: o cliente não recebe o mesmo ponto em duas mensagens com segundos de diferença
          if (e.ok && (forcarSemanal || janelaSemanal(c)) && estado.get(chaveSemana) !== semana) {
            const l = montarLote(c, 'semanal', { origem })
            // sem diagnóstico agora: tenta de novo no próximo tick (até 20:00); bloqueado pelo auditor: a equipe é avisada e o tick tenta de novo (nunca marca a semana em silêncio)
            if (l.bloqueado) notificar({ tipo: 'gatilho_falhou', nivel: 'alerta', titulo: `Plano da semana não saiu: ${c}`, corpo: textoMotivo(l.motivo), cliente: c, link: `/cliente?cliente=${encodeURIComponent(c)}&aba=do-cliente&sec=secGatilhos`, dedupeMin: 24 * 60 })
            else if (!(l.vazio && l.motivo === 'sem_dados')) estado.set(chaveSemana, semana)
            if (l.id && !l.vazio && !l.teto && !l.bloqueado && !l.ja_existia) { const r = await enviarLote(l.id, { origem }); res.semanais++; res.lotes.push({ cliente: c, id: l.id, tipo: 'semanal', estado: r.estado }) }
          }
          // dia do plano (terça): quem recebe o plano não recebe o urgente no mesmo dia (achado de 14/10: urgente às 07:00 e plano às 09:00 com o mesmo produto) — os
          // urgentes pendentes vão no plano; o que o plano não leva sai no urgente do dia seguinte, sem repetir o que ele disse (memória por produto)
          const diaDoPlano = e.ok && diaSemana(dia) === cfg.semanal.dia_semana
          if (eu.ok && !diaDoPlano) { const l = montarLote(c, 'imediato'); if (l.id && !l.vazio && !l.teto && !l.bloqueado && !l.ja_existia) { const r = await enviarLote(l.id, { origem }); res.imediatos++; res.lotes.push({ cliente: c, id: l.id, tipo: 'imediato', estado: r.estado }) } }
        } catch (e) { res.falhas++; log('erro', `gatilhos ${c}: ${String(e?.message ?? e).replace(/["'`][\s\S]*$/, '…').slice(0, 120)}`) }
        await new Promise(r => setImmediate(r))
      }
      if (res.imediatos || res.semanais || res.retentados || res.falhas) log('info', `gatilhos (${origem}): ${res.avaliados} cliente(s), ${res.imediatos} urgente(s), ${res.semanais} plano(s) semanal(is), ${res.retentados} reenvio(s), ${res.falhas} falha(s)`)
    } finally { rodando = false }
    return res
  }

  // ── listagens ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function publico(r) {
    return { id: r.id, tipo: r.tipo, rotulo: rotulo(r.tipo), dono: donoDe(r.tipo), impacto: impactoDaLinha(parse(r.itens_json, [])), para_cliente: paraCliente(r), classe: r.classe, estado: r.estado, motivo: r.estado === 'resolvido' ? '' : textoMotivo(r.motivo), motivo_codigo: r.estado === 'resolvido' ? '' : r.motivo, texto: r.texto, lote_id: r.lote_id,
      criado_em: r.criado_em, enviado_em: r.enviado_em, entregue_em: r.entregue_em, resolvido_em: r.resolvido_em, assinatura: r.assinatura }
  }
  function publicoLote(l) {
    return { id: l.id, cliente: l.cliente, tipo: l.tipo, dia: l.dia, estado: l.estado, motivo: textoMotivo(l.motivo), motivo_codigo: l.motivo, texto_final: l.texto_final, linhas: l.texto_final.split('\n'), hash: l.hash, canais: parse(l.canais_json, []),
      recibos: parse(l.recibos_json, {}), itens_ids: parse(l.itens_ids_json, []), n: parse(l.itens_ids_json, []).length, origem: l.origem, por: l.por, criado_em: l.criado_em, tentado_em: l.tentado_em, enviado_em: l.enviado_em }
  }
  const mascWhats = d => d.includes('@') ? d.replace(/^\d*(\d{4})@(.*)$/, (m, fim, dom) => `${dom === 'g.us' ? 'grupo' : 'contato'} ••• ${fim}`) : d.replace(/^(\+\d{2})\d+(\d{4})$/, '$1 ••• $2')
  const mascarar = n => ({ ...n, canais: Object.fromEntries(Object.entries(n.canais).map(([k, v]) => [k, k === 'notion' ? v : { ligado: v.ligado, destino: v.destino, destino_mascarado: k === 'whatsapp' ? mascWhats(v.destino) : k === 'email' ? v.destino.replace(/^(.).*(@.*)$/, '$1•••$2') : v.destino ? 'discord.com/api/webhooks/…' : '' }])) })
  async function listarCliente(bruto, { reavaliar = true } = {}) {
    const c = exigirCliente(bruto)
    let cobertura = {}
    if (reavaliar) { try { cobertura = (await avaliar(c)).cobertura } catch (e) { log('erro', `gatilhos ${c}: avaliação ${String(e?.message ?? e).slice(0, 100)}`) } }
    const fila = vivosDe.all(c).map(publico)
    const lotes = handle.prepare('SELECT * FROM gatilho_lote WHERE cliente = ? ORDER BY criado_em DESC LIMIT 10').all(c).map(publicoLote)
    const resolvidos = handle.prepare("SELECT * FROM gatilho_cliente WHERE cliente = ? AND estado = 'resolvido' ORDER BY id DESC LIMIT 20").all(c).map(publico)
    const e = elegivel(c)
    return { cliente: c, fila, resolvidos, lotes, ultimo_lote: lotes[0] || null, cobertura, elegivel: { ...e, mensagem: e.ok ? '' : textoMotivo(e.motivo) }, automatico: { ligado: ligado() }, notificacao: mascarar(notificacao(c)), catalogo: TIPOS.map(t => ({ id: t, rotulo: rotulo(t), dono: cat[t].dono, classe: cat[t].classe, ritmo: cat[t].ritmo })) }
  }
  function listarGeral() {
    const liberados = []
    for (const c of mapaElegiveis().values()) { const n = notificacao(c); if (n.liberado_por) liberados.push({ cliente: c, liberado_por: n.liberado_por, liberado_em: n.liberado_em, canais: canaisLigados(n) }) }
    const sete = new Date(agoraMs() - 7 * 86_400_000).toISOString()
    const lotes = handle.prepare("SELECT * FROM gatilho_lote WHERE criado_em >= ? ORDER BY criado_em DESC LIMIT 200").all(sete).map(publicoLote)
    const fila = handle.prepare("SELECT cliente, COUNT(*) n, SUM(classe = 'critico') criticos FROM gatilho_cliente WHERE estado IN ('pendente','agrupado') GROUP BY cliente ORDER BY cliente COLLATE NOCASE").all()
    return { automatico: { ligado: ligado(), por: estado.get('gatilhos_ligado_por') || '' }, liberados: liberados.sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR')), falhas: lotes.filter(l => ['falhou', 'parcial', 'pendente'].includes(l.estado)), lotes_7d: lotes.length, fila,
      n8n: { configurado: !!envio?.configurado?.() } }
  }

  // ── liberação AUTOMÁTICA do urgente de estoque e preço (regra registrada em cfg.urgente.liberacao_automatica, 14/10/2026) ─────────────────────────────────────
  // Cliente Ativo com integração ML de fato e SEM WhatsApp configurado ganha o grupo «Id whatsapp meli» da central (central(c) = gatilhos-destinos-notion.buscarDestinos, o MESMO
  // preenchimento da liberação em lote) com o canal ligado e a marca da regra — nunca liberado_por (o plano de terça continua exigindo a liberação do líder). WhatsApp já
  // configurado (ligado, ou desligado de propósito com o grupo salvo) nunca é tocado. gravar:false = prévia. A resposta tem só nomes e motivos fixos — nunca o destino.
  async function autoLiberar({ central: buscar = central, gravar = true, so = null } = {}) {      // so = lista de clientes (envio manual do script): só eles
    const out = { preenchidos: [], sem_grupo: [], nao_lidos: [], ja_configurados: 0 }
    if (!str(cfg.urgente.liberacao_automatica) || typeof buscar !== 'function') return out
    for (const c of [...mapaElegiveis().values()].filter(x => !so || so.includes(x)).sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      const raw = parse(selCliente(c)?.notificacao_json, {}) || {}
      if (str(raw.canais?.whatsapp?.destino) || raw.auto_bloqueado === true) { out.ja_configurados++; continue }      // revogado/destino trocado: a regra nunca religa
      if (!integracaoDe(c).ok) continue
      let r0; try { r0 = await buscar(c) } catch { r0 = { achado: false, motivo: 'notion_indisponivel' } }
      if (!r0?.achado) { out.nao_lidos.push({ cliente: c, motivo: String(r0?.motivo || 'notion_indisponivel').slice(0, 40) }); continue }
      const grupo = str(r0.sugestao?.whatsapp?.destino); if (!WHATS.test(grupo)) { out.sem_grupo.push(c); continue }
      if (gravar) salvarNotif(c, JSON.stringify({ ...raw, canais: { ...(raw.canais && typeof raw.canais === 'object' ? raw.canais : {}), whatsapp: { ligado: true, destino: grupo } }, auto_liberado: { regra: cfg.urgente.liberacao_automatica, em: agora() } }))
      out.preenchidos.push(c)
    }
    if (gravar && out.preenchidos.length) log('info', `aviso de estoque e preço: ${out.preenchidos.length} cliente(s) liberado(s) pela regra automática (grupo do ML da central)`)
    return out
  }

  // ── liberação em LOTE (decisão 7 do David, 12/10/2026; para rodar depois do reinício): para cada cliente Ativo com integração ML de fato, preenche o grupo «Id whatsapp meli»
  // VAZIO pela central (central(c) = gatilhos-destinos-notion.buscarDestinos, o MESMO preenchimento da rota /api/cliente/notificacao/central), liga o WhatsApp se o grupo
  // existe, mantém o urgente desligado e libera (liberado_por = por; quem já estava liberado com o MESMO grupo mantém quem liberou; grupo novo = liberação nova). Prévia por padrão: só grava com confirmar === true.
  // Idempotente: cliente já pronto não é regravado. A resposta tem só nomes e motivos fixos — nunca o destino.
  async function prepararLote({ por: bruto, confirmar = false, central } = {}) {
    const por = exigirPor(bruto), gravar = confirmar === true
    const out = { ok: true, previa: !gravar, liberados: [], sem_grupo_ml: [], sem_integracao: [], invalidos: [], nao_lidos: [] }
    for (const c of [...mapaElegiveis().values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))) {
      const i = integracaoDe(c); if (!i.ok) { out.sem_integracao.push({ cliente: c, motivo: i.motivo }); continue }
      const atual = notificacao(c)
      let canais = atual.canais
      if (!canais.whatsapp.destino) {
        let r0; try { r0 = typeof central === 'function' ? await central(c) : { achado: false, motivo: 'central_indisponivel' } } catch { r0 = { achado: false, motivo: 'notion_indisponivel' } }
        if (!r0?.achado) { out.nao_lidos.push({ cliente: c, motivo: String(r0?.motivo || 'notion_indisponivel').slice(0, 40) }); continue }
        canais = preencherVazios(canais, r0.sugestao, ['whatsapp']).canais
        if (!canais.whatsapp.destino) { ((r0.destinos?.invalidos || []).includes('whatsapp') ? out.invalidos : out.sem_grupo_ml).push(c); continue }
      }
      // validada nos DOIS modos (a prévia promete só o que o confirmar faz): grupo salvo fora do formato (ex.: número legado) = invalidos; outro campo inválido = nao_lidos
      let nova
      try { nova = validarNotificacao({ canais: { ...canais, whatsapp: { ligado: true, destino: canais.whatsapp.destino } }, ritmo: { critico_na_hora: false }, silencio: atual.silencio, fuso: atual.fuso, ...(atual.rotulo ? { rotulo: atual.rotulo } : {}) }, cfg) }
      catch { if (!WHATS.test(canais.whatsapp.destino)) out.invalidos.push(c); else out.nao_lidos.push({ cliente: c, motivo: 'configuracao_invalida' }); continue }
      // grupo preenchido NESTA rodada = liberação nova em nome de quem rodou (como configurar: quem liberou antes leu outro destino); destino igual mantém quem liberou (idempotente)
      const manter = canais.whatsapp.destino === atual.canais.whatsapp.destino && !!atual.liberado_por
      if (gravar && !(manter && canais.whatsapp.ligado && !atual.ritmo.critico_na_hora)) salvarNotif(c, JSON.stringify({ ...nova, liberado_por: manter ? atual.liberado_por : por, liberado_em: manter ? atual.liberado_em : agora() }))
      out.liberados.push(c)
    }
    if (gravar) log('info', `avisos ao cliente: liberação em lote por ${por} — ${out.liberados.length} liberado(s), ${out.sem_grupo_ml.length} sem grupo, ${out.sem_integracao.length} sem integração, ${out.invalidos.length} inválido(s), ${out.nao_lidos.length} não lido(s)`)
    return out
  }

  return { avaliar, montarLote, enviarLote, enviar, registrarRecibo, elegivel, chave, chaveEstado: () => ({ ligado: ligado(), por: estado.get('gatilhos_ligado_por') || '' }), liberar, configurar, testar, tick, listarCliente, listarGeral, textoMotivo, config: cfg, notificacao,
    prepararLote, autoLiberar, integracao: integracaoDe, clientesAtivos: () => [...mapaElegiveis().values()], antesDoInicio, rotulo: rotuloCliente }
}
