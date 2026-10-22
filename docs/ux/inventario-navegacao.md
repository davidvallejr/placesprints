# Place Sprints: mapa de navegação (F1 dos 5 menus, 21/10/2026)

Substitui o mapa de 09/2026 (que descrevia os 11 menus diferentes, os três sistemas visuais e a marca dividida — tudo isso acabou com o shell único). A fonte de verdade do topo é o `G` de `src/web/shell.js`; a especificação completa, com fases, é `docs/ux/arquitetura-5-menus.md`; as regras estão em `docs/ux/sistema-de-design.md` § 2.1–2.3.

## 1. O que o sistema serve hoje

**Telas do app (12, todas com o shell).** `/` (Painel executivo), `/gmv`, `/cliente`, `/promocoes`, `/planos`, `/analistas`, `/comercial`, `/resultados`, `/metodologia`, `/processos`, `/integracoes`, `/estrutura` (F3, 21/10/2026: Estruturas e Equipe, `docs/estrutura.md`). Rota nova só entra no topo quando o `app.get` existe (`/fila` na F5).

**Documentos (sem shell, nova aba):** `/relatorio(.pdf)`, `/semanal(.pdf)`, `/plano(.pdf)`, `/plano-conta(.pdf)`, `/matriz(.pdf)`, `/diagnostico-motor`, `/comercial/diagnostico(.pdf)`.

**Páginas públicas (sem shell):** `/diagnostico`, `/d/:token`, `/c/*`, `/meli/callback`, `/erp/callback`.

## 2. Os 5 menus (linha 1) e os submenus (linha 2)

| Menu | Pergunta | Submenu → destino hoje |
|---|---|---|
| **Assessoria** | Como vai a assessoria inteira? | Painel executivo `/` · Faturamento `/gmv` · O que funciona `/resultados` · Acerto do algoritmo `/metodologia` · Carteira em risco `/planos?sec=secRisco` · Comercial `/comercial` |
| **Consultor** | Neste cliente: o quê, por quê, como? | Resumo `/cliente?aba=resumo` · Plano `?aba=plano` · Anúncios `?aba=anuncios` · Estratégia `?aba=estrategia` · Promoções `/promocoes` · Como fazer `/processos` |
| **Execução** | Quem faz, e o sistema fez? | Distribuir `/planos` · Execução no ML `/cliente?aba=executar` · Pelo cliente `?aba=do-cliente` · Ofertas `?aba=anuncios&sec=secOfertas` · Analistas `/analistas` |
| **Empresa do cliente** | O negócio por trás da conta | Produtos e estoque `/cliente?aba=produtos` · Lucro do mês `?aba=produtos&visao=lucro` · Compras `?aba=relatorios&rc=ciclo_compras` · Preços `?aba=anuncios&sec=secPrecos` · Raio-X e contrato `?aba=resumo&sec=secFinanceiro` · Custos `?aba=configurar&sec=secCustosUpload` · Nota fiscal `?aba=configurar&sec=secNotaFiscal` · Ciclos do negócio `?aba=relatorios` |
| **Estrutura** | Está ligado, configurado, funcionando? | Estruturas `/estrutura` · Conexões `/integracoes` · Comunicação `/planos?sec=secAvisosAuto` · Configurar cliente `/cliente?aba=configurar` · Equipe `/estrutura?sec=secEquipe` · Regras do método `/metodologia?sec=secParam` |

Os destinos interinos de Empresa do cliente (Raio-X, Custos, Nota fiscal por `?sec=` dentro de Resumo/Configurar) mudam na F6, quando a aba `empresa` nasce no `/cliente`. Os links do cliente levam o `?cliente=` da URL atual.

## 3. Como o topo decide o que está aceso

- **Item ativo:** `data-pagina` do `<body>` bate com a página do item **e** todos os parâmetros do `href` (menos `cliente`) estão na URL. Empate → o item com mais parâmetros casados → o primeiro na ordem de `G`. Sem casamento completo, o 1º item da página (`/cliente` sem `?aba=` acende Consultor › Resumo). Exemplos: `/planos` → Execução › Distribuir; `/planos?sec=secRisco` → Assessoria › Carteira em risco; `/cliente?aba=produtos&visao=lucro` → Empresa do cliente › Lucro do mês.
- **Linha 2** = submenus do menu do item ativo; é reconstruída pelo `sync()` quando o item ativo muda de menu (todo `pushState/replaceState/popstate`). «Cliente: Nome» aparece à direita quando o item ativo carrega `?cliente=`.
- **`?sec=<id>`:** em página estática o shell abre o `details` e rola até o bloco no `DOMContentLoaded`; no `/cliente`, `desenhar()` faz isso depois de `mostrarAba`, que resolve o painel certo por `closest('[data-painel]')`. `?rc=` pré-seleciona o relatório do ciclo; `?visao=lucro` abre o chip Lucro.
- **Menu hambúrguer (< 900 px):** os 5 menus como títulos e todos os submenus como linhas; nada além do `G`.
- **Quem sou (F2, 21/10/2026):** `details.ps-quem` em `.ps-util`, antes da busca — papel (dono · líder · consultor · analista · CS · técnico) + nome, lembrados em `localStorage.ps_quem` (nome também em `ps_perfil_por`); `window.PS.quem()` é o valor padrão de todo «Seu nome». Não dá permissão: o cargo é validado no servidor. O lugar de **Hoje** (`/fila`) chega na F5.
- **Ícone (i) «Como fazer» (F2):** `button.btn-ajuda[data-ajuda]` ao lado do selo de sistema das estruturas configuráveis (texto em `config/ajuda.json`, `GET /api/ajuda/:id`, diálogo em `src/web/ajuda.js`); desde a F3 o estado é o real (`src/lib/estrutura-estado.js`), com os pré-requisitos globais resolvidos.
- **Estruturas (F3):** `/estrutura` lista uma linha por estrutura com estado real, Ligar/Desligar só nas chaves de banco (rotas existentes), «Onde» nas demais e o (i) por linha; `/estrutura?sec=secEquipe` é o bloco Equipe só-leitura.
- **Utilitários:** Buscar cliente (`/`), vaga vazia (Hoje na F5, Quem sou na F2) e o sino do `alerta.js`.
- **Pinos:** `['execucao', 'Painel executivo', '/']` e «nada de Sprint 90 no shell» (`teste-shell-ui.mjs`); o caso (20) confere os 5 nomes e que todo `href` casa um `app.get` de `src/server.js`.

## 4. O que ainda não existe (fases seguintes do doc dos 5 menus)

F4 stepper · F5 `/fila` (botão Hoje) · F6 reagrupar as abas do `/cliente` (aba `empresa`; os `?sec=` interinos trocam) · F7 mudanças de casa fora do `/cliente` (`#secSaudeSistema`, `#secConfig`, Comunicação de `/planos` para `/estrutura`). Feitas: F0 nomes · F1 shell · F2 Quem sou + (i) · F3 `/estrutura`.
- **Produto (21/10/2026):** `select#psProduto` («Todos · Performance · Prime») no começo de `.ps-util`, lembrado em `localStorage.ps_produto`; quando ≠ Todos acrescenta `?f=` (produto é igual a X) só nos links de `/` e `/resultados`, cujos painéis de filtro já leem `?f=` e têm o campo produto. Nenhuma API. Desenho: `docs/desenho-place-prime.md` § A.
