# Notion do cliente no painel

Pedido do David (09/10/2026): "puxar os dados do Notion de todas as contas e trazer pro painel". Só leitura no Notion; nada é criado ou alterado lá.

## O que é lido, de onde

Para cada cliente da **central** (`clientes_central`; prospect `[Comercial] …` nunca):

1. **Página do cliente** — resolvida por `resolverPaginaCliente` (`src/lib/plano-informacoes.js`): pai do quadro «Tarefas - {Cliente}» ou o id da central validado. Guarda `page_id`, `url`, `titulo`.
2. **Filhos de 1º nível** da página (`GET blocks/{page}/children`, paginado): só `child_database` e `child_page` → `{ id, tipo: base|pagina, titulo, url }` em `filhos_json`.
3. **Base Informações** (filho `child_database` cujo título contém "Informa"): data source resolvido por `GET databases/{id}`; linhas por `POST data_sources/{ds}/query` paginado. Cada linha → `cliente_informacoes (row_id, cliente, titulo, secao, status, link, url, editado_em, lido_em)`. Título = propriedade do tipo `title` (na Place2u, «Lista »); Secção = select/status chamado Secção/Seção/Secao; Status = select/status chamado Status; Link = propriedade `url` chamada Link (ou a primeira `url`). Arquivada/lixeira não entra.

Tabelas (aditivas, idempotentes, `SCHEMA_NOTION_CLIENTE` em `src/lib/notion-cliente.js`): `cliente_notion_pagina (cliente PK, page_id, url, titulo, filhos_json, lido_em, erro)` e `cliente_informacoes`. Isolamento por cliente em toda consulta.

## Incremental × completo

- Marca `notion_info_desde:{cliente}` em `sync_estado`. Com marca, a consulta filtra `last_edited_time on_or_after` e faz upsert (linha apagada no Notion fica até a próxima leitura completa).
- Sem marca, ou `completo:true` (rota manual «Atualizar do Notion»), as linhas do cliente são substituídas em uma transação.
- Erro do Notion: `erro` = só o status (`Notion 502`), nunca o corpo; a leitura anterior fica. `retry5xx:false` em todas as chamadas (quem repete é o próximo sync).

## Quando roda

- **Etapa do sync** (`src/lib/sync.js`, depois das tarefas): os clientes mais antigos primeiro, try/catch por cliente, teto de 4 min (15 no `--completo`); o que não coube fica para o próximo. Nunca derruba o sync.
- **Manual**: `POST /api/cliente/notion/atualizar { cliente, por }` (um cliente, completo) e `POST /api/notion/atualizar-todos { por, confirmar }` (prévia sem `confirmar:true`; com ele, job sequencial com progresso em `GET /api/notion/job/:id`). `por` precisa ser líder/consultor (403). Um job por vez (409).
- **CLI**: `node scripts/notion-cliente.mjs [--completo] [--cliente "Nome"]` (banco real, fora do servidor).

## Painel

- `/cliente` → aba Resumo → seção recolhida **Notion do cliente** (`#secNotion`): link da página, filhos com link, tabela Informações (Seção · Item · Status · Link · Editado · abrir) com filtro por seção e busca, botão «Atualizar do Notion» com "lido em". `GET /api/cliente/notion?cliente=`.
- `/planos` → ⋯ do cabeçalho → **Atualizar Notion de todos** (prévia → confirmar → barra de progresso).

## Quadros não localizados (descoberta pela página)

`descobrirFontes` (`src/lib/descobrir.js`): quando «Tarefas - {Cliente}» não é achado pelo título, `descobrirQuadroNaPagina` olha os filhos de 1º nível da página do cliente cujo título contém "Tarefas" ou "Demandas". Um candidato → vira fonte e fica em `sync_estado` (`fonte_descoberta:{cliente}` = `{ db_id, ds_id, titulo, em }`), sem editar `config/fontes.json`; mais de um → aviso com os títulos; nenhum → aviso como antes. Para esquecer: apagar a chave em `sync_estado`.

## Limites

- Só o que a **integração** do Notion enxerga: página ou base não compartilhada com a integração = `sem_pagina` / `sem_informacoes` (não é "não existe").
- Rate limit do Notion (~3 req/s, throttle em `notion.js`): ~4–6 chamadas por cliente na leitura completa; 127 clientes ≈ 4–8 min. Por isso o teto de tempo no sync e o job em lote.
- Lê só o 1º nível da página e só a base Informações; conteúdo dos blocos internos das linhas não é lido (está nos planos 5W2H em `planos_acao`).
- Dado não lido = `pagina: null` / `erro` preenchido, nunca zero inventado.

Teste: `node scripts/teste-notion-cliente.mjs`.
