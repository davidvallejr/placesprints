// Tabela dos alinhamentos com o cliente (src/lib/alinhamentos.js). Arquivo SEM leitura de config (molde gatilhos-schema.js): db.js importa só isto, então uma
// config/alinhamentos.json inválida desliga o registro de alinhamentos, nunca o servidor inteiro.
export const SCHEMA_ALINHAMENTO = `
CREATE TABLE IF NOT EXISTS alinhamento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL,                       -- nome canônico da central (nunca prospect)
  escopo TEXT NOT NULL CHECK (escopo IN ('anuncio','campanha_ads','regra','conta','sku')),
  chave TEXT NOT NULL DEFAULT '',              -- item_id | id da campanha | regra | sku | '' (conta)
  regras_json TEXT NOT NULL DEFAULT '[]',      -- regras cobertas (sem o prefixo anuncio_); vazio = padrão do tipo (config/alinhamentos.json → suprime)
  tipo TEXT NOT NULL CHECK (tipo IN ('intencional','ja_informado','campanha_visibilidade','descontinuado_queima_estoque','teste','pausa_producao','boi_de_piranha','outro')),
  motivo TEXT NOT NULL DEFAULT '' CHECK (length(motivo) <= 200),   -- INTERNO, auditado (sem nome/ID/promessa); nunca vai ao cliente
  acos_alvo REAL,                              -- só campanha_visibilidade: ACOS aceito no lugar da meta da conta
  por TEXT NOT NULL DEFAULT '',                -- líder/consultor da central ('cliente' quando origem s90_cliente)
  origem TEXT NOT NULL CHECK (origem IN ('painel','descarte','s90_cliente','notion')),
  acao_id TEXT NOT NULL DEFAULT '',            -- origem descarte: a ação descartada (reabrir encerra; vencer devolve a ação à fila)
  desde TEXT NOT NULL,                         -- AAAA-MM-DD do registro
  revisar_em TEXT NOT NULL DEFAULT '',         -- AAAA-MM-DD; '' só quando permanente
  permanente INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'vivo' CHECK (estado IN ('vivo','vencido','encerrado')),
  encerrado_em TEXT NOT NULL DEFAULT '', encerrado_por TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alinhamento_cli ON alinhamento (cliente, estado);
CREATE INDEX IF NOT EXISTS ix_alinhamento_acao ON alinhamento (acao_id) WHERE acao_id <> '';
`
