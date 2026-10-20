# V3 — rumo ERP: sincronismo de estoque (F6), nota fiscal (F8) e estoque/financeiro/relatórios (F9), tudo pelo Merovíngio

**Data:** 15/10/2026. **Estado:** desenho para decisão. Nada implementado. Só leitura no projeto; nenhuma escrita no ML.

**Pedido do David (15/10, ~00h40):** «Gostaria que o sincronismo fosse similar ao UpSeller e conseguíssemos organizar estoque, financeiro e emitir relatórios eficientes e até mesmo emitir nota fiscal.» Decisões já registradas no fim de `docs/desenho-v3-produto-estoque-financeiro.md` (linhas 1247–1251): **5** escrever estoque AGORA (revoga «decidir depois»); **6** NF-e via provedor fiscal primeiro, nativo SEFAZ como adaptador depois; **7** estoque/financeiro/relatórios entram no escopo da V3.

**Orientação do David (15/10, ~01h):** «Pegue o melhor do UpSeller e transborde para o Place Sprints pensando no Merovíngio: previsibilidade, probabilidade e causalidade.» Este desenho aplica isso em cada frente: toda função de ERP nasce respondendo **o que vai acontecer** (previsão), **com que chance** (probabilidade calibrada) e **o que a ação passada causou** (medição antes × depois com controle, degrau N0–N4, nunca «causa confirmada»).

**Base de código que isto estende** (conferida em 15/10, `sqlite3 -readonly`): `meli_anuncio_up` 654 linhas em 2 clientes; `meli_pedido_item` 168; `meli_up_estoque` 0; `meli_envio_custo` 0 com custo lido; `custos_cliente` 0; **não existem** `exec_*`, `kit_componente`, `produto_regra_estoque`. Do Chaveiro só há a classificação (`src/lib/chaveiro.js:17` `classificarCaminho`, `:48` `cobertura`; `src/rotas-chaveiro.js:17` `GET /api/cliente/execucao`). As fases F0–F5 do desenho anterior continuam como pré-requisito e não são repetidas aqui.

## Princípios (os de sempre, mais três do Merovíngio)

1. **Um motor só.** ERP não é um segundo cérebro: estoque, nota e financeiro **alimentam** `carregarBase` (`src/lib/diagnostico-conta.js`), geram ação pelas regras de `config/algoritmo.json` (prior + KPI + prova), executam pelo Chaveiro e voltam como fator pela retroalimentação (`src/lib/retroalimentacao.js:121` `veredito`, `src/lib/calibracao.js:23` `priorEfetivo`).
2. **Previsibilidade embutida.** Nenhum número de ERP sai «seco»: o sync usa a cobertura **prevista** do produto (`src/lib/compras-previsao.js:20` `preverCompras` já calcula conservador/base por 30/60/90 d com tendência e data comercial); a segurança é em **dias de proteção × velocidade prevista**; o DRE do mês corrente ganha projeção com faixa; a nota alimenta a previsão de caixa.
3. **Probabilidade calibrada.** Toda recomendação carrega `p` com fonte: prior declarado em `priors_efeito` + encolhimento bayesiano (k = 5) e limite inferior de Wilson (`src/lib/impacto-tarefas.js:325`). Relatório mostra faixa e confiança; nunca número sem premissa.
4. **Causalidade medida, nunca afirmada.** Cada escrita (sync, compra, nota, preço) vira **marco** (`src/lib/impacto-tarefas.js:546` `medirMarco`) com controle pareado e degrau N0–N4 (`docs/desenho-causalidade-executor.md` § 4). Texto: «associação, não prova de causa».
5. **Honestidade.** Ausente = `null`; integração sem credencial = `pendente` com o que falta; imposto nunca inferido; dinheiro em centavos; cada endpoint sem chamada real = `NOT_VERIFIED`.
6. **Escrita só pelo Chaveiro:** lista fechada, `confirmar === true`, snapshot + releitura ao vivo + conferência, política por cliente que nasce `propor`, chave global que nasce desligada, estreia supervisionada em 1 produto/1 nota.
7. **Isolamento por cliente, SQL parametrizado, erro sem eco, UI ≤ 6 colunas e 1 primário por tela.**

---

## A) F6 — Sincronismo de estoque (escrita no ML pelo Chaveiro)

### A.1 O que o UpSeller faz × o que o Merovíngio acrescenta

| UpSeller (pesquisa-upseller.md § 1.3) | Place Sprints F6 |
|---|---|
| Sync em uma direção (armazém → loja), disparado por entrada/saída/reserva | Mesma direção: **fonte física → ML**. Disparo por **tick de 10 min** + evento de pedido pago (coleta) + declaração nova. Sem fila por movimento (não temos armazém) |
| Estoque de segurança = número fixo (ou «limite de estoque baixo») | **Segurança = dias de proteção × velocidade prevista** (`vBase` de `preverCompras`), por produto, com piso em unidades. Muda sozinha quando a venda muda |
| «Quando estoque ≤ segurança, anúncio recebe 0» | **Avisa «vai zerar em N dias» ANTES** (gatilho de estoque já existe: `urgente.tipos` em `config/gatilhos.json`); escreve 0 só quando o físico − reservas chega a 0 de fato |
| Quantidade mínima / faixas com fórmula («mínimo 2, estoque real 0, a loja recebe 2») | **Não copiado.** É venda sem estoque por desenho. Único piso: 1 un por pool quando `alvo ≥ nº pools` (rateio, não inflação) |
| Quantidade máxima por anúncio | Copiado (`maximo_por_anuncio`): serve a «não mostrar 400 un de um produto de nicho» |
| Full fora da sync; saída manual ao mandar ao Full | Full fora da escrita (API não permite). A saída ao Full vira **movimentação** `envio_full` no razão da F9, nunca manual «por lembrete» |
| Falha de sync listada (autorização, limite) | Igual, mais: **cada escrita é ordem com hash, releitura e conferência**; 2xx ≠ feito |
| Nada mede se a sync melhorou algo | **Marco medido:** sync ligado → cancelamentos por «sem estoque», dias em `paused/out_of_stock` e vendas protegidas, antes × depois contra produtos do mesmo cliente sem sync (N2) ou com holdout escalonado (N3) |

### A.2 Fonte do estoque físico (nunca o `available_quantity` do ML)

Precedência por produto (`of_variante.estoque` + `estoque_fonte` + `estoque_em`, colunas da F3 do desenho anterior § 1.6; `of_variante` já tem `estoque`, conferido em `PRAGMA table_info`):

| Fonte (`estoque_fonte`) | Validade p/ escrever | Como entra |
|---|---|---|
| `razao` (F9: razão de movimentações do Place Sprints) | sempre que a última conferência física ≤ 30 d | `saldoRazao(produto, local='proprio')` (§ C.2) |
| `upseller` / `bling` / `tiny` (saldo lido do ERP) | ≤ 24 h | adaptador só-leitura (desenho anterior § 7.4; Bling/Tiny hoje leem só custo — `src/lib/erp-bling.js:43`, `erp-tiny.js:38` — saldo é NOT_VERIFIED) |
| `cliente` / `equipe` (declaração) | ≤ 24 h | `POST /api/cliente/produtos/estoque-fisico` (F3) |
| `planilha` (webhook HMAC, molde `src/lib/custos-webhook.js:192`) | ≤ 24 h | coluna «estoque» no mesmo lote de custos |

Regra dura: **sem fonte válida, o produto não é escrito** (`pendente: 'estoque_fisico'`), e a tela diz o que falta. O `available_quantity` do ML é só **leitura de conferência**, nunca entrada.

### A.3 Dedução entre sincronizações (o «armazém» que não temos)

Entre duas leituras da fonte, as vendas pagas já estão nas linhas da F1 (`meli_pedido_item`, gravadas em `src/lib/meli-serie.js` na mesma transação da série). Então:

```
fisico_agora(P) = saldo_fonte(P) − Σ quantidade das linhas 'paid' de TODOS os anúncios de P com dia/hora ≥ estoque_em, local = proprio
                  (+ Σ linhas 'cancelled' no mesmo intervalo, só se o pedido foi cancelado antes do despacho — NOT_VERIFIED: ver A.9)
```

- O ML já desconta sozinho em cada pool; o que o Place Sprints faz é **realocar** o físico entre pools próprios do produto (Σ = físico − segurança). Nunca sincroniza «para cima» além do físico.
- Linhas chegam com a coleta (4–6 h). Entre coletas, o ML desconta em cada pool e o total mostrado só **cai**: por construção não vende a mais do que foi alocado. É o que torna a alocação segura mesmo sem webhook.
- Venda saída do Full não deduz do próprio (`deposito_store`/`deposito_node` da linha; formato do node Full NOT_VERIFIED → fallback pela logística do anúncio, declarado).

### A.4 Regras por cliente/produto (`produto_regra_estoque`, DDL em § E.1)

```
seguranca_un(P)     = max(piso_un, ceil(dias_protecao × vBase_P))      ; dias_protecao padrão 2 (premissa: intervalo entre coletas + folga), por cliente/produto
alvo_total(P)       = max(0, fisico_agora(P) − seguranca_un(P))
q_p                 = alocarEstoque(alvo_total, pools próprios de P por velocidade), cada q_p ≤ maximo_por_anuncio  (src/lib/produto-estoque.js § 6 do desenho anterior)
Σ q_p = alvo_total  ; Full fora ; Flex selling_address fora (NOT_VERIFIED em MLB) ; kit virtual nunca escrito (o ML calcula) ; kit montado na hora = floor(q_componente ÷ q)
```

- `nao_escrever = 1` tira o produto; `'*'` vale para a conta.
- **Não existe «mínimo» nem «faixa com fórmula»** (A.1).
- Catálogo + clássico no mesmo UP = **1 escrita** (o ML replica; 253 de 254 grupos com estoque idêntico na base). Variações = 1 pool por variação (`variations[].available_quantity`).

**Previsão que acompanha cada escrita (Merovíngio):** `cobertura_prevista_dias = alvo_total ÷ vBase_P`, com faixa (conservador = `vCons`). Se `cobertura_prevista < lead + seg`, a ordem sai com a etiqueta «vai zerar em ~N dias (faixa N₁–N₂): compra sugerida X un até dd/mm» — a mesma linha de `preverCompras.quanto_pedir` e o mesmo 📦 do plano semanal (`src/lib/plano-semana-texto.js:301`).

**Probabilidade:** `p_ruptura(7|14|21 d)` por produto = P(demanda na janela > físico − reservas) com demanda ~ Poisson superdisperso ajustado nos 28 d (a mesma superdispersão de `confiancaEfeito`, `impacto-tarefas.js:267`); calibrada depois contra o realizado (`calibracao.js:43` `compararPrevisaoRealizado` já faz Brier por regra). Nasce como premissa rotulada «calibração em andamento» até ≥ 30 produtos-janela medidos.

### A.5 Endpoints verificados (curl em `developers.mercadolivre.com.br/pt_br/estoque-distribuido`, 15/10)

| Operação | Endpoint | Status |
|---|---|---|
| Conta **sem** multiorigem | `PUT /items/{id} {available_quantity}`; o ML «sincronizará automaticamente o estoque de todos os itens associados ao mesmo user_product_id» | **doc** (texto literal da página) |
| Conta **com** `warehouse_management` | `PUT /user-products/{UP}/stock/type/seller_warehouse` com header `x-version` (long, vem no `GET …/stock`); corpo `locations[{type:'seller_warehouse', network_node_id, store_id, quantity}]` (formato do GET; o corpo do PUT segue o mesmo nó — **NOT_VERIFIED** se a chave é `locations` ou `stock`) | **doc** |
| `x-version` ausente → **400**; desatualizado → **409** → reler o GET e repetir | — | **doc** |
| Full (`meli_facility`) | «só pode ser incrementado enviando produtos aos depósitos de Full pelo painel» | **doc** = nunca por API |
| Flex `selling_address` independente | «Stock distribuído (aplica a MLA e MLC)»; demais sites: «não têm a possibilidade de atualizar o estoque de Flex de forma independente» | **doc** = **fora em MLB** |
| 409 `item optimistic locking error` no `PUT /items` | esperar e repetir | **doc** (api-ml-verificada.md § 4) |
| Rate limit de `/user-products/*/stock` | página «Rate limit / Erro 429» existe no índice, sem número em texto | **NOT_VERIFIED** → manter ≤ 1 chamada/s (`lerEstoqueUps` já usa `pausaMs = 1000`, `produto-estoque-real.js:205`) e o retry de `chamar()` (`meli-api.js:18-21`: 429/5xx, 3 tentativas, backoff 1,5 s × 2ⁿ) |
| Tag `warehouse_management` em `/users/{id}` decide o caminho | — | **real** (desenho anterior § 2.4) — ler AO VIVO antes de cada ordem |
| `PUT /items` em conta multiorigem devolve 200 sem efeito | WebSearch/doc ES | **NOT_VERIFIED em MLB** → 200 ≠ feito, sempre conferir |

### A.6 Fluxo de uma ordem `ml_estoque · alocar`

1. **Elegibilidade** (pura, `chaveiro.js`): cliente com `integracaoMlAtiva` (`src/lib/integracao-ml.js`), não prospect, política ≥ `executar_com_aprovacao`, `adaptadores_live_json.ml_estoque = 1`, chave global ligada, produto sem `nao_escrever`, nenhum irmão `paused_by_seller` nem `alinhado()` (`src/lib/alinhamentos.js`), fonte física válida.
2. **Snapshot** (`GET /user-products/{UP}/stock` + `x-version` + bulk dos irmãos) e **cálculo** (A.4). Ordem gravada em `exec_ordem` (`preparada`), com `payload_json` = {UP, store_id, node, quantidade esperada por pool} e `hash`.
3. **Aprovação** (`POST /api/chaveiro/aprovar`, líder) — automática só no nível `executar_e_avisar` depois de 10 ordens conferidas sem divergência (D11).
4. **Releitura ao vivo** imediatamente antes do PUT. Se `lido ≠ snapshot − vendas desde o snapshot` (orders/search `date_created ≥ snapshot` dos anúncios do UP) → `divergente`, nada enviado: alguém mexeu no painel; o sistema não sobrescreve mudança humana.
5. **Escrita**: primeiro os pools que **diminuem**, releitura, depois os que aumentam com o alvo recalculado. 1 PUT por pool; `x-version` fresco; 409 → reler e recomeçar (máx. 2); nunca reenvio às cegas. Timeout 30 s.
6. **Conferência** ≥ 5 min (replicação assíncrona do UP) em **todos** os irmãos: lido = esperado → `executada` + `meli_item_mudanca` fonte `'chaveiro'` + `livro-registro`; senão `em_conferencia` (3× → `falhou`, texto fixo «o canal não confirmou: conferir no painel»).
7. **Sem «reverter ao snapshot»**: reinflaria o que foi vendido no meio. «Desfazer» = ordem nova a partir do físico atual (refina a D9 do desenho do Chaveiro). Declarado na tela.
8. **Marco** (`medirMarco(cliente, item, data, { tipo: 'sync_estoque' })`) por irmão, e **episódio** por produto: KPI = dias em `out_of_stock` nos 28 d seguintes, cancelamentos com motivo de estoque, unidades vendidas vs irmãos/produtos controle.

### A.7 Política e estreia

- Nasce **desligada por cliente** (`exec_politica.nivel = 'propor'`, `adaptadores_live_json.ml_estoque = 0`) e global (`sync_estado.chaveiro_ligado = '0'`).
- Liga só com **aprovação do líder + cliente informado** (texto fixo pelo relatório/gatilho existente, auditado por `relatorio-seguro.js`): «passamos a ajustar o estoque dos seus anúncios a partir do estoque que você informa».
- **Estreia supervisionada:** `max_ordens_dia = 1`, 1 produto de 1 cliente (Uniaodog, curva B, 2 pools próprios), David acompanha; só depois `max_ordens_dia` sobe.
- **Kill switch:** `POST /api/chaveiro/chave {ligado:false}` desliga o tick no 1º `if`; ordens `na_fila`/`executando` viram `cancelada` com motivo; nada em voo é reenviado. Também por cliente (`nivel = 'observar'`).
- **Idempotência:** `chave_idem = cliente|produto|pool|alvo|versao_fonte` (UNIQUE); o mesmo alvo nunca gera duas ordens; recoleta não duplica.
- **Log por escrita:** `exec_evento` append-only com `de/para/por/detalhe_json` (status HTTP, `x-version` enviado/recebido, lido antes/depois), sem token.

### A.8 Falhas

| Falha | Tratamento |
|---|---|
| 429 | retry de `chamar()` (3×, backoff); persistindo → ordem `falhou:'limite'`, próxima tentativa no tick seguinte, teto diário intacto |
| 400 (sem `x-version`, corpo) | `falhou:'payload'`, nunca reenvia; alerta interno (`notificacoes`) |
| 401/403 | `falhou:'permissao_do_app'` + pendência de reconexão (fluxo existente) |
| 409 | reler GET, recalcular, 1 nova tentativa; depois `divergente` |
| 5xx/rede | retry; depois `incerto` → conferência decide |
| 200 sem efeito (multiorigem) | conferência → `divergente`, registra em `docs/manual-integracao-ml.md` |
| Token caiu no meio | `recuperarPlanosPresos` (molde promoções) para `executando` > 10 min |

### A.9 NOT_VERIFIED desta frente
1. Chave do corpo do `PUT …/seller_warehouse` (`locations` × `stock`).
2. `PUT /items` em conta multiorigem MLB (200 sem efeito?).
3. Rate limit de `user-products` (número).
4. Se a busca `order.status=cancelled` devolve tudo e se o cancelamento antes do despacho devolve estoque ao pool (afeta A.3).
5. Saldo de estoque via Bling/Tiny/UpSeller (campos).
6. Multi-depósito (`lojas > 1`): ordem recusada («distribuir no painel») até haver caso real.

---

## B) F8 — Nota fiscal

### B.1 O que o UpSeller faz × o que o Merovíngio acrescenta

| UpSeller | Place Sprints F8 |
|---|---|
| NF-e automática ao pedido; dedução de estoque na NF (opção) | NF-e automática **ou com aprovação**, por cliente; a dedução de estoque continua sendo do ML (A.3) e do razão (C.2) — a nota não deduz |
| Crítica externa: «não configura CSOSN automaticamente, ST mal tratado» | **Não inferimos imposto.** Regras fiscais **declaradas pelo contador do cliente por produto** (NCM, CFOP por operação, CST/CSOSN, ST, alíquotas) — sem regra, sem nota, com pendência nominal |
| Emissor próprio (SEFAZ) | **Emissor plugável:** provedor fiscal via API primeiro; adaptador nativo SEFAZ depois, mesma montagem |
| Nada liga nota a resultado | **Marco:** nota automática → tempo até `ready_to_ship`, atrasos de despacho (`meli_conta_saude`), reputação; recebíveis por data prevista de liberação → previsão de caixa |

### B.2 Dados do pedido (ML) — verificado em 15/10 (`faturamento-billing-info`, `anexar-nota-fiscal`)

| Dado | Fonte | Status |
|---|---|---|
| Comprador (nome/razão, CPF/CNPJ, IE, endereço fiscal) | `GET /orders/{id}` → `buyer.billing_info.id` → **`GET /orders/billing-info/{site_id}/{billing_info_id}`**. O legado `/orders/{id}/billing_info` «foi depreciado» e «retorna 404» | **doc** (FAQ oficial). **Escopo/permissão: NOT_VERIFIED** — a página lista «Faturamento / Billing info» entre as permissões funcionais; testar com 1 GET real no Uniaodog; 403 → pendência `permissao_do_app:billing_info` |
| Campos podem vir nulos (doc fiscal `PROCESSING`, regras locais) | mesma doc | tratar `null`, nunca inventar |
| Endereço de entrega ≠ endereço fiscal | `GET /shipments/{id}` | **doc**: duas fontes, não equivalentes |
| Itens, quantidade, preço unitário, SKU, variação | `meli_pedido_item` (F1) + `GET /orders/{id}` para os campos não gravados (descontos, parcelas) | **real** |
| Pagamento (NT 2025.001, obrigatória desde 01/09/2025): meio, `cAut`, `tBand`, CNPJ da credenciadora para cartão; PIX sem esses | `payments[]` do pedido | **doc** (página de anexar NF); mapeamento `payment_type`/`issuer` → `tBand` **NOT_VERIFIED** (tabela da NT) |
| Frete na nota (`vFrete`, modalidade) | `GET /shipments/{id}/costs` (`senders[].cost`) + regra do contador (quem paga) | **real** para o custo; a modalidade é regra declarada |
| Envio da nota ao ML | **`POST /packs/{pack_id}/fiscal_documents`** multipart (`fiscal_document` XML ≤ 1 MB, 1 arquivo por pacote; XML só → ML gera o DANFE; PDF + XML para DANFE próprio); `pack_id` nulo → usar `order_id` no mesmo recurso; `GET`/`DELETE …/fiscal_documents[/{id}]` | **doc** (curl literal na página) |
| Envios drop_off / cross_docking / xd_drop_off que exigem NF para liberar a etiqueta | **`/shipments/{shipment_id}/invoice_data`** | **doc** (citado; formato do corpo **NOT_VERIFIED**) |
| Erros do upload | 403 (não é o vendedor), 400 (formato/tamanho), 409 (já existe arquivo do tipo) | **doc** |
| Devolução/cancelamento | cancelamento até 24 h pela SEFAZ via provedor; depois NF-e de devolução/entrada (CFOP de devolução) — **regra do contador**; claims por `/post-purchase/v1/claims` (o v2 usado hoje é NOT_VERIFIED) | parcial |

### B.3 Modelo: montagem única, emissor plugável

`src/lib/nf-montar.js` (**puro**): `montarNota({ pedido, linhas, billing, envio, pagamentos, regrasProduto, regimeCliente, cfg }) → { nota, pendencias[] }`.

- `regimeCliente` (`nf_regime`): `simples` (CSOSN, sem destaque de ICMS; CRT 1) | `normal` (CST, ICMS/PIS/COFINS por regra; CRT 3) | `mei` (sem NF-e de venda em regra — pendência «confirmar com o contador»).
- `regrasProduto` (`nf_regra_produto`): NCM, CEST, origem, CFOP dentro/fora do estado, CST/CSOSN, alíquotas e ST **como o contador declarou**, com vigência e `por`. Produto sem regra → `pendencias: ['regra_fiscal:<sku>']`, nota não nasce.
- Totais em centavos; `nItem`, `cProd` = SKU, `xProd` = nome do produto (não o título do anúncio), `vUnCom`, `vDesc` (cupom só se `funding_mode` = vendedor — NOT_VERIFIED → desconto do vendedor fica pendente de verificação), `vFrete` por regra, grupo `<card>`/PIX pela NT 2025.001.
- Saída canônica = JSON da nota (`nf_nota.corpo_json`), que cada adaptador traduz.

**Adaptadores (`src/lib/nf-emissor-*.js`, interface injetável):** `emitir(nota) → { ref, estado }`, `consultar(ref)`, `cancelar(ref, justificativa)`, `cartaCorrecao(ref, texto)`, `danfe(ref) → pdf`, `xml(ref)`, `webhook(payload) → evento`.

| Provedor (só fontes públicas, 15/10) | Preço (site) | API / homologação / certificado / DANFE / eventos | Avaliação |
|---|---|---|---|
| **Focus NFe** (`focusnfe.com.br/precos`, `/doc`) | Solo R$ 94,90/mês (1 CNPJ, 100 docs, R$ 0,11 extra); Start R$ 119,90 (3 CNPJs + R$ 39,90/CNPJ, 100 docs/CNPJ); Growth R$ 572 (CNPJs ilimitados, 4.000 docs, R$ 0,125 extra); 30 dias de teste | REST JSON com `ref` idempotente por nota; ambiente de homologação separado; **certificado A1 enviado ao provedor** (fica lá); DANFE PDF/HTML + etiqueta; cancelamento, carta de correção, inutilização; **webhooks** de autorização/erro; NFe/NFCe/NFSe/CTe | **1ª escolha**: preço por CNPJ compatível com multi-cliente da assessoria (Start/Growth), doc pública completa, webhooks |
| **NFE.io** (`nfe.io/precos`, `/docs`) | Inicial R$ 1.345/ano… (preços anuais; mensal visível só até 100–1.000 notas/mês; «Integração por API» a partir do plano Base) | REST; certificado configurável; webhooks; foco NFS-e + NF-e produto | 2ª opção; a cobrança por volume de notas por conta (não por CNPJ) encarece com muitos clientes pequenos |
| **eNotas** (`enotas.com.br/precos`) | plano «emissor» ligado à Hotmart; 1 CNPJ por assinatura | automação para produtor digital | **Fora**: nicho de infoproduto, 1 CNPJ por assinatura |
| **Nuvem Fiscal** | site e doc **não responderam** (curl 000) | — | **NOT_VERIFIED**; reavaliar com navegador |

Decisão: adaptador 1 = **Focus NFe** (plano Start ou Growth em nome da Place2u, 1 CNPJ por cliente — ou conta do próprio cliente; pergunta P3). Adaptador 2 = **nativo SEFAZ** (XML 4.00, assinatura XML-DSig com A1, SOAP por autorizador de UF, SVC-AN/SVC-RS em contingência, `NFeAutorizacao4`/`NFeRetAutorizacao4`, eventos 110111/110110, inutilização, consulta de cadastro, schemas XSD, certificado guardado cifrado **fora do banco** — `data/nf/certs/<cliente>.pfx.enc` com `src/lib/cripto.js:19` e senha só em memória). Esforço × risco: o nativo custa 4–6× o provedor (validação XSD, 27 UFs, contingência, NTs mensais) e o erro recai na Place2u; o provedor custa R$ 0,11/nota e absorve as NTs. Por isso a ordem decidida (decisão 6).

### B.4 Fluxo

```
pedido 'paid' (coleta) → candidata (nf_nota 'rascunho', com billing lido) → montarNota (regra fiscal do produto + regime)
   → política do cliente: 'aprovar' (líder/cliente aprova na tela) | 'automatica' (só depois de 20 notas aprovadas sem correção)
   → Chaveiro: ordem nf · emitir (confirmar===true, hash do corpo) → adaptador.emitir → 'enviada' → webhook/consulta → 'autorizada' (chave de 44 dígitos, protocolo, XML)
   → POST /packs/{pack_id}/fiscal_documents (XML; DANFE pelo ML) [ou /shipments/{id}/invoice_data quando a logística exige] → 'anexada_ml'
   → DANFE/etiqueta guardados em data/nf/<cliente>/<chave>.{xml,pdf} (hash no livro-registro)
   → marco: data da autorização × despacho (meli_conta_saude atrasos), reputação
rejeição SEFAZ (cStat ≠ 100) → 'rejeitada' com código + texto fixo da tabela; correção só por humano (regra ou dado), nunca «tentar outro CFOP»
cancelamento do pedido antes do despacho → cancelar (≤ 24 h) | depois → pendência «devolução: NF de entrada» (regra do contador)
```

- **Prazo:** o ML exige NF para liberar etiqueta em várias logísticas; a candidata nasce no tick seguinte ao pedido (≤ 10 min) e o SLA de emissão é medido (KPI).
- **Idempotência:** `ref = cliente|order_id|serie` (UNIQUE em `nf_nota`); `pack_id` com arquivo existente → 409 tratado como «já anexada» após conferir o id.
- **Previsão de caixa (Merovíngio):** cada nota autorizada liga o pedido a `recebivel` com data prevista de liberação do Mercado Pago (hoje **NOT_COLLECTED**: `payments[].date_released`/`money_release_date` precisam ser gravados — 1 campo a mais na F1, zero chamada); relatório «a receber por semana» com faixa (liberado × previsto × em disputa).

### B.5 O que o Place Sprints NÃO faz
- Não decide tributo: NCM, CFOP, CST/CSOSN, ST, alíquota, benefício fiscal, IE do comprador — **declarados** por produto/operação pelo contador do cliente (`nf_regra_produto.por`), com vigência. Sem regra, sem nota.
- Não «infere» regime, nem copia regra de um produto para outro, nem de um cliente para outro.
- Não emite sem certificado A1 válido do **cliente** (vencimento monitorado; 30 d antes vira pendência).
- Não guarda certificado nem senha no banco; não loga XML com dados do comprador fora de `data/nf/` (CPF mascarado em tela e no livro: só sha256).
- Não emite NFC-e, CT-e, MDF-e nem NFS-e na V3.
- Responsabilidade tributária é do cliente e do contador; o termo de uso (molde `config/termos-sprint90.md`) diz isso e o cliente aceita antes de ligar.

---

## C) F9 — Estoque e financeiro organizados + relatórios eficientes

### C.1 O que o UpSeller faz × o que o Merovíngio acrescenta

| Frente | UpSeller | Place Sprints F9 |
|---|---|---|
| Cadastro de produto | SPU/SKU, custo de compra, até 5 fornecedores com mínimo/múltiplo | SKU oficial do ML + custo (já: `custos-db.js:132` `aplicarLote`, manual/Bling/Tiny/planilha) + fornecedor, prazo (`lead_time_cliente`, `lead-time.js:7`), NCM/origem (`nf_regra_produto`) |
| Estoque por local, movimentações | entrada/saída/ajuste/contagem; Full fora | Razão por produto × local (`proprio`, `full`, `transito_full`): `compra`, `venda` (automática das linhas F1), `cancelamento`, `devolucao`, `ajuste`, `envio_full` (entrada no Full confirmada pela leitura de `/inventories/{id}/stock/fulfillment`), `contagem`. Cada movimento é fato ou declarado, nunca inferido |
| Estoque baixo | preparo × vendas/dia; alerta | **p_ruptura 7/14/21 d** por produto + «zera em ~N dias (faixa)»; já é o ponto de reposição v1.6.0, agora com probabilidade |
| Sugestão de compra | estoque + histórico + ciclo | `preverCompras` com **data e quantidade** (30/60/90 d, datas comerciais) + `p_evita_ruptura` da compra sugerida + custo/capital; vira **pedido ao fornecedor** com estado (sugerido → pedido → recebido → entrada no razão) |
| Lucro por pedido/loja (D-1); sem lucro por SKU/anúncio; sem DRE | — | Já na F4: lucro por **pedido, anúncio, produto** (`lucro.js:27/41`), DRE mensal (`lucro.js:148`, `lucro-real.js:117`) + **projeção do mês corrente** (ritmo + tendência, faixa) |
| Gestão financeira: caixa, contas a pagar/receber (tudo manual) | — | **Só o que vem do dado:** a receber = recebíveis do ML por data de liberação (B.4); a pagar = pedidos ao fornecedor em aberto (valor_pedido). **Sem** plano de contas, bancos, conciliação, boletos — isso é ERP demais e não move resultado do anúncio |
| Ads | «não gerencia» | Já coleta (`meli_ads_item`); DRE com Ads quando `meli_ads_dia` cobrir o mês (hoje 0 linhas: consertar `coletarAdsDia` é pré-requisito) |
| Relatórios | vendas, ABC, concorrentes; export Excel | DRE, estoque e cobertura, compras sugeridas, lucro por produto/anúncio, Ads — cada um com **previsão, p e marcos medidos**; CSV/PDF; e os blocos entram no relatório de terça |
| Medição | nenhuma | Cada compra, envio ao Full, ajuste de preço vira marco; vendas protegidas × irmãos sem compra (N2); fator por família volta ao plano |

### C.2 Razão de estoque (o que faltava para sincronizar com honestidade)

`estoque_mov` (§ E.1): append-only, 1 linha por movimento, `origem ∈ {linha_pedido, compra, cancelamento, devolucao, ajuste, envio_full, contagem, erp}`, `ref` UNIQUE por origem (idempotente). `saldoRazao(produto, local) = Σ quantidade (com sinal)`; `conferido_em` = última `contagem`/declaração. Vendas entram sozinhas da F1 (`meli_pedido_item` → `−quantidade` no local do depósito da linha). Divergência entre razão e ML (`/stock`) > tolerância → `estoque_divergente` (regra nova), nunca «corrigir» sozinho.

### C.3 Compras com estado

`compra_fornecedor`: `sugerida` (gerada de `preverCompras`, 1 por produto, com `p_evita_ruptura`) → `pedida` (humano: fornecedor, quantidade, data prevista, valor) → `recebida` (quantidade real, data) → entrada no razão (`compra`). A sugestão traz: «pedir até dd/mm · X–Y un · R$ · chance de evitar ruptura p (prior 0,7 da casa, calibrado)». Marco: `vendas protegidas` = unidades vendidas nos 28 d após a chegada × contra produtos pareados sem compra.

### C.4 Financeiro: o que vale e o que é ERP demais

**Vale (dado real, move decisão):** lucro por pedido/anúncio/produto (F4); DRE mensal + projeção; recebíveis por data (B.4); a pagar de compras em aberto; capital em estoque por local (uma vez por EF); margem pós-Ads por anúncio.
**ERP demais (fora):** contas bancárias, conciliação de extrato, boletos, centro de custo, folha, DRE contábil, fluxo de caixa com despesas fixas. Motivo: exige lançamento manual (o próprio UpSeller é «tudo manual» aí), não alimenta regra do plano, e vira segundo motor de verdade sem dado.
**Imposto:** `custos_cliente.custos_json.imposto_pct` (`db.js:198`, `diagnostico-conta.js:51`) continua **informado**; com a F8 ligada, o imposto da nota (Σ `vICMS`+`vPIS`+`vCOFINS` do regime normal, ou DAS informado no Simples) passa a ser **medido** no DRE da nota, rotulado «segundo as regras declaradas pelo contador».

### C.5 Relatórios (projeções puras; export CSV da mesma função; PDF pelo Chrome de `relatorio-pdf.js:84`)

| Relatório | Linhas | Previsão | Probabilidade | Causalidade |
|---|---|---|---|---|
| **DRE mensal** (`GET /api/cliente/dre`) | as 10 linhas atuais + `(−) Impostos medidos (NF)` + `(−) Ads` quando coletado | **mês corrente:** faixa conservador–base = ritmo dos dias fechados × dias restantes × tendência; nunca extrapola dias sem linhas | confiança = cobertura % (tarifa/frete/custo) | marcos do mês (preço/promoção) com efeito em **lucro** por produto, não só receita |
| **Estoque e cobertura por produto** | produto · estoque (próprio/Full) · vende/dia · cobertura · p_ruptura 14 d · situação | «zera em ~N dias (faixa)» | p 7/14/21 d, calibrada | sync ligado: dias sem estoque antes × depois |
| **Compras sugeridas** | produto · pedir até · quanto (cons–base) · R$ · p_evita_ruptura · estado | 30/60/90 d + datas comerciais | p por produto | compra no prazo → vendas protegidas (N2) |
| **Lucro por produto/anúncio** (visão Lucro da aba Produtos) | receita · taxas+frete · custo · lucro · margem (cobertura) | tendência 14/28 d | — | veredito por tarefa já existente, agora em R$ de lucro |
| **Ads** | custo · receita · ACOS · margem pós-Ads · ROAS de equilíbrio real | — | p da regra ads_* | marcos de verba |
| **Relatório de terça** (`plano-semana-texto.js`, `gatilhos-real.dadosRelatorio`) | ganha os blocos «estoque sincronizado», «notas emitidas/pendentes», «lucro do mês até agora (faixa)», «compras sugeridas» — opcionais por perfil (`config/perfil-informacao.json`) | idem | idem | «o que medimos das ações de 14 d atrás» |

Tudo passa por `relatorio-seguro.js` (degrau em linguagem simples; sem id interno; sem «causa»).

---

## D) O que NÃO copiar do UpSeller e como as duas coisas se juntam na mesma tela

**Não copiar (e por quê):**
1. **Mínimo e faixas com fórmula** — vendem sem estoque por desenho (o próprio artigo deles avisa).
2. **Segurança que zera o anúncio** — pausa derruba relevância e vira confundidor do Merovíngio; aqui a segurança protege e avisa antes.
3. **Sync em tempo real por movimento** — exige armazém; sem razão de estoque vende a mais (exemplo numérico no desenho anterior § 7.2). Tick + alocação do físico declarado basta e é auditável.
4. **Custo médio do armazém como verdade** — não vemos todas as entradas; vale o custo informado com vigência e fonte (`custos-db.js`).
5. **Gestão financeira por lançamento manual** — não alimenta regra; é trabalho sem resultado medido.
6. **Inferência de imposto/CSOSN** — responsabilidade do contador; declarado ou pendente.
7. **Copiador de anúncios, migração em massa, duplicação sem objetivo** — contra `config/duplicacao.json`.
8. **Limite de syncs por plano como produto** — nosso teto é por segurança (ordens/dia), não por cobrança.

**O que o Place Sprints faz e o UpSeller não:** diagnóstico com regra e evidência; previsão com faixa e premissa; p calibrada; executor com conferência; medição antes × depois com controle e degrau; aprendizado que corrige o prior; texto ao cliente com política de tom.

**Na mesma tela (aba `/cliente › Produtos`, já existente em `src/web/produtos.js`):** cada linha de produto responde às três perguntas — coluna **Previsão** («zera em ~9 d (7–12)»), coluna **Chance** («ruptura 14 d: 62%»), chip **Medido** («sync +3 d sem ruptura, N2») — e as ações (sincronizar, comprar, emitir nota) saem do **mesmo plano** (`acoes_plano`) pelo Chaveiro. O UpSeller mostra o saldo; o Merovíngio mostra o que o saldo vai virar e o que a última ação fez.

---

## E) Modelo de dados, rotas, telas, testes, fases, riscos e perguntas

### E.1 DDL aditiva (`src/lib/erp-schema.js`, importado por `db.js` ao lado de `SCHEMA_PRODUTO`; listas fechadas em CHECK; PK começa por `cliente`; dinheiro em centavos)

```sql
-- Chaveiro (do desenho do executor § 2, agora construído): exec_politica, exec_ordem, exec_evento, exec_experimento — com 'ml_estoque' e 'nf' no CHECK de adaptador
-- e a operação 'alocar' | 'emitir' | 'cancelar' | 'anexar_ml'. (DDL literal em docs/desenho-causalidade-executor.md § 2; não repetido.)

CREATE TABLE IF NOT EXISTS produto_regra_estoque (            -- F6: regras por cliente/produto; '*' = conta toda
  cliente TEXT NOT NULL, produto TEXT NOT NULL,
  dias_protecao REAL NOT NULL DEFAULT 2 CHECK (dias_protecao BETWEEN 0 AND 60),      -- segurança = dias × vBase (premissa 2 d)
  piso_un INTEGER NOT NULL DEFAULT 0 CHECK (piso_un BETWEEN 0 AND 100000),
  maximo_por_anuncio INTEGER CHECK (maximo_por_anuncio BETWEEN 1 AND 100000),
  nao_escrever INTEGER NOT NULL DEFAULT 0 CHECK (nao_escrever IN (0,1)),
  por TEXT NOT NULL, em TEXT NOT NULL, PRIMARY KEY (cliente, produto));

CREATE TABLE IF NOT EXISTS estoque_mov (                      -- F9: razão append-only (TRIGGER barra UPDATE/DELETE, molde registro_cliente)
  cliente TEXT NOT NULL, id INTEGER PRIMARY KEY AUTOINCREMENT, produto TEXT NOT NULL,
  local TEXT NOT NULL CHECK (local IN ('proprio','full','transito_full')),
  origem TEXT NOT NULL CHECK (origem IN ('linha_pedido','compra','cancelamento','devolucao','ajuste','envio_full','contagem','erp')),
  ref TEXT NOT NULL,                                          -- order_id|item|var · compra_id · 'cont:<data>' …
  quantidade INTEGER NOT NULL CHECK (quantidade <> 0),        -- com sinal
  custo_unit_c INTEGER,                                       -- só em compra/entrada; NULL = sem custo
  fato_em TEXT NOT NULL, por TEXT NOT NULL DEFAULT 'sistema', registrado_em TEXT NOT NULL,
  UNIQUE (cliente, origem, ref));
CREATE INDEX IF NOT EXISTS ix_estoque_mov_prod ON estoque_mov (cliente, produto, local);

CREATE TABLE IF NOT EXISTS compra_fornecedor (                -- F9
  cliente TEXT NOT NULL, id TEXT NOT NULL, produto TEXT NOT NULL, fornecedor TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('sugerida','pedida','recebida','cancelada')),
  qtd_sugerida_cons INTEGER, qtd_sugerida_base INTEGER, p_evita_ruptura REAL, pedir_ate TEXT NOT NULL DEFAULT '',
  qtd_pedida INTEGER, valor_c INTEGER, prevista_em TEXT NOT NULL DEFAULT '', qtd_recebida INTEGER, recebida_em TEXT NOT NULL DEFAULT '',
  por TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, PRIMARY KEY (cliente, id));

CREATE TABLE IF NOT EXISTS nf_regime (                        -- F8: declarado pelo contador
  cliente TEXT PRIMARY KEY, regime TEXT NOT NULL CHECK (regime IN ('simples','normal','mei')),
  crt INTEGER NOT NULL CHECK (crt IN (1,2,3)), serie INTEGER NOT NULL DEFAULT 1, proximo_numero INTEGER NOT NULL DEFAULT 1,
  uf TEXT NOT NULL, ie TEXT NOT NULL DEFAULT '', emissor TEXT NOT NULL DEFAULT 'focus' CHECK (emissor IN ('focus','nfeio','sefaz')),
  politica TEXT NOT NULL DEFAULT 'aprovar' CHECK (politica IN ('desligada','aprovar','automatica')),
  cert_arquivo TEXT NOT NULL DEFAULT '',                      -- caminho em data/nf/certs/ (cifrado); senha nunca no banco
  cert_valido_ate TEXT NOT NULL DEFAULT '', por TEXT NOT NULL, em TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS nf_regra_produto (                 -- F8: por produto (SKU) × operação; sem linha = sem nota
  cliente TEXT NOT NULL, produto TEXT NOT NULL, operacao TEXT NOT NULL CHECK (operacao IN ('venda_dentro_uf','venda_fora_uf','devolucao')),
  ncm TEXT NOT NULL, cest TEXT NOT NULL DEFAULT '', origem INTEGER NOT NULL CHECK (origem BETWEEN 0 AND 8), cfop TEXT NOT NULL,
  cst_csosn TEXT NOT NULL, icms_pct REAL, st INTEGER NOT NULL DEFAULT 0 CHECK (st IN (0,1)), pis_cst TEXT NOT NULL DEFAULT '', cofins_cst TEXT NOT NULL DEFAULT '',
  unidade TEXT NOT NULL DEFAULT 'UN', vigente_de TEXT NOT NULL, por TEXT NOT NULL, em TEXT NOT NULL, PRIMARY KEY (cliente, produto, operacao, vigente_de));

CREATE TABLE IF NOT EXISTS nf_nota (                          -- F8
  cliente TEXT NOT NULL, ref TEXT NOT NULL,                   -- cliente|order_id|serie
  order_id TEXT NOT NULL, pack_id TEXT NOT NULL DEFAULT '', envio_id TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('rascunho','pendente','aguardando_aprovacao','aprovada','enviada','autorizada','rejeitada','anexada_ml','cancelada','denegada','falhou')),
  emissor TEXT NOT NULL, numero INTEGER, serie INTEGER, chave TEXT NOT NULL DEFAULT '', protocolo TEXT NOT NULL DEFAULT '',
  corpo_json TEXT NOT NULL DEFAULT '{}',                      -- nota canônica (dados do comprador só aqui; CPF mascarado em qualquer projeção)
  total_c INTEGER, imposto_c INTEGER, hash TEXT NOT NULL DEFAULT '',
  xml_arquivo TEXT NOT NULL DEFAULT '', danfe_arquivo TEXT NOT NULL DEFAULT '',
  erro TEXT NOT NULL DEFAULT '', autorizada_em TEXT NOT NULL DEFAULT '', anexada_em TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, PRIMARY KEY (cliente, ref));
CREATE TABLE IF NOT EXISTS nf_evento (                        -- append-only
  id INTEGER PRIMARY KEY AUTOINCREMENT, cliente TEXT NOT NULL, ref TEXT NOT NULL, de TEXT NOT NULL, para TEXT NOT NULL,
  por TEXT NOT NULL DEFAULT 'sistema', detalhe_json TEXT NOT NULL DEFAULT '{}', em TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS recebivel (                        -- F8/F9: previsão de caixa (só ML)
  cliente TEXT NOT NULL, order_id TEXT NOT NULL, valor_c INTEGER NOT NULL, previsto_em TEXT NOT NULL DEFAULT '', liberado_em TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL CHECK (estado IN ('previsto','liberado','disputa','estornado')), lido_em TEXT NOT NULL, PRIMARY KEY (cliente, order_id));
-- colunas novas por laço PRAGMA (db.js): meli_pedido_item.liberacao_prevista TEXT DEFAULT '' (payments[].money_release_date — NOT_VERIFIED o nome); sync_estado: chaveiro_ligado
```

**`config/algoritmo.json` → v1.8.0 (regras novas, todas com prior, KPI, prova, teto):**

| Regra | Dispara | Caminho (`config/chaveiro.json`) | KPI / prova | Prior `p_sucesso` |
|---|---|---|---|---|
| `estoque_sincronizar` | produto com fonte válida, 2+ pools próprios, `Σ mostrado ≠ alvo` além da tolerância, ou cobertura prevista < lead+seg com pool inflado | `automatico · ml_estoque · alocar` (política) | dias sem estoque 28 d; cancelamentos «sem estoque»; vendas protegidas | 0,6 (premissa) |
| `estoque_divergente` | razão × `/stock` divergem > 10% ou 5 un | `cliente · pendencia` (contagem) | divergência zerada em 14 d | 0,5 |
| `compra_prazo` (substitui o 📦 solto) | `quando_pedir.dias ≤ ciclo` e p_ruptura 21 d ≥ 0,3 | `cliente · pendencia` → `compra_fornecedor` | sem ruptura até a chegada; vendas protegidas | 0,7 |
| `nf_pendente` | pedido pago sem nota autorizada em 24 h (política ≠ desligada) | `automatico · nf · emitir` ou `assistido` | SLA pedido→nota; despacho no prazo | 0,8 |
| `nf_regra_faltando` | venda de produto sem `nf_regra_produto` | `cliente · pendencia` (contador) | regra cadastrada | — |
| `lucro_produto_negativo` (F4 por produto) | margem medida ≤ 0 com cobertura ≥ 0,8 | `automatico · ml_item · preco` / assistido | lucro por produto 28 d | 0,5 |

Cada uma entra em `regras[]`, `priors_efeito`, `foco.max_por_regra` (sugestão 3/2/5/5/3/5) e `caminho_por_regra`; o aprendizado (`retroalimentacao.js`, `aprendizado.js:69` `medirResultados`) corrige o prior pelo realizado; `calibracao.js:43` compara previsto × realizado e dá o Brier.

### E.2 Rotas (prévia por padrão, `confirmar === true` grava, `por` validado, erro fixo)

| Rota | Fase |
|---|---|
| `GET /api/cliente/estoque?cliente=` → produtos com saldo razão/ML, p_ruptura, previsão, marcos | F9 |
| `POST /api/cliente/estoque/mov { cliente, produto, local, origem, quantidade, custo_unit_c?, fato_em, por, confirmar }` (ajuste/contagem/envio_full/compra) | F9 |
| `GET/POST /api/cliente/compras/pedidos` (sugeridas → pedida → recebida) | F9 |
| `POST /api/cliente/produtos/regra-estoque` | F6 |
| `POST /api/chaveiro/estoque/preparar { cliente }` · `/aprovar` · `/executar { confirmar }` · `GET /api/chaveiro/ordens` · `POST /api/chaveiro/politica` · `/chave` (as do desenho do executor § 6.2) | F6 |
| `GET /api/cliente/nf?cliente=&estado=` · `POST /api/cliente/nf/regime` · `/nf/regra-produto` · `/nf/certificado` (upload base64 ≤ 5 MB, magic bytes PKCS#12; senha só na requisição) · `/nf/aprovar { refs[], por }` · `/nf/cancelar { ref, justificativa, confirmar }` · `GET /api/cliente/nf/danfe?ref=` · `POST /api/nf/webhook/:emissor` (assinatura do provedor; sem ela, 401) | F8 |
| `GET /api/cliente/dre?mes=` (ganha `projecao` e `impostos_medidos`) · `GET /api/cliente/relatorios/:nome.csv` · `GET …/:nome.pdf` | F9 |

### E.3 Telas (≤ 6 colunas, 1 primário por tela, cor só por token em `ui.css`, ids no inventário)

- `/cliente › Produtos` (existente): visão **Estoque** ganha colunas Previsão · Chance · Medido (substituem «Pedir» e «Situação» → chip); folha do produto ganha blocos Razão (movimentos), Sync (ordens), Nota (por pedido). Secundárias: «Sincronizar (prévia)», «Registrar movimento».
- `/cliente › Financeiro` (aba nova, 1 primário = «Exportar»): DRE com projeção, Lucro por produto, A receber/a pagar, Ads.
- `/cliente › Notas` (aba nova, primário «Aprovar selecionadas»): Pedido · Comprador (mascarado) · Total · Estado · Emitida em · Anexo ML; gaveta «Regras fiscais» (regime, produtos sem regra, certificado e vencimento).
- `/cliente › Resumo › Execução do plano` (desenho do executor): ordens de estoque e de nota aparecem ali, sem tela nova.
- `/planos`: coluna «Caminho» já prevista.

### E.4 Testes (`scripts/teste-*.mjs`, `PS_DB_MEMORIA=1`, API falsa injetada, nunca `data/db.sqlite`)

- `teste-chaveiro-db.mjs`, `teste-chaveiro-estoque.mjs` (lista do desenho anterior § F6 + segurança em dias × vBase; «zera em N dias» antes do 0; sem fonte válida não escreve; 400/409/429 tratados; 200 ≠ feito; kill switch cancela fila; idempotência).
- `teste-estoque-razao.mjs` (append-only, saldo, venda automática das linhas, cancelamento, divergência → regra, isolamento).
- `teste-compras-pedido.mjs` (estados, p_evita_ruptura com prior, entrada no razão ao receber).
- `teste-nf-montar.mjs` (Simples × normal; produto sem regra → pendência; NT 2025.001 cartão/PIX; frete por regra; totais em centavos; CPF mascarado nas projeções; `ref` idempotente).
- `teste-nf-emissor.mjs` (stub Focus: emitir/consultar/cancelar/webhook; rejeição cStat; anexo ML 409 tratado; sem certificado = `pendente`).
- `teste-lucro.mjs` (+ projeção do mês, impostos medidos), `teste-relatorios-export.mjs` (CSV = mesma função da tela).
- `teste-plano-anuncios.mjs` (plano idêntico com chaves desligadas; regras novas com prior/KPI; `metodologia` lê o config).
- `teste-impacto.mjs` (marco `sync_estoque`/`compra`/`nf` com controle pareado; degrau máximo N2 sem experimento).

### E.5 Fases publicáveis e critério de pronto (todas depois de F0–F5; suíte inteira verde; docs atualizados)

| Fase | Entrega | Escrita externa | Pronto quando |
|---|---|---|---|
| **F9a** razão + compras + relatórios | `estoque_mov`, `compra_fornecedor`, relatórios com previsão/p/marco, CSV/PDF, blocos do relatório de terça (opt-in por perfil), regras `estoque_divergente`/`compra_prazo` | nenhuma | 3 clientes com razão batendo o `/stock` (±10%); Brier da p_ruptura calculado em ≥ 30 produtos-janela; prévia do plano semanal sem número inesperado |
| **F6** sync de estoque | `exec_*`, `ml_estoque · alocar`, `produto_regra_estoque`, política, kill switch, marco | **ML (estoque)** | 1 alocação real conferida em todos os irmãos (Uniaodog), comportamento do PUT multiorigem registrado em `docs/manual-integracao-ml.md`; 10 ordens sem divergência antes de subir o teto |
| **F8a** nota com aprovação (Focus, homologação) | montagem, regime/regras/certificado, adaptador Focus, anexo ML, DANFE, telas | provedor (homologação) + ML (anexo) | 20 notas em homologação sem rejeição de montagem; 1 nota real aprovada manualmente e anexada ao pacote; SLA medido |
| **F8b** nota automática + caixa | política `automatica` por cliente após 20 aprovadas sem correção; `recebivel`; marco despacho/reputação | provedor (produção) | 30 d sem rejeição; previsão de caixa com erro ≤ 10% em 4 semanas |
| **F8c** adaptador nativo SEFAZ | XML/assinatura/SOAP/contingência atrás da mesma interface | SEFAZ (homologação) | 100 notas em homologação idênticas às do provedor (diff do XML) |
| **F9b** financeiro medido | impostos da NF no DRE, lucro por produto nas regras (`margem_medida_nas_regras` + `lucro_produto_negativo`), Ads por dia consertado | nenhuma | plano antes × depois conferido em 3 clientes; billing (permissão «Faturamento», decisão 2) conciliado ≤ 1% |

### E.6 Riscos

| Risco | Mitigação |
|---|---|
| Vender sem estoque por alocação errada | fonte válida ≤ 24 h, dedução pelas linhas, segurança em dias × vBase, Σ ≤ físico, releitura ao vivo, doador primeiro, estreia 1 produto |
| 200 sem efeito / replicação lenta | conferência em todos os irmãos; `incerto` → `falhou`; nunca reenvio cego |
| Nota com imposto errado | nenhuma inferência; regra do contador por produto com vigência; homologação 20 notas; política `aprovar` antes de `automatica`; termo aceito |
| Vazamento de dado do comprador | `corpo_json` só em `nf_nota`; projeções mascaram CPF; XML fora do banco; livro só com hash |
| Certificado A1 | fora do banco, cifrado, senha em memória; vencimento vira pendência 30 d antes |
| Provedor fora do ar | ordem `incerto`, fila, SLA medido; adaptador 2 (SEFAZ) como contingência futura |
| Marcos em lote matando a medição | 1 intervenção por produto por janela (D8); holdout escalonado só com ≥ 4 produtos elegíveis |
| p calibrada que ninguém calibrou | rótulo «calibração em andamento» até n ≥ 30; Brier na tela de metodologia |
| ERP demais | lista explícita do que fica fora (C.4); nada manual que não alimente regra |

### E.7 NOT_VERIFIED consolidado
Corpo do PUT `seller_warehouse`; `PUT /items` multiorigem MLB; rate limit user-products; cancelados na busca e devolução de estoque ao pool; permissão/escopo de `/orders/billing-info/{site}/{id}`; corpo de `/shipments/{id}/invoice_data`; tabela `tBand`/`cAut` × `payments[]`; `money_release_date` no payment; Nuvem Fiscal (site fora); campos de saldo em Bling/Tiny/UpSeller; `funding_mode` do cupom.

### E.8 Perguntas ao David (só as que mudam o desenho)

1. **Responsável tributário e termo:** o cliente aceita por escrito que NCM/CFOP/CST/alíquotas são declarados pelo contador dele e que a Place2u só executa? (Sem isso a F8 fica em `aprovar` para sempre e sem `automatica`.)
2. **Regime dos clientes-piloto:** Uniaodog e mais 2 — Simples ou normal? UF? (Define se a V3 nasce só com CSOSN ou já com CST/ST.)
3. **Provedor fiscal e conta:** Focus NFe no plano Start/Growth em nome da Place2u (1 CNPJ por cliente, R$ 39,90/CNPJ extra) ou cada cliente contrata e nos dá o token? (Muda `nf_regime.emissor`, cobrança e quem guarda o certificado.)
4. **Segurança do sync:** 2 dias de proteção × velocidade prevista (padrão) com piso 0 — confirma, ou quer piso em unidades por cliente desde a estreia?

---

## RESUMO EXECUTIVO (para o David)

1. O pedido tem três partes: sincronizar estoque como o UpSeller, organizar estoque e financeiro com relatórios, e emitir nota fiscal. Este desenho diz como fazer as três **dentro do Place Sprints**, sem virar um segundo sistema.
2. A regra de ouro continua: um motor só. Estoque, nota e financeiro alimentam o diagnóstico, viram ação pelas regras, são executados pelo Chaveiro e medidos pelo Merovíngio.
3. A diferença para o UpSeller é que cada número responde três perguntas: o que vai acontecer (previsão com faixa), com que chance (probabilidade calibrada) e o que a ação passada fez (medição antes × depois com controle, sem nunca dizer «causa confirmada»).
4. **Sincronismo de estoque (F6):** o sistema passa a escrever o estoque nos anúncios do Mercado Livre a partir do estoque físico informado (cliente, planilha, ERP ou o razão novo). Nunca usa o número do próprio ML como fonte.
5. As vendas entre uma atualização e outra já estão nos pedidos que coletamos; o sistema desconta e divide o restante entre os anúncios do mesmo produto. A soma nunca passa do físico.
6. A segurança não é um número fixo: é «dias de proteção × venda prevista» por produto. O sistema avisa «vai zerar em N dias» antes de qualquer zero.
7. Não copiamos o «mínimo» nem as «faixas com fórmula» do UpSeller: eles vendem sem estoque por desenho. Full fica fora da escrita (a API não permite). Flex independente não existe no Brasil.
8. Toda escrita é uma ordem: leitura ao vivo antes, conferência depois em todos os anúncios irmãos, registro completo. Se alguém mexeu no painel no meio, não escrevemos.
9. Não há «desfazer para o número anterior» — isso devolveria estoque já vendido. Desfazer é calcular de novo a partir do físico atual.
10. Nasce desligado por cliente e no geral. Liga com aprovação do líder e cliente avisado. Estreia com 1 produto de 1 cliente, 1 ordem por dia. Há um botão que desliga tudo na hora.
11. Os endpoints do ML foram conferidos na documentação oficial: PUT no item para conta simples; PUT no `user-product` com `x-version` para conta multiorigem (400 sem versão, 409 se desatualizada). Três detalhes ficam marcados como não verificados até a primeira escrita real.
12. **Nota fiscal (F8):** a nota é montada a partir do pedido do ML (comprador pelo novo endpoint de billing-info — o antigo foi descontinuado; itens; pagamento com os dados exigidos desde 09/2025) e enviada ao ML pelo endpoint de documentos fiscais do pacote (XML até 1 MB; o ML gera o DANFE).
13. O emissor é plugável. Primeiro o provedor Focus NFe (R$ 94,90–119,90/mês por 1–3 CNPJs, R$ 0,11 por nota extra, 30 dias de teste, webhooks, homologação). Depois, se valer, o adaptador nativo na SEFAZ com a mesma montagem. NFE.io é a 2ª opção; eNotas não serve (nicho Hotmart); Nuvem Fiscal não respondeu.
14. O Place Sprints **não decide imposto**. NCM, CFOP, CST/CSOSN, ST e alíquotas são declarados pelo contador do cliente por produto. Sem regra, sem nota — vira pendência nominal. Certificado A1 fica cifrado fora do banco.
15. A nota começa com aprovação humana; só vira automática por cliente depois de 20 notas aprovadas sem correção. Cada nota é medida: tempo até o despacho e reputação.
16. **Estoque e financeiro (F9):** entra um razão de movimentos (compra, venda automática, ajuste, envio ao Full, contagem), compras com estado (sugerida → pedida → recebida) e relatórios: DRE mensal com projeção do mês, estoque e cobertura com chance de ruptura, compras sugeridas com data e chance de evitar a ruptura, lucro por produto e anúncio, Ads, tudo em CSV/PDF e nos blocos do relatório de terça.
17. Financeiro só com dado real: a receber (liberações do ML), a pagar (pedidos a fornecedor), lucro medido. Contas bancárias, conciliação e lançamentos manuais ficam fora — é ERP demais e não move o resultado do anúncio.
18. Seis regras novas entram no Algoritmo com prior e indicador (sincronizar, estoque divergente, compra no prazo, nota pendente, regra fiscal faltando, lucro negativo por produto), e o aprendizado corrige as previsões com o tempo.
19. Fases publicáveis, cada uma com critério de pronto: F9a (razão e relatórios, só leitura) → F6 (sync, estreia supervisionada) → F8a (nota com aprovação em homologação) → F8b (nota automática e previsão de caixa) → F8c (SEFAZ nativo) → F9b (financeiro medido nas regras).
20. Quatro decisões suas mudam o desenho: (1) termo de responsabilidade tributária com o cliente; (2) regime e UF dos 3 clientes-piloto; (3) Focus NFe em nome da Place2u ou conta do cliente; (4) segurança padrão de 2 dias × venda prevista.

---

## Decisões do David (15/10/2026, ~01h30)

1. **Responsabilidade tributária:** contador do cliente, com termo aceito pelo cliente; o Place Sprints só monta e emite. Sem regra cadastrada por produto, sem nota.
2. **Provedor fiscal:** uma conta da Place2u no Focus NFe (cobrada ao cliente como serviço); certificado A1 de cada cliente cadastrado nela, cifrado.
3. **Estoque de segurança padrão do sync:** 2 dias × venda prevista (ajustável por cliente/produto).
4. **Pilotos da nota fiscal:** o David indica depois (regime e UF); até lá, construir com cliente fictício de homologação.

## Pedido do David (15/10/2026, ~01h55) — relatórios obrigatórios da F9
Relatórios (cada um com Previsão / Chance / Medido, por produto e por conta, exportáveis e nos blocos do relatório de terça): **ciclo financeiro** (venda → liberação do ML → caixa; prazo médio de recebimento; a pagar de compras), **ciclo de compras** (sugestão → pedido → recebimento; prazo do fornecedor medido × declarado), **ciclo de estoque** (cobertura, giro, dias de estoque, ruptura e estoque parado por produto/local), **previsibilidade logística** (prazo de despacho/entrega, Full × próprio, atrasos previstos), **escalabilidade mediante as vendas** (quanto estoque/capital/Ads precisa para crescer X% sem ruptura; gargalo), **lucro** (por pedido/produto/anúncio/conta, DRE até margem de contribuição), **geração de caixa** (caixa gerado no mês = recebido − compras − Ads − taxas; projeção), **reinvestimento** (quanto do caixa gerado pode voltar para estoque/Ads por produto, com p de retorno — recomendação do Algoritmo, nunca ordem).

---

## F8a CONSTRUÍDA (15/10/2026) — nota fiscal com aprovação, emissor plugável, tudo DESLIGADO

**Chaves** (`config/nota-fiscal.json → nf`, todas `false` de fábrica): `ligado` (emissão, tick, certificado, webhook), `envio_ml_ligado` (anexo ao pacote do ML), `producao_ligada` (sem ela, todo cliente emite em homologação mesmo com `ambiente = producao`). Automática só com `politica = automatica` + 20 notas SEGUIDAS sem correção (`automatica_apos_notas_sem_correcao`) + termo aceito, conferido a cada emissão.

**Arquivos:** `src/lib/nota-fiscal.js` (PURO: `SCHEMA_NOTA`, `montarNota`, `lerCsvRegras`, `regraVigente`, `refDe`, `projecaoNota`, `automaticoLiberado`, `sinaisNota`, `recebiveisDeNotas`, textos fixos `BLOQUEIO`) · `src/lib/nota-fiscal-real.js` (fábrica `criarNotaFiscal` com banco/emissores/ML injetados + `compradorDoBilling`, `lerPedidosMl`, `anexarXmlMl`) · `src/lib/emissores/focus-nfe.js` (`criarFocus`, `paraFocus`) · `src/lib/emissores/sefaz-nativo.js` (interface + esqueleto que lança `NAO_IMPLEMENTADO`) · `src/rotas-nota-fiscal.js` · `src/web/nota-fiscal.js` (`/cliente › Configurar`: `#secNotaFiscal` e `#secNotas`) · `config/nota-fiscal.json`, `config/termo-fiscal.md` (rascunho `nf-v1` para o jurídico) · `scripts/teste-nota-fiscal.mjs` (19 casos). Montado em `src/server.js` (instância, webhook antes do parser, rotas, tick de 10 min), `src/lib/db.js` (`SCHEMA_NOTA`), `src/lib/guarda-local.js` (`/webhook/nf/focus` exato), `src/lib/sistemas.js` (`nf_pendente`/`nota_fiscal` = Chaveiro; `nf_regra_faltando`/`fiscal` = Smith).

**Tabelas (aditivas):** `cliente_fiscal` (CNPJ, razão, IE, UF, regime simples|normal|mei, série, ambiente, emissor, política, apelido no intermediador, `modalidade_frete` declarada, `cert_ref` = `focus:empresa:<id>` ou `arquivo:<.enc fora de data/>`, `cert_valido_ate`, `token_ref` = NOME da variável do .env, contador) · `termo_fiscal` (versão + sha256 do texto, aceito_por/aceito_em do cliente, registrado_por) · `regra_fiscal_produto` (cliente × SKU normalizado × operação dentro/fora da UF × vigência; NCM, CEST, origem, CFOP, CST/CSOSN, alíquotas, ST, PIS/COFINS, exclusão do ICMS da base declarada, contador) · `nota_fiscal` (1 por pacote; `corpo_json = { entrada, nota }` é o ÚNICO lugar com dado do comprador; hash do corpo; `corrigida`) · `nota_item` · `nota_evento` (append-only por TRIGGER; `UNIQUE(cliente, idem)` = webhook idempotente). Certificado e senha: nunca no banco nem em log — só passam pela requisição até o provedor.

**Montagem (o que NÃO monta vira bloqueio nominal, nunca palpite):** Simples só CSOSN 102/103/300/400; normal só CST 00 (BC = valor do item × alíquota declarada), 20 (redução declarada), 40/41/50; PIS/COFINS 04–09 sem valor, 01/02/49/99 = base × alíquota declarada (com/sem exclusão do ICMS declarada). Bloqueia: sem regra (por item), SKU ausente, regra incompleta/incoerente (CFOP 5/6 × operação, CST × regime), ST e CSOSN 101/201/202/203/500/900, DIFAL (normal + interestadual + consumidor final), MEI, comprador contribuinte (CNPJ com IE), comprador/billing incompleto, cupom (financiamento NOT_VERIFIED), frete cobrado do comprador (decisão do contador), frete/pagamento não lidos, forma de pagamento sem mapeamento, cartão sem cAut/bandeira/credenciadora, Σ pagamentos ≠ total, termo, certificado ausente/vencido, intermediador sem CNPJ (o config nasce vazio de propósito), modalidade do frete não declarada.

**Fluxo:** `meli_pedido_item` pago → rascunho (releitura automática quando o bloqueio é só de leitura do pedido) → aprovação (líder/consultor, hash) → emissão (hash conferido, `UPDATE … WHERE estado AND hash`, ambiente, token por nome) → retorno síncrono/consulta/webhook (transições fechadas em `TRANSICOES`; chave de 44 dígitos com o CNPJ do emitente; XML em `data/nf/<sha256(cliente)[:12]>/<chave>.xml`, modo 600) → anexo ML (`POST /packs/{pack_id|order_id}/fiscal_documents`, 409 = já anexada) → eventos. Rejeição = `rejeitada` + `corrigida`, correção só por humano (regra/dado → remontagem). `erro` + consulta 404 no provedor = volta a rascunho (nunca reenvio às cegas). Cancelamento (15–255 caracteres) e carta de correção (15–1000) com prévia, ambos contam como correção.

**Contrato HTTP:** cabeçalho de `src/rotas-nota-fiscal.js` (prévia por padrão, `confirmar === true`, `por` líder/consultor, 404 sem eco, 415 sem JSON).

**Regras do Algoritmo:** `nf_pendente` e `nf_regra_faltando` entraram em `config/algoritmo.json` com prior premissa, KPI, prova (`horas_ate_nota`, `skus_com_regra`) e teto 5/5, **`ativa: false`** — o sinal existe (`sinaisNota`), a ligação ao plano (`plano-anuncios.js`) e o caminho ficam para quando o outro agente liberar esses arquivos. Entrada pronta para `config/chaveiro.json → caminho_por_regra` (não aplicada: o arquivo estava sendo editado em 15/10 02h15):

```json
"nf_pendente": { "caminho": "automatico", "adaptador": "nf", "operacao": "emitir" },
"nf_regra_faltando": { "caminho": "cliente", "adaptador": "pendencia", "operacao": "registrar" }
```
(`nf` precisa entrar na lista fechada de adaptadores de `src/lib/chaveiro.js`; e o teste `teste-chaveiro-nucleo.mjs` conta os caminhos.)

**Recebíveis → previsão de caixa:** `recebiveisDeNotas(notas, { liberacoes, hoje })` / `nf.recebiveis(cliente, …)` por semana; sem `money_release_date` (NOT_COLLECTED) vai para «sem data», nunca uma data inventada. Consumo na F9.

**NOT_VERIFIED (F8a):** corpo do webhook da Focus = JSON do GET; status `denegado`; token da conta Place2u × token por empresa (por isso `token_ref`); emitente preenchido pelo cadastro da empresa na Focus quando só vai `cnpj_emitente`; município por nome + UF; limite 429 da Focus; formato do billing info novo (`compradorDoBilling` aceita o legado e o com `address`); permissão do app para `/orders/billing-info/MLB/{id}` (o app NÃO tem «Faturamento»); `payments[].authorization_code` como cAut; mapa `payment_type` → tPag (PIX 17 × 20) e `payment_method_id` → tBand; CNPJ do intermediador e da credenciadora (config vazio até o contador confirmar); `shipping_cost` como frete do comprador; `/shipments/{id}/invoice_data` (não implementado).

## F6 CONSTRUÍDA (15/10/2026) — chave `chaveiro.sync_estoque_ligado` DESLIGADA
Construída conforme § A (manual: `docs/manual-integracao-ml.md` § F6). Desvios: (1) fonte `razao` (F9) não existe ainda — fontes = declarado (cliente/equipe) + `erp`/`planilha` aceitos no CHECK, sem adaptador ligado; (2) sem piso em unidades (decisão 3: só dias × venda prevista); (3) a mudança aplicada NÃO vai a `meli_item_mudanca` com fonte `chaveiro` (o CHECK exigiria recriar a tabela grande no reinício; a coleta seguinte registra `estoque_zero` e `exec_evento` guarda cada escrita) — nem ao livro de registro; (4) a aprovação do líder e a execução são o MESMO POST `/executar` (o hash da ordem preparada amarra o que foi aprovado); (5) kit montado na hora não é escrito a partir do físico do componente (fica fora até o 1º caso real); (6) p_ruptura 7/14/21 d não implementada (previsão = «vai zerar em ~N dias» = físico ÷ venda prevista). Entradas da F8 aplicadas em `config/chaveiro.json` (`nf_pendente` automático · nf · emitir; `nf_regra_faltando` cliente · pendência) e `nf` na lista fechada de `chaveiro.js`.

## F9 CONSTRUÍDA (15/10/2026) — os 8 relatórios obrigatórios, só leitura, nada muda ao cliente

**Arquivos:** `src/lib/relatorios-ciclo.js` (PURO: `SCHEMA_ERP`, `montarRelatorio`, `saldoRazao`, `cel`/`chanceCel`, `paraCsv`, `paraHtml`, `blocosTerca`) · `src/lib/relatorios-ciclo-real.js` (`baseDoCliente` com cache de 2 min, `relatorioDoCliente`, `todosDoCliente`, `blocosTercaDoCliente`, `criarErp` = razão + pedidos ao fornecedor) · `src/rotas-relatorios-ciclo.js` (contrato HTTP no cabeçalho) · `src/web/relatorios-ciclo.js` (aba `/cliente › Relatórios`, `#secRelatoriosCiclo`, selo Morpheus) · `scripts/relatorios-ciclo.mjs` (gerador real readonly → memória) · `scripts/teste-relatorios-ciclo.mjs` (15 verificações). Montado em `src/server.js` e `src/lib/db.js` (`SCHEMA_ERP`) — vale no próximo reinício.

**Formato único:** cada relatório = seções (Conta, Por produto; o Lucro também Por anúncio e Por pedido) com a MESMA tabela de 6 colunas Item · Métrica · **Previsão** (Oráculo: faixa conservador–base = ritmo 28 d × tendência 14 ÷ 28 d limitada, a fórmula `ritmoPrevisto` da previsão de compras) · **Chance** (só `priorEfetivo(regra)` com n > 0; premissa nunca vira chance — «sem calibração ainda» com a premissa no motivo) · **Medido** (fato lido / Merovíngio) · Observação. Célula = `{ v, u, txt, motivo }`, dinheiro em centavos inteiros, ausente = «—» com motivo. CSV = a mesma função (BOM, «;», fórmula neutralizada); HTML de 1 página A4 no molde editorial; PDF pelo Chrome de `relatorio-pdf.js` (temporário apagado).

**Os 8 e as fórmulas:** (1) ciclo financeiro — vendas 28 d × previsão 30 d, líquido após tarifas/frete, prazo de recebimento e a receber por semana («—» sem `money_release_date`; recebíveis de notas quando houver), a pagar = pedidos «pedida»; (2) compras — sugestão do Oráculo por produto (só base > 0), valor só com custo em todos, estados de `compra_fornecedor`, prazo declarado × medido (pedida → recebida), atrasados; (3) estoque — estoque contado 1× (Full × próprio), dias de estoque, giro aproximado, sem estoque (previsto ≤ 14 d) × abaixo do corte de ruptura (predicado do plano), parado no Full, capital só com custo, razão por produto/local; (4) logística — unidades Full × próprio pelo depósito da linha (loja = próprio; só nó = Full, premissa), prazos de despacho/entrega «—» (datas não coletadas), taxa de atraso da reputação, atrasos previstos 7 d = pedidos próprios/dia × 7 × taxa; (5) escalabilidade — +10/+25/+50 %: compra = ritmo × (1+g) × (prazo + ciclo + segurança) − estoque, capital só com custo, Ads = crescimento ÷ (retorno × fator 0,5–0,7 de `ads_escalar`), gargalo prazo > estoque > caixa > Ads (o não avaliado vai nomeado); (6) lucro — DRE F4 linha a linha + receita do mês projetada + margem projetada (só com margem medida), lucro 28 d por conta/produto/anúncio/pedido; (7) caixa — vendas pagas − tarifas/frete/reembolsos − Ads do mês − compras do mês, por competência (recebido «—»), total só com tarifas/frete lidos em 100 % da receita do mês, Ads do mês só com `meli_ads_dia` cobrindo o mês, compra não registrada ≠ R$ 0; (8) reinvestimento — estoque (compra × custo; retorno = lucro/un medido × unidades) e Ads (+25 % da verba), ordem = retorno base × p da regra, «pode voltar» = mín(caixa gerado, opções com retorno conservador > 0), sempre «recomendação do Algoritmo, nunca ordem».

**Razão (`estoque_mov`):** append-only por TRIGGER; contagem = saldo absoluto do local (âncora, pode ser 0, 1 por produto/local/dia); compra/devolução/ajuste/envio ao Full = deltas (envio ao Full = −próprio +Full, premissa de entrada confirmada); venda NÃO é copiada — o saldo desconta as linhas pagas de `meli_pedido_item` depois da âncora (cancelada sai sozinha; venda sem depósito identificado não é descontada). Origem `linha_pedido` do desenho ficou fora do CHECK por isso. **Pedidos (`compra_fornecedor`):** sugerida → pedida → recebida | cancelada (`TRANSICOES_COMPRA`), coluna nova `pedida_em` (prazo medido); recebida grava a entrada `compra` no razão com custo unitário = valor ÷ quantidade pedida. Prévia por padrão, `confirmar === true`, `por` = `validarDossie`.

**Desvios do desenho:** regras `compra_prazo`/`lucro_produto_negativo` NÃO entraram (os relatórios são projeção; nenhuma decisão nova precisa delas agora); p_ruptura 7/14/21 d segue não implementada (Chance de ruptura = «sem calibração ainda»); blocos de terça prontos (`blocosTerca`, chave `algoritmo.relatorios_ciclo.blocos_terca_ligado = false`) mas NÃO ligados ao `plano-semana-texto.js` — com a chave desligada nem a base é calculada; ligar = chamar `blocosTercaDoCliente` em `gatilhos-real.dadosRelatorio` e renderizar no bloco do perfil (o texto ao cliente é fixado por hash em `teste-sistemas.mjs`).

**O que falta para os relatórios ficarem completos (vale para todo cliente):** custo dos produtos (lucro, capital, reinvestimento); frete por envio lido (`coletarFretes`, após o reinício) e linhas de pedido do mês inteiro (backfill F1); data de liberação por pedido (`payments[].money_release_date`, NOT_VERIFIED — permissão «Faturamento» / billing) para recebimento, a receber e caixa recebido; datas de despacho/entrega por envio (prazo logístico); Ads por dia (`coletarAdsDia`) para Ads do mês; pedidos ao fornecedor e contagens registrados; prazo do fornecedor informado.
