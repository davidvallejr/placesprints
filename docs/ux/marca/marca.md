# Marca Place2u no Place Sprints (pedido do David, 21/10/2026)

Arquivos: `logo-place2u.png` (logotipo: "Place" preto + "2" e carrinho laranja), `cores.png` (paleta oficial).

## Paleta oficial

| Papel | Cor | Uso que a marca define |
|---|---|---|
| Azul principal | `#050b21` | cor principal (fundos escuros, títulos, shell) |
| Laranja | `#ff6a19` | **destaques em textos** — pouco, nunca como cor dominante |

Direção do David: "sofisticada, estrutura com aderência, bem moderna, **sem cores muito fortes**", comunicação clara.

## Tradução em tokens (proposta — a aplicar na reconstrução do layout)

Regra: o laranja oficial `#ff6a19` tem contraste 3,0:1 sobre branco → serve para destaque grande (selo, indicador da aba ativa, número em evidência, ícone), **não** para texto pequeno. Texto pequeno em laranja usa o tom escuro.

| Token (ui.css) | Hoje | Proposto | Nota |
|---|---|---|---|
| `--tinta-forte` | `#0c0a09` | `#050b21` | o azul principal vira a tinta forte (títulos, h1, valor de KPI) |
| `--tinta` | `#1c1917` | `#141a33` | texto corrente, azul-grafite (não preto) |
| `--cinza` | `#57534e` | `#5b627a` | texto secundário, frio |
| `--cinza-claro` | `#716a65` | `#7c8299` | |
| `--borda` | `#e7e5e4` | `#e4e7ef` | |
| `--borda-forte` | `#d6d3d1` | `#cfd4e1` | |
| `--fundo` | `#fafaf9` | `#f6f7fb` | fundo da página, levemente azulado |
| `--fundo-suave` | `#f5f5f4` | `#eef0f6` | |
| `--superficie` | `#ffffff` | `#ffffff` | cartões |
| `--laranja` | `#b34100` | `#ff6a19` | destaque grande (indicador, selo, ícone) |
| `--laranja-escuro` | `#8f3400` | `#c24f0e` | texto pequeno / botão primário (contraste 4,6:1) |
| `--laranja-suave` | `#fbf1ea` | `#fff1e9` | fundo de destaque |
| `--azul` | `#1d4ed8` | `#2f4bd6` | informação (links) — não confundir com o azul principal |
| `--veu` | `rgba(28,25,23,.4)` | `rgba(5,11,33,.45)` | |
| `--sombra*` | tons de preto | tons de `#050b21` | |

Shell (topo): fundo `#050b21`, texto `#ffffff`/`rgba(255,255,255,.72)`, aba ativa com sublinhado `#ff6a19`. Logo: o PNG oficial (ou SVG vetorizado dele) em `/logo`.

Estados (verde/âmbar/vermelho) continuam como estão: são semântica, não marca.

Aplicação: só no primeiro `:root` de `src/web/ui.css` (regra do sistema de design — cor só por token). Nenhuma tela recebe hex próprio.
