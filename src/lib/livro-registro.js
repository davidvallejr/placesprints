// LIVRO DE REGISTRO do cliente (pedido do David, 13/10/2026 — base da Prestação de contas e do Dossiê de defesa): cada fato do trabalho feito vira UMA linha
// imutável — tarefa criada/concluída/mudou de status, anexo (print), alteração e fotografia do anúncio, medição antes×depois, relatório, plano e aviso enviados,
// resumo ao time, resposta do cliente, pendência registrada/cobrada/resolvida, alinhamento, risco, contrato, pagamento, documento gerado, nota.
// À prova de alteração: TRIGGER bloqueia UPDATE, DELETE e a substituição por INSERT OR REPLACE; cada linha encadeia a anterior DO MESMO CLIENTE (hash = sha256(hash_anterior ⊕ JSON canônico));
// verificarCadeia recalcula e aponta o 1º elo quebrado; a lacuna no contador global (sqlite_sequence) denuncia linha apagada, inclusive a última.
// Honestidade de data: fato_em = data REAL da fonte ('' quando a fonte não tem data — nunca inventada); registrado_em = quando entrou no livro.
// Nunca grava telefone, jid ou menção @número (máscara em todo texto). Resposta do cliente: só entra depois de revisada pela equipe ou de DIAS_DESCARTE dias sem descarte,
// e só com tipo, âncora, confiança e data (sem autor, sem temas, sem hash do texto — «descartar» em feedback_relatorio apaga o texto de verdade); descartada depois de
// registrada vira uma linha nova (nota 'descarte:<msg_id>') e a cronologia a marca como retratada. Núcleo SEM import de banco: handle, relógio e raiz entram pela fábrica.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

export const TIPOS_LIVRO = ['tarefa_criada', 'tarefa_concluida', 'tarefa_status', 'anexo_tarefa', 'alteracao_anuncio', 'fotografia_anuncio', 'medicao_tarefa',
  'relatorio_enviado', 'plano_enviado', 'aviso_enviado', 'resumo_time', 'resposta_cliente', 'pendencia_registrada', 'pendencia_cobrada', 'pendencia_resolvida',
  'alinhamento', 'risco_marcado', 'risco_encerrado', 'contrato', 'pagamento', 'documento_gerado', 'nota']

export const SCHEMA_LIVRO = `
CREATE TABLE IF NOT EXISTS registro_cliente (     -- livro de registro: append-only, encadeado por cliente (src/lib/livro-registro.js)
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,
  fato_em TEXT NOT NULL DEFAULT '',               -- data do fato CONFORME A FONTE ('' = a fonte não tem data)
  registrado_em TEXT NOT NULL,                    -- ISO: quando entrou no livro
  tipo TEXT NOT NULL CHECK (tipo IN (${TIPOS_LIVRO.map(t => `'${t}'`).join(',')})),
  ref TEXT NOT NULL,                              -- id na fonte (idempotência)
  resumo TEXT NOT NULL,                           -- texto curto e factual (sem telefone)
  dados_json TEXT NOT NULL DEFAULT '{}',          -- JSON canônico
  prova TEXT NOT NULL DEFAULT '',                 -- caminho / URL sem query / sha256
  hash_anterior TEXT NOT NULL DEFAULT '',         -- hash da linha anterior DO MESMO CLIENTE ('' na primeira)
  hash TEXT NOT NULL,
  UNIQUE (tipo, ref)
);
CREATE INDEX IF NOT EXISTS ix_registro_cli ON registro_cliente (cliente, seq);
CREATE INDEX IF NOT EXISTS ix_registro_fato ON registro_cliente (cliente, fato_em);
CREATE TRIGGER IF NOT EXISTS trg_registro_sem_update BEFORE UPDATE ON registro_cliente BEGIN SELECT RAISE(ABORT, 'livro de registro: alteracao proibida'); END;
CREATE TRIGGER IF NOT EXISTS trg_registro_sem_delete BEFORE DELETE ON registro_cliente BEGIN SELECT RAISE(ABORT, 'livro de registro: exclusao proibida'); END;
CREATE TRIGGER IF NOT EXISTS trg_registro_sem_replace BEFORE INSERT ON registro_cliente
  WHEN EXISTS (SELECT 1 FROM registro_cliente WHERE seq = NEW.seq OR (tipo = NEW.tipo AND ref = NEW.ref))
  BEGIN SELECT RAISE(ABORT, 'livro de registro: substituicao proibida'); END;
`

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const sha = s => createHash('sha256').update(String(s), 'utf8').digest('hex')
export const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  : JSON.stringify(v ?? null)
// sem telefone, jid nem menção @número. Telefone = número COM cara de telefone (+55…, (DD) …, ….-…. com separador): run de 10–11 dígitos sem formato é,
// neste domínio, id de anúncio da Shopee/EAN (≈ 750 títulos de card) e fica. Texto livre digitado pela equipe (temContato) recusa também o celular sem formato.
const RX_JID = /[\w.+-]+@(?:g\.us|s\.whatsapp\.net|c\.us|lid)\b/gi
const RX_WA = /(?:https?:\/\/)?(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\/?\?(?:[\w%=&.-]*&)?phone=)\+?\d+/gi   // link de conversa do WhatsApp
const RX_MENCAO = /@\+?\d{6,}/g
// + celular com DDI 55 sem formato (13 dígitos: 55 DD 9 XXXX XXXX) e número separado por espaços («11 98765 4321»); o run de 10–11 dígitos sem formato continua de fora (ver acima)
export const RX_TEL = /(?<![\w-])(?:(?:\+\d{2}[\s.-]?)?(?:\(\d{2}\)[\s.-]?|\d{2}[\s.-])?9?\d{4}[-.]\d{4}|(?:\+\d{2}[\s.-]?|\(\d{2}\)[\s.-]?)\d{0,2}[\s.-]?9?\d{4}[\s.-]?\d{4}|\d{2}\s9?\d{4}\s\d{4}|55[1-9]{2}9\d{8})(?![\w-])|\+\d{12,13}(?!\d)/g
const RX_CELULAR = /(?<![\w-])(?:\+?55)?\(?[1-9]{2}\)?9\d{8}(?![\w-])/
export const temContato = s => { const t = String(s ?? ''); return new RegExp(RX_TEL.source).test(t) || RX_CELULAR.test(t) || new RegExp(RX_WA.source, 'i').test(t) || /@(?:g\.us|s\.whatsapp\.net|c\.us|lid)\b/i.test(t) || /@\+?\d{6,}/.test(t) }
export const mascarar = s => String(s ?? '').replace(RX_WA, '[contato]').replace(RX_JID, '[contato]').replace(RX_MENCAO, '@…').replace(RX_TEL, '[telefone]')
const limpar = v => typeof v === 'string' ? mascarar(v) : Array.isArray(v) ? v.map(limpar) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpar(x)])) : v
const corta = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const semQuery = u => String(u || '').split(/[?#]/)[0]
const RX_DATA = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
const dataFonte = v => { const s = String(v ?? '').trim(); return RX_DATA.test(s) ? s : '' }
const ehProspecto = c => /^\s*\[Comercial\]/i.test(String(c ?? ''))
const DIAS_DESCARTE = 7   // ponytail: prazo fixo para a equipe descartar a resposta antes de ela virar fato imutável; config quando alguém pedir outro
export const solicitacaoSeller = (...txts) => txts.some(t => /solicita[cç][aã]o\s+(do\s+)?seller/i.test(String(t ?? '')))

// hash da linha: tudo que a linha afirma, menos seq (o elo é hash_anterior)
export const hashLinha = (anterior, l) => sha(anterior + '\n' + canon({ cliente: l.cliente, fato_em: l.fato_em, registrado_em: l.registrado_em, tipo: l.tipo, ref: l.ref, resumo: l.resumo, dados_json: l.dados_json, prova: l.prova }))

const hashArquivo = p => new Promise((ok, falha) => { const h = createHash('sha256'); createReadStream(p).on('error', falha).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))) })

// ── fontes da ingestão: cada uma devolve só o que ainda não está no livro (anti-join no UNIQUE(tipo, ref)) ─────────────────────
// Texto SQL fixo (nenhum valor de fora entra nele); o filtro de cliente é parâmetro. `al` = alias da tabela que tem a coluna cliente.
const dm = d => d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : 's/ data'
const FONTES = [
  { tipo: 'tarefa_criada', al: 't', ref: 't.id',
    sql: `SELECT t.id, t.cliente, t.titulo, t.processo, t.responsavel, t.data_inicio, t.prazo, t.tipo_demanda, t.prioridade, t.etiquetas, t.url FROM tarefas t WHERE t.arquivada = 0`,
    linha: t => ({ fato_em: dataFonte(t.data_inicio), resumo: `Tarefa registrada no Notion: «${corta(t.titulo, 160)}» (${t.processo || 'Geral'}${t.responsavel ? `; responsável ${corta(t.responsavel, 60)}` : ''}${t.prazo ? `; prazo ${dm(t.prazo)}` : ''})`,
      dados: { tarefa_id: t.id, titulo: corta(t.titulo, 300), canal: t.processo, responsavel: t.responsavel, data_inicio: t.data_inicio || '', prazo: t.prazo || '', demanda: t.tipo_demanda, etiquetas: String(t.etiquetas || '').trim(), prioridade: String(t.prioridade || '').trim(),
        solicitacao_seller: solicitacaoSeller(t.etiquetas, t.prioridade), data_fonte: t.data_inicio ? 'inicio' : 'ausente' }, prova: t.url }) },
  { tipo: 'tarefa_concluida', al: 't', ref: 't.id',
    sql: `SELECT t.id, t.cliente, t.titulo, t.processo, t.responsavel, t.data_conclusao, t.url FROM tarefas t WHERE t.arquivada = 0 AND t.status = 'concluida'`,
    linha: t => ({ fato_em: dataFonte(t.data_conclusao), resumo: `Tarefa concluída no Notion: «${corta(t.titulo, 160)}»${t.responsavel ? ` (${corta(t.responsavel, 60)})` : ''}`,
      dados: { tarefa_id: t.id, titulo: corta(t.titulo, 300), canal: t.processo, responsavel: t.responsavel, data_conclusao: t.data_conclusao || '', data_fonte: t.data_conclusao ? 'conclusao' : 'ausente' }, prova: t.url }) },
  { tipo: 'tarefa_status', al: 't', ref: "h.tarefa_id || '@' || h.em",
    sql: `SELECT h.tarefa_id, h.de, h.para, h.em, t.cliente, t.titulo FROM historico h JOIN tarefas t ON t.id = h.tarefa_id WHERE h.campo = 'status'`,
    linha: r => ({ fato_em: dataFonte(r.em), resumo: `Status da tarefa «${corta(r.titulo, 160)}»: ${r.de || '—'} → ${r.para || '—'} (detectado na sincronização)`,
      dados: { tarefa_id: r.tarefa_id, de: r.de, para: r.para }, prova: '' }) },
  { tipo: 'alteracao_anuncio', al: 'm', ref: "m.item_id || ':' || m.dia || ':' || m.campo || ':' || m.fonte",
    sql: `SELECT m.cliente, m.item_id, m.dia, m.campo, m.de, m.para, m.variacao_pct, m.fonte FROM meli_item_mudanca m WHERE 1 = 1`,
    linha: m => ({ fato_em: dataFonte(m.dia), resumo: `Anúncio ${m.item_id} — ${m.campo}: ${corta(m.de ?? '—', 80)} → ${corta(m.para ?? '—', 80)} (fonte: ${m.fonte})`,
      dados: { item_id: m.item_id, campo: m.campo, de: corta(m.de, 500), para: corta(m.para, 500), variacao_pct: m.variacao_pct, fonte: m.fonte }, prova: '' }) },
  { tipo: 'fotografia_anuncio', al: 's', ref: "s.item_id || ':' || s.hash",
    sql: `SELECT s.cliente, s.item_id, s.hash, s.capturado_em, s.origem, s.titulo, s.preco, s.status, s.fotos_json, s.descricao_hash FROM meli_item_snapshot s WHERE 1 = 1`,
    linha: s => { let fotos = 0; try { fotos = JSON.parse(s.fotos_json || '[]').length } catch { /* contagem desconhecida */ }
      return { fato_em: dataFonte(s.capturado_em), resumo: `Fotografia completa do anúncio ${s.item_id}: «${corta(s.titulo, 120)}», ${s.preco != null ? `R$ ${Number(s.preco).toFixed(2).replace('.', ',')}` : 'preço não lido'}, ${s.status || 'status não lido'}, ${fotos} foto(s)`,
        dados: { item_id: s.item_id, titulo: corta(s.titulo, 300), preco: s.preco, status: s.status, fotos, origem: s.origem, descricao_hash: s.descricao_hash || '' }, prova: `snapshot:${s.hash}` } } },
  { tipo: 'medicao_tarefa', al: 'a', ref: "a.tarefa_id || ':' || a.item_id || ':' || a.fase",
    sql: `SELECT a.tarefa_id, a.item_id, a.fase, a.cliente, a.data_ref, a.capturado_em, a.atraso_dias, a.estado_json, t.titulo FROM tarefa_acomp a LEFT JOIN tarefas t ON t.id = a.tarefa_id WHERE 1 = 1`,
    linha: a => ({ fato_em: dataFonte(a.capturado_em), resumo: `Medição «${a.fase}» do anúncio ${a.item_id} para a tarefa «${corta(a.titulo || a.tarefa_id, 140)}» (dia de referência ${dm(a.data_ref)})`,
      dados: { tarefa_id: a.tarefa_id, item_id: a.item_id, fase: a.fase, data_ref: a.data_ref, atraso_dias: a.atraso_dias }, prova: `sha256:${sha(a.estado_json)}` }) },
  { tipo: 'relatorio_enviado', al: 'r', ref: "'rel:' || r.id",
    sql: `SELECT r.id, r.cliente, r.de, r.ate, r.origem, r.estado, r.page_url, r.hash, r.anexo, r.por, r.em FROM relatorio_envio r WHERE r.estado IN ('enviado','adotado')`,
    linha: r => ({ fato_em: dataFonte(r.em), resumo: `Relatório de Sprints publicado no Notion do cliente (período ${dm(r.de)} a ${dm(r.ate)}; ${r.origem})`,
      dados: { de: r.de, ate: r.ate, origem: r.origem, estado: r.estado, hash_conteudo: r.hash, anexo: r.anexo, por: r.por }, prova: semQuery(r.page_url) }) },
  { tipo: 'plano_enviado', al: 'l', ref: "'lote:' || l.id",
    sql: `SELECT l.id, l.cliente, l.tipo, l.dia, l.hash, l.canais_json, l.estado, l.origem, l.enviado_em, l.recibos_json FROM gatilho_lote l WHERE l.tipo = 'semanal' AND l.estado IN ('enviado','entregue','parcial')`,
    linha: l => loteLinha(l, 'Plano semanal enviado ao cliente') },
  { tipo: 'aviso_enviado', al: 'l', ref: "'lote:' || l.id",
    sql: `SELECT l.id, l.cliente, l.tipo, l.dia, l.hash, l.canais_json, l.estado, l.origem, l.enviado_em, l.recibos_json FROM gatilho_lote l WHERE l.tipo <> 'semanal' AND l.estado IN ('enviado','entregue','parcial')`,
    linha: l => loteLinha(l, 'Aviso enviado ao cliente') },
  { tipo: 'pendencia_cobrada', al: 'g', ref: "'gat:' || g.id",
    // ponytail: lista fixa dos gatilhos que COBRAM o cliente (config/gatilhos.json → dependencia_vencida, custos_nao_informados); tipo novo de cobrança entra aqui
    sql: `SELECT g.id, g.cliente, g.tipo, g.texto, g.lote_id, g.enviado_em FROM gatilho_cliente g WHERE g.tipo IN ('dependencia_vencida','custos_nao_informados') AND g.enviado_em <> ''`,
    linha: g => ({ fato_em: dataFonte(g.enviado_em), resumo: `Pendência cobrada do cliente no aviso: ${corta(g.texto, 300)}`, dados: { gatilho: g.tipo, lote_id: g.lote_id }, prova: g.lote_id ? `lote:${g.lote_id}` : '' }) },
  { tipo: 'pendencia_cobrada', al: 'x', ref: "'alerta:' || x.id",
    sql: `SELECT x.id, x.cliente, x.item, x.canal, x.rotulo, x.canal_rotulo, x.gravidade, x.page_url, x.hash, x.enviado_em FROM alerta_cliente x WHERE x.enviado_em <> ''`,
    linha: x => ({ fato_em: dataFonte(x.enviado_em), resumo: `Alerta de pendência publicado no Notion do cliente: ${x.rotulo || x.item} (${x.canal_rotulo || x.canal})`,
      dados: { item: x.item, canal: x.canal, gravidade: x.gravidade, hash_conteudo: x.hash }, prova: semQuery(x.page_url) }) },
  { tipo: 'resumo_time', al: 'c', ref: "'disc:' || c.id",
    sql: `SELECT c.id, c.cliente, c.tipo, c.chave, c.dia, c.hash, c.estado, c.mencao, c.enviado_em FROM consultor_aviso c WHERE c.estado IN ('enviado','entregue')`,
    linha: c => ({ fato_em: dataFonte(c.enviado_em), resumo: `Resumo interno ao time no Discord do cliente (${c.tipo === 'interno_semanal' ? `semana ${c.chave}` : c.chave})`,
      dados: { tipo: c.tipo, chave: c.chave, dia: c.dia, estado: c.estado, mencao: !!c.mencao }, prova: `sha256:${c.hash}` }) },
  // resposta do cliente: só depois de revisada (revisado/implementar) ou de DIAS_DESCARTE dias sem descarte — o livro não apaga, e o descarte existe para apagar
  { tipo: 'resposta_cliente', al: 'f', ref: 'f.msg_id', args: em => [new Date(Date.parse(em) - DIAS_DESCARTE * 864e5).toISOString()],
    sql: `SELECT f.msg_id, f.cliente, f.recebido_em, f.ancora_tipo, f.relacao, f.confianca FROM feedback_relatorio f WHERE (f.status IN ('revisado','implementar') OR (f.status = 'novo' AND f.coletado_em <= ?))`,
    linha: f => ({ fato_em: dataFonte(f.recebido_em), resumo: `Resposta do cliente ao ${f.ancora_tipo === 'pergunta' ? 'questionário' : 'relatório'} (${f.confianca === 'certa' ? 'citou a nossa mensagem' : 'provável, pela janela'})`,
      dados: { ancora_tipo: f.ancora_tipo, relacao: f.relacao, confianca: f.confianca }, prova: '' }) },
  { tipo: 'nota', al: 'f', ref: "'descarte:' || f.msg_id",
    sql: `SELECT f.msg_id, f.cliente, f.status_em FROM feedback_relatorio f WHERE f.status = 'descartado' AND EXISTS (SELECT 1 FROM registro_cliente r WHERE r.tipo = 'resposta_cliente' AND r.ref = f.msg_id)`,
    linha: f => ({ fato_em: dataFonte(f.status_em), resumo: 'Resposta do cliente registrada antes foi descartada pela equipe (não era resposta ao relatório): o fato anterior fica no livro, marcado como retratado',
      dados: { msg_id: f.msg_id }, prova: '' }) },
  { tipo: 'pendencia_registrada', al: 'p', ref: "'pc:' || p.id",
    sql: `SELECT p.id, p.cliente, p.canal, p.item, p.detalhe, p.desde, p.evidencia, p.gravidade, p.por, p.criada_em FROM pendencia_cliente p WHERE 1 = 1`,
    linha: p => ({ fato_em: dataFonte(p.desde) || dataFonte(p.criada_em), resumo: `Pendência do cliente registrada: ${p.item} (${p.canal}; ${p.gravidade || 'sem gravidade'})`,
      dados: { canal: p.canal, item: p.item, gravidade: p.gravidade, detalhe: corta(p.detalhe, 300), por: p.por, desde: p.desde, criada_em: p.criada_em }, prova: semQuery(p.evidencia) }) },
  { tipo: 'pendencia_resolvida', al: 'p', ref: "'pc:' || p.id",
    sql: `SELECT p.id, p.cliente, p.canal, p.item, p.resolvida_em, p.resolvida_por, p.nota FROM pendencia_cliente p WHERE p.resolvida_em <> ''`,
    linha: p => ({ fato_em: dataFonte(p.resolvida_em), resumo: `Pendência do cliente resolvida: ${p.item} (${p.canal})`, dados: { canal: p.canal, item: p.item, por: p.resolvida_por, nota: corta(p.nota, 300) }, prova: '' }) },
  { tipo: 'pendencia_registrada', al: 'd', ref: "'td:' || d.tarefa_id || '@' || d.em",
    sql: `SELECT d.tarefa_id, d.cliente, d.tipo, d.detalhe, d.evidencia, d.por, d.em, d.notion_ok, t.titulo FROM tarefa_dependencia d LEFT JOIN tarefas t ON t.id = d.tarefa_id WHERE 1 = 1`,
    linha: d => ({ fato_em: dataFonte(d.em), resumo: `Tarefa «${corta(d.titulo || d.tarefa_id, 140)}» aguardando o cliente (${d.tipo})${d.notion_ok ? '; marcada no Notion' : '; marcação no Notion falhou'}`,
      dados: { tarefa_id: d.tarefa_id, tipo: d.tipo, detalhe: corta(d.detalhe, 300), por: d.por, notion_ok: !!d.notion_ok }, prova: semQuery(d.evidencia) }) },
  { tipo: 'pendencia_resolvida', al: 'd', ref: "'td:' || d.tarefa_id || '@' || d.em",
    sql: `SELECT d.tarefa_id, d.cliente, d.em, d.reaberta_em, d.reaberta_para, t.titulo FROM tarefa_dependencia d LEFT JOIN tarefas t ON t.id = d.tarefa_id WHERE d.reaberta_em <> ''`,
    linha: d => ({ fato_em: dataFonte(d.reaberta_em), resumo: `Tarefa «${corta(d.titulo || d.tarefa_id, 140)}» saiu de «aguardando o cliente» (${d.reaberta_para || 'novo status'})`, dados: { tarefa_id: d.tarefa_id, para: d.reaberta_para }, prova: '' }) },
  { tipo: 'alinhamento', al: 'n', ref: "'al:' || n.id",
    sql: `SELECT n.id, n.cliente, n.escopo, n.chave, n.tipo, n.motivo, n.acos_alvo, n.por, n.origem, n.desde, n.revisar_em, n.permanente FROM alinhamento n WHERE 1 = 1`,
    linha: n => ({ fato_em: dataFonte(n.desde), resumo: `Alinhamento com o cliente registrado: ${n.tipo} (${n.escopo}${n.chave ? ` ${n.chave}` : ''})${n.permanente ? ', permanente' : n.revisar_em ? `, revisar em ${dm(n.revisar_em)}` : ''}`,
      dados: { escopo: n.escopo, chave: n.chave, tipo: n.tipo, motivo: corta(n.motivo, 200), acos_alvo: n.acos_alvo, por: n.por, origem: n.origem, revisar_em: n.revisar_em, permanente: !!n.permanente }, prova: '' }) },
  { tipo: 'alinhamento', al: 'n', ref: "'al:' || n.id || ':encerrado'",
    sql: `SELECT n.id, n.cliente, n.tipo, n.escopo, n.chave, n.encerrado_em, n.encerrado_por FROM alinhamento n WHERE n.estado = 'encerrado' AND n.encerrado_em <> ''`,
    linha: n => ({ fato_em: dataFonte(n.encerrado_em), resumo: `Alinhamento encerrado: ${n.tipo} (${n.escopo}${n.chave ? ` ${n.chave}` : ''})`, dados: { alinhamento_id: n.id, por: n.encerrado_por }, prova: '' }) },
]
function loteLinha(l, titulo) {
  let canais = [], recibos = {}
  try { canais = JSON.parse(l.canais_json || '[]') } catch { /* sem canais */ }
  try { recibos = Object.fromEntries(Object.entries(JSON.parse(l.recibos_json || '{}')).map(([k, v]) => [k, v?.estado || ''])) } catch { /* sem recibos */ }
  return { fato_em: dataFonte(l.enviado_em), resumo: `${titulo}${canais.length ? ` (${canais.join(', ')})` : ''}; situação: ${l.estado}`, dados: { lote: l.tipo, dia: l.dia, canais, estado: l.estado, origem: l.origem, recibos }, prova: `sha256:${l.hash}` }
}

// deps: handle (better-sqlite3), agora() ISO, raiz = pasta data/ (arquivo_local das evidências e documentos é relativo a ela)
export function criarLivro({ handle: h, agora = () => new Date().toISOString(), raiz = '' } = {}) {
  const ultimo = h.prepare('SELECT hash FROM registro_cliente WHERE cliente = ? ORDER BY seq DESC LIMIT 1')
  const existe = h.prepare('SELECT seq, hash FROM registro_cliente WHERE tipo = ? AND ref = ?')
  const ins = h.prepare('INSERT INTO registro_cliente (cliente, fato_em, registrado_em, tipo, ref, resumo, dados_json, prova, hash_anterior, hash) VALUES (?,?,?,?,?,?,?,?,?,?)')

  const normalizar = e => {
    const cliente = typeof e?.cliente === 'string' ? e.cliente.trim() : ''
    if (!cliente || ehProspecto(cliente)) throw erro('cliente inválido para o livro')
    if (!TIPOS_LIVRO.includes(e.tipo)) throw erro('tipo de registro inválido')
    const ref = String(e.ref ?? '').trim()
    if (!ref || ref.length > 300) throw erro('referência do registro inválida')
    const resumo = corta(mascarar(e.resumo), 500)
    if (!resumo) throw erro('resumo do registro vazio')
    return { cliente, tipo: e.tipo, ref, fato_em: dataFonte(e.fato_em), resumo, dados_json: canon(limpar(e.dados ?? {})), prova: corta(mascarar(e.prova), 500) }
  }
  // grava uma lista numa transação IMEDIATA (outro processo que ingere ao mesmo tempo espera): (tipo, ref) já registrado é pulado — nunca INSERT OR IGNORE,
  // que consome o contador e abriria lacuna falsa na verificação
  const gravar = h.transaction(lista => {
    const cab = new Map(), em = agora(), out = []
    for (const l of lista) {
      const ja = existe.get(l.tipo, l.ref)
      if (ja) { out.push({ novo: false, seq: ja.seq, hash: ja.hash }); continue }
      const ant = cab.has(l.cliente) ? cab.get(l.cliente) : ultimo.get(l.cliente)?.hash || ''
      const linha = { ...l, registrado_em: em }
      const hash = hashLinha(ant, linha)
      const r = ins.run(linha.cliente, linha.fato_em, em, linha.tipo, linha.ref, linha.resumo, linha.dados_json, linha.prova, ant, hash)
      cab.set(l.cliente, hash); out.push({ novo: true, seq: Number(r.lastInsertRowid), hash })
    }
    return out
  })
  const registrarVarios = entradas => entradas.length ? gravar.immediate(entradas.map(normalizar)) : []
  const registrar = entrada => registrarVarios([entrada])[0]

  // ── ingestão incremental (backfill = 1ª passada; depois só o que é novo). Evidência: sha256 do arquivo local (streaming), `teto_arquivos` por passada ──
  let emCurso = null
  async function passada({ cliente = '', teto_arquivos = 500 } = {}) {
    const por = {}, conta = (t, n) => { if (n) por[t] = (por[t] || 0) + n }
    for (const f of FONTES) {
      const sql = `${f.sql} AND ${f.al}.cliente <> '' AND ltrim(${f.al}.cliente) NOT LIKE '[Comercial]%'${cliente ? ` AND ${f.al}.cliente = ?` : ''}
        AND NOT EXISTS (SELECT 1 FROM registro_cliente lv WHERE lv.tipo = '${f.tipo}' AND lv.ref = ${f.ref})`
      let linhas
      try { linhas = h.prepare(sql.replace(/^SELECT /, `SELECT ${f.ref} AS ref__, `)).all(...(f.args ? f.args(agora()) : []), ...(cliente ? [cliente] : [])) }
      catch (e) { if (/no such table/i.test(e.message)) continue; throw e }   // tabela de módulo que ainda não existe neste banco não derruba as outras fontes
      for (let i = 0; i < linhas.length; i += 2000)
        conta(f.tipo, registrarVarios(linhas.slice(i, i + 2000).map(r => ({ ...f.linha(r), cliente: r.cliente, tipo: f.tipo, ref: r.ref__ }))).filter(x => x.novo).length)
    }
    // anexos dos cards (prints): o arquivo local é a prova — o hash do conteúdo entra no livro; sem arquivo, a URL externa sem query (URL do Notion expira e leva token)
    const deEv = `FROM evidencias e JOIN tarefas t ON t.id = e.tarefa_id WHERE t.cliente <> '' AND ltrim(t.cliente) NOT LIKE '[Comercial]%'${cliente ? ' AND t.cliente = ?' : ''}
        AND NOT EXISTS (SELECT 1 FROM registro_cliente lv WHERE lv.tipo = 'anexo_tarefa' AND lv.ref = e.id)`
    const teto = Number.isFinite(teto_arquivos) && teto_arquivos > 0 ? Math.floor(teto_arquivos) : -1
    const evs = h.prepare(`SELECT e.id, e.tipo, e.url_origem, e.arquivo_local, e.legenda, e.criada_em, t.cliente, t.titulo ${deEv} ORDER BY e.rowid LIMIT ?`).all(...(cliente ? [cliente] : []), teto)
    const base = raiz ? resolve(raiz) : ''
    for (let i = 0; i < evs.length; i += 200) {
      const lote = []
      for (const e of evs.slice(i, i + 200)) {
        let prova = '', arquivo = ''
        const abs = base && e.arquivo_local ? resolve(base, e.arquivo_local) : ''
        if (abs && abs.startsWith(base + sep) && existsSync(abs)) { try { prova = `arquivo:${e.arquivo_local}#sha256:${await hashArquivo(abs)}`; arquivo = 'local' } catch { /* ilegível: cai na URL */ } }
        if (!prova) { const u = semQuery(e.url_origem); prova = /^https?:\/\//i.test(u) && !/amazonaws\.com|notion-static|notion\.so\/image|file\.notion\.so/i.test(u) ? `url:${u}` : ''; arquivo = prova ? 'url' : 'indisponivel' }
        lote.push({ cliente: e.cliente, tipo: 'anexo_tarefa', ref: e.id, fato_em: e.criada_em, prova,
          resumo: `Anexo (${e.tipo}) no card «${corta(e.titulo, 140)}»${e.legenda ? `: ${corta(e.legenda, 120)}` : ''}${arquivo === 'indisponivel' ? ' — arquivo não guardado localmente' : ''}`,
          dados: { evidencia_id: e.id, tipo: e.tipo, legenda: corta(e.legenda, 200), arquivo } })
      }
      conta('anexo_tarefa', registrarVarios(lote).filter(x => x.novo).length)
    }
    const restam = teto > 0 && evs.length === teto ? h.prepare(`SELECT COUNT(*) n ${deEv}`).get(...(cliente ? [cliente] : [])).n : 0
    return { total: Object.values(por).reduce((s, n) => s + n, 0), por_tipo: por, anexos_pendentes: restam }
  }
  // uma passada por vez no processo: o mesmo pedido em curso é reaproveitado (tick e sync se sobrepondo esperam a mesma); pedido diferente (a passada do cliente do
  // dossiê, com teto próprio) entra NA FILA depois da que está rodando — nunca pega carona numa passada global que pode não chegar aos anexos dele
  let chaveCurso = ''
  const ingerir = (opts = {}) => {
    const k = JSON.stringify([opts.cliente || '', opts.teto_arquivos ?? 500])
    if (emCurso && chaveCurso === k) return emCurso
    const p = (emCurso || Promise.resolve()).catch(() => {}).then(() => passada(opts)).finally(() => { if (emCurso === p) { emCurso = null; chaveCurso = '' } })
    emCurso = p; chaveCurso = k
    return p
  }

  // ── leitura ────────────────────────────────────────────────────────────────────────────────────
  const hidratar = r => ({ seq: r.seq, cliente: r.cliente, fato_em: r.fato_em, registrado_em: r.registrado_em, tipo: r.tipo, ref: r.ref, resumo: r.resumo,
    dados: (() => { try { return JSON.parse(r.dados_json) } catch { return {} } })(), prova: r.prova, hash: r.hash })
  const DIA = /^\d{4}-\d{2}-\d{2}$/
  // período pelo dia do FATO; fato sem data na fonte entra pelo dia em que foi registrado (e vem com fato_em '' — o relatório diz «sem data na fonte»)
  function listar({ cliente, de = '', ate = '', tipo = '', pagina = 1, por_pagina = 100 } = {}) {
    if (!cliente) throw erro('informe "cliente"')
    if ((de && !DIA.test(de)) || (ate && !DIA.test(ate)) || (de && ate && de > ate)) throw erro('período inválido (use AAAA-MM-DD, "de" antes de "ate")')
    if (tipo && !TIPOS_LIVRO.includes(tipo)) throw erro('tipo de registro inválido')
    const pg = Math.max(1, Math.floor(Number(pagina)) || 1), pp = Math.min(500, Math.max(1, Math.floor(Number(por_pagina)) || 100))
    const dia = "substr(CASE WHEN fato_em <> '' THEN fato_em ELSE registrado_em END, 1, 10)"
    const w = ['cliente = ?'], a = [cliente]
    if (de) { w.push(`${dia} >= ?`); a.push(de) }
    if (ate) { w.push(`${dia} <= ?`); a.push(ate) }
    if (tipo) { w.push('tipo = ?'); a.push(tipo) }
    const where = w.join(' AND ')
    const total = h.prepare(`SELECT COUNT(*) n FROM registro_cliente WHERE ${where}`).get(...a).n
    const itens = h.prepare(`SELECT * FROM registro_cliente WHERE ${where} ORDER BY ${dia}, seq LIMIT ? OFFSET ?`).all(...a, pp, (pg - 1) * pp).map(hidratar)
    const por_tipo = Object.fromEntries(h.prepare(`SELECT tipo, COUNT(*) n FROM registro_cliente WHERE ${where} GROUP BY tipo`).all(...a).map(r => [r.tipo, r.n]))
    return { cliente, de, ate, tipo, total, pagina: pg, por_pagina: pp, por_tipo, itens }
  }

  // recalcula a cadeia (de um cliente ou de todos) e aponta o 1º elo quebrado; lacunas = linhas que sumiram do contador global
  function verificarCadeia(cliente = '') {
    const it = h.prepare(`SELECT * FROM registro_cliente ${cliente ? 'WHERE cliente = ?' : ''} ORDER BY cliente, seq`).iterate(...(cliente ? [cliente] : []))
    let atual = null, ant = '', registros = 0, clientes = 0, quebra = null
    const cabecas = {}
    for (const r of it) {
      if (r.cliente !== atual) { atual = r.cliente; ant = ''; clientes++ }
      registros++
      if (!quebra) {
        if (r.hash_anterior !== ant) quebra = { cliente: r.cliente, seq: r.seq, motivo: 'elo', detalhe: 'hash_anterior não confere com a linha anterior do cliente (linha apagada ou inserida fora da ordem)' }
        else if (hashLinha(r.hash_anterior, r) !== r.hash) quebra = { cliente: r.cliente, seq: r.seq, motivo: 'conteudo', detalhe: 'conteúdo da linha não confere com o hash gravado (linha alterada)' }
      }
      ant = r.hash; cabecas[r.cliente] = { seq: r.seq, hash: r.hash }
    }
    const g = h.prepare('SELECT COUNT(*) n, MAX(seq) mx FROM registro_cliente').get()
    let contador = 0; try { contador = h.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'registro_cliente'").get()?.seq || 0 } catch { /* sem sqlite_sequence */ }
    const lacunas = Math.max(contador, g.mx || 0) - g.n
    return { ok: !quebra && lacunas === 0, cliente: cliente || null, clientes, registros, quebra, lacunas, cabeca: cliente ? cabecas[cliente] || null : undefined }
  }

  return { registrar, registrarVarios, ingerir, listar, verificarCadeia, tipos: TIPOS_LIVRO }
}
