// DDL da ficha do cliente e dos prestadores. Módulo próprio para o banco real (db.js) e os autotestes (banco em memória) usarem o MESMO texto.
export const SCHEMA_FICHA = `
CREATE TABLE IF NOT EXISTS prestadores (          -- base "Cadastro de Prestadores de serviço" do Notion: SÓ quem está Ativo; só nome, cargo, área e clientes (nada de CPF, salário ou banco)
  nome TEXT PRIMARY KEY, nome_norm TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
  atuacao_json TEXT NOT NULL DEFAULT '[]', atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ficha_cliente (        -- links das contas e dos materiais do cliente (como o perfil, mas de quem e onde)
  cliente TEXT PRIMARY KEY, links_json TEXT NOT NULL DEFAULT '{}', observacao TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ficha_prestador (      -- quem atende o cliente: por canal ('' = todos) e papel
  cliente TEXT NOT NULL, canal TEXT NOT NULL DEFAULT '', papel TEXT NOT NULL, prestador TEXT NOT NULL,
  PRIMARY KEY (cliente, canal, papel)
);
`
