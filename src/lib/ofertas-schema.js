// DDL do módulo Ofertas Estratégicas (prefixo of_). Módulo próprio para o banco real (db.js) e os autotestes (banco em memória) usarem o MESMO texto.
// Identidade: Produto (físico) → Variante (cor/tamanho, SKU único POR CLIENTE) → Anúncio (canal+conta+id externo+variação). Toda tabela carrega `cliente`.
export const SCHEMA_OFERTAS = `
CREATE TABLE IF NOT EXISTS of_produto (
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '', marca TEXT NOT NULL DEFAULT '', modelo TEXT NOT NULL DEFAULT '',
  gtin TEXT NOT NULL DEFAULT '', mpn TEXT NOT NULL DEFAULT '', categoria_canal TEXT NOT NULL DEFAULT '', descricao_base TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_of_produto_cliente ON of_produto (cliente);

CREATE TABLE IF NOT EXISTS of_variante (            -- unidade vendável; vazio = desconhecido (NULL), nunca 0
  id TEXT PRIMARY KEY, produto_id TEXT NOT NULL, cliente TEXT NOT NULL,
  sku TEXT NOT NULL, sku_pai TEXT NOT NULL DEFAULT '',
  cor TEXT NOT NULL DEFAULT '', tamanho TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT '',
  quantidade_kit INTEGER, unidade_venda TEXT NOT NULL DEFAULT '',
  peso_kg REAL, peso_embalado_kg REAL, alt_cm REAL, larg_cm REAL, comp_cm REAL, estoque INTEGER,
  consultor TEXT NOT NULL DEFAULT '', analista TEXT NOT NULL DEFAULT '', prioridade TEXT NOT NULL DEFAULT '', objetivo TEXT NOT NULL DEFAULT '',
  referencia_confirmada INTEGER NOT NULL DEFAULT 0, confirmado_por TEXT NOT NULL DEFAULT '', confirmado_em TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  UNIQUE (cliente, sku)
);
CREATE INDEX IF NOT EXISTS ix_of_variante_cliente ON of_variante (cliente, produto_id);

CREATE TABLE IF NOT EXISTS of_anuncio (             -- representação da variante numa conta/canal; chave externa = canal+conta+anuncio+variação
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, variante_id TEXT NOT NULL DEFAULT '',
  canal TEXT NOT NULL, conta_id TEXT NOT NULL DEFAULT '', anuncio_id TEXT NOT NULL, variacao_externa_id TEXT NOT NULL DEFAULT '',
  catalogo_id TEXT NOT NULL DEFAULT '', categoria_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  titulo_atual TEXT NOT NULL DEFAULT '', preco_atual REAL, estoque_canal INTEGER, status_canal TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}', sincronizado_em TEXT NOT NULL DEFAULT '',
  UNIQUE (cliente, canal, conta_id, anuncio_id, variacao_externa_id)
);
CREATE INDEX IF NOT EXISTS ix_of_anuncio_cliente ON of_anuncio (cliente, variante_id);

CREATE TABLE IF NOT EXISTS of_atributo (            -- ficha por variante × canal/categoria × atributo, com fonte e evidência
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, variante_id TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT '', categoria_id TEXT NOT NULL DEFAULT '', atributo_id TEXT NOT NULL,
  nome TEXT NOT NULL DEFAULT '', tipo TEXT NOT NULL DEFAULT '', unidade TEXT NOT NULL DEFAULT '',
  valor_atual TEXT NOT NULL DEFAULT '', valor_proposto TEXT NOT NULL DEFAULT '',
  obrigatorio INTEGER NOT NULL DEFAULT 0, editavel INTEGER NOT NULL DEFAULT 1,
  fonte TEXT NOT NULL DEFAULT '', evidencia TEXT NOT NULL DEFAULT '', validacao TEXT NOT NULL DEFAULT '',
  aprovado_por TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL,
  UNIQUE (cliente, variante_id, canal, categoria_id, atributo_id)
);
CREATE INDEX IF NOT EXISTS ix_of_atributo_variante ON of_atributo (cliente, variante_id);

CREATE TABLE IF NOT EXISTS of_custo (               -- custo unitário por variante e vigência (fim_vigencia '' = aberta)
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, variante_id TEXT NOT NULL,
  moeda TEXT NOT NULL DEFAULT 'BRL', custo_compra REAL NOT NULL, frete_entrada REAL, embalagem REAL, preparo REAL, outros REAL,
  inicio_vigencia TEXT NOT NULL, fim_vigencia TEXT NOT NULL DEFAULT '', fonte TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_of_custo_variante ON of_custo (cliente, variante_id);

CREATE TABLE IF NOT EXISTS of_regra_canal (         -- taxas por canal/conta/modalidade: SEMPRE com fonte, consultado_em e validade (nada presumido)
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, canal TEXT NOT NULL, conta_id TEXT NOT NULL DEFAULT '', modalidade TEXT NOT NULL DEFAULT '',
  comissao_pct REAL, tarifa_fixa REAL, base_comissao TEXT NOT NULL DEFAULT '', tributos_pct REAL, frete_vendedor REAL,
  desconto_pct REAL, promo_pct REAL, devolucao_pct REAL, ads_pct REAL, margem_min_pct REAL, margem_alvo_pct REAL,
  fonte TEXT NOT NULL DEFAULT '', consultado_em TEXT NOT NULL DEFAULT '', validade TEXT NOT NULL DEFAULT '',
  UNIQUE (cliente, canal, conta_id, modalidade)
);

CREATE TABLE IF NOT EXISTS of_imagem (              -- ativo de imagem (original confirmado, candidata gerada, aprovada, publicada)
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, variante_id TEXT NOT NULL, job_id TEXT NOT NULL DEFAULT '',
  drive_file_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', caminho_local TEXT NOT NULL DEFAULT '',
  papel TEXT NOT NULL DEFAULT '', ordem INTEGER, canal TEXT NOT NULL DEFAULT '', versao INTEGER NOT NULL DEFAULT 0,
  hash TEXT NOT NULL DEFAULT '', largura INTEGER, altura INTEGER, bytes INTEGER,
  fonte TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'candidata', motivo_reprovacao TEXT NOT NULL DEFAULT '',
  aprovado_por TEXT NOT NULL DEFAULT '', aprovado_em TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_of_imagem_variante ON of_imagem (cliente, variante_id);
CREATE INDEX IF NOT EXISTS ix_of_imagem_job ON of_imagem (cliente, job_id);

CREATE TABLE IF NOT EXISTS of_job (                 -- trabalho de otimização/lançamento (máquina de estados em ofertas.js)
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, variante_id TEXT NOT NULL DEFAULT '', anuncio_id TEXT NOT NULL DEFAULT '',
  escopo TEXT NOT NULL, objetivo TEXT NOT NULL, modo TEXT NOT NULL DEFAULT 'publicar_apos_aprovacao',
  solicitante TEXT NOT NULL DEFAULT '', responsavel TEXT NOT NULL DEFAULT '', estado TEXT NOT NULL DEFAULT 'rascunho',
  pendencias_json TEXT NOT NULL DEFAULT '[]', proposta_versao INTEGER NOT NULL DEFAULT 0, aprovacao_id TEXT NOT NULL DEFAULT '',
  agendado_em TEXT NOT NULL DEFAULT '', publicado_em TEXT NOT NULL DEFAULT '', erro TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  acao_id TEXT NOT NULL DEFAULT '',            -- ação do plano (acoes_plano.id) que este job executa: criada pela regra oferta_* ou a ação equivalente que já existia
  dados_json TEXT NOT NULL DEFAULT '{}'        -- regra/tipo do motor, etapa do método, voz do cliente, briefing da duplicação, origem do responsável, dispensas
);
CREATE INDEX IF NOT EXISTS ix_of_job_cliente ON of_job (cliente, estado);
CREATE INDEX IF NOT EXISTS ix_of_job_variante ON of_job (cliente, variante_id);

CREATE TABLE IF NOT EXISTS of_proposta (            -- versões imutáveis da proposta (conteúdo, linha de base e diagnóstico)
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, cliente TEXT NOT NULL, versao INTEGER NOT NULL,
  conteudo_json TEXT NOT NULL DEFAULT '{}', baseline_json TEXT NOT NULL DEFAULT '{}', diagnostico_json TEXT NOT NULL DEFAULT '{}',
  criado_por TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL,
  UNIQUE (job_id, versao)
);
CREATE INDEX IF NOT EXISTS ix_of_proposta_job ON of_proposta (cliente, job_id);

CREATE TABLE IF NOT EXISTS of_aprovacao (           -- aprovação campo a campo de UMA versão; nova versão invalida (valida=0 + motivo)
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, cliente TEXT NOT NULL, proposta_versao INTEGER NOT NULL,
  campos_json TEXT NOT NULL DEFAULT '[]', autor TEXT NOT NULL, em TEXT NOT NULL,
  valida INTEGER NOT NULL DEFAULT 1, invalidada_motivo TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_of_aprovacao_job ON of_aprovacao (cliente, job_id);

CREATE TABLE IF NOT EXISTS of_publicacao (          -- etapa de publicação por canal; chave_idem = cliente|conta|anuncio|versao|operacao (nunca duplica)
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, cliente TEXT NOT NULL, canal TEXT NOT NULL, conta_id TEXT NOT NULL DEFAULT '',
  anuncio_id TEXT NOT NULL DEFAULT '', versao INTEGER NOT NULL, chave_idem TEXT NOT NULL UNIQUE, operacao TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', diff_json TEXT NOT NULL DEFAULT '{}', snapshot_antes_json TEXT NOT NULL DEFAULT '{}', resposta_json TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL DEFAULT 'preparada', erro TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, verificado_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_of_publicacao_job ON of_publicacao (cliente, job_id);

CREATE TABLE IF NOT EXISTS of_evento (              -- auditoria: toda transição/decisão com quem e por quê
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, entidade TEXT NOT NULL, entidade_id TEXT NOT NULL,
  acao TEXT NOT NULL, por TEXT NOT NULL DEFAULT '', detalhes_json TEXT NOT NULL DEFAULT '{}', em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_of_evento_entidade ON of_evento (cliente, entidade, entidade_id);
`
// migração ADITIVA (idempotente) para bancos criados antes das colunas novas — nunca apaga nem reescreve dado
export function migrarOfertas(h) {
  const cols = new Set(h.prepare('PRAGMA table_info(of_job)').all().map(c => c.name))
  if (!cols.has('acao_id')) h.exec("ALTER TABLE of_job ADD COLUMN acao_id TEXT NOT NULL DEFAULT ''")
  if (!cols.has('dados_json')) h.exec("ALTER TABLE of_job ADD COLUMN dados_json TEXT NOT NULL DEFAULT '{}'")
  h.exec('CREATE INDEX IF NOT EXISTS ix_of_job_acao ON of_job (cliente, acao_id)')
}
