# Place Sprints: mapa de arquitetura da informação

Fiz tudo só lendo arquivos. Nenhum arquivo foi editado, criado ou apagado, o banco não foi copiado e o servidor não foi tocado. Fiz apenas GET nas 12 telas e todas responderam 200.

## 1. O que o sistema serve hoje

**Telas do app.** São 11 arquivos HTML em `src/web/`. A tela inicial sai do `express.static`; as outras são servidas por `sendFile` em `src/server.js:159-172`.

| Rota | Título hoje | Para que serve |
|---|---|---|
| `/` (index.html) | "Place Sprints — Painel Executivo" | Indicadores e gráficos do sprint (evolução, planejado × entregue, status, processo, semanas, riscos, lista de tarefas), filtros, botão Sincronizar com o Notion, atalhos para documentos |
| `/cliente` | "Plano do Cliente" (no topo aparece "Place2u · Planos") | Busca do cliente, depois uma página única muito longa: indicadores, Ficha, Perfil, Motor de decisão, Leitura estratégica, Mais vendidos, Plano da conta por anúncio, Retroalimentação, Antes e depois, Medição, Diagnóstico de anúncio, Plano de ação |
| `/planos` | "Planos de Ação" | Gera um plano por cliente e distribui no Notion por total, squad, consultor ou seleção |
| `/analistas` | "Gestão por Analista" | Volume, velocidade, atraso e resultado de cada pessoa |
| `/gmv` | "GMV e resultado associado ao trabalho" | GMV da carteira e ranking de quem está associado ao resultado |
| `/resultados` | "O que melhor funciona" | O que funciona por tipo de tarefa, por analista, em lançamentos, e o que as tarefas boas têm em comum |
| `/metodologia` | "Metodologia do algoritmo" | Previsto × realizado, regras e saúde de cada uma, limiares |
| `/processos` | "Processos e Tarefas" | Manual do Analista por canal |
| `/promocoes` | "Promoções por cliente" | 8 abas: Elegíveis, Participando, Relâmpago, Regras por SKU, Custos, Interrogatório, Plano, Auditoria |
| `/comercial` | "Comercial · Diagnóstico de Conta" | Cadastro do prospect, link de conexão e diagnóstico |
| `/integracoes` | "Central de Integrações" | Conexões com ML, Amazon e Shopee, custos por SKU, webhook da planilha |

**Documentos gerados.** São HTML montados no servidor, e cada um tem seu PDF feito pelo Chrome headless em `servirPdf`, `server.js:129`.

- `/relatorio` e `/relatorio.pdf`: relatório do sprint (`render-relatorio.js`).
- `/semanal` e `/semanal.pdf`: semanal do cliente. Com `?interno=1` vira a versão da equipe, com checklist e prontidão (`render-semanal.js`).
- `/plano` e `/plano.pdf`: plano de ação do cliente (`render-plano-cliente.js`, rota em `rotas-planos.js:625`).
- `/plano-conta` e `/plano-conta.pdf`: plano da conta por anúncio (`render-plano-conta.js`, `rotas-planos.js:573`).
- `/comercial/diagnostico` e o PDF: diagnóstico para o prospect (`render-diagnostico-comercial.js`, `rotas-planos.js:313`).
- `/matriz` e `/matriz.pdf`: Matriz Eisenhower por analista. É documento interno da liderança e não vai ao cliente.

**Páginas públicas (fora do app).** Ficam em `rotas-publicas.js` e no `server.js`:
- `/diagnostico`, a landing do prospect;
- `/d/:token`, o resultado e o pedido de exclusão dos dados;
- `/meli/callback`, que mostra as páginas de sucesso ou erro (`meli-paginas.js`);
- `/erp/callback`;
- `/` no domínio comercial, que redireciona para `/diagnostico`.

**Exportações (ações, não telas).** Quatro CSVs: `/api/planos/acoes.csv`, `/api/plano-conta/acoes.csv`, `/api/integracoes/links.csv` e `/api/promocoes/exportar.csv`.

## 2. Como cada tela liga às outras hoje

| Tela | Para onde aponta o menu do topo | Para onde aponta a logo |
|---|---|---|
| `/` | Botões com emoji: Semanal, Relatório do sprint, PDF, Cliente, Analistas, Planos de ação, Processos, Matriz (11 controles no total) | não é link |
| `/cliente` | Analistas, Comercial, GMV, Promoções, O que funciona, Integrações, Distribuição em massa, Processos, Painel executivo (9) | `/cliente` |
| `/planos` | Botões com emoji: Integrações, Visão por cliente, Analistas, "← Painel" | não é link |
| `/analistas` | Visão por cliente, Comercial, Distribuição, Painel executivo | `/analistas` |
| `/comercial` | Visão por cliente, Analistas, Distribuição. **Não tem volta para o Painel.** | `/comercial` |
| `/gmv` | Cliente, O que funciona, Integrações, Painel | `/cliente` |
| `/resultados` | Cliente, GMV, Integrações, Painel | `/cliente` |
| `/metodologia` | Cliente, GMV, O que funciona, Painel | `/cliente` |
| `/processos` | Cliente, Distribuição, Analistas, O que funciona, Painel | `/processos` (sem imagem da logo) |
| `/promocoes` | Plano do cliente, Integrações, GMV, O que funciona, Painel executivo | `/cliente` |
| `/integracoes` | Visão por cliente, Distribuição, Painel | `/cliente` |

**Problemas encontrados**

- **Telas quase escondidas.**
  - `/metodologia` não aparece em nenhum menu. O único acesso é um link no meio da seção "Plano da conta" (`cliente.js:227`).
  - `/promocoes` só aparece no menu de `/cliente`.
  - `/comercial` só aparece nos menus de `/analistas` e `/cliente`.
  - O Painel inicial não leva a Comercial, GMV, Promoções, O que funciona, Integrações nem Metodologia.
- **A mesma tela com nomes diferentes.**
  - Tela inicial: "Painel executivo", "Painel", "← Painel" e, no título, "Place Sprints".
  - `/cliente`: "Visão por cliente", "Cliente", "Plano do cliente", "🔎 Cliente". O próprio topo da tela diz "Planos", que se confunde com `/planos`.
  - `/planos`: "Distribuição", "Distribuição em massa", "🎯 Planos de ação".
  - `/resultados`: "O que funciona" no menu, "Resultados" no topo da tela, "O que melhor funciona" no título.
  - `/processos`: "Processos" no menu, "Processos e Tarefas" no título, "Como cada tarefa é feita" no cabeçalho da página.
- **Marca dividida.** As telas começam com "Place Sprints" (`/` e `/planos`) ou com "Place2u · X" (as demais). A logo leva a quatro destinos diferentes: `/cliente`, a própria tela, `/processos` ou nenhum.
- **Três sistemas visuais.**
  - `styles.css`, com topo em degradê azul (#1d4ed8) e botões com emoji: `/` e `/planos`.
  - Estilo colado dentro de cada página, laranja #ff6b1a sobre branco: `analistas`, `cliente`, `comercial`, `integracoes`, `processos`.
  - `ui.css` mais `ui-extra.css`: `gmv`, `metodologia`, `promocoes`, `resultados`.
  - Ou seja, a tela inicial, que é a que o sócio vê primeiro, é a única azul.
- **Emojis nos controles.** Aparecem em `index.html` (7), `planos.html` (3) e "🗺️ PlacePlan no Notion" em `cliente.js:165`. Também há emojis como marcadores dentro do conteúdo: `promocoes.js` (🤖 24 vezes, 👤 15 vezes), `app.js`, `cliente.js`, `analistas.js`, `alerta.js`.
- **O único elemento comum a todas as telas é o sino de avisos** (`alerta.js`, ligado nas 11). Ele já é o precedente para um topo único.

## 3. Telas agrupadas pela intenção de quem usa

| Intenção | Telas de hoje |
|---|---|
| Ver como está a operação e o resultado | `/` (execução do sprint) e `/gmv` (receita da carteira) |
| Trabalhar um cliente | `/cliente` e `/promocoes?cliente=` (promoções sempre são de um cliente) |
| Distribuir tarefas e gerir o time | `/planos` e `/analistas`; a `/matriz` sai de um analista |
| Comercial (pré-venda) | `/comercial` |
| Aprender e consultar o método | `/resultados`, `/metodologia`, `/processos` |
| Configurar | `/integracoes`, mais Sincronizar e o estado do Notion e do ML que hoje estão no topo do Painel |

## 4. Navegação principal proposta (5 itens mais área de utilidades)

Topo único em todas as telas: logo Place2u que leva sempre a `/`, os 5 itens abaixo, e à direita busca de cliente, estado da sincronização, Integrações e o sino. Sem emojis.

| Ordem | Item no menu | Rota principal | Abas internas | Telas absorvidas |
|---|---|---|---|---|
| 1 | **Visão geral** (tela inicial) | `/` | Execução, Receita | index.html e `/gmv` |
| 2 | **Clientes** | `/cliente` | Resumo, Plano, Anúncios, Promoções, Cadastro | cliente.html e `/promocoes` |
| 3 | **Time** | `/analistas` | Analistas, Distribuição | analistas.html e `/planos` |
| 4 | **Comercial** | `/comercial` | (nenhuma) | comercial.html |
| 5 | **Inteligência** | `/resultados` | O que funciona, Metodologia, Processos | resultados, metodologia, processos |
| Utilidades | **Integrações** (ícone discreto à direita) | `/integracoes` | (nenhuma) | integracoes.html, Sincronizar, estado do Notion e do ML |

**O que vai em cada aba de Clientes.** Isso desmonta a página longa de hoje:
- **Resumo:** indicadores, Motor de decisão, Leitura estratégica.
- **Plano:** Plano de ação, Plano da conta por anúncio, PlacePlan no Notion.
- **Anúncios:** Mais vendidos, Diagnóstico de anúncio, Antes e depois, Retroalimentação, Medição.
- **Promoções:** as 8 abas atuais viram uma segunda linha de abas.
- **Cadastro:** Ficha (equipe e contas), Perfil do relatório, Custos.

Os documentos do cliente (Plano, Plano da conta, Semanal cliente e interno, Relatório do sprint) ficam todos num único menu "Documentos" no cabeçalho do cliente. Hoje estão espalhados entre o Painel e duas seções da tela.

**Por que a tela inicial é Visão geral.** É a tela de aprovação e direção do sócio: execução e receita lado a lado, com os riscos no topo. Os filtros da tela atual continuam valendo. Os botões de Relatório, PDF, Semanal e Matriz saem do topo da Visão geral e vão para os contextos certos: Semanal e Relatório para o cliente, Matriz para a linha de cada analista em Time.

**Rotas antigas.** As URLs atuais podem continuar existindo como atalho para a aba correspondente (por exemplo `/gmv` abre Visão geral › Receita, `/planos` abre Time › Distribuição), assim nenhum link quebra. Os links profundos já usados (`/cliente?cliente=`, `/promocoes?cliente=&aba=`, `/integracoes?custos=`) devem continuar funcionando.

**Alternativa com 6 itens.** Se a distribuição for usada todo dia por várias pessoas, ela pode virar o 6º item ("Distribuição"). Recomendo 5 por ser mais limpo.

## 5. O que fica fora do redesenho do app

Estes têm identidade própria (editorial ou pública) e não devem herdar o topo nem o menu do app:

- **Documentos para o cliente:** `/relatorio` e PDF, `/semanal` e PDF (versão cliente), `/plano` e PDF, `/plano-conta` e PDF.
- **Documento para o prospect:** `/comercial/diagnostico` e PDF.
- **Documentos internos em formato de documento:** `/matriz` e PDF, `/semanal?interno=1`. Não vão ao cliente, mas são feitos para imprimir, então seguem como documento.
- **Páginas públicas para prospect e cliente:** `/diagnostico`, `/d/:token`, `/meli/callback`, `/erp/callback`.
- **Exportações CSV e arquivos estáticos:** os 4 CSVs, `/evidencias`, `/relatorios`.

Arquivos mais relevantes para isto:
- `/Users/davidvallejr/place-sprints/src/server.js`
- `/Users/davidvallejr/place-sprints/src/rotas-planos.js`
- `/Users/davidvallejr/place-sprints/src/rotas-publicas.js`
- `/Users/davidvallejr/place-sprints/src/web/*.html`
- `/Users/davidvallejr/place-sprints/src/web/cliente.js`
- `/Users/davidvallejr/place-sprints/src/web/app.js`
- `/Users/davidvallejr/place-sprints/src/web/alerta.js`
- `/Users/davidvallejr/place-sprints/src/web/styles.css`
- `/Users/davidvallejr/place-sprints/src/web/ui.css`
- `/Users/davidvallejr/place-sprints/src/lib/render-*.js`