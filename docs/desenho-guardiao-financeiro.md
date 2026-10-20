# Desenho: Guardião financeiro (Agente Smith): AVISA, REVISA e MELHORA

> Pedido do David (15/10/2026), a partir do Discord interno de 14/10 sobre a **JBM Têxtil** (que também opera a loja **Luxo Têxtil**; grupo WhatsApp «JBM Textil - Shopee»). Pediu para pegar esse contexto de custos mal estruturados, sem previsibilidade financeira e sem geração de caixa e transformar em algo estratégico que **avise, revise e melhore**.
> Status: **G0 CONSTRUÍDA em 15/10/2026** (raio-X + pauta só leitura, `preco_decisao` e `conta_canal`; ver CLAUDE.md «Agente Smith G0»). G1–G5: desenho. Na versão original desta página nada foi construído, nada foi escrito no banco, no ML, no Notion ou no Discord. Os números da § 1 vêm de `sqlite3 -readonly` em 15/10/2026.

## 0. Em uma frase

O Agente Smith **não é um segundo motor**. Ele junta o que o Algoritmo já sabe sobre custo, preço, margem e caixa (`diagnostico-conta.js`, `lucro.js`, `plano-anuncios.js`, `preco-historico.js`, `compras-previsao.js`), acrescenta **6 regras com prior e KPI** em `config/algoritmo.json` e **6 avisos** em `config/gatilhos.json`. Toda mudança de preço vira um **marco** que o Merovíngio mede em 7, 14 e 28 dias. O que sai dele é uma **recomendação** com previsão, chance e medição, nunca uma ordem. Sem custo, o Guardião não inventa margem: transforma a falta de custo na pendência nº 1, com uma estimativa rotulada do que essa falta custa.

---

## 1. Diagnóstico real (somente leitura, 15/10/2026)

### 1.1 JBM Têxtil e Luxo Têxtil: o que o sistema sabe

| Item | O que há | Fonte |
|---|---|---|
| Cadastro | «JBM Textil», Ativo, Plano Performance, nicho Decoração, canais `["SHO"]`. Health score 15,5, «Dados insuficientes» (planilha do CS de 09/10). **Contrato Shopee vence 17/10/2026**, antes da reunião de terça | `clientes_central` |
| Luxo Têxtil | **Não existe como cliente.** As tarefas separam «Shopee 1» (29), «Shopee 2» (45) e «Shopee 1 e 2» (68). Pelas atas, a «conta dois» é a segunda loja. **NOT_VERIFIED:** «Luxo = Shopee 2» | `tarefas.processo`, atas |
| Mercado Livre | **Sem conta conectada** (`meli_contas`: 0). O Notion lista ML em «Marketplaces Ativos» (jan/2026), mas na ata de 14/07 o dono diz que quer estabilizar as duas lojas Shopee antes de expandir | `cliente_informacoes`, ata 14/07 |
| Shopee | **Nenhuma coleta.** O sistema só conhece a Shopee pelas tarefas do Notion. O relatório de 09/10 diz: «Números de vendas indisponíveis… nenhum número foi estimado» | `relatorio_envio`, card do relatório |
| Vendas 28×28 | **não temos o dado** | — |
| Custos | **nada:** `custos_cliente` 0, `custo_vinculo` 0, `erp_custos_sku` 0, `promo_custos_sku` 0. O Onboard do Notion tem um item «Planilha de Precificação» (16/01/2026), mas o conteúdo não é lido | banco, `cliente_informacoes` |
| Tarefas | 166 no total: 124 concluídas, 40 não iniciadas, 1 em andamento, 1 em dependência do cliente (data aproximada ~25/09, «Duplicar anúncio… kit 2 mantas»). Concluídas por mês: jun 25 · jul 26 · ago 26 · set 38 · out 9 (até 09/10). Última conclusão: 09/10 | `tarefas` |
| Histórico de preço | **Só pelas tarefas e atas**, porque não há change-log de anúncio Shopee. Detalhe no quadro abaixo | `tarefas`, atas |
| Ads | 7 tarefas de ajuste de campanha (29/07 → 07/10). Recarga automática de 7% ligada em 05/08. Em 15/09 ficou combinado «definir valor fixo mensal de Ads na próxima reunião com o dono», e **não há registro de que foi definido**. O cliente pediu a planilha de gastos dos últimos 30 dias | atas 05/08 e 15/09 |
| Estoque | Em 15/09 o cliente se comprometeu a mandar «durante a semana» a relação atualizada de estoque. **Não há registro de entrega** e não há pendência registrada | ata 15/09 |
| Alinhamentos, pendências registradas, risco, contrato e pagamentos no dossiê | 0 em todos | banco |
| Plano do sistema | 7 ações propostas: sem responsável (4 tarefas), destravar bloqueio, montar plano de outubro, Black Friday, Natal, 15 tarefas paradas há 30+ dias e **renovação Shopee em 10 dias**. **Nenhuma ação de custo ou preço**, porque `cadastrar_custos` e `preco_mudou_vendas_cairam` só nascem com dado do ML | `acoes_plano` |
| Respostas do cliente | O coletor só lê o grupo do ML. O grupo «JBM Textil - Shopee» não é lido, então «não responde há 2 semanas» é **relato do time, não verificável pelo sistema** | `feedback_relatorio` 0 |
| Avisos ao cliente | `notificacao_json = {}`: sem grupo configurado. Os gatilhos são só do ML por decisão de 12/10 | `clientes_central` |

**Linha do tempo de preço da JBM** (só o que está registrado):

| Data | O quê | Quem decidiu | Direção |
|---|---|---|---|
| 14/07 | O dono pede revisão de preço «principalmente do tapetinho e de kits de banheiro». Combinado: ajustar alguns e «adiar mudanças mais amplas» | cliente | — |
| 31/07 | Tarefa «Ajuste de valores» (Shopee): Tambaba 49,99 · kit banheiro mais vendido 29,80 · outros 28,80 · vermelho 27,80 · manta king 48,80 | cliente (lista dele) | não registrada (o «de» não existe) |
| 05/08 | Kit 2 peças: «valor muito baixo» → **R$ 49,90**, depois de comparar com concorrentes | alinhado em reunião | **alta** |
| 15/09 | «Subir o preço dos tapetes para melhorar a margem e evitar operação no negativo»: **+R$ 5,20** nos tapetes unitários e kits (Shopee 1 e 2). Mantas sem reajuste | alinhado em reunião | **alta** |

**Conclusão JBM:** houve pelo menos **2 altas em 90 dias** decididas pelo cliente (ou com ele, em reunião) e executadas pela assessoria. A frase «evitar operação no negativo» mostra que a margem já era a preocupação em 15/09, **sem que ninguém tivesse o custo**. O efeito dessas altas nas vendas **não pode ser medido hoje**: falta a série de vendas da Shopee.

### 1.2 Carteira (Mercado Livre, onde há dado)

| Pergunta | Número real | Leitura |
|---|---|---|
| Clientes ativos na central | 173 (todos os canais) | |
| Clientes Ativos com conta ML | 42 (47 contas conectadas). 41 venderam nos últimos 28 dias | |
| **Clientes com custo** | **1 de 42**: Uniaodog, 22 SKUs em `promo_custos_sku`. Ninguém tem os percentuais (`custos_cliente` = 0), o vínculo custo↔anúncio (`custo_vinculo` = 0) ou o ERP (`erp_custos_sku` = 0) | margem afirmável hoje em **0** clientes. A chave `financeiro.margem_medida_nas_regras` está desligada e `meli_pedido_item` existe em 2 clientes |
| **Cegos de margem** | **41 de 42 (98%)** | |
| GMV ML de 28 dias sem margem conhecida | R$ 982.039 (44 clientes com série) | |
| Ads de 28 dias sem ROAS de equilíbrio | **R$ 45.419 em 38 clientes** | todo esse gasto está sem limite econômico |
| `cadastrar_custos` no plano | proposta em 41 clientes, aprovada em 1, mais antiga de 05/10 (10 dias) | a pendência existe, mas não anda |
| **≥ 2 altas em 90 d com queda de vendas** (proxy) | **7 clientes** têm ≥ 1 anúncio com 2 altas seguidas ≥ 3% no **preço pago** (receita ÷ unidades, em 3 janelas de 30 d: 17/07–15/08, 16/08–14/09, 15/09–14/10) **e** queda de vendas ≥ 20%. Em **6 deles** a queda desses anúncios é pior que a do resto da conta (controle): 01Smart −79% × −33%; Minas Geral −82% × −28%; Áurea −50% × +24%; Uniaodog −81% × +5%; Damar −53% × +17%; Bee Bikini −93% × −39%. Na Jula Têxtil (também têxtil) a conta toda caiu mais (−80% × −91%): é mercado ou conta, não preço | **proxy, origem não verificada:** o preço pago inclui promoção e kit, e o fim de uma promoção nossa também aparece como «alta». O change-log de preço da coleta só começou em 08/10 (14 contas); o de promoção, em 07/09 (3 contas). A regra `preco_mudou_vendas_cairam` tem **0** ações hoje |

**Leitura:** o padrão JBM (subir para salvar margem sem saber o custo, e as vendas caem) **não é um caso isolado**. É o modo de falha da carteira inteira: 98% sem custo, R$ 45 mil/mês de Ads sem teto econômico e 6 contas com o sinal de «subiu e caiu» acima do controle.

---

## 2. Princípios (os de sempre, mais quatro do Guardião)

1. **Um motor só:** Trinity coleta → Arquiteto (regras) → Oráculo (p, faixas) → Merovíngio (medição) → Morpheus (comunicação). O Agente Smith é o **dono temático** das regras financeiras e do bloco «Financeiro». Toda mensagem interna diz «Agente Smith». Ao cliente, só o Merovíngio assina (CLAUDE.md, «Sistemas dentro do sistema»).
2. **Sem custo não existe margem.** Nunca «prejuízo» sem custo. O custo implícito (§ 5.3) é uma **faixa rotulada** e nunca vira margem em regra.
3. **Decisor ≠ executor.** Uma mudança de preço tem dois atributos: quem **executou** (assessoria, cliente ou sistema: `origemPreco`, `gatilhos.js:186`) e quem **decidiu** (`cliente | assessoria | nao_registrado`). A JBM mostra por que isso importa: as altas foram executadas pela assessoria, mas decididas pelo cliente. Hoje `origemPreco` as classificaria como «assessoria» e o aviso nunca nasceria. O padrão «subir-cair» lê o **decisor**.
4. **Preço é decisão do cliente.** O Guardião recomenda, mede e reporta. Um alinhamento `decisao_preco` cala a recomendação, mas **nunca a medição** (§ 4.4).
5. Honestidade herdada: dia sem coleta não é zero, nenhuma alíquota ou comissão presumida (inclusive a da Shopee: vem do extrato do cliente), centavos, «não temos o dado» explícito, degrau de evidência sempre escrito e nunca «causa confirmada».

---

## 3. AVISA

### 3.1 Catálogo de avisos (`config/gatilhos.json → gatilhos`, `fonte: "guardiao"`)

Cada aviso **projeta** uma ação do plano (`REGRA_DO_TIPO` em `gatilhos.js:66`) e nunca recalcula. Todo texto passa pelo auditor (`relatorio-seguro`) e pelo dedupe (`gatilho_avisado`). Ao cliente só no ML, na terça, como hoje. Shopee e JBM: só interno até existir canal (§ 6.6).

| Tipo | Regra do plano | Dono | Classe | Quando nasce | Ao cliente (template) | Ao time (Discord, Agente Smith) |
|---|---|---|---|---|---|---|
| `custo_ausente` (substitui `custos_nao_informados`) | `cadastrar_custos` | cliente | info → atencao após 30 d de pedido registrado | sem custo em ≥ 80% da receita | «Ainda não temos o custo dos seus produtos. Sem ele, não sabemos a margem de cada venda, o limite do investimento em anúncios nem o desconto máximo. {custo_nao_saber} O primeiro passo leva 10 minutos: o custo dos {n} produtos que mais vendem.» | «💰 Agente Smith · sem custo **há {dias} d** (pedido em {data}) · {ads_sem_teto} de Ads em 28 d sem teto · passo {passo}/3 da coleta» |
| `subir_cair` (padrão) | `subir_preco_cair_venda` | cliente | atencao (N1) · critico (N3) | § 3.3 | «Nos últimos 90 dias o preço de {produto} subiu {k} vezes ({datas}). Desde a última alta, as vendas variaram {y}% enquanto os demais produtos variaram {ctrl}%. Medimos que cada 10% de alta veio junto com {e10}% de vendas (faixa {lo}–{hi}%). É associação medida, não prova de causa. Vale revisar juntos antes da próxima alta.» | «💰 · {produto}: {k} altas decididas pelo cliente em 90 d · ε = {eps} [{lo}; {hi}] · degrau {N} · próxima alta prevista sem custo = risco» |
| `preco_abaixo_piso` | `margem_negativa` (já existe, sem regra nova) | cliente | critico | só com custo: `lucro_unit(p) ≤ 0` | template de `margem_negativa` (já aprovado no tom) | «💰 · {n} anúncio(s) abaixo do piso · perda medida {R$}/28 d» |
| `caixa_em_risco` | `caixa_em_risco` | assessoria → cliente na reunião | atencao | F9: caixa projetado em 30 d < 0 na faixa conservadora, ou compra sugerida > caixa projetado | (não vai por WhatsApp: entra na pauta e no raio-X) | «💰 · caixa 30 d: {cons}…{base} · compras sugeridas {R$} · Ads previsto {R$}» |
| `canibalizacao_contas` | `canibalizacao_contas` | assessoria | atencao | ≥ 2 contas do mesmo dono com o mesmo produto (`conta_canal.grupo`, § 6.2) e diferença de preço ≥ 10% ou mudança de preço numa só conta | (interno; ao cliente só na pauta) | «💰 · {produto} em {conta A} R$ {pa} × {conta B} R$ {pb} · quando A subiu em {data}, B {variação} (degrau {N}) · igualar sem custo = decidir no escuro» |
| `decisao_financeira_parada` | `decisao_financeira_parada` | assessoria | atencao → critico em 21 d | decisão financeira registrada como pendente (custo, verba de Ads, preço, estoque) **e** sem resposta verificável há ≥ 14 d, ou relato do consultor (`por`) | nunca ao cliente (política de tom: sem contagem de dias) | «💰 · {cliente}: {k} decisão(ões) financeira(s) parada(s) há {dias} d ({lista}) · sugerido marcar risco (motivo: insatisfação/outro) · reunião {data}» → entra em `risco-cliente.sugestoes` como sinal novo |

**Política de tom** (a mesma de `pendencias-cliente`): data aproximada nunca é crítica e nunca mostra dias ao cliente. O R$ só aparece onde o sistema mede ou prevê. «Custo de não saber» é sempre «estimativa, premissa: …».

### 3.2 «Custo de não saber» (estimativa rotulada, `custoDeNaoSaber`, pura)

```
A = Ads de 28 d sem ROAS de equilíbrio (FATO: meli_ads_item.custo)
B = vendas perdidas medidas depois de altas sem custo
    Σ_k (q_esperado_k − q_pós_k) × p_k, com q_esperado = q_pré × (controle_pós / controle_pré)   (MEDIDO, degrau ≥ N1; senão fora)
C = parcela de A em anúncios cujo ACOS passa a faixa plausível de margem da categoria
    (só se houver ≥ 3 clientes com custo na mesma categoria; hoje: fora)
texto = «Em 28 dias: R$ {A} investidos em anúncios sem saber o limite que a margem aguenta{; R$ {B} em vendas abaixo do esperado depois de {k} alta(s) de preço}. Estimativa; não é prejuízo.»
```
Ponytail: C fica fora até existir custo em ≥ 3 clientes da mesma categoria (hoje 1 cliente na carteira). Nada de «prejuízo estimado».

### 3.3 Padrão «subir-preço-cair-venda»: elasticidade com intervalo e degrau

**Marco de preço** (§ 4.1) de magnitude `|Δp| ≥ limiar_confundidor_pct` (3%, `config/atribuicao.json → preco`), com o decisor registrado. Para cada marco k do produto j:

```
janelas  W ∈ {7, 14, 28}, lag = 1 d ; pré = [d−W, d−1], pós = [d+lag, d+lag+W−1]   (truncada no próximo marco: declarada)
controle = produtos da MESMA conta sem marco ≥ 3% em [d−W, d+W] (o mesmo do 7b, plano-anuncios.js:334)
R_k      = (q_pós / q_pré) ÷ (C_pós / C_pré)
ε_k      = ln R_k / ln(p_pós / p_pré)
var(ln R)≈ 1/q_pré + 1/q_pós + 1/C_pré + 1/C_pós                (Poisson; exige q_pré ≥ 5 = min_unidades_base)
IC95 ε_k = (ln R_k ± 1,96·√var) / ln(p_pós/p_pré)
agregado = média de ε_k ponderada por 1/var (efeito fixo) → ε̂ [lo; hi] por produto; por conta, quando o produto não tem marcos suficientes
```

| Degrau | Condição | Pode dizer |
|---|---|---|
| N0 | marco sem série (Shopee hoje) ou sem controle com volume | «as vendas não estão medidas» (só interno) |
| N1 | 1 marco, com controle | «associação medida» |
| N2 | controle pareado (mesma categoria e curva, `parearControle` da F2 do Chaveiro) | idem, com confiança média |
| N3 | ≥ 2 marcos com o mesmo sinal e IC agregado sem o 0 | «padrão repetido» (é o «subir-cair») |
| N4 | correção deliberada 1 produto/semana com irmão holdout (§ 5.2) | «teste medido»; ainda não é causa |

**Dispara `subir_preco_cair_venda`** quando ≥ 2 marcos de **alta** decididos pelo cliente caem em 90 d (mesmo produto ou ≥ 2 produtos da conta), q_pós/q_esperado < 1 − `queda_min` (15%, o mesmo do 7b) e degrau ≥ N1. O texto do aviso traduz ε em «cada 10% de alta → X% de vendas»: `X = (1,10^ε − 1) × 100`, com faixa.

Ponytail: efeito fixo e aproximação de Poisson. Com superdispersão (dia de pico), o IC fica estreito demais. Upgrade: bootstrap por bloco semanal, quando houver ≥ 5 marcos por conta.

### 3.4 Dependências e auditor

- Catálogo `config/dependencias-cliente.json`: `preco_custo` ganha `passos` (§ 5.3) e o texto da Shopee pede também o **extrato de comissão da Shopee**, porque comissão não se presume. O item novo `decisao_financeira` (verba de Ads mensal, faixa de preço, estoque) é registrado à mão (`pendencia_cliente`, data exata) ou vem da ata (§ 4.3).
- Auditor: a lista de termos proibidos do `relatorio-seguro` ganha «prejuízo» (sem custo), «causou», «garantido» e «com certeza vende».

---

## 4. REVISA

### 4.1 Toda mudança de preço vira um marco medido (`marco_preco`)

As fontes, em ordem de precisão: `exec_ordem` do Chaveiro > change-log `meli_item_mudanca` (fonte `coleta`/`webhook`) > tarefa «Atualizar/Corrigir Preços» com anúncio > ata/tarefa sem anúncio (Shopee). O marco guarda `decisor`, `executor` (`origemPreco`), `de`, `para`, `motivo_declarado` («margem», «concorrência», «igualar contas») e `custo_conhecido` (sim/não, na data).

- Ele é medido em **7, 14 e 28 d** pelo mesmo `medirMarco` (`impacto-tarefas.js:546`), com controle e placebo. É o Merovíngio, não um cálculo novo.
- **Nota ao cliente** (ML, no plano de terça, bloco «Preço: o que medimos»): «Em {data} o preço de {produto} foi de R$ {de} para R$ {para} ({decisão sua | sugestão nossa}). Em {W} dias: vendas {y}% × demais produtos {ctrl}%. {lucro: só com custo}. Associação medida.» Vai **uma vez por marco por janela**, sem tom de culpa.
- Na Shopee e em outro canal sem série, o marco fica com `medido: 'nao_medido:sem_serie'` e conta para o padrão só no degrau N0 (interno).

### 4.2 Raio-X financeiro mensal (`raioX`, puro; dia 1, junto do dossiê mensal)

Três colunas por linha: **Previsão** (faixa conservador–base), **Chance** (p calibrada ou «premissa») e **Medido** (o que aconteceu).

| Linha | Sem custo | Com custo |
|---|---|---|
| Receita líquida (receita − tarifa − frete) | ✔ (ML, F4) | ✔ |
| Margem de contribuição | «não temos o dado» + custo implícito (faixa rotulada) | ✔ medida, cobertura % |
| Ads × teto econômico | gasto, sem teto | ROAS de equilíbrio e alvo |
| Marcos de preço do mês | lista + efeito em vendas | + efeito em **lucro** |
| Caixa gerado (recebido − compras − Ads − taxas) | parcial (F9) | idem |
| Próximo mês | faixa de receita (ritmo + tendência) | faixa de margem |
| 3 decisões sugeridas | as da pauta (§ 4.3) | |

### 4.3 Pauta de reunião gerada pelo sistema (`pautaReuniao`, pura)

Entrada: o raio-X, os marcos, as pendências financeiras, a última ata (`tarefas` «Reunião de Alinhamento») e os compromissos da ata anterior. Saída (≤ 1 página):

1. **Números** (Previsão / Chance / Medido), com «não temos o dado» onde faltar.
2. **O que foi combinado e não aconteceu** (compromissos da última ata × registro). Ponytail: a extração usa uma lista fechada de verbos de compromisso («vai enviar», «se comprometeu», «ficou combinado», «será definido») por frase da ata. Erro esperado: frase sem o verbo. O consultor edita.
3. **Exatamente 3 decisões**, cada uma com opção A/B, o que se mede depois e quando.
4. **O que o sistema precisa** (pendência nº 1).

A ata da reunião seguinte fecha o ciclo: cada decisão vira `marco_preco` ou `pendencia_cliente`, ou é descartada com motivo (vira alinhamento).

### 4.4 Alinhamento «preço é decisão do cliente»

Novo tipo em `config/alinhamentos.json`:
```json
"decisao_preco": { "rotulo": "Preço definido pelo cliente", "rotulo_cliente": "Decisão sua",
  "texto_cliente": "Preço mantido conforme sua decisão de {data}; seguimos medindo o efeito.",
  "suprime": "recomendacao", "relatorio": "medir" }
```
`suprime: "recomendacao"` é um valor novo no predicado `alinhado()`: cala `subir_preco_cair_venda`, `preco_alvo` e `preco_mudou_vendas_cairam` no anúncio, **mas não** cala `marco_preco`, a nota de medição nem `preco_abaixo_piso` (com custo, vender abaixo do custo continua sendo dito, uma vez por revisão). A revisão padrão é de 30 d. Ao vencer, o padrão volta a ser avaliado com os marcos medidos nesse meio-tempo.

---

## 5. MELHORA (recomendação, nunca ordem)

### 5.1 Com custo: piso, alvo e correção semanal

```
lucro_unit(p) = p·(1 − t − i) − c − f − F          (economiaReal, lucro.js:112; t, f medidos; i informado)
piso          p_eq  = (c + f + F)/(1 − t − i)
piso c/ meta  p_min = (c + f + F)/(1 − t − i − m)   (= preco_minimo, já existe)
alvo          maximiza E[lucro] = q0·(p/p0)^ε̂ · lucro_unit(p)
              se ε̂ < −1:  p* = (c + f + F)·ε̂ / ((1 + ε̂)(1 − t − i))      (Lerner)
              se ε̂ ≥ −1 ou sem ε̂ (IC contém 0): p* = sem alvo de elasticidade → banda
banda         [p_min ; P75 dos concorrentes de catálogo/semelhantes (concorrente_anuncio, concorrencia.js)]
recomendado   clamp(p*, banda), passo ≤ guardiao.passo_max_pct (5%) por semana
faixa         p* calculado em ε̂_lo e ε̂_hi → «entre R$ a e R$ b»
```
- **Correção de 1 produto por semana** (regra `preco_alvo`, teto 1/semana/cliente): o produto de maior `|lucro esperado(p*) − lucro(p_atual)|` com ε̂ ≥ N1. Um irmão do mesmo grupo fica **sem mudança** (holdout declarado). Título e fotos ficam congelados por 14 d. Medição em 7/14/28 → degrau N4 no fim.
- **Desconto máximo** (`desconto_max_pct`) e **ROAS alvo** (`economiaAds` / `roas_equilibrio`) já existem. O Guardião só os mostra lado a lado na seção Financeiro e no relatório.
- **Plano de caixa e reinvestimento** (F9 «reinvestimento»): caixa gerado projetado → distribui por produto em ordem de `p_retorno × margem × giro`, com `p_retorno` = p calibrada da regra (`estoque_ruptura` 0,85, `ads_escalar` 0,5, …) × fator medido da família. Saída: «R$ X do caixa do mês podem voltar para estoque de A (p 0,8) e Ads de B (p 0,5); o resto é colchão». Nunca recomenda mais do que o caixa projetado na faixa **conservadora**.

### 5.2 Sem custo: coleta em 3 passos e custo implícito

**Coleta em 3 passos** (pendência nº 1, `custo_coleta.passo`; cada passo libera algo visível):

| Passo | Pede | Libera | Tempo |
|---|---|---|---|
| 1 | custo unitário (compra/fabricação) dos **N produtos do Pareto** (80% da receita, teto 10; na Shopee, os do relatório do Seller Centre) | margem por produto (antes de imposto e comissão) e custo implícito validado | 10 min |
| 2 | imposto % (regime), embalagem/un, extrato de comissão do canal (Shopee) | margem de contribuição, piso, desconto máximo, ROAS alvo | 15 min |
| 3 | custos fixos mensais e margem desejada | ponto de equilíbrio da loja, caixa, reinvestimento | 15 min |

Canais: tela de Custos, planilha ou ERP (`docs/integracao-custos-erp.md`, já construído) ou, na reunião, o consultor digita com o cliente (`por` = consultor; `origem = 'reuniao'`).

**Custo implícito** (`custoImplicito`, puro): uma **faixa** de c deduzida do que o próprio cliente afirma e do mercado. Nunca vira margem em regra; só aparece na pauta e no raio-X com o rótulo «custo implícito, não é o seu custo».

```
c ≤ p_ok·(1 − t − i) − f        para cada preço que o cliente diz que «dá lucro» (registrado com data)
c ≥ p_nao·(1 − t − i) − f       para cada preço que o cliente diz que «não dá lucro» («preços da Luxo tá baixo, assim não dá lucro»)
c ≤ P10_concorrentes·(1 − t) − f   (o mercado vende ali há ≥ 60 d: teto de custo de quem sobrevive; premissa)
```
t, i e f precisam ser **informados ou medidos**. Sem eles, a faixa sai em «preço líquido de comissão e frete», com as letras à mostra. É assim que a reunião transforma «já fiz as contas» em números conferíveis.

### 5.3 Roteiro de recuperação (padrão JBM: altas sem custo e vendas em queda)

| Semana | Ação | Mede |
|---|---|---|
| 0 (reunião) | Passos 1–2 da coleta com o cliente; registrar as afirmações de preço («dá / não dá lucro»); congelar novas altas por 14 d (alinhamento `decisao_preco` se ele não aceitar) | custo em ≥ 80% da receita |
| 1 | Raio-X com margem real; piso por produto; lista «abaixo do piso» × «acima do alvo» | margem medida |
| 2–5 | **1 produto por semana**: o que mais perde lucro, no sentido que o custo indicar (às vezes subir, às vezes descer), com holdout | ε por produto, N1 → N4 |
| 2 | Contas do mesmo dono: papel de cada loja (ex.: uma de preço, outra de kit/volume) em vez de «igualar» sem dado | canibalização medida |
| 4 | Verba de Ads mensal fixa com teto pelo ROAS de equilíbrio | ACOS × teto |
| 8 | Raio-X: lucro do mês × mês da reunião; decidir próximo ciclo | lucro medido |

---

## 6. ONDE

### 6.1 `config/algoritmo.json` → v1.8.0

```json
"guardiao": {
  "$comentario": "Agente Smith (15/10/2026): regras financeiras; nasce DESLIGADO (guardiao.ligado=false: plano idêntico byte a byte).",
  "ligado": false, "janelas_marco": [7, 14, 28], "lag_dias": 1, "min_delta_preco_pct": 3,
  "padrao_janela_dias": 90, "padrao_min_altas": 2, "queda_min_pct": 15,
  "passo_max_pct": 5, "correcoes_por_semana": 1, "holdout_irmao": true,
  "custo_ausente_escala_dias": 30, "decisao_parada_dias": [14, 21],
  "canibalizacao_dif_pct": 10, "caixa_faixa": "conservador"
}
```
Regras novas (no construtor comum, com `foco`, teto e fator):

| id | prior (`priors_efeito`) | KPI | tipo_demanda | evidência |
|---|---|---|---|---|
| `subir_preco_cair_venda` | p 0,45 (premissa: metade da `preco_mudou_vendas_cairam`, porque é revisão de política e não de 1 preço); `fracao_recuperada` [0,15; 0,35; 0,55] | unidades × controle do produto | Reunião de Alinhamento | fato (padrão) + hipótese (causa) |
| `preco_alvo` | p 0,5 (premissa), substituída pelo medido com ≥ 5 correções | lucro/semana do produto × holdout | Atualizar Preços | projeção com ε̂ e faixa |
| `caixa_em_risco` | p 0,6 (ação administrativa: rever compra/Ads) | caixa 30 d na faixa conservadora | Reunião de Alinhamento | projeção |
| `canibalizacao_contas` | p 0,35 (premissa) | vendas somadas das 2 contas × produto | Reunião de Alinhamento | hipótese |
| `decisao_financeira_parada` | — (pendência) | dias até a resposta | Reunião de Alinhamento | pendente |
| `cadastrar_custos` (existente) | ganha `passo` e a escalada de classe | custo em ≥ 80% da receita | — | pendente |

`margem_negativa` **não muda**: «preço abaixo do piso» é a projeção dela.

### 6.2 DDL aditiva (`src/lib/guardiao-schema.js`, importada por `db.js` como os outros `SCHEMA_*`; PK começa por `cliente`; centavos)

```sql
CREATE TABLE IF NOT EXISTS conta_canal (            -- JBM × Luxo: lojas do mesmo dono, inclusive fora do ML
  cliente TEXT NOT NULL, canal TEXT NOT NULL CHECK (canal IN ('ml','shopee','amazon','tiktok','magalu')),
  conta TEXT NOT NULL,                              -- rótulo estável ('Shopee 1'); casa com tarefas.processo
  nome_loja TEXT NOT NULL DEFAULT '', grupo TEXT NOT NULL DEFAULT '', por TEXT NOT NULL, em TEXT NOT NULL,
  PRIMARY KEY (cliente, canal, conta));
CREATE TABLE IF NOT EXISTS marco_preco (
  cliente TEXT NOT NULL, canal TEXT NOT NULL, conta TEXT NOT NULL DEFAULT '', produto TEXT NOT NULL, -- item_id ML ou chave do produto/SKU
  dia TEXT NOT NULL, de_c INTEGER, para_c INTEGER NOT NULL,
  decisor TEXT NOT NULL CHECK (decisor IN ('cliente','assessoria','nao_registrado')),
  executor TEXT NOT NULL DEFAULT '', fonte TEXT NOT NULL,   -- chaveiro|coleta|tarefa|ata|import
  ref TEXT NOT NULL, motivo TEXT NOT NULL DEFAULT '', custo_conhecido INTEGER NOT NULL DEFAULT 0,
  medicoes_json TEXT NOT NULL DEFAULT '{}',          -- retrato {7:{R,eps,ic,degrau},14:…,28:…}; recalculável
  nota_enviada_json TEXT NOT NULL DEFAULT '{}', em TEXT NOT NULL,
  PRIMARY KEY (cliente, fonte, ref));
CREATE TABLE IF NOT EXISTS custo_coleta (
  cliente TEXT PRIMARY KEY, passo INTEGER NOT NULL DEFAULT 0 CHECK (passo BETWEEN 0 AND 3),
  pedido_em TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL DEFAULT '', por TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS afirmacao_preco (        -- «dá / não dá lucro», insumo do custo implícito
  cliente TEXT NOT NULL, produto TEXT NOT NULL, preco_c INTEGER NOT NULL,
  sentido TEXT NOT NULL CHECK (sentido IN ('da_lucro','nao_da_lucro')), fonte TEXT NOT NULL, dia TEXT NOT NULL,
  por TEXT NOT NULL, PRIMARY KEY (cliente, produto, preco_c, sentido));
CREATE TABLE IF NOT EXISTS canal_venda_dia (        -- importação do relatório de pedidos da Shopee (sem API)
  cliente TEXT NOT NULL, canal TEXT NOT NULL, conta TEXT NOT NULL, produto TEXT NOT NULL, dia TEXT NOT NULL,
  unidades INTEGER NOT NULL, receita_c INTEGER NOT NULL, lote TEXT NOT NULL,
  PRIMARY KEY (cliente, canal, conta, produto, dia));
```
Ponytail: sem tabela de raio-X. O retrato mensal vai como `documento_gerado` no livro (hash), como o dossiê.

### 6.3 Funções

`src/lib/guardiao.js` (puro, sem banco): `elasticidade(marcos, serie, controle, c)`, `padraoSubirCair(marcos, c)`, `precoAlvo({ c, f, F, t, i, m, eps, banda, passo })`, `custoImplicito(afirmacoes, { t, i, f, concorrentes })`, `custoDeNaoSaber({ ads, marcos })`, `canibalizacao(contas, precos, marcos)`, `raioX(dados)`, `pautaReuniao(dados)`, `compromissosDaAta(texto)`.
`src/lib/guardiao-real.js`: `marcosDoCliente` (junta change-log, `exec_ordem`, tarefas de preço e importação), `dadosGuardiao(cliente)`, `importarVendasCanal(cliente, arquivo, { confirmar })`.

Edições pontuais:
- `plano-anuncios.js`: 4 regras atrás de `guardiao.ligado`.
- `gatilhos.js`: 6 tipos e `REGRA_DO_TIPO`.
- `consultor-discord.js` `secoesConsultor`: bloco 💰.
- `plano-semana-texto.js`: bloco «Preço: o que medimos» e «Financeiro» por perfil.
- `risco-cliente.js` `sugestoes`: sinal `decisao_financeira_parada`.
- `alinhamentos.js` `alinhado()`: `suprime: 'recomendacao'`.

### 6.4 Rotas (prévia por padrão, `confirmar === true` grava, `por` validado, erro fixo)

`GET /api/cliente/financeiro?cliente=` (seção e raio-X) · `GET /api/cliente/pauta?cliente=&data=` (pauta; PDF pelo Chrome do relatório) · `POST /api/cliente/custos/passo` · `POST /api/cliente/afirmacao-preco` · `POST /api/cliente/marco-preco/decisor` (1 clique: «decisão do cliente») · `POST /api/cliente/contas-canal` · `POST /api/cliente/vendas-canal/importar` (CSV/XLSX ≤ 5 MB, magic bytes, colunas fechadas). Tudo em `src/rotas-guardiao.js`.

### 6.5 Telas

**`/cliente` › Financeiro** (`#secFinanceiro`, dentro do Resumo; ≤ 6 colunas; **1 primário: «Gerar pauta da reunião»**). Topo: cartão de estado («Sem custo há N dias · passo 1/3» ou «Margem medida X% · cobertura Y%»). Tabela por produto: Produto · Preço · Piso / alvo · Margem · Último marco (efeito) · Degrau. Secundários: «Registrar custo (passo N)», «Marcar decisão do cliente», «Importar vendas Shopee». Valor de KPI sem cor, cor só por token, ids no `docs/ux/inventario-cliente.json → financeiro`.

**Relatório de terça:** bloco «Financeiro» na base fixa quando há custo; sem custo, 1 linha («ainda sem custo: {custo_nao_saber}»). **Discord (terça 08:30):** bloco 💰 Agente Smith. **Sprint 90:** o passo 1 da coleta entra no onboarding do `/c/` (cliente aprova campo a campo), e o raio-X vira entregável do D+30.

### 6.6 Shopee e JBM sem integração

O Guardião funciona na JBM em **modo declarado**:
- marcos pela tarefa ou ata (N0);
- custo pelos 3 passos;
- vendas pela importação do relatório de pedidos do Seller Centre (`canal_venda_dia`). Com 4+ semanas importadas, os marcos sobem para N1 com controle dentro da própria conta.

Os avisos ao cliente da Shopee **continuam desligados** (decisão de 12/10: só ML). Para a JBM, o que sai é **pauta e raio-X**.

---

## 7. Testes, fases, riscos

**Testes** (`scripts/teste-guardiao.mjs`, `PS_DB_MEMORIA=1`, séries sintéticas, nunca `data/db.sqlite`):
- ε plantado (−1,5) recuperado dentro do IC;
- IC contém 0 com q baixo → sem alvo;
- 2 altas do cliente + queda pior que o controle → `subir_preco_cair_venda` N3; queda igual ao controle → nada;
- decisor `cliente` com executor `assessoria` → padrão dispara (o caso JBM);
- `precoAlvo` respeita a banda e o passo de 5%, e Lerner só com ε < −1;
- `custoImplicito` com afirmações contraditórias → «inconsistente» em vez de faixa;
- alinhamento `decisao_preco` cala a recomendação e mantém a nota de medição;
- `guardiao.ligado = false` → plano idêntico (a regra de toda chave nova);
- auditor barra «prejuízo» sem custo;
- importação rejeita colunas fora da lista.

| Fase | Entrega | Pronto quando |
|---|---|---|
| G0 | `conta_canal`, `custo_coleta`, `afirmacao_preco`, pauta e raio-X **só leitura** | pauta da JBM gerada com «não temos o dado» correto |
| G1 | `marco_preco` + medição 7/14/28 (ML) + nota no plano de terça (atrás de `guardiao.ligado`) | 3 clientes com marcos medidos, conferidos à mão |
| G2 | elasticidade, padrão subir-cair, avisos internos (Discord, risco) | os 6 clientes do proxy da § 1.2 revisados pelo consultor |
| G3 | importação Shopee + modo declarado | 4 semanas da JBM importadas |
| G4 | `preco_alvo` + correção semanal com holdout, depois de custo em ≥ 3 clientes | 5 correções medidas, prior recalibrado |
| G5 | caixa e reinvestimento (depende de F9: recebíveis, compras com estado) | caixa projetado × realizado em 1 mês |

**Riscos:**
1. **Sem custo, o Guardião vira um alarme sem remédio.** Mitigação: o custo implícito e os 3 passos tornam o pedido pequeno e concreto.
2. **Elasticidade com pouco volume dá IC enorme.** Mitigação: degrau e «sem alvo», em vez de número.
3. **Decisor mal registrado** (culpar o cliente por decisão nossa). Mitigação: padrão `nao_registrado`, que nunca vai ao cliente; 1 clique para marcar.
4. **O cliente lê a nota de medição como crítica.** Mitigação: tom aprovado, «decisão sua», sem dias, auditor.
5. **Igualar preços entre contas** pode ser certo ou errado. O sistema não decide; mede a canibalização.
6. **Importação manual que para de vir:** dia sem import ≠ zero (cobertura declarada).

## 8. NOT_VERIFIED

- «Luxo Têxtil = processo «Shopee 2»» (pelas atas: «conta dois»).
- O conteúdo da «Planilha de Precificação» do Onboard (16/01/2026) e se o cliente a preencheu.
- O formato do export de pedidos do Seller Centre da Shopee (colunas, por SKU/dia) e se a comissão vem por pedido.
- Se o valor fixo mensal de Ads combinado em 15/09 foi definido.
- Se a relação de estoque prometida em 15/09 chegou (canal fora do sistema).
- O «sem resposta há 2 semanas» da JBM (o grupo Shopee não é lido).
- A direção da alta de 31/07 (falta o «de»).
- Endpoints de recebíveis do ML para o caixa (F9/B.4).

## 9. Perguntas ao David (só as que mudam o desenho)

1. **Decisor:** o consultor pode marcar «decisão do cliente» numa mudança de preço com 1 clique (fica no livro de registro)? Ou isso exige um registro do cliente (mensagem ou ata)?
2. **Shopee em modo declarado:** aprovamos a importação semanal do relatório de pedidos da Shopee (o cliente ou o consultor sobe o arquivo) como fonte oficial de vendas até haver API? Sem isso, nada da JBM é medido.
3. **Congelar altas:** o roteiro propõe «nenhuma alta nova por 14 d até termos o custo». Isso vira recomendação padrão a todo cliente no padrão subir-cair, ou só quando o consultor ligar?

---

## RESUMO EXECUTIVO

1. A JBM não é exceção. Na carteira ML, **1 de 42 clientes tem algum custo** (Uniaodog, 22 SKUs) e **nenhum** tem os percentuais completos: 98% estão cegos de margem.
2. **R$ 45.419 de Ads em 28 dias (38 clientes)** rodam sem teto econômico. **R$ 982 mil de GMV** em 28 dias estão sem margem conhecida.
3. A pendência «informar custos» está proposta em 41 clientes há até 10 dias e foi aprovada em 1. Pedir não basta: falta um caminho curto.
4. No proxy de 90 dias, **6 clientes** têm anúncios com 2 altas seguidas de preço e queda de vendas pior que o resto da conta. É proxy, com origem não verificada.
5. A **JBM** não tem dado nenhum de vendas nem de custo: Shopee sem coleta, ML não conectado. O sistema sabe o que as atas e tarefas dizem.
6. As atas provam **2 altas em 90 dias** decididas com o cliente (kit 2 peças → R$ 49,90 em 05/08; tapetes +R$ 5,20 em 15/09, «para evitar operação no negativo»), **sem custo na mesa**.
7. Atenção: o **contrato Shopee da JBM vence em 17/10**, antes da reunião de terça. O health score é 15,5.
8. O Agente Smith é **dono temático**, não um segundo motor: 6 regras no Algoritmo com prior e KPI, 6 avisos projetados, medição pelo Merovíngio, assinatura ao cliente do Merovíngio.
9. **AVISA:** sem custo há N dias, com o «custo de não saber» rotulado; padrão subir-cair, com elasticidade e intervalo; abaixo do piso; caixa em risco; contas do mesmo dono competindo; decisão financeira parada.
10. A novidade que destrava a JBM: **decisor ≠ executor**. Altas executadas por nós, mas decididas pelo cliente, contam no padrão. Hoje `origemPreco` as esconderia.
11. **REVISA:** toda mudança de preço vira marco medido em 7/14/28 d, com nota curta ao cliente. Há um raio-X mensal (Previsão/Chance/Medido) e uma **pauta de reunião gerada pelo sistema** com 3 decisões.
12. «Preço é decisão do cliente» vira o alinhamento `decisao_preco`: cala a recomendação, **nunca a medição**.
13. **MELHORA com custo:** piso, preço-alvo pela elasticidade dentro da banda dos concorrentes, 1 correção por semana com holdout, desconto máximo, ROAS alvo e reinvestimento do caixa com p de retorno.
14. **MELHORA sem custo:** coleta em 3 passos (10 min o primeiro) e «custo implícito»: uma faixa deduzida das próprias falas do cliente («a R$ X não dá lucro»), sempre rotulada.
15. Sem dado da Shopee, a JBM roda em **modo declarado**: importação semanal do relatório de pedidos (pergunta 2).
16. Fases G0→G5. A G0 (pauta e raio-X só leitura) já serve para terça. Tudo nasce desligado e o plano sai idêntico com a chave em `false`.
17. Três perguntas: quem marca o decisor, importação da Shopee como fonte oficial, congelar altas por 14 d.

---

## Pauta da reunião de terça 20/10/2026, 16h · JBM Têxtil (lojas Shopee JBM e Luxo)

**Objetivo:** sair com o custo dos produtos que mais vendem e com 3 decisões medíveis. Nenhum preço muda na reunião sem custo.

**1. Onde estamos (5 min)**
- Vendas por loja nos últimos 28 dias × 28 anteriores: **não temos o dado** (sem integração com a Shopee). Pedir na reunião o relatório de pedidos de 90 dias das duas lojas.
- Margem por produto: **não temos o dado** (nenhum custo informado).
- Investimento em Ads por mês: **não temos o dado** no sistema. Recarga automática de 7% ligada desde 05/08; o valor fixo mensal combinado em 15/09 não está registrado.
- Execução: 124 ações concluídas desde junho (jun 25 · jul 26 · ago 26 · set 38 · out 9 até 09/10); 40 em fila; 1 aguardando retorno da loja desde ~25/09 (duplicar anúncio de kit 2 mantas).
- Contrato Shopee: vencimento registrado em **17/10/2026**. Confirmar a situação antes ou no início da reunião.

**2. O que mudou de preço e o que sabemos (5 min)**
- 05/08: kit 2 peças → R$ 49,90 (alinhado, após comparar concorrentes).
- 15/09: tapetes unitários e kits +R$ 5,20, nas duas lojas, «para melhorar margem e evitar operação no negativo».
- 31/07: ajuste de valores pedido pela loja (Tambaba 49,99; kits banheiro 27,80–29,80; manta king 48,80), com direção não registrada.
- Efeito dessas mudanças nas vendas: **não temos o dado**. Com o relatório de pedidos, medimos cada uma contra os produtos que não mudaram.

**3. O que foi combinado e não aparece no registro (5 min)**
- Relação atualizada de estoque (combinada em 15/09).
- Valor fixo mensal de Ads (combinado em 15/09 para a reunião seguinte).
- Planilha de gastos de Ads dos últimos 30 dias (pedida pela loja em 15/09): conferir se foi enviada.

**4. Custo em 3 passos, feito na própria reunião (20 min)**
- Passo 1: custo unitário (fabricação ou compra) dos produtos que mais vendem nas duas lojas: tapetes, kits de banheiro, kit 2 peças, mantas (Tambaba, king, indiana, ruga).
- Passo 2: imposto (regime), embalagem por unidade e **extrato de comissão e taxas da Shopee** das duas lojas (não presumimos a comissão).
- Passo 3 (pode ficar para depois): custos fixos do mês e a margem que a loja quer.
- Registrar as afirmações da loja com o preço de cada produto: «a R$ X dá lucro / não dá lucro», inclusive o «preço da Luxo está baixo». Com isso calculamos o custo implícito e conferimos as contas da loja juntos.

**5. Três decisões (15 min)**
1. **Igualar os preços da Luxo aos da JBM?** A: igualar agora, sem custo. B: com o custo do passo 1, calcular o piso de cada produto e decidir loja por loja, com papel diferente para cada uma (por exemplo, uma loja de unidade e outra de kit/volume). Depois medimos as vendas somadas das duas lojas por produto em 14 e 28 dias.
2. **Pausa de altas por 14 dias até ter o custo?** A: sim, e qualquer alta depois vem com piso calculado e é medida. B: não; a loja define o preço (fica registrado como decisão da loja) e nós medimos o efeito de cada mudança em 7/14/28 dias.
3. **Investimento mensal fixo em Ads?** A: valor fixo com teto pelo retorno mínimo, calculado com o custo. B: manter a recarga de 7% até o custo chegar. Depois medimos o retorno por real investido × teto.

**6. O que precisamos da loja até sexta (5 min)**
- Relatório de pedidos de 90 dias das duas lojas (export da Shopee).
- Custos do passo 1 e 2 (se não fecharem na reunião).
- Relação de estoque atual.
- Confirmação do responsável pelas decisões de preço e do melhor canal para respostas.

Rodapé: os números de vendas e de margem que faltam acima **não foram estimados**. Assim que chegarem, medimos cada mudança contra os produtos que não mudaram. É associação medida, não prova de causa.

---

## Decisões do David (15/10/2026, ~03h40)
1. **Quem decidiu o preço:** o consultor marca «decisão do cliente» com 1 clique na mudança de preço executada pela equipe; sem marcação conta como da assessoria; a medição nunca para.
2. **Shopee:** NÃO importar planilha — esperar o adaptador da Shopee (marco M4 do plano de autonomia). Até lá a JBM (e Shopee em geral) fica «não temos o dado» na medição; a pauta de terça usa atas/tarefas e declara a falta.
3. **Sem custo e quer subir preço:** recomendação padrão = pausar novos aumentos por 14 dias enquanto o custo é coletado; com custo, passa a preço-alvo. Sempre recomendação.
