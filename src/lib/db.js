import Database from 'better-sqlite3'
import { SCHEMA_ACOMP, migrarMudanca } from './acomp-schema.js'
import { SCHEMA_FICHA } from './ficha-schema.js'
import { SCHEMA_FILTROS } from './filtros.js'
import { SCHEMA_OFERTAS, migrarOfertas } from './ofertas-schema.js'
import { SCHEMA_DEPENDENCIA } from './dependencia-cliente.js'
import { SCHEMA_CUSTO_VINCULO } from './custo-vinculo.js'
import { SCHEMA_RELATORIO } from './relatorio-envio.js'
import { migrarCatalogo } from './catalogo-db.js'
import { SCHEMA_PENDENCIAS } from './pendencias-cliente.js'
import { SCHEMA_ALERTA } from './alerta-cliente.js'
import { SCHEMA_S90 } from './s90-schema.js'
import { SCHEMA_NOTION_CLIENTE } from './notion-cliente.js'
import { SCHEMA_SNAPSHOT } from './snapshot-schema.js'
import { SCHEMA_SAUDE } from './saude-schema.js'
import { SCHEMA_GATILHOS } from './gatilhos-schema.js'
import { SCHEMA_ALINHAMENTO } from './alinhamentos-schema.js'
import { SCHEMA_FEEDBACK } from './respostas-relatorio.js'
import { SCHEMA_LIVRO } from './livro-registro.js'
import { SCHEMA_RISCO } from './risco-cliente.js'
import { SCHEMA_CONTRATO } from './contrato-cliente.js'
import { SCHEMA_DOSSIE } from './dossie.js'
import { SCHEMA_PERFIL_INFO } from './perfil-informacao.js'
import { SCHEMA_LEAD_TIME } from './lead-time.js'
import { SCHEMA_PRODUTO, migrarEstoqueDeclarado } from './produto-estoque.js'
import { SCHEMA_CHAVEIRO } from './chaveiro-estoque.js'
import { SCHEMA_EXECUTOR } from './chaveiro-executor.js'
import { SCHEMA_CONCORRENCIA } from './concorrencia.js'
import { SCHEMA_NOTA } from './nota-fiscal.js'
import { SCHEMA_ERP } from './relatorios-ciclo.js'
import { SCHEMA_GUARDIAO } from './guardiao.js'
import { SCHEMA_ENCONTROS } from './encontros.js'
import { semChaveS90 } from './s90-chave.js'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { ROOT } from './env.js'

mkdirSync(join(ROOT, 'data'), { recursive: true })
// PS_DB_MEMORIA=1 (só autotestes, ANTES de qualquer import): o motor inteiro roda num banco em memória com o MESMO schema — data/db.sqlite nem é aberto
export const db = new Database(process.env.PS_DB_MEMORIA === '1' ? ':memory:' : join(ROOT, 'data', 'db.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 30000')   // outro processo (script, teste) segurando a escrita por segundos NÃO pode fazer a gravação de um token renovado falhar

db.exec(`
CREATE TABLE IF NOT EXISTS tarefas (
  id TEXT PRIMARY KEY,              -- page_id do Notion
  fonte TEXT NOT NULL,              -- database/data_source de origem
  cliente TEXT NOT NULL DEFAULT '',
  projeto TEXT NOT NULL DEFAULT '',
  sprint TEXT NOT NULL DEFAULT '',
  titulo TEXT NOT NULL DEFAULT '',
  processo TEXT NOT NULL DEFAULT '',
  responsavel TEXT NOT NULL DEFAULT '',
  status_raw TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'nao_iniciada',  -- categoria normalizada
  prioridade TEXT NOT NULL DEFAULT '',
  data_inicio TEXT, prazo TEXT, data_conclusao TEXT,
  esforco REAL,
  resultado_esperado TEXT NOT NULL DEFAULT '',
  resultado_alcancado TEXT NOT NULL DEFAULT '',
  impacto TEXT NOT NULL DEFAULT '',
  bloqueio TEXT NOT NULL DEFAULT '',
  proximo_passo TEXT NOT NULL DEFAULT '',
  visivel_cliente INTEGER NOT NULL DEFAULT 1,
  descricao TEXT NOT NULL DEFAULT '',
  conteudo TEXT NOT NULL DEFAULT '',            -- texto dos blocos internos
  url TEXT NOT NULL DEFAULT '',
  last_edited TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL DEFAULT '',                -- hash do conteúdo relevante
  sync_em TEXT NOT NULL DEFAULT '',
  arquivada INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_tarefas_filtro ON tarefas (cliente, projeto, sprint, status);
`)

// Migrações aditivas — SQLite não tem "ADD COLUMN IF NOT EXISTS", então
// checamos o schema atual antes de alterar (idempotente, seguro em toda
// inicialização, nunca perde os dados já sincronizados).
db.exec(`
CREATE TABLE IF NOT EXISTS evidencias (
  id TEXT PRIMARY KEY,              -- block_id do Notion (ou id sintético)
  tarefa_id TEXT NOT NULL REFERENCES tarefas(id),
  tipo TEXT NOT NULL,               -- image | file | pdf | video | bookmark | embed
  url_origem TEXT NOT NULL DEFAULT '',
  arquivo_local TEXT NOT NULL DEFAULT '',       -- caminho relativo em data/evidencias
  legenda TEXT NOT NULL DEFAULT '',
  criada_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_evid_tarefa ON evidencias (tarefa_id);

-- histórico de mudanças relevantes (sprint/status) p/ detectar transferências
CREATE TABLE IF NOT EXISTS historico (
  tarefa_id TEXT NOT NULL,
  campo TEXT NOT NULL,
  de TEXT, para TEXT,
  em TEXT NOT NULL
);

-- fotografia diária por (cliente, projeto, sprint) para o burnup
CREATE TABLE IF NOT EXISTS snapshots (
  dia TEXT NOT NULL,
  cliente TEXT NOT NULL, projeto TEXT NOT NULL, sprint TEXT NOT NULL,
  planejadas INTEGER, concluidas INTEGER,
  esforco_planejado REAL, esforco_concluido REAL,
  PRIMARY KEY (dia, cliente, projeto, sprint)
);

CREATE TABLE IF NOT EXISTS sync_estado (
  chave TEXT PRIMARY KEY, valor TEXT
);

CREATE TABLE IF NOT EXISTS sync_log (
  em TEXT NOT NULL, nivel TEXT NOT NULL, msg TEXT NOT NULL
);

-- planos de ação mensais (tabelas 5W2H da base "Informações" de cada cliente)
CREATE TABLE IF NOT EXISTS planos_acao (
  cliente TEXT NOT NULL, ano_mes TEXT NOT NULL, canal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  acoes_json TEXT NOT NULL DEFAULT '[]',
  url TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, ano_mes, canal)
);

-- histórico semanal de métricas do painel (base do crescimento/faturamento)
CREATE TABLE IF NOT EXISTS metricas_semana (
  cliente TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL,
  faturamento REAL, vendas REAL, unidades REAL, visitas REAL,
  conversao REAL, ticket_medio REAL,
  ads_json TEXT NOT NULL DEFAULT '',
  comparativo TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, de)
);

-- conexões OAuth com o Mercado Livre, uma por cliente. access/refresh_token
-- ficam cifrados (ver cripto.js) — nunca em texto puro, mesmo localmente.
CREATE TABLE IF NOT EXISTS meli_contas (
  cliente TEXT PRIMARY KEY,
  meli_user_id INTEGER,
  nickname TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expira_em TEXT NOT NULL,
  escopos TEXT NOT NULL DEFAULT '',
  conectado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  erro TEXT NOT NULL DEFAULT ''
);

-- clientes da central (equipe, canais, tier) — atualizada a cada leitura da central
CREATE TABLE IF NOT EXISTS clientes_central (
  cliente TEXT PRIMARY KEY,
  status_cs TEXT NOT NULL DEFAULT '', tier TEXT NOT NULL DEFAULT '', nicho TEXT NOT NULL DEFAULT '',
  canais_json TEXT NOT NULL DEFAULT '[]',
  consultores_json TEXT NOT NULL DEFAULT '{}',     -- { ML: "Giovanna Torres", ... } (texto cru da central)
  lideres_json TEXT NOT NULL DEFAULT '{}',
  atualizado_em TEXT NOT NULL
);

-- usuários do Notion (id↔nome) colhidos de propriedades "people" — o token não lista usuários
CREATE TABLE IF NOT EXISTS usuarios_notion (
  id TEXT PRIMARY KEY, nome TEXT NOT NULL, nome_norm TEXT NOT NULL,
  vistas INTEGER NOT NULL DEFAULT 1, visto_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_usuarios_norm ON usuarios_notion (nome_norm);

-- ações dos planos por cliente. ID estável = hash(cliente|regra|alvo|mês): regerar o plano
-- nunca duplica nem sobrescreve decisão já tomada (aprovada/distribuída/descartada).
CREATE TABLE IF NOT EXISTS meli_notificacoes (  -- notificações cruas do ML (registro; não é fonte de número)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic TEXT NOT NULL DEFAULT '', resource TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '', application_id TEXT NOT NULL DEFAULT '',
  corpo TEXT NOT NULL DEFAULT '', recebido_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meli_item (          -- anúncios do vendedor (visão do comprador em cache)
  cliente TEXT NOT NULL, item_id TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '', permalink TEXT NOT NULL DEFAULT '', thumb TEXT NOT NULL DEFAULT '',
  preco REAL, status TEXT NOT NULL DEFAULT '', estoque INTEGER, vendidos INTEGER,
  fotos INTEGER, frete_gratis INTEGER, catalogo INTEGER, tipo_anuncio TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL DEFAULT '',
  visao_json TEXT NOT NULL DEFAULT '', visao_em TEXT NOT NULL DEFAULT '',   -- avaliações, price_to_win, etc.
  vis_de TEXT NOT NULL DEFAULT '', vis_ate TEXT NOT NULL DEFAULT '',        -- cobertura da série de visitas
  atualizado_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, item_id)
);
CREATE TABLE IF NOT EXISTS meli_serie_item (    -- série DIÁRIA por anúncio (dia ausente em dia coletado = 0)
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, dia TEXT NOT NULL,
  unidades INTEGER NOT NULL DEFAULT 0, receita REAL NOT NULL DEFAULT 0, visitas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cliente, item_id, dia)
);
CREATE TABLE IF NOT EXISTS meli_coleta_dia (    -- dias de PEDIDOS já coletados (distingue "0 vendas" de "não coletado")
  cliente TEXT NOT NULL, dia TEXT NOT NULL, pedidos INTEGER NOT NULL DEFAULT 0, truncado INTEGER NOT NULL DEFAULT 0, coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, dia)
);
CREATE TABLE IF NOT EXISTS meli_ads_item (      -- Product Ads por anúncio (janela de 28 dias: 'atual' e 'anterior')
  cliente TEXT NOT NULL, item_id TEXT NOT NULL, periodo TEXT NOT NULL, de TEXT NOT NULL, ate TEXT NOT NULL,
  prints INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, custo REAL NOT NULL DEFAULT 0,
  receita REAL NOT NULL DEFAULT 0, unidades INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '', buy_box INTEGER, logistica TEXT NOT NULL DEFAULT '', nivel TEXT NOT NULL DEFAULT '', catalogo INTEGER,
  coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id, periodo)
);
CREATE TABLE IF NOT EXISTS custos_cliente (     -- custos informados pelo time/cliente (nunca inventados)
  cliente TEXT PRIMARY KEY, custos_json TEXT NOT NULL DEFAULT '{}', atualizado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metas_cliente (          -- metas cadastradas pelo time (nunca inventadas)
  cliente TEXT NOT NULL, mes TEXT NOT NULL,          -- mes = 'YYYY-MM'
  metas_json TEXT NOT NULL DEFAULT '{}',             -- { gmv, pedidos, margem_pct, roas, acos_max, conversao, entregas }
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, mes)
);
CREATE TABLE IF NOT EXISTS acoes_plano (
  id TEXT PRIMARY KEY,                -- PS-xxxxxx
  cliente TEXT NOT NULL, canal TEXT NOT NULL DEFAULT '', regra TEXT NOT NULL, mes TEXT NOT NULL,
  titulo TEXT NOT NULL, horizonte TEXT NOT NULL, prazo TEXT NOT NULL,
  responsavel TEXT NOT NULL DEFAULT '', squad TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  dados_json TEXT NOT NULL,           -- evidência, ação, indicador, meta, critério de aceite, lógica do score…
  status TEXT NOT NULL DEFAULT 'proposta',   -- proposta | aprovada | descartada | distribuida | obsoleta
  notion_page_id TEXT NOT NULL DEFAULT '', notion_url TEXT NOT NULL DEFAULT '', erro TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, distribuido_em TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_acoes_cliente ON acoes_plano (cliente, status);

-- plano completo mais recente por cliente (diagnóstico, fontes, pendências, calendário)
CREATE TABLE IF NOT EXISTS planos_cliente (
  cliente TEXT PRIMARY KEY, gerado_em TEXT NOT NULL, plano_json TEXT NOT NULL
);

-- cache da camada inteligente: se o hash não mudou, reutiliza
CREATE TABLE IF NOT EXISTS ia_cache (
  escopo TEXT PRIMARY KEY,          -- ex.: resumo:{cliente}:{projeto}:{sprint}
  hash TEXT NOT NULL,
  prompt_versao TEXT NOT NULL,
  texto TEXT NOT NULL,
  gerado_em TEXT NOT NULL,
  origem TEXT NOT NULL              -- 'ia' | 'deterministico'
);

-- perfil(is) e objetivo do cliente no Relatório Semanal (ids validados contra config/perfis-cliente.json)
CREATE TABLE IF NOT EXISTS perfil_cliente (
  cliente TEXT PRIMARY KEY, perfis_json TEXT NOT NULL DEFAULT '[]', objetivo TEXT NOT NULL DEFAULT '',
  atualizado_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT ''
);
`)

// migrações aditivas (idempotentes) — DEPOIS do schema completo: num banco novo as tabelas já existem aqui
const colunasTarefas = new Set(db.prepare("PRAGMA table_info(tarefas)").all().map(c => c.name))
db.exec(`CREATE TABLE IF NOT EXISTS analistas_oficiais (   -- base de RH do Notion: quem É analista de marketplace
  nome TEXT PRIMARY KEY, nome_norm TEXT NOT NULL, cargo TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL
)`)
const colunasCentral = new Set(db.prepare("PRAGMA table_info(clientes_central)").all().map(c => c.name))
const colunasAcoes = new Set(db.prepare("PRAGMA table_info(acoes_plano)").all().map(c => c.name))
for (const [col, def] of [['item_id', "TEXT NOT NULL DEFAULT ''"], ['previsao_json', "TEXT NOT NULL DEFAULT ''"], ['algoritmo_versao', "TEXT NOT NULL DEFAULT ''"]])
  if (!colunasAcoes.has(col)) db.exec(`ALTER TABLE acoes_plano ADD COLUMN ${col} ${def}`)
if (!colunasAcoes.has('resultado_json'))             // aprendizado: antes/depois registrado por ação executada
  db.exec("ALTER TABLE acoes_plano ADD COLUMN resultado_json TEXT NOT NULL DEFAULT ''")
for (const col of ['cnpj', 'cpf', 'responsavel', 'vencimentos_json'])
  if (!colunasCentral.has(col)) db.exec(`ALTER TABLE clientes_central ADD COLUMN ${col} TEXT NOT NULL DEFAULT '${col.endsWith('_json') ? '{}' : ''}'`)
// cadastro do cliente (CS, health score, observações — docs/cadastro-clientes.md): colunas que o sincronizarEquipe NÃO escreve, logo o sync nunca as zera
for (const [col, def] of [['cs_responsavel', "TEXT NOT NULL DEFAULT ''"], ['health_score', 'REAL'], ['hs_classificacao', "TEXT NOT NULL DEFAULT ''"], ['hs_em', "TEXT NOT NULL DEFAULT ''"],
  ['canais_cs_json', "TEXT NOT NULL DEFAULT '[]'"], ['cadastro_fonte', "TEXT NOT NULL DEFAULT ''"], ['observacoes', "TEXT NOT NULL DEFAULT ''"]])
  if (!colunasCentral.has(col)) db.exec(`ALTER TABLE clientes_central ADD COLUMN ${col} ${def}`)
if (!colunasTarefas.has('tipo_demanda'))
  db.exec("ALTER TABLE tarefas ADD COLUMN tipo_demanda TEXT NOT NULL DEFAULT ''")
if (!colunasTarefas.has('etiquetas'))                   // etiqueta/Tag do card no Notion ("Solicitação Seller", "Plano de Ação"…; config/mapeamento.json → etiquetas)
  db.exec("ALTER TABLE tarefas ADD COLUMN etiquetas TEXT NOT NULL DEFAULT ''")
// ── acompanhamento por tarefa (antes/depois por anúncio): série diária de Ads, vínculo tarefa→anúncio e fotos do estado ──
if (!db.prepare("PRAGMA table_info(meli_item)").all().some(c => c.name === 'logistica'))   // fulfillment/cross_docking/drop_off… (Full = fulfillment)
  db.exec("ALTER TABLE meli_item ADD COLUMN logistica TEXT NOT NULL DEFAULT ''")
db.exec(SCHEMA_ACOMP)
migrarMudanca(db)         // CHECK de meli_item_mudanca ampliado (promocao/ads): recria com cópia só em banco criado antes; idempotente
db.exec(SCHEMA_FICHA)
db.exec(SCHEMA_FILTROS)
db.exec(SCHEMA_DEPENDENCIA)   // encerramento por dependência do cliente (tarefa_dependencia; idempotente) — antes do sync, que marca a reabertura nela
db.exec(SCHEMA_OFERTAS)   // Ofertas Estratégicas (12 tabelas of_*; idempotente)
migrarOfertas(db)         // colunas aditivas (of_job.acao_id, of_job.dados_json) em bancos criados antes delas
if (!colunasAcoes.has('delegado_a'))                   // prestador escolhido na aprovação da tarefa (vale mais que a ficha do cliente)
  db.exec("ALTER TABLE acoes_plano ADD COLUMN delegado_a TEXT NOT NULL DEFAULT ''")
if (!db.prepare("PRAGMA table_info(meli_contas)").all().some(c => c.name === 'app_id'))   // app do ML que emitiu o token ('' = principal)
  db.exec("ALTER TABLE meli_contas ADD COLUMN app_id TEXT NOT NULL DEFAULT ''")
if (!db.prepare("PRAGMA table_info(meli_contas)").all().some(c => c.name === 'uf'))       // UF do vendedor (address.state do /users; '' = sem UF registrada — nunca deduzida)
  db.exec("ALTER TABLE meli_contas ADD COLUMN uf TEXT NOT NULL DEFAULT ''")
if (!db.prepare("PRAGMA table_info(meli_item)").all().some(c => c.name === 'preco_original'))   // original_price da API (preço "de" riscado); null = sem desconto ou ainda não coletado
  db.exec("ALTER TABLE meli_item ADD COLUMN preco_original REAL")
if (!db.prepare("PRAGMA table_info(meli_item)").all().some(c => c.name === 'category_id'))      // category_id do multiget (benchmark de conversão por categoria da própria conta); '' = ainda não coletada, nunca inventada
  db.exec("ALTER TABLE meli_item ADD COLUMN category_id TEXT NOT NULL DEFAULT ''")
db.exec(SCHEMA_CUSTO_VINCULO)   // vínculo manual custo ↔ anúncio (custo_vinculo; idempotente)
db.exec(SCHEMA_RELATORIO)       // Relatório de Sprints ao Notion do cliente: programação + log de envios (relatorio_programacao/relatorio_envio; idempotente)
migrarCatalogo(db)              // catálogo: meli_item.catalogo_produto_id, perfil_cliente.catalogo_proprio e catalogo_origem (aditivo, idempotente)
db.exec(SCHEMA_PENDENCIAS)       // pendências do cliente registradas à mão (pendencia_cliente; idempotente) — catálogo em config/dependencias-cliente.json
db.exec(SCHEMA_ALERTA)           // alerta de pendência crítica ao cliente (alerta_cliente; idempotente) — config/alerta-cliente.json
db.exec(SCHEMA_S90)              // Place Sprint 90 (s90_*; aditivo, idempotente) — docs/desenho-place-sprint-90.md seção 2
db.exec(SCHEMA_NOTION_CLIENTE)
db.exec(SCHEMA_SNAPSHOT)         // "Como era" do anúncio (meli_item_snapshot; aditivo, idempotente) — src/lib/anuncio-historico.js   // Notion do cliente no painel (cliente_notion_pagina / cliente_informacoes; aditivo, idempotente) — docs/notion-cliente.md
db.exec(SCHEMA_SAUDE)            // Saúde da conta gravada (meli_conta_saude/meli_claim/meli_pergunta/meli_envio_atraso/meli_full_estoque; aditivo, idempotente) — src/lib/saude-coleta.js
db.exec(SCHEMA_GATILHOS)         // Gatilhos ao cliente (gatilho_cliente/gatilho_lote; aditivo, idempotente) — src/lib/gatilhos.js, config/gatilhos.json
db.exec(SCHEMA_ALINHAMENTO)      // Alinhamentos com o cliente — exceções intencionais (alinhamento; aditivo, idempotente) — src/lib/alinhamentos.js, config/alinhamentos.json
db.exec(SCHEMA_FEEDBACK)         // Respostas dos clientes ao relatório (feedback_relatorio/feedback_coleta; aditivo, idempotente) — src/lib/respostas-relatorio.js
if (!db.prepare('PRAGMA table_info(feedback_relatorio)').all().some(c => c.name === 'origem'))   // feedback curado pela equipe (13/10/2026) — perfil-informacao.js
  db.exec("ALTER TABLE feedback_relatorio ADD COLUMN origem TEXT NOT NULL DEFAULT 'whatsapp' CHECK (origem IN ('whatsapp','equipe'))")
db.exec(SCHEMA_LIVRO)            // Livro de registro do cliente (registro_cliente append-only + triggers que barram UPDATE/DELETE; aditivo, idempotente) — src/lib/livro-registro.js
db.exec(SCHEMA_RISCO)            // Cliente em risco (risco_cliente; marcação por líder/consultor/CS) — src/lib/risco-cliente.js
db.exec(SCHEMA_CONTRATO)         // Contrato e pagamentos do cliente (contrato_cliente/pagamento_cliente; arquivos em data/dossies/docs) — src/lib/contrato-cliente.js
db.exec(SCHEMA_DOSSIE)           // Prestação de contas / Dossiê de defesa gerados + envio mensal ao #growth (dossie_gerado/dossie_mensal; arquivos em data/dossies/<cliente>) — src/lib/dossie.js
db.exec(SCHEMA_PERFIL_INFO)       // Perfil de informação do cliente (perfil_informacao + histórico append-only; aditivo, idempotente) — src/lib/perfil-informacao.js, config/perfil-informacao.json
db.exec(SCHEMA_LEAD_TIME)         // Prazo de reposição informado (lead_time_cliente: conta toda, anúncio ou SKU; aditivo, idempotente) — src/lib/lead-time.js, Algoritmo v1.6.0
db.exec(SCHEMA_CONCORRENCIA)      // Concorrentes acompanhados pelo consultor por anúncio (concorrente_anuncio; aditivo, idempotente) — src/lib/concorrencia.js, bloco 🆚 do relatório
db.exec(SCHEMA_PRODUTO)           // V3 F1: chaves do produto por anúncio/variação (meli_anuncio_up) e linhas de pedido (meli_pedido_item); aditivo, idempotente — src/lib/produto-estoque.js
migrarEstoqueDeclarado(db)        // V3 F6: CHECK de fonte do estoque declarado + erp/planilha (recria com cópia só em banco criado antes; idempotente)
db.exec(SCHEMA_CHAVEIRO)          // V3 F6: Chaveiro — exec_politica, exec_ordem, exec_evento (append-only) e produto_regra_estoque; aditivo, idempotente — src/lib/chaveiro-estoque.js
db.exec(SCHEMA_EXECUTOR)          // Chaveiro F4+: exec_liberacao (cliente × operação, estreia, Neo com veto) e exec_estrategia (estratégias próprias); aditivo, idempotente — src/lib/chaveiro-executor.js
db.exec(SCHEMA_NOTA)              // V3 F8: nota fiscal (cliente_fiscal, termo_fiscal, regra_fiscal_produto, nota_fiscal, nota_item, nota_evento append-only); aditivo, idempotente — src/lib/nota-fiscal.js
db.exec(SCHEMA_ERP)               // V3 F9: razão de estoque (estoque_mov, append-only por TRIGGER) e pedidos ao fornecedor (compra_fornecedor); aditivo, idempotente — src/lib/relatorios-ciclo.js
db.exec(SCHEMA_GUARDIAO)          // Agente Smith G0: lojas do mesmo dono (conta_canal) e quem decidiu cada mudança de preço (preco_decisao, 1 clique); aditivo, idempotente — src/lib/guardiao.js
db.exec(SCHEMA_ENCONTROS)         // Place Prime: sidecar do card de encontro (encontro_info: tipo, quem conduziu, gravação sem query, transcrição por sha256, treinado da lista fechada, consentimento); aditivo, idempotente — src/lib/encontros.js
// configuração de avisos ao cliente (canais, ritmo, silêncio, liberação; lista fechada em gatilhos.js): coluna que o sincronizarEquipe NÃO escreve, logo o sync nunca a zera
if (!colunasCentral.has('notificacao_json')) db.exec("ALTER TABLE clientes_central ADD COLUMN notificacao_json TEXT NOT NULL DEFAULT '{}'")
for (const [t, col, def] of [['s90_sessao', 'origem', "TEXT NOT NULL DEFAULT ''"], ['s90_oauth', 'volta', "TEXT NOT NULL DEFAULT ''"], ['s90_conta', 'piloto', 'INTEGER NOT NULL DEFAULT 0'],
    ['meli_coleta_dia', 'linhas', 'INTEGER NOT NULL DEFAULT 0']])   // colunas nascidas depois da tabela (CREATE IF NOT EXISTS não as acrescenta); meli_coleta_dia.linhas (V3 F1): 1 = linhas de pedido do dia gravadas — dia anterior à F1 = «não coletado», nunca zero
  if (!db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${def}`)

export const agora = () => new Date().toISOString()
// dia local (não UTC): à noite no Brasil, toISOString já viraria o dia seguinte
export const hojeLocal = () => {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}
let logsDesdePoda = 0
export const log = (nivel, msg) => {
  msg = semChaveS90(msg).slice(0, 600)                                    // corpo de webhook/erro gigante nunca vira linha gigante no banco; chave S90 sai só como id (o stdout vira data/server.log)
  const em = agora()
  // autogestão (15/10/2026): o stdout vira data/server.log — com hora ISO e ANTES do banco, para o rastro sobreviver quando o banco não abre (disco cheio)
  console.log(`${em} [${nivel}] ${msg}`)
  try { db.prepare('INSERT INTO sync_log (em, nivel, msg) VALUES (?,?,?)').run(em, nivel, msg) } catch { return }   // log nunca derruba quem chamou
  // sync_log não tem coluna id: a poda usa o rowid (com "id" o DELETE falhava calado e o log crescia sem limite)
  if (++logsDesdePoda >= 200) { logsDesdePoda = 0; try { db.prepare('DELETE FROM sync_log WHERE rowid NOT IN (SELECT rowid FROM sync_log ORDER BY rowid DESC LIMIT 5000)').run() } catch { /* poda é melhor esforço */ } }
}
export const getEstado = chave =>
  db.prepare('SELECT valor FROM sync_estado WHERE chave = ?').get(chave)?.valor
export const setEstado = (chave, valor) =>
  db.prepare('INSERT INTO sync_estado (chave, valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor)
