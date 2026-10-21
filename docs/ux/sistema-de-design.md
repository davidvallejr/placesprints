# Place Sprints · Sistema de design e estrutura de layout (spec final)

Spec fechado pelo diretor de design a partir de 3 propostas e 3 juízes. Ele vale para as 11 telas internas: `/`, `/gmv`, `/cliente`, `/promocoes`, `/analistas`, `/planos`, `/comercial`, `/resultados`, `/metodologia`, `/processos`, `/integracoes`. Documentos para cliente ou prospect (relatório, semanal, plano, plano-conta, diagnóstico, matriz, PDFs) e páginas públicas (`/diagnostico`, `/d/:token`, `/meli/callback`, `/erp/callback`) ficam fora: não carregam `shell.js` nem `ui.css` e mantêm a identidade editorial já aprovada.

**Base escolhida:** proposta "executivo" (Tinta), com os enxertos pedidos pelos juízes e todos os vetos aplicados. Onde dois vetos se contradiziam, a decisão está registrada em 8.6.

| Proposta | Sócio | Operação | Engenharia | Soma |
|---|---|---|---|---|
| executivo | **8,5** (voto) | 7,5 | **8,0** (voto) | **24,0** |
| operacional | 7,5 | **8,0** (voto) | 7,5 | 23,0 |
| editorial | 6,0 | 4,5 | 5,0 | 15,5 |

---

## 1. Princípios

1. **Uma pergunta por tela, respondida no topo.** Logo abaixo do título vem uma frase-veredito, no máximo 4 números e uma única ação. Todo o resto desce.
2. **Um produto, um topo.** Um shell com 5 grupos e abas aponta para as 11 URLs atuais. Nenhuma rota muda e nenhuma página é fundida.
3. **Quase monocromático.** Tinta, cinzas quentes e branco. O laranja Place2u, escurecido para `#b34100`, só aparece para dizer "você está aqui" e "faça isto agora".
4. **Um botão primário por tela.** Ações secundárias ficam soltas, no máximo duas. O resto vai para o menu "⋯". Ação destrutiva só dentro de menu e sempre com confirmação.
5. **O número nunca é colorido.** O estado aparece como um ponto de 6px e uma palavra. Cor sozinha nunca carrega significado.
6. **Configuração, método, histórico e auditoria ficam recolhidos.** Nada técnico na primeira dobra.
7. **Sem enfeite.** Fonte do sistema, sentence case, sem emoji em controle, sem caixa alta com espaçamento, sem sombra em cartão.

---

## 2. Arquitetura de navegação

### 2.1 Grupos, ordem e abas

| Ordem | Grupo (linha 1) | O clique no grupo leva a | Abas da linha 2 → URL existente |
|---|---|---|---|
| 1 | **Visão geral** (tela inicial) | `/` | Execução → `/` · GMV → `/gmv` |
| 2 | **Clientes** | `/cliente` | Cliente → `/cliente` · Promoções → `/promocoes` (as duas e o link do grupo levam o `?cliente=` da URL atual) |
| 3 | **Time** | `/analistas` | Analistas → `/analistas` · Distribuição → `/planos` |
| 4 | **Comercial** | `/comercial` | sem linha 2 |
| 5 | **Método** | `/resultados` | O que funciona → `/resultados` · Algoritmo → `/metodologia` · Processos → `/processos` |

**Utilitários à direita, nesta ordem:**
1. **Buscar cliente** (atalho `/`). Em `/cliente` e `/promocoes` foca o `#q` que a página já tem. Nas outras telas abre um painel pequeno com um formulário de busca de verdade (GET para `/cliente?busca=termo`), sem combobox, sem sugestão ao vivo e sem `<datalist>`. Ver 4.4.
2. **Integrações**: link de texto. É configuração, então não ocupa vaga de grupo.
3. **Avisos**: o mesmo `#psSino` do `alerta.js`, só mudado de lugar.

**Tela inicial:** `/` (Visão geral › Execução). A marca "Place Sprints" leva sempre a `/`.

**Sincronizar** não entra no shell. Continua na tela Execução (`#btnSync`), como ação secundária, e o estado do Notion e do ML vira a meta-linha dessa tela. O `app.js` depende disso.

**Documentos** não recebem shell e abrem em nova aba, sempre a partir de um menu:
- "Relatórios" na Execução;
- "Documentos" no Cliente;
- linha do prospect no Comercial;
- detalhe do analista (Matriz).

**Links profundos que continuam iguais:** `/cliente?cliente=`, `/promocoes?cliente=&aba=`, `/integracoes?custos=` e os links das notificações (`/integracoes`, `/comercial`, `/cliente?cliente=`). O único parâmetro novo é `?aba=` no Cliente, e ele é opcional.

### 2.2 Nomes canônicos (um nome só por tela)

O rótulo da aba é igual ao início do `h1` e ao `<title>`, sempre no formato "Página · Place Sprints". O `alerta.js` continua prefixando "(n) ".

| URL | `data-pagina` no `<body>` | Grupo › aba | `h1` | `<title>` | Sinônimos que morrem |
|---|---|---|---|---|---|
| `/` | `execucao` | Visão geral › Execução | Execução do sprint | Execução · Place Sprints | Painel executivo, Painel, ← Painel |
| `/gmv` | `gmv` | Visão geral › Faturamento | Faturamento da carteira | Faturamento · Place Sprints | GMV, Receita, GMV e resultado associado |
| `/cliente` | `cliente` | Clientes › Cliente | "Qual cliente?" na busca; o nome do cliente quando aberto | Cliente · Place Sprints | Visão por cliente, Plano do cliente, Conta, Place2u · Planos |
| `/promocoes` | `promocoes` | Clientes › Promoções | "Promoções" na escolha; o nome do cliente quando aberto | Promoções · Place Sprints | Promoções por cliente |
| `/analistas` | `analistas` | Time › Analistas | Analistas | Analistas · Place Sprints | Gestão por Analista |
| `/planos` | `distribuicao` | Time › Distribuir ao Notion | Distribuir ao Notion | Distribuir ao Notion · Place Sprints | Distribuição, Distribuição de planos, Planos de ação, Distribuição em massa |
| `/comercial` | `comercial` | Comercial | Comercial | Comercial · Place Sprints | Comercial · Diagnóstico de Conta |
| `/resultados` | `o-que-funciona` | Método › O que funciona | O que funciona | O que funciona · Place Sprints | Resultados, O que melhor funciona |
| `/metodologia` | `algoritmo` | Método › Regras do método | Regras do método | Regras do método · Place Sprints | Algoritmo, Algoritmo do plano, Metodologia do algoritmo |
| `/processos` | `processos` | Método › Como fazer | Como fazer (Manual do Analista) | Como fazer · Place Sprints | Processos, Processos e Tarefas, Como cada tarefa é feita |
| `/integracoes` | `integracoes` | utilitário | Conexões | Conexões · Place Sprints | Integrações, Central de Integrações |

**F0 — Nomes (21/10/2026, `docs/ux/arquitetura-5-menus.md` § E e § G).** Só texto, nenhum id, rota ou assert mudou: rótulos do shell (Faturamento, Distribuir ao Notion, Regras do método, Como fazer, Conexões), `<title>`/`h1` acima, títulos de seção pela tabela E (Raio-X financeiro, Canais do cliente, Relatório no Notion: frequência e envio, Estilo do relatório PDF, Temas que o cliente pediu, Equipe e contas do cliente, Cadastro do CS, Custos: planilha do cliente, Nota fiscal: regras e certificado, Notas emitidas, Estoque por produto, Os 8 ciclos do negócio, Leitura da conta, O que a conta aprendeu, Combinados com o cliente, O que só o cliente faz, Saúde da conta no ML, Saúde do Place Sprints, App do Mercado Livre, abas de Promoções, Reler o Notion / Reler o Mercado Livre). Ficam até a F6 os literais pinados: «Painel executivo», as abas do `/cliente` (`Do cliente`, `Executar`, `Produtos`, `Relatórios`) e seus `h2` espelho, «Motor de decisão», e os `<h2>` de `teste-shell-ui.mjs:553`. Todo selo `.sis` ganhou um irmão `<small class="sis-papel">· papel</small>` (texto e `title` do selo intactos; `papel_curto` em `config/sistemas.json`).

**Como o usuário sabe onde está.** São 4 sinais, sempre os mesmos:
1. Grupo ativo em tinta 600 com filete inferior de 2px em `--laranja` (`#b34100`, 5,72:1). É o único uso do acento na navegação.
2. Aba ativa da linha 2 em tinta 600 com filete de 2px em `--tinta`.
3. O `h1` repete o nome da aba.
4. O `<title>`.

O `aria-current` acompanha os sinais 1 e 2. No grupo Clientes, à direita da linha 2, aparece "Cliente: Nome" (por `textContent`) quando a URL tem `?cliente=`.

### 2.3 Celular e larguras

| Largura | Comportamento |
|---|---|
| ≥ 1100px | Shell completo |
| 900–1099px | "Buscar cliente" vira só ícone (32×32, nome acessível por `aria-label`). O rótulo "Avisos" some e fica o ícone do sino com o contador. |
| < 900px | Grupos e Integrações somem. Aparece "Menu" (40px), que abre uma lista de largura total sob o topo: grupos como títulos 12/500 cinza, páginas como linhas de 44px, Integrações no fim, rolagem própria. O painel da busca também vira largura total, fixo sob o topo. |
| Todas | O topo tem sempre 56px. A linha 2 (44px) continua visível e rola dentro dela mesma, nunca na página. A linha 2 não é sticky. Todo sticky de página usa `top: var(--shell-h)`. |

---

## 3. Tokens

### 3.1 Regras que o teste 58 impõe (não negociáveis)

- O `tok()` do `scripts/teste-promocoes-ui.mjs` varre o `ui.css` **inteiro** atrás de `--nome:#hex` (6 dígitos), e a última ocorrência vence. Por isso:
  - todo token de cor fica em hex literal de 6 dígitos, definido **uma única vez**, no 1º e único `:root{}` do `ui.css`;
  - nenhum `@media`, tema escuro, componente ou **comentário** do `ui.css` pode conter `--nome:#hex`;
  - nenhum token de cor é escrito com `var()`.
- O `promocoes.css` mantém o bloco escrito exatamente assim, sem espaço antes da chave e sem `}` no comentário:
  ```css
  :root{/* tokens vêm de ui.css; bloco exigido por teste-promocoes-ui caso 58 */}
  ```
  Os overrides antigos (`#b34100`, `#006b04`, `#666666`, `#1d4ed8`) saem, porque a paleta global já passa em todos os pares.
- **Um nome por cor.** Não existem aliases semânticos em `var()` (`--texto`, `--acento`, `--sucesso`…). Os dois únicos nomes repetidos (`--azul-claro`, `--azul-escuro`) são legados obrigatórios: existem para CSS e JS antigos, e código novo não os usa.
- Modo escuro fica fora do escopo. Se vier, vai num arquivo separado.
- Só tokens sem cor podem mudar em media query (ex.: `--gutter`).

### 3.2 Bloco `:root` completo (colar no topo de `src/web/ui.css`)

```css
:root{
  /* texto e superficies */
  --tinta:#1c1917;
  --tinta-forte:#0c0a09;
  --cinza:#57534e;
  --cinza-claro:#716a65;
  --borda:#e7e5e4;
  --borda-forte:#d6d3d1;
  --borda-campo:#8a8480;
  --fundo:#fafaf9;
  --superficie:#ffffff;
  --fundo-suave:#f5f5f4;
  /* acento unico */
  --laranja:#b34100;
  --laranja-escuro:#8f3400;
  --laranja-suave:#fbf1ea;
  /* estados: texto e fundo suave */
  --verde:#1d6b3a;
  --verde-suave:#eaf4ec;
  --ambar:#855400;
  --ambar-suave:#fbf3e1;
  --verm:#b42318;
  --verm-suave:#fcefed;
  --azul:#1d4ed8;
  --azul-suave:#eef3fd;
  --roxo:#5b3fb5;
  --roxo-suave:#f2effb;
  /* legado obrigatorio: so CSS e JS antigos; codigo novo nao usa */
  --azul-claro:#eef3fd;
  --azul-escuro:#1e3a8a;
  /* veu do dialogo */
  --veu:rgba(28,25,23,.4);
  /* tipografia: fonte do sistema, sem webfont */
  --fonte:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
  --fonte-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --t-12:12px; --t-13:13px; --t-14:14px; --t-16:16px; --t-20:20px; --t-24:24px; --t-28:28px;
  /* espaco, base 4 */
  --e-1:4px; --e-2:8px; --e-3:12px; --e-4:16px; --e-5:24px; --e-6:32px; --e-7:48px; --e-8:64px;
  /* forma: 3 raios, 2 sombras */
  --raio-p:6px;
  --raio:10px;
  --raio-pilula:999px;
  --sombra:0 1px 2px rgba(28,25,23,.05);
  --sombra-alta:0 2px 6px rgba(28,25,23,.06),0 12px 32px rgba(28,25,23,.12);
  /* layout */
  --largura:1200px; --largura-texto:72ch; --gutter:32px; --shell-h:56px;
  --z-shell:30; --z-menu:40; --z-gaveta:45; --z-toast:50;
}
@media (max-width:767px){:root{--gutter:16px}}
```

**Papéis.** Cada papel usa exatamente estes tokens:

| Papel | Token |
|---|---|
| Texto principal, botão primário, chip e aba ligados | `--tinta` |
| Hover do primário | `--tinta-forte` |
| Texto secundário, rótulos, cabeçalho de tabela | `--cinza` |
| Texto terciário (dicas, datas, rodapé, "—") | `--cinza-claro` |
| Divisórias e contornos de cartão e tabela | `--borda` |
| Contorno de botão secundário, hover de cartão | `--borda-forte` |
| Contorno de input, select, checkbox (WCAG 1.4.11) | `--borda-campo` |
| Fundo da página | `--fundo` |
| Cartões, tabelas, menus, campos, shell, texto sobre fundo escuro | `--superficie` |
| Hover, chip neutro, skeleton | `--fundo-suave` |
| Acento único (lista fechada em 3.5) | `--laranja` |
| Acento pressionado; texto sobre `--laranja-suave` | `--laranja-escuro` |
| Fundo raro de destaque (linha marcada) | `--laranja-suave` |
| Sucesso / atenção / perigo / info / "em validação" | `--verde`, `--ambar`, `--verm`, `--azul`, `--roxo` (+ `-suave`) |

O âmbar é ocre (`#855400`) para não ser confundido com o acento laranja.

### 3.3 Mapa dos 22 tokens legados (valor antigo → novo)

| Token | Antes | Agora | Observação |
|---|---|---|---|
| `--laranja` | #ff6b1a | **#b34100** | Branco por cima passa de 2,85 para 5,72. O `#ff6b1a` da marca continua só na logo (`/logo`). |
| `--laranja-escuro` | #e55600 / #b34100 (promo) | #8f3400 | |
| `--tinta` | #222 / #0f172a | #1c1917 | |
| `--cinza` | #717171 / #64748b / #666 | #57534e | |
| `--cinza-claro` | #b0b0b0 (2,17:1) | #716a65 | Passa a ser texto válido (≥ 4,87 em todo fundo claro) |
| `--borda` | #ebebeb / #e2e8f0 | #e7e5e4 | |
| `--fundo` | #fff / #f1f5f9 | #fafaf9 | Fundo da página. As superfícies usam `--superficie`. O `planos.js:61` espera cinza e continua levemente cinza. |
| `--fundo-suave` | #f7f7f7 | #f5f5f4 | |
| `--verde` / `--verde-suave` | #008a05, #047857, #006b04 / #e8f6e9 | #1d6b3a / #eaf4ec | |
| `--ambar` / `--ambar-suave` | #b45309 / #fef3e2 | #855400 / #fbf3e1 | |
| `--verm` / `--verm-suave` | #c13515, #b91c1c / #fdeae3 | #b42318 / #fcefed | |
| `--azul` / `--azul-suave` | #2563eb, #1d4ed8 / #e8f0fe | #1d4ed8 / #eef3fd | |
| `--azul-claro` | #dbeafe | #eef3fd | Legado |
| `--azul-escuro` | #1e3a8a | #1e3a8a | Legado |
| `--roxo` | #6d28d9 | #5b3fb5 | Só "em validação" |
| `--sombra` | várias | `0 1px 2px rgba(28,25,23,.05)` | |
| `--sombra-alta` | várias | `0 2px 6px …, 0 12px 32px …` | |
| `--raio` | 16px / 14px | 10px | |

**Hex fixos que viram token** (fase 1 no CSS; fase 2 no JS):

| Onde | Antes | Depois |
|---|---|---|
| ui.css, promocoes.css | `#fff1e8` | `var(--laranja-suave)` |
| ui.css, promocoes.css | `#444` | `var(--tinta)` |
| ui.css | `#efefef` | `var(--borda)` |
| promocoes.css | `#f6fbf6` (linha marcada) | `var(--laranja-suave)` |
| promocoes.css | `#bfe3c0`, `#f3c3b6` (bordas do `.pr-inv`) | `var(--borda)` |
| planos.html (inline) | `#fffbeb` / `#fde68a` | `.aviso` |
| planos.js | `#b45309`, `#b91c1c` | `var(--ambar)`, `var(--verm)` |
| gmv.js | `#c9c2b8`, `#8ea3b8` | `var(--borda-forte)`, `var(--borda-campo)` |
| ficha.js (string do `<style>`) | `#e8f6e9/#0a6b1a`, `#fdeae3/#b3260e`, `#fffbeb/#92400e`; `button.b` azul | pares `--*-suave/--*`; `button.b` em `--tinta` |
| app.js | `CORES` e `corStatus` | lidos dos tokens com `getComputedStyle(document.documentElement).getPropertyValue('--x').trim()` (ver 7.1) |
| alerta.js | todos | **não é editado**; sobreposto por CSS (4.5) |

### 3.4 Contraste (mesma fórmula do teste 58)

**Os 16 pares que o teste confere** (15 pares mais o branco sobre `--verm`). Todos ≥ 4,5:1; o menor é 5,80.

| Texto | Fundo | Razão |
|---|---|---|
| `--laranja-escuro` #8f3400 | #fff1e8 | 7,14 |
| `--laranja-escuro` | #ffffff | 7,90 |
| `--verde` #1d6b3a | `--verde-suave` #eaf4ec | 5,80 |
| `--verde` | #ffffff | 6,53 |
| `--verde` | #f6fbf6 | 6,23 |
| `--cinza` #57534e | #ffffff | 7,63 |
| `--cinza` | `--fundo-suave` #f5f5f4 | 6,99 |
| `--cinza` | `--verm-suave` #fcefed | 6,80 |
| `--cinza` | `--ambar-suave` #fbf3e1 | 6,91 |
| `--cinza` | #f6fbf6 | 7,28 |
| `--azul` #1d4ed8 | `--azul-suave` #eef3fd | 6,02 |
| `--ambar` #855400 | `--ambar-suave` | 5,82 |
| `--ambar` | #ffffff | 6,43 |
| `--verm` #b42318 | `--verm-suave` | 5,86 |
| `--verm` | #ffffff | 6,57 |
| #ffffff (toast de erro) | `--verm` | 6,57 |

**Outros pares que o desenho usa** (texto ≥ 4,5; não-texto ≥ 3):

| Par | Razão | Uso |
|---|---|---|
| `--tinta` / `--superficie` | 17,49 | texto em cartão |
| `--tinta` / `--fundo` | 16,74 | texto na página |
| `--tinta` / `--fundo-suave` | 16,03 | hover |
| `--superficie` / `--tinta` | 17,49 | botão primário, toast |
| `--cinza` / `--fundo` | 7,30 | meta, `.sub` |
| `--cinza` / `--laranja-suave`, `--azul-suave`, `--verde-suave` | 6,86 / 6,86 / 6,78 | texto secundário em linha marcada e avisos |
| `--cinza-claro` / `--superficie` | 5,31 | dica, rodapé, "—" |
| `--cinza-claro` / `--fundo` | 5,09 | rodapé |
| `--cinza-claro` / `--fundo-suave` | 4,87 | dica em hover |
| `--cinza-claro` / `--laranja-suave` | 4,78 | data em linha marcada |
| `--laranja` / `--superficie` | 5,72 | rótulo "Próxima ação", filete do grupo, anel de foco |
| `--laranja` / `--fundo` | 5,47 | anel de foco na página |
| `--laranja` / `--fundo-suave` | 5,24 | anel de foco sobre hover |
| `--superficie` / `--laranja` | 5,72 | contador do sino (hoje 2,85) |
| `--laranja-escuro` / `--laranja-suave` | 7,10 | texto sobre destaque |
| `--tinta` / `--ambar-suave`, `--verm-suave`, `--verde-suave`, `--laranja-suave` | 15,83 / 15,58 / 15,53 / 15,72 | texto de aviso, linha marcada |
| `--verde` / `--verm` / `--ambar` sobre `--fundo` | 6,25 / 6,29 / 6,16 | `.pos`, `.neg`, `.acao-*` |
| `--azul` / `--superficie` | 6,70 | `.st-distribuida` |
| `--roxo` / `--roxo-suave` | 6,56 | `.t-validacao` |
| `--superficie` / `--verde`, `--ambar`, `--cinza` | 6,53 / 6,43 / 7,63 | `.ac-badge` sólido |
| `--borda-campo` / `--superficie` (não-texto) | 3,69 | contorno de campo |
| `--borda-campo` / `--fundo` (não-texto) | 3,53 | série "Ritmo ideal" |
| `--borda-campo` / `--fundo-suave` (não-texto) | 3,38 | campo sobre hover |

**Proibidos:** `#ff6b1a` em qualquer texto, indicador ou gráfico (2,85:1 sobre branco); branco sobre `#ff6b1a`; `--borda`/`--borda-forte` como único indicador de estado.

### 3.5 Uso do acento `--laranja` (lista fechada; no máximo 2 ocorrências visíveis acima da dobra)

1. Filete do grupo ativo do shell (e de Integrações quando ativa).
2. Anel de foco.
3. Contador do sino.
4. Filete esquerdo e rótulo da faixa "Próxima ação".
5. Série principal dos gráficos (Concluído no burnup, Associado na ponte do GMV).

**Nunca em:** fundo de botão, valor de KPI, título, badge, tom de status (`.t-andamento` é azul), link de texto.

### 3.6 Tipografia

Fonte do sistema (`--fonte`), sem webfont e sem CDN de fonte. Pesos permitidos: **400, 500 e 600**; o 700 e o 800 deixam de existir (`b`, `strong` = 600). Tudo em sentence case: acaba o uppercase com tracking. Nada abaixo de 12px.

| Papel | Tamanho/peso | Detalhes |
|---|---|---|
| Veredito | 20/500, lh 1,35 | tinta; os números em `<b>` 600; máx. 60ch |
| `h1` da página | 24/600, lh 1,25 | letter-spacing −0,015em |
| `h2` de bloco | 16/600 | |
| `h3` de cartão | 14/600 | |
| Corpo | 14/400, lh 1,5 | |
| Secundário (`.sub`, `.pg-meta`) | 13/400 | `--cinza` |
| Rótulo de KPI, de campo e cabeçalho de tabela | 12/500 | `--cinza` |
| Valor de KPI | 28/600 | letter-spacing −0,02em, `font-variant-numeric: tabular-nums` |
| Badge, contador, kbd | 12/500 | |
| Número em tabela | 13/400 | tabular-nums, alinhado à direita |
| Código cru (MLB, ids) | 12/400 | `--fonte-mono` |

### 3.7 Espaço, raios, sombras, container

- **Espaço:** base 4 (`--e-1` a `--e-8`).
  - 4 a 8px dentro de componentes;
  - 12 a 16px entre itens de um cartão;
  - 24px entre cabeçalho e conteúdo;
  - 32px entre seções;
  - 64px antes do rodapé.
  - Literais só em múltiplos de 4 (ex.: padding de KPI de 16px por 20px).
- **Raios (3):**
  - `--raio-p` 6px: botão, campo, item de menu, aviso, toast, seg, kbd;
  - `--raio` 10px: cartão, tabela, faixa de KPIs, menu, diálogo, gaveta;
  - `--raio-pilula`: só badges e chips de filtro.
- **Sombras (2):**
  - `--sombra`, só no item ligado do `.seg`;
  - `--sombra-alta`, só no que flutua (menu, painel de busca, diálogo, gaveta, toast).
  - Cartão não tem sombra: a borda faz o trabalho.
- **Container:** `.pg{max-width:var(--largura)}` com `--gutter` de 32px (16px abaixo de 768px). Texto corrido com no máximo `--largura-texto`. Acabam as 7 larguras de hoje.

---

## 4. Shell

### 4.1 Arquivos

- **Novo:** `src/web/shell.js`. Cerca de 100 linhas, DOM puro, **sem `innerHTML`**, sem dependência e sem chamar API.
- **Regras `.ps-*`** no `ui.css` (o shell pinta antes do JS rodar porque o CSS está no `<head>`).
- `alerta.js` **não é editado**.

**Em cada uma das 11 páginas, o mesmo esqueleto:**

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Execução · Place Sprints</title>
<link rel="stylesheet" href="/ui.css">
<!-- + /acomp.css no cliente; + /promocoes.css nas promoções; + os 2 scripts do Chart.js (CDN) no index -->
</head>
<body data-pagina="execucao">
<header class="ps-shell" id="psShell"></header>
<script src="/shell.js"></script>   <!-- síncrono, logo após o placeholder: o topo nasce antes da 1ª pintura -->
<main class="pg">…</main>
<footer class="pg-rodape">Fonte: Notion · indicadores calculados por código</footer>
<script src="app.js"></script>      <!-- inalterado, inclusive o caminho relativo -->
<script src="/alerta.js" defer></script>
</body>
</html>
```

**Saem das 11 páginas:**
- `styles.css` e `ui-extra.css` (fundido no `ui.css`);
- todos os `<style>` inline (cliente, analistas, comercial, integracoes, processos, planos);
- os `<header>` próprios (`.topo`, `.marca`, `.header-links`, `.acoes`).

O `ui.css` não tem estilo global em `header`, `.topo`, `.marca` nem `.mini`. Esses seletores vazavam para o painel do sino.

### 4.2 HTML que o `shell.js` produz

```html
<header class="ps-shell" id="psShell">
  <a class="ps-pular" href="#">Pular para o conteúdo</a>
  <div class="ps-barra">
    <a class="ps-marca" href="/"><img src="/logo" alt="" width="24" height="24"><span>Place Sprints</span></a>
    <nav class="ps-grupos" aria-label="Principal">
      <a href="/" data-base="/" aria-current="page">Visão geral</a>
      <a href="/cliente" data-base="/cliente">Clientes</a>
      <a href="/analistas" data-base="/analistas">Time</a>
      <a href="/comercial" data-base="/comercial">Comercial</a>
      <a href="/resultados" data-base="/resultados">Método</a>
    </nav>
    <div class="ps-util">
      <details class="ps-busca">
        <summary class="ps-busca-botao" aria-label="Buscar cliente (atalho /)"><span class="ps-rot">Buscar cliente</span><kbd>/</kbd></summary>
        <form class="ps-busca-painel" action="/cliente" method="get" role="search">
          <label for="psBusca">Nome ou CNPJ</label>
          <input id="psBusca" name="busca" type="search" required minlength="3" autocomplete="off">
          <button class="ps-btn" type="submit">Buscar</button>
        </form>
      </details>
      <a class="ps-int" href="/integracoes" data-base="/integracoes">Integrações</a>
      <span class="ps-sino-slot"><!-- o #psSino do alerta.js é movido para cá --></span>
      <details class="ps-menu">
        <summary class="ps-menu-botao">Menu</summary>
        <nav class="ps-menu-lista" aria-label="Todas as páginas">
          <p class="ps-menu-grupo">Visão geral</p><a href="/" aria-current="page">Execução</a><a href="/gmv">GMV</a>
          <p class="ps-menu-grupo">Clientes</p><a href="/cliente">Cliente</a><a href="/promocoes">Promoções</a>
          <p class="ps-menu-grupo">Time</p><a href="/analistas">Analistas</a><a href="/planos">Distribuição</a>
          <p class="ps-menu-grupo">Comercial</p><a href="/comercial">Comercial</a>
          <p class="ps-menu-grupo">Método</p><a href="/resultados">O que funciona</a><a href="/metodologia">Algoritmo</a><a href="/processos">Processos</a>
          <p class="ps-menu-grupo">Configuração</p><a href="/integracoes">Integrações</a>
        </nav>
      </details>
    </div>
  </div>
</header>
<!-- irmã do header (header.after), NÃO sticky; só existe quando o grupo tem 2 ou mais abas -->
<nav class="ps-abas" aria-label="Páginas de Visão geral">
  <div class="ps-abas-in">
    <a href="/" data-base="/" aria-current="page">Execução</a><a href="/gmv" data-base="/gmv">GMV</a>
    <span class="ps-ctx"><!-- só no grupo Clientes: "Cliente: Nome" --></span>
  </div>
</nav>
```

**Estado ativo.** Vem do `data-pagina` do `<body>` (2.2), nunca do pathname.
- Aba ativa e link de menu da página atual: `aria-current="page"`.
- Grupo ativo: `aria-current="page"` quando a página é a 1ª aba do grupo; `aria-current="true"` nas outras abas.
- Integrações ativa: `aria-current="page"` no `.ps-int`, e nenhum grupo marcado.

### 4.3 `shell.js`: implementação de referência

```js
// /shell.js · topo único das 11 telas internas. DOM puro, nada de innerHTML, nenhuma API.
(() => {
  const topo = document.getElementById('psShell'); if (!topo) return   // documentos e páginas públicas não têm o placeholder
  const G = [
    ['Visão geral', [['execucao', 'Execução', '/'], ['gmv', 'GMV', '/gmv']]],
    ['Clientes', [['cliente', 'Cliente', '/cliente'], ['promocoes', 'Promoções', '/promocoes']]],
    ['Time', [['analistas', 'Analistas', '/analistas'], ['distribuicao', 'Distribuição', '/planos']]],
    ['Comercial', [['comercial', 'Comercial', '/comercial']]],
    ['Método', [['o-que-funciona', 'O que funciona', '/resultados'], ['algoritmo', 'Algoritmo', '/metodologia'], ['processos', 'Processos', '/processos']]],
  ]
  const INT = ['integracoes', 'Integrações', '/integracoes']
  const CLI = new Set(['/cliente', '/promocoes'])                      // links que carregam ?cliente=
  const pag = document.body.dataset.pagina
  const grupo = G.find(g => g[1].some(a => a[0] === pag))
  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos); return e }
  const attr = (e, o) => { for (const k in o) e.setAttribute(k, o[k]); return e }
  const link = ([id, rotulo, href], props = {}) => { const a = el('a', { href, textContent: rotulo, ...props }); a.dataset.base = href; if (id === pag) a.setAttribute('aria-current', 'page'); return a }
  const linkGrupo = ([nome, abas]) => { const a = el('a', { href: abas[0][2], textContent: nome }); a.dataset.base = abas[0][2]; if (grupo?.[0] === nome) a.setAttribute('aria-current', abas[0][0] === pag ? 'page' : 'true'); return a }

  // marca, grupos, utilitários
  const img = el('img', { src: '/logo', alt: '', width: 24, height: 24 }); img.onerror = () => img.remove()
  const marca = el('a', { className: 'ps-marca', href: '/' }, img, el('span', { textContent: 'Place Sprints' }))
  const grupos = attr(el('nav', { className: 'ps-grupos' }, ...G.map(linkGrupo)), { 'aria-label': 'Principal' })
  const inp = el('input', { id: 'psBusca', name: 'busca', type: 'search', required: true, minLength: 3, autocomplete: 'off' })
  const resumo = attr(el('summary', { className: 'ps-busca-botao' }, el('span', { className: 'ps-rot', textContent: 'Buscar cliente' }), el('kbd', { textContent: '/' })), { 'aria-label': 'Buscar cliente (atalho /)' })
  const form = attr(el('form', { className: 'ps-busca-painel', action: '/cliente', method: 'get' }, el('label', { htmlFor: 'psBusca', textContent: 'Nome ou CNPJ' }), inp, el('button', { className: 'ps-btn', type: 'submit', textContent: 'Buscar' })), { role: 'search' })
  const busca = el('details', { className: 'ps-busca' }, resumo, form)
  const qDaPagina = () => { const q = document.getElementById('q'); return q && q.offsetParent ? q : null }   // #q de /cliente e /promocoes, se visível
  const abrirBusca = () => { const q = qDaPagina(); if (q) return q.focus(); busca.open = true; inp.focus() }
  resumo.addEventListener('click', e => { const q = qDaPagina(); if (q) { e.preventDefault(); q.focus() } })
  busca.addEventListener('toggle', () => { if (busca.open) inp.focus() })
  const slot = el('span', { className: 'ps-sino-slot' })
  const lista = attr(el('nav', { className: 'ps-menu-lista' }), { 'aria-label': 'Todas as páginas' })
  for (const [nome, abas] of G) lista.append(el('p', { className: 'ps-menu-grupo', textContent: nome }), ...abas.map(a => link(a)))
  lista.append(el('p', { className: 'ps-menu-grupo', textContent: 'Configuração' }), link(INT))
  const menu = el('details', { className: 'ps-menu' }, el('summary', { className: 'ps-menu-botao', textContent: 'Menu' }), lista)
  const pular = el('a', { className: 'ps-pular', href: '#', textContent: 'Pular para o conteúdo' })
  pular.onclick = e => { const m = document.querySelector('main'); if (m) { e.preventDefault(); m.tabIndex = -1; m.focus() } }
  topo.append(pular, el('div', { className: 'ps-barra' }, marca, grupos, el('div', { className: 'ps-util' }, busca, link(INT, { className: 'ps-int' }), slot, menu)))

  // linha 2: abas do grupo (só com 2+ páginas) + contexto do cliente
  let ctx = null
  if (grupo && grupo[1].length > 1) {
    if (grupo[0] === 'Clientes') ctx = el('span', { className: 'ps-ctx' })
    topo.after(attr(el('nav', { className: 'ps-abas' }, el('div', { className: 'ps-abas-in' }, ...grupo[1].map(a => link(a)), ...(ctx ? [ctx] : []))), { 'aria-label': 'Páginas de ' + grupo[0] }))
  }

  // ?cliente= é lido da URL ATUAL sempre que ela muda (cliente.js e promocoes.js usam pushState)
  const sync = () => {
    const c = new URLSearchParams(location.search).get('cliente')
    for (const a of document.querySelectorAll('.ps-shell a[data-base], .ps-abas a[data-base]')) if (CLI.has(a.dataset.base)) a.href = a.dataset.base + (c ? '?cliente=' + encodeURIComponent(c) : '')
    if (ctx) ctx.textContent = c ? 'Cliente: ' + c : ''
  }
  for (const m of ['pushState', 'replaceState']) { const f = history[m]; history[m] = function (...a) { const r = f.apply(this, a); sync(); return r } }
  addEventListener('popstate', sync); sync()

  // sino: move o nó do alerta.js assim que ele entra no body (microtarefa, antes da pintura; os listeners vão junto)
  const moverSino = () => { const s = document.getElementById('psSino'); if (s) slot.append(s); return !!s }
  if (!moverSino()) { const mo = new MutationObserver(() => { if (moverSino()) mo.disconnect() }); mo.observe(document.body, { childList: true }) }

  // menus: clique fora ou Esc fecha qualquer details aberto (vale para os menus de todas as telas)
  const fechar = alvo => document.querySelectorAll('details.menu[open], details.ps-menu[open], details.ps-busca[open]').forEach(d => { if (!alvo || !d.contains(alvo)) d.open = false })
  document.addEventListener('click', e => fechar(e.target))
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const d = document.activeElement?.closest?.('details[open]'); fechar(null); d?.querySelector('summary')?.focus(); return }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.('input,textarea,select,[contenteditable="true"]')) { e.preventDefault(); abrirBusca() }
  })

  // toast e confirmação únicos (substituem alert/confirm/prompt aos poucos; nunca no promocoes.js sem fallback)
  const regiao = (id, erro) => document.getElementById(id) || document.body.appendChild(attr(el('div', { id, className: erro ? 'toast erro' : 'toast' }), erro ? { role: 'alert' } : { role: 'status', 'aria-live': 'polite' }))
  let tToast
  window.PS = {
    toast(texto, tipo = 'ok') { const r = regiao(tipo === 'erro' ? 'psMsgErro' : 'psMsg', tipo === 'erro'); r.textContent = texto; clearTimeout(tToast); tToast = setTimeout(() => { r.textContent = '' }, 6000) },
    confirmar({ titulo, texto = '', rotuloOk = 'Confirmar', perigo = false }) {
      const d = el('dialog', { className: 'dlg' }, el('form', { method: 'dialog' }, el('h2', { textContent: titulo }), el('p', { textContent: texto }),
        el('div', { className: 'dlg-rodape' }, el('button', { className: 'ps-btn', value: 'nao', textContent: 'Cancelar' }), el('button', { className: perigo ? 'ps-btn ps-perigo' : 'ps-btn ps-primario', value: 'sim', textContent: rotuloOk }))))
      document.body.append(d); d.showModal()
      return new Promise(ok => d.addEventListener('close', () => { ok(d.returnValue === 'sim'); d.remove() }, { once: true }))
    },
  }

  document.addEventListener('DOMContentLoaded', () => {
    regiao('psMsg'); regiao('psMsgErro', true)                          // regiões vivas existem antes da 1ª mensagem
    const b = new URLSearchParams(location.search).get('busca'), q = document.getElementById('q')
    if (pag === 'cliente' && b && q) { q.value = b; q.dispatchEvent(new Event('input')); q.focus() }   // reusa a busca do cliente.js
  })
})()
```

### 4.4 Comportamentos

- **Contexto do cliente.** As abas do grupo Clientes, o link do grupo e as entradas do menu leem `?cliente=` da URL **atual** em cada mudança de URL (pushState, replaceState, popstate). Quem está em `/promocoes?cliente=X` e clica em "Cliente" cai em `/cliente?cliente=X`, e o caminho inverso também funciona, mesmo depois de escolher o cliente pela busca da própria página.
- **Busca.**
  - Em `/cliente` (tela de busca visível) e em `/promocoes`, clicar em "Buscar cliente" ou teclar `/` foca o `#q` da página.
  - Nas outras telas, abre o painel com o formulário. O Enter leva a `/cliente?busca=termo`, e o `shell.js` preenche o `#q` e dispara o `input`, então a busca do `cliente.js` (debounce, setas, Enter, Esc) mostra os resultados.
  - Sem código de busca duplicado, sem combobox e sem datalist.
- **Sino.**
  - É movido por `MutationObserver` no instante em que o `alerta.js` o insere, sem salto visível e sem esconder nada.
  - Se o `shell.js` falhar, o sino continua flutuando no canto inferior direito, como hoje (degradação segura).
  - Os toasts do `alerta.js` (`#psToasts`) ficam no canto inferior direito e descem para 16px quando o sino está no topo.
- **Menus.** Um único listener fecha `details.menu`, `.ps-menu` e `.ps-busca` com clique fora ou Esc e devolve o foco ao `summary`. Ele substitui o JS de menu de cada tela.
- **`window.PS`.** Implementação única de toast (`PS.toast`) e confirmação (`PS.confirmar`, que devolve uma Promise<boolean>). No `promocoes.js` só com fallback (`window.PS?.confirmar ?? confirm`), porque o vm do teste não tem `window.PS`.

### 4.5 CSS do shell (no `ui.css`)

```css
html,body{overflow-x:clip}                          /* nunca hidden: quebra o sticky. Safari < 16 não tem clip; medir scrollWidth mesmo assim */
body{margin:0;background:var(--fundo);color:var(--tinta);font:400 var(--t-14)/1.5 var(--fonte);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
:focus-visible{outline:2px solid var(--laranja);outline-offset:2px}
[tabindex="-1"]:focus{outline:none}
:is(.ps-abas-in,.tabela-wrap,.kpis,.abas) :focus-visible{outline-offset:-2px}   /* recipientes com overflow não cortam o anel */
[id]{scroll-margin-top:calc(var(--shell-h) + 12px)}

.ps-pular{position:absolute;left:8px;top:-48px;z-index:100;padding:8px 12px;border-radius:var(--raio-p);background:var(--tinta);color:var(--superficie);font:500 var(--t-14) var(--fonte)}
.ps-pular:focus{top:8px}
.ps-shell{position:sticky;top:0;z-index:var(--z-shell);height:var(--shell-h);background:var(--superficie);border-bottom:1px solid var(--borda)}   /* sem backdrop-filter: o menu fixed não depende de containing block */
.ps-barra{max-width:var(--largura);height:100%;margin:0 auto;padding:0 var(--gutter);display:flex;align-items:center;gap:var(--e-5)}
.ps-marca{display:flex;align-items:center;gap:var(--e-2);color:var(--tinta);font:600 var(--t-14)/1 var(--fonte);text-decoration:none;white-space:nowrap}
.ps-marca img{border-radius:var(--raio-p)}
.ps-grupos{display:flex;align-self:stretch}
.ps-grupos a,.ps-int{display:flex;align-items:center;align-self:stretch;padding:0 var(--e-3);border-top:2px solid transparent;border-bottom:2px solid transparent;color:var(--cinza);font:500 var(--t-14)/1 var(--fonte);text-decoration:none;white-space:nowrap}
.ps-grupos a:hover,.ps-int:hover{color:var(--tinta)}
.ps-grupos a[aria-current],.ps-int[aria-current]{color:var(--tinta);font-weight:600;border-bottom-color:var(--laranja)}
.ps-util{margin-left:auto;display:flex;align-items:center;align-self:stretch;gap:var(--e-1)}
.ps-busca{position:relative}
.ps-busca-botao,.ps-menu-botao{list-style:none;display:flex;align-items:center;gap:var(--e-2);height:32px;padding:0 var(--e-3);border-radius:var(--raio-p);color:var(--cinza);font:500 var(--t-14)/1 var(--fonte);cursor:pointer}
.ps-busca-botao::-webkit-details-marker,.ps-menu-botao::-webkit-details-marker{display:none}
.ps-busca-botao:hover,.ps-busca[open]>.ps-busca-botao{background:var(--fundo-suave);color:var(--tinta)}
.ps-busca-botao kbd{padding:1px 6px;border:1px solid var(--borda);border-radius:var(--raio-p);color:var(--cinza-claro);font:500 var(--t-12) var(--fonte-mono)}
.ps-busca-painel{position:absolute;right:0;top:calc(100% + 8px);z-index:var(--z-menu);width:min(360px,calc(100vw - 32px));display:grid;grid-template-columns:1fr auto;gap:var(--e-2);padding:var(--e-3);background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);box-shadow:var(--sombra-alta)}
.ps-busca-painel label{grid-column:1/-1;font:500 var(--t-13) var(--fonte)}
.ps-menu{display:none}
.ps-menu-botao{height:40px;border:1px solid var(--borda-forte);color:var(--tinta);font-weight:600}
.ps-menu-lista{position:fixed;top:var(--shell-h);left:0;right:0;z-index:var(--z-menu);max-height:calc(100dvh - var(--shell-h));overflow:auto;padding:var(--e-2) var(--gutter) var(--e-5);background:var(--superficie);border-bottom:1px solid var(--borda);box-shadow:var(--sombra-alta)}
.ps-menu-grupo{margin:var(--e-4) 0 var(--e-1);font:500 var(--t-12) var(--fonte);color:var(--cinza)}
.ps-menu-lista a{display:flex;align-items:center;min-height:44px;border-bottom:1px solid var(--borda);color:var(--tinta);text-decoration:none}
.ps-menu-lista a[aria-current]{font-weight:600}

.ps-abas{background:var(--superficie);border-bottom:1px solid var(--borda)}
.ps-abas-in{max-width:var(--largura);height:44px;margin:0 auto;padding:0 var(--gutter);display:flex;gap:var(--e-5);overflow-x:auto;scrollbar-width:none}
.ps-abas-in::-webkit-scrollbar{display:none}
.ps-abas a{display:flex;align-items:center;border-top:2px solid transparent;border-bottom:2px solid transparent;color:var(--cinza);font:500 var(--t-14)/1 var(--fonte);text-decoration:none;white-space:nowrap}
.ps-abas a:hover{color:var(--tinta)}
.ps-abas a[aria-current]{color:var(--tinta);font-weight:600;border-bottom-color:var(--tinta)}
.ps-ctx{margin-left:auto;align-self:center;color:var(--cinza);font-size:var(--t-13);white-space:nowrap}

/* sino no topo: especificidade maior que o <style> que o alerta.js injeta depois; o alerta.js não é editado */
.ps-shell #psSino{position:relative;right:auto;bottom:auto;z-index:auto;font:inherit}
.ps-shell #psSino button.sino{height:32px;padding:0 var(--e-3);gap:6px;background:transparent;color:var(--cinza);border-radius:var(--raio-p);box-shadow:none;font:500 var(--t-14)/1 var(--fonte)}
.ps-shell #psSino button.sino:hover{background:var(--fundo-suave);color:var(--tinta)}
.ps-shell #psSino button.sino::before{content:"";width:16px;height:16px;background:currentColor;
  -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'/%3E%3Cpath d='M10.3 21a1.94 1.94 0 0 0 3.4 0'/%3E%3C/svg%3E") center/contain no-repeat;
          mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'/%3E%3Cpath d='M10.3 21a1.94 1.94 0 0 0 3.4 0'/%3E%3C/svg%3E") center/contain no-repeat}
.ps-shell #psSino .ico{display:none}                 /* o emoji é literal fixo do alerta.js (testado): só some visualmente */
.ps-shell #psSino .cont{background:var(--laranja);color:var(--superficie);font-size:var(--t-12)}
.ps-shell #psPainel{top:calc(100% + 8px);bottom:auto;right:0;border-color:var(--borda);border-radius:var(--raio);box-shadow:var(--sombra-alta)}
body #psPainel button.mini{color:var(--tinta);font:600 var(--t-12) var(--fonte)}   /* corrige o font: inválido do alerta.js */
body:has(.ps-shell #psSino) #psToasts{bottom:16px}

@media (max-width:1099px){
  .ps-busca-botao .ps-rot,.ps-busca-botao kbd{display:none}
  .ps-busca-botao{width:32px;padding:0;justify-content:center}
  .ps-busca-botao::before{content:"";width:16px;height:16px;background:currentColor;
    -webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") center/contain no-repeat;
            mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") center/contain no-repeat}
  .ps-shell #psSino button.sino>span:not([class]){display:none}   /* some o rótulo "Avisos"; ficam o ícone e o contador */
}
@media (max-width:899px){
  .ps-grupos,.ps-int{display:none}
  .ps-menu{display:block}
  .ps-barra{gap:var(--e-3)}
  .ps-busca-painel{position:fixed;top:var(--shell-h);left:0;right:0;width:auto;border-radius:0}
}
@media print{.ps-shell,.ps-abas,.ps-pular{display:none}}
```

### 4.6 Nomes reservados

O shell só usa classes `.ps-*`, ids `ps*` e as classes de componente `.toast` e `.dlg` nos helpers.

Ele nunca usa:
- as classes `.btn`, `.btn-mini`, `.f-chip`, `.filtros`, `.sel`;
- os atributos `data-st` e `data-acao`;
- os ids `q`, `resultados`, `abas`, `busca`, `conteudo`, `filtros`, `drill-*`;
- os nomes do `alerta.js`: `psSino`, `psPainel`, `psToasts`, `.psItem`, `.psToast`, `.mini`, `.topo`.

Motivo: essas telas têm seletores globais que pegariam elementos do shell.

| Tela | Seletor global |
|---|---|
| app.js | `'.filtros select, .filtros input'` |
| planos.js | `[data-st]` e `.sel` |
| promocoes.js | `[data-acao]` e `'button.btn,button.btn-mini'` |
| integracoes.js | `.f-chip` |
| analistas.js | `[id^="drill-"]` |

---

## 5. Template de página

### 5.1 Anatomia (todas as 11 telas, nesta ordem)

```html
<main class="pg">
  <div class="pg-cab">
    <div class="pg-titulo">
      <p class="pg-sobre">Cliente</p>                  <!-- opcional: só quando o h1 é um nome próprio (cliente) -->
      <h1>Execução do sprint</h1>
      <p class="pg-meta"><span id="estadoSync">Notion sincronizado há 12 min</span><span id="estadoMeli">30 de 160 contas ML</span></p>
    </div>
    <div class="pg-acoes">                             <!-- esquerda → direita: [menu ⋯ ou nomeado] [até 2 secundárias] [primária, só se a tela não tiver .proxima] -->
      <details class="menu"><summary class="btn">Relatórios</summary><div class="menu-lista">…</div></details>
      <button class="btn" id="btnSync">Sincronizar</button>
    </div>
  </div>

  <section class="veredito" aria-label="Resumo">
    <p class="veredito-frase" id="veredito">Sprint 2026-10 está <b>6 p.p. abaixo do ritmo ideal</b>. <b>126 tarefas</b> pedem ação.</p>
    <div class="kpis" id="kpis">…no máximo 4 .kpi…</div>
    <p class="kpis-sec">Em andamento <b>139</b> · Atrasadas <b>16</b> (só 34 têm prazo) · Esforço <b>74%</b></p>   <!-- opcional, até 4 pares -->
  </section>

  <div class="proxima" id="proxima">                   <!-- só existe se o botão dispara ação ou navegação real -->
    <span class="proxima-rotulo">Próxima ação</span>
    <span class="proxima-texto">Destravar as bloqueadas</span>
    <button class="btn btn-primario" type="button">Ver as 110 bloqueadas</button>
  </div>

  <section class="bloco" id="cartaoRiscos">
    <div class="bloco-cab"><h2>O que pede ação</h2><a class="btn btn-fantasma btn-p" href="#secTarefas">Ver todas</a></div>
    <p class="sub">Bloqueadas, atrasadas e sem responsável</p>
    …
  </section>

  <details class="recolhido"><summary>Qualidade do dado <span class="n">2</span></summary>…</details>
</main>
<footer class="pg-rodape">Fonte: Notion · indicadores calculados por código</footer>
```

**Pergunta da tela.** Ela não vira linha fixa, porque o sócio vetou uma linha de pergunta acima do veredito.
- Nas telas com veredito, a pergunta é o **contrato de conteúdo** (está em cada blueprint): o veredito precisa respondê-la em uma frase.
- `.pg-pergunta` (16/400 cinza, máx. 60ch) só aparece nas telas **sem veredito**: busca do Cliente, escolha de Promoções e Processos.

**Direcionalidade acima da dobra.** Referência: 1366×768 menos o navegador, cerca de 650px úteis.

| Faixa | Altura | Conteúdo |
|---|---|---|
| Shell + abas | 56 + 44 | |
| A. Cabeçalho | ≤ 88 | `h1`, meta-linha e ações |
| B. Veredito | ≤ 180 | Uma frase e até 4 KPIs. O veredito interpreta (ritmo, desvio, quantos pedem ação) e os KPIs medem: o veredito não repete o valor de um KPI. |
| C. Próxima ação | 56 | Frase e o único primário |

Total ≈ 520px: tudo cabe sem rolar. Configuração, explicação de método, histórico, auditoria e tabelas completas ficam abaixo, ou em `details.recolhido` ou abas.

**Regra do veredito.** É calculado no front com dados que a tela já recebe. Quando falta dado, a frase diz o que falta ("Escolha um sprint para ler o ritmo.") e nunca inventa. Sem borda, sem badge e sem cor: é uma frase em tinta.

### 5.2 CSS essencial do template

```css
.pg{max-width:var(--largura);margin:0 auto;padding:var(--e-5) var(--gutter) var(--e-8)}
.pg-cab{display:flex;justify-content:space-between;align-items:flex-end;gap:var(--e-4);flex-wrap:wrap;margin-bottom:var(--e-5)}
.pg-sobre{margin:0 0 2px;font:500 var(--t-12) var(--fonte);color:var(--cinza)}
.pg h1,.cab h2{margin:0;font:600 var(--t-24)/1.25 var(--fonte);letter-spacing:-.015em;color:var(--tinta)}   /* .cab h2: alias do cabeçalho que cliente.js/promocoes.js ainda geram */
.pg-meta{margin:var(--e-1) 0 0;font-size:var(--t-13);color:var(--cinza)}
.pg-meta>*+*::before{content:" · ";color:var(--cinza-claro)}
.pg-pergunta{margin:var(--e-2) 0 0;max-width:60ch;font-size:var(--t-16);color:var(--cinza)}
.pg-acoes{display:flex;align-items:center;gap:var(--e-2);flex-wrap:wrap}
.veredito{margin-bottom:var(--e-4)}
.veredito-frase{margin:0 0 var(--e-4);max-width:60ch;font:500 var(--t-20)/1.35 var(--fonte);color:var(--tinta)}
.veredito-frase b{font-weight:600}
.kpis-sec{margin:var(--e-3) 0 0;font-size:var(--t-13);color:var(--cinza)}
.kpis-sec b{font-weight:600;color:var(--tinta)}
.proxima{display:flex;align-items:center;gap:var(--e-4);flex-wrap:wrap;margin:var(--e-4) 0 var(--e-6);padding:var(--e-3) var(--e-4);background:var(--superficie);border:1px solid var(--borda);border-left:2px solid var(--laranja);border-radius:var(--raio)}
.proxima-rotulo{font:500 var(--t-12) var(--fonte);color:var(--laranja)}
.proxima-texto{font:500 var(--t-14) var(--fonte);color:var(--tinta)}
.proxima .btn-primario,.proxima .proxima-acao{margin-left:auto}
.bloco,.secao{margin-top:var(--e-6)}
.bloco-cab{display:flex;align-items:baseline;justify-content:space-between;gap:var(--e-3);flex-wrap:wrap}
.bloco h2,.secao>h2,.secao>h3{margin:0;font:600 var(--t-16)/1.3 var(--fonte)}
.pg .sub{margin:2px 0 var(--e-3);font-size:var(--t-13);color:var(--cinza)}
.pg .mini{font-size:var(--t-12);color:var(--cinza)}            /* escopado: nunca vaza para o #psPainel */
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:var(--e-4)}
.cartao.largo{grid-column:1/-1}
.pg-rodape{max-width:var(--largura);margin:0 auto;padding:var(--e-5) var(--gutter);text-align:center;font-size:var(--t-12);color:var(--cinza-claro)}
@media (max-width:639px){
  .pg-acoes{width:100%}
  .proxima .btn-primario,.proxima .proxima-acao{width:100%;margin-left:0}
}
```

### 5.3 Cabeçalho: regras

- Exatamente **1 `.btn-primario` visível** por tela. Ele mora na faixa `.proxima` quando a tela tem uma; senão, no `.pg-acoes`. Telas de consulta (Processos) podem ter zero.
- No máximo **2 secundárias** soltas; o resto vai para `details.menu` (summary "⋯" com `aria-label="Mais ações"`, ou um menu nomeado: "Relatórios", "Documentos").
- Ação destrutiva só dentro de menu, como item `.menu-perigo` depois de um filete, e sempre com `PS.confirmar` ou `<dialog>`.
- Sem emoji em nenhum rótulo. O único glifo permitido em controle é "⋯" (com `aria-label`). Ícone, quando houver, entra por `::before` com máscara SVG, porque vários JS sobrescrevem `textContent` de botões.
- Garantias ("nada é alterado", "tokens cifrados") aparecem **uma vez**: na meta-linha ou no rodapé.

### 5.4 Faixa de KPIs

```css
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--superficie);border:1px solid var(--borda);border-radius:var(--raio);overflow:hidden}
.kpis:has(>.kpi:nth-child(3):last-child){grid-template-columns:repeat(3,minmax(0,1fr))}
.kpi{display:flex;flex-direction:column;gap:var(--e-1);padding:16px 20px;box-shadow:-1px -1px 0 var(--borda)}   /* filetes; célula vazia fica branca */
.kpi .rotulo,.kpi .r{order:1;font:500 var(--t-12) var(--fonte);color:var(--cinza);text-transform:none;letter-spacing:0}
.kpi .valor,.kpi .v{order:2;font:600 var(--t-28)/1.1 var(--fonte);letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--tinta)}
.kpi .detalhe,.kpi .e{order:3;font-size:var(--t-13);color:var(--cinza)}
.kpi:is(.bom,.alerta,.risco,.ruim) :is(.rotulo,.r)::before{content:"";display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;vertical-align:middle}
.kpi.bom :is(.rotulo,.r)::before{background:var(--verde)}
.kpi.alerta :is(.rotulo,.r)::before{background:var(--ambar)}
.kpi:is(.risco,.ruim) :is(.rotulo,.r)::before{background:var(--verm)}
@media (max-width:899px){.kpis,.kpis:has(>.kpi:nth-child(3):last-child){grid-template-columns:repeat(2,minmax(0,1fr))}}
```

- No máximo 4 KPIs por faixa. Com 3, vira `repeat(3)`.
- O **valor nunca é colorido**. O estado é o ponto de 6px mais a palavra no `.detalhe` ("risco: 110 travam entrega").
- Formato:
  - inteiro com milhar: "13.968";
  - dinheiro abreviado: "R$ 352 mil";
  - percentual sem casa: "74%";
  - sem dado: "—" em `--cinza-claro`.
- Delta no detalhe, com sinal e referência: `<span class="pos">+4,1%</span> vs 28 dias anteriores`.
- As duas marcações (`.v/.r/.e` do `app.js:44` e do `planos.js:52`; `.rotulo/.valor/.detalhe` nas outras) recebem o mesmo estilo, e o `order` põe o rótulo em cima.

### 5.5 Seções e cartões

- A seção (`.bloco` = `.secao`) é plana: `h2` + `.sub` + conteúdo, separada por 32px, **sem caixa**.
- `.cartao` (superfície, 1px `--borda`, `--raio`, padding 20px, sem sombra) só aparece para agrupar lado a lado em `.grade`, ou para envolver uma tabela.
- **Selo do sistema de origem (15/10/2026):** `span.sis[data-sistema]` logo depois do `h2` (dentro de `.bloco-cab`) ou no fim do `summary` — contorno 1px `--borda`, texto `--cinza` 12px, `margin-right:auto` para ficar colado ao título mesmo com botão à direita. Nunca dentro do `h2` (os testes leem o texto do título), nunca em tela ao cliente. Nomes e ids em `config/sistemas.json`; glossário em `docs/sistemas.md`.

### 5.6 Filtros

- `.filtros`: uma barra só, acima do que filtra.
  - Busca com `<label class="sr">`;
  - até 3 selects visíveis;
  - `<details class="mais-filtros">` com o resto, **dentro** de `.filtros`;
  - "Limpar" como `.btn-fantasma`;
  - filtro ativo mostra contagem ("Mais filtros (2)").
- `.barra-filtros` (só a Execução): sticky em `top:var(--shell-h)`, fundo `--fundo`, padding 12px 0, filete inferior. Não é sticky abaixo de 900px.
- `.f-chip` para alternâncias combináveis, com contagem em `.n`. `.seg` para escolha exclusiva (período, canal, escopo).

### 5.7 Tabelas

- Sempre dentro de `.tabela-wrap` (`overflow-x:auto`, borda, `--raio`, fundo superfície): a rolagem fica na tabela, nunca na página.
- `.tabela-wrap.fixa` (`max-height:min(70vh,720px)`, `th` sticky em `top:0`) para listas com mais de 20 linhas.
- `th`: 12/500 cinza, sentence case, padding 10px 12px, filete inferior. `td`: 14px (13 nas densas), padding 10px 12px, linha de cerca de 44px, hover `--fundo-suave`, sem zebra.
- Números à direita (`td.n`, tabular). 1ª coluna em tinta 500.
- No máximo 6 colunas visíveis. O resto vai para a linha expandida (`tr.det`, `details.lin`) ou para a gaveta.
  - **Exceção declarada (07/10/2026): tabelas de resultado de /resultados** (Por tipo, Por nicho, Por região, Nicho × tipo, Analistas, Palavras) têm **8 colunas**: Grupo · Tarefas · Melhorou (selo `.estado.e-melhorou`) · Sem efeito · Piorou (selo `.estado.e-piorou`) · Taxa de melhora ≥ (Wilson; `title` com a taxa observada) · Efeito mediano · R$ associado. O "piorou" separado e visível é o que provoca quem analisa — não cabe numa mini barra. Abaixo de 900px "Sem efeito" e "Efeito mediano" somem (`.opc`) e o drill-down (`tr.det > .drill`) mostra tudo. Zero aparece em cinza, sem selo; negativo em `.neg`.
- Ordenável: só `th[data-k]` ganha cursor, `aria-sort` e um `<button>` interno. O handler continua no `th`.
- Paginação `.t-pag`, 50 por vez: "1–50 de 1.409 · Mostrar mais". Nenhuma lista renderiza mais de 50 de uma vez.
- Ação de linha: no máximo 1 `.btn-p` mais "⋯".
- Telas de lista operacional (Comercial, Integrações): abaixo de 640px a linha vira cartão empilhado (`td[data-rotulo]::before{content:attr(data-rotulo)}`).

### 5.8 Estados (iguais em todo bloco que carrega dado)

| Estado | Componente | Regra |
|---|---|---|
| Carregando | `.skeleton` no formato do conteúdo | `.sk-linha` 14px, `.sk-kpi` 88px, `.sk-graf` 240px, `.sk-tabela` 5×44px. Sem animação com `prefers-reduced-motion`. Container com `aria-busy="true"`. |
| Vazio | `.vazio-box` | Título 14/600 tinta, uma linha 13 cinza dizendo o que fazer e, quando houver, 1 botão **secundário**. Ex.: "Nenhuma tarefa neste filtro." + "Limpe os filtros ou sincronize com o Notion." [Limpar filtros]. |
| Erro | `.erro-bloco` | Fundo `--fundo-suave`, título "Não foi possível carregar" em `--verm` 14/600, mensagem humana 13 cinza, [Tentar de novo], e `details` "Detalhe técnico" com a mensagem crua. Cada bloco carrega e falha sozinho: nada de `Promise.all` que derruba a tela, e `r.ok` sempre conferido. |
| Parcial ou com ressalva | `.aviso` | Uma linha, no máximo 1 por tela acima da dobra, no topo do bloco afetado |
| Job em andamento | `.barra-progresso` | 4px, preenchimento `--laranja`, texto "Gerando planos: 12/141 · Cliente X". Botão em ação: `disabled`, gerúndio ("Gerando…"), `aria-busy`. |

### 5.9 Recolhidos

- `details.recolhido`:
  - summary 14/600 com contagem em `.n` cinza e chevron por CSS;
  - filete superior;
  - fechado por padrão.
- Guardam: "Como ler / Como medimos", parâmetros, qualidade do dado, histórico interno, auditoria, configuração técnica.
- Abrem sozinhos só quando há bloqueio real (configuração do ML incompleta, rodada de promoções não fechada).

---

## 6. Componentes e mapeamento de classes legadas

Tudo fica no `ui.css`, nesta ordem:
1. `:root`;
2. base;
3. shell `.ps-*`;
4. template `.pg-*`;
5. componentes;
6. famílias geradas por dados;
7. específicos por tela, com comentário.

`acomp.css` e `promocoes.css` continuam como CSS de tela, retokenizados e sem hex.

**Regra dos aliases.** Classe gerada por JS **nunca é renomeada**: ela entra no mesmo seletor agrupado da classe nova. Classe que só existe em HTML estático é renomeada no HTML.

### 6.1 Inventário final

| # | Componente | Classe nova | Aliases (mesmo seletor) | Regra essencial |
|---|---|---|---|---|
| 1 | Botão secundário | `.btn` | `.bt.sec`, `.fch .b.sec`, `.ps-btn` | 36px; padding 0 14px; 14/500; `--raio-p`; superfície; 1px `--borda-forte`; tinta. Hover: `--fundo-suave` + `--borda-campo`. `:disabled`, `[aria-disabled=true]`: opacidade .5, `not-allowed`. |
| | Botão primário | `.btn-primario` | `.btn.cheio`, `.bt`, `.fch button.b`, `.ps-primario` | Fundo e borda tinta, texto `--superficie`; hover `--tinta-forte` |
| | Botão fantasma | `.btn-fantasma` | `.btn-claro`, `.volta` | Sem borda, cinza; hover `--fundo-suave` + tinta |
| | Botão perigo | `.btn-perigo` | `.bt.perigo`, `.bt.sec.perigo`, `.btn-mini.perigo`, `.ps-perigo` | Superfície, texto `--verm`; hover borda verm + `--verm-suave` |
| | Perigo sólido (só dentro de diálogo) | `.btn-perigo-solido` | | Fundo `--verm`, texto `--superficie` (6,57) |
| | Tamanhos | `.btn-p` (28px, 0 10px, 13/500); `.btn-icone` (36×36, `aria-label` obrigatório) | `.btn-mini` = `.btn.btn-p`; `.lupa` = `.btn-icone` | `.btn-mini.sel` e `[aria-pressed=true]` = ligado (fundo tinta). `.btn-mini.ok:hover` verde; `.btn-mini.no:hover` verm. `.bt.ok` = secundário com texto verde. `.nome-btn` = botão-link tinta 500, sublinhado no hover. |
| 2 | Badge | `.badge` + tom | `.tag`, `.selo`, `.pill-mini`, `.chip`, `.tagzinha`, `.p-badge`, `.elo-t`, `.flag`, `.estado`, `.ac-badge`, `.ac-v`, `.curva`, `.tg` | `inline-flex`; 20px; padding 0 8px; `--raio-pilula`; 12/500; `--fundo-suave`/`--cinza`; sem uppercase. Tons em 6.2. |
| 3 | KPI | `.kpis` / `.kpi` / `.rotulo` `.valor` `.detalhe` | `.r` `.v` `.e` | Ver 5.4 |
| 4 | Cartão | `.cartao` | `.card`, `.item-card`, `.ac-card`, `.ac-bloco`, `.acao`, `.pr-bloco`, `.pr-q`, `.jogada`, `.risco-grupo`, `.cart`, `.cu-fonte` | Superfície, 1px `--borda`, `--raio`, padding 20px, sem sombra. `.cartao:has(>table,>.tabela-rolagem){padding:0;overflow:hidden}`. `.inativo` e `.pr-bloco.travado`: borda tracejada + `--fundo-suave`. `.pr-bloco.perigo`: borda verm + `--verm-suave`. `.acao`: padding 14px 16px, margem 8, hover `--borda-forte`. `.ac-card.ok/.no`: borda esquerda 2px verde/verm. `.cartao h4 .num`: círculo de 20px `--fundo-suave` 12/600; `.jogada h4 .num`: fundo tinta. |
| 5 | Seção | `.bloco`, `.bloco-cab` | `.secao`, `.secao>h3` | Ver 5.5 |
| 6 | Tabela | `.tabela-wrap` (+ `.fixa`) com `table.t` | `.tabela-rolagem`, `.tabela` (integracoes), `.ac-rolagem`; tabelas `.ac-tab`, `.pr-det-t`, `.drill table`, `.ac-marcos` | Ver 5.7. `tr.det>td` `--fundo-suave`; `tr.lin-marcada>td` `--laranja-suave`; `th.on` tinta; `td.semdados`, `td.vazio` centralizados, padding 32px, sem tracejado. `table, th, td` globais: só `border-collapse` e a base de 5.7. |
| 7 | Filtros | `.filtros`, `.barra-filtros`, `.mais-filtros`, `.f-chip` | `.pr-filtros`, `.linha` (planos, comercial) | `.filtros`: flex, wrap, gap 8. `.f-chip`: 30px; 0 12px; pílula; 13/500; 1px `--borda-forte`; cinza; `.on` e `[aria-pressed=true]` com fundo tinta e texto superfície; contagem em `.n`. |
| 8 | Controle segmentado | `.seg` | `.esc`, `#tipos`, `#periodo`, `.ac-abas` | `inline-flex`; fundo `--fundo-suave`; padding 2px; `--raio-p`. Botões de 28px 13/500 cinza; `.on`/`[aria-pressed=true]` com fundo superfície, tinta e `--sombra`. Os botões de `#tipos` continuam **sem filho** (`e.target.dataset.t`). |
| 9 | Abas de conteúdo | `.abas` | `.tabs`, `#abas` (gmv, promoções, processos; `#abas .f-chip` vira aba), `.cu-tab` | Flex, gap 20, filete inferior. Itens de 40px 14/500 cinza. Ativo (`.on`, `[aria-pressed=true]`, `[aria-selected=true]`, `[aria-current]`): tinta 600 + `border-bottom:2px solid var(--tinta)`. Sem `role=tab`/`tablist` (teste de promoções). `.abas-fixas`: sticky em `top:var(--shell-h)`, fundo `--fundo`. |
| 10 | Aviso | `.aviso` (padrão = atenção) + `.ok`, `.erro`, `.info` | `.aviso-faixa` (= `.aviso`), `.aviso-faixa.ruim` e `.aviso.erro`, `.aviso.amb`, `.fch .msg.ok/.erro/.aviso`, `.pr-inv.ok/.ruim`, `.cart .aviso` (= `.aviso.info`) | `--ambar-suave`, tinta, `--raio-p`, padding 12px 16px, 13px, `b` 600. `.ok` `--verde-suave`; `.erro` `--verm-suave` com título verm; `.info` `--fundo-suave`. |
| | Nota | `.nota` | `.explica` estático do index e do planos (renomear no HTML) | 13 cinza, sem caixa |
| | Explicação | `.explica` (gerada) | | Caixa `--fundo-suave`, `--raio-p`, padding 12px 16px, 13 cinza; `h4` 14/600 tinta. Nas telas em que vinha aberta antes dos números (gmv, metodologia, resultados, promoções), passa para dentro de `details.recolhido`. |
| 11 | Vazio | `.vazio-box` | `.vazio` (comercial, integracoes), `.semdados`, `.res-vazio` | Tracejado 1px `--borda-forte`, `--raio`, padding 32px 16px, centralizado, 14 cinza, título em `b`. Em `<td>`, sem borda. |
| | Erro de bloco | `.erro-bloco` | | Ver 5.8 |
| 12 | Skeleton | `.skeleton` + `.sk-linha`, `.sk-kpi`, `.sk-graf`, `.sk-tabela` | as 3 cópias atuais saem | Gradiente `--fundo-suave` → `--borda` → `--fundo-suave`, 1,2s; parado com reduced-motion |
| 13 | Toast | `.toast` (+ `.erro`) | `.pr-toast` | Fundo tinta, texto superfície, `--raio-p`, 13px, `--sombra-alta`, fixo embaixo no centro, `z-index:var(--z-toast)`, max-width `min(480px,100vw - 32px)`; `.erro` fundo verm; `:empty` invisível sem sair do DOM. `#toast`/`#toastErro` nunca recebem `hidden`. Os toasts do `alerta.js` ficam como estão. |
| | Diálogo | `dialog.dlg` + `.dlg-rodape` | `#dlgSegredo` (só ganha a classe) | `width:min(520px,100vw - 32px)`; `--raio`; padding 24px; `--sombra-alta`; `::backdrop{background:var(--veu)}`; `h2` 16/600; rodapé à direita: Cancelar (`.btn`) e confirmar (`.btn-primario` ou `.btn-perigo-solido`) |
| | Gaveta | `.gaveta` | `#custosPainel:not([hidden])`, editor da ficha em planos | `position:fixed; inset:0 0 0 auto; width:min(720px,100%); overflow:auto; z-index:var(--z-gaveta)`; filete esquerdo; `--sombra-alta`; padding 24px. **Só CSS**: o `integracoes.js` continua alternando `hidden`. |
| 14 | Formulário | `.campo` (label 13/500 tinta acima, gap 6), `.ajuda-campo`, `.form-grade`, `.sr` | `.pr-form` (`label.v` = `.campo`, `.col2` linha inteira), `.cu-form`, `.fch`, `.pf-grid`/`.pf-campo`/`.pf-rot`, `#fNovo`, `.ac-manual`, `.pr-quem`, `.pr-chk` | `input, select, textarea`: 36px (textarea min 90), padding 0 12px, 1px `--borda-campo`, `--raio-p`, superfície, 14px. Foco: borda tinta + anel. Placeholder `--cinza-claro`. `[aria-invalid=true]` com borda verm. Checkbox com `accent-color:var(--tinta)`. "Obrigatório" escrito, nunca só asterisco. |
| 15 | Menu | `details.menu` > `summary.btn` + `.menu-lista` | | Absolute à direita, min-width 220px, superfície, borda, `--sombra-alta`, `--raio`, padding 4px, `z-index:var(--z-menu)`. Itens `<a>`/`<button>` de 32px 13/500, hover `--fundo-suave`. `.menu-perigo` em verm depois de `<hr>`. Item indisponível: `<a aria-disabled="true">` **sem href**, com o motivo em `<small>`. Chevron do summary por `::after`. |
| 16 | Recolhido | `details.recolhido` | `details.evid`, `details.lin`, `details#secImpacto` | Ver 5.9 |
| | Barras | `.barra` (gmv: trilho de 8px, pílula), `.barra-progresso` (4px, `--laranja`) | `#job .barra` → `.barra-progresso` (o `#jobBarra` continua) | `.legenda`/`.bola` com tokens. `.cadeia`/`.elo`: `--fundo-suave`, `--raio-p`, 13px. |
| | Passos | `ol.passos` (`.atual` tinta 600, `.feito` verde) | | Círculos de 20px numerados |
| | Barra de massa | `.barra-massa` | | Só aparece com item marcado (`:has(.sel:checked)`); sticky em `bottom:16px` |
| | Busca de página | `.busca-wrap` > `.busca` + `.resultados` > `.res-item` | `.hero` → `.pg-busca`; `.pr-busca` | `.busca`: campo de 44px (36 no `.pr-busca`), `--raio-p`. Lista suspensa: superfície, `--sombra-alta`, `--raio`. `.res-item.ativo` com fundo `--fundo-suave`. |
| | Utilitários | `.mudo`, `.peq` (12px), `.forte` (600), `.num` (tabular), `.linha` (flex, gap 8, wrap, center), `.mt-2` (8px), `.mt-4` (16px), `.direita`, `.sr` | | Substituem os cerca de 170 `style=` inline dos JS (fase 2) |

### 6.2 Famílias geradas por dados → tom

O seletor base de 6.1 #2 dá a **forma**. Os tons ficam assim (texto/fundo):

| Tom | Cores | Classes |
|---|---|---|
| neutro (padrão, sem regra extra) | `--cinza` / `--fundo-suave` | `.t-nao_iniciada`, `.selo.neutro`, `.s-neutro`, `.pill-mini`, `.chip`, `.tagzinha`, `.tg`, `.tg.t`, `.p-P3`, `.flag`, `.e-sem_efeito`, `.e-em_maturacao`, `.e-sem_base`, `.e-sem_controle`, `.e-variacao_conta`, `.ac-v`, `.curva.cC`, `.tag.p-obsoleta`, `.badge` (contador `#nTarefas`) |
| sucesso | `--verde` / `--verde-suave` | `.t-concluida`, `.selo.bom`, `.s-ok`, `.tagzinha.fato`, `.elo-t.fato`, `.e-melhorou`, `.ac-v.ok`, `.tag.p-aprovada` |
| atenção | `--ambar` / `--ambar-suave` | `.t-dependencia_cliente`, `.selo.atencao`, `.selo.amb`, `.s-pend`, `.pill-mini.alerta`, `.flag.atencao`, `.elo-t.hipotese`, `.p-P1`, `.ac-v.mid` |
| perigo | `--verm` / `--verm-suave` | `.t-bloqueada`, `.selo.ruim`, `.s-erro`, `.flag.ruim`, `.e-piorou`, `.p-P0`, `.ac-v.no` |
| info | `--azul` / `--azul-suave` | `.t-andamento`, `.selo.azul`, `.s-azul`, `.elo-t.projecao`, `.e-lancamento`, `.tag.p-distribuida` |
| violeta | `--roxo` / `--roxo-suave` | `.t-validacao` |
| contorno | tinta / superfície + 1px `--borda-forte` | `.chip.laranja` (tier), `.tagzinha.impacto`, `.p-P2`, `.tag.p-proposta`, `.curva.cB`, `.tg.d` |
| forte | `--superficie` / `--tinta` | `.curva.cA` (curva A: destaque sem cor) |
| sólido (24px, 600) | `--superficie` / cor | `.ac-badge.ac-queda` (verm), `.ac-estagnacao` (ambar), `.ac-crescimento` (verde), `.ac-sem_base` (cinza). Sai o uppercase com letter-spacing. |
| riscado | neutro + `line-through` + `--cinza-claro` | `.t-cancelada`, `.tag.p-descartada` |

**Status que são texto, não badge:**

| Classe | Estilo |
|---|---|
| `.st-aprovada` | verde |
| `.st-distribuida` | azul |
| `.st-descartada` | `--cinza-claro` + line-through |
| `.st-proposta`, `.st-rotulo` | cinza |
| `.acao-ENTRAR` / `.acao-PULAR` / `.acao-IGNORAR` | verde / ambar / cinza, 600 |
| `.pos` / `.neg` | verde / verm, 500 |
| `.mudo` | cinza |
| `.atrasada` | verm 500 |

**Listas e KPIs:**
- `.risco-grupo` é cartão com padding 16px. O `h3` é 13/600 com `.n` em 20/600 tinta. O estado é um ponto de 6px antes do título: `.ruim` verm, `.ok` verde. Os links são tinta, sublinhados no hover.
- `.kpi.bom/.alerta/.risco/.ruim`: ver 5.4.

**Modificadores** (`.ok`, `.no`, `.bom`, `.ruim`, `.alerta`, `.on`, `.erro`, `.sel`) nunca recebem estilo sozinhos, só compostos.

### 6.3 Conflitos resolvidos (mesma classe, sentidos diferentes)

| Classe | Decisão |
|---|---|
| `.estado` | Só badge. O `class="estado"` estático do index sai, e os spans `#estadoSync`/`#estadoMeli` viram itens da `.pg-meta`. |
| `.explica` | Caixa quando gerada por JS; legenda estática vira `.nota` no HTML |
| `.filtros` | Linha genérica; sticky só com `.barra-filtros` |
| `.kpi` | Duas marcações, um estilo (5.4) |
| `.btn` / `.bt` | `.btn` = secundário; `.bt` = primário; `.bt.sec` = secundário |
| `.cartao` | Um só; o caso com tabela via `:has` |
| `.barra` | Trilho do GMV; o progresso vira `.barra-progresso` |
| `.aviso` | Uma base com tons |
| `.ok` | Só modificador. A caixa verde de Processos vira `.cart .ok` (`--verde-suave`). |
| `.vazio` | = `.vazio-box` |
| `.sub` | 13 cinza, escopado em `.pg` |
| `.mini` | 12 cinza, escopado em `.pg` (o `#psPainel button.mini` fica protegido) |
| `.marca`, `.topo`, `header` | Saem do CSS global (o shell usa `.ps-*`). O degradê azul que vazava para `#psPainel .topo` some junto com o `styles.css`. |
| `table/th/td` | Uma base só |
| `[hidden]` | `display:none!important` global. Cobre `tr#drill-*`, `tr#dx-*`, `tr.det`, `.cart[hidden]`, `#boxSquad`, `#job` e afins. Nenhuma regra dá `display` a esses elementos sem respeitar `[hidden]`. |

---

## 7. Blueprints das 11 telas

Convenções:
- **"JS"** indica o que exige editar o script da tela (fase 2). O resto é HTML e CSS (fase 1).
- Ids e classes de `hooks_js` (inventários) ficam onde estão ou só mudam de lugar, nunca somem.
- Toda tela troca o próprio header pelo shell e ganha `.pg-cab`, estados e rodapé de uma linha.

### 7.1 Execução (`/`, antigo Painel executivo), em detalhe

- **Shell:** Visão geral › Execução. `data-pagina="execucao"`. `<title>` "Execução · Place Sprints".
- **Pergunta (contrato):** "O sprint está entregando o que planejou, e o que pede ação agora?"

**A. Cabeçalho**
- `h1` "Execução do sprint".
- `.pg-meta`:
  - `<span id="estadoSync">` "Notion sincronizado há 12 min · 13.968 tarefas";
  - `<span id="estadoMeli">` "30 de 160 contas ML conectadas". Sai o emoji. JS: o texto vem sem emoji.
  - Os dois perdem a classe `.estado`.
- `.pg-acoes`:
  - `details.menu` com summary `.btn` "Relatórios" (secundário, **nunca cheio**), contendo:
    - `#lnkRelatorio` "Relatório do sprint";
    - `#lnkPdf` "PDF do sprint";
    - `#lnkSemanal` "Semanal do cliente";
    - `<hr>`;
    - `#lnkMatriz` "Matriz Eisenhower · interno".
  - `#btnSync` `.btn` "Sincronizar".
- Semanal e Matriz ficam **sem href** e com `aria-disabled="true"` e o motivo em `<small>` ("escolha um cliente", "escolha um responsável") até haver filtro. JS: `removeAttribute('href')` + `aria-disabled` no lugar de `href='#'` + opacidade.
- JS: `#btnSync` com `textContent` "Sincronizar"/"Sincronizando…", sem ↻. O resultado sai em `PS.toast`, não em `alert()`.

**Barra de filtros** (`<div class="filtros barra-filtros" id="filtros">`, sticky)
- Visíveis, cada um com `<label class="sr">`:
  - Sprint `#fSprint`;
  - Cliente `#fCliente` (a 1ª option continua placeholder);
  - Responsável `#fResponsavel`.
- `<details class="mais-filtros">` "Mais filtros" com `#fProjeto`, `#fProcesso`, `#fStatus` (os 6 values), `#fDe`, `#fAte`, ainda **dentro** de `.filtros`.
- `#btnLimpar` `.btn-fantasma`.
- **Padrão "sprint atual"** (decisão do David, ver 8.7). JS: na 1ª carga sem filtro, seleciona o último sprint de `o.ordem_sprints` **que não seja futuro**; a meta-linha ganha "Sprint atual · trocar".

**B. Veredito** (`#veredito`, novo; JS)
- Frase: "Sprint 2026-10 está **6 p.p. abaixo do ritmo ideal**. **126 tarefas** pedem ação." O ideal vem do último ponto de `g.burnup.ideal`.
- Sem sprint filtrado: "Carteira inteira desde 2024. Escolha um sprint para ler o ritmo."
- Burnup com menos de 2 dias: omite a comparação.

**KPIs** (`#kpis`, 4)

| KPI | Valor | Detalhe | Ponto |
|---|---|---|---|
| Conclusão | 74% | "ritmo ideal hoje 80% · −6 p.p." | bom ≥ 70, alerta ≥ 40, risco abaixo |
| Entregues | 10.327 | "de 13.968 planejadas" | — |
| Bloqueadas | 110 | "travam entrega agora" | risco se > 0 |
| Com evidência | 68% | "6.994 entregas comprovadas" | bom ≥ 70, senão alerta |

- `.kpis-sec`: Em andamento 139 · Atrasadas 16 (só 34 tarefas têm prazo) · Esforço 74%.
- Transferidas só aparece se > 0.

**C. Próxima ação** (`#proxima`, novo; JS)
- Escolhe o maior grupo de risco e **aplica um filtro de verdade** na tabela Tarefas, depois leva o foco até ela. Nunca é só rolagem até a seção logo abaixo.

| Situação | Texto | Primário |
|---|---|---|
| Bloqueadas > 0 | "Destravar as bloqueadas primeiro" | [Ver as 110 bloqueadas] (liga o chip "Bloqueadas" de `#secTarefas` e foca a tabela) |
| Senão, atrasadas > 0 | "Prazos estourados" | [Ver as 16 atrasadas] (liga o chip "Atrasadas") |
| Senão, sem responsável > 0 | "Tarefas sem dono" | [Ver as N sem responsável] (liga o chip "Sem responsável") |
| Senão, dependência do cliente há 14+ dias > 0 | "Cobrar o cliente: aguardam retorno há 14+ dias" | [Ver as N que dependem do cliente] (liga o chip "Depende do cliente") |
| Nada em risco | "Nada pede ação agora." | [Relatório do sprint] (abre `/relatorio`) |

- Nota (07/10/2026): "Depende do cliente" é a 4ª prioridade e só entra quando as três acima são zero — não é risco da equipe, a cobrança é do consultor. Não soma em "N tarefas pedem ação"; na linha secundária aparece como "Depende do cliente N (M há 14+ dias)". A seleção em massa da tabela (`#selTodas`, `input.sel` só em tarefa aberta) abre a `.barra-massa` com um só `.btn` "Encerrar por dependência do cliente" (`#btnDependencia`) e "Desmarcar"; o único `.btn-primario` da tela segue em Próxima ação (o do diálogo `#dlgDependencia` é modal).

**Abaixo, nesta ordem**
1. **"O que pede ação"** (`#cartaoRiscos > #riscos`): 3 `.risco-grupo` em `.grade`:
   - Bloqueadas · Atrasadas (sub "só 34 de 13.968 têm prazo") · Sem responsável;
   - até 6 links ao Notion cada (título, responsável · prazo, `rel="noopener"`);
   - "Ver todas (N)" (`.btn-fantasma.btn-p`), que liga o chip correspondente em Tarefas e rola até a tabela;
   - grupo vazio: "Nenhuma" (sai o ✔);
   - 1 coluna no celular.
2. **"Ritmo do sprint"**: burnup em largura total (`#gBurnup`/`#vazioBurnup`, este como `.vazio-box` compacto). JS:
   - Concluído em `--laranja` 2px;
   - Planejado em `--cinza` 1,5px;
   - Ritmo ideal em `--borda-campo` tracejado;
   - rótulos diretos no fim das linhas.
3. **`.grade` de 2 colunas:**
   - "Avanço por processo" (`#gProcessos`, top 8, barras `--cinza`);
   - "Entregas por semana" (`#gSemanas`, últimas 12 semanas, sem semanas futuras, barras `--cinza-claro`).
4. **"Tarefas"** (`#secTarefas`, **seção aberta**, não recolhida):
   - `h2` "Tarefas" + `.badge#nTarefas`;
   - uma busca local `<input type="search">` com label, **fora de `.filtros`** (senão o `app.js` a trata como filtro de API);
   - chips locais Todas · Bloqueadas · Atrasadas · Sem responsável, em `<div class="linha">` (nunca `.filtros`);
   - `.tabela-wrap.fixa > table.t#tabelaTarefas` com `tbody` mantido;
   - colunas: Tarefa, Cliente, Sprint, Processo, Responsável, Status (`.tag.t-*`), Prazo (`.atrasada`), Peso (`.n`), "Alerta" (texto "sem data" no lugar do ⚠️);
   - JS: 50 linhas + "Mostrar mais 50";
   - vazio: "Nenhuma tarefa neste filtro. Limpe os filtros ou sincronize com o Notion." (sai "npm run demo").
5. **`details.recolhido` "Qualidade do dado"** (`#qualidade`, novo): Sem prazo 3.621 e Concluídas sem evidência 3.333, que saem de `#riscos` (são higiene do Notion, não risco).
6. **`details.recolhido` "Distribuição de status e esforço"**: `#gPlanejado` e `#gStatus` continuam no DOM, porque o `app.js` desenha neles. O Chart.js redimensiona ao abrir.

**Rodapé:** "Fonte: Notion · indicadores calculados por código".

**Sai:**
- o degradê azul;
- os 9 botões com emoji;
- os links de navegação (o shell cobre);
- o subtítulo repetido;
- "npm run demo";
- as 5 requisições sem estado de carregando: entra skeleton por bloco e try/catch com `.erro-bloco`.

**JS (`app.js`):**
- `kpiHtml` gera 4 KPIs + linha secundária;
- `#veredito` e `#proxima`;
- riscos divididos entre `#riscos` e `#qualidade`;
- paginação, busca e chips locais;
- textos sem emoji;
- links desabilitados sem href;
- cores lidas dos tokens:
  ```js
  const tk = n => getComputedStyle(document.documentElement).getPropertyValue('--' + n).trim()
  const CORES = { serie: tk('laranja'), planejado: tk('cinza'), ideal: tk('borda-campo'), barra: tk('cinza'), semana: tk('cinza-claro'), grade: tk('borda') }
  const corStatus = { nao_iniciada: tk('cinza-claro'), andamento: tk('azul'), validacao: tk('roxo'), concluida: tk('verde'), bloqueada: tk('verm'), dependencia_cliente: tk('ambar'), cancelada: tk('borda-campo') }
  ```
- `Chart.defaults.font.family = tk('fonte')`;
- `if (window.ChartDataLabels) Chart.register(ChartDataLabels)`. Sem `window.Chart`, os blocos de gráfico mostram `.erro-bloco` "Gráficos indisponíveis sem internet" e o resto da tela funciona.

**Celular:**
- filtros sem sticky;
- KPIs 2×2;
- riscos em 1 coluna;
- a tabela rola dentro do wrapper;
- Próxima ação com botão em largura total.

### 7.2 Cliente (`/cliente`), em detalhe

- **Shell:** Clientes › Cliente. `data-pagina="cliente"`. As abas da linha 2 e o grupo carregam `?cliente=`, e o `.ps-ctx` mostra "Cliente: Nome".
- **Pergunta (contrato):** "Como está este cliente, por quê, e o que aprovar agora?"

**Estrutura estática (`cliente.html`):**

```html
<main class="pg">
  <section class="pg-busca" id="telaBusca">
    <h1>Qual cliente?</h1>
    <p class="pg-pergunta">Nome ou CNPJ · atalho / em qualquer tela</p>
    <div class="busca-wrap">
      <div class="busca"><label class="sr" for="q">Buscar cliente</label><input id="q" type="search" autocomplete="off"><button class="btn" id="btnBuscar" type="button">Buscar</button></div>
      <div class="resultados" id="resultados" hidden></div>
    </div>
  </section>
  <div id="telaCliente" hidden></div>   <!-- era <main>; o cliente.js só usa o id -->
</main>
```

**Busca (`#telaBusca`):**
- largura de 560px, centralizada a 12vh;
- sem hero gigante nem emoji;
- `#q`, `#btnBuscar`, `#resultados`, `.res-item`, `.ativo` e `.busca-wrap` mantidos;
- o botão "Buscar cliente" do shell foca este `#q`;
- `/cliente?busca=` chega aqui já pesquisando (4.4).

**Cliente aberto** (`#telaCliente`, montado por `desenhar()`):

**A. Cabeçalho** (`.pg-cab`):
- `.volta` "← Clientes" (`.btn-fantasma.btn-p`, `onclick="voltar()"` mantido);
- `.pg-sobre` "Cliente";
- `h1` com o nome;
- `.pg-meta`: tier · canais · consultor ("Consultor a definir" em `--cinza-claro`) · squad. O CNPJ vai para Configurar.
- `.pg-acoes`:
  - `details.menu` "⋯" com `#btnPlacePlan` "Criar PlacePlan no Notion" (texto sem emoji; confirmação por `PS.confirmar` no lugar do `confirm`);
  - `details.menu` "Documentos", com nomes que não se repetem:
    - Documento do plano (`/plano?cliente=`);
    - PDF do plano;
    - Plano por anúncio (`/plano-conta`);
    - PDF do plano por anúncio;
    - Planilha CSV do plano por anúncio;
    - Semanal do cliente;
    - Semanal interno;
  - **primário** `.btn-primario` "Revisar plano (8 P0)". Ele abre a aba Plano com o filtro P0+P1 ligado e foca `#listaAcoes`. Sem P0: "Revisar plano".
- Cliente inelegível: um `.aviso` logo abaixo do cabeçalho (o único da tela acima da dobra).
- **Sai** o botão "Promoções do cliente": a aba Promoções do shell já leva o `?cliente=`.

**B. Veredito + KPIs** (sempre visíveis, acima das abas)
- **Veredito**, frase que reconcilia resultado e execução: "Faturamento **+69% em 28 dias**, mas a execução caiu para **×0,43 do ritmo**. Proteger o ritmo antes de escalar."
  - Fórmulas e pesos só em `title` ou `details`.
  - Sem retro ainda: só a parte de execução, e completa quando o retro chega.
- **3 KPIs**:

| KPI | Valor | Detalhe | Observação |
|---|---|---|---|
| Resultado do cliente (`#kpiResultado`) | faturamento 28d | Δ% + badge sólido Crescimento/Estagnação/Queda (`.ac-badge`) | `.sk-kpi` até o retro responder. Sem ML: "—" + link "Conectar Mercado Livre" → `/integracoes`. |
| Execução da equipe | entregas no mês "9 → 70 projetadas" | meta + tendência "×0,43 em 7 dias" | — |
| Risco | "8 P0 abertas" | "renovação em 23 dias", "vencida" ou "sem vencimento registrado" | Renovação nunca vira KPI próprio: com dado vazio ela fica só no detalhe |

**C. Abas da página** (`nav.abas.abas-fixas`, sticky em `top:var(--shell-h)`)
- Botões `[data-aba-cli]` com `aria-pressed`: **Resumo `<span class="estado e-piorou" id="nPiorou">3 pioraram</span>` · Plano `<span class="n">39</span>` · Anúncios `<span class="n" id="nAnuncios">35</span>` · Estratégia · Configurar**. `#nPiorou` só aparece com piora (atributo `hidden` quando 0); os dois contadores são preenchidos pelo evento `ps:acomp` (acomp.js → cliente.js), no padrão do `ps:retro`.
- Cada painel é `<section data-painel="…">` com `hidden` nos inativos. **Todos** os painéis e contêineres (`#ficha`, `#perfil`, `#vendas`, `#planoConta`, `#retro`, `#acomp`, `#precos`, `#impacto`, `#filtros`, `#listaAcoes`) são escritos por `desenhar()` e ficam no DOM, só escondidos, porque os `carregar*` abortam em silêncio sem o contêiner.
- Troca de aba: `history.replaceState(history.state, '', '?cliente=…&aba=…')`. **Nunca hash nem pushState**, porque o `popstate` do `cliente.js` reabre o cliente.
- `desenhar()` relê `?aba=` (padrão `resumo`) a cada execução.

**Painéis:**
- **Resumo** (padrão):
  - **"Próximas ações"** (`#proximasAcoes`, novo):
    - as 5 ações P0/P1 em proposta com maior nota, em linhas compactas: `.p-badge`, título, "Prazo 12/10 · Ana · Mercado Livre";
    - botões [Aprovar] (`.btn-mini.ok`) e [Descartar] (`.btn-mini.no`) com os **mesmos** `data-st`/`data-id`. JS: o handler de `#listaAcoes [data-st]` passa a valer também para `#proximasAcoes [data-st]`;
    - depois, "Ver todas as 39 ações", que leva à aba Plano.
  - **"Resultado das tarefas"** (`#secAcomp`/`#acomp`, `#btnAcompAtualizar`, `[data-modo]`; desde 07/10/2026 aqui, logo depois de Próximas ações — antes ficava escondido na aba Anúncios):
    - subtítulo "Cada tarefa concluída com o anúncio: vendeu? aumentou? reduziu? visitas? Antes × 24h · 48h · 72h · 1 semana · hoje, descontado o que os anúncios sem tarefa fizeram. Piorou vem primeiro.";
    - 4 KPIs: Tarefas com anúncio · **Pioraram** (R$ associados) · Melhoraram (R$ e lançamentos) · Sem anúncio identificado — o tom fica no ponto do rótulo, o valor nunca é colorido;
    - chips Com resultado medido · Piorou · Melhorou · Lançou · Em andamento · Sem base · Todas, com "(n)"; chip com 0 desabilitado; o padrão nunca abre vazio ("Todas" quando nada foi medido);
    - cartão `.ac-card` com `div.ac-veredito` (selo da família `.e-piorou/.e-melhorou/.e-lancamento/.e-sem_efeito/.e-em_maturacao/.e-sem_base` + título + linha), ↗ nos links, preço na janela com data, ponto no micro gráfico ("ponto = mudança no anúncio") e "O que mudou" com data;
    - ordem piorou → melhorou → lançou → sem efeito → maturando → andamento → sem base; 8 por página com `.t-pag` "Mostrar mais" (o foco vai para o novo botão);
  - **"Folha do anúncio"** (`#secFolha`/`#folha`, `#nFolha`; 08/10/2026, entre Resultado das tarefas e Depende do cliente — decisão 4 do David):
    - `fieldset#folhaCaixas` com **4 caixas de seleção nativas** `[data-topico]` (Anúncios — ofertas e promoções · Ads · Full · Métricas), cada uma com o contador do tópico em `[data-n]` (sobre o recorte filtrado; vazio até a resposta que o traz; o filtro novo zera), legend discreta "Marque os tópicos que quer ver na folha" e `#btnFolhaTudo` "Marcar tudo e ver a leitura" (`.btn.btn-p`, só com menos de 4). A escolha é lembrada por cliente em `localStorage` `ps_folha:<cliente>` (try/catch) e espelhada em `?folha=`;
    - **apresentação na 1ª abertura** (decisão 2): abre com as 4 marcadas e desmarca Anúncios → Ads → Full a cada ~1,5 s até sobrar Métricas; `prefers-reduced-motion` desmarca as três de uma vez; **qualquer clique ou tecla no bloco** (`pointerdown`/`keydown` em captura sobre `#folha`: caixas, ordem, filtro, "Ver tudo", links) interrompe e vale o que ficou; sem emoji nem texto tutorial;
    - `#fltFolha` (PSFiltros painel `folha`, `parametro: 'ff'`, período padrão últimos 90 dias), `select#folhaOrdem` (a ordem exige o bloco dela; option desabilitada sem ele) e `a#btnFolhaCsv` "Baixar a folha (com filtros e tópicos marcados)" (`.btn.btn-p` → `/api/cliente/folha.csv` com os mesmos `ff`/`blocos`/`ordem`; `aria-disabled` sem tópico);
    - `#folhaCorpo` (único trecho redesenhado): linha do período, até 4 KPIs (um por tópico; valor nunca colorido; tom `alerta` só no Full com risco de ruptura), `ul.an-comp` com a ressalva honesta de cada tópico ("não coletado" com `.selo.atencao` e o caminho para ligar), e `table.t.empilha.folha` de **no máximo 6 colunas**: Anúncio + 1 por tópico marcado (`td.fo-cel`, 2–3 linhas, "—" quando null) + Leitura (só com os 4: `.elo-t.fato/.hipotese` e `.p-badge` das ações do plano). "Ver tudo" (`[data-det]`, `aria-controls=#fdet-<MLB>`) abre `tr.det` com os detalhes, a leitura, as ações (`[data-ver-plano-anuncio]`) e "O que mudou em 30 dias"; 50 por página com "Mostrar mais" (foco no novo botão); abaixo de 640px a linha vira cartão. Vazios honestos: sem tópico, sem linha com os filtros, não conectado;
    - alvos de `scrollIntoView` na tela do cliente usam `#telaCliente [id]{scroll-margin-top}` com a altura da barra de abas sticky (41px), para o h2 não ficar atrás dela.
  - **"Depende do cliente"** (`#secDependeCliente`).
  - **"Motor de decisão" compacto**: `.grade` de 3 cartões (Previsão; Probabilidade, com `#formMetas`/`#mEntregas`/`#mGmv` quando não há meta; Causalidade). Sai o jargão "renormalizado / cobertura dos pesos" da face do cartão (vai para `title`).
- **Plano:** `.seg` "Por cliente (39) | Por anúncio (32)".
  - Por cliente:
    - chips `#filtros .f-chip` com `data-k` e `aria-pressed`, sem emoji: Todas · Alto impacto · Curto prazo · Longevo · P0 + P1 · Só fatos;
    - `#nAcoes` e `#listaAcoes` (cartões `.acao` enxutos; "Prazo 12/10 · Ana" em texto no lugar de 📅/👤);
    - "Registrar resultado" (`[data-res]`) vira **um** `<dialog>` com 3 campos no lugar dos 3 `prompt()`.
  - Por anúncio:
    - `#secPlanoConta`/`#planoConta`, com `#btnGerarPlano` como `.btn` secundário (o único cheio da tela continua sendo "Revisar plano" no cabeçalho);
    - `#btnDistrib`, `#msgPlano`, `#btnConfirmaDistrib`;
    - 4 números de previsão;
    - `#formCustos` em `details`;
    - link "Como o algoritmo funciona" → `/metodologia`.
- **Anúncios** (07/10/2026; o "Antes e depois" subiu para o Resumo como "Resultado das tarefas"):
  1. `#secOfertas` "Ofertas estratégicas" (1º bloco da aba);
  2. `#secAnuncios` "Anúncios no período" (filtros do painel `cliente`, inclusive "Preço mudou no período" e "Variação do preço");
  3. `#secPrecos` **"Cronologia de preços"** (`#precos`, em `VIVOS`): tabela `.empilha` de 6 colunas — Anúncio · Dia · De → Para · Variação · Origem · Vendas/dia 7d antes → depois —, a tarefa coincidente como etiqueta ("a própria tarefa" azul, "pode ter interferido" âmbar), piores quedas primeiro, 50 por página no servidor com "Mostrar mais" (falha da página 2+ fica só no rodapé, com "Tentar de novo" da mesma página), ressalva do servidor (uma leitura por dia; mudança que vai e volta no mesmo dia não aparece; 7 dias antes → depois não é efeito) e vazio honesto;
  4. `#secVendas` **"Mais vendidos, como o comprador vê"** (`#vendas`, `#btnColeta`; 12 cartões com `imgAnuncio`, ↗ no link público, "★ 4,7 · 406 avaliações" e "sem alertas nos dados disponíveis" em `.flag.bom`);
  5. `details.recolhido#secImpacto` "Medição técnica" (`#impacto`).
- **Estratégia:**
  - "Leitura estratégica": tese em 1 parágrafo, cadeia `.cadeia/.elo`, 3 jogadas, e "O que derrubaria esta leitura" em `details`. O "o Merovíngio" vira subtítulo pequeno "Leitura do Merovíngio". Saem 🎩 ⏳ ⚠️ 🧭.
  - `#secRetro`/`#retro`: estado, leitura e "Por que caiu" ou jogadas abertos; 80/20, Combinações e Duplicação recolhidos.
- **Configurar:**
  - `#secFicha`/`#ficha` (PSFicha);
  - `#secPerfil`/`#perfil` (todos os `#pf*` e `#btnSalvarPerfil`); desde 08/10 inclui `select#pfPromocoes` "Coletar promoções do Mercado Livre" (Padrão da base — com "(hoje: ligada|desligada)" vindo de `coleta_promocoes_padrao` do GET — · Ligada · Desligada), gravado no mesmo `POST /api/cliente/perfil` como `coleta_promocoes: true|false|null`; a linha "Em vigor" repete o estado. A tela de Promoções mostra uma única faixa `.aviso` em `#faixaColeta`: a nota "Coleta desligada para este cliente — Ligue em Configurar" entra na faixa de erro da coleta quando ela existe, senão sozinha como `.info`;
  - "Identificação" (CNPJ, squad, links das contas);
  - `details` "Ferramenta: diagnóstico de anúncio" (`#fAnuncio`, os 13 campos, `#resAnuncio`).

**Aprovar ou descartar sem recarregar a tela** (resolução do conflito entre vetos, ver 8.6)
- O fluxo de estado não muda: `api(...status)` → `a.status = st` → `desenhar()`.
- `desenhar()` passa a **reaproveitar os 7 contêineres vivos** quando o cliente é o mesmo e a **preservar o scrollY**. Resultado: sem os 7 refetches, sem skeleton e sem salto. Na prática só a linha e os contadores mudam.
  ```js
  const VIVOS = ['ficha', 'perfil', 'vendas', 'planoConta', 'retro', 'acomp', 'precos', 'impacto']
  function desenhar() {
    const main = $('telaCliente'), y = scrollY
    const reusa = main.dataset.cliente === dados.cliente && VIVOS.every(id => $(id))   // abrirCliente põe skeleton → reusa=false
    const vivos = reusa ? VIVOS.map(id => $(id)) : []
    main.innerHTML = `…template com cabeçalho, veredito, KPIs, abas e painéis…`
    main.dataset.cliente = dados.cliente
    vivos.forEach(n => $(n.id).replaceWith(n))                                        // conteúdo e listeners preservados
    /* …ligações de sempre (PlacePlan, formMetas, filtros, ações)… */
    mostrarAba(new URLSearchParams(location.search).get('aba') || 'resumo')
    if (reusa) scrollTo(0, y)
    else { carregarVendas(dados.cliente); carregarImpacto(dados.cliente); carregarPlanoConta(dados.cliente); carregarPerfil(dados.cliente); carregarFicha(dados.cliente); carregarRetro(dados.cliente); carregarAcomp(dados.cliente) }
  }
  ```
- **Resultado no KPI.** O `carregarRetro` (acomp.js) dispara `document.dispatchEvent(new CustomEvent('ps:retro', { detail: { cliente, estado, fat28, delta } }))`. O `cliente.js` guarda o último retro e preenche `#kpiResultado` e a cláusula de resultado do veredito. `desenhar()` reusa esse valor quando o cliente é o mesmo.

**Restrições:**
- código novo (abas, Próximas ações, veredito, `mostrarAba`) entra **antes** de `function desenharPerfil`;
- a chamada literal `api('/api/cliente/perfil', …)` fica intocada (teste-semanal-rotas);
- código novo não interpola `${x.rotulo}`, `${x.descricao}` nem `${x.id}` sem `esc()`;
- a ordem `ficha.js → acomp.js → cliente.js` se mantém;
- `.ac-grade{grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr))}`, o que corrige a rolagem horizontal no celular.

**Sai:**
- cerca de 200 glifos e emojis;
- os 4 botões de mesmo peso no topo;
- 5 faixas âmbar (no máximo 1 por aba);
- ficha e perfil antes do motor;
- `alert`/`confirm`/`prompt` (viram `PS.toast`, `PS.confirmar` e o diálogo de resultado);
- as 139 linhas de `<style>` inline;
- os cerca de 80 `style=` do `cliente.js` (viram utilitários);
- a página de cerca de 18.500px.

**Acima da dobra:** cabeçalho, veredito, 3 KPIs, abas e as primeiras Próximas ações. A ação principal sobe de cerca de 15.000px para cerca de 450px.

**Celular:**
- meta quebra linha;
- ações numa linha própria;
- abas rolam por dentro;
- Próximas ações empilham os botões;
- `.ac-grade` em 1 coluna.

- **Relatório para o cliente no Notion (08/10/2026):** menu "⋯" do cabeçalho ganha `#btnRelatorioAgora` "Enviar relatório ao Notion agora" (prévia → confirmação → toast com o link). Aba **Configurar** ganha `section#secRelatorio` (contêiner vivo `#relatorio`, em `VIVOS`) com a lista de seleção `#relFreq` (Desligado, Semanal, Quinzenal, Mensal), `#relProximo`, as próximas datas, a situação (selo), `#btnSalvarRelatorio` (`.btn`), "Liberar envio automático" (`#btnLiberarRelatorio`), "Verificar destino" (`#btnVerificarRelatorio`) e o histórico em `details.recolhido`. Tudo desenhado por `relatorio.js` (`PSRelatorio.montarConfig`); `cliente.js` só chama.

### 7.3 GMV (`/gmv`)

- **Shell:** Visão geral › GMV. `h1` "GMV da carteira".
- **Pergunta:** "Quanto a carteira conectada vendeu, e quanto da variação está associado ao trabalho?"
- **Cabeçalho:**
  - meta "Período 08/09–05/10 vs 11/08–07/09 · coleta 06/10";
  - à direita, `.seg#periodo` 14 | 28 | 56 dias (`data-d`, `aria-pressed` mantidos).
- **`#aviso`** vira chip de cobertura neutro "26 de 88 contas conectadas" na meta. Só vira `.aviso` com histórico incompleto (JS troca a classe).
- **Veredito:** "**R$ 352 mil** de GMV em 28 dias (**+4,1%**). R$ 5,5 mil da variação está associado ao trabalho."
- **KPIs** (`#kpis`, 3):
  1. GMV no período (delta no detalhe);
  2. Resultado associado: variação associada; detalhe "efeito líquido R$ 531 · 0,15% do GMV". Acaba a disputa entre os dois "associados".
  3. Lançamentos (bruto).
- **Próxima ação** (só se houver contas sem conexão): "62 contas sem conexão escondem o GMV" + [Conectar contas] → `/integracoes` (navegação real).
- **Abaixo:**
  1. `#ponte` "De onde veio a variação": cascata de verdade (anterior → associado → restante → atual), larguras por `variacao_associada` com sinal (corrige o `Math.abs`), valores escritos ao lado. Cores: `--cinza` (anterior, atual), `--laranja` (associado), `--borda-campo` (restante).
  2. "Quem move o resultado":
     - `.abas#abas` (consultor | analista | cliente, `data-a`);
     - `#tabela` com as mesmas 5 colunas nas 3 visões: Nome, GMV, vs anterior, Associado, Cobertura;
     - ordenada por impacto;
     - consultores sem conta conectada ocultos atrás de "Mostrar todos (7)";
     - `details.lin` sem subtabela aninhada.
  3. `details.recolhido` "Como ler esta página" (o `.explica` atual).
- **Sai:** o `.explica` aberto no topo, a faixa âmbar permanente, os `style=`, os hex fixos e a frase "clique na linha".
- **JS:** try/catch com `.erro-bloco`, skeleton, `AbortController` na troca de período.

### 7.4 Promoções (`/promocoes`)

- **Shell:** Clientes › Promoções (com `?cliente=`).
- **Pergunta:** "Em quais campanhas este cliente entra agora sem furar o piso de margem, e o que fica descoberto?"

**Escolha (`#telaEscolha`):**
- `h1` "Promoções";
- `.pg-pergunta` "Escolha um cliente com Mercado Livre conectado";
- `#chipsClientes` vira lista em linhas (CSS escopado), ordenada por prioridade (sem coleta, coleta velha, descobertos), com "coleta 05/10" ou badge "sem coleta".

**Cliente aberto (`#telaCliente`):**
- **Cabeçalho:**
  - `.pg-sobre` "Promoções";
  - `h1#titulo` (o `textContent` é testado; a tag pode virar `h1`);
  - meta = `#chips` em texto (`imposto não configurado` como badge atenção; os textos testados não mudam) + `#status` (selo "Coleta fresca · há 1 h" + `#progresso`).
- **`.pg-acoes`:**
  - `.pr-topo` compacto: "Trocar de cliente" (`.busca-wrap.pr-busca`, `#q`, `#resultados`);
  - `#quem` com label visível "Seu nome (obrigatório)" e borda `--ambar` enquanto vazio (`#quem:placeholder-shown`).
- **Faixa C "Próxima ação"** (`#proximo`, novo no HTML estático, escrito com `' id="proximo"'` precedido de espaço, porque o DOM falso do teste só registra esses ids):
  ```html
  <section class="proxima" id="proximo">
    <span class="proxima-rotulo">Próxima ação</span>
    <span class="proxima-texto" id="proximoTexto" aria-live="polite"></span>
    <span class="proxima-acao" id="proximoAcao"></span>
    <span class="pr-coleta"><button class="btn" id="btnColetar">Coletar agora</button><label class="pr-chk"><input type="checkbox" id="chkVendas"> atualizar vendas antes (lento)</label></span>
  </section>
  ```
  - `#btnColetar` e `#chkVendas` saem do `.cab-acoes` e moram aqui. Os ids e o handler não mudam.
  - JS (função nova **fora** do bloco `// <puro>`): calcula o passo a partir do estado `S`.

  | Situação | Texto | Primário |
  |---|---|---|
  | sem coleta | "Primeira coleta deste cliente" | `#btnColetar` ganha `btn-primario`; `#proximoAcao` vazio |
  | coleta velha ou parcial | "Coleta de há 3 dias / parcial" | `#btnColetar` primário |
  | sem imposto ou sem custo | "12 SKUs sem custo: a margem não é confiável" | [Configurar custos] → aba custos |
  | sugestões pendentes | "4 sugestões do analista aguardando" | [Aprovar sugestões] |
  | marcadas sem plano | "6 anúncios marcados sem plano" | [Gerar plano] (reusa o `data-acao` existente) |
  | plano em dry-run | "Plano pronto para aprovar" | [Aprovar plano] |

  - Fora dos passos de coleta, `#btnColetar` volta a `.btn` secundário. **Nunca há dois cheios.**
- **`#faixaColeta`**: `.aviso.erro`, só em coleta parcial.
- **`details.recolhido` "Detalhes da rodada"** com `#invariante` e `#pendencias` (o `<details open>` interno continua). Abre sozinho quando a rodada não fechou.
- **KPIs:** 4 em destaque: ≥ piso · Descobertos · Sem custo · Participando. Depois, Elegíveis · Marcadas · Cobertura incerta numa segunda linha compacta:
  - promocoes.css: `#telaCliente .kpis{grid-template-columns:repeat(4,minmax(0,1fr))}` e `#telaCliente .kpi:nth-child(n+5) .valor{font-size:var(--t-16)}`;
  - a marcação `rotulo</div><div class="valor">` e o rótulo "Descobertos" ficam idênticos;
  - JS: reordenar a concatenação dos `kp()`.
- **Abas** (`#abas.tabs`, `.f-chip` + `aria-pressed`, as mesmas chaves `?aba=` e os **mesmos rótulos**): Elegíveis · Participando e cobertura · Relâmpago · Plano │ Custos · Regras por SKU │ Interrogatório · Auditoria.
  - Os grupos secundários ficam depois de um filete, em cinza (`#abas .f-chip:nth-child(5){margin-left:var(--e-4)}` + filete por `::before`).
  - JS: só reordenar o array `ABAS`.
- **Aba Custos (07/10/2026), vínculo custo ↔ anúncio antes de "Importar custos":** três seções — "Custos sem anúncio" (candidatos pelo nome com miniatura, MLB, SKU e "semelhança N%", **Confirmar** / **Não é este**, e o campo "ID do anúncio (MLB…)" + Vincular), "Anúncios sem custo" (por faturamento em 30 dias; "Escolher custo" com uma `datalist#cvCustos` + Vincular) e "Custo por anúncio" (coluna **Origem do custo**: manual / SKU / SKU normalizado / herdado; manual com Desvincular via `PS.confirmar`, automático com "Não é este"). 50 por vez com `.t-pag`; a lista do servidor para em 500 e diz o total. Botões `.btn-mini` (nenhum cheio). Atalho "Vincular custo" na célula SEM CUSTO de Elegíveis abre a aba com o foco no anúncio (`#cvFoco`); a origem do custo aparece como sublinha na célula MC (sem coluna nova: Elegíveis segue em 6 + ação). O `por` vem de `localStorage['ps_perfil_por']`, depois de "Seu nome", depois de um `<dialog id="dlgPor">`. A seção antiga virou "Elegíveis a rebate sem custo".
- **Dentro das abas não há botão cheio** (o único é o da Próxima ação). A ação principal de cada aba vem primeiro, como `.btn`: Elegíveis "Aplicar analista" (ou "Aprovar sugestões"); Plano "Gerar plano", depois "Aprovar plano"; Custos "Importar custos". Prévia, CSV e "Aprovar todas" viram `.btn-fantasma`. JS: o `btn cheio` gerado nas abas passa a `btn`.
- **`.explica`** vai para `details` "Como funciona". Códigos crus (`NEEDS_EXTERNAL_DATA`…) viram rótulo, com o código no `title`.
- **`#avisoDecisao`** sai do topo e vira a frase do rodapé: "O módulo recomenda; quem decide e executa é você. Execução ao vivo desligada por padrão."
- **Sai:** as 6 faixas empilhadas antes do conteúdo, as 3 primárias concorrentes, o JSON cru na tabela do plano (vai para `details` "Chamada exata").
- **Fica:** os emojis 🤖 👤 ✔ ✖ ⚠ **só** nos textos que os testes conferem, até trocar teste e texto no mesmo commit (fase 3). `confirm()` e `prompt('EXECUTAR')` também ficam para a fase 3, com teste.

### 7.5 Analistas (`/analistas`)

- **Shell:** Time › Analistas.
- **Pergunta:** "Quem precisa de ajuda agora?"
- **Cabeçalho:**
  - meta "13 analistas oficiais · fonte: Notion";
  - `.pg-acoes`: "⋯" com `#btnSync` "Atualizar lista do Notion" (texto sem ↻).
- **Veredito:** "**973 tarefas travadas** na carteira. Comece por **Sara (124)** e **Bruno (98)**." (top 2 por atenção; os nomes são links que abrem o drill).
- **KPIs** (4, só da lista oficial, somados das linhas do ranking para fechar com ele):
  1. Analistas ativos;
  2. Entregas 28d (detalhe: ritmo por semana);
  3. Carteira aberta;
  4. Travadas (bloqueadas + paradas 30d+, detalhe "aproximação de atraso: o Notion não tem prazo"; ponto risco).
- **Próxima ação:** "Destravar a carteira de Sara (124 travadas)" + [Ver carteira de Sara]. O botão abre `#drill-Sara` (aciona o `.nome-btn[data-n]` existente) e leva o foco a ele.
- **Abaixo:**
  1. "Ranking do time" em `.cartao` com `.tabela-wrap`, 5 colunas:
     - Analista (`.nome-btn` `data-n`), Entregas 28d, Carteira, Clientes ativos, Atenção (badges);
     - ordenado por Atenção por padrão;
     - `th[data-k]` com os mesmos valores, `<button>` interno e `aria-sort` (o handler continua no `th` e lê `th.dataset.k`);
     - drill inline `tr#drill-<nome>`/`#drillbox-<nome>`: "Precisa de atenção" primeiro, datas dd/mm, e link "Matriz Eisenhower · interno" → `/matriz?responsavel=` (nova aba).
  2. "Clientes travados":
     - top 10 + "Ver todos (117)";
     - colunas Cliente (→ `/cliente?cliente=`), Bloqueadas, Paradas 30d+, Parada mais antiga, Responsável;
     - "Sem responsável" vira badge perigo no lugar da coluna "Prazo vencido", que estava sempre vazia.
  3. `details.recolhido` "O que o time entrega (90 dias)" (tipos e combinações, sem prometer resultado de vendas).
  4. `details.recolhido` "Qualidade do dado": cegueira de prazo 100%, 83% registrados no mesmo dia, lista oficial e quem ficou fora dela.
- **Sai:** os KPIs mortos (Atrasadas 0, Cegueira 100%), a coluna Velocidade (volta quando a medida for confiável), as 2 faixas de aviso antes do ranking, 👥 ⚠️ ↻ 👏, o CSS inline, cursor de ordenação em tabela que não ordena.
- **JS:** o `Promise.all` vira 3 cargas independentes; o `#btnSync` sai do template; ordenação padrão; KPIs a partir das linhas oficiais; veredito.
- **Cuidado:** nenhum elemento novo usa id com prefixo `drill-`.

### 7.6 Distribuição (`/planos`)

- **Shell:** Time › Distribuição. `h1` "Distribuição de planos".
- **Pergunta:** "Que ações vão para o Notion, para quem, sem criar tarefa errada em massa?"
- **Cabeçalho:**
  - meta "Nada vai ao Notion sem pré-visualização · no máximo 5 tarefas por cliente";
  - `.pg-acoes`: `#lnkCsv` "CSV do escopo" (`.btn-fantasma`) e "⋯" com `#btnEquipe` "Atualizar equipe" e `#btnSyncPrest` "Atualizar prestadores do Notion".
- **`ol.passos#passos`**, sticky em `top:var(--shell-h)` no desktop, com os botões **dentro**:
  - 1 Escopo · 2 Gerar (`#btnGerar` `.btn`) · 3 Revisar (âncora da tabela) · 4 Enviar (`#btnPrevia` "Pré-visualizar" `.btn` e `#btnDistribuir` **primário**);
  - `#btnDistribuir` fica desabilitado até a prévia e depois mostra a contagem: "Criar 42 tarefas no Notion" (JS, a partir do resultado da prévia);
  - `.atual` e `.feito` marcados pelo fluxo existente (JS).
  - É a faixa C desta tela: quem termina de revisar no fim da tabela envia sem rolar de volta.
- **Logo abaixo:**
  - `#job` (`.barra-progresso` com `#jobTxt` e `#jobBarra`; volta a `hidden` no fim, JS);
  - `#resultado` como `.aviso`: a criar, já existiam, sem usuário no Notion; erros em `details`.
- **Cartão "Escopo":**
  - `.seg#tipos` (botões `data-t` só com texto);
  - `#boxSquad`/`#boxConsultor`/`#boxSelecao` (com `#busca`, `#listaCli`, `#marcarVis`, `#limpar`) via `[hidden]`;
  - `#nEscopo`;
  - `#scoreMin` com label "Prioridade mínima" e ajuda "0–100 · padrão 11: abaixo disso a ação fica no plano e não vai ao Notion".
- **KPIs** (4, só do escopo):
  1. **Prontas para enviar** (número-norte: ações proposta ou aprovada acima da prioridade mínima que a distribuição criaria, respeitando o teto de 5 por cliente; se o payload não trouxer esse número, a fase 2 adiciona o campo na API em vez de recalcular no front);
  2. Urgentes 72h;
  3. Clientes com plano;
  4. Já no Notion.
- **"Revisar ações"** (corpo principal):
  - `#fHor`, `#fSt` (ganha "Obsoleta") e `#fTxt` com labels; debounce de 300ms no `#fTxt` (JS);
  - `#nAcoes`;
  - `.tabela-wrap.fixa` com `#tbAcoes` (6 colunas: seleção `.sel`/`#todas`, Prio, Cliente, Ação com `details` "evidência e critérios", Quando, Responsável numa linha + "+2", Status `.tag.p-*`), com badge "vai ao Notion" nas que entram;
  - `.barra-massa` (aparece com `:has(.sel:checked)`, sticky em `bottom:16px`):
    - `[data-st=aprovada]` "Aprovar marcadas", `[data-st=descartada]`, `[data-st=proposta]`, todos secundários (`.bt.sec` como hoje, em tamanho `.btn-p`; o único cheio da tela é o `#btnDistribuir`);
    - `#selDelegar` + `#btnDelegar`, `#nPrest`;
    - "⋯" com `#btnDesfazer` "Desfazer no Notion" como `.menu-perigo` com `PS.confirmar`;
    - São os **mesmos** elementos de hoje, movidos: os `[data-st]` não podem ter cópia em outro lugar (seletor global).
- **`details.recolhido` "Planos por cliente"**: `#tbClientes` com Cliente, Squad · Consultor, Ações, 72h, Documento, Equipe. `td[data-eq]` com o `<span>` contador como 1º filho; `tr.fichaLinha`/`.fichaBox` mantidos; a ficha abre como `.gaveta`.
- **Relatório curto ao Notion do cliente (08/10/2026, `src/web/relatorio.js`):**
  - `.pg-acoes` ganha `#btnRelAntecipar` "Enviar relatório antecipadamente" (`.btn` secundário e visível, ao lado de `#lnkCsv`; nunca o primário, que segue `#btnDistribuir`) e, no "⋯", `#btnRelFrequencia` "Definir frequência dos relatórios". Os dois usam os clientes do escopo atual (`clientesAtuais`); `travar()` desabilita o botão durante um job.
  - `td[data-eq]` de "Planos por cliente" ganha o botão `[data-rel-cliente]` "Relatório" (envio imediato daquele cliente) e a célula do cliente ganha o selo da programação no `.mini` ("Relatório: Semanal · próx. 16/10"). A tabela continua com 6 colunas.
  - Nova `details.recolhido#secRelatorios` "Relatórios para o cliente", depois de "Planos por cliente": resumo (`#relResumo`), selo do interruptor geral (`#relAgendadorEstado`), `#btnVerificarBases`, `#btnLiberarProntos`, `#btnAgendador`, `#lnkRelatorioCsv`, progresso (`#relJob`) e `#tbRelatorios` com 6 colunas (Cliente · Frequência · Próximo envio · Último envio · Situação · Ações).
  - Diálogos (`dialog.dlg.rl-dlg`) sempre mostram a prévia (texto que o cliente vai ler, destino, categoria, avisos) antes de qualquer envio; o botão de confirmar dentro do diálogo é `.btn-primario` do próprio diálogo, como nos diálogos de Ofertas.
- **`details.recolhido` "Gargalos da base"**: % sem prazo e sem responsável (com o rótulo "base inteira"), `por_regra`, `por_squad`.
- **Sai:** o degradê azul, os 6 botões com emoji, o `style="color:#fff"` do Desfazer, os `.explica` longos (viram `.sub` de 1 linha), `alert`/`confirm` (viram `PS.toast`/`PS.confirmar`).

### 7.7 Comercial (`/comercial`)

- **Shell:** Comercial.
- **Pergunta:** "Quais prospects já posso apresentar, e qual o próximo passo de cada um?"
- **Cabeçalho:**
  - meta "Prospects em diagnóstico de conta · o diagnóstico só lê a conta, nada é alterado" (a garantia aparece uma vez só);
  - **primário** no `.pg-acoes`: `<details class="menu novo">` com `summary.btn.btn-primario` "Novo prospect", que abre um painel com `#fNovo` (`#pNome`, `#pEmpresa`, `#pEmail`, `#pFone`, com labels visíveis). O submit mantém a classe `bt`, junto de `btn-primario`.
  - Com o painel aberto, o summary volta a ser secundário (`.novo[open]>summary{background:var(--superficie);color:var(--tinta);border-color:var(--borda-forte)}`), para nunca haver dois cheios.
- **Veredito:** "**2 prospects** prontos para apresentar; **1** pediu contato."
- **KPIs** (funil, 4): Pediram contato · Prontos para apresentar · Conectados sem dados (coletando ou falhou) · Aguardando conexão (detalhe "1 com erro"). Na fase 2, clicar num número filtra a lista.
- **`#infra`**: só aparece se a infra não estiver pronta, como `.aviso.erro` em linguagem de negócio. O detalhe técnico (.env, túnel, OAuth) fica em `details` "Detalhe técnico".
- **`#lista`**, ordenada por prioridade (pediu contato > pronto > sem dados > aguardando > erro), 4 colunas:
  1. Prospect: nome 600 + empresa; origem em badge neutro; "Pediu contato" em badge contorno;
  2. Etapa: um badge; o motivo do erro em texto visível (não só em `title`);
  3. Próximo passo: **um** `.btn-p` por etapa:
     - `[data-link]` "Copiar link";
     - `[data-ler]` "Ler os dados da conta" (rótulo intocado: o backend o cita);
     - "Ver relatório";
     - mais "Baixar PDF" **sempre visível** como `.btn-fantasma.btn-p` (os avisos do servidor mandam emitir o PDF);
  4. "⋯": Atualizar dados, `[data-diag]` Resumo rápido, WhatsApp e `[data-del]` Remover (`.menu-perigo` com `PS.confirmar`).
- **Resumo rápido:** continua em `tr#dx-<id> > td colspan="4" > .diag#dxbox-<id>`, agora com botão Fechar. O `colspan` acompanha o número de colunas.
- **Celular:** abaixo de 640px a linha vira cartão.
- **Sai:** o formulário fixo no topo, 🔥 ⚠️ ✓ ✕, os 4 botões mini de mesmo peso, o jargão OAuth/.env no subtítulo, a garantia repetida 3 vezes.

### 7.8 O que funciona (`/resultados`)

- **Shell:** Método › O que funciona.
- **Pergunta:** "Que tipo de tarefa traz resultado mensurável, e o que devemos rever?"
- **Cabeçalho:** meta "Período 10/05–06/10/2026 · 27 contas conectadas · associação, não causalidade comprovada".
- **Veredito**: 3 cartões em `.grade`, calculados no front com n ≥ 5, sem mudar a ordem da API (teste-impacto). Cada um com número + frase:
  - **Fazer mais**: maior limite inferior e R$ positivo;
  - **Rever**: piorou > melhorou ou R$ negativo;
  - **Ainda sem prova**: número de tipos com amostra pequena.
- **`#mensura`:** "100 de 802 tarefas com efeito medido (12%)" + barra empilhada com legenda em texto, no lugar dos 4 KPIs. Os canais não medidos viram 3 chips + "outros".
- **Próxima ação:** "Para medir mais: cite o MLB no card e preencha Concluído em" + [Ver processo] → `/processos`.
- **Abaixo** (07/10/2026: as colunas voltaram — a mini barra de 72px escondia o "piorou"):
  1. `#tipos`, **8 colunas** (exceção declarada em 5.7): Tipo · Tarefas · Melhorou · Sem efeito · Piorou · Taxa de melhora ≥ · Efeito mediano · R$ associado. A amostra pequena fica **visível** com selo; o botão é "Ocultar N tipos com amostra pequena". Selo "1 cliente" (`title` "resultado daquele cliente, não do grupo"). A 1ª célula é `button.lnk[data-drill]` que abre `tr.det > .drill` com as tarefas do grupo (`GET /api/resultados/tarefas`, piorou primeiro, 50 por página, "Mostrar mais"): miniatura e título do anúncio ↗, tarefa ↗, selo "preço" quando a medida saiu do aprendizado pelo preço, cliente (link), analista, data, selo do estado, efeito %, R$ e confiança. No topo do drill, contagens com selo (zero em cinza, sem selo).
  2. `#nichos` "Por nicho" (com o aviso de canal: "Toda medição é do Mercado Livre (Shopee N, Amazon N e TikTok N tarefas concluídas nas contas conectadas, sem API conectada)") e `#regioes` "Por região" ("Sem UF registrada" até a UF vir do cadastro do vendedor; nunca deduzida de CNPJ), mesmas 8 colunas, só n ≥ 5 e o resto na linha "Outros".
  3. `#lanc`: novo × reativado em 2 números, tabela recolhida.
- **Recolhidos:** "Nicho × tipo de tarefa" (`#secNichoTipo`, `#nNichoTipo`, `#nichoTipo`); "Histórico por analista · uso interno" (`#analistas`); "Palavras nas tarefas que funcionam" (`#secPalavras`/`#palavras`); "Como medimos" (o `.explica` + link para `/metodologia`, com o bullet do preço como fator de confusão).
- `#mensura` ganha a linha "N medidas fora do aprendizado por preço alterado na janela".
- **Sai:** a aula de estatística antes dos números, a frase corrida de canais, o ranking de pessoas aberto, os `style=` inline.

### 7.9 Algoritmo (`/metodologia`)

- **Shell:** Método › Algoritmo. `h1` "Algoritmo do plano".
- **Pergunta:** "Dá para confiar no motor que monta os planos?"
- **Cabeçalho:** meta com "versão `<span id="versao">`" em badge contorno + "15 regras ativas".
- **Veredito:** "563 ações geradas → **10 distribuídas (1,8%)** → **0 medidas**. A calibração começa quando as 10 distribuídas completarem 14 dias."
- **`#calib` "Está acertando?"**: 4 KPIs (Ações medidas, Erro médio em R$, Viés em R$ com "superestima", "subestima" ou "sem viés", Dentro do intervalo em %; Brier no detalhe). Com n = 0, um `.vazio-box` mostra o progresso até a 1ª medição.
- **Próxima ação:** "O gargalo é distribuir" + [Ir para Distribuição] → `/planos`.
- **Abaixo:**
  - `#regras` "Quais regras funcionam?":
    - ordenadas por situação (aposentadoria → validada → observação → sem dados);
    - nome legível com o id em `.num` mono 12px;
    - mini funil;
    - badge de situação (mapa SIT: neutro, atenção, bom, ruim);
    - totais no rodapé;
    - vira lista abaixo de 640px.
  - "Como funciona": os 5 princípios em 5 linhas curtas + `#ritual` como linha do tempo.
- **Recolhido:** "Parâmetros" (`#limiares`, rótulos humanos e unidades).
- **Sai:** as 2 paredes de texto no topo, o dump de configuração aberto, o TypeError cru.
- **JS:** checar `r.ok`; erro amigável com [Tentar de novo]; corrigir "viés 0 = subestima".

### 7.10 Processos (`/processos`)

- **Shell:** Método › Processos.
- **Pergunta** (esta tela usa `.pg-pergunta`, porque não tem veredito): "Como cada tarefa é feita, com qual evidência e quando está concluída?"
- **Cabeçalho:** meta "33 tarefas · 3 dependem do cliente · 2 de duplicação". Sem primário: o controle principal é o campo.
- **Controles:**
  - `.seg#abas` (Mercado Livre primeiro e aberto · Shopee · Amazon │ Duplicação; `data-a` ML/SHO/AMZ/DUP, classe `on` mantida);
  - `#busca` com label: guarda o termo entre abas (JS), busca também em passos e critério, estado "Nenhuma tarefa com esse termo neste canal".
- **`#conteudo` > `#lista`:** agrupada pelas 6 etapas como seções numeradas (1 Saúde → 6 Expansão), no lugar da faixa `.seq`.
  - `.cart` continua `<details>` com `data-txt` e `.cart[hidden]{display:none}`.
  - Fechado: nome + tipo + "depende do cliente".
  - Aberto: "Concluída quando" (`.cart .ok`) e Evidência primeiro; depois descrição, caminho, passo a passo, atenção e variações; "Manual 6.1" no pé do cartão.
- **Aba Duplicação:** resumo no topo (definição, regra de ouro, meta da 1ª página) + `.grade` com âncoras + link real para `/cliente`.
- **Recolhido:** "Regras do método" (as 8 regras).
- **Sai:** as tags "analista" (33 de 33) e "Manual X.Y" no resumo, o `--raio` de 14px próprio, o header que estoura em 375px.

### 7.11 Integrações (`/integracoes`)

- **Shell:** utilitário ativo (`.ps-int[aria-current]`), nenhum grupo marcado.
- **Pergunta:** "Quem está conectado, quem caiu, e o que fazer agora?"
- **Cabeçalho:**
  - meta "Tokens cifrados · nunca pedimos senha do marketplace" (uma vez só);
  - `.pg-acoes`: `#btnLinksCsv` "Baixar links de quem não conectou" (`.btn`, href mantido).
- **Veredito:** "Mercado Livre: **28 de 87** clientes que operam ML conectados (32%). **1 conexão caída.** Amazon e Shopee aguardam app oficial."
- **KPIs** (`#cards` reescrito como `.kpis`, 3): Cobertura ML (%) · Conexões caídas (ponto risco) · Operam ML e não conectaram (59).
- **Próxima ação:**
  - com conexão caída: "Reconectar Bima Peças" + [Copiar link de reconexão], que aciona o `[data-link]` da linha;
  - sem caída: "59 clientes que operam ML ainda não conectaram" + [Ver quem não conectou], que liga o chip correspondente e foca a tabela.
- **"Precisa de ação"** (a tabela, com o chip `data-f="acao"` ligado por padrão; o título acompanha o chip):
  - filtros: `#fq` com label; chips `.f-chip[data-f]` com contagem (Precisa de ação | Conectados | Sem conexão | Todos); `#fplano`; `#fdesl`;
  - `#tb` em `.tabela-wrap.fixa`, caídas primeiro;
  - o `<thead><tr>` fica **numa linha só com exatamente 6 `<th>` literais**, sem `scope`: Cliente · Mercado Livre · Outros canais · Custos · Situação · Ações. O vazio usa `colspan="6"`;
  - status em português com a instrução ("cliente precisa autorizar de novo: enviar link") no lugar do erro técnico;
  - Amazon/Shopee viram um chip "AMZ · SHO aguardando app" em "Outros canais", não 127 repetições;
  - 1 ação por linha + "⋯" com Restaurar/Desconectar (2º clique, como hoje);
  - abaixo de 640px a linha vira cartão.
- **`#custosPainel`** vira `.gaveta` lateral **só por CSS** (`#custosPainel:not([hidden])`). Os ids estáticos ficam iguais, o `?custos=` continua abrindo e o bloco `// <custos>` não é tocado.
- **`details.recolhido` "Configuração técnica"**, no fim: `#avisoConfig`, roadmap Amazon/Shopee, app público do Bling. Abre sozinho quando `configurado=false`.
- **`#dlgSegredo`** ganha a classe `.dlg`.
- **Sai:** o card técnico na 1ª dobra, Amazon e Shopee como KPI, "token até… (renova sozinho)" em toda linha, ✅ ⬜️ e "Copiado ✓" (vira "Copiado"), `alert`/`confirm` fora do bloco `<custos>`.

---

## 8. Regras de implementação e verificação

### 8.1 Nunca fazer

1. Emoji ou glifo decorativo em controle, título, rótulo ou estado. A exceção são os textos que um teste confere literalmente, até o teste mudar no mesmo commit.
2. Mais de 1 `.btn-primario` visível na mesma tela (conta o cheio de menu, de formulário aberto e de passo).
3. Cor fixa fora dos tokens: hex, `rgb` ou nome de cor em CSS novo, `style=` novo ou JS novo. Gráfico lê token com `getComputedStyle`.
4. `--nome:#hex` fora do 1º `:root` do `ui.css` (inclusive em comentário ou `@media`); token de cor em `var()`; segundo nome para uma cor; tema escuro dentro do `ui.css`.
5. Estilo inline novo (`style=`) em HTML ou template de JS. Use utilitário ou classe.
6. Remover, renomear ou mover para fora do DOM um id ou classe de `hooks_js`, um contêiner que o JS preenche ou um canvas do Chart.js. Abas e sanfonas só **escondem**.
7. Renomear classe ou valor gerado por JS (`data-k`, `data-st`, `data-acao`, `data-a`, `data-d`, `data-f`, `.tag.t-*`…) ou pôr filho dentro dos botões de `#tipos`.
8. Editar `alerta.js`.
9. `role=tab`/`tablist` em promoções; `<th scope>` ou thead em várias linhas em integracoes; `colspan` diferente de 6 ali.
10. `overflow-x:hidden` em `html`/`body` (use `clip`); `overflow` em `main` (quebra os stickies).
11. Estilo global sem escopo em `header`, `.topo`, `.marca` ou `.mini`.
12. `#ff6b1a` em texto, indicador ou gráfico; laranja em badge, fundo de botão, valor de KPI ou tom de status; valor de KPI colorido.
13. Foco só por `box-shadow` com `outline:none`; anel de foco que não seja `--laranja`.
14. Uppercase com tracking, serifa, webfont ou CDN de fonte; peso 700/800.
15. Caixa de veredito com fundo escuro, borda colorida ou badge; linha `.pg-pergunta` em tela que tem veredito.
16. Faixa "Próxima ação" cujo botão só rola até a seção logo abaixo.
17. Converter `#custosPainel` em `<dialog>`/`showModal` nesta rodada.
18. pushState ou hash nas abas internas do Cliente.
19. `alert`/`confirm`/`prompt` novos (use `PS.toast`/`PS.confirmar` ou `<dialog>`); `window.PS` no `promocoes.js` sem fallback.
20. Combobox ARIA próprio, Cmd+K ou `<datalist>` na busca do shell.
21. Copiar `data/db.sqlite` (para o scratchpad ou qualquer lugar) ou reiniciar o servidor fora do fluxo normal. Revisão visual só com GET na porta 3012, e o scratchpad é limpo depois.

### 8.2 Entrega em 3 fases (cada uma publicável sozinha)

1. **Identidade e shell (sem tocar no JS das telas).**
   - `ui.css` novo: `:root`, base, shell, template, componentes com aliases, famílias, específicos;
   - `promocoes.css` com o `:root{/*…*/}` e sem hex;
   - `acomp.css` retokenizado;
   - `shell.js`;
   - nas 11 páginas: `<head>`, `data-pagina`, placeholder + script, remoção dos headers, `styles.css`, `ui-extra.css` e `<style>` inline (apagar os dois arquivos **no mesmo commit** em que as 11 páginas passam a linkar `/ui.css`);
   - classes estáticas renomeadas;
   - `#proximo` estático em promoções;
   - string de estilo do `ficha.js`.
   - É o que o sócio aprova primeiro: a identidade fica única no mesmo dia.
2. **JS por tela, em ordem de valor:** Execução, Cliente, Distribuição, Promoções, Integrações, Analistas, Comercial, GMV, O que funciona, Algoritmo, Processos. Em cada tela, todo `btn cheio` ou `.bt` gerado por JS que não seja o primário da tela vira `btn` (na fase 1 o alias ainda os pinta como primário).
3. **Limpeza com teste:** `alert`/`confirm`/`prompt` restantes viram `PS.confirmar`; os emojis testados saem trocando teste e texto no mesmo commit.

Em **toda** fase rodar:
- `node scripts/teste-promocoes-ui.mjs` (primeiro, a cada mudança de token);
- `teste-custos-ui`, `teste-notificacoes`, `teste-semanal-rotas`, `teste-comercial-publico`, `teste-promocoes-rotas-mc`, `teste-meli-renovacao`;
- o novo `teste-shell-ui`;
- a suíte inteira `scripts/teste-*.mjs`.

### 8.3 Novo teste: `scripts/teste-shell-ui.mjs` (estático, no padrão do `teste-custos-ui`)

1. Para os 11 HTML:
   - `<body data-pagina="…">` com o valor de 2.2;
   - `<header class="ps-shell" id="psShell"></header>` seguido de `<script src="/shell.js"></script>` logo após `<body>`;
   - `/ui.css` linkado;
   - `/alerta.js` com `defer`;
   - nenhum `styles.css`, `ui-extra.css`, `<style>` ou `<header` além do placeholder.
2. Os ids de `hooks_js` de cada `docs/ux/inventario-*.json` existem no HTML ou no JS da tela (a Folha do anúncio está em `inventario-cliente.json`: `#secFolha`, `#folha`, `#nFolha`, `#folhaCaixas`, `[data-topico]`, `#btnFolhaTudo`, `#fltFolha`, `#folhaOrdem`, `#btnFolhaCsv`, `#folhaResumo`, `#folhaCorpo`, `[data-det]`, `#fdet-<MLB>`, `[data-ver-plano-anuncio]`, `[data-ir-configurar]`, `[data-ir-folha]`, `#pfPromocoes`; a nota de coleta desligada em `inventario-promocoes.json`).
3. Para cada valor das famílias geradas por dado existe seletor em `ui.css`, `acomp.css` ou `promocoes.css`:
   - `.t-{nao_iniciada,andamento,validacao,concluida,bloqueada,dependencia_cliente,cancelada}`;
   - `.tag.p-{proposta,aprovada,descartada,distribuida,obsoleta}`;
   - `.p-P0..P3`;
   - `.st-{aprovada,distribuida,descartada,proposta}`;
   - `.e-` com os 8 valores;
   - `.ac-{queda,estagnacao,crescimento,sem_base}`;
   - `.curva.cA/.cB/.cC`;
   - `.acao-{ENTRAR,PULAR,IGNORAR}`;
   - `.risco-grupo.ok/.ruim`;
   - `.kpi.bom/.alerta/.risco/.ruim`;
   - `.selo.{bom,neutro,atencao,amb,ruim,azul}`;
   - `.s-{ok,pend,erro,neutro,azul}`.
4. No `ui.css`, cada `--nome:#hex` aparece **uma vez** e dentro do 1º `:root{}`. O `promocoes.css` tem `:root{` sem `--nome:#hex`.
5. `node --check src/web/shell.js`, e `shell.js` sem `innerHTML`.

### 8.4 Checklist de verificação por tela (todas)

- [ ] Shell: grupo e aba certos marcados (`aria-current`), `<title>` no formato "Página · Place Sprints", `h1` repete a aba.
- [ ] 1 primário visível no máximo; ≤ 2 secundárias soltas; destrutivo só em menu com confirmação.
- [ ] Veredito responde à pergunta da tela e diz o que falta quando falta dado; ≤ 4 KPIs com valor em tinta.
- [ ] Faixa "Próxima ação" (se existir) dispara ação ou navegação real.
- [ ] Nenhum emoji em controle (exceto os testados); nenhum `style=` ou hex novo.
- [ ] Estados: skeleton no formato, vazio com instrução, erro com [Tentar de novo] por bloco.
- [ ] Teclado: Tab percorre tudo com anel laranja visível; `/` abre a busca; Esc fecha menus.
- [ ] 375×812: `document.documentElement.scrollWidth <= 375`; topo com 56px; tabelas rolam dentro do wrapper.
- [ ] 1366×768: veredito, KPIs e ação principal visíveis sem rolar.
- [ ] Sino no topo, painel abrindo para baixo, toasts no canto inferior direito.
- [ ] Contraste conferido nos pares novos (3.4).

**Específicos:**

| Tela | Conferir |
|---|---|
| Execução | Mudar qualquer filtro (inclusive dentro de "Mais filtros") recarrega; a busca local da tabela **não** dispara API; `#gPlanejado`/`#gStatus` desenham ao abrir o recolhido; Semanal/Matriz sem href até filtrar; com o CDN bloqueado a tela não morre; sprint padrão não é futuro. |
| Cliente | Aprovar em Próximas ações e no Plano: sem refetch (aba Network), sem skeleton, scroll mantido, contador e P0 atualizados; `?aba=` sobrevive ao aprovar e ao recarregar; voltar/avançar do navegador não reabre o cliente errado; a aba Promoções do shell leva o cliente depois de escolher pela busca; os 7 contêineres existem com a aba escondida. |
| GMV | Troca de período atualiza tudo; a ponte respeita o sinal. |
| Promoções | Só um cheio por estado do Próximo passo; os textos testados intactos; `#toast`/`#toastErro` nunca `hidden`; teste-promocoes-ui verde. |
| Analistas | Ordenar pelo teclado; drill abre e fecha (`tr[hidden]`); a Próxima ação abre o drill certo. |
| Distribuição | `#btnDistribuir` desabilitado até a prévia e com contagem depois; barra de massa só com seleção; nenhum `[data-st]` duplicado. |
| Comercial | Dois cheios nunca ao mesmo tempo com o painel aberto; PDF visível; "Ler os dados da conta" intacto; `colspan` igual ao número de colunas. |
| Integrações | teste-custos-ui verde; `?custos=` abre a gaveta; chip "Precisa de ação" é o padrão. |
| Processos | Busca esconde `.cart` (`[hidden]`) e mantém o termo entre abas. |
| O que funciona / Algoritmo | A ordem da API não muda (teste-impacto); n = 0 mostra progresso, não erro. |

### 8.5 Riscos técnicos e como estão cobertos

| Risco | Cobertura |
|---|---|
| Teste 58 lê o arquivo inteiro | 3.1 + checagem 4 do teste-shell-ui |
| Contêiner que some quebra em silêncio | Abas e recolhidos só escondem; check 2 do teste-shell-ui |
| JS que sobrescreve `textContent` de botão (`#btnSync`, `#btnPlacePlan`, `[data-ler]`, `[data-link]`, `[data-copia]`) | Botões só com texto; ícone só por `::before` |
| Seletores globais das telas | Nomes reservados (4.6); "Mais filtros" dentro de `.filtros`; busca local da Execução fora dela |
| CSS injetado pelo `ficha.js` vence por ordem | Editar a string de estilo do `ficha.js` (nenhum teste lê) |
| Mudança de semântica (sprint atual, analistas oficiais) | Explícito na meta-linha; validação do David antes (8.7) |
| Payload de 19,6 MB em `/api/tarefas` | 50 linhas por vez no DOM; o sprint atual como padrão reduz o volume; paginação no servidor quando incomodar |
| `:has()` e `details` como menu | Usados só como refinamento (Chrome 105+, Safari 15.4+, Firefox 121+); sem o `shell.js` os menus continuam funcionando, só não fecham ao clicar fora |
| `overflow-x:clip` no Safari < 16 | Risco aceito; medir `scrollWidth` nas 11 telas |
| Monkeypatch de `history.pushState` no shell | Chama o original e só atualiza hrefs do shell; sem efeito colateral nas telas |

### 8.6 Conflitos entre vetos e como foram resolvidos

1. **Busca do shell.**
   - O sócio vetou combobox próprio com Cmd+K e pediu datalist se houvesse campo.
   - A operação vetou datalist e também "só um link sem busca de verdade".
   - A engenharia vetou combobox ao vivo na fase 1.
   - **Decisão:** um botão honesto "Buscar cliente" (não parece campo). Nas telas que já têm busca, ele foca o `#q`. Nas outras, abre um formulário GET simples que reaproveita a busca do `/cliente`. Não é combobox, não é ao vivo, não é datalist, não tem Cmd+K e cabe em 15 linhas.
   - A única parte do pedido do sócio que fica de fora é o datalist, por veto direto da operação.
2. **Aprovar no Cliente.**
   - A operação vetou manter o redesenho completo com 7 refetches.
   - A engenharia vetou mudar o fluxo de estado e pediu manter `desenhar()`.
   - **Decisão:** o fluxo continua idêntico (aprovar → `desenhar()`). `desenhar()` reaproveita os 7 contêineres vivos do mesmo cliente e preserva o scrollY. Zero refetch e zero salto, sem ramo novo de estado.
3. **Laranja da marca (`#ff6b1a`).**
   - O sócio pediu um token decorativo `--marca` para o filete da aba ativa e para a série dos gráficos.
   - A operação vetou `#ff6b1a` como indicador de estado ativo.
   - A WCAG 1.4.11 exige 3:1 em gráfico (2,85 reprova).
   - **Decisão:** o `#ff6b1a` fica na logo, presente em toda tela. Filete e série usam `#b34100`. O token `--marca` não é criado, porque não sobrou nenhum uso.
4. **Esconder o sino até mover (`html.sh>body>#psSino{visibility:hidden}`).** O sócio pediu e a engenharia vetou.
   - **Decisão:** sem esconder nada. O `MutationObserver` move o nó numa microtarefa, antes da pintura, e se o shell falhar o sino continua visível no canto.
5. **"Tarefas" no Painel.** O executivo recolhia a tabela; a operação vetou.
   - **Decisão:** seção aberta, paginada em 50, com busca e chips, e é para lá que levam a Próxima ação e os "Ver todas (N)".
6. **Linha de pergunta no template** (exigida na estrutura do spec × veto do sócio).
   - **Decisão:** a pergunta é o contrato de conteúdo de cada tela. Só vira linha visível (`.pg-pergunta`) nas telas sem veredito.
7. **Nomes.**
   - Da proposta base saem "Receita" (vira GMV), "Conta" (vira Cliente) e o rótulo "0–30" (vira 0–100).
   - "Execução" continua como nome da aba inicial, no grupo Visão geral (ver 8.7).

### 8.7 Decisões que o David valida antes da fase 2

1. **Padrão "sprint atual"** na Execução: muda o número que o sócio vê ao abrir. A meta-linha diz "Sprint atual · trocar".
2. **KPIs do Analistas só com a lista oficial** ("13 analistas oficiais"): fecham com o ranking, mas mudam os totais de hoje.
3. **Nome da aba inicial:** "Execução" (recomendado: é o que a tela mede) ou "Painel executivo". A troca custa uma linha no `G` do `shell.js` mais o `h1` e o `<title>`.
4. **Laranja na interface em `#b34100`** (a marca `#ff6b1a` só na logo). É a única forma de o acento passar em texto, foco e indicador.

**Registro F0 (21/10/2026).** Nenhum assert de UI mudou. O único teste tocado foi `scripts/teste-meli-renovacao.mjs` (fixture do backup diário, fora do escopo dos nomes): `backupConexoes` guarda só os 14 nomes mais novos em `data/backups` e, com 14 backups reais acumulados, o fixture «2000-01-01» era podado no mesmo instante em que nascia (ENOENT). O fixture passou a «2999-12-31»; o propósito do teste (backup sem prospect, permissão 0600) é o mesmo. O selo ganhou o irmão `.sis-papel` sem mudar texto nem `title` (decisão 7 do doc dos 5 menus: `<small>` ao lado, não o `title`).
