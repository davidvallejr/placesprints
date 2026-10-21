# Place Sprints — relatórios de evolução a partir do Notion

Transforma as tarefas registradas no Notion em **dashboard executivo**, **relatório
visual de sprint** e **PDF**, prontos para apresentar ao cliente. O Notion continua
sendo a única fonte oficial; este sistema espelha, calcula e apresenta.

- Dashboard: `http://localhost:3012`
- Relatório de sprint: `http://localhost:3012/relatorio?cliente=…&sprint=…` (+ `.pdf`)
- **Relatório Semanal Place2u**: `http://localhost:3012/semanal?cliente=…` (+ `.pdf`) — versão do cliente;
  `&interno=1` é a versão da equipe; `&perfil=direto,tecnico` troca o perfil só naquela geração (ver "Relatório Semanal v2")
- Exportação standalone (enviar ao cliente):
  `npm run relatorio -- --cliente "X" --sprint "Sprint 2026-09"`
  `npm run semanal -- --cliente "X"` · `npm run semanal -- --todos` · flags `--perfil id[,id]` e `--interno`

## Relatório Semanal Place2u (individual por cliente)

Segue o checklist oficial de coleta (identificação → ações concluídas → prints →
métricas dos últimos 7 dias → Ads → pontos de atenção). A **checagem de prontidão
automática** marca cada item como ✅ Recebido / ⚠️ Parcial / ❌ Faltando / ◻️ Opcional,
com o detalhe do que falta (ex.: quais tarefas concluídas estão sem print) — e agora
vive só na **versão interna** (`interno=1`); o relatório do cliente não mostra checklist
nem caixa de prontidão. `npm run semanal -- --todos` gera um arquivo individual por
cliente e lista no terminal quem está pronto para envio e quem tem pendência de coleta.

- Período padrão: os 7 dias completos até ontem; ajuste com `--de`/`--ate`
  (ou `?de=…&ate=…` na URL).
- **Identidade Place2u (premium)**: os dois relatórios usam o layout editorial
  da casa (Playfair Display + JetBrains Mono + Inter, papel quente, acento
  laranja, verdict box) com a narrativa oficial. A logo entra em todos —
  salve o arquivo oficial em **`assets/logo.png`** e ele prevalece
  automaticamente sobre a recriação vetorial `assets/logo.svg`.
- **Barra de progresso — Plano de Ação do mês**: os dois relatórios exibem o
  avanço do plano mensal do cliente (ações e esforço concluídos), calculado da
  base do Notion.
- **Plano oficial 5W2H**: a base "Informações" da página de cada cliente guarda
  os planos mensais por canal ("Setembro/26 - Amz" etc., tabela What/Why/Where/
  Quando/Who/How). O sync (`--completo` ou `--cliente`) e o `publicar` espelham
  o plano do mês corrente, e o semanal o apresenta como compromisso oficial
  logo abaixo da barra de execução.
- **Otimizações que movem venda**: seção do semanal que cruza as otimizações/
  alterações/melhorias concluídas com o efeito observado no painel de vendas.

## Relatório Semanal v2 — perfis, objetivo e resultados no topo

Contrato de dados completo: `docs/relatorio-semanal-contrato.md`.

**O que mudou no relatório do CLIENTE**
- Saíram o "Checklist de coleta", a caixa "Checagem de prontidão", o gráfico
  "Entregas por dia" e a seção "Próximos passos e dependências". Fica a barra de
  progresso do plano. A checagem continua existindo para a equipe (versão interna).
- **No topo: Resultados** — Mercado Livre, Ads e Outros canais. As métricas aparecem
  SEMPRE (bloco completo); quando um dado não existe o relatório mostra "—" e o
  motivo, nunca zero. O **Volume de atividades** também é sempre exibido.
- **Tarefas que geraram resultado**: lista das tarefas com o dado que o cliente quer
  ver, conforme o **objetivo** dele (abaixo).
- O relatório é estruturado pelo **perfil** do cliente (abaixo).

**Regras de honestidade (valem para todos os perfis)**
- Nunca se inventa número. Causalidade é sempre "causa provável", nunca "comprovada".
- Resultado **medido** (motor de atribuição `src/lib/impacto-tarefas.js`: só tarefa
  que "melhorou", ou lançamento que vendeu) é separado do **informado pela equipe**
  (campos do card) — cada item diz qual é.
- Nada é enviado a terceiros por este código; o PDF só sai para o Notion quando você
  roda o `publicar`.

### Perfis do cliente

Cada cliente tem 1 ou mais perfis. Os 7 perfis, os rótulos e as regras abaixo são
**definições propostas** (nenhum documento os definia) e ficam **editáveis** em
`config/perfis-cliente.json`; a tela, a API e o relatório leem de lá, então mudar o arquivo
muda tudo — nunca o código.

| Perfil | Ideia | Efeito principal no relatório |
|---|---|---|
| `analitico` | exige provas (prints, dados, resultado) | densidade completa, miniaturas de prova em toda ação e tarefa-resultado, "como medimos", gráficos, tabela de otimizações |
| `direto` | quer para ontem | enxuto: resultados e atenção primeiro, frases curtas, no máximo 5 ações e 3 resultados, 1 miniatura só nas tarefas com resultado, sem metodologia/gráficos/tabela |
| `relacionamento` | valoriza proximidade e parceria | tom de parceria, "Quem cuidou da sua conta" (responsáveis e nº de ações), destaques positivos em evidência, até 8 ações |
| `proativo` | participa e propõe | links abertos (card no Notion e anúncio clicáveis), produtos mais vendidos e ofertas ativas visíveis, dependências do cliente em Pontos de atenção como "Depende de você" |
| `zero_conhecimento` | precisa de linguagem simples | glossário: cada métrica com "o que significa" e "por que importa"; ROAS/ACOS/TACOS explicados na 1ª vez; até 6 ações |
| `tecnico` | quer detalhe e números | métricas extras (ACOS, TACOS, CTR, CPC, impressões, cliques, conversão em pontos, fórmulas), metodologia, gráficos, tabela de otimizações |
| `ansioso` | precisa de segurança e previsibilidade | tom tranquilizador (factual, sem alarme, sem esconder problema) e o bloco "Situação da conta em 1 olhar" com semáforo derivado só de fatos |

- **Combinação**: o **primeiro** perfil da lista que define a regra vence os conflitos de
  texto e de limites (`densidade`, `provas`, `linguagem`, `tom`, `max_*`); recursos de ligar/desligar
  (`glossario`, `metodologia`, `graficos`, `tabela_otimizacoes`, `mostrar_equipe`,
  `links_abertos`, `situacao_da_conta`, `metricas_extras`) se somam (OU).
- **Sem perfil salvo** o cliente usa `analitico` + objetivo `faturamento`; a tela mostra o
  aviso "Padrão".
- **Semáforo do perfil ansioso**: verde só com 0 tarefas atrasadas e 0 bloqueadas; senão
  amarelo, listando cada ponto com responsável e prazo. Vem só de fatos (atrasadas,
  bloqueadas, % do plano).
- **Editar as regras** em `config/perfis-cliente.json`:
  - `regras_base`: o valor de cada regra quando nenhum perfil do cliente a define;
  - `perfis.<id>`: `rotulo`, `descricao` e `regras` — só as regras que aquele perfil
    **define** (o resto vem de `regras_base`). Valores aceitos: `densidade`
    (`completa`/`media`/`enxuta`), `provas` (`completa`/`media`/`minima`), `linguagem`
    (`padrao`/`simples`/`tecnica`), `tom` (`neutro`/`parceria`/`tranquilizador`), os
    booleanos acima e `max_acoes`, `max_resultados`, `max_otimizacoes` (`0` = todas/todos;
    `max_otimizacoes` só vale com `tabela_otimizacoes` ligada);
  - `objetivos.<id>`: `rotulo`, `metrica`, `descricao`;
  - `padrao`: perfil(is) e objetivo de quem não tem perfil salvo.
  Erro de digitação (regra desconhecida, valor inválido, `padrao` apontando para perfil
  que não existe) derruba o carregamento com uma mensagem clara — não gera relatório errado.
  Perfil salvo para um cliente e depois removido da config é ignorado (com aviso), sem
  derrubar o relatório.

**Onde escolher o perfil**
- Página **`/cliente`** → bloco **Perfil do cliente**: perfil primário, perfis adicionais,
  objetivo e "Seu nome" (obrigatório — fica registrado junto do perfil), mais os links
  "Relatório semanal (cliente)" e "Relatório semanal (interno)".
- API: `GET /api/cliente/perfil?cliente=…` (perfil efetivo + listas de perfis e objetivos);
  `POST /api/cliente/perfil` com `{ cliente, perfis: [ids], objetivo, por }` (JSON; `por`
  obrigatório; ids validados contra a config).
- Só para uma geração, sem salvar: `/semanal?cliente=X&perfil=direto,tecnico`,
  `/semanal.pdf?…&perfil=…` ou `npm run semanal -- --cliente "X" --perfil direto`.

### Objetivo do cliente

Define qual dado aparece em "Tarefas que geraram resultado" (rótulos em `config/perfis-cliente.json`
→ `objetivos`):

| Objetivo | Dado mostrado por tarefa |
|---|---|
| `faturamento` (padrão) | receita adicional (causa provável) |
| `visibilidade` | visitas |
| `conversao` | conversão |
| `ads` | retorno dos anúncios (ROAS) |
| `margem` | só se houver custo informado do cliente; sem custo, cai em `faturamento` com nota honesta |
| `lancamentos` | novos anúncios que passaram a vender |

### Canal sem API (Shopee, Amazon, Magalu, TikTok Shop…)

O Mercado Livre e o Ads vêm da API quando a conta está conectada. Os demais canais não têm
API integrada, então **só aparece número que alguém informou** — a transcrição do painel do
canal em `config/metricas-semanais.json` ou os prints anexados aos cards daquele canal. Sem
isso o bloco do canal mostra o motivo ("sem integração e sem dado informado"), nunca um valor
inventado. Aparece um bloco por canal que tenha tarefa do cliente ou que a equipe tenha
transcrito em `canais`.

Formato (uma chave por cliente, com o NOME EXATO usado nas tarefas): a raiz continua sendo o
painel do Mercado Livre e `canais` guarda os demais, cada um com a sua `semana_de` — tem de ser
igual ao início do período do relatório (`de`; fixe com `--de`/`?de=` para a segunda-feira). Semana
diferente da analisada é IGNORADA, com o motivo no bloco, para não misturar períodos. Cada canal aceita
`faturamento`, `vendas`, `unidades`, `ticket_medio`, `visitas`, `conversao` e, opcionalmente, `ads`
(`investimento`, `receita`, `roas`, `acos`):

```json
"Cliente X": {
  "semana_de": "2026-09-28", "faturamento": 48350.9, "vendas": 312, "visitas": 15800, "conversao": 1.97,
  "canais": {
    "Shopee": { "semana_de": "2026-09-28", "faturamento": 5120.4, "vendas": 61, "unidades": 70, "visitas": 3900, "conversao": 1.6, "ticket_medio": 83.94 }
  }
}
```

### Versão interna (equipe)

`/semanal?cliente=X&interno=1` (e `/semanal.pdf?…&interno=1`, ou `npm run semanal -- --cliente "X" --interno`)
inclui as tarefas não visíveis ao cliente e, no fim, o "Checklist de coleta" e a caixa de
prontidão. O arquivo sai com o sufixo `-interno`. **Nunca vai ao cliente**: sem `interno` o PDF é
sempre o do cliente, e o `publicar` anexa SEMPRE a versão do cliente (a prontidão fica só no
log do terminal).

## Publicar no Notion (barra de progresso + linha com o PDF)

```bash
npm run publicar -- --todos        # sync → PDF premium por cliente → Notion
npm run publicar -- --cliente "X"  # um cliente só
```

Para cada cliente ativo da central, a rotina:
1. **atualiza o callout "📊 Plano de Ação"** no topo da página do cliente no
   Notion (barra ▓▓▓░░ + %, criado na primeira execução, atualizado depois);
2. **cria uma linha no quadro do cliente** — "Relatório Semanal — período" —
   com **Canal = "Relatório"** e **Demandas = "Relatório Semanal"** (assim o
   consultor filtra/reconhece essas linhas na visão do quadro), o resumo da
   semana, entregas, pontos de atenção e o **PDF completo anexado** (File
   Upload API) — sempre a versão do **cliente** (sem checklist); a prontidão
   continua aparecendo só no log do terminal, para a equipe. Essas linhas são
   ignoradas pelo sync (não viram tarefa nem entram nos indicadores). Os nomes
   dos campos e os valores usados são configuráveis em `config/mapeamento.json` → `linha_relatorio_semanal`.

O texto da linha e do relatório é escrito para soar como algo que um
consultor escreveu — sem jargão de sistema, sem menção a IA/automação, sem
excesso de emoji. Nenhuma peça entregue ao cliente expõe que foi gerada por IA.

**Agendamento semanal** (toda SEXTA-FEIRA, 17h00) — depois de configurar o `NOTION_TOKEN`:

```bash
cp ~/place-sprints/automacao/com.place2u.place-sprints.semanal.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.place2u.place-sprints.semanal.plist
```

> **Não carregar este plist junto com o relatório automático ao Notion** (`relatorio_agendador`, `docs/desenho-relatorio-notion.md`): o cliente receberia dois artefatos na mesma sexta. Hoje o plist não está carregado e continua assim enquanto o envio automático novo for o caminho.
- **Métricas e Ads**: os prints dos painéis anexados nos cards são a evidência;
  os números da tabela vêm de `config/metricas-semanais.json` (uma chave por
  cliente — transcreva do painel). Sem eles, o item fica ❌ Faltando na versão
  interna e o bloco do cliente mostra "—" com o motivo. Nada é inventado.
- Prevenção de erros embutida: alerta de print com data fora do período,
  print sem legenda e métricas de período diferente do analisado.
- **Links de anúncio**: URLs encontradas no card (conteúdo/bookmarks) e IDs
  reconhecidos (MLB…, ASIN) viram chips "🔗 Ver anúncio" — o cliente clica e vê.
- **Crescimento e faturamento**: cada semana validada de
  `config/metricas-semanais.json` (campo `semana_de` = segunda-feira da semana)
  entra no histórico `metricas_semana`; o relatório mostra deltas ▲▼ vs semana
  anterior, o crescimento da execução (entregas semana × semana, automático) e
  o gráfico de evolução do faturamento. Métricas de outra semana são ignoradas
  com aviso (anti-mistura de períodos).
- **Gráficos** (só nos perfis que pedem): ações por canal e faturamento semanal, no
  mesmo padrão visual do relatório de sprint. O gráfico "Entregas por dia" saiu da v2.

## Como rodar

```bash
cd ~/place-sprints
npm start            # servidor na porta 3012
npm run demo         # carga de demonstração (sem Notion)
npm run sync         # sincroniza do Notion (incremental)
npm run sync -- --completo   # revarredura total (rotina de segurança)
```

Ou clique em **Place Sprints.command** no Desktop.

## Decisão de arquitetura

| Alternativa | Veredito |
|---|---|
| 1. Só recursos nativos do Notion | Sem gráficos de evolução, sem galeria de evidências consolidada, sem PDF profissional, sem histórico de burnup. Descartada. |
| 2. Notion + Google Sheets | Duplica a manutenção (fórmulas + Apps Script), quebra fácil com renomeação de colunas, gráficos limitados. Descartada. |
| 3. Notion + n8n/Make | Bom para *disparar* o sync, fraco para *servir* dashboard/PDF; cada consultor dependeria de cenários pagos no Make. Adotado apenas como opção de gatilho (webhook). |
| 4. Notion + app web leve (embed) | Quase completa, mas sem cache não há incremental, histórico nem economia de tokens. |
| **5. Notion + app web + cache SQLite + PDF** | **Escolhida.** Custo zero de infraestrutura (roda local, como os demais sistemas Place2u), manutenção em um único repositório, dados sensíveis ficam na máquina, IA opcional e cacheada, escala para N clientes e N consultores (basta a base do cliente ter o ID cadastrado na central). |

Consumo de IA: **zero por padrão**. Conexão, leitura, paginação, blocos, imagens,
normalização, diff, indicadores, gráficos, HTML e PDF são 100% código. A IA entra
só no resumo executivo, *se* houver `ANTHROPIC_API_KEY`, recebendo apenas KPIs +
entregas + riscos (payload de ~1 KB), com cache por hash — se nada mudou desde a
última geração, nenhum token é gasto e o texto anterior é reutilizado.

## Conectar ao Notion

1. Crie uma **integração interna**: https://www.notion.so/my-integrations → *New integration*.
2. Copie o token para `.env` (use `.env.example` como base):
   ```
   NOTION_TOKEN=ntn_xxx
   ```
3. No Notion, **compartilhe com a integração** (menu ••• → Connections):
   - a base **"Assessoria em Gestão"** (central de clientes), e
   - as bases **"🛠️ Tarefas - {Cliente}"** — ou a página-mãe que contém todas.
4. `npm run sync`.

A descoberta de bases é automática e usa a realidade do workspace: os clientes
**ativos** da central (página "Ativos") são cruzados com a **busca** por bases
"Tarefas - {Cliente}" (o vínculo é o título — o campo "ID Database Tarefas"
está vazio em todos, mas prevalece se um dia for preenchido). A comparação
roda em 3 camadas, da mais para a menos estrita, **nunca por palavra solta em
comum** (isso já quase causou um falso positivo real: "Christian Ponce" quase
casou com a base "Christian Henrique" só pelo primeiro nome — o sistema
rejeita esse tipo de match):
1. **nome exato/variante** — nome completo, sem parênteses finais, ou o
   trecho antes de um hífen interno ("Cronometal - Lucas de Souza" → tenta
   "Cronometal"), com sufixos jurídicos (Ltda, ME, EIRELI…) removidos;
2. **sem espaços/pontuação** — resolve diferenças de espaçamento
   ("01Smart" ↔ "01 Smart");
3. **prefixo de palavras** — o nome mais curto precisa ser, palavra por
   palavra, o começo exato do mais longo ("Minas Geral" é prefixo de "Minas
   Geral Comercial").

Clientes que não resolvem em nenhuma camada aparecem nominalmente no log do
sync — não são adivinhados. Para esses, cadastre o nome real da base em
`config/fontes.json` → `"apelidos"` (chave = nome na central, valor = nome
real da base) assim que confirmar qual é a base certa; ou o `db_id` direto em
`"bases"` quando o título nem segue o padrão "Tarefas - {Cliente}".

```json
{ "db_id": "xxxxxxxx", "cliente": "Nome do Cliente", "projeto": "Nome do Projeto" }
```

O cliente usa a **API atual** (`Notion-Version: 2025-09-03`, com *data sources*)
e cai automaticamente para `2022-06-28` quando a rota/integração não suporta.
Rate limit respeitado (~3 req/s), retry com backoff honrando `Retry-After`,
falha em uma fonte **não** derruba o restante do sync.

### Sincronização: webhook + rotina de segurança

- **Sob demanda**: botão *Sincronizar* no dashboard (incremental: só o que mudou
  desde o último sync, via filtro de `last_edited_time`).
- **Webhook** (opcional): aponte o webhook da integração para
  `http://SEU-HOST/webhook/notion`. No primeiro POST o Notion envia um
  `verification_token` — ele aparece no log do servidor para você colar na tela
  da integração. Edições em rajada geram **um** sync (debounce de 5 s).
- **Agendada** (recomendada como reforço): 1×/dia um sync completo revarre tudo,
  cobrindo eventos perdidos:
  ```bash
  crontab -e
  # todo dia às 7h30
  30 7 * * * PATH=$HOME/.local/node/bin:$PATH cd $HOME/place-sprints && node scripts/sync.mjs --completo >> data/cron.log 2>&1
  ```

### Evidências

O sync lê **recursivamente os blocos internos** de cada card alterado e reconhece
`image`, `file`, `pdf`, `video`, `bookmark` e `embed`. Arquivos hospedados no
Notion têm URL assinada que **expira em ~1 hora** — por isso são baixados na hora
para `data/evidencias/<tarefa>/`, preservando o vínculo evidência ↔ tarefa
(nunca se misturam: a chave é o `block_id` dentro da página da tarefa).

## Mapeamento de campos (nada fixo no código)

`config/mapeamento.json` relaciona cada campo lógico a uma **lista de nomes
candidatos** — o primeiro que existir na base vence. O padrão já cobre o schema
Place2u (`Tarefas`, `Canal`, `Data`, `Data de Conclusão`, `Responsável`,
`Status`, `Descrição`, `Tag`). Status reais → 6 categorias universais na seção
`status_normalizacao` do mesmo arquivo.

**Se um campo não existir**, o sistema continua funcionando com o que há,
sinaliza a ausência no log do sync e **não inventa dados** (o relatório marca,
por exemplo, entregas sem resultado informado como "atividade executada").

### Campos recomendados para relatórios mais ricos

Criar nas bases de tarefas do Notion (nomes já mapeados por padrão):

| Campo | Tipo no Notion | Habilita |
|---|---|---|
| `Sprint` | Select (ex.: "Sprint 2026-09") | agrupamento exato por sprint. Sem ele, o sprint é derivado da data (modo mensal/quinzenal em `config/mapeamento.json`) |
| `Peso` | Number (1–8) | esforço planejado × entregue (produtividade real, não contagem de cards) |
| `Resultado esperado` / `Resultado alcançado` | Text | seção "Evolução dos processos" (antes → depois) |
| `Impacto` | Text | narrativa de valor para o cliente |
| `Bloqueio` | Text | motivo na tabela de pendências + decisões do cliente |
| `Próximo passo` | Text | ação de recuperação e foco do próximo ciclo |
| `Prazo` | Date | detecção de atraso |
| `Exibir ao cliente` | Checkbox | oculta tarefas internas do relatório (dashboard mostra tudo; relatório só o marcado — use `&interno=1` na URL para ver tudo) |

## Como o consultor usa (zero prompt, zero token)

1. Trabalha normalmente no Notion (cards, prints na descrição, status).
2. Ao fechar o sprint: abre o dashboard → filtra cliente + sprint →
   **Relatório do sprint** → confere → **PDF** ou `npm run relatorio -- --cliente "X" --sprint "Y"`.
3. O HTML exportado de `data/relatorios/` é **autossuficiente** (evidências
   embutidas em base64) — dá para enviar por e-mail/WhatsApp ou hospedar.

**Embed no Notion**: cole a URL do dashboard/relatório num bloco `/embed`.
Localmente (`localhost:3012`) o embed só renderiza na sua máquina; para o
cliente acessar por link, exponha com Cloudflare Tunnel (`cloudflared tunnel
--url http://localhost:3012`) ou publique numa VPS — o app é um único processo Node.

## Estrutura

```
config/mapeamento.json   campos + status + regra de sprint automático
config/fontes.json       de onde vêm as tarefas (central de clientes + bases avulsas)
src/lib/notion.js        API Notion (versão atual, retry, throttle, paginação)
src/lib/sync.js          sync incremental, evidências, snapshots, histórico
src/lib/extrair.js       propriedades, blocos, hash de conteúdo
src/lib/metricas.js      todos os indicadores (código puro)
src/lib/relatorio.js     montagem das 9 seções do relatório
src/lib/render-relatorio.js  HTML do relatório (link, embed e PDF)
src/lib/ia.js            resumo executivo (opcional, cacheado, com fallback)
config/perfis-cliente.json  perfis, objetivos e padrão do Relatório Semanal v2 (editável)
src/lib/perfil-cliente.js   perfil/objetivo por cliente (banco + mesclagem de regras)
src/rotas-perfil.js      ?perfil=/?interno= do semanal e a API /api/cliente/perfil
src/server.js            dashboard + APIs + PDF + webhook (porta 3012)
scripts/sync.mjs         CLI de sincronização
scripts/exportar.mjs     HTML standalone + PDF
scripts/seed-demo.mjs    dados de demonstração
data/                    db.sqlite, evidencias/, relatorios/ (fora do git)
```

## Integração Mercado Livre (OAuth via botão no Notion)

O cliente não tem acesso ao `localhost` — então a conexão da conta dele com
o Mercado Livre acontece a partir de um **botão dentro da própria página do
cliente no Notion**. Ele clica, autoriza no Mercado Livre, e pronto: os
relatórios passam a usar dados reais de vendas, produtos, ofertas e Ads.

### Como funciona (visão geral)

```
Página do cliente no Notion
  → callout "🛒 Conectar conta do Mercado Livre" (link assinado, expira em 60 dias)
  → cliente clica → abre no navegador dele (fora do Notion)
  → Place Sprints redireciona para o Mercado Livre (tela de login/autorização)
  → cliente autoriza → Mercado Livre devolve um código para o Place Sprints
  → Place Sprints troca o código por tokens e guarda, cifrados, por cliente
  → relatório semanal passa a usar Vendas/Produtos/Ofertas/Ads REAIS dessa conta
```

O Mercado Livre **exige HTTPS público** no redirect — por isso o sistema
precisa de um domínio acessível de fora da sua rede, não apenas
`localhost:3012`.

### Passo 1 — expor o sistema num domínio público fixo

Use um túnel **nomeado** do Cloudflare (não o `--url` temporário, que muda de
endereço a cada reinício — quebraria a integração):

```bash
# uma vez, se ainda não tiver o cloudflared:
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create place-sprints
cloudflared tunnel route dns place-sprints meli.place2u.com.br   # ou o subdomínio que preferir
```

Crie `~/.cloudflared/config.yml`:
```yaml
tunnel: place-sprints
credentials-file: /Users/davidvallejr/.cloudflared/<ID-DO-TUNNEL>.json
ingress:
  - hostname: meli.place2u.com.br
    service: http://localhost:3012
  - service: http_status:404
```

Rode o túnel (deixe sempre ativo, ex.: `cloudflared service install` para
rodar como serviço do sistema):
```bash
cloudflared tunnel run place-sprints
```

### Passo 2 — criar o app no Mercado Livre

1. Acesse **developers.mercadolivre.com.br/devcenter** → *Criar aplicação*.
2. Nome: "Place2u — Relatórios" (ou o que preferir).
3. **Redirect URI**: `https://meli.place2u.com.br/meli/callback` (o mesmo
   domínio do túnel + `/meli/callback` — exato, sem barra a mais).
4. Escopos: `read` (leitura de pedidos, itens, ADS) + `offline_access`
   (necessário para receber o `refresh_token` e renovar sozinho depois).
5. Copie o **Client ID** e o **Client Secret**.

### Passo 3 — configurar o `.env`

```bash
PUBLIC_BASE_URL=https://meli.place2u.com.br
MELI_CLIENT_ID=xxxxxxxxxxxxxxx
MELI_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MELI_TOKEN_KEY=$(openssl rand -hex 32)
MELI_LINK_SECRET=$(openssl rand -hex 32)
```

### Passo 4 — publicar o botão em todos os clientes

```bash
npm run publicar -- --todos      # já inclui o botão (roda toda sexta)
# ou, para lançar AGORA sem esperar a rotina semanal:
node scripts/meli-botoes.mjs --todos
node scripts/meli-botoes.mjs --cliente "Damar"     # um cliente só
```

Isso cria (ou atualiza) um callout no topo da página de cada cliente ativo
com o link de conexão. O dashboard mostra quantos já conectaram no topo
("🛒 Mercado Livre: N/135 conectados").

### Os 4 relatórios

Depois de conectado, o relatório semanal passa a incluir, automaticamente:

| Relatório | Fonte | Onde aparece |
|---|---|---|
| **Vendas** | `/orders/search` (pedidos pagos no período) | Seção 2 — substitui a transcrição manual |
| **Produtos com mais vendas** | mesmos pedidos, agregados por item | Seção 2 — tabela com link para o anúncio |
| **Ofertas** | API de Promoções do vendedor | Seção 3 — lista de promoções ativas |
| **Ads** | API de Product Ads / Mercado Ads | Seção 3 — investimento, ROAS, ACOS |

Sem conexão, o relatório continua funcionando exatamente como antes (prints
+ `config/metricas-semanais.json`) — a integração é aditiva, nunca obrigatória.

**Limitação conhecida**: Visitas e Taxa de conversão não vêm da API de
pedidos — exigem um endpoint separado (visitas por item) ainda não
implementado nesta primeira versão; ficam em branco quando a fonte é o
Mercado Livre (nunca inventadas). Ofertas e Ads usam endpoints mais novos do
Mercado Livre que variam por tipo de conta — se a conta do cliente não tiver
a funcionalidade habilitada, a seção aparece como "indisponível" em vez de
quebrar o relatório.

### Plano da conta por anúncio, previsão e metodologia

- **Diagnóstico** (`src/lib/diagnostico-conta.js`) lê só dados já coletados do Mercado Livre (pedidos e visitas diários, Ads por anúncio, visão do comprador): curva ABC + potencial, cadeia causal visitas × conversão × ticket, ímã, catálogo/caixa de compra, Full (quantidade sugerida), sazonalidade, urgência oculta (hipótese), Ads por curva, ROAS de equilíbrio e ROAS alvo (só com custos informados).
- **Plano por anúncio** (`src/lib/plano-anuncios.js`): 14 regras → ações com o quê, onde (link do anúncio como o comprador vê), por quê (número), como (passos), baseline → meta, **previsão por hipótese** (cenários conservador/base/otimista × probabilidade) e prioridade P0–P3. Máximo de 5 ações/semana por cliente; o resto fica na fila.
- **Distribuição**: cada ação vira uma tarefa por anúncio no quadro do cliente (mesmo fluxo com prévia e confirmação); o card cita o MLB, o que permite medir o resultado depois.
- **Documento para download**: `/plano-conta?cliente=…` (HTML), `/plano-conta.pdf`, `/api/plano-conta/acoes.csv`.
- **Metodologia viva** (`/metodologia`, `docs/metodologia-algoritmo.md`, `config/algoritmo.json`): regras com KPI mensurável, premissas calibradas pelo histórico medido, previsto × realizado, regras candidatas à aposentadoria.
- Autotestes: `node scripts/teste-plano-anuncios.mjs`, `teste-impacto.mjs`, `teste-ppc.mjs`, `teste-planos.mjs`.

## Central de Integrações (`/integracoes`) e metas por cliente

- **Integrações por cliente e canal** — só fluxos oficiais, nenhuma senha passa pelo sistema. Mercado Livre: OAuth 2.0 pronto (link assinado por cliente, 60 dias; tokens cifrados em repouso; ao conectar, o sistema faz a primeira coleta e gera o primeiro diagnóstico sozinho) — falta só `MELI_CLIENT_ID`/`MELI_CLIENT_SECRET`/`PUBLIC_BASE_URL` no `.env`. Amazon (SP-API + Login With Amazon) e Shopee (Open Platform) aparecem como "aguardando app" com a lista do que providenciar — nunca OAuth improvisado.
- **Metas por cliente** (`metas_cliente`, `POST /api/cliente/metas`): cadastradas pelo time, nunca inventadas. Com meta de entregas, o cartão 2 do `/cliente` liga o **Score de probabilidade operacional** (nome do roteiro — não é probabilidade estatística calibrada) com cobertura declarada; meta de GMV fica registrada aguardando o canal conectar.
- **Resultado por ação** (`resultado_json` em `acoes_plano`, `POST /api/planos/acoes/resultado`): antes/depois registrado pelo consultor — base do aprendizado `P(sucesso | condições)` quando houver histórico.
- Especificação canônica da camada: `config/prompt-inteligencia.md` (com mapa ativo/parcial/aguardando no topo).

## Custos via ERP/Planilha (Bling, Tiny ou Google Sheets)

Custo por SKU chega sozinho ao módulo de Promoções (MC real em vez de "SEM CUSTO"). **Só lê** do ERP/planilha e **só grava custo local**; nada é escrito no ERP nem na conta do Mercado Livre.

- **Planilha (pronta para uso):** Integrações → cartão "Custos (ERP/Planilha)" → Planilha → Gerar webhook → copiar o Apps Script pronto. A planilha envia por `POST /webhook/custos/<id-opaco>` assinado (HMAC + janela de 5 min + idempotência); 401 igual para qualquer falha.
- **Bling / Tiny (F2, só com fixtures até o piloto):** OAuth oficial (o cliente autoriza no ERP; volta em `/erp/callback`), varredura diária a partir das 03h + "Sincronizar agora". Webhook do Bling desligado por padrão (`PS_BLING_WEBHOOK=0`).
- **Regras:** custo vazio/0/texto é rejeitado com motivo (nunca vira custo); SKU é a chave (sem casamento por adivinhação); precedência `manual > bling > tiny > sheets` por cliente; variação > 50% ou custo ≥ preço cheio vai para **quarentena** (não vale até o dono aprovar); envio completo nunca apaga SKU; frescor 3 dias (ERP) / 14 dias (planilha) vira pendência `CUSTO_*` em Promoções.
- **Antes do 1º uso:** `ERP_TOKEN_KEY` no `.env` (`openssl rand -hex 32`, guarde backup; sem ela o sistema recusa) e `PUBLIC_BASE_URL` (o mesmo túnel do Mercado Livre).
- Guia do usuário: `docs/integracao-custos-erp.md` · especificação: `docs/integracao-custos-erp-SPEC.md` · testes (sem rede): `npm run teste:custos`.

## O Merovíngio — camada de pensamento estratégico (`src/lib/merovingio.js`)

Por cima do plano e do motor P→P→C, o Merovíngio ("causalidade — não há como escapar dela") aplica três pensamentos, 100 % determinísticos:

1. **Analítico** — decompõe o estado observado do cliente e classifica num **arquétipo** (🔓 Destravar · 🏃 Retomar o ritmo · 🧱 Estruturar · 🚀 Acelerar · 📈 Consolidar), primeiro-que-casa, sempre explicando a tese com os números reais.
2. **Crítico** — questiona a própria leitura: % da tese apoiada em fatos, **sinais mistos** (7 d × 28 d divergindo), vieses de medição (99 % sem prazo = atraso invisível) e um **falsificador** por arquétipo ("o que derrubaria esta leitura").
3. **Estratégico** — ordena as ações existentes em **jogadas** pela escada P.L.A.C.E do playbook (Operação → Renovação → Pesquisa → Layout → Aceleração → Coleta): Ads nunca vem antes de anúncio otimizado (armadilha nº 1). Máx. 3 jogadas; o resto fica declarado como "depois".

Na base inteira (`GET /api/merovingio/padroes`): padrões sistêmicos (mesma regra em ≥ 35 % dos clientes = problema de **processo**, não de cliente — ex.: 95 % sem plano do mês → consertar o ritual, não 131 clientes) + carga por squad. Autoteste: `node scripts/teste-merovingio.mjs`.

## Visão por cliente (`/cliente`) — busca + motor P→P→C

Interface simples (estilo app de consumo): busque o cliente pelo **nome ou CNPJ** (mínimo 3 caracteres — a busca é parcial e devolve no máximo 12 resultados) e veja:

- **Previsibilidade** — tendência de execução (média 7d ÷ 7d anteriores, classes CRESCIMENTO FORTE → QUEDA CRÍTICA) e projeção do mês (realizado + velocidade ponderada 30d×20% + 14d×30% + 7d×50% × dias restantes).
- **Probabilidade** — score 0–100 de bater a meta (pesos: ritmo 30 %, tendência 20 %, conversão 15 %, tráfego 10 %, estoque 15 %, Ads 10 %), renormalizado pelo que existe e com a cobertura declarada. Sem meta registrada o cartão fica **inativo** (pendência, nunca chute).
- **Causalidade** — árvore Receita = Visitas × Conversão × Ticket quando o canal está conectado; para a operação, Execução = tarefas × taxa de conclusão (ex.: "entregas caíram 66 %; causa provável: 19 tarefas paradas"). Sempre "causa provável", nunca comprovada.
- **Plano de ação filtrável** por característica — ⚡ Alto impacto, ⏱ Curto prazo, 🌱 Longevo, 🔥 P0+P1, ✓ Só fatos (combináveis) — com prioridade **P0–P3** (impacto 40 % + gravidade 20 % + evidência causal 25 % + facilidade 15 %) e Aprovar/Descartar no cartão.
- **Renovação de contrato** — lê `Venc Contrato <canal>` da central; contrato vencendo em ≤ 30 dias vira ação (playbook: evolução com dados + CS ~20 dias antes).

Motor determinístico em `src/lib/motor-ppc.js` (autoteste: `node scripts/teste-ppc.mjs`, com os números do roteiro). Rotas: `GET /api/clientes/busca?q=`, `GET /api/cliente/painel?cliente=`.

## Plano de Ação por cliente (`/planos`)

Gera um plano por cliente e distribui as ações como tarefas nos quadros "Tarefas - {Cliente}" do Notion, por **total**, **squad**, **consultor** ou **seleção de clientes**. Requisitos de origem: `config/prompt-estrategista.md`.

- **Motor determinístico** (`src/lib/plano-cliente.js`, zero token de IA; limiares e textos em `config/playbook.json`): só gera ação com evidência nos dados disponíveis (tarefas, plano mensal e equipe do Notion; API do Mercado Livre quando a conta está conectada). Cada ação traz evidência classificada (fato / hipótese / projeção / pendente), problema, ação, responsável, prazo, dependência, indicador, meta, critério de aceite e a conta da prioridade. Vendas por SKU, Ads, estoque e margem **não** são inventados: viram pendência e aparecem como "especificado, não ativo".
- **IDs estáveis** `PS-xxxxxxx` (hash cliente|regra|alvo|mês). Regenerar nunca duplica nem sobrescreve ação já aprovada, descartada ou enviada ao Notion.
- **Equipe** (`src/lib/equipe.js`, `config/equipe.json`): consultor/líder por canal vêm da central de clientes (texto livre); squad = líder do canal (sobrescrevível em `squads`). Nomes só casam por alias explícito ou prefixo de ≥ 2 palavras. Sem consultor → "responsável a definir". Confirme os `aliases` inferidos.
- **Distribuição** (`src/lib/distribuir-notion.js`): pré-visualização é sempre o padrão; só cria no Notion com confirmação explícita (`confirmar: true` na API, `--confirmar` no CLI, botão no painel). Dedupe em duas camadas (status local + ID no título da tarefa no quadro). Só usa opções de Canal/Demanda/Tag que já existem no quadro. Desfazer manda as páginas para a lixeira do Notion. O Notion notifica quem é atribuído.
- **Documento por cliente** (`/plano?cliente=…`, `/plano.pdf`): as 12 partes da entrega final. **CSV** do escopo em `/api/planos/acoes.csv`.
- Painel e API aceitam apenas acesso local (header Host).

```bash
node scripts/plano-cliente.mjs --escopo total --gerar
node scripts/plano-cliente.mjs --escopo consultor --consultor "Nome" --distribuir               # pré-visualização
node scripts/plano-cliente.mjs --escopo selecao --cliente "Cliente X" --distribuir --confirmar  # cria no Notion
node scripts/teste-planos.mjs                                                                    # autoteste (sem rede)
```

## Segurança específica desta integração

- O link do botão é **assinado (HMAC)** e **expira em 60 dias** — ninguém
  além de quem recebeu o link consegue conectar uma conta em nome de outro
  cliente (isso foi testado: nomes parecidos não geram links intercambiáveis).
- Tokens de acesso e de renovação ficam **cifrados (AES-256-GCM)** no SQLite,
  nunca em texto puro — mesmo localmente.
- O servidor nunca expõe tokens por API; `/api/meli/conexoes` só devolve
  nome do cliente, apelido no Mercado Livre e data de conexão.
- Gere `MELI_TOKEN_KEY` e `MELI_LINK_SECRET` únicos com `openssl rand -hex 32`
  — o sistema roda com uma chave de desenvolvimento se você esquecer, mas
  avisa alto no log; troque antes de conectar contas reais.
- Para desconectar um cliente (ex.: encerrou contrato): `POST /api/meli/desconectar {"cliente":"Nome"}`.

## Matriz Eisenhower por analista (uso interno)

Diagnóstico de sobrecarga cruzando **todas as tarefas abertas de um analista
em todos os clientes** — não é um relatório de cliente, é ferramenta de
liderança para entender por que alguém não está conseguindo terminar.

```bash
node scripts/matriz-analista.mjs --responsavel "Kenia Jubileu"
```

Ou no dashboard: escolha o responsável no filtro → botão "🧭 Matriz
Eisenhower". Rota: `/matriz?responsavel=Nome` (+ `.pdf`).

Cada tarefa aberta é classificada em **Fazer / Agendar / Delegar / Eliminar**
por código (`src/lib/eisenhower.js`), sem gastar token de IA — a regra por
tipo de demanda fica em `config/eisenhower.json` (editável, mesmo padrão do
`mapeamento.json`). **Delegar é sobre quem faz, não quando** — um tipo de
tarefa recorrente e de baixo julgamento (ex.: "Transmissão por Chat") cai em
Delegar mesmo sendo urgente hoje; tarefas estratégicas (que mexem com
receita/reputação) nunca são marcadas para delegar às cegas.

O relatório também traz um **diagnóstico de causa raiz**, 100% calculado:
concentração de backlog por cliente, idade média das tarefas paradas, % sem
prazo preenchido (a causa mais comum de backlog invisível), e os tipos de
demanda que mais dominam o que está em aberto.

Depende da propriedade **"Demandas"** do Notion (`tipo_demanda` na tabela
`tarefas`) para a classificação mais precisa — sem ela, cai num fallback por
palavra-chave no título, que funciona mas agrupa pior os "tipos dominantes".
Rode `npm run sync -- --completo` para popular esse campo no histórico já
sincronizado.

## Segurança

- Token, chave de IA e segredos **somente** em `.env` (fora do git; veja `.env.example`).
- IDs e dados de clientes ficam em `config/` e `data/` na sua máquina.
- O relatório enviado ao cliente só contém tarefas com `Exibir ao cliente` (quando o campo existir).
