// Saúde da conta GRAVADA (fase 1, 09/10/2026): o que monitoramento-meli.js saude() lia ao vivo passa a ter 1 linha/dia por cliente + listas abertas.
// Aditivo e idempotente (db.js executa como os outros SCHEMA_*). Dia sem coleta não é zero: coluna null + motivo em pendente_json.
// meli_pergunta NÃO guarda o texto da pergunta (LGPD): só hash, datas e status.
export const SCHEMA_SAUDE = `
CREATE TABLE IF NOT EXISTS meli_conta_saude (        -- 1 linha por cliente × dia (reputação + contagens do dia)
  cliente TEXT NOT NULL, dia TEXT NOT NULL,
  level_id TEXT, power_seller TEXT,
  taxa_claims REAL, taxa_atraso REAL, taxa_cancel REAL, vendas_periodo INTEGER,   -- % (0–100) e vendas do período da reputação; null = não lido
  perguntas_abertas INTEGER, perguntas_24h INTEGER,                                 -- null = chamada falhou (nunca 0 por falha)
  claims_abertas INTEGER, mediacoes INTEGER,
  atrasos INTEGER,                                                                  -- pedidos pagos (últimos N dias) com prazo de despacho vencido e não despachados
  fonte_json TEXT NOT NULL DEFAULT '{}',                                            -- endpoint/janela/teto por bloco
  pendente_json TEXT NOT NULL DEFAULT '{}',                                         -- { perguntas:'permissao_do_app', atrasos:'endpoint_nao_verificado', ... }
  coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, dia)
);
CREATE TABLE IF NOT EXISTS meli_claim (
  cliente TEXT NOT NULL, claim_id TEXT NOT NULL,
  item_id TEXT, order_id TEXT, tipo TEXT, estagio TEXT, status TEXT, motivo TEXT,
  aberto_em TEXT, prazo_resposta TEXT, fechado_em TEXT, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, claim_id)
);
CREATE TABLE IF NOT EXISTS meli_pergunta (           -- sem texto da pergunta: só hash (sha1) + datas
  cliente TEXT NOT NULL, question_id TEXT NOT NULL,
  item_id TEXT, texto_hash TEXT, status TEXT, perguntado_em TEXT, respondido_em TEXT,
  PRIMARY KEY (cliente, question_id)
);
CREATE TABLE IF NOT EXISTS meli_envio_atraso (
  cliente TEXT NOT NULL, order_id TEXT NOT NULL,
  shipment_id TEXT, item_id TEXT, prazo_despacho TEXT, despachado_em TEXT, dias_atraso INTEGER, status TEXT, coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, order_id)
);
CREATE TABLE IF NOT EXISTS meli_full_estoque (       -- Full por inventory_id × dia; idade do estoque ainda pendente (endpoint não verificado)
  cliente TEXT NOT NULL, item_id TEXT, inventory_id TEXT NOT NULL, dia TEXT NOT NULL,
  disponivel INTEGER, nao_disponivel INTEGER, dias_sem_venda INTEGER, idade_dias INTEGER,
  fonte TEXT NOT NULL DEFAULT '', pendente TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, inventory_id, dia)
);
CREATE INDEX IF NOT EXISTS idx_meli_claim_aberta ON meli_claim (cliente, status);
CREATE INDEX IF NOT EXISTS idx_meli_pergunta_aberta ON meli_pergunta (cliente, status);
`
