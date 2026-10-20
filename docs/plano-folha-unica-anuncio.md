# Folha do anúncio no Resumo: Anúncios (ofertas e promoções), Ads, Full e Métricas

## Contexto

Pedido do David em 07/10/2026: na **tela de Resumo do cliente**, 4 caixas de seleção (Anúncios · Ads · Full · Métricas).
- Cada caixa marcada põe seus dados **numa única folha**, uma linha por anúncio.
- Com as 4 marcadas, a folha mostra uma leitura **incorporada** de cada anúncio, que também alimenta o **Merovíngio**.
- Ele pediu para estruturar isso **como banco**.

Este plano junta três desenhos independentes: banco + Merovíngio · tela · robustez e testes. Ele entra **depois** do plano em andamento (resultado por tarefa, preço na causalidade, custo ↔ anúncio). As duas frentes mexem na aba Resumo, e esta reaproveita o change-log `meli_item_mudanca` que aquela já criou (hoje com 0 linhas reais: a semeadura não rodou).

Princípio (CLAUDE.md): nada de segundo motor. A folha só **lê e compõe** o que os motores já produzem:
- `diagnosticarConta`, as ações `anuncio_*` do plano, `metricasFull`, promoções, ofertas e `custoDoAnuncio`.
- O estado novo (promoção, Ads, Full) entra no Merovíngio como **fator de confusão**, no mesmo molde do preço.

## 1. Banco: estender o change-log, sem tabela nova

- **`meli_item_mudanca`** ganha os campos de estado `promocao` (fonte `promo`) e `ads` (fonte nova `ads`).
  - Full, estoque zerado e pausado já estão no change-log (`logistica`, `estoque_zero`, `status`).
  - O CHECK do SQLite não se altera no lugar. A migração é `migrarMudanca(h)` em `acomp-schema.js`:
    - recria a tabela com cópia, dentro de uma transação;
    - é idempotente: não faz nada se o banco já é novo ou já foi migrado;
    - o índice é removido antes e recriado depois;
    - é chamada em `db.js` e em `promocoes-db.js criarSchema`, para o banco em memória dos testes.
  - `SCHEMA_MUDANCA` passa a ser exportado.
- **Não haverá `anuncio_dia`** (snapshot diário). Seriam cerca de 2,4 milhões de linhas por ano, duplicando `meli_serie_item`.
  - O estado de um anúncio num dia D é reconstruído voltando no change-log a partir do valor atual (`estadoEm`).
  - Para uma data anterior ao início do histórico, o estado aparece como "—".
  - O change-log deve ficar em menos de 100 mil linhas por ano.
- **Onde nasce cada evento.** Vale a mesma regra do preço: 1 leitura por dia, `INSERT OR IGNORE`, e sem leitura anterior não há evento.

| Domínio | Onde é derivado | Quando grava |
|---|---|---|
| **Promoção** (`'nenhuma'` ↔ `'<TIPO> −X%'`) | `promocoes-db.js gravarColeta`, dentro da transação, comparando as ofertas `started` antes e depois | Anúncio lido nesta coleta e também na anterior. Cruzou a fronteira "nenhuma" ou mudou o tipo. Mudança só no % aparece no preço |
| **Ads** (status cru: active/paused/idle/hold/deleted/sem_anuncio) | `meli-serie.js`: o corpo de `coletarAds` vira `gravarAdsItem`; compara a foto `atual` anterior antes do DELETE | Cruzou a fronteira `active` (ligou ou desligou). Idle ↔ hold não grava |
| **Full / estoque / pausado** | já gravados em `gravarItens` | o leitor só considera `fulfillment`, cruzar o zero e `active` |

- **Semeadura retroativa:**
  - só de promoção: `promo_oferta started`, com início e fim informados pelo ML;
  - Ads e Full não têm de onde tirar histórico, então ele começa na 1ª coleta depois da implantação (isso fica declarado).
- **Módulo puro novo `src/lib/estado-anuncio.js`**, sem imports, para promoções e coleta usarem sem abrir o banco:
  - `estadoPromocao`, `diffPromocao`, `diffAds`, `cruzaFronteira`, `estadoEm`, `ROTULO_ADS`, `leituraAnuncio`.
- **Correções ligadas a isto:**
  - `anuncios.js:32`: `visitas: s.visitas || 0` vira `null` quando o anúncio não tem cobertura de visitas (fora do top 200). A conversão também fica "—". Hoje mostra 0.
  - `diagnostico-conta.js:79`: `logistica: i.logistica || ad?.logistica`. Hoje `full_envio` não dispara para anúncio sem Ads. A frente em andamento pode já ter corrigido; conferir.

## 2. Merovíngio

- **`marcarEstado(m, { tipo, itens, eventos, params })`** em `impacto-tarefas.js`, gêmeo de `marcarPreco`. Considera os eventos do alvo na janela que cruzam fronteira:
  - entrou ou saiu de promoção;
  - Ads ligado ou desligado;
  - entrou ou saiu do Full;
  - estoque zerou;
  - pausou ou reativou.
- **Exceção:** quando o evento é a **própria intervenção** da família da tarefa, ele não confunde. Por exemplo: promoção em `oferta_relampago`, `campanhas_desconto` ou `cupom`; Ads em `ads`; Full em `full`.
- **Efeitos de um evento que confunde:**
  - o anúncio sai do grupo de controle;
  - a data entra nos placebos;
  - a confiança perde 3 pontos por campo, com o motivo escrito: "entrou em promoção SMART −15% em 03/10; Ads desligado em 05/10: o efeito pode ser desses eventos, não da tarefa";
  - `confundido_estado` entra em `excluirDaAprendizagem`, conforme o modo decidido na pergunta 1;
  - contadores `confundidas_estado` e `excluidas_estado` em `/resultados` e no aprendizado.
- **Configuração** em `config/atribuicao.json`, bloco `estado`:
  - `campos`;
  - `intervencao` por campo;
  - `pontos_por_campo`;
  - `modo`: `observar` | `ativo` | `so_confianca`.
- **Na tela:**
  - o cartão de "Resultado das tarefas" ganha o segmento "entrou em promoção no dia 3 (pode ter interferido)" ou "Ads ligado no dia 0 (a própria tarefa)";
  - o micro gráfico ganha o ponto do evento.
- **Fica para depois (declarado):**
  - aprender por contexto (com/sem promoção, com/sem Ads, Full/não Full): precisa de pelo menos 8 medidas por célula;
  - `causalidadeVendas` dizendo "a queda coincide com saída de promoção em N anúncios".

## 3. Leitura cruzada, sem motor novo

`leituraAnuncio(item, { promo, oferta, ads, full, acoes, eventos, bench })` só monta frases a partir do que já existe:

- **Fatos** (dado medido; quando falta, "—"):
  - Ads: "Ads gastou R$ 120,00 em 28 dias com ROAS 0,8 (2 vendas atribuídas)";
  - conversão: "Conversão 2,1%, 40% abaixo da média da conta (3,5%)";
  - promoção: "Em promoção SMART −15% desde 03/10 (até 20/10)";
  - Full: "No Full, 9 dias de estoque no ritmo atual";
  - vendas: "12 un em 28 dias (−30% sobre os 28 anteriores)".
- **Hipóteses**, sempre marcadas como hipótese:
  - o problema e a hipótese das ações `anuncio_*` do plano para aquele anúncio;
  - a frase de coincidência: "A queda coincide com: saiu da promoção em 03/10. Hipótese, não medido; compare com os anúncios que não mudaram".
- **Ações do plano** daquele anúncio, com link para a aba Plano. Sem ação: "Nenhuma ação do plano para este anúncio".
- **Nunca** aparece promessa ("vai vender", "garantido").

## 4. API e filtros

- **`GET /api/cliente/folha?cliente=&blocos=anuncios,ads,full,metricas&f=&pagina=&ordem=`** e **`/api/cliente/folha.csv`**: saem da **mesma** função, `folhaDoCliente` em `src/lib/folha-anuncio.js`.
  - Cerca de 8 consultas por cliente, sem N+1.
  - Meta: menos de 1 s com 1.500 anúncios.
  - A montagem das linhas de `anunciosDoCliente` é extraída para `linhasDoPeriodo` e reaproveitada pelas duas.
- **Resposta:**
  - `honestidade` por bloco, com a data da coleta e as ressalvas. Exemplos: promoções coletadas só nos clientes com a coleta ligada; Ads de 28 dias, sem leitura por dia; visitas só dos 200 que mais vendem; Full = logística na última leitura;
  - `totais` por bloco: no máximo 4 KPIs, valor nunca colorido;
  - `itens`: só os blocos marcados; `leitura` só com os 4 marcados;
  - 50 por página.
  - Ordens disponíveis: faturamento, piores variações, conversão, desconto, gasto em Ads, ROAS, cobertura do Full. Cada ordem só vale se o bloco dela estiver marcado.
- **Contrato dos blocos:**
  - **Anúncios**: promoção (estado, tipo, desconto, preço promocional, fim, desde) · candidatas · oferta (estado do job, otimizado ou publicado em) · preço, preço original, mudanças de preço em 28 dias · custo e origem (`custoDoAnuncio`).
  - **Ads**: status, custo, receita, ROAS, ACOS, CTR, unidades, variação do custo, desde.
  - **Full**: no Full?, logística, estoque, dias de cobertura, risco de ruptura, sugestão (`sugestaoFull`), desde.
  - **Métricas**: unidades, faturamento, Δ%, visitas (null fora da cobertura), conversão, preço realizado, curva ABC.
- **Validação:** 400 sem repetir o valor recebido ("tópico desconhecido", "marque ao menos um tópico", "ordenação indisponível…", "página fora da faixa"). Isolamento por cliente; prospect recusado.
- **Filtros:** painel novo **`folha`** em `filtros.js`:
  - campos: curva, em promoção, com Ads, ROAS, no Full, risco de ruptura, tem ação do plano, faturamento, Δ%, conversão;
  - parâmetro de endereço `ff`;
  - período padrão: últimos 90 dias.

## 5. Tela: bloco "Folha do anúncio" no Resumo

- **Posição:** Próximas ações → Resultado das tarefas → **Folha do anúncio** (`#secFolha`) → Depende do cliente → Motor (pergunta 4).
- **Caixas de seleção nativas:** Anúncios (ofertas e promoções) · Ads · Full · Métricas, cada uma com contador.
  - A escolha é lembrada por cliente em `localStorage` (com try/catch) e espelhada no endereço (`?folha=`).
  - Padrão na primeira vez: pergunta 2.
  - Botão "Marcar tudo e ver a leitura".
- **A folha tem no máximo 6 colunas, sem exceção ao sistema de design:**
  - **Anúncio**: fixa; foto, título ↗, MLB, preço, estoque, status;
  - **uma coluna por tópico marcado**: célula de 2 a 3 linhas com os números-chave do bloco;
  - **Leitura**: só com os 4 marcados; selos fato / hipótese / medido.
- **"Ver tudo"** em cada linha abre os detalhes completos de cada bloco: eventos dos 30 dias (preço, promoção, Ads, Full) e ações do plano.
  - Abaixo de 640 px, cada linha vira cartão.
- **Também no bloco:**
  - KPIs por bloco no cabeçalho;
  - filtros do painel `folha`, ordenação e paginação de 50;
  - **"Baixar a folha (com filtros e tópicos marcados)"** em CSV;
  - cada bloco tem seu próprio estado de vazio ou erro honesto. Exemplo: "Promoções não coletadas para este cliente — ative em Promoções".
- **Nada é removido:**
  - "Anúncios no período" (aba Anúncios) ganha um link "ver na Folha do anúncio";
  - Mais vendidos, Ofertas e Promoções ficam como estão;
  - inventário `docs/ux/inventario-cliente.json` com os ids novos.

## 6. Testes

- **`scripts/teste-folha-anuncio.mjs`** (`PS_DB_MEMORIA=1`, rota por HTTP efêmero). Massa: 2 clientes + prospect, 1.500 anúncios. Prova:
  - contrato para os 15 subconjuntos de blocos (bloco não marcado = chave ausente; `leitura` só com os 4);
  - paginação e totais iguais em todas as páginas;
  - honestidade por bloco: visitas null, promoção null sem coleta, Full null sem logística, nenhum null vira 0 no CSV;
  - isolamento;
  - CSV = tela, com defesa contra fórmula;
  - filtros do painel `folha` (painel `cliente` é recusado);
  - leitura com fatos dos 4 blocos e a ação do plano, sem palavras de promessa;
  - menos de 1 s.
- **`teste-historico-anuncio.mjs`:**
  - migração do CHECK: preserva linhas e ids, recria o índice, aceita `promocao`/`ads`, recusa campo inválido, 2ª execução não faz nada;
  - diffs de promoção e Ads com fronteira;
  - semeadura de promoção idempotente;
  - `estadoEm`.
- **Outros:**
  - `teste-impacto.mjs`: `marcarEstado` (intervenção não confunde; sai do controle; −3 por campo; modo observar/ativo/só_confianca);
  - `teste-retroalimentacao.mjs`: `excluidas_estado`;
  - `teste-filtros.mjs`: painel `folha`;
  - `teste-shell-ui.mjs`: ids novos;
  - `teste-promocoes*.mjs`: diff de promoção dentro de `gravarColeta`, sem importar `db.js`.
- **Suíte inteira verde.**

## 7. Ordem segura de implantação

1. **Banco e escrita do estado** (invisível na tela): migração, diffs de promoção e Ads na coleta, semeadura de promoção. Começa a acumular histórico.
2. **Leitura em lote** (`folha-anuncio.js`) + rotas + painel `folha` + correção de visitas.
3. **Tela** `#secFolha` no Resumo + link em "Anúncios no período".
4. **Merovíngio** `marcarEstado` no modo decidido (pergunta 1) + segmentos no cartão e no gráfico.
5. **Documentação:**
   - `docs/acompanhamento-e-retroalimentacao.md`: estado como fator de confusão;
   - `docs/ux/sistema-de-design.md`: Resumo com a Folha;
   - `docs/filtros-avancados.md`: painel `folha`;
   - `CLAUDE.md`: "Onde está cada coisa".
6. **Verificação:**
   - suíte;
   - semeadura;
   - reinício;
   - no navegador, União Dog com as 4 caixas: 236 anúncios, 148 em promoção, Ads e Full preenchidos ou "—" honesto, leitura com ações do plano;
   - CSV igual à tela.

## Perguntas ao David (recomendação em negrito)

1. **Merovíngio:** o anúncio entrou ou saiu de promoção, ligou ou desligou Ads, foi para o Full ou zerou o estoque durante a janela da tarefa. A medida
   - **sai do aprendizado já (como o preço ≥ 3%), com contador visível**;
   - ou fica 28 dias em "observação" (só mostra quantas mudariam) antes de valer;
   - ou só perde confiança?
2. **Primeira abertura:** **as 4 caixas marcadas (a leitura aparece logo)**, ou só Métricas? Nas próximas aberturas vale o que cada pessoa deixou marcado.
3. **Coleta de promoções (só leitura) para todos os clientes com Mercado Livre:** hoje são 4. Sem a coleta, a coluna de promoções fica "—" e o Merovíngio não enxerga a promoção. **Sim, em lotes de 5 clientes por madrugada**, ou só os 4 atuais?
4. **Posição:** **depois de "Resultado das tarefas"**, ou logo depois de "Próximas ações"?
