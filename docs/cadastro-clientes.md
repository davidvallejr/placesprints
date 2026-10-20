# Cadastro do cliente (CS) — contrato e importação

Construído em 09/10/2026 a partir do pedido do David: "aproveite os dados da planilha Base Clientes e atualize o banco de clientes; estruture melhor o painel de cadastros".

## O que é

A central de clientes (`clientes_central`) continua vindo do Notion (`equipe.sincronizarEquipe`: UPSERT nas colunas dele e poda de quem saiu da central). O cadastro acrescenta **colunas que o sync não toca**, logo nunca são zeradas:

| coluna | tipo | significado |
|---|---|---|
| `cs_responsavel` | TEXT | CS responsável (nomes distintos por canal unidos por " / ") |
| `health_score` | REAL ou NULL | health score do cliente; `'—'`/vazio = NULL, **nunca 0 no lugar de NULL** (0 só quando a planilha diz 0) |
| `hs_classificacao` | TEXT | uma de `Saudável`, `Atenção`, `Risco`, `Dados insuficientes`, `Sem HS` ou vazio |
| `hs_em` | TEXT | dia local da leitura (muda quando o HS ou a classificação mudam) |
| `canais_cs_json` | TEXT | `[{canal, cs, hs, classificacao}]` por canal, como a planilha informa (na edição manual pode ser só `{canal}`) |
| `cadastro_fonte` | TEXT | `planilha AAAA-MM-DD` ou `manual AAAA-MM-DD` |
| `observacoes` | TEXT | texto livre |

Premissas declaradas da consolidação (a planilha tem 1 linha por cliente × canal): `health_score` = **média simples** dos canais com número (1 casa); `hs_classificacao` = a **mais grave** entre os canais (Risco > Atenção > Saudável > Dados insuficientes > Sem HS). O detalhe por canal fica em `canais_cs_json` e aparece na tela. A aba "Relatórios" da planilha é só informativa (aparece na prévia, não grava nada: a programação do relatório é de `relatorio-envio.js`).

## Casamento de nomes (nunca cria cliente)

`src/lib/cadastro-clientes.js`:
1. `normalizar`: NFKD, sem acento, sem pontuação, caixa baixa, espaços colapsados.
2. `casar(nome, nomesCentral, aliases)`: **exato** → **alias** (`config/clientes-aliases.json`, editável: "nome na planilha" → nome exato da central) → **contenção por palavra inteira** com ≥ 4 caracteres e candidato único. Dois candidatos = ambíguo; nada = não encontrado. Ambos viram pendência, nunca cliente novo (a central vem do Notion).
3. Dois nomes da aba Lista no mesmo cliente: o primeiro vale, o segundo é pendência `duplicado`.

## Importar a planilha

```
export PATH=$HOME/.local/node/bin:$PATH
node scripts/importar-base-clientes.mjs ~/Desktop/Base\ Clientes.xlsx            # prévia: o que muda por cliente + pendências; nada gravado
node scripts/importar-base-clientes.mjs ~/Desktop/Base\ Clientes.xlsx --aplicar  # grava e guarda as pendências em sync_estado (cadastro:pendencias)
```
Leitura do xlsx por `python3` + `openpyxl` (já instalado no Mac; nenhuma dependência nova no Node). Reimportar a mesma planilha é idempotente (0 mudanças). Pendência que você reconhece: acrescente o par em `config/clientes-aliases.json` e rode de novo.

Importação de 09/10/2026: 181 nomes, 146 casados (144 com mudança), 18 pendências (ver `GET /api/cadastro/pendencias`).

## HTTP (`src/rotas-cadastro.js`, montado em `server.js`)

- `GET /api/cliente/cadastro?cliente=` → `{ cliente, central:{status, tier, nicho, canais, consultores, lideres, cnpj, cpf, responsavel, vencimentos, atualizado_em}, cadastro:{cs_responsavel, health_score, hs_classificacao, hs_em, canais_cs, cadastro_fonte, observacoes}, relatorio:{frequencia, proximo_envio, ativado_por, pausado_motivo}|null, classificacoes, quem }`. `central` e `relatorio` são só leitura.
- `POST /api/cliente/cadastro` `{ cliente, por, campos:{cs_responsavel?, health_score?, hs_classificacao?, observacoes?, canais_cs?}, confirmar? }` → prévia `{ previa:true, mudancas:{campo:{de,para}}, n }`; `confirmar === true` (estrito; `"true"` é prévia) grava e devolve `{ previa:false, gravado_por, cadastro }`. Lista fechada de campos (campo extra = 400); `por` validado por `validarLiderOuConsultor` (403); JSON obrigatório (415); cliente fora da central ou prospect `[Comercial]` = 404. Mensagens fixas, sem eco do valor recebido.
- `GET /api/cadastro/pendencias` → `{ em, fonte, pendencias:[{nome, motivo: nao_encontrado|ambiguo|duplicado, candidatos, canais}] }` da última importação aplicada.

## Telas

- `/cliente` → aba Configurar → "Cadastro do cliente" (`#cad-sec`): central só leitura + campos do CS; botão `.btn` "Salvar cadastro" com prévia e confirmação; selo de fonte e data. Substitui o antigo bloco "Identificação".
- `/planos` → célula do cliente, `.mini`: `HS 74,1` + classificação no selo existente (o número nunca é colorido).

## Testes

`node scripts/teste-cadastro-clientes.mjs` (banco em memória, sem python, sem rede) e o caso "cadastro" em `scripts/teste-shell-ui.mjs`.
