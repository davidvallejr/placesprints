# Estrutura › Estruturas e Equipe (`/estrutura`) — F3 dos 5 menus (21/10/2026)

Tela que responde «está ligado, configurado, funcionando?» para cada estrutura do Place Sprints, com estado **real** e honesto. Especificação: `docs/ux/arquitetura-5-menus.md` § A.6 e § G «F3»; inventário da tela em `docs/ux/inventario-estrutura.json`.

## O que é

Uma linha por estrutura (31 no catálogo), 6 colunas: **Estrutura · Sistema · Estado · Desde / por · Falta · Ação**. Ordenadas por gravidade (erro → pendente → desligado → pronto → ligado), com filtro por estado e por sistema. No topo, 4 números (ligadas · desligadas · pedem ação · incidentes abertos) e a contagem por camada. Abaixo, o bloco **Equipe e papéis** (`#secEquipe`, destino de Estrutura › Equipe), só leitura.

Estados (lista fechada): `ligado` · `desligado` (chave fechada; «nasceu desligada em …» quando ninguém mexeu) · `pronto` (chave de banco desligada com todos os pré-requisitos ok: um clique liga) · `pendente` (falta algo, com o nome do que falta) · `erro` (freio acionado, tick parado). Freios mostram «Acionado / Solto».

Camadas (lista fechada) e o que custa mudar:

| camada | onde mora | como muda |
|---|---|---|
| `banco` | `sync_estado` (`gatilhos_ligado`, `consultor_discord_ligado`, `relatorio_agendador`, `alerta_auto`, `dossie_mensal_ligado`, `chaveiro_execucao_parado`, `chaveiro_estoque_parado`) | botão nesta tela, com o nome de quem liga (líder/consultor validado no servidor) |
| `arquivo` | `config/*.json` (`chaveiro`, `algoritmo`, `nota-fiscal`, `gatilhos`, `sprint90`, `autogestao`, `equipe`, `discord-time`) | editar o arquivo e **reiniciar na janela combinada**; a tela mostra o valor **carregado** e marca «reinício pendente» quando o disco já difere |
| `env` | `.env` (só presença: `MELI_*`, `NOTION_TOKEN`, `PLACE_GATILHOS_*`, `ERP_TOKEN_KEY`, `SPRINT90_*`, `MP_*`, `BACKUP_DIR`, `FRIO_DIR`, `VIGIA_ENVIO_LIGADO`, `HEAD_CANAIS_WHATSAPP`…) | editar o `.env` e reiniciar; o valor nunca aparece |
| `externo` | launchd (`~/Library/LaunchAgents/com.place2u.*`), Notion, n8n, DevCenter | fora do sistema; a tela só diz se o agente está instalado |

Linhas especiais: **Freio geral do executor** e **Freio do estoque** (Parar/Retomar pelas rotas do Chaveiro), **Endereços públicos** (presença de `PUBLIC_BASE_URL`, `COMERCIAL_PUBLIC_HOST`, `SPRINT90_PUBLIC_HOST` e do agente do túnel; «túnel no ar» **não é verificado** pelo servidor), **Relógio do sistema** (ticks de `config/autogestao.json → ticks`: atrasado a 3× o período, parado a 6×, «sem batimento desde o início» quando nunca bateu).

## Código

- `src/lib/estrutura-estado.js` — PURO. `montarEstrutura(ctx)` → `{ lido_em, linhas[], resumo, incidentes }`; `verificar(id, ctx)` resolve os pré-requisitos **globais** de `config/ajuda.json` (env.*, chaves, cargos, plists, sync) e devolve `sem_leitura` com motivo para os por cliente. Listas fechadas exportadas: `CHAVES_BANCO`, `VARIAVEIS`, `PLISTS`, `ESTADOS`, `CATALOGO`.
- `src/lib/estrutura-estado-real.js` — fiação: configs carregados no início (`BOOT`) + cópia do disco (reinício pendente), `getEstado` só pelas chaves de `CHAVES_BANCO`, presença das variáveis via `src/lib/env.js`, Saúde do sistema injetada (ticks, sinais, incidentes), plists instalados, contagem de `promo_config.execucao_habilitada`, `lideresEConsultores()`. `equipeReal()` monta o bloco Equipe (nunca ids de usuário do Notion).
- `src/rotas-estrutura.js` — `GET /api/estrutura` e `GET /api/estrutura/:id` (404 fixo). **Nenhuma rota de escrita nasce aqui**: Ligar/Desligar chama `POST /api/gatilhos/chave`, `/api/consultor-discord/chave`, `/api/relatorio/agendador`, `/api/alertas/agendador`, `/api/dossie/mensal` (`{ ligado, por }`) e `/api/chaveiro/exec/parar|retomar`, `/api/chaveiro/estoque/parar|retomar` (`{ por, confirmar: true }`).
- `src/rotas-ajuda.js` — o (i) «Como fazer» passa a ler o estado real pelo mesmo contexto (`montarVerbete(id, { cliente, ctx })`); sem contexto continua `sem_leitura`.
- `src/web/estrutura.html` + `estrutura.js` + `tela-estrutura.css` — 12ª tela do shell (`data-pagina="estrutura"`), 0 botão primário, KPI nunca colorido, selo do sistema por linha (`SELO`, ordem do catálogo), (i) por linha via `dataset.ajuda`.
- `src/web/shell.js` — Estrutura › Estruturas → `/estrutura`; Estrutura › Equipe → `/estrutura?sec=secEquipe`.

## Testes

`scripts/teste-estrutura.mjs` (fixtures → estados, reinício pendente, verificar, catálogo × ajuda.json × rotas POST existentes, tela sem hex/emoji/primário, 6 `<th>`, rotas), `scripts/teste-shell-ui.mjs` (esqueleto e hooks da 12ª tela), `scripts/teste-sistemas.mjs` (os 8 selos de `SELO`), `scripts/teste-ajuda.mjs` (estado real pelo contexto; `sem_leitura` sem contexto).

## O que ficou de fora (honestamente)

- Túnel público «no ar» e último backup/restauração: não lidos (só presença de variáveis e agentes).
- Pré-requisitos **por cliente** nos (i) (dados fiscais, termo, liberação, canal testado…): continuam `sem_leitura` — a tela lê só o global.
- `#secSaudeSistema`, `#secConfig`, `#secS90` seguem em `/integracoes` e Comunicação em `/planos` (atalhos pelo «Onde»); mudam de casa na F7.
- Stepper global «Conectar: N de M…» no topo chega na F4.
