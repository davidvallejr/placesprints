# Motor de diagnóstico de marketplaces (v1.4.0, 08/10/2026 · v1.5.0, 09/10/2026: regras de saúde da conta)

> Projeção do Algoritmo no contrato JSON das 11 chaves — **nunca um segundo motor**. Os números vêm de `diagnosticarConta` (`DEFINICOES`), as ações das regras do plano (`acoes_plano`), o estado e a estratégia da retroalimentação, a tese do Merovíngio. Decisões do David: evolução do Algoritmo existente; só Mercado Livre (Amazon/Shopee/TikTok = `NOT_SUPPORTED`); as regras geram tudo, a IA só redige (sem chave, texto determinístico).
>
> Código: `src/lib/diagnostico-motor.js` (contrato, `validarContrato`, prompts derivados), `src/lib/render-diagnostico-motor.js` (relatório em PT), `src/lib/ia.js` (`redigir`), `config/prompt-diagnostico.md` (prompt), rotas em `src/rotas-planos.js`. Teste: `scripts/teste-diagnostico-motor.mjs`. A parte das métricas, do `data_quality` e das regras está em `docs/metodologia-algoritmo.md` (seção 10).

## 1. Rotas (sem POST novo: a geração continua em `POST /api/plano-conta/gerar`)

| Rota | Devolve |
|---|---|
| `GET /api/cliente/diagnostico?cliente=` | o JSON do contrato, validado (`500` + lista de erros só para erro **estrutural** — frases fixas, nunca o valor recebido; texto ruim vindo de uma regra é neutralizado na montagem e não derruba o contrato). Conta sem dados → `disponivel:false` com `data_quality` (tudo `indisponivel`, 3 canais `NOT_SUPPORTED`), ainda válido. Prospect `[Comercial]` → `400`. |
| `GET /diagnostico-motor?cliente=&para=interno\|cliente` | HTML em PT. `interno` mostra tudo: ids (PS-/MLB), responsáveis, fórmulas, chaves das regras, prompts derivados e plano de revisão. `cliente` usa a **visão do cliente** (abaixo), passa cada texto pelo auditor completo (`relatorio-seguro`: sem ID — inclusive `job <8 hex>`, `variante <8 hex>`, `ev-`/`dp-` —, sem nome interno, sem jargão, sem promessa/causalidade — o que reprova vira "—"), troca os estados `NOT_*` por PT, traduz status/tipo/logística da API por mapa fechado (valor sem rótulo depois de "status"/"logística" — `custom`, `default`… — ou `snake_case` sai da frase, nunca cru; o nome do anúncio não passa por essa tradução: "Camiseta Banda Status Quo" chega inteiro) e omite as seções internas. **IA só no relatório interno; ao cliente, texto determinístico**: com `para=cliente` a leitura executiva é sempre `leituraDeterministica` da visão do cliente e `redigir` nunca é chamado (`paginaDiagnostico`); no interno a leitura é redigida por `redigir` (IA só com chave; números conferidos só contra as evidências que os fatos enviados citam — `insumosLeitura`; o `ia_cache` só guarda texto de origem `ia`). |
| `GET /api/cliente/diagnostico.csv?cliente=` | `actions[]` em CSV (`;`, BOM, `csvSeguro` contra fórmula). |

`diagnosticoDoCliente(cliente, { hoje, memo })` lê tudo em modo somente leitura (`retroalimentar` com `salvar:false`); cada passo que falhar entra em `avisos[{passo, motivo}]` e o contrato sai sem aquela parte, nunca com zero no lugar.

**Memo (achado 14, 08/10):** o contrato é guardado em processo por `(cliente, hoje, carimbo)` — carimbo = quantidade e `MAX(atualizado_em)` de `acoes_plano` + última `coletado_em` de `meli_coleta_dia` e `meli_ads_item` —, com TTL de 60 s e teto de 24 entradas (`memoDiagnostico`). O HTML de `/diagnostico-motor` usa o mesmo memo com `para` na chave, preso à geração do contrato (`gerado_em`); a validação do JSON fica presa ao objeto. Custos, metas e Ofertas só entram depois do TTL. `memo:false` recalcula.

### Visão do cliente (`visaoCliente`, `?para=cliente`)

Allowlist `REGRAS_CLIENTE` = as regras de anúncio/conta do algoritmo que têm rótulo em PT (`ROT_REGRA`), **menos** `bloqueio_interno`, `pendencia_cliente` e `bloqueio_cliente` (têm texto próprio em `pendencias-texto.js`). As 5 regras de saúde da conta (v1.5.0: `reputacao_em_risco`, `envio_atrasado`, `reclamacao_sem_resposta`, `pergunta_sem_resposta`, `full_estoque_antigo`) **entram** na allowlist — tudo nelas é do cliente (reputação, despacho, atendimento, estoque no Full); o nível da reputação sai traduzido (`verde`, `amarelo`…) e as causas novas têm rótulo em `ROT_CAUSA`. Ficam fora, sempre: as regras operacionais do plano por cliente (`sem_responsavel`, `backlog_parado`, `sem_entrega`, `renovacao`, `queda_cadencia`, `alavanca_*`, `calendario`, `sem_plano_mes`, `plano_mes_atrasado`, `ml_*`) e qualquer regra nova sem rótulo — a chave crua nunca é impressa. `issues`, `opportunities`, `actions`, problemas por anúncio e regras de Ads são recortados; os contadores do texto ("N problema(s)…") contam só o que é mostrado; as ações omitidas aparecem só como contagem nos limites. Causas possíveis vão em PT por lista fechada (`ROT_CAUSA`; sem rótulo, a causa some). Antes do auditor, o texto ao cliente perde ids e a atribuição "— leitura/job do módulo de Ofertas", e o enum cru da API do ML que as regras gravam em problema/causas/evidência/indicador vira PT por **mapa fechado** (`traduzirEnumML`): status do anúncio (`active` ativo, `paused` pausado, `under_review` em revisão pelo Mercado Livre, `inactive` inativo, `closed` encerrado, `payment_required` com pagamento pendente no Mercado Livre, `not_yet_active` ainda não ativado — a regra `anuncio_restrito` grava "Status paused"), tipo de anúncio (`gold_special` Clássico, `gold_pro` Premium) e logística (`filtros.js → ROTULOS.logistica`: `fulfillment` Full, `xd_drop_off`, `cross_docking`, `drop_off`, `self_service` Flex, `not_specified`). Status sem rótulo sai da frase junto com "status"; status em inglês fora do contexto "status X" não é traduzido (título do cliente "Legging Active" fica); palavra técnica `snake_case` sem rótulo é **omitida da frase**, nunca exibida crua. Texto com "módulo de Ofertas" ou "job" não é impresso ("—"). Capa sem "Algoritmo" ("Versão") e rodapé sem "Fonte oficial: Notion" ("Fonte: Mercado Livre e registros da Place2u"). O contrato em si não muda: o modo interno continua mostrando tudo.

## 2. Contrato de dados (11 chaves + cabeçalho)

Cabeçalho: `versao` (= `config/algoritmo.json → versao`), `canal: 'mercadolivre'`, `cliente`, `gerado_em` (ISO), `periodo {de, ate, anterior{de, ate}, dias: 28}`, `canais_suportados {mercadolivre: 'SUPPORTED', amazon|shopee|tiktok: 'NOT_SUPPORTED'}`, `disponivel`, `avisos[]`.

| Chave | Conteúdo | Campos |
|---|---|---|
| `data_quality` | `diagnosticarConta().data_quality` (`qualidadeDados`) | `fontes[{fonte, status: disponivel\|parcial\|indisponivel, periodo, moeda, atualizado_em, granularidade, definicao}]`, `cobertura {pedidos{de, ate, lacunas[], truncados}, visitas{anuncios_cobertos, anuncios_total}, ads{coletado_em, janela}\|null}`, `analises_bloqueadas[{analise, motivo, estado ∈ NEEDS_EXTERNAL_DATA\|NOT_AVAILABLE\|NOT_AUTHORIZED\|NOT_SUPPORTED\|NOT_COLLECTED, como_obter}]`, `incompatibilidades[]` |
| `metrics` | `conta`, `por_curva {A,B,C}`, `anuncios[]` | **toda métrica** = `{valor: number\|null, formula, denominador, periodo, fonte, evidence_id, motivo?, anterior?, parcial?}`. Métrica da série de pedidos (receita, pedidos, unidades, ticket, preço pago, conversões, participação, TACOS, cobertura/giro/reposição) com dia sem coleta ou truncado na janela: `parcial {dias_cobertos, dias, dias_sem_coleta, dias_truncados}` e evidência `pendente` com `motivo`; acima de `MAX_SEM_COLETA` dias sem coleta (`config/retroalimentacao.json → estado.max_dias_sem_coleta`, padrão 3 = o corte da retroalimentação) o valor vira `null` com motivo. TACOS e participação da publicidade têm período de Ads (`periodo` = janela de Ads) mas dividem pela receita da janela de **pedidos**: a qualidade (e o corte) é a dessa janela, mesmo quando a coleta de Ads para ou atrasa e as duas janelas divergem. O relatório mostra "parcial (X de 28 dias)" ou "—". `margem_pos_ads` herda o mesmo corte de `diagnosticarConta` (`margem_pos_ads_motivo`/`_parcial`). Definição tirada de `DEFINICOES` (ou `DEF_LOCAL` para `n_anuncios`, `share_pct`, `conversao_curva`). `valor` não nulo ⇒ `evidence_id` existe; `valor === null` ⇒ `motivo` (ausente ≠ zero). `anuncios[] = {entidade{tipo:'anuncio', id}, titulo, permalink, curva, classe, status, catalogo_origem, category_id, benchmark_ref, metrics{receita, unidades, share_pct, preco_pago, conversao_anuncio, cobertura, giro, ponto_reposicao, ctr_ads, acos, roas, cpc, margem_pre_ads}}` |
| `evidence[]` | uma por métrica não nula + uma por `dados.evidencia` de ação + uma `projecao` por previsão de ganho/risco + estado e concentração da conta (top 1, `n_80`, nº de anúncios) + economia (`conta:roas_alvo`, `conta:acos_max_pct`) + metas do mês (`conta:meta_roas`, `conta:meta_acos_max`) + cobertura (`cobertura:pedidos_lacunas`, `cobertura:pedidos_truncados`, `cobertura:visitas_cobertos`, `cobertura:visitas_total`) | `{id: 'ev-' + sha1(cliente\|chave\|periodo).slice(0,10), tipo ∈ fato\|hipotese\|projecao\|pendente, chave, valor (número finito ou null), unidade (BRL, %, un, x, dias…), texto, fonte, periodo, motivo?}`. O id só se repete entre gerações com o **mesmo período**: a janela de 28 dias anda com o dia, então o id de uma métrica muda de um dia para o outro (vale dentro do mesmo dia de geração). Todo número que o relatório imprime sai de uma evidência (sem ela, "—"); abaixo de 1 o valor ganha casas (0,03% nunca vira "0%"). |
| `account_diagnosis` | estado e estratégia (`retroalimentar`), cadeia causal (`diag.causal`), concentração (`retro.pareto.itens`), tese do Merovíngio | `estado{estado, rotulo, variacao_pct, forca, significativo, sinal_misto, motivo}`, `estrategia{classe, justificativa, confianca, revisar_em, provisoria, faltam[], condicoes_revisao[], evidencias[]}`, `por_grupo{A,B,C}`, `causal`, `concentracao{top1_pct, n_80, n_anuncios, alerta, itens[]}`, `leitura_merovingio`, `evidence_ids[]` |
| `listing_diagnoses[]` | ações agrupadas por anúncio | `{entidade, nivel:'anuncio', titulo, curva, catalogo_origem, evidence_ids[], problemas[{regra, problema, evidence_ids[], confianca 1..5, causas_possiveis[{causa, tipo:'hipotese', sinal}], confirmar_com[], oportunidade}]}` |
| `campaign_diagnoses` | Ads **por anúncio** | `granularidade:'anuncio'`, `itens[{entidade, titulo, ctr, cpc, acos, roas (métricas), evidence_ids[], regras[{acao_id, regra, problema}]}]`, `conta{ctr, cpc, custo_por_pedido, acos, roas, tacos, participacao_publicidade, economia, meta}`, `pendencia{estado:'NOT_SUPPORTED', item:'campanhas de Product Ads', motivo}` |
| `issues[]` | ações de regras de problema | `{acao_id, regra, entidade, nivel, texto, evidencia_tipo, evidence_ids[], causas_possiveis[], confirmar_com[], prioridade, confianca}` |
| `opportunities[]` | `ads_entrar`, `ads_escalar`, `urgencia_oculta`, `duplicacao_estrategica`, `full_envio`, `oferta_cadastro`, `concentracao_receita`, `sazonal` (`REGRAS_OPORTUNIDADE`) | mesmos campos + `oportunidade` (`dados.oportunidade`) |
| `actions[]` | toda ação viva (`proposta`, `aprovada`, `distribuida`) das regras `anuncio_*` e do plano por cliente, ordenada por nota | `{id, regra, entidade{tipo ∈ anuncio\|conta, id}, nivel, o_que, por_que{evidence_ids[], evidencia_tipo, hipotese, problema}, como[], responsavel, delegado_a, prazo, horizonte, depende_de[], limites[], metrica_sucesso{indicador, meta, aceite}, parada, revisar_em, prioridade{p ∈ P0..P3\|null, nota, componentes, fila}, previsao{tipo, hipotese:true, valor_esperado, p_sucesso, p_fonte, cenarios, horizonte_dias, aviso}\|null, executar_via ∈ oferta\|promocoes\|notion, status, processo}` |
| `derived_prompts[]` | um por (ação × tipo) de `PROMPT_POR_REGRA` | `{id: 'dp-'+sha1, tipo ∈ titulo_descricao\|imagens\|atributos\|oferta_kit\|campanha\|preco\|plano_conta, rotulo, entidade, acao_id, estado ∈ pronto\|pendente, insumos{…usados}, restricoes{preservar[{campo, valor, fonte}], proibido[]}, insumos_faltantes[{item, estado, como_obter}], texto}` |
| `review_plan` | ritual + revisões | `ritual` (`algoritmo.json → ritual`), `proximas_revisoes[{acao_id\|'conta', em, o_que_conferir}]` (ordem cronológica), `ciclo_anterior`, `sinal_misto` |

### `validarContrato(json) → { ok, erros[] }` (escrito à mão; cada erro é frase fixa, nunca ecoa o valor)
Chaves obrigatórias e tipos; `disponivel` booleano; `periodo.de/ate/anterior.de/anterior.ate` datas (`anterior` objeto); métrica com valor **finito** (NaN/Infinity recusados) e métrica `null` **sem** `evidence_id`; `evidence.valor` número finito ou `null`; análise bloqueada com `analise`, `motivo` e `como_obter`; confiança inteira 1..5 (problema de anúncio; em issue/oportunidade, `null` ou inteiro); métricas de `campaign_diagnoses.conta` com evidência; ids de ação únicos; `issues`/`opportunities`/`depende_de`/`proximas_revisoes` (exceto `'conta'`)/prompts apontando para ação existente. Dependência descartada/obsoleta depois de distribuída não chega ao validador: a montagem tira o id de `depende_de` e acrescenta "dependência encerrada (descartada ou obsoleta)" aos `limites`. `versao` igual à do algoritmo; `canais_suportados` com os 4 e `mercadolivre: SUPPORTED`; enums de `data_quality`, `evidence.tipo`, `executar_via`, `prioridade.p`, tipos/estados de prompt; **todo `evidence_id` citado existe** (métricas, diagnóstico da conta, anúncios, Ads, issues, opportunities, actions); **nenhuma métrica com `valor` numérico sem `formula` ou sem `evidence_id`**; **nenhum `valor === 0` com `motivo`** (ausente é `null`, e `null` exige motivo); `estrategia.provisoria === true` sempre que `faltam.length` (conta e por grupo); `campaign_diagnoses.granularidade === 'anuncio'` e `pendencia.estado === 'NOT_SUPPORTED'`; prompt `pendente` ⇔ `insumos_faltantes` não vazio, `acao_id` existente, `texto` aprovado no auditor interno; previsão de ganho/risco sempre `hipotese: true`.

## 3. Prompts derivados (`PROMPT_POR_REGRA`)

| Regra | Tipos |
|---|---|
| `ima_conversao` | `titulo_descricao`, `imagens` |
| `conteudo_fotos`, `oferta_galeria`, `queda_ctr_ads` | `imagens` |
| `oferta_ficha` | `atributos` |
| `oferta_titulo_descricao`, `duplicacao_estrategica` (só com briefing do consultor) | `titulo_descricao` |
| `oferta_completa` | `imagens`, `titulo_descricao`, `atributos` |
| `urgencia_oculta` | `oferta_kit` |
| `ads_entrar`, `ads_escalar`, `ads_reduzir`, `ads_otimizar_antes`, `ads_abaixo_meta` | `campanha` |
| `preco_mudou_vendas_cairam`, `margem_negativa`, `oferta_preco`, `catalogo_buybox` | `preco` |
| ação de conta (`concentracao_receita`, `cadastrar_custos`, plano por cliente) | `plano_conta` |

- **Catálogo de terceiros** (`origemCatalogo` = `terceiros`): só `campanha` e `preco` nascem (foto, título, descrição e ficha são do catálogo).
- **Insumos:** ficha do produto (`of_anuncio` → variante → produto + `of_atributo`), `galeria_padrao.mercadolivre` de `config/ofertas.json`, briefing/definição de `config/duplicacao.json` (só leitura para texto; a duplicação continua exigindo o consultor), `processo` do Manual que já está na ação, métrica de sucesso e parada.
- **`restricoes.preservar`** = `checarPreservacao(ficha, '').preservar` (`ofertas-preservacao.js`: cor, tamanho, material, kit, marca, modelo, conteúdo da embalagem, acessórios — só o que tem fonte). **`restricoes.proibido`** = `TERMOS_PROIBIDOS_PROMPT` de `ofertas-diagnostico.js` (fonte única com o título das Ofertas: `termos_proibidos` de `config/ofertas.json` — promocionais, sazonais, promessas, marcas vetadas —, com "top" escrito como a regra: "top como elogio ou promessa (top 1, top 10, top de linha, top de qualidade, qualidade top); 'top' peça de roupa é permitido", nunca a palavra solta — "Top Fitness Nadador" não vira proibição de "top") + `inventar característica`, `prometer resultado`.
- **`estado: 'pendente'`** com `insumos_faltantes[{item, estado, como_obter}]` quando falta: ficha (`NOT_COLLECTED`), GATE 0 — referência confirmada pelo dono (`NEEDS_EXTERNAL_DATA`), voz do cliente (`NOT_AUTHORIZED`, perguntas 403), `FAL_KEY` para imagens (`NEEDS_EXTERNAL_DATA`), custos para preço (`NEEDS_EXTERNAL_DATA`), briefing do consultor na duplicação, e **título proposto que perde cor/tamanho/kit** (`checarPreservacao` com `CAMPOS_PRESERVAR_TITULO`: o corte nunca é silencioso).
- O `texto` é determinístico, em PT, sem promessa nem causalidade, e passa pelo auditor interno (o validador recusa o contrato se não passar). **Todo trecho livre interpolado** (problema/hipótese/título da ação, sinal da causa, indicador, parada, valores da ficha, nome do cliente, rótulos da retroalimentação) passa antes pelo auditor interno: reprovado (ex.: "ACOS null%") vira frase fixa neutra e o prompt fica `pendente` com o insumo faltante "texto de origem da ação fora do padrão" (`NOT_AVAILABLE`). A IA, quando existir, só reescreve.

## 4. Camada de IA (`src/lib/ia.js redigir`)

`redigir({ fatos, instrucao, escopo, template, versaoPrompt, evidence, maxTokens, crivo: 'interno'|'cliente', nomesInternos, permitidos, chamar, hashBase }) → { texto, origem: 'ia'|'deterministico', motivo, tokens{entrada, saida}|null, custo_estimado|null, cache }`

1. Prompt base = `config/prompt-diagnostico.md` (único lido em execução; `config/prompt-estrategista.md` continua como spec) + instrução + fatos em JSON. A IA **nunca** recebe custos brutos nem decide prioridade.
2. Cache `ia_cache` por `escopo` + hash(versão do prompt + instrução + fatos). Timeout `AbortSignal.timeout(20000)`, `max_tokens` por chamada. `catch` loga o motivo (`[ia] falha na chamada: …`) e volta ao template.
3. `numerosFora(texto, evidence)`: todo número do texto (`\d+([.,]\d+)?`, pt-BR "1.234,56" entendido, datas e horas ignoradas) precisa existir em `evidence[].valor` (arredondado a 0/1/2 casas) ou em `evidence[].texto/periodo`; senão `origem:'deterministico'` com `motivo: 'número não rastreável: …'`. As palavras reprovadas (dobrou, quádruplo, três, milhão, por cento…) são conferidas **sem acento** (NFD), e zero com escala ("R$ 0 mil", "0 k") nunca rastreia: arredondar uma evidência à escala não produz 0.
4. Auditor: subconjunto interno (`promessa`, `causalidade`, `efeito_observado`, `valor_invalido`, `segredo`, `url_interna`) ou o crivo completo (`crivo:'cliente'`).
5. Custo: `AI_PRECO_ENTRADA`/`AI_PRECO_SAIDA` (preço por 1M tokens, opcionais em `.env`); sem os dois, `custo_estimado: null`.
6. `resumoExecutivo` (relatório de sprint, texto que o **cliente** lê) é determinístico por padrão: só chama `redigir` (crivo cliente) quando `IA_RESUMO_SPRINT=1` está no `.env` — opt-in explícito, lido a cada chamada. Sem a variável devolve o template com `motivo: 'ia_ao_cliente_desligada'` e não toca a rede, mesmo com `ANTHROPIC_API_KEY` (teste em `teste-relatorio.mjs`, chave falsa + `fetch` stub).
7. **IA só no relatório interno; ao cliente, texto determinístico.** `/diagnostico-motor?para=cliente` usa só `leituraDeterministica` (nunca chama `redigir`) até uma revisão específica da IA no crivo cliente: a heurística `numerosFora` ainda deixa passar variações reproduzidas ("12% de queda" com evidência de alta, "caiu 12% para 1,2%", elipse sem vírgula). O modo interno continua podendo usar a IA. `paginaDiagnostico(j, { para, nomesInternos, redigir })` (render) concentra a decisão; a rota injeta o `redigir` de `ia.js`. A mesma decisão vale para o resumo executivo do relatório de sprint (item 6): `IA_RESUMO_SPRINT=1` é a única porta, e só deve ser aberta depois dessa revisão.

## 5. Tabela de fórmulas (`DEFINICOES`, uma por métrica)

| Métrica | Texto | Fórmula | Denominador | Período | Fonte |
|---|---|---|---|---|---|
| `receita` | Receita (GMV) dos pedidos pagos | Σ unit_price × quantity dos itens de pedidos pagos (order.status=paid), por anúncio e dia | — | 28 dias fechados (até ontem) × 28 anteriores | meli_serie_item (pedidos) |
| `pedidos` | Pedidos pagos | Σ pedidos pagos dos dias coletados da janela (meli_coleta_dia.pedidos); null se nenhum dia foi coletado | — | 28 dias | meli_coleta_dia |
| `unidades` | Unidades vendidas | Σ quantity dos itens de pedidos pagos | — | 28 dias | meli_serie_item |
| `ticket` | Ticket médio da conta | receita ÷ pedidos pagos (nível CONTA; por anúncio o número correspondente é o preço pago) | pedidos pagos | 28 dias | meli_serie_item + meli_coleta_dia |
| `preco_pago` | Preço pago do anúncio | receita ÷ unidades do anúncio | unidades | 28 dias × 28 anteriores | meli_serie_item |
| `conversao_anuncio` | Conversão do anúncio | unidades ÷ visitas × 100, só com visitas coletadas no período inteiro (visOk); null se > 100% (visitas registradas em outro anúncio do mesmo produto) | visitas | 28 dias | meli_serie_item (pedidos + visitas) |
| `conversao_conta` | Conversão da conta (benchmark) | Σ unidades ÷ Σ visitas dos anúncios curva A/B cobertos por visitas com ≥ benchmark_min_visitas; declara anuncios_cobertos/anuncios_total em data_quality.cobertura.visitas | visitas dos anúncios cobertos | 28 dias | meli_serie_item |
| `ctr_ads` | CTR de Ads | cliques ÷ impressões × 100, só na janela própria de Ads | impressões (prints) | janela de Ads (28 d atual e 28 d anterior) | meli_ads_item |
| `cpc` | Custo por clique | custo de Ads ÷ cliques | cliques | janela de Ads | meli_ads_item |
| `custo_por_pedido_ads` | Custo por venda atribuída a Ads | custo de Ads ÷ unidades atribuídas (a API de Product Ads devolve unidades, não pedidos) | unidades atribuídas | janela de Ads | meli_ads_item |
| `acos` | ACOS | custo de Ads ÷ receita atribuída a Ads × 100 | receita atribuída | janela de Ads | meli_ads_item |
| `roas` | ROAS | receita atribuída a Ads ÷ custo de Ads | custo de Ads | janela de Ads | meli_ads_item |
| `tacos` | TACOS | custo de Ads ÷ GMV × 100 — cruza a janela de Ads com a dos pedidos (declarado em data_quality.incompatibilidades) | GMV (pedidos) | Ads 28 d × pedidos 28 d | meli_ads_item + meli_serie_item |
| `participacao_publicidade` | Participação da publicidade | receita atribuída a Ads ÷ GMV × 100 (mesma ressalva de janelas do TACOS) | GMV | Ads 28 d × pedidos 28 d | meli_ads_item + meli_serie_item |
| `margem_pre_ads` | Margem de contribuição antes de Ads | 100 − CMV% − imposto% − comissão% − frete% − embalagem% − outros% (margemPct); por anúncio o CMV vem do custo vinculado quando existe; null sem custos | preço | custos vigentes | custos_cliente + custo_vinculo |
| `margem_pos_ads` | Margem depois de Ads | margem_pre_ads − TACOS da conta (custo de Ads ÷ receita total × 100: Ads descontado UMA vez; o ACOS mede só as vendas atribuídas a Ads e não entra); null sem custos, sem Ads coletado ou sem receita; parcial/null pelo corte de dias sem coleta da janela de pedidos | preço | custos vigentes × Ads 28 d × pedidos 28 d | custos_cliente + meli_ads_item + meli_serie_item |
| `cobertura` | Cobertura de estoque | estoque ÷ (unidades 28 d ÷ 28), em dias; null sem venda | vendas por dia | 28 dias | meli_item.estoque + meli_serie_item |
| `giro` | Giro | unidades 28 d ÷ estoque; null sem estoque | estoque | 28 dias | meli_item + meli_serie_item |
| `ponto_reposicao` | Ponto de reposição | vendas por dia × lead time, em unidades; lead time = PREMISSA lead_time_reposicao_dias do config (rotulada; o cliente ainda não informa o prazo do fornecedor) | — | 28 dias | meli_serie_item + config/algoritmo.json → premissas |
| `cancelamentos` | Cancelamentos | — (NOT_COLLECTED) | — | — | NOT_COLLECTED: lido ao vivo na tela, ainda não gravado |
| `devolucoes` | Devoluções | — (NOT_COLLECTED) | — | — | NOT_COLLECTED: lido ao vivo na tela, ainda não gravado |
| `reclamacoes` | Reclamações | — (NOT_COLLECTED) | — | — | NOT_COLLECTED: lido ao vivo na tela, ainda não gravado |
| `atrasos` | Atrasos de despacho | — (NOT_COLLECTED) | — | — | NOT_COLLECTED: lido ao vivo na tela, ainda não gravado |
| `variacao` | Variação vs período comparável | (atual ÷ anterior − 1) × 100; null com motivo quando qualquer uma das duas janelas tem dia sem coleta ou truncado | período anterior (28 d) | 28 d × 28 d anteriores | meli_serie_item + meli_coleta_dia |

Locais do contrato: `n_anuncios` (contagem por curva), `share_pct` (receita ÷ GMV × 100), `conversao_curva` (Σ unidades ÷ Σ visitas dos cobertos da curva).

## 6. Biblioteca de regras (v1.5.0, `config/algoritmo.json → regras`)

| Regra | Demanda (Notion) | Prior p_sucesso | Prova (métrica · janela) | Teto/semana | Depende de |
|---|---|---|---|---|---|
| `ima_conversao` | Otimizar Anúncios | 0.4 | conversao · 14 d | — | anuncio_restrito, estoque_ruptura |
| `catalogo_buybox` | Corrigir Anúncios | 0.45 | unidades · 14 d | 5 | — |
| `estoque_ruptura` | Planejamento full | 0.85 | — | — | — |
| `full_envio` | Planejamento full | 0.6 | — | 3 | — |
| `ads_entrar` | Ajuste ADS | 0.45 | — | 4 | estoque_ruptura, margem_negativa, anuncio_restrito |
| `ads_escalar` | Ajuste ADS | 0.5 | — | — | estoque_ruptura, margem_negativa, anuncio_restrito |
| `ads_reduzir` | Ajuste ADS | 0.7 | — | — | — |
| `ads_otimizar_antes` | Otimizar Anúncios | 0.4 | — | — | — |
| `conteudo_fotos` | Melhorar Imagens | 0.35 | conversao · 14 d | 4 | — |
| `frete_gratis` | Corrigir Anúncios | 0.4 | conversao · 14 d | 3 | — |
| `sazonal` | Campanhas de Desconto | 0.45 | — | 6 | estoque_ruptura |
| `urgencia_oculta` | Criar Kits | 0.15 | — | 3 | — |
| `promocao_giro` | Campanhas de Desconto | 0.5 | — | — | margem_negativa |
| `cadastrar_custos` | Reunião de Alinhamento | — | — | — | — |
| `duplicacao_estrategica` | Duplicar anúncios | 0.3 | receita_familia · 14 d | 3 | — |
| `oferta_galeria` | Melhorar Imagens | 0.35 (premissa) | conversao · 14 d | 4 | — |
| `oferta_titulo_descricao` | Otimizar Anúncios | 0.3 (premissa) | visitas_dia · 14 d | 4 | — |
| `oferta_completa` | Otimizar Anúncios | 0.4 (premissa) | conversao · 14 d | 3 | — |
| `oferta_ficha` | Preencher Ficha Técnica | 0.3 (premissa) | visitas_dia · 14 d | 4 | — |
| `oferta_preco` | Atualizar Preços | 0.5 (premissa) | margem_pct · 14 d | 3 | — |
| `oferta_cadastro` | Cadastro de Produtos | 0.3 (premissa) | primeira_venda · 28 d | 5 | — |
| `preco_mudou_vendas_cairam` | Atualizar Preços | 0.5 (premissa) | unidades · 14 d | 3 | — |
| `queda_conversao_anuncio` | Otimizar Anúncios | 0.45 (premissa) | conversao · 14 d | 3 | — |
| `queda_exposicao_anuncio` | Otimizar Anúncios | 0.4 (premissa) | visitas_dia · 14 d | 3 | — |
| `queda_ctr_ads` | Melhorar Imagens | 0.45 (premissa) | conversao · 14 d | 3 | — |
| `margem_negativa` | Atualizar Preços | 0.7 (premissa) | margem_pct · 14 d | 5 | — |
| `ads_abaixo_meta` | Ajuste ADS | 0.55 (premissa) | unidades · 14 d | 4 | — |
| `concentracao_receita` | Duplicar anúncios | 0.35 (premissa) | receita_familia · 28 d | 1 | — |
| `anuncio_restrito` | Corrigir Anúncios | 0.6 (premissa) | unidades · 14 d | 5 | — |
| `reputacao_em_risco` (v1.5.0, conta) | Reunião de Alinhamento | 0.5 (premissa) | saude_sinal · 7 d | 1 | — |
| `envio_atrasado` (v1.5.0, conta) | Reunião de Alinhamento | 0.8 (premissa) | saude_sinal · 3 d | 1 | — |
| `reclamacao_sem_resposta` (v1.5.0) | Reunião de Alinhamento | 0.6 (premissa) | saude_sinal · 3 d | 5 | — |
| `pergunta_sem_resposta` (v1.5.0, conta) | Reunião de Alinhamento | 0.6 (premissa) | saude_sinal · 3 d | 1 | — |
| `full_estoque_antigo` (v1.5.0) | Planejamento full / Campanhas de Desconto (por causa) | 0.4 (premissa) | unidades · 14 d | 4 | margem_negativa |

Limiares que são premissa rotulada: `premissas.limiares` (lead time de reposição, coberturas, quedas relativas, controle, impressões mínimas de CTR, pareto; v1.5.0: limites do nível verde da reputação, fração de alerta, amostra mínima, prazo curto de reclamação, idade do Full). Detalhe das regras novas (gatilho, causas por sinal, controle): `docs/metodologia-algoritmo.md` § 10.3; regras de saúde da conta (leitura gravada, pendente não nasce, fonte do Full declarada): § 10.5. No contrato, as regras de saúde entram em `issues`/`actions` pelo fluxo normal (nenhuma chave nova); as de conta saem com `entidade.tipo = 'conta'` e prompt `plano_conta`; `full_estoque_antigo` pode citar um anúncio que não está em `metrics.anuncios` (sem venda em 56 d) — `listing_diagnoses` usa o título gravado na ação.

## 7. Exemplos sintéticos

JSON mínimo válido (o mesmo de `scripts/teste-diagnostico-motor.mjs → MINIMO`): uma métrica com evidência, uma ação citando-a, um prompt pronto.

```json
{
  "versao": "1.5.0", "canal": "mercadolivre", "cliente": "Mínimo", "gerado_em": "2026-10-05T08:00:00.000Z", "disponivel": true,
  "periodo": { "de": "2026-09-07", "ate": "2026-10-04", "anterior": { "de": "2026-08-10", "ate": "2026-09-06" } },
  "canais_suportados": { "mercadolivre": "SUPPORTED", "amazon": "NOT_SUPPORTED", "shopee": "NOT_SUPPORTED", "tiktok": "NOT_SUPPORTED" },
  "data_quality": { "fontes": [{ "fonte": "Mercado Livre — pedidos pagos", "status": "disponivel" }], "cobertura": { "pedidos": { "de": "2026-06-01", "ate": "2026-10-04", "lacunas": [], "truncados": 0 } },
                    "analises_bloqueadas": [{ "analise": "Diagnóstico de Amazon", "motivo": "canal sem integração", "estado": "NOT_SUPPORTED", "como_obter": "—" }], "incompatibilidades": [] },
  "metrics": { "conta": { "receita": { "valor": 1000, "formula": "Σ unit_price × quantity", "denominador": null, "periodo": "28 dias", "fonte": "meli_serie_item", "evidence_id": "ev-0000000001" },
                          "margem_pre_ads": { "valor": null, "formula": "100 − custos", "denominador": "preço", "periodo": "custos vigentes", "fonte": "custos_cliente", "evidence_id": null, "motivo": "custos não informados" } },
               "por_curva": { "A": {}, "B": {}, "C": {} }, "anuncios": [] },
  "evidence": [{ "id": "ev-0000000001", "tipo": "fato", "chave": "conta:receita", "valor": 1000, "unidade": "BRL", "texto": "Receita: 1000", "fonte": "meli_serie_item", "periodo": "2026-09-07..2026-10-04" }],
  "account_diagnosis": { "estado": { "estado": "estagnacao" }, "estrategia": { "classe": "Manutenção", "provisoria": true, "faltam": ["caixa", "capacidade", "mercado"] }, "por_grupo": null, "causal": null, "concentracao": null, "evidence_ids": ["ev-0000000001"] },
  "listing_diagnoses": [], "campaign_diagnoses": { "granularidade": "anuncio", "itens": [], "pendencia": { "estado": "NOT_SUPPORTED", "item": "campanhas de Product Ads", "motivo": "não coletado" } },
  "issues": [], "opportunities": [],
  "actions": [{ "id": "PS-0000000001", "regra": "ima_conversao", "entidade": { "tipo": "anuncio", "id": "MLB1" }, "o_que": "Quebrar objeções", "por_que": { "evidence_ids": ["ev-0000000001"] }, "responsavel": "", "prazo": "2026-10-12", "horizonte": "7d", "depende_de": [], "limites": [],
               "metrica_sucesso": { "indicador": "conversão 1%", "meta": "conversão 2%" }, "parada": "reverter", "revisar_em": "2026-10-26", "prioridade": { "p": "P1", "nota": 60, "componentes": null }, "previsao": null, "executar_via": "notion", "status": "proposta" }],
  "derived_prompts": [{ "id": "dp-0000000001", "tipo": "titulo_descricao", "entidade": { "tipo": "anuncio", "id": "MLB1" }, "acao_id": "PS-0000000001", "estado": "pronto", "insumos": {}, "restricoes": { "preservar": [], "proibido": ["inventar característica"] }, "insumos_faltantes": [], "texto": "Redigir título a partir da ficha." }],
  "review_plan": { "ritual": { "semanal": "gerar plano" }, "proximas_revisoes": [{ "acao_id": "PS-0000000001", "em": "2026-10-26", "o_que_conferir": "conversão" }], "ciclo_anterior": null, "sinal_misto": false }
}
```

Quatro variantes **inválidas** e o porquê:

| Variante | Erro devolvido |
|---|---|
| sem a chave `data_quality` | `falta a chave "data_quality"` — a qualidade dos dados não é opcional: sem ela não se sabe o que o número cobre |
| `actions[0].por_que.evidence_ids = ['ev-ffffffffff']` | `evidence_id órfão em actions.por_que` — toda afirmação aponta para uma evidência que existe |
| `metrics.conta.receita.formula = ''` com `valor: 1000` | `métrica com valor e sem fórmula em metrics.conta.receita` — número sem definição não entra |
| `estrategia.provisoria = false` com `faltam: [caixa, capacidade, mercado]` | `estratégia com pendências precisa ser provisória` — o que não foi medido não vira certeza |

Mais dois que o validador recusa de propósito: `valor: 0` acompanhado de `motivo` (ausente é `null`, zero é zero medido) e `texto` de prompt com promessa ("garante a primeira página").

## 8. Casos críticos e como rodá-los

`node scripts/teste-diagnostico-motor.mjs` (banco em memória, nenhuma chamada externa, `ANTHROPIC_API_KEY` vazia; a IA só por stub injetado em `redigir({ chamar })`):

| Caso | O que confere |
|---|---|
| JSON mínimo válido + 4 inválidos | `validarContrato` |
| sem custos | `margem_*` null com motivo, nenhuma issue `margem_negativa`, render interno e ao cliente sem "lucro"/"prejuízo" |
| ausente ≠ zero | validador rejeita `valor 0` com motivo e `null` sem motivo |
| dia truncado / lacuna | `data_quality.cobertura.pedidos.{truncados, lacunas}` e `variacao` null com motivo |
| catálogo de terceiros | só prompts `campanha`/`preco` |
| preço como confundidor | `queda_conversao_anuncio` com `causas_possiveis[0] = { causa: 'preco', tipo: 'hipotese' }` |
| dependência | `depende_de` e `limites` em `actions`; revisão em `review_plan` |
| estratégia | copiada com `provisoria: true` e `faltam` (conta e por grupo) |
| IA | stub "ROAS 9,99 garante primeira página" → `deterministico` (número não rastreável); stub só com promessa → `deterministico` (auditor); stub que repete só números de `evidence` → `ia`; falha → motivo logado; cache por escopo |
| título que perde cor/kit | prompt `titulo_descricao` pendente com `insumos_faltantes` nomeando o que se perdeu |
| auditor | todo `derived_prompt.texto` e toda `evidence.texto` passam no crivo interno |
| revisão adversarial 08/10 (um bloco por achado) | visão do cliente sem regras operacionais/chave crua e contadores do mostrado; texto livre reprovado → frase neutra + pendente; janela com dia sem coleta → `parcial` / `null`; `job`/`ev-`/`dp-` fora do texto ao cliente e do texto da IA; insumos da leitura só com evidências citadas; 16 casos do validador + dependência encerrada; economia/metas/concentração/cobertura por evidência e 0,03% ≠ 0%; causas e estados em PT, estratégia provisória como hipótese; conta sem ML com "—"; memo do contrato e `ia_cache` sem gravação sem IA; refutações: TACOS/participação com janela de Ads ≠ janela de pedidos seguem o corte, logística crua em PT e `snake_case` fora, capa/rodapé/"módulo de Ofertas" sem nome interno (auditor completo em cada nó de texto do HTML ao cliente), `variante <8 hex>` fora |
| sobras 08/10 (um bloco por item) | `paginaDiagnostico` com `para=cliente` nunca chama o stub de `redigir` (interno chama uma vez) e a rota não chama `redigir` direto; cada status/tipo/logística conhecido em PT ao cliente e o desconhecido omitido (interno cru); leitura com custos e margem depois de Ads nula diz o motivo real (parcial, sem TACOS), "Sem custos informados" só sem custos; `restricoes.proibido` = `TERMOS_PROIBIDOS_PROMPT` + 2, sem "top" solto |
| sobras 2 08/10 (céticos) | logística sem rótulo (`custom`, `default`) pela regra real `full_envio`: omitida ao cliente, frase fica (interno cru); "Status Quo" no título do anúncio chega inteiro; ROAS nula com Ads coletado (500 impressões, 0 cliques) → motivo real + CTR/TACOS medidos (0 é 0), "Sem Product Ads" só sem Ads. Em `teste-ofertas-diagnostico.mjs`: "top" com elogio separado por pontuação, com qualificador ou por extenso vetado; "Kit 10/1 Top" é quantidade; pontuação/conectivo solto dentro e fora de parênteses limpo; vestuário vale para MODEL/LINE/BRAND |
| mundo (porta efêmera) | cliente A com série/Ads/metas/custos valida; cliente B sem Ads → `campaign_diagnoses.pendencia`; ML não conectado → `disponivel:false` + fontes `indisponivel` + 3 canais `NOT_SUPPORTED`; prospect → 400; `?para=cliente` sem `PS-`/`MLB`/nomes; `.csv` com BOM e sem fórmula |

Suíte inteira: `for f in scripts/teste-*.mjs; do node $f || echo FALHOU $f; done`.

## 9. Limites declarados (de propósito)

- **Canais:** só Mercado Livre tem dado medido; Amazon, Shopee e TikTok são `NOT_SUPPORTED` no contrato (sem importador) e aparecem em `data_quality` como fonte `indisponivel` + análise bloqueada.
- **Estados de bloqueio:** `NEEDS_EXTERNAL_DATA` (custos, metas, histórico de 12 meses, GATE 0, FAL_KEY), `NOT_AVAILABLE` (impressões/CTR orgânicos), `NOT_AUTHORIZED` (perguntas, 403), `NOT_SUPPORTED` (busca pública/concorrentes, campanhas de Ads, canais sem API), `NOT_COLLECTED` (cancelamentos, devoluções, reclamações, atrasos, moderação do anúncio, conta não conectada).
- **Estratégia sempre provisória** enquanto `faltam = [caixa, capacidade, mercado]` — nenhuma fonte os mede.
- **Campanhas de Product Ads:** leitura por anúncio; id de campanha, orçamento e palavra-chave não são coletados (`campaign_diagnoses.pendencia`).
- **Executor:** nenhum novo. `actions[].executar_via` só aponta para `oferta` (módulo de Ofertas, com suas travas), `promocoes` ou `notion` (dry-run por padrão). `meli_update_item` do mcp-meli fica **fora** do executor: o motor nunca altera um anúncio.
- **Causalidade:** coincidência no tempo é hipótese por sinal; "causa confirmada" não existe. Nenhuma receita é prometida; cifras são cenários com premissas.
- **Sem custos** não existe margem, piso, desconto máximo nem leitura de resultado. **Dado ausente é `null` com motivo**, nunca zero.
- **IA:** só redige, e só no relatório interno; ao cliente, texto determinístico (sem chamada à IA) — inclusive o resumo executivo do relatório de sprint, que só usa a IA com `IA_RESUMO_SPRINT=1`. Sem chave, template determinístico; número fora de `evidence` ou texto reprovado no auditor descartam o texto da IA.
- **Enum da API no texto ao cliente:** `traduzirEnumML` só lê o slot como as regras o escrevem (`plano-anuncios.js`: "status X"/"logística X" no início do texto ou depois de ";", e "(logística atual: X)"). Hífen, travessão, dois-pontos, ponto e parêntese são separadores comuns dentro de título ("relógio masculino - status gold", "boné (status quo)", "Avaliar envio ao Full: status quo") e não abrem slot; dentro de uma frase (nome do anúncio em minúsculas no título de uma ação) o render não sabe onde o nome começa e não mexe — nem no enum conhecido ("perfume status closed masculino" é nome de produto). Regra nova que precise do enum no meio da frase escreve no formato do slot. Percentual de evidência sai em pt-BR com milhar ("12.345,7%"), 1 casa acima de 1 e 2 algarismos significativos abaixo (a regra de `pctTxt`, com locale e sem notação científica: 1e-7 → "0,0000001%"): valor ≠ 0 nunca vira "0%".
- **Leitura de Ads:** "Sem Product Ads coletado" só quando nenhuma métrica de Ads veio; com Ads coletado e ROAS nula, a leitura diz o motivo da métrica e o CTR/TACOS medidos.
- **"top" numa fonte só:** título, descrição, lente de qualidade, identidade da ficha, prompts derivados (`TERMOS_PROIBIDOS_PROMPT` → `restricoes.proibido`) e a validação de atributos do job (`validarFatual` em `ofertas.js`) usam `termosPromocionais`/`ehPromocional` de `ofertas-diagnostico.js`. "Top Fitness"/"Top Nadador" são peça em qualquer uma delas; "Top Premium", "Top Best Seller", "Top Quality", "Top 1" são elogio em qualquer uma. `RX_PROMOCIONAL` guarda só apelo de prazo/pagamento/garantia que o config não lista. Detalhe da regra do "top" (contexto de vestuário, quantidade × ranking) em `docs/ofertas-estrategicas.md`.
- **Leitura de margem:** "Sem custos informados" só quando não há custos; com custos, margem depois de Ads nula leva o motivo da métrica (janela parcial acima do corte, sem Product Ads/TACOS).
