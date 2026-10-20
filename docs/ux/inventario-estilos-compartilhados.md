# Auditoria dos estilos compartilhados do Place Sprints (`/Users/davidvallejr/place-sprints/src/web`)

Só leitura: nenhum arquivo foi criado ou editado, o banco não foi copiado e o servidor na porta 3012 não foi tocado. Ele só recebeu GET, e o navegador rodou um `getComputedStyle` para confirmar o bug do sino descrito na seção 4.

**Resumo:** o sistema tem duas identidades visuais misturadas.
- **Azul:** só o `styles.css`, usado pelo Painel Executivo e pela tela Planos de Ação.
- **Laranja (estilo Airbnb):** todo o resto, em cinco cópias do `ui.css` que já divergem entre si.

O sino de avisos (`alerta.js`) aparece nas 11 páginas, mas usa cores laranja fixas no código, inclusive nas telas azuis. Ao todo existem cerca de 15 tipos de etiqueta colorida, 7 tipos de botão, 4 tipos de aviso e 7 larguras de página diferentes.

## 1. Quem usa o quê

| Página (rota) | CSS externo | `<style>` inline | Paleta |
|---|---|---|---|
| `index.html` (/) **Painel Executivo** | styles.css | não | **AZUL**: cabeçalho em degradê #1e3a8a→#1d4ed8, fundo #f1f5f9, texto #0f172a. Gráficos com cores fixas em `app.js:3` |
| `planos.html` (/planos) | styles.css | sim, 27 linhas | **AZUL**: botões `.bt` e `.esc button.on` azuis, `.barra` azul, avisos amarelos #fffbeb/#fde68a fora dos tokens |
| `cliente.html` (/cliente) | ui-extra.css, acomp.css | sim, 139 linhas: cópia literal do ui.css (confirmado por diff) + regras `.pf-*` do perfil | **LARANJA** |
| `analistas.html` | nenhum | sim, 57 linhas: parte do ui.css + tabela ordenável (`th.on` laranja), `.drill`, `.grade2`, `.selo.azul` | **LARANJA** |
| `comercial.html` | nenhum | sim, 47 linhas: `.bt` preto, `.kv`, `.diag`, `.aviso.amb`, `.selo.amb` | **LARANJA** |
| `integracoes.html` | nenhum | sim, 72 linhas: `.card`, `.s-ok/pend/erro/neutro/azul`, `.cu-*`, dialog, foco laranja; não define `--fundo` | **LARANJA** |
| `processos.html` | nenhum | sim, 28 linhas: `--raio:14px`, sem sombra, `.abas`, `.cart`, `.tg`, `.seq`; o logo `<img>` não aparece | **LARANJA** |
| `gmv.html`, `metodologia.html`, `resultados.html` | ui.css + ui-extra.css | não, mas repetem o mesmo `style=` inline no h1 e no `.sub` | **LARANJA** |
| `promocoes.html` | ui.css + ui-extra.css + promocoes.css | não | **LARANJA**, com tons escurecidos para contraste |

Scripts que injetam CSS:
- `alerta.js` está nas 11 páginas.
- `ficha.js` está em `cliente.html` e `planos.html`.

## 2. Cada arquivo

**styles.css** (68 linhas). Usado em index e planos.
- **Tokens:** `--azul #1d4ed8`, `--azul-escuro #1e3a8a`, `--azul-claro #dbeafe`, `--verde #047857`, `--ambar #b45309`, `--verm #b91c1c`, `--roxo #6d28d9`, `--cinza #64748b`, `--fundo #f1f5f9` (cinza), `--borda #e2e8f0`, `--tinta #0f172a`.
- **Tipografia:** fonte do sistema, base 14,5px. h1 19/800, valor do KPI 24/800, cabeçalho de tabela 11px em maiúsculas.
- **Raios e sombra:** raios de 6 a 14px, nenhuma sombra.
- **Componentes:**
  - Cabeçalho: `.topo` (degradê), `.marca .logo` 42px, `.acoes`, `.estado` (texto de status no cabeçalho).
  - Botões: `.btn` branco sobre azul, `.btn-claro` translúcido.
  - `.filtros`: barra fixa no topo com selects.
  - `main` com 1240px.
  - KPIs: `.kpi .v/.r/.e`, centralizado, tons `.bom/.alerta/.risco`.
  - Blocos: `.grade` (340px), `.cartao(.largo)` com h2, `.explica` (legenda pequena), `.semdados`, `.badge`, `.risco-grupo(.ok/.ruim)`.
  - Tabela: `table/th/td` **globais** e `.tabela-rolagem`.
  - Status: `.tag` + `.t-*` (os 6 status do Notion), `.atrasada`.

**ui.css** (133 linhas). Usado em gmv, metodologia, promocoes e resultados, e copiado inline em cliente.
- **Tokens:** `--laranja #ff6b1a`, `--laranja-escuro #e55600`, `--tinta #222`, `--cinza #717171`, `--cinza-claro #b0b0b0`, `--borda #ebebeb`, `--fundo #fff`, `--fundo-suave #f7f7f7`, `--verde #008a05/-suave #e8f6e9`, `--ambar #b45309/-suave #fef3e2`, `--verm #c13515/-suave #fdeae3`, `--azul #2563eb/-suave #e8f0fe`, `--sombra`, `--sombra-alta`, `--raio 16px`.
- **Cores fixas fora dos tokens:** `#fff1e8` (laranja suave, 4 usos), `#444` (texto de parágrafo), `#efefef`.
- **Tipografia:** base 15px. Hero clamp(26–40), h2 do cabeçalho clamp(22–30), h3 de seção 18/800, valor do KPI 26/800, rótulos 12px em maiúsculas.
- **Raios:** 8, 9, 12, 16, 20 e 999px.
- **Componentes:**
  - Cabeçalho: `header` fixo de 64px, `.marca` (com `b` laranja), `.header-links` em pílulas.
  - Busca: `.busca` em pílula, `.lupa`, lista suspensa `.resultados/.res-item`, `.pill-mini`.
  - Página: `main` com 1060px, `.volta`, `.cab/.chips/.chip(.laranja)`.
  - Botões: `.btn` com contorno escuro e `.btn.cheio` preto.
  - KPIs: `.kpi .rotulo/.valor/.detalhe` em 4 colunas, mais `.selo` (bom/neutro/atencao/ruim).
  - Blocos: `.secao`, `.motor`, `.cartao h4 .num`, `.inativo`.
  - Filtros: `.filtros` como fileira de chips, `.f-chip(.on)`.
  - Ações: `.acao` (`.p-badge` P0–P3, `.tagzinha`, `.btn-mini.ok/.no`, `.st-*`).
  - Outros: `details.evid`, `.vazio-box`, `.aviso-faixa`, `.skeleton`, `.cadeia/.elo/.elo-t`, `.jogadas`.

**ui-extra.css** (33 linhas). Usado em cliente, gmv, metodologia, promocoes e resultados. Não tem tokens próprios, depende dos do ui.css.
- **Componentes:** `.tabs`, `.tabela-wrap` + `table.t` (números à direita com `tabular-nums`), `.pos/.neg/.mudo`, `.barra/.legenda/.bola`, `.explica` como **caixa**, `details.lin`, `.item-card/.item-num`, `.flag`, `.estado` como **pílula** + `.e-*` (8 estados da medição).
- Também corrige a altura do cabeçalho no celular e o foco de `.tabela-wrap`.

**acomp.css** (38 linhas). Só em cliente, junto com `acomp.js`. Sem tokens; usa os do ui.
- **Componentes:** `.ac-badge` sólido (`.ac-queda/estagnacao/crescimento/sem_base`), `.ac-grade`, `.ac-bloco`, `.ac-v(.ok/.no/.mid)`, `.ac-mini` (miniatura do anúncio), `.ac-tab`, `.ac-card` (imagem de 190px + corpo, borda esquerda `.ok/.no`), `.ac-marcos` (tabela de marcos), `.ac-graf` (micro gráfico SVG de 56px), `.ac-ganho`, `.ac-vinc/.ac-cand/.ac-manual` (vínculo com o Mercado Livre).

**promocoes.css** (74 linhas). Só em promocoes.
- **Sobrescreve tokens para passar no contraste:** `--laranja-escuro #b34100`, `--verde #006b04`, `--cinza #666666`, `--azul #1d4ed8`.
- **Layout:** `main` com 1200px, KPIs em 7 colunas.
- **Componentes:** foco visível azul em toda a tela, `.aviso-faixa.ruim`, a família `.pr-*` (toast com `:empty` para regiões vivas, `.pr-bloco.travado/.perigo`, formulários, paginação, bloco monoespaçado do plano), `.curva.cA/.cB`, `.acao-ENTRAR/PULAR/IGNORAR`, `.btn-mini.sel/.perigo`, `code.pr`.

**alerta.js** (sino de avisos). Nas 11 páginas.
- **Cores:** tudo fixo no código, nenhuma `var()`: #222, #ff6b1a, #ebebeb, #717171, #fafafa, a tríade de sucesso/alerta/erro no claro (#008a05, #b45309, #c13515 com os tons suaves) e outra no escuro para os toasts (#2fb344, #e5483a, #f0a020, link #ffb27d).
- **Forma:** sombras próprias, z-index 9998/9999, fixo no canto inferior direito.
- **Componentes:** `#psSino` (pílula preta com contador laranja), `#psPainel` (380px), `.psItem` (`.sucesso/.alerta/.erro/.nova`), `.psToast`, animação `psEntra`, `@media print` que esconde o sino.

**ficha.js** (ficha do cliente). Em cliente e planos.
- CSS restrito a `.fch`, com `var(--tinta,#222)`, `var(--cinza,#555/#666)`, `var(--borda,#ddd/#eee)` e `var(--azul,#1d4ed8)`, sempre com valor reserva.
- Mensagens com cores fixas: #e8f6e9/#0a6b1a, #fdeae3/#b3260e, #fffbeb/#92400e. É um terceiro tom de verde, vermelho e âmbar.
- **Componentes:** formulário (label, input, select), tabela da equipe, `.msg ok/erro/aviso`, `button.b` e `.b.sec` (azuis), `.sug`.

## 3. Conflitos

**Mesmo token, valores diferentes:**

| Token | styles.css | ui.css e inline | promocoes.css |
|---|---|---|---|
| `--fundo` | #f1f5f9 | #fff | — |
| `--tinta` | #0f172a | #222 | — |
| `--cinza` | #64748b | #717171 | #666 |
| `--borda` | #e2e8f0 | #ebebeb | — |
| `--verde` | #047857 | #008a05 | #006b04 |
| `--verm` | #b91c1c | #c13515 | — |
| `--azul` | #1d4ed8 | #2563eb | #1d4ed8 |
| `--raio` | não existe | 16px (processos: 14px) | — |

Os tons claros também têm nomes diferentes nas duas identidades: `--azul-claro` contra `--azul-suave`, e o verde e o roxo claros (#d1fae5, #ede9fe) estão fixos no código, sem token.

**Mesma classe, significados diferentes.** Hoje não quebra porque os arquivos não se cruzam, mas vai quebrar se tudo for juntado num CSS só:
- `.explica`: legenda pequena e cinza (index, planos) contra caixa com fundo (gmv, metodologia, resultados, promocoes).
- `.estado`: texto no cabeçalho (index) contra pílula `.e-*` (`cliente.js`).
- `.filtros`: barra fixa com selects (index) contra fileira de chips (gmv, promocoes, cliente, integracoes).
- `.kpi`: duas marcações. `.v/.r/.e` centralizada em `app.js:44` e `planos.js:52`; `.rotulo/.valor/.detalhe` alinhada à esquerda e com sombra em todas as outras.
- `.btn`: branco sobre azul com `.btn-claro` contra contorno escuro com `.cheio`.
- `.bt`: preto em comercial, azul em planos.
- `.cartao`: sem sombra com h2 (styles); com sombra e h4 (ui); sem padding e com `overflow:hidden` para envolver tabela (analistas); com padding e margem (comercial).
- `.barra`: barra flexível de 14px no gmv contra barra de progresso `.barra>div` de 8px em planos.
- `.aviso`: 4 variantes (integracoes âmbar; comercial `.amb`; processos; planos amarelo com borda `.erro/.ok`).
- `.ok`: caixa verde em processos contra modificador em todo o resto.
- `.vazio`: caixa tracejada em comercial contra texto centralizado em integracoes.
- `.sub`: global em 4 páginas contra `.topo .sub` e `.secao .sub`.
- `.marca`: logo de 42px contra 32px.
- O seletor `header` do ui.css aplicado sobre `<header class="topo">` misturaria as duas versões.
- `table/th/td` globais com paddings diferentes em styles, analistas, comercial e integracoes.

**Etiquetas (15 variantes para a mesma ideia):** `.tag .t-*`, `.badge`, `.selo` (com `.amb` em comercial no lugar de `.atencao`, e `.s-*` em integracoes), `.pill-mini`, `.chip`, `.tagzinha`, `.p-badge`, `.elo-t`, `.flag`, `.estado .e-*`, `.ac-badge`, `.ac-v`, `.curva`, `.tg`, `.tag.p-*`.

**Botões (7 variantes):** `.btn` com dois significados, `.btn-mini`, `.bt` com dois significados, `.fch button.b`, `#psPainel button.mini`, `.esc button`, `.abas button`. Há ainda os chips de filtro `.f-chip`.

**Larguras de `main`:** 1240, 1060, 1200, 1120, 980, 1100 e 1000px.

**Escala tipográfica:** cerca de 22 tamanhos (de 9 a 40px) e pesos 400, 500, 600, 700, 750 e 800.

**Raios:** 6, 7, 8, 9, 10, 12, 14, 16, 20 e 999px.

## 4. Bugs encontrados de passagem

1. **Confirmado no navegador:** em `/` e `/planos`, a classe `.topo` do `styles.css` vaza para o cabeçalho do painel do sino (`#psPainel .topo`), que fica com o degradê azul e texto branco. O `getComputedStyle` retornou `linear-gradient(135deg, rgb(30,58,138), rgb(29,78,216))`.
2. Em `alerta.js`, `#psPainel button.mini{font:600 12px inherit}` é uma declaração inválida e o navegador a descarta.
3. Na tela de planos, a ficha herda do `styles.css` o `.grade{margin-bottom:20px}` e o `th` global (maiúsculas, `nowrap`, borda de 2px).
4. Na tela do cliente, que é laranja, os botões da ficha saem azuis (#2563eb).
5. `planos.js:61` usa `background:var(--fundo)` esperando cinza. Se `--fundo` virar #fff, a gaveta da ficha some no fundo; o certo é `--fundo-suave`.
6. Contraste abaixo de 4,5:1 na paleta laranja padrão:

| Texto sobre fundo | Contraste |
|---|---|
| #e55600 sobre #fff1e8 | 3,36 |
| #e55600 sobre branco | 3,71 |
| #ff6b1a em `.marca b` sobre branco | 2,85 |
| #008a05 sobre #e8f6e9 | 4,05 |
| #b0b0b0 (footer e dicas) sobre branco | 2,17 |
| contador branco sobre #ff6b1a | 2,85 |
| #64748b sobre #f1f5f9 (styles.css) | 4,34 |

## 5. Variáveis CSS usadas por JS e HTML inline (o novo sistema precisa definir todas)

| Arquivo | Variáveis |
|---|---|
| `cliente.js` | --ambar, --ambar-suave, --azul, --borda, --cinza, --fundo-suave, --laranja-escuro, --verde, --verde-suave, --verm, --verm-suave |
| `ficha.js` | --azul, --borda, --cinza, --tinta |
| `acomp.js` | --ambar, --ambar-suave, --verde |
| `analistas.js` | --azul, --azul-suave |
| `gmv.js` | --laranja, --laranja-escuro |
| `integracoes.js` | --fundo-suave, --verm |
| `planos.js` | --fundo (espera cinza) |
| `processos.js` | --cinza, --verm |
| `integracoes.html` (atributo `style=`) | --borda |

União com o que os CSS usam: 22 tokens. São `--laranja`, `--laranja-escuro`, `--tinta`, `--cinza`, `--cinza-claro`, `--borda`, `--fundo`, `--fundo-suave`, `--verde(-suave)`, `--ambar(-suave)`, `--verm(-suave)`, `--azul(-suave)`, `--azul-claro`, `--azul-escuro`, `--roxo`, `--sombra`, `--sombra-alta` e `--raio`.

**Cores fixas em JS que não leem token:**
- `app.js:3-4,106` tem a paleta dos gráficos: #1d4ed8, #047857, #b45309, #b91c1c, #6d28d9, #94a3b8, #cbd5e1 e #93c5fd.
- `gmv.js:31-35` usa #c9c2b8 e #8ea3b8.
- `planos.js:82` usa #b45309.

**Estilo inline:** há cerca de 170 atributos `style=` nos JS (80 só em `cliente.js`), quase todos de `margin-top`, `font-size`, `color` e `margin`. Sem algumas classes utilitárias, o visual continua derivando página a página.

## 6. O que precisa sobreviver

- **Famílias de classes montadas a partir de dados:**
  - `.tag.t-{nao_iniciada,andamento,validacao,concluida,bloqueada,cancelada}` (`app.js:159`)
  - `.tag.p-{proposta,aprovada,descartada,distribuida,obsoleta}` (`planos.js:83`)
  - `.p-P0..P3`, `.st-{aprovada,distribuida,descartada}` e `.e-{melhorou,piorou,sem_efeito,em_maturacao,sem_base,sem_controle,variacao_conta,lancamento}` (`cliente.js`)
  - `.ac-{queda,estagnacao,crescimento,sem_base}` (`acomp.js:28`)
  - `.curva.c{A,B}` e `.acao-{ENTRAR,PULAR,IGNORAR}` (`promocoes.js`)
  - `.risco-grupo.ok/.ruim`, `.kpi.bom/.alerta/.risco/.ruim`, `.selo.*` e `.s-*`
- **Teste que trava a mudança:** `scripts/teste-promocoes-ui.mjs`, caso 58.
  - Lê os tokens de `ui.css` e exige um bloco `:root{...}` em `promocoes.css`. Se o bloco não existir, `match()[0]` lança erro.
  - Os valores precisam estar em hex de 6 dígitos.
  - Exige contraste de pelo menos 4,5:1 em 15 pares de texto e fundo.
  - Conclusão: adotar globalmente #b34100, #006b04, #666666 e #1d4ed8, ou atualizar o teste.
  - O `teste-custos-ui.mjs` só confere ids e colunas de `integracoes.html`.
- **Acessibilidade:** foco visível, `.pr-toast:empty` (regiões vivas), `[hidden]{display:none!important}` (planos), `[tabindex="-1"]:focus`, sino escondido na impressão, `.tabela-wrap:focus-visible` e o `overflow-x:hidden` no celular.
- **Componentes a manter, em uma versão só cada:**
  - **Base:** skeleton (hoje há 3 cópias idênticas), busca em pílula com lista suspensa, chips de filtro, botões (`.btn`, `.cheio` e `.btn-mini` com ok/no/perigo/sel).
  - **Conteúdo:** KPI com rótulo, valor, detalhe e selo; cartão; seção; caixa explicativa; tabela com números alinhados; barra, legenda e bola do GMV; cartão de item; cartão de ação; cadeia e elos; jogadas.
  - **Avisos:** faixa de aviso, caixa de vazio, toast, dialog.
  - **Telas específicas:** cartões e marcos do acompanhamento com micro gráfico, formulário da ficha e o sino.

**Fora do escopo, mas vai precisar de alinhamento:** os HTML gerados no servidor (`src/lib/render-*.js`, `meli-paginas.js`, `erp-paginas.js`, `src/rotas-publicas.js`) têm CSS próprio. O `rotas-publicas.js` usa a paleta laranja com outros nomes de token (`--suave`, `--verde-s`, `--verm-s`, `--ambar-s`).