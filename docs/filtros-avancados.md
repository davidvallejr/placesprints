# Filtros avançados (estilo Pipedrive) — contrato único para todos os painéis

Implementado em 07/10/2026. Uma gramática só, em `src/lib/filtros.js`, para todos os painéis: condições combináveis com **E/OU**, operadores por tipo de campo, **período com a data filtrada explícita**, comparação com o **período anterior** e com o **mesmo período do ano passado**, **filtros salvos** (favoritos) e serialização na URL (`?f=`) para que exportações e documentos respeitem o filtro ativo.

## Definição de um filtro

```json
{
  "painel": "cliente",
  "arvore": { "op": "E", "itens": [
    { "campo": "canal", "operador": "igual", "valor": "ML" },
    { "campo": "consultor", "operador": "igual", "valor": "Giovanna Torres" },
    { "op": "OU", "itens": [ { "campo": "curva", "operador": "em", "valor": ["A", "B"] }, { "campo": "faturamento", "operador": "maior", "valor": 2000 } ] }
  ] },
  "periodo": { "campo": "data_venda", "preset": "ultimos_3_meses", "comparar": "ano_anterior" }
}
```

- **Operadores:** `igual`, `diferente`, `em` (é um de), `contem`, `nao_contem`, `maior`, `menor`, `entre`, `vazio`, `nao_vazio`. Cada tipo de campo (texto, enum, número, data) aceita só os que fazem sentido; o servidor recusa o resto com mensagem legível (400) que nunca repete o valor recebido.
- **Grupos:** até 3 níveis, até 30 condições.
- **Período:** `hoje`, `ontem`, `este_mes`, `mes_passado`, `este_ano`, `ano_passado`, `ultimos_3_meses`, `ultimos_90_dias`, `personalizado` (`de`/`ate`, máx. 3 anos). Intervalos sempre **fechados** e com rótulo:
  - "Últimos 3 meses" = **meses civis**: do dia 1 de dois meses atrás até hoje (inclui o mês atual). Ex.: 01/08–06/10.
  - "Últimos 90 dias" = **dias corridos**, hoje incluído. Ex.: 09/07–06/10.
  - `campo` diz **qual data** está sendo filtrada (data da venda = dia do pedido no Mercado Livre; criação do anúncio; data de conclusão da tarefa; prazo; competência). Cada painel tem a sua padrão.
  - **Comparação anterior:** para recortes civis é o mesmo recorte deslocado (este mês → mês anterior até o mesmo dia; últimos 3 meses → os 3 civis antes; ano → ano anterior); para corridos/personalizado, o mesmo número de dias imediatamente antes. **Ano anterior:** as mesmas datas um ano antes (29/02 vira 28/02). Os dois intervalos voltam explícitos na resposta.

## Campos por painel

| Painel | Campos | Datas filtráveis (padrão em negrito) |
|---|---|---|
| `execucao` (tarefas do Notion) | cliente, canal (= Processo), consultor (expande para os clientes dele), analista (= Responsável), projeto, sprint, status, tipo_demanda, titulo, esforco, prazo, data_conclusao | data_conclusao, prazo, data_inicio, **atividade** |
| `cliente` (anúncios do ML) | canal, anuncio_id, titulo, sku, status_anuncio, curva (A/B/C por faturamento no período), logistica, preco, estoque, vendas_unidades, faturamento, visitas, conversao, ads_custo, criado_em, preco_mudou (sim/não), variacao_preco_pct | **data_venda**, criado_em |
| `gmv` | cliente, canal, consultor, analista, faturamento, variacao_pct | **data_venda** |
| `analistas` | analista, cliente, canal, status | **data_conclusao**, atividade |
| `distribuicao` (ações) | cliente, canal, consultor, regra, status, horizonte, prioridade, titulo, delegado_a | **prazo**, criado_em |
| `comercial` | etapa, origem, nome | **criado_em** |
| `resultados` | canal, cliente, analista, tipo, nicho, uf, regiao | **data_conclusao** |
| `folha` (Folha do anúncio, Resumo do cliente) | curva, em_promocao (sim/não), com_ads (sim/não, investimento em 28 dias), roas, no_full (sim/não), risco_ruptura (sim/não, menos de 10 dias de estoque), tem_acao_plano (sim/não), faturamento, variacao_pct (vs período anterior), conversao | **data_venda** |

**Campos de 07/10/2026:**
- `preco_mudou` e `variacao_preco_pct` (painel `cliente`) vêm do histórico do anúncio (`meli_item_mudanca`, campo preço, uma leitura por dia): "mudou" = houve ao menos uma mudança registrada no período, até 1 centavo; a variação é do 1º "de" ao último "para" do período (null sem mudança). Sem histórico no período = "não mudou registrado", não "preço parado".
- `nicho`, `uf` e `regiao` (painel `resultados`) recortam as medidas pela conta: nicho = `clientes_central.nicho` curado em `config/nichos.json` (opção "Sem nicho registrado" para vazio, "Não informado", "Multinicho", Mix…); UF = `meli_contas.uf` (estado do vendedor no cadastro do Mercado Livre; opções = 27 UFs + "Sem UF registrada"); região = a da UF (Norte, Nordeste, Centro-Oeste, Sudeste, Sul ou "Sem UF registrada"). A UF nunca é deduzida de CNPJ.

**Painel `folha` (08/10/2026):** os campos são lidos da linha composta por `src/lib/folha-anuncio.js` (promoção da última coleta, Ads dos últimos 28 dias, Full pela logística da última leitura, ações `anuncio_*` abertas do plano). Campo bool vale `1`/`0` e o chip mostra "é igual a Sim/Não"; dado **não coletado** é `null` e nunca casa nenhuma condição (nem "é igual a Não"): promoção sem coleta no cliente, Ads sem coleta na conta, logística vazia. Na URL o filtro vai em **`?ff=`** (o `?f=` da mesma tela é do painel `cliente` de "Anúncios no período"); período padrão: últimos 90 dias. Para isso `PSFiltros.montar(el, { parametro })` (`src/web/filtros.js`) aceita o nome do parâmetro de URL que o painel lê e escreve — padrão `f` nas 8 telas, `ff` na Folha —, então dois PSFiltros na mesma página não brigam pela URL. `GET /api/cliente/folha?cliente=&blocos=anuncios,ads,full,metricas&ff=&ordem=&pagina=` e `GET /api/cliente/folha.csv` (mesmos parâmetros, lista inteira); filtro de outro painel → 400. Teste: `node scripts/teste-folha-anuncio.mjs`.

Campos com `coluna` são filtrados direto no SQL (lista fechada, sempre parametrizado, `LIKE` com escape). Campos calculados (faturamento no período, curva, conversão…) são filtrados em memória sobre as linhas já calculadas, com as mesmas regras.

## API

- `GET /api/filtros/definicao?painel=` → campos, operadores válidos por campo, valores das listas (clientes, consultores, analistas oficiais, canais…), datas, presets, comparações e os filtros salvos do painel.
- `GET /api/filtros/periodo?preset=&de=&ate=` → intervalo resolvido + anterior + ano anterior, com rótulos.
- `POST /api/filtros/validar` → normaliza e devolve os chips legíveis.
- `GET/POST /api/filtros/salvos?painel=` · `POST /api/filtros/salvos/usar` · `DELETE /api/filtros/salvos/:id?painel=` → favoritos (nome único por painel; sobrescreve).
- **Aplicação:** `?f=<base64url>` em `/api/kpis`, `/api/tarefas`, `/api/graficos` (painel `execucao`), `/api/gmv` (período + condições sobre as linhas por cliente) e `/api/cliente/anuncios?cliente=&f=` (anúncios com vendas, visitas, Ads, curva e comparações no período). A resposta traz `filtro.chips` (o que está aplicado) e `filtro.serializado` (para exportações e links).
- Cobertura declarada: dia sem coleta **não** vira zero; a resposta avisa quando o período pedido ultrapassa a coleta.
- **Demais painéis (07/10):** `?f=` também em `/api/planos/acoes`, `/api/planos/acoes.csv`, `/api/planos/clientes`, `/api/planos/insights` (painel `distribuicao`), `/api/analistas/visao`, `/api/analistas/clientes-atrasados`, `/api/analistas/tipos` (painel `analistas`), `/api/comercial/prospectos` (painel `comercial`) e `/api/resultados/padroes` (painel `resultados`). Sem `?f=` a resposta é idêntica à de antes; com `?f=` vem o campo `filtro: { chips, periodo, aviso? }` — rotas que devolviam array passam a devolver `{ acoes | clientes, filtro }`. Condição sobre campo que a visão não tem (ex.: cliente na visão por analista) **sai da árvore e vira `filtro.aviso`**, e período que a visão não recalcula também é avisado — nunca filtra em silêncio. Filtro de outro painel → 400. Teste: `node scripts/teste-filtros-rotas.mjs`.

## Regras de produto

- Ao aplicar, **tudo** no painel segue o filtro (indicadores, gráficos, tabelas, totais, exportações).
- Os chips mostram cada condição e o período; cada um pode ser removido sozinho (`removerCondicao`), e "Limpar" tira todos.
- Filtro salvo é do painel; qualquer pessoa da equipe vê (o painel é interno). No painel do cliente, os dados são sempre **daquele cliente** e as listas de valores só trazem o que existe para ele.
- O filtro **nunca** muda o que o algoritmo vê: diagnóstico, retroalimentação e plano de ação são calculados sobre os dados completos da conta; o filtro recorta o que é exibido (inclusive a lista de ações).

## Testes

`node scripts/teste-filtros.mjs` (presets e comparações, validação, SQL em SQLite de memória, predicado, expansão de consultor, chips/remoção, URL, favoritos, definição).
