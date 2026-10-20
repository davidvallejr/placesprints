# Diagnóstico comercial completo — relatório estratégico para prospects que já vendem no ML

Fusão de três desenhos independentes (dados/API · conteúdo · fluxo comercial) feitos em 07/10/2026. **Aguarda 4 decisões do David** (marcadas ⚑); o texto assume a recomendação em cada uma.

## Contexto

Hoje o Comercial já tem o fluxo prospect → link assinado → OAuth → `coletarCliente(90d)` → relatório de 8 seções (`src/lib/diagnostico-comercial.js`, `render-diagnostico-comercial.js`) com PDF via Chrome headless (`server.js:142-157`). Ele sai "chulo" por quatro motivos verificados:

1. A coleta **descarta o que a API já devolve**: `/items` traz `pictures`, `health`, `original_price`, `condition`, `catalog_product_id` (`meli-api.js:203`) e `atualizarItens` grava só thumb + contagem de fotos (`meli-serie.js:31-47`); `category_id`/`attributes` nem são pedidos. Reputação é lida ao vivo e nunca gravada (`monitoramento-meli.js:81-92`). Visitas só para quem vendeu (`meli-serie.js:180-182`). Reviews/price_to_win só top 12.
2. **Prospect nunca é coletado de novo** (`listarConexoes` exclui `[Comercial]`, `meli-contas.js:46-50`) → não existe queda a detectar nem ação comercial.
3. Sem mercado (busca pública bloqueada — mas `/trends`, `/highlights`, `price_to_win`, `/products/{catalog}/items`, `listing_prices` funcionam com o token do próprio prospect e nunca foram usados aqui).
4. `dados_lidos` = "existe linha em `meli_serie_item`": conta sem pedido pago fica "Conectado, sem dados" para sempre (os 2 prospects atuais). Bugs: `diagnostico-conta.js:77` lê logística/buy box só de Ads; `meli_ads_dia` tem 0 linhas com falha engolida (`meli-serie.js:142`); o PDF diz "somente leitura" sendo falso (app principal com escopo de escrita; `MELI_CLIENT_ID_COMERCIAL` não configurado).

Pedido do David: relatório completo e estratégico (métricas, anúncios com fotos, o que vende/o que está ruim, mercado, estratégia, plano e porquês) para apresentar na reunião comercial; ficar com os dados ≥ 1 mês para ver queda e agir; sem Notion; autorização pelo botão = base legal.

## ⚑ Decisões pendentes (recomendação em negrito)

| # | Decisão | Opções |
|---|---|---|
| a | Quem recebe o completo | **Resumo na página pública + completo na reunião** · completo na página · completo liberado pelo closer |
| b | Identidade do documento | **Proposta-Diagnóstico, 12 páginas A4 (template da casa)** · fluxo editorial contínuo atual |
| c | Retenção da autorização/dados | **90 dias** · 60 · 30 (expurgo automático + revogação, aviso 7 dias antes) |
| d | App só-leitura do ML para prospects | **Sim — David cria no DevCenter e passa `MELI_CLIENT_ID_COMERCIAL`/`_SECRET_COMERCIAL`** · segue no app principal (texto nunca diz "somente leitura") |

## 1. Dados — coleta completa e diária (sem segundo motor: dado novo alimenta regra existente)

**Coleta completa** (job por prospect, 150 dias; `coletarCliente(chave, { dias: 150, completo: true, aoProgredir })`) e **diária** (30 dias, incremental). Por fonte, com estado gravado em `meli_coleta_estado (cliente, fonte, estado, http, detalhe, n, em)` — ok · NOT_AUTHORIZED · NOT_AVAILABLE · NOT_SUPPORTED · truncado · erro:

| Fonte | Endpoint | Mudança |
|---|---|---|
| Detalhe do anúncio | `/items?ids=` (`meli-api.js:203`) | pedir também `category_id, domain_id, attributes, seller_custom_field`; **gravar** `pictures_json` (`[{id,url:secure_url,size,max_size}]`), `health`, `original_price`, `condition`, `catalog_product_id`, `category_id`, `attributes_json` em `meli_item` (colunas aditivas) — zero chamadas extras |
| Pedidos | `/orders/search` por dia | 150 na 1ª, 30 na diária; teto 1000/dia continua `truncado`; **não** ler `/shipments` por pedido (cidade/UF = NOT_AVAILABLE declarado) |
| Visitas | `/visits/items?ids=` (totais de TODOS os ativos) → `time_window` para top 200 por unidades + até 300 ativos sem venda com mais tráfego | fecha a cegueira "anúncio com tráfego e 0 venda" |
| Visão do comprador | `/reviews/item/{id}?limit=50` com texto (top 20 por receita) · `price_to_win` para **todos** os `catalog_listing` (teto 500) | `visao_json.avaliacoes.textos`, `visao_json.catalogo` |
| Concorrência do catálogo | `/products/{catalog_product_id}/items` (top 10) — **a conferir na 1ª coleta real** | `visao_json.catalogo.concorrentes` + estado |
| Reputação | `/users/{id}` seller_reputation, 1×/dia | `meli_conta_perfil (cliente, dia, nivel, medalha, taxas/qtd de reclamações·atrasos·cancelamentos, promocoes_json, envio_json, anuncios_json)` |
| Ads | por anúncio 28d×2 (igual) + campanhas `/advertisers/{id}/product_ads/campaigns` (nome, status, budget, acos alvo) | `meli_ads_campanha`; Ads por dia: **instrumentar** a falha (log + estado) e `scripts/sonda-ads-dia.mjs` (1 chamada, imprime status/corpo) para o David rodar numa conta com gasto antes de qualquer "corrigido" |
| Promoções, taxas, envio | `/seller-promotions/users/{id}` (resumo), `/sites/MLB/listing_prices` por (categoria, tipo) dos top 20, `/users/{id}/shipping_preferences` + `shipping_options/free` top 10 | `meli_conta_perfil.*_json`, `meli_mercado.taxas_json` |
| Mercado | `/categories/{id}` + `/trends/MLB/{cat}` + `/highlights/MLB/category/{cat}` + `/items?ids=` (títulos) — top 5 categorias por receita; posição do prospect = ids dele ∩ highlights | `meli_mercado (cliente, categoria_id, nome, caminho, total_itens, trends_json, highlights_json, taxas_json, estados_json)` — portar `trends()`/`categoryInsights()` do mcp-meli (~25 linhas) usando `chamar(chave, …)` |
| Perguntas / reclamações | 1 tentativa só para registrar estado (403 esperado) / claims amostra 50 | estado declarado |

Custo estimado (throttle atual + espera 150 ms nos laços): 1ª coleta 100 anúncios ≈ 400 chamadas ≈ 3 min; 500 ≈ 5 min; 2000 ≈ 12 min. Diária: 60–400 chamadas. Tetos em `config/comercial.json` (declarados no relatório).

**Prospects na operação diária** (`server.js:331-349`): segundo laço, depois dos clientes, sobre `listarProspectosConectados()` (meli_contas sem erro e `retencao_ate > hoje`): `coletarCliente` incremental → `coletarPerfil` → `classificarEstado` gravado em `retro_ciclo` → `queda` significativa → `notificar('prospect_queda', dedupe 7d)`; depois `avisarExpiracao()` e `expurgarProspectosVencidos()`. **Nunca** `capturarAcompanhamento`/`gerarPlanoConta` (planejar = só cliente). Renovação preventiva passa a incluir prospects; backup continua excluindo (perda do banco = reconectar, declarado).

**LGPD/consentimento**: `prospecto_consentimento (prospecto_id, chave, momento 'formulario'|'oauth', versao, texto, ip, ua, meli_user_id, app_id, escopos, em)` gravado no `POST /diagnostico` e no callback (também para closers). Texto `lgpd-v3-2026-10-r{dias}[-ro]` cita o prazo e a leitura diária. `prospectos` ganha `retencao_ate`, `aviso_expurgo_em`, `ultima_coleta_em`. Expurgo = `removerProspecto` (revoga melhor esforço; pula se outro cliente usa o mesmo seller) + apagar `data/relatorios/comercial/{id}/` + webhooks `meli_notificacoes WHERE user_id`; consentimento fica anonimizado (sem ip/ua/user_id) como prova de base legal — **confirmar com jurídico**. Tabelas novas entram em `TABELAS_SERIE` (`meli-contas.js:13`) para limpeza/conversão.

**Bugs**: `diagnostico-conta.js:77` → `logistica: i.logistica || ad?.logistica`, `buy_box` derivado de `visao.catalogo.status` quando não há Ads (destrava `full_envio`/`catalogo_buybox` para 5.855 itens); "somente leitura" condicional a `!escopos.includes('write')` e `appComercialPronto()`; `dados_lidos` passa a vir de `meli_coleta_estado` (conta sem venda vira "pronto" com relatório em modo `sem_vendas`).

## 2. Análise — os motores de sempre, mais dados

- `diagnosticarConta` recebe os campos novos por `carregarBase`; `montarAcoes(chave, diag, { retro: null })` + `selecionarOportunidades`; `previsaoDoPlano` com `p_fonte` **impresso literalmente** ("calibrado: X de N tarefas da base Place2u" ou "premissa inicial"); `classificarEstado` (14d×14d, confirmação 28d) sobre `serieConta`; `paretoItens`; `causalidadeVendas`; `metricasFull`; `saude()` exportado de `monitoramento-meli.js` só para a lógica de reputação (gravada em `coletarPerfil`). `merovingio.lerCliente` não roda (Notion) — não é usado.
- **Regra nova única** em `config/algoritmo.json` (v1.2.0): `saude_reputacao` — reputação fora do verde ou taxas de reclamações/atrasos/cancelamentos acima do limiar (prior 0,5, `premissa: true`); vale também para clientes; entra primeiro na sequência (saúde → …).
- **"Merovíngio para prospect"** = `src/lib/arquetipo-conta.js`, função pura `arquetipoConta({ diag, estado, full, mercado, reputacao })` → `{ id, rotulo, tese, evidencia[], jogada (regras de montarAcoes), falsificador, confianca }`. 9 arquétipos em ordem, limiares em `algoritmo.json.arquetipos_prospect` com prior declarado: `reputacao_em_risco` → `queda_de_trafego` → `conversao_travada` → `trafego_pago_sem_retorno` → `catalogo_perdido` → `sem_full` → `conteudo_fraco` → `sazonal` → `sem_base|em_crescimento`. Não prioriza nem cria ação: só **nomeia** o diagnóstico que `montarAcoes` já produziu e escolhe a capa. `confianca='fato'` só com medida direta (Ads, catálogo, reputação).
- `urgencia_oculta` troca a hipótese genérica por keywords reais de `/trends` da categoria (fato de mercado, hipótese de efeito).

## 3. O documento (⚑ b1) — `src/lib/render-proposta-comercial.js`, CSS do template da casa

12 páginas A4 fixas (`@page A4 margin 0`, `.page 210×297mm overflow:hidden`), Playfair/Inter/JetBrains, capa e última página dark, 1 `<em>` por título, 1 callout por página, **toda página com número tem linha `.src`** (endpoint + data), tetos duros (6 linhas/tabela, 6 qcards, 6 fotos, `corta()`), fotos `<img src=secure_url referrerpolicy=no-referrer>` (capa em alta), gráfico de série 90d em SVG via `micro-grafico.js`, barras em CSS, nada de Chart.js.

| # | Página | Fonte dos números |
|---|---|---|
| 01 | Capa dark: tese do arquétipo + 3 frases (mérito com número · problema com número · o que o documento faz) + meta (conta, base lida, período, versão/hash) + "como ler" | `arquetipoConta`, `cobertura`, `algoritmo_versao` |
| 02 | O retrato: 6 stats (faturamento 90d, pedidos 90d, conversão da conta, anúncios que vendem, reputação, concentração) + gráfico 90d + callout estado/causal + tabela de sinais | `retratoConta` (SQL 90d), `diag.resumo/benchmark/causal`, `classificarEstado`, `meli_conta_perfil`, `paretoItens` |
| 03 | A voz do seu comprador: 6 qcards com falas **literais** (reclamação que destrói a nota · dúvida · elogio ×2 · dor repetida · reclamações abertas) + callout "três fatos" — sem avaliação escrita → texto honesto, nunca inventar | `visao_json.avaliacoes.textos`, claims |
| 04 | Onde está o dinheiro parado: tabela falha · evidência · o que fazemos · impacto (fato/hipótese) + box "observação honesta" | `oportunidades`, `diag.pendencias`, `meli_coleta_estado` |
| 05 | Os campeões e o que a foto diz: grid 3×2 com capa em alta + selos (fotos <5, capa <1200/não quadrada, título <40/>60, saúde <70%) + barras de share | `paretoItens`, `pictures_json`, `health` |
| 06 | Estratégia A — preço × catálogo (ou IMA "vendem menos do que o tráfego merece" se não há catálogo) | `price_to_win`, concorrentes do catálogo |
| 07 | Estratégia B — mercado: anúncios na categoria, posição entre os 20 mais vendidos, keywords em alta cobertas, catálogos; tabela top 10 (+ "é seu"); chips de trends; callout "a brecha" — sem mercado → box honesto | `meli_mercado` |
| 08 | Estratégia C — como vamos anunciar: Ads (6 stats + gastaram sem venda), Full, conteúdo IMA/MIRA (galeria por posição · título e ficha · duplicação estratégica) | `diag.ads`, `metricasFull`, regras |
| 09 | Plano 90 dias P.L.A.C.E.: Pesquisa (sem 1) · Layout (2–4) · Aceleração (5–7) · Coleta (8–10) · Escala (11–12), coluna "como você sabe que deu certo" = `dados.meta`; qcards entregamos / precisamos de você | mapeamento regra→etapa fixo no renderer |
| 10 | A projeção e como foi montada: por alavanca (conservador/base/otimista, p com fonte), barras, premissas, **cenário em que a recomendação perde** | `previsaoDoPlano` |
| 11 | O que não conseguimos ver — ainda: pendências em linguagem de negócio + o que muda com cada acesso + nota de permissão verdadeira | `diag.pendencias`, escopos |
| 12 | Próximos passos dark: 4 steps (validar e cravar meta · informar custos · semana 1 executa · 1º relatório em 30 dias; dados lidos até `retencao_ate`, revogável) + 3 stats + CTA | — (sem página de investimento: preço é outro documento) |

Modo `sem_vendas` (0 pedidos pagos): páginas 01, 02 (sem gráfico), 05, 07, 11, 12. **Versão congelada**: `gerarRelatorioComercial(id)` grava `data/relatorios/comercial/{id}/{data}.html` + `.pdf` (Chrome fatorado em `gerarPdf()`, `--virtual-time-budget=20000`, contagem de páginas = nº de sections e de imagens), linha em `prospecto_relatorio (prospecto_id, versao, gerado_em, por, hash, algoritmo_versao, arquetipo, resumo_json)`. "Ver relatório/Baixar PDF" abrem a congelada; `?ao_vivo=1` regera sem gravar. Caminho ⚑ b2 (fluxo contínuo): manter `render-diagnostico-comercial.js` e só acrescentar seções 03/05/07 + arquétipo — 1 dia a menos, menos impacto.

## 4. Fluxo e tela

**Página pública `/d/:token`** (`rotas-publicas.js:173-215`): estados não conectado (igual) → **"Preparando sua análise"** (callback redireciona; `GET /d/:token/status` devolve `{pronto, fase, feitos, total}`; barra + "pode deixar a aba aberta") → resumo pronto (6 tiles + leitura + 1 linha do arquétipo + ⚑ a1 "O diagnóstico completo tem N páginas e é apresentado por um especialista — peça o contato" | a2 botão "Ver minha análise completa" servindo a congelada sem 09/10 | a3 closer libera). "Apagar meus dados" em todos os estados. Nenhum e-mail/WhatsApp sai do sistema.

**`/comercial`** (contrato §7.7): etapa exclusiva `pediu_contato > queda > apresentado > completo > pronto > conectado > erro > aguardando`; badges "Expira em N dias" (≤7, `.selo.atencao`) e resultado; KPIs: Pediram contato · Queda detectada · Prontos para apresentar · Apresentados sem resultado; um `.btn-p` por etapa (primário da tela segue "Novo prospect"): Copiar link · "Ler os dados da conta" (rótulo intocado) · **"Gerar diagnóstico completo"** (job por chave com progresso, trava **por prospect** em vez da global de `rotas-planos.js:49`) · "Apresentar" (congelada em nova aba) · "Registrar resultado" (dialog: apresentado em/por, resultado proposta|ganho|perdido|sem_retorno) · "Ver queda" · WhatsApp. "Baixar PDF" sempre visível, habilitado com dados lidos. Menu ⋯: Atualizar dados · Resumo rápido · Regerar completo · Marcar apresentado · Converter em cliente · Remover.

**Card da queda** (`tr#dx-{id}`): faturamento 14d a→b (Δ%, força, confirmação 28d) · anúncios que caíram (thumb, Δ unidades) · "O que a Place2u faria" = 3 ações de `montarAcoes` · "Abrir WhatsApp com a mensagem" (`wa.me/55{tel}?text=`; o closer aperta enviar) + "Copiar mensagem". Texto: "Oi {nome}, aqui é {closer} da Place2u. Vi na leitura autorizada da {empresa} que as vendas caíram {Δ}% nos últimos 14 dias (R$ b → R$ a). Os anúncios que mais caíram: {3}. Já temos 3 ações para reverter: {títulos}. Posso te mostrar em 15 minutos?" (sem e-mail/telefone no texto).

**Notificações**: `diagnostico_completo_pronto`, `prospect_queda` (alerta, dedupe 7d), `prospect_expira` (7 dias antes), `prospect_expurgado`, `coleta_falhou` com dedupe 60 min. **Filtros** painel `comercial`: etapas novas, `resultado`, datas `expira_em`/`apresentado_em`. **Prospect → cliente**: `POST /api/comercial/converter {id, cliente}` renomeia a chave em `meli_contas` + `TABELAS_SERIE` numa transação, apaga `prospectos` sem revogar; se veio do app só-leitura, avisa para reconectar pelo botão do Notion.

## 5. API

Internas: `GET /api/comercial/prospectos` (+ etapa nova, estado, expira_em, dias_para_expirar, relatorio_versao, apresentado_*, resultado, cobertura) · `POST /api/comercial/diagnostico-completo {id}` → job (409 por chave) · `POST /api/comercial/coletar` (trava por chave) · `GET /api/comercial/cobertura?id=` · `POST /api/comercial/relatorio {id}` (congela) · `GET /comercial/diagnostico?id=&versao=` e `.pdf` · `GET /api/comercial/queda?id=` (card + mensagem) · `POST /api/comercial/apresentado` · `POST /api/comercial/resultado` · `POST /api/comercial/retencao {id, dias}` · `POST /api/comercial/converter`. Públicas: `GET /d/:token/status`; (⚑ a2) `GET /d/:token/relatorio`. Regras: ids `/^[0-9a-f]{8}$/`, JSON obrigatório, mensagens sem eco, `guardaLocal` + regex pública (`guarda-local.js:16`) atualizados.

## 6. Testes

- `scripts/teste-coleta-prospect.mjs` (API ML **stubada**; `:memory:`): colunas novas gravadas sem chamada extra; visitas de ativos sem venda; estados por fonte (403 → NOT_AUTHORIZED, 404 → NOT_AVAILABLE, teto → truncado); reputação/mercado/campanhas gravados; Ads-dia instrumentado (log + estado); segundo laço diário não chama `gerarPlanoConta`; expurgo revoga + apaga diretório + anonimiza consentimento; conversão renomeia todas as `TABELAS_SERIE`.
- `scripts/teste-arquetipo-conta.mjs`: 9 arquétipos por fixture, ordem, `confianca`, falsificador; `saude_reputacao` dispara/não dispara.
- `scripts/teste-proposta-comercial.mjs`: HTML tem 12 sections (6 no `sem_vendas`), 1 `<em>` por título, `.src` em toda página numerada, nenhuma fala inventada quando não há reviews, "somente leitura" só com `appComercialPronto`, proíbe "Notion"/"tarefa"; versão congelada grava arquivo + linha e a remoção apaga; contagem de páginas do PDF = sections quando o Chrome existe (pula sem Chrome).
- `teste-diagnostico-comercial.mjs` e `teste-comercial-publico.mjs` ajustados (o segundo passa a usar banco em memória — hoje grava no real). Suíte inteira verde.

## 7. Ordem

1. Dados: colunas/tabelas + `atualizarItens` + visitas sem venda + visão ampliada + perfil/mercado/campanhas + estados + bugs (logística, "somente leitura", Ads-dia instrumentado + sonda) + consentimento/retenção + laço diário + expurgo + `TABELAS_SERIE`.
2. Análise: `arquetipo-conta.js`, `saude_reputacao`, `retratoConta`, `montarDiagnosticoComercial` ampliado (perfil, mercado, campanhas, cobertura, arquétipo, retrato).
3. Documento: `render-proposta-comercial.js` (12 páginas + `sem_vendas`), `gerarPdf()`, versão congelada.
4. Fluxo: rotas, job por chave, página pública (status/resumo), `/comercial` (etapas, botões, card da queda, registro, filtros), notificações, conversão, docs (`docs/comercial-diagnostico.md`, contrato §7.7, `.env.example` com `COMERCIAL_*`/`MELI_*_COMERCIAL`).
5. Testes, suíte, reinício no fluxo combinado, verificação.

## 8. Verificação

1. Suíte verde; `node scripts/sonda-ads-dia.mjs "<cliente com gasto>" MLB…` (David) → status/corpo registrados → ajustar e só então marcar Ads-dia como "ok".
2. Coleta completa real de um prospect com vendas (não há hoje: PlaceWolf = 0 pedidos, XPTO = 0 itens): gerar com um prospect novo indicado pelo David → `meli_coleta_estado` por fonte, fotos em alta em `meli_item.pictures_json`, `meli_mercado` com a posição dele, `meli_conta_perfil` do dia.
3. `/comercial`: etapa "Diagnóstico completo pronto" → Apresentar (HTML 12 páginas, fotos carregadas) → Baixar PDF (nº de páginas = sections, imagens contadas) → Registrar resultado; PlaceWolf em modo `sem_vendas` (6 páginas) sem 409.
4. Página pública `/d/:token`: "preparando" → resumo (⚑ a); "Apagar meus dados" apaga tudo inclusive `data/relatorios/comercial/{id}`.
5. Simular queda (fixture em banco de teste) → notificação com som + card + mensagem WhatsApp; `prospect_expira` 7 dias antes; expurgo revoga e apaga.

## Pendências do David

- ⚑ As 4 decisões. · App só-leitura no DevCenter (credenciais no `.env`). · Rodar a sonda de Ads-dia numa conta com gasto. · Texto de consentimento v3 (prazo + leitura diária) validado com o jurídico. · Um prospect real com vendas para o piloto do relatório.
