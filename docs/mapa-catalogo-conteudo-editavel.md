# Anúncio de catálogo: o que o sistema sabe, onde recomenda conteúdo e como bloquear (mapa de 08/10/2026)

Pedido do David: "quando o anúncio for catálogo é importante ter um SELO de catálogo e não informar sobre fotos, descrição etc., pois se for catálogo próprio pode até realizar alterações, mas se for catálogo de terceiros não tem como alterar". Mapa feito por leitura do código, do banco (somente leitura) e das páginas públicas da API do Mercado Livre (os domínios `developers.mercadolivre.*` devolveram 403 ao WebFetch; os fatos vêm de trechos nos resultados de busca).

## A. Dados que existem hoje

- `meli_item.catalogo` (de `catalog_listing`, `src/lib/meli-serie.js:48`; DDL `src/lib/db.js:152-161`): 8.830 linhas, 1.868 de catálogo (21,2%). Sem os 2 prospects `[Comercial]`: 8.717 linhas, 1.834 de catálogo, em 32 de 38 contas, 1.213 ativos, ≈ 38% da receita de 90 dias.
- `meli_ads_item.catalogo` e `buy_box` (`meli-serie.js:233-235`, só quem tem linha de Ads). `visao_json.catalogo` (price_to_win, só 356 itens). `promo_anuncio.catalogo`. `gmv.js:153` já devolve `catalogo`; `acompanhamento.js:206/445` seleciona mas `cartaoItem` (`:457`) não repassa.
- `catalog_product_id` é pedido em `meli-api.js:203` e **descartado**. Nada guarda catálogo **próprio × terceiros**: não há campo nem heurística (`parent_item_id`, `item_relations`, `official_store_id` não aparecem no código).
- Clientes com mais catálogo: 01Smart 295/549, Moema 258/1148, Minas Geral 205/446, Rei das Toalhas 188/219 (86%), Áurea 137/306, LS Importados 111/215, Ouro Cão 106/107 (99%), Rotec 100/289.
- Ações vivas em itens de catálogo hoje: `conteudo_fotos` 20/30, `ima_conversao` 41/88, `duplicacao_estrategica` 23/69, `urgencia_oculta` 31/97, `sazonal` 59/194, `ads_otimizar_antes` 1/8, `oferta_completa` 2/2 (as de conteúdo estrito somam 87; nenhuma foi ao Notion; 23 aprovadas); 2 jobs `oferta_completa` em rascunho sobre catálogo.

## B. API do Mercado Livre (fontes públicas)

- Em anúncio de catálogo (`catalog_listing=true`) o conteúdo (título, fotos, descrição, ficha) vem do catálogo; o vendedor altera preço, estoque, tipo de anúncio, garantia e envio. Corrigir o conteúdo é por **sugestão** com revisão do ML, valendo para todos os vendedores do produto.
- Não existe "dono" do produto de catálogo com edição direta nas fontes oficiais; o mais próximo é o Brand Central (`catalog_suggestions`) e Loja Oficial/Brand Protection, que **não expõem** campo de dono. **"Catálogo próprio" não é determinável por API de forma confirmada** → marcador manual (padrão seguro: terceiros).
- Sinais a validar numa leitura real: `tags` do item (`catalog_suggestion`, `catalog_suggestion_correction`), lista de sugestões do Brand Central, `official_store_id`, `GET /products/{id}/items` (vendedor único na página).

## C. Onde o sistema recomenda conteúdo (pontos de bloqueio)

`src/lib/plano-anuncios.js` (regras em `config/algoritmo.json`; o gerador `regras()` itera `diag.itens`, `:70`; ponto único de filtro em `montarAcoes`, `:412`):

| Regra | Linhas | Decisão para catálogo de terceiros |
|---|---|---|
| `conteudo_fotos` | 224-234 | bloquear (anexa `VIA_OFERTA` galeria, `:353`) |
| `duplicacao_estrategica` | 97-121, 46-54 | bloquear (a casa já proíbe duplicar catálogo: `config/prompt-estrategista.md:160`) |
| `ima_conversao` | 74-95 | filtrar o sinal CONTEÚDO (`:80`), a causa-padrão (`:83`) e os passos "abrir como comprador / listar dúvidas" (`:91`); manter PREÇO/OFERTA, ENTREGA, DISPONIBILIDADE; se não sobrar sinal editável, não emitir; não anexar `oferta_completa` (`:353`) |
| `ads_otimizar_antes` | 198-209 | filtrar o passo 2 (`:205`, "revisão de conteúdo, preço, frete, confiança") |
| `sazonal` | 297-313 | filtrar `como[0]` (`:308`, "Conteúdo e anúncio prontos até…"); manter estoque e campanha |
| `urgencia_oculta` | 315-325 | pode ficar (hipótese "novo kit"); hipóteses 2 e 3 (`diagnostico-conta.js:162-163`: duplicar com título novo, trocar capa) bloquear se forem usadas |
| `catalogo_buybox` | 123-137 | **manter** (preço e condição); corrigir `VIA_OFERTA.catalogo_buybox = {escopo:'ficha'}` (`:354`) que abre job de ficha em catálogo e `DEMANDA_ROTEIRO.catalogo_buybox = 'Anunciar no catálogo'` (`:345`, é o roteiro de entrar no catálogo, não de recuperar a caixa de compra) |
| `frete_gratis`, `ads_*`, `estoque_ruptura`, `full_envio`, `promocao_giro`, `preco_mudou_vendas_cairam` | — | manter |

- `construirAcao` monta `dados.item` em `:387`: pôr o flag de catálogo ali propaga para Notion, Plano por anúncio e PDF.
- **Ofertas** (`oferta_*`, `algoritmo.json:514-620`): `ofertas-diagnostico.js:50` leva `catalogo` no baseline e ninguém usa; a lente `qualidade` (`:94-107`) cobra fotos/título/atributos; `proporProposta` gera título (`:150`), descrição (`:158`), ficha (`:166`) e galeria (`:191`) sem olhar `catalogo`; `ofertas-fluxo.js:131 abrirJob` não tem guarda (o "Otimizar selecionados", `web/ofertas.js:221` → `rotas-ofertas.js:89-113`, abre job de título/ficha/galeria em catálogo); `ofertas-ml.js:266` só desliga `pode.imagens`; `validarProposta` só barra galeria (`:131-137`). Pontos únicos: `abrirJob` + `if (catalogo)` em `diagnosticar` e `proporProposta`.
- Telas/relatórios que re-expõem conteúdo: `render-plano-conta.js:107` ("PRECISA CONVERTER (conteúdo)", `fotos<5`), `:119` ("revisar imagem de capa e título", "completar fotos"); `render-diagnostico-comercial.js:58-62`; `gmv.js:149` (flag "só N foto(s)" nos Mais vendidos); `arvore-anuncio.js:41/52/64` (números digitados, não identifica o anúncio; baixo valor); textos de conta sem item (`config/retroalimentacao.json:69/83/311`, `playbook.json:90-106`) não dá para bloquear por item.
- Só projetam o plano (herdam o bloqueio): `distribuir-notion.js:90-139`, `diagnostico-comercial.js:13/35`, `relatorio-brief.js:337` (+ "Fotos atualizadas em N anúncios", `:38/353-354`, que vem do change-log, inclusive de catálogo onde a mudança é do ML), `estado-anuncio.js:139-143 leituraAnuncio`.

## D. Onde o anúncio aparece (selo)

Helper compartilhado: `imgAnuncio(t, alt, cls)` em `src/web/acomp.js:7` (só a `<img>`; `acomp.js` carrega antes de `cliente.js`).

| Tela | Onde | `catalogo` no payload |
|---|---|---|
| Mais vendidos | `cliente.js:617` | já tem (`gmv.js:153`) |
| Anúncios no período | `cliente.js:674-675` | falta (`anuncios.js:35`) |
| Folha, coluna Anúncio | `cliente.js:892` | falta (`folha-anuncio.js:187`; `BASE_KEYS` pinado em `teste-folha-anuncio.mjs:21/120`) |
| Cronologia de preços | `cliente.js:944` | falta (`rotas-planos.js:714-717`) |
| Cartões de tarefa / 80-20 | `acomp.js:39/63/152/215` | falta (`acompanhamento.js:457`) |
| Plano por anúncio | `cliente.js:1024-1031` | via `a.dados.item` (`rotas-planos.js:817`) |
| Ofertas (lista) | `ofertas.js:117` | `ofertas-fluxo.js:519-526/536-543` (`SELECT *`) |
| Promoções (vínculo de custo) | `promocoes.js:142` | `promo_anuncio.catalogo` existe |
| Cartão do Notion, PDF do plano por anúncio | `distribuir-notion.js:98-101`, `render-plano-conta.js:14/123-126` | via `dados.item` |

CSS: `.selo` (`ui.css:227`), tons em `:455-463`; um selo "Catálogo" cabe em `.selo.azul` (informativo) ou `.selo.neutro`; sem CSS novo.

## E. Testes que o bloqueio aditivo não pode quebrar

`teste-plano-anuncios.mjs` (itens sintéticos com `catalogo:false`; predicado trata ausente/falso como editável), `teste-ofertas-ml.mjs:84-102` (catálogo: `pode.imagens=false`, publicar galeria dá `pendente_dados` com `/CATÁLOGO/`), `teste-ofertas-diagnostico.mjs`, `teste-ofertas-fluxo.mjs:62` (DDL próprio de `meli_item`: o código não pode citar colunas novas por nome), `teste-folha-anuncio.mjs` (`BASE_KEYS`), `teste-filtros.mjs:126`, `teste-shell-ui.mjs`, `teste-ofertas-ui.mjs` (toda interpolação em `innerHTML` por `esc()`), `teste-diagnostico-comercial.mjs`, `teste-relatorio-brief.mjs`, `teste-retroalimentacao.mjs`.

## Desenho mínimo adotado

1. **Dados:** `meli_item.catalogo_produto_id` (coletar `catalog_product_id`); marcador manual **por cliente** (`perfil_cliente.catalogo_proprio`, NULL = terceiros) e **por anúncio** (tabela `catalogo_origem(cliente, item_id, origem, por, em)`); padrão seguro: catálogo sem marcação = **terceiros**.
2. **Predicado único** `src/lib/catalogo.js` (sem imports): `origemCatalogo(item, ctx)` → `nao | proprio | terceiros`; `editavelConteudo(item, ctx)`. Injetado em `carregarBase`, `itemDiag` e `linhasDoPeriodo`. `catalog_product_id` NÃO é a flag (item tradicional ligado a produto de catálogo é editável). Usuário de User Products tem título travado por outro motivo (`ofertas-ml.js:265`): fora deste predicado.
3. **Regras:** bloquear/filtrar como na tabela C; guarda em `abrirJob`/`diagnosticar`/`proporProposta`/`ofertas-ml.js`; registrar em `config/algoritmo.json` (nova chave `catalogo` e versão 1.3.0).
4. **Selo** "Catálogo" (terceiros) / "Catálogo próprio" (`.selo.azul`, tooltip) em todas as telas da tabela D; campo `catalogo_origem` (`nao|proprio|terceiros`) nos payloads.
5. **Texto no lugar da recomendação:** "Conteúdo controlado pelo catálogo: ajuste preço, estoque, frete e a caixa de compra." (próprio: "Conteúdo do catálogo: só por sugestão de correção, com revisão do Mercado Livre.").
6. **Cuidado:** ao regerar o plano, `salvarAcoesAnuncio` (`plano-anuncios.js:443-454`) marca como obsoletas também as ações aprovadas que sumirem (≈ 23 aqui); os 2 jobs `oferta_completa` em rascunho continuam vivos até cancelar.
