// Envio do Relatório de Sprints Place2u ao Notion do cliente: banco (programação + log de envios), AGENDA (funções puras, aritmética de dias inteiros
// com Date.UTC — nunca o fuso da máquina), prévia/confirmação, lote, diagnóstico das bases, liberação por líder e o agendador (tick).
// NÃO importa db.js: o handle (better-sqlite3), o cliente do Notion, o brief, os destinos, o relógio e o notificador entram por injeção —
// o autoteste roda em :memory: com stub do Notion. Docs: docs/desenho-relatorio-notion.md (Parte C) e docs/contrato-relatorio-envio.md.
// Regras: prévia nunca grava; confirmar só vale com `=== true`; reenvio do mesmo período nunca duplica (índice único + consulta por título);
// 5xx/timeout na criação NUNCA reenvia (consulta por título antes de qualquer nova tentativa); o corpo do Notion nunca vai a resposta nem a log.
// Revisão nº 1: dia e hora lidos em cfg.fuso (Intl, nunca o fuso do processo); elegibilidade FALHA FECHADA (só status «Ativo» explícito); queda do Notion/rede/timeout não pausa cliente
// (disjuntor de 3 falhas seguidas por tick/lote, com UM aviso); 401 interrompe a carteira; salvar programação não reativa pausa (só liberar); freio relido a cada cliente.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { ROOT } from './env.js'
import { CATEGORIA, auditarBlocos, auditarTexto, linhasDeTexto, codigosDe } from './relatorio-seguro.js'
import * as NT from './relatorio-notion.js'      // só para o que a frente do Notion pode ainda não ter exportado (MSG_POR_CODIGO): acesso por namespace não quebra a carga
import { briefParaBlocos, criarRelatorioNotion, decidirCategoria, decidirStatus, classificarErro, tituloFinal, tituloOk, normNome, RX_ID, MSG_DESTINO, MSG_NOTION, PROXIMA_ACAO } from './relatorio-notion.js'
import { criarRelatorioTarefa, montarTarefa } from './relatorio-tarefa.js'   // PLANO B: o relatório vira tarefa no quadro «Tarefas - {Cliente}» quando a Informações não aceita
import { briefParaHtml, gerarPdf, anexarPdf, caminhoPdf } from './relatorio-pdf.js'   // documento (PDF) anexado à página depois do envio; falha = aviso, nunca desfaz o envio

export const SCHEMA_RELATORIO = `
CREATE TABLE IF NOT EXISTS relatorio_programacao (
  cliente TEXT PRIMARY KEY,                       -- nome canônico da central, nunca do corpo cru
  frequencia TEXT NOT NULL DEFAULT 'desligado',   -- desligado | semanal | quinzenal | mensal
  proximo_envio TEXT NOT NULL DEFAULT '',         -- AAAA-MM-DD (dia local); '' quando desligado
  ancora_dia INTEGER NOT NULL DEFAULT 0,          -- mensal: dia do mês de referência (1-31, com clamp); evita deriva 31/01 -> 28/02 -> 28/03
  ativado_por TEXT NOT NULL DEFAULT '', ativado_em TEXT NOT NULL DEFAULT '',   -- liberação do líder: só quem tem isso preenchido recebe envio AUTOMÁTICO
  tentar_apos TEXT NOT NULL DEFAULT '',           -- ISO; backoff depois de falha
  falhas_seguidas INTEGER NOT NULL DEFAULT 0,
  pausado_motivo TEXT NOT NULL DEFAULT '',        -- '' = ativo | sem_base | opcao_ausente_status | pagina_invalida | destino_compartilhado | sem_permissao | conteudo | falhas …
  atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relatorio_envio (      -- log append-only de tentativas CONFIRMADAS (a prévia não grava)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL,
  origem TEXT NOT NULL,                           -- manual | lote | agendado
  estado TEXT NOT NULL,                           -- enviado | adotado | arquivado | falhou | bloqueado
  motivo TEXT NOT NULL DEFAULT '',                -- código fixo (sem_base, conteudo:sem_motivo, notion_403 …), nunca texto do Notion
  page_id TEXT NOT NULL DEFAULT '', page_url TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',             -- aplicada | criada | padrao_da_base | sem_propriedade
  hash TEXT NOT NULL DEFAULT '',                  -- sha256(children) 16 hex: auditoria do que saiu
  por TEXT NOT NULL, em TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0, incerto INTEGER NOT NULL DEFAULT 0,
  anexo TEXT NOT NULL DEFAULT ''                  -- documento PDF: '' (não tentado) | ok | falhou:<codigo>
);
CREATE INDEX IF NOT EXISTS ix_relenvio_cli ON relatorio_envio (cliente, ate, estado);
CREATE UNIQUE INDEX IF NOT EXISTS ux_relenvio_vivo ON relatorio_envio (cliente, de, ate) WHERE estado IN ('enviado','adotado');
`

// ── relógio no fuso da operação: dia e hora SEMPRE lidos com Intl em `fuso` (nunca getHours()/getDate() do processo) ──────────────────────
export const FUSO_PADRAO = 'America/Sao_Paulo'
const fmtFuso = new Map()
const fusoValido = f => { try { new Intl.DateTimeFormat('en-CA', { timeZone: f }); return true } catch { return false } }
const partesNoFuso = (ms, fuso) => {
  if (!fmtFuso.has(fuso)) fmtFuso.set(fuso, new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  const p = Object.fromEntries(fmtFuso.get(fuso).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }
}
export const dataNoFuso = (ms = Date.now(), fuso = FUSO_PADRAO) => partesNoFuso(ms, fuso).data       // AAAA-MM-DD
export const horaNoFuso = (ms = Date.now(), fuso = FUSO_PADRAO) => partesNoFuso(ms, fuso).hora       // HH:MM

// ── configuração (config/relatorio-envio.json), validada na carga ───────────────────────────────────────────────
export const FALLBACK_PADRAO = Object.freeze({ ligado: false, titulo_prefixo: 'Relatório', canal: 'Geral', demanda: 'Relatório', responsavel: 'Pamela', descricao_max: 1900 })
export const ANEXO_PADRAO = Object.freeze({ ligado: true, timeout_ms: 60_000 })
export function validarConfig(c) {
  const falha = m => { throw new Error(`config/relatorio-envio.json: ${m}`) }
  if (!c || typeof c !== 'object' || Array.isArray(c)) falha('JSON inválido')
  if (typeof c.fuso !== 'string' || !fusoValido(c.fuso)) falha('"fuso" precisa ser um fuso IANA válido (ex.: America/Sao_Paulo)')
  for (const k of ['hora_inicio', 'hora_fim']) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c[k]))) falha(`"${k}" precisa ser HH:MM`)
  if (!(c.hora_inicio < c.hora_fim)) falha('"hora_inicio" precisa ser antes de "hora_fim"')
  if (!Number.isInteger(c.dia_semana_padrao) || c.dia_semana_padrao < 0 || c.dia_semana_padrao > 6) falha('"dia_semana_padrao" precisa ser 0 a 6 (0 = domingo)')
  for (const k of ['dias_uteis_apenas', 'agendador_ligado']) if (typeof c[k] !== 'boolean') falha(`"${k}" precisa ser verdadeiro ou falso`)
  if (!Array.isArray(c.status_elegiveis) || !c.status_elegiveis.length || !c.status_elegiveis.every(s => typeof s === 'string' && s.trim())) falha('"status_elegiveis" precisa ser uma lista de textos')
  for (const f of ['semanal', 'quinzenal', 'mensal']) if (!Number.isInteger(c.intervalo_minimo_dias?.[f]) || c.intervalo_minimo_dias[f] < 1) falha(`"intervalo_minimo_dias.${f}" precisa ser inteiro ≥ 1`)
  const num = (k, min, max = Infinity, inteiro = true) => { const v = c[k]; if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (inteiro && !Number.isInteger(v))) falha(`"${k}" fora do intervalo ${min}..${max === Infinity ? '∞' : max}`) }
  num('lote_por_tick', 1, 50); num('orcamento_tick_min', 0.01, 120, false); num('lote_max_manual', 1, 100); num('tentativas_max', 1, 10)
  num('backoff_base_min', 1, 1440); num('backoff_max_min', c.backoff_base_min ?? 1, 10080); num('timeout_cliente_s', 0.01, 3600, false); num('previa_ttl_min', 1, 240)
  if (c.categoria !== CATEGORIA) falha(`"categoria" precisa ser exatamente «${CATEGORIA}» (nome fixo da categoria no Notion)`)
  const ft = { ...FALLBACK_PADRAO, ...(c.fallback_tarefa && typeof c.fallback_tarefa === 'object' && !Array.isArray(c.fallback_tarefa) ? c.fallback_tarefa : {}) }
  if (typeof ft.ligado !== 'boolean') falha('"fallback_tarefa.ligado" precisa ser verdadeiro ou falso')
  for (const k of ['titulo_prefixo', 'canal', 'demanda', 'responsavel']) if (typeof ft[k] !== 'string' || !ft[k].trim() || /[\r\n]/.test(ft[k])) falha(`"fallback_tarefa.${k}" precisa ser um texto`)
  if (!Number.isInteger(ft.descricao_max) || ft.descricao_max < 200 || ft.descricao_max > 1900) falha('"fallback_tarefa.descricao_max" fora do intervalo 200..1900')
  const ax = { ...ANEXO_PADRAO, ...(c.anexo_pdf && typeof c.anexo_pdf === 'object' && !Array.isArray(c.anexo_pdf) ? c.anexo_pdf : {}) }
  if (typeof ax.ligado !== 'boolean') falha('"anexo_pdf.ligado" precisa ser verdadeiro ou falso')
  if (!Number.isInteger(ax.timeout_ms) || ax.timeout_ms < 1000 || ax.timeout_ms > 600_000) falha('"anexo_pdf.timeout_ms" fora do intervalo 1000..600000')
  return Object.freeze({ ...c, status_elegiveis: Object.freeze([...c.status_elegiveis]), intervalo_minimo_dias: Object.freeze({ ...c.intervalo_minimo_dias }), fallback_tarefa: Object.freeze(ft), anexo_pdf: Object.freeze(ax) })
}
export const lerConfig = (caminho = join(ROOT, 'config', 'relatorio-envio.json')) => validarConfig(JSON.parse(readFileSync(caminho, 'utf-8')))

export const FREQUENCIAS = Object.freeze([
  { id: 'desligado', rotulo: 'Desligado' }, { id: 'semanal', rotulo: 'Semanal' }, { id: 'quinzenal', rotulo: 'Quinzenal' }, { id: 'mensal', rotulo: 'Mensal' },
])
const FREQ_IDS = new Set(FREQUENCIAS.map(f => f.id))
const ROTULO_FREQ = Object.fromEntries(FREQUENCIAS.map(f => [f.id, f.rotulo]))
const SITUACAO_ROTULO = { desligado: 'Desligado', nao_liberado: 'Aguardando liberação', agendado: 'Agendado', atrasado: 'Atrasado', enviado: 'Enviado', pausado: 'Pausado', falhou: 'Última tentativa falhou' }
export const MINIMO_PADRAO = Object.freeze({ semanal: 4, quinzenal: 9, mensal: 18 })

// ── agenda: funções PURAS, dias inteiros, Date.UTC (o resultado não depende do fuso da máquina) ──────────────────────────
export const dataValida = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [a, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(a, m - 1, d))      // ida e volta: 30/02, mês 13 e ano < 100 não passam
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
const utc = iso => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d) }
const fmtUtc = ms => new Date(ms).toISOString().slice(0, 10)
export const somarDias = (iso, n) => fmtUtc(utc(iso) + n * 86_400_000)
export const diasEntre = (de, ate) => Math.round((utc(ate) - utc(de)) / 86_400_000)
export const diaSemana = iso => new Date(utc(iso)).getUTCDay()                // 0 = domingo … 5 = sexta
export const janelaNominal = hojeIso => ({ de: somarDias(hojeIso, -7), ate: somarDias(hojeIso, -1) })   // 7 dias FECHADOS: o conteúdo é sempre este
export const proximaSexta = (hojeIso, dow = 5) => { let falta = (dow - diaSemana(hojeIso) + 7) % 7; if (falta === 0) falta = 7; return somarDias(hojeIso, falta) }   // estritamente futura

// semanal +7, quinzenal +14, mensal = mesmo dia (âncora) do mês seguinte com clamp ao último dia (31/01 → 28/02 → 31/03; 2028 → 29/02)
export function proximaData(freq, base, { ancoraDia = 0 } = {}) {
  if (freq === 'semanal') return somarDias(base, 7)
  if (freq === 'quinzenal') return somarDias(base, 14)
  if (freq === 'mensal') {
    const [a, m, d] = base.split('-').map(Number)
    const alvoM = m === 12 ? 1 : m + 1, alvoA = m === 12 ? a + 1 : a
    const ultimo = new Date(Date.UTC(alvoA, alvoM, 0)).getUTCDate()
    const dia = Math.min(ancoraDia > 0 ? ancoraDia : d, ultimo)
    return `${alvoA}-${String(alvoM).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  }
  throw new Error('frequência sem próxima data')
}
const ancoraDe = prog => prog.frequencia === 'mensal' ? (prog.ancora_dia > 0 ? prog.ancora_dia : Number(String(prog.proximo_envio).slice(8, 10))) : 0
// próximo_envio depois de um envio feito em `hojeIso`: avança enquanto <= hoje (atrasado = UM envio, sem fila) e enquanto estiver perto demais do envio
// que acabou de sair (intervalo mínimo 4/9/18). A âncora (sexta, dia do mês) é preservada: antecipar na quarta consome a sexta; no domingo mantém.
export function aposEnvio(prog, hojeIso, minimos = MINIMO_PADRAO) {
  if (!prog || !FREQ_IDS.has(prog.frequencia) || prog.frequencia === 'desligado' || !dataValida(prog.proximo_envio)) return ''
  const ancoraDia = ancoraDe(prog), minimo = minimos[prog.frequencia] ?? MINIMO_PADRAO[prog.frequencia]
  let p = prog.proximo_envio
  for (let i = 0; i < 400 && (p <= hojeIso || diasEntre(hojeIso, p) < minimo); i++) p = proximaData(prog.frequencia, p, { ancoraDia })
  return p
}
export function datasPrevistas(prog, k = 3) {
  if (!prog || prog.frequencia === 'desligado' || !FREQ_IDS.has(prog.frequencia) || !dataValida(prog.proximo_envio)) return []
  const ancoraDia = ancoraDe(prog), out = [prog.proximo_envio]
  while (out.length < k) out.push(proximaData(prog.frequencia, out[out.length - 1], { ancoraDia }))
  return out
}
export function dentroDaJanela({ hoje, hora }, cfg) {
  if (cfg.dias_uteis_apenas) { const d = diaSemana(hoje); if (d === 0 || d === 6) return false }
  return String(hora) >= cfg.hora_inicio && String(hora) < cfg.hora_fim
}
// o agendador pode enviar AGORA para esta programação? (liberada, sem pausa, vencida, fora do backoff e dentro da janela)
export function devido(prog, { hoje, agora, hora, cfg, ignorarJanela = false }) {
  if (!prog || prog.frequencia === 'desligado' || !FREQ_IDS.has(prog.frequencia)) return false
  if (!prog.ativado_por || prog.pausado_motivo) return false
  if (!dataValida(prog.proximo_envio) || prog.proximo_envio > hoje) return false
  if (prog.tentar_apos && Date.parse(agora) < Date.parse(prog.tentar_apos)) return false
  return ignorarJanela || dentroDaJanela({ hoje, hora }, cfg)
}
// backoff depois da n-ésima falha seguida: 30, 60, 120… min, no máximo 6 h
export const backoffMin = (n, cfg) => Math.min(cfg.backoff_base_min * 2 ** Math.max(0, n - 1), cfg.backoff_max_min)

// semeadura (scripts/semear-relatorio-programacao.mjs): semanal na `data` para os clientes dados, SEM liberar (ativado_por ''), sem nunca sobrescrever linha existente
export function semearProgramacao(handle, nomes, { data, aplicar = false, agora = () => new Date().toISOString(), hoje = () => dataNoFuso(Date.parse(agora())) } = {}) {
  if (!dataValida(data)) throw new Error('data inválida (use AAAA-MM-DD)')
  if (data < hoje()) throw new Error('data no passado (use hoje ou uma data futura)')
  handle.exec(SCHEMA_RELATORIO)
  const existe = handle.prepare('SELECT 1 FROM relatorio_programacao WHERE cliente = ?')
  const ins = handle.prepare("INSERT INTO relatorio_programacao (cliente, frequencia, proximo_envio, ancora_dia, atualizado_em) VALUES (?, 'semanal', ?, 0, ?) ON CONFLICT(cliente) DO NOTHING")
  const novos = [], existentes = []
  for (const nome of [...new Set(nomes)].filter(n => typeof n === 'string' && n.trim() && !/^\s*\[Comercial\]/i.test(n))) (existe.get(nome) ? existentes : novos).push(nome)
  if (aplicar) handle.transaction(() => { for (const n of novos) ins.run(n, data, agora()) })()
  return { aplicado: aplicar, data, total: novos.length + existentes.length, novos, existentes }
}

// ── utilitários ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const str = v => typeof v === 'string' ? v.trim() : ''
const sha = s => createHash('sha256').update(s).digest('hex').slice(0, 16)
const CATEGORIA_LOG = { ok: 'aplicada', ok_alternativa: 'alternativa', select_cria: 'criada', padrao_da_base: 'padrao_da_base', sem_propriedade: 'sem_propriedade' }
const CAT_TAREFA = 'tarefa'                 // categoria gravada em relatorio_envio quando o relatório foi como tarefa no quadro (plano B)
const MOTIVOS_FALLBACK = new Set(['opcao_ausente_status', 'sem_pagina', 'sem_base'])   // só estes motivos levam ao plano B
export const rotuloTarefa = (cfg) => `tarefa (${cfg?.fallback_tarefa?.responsavel || FALLBACK_PADRAO.responsavel})`
const MSG_FALHA = {
  timeout: 'o envio demorou mais que o limite e foi interrompido — confira no Notion antes de tentar de novo',
  qualidade: 'o Mercado Livre não respondeu na geração deste relatório — tente de novo mais tarde',
  erro_brief: 'não foi possível montar o relatório agora',
  erro_interno: 'falha interna ao enviar o relatório — veja o log do servidor',
  incerto: 'não foi possível confirmar se a página foi criada — o sistema confere pelo título antes de qualquer nova tentativa',
  conteudo: 'o texto do relatório não passou na auditoria de conteúdo — nada foi enviado',
  vazio: 'não há o que mostrar neste período (sem resultados, atividades nem próximos passos); nenhuma página foi criada',
  precisa_previa: 'o primeiro relatório deste cliente precisa ser enviado pela ficha do cliente, com a prévia lida',
  opcao_ausente_status: `a coluna Secção é do tipo Status e não tem a opção «${CATEGORIA}» — crie a opção no Notion`,
  sem_propriedade: 'a base Informações não tem a coluna Secção — a página só pode ser enviada manualmente, sem categoria',
  falhas: 'três tentativas seguidas falharam — confira o destino e libere de novo',
  cliente_inelegivel: 'só clientes Ativos recebem relatório; mude o status na central',
  cliente_renomeado: 'o nome deste cliente mudou na central — programe-o de novo com o nome atual e libere o envio automático (nada foi enviado)',
  em_voo: 'já existe um envio deste cliente em andamento',
  notion_0: MSG_NOTION[0], notion_400: MSG_NOTION[400], notion_401: MSG_NOTION[401] || 'o token do Notion é inválido ou foi revogado — renove o NOTION_TOKEN no servidor', notion_403: MSG_NOTION[403], notion_404: MSG_NOTION[404],
  ...(NT.MSG_POR_CODIGO || {}),
  ...MSG_DESTINO,
}
const MSG_INDISPONIVEL = 'Notion indisponível: envios retomam no próximo ciclo'
const MSG_VERIFICAR = 'verifique as bases de todos os clientes antes (uma página compartilhada com outro cliente ainda não pode ser descartada)'
const textoMotivo = cod => MSG_FALHA[String(cod ?? '').split(':')[0]] || 'Notion indisponível agora — tente de novo'
// paraCsv (rotas-promocoes.js): UTF-8 com BOM, ";", neutraliza fórmula (= + - @) em texto
export function paraCsv(linhas, colunas) {
  const cel = v => {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : ''
    let x = String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')
    if (/^[=+\-@\t\r]/.test(x)) x = "'" + x
    return `"${x}"`
  }
  return '﻿' + [colunas.map(cel).join(';'), ...linhas.map(l => colunas.map(c => cel(l[c])).join(';'))].join('\r\n')
}
// sync_estado (chave/valor) sobre o handle injetado — o mesmo que getEstado/setEstado de db.js
export function estadoDeHandle(handle) {
  handle.exec('CREATE TABLE IF NOT EXISTS sync_estado (chave TEXT PRIMARY KEY, valor TEXT)')
  const g = handle.prepare('SELECT valor FROM sync_estado WHERE chave = ?')
  const s = handle.prepare('INSERT INTO sync_estado (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor')
  const l = handle.prepare("SELECT chave, valor FROM sync_estado WHERE chave LIKE ? ESCAPE '\\'")
  return { get: k => g.get(k)?.valor, set: (k, v) => { s.run(k, v) }, listar: p => l.all(String(p).replace(/[\\%_]/g, '\\$&') + '%') }
}
// log sem eco: Notion = só o status; o resto perde tudo a partir da primeira aspa (eco de dado) e é cortado
// erro de rede/timeout do fetch (sem .status): para o usuário é "Notion indisponível", não "falha interna"
const ehRede = e => ['TimeoutError', 'AbortError'].includes(e?.name) || (e instanceof TypeError && /fetch|network|socket/i.test(String(e.message)))
const codigoLog = e => e?.status !== undefined && e?.status !== null ? `notion_${e.status}` : `${e?.name || 'Error'}: ${String(e?.message ?? '').replace(/["'`][\s\S]*$/, '…').slice(0, 100)}`
// 401 (e token ausente) é problema de credencial, não do cliente: mensagem fixa, nunca retentável (a classificação base está em relatorio-notion.js)
const classificar = e => { const c = classificarErro(e); return e?.status === 401 ? { ...c, codigo: 'notion_401', mensagem: MSG_FALHA.notion_401, retentavel: false, ambiguo: false } : c }
const ehCredencial = motivo => ['notion_401', 'notion_0'].includes(String(motivo ?? ''))
// queda do serviço (5xx, rede, timeout, 429): não é culpa do cliente — não conta para a pausa por cliente
const ehInfra = motivo => /^(notion_(5\d\d|429|rede)|timeout)$/.test(String(motivo ?? ''))
const codTipo = motivo => String(motivo ?? 'erro').split(':')[0].replace(/[^a-z0-9_]/gi, '_').slice(0, 22)   // tipo do aviso ≤ 40 caracteres (notificar corta em 40 e o dedupe compara o tipo inteiro)
const DISJUNTOR = 3        // falhas retentáveis SEGUIDAS no mesmo tick/lote que interrompem o resto

// deps: handle (better-sqlite3), notion { req }, brief { gerar(cliente, { hoje, agora }) → Brief }, destinos { fontes, resolverPaginaCliente, acharInformacoesDb, invalidar },
//       nomesInternos(cliente) → string[] (sync/async), agora() ISO, hoje?() AAAA-MM-DD e hora?() HH:MM (padrão: dia e hora de agora() em cfg.fuso, via Intl — nunca o fuso do processo),
//       validarPor(nome) → nome|'', notificar(obj), log(nivel, msg), elegiveis() → [{ cliente, status }] (SÓ status explícito em cfg.status_elegiveis recebe relatório; nome puro ou status
//       vazio/ausente NÃO é elegível), clienteCanonico?(nome) → nome|'', cfg (config/relatorio-envio.json), estado? (padrão: sync_estado do handle)
export function criarRelatorioEnvio({ handle, notion, brief, destinos, nomesInternos = () => [], agora = () => new Date().toISOString(), hoje, hora,
  validarPor = () => '', notificar = () => {}, log = () => {}, elegiveis = () => [], clienteCanonico, cfg = lerConfig(), estado, usuarios = () => [], mapeamento,
  pdf = {} }) {                                                   // pdf: { html, gerar, anexar, dir } — o teste injeta stubs do Chrome e do upload
  handle.exec(SCHEMA_RELATORIO)
  if (!handle.prepare('PRAGMA table_info(relatorio_envio)').all().some(c => c.name === 'anexo')) handle.exec("ALTER TABLE relatorio_envio ADD COLUMN anexo TEXT NOT NULL DEFAULT ''")   // migração aditiva
  const PDF = { html: briefParaHtml, gerar: gerarPdf, anexar: anexarPdf, ...pdf }
  const AX = cfg.anexo_pdf || ANEXO_PADRAO
  estado = estado || estadoDeHandle(handle)
  const fuso = cfg.fuso || FUSO_PADRAO
  hoje = hoje || (() => dataNoFuso(Date.parse(agora()), fuso))
  hora = hora || (() => horaNoFuso(Date.parse(agora()), fuso))
  const nt = criarRelatorioNotion({ notion, estado, fontes: destinos.fontes, resolverPaginaCliente: destinos.resolverPaginaCliente, acharInformacoesDb: destinos.acharInformacoesDb, invalidar: destinos.invalidar, agora })
  const FT = cfg.fallback_tarefa || FALLBACK_PADRAO
  const tf = criarRelatorioTarefa({ notion, fontes: destinos.fontes, agora, ...(mapeamento ? { mapeamento } : {}) })
  const AVISO_TAREFA = { opcao_ausente_status: `A base Informações não tem a aba «${CATEGORIA}» nem «Relatórios»: o relatório vai como tarefa no quadro Tarefas, Canal ${FT.canal}, responsável ${FT.responsavel}.`,
    sem_base: `Este cliente não tem a base Informações: o relatório vai como tarefa no quadro Tarefas, Canal ${FT.canal}, responsável ${FT.responsavel}.`,
    sem_pagina: `A página do cliente não foi localizada: o relatório vai como tarefa no quadro Tarefas, Canal ${FT.canal}, responsável ${FT.responsavel}.` }
  // PLANO B: quadro do cliente localizável? (null = não; 5xx/rede sobem como no destino)
  const quadroFallback = async (cliente, motivo) => (FT.ligado && MOTIVOS_FALLBACK.has(motivo)) ? tf.quadroDe(cliente) : null
  const agoraMs = () => Date.parse(agora())
  const avisar = obj => { try { notificar(obj) } catch (e) { try { log('aviso', `relatórios: o aviso «${String(obj?.tipo ?? '').slice(0, 40)}» não foi gravado (${codigoLog(e)})`) } catch { /* aviso é melhor esforço */ } } }

  const selProg = handle.prepare('SELECT * FROM relatorio_programacao WHERE cliente = ?')
  const todasProg = handle.prepare('SELECT * FROM relatorio_programacao')
  const gravarProg = handle.prepare(`INSERT INTO relatorio_programacao (cliente, frequencia, proximo_envio, ancora_dia, ativado_por, ativado_em, tentar_apos, falhas_seguidas, pausado_motivo, atualizado_em)
    VALUES (@cliente, @frequencia, @proximo_envio, @ancora_dia, @ativado_por, @ativado_em, @tentar_apos, @falhas_seguidas, @pausado_motivo, @atualizado_em)
    ON CONFLICT(cliente) DO UPDATE SET frequencia=excluded.frequencia, proximo_envio=excluded.proximo_envio, ancora_dia=excluded.ancora_dia, ativado_por=excluded.ativado_por,
      ativado_em=excluded.ativado_em, tentar_apos=excluded.tentar_apos, falhas_seguidas=excluded.falhas_seguidas, pausado_motivo=excluded.pausado_motivo, atualizado_em=excluded.atualizado_em`)
  const PROG_VAZIA = { frequencia: 'desligado', proximo_envio: '', ancora_dia: 0, ativado_por: '', ativado_em: '', tentar_apos: '', falhas_seguidas: 0, pausado_motivo: '' }
  const salvarProg = (cliente, campos) => { const atual = selProg.get(cliente) || PROG_VAZIA; const novo = { ...PROG_VAZIA, ...atual, ...campos, cliente, atualizado_em: agora() }; gravarProg.run(novo); return novo }
  const selVivo = handle.prepare("SELECT * FROM relatorio_envio WHERE cliente = ? AND de = ? AND ate = ? AND estado IN ('enviado','adotado') ORDER BY id DESC LIMIT 1")
  const jaTeve = handle.prepare("SELECT 1 FROM relatorio_envio WHERE cliente = ? AND estado IN ('enviado','adotado','arquivado') LIMIT 1")
  const insEnvio = handle.prepare(`INSERT INTO relatorio_envio (cliente, de, ate, origem, estado, motivo, page_id, page_url, categoria, hash, por, em, ms, incerto)
    VALUES (@cliente, @de, @ate, @origem, @estado, @motivo, @page_id, @page_url, @categoria, @hash, @por, @em, @ms, @incerto)`)
  const arquivarVivos = handle.prepare("UPDATE relatorio_envio SET estado = 'arquivado' WHERE cliente = ? AND de = ? AND ate = ? AND estado IN ('enviado','adotado')")
  const histCliente = handle.prepare('SELECT id, de, ate, origem, estado, motivo, page_url, categoria, por, em, anexo FROM relatorio_envio WHERE cliente = ? ORDER BY id DESC LIMIT 20')
  const gravarAnexo = handle.prepare("UPDATE relatorio_envio SET anexo = ? WHERE cliente = ? AND de = ? AND ate = ? AND estado IN ('enviado','adotado')")
  const semAnexoDesde = handle.prepare("SELECT cliente, de, ate, page_id, page_url, anexo, em FROM relatorio_envio WHERE estado IN ('enviado','adotado') AND anexo <> 'ok' AND page_id <> '' AND em >= ? ORDER BY id")
  const ultimosVivos = handle.prepare("SELECT e.* FROM relatorio_envio e JOIN (SELECT cliente, MAX(id) id FROM relatorio_envio WHERE estado IN ('enviado','adotado') GROUP BY cliente) m ON e.id = m.id")
  const ultimasDoCliente = handle.prepare('SELECT estado, motivo FROM relatorio_envio WHERE cliente = ? ORDER BY id DESC LIMIT 8')
  const ultimosTodos = handle.prepare('SELECT e.* FROM relatorio_envio e JOIN (SELECT cliente, MAX(id) id FROM relatorio_envio GROUP BY cliente) m ON e.id = m.id')
  const registrar = handle.transaction(({ substituindo, linha }) => { if (substituindo) arquivarVivos.run(linha.cliente, linha.de, linha.ate); insEnvio.run(linha) })
  const linhaLog = o => ({ page_id: '', page_url: '', categoria: '', hash: '', ms: 0, incerto: 0, motivo: '', ...o, em: agora() })

  // ── clientes ────────────────────────────────────────────────────────────────────────────────────────────────
  // FALHA FECHADA: só quem tem status EXPLÍCITO em cfg.status_elegiveis (hoje «Ativo») recebe relatório. Status vazio, ausente, null ou nome sem status = fora.
  function mapaElegiveis() {
    const st = new Set(cfg.status_elegiveis.map(s => normNome(s).trim())), m = new Map()
    for (const x of elegiveis() || []) {
      if (!x || typeof x !== 'object') continue
      const nome = x.cliente
      if (typeof nome !== 'string' || !nome.trim() || ehProspecto(nome)) continue
      if (typeof x.status !== 'string' || !st.has(normNome(x.status).trim())) continue
      m.set(normNome(nome).trim(), nome)
    }
    return m
  }
  const chaveNome = nome => normNome(nome).trim()
  const bloqueioInelegivel = () => ({ ok: false, estado: 'cliente_inelegivel', motivo: 'cliente_inelegivel', mensagem: MSG_FALHA.cliente_inelegivel, retentavel: false })
  // a programação pode estar gravada com outra grafia do nome (a central renomeou): acha pela chave normalizada
  const progDe = cliente => selProg.get(cliente) || todasProg.all().find(p => chaveNome(p.cliente) === chaveNome(cliente)) || null
  const canon = nome => {
    const s = str(nome)
    if (!s || ehProspecto(s) || s.length > 200) return ''
    if (clienteCanonico) return clienteCanonico(s) || ''
    return mapaElegiveis().get(normNome(s).trim()) || todasProg.all().find(p => normNome(p.cliente).trim() === normNome(s).trim())?.cliente || ''
  }
  const exigirCliente = bruto => {
    if (!str(bruto)) throw erro('informe "cliente"')
    const c = canon(bruto); if (!c) throw erro('cliente não encontrado na central', 404)
    return c
  }
  const exigirPor = bruto => {
    if (!str(bruto)) throw erro('informe "por" (quem está enviando — líder ou consultor)')
    const p = validarPor(str(bruto)); if (!p) throw erro('somente líder ou consultor da central envia relatório ao cliente', 403)
    return String(p).slice(0, 80)
  }
  const listaClientes = (v, max) => {
    if (!Array.isArray(v) || !v.length) throw erro(`informe "clientes" (1 a ${max})`)
    if (v.length > max) throw erro(`máximo de ${max} clientes por vez`)
    const vistos = new Set(), ok = [], ignorados = []
    for (const x of v) {
      const c = typeof x === 'string' ? canon(x) : ''
      if (!c) { ignorados.push({ cliente: '', motivo: 'cliente não encontrado na central' }); continue }
      if (vistos.has(c)) continue
      vistos.add(c); ok.push(c)
    }
    return { ok, ignorados }
  }

  // ── diagnóstico em cache (sync_estado rel_diag:{cliente}) ─────────────────────────────────────────────────────
  const lerDiag = cliente => { try { const j = estado.get(`rel_diag:${cliente}`); return j ? JSON.parse(j) : null } catch { return null } }
  const diagsTodos = () => { const m = new Map(); for (const r of (estado.listar ? estado.listar('rel_diag:') : [])) { try { m.set(r.chave.slice('rel_diag:'.length), JSON.parse(r.valor)) } catch { /* diag corrompido = não verificado */ } } return m }
  const diagFresco = d => !!d && agoraMs() - Date.parse(d.em) < 24 * 3600_000
  // Quem divide a MESMA página do Notion só é descoberto pelo cache `pagina_cliente:` dos demais clientes (relatorio-notion.compartilhadoCom). Cache vazio = DESCONHECIDO:
  // enquanto a verificação das bases (diagnosticar) não o preencher, o automático não pode descartar uma página compartilhada. «Sem página» confirmado pela verificação também é conhecido.
  function paginasDesconhecidas(elig = mapaElegiveis()) {
    if (!estado.listar) return new Set()
    const cache = new Map(estado.listar('pagina_cliente:').map(r => [r.chave.slice('pagina_cliente:'.length), r.valor])), diags = diagsTodos()
    return new Set([...elig.values()].filter(cli => !RX_ID.test(String(cache.get(cli) || '')) && !['sem_pagina', 'pagina_invalida'].includes(diags.get(cli)?.destino)))
  }

  // ── programação/listagem ─────────────────────────────────────────────────────────────────────────────────────
  function situacaoDe(p, vivo, ultimo, hojeIso) {
    if (!p || p.frequencia === 'desligado') return 'desligado'
    if (p.pausado_motivo) return 'pausado'
    if (!p.ativado_por) return 'nao_liberado'
    if (vivo && vivo.ate === janelaNominal(hojeIso).ate) return 'enviado'
    if (ultimo?.estado === 'falhou' || p.falhas_seguidas > 0) return 'falhou'
    if (p.proximo_envio && p.proximo_envio < hojeIso) return 'atrasado'
    return 'agendado'
  }
  function itemDe(cliente, c) {
    const p = c.progs.get(cliente) || null, vivo = c.vivos.get(cliente) || null, ultimo = c.ultimos.get(cliente) || null, diag = c.diags.get(cliente) || null
    const situacao = situacaoDe(p, vivo, ultimo, c.hoje)
    const motivo = situacao === 'pausado' ? textoMotivo(p.pausado_motivo) : situacao === 'falhou' ? textoMotivo(ultimo?.motivo || '') : situacao === 'nao_liberado' ? 'Aguardando a liberação de um líder para o envio automático'
      : diag?.categoria === CAT_TAREFA ? `Destino: ${rotuloTarefa(cfg)} no quadro Tarefas` : ''   // plano B: o texto da situação diz que o relatório vai como tarefa
    return {
      cliente, frequencia: p?.frequencia || 'desligado', frequencia_rotulo: ROTULO_FREQ[p?.frequencia || 'desligado'], proximo_envio: p?.proximo_envio || '',
      ultimo_envio_em: vivo?.em || '', ultimo_url: vivo?.page_url || '', ultimo_estado: ultimo?.estado || '',
      situacao, situacao_rotulo: SITUACAO_ROTULO[situacao], motivo, liberado: !!p?.ativado_por, pronto: !!diag?.pronto,
    }
  }
  function contexto() {
    return { progs: new Map(todasProg.all().map(p => [p.cliente, p])), vivos: new Map(ultimosVivos.all().map(r => [r.cliente, r])),
      ultimos: new Map(ultimosTodos.all().map(r => [r.cliente, r])), diags: diagsTodos(), hoje: hoje() }
  }
  const comDatas = (item, c) => ({ ...item, datas_previstas: datasPrevistas(c.progs.get(item.cliente), 3) })
  const infoAgendador = () => ({ ligado: agendadorEstado().ligado })

  function listar() {
    const c = contexto(), nomes = new Map(mapaElegiveis())
    for (const cli of c.progs.keys()) if (!ehProspecto(cli)) nomes.set(normNome(cli).trim(), cli)
    const itens = [...nomes.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(cli => itemDe(cli, c))
    const dest = d => d?.destino
    const resumo = {
      total: itens.length, prontos: itens.filter(i => i.pronto).length, liberados: itens.filter(i => i.liberado && i.frequencia !== 'desligado').length,
      pausados: itens.filter(i => i.situacao === 'pausado').length,
      sem_categoria: itens.filter(i => c.diags.get(i.cliente)?.categoria === 'opcao_ausente_status').length,
      sem_base: itens.filter(i => ['sem_base', 'base_invalida'].includes(dest(c.diags.get(i.cliente)))).length,
      nao_verificados: itens.filter(i => !c.diags.get(i.cliente)).length,
    }
    return { itens, resumo, agendador: infoAgendador(), frequencias: FREQUENCIAS }
  }
  function clienteDe(bruto) {
    const cliente = exigirCliente(bruto), c = contexto()
    return { programacao: comDatas(itemDe(cliente, c), c), historico: histCliente.all(cliente).map(({ page_url, ...r }) => ({ ...r, url: page_url })), diag: c.diags.get(cliente) || null }
  }

  // ── brief e plano de envio (tudo leitura) ─────────────────────────────────────────────────────────────────────────
  async function gerarBrief(cliente) {
    let B
    try { B = await brief.gerar(cliente, { hoje: hoje(), agora: agora() }) } catch (e) {
      if (e?.name === 'BriefInseguro') {                              // o auditor do brief barrou texto interno: bloqueio de conteúdo (não adianta tentar de novo). Só as regras no log, nunca o texto.
        log('aviso', `relatório ${cliente}: brief inseguro (${[...new Set((e.violacoes || []).map(v => String(v?.regra ?? '').slice(0, 30)))].join(',')})`)
        throw Object.assign(new Error('brief'), { codigo: 'brief_inseguro' })
      }
      log('erro', `relatório ${cliente}: erro_brief ${codigoLog(e)}`); throw Object.assign(new Error('brief'), { codigo: 'erro_brief' })
    }
    if (!B || typeof B !== 'object' || typeof B.titulo !== 'string' || !dataValida(B.janela?.de) || !dataValida(B.janela?.ate) || (B.cliente && B.cliente !== cliente))
      throw Object.assign(new Error('brief inválido'), { codigo: 'erro_brief' })
    return B
  }
  const bloqueio = (estadoB, motivo, extra = {}) => ({ estado: estadoB, motivo, mensagem: textoMotivo(motivo), retentavel: false, ...extra })

  // o plano diz o que SERIA feito agora: usado pela prévia e, de novo, no confirmar (destino e Notion são relidos; o brief é o mesmo da prévia)
  async function montarPlano(cliente, B, o) {
    const avisos = [], P = { cliente, B, de: B.janela.de, ate: B.janela.ate, titulo: B.titulo, blocos: [], violacoes: [], destino: null, cat: null, st: { propriedades: {}, aviso: '' },
      achadas: [], vivo: null, acao: 'bloqueado', bloqueio: null, avisos, primeiro: false, substituir: false }
    P.vivo = selVivo.get(cliente, P.de, P.ate) || null
    P.primeiro = !jaTeve.get(cliente)
    const manual = o.origem === 'manual', subst = manual && o.substituir === true
    if (P.vivo && !subst) { P.acao = 'pular'; if (o.cedo) return P }
    // qualidade ANTES de vazio: "vazio" porque o Mercado Livre não respondeu não é semana sem nada a dizer (o automático não pode avançar a agenda e perder a semana em silêncio)
    if (B.qualidade?.ok === false) {
      if (manual) avisos.push('O Mercado Livre não respondeu na geração deste relatório: os números podem estar incompletos. Confirme só se aceitar enviar assim.')
      else if (!P.bloqueio) { P.bloqueio = bloqueio('falhou', 'qualidade', { retentavel: true }); if (o.cedo) return P }
    }
    if (B.modo === 'vazio' && !P.bloqueio) { P.bloqueio = bloqueio('vazio', 'vazio'); if (o.cedo) return P }
    // conteúdo: título + corpo passam pelo auditor antes de qualquer escrita
    P.blocos = briefParaBlocos(B)
    const nomes = (await nomesInternos(cliente)) || []
    const viol = [...auditarTexto(B.titulo, { nomesInternos: nomes, permitidos: [cliente] }), ...auditarBlocos(P.blocos, { nomesInternos: nomes, permitidos: [cliente] })]
    if (!tituloOk(B.titulo)) viol.push({ codigo: 'titulo', bloco: '', trecho: '' })
    P.violacoes = viol
    if (viol.length && !P.bloqueio) { P.bloqueio = bloqueio('bloqueado', 'conteudo', { codigos: codigosDe(viol) }); if (o.cedo) return P }
    // destino (só leitura) e categoria
    P.destino = await nt.destinoDe(cliente, { forcar: o.forcar === true })
    const d = P.destino
    if (!['ok', 'destino_compartilhado'].includes(d.estado)) {
      if (!P.bloqueio && await planoTarefa(P, o, d.estado, nomes)) return P
      if (!P.bloqueio) P.bloqueio = bloqueio(d.estado, d.estado); return P
    }
    P.compartilhado = d.estado === 'destino_compartilhado'
    P.titulo = tituloFinal(B.titulo, { cliente, compartilhado: P.compartilhado })
    P.cat = decidirCategoria(d.esquema, { semCategoria: manual && o.sem_categoria === true })
    P.st = decidirStatus(d.esquema)
    if (P.cat.aviso) avisos.push(P.cat.aviso)
    if (P.st.aviso) avisos.push(P.st.aviso)
    if (P.compartilhado) avisos.push(`${MSG_DESTINO.destino_compartilhado.replace(' — o envio automático fica bloqueado', '')}: o título leva o nome do cliente ao final.`)
    if (!P.bloqueio) {
      if (P.compartilhado && !(manual && o.confirmar_destino === true)) P.bloqueio = bloqueio('destino_compartilhado', 'destino_compartilhado')
      else if (P.cat.bloqueia) { if (await planoTarefa(P, o, 'opcao_ausente_status', nomes)) return P; P.bloqueio = bloqueio('opcao_ausente_status', 'opcao_ausente_status') }
      else if (P.cat.estado === 'sem_propriedade' && !manual) P.bloqueio = bloqueio('sem_propriedade', 'sem_propriedade')
      else if (P.primeiro && o.origem === 'lote') P.bloqueio = bloqueio('precisa_previa', 'precisa_previa')
    }
    if (P.bloqueio) return P
    if (P.acao === 'pular') return P
    P.achadas = await nt.acharPorTitulo(d, P.titulo)
    P.substituir = subst && (!!P.vivo || P.achadas.length > 0)
    P.acao = P.substituir ? 'substituir' : P.achadas.length ? 'adotar' : 'criar'
    return P
  }
  // PLANO B: a Informações não aceita (motivo em MOTIVOS_FALLBACK) e o quadro «Tarefas - {Cliente}» existe → o MESMO relatório vira tarefa (Canal Geral, Demanda Relatório, Pamela).
  // Devolve false quando o plano B não se aplica (fallback desligado, motivo fora da lista ou quadro ausente): vale o bloqueio antigo. Reenvio do período = pular; título já no quadro = adotar.
  async function planoTarefa(P, o, motivo, nomes) {
    const q = await quadroFallback(P.cliente, motivo)
    if (!q) return false
    for (const a of [P.cat?.aviso, P.st?.aviso]) { const i = a ? P.avisos.indexOf(a) : -1; if (i >= 0) P.avisos.splice(i, 1) }   // «crie a opção e envie de novo» não vale mais
    P.destino_tipo = 'tarefa'; P.quadro = q; P.fallback_motivo = motivo; P.cat = null; P.st = { propriedades: {}, aviso: '' }
    P.tarefa = montarTarefa({ brief: P.B, quadro: q, cfg: FT, usuarios: usuarios() || [], hoje: hoje(), nomesInternos: nomes, cliente: P.cliente })
    P.titulo = P.tarefa.titulo
    P.avisos.push(AVISO_TAREFA[motivo] || AVISO_TAREFA.opcao_ausente_status, ...P.tarefa.avisos)
    if (P.tarefa.violacoes.length) { P.violacoes = [...P.violacoes, ...P.tarefa.violacoes]; P.bloqueio = bloqueio('bloqueado', 'conteudo', { codigos: codigosDe(P.violacoes) }); return true }
    if (P.vivo) { P.acao = 'pular'; return true }                 // substituir não vale para tarefa: nunca arquiva card do quadro
    P.achadas = await tf.acharPorTitulo(q, P.titulo)
    P.acao = P.achadas.length ? 'adotar' : 'criar_tarefa'
    return true
  }
  const linhaDaFalha = (P, o, estadoLog, motivo, extra = {}) => linhaLog({ cliente: P.cliente, de: P.de, ate: P.ate, origem: o.origem, estado: estadoLog, motivo, por: o.por, hash: P.blocos.length ? sha(JSON.stringify(P.blocos)) : '', ...extra })

  // avança a programação depois de um envio/adoção/"já enviado" (nunca cria programação; desligado fica desligado)
  // usa a CHAVE da programação (não o nome canônico de agora): se a central renomeou o cliente, a linha antiga avança do mesmo jeito e não reenvia todo dia útil
  function avancarProgramacao(cliente) {
    const p = progDe(cliente)
    if (!p || p.frequencia === 'desligado' || !p.proximo_envio) return p?.proximo_envio || ''
    const novo = aposEnvio(p, hoje(), cfg.intervalo_minimo_dias)
    salvarProg(p.cliente, { proximo_envio: novo, falhas_seguidas: 0, tentar_apos: '' })
    return novo
  }

  // executa o plano JÁ aprovado (confirmar). Devolve sempre um objeto; erros esperados viram {ok:false, estado, motivo, mensagem, retentavel}
  async function executar(P, o) {
    const t0 = Date.now(), ms = () => Date.now() - t0
    const falha = (estadoLog, motivo, { retentavel = false, incerto = 0 } = {}) => {
      insEnvio.run(linhaDaFalha(P, o, estadoLog, motivo, { ms: ms(), incerto }))
      return { ok: false, estado: estadoLog === 'bloqueado' ? 'bloqueado' : 'falhou', motivo, mensagem: textoMotivo(motivo.split(':')[0]), retentavel, incerto: !!incerto }
    }
    if (P.acao === 'pular') {
      const proximo = avancarProgramacao(P.cliente)
      return { ok: true, previa: false, estado: 'ja_enviado', url: P.vivo.page_url, categoria: P.vivo.categoria, proximo_envio: proximo }
    }
    if (P.bloqueio) {
      const b = P.bloqueio
      if (b.estado === 'vazio') { insEnvio.run(linhaDaFalha(P, o, 'bloqueado', 'vazio', { ms: ms() })); return { ok: false, estado: 'vazio', motivo: 'vazio', mensagem: b.mensagem, retentavel: false } }
      const motivo = b.motivo === 'conteudo' ? `conteudo:${b.codigos.join(',')}` : b.motivo
      log('aviso', `relatório ${P.cliente}: bloqueado ${motivo}`)
      insEnvio.run(linhaDaFalha(P, o, b.estado === 'falhou' ? 'falhou' : 'bloqueado', motivo, { ms: ms() }))
      return { ok: false, estado: b.estado, motivo: b.motivo, mensagem: b.mensagem, retentavel: b.retentavel, ...(b.codigos ? { violacoes: P.violacoes.map(({ codigo, bloco }) => ({ codigo, bloco })) } : {}) }
    }
    const tarefa = P.destino_tipo === 'tarefa'
    const hash = sha(JSON.stringify(P.blocos)), categoria = tarefa ? CAT_TAREFA : CATEGORIA_LOG[P.cat.estado] || ''
    const acharTitulo = titulo => tarefa ? tf.acharPorTitulo(P.quadro, titulo) : nt.acharPorTitulo(P.destino, titulo)
    const registrarOk = (estadoLog, pg, extra = {}) => {
      registrar({ substituindo: !!extra.substituindo, linha: linhaLog({ cliente: P.cliente, de: P.de, ate: P.ate, origem: o.origem, estado: estadoLog, page_id: pg.id, page_url: pg.url,
        categoria: estadoLog === 'adotado' && !tarefa ? '' : categoria, hash, por: o.por, ms: ms(), incerto: extra.incerto ? 1 : 0 }) })
    }
    const arquivarRestantes = async (ids, manter) => {
      const falhas = []
      for (const id of ids) if (id !== manter) { try { await nt.arquivar(id) } catch (e) { falhas.push(id); log('aviso', `relatório ${P.cliente}: arquivar página antiga ${codigoLog(e)}`) } }
      return falhas
    }
    const AVISO_DUPLICATA = 'Há outra página com o mesmo título que não pôde ser arquivada: arquive-a no Notion (o sistema mantém a mais nova).'
    // outra gravação viva do mesmo período já existia (corrida): vale a que está no banco; a página que ESTE envio acabou de criar é duplicata e é arquivada
    const jaEnviadoPorCorrida = async (pg, { criada }) => {
      const vivo = selVivo.get(P.cliente, P.de, P.ate)
      let aviso = ''
      if (criada && vivo && vivo.page_id !== pg.id) { const sobrou = await arquivarRestantes([pg.id], ''); if (sobrou.length) aviso = AVISO_DUPLICATA }
      return { ok: true, previa: false, estado: 'ja_enviado', url: vivo?.page_url || pg.url, categoria: vivo ? vivo.categoria : categoria, proximo_envio: avancarProgramacao(P.cliente), ...(aviso ? { aviso } : {}) }
    }
    if (P.acao === 'adotar') {
      const a = P.achadas[0]
      try { registrarOk('adotado', a) } catch (e) { if (/UNIQUE/i.test(e?.message)) return jaEnviadoPorCorrida(a, { criada: false }); throw e }
      const sobrou = tarefa ? [] : await arquivarRestantes(P.achadas.map(x => x.id), a.id)       // (nunca arquiva card do quadro) auto-cura: duplicatas MAIS ANTIGAS do mesmo título (a mais nova fica); se não arquivar, avisa
      log('info', `relatório ${P.cliente}: adotado (${o.origem})`)
      return comAnexo({ ok: true, previa: false, estado: 'adotado', url: a.url, categoria: tarefa ? CAT_TAREFA : '', proximo_envio: avancarProgramacao(P.cliente), ...(tarefa ? { destino_tipo: 'tarefa' } : {}), ...(sobrou.length ? { aviso: AVISO_DUPLICATA } : {}) }, P, a)
    }
    // criar | substituir: UMA chamada de escrita (propriedades + todos os blocos)
    const antigos = new Set([...P.achadas.map(x => x.id), ...(P.vivo?.page_id ? [P.vivo.page_id] : [])])
    let pg = null, incerto = false, novas = [], avisoTarefa = ''
    try {
      if (tarefa) { pg = await tf.criar({ quadro: P.quadro, tarefa: P.tarefa, blocos: P.blocos }); avisoTarefa = pg.aviso || '' }
      else pg = await nt.criar({ destino: P.destino, titulo: P.titulo, blocos: P.blocos, propriedades: { ...P.cat.propriedades, ...P.st.propriedades } })
    } catch (e) {
      if (e?.codigo === 'titulo_invalido' || e?.codigo === 'destino_invalido') return falha('bloqueado', 'conteudo:titulo')
      const c = classificar(e)
      log('erro', `relatório ${P.cliente}: criar ${c.codigo}`)
      if (!c.ambiguo) return falha('falhou', c.codigo, { retentavel: c.retentavel })
      // resultado ambíguo (5xx/timeout/rede): NÃO reenvia — consulta por título; se a página existe, adota
      try { novas = (await acharTitulo(P.titulo)).filter(x => !antigos.has(x.id)) } catch { /* a consulta também falhou */ }
      if (!novas.length) return falha('falhou', c.codigo, { retentavel: true, incerto: 1 })
      pg = novas[0]; incerto = true
    }
    try { registrarOk(incerto ? 'adotado' : 'enviado', pg, { substituindo: P.acao === 'substituir', incerto }) } catch (e) {
      if (/UNIQUE/i.test(e?.message)) { log('aviso', `relatório ${P.cliente}: outra gravação viva do período já existia`); return jaEnviadoPorCorrida(pg, { criada: true }) }
      throw e
    }
    let avisoArquivar = ''
    if (P.acao === 'substituir') {
      const sobrou = await arquivarRestantes([...antigos], pg.id)
      if (sobrou.length) avisoArquivar = 'A página nova foi criada, mas a anterior não pôde ser arquivada: arquive-a no Notion ou envie de novo (o sistema mantém a mais nova).'
    } else if (novas.length > 1 && !tarefa) {                                  // adoção depois de erro ambíguo: mais de uma página nova com o título → fica a mais nova
      const sobrou = await arquivarRestantes(novas.map(x => x.id), pg.id)
      if (sobrou.length) avisoArquivar = AVISO_DUPLICATA
    }
    log('info', `relatório ${P.cliente}: ${P.acao === 'substituir' ? 'substituído' : incerto ? 'adotado (incerto)' : tarefa ? 'enviado como tarefa' : 'enviado'} (${o.origem}) ${ms()}ms`)
    const aviso = avisoArquivar || avisoTarefa
    return comAnexo({ ok: true, previa: false, estado: P.acao === 'substituir' ? 'substituido' : incerto ? 'adotado' : 'enviado', url: pg.url, categoria, proximo_envio: avancarProgramacao(P.cliente), ...(tarefa ? { destino_tipo: 'tarefa' } : {}), ...(aviso ? { aviso } : {}) }, P, pg)
  }

  // ── documento (PDF) anexado à página: gerado do MESMO brief auditado; qualquer falha vira 'falhou:<codigo>' (aviso), nunca desfaz o envio ──
  async function anexarDocumento({ cliente, de, ate, B, page_id }) {
    let resultado = 'ok'
    try {
      const caminho = caminhoPdf({ cliente, de, ate }, PDF.dir)
      await PDF.gerar(PDF.html(B, { cliente }), caminho, { timeout_ms: AX.timeout_ms })
      await PDF.anexar({ notionReq: (...a) => notion.req(...a), page_id, caminho })
    } catch (e) {
      const codigo = String(e?.codigo || (e?.status !== undefined ? `notion_${e.status}` : ehRede(e) ? 'notion_rede' : 'anexo_falhou')).replace(/[^a-z0-9_]/gi, '_').slice(0, 30)
      resultado = `falhou:${codigo}`
      log('aviso', `relatório ${cliente}: anexo do PDF ${codigo}`)
    }
    try { gravarAnexo.run(resultado, cliente, de, ate) } catch { /* o envio já está registrado */ }
    return resultado
  }
  const comAnexo = async (r, P, pg) => AX.ligado && r.ok && pg?.id ? { ...r, anexo: await anexarDocumento({ cliente: P.cliente, de: P.de, ate: P.ate, B: P.B, page_id: pg.id }) } : r

  // ── envio de um cliente ─────────────────────────────────────────────────────────────────────────────────────
  const previas = new Map(), emVoo = new Set()
  const limparPrevias = () => { const t = agoraMs(); for (const [id, p] of previas) if (p.expira <= t) previas.delete(id) }

  // Antecipar consome a próxima ocorrência (aposEnvio) e a janela é sempre de 7 dias fechados: avisa o próximo envio e os dias que, por antecipar, ficam fora de qualquer relatório.
  // Só conta o que o ANTECIPAR tira (um quinzenal/mensal já tem janelas separadas por desenho); enviar na data ou depois dela não perde nada. Não muda o consumo.
  function coberturaDoEnvio(P) {
    const vazio = { proximo_envio_depois: '', dias_sem_cobertura: [], aviso_cobertura: '' }
    const p = progDe(P.cliente)
    if (!p || p.frequencia === 'desligado' || !dataValida(p.proximo_envio) || !['criar', 'criar_tarefa', 'adotar', 'substituir', 'pular'].includes(P.acao)) return vazio
    const h = hoje(), minimos = cfg.intervalo_minimo_dias
    const depois = aposEnvio(p, h, minimos)
    if (!depois) return vazio
    const sem = (ate, proximo) => { const o = new Set(); for (let d = somarDias(ate, 1); d <= somarDias(proximo, -8); d = somarDias(d, 1)) o.add(d); return o }   // entre `ate` e o `de` (= proximo − 7) do relatório seguinte
    let dias = []
    if (h < p.proximo_envio) {                                      // antecipado: compara com o que aconteceria enviando na data programada
      const naData = aposEnvio(p, p.proximo_envio, minimos), base = naData ? sem(somarDias(p.proximo_envio, -1), naData) : new Set()
      dias = [...sem(P.ate, depois)].filter(d => !base.has(d))
    }
    return { proximo_envio_depois: depois, dias_sem_cobertura: dias, aviso_cobertura: dias.length ? 'Enviar agora antecipa o próximo envio automático: os dias listados não aparecerão em nenhum relatório. Para não perdê-los, espere a data programada.' : '' }
  }

  function respostaPrevia(P, id, expira) {
    const d = P.destino, c = P.cat
    return {
      ok: true, previa: true, previa_id: id, titulo: P.titulo, de: P.de, ate: P.ate, parcial_ate_hora: P.B.resultados?.hoje?.ate_hora || null, modo: P.B.modo || 'completo',
      destino: d ? { estado: d.estado, pagina_titulo: d.pagina_titulo, informacoes_url: d.informacoes_url, ...(d.compartilhado?.length ? { compartilhado_com: d.compartilhado } : {}) } : { estado: 'nao_resolvido', pagina_titulo: '', informacoes_url: '' },
      categoria: c ? { estado: c.estado, tipo: c.tipo, aviso: c.aviso } : { estado: 'nao_resolvida', tipo: null, aviso: '' },
      acao: P.acao, bloqueio: P.bloqueio ? { estado: P.bloqueio.estado, mensagem: P.bloqueio.mensagem } : null,
      destino_tipo: P.destino_tipo || 'informacoes',
      ...(P.destino_tipo === 'tarefa' ? { tarefa: { quadro_url: P.quadro?.url || '', canal: P.tarefa?.canal || '', demanda: P.tarefa?.demanda || '', responsavel: P.tarefa?.responsavel || '', descricao: P.tarefa?.descricao || '', motivo: P.fallback_motivo } } : {}),
      ja_enviado: P.vivo ? { em: P.vivo.em, por: P.vivo.por, url: P.vivo.page_url } : null, primeiro_envio: P.primeiro,
      violacoes: P.violacoes.map(({ codigo, bloco, trecho }) => ({ codigo, bloco, trecho })), avisos: P.avisos, linhas: linhasDeTexto(P.blocos), expira_em: new Date(expira).toISOString(),
      ...coberturaDoEnvio(P),
    }
  }

  async function enviar(bruto, opts = {}) {
    const cliente = exigirCliente(bruto)
    if (!mapaElegiveis().has(chaveNome(cliente))) return bloqueioInelegivel()      // Congelado, em desligamento, sem status…: nem prévia nem envio
    const origem = ['lote', 'agendado'].includes(opts.origem) ? opts.origem : 'manual'
    const o = { origem, substituir: opts.substituir === true, sem_categoria: opts.sem_categoria === true, confirmar_destino: opts.confirmar_destino === true }
    if (opts.confirmar !== true) {                                  // PRÉVIA: leitura pura (nada no banco, nada no Notion); mesmo limite de tempo do envio
      const montar = async () => {
        let B; try { B = await gerarBrief(cliente) } catch (e) { throw e.codigo === 'brief_inseguro' ? erro(textoMotivo('conteudo'), 422) : erro(textoMotivo('erro_brief'), 502) }
        let P; try { P = await montarPlano(cliente, B, { ...o, origem: 'manual' }) } catch (e) { if (e?.status === undefined && !ehRede(e)) throw e; const c = classificar(e); log('erro', `relatório ${cliente}: prévia ${c.codigo}`); throw erro(c.mensagem, 502) }
        return { B, P }
      }
      let timer
      const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(erro('a prévia demorou mais que o limite — tente de novo em instantes', 504)), cfg.timeout_cliente_s * 1000) })
      let r; try { r = await Promise.race([montar(), limite]) } finally { clearTimeout(timer) }
      const { B, P } = r
      limparPrevias()
      for (const [id, p] of previas) if (p.cliente === cliente) previas.delete(id)
      const id = `pv-${randomBytes(8).toString('hex')}`, expira = agoraMs() + cfg.previa_ttl_min * 60_000
      previas.set(id, { cliente, B, expira })
      return respostaPrevia(P, id, expira)
    }
    // CONFIRMAR
    let por, B
    if (origem === 'manual') {
      por = exigirPor(opts.por)
      if (!str(opts.previa_id)) throw erro('informe "previa_id" (gere a prévia antes de confirmar)')
      limparPrevias()
      const pv = previas.get(opts.previa_id)
      if (!pv || pv.cliente !== cliente) throw erro('prévia expirada — gere de novo', 409)
      if (pv.B.hoje && pv.B.hoje !== hoje()) throw erro('o dia mudou desde a prévia — gere de novo', 409)
      B = pv.B
    } else por = str(opts.por) || 'sistema'
    if (emVoo.has(cliente)) throw erro('já existe um envio deste cliente em andamento', 409)
    emVoo.add(cliente)
    const t0 = Date.now()
    const trabalho = (async () => {
      try {
        if (!B) B = await gerarBrief(cliente)
        const P = await montarPlano(cliente, B, { ...o, cedo: true })
        // freio de emergência (só o tick pede): o agendador desligado enquanto este envio montava o brief/lia o Notion não escreve nada
        if (opts.checarFreio === true && !agendadorEstado().ligado) return { ok: false, estado: 'pulado', motivo: 'freio', mensagem: 'o agendador foi desligado; nada foi enviado', retentavel: false }
        const r = await executar(P, { ...o, por })
        if (r.ok && origem === 'manual' && opts.previa_id) previas.delete(opts.previa_id)
        return r
      } catch (e) {
        const inseguro = e?.codigo === 'brief_inseguro'
        const motivo = inseguro ? 'conteudo:brief' : e?.codigo === 'erro_brief' ? 'erro_brief' : e?.status !== undefined || ehRede(e) ? classificar(e).codigo : 'erro_interno'
        const c = !inseguro && (e?.status !== undefined || ehRede(e)) ? classificar(e) : null
        if (!inseguro && e?.codigo !== 'erro_brief') log('erro', `relatório ${cliente}: ${motivo} ${codigoLog(e)}`.trim())
        try { insEnvio.run(linhaLog({ cliente, de: B?.janela?.de || '', ate: B?.janela?.ate || '', origem, estado: inseguro ? 'bloqueado' : 'falhou', motivo, por, ms: Date.now() - t0 })) } catch { /* sem registro */ }
        if (inseguro) return { ok: false, estado: 'bloqueado', motivo: 'conteudo', mensagem: textoMotivo('conteudo'), retentavel: false }
        return { ok: false, estado: 'falhou', motivo, mensagem: c ? c.mensagem : textoMotivo(motivo), retentavel: c ? c.retentavel : true }
      } finally { emVoo.delete(cliente) }       // só libera quando o trabalho de fato termina (mesmo órfão depois do timeout): evita escrita dupla
    })()
    let timer
    const limite = new Promise(res => { timer = setTimeout(() => res('__timeout__'), cfg.timeout_cliente_s * 1000) })
    try {
      const r = await Promise.race([trabalho, limite])
      if (r !== '__timeout__') return r
      trabalho.catch(() => {})                                      // o trabalho segue órfão; o resultado dele é descartado aqui (se criou a página, a próxima consulta por título adota)
      const Bx = B
      try { insEnvio.run(linhaLog({ cliente, de: Bx?.janela?.de || '', ate: Bx?.janela?.ate || '', origem, estado: 'falhou', motivo: 'timeout', por, ms: Date.now() - t0, incerto: 1 })) } catch { /* sem registro */ }
      log('erro', `relatório ${cliente}: timeout`)
      return { ok: false, estado: 'falhou', motivo: 'timeout', mensagem: textoMotivo('timeout'), retentavel: true, incerto: true }
    } finally { clearTimeout(timer) }
  }

  // ── jobs (runner próprio; mutex compartilhado entre lote e tick) ──────────────────────────────────────────────
  const jobs = new Map()
  let rodando = false, diagRodando = false
  function novoJob(tipo, total) {
    const job = { id: `rj-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, tipo, estado: 'rodando', total, feitos: 0, itens: [], resumo: '', inicio: agora(), fim: '' }
    jobs.set(job.id, job)
    for (const k of [...jobs.keys()].slice(0, -20)) jobs.delete(k)
    return job
  }
  const jobDe = id => { const j = jobs.get(String(id)); return j ? { id: j.id, tipo: j.tipo, estado: j.estado, total: j.total, feitos: j.feitos, itens: j.itens.slice(), resumo: j.resumo } : null }

  function triagemLote(cliente, elig) {
    if (!elig.has(chaveNome(cliente))) return { acao: 'bloqueado', motivo: MSG_FALHA.cliente_inelegivel }
    const j = janelaNominal(hoje())
    if (selVivo.get(cliente, j.de, j.ate)) return { acao: 'ja_enviado_hoje', motivo: 'já existe o relatório deste período' }
    if (!jaTeve.get(cliente)) return { acao: 'precisa_previa', motivo: textoMotivo('precisa_previa') }
    const d = lerDiag(cliente)
    if (diagFresco(d) && !d.pronto) return { acao: 'bloqueado', motivo: d.proxima_acao || 'o destino não está pronto' }
    return { acao: 'enviar', motivo: diagFresco(d) ? '' : 'o destino será conferido no envio' }
  }
  const resumoDoLote = itens => {
    const c = k => itens.filter(i => k.includes(i.estado)).length
    const partes = [[c(['enviado', 'adotado', 'substituido']), 'enviados'], [c(['ja_enviado', 'ja_enviado_hoje']), 'já enviados'], [c(['falhou', 'bloqueado', 'vazio', 'precisa_previa', 'ignorado', 'sem_base', 'sem_pagina', 'pagina_invalida', 'base_invalida', 'opcao_ausente_status', 'destino_compartilhado', 'sem_titulo', 'sem_permissao', 'sem_propriedade', 'interrompido', 'em_andamento']), 'com problema']]
    return partes.filter(([k]) => k).map(([k, t]) => `${k} ${t}`).join(' · ') || 'nada a enviar'
  }

  async function lote(body = {}) {
    const { ok, ignorados } = listaClientes(body.clientes, cfg.lote_max_manual)
    const elig = mapaElegiveis()
    const itens = [...ignorados.map(i => ({ cliente: i.cliente, acao: 'ignorado', motivo: i.motivo })), ...ok.map(c => ({ cliente: c, ...triagemLote(c, elig) }))]
    if (body.confirmar !== true) return { ok: true, previa: true, itens }
    const por = exigirPor(body.por)
    if (rodando) throw erro('já existe um lote ou envio automático em andamento — aguarde terminar', 409)
    const fila = itens.filter(i => i.acao === 'enviar')
    if (!fila.length) return { ok: false, estado: 'nada_a_enviar', mensagem: 'nenhum cliente pode receber o envio agora' }
    rodando = true
    const job = novoJob('lote', itens.length)
    for (const i of itens.filter(x => x.acao !== 'enviar')) { job.itens.push({ cliente: i.cliente, estado: i.acao, mensagem: i.motivo, url: '' }); job.feitos++ }
    ;(async () => {
      try {
        let seguidas = 0, parou = ''                                // disjuntor: 3 falhas retentáveis seguidas (ou token inválido) param o resto, com UM resumo no fim
        for (const i of fila) {
          if (parou) { job.itens.push({ cliente: i.cliente, estado: 'interrompido', mensagem: parou, url: '' }); job.feitos++; continue }
          let r
          try { r = await enviar(i.cliente, { origem: 'lote', confirmar: true, por }) } catch (e) {
            r = e?.status === 409 ? { ok: false, estado: 'em_andamento', motivo: 'em_voo', mensagem: MSG_FALHA.em_voo } : { ok: false, estado: 'falhou', mensagem: e?.status ? e.message : 'falha interna', motivo: 'erro_interno' }
          }
          job.itens.push({ cliente: i.cliente, estado: r.ok ? r.estado : (r.estado || 'falhou'), mensagem: r.ok ? '' : r.mensagem, url: r.url || '' })
          job.feitos++
          if (r.ok || r.estado === 'vazio') { seguidas = 0; continue }
          if (r.estado === 'em_andamento') continue                 // outro envio do mesmo cliente corre: nem falha nem aviso
          if (ehCredencial(r.motivo)) { parou = r.mensagem; continue }
          if (r.retentavel) { if (++seguidas >= DISJUNTOR) parou = ehInfra(r.motivo) ? MSG_INDISPONIVEL : 'falhas seguidas: o restante do lote não foi processado' } else seguidas = 0
          if (!ehInfra(r.motivo)) avisar({ tipo: `relatorio_falhou:${codTipo(r.motivo)}`, nivel: 'erro', titulo: `Relatório não enviado: ${i.cliente}`, corpo: r.mensagem, cliente: i.cliente, link: `/cliente?cliente=${encodeURIComponent(i.cliente)}&aba=configurar`, dedupeMin: 1440 })
        }
        job.estado = 'concluido'
        job.parou = parou
      } catch (e) { job.estado = 'falhou'; log('erro', `lote de relatórios: ${codigoLog(e)}`) }
      finally {
        job.resumo = resumoDoLote(job.itens); job.fim = agora(); rodando = false
        const ruins = job.itens.filter(i => !['enviado', 'adotado', 'substituido', 'ja_enviado', 'ja_enviado_hoje'].includes(i.estado)).length
        avisar({ tipo: 'relatorio_lote', nivel: ruins ? 'alerta' : 'sucesso', titulo: `Relatórios ao Notion do cliente: ${job.resumo}`, corpo: `Lote de ${job.total} cliente(s) disparado por ${por}.${job.parou ? ` Interrompido: ${job.parou}.` : ''}`, link: '/planos#secRelatorios' })
        log('info', `lote de relatórios: ${job.resumo}`)
      }
    })()
    return { ok: true, job: { id: job.id } }
  }

  // ── programação ──────────────────────────────────────────────────────────────────────────────────────────────
  function validarProximo(freq, bruto) {
    if (freq === 'desligado') return ''
    const h = hoje()
    if (bruto === undefined || bruto === '') return proximaSexta(h, cfg.dia_semana_padrao)
    if (!dataValida(bruto) || bruto < h || bruto > somarDias(h, 60)) throw erro('data inválida (use AAAA-MM-DD, entre hoje e 60 dias)')
    return bruto
  }
  function programar(body = {}) {
    const cliente = exigirCliente(body.cliente)
    const freq = str(body.frequencia)
    if (!FREQ_IDS.has(freq)) throw erro('frequência desconhecida — escolha desligado, semanal, quinzenal ou mensal')
    if (freq !== 'desligado' && !mapaElegiveis().has(chaveNome(cliente))) return bloqueioInelegivel()      // desligar continua possível para qualquer cliente
    const proximo = validarProximo(freq, body.proximo_envio)
    const nova = { frequencia: freq, proximo_envio: proximo, ancora_dia: freq === 'mensal' ? Number(proximo.slice(8, 10)) : 0 }
    const c = contexto(), diag = c.diags.get(cliente) || null, atual = c.progs.get(cliente)
    if (body.confirmar !== true) {
      const avisos = []
      if (freq !== 'desligado') {
        if (atual?.pausado_motivo) avisos.push(`Esta programação está pausada (${textoMotivo(atual.pausado_motivo)}); salvar não reativa — use Liberar.`)
        if (!diag) avisos.push('A base deste cliente ainda não foi verificada: use «Verificar bases» antes de liberar o envio automático.')
        else if (!diag.pronto) avisos.push(`A base deste cliente não está pronta: ${diag.proxima_acao || 'confira o destino'}.`)
        if (!atual?.ativado_por) avisos.push('Depois de salvar, o envio automático ainda precisa ser liberado por um líder.')
        if (diaSemana(proximo) !== cfg.dia_semana_padrao) avisos.push('A data escolhida não cai no dia padrão de envio (sexta-feira).')
      }
      return { ok: true, previa: true, datas_previstas: datasPrevistas({ ...nova }, 3), avisos, diag, confirmacao: freq === 'desligado' ? 'O envio automático deste cliente será desligado.' : 'Os envios automáticos criam uma página visível ao cliente, em nome de quem liberar.' }
    }
    exigirPor(body.por)
    // salvar programa; liberar é outra coisa: SÓ liberar reativa (a pausa, as falhas e o backoff ficam como estão). Desligar zera tudo (religar exige liberar de novo).
    const extra = freq === 'desligado' ? { ativado_por: '', ativado_em: '', pausado_motivo: '', falhas_seguidas: 0, tentar_apos: '' } : {}
    salvarProg(cliente, { ...nova, ...extra })
    const c2 = contexto()
    return { ok: true, programacao: comDatas(itemDe(cliente, c2), c2) }
  }
  function frequenciaEmLote(body = {}) {
    const { ok, ignorados } = listaClientes(body.clientes, 100)
    const freq = str(body.frequencia)
    if (!FREQ_IDS.has(freq)) throw erro('frequência desconhecida — escolha desligado, semanal, quinzenal ou mensal')
    const h = hoje(), c = contexto(), elig = mapaElegiveis()
    const fora = freq !== 'desligado' ? ok.filter(cli => !elig.has(chaveNome(cli))) : []        // desligar vale para qualquer cliente; ligar só para os Ativos
    for (const cli of fora) ignorados.push({ cliente: cli, motivo: MSG_FALHA.cliente_inelegivel })
    const itens = ok.filter(cli => !fora.includes(cli)).map(cliente => {
      const p = c.progs.get(cliente), de = p?.frequencia || 'desligado'
      const manter = freq !== 'desligado' && de !== 'desligado' && dataValida(p?.proximo_envio) && p.proximo_envio >= h
      const proximo = freq === 'desligado' ? '' : manter ? p.proximo_envio : proximaSexta(h, cfg.dia_semana_padrao)
      const aviso = freq !== 'desligado' && p?.pausado_motivo ? `Pausado (${textoMotivo(p.pausado_motivo)}); salvar não reativa — use Liberar.` : ''
      return { cliente, de, para: freq, proximo_envio: proximo, muda: de !== freq || (p?.proximo_envio || '') !== proximo, ...(aviso ? { aviso } : {}) }
    })
    const mudam = itens.filter(i => i.muda)
    if (body.confirmar !== true) return { ok: true, previa: true, mudam: mudam.length, itens, ignorados, avisos: itens.filter(i => i.aviso).map(i => `${i.cliente}: ${i.aviso}`) }
    exigirPor(body.por)
    // só liberar reativa: a pausa, as falhas e o backoff ficam como estão (desligar zera tudo; religar exige liberar de novo)
    handle.transaction(() => {
      for (const i of mudam) salvarProg(i.cliente, { frequencia: freq, proximo_envio: i.proximo_envio, ancora_dia: freq === 'mensal' ? Number(i.proximo_envio.slice(8, 10)) : 0,
        ...(freq === 'desligado' ? { ativado_por: '', ativado_em: '', pausado_motivo: '', falhas_seguidas: 0, tentar_apos: '' } : {}) })
    })()
    return { ok: true, alterados: mudam.length }
  }
  function liberar(body = {}) {
    const c = contexto()
    let alvo, ignorados = []
    if (body.clientes === undefined) alvo = [...c.progs.values()].filter(p => p.frequencia !== 'desligado').map(p => p.cliente).sort((a, b) => a.localeCompare(b, 'pt-BR'))
    else { const r = listaClientes(body.clientes, 500); alvo = r.ok; ignorados = r.ignorados.map(i => ({ cliente: i.cliente, motivo: i.motivo })) }
    const elig = mapaElegiveis(), desconhecidos = paginasDesconhecidas(elig)
    const libera = []
    for (const cliente of alvo) {
      const p = c.progs.get(cliente), d = c.diags.get(cliente)
      let motivo = ''
      if (!p || p.frequencia === 'desligado') motivo = 'sem frequência de envio programada'
      else if (!elig.has(chaveNome(cliente))) motivo = MSG_FALHA.cliente_inelegivel
      else if (p.ativado_por && !p.pausado_motivo) motivo = 'já liberado'
      else if (!d) motivo = 'base ainda não verificada'
      else if (!d.pronto) motivo = d.proxima_acao || 'a base não está pronta'
      else if ([...desconhecidos].some(y => y !== cliente)) motivo = MSG_VERIFICAR
      if (motivo) ignorados.push({ cliente, motivo }); else libera.push(cliente)
    }
    const semEnvio = libera.filter(cli => !jaTeve.get(cli)).length
    if (body.confirmar !== true) return { ok: true, previa: true, liberaria: libera, ignorados, sem_envio_anterior: semEnvio, confirmacao: 'Os envios automáticos criam uma página visível ao cliente. Quem nunca recebeu relatório recebe o primeiro sem prévia individual.' }
    const por = exigirPor(body.por)
    handle.transaction(() => { for (const cli of libera) salvarProg(cli, { ativado_por: por, ativado_em: agora(), pausado_motivo: '', falhas_seguidas: 0, tentar_apos: '' }) })()
    log('info', `relatórios: ${libera.length} cliente(s) liberado(s) para o envio automático por ${por}`)
    return { ok: true, liberados: libera.length }
  }

  // ── diagnóstico das bases (somente leitura) ───────────────────────────────────────────────────────────────────
  const perfilDe = cliente => { try { return handle.prepare('SELECT 1 FROM perfil_cliente WHERE cliente = ?').get(cliente) ? 'salvo' : 'padrao' } catch { return 'padrao' } }
  const mlDe = cliente => { try { const r = handle.prepare('SELECT erro FROM meli_contas WHERE cliente = ?').get(cliente); return r ? !r.erro : false } catch { return null } }
  async function diagnosticarUm(cliente) {
    let d, cat = null, falhaCod = ''
    try { d = await nt.destinoDe(cliente, { reescanear: true }); if (d.esquema) cat = decidirCategoria(d.esquema) } catch (e) { falhaCod = classificar(e).codigo }
    const destino = falhaCod ? 'erro' : d.estado
    let categoria = cat ? cat.estado : ''
    let pronto = !falhaCod && d.estado === 'ok' && ['ok', 'ok_alternativa', 'select_cria'].includes(categoria)
    // PLANO B: Informações não aceita por motivo sem conserto pela API, mas o quadro Tarefas existe → pronto, categoria 'tarefa' (liberar/agendar seguem o mesmo caminho do envio)
    if (!pronto && !falhaCod) { try { if (await quadroFallback(cliente, d.estado === 'ok' ? categoria : d.estado)) { pronto = true; categoria = CAT_TAREFA } } catch (e) { falhaCod = classificar(e).codigo } }
    const proxima = pronto ? '' : falhaCod ? 'Tentar a verificação de novo (Notion indisponível)' : (PROXIMA_ACAO[d.estado === 'ok' ? categoria : d.estado] || '')
    const reg = { cliente, em: agora(), pagina: falhaCod ? '' : d.pagina_titulo || (d.pagina ? 'sem título' : ''), informacoes: falhaCod ? '' : d.informacoes_url || '',
      secao_tipo: d?.esquema?.secao?.tipo || '', categoria, destino, perfil: perfilDe(cliente), ml_conectado: mlDe(cliente), pronto, proxima_acao: proxima }
    estado.set(`rel_diag:${cliente}`, JSON.stringify(reg))
    return reg
  }
  // a verificação preenche o cache de página de um cliente por vez: quem foi verificado ANTES do irmão ainda não via o compartilhamento. Com o cache completo, fecha a conta.
  function marcarCompartilhados(clientes, job) {
    if (!estado.listar) return
    const idPag = v => String(v ?? '').replace(/-/g, '').toLowerCase(), porPagina = new Map()
    for (const r of estado.listar('pagina_cliente:')) if (RX_ID.test(String(r.valor || ''))) { const id = idPag(r.valor); porPagina.set(id, [...(porPagina.get(id) || []), r.chave.slice('pagina_cliente:'.length)]) }
    for (const cli of clientes) {
      const reg = lerDiag(cli), id = idPag(estado.get(`pagina_cliente:${cli}`))
      if (!reg || reg.destino !== 'ok' || !id || !(porPagina.get(id) || []).some(x => x !== cli)) continue
      estado.set(`rel_diag:${cli}`, JSON.stringify({ ...reg, destino: 'destino_compartilhado', pronto: false, proxima_acao: PROXIMA_ACAO.destino_compartilhado }))
      const it = job.itens.find(x => x.cliente === cli); if (it) { it.estado = 'destino_compartilhado'; it.mensagem = PROXIMA_ACAO.destino_compartilhado }
    }
  }
  function diagnosticar(body = {}) {
    if (diagRodando) throw erro('já existe uma verificação de bases em andamento — aguarde terminar', 409)
    let alvo
    if (body.clientes === undefined) alvo = [...mapaElegiveis().values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))      // só `undefined` = todos; null, [] e não-lista são 400
    else alvo = listaClientes(body.clientes, 500).ok
    diagRodando = true
    const job = novoJob('diagnostico', alvo.length)
    ;(async () => {
      try {
        nt.invalidarCaches(); tf.invalidarCaches()
        for (const cliente of alvo) {
          const r = await diagnosticarUm(cliente).catch(e => ({ cliente, pronto: false, destino: 'erro', proxima_acao: codigoLog(e).slice(0, 40) }))
          job.itens.push({ cliente, estado: r.pronto ? 'pronto' : (r.categoria === 'opcao_ausente_status' ? 'opcao_ausente_status' : r.destino), mensagem: r.pronto ? '' : (r.proxima_acao || ''), url: '' })
          job.feitos++
        }
        marcarCompartilhados(alvo, job)
        job.estado = 'concluido'
      } catch (e) { job.estado = 'falhou'; log('erro', `verificação de bases: ${codigoLog(e)}`) }
      finally { job.resumo = `${job.itens.filter(i => i.estado === 'pronto').length} prontos de ${job.total}`; job.fim = agora(); diagRodando = false }
    })()
    return { id: job.id }
  }
  function diagnostico() {
    const c = contexto(), nomes = [...mapaElegiveis().values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const itens = nomes.map(cliente => c.diags.get(cliente) || { cliente, pagina: '', informacoes: '', secao_tipo: '', categoria: '', destino: 'nao_verificado', perfil: perfilDe(cliente), ml_conectado: mlDe(cliente), pronto: false, proxima_acao: 'Verificar a base deste cliente', em: '' })
    const n = f => itens.filter(f).length
    return { itens, resumo: { prontos: n(i => i.pronto), opcao_ausente: n(i => i.categoria === 'opcao_ausente_status'), sem_base: n(i => ['sem_base', 'base_invalida'].includes(i.destino)),
      sem_pagina: n(i => ['sem_pagina', 'pagina_invalida'].includes(i.destino)), nao_verificados: n(i => i.destino === 'nao_verificado') } }
  }
  function diagnosticoCsv() {
    const c = contexto(), d = diagnostico()
    const linhas = d.itens.map(i => { const it = itemDe(i.cliente, c); return { ...i, categoria: i.categoria === CAT_TAREFA ? rotuloTarefa(cfg) : i.categoria, ml_conectado: i.ml_conectado === null ? '' : i.ml_conectado ? 'sim' : 'não', pronto: i.pronto ? 'sim' : 'não',
      frequencia: it.frequencia_rotulo, proximo_envio: it.proximo_envio, ultimo_envio: it.ultimo_envio_em } })
    return paraCsv(linhas, ['cliente', 'pagina', 'informacoes', 'secao_tipo', 'categoria', 'perfil', 'ml_conectado', 'frequencia', 'proximo_envio', 'ultimo_envio', 'pronto', 'proxima_acao'])
  }

  // ── agendador ────────────────────────────────────────────────────────────────────────────────────────────────
  function agendadorEstado() {
    const v = estado.get('relatorio_agendador')
    return { ligado: v === undefined || v === null ? cfg.agendador_ligado === true : v === 'ligado' }
  }
  function agendador(body = {}) {
    if (typeof body.ligado !== 'boolean') throw erro('informe "ligado" (verdadeiro ou falso)')
    const por = exigirPor(body.por)
    estado.set('relatorio_agendador', body.ligado ? 'ligado' : 'desligado')
    estado.set('relatorio_agendador_por', `${por} · ${agora()}`)
    log('info', `agendador de relatórios ${body.ligado ? 'LIGADO' : 'DESLIGADO'} por ${por}`)
    return { ok: true, ligado: body.ligado }
  }
  // quantas falhas de INFRAESTRUTURA seguidas o cliente tem no log (a atual já está gravada): escalona a espera sem tocar em falhas_seguidas
  const seguidasDeInfra = cliente => { let n = 0; for (const r of ultimasDoCliente.all(cliente)) { if (r.estado === 'falhou' && ehInfra(r.motivo)) n++; else break } return Math.max(1, n) }
  const linkCliente = cliente => `/cliente?cliente=${encodeURIComponent(cliente)}&aba=configurar`
  function falhaDoAgendado(p, r) {
    const cliente = p.cliente
    if (r.estado === 'vazio') { salvarProg(cliente, { proximo_envio: aposEnvio(p, hoje(), cfg.intervalo_minimo_dias) || p.proximo_envio, falhas_seguidas: 0, tentar_apos: '' }); return 'vazio' }
    const link = linkCliente(cliente)
    if (ehInfra(r.motivo)) {                                        // 5xx, rede, timeout, 429: a queda não é do cliente — nada de contagem de falhas nem pausa; o disjuntor do tick avisa a queda geral UMA vez
      const n = seguidasDeInfra(cliente)
      salvarProg(cliente, { tentar_apos: new Date(agoraMs() + backoffMin(n, cfg) * 60_000).toISOString() })
      // …mas um cliente que falha SOZINHO, vez após vez (os outros saem), não pode ficar invisível: no 2×tentativas_max-ésimo erro seguido avisa uma vez, sem pausar
      if (n === 2 * cfg.tentativas_max) avisar({ tipo: 'relatorio_falhou:indisponivel', nivel: 'alerta', titulo: `Relatório não enviado: ${cliente}`, corpo: `${n} tentativas seguidas falharam por indisponibilidade do Notion, da rede ou tempo esgotado. O sistema continua tentando; nada foi pausado.`, cliente, link, dedupeMin: 1440 })
      return 'retentar'
    }
    if (r.retentavel) {
      const n = p.falhas_seguidas + 1
      if (n >= cfg.tentativas_max) {
        salvarProg(cliente, { falhas_seguidas: n, pausado_motivo: 'falhas', tentar_apos: '' })
        avisar({ tipo: 'relatorio_falhou:falhas', nivel: 'erro', titulo: `Relatório não enviado: ${cliente}`, corpo: `${textoMotivo('falhas')} Último erro: ${r.mensagem}`, cliente, link, dedupeMin: 1440 })
        return 'pausado'
      }
      salvarProg(cliente, { falhas_seguidas: n, tentar_apos: new Date(agoraMs() + backoffMin(n, cfg) * 60_000).toISOString() })
      return 'retentar'
    }
    const motivo = r.motivo || r.estado || 'bloqueado'
    salvarProg(cliente, { pausado_motivo: motivo, falhas_seguidas: 0, tentar_apos: '' })
    avisar({ tipo: `relatorio_falhou:${codTipo(motivo)}`, nivel: 'alerta', titulo: `Relatório pausado: ${cliente}`, corpo: textoMotivo(motivo), cliente, link, dedupeMin: 1440 })      // o motivo faz parte do tipo: problema novo não some no dedupe do antigo
    return 'pausado'
  }
  // a cada 10 min (server.js). Sai se: interruptor desligado, já em curso (tick ou lote), fora da janela. Sequencial, 6 por tick, orçamento de 6 min.
  // O interruptor é relido a CADA cliente (freio de emergência); 3 falhas retentáveis seguidas (Notion fora do ar, Mercado Livre mudo…) interrompem o tick com UM aviso.
  async function tick() {
    if (!agendadorEstado().ligado) return { pulou: 'desligado' }
    if (rodando) return { pulou: 'em_andamento' }
    const ctx = { hoje: hoje(), agora: agora(), hora: hora(), cfg }
    if (!dentroDaJanela(ctx, cfg)) return { pulou: 'fora_da_janela' }
    rodando = true
    const res = { pulou: '', processados: 0, enviados: 0, pausados: 0, retentar: 0, vazios: 0 }
    const mais = k => { res[k] = (res[k] || 0) + 1 }                // contadores extras só aparecem quando acontecem
    try {
      const elig = mapaElegiveis(), ini = agoraMs(), desconhecidos = paginasDesconhecidas(elig)
      const fila = todasProg.all().filter(p => devido(p, ctx) && elig.has(chaveNome(p.cliente))).sort((a, b) => a.proximo_envio.localeCompare(b.proximo_envio) || a.cliente.localeCompare(b.cliente, 'pt-BR'))
      let seguidas = 0, seguidasInfra = 0
      for (const p0 of fila) {
        if (res.processados >= cfg.lote_por_tick || agoraMs() - ini >= cfg.orcamento_tick_min * 60_000) break
        if (!agendadorEstado().ligado) { res.interrompido = 'freio'; break }
        const ctxAgora = { hoje: hoje(), agora: agora(), hora: hora(), cfg }
        if (!dentroDaJanela(ctxAgora, cfg)) break                  // a janela fechou no meio do tick: o resto fica para o próximo dia útil
        const p = selProg.get(p0.cliente)                           // relê: um líder pode ter pausado/desligado depois que a fila foi montada
        if (!devido(p, ctxAgora)) continue
        if (canon(p.cliente) !== p.cliente) {                       // a central renomeou o cliente: a linha antiga não avançaria (reenvio todo dia útil) — pausa sem enviar
          log('aviso', `relatório ${p.cliente}: nome diferente do da central; programação pausada`)
          falhaDoAgendado(p, { ok: false, estado: 'bloqueado', motivo: 'cliente_renomeado', retentavel: false }); res.pausados++; continue
        }
        if ([...desconhecidos].some(y => y !== p.cliente)) { mais('retidos'); continue }     // há página de cliente ainda não verificada: não dá para descartar página compartilhada
        res.processados++
        try {
          let r
          try { r = await enviar(p.cliente, { origem: 'agendado', confirmar: true, por: p.ativado_por, checarFreio: true }) }
          catch (e) { r = e?.status === 409 ? { ok: false, estado: 'pulado', motivo: 'em_voo' } : { ok: false, estado: 'falhou', motivo: 'erro_interno', mensagem: e?.status ? e.message : textoMotivo('erro_interno'), retentavel: true } }
          if (r.ok) { res.enviados++; seguidas = seguidasInfra = 0; continue }       // sucesso do agendado: só log (nada de notificação por cliente) — a programação já avançou em enviar()
          if (r.estado === 'pulado') {                              // outro envio do mesmo cliente em curso, ou freio acionado durante o envio: não é falha de ninguém
            res.processados--
            if (r.motivo === 'freio') { res.interrompido = 'freio'; break }
            mais('pulados'); continue
          }
          if (ehCredencial(r.motivo)) {                             // token inválido/ausente vale para a carteira inteira: pausar cliente por cliente não resolve — para e avisa uma vez
            res.interrompido = 'credencial'
            avisar({ tipo: `relatorio_falhou:${codTipo(r.motivo)}`, nivel: 'erro', titulo: 'Relatórios não enviados: o Notion recusou o token', corpo: r.mensagem, link: '/planos#secRelatorios', dedupeMin: 1440 })
            break
          }
          const fim = falhaDoAgendado(selProg.get(p.cliente) || p, r)
          if (fim === 'pausado') { res.pausados++; seguidas = seguidasInfra = 0 } else if (fim === 'vazio') { res.vazios++; seguidas = seguidasInfra = 0 } else {
            res.retentar++; seguidas++; if (ehInfra(r.motivo)) seguidasInfra++
            if (seguidas >= DISJUNTOR) {
              res.interrompido = 'disjuntor'
              const notion = seguidasInfra === seguidas
              avisar({ tipo: 'relatorio_falhou:disjuntor', nivel: 'alerta', titulo: notion ? MSG_INDISPONIVEL : 'Envio automático de relatórios interrompido por falhas seguidas',
                corpo: notion ? `${seguidas} envios seguidos falharam por indisponibilidade do Notion (erro do servidor, rede ou tempo esgotado). Nenhum cliente foi pausado.` : `${seguidas} envios seguidos falharam; os demais clientes retomam no próximo ciclo.`, link: '/planos#secRelatorios', dedupeMin: 120 })
              break
            }
          }
        } catch (e) { log('erro', `agendador de relatórios (${p.cliente}): ${codigoLog(e)}`) }
      }
      if (res.retidos) avisar({ tipo: 'relatorio_falhou:verificacao', nivel: 'alerta', titulo: 'Envio automático retido: faltam bases a verificar',
        corpo: `A página do Notion de ${desconhecidos.size} cliente(s) ainda não foi verificada, então o sistema não consegue descartar páginas compartilhadas entre clientes. Rode «Verificar bases» para todos os clientes.`, link: '/planos#secRelatorios', dedupeMin: 1440 })
      if (res.processados || res.pausados) log('info', `agendador de relatórios: ${res.enviados} enviado(s), ${res.pausados} pausado(s), ${res.retentar} a retentar, ${res.vazios} vazio(s) de ${res.processados}${res.interrompido ? ` · interrompido (${res.interrompido})` : ''}`)
    } finally { rodando = false }
    return res
  }

  // ── reanexar o documento num envio já feito: { cliente, de, ate, por, confirmar } — prévia lista o que faria; confirmar gera o PDF do brief de hoje (precisa ser a MESMA janela) e anexa ──
  async function anexar({ cliente, de, ate, por, confirmar } = {}) {
    const c = exigirCliente(cliente)
    if (!dataValida(de) || !dataValida(ate)) throw erro('informe "de" e "ate" (AAAA-MM-DD)')
    exigirPor(por)
    const vivo = selVivo.get(c, de, ate)
    if (!vivo || !vivo.page_id) return { ok: false, estado: 'sem_envio', mensagem: 'não há envio registrado deste período para o cliente' }
    const previa = { ok: true, previa: true, cliente: c, de, ate, url: vivo.page_url, anexo_atual: vivo.anexo || '', faria: vivo.anexo === 'ok' ? 'conferir' : 'anexar' }
    if (confirmar !== true) return previa
    if (!AX.ligado) return { ok: false, estado: 'desligado', mensagem: 'o anexo do PDF está desligado na configuração' }
    const B = await gerarBrief(c)
    if (B.janela?.de !== de || B.janela?.ate !== ate) return { ok: false, estado: 'janela_diferente', mensagem: 'o relatório de hoje cobre outro período; o documento só é gerado do mesmo brief do envio' }
    const nomes = (await nomesInternos(c)) || []
    if (auditarBlocos(briefParaBlocos(B), { nomesInternos: nomes, permitidos: [c] }).length) return { ok: false, estado: 'bloqueado', motivo: 'conteudo', mensagem: textoMotivo('conteudo') }
    const anexo = await anexarDocumento({ cliente: c, de, ate, B, page_id: vivo.page_id })
    return { ok: anexo === 'ok', previa: false, estado: anexo === 'ok' ? 'anexado' : 'falhou', anexo, url: vivo.page_url }
  }
  // lote: todos os envios vivos sem anexo 'ok' desde a data ({ desde, por, confirmar }); confirmar cria um job sequencial (mesmo mutex do lote)
  function anexarLote({ desde, por, confirmar } = {}) {
    if (!dataValida(desde)) throw erro('informe "desde" (AAAA-MM-DD)')
    const porOk = exigirPor(por)
    const itens = semAnexoDesde.all(desde).map(r => ({ cliente: r.cliente, de: r.de, ate: r.ate, url: r.page_url, anexo_atual: r.anexo || '' }))
    if (confirmar !== true) return { ok: true, previa: true, itens }
    if (!itens.length) return { ok: false, estado: 'nada_a_anexar', mensagem: 'todos os envios desde essa data já têm o documento' }
    if (rodando) throw erro('já existe um lote ou envio automático em andamento — aguarde terminar', 409)
    rodando = true
    const job = novoJob('anexar', itens.length)
    ;(async () => {
      try {
        for (const i of itens) {
          let r
          try { r = await anexar({ cliente: i.cliente, de: i.de, ate: i.ate, por: porOk, confirmar: true }) } catch (e) { r = { ok: false, estado: 'falhou', mensagem: e?.status ? e.message : 'falha interna', anexo: 'falhou:erro_interno' } }
          job.itens.push({ cliente: i.cliente, estado: r.ok ? 'anexado' : (r.estado || 'falhou'), mensagem: r.ok ? '' : (r.anexo || r.mensagem || ''), url: i.url })
          job.feitos++
        }
        job.estado = 'concluido'
      } catch (e) { job.estado = 'falhou'; log('erro', `anexo de PDF em lote: ${codigoLog(e)}`) }
      finally { const okN = job.itens.filter(i => i.estado === 'anexado').length; job.resumo = `${okN} anexados · ${job.itens.length - okN} com problema`; job.fim = agora(); rodando = false }
    })()
    return { ok: true, job: jobDe(job.id) }
  }

  return { enviar, lote, jobDe, programar, clienteDe, listar, diagnosticar, diagnostico, diagnosticoCsv, liberar, frequenciaEmLote, agendador, agendadorEstado, tick, anexar, anexarLote,
    // extras para a fiação e os testes
    config: cfg, canonico: canon, invalidarCaches: () => { nt.invalidarCaches(); tf.invalidarCaches() } }
}
