# Ofertas Estratégicas por cliente — o que foi implementado, o que depende de acesso, como testar

Módulo do Place Sprints que recebe produtos novos ou importa anúncios existentes de um cliente, diagnostica, propõe (texto, ficha factual, preço, briefing de galeria), registra aprovação versionada campo a campo e publica no canal **só o que foi aprovado**, com conferência por leitura e acompanhamento sem causalidade automática. Especificação: `docs/ofertas/ESPECIFICACAO-ofertas-estrategicas.md` (cópia da versão de 07/10/2026). Método original: `docs/ofertas/oferta-mkt-SKILL.md`.

Regra do projeto (`CLAUDE.md`): o módulo **não é um segundo motor de decisão**. Ele alimenta o diagnóstico com dados novos (ficha, custo, regra comercial, snapshot do anúncio) e registra cada mudança com antes/depois para o Merovíngio medir. A ligação "proposta → ação do plano (`acoes_plano`, regras `oferta_*`) → tarefa no Notion" **existe desde 07/10** (`src/lib/ofertas-algoritmo.js`, chamado por `ofertas-fluxo.abrirJob`/`prepararEstrategia`; seção "Ligação com o Algoritmo e o Merovíngio" abaixo).

## Arquivos

| Camada | Arquivo | Teste |
|---|---|---|
| DDL (12 tabelas `of_*`, isolamento por `cliente` em toda tabela) | `src/lib/ofertas-schema.js` (ligado em `src/lib/db.js` logo após `SCHEMA_FILTROS`) | `scripts/teste-ofertas-core.mjs` |
| Núcleo de dados: produto → variante (SKU único por cliente) → anúncio (chave externa), ficha com evidência, custo com vigência, regra comercial com fonte/validade, imagens, jobs (máquina de 20 estados), propostas versionadas, aprovação presa à versão, publicações idempotentes, auditoria | `src/lib/ofertas.js` | `teste-ofertas-core.mjs` (11 blocos) |
| Preço e viabilidade (centavos; nada presumido; desconto contado uma vez; simulação por faixa) | `src/lib/ofertas-preco.js` + `config/ofertas.json` | `teste-ofertas-preco.mjs` (14) |
| Diagnóstico em 5 lentes (descoberta · clique · conversão · viabilidade · qualidade) e proposta no escopo | `src/lib/ofertas-diagnostico.js` | `teste-ofertas-diagnostico.mjs` (21) |
| Adaptador Mercado Livre — única porta de escrita: capacidades, importar, categoria/atributos, tarifas, validar, payload por grupo, publicar (dry-run/live), conferir, criar | `src/lib/ofertas-ml.js` | `teste-ofertas-ml.mjs` (16) |
| Provedor de imagens (fal.run; sem `FAL_KEY` → `pendente`), verificação técnica, Drive (pendente) | `src/lib/ofertas-imagens.js` | `teste-ofertas-imagens.mjs` (5) |
| **Fluxo ponta a ponta**: importar → preparar → revisar/aprovar → publicar → conferir → monitorar; capacidades; lista da seção 3 | `src/lib/ofertas-fluxo.js` | `teste-ofertas-fluxo.mjs` (10) |
| **Rotas** `/api/ofertas/*` (montadas em `src/server.js`) | `src/rotas-ofertas.js` | `teste-ofertas-fluxo.mjs` (rotas em porta efêmera) |
| Filtro avançado: painel `ofertas` (cliente, canal, conta, consultor, analista, anúncio, SKU, categoria, estado do job, escopo, prioridade, vendas, faturamento, margem; datas: venda, criação, otimização, publicação) | `src/lib/filtros.js` | `teste-filtros.mjs` |

Rodar tudo (Node 22): `export PATH=$HOME/.local/node/bin:$PATH; for t in scripts/teste-ofertas-*.mjs scripts/teste-filtros.mjs scripts/teste-processos.mjs scripts/teste-ficha.mjs; do node $t || break; done`. Nenhum teste abre `data/db.sqlite` (banco em memória com o `SCHEMA_OFERTAS` exportado) nem a rede (fetch injetado); `PS_OFERTAS_MEMORIA=1` é setado pelos próprios scripts.

## Rotas (`src/rotas-ofertas.js`)

Toda rota exige `cliente` (query ou corpo) e um prospect `[Comercial] …` é recusado (400). Entidade de outro cliente responde 404 sem ecoar nada. Mutação exige `por`/`autor`/`solicitante` (vai para `of_evento`). Corpo sempre JSON (415 sem `Content-Type`).

| Rota | O que faz |
|---|---|
| `GET /api/ofertas/opcoes` | estados do job (rótulo, ação, responsável), escopos, objetivos, modos, canais, prioridades (opções dos filtros) |
| `GET /api/ofertas/capacidades?cliente=` | matriz honesta: ML (conectado, escopos, `pode.*`, dados coletados), SHO/AMZ/MAG/TTK `nao_implementado`, custos (variantes com/sem custo), regras comerciais (vigentes/expiradas), provedor de imagens, Drive, referências confirmadas |
| `GET /api/ofertas/anuncios?cliente=&f=` (ou `preset=&de=&ate=&data=`) | lista da seção 3: foto, canal, conta, produto, SKU/variação, id do anúncio, preço **atual**, margem estimada (só quando custo+regra; fonte declarada), estoque atual, vendas/faturamento **no período**, consultor, analista, estado do job, escopo, última sincronização; datas separadas (`criado_em`, `otimizado_em`, `publicado_em`); totais calculados sobre as linhas filtradas |
| `GET /api/ofertas/exportar.csv?cliente=&f=` | o mesmo conjunto filtrado (mesma função `listaAnuncios`), com linha de totais |
| `POST /api/ofertas/produtos` | `{ cliente, por, produto, variantes[] }` → produto + variantes (erro individual por variante) |
| `POST /api/ofertas/importar-planilha` | `{ cliente, por, linhas, anuncios?, aplicar }` — sem `aplicar: true` é prévia; erros por linha/campo; reimportar não duplica |
| `POST /api/ofertas/importar-anuncio` | `{ cliente, por, anuncio_id, variante_id? }` → snapshot, atributos da categoria com valor atual, variante por `variante_id`/SKU exato (senão cria; sem SELLER_SKU o SKU provisório é a chave externa, com pendência), baseline; sem credencial → 409 com estado nomeado |
| `POST /api/ofertas/variantes/:id/confirmar-referencia` | GATE 0: `{ cliente, por, origem_fotos:[{origem:'anuncio'\|'foto_dono'\|'drive', ref}] }`; `{ contestar: true, motivo }` revoga |
| `POST /api/ofertas/regras` · `POST /api/ofertas/custos` | regra comercial por canal/conta/modalidade (exige fonte, consultado_em, validade) · custo com vigência |
| `POST /api/ofertas/jobs` | abre jobs: `{ cliente, solicitante, escopo, objetivo, modo, itens:[{variante_id\|anuncio_id}] }` — lote com resultado individual |
| `GET /api/ofertas/jobs?cliente=&estado=` · `GET /api/ofertas/jobs/:id?cliente=` | lista · detalhe (versões, diff entre versões, antes/depois por campo, diagnóstico, baseline, pendências, aprovações, publicações, eventos, imagens) |
| `POST /api/ofertas/jobs/:id/preparar` | GATE 0 → diagnóstico → proposta v1 (preço só com custo+regra; senão `pendente_dados` com o motivo) |
| `POST /api/ofertas/jobs/:id/revisar` | `{ edicoes: { titulo?, descricao?, atributos?, preco?, galeria? } }` só no escopo → nova versão (aprovações anteriores invalidadas) |
| `POST /api/ofertas/jobs/:id/aprovar` | `{ versao, campos[], autor }` campo a campo; `{ decisao:'reprovar', motivo }` exige motivo curto. Tudo aprovado + modo `publicar_apos_aprovacao` → `na_fila` e **publica live em segundo plano** (sem segundo clique); `publicacao.tarefa` para acompanhar em `GET /api/ofertas/tarefas/:id?cliente=` |
| `POST /api/ofertas/jobs/:id/publicar` | dry-run por padrão (payload por grupo, diff, bloqueios, divergências, preço recalculado); `{ live:true, confirmar:true }` publica — só com job aprovado e aprovação válida da versão |
| `POST /api/ofertas/jobs/:id/conferir` | reconciliação por leitura do canal: `verificado` / `processando` / `divergente` por campo; conclusivo só após 30 min |
| `POST /api/ofertas/jobs/:id/monitorar` | antes × depois pela série já coletada; confusores (preço, estoque, campanha); sem causalidade |
| `POST /api/ofertas/jobs/:id/cancelar` | terminal, com motivo |
| `POST /api/ofertas/imagens/gerar` · `POST /api/ofertas/imagens/:id/decidir` | gera candidatas (sem `FAL_KEY` → `pendente`) · aprova/reprova (reprovar exige motivo) |

## Máquina de estados no fluxo

`rascunho → validando_entrada → (pendente_dados | referencia_confirmada) → estrategia_preparada → estrategia_aprovada → em_producao → em_revisao → aprovado_publicar → na_fila → publicando → em_conferencia → publicado_confirmado → monitorando`. Resultados do canal viram estados nomeados: `credencial_expirada | sem_permissao | validacao_rejeitada | transitorio → falha_recuperavel`; `limite_uso | processamento_pendente → aguardando_canal`; item mudou fora → `conflito_externo`; grupo rejeitado após outros aceitos → `falha_parcial` (retomada reenvia **só** os grupos em `retomar`). Preço é recalculado no momento da publicação live; mudança material (piso, bloqueio, simulação) cria nova versão e devolve o job a `em_revisao`.

## Matriz de capacidades por canal

| Canal | Estado | Verificado (teste/documentação) | Pendente / a confirmar |
|---|---|---|---|
| **Mercado Livre** | implementado ponta a ponta com stub; **nenhuma publicação real feita** | ler item/descrição/categoria/atributos; validar escopo e capacidades (título travado após venda, catálogo, User Products, variações); um PUT por grupo; diff e snapshot; conflito externo; idempotência por chave; classificação de erro por status; conferência por leitura com janela de 30 min e detecção de `pictures[0]` trocado; tarifas via `listing_prices` com fonte/data (falha = "a confirmar") | upload de imagem (`POST /pictures/items/upload`, doc oficial indisponível em 07/10); limite de 60 caracteres e trava de título por categoria; elegibilidade de User Products na criação; parâmetro `seller_sku` na busca de idempotência; **primeira publicação real no cliente-piloto** |
| Shopee | não implementado | — | adaptador próprio (não reutilizar payload do ML) |
| Amazon | não implementado | — | idem |
| Magalu | não implementado (só briefing de galeria em `config/ofertas.json`) | — | idem |
| TikTok Shop | não implementado | — | idem |

## O que depende de acesso ou configuração

- **Cliente-piloto e conta ML com escopo `write`**: toda a escrita foi testada só contra stub. A primeira publicação real deve ser `escopo: ficha` num anúncio de baixo risco, dry-run → live → conferir.
- **`FAL_KEY`** (opcional `FAL_MODELO`, `FAL_CUSTO_IMAGEM`) no `.env` para geração de imagens; sem ela `/imagens/gerar` devolve `pendente`. Custo por imagem só com `FAL_CUSTO_IMAGEM` (a doc do fal não devolve preço).
- **Drive**: credencial de conta de serviço (ou OAuth) + `OFERTAS_DRIVE_RAIZ`; hoje o contrato existe e devolve `pendente` com a lista do que falta. Fotos de referência entram por URL/`drive_file_id` informado na confirmação, e candidatas ficam em `data/ofertas/{cliente}/{variante}/{job}/`.
- **Regras comerciais e tributos por cliente**: nada é presumido. Sem `of_regra_canal` com fonte, validade e `tributos_pct`, o preço fica bloqueado (ficha, texto e imagem seguem).
- **Custos**: `of_custo` (vigência) ou o módulo de custos por SKU (Bling/Tiny/planilha). Sem custo, preço bloqueado.
- **`OFERTAS_HOSTS_IMAGEM`**: hosts autorizados para baixar bytes de candidatas por URL (vazio = só arquivo local em `data/ofertas`).

## Critérios de aceite (spec §13)

| # | Critério | Situação | Onde / motivo |
|---|---|---|---|
| 1 | SKUs iguais de clientes diferentes sem cruzar | **atendido** | core bloco 1 |
| 2 | Três cores → três variantes, original na variante certa | **atendido** | core bloco 2 |
| 3 | Reimportar sem duplicar; mudança por campo | **atendido** | core bloco 3; fluxo (reimportar anúncio) |
| 4 | Sem custo bloqueia preço, não imagem | **atendido** | core 4, preço, diagnóstico, fluxo (escopo preço → `pendente_dados` com motivo) |
| 5 | Foto errada bloqueia produção/publicação da variante | **atendido** | core 5 (GATE 0 em `transicionar`), fluxo (`prepararEstrategia`) |
| 6 | Gerar e abrir imagens reais; registrar falha e custo | **parcial** | provedor implementado e testado com arquivos sintéticos; sem `FAL_KEY` nunca gerou imagem real; custo só com `FAL_CUSTO_IMAGEM` |
| 7 | Otimizar só a ficha | **atendido** | ML (payload só `attributes`), diagnóstico (escopo), core (`CAMPOS_POR_ESCOPO`) |
| 8 | Reprovar MPN/fabricante promocional | **atendido** | core 8, diagnóstico, ML `validarProposta` |
| 9 | Aprovar v3, editar v4 → aprovação antiga inválida | **atendido** | core 9, fluxo (revisar → v2 invalida v1; aprovar v1 → 409) |
| 10 | Publicar automaticamente após aprovação; reconciliar por leitura | **atendido com stub** | fluxo (`aprovar` enfileira; rota dispara live em segundo plano; `conferir`); pendente a execução real no piloto |
| 11 | Timeout de criação sem anúncio duplicado | **atendido no adaptador** | ML (consulta por SKU antes de repetir); o fluxo ainda **não expõe criação de anúncio novo** (ver pendências) |
| 12 | Variação sem tocar irmãs; mudança externa detectada | **atendido** | ML (união de `pictures` + `variations` por id; `conflito_externo`) |
| 13 | Catálogo/não suportado = pendência, nunca sucesso | **atendido** | ML (`pendente_dados`), fluxo propaga. Desde 08/10/2026 (selo de catálogo, `config/algoritmo.json → catalogo`): anúncio de catálogo de **terceiros** não abre job de título/descrição/ficha/galeria/oferta completa (`abrirJob` 409 com "CATÁLOGO de terceiros"), o diagnóstico não cobra conteúdo e a proposta só traz preço; o **próprio** abre (a proposta é o texto da sugestão de correção) mas o adaptador nunca publica título, descrição, ficha nem galeria de catálogo (`pendente_dados`, pendência identificada). `catalogo_buybox` não abre mais job de ficha. Marcação "próprio" é manual (`src/lib/catalogo.js`, `docs/acompanhamento-e-retroalimentacao.md`) |
| 14 | Parcial, credencial expirada, limite → retomar do ponto | **atendido** | fluxo 14a/14b/14c |
| 15 | Preço, arredondamento, bases, desconto sem dupla contagem | **atendido** | preço (C=50, t=20%, m=20% → 83,33; margem recalculada 19,99%) |
| 16 | Filtros consistentes entre indicadores, tabela e CSV | **atendido** | fluxo (rotas: lista, totais e CSV da mesma função com o mesmo `?f=`) |
| 17 | Isolamento entre clientes no backend e nos arquivos | **atendido / parcial em arquivos** | core 17, fluxo (rotas 404 sem vazar); arquivos: candidatas em pasta por cliente e leitura só dentro de `data/ofertas` — Drive pendente |

## Pendências (ordem sugerida) — atualizado 07/10: itens 1 (ligação ao plano/Merovíngio) e 5 (tela) ENTREGUES; segue o resto

1. **Ligação com o Algoritmo/Merovíngio**: proposta aprovada → ação em `acoes_plano` (regras `oferta_*` em `config/algoritmo.json` com priors declarados) → card no Notion → vínculo com o anúncio → medição antes/depois pela `retroalimentacao.js`. Hoje `monitorar()` entrega antes/depois e confusores, mas não grava em `acoes_plano`.
2. **Criação de anúncio novo pelo fluxo** (`ml.criarAnuncio` está pronto e testado; falta `publicar()` para job sem anúncio: exige galeria aprovada com `picture_id`, categoria e dry-run).
3. **Piloto real no ML** (ficha primeiro), confirmando os itens "a confirmar" da matriz.
4. **Tela** (Cliente → aba Anúncios: Novo produto · Importar planilha · Importar anúncio · Otimizar selecionados · Fila de produção; abas do produto) — fora deste pacote (`src/web` intocado).
5. Upload de imagens para o ML e Drive (credenciais).
6. Modo 3 (automação recorrente por política) — não implementado; o modo é aceito no job mas não há agendador.
7. Adaptadores Shopee / Amazon / Magalu.

## Ligação com o Algoritmo e o Merovíngio (07/10/2026)

Regra do projeto (`CLAUDE.md`): o módulo **não tem motor de decisão próprio**.
- **Uma prioridade só.** Ao abrir ou preparar um job, `ofertas-fluxo.abrirJob`/`prepararEstrategia` chamam `ofertas-algoritmo.sincronizar`: o job **se liga** à ação do plano já existente para o mesmo anúncio e problema (ex.: `anuncio_catalogo_buybox`, `anuncio_ima_conversao`) ou **vira** uma ação nova com regra `oferta_*` (`config/algoritmo.json`: `oferta_galeria`, `oferta_titulo_descricao`, `oferta_completa`, `oferta_ficha`, `oferta_preco`, `oferta_cadastro`, com priors declarados como premissa e teto em `foco.max_por_regra`). `of_job.acao_id` guarda a ligação; o detalhe do job mostra a ação e **o número que prova** (métrica, janela, valor inicial).
- **Do plano para a oferta.** As ações executáveis pelo módulo trazem `dados.executar_via_oferta` (escopo/objetivo); `POST /api/ofertas/jobs` aceita `acao_id` e herda cliente, anúncio, escopo e objetivo. A Distribuição mostra o badge "via Ofertas".
- **Medição.** Publicações confirmadas entram em `impacto-tarefas.analisarCliente` como medidas (`fonte: 'ofertas'`, deduplicadas com o card do Notion da mesma ação) e passam por `medirEfeito` com controle, alimentando retroalimentação, `calibracao.priorEfetivo` e o ranking de profissionais.
- **Responsável.** `responsavelPadrao`: ficha do cliente (apoio para imagens, analista para o resto) → melhor desempenho medido com prova (`melhor-profissional.js`) → analista da conta. A origem fica em `dados.responsavel_origem`.
- **Estrutura estratégica.** GATE 0 bloqueia preparar/publicar sem referência confirmada (`referencia_nao_confirmada`); oferta completa segue galeria → título; duplicação exige briefing do consultor; cadastro antes de otimização do mesmo anúncio.
- Testes: `scripts/teste-ofertas-seguranca.mjs` (brechas corrigidas: anúncio de outro vendedor, GATE 0 na retomada, MPN promocional na criação) e `teste-ofertas-fluxo.mjs`.

## Tela (07/10/2026)

`src/web/ofertas.js` (window.PSOfertas) dentro de Cliente → Anúncios, acima de "Anúncios no período": capacidades honestas (ML, custos, regras, imagens, Drive — pendências visíveis), cinco ações (Novo produto, Importar planilha com prévia por linha, Importar anúncio existente, Otimizar selecionados em lote, Fila de produção), lista com filtros do painel `ofertas` e CSV com o mesmo filtro, fila por estado, detalhe em gaveta com oito abas (Visão geral, Dados e ficha, Custos e preços, Fotos e galeria, Estratégia, Aprovação campo a campo, Publicação dry-run → ao vivo com confirmação, Histórico e resultados). Teste estático: `scripts/teste-ofertas-ui.mjs`.

**Smoke real (07/10, União Dog, MLB4789167797):** importar → job de ficha ligado à ação `PS-fc46831483` (caixa de compra), responsável pela medição (analista da conta), pendência GATE 0 declarada → referência confirmada → estratégia v1 com as cinco lentes (anúncio de catálogo: ficha compartilhada, zero atributos propostos — honesto). Registros do smoke apagados em seguida.

## Preservação de atributos e limiares da própria conta (08/10/2026, motor de diagnóstico — frente G3)

- **Trocar/Preservar** (`docs/ofertas/oferta-mkt-SKILL.md`): `checarPreservacao(ficha, texto, { campos })` vive em `src/lib/ofertas-preservacao.js` (módulo PURO, reexportado por `ofertas.js` — que abre o banco no import e por isso não pode ser importado por `ofertas-diagnostico.js`/`relatorio-brief.js`), é pura e nunca inventa — só entra em `preservar` o que a ficha traz com fonte (atributo COLOR/SIZE/MATERIAL/BRAND/MODEL/PACKAGE_CONTENT/ACCESSORIES_INCLUDED com fonte, valor proposto só com evidência; senão cor/tamanho/material/kit da variante e marca/modelo do produto). Devolve `{ ok, faltantes: [{campo, valor}], preservar: [{campo, valor, fonte}] }`; comparação sem acento/caixa por palavra, plural óbvio e abreviação do kit ("3 un" ≈ "kit 3" ≈ "c/ 3 unidades") toleradas. `CAMPOS_PRESERVAR_TITULO` = cor/tamanho/kit (o que um título de 60 caracteres não pode perder); a descrição confere tudo.
- **Corte silencioso acabou**: `montarTituloDetalhado(ficha, { max })` devolve `{ titulo, cortados: [{campo, valor}] }` (`montarTitulo` continua devolvendo a string). `proporProposta` registra `cortados` na mudança do título e vira pendência da proposta ("título não coube em 60 caracteres: cor (Azul), kit (3) omitido(s) — revisar antes de publicar"); título e descrição propostos passam por `checarPreservacao` e os faltantes viram pendência. A descrição gerada ganhou a seção `VARIAÇÃO` (cor/tamanho/material/kit da variante). `revisar` confere o texto do operador: faltante → pendência na versão (`proposta.diagnostico.proposta_pendencias`, devolvida em `pendencias`), sem bloquear a edição (o projeto não tem gate de pendências na publicação; a pendência fica visível no detalhe do job). O prompt de imagem (`gerarImagens`) leva a lista PRESERVAR da ficha e "Proibido inventar", com briefing padrão ou do operador. Catálogo de terceiros continua sem conteúdo (nada a preservar).
- **Sem limiar universal**: `ctr_ads_baixo_pct` saiu de `config/ofertas.json`; a lente de clique compara o CTR Ads do anúncio com o CTR da **própria conta** × `algoritmo.limiares.ads_ctr_vs_conta_baixo` (`ctr_conta` no contexto de `diagnosticar`, injetado por `criarFluxo({ diagnosticoConta })` a partir de `diagnosticarConta().ads.ctr`); sem CTR da conta → `sem_dado`. No plano do cliente, `ml_conversao_baixa` compara com o benchmark A/B da própria conta (`ml.benchmark`, de `diagnosticarConta`) menos `playbook.limiares.ml.conversao_abaixo_benchmark_pct` (premissa, 25%) e `ml_queda_conversao` usa queda relativa ≥ `queda_conversao_rel_pct` (25%) contra o período anterior; sem benchmark a regra não dispara e vira pendência do plano. `conversao_minima_pct` e `queda_conversao_pontos` foram removidos.
- Testes: `teste-ofertas-core.mjs` (checarPreservacao), `teste-ofertas-diagnostico.mjs` (cortados, pendências, catálogo, lente de clique), `teste-ofertas-fluxo.mjs` (revisar, prompt de imagem), `teste-planos.mjs` (benchmark/pendência/queda relativa).

## Termo promocional numa fonte só e a regra do "top" (08/10/2026, revisão do motor)

- **Uma fonte**: `termosPromocionais`/`ehPromocional` (`ofertas-diagnostico.js`) decidem termo promocional/sazonal/promessa para título, descrição, lente de qualidade, identidade da ficha, prompts derivados (`TERMOS_PROIBIDOS_PROMPT`) **e** `validarFatual` (`ofertas.js`, que aceita `vestuario` para o mesmo contexto da ficha). `RX_PROMOCIONAL` ficou só com apelo de prazo/pagamento/garantia ("envio imediato", "12x sem juros", "original com garantia"). BRAND "Top Fitness" e MODEL "Top Nadador TF1" passam em todas; "Top Premium"/"Top 1" reprovam em todas.
- **"top" é peça de roupa só com contexto de vestuário**: peça vizinha (`PECA_TOP`: cropped, bojo, short, legging, nadador…, pulando e/com/quantidade), ficha de vestuário (`GARMENT_TYPE`, categoria de roupa/moda praia/fitness) ou, quando "Top" abre o texto, vocabulário de moda nas 3 palavras seguintes (`MODA_TOP`: feminino, esportivo, academia, canelado, alça, ombro, sem/com bojo, alto/médio impacto, triângulo, cortininha, dry fit, frente única, compressão, floral…; esse vocabulário também pode ficar entre o "top" e a peça seguinte: "Kit Top Feminino + Legging"). Fora disso ("Top Quality", "Top Laranja"/"Top Preto" sem ficha de moda — cor não é vocabulário de top, vem da ficha) é vetado. Elogio colado ao "top" é vetado em qualquer contexto, com qualquer preposição ("Top de/em/nas/das Vendas", "Top com/na/pela Qualidade", "Top nos Mais Vendidos"), e a lista cresceu: best seller, seller, quality, de primeira, sucesso, campeão, nr/nº/número + dígito, superior, absoluto, líder e **premium** (só depois do top: "Premium Top Com Bojo" é a peça premium).
- **Número antes do "top"**: quantidade com kit/conjunto/lote/pack/par/combo antes no texto ou logo depois de "+", ",", "e", "com" ("Kit Legging + 1 Top", "Lote 10 Top Fitness", "Legging, 1 Top" — e no fim do texto: "Kit 3 Top", "Par de Meias + 1 Top" são a peça contada); sem esse contexto é ranking ("10 Top Fitness"). Número depois continua: separado por vírgula/parêntese é quantidade, colado/espaço/hífen é ranking ("Top 1 em vendas").
- **Sobras ao retirar o termo da variante**: o lugar do termo fica marcado até a limpeza. Preposição colada ao buraco era do termo ("Azul de Presente de Rosa" → "Azul Rosa"); "e/ou/com" colado só fica ligando dois lados limpos ("Rosa Presente e Azul" → "Rosa e Azul", mas "Rosa, Presente e Azul" → "Rosa, Azul" e "e Presente e" → um "e"); separador colado cola no vizinho ("Rosa Presente/Azul" → "Rosa/Azul", "Rosa Presente: Azul" → "Rosa: Azul"); "%"/"°" depois de número ficam ("100 % Algodão"). Além das pontas, somem no meio a pontuação solta que não é separador ("Rosa Presente! Azul" → "Rosa Azul") e o conectivo dobrado — também dentro de parênteses/colchetes.
- Testes: `teste-ofertas-diagnostico.mjs` (blocos "motor-res A2/A3/A4" e "cético A2/A3/A4"), `teste-ofertas-seguranca.mjs` (A1), `teste-diagnostico-motor.mjs` (A5/A6 e "top premium" nos prompts).
