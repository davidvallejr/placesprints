# Desenho: camada de FOCO 80/20 do Merovíngio (15 · 30 · 45 · 60 · 90 dias)

> Pedido do David (15/10/2026): «No final, o Merovíngio em 15, 30, 45, 60 e 90 dias consegue decidir o que é o 80/20 da conta — o que gera resultado e o que não gera — e não faz sentido manter o foco em algo que não faz sentido.» Lente obrigatória: previsibilidade / probabilidade / causalidade; a V3 (produto, financeiro, ERP) alimenta.
>
> Desenho, 15/10/2026. **Nada aqui foi implementado.** Tudo ancorado no código vivo (caminho:linha, conferido em 15/10). Não é um segundo motor: a camada só **lê** o que o Algoritmo e o Merovíngio já produzem, **classifica** unidades de foco e devolve **um fator** à prioridade existente (`construirAcao`, `src/lib/plano-anuncios.js:696`) — o mesmo lugar por onde já entram o fator do estado, a proteção e o objetivo da duplicação.

## 0. Em uma frase

O foco é uma **leitura** (o que concentra resultado × o que consome esforço, por produto, família de ação, canal e cliente), com **um veredito por unidade e por marco** (manter e escalar / manter / reduzir / pausado por evidência), cada veredito com **probabilidade calibrada** (o `priorEfetivo` e o Wilson que já existem), **custo de oportunidade** declarado como estimativa, **data de revisão** e **o que faria voltar**. «Sair do foco» nunca apaga nada: a série continua sendo coletada, a unidade continua sendo medida (sentinela) e o veredito expira.

---

## 1. O que já existe e é reaproveitado (sem reescrever)

| Peça | Onde | O que a camada de foco lê |
|---|---|---|
| Curva ABC por receita (80/95) + potencial | `classificarCurvas` `src/lib/diagnostico-conta.js:167` | `itens[].r, r0, u, curva, share_pct, gap_receita, cobertura, estoque, ads` |
| Pareto de anúncios (80 fixo) e de tarefas (ganho alocado, 90 d) | `paretoItens` `src/lib/retroalimentacao.js:222`, `paretoTarefas` `:241`, chamado em `retroalimentar` `:594` | base da curva de concentração; **o corte passa a ser derivado** (§ 3.2), o 80 fica como referência |
| Estado 14×14 com z, confirmação 28×28, sinal misto | `classificarEstado` `src/lib/retroalimentacao.js:37` (`config/retroalimentacao.json → estado`: janela 14, ±10 %, forte 25 %, `min_unidades_base` 8, z 1,645) | tendência de **cada unidade** (produto = soma das séries dos anúncios dele) |
| Estratégia (Sobrevivência/Manutenção/Crescimento/Desenvolvimento) | `classificarEstrategia` `:83` | guarda-chuva: em Sobrevivência nenhuma unidade de risco sai do foco |
| Antes × depois com controle, placebo, confiança, confundidores | `medirEfeito` `src/lib/impacto-tarefas.js:81` (veredito `:184-190`, receita incremental `:195-204`), `confiancaEfeito` `:267`, `excluirDaAprendizagem` `:42`, `alocarIncremental` `:416`, `analisarCliente` `:553`, `medirMarco` `:546` | **efeito medido** por família e por produto = Σ `receita_alocada` das medidas `melhorou` − Σ \|`receita_alocada`\| das `piorou`, só medidas que ensinam |
| Aprendizado por família × estado, veredito Wilson, fator em odds | `aprender` `:142`, `veredito` `:121` (`min_n_aprendizado` 8, `piso_funciona` 0,1), `fatoresDoPlano` `:170` (clamp 0,7–1,35; `isentas_de_aprendizado`), `ajustarNota` `:215` | o «funciona / não funciona / inconclusivo / sem amostra» por família **é** o insumo do veredito de foco; o fator de foco entra pelo mesmo `ajustarNota` |
| Prior bayesiano por família (k = 5, ≥ 5 medidas), Brier/viés, saúde das regras | `priorEfetivo` `src/lib/calibracao.js:23`, `compararPrevisaoRealizado` `:43`, `saudeRegras` `:74` (aposentadoria: n ≥ 10 e Wilson alto < 0,25, `:84`) | **probabilidade calibrada** do veredito = p de a próxima ação da família melhorar; a régua de aposentadoria de regra é a mesma régua de «pausado por evidência» |
| Famílias de demanda (21, curadas) | `familiaDeDemanda` `src/lib/processos.js:21` ← `config/processos-curadoria.json → familias` | unidade «família de ação» (o Notion tem dezenas de grafias) |
| Duplicação por objetivo | `fatorPorObjetivo` `src/lib/duplicacao.js:122` | o canal «duplicação» herda o veredito por objetivo |
| Produto por trás do anúncio (F2, sombra) | `montarGrafo` `src/lib/produto-estoque.js:212`, `chaveAlvo` `:180`, `aplicarProduto` `:359`, `produtoLigado` `:389`; `config/algoritmo.json → produto.diagnostico_ligado = false` | unidade «produto»: enquanto a chave está desligada, produto = anúncio **e a tela diz isso** (hoje `meli_anuncio_up` tem linhas de só 2 clientes) |
| Lucro por linha/anúncio/produto (F4, chave desligada) | `linhaFinanceira` `src/lib/lucro.js:27`, `agregar` `:41` (`ok_lucro` `:66`, margem `:67`), `resumoFin` `:102`, `economiaReal` `:112`; `financeiro.margem_medida_nas_regras = false`, `cobertura_minima` 0,8 | resultado em **LUCRO** só quando a chave estiver ligada e `ok_lucro`; senão receita, dito |
| Capital em estoque | `compras-previsao.js:68/103` (`capital_empatado`, só com custo) | esforço «capital» |
| Verba de Ads por anúncio | `meli_ads_item` (`custo`, `receita`, `periodo`) | esforço «verba» |
| Esforço da equipe | `tarefas` (concluídas, `tipo_demanda`, `processo` ML, 90 d) — **horas não existem no Notion** (NOT_COLLECTED) | esforço «tarefas» (contagem); horas ficam declaradas como não medidas |
| Prioridade da ação | `construirAcao` `src/lib/plano-anuncios.js:687` (`notaBase` `:691`, `fator` `:696`, `nota` `:698`), teto por regra e fila `montarAcoes` `:795-817`, `omitidas` | ponto único de entrada do fator de foco; «não nasce» = `omitidas.foco` |
| Veto/exceção intencional | `criarAlinhamentos` `src/lib/alinhamentos.js:69`, predicado único `alinhado()` consumido em `montarAcoes` `:776` | o veto do consultor ao veredito de foco é um **tipo de alinhamento**, não uma tabela nova de exceções |
| Escada N0–N4, pesos por degrau, holdout escalonado | `docs/desenho-causalidade-executor.md` § 4, § 8 (F2/F5); `src/lib/chaveiro.js` existe (F1); `experimento.js` **não existe** | N3/N4 ficam declarados como «ainda não medível» até a F5 do Chaveiro |
| Retrato do ciclo | `registrarCiclo` `src/lib/retroalimentacao.js:506` (`retro_ciclo`), `cicloAnterior` `:513` | molde do registro do veredito de foco (1 linha por cliente × dia × unidade) |
| Saídas existentes | `/api/cliente/painel` `src/rotas-planos.js:278`, `/api/cliente/retroalimentacao` `:606`, `/api/planos/clientes` `:215`, `/api/planos/insights` `:231`, `/api/merovingio/padroes` `:421`; `secoesConsultor` `src/lib/consultor-discord.js:114`; `BLOCOS`/`montarPlanoSemanal` `src/lib/plano-semana-texto.js:48/153`; `criarBrief` `src/lib/relatorio-brief.js:581`; auditor `src/lib/relatorio-seguro.js:109-121` | onde o bloco «onde concentrar» entra, sem tela nova |

---

## 2. Unidades de foco (§ 1 do pedido)

Uma unidade de foco é `{ tipo, id, rotulo, resultado, esforco, tendencia, efeito, veredito }`. Quatro tipos, um módulo puro (`src/lib/foco.js`) os monta a partir dos objetos acima.

| Tipo | id | «Resultado» (em ordem de preferência; o primeiro disponível é o usado e **a fonte vai escrita**) | «Esforço» |
|---|---|---|---|
| **produto** | `chaveAlvo(p)` do grafo (`up:MLBU…` / `sku:…` / `cat:…`; `item:MLB…` quando o produto não é lido ou a chave está desligada) | 1) **lucro de contribuição 28 d** (`agregar` por produto, só `ok_lucro` e chave ligada) → 2) **receita 28 d** (Σ `itens[].r` dos anúncios do produto) · **receita protegida** = Σ `previsao.valores.conservador` das ações de risco abertas no produto (`estoque_ruptura`, `anuncio_restrito`, `margem_negativa`, saúde) — contada à parte, nunca somada · **unidades 28 d** | tarefas concluídas 90 d vinculadas aos anúncios do produto (`vinculosDe`, `impacto-tarefas.js:458`) · verba de Ads 28 d (`meli_ads_item.custo`) · capital em estoque (`capital_empatado`, só com custo; senão `null`) |
| **família de ação** | `familiaDeDemanda(tipo).id` (21 ids curados) | **efeito medido 90 d**: Σ `receita_alocada` (melhorou) − Σ \|`receita_alocada`\| (piorou), só medidas que ensinam (`!excluirDaAprendizagem`) · taxa de melhora `celula()` com Wilson · n medidas · n «sem resultado mensurável» | tarefas concluídas 90 d da família (medíveis + não medíveis, separadas) · verba só na família `ads` · horas NOT_COLLECTED |
| **canal de esforço** | lista fechada: `ads` (ads) · `conteudo` (imagens, otimizar, ficha, corrigir, variacoes, loja) · `preco` (precos, oferta_relampago, cupom) · `promocao` (campanhas_desconto) · `estoque` (full, custos) · `duplicacao` (duplicacao, cadastro, kits) · `outro` (afiliados, transmissao, pesquisa, interna) | soma das famílias do canal; em `ads` entra também a receita atribuída (`meli_ads_item.receita`) e o ROAS/TACOS da conta (`diag.ads`) | soma das famílias; em `ads` a verba é o esforço principal |
| **cliente** (carteira) | nome do cliente (Ativo, com integração ML — `integracaoMlAtiva`) | receita 28 d (lucro quando houver) · ganho medido 90 d (`analisarCliente(c).resumo.ganho_associado − perda_associada`) · estado | tarefas concluídas 90 d · ações do plano distribuídas · consultor/squad (`clientes_central`) |

Regras duras das unidades:
- **Lucro só com a F4 ligada e `ok_lucro`**; a linha diz `resultado.fonte: 'lucro (cobertura 86 %)' | 'receita (sem custo informado)'`. Nunca se mistura lucro de um produto com receita de outro na mesma curva: se **algum** produto da conta não tem lucro, a curva inteira é de receita (e diz por quê).
- Receita protegida nunca entra no ranking de resultado — aparece ao lado («R$ 3.200 em risco por ruptura»). Uma unidade com risco aberto **não pode** receber veredito «pausado».
- Esforço em horas não existe: a tela escreve «tarefas: 26 (horas não registradas no Notion)».
- Produto = anúncio enquanto `produto.diagnostico_ligado = false`; a tela mostra «produto = anúncio (agrupamento em sombra até a F3)» e, para os 2 clientes com `meli_anuncio_up`, a aba Produtos já permite a conferência.
- Família: tarefa que não cita anúncio (`itens = []`) vira medida de **conta inteira** (`escopo: 'conta'`, nunca entra no aprendizado — `impacto-tarefas.js:298`): conta como **esforço** da família, não como resultado. Isso é a honestidade principal do foco por família (ver o exemplo real: 93 tarefas, 1 com anúncio citado).

---

## 3. Janelas 15 / 30 / 45 / 60 / 90 dias (§ 2 do pedido)

### 3.1 O que cada marco consegue afirmar

`D0` = início da coleta do cliente (`coberturaPedidos(c).de`) **ou** início do ciclo (data do primeiro plano aprovado), o que for mais recente — o marco é relativo a dados, não ao calendário. As exigências vêm das janelas que já existem: estado 14×14 precisa de 28 d de série (`classificarEstado:40`), confirmação 28×28 precisa de 56 d, uma medida de tarefa precisa de pré 14 + lag 3 + pós 14 = 31 d após D0 (`medirEfeito:102-110`, janelas adaptativas 14/21/28), prior calibrado precisa de 5 medidas (`min_n_padrao`), veredito de família precisa de 8 (`min_n_aprendizado`).

| Marco | Curva de concentração (produto) | Tendência (estado) | Efeito medido (família / produto) | Degrau | Veredito permitido |
|---|---|---|---|---|---|
| **15 d** | só com 14 d de série: curva de **14 d**, rotulada «provisória (14 d)»; corte derivado existe, mas a tela diz «estabiliza aos 28 d» | `sem_base` (precisa de 28 d) — só a variação 7 d × 7 d como **leitura**, nunca classe | nenhuma medida completa (pós ainda em maturação) | N0 | **nenhum**: só «em observação»; a única decisão de foco é a de risco (ruptura/saúde), que não depende de medida |
| **30 d** | curva de 28 d (a mesma de `classificarCurvas`), corte derivado + 80 de referência; top1 e Gini | estado 14×14 com z (`classificarEstado`), sem confirmação de 28×28 → `sinal_misto` possível | primeiras medidas N1 das tarefas feitas até D+1 (poucas) | N1 | `manter` para o topo da curva com risco tratado; `reduzir` só por **esforço sem alvo** (família cujas tarefas não citam anúncio e cujo canal não move o elo rompido); nada de `pausado` |
| **45 d** | curva 28 d; comparação com a curva de 15 d (quem entrou/saiu do topo) | 14×14 confirmado por 28×28 quando há 56 d (senão «em confirmação») | famílias com ≥ 5 medidas ganham `priorEfetivo` calibrado (`calibracao.js:32`); `taxaHistorica` começa a entrar na confiança | N1 (N2 quando a F2 do Chaveiro existir) | `manter_e_escalar` para unidade no topo com `estado = crescimento` significativo **e** efeito medido positivo; `reduzir` com evidência: n ≥ 5 e Wilson alto < taxa base |
| **60 d** | curva 28 d × 28 d anteriores: **produtos em ascensão/queda** pelo z do estado da unidade | duas janelas completas: tendência da unidade com classe e força | famílias com ≥ 8 medidas recebem `veredito()` (`funciona` / `nao_funciona` / `inconclusivo`); `fatoresDoPlano` tipo × estado | N1/N2 | `pausado_por_evidencia` passa a ser possível (§ 4), só com n ≥ 8, Wilson alto < base, sem risco aberto e fora de Sobrevivência |
| **90 d** | curva de **ganho medido** por família (`paretoTarefas`, janela 90 d — `retroalimentar:594`) cruzada com a curva de receita por produto | série de 3 estados (histórico `retro_ciclo`) | ciclo fechado: previsto × realizado por regra (Brier, viés — `compararPrevisaoRealizado`), combos (`combos:270`), pior tarefa (`piorTarefa:340`) | N1/N2; N3 só quando o Chaveiro F5 tiver sorteado holdout (hoje: «não medível», declarado) | veredito completo nas 4 unidades; **retroalimentação dos priors** (§ 6) |

Toda linha do marco carrega `afirmavel: true|false` e `motivo`. O marco **não** avança por calendário: se a coleta parou 6 dias (`qualidadeNoIntervalo`, `retroalimentar:545`), o marco diz «janela com lacuna — 45 d só em DD/MM».

### 3.2 Curva de concentração com corte derivado (não 80 fixo)

`curvaConcentracao(unidades, campo)` em `foco.js` (pura):
1. Ordena por `resultado[campo]` desc, descarta ≤ 0 (como `paretoItens:223`).
2. `acum_pct(i)`; **corte derivado** = índice que maximiza `acum_pct(i) − 100·i/n` (o ponto da curva mais distante da diagonal «tudo igual» — o joelho; determinístico, sem parâmetro). Com n < 5, corte = n (sem concentração afirmável, dito).
3. Devolve `{ n, n_corte, share_corte_pct, n_80, n_50, top1_pct, gini, cauda: n − n_corte, itens_topo[], itens_cauda[] }`. `gini = 1 − 2·área sob a curva normalizada` (0 = tudo igual, 1 = um só).
4. Leitura fixa: «{n_corte} de {n} produtos ({share_corte}%) concentram o resultado; 80 % precisa de {n_80}». O 80 continua existindo porque `concentracao_receita` e `top1_alerta_pct` (`config/retroalimentacao.json → pareto`) já o usam; nenhum deles muda.

A **mesma** função roda sobre famílias (campo = efeito medido) e sobre clientes (campo = receita ou ganho medido). Uma família só entra na curva de efeito com `n ≥ min_n_aprendizado`; abaixo disso fica em «ainda sem medida suficiente (n/8)», fora da curva e fora de qualquer veredito negativo.

### 3.3 Tendência por unidade

- **Produto**: `classificarEstado({ serie: soma das séries dos anúncios do produto (itensSerie:608), ate, cob })` — o mesmo que `retroalimentar` já faz por curva A/B/C (`:578-584`); sai `crescimento | estagnacao | queda | sem_base`, z, força, sinal misto. Produto com `ub < min_unidades_base` (8) é `sem_base`, e a tela escreve «vende pouco para medir tendência».
- **Família**: não tem série; a tendência é a **taxa de melhora das últimas 8 medidas × 8 anteriores** (duas células `celula()`), só quando as duas têm n ≥ 8; senão `em_observacao`. Nunca se extrapola taxa de 3 medidas.
- **Cliente**: o `estado` de `retroalimentar` (já existe).

### 3.4 Efeito medido por família e por produto

`efeitoDaUnidade(medidas, filtro)` reaproveita `aprender()` (`retroalimentacao.js:142`) — a célula `{ n, melhorou, piorou, sem_efeito, taxa, taxa_baixo, taxa_alto, efeito_mediano_pct, receita_alocada, veredito }` já é exatamente o que o foco precisa. O foco acrescenta: `ganho_liquido = Σ receita_alocada(melhorou) − Σ |receita_alocada(piorou)|`, `n_confundidas` e `n_sem_vinculo` (tarefas da família que não citam anúncio — esforço invisível ao resultado), `degrau_predominante` (N1 hoje; `evidencia.nivel` quando a F2 do Chaveiro existir).

---

## 4. Decisão: matriz resultado × esforço → 4 vereditos (§ 3 do pedido)

### 4.1 Eixos (ambos relativos à própria conta, nunca número universal)

- `R` = participação da unidade no resultado (`share_pct` na curva de concentração). `R_alto` = unidade dentro do corte derivado.
- `E` = participação da unidade no esforço (tarefas 90 d; em `ads`, verba; em produto, tarefas + verba + capital normalizados pela conta). `E_alto` = participação no esforço > participação no resultado × `c.razao_esforco` (1,5) **e** ≥ `c.min_esforco_pct` (10 %).
- `M` = efeito medido: `funciona | inconclusivo | nao_funciona | sem_amostra` (veredito Wilson de `celula()`, n ≥ 8) — para produto, M é o veredito das medidas cujos `itens` pertencem ao produto.
- `T` = tendência (§ 3.3). `risco` = há ação de risco aberta na unidade (ruptura, restrito, margem negativa, saúde) ou `estrategia.classe = 'Sobrevivência'`.

### 4.2 Matriz

| Veredito | Condição (todas) | Fator na prioridade (`construirAcao:696`) | Revisão |
|---|---|---|---|
| **manter e escalar** | `R_alto` **e** (`M = funciona` **ou** (`T = crescimento` significativo **e** `M ≠ nao_funciona`)) **e** sem `risco` não tratado | ×1,10 nas ações da unidade (dentro do clamp 0,7–1,35 de `fatoresDoPlano`) | 30 d |
| **manter** | `R_alto` **e** `M ∈ {inconclusivo, sem_amostra}`; **ou** qualquer unidade com `risco` (risco nunca sai do foco) | ×1,00 | 30 d |
| **reduzir** | **não** `R_alto` **e** `E_alto` **e** `M ∈ {inconclusivo, sem_amostra}` (ou família cujas tarefas em ≥ 70 % não citam anúncio — esforço sem alvo) | ×0,85 nas ações da unidade (o mesmo tamanho do ajuste tipo × estado `ajuste_estado_min`) | 30 d |
| **pausado por evidência** | **não** `R_alto` **e** `E_alto` **e** `M = nao_funciona` com `n ≥ 8` e `taxa_alto < base` (`veredito():125`) **e** marco ≥ 60 d **e** sem `risco` **e** fora de Sobrevivência **e** sem veto | ações da unidade **não nascem** (`omitidas.foco`), exceto a **sentinela** (§ 6.2) e as regras isentas/de risco (`isentas_de_aprendizado`, saúde) | 30 d; expira em 90 d sem medida nova |

Tudo que não casa é **«em observação»** (fator 1,0, sem veredito) — e a tela diz qual critério faltou (`faltam: ['n medidas: 3/8', 'marco: 45/60']`).

### 4.3 Probabilidade calibrada do veredito

`p` = probabilidade de que **a próxima ação nesta unidade melhore o resultado**, calculada com o que já existe, nesta ordem (a fonte vai no texto):
1. família: `priorEfetivo(regra da família)` (`calibracao.js:23`) = `(k + 5·p₀)/(n + 5)` sobre todos os clientes; encolhido para a **conta** com o mesmo k = 5 quando a conta tem ≥ 8 medidas (`fatoresDoPlano:190` já faz `pEst = (e.k + K·pT)/(e.n + K)`); intervalo = Wilson da célula da conta (ou da base, dito).
2. produto: média das `p` das famílias que o tocaram nos 90 d, ponderada por n; sem medida, `p` da família mais provável do elo rompido (`diagnosticarQueda:369`), rotulada «premissa».
3. canal: soma das famílias.

O veredito só é **afirmado** quando o intervalo decide: `manter_e_escalar` exige `taxa_baixo > base` (como `veredito()`), `pausado` exige `taxa_alto < base`. `reduzir` e `manter` não afirmam nada sobre causa — só sobre proporção de esforço. Brier do veredito entra na mesma tabela de calibração (§ 6.3).

### 4.4 Custo de oportunidade (sempre «estimativa, premissa: retorno passado»)

`custo_oportunidade(u) = E_u × (retorno_melhor − retorno_u)`, onde `retorno_x = ganho_liquido_x ÷ esforço_x` (R$ de receita alocada por tarefa; em Ads, por R$ de verba = ROAS marginal observado), e `melhor` = a unidade do mesmo tipo com maior retorno **e** n ≥ 8. Sai como «se as 14 tarefas de Cadastro tivessem o retorno médio de Otimizar anúncios nesta conta, seriam ≈ R$ 2.100 (estimativa pelo retorno passado; não é previsão)». Sem unidade com n ≥ 8, `custo_oportunidade = null` com motivo. Nunca entra na prioridade; é texto de decisão.

### 4.5 O foco no plano (sem segundo motor)

- `fatorFoco(vereditos, spec)` (puro) devolve `{ fator, veredito, motivo }` para a ação: por produto (`spec.item` → produto), por família (`nomeFamilia(regra.tipo_demanda)`), por canal. Quando mais de uma unidade pesa, vale o **menor** fator (nunca multiplica dois cortes).
- Entra em `construirAcao` `src/lib/plano-anuncios.js:696`: `const fator = (…existente…) * (foco?.fator ?? 1)` e `dados.retro.motivo` ganha o texto; `dados.foco = { unidade, veredito, p, revisar_em }`.
- `montarAcoes:784`: spec cuja unidade está `pausado_por_evidencia` sai antes do teto com `conta('foco')`, **exceto** regras em `isentas_de_aprendizado`, de saúde (`tipoDaRegra = 'saude' | 'disponibilidade'`) e a sentinela.
- Chave global `foco_no_plano` em `sync_estado` (`getEstado`, `src/lib/db.js:326`) **nasce `'0'`**: o foco é só leitura (tela, relatório, Discord) até um líder ligar; com `'0'` o plano sai **byte a byte igual** (teste).
- Veto: tipo novo de alinhamento `foco_manter` em `config/alinhamentos.json → tipos` («o consultor/cliente decidiu manter esta unidade apesar da evidência»; motivo obrigatório; revisão 30 d; texto ao cliente fixo). O predicado `alinhado({ foco: unidade })` é consultado por `vereditoFoco` **antes** de gravar `pausado`: com veto, o veredito vira `manter (veto: …)` e nada some. Nenhum módulo ganha exceção própria (regra da `docs/alinhamentos.md`).
- Linguagem ao cliente: «associação ≠ causa» é garantido pelo `relatorio-seguro.js` (códigos `causalidade:115`, `promessa:114`). Texto fixo por veredito em `config/foco.json → texto_cliente`: `manter_e_escalar` → «é onde o resultado está se concentrando; seguimos reforçando»; `reduzir` → «vamos diminuir o ritmo aqui e medir»; `pausado` → «deixamos em pausa para medir melhor — nada foi apagado». `nao_funciona` **nunca** vai ao cliente (sai «ainda sem resultado medido»); N1/N2 nunca aparecem crus.

---

## 5. Saídas (§ 4 do pedido) — ≤ 6 colunas, 1 primário, honestidade

| Onde | O que | Fonte |
|---|---|---|
| **`/cliente` › Resumo › «Foco da conta»** (`#secFoco`, depois de «Próximas ações», antes da Execução do plano) | frase-veredito («4 produtos concentram 62 % da receita; Otimizar anúncios é a família com resultado medido; Cadastro consome 15 % do esforço sem alvo medido»); 4 grupos (manter e escalar · manter · reduzir · pausado) como listas curtas; tabela ≤ 6 colunas: Unidade · Resultado (R$, fonte) · Esforço · Efeito medido (n, veredito) · Veredito (p, intervalo) · Revisar em; **linha do tempo 15 → 90 d** com o marco atual marcado e o que cada marco pôde afirmar (`afirmavel/motivo`). Sem botão primário novo; menu «⋯» com «Manter no foco (veto)» que abre o diálogo de alinhamento existente | `GET /api/cliente/foco` |
| **Plano semanal ao cliente** (terça 09:00, `montarPlanoSemanal`) | bloco `🎯 Onde concentrar` em `BLOCOS` (`plano-semana-texto.js:48`), ≤ 3 linhas, só `manter_e_escalar` e `reduzir` em voz do cliente; `pausado` só quando mudou nesta semana; passa por `relatorio-seguro` | `dadosPlanoSemana` (`gatilhos-real.js:95`) ganha `foco` |
| **Resumo ao consultor no Discord** (terça 08:30) | seção `🎯 Onde concentrar` em `secoesConsultor` (`consultor-discord.js:114`) com os vereditos novos/alterados da semana e o custo de oportunidade (interno) | mesma função |
| **Relatório curto ao Notion** (`criarBrief:581`) | em `proximos`, 1 linha «Onde concentrar» (as unidades `manter_e_escalar`), auditada | `projetarBrief:210` |
| **Carteira `/planos`** (`#secFocoCarteira`, ao lado de «Padrões da base») | curva de concentração de **clientes** por receita 28 d e por ganho medido 90 d (corte derivado), **famílias que concentram o resultado medido da Place2u** (todas as contas, `padroesGlobais`), e a tabela ≤ 6 colunas: Cliente · Receita 28 d · Ganho medido 90 d · Estado · Esforço (tarefas) · Veredito. Sem veredito de «sair do foco» para cliente: na carteira os vereditos são `concentra` / `em observação` / `esforço sem resultado medido`; a decisão comercial é humana | `GET /api/planos/foco` (escopo/filtros `?f=` como `/api/planos/clientes`) |

Regras de tela: valor de KPI sem cor; ponto de estado + palavra; nenhuma cor nova em `ui.css`; ids `#focoVeredito`, `#focoTabela`, `#focoLinhaTempo`, `#focoCarteira`.

---

## 6. Aprendizado e viés de sobrevivência (§ 5 do pedido)

### 6.1 O veredito de 90 d retroalimenta os priors
- `foco_veredito` é lido por `padroesGlobais` (`impacto-tarefas.js:593`) como **contexto da medida**: cada medida ganha `foco_na_epoca ∈ {dentro, fora, pausado, sem_veredito}` (o veredito vigente na data da tarefa). `aprender()` passa a devolver, além de `por_tipo_estado`, `por_tipo_foco` — e `fatoresDoPlano` ganha o terceiro estágio de encolhimento já previsto para nicho (conta → nicho → base, `:193-199`): família × estado × **foco**. Só ajusta `quanto` (nunca `se`), com `min_n_aprendizado` e Wilson, como hoje.
- Aos 90 d, `avaliarVeredito` compara cada veredito gravado com o que aconteceu: unidade `pausado` cuja receita **subiu** (z significativo) sem ação nossa → `veredito_errado: 'pausa_nao_explicava'`; unidade `manter_e_escalar` que caiu → `'escala_nao_sustentou'`. Entra na tabela de calibração ao lado do Brier das regras (`compararPrevisaoRealizado`), com a mesma leitura «viés > 0 = o foco superestima».

### 6.2 Contra o viés de sobrevivência («parar de investir e depois "provar" que não dava»)
1. **Pausar ≠ parar de medir.** A unidade pausada mantém **1 ação sentinela a cada 30 d** (a regra de maior `p` da família, em 1 anúncio curva B do produto, nunca curva A) — é o holdout escalonado da F5 do Chaveiro aplicado ao contrário: quem está fora do foco continua recebendo uma dose mínima para a família continuar produzindo medidas. Sem sentinela medida, o veredito **não se renova**.
2. **Veredito negativo expira.** `pausado_por_evidencia` vale 90 d; sem medida nova (sentinela) ele cai para `inconclusivo` — ausência de medida nunca vira prova. A tela mostra «pausado desde DD/MM; 2 medidas de sentinela; expira em DD/MM».
3. **Séries nunca param.** Produto pausado continua em `meli_serie_item`, na curva de concentração e no estado — se ele voltar a crescer sozinho, o item 6.1 registra o erro do veredito.
4. **Viés de seleção declarado.** Toda medida de família já carrega o limite «tarefas vão para anúncios que já caíam» (`config/retroalimentacao.json → limites[2]`); o foco repete o aviso ao lado de todo `nao_funciona` e nunca usa `nao_funciona` para pausar uma família em `Sobrevivência` (o estado explica a piora, não a tarefa).
5. **Reversão à média e confundidores** já saem do aprendizado (`excluirDaAprendizagem`); o foco conta quantas medidas foram excluídas por unidade e, se ≥ 50 % das medidas da família estão excluídas, a família fica `em_observacao` (não dá para julgar o que não se mediu).
6. **Experimento quando existir.** Com a F5 do Chaveiro, a sentinela passa a ser sorteada (braço) e o veredito de família pode citar N3; até lá o degrau máximo escrito é N1/N2 e o texto diz «sem experimento ainda».

### 6.3 Calibração do próprio foco
Tabela `foco_veredito` + função `calibracaoFoco()`: por tipo de unidade e veredito → n, acertos (resultado da unidade andou na direção prevista em 30 d, z significativo), Brier de `p`, viés. Vai à tela `/metodologia` ao lado da saúde das regras. Veredito com Brier > 0,3 em n ≥ 10 → rebaixado automaticamente a `em_observacao` até revisão humana (mesma régua de aposentadoria das regras).

---

## 7. Modelo de dados (DDL aditiva), funções, rotas, testes, fases (§ 6 do pedido)

### 7.1 DDL (em `src/lib/foco-schema.js`, importado por `db.js` como os outros `SCHEMA_*`; idempotente; os testes sobem o mesmo DDL em memória)

```sql
CREATE TABLE IF NOT EXISTS foco_veredito (            -- 1 linha por cliente × dia × unidade: o retrato do veredito (molde de retro_ciclo)
  cliente TEXT NOT NULL, dia TEXT NOT NULL,
  unidade_tipo TEXT NOT NULL CHECK (unidade_tipo IN ('produto','familia','canal','cliente')),
  unidade_id TEXT NOT NULL,                            -- chaveAlvo | id da família | canal | nome do cliente
  marco INTEGER NOT NULL CHECK (marco IN (0,15,30,45,60,90)),
  veredito TEXT NOT NULL CHECK (veredito IN ('em_observacao','manter_e_escalar','manter','reduzir','pausado_por_evidencia')),
  p REAL, p_baixo REAL, p_alto REAL, n INTEGER NOT NULL DEFAULT 0,
  resultado_json TEXT NOT NULL DEFAULT '{}',           -- {campo:'receita'|'lucro', valor_c, share_pct, protegida_c, fonte}
  esforco_json TEXT NOT NULL DEFAULT '{}',             -- {tarefas, verba_c, capital_c|null, horas:'NOT_COLLECTED'}
  efeito_json TEXT NOT NULL DEFAULT '{}',              -- celula() + ganho_liquido + degrau + excluidas
  custo_oportunidade_c INTEGER,                        -- null com motivo em motivo_json
  motivo_json TEXT NOT NULL DEFAULT '{}',              -- criterios que casaram / faltaram; volta_se[]
  veto_alinhamento_id TEXT NOT NULL DEFAULT '',        -- alinhamento 'foco_manter' que segurou o veredito
  revisar_em TEXT NOT NULL, expira_em TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL,
  PRIMARY KEY (cliente, dia, unidade_tipo, unidade_id));
CREATE INDEX IF NOT EXISTS ix_foco_unidade ON foco_veredito (cliente, unidade_tipo, unidade_id, dia);

CREATE TABLE IF NOT EXISTS foco_sentinela (           -- a dose mínima da unidade pausada (anti-sobrevivência)
  id TEXT PRIMARY KEY,                                 -- FS-<sha curto>
  cliente TEXT NOT NULL, unidade_tipo TEXT NOT NULL, unidade_id TEXT NOT NULL,
  acao_id TEXT NOT NULL DEFAULT '',                    -- acoes_plano.id da ação sentinela (nasce pelas regras do plano, só marcada)
  item_id TEXT NOT NULL DEFAULT '', familia TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'prevista' CHECK (estado IN ('prevista','distribuida','medida','sem_medida')),
  prevista_para TEXT NOT NULL, medida_em TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL);
```

Ampliações sem `ALTER`: `acoes_plano.dados_json` ganha `foco {unidade, veredito, p, fator, sentinela:boolean}` (campo no JSON, como `retro` e `execucao`); `sync_estado` ganha `foco_no_plano` (`'0'` enquanto nunca gravada); `config/alinhamentos.json → tipos.foco_manter`; `config/foco.json` (novo): `{ razao_esforco: 1.5, min_esforco_pct: 10, fator: { manter_e_escalar: 1.10, reduzir: 0.85 }, marcos: [15,30,45,60,90], pausa: { min_marco: 60, min_n: 8, revisar_dias: 30, expira_dias: 90, sentinela_dias: 30 }, canais: {…lista fechada § 2…}, texto_cliente: {…} }`. Nenhuma coluna de tabela existente muda.

### 7.2 Funções

**`src/lib/foco.js`** — puro, sem banco e sem rede (testável com objetos sintéticos como `teste-retroalimentacao.mjs`).
```js
export const CANAIS = { ads:['ads'], conteudo:['imagens','otimizar','ficha','corrigir','variacoes','loja'], preco:['precos','oferta_relampago','cupom'], promocao:['campanhas_desconto'], estoque:['full','custos'], duplicacao:['duplicacao','cadastro','kits'], outro:['afiliados','transmissao','pesquisa','interna'] }
export function montarUnidades({ itens, grafo = null, medidas, tarefas, ads = new Map(), financeiro = null, compras = null, acoesRisco = [], hoje, cfg })   // → { produtos[], familias[], canais[], fonte_resultado, avisos[] }
export function curvaConcentracao(unidades, campo = 'resultado')                                     // → { n, n_corte, share_corte_pct, n_80, n_50, top1_pct, gini, topo[], cauda[] }
export function tendenciaUnidade(u, { serie, ate, cob, c })                                          // produto: classificarEstado; família: 8×8 medidas; → { estado, z, forca, sinal_misto, motivo }
export function efeitoDaUnidade(medidas, pertence)                                                   // reaproveita aprender().celula + ganho_liquido + excluidas + n_sem_vinculo
export function marcoAtual({ cob, inicioCiclo, hoje, lacunas, cfg })                                 // → { marco, dias, proximo_em, afirmavel: { curva, estado, efeito, veredito }, motivos[] }
export function vereditoFoco(u, { curva, prior, base, marco, estrategia, veto = null, cfg })         // → { veredito, p, p_baixo, p_alto, n, fator, custo_oportunidade_c, motivo, faltam[], volta_se[], revisar_em, expira_em }
export function fatorFoco(vereditos, spec)                                                           // → { fator, veredito, motivo } (o menor fator entre produto/família/canal)
export function linhaDoTempo({ cob, inicioCiclo, hoje, historico, cfg })                             // 15→90: cada marco com atingido/afirmavel/motivo + veredito da época
export function sentinelaDevida(u, { sentinelas, hoje, cfg })                                       // → { devida: bool, item_id?, familia?, motivo }
export function avaliarVeredito(v, { estadoDepois })                                                 // → { acertou, erro: null|'pausa_nao_explicava'|'escala_nao_sustentou'|…, brier }
```

**`src/lib/foco-real.js`** — com banco: `focoDoCliente(cliente, { hoje, diag, retro, analise })` (lê `diagnosticarConta`, `retroalimentar`, `analisarCliente`, `montarGrafo` em sombra, `agregar` quando a chave da F4 estiver ligada, `meli_ads_item`, `tarefas`, `preverCompras`; devolve o objeto do § 5 e, com `salvar: true`, grava `foco_veredito`), `focoDaCarteira({ escopo, f })` (sobre `padroesGlobais` + `clientes_central`), `registrarSentinelas(cliente)`, `calibracaoFoco()`, `vetarFoco({ cliente, unidade, motivo, por, confirmar })` (cria o alinhamento `foco_manter`; prévia por padrão).

**`src/rotas-foco.js`** (`rotasFoco`, montado em `server.js` como os outros): `GET /api/cliente/foco?cliente=` · `GET /api/planos/foco[?f=]` · `GET /api/foco/calibracao` · `POST /api/cliente/foco/veto { cliente, unidade_tipo, unidade_id, motivo, por, confirmar }` (líder/consultor/CS do cliente, `lideresEConsultores` `src/lib/equipe.js:128`; motivo da lista) · `POST /api/foco/chave { ligado, por }` (líder). Isolamento por cliente; prospect `[Comercial]` → 400 fixo; mensagens nunca ecoam o valor recebido.

**Edições cirúrgicas** (nenhuma muda assinatura pública):

| Arquivo | Edição |
|---|---|
| `src/lib/plano-anuncios.js:696` | `fator *= foco?.fator ?? 1`; `dados.foco`; `montarAcoes:784` conta `omitidas.foco` quando `foco_no_plano = '1'` e marca `dados.foco.sentinela` |
| `src/lib/retroalimentacao.js:590` | `out.foco = focoDoCliente(...)` **só leitura** (sem gravar) para `/api/cliente/retroalimentacao` já expor; `aprender()` ganha `por_tipo_foco`; `fatoresDoPlano` ganha o estágio foco (mesmo molde do nicho) |
| `src/lib/impacto-tarefas.js:593` | `padroesGlobais` anexa `foco_na_epoca` a cada medida (lendo `foco_veredito` vigente na data) |
| `src/lib/calibracao.js` | `saudeRegras` devolve também `calibracaoFoco()` para `/metodologia` |
| `src/lib/gatilhos-real.js:95` | `dadosPlanoSemana` devolve `foco` (só vereditos `manter_e_escalar`/`reduzir` e mudanças da semana) |
| `src/lib/plano-semana-texto.js:48` | `BLOCOS.foco = ['🎯', 'Onde concentrar']`, ≤ 3 linhas, texto fixo de `config/foco.json` |
| `src/lib/consultor-discord.js:114` | seção «🎯 Onde concentrar» (interna: inclui custo de oportunidade e `nao_funciona`) |
| `src/lib/relatorio-brief.js:210` | 1 linha em `proximos` |
| `src/lib/relatorio-seguro.js` | código novo `degrau_cru` (barra «N1», «N2», «nao_funciona» no texto do cliente) |
| `config/alinhamentos.json` | tipo `foco_manter` (texto ao cliente, revisão 30 d, motivo obrigatório) |
| `src/web/cliente.js`, `src/web/planos.js`, `docs/ux/inventario-cliente.json` | `#secFoco`, `#secFocoCarteira` |
| `src/lib/db.js` | importa `SCHEMA_FOCO` |

Nunca tocados: `src/web/alerta.js`, `src/lib/notion.js`, escrita no ML.

### 7.3 Testes (`scripts/teste-foco.mjs` + blocos novos)

- **Curva**: com 10 unidades iguais o corte derivado = n e `gini ≈ 0`; com uma unidade de 90 % o corte = 1; o corte derivado ≠ 80 fixo num caso construído (3 de 20 fazem 70 %, 80 % só com 9) e `n_80` continua sendo 9.
- **Marcos**: série de 20 dias → marco 15 com `afirmavel.estado = false`; 40 dias → 30 com efeito só «em maturação»; lacuna de 6 dias adia o marco.
- **Veredito**: `pausado` só com n ≥ 8, `taxa_alto < base`, marco ≥ 60, sem risco, fora de Sobrevivência; com risco aberto → `manter`; com veto → `manter (veto)`; família com 70 % de tarefas sem anúncio → `reduzir` e `custo_oportunidade = null` sem unidade comparável; `p` igual ao `priorEfetivo` quando a conta tem < 8 medidas.
- **Fator**: `fatorFoco` nunca fora de [0,85; 1,10]; produto `reduzir` × família `manter_e_escalar` → 0,85 (o menor); regra isenta ou de saúde ignora `pausado`.
- **Sentinela**: unidade pausada há 30 d sem medida → `sentinelaDevida = true`; veredito expira em 90 d sem medida → `inconclusivo`.
- **Honestidade**: sem custo → `resultado.campo = 'receita'` e lucro `null`; produto sem UP → id `item:`; horas `NOT_COLLECTED`.
- **Plano idêntico com a chave desligada**: bloco novo em `teste-plano-anuncios.mjs` (como o da F4: `scripts/conferir-financeiro.mjs --plano`) — prévia do plano semanal, ações e compras byte a byte iguais com `foco_no_plano = '0'`.
- `teste-retroalimentacao.mjs`: `aprender()` com `foco_na_epoca` e `fatoresDoPlano` com o estágio foco neutro sem amostra.
- `teste-relatorio-seguro.mjs`: `degrau_cru`.
- `teste-shell-ui.mjs`: ids novos presentes.

### 7.4 Fases publicáveis (cada uma com todos os `teste-*.mjs` passando; nenhuma reinicia o servidor fora do fluxo)

| Fase | Entrega | Critério de pronto |
|---|---|---|
| **F0** | este desenho; as 3 respostas do David | — |
| **F1 — leitura** | `foco.js` + `foco-real.js` + `GET /api/cliente/foco` + `#secFoco` com os 4 grupos e a linha do tempo; `retroalimentar().foco`; chave `foco_no_plano = '0'` | plano byte a byte igual; `teste-foco.mjs`; os 3 clientes de conferência (Uniaodog, Rotec, 01Smart) + o cliente do exemplo com a tela conferida pelo David |
| **F2 — comunicação** | bloco 🎯 no plano semanal, no Discord do consultor e no brief; `degrau_cru` no auditor; `GET /api/planos/foco` + `#secFocoCarteira` | prévia de terça com o bloco auditada; nenhuma frase barrada |
| **F3 — no plano** | `fatorFoco` em `construirAcao`, `omitidas.foco`, veto `foco_manter`, sentinela, `foco_veredito` gravado no ciclo; líder liga a chave por cliente | antes × depois do plano de 3 clientes registrado; nenhuma regra de risco/saúde omitida (teste) |
| **F4 — aprendizado** | `foco_na_epoca` nas medidas, estágio foco em `fatoresDoPlano`, `avaliarVeredito`, `calibracaoFoco` em `/metodologia`, expiração | primeiro ciclo de 90 d avaliado; Brier do veredito publicado |
| **F5 — experimento** | depende da F5 do Chaveiro (`experimento.js`): sentinela sorteada; vereditos podem citar N3 | só após a resposta P1 do desenho de causalidade |

### 7.5 Riscos

| Risco | Mitigação |
|---|---|
| Pausar o que só «não foi medido» (tarefa sem anúncio citado) | `n_sem_vinculo` separado; família com ≥ 70 % sem vínculo vira `reduzir` (esforço sem alvo), nunca `pausado`; sem medida = `em_observacao` |
| Concentrar demais e matar a cauda que vira o próximo campeão | sentinela obrigatória; curva de 28 d × anterior detecta produto subindo (z) e promove antes do próximo marco; `potencial = 1` (`classificarCurvas:21`) protege anúncio com gap de conversão |
| Pareto de receita ≠ Pareto de lucro | lucro só com F4 ligada e `ok_lucro`; curva de receita sempre rotulada; quando as duas existirem, a tela mostra as duas e o veredito usa lucro |
| Viés de seleção das tarefas | aviso fixo em todo `nao_funciona`; `Sobrevivência` bloqueia pausa; expiração |
| Dois cortes se somando (foco × estado × proteção) | o fator de foco é o **menor** entre unidades e o produto final continua dentro do clamp 0,7–1,35 (`fatoresDoPlano`) — assert no teste |
| Texto «não funciona» chegar ao cliente | `relatorio-seguro` + textos fixos de `config/foco.json` |
| Produto = anúncio enquanto a F3 da V3 não liga | declarado na tela; para os clientes com `meli_anuncio_up` a conferência já é possível |
| Carteira ser lida como ranking de cliente «ruim» | na carteira não existe `pausado`; veredito máximo «esforço sem resultado medido», decisão humana |

---

## 8. Atribuição: qual tarefa (ou combinação de estratégias) gerou o resultado no anúncio

> Pedido adicional do David (15/10, ~02h05): saber **exatamente** a tarefa realizada que aumentou o faturamento de um anúncio — ou a combinação. Esta seção é a ponte entre o que o Merovíngio já mede (antes × depois com controle) e o 80/20 por família: o 80/20 só é honesto se cada ganho tiver um **marco** por anúncio.

### 8.1 Diagnóstico do que existe (e por que hoje a atribuição quase não acontece)

- A medição **por tarefa** já é completa: `analisarCliente` (`src/lib/impacto-tarefas.js:553`) lê as tarefas concluídas do ML, acha os anúncios pelo vínculo (`criarVinculos` `src/lib/vinculos.js:55`, só origens `citado | plano | confirmado` — `:75`), mede cada uma com janela adaptativa, controle, placebo e confundidores (`medirMarcoNoContexto` `:504`) e aloca a receita incremental dividindo pelos concorrentes do mesmo dia e anúncio (`alocarIncremental` `:416`).
- A medição **por mudança observada** também já existe: `medirMarco(cliente, item_id, data)` (`:546`) mede um marco que **não é tarefa** — a própria data entra nos placebos e as tarefas da lista contam como concorrentes. `piorouDepoisDe` (`src/lib/anuncio-historico.js:182`) já chama `medirMarco` para cada par de snapshots do anúncio e devolve veredito + diff.
- O **change-log por anúncio** (`meli_item_mudanca`, `src/lib/acomp-schema.js:6-13`) grava 1 linha por dia × campo × fonte: `preco, preco_original, titulo, fotos, estoque_zero, status, frete_gratis, logistica, thumb, promocao, ads, descricao, atributos, categoria, tipo_anuncio`, fontes `coleta | acomp | promo | ofertas | webhook | ads`. `eventosAnuncio` (`src/lib/preco-historico.js:100`) lê por anúncio/janela/campo e marca `incerteza` («mudou entre X e Y») quando a fonte é uma fotografia (`tarefa_acomp`). `mudancasNoAnuncio` + `rotuloEvento` (`src/lib/acompanhamento.js:168/186`) já escrevem a mudança em português («Preço: R$ 78,90 → R$ 74,95», «Promoção: entrou (PRICE_DISCOUNT −5%)», «Ads: pausado → anunciando»).
- Ads por anúncio: `meli_ads_item` (28 d atual × anterior: `custo, receita, unidades, status`) e `meli_ads_dia` (por dia, quando coletado). Promoções: `promo_oferta` (tipo, preço de/para, início/fim, estado). Duplicação: `medirFamilia` (`src/lib/duplicacao.js:72`) mede original + duplicatas como uma família.
- **O furo** (banco de 15/10, só leitura): o cliente do exemplo da § «Resumo» tem 93 tarefas concluídas em 90 d e **1** cita o MLB; `tarefa_item` dele está vazia; o change-log diário só começou em 08/10 na maioria das contas (duas contas desde 07–08/09). Ou seja: o card não aponta o anúncio **e** o anúncio só passou a contar a própria história há uma semana. A atribuição individual hoje nasce de 3 fontes que não se cruzam. Esta seção as cruza.

### 8.2 Fontes de marco por anúncio (o marco é a mudança no anúncio; o card é testemunha)

Um **marco** = `{ item_id, dia, campos[], fonte, incerteza?, tarefa_id?, acao_id?, ordem_id? }`. `marcosDoAnuncio(cliente, item_id, { de, ate })` (puro sobre as leituras) monta a lista em ordem de precedência — a fonte mais precisa manda na **data**, o card manda na **intenção**:

| # | Fonte | Precisão da data | O que traz | Já existe |
|---|---|---|---|---|
| 1 | Execução do próprio sistema: `exec_ordem` conferida (Chaveiro), `of_job` publicado (Ofertas, `execucoesOfertas` `impacto-tarefas.js:435`), `promo_plano` executado | exata (conferência) | anúncio, campo, antes/depois, `acao_id` → regra → família | Ofertas e Promoções sim; Chaveiro F3/F4 |
| 2 | Change-log diário (`meli_item_mudanca`, fonte `coleta`/`promo`/`ads`) | ±1 dia (coleta das 4–6 h) | campo, de → para, `variacao_pct` | sim |
| 3 | Fotografia do acompanhamento (`tarefa_acomp`, fonte `acomp`) e snapshots (`anuncio-historico.js`) | intervalo («entre X e Y») | diff completo (descrição, atributos, categoria) | sim |
| 4 | Tarefa do Notion **com** anúncio (`tarefa_item` citado/plano/confirmado) | data de conclusão (ou estimada) | família, analista, intenção | sim |
| 5 | Tarefa do Notion **sem** anúncio | data de conclusão | só família e intenção | sim — hoje vira medida de conta inteira, sem controle (`impacto-tarefas.js:298`) |

**Casamento card ↔ mudança** (`casarCardComMarco`, puro): uma tarefa sem anúncio (fonte 5) é ligada a um marco observado (fontes 2–3) quando **(a)** a família da tarefa prevê o campo mudado (tabela fixa `config/atribuicao.json → estado.intervencao` já mapeia família → campos; estende-se com `imagens → fotos|thumb`, `otimizar → titulo|fotos|thumb|descricao|atributos`, `precos → preco`, `campanhas_desconto|oferta_relampago|cupom → promocao|preco`, `ads → ads`, `full → logistica`, `status → status`, `ficha → atributos`, `variacoes → tipo_anuncio|atributos`), **(b)** a mudança caiu em `[conclusão − 3 d, conclusão + 3 d]` (o ML reindexa e a coleta vê no dia seguinte) e **(c)** o anúncio é único candidato na janela **ou** o título do card aponta para ele (`sugerirVinculo` `src/lib/vinculos.js:44`, cobertura ≥ 0,6 e sem ambiguidade). O casamento grava `tarefa_item` com origem nova **`observado`** (score = cobertura; `por = 'sistema'`), que **entra na medição** como `citado` (lista de `criarVinculos:75` ganha `observado`), e o card recebe o rótulo «anúncio inferido pela mudança observada em DD/MM» — reversível por `recusar` (`:103`). Sem (a)+(b)+(c), o marco fica **sem card** («mudança observada; nenhuma tarefa aponta para ela») e a tarefa fica **sem anúncio** (esforço, não resultado). Nunca se atribui por proximidade de data sozinha.

**Regras operacionais derivadas (decisão do David):**
1. **O Chaveiro grava anúncio + mudança em toda execução** — já é o desenho (`exec_ordem.item_id`, `snapshot_antes_json`, conferência → `meli_item_mudanca` fonte `chaveiro`, `docs/desenho-causalidade-executor.md` § 2): a atribuição nasce certa, fonte 1.
2. **O card manual ganha campo «Anúncio (MLB)» obrigatório** na distribuição (`distribuir-notion.js` já cita o MLB no título — passa a preencher a propriedade) e, para card criado à mão, o sync marca `sem_anuncio` e o Discord de terça lista «N cards sem anúncio esta semana» (interno, sem culpa). O Notion não impõe obrigatoriedade; a régua é o aviso + o 80/20 por família **não contar** essas tarefas como resultado.

### 8.3 Atribuição individual e combinação

**Episódio** = o conjunto de marcos do mesmo anúncio com ≤ `c.janela_episodio_dias` (14, `config/retroalimentacao.json → combos`) entre marcos consecutivos — a mesma definição de `combos` (`retroalimentacao.js:266-290`), só que sobre **marcos** (mudanças), não só sobre tarefas. `atribuirEpisodio(ep, ctx)` (puro; `ctx` = o `contextoCliente` de `impacto-tarefas.js:458`):

| Caso | Condição | Cálculo | Rótulo |
|---|---|---|---|
| **Individual** | 1 marco (1 campo, ou campos da mesma intervenção no mesmo dia — ex.: `promocao` + `preco` da própria promoção) e nenhum outro marco em `[−N−lag, +N+lag]` | `medirMarco` no dia do marco: antes × depois com controle e placebo; degrau N1 (N2 com `parearControle` da F2 do Chaveiro) | «1 mudança isolada: efeito +X % [intervalo] contra os anúncios sem mudança» |
| **Sequencial** | 2+ marcos com **≥ 7 d** entre eles (`c.min_dias_etapa`, novo) e pré ≥ `min_unidades_base` em cada etapa | efeito **incremental por etapa**: etapa k medida com pré = os 7–14 d imediatamente anteriores ao marco k (já contendo as etapas anteriores) e pós até o marco k+1 (janela truncada, declarada); controle recalculado por etapa; `receita_alocada` por etapa | «Título em 12/09: +8 %; depois, 3 fotos em 21/09: +15 % sobre o novo patamar» |
| **Conjunto** | 2+ marcos com **< 7 d** entre eles, ou etapa sem pré suficiente | **uma** medida do episódio inteiro (data = 1º marco, lag = intervalo + lag da família — exatamente `combos:294-306`); `receita_alocada` do episódio **não é dividida**: cada marco recebe `credito: 'compartilhado'` com a lista dos co-fatores; no aprendizado por família a medida entra em **todas** as famílias do episódio com peso `1/k` (declarado como `peso_compartilhado`), nunca como k medidas inteiras | «Efeito conjunto de título + fotos + Ads (6 dias entre a 1ª e a última): +Y %; não dá para separar o que coube a cada uma» |
| **Confundido** | marco de `preco` (≥ 3 %) ou de estado (promoção, Ads, Full, estoque zero, pausa) **que não é a intervenção** do episódio | continua como hoje: `marcarPreco`/`marcarEstado` (`impacto-tarefas.js:224/243`) → `confundido_*`, fora do aprendizado, teto de confiança 59; **mas** o marco confundidor passa a ser **listado como co-fator** no texto, com data | «Preço caiu 5 % em 19/09 junto com a promoção: o efeito pode ser do preço» |

Co-fatores sempre listados (mesmo quando descontados): promoção (`promo_oferta` no período), Ads (`meli_ads_item.custo` atual × anterior; dia exato só com `meli_ads_dia`; sem ele, «entre X e Y, dia não lido»), estoque zero / pausa, calendário comercial (`eventos`), tendência prévia (`tendencia_pre_pct`), reversão à média (`reversao_provavel`). Ranking do ML: `nao_medido`, sempre escrito.

**O que NUNCA se faz:** dividir o ganho de um episódio conjunto «em partes iguais» ou «por ordem»; somar o efeito das etapas como se fossem independentes; chamar N1/N2 de causa; medir etapa com pré < `min_unidades_base` (5).

### 8.4 Saída em linguagem simples, por anúncio (`textoAtribuicao`, puro; passa por `relatorio-seguro`)

```
Faturamento +X % (R$ a → R$ b) nos 28 dias após DD/MM.
O que mudou: [título em 12/09] + [3 fotos novas em 14/09] + [Ads ligado em 15/09].
Efeito contra os anúncios sem mudança: +Y % (confiança média, 9 janelas de comparação).
É associação no tempo, não prova de causa.
Não dá para separar: título e fotos (2 dias de intervalo); o dia em que o Ads subiu não foi lido.
```
Regras: 1 frase por linha; `a → b` = receita do pré × pós (mesma janela, `metricas.receita`); `+Y %` = `efeito_pct` ajustado pelo controle; «confiança» = classe de `confiancaEfeito` traduzida (forte / média / fraca / hipótese) — nunca o número cru ao cliente; a lista «não dá para separar» é obrigatória quando o caso é conjunto ou confundido; ao cliente, `nao_funciona`/`piorou` sai como «sem resultado medido até agora» (interno mostra o sinal).

### 8.5 Ranking por conta: as combinações que mais renderam (e as que não)

`rankingCombinacoes(episodios, { c })` (puro): agrupa episódios medidos por **assinatura** = famílias do episódio em ordem temporal (`imagens → titulo → ads`; a ordem importa só no caso sequencial, no conjunto é alfabética com `+`) e devolve, por assinatura: `n`, `melhorou/piorou/sem_efeito` (célula com Wilson, `celula()` de `retroalimentacao.js:128`), `ganho_liquido` (Σ `receita_alocada` melhorou − Σ |piorou|), `efeito_mediano_pct`, `exemplos[≤3]`. Duas listas: **top 10 por ganho líquido** e **as que não renderam** (n ≥ 3 e `taxa_alto < base`, ou ganho líquido < 0). Entra:
- no **Foco 80/20** como a curva de concentração por **assinatura** (§ 3.2, mesmo `curvaConcentracao`), ao lado da curva por família;
- no **aprendizado por família** com o peso compartilhado (§ 8.3) — `aprender()` recebe `medidas` já expandidas por `expandirEpisodios()` (1 linha por família × episódio com `peso`), e `celula()` passa a somar `peso` em vez de contar (n efetivo, o mesmo mecanismo previsto para os degraus na F2 do Chaveiro);
- em `combos` (`retroalimentacao.js:270`): **substituído** por `rankingCombinacoes` sobre marcos (hoje `combos` só vê tarefas e exige 2 tipos distintos; o novo vê marcos, aceita 1 e devolve o mesmo formato `funcionam/candidatas/pioram` para a tela não mudar).

### 8.6 Telas (sem tela nova; ≤ 6 colunas; 1 primário por tela)

| Onde | O que |
|---|---|
| **Folha do anúncio** (`GET /api/cliente/folha`, `folhaDoCliente` `src/lib/folha-anuncio.js:75`; drill do anúncio em `anuncio-historico.js` web) | bloco «O que gerou este resultado»: texto da § 8.4 + tabela Data · Mudança · Fonte (card/coleta/sistema) · Efeito da etapa · Crédito (individual/compartilhado) · Confiança. Marcos sem card e cards sem anúncio aparecem com o rótulo, nunca somem |
| **`/cliente` › Resumo** (`#secAtribuicao`, dentro de «Foco da conta») | top 5 episódios por ganho líquido 90 d + «5 que não renderam»; coluna Assinatura em vez de Unidade |
| **Resumo ao consultor no Discord (terça 08:30)** | o bloco ✅ («resultado») que já existe em `secoesConsultor` (`consultor-discord.js:114`) passa a citar a **combinação**: «✅ Relógio D20: +Y % após promoção −5 % (19/09) — co-fator: Ads subiu na mesma quinzena» |
| **Plano semanal ao cliente** (`dadosPlanoSemana` → bloco ✅ entregas, `plano-semana-texto.js`) | a linha de entrega cita a mudança e o efeito ajustado em voz do cliente; sem `nao_funciona`, sem N1 |
| **`/resultados`** (`GET /api/resultados/tarefas` `rotas-planos.js:673`) | coluna «Marco» (tarefa / mudança observada / execução do sistema) e «Crédito» |

### 8.7 Modelo de dados, funções, testes (aditivo ao § 7)

- `tarefa_item.origem` ganha o valor `observado` (coluna TEXT sem CHECK — nada muda no DDL; `criarVinculos:75` passa a incluí-lo). `meli_item_mudanca.fonte` ganha `chaveiro` (já previsto; `migrarMudanca` recria o CHECK sozinho).
- Tabela nova `atribuicao_episodio` (retrato, recalculável): `cliente, item_id, episodio_id (sha curto de item|d1|dk), d1, dk, caso CHECK IN ('individual','sequencial','conjunto','confundido','sem_base'), marcos_json, assinatura, efeito_pct, intervalo_json, confianca, degrau, receita_alocada_c, cofatores_json, texto, calculado_em; PK (cliente, episodio_id)` — como `retro_ciclo`, é o retrato do que o sistema pensou; o efeito é sempre recalculado ao vivo (D14 do desenho de causalidade).
- `src/lib/atribuicao.js` (puro): `marcosDoAnuncio`, `casarCardComMarco`, `episodiosDe(marcos, c)`, `atribuirEpisodio(ep, ctx)`, `expandirEpisodios(episodios)`, `rankingCombinacoes`, `textoAtribuicao`. `src/lib/atribuicao-real.js`: `atribuicaoDoCliente(cliente, { hoje })`, `gravarVinculosObservados(cliente, { confirmar })` (prévia por padrão). Rotas: `GET /api/cliente/atribuicao?cliente=&item=` e `POST /api/cliente/atribuicao/vincular { confirmar }` em `src/rotas-historico.js` (já é o dono do histórico do anúncio).
- Edições: `impacto-tarefas.js` `contextoCliente:458` lê também os marcos observados e as execuções do Chaveiro (lista única de marcos); `retroalimentacao.js:595` troca `combos` por `rankingCombinacoes` (mesmo formato de saída); `config/atribuicao.json` ganha `episodio: { min_dias_etapa: 7, janela_casamento_dias: 3, familias_campos: {…} }`.
- Testes `scripts/teste-atribuicao.mjs` (séries sintéticas, como `teste-impacto.mjs`): individual com efeito plantado → N1 e texto; dois marcos a 10 d → sequencial com incremental por etapa; dois marcos a 2 d → conjunto com crédito compartilhado e peso 1/2 em cada família; preço junto → confundido listado como co-fator e fora do aprendizado; casamento card↔marco só com família compatível + janela ± 3 d + candidato único; ranking: assinatura `imagens → ads` ≠ `ads → imagens`; `relatorio-seguro` barra «causou».

### 8.8 Exemplo real (Cliente S, eletrônicos; dados só-leitura de 15/10/2026; anúncio: relógio smart D20)

- **Marcos no anúncio** (change-log): 19/09 `promocao: nenhuma → PRICE_DISCOUNT −5 %` e `preco: R$ 78,90 → R$ 74,95` (fonte `promo`, mesma intervenção) — a promoção foi criada pelo módulo de Promoções (`promo_oferta`, início 19/09, fim 19/10). Em 12/10: `estoque_zero`, `status: active → paused`, `ads: active → hold`, capa trocada (fonte `coleta`) — fim do episódio por **ruptura**.
- **Co-fator**: Ads no anúncio foi de R$ 0,90 (18/08–14/09) para R$ 43,05 (15/09–12/10), receita atribuída R$ 754; o dia exato em que a verba subiu **não foi lido** (`meli_ads_dia` vazio para o anúncio).
- **Card do Notion**: nenhuma tarefa concluída da conta entre 10 e 25/09 — o marco existe **só** porque o sistema executou a promoção e o change-log viu a mudança. Sem a fonte 2, esta história não existiria.
- **Antes × depois** (14 d: 05–18/09 × 23/09–06/10): 8 → 41 unidades, R$ 631 → R$ 2.950. **Controle** (140 anúncios da conta sem nenhuma mudança no período): 49 → 36 unidades (−27 %), R$ 4.810 → R$ 4.559. Efeito ajustado em unidades ≈ (41/8) ÷ (36/49) ≈ +600 % (a conta em geral caiu; o anúncio subiu). Tendência prévia em curso (2 → 6 unidades nas duas semanas antes do marco) tira pontos de temporalidade; pré acima do habitual não vira «reversão» porque o efeito é no mesmo sentido.
- **Como o texto sairia:** «Faturamento +367 % (R$ 631 → R$ 2.950) nos 14 dias após 19/09. O que mudou: promoção de −5 % (R$ 78,90 → R$ 74,95) em 19/09. Efeito contra os anúncios sem mudança: ≈ +600 % (confiança média: a alta já vinha começando antes). É associação no tempo, não prova de causa. Não dá para separar: a verba de Ads subiu na mesma quinzena (dia não lido); o anúncio zerou o estoque em 12/10 e saiu do ar.» Caso: **conjunto** (promoção + Ads), crédito compartilhado entre as famílias `campanhas_desconto` e `ads` (peso ½ cada). Para o Foco 80/20 da conta, a assinatura `campanhas_desconto + ads` entra no ranking com este ganho — e o produto entra em «manter» com risco aberto (ruptura), nunca em «escalar» enquanto o estoque não voltar.

---

## 9. Decisões registradas e perguntas restantes

Respondidas pelo David (15/10, ~01h50 — ver o bloco no fim): **pausa automática e avisa** (§ 4.2 vale como está; `omitidas.foco` + aviso interno no Discord de terça); **sentinela a cada 30 d** (§ 6.2 item 1 vale); **carteira pelo ganho medido** (§ 5: a curva de clientes em `/planos` ordena por `ganho_liquido` 90 d; receita vira coluna de contexto; cliente com < 8 medidas aparece em «ainda sem medida suficiente», fora da curva).

Pergunta nova (única que muda o desenho da § 8): o vínculo **`observado`** (card casado com a mudança pelo sistema) entra na medição **automaticamente** (reversível por «recusar») ou só depois de alguém confirmar no card? Automático = mais marcos medidos já na próxima leitura; manual = nenhum vínculo inferido sem olho humano.

---

## Resumo executivo (como fica a decisão em 15 / 30 / 45 / 60 / 90 dias)

1. O Merovíngio passa a responder, por cliente, **onde está o resultado e onde está o esforço**: por produto, por tipo de ação, por canal (Ads, conteúdo, preço, promoção, estoque, duplicação) e, para a liderança, por cliente.
2. Resultado = lucro quando a conta tem custos e a V3 estiver ligada; senão receita — e a tela diz qual. Esforço = tarefas da equipe, verba de Ads e capital parado (horas não existem no Notion; fica dito).
3. Nada de «80 fixo»: a curva de concentração acha sozinha o ponto onde poucos produtos passam a responder pela maior parte; o 80 fica como referência.
4. Cada unidade recebe um de quatro vereditos — **manter e escalar · manter · reduzir · pausado por evidência** — com a probabilidade de a próxima ação dar certo (calibrada pelo que já foi medido na base), o custo de oportunidade como estimativa e a data de revisão.
5. «Pausado» nunca apaga: a venda continua sendo acompanhada, uma ação-sentinela a cada 30 dias mantém a medição, o veredito expira em 90 dias sem medida nova, e o consultor (ou o cliente) pode vetar. Ruptura, reputação e margem negativa nunca saem do foco.
6. O que cada marco pode afirmar, com honestidade:
   - **15 d** — só a foto provisória de quais produtos vendem; nenhuma tendência, nenhum efeito, nenhum veredito (apenas risco).
   - **30 d** — curva de 28 dias e tendência 14×14 com teste de ruído; primeiras medições de ações; pode-se «manter» o topo e «reduzir» esforço que não aponta para anúncio nenhum.
   - **45 d** — tendência confirmada quando há 56 dias; famílias com 5+ medições já calibram a probabilidade; «manter e escalar» para o que cresce e tem efeito medido.
   - **60 d** — produtos subindo/caindo com significância; famílias com 8+ medições ganham veredito (funciona / não funciona / inconclusivo); **a partir daqui** «pausado por evidência» é permitido.
   - **90 d** — ciclo fechado: curva de ganho medido por tipo de ação cruzada com a de receita por produto, previsto × realizado, combinações e pior tarefa; o veredito de 90 dias realimenta os priors da base.
7. O fator do foco entra na prioridade existente (odds, mesmo lugar da proteção e do estado), nunca em paralelo; com a chave desligada o plano sai idêntico.
8. **Exemplo real (Cliente F, fantasias infantis; dados só-leitura de 15/10/2026):** receita de 28 d R$ 99,5 mil contra R$ 64,0 mil nos 28 anteriores (+56 %, 630 × 397 unidades — crescimento com significância, 5 ciclos registrados). 148 anúncios venderam; **8 fazem 50 %** da receita e **32 (22 %) fazem 80 %**; o maior tem 9,7 % (abaixo do alerta de 40 %). Produto = anúncio (a leitura de produto da V3 ainda não cobre esta conta). Ads: R$ 5,1 mil de verba e R$ 48,8 mil atribuídos em 28 d (≈ 9,6×; 5 % da receita). Sem custos informados → lucro indisponível; o foco fica em receita, dito.
   - Esforço de 90 d: 93 tarefas concluídas no Mercado Livre — Otimizar anúncios 26, Cadastro 14, Duplicação 7, Variações 5, Kits 3, Ads 3. **Só 1 cita o anúncio**: o efeito por família é quase todo «sem alvo medido».
   - Como o sistema decidiria hoje (marco 30–45 d do ciclo): os 8 anúncios do topo → **manter** (crescendo; efeito ainda sem amostra); Ads → **manter** (retorno alto, verba pequena); Cadastro (15 % do esforço, zero medida vinculada) → **reduzir esforço sem alvo** — não «não funciona», e sim «não dá para medir assim»; nenhuma unidade pausada (faltam medidas: 1/8). Custo de oportunidade: não calculável ainda (nenhuma família com 8 medidas). A ação mais valiosa para o foco desta conta é operacional: citar o anúncio no card — em 30 dias o veredito por família passa a existir.
9. **Qual tarefa gerou o resultado (§ 8):** o marco passa a ser a **mudança observada no anúncio** (change-log diário, fotografia, execução do sistema), não só o card. Card sem anúncio é casado à mudança quando família, data (± 3 d) e anúncio batem; senão fica como esforço. 1 mudança isolada → efeito individual; 2+ com ≥ 7 d → efeito por etapa; 2+ em menos de 7 d → **efeito conjunto com crédito compartilhado**, nunca dividido artificialmente; preço, promoção, Ads e estoque sempre listados como co-fatores. O texto ao cliente é fixo: «Faturamento +X % (R$ a → b) nos 28 dias após [data]. O que mudou: […]. Efeito contra os anúncios sem mudança: +Y % (confiança …). É associação no tempo, não prova de causa. Não dá para separar: […]».
   - **Exemplo real (Cliente S, eletrônicos; relógio smart):** promoção de −5 % (R$ 78,90 → 74,95) em 19/09, criada pelo sistema; nenhum card do Notion na quinzena. 14 dias antes × depois: 8 → 41 unidades, R$ 631 → R$ 2.950, enquanto os 140 anúncios da conta sem mudança **caíram** 27 % em unidades — efeito ajustado ≈ +600 %, confiança média (a alta já começava antes). Não dá para separar: a verba de Ads subiu de R$ 0,90 para R$ 43 na mesma quinzena (dia não lido). Em 12/10 o estoque zerou e o anúncio pausou: a história termina em ruptura — o produto fica em «manter», com risco aberto, não em «escalar».
   - Regra operacional derivada: o Chaveiro grava anúncio + mudança em toda execução (atribuição nasce certa) e o card manual ganha o campo «Anúncio (MLB)» obrigatório; cards sem anúncio são listados toda terça (interno, sem culpa) e não contam como resultado.
10. Fases: F1 leitura (tela + API), F2 comunicação (plano semanal, Discord, brief, carteira), F3 fator no plano com chave e veto, F4 aprendizado e calibração do próprio foco, F5 experimento quando o Chaveiro tiver holdout; a atribuição (§ 8) entra na F1 (marcos + texto na Folha) e na F4 (ranking de combinações no aprendizado).
11. Decididas pelo David: pausa automática e avisa; sentinela a cada 30 dias; carteira pelo ganho medido. Uma pergunta restante: o vínculo card ↔ mudança inferido pelo sistema entra na medição automaticamente (reversível) ou só após confirmação humana?

---

## Decisões do David (15/10/2026, ~01h50)
1. **Pausa por evidência: AUTOMÁTICA e avisa** (sai do foco sozinha a partir de 60 d com evidência; time avisado; consultor pode vetar por alinhamento `foco_manter`).
2. **Sentinela: sim, a cada 30 dias** (1 ação pequena por unidade pausada; pausar ≠ parar de medir).
3. **Carteira (/planos): 80/20 pelo GANHO MEDIDO pelas ações** (antes × depois com controle), não pela receita do cliente.

## Decisão (15/10/2026, ~02h30) — vínculo «observado»
O vínculo card↔mudança inferido pelo sistema (`tarefa_item.origem='observado'`) ENTRA na medição automaticamente, rotulado como «inferido», reversível por «recusar»; com ≥ 2 candidatos não casa (fica «sem anúncio»). Coerente com «pausa sozinha e avisa».
