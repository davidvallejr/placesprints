// Persistência do módulo "Promoções por cliente". Toda tabela tem `cliente` na chave: NUNCA misturar clientes.
// As tabelas são criadas no import (CREATE TABLE IF NOT EXISTS). Para testes, PS_PROMO_MEMORIA=1 troca o banco
// real por um banco em memória (o autoteste nunca toca data/db.sqlite).
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { parseStatusRegra, marcaHumanaViva } from './promocoes-mc.js'
import { SCHEMA_CUSTO_VINCULO } from './custo-vinculo.js'
import { SCHEMA_MUDANCA } from './acomp-schema.js'
import { estadoPromocao, diffPromocao, tipoPromocao, SEM_PROMOCAO } from './estado-anuncio.js'

export const EM_MEMORIA = process.env.PS_PROMO_MEMORIA === '1'
// ponytail: import dinâmico só p/ não abrir o banco real quando em memória (top-level await, Node 22)
export const db = EM_MEMORIA ? new Database(':memory:') : (await import('./db.js')).db

export const agora = () => new Date().toISOString()
export const hojeLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status })
const json = (s, padrao) => { try { return s ? JSON.parse(s) : padrao } catch { return padrao } }

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS promo_config (          -- config por cliente; execução SEMPRE nasce desligada
  cliente TEXT PRIMARY KEY,
  piso_mc REAL NOT NULL DEFAULT 20, piso_relampago REAL NOT NULL DEFAULT 19, imposto_pct REAL,
  dias_vigia INTEGER NOT NULL DEFAULT 7, janela_cobertura_dias INTEGER NOT NULL DEFAULT 3, hedge_cobertura INTEGER NOT NULL DEFAULT 1,
  execucao_habilitada INTEGER NOT NULL DEFAULT 0, execucao_max_itens INTEGER NOT NULL DEFAULT 1,
  atualizado_em TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS promo_coleta (          -- carimbo e resultado da última coleta (frescor de 12h)
  cliente TEXT PRIMARY KEY, coleta_id TEXT NOT NULL, estado TEXT NOT NULL, iniciada_em TEXT NOT NULL, concluida_em TEXT NOT NULL DEFAULT '',
  resumo_json TEXT NOT NULL DEFAULT '{}', limites_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS promo_campanha (
  cliente TEXT NOT NULL, pid TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT '', subtipo TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '', inicio TEXT NOT NULL DEFAULT '', fim TEXT NOT NULL DEFAULT '', prazo TEXT NOT NULL DEFAULT '',
  rebate INTEGER NOT NULL DEFAULT 0, relampago INTEGER NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'listagem',          -- listagem | item (vista só na oferta do anúncio: a listagem a escondia)
  coleta_id TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, pid)
);
CREATE TABLE IF NOT EXISTS promo_oferta (          -- ofertas por anúncio (item × campanha × oferta)
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, pid TEXT NOT NULL, offer_id TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT '', subtipo TEXT NOT NULL DEFAULT '', nome TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
  preco REAL, preco_original REAL, meli_pct REAL, seller_pct REAL, inicio TEXT NOT NULL DEFAULT '', fim TEXT NOT NULL DEFAULT '',
  min_preco REAL, max_preco REAL, sugerido REAL, fonte TEXT NOT NULL DEFAULT 'item',
  coleta_id TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id, pid, offer_id)
);
CREATE INDEX IF NOT EXISTS ix_promo_oferta_item ON promo_oferta (cliente, item_id);
CREATE TABLE IF NOT EXISTS promo_anuncio (
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, sku TEXT COLLATE NOCASE NOT NULL DEFAULT '', sku_fonte TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL DEFAULT '', permalink TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', sub_status TEXT NOT NULL DEFAULT '',
  under_review INTEGER NOT NULL DEFAULT 0, preco REAL, preco_original REAL, estoque INTEGER, categoria TEXT NOT NULL DEFAULT '',
  tipo_anuncio TEXT NOT NULL DEFAULT '', catalogo INTEGER NOT NULL DEFAULT 0, user_product_id TEXT NOT NULL DEFAULT '',
  protegido INTEGER NOT NULL DEFAULT 0, fat30 REAL NOT NULL DEFAULT 0, unid30 INTEGER NOT NULL DEFAULT 0, curva TEXT NOT NULL DEFAULT '',
  tarifa_json TEXT NOT NULL DEFAULT '', tarifa_estado TEXT NOT NULL DEFAULT '',
  lido_em TEXT NOT NULL DEFAULT '', oferta_erro TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, item_id)
);
CREATE INDEX IF NOT EXISTS ix_promo_anuncio_sku ON promo_anuncio (cliente, sku);
CREATE TABLE IF NOT EXISTS promo_decisao (         -- anúncio × campanha escolhida; pid '' = "sem marca" (motivo declarado)
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, pid TEXT NOT NULL DEFAULT '', origem TEXT NOT NULL,     -- analista | humano
  marcado INTEGER NOT NULL DEFAULT 0, regra TEXT NOT NULL DEFAULT '',                                  -- R1 | R2 | R1C | HEDGE | LIVRE | PISO_SKU | RELAMPAGO | SEM_MARCA
  motivo TEXT NOT NULL DEFAULT '', obs TEXT NOT NULL DEFAULT '', via TEXT NOT NULL DEFAULT 'api',      -- api | painel
  offer_id TEXT NOT NULL DEFAULT '', preco REAL, meli_pct REAL, mc REAL, mc_pct REAL, outras_json TEXT NOT NULL DEFAULT '[]',
  ordem_direta INTEGER NOT NULL DEFAULT 0, aprovado INTEGER NOT NULL DEFAULT 0, aprovado_por TEXT NOT NULL DEFAULT '', aprovado_em TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'ativa', rodada_id TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id, pid, origem)
);
CREATE TABLE IF NOT EXISTS promo_alerta (          -- vigias persistidos (read-back do invariante lê daqui)
  cliente TEXT NOT NULL, tipo TEXT NOT NULL, chave TEXT NOT NULL, item_id TEXT NOT NULL DEFAULT '',
  severidade TEXT NOT NULL DEFAULT '', detalhe_json TEXT NOT NULL DEFAULT '{}', rodada_id TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, tipo, chave)
);
CREATE TABLE IF NOT EXISTS promo_regras_sku (      -- exceções de piso do dono (Livre | N% | Revisar toda rodada)
  cliente TEXT NOT NULL, mlb TEXT COLLATE NOCASE NOT NULL DEFAULT '', sku TEXT COLLATE NOCASE NOT NULL DEFAULT '',
  status TEXT NOT NULL, nota TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, mlb, sku)
);
CREATE TABLE IF NOT EXISTS promo_custos_sku (
  cliente TEXT NOT NULL, sku TEXT COLLATE NOCASE NOT NULL, custo REAL NOT NULL, fonte TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, sku)
);
CREATE TABLE IF NOT EXISTS promo_plano (
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'dry-run',     -- dry-run | aprovado | executando | executado | executado_parcial | erro | cancelado
  criado_em TEXT NOT NULL, expira_em TEXT NOT NULL, gerado_por TEXT NOT NULL DEFAULT '',
  aprovado_por TEXT NOT NULL DEFAULT '', aprovado_em TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '',
  itens_json TEXT NOT NULL DEFAULT '[]', resumo_json TEXT NOT NULL DEFAULT '{}', resultado_json TEXT NOT NULL DEFAULT '', executado_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_promo_plano_cliente ON promo_plano (cliente, criado_em);
CREATE TABLE IF NOT EXISTS promo_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, em TEXT NOT NULL, evento TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '', pid TEXT NOT NULL DEFAULT '', autor TEXT NOT NULL DEFAULT '',
  antes_json TEXT NOT NULL DEFAULT '', depois_json TEXT NOT NULL DEFAULT '', detalhe TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_promo_auditoria ON promo_auditoria (cliente, em);
CREATE TABLE IF NOT EXISTS promo_snapshot (        -- foto da rodada p/ achar campanha derrubada antes do prazo
  cliente TEXT NOT NULL, rodada_id TEXT NOT NULL, em TEXT NOT NULL, dados_json TEXT NOT NULL,
  PRIMARY KEY (cliente, rodada_id)
);
CREATE TABLE IF NOT EXISTS promo_aprendizados (    -- respostas do interrogatório (equivalente ao aprendizados.md)
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, em TEXT NOT NULL, por TEXT NOT NULL DEFAULT '',
  padrao TEXT NOT NULL DEFAULT '', escopo_tipo TEXT NOT NULL DEFAULT 'global', escopo_valor TEXT NOT NULL DEFAULT '',
  contexto TEXT NOT NULL DEFAULT '', resposta TEXT NOT NULL DEFAULT '', regra_destilada TEXT NOT NULL DEFAULT '',
  acao TEXT NOT NULL DEFAULT 'nota', parametro TEXT NOT NULL DEFAULT '', ativo INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_promo_aprend ON promo_aprendizados (cliente, ativo);

-- ── custos por SKU vindos de ERP/planilha (spec docs/integracao-custos-erp-SPEC.md §4; regras em custos-db.js) ──
-- Custo VIGENTE por fonte externa. Manual continua em promo_custos_sku (camada 'manual', leitura direta).
CREATE TABLE IF NOT EXISTS erp_custos_sku (
  cliente TEXT NOT NULL, sku_key TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny','sheets','upload')),
  sku TEXT NOT NULL, custo REAL NOT NULL CHECK (custo > 0 AND custo <= 10000000), custo_txt TEXT NOT NULL, moeda TEXT NOT NULL DEFAULT 'BRL',
  campo TEXT NOT NULL DEFAULT '', id_externo TEXT NOT NULL DEFAULT '', mlb_dica TEXT NOT NULL DEFAULT '', atualizado_na_fonte TEXT NOT NULL DEFAULT '',
  recebido_em TEXT NOT NULL, visto_em TEXT NOT NULL, nao_visto_desde TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL, lote_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, sku_key, fonte)
);
CREATE INDEX IF NOT EXISTS ix_erp_custos_idext ON erp_custos_sku (cliente, fonte, id_externo);
CREATE TABLE IF NOT EXISTS erp_custos_hist (       -- toda mudança de vigente, quarentena, decisão e ajuste manual (fonte inclui 'manual')
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, sku_key TEXT NOT NULL, sku TEXT NOT NULL, fonte TEXT NOT NULL,
  evento TEXT NOT NULL,                             -- novo | alterado | quarentena | aprovado | recusado | descartado | manual
  custo_antes REAL, custo_depois REAL, variacao_pct REAL,
  campo TEXT NOT NULL DEFAULT '', lote_id TEXT NOT NULL DEFAULT '', atualizado_na_fonte TEXT NOT NULL DEFAULT '',
  em TEXT NOT NULL, por TEXT NOT NULL DEFAULT '', detalhe TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_erp_hist ON erp_custos_hist (cliente, sku_key, id);
CREATE TABLE IF NOT EXISTS erp_quarentena (        -- valor proposto que NÃO substitui o vigente até o dono aprovar
  cliente TEXT NOT NULL, sku_key TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny','sheets','upload')),
  sku TEXT NOT NULL, motivo TEXT NOT NULL,          -- variacao_brusca | custo_ge_preco | kit_divergente
  custo_proposto REAL NOT NULL CHECK (custo_proposto > 0), custo_txt TEXT NOT NULL,
  campo TEXT NOT NULL DEFAULT '', id_externo TEXT NOT NULL DEFAULT '', mlb_dica TEXT NOT NULL DEFAULT '', atualizado_na_fonte TEXT NOT NULL DEFAULT '',
  custo_vigente REAL, variacao_pct REAL, preco_ref REAL,
  estado TEXT NOT NULL DEFAULT 'pendente',          -- pendente | recusada (recusada guarda o valor p/ não reabrir a mesma quarentena a cada sync)
  recebido_em TEXT NOT NULL, lote_id TEXT NOT NULL DEFAULT '', decidido_por TEXT NOT NULL DEFAULT '', decidido_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, sku_key, fonte)
);
CREATE TABLE IF NOT EXISTS erp_rejeitadas (        -- última lista de linhas rejeitadas por (cliente, fonte)
  cliente TEXT NOT NULL, fonte TEXT NOT NULL,
  chave TEXT NOT NULL,                              -- 'sku:<sku_key>' | 'id:<id_externo>' | 'mlb:<MLB>' | 'linha:<n>'
  sku TEXT NOT NULL DEFAULT '', mlb TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL, motivo TEXT NOT NULL,
  custo_txt TEXT NOT NULL DEFAULT '', custo_mantido REAL, linha TEXT NOT NULL DEFAULT '', lote_id TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte, chave)
);
CREATE TABLE IF NOT EXISTS erp_cliente_cfg (       -- defaults = decisões do dono (spec §13)
  cliente TEXT PRIMARY KEY,
  ordem_fontes TEXT NOT NULL DEFAULT '["manual","upload","bling","tiny","sheets"]',
  limiar_variacao_pct REAL NOT NULL DEFAULT 50, quarentena_custo_ge_preco INTEGER NOT NULL DEFAULT 1,
  campo_custo_tiny TEXT NOT NULL DEFAULT 'preco_custo', velho_dias_erp INTEGER NOT NULL DEFAULT 3, velho_dias_sheets INTEGER NOT NULL DEFAULT 14,
  atualizado_em TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS erp_fontes (            -- estado de cada fonte por cliente (sem segredos)
  cliente TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny','sheets')),
  estado TEXT NOT NULL DEFAULT 'desconectado',      -- desconectado | conectado | erro | reautorizar | pausado
  ultimo_sync_em TEXT NOT NULL DEFAULT '', ultimo_sync_ok_em TEXT NOT NULL DEFAULT '',
  ultimo_resumo_json TEXT NOT NULL DEFAULT '{}', ultimo_erro TEXT NOT NULL DEFAULT '',
  sync_estado TEXT NOT NULL DEFAULT '', sync_iniciada_em TEXT NOT NULL DEFAULT '',
  tentativas_dia INTEGER NOT NULL DEFAULT 0, tentativas_dia_data TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte)
);
CREATE TABLE IF NOT EXISTS erp_webhooks (          -- URL opaca + segredo (cifrado) por cliente/fonte (M2)
  wid TEXT PRIMARY KEY, cliente TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('sheets','bling')),
  segredo_cifrado TEXT NOT NULL DEFAULT '', segredo_anterior_cifrado TEXT NOT NULL DEFAULT '', anterior_expira_em TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL, rotacionado_em TEXT NOT NULL DEFAULT '', ultimo_uso_em TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_webhooks_cf ON erp_webhooks (cliente, fonte);
CREATE TABLE IF NOT EXISTS erp_credenciais (       -- OAuth (M6); cliente '*' = aplicativo GLOBAL da Place2u. Tudo cifrado
  cliente TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny')),
  modo_app TEXT NOT NULL DEFAULT 'proprio',
  client_id TEXT NOT NULL DEFAULT '', client_secret_cifrado TEXT NOT NULL DEFAULT '',
  access_token_cifrado TEXT NOT NULL DEFAULT '', refresh_token_cifrado TEXT NOT NULL DEFAULT '',
  expira_em TEXT NOT NULL DEFAULT '', refresh_emitido_em TEXT NOT NULL DEFAULT '',
  escopos TEXT NOT NULL DEFAULT '', company_id TEXT NOT NULL DEFAULT '',
  conectado_em TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL DEFAULT '', erro TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, fonte)
);
CREATE TABLE IF NOT EXISTS erp_lotes (             -- idempotência do webhook por lote (M2)
  cliente TEXT NOT NULL, fonte TEXT NOT NULL, lote_id TEXT NOT NULL,
  sync_id TEXT NOT NULL DEFAULT '', lote_n INTEGER NOT NULL DEFAULT 1, lote_total INTEGER NOT NULL DEFAULT 1,
  corpo_hash TEXT NOT NULL, resumo_json TEXT NOT NULL, recebido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte, lote_id)
);
CREATE INDEX IF NOT EXISTS ix_erp_lotes_sync ON erp_lotes (cliente, fonte, sync_id);
CREATE TABLE IF NOT EXISTS erp_fila (              -- gatilhos (Bling product_supplier) e detalhes pendentes (M7), coalescida por produto
  cliente TEXT NOT NULL, fonte TEXT NOT NULL, id_externo TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT 'gatilho', enfileirado_em TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, proxima_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, fonte, id_externo)
);
CREATE TABLE IF NOT EXISTS erp_eventos_vistos (    -- dedupe por eventId do Bling; poda > 7 dias
  fonte TEXT NOT NULL, evento_id TEXT NOT NULL, em TEXT NOT NULL, PRIMARY KEY (fonte, evento_id)
);
CREATE TABLE IF NOT EXISTS erp_oauth_state (       -- state de uso único do OAuth (M6); poda > 1 dia
  nonce TEXT PRIMARY KEY, cliente TEXT NOT NULL, fonte TEXT NOT NULL, criado_em TEXT NOT NULL, usado_em TEXT NOT NULL DEFAULT ''
);
${SCHEMA_CUSTO_VINCULO}`
// SCHEMA_MUDANCA: change-log do anúncio onde a coleta grava o estado de promoção (no banco real é IF NOT EXISTS — db.js já criou/migrou; no :memory: dos testes nasce aqui)
export const criarSchema = dbx => { dbx.exec(SCHEMA); dbx.exec(SCHEMA_MUDANCA) }
criarSchema(db)
// Migração aditiva e idempotente (o banco real já tem as tabelas; CREATE TABLE IF NOT EXISTS não acrescenta coluna): confere o schema antes do ALTER
const garantirColunaPromo = (tabela, coluna, def) => { if (!db.prepare(`PRAGMA table_info(${tabela})`).all().some(c => c.name === coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${def}`) }
garantirColunaPromo('promo_decisao', 'ancora', "TEXT NOT NULL DEFAULT ''")          // HEDGE do analista: pid da campanha-âncora (o hedge morre com ela)
garantirColunaPromo('promo_plano', 'executando_em', "TEXT NOT NULL DEFAULT ''")      // último sinal de vida da execução (claim e cada POST): plano 'executando' parado é recuperável
garantirColunaPromo('promo_coleta', 'meli_user_id', "TEXT NOT NULL DEFAULT ''")      // conta ML em que a coleta começou: escrita longa (coleta, plano) só grava se ainda for a mesma
// fonte 'upload' (planilha subida na tela, 15/10/2026 — src/lib/custos-upload.js): o CHECK antigo de erp_custos_sku/erp_quarentena não a aceita e o SQLite não altera CHECK.
// Reconstrói a tabela com o MESMO sql (só o CHECK muda) numa transação; idempotente (já tem 'upload' = nada a fazer). Índices recriados pelo SCHEMA.
for (const t of ['erp_custos_sku', 'erp_quarentena']) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)?.sql || ''
  if (!sql || sql.includes("'upload'")) continue
  db.transaction(() => {
    db.exec(sql.replace("CHECK (fonte IN ('bling','tiny','sheets'))", "CHECK (fonte IN ('bling','tiny','sheets','upload'))").replace(/^CREATE TABLE (IF NOT EXISTS )?"?\w+"?/, `CREATE TABLE ${t}__novo`))
    db.exec(`INSERT INTO ${t}__novo SELECT * FROM ${t}; DROP TABLE ${t}; ALTER TABLE ${t}__novo RENAME TO ${t}`)
  })()
  db.exec(SCHEMA)
}

const CONFIG_PADRAO = { piso_mc: 20, piso_relampago: 19, imposto_pct: null, dias_vigia: 7, janela_cobertura_dias: 3, hedge_cobertura: 1, execucao_habilitada: 0, execucao_max_itens: 1 }

// ── auditoria ────────────────────────────────────────────────────────────────
export function auditar(cliente, evento, { item_id = '', pid = '', autor = '', antes = null, depois = null, detalhe = '' } = {}) {
  db.prepare('INSERT INTO promo_auditoria (cliente, em, evento, item_id, pid, autor, antes_json, depois_json, detalhe) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(cliente, agora(), evento, item_id, pid, String(autor).slice(0, 80), antes == null ? '' : JSON.stringify(antes), depois == null ? '' : JSON.stringify(depois), String(detalhe).slice(0, 2000))
}
export function listarAuditoria(cliente, { limite = 200, evento = '', item_id = '' } = {}) {
  const lim = Math.min(1000, Math.max(1, Math.trunc(Number(limite)) || 200))
  return db.prepare(`SELECT * FROM promo_auditoria WHERE cliente = @cliente AND (@evento = '' OR evento = @evento) AND (@item_id = '' OR item_id = @item_id)
    ORDER BY id DESC LIMIT ${lim}`).all({ cliente, evento: String(evento), item_id: String(item_id) })
    .map(r => ({ ...r, antes: json(r.antes_json, null), depois: json(r.depois_json, null) }))
}

// ── config por cliente ───────────────────────────────────────────────────────
export function getConfig(cliente) {
  const r = db.prepare('SELECT * FROM promo_config WHERE cliente = ?').get(cliente)
  return { ...CONFIG_PADRAO, ...(r || {}), cliente, execucao_habilitada: r?.execucao_habilitada ? 1 : 0 }
}
const LIMITES = {
  piso_mc: [0, 100], piso_relampago: [0, 100], imposto_pct: [0, 60, true], dias_vigia: [1, 60, false, true], janela_cobertura_dias: [0, 30, false, true],
  hedge_cobertura: [0, 1, false, true], execucao_habilitada: [0, 1, false, true], execucao_max_itens: [1, 500, false, true],
}
// Tipo estrito: só número, string numérica ("12" / "12,5" — vem de <input>) ou, nas chaves liga/desliga, booleano. false/[]/true/[5]/{}
// NUNCA viram número por coerção (imposto_pct:false não pode virar 0% — com imposto 0 a MC sai inflada em vez de pendência).
const FLAGS = new Set(['hedge_cobertura', 'execucao_habilitada'])
const numeroConfig = (k, v) => typeof v === 'number' ? v
  : typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.'))
  : FLAGS.has(k) && typeof v === 'boolean' ? Number(v) : NaN
export function setConfig(cliente, patch, por = '') {
  const antes = getConfig(cliente), novo = { ...antes }
  for (const [k, v] of Object.entries(patch || {})) {
    const lim = LIMITES[k]
    if (!lim) throw erro(`campo de configuração desconhecido: ${k}`)
    if (v === null || v === '') { if (!lim[2]) throw erro(`${k} não aceita vazio`); novo[k] = null; continue }
    const n = numeroConfig(k, v)
    if (!Number.isFinite(n) || n < lim[0] || n > lim[1] || (lim[3] && !Number.isInteger(n))) throw erro(`${k} inválido (${lim[0]} a ${lim[1]}${lim[3] ? ', inteiro' : ''}; envie um número)`)
    novo[k] = n
  }
  db.prepare(`INSERT INTO promo_config (cliente, piso_mc, piso_relampago, imposto_pct, dias_vigia, janela_cobertura_dias, hedge_cobertura, execucao_habilitada, execucao_max_itens, atualizado_em, por)
    VALUES (@cliente,@piso_mc,@piso_relampago,@imposto_pct,@dias_vigia,@janela_cobertura_dias,@hedge_cobertura,@execucao_habilitada,@execucao_max_itens,@em,@por)
    ON CONFLICT(cliente) DO UPDATE SET piso_mc=@piso_mc, piso_relampago=@piso_relampago, imposto_pct=@imposto_pct, dias_vigia=@dias_vigia,
      janela_cobertura_dias=@janela_cobertura_dias, hedge_cobertura=@hedge_cobertura, execucao_habilitada=@execucao_habilitada,
      execucao_max_itens=@execucao_max_itens, atualizado_em=@em, por=@por`).run({ ...novo, cliente, em: agora(), por: String(por).slice(0, 80) })
  const depois = getConfig(cliente)
  auditar(cliente, 'config', { autor: por, antes, depois, detalhe: Object.keys(patch || {}).join(', ') })
  return depois
}

// ── coleta: carimbo, frescor, gravação atômica ───────────────────────────────
export const lerColeta = cliente => {
  const r = db.prepare('SELECT * FROM promo_coleta WHERE cliente = ?').get(cliente)
  return r ? { ...r, resumo: json(r.resumo_json, {}), limites: json(r.limites_json, []) } : null
}
export function coletaFresca(cliente, horas = 12, agoraMs = Date.now()) {
  const c = lerColeta(cliente)
  if (!c || c.estado !== 'concluida' || !c.concluida_em) return { fresca: false, motivo: c ? (c.estado === 'concluida' ? 'sem carimbo' : c.estado === 'parcial' ? `última coleta PARCIAL (${c.resumo?.leituras_falhas ?? '?'} leitura(s) essencial(is) falharam) — refaça a coleta` : `última coleta: ${c.estado}`) : 'nenhuma coleta feita', idade_horas: null, concluida_em: c?.concluida_em || null }
  const idade = (agoraMs - new Date(c.concluida_em).getTime()) / 3600e3
  return { fresca: idade <= horas, idade_horas: Math.round(idade * 10) / 10, motivo: idade <= horas ? '' : `coleta com ${Math.round(idade)}h (limite ${horas}h)`, concluida_em: c.concluida_em }
}
// o carimbo é de QUEM começou por último: uma coleta anterior ainda rodando perde a posse e é descartada ao gravar (gravarColeta) — nunca mistura duas
export const iniciarColeta = (cliente, coletaId, meliUserId = '') =>
  db.prepare(`INSERT INTO promo_coleta (cliente, coleta_id, estado, iniciada_em, meli_user_id) VALUES (?,?,?,?,?)
    ON CONFLICT(cliente) DO UPDATE SET coleta_id=excluded.coleta_id, estado='rodando', iniciada_em=excluded.iniciada_em, meli_user_id=excluded.meli_user_id`).run(cliente, coletaId, 'rodando', agora(), String(meliUserId ?? ''))
export const falharColeta = (cliente, coletaId, msg, limites = []) =>
  db.prepare("UPDATE promo_coleta SET estado='erro', resumo_json=?, limites_json=? WHERE cliente=? AND coleta_id=?").run(JSON.stringify({ erro: String(msg).slice(0, 300) }), JSON.stringify(limites), cliente, coletaId)

const upCamp = db.prepare(`INSERT OR REPLACE INTO promo_campanha (cliente, pid, tipo, subtipo, nome, status, inicio, fim, prazo, rebate, relampago, origem, coleta_id, atualizado_em)
  VALUES (@cliente,@pid,@tipo,@subtipo,@nome,@status,@inicio,@fim,@prazo,@rebate,@relampago,@origem,@coleta_id,@em)`)
// Oferta sem ref_id/offer_id: a PK (cliente,item,pid,offer_id) colidia (2 PRICE_DISCOUNT do mesmo anúncio viravam 1 e a started sumia).
// Guardamos uma chave sintética estável (tipo+status+preço+período) na coluna offer_id; lerOfertas devolve offer_id real ('' = sem id do ML) + `chave`.
export const PREFIXO_SEM_REF = 'SEM-REF:'
const chaveOferta = o => o.offer_id || PREFIXO_SEM_REF + createHash('sha1').update([o.tipo, o.subtipo, o.status, o.preco, o.preco_original, o.inicio, o.fim, o.nome].map(v => v ?? '').join('|')).digest('hex').slice(0, 12)
// DO NOTHING (e não REPLACE): se ainda assim houver colisão, vale a primeira — e as ofertas entram started → pending → resto (a participação ativa nunca é apagada)
const upOf = db.prepare(`INSERT INTO promo_oferta (cliente, item_id, pid, offer_id, tipo, subtipo, nome, status, preco, preco_original, meli_pct, seller_pct, inicio, fim, min_preco, max_preco, sugerido, fonte, coleta_id, atualizado_em)
  VALUES (@cliente,@item_id,@pid,@offer_id,@tipo,@subtipo,@nome,@status,@preco,@preco_original,@meli_pct,@seller_pct,@inicio,@fim,@min_preco,@max_preco,@sugerido,@fonte,@coleta_id,@em)
  ON CONFLICT(cliente, item_id, pid, offer_id) DO NOTHING`)
const rankOferta = o => (o.status === 'started' ? 0 : o.status === 'pending' ? 1 : 2)
// estado de promoção no change-log do anúncio (meli_item_mudanca, campo 'promocao', fonte 'promo'): só anúncio lido NESTA coleta e já lido na anterior;
// evento ao cruzar 'nenhuma' ou mudar o tipo (estado-anuncio.js). 2ª coleta no MESMO dia junta na linha do dia (guarda o "de" da 1ª e o "para" desta;
// voltou ao tipo inicial = apaga a linha) — as 3 consultas de gravarDoDia (preco-historico.js) repetidas aqui porque este módulo não importa db.js.
const lidosAntesSql = db.prepare("SELECT item_id FROM promo_anuncio WHERE cliente = ? AND lido_em <> ''")
const startedAntesSql = db.prepare("SELECT item_id, tipo, status, preco, preco_original FROM promo_oferta WHERE cliente = ? AND status = 'started'")
const insEstadoPromo = db.prepare("INSERT OR IGNORE INTO meli_item_mudanca (cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em) VALUES (?,?,?,'promocao',?,?,NULL,'promo',?)")
const evPromoDoDia = db.prepare("SELECT id, de FROM meli_item_mudanca WHERE cliente = ? AND item_id = ? AND dia = ? AND campo = 'promocao' AND fonte = 'promo'")
const juntarEvPromo = db.prepare('UPDATE meli_item_mudanca SET para = ?, em = ? WHERE id = ?'), apagarEvPromo = db.prepare('DELETE FROM meli_item_mudanca WHERE id = ?')
const gravarEstadoPromo = (cliente, ev, dia, em) => {
  const ja = evPromoDoDia.get(cliente, ev.item_id, dia)
  if (!ja) return insEstadoPromo.run(cliente, ev.item_id, dia, ev.de, ev.para, em)
  tipoPromocao(ja.de) === tipoPromocao(ev.para) ? apagarEvPromo.run(ja.id) : juntarEvPromo.run(ev.para, em, ja.id)
}
const estadoPorItem = ofertas => { const m = new Map(); for (const o of ofertas) (m.get(o.item_id) || m.set(o.item_id, []).get(o.item_id)).push(o); for (const [k, v] of m) m.set(k, estadoPromocao(v)); return m }
// fat30 = faturamento 30d que a coleta leu (null = não veio: mantém o gravado); protegido/curva ficam
const upAn = db.prepare(`INSERT INTO promo_anuncio (cliente, item_id, sku, sku_fonte, titulo, permalink, status, sub_status, under_review, preco, preco_original, estoque, categoria, tipo_anuncio, catalogo, user_product_id, fat30, tarifa_json, tarifa_estado, lido_em, oferta_erro, atualizado_em)
  VALUES (@cliente,@item_id,@sku,@sku_fonte,@titulo,@permalink,@status,@sub_status,@under_review,@preco,@preco_original,@estoque,@categoria,@tipo_anuncio,@catalogo,@user_product_id,COALESCE(@fat30, 0),@tarifa_json,@tarifa_estado,@lido_em,@oferta_erro,@em)
  ON CONFLICT(cliente, item_id) DO UPDATE SET sku=@sku, sku_fonte=@sku_fonte, titulo=@titulo, permalink=@permalink, status=@status, sub_status=@sub_status,
    under_review=@under_review, preco=@preco, preco_original=@preco_original, estoque=@estoque, categoria=@categoria, tipo_anuncio=@tipo_anuncio,
    catalogo=@catalogo, user_product_id=@user_product_id, fat30=COALESCE(@fat30, fat30), tarifa_json=@tarifa_json, tarifa_estado=@tarifa_estado,
    lido_em=CASE WHEN @lido_em = '' THEN lido_em ELSE @lido_em END, oferta_erro=@oferta_erro, atualizado_em=@em`)

// Campanhas = substituídas por inteiro (sumir da lista É o sinal) — mas SÓ se a listagem veio inteira; lista parcial não apaga as páginas perdidas.
// Ofertas = só dos anúncios lidos OK ou que saíram do universo. Anúncio `sem_detalhe` (multiget falhou) NUNCA é regravado vazio: mantém a linha
// anterior (só registra o erro) e, se nunca foi lido, nem entra (status desconhecido não pode virar elegível).
// estado: 'concluida' só se tudo essencial foi lido; qualquer outro valor grava 'parcial' (nunca fresca para o analista).
// Posse: o carimbo é tomado PRIMEIRO, dentro da transação — só a coleta corrente (mesmo coleta_id, ainda 'rodando', mesma conta ML) grava; senão nada é gravado (rollback)
export function gravarColeta(cliente, { coletaId, campanhas, anuncios, ofertasPorItem, resumo, limites, estado = 'concluida', listagemCompleta = true, meliUserId = '' }) {
  const em = agora()
  db.transaction(() => {
    const dona = db.prepare(`UPDATE promo_coleta SET estado=?, concluida_em=?, resumo_json=?, limites_json=? WHERE cliente=? AND coleta_id=? AND estado='rodando' AND meli_user_id=?`)
      .run(estado === 'concluida' ? 'concluida' : 'parcial', em, JSON.stringify(resumo || {}), JSON.stringify(limites || []), cliente, coletaId, String(meliUserId ?? ''))
    if (dona.changes !== 1) {
      const c = lerColeta(cliente)
      throw Object.assign(erro(`coleta descartada: ${!c ? 'a conta do Mercado Livre foi trocada ou desconectada durante a coleta (o derivado da conta antiga foi limpo)' : c.coleta_id !== coletaId ? 'outra coleta deste cliente começou depois desta (vale a mais nova)'
        : c.meli_user_id !== String(meliUserId ?? '') ? 'a conta do Mercado Livre mudou durante a coleta' : `o carimbo desta coleta já está "${c.estado}"`} — nada foi gravado; colete de novo`, 409), { descartada: true })
    }
    if (listagemCompleta) db.prepare('DELETE FROM promo_campanha WHERE cliente = ?').run(cliente)
    for (const c of campanhas) upCamp.run({ tipo: '', subtipo: '', nome: '', status: '', inicio: '', fim: '', prazo: '', rebate: 0, relampago: 0, origem: 'listagem', cliente, ...c, coleta_id: coletaId, em })
    const universo = new Set(anuncios.map(a => a.item_id))
    const existentes = new Set(db.prepare('SELECT item_id FROM promo_anuncio WHERE cliente = ?').all(cliente).map(r => r.item_id))
    const semLinha = new Set(anuncios.filter(a => a.sem_detalhe && !existentes.has(a.item_id)).map(a => a.item_id))
    // Anúncio que a coleta CONCLUÍDA deliberadamente não leu as ofertas (closed/inactive/under_review lidos, ou sem leitura permanente) NÃO pode manter started/candidate
    // congeladas contando como participando/elegível: as ofertas dele saem (a foto da rodada vem de ofertasPorItem, então isso vira "saiu da coleta", nunca "derrubada").
    // Falha TRANSITÓRIA de ofertas continua mantendo a leitura anterior (coleta PARCIAL, cobertura DESCONHECIDA declarada).
    const semOfertasVivas = new Set(anuncios.filter(a => a.sem_leitura || a.under_review || ['closed', 'inactive', 'under_review'].includes(a.status)).map(a => a.item_id))
    // estado de promoção ANTES da troca (lidos na coleta anterior + started gravadas): o diff vem depois do upsert
    const lidosAntes = new Set(lidosAntesSql.all(cliente).map(r => r.item_id)), estadoAntes = estadoPorItem(startedAntesSql.all(cliente))
    const estadoDepois = new Map()
    for (const { item_id } of db.prepare('SELECT DISTINCT item_id FROM promo_oferta WHERE cliente = ?').all(cliente))
      if (ofertasPorItem.has(item_id) || !universo.has(item_id) || semOfertasVivas.has(item_id)) {
        db.prepare('DELETE FROM promo_oferta WHERE cliente = ? AND item_id = ?').run(cliente, item_id)
        if (!ofertasPorItem.has(item_id) && lidosAntes.has(item_id)) estadoDepois.set(item_id, SEM_PROMOCAO)   // saiu do universo ou virou closed/inactive/under_review: a promoção acabou (0 started gravadas)
      }
    for (const [item_id, ofertas] of ofertasPorItem) {
      if (semLinha.has(item_id)) continue
      for (const o of [...ofertas].sort((x, y) => rankOferta(x) - rankOferta(y))) upOf.run({ cliente, item_id, fonte: 'item', ...o, offer_id: chaveOferta(o), coleta_id: coletaId, em })
      estadoDepois.set(item_id, estadoPromocao(ofertas))
    }
    const dia = hojeLocal()
    for (const ev of diffPromocao(estadoAntes, estadoDepois, lidosAntes)) gravarEstadoPromo(cliente, ev, dia, em)
    for (const a of anuncios) {
      const lido_em = ofertasPorItem.has(a.item_id) ? em : ''
      if (semLinha.has(a.item_id)) continue
      if (a.sem_detalhe) db.prepare("UPDATE promo_anuncio SET oferta_erro=?, lido_em=CASE WHEN ? = '' THEN lido_em ELSE ? END WHERE cliente=? AND item_id=?").run(a.oferta_erro, lido_em, lido_em, cliente, a.item_id)
      else upAn.run({ fat30: null, cliente, ...a, lido_em, em })
    }
  })()
}

export const lerCampanhas = cliente => db.prepare('SELECT * FROM promo_campanha WHERE cliente = ?').all(cliente).map(c => ({ ...c, rebate: !!c.rebate, relampago: !!c.relampago }))
export const lerAnuncios = cliente => db.prepare('SELECT * FROM promo_anuncio WHERE cliente = ?').all(cliente)
  .map(a => ({ ...a, under_review: !!a.under_review, protegido: !!a.protegido, catalogo: !!a.catalogo, tarifa: json(a.tarifa_json, null) }))
export const lerOfertas = cliente => db.prepare('SELECT * FROM promo_oferta WHERE cliente = ?').all(cliente)
  .map(o => ({ ...o, chave: o.offer_id, offer_id: o.offer_id.startsWith(PREFIXO_SEM_REF) ? '' : o.offer_id }))      // offer_id '' = a oferta não trouxe id do ML (nunca vai em POST)
export const agruparPorItem = ofertas => { const m = new Map(); for (const o of ofertas) { if (!m.has(o.item_id)) m.set(o.item_id, []); m.get(o.item_id).push(o) } return m }
export function definirProtegido(cliente, item_id, protegido, autor = '') {
  const r = db.prepare('UPDATE promo_anuncio SET protegido = ? WHERE cliente = ? AND item_id = ?').run(protegido ? 1 : 0, cliente, item_id)
  if (!r.changes) throw erro('anúncio não encontrado na última coleta', 404)
  auditar(cliente, 'protegido', { item_id, autor, depois: { protegido: !!protegido } })
}

// ── faturamento 30d (pedidos PAGOS) da série do Place Sprints — só leitura, nada é gravado ──
export function faturamento30(cliente, hoje) {
  try {
    const de = new Date(hoje + 'T12:00:00Z'); de.setUTCDate(de.getUTCDate() - 29)
    const linhas = db.prepare('SELECT item_id, SUM(receita) fat, SUM(unidades) unid FROM meli_serie_item WHERE cliente = ? AND dia >= ? AND dia <= ? GROUP BY item_id')
      .all(cliente, de.toISOString().slice(0, 10), hoje)
    const vendasAte = db.prepare('SELECT MAX(dia) d FROM meli_coleta_dia WHERE cliente = ?').get(cliente)?.d || null
    // cobertura da janela: quantos dos 30 dias têm pedidos coletados (e quantos truncados). Janela incompleta = fat/unid SUBESTIMADOS (curva e ganho/mês sobre dado parcial)
    const cob = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(truncado), 0) t FROM meli_coleta_dia WHERE cliente = ? AND dia >= ? AND dia <= ?').get(cliente, de.toISOString().slice(0, 10), hoje)
    const cobertura = { janela_dias: 30, dias_com_dado: cob.n, dias_truncados: cob.t, lacunas: Math.max(0, 30 - cob.n), completa: cob.n >= 30 && !cob.t }
    return { disponivel: true, vendasAte, cobertura, porItem: new Map(linhas.map(l => [l.item_id, { fat: l.fat || 0, unid: l.unid || 0 }])) }
  } catch { return { disponivel: false, vendasAte: null, cobertura: null, porItem: new Map(), motivo: 'série de vendas do Place Sprints indisponível (rode a coleta de vendas do cliente)' } }
}

// ── decisões ─────────────────────────────────────────────────────────────────
const dec = r => ({ ...r, marcado: !!r.marcado, aprovado: !!r.aprovado, ordem_direta: !!r.ordem_direta, outras: json(r.outras_json, []) })
export const lerDecisoes = cliente => db.prepare('SELECT * FROM promo_decisao WHERE cliente = ?').all(cliente).map(dec)

// marcação HUMANA: marcado 1 (marca), 0 (recusa explícita) ou null (limpa). Nunca mexe em linha do analista.
export function marcarHumano(cliente, d, por = '') {
  const via = d.via === 'painel' ? 'painel' : 'api'
  const antes = db.prepare("SELECT * FROM promo_decisao WHERE cliente=? AND item_id=? AND pid=? AND origem='humano'").get(cliente, d.item_id, d.pid)
  if (d.marcado === null) {
    db.prepare("DELETE FROM promo_decisao WHERE cliente=? AND item_id=? AND pid=? AND origem='humano'").run(cliente, d.item_id, d.pid)
    auditar(cliente, 'limpa_humano', { item_id: d.item_id, pid: d.pid, autor: por, antes: antes && dec(antes) })
    return null
  }
  db.prepare(`INSERT INTO promo_decisao (cliente, item_id, pid, origem, marcado, regra, motivo, obs, via, offer_id, preco, meli_pct, mc, mc_pct, ordem_direta, estado, por, em)
    VALUES (@cliente,@item_id,@pid,'humano',@marcado,'HUMANO',@motivo,@obs,@via,@offer_id,@preco,@meli_pct,@mc,@mc_pct,@ordem_direta,'ativa',@por,@em)
    ON CONFLICT(cliente, item_id, pid, origem) DO UPDATE SET marcado=@marcado, motivo=@motivo, obs=@obs, via=@via, offer_id=@offer_id, preco=@preco,
      meli_pct=@meli_pct, mc=@mc, mc_pct=@mc_pct, ordem_direta=@ordem_direta, estado='ativa', por=@por, em=@em`)
    .run({ cliente, item_id: d.item_id, pid: d.pid, marcado: d.marcado ? 1 : 0, motivo: String(d.motivo || '').slice(0, 500), obs: String(d.obs || '').slice(0, 1000), via,
      offer_id: d.offer_id || '', preco: d.preco ?? null, meli_pct: d.meli_pct ?? null, mc: d.mc ?? null, mc_pct: d.mc_pct ?? null, ordem_direta: d.ordem_direta ? 1 : 0, por: String(por).slice(0, 80), em: agora() })
  const depois = dec(db.prepare("SELECT * FROM promo_decisao WHERE cliente=? AND item_id=? AND pid=? AND origem='humano'").get(cliente, d.item_id, d.pid))
  auditar(cliente, d.marcado ? 'marca_humana' : 'recusa_humana', { item_id: d.item_id, pid: d.pid, autor: por, antes: antes && dec(antes), depois })
  return depois
}

// as linhas do analista são RECALCULÁVEIS: substitui todas. A aprovação do dono vale para os NÚMEROS aprovados (preço, MC%, trilha):
// só sobrevive se a linha nova tiver os mesmos; com número diferente (ou sem a campanha) é REVOGADA e registrada — nunca carregada para número novo
export function substituirDecisoesAnalista(cliente, linhas, rodadaId, por = 'analista') {
  const em = agora()
  const antes = db.prepare("SELECT * FROM promo_decisao WHERE cliente=? AND origem='analista'").all(cliente)
  const aprov = new Map(antes.filter(r => r.marcado && r.aprovado).map(r => [`${r.item_id}|${r.pid}`, r]))
  const igual = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005)
  const revogadas = []
  db.transaction(() => {
    db.prepare("DELETE FROM promo_decisao WHERE cliente=? AND origem='analista'").run(cliente)
    for (const l of linhas) {
      let ap = l.marcado ? aprov.get(`${l.item_id}|${l.pid}`) : null
      if (ap && !(igual(ap.preco, l.preco ?? null) && igual(ap.mc_pct, l.mc_pct ?? null) && (ap.via === 'painel') === (l.via === 'painel'))) { revogadas.push({ r: ap, l }); ap = null }
      db.prepare(`INSERT INTO promo_decisao (cliente, item_id, pid, origem, marcado, regra, motivo, obs, via, offer_id, preco, meli_pct, mc, mc_pct, outras_json, ancora, aprovado, aprovado_por, aprovado_em, estado, rodada_id, por, em)
        VALUES (@cliente,@item_id,@pid,'analista',@marcado,@regra,@motivo,@obs,@via,@offer_id,@preco,@meli_pct,@mc,@mc_pct,@outras_json,@ancora,@aprovado,@aprovado_por,@aprovado_em,'ativa',@rodada_id,@por,@em)`)
        .run({ cliente, item_id: l.item_id, pid: l.pid || '', marcado: l.marcado ? 1 : 0, regra: l.regra || '', ancora: l.regra === 'HEDGE' ? String(l.ancora || '') : '', motivo: String(l.motivo || '').slice(0, 500), obs: String(l.obs || '').slice(0, 2000),
          via: l.via === 'painel' ? 'painel' : 'api', offer_id: l.offer_id || '', preco: l.preco ?? null, meli_pct: l.meli_pct ?? null, mc: l.mc ?? null, mc_pct: l.mc_pct ?? null,
          outras_json: JSON.stringify(l.outras || []), aprovado: ap ? 1 : 0, aprovado_por: ap?.aprovado_por || '', aprovado_em: ap?.aprovado_em || '', rodada_id: rodadaId, por, em })
    }
    for (const [k, r] of aprov) if (!linhas.some(l => l.marcado && `${l.item_id}|${l.pid}` === k)) revogadas.push({ r, l: null })      // a campanha saiu da recomendação
    for (const { r, l } of revogadas) auditar(cliente, 'aprovacao_revogada', { item_id: r.item_id, pid: r.pid, autor: por,
      antes: { preco: r.preco, mc_pct: r.mc_pct, via: r.via, aprovado_por: r.aprovado_por, aprovado_em: r.aprovado_em }, depois: l ? { preco: l.preco ?? null, mc_pct: l.mc_pct ?? null, via: l.via || 'api' } : null,
      detalhe: l ? 'a rodada do analista recalculou preço/MC/trilha: a aprovação valia para os números antigos — aprove de novo' : 'a campanha deixou de ser recomendada pelo analista: aprovação descartada' })
  })()
  return { antes: antes.length, depois: linhas.length, aprovacoes_revogadas: revogadas.length }
}
// Par com os NÚMEROS vistos na tela ({preco, mc_pct} presentes): só aprova se a linha 🤖 de agora tiver exatamente esses números. Se QUALQUER par visto
// mudou (outra aba/recoleta+analista recalculou, ou a sugestão sumiu), NADA é aprovado: os pares vão para `mudaram` (a rota devolve 409 'numeros_mudaram') e ficam na auditoria.
export function aprovarAnalista(cliente, pares, por = '', mudaram = []) {
  const em = agora(); let n = 0
  const bl = recusasHumanas(cliente)
  const up = db.prepare("UPDATE promo_decisao SET aprovado=1, aprovado_por=?, aprovado_em=? WHERE cliente=? AND item_id=? AND pid=? AND origem='analista' AND marcado=1")
  const atual = db.prepare("SELECT preco, mc_pct FROM promo_decisao WHERE cliente=? AND item_id=? AND pid=? AND origem='analista' AND marcado=1")
  const igual = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005)
  db.transaction(() => {
    for (const p of pares) {
      if (!('preco' in p) || bl.bloqueado(p.item_id, p.pid)) continue
      const l = atual.get(cliente, p.item_id, p.pid)
      if (!l || !igual(l.preco, p.preco ?? null) || !igual(l.mc_pct, p.mc_pct ?? null)) mudaram.push({ item_id: p.item_id, pid: p.pid, visto: { preco: p.preco ?? null, mc_pct: p.mc_pct ?? null }, atual: l ? { preco: l.preco, mc_pct: l.mc_pct } : null })
    }
    if (mudaram.length) {
      for (const m of mudaram) auditar(cliente, 'aprova_analista_numeros_mudaram', { item_id: m.item_id, pid: m.pid, autor: por, antes: m.visto, depois: m.atual, detalhe: m.atual ? 'a sugestão 🤖 mudou de preço/MC desde que a tela carregou: nada aprovado — recarregue e aprove os números novos' : 'a sugestão 🤖 não existe mais: nada aprovado — recarregue' })
      return
    }
    for (const p of pares) {
      if (bl.bloqueado(p.item_id, p.pid)) { auditar(cliente, 'aprova_analista_bloqueada', { item_id: p.item_id, pid: p.pid, autor: por, detalhe: 'recusa 👤 ou bloqueio do dono (IGNORAR / Revisar toda rodada) vale mais que a sugestão do analista — limpe a recusa antes de aprovar' }); continue }
      const r = up.run(String(por).slice(0, 80), em, cliente, p.item_id, p.pid)
      if (r.changes) {                                                         // a aprovação vale para ESTES números (preço/MC): a auditoria os guarda
        const l = db.prepare("SELECT preco, mc_pct FROM promo_decisao WHERE cliente=? AND item_id=? AND pid=? AND origem='analista'").get(cliente, p.item_id, p.pid)
        n++; auditar(cliente, 'aprova_analista', { item_id: p.item_id, pid: p.pid, autor: por, depois: { preco: l?.preco ?? null, mc_pct: l?.mc_pct ?? null } })
      }
    }
  })()
  return n
}
// recusas e bloqueios VINCULANTES do dono — a ÚNICA fonte (analista, vigia, hedge, plano e executor consultam AQUI):
//   pares = 'item|pid' recusados por 👤 (marcado=0); itens = anúncios barrados por aprendizado IGNORAR ou regra "Revisar toda rodada".
//   bloqueado(item, pid, origem): a recusa vale para tudo; o anúncio barrado vale para tudo que NÃO seja marca 👤 explícita (o dono decide caso a caso).
export function recusasHumanas(cliente) {
  const pares = new Set(), itens = new Set()
  for (const r of db.prepare("SELECT item_id, pid FROM promo_decisao WHERE cliente=? AND origem='humano' AND marcado=0 AND pid<>''").all(cliente)) pares.add(`${r.item_id}|${r.pid}`)
  const regras = listarRegrasSku(cliente), ign = listarAprendizados(cliente, { soAtivos: true }).filter(a => a.acao === 'ignorar')
  const revisar = r => !!r && parseStatusRegra(r.status).tipo === 'revisar'
  const rMlb = new Map(regras.filter(r => r.mlb).map(r => [String(r.mlb).toUpperCase(), r])), rSku = new Map(regras.filter(r => !r.mlb && r.sku).map(r => [String(r.sku).toLowerCase(), r]))
  const ignSku = new Set(ign.filter(a => a.escopo_tipo === 'sku').map(a => String(a.escopo_valor).toLowerCase()))
  for (const a of ign) if (a.escopo_tipo === 'item') itens.add(String(a.escopo_valor).toUpperCase())
  for (const [mlb, r] of rMlb) if (revisar(r)) itens.add(mlb)
  for (const a of db.prepare('SELECT item_id, sku FROM promo_anuncio WHERE cliente = ?').all(cliente)) {      // o MLB manda sobre o SKU (mesma precedência de regraDoAnuncio)
    const id = String(a.item_id).toUpperCase(), sku = String(a.sku || '').toLowerCase()
    if (sku && (ignSku.has(sku) || (!rMlb.has(id) && revisar(rSku.get(sku))))) itens.add(id)
  }
  return { pares, itens, bloqueado: (item, pid, origem = 'analista') => pares.has(`${item}|${pid}`) || (origem !== 'humano' && itens.has(String(item).toUpperCase())) }
}
// o que vale para o plano: 👤 marcas + 🤖 aprovadas — MENOS a 🤖 coberta por recusa 👤, por marca 👤 no mesmo anúncio/trilha (humano manda) ou por bloqueio do dono.
// O HEDGE 🤖 morre com a âncora (mesma regra de aplicarHumanos): só vale se a âncora também é efetiva (aprovada, não recusada, não bloqueada, não revogada); hedge sem âncora gravada = não vale
export function marcasEfetivas(cliente) {
  const ds = lerDecisoes(cliente), bl = recusasHumanas(cliente), trilha = d => (d.via === 'painel' ? 'painel' : 'api')
  const anun = new Map(lerAnuncios(cliente).map(a => [a.item_id, a])), ofs = agruparPorItem(lerOfertas(cliente))     // 👤 de campanha ENCERRADA (acabou/saiu) não veta mais a 🤖 aprovada: o analista já a reavaliou (mesma regra de marcasHumanasVivas)
  const humanoMarcou = new Set(ds.filter(d => d.origem === 'humano' && d.marcado && d.pid && marcaHumanaViva(anun.get(d.item_id), ofs.get(d.item_id), d.pid)).map(d => `${d.item_id}|${trilha(d)}`))
  const efetivas = ds.filter(d => d.marcado && d.pid && (d.origem === 'humano' || (d.aprovado && !humanoMarcou.has(`${d.item_id}|${trilha(d)}`) && !bl.bloqueado(d.item_id, d.pid))))
  const ehHedge = d => d.origem === 'analista' && d.regra === 'HEDGE'
  return efetivas.filter(d => !ehHedge(d) || efetivas.some(x => x.item_id === d.item_id && x.pid === d.ancora && !ehHedge(x)))
}

// ── alertas (vigias) ─────────────────────────────────────────────────────────
export function substituirAlertas(cliente, tipo, alertas, rodadaId) {
  const em = agora()
  db.transaction(() => {
    db.prepare('DELETE FROM promo_alerta WHERE cliente = ? AND tipo = ?').run(cliente, tipo)
    for (const a of alertas) db.prepare('INSERT OR REPLACE INTO promo_alerta (cliente, tipo, chave, item_id, severidade, detalhe_json, rodada_id, em) VALUES (?,?,?,?,?,?,?,?)')
      .run(cliente, tipo, a.chave || a.item_id, a.item_id || '', a.severidade || '', JSON.stringify(a), rodadaId, em)
  })()
}
export const lerAlertas = (cliente, tipo = null) => db.prepare('SELECT * FROM promo_alerta WHERE cliente = ? AND (? IS NULL OR tipo = ?)').all(cliente, tipo, tipo).map(r => ({ ...r, detalhe: json(r.detalhe_json, {}) }))

// ── regras por SKU ───────────────────────────────────────────────────────────
export const listarRegrasSku = cliente => db.prepare('SELECT * FROM promo_regras_sku WHERE cliente = ? ORDER BY sku, mlb').all(cliente)
export function salvarRegraSku(cliente, { mlb = '', sku = '', status, nota = '' }, por = '') {
  mlb = String(mlb || '').trim().toUpperCase(); sku = String(sku || '').trim()
  if (!mlb && !sku) throw erro('informe MLB ou SKU')
  if (mlb && !/^MLB\d{1,14}$/.test(mlb)) throw erro('MLB inválido (ex.: MLB1234567890)')
  if (sku.length > 80 || String(nota).length > 500) throw erro('SKU ou nota longos demais')
  if (parseStatusRegra(status).tipo === 'desconhecido') throw erro('status inválido: use "Livre", "N%" (ex.: 15%) ou "Revisar toda rodada"')
  const antes = db.prepare('SELECT * FROM promo_regras_sku WHERE cliente=? AND mlb=? AND sku=?').get(cliente, mlb, sku)
  db.prepare(`INSERT INTO promo_regras_sku (cliente, mlb, sku, status, nota, por, em) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(cliente, mlb, sku) DO UPDATE SET status=excluded.status, nota=excluded.nota, por=excluded.por, em=excluded.em`)
    .run(cliente, mlb, sku, String(status).trim(), String(nota).trim(), String(por).slice(0, 80), agora())
  auditar(cliente, 'regra_sku', { item_id: mlb, autor: por, antes, depois: { mlb, sku, status, nota } })
}
export function removerRegraSku(cliente, { mlb = '', sku = '' }, por = '') {
  mlb = String(mlb || '').trim().toUpperCase(); sku = String(sku || '').trim()
  const antes = db.prepare('SELECT * FROM promo_regras_sku WHERE cliente=? AND mlb=? AND sku=?').get(cliente, mlb, sku)
  if (!antes) throw erro('regra não encontrada', 404)
  db.prepare('DELETE FROM promo_regras_sku WHERE cliente=? AND mlb=? AND sku=?').run(cliente, mlb, sku)
  auditar(cliente, 'regra_sku_remove', { item_id: mlb, autor: por, antes })
}

// ── custos por SKU ───────────────────────────────────────────────────────────
export const listarCustosSku = cliente => db.prepare('SELECT sku, custo, fonte, atualizado_em FROM promo_custos_sku WHERE cliente = ? ORDER BY sku').all(cliente)
// chave do histórico = chaveSku de custos-db.js (mesma regra, repetida aqui p/ não criar import circular: custos-db importa este módulo)
const chaveSkuHist = s => String(s ?? '').normalize('NFC').replace(/\u{A0}/gu, ' ').replace(/[\u{200B}-\u{200D}\u{FEFF}]/gu, '').trim().toLowerCase()
export function importarCustosSku(cliente, linhas, fonte = 'importação', por = '') {
  if (linhas.length > 20000) throw erro('máximo de 20.000 linhas por importação')
  const em = agora()
  const up = db.prepare(`INSERT INTO promo_custos_sku (cliente, sku, custo, fonte, atualizado_em) VALUES (?,?,?,?,?)
    ON CONFLICT(cliente, sku) DO UPDATE SET custo=excluded.custo, fonte=excluded.fonte, atualizado_em=excluded.atualizado_em`)
  // camada 'manual' da integração de custos: toda mudança (ou SKU novo) vai para erp_custos_hist com a proveniência (fonte livre) — retorno inalterado
  const antes = db.prepare('SELECT custo FROM promo_custos_sku WHERE cliente = ? AND sku = ?')
  const hist = db.prepare(`INSERT INTO erp_custos_hist (cliente, sku_key, sku, fonte, evento, custo_antes, custo_depois, variacao_pct, campo, em, por)
    VALUES (?,?,?,'manual','manual',?,?,?,?,?,?)`)
  db.transaction(() => {
    for (const l of linhas) {
      const a = antes.get(cliente, l.sku)?.custo ?? null
      if (a !== l.custo) hist.run(cliente, chaveSkuHist(l.sku), String(l.sku), a, l.custo, a > 0 ? Math.round((l.custo - a) / a * 1000) / 10 : null, String(fonte).slice(0, 80), em, String(por).slice(0, 80))
      up.run(cliente, l.sku, l.custo, String(fonte).slice(0, 80), em)
    }
  })()
  auditar(cliente, 'custos_import', { autor: por, detalhe: `${linhas.length} SKU(s) · fonte: ${fonte}` })
  return linhas.length
}

// ── planos ───────────────────────────────────────────────────────────────────
const plano = r => r && ({ ...r, itens: json(r.itens_json, []), resumo: json(r.resumo_json, {}), resultado: json(r.resultado_json, null) })
// `coleta` (gerarPlano): a coleta lida quando o plano começou. Se no fim a coleta corrente ou a conta ML não forem mais as mesmas (troca de conta/limpeza,
// coleta nova no meio), o plano NÃO é gravado (409 + auditoria 'plano_descartado'): foi montado sobre marcas/anúncios de um estado que não existe mais
export function salvarPlano(p, { coleta } = {}) {
  const c = coleta === undefined ? null : lerColeta(p.cliente)
  if (coleta !== undefined && ((c?.coleta_id ?? null) !== (coleta?.coleta_id ?? null) || (c?.meli_user_id ?? '') !== (coleta?.meli_user_id ?? ''))) {
    const motivo = !c ? 'a conta do Mercado Livre foi trocada ou desconectada durante a geração' : 'a coleta mudou durante a geração (coleta nova ou outra conta do ML)'
    auditar(p.cliente, 'plano_descartado', { autor: p.gerado_por, depois: { id: p.id, coleta_inicio: coleta?.coleta_id ?? null, coleta_agora: c?.coleta_id ?? null }, detalhe: motivo })
    throw erro(`plano descartado: ${motivo} — nada foi gravado; gere o plano de novo`, 409)
  }
  db.prepare(`INSERT INTO promo_plano (id, cliente, estado, criado_em, expira_em, gerado_por, hash, itens_json, resumo_json) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(p.id, p.cliente, 'dry-run', p.criado_em, p.expira_em, String(p.gerado_por || '').slice(0, 80), p.hash, JSON.stringify(p.itens), JSON.stringify(p.resumo))
}
export const lerPlano = (cliente, id) => plano(db.prepare('SELECT * FROM promo_plano WHERE cliente = ? AND id = ?').get(cliente, id))
export const ultimoPlano = cliente => plano(db.prepare('SELECT * FROM promo_plano WHERE cliente = ? ORDER BY criado_em DESC LIMIT 1').get(cliente))
export const listarPlanos = (cliente, limite = 20) => db.prepare('SELECT id, estado, criado_em, expira_em, gerado_por, aprovado_por, aprovado_em, resumo_json, executado_em FROM promo_plano WHERE cliente = ? ORDER BY criado_em DESC LIMIT ?')
  .all(cliente, Math.min(100, Math.max(1, Math.trunc(Number(limite)) || 20))).map(r => ({ ...r, resumo: json(r.resumo_json, {}) }))
export function atualizarPlano(cliente, id, patch) {
  const campos = { estado: 'estado', aprovado_por: 'aprovado_por', aprovado_em: 'aprovado_em', executado_em: 'executado_em' }
  const sets = [], vals = []
  for (const [k, col] of Object.entries(campos)) if (k in patch) { sets.push(`${col} = ?`); vals.push(patch[k]) }
  if ('resultado' in patch) { sets.push('resultado_json = ?'); vals.push(JSON.stringify(patch.resultado)) }
  if (!sets.length) return
  db.prepare(`UPDATE promo_plano SET ${sets.join(', ')} WHERE cliente = ? AND id = ?`).run(...vals, cliente, id)
}
// claim ATÔMICO da execução: só UMA chamada passa de 'aprovado' para 'executando' (o lock de job é só em memória e some no reinício)
export const reivindicarPlano = (cliente, id) => db.prepare("UPDATE promo_plano SET estado='executando', executando_em=? WHERE id=? AND cliente=? AND estado='aprovado'").run(agora(), id, cliente).changes === 1
// execução que NÃO enviou nada (leitura falhou / pre-check barrou tudo): devolve o claim — a aprovação não pode ser queimada por uma execução vazia
export const devolverPlano = (cliente, id) => db.prepare("UPDATE promo_plano SET estado='aprovado', executando_em='', resultado_json='' WHERE id=? AND cliente=? AND estado='executando'").run(id, cliente).changes === 1
// resultado parcial a cada POST (o plano em 'executando' nunca fica sem o que já saiu) + sinal de vida; só vale enquanto o plano ainda está 'executando'
export const salvarParcialPlano = (cliente, id, resultado) => db.prepare("UPDATE promo_plano SET resultado_json=?, executando_em=? WHERE id=? AND cliente=? AND estado='executando'").run(JSON.stringify(resultado), agora(), id, cliente).changes === 1
// plano 'executando' sem sinal de vida há mais de N min (queda/reinício do servidor): só o claim grava esse estado, então nada mais o tira de lá. '' (anterior à coluna) também conta como parado
export const planosPresos = (minutos, cliente = null, agoraMs = Date.now()) =>
  db.prepare("SELECT id, cliente FROM promo_plano WHERE estado='executando' AND executando_em < ? AND (? IS NULL OR cliente = ?)").all(new Date(agoraMs - minutos * 60e3).toISOString(), cliente, cliente)
// fecha o plano preso — condicional ao estado (se a execução original ainda estiver viva e já tiver concluído, não pisa nela)
export const resolverPlanoPreso = (cliente, id, estado, executadoEm, resultado) =>
  db.prepare("UPDATE promo_plano SET estado=?, executado_em=?, resultado_json=? WHERE id=? AND cliente=? AND estado='executando'").run(estado, executadoEm, JSON.stringify(resultado), id, cliente).changes === 1
// houve POST (ou a tentativa dele) deste anúncio × campanha nos últimos N min — em QUALQUER plano? A propagação do ML leva ~30 min: reenviar duplica
export const tentativaRecente = (cliente, item_id, pid, minutos, agoraMs = Date.now()) =>
  !!db.prepare("SELECT 1 FROM promo_auditoria WHERE cliente=? AND item_id=? AND pid=? AND evento IN ('exec_pre','exec_post') AND em >= ? LIMIT 1").get(cliente, item_id, pid, new Date(agoraMs - minutos * 60e3).toISOString())

// ── aprendizados (interrogatório) ────────────────────────────────────────────
export const listarAprendizados = (cliente, { soAtivos = false } = {}) =>
  db.prepare(`SELECT * FROM promo_aprendizados WHERE cliente = ? ${soAtivos ? 'AND ativo = 1' : ''} ORDER BY id DESC`).all(cliente).map(a => ({ ...a, ativo: !!a.ativo }))
export function registrarAprendizado(cliente, a, por = '') {
  const acao = ['nota', 'ignorar', 'regra_sku'].includes(a.acao) ? a.acao : 'nota'
  const escopo = ['item', 'sku', 'global'].includes(a.escopo_tipo) ? a.escopo_tipo : 'global'
  if (!String(a.resposta || '').trim()) throw erro('registre a resposta do dono (campo "resposta")')
  if (String(a.resposta).length > 2000 || String(a.contexto || '').length > 2000) throw erro('texto longo demais (máx. 2000 caracteres)')
  if (escopo !== 'global' && !String(a.escopo_valor || '').trim()) throw erro('informe o item (MLB) ou o SKU do escopo')
  if (acao !== 'nota' && escopo === 'global') throw erro('"ignorar" e "regra por SKU" exigem escopo de item ou SKU')
  if (acao === 'regra_sku' && parseStatusRegra(a.parametro).tipo === 'desconhecido') throw erro('parâmetro da regra inválido: "Livre", "N%" ou "Revisar toda rodada"')
  let id
  db.transaction(() => {
    id = db.prepare(`INSERT INTO promo_aprendizados (cliente, em, por, padrao, escopo_tipo, escopo_valor, contexto, resposta, regra_destilada, acao, parametro) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(cliente, agora(), String(por).slice(0, 80), String(a.padrao || '').slice(0, 60), escopo, String(a.escopo_valor || '').trim().slice(0, 80), String(a.contexto || ''),
        String(a.resposta).trim(), String(a.regra_destilada || '').slice(0, 1000), acao, String(a.parametro || '').trim().slice(0, 80)).lastInsertRowid
    if (acao === 'regra_sku') salvarRegraSku(cliente, escopo === 'item' ? { mlb: a.escopo_valor, status: a.parametro, nota: `aprendizado #${id}` } : { sku: a.escopo_valor, status: a.parametro, nota: `aprendizado #${id}` }, por)
  })()
  auditar(cliente, 'aprendizado', { autor: por, item_id: escopo === 'item' ? a.escopo_valor : '', depois: { id, ...a, acao }, detalhe: a.padrao || '' })
  return Number(id)
}
// desativar um aprendizado "regra por SKU" desfaz a regra que ELE criou (nota 'aprendizado #id' — se o dono a editou à mão depois, a nota mudou e ela fica):
// volta a regra que havia antes dele (lida da auditoria do registro; não se ela era de outro aprendizado já desativado) ou, sem anterior, a regra sai. Tudo auditado.
export function desativarAprendizado(cliente, id, por = '') {
  let desfeita = ''
  db.transaction(() => {
    const r = db.prepare('UPDATE promo_aprendizados SET ativo = 0 WHERE cliente = ? AND id = ?').run(cliente, id)
    if (!r.changes) throw erro('aprendizado não encontrado', 404)
    const nota = `aprendizado #${id}`, regra = db.prepare('SELECT * FROM promo_regras_sku WHERE cliente = ? AND nota = ?').get(cliente, nota)
    if (regra) {
      const antes = json(db.prepare("SELECT antes_json FROM promo_auditoria WHERE cliente = ? AND evento = 'regra_sku' AND depois_json LIKE ? ORDER BY id LIMIT 1").get(cliente, `%"nota":${JSON.stringify(nota)}%`)?.antes_json, null)     // a 1ª = o registro dele
      const deAp = /^aprendizado #(\d+)$/.exec(antes?.nota || '')
      const restaura = antes?.status && (!deAp || db.prepare('SELECT ativo FROM promo_aprendizados WHERE cliente = ? AND id = ?').get(cliente, Number(deAp[1]))?.ativo)
      if (restaura) salvarRegraSku(cliente, { mlb: antes.mlb, sku: antes.sku, status: antes.status, nota: antes.nota }, por)
      else removerRegraSku(cliente, { mlb: regra.mlb, sku: regra.sku }, por)
      desfeita = ` — regra por SKU ${regra.mlb || regra.sku} "${regra.status}" desfeita (${restaura ? `voltou a anterior: "${antes.status}"` : 'removida'})`
    }
    auditar(cliente, 'aprendizado_off', { autor: por, detalhe: `#${id}${desfeita}` })
  })()
  return desfeita
}

// ── troca/desconexão da conta do ML ──────────────────────────────────────────
// Derivados da conta (coleta, campanha, oferta, anúncio, decisão, alerta, plano, snapshot) apontam MLBs/campanhas da conta ANTIGA: misturá-los com a
// nova reinjetaria anúncios alheios no universo e levaria marcas/aprovações/planos aprovados a uma conta que ninguém revisou. Ficam as entradas do
// DONO (config, custos por SKU, regras por SKU, aprendizados, auditoria). execucao_habilitada volta a 0: a conta nova nunca foi revisada.
export const TABELAS_DERIVADAS = ['promo_coleta', 'promo_campanha', 'promo_oferta', 'promo_anuncio', 'promo_decisao', 'promo_alerta', 'promo_plano', 'promo_snapshot']
export function limparPromocoesDoCliente(cliente, motivo = '') {
  const apagados = {}
  db.transaction(() => {
    for (const t of TABELAS_DERIVADAS) apagados[t] = db.prepare(`DELETE FROM ${t} WHERE cliente = ?`).run(cliente).changes
    apagados.custo_vinculo = db.prepare('DELETE FROM custo_vinculo WHERE cliente = ?').run(cliente).changes   // vínculo manual aponta MLB da conta antiga
    // custos de ERP/planilha, histórico, quarentena, credenciais e config são do DONO e ficam; só o que depende dos MLBs da conta antiga sai
    db.prepare("DELETE FROM erp_rejeitadas WHERE cliente = ? AND codigo IN ('conflito_sku_mlb','mlb_sem_sku')").run(cliente)
    db.prepare("UPDATE erp_custos_sku SET mlb_dica = '' WHERE cliente = ? AND mlb_dica <> ''").run(cliente)
    db.prepare("UPDATE erp_quarentena SET mlb_dica = '' WHERE cliente = ? AND mlb_dica <> ''").run(cliente)
    const exec = db.prepare('UPDATE promo_config SET execucao_habilitada = 0 WHERE cliente = ? AND execucao_habilitada <> 0').run(cliente).changes
    auditar(cliente, 'conta_trocada', { autor: 'sistema', depois: { apagados, execucao_desabilitada: exec > 0 }, detalhe: motivo || 'conta do Mercado Livre trocada ou desconectada' })
  })()
  return apagados
}

// ── snapshots de rodada ──────────────────────────────────────────────────────
export function salvarSnapshot(cliente, rodadaId, dados) {
  db.prepare('INSERT OR REPLACE INTO promo_snapshot (cliente, rodada_id, em, dados_json) VALUES (?,?,?,?)').run(cliente, rodadaId, agora(), JSON.stringify(dados))
  db.prepare('DELETE FROM promo_snapshot WHERE cliente = ? AND rodada_id NOT IN (SELECT rodada_id FROM promo_snapshot WHERE cliente = ? ORDER BY em DESC LIMIT 12)').run(cliente, cliente)
}
export const ultimoSnapshot = cliente => { const r = db.prepare('SELECT * FROM promo_snapshot WHERE cliente = ? ORDER BY em DESC LIMIT 1').get(cliente); return r ? { rodada_id: r.rodada_id, em: r.em, ...json(r.dados_json, {}) } : null }
