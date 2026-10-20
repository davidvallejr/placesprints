// Gatilhos do Merovíngio ao cliente (docs/desenho-gatilhos-n8n.md seção 3): um item por (cliente, tipo, assinatura) viva e um LOTE por mensagem
// (micro-relatório). Aditivo e idempotente: db.js executa como os outros SCHEMA_*; o autoteste roda em :memory:. itens_json é INTERNO (ids de
// anúncio, tarefa, pedido): nunca vai ao cliente. `texto` já passou pelo auditor (relatorio-seguro) antes de ser gravado.
export const SCHEMA_GATILHOS = `
CREATE TABLE IF NOT EXISTS gatilho_cliente (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                       -- nome canônico da central (nunca prospect)
  tipo TEXT NOT NULL,                          -- id do catálogo (config/gatilhos.json → gatilhos)
  classe TEXT NOT NULL,                        -- critico | atencao | info (no momento da detecção)
  assinatura TEXT NOT NULL,                    -- sha256 16 hex de tipo + ids ordenados/valores-chave
  itens_json TEXT NOT NULL DEFAULT '[]',       -- INTERNO: ids e números que sustentam o aviso
  texto TEXT NOT NULL DEFAULT '',              -- linha final ao cliente (template preenchido, auditado)
  estado TEXT NOT NULL,                        -- pendente | agrupado | enviado | entregue | suprimido | falhou | resolvido
  motivo TEXT NOT NULL DEFAULT '',             -- código fixo (cooldown, conteudo:promessa, teto_diario, n8n_nao_configurado …)
  lote_id TEXT NOT NULL DEFAULT '',
  canais_json TEXT NOT NULL DEFAULT '[]',
  avisado_resolucao INTEGER NOT NULL DEFAULT 0,   -- 1 = o lote seguinte já disse "resolvido"
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  enviado_em TEXT NOT NULL DEFAULT '', entregue_em TEXT NOT NULL DEFAULT '', resolvido_em TEXT NOT NULL DEFAULT '',
  recibo_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_gatilho_cli ON gatilho_cliente (cliente, estado);
CREATE INDEX IF NOT EXISTS ix_gatilho_tipo ON gatilho_cliente (cliente, tipo, enviado_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gatilho_vivo ON gatilho_cliente (cliente, tipo, assinatura) WHERE estado <> 'resolvido';
CREATE TABLE IF NOT EXISTS gatilho_lote (     -- 1 lote = 1 mensagem (micro-relatório)
  id TEXT PRIMARY KEY,                         -- sha256 16 hex: diário = (cliente, dia); imediato = (cliente, dia, itens)
  cliente TEXT NOT NULL,
  tipo TEXT NOT NULL,                          -- imediato (urgente) | semanal (plano da segunda; id = cliente + semana ISO) — 'diario' extinto em 12/10/2026
  dia TEXT NOT NULL DEFAULT '',                -- AAAA-MM-DD no fuso do cliente
  itens_ids_json TEXT NOT NULL DEFAULT '[]',
  texto_final TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',               -- sha256(texto_final) 16 hex: auditoria do que saiu
  canais_json TEXT NOT NULL DEFAULT '[]',      -- canais ligados no envio (nomes, nunca destinos)
  estado TEXT NOT NULL,                        -- montado | pendente | enviado | entregue | parcial | falhou
  motivo TEXT NOT NULL DEFAULT '',
  origem TEXT NOT NULL DEFAULT '',             -- automatico | manual | n8n-cron
  por TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, tentado_em TEXT NOT NULL DEFAULT '', enviado_em TEXT NOT NULL DEFAULT '',
  recibos_json TEXT NOT NULL DEFAULT '{}'      -- { canal: { estado, em } }
);
CREATE INDEX IF NOT EXISTS ix_gatilho_lote_cli ON gatilho_lote (cliente, dia, tipo);
CREATE TABLE IF NOT EXISTS gatilho_lote_produto (  -- micro-relatório de compras (15/10/2026): produtos DITOS no lote (sem linha em gatilho_cliente); viram gatilho_avisado no envio
  lote_id TEXT NOT NULL,
  item_id TEXT NOT NULL,                       -- INTERNO: anúncio
  snap_json TEXT NOT NULL DEFAULT '{}',        -- { estoque, cobertura } na montagem
  PRIMARY KEY (lote_id, item_id)
);
CREATE TABLE IF NOT EXISTS gatilho_avisado (  -- o que JÁ FOI DITO ao cliente por PRODUTO (14/10/2026): dedupe do urgente de estoque e preço por produto, nunca por linha
  cliente TEXT NOT NULL,
  familia TEXT NOT NULL,                       -- estoque | preco (gatilhos.js → FAMILIA)
  item_id TEXT NOT NULL,                       -- INTERNO: anúncio
  snap_json TEXT NOT NULL DEFAULT '{}',        -- { estoque, cobertura, para } no momento do envio (a piora compara com isto)
  enviado_em TEXT NOT NULL,
  lote_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, familia, item_id)
);
`
