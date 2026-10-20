// DDL do "Como era" do anúncio (Parte B, fase 1): uma fotografia COMPLETA do anúncio por estado distinto (título, preço, status, categoria, tipo,
// fotos por id, ficha por id, variações, frete e descrição). Só grava quando a impressão (hash, sem descrição) OU a descrição mudam — ver anuncio-historico.js.
// Fica em módulo próprio para o banco real (db.js) e os autotestes (banco em memória) usarem o MESMO texto.
// `hash` = chave da linha (impressão ⊕ descricao_hash). Anúncio que VOLTA a um estado anterior reaproveita a linha (ON CONFLICT: capturado_em avança) —
// ponytail: a PK (cliente, item_id, hash) não guarda ida e volta; se a ida e volta importar, trocar a PK por id autoincremental.
export const SCHEMA_SNAPSHOT = `
CREATE TABLE IF NOT EXISTS meli_item_snapshot (
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, hash TEXT NOT NULL,
  capturado_em TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('coleta','ofertas','chaveiro','restauracao')),
  titulo TEXT, preco REAL, status TEXT, categoria TEXT, tipo_anuncio TEXT,
  fotos_json TEXT NOT NULL DEFAULT '[]', atributos_json TEXT NOT NULL DEFAULT '{}', variacoes_json TEXT NOT NULL DEFAULT '[]', frete_json TEXT NOT NULL DEFAULT '{}',
  descricao TEXT, descricao_hash TEXT,
  PRIMARY KEY (cliente, item_id, hash));
CREATE INDEX IF NOT EXISTS ix_item_snapshot ON meli_item_snapshot (cliente, item_id, capturado_em);
`
