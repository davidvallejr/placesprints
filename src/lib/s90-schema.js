// Place Sprint 90: tabelas aditivas (docs/desenho-place-sprint-90.md, seção 2). Dinheiro só em centavos. Nenhuma coluna nova em tabela existente.
// s90_fatura / s90_pagamento / s90_mp_evento / s90_relatorio já nascem aqui (F3/F4 as preenchem) para o schema ser um só.
export const SCHEMA_S90 = `
CREATE TABLE IF NOT EXISTS s90_conta (
  id TEXT PRIMARY KEY,
  chave TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '',
  loja TEXT NOT NULL DEFAULT '', faixa_faturamento TEXT NOT NULL DEFAULT '',
  plano TEXT NOT NULL CHECK (plano IN ('fixo','crescimento')),
  preco_centavos INTEGER NOT NULL, comissao_pct INTEGER NOT NULL DEFAULT 0, preco_travado_ate TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('pendente_pagamento','ativo','inadimplente','pausado','cancelado','excluir_pendente','excluido')),
  mp_preapproval_id TEXT NOT NULL DEFAULT '', mp_payer_email TEXT NOT NULL DEFAULT '',
  primeiro_pagamento_em TEXT NOT NULL DEFAULT '', inicio_em TEXT NOT NULL DEFAULT '',
  arrependimento_ate TEXT NOT NULL DEFAULT '', cancelado_em TEXT NOT NULL DEFAULT '', excluido_em TEXT NOT NULL DEFAULT '',
  termos_versao TEXT NOT NULL DEFAULT '', termos_hash TEXT NOT NULL DEFAULT '', aceite_em TEXT NOT NULL DEFAULT '', aceite_ip TEXT NOT NULL DEFAULT '', aceite_ua TEXT NOT NULL DEFAULT '',
  consentimento_versao TEXT NOT NULL DEFAULT '', consentimento_em TEXT NOT NULL DEFAULT '',
  piloto INTEGER NOT NULL DEFAULT 0 CHECK (piloto IN (0,1)),   -- conta de piloto/demonstração criada pela equipe: a única que aceita termos em RASCUNHO
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
-- origem: o link que abriu a sessão ('equipe' | 'retorno' | 'painel'); sessão de 'painel' ("Guardar meu acesso", link que uma sessão gera e pode repassar) só RECONECTA o vendedor já ligado
CREATE TABLE IF NOT EXISTS s90_sessao (token_hash TEXT PRIMARY KEY, conta_id TEXT NOT NULL, criado_em TEXT NOT NULL, expira_em TEXT NOT NULL, ultimo_uso_em TEXT NOT NULL DEFAULT '', revogada_em TEXT NOT NULL DEFAULT '', origem TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS s90_acesso (token_hash TEXT PRIMARY KEY, conta_id TEXT NOT NULL, origem TEXT NOT NULL CHECK (origem IN ('retorno','painel','equipe')), criado_em TEXT NOT NULL, expira_em TEXT NOT NULL, usado_em TEXT NOT NULL DEFAULT '');
-- OAuth do ML amarrado à sessão que pediu: assinatura do link (sig) × sessão; uso único (usado_em) e 10 min. Sem a sessão dona, o código nem é trocado.
-- volta: host LOOPBACK de quem pediu (teste/piloto da equipe em localhost) — o callback devolve code+state para lá; '' = host S90
CREATE TABLE IF NOT EXISTS s90_oauth (sig_hash TEXT NOT NULL, sessao_hash TEXT NOT NULL, conta_id TEXT NOT NULL, criado_em TEXT NOT NULL, expira_em TEXT NOT NULL, usado_em TEXT NOT NULL DEFAULT '', volta TEXT NOT NULL DEFAULT '', PRIMARY KEY (sig_hash, sessao_hash));
CREATE TABLE IF NOT EXISTS s90_fatura (
  id TEXT PRIMARY KEY, conta_id TEXT NOT NULL, competencia TEXT NOT NULL, tipo TEXT NOT NULL CHECK (tipo IN ('assinatura','comissao')),
  valor_centavos INTEGER NOT NULL, base_centavos INTEGER NOT NULL DEFAULT 0, base_json TEXT NOT NULL DEFAULT '{}',
  estado TEXT NOT NULL CHECK (estado IN ('calculada','bloqueada_dados','emitida','paga','vencida','divergente','contestada','estornada','estorno_pendente','cancelada','revisada')),
  mp_preference_id TEXT NOT NULL DEFAULT '', mp_payment_id TEXT NOT NULL DEFAULT '', emitida_em TEXT NOT NULL DEFAULT '', vencimento TEXT NOT NULL DEFAULT '', paga_em TEXT NOT NULL DEFAULT '',
  valor_pago_centavos INTEGER NOT NULL DEFAULT 0, nota TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  UNIQUE (conta_id, competencia, tipo)
);
CREATE TABLE IF NOT EXISTS s90_pagamento (mp_payment_id TEXT PRIMARY KEY, conta_id TEXT NOT NULL, fatura_id TEXT NOT NULL DEFAULT '', origem TEXT NOT NULL CHECK (origem IN ('preapproval','preference','orfao')), valor_centavos INTEGER NOT NULL, status TEXT NOT NULL, status_detail TEXT NOT NULL DEFAULT '', recebido_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS s90_mp_evento (evento_id TEXT PRIMARY KEY, tipo TEXT NOT NULL, recurso_id TEXT NOT NULL, recebido_em TEXT NOT NULL, processado_em TEXT NOT NULL DEFAULT '', resultado TEXT NOT NULL DEFAULT '', tentativas INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS s90_evento (id INTEGER PRIMARY KEY AUTOINCREMENT, conta_id TEXT NOT NULL, tipo TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', detalhe_json TEXT NOT NULL DEFAULT '{}', ip TEXT NOT NULL DEFAULT '', em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS s90_relatorio (cliente TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL, html TEXT NOT NULL, gerado_em TEXT NOT NULL, origem TEXT NOT NULL, PRIMARY KEY (cliente, de));
CREATE INDEX IF NOT EXISTS ix_s90_evento_conta ON s90_evento (conta_id, em);
CREATE INDEX IF NOT EXISTS ix_s90_fatura_conta ON s90_fatura (conta_id, competencia);
`
