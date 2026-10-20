# ESPECIFICAÇÃO — Custos por SKU/MLB vindos de Bling, Tiny ou Planilha Sheets (via webhook)

Projeto: Place Sprints (`/Users/davidvallejr/place-sprints`, porta 3012, Node 22, Express, better-sqlite3).
Data da especificação: 05/10/2026. Autor: arquiteto (fase de pesquisa, sem credenciais, sem código escrito).
Status: PRONTA PARA CONSTRUÇÃO PARALELA. Nada aqui foi validado contra Bling, Tiny ou Google reais (seção 14).

Pedido do dono: "Consegue integrar nos custos do sistema BLING ERP ou TINY ERP, ou PLANILHA SHEETS criando uma WEBHOOK que conecte o SKU/MLB e automaticamente puxe os custos de todos os itens?"

Convenções de leitura: **[OFICIAL]** = documentação do fabricante (URL citada); **[SPEC-CÓPIA]** = OpenAPI do Bling copiado em repositório de terceiros; **[TERCEIROS]** = relato de integrador (só indício); **NÃO CONFIRMADO** = ninguém viu na doc nem na API real (diz como confirmar). Fato não é hipótese: onde só há hipótese, está escrito.

---

## 0. Resposta objetiva ao dono

| Fonte | Dá para puxar o custo de todos os itens? | "Webhook" de verdade? | Tempo real? |
|---|---|---|---|
| **Planilha Sheets** | Sim, por envio (push) de um Apps Script ligado à planilha | SIM, é o webhook que o dono descreveu: a planilha assina e envia (HMAC) para `https://<túnel>/webhook/custos/<id-opaco>` | A cada 10 min se algo mudou, mais botão "Sincronizar agora" |
| **Bling (API v3)** | Sim, varredura da listagem `GET /produtos` (100 itens por chamada) | PARCIAL. O webhook `product_supplier.*` carrega `precoCusto`, mas o Bling pode perder evento e não documenta se editar custo na tela dispara o evento. Por isso: webhook só como GATILHO + releitura autenticada, e varredura diária completa como rede de segurança | Quase (gatilho), com garantia diária |
| **Tiny / Olist (API v3)** | Sim, a listagem `GET /produtos` já devolve `precoCusto` e `precoCustoMedio` junto do `sku` | NÃO. O Tiny não tem webhook de produto, preço ou custo (só pedido, pedido enviado, estoque e NF). Desenho viável: consulta agendada (pull) | Diária e sob demanda |

Limites honestos, que o dono precisa saber antes de aprovar:

1. **A chave é o SKU**, não o MLB. Nenhum dos dois ERPs entrega o MLB de forma confiável na API de produtos. O casamento SKU↔MLB usa o SKU que o anúncio já tem no Mercado Livre.
2. **Hoje 42% dos anúncios coletados não têm SKU** (220 de 517, nos 3 clientes que têm coleta de promoções) e **só 3 de 22 clientes têm `promo_anuncio`**. Custo do ERP só chega a anúncio que tem SKU. A integração mostra exatamente quais anúncios ficam de fora (lista de reconciliação), mas não inventa vínculo.
3. **Custo muda de definição entre ERPs** (Bling: custo do fornecedor padrão com rateios; Tiny: custo líquido de impostos recuperáveis; custo médio só no Tiny). O dono decide qual campo vale (seção 13).
4. **Hoje `custos_cliente` e `promo_custos_sku` têm 0 linhas**: nenhum cliente tem custo. Tudo cai em "SEM CUSTO". Esta integração é o que destrava as promoções com MC real.

---

## 1. Escopo, fora de escopo, fases

**Dentro:** (a) fonte única canônica de custo com proveniência e histórico; (b) webhook público assinado para planilha; (c) gerador do Apps Script pronto; (d) conectores Bling e Tiny (somente leitura) com sync diário e "sincronizar agora"; (e) webhook do Bling como gatilho; (f) quarentena de sanidade; (g) listas de reconciliação; (h) cartão na tela de Integrações e colunas na aba Custos de Promoções; (i) pendências de frescor.

**Fora (não construir agora, e por quê):**
- Escrita em ERP ou em conta de cliente do Mercado Livre. A integração só LÊ de ERP/planilha e só grava custos locais.
- Vínculo manual MLB→SKU para anúncios sem SKU e match por título/GTIN (fuzzy proibido pela regra 3). Fica como pergunta ao dono (seção 13, item 14).
- Custo por variação dentro do mesmo anúncio (as promoções hoje resolvem 1 SKU por anúncio; limitação pré-existente, seção 15).
- Pull de planilha por conta de serviço Google e "publicar na web" como CSV (exigem credencial Google ou expõem custo em URL pública). Alternativa registrada na Fase 3.
- Webhook de estoque do Tiny como gatilho (payload da v3 NÃO CONFIRMADO, exige plano que libere o app Webhooks).

**Fases de entrega (a construção dos módulos é paralela; a fase é o que pode ser liberado):**

| Fase | Conteúdo | Pode ser validado sem credencial de ERP? |
|---|---|---|
| F1 | M1 núcleo, M2 webhook, M3 Apps Script, M8 rotas, M9 UI (Sheets + quarentena + reconciliação + aba Custos), M10 integração | Sim, 100%, com fixtures e testes em memória; a planilha de teste o dono valida em 10 min |
| F2 | M4 Bling, M5 Tiny, M6 credenciais/OAuth, M7 sync, gatilho Bling | Só com fixtures. Real exige 1 cliente piloto por ERP (checklist seção 14) |
| F3 | M11 CMV% derivado para o plano da conta, M12 `sku` em `meli_item`, vínculo manual MLB→SKU, pull Google | Depende de decisão do dono |

---

## 2. Regras inegociáveis e onde cada uma é imposta

| Regra | Onde é imposta (defesa em profundidade) |
|---|---|
| Custo ausente, vazio, null, NaN, ≤ 0 NUNCA vira custo válido: vira SEM CUSTO e a linha é reportada como rejeitada | 1) Apps Script rejeita na origem; 2) `lerCustoMaquina` (M1) reaproveita `lerCusto` de `promocoes-mc.js`; 3) `CHECK (custo > 0 AND custo <= 10000000)` nas tabelas; 4) `custosEfetivos` revalida ao ler; 5) `resolverCustos` já trata `custoSku > 0` |
| Sem inventar número | Nenhum default, nenhuma média, nenhum "último valor conhecido" para linha rejeitada que mude o vigente. Rejeição MANTÉM o vigente anterior e registra `custo_mantido` na rejeição (o dono vê e pode descartar) |
| Dados de cada cliente separados | Toda tabela tem `cliente` na chave; todo SELECT/UPDATE filtra `cliente = ?`; o webhook resolve o cliente SÓ pelo `wid` (id opaco), ignora qualquer `cliente` vindo no corpo |
| Nada é executado em conta de cliente por causa disso | Conectores só fazem GET (Bling: só escopos de leitura; Tiny: permissão "Leitura" só no módulo Produtos); host de saída em allowlist; nenhuma chamada ao ML |
| Tokens e segredos criptografados (AES-256-GCM), nunca em log/frontend | `cifrarSegredo/decifrarSegredo` (M6) com chave própria `ERP_TOKEN_KEY`, falha fechado sem chave; listagens nunca selecionam colunas `*_cifrado`; `erro` sanitizado. Única exceção deliberada: segredo do webhook é exibido UMA vez na geração/rotação (seção 6.7) |
| Sem pedir senha de ERP | Só fluxo oficial: OAuth (Bling e Tiny) com `client_id/secret` do aplicativo que o próprio cliente cria no ERP. O dono/cliente digita na tela do sistema; o assistente nunca recebe credencial |

---

## 3. Arquitetura

```
                     ┌──────────── cliente ────────────┐
 Planilha Sheets ──► │ Apps Script (HMAC, lotes 500)   │──POST──┐
                     └─────────────────────────────────┘        │
 Bling  ─ webhook product_supplier.* (gatilho) ─────────────────┤   Cloudflare (túnel já existente)
                                                                ▼
                                       POST /webhook/custos/:wid  (rota pública, corpo BRUTO)
                                       limitador → HMAC+janela → idempotência (erp_lotes) → aplicarLote
 Bling / Tiny (API v3, OAuth) ◄── GET ── erp-sync (diário 03h+, "sincronizar agora", fila de gatilhos)
                                                ▼
                                       aplicarLote(cliente, fonte, linhas)   ← ÚNICA porta de escrita de custo externo
                                                ▼
   erp_custos_sku (vigente por fonte) + erp_custos_hist + erp_quarentena + erp_rejeitadas
                                                ▼
   custosEfetivos(cliente) = manual (promo_custos_sku) > bling > tiny > sheets   (ordem configurável)
                                                ▼
   Map<sku_minúsculo, custo>  ──►  promocoes-analista.js:523  e  promocoes-coleta.js:241  (única troca)
                                   resolverCustos / calcularMC / montarPlano ficam INTACTOS
```

**Decisões de desenho e desvios das diretrizes (justificados):**

1. **Tabelas novas dentro do `SCHEMA` de `promocoes-db.js`**, e não em `db.js`: só o `SCHEMA` roda em `PS_PROMO_MEMORIA=1`, e os auto-testes precisam delas em memória. Nenhum módulo novo importa `db.js` (abriria o banco real); todos usam `repo.db` de `promocoes-db.js`. O log é injetado (`configurarLog`), porque `log` vive em `db.js`.
2. **Manual NÃO é migrado** para a tabela nova. `promo_custos_sku` continua sendo a camada "manual" (leitura direta), para que nada do que existe quebre. Em compensação, `importarCustosSku` ganha um gancho de histórico (aditivo).
3. **Reconciliação é calculada na leitura**, sem tabela de casamento SKU↔MLB. Isso elimina o risco de vazar MLBs da conta antiga na troca de conta ML (a tabela derivada `promo_anuncio` já é limpa na troca) e elimina sincronização entre duas verdades.
4. **Protocolo de fio do webhook em inglês curto** (`batch_id`, `items`, `accepted`, `rejected`), herdado do script de Apps Script já testado em harness; mensagens ao usuário em português. Desvio da convenção PT do código, restrito ao fio.
5. **Segredo do webhook visível uma única vez.** A diretriz diz "nunca em frontend"; o requisito "copiar o Apps Script pronto com URL e segredo preenchidos" exige mostrar. Solução: exibição única em modal na geração/rotação (`Cache-Control: no-store`, nunca logado, nunca recuperável depois; perdeu = rotaciona). Segredo é por cliente, com escopo mínimo (só upsert de custo daquele cliente).
6. **Sem cache de assinaturas vistas.** A idempotência por `(cliente, fonte, batch_id)` + `corpo_hash` já neutraliza replay: reenvio idêntico devolve o resumo guardado sem reprocessar; fora da janela de ±300 s a assinatura falha.
7. **Webhook do Tiny não existe nesta versão** (não há evento de custo). Só pull.
8. **Fallback silencioso entre campos de custo é proibido** (ex.: custo médio vazio caindo para preço de custo). O campo escolhido vale; se vier vazio e o outro campo tiver valor, a rejeição traz a dica, mas o custo não é usado.

---

## 4. Modelo de dados (DDL — dono: M1; entra no `SCHEMA` de `src/lib/promocoes-db.js`)

Todas as tabelas são novas (`CREATE TABLE IF NOT EXISTS`): não há ALTER em tabela existente na F1/F2, portanto não depende do bug latente de ordem de ALTER do `db.js` (seção 16). Datas em ISO UTC (`agora()` de `promocoes-db.js`).

```sql
-- Custo VIGENTE por fonte externa. Manual continua em promo_custos_sku (camada 'manual', leitura direta).
CREATE TABLE IF NOT EXISTS erp_custos_sku (
  cliente TEXT NOT NULL,
  sku_key TEXT NOT NULL,                      -- chaveSku(sku): normalizado + minúsculo (mesma comparação das promoções)
  fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny','sheets')),
  sku TEXT NOT NULL,                          -- como veio (já normalizado), para exibição
  custo REAL NOT NULL CHECK (custo > 0 AND custo <= 10000000),
  custo_txt TEXT NOT NULL,                    -- decimal canônico, 4 casas no máximo, sem zeros à direita ("36.32")
  moeda TEXT NOT NULL DEFAULT 'BRL',
  campo TEXT NOT NULL DEFAULT '',             -- proveniência: ex. 'bling.fornecedor_padrao.precoCusto', 'tiny.precos.precoCusto', 'sheets.coluna_custo'
  id_externo TEXT NOT NULL DEFAULT '',        -- id do produto no ERP
  mlb_dica TEXT NOT NULL DEFAULT '',          -- MLB informado pela fonte (só confere, nunca define o SKU)
  atualizado_na_fonte TEXT NOT NULL DEFAULT '', -- ISO quando a fonte informa de forma confiável; '' se não informa (planilha)
  recebido_em TEXT NOT NULL,                  -- quando ESTE valor chegou (só muda quando o valor muda)
  visto_em TEXT NOT NULL,                     -- última vez que a fonte reafirmou o valor
  nao_visto_desde TEXT NOT NULL DEFAULT '',   -- preenchido por sync COMPLETO em que o SKU não apareceu (nunca apaga)
  hash TEXT NOT NULL,                         -- sha256(cliente|sku_key|fonte|campo|custo_txt)
  lote_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, sku_key, fonte)
);
CREATE INDEX IF NOT EXISTS ix_erp_custos_idext ON erp_custos_sku (cliente, fonte, id_externo);

-- Histórico: toda mudança de vigente, quarentena, decisão e ajuste manual. Nunca sobrescreve sem registrar.
CREATE TABLE IF NOT EXISTS erp_custos_hist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente TEXT NOT NULL, sku_key TEXT NOT NULL, sku TEXT NOT NULL, fonte TEXT NOT NULL,   -- fonte inclui 'manual'
  evento TEXT NOT NULL,          -- novo | alterado | quarentena | aprovado | recusado | descartado | manual
  custo_antes REAL, custo_depois REAL, variacao_pct REAL,
  campo TEXT NOT NULL DEFAULT '', lote_id TEXT NOT NULL DEFAULT '', atualizado_na_fonte TEXT NOT NULL DEFAULT '',
  em TEXT NOT NULL, por TEXT NOT NULL DEFAULT '', detalhe TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_erp_hist ON erp_custos_hist (cliente, sku_key, id);

-- Quarentena: valor proposto que NÃO substitui o vigente até o dono aprovar.
CREATE TABLE IF NOT EXISTS erp_quarentena (
  cliente TEXT NOT NULL, sku_key TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny','sheets')),
  sku TEXT NOT NULL,
  motivo TEXT NOT NULL,                         -- variacao_brusca | custo_ge_preco | kit_divergente
  custo_proposto REAL NOT NULL CHECK (custo_proposto > 0), custo_txt TEXT NOT NULL,
  campo TEXT NOT NULL DEFAULT '', id_externo TEXT NOT NULL DEFAULT '', mlb_dica TEXT NOT NULL DEFAULT '', atualizado_na_fonte TEXT NOT NULL DEFAULT '',
  custo_vigente REAL, variacao_pct REAL, preco_ref REAL,
  estado TEXT NOT NULL DEFAULT 'pendente',      -- pendente | recusada (recusada guarda o valor p/ não reabrir a mesma quarentena a cada sync)
  recebido_em TEXT NOT NULL, lote_id TEXT NOT NULL DEFAULT '', decidido_por TEXT NOT NULL DEFAULT '', decidido_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, sku_key, fonte)
);

-- Última lista de linhas rejeitadas por (cliente, fonte). Limpa quando a linha é aceita depois ou some num sync completo.
CREATE TABLE IF NOT EXISTS erp_rejeitadas (
  cliente TEXT NOT NULL, fonte TEXT NOT NULL,
  chave TEXT NOT NULL,                          -- 'sku:<sku_key>' | 'id:<id_externo>' | 'mlb:<MLB>' | 'linha:<n>'
  sku TEXT NOT NULL DEFAULT '', mlb TEXT NOT NULL DEFAULT '', codigo TEXT NOT NULL, motivo TEXT NOT NULL,
  custo_txt TEXT NOT NULL DEFAULT '',           -- valor bruto recebido, truncado em 40 caracteres
  custo_mantido REAL,                           -- vigente que continua valendo (null = não havia)
  linha TEXT NOT NULL DEFAULT '', lote_id TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte, chave)
);

-- Configuração por cliente (defaults = DECISÕES DO DONO, seção 13).
CREATE TABLE IF NOT EXISTS erp_cliente_cfg (
  cliente TEXT PRIMARY KEY,
  ordem_fontes TEXT NOT NULL DEFAULT '["manual","bling","tiny","sheets"]',   -- ordem = precedência; fonte fora da lista NÃO é consumida
  limiar_variacao_pct REAL NOT NULL DEFAULT 50,
  quarentena_custo_ge_preco INTEGER NOT NULL DEFAULT 1,
  campo_custo_tiny TEXT NOT NULL DEFAULT 'preco_custo',                      -- preco_custo | custo_medio
  velho_dias_erp INTEGER NOT NULL DEFAULT 3, velho_dias_sheets INTEGER NOT NULL DEFAULT 14,
  atualizado_em TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT ''
);

-- Estado de cada fonte por cliente (sem segredos).
CREATE TABLE IF NOT EXISTS erp_fontes (
  cliente TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny','sheets')),
  estado TEXT NOT NULL DEFAULT 'desconectado',  -- desconectado | conectado | erro | reautorizar | pausado
  ultimo_sync_em TEXT NOT NULL DEFAULT '', ultimo_sync_ok_em TEXT NOT NULL DEFAULT '',
  ultimo_resumo_json TEXT NOT NULL DEFAULT '{}', ultimo_erro TEXT NOT NULL DEFAULT '',
  sync_estado TEXT NOT NULL DEFAULT '', sync_iniciada_em TEXT NOT NULL DEFAULT '',   -- '' | 'rodando' (considerar morto após 30 min)
  tentativas_dia INTEGER NOT NULL DEFAULT 0, tentativas_dia_data TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte)
);

-- URL opaca + segredo por cliente/fonte (M2 escreve). Bling com app global usa 1 linha com cliente = '' e resolve o cliente por company_id.
CREATE TABLE IF NOT EXISTS erp_webhooks (
  wid TEXT PRIMARY KEY,                         -- 16 bytes aleatórios, base64url (22 caracteres)
  cliente TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('sheets','bling')),
  segredo_cifrado TEXT NOT NULL DEFAULT '', segredo_anterior_cifrado TEXT NOT NULL DEFAULT '', anterior_expira_em TEXT NOT NULL DEFAULT '',
  ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL, rotacionado_em TEXT NOT NULL DEFAULT '', ultimo_uso_em TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_erp_webhooks_cf ON erp_webhooks (cliente, fonte);

-- Credenciais OAuth (M6 escreve). cliente = '*' guarda o aplicativo GLOBAL da Place2u (Bling público). Tudo cifrado.
CREATE TABLE IF NOT EXISTS erp_credenciais (
  cliente TEXT NOT NULL, fonte TEXT NOT NULL CHECK (fonte IN ('bling','tiny')),
  modo_app TEXT NOT NULL DEFAULT 'proprio',     -- global | proprio
  client_id TEXT NOT NULL DEFAULT '', client_secret_cifrado TEXT NOT NULL DEFAULT '',
  access_token_cifrado TEXT NOT NULL DEFAULT '', refresh_token_cifrado TEXT NOT NULL DEFAULT '',
  expira_em TEXT NOT NULL DEFAULT '', refresh_emitido_em TEXT NOT NULL DEFAULT '',
  escopos TEXT NOT NULL DEFAULT '', company_id TEXT NOT NULL DEFAULT '',
  conectado_em TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL DEFAULT '', erro TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, fonte)
);

-- Idempotência do webhook por lote (M2).
CREATE TABLE IF NOT EXISTS erp_lotes (
  cliente TEXT NOT NULL, fonte TEXT NOT NULL, lote_id TEXT NOT NULL,
  sync_id TEXT NOT NULL DEFAULT '', lote_n INTEGER NOT NULL DEFAULT 1, lote_total INTEGER NOT NULL DEFAULT 1,
  corpo_hash TEXT NOT NULL, resumo_json TEXT NOT NULL, recebido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte, lote_id)
);
CREATE INDEX IF NOT EXISTS ix_erp_lotes_sync ON erp_lotes (cliente, fonte, sync_id);

-- Fila de gatilhos (Bling product_supplier) e de detalhes pendentes (M7). Coalescida por produto.
CREATE TABLE IF NOT EXISTS erp_fila (
  cliente TEXT NOT NULL, fonte TEXT NOT NULL, id_externo TEXT NOT NULL,
  motivo TEXT NOT NULL DEFAULT 'gatilho', enfileirado_em TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, proxima_em TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (cliente, fonte, id_externo)
);
CREATE TABLE IF NOT EXISTS erp_eventos_vistos (  -- dedupe por eventId do Bling; poda > 7 dias
  fonte TEXT NOT NULL, evento_id TEXT NOT NULL, em TEXT NOT NULL, PRIMARY KEY (fonte, evento_id)
);
CREATE TABLE IF NOT EXISTS erp_oauth_state (     -- state de uso único do OAuth (M6); poda > 1 dia
  nonce TEXT PRIMARY KEY, cliente TEXT NOT NULL, fonte TEXT NOT NULL, criado_em TEXT NOT NULL, usado_em TEXT NOT NULL DEFAULT ''
);
```

**Alterações em funções existentes de `promocoes-db.js` (M1, aditivas):**
- `importarCustosSku`: dentro da mesma transação, antes do upsert, ler o custo anterior de cada SKU e, se mudou ou é novo, inserir em `erp_custos_hist` (`fonte='manual'`, `evento='manual'`, `por`). O comportamento e o retorno atuais não mudam.
- `limparPromocoesDoCliente` (troca/desconexão da conta ML): além de `TABELAS_DERIVADAS`, apagar de `erp_rejeitadas` as linhas com `codigo IN ('conflito_sku_mlb','mlb_sem_sku')` do cliente e zerar `erp_custos_sku.mlb_dica`. **Custos, histórico, quarentena, credenciais e configuração são PRESERVADOS** (são entradas do dono, como `promo_custos_sku`). `TABELAS_DERIVADAS` não muda.
- Retenção (`podarCustos`, chamada 1×/dia): `erp_custos_hist` > 24 meses, `erp_lotes` > 30 dias, `erp_eventos_vistos` > 7 dias, `erp_oauth_state` > 1 dia, `erp_rejeitadas` acima de 5.000 por (cliente, fonte).

---

## 5. Regras de negócio (dono: M1, em `src/lib/custos-db.js`)

### 5.1 Normalização do SKU e do MLB (declarada, sem fuzzy)
`normalizarSku(s)`: converte para string; NFC; troca NBSP (U+00A0) por espaço; remove zero-width (U+200B–U+200D, U+FEFF); `trim`. **Espaços internos NÃO são alterados**, a caixa visível é preservada, zeros à esquerda e hífens NÃO são mexidos. Vazio ou > 80 caracteres = inválido.
`chaveSku(s) = normalizarSku(s).toLowerCase()`. É a chave de `sku_key`.
`normalizarMlb(s)`: `trim` + maiúsculas; válido só `^MLB\d{1,14}$` (mesmo validador de `rotas-promocoes.js`). MLBU de catálogo é rejeitado (`mlb_invalido`): as validações do sistema inteiro aceitam só `MLB\d+`.

**Casamento com o anúncio** (resolução única desde 07/10/2026, decisão nº 14; `src/lib/custo-vinculo.js` → `vinculosCusto` em `custos-db.js`, a MESMA para consumidor, reconciliação, lote, diagnóstico e Ofertas). Para cada anúncio, em ordem:
1. **manual** (`custo_vinculo`, `origem='manual'`): o MLB manda sobre o SKU, como `regraDoAnuncio`. Manual cujo custo foi descartado deixa o anúncio sem custo (não cai no SKU, que alguém já disse não ser o dele).
2. **SKU exato** (`chaveSku`, como sempre foi).
3. **SKU normalizado forte**: NFC, minúsculas, sem espaços, hífens e caracteres invisíveis — o **ponto fica** (separa decimal/versão: `AGUA-1.5L` ≠ `AGUA-15L`). Só casa quando a chave aponta para **um único** SKU de custo ("Cinto desegurança" = `CINTODESEGURANÇA`).
4. **grupo**: mesmo `user_product_id` de anúncio já resolvido em 1–3, só se o grupo inteiro concorda e só com chave de custo vigente.

`'recusado'` ("Não é este") tira o par (anúncio, SKU de custo) dos níveis 2–4 — inclusive o SKU exato — e também da reconciliação (`sku_erp_sem_anuncio`) e do preço de referência do lote. A camada manual (`promo_custos_sku`) entra com `chaveSku`, a mesma chave das fontes externas (texto colado com NBSP/NFD não vira "SKU de custo sem custo vigente"). Semelhança de nome (`vinculos.sugerirVinculo`, com tamanhos PP/P/M/G/GG/XG como palavra) só **sugere**: nada é gravado sem Confirmar.

### 5.2 Validação de custo de máquina (`lerCustoMaquina(v)`)
- número JSON: segue para `lerCusto`; string: só decimal canônico com ponto (`^\d+(\.\d{1,10})?$`, que é o formato dos ERPs, ex. `"36.3200000000"`); qualquer outra coisa (vírgula, "R$", milhar) = `custo_invalido`. Máquina não adivinha formato pt-BR (a UI de colagem manual continua usando `parseNumeroBR`).
- arredonda para 4 casas **antes** de validar (`Number(n.toFixed(4))`); se virar 0, rejeita.
- `lerCusto` rejeita ausente/NaN/Infinity/≤0/booleano/lista/> R$ 10.000.000.
- Códigos: `custo_ausente`, `custo_invalido`, `custo_zero_ou_negativo`, `custo_acima_maximo`.
- **Zero intencional (brinde)** é rejeitado por padrão. Caminho futuro: coluna explícita "custo zero confirmado" (decisão do dono, seção 13).

### 5.3 Resolução SKU↔MLB de uma linha (`aplicarLote`)
1. `sku` presente e `mlb` ausente: chave = `chaveSku(sku)`.
2. `sku` e `mlb` presentes: se o anúncio `mlb` existe em `promo_anuncio` com SKU diferente (comparação `chaveSku`), a linha NÃO casa: rejeitada `conflito_sku_mlb` (motivo traz os dois SKUs). Se o anúncio não existe ou não tem SKU, aceita pelo SKU da linha e guarda `mlb_dica`.
3. `sku` ausente e `mlb` presente: usa o SKU de `promo_anuncio` daquele MLB; se não houver anúncio ou ele não tiver SKU: rejeitada `mlb_sem_sku`. Nunca inventa.
4. Os dois ausentes: `sku_vazio`.
5. SKU repetido no mesmo lote: se todos os custos canônicos são iguais, vale um; se diferem, TODAS as ocorrências são rejeitadas (`sku_duplicado_no_lote`), porque o último ganharia em silêncio.
6. Duplicidade entre lotes do mesmo envio é de responsabilidade do emissor (o script de planilha já rejeita; os conectores deduplicam a varredura inteira, 7.3). **Lacuna conhecida:** linha da planilha só com MLB tem o SKU resolvido pelo anúncio AQUI no servidor; se ela cair num lote e a linha do mesmo SKU em outro, o script não vê a repetição e o último lote vence — exige memória por `sync_id` no servidor (pendente).

### 5.4 Sanidade e quarentena
Aplicada a cada linha aceita na validação, comparando com o vigente **da mesma fonte**:
- **`variacao_brusca`:** existe vigente e `|novo − vigente| / vigente × 100 > limiar_variacao_pct` (padrão 50).
- **`custo_ge_preco`** (se `quarentena_custo_ge_preco = 1`): `novo ≥ preço de referência`, sendo o preço de referência o MENOR `COALESCE(NULLIF(preco_original,0), preco)` entre os anúncios de `promo_anuncio` ligados àquela chave — pelo SKU do anúncio (salvo par recusado) ou pela resolução única (manual, normalizado, grupo). Sem anúncio conhecido, a checagem é pulada (não há com o que comparar). Falso positivo possível (kit com preço diferente); é por isso que vai para revisão, não para rejeição.
- **`kit_divergente`:** linha de kit cujo `kit_custo_proprio` difere da soma dos componentes em mais de 1% (7.3).
- Valor em quarentena: grava em `erp_quarentena` (`pendente`), registra `quarentena` no histórico, **não altera o vigente**. Nova proposta para a mesma chave substitui a pendente.
- Se o valor proposto for igual ao de uma quarentena `recusada`, é ignorado em silêncio (contagem `recusado_antes`). Valor diferente reabre.
- Aprovar (`decidirQuarentena`): copia a proposta para o vigente (`aprovado` no histórico, com `por`); recusar: marca `recusada`. O primeiro valor de um SKU sem vigente não passa pela checagem de variação.

### 5.5 Mudança, "inalterado" e histórico
Calcula `hash`. Se `hash` igual ao do vigente: só atualiza `visto_em`, zera `nao_visto_desde`, conta `inalteradas`, sem linha de histórico. Se diferente: faz upsert, `recebido_em = agora`, histórico `novo` ou `alterado` com `custo_antes`, `custo_depois`, `variacao_pct`, `campo`, `lote_id`, `atualizado_na_fonte`. Linha aceita apaga a respectiva `erp_rejeitadas`.

### 5.6 Modo `parcial` vs `completo`
- **parcial:** só faz upsert das linhas enviadas.
- **completo:** o envio inteiro (um ou vários lotes) é a foto da fonte. **NUNCA apaga SKU ausente e NUNCA zera custo.** Ao fechar o envio completo (`fecharSyncCompleto(cliente, fonte, inicioISO)`): SKUs da fonte com `visto_em < inicio` recebem `nao_visto_desde` (informativo, o custo continua valendo e aparece na lista "não visto"); rejeitadas da fonte com `em < inicio` são removidas. Só fecha se todos os lotes `1..batch_total` do `sync_id` chegaram (M2 confere em `erp_lotes`); envio incompleto não marca nada.

### 5.7 Precedência de leitura (`custosEfetivos`)
Para cada SKU: percorre `cfg.ordem_fontes` (padrão `manual > bling > tiny > sheets`); a primeira fonte com custo válido (finito, > 0) vence; fonte fora da lista não é consumida (nem a `manual`, se o dono a tirar). Valor em quarentena não existe como vigente. Saída: `Map<sku_minúsculo, custo>`, **drop-in** para o `custosSku` atual. `custosEfetivosDetalhe` devolve proveniência, frescor e as fontes perdedoras.

### 5.8 Frescor ("custo velho")
Por fonte conectada: `idade = agora − ultimo_sync_ok_em`; velha se `idade > velho_dias_*` (ERP 3 dias, planilha 14) ou nunca sincronizou. Pendência `CUSTO_FONTE_VELHA`. O custo velho continua valendo (a pendência avisa, não bloqueia). `ultimo_sync_ok_em` = último lote/varredura recebido com autenticação válida e processado sem erro do servidor (liveness), independentemente de quantas linhas foram rejeitadas (isso aparece nas contagens). Planilha precisa de **batimento diário**: o script reenvia o completo uma vez por dia mesmo sem mudança (senão a pendência dispara à toa).

### 5.9 Kits e composições
Só há soma de componentes se a fonte entregar a estrutura (Bling: `estrutura.componentes` no detalhe, `formato=E`; Tiny: `GET /produtos/{id}/kit`, `tipo=K`). O orquestrador (M7) calcula `Σ(quantidade × custo vigente do componente na MESMA varredura)`; só se TODOS os componentes têm custo válido. Senão: rejeição `kit_sem_estrutura` ou `kit_componente_sem_custo`, e o kit fica "pendente" (lista própria). Se o kit trouxer custo próprio válido e divergir da soma em mais de 1%: quarentena `kit_divergente` com a soma como proposta. Planilha não tem noção de kit: o que o dono digita para o SKU do kit vale como está.

### 5.10 Impacto nas aprovações
Custo que muda pode mudar a MC e, por regra existente (`substituirDecisoesAnalista`), revoga aprovação cujo número mudou (comportamento correto: a aprovação valia para outros números). `aplicarLote` devolve `impacto.skus_com_aprovacao_afetada` (contagem de SKUs alterados com `promo_decisao.aprovado=1 AND marcado=1` em anúncio daquele SKU) e audita. O selo de entrada do analista (`entradaSelo`) já inclui os custos: mudança no meio da rodada marca a rodada como desatualizada (lado seguro, já existente).

---

## 6. Webhook público (dono: M2, `src/lib/custos-webhook.js`)

### 6.1 Rota e exposição
`POST /webhook/custos/:wid`, via o mesmo túnel Cloudflare de `/webhook/meli` (`PUBLIC_BASE_URL`). URL: `${PUBLIC_BASE_URL}/webhook/custos/${wid}` (se `PUBLIC_BASE_URL` vazio, as rotas de gestão respondem 409 "configure PUBLIC_BASE_URL").
- `ROTA_PUBLICA` ganha duas alternativas **ancoradas**: `webhook\/custos\/[A-Za-z0-9_-]{16,64}$` e `erp\/callback$`. Esse regex é a única barreira do túnel: nada de `webhook/custos` sem `wid`, nada de prefixo aberto.
- No `server.js` o roteador do webhook é montado **antes** de `express.json` (linha 29): `app.use('/webhook/custos', rotasWebhookCustos)`. Dentro: `limitador → express.raw({ type: () => true, limit: '256kb' }) → handler`. O `body-parser` do `express.json` global pula quem já tem `req._body` (verificado no código instalado, `json.js:106`), então o HMAC é sobre os bytes crus.
- Tratamento de erro do próprio roteador: `entity.too.large` = 413, outros = 400, corpo sempre genérico `{"ok":false}`. O handler global de erro do `server.js` também ganha 413 para `entity.too.large` (hoje vira 500).

### 6.2 Autenticação (Sheets)
Cabeçalhos: `X-Timestamp` (epoch em segundos, inteiro), `X-Signature: sha256=<hex>`, `X-Batch-Id` (se vier junto com `batch_id` no corpo, têm de ser iguais).
`assinatura = HMAC-SHA256(chave = segredo UTF-8 (NÃO decodificar de hex), mensagem = "<X-Timestamp>." + bytes crus do corpo)`, em hexadecimal minúsculo.
Servidor: acha `erp_webhooks` por `wid` e `ativo=1`; exige `|agora − ts| ≤ 300 s`; calcula o HMAC sobre o Buffer cru (`createHmac(...).update(ts + '.').update(buf)`); compara com `crypto.timingSafeEqual` em buffers de igual tamanho; tenta o segredo atual e, se `anterior_expira_em > agora`, o anterior. Qualquer falha (wid inexistente, inativo, cabeçalho ausente, ts fora, assinatura inválida) devolve **a mesma resposta**: `401 {"ok":false}`, sem dica de qual foi.

### 6.3 Corpo (protocolo de fio, herdado do script testado)
```json
{ "batch_id": "uuid", "mode": "full", "sync_id": "uuid", "batch_no": 1, "batch_total": 3,
  "items": [ { "sku": "ABC-1", "mlb": "MLB123456789", "custo": 12.5, "line": 2 } ] }
```
- `batch_id`: 8–64 caracteres `[A-Za-z0-9_-]`, obrigatório. `mode`: `partial` (padrão) ou `full`; `full` exige `sync_id`, `batch_no ≥ 1`, `batch_total ≥ batch_no` (máx. 200), constantes dentro do `sync_id`.
- `items`: 1 a 1.000 (o script usa 500). Cada item: `sku` (string ≤ 80), `mlb` (string ou null), `custo` (número, string decimal canônica ou null), `line` (inteiro opcional, só para devolver o status por linha). Pelo menos um de `sku` ou `mlb`. Campos desconhecidos são ignorados (nunca mesclados).
- Tamanho total ≤ 256 KB (413), JSON inválido ou esquema inválido depois de autenticar = 400/422 com mensagem curta (só para quem autenticou).

### 6.4 Idempotência
Depois de autenticar: procura `(cliente, fonte, batch_id)` em `erp_lotes`. Mesmo `corpo_hash` = **200 com o resumo guardado e `"duplicate": true`**, sem reprocessar (retry após resposta perdida recebe o mesmo resumo). `corpo_hash` diferente = **409** (`batch_id reutilizado com outro conteúdo`). Novo: processa (síncrono; `aplicarLote` leva milissegundos), grava o lote com o resumo, e, se `mode=full` e todos os `batch_no` do `sync_id` estão em `erp_lotes`, chama `fecharSyncCompleto(cliente, fonte, MIN(recebido_em) do sync)`.

### 6.5 Resposta de resumo (só para quem autenticou)
```json
{ "ok": true, "batch_id": "...", "duplicate": false,
  "accepted": 498, "new": 3, "changed": 12, "unchanged": 483,
  "quarantined": [ { "sku": "X1", "line": 7, "reason": "variação de 180% sobre R$ 10,00 (limite 50%)" } ],
  "rejected":    [ { "sku": "X2", "line": 9, "reason": "custo vazio" } ],
  "refused":     [ { "sku": "X3", "line": 4, "reason": "o painel mantém R$ 10,00 (custo anterior da planilha)" } ],
  "rejected_total": 2, "quarantined_total": 1, "refused_total": 1, "duplicates_equal": 0, "closed_full_sync": false }
```
`refused` = valor igual a uma quarentena que o dono recusou (`recusado_antes`): ignorado, o vigente continua. `accepted + quarantined_total + rejected_total + refused_total + duplicates_equal` = itens do lote.
`accepted` = linhas válidas processadas (novas + alteradas + inalteradas). Listas limitadas a 200 itens (o total vem em `*_total`). `reason` é mensagem em português, sem dados de outros clientes. Rejeição de linha NÃO gera 4xx: o lote só falha com 400/401/409/413/422/429/500.

### 6.6 Limites e proteção
| Proteção | Valor |
|---|---|
| Corpo máximo | 256 KB (413) |
| Itens por lote | 1.000 (422) |
| Rate limit por `wid` (token bucket em memória, mesmo para wid inexistente) | capacidade 30, reposição 1 a cada 2 s; excedeu = `429` com `Retry-After` |
| Rate limit por IP (`CF-Connecting-IP` se existir, senão o socket) | 120 req/min |
| Falhas de autenticação por IP | 10 em 5 min bloqueiam o IP por 15 min (`429`) |
| Memória do limitador | mapa com teto de 10.000 chaves e poda por idade (mesmo padrão de `server.js:176-177`); reinício zera (aceitável: loopback + túnel) |
| Resposta de erro | corpo fixo, sem stack, sem eco de entrada, sem diferenciar causa de 401 |
| Log | só `wid` (6 primeiros caracteres), status HTTP e contagens; nunca corpo, assinatura, segredo ou lista de SKUs |

### 6.7 Geração, rotação, desativação (funções para M8)
- `gerarWebhook(cliente, 'sheets')`: cria `wid` (`randomBytes(16).toString('base64url')`) e segredo (`randomBytes(32).toString('hex')`, 64 caracteres); grava o segredo cifrado; devolve `{ wid, url, segredo }` — **o segredo sai só nesta resposta**. Se já existe, é erro 409 (use rotacionar).
- `rotacionarSegredo(cliente, 'sheets')`: novo segredo; o antigo vai para `segredo_anterior_cifrado` com validade de 24 h (o dono tem tempo de colar o script novo). Segunda rotação dentro da janela sobrescreve o anterior.
- `desativarWebhook`: `ativo = 0` (401 uniforme). `statusWebhook` devolve `{ ativo, url, criado_em, rotacionado_em, ultimo_uso_em }` sem segredo.
- A resposta das rotas de gestão que carrega o segredo leva `Cache-Control: no-store`; o front guarda só em variável JS do modal (nunca `localStorage`).

### 6.8 Webhook do Bling como gatilho (F2; atrás de flag `PS_BLING_WEBHOOK=1`, desligado por padrão)
- Assinatura: `X-Bling-Signature-256: sha256=<hex>` = HMAC-SHA256 do payload com o `client_secret` do aplicativo [OFICIAL: https://developer.bling.com.br/webhooks]. **NÃO CONFIRMADO:** se é sobre os bytes crus (implementar cru e validar com o primeiro evento real). Sem carimbo de tempo na assinatura: replay controlado por dedupe de `eventId` (`erp_eventos_vistos`, 7 dias) e por `date` dentro de 3 dias.
- Chave: `client_secret` do app do cliente (modo próprio) ou do app global (linha `cliente='*'` de `erp_credenciais`). Cliente resolvido por `companyId` ↔ `erp_credenciais.company_id` (depois de a assinatura validar). `companyId` desconhecido = 200 silencioso (não vaza).
- Responder **2xx em até 5 s** [OFICIAL]. O handler só valida, deduplica, enfileira em `erp_fila` (coalescido por produto) e responde 200. A releitura é do worker (M7).
- Só reage a `product_supplier.created|updated` com `padrao = true`, usando `produto.id`. `product_supplier.deleted` (só vem o id do vínculo) e `product.*` (não carregam custo) são ignorados; a varredura diária cobre.
- Se o Bling desabilitar o webhook após 3 dias de falha [OFICIAL], nada quebra: a varredura diária é a garantia. O cartão mostra "último evento recebido".
- `erp_webhooks` para Bling: 1 linha global (`cliente=''`, app global) ou 1 por cliente (modo próprio, URL própria).

---

## 7. Conectores ERP (somente leitura)

### 7.1 Contratos comuns (M4, M5)
```js
// HTTP injetável (M6 entrega o padrão com fetch do Node 22 + allowlist de hosts + teto de 5 MB + timeout 20 s)
http({ metodo, url, headers, corpo, timeoutMs }) → { status, headers /* minúsculos */, texto }
// Limitador de saída (M6): await limitador.aguardar()  — respeita taxa por conta e global

criarConectorBling({ http, limitador, obterToken, log, agora })   // idem criarConectorTiny({ ..., campoCusto })
  → {
      testar()                                   → { ok, empresa: { id, nome } | null, erro? },
      varrer({ prioridadeSkus? })                → async iterator de { pagina, linhas: LinhaCusto[], kits: Kit[], avisos: string[] },
      custoDoProduto(idExterno, { skuConhecido }) → { linhas: LinhaCusto[] },      // para o gatilho/fila
    }
LinhaCusto = { sku, mlb: null, custo /* bruto: number|string|null */, campo, id_externo, atualizado_na_fonte: ISO|null,
               kit_custo_proprio?: number|null, variacao_de?: sku_pai|null, dica?: string }
Kit        = { id_externo, sku, custo_proprio: number|null, componentes: [{ id_externo, quantidade }] | null }
```
Conectores NUNCA decidem validade de custo: entregam o bruto (ou `null`) e o `aplicarLote` rejeita/aceita. Hosts permitidos (allowlist fixa em `erp-http.js`, nada vindo do banco ou do payload): `api.bling.com.br`, `www.bling.com.br`, `api.tiny.com.br`, `accounts.tiny.com.br`.

### 7.2 Bling API v3 — fatos, fonte e status
| Fato | Fonte / status |
|---|---|
| v3 é a vigente; base `https://api.bling.com.br/Api/v3`; v2 sem comunicado oficial de desligamento (relato de integrador diz que parou em 25/02) | [OFICIAL] https://developer.bling.com.br/bling-api · v2: [TERCEIROS] https://community.e-com.plus/t/api-v3-bling-nao-funcionando/6840 |
| OAuth authorization code. Authorize `GET https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=…&state=…`; `redirect_uri` e escopos vêm do cadastro do app | [OFICIAL] https://developer.bling.com.br/aplicativos |
| Token `POST https://api.bling.com.br/Api/v3/oauth/token`, `Authorization: Basic base64(client_id:client_secret)`, body `application/x-www-form-urlencoded` (`grant_type=authorization_code&code=…` / `grant_type=refresh_token&refresh_token=…`); credenciais NÃO vão no body | [OFICIAL] idem |
| Code expira em 1 min e é de uso único; reutilizar REVOGA o usuário vinculado | [OFICIAL] https://developer.bling.com.br/erros-comuns |
| JWT: enviar `enable-jwt: 1` na troca, na RENOVAÇÃO e nas chamadas (sem o header na renovação volta token opaco). Token opaco descontinuado, data "em definição" | [OFICIAL] https://developer.bling.com.br/migracao-jwt |
| Refresh token 30 dias. Rotativo/uso único: a doc não afirma | [OFICIAL] prazo · rotação [TERCEIROS] (tratar como rotativo: gravar o novo token atomicamente, renovar sob lock por conta) |
| Duração do access token JWT | NÃO CONFIRMADO (usar `expires_in` da resposta) |
| Limites: 3 req/s e 120.000/dia POR CONTA; bloqueio de IP: 300 erros em 10 s (10 min), 600 req em 10 s (10 min), 20 req a `/oauth/token` em 60 s (60 min). 429 sem `Retry-After`; corpo `{"error":{"type":"TOO_MANY_REQUESTS",…,"limit":3,"period":"second"}}` | [OFICIAL] https://developer.bling.com.br/limites |
| `GET /produtos`: `pagina` (padrão 1), `limite` (padrão 100), corpo `{"data":[…]}`; item traz `id`, `codigo`, `formato`, `situacao`, **`precoCusto` na raiz = custo do fornecedor padrão** | paginação [OFICIAL] https://developer.bling.com.br/boas-praticas · campos [SPEC-CÓPIA] https://github.com/tempont/bling-erp-api-python/blob/HEAD/specs/bling-openapi-reference.json (conferir em https://developer.bling.com.br/referencia) |
| Detalhe `GET /produtos/{id}`: `fornecedor.precoCusto` e `fornecedor.precoCompra`; `GET /produtos/fornecedores?idProduto=` lista vínculos com `precoCusto`, `precoCompra`, `padrao` | [SPEC-CÓPIA] mesma cópia |
| Custo médio: não existe campo/endpoint na API (só relatório de tela) | [SPEC-CÓPIA], varredura de 160 caminhos; confirmar com suporte do Bling |
| Webhook: recursos `order`, `product`, `stock`, `virtual_stock`, `product_supplier`, `invoice`, `consumer_invoice`; cabeçalho `X-Bling-Signature-256` (`sha256=<hex>`); sucesso = 2xx em 5 s; reentrega por até 3 dias, depois o recurso é desabilitado | [OFICIAL] https://developer.bling.com.br/webhooks (revalidado em 05/10/2026) |
| `product_supplier.*` carrega `precoCusto`, `precoCompra`, `padrao`, `produto.id`, `fornecedor.id`; o `codigo` do payload é o código no fornecedor, NÃO o SKU | [OFICIAL] campos revalidados · demais detalhes do payload conforme pesquisa |
| `product.*` NÃO carrega custo | [OFICIAL] webhooks |
| App privado opera só a própria conta; app público opera outras contas e exige homologação; **antes dela, no máximo 10 usuários autorizam** | [OFICIAL] https://developer.bling.com.br/aplicativos · https://developer.bling.com.br/homologacao |
| Alterar escopos do app REVOGA todos os usuários | [OFICIAL] https://developer.bling.com.br/aplicativos |
| Plano mínimo do cliente: Cobalto | [OFICIAL] help center (lido por trecho de busca) |

**Algoritmo da varredura Bling (M4):**
1. `GET /produtos?pagina=N&limite=100&criterio=5` até `data` vazio ou menor que `limite` (teto de segurança 500 páginas). `criterio` configurável. **NÃO CONFIRMADO:** que `5` = todos (inclui excluídos) e o efeito do filtro de saldo (`filtroSaldoEstoque` tem `default: 1` na cópia do spec): o checklist conta a listagem contra a tela de Produtos do Bling; o conector aceita parâmetros extras via configuração.
2. Para cada item: `codigo` → `sku`; custo = `precoCusto` da raiz; se ausente/nulo/0, fica na fila de **detalhe** (`GET /produtos/{id}`, `fornecedor.precoCusto`), com teto de 500 detalhes por varredura por cliente, priorizando `prioridadeSkus` (SKUs que aparecem em anúncios). O excedente vai para `erp_fila` (`motivo='detalhe'`). **NÃO CONFIRMADO:** se o detalhe devolve `precoCusto` na raiz; ler os dois lugares, nesta ordem: raiz, depois `fornecedor.precoCusto`.
3. `campo` = `bling.fornecedor_padrao.precoCusto`. `precoCompra` NÃO é usado como custo (auxiliar apenas).
4. `formato = 'V'` (pai de variações): sem custo próprio, ignorado com aviso. Variação (`idProdutoPai` presente) é linha normal com `variacao_de`. `formato = 'E'` (kit): vai para `kits` com `componentes` do detalhe (`estrutura.componentes[].produto.id`, `quantidade`).
5. Produto sem custo, sem SKU ou sem fornecedor padrão vira linha com `custo: null` (rejeição `custo_ausente`/`sku_vazio`): **nunca zero**. É o caso que o DRE do próprio Bling mostra como "margem cheia".
6. Limites: 2,5 req/s por conta (`limitador` com espaçamento mínimo de 400 ms); processamento de contas com concorrência 4; teto global 30 req/s por processo; renovações de token escalonadas e teto global de 10 chamadas/min a `/oauth/token` (o IP é bloqueado por 1 h aos 20/min). `429` com `period=second`: espera ≥ 1 s com jitter e tenta de novo (máx. 4); `period=day`: para até o dia seguinte e marca `erro` transitório. `401 invalid_token`: renova uma vez; `invalid_grant` ou "Empresa inativa": estado `reautorizar`, sem laço de repetição. Erros 4xx exceto 401/429 não são repetidos.
7. `testar()` usa `GET /empresas/me/dados-basicos` (escopo "dados básicos da empresa"; `id` string) e grava `company_id`.
8. Escopos a pedir no app: **só leitura** — "Produtos" e "Visualizar os dados básicos da empresa" (+ o do recurso `product_supplier` para o webhook). **NÃO CONFIRMADO:** qual escopo libera `GET /produtos/fornecedores` ("Produtos" ou "Clientes e Fornecedores"). A lista final tem de ser fixada ANTES do 1º cliente autorizar (mudar depois revoga todos). Ao conectar, se os escopos devolvidos incluírem algum de escrita, o cartão avisa "escopos acima do necessário".

### 7.3 Tiny / Olist ERP API v3 — fatos, fonte e status
| Fato | Fonte / status |
|---|---|
| v3 vigente (`https://api.tiny.com.br/public-api/v3`); v2 continua funcionando, congelada, sem data de descontinuação anunciada | [OFICIAL] https://tiny.com.br/api-docs/api |
| Cliente cria o app na própria conta: Configurações > Aplicativos > "+ novo aplicativo"; exige plano Construa ou superior e a extensão "Gestão de Aplicativos"; máx. 5 apps por conta | [OFICIAL] https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao |
| Authorize `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?client_id=…&redirect_uri=…&scope=openid&response_type=code`; token `POST https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token` (`grant_type`, `client_id`, `client_secret`, `redirect_uri`, `code` / `refresh_token`) | [OFICIAL] https://api-docs.erp.olist.com/documentacao/comecando/autenticacao |
| Access token 4 h; **refresh token 1 dia** (conector parado > 24 h exige novo consentimento) | [OFICIAL] idem |
| `state` no authorize: padrão OIDC, a doc só lista os outros parâmetros | NÃO CONFIRMADO (se o Tiny não devolver `state`, usar redirect por conta `/erp/callback` + nonce registrado; o checklist testa) |
| "Escopos" reais = permissões do app por módulo (Leitura / Incluir e editar / Excluir). Marcar **só Leitura em Produtos** | [OFICIAL] idem |
| `GET /produtos` (revalidado em 05/10/2026): itens com `id`, `sku`, `descricao`, `tipo` (K,S,V,F,M), `situacao` (A,I,E), `dataAlteracao`, `tipoVariacao` (N,P,V) e `precos.{preco, precoPromocional, precoCusto, precoCustoMedio}` (todos nullable); parâmetros `nome`, `codigo`, `gtin`, `situacao`, `dataCriacao`, `dataAlteracao`, `idListaPreco`, `limit` (100), `offset` (0) | [OFICIAL] https://api-docs.erp.olist.com/api-reference/produtos/listar-produtos.md |
| `GET /produtos/{id}` traz `precos`, `variacoes[].precos`, `kit[]`, `fornecedores[]`; `GET /produtos/{id}/kit` devolve `[{produto{id,sku,…}, quantidade}]` sem custo dos componentes; `GET /produtos/{id}/custos` é histórico (`precoCusto`, `custoMedio`, `data`…) | [OFICIAL] https://api-docs.erp.olist.com/api-reference/produtos/obter-produto.md · …/obter-produto-kit.md · …/listar-custos-do-produto.md |
| Preço de custo = valor unitário + importação, frete, seguro, ICMS ST, IPI e outras despesas, MENOS impostos recuperáveis e descontos; custo médio = média ponderada pelo saldo; só se atualizam em Nota de Entrada/Ordem de Compra/"Formação de Preços" (custo vazio ou velho se o cliente não faz esse passo) | [OFICIAL] https://ajuda.olist.com/precificacao/formacao-de-precos |
| Limites v3 por minuto e por CONTA (compartilhado com outros apps do cliente): Construa/Crescer 30, Evoluir/Impulsione 60, Domine 120, Protagonize/Potencializar 140. Cabeçalhos `X-RateLimit-Limit/Remaining/Reset` | [OFICIAL] https://api-docs.erp.olist.com/documentacao/comecando/limites-de-consulta.md |
| Código HTTP ao estourar o limite na v3 | NÃO CONFIRMADO (tratar 429 e qualquer erro com `X-RateLimit-Remaining: 0`) |
| Webhooks v3: só vendas, pedido enviado, lançamento de estoque, NF autorizada; **nenhum de produto/preço/custo**; sem assinatura documentada | [OFICIAL] https://api-docs.erp.olist.com/documentacao/webhooks/webhooks.md |
| Rotação do refresh token | [TERCEIROS] https://github.com/diegobentes/olist_erp (tratar como rotativo) |
| Homologação: exigida de quem "comercializar, distribuir ou oferecer o serviço" a outros sellers. Se a Place2u lendo vários clientes entra nisso | NÃO CONFIRMADO (perguntar a `erp.partners@olist.com`) |
| `limit` máximo, padrão de `situacao` sem parâmetro, variações como linhas da listagem, se mudança só de custo atualiza `dataAlteracao`, se SKU é único na conta | NÃO CONFIRMADO |

**Algoritmo da varredura Tiny (M5):**
1. `GET /produtos?limit=100&offset=N&situacao=A`, depois `situacao=I` (nunca confiar no padrão; lista de situações configurável, `E` fora). Para quando `offset ≥ paginacao.total` ou página vazia (teto 500 páginas por situação).
2. Campo de custo por cliente (`erp_cliente_cfg.campo_custo_tiny`): `preco_custo` → `precos.precoCusto` (`campo='tiny.precos.precoCusto'`), `custo_medio` → `precos.precoCustoMedio` (`campo='tiny.precos.precoCustoMedio'`). **Sem fallback entre os dois.** Nulo ou 0 do campo escolhido: `custo: null` com `dica` ("o outro campo tem R$ X") para a lista de rejeitadas.
3. `tipoVariacao='P'` (pai): ignorado com aviso; `'V'`: linha normal com `variacao_de`. **NÃO CONFIRMADO** se variações aparecem como linhas da listagem; se não aparecem, o conector busca o detalhe do pai (`variacoes[].precos`), com teto de 200 detalhes por varredura (excedente na `erp_fila`).
4. `tipo='K'`: kit, `GET /produtos/{id}/kit` para a estrutura (teto próprio de 200 por varredura).
5. Limite: usa `X-RateLimit-Remaining/Reset` quando presentes; sem eles, 25 req/min por conta (o menor plano é 30). 3.000 SKUs = 30 chamadas de listagem, ~1 min.
6. Renovação do token: refresh de 1 dia exige **keepalive**: o tick de custos renova se o refresh tem mais de 12 h; falha em `invalid_grant` = `reautorizar`.
7. `testar()`: `GET /produtos?limit=1` (só o módulo Produtos). 401 pode ser falta de permissão do usuário no módulo, não token expirado: a mensagem ao dono diz isso.

### 7.4 Orquestrador de sync (M7, `src/lib/erp-sync.js`)
`sincronizarCliente(cliente, fonte, { motivo, deps })`:
1. Lock por `(cliente, fonte)` (Map em memória + `erp_fontes.sync_estado='rodando'`, morto após 30 min). Não roda se há plano de promoção `executando` do cliente (apenas no tick agendado; "sincronizar agora" manual roda).
2. Marca início (`inicio = agora`); obtém conector via `deps.criarConector` (injetável); varre; **deduplica a varredura inteira por `sku_key`**: SKU repetido com custos diferentes rejeita todas as ocorrências (`sku_duplicado_no_lote`); com custos iguais, vale um (unicidade do `codigo` no Bling e do `sku` no Tiny é NÃO CONFIRMADA).
3. Aplica em blocos de 500 com `aplicarLote({ modo:'completo', ... })`; resolve kits (5.9) após os itens simples; falha no meio = aplica o que leu, NÃO chama `fecharSyncCompleto`, NÃO atualiza `ultimo_sync_ok_em`, marca `erro` com mensagem sanitizada.
4. Varredura completa e bem-sucedida: `fecharSyncCompleto(cliente, fonte, inicio)`; grava `ultimo_sync_ok_em` e `ultimo_resumo_json` (contagens, kits pendentes, detalhes pendentes, páginas, duração).
5. **Tick agendado** (`tickCustos`, chamado de 10 em 10 min pelo `server.js`): para cada `(cliente, fonte ∈ {bling, tiny})` conectado, não `pausado`/`reautorizar`, **que ainda não teve sync OK hoje** e `tentativas_dia < 3`, e a partir das 03:00 locais (não só numa janela: se o Mac estava desligado às 03:00, recupera ao ligar). Estado por cliente em tabela, não marcador único do dia (corrige o padrão de `server.js:247`, em que falha parcial só retenta no dia seguinte). Concorrência 2 contas. Também faz o keepalive do Tiny e `podarCustos()` 1×/dia.
6. **Worker da fila** (`processarFila`, a cada 5 s): drena `erp_fila` (gatilhos do Bling e detalhes pendentes) respeitando o limitador, com `tentativas` e `proxima_em` (backoff), até 3 tentativas; item que esgota vira aviso no resumo, nunca laço infinito.
7. "Sincronizar agora": `iniciarSync(cliente, fonte)` devolve `{ job_id }` (Map em memória, máx. 20, como `jobsPromo`); o estado persistente fica em `erp_fontes`. Um sync por vez por conta.

---

## 8. Planilha Google Sheets (M3, `src/lib/custos-sheets/Codigo.gs` + `src/lib/custos-sheets-script.js`)

**Formato da aba `Custos`:** A = SKU (formato "Texto simples", senão zeros à esquerda se perdem), B = MLB (opcional), C = Custo (número), D = Status (escrito pelo script). Linha 1 = cabeçalho.

**Base:** o esqueleto de Apps Script já testado em harness Node (relatório Sheets, `Codigo.gs` de 72 linhas), com as mudanças abaixo. Esse harness **não rodou no Apps Script real**.

Mudanças obrigatórias em relação ao esqueleto:
1. Aceita linha com SKU **ou** MLB (pelo menos um); regra do MLB `^MLB\d{1,14}$` (igual ao servidor).
2. Corpo com `mode:'full'`, `sync_id` (UUID por envio), `batch_no`, `batch_total`, `line` em cada item.
3. Resposta: coluna Status trata `accepted` (OK), `quarantined` ("EM ANÁLISE: motivo", não é erro, o valor ainda não vale), `refused` ("RECUSADO no painel — o painel mantém R$ X") e `rejected` ("REJEITADO (servidor): motivo"), por `line`. "OK" só quando `accepted + quarantined_total + rejected_total + refused_total + duplicates_equal` = itens do lote e as listas vieram inteiras; senão "ENVIADO … (confira no painel)". Cabeçalho da aba conferido (SKU | MLB | Custo | Status) antes de ler/escrever; lotes cortados em 500 itens ou ~200 KB; erro de fórmula nunca é enviado; Sync_Log com Envio/Lote/Detalhe em formato texto.
4. **Batimento diário:** se o hash não mudou mas o último envio completo tem mais de 20 h, reenvia o completo (guarda `LAST_SEND` em `DocumentProperties`), para o servidor atualizar `visto_em` e a pendência de custo velho não disparar à toa.
5. Função `instalar()` gerada com URL e segredo preenchidos: grava `WEBHOOK_URL` e `WEBHOOK_SECRET` em Script Properties, cria o gatilho por tempo de 10 min (`everyMinutes(10)`), cria a aba `Custos` e `Sync_Log` se faltarem. Instrução: rodar `instalar` uma vez, autorizar, **apagar a função `instalar`** (o segredo fica só em Script Properties). Menu `Custos`: "Sincronizar agora", "Configurar".
6. Tudo o que o esqueleto já tem fica: HMAC `computeHmacSha256Signature(ts + '.' + body, segredo)` com conversão de byte com sinal (`b & 0xff`), corpo JSON só ASCII (`\uXXXX`), lotes de 500, retry com backoff em 429/5xx/rede (4 tentativas, mesmo corpo, carimbo novo), sem retry em 4xx, `LockService`, hash de pulo, hash só salvo se todos os lotes deram certo, rejeição local de vazio/texto/erro/Date/Boolean/≤0/SKU duplicado (todas as ocorrências), `onOpen` só cria menu, **sem `onEdit`** (simples não chama UrlFetch; instalável gera uma chamada por edição).
7. Segurança do script: segredo só em Script Properties; **qualquer editor da planilha o lê** (fonte: https://developers.google.com/apps-script/guides/collaborating). Por isso o segredo é por cliente e o servidor só aceita upsert de custo daquele cliente. Copiar a planilha copia o código: o guia manda gerar um webhook novo por planilha (não embutir segredo em template).
8. `gerarScriptApps({ url, segredo })`: lê `Codigo.gs`, substitui `__WEBHOOK_URL__` e `__WEBHOOK_SECRET__`; valida `url` (`^https://`, sem aspas/quebra de linha) e `segredo` (`^[0-9a-f]{64}$`); escapa para string JS. Não loga o texto gerado.
9. Quotas [OFICIAL] https://developers.google.com/apps-script/guides/services/quotas: 20.000 chamadas UrlFetch/dia (conta comum), 90 min/dia de gatilho; 10.000 SKUs = 20 chamadas por envio.

**NÃO CONFIRMADO (só vale testar no Apps Script real):** autorização na 1ª execução e aviso de app não verificado; se UrlFetch codifica o payload string em UTF-8 (neutralizado: corpo ASCII); tipo devolvido por `getValues()` para `#N/A` (o código rejeita tudo que não é `number`); se "Fazer uma cópia" copia Script Properties; se um WAF barra o User-Agent `Google-Apps-Script`.

---

## 9. Segurança (resumo executável)

1. **Cripto:** `cifrarSegredo/decifrarSegredo` novos em `cripto.js` (M6): AES-256-GCM, formato `v1.<iv>.<tag>.<enc>`, chave derivada por scrypt de `ERP_TOKEN_KEY` (fallback `MELI_TOKEN_KEY`; **nunca** a chave de desenvolvimento: sem chave lança erro `ERP_SEM_CHAVE` e a rota responde 409), salt `place-sprints-erp-v1`, chave derivada em cache de memória (scrypt custa ~19 ms por chamada). `cifrar/decifrar` do ML ficam intactos. Backup da chave: perdê-la = reconectar todos.
2. **Nunca em log/frontend:** `ultimo_erro` e `erro` passam por `sanitizar()` (remove `Bearer …`, `access_token`, `refresh_token`, `client_secret`, `code`, corpo de resposta do ERP truncado em 300 caracteres). Listagens não selecionam colunas `*_cifrado` nem `segredo_*`. Handler de rotas ERP nunca registra corpo da requisição.
3. **OAuth:** `state` = HMAC com expiração (30 min) e nonce de uso único (`erp_oauth_state`), preso a `(cliente, fonte)`; callback público `GET /erp/callback`; troca o `code` UMA vez (se falhar, não reusa: no Bling reuso revoga). Sem tela que peça senha de ERP.
4. **Entrada pública:** corpo ≤ 256 KB, HMAC antes de qualquer parse, `timingSafeEqual`, janela ±300 s, resposta 401 uniforme, limites por `wid` e por IP, nenhum SQL concatenado (só prepared statements), `JSON.parse` sem mesclar em objeto existente.
5. **SSRF:** hosts de saída em allowlist fixa; URL nunca vem de payload ou banco.
6. **Isolamento:** `wid` resolve o cliente; `cliente` do corpo é ignorado; toda query filtra por `cliente`; os custos não entram em `TABELAS_DERIVADAS` (preservados na troca de conta ML), mas a lista de conflitos MLB-dependentes é limpa.
7. **Só leitura:** nenhum `POST/PUT/PATCH/DELETE` a ERP além do fluxo OAuth (`/oauth/token`); nenhuma chamada ao ML.
8. **Rotas de gestão** (`/api/custos/*`) não são públicas (`ROTA_PUBLICA` não as cobre): inacessíveis pelo túnel; POST com `Origin` só passa se for o do próprio painel.

---

## 10. API de gestão e interface

### 10.1 Rotas (M8, `src/rotas-custos.js`, `Router`, injeção `depsCustos`)
Todas exigem `cliente` com conta ML conectada (mesmo padrão de `exigirCliente` de `rotas-promocoes.js`, via `depsCustos.conexoes` injetável nos testes); validação de entrada com os helpers exportados de `rotas-promocoes.js` (`texto`, `exigirTexto`, `inteiro`, `simNao`); lixo = 400 com mensagem; nunca stack.

| Rota | Função |
|---|---|
| `GET /api/custos/resumo?cliente=` | Dados do cartão (formato abaixo) + pendências |
| `GET /api/custos/skus?cliente=&fonte=&q=&limite=&offset=` | Custos efetivos com proveniência e frescor (alimenta a aba Custos) |
| `GET /api/custos/historico?cliente=&sku=&limite=` | Histórico de mudanças do SKU (todas as fontes, inclui manual) |
| `GET /api/custos/reconciliacao?cliente=&lista=&limite=` | `lista` ∈ `sku_erp_sem_anuncio`, `anuncio_sem_custo`, `anuncio_sem_sku`, `conflito`, `rejeitadas`, `quarentena`, `nao_visto`, `kits_pendentes`, `divergencia_fontes` |
| `POST /api/custos/quarentena/decidir` | `{cliente, itens:[{sku,fonte}], decisao:'aprovar'\|'recusar', por}` |
| `POST /api/custos/descartar` | `{cliente, sku, fonte, por}`: remove o vigente da fonte (volta a SEM CUSTO se não houver outra); histórico `descartado` |
| `POST /api/custos/config` | `{cliente, ordem_fontes, limiar_variacao_pct, quarentena_custo_ge_preco, campo_custo_tiny, velho_dias_erp, velho_dias_sheets, por}` |
| `POST /api/custos/fontes/sheets/webhook` | `{cliente, acao:'gerar'\|'rotacionar'\|'desativar'}`; `gerar/rotacionar` devolvem `{url, segredo, script}` UMA vez, `Cache-Control: no-store` |
| `POST /api/custos/erp/app-global` | `{fonte:'bling', client_id, client_secret}`: aplicativo global da Place2u (digitado na tela; cifrado; não devolve) |
| `POST /api/custos/erp/credenciais` | `{cliente, fonte, modo_app, client_id, client_secret}` (Tiny, ou Bling em modo próprio); resposta `{ok:true}` sem eco |
| `POST /api/custos/erp/autorizar` | `{cliente, fonte}` → `{url}` (link com `state` assinado, para o cliente abrir e autorizar) |
| `POST /api/custos/erp/desconectar` | `{cliente, fonte}`: apaga tokens locais (o guia manda desinstalar em "Minhas Instalações" do Bling) |
| `POST /api/custos/fontes/sincronizar` | `{cliente, fonte}` → `202 {job_id}` (409 se já rodando) |
| `GET /api/custos/job/:id` | Estado do job |
| `GET /api/custos/vinculos?cliente=` | Vínculo custo ↔ anúncio (07/10, decisão nº 14): `custos_sem_anuncio` e `anuncios_sem_custo` (por faturamento) com candidatos por semelhança de nome, `vinculados` com a origem (manual / SKU / SKU normalizado / herdado) e `totais`; nunca grava |
| `POST /api/custos/vincular` | `{cliente, item_id, sku_custo, por}`: vínculo manual, um por anúncio, manda sobre o SKU. Anúncio fora do cliente → 404; SKU de custo sem custo vigente → 400 (sem eco) |
| `POST /api/custos/recusar` | `{cliente, item_id, sku_custo, por}`: "não é este" — o par sai das sugestões e dos casamentos automáticos |
| `POST /api/custos/desvincular` | `{cliente, item_id, sku_custo?, por}`: sem `sku_custo` tira o manual; com ele apaga o par (desfaz também um "não é este") |

**Formato de `GET /api/custos/resumo` (contrato M8↔M9):**
```json
{ "cliente": "X", "cfg": { "...": "erp_cliente_cfg" }, "pendencias": [ { "codigo": "CUSTO_FONTE_VELHA", "estado": "ATENCAO", "texto": "..." } ],
  "fontes": {
    "sheets": { "estado": "conectado", "ultimo_sync_ok_em": "ISO", "idade_dias": 0.2, "velha": false, "ultimo_erro": "",
                "contagens": { "skus": 120, "rejeitadas": 2, "quarentena": 1, "nao_vistos": 0 },
                "webhook": { "ativo": true, "url": "https://.../webhook/custos/ID", "criado_em": "ISO", "rotacionado_em": "", "ultimo_uso_em": "ISO" } },
    "bling": { "estado": "desconectado", "...": "idem", "credenciais": { "conectado": false, "modo_app": "global", "escopos": [], "company_id": "", "expira_em": "" } },
    "tiny":  { "...": "idem" } },
  "efetivo": { "skus_com_custo": 120, "por_fonte": { "manual": 10, "bling": 0, "tiny": 0, "sheets": 110 },
               "cobertura_receita_pct": 83.2, "anuncios_total": 517, "anuncios_sem_sku": 220, "anuncios_sem_custo": 40 },
  "reconciliacao_disponivel": true, "reconciliacao_motivo": "" }
```
`cobertura_receita_pct`, `anuncios_*` e as listas de reconciliação dependem de `promo_anuncio`; sem coleta de promoções do cliente, `reconciliacao_disponivel=false` com o motivo "rode a coleta de promoções do cliente".

### 10.2 UI (M9)
**Integrações** (`src/web/integracoes.html:60-83`, `integracoes.js:11-14,43-58,69-76,79-104`): quarto card e quarta coluna **"Custos (ERP/Planilha)"** por cliente:
- chip de estado por fonte (conectado, erro, reautorizar, desconectado, velha), última sincronização, contagens (SKUs com custo, rejeitadas, quarentena, não vistos), cobertura da receita;
- ações: **Planilha** (gerar webhook / rotacionar / desativar; modal com URL, segredo mostrado uma única vez com aviso, botão "Copiar Apps Script pronto"; passo a passo de 4 linhas), **Bling/Tiny** (campos `client_id`/`client_secret` com `type=password`, "Gerar link de autorização", "Desconectar"), **Sincronizar agora**, **Reconciliação** (abas das listas), **Quarentena (N)** com Aprovar/Recusar por linha e em lote;
- nenhum segredo de ERP volta do servidor; o segredo do webhook fica só em variável do modal.

**Promoções → aba Custos** (`src/web/promocoes.js:349-375`): a tabela "Custos cadastrados" ganha colunas **Fonte**, **Campo do ERP**, **Atualizado na fonte**, **Recebido/visto** e chip de **frescor** (verde dentro do limite, âmbar velho); linha manual aparece como "manual" com sua `fonte` livre; link "histórico" por SKU. Seções novas "Quarentena" e "Reconciliação". As pendências `CUSTO_*` entram no painel de pendências existente.

---

## 11. Módulos, posse de arquivos e contratos de interface

**Regra de posse:** cada arquivo existente tem UM dono (nenhuma edição concorrente). Arquivos compartilhados (`server.js`, `guarda-local.js`, `rotas-promocoes.js`, consumidores) só o M10 edita.

| ID | Entrega | Arquivos NOVOS | Arquivos EXISTENTES que edita | Teste |
|---|---|---|---|---|
| **M1 Núcleo** | DDL, repositório, `aplicarLote`, precedência, quarentena, histórico, reconciliação, pendências | `src/lib/custos-db.js` | `src/lib/promocoes-db.js` (SCHEMA, gancho em `importarCustosSku`, `limparPromocoesDoCliente`, retenção) | `scripts/teste-custos-nucleo.mjs` |
| **M2 Webhook** | Rota pública, HMAC, idempotência, limites, gerar/rotacionar, gatilho Bling | `src/lib/custos-webhook.js` | nenhum | `scripts/teste-custos-webhook.mjs` |
| **M3 Apps Script** | Script + gerador | `src/lib/custos-sheets/Codigo.gs`, `src/lib/custos-sheets-script.js` | nenhum | `scripts/teste-custos-apps-script.mjs` |
| **M4 Bling** | Conector | `src/lib/erp-bling.js`, `scripts/fixtures/erp/bling-*.json` | nenhum | `scripts/teste-erp-bling.mjs` |
| **M5 Tiny** | Conector | `src/lib/erp-tiny.js`, `scripts/fixtures/erp/tiny-*.json` | nenhum | `scripts/teste-erp-tiny.mjs` |
| **M6 Credenciais e infra** | HTTP/limitador, cripto de ERP, OAuth, callback, páginas | `src/lib/erp-http.js`, `src/lib/erp-credenciais.js`, `src/lib/erp-paginas.js` | `src/lib/cripto.js` (só acrescenta), `src/lib/env.js` (`ERP_TOKEN_KEY`), `.env.example` | `scripts/teste-erp-credenciais.mjs` |
| **M7 Sync** | Orquestrador, kits, tick, fila, jobs | `src/lib/erp-sync.js` | nenhum | `scripts/teste-erp-sync.mjs` |
| **M8 Rotas** | API de gestão | `src/rotas-custos.js` | nenhum | `scripts/teste-custos-rotas.mjs` |
| **M9 UI** | Cartão, modais, aba Custos | nenhum | `src/web/integracoes.html`, `src/web/integracoes.js`, `src/web/promocoes.js` (e CSS inline/arquivo já usado por essas telas) | `scripts/teste-custos-ui.mjs` (estático: endpoints e ids referenciados existem) |
| **M10 Integração** | Consumidores, montagem no servidor, guarda, docs, script de teste | `docs/integracao-custos-erp.md` (guia do usuário), `scripts/teste-custos-integracao.mjs` | `src/server.js`, `src/lib/guarda-local.js`, `src/lib/promocoes-analista.js` (linha ~523), `src/lib/promocoes-coleta.js` (linha ~241), `src/rotas-promocoes.js` (rota `/custos` e pendências), `scripts/teste-promocoes-rotas-mc.mjs` (casos do guard), `package.json` (script `teste:custos`), `README.md`, `docs/promocoes-por-cliente.md` | `teste-custos-integracao.mjs` |
| M11 (F3) | CMV% derivado do ERP para o plano da conta | — | `src/lib/diagnostico-conta.js`, `src/lib/plano-anuncios.js`, `src/web/cliente.js` | a definir |
| M12 (F3) | `sku` em `meli_item` | — | `src/lib/db.js` (ALTER guardado DEPOIS dos CREATE), `src/lib/meli-api.js`, `src/lib/meli-serie.js` | a definir |

**Edições do M10 em detalhe:**
- `promocoes-analista.js` ~523 e `promocoes-coleta.js` ~241: trocar `new Map(repo.listarCustosSku(cliente).map(...))` por `custosEfetivos(cliente)` (de `custos-db.js`). É a **única** troca nos consumidores: `resolverCustos`, `calcularMC`, `montarPlano` e `promocoes-exec.js` (que lê `e.custosSku`) seguem intactos.
- `rotas-promocoes.js` `GET /api/promocoes/custos`: mantém `skus` como está (compatibilidade) e acrescenta `skus_efetivos` (detalhe com proveniência) e `custos_pendencias`; `GET /api/promocoes/resumo` acrescenta `pendenciasCustos(cliente)` à lista `pend`. O texto de `SEM_CUSTO` passa a apontar também para as integrações.
- `server.js`: (1) `app.use('/webhook/custos', rotasWebhookCustos)` entre `guardaLocal` e `express.json`; (2) `app.get('/erp/callback', ...)` com `tratarCallbackErp`; (3) `app.use(rotasCustos)` depois do JSON; (4) `setInterval(tickCustos, 10*60*1000)` e `setInterval(processarFila, 5000)`; (5) `configurarLogCustos(log)`; (6) handler de erro com 413 para `entity.too.large`. **O timer não compartilha lock com as coletas do ML** (o sync de ERP não chama o ML).
- `guarda-local.js`: `ROTA_PUBLICA` ganha `webhook\/custos\/[A-Za-z0-9_-]{16,64}$` e `erp\/callback$`. Endurecimento opcional (com ajuste de teste): ancorar também `webhook\/(notion|meli)` com `(\/|$)`.
- `teste-promocoes-rotas-mc.mjs` (guard): casos novos: `/webhook/custos/<wid>` e `/erp/callback` passam pelo túnel; `/webhook/custos` sem wid, `/webhook/custos/x/y`, `/api/custos/resumo` pelo túnel = 403.

### 11.1 Contratos (assinaturas congeladas; mudar exige atualizar esta spec)

```js
// ── M1: src/lib/custos-db.js ────────────────────────────────────────────────
export const FONTES_EXTERNAS = ['bling', 'tiny', 'sheets']
export const FONTES = ['manual', ...FONTES_EXTERNAS]
export function normalizarSku(s) /* → string ('' se inválido) */, chaveSku(s), normalizarMlb(s) /* → 'MLB…' | '' */
export function lerCustoMaquina(v) /* → { custo, custo_txt } | { motivo, codigo } */
export function getCfgCustos(cliente) /* → cfg com defaults */, setCfgCustos(cliente, patch, por) /* valida; audita; lança erro 400 */
export function aplicarLote({ cliente, fonte, modo /* 'parcial'|'completo' */, lote_id, linhas /* LinhaCusto[] */, origem /* 'webhook'|'sync'|'fila' */, por = '' })
  /* → ResumoLote; transação única; NUNCA lança por linha ruim */
export function fecharSyncCompleto(cliente, fonte, inicioISO) /* → { nao_vistos, rejeitadas_removidas } */
export function custosEfetivos(cliente) /* → Map<sku_minusculo, number>; drop-in de custosSku */
export function custosEfetivosDetalhe(cliente, { fonte, q, limite = 200, offset = 0 } = {}) /* → { total, itens:[{ sku, custo, fonte, campo, atualizado_na_fonte, recebido_em, visto_em, nao_visto_desde, id_externo, idade_dias, perdedoras:[{fonte, custo}] }] } */
export function historicoSku(cliente, sku, limite = 100)
export function listarQuarentena(cliente, { estado = 'pendente' } = {})
export function decidirQuarentena(cliente, itens /* [{sku, fonte}] */, decisao, por) /* → { aprovados, recusados, ignorados } */
export function descartarCusto(cliente, sku, fonte, por)
export function reconciliacao(cliente, lista, { limite = 200 } = {}) /* → { lista, disponivel, motivo, total, itens, cobertura } */
export function resumoCustos(cliente, agoraMs = Date.now()) /* → bloco "fontes"+"efetivo" do GET /resumo, sem webhook/credenciais */
export function pendenciasCustos(cliente, agoraMs = Date.now()) /* → [{ codigo, estado, texto }] */
export function estadoFonte(cliente, fonte), gravarEstadoFonte(cliente, fonte, patch)
export function skuPorIdExterno(cliente, fonte, id) /* → string | null */
export function podarCustos(agoraMs = Date.now())
export function configurarLog(fn)  // injeção do logger
// ResumoLote
{ lote_id, recebidas, aceitas, novas, alteradas, inalteradas, recusado_antes, recusado_antes_lista: [{ sku, linha, custo_mantido, motivo }],   // máx. 200
  em_quarentena, quarentena_lista: [{ sku, linha, codigo, motivo, variacao_pct }],      // máx. 200
  rejeitadas, rejeitadas_lista:   [{ sku, mlb, linha, codigo, motivo }],                 // máx. 200
  impacto: { skus_com_aprovacao_afetada } }
// Códigos de rejeição: sku_vazio sku_invalido mlb_invalido mlb_sem_sku conflito_sku_mlb sku_duplicado_no_lote
//   custo_ausente custo_invalido custo_zero_ou_negativo custo_acima_maximo kit_sem_estrutura kit_componente_sem_custo
// Códigos de quarentena: variacao_brusca custo_ge_preco kit_divergente
// Pendências: CUSTO_FONTE_VELHA CUSTO_FONTE_ERRO CUSTO_REAUTORIZAR CUSTO_QUARENTENA CUSTO_REJEITADO CUSTO_NAO_VISTO

// ── M2: src/lib/custos-webhook.js ───────────────────────────────────────────
export const rotasWebhookCustos   // Router: POST /:wid  (limitador → express.raw 256kb → tratar)
export async function tratarWebhook({ wid, headers, raw /* Buffer */, agoraMs, ip }) /* → { status, headers?, body } (pura, testável sem porta) */
export function verificarAssinaturaSheets({ segredo, timestamp, raw, assinatura, agoraMs }) /* → boolean */
export function gerarWebhook(cliente, fonte) /* → { wid, url, segredo }  (segredo só aqui) */
export function rotacionarSegredo(cliente, fonte) /* → { wid, url, segredo } */
export function desativarWebhook(cliente, fonte), statusWebhook(cliente, fonte) /* → { ativo, url, criado_em, rotacionado_em, ultimo_uso_em } | null */
export function configurarLog(fn)

// ── M3 ──────────────────────────────────────────────────────────────────────
export function gerarScriptApps({ url, segredo }) /* → string do Codigo.gs */

// ── M6: src/lib/erp-http.js / erp-credenciais.js / cripto.js ────────────────
export const httpPadrao /* fetch, allowlist, teto 5 MB, timeout 20 s */
export function criarLimitador({ porSegundo, porMinuto, global }) /* → { aguardar(), registrar429(retryAfterMs) } */
export function cifrarSegredo(texto), decifrarSegredo(str)   // em cripto.js
export function salvarAppGlobal(fonte, { client_id, client_secret }, por)
export function salvarCredenciaisApp(cliente, fonte, { modo_app, client_id, client_secret }, por)
export function urlAutorizacao(cliente, fonte) /* → string com state assinado */
export async function tratarCallbackErp(query, deps) /* → { status, html } */
export async function obterTokenValido(cliente, fonte, deps) /* → string | null (lock por conta; grava refresh novo atomicamente; invalid_grant → estado 'reautorizar') */
export function statusCredenciais(cliente, fonte) /* sem segredos */, desconectarErp(cliente, fonte)

// ── M4/M5 ───────────────────────────────────────────────────────────────────
export function criarConectorBling(deps), criarConectorTiny(deps)    // contrato em 7.1

// ── M7: src/lib/erp-sync.js ─────────────────────────────────────────────────
export async function sincronizarCliente(cliente, fonte, { motivo, deps })
export function iniciarSync(cliente, fonte, deps) /* → { job_id } */, statusJob(id)
export async function tickCustos({ agora = new Date(), deps })
export async function processarFila({ deps })
export function configurarLog(fn)

// ── M8 ──────────────────────────────────────────────────────────────────────
export const rotasCustos, depsCustos = {}        // depsCustos.conexoes injetável (testes)

// ── ACRÉSCIMOS fixados na integração final (aditivos; nenhuma assinatura acima mudou) ──
// LinhaCusto += kit_pendente?: 'kit_sem_estrutura'|'kit_componente_sem_custo' (M7→M1: custo null + código do kit), linha?: inteiro (M2→M1)
// Página do varrer() += pendentes_detalhe?: string[] (M4→M7: excedente do teto de detalhes → erp_fila motivo 'detalhe')
// custoDoProduto → { linhas, kits? } (kit nunca aplica custo próprio direto; a soma é do M7)
// obterToken(opcoes?) do conector: { renovar: true } após 401 do Bling → obterTokenValido(cliente, fonte, { renovar|forcar, http, limitadorToken, agoraMs })
// null de obterTokenValido SEM estado 'reautorizar' = falha transitória: o M7 converte em erro comum (estado 'erro', o tick retenta);
//   só o M6 marca 'reautorizar' (invalid_grant/invalid_client/empresa inativa)
// Erro dos conectores: Error com .codigo ('reautorizar' | 'limite_dia' | 'http' | 'sem_permissao' | 'limite' | 'teto' | 'token' | 'id' | 'config') e .status
// custosEfetivosDetalhe: item += velha (frescor da FONTE pelo limite do cliente; a aba Custos usa este campo)
// ResumoLote += duplicadas_iguais · resumoCustos += reconciliacao_disponivel, reconciliacao_motivo; fontes.* += ultimo_sync_em, sync_estado
// gravarEstadoFonte: chaves aceitas estado, sync_estado, ultimo_resumo (objeto), ultimo_erro, tentativas_dia, ultimo_sync_em, ultimo_sync_ok_em,
//   sync_iniciada_em, tentativas_dia_data (outra chave = erro 400)
// desconectarErp(cliente, fonte, por = '') · export function sanitizar(texto) em erp-http.js · export const hmacErp em cripto.js
// criarLimitador({ global }): número (limitador compartilhado por valor) ou objeto limitador
// Webhook: 4xx de quem JÁ autenticou responde { ok:false, error:'<mensagem PT>' } (401 continua { ok:false } fixo)
// gerarScriptApps lança Error com .status 400 (entrada inválida) ou 500 (modelo .gs alterado)
// Rotas extras do M8: GET /api/custos/quarentena?estado= → { estado, itens } · GET /api/custos/pendencias → { pendencias };
//   "por" obrigatório em TODO POST de /api/custos (inclui webhook, app-global, credenciais, autorizar, desconectar, sincronizar)
// GET /api/promocoes/custos: skus_efetivos = { total, itens } (custosEfetivosDetalhe, limite 1000), custos_pendencias = pendenciasCustos
```

---

## 12. Testes e entrega sem credenciais reais

**Princípios:** conectores com camada HTTP injetável; fixtures construídas a partir dos formatos da documentação (cada arquivo traz `_fonte_doc` com a URL e `_aviso: "construída a partir da documentação; não é captura real"`); todos os auto-testes rodam em memória com `process.env.PS_PROMO_MEMORIA = '1'` **antes** dos imports (padrão de `teste-promocoes-rotas-mc.mjs`), com `assert.equal(R.EM_MEMORIA, true)`; nenhum teste abre `data/db.sqlite`, sobe a porta 3012, chama ML, Bling, Tiny ou Google. Rodar tudo: `npm run teste:custos`.

| Script | Casos mínimos |
|---|---|
| `teste-custos-nucleo.mjs` (M1) | custo `''`, `null`, `undefined`, `NaN`, `Infinity`, `0`, `-1`, `true`, `[]`, `"1,234"`, `"R$ 12,50"` → rejeitados com código e NÃO alteram vigente; `CHECK` do SQLite barra `INSERT` direto de 0; SKU: NBSP, zero-width, espaços internos preservados, 81 caracteres rejeitado, caixa diferente casa; MLB inválido/MLBU rejeitado; `conflito_sku_mlb`, `mlb_sem_sku` com `promo_anuncio` semeado; duplicado no lote (iguais vale um, diferentes rejeita todos); `variacao_brusca` (51% sim, 50% não, primeiro valor não); `custo_ge_preco` usa o menor preço cheio; quarentena não troca vigente, aprovar troca e registra histórico, recusar não reabre com o mesmo valor e reabre com outro; inalterado só atualiza `visto_em`; histórico completo (novo→alterado→quarentena→aprovado); `fecharSyncCompleto` marca `nao_visto_desde`, NÃO apaga nem zera, e reaparição limpa; sync incompleto não fecha; precedência (manual > bling > tiny > sheets, ordem alterada, fonte removida, vigente de uma fonte e quarentena da outra); `custosEfetivos` ignora linha com custo ≤ 0 mesmo se inserida por fora; gancho do `importarCustosSku` grava `manual` no histórico sem mudar o retorno; `limparPromocoesDoCliente` preserva custos e limpa `conflito_sku_mlb`/`mlb_dica`; isolamento entre dois clientes; reconciliação (as listas, `disponivel=false` sem `promo_anuncio`); pendências de frescor por fonte (ERP 3 dias, planilha 14); `impacto` conta SKU com aprovação |
| `teste-custos-webhook.mjs` (M2) | Express em porta efêmera de loopback com o roteador real + `express.json` global DEPOIS (prova que o corpo cru chega); assinatura válida → 200 e resumo; corpo alterado 1 byte → 401; ts −301 s / +301 s → 401; wid inexistente, inativo, sem cabeçalho → 401 **com corpo e status idênticos**; segredo rotacionado: antigo vale na janela de 24 h e depois não; `batch_id` repetido mesmo corpo → 200 `duplicate:true` sem reprocessar; corpo diferente → 409; 257 KB → 413; 1.001 itens → 422; JSON inválido autenticado → 400; rate limit por wid e por IP → 429 com `Retry-After`; 10 falhas de auth bloqueiam o IP; `mode=full` com lotes fora de ordem e faltando um lote (não fecha) e completo (fecha); resposta não contém segredo nem eco; log não contém corpo/segredo (capturar o logger injetado); `cliente` no corpo é ignorado; rejeição de linha não vira 4xx |
| `teste-custos-apps-script.mjs` (M3) | executa `Codigo.gs` gerado em `node:vm` com stubs de `UrlFetchApp`, `Utilities`, `SpreadsheetApp`, `PropertiesService`, `LockService`, `ScriptApp`; **teste de contrato:** a assinatura calculada pelo script (bytes com sinal → hex) é aceita por `verificarAssinaturaSheets` de M2; JSON só ASCII com acentos/emoji (roundtrip); retry 503 e erro de rede com corpo idêntico e carimbo novo; 400 sem retry; 3 lotes (500, 500, 204) com `batch_no/batch_total/sync_id`; rejeições locais (vazio, texto, `#N/A`, Date, Boolean, 0, negativo, SKU duplicado, MLB inválido); status por linha para `accepted/quarantined/rejected`; pulo por hash; batimento diário reenvia após 20 h; falha 401 não grava hash; `gerarScriptApps` rejeita URL sem https e segredo fora de `^[0-9a-f]{64}$`, e o texto gerado não contém aspas soltas |
| `teste-erp-bling.mjs` (M4) | HTTP fake com fixtures: paginação (2 páginas + vazia), `precoCusto` da raiz, fallback ao detalhe (`fornecedor.precoCusto`) com teto, sem fornecedor padrão → `custo:null` (nunca 0), pai `V` ignorado, variação com `variacao_de`, kit `E` com `componentes`, `enable-jwt: 1` em TODAS as chamadas (incluindo renovação), 429 `period=second` com espera e retry, `period=day` para, 401 renova uma vez, `invalid_grant` sem laço, `Authorization` nunca aparece em erro devolvido; parser do payload `product_supplier.updated` |
| `teste-erp-tiny.mjs` (M5) | listagem por `situacao=A` e `I` com `offset`; `campo_custo_tiny` nos dois valores, **sem fallback**, `dica` quando o outro campo tem valor; nulo e 0 → `custo:null`; `X-RateLimit-*`; kit `K` com `/kit`; pai `P` ignorado; 401 com mensagem de permissão; `invalid_grant` → `reautorizar` |
| `teste-erp-credenciais.mjs` (M6) | `cifrarSegredo` falha fechado sem chave; formato `v1.`; roundtrip; `decifrar` de texto adulterado lança; `state` assinado, expirado, reutilizado, de outro cliente → recusado; callback troca o `code` uma vez; refresh sob lock (duas chamadas concorrentes = 1 troca) e grava o refresh novo; `invalid_grant` → `reautorizar`; `sanitizar()` remove tokens; allowlist de hosts recusa host estranho; limitador respeita taxa e teto global; nenhuma função de listagem devolve coluna cifrada |
| `teste-erp-sync.mjs` (M7) | varredura completa com fake → `aplicarLote` + `fecharSyncCompleto`; falha no meio não fecha nem atualiza `ultimo_sync_ok_em`; SKU duplicado entre páginas; kit com todos os componentes (soma), com componente sem custo (pendente), divergência >1% (quarentena); tick: não repete no mesmo dia, retenta falha até 3×, não roda com plano `executando`, recupera às 03h+ após desligamento; fila coalescida e com backoff; lock por conta; "sincronizar agora" 409 se rodando |
| `teste-custos-rotas.mjs` (M8) | cada rota com entrada lixo (`''`, `null`, `[]`, parâmetro repetido, cliente sem conta ML) → 400/404 sem stack; `gerar` devolve segredo uma vez e `GET /resumo` nunca o mostra; `Cache-Control: no-store`; credenciais não são ecoadas; decisão de quarentena em lote |
| `teste-custos-integracao.mjs` (M10) | fluxo completo: webhook assinado → custo vigente → `analisar()` das promoções usa o custo (MC calculada em vez de SEM CUSTO); manual vence ERP; custo 0 do ERP continua SEM CUSTO; troca de conta ML preserva custos; `ROTA_PUBLICA` ancorado; `/api/custos/*` barrado pelo túnel; pendências aparecem em `/api/promocoes/resumo` |

**Obrigatório em todos:** nunca imprimir segredo/token; fixtures sem dado real de cliente.

---

## 13. DECISÕES DO DONO (com PADRÃO recomendado; a construção avança com os padrões)

| # | Decisão | Padrão recomendado | Por quê |
|---|---|---|---|
| 1 | **Campo de custo do ERP**: custo de compra/último custo vs custo médio | `preco_custo` nos dois ERPs (Bling: `precoCusto` do fornecedor padrão, único disponível via API; Tiny: `precoCusto`). `custo_medio` (só Tiny) é opt-in por cliente. **Sem fallback entre campos.** | Mesma definição nos dois ERPs; custo médio não existe na API do Bling. O dono pode preferir o médio no Tiny (relatório do Tiny sugeria o médio, mas é opinião, não fato) |
| 2 | **Precedência** | `manual > bling > tiny > sheets`, configurável por cliente; fonte fora da lista não é consumida | O ajuste do dono sempre vence; ERP é o sistema de registro; planilha é a mais frágil |
| 3 | **Limiar de quarentena** | Variação > 50% sobre o vigente da mesma fonte; custo ≥ preço cheio do anúncio ligado | Pega ponto decimal errado e custo trocado sem travar variação normal de compra |
| 4 | **Quais clientes usam qual fonte** | Nenhum conectado de início. Piloto: 1 cliente com planilha (valida F1), 1 com Bling e 1 com Tiny (valida F2), idealmente os que já têm `promo_anuncio` com SKU. Bling público: até 10 clientes antes da homologação | Dado real em pequena escala antes dos 127; Bling limita 10 usuários sem homologação |
| 5 | **Modelo de app Bling** | App PÚBLICO da Place2u (um `client_id/secret`, uma autorização por cliente), iniciar a homologação já. Alternativa: um app privado por cliente (sem homologação, mas cada cliente cria o app e entrega as chaves) | Menos atrito de onboarding; o código suporta os dois (`modo_app`) |
| 6 | **Frequência / gatilho** | Planilha: a cada 10 min se mudou + batimento diário + botão. ERP: varredura diária a partir das 03:00 + "sincronizar agora". Webhook do Bling: desligado (`PS_BLING_WEBHOOK=0`) até o piloto confirmar o HMAC e que edição de custo dispara evento | Webhook do Bling tem pontos NÃO CONFIRMADOS e perde evento; a varredura é a garantia |
| 7 | **Frescor ("custo velho")** | 3 dias para ERP, 14 dias para planilha | ERP é diário; planilha de cliente é manual |
| 8 | **Kits** | Soma dos componentes só se a fonte entrega a estrutura; sem estrutura = pendente; divergência > 1% do custo próprio = quarentena | Não inventa custo de kit |
| 9 | **Zero intencional (brinde)** | Rejeitado | Custo 0 vira MC inflada; se existir brinde, criar confirmação explícita depois |
| 10 | **CMV% derivado para o plano da conta** (F3) | DESLIGADO. Quando ligar: só com cobertura ≥ 80% da receita, rotulado "derivado do ERP", NUNCA usado no fallback percentual das promoções (função própria só no plano da conta) | Extrapola para SKUs sem custo; o dono decide se aceita |
| 11 | **Histórico** | Guardar toda mudança por 24 meses | Margem histórica e auditoria |
| 12 | **Quem opera a autorização no cliente** | O cliente faz login e autoriza; o consultor Place2u acompanha por chamada; o dono/cliente digita `client_id/secret` na tela do sistema (o assistente nunca recebe credencial) | Regra do projeto: sem senha de ERP |
| 13 | **Segredo `ERP_TOKEN_KEY`** | Gerar (`openssl rand -hex 32`) ANTES de conectar o 1º ERP e guardar backup | Sem chave, o sistema recusa; perdê-la obriga a reconectar |
| 14 | **Anúncios sem SKU (42% nos coletados)** — **RESOLVIDA em 07/10/2026** | Vínculo **manual** MLB → SKU de custo pela equipe (aba Custos de Promoções; `custo_vinculo`, com `por` e auditoria) + **SKU normalizado** de chave única + **herança por grupo** (`user_product_id`), nessa precedência abaixo do manual e do SKU exato (§5.1). Semelhança de nome só sugere candidatos; "Não é este" grava `recusado` e o candidato não volta. O consumidor (promoções, coleta de tarifa, diagnóstico, Ofertas) usa a mesma resolução | Pedido do David (07/10): "custo do SKU ligado ao anúncio e às promoções, automático pelo SKU ou manual escolhendo o item". Nenhum casamento por adivinhação: o automático é declarado (origem na tela) e o resto é humano |
| 15 | **Escopos Bling** | Só leitura: Produtos, dados básicos da empresa (+ `product_supplier` se usar webhook); fixar a lista antes do 1º cliente autorizar | Alterar escopo revoga todos |
| 16 | **Homologação Olist (Tiny)** | Enviar a pergunta a `erp.partners@olist.com` antes de escalar além do piloto | NÃO CONFIRMADO se a Place2u lendo vários clientes exige homologação |

---

## 14. Validação: o que NÃO foi validado e como validar

**Não validado contra API real (tudo abaixo roda só com fixtures até o piloto):** toda a API do Bling e do Tiny (formatos de listagem, detalhe, kit, variação, paginação, limites, cabeçalhos, 429); OAuth real dos dois (fluxo, `state`, rotação do refresh); HMAC do webhook do Bling sobre o corpo cru; Apps Script no ambiente Google real (autorização, UrlFetch, tipos de `getValues`); Cloudflare/WAF diante do User-Agent do Apps Script.

### 14.1 Checklist de 10 minutos do dono (Fase 1, sem ERP)
1. Defina `ERP_TOKEN_KEY` no `.env` e confira `PUBLIC_BASE_URL`; reinicie o painel.
2. Integrações → cartão do cliente-teste → **Planilha → Gerar webhook**. Copie o Apps Script (o segredo aparece uma vez).
3. Crie uma planilha com a aba `Custos` (A em "Texto simples"): 5 linhas — 3 SKUs válidos (um deles de anúncio real do cliente), 1 com custo `0`, 1 com texto "abc". Cole o script, rode `instalar`, autorize, **apague a função `instalar`**.
4. Menu **Custos → Sincronizar agora**. Esperado: coluna Status "OK" nos 3 válidos; "REJEITADO: custo deve ser > 0" e "REJEITADO: custo não numérico"; aba `Sync_Log` com 1 lote.
5. No painel, aba Custos de Promoções: os 3 SKUs aparecem com Fonte "sheets", campo "sheets.coluna_custo" e frescor "agora". Rode a análise do cliente: o anúncio com esse SKU passa de SEM CUSTO a ter MC.
6. Sincronize de novo sem mexer: Status continua OK e o painel mostra "inalterado" (nada novo no histórico).
7. Mude um custo para +80%: Status "EM ANÁLISE"; o valor antigo continua valendo; aprove no painel e veja o histórico.
8. Tente `curl` na URL sem assinatura: resposta 401 vazia de informação. Rotacione o segredo e confirme que o script antigo ainda funciona por 24 h.

### 14.2 Checklist do piloto de ERP (por ERP, com conta cooperante; resolve os NÃO CONFIRMADO)
**Bling (conta de 1 cliente, app com escopo só leitura):**
- Em 5 SKUs, comparar `precoCusto` da listagem, do detalhe e da tela do Bling (incluir 1 sem fornecedor padrão, 1 variação, 1 kit). Decide se o detalhe é necessário e onde o campo mora.
- Contar a listagem com e sem `criterio=5` e com os filtros de saldo contra a tela de Produtos (SKUs zerados e excluídos). Decide os parâmetros padrão da varredura.
- Editar custo na tela, por entrada de nota e por planilha, e ver se chega `product_supplier.updated`. Decide se o gatilho vale a pena.
- Conferir o HMAC sobre o corpo cru num evento real.
- Ler `expires_in` do JWT e ver se o `refresh_token` muda a cada renovação.
- Confirmar o escopo de `GET /produtos/fornecedores` e perguntar ao suporte se existe custo médio na API.
**Tiny (conta de 1 cliente, plano Construa+, permissão Leitura em Produtos):**
- `limit` máximo, padrão de `situacao`, variações na listagem (com custo?), se mudança só de custo muda `dataAlteracao`, código HTTP ao estourar o limite, rotação do refresh, custo do kit calculado, se o `state` volta no callback, se `sku` é único.
- Enviar a pergunta de homologação à Olist.

---

## 15. Riscos

| # | Risco | Mitigação / quem decide |
|---|---|---|
| 1 | Cobertura baixa: 42% dos anúncios coletados sem SKU; `promo_anuncio` só em 3 de 22 clientes; reconciliação depende dele | Listas mostram o que falta; M12 (`sku` em `meli_item`) e a coleta de promoções por cliente aumentam a cobertura; dono decide se a coleta de promoções entra no timer diário |
| 2 | Fatos NÃO CONFIRMADOS do Bling (custo na listagem vs detalhe, filtro de saldo, HMAC cru, evento ao editar custo, escopo do fornecedor) | Conector tolerante aos dois formatos, parâmetros configuráveis, webhook atrás de flag, varredura diária obrigatória |
| 3 | Tiny sem webhook de custo; refresh de 1 dia (parou 24 h = novo consentimento); plano Construa+ e extensão exigidos; homologação incerta | Pull + keepalive; estado `reautorizar` visível; só clientes elegíveis; pergunta à Olist |
| 4 | Bling público limita 10 usuários antes da homologação; mudar escopo revoga todos | Piloto ≤ 10; fixar escopos antes; ou modo `proprio` |
| 5 | Segredo do Apps Script legível por qualquer editor da planilha | Segredo por cliente com escopo mínimo, rotação com janela de 24 h, guia manda poucos editores e webhook novo a cada cópia |
| 6 | Definições de custo diferentes (impostos recuperáveis, rateios) mudam a MC | Campo e proveniência visíveis; decisão 1 do dono |
| 7 | Custo que muda revoga aprovações de promoção (comportamento existente) | `impacto` no resumo e auditoria; selo de entrada já protege a rodada |
| 8 | Limites compartilhados com outros apps do cliente (por conta) e bloqueio de IP do Bling com 127 contas num IP | Limitador por conta + teto global; concorrência 2–4; renovações escalonadas |
| 9 | Exposição pública do endpoint (WAF pode barrar User-Agent do Apps Script) | HMAC + limites; regra WAF opcional no Cloudflare só para o caminho; testar no piloto |
| 10 | Máquina local desligada às 03:00; processo único; limitadores em memória | Tick recupera depois das 03:00; webhook idempotente; reinício aceitável |
| 11 | Falso positivo de `custo_ge_preco` (kits, variações com preço diferente) | Vai para revisão (quarentena), não para rejeição |
| 12 | Variação: o anúncio resolve o SKU da primeira variação (pré-existente); custo por variação não é suportado | Documentado; reconciliação sinaliza SKUs de variação do ERP (`variacao_de`) |
| 13 | Perda de `ERP_TOKEN_KEY` | Backup; sem chave, falha fechado |
| 14 | Custo velho continua valendo | Pendência por fonte; limite duro opcional não implementado (YAGNI) |

---

## 16. Achados fora do escopo (não bloqueiam; vale corrigir à parte)

1. `src/lib/db.js:49-52` executa `PRAGMA` e `ALTER` em `acoes_plano` e `clientes_central` ANTES do `CREATE` delas (`:134`, `:194`): em banco novo o servidor quebra com `no such table: acoes_plano`. Novos ALTER (F3, M12) devem ficar depois dos CREATE.
2. `WEBHOOK_SECRET` está em `env.js:22` e `.env.example` e nunca é usado: `/webhook/notion` aceita qualquer POST da internet e dispara sync; `/webhook/meli` só filtra `application_id`. O webhook novo não herda isso.
3. `ROTA_PUBLICA` atual não tem âncora de fim (`/webhook/meliXYZ` passa).
4. `meli-link.js:42` compara assinatura com `!==` (não é tempo constante). O ERP usa `timingSafeEqual`.
5. `render-plano-conta.js:112` diz "calculado por anúncio", o que não é verdade hoje (usa percentuais da conta inteira).
6. `docs/promocoes-por-cliente.md` (linhas 17, 40, 104, 113, 118, 123, 167), `README.md:352`, `docs/metodologia-algoritmo.md:40-41`, `plano-cliente.js:308,310` e `render-plano-cliente.js:42,170,179` citam "ERP/Bling" como dado faltante e precisam apontar para esta integração (M10 atualiza os docs; o resto é cosmético).
7. O texto da tela `cliente.js:449` só mostra o formulário de percentuais enquanto os custos não foram informados; depois não há como editar pela tela.

---

## Fontes (todas consultadas na pesquisa de 05/10/2026; revalidadas nesta fase: listagem do Tiny e webhooks do Bling)

- Bling: https://developer.bling.com.br/aplicativos · /migracao-jwt · /webhooks · /limites · /erros-comuns · /boas-praticas · /perguntas-frequentes · /homologacao · /referencia · https://github.com/tempont/bling-erp-api-python/blob/HEAD/specs/bling-openapi-reference.json · https://developer.bling.com.br/bling-api · https://community.e-com.plus/t/api-v3-bling-nao-funcionando/6840
- Tiny/Olist: https://api-docs.erp.olist.com/llms.txt · /documentacao/comecando/autenticacao.md · /limites-de-consulta.md · /criando-um-aplicativo.md · /documentacao/webhooks/webhooks.md · /api-reference/produtos/listar-produtos.md · /obter-produto.md · /obter-produto-kit.md · /listar-custos-do-produto.md · https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao · https://ajuda.olist.com/precificacao/formacao-de-precos · https://tiny.com.br/api-docs/api
- Google: https://developers.google.com/apps-script/guides/services/quotas · /guides/triggers · /guides/triggers/installable · /reference/utilities/utilities · /reference/url-fetch/url-fetch-app · /guides/collaborating · /reference/lock/lock-service
- Código lido nesta fase (somente leitura): `src/lib/guarda-local.js`, `src/lib/cripto.js`, `src/lib/promocoes-db.js`, `src/lib/promocoes-mc.js`, `src/lib/meli-contas.js`, `src/server.js`, `src/rotas-promocoes.js` (custos e pendências), `src/lib/promocoes-analista.js`, `src/lib/promocoes-coleta.js`, `src/lib/diagnostico-conta.js`.
