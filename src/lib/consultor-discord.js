// Aviso INTERNO ao consultor no canal do cliente no Discord (decisão do David, 12/10/2026). SÓ MERCADO LIVRE: destino = «Webhook ML» da base Clientes do Notion,
// menção = «Discord ID Consultor ML» (gatilhos-destinos-notion.js). O cliente NÃO está no Discord: aqui pode ter nome de tarefa, analista, confiança e ponto da assessoria.
// NÃO é um segundo motor: é PROJEÇÃO do que já existe — entregas que viraram venda (os MESMOS critérios do bloco ✅ do plano ao cliente: avaliarEntrega via dadosPlanoSemana),
// medidas do Merovíngio (impacto-tarefas: melhorou / piorou / sem efeito, confiança), padrões da base por família (Wilson, a régua de calibracao.saudeRegras), itens internos
// dos gatilhos (dono assessoria, preço de origem não verificada, fim de promoção), alinhamentos vencidos e os lotes que saíram ao cliente.
//  (1) Resumo SEMANAL por cliente: TERÇA 08:30 no fuso do cliente (decisões finais de 12/10/2026; antes do plano ao cliente das 09:00), idempotente por (cliente, semana ISO), quatro seções:
//      ✅ Merovíngio — o que rendeu · 🔁 Merovíngio — sem resultado medido · 🔔 Morpheus — pontos da assessoria (cada item com o sistema de origem) · 📲 Morpheus — enviado ao cliente
//      (sistemas de origem: config/sistemas.json, 15/10/2026; o canal é INTERNO, ao cliente nada muda).
//  (2) URGENTE interno (mesmos ticks dos gatilhos): queda forte da conta, fim de promoção em anúncio curva A, Ads sem retorno com gasto ≥ mínimo do config — 1 por assunto a cada 7 dias.
//      DESLIGADO por config (consultor.urgente_ligado = false, «só semanal», 12/10/2026): esses pontos ficam no 🔔 do resumo de terça (itens internos, críticos primeiro).
// Entrega: MESMO webhook do n8n (gatilhos-envio.enviarInterno), discord_partes ≤ 1900 caracteres na ordem (o Discord recusa > 2000); sem URL/segredo = 'pendente' honesto; o recibo
// do n8n chega pela rota de recibo dos gatilhos (lote_id desta tabela, canal discord). Tabela própria consultor_aviso (nunca mistura com gatilho_lote do cliente).
// Chave própria sync_estado.consultor_discord_ligado NASCE DESLIGADA. Destinatários (12/10/2026): TODO cliente Ativo com integração ML de fato (integracao-ml.js, a MESMA função
// dos gatilhos) e «Webhook ML» válido na central — independe do WhatsApp e da liberação do cliente; exclusão opcional pela lista JSON sync_estado.consultor_excluidos.
// Nada sai antes de config.inicio_envios. Menções (regra do David): os 3 cargos de config/discord-time.json SEMPRE + o consultor quando o «Discord ID Consultor ML» é válido,
// no topo da 1ª parte; ao n8n vão discord_mencionar (usuários) e discord_mencionar_cargos (cargos) para o allowed_mentions { parse: [], users, roles } (nunca @everyone).
// Regras do CLAUDE.md: «sem resultado mensurável» ≠ «inútil»; associação temporal, nunca causa; nunca culpa ao analista (a seção 🔁 não cita analista).
// Puro: handle, relógio, fontes e envio injetados (o autoteste roda em :memory: com stubs). A fiação real (criarConsultorDiscordReal) importa o banco SÓ quando é chamada.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './env.js'
import { familiaDeDemanda } from './processos.js'
import { dataNoFuso, horaNoFuso, diaSemana, estadoDeHandle } from './relatorio-envio.js'
import { semanaIso, sha } from './gatilhos.js'
import { MOTIVOS_INTEGRACAO } from './integracao-ml.js'
import { secao, origemNome } from './sistemas.js'

export const SCHEMA_CONSULTOR = `
CREATE TABLE IF NOT EXISTS consultor_aviso (   -- 1 linha = 1 mensagem interna no canal do cliente no Discord (em partes ≤ 1900)
  id TEXT PRIMARY KEY,                          -- sha256 16 hex: semanal = (cliente, semana ISO); imediato = (cliente, assunto, instante)
  cliente TEXT NOT NULL,
  tipo TEXT NOT NULL,                           -- interno_semanal | interno_imediato
  chave TEXT NOT NULL DEFAULT '',               -- semana ISO (semanal) | assunto (imediato: queda_forte_conta | fim_promocao_curva_a | ads_sem_retorno)
  dia TEXT NOT NULL,                            -- AAAA-MM-DD no fuso do cliente
  texto TEXT NOT NULL,                          -- corpo SEM a menção (a menção entra no envio, com o id lido da central)
  partes_json TEXT NOT NULL DEFAULT '[]',       -- o corpo dividido em quebras de linha, na ordem
  hash TEXT NOT NULL,
  estado TEXT NOT NULL,                         -- montado | pendente | enviado | entregue | falhou
  motivo TEXT NOT NULL DEFAULT '',              -- código fixo (n8n_nao_configurado, sem_destino, n8n_500, recibo_falhou …)
  mencao INTEGER NOT NULL DEFAULT 0,            -- 1 = saiu marcando o consultor
  criado_em TEXT NOT NULL, tentado_em TEXT NOT NULL DEFAULT '', enviado_em TEXT NOT NULL DEFAULT '',
  recibo_json TEXT NOT NULL DEFAULT '{}'        -- { discord: { estado, em } }
);
CREATE INDEX IF NOT EXISTS ix_consultor_aviso ON consultor_aviso (cliente, tipo, chave, criado_em);
`
export const ASSUNTOS = { queda_forte_conta: 'Queda forte da conta', fim_promocao_curva_a: 'Fim de promoção em anúncio curva A', ads_sem_retorno: 'Anúncios pagos sem retorno' }
export const RESERVA_MENCAO = 120                // 3 cargos «<@&id>» + consultor «<@id>» (ids de até 21 dígitos) + espaços + quebra de linha ≤ 103: cada parte já nasce com folga para as menções
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const RX_ID = /^\d{15,21}$/                      // id do Discord (usuário ou cargo): só numérico de 15 a 21 dígitos
const COLUNAS = ['estado', 'motivo', 'mencao', 'tentado_em', 'enviado_em', 'recibo_json']

export function validarCfgConsultor(k) {
  const falha = m => { throw new Error(`config/gatilhos.json → consultor: ${m}`) }
  if (!k || typeof k !== 'object' || Array.isArray(k)) falha('bloco "consultor" ausente')
  if (!Number.isInteger(k.dia_semana) || k.dia_semana < 0 || k.dia_semana > 6) falha('"dia_semana" precisa ser 0..6 (1 = segunda)')
  for (const x of ['hora', 'ate']) if (!HHMM.test(String(k[x]))) falha(`"${x}" precisa ser HH:MM`)
  if (!(k.hora < k.ate)) falha('"hora" precisa ser antes de "ate"')
  const num = (x, min, max) => { if (!Number.isInteger(k[x]) || k[x] < min || k[x] > max) falha(`"${x}" fora do intervalo ${min}..${max}`) }
  num('janela_dias', 7, 120); num('repeticao_dias', 14, 365); num('max_itens', 1, 10); num('urgente_cooldown_dias', 1, 30); num('urgente_ads_gasto_min', 0, 1_000_000); num('discord_max_chars', 500, 1900)
  if (k.urgente_ligado !== undefined && typeof k.urgente_ligado !== 'boolean') falha('"urgente_ligado" precisa ser verdadeiro ou falso')
  return k
}
// config/discord-time.json: os cargos que TODA mensagem ao time marca (regra do David, 12/10/2026). Id fora do formato derruba a carga (nunca sai mensagem marcando errado).
export function validarTime(t) {
  const falha = m => { throw new Error(`config/discord-time.json: ${m}`) }
  const l = t?.mencoes_obrigatorias
  if (!Array.isArray(l) || !l.length) falha('"mencoes_obrigatorias" precisa ser a lista dos cargos do time')
  for (const m of l) if (!RX_ID.test(String(m?.id ?? ''))) falha('id de cargo precisa ser numérico de 15 a 21 dígitos')
  return Object.freeze({ cargos: l.map(m => String(m.id)), marcar_consultor: t.marcar_consultor_do_cliente !== false })
}
export const lerTime = (caminho = join(ROOT, 'config', 'discord-time.json')) => validarTime(JSON.parse(readFileSync(caminho, 'utf-8')))
// menções de uma mensagem ao time: os cargos sempre; o consultor só com id válido. prefixo «<@&id> <@&id> <@&id>[ <@id>]» vai no topo da 1ª parte;
// roles/users vão ao n8n (discord_mencionar_cargos / discord_mencionar) para o allowed_mentions — só esses ids podem tocar
export function mencoesTime(time, consultor) {
  const roles = (time?.cargos || []).filter(id => RX_ID.test(id)), users = time?.marcar_consultor !== false && RX_ID.test(String(consultor ?? '')) ? [String(consultor)] : []
  return { roles, users, prefixo: [...roles.map(id => `<@&${id}>`), ...users.map(id => `<@${id}>`)].join(' ') }
}
export const comMencoes = (partes, prefixo) => prefixo ? [`${prefixo}\n${partes[0] || ''}`, ...partes.slice(1)] : [...partes]

// ── puras ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const dm = iso => /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—'
const brl = v => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR')
const pct = v => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${String(Math.round(v * 10) / 10).replace('.', ',')}%` : '—'
const addDias = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const limpo = t => String(t ?? '').replace(/\s+/g, ' ').trim()
const tarefaTxt = t => limpo(t).replace(/\s*·\s*PS-[0-9a-f]{4,12}\s*$/i, '').slice(0, 90) || '(sem título)'     // o sufixo «· PS-…» da ação do plano é ruído para quem lê
const parse = (s, pad) => { try { return JSON.parse(s || '') ?? pad } catch { return pad } }
// menção ao consultor só com id numérico de 15 a 21 dígitos (o «Discord ID Consultor ML» da central); qualquer outra coisa = sem menção
export const mencaoDe = id => RX_ID.test(String(id ?? '')) ? `<@${id}>` : ''
// título de produto ou tarefa nunca marca ninguém: @everyone/@here e «<@…» vindos de dado ganham um espaço de largura zero (a menção legítima entra depois)
export const semMarcacao = t => String(t ?? '').replace(/@(everyone|here)/gi, '@​$1').replace(/<@/g, '<​@')
// partes ≤ max em quebras de linha, na ordem; linha maior que max é cortada (não acontece com o texto deste módulo, mas o Discord recusaria)
export function dividirDiscord(texto, max = 1900) {
  const linhas = String(texto ?? '').split('\n').flatMap(l => l.length <= max ? [l] : l.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')))
  const partes = []
  for (const l of linhas) {
    if (partes.length && partes.at(-1).length + 1 + l.length <= max) partes[partes.length - 1] += '\n' + l
    else partes.push(l)
  }
  return partes.map(p => p.replace(/^\n+|\n+$/g, '')).filter(p => p.trim())
}
// família de tarefa com taxa de melhora baixa na base: a régua de calibracao.saudeRegras (n ≥ 10 e limite superior de Wilson < 25% = candidata à aposentadoria)
// e o pedido do David (n ≥ 5 sem nenhuma melhora). Amostra menor não vira padrão.
export const situacaoFamilia = f => f.n >= 10 && f.taxa_alto < 0.25 ? 'candidata à aposentadoria' : f.n >= 5 && f.melhorou === 0 ? 'nenhuma melhora' : ''
const ESTADO_LOTE = { entregue: 'entregue', enviado: 'enviado ao n8n, aguardando recibo', parcial: 'entrega parcial', pendente: 'não saiu', falhou: 'falhou' }
const MOTIVO_CURTO = { n8n_nao_configurado: 'n8n não configurado', sem_canal: 'sem canal ligado', conteudo_mudou: 'cancelado: o conteúdo mudou', lote_vencido: 'venceu sem sair', entrega_falhou: 'o provedor recusou' }
const RX_ACAO = /^(?:\*\d+\.\* )?(\S+) \*([^*]+)\*$/u                                       // «*1.* 📦 *Título*» (plano) ou «📦 *Título*» (urgente)
const acoesDe = t => String(t || '').split('\n').map(l => l.match(RX_ACAO)).filter(m => m && !['🎯', '✅'].includes(m[1])).map(m => `${m[1]} ${m[2]}`).slice(0, 5).join('; ')

// seções do resumo semanal. d = leitura da fonte (criarConsultorDiscordReal → dados):
//   medidas [{ tarefa, tipo, analista, data, estado, efeito_pct, itens, confianca { score, classe }, receita, aprende }] (aprende = fora de reversão/preço/estado mexendo junto)
//   entregas [{ titulo, dia, criado, semVendaAntes, aumento, pre, pos, unidades, receita, tarefa, analista }] (dadosPlanoSemana: os critérios do ✅ do cliente)
//   tarefasAbertas [{ titulo, tipo, itens }] · itensDiag [{ id, titulo, curva, u }] | null · titulos { item_id: título } · familias [{ id, nome, n, melhorou, taxa_alto }]
//   alinhamentosVencidos [{ rotulo, escopo, chave, revisar_em }]
// internos [{ tipo, rotulo, texto, motivo }] = gatilho_cliente no estado 'interno'; lotes [{ tipo, dia, estado, motivo, canais, texto_final, criado_em }] = gatilho_lote, mais recente primeiro
export function secoesConsultor({ hoje, d = {}, internos = [], lotes = [], cfg }) {
  const desde = addDias(hoje, -cfg.janela_dias), desdeRep = addDias(hoje, -cfg.repeticao_dias), max = cfg.max_itens
  const lido = Array.isArray(d.medidas), medidas = d.medidas || [], titulos = d.titulos || {}
  const diag = Array.isArray(d.itensDiag) ? new Map(d.itensDiag.map(i => [String(i.id), i])) : null
  const tit = id => limpo(limpo(titulos[id] || diag?.get(String(id))?.titulo || id).slice(0, 60))
  const recente = m => String(m.data || '') >= desde

  // ✅ entregas que viraram venda (critério do cliente) + medidas que melhoraram, com a confiança e o rótulo honesto
  const entregas = (d.entregas || []).slice(0, max)
  const jaEntrega = new Set(entregas.map(e => `${tarefaTxt(e.tarefa)}|${e.dia}`))
  const resultado = [
    ...entregas.map(e => `• Anúncio ${limpo(limpo(e.titulo).slice(0, 60))} (${e.criado ? 'criado pela equipe' : e.semVendaAntes ? 'não vendia antes' : `${e.pre} → ${e.pos} un em 28 dias`}) em ${dm(e.dia)}: desde então ${e.unidades} un (${brl(e.receita)}) — tarefa «${tarefaTxt(e.tarefa)}»${limpo(e.analista) ? ` · ${limpo(e.analista)}` : ''}`),
    ...medidas.filter(m => m.estado === 'melhorou' && m.aprende && recente(m) && !jaEntrega.has(`${tarefaTxt(m.tarefa)}|${String(m.data).slice(0, 10)}`))
      .sort((a, b) => (b.receita || 0) - (a.receita || 0)).slice(0, Math.max(0, max - entregas.length))
      .map(m => `• «${tarefaTxt(m.tarefa)}» (${[limpo(m.analista), dm(m.data)].filter(Boolean).join(', ')}): ${pct(m.efeito_pct)} nas vendas contra o controle${m.receita > 0 ? `, ~${brl(m.receita)} associados` : ''}${m.confianca?.classe ? ` · ${m.confianca.classe} ${m.confianca.score}/100` : ''}`),
  ]

  // 🔁 sem resultado medido (nunca culpa: sem analista) — recentes, famílias fracas na base com tarefa aberta aqui, repetidas no mesmo anúncio, abertas em curva C sem venda
  const semMedido = medidas.filter(m => ['piorou', 'sem_efeito'].includes(m.estado) && m.aprende && recente(m)).slice(0, max)
    .map(m => `• «${tarefaTxt(m.tarefa)}» em ${dm(m.data)}: ${m.estado === 'piorou' ? `${pct(m.efeito_pct)} nas vendas contra o controle` : 'sem efeito medido'}`)
  const abertasPorFam = new Map()
  for (const t of d.tarefasAbertas || []) { const f = familiaDeDemanda(t.tipo).id; abertasPorFam.set(f, (abertasPorFam.get(f) || 0) + 1) }
  const familias = (d.familias || []).filter(f => f.id !== 'sem_tipo' && abertasPorFam.get(f.id) && situacaoFamilia(f)).slice(0, max)
    .map(f => `• Família «${f.nome}»: ${f.melhorou} de ${f.n} tarefas medidas melhoraram na base (${situacaoFamilia(f)}); ${abertasPorFam.get(f.id)} aberta(s) neste cliente`)
  const rep = new Map()
  for (const m of medidas) if (m.aprende && String(m.data || '') >= desdeRep && ['piorou', 'sem_efeito', 'melhorou'].includes(m.estado)) for (const it of m.itens || []) {
    const f = familiaDeDemanda(m.tipo), k = `${it}|${f.id}`, x = rep.get(k) || rep.set(k, { it, nome: f.nome, n: 0, de: m.data, melhorou: false }).get(k)
    if (m.estado === 'melhorou') x.melhorou = true; else { x.n++; if (m.data < x.de) x.de = m.data }
  }
  const repetidas = [...rep.values()].filter(x => x.n >= 2 && !x.melhorou).sort((a, b) => b.n - a.n).slice(0, max)
    .map(x => `• Anúncio ${tit(x.it)}: ${x.n} tarefas de «${x.nome}» sem resultado medido desde ${dm(x.de)}`)
  const curvaC = diag ? (d.tarefasAbertas || []).flatMap(t => (t.itens || []).filter(it => { const i = diag.get(String(it)); return i && i.curva === 'C' && !(i.u > 0) }).slice(0, 1)
    .map(it => `• «${tarefaTxt(t.titulo)}» (aberta) em anúncio curva C sem venda nos últimos 28 dias: ${tit(it)}`)).slice(0, max) : []

  // 🔔 itens internos dos gatilhos (o mesmo texto da lista «Só para a equipe») + alinhamentos vencidos para revisar
  const assessoria = [
    ...internos.slice(0, 2 * max).map(i => `• **${origemNome(i.tipo)} · ${i.rotulo}**: ${limpo(i.texto)}${i.motivo === 'origem_nao_verificada' ? ' _(origem do preço não verificada: confira antes de falar com o cliente)_' : ''}`),
    ...(d.alinhamentosVencidos || []).slice(0, max).map(a => `• Alinhamento vencido: ${a.rotulo} (${a.escopo === 'anuncio' ? `anúncio ${tit(a.chave)}` : a.escopo === 'conta' ? 'conta inteira' : `regra ${a.chave}`}), revisar desde ${dm(a.revisar_em)}`),
  ]

  // 📲 o último plano e o último urgente que saíram (ou tentaram sair) ao cliente: o consultor sabe o que o cliente leu
  const ultimo = tipo => lotes.find(l => l.tipo === tipo)
  const enviados = [ultimo('semanal'), ultimo('imediato')].filter(Boolean).sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))
    .map(l => `• ${l.tipo === 'semanal' ? 'Plano da semana' : 'Urgente'} de ${dm(l.dia)} · ${ESTADO_LOTE[l.estado] || l.estado}${l.motivo && !['entregue', 'enviado'].includes(l.estado) ? ` (${MOTIVO_CURTO[l.motivo] || l.motivo})` : ''}${(l.canais || []).length ? ` · ${l.canais.join(', ')}` : ''}: ${acoesDe(l.texto_final) || '—'}`)

  return { lido, resultado, comMedida: resultado.length > entregas.length, semMedido, familias, repetidas, curvaC, assessoria, enviados }
}

export function montarResumoConsultor({ cliente, hoje, s, cfg }) {
  const semLeitura = '• Sem leitura das medidas nesta semana (não quer dizer zero).'
  const revisar = [...s.semMedido, ...s.familias, ...s.repetidas, ...s.curvaC]
  return semMarcacao([
    `**Resumo semanal da conta · ${cliente} · ${dm(hoje)}**`,
    '_Interno da equipe (o cliente não vê este canal) · Morpheus · Place Sprints_',
    '',
    `✅ **${secao('merovingio', 'o que rendeu')}**`,
    ...(!s.lido ? [semLeitura] : s.resultado.length ? s.resultado : ['• Nenhuma entrega da equipe com venda medida.']),
    ...(s.comMedida ? ['_Associação temporal ajustada por controle e ruído: não é prova de causa._'] : []),
    '',
    `🔁 **${secao('merovingio', 'sem resultado medido, vale revisar antes de repetir')}**`,
    '_Sem resultado mensurável não quer dizer inútil: é o que os dados conseguem mostrar até aqui._',
    ...(!s.lido ? [semLeitura] : revisar.length ? revisar : ['• Nada a revisar nesta semana.']),
    '',
    `🔔 **${secao('morpheus', 'pontos da assessoria')}**`,
    ...(s.assessoria.length ? s.assessoria : ['• Nenhum ponto da assessoria aberto.']),
    '',
    `📲 **${secao('morpheus', 'enviado ao cliente')}**`,
    ...(s.enviados.length ? s.enviados : ['• Nada foi enviado ao cliente até agora.']),
  ].join('\n'))
}

// urgente interno: internos crus (gatilho_cliente 'interno' com itens) + diagnóstico (só lido quando há promoção encerrada ou Ads) → [{ assunto, linhas }]
// sem diagnóstico não dá para conferir curva A nem gasto: esses dois não saem (dia sem leitura não é zero)
export function urgentesConsultor({ internos = [], diag = null, cfg }) {
  const out = [], ids = i => (i.itens || []).map(x => String(x?.item_id || x?.id || '')).filter(Boolean)
  const q = internos.find(i => i.tipo === 'queda_forte_conta'); if (q) out.push({ assunto: 'queda_forte_conta', linhas: [`📉 **${q.rotulo}**: ${limpo(q.texto)}`] })
  if (!diag) return out
  const por = new Map((diag.itens || []).map(i => [String(i.id), i]))
  const promoA = internos.filter(i => i.tipo === 'promocao_encerrada' && ids(i).some(id => por.get(id)?.curva === 'A'))
  if (promoA.length) out.push({ assunto: 'fim_promocao_curva_a', linhas: promoA.map(i => `🏷️ **${i.rotulo}** (inclui anúncio curva A: ${ids(i).filter(id => por.get(id)?.curva === 'A').map(id => limpo(limpo(por.get(id).titulo || id).slice(0, 50))).slice(0, 3).join(', ')}): ${limpo(i.texto)}`) })
  const ads = internos.filter(i => i.tipo === 'ads_sem_retorno'), gasto = ads.reduce((t, i) => t + ids(i).reduce((s, id) => s + (Number(por.get(id)?.ads?.custo) || 0), 0), 0)
  if (ads.length && gasto >= cfg.urgente_ads_gasto_min) out.push({ assunto: 'ads_sem_retorno', linhas: ads.map(i => `💸 **${i.rotulo}**: ${limpo(i.texto)}`) })   // o texto interno já traz o gasto quando o diagnóstico tem o custo
  return out
}
export const montarUrgenteConsultor = ({ cliente, linhas }) => semMarcacao([`**Morpheus · Ponto da assessoria · ${cliente}**`, ...linhas, '_Interno da equipe (o cliente não vê este canal). Detalhes em /cliente › Resumo › Avisos._'].join('\n'))

// ── fábrica ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// deps: handle (better-sqlite3; o mesmo banco dos gatilhos: lê gatilho_cliente/gatilho_lote só para LER), gatilhos ({ notificacao(c), clientesAtivos(), integracao(c), config }),
//   fontes { dados(c) → d (ver secoesConsultor), diagnostico(c) → diagnosticarConta (urgente), destinoInterno(c) → { discord, consultor } | { motivo } (base Clientes, só ML) },
//   envio { enviarInterno, configurado } (gatilhos-envio.js), agora() ISO, estado? (sync_estado), validarPor(nome) → nome|'', log, notificar, time? (config/discord-time.json)
export function criarConsultorDiscord({ handle, gatilhos, fontes = {}, envio = null, agora = () => new Date().toISOString(), estado, validarPor = () => '', log = () => {}, notificar = () => {}, time = lerTime() }) {
  const G = gatilhos.config, cfg = validarCfgConsultor(G.consultor)
  handle.exec(SCHEMA_CONSULTOR)
  estado = estado || estadoDeHandle(handle)
  const agoraMs = () => Date.parse(agora())
  const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
  const ligado = () => estado.get('consultor_discord_ligado') === 'ligado'
  const rotuloTipo = t => G.gatilhos?.[t]?.rotulo || t
  const fusoDe = c => gatilhos.notificacao(c).fuso
  const hojeDe = c => dataNoFuso(agoraMs(), fusoDe(c)), horaDe = c => horaNoFuso(agoraMs(), fusoDe(c))
  const curto = e => String(e?.message ?? e).replace(/["'`][\s\S]*$/, '…').slice(0, 100)
  const link = c => `/cliente?cliente=${encodeURIComponent(c)}&aba=resumo`
  const sel = handle.prepare('SELECT * FROM consultor_aviso WHERE id = ?')
  const ins = handle.prepare("INSERT INTO consultor_aviso (id, cliente, tipo, chave, dia, texto, partes_json, hash, estado, criado_em) VALUES (@id, @cliente, @tipo, @chave, @dia, @texto, @partes_json, @hash, 'montado', @em)")
  function atualizar(id, campos) {
    const ks = Object.keys(campos).filter(k => COLUNAS.includes(k)); if (!ks.length) return
    handle.prepare(`UPDATE consultor_aviso SET ${ks.map(k => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...Object.fromEntries(ks.map(k => [k, campos[k]])), id })
  }
  // tabelas dos gatilhos (mesmo banco), só leitura; banco sem elas (outro autoteste) = nada a ler
  const internosDe = c => { try { return handle.prepare("SELECT tipo, texto, motivo, itens_json FROM gatilho_cliente WHERE cliente = ? AND estado = 'interno' ORDER BY CASE classe WHEN 'critico' THEN 0 WHEN 'atencao' THEN 1 ELSE 2 END, id").all(c).map(r => ({ tipo: r.tipo, rotulo: rotuloTipo(r.tipo), texto: r.texto, motivo: r.motivo, itens: parse(r.itens_json, []) })) } catch { return [] } }
  const lotesDe = c => { try { return handle.prepare("SELECT tipo, dia, estado, motivo, canais_json, texto_final, criado_em FROM gatilho_lote WHERE cliente = ? AND estado <> 'montado' ORDER BY criado_em DESC LIMIT 20").all(c).map(l => ({ ...l, canais: parse(l.canais_json, []) })) } catch { return [] } }
  // destinatários (12/10/2026): TODO cliente Ativo e não prospect (a lista da central dos gatilhos), menos a exclusão opcional (sync_estado.consultor_excluidos, lista JSON de
  // nomes); o filtro de integração ML de fato e o «Webhook ML» válido vêm no tick. Independe do WhatsApp e da liberação do cliente.
  // a lista é digitada à mão (sem tela): casa sem acento/maiúscula/espaço, como mapaElegiveis; nome que não casa com nenhum Ativo vai ao log (1× por conteúdo da lista)
  const normNome = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const excluidos = () => { try { const l = JSON.parse(estado.get('consultor_excluidos') || '[]'); return new Set(Array.isArray(l) ? l.map(normNome).filter(Boolean) : []) } catch { return new Set() } }
  let exAvisado = ''
  const destinatarios = () => {
    const ex = excluidos(), ativos = gatilhos.clientesAtivos?.() || []
    const soltos = [...ex].filter(x => !ativos.some(c => normNome(c) === x)), chaveEx = [...ex].join('|')
    if (soltos.length && chaveEx !== exAvisado) { exAvisado = chaveEx; log('aviso', `consultor: ${soltos.length} nome(s) em consultor_excluidos não casam com nenhum cliente Ativo: ${soltos.join(', ').slice(0, 200)}`) }
    return ativos.filter(c => !ex.has(normNome(c))).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }
  const integracaoDe = c => { try { return gatilhos.integracao ? gatilhos.integracao(c) : { ok: false, motivo: 'integracao_indisponivel' } } catch { return { ok: false, motivo: 'integracao_indisponivel' } } }
  const antesDoInicio = c => !!G.inicio_envios && hojeDe(c) < G.inicio_envios
  const MSG_RECEBE = { ...MOTIVOS_INTEGRACAO, integracao_indisponivel: 'Não deu para conferir a integração com o Mercado Livre agora.', excluido: 'Cliente fora do resumo do time (lista de exclusão).', cliente_inelegivel: 'Só clientes Ativos recebem.',
    antes_do_inicio: `O resumo ao time começa em ${G.inicio_envios ? G.inicio_envios.split('-').reverse().join('/') : '—'}: até lá, só a prévia.` }
  const recebe = c => {
    const x = excluidos().has(normNome(c)) ? { ok: false, motivo: 'excluido' } : !(gatilhos.clientesAtivos?.() || []).includes(c) ? { ok: false, motivo: 'cliente_inelegivel' } : integracaoDe(c)
    const y = x.ok && antesDoInicio(c) ? { ok: false, motivo: 'antes_do_inicio' } : x
    return { ok: !!y.ok, motivo: y.ok ? '' : y.motivo, mensagem: y.ok ? '' : MSG_RECEBE[y.motivo] || '' }
  }
  const destinoDe = async c => { try { return typeof fontes.destinoInterno === 'function' ? await fontes.destinoInterno(c) : null } catch (e) { log('erro', `consultor ${c}: destino ${curto(e)}`); return { motivo: 'destino_indisponivel' } } }
  const exigirPor = bruto => {
    const s = typeof bruto === 'string' ? bruto.trim() : ''; if (!s) throw erro('informe "por" (quem está decidindo — líder ou consultor)')
    const p = validarPor(s); if (!p) throw erro('somente líder ou consultor da central decide sobre o aviso ao consultor', 403)
    return String(p).slice(0, 80)
  }

  // ── resumo semanal: idempotente por (cliente, semana ISO no fuso dele); a prévia devolve o desta semana se já foi montado ──
  const idSemana = (c, dia) => sha(`consultor|${c}|${semanaIso(dia)}|interno_semanal`)
  function montarSemanal(c, { gravar = true } = {}) {
    const dia = hojeDe(c), semana = semanaIso(dia), id = idSemana(c, dia)
    const ja = sel.get(id); if (ja) return { ...publico(ja), ja_existia: true }
    let d = {}
    try { d = typeof fontes.dados === 'function' ? fontes.dados(c) || {} : {} } catch (e) { d = {}; log('erro', `consultor ${c}: leitura do resumo ${curto(e)}`) }
    const texto = montarResumoConsultor({ cliente: c, hoje: dia, s: secoesConsultor({ hoje: dia, d, internos: internosDe(c), lotes: lotesDe(c), cfg }), cfg })
    const partes = dividirDiscord(texto, cfg.discord_max_chars - RESERVA_MENCAO)
    const out = { id, cliente: c, tipo: 'interno_semanal', chave: semana, dia, texto, partes, n_partes: partes.length, hash: sha(texto), estado: 'previa' }
    if (!gravar) return out
    ins.run({ id, cliente: c, tipo: 'interno_semanal', chave: semana, dia, texto, partes_json: JSON.stringify(partes), hash: out.hash, em: agora() })
    return { ...out, estado: 'montado' }
  }

  // ── envio de uma linha (destino lido da central na hora: «Webhook ML» + «Discord ID Consultor ML»); sem retry dentro de retry_min ──
  const emVoo = new Set()                        // ponytail: lock em memória por linha (processo único), como gatilhos.enviarLote
  const assuntoDe = r => r.tipo === 'interno_semanal' ? `Resumo semanal ao consultor · ${dm(r.dia)}/${r.dia.slice(0, 4)}` : `Ponto da assessoria · ${dm(r.dia)}/${r.dia.slice(0, 4)} · ${ASSUNTOS[r.chave] || r.chave}`
  async function enviarAviso(id, { dest: lido = null } = {}) {
    const r = sel.get(id); if (!r) return { ok: false, motivo: 'desconhecido' }
    if (['enviado', 'entregue'].includes(r.estado)) return { ok: false, estado: r.estado, motivo: 'ja_enviado' }
    if (emVoo.has(id) || (r.tentado_em && agoraMs() - Date.parse(r.tentado_em) < G.retry_min * 60_000)) return { ok: false, estado: r.estado, motivo: 'retry_janela' }
    emVoo.add(id)
    const fim = (est, motivo, extra = {}) => { atualizar(id, { estado: est, motivo, tentado_em: agora(), ...extra }); return { ok: est === 'enviado', estado: est, motivo, id } }
    try {
      if (!envio?.enviarInterno) return fim('pendente', 'n8n_nao_configurado')
      const dest = lido || await destinoDe(r.cliente)
      if (!dest?.discord) {
        notificar({ tipo: 'consultor_discord_sem_destino', nivel: 'alerta', titulo: `Aviso ao consultor não saiu: ${r.cliente}`, cliente: r.cliente, link: link(r.cliente), dedupeMin: 24 * 60,
          corpo: /notion_|indisponivel/.test(dest?.motivo || '') ? 'Não deu para ler a base Clientes do Notion agora; tenta de novo no próximo ciclo.' : dest?.motivo ? 'O cliente não foi achado (ou aparece mais de uma vez) na base Clientes do Notion.' : 'Falta o «Webhook ML» (canal do cliente no Discord) na base Clientes do Notion, ou ele está num formato inválido.' })
        return fim('pendente', dest?.motivo || 'sem_destino')
      }
      // menções (regra do David): os 3 cargos do time sempre + o consultor quando o id da central é válido, no topo da 1ª parte
      const m = mencoesTime(time, dest.consultor)
      if (!m.users.length) notificar({ tipo: 'consultor_discord_sem_mencao', nivel: 'info', titulo: `Resumo do time sem o consultor marcado: ${r.cliente}`, cliente: r.cliente, link: link(r.cliente), dedupeMin: 7 * 24 * 60,
        corpo: 'Falta o «Discord ID Consultor ML» na base Clientes do Notion (id numérico de 15 a 21 dígitos): a mensagem sai marcando só os cargos do time.' })
      const partes = comMencoes(parse(r.partes_json, []), m.prefixo)
      let res
      try { res = await envio.enviarInterno({ lote: { id, tipo: r.tipo, cliente: r.cliente, assunto: assuntoDe(r) }, destino: dest.discord, partes, mencionar: m.users, mencionarCargos: m.roles }) }
      catch (e) { res = { estado: 'falhou', motivo: 'erro_interno' }; log('erro', `consultor ${r.cliente}: envio ${String(e?.name || 'Error')}`) }
      if (res.estado === 'falhou') notificar({ tipo: 'consultor_discord_falhou', nivel: 'alerta', titulo: `Aviso ao consultor não entregue: ${r.cliente}`, corpo: `Entrega pelo n8n falhou (${res.motivo || 'erro'}); tenta de novo no próximo ciclo.`, cliente: r.cliente, link: link(r.cliente), dedupeMin: 120 })
      log(/^n8n_(5\d\d|timeout|rede)$/.test(res.motivo || '') ? 'erro' : 'info', `consultor ${r.cliente}: ${r.tipo} ${res.estado}${res.motivo ? ` (${res.motivo})` : ''} · ${partes.length} parte(s) · ${m.roles.length} cargo(s)${m.users.length ? ' + consultor' : ''}`)   // nunca o webhook nem o id
      return fim(res.estado, res.motivo || '', { mencao: m.users.length ? 1 : 0, ...(res.estado === 'enviado' ? { enviado_em: agora() } : {}) })
    } finally { emVoo.delete(id) }
  }
  // retenta pendente/falhou; nunca o que o n8n disse que falhou (recibo: reenviar duplicaria as partes que já saíram) nem «sem n8n» enquanto ele não existe
  const podeTentar = r => ['montado', 'pendente', 'falhou'].includes(r.estado) && r.motivo !== 'recibo_falhou' && !(r.motivo === 'n8n_nao_configurado' && !envio?.configurado?.())

  // ── urgente interno: 1 por assunto a cada urgente_cooldown_dias (contado da criação); o que não saiu é retentado no mesmo dia ──
  async function urgentes(c) {
    const internos = internosDe(c); if (!internos.length) return []
    let diag = null
    if (internos.some(i => ['promocao_encerrada', 'ads_sem_retorno'].includes(i.tipo)) && typeof fontes.diagnostico === 'function') {
      try { const x = fontes.diagnostico(c); diag = x?.disponivel ? x : null } catch (e) { log('erro', `consultor ${c}: diagnóstico ${curto(e)}`) }
    }
    const feitos = [], dia = hojeDe(c), desde = new Date(agoraMs() - cfg.urgente_cooldown_dias * 86_400_000).toISOString()
    for (const u of urgentesConsultor({ internos, diag, cfg })) {
      const ult = handle.prepare("SELECT * FROM consultor_aviso WHERE cliente = ? AND tipo = 'interno_imediato' AND chave = ? AND criado_em >= ? ORDER BY criado_em DESC LIMIT 1").get(c, u.assunto, desde)
      if (ult) { if (ult.dia === dia && podeTentar(ult)) feitos.push(await enviarAviso(ult.id)); continue }
      const texto = montarUrgenteConsultor({ cliente: c, linhas: u.linhas }), partes = dividirDiscord(texto, cfg.discord_max_chars - RESERVA_MENCAO), id = sha(`consultor|${c}|${u.assunto}|${agora()}`)
      ins.run({ id, cliente: c, tipo: 'interno_imediato', chave: u.assunto, dia, texto, partes_json: JSON.stringify(partes), hash: sha(texto), em: agora() })
      feitos.push(await enviarAviso(id))
    }
    return feitos
  }

  // ── automático (mesmo relógio dos gatilhos, a cada 10 min): sai no 1º if com a chave desligada. Por cliente (12/10/2026): nada antes de inicio_envios; fora da janela de terça
  // nada sai (o urgente só com urgente_ligado); só com integração ML de fato; sem «Webhook ML» válido na central o cliente não recebe (sem linha, sem sino: lido 1× por dia) ──
  let rodando = false
  const semCanal = new Map()                     // ponytail: cliente → dia em que a central disse «sem Webhook ML» (memória do processo; 1 leitura do Notion por cliente por dia)
  async function tick({ origem = 'timer' } = {}) {
    if (!ligado()) return { pulou: 'desligado' }
    if (rodando) return { pulou: 'em_andamento' }
    rodando = true
    const res = { pulou: '', origem, semanais: 0, urgentes: 0, falhas: 0, sem_integracao: 0, sem_canal: 0 }
    try {
      for (const c of destinatarios()) {
        try {
          const dia = hojeDe(c), h = horaDe(c)
          if (antesDoInicio(c)) continue
          const naJanela = diaSemana(dia) === cfg.dia_semana && h >= cfg.hora && h < cfg.ate          // fora da janela de terça o resumo espera a próxima (não «recupera» em outro dia)
          if (!naJanela && !cfg.urgente_ligado) continue
          if (!integracaoDe(c).ok) { res.sem_integracao++; continue }
          if (naJanela) {
            const r = sel.get(idSemana(c, dia))
            if (r) { if (podeTentar(r) && (await enviarAviso(r.id)).ok) res.semanais++ }
            else if (semCanal.get(c) === dia) res.sem_canal++
            else {
              const dest = await destinoDe(c)
              if (dest?.discord) { const m = montarSemanal(c); if ((await enviarAviso(m.id, { dest })).ok) res.semanais++ }
              else { res.sem_canal++; if (!dest || !dest.motivo || ['cliente_nao_esta_na_central', 'mais_de_uma_linha_na_central'].includes(dest.motivo)) semCanal.set(c, dia) }   // Notion fora do ar: tenta no próximo tick
            }
          }
          if (cfg.urgente_ligado) for (const x of await urgentes(c)) if (x.ok) res.urgentes++
        } catch (e) { res.falhas++; log('erro', `consultor ${c}: ${curto(e)}`) }
        await new Promise(r => setImmediate(r))
      }
      if (res.semanais || res.urgentes || res.falhas) log('info', `aviso ao consultor (${origem}): ${res.semanais} resumo(s), ${res.urgentes} urgente(s), ${res.falhas} falha(s)`)
    } finally { rodando = false }
    return res
  }

  // recibo do n8n (rota de recibo dos gatilhos, quando o lote_id é desta tabela): só canal discord; idempotente; 'falhou' não é retentado (as partes que saíram duplicariam)
  function registrarRecibo({ lote_id, canal, estado: est, em } = {}) {
    const r = sel.get(String(lote_id || '')); if (!r) return { ok: false, motivo: 'lote_desconhecido' }
    if (canal !== 'discord') return { ok: false, motivo: 'canal_invalido' }
    if (!['entregue', 'falhou'].includes(est)) return { ok: false, motivo: 'estado_invalido' }
    const rec = parse(r.recibo_json, {}); if (rec.discord) return { ok: true, duplicado: true }
    rec.discord = { estado: est, em: /^\d{4}-\d{2}-\d{2}T/.test(String(em)) ? String(em).slice(0, 24) : agora() }
    atualizar(r.id, { recibo_json: JSON.stringify(rec), ...(r.estado === 'enviado' ? { estado: est, motivo: est === 'falhou' ? 'recibo_falhou' : '' } : {}) })
    if (est === 'falhou') notificar({ tipo: 'consultor_discord_falhou', nivel: 'alerta', titulo: `Aviso ao consultor não entregue: ${r.cliente}`, corpo: 'O Discord recusou a mensagem (recibo do n8n). Confira o «Webhook ML» na base Clientes.', cliente: r.cliente, link: link(r.cliente), dedupeMin: 120 })
    return { ok: true, duplicado: false }
  }

  function chave(body = {}) {
    if (typeof body.ligado !== 'boolean') throw erro('informe "ligado" (verdadeiro ou falso)')
    const por = exigirPor(body.por)
    estado.set('consultor_discord_ligado', body.ligado ? 'ligado' : 'desligado'); estado.set('consultor_discord_ligado_por', `${por} · ${agora()}`)
    log('info', `aviso ao consultor no Discord ${body.ligado ? 'LIGADO' : 'DESLIGADO'} por ${por}`)
    return { ok: true, ligado: body.ligado }
  }
  const chaveEstado = () => ({ ligado: ligado(), por: estado.get('consultor_discord_ligado_por') || '', n8n: { configurado: !!envio?.configurado?.() }, agenda: { dia_semana: cfg.dia_semana, hora: cfg.hora, ate: cfg.ate },
    urgente_ligado: !!cfg.urgente_ligado, inicio_envios: G.inicio_envios || '' })
  const MSG = { n8n_nao_configurado: 'Entrega n8n não configurada (PLACE_GATILHOS_URL/SECRET).', sem_destino: 'Falta o «Webhook ML» na base Clientes do Notion.', destino_indisponivel: 'Base Clientes do Notion indisponível na hora do envio.',
    recibo_falhou: 'O Discord recusou a mensagem (recibo do n8n).', retry_janela: 'Tentado há pouco; nova tentativa no próximo ciclo.' }
  const publico = r => ({ id: r.id, cliente: r.cliente, tipo: r.tipo, chave: r.chave, dia: r.dia, estado: r.estado, motivo: r.motivo, motivo_texto: MSG[r.motivo] || (/^n8n_/.test(r.motivo) ? 'A entrega pelo n8n falhou.' : r.motivo ? 'Motivo registrado no log do servidor.' : ''),
    mencao: !!r.mencao, texto: r.texto, partes: parse(r.partes_json, []), n_partes: parse(r.partes_json, []).length, hash: r.hash, criado_em: r.criado_em, tentado_em: r.tentado_em, enviado_em: r.enviado_em, recibo: parse(r.recibo_json, {}) })
  // estado leve (sem Notion); ?previa=1 monta o resumo desta semana SEM gravar e mostra as partes EXATAS que saem (cargos + consultor lido da central no topo da 1ª)
  async function listarCliente(c, { previa = false } = {}) {
    const historico = handle.prepare('SELECT * FROM consultor_aviso WHERE cliente = ? ORDER BY criado_em DESC LIMIT 10').all(c).map(publico)
    const out = { cliente: c, chave: chaveEstado(), recebe: recebe(c), ultimo: historico[0] || null, historico }
    if (!previa) return out
    const p = montarSemanal(c, { gravar: false }), dest = await destinoDe(c), m = mencoesTime(time, dest?.consultor)
    // canal_motivo: '' | sem_destino (central lida, sem «Webhook ML» válido) | motivo da leitura (notion_*, destino_indisponivel, cliente fora/duplicado na central) — a tela não afirma «falta o webhook» quando a central nem foi lida
    return { ...out, previa: { ...p, partes: comMencoes(p.partes, m.prefixo), mencoes: { cargos: m.roles.length, consultor: m.users.length > 0 }, canal: !!dest?.discord, canal_motivo: dest?.discord ? '' : dest?.motivo || 'sem_destino' } }
  }

  return { montarSemanal, enviarAviso, urgentes, tick, registrarRecibo, chave, chaveEstado, listarCliente, config: cfg }
}

// ── fontes REAIS (só leitura do banco + base Clientes do Notion): o servidor e a prévia com dados reais (sem gravar nada) usam as MESMAS ──
export async function fontesConsultorReais() {
  const [{ db, log }, { dadosPlanoSemana }, { buscarDestinos }, { diagnosticarConta }, imp, { padroesGlobaisCache }, { alinhamentosReal }, { criarVinculos }, { ehAberta }] = await Promise.all([
    import('./db.js'), import('./gatilhos-real.js'), import('./gatilhos-destinos-notion.js'), import('./diagnostico-conta.js'), import('./impacto-tarefas.js'), import('./calibracao.js'),
    import('./alinhamentos-real.js'), import('./vinculos.js'), import('./status-tarefa.js')])
  const vinculos = criarVinculos(db)
  const tenta = (rot, fn, pad) => { try { return fn() } catch (e) { log('erro', `consultor: ${rot} ${String(e?.message ?? e).slice(0, 80)}`); return pad } }
  const fontes = {
    diagnostico: c => diagnosticarConta(c),
    dados: c => {
      const diag = tenta('diagnóstico', () => diagnosticarConta(c), null), an = tenta('medidas', () => imp.analisarCliente(c), null)
      const plano = diag?.disponivel && an ? tenta('entregas', () => dadosPlanoSemana(c, { diag, medidas: an.medidas }), {}) : {}
      const tarefas = db.prepare('SELECT id, titulo, descricao, conteudo, status, tipo_demanda FROM tarefas WHERE cliente = ? AND arquivada = 0').all(c).filter(ehAberta)
      const itens = db.prepare('SELECT item_id, titulo FROM meli_item WHERE cliente = ?').all(c), vmap = vinculos.vinculosDe(c, tarefas, new Set(itens.map(i => i.item_id)))
      // padrões da BASE por família (cache de 5 min da calibração; o mesmo agrupamento de priorEfetivo)
      const fam = new Map()
      for (const g of tenta('padrões', () => padroesGlobaisCache().por_tipo, [])) {
        const f = familiaDeDemanda(g.chave), x = fam.get(f.id) || fam.set(f.id, { id: f.id, nome: f.nome, n: 0, melhorou: 0 }).get(f.id); x.n += g.n; x.melhorou += g.melhorou
      }
      return {
        medidas: an ? an.medidas.map(m => ({ tarefa: m.titulo, tipo: m.tipo, analista: m.analista, data: m.data, estado: m.estado, efeito_pct: m.efeito_pct, itens: m.itens || [],
          confianca: m.confianca ? { score: m.confianca.score, classe: m.confianca.classe } : null, receita: m.receita_alocada || 0, aprende: !imp.excluirDaAprendizagem(m) })) : undefined,
        entregas: plano.entregas || [],
        tarefasAbertas: tarefas.map(t => ({ titulo: t.titulo, tipo: t.tipo_demanda, itens: (vmap.get(t.id) || []).map(x => x.item_id) })),
        itensDiag: diag?.disponivel ? (diag.itens || []).map(i => ({ id: i.id, titulo: i.titulo, curva: i.curva, u: i.u })) : null,
        titulos: Object.fromEntries(itens.map(i => [i.item_id, i.titulo])),
        familias: [...fam.values()].map(f => ({ ...f, taxa_alto: imp.wilson(f.melhorou, f.n).alto })),
        alinhamentosVencidos: tenta('alinhamentos', () => alinhamentosReal().listar(c).filter(a => a.estado === 'vencido').map(a => ({ rotulo: a.rotulo, escopo: a.escopo, chave: a.chave, revisar_em: a.revisar_em })), []),
      }
    },
    destinoInterno: async c => { const r = await buscarDestinos(c); return r.achado ? r.destinos.interno : { discord: '', consultor: '', motivo: r.motivo } },
  }
  return fontes
}

// ── fiação REAL (só quando o servidor chama): banco, fontes reais, notificação interna e o webhook do n8n ──
export async function criarConsultorDiscordReal({ gatilhos }) {
  const [{ db, agora, log }, { env }, { notificar }, { validarLiderOuConsultor }, { criarEnvio }, fontes] = await Promise.all([
    import('./db.js'), import('./env.js'), import('./notificacoes.js'), import('./equipe.js'), import('./gatilhos-envio.js'), fontesConsultorReais()])
  const envio = criarEnvio({ env, agora, webhook: gatilhos.config.webhook, log })
  const { voz } = await import('./sistemas.js')
  return criarConsultorDiscord({ handle: db, gatilhos, fontes, envio, agora, validarPor: validarLiderOuConsultor, log: (n, m) => log(n, voz('morpheus', m)), notificar })
}
