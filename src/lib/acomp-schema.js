// DDL do acompanhamento por tarefa (tabelas novas). Fica em módulo próprio para o banco real (db.js) e os autotestes (banco em memória) usarem o MESMO texto.
// change-log do anúncio: atributos (preço, título, fotos…), CONTEÚDO do snapshot (descricao, atributos, categoria, tipo_anuncio — anuncio-historico.js) e ESTADO (promoção, Ads; Full via logistica, estoque zerado, status). 1 leitura por dia;
// 1ª leitura sem valor anterior não gera evento. Listas fechadas no CHECK: quem grava (coleta, semeadura, promoções, Ads) não consegue inventar campo.
// Exportado à parte: promocoes-db.js cria a tabela no banco em memória dos testes de promoção (no real é IF NOT EXISTS, db.js já migrou).
export const SCHEMA_MUDANCA = `
CREATE TABLE IF NOT EXISTS meli_item_mudanca (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, dia TEXT NOT NULL,
  campo TEXT NOT NULL CHECK (campo IN ('preco','preco_original','titulo','fotos','estoque_zero','status','frete_gratis','logistica','thumb','promocao','ads','descricao','atributos','categoria','tipo_anuncio')),
  de TEXT, para TEXT, variacao_pct REAL,
  fonte TEXT NOT NULL CHECK (fonte IN ('coleta','acomp','promo','ofertas','webhook','ads','chaveiro')),
  em TEXT NOT NULL,
  UNIQUE (cliente, item_id, dia, campo, fonte));
CREATE INDEX IF NOT EXISTS ix_item_mudanca ON meli_item_mudanca (cliente, item_id, dia);
`
export const SCHEMA_ACOMP = `
CREATE TABLE IF NOT EXISTS meli_ads_dia (        -- Product Ads por anúncio e por DIA (GET /advertising/MLB/product_ads/ads/{id}?aggregation_type=DAILY)
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, dia TEXT NOT NULL,
  prints INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, custo REAL NOT NULL DEFAULT 0,
  receita REAL NOT NULL DEFAULT 0, unidades INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cliente, item_id, dia)
);
CREATE TABLE IF NOT EXISTS meli_ads_cobertura (  -- até onde o anúncio foi coletado (distingue "sem Ads/0" de "não coletado")
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL, coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id)
);
CREATE TABLE IF NOT EXISTS tarefa_item (         -- vínculo tarefa → anúncio. origem: citado (MLB no card) | plano (ação do plano por anúncio) | confirmado (alguém confirmou) | sugerido/recusado (NUNCA entram na atribuição)
  tarefa_id TEXT NOT NULL, cliente TEXT NOT NULL, item_id TEXT NOT NULL, origem TEXT NOT NULL, score REAL, por TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (tarefa_id, item_id)
);
CREATE TABLE IF NOT EXISTS tarefa_acomp (        -- fotografias do anúncio e das métricas: antes de mexer e nos marcos 24h/48h/72h/1 semana depois da tarefa
  tarefa_id TEXT NOT NULL, item_id TEXT NOT NULL, fase TEXT NOT NULL,   -- antes | d1 | d2 | d3 | d7
  cliente TEXT NOT NULL, data_ref TEXT NOT NULL DEFAULT '',            -- dia que a fase representa (data de conclusão para 'antes' e 'dN')
  capturado_em TEXT NOT NULL, atraso_dias INTEGER NOT NULL DEFAULT 0,  -- >0 = a captura aconteceu depois do marco
  estado_json TEXT NOT NULL,                                            -- atributos do anúncio (título, preço, fotos…) e métricas por dia até a captura
  PRIMARY KEY (tarefa_id, item_id, fase)
);
CREATE INDEX IF NOT EXISTS ix_tarefa_item_cliente ON tarefa_item (cliente, item_id);
CREATE TABLE IF NOT EXISTS retro_ciclo (         -- um retrato por cliente e por dia da leitura do Merovíngio: é o que permite avaliar o ciclo anterior
  cliente TEXT NOT NULL, dia TEXT NOT NULL, estado TEXT NOT NULL, variacao_pct REAL,
  resumo_json TEXT NOT NULL, criado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, dia)
);
${SCHEMA_MUDANCA}`

// Migração do CHECK (o SQLite não altera CHECK no lugar): recria a tabela com cópia, numa transação, preservando ids. Idempotente: migra sempre que
// as DUAS listas do CHECK (campo e fonte) do banco diferem das do DDL — a próxima ampliação da lista migra sozinha, sem trocar a chave aqui.
// O índice sai ANTES do RENAME: com o mesmo nome, o CREATE INDEX IF NOT EXISTS do DDL novo seria pulado e o DROP da v1 levaria o índice junto.
// Os ids são preservados; o contador AUTOINCREMENT recomeça do maior id (nada persiste id desta tabela fora da própria transação). Devolve true só quando migrou.
const CHECKS = SCHEMA_MUDANCA.match(/CHECK \([^)]*\)\)/g)
export function migrarMudanca(h) {
  const ddl = h.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='meli_item_mudanca'").get()?.sql || ''
  if (!ddl || CHECKS.every(c => ddl.includes(c))) return false
  h.transaction(() => {
    h.exec('DROP INDEX IF EXISTS ix_item_mudanca; ALTER TABLE meli_item_mudanca RENAME TO meli_item_mudanca_v1;')
    h.exec(SCHEMA_MUDANCA)
    h.exec(`INSERT INTO meli_item_mudanca (id, cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em)
      SELECT id, cliente, item_id, dia, campo, de, para, variacao_pct, fonte, em FROM meli_item_mudanca_v1; DROP TABLE meli_item_mudanca_v1;`)
  })()
  return true
}
