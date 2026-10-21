# Arquitetura dos 5 menus — Place Sprints (síntese final, 21/10/2026)

Documento final para o David (sem precisar ler código) e para quem for implementar (ids, rotas, arquivos e linhas conferidos em 21/10/2026). Base: a proposta «fluxo» (vencedora) + os enxertos das propostas «papeis» e «clareza» aprovados pelos três juízes + as correções das falhas que eles apontaram. Só leitura: nada foi alterado além deste arquivo.

## Resumo em 10 linhas

1. Cinco menus na linha 1 do topo: **Assessoria · Consultor · Execução · Empresa do cliente · Estrutura**. Cada menu é um pedaço da cadeia (cadastrar → conectar → coletar → planejar → aprovar → distribuir → executar → medir → comunicar); o quinto é a infraestrutura que faz a cadeia andar.
2. Nenhuma rota some, nenhum id some, nenhuma página é fundida: os submenus (linha 2) apontam para URLs que já existem, com `?aba=` e um parâmetro novo `?sec=` que rola até a seção. O primeiro passo visível é só o mapa `G` de `src/web/shell.js:4-11`.
3. **Hoje** é um botão único no topo (tela nova `/fila`): a fila do dia de quem está usando (Quem sou: dono, líder, consultor, analista, CS, técnico) — no máximo 5 blocos, só exceções, 1 botão por item, 4 números fixos em cima.
4. Toda estrutura que precisa de configuração ganha um ícone **(i)** ao lado do selo do sistema: estado agora (ligado/desligado · desde · por quem · camada), pré-requisitos com estado, passo a passo numerado, «concluído quando» e o documento. Texto em `config/ajuda.json`, estado real em `src/lib/estrutura-estado.js`.
5. «Estoque e DANFE» deixam de ser blocos avulsos: viram itens do menu **Empresa do cliente** (Produtos e estoque · Custos · Nota fiscal), cada um com (i) que diz «desligado · chave X · falta Y», e viram linhas da tela **Estrutura › Estruturas** (uma linha por estrutura, estado honesto, botão só onde o botão funciona de verdade).
6. O **progresso** é um stepper único de 10 etapas (Cadastrado → Comunicado), por cliente (cabeçalho do `/cliente`) e por carteira (`/`, `/fila`, `/estrutura`), calculado sobre números que já existem. `desligado` (chave fechada) é diferente de `atrasado` (gente).
7. Nomes por função: GMV → Faturamento, Integrações → Conexões, Processos → Como fazer, Executar → Execução no ML, Nota fiscal/Notas → «Nota fiscal: regras e certificado» / «Notas emitidas»…; o selo de sistema ganha o papel ao lado («Smith · financeiro») sem mexer no que os testes pinam.
8. O **androide** (1 especialista + sistema para 50 clientes) é uma mesa de exceções com teto de 10/semana/família ≈ 3 h/dia — válido só com M3 (Chaveiro escrevendo no ML) e Shopee em card. A fila mede isso todo dia: autonomia %, cobertura %, exceções ÷ teto, contas por pessoa.
9. Oito fases pequenas, cada uma publicável com `node scripts/teste-*.mjs` verde: F0 nomes (1 dia) → F1 shell com 5 menus (2 dias) → F2 Quem sou + (i) → F3 `/estrutura` → F4 stepper → F5 `/fila` → F6 reagrupar o `/cliente` (a fase cara) → F7 mudanças opcionais.
10. No fim: as **decisões que só o David toma** (7 itens) e a **Fase 0 recomendada** — um dia de trabalho, zero teste quebrado, que já muda a sensação de bagunça.

---

## Como ler

- **Menu** = linha 1 do topo (`nav.ps-grupos`). **Submenu** = linha 2 (`nav.ps-abas`), ≤ 8 itens, rola na horizontal se precisar (`ui.css:108` já tem `overflow-x:auto`). **Seção** = bloco com `id="sec…"` dentro de uma tela.
- **Destino** = URL que já existe hoje. `?aba=` já é lido pelo `/cliente` (`cliente.js:206-215`); `?sec=<id>` é novo (F1) e rola até a seção, abrindo o `<details>` se for um. Nunca `#hash` no `/cliente`: o `popstate` reabre o cliente (`cliente.js:86,104`).
- **NOVO** = ainda não existe. Página nova só entra no menu na fase em que nasce (nunca link para 404).
- **Fase** = em que fase do plano (seção G) a coisa passa a existir ou muda de lugar.
- **Pinado** = algum `scripts/teste-*.mjs` exige o literal/ordem; mudar = reescrever o assert e registrar a decisão em `docs/ux/sistema-de-design.md` § 8.7 no mesmo commit.

## O que foi conferido no código (21/10/2026)

- `src/web/shell.js` inteiro: `G` (`:4-10`), `INT` (`:11`), `CLI` (`:12`), `grupo = G.find(...)` (`:14`), `link()` marca `aria-current` só por `id === pag` (`:17`), `ctx` depende do literal `'Clientes'` (`:47`), `sync()` reescreve o `href` como `base + '?cliente='` e **perde `&aba=`** (`:52-56`), `window.PS = {` (`:80`). Cabeçalho do arquivo e spec § 4.1 (`docs/ux/sistema-de-design.md:330`): **sem `innerHTML`, sem chamar API** — por isso o (i) vai num arquivo próprio, não no shell.
- `src/web/cliente.js`: `ABAS` (`:68`), `VIVOS` (`:69`), `abrirCliente` faz `pushState('/cliente?cliente=')` e **perde a aba** (`:86`), `mostrarAba` só esconde painéis e já preserva os outros parâmetros no `replaceState` (`:206-215`), template dos painéis (`:388-485`), `desenhar()` chama `mostrarAba` (`:558`), `#formCustos` dentro de `<details>` em Plano › Por anúncio (`:1081`), chave «Coletar promoções» dentro de `desenharPerfil` (`:1368-1392`).
- `scripts/teste-shell-ui.mjs`: `PAGINAS` (`:21-26`), `COMPARTILHADOS` (`:27`), hooks (`:47-59`), literal `['execucao', 'Painel executivo', '/']` (`:108`), ordem do Resumo (`:149,165,217-219,272,308,332,354,383`), Configurar fatiado a partir de `data-painel="configurar"` (`:432,449` — **`:449` exige `indexOf > 0` dentro da fatia: tirar Dossiê/Risco/Contrato de Configurar quebra**), `:485/:525` literais das abas, `:487/:509/:527` painel → 1ª seção, `:541` ordem Contrato < Custos < Nota fiscal, `:553` `<h2>…</h2><span class="sis"` colados, `:286` ordem de `/integracoes`, `:299` `/sprint ?90|s90/i` sobre o shell inteiro, `:193,267,358,408,425,452` ordem de `/planos`. **`:218` fatia o arquivo até a string literal `'Motor de decisão'`**.
- `scripts/teste-sistemas.mjs:88-91`: texto **e** `title` do selo `.sis` têm de ser iguais a `sistema(id).nome`; `:94` ordem dos selos = `selos_sistema.secoes` do inventário. `config/sistemas.json` já tem o campo `papel`.
- `scripts/teste-semanal-rotas.mjs:255-257`: lê `cliente.js` de `function desenharPerfil` até o fim e exige a chamada `api('/api/cliente/perfil', {… coleta_promocoes …})` dentro dessa fatia.
- `scripts/teste-ofertas-ui.mjs:13`: `data-painel="anuncios" < secOfertas < secAnuncios`. `scripts/teste-custos-ui.mjs:45` exige `app.get('/integracoes'`; `:63-64` thead de 6 `<th>`.
- `src/server.js:357-370`: `app.get` de `/planos /cliente /analistas /comercial /integracoes /metodologia /gmv /processos /promocoes /resultados`; `/` sai do `express.static`. Rota nova = `app.get` novo.
- `src/web/ui.css`: tokens no 1º `:root` (`--verm`, `--cinza-claro`, `--verde` existem), `--shell-h:56px` (`:53`), `.btn-icone` 36×36 (`:221`), `details.recolhido` + chevron por máscara SVG (`:387-396`), `ol.passos` com `.feito/.atual` e **sticky a partir de 900 px** (`:417-424`). `src/web/tela-cliente.css:7`: `scroll-margin-top` assume uma barra de abas sticky de 41 px.
- `src/web/relatorios-ciclo.js` e `src/web/produtos.js` **não** leem parâmetro de URL (nenhum `URLSearchParams`): Compras e DRE não têm entrada direta hoje. `src/web/executar.js:174`: `#exParar` (freio global) + texto «Estoque segue o sincronismo próprio na aba Produtos (F6)».
- `grep -rn "aba=" src/web src/lib src/*.js | grep -v cliente.js` = **27 links** que precisam ser conferidos quando blocos mudarem de aba (F6).
- `grep -ln "Seu nome" src/web/*.js` = `acomp.js cliente.js ficha.js comercial.js filtros.js integracoes.js gatilhos.js planos.js ofertas.js perfil-informacao.js relatorio.js promocoes.js` (12 arquivos; a lista da proposta original estava errada).
- Rotas de escrita que já existem e que a tela de Estruturas e a fila reusam: `POST /api/gatilhos/chave`, `/api/consultor-discord/chave`, `/api/relatorio/agendador`, `/api/alertas/agendador`, `/api/dossie/mensal`, `/api/chaveiro/exec/parar|retomar|aprovar|liberar|vetar`, `/api/chaveiro/estoque/parar|retomar|liberar`, `/api/planos/acoes/status`, `/api/planos/distribuir`, `/api/cliente/preco/decisao`, `/api/cliente/do-cliente/lembrete`, `/api/gatilhos/preparar-lote`.
- Chaves de arquivo: `config/chaveiro.json` `execucao_ligada:false` (`:4`), `adaptadores_live.*` (`:5`), `sync_estoque_ligado:false` (`:26`), `ordens_para_ampliar:10`, `veto_horas:48`; `config/algoritmo.json` `produto.diagnostico_ligado:false` (`:135`), `financeiro.margem_medida_nas_regras:false` (`:154`), `relatorios_ciclo.blocos_terca_ligado:false` (`:4`); `config/nota-fiscal.json` `nf.ligado/envio_ml_ligado/producao_ligada:false` (`:4-6`), `automatica_apos_notas_sem_correcao:20`; **`config/gatilhos.json:40 urgente.na_hora_ligado: true`** enquanto o `$comentario` da linha 39, `src/web/gatilhos.js:3` e `CLAUDE.md:38` dizem «nasce desligada».
- Documentos citados nos (i) existem em `docs/`: `desenho-v3-erp.md`, `manual-integracao-ml.md`, `desenho-gatilhos-n8n.md`, `plano-autonomia-total.md`, `plano-autogestao.md`, `autogestao-instalar.md`, `integracao-custos-erp.md`, `sprint90.md`, `metodologia-algoritmo.md`, `sistemas.md`, `desenho-relatorio-notion.md`, `alerta-cliente.md`, `dossie-prestacao-contas.md`, `notion-cliente.md`, `cadastro-clientes.md`, `alinhamentos.md`.

---

## A) Os 5 menus → submenus → seções

### A.0 Regras do shell (o que muda em `src/web/shell.js`, F1)

1. `G` passa a ter os 5 menus; cada item é `[id, rótulo, href]` com `id = pagina` ou `pagina:aba` (`'cliente:produtos'`) e o `href` pode carregar `?aba=`, `?sec=`, `?rc=`, `?visao=`.
2. **Item ativo** = o item cujo `data-pagina` bate **e** cujos parâmetros do `href` (menos `cliente`) estão todos na URL atual; empate → o item com **mais parâmetros casados**; empate de novo → o primeiro na ordem de `G`. Assim `/planos` acende Execução › Distribuir, `/planos?sec=secRisco` acende Assessoria › Carteira em risco e `/planos?sec=secAvisosAuto` acende Estrutura › Comunicação, **sem parâmetro `?m=`** (correção da falha apontada na proposta original). Recalculado em `sync()`, que já roda em todo `pushState/replaceState/popstate`.
3. `sync()` monta o link com `new URL(a.dataset.base, location.origin)` + `searchParams.set('cliente', c)` em vez de concatenar — preserva `&aba=&sec=`.
4. `.ps-ctx` («Cliente: Nome») aparece quando o item ativo está em `CLI` (hrefs que carregam `?cliente=`), não pelo literal `'Clientes'`.
5. A linha 2 é reconstruída quando o item ativo muda de menu (ex.: o consultor abre `?aba=produtos` dentro do cliente e passa para «Empresa do cliente»).
6. `INT` («Integrações» como utilitário) e a entrada «Configuração» do menu hambúrguer (`:11, :38, :42`) saem: Conexões vira submenu de Estrutura. O lugar do `.ps-int` recebe **Hoje** na F5 (`/fila`) e **Quem sou** na F2.
7. No `DOMContentLoaded`, se a URL tem `?sec=<id>` e a página é estática (não `/cliente`), o shell abre o `details` mais próximo e faz `scrollIntoView({ block: 'start' })`. DOM puro, sem API. No `/cliente` quem faz isso é `desenhar()` depois de `mostrarAba` (render assíncrono).
8. Literal `['execucao', 'Painel executivo', '/']` **mantido** (`teste-shell-ui.mjs:108`). Nenhum `href` ou rótulo do shell contém `s90`/`Sprint 90` (`:299`): Assinantes Sprint 90 continua acessível por `/integracoes` (atalho dentro de `/comercial`) e, na F7b, dentro de `/comercial`.
9. Teste novo (F1): «todo `href` de `G` é `/` ou casa um `app.get('<rota>'` em `src/server.js`» — impede link para 404 enquanto `/estrutura` e `/fila` não existem.

### A.1 Visão geral

| # | Menu | Pergunta que responde | Submenus (linha 2) |
|---|---|---|---|
| — | **Hoje** (botão no topo, F5) | O que eu faço agora? | `/fila?por=<papel>` — papel vem de «Quem sou» |
| 1 | **Assessoria** | Como vai a assessoria inteira? | Painel executivo · Faturamento · O que funciona · Acerto do algoritmo · Carteira em risco · Comercial |
| 2 | **Consultor** | Neste cliente: o quê, por quê, como? | Resumo · Plano · Anúncios · Estratégia · Promoções · Como fazer |
| 3 | **Execução** | Quem faz, e o sistema fez? | Distribuir · Execução no ML · Pelo cliente · Ofertas · Analistas |
| 4 | **Empresa do cliente** | O negócio por trás da conta | Produtos e estoque · Lucro do mês · Compras · Preços · Raio-X e contrato · Custos · Nota fiscal · Ciclos do negócio |
| 5 | **Estrutura** | Está ligado, configurado, funcionando? | Estruturas · Conexões · Comunicação · Configurar cliente · Equipe · Regras do método |

### A.2 Menu 1 · Assessoria (dono e liderança)

| Submenu | Destino | Seções existentes que moram aqui | NOVO / fase |
|---|---|---|---|
| Painel executivo | `/` (literal pinado, `:108`) | tudo de `index.html`: `#estadoSprint #estadoSync #estadoMeli`, menu Relatórios `#lnkRelatorio #lnkPdf #lnkSemanal #lnkMatriz`, `#btnSync`, `#filtros #filtrosAvancados`, `#veredito #regua #kpis #kpisSec`, `#proxima`, `#cartaoRiscos #riscos`, `#secRitmo #gBurnup`, `#secGraficos`, `#secTarefas #tabelaTarefas #btnDependencia`, `#qualidade`, `#distribuicao`; documentos `/relatorio(.pdf)`, `/matriz(.pdf)` | `#secProgresso` (stepper da carteira, F4); `#proxima` passa a apontar para `/fila` (F5) |
| Faturamento | `/gmv` | tudo de `gmv.html`: `#periodo #filtros`, `#veredito #regua #kpis`, `#proxima`, `#secPonte #ponte`, `#secQuem #abas #tabela`, «Como ler» | — |
| O que funciona | `/resultados` | tudo de `resultados.html`: `#vereditoFrase #regua #veredito #mensura`, `#proxima`, `#filtros #tipos`, `#nichos #regioes #lanc`, `#secNichoTipo #analistas #secPalavras`, «Como medimos» | — |
| Acerto do algoritmo | `/metodologia` | `#versao #metaRegras #veredito`, próxima ação, `#secCalib #calib`, `#secRegras #regras` (os blocos `#secComo #secSistemas #secParam` ficam na mesma página; a casa deles no menu é Estrutura › Regras do método, via `?sec=secParam`) | — |
| Carteira em risco | `/planos?sec=secRisco` | `#secRisco #riscoPlanos #btnRkMensal #rkAbertos #rkSugestoes`, `#secFeedback #fbTemas #fbStatus #btnFbColetar #tbFeedback`, `#secPerfilInfo #perfilInfoPlanos` (ficam fisicamente em `/planos`; o `?sec=` abre o `details`) | F7 (opcional) move para `/fila?por=dono` |
| Comercial | `/comercial` | tudo de `comercial.html`: `#btLinkPublico #btApagarTestes #fNovo`, `#veredito #kpis`, `#infra`, `#secLista #filtros #lista #dx-<id>`; documento `/comercial/diagnostico(.pdf)`; **atalho na página** «Assinantes Sprint 90» → `/integracoes?sec=secS90` (nunca no shell) | F7b move `#secS90 #s90Corpo #s90Nova` para cá |

### A.3 Menu 2 · Consultor (o quê · por quê · como)

| Submenu | Destino | Seções existentes | NOVO / fase |
|---|---|---|---|
| Resumo | `/cliente?aba=resumo` | busca `#telaBusca #q #resultados`; cabeçalho `#btnPlacePlan #btnRelatorioAgora`, menu Documentos (`/plano`, `/plano.pdf`, `/plano-conta(.pdf,.csv)`, `/semanal`, `/semanal?interno=1`, `/diagnostico-motor`), `#btnRevisar` (único primário), `#veredito #regua #kpis`; `#faixaPendencias`, `#secProximas #proximasAcoes`, `#secChaveiro #chaveiro`, `#secSaude #saude #btnSaudeAtualizar`, `#secAcomp #acomp`, `#secDependeCliente` (`#pendencias #alertasCliente #dependencias`), `#secAlinhamentos #alinhamentos`; **até a F6 também**: `#secFolha`, `#secFinanceiro`, Motor de decisão (`motorHtml` + `#formMetas`), `#secGatilhos`, `#secNotion` | `#progresso` (stepper do cliente no cabeçalho, F4); `#btnRevisar` vira o botão da 1ª etapa atrasada (F4). F6 tira 5 blocos: `#secFolha` → Anúncios, `#secFinanceiro` → Empresa, Motor → Estratégia, `#secGatilhos` → Pelo cliente, `#secNotion` → Configurar cliente. Resumo fica com 6 blocos + faixa |
| Plano | `/cliente?aba=plano` | `#segQuem #movidosEquipe #filtros #nAcoes #listaAcoes`; `#secPlanoConta #planoConta #btnGerarPlano #btnDistrib #btnConfirmaDistrib` | `#formCustos` (`cliente.js:1081`) sai para Empresa do cliente › Custos (F6); no lugar fica a frase «custo informado: sim/não — Custos» |
| Anúncios | `/cliente?aba=anuncios` | `#secOfertas` (1º bloco; casa no menu = Execução › Ofertas), `#secAnuncios #fltAnuncios #anuncios` (+ `PSHistorico` «Como era», galeria), `#secPrecos #precos`, `#secVendas #vendas #btnColeta`, `#secImpacto #impacto` | F6: entram `#secFolha` (depois de `#secVendas`, antes de `#secImpacto`) e a Ferramenta `#fAnuncio #resAnuncio` (fim, recolhida) |
| Estratégia | `/cliente?aba=estrategia` | Leitura estratégica (`cartaoMerovingio`), `#secRetro #retro` | F6: entra o Motor de decisão, renomeado «Previsão do mês» |
| Promoções | `/promocoes?cliente=` | `#telaEscolha #chipsClientes`, `#titulo #chips #status #q #quem`, `#faixaColeta`, `#veredito #kpis`, `#proximo #btnColetar #chkVendas`, abas Elegíveis (`#fQ… #elCorpo #btnAprovarTodas #elCsv`), Participando e cobertura (`#selDias`), Relâmpago, Plano (`#selPlano`), Interrogatório, Auditoria, `#detRodada #invariante #pendencias` (as abas Custos e Regras por SKU têm casa em Empresa do cliente › Custos) | `#quem` preenchido por «Quem sou» (F2) |
| Como fazer | `/processos` | tudo de `processos.html`: `#abas #campoBusca #busca`, `#conteudo` (MAPA por canal, `details.cart`, `#secExtras`, Duplicação estratégica), `#secRegras #regras`. É a fonte do (i) de toda tarefa (`GET /api/processos/:id?canal=`) e o link «Processo completo» de cada card da fila do analista | — |

### A.4 Menu 3 · Execução (distribuição, analista, Chaveiro, cliente)

| Submenu | Destino | Seções existentes | NOVO / fase |
|---|---|---|---|
| Distribuir | `/planos` | menu ⋯ `#btnNotionTodos` (atalho; casa = Estrutura › Conexões), `#veredito #regua #kpis`, `#passos #btnGerar #btnPrevia #btnDistribuir #job #resultado`, `#secEscopo #tipos #selSquad #selConsultor #boxSelecao #scoreMin`, `#secRevisar #fHor #fSt #fTxt #fltAvancado #tbAcoes #selDelegar #btnDelegar #btnDesfazer`, `#secClientes #tbClientes`, `#secGargalos #gargalos` | 3 KPIs no veredito (F4): propostas P0/P1 sem decisão > 2 dias úteis · aprovadas não distribuídas · cobertura `PS-` ÷ tarefas |
| Execução no ML | `/cliente?aba=executar` (rótulo da aba na página continua «Executar» até a F6, `:525`) | `#secExecutar #executar`: `#exVeredito #exKpis`, `#exBusca #exAnuncios #exNSel`, `#exOque #exParams #exPrevia #exPreparar #exNova`, `#exOrdensBox #exConferir`, `#exLiberacoes #exLibBox`, `#exParar` | `#exParar` é **global**: ganha linha «Freio geral do executor» em `/estrutura` (F3); F7d deixa aqui só estado + link |
| Pelo cliente | `/cliente?aba=do-cliente` | `#secDoCliente #doCliente` (Registrar resposta · Marcar resolvido · Mover para o consultor · Preparar lembrete) | F6: entra `#secGatilhos` (fila e recibos dos avisos deste cliente) |
| Ofertas | `/cliente?aba=anuncios&sec=secOfertas` | `#secOfertas #ofertas` (Visão Anúncios / Fila de produção, gaveta do job com 8 abas, `ofertas.js:241`). Fica fisicamente no topo de Anúncios: mover quebraria `teste-ofertas-ui.mjs:13` por uma aba a mais — não vale o custo | — |
| Analistas | `/analistas` | tudo de `analistas.html`: `#btnSync`, `#veredito #regua #kpis #kpisSec`, `#proxima #proximaBtn`, `#filtros`, `#blocoRanking #ranking`, `#blocoClientes #clientes`, `#secEntrega`, `#secQualidade` | coluna «cards `PS-` parados > 7 d» em `#blocoClientes` (F4) |

### A.5 Menu 4 · Empresa do cliente (produto, estoque, compras, lucro, nota fiscal, contrato)

| Submenu | Destino | Seções existentes | NOVO / fase |
|---|---|---|---|
| Produtos e estoque | `/cliente?aba=produtos` (aba continua «Produtos» até a F6, `:485`) | `#secProdutos #produtos #prVisao #prSombra #prSeloF3`, `#btnMapeamento #gavMapeamento`, `#btnAtualizarEstoque`, `#tabProdutos #prMais`, Premissas, `#secSyncEstoque #syncCorpo` | (i) em `#secProdutos` («Diagnóstico por produto») e em `#secSyncEstoque` («Ajuste automático de estoque») com o estado das chaves `produto.diagnostico_ligado` / `sync_estoque_ligado` (F2–F3). Sub-texto sem «sombra/F2/F3» já na F0 |
| Lucro do mês | `/cliente?aba=produtos&visao=lucro` | `#secDre #dreMes #dreCorpo` (só aparece na visão Lucro) | `produtos.js` lê `?visao=` e abre no chip Lucro (3 linhas, F1) |
| Compras | `/cliente?aba=relatorios&rc=compras` | relatório `compras` de `#rcSeletor` (`preverCompras`, razão `compra_fornecedor` com prévia/confirmar) | `relatorios-ciclo.js` lê `?rc=` e pré-seleciona (3 linhas, F1) |
| Preços | `/cliente?aba=anuncios&sec=secPrecos` | `#secPrecos #precos` (cronologia 90 d, tarefa coincidente, vendas/dia antes → depois) | — |
| Raio-X e contrato | F1–F5: `/cliente?aba=resumo&sec=secFinanceiro` · F6: `/cliente?aba=empresa` | `#secFinanceiro #guardiao` (raio-X Smith, «Decisão do cliente», «Gerar pauta da reunião»), `#secContrato #contrato`, `#secRisco #risco`, `#secDossie #dossie` | aba `empresa` (F6); **até lá** Contrato/Risco/Dossiê ficam em Configurar, alcançados por `?sec=` (`:449` fatia a partir de `data-painel="configurar"`) |
| Custos | F1–F5: `/cliente?aba=configurar&sec=secCustosUpload` · F6: `?aba=empresa&sec=secCustosUpload` | `#secCustosUpload #custosUpload` (planilha na tela); `#formCustos` (% CMV/imposto/comissão, hoje em Plano › Por anúncio); `/promocoes?cliente=&aba=custos` (custo ↔ anúncio, `#formCustos` de SKU, `#formConfig` piso/imposto) e `?aba=regras` (`#formRegra`); `/integracoes?custos=<cliente>` gaveta `#custosPainel` (`#custosQuem`, Planilha/Bling/Tiny, `#cuQuar`, `#cuRec`, App Bling) + `#dlgSegredo` | bloco «Custos do cliente» com **3 linhas de estado** (planilha subida · fonte automática ERP/planilha · vínculo custo ↔ anúncio), cada uma com o número («custo informado para X % da receita de 28 d») e o link para a porta (F6); (i) «Custos do cliente» (F2) |
| Nota fiscal | F1–F5: `/cliente?aba=configurar&sec=secNotaFiscal` · F6: `?aba=empresa&sec=secNotaFiscal` | `#secNotaFiscal #notaFiscal` (config, Smith) + `#secNotas #notas` (emissão, Chaveiro) **lado a lado, sob um título só** | (i) «Emissão de nota fiscal» com estado DESLIGADA e o que falta (F2–F3); os 9 `prompt()` (`nota-fiscal.js:57-61`) viram formulário no `dialog.dlg` (F6) |
| Ciclos do negócio | `/cliente?aba=relatorios` (aba continua «Relatórios» até a F6) | `#secRelatoriosCiclo #relatoriosCiclo #rcSeletor #rcExportar #rcCorpo #rcFaltando` | — |

### A.6 Menu 5 · Estrutura (configuração e efetividade)

| Submenu | Destino | Seções existentes | NOVO / fase |
|---|---|---|---|
| Estruturas | `/estrutura` (NOVO, F3) | Atalhos até a F7: `/integracoes#secSaudeSistema`, `#secConfig`; `/cliente › Executar #exParar`; `/planos ⋯ #btnEquipe #btnSyncPrest` | Tabela **uma linha por estrutura** (≤ 6 colunas: Estrutura · Sistema · Estado · Desde / por · Falta · (i)/ação) para as ~24 estruturas do inventário de configuração (seção C); topo = stepper global «Conectar: 47 de 173…» (F4); «Pronto para operar: N de 8» por cliente; linhas «Endereços públicos» (`/diagnostico`, `/d/:token`, `/c/*`, callbacks: host configurado? túnel no ar?) e «Relógio do sistema» (horários dos ticks de `config/autogestao.json → ticks`). **Botão Ligar/Desligar só para chave da camada banco** (reusa `POST /api/gatilhos/chave`, `/api/consultor-discord/chave`, `/api/relatorio/agendador`, `/api/alertas/agendador`, `/api/dossie/mensal`, `/api/chaveiro/exec/parar\|retomar`, `/api/chaveiro/estoque/parar\|retomar`); chave de arquivo/.env é **só leitura** com «mude em `config/x.json` e reinicie na janela combinada» e o id técnico em `<small>`. Nunca botão que finge |
| Conexões | `/integracoes` | `#btnLinksCsv`, `#veredito #regua #cards`, `#proxima #proximaBtn`, `#secLista #fq #fplano #fdesl #tb` (Copiar link / Novo link / Restaurar / Custos), `#secConfig` renomeado «App do Mercado Livre», `#secSaudeSistema`, `#secS90` (até a F7) | bloco «Notion» (token, último sync, `#btnNotionTodos` migrado na F7) |
| Comunicação | F1–F6: `/planos?sec=secAvisosAuto` · F7c: `/estrutura?sec=secComunicacao` | `#secRelatorios` (`#relAgendadorEstado #btnVerificarBases #btnLiberarProntos #btnAgendador #lnkRelatorioCsv #btnRelAnexar #tbRelatorios`), `#secAlertas` (`#btnAlertaAuto #tbAlertas`), `#secAvisosAuto` (`#btnGatilhosAuto #avLiberados #btnConsultorDiscord #tbAvisosFalhas`), menu ⋯ `#btnRelFrequencia`, `#btnRelAntecipar #lnkCsv` | cada um dos 3 `details` com (i) e estado; linha «Entregador n8n» (`n8n.configurado`) |
| Configurar cliente | `/cliente?aba=configurar` (aba continua «Configurar» até a F6) | `#secFicha #ficha`, `#cad-sec #cad-corpo`, `#secCatalogo #catalogo`, `#secRelatorio #relatorio`, `#secPerfil #perfil` (a chave «Coletar promoções do ML» continua aqui, com sub-rótulo «Coleta · Trinity» — `teste-semanal-rotas.mjs:255`), `#secPerfilCliente #perfilInfo`, `#secAvisos #avisos`; **até a F6**: `#secDossie #secRisco #secContrato #secCustosUpload #secNotaFiscal #secNotas`, Ferramenta | F1: 5 cabeçalhos `<h3>` de grupo **sem reordenar** as seções (Quem é e quem atende · Conta no Mercado Livre · O que o cliente recebe · Contrato, risco e defesa · Fiscal) — `:249/:432/:449` continuam verdes. F4: «Pronto para operar: N de 8» no topo (= etapas 1–4 do stepper). F6: entram `#secNotion` e `#secMetas` (o `#formMetas` sai do Motor) |
| Equipe | `/estrutura?sec=secEquipe` (F3) | `/planos ⋯ #btnEquipe #btnSyncPrest` (atalho até a F7e) | lista só-leitura de `config/equipe.json` (aliases, squads, donos, `analistas_oficiais`) e de `config/discord-time.json` (cargos); (i) «Quem pode aprovar o quê» (`lideresEConsultores`, `equipe.js:131-141`) |
| Regras do método | `/metodologia?sec=secParam` | `#secParam #limiares`, `#secComo #ritual`, `#secSistemas #listaSistemas`; `config/algoritmo.json`, `atribuicao.json`, `retroalimentacao.json`, `playbook.json` (só leitura, como hoje) | (i) «Regras e limiares do plano» (`docs/metodologia-algoritmo.md § 7`) |

Páginas públicas (`/diagnostico`, `/d/:token`, `/c/*`, `/meli/callback`, `/erp/callback`) e documentos (`/relatorio`, `/semanal`, `/plano`, `/plano-conta`, `/matriz`, `/diagnostico-motor`, `/comercial/diagnostico`) continuam sem shell (`teste-sprint90-texto.mjs:88`).

### A.7 Tabela «de → para» (toda seção aparece uma vez como casa; «atalho» não conta)

| Hoje (rota · aba · seção) | Amanhã (menu › submenu) | Como chega |
|---|---|---|
| `/` inteiro + `/relatorio`, `/matriz` | 1 › Painel executivo | F1 |
| `/gmv` inteiro | 1 › Faturamento | F1 |
| `/resultados` inteiro | 1 › O que funciona | F1 |
| `/metodologia` `#secCalib #secRegras` + cabeçalho + próxima | 1 › Acerto do algoritmo | F1 |
| `/metodologia` `#secComo #secSistemas #secParam` | 5 › Regras do método | F1 (`?sec=secParam`) |
| `/comercial` inteiro + `/comercial/diagnostico` | 1 › Comercial | F1 |
| `/integracoes` `#secS90 #s90Corpo #s90Nova` | 1 › Comercial | F1 atalho na página; F7b move |
| `/planos` `#secRisco #secFeedback #secPerfilInfo` | 1 › Carteira em risco | F1 (`?sec=secRisco`) |
| `/cliente` busca, cabeçalho (⋯, Documentos, `#btnRevisar`, veredito), Resumo `#faixaPendencias #secProximas #secChaveiro #secSaude #secAcomp #secDependeCliente #secAlinhamentos` + `/semanal`, `/plano`, `/plano-conta`, `/diagnostico-motor` | 2 › Resumo | F1 |
| `/cliente` Resumo `#secFolha` | 2 › Anúncios | F6 move (reescreve `:165`) |
| `/cliente` Resumo Motor de decisão (`motorHtml`) | 2 › Estratégia | F6 move (reescreve `:218`) |
| `/cliente` Resumo `#formMetas` (dentro do Motor) | 5 › Configurar cliente (`#secMetas`) | F6 |
| `/cliente` Resumo `#secFinanceiro #guardiao` | 4 › Raio-X e contrato | F1 via `?sec=`; F6 move |
| `/cliente` Resumo `#secGatilhos` | 3 › Pelo cliente | F6 move (`:354/:383` seguem verdes pela ordem do arquivo) |
| `/cliente` Resumo `#secNotion` | 5 › Configurar cliente | F6 move (idem) |
| `/cliente` Plano (por cliente + `#secPlanoConta`) | 2 › Plano | F1 |
| `/cliente` Plano `#formCustos` | 4 › Custos | F6 |
| `/cliente` Do cliente `#secDoCliente` | 3 › Pelo cliente | F1 |
| `/cliente` Executar `#secExecutar` e sub-blocos, `#exLiberacoes` | 3 › Execução no ML | F1 |
| `/cliente` Executar `#exParar` (global) | 5 › Estruturas (linha «Freio geral do executor») | F3 linha + atalho; F7d |
| `/cliente` Anúncios `#secAnuncios #secVendas #secImpacto` | 2 › Anúncios | F1 |
| `/cliente` Anúncios `#secPrecos` | 4 › Preços | F1 (`?sec=`) |
| `/cliente` Anúncios `#secOfertas` | 3 › Ofertas | F1 (`?sec=`); fica onde está |
| `/cliente` Produtos (todos os ids, `#secSyncEstoque`) | 4 › Produtos e estoque | F1 |
| `/cliente` Produtos `#secDre` | 4 › Lucro do mês | F1 (`?visao=lucro`) |
| `/cliente` Relatórios `#secRelatoriosCiclo` | 4 › Ciclos do negócio (relatório compras = 4 › Compras) | F1 (`?rc=`) |
| `/cliente` Estratégia (Leitura + `#secRetro`) | 2 › Estratégia | F1 |
| `/cliente` Configurar `#secFicha #cad-sec #secCatalogo #secRelatorio #secPerfil #secPerfilCliente #secAvisos` | 5 › Configurar cliente | F1 |
| `/cliente` Configurar `#secDossie #secRisco #secContrato` | 4 › Raio-X e contrato | F1 `?sec=`; F6 move (reescreve `:449`) |
| `/cliente` Configurar `#secCustosUpload` | 4 › Custos | F1 `?sec=`; F6 move (reescreve `:541`) |
| `/cliente` Configurar `#secNotaFiscal #secNotas` | 4 › Nota fiscal | idem |
| `/cliente` Configurar Ferramenta `#fAnuncio #resAnuncio` | 2 › Anúncios (fim) | F6 |
| `/promocoes` tudo menos Custos/Regras | 2 › Promoções | F1 |
| `/promocoes` aba Custos (`#formCustos #formConfig`) e Regras por SKU (`#formRegra`) | 4 › Custos | F1 (`?aba=custos`) |
| `/analistas` inteiro | 3 › Analistas | F1 |
| `/planos` veredito, `#passos`, `#secEscopo #secRevisar #secClientes #secGargalos`, `#btnNotionTodos` (atalho) | 3 › Distribuir | F1 |
| `/planos` `#secRelatorios #secAlertas #secAvisosAuto`, `#btnRelFrequencia #btnRelAntecipar #lnkCsv` | 5 › Comunicação | F1 (`?sec=`); F7c move |
| `/planos` ⋯ `#btnEquipe #btnSyncPrest` | 5 › Equipe | F3 atalho; F7e move |
| `/processos` inteiro | 2 › Como fazer | F1 |
| `/integracoes` `#btnLinksCsv` veredito `#proxima #secLista #secConfig` | 5 › Conexões | F1 |
| `/integracoes` `#custosPainel #dlgSegredo` | 4 › Custos (fontes automáticas) | F1 (`?custos=`) |
| `/integracoes` `#secSaudeSistema` | 5 › Estruturas | F3 linha + atalho; F7a move |
| `/c/*`, `/diagnostico`, `/d/:token`, callbacks | 5 › Estruturas (linhas «Endereços públicos») | F3 |
| utilitário «Integrações» do topo (`shell.js:11,42`) | some; o lugar vira **Hoje** (F5) e **Quem sou** (F2) | F1 |

**Resolução do problema que o David citou.** Produtos (sombra F2/F3), «Sincronismo de estoque» (F6) e Nota fiscal/Notas (F8) deixam de ser blocos avulsos em Resumo/Produtos/Configurar e passam a ser itens de **Empresa do cliente**, cada um com (i) que diz «desligado · chave · falta X» (seção C) e com a linha correspondente em **Estrutura › Estruturas** (seção C). O sub-texto deles muda já na F0: «Ainda não decide nada — chave desligada, ver Estrutura › Estruturas».

### A.8 Conferência das 19 «escondidas» do inventário de telas (checklist de aceite)

1 chaves gerais em 3 telas → `/estrutura` (F3) · 2 liberação por cliente em 4 lugares → linha no «Pronto para operar» e em `/estrutura` · 3 custo por 4 portas → submenu Custos com 3 linhas de estado · 4 chave «Coletar promoções» dentro do Perfil → linha própria com sub-rótulo «Coleta · Trinity» (fica no mesmo form por causa de `teste-semanal-rotas.mjs:255`) · 5 metas dentro do Motor → `#secMetas` em Configurar (F6) · 6 DRE e F6 escondidos em Produtos → Lucro do mês (`?visao=lucro`) e (i) no sync · 7 NF em dois blocos → lado a lado sob um título, um (i) · 8 Ferramenta em Configurar → fim de Anúncios (F6) · 9 Sprint 90 e Saúde em `/integracoes` → linhas em `/estrutura`, Assinantes em `/comercial` (F7) · 10 gaveta de custos só por `?custos=` → link na linha «fonte automática» do bloco Custos · 11 dois «perfis» → «Estilo do relatório PDF» × «Temas que o cliente pediu» · 12 dois cadastros + «Seu nome» repetido → nomes distintos + Quem sou · 13–15 inalterados (fora do escopo de menu) · 16 `#secNotion` e `#secImpacto` → Configurar e Anúncios (recolhido) · 17 Promoções fora do cliente → submenu do Consultor com `?cliente=` preservado e Quem sou · 18 seções sem selo → selo com papel em toda seção (F0) · 19 Manual desligado das telas → o (i).

---

## B) A abertura simples — a fila do dia por papel (≤ 5 blocos)

**Mecânica.** Não há login (`src/lib/equipe.js:125-126`: «restrição de produto, não segurança»). O shell ganha **Quem sou** (`details.ps-quem`: papel + nome, `localStorage.ps_quem`, `PS.quem()`, DOM puro — F2), que (a) preenche todo campo «Seu nome»/`por` que hoje é pedido tela a tela (os 12 arquivos listados na conferência) e (b) escolhe o recorte do **Hoje**. A validação de cargo continua no servidor. **Hoje** é um botão único no topo (lugar do antigo `.ps-int`) → `/fila?por=<papel>&quem=<nome>` (F5): projeção `GET /api/fila?por=&quem=&etapa=` sobre tabelas que já existem (`acoes_plano`, `tarefas`, `exec_ordem`, `gatilho_lote`, `relatorio_envio`, `feedback_relatorio`, `incidente`, `custos_cliente`, `meli_contas`, `aprendizado`, avaliador `pendencias-cliente.js`). Nenhum motor novo (CLAUDE.md). Sem papel escolhido mostra o bloco do **Líder** (é a mesa de exceções, decisão de 15/10).

**Regra fixa de cada item:** cliente · o que fazer · **1 botão** (rota de escrita que já existe) · prazo · o número que fecha o item. Teto 10 exceções/semana/família (decisão D-C1): acima disso o bloco diz «limiar errado: N itens; ajuste em Estrutura › Regras do método», nunca «trabalhe mais». **Topo de toda fila:** 4 números fixos (autonomia % · cobertura `PS-` % · exceções da semana ÷ teto · contas por pessoa) + o stepper da carteira (seção D). Um único `.btn-primario` por tela = o botão do 1º item. Cada bloco pode ser filtrado por etapa (`?etapa=<n>`) quando se chega pelo stepper da carteira.

| Papel (`por=`) | Bloco 1 | Bloco 2 | Bloco 3 | Bloco 4 | Bloco 5 |
|---|---|---|---|---|---|
| **Dono** | Números: GMV 28 d × anteriores (`/gmv`), autonomia %, cobertura %, contas por pessoa, Brier por família (`/metodologia #secCalib`) | Decisões só dele: estreias de operação, degrau com veto 48 h (`POST /api/chaveiro/exec/vetar`), «go» S90 F5, regra candidata à aposentadoria (`#secRegras`), chaves de arquivo pendentes de reinício | Carteira por etapa (stepper agregado: N atrasados por etapa) | Clientes em risco aberto + respostas negativas ao relatório (`risco_cliente`, `feedback_relatorio`) | Incidentes críticos abertos com dono/SLA (`incidente`) |
| **Líder / Head** (padrão; «o androide») | Para o sistema andar (Trinity/Smith): contas a reconectar (link pronto), coleta falhou hoje, Notion > 3 h, clientes sem custo/prazo do fornecedor | Para decidir (Arquiteto/Chaveiro/Neo): P0/P1 propostas por cliente (aprovar/descartar com motivo/delegar em 1 clique — `/api/planos/acoes/status`), aprovadas não distribuídas (`/api/planos/distribuir`), ordens aguardando `confirmar`, degraus com veto, as 3 regras com briefing | Para desconfiar (Merovíngio/Chaveiro): ordens divergentes, reversões, textos barrados pelo auditor, família com Brier > 0,30 | Para falar com gente (Morpheus/CS): reclamação ligada a ordem, pendência > 30 d, resposta negativa, risco aberto, elegíveis não liberados (`preparar-lote` em prévia) | Terça: prévia dos planos (só os barrados pedem leitura) · recibos falhados; sexta: relatórios `falhou` |
| **Consultor** (`quem=` → escopo `consultor` de `resolverEscopo`, `equipe.js:171`) | Aprovar: P0/P1 propostas da carteira dele (aprovar / descartar / delegar) | As 3 regras que exigem o consultor (`foco.regras_exigem_consultor`) com o briefing pedido | Pelo cliente: pendências vencidas 14/30 com o texto fixo do catálogo + «Preparar lembrete» (`/api/cliente/do-cliente/lembrete`) | Terça: prévia barrada / recibo falhado dos clientes dele; respostas dos clientes | Resultados que fecharam ontem (melhorou / piorou / sem efeito) + vínculos ambíguos a confirmar; preço alterado sem decisor / cliente sem custo |
| **Analista** (hoje não tem tela) | Seus cards hoje: tarefas `PS-` + Notion com responsável = nome, na ordem Eisenhower (`config/eisenhower.json`), cada um com (i) = `cartao()` do `/processos` | Parados > 7 d (os seus) | Aguardando o cliente (dependência) com «o que pedir» | O que você fez rendeu: veredito por tarefa (Merovíngio, sem culpa) | Terça 08:30: o resumo do Discord do seu cliente |
| **CS** (`cs_responsavel`) | Clientes em risco / resposta negativa (marcar risco, gerar dossiê) | Pendências vencidas com lembrete preparado | Sem custo / sem prazo do fornecedor / sem grupo WhatsApp (cobrança com template) | Contrato ou pagamento faltando (dossiê INCOMPLETO); contratos vencendo em 30 d (`renovacao_janela_dias`) | Plano de terça / relatório não entregue (recibo) |
| **Técnico** | Saúde do sistema: sinais `atencao/critico` (`incidente`) | Chaves de arquivo pendentes de reinício na janela combinada | `.env` faltando (checklist de `#secConfig`) | Backup / frio com falha (`data/backup.log`, `data/arquivar.log`) | — (4 blocos) |

Cliente do Sprint 90 continua em `/c/painel` (fora do shell): já é a «abertura simples» dele.

---

## C) O padrão do ícone (i)

**Forma.** Botão sem texto, reusando `.btn-icone` (36×36, `ui.css:221`): `<button class="btn-icone btn-ajuda" type="button" aria-label="Como fazer: Nota fiscal" data-ajuda="nf">`. Fica dentro de `.bloco-cab`, **depois** do selo `.sis` e do `<small class="sis-papel">` — nunca dentro do `<h2>` (`teste-shell-ui.mjs:553` exige `<h2>Título</h2><span class="sis" data-sistema=` colados). Em `details.recolhido` vai dentro do `<summary>`, depois do `.n`; o clique no botão faz `preventDefault` + `stopPropagation` para não abrir/fechar o `details`. Glifo «i» por `.btn-ajuda::before` + máscara SVG inline em `ui.css` (mesmo padrão do chevron `ui.css:392-394`), cor `currentColor` — zero hex, zero emoji (varreduras de `teste-shell-ui.mjs:87-101`). Nas linhas da tabela de Estruturas e em cada `li` do stepper, o mesmo botão.

**Comportamento.** `window.PSAjuda.abrir(id, { cliente })` em **`src/web/ajuda.js`** (arquivo novo, entra em `COMPARTILHADOS` de `teste-shell-ui.mjs:27`; delegação `click [data-ajuda]` no `document`), **não** no `shell.js` — o shell não chama API (spec § 4.1). Faz `GET /api/ajuda/:id?cliente=` e abre o `dialog.dlg` (`ui.css:343-349`, o mesmo de `PS.confirmar`), DOM puro. Fechado por padrão, nunca na 1ª dobra (spec § 5.9).

**Conteúdo, sempre nesta ordem:**
1. `h2` «Como fazer: <nome claro>» + selo do sistema + escopo (global · por cliente · por anúncio/produto).
2. **Estado agora**: `ligado | desligado | pronto (configurado, não ligado) | pendente | erro` · desde (data) · por quem · **camada** (`arquivo config/*.json — mudar = reiniciar na janela combinada` | `banco sync_estado — muda pela tela` | `.env` | `fora do sistema: Notion / DevCenter / n8n`) · motivo quando não está ligado. Fonte: `src/lib/estrutura-estado.js` (F3); até lá «estado: sem leitura».
3. **Pré-requisitos** (`ul` com ponto `.s-ok/.s-pend/.s-erro`), cada um com o número que o prova e link para onde se resolve.
4. **Passo a passo** numerado, formato `<li><b>título</b> <small>texto</small></li>` idêntico ao `ol()` de `processos.js:15`, com «quem faz» entre parênteses.
5. **Concluído quando** (`.aviso.ok`): um número.
6. Rodapé: «Onde configurar» (`?aba=&sec=` ou `/estrutura?sec=`), «Documento» (caminho em `docs/`), e, para tarefa, «Processo completo» → `/processos?busca=`.

**Fonte dos textos:** `config/ajuda.json` (NOVO): `{ id: { titulo, sistema, escopo, chave, camada, pre_requisitos: [{ texto, verificar }], passos: [{ titulo, texto, quem }], concluido_quando, doc, onde } }`; `verificar` é um id resolvido por `estrutura-estado.js`. Para tarefas do Manual a fonte continua `GET /api/processos/:id?canal=`. Teste `scripts/teste-ajuda.mjs` (NOVO): todo `data-ajuda` do HTML/JS tem entrada no JSON, toda entrada tem ≥ 3 passos + `concluido_quando` + `doc` que existe no disco; texto sem hex/emoji.

### Exemplo 1 — Nota fiscal (`data-ajuda="nf"`, em `#secNotaFiscal` e na linha «Emissão de nota fiscal» de Estruturas)

> **Como fazer: Emissão de nota fiscal** · Smith (regras) + Chaveiro (emissão) · por cliente, chave global
> **Estado agora:** DESLIGADA · chave `nf.ligado` em `config/nota-fiscal.json` (arquivo: mudar = reiniciar o servidor na janela combinada) · desde 15/10/2026 (nasceu desligada) · `envio_ml_ligado` e `producao_ligada` também desligadas · Motivo: CNPJ do intermediador e da credenciadora vazios no config (bloqueio em toda nota), provedor fiscal (Focus NFe) sem credencial declarada em `src/lib/env.js`, termo fiscal em rascunho sem revisão jurídica.
> **Pré-requisitos deste cliente:** dados fiscais cadastrados (CNPJ, razão social, IE, UF, regime, modalidade de frete) — hoje: não · termo de responsabilidade aceito — não · regras do contador por SKU importadas — 0 de N SKUs vendidos em 28 d (sinal `nf_regra_faltando`) · certificado A1 enviado — ausente · 1 nota em homologação — não.
> **Passo a passo:** 1. (consultor + contador) **Peça ao contador** o CSV de regras por SKU (19 colunas de `csv_colunas`; modelo em `docs/`, a criar). 2. (consultor) **Dados fiscais**: em Empresa do cliente › Nota fiscal, preencha o formulário (hoje são 9 `prompt()` seguidos, `nota-fiscal.js:57-61`). 3. (cliente aceita, consultor registra) **Registrar termo** com o texto de `config/termo-fiscal.md`. 4. (consultor) **Importar regras (CSV)** e confira `total_regras` = SKUs vendidos. 5. (consultor) **Enviar certificado** (.pfx + senha): o arquivo vai ao provedor, aqui fica só `cert_ref`; confira a validade. 6. (David) criar a conta no provedor fiscal, preencher os CNPJs do intermediador e da credenciadora e ligar `nf.ligado` em homologação (reinício na janela combinada). 7. (líder) Em **Notas**: «Buscar pedidos pagos» → rascunhos; aprove 1; «Emitir aprovadas (homologação)»; confira o XML. 8. (David) Só depois `producao_ligada`, depois `envio_ml_ligado`; a emissão automática entra após 20 notas sem correção (`automatica_apos_notas_sem_correcao`).
> **Concluído quando:** 1 nota em homologação com XML autorizado e zero bloqueio nominal; SKUs vendidos sem regra = 0.
> Documento: `docs/desenho-v3-erp.md` § F8a · `config/nota-fiscal.json`.

### Exemplo 2 — Sincronismo de estoque (`data-ajuda="estoque_sync"`, em `#secSyncEstoque` e na linha «Ajuste automático de estoque»)

> **Como fazer: Ajuste automático de estoque no Mercado Livre** · Chaveiro · global + por cliente + por produto
> **Estado agora:** DESLIGADO · chave `sync_estoque_ligado` em `config/chaveiro.json:26` (arquivo, reinício) · freio `chaveiro_estoque_parado` (banco, pela tela): solto · liberação deste cliente: não · estreia: 1 produto/dia · Motivo: `produto.diagnostico_ligado` também está desligado (`config/algoritmo.json:135`), então tudo nesta aba ainda não decide nada.
> **Pré-requisitos:** diagnóstico por produto ligado — não · mapeamento anúncio → produto sem sugestões pendentes — N pendentes · estoque físico declarado há ≤ 24 h (cliente, equipe, ERP ou planilha) — nunca · cliente informado e líder liberou — não.
> **Passo a passo:** 1. (consultor) **Produtos e estoque › Gerenciar mapeamento**: Juntar / Não é o mesmo / Separar até zerar as sugestões. 2. (cliente ou CS) **Declare o estoque físico** (`POST /api/cliente/produtos/estoque-fisico`) ou conecte planilha/ERP em Custos › fontes automáticas. 3. (líder) **Leia a prévia** «Ajuste automático de estoque (prévia)»: o que o sistema escreveria; confira 3 produtos à mão no painel do ML. 4. (David) ligar `produto.diagnostico_ligado` e `sync_estoque_ligado` (reinício; `scripts/teste-produto-diagnostico.mjs` precisa passar). 5. (líder) Execução no ML › Liberações › Liberar, marcando «cliente informado» (`/api/chaveiro/estoque/liberar`). 6. (líder) **Estreia** em 1 produto (regra por produto `/api/chaveiro/estoque/regra`); a 1ª ordem pede `confirmar`. 7. Acompanhe em Ordens: conferência por releitura (2xx não é «feito»); após 10 conferidas sem divergência o Neo propõe ampliar, com veto de 48 h.
> **Concluído quando:** 10 ordens de estoque conferidas sem divergência neste cliente, freio não acionado.
> Documento: `docs/manual-integracao-ml.md` § F6 · `docs/desenho-v3-erp.md` § A.

### Exemplo 3 — Avisos no WhatsApp (`data-ajuda="avisos_whatsapp"`, em `#secAvisos` e na linha «Plano de terça ao cliente»)

> **Como fazer: Plano de terça no WhatsApp do cliente** · Morpheus · global + por cliente
> **Estado agora (global):** chave `gatilhos_ligado` (banco, Estrutura › Comunicação): ligada em 15/10 por <nome> · `inicio_envios` 2026-10-20 · entregador n8n: configurado / «entrega n8n não configurada» (`n8n.configurado`) · horário: terça 09:00–20:00 no fuso do cliente.
> **Pré-requisitos deste cliente:** integração ML de fato (conexão + coleta ≤ 3 d + vendas 28 d) — motivo quando falta (`sem_conexao_ml | coleta_atrasada | sem_vendas_28d`) · grupo do ML na central («Id whatsapp meli» …@g.us) — preenchido? · canal testado com recibo `entregue` — não · liberado por líder — não.
> **Passo a passo:** 1. (CS) Na central do Notion preencha «Id whatsapp meli» — ou aqui clique **Preencher com a central**. 2. (consultor) Marque o canal **WhatsApp ligado**, confira nome na mensagem, silêncio e fuso; **Salvar**. 3. **Testar canal** e espere o recibo `entregue` (falhou = veja a linha «Entregador n8n» em Estruturas). 4. (líder) **Liberar** — ou em lote em Estrutura › Comunicação › «Preparar lote» (prévia → confirmar). 5. Terça 09:00 o plano sai sozinho, idempotente por semana ISO; texto fixo, auditado por `relatorio-seguro`. 6. Confira o recibo em Pelo cliente › «Avisos ao cliente: fila e recibos».
> **Concluído quando:** recibo `entregue` do lote `semanal` desta semana para este cliente.
> Documento: `docs/desenho-gatilhos-n8n.md` § Plano semanal · `config/gatilhos.json`.

---

## D) O progresso do processo — um stepper único da cadeia

**Onde aparece.** (1) No cabeçalho do `/cliente`, entre `#kpis` e a barra de abas (`cliente.js:390`): `<ol class="passos passos-estatico" id="progresso">`. `passos-estatico` sobrescreve o `position:sticky` de `ui.css:424`, porque a barra de abas do cliente já é sticky em `top:var(--shell-h)` (`ui.css:301`, `tela-cliente.css:7`). (2) Na carteira: `#secProgresso` em `/` (depois de `#proxima`), no topo de `/fila` e de `/estrutura`, com três contagens por etapa (N feito · N atrasado · N desligado) e os **10 contadores «clientes parados nesta etapa»** — o gargalo (aprovação 4 %, cobertura 0,3 %) fica visível pela primeira vez. Abaixo, tabela 1 linha por cliente (≤ 5 colunas: Cliente · Etapa atual · Número · Atraso · Próxima ação), ordenada por atraso, linha expansível com o `ol.passos` compacto. Um módulo só: `src/web/progresso.js` (`window.PSProgresso.montar(el, { cliente } | { escopo })`), dados de `GET /api/cliente/progresso?cliente=` e `GET /api/progresso?escopo=` (reusa `resolverEscopo`, `equipe.js:171`), cálculo puro em `src/lib/progresso-cliente.js` sobre números que já existem. Nenhum dado novo.

**Estados por etapa** (classes em `ol.passos>li`): `feito` (verde, já existe), `atual` (tinta, já existe), `pendente` (cinza, padrão), **`atrasado`** (NOVO, `color:var(--verm)`), **`desligado`** (NOVO, `var(--cinza-claro)`: a chave global está desligada — não é atraso, é estrutura), `aguardando` (carência/janela de prova: não é atraso). O número da prova vai no `li` como texto neutro (KPI nunca colorido); o atraso aparece pela cor do passo + «há N d · limiar X» + (i) com a regra. Clique no passo leva à tela/seção que resolve; na carteira, clique em «N atrasados» abre `/fila?por=…&etapa=<n>`. **`#btnRevisar`** (único primário do `/cliente`) passa a ser o botão da 1ª etapa atrasada/pendente — «Próxima ação» real (spec § 8.1 item 16) sem segundo primário.

| # | Etapa | Número que prova | `feito` | `atrasado` | Onde age |
|---|---|---|---|---|---|
| 1 | Cadastrado | quadro «Tarefas - {Cliente}» descoberto (`sync_estado.fonte_descoberta`) · CS responsável (`cs_responsavel`) · «Pronto para operar: N de 8» | quadro + CS | Ativo há > 7 d sem quadro ou sem CS | 5 › Configurar cliente (Cadastro, Ficha) |
| 2 | Conectado | conta ML viva (`meli_contas` sem erro); carteira: conectados ÷ Ativos (doc 15/10: 47/173) | conexão ok | conexão `erro`/expirada; Ativo sem conexão > 7 d do link gerado | 5 › Conexões (`/integracoes?fq=`) |
| 3 | Coletado | `coleta_ml_em` (h) · `ultimo_sync` Notion (h) · lacunas de pedidos (d) | coleta ≤ 24 h e sync ≤ 3 h, lacunas 0 | coleta > 26 h (atenção) / > 30 h (crítico), sync > 26 h — limiares de `config/autogestao.json` | 5 › Estruturas (saúde) · «Atualizar dados» no Resumo |
| 4 | Dados da empresa | custo informado ÷ receita 28 d (`custo-vinculo`) · `lead_time_fonte` informado · catálogo marcado | custo ≥ 80 % da receita **e** prazo do fornecedor informado | conectado há > 14 d sem custo | 4 › Custos · 4 › Compras (prazo) · 5 › Configurar cliente (catálogo). É o portão M3 do androide |
| 5 | Plano | diagnóstico `disponivel` · plano regerado hoje (`acoes_plano.criado_em`) · N propostas · % com caminho | plano de hoje para conta coletada hoje | coleta de hoje sem plano regerado > 24 h; diagnóstico `indisponivel` | 2 › Plano · 2 › Estratégia |
| 6 | Aprovado | P0/P1 propostas sem decisão (n, idade mediana) · aprovadas ÷ propostas (doc: 84/2.051) | nenhuma P0/P1 com > 2 dias úteis sem decisão | P0/P1 sem decisão > 2 dias úteis | Hoje (bloco «decidir») · 2 › Plano (P0+P1) · 3 › Distribuir › Revisar |
| 7 | Distribuído | aprovadas não distribuídas (doc: 54) · cobertura = cards `· PS-` ÷ tarefas (doc 0,3 %) | 0 aprovadas paradas > 2 d | aprovada não distribuída > 2 d | 3 › Distribuir (`#btnDistribuir`, dry-run → confirmar) |
| 8 | Executado | 3 mãos: cards `PS-` concluídos ≤ 7 d (analista) · ordens conferidas sem divergência (Chaveiro) · pendências resolvidas ≤ 7 d (cliente) | cards parados > 7 d = 0, pendências > 14 d = 0 | card parado > 7 d (doc: 30/30); pendência > 14 d (atenção) / > 30 d; ordem divergente | 3 › Analistas · 3 › Execução no ML · 3 › Pelo cliente. Chaveiro aparece `desligado` enquanto `execucao_ligada=false` |
| 9 | Medido | `aprendizado` > 0 para o cliente · `medicao_em` ≤ 26 h · medidas com controle e confiança ≥ 80 | toda distribuída concluída há > 17 d tem medida | concluída há > 17 d (3 d carência + 14 d janela) sem medida; `medicao_em` > 72 h (crítico); `sem_tarefa` | 2 › Resumo `#secAcomp` (vincular anúncio) · 1 › O que funciona |
| 10 | Comunicado | recibo `entregue` do lote `semanal` nesta semana ISO · relatório ao Notion no prazo da frequência · resposta do cliente nos últimos 14 d | recibo da semana entregue e relatório em dia | terça 12:00 sem recibo para cliente liberado; relatório `falhou`; texto barrado pelo auditor; cliente elegível e **não liberado** mostra `pendente` com motivo | 5 › Comunicação · 5 › Configurar cliente › Canais |

Na carteira o mesmo `ol` vira 10 colunas com as três contagens e o percentual de clientes que chegaram ao fim da cadeia nesta semana («ciclo completo: N de M»). Calibração (Brier) e autonomia % não são etapa do cliente: ficam nos 4 números do topo da fila e em `/metodologia`. Teste `scripts/teste-progresso.mjs` (puro, fixtures: cliente ok · coleta de 40 h · proposta de 11 dias · chave desligada → `desligado`, não `atrasado`).

---

## E) Nomes — tabela de renomeação (ids intactos)

| Hoje | Amanhã | Observação |
|---|---|---|
| Menus «Visão geral · Clientes · Time · Comercial · Método» + utilitário «Integrações»/«Configuração» | Assessoria · Consultor · Execução · Empresa do cliente · Estrutura | `shell.js:4-11`; `.ps-int` some; spec § 2.1 reescrita |
| Painel executivo | Painel executivo (mantém) + `.sub` «execução do sprint no Notion» | **pinado** `teste-shell-ui.mjs:108` |
| GMV | Faturamento | rota `/gmv` fica |
| Distribuição (`/planos`) | Distribuir ao Notion | — |
| Algoritmo / Metodologia / «Algoritmo do plano» | Acerto do algoritmo (Menu 1) · Regras do método (Menu 5) | mesma página |
| Processos | Como fazer (Manual do Analista) | — |
| Integrações | Conexões | rota `/integracoes` fica (`teste-custos-ui.mjs:45`) |
| Aba Do cliente / Executar / Produtos / Relatórios / Configurar | Pelo cliente / Execução no ML / Produtos e estoque / Ciclos do negócio / Configurar cliente | **só no submenu do shell até a F6**: os pares literais `['executar', 'Executar']`, `['produtos', 'Produtos']`, `['relatorios', 'Relatórios']` são pinados (`:485,525`) e só mudam na F6 |
| (nova aba) | Empresa | id `empresa`, inserida depois de `estrategia` (não rompe `:485/:525`), F6 |
| `<h2>Produtos</h2>` + sub «Em sombra…» | Estoque por produto + «Ainda não decide nada — chave desligada, ver Estrutura › Estruturas» | F0 |
| Sincronismo de estoque (Chaveiro) — prévia | Ajuste automático de estoque (prévia, desligado) | F0 |
| DRE do mês | Resultado do mês (DRE simples) | — |
| `<h2>Relatórios</h2>` (ciclo) | Os 8 ciclos do negócio | — |
| Nota fiscal · Notas | Nota fiscal: regras e certificado · Notas emitidas (rascunho → emissão) | sob um título «Nota fiscal» com um (i) |
| Financeiro (Smith) | Raio-X financeiro | — |
| Subir planilha de custos · Custos (promoções) · Custos por SKU (gaveta) · «Custos não informados» (`#formCustos`) | Custos: planilha do cliente · Custo ligado ao anúncio · Custos: fontes automáticas (planilha, Bling, Tiny) · Custos em % (CMV, imposto, comissão) | 4 portas, 1 submenu |
| Motor de decisão | Previsão do mês (Oráculo) | **`'Motor de decisão'` é a string de fatia em `teste-shell-ui.mjs:218`**: renomear só na F6, junto com o assert (fim da fatia passa a `id="secAlinhamentos"`) |
| Retroalimentação | O que a conta aprendeu | — |
| Leitura estratégica · Ofertas estratégicas · Nova estratégia (Chaveiro) | Leitura da conta · Ofertas: produzir anúncios · Nova sequência de operações | «Duplicação estratégica» fica (nome do método) |
| Depende do cliente · Alinhado com o cliente | O que só o cliente faz · Combinados com o cliente | — |
| Avisos (Resumo) · Avisos ao cliente (Configurar) · Alertas ao cliente (`/planos`) · Avisos automáticos ao cliente (`/planos`) | Avisos ao cliente: fila e recibos · Canais do cliente (WhatsApp, e-mail, Notion) · Alerta de pendência crítica · Plano de terça: chave e recibos | — |
| Relatório para o cliente no Notion · Relatórios para o cliente (`/planos`) · Relatórios (menu do Painel) | Relatório no Notion: frequência e envio · Relatório no Notion: liberação em lote · Documentos do sprint | — |
| Perfil do relatório semanal · O que este cliente quer receber | Estilo do relatório PDF · Temas que o cliente pediu | a chave «Coletar promoções» ganha sub-rótulo «Coleta · Trinity» e **fica dentro de `desenharPerfil`** (`teste-semanal-rotas.mjs:255`) |
| Ficha do cliente · Cadastro do cliente | Equipe e contas do cliente · Cadastro do CS (health score) | — |
| Folha do anúncio · Cronologia de preços · Mais vendidos, como o comprador vê · Anúncios no período · Resultado das tarefas | mantêm (só `.sub` mais claro) | `<h2>` pinados em `teste-shell-ui.mjs:151,168,177,553` |
| Medição técnica | Detalhe da medição (janelas e controle) | — |
| Saúde da conta · Saúde do sistema | Saúde da conta no ML · Saúde do Place Sprints | — |
| Gargalos da base | Onde as ações acumulam | — |
| Configuração técnica (`/integracoes`) | App do Mercado Livre (DevCenter) | — |
| Ferramenta: diagnóstico de anúncio | Calculadora: impressão, clique ou conversão | — |
| Elegíveis · Participando e cobertura · Relâmpago · Interrogatório | Campanhas candidatas · No ar e cobertura dos protegidos · Ofertas relâmpago (candidatos) · Divergências humano × analista automático | `promocoes.js` só rótulos; conferir `teste-promocoes-ui.mjs:134` |
| Sincronizar (Painel) · Coletar agora / Atualizar dados | Reler o Notion · Reler o Mercado Livre | — |
| Selos Trinity…Neo | **texto e `title` ficam iguais** (`teste-sistemas.mjs:91`); o papel vai num `<small class="sis-papel">` irmão, logo depois do `.sis`: «· coleta», «· algoritmo», «· previsão», «· medição», «· execução», «· comunicação», «· financeiro», «· autonomia» (de `config/sistemas.json → papel`) | `data-sistema` e ordem inalterados (`:94`); F0, zero teste |
| Chaves: `execucao_ligada` · `adaptadores_live.*` · `caminho_por_regra` · `sync_estoque_ligado` · `gatilhos_ligado` · `consultor_discord_ligado` · `relatorio_agendador` · `alerta_auto` · `dossie_mensal_ligado` · `produto.diagnostico_ligado` · `financeiro.margem_medida_nas_regras` · `nf.ligado` · `relatorios_ciclo.blocos_terca_ligado` · `sprint90.publicacao_live` · `promo_config.execucao_habilitada` · `whatsapp_critico_ligado` · `chaveiro_execucao_parado` · `chaveiro_estoque_parado` · `urgente.na_hora_ligado` · `VIGIA_ENVIO_LIGADO` | Executor ligado · Operações liberadas no ML · Quem executa cada regra · Ajuste automático de estoque · Plano de terça ao cliente · Resumo de terça no Discord · Relatório no Notion automático · Alerta de pendência crítica · Prestação de contas mensal · Diagnóstico por produto · Lucro por pedido nas regras · Emissão de nota fiscal · Ciclos no plano de terça · Publicação real no Sprint 90 · Promoções: execução real · WhatsApp do Head no crítico · Freio geral do executor · Freio do estoque · Urgente de estoque/preço na hora · Vigia avisa (sai do dry-run) | nomes só na tela de Estruturas e no (i); ids de config inalterados, mostrados em `<small>` |

---

## F) O modelo ANDROIDE — 1 especialista + sistema para 50 clientes

**Premissas que o código impõe.** Só o Mercado Livre tem leitura e escrita; o especialista é o Head de canais como mesa de exceções, teto de 10 exceções/semana/família; 50 contas por pessoa é o marco M4–M5 (`docs/plano-autonomia-total.md` § 4–5) e exige, em ordem: **M1** 100 % dos Ativos conectados e cobertura `PS-` ≥ 30 % → **M2** medição sem depender do card (B1) → **M3** escrita no ML pelo Chaveiro com custos informados (etapa 4 do stepper) → **M4/M5** degraus do Neo. Hoje: ≈ 4,7 contas/pessoa, 27 % conectados, 0 medições, 0 ordens, aprovação 4 %. A rotina abaixo descreve o estado-alvo e diz, em cada passo, o que precisa estar ligado.

**Conta de capacidade.** 50 clientes × 5 ações/semana = 250 propostas/semana. A mesa não aprova 250: em M4, família com prior calibrado (n ≥ 5) e caminho `automatico` sobe para `executar_e_avisar` (Neo, após 10 ordens limpas, veto 48 h) e deixa de passar pela mesa; chegam à mesa só P0, família nova/sem calibração, as 3 regras que exigem consultor e as exceções. Teto 10/semana/família × 7 famílias = ≤ 70 exceções/semana ≈ 14/dia ≈ 1,5 h; aprovação em lote por regra ≈ 40 min/dia; ordens ≈ 20 min; cobrança ≈ 15 min. **Total ≈ 3 h/dia de mesa para 50 contas** — válido só com M3 (Chaveiro escrevendo) e Shopee (56 % das tarefas) em card até ter API. É isso que a fila mede: exceções da semana ÷ teto.

### Dia a dia (tela por tela)

| Hora | Tela | O que o sistema já entregou pronto | O que a pessoa faz | Precisa estar ligado |
|---|---|---|---|---|
| 04:00–06:30 (ninguém) | — | coleta completa → plano regerado por cliente com caminho e p_sucesso → saúde da conta → promoções → medição das maduras → alertas/gatilhos pós-coleta → carimbo (`server.js:533-597, 674-680`) | nada | sempre (Trinity, Arquiteto, Oráculo); `medirResultados` diário |
| 07:00 | **Hoje** (`/fila`, papel Líder — bloco «para o sistema andar»), 5 min | contas a reconectar com link pronto, coleta com falha, Notion atrasado, incidentes com dono/SLA, clientes sem custo/prazo | 1 clique por item: «Novo link» / «Restaurar» / reconhecer incidente / cobrar custo com template | vigia e saúde (`config/autogestao.json`) |
| 07:05 | **Hoje** (bloco «para decidir»), 15 min | P0/P1 por cliente com fato × hipótese, roteiro e p; as 3 regras com o briefing pedido; descarte com motivo da lista vira alinhamento | aprovar / descartar / delegar em lote (`POST /api/planos/acoes/status`); distribuir (`/api/planos/distribuir {confirmar:true}`) | — (manual hoje); em M4 o Neo aprova família calibrada |
| 07:20 | **Hoje** (bloco «para desconfiar») + **Execução no ML** só dos clientes com ordem, 10 min | ordens preparadas com prévia campo a campo e o que o Merovíngio vai medir; cards `PS-` parados > 7 d com cobrança; pendências 14/30 com texto fixo | aprovar ordens (`/api/chaveiro/exec/aprovar`), cobrar, «Preparar lembrete» | `execucao_ligada`, `adaptadores_live.<op>`, liberação por cliente |
| 07:30 | **Hoje** (bloco «para falar com gente») + **Empresa do cliente › Raio-X**, 5 min | preço alterado sem decisor, margem negativa, ruptura com «pedir agora/até» e quanto, risco aberto, resposta negativa | «Decisão do cliente» 1 clique (`/api/cliente/preco/decisao`); marcar risco | custos informados (Smith); `financeiro.margem_medida_nas_regras` para lucro nas regras |
| 07:35 | **Hoje** (papel Dono) — só o David, 5 min | 4 números, degraus com veto 48 h, estreias, regra candidata à aposentadoria, chaves pendentes de reinício | vetar / aprovar estreia | `neo_liberacao_auto` (C1, a construir) |
| 12:00 e 17:00 | **Hoje** (bloco «para desconfiar») | ordens conferidas por releitura; divergências; reversões pela regra de parada | só as divergentes | conferência 10/15 min × 4 (`config/chaveiro.json`) |
| ao longo do dia (0 reuniões de rotina) | **Consultor › Resumo** do cliente que apareceu na fila | stepper no cabeçalho diz em que etapa o cliente travou; `#btnRevisar` é a próxima ação; pauta de reunião do Smith pronta quando há decisão A/B | só clientes com exceção; reunião ≤ 0,25/cliente/mês (alvo do plano) | — |

### Semana

| Quando | Tela | Sistema entrega | Pessoa | Chave |
|---|---|---|---|---|
| Terça 08:30 | Discord do cliente (fora do sistema) | resumo por cliente: rendeu / sem resultado medido / pontos da assessoria / o que o cliente leu, marcando 3 cargos + consultor | lê só os do Hoje | `consultor_discord_ligado`, «Webhook ML» na central |
| Terça 09:00 | **Estrutura › Comunicação** | plano semanal ao cliente (WhatsApp/Notion/e-mail) auditado, idempotente; só os barrados pelo auditor pedem leitura; elegíveis não liberados em lote (`preparar-lote` em prévia) | libera o lote; lê os barrados | `gatilhos_ligado`, cliente liberado, n8n |
| Terça 12:00 | **Hoje** | recibos: «N de M elegíveis entregues»; falhas com Reenviar | só falhas | — |
| Sexta 17:00 | **Estrutura › Comunicação** | relatório curto ao Notion de cada cliente (frequência própria) + PDF anexado; Plano B como tarefa | só `falhou` | `relatorio_agendador` (hoje `agendador_ligado:false` de fábrica), liberação |
| Semanal (ritual do Manual) | **Execução › Distribuir** | gerar → as 5 do foco já aprovadas pela mesa → distribuir no Notion com roteiro inteiro | confirma o lote | — |
| Quinzenal | **Assessoria › O que funciona** | medidas N1/N2 por família × estado; «o que derrubaria esta leitura» | lê; confirma vínculos ambíguos | `aprendizado` > 0 (B1) |
| Mensal | **Assessoria › Acerto do algoritmo** | Brier/viés por família, regras candidatas à aposentadoria, quarentena automática (B2) | David decide regra; recalibra `config/algoritmo.json` | `calibracao.quarentena_auto` (a construir) |
| Dia 1, 09:00 | **Assessoria › Carteira em risco** | prestação de contas / dossiê para risco aberto, via n8n | lê o INCOMPLETO (falta contrato) | `dossie_mensal_ligado` |

### O que continua nas mãos de gente (e por isso aparece na fila como «falar com gente», não some)

Ads (endpoint de escrita nunca verificado), Shopee/Amazon/TikTok (sem API, 76 % das tarefas: card no Notion para o analista), catálogo de terceiros, dado que só o cliente tem (custo, prazo do fornecedor, estoque físico, regra fiscal), as 3 regras de pesquisa, imagens com IA sem `FAL_KEY`, compra física/Full/reclamação, jurídico/renovação/crise. O androide não elimina o analista no Shopee; elimina o consultor-despachante no ML.

**Prova de que o androide funciona (números fixos no topo de toda fila):** autonomia % = ordens executadas e conferidas pelo Chaveiro (+ caminho cliente resolvido sem card) ÷ ações encerradas (hoje 0); cobertura % = cards `· PS-` ÷ tarefas do Notion (hoje 0,3 %); exceções da semana ÷ teto; contas por pessoa (hoje ≈ 4,7; M4 30; M5 60).

---

## G) Plano de implementação em fases pequenas (cada uma publicável com `node scripts/teste-*.mjs` verde)

Regras que valem em todas: ids nunca somem (`teste-shell-ui.mjs:47-59`, `cliente.js:69 VIVOS`); todo id novo entra em `hooks_js` do inventário da tela; `selos_sistema.secoes` reordenado no mesmo commit que mover um `.sis` (`teste-sistemas.mjs:94`); 1 `.btn-primario` por tela; cor só por token no 1º `:root` de `ui.css`; ícone só por máscara SVG; nenhuma rota removida (`/integracoes` continua `app.get` real por causa de `teste-custos-ui.mjs:45`); nenhum `#hash` no `/cliente`; decisão nova registrada em `docs/ux/sistema-de-design.md` (§ 2.1, § 7.2, § 8.7) no mesmo commit que reescrever um assert; `alerta.js` intocado.

**F0 — Nomes, papel nos selos e saneamento (1 dia; zero teste muda).** Tabela E exceto o que está pinado (rótulos das abas do cliente, «Motor de decisão», `<h2>` de `:553`). `<small class="sis-papel">` depois de cada `.sis` com o `papel` curto de `config/sistemas.json` (texto e `title` do selo intactos). Sub-texto de `#secProdutos` e `#secSyncEstoque` sem «sombra/F2/F3/F6». `<title>`/`h1` das telas. **Saneamento das 4 divergências doc × arquivo** que a tela de Estruturas vai expor: `config/gatilhos.json:40 urgente.na_hora_ligado` (`true` no arquivo, «nasce desligada» no comentário/CLAUDE.md — decisão do David); `automacao/n8n/place-gatilhos-resumo-8h.json` ainda chamado «segunda 09:05» (decisão: terça); `com.place2u.place-sprints.semanal.plist` × relatório automático ao Notion (CLAUDE.md manda não carregar junto). (Conferido depois pela sessão: o repositório git existe desde 20/10 — `github.com/davidvallejr/placesprints` — e o `git.plist` está instalado e correto; `urgente.na_hora_ligado: true` foi decisão do David em 14/10 — o que está desatualizado é o comentário do config, `gatilhos.js:3` e `CLAUDE.md`.) Arquivos: `src/web/cliente.js` (h2/sub), `executar.js`, `produtos.js`, `gatilhos.js`, `relatorio.js`, `nota-fiscal.js`, `planos.html`, `integracoes.html/.js`, `metodologia.html`, `processos.html`, `gmv.html`, `index.html`, `promocoes.js`; `docs/ux/sistema-de-design.md § 2.2`; `docs/ux/inventario-*.json` (campo texto de `secoes`). Testes: nenhum muda; `teste-sistemas.mjs` passa (ordem igual); conferir `teste-promocoes-ui.mjs:134` se renomear aba de promoções.

**F1 — Shell com os 5 menus + deep link (1–2 dias).** `src/web/shell.js`: `G` com 5 grupos (regras A.0 itens 1–9), `INT` e «Configuração» do hambúrguer saem, `sync()` com `new URL`, `ctx` por `CLI`, abertura de `details` por `?sec=` no `DOMContentLoaded`. `src/web/cliente.js`: `desenhar()` (`:558`) depois de `mostrarAba` lê `sec`, `getElementById`, abre `closest('details')`, `scrollIntoView({ block: 'start' })` (~6 linhas; o `scroll-margin-top` de `tela-cliente.css:7` já compensa); **`mostrarAba` tolerante**: se `?sec=` aponta para bloco de outro painel, abre `closest('[data-painel]')` (protege os 27 links `aba=` quando blocos mudarem de aba na F6); **`abrirCliente` (`:86`) preserva `aba` e `sec` da URL no `pushState`** (hoje trocar de cliente pela busca derruba o consultor no Resumo). `relatorios-ciclo.js` lê `?rc=`; `produtos.js` lê `?visao=` (3 linhas cada). Configurar ganha 5 `<h3>` de grupo **sem reordenar** seções. `ui.css`: nada obrigatório (`.ps-abas-in` já rola). Spec § 2.1–2.3, `docs/ux/inventario-navegacao.md`, `inventario-cliente.json` (hook `?sec=`). Testes: `:108` intacto; `:299` intacto (nada de `s90` no shell); caso novo em `teste-shell-ui.mjs`: «`G` tem 5 grupos com os nomes de A.1 e todo `href` é `/` ou casa `app.get('<rota>'` em `src/server.js`». Custo visível aceito: no `/cliente` há a linha 2 do shell (submenus do menu ativo) **e** a barra de abas da página (todas as abas) — são coisas diferentes («o que este menu quer de mim» × «todas as seções do cliente») e a linha 2 não é sticky (spec § 2.3).

**F2 — «Quem sou» + ícone (i) (2 dias).** `shell.js`: `details.ps-quem` em `.ps-util` (select papel + input nome, `localStorage.ps_quem`, `PS.quem()`), DOM puro; `ui.css` com tokens. Valor padrão `PS.quem().nome` nos 12 arquivos com «Seu nome» (1 linha cada; validação de cargo continua no servidor). NOVO `src/web/ajuda.js` (`window.PSAjuda`, delegação `[data-ajuda]`, `dialog.dlg`); NOVO `config/ajuda.json` (os 3 exemplos de C + ML, Notion, n8n, Discord, custos ERP/planilha, canais, relatório Notion, alerta, catálogo, ficha, cadastro, executor, estoque, produto, NF, saúde, App ML, Sprint 90 — ≥ 20 verbetes); NOVO `src/rotas-ajuda.js` (`GET /api/ajuda/:id?cliente=`; estado `sem_leitura` até a F3) montado em `src/server.js`; `ui.css`: `.btn-ajuda::before` máscara SVG, `.dlg .passos-ajuda` vertical. Botões em: `cliente.js` (`.bloco-cab` após `.sis-papel` de `secFicha secRelatorio secPerfil secPerfilCliente secCatalogo cad-sec secDossie secRisco secContrato secCustosUpload secNotaFiscal secNotas secAvisos secExecutar secProdutos secRelatoriosCiclo secAlinhamentos secGatilhos`), `produtos.js` (`secSyncEstoque`), `integracoes.html` (`secLista secConfig secSaudeSistema secS90`), `integracoes.js` (`custosPainel`), `planos.html` (`secEscopo secRelatorios secAlertas secAvisosAuto secRisco`), `promocoes.js` (Plano, Custos), `metodologia.html` (`secParam`). Todos os 11 HTML ganham `<script src="/ajuda.js" defer>` (ordem dos `<script>` existentes pinada em `teste-shell-ui.mjs:196-197,216…` — acrescentar no fim, não reordenar). Testes: `COMPARTILHADOS` += `ajuda.js`; NOVO `scripts/teste-ajuda.mjs`; caso novo em `teste-shell-ui.mjs` («`window.PS` expõe `quem`»); inventários com hooks `[data-ajuda]`. Spec § 5.9 e § 6 (componente novo).

**F3 — `/estrutura` e o estado das chaves (2 dias).** NOVO `src/lib/estrutura-estado.js` (puro: recebe configs, `sync_estado`, presença de variáveis via `env.js` — nunca valores — e devolve linhas `{ id, nome, sistema, camada, escopo, estado, desde, por, falta[], ir, acao? }`) + `estrutura-estado-real.js`; NOVO `src/rotas-estrutura.js` (`GET /api/estrutura`, `GET /api/estrutura/:id`; os POSTs de Ligar/Desligar **não são novos**: a tela chama as rotas de banco que já existem); `rotas-ajuda.js` passa a ler o estado. NOVO `src/web/estrutura.html` + `estrutura.js` (12ª tela, `data-pagina="estrutura"`, esqueleto do shell, veredito = chaves ligadas/desligadas + incidentes, tabela ≤ 6 colunas, 0 primário, linhas «Freio geral» e «Freio do estoque» com botão (banco), «Endereços públicos», «Relógio do sistema», bloco Equipe `#secEquipe` só-leitura). `src/server.js`: `app.get('/estrutura')`; `scripts/teste-shell-ui.mjs`: `PAGINAS` += `['estrutura.html', 'estrutura', 'estrutura.js', 'estrutura']`; `scripts/teste-sistemas.mjs`: incluir `estrutura.html` em `TELAS`; NOVO `docs/ux/inventario-estrutura.json`; NOVO `scripts/teste-estrutura.mjs` (puro: fixtures de config → estados; chave JSON desligada → `camada: arquivo, reinicia: true`; chave de banco → `acao` com a rota; render sem hex/emoji e ≤ 6 `<th>`); `shell.js`: abas Estruturas e Equipe no Menu 5; NOVO `docs/estrutura.md`. Nada sai de `/integracoes` ainda (atalhos).

**F4 — Stepper do cliente e da carteira (2 dias).** NOVO `src/lib/progresso-cliente.js` (puro, 10 etapas) + `progresso-real.js` + `src/rotas-progresso.js` (`GET /api/cliente/progresso?cliente=`, `GET /api/progresso?escopo=`); NOVO `src/web/progresso.js` (compartilhado, `COMPARTILHADOS` += ); `cliente.js`: `<ol class="passos passos-estatico" id="progresso">` após `#kpis` e antes de `nav.abas` (`:390`); `#btnRevisar` passa a ser o botão da 1ª etapa atrasada; «Pronto para operar: N de 8» no topo de Configurar; `cliente.html`: `<script src="/progresso.js">` no fim; `index.html`: `<section class="bloco" id="secProgresso">` após `#proxima` + `app.js`: `PSProgresso.montar(el, { escopo })`; `estrutura.html`: stepper global no topo; `analistas.js`: coluna «cards `PS-` parados > 7 d»; `planos.js`: 3 KPIs novos no veredito; `ui.css`: `.passos-estatico{position:static}`, `ol.passos>li.atrasado{color:var(--verm)}`, `li.desligado`, `li.aguardando`. Inventários cliente/painel-executivo/estrutura; NOVO `scripts/teste-progresso.mjs`. Cada `li` com link `?aba=&sec=` e (i). `/` não entra em `teste-sistemas.mjs`, então o bloco novo não exige inventário de selos.

**F5 — `/fila` (Hoje) (2 dias).** NOVO `src/lib/fila.js` (puro: recebe listas, devolve até 5 blocos por `por`, aplica teto 10/família e «limiar errado») + `fila-real.js` + `src/rotas-fila.js` (`GET /api/fila?por=&quem=&etapa=`); NOVO `src/web/fila.html` + `fila.js` (13ª tela, veredito = 4 números, stepper da carteira via `progresso.js`, 1 primário = botão do 1º item; ações reusam rotas de escrita existentes — **nenhuma rota de escrita nova**); `server.js`: `app.get('/fila')`; `PAGINAS` += fila; NOVO `docs/ux/inventario-fila.json`; NOVO `scripts/teste-fila.mjs` (≤ 5 blocos por papel, teto 10, «limiar errado» acima, isolamento por cliente, sem papel = Líder); `shell.js`: botão **Hoje** no lugar do antigo `.ps-int`, `href` montado de `PS.quem()`; `#proxima` de `/` passa a apontar para `/fila`.

**F6 — Reagrupar as abas do `/cliente` (a fase cara; um commit; 3 dias).** `cliente.js:68` `ABAS` → `resumo · do-cliente "Pelo cliente" · plano · executar "Execução no ML" · anuncios · produtos "Produtos e estoque" · relatorios "Ciclos do negócio" · estrategia · empresa "Empresa" (NOVO) · configurar "Configurar cliente"` — os pares literais `teste-shell-ui.mjs:485,525` são reescritos. Mover blocos literais entre `data-painel` (`:395-485`): `secFinanceiro` (resumo → empresa), `secContrato secRisco secDossie secCustosUpload secNotaFiscal secNotas` (configurar → empresa, mantendo `secContrato < secCustosUpload < secNotaFiscal`; **reescrever `:449` e `:541`**, que fatiam a partir de `data-painel="configurar"`), `#formCustos` (secPlanoConta → dentro de `secCustosUpload`), `secFolha` (resumo → anuncios, depois de `secVendas` e antes de `secImpacto`; **reescrever `:165`**; `teste-ofertas-ui.mjs:150` `secAnuncios < secPrecos < secVendas` continua), Motor de decisão → estrategia renomeado «Previsão do mês» (**reescrever o fim da fatia `:218`** para `id="secAlinhamentos"`), `secGatilhos` → do-cliente e `secNotion` → configurar (`:354/:383` continuam verdes pela ordem do arquivo: resumo < do-cliente < configurar), Ferramenta (configurar → fim de anuncios), `#formMetas` (Motor → `secMetas` NOVO em configurar), chave «Coletar promoções» **fica** em `desenharPerfil` com o sub-rótulo (`teste-semanal-rotas.mjs:255`). Asserts que continuam verdes sem mexer (painel `empresa` fica antes de `configurar` no arquivo): `:149`, `:202`, `:249`, `:332`, `:354`, `:383`, `:432`, `:487`, `:509`, `:527`, `:553`, `teste-ofertas-ui.mjs:13`. Reordenar `selos_sistema.secoes` em `inventario-cliente.json`. Conferir os 27 links `aba=` fora de `cliente.js` e `executar.js:174` («vai para Produtos» → `?aba=produtos&sec=secSyncEstoque`). Os 9 `prompt()` dos dados fiscais (`nota-fiscal.js:57-61`) viram formulário no mesmo commit. Bloco «Custos do cliente» com as 3 linhas de estado. Resumo fica com 6 blocos + faixa. Spec § 7.2 e § 8.1 atualizados; `G` do shell troca os links interinos (`?aba=configurar&sec=` → `?aba=empresa&sec=`).

**F7 — Mudanças de casa fora do `/cliente` (opcionais, um commit cada, reversíveis).** (a) `#secSaudeSistema #secConfig` de `/integracoes` → `/estrutura` (reescrever `teste-shell-ui.mjs:286`; mover hooks entre `inventario-integracoes.json` e `inventario-estrutura.json`). (b) `#secS90 #s90Nova` → `/comercial` (idem `:286`; `:288,555` só exigem os ids, que continuam; `shell.js` segue sem `s90`, `:299`). (c) `#secRelatorios #secAlertas #secAvisosAuto` de `/planos` → `/estrutura#secComunicacao` (reescrever `:193,267,358,408,425,452`; ordem dos `<script>` de `planos.html` para `estrutura.html`; `planos.html` continua com 1 primário `#btnDistribuir`; montagem via `PSRelatorio.montarPlanos`, `PSAlertas`, `PSGatilhos.montarPlanos`, já em `COMPARTILHADOS`). (d) `#exParar` global → linha «Freio geral» em `/estrutura`; `executar.js:174,188` passa a mostrar estado + link. (e) `#btnEquipe #btnSyncPrest` → `/estrutura#secEquipe`.

**Ordem de valor para o David:** F0 + F1 (3 dias) já dão os 5 menus com tudo acessível e nomeado; F2 (2 dias) dá o (i) com texto e o Quem sou; F3 (2 dias) dá a tela que explica «estoque e DANFE» com estado real; F4 (2 dias) dá o progresso; F5 (2 dias) dá a fila do androide; F6–F7 limpam a casa.

---

## Decisões que só o David toma

1. ~~`urgente.na_hora_ligado`~~ — já decidido: fica `true` (David ligou o urgente de impacto em 14/10). A F0 corrige o comentário do config, `gatilhos.js:3` e `CLAUDE.md`.
2. **Hoje único no topo** (`/fila` por papel, proposto) em vez de «Hoje» como 1ª aba de cada menu?
3. **Analistas** em Execução (proposto) ou em Assessoria? **Promoções** em Consultor (proposto) ou em Execução?
4. **Contrato, Risco e Dossiê** em Empresa do cliente › Raio-X e contrato (proposto, F6) ou em Estrutura › Configurar cliente (como hoje)?
5. **Reescrever os asserts pinados na F6** (rótulos «Executar/Produtos/Relatórios» → «Execução no ML/Produtos e estoque/Ciclos do negócio», «Motor de decisão» → «Previsão do mês», ordem de Configurar `:449/:541`, `:165`)? Sem o sim, F6 não acontece e os submenus continuam apontando por `?sec=` para os blocos onde estão.
6. **Stepper com 10 etapas** (Cadastrado e Dados da empresa como degraus próprios, proposto) ou 8 (como a proposta original)?
7. **Papel no selo** por `<small>` ao lado (proposto, zero teste) ou mudar o `title` do selo (reescrever `teste-sistemas.mjs:91`)?

## Fase 0 recomendada (o menor passo que já muda a sensação de bagunça)

**Um dia, zero teste quebrado, só texto — a F0 da seção G:**

1. Renomear o que não está pinado (tabela E): «GMV» → «Faturamento», «Integrações» → «Conexões», «Processos» → «Como fazer», «Configuração técnica» → «App do Mercado Livre», «Nota fiscal»/«Notas» → «Nota fiscal: regras e certificado»/«Notas emitidas», «Perfil do relatório semanal»/«O que este cliente quer receber» → «Estilo do relatório PDF»/«Temas que o cliente pediu», os 4 «Avisos», os 4 «Custos», os 3 «Relatórios».
2. Pôr o papel ao lado de todo selo de sistema (`<small class="sis-papel">· financeiro</small>`) — o leigo passa a saber quem assina cada bloco sem abrir `/metodologia`.
3. Trocar o sub-texto de Produtos e de Sincronismo de estoque por «Ainda não decide nada — chave desligada, ver Estrutura › Estruturas» (sem «sombra/F2/F3/F6»).
4. Resolver as 4 divergências documento × arquivo (decisão 1 acima + nome do fluxo n8n + plist semanal + plist git), porque o (i) e a tela de Estruturas vão expô-las.

Logo depois, **F1 (2 dias)** é o que faz os 5 menus aparecerem no topo: só `src/web/shell.js` + ~15 linhas em `cliente.js`, `relatorios-ciclo.js` e `produtos.js`, sem reescrever nenhum teste existente.
