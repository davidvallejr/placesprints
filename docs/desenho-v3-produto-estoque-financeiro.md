# V3 do Place Sprints — produto, estoque compartilhado, financeiro por pedido e duplicação ciente do estoque

**Data:** 14/10/2026. **Estado:** desenho final para decisão. Nada foi implementado.

**Pedido do David (14/10):** «Na verdade eu quero a API, a integração, a lógica do sistema [UpSeller] pra implementar no meu!» Ou seja, implementar no Place Sprints:
1. absorver a dinâmica dos anúncios;
2. dados financeiros;
3. duplicações sem atrapalhar o estoque: 2, 3, 5 ou 10 anúncios do mesmo produto descontando o mesmo estoque.

**Decisão de base:** construir nativamente sobre a API do Mercado Livre, que é a mesma fonte do UpSeller. A API do UpSeller (`openapi.upseller.com`, estoque por armazém/SKU) entra só como adaptador opcional de LEITURA de estoque, para cliente que já usa esse ERP.

**De onde vem este desenho:**
- Partiu do vencedor dos dois juízes, o Ângulo A («mínimo diff dentro do Algoritmo»).
- Absorveu os enxertos do Ângulo B: leitura da integração, estoque por local, fase em sombra, kit com modo e reversão de estoque correta.
- Absorveu os enxertos do Ângulo C: dinheiro em centavos, cancelamentos, lucro com cobertura, chaves desligadas e a regra `sku_ausente`.
- Corrige as falhas que os juízes apontaram no vencedor: formato do `/items/bulk`, Full + Flex, cobertura no espelho, reversão ao snapshot e `seller_custom_field` agrupando.

**Insumos** (evidências no scratchpad da sessão de 14/10, que é temporário):
- `mapa-place-sprints.md`: o sistema hoje;
- `pesquisa-upseller.md`: como o UpSeller faz;
- `api-ml-verificada.md`: 12 GETs reais no Uniaodog e docs do ML.

Os números do banco foram reconferidos por consulta `-readonly` em 14/10.

## Princípios que valem para tudo abaixo

1. **Um motor só.** O caminho continua: coleta → `diagnostico-conta` → regras (`config/algoritmo.json` + `plano-anuncios.js`) → `acoes_plano`/Notion (dry-run) → medição → fator.
   - O grafo de produto e o financeiro são funções puras chamadas dentro de `carregarBase`.
   - Telas, textos e avisos são projeções.
   - Regra nova entra em `config/algoritmo.json` com prior, teto e prova.
2. **Quem desconta estoque é o Mercado Livre.** Anúncios do mesmo `user_product_id` (UP) já vendem do mesmo estoque, e o ML replica o número entre eles.
   - A V3 conta certo: estoque uma vez, demanda somada.
   - A V3 detecta e cobra quando o vendedor tem o mesmo produto em estoques separados.
   - A V3 não vira sincronizador em tempo real.
3. **Ausente = null, nunca zero.** Chave não lida = `NOT_COLLECTED`. Frete não lido = lucro `null`. Estoque ambíguo = `null`. Toda heurística é PREMISSA rotulada no texto. Nunca «causa confirmada».
4. **Sombra antes de mudar número ao cliente.** O diagnóstico por produto nasce desligado (`produto.diagnostico_ligado = false`).
   - Primeiro ele calcula e mostra «por anúncio × por produto».
   - O consultor confere 3 clientes, e só então liga.
   - Toda regra nova e toda mudança de prioridade nascem atrás de uma chave desligada, com o teste «plano idêntico com a chave desligada».
5. **Escrita no ML só pelo Chaveiro**, com lista fechada + `confirmar === true` + snapshot, conferência e reversão. Escrita de ESTOQUE só na F6, e só se o David revogar a decisão registrada «Estoque nunca é escrito» (`docs/desenho-causalidade-executor.md:16`).
6. **Isolamento por cliente** em toda consulta. Prospect `[Comercial]` fora. SQL parametrizado com lista fechada de colunas. Erro nunca ecoa o valor recebido. Notion em dry-run. UI: 1 primário por tela, tabelas com até 6 colunas, cor só por token em `ui.css`.

## Vocabulário

| Termo | O que é | Chave |
|---|---|---|
| Anúncio | Item do ML (`MLB…`), ou uma variação dele | `item_id` [+ `variacao_id`] |
| UP | `user_product_id` do ML: o produto por trás do anúncio. Título, fotos, atributos e `available_quantity` são do UP e se replicam entre os anúncios dele (doc User Products) | `MLBU…` |
| Pool | Estoque que o ML desconta = UP × local (`proprio` = depósito/Flex do vendedor; `full` = `meli_facility`) | `up:MLBU…\|full` |
| **Produto** | A unidade de compra = o «SKU do armazém» do UpSeller (cada tamanho ou cor é um produto). Junta 1..N pools | `sku:…` \| `cat:…` \| `up:…` \| `item:…` |
| **Estoque físico de referência (EF)** | O estoque que de fato limita a venda de um anúncio. Cada pool Full é um EF. Os pools próprios do mesmo produto são 1 EF (espelho ou declarado) ou N EFs (dividido) | `ef:<produto>\|<pool ou 'proprio'>` |
| Representante | O anúncio de maior receita em 28 dias do EF (no empate, o menor `item_id`). Só ele «fala de estoque» em ação, aviso e texto | predicado único `representaEstoque(i)` |

O grafo é **Produto (SKU) → Anúncio/variação → Pool (UP × local) → EF**. A família de cores e tamanhos (`family_id` do ML) fica só como agrupamento de exibição, sem conta; ponytail: entra na tela quando alguém pedir.

---

## 0. A lógica do UpSeller em uma página

**Como o UpSeller funciona** (central de ajuda deles, jul–set/2026):
- O **Anúncio** é diferente do **Produto do Armazém**. Vários anúncios, de lojas e canais diferentes, apontam para 1 SKU do armazém (N:1). O mapeamento automático usa SKU igual, sem diferenciar maiúsculas. O manual é «Mapear SKU». Há sugestões em «Detectar mapeamento».
- Os pedidos de todas as lojas deduzem o mesmo estoque do armazém, numa etapa escolhida (criação do pedido ou NF-e).
- Um motor de sincronização em **uma direção** (UpSeller → loja) empurra a «quantidade disponível» para todo anúncio mapeado. Ele dispara a cada entrada, saída, reserva e liberação. Tem regras de estoque de segurança, máximo, mínimo, faixas com fórmula e «não sincronizar».
- **Kit** é composição (componentes × quantidade). O estoque do kit é calculado e a dedução é nos componentes. Anúncio de kit NÃO vira composição sozinho: é manual.
- O **Full fica fora** da dedução e da sincronização. A recomendação é dar saída manual ao mandar mercadoria para o Full.
- **Estoque baixo** = tempo de preparo × vendas/dia. **Sugestão de compra** = estoque + histórico + ciclo.
- **Lucro por pedido e por loja** = receita − taxas − custo (custo médio do armazém), calculado em D-1. Não existe lucro por SKU nem por anúncio, não há DRE e não há gestão de Ads.
- A API/MCP só cobre estoque (leitura) e só nos planos Profissional+.

### O que copiamos, e como fica aqui

| Mecanismo do UpSeller | Na V3 | Por quê |
|---|---|---|
| Anúncio ≠ Produto, N:1 | Grafo derivado da coleta: UP > `inventory_id` > SELLER_SKU normalizado > catálogo, com vínculo manual e recusa | O ML já entrega a identidade mais forte (UP) em 40/40 ativos da amostra. O UpSeller precisa de mapeamento manual; nós não |
| «Detectar mapeamento» (sugestões) | Gaveta «Gerenciar mapeamento»: `seller_custom_field` igual, título parecido (IDF ≥ 0,65), «Kit N» → componente provável | Sugestão nunca junta sozinha |
| Pedidos de todos os anúncios deduzem o mesmo estoque | Velocidade do EF = Σ vendas dos anúncios dele (+ kits × quantidade). A dedução continua sendo do ML | Contar certo, sem segundo razão de estoque |
| Estoque baixo = preparo × vendas/dia | Já é o ponto de reposição da v1.6.0, agora por EF | Mesma fórmula, base certa |
| Sugestão de compra | `preverCompras`: 1 linha por produto, estoque contado uma vez | Acaba com 85.703 un «vistas» contra 28.410 reais nos SKUs repetidos |
| Kit = composição | Kit Virtual do ML (`bundle.components`) automático; kit clássico só declarado, com MODO obrigatório | O ML só tem composição formal no Kit Virtual |
| Full fora da dedução | Pool Full é um EF próprio, só leitura, nunca escrito. A «saída manual para o Full» deles vira a causa `enviar_full` («envie X do seu estoque») | Full não aceita escrita por API |
| Estoque de segurança e máximo | Só na F6 (escrita), em unidades, sobre o físico declarado | Segurança no PONTO DE PEDIDO já existe (dias) |
| Lucro por pedido | Lucro por pedido, por anúncio, por produto e pós-Ads, com cobertura declarada | Vai além: é a lacuna documentada deles |
| Catálogo + comum com estoque compartilhado | Mesmo UP = mesmo pool (5 grupos reais; 253 de 254 grupos ativos com estoque idêntico) | — |

### O que NÃO copiamos, e por quê

| Mecanismo | Por que não |
|---|---|
| Motor de sincronização em tempo real (gatilho por movimento, limite diário de syncs) | É função de ERP: exige razão de estoque, webhook e fila, e transfere ao sistema a responsabilidade por venda sem estoque. Sem razão de estoque, sincronizar a partir de um pool do ML vende a mais por construção (exemplo na § 7). Nós detectamos, cobramos e, na F6 e só com físico declarado, alocamos |
| Quantidade mínima e faixas com fórmula | O próprio UpSeller avisa: «mínimo 2 com estoque real 0, a loja recebe 2». É venda sem estoque por desenho |
| Estoque de segurança que ZERA o anúncio | A pausa derruba relevância e vira confundidor do Merovíngio. Aqui a segurança é em dias, no ponto de pedido |
| Custo médio do armazém | Não vemos as entradas de estoque. Vale o custo informado (manual, ERP ou planilha), com vigência e fonte |
| ERP, NF-e, etiqueta, SAC, picking, gestão financeira por lançamento manual | Commodity gratuita, fora do espaço da assessoria (diagnóstico → plano → execução → medição) |
| Copiador de anúncios de terceiros, migração e duplicação em massa | Duplicar sem objetivo é anti-padrão do método (`config/duplicacao.json`) e risco de política |
| Simulador que chama markup de margem | O exemplo deles («margem 20%») dá 11,5% sobre a venda. Aqui margem = lucro ÷ receita, sempre |
| Inferir produto ou kit por título como verdade | Só sugestão, confirmada por humano |

---

## 1. Modelo de dados (DDL)

Tudo é aditivo e idempotente (`CREATE … IF NOT EXISTS` e o laço `PRAGMA table_info` que `db.js` já usa).
- O DDL das tabelas de coleta vai num `SCHEMA_PRODUTO`, exportado por `src/lib/produto-estoque.js`, que é puro.
- `db.js` o executa ao lado de `SCHEMA_SAUDE`/`SCHEMA_LEAD_TIME`.
- Toda PK começa por `cliente`.
- Dinheiro das tabelas novas em **centavos INTEGER** (sufixo `_c`).
- **Nenhuma tabela de «produto» é gravada:** o agrupamento é derivado na leitura. Só o que é DECLARADO por gente é gravado.

### 1.1 Aresta anúncio → UP (F1)

```sql
CREATE TABLE IF NOT EXISTS meli_anuncio_up (       -- 1 linha por anúncio sem variação, ou 1 por variação; gravada na MESMA transação de gravarItens
  cliente TEXT NOT NULL, item_id TEXT NOT NULL,
  variacao_id TEXT NOT NULL DEFAULT '',            -- '' = nível do anúncio
  user_product_id TEXT NOT NULL DEFAULT '',        -- MLBU…; '' = a API não trouxe (vira pool 'item:…', sem compartilhar com ninguém)
  inventory_id TEXT NOT NULL DEFAULT '',           -- só Full (por variação quando há variações)
  sku TEXT NOT NULL DEFAULT '',                    -- cru, como veio
  sku_fonte TEXT NOT NULL DEFAULT '' CHECK (sku_fonte IN ('','seller_sku','variacao','pedido','seller_custom_field')),
  catalogo_produto_id TEXT NOT NULL DEFAULT '',
  estoque INTEGER,                                 -- available_quantity do anúncio/variação; NULL = não lido
  logistica TEXT NOT NULL DEFAULT '',
  flex INTEGER NOT NULL DEFAULT 0 CHECK (flex IN (0,1)),   -- shipping.tags contém self_service_in
  tags TEXT NOT NULL DEFAULT '',                   -- só a lista fechada: bundle, kit_component, user_product_listing
  status TEXT NOT NULL DEFAULT '',
  lido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, item_id, variacao_id));
CREATE INDEX IF NOT EXISTS ix_anuncio_up_up  ON meli_anuncio_up (cliente, user_product_id);
CREATE INDEX IF NOT EXISTS ix_anuncio_up_inv ON meli_anuncio_up (cliente, inventory_id);
CREATE INDEX IF NOT EXISTS ix_anuncio_up_sku ON meli_anuncio_up (cliente, sku);
```

- A cada leitura de um anúncio, as linhas DELE são apagadas e regravadas. Anúncio que sai da listagem guarda as últimas linhas, e é isso que costura a história quando o ML migra o anúncio (UPtin: item novo, mesmo UP).
- Uma tabela só cobre item e variação. Não há colunas novas em `meli_item` nem tabela de variação separada.
- `sku_fonte = 'seller_custom_field'` nunca agrupa sozinho: a doc do ML diz que o campo é «uso interno, sem relação», e a amostra trouxe valores como «195».

### 1.2 Linha de pedido (F1; só gravação, zero chamada extra)

```sql
CREATE TABLE IF NOT EXISTS meli_pedido_item (      -- 1 linha por order_items[] de pedido pago; dia recoletado substitui (como meli_serie_item)
  cliente TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL, variacao_id TEXT NOT NULL DEFAULT '',
  dia TEXT NOT NULL,                               -- o MESMO recorte de meli_serie_item (date_created no fuso da coleta)
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unit_c INTEGER NOT NULL,                   -- unit_price em centavos
  tarifa_c INTEGER,                                -- order_items[].sale_fee como veio; NULL = não veio (nunca 0)
  tipo_anuncio TEXT NOT NULL DEFAULT '', seller_sku TEXT NOT NULL DEFAULT '',
  envio_id TEXT NOT NULL DEFAULT '', pack_id TEXT NOT NULL DEFAULT '',
  deposito_node TEXT NOT NULL DEFAULT '', deposito_store TEXT NOT NULL DEFAULT '',  -- order_items[].stock: de que depósito saiu
  cupom_c INTEGER, reembolso_c INTEGER,            -- payments[] rateados pela receita das linhas do pedido (Σ exato)
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','cancelled')),
  coletado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, order_id, item_id, variacao_id));
CREATE INDEX IF NOT EXISTS ix_pedido_item_dia   ON meli_pedido_item (cliente, dia);
CREATE INDEX IF NOT EXISTS ix_pedido_item_envio ON meli_pedido_item (cliente, envio_id);
CREATE INDEX IF NOT EXISTS ix_pedido_item_item  ON meli_pedido_item (cliente, item_id, dia);
-- coluna nova (laço PRAGMA de db.js): 1 = as linhas do dia foram gravadas; dia anterior à F1 = lucro «não coletado», nunca zero
--   ['meli_coleta_dia', 'linhas', 'INTEGER NOT NULL DEFAULT 0']
```

- A mesma linha repetida no pedido (mesmo item e variação) é somada por `linhasDoPedido`, que é pura.
- **Invariante, na mesma transação de `coletarPedidos`:** por anúncio e dia, Σ (`preco_unit_c` × `quantidade`) das linhas pagas = `round(meli_serie_item.receita × 100)`, com tolerância de 1 centavo por linha (arredondamento do `unit_price`). Também Σ `quantidade` = `unidades`.
- Linha marcada `cancelled` não é apagada pelo DELETE do dia.

### 1.3 Frete por envio (F4)

```sql
CREATE TABLE IF NOT EXISTS meli_envio_custo (      -- GET /shipments/{id}/costs; 1 envio = N pedidos (pacote)
  cliente TEXT NOT NULL, envio_id TEXT NOT NULL,
  custo_vendedor_c INTEGER,                        -- Σ senders[].cost; NULL = não lido (pendente diz por quê)
  desconto_c INTEGER,                              -- Σ senders[].discounts[].promoted_amount (informativo; ex.: mandatory 30%)
  logistica TEXT NOT NULL DEFAULT '',
  pendente TEXT NOT NULL DEFAULT '' CHECK (pendente IN ('','permissao_do_app','indisponivel','teto','sem_remetente')),
  lido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, envio_id));
```

### 1.4 Estoque por local do UP (F2)

```sql
CREATE TABLE IF NOT EXISTS meli_up_estoque (       -- GET /user-products/{id}/stock; só a última leitura (sem histórico: o change-log de meli_item já guarda estoque_zero)
  cliente TEXT NOT NULL, user_product_id TEXT NOT NULL,
  local TEXT NOT NULL CHECK (local IN ('proprio','full')),  -- seller_warehouse + selling_address → proprio; meli_facility → full
  quantidade INTEGER,                              -- NULL = falhou (nunca 0 por falha)
  lojas INTEGER,                                   -- nº de store_id distintos no próprio (multi-depósito)
  pendente TEXT NOT NULL DEFAULT '' CHECK (pendente IN ('','permissao_do_app','indisponivel','teto')),
  lido_em TEXT NOT NULL,
  PRIMARY KEY (cliente, user_product_id, local));
```

O `x-version` não é guardado: quem escreve (F6) relê na hora.

### 1.5 Decisão humana sobre o mapeamento (F2)

```sql
CREATE TABLE IF NOT EXISTS produto_vinculo (       -- só a EXCEÇÃO é gravada; o automático é recalculado a cada leitura
  cliente TEXT NOT NULL,
  origem TEXT NOT NULL,                            -- 'up:MLBU…' | 'item:MLB…[:var]'
  produto TEXT NOT NULL,                           -- 'sku:<norm>' | 'cat:MLB…' | 'up:MLBU…'
  tipo TEXT NOT NULL CHECK (tipo IN ('manual','recusado')),   -- manual: este pool É deste produto; recusado: nunca juntar automaticamente
  por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, origem, produto));
```

Por que não usar `of_anuncio` como vínculo:
- `of_variante.sku` é `NOT NULL UNIQUE`, e 28 clientes não têm SKU no sistema;
- o Ofertas copia `variante.sku` como SELLER_SKU ao publicar (`ofertas-ml.js:471`), então um SKU sintético vazaria para o ML;
- gravar 7.562 anúncios em `of_*` inundaria as listas do Ofertas.

### 1.6 Estoque físico declarado (F3), na tabela-mestre que já existe

```sql
ALTER TABLE of_variante ADD COLUMN estoque_fonte TEXT NOT NULL DEFAULT '';  -- lista fechada em código: cliente|equipe|upseller|bling|tiny
ALTER TABLE of_variante ADD COLUMN estoque_em TEXT NOT NULL DEFAULT '';     -- data da declaração/leitura; vencida (> 7 d) = ignorada com motivo
```

- `of_variante.estoque` já existe e ninguém lê. Vira o **estoque físico PRÓPRIO** (fora do Full) do SKU.
- O produto e a variante são criados sob demanda, pelas funções de `ofertas.js`, **só para um SELLER_SKU real lido do ML**, nunca sintético.
- Produto sem SKU não recebe declaração: a pendência pede antes o SKU (regra `sku_ausente`).

### 1.7 Composição de kit (F5)

```sql
CREATE TABLE IF NOT EXISTS kit_componente (
  cliente TEXT NOT NULL,
  kit TEXT NOT NULL,                               -- pool/anúncio do kit: 'up:…' | 'item:…'
  componente TEXT NOT NULL,                        -- produto componente: 'sku:…' | 'up:…'
  quantidade INTEGER NOT NULL CHECK (quantidade BETWEEN 1 AND 100),
  modo TEXT NOT NULL CHECK (modo IN ('kit_virtual','montado_na_hora','pre_montado')),
  fonte TEXT NOT NULL CHECK (fonte IN ('ml_bundle','declarado')),   -- ml_bundle é regravado pela coleta; declarado só por humano
  por TEXT NOT NULL DEFAULT '', em TEXT NOT NULL,
  PRIMARY KEY (cliente, kit, componente));
```

- **Sem modo não se grava.** O modo errado conta o estoque em dobro ou esconde a ruptura.
- A composição vale para frente e não reescreve medição passada.

### 1.8 Escrita de estoque (F6, só com decisão)

```sql
CREATE TABLE IF NOT EXISTS produto_regra_estoque (
  cliente TEXT NOT NULL, produto TEXT NOT NULL,     -- '*' = conta toda
  seguranca INTEGER CHECK (seguranca BETWEEN 0 AND 100000),             -- unidades retidas do físico
  maximo_por_anuncio INTEGER CHECK (maximo_por_anuncio BETWEEN 1 AND 100000),
  nao_escrever INTEGER NOT NULL DEFAULT 0 CHECK (nao_escrever IN (0,1)),
  por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, produto));
-- + exec_politica / exec_ordem / exec_evento exatamente como em docs/desenho-causalidade-executor.md §2, com 'ml_estoque' no CHECK de adaptador.
--   Hoje do Chaveiro só existe a classificação (chaveiro.js, config/chaveiro.json); exec_ordem não existe no código.
```

### 1.9 Configuração (`config/algoritmo.json` → v1.7.0)

```jsonc
"produto": {
  "diagnostico_ligado": false,            // F2 = sombra (calcula i.produto, não troca cobertura); a F3 liga, com decisão registrada
  "juntar_automatico": ["up", "inventory", "sku", "catalogo"],   // sku = só SELLER_SKU oficial; catalogo com trava de conflito
  "estoque_declarado_validade_dias": 7,
  "leitura_stock_validade_dias": 2,
  "stock_teto_por_coleta": 150,           // GET /user-products/{id}/stock por cliente/dia
  "$premissa_espelho": "2+ estoques próprios do mesmo produto com o mesmo número = o mesmo estoque físico espelhado (contado uma vez)",
  "$premissa_dividido": "números diferentes = estoque físico dividido entre os anúncios (soma)"
},
"financeiro": {
  "sale_fee_por_unidade": true,           // PREMISSA até conciliar (votos com listing_prices; depois billing CV)
  "conciliar_min_votos": 5, "conciliar_acordo_min": 0.9,
  "frete_teto_por_coleta": 300,
  "frete_rateio": "receita",
  "backfill_dias": 28,
  "cobertura_minima": 0.8,                // abaixo disso: «parcial (x%)», nunca número
  "margem_medida_nas_regras": false,      // F4 liga com o teste de plano idêntico
  "faixa_frete_gratis_brl": 79            // limite público do ML (premissa, conferir)
}
```

- As premissas entram em `premissas.limiares`.
- As regras novas (§ 4.4) entram em `regras[]` com `dados`, `kpi`, `tipo_demanda`, `prova` e prior, e `foco.max_por_regra` próprio.
- `config/chaveiro.json → caminho_por_regra` recebe as regras novas.

### 1.10 O que NÃO muda

- `meli_item`, `meli_serie_item` (continua sendo a série de vendas por anúncio e dia), `meli_full_estoque`, `lead_time_cliente`, `custo_vinculo`, `tarefa_item`, `promo_anuncio`.
- `promo_anuncio` deixa de ser a ÚNICA fonte de SKU e UP: hoje só 18 dos 46 clientes têm.
- `acoes_plano`: a entidade de produto vai em `dados_json.entidade = { tipo:'produto', id, itens[] }`, sem coluna nova.

---

## 2. Coleta (a integração)

Tudo nesta seção é **leitura**. A ordem no tick diário (`server.js` ~473) fica assim:

```
coletarCliente   → itens + CHAVES (F1) · pedidos + LINHAS (F1) · visitas · ads
coletarFretes    (F4) → marcarCancelados (F4) → lerEstoqueUps (F2)
capturarAcompanhamento → gerarPlanoConta → saúde (lê inventory_id de meli_anuncio_up)
```

- Cada etapa nova roda em `try/catch` próprio: falha de uma nunca derruba a coleta e nunca grava zero.
- A falha é classificada como em `saude-coleta.js` (`motivoDe`): 401/403 = `permissao_do_app`; 5xx/rede = `indisponivel`.

### 2.1 F0: troca do multiget (prazo duro: `/items?ids=` sai do ar em 25/10/2026)

Helper único em `meli-api.js`, ao lado de `detalhesItens`:
```js
export async function multiget(cliente, ids, attrs, { chamarFn = chamar } = {})  // → body[]
// GET /items/bulk?ids=<até 20>&attributes=body.id,body.<attr>…   (prefixo body. em cada campo)
// aceita (x.status_code ?? x.code) === 200   (doc: «code passa a se chamar status_code»)
// N ids pedidos e 0 corpos devolvidos → LANÇA erro (hoje gravaria 0 anúncios em silêncio e o plano sairia sobre o estoque de ontem)
```

Os **4** pontos que chamam o formato antigo hoje (conferido por grep):

| Ponto | Uso |
|---|---|
| `src/lib/meli-api.js:205` (`detalhesItens`, parse `x.code === 200` em :207) | coleta diária |
| `src/lib/saude-coleta.js:140` | `inventory_id` do Full. Na F1 deixa de fazer multiget próprio e lê de `meli_anuncio_up`, inclusive por variação (hoje perdidas em :142) |
| `src/lib/promocoes-coleta.js:178` | promoções |
| `src/lib/alerta-cliente-real.js:25` | reconferência ao vivo do alerta |

- **Antes de publicar:** 1 GET real só de leitura (token dentro do prazo, sem renovar) confirma `status_code`, o prefixo `body.` e se `bundle` vem no bulk.

### 2.2 F1: chaves do produto na mesma chamada (zero chamadas a mais)

- `attrs` de `detalhesItens` (`meli-api.js:203`) ganha `user_product_id, inventory_id, seller_custom_field, attributes, variations, tags` (`catalog_product_id` e `shipping` já vêm). O payload cresce (`attributes`); o número de chamadas não muda. O tempo da coleta é medido.
- `gravarItens` (`meli-serie.js:43`) chama `gravarAnuncioUp(cliente, bodies, { t })` na MESMA transação.
- `arestasDoAnuncio(body)` é pura e devolve 1 aresta por anúncio sem variação, ou 1 por variação (UP por variação: 65/65 na amostra; `inventory_id` por variação: 47/65).
- O SKU vem de `resolverSku`.
  - A função sai de `promocoes-coleta.js:66` para `produto-estoque.js` (pura); `promocoes-coleta` reexporta, sem import circular.
  - Precedência: `attributes.SELLER_SKU` > SELLER_SKU da variação > `seller_custom_field` (que fica só como sugestão).
  - A camada «SKU da venda» (`order_items.seller_sku`) entra pelas linhas de pedido.
- Efeito colateral bom:
  - o SKU que alimenta prazo de reposição e custo (`diagnostico-conta.js:108`, `custo-vinculo.js`, `server.js` `casaDe`) passa a existir para os 46 clientes;
  - `promo_anuncio` vira COALESCE.

### 2.3 F1: linhas de pedido (zero chamadas a mais)

- `coletarPedidos` (`meli-serie.js:87`) já itera `p.order_items` (:99) e hoje descarta quase tudo.
- `linhasDoPedido(p, dia)` (pura) gera as linhas de § 1.2, gravadas na mesma transação que zera e regrava o dia (:104-108): DELETE das linhas `paid` do dia + INSERT.
- Marca `meli_coleta_dia.linhas = 1`. Dia que falha não é marcado: lacuna declarada.
- **Backfill de 28 dias**, uma vez, só nos dias com `linhas = 0`. Re-busca só os pedidos, não visitas nem Ads. Respeita o teto de 1.000 pedidos/dia que já existe (`meli-serie.js` ~78; dia truncado = financeiro «parcial»).

### 2.4 F2: estoque por local (`GET /user-products/{id}/stock`)

`lerEstoqueUps(cliente, { teto })` lê só os UPs em que o `available_quantity` do anúncio é ambíguo:
- UP com anúncio Full e (irmão com `flex = 1` ou irmãos em 2+ logísticas), com venda em 28 dias, em ordem de receita;
- mais o pedido explícito da tela («Atualizar estoque», só os produtos visíveis, com teto).

Como lê:
- `locations[]` → `meli_up_estoque`;
- várias `store_id` no próprio somam, e `lojas` registra quantas.

Teto e ritmo:
- teto `produto.stock_teto_por_coleta` = 150 por cliente/dia;
- base: 288 anúncios Full ativos em 12 clientes, logo ~300 UPs/dia no pior caso;
- ritmo de ≤ 1 chamada/s nessa rota, porque o rate limit de user-products (~100 RPM, só WebSearch) é NOT_VERIFIED.

O `/users/{id}` que a coleta já lê guarda só as tags `user_product_seller` e `warehouse_management` (multiorigem). Só a tela e a F6 usam.

### 2.5 F4: frete, cancelamentos e tarifa de tabela

**`coletarFretes(cliente, { teto })`:**
- lê `GET /shipments/{id}/costs` de cada `envio_id` das linhas dos últimos 28 dias sem linha em `meli_envio_custo` (ou com `pendente` há ≥ 3 dias), do mais recente para o mais antigo;
- grava `Σ senders[].cost` (real: 8,15 com desconto `mandatory` de 30%);
- 1 envio de pacote = 1 chamada para N pedidos;
- teto de 300 por cliente por coleta;
- o que passa do teto fica `pendente:'teto'` e é lido no dia seguinte.

**`marcarCancelados(cliente, { dias: 30 })`:**
- 1–2 chamadas por cliente/dia: `/orders/search?order.status=cancelled&order.date_last_updated.from=`;
- faz `UPDATE status='cancelled'` por `order_id`;
- se essa busca devolve tudo é NOT_VERIFIED (a frase da doc é ambígua). Até verificar, «cancelamentos» sai como **parcial**.

**`listing_prices`:**
- `GET /sites/MLB/listing_prices?price&category_id&listing_type_id&logistic_type`, com cache por (categoria × tipo × faixa de preço × logística);
- usado em 2 lugares: para votar a semântica do `sale_fee` (§ 5.2) e para SIMULAR preço (`economiaReal`, Ofertas, promoções);
- nunca para o realizado.

### 2.6 F5: kits

- Anúncio com tag `bundle` → `bundle.components[{user_product_id, quantity}]` (pelo bulk, se aceitar o atributo; senão 1 `GET /items/{id}` por kit, que são raros) → `kit_componente` (`kit_virtual`, `ml_bundle`).
- A tag `kit_component` nos componentes já vem desde a F1.

### 2.7 F3: conta com 1.000+ anúncios

- A listagem é cortada (`meli-serie.js:21-31`, `aviso_teto`), e irmãos podem ficar de fora: declarado em `data_quality`.
- Completar pelos UPs da curva A: `GET /users/{id}/items/search?user_product_id=A,B` (doc), com teto.

### 2.8 Orçamento de chamadas (base inteira: ~344–356 pedidos/dia)

| Etapa | Chamadas a mais por dia | Fase |
|---|---|---|
| Multiget com chaves | 0 (payload maior) | F0/F1 |
| Linhas de pedido | 0; backfill único de 28 d só de pedidos | F1 |
| `/user-products/{id}/stock` | ≤ 150 por cliente; ~300 na base | F2 |
| Fretes | ≈ 1 por envio novo (< 360 na base); backfill de 28 d ≈ 9,6 mil diluído pelo teto | F4 |
| Cancelados | 1–2 por cliente | F4 |
| `listing_prices` | dezenas, com cache | F4 |
| `bundle` | só anúncios kit virtual | F5 |
| `items/search?user_product_id` | só conta truncada, curva A, com teto | F3 |

As pausas e o retry de `chamar()` ficam como estão.

### 2.9 «Absorver a dinâmica dos anúncios»: sem código especial

A leitura diária absorve sozinha, no dia seguinte:
- duplicata nova (mesmo UP ou mesmo SKU);
- opt-in em catálogo (mesmo UP);
- migração UPtin (item novo, mesmo UP; a aresta antiga é preservada);
- entrada e saída do Full (a logística muda, então o local muda; o change-log já registra `logistica`);
- pausa por falta de estoque (change-log `estoque_zero`).

O UpSeller precisa de «Detectar mapeamento» para isso; aqui a chave vem do ML.

---

## 3. O grafo: produto → anúncio → estoque por local

`src/lib/produto-estoque.js` (NOVO, PURO, sem import de banco, no molde de `compras-previsao.js`):

```js
export const SCHEMA_PRODUTO = `…`                                   // § 1
export const chaveSku = s => String(s ?? '').normalize('NFC').trim().toLowerCase()   // regra do UpSeller (sem caixa); NÃO skuForte (tira hífen: juntaria KIT-2 com KIT2)
export function arestasDoAnuncio(body) → aresta[]                   // § 2.2
export function resolverSku(item, userProduct = null) → { sku, fonte }   // movida de promocoes-coleta.js
export function montarGrafo({ arestas, vinculos, kits, upEstoque, fullEstoque, declarado, hojeISO, P }) → { pools, produtos, sugestoes, avisos }
export function aplicarProduto(lista, grafo, { vendas, linhas, L, leadDe, ligado }) // anota i.produto; com ligado troca cobertura/ponto (§ 4)
export function alocarEstoque(total, pools, { minimo = 1 } = {}) → [{ chave, quantidade }]   // § 6/§ 7
export const coberturaProjetada = (E, v, extra) => E != null && v + extra > 0 ? Math.round(E / (v + extra)) : null
```

O `produto-estoque-real.js` só lê o banco (`grafoDoCliente(cliente)`) e chama o puro.

### 3.1 Passo 1: cada aresta cai num pool

| A aresta tem… | Pool |
|---|---|
| `user_product_id` | `up:<UP>\|<local>` |
| só `inventory_id` | `inv:<inventory_id>\|full` |
| nada | `item:<MLB>[:var]\|<local>` (comportamento de hoje, declarado «chave não lida») |

**Local:**
- `logistica = fulfillment` → `full`; senão `proprio`.
- Anúncio Full com `flex = 1` participa dos dois pools do mesmo UP.
- A **venda** é atribuída ao local pelo depósito da linha de pedido (`deposito_store`/`deposito_node` = `store_id`/`network_node_id` do `seller_warehouse` lido em `/stock`, então `proprio`; senão a logística do anúncio).
- O formato do `node_id` de venda saída do Full é NOT_VERIFIED. Fallback: logística do anúncio, declarado.

### 3.2 Passo 2: pools se juntam em produtos (mapeamento automático)

Componentes conexos (union-find) com estas ligações, nesta precedência:

1. **Mesmo UP:** sempre. É o estoque que o ML compartilha.
2. **Mesmo `inventory_id`:** sempre. É o mesmo estoque Full.
3. **Mesmo SELLER_SKU normalizado** (`chaveSku`, só `sku_fonte` oficial: `seller_sku`, `variacao` ou `pedido`).
4. **Mesmo `catalog_product_id`.**
5. **Vínculo manual** (`produto_vinculo.tipo = 'manual'`) vence tudo e move o pool para o produto indicado.
6. **Recusa** (`tipo = 'recusado'`) corta a ligação automática daquele par.

**Trava de conflito:** as ligações 3 e 4 só valem se a outra identidade forte não contradisser.
- Dois pools com SKUs oficiais DIFERENTES não se juntam pelo catálogo.
- Dois pools com `catalog_product_id` diferentes (ambos preenchidos) não se juntam pelo SKU.
- O par vira sugestão com o motivo («mesmo catálogo, SKUs diferentes»).
- É o que protege do SKU genérico reaproveitado (ex.: «195»).

**Chave do produto** (determinística: embaralhar a entrada dá a mesma saída):
- destino manual;
- senão `sku:<menor SKU oficial normalizado>`;
- senão `cat:<menor catálogo>`;
- senão `up:<menor UP>`;
- senão `item:…`.

O id das ações de estoque usa essa chave, não o anúncio, e por isso não muda quando o representante muda.

**Detecção (só sugestão, na gaveta «Gerenciar mapeamento»):**
- `seller_custom_field` igual;
- título com sobreposição IDF ≥ 0,65 (tokens de `vinculos.js`, pesos de `duplicacao.js:38-44`);
- «Kit/Pacote/Combo/c/ N» (regex que casa 1.603 de 7.562 títulos ativos em 36 clientes) com o componente provável pelo título.

Cada sugestão diz o motivo. As ações são «Juntar» e «Não é o mesmo». No kit, quantidade e modo são obrigatórios.

### 3.3 Passo 3: estoque de cada pool

| Pool | Precedência (primeira leitura válida vence) | Sem nada |
|---|---|---|
| `…\|full` | `meli_up_estoque(full)` ≤ 2 d → `meli_full_estoque.disponivel` do inventário ≤ 2 d → `available_quantity` dos irmãos **só se** o UP não tem local próprio nem Flex | `null` (NOT_COLLECTED) |
| `…\|proprio` | `meli_up_estoque(proprio)` ≤ 2 d → `available_quantity` dos irmãos **só se** o UP não tem Full | `null` |

- Irmãos do mesmo pool com números diferentes (1 de 254 grupos hoje): vale o lido mais recente, com `divergente_ml = true` e aviso no `data_quality`.
- O número ambíguo do anúncio Full + Flex nunca é usado. Real: MLBU1140529263 mostra 400 no anúncio Full; MLBU3455477126 mostra 3, com 400 no depósito.
- **Rótulo honesto:** o estoque próprio é sempre «informado no ML pelo vendedor», nunca «físico».
  - O mesmo número redondo em vários UPs do mesmo depósito e data (o padrão 400/400 da amostra) aparece como nota «provável estoque de cadastro».
  - Isso não muda a conta, mas entra na pergunta ao cliente (§ 4.4).

### 3.4 Passo 4: estoque físico de referência (EF) do produto

Esta é a peça que resolve «2, 3, 5, 10 anúncios no mesmo estoque» sem contar em dobro e sem esconder ruptura.

**Pools Full:** cada um é um EF (estoque físico separado, contado pelo ML).

**Pools próprios do produto P:** o modo é decidido nesta ordem.

| Modo | Quando | EF | Rótulo |
|---|---|---|---|
| `um_pool` | 1 pool próprio | o pool | fato |
| `declarado` | `of_variante.estoque` com fonte e data ≤ 7 d | 1 EF para todos os pools próprios, E = declarado | «você informou N un em dd/mm» |
| `espelho_provavel` | 2+ pools próprios com o MESMO número | 1 EF, E = esse número (contado uma vez) | PREMISSA |
| `dividido` | números diferentes | 1 EF por pool | PREMISSA |

Hoje, nos 18 clientes com SKU (conferido em 14/10):
- 171 SKUs ativos estão em 2+ pools (14 clientes);
- 142 têm 2+ pools próprios: 90 com o mesmo número (11 clientes) e 52 divergentes (10);
- 29 são só Full × próprio.

**Fórmulas** (janela de 28 dias fechados, como hoje):

```
U_EF   = Σ u_i (28 d) dos anúncios do EF  [+ Σ u_kit × q  dos kits virtuais e montados na hora que consomem o produto]
v_EF   = U_EF / 28
cob_EF = round(E_EF / v_EF)                        ; null se v_EF = 0 ou E_EF = null
ponto_EF = ceil(U_EF × (lead + seg) / 28 − 1e-9)   ; lead = lead_time_cliente (anúncio do representante > SKU > '*' > premissa 21 d), seg = 7 d
E_P    = Σ E_EF distintos (Full + próprio contado conforme o modo)
U_P    = Σ U_EF ;  cob_P = E_P / (U_P/28) ;  capital_P = Σ E_EF × custo_unit  (uma vez por EF)
```

**O que fica em cada anúncio `i`** (por `aplicarProduto`):
- `i.cobertura_anuncio`: o número antigo (estoque ÷ venda do próprio anúncio), só para leitura;
- `i.produto = { chave, ef, modo, local, n_anuncios, irmaos (≤ 20), representa_estoque (é o representante do EF), representa_produto (é o representante do produto), estoque_ef, vel_ef, u_ef, r_ef, estoque, vel, u, r, cobertura, divergente_ml, premissas[] }`;
- com `produto.diagnostico_ligado = true`: `i.cobertura` e `i.ponto_reposicao` passam a ser os **do EF**. Com `false` (sombra), ficam os de hoje.

**Exemplo (catálogo + clássico no mesmo UP, E = 100, vendas 2/dia + 3/dia):**
- hoje cada um vê 50 e 33 dias;
- a V3 vê 20 dias para os dois;
- o ponto de reposição = ceil(140 × 28/28) = 140;
- sai 1 ação de ruptura, não 2.

### 3.5 Variações

- Cada variação tem seu UP, logo é um pool próprio. A velocidade por variação vem de `meli_pedido_item.variacao_id`, gravado desde a F1.
- Enquanto a variação não tem 28 dias de linhas (antes do backfill), o anúncio com variações continua um pool agregado (Σ estoques das variações; velocidade do anúncio), como hoje e declarado em `data_quality`.
- Variação que divide UP com outro anúncio entra no grupo dele.

### 3.6 Kits

| Tipo | Composição | Estoque | Demanda |
|---|---|---|---|
| **Kit Virtual do ML** (`bundle`) | `bundle.components` lido (`kit_virtual`/`ml_bundle`) | o ML calcula (`min floor(E_c/q_c)`); o kit **não é EF**, e a ruptura do kit é a do componente | `u_kit × q` entra no EF do componente do mesmo local do kit (premissa; sem esse local, no maior EF) |
| **Kit clássico `montado_na_hora`** (declarado) | humano confirma componente, quantidade e modo | o número do kit no ML é projeção do componente; o kit **não é EF** e não soma | `u_kit × q` no componente |
| **Kit clássico `pre_montado`** (declarado) | idem | caixas à parte: o kit **é EF próprio** (a ruptura dele vira «montar kits»). Na compra do componente, `E_equiv = E_c + E_kit × q` | `u_kit × q` no componente para a COMPRA |

- Real: tag `kit_component` em 3 anúncios do Uniaodog (UP `MLBU3732810550`).
- Os 1.603 títulos com cara de kit NUNCA viram composição automática. Viram um filtro «provável kit sem composição» na Folha (filtro recorta a vista, nunca o que o algoritmo vê) e sugestões na gaveta.

---

## 4. Diagnóstico por produto: o que muda em cada regra, gatilho e texto

### 4.1 Ponto único de entrada

`carregarBase` (`diagnostico-conta.js:82-150`):
- o SKU de :108 passa a vir de `meli_anuncio_up` (COALESCE `promo_anuncio`), e o prazo por SKU e o custo por SKU valem para os 46 clientes;
- depois de montar a lista (antes do return), roda `aplicarProduto(lista, grafoDoCliente(cliente), { vendas: agg, linhas, L, leadDe, ligado: P.produto.diagnostico_ligado })`;
- o grafo usa TODAS as arestas ativas e pausadas, porque irmão sem venda também tem estoque;
- nenhuma regra lê tabela de produto: todas leem o item do diagnóstico, como hoje.

`emRuptura`/`corteRuptura` (`lead-time.js:34-38`) **não mudam**: leem a cobertura já corrigida. A correção fica nas funções compartilhadas, não em cada chamador.

### 4.2 Funções compartilhadas (corrigem vários chamadores de uma vez)

| Função | Muda para | Chamadores consertados |
|---|---|---|
| `representaEstoque(i)` (nova, em `produto-estoque.js`) | `i.produto?.representa_estoque !== false` | todo consumidor de estoque pergunta a ela |
| `sugestaoFull` (`diagnostico-conta.js:317`) | usa `vel_ef`/`estoque_ef` do EF Full. Teto = `E_proprio − ponto_proprio` do mesmo produto. Devolve `{ enviar, causa: 'enviar_full' \| 'comprar' }` | `plano-anuncios` (:169/:183), `compras-previsao` (:57), `gatilhos` (~:427), `folha-anuncio` (:133), `gatilhos-real` (:100) |
| `riscoRuptura` (`lead-time.js:42`) | receita em risco = `r_ef` (o EF inteiro), não a do anúncio | regra `estoque_ruptura`, urgente de estoque, Folha |

### 4.3 Regras, gatilhos, textos e telas que mudam

| Onde | Hoje | V3 | Fase |
|---|---|---|---|
| `estoque_ruptura` (`plano-anuncios.js:163`) | 1 ação por anúncio | gate `&& representaEstoque(i)`: 1 ação por EF. Título e problema: «(N anúncios, mesmo estoque)». `causas`: `comprar` ou `enviar_full` (EF Full com estoque próprio ≥ envio: `como[0]` = «Enviar ao Full X un do estoque próprio (tem Y un)», nunca «comprar»). `spec.produto = { chave, ef, irmaos }` | F3 |
| `full_envio` (:182) | por anúncio | mesmo gate, com `vel_ef` | F3 |
| `idDaSpec` (:653) | alvo = anúncio | com `spec.produto` e `n_anuncios > 1`, alvo = chave do EF. **EF de 1 anúncio mantém o id de hoje** (zero churn) | F3 |
| `construirAcao` (:699) | `entidade` anúncio ou conta | `entidade { tipo:'produto', id, itens }`, `nivel 'produto'`, `refs` com todos os irmãos | F3 |
| `vinculos.js:71-72` | liga a tarefa ao anúncio da ação | liga cada irmão de `entidade.itens`: a medição soma o grupo, e os irmãos saem do controle (ficam «tocados») | F3 |
| `duplicacao_estrategica` (:121-143) | ignora estoque | trava de ruptura, cobertura projetada, teto da previsão (§ 6) | F5 |
| `full_estoque_antigo` (:557) | trava «vendeu nos 28 d» por anúncio | por EF Full (todos os irmãos do inventário) | F3 |
| `margem_negativa` (:403-420) | exige CMV% da conta (0 clientes) | com `financeiro.margem_medida_nas_regras`: margem MEDIDA (§ 5) | F4 |
| `ads_reduzir`, `ads_abaixo_meta`, `promocao_giro` (:273), `descontoMaximoPct` | dependem de `custos_cliente` | `economiaReal` do item quando há custo e cobertura (mesma chave) | F4 |
| `cadastrar_custos` (:611-623) | só sem custo nenhum | também com custo abaixo da cobertura mínima. `como` lista os PRODUTOS sem custo que somam 80% da receita (Pareto medido). Texto: «tarifas e frete já medimos; falta o custo de cada produto» | F4 |
| `compras-previsao.js` | 1 linha por anúncio; capital somado em dobro (:91) | com a chave ligada, 1 linha por PRODUTO (`if (i.produto && !i.produto.representa_produto) continue`), usando `U_P`, `E_P`, `u14`, `u0` do produto; `quanto = ceil(v × (lead + ciclo + seg) + dc − E_P)` (mesma fórmula de :42-47); `envio_full` por EF Full; saída com `produto { chave, n_anuncios, itens, modo }`; capital uma vez por EF | F3 |
| premissa de compras (:83) | «Estoque = disponível no anúncio…» | «Contamos o estoque uma vez por produto: no Mercado Livre, anúncios do mesmo produto vendem do mesmo estoque; Full e depósito próprio separados; estoque fora do canal e pedidos já feitos ao fornecedor não são vistos.» Com declarado: «estoque informado por {fonte} em {data}» | F3 |
| `gatilhos.js` (`ab`/`ruptTodos` ~:423/:438; `porNome`) | agrupa por título curto e SOMA quantidades | filtro `representaEstoque`; agrupamento pela chave do produto; `gatilho_avisado.familia` = chave do produto (dedupe de 7 dias por produto) | F3 |
| `gatilhos-real.js:99-100` | mapa slim sem produto | carrega `produto` | F3 |
| `plano-semana-texto.js` (`rupturaDe` :123, `comprasDe` :301, `unicosPorNome` :264) | 1 «pedir X» por anúncio | filtro `representaEstoque`; compras por produto; `unicosPorNome` sai do bloco de compras (o dedupe passa a ser do grafo) | F3 |
| `retroalimentacao.js:597` (`risco_estoque`) | por anúncio | filtro `representaEstoque` | F3 |
| `full-metricas.js:22/31` | `estoque_total` soma catálogo + clássico 2× | Σ dos EF Full distintos | F3 |
| `custo-vinculo.js` (nível 4 «grupo») | grupo = UP (`promo_anuncio`) | grupo = chave do produto (superconjunto). SKU de `meli_anuncio_up`. Camada nova: SKU da VENDA (`seller_sku` das linhas) | F3 |
| `duplicacao.js` (`acharFilhos` :33) | família por título (IDF) | candidato criado na janela com o MESMO produto vira filho (`fonte 'produto'`, similaridade 1); título só como reserva | F5 |
| `impacto-tarefas.js` | — | confundidor novo: «irmão do mesmo estoque zerou na janela» (`estoque_zero` de QUALQUER irmão do EF em `meli_item_mudanca`) | F3 |
| `diagnostico-motor.js:117-119` | margem null | margem medida quando há custo e cobertura | F4 |
| `folha-anuncio.js` | cobertura do anúncio | coluna «Cobertura (estoque do produto)»; bloco `financeiro` (F4) | F3/F4 |
| `DEFINICOES` (`diagnostico-conta.js:195`) | `cobertura`/`ponto_reposicao` por anúncio | reescritas «do estoque físico de referência (EF)…»; entradas novas: `estoque_produto`, `cobertura_produto`, `taxas_ml`, `frete_vendedor`, `receita_liquida`, `margem_medida`, `lucro_contribuicao` | F2/F4 |
| `qualidadeDados` (:250) | — | fontes novas: «produto por trás do anúncio» (k de n ativos com UP, j com SKU, g grupos, conta truncada); «estoque por local» (k de n UPs mistos lidos); «taxas e frete por pedido» (% da receita coberta). Bloqueadas: «Fatura do ML» (NOT_AUTHORIZED, como obter: permissão Faturamento + reautorizar), «Estoque físico fora do ML» (NEEDS_EXTERNAL_DATA), «Estoque por variação» (até 28 d de linhas) | F2/F4 |

### 4.4 Regras novas (v1.7.0; priors declarados; passam pelo construtor comum, fator e teto)

**`estoque_dividido`** (F3): produto com 2+ pools próprios em UPs diferentes. Duas causas, cada uma com seu caminho em `config/chaveiro.json → operacao_por_causa`:

| Causa | Nasce quando | Caminho | Texto |
|---|---|---|---|
| `confirmar_fisico` | modo `espelho_provavel` sem declaração válida, curva A/B, `U_P ≥ min_unidades_item` | `cliente · pendencia` (entrada nova em `config/dependencias-cliente.json`, molde de `prazo_fornecedor`) | pergunta ao cliente quantas unidades existem e como o estoque é controlado (§ 8.3). A resposta vira estoque declarado; «ERP/UpSeller sincroniza» = resolvido, com a fonte |
| `pool_zerando` | modo `dividido` (ou declarado < Σ pools): um pool em `emRuptura` enquanto outro está acima do próprio ponto de pedido | `assistido · notion card` («igualar o estoque no painel ou unificar os anúncios») | «um anúncio vai zerar enquanto o outro mostra Y un do mesmo produto» |

Parâmetros:
- urgência 4, esforço 1, causal 60, evidência `hipotese`;
- previsão `pendencia` (sem R$) para `confirmar_fisico`; `riscoRuptura(pool fraco)` para `pool_zerando`;
- prior `p_sucesso` 0,5 (premissa da casa), prova: dias sem estoque do pool fraco em 14 d;
- teto 2 por cliente.

Alvo hoje: 90 SKUs espelhados e 52 divergentes, só nos 18 clientes que já têm SKU.

**`sku_ausente`** (F3):
- ação de CONTA, quando os anúncios ativos sem SELLER_SKU somam ≥ 20% da receita 28 d (premissa);
- `como` lista os de maior receita;
- `assistido · notion card` (SELLER_SKU é atributo, fora da lista fechada do Chaveiro);
- previsão `pendencia`, teto 1;
- é pré-requisito de produto entre UPs e de custo por SKU (hipótese H1 da pesquisa).

**`kit_sem_composicao`** (F5):
- composição declarada em anúncio sem tag `bundle` e com vendas → «migrar para Kit Virtual» (o ML passa a calcular o estoque do kit pelo componente);
- `assistido`, teto 2.

**Dependências** (`config/algoritmo.json → dependencias`, Manual 5.2: disponibilidade antes de cadastros e duplicações):
- `duplicacao_estrategica` depende de `estoque_ruptura` e `estoque_dividido`;
- na F4, também de `margem_negativa`.

### 4.5 Merovíngio (medição e fator)

- A forma não muda.
- Ação de produto mede a soma dos anúncios ligados: `impacto-tarefas` já trata `m.itens` múltiplos, e `plano-semana-texto` já diz «e mais N anúncios».
- Ruptura no período já é confundidor (`estoque_zero`, `estado-anuncio.js`) e agora vale para qualquer irmão do EF.
- O fator continua por regra e família de demanda.
- Associação temporal ajustada, nunca causa.

---

## 5. Financeiro

### 5.1 Princípios

- Só o que o pedido entrega mais o custo que já existe. Nenhuma alíquota presumida.
- Centavos INTEGER nas somas, e arredondamento só na saída.
- «Lucro» só aparece com custo informado. Sem custo, o número é «receita líquida de taxas e frete».
- Qualquer componente faltando na linha deixa o lucro da linha `null`: taxa ou frete faltando SUPERESTIMA o lucro.

### 5.2 Por linha de pedido ℓ (`src/lib/lucro.js`, puro)

```
receita_ℓ = preco_unit_c × quantidade                         ; mesma definição do GMV → bate com meli_serie_item
tarifa_ℓ  = tarifa_c × quantidade      (financeiro.sale_fee_por_unidade = true, PREMISSA) ; tarifa_c NULL → NULL
frete_ℓ   = ratearPorReceita(custo_vendedor_c do envio, linhas do mesmo envio_id)[ℓ]    ; envio não lido → NULL
custo_ℓ   = custo_unit × quantidade    ; custosDosAnuncios (custo-vinculo.js:75): manual > SKU exato > SKU forte > grupo do produto > SKU da venda ; sem custo → NULL
imposto_ℓ = receita_ℓ × imposto_pct    ; só se custos_cliente informar ; senão NULL e rótulo «antes do imposto»
lucro_antes_imposto_ℓ = receita − tarifa − frete − custo      ; NULL se tarifa, frete ou custo NULL
lucro_ℓ   = lucro_antes_imposto − imposto
```

- **`ratearPorReceita(valor_c, linhas)`:** proporcional a `preco_unit_c × quantidade`. O resto do arredondamento vai para a maior linha, de modo que Σ = `valor_c` exato. Pacote de 3 pedidos com 1 envio desconta o frete UMA vez.
- **Kit sem custo próprio:** Σ quantidade × custo dos componentes (o mesmo de `erp-sync.js:96-115`). Sem o custo de um componente, o kit fica sem custo.
- **Cupom** (`payments.coupon_amount`): NÃO desconta, porque quem financia é NOT_VERIFIED (`/orders/{id}/discounts.funding_mode`). Aparece só como informativo.
- **Reembolso** (`transaction_amount_refunded`): sai da receita líquida, por pedido.
- **Cancelado:** a linha `status='cancelled'` sai da receita (corrige também o GMV, que hoje mantém cancelamento depois de 3 dias; declarado como «parcial» enquanto a busca de cancelados não for verificada).

**Semântica do `sale_fee` (`conciliarTarifa`, puro):**
- Cada linha com q ≥ 2 é comparada a `listing_prices(price, category_id, listing_type_id, logistic_type)` e vota `por_unidade` | `por_linha` | `indeterminado`.
- Com ≥ 5 votos e ≥ 90% de acordo, a conta tem a semântica decidida.
- Sem decisão: «tarifa não conciliada» no rótulo, e a premissa por unidade segue (2 de 2 observações reais apontam por unidade; a 2ª era Full com venda Flex e custo fixo não identificado).
- A confirmação definitiva é o billing `detail_sub_type CV` (F7).

### 5.3 Agregação com cobertura (pedido → anúncio → produto → conta)

```
agregar(linhas, chaveDe) → { receita_c, receita_coberta_c, taxas_c, frete_c, custo_c, lucro_c, unidades, cobertura }
cobertura    = receita das linhas COMPLETAS ÷ receita total
margem_pct   = lucro_c ÷ receita_coberta_c × 100        ; mesmo denominador das linhas medidas; nunca extrapola
receita_liquida = receita − taxas − frete               ; existe sem custo (para TODOS os clientes), com a cobertura de taxa+frete ao lado
```

- **Por anúncio:** `chaveDe = item_id`. **Por produto:** a chave do produto. **Por conta:** uma só.
- **Pós-Ads, por anúncio:** lucro na MESMA janela de `meli_ads_item` (`de..ate` da própria linha) − custo de Ads. `meli_ads_dia` tem **0 linhas** (conferido): Ads por dia e por mês ficam «—» até consertar `coletarAdsDia`.
- **Exibição:** número só com `cobertura ≥ 0,8` e custo informado pelo cliente. Abaixo disso, «parcial (x%)» com o motivo («frete não lido em k de n envios»). Sem custo, só a receita líquida.

SQL em `carregarBase`: uma leitura por cliente e janela, parametrizada, com lista fechada de colunas. O frete vem por `LEFT JOIN meli_envio_custo`, e o rateio é feito no JS puro, não no SQL.

### 5.4 `economiaReal` por anúncio (alimenta o Algoritmo)

```
lucro_unit(p) = p × (1 − t − i) − c − f − F
  t = tarifa % (listing_prices.percentage_fee quando lido; senão a razão observada nas linhas, rotulada)
  F = custo fixo por unidade (listing_prices.fixed_fee; depende de logistic_type), f = frete/un medido em 28 d, c = custo, i = imposto informado
margem_pct = lucro_unit(p)/p × 100 ; acos_equilibrio = margem_pct ; roas_equilibrio = 100/margem_pct ; acos_alvo = margem − margem_desejada
preco_minimo = (c + f + F)/(1 − t − i − m) ; desconto_max_pct = max(0, 1 − preco_minimo/p) × 100
cruza_faixa_frete = preco_minimo < 79 ≤ p  → desconto só até a faixa + «recalcular abaixo de R$ 79 com listing_prices + shipping_options/free»
```

Com `financeiro.margem_medida_nas_regras = true` (nasce `false` + teste «plano idêntico com a chave desligada»):
- **`margem_negativa`**:
  - usa a margem medida ANTES do imposto quando a cobertura ≥ 0,8. É monotônica (≤ 0 antes implica ≤ 0 depois), então dispara sem o imposto informado;
  - evidência `fato`;
  - `confirmar_com` perde «comissão e frete reais do pedido (NOT_COLLECTED)»;
  - produto com 2+ anúncios gera 1 ação de produto.
- **`ads_reduzir` / `ads_abaixo_meta`:** `roas_equilibrio` real.
- **`promocao_giro`:** o portão `diag.custos_informados` vira `|| i.economia_real`, com `desconto_max_pct` real e a cobertura do EF.
- **`diagnostico-motor`:** `margem_pre_ads`/`margem_pos_ads` reais. O Uniaodog (22 SKUs com custo) ganha margem na hora, depois da reconciliação dos nomes («Coleira P» × «COLEIRA-P/M»).

**Fora agora (ponytail):** prioridade do plano em R$ de lucro. Entra quando houver custo em vários clientes; hoje há custo em 1.

### 5.5 DRE mensal simples (projeção pura, `dreMensal`)

Competência = dia da venda (o ML não tem data de liquidação).

| Linha | Fonte | Sem dado |
|---|---|---|
| Receita bruta de vendas | linhas pagas do mês | — |
| (−) Cancelados | linhas `cancelled` | «parcial» até verificar a busca |
| (−) Reembolsos | `reembolso_c` | só o que vem em `payments` |
| = Receita líquida | | |
| (−) Tarifas de venda do ML | `tarifa` | premissa da semântica no rodapé |
| (−) Frete pago pelo vendedor | `frete` | cobertura % ao lado |
| (−) Ads | `meli_ads_dia` do mês inteiro | «—» (tabela vazia hoje) |
| (−) Custo dos produtos | `custo` | «—» sem custo; cobertura % |
| (−) Impostos | % informado | «não incluídos» |
| = **Margem de contribuição** das vendas com custo e frete lidos (X% da receita) | | |

- **Fora, listados como NOT_COLLECTED:** armazenagem e entrada no Full, custo logístico de devolução, cupom do vendedor, despesas fixas.
- **Rodapé fixo:** «Não é lucro líquido.»
- Mês com dia sem linhas sai «parcial: N dias», e nada é extrapolado.
- **Ponytail:** não há fotografia do mês fechado (tabela, hash, livro). Entra quando o billing estiver ligado; antes disso o DRE é parcial por natureza.

### 5.6 O que fica «—» (honestidade)

| Número | Fica «—» quando |
|---|---|
| Lucro e margem | sem custo informado, ou cobertura < 80% |
| Lucro «depois do imposto» | sem `imposto_pct` informado (mostra «antes do imposto») |
| Ads no DRE | `meli_ads_dia` incompleto no mês (hoje: sempre) |
| Tarifa fechada do mês, custo fixo, armazenagem Full | billing NOT_AUTHORIZED (403 `PA_UNAUTHORIZED_RESULT_FROM_POLICIES`) |
| Devoluções e custo logístico da devolução | NOT_COLLECTED (`/post-purchase/v2/claims/search`, usado hoje, não é documentado) |
| Capital fora do Full | sem custo; e nunca chamado de «físico» sem declaração ou ERP |

**Billing (F7):** depois da permissão «Faturamento» no app + reautorização de 1 cliente:
- Σ (tarifa) do mês × Σ `detail_amount` CV de `/billing/integration/periods/key/{key}/group/ML/details`;
- diferença ≤ 1%: a premissa vira fato; diferença maior: o financeiro volta a «parcial» com o motivo;
- o billing também traz Ads, custo fixo e armazenagem para o DRE.

---

## 6. Duplicação estratégica ciente do estoque

### 6.1 O fato do ML que decide

No modelo User Products, título, fotos, atributos, `catalog_product_id` e `available_quantity` são do UP e se replicam entre os anúncios dele. Logo:

- **Duplicata que muda só a condição de venda** (preço, tipo de anúncio, parcelamento) pode ficar no MESMO UP. Divide o estoque sem nenhum código.
- **Duplicata estratégica do método** («variar DE VERDADE título, capa, categoria», título ≥ 20%) nasce num **UP NOVO, com estoque separado**. É o caso B: o mesmo SKU em 2 pools próprios, que o grafo junta pelo SKU (o Ofertas copia o SELLER_SKU, `ofertas-ml.js:471`).
- Se um POST com os mesmos atributos cai no UP existente é NOT_VERIFIED. Não supomos: no dia seguinte à criação, a coleta lê o `user_product_id` da duplicata e o caso vira FATO («mesmo estoque» ou «estoque separado»). É um rótulo, não um bloqueio.

### 6.2 2, 3, 5 ou 10 anúncios do mesmo produto (volumes de `config/duplicacao.json`)

| Situação | O que o ML faz | O que a V3 faz |
|---|---|---|
| Todos no mesmo UP | desconta uma vez; todos mostram o mesmo número | conta uma vez, soma a demanda: 1 cobertura, 1 linha de compra, 1 ação de ruptura (representante) |
| Em UPs novos (duplicatas estratégicas) | cada UP desconta sozinho; o físico é um só | junta pelo SKU; modo espelho ou dividido; pergunta o físico ao cliente; sugere a divisão (Σ = físico); na F6, e só com decisão, aloca |
| Full + próprio | estoques físicos distintos | nunca junta num EF; soma para COMPRAR; o próprio abastece o Full (`enviar_full`) |

Com 10 anúncios a 0,4/dia e E = 120 no mesmo UP: hoje cada um vê 300 dias; a V3 vê 30 dias e ponto de pedido 112. É esse número que entra em ruptura, gatilho e compras.

### 6.3 Regra 1b (`plano-anuncios.js:121-143`), sempre lendo o EF do original

1. **Trava de disponibilidade:** EF em `emRuptura` → a ação não nasce. Conta em `omitidas.estoque_nao_comporta`, como as outras omissões de `montarAcoes`. É o Manual 5.2: disponibilidade antes de duplicar.
2. **Cobertura projetada:**
   - `extraDia = valores.base ÷ 28` (as unidades que a própria regra prevê);
   - `cob_pos = coberturaProjetada(E_EF, v_EF, extraDia)`;
   - se `cob_pos < lead + seg`, a ação nasce com `depende_de` da reposição e `como[]` ganha «programar a reposição junto»;
   - a evidência diz: «a duplicata vende do mesmo estoque do produto: hoje E un para ~C dias; com a duplicata vendendo o previsto, ~C' dias».
3. **Teto da previsão:** unidades extras ≤ `max(0, E_EF − v_EF × horizonte)`. Ganho que não cabe no estoque não é ganho.
4. **Margem (F4):** produto com margem medida ≤ 0 → `depende_de margem_negativa`. Não se duplica prejuízo.
5. A premissa da previsão ganha «estoque compartilhado: não soma estoque», ao lado da canibalização já declarada (:141).

### 6.4 Execução (Ofertas; `criarAnuncio` ainda não está ligado ao fluxo, então a trava entra antes de ligar)

- `ofertas-fluxo.js:159-163` já cria o job na mesma `variante_id` (mesmo SKU), e `excluir_ids` (:459) já protege a idempotência contra os irmãos.
- **Quantidade proposta** (`ofertas-ml.js:473`, hoje número livre). Ela depende do UP ESPERADO:
  - só condição comercial muda (espera mesmo UP) → o estoque atual do pool do original. Se cair no mesmo UP, nada muda;
  - título ou capa mudam (espera UP novo) → a alocação sugerida `alocarEstoque(F, pools + duplicata com v = extraDia)`:
    - `q_p = floor(F × v_p ÷ Σv)`, distribuído pelos maiores restos;
    - mínimo 1 por pool ativo quando `F ≥ nº de pools`;
    - **Σ q_p = F sempre**;
    - Full fora;
    - F = físico declarado válido; sem ele, `E_P` próprio com a premissa do modo.
  - O consultor confirma o número no briefing.
- **Trava em `validarProposta`:**
  - com físico declarado válido, `quantidade + Σ estoques dos outros pools próprios ≤ físico`; senão é rejeitado com `'estoque_acima_do_fisico'` (mensagem fixa);
  - sem físico declarado, a publicação live fica pendente `'estoque_fisico'`; o dry-run continua livre.
- **Conferência da publicação:** ler `user_product_id` e `available_quantity` do novo e do original.
  - Mesmo UP → rótulo «divide o estoque pelo ML».
  - UP novo → «estoque separado», e a regra `estoque_dividido` assume no dia seguinte.
  - Se a expectativa errou para o lado perigoso (esperava o mesmo UP, criou UP novo com o estoque inteiro): pendência assistida imediata «estoque contado 2×: ajustar no painel».

### 6.5 Medição (Merovíngio)

- `acharFilhos` (`duplicacao.js:33`): candidato criado na janela com o MESMO produto vira filho (FATO, `fonte 'produto'`). O título por IDF fica só para anúncio sem chave.
- `medirFamilia` (:72) não muda de forma. Na F4 acrescenta o lucro da família (canibalização em R$ de lucro: o catálogo mais barato pode manter a receita e derrubar o lucro).
- Ruptura de qualquer EF da família no período tira o episódio do aprendizado (`confundido_estado`/`estoque_zero`).
- O fator por objetivo (:101-132) segue igual.

---

## 7. Escrita de estoque no ML (Chaveiro) e adaptador do UpSeller

### 7.1 F0–F5 não escrevem estoque

A única escrita no ML continua sendo a que já existe e já tem salvaguardas: criação pelo Ofertas (dry-run por padrão, `live === true`, `chave_idem`) e promoções (`promocoes-exec.js`). A F5 só muda o VALOR proposto da duplicata e acrescenta a trava Σ ≤ físico.

### 7.2 Por que não «sincronizar» à moda do UpSeller

Sem razão de estoque (ledger), sincronizar a partir de um pool do ML vende a mais por construção. Exemplo:
- físico 40; o pool A (mestre) mostra 40 e o B recebe 38 (40 − segurança 2): o ML já mostra 78 para 40 reais;
- B vende 10 e A vende 5 (físico 25): A mostra 35, B 28, total 63;
- na sincronização seguinte, B volta a ~33: total 68 para 25 reais.

O UpSeller evita isso porque a dedução acontece no armazém DELE. Nós não temos armazém. Por isso a única escrita possível é **alocar** um físico DECLARADO, e nunca espelhar.

### 7.3 F6 (só com decisão do David): operação `ml_estoque · alocar`

Contradiz a decisão registrada «Estoque nunca é escrito» (`docs/desenho-causalidade-executor.md:16`, salvaguarda § 7). Por isso é pergunta ao David (§ 10.4). Recomendação: não antes de F3–F5 rodarem 30 dias.

**O que é:**
- dividir o físico DECLARADO (cliente/equipe ≤ 24 h, ou adaptador UpSeller/ERP ≤ 24 h) entre os pools PRÓPRIOS do mesmo produto;
- ou zerar uma duplicata encerrada.

**O que não é:** sincronização por pedido nem em tempo real (isso é do ERP), e nunca aumenta o total vendável acima do físico.

**Regras de estoque por produto** (`produto_regra_estoque`, molde UpSeller sem o que vende a mais):

```
alvo_total = max(0, físico − seguranca)                  ; segurança sugerida = ceil(v_P × 1 dia) (premissa: alocação diária)
q_p        = alocarEstoque(alvo_total, pools próprios por velocidade), cada q_p ≤ maximo_por_anuncio
mínimo     = só como PISO de alocação (1 un por pool quando alvo_total ≥ nº de pools); NUNCA o «mínimo» do UpSeller (envia X com 0 real)
nao_escrever = 1 → produto fora
```

Kit montado na hora: `floor(q_componente ÷ q)`. Kit virtual nunca é escrito (o ML calcula).

Depois de uma alocação, cada pool desconta sozinho as próprias vendas, então Σ mostrado ≤ físico restante. Rebalancear exige declaração nova (≤ 24 h) ou redistribuição que preserve a Σ lida AO VIVO dos pools próprios.

**Lista fechada:**
- `OPERACOES` (`chaveiro.js:11`) ganha `ml_estoque: ['alocar']`;
- `config/chaveiro.json → caminho_por_regra.estoque_dividido.operacao_por_causa`: `pool_zerando` vira `automatico · ml_estoque · alocar` (só com política liberada); `confirmar_fisico` continua `cliente · pendencia`.

**Payload por tipo de conta** (lido AO VIVO em `/users/{id}.tags` antes de cada ordem):
- **Sem `warehouse_management`:** `PUT /items/{um item do UP} {available_quantity: q}`. O ML replica para os irmãos do UP de forma assíncrona. Variação: `{"variations":[{"id","available_quantity"}]}`.
- **Com `warehouse_management`** (multiorigem; o Uniaodog mostra `seller_warehouse`, store 86161652):
  - `PUT /user-products/{UP}/stock/type/seller_warehouse {stock:[{store_id, network_node_id, quantity}]}`, com `x-version` do GET imediatamente anterior;
  - sem `x-version` = 400; desatualizado = 409 → reler e recomeçar, sem forçar;
  - nessa conta o `PUT /items` pode dar 200 sem efeito (NOT_VERIFIED em MLB): 200 ≠ feito;
  - com várias `store_id`, a ordem é recusada («multi-depósito: distribuir no painel»; ponytail: rateio por depósito quando houver caso real).
- **Nunca:** Full (`meli_facility`, sem escrita por API); Flex `selling_address` em MLB (NOT_VERIFIED; a doc BR fala em Argentina e Chile); status de pausa. Zero = `available_quantity 0` → `paused/out_of_stock`, que reativa sozinho ao repor.

**Salvaguardas** (molde de `promocoes-exec.js` + desenho do Chaveiro). Do Chaveiro só existe hoje a classificação; `exec_politica`/`exec_ordem`/`exec_evento` são construídos aqui pela primeira vez, como o desenho já descreve, e não um executor paralelo.
1. Chave global `chaveiro_ligado` e `adaptadores_live_json.ml_estoque` nascem 0. Política por cliente nasce `propor`. `confirmar === true` e líder em `por`. Prospect e cliente sem integração ML ativa (`integracaoMlAtiva`) bloqueados.
2. Ordem com hash (payload + snapshot); aprovado ≠ executado. Estreia: 1 produto de 1 cliente, `max_ordens_dia = 1`.
3. **Snapshot ANTES:** `GET /user-products/{id}/stock` (locations + `x-version`) e GET dos irmãos (bulk).
4. **Invariantes puras antes de qualquer PUT:**
   - físico declarado com ≤ 24 h;
   - Σ q de TODOS os pools próprios do SKU ≤ físico − segurança;
   - nenhum pool Full;
   - nenhum irmão `paused_by_seller` ou alinhado (`alinhado()`: pausado de propósito, descontinuado);
   - teto diário.
5. **Releitura ao vivo** logo antes do PUT. Se a quantidade difere do snapshot além das vendas desde o snapshot (`orders/search` por `date_created ≥ snapshot` desses anúncios), fica `'divergente'` e nada é enviado: o vendedor mexeu, e a V3 não sobrescreve mudança humana.
6. **Ordem de escrita:** primeiro os pools que DIMINUEM. Releitura. Depois os que aumentam, com o alvo recalculado descontando as vendas desde o snapshot.
7. **Conferência obrigatória** ≥ 5 min depois (replicação assíncrona), em TODOS os irmãos (bulk + `/stock`):
   - lido = esperado → `executada`;
   - senão → `em_conferencia`, nova leitura no tick;
   - incerto 3× → `falhou`, com o texto fixo «o canal não confirmou: conferir no painel»;
   - nunca repetir o PUT às cegas.
8. **Reversão:** NÃO há volta automática ao snapshot, porque reinflaria o que foi vendido no meio. A «reversão» é uma ORDEM NOVA calculada agora a partir do físico declarado atual. Isso refina a D9 do desenho do Chaveiro e é declarado na tela.
9. **Change-log:** a mudança aplicada entra em `meli_item_mudanca` com fonte `'chaveiro'` (o CHECK já está previsto em `migrarMudanca`). Folha, cronologia e Merovíngio veem a intervenção sem código novo. Auditoria em `livro-registro.js`.
10. **Nada disparado por texto** do cliente, do Notion ou do ERP: é dado, não comando.

### 7.4 Adaptador do UpSeller (F7, opcional, só leitura)

- Para cliente que já usa o UpSeller no plano Profissional+ (ou «Plano Kit»):
  - `POST https://openapi.upseller.com/erp/inventory/getWarehouseList/v1`;
  - `POST /erp/inventory/pageWarehouseSku/v1` (PageSize ≤ 100);
  - headers `X-Upseller-Client-Id`, `X-Upseller-Api-Token`, `X-Upseller-Language`.
- A credencial fica cifrada em `erp_credenciais` (molde Bling/Tiny, `erp-credenciais.js`). Erro nunca ecoa o corpo.
- Grava `of_variante.estoque` / `estoque_fonte='upseller'` / `estoque_em`. Vira a fonte do «físico» para o modo `declarado` e para a F6.
- Nunca decide nem escreve nada lá.
- Os nomes dos campos do corpo e da resposta estão em IMAGEM na doc (NOT_VERIFIED). O adaptador nasce devolvendo `pendente:'campos_nao_verificados'` até um exemplo real de cliente.
- Saldo de estoque no Bling/Tiny (`erp-bling.js`/`erp-tiny.js` leem só custo): mesmo molde, também NOT_VERIFIED.
- Comercial: o programa de parceiros deles (> 10% recorrente, procura assessorias) é decisão do David, fora deste desenho.

---

## 8. Telas e relatórios

Regras: nenhum botão primário novo (`/cliente` já tem o seu, o da próxima ação); até 2 secundárias soltas; tabelas com até 6 colunas; valor de KPI nunca colorido; cor só por token do 1º `:root` de `src/web/ui.css` (reusar chips e badges); ids usados pelo JS nunca somem; nada de emoji em controle.

### 8.1 `/cliente › Produtos` (aba nova)

- `ABAS` (`src/web/cliente.js:68`) ganha `['produtos','Produtos']` entre Anúncios e Estratégia; `'produtos'` entra em `VIVOS` (:69).
- Script novo `src/web/produtos.js` (`window.PSProdutos`, no padrão de `galeria-anuncio.js`).
- Inventário: bloco `produtos` em `docs/ux/inventario-cliente.json` com os ids `secProdutos`, `tabProdutos`, `btnMapeamento`, `gavMapeamento`, `btnAtualizarEstoque`.

**Conteúdo da aba:**
- **Frase-veredito** (no máximo 4 números): «216 anúncios ativos são 141 produtos · 3 com estoque dividido · 6 kits sem composição».
- **4 KPIs:** Produtos · Estoque contado uma vez (un) · Capital em estoque (R$ ou «—») · Produtos em ruptura.
- **Secundárias:** «Gerenciar mapeamento» e «Atualizar estoque» (só GET `/stock` dos produtos visíveis, com teto). Os filtros por `?f=` recortam só a vista.
- **Visão** (chip): «Estoque | Lucro». A segunda entra na F4.

| Visão | Colunas (6) |
|---|---|
| Estoque | Produto (nome curto do representante + «3 anúncios · SKU X» ou «sem SKU») · Estoque («próprio 400 · Full 3», ou «—» com o motivo no `title`) · Vende/dia · Cobertura · Pedir (conservador–base, até a data) · Situação (chip: ruptura · hora de pedir · estoque dividido · confirmar estoque · kit sem composição · ok) |
| Lucro (F4) | Produto · Receita 28 d · Taxas e frete · Custo · Lucro · Margem («parcial (x%)» ou «—» com o motivo) |

- **Em sombra (F2):**
  - uma faixa no topo: «Somando por anúncio: 85.703 un · contado uma vez: 28.410 un» (por cliente);
  - a Situação mostra «por anúncio: N dias» ao lado da cobertura nova;
  - nada muda em plano, aviso ou texto.
- **Sem SKU nem UP lido:** «produto = este anúncio (chave não lida)».

### 8.2 Folha do produto

Linha expandida (`<details>` nativo), sem coluna extra, com estes blocos:
1. **Anúncios:** Anúncio (link + MLB) · Tipo (catálogo/clássico/premium) · Logística · Estoque que o ML mostra · Vendas 28 d · Receita 28 d.
2. **Estoque por local:** Local · Quantidade · Fonte (`/stock` lido em dd/mm · anúncio · informado pelo cliente · UpSeller) · Modo (um pool / espelho provável / dividido / declarado) · Premissa.
3. **Financeiro (F4):** Anúncio · Receita · Tarifas · Frete · Custo · Lucro (margem como subtítulo da célula). Mostra, por exemplo, que o catálogo vende mais com margem menor.
4. **Kit:** composição, modo e fonte.
5. **Ações do plano** ligadas a este produto (link), e premissas.

### 8.3 Gaveta «Gerenciar mapeamento» (molde UpSeller)

- Três abas: Sugestões (n) | Mapeados | Não mapeados.
- Cada sugestão traz o motivo: «mesmo SKU interno (seller_custom_field)», «título 82% parecido», «mesmo catálogo, SKUs diferentes», «Kit 3un → 3 × Coleira P/M?».
- Ações:
  - «Juntar»: prévia → confirmar;
  - «Não é o mesmo»: grava a recusa;
  - no kit: quantidade + modo obrigatórios.

### 8.4 Rotas (`src/rotas-produtos.js`, montado em `server.js` ao lado de `criarRotasCompras`)

**Comum a todas:**
- loopback/guarda-local;
- cliente canônico, senão 404; prospect → 400 fixo;
- SQL parametrizado;
- **prévia por padrão**, só grava com `confirmar === true`;
- `por` validado como no lead time (líder, consultor ou CS do cliente);
- mensagem fixa, sem eco do valor recebido.

| Rota | Fase |
|---|---|
| `GET /api/cliente/produtos?cliente=&f=&visao=estoque\|lucro` → `{ resumo, produtos[{ chave, nome, n_anuncios, sku, pools[{local, estoque, fonte, vel_dia, cobertura}], estoque_total, vel_dia, cobertura, ponto_pedido, pedir, financeiro\|null, situacao }], premissas[], data_quality, sombra\|null }`. É projeção de `diagnosticarConta` + `preverCompras`, nunca uma conta nova | F2 |
| `GET /api/cliente/produtos/mapeamento?cliente=` → `{ sugestoes, mapeados, nao_mapeados }` | F2 |
| `POST /api/cliente/produtos/juntar { cliente, origem, produto, por, confirmar }` · `…/separar` | F2 |
| `POST /api/cliente/produtos/estoque/atualizar { cliente, produto }` (só GET no ML, com teto) | F2 |
| `POST /api/cliente/produtos/estoque-fisico { cliente, sku, quantidade, fonte: cliente\|equipe, por, confirmar }` (seção Configurar, ao lado do prazo de reposição) | F3 |
| `POST /api/cliente/produtos/kit { cliente, kit, componentes[{chave, quantidade}], modo, por, confirmar }` | F5 |
| `GET /api/cliente/dre?cliente=&mes=AAAA-MM` | F4 |
| `POST /api/cliente/produtos/regra-estoque` · `/api/chaveiro/estoque/{preparar,executar}` | F6 |

### 8.5 Outras telas

- **Folha do anúncio** (`folha-anuncio.js`): «Cobertura (estoque do produto)»; bloco `financeiro` (5 colunas: Receita 28 d, Taxas ML, Frete, Custo, Margem, com «—» e o motivo); filtro novo «provável kit sem composição» (`src/lib/filtros.js`); o CSV sai da mesma função.
- **Painel Full:** estoque sem dupla contagem; a leitura cita «N produtos em M anúncios».
- **`/metodologia`** lê `config/algoritmo.json`, então as regras novas e o bloco `produto` aparecem sozinhos. `docs/metodologia-algoritmo.md` ganha a § 10.7 «Produto e estoque compartilhado (v1.7.0)».
- **Aba Plano:** o card da ação de estoque lista os irmãos.

### 8.6 Textos ao cliente: compras, ruptura e duplicação falam de PRODUTO

Todos os textos passam pelo `relatorio-seguro` e pelo `tituloOk`. Nunca levam id interno (UP, chave). O capital aparece uma vez por produto. Nada sai fora da terça nem antes de `inicio_envios` (regras dos gatilhos inalteradas).

**Ruptura** (plano semanal e urgente; `gatilhos.js`, `plano-semana-texto.js:123`):
> «• Peitoral H Rock M (3 anúncios, mesmo estoque): tem 40 un (~9 dias somando as vendas dos 3) → sugerimos repor *60 a 80 un*»

Premissa fixa no bloco:
> «Contamos o estoque uma vez por produto: no Mercado Livre, anúncios do mesmo produto vendem do mesmo estoque.»

**Full com estoque próprio:**
> «• Guia Unificada: no Full tem 5 un (~3 dias) e no seu estoque 120 un → sugerimos enviar *40 un* ao Full (não precisa comprar)»

**Compras** (`plano-semana-texto.js:301`):
> «• Coleira P/M (2 anúncios): pedir até 22/10 · *80 a 100 un* (tem 60 un no total)»

Com declaração: «(você informou 60 un em 14/10)».

**Confirmar estoque** (pendência do cliente; template fixo, sem culpa, sem contagem de dias, sem nome interno):
> «Vimos a Coleira X em 3 anúncios, cada um com estoque próprio no Mercado Livre e o mesmo número (40 un) em todos. Se nenhum sistema desconta a venda de um anúncio nos outros, o Mercado Livre pode vender mais do que existe. Quantas unidades você tem desse produto? Algum sistema atualiza esses anúncios?»

**Estoque dividido:**
> «• Peitoral H M: um anúncio fica sem estoque em ~3 dias enquanto o outro mostra 35 un do mesmo produto; igualar no painel mantém as vendas do anúncio que zera»

O dono (cliente ou assessoria) vem de `config/gatilhos.json`.

**Duplicação** (só interno: card do Notion e Discord do consultor):
> «A duplicata vende do mesmo estoque do produto: hoje 40 un para ~9 dias; com a duplicata vendendo o previsto, ~7 dias. Se o ML criar estoque separado, divisão sugerida: 26 / 14.»

**Financeiro** (relatório focado e semanal, opcional por perfil, só onde medido):
- Sem custo:
  > «Receita líquida de taxas e frete do Mercado Livre nos últimos 28 dias: R$ X (comissão R$ Y, frete R$ Z).»
- Com custo e cobertura ≥ 80%:
  > «Lucro de contribuição dos últimos 28 dias, antes de impostos (não informados): cerca de R$ W (M% das vendas) — receita menos tarifas do Mercado Livre, frete pago por você e custo dos produtos que você nos passou. Devoluções ainda não entram. Não é o lucro líquido da empresa.»

  Valores arredondados com `faixaImpacto`.
- Margem negativa:
  > «O anúncio X está vendendo abaixo do custo que você nos passou: cada venda deixa cerca de R$ 3 a menos, depois das tarifas e do frete. Vale revisar o preço ou o anúncio pago.»

  Nunca «prejuízo» com custo estimado. Nunca «lucro» sem custo. Nunca número com taxa ou frete faltando.

**Notion** (dry-run por padrão, `distribuir-notion.js` inalterado):
- card «Repor estoque antes de zerar: Peitoral H Rock M (3 anúncios)»;
- a seção «Onde» lista os links dos irmãos;
- o roteiro do Manual não muda;
- `tarefa_item` liga todos os irmãos.

**Interno:** o aviso ao consultor (`consultor-discord.js`) ganha uma linha de lucro do cliente quando há cobertura.

---

## 9. Fases (cada uma publicável sozinha)

**Regra de publicação de toda fase:**
- a suíte inteira verde (`export PATH=$HOME/.local/node/bin:$PATH; for f in scripts/teste-*.mjs; do node "$f" || exit 1; done`; hoje são 100 scripts);
- testes novos com `PS_DB_MEMORIA=1` antes dos imports e API falsa injetada (`chamarFn`);
- fixtures com o FORMATO das respostas reais, sem buyer nem token;
- nenhum teste toca o ML, o Notion ou `data/db.sqlite`;
- leitura real só em 1 cliente piloto (Uniaodog), com contagem de chamadas no log;
- docs atualizados: `docs/metodologia-algoritmo.md`, `docs/manual-integracao-ml.md` e a linha em «Onde está cada coisa» do `CLAUDE.md`.

| Fase | Entrega | Escrita no ML | Depende de |
|---|---|---|---|
| **F0** multiget bulk | helper `multiget` + os 4 pontos | nenhuma | — (**prazo 24/10**) |
| **F1** coleta das chaves e das linhas | `meli_anuncio_up`, `meli_pedido_item`, `meli_coleta_dia.linhas`, backfill 28 d, saúde pelas arestas, conferidor readonly | nenhuma | F0 |
| **F2** grafo em sombra | `produto-estoque.js`, `meli_up_estoque` + `/stock`, `produto_vinculo`, aba Produtos (só leitura + gaveta), «por anúncio × por produto» | nenhuma | F1 |
| **F3** diagnóstico por produto ligado (v1.7.0) | `diagnostico_ligado = true`; ruptura, compras, avisos, textos, Full e vínculos por EF/produto; `estoque_dividido`; `sku_ausente`; estoque declarado; conta truncada | nenhuma | F2 + conferência de 3 clientes |
| **F4** financeiro | fretes, cancelados, lucro por pedido/anúncio/produto, `conciliarTarifa`, `economiaReal`, visão Lucro, Folha, DRE simples, regras com a margem medida (chave) | nenhuma | F1 (pode correr em paralelo a F2/F3) |
| **F5** duplicação ciente do estoque + kits | § 6; Kit Virtual automático; kit declarado com modo; `kit_sem_composicao`; variações por UP | nenhuma (só muda o valor proposto da duplicata) | F3 |
| **F6** escrita de estoque | `exec_*` do Chaveiro + `ml_estoque · alocar` | **sim**, estreia supervisionada | **decisão do David** + F3–F5 rodando 30 d |
| **F7** opcional | adaptador UpSeller (leitura); conciliação com o billing | nenhuma | cliente Profissional+ com exemplo real; permissão Faturamento |

### F0: multiget → `/items/bulk` (até 24/10/2026)
- **Teste novo `scripts/teste-meli-bulk.mjs`:**
  - monta `/items/bulk?ids=…&attributes=body.id,body.title…` em lotes de 20;
  - aceita `status_code` e `code`;
  - N ids com 0 corpos lança erro e nada é gravado;
  - erro de um item não derruba o lote;
  - varredura de texto: nenhum `'/items?ids='` sobra em `src/`.
- **Fixtures atualizados:** `teste-saude-coleta.mjs` (que monta `'/items?ids'`), `teste-promocoes-dados.mjs`, `teste-alerta-cliente.mjs`. `teste-meli-renovacao.mjs` sem regressão.
- **Pronto quando:** 1 GET real confirma o formato (e se `bundle` vem) e a coleta do piloto grava o mesmo número de anúncios do dia anterior.

### F1: coleta das chaves e das linhas (só gravação)
- **Teste novo `teste-anuncio-up.mjs`:**
  - UP no item; UP e `inventory_id` por variação; sem UP → `item:`;
  - SELLER_SKU vence `seller_custom_field`; `sku_fonte` correto;
  - tag `bundle` e `flex` lidas;
  - aresta e change-log na mesma transação (falha não grava pela metade);
  - aresta de anúncio encerrado preservada;
  - isolamento entre 2 clientes.
- **Teste novo `teste-pedido-linha.mjs`:**
  - pedido real de 1 linha (7124 c, tarifa 846 c, envio e depósito preservados);
  - pacote de 3 pedidos com 1 envio;
  - recoleta idempotente;
  - linha `cancelled` não apagada pelo DELETE do dia;
  - **invariante Σ linhas = série** (receita ± 1 c por linha, unidades exatas);
  - cupom e reembolso com Σ exato;
  - dia com falha não marca `linhas`.
- **`scripts/conferir-grafo.mjs`** (readonly, `{ readonly: true }`, sem cópia do banco): por cliente, anúncios → pools → produtos; Σ ingênua × contada uma vez; pools divergentes; candidatos a kit; invariante das linhas.
- **Pronto quando:**
  - o conferidor mostra a invariante batendo em 3 clientes;
  - a prévia do plano semanal (`scripts/previa-plano-semana.mjs`) sai **idêntica** (nenhum número mudou);
  - o tempo da coleta foi medido com o payload maior.

### F2: grafo em sombra
- **Teste novo `teste-produto-estoque.mjs`:**
  - junções (UP, `inventory_id`, SKU oficial, catálogo);
  - trava de conflito; `seller_custom_field` só sugere; recusa separa; manual vence;
  - chave determinística (entrada embaralhada → mesma saída);
  - Full × próprio = 2 pools e 2 EFs no mesmo produto;
  - precedência do estoque: `/stock` > Full inventário > anúncio só quando não ambíguo > `null`;
  - divergente → `divergente_ml`;
  - modos `um_pool`/`espelho_provavel`/`dividido`;
  - exemplo E = 100, vendas 56 + 84 em 28 d → cobertura 20 e ponto 140 nos dois;
  - com `ligado = false`, `i.cobertura` inalterada.
- **Teste novo `teste-produto-rotas.mjs`:** isolamento; prospect 400; prévia não grava; `confirmar === true` grava; `por` inválido 403; mensagens sem eco.
- **`teste-shell-ui.mjs`:** aba Produtos, nenhum primário novo, tabelas ≤ 6 colunas, ids do inventário, cor só por token.
- **Pronto quando:**
  - o consultor confere os grupos de **Uniaodog, Rotec e 01Smart** na aba e corrige pela gaveta;
  - o conferidor mostra a ordem «28.410 contra 85.703» nos SKUs repetidos;
  - o plano está idêntico com a chave desligada.

### F3: diagnóstico por produto ligado (Algoritmo v1.7.0)
- **Ampliações de teste:**
  - `teste-plano-anuncios`: 1 `estoque_ruptura` por EF; id estável quando o representante troca; EF de 1 anúncio com id da v1.6.0 (zero churn); entidade `produto`; causa `enviar_full` sem «comprar»;
  - `teste-compras-previsao`: 1 linha por produto; capital uma vez; Full + próprio somados para comprar; declarado vence com validade; vencido ignorado com motivo;
  - `teste-gatilhos` e `teste-alerta-impacto`: 1 linha «(N anúncios, mesmo estoque)»; `gatilho_avisado.familia` = chave do produto;
  - `teste-plano-semana-texto`: texto por produto e premissa nova;
  - `teste-full`: dois anúncios Full no mesmo UP com 30 un → `estoque_total` 30;
  - `teste-retroalimentacao`, `teste-custo-vinculo` (SKU de `meli_anuncio_up` resolve prazo e custo sem `promo_anuncio`), `teste-diagnostico-conta-rev` (DEFINICOES e `data_quality`), `teste-chaveiro-nucleo` (`estoque_dividido` por causa; `sku_ausente` assistido), teste da metodologia (prior e prova das regras novas);
  - isolamento: o mesmo UP em 2 clientes nunca se junta.
- **Pronto quando:**
  - nenhum cliente recebe 2 linhas de compra do mesmo estoque;
  - a prévia do plano semanal sai na mesma ordem e com menos linhas;
  - § 10.7 da metodologia e `CLAUDE.md` estão atualizados.

### F4: financeiro
- **Teste novo `teste-lucro.mjs`:**
  - `ratearPorReceita(109,04 / 91,60 / 129,74; 815)` → Σ = 815 e o resto na maior linha;
  - tarifa × q (por unidade: 670 → 1340);
  - `null` propaga (sem frete, custo ou tarifa → lucro `null`, nunca 0);
  - sem imposto → rótulo «antes do imposto»;
  - margem sobre a receita coberta; cobertura 0,5 → «parcial»;
  - kit com custo Σ;
  - pós-Ads na janela de `meli_ads_item`;
  - `economiaReal` (preço mínimo, desconto máximo, `cruza_faixa_frete`);
  - `conciliarTarifa` (votos, indeterminado);
  - DRE (cancelados e reembolsos em linhas próprias; Ads «—» com a tabela vazia; mês com dias faltando = «parcial»).
- **Teste novo `teste-financeiro-coleta.mjs`:** teto de fretes; `pendente` na falha; cancelados marcados; recoleta sem duplicar.
- **`teste-plano-anuncios`:** plano idêntico com `margem_medida_nas_regras = false`; com `true`, `margem_negativa` nasce como `fato` só com cobertura ≥ 0,8.
- **`teste-semanal-dados` / `teste-relatorio-seguro`:** bloco de lucro só com custo e cobertura.
- **Pronto quando:**
  - a receita do financeiro bate com o GMV;
  - cobertura de frete ≥ 80% em 3 clientes;
  - o piloto Uniaodog tem margem real depois da reconciliação dos nomes de custo (`custos-db.js:376` + vínculo manual);
  - a chave de regras é ligada por decisão registrada, depois de mostrar o antes × depois do plano de 3 clientes.

### F5: duplicação e kits
- **Testes:**
  - regra 1b não nasce com o EF em ruptura (`omitidas.estoque_nao_comporta`);
  - cobertura projetada E 40, v 4, extra 1 → 8 dias;
  - teto da previsão; `depende_de`;
  - `alocarEstoque(40, v 3/1)` → 30/10; `alocarEstoque(3, 4 pools)` → Σ 3, sem negativo; Full excluído;
  - `validarProposta` recusa `'estoque_acima_do_fisico'`;
  - quantidade proposta pelo UP esperado;
  - conferência rotula mesmo UP / UP novo;
  - `acharFilhos` acha o filho pelo produto com título diferente;
  - Kit Virtual q = 2 com 5 vendidos → +10 un na velocidade do componente e nenhuma ação de ruptura do kit;
  - `montado_na_hora` não soma; `pre_montado` soma equivalente; sem modo = recusa;
  - anúncio com 3 variações em 3 UPs → 3 pools.
- **Arquivos atualizados:** `teste-duplicacao.mjs`, `teste-ofertas-ml.mjs`.
- **Pronto quando:** 1 duplicação real (quando o Ofertas for ligado) foi conferida com o UP lido no dia seguinte.

### F6: escrita de estoque (só com decisão)
- **Teste novo `teste-chaveiro-estoque.mjs`** (API falsa):
  - alvo = físico − segurança, limitado ao máximo; piso só de alocação; nunca acima do físico;
  - recusas: Full; Flex; `paused_by_seller`; irmão alinhado; físico > 24 h; multi-depósito;
  - payload por modo de conta (`PUT /items` × `seller_warehouse` + `x-version`);
  - hash; sem `confirmar` não chama a API;
  - 409 → relê sem reenviar; releitura divergente → `'divergente'` sem envio;
  - 2xx ≠ executada; conferência em todos os irmãos;
  - nenhuma reversão automática;
  - change-log com fonte `'chaveiro'`.
- **Teste novo `teste-chaveiro-db.mjs`:** transições válidas e inválidas; `chave_idem`; `exec_evento` só acrescenta.
- **Pronto quando:** 1 alocação real foi conferida em todos os irmãos e registrada em `docs/manual-integracao-ml.md`, incluindo o comportamento do PUT em conta multiorigem MLB.

### F7: opcional
- **`teste-estoque-upseller.mjs`:** headers; credencial cifrada; sem credencial → `pendente` com o que falta; corpo fora do formato → NOT_VERIFIED, nunca número inventado; nunca escreve.
- **`teste-billing.mjs`:** 403 → `NOT_AUTHORIZED`; conciliação CV com tolerância declarada promove ou rebaixa a premissa.

---

## 10. Riscos, premissas, NOT_VERIFIED e perguntas

### 10.1 Premissas rotuladas (aparecem no texto e em `premissas[]`; nunca viram fato)

- Modo `espelho_provavel`: o mesmo número em 2+ estoques próprios = o mesmo físico espelhado. Modo `dividido`: números diferentes = físico dividido. É heurística (um ERP com atraso imita o «dividido»), por isso o texto PERGUNTA.
- `sale_fee` por unidade: 2 de 2 observações, e a votação com `listing_prices` decide antes do billing.
- Rateio do frete do pacote pela receita da linha.
- Venda atribuída ao local pela logística do anúncio quando o depósito da linha não resolve.
- Demanda do Kit Virtual no EF do componente do mesmo local.
- Lead time de 21 d e segurança de 7 d onde o prazo não foi informado (já existentes).
- Estoque declarado vale 7 dias (24 h para escrever).
- Faixa de frete grátis de R$ 79 (limite público).
- Custo vigente aplicado a vendas passadas.
- Competência do DRE = dia da venda.
- Estoque próprio = «informado no ML pelo vendedor».

### 10.2 NOT_VERIFIED (nenhum número de F0–F3 depende disto sem rótulo)

1. Formato do `/items/bulk` (doc: `status_code`) e se aceita `bundle`: 1 GET antes da F0.
2. Se a duplicata com atributos iguais cai no UP existente: verificado no dia seguinte, nunca suposto.
3. Formato do `node_id` de venda saída do Full (atribuição por local).
4. Se a busca `order.status=cancelled` devolve todos os cancelados (doc ambígua).
5. `/post-purchase/v2/claims/search`, usado hoje e não documentado (devoluções).
6. Quem financia o cupom (`funding_mode`).
7. PUT de estoque em conta multiorigem MLB; Flex `selling_address` em MLB: só F6, com teste controlado.
8. Rate limits (~100 RPM em user-products, só WebSearch; orders).
9. Idade do estoque Full; `estimated_handling_limit` (`null` no envio lido).
10. Campos do corpo e da resposta da API do UpSeller (só em imagem); saldo de estoque no Bling/Tiny.
11. Cobertura de UP em contas além do Uniaodog: 40/40 na amostra, não medido nas outras. O conferidor da F1 mede.

### 10.3 NOT_COLLECTED / NOT_AUTHORIZED / NEEDS_EXTERNAL_DATA

- **Billing:** NOT_AUTHORIZED (403, falta a permissão «Faturamento»). Sem ele não há DRE fechado nem custo fixo, Ads ou armazenagem por mês.
- **Devoluções e custo logístico da devolução:** NOT_COLLECTED.
- **Ads por dia:** `meli_ads_dia` com 0 linhas; investigar `coletarAdsDia` antes de prometer Ads mensal.
- **Estoque fora do ML e pedidos já feitos ao fornecedor:** NEEDS_EXTERNAL_DATA, salvo declaração ou adaptador.
- **Custo do produto:** 22 SKUs em 1 cliente. **Imposto:** `custos_cliente` com 0 linhas.
- **Multicanal** (Shopee, Amazon, TikTok): NOT_SUPPORTED. `meli_anuncio_up` não tem coluna canal (ponytail: entra com o 2º canal).

### 10.4 Riscos do próprio desenho e mitigação

| Risco | Mitigação |
|---|---|
| F0 atrasar e a coleta gravar 0 anúncios depois de 25/10 | F0 isolada e pequena, antes de tudo; erro quando N ids voltam 0 corpos; teste de varredura |
| Trocar `i.cobertura` muda o significado em toda tela | Sombra (chave `diagnostico_ligado`) + conferência de 3 clientes. A cobertura nova é a correta (o EF acaba para todos os irmãos ao mesmo tempo); `cobertura_anuncio` fica disponível; DEFINICOES e rótulos dizem «do produto». Teste que fixava número de anúncio de um grupo passa a documentar o número certo |
| Junção errada (SKU reaproveitado, catálogo) conta estoque de menos e gera ruptura falsa | Só SELLER_SKU oficial agrupa; trava de conflito SKU × catálogo; recusa gravada; sombra; chip «agrupado pelo SKU/catálogo» na tela |
| Churn de ids de ação | A chave do EF/produto é determinística; EF de 1 anúncio mantém o id de hoje; mudança de SKU ou vínculo torna a ação obsoleta pelo fluxo normal de `salvarAcoesAnuncio`, e decisão humana nunca é sobrescrita |
| Kit no modo errado dobra ou esconde estoque | Modo obrigatório; nada automático por título |
| Financeiro parcial em conta de alto volume (teto de fretes) | Cobertura % declarada; número só com ≥ 80%; o resto é lido nos dias seguintes |
| Payload maior no multiget | Mesmo número de chamadas; tempo medido na F1 |
| Escrita de estoque vender a mais | Só F6, só com físico declarado ≤ 24 h, Σ ≤ físico − segurança, releitura ao vivo, doador primeiro, sem reversão ao snapshot, estreia com 1 produto |
| Disco | Testes em memória; conferidor readonly; nunca copiar `data/db.sqlite` |

### 10.5 Regras do projeto, conferidas uma a uma

- **Um motor só:** `produto-estoque.js`, `lucro.js` e `economiaReal` são puros e chamados de `carregarBase`. Regras novas em `config/algoritmo.json` com prior, teto e prova, pelo construtor comum e pelo fator. Telas e textos são projeções.
- **Ausente = null:** chave, estoque ambíguo, tarifa, frete, custo e Ads ausentes nunca viram zero.
- **Nunca «causa confirmada»:** duplicação, kits e estoque dividido são hipótese, medidos como associação com controle.
- **Isolamento** por cliente em toda consulta e chave; prospect fora (`ehProspecto`).
- **SQL** parametrizado com lista fechada; erros sem eco.
- **Escrita no ML** só pelo Chaveiro e só na F6 com decisão. **Notion** em dry-run.
- **UI:** nenhum primário novo, ≤ 6 colunas, tokens só em `ui.css`.

### 10.6 Perguntas ao David (só as que mudam o desenho)

1. **Escrita de estoque (F6):** o sistema pode um dia escrever a DIVISÃO do estoque físico declarado entre os anúncios (`ml_estoque · alocar`)? Isso revoga a decisão registrada «Estoque nunca é escrito». **Recomendação:** decidir depois de F3–F5 rodarem 30 dias. Se não, a F6 sai do roteiro e a V3 fica em «detecta, cobra e sugere a divisão».
2. **Permissão «Faturamento» (leitura) no app do ML da Place2u + reautorizar 1 cliente (Uniaodog)?** Destrava a conciliação da tarifa e o DRE com Ads, custo fixo e armazenagem do Full. Sem ela, o financeiro para na margem de contribuição dos pedidos pagos.
3. **Juntar automaticamente** anúncios em UPs diferentes pelo SELLER_SKU oficial e pelo mesmo catálogo (padrão UpSeller, com trava de conflito e validado em sombra), **ou só sugerir** e o consultor junta? **Recomendação:** automático. «Só sugerir» deixa os 171 SKUs multi-UP sem tratamento até alguém clicar.
4. **Pergunta ao cliente sobre estoque espelhado:** só produtos curva A/B (proposta; até 2 por cliente por plano) ou todo produto espelhado?


---

## Decisões do David (14/10/2026, ~20h)

1. **Agrupamento automático:** juntar sozinho pelas chaves do ML (user_product_id > inventory_id > SKU oficial > catálogo), com vínculo manual/recusa vencendo; validar em sombra (F2) em Uniaodog, Rotec e 01Smart antes de ligar a F3.
2. **Permissão «Faturamento»:** SIM — o David liga a permissão (leitura) no painel de desenvolvedor do ML e reautoriza a Uniaodog para testarmos a fatura (F4/F7).
3. **Pergunta ao cliente sobre estoque espelhado:** só produtos de curva A/B, no máximo 2 por cliente por plano.
4. **Escrita de estoque (F6):** decidir depois — desligada; reavaliar após 30 dias com F3–F5 rodando só em leitura.

## Decisões do David (15/10/2026, ~00h40) — rumo ERP

5. **Sincronismo de estoque como o UpSeller: construir AGORA (revoga o «decidir depois» da F6).** O sistema passa a ESCREVER estoque nos anúncios do ML a partir do estoque único por produto (estoque de segurança, trava «nunca vender sem estoque», conferência após a escrita, nasce desligado por cliente, liga só com aprovação; Full continua só leitura).
6. **Nota fiscal: via provedor fiscal (Focus NFe / NFe.io ou similar) PRIMEIRO, e emissão nativa na SEFAZ como adaptador posterior** — a montagem da nota a partir do pedido é única; o emissor é plugável.
7. **Organizar estoque e financeiro + relatórios eficientes** (estoque por produto/local, compras, DRE, lucro por produto, exportação) fazem parte do escopo da V3.

## Pedido do David (15/10/2026, ~01h) — Foco 80/20 por janela
«No final, o Merovíngio em 15, 30, 45, 60 e 90 dias consegue decidir o que é o 80/20 da conta — o que gera resultado e o que não gera — e não faz sentido manter o foco em algo que não faz sentido.» → camada de decisão de FOCO sobre a medição (produtos, anúncios, famílias de ação, canais de esforço): a cada janela, o que entra/sai do foco, com evidência (degrau N0–N4), probabilidade e o custo de oportunidade; desenho em docs/desenho-merovingio-foco-8020.md.

## Pedido do David (15/10/2026, ~01h15) — plano «sem consultor e sem analista»
Depois dos desenhos ERP (docs/desenho-v3-erp.md) e Foco 80/20 (docs/desenho-merovingio-foco-8020.md): plano de como o Place Sprints + Merovíngio + Chaveiro operam a conta inteira sem consultor e sem analista — o que cada papel faz hoje (mapa real das tarefas do Notion por tipo), o que o sistema já faz, o que falta construir (executores, escrita no ML, conteúdo com IA, atendimento, régua com o cliente), o que é insubstituível (decisão humana onde há risco), por fases com critério de pronto e métrica de autonomia (% das tarefas sem humano). Arquivo: docs/plano-autonomia-total.md.
