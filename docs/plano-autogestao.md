# Plano de autogestão — o sistema que cuida de si, aprende sozinho e libera a própria autonomia

> Pedido do David (15/10/2026, ~03h): «me traga as etapas para o sistema ser autogerenciável, auto-retroalimentável».
>
> Escrito em 15/10/2026 só por leitura (código, `data/server.log`, `sqlite3 -readonly` com consultas agregadas). Nada foi alterado no código, no banco, no ML ou no Notion. Base: `CLAUDE.md` (inclusive «Sistemas dentro do sistema»), `docs/plano-autonomia-total.md` (M0–M6 e decisões das 02h), `docs/desenho-causalidade-executor.md` (Chaveiro), `docs/desenho-merovingio-foco-8020.md` (decisões das 01h50 e 02h30), `docs/desenho-v3-erp.md`, `docs/desenho-v3-produto-estoque-financeiro.md`, `docs/metodologia-algoritmo.md`.
>
> Regra de todas as linhas: **nenhum segundo motor**. Saúde, auto-cura e calibração são projeções e travas sobre o que já existe (Trinity coleta → Arquiteto decide → Oráculo prevê → Chaveiro executa → Merovíngio mede → Morpheus comunica). Toda mensagem interna diz de qual sistema vem; ao cliente, só Merovíngio.

---

## 0. Incidente-exemplo (14–15/10/2026) — o que aconteceu e por que ninguém soube

| Hora (aprox.) | Fato | Fonte | O sistema percebeu? |
|---|---|---|---|
| 14/10 04:17 | Sync diário do Notion abortou: «The operation was aborted due to timeout» | `sync_log` 2026-10-14T07:17Z | Só uma linha de log `erro`. `ultimo_sync` ficou em **13/10 21:58** — mais de 30 h sem ler o Notion |
| 14/10 manhã → 15/10 | 6.100 anexos novos baixados numa sincronização; livro de registro hasheando ~30 mil anexos em passadas de 500 | `server.log` («29971 anexo(s) para as próximas passadas» → 471) | Não: crescimento de disco não é medido |
| 14/10 18:01 | Lote imediato de gatilhos falhou no n8n (502) | `sync_log`: `gatilhos Jula Textil: lote imediato falhou (n8n_502)` — gravado como **info** | Não: 502 do entregador classificado como informação |
| 14/10–15/10 | 7 contas repetem «renovação preventiva ML: **sem token** (falha transitória)» ciclo após ciclo | `server.log` | Não: «transitória» que se repete por horas nunca escala |
| 15/10 ~03h | Disco a 99 % (`data/evidencias` = **28 GB, 68.770 arquivos**), banco parou de abrir, servidor caiu | relato + `df` | **Não.** O sino (`notificacoes`) mora dentro do banco que caiu; o servidor não está sob supervisor; o log de stdout nem tem hora |
| 15/10 depois | Servidor subiu de novo à mão; uma segunda instância morreu com `EADDRINUSE 127.0.0.1:3012` | `server.log` | — |
| agora | **2,6 GB livres** no volume; `data/evidencias` 28 GB, `data/relatorios` 1,0 GB, `db.sqlite` 315 MB. A trava nova de `sync.js:42-55` (não baixar anexo com < 15 GB livres) já está valendo | `df -h /`, `du` | A trava avisa só no log |

**Causa raiz (não o sintoma):** todo alarme do sistema vive *dentro* do que pode falhar — mesmo processo Node, mesmo arquivo SQLite, mesmo disco. Quando o disco encheu, caíram juntos o banco, o servidor e o próprio alarme. Daí a primeira regra deste plano: **o vigia mora fora** (outro processo, sem depender do banco nem do Node para decidir, e com um «homem-morto» no n8n da nuvem que avisa se o próprio vigia sumir).

Achados de leitura que o plano corrige (todos verificados):
1. `automacao/com.place2u.place-sprints.servidor.plist` existe (KeepAlive) mas **não está instalado** em `~/Library/LaunchAgents` (os de placehost/placelav/placepro/eleven/cloudflared estão). O servidor roda por `nohup` (PID atual 73192); se cair, fica caído.
2. Se o supervisor for instalado como está, num disco cheio ele **reinicia a cada 10 s e escreve o erro em `data/server.log`** — o que enche mais o disco. Falta `ThrottleInterval` e uma checagem de disco no `scripts/dev.sh` antes do `exec node`.
3. `db.js:319-325` — `log()` grava no banco e imprime `[nivel] msg` **sem data/hora**. Quando o banco não abre, o único rastro (`server.log`) não diz quando.
4. `notion.js:16-41` — retentativa com backoff só para HTTP 429/5xx. **Timeout e erro de rede (`TimeoutError`, `fetch failed`) não são retentados**: um único request lento derruba a etapa.
5. Sync do Notion não tem relógio próprio: roda só pelo webhook (`server.js:303-317`) e dentro da coleta das 4h (`server.js:471`). Falhou às 4h, só tenta de novo no dia seguinte.
6. `aprendizado.medirResultados` (`aprendizado.js:69`) só roda quando alguém gera plano ou abre `/api/aprendizado` (`rotas-planos.js:129`, `:371`). Não há tick.
7. Backups em `data/backups/` são só das conexões ML e do ledger S90 (360 KB). **Não existe backup do banco** (e a regra «nunca copiar `data/db.sqlite`» vale para agentes/revisões que encheram o disco; o backup do próprio sistema tem de ir para fora do disco — decisão D-A2).
8. `config/sistemas.json`, citado no `CLAUDE.md`, **não existe** no projeto.

---

## A) AUTO-OPERAÇÃO — o sistema cuida de si

### A1. Vigia externo + supervisor (ninguém mais descobre a queda pelo cliente)

- **O que é.** Dois guardiões fora do processo: (1) o **supervisor** do macOS (launchd) reinicia o servidor se cair, com freio para não entrar em laço; (2) o **vigia** — script de shell de ~60 linhas rodado pelo launchd a cada 5 min — mede disco, tamanho de `data/evidencias`/`data/relatorios`/banco, se a porta 3012 responde e se o banco abre em só-leitura, e avisa por fora (Discord do time direto pelo webhook; WhatsApp do David pelo n8n; se o n8n der 5xx, o Discord leva o aviso dizendo que o WhatsApp falhou). A cada hora o vigia faz um ping a um fluxo do n8n na nuvem («homem-morto»): sem ping por 20 min, o n8n avisa no Discord que o Mac/vigia sumiu (cobre Mac dormindo, sem energia, sem internet).
- **Já existe.** `automacao/com.place2u.place-sprints.servidor.plist` (KeepAlive, RunAtLoad, roteiro de migração do nohup no próprio comentário); `scripts/dev.sh`; webhook do Discord do time e destinos em `config/discord-time.json`; n8n na nuvem (`PLACE_GATILHOS_URL`, fluxos em `automacao/n8n/`); LaunchAgents das outras aplicações como molde.
- **Falta.** (a) Instalar o plist na janela combinada de reinício, com `ThrottleInterval` (≥ 30 s) e `dev.sh` recusando subir com < 1 GB livre (sai com código próprio, sem escrever log grande); (b) `scripts/vigia.sh` + `automacao/com.place2u.place-sprints.vigia.plist`; (c) fluxo n8n `place-vigia-homem-morto.json`; (d) arquivo de estado do vigia fora do banco (`data/vigia.estado`, uma linha por sinal) para deduplicar — o vigia avisa na **mudança** de estado (ok → crítico, crítico → ok), nunca a cada 5 min; (e) prefixo de data/hora ISO no `console.log` de `db.js:324`.
- **Métrica que prova pronto.** Teste de fogo controlado: matar o processo → de volta em ≤ 60 s sem humano; simular disco baixo (limiar do vigia apontado para um valor alto, por 1 ciclo) → aviso no Discord em ≤ 10 min e WhatsApp do David só no crítico; parar o vigia → o n8n avisa em ≤ 25 min. Em 30 dias: **0 quedas descobertas por pessoa antes do aviso**.
- **Kill switch.** `launchctl bootout gui/$(id -u)/com.place2u.place-sprints.vigia` (vigia) e `…servidor` (volta ao nohup, como está no plist); no n8n, desativar o fluxo do homem-morto.
- **Risco.** Duas instâncias disputando a 3012 (`EADDRINUSE` já visto) — por isso a migração segue o roteiro do plist (parar o nohup antes). Aviso demais vira ruído: só mudança de estado, e o WhatsApp do David só para crítico.

### A2. Healthcheck por sistema (`/api/saude`) e painel «Saúde do sistema»

- **O que é.** Cada sistema declara seus sinais com limiar; uma função pura `avaliarSaude(sinais, limites) → [{ sistema, sinal, estado: ok|atencao|critico, valor, desde, ultimo_ok }]`; a rota `GET /api/saude` devolve isso (o vigia lê por `curl --max-time 10`; se a rota não responde, isso já é o sinal crítico «servidor»). Cada `setInterval` do `server.js` passa a gravar seu **batimento** (hora da última volta completa) em memória e em `sync_estado.tick:<nome>`; tick que não bate em 3× o seu período = parado.
- **Sinais e limiares iniciais** (em `config/saude-sistema.json`; números de partida, ajustáveis):

| Sistema | Sinal | Atenção | Crítico | Fonte que já existe |
|---|---|---|---|---|
| Trinity (ML) | coleta diária concluída hoje | 08h sem `coleta_ml_dia = hoje` | 11h sem | `sync_estado.coleta_ml_dia`, `server.js:462-521` |
| Trinity (ML) | contas com falha na coleta de hoje | ≥ 1 | ≥ 20 % das conectadas | `log` por cliente (`server.js:488`) → contador |
| Trinity (ML) | tokens: contas em erro / «sem token» repetido | 1 conta com 3 ciclos seguidos de «sem token» (1 h 30) | ≥ 5 contas | `meli-contas.js:128-145` (`res.falhas`) |
| Trinity (Notion) | idade do `ultimo_sync` | > 26 h | > 50 h | `sync_estado.ultimo_sync` (hoje: 13/10 21:58) |
| Trinity (dados) | cobertura de dias: clientes sem `meli_coleta_dia` ontem | ≥ 1 | ≥ 10 | `meli_coleta_dia` |
| Trinity (dados) | coleta com 0 anúncios / 0 pedidos numa conta que tinha venda em 28 d | 1 conta | — (vira incidente da conta) | guarda «0 corpos = erro» em `meli-api.js` (multiget); `integracao-ml.js:17` |
| Morpheus | ticks vivos (relatórios, alertas, consultor, gatilhos, respostas, livro, dossiê) | 1 tick > 30 min sem bater | gatilhos ou consultor parados numa terça 07h–10h | `server.js:549-563` |
| Morpheus | entregas do n8n com 5xx/rede | 1 lote | 3 seguidos ou o plano de terça de ≥ 1 cliente não entregue até 12h | `gatilho_lote`, `relatorio_envio`, disjuntor de `relatorio-envio.js:713` |
| Arquiteto / Oráculo | plano regerado hoje para todo cliente coletado | 1 sem | ≥ 10 % sem | `acoes_plano.criado_em`, `gerarPlanoConta` |
| Merovíngio | medição rodou hoje | > 26 h | > 72 h | novo batimento de `medirResultados` (B1) |
| Infra | disco livre | < 15 GB (já trava anexos, `sync.js:42`) | < 5 GB | `discoLivreGb()` em `sync.js:43` |
| Infra | `data/evidencias` + `data/relatorios` | > 10 GB | > 20 GB | `du` no vigia (fora do Node: não trava o processo) |
| Infra | `db.sqlite` + WAL | WAL > 200 MB ou banco cresce > 20 MB/dia | WAL > 1 GB | `statSync` |
| Infra | memória do processo (RSS) | > 1,5 GB | > 3 GB | `process.memoryUsage()` |
| Infra | Mac acordado (buraco entre batimentos > 60 min) | 1 buraco | buraco cobrindo 04h–08h | batimentos (comentário de `server.js:466`: «10 a 12/10 sem coleta» por Mac dormindo) |

- **Painel.** Seção «Saúde do sistema» em `/integracoes` (`#secSaudeSistema` — não confundir com `#secSaude` da saúde da conta em `/cliente`): ≤ 6 colunas (Sistema · Sinal · Estado · Desde · Último ok · Dono), estado por token de cor, valor nunca colorido, sem botão primário novo (sistema de design). Abaixo, incidentes abertos (A5).
- **Já existe.** `discoLivreGb` (`sync.js:43`); `sync_estado` (`db.js:102`, `:326-329`); `sync_log` com poda (`db.js:323`); `/api/estado` (`server.js:208`); `/api/integracoes` (`rotas-planos.js:495`, já calcula «expirando» por renovação parada há 24 h); `notificar` com dedupe (`notificacoes.js:19`); `monitoramento-meli.js` (monitoramento das contas, não do sistema).
- **Falta.** `src/lib/saude-sistema.js` (pura + fiação), `config/saude-sistema.json`, batimentos nos ticks, rota, seção na tela, teste `scripts/teste-saude-sistema.mjs` (limiares, tick parado, transições ok→atenção→crítico→ok, nenhuma leitura de token).
- **Métrica que prova pronto.** Os 5 eventos do incidente-exemplo, reproduzidos em teste (em memória), viram cada um um sinal com o estado certo; em produção, 14 dias com o painel batendo com a realidade (nenhum «ok» durante uma falha conhecida).
- **Kill switch.** `saude.avisos_ligado` em `sync_estado` (o painel continua; só os avisos param).
- **Risco.** Limiar mal calibrado gera ruído → a tabela acima nasce conservadora, e todo limiar tem dono e revisão em 30 dias (B3 vale aqui também).

### A3. Auto-cura (o que o sistema conserta sem chamar ninguém)

| Falha | Auto-cura | Já existe | Falta | Teto |
|---|---|---|---|---|
| Timeout/rede no Notion (14/10) | Retentar `TimeoutError`/`fetch failed` como 5xx (backoff 1-2-4-8-16 s) | backoff por status em `notion.js:36-41`; timeout 60 s `notion.js:23` | incluir erro de rede/timeout no mesmo laço (só leituras; POST de criação continua `retry5xx:false`) | 5 tentativas |
| Sync do Notion falhou na madrugada | Reagendar sozinho em +30 min, até 3 vezes; continuação por fonte (o marcador `desde:<dbId>` já é por fonte — fonte que terminou não relê) | marcador por fonte em `sync.js:120-126`; teto de tempo na etapa do Notion do cliente (`sync.js:185`) | tick de sync próprio (ex.: a cada 2 h, incremental) além do webhook e do das 4h; **teto de tempo total** com «continua no próximo» | 3 retentativas/dia, depois incidente |
| Conta falhou na coleta diária | Lista de falhas do dia retentada 1× ao fim do laço e de novo em +2 h | `try` por cliente em `server.js:479-489` | fila de retentativa; `coleta_ml_dia` só marca «dia completo» com as falhas declaradas | 2 retentativas, depois incidente da conta |
| Coleta perdida (Mac dormindo, servidor fora às 4h) | Já recupera: roda no 1º tick depois das 4h | `server.js:466` | sinal «coleta atrasada» (A2) para avisar se até 11h não rodou | — |
| «Sem token» que se repete | 3 ciclos seguidos → deixa de ser «transitória»: incidente + notificação `conexao_caiu` | retomada de erro a cada 6 h e lembrete diário (`server.js:539-542`) | contador de ciclos por conta | — |
| n8n 502 | Lote imediato: 1 retentativa em 10 min (idempotência por lote já existe); plano de terça: retentativas até a janela 20:00; 3 falhas seguidas → incidente «Morpheus sem entregador» | disjuntor e `ehInfra` no relatório (`relatorio-envio.js:713`, `:910`) | mesma regra nos gatilhos; nível do log de `info` para `aviso`/`erro` | janela do lote |
| Servidor caiu | Supervisor reinicia (A1) | plist | instalar + freio | `ThrottleInterval` |
| WAL cresce | `PRAGMA wal_checkpoint(TRUNCATE)` diário fora da coleta | WAL ligado (`db.js:35`) | tick diário | — |
| Disco enchendo | Ver A4 (retenção) — a auto-cura é **mover para frio**, nunca apagar evidência | trava de download (`sync.js:55`) | A4 | — |

- **Métrica que prova pronto.** Em 30 dias: ≥ 90 % das falhas transitórias (timeout, 5xx, rede) resolvidas sem incidente; 0 dias com Notion > 26 h sem sync; 0 contas com «sem token» > 2 h sem incidente aberto.
- **Kill switch.** Cada retentativa lê seu teto do config; `autocura_ligada` em `sync_estado` volta ao comportamento atual.
- **Risco.** Retentativa que martela a API (ML tem 429; Notion 3 req/s) → backoff exponencial com jitter (molde de `meli-api.js:21`) e teto; nunca retentar POST não idempotente.

### A4. Retenção e armazenamento frio dos anexos (o que encheu o disco)

- **O que é.** Política: anexo do Notion (`data/evidencias`) com mais de 30 dias **e** com sha256 já gravado no livro de registro é **movido** para armazenamento frio com o nome `<sha256>.<ext>`; o arquivo é relido no destino e o hash conferido **antes** de remover a cópia local; `evidencias.arquivo_local` passa a apontar `frio:<sha256>` (a tela e o dossiê buscam no frio quando precisam). Relatórios HTML/PDF em `data/relatorios` com mais de 30 dias: idem (há HTMLs de 25–39 MB com imagens embutidas). Nada é apagado; a prova do dossiê continua íntegra porque o livro guarda o hash, não o arquivo.
- **Números de hoje.** 63.971 anexos no livro (`registro_cliente.tipo = anexo_tarefa`) = 63.971 linhas em `evidencias`, 62.595 com arquivo local; **59,5 mil (≈ 95 %) são de julho/agosto e início de setembro** — já movíveis pela regra dos 30 dias. Ganho esperado: ~25 GB.
- **Já existe.** sha256 dos prints no livro, encadeado e append-only (`livro-registro-real.js:35-39`, `verificarCadeia`); `evidencias.arquivo_local`; trava de disco no download (`sync.js:42-55`); conector Google Drive disponível ao David (destino candidato).
- **Falta.** Decisão do destino (D-A1); `scripts/arquivar-evidencias.mjs` com **prévia por padrão** e `--confirmar` (padrão da casa), lote por passada, conferência de hash, relatório do que moveu; leitura `frio:` nas rotas que servem anexo; regra de crescimento: o vigia acompanha GB/dia de `data/evidencias` e a trava de 15 GB livres continua.
- **Métrica que prova pronto.** `data/evidencias` + `data/relatorios` < 5 GB; disco livre > 25 GB; `verificarCadeia` sem elo quebrado depois da mudança; 100 % dos anexos movidos com hash conferido no destino; amostra de 20 anexos aberta pelo dossiê a partir do frio.
- **Kill switch.** Prévia é o padrão; parar = não rodar com `--confirmar`. Reverso: o mesmo script com `--trazer` copia de volta por sha256.
- **Risco.** Destino indisponível = anexo inacessível na hora do dossiê → o dossiê já declara «anexo em armazenamento frio, sha256 …» e baixa sob demanda; nunca mover anexo sem hash no livro.

### A5. Aviso só por exceção + incidentes com dono e SLA

- **O que é.** Todo sinal crítico (A2) ou auto-cura esgotada (A3) abre um **incidente**: `{ id, sistema, sinal, nivel, aberto_em, reconhecido_em, reconhecido_por, resolvido_em, causa, acao }`, um por (sistema, sinal) vivo — repetir o sinal atualiza o mesmo incidente, não abre outro. Dono padrão: **Head de canais** (decisão de 15/10, mesa de exceções). Morpheus avisa: Discord do time (com o sistema de origem no título: «[Trinity] Notion sem sincronizar há 30 h») e, só no crítico, WhatsApp do David. Fecha sozinho quando o sinal volta a ok por 2 leituras seguidas, com «resolvido por: auto-cura | pessoa». Nada de mensagem quando está tudo bem; o «tudo bem» vai só no relatório mensal (B7).
- **SLA proposto (decisão D-A3):** crítico — reconhecer em 1 h (08h–22h) / até 09h (madrugada), resolver em 4 h; atenção — resumo diário 08h no Discord, resolver em 48 h. Incidente crítico sem reconhecimento no prazo escala para o David.
- **Já existe.** `notificar` com dedupe (`notificacoes.js:19`) — **mas mora no banco**; aviso ao consultor no Discord pelo n8n (`consultor-discord.js`, `discord_partes`); `config/discord-time.json` (cargos); molde de tabela própria (`consultor_aviso`).
- **Falta.** Tabela `incidente` (aditiva); o vigia externo (A1) cobre o caso «o banco é o problema» gravando em `data/vigia.estado` e importando para `incidente` quando o banco volta; rota de reconhecer/resolver (`por` validado); bloco no painel; criar `config/sistemas.json` (citado no `CLAUDE.md`, inexistente) com o catálogo e o rótulo de cada sistema.
- **Métrica que prova pronto.** 100 % dos incidentes críticos com dono e reconhecimento dentro do SLA por 30 dias; mediana de tempo até resolver (MTTR) medida e caindo mês a mês; ≤ 10 avisos/semana ao time (mesmo teto da mesa de exceções).
- **Kill switch.** `saude.avisos_ligado` (A2); WhatsApp do David com chave própria `saude.whatsapp_david_ligado`.
- **Risco.** Fadiga de alerta → teto semanal; acima dele o sistema manda **um** resumo e marca o limiar para revisão (o problema é o limiar, não o time).

### A6. Vigilância dos dados (o dado errado que parece certo)

- **O que é.** Checagens diárias pós-coleta, todas declarativas («dia sem coleta não é zero»): cobertura de dias por cliente (lacuna vira «sem dado», nunca zero — já é regra); guarda de 0 anúncios/0 pedidos em conta que vendia; divergência entre fontes (pedidos × `meli_serie_item`, conferidores `scripts/conferir-grafo.mjs` e `scripts/conferir-financeiro.mjs` rodando sozinhos 1×/semana); salto implausível (receita do dia > 5× a mediana de 28 d → marca para conferência, não entra no aprendizado até conferir).
- **Já existe.** `qualidadeDados`/`data_quality` (`metodologia-algoritmo.md` § 10.2); `integracaoMlAtiva` (coleta ≤ 3 dias, `integracao-ml.js:17`); guarda do multiget; conferidores da V3; `excluirDaAprendizagem` (`impacto-tarefas.js:42`).
- **Falta.** Rodar os conferidores no tick semanal e transformar divergência em sinal (A2) e, se persistir, incidente; marca «dado em conferência» que tira o dia do aprendizado.
- **Métrica.** 0 medições do Merovíngio feitas sobre dia com lacuna; conferidores verdes 4 semanas seguidas.
- **Kill switch.** Cada checagem tem `ligada` no config.
- **Risco.** Excluir dado bom do aprendizado por falso positivo → a marca é reversível e listada.

### A7. Backup do banco fora do disco

- **O que é.** 1×/dia, fora da janela da coleta, backup online do SQLite (API de backup do better-sqlite3, consistente com WAL) **direto para o armazenamento frio** (o mesmo de A4), cifrado, retenção 14 diários + 8 semanais; teste de restauração mensal em memória/arquivo temporário do frio, nunca em `data/`.
- **Já existe.** Backup de conexões ML a cada 30 min (`server.js:534`) e ledger S90 diário — mostram o padrão.
- **Falta.** Decisão D-A2 (destino e se o banco pode sair do Mac — contém dados de clientes, LGPD); o script; o sinal «último backup» no painel.
- **Métrica.** Backup diário 30 dias sem falha; restauração mensal conferida (contagem de linhas por tabela).
- **Kill switch.** `backup_banco_ligado`.
- **Risco.** Encher o disco de novo — por isso **nunca** escreve a cópia em `data/` (respeita a regra do `CLAUDE.md`); se o destino falhar, não há fallback local.

---

## B) AUTO-RETROALIMENTAÇÃO — fechar o ciclo previsão → ação → medição → prior

### B0. Diagnóstico: por que há 0 resultados medidos

Números de hoje (`acoes_plano`): **2.051 propostas · 84 aprovadas · 30 distribuídas · 613 obsoletas · 2 descartadas**; `aprendizado` = 0 linhas; tarefas com `· PS-` no Notion = 30.

| # | Trava | Evidência | O que destrava |
|---|---|---|---|
| 1 | **As 30 distribuídas estão todas «não iniciada» no Notion** (distribuídas entre 05 e 10/10, em 6 clientes) | `tarefas` com `PS-`: 30 × `nao_iniciada` | o card não é a única porta: medir pela **mudança no anúncio** (B1) e pelo caminho assistido conferido pelo change-log (Chaveiro F3) |
| 2 | A medição só dispara quando o card vira «concluída» + 3 dias de carência | `aprendizado.js:69-95` | idem; e cobrar card distribuído parado > 7 d no resumo de terça do consultor (interno) |
| 3 | `medirResultados` não tem relógio: só roda ao gerar plano ou abrir `/api/aprendizado` | `rotas-planos.js:129`, `:371` | tick diário pós-coleta (B1) |
| 4 | Previsto × realizado (Brier) exige ação `anuncio_*` distribuída **e** medida por `analisarCliente` com janela 14 d + lag (≥ ~17–20 dias depois da conclusão) | `calibracao.js:43-71` | é tempo: com 1 e 2 destravados, a primeira leva de Brier chega ~3 semanas depois |
| 5 | Aprovação é o gargalo: 84 de 2.051 (4 %); 54 aprovadas nunca distribuídas | `acoes_plano` | aprovação por exceção (C1) e distribuir as aprovadas |
| 6 | Notion sem sincronizar desde 13/10 21:58 | `sync_estado.ultimo_sync` | A3 — mesmo que alguém conclua, o sistema não vê |

Detalhe honesto: a parte do aprendizado **por família** já se alimenta das 11.566 tarefas humanas concluídas (`impacto-tarefas.analisarCliente`/`padroesGlobais`, `impacto-tarefas.js:553`, `:593`, usados por `priorEfetivo`, `calibracao.js:23`) — é associação N1, com controle e placebo. O que está em zero é a volta **das previsões do próprio Algoritmo** (o Oráculo ainda não foi comparado com nada).

### B1. Medição sem depender do card (o ciclo fecha sozinho)

- **O que é.** (a) `medirResultados` + `analisarCliente` rodando num tick diário logo depois da coleta (batimento no painel); (b) o marco da medição passa a ser **a mudança observada no anúncio** (change-log diário `meli_item_mudanca`, fotografia do «Como era», execução do Chaveiro), com o card como testemunha — decisão do David de 02h30: o vínculo «observado» entra automático, rotulado «inferido», reversível; (c) ação aprovada e distribuída cuja mudança apareceu no anúncio é medida mesmo com o card parado.
- **Já existe.** change-log com 1.950 mudanças; `capturarAcompanhamento` (912 linhas em `tarefa_acomp`); desenho completo em `desenho-merovingio-foco-8020.md` § 8; `excluirDaAprendizagem` com confundidores de preço e estado.
- **Falta.** O tick; `tarefa_item.origem = 'observado'` (Foco F1 § 8.7); casar ação distribuída ↔ mudança (família + data ± 3 d + anúncio; ≥ 2 candidatos não casa).
- **Métrica que prova pronto.** `aprendizado` > 0 em 7 dias; em 30 dias, ≥ 50 % das ações distribuídas com mudança observada têm medição; Brier publicado pela primeira vez (n ≥ 10).
- **Kill switch.** `medicao_observado_ligada`; com ela desligada a medição volta a ser só pelo card.
- **Risco.** Casar mudança do cliente/terceiro como se fosse da ação → rótulo «inferido», confundidores de preço/estado já tiram do aprendizado, e o degrau máximo sem Chaveiro é N2 (D6 do Chaveiro).

### B2. Calibração contínua do Oráculo (regra ruim perde peso sozinha)

- **O que é.** Brier e viés **por regra, por família e por cliente** (hoje só global, `calibracao.js:43-71`), recalculados no tick diário. Hierarquia de encolhimento: p local (cliente) ← p da família na base ← premissa declarada (`priors_efeito`), cada nível pesando pelo n efetivo com o peso do degrau (N1 0,5 · N2 0,75 · N3/N4 1,0 — desenho do Chaveiro § 4.5). Regra perde peso sozinha quando, com n efetivo ≥ 20, seu Brier é pior que o de um «preditor ingênuo» (a taxa-base da família): a p da regra passa a ser a taxa-base e o fator de prioridade cai na mesma proporção; com n ≥ 10 e Wilson superior < 0,25 já existe o rótulo «candidata à aposentadoria» (`calibracao.js:84`) — passa a valer como **quarentena automática** (sai do foco, sentinela continua medindo, volta sozinha se a taxa subir).
- **Já existe.** `priorEfetivo` com k = 5 (`calibracao.js:23`); `compararPrevisaoRealizado` (erro, viés, % no intervalo, Brier); `saudeRegras`; `veredito` com Wilson (`retroalimentacao.js:121`); `fatoresDoPlano` (`retroalimentacao.js:170`); tela `/metodologia`.
- **Falta.** Brier por regra/família/cliente; n efetivo ponderado pelo degrau (Chaveiro F2); quarentena automática com registro no livro (`tipo = regra_quarentena`) e aviso interno; prior global × local.
- **Métrica que prova pronto.** Brier global ≤ 0,25 e % dentro do intervalo conservador–otimista entre 60 e 90 % (abaixo = intervalo estreito demais; acima = largo demais) em 2 medições mensais seguidas.
- **Kill switch.** `calibracao.quarentena_auto = false` (volta a só rotular).
- **Risco.** Matar regra boa com amostra pequena → piso de n efetivo, sentinela e retorno automático.

### B3. Limiares que viram medidos (premissa com prazo de validade)

Cada limiar ganha `{ fonte: premissa | medido, n, n_min, medido_em }`; quando `n ≥ n_min` e o intervalo cabe, troca sozinho para o medido, registra no livro e aparece em `/metodologia` e no relatório mensal. Abaixo do mínimo, continua a premissa, dita.

| Limiar | Premissa hoje | Vira medido quando | Medida |
|---|---|---|---|
| Lead time do fornecedor | 21 d (`lead_time_cliente` 0 informados) | ≥ 3 ciclos pedido → recebimento por conta (ERP, ou subida de estoque/entrada no Full no change-log) | mediana e p80 do ciclo; declarado × medido lado a lado |
| Segurança de estoque do sync | 2 dias × venda prevista (decisão ERP nº 3) | ≥ 8 semanas de venda diária do produto | desvio da demanda × raiz do lead time (nível de serviço 95 %) |
| Uplift de data comercial | premissas por evento em `config/algoritmo.json` | ≥ 5 contas da mesma categoria com o evento coberto pela coleta | uplift mediano contra as 4 semanas anteriores, com controle |
| Elasticidade preço → unidades | não usada | ≥ 10 mudanças de preço ≥ 3 % na categoria com controle (`meli_item_mudanca`, `confundido_preco`) | razão de unidades/preço por faixa, com intervalo |
| Lag de reindexação por tipo | `lag_dias_por_tipo` (`config/atribuicao.json`) | ≥ 20 medições da família | dia em que o efeito estabiliza |
| Limiares da saúde do sistema (A2) | os da tabela de A2 | 30 dias de série | p95 do normal + margem |

- **Métrica que prova pronto.** ≥ 3 limiares trocados para «medido» com registro; nenhum limiar medido sem intervalo.
- **Kill switch.** `limiares.troca_auto = false` (calcula e mostra, não troca).
- **Risco.** Trocar por medida enviesada (poucos clientes grandes) → `n_min` por número de **contas**, não só de eventos.

### B4. Foco 80/20 com pausa automática e sentinela

- **O que é.** O desenho aprovado (`desenho-merovingio-foco-8020.md`): vereditos manter e escalar · manter · reduzir · pausado por evidência; **pausa automática e avisa** a partir de 60 d com evidência (decisão 1); sentinela a cada 30 d (decisão 2); carteira pelo ganho medido (decisão 3); veto por alinhamento `foco_manter`.
- **Já existe.** Desenho completo com DDL, funções, testes e fases (§ 7); `paretoItens`/`paretoTarefas`/`combos` (`retroalimentacao.js:222-270`); alinhamentos (`alinhado()`).
- **Falta.** Tudo da construção (F1–F5 do desenho; não há `foco-schema.js`).
- **Métrica que prova pronto.** Nas 3 janelas seguidas, itens mantidos crescem mais que os pausados (com controle, N2+); 0 pausas revertidas por alinhamento do cliente no mês.
- **Kill switch.** Chave do Foco (desenho F3); remoção contestada volta ao foco e a janela recomeça.
- **Risco.** Viés de sobrevivência — tratado pela sentinela e pela expiração de 90 d (§ 6.2 do desenho).

### B5. Deriva e recuo de degrau automático

- **O que é.** Duas derivas: (1) **do Oráculo** — Brier da família nos últimos 28 d comparado aos 28 anteriores; > 0,30 em duas medições seguidas → o degrau de autonomia da família recua um (regra única do `plano-autonomia-total.md` § 5); (2) **do dado** — a distribuição de visitas/conversão da conta muda de classe (estado queda/estagnação/crescimento já existe, `retroalimentacao.js:37`) → as medições da janela que cruzou a troca saem do aprendizado como «contexto mudou».
- **Já existe.** `classificarEstado`, `cicloAnterior` (`retroalimentacao.js:513`), regra de recuo escrita no plano de autonomia.
- **Falta.** Série mensal do Brier por família; o recuo executado pela política (`exec_politica`, Chaveiro F7) e registrado no livro.
- **Métrica.** Todo recuo com motivo numérico registrado; 0 subidas de degrau com Brier > 0,25 na família.
- **Kill switch.** O recuo nunca é desligável (é o freio); a subida, sim.
- **Risco.** Oscilação sobe/desce → histerese: só volta a subir depois de 2 medições boas seguidas.

### B6. Auditoria automática da honestidade dos textos

- **O que é.** Além do `relatorio-seguro` antes de cada envio (já existe), uma **reauditoria semanal** de tudo que saiu na semana (planos de terça, urgentes, relatórios, avisos ao consultor, dossiês): (a) passa de novo pelo auditor com a versão atual das regras; (b) confere cada número do texto contra a fonte recalculada (R$, %, unidades); (c) conta termos proibidos («causa», promessa de ranking/vendas, nome interno ao cliente, contagem de dias em pendência aproximada).
- **Já existe.** `relatorio-seguro.js`; textos e hashes guardados (`gatilho_lote`, `relatorio_envio`, `consultor_aviso`, livro com sha256 dos textos).
- **Falta.** O job semanal e o sinal no painel (`textos_reprovados_semana`).
- **Métrica.** 0 textos reprovados que saíram ao cliente por 8 semanas; divergência de número = 0.
- **Kill switch.** Não desligável no envio; a reauditoria tem chave própria.
- **Risco.** Regra nova do auditor reprovando texto antigo correto → reporta como «regra mudou», não como erro.

### B7. Relatório mensal do próprio sistema ao David

- **O que é.** Dia 1, 09h, via Morpheus (WhatsApp do David + PDF pelo mesmo Chrome do relatório): uma página — incidentes do mês (quantos, MTTR, resolvidos por auto-cura × pessoa), cobertura de coleta (% de dias × contas), contas conectadas, disco/banco, autonomia % e cobertura % (C2), Brier por família, regras em quarentena e reativadas, limiares que viraram medidos, textos reprovados, o que o sistema pede ao David (só decisões pendentes).
- **Já existe.** Molde do dossiê mensal (`dossie-real.tickMensal`, `server.js:562`, chave nascendo desligada); PDF (`relatorio-pdf.js`).
- **Falta.** A projeção `montarRelatorioSistema` (pura) e o tick.
- **Métrica.** 3 meses seguidos entregues; o David consegue decidir só por ele (nenhuma pergunta de «como está?» no mês).
- **Kill switch.** `relatorio_sistema_ligado` (nasce desligado, padrão da casa).
- **Risco.** Vira relatório que ninguém lê → 1 página, só exceções e decisões.

---

## C) AUTO-GESTÃO DA OPERAÇÃO — Neo

### C1. Marcos liberados por métrica, aprovação do David só por exceção

- **O que é.** Hoje o plano de autonomia diz «liberado por métrica **e aprovado pelo David**». Para ser autogerenciável, proponho inverter o padrão (decisão D-C1): **o sistema libera o degrau sozinho quando a métrica bate, avisa o Head de canais e o David, e abre 48 h de veto**; sem veto, vale. A aprovação explícita do David fica só para as exceções: (1) a **estreia** de cada adaptador de escrita no ML (primeira ordem real de preço, estoque, Ads, conteúdo), (2) qualquer degrau que mexa em dinheiro do cliente sem custo informado (que por regra nem passa de assistido), (3) M5 (executar e avisar sem aprovação de ordem). O recuo é sempre automático e imediato.
- **Critérios por marco** (os do `plano-autonomia-total.md` § 5, agora checados por função pura `marcoLiberavel(metricas) → { marco, faltam[] }`):

| Marco | Libera sozinho quando | Exceção que pede o David |
|---|---|---|
| M1 conectar e aprovar | cobertura (tarefas `· PS-` ÷ tarefas do Notion) ≥ 30 % por 2 semanas **e** saúde A2 sem crítico por 14 d | — |
| M2 assistido + 1ª publicação | ≥ 50 % das ações distribuídas medidas (B1) **e** 0 «fiz» divergente em 14 d | o «go» da 1ª publicação real |
| M3 escrita no ML | 10 ordens conferidas sem divergência por adaptador **e** 0 reversões em 28 d **e** Brier da família ≤ 0,25 | a estreia de cada adaptador |
| M4 experimentos, Ads, estoque, atendimento | N3 em ≥ 1 família, 0 vendas sem estoque em 30 d nos produtos sincronizados, 50 respostas sem correção (decisão de 02h) | estreia de Ads e de estoque |
| M5 executar e avisar | 3 janelas com Brier ≤ 0,25, reversões ≤ 5 %/mês, exceções ≤ 10/semana/família | sempre |

- **Pré-requisito duro.** Nenhum marco sobe com incidente crítico aberto (A5) ou com Notion/coleta atrasados (A2): um sistema que não enxerga não ganha autonomia.
- **Já existe.** Escada e salvaguardas do Chaveiro (§ 7); Chaveiro F1 classificando caminhos (`chaveiro.js:17`, `:48`; ações abertas: 206 automáticas, 617 assistidas, 301 do cliente); teto de 10 exceções/semana/família (decisão de 02h).
- **Falta.** `marcoLiberavel` + teste (`scripts/teste-autonomia.mjs`, previsto no plano de autonomia § 6); registro do degrau no livro; janela de veto.
- **Métrica que prova pronto.** Toda subida e todo recuo têm métrica e registro; nenhuma subida sem a métrica batida (teste de regressão).
- **Kill switch.** `neo_liberacao_auto = false` → volta ao «David aprova cada degrau»; `chaveiro_ligado = 0` desliga a execução inteira.
- **Risco.** Métrica bater por acaso (amostra pequena) → mínimos de n, 2 medições seguidas e veto de 48 h.

### C2. Painel de autonomia

- **O que é.** `#secAutonomia` em `/planos` (≤ 4 números + 1 tabela ≤ 6 colunas): autonomia % e cobertura %, ordens conferidas × divergentes × revertidas (30 d), incidentes abertos, próximo degrau liberável por cliente × adaptador («faltam 3 ordens limpas»), contas por pessoa da mesa (hoje ≈ 4,7).
- **Já existe.** Especificação no `plano-autonomia-total.md` § 6.
- **Falta.** Construir (depende do Chaveiro F3 para ter `exec_ordem`).
- **Métrica.** Os números batem com o banco em conferência manual mensal.
- **Kill switch / risco.** Só leitura; risco é métrica de vaidade — por isso só números que sobem ou descem degrau.

### C3. O que cada pessoa vê

| Quem | Vê | Não vê |
|---|---|---|
| **Head de canais** (dono dos incidentes e da mesa) | Discord do time **só com exceções**: incidentes [Trinity/Morpheus/…], degrau liberado (com veto de 48 h), recuo, divergência, reversão, reclamação, pendência > 30 d; painel Saúde em `/integracoes`; painel de autonomia; resumo diário 08h só se houver «atenção» | tarefa para fazer, «tudo ok» |
| **David** | WhatsApp só no crítico e nas exceções do C1; relatório mensal do sistema (B7) | o dia a dia |
| **Consultor / time** | resumo de terça 08:30 como hoje (`consultor-discord.js`), agora com «cards distribuídos parados > 7 d» (sem culpa) | saúde interna |
| **Cliente** | só o Merovíngio: plano de terça, urgentes, relatório. Quando falta dado, o texto diz «dados até DD/MM» (dia sem coleta não é zero); nunca incidente, nunca nome de sistema interno | Trinity, Neo, incidentes, degraus |

---

## D) ORDEM, DEPENDÊNCIAS E ESTIMATIVA

Estado de partida: V3 F0–F4 no ar (F3 em revisão, chaves desligadas), alerta de impacto (urgente na hora) e relatório de terça automáticos, Chaveiro F1 no ar, **disco com 2,6 GB livres**.

| Ordem | Etapa | Depende de | Estimativa (ordem de grandeza, estimativa) |
|---|---|---|---|
| 1 | A1 vigia externo + supervisor instalado + log com hora | janela de reinício combinada | **≤ 1 semana** |
| 2 | A4 retenção para o frio (libera ~25 GB) | D-A1 (destino) | ≤ 1 semana (em paralelo a 1) |
| 3 | A2 `/api/saude` + batimentos + painel | 1 | 1–2 semanas |
| 4 | A3 auto-cura (Notion timeout, sync próprio, fila de retentativa da coleta, «sem token» que escala, n8n) | 3 | 1–2 semanas |
| 5 | A5 incidentes + `config/sistemas.json` | 3 | 1 semana |
| 6 | B1 medição com tick e vínculo observado | 4 (Notion em dia) | 1–2 semanas (+ ~3 semanas de janela até o 1º Brier) |
| 7 | A6 vigilância dos dados + A7 backup | 3; D-A2 | 1–2 semanas |
| 8 | B2 calibração por regra/família + quarentena | 6 com n ≥ 10 | 2 semanas (+ espera de amostra) |
| 9 | B6 reauditoria + B7 relatório mensal | 5, 8 | 1–2 semanas |
| 10 | B4 Foco 80/20 (F1–F4 do desenho) | 6 | 4–6 semanas |
| 11 | B3 limiares medidos | 6, V3 ligada, ERP para lead time | contínuo; 1º limiar em ~4–8 semanas |
| 12 | C1/C2 Neo libera por métrica + painel | Chaveiro F3, 5, 8 | 2–3 semanas, depois acompanha M1–M5 |
| 13 | B5 deriva e recuo automático | 8, Chaveiro F7 | 1–2 semanas |

Total para a **auto-operação** (A1–A7): **~5–8 semanas**. Para o **ciclo de aprendizado fechado e calibrando** (B1–B2): **~8–12 semanas** a partir de hoje, porque depende de tempo de janela, não só de código. Neo liberando marcos sozinho: junto do M2 (~semana 10–16). Estimativas de ordem de grandeza; cada recuo soma a janela de prova de volta.

### As 3 primeiras ações para construir já

1. **Vigia externo + supervisor (A1).** `scripts/vigia.sh` + `automacao/com.place2u.place-sprints.vigia.plist` (5 min: `df`, `du` de evidências/relatórios, `curl --max-time 10` na 3012, `sqlite3 -readonly … "select 1"`; aviso na mudança de estado direto no webhook do Discord do time e, no crítico, WhatsApp do David pelo n8n; ping horário ao fluxo «homem-morto» no n8n). Na mesma janela combinada: instalar o plist do servidor seguindo o roteiro do próprio arquivo, com `ThrottleInterval` e `dev.sh` recusando subir com < 1 GB livre; hora ISO no `console.log` de `db.js:324`. É o que teria avisado o David às 03h de hoje.
2. **Retenção para o frio (A4).** `scripts/arquivar-evidencias.mjs` com prévia por padrão: move para o destino frio só anexo > 30 d **com sha256 no livro**, confere o hash no destino, então remove o local e grava `frio:<sha256>`; idem `data/relatorios` > 30 d. Tira o disco do vermelho (~25 GB) sem perder prova. Precisa só da decisão D-A1.
3. **Saúde no processo + 4 auto-curas pequenas (A2 + A3).** `src/lib/saude-sistema.js` (pura) + `GET /api/saude` + batimento em cada `setInterval`; e, no mesmo pacote: retentar timeout/rede em `notion.js` (só leituras), tick de sync incremental a cada 2 h com 3 retentativas, «sem token» 3 ciclos seguidos → incidente, n8n 502 registrado como `erro` com 1 retentativa. Com o tick diário de `medirResultados` pós-coleta junto — custa uma linha e destrava o B1.

### Decisões que o David precisa tomar

- **D-A1** Destino do armazenamento frio dos anexos e relatórios antigos: HD externo no Mac, Google Drive da Place2u ou bucket na nuvem? (muda o script de A4 e o backup de A7.)
- **D-A2** O banco pode ter backup diário fora do Mac (cifrado)? Contém dados de clientes — LGPD. Sem isso, um disco perdido apaga o livro de registro inteiro.
- **D-A3** SLA dos incidentes (proposto: crítico reconhece em 1 h das 08h às 22h, resolve em 4 h; atenção em 48 h) e se o WhatsApp do David toca de madrugada no crítico ou espera as 07h.
- **D-C1** Neo libera degraus sozinho com 48 h de veto (exceções: estreias de adaptador e M5), ou continua «o David aprova cada degrau»?

---

## RESUMO EXECUTIVO

**O que aconteceu hoje.** O disco do Mac encheu com 28 GB de anexos do Notion, o banco parou de abrir e o servidor caiu às ~03h. Ninguém foi avisado. Na véspera, o sync do Notion já tinha falhado (está sem ler desde 13/10 à noite), 7 contas do ML repetiam «sem token» e o n8n deu um erro 502 — tudo só no log. Agora sobram 2,6 GB livres.

**Por que ninguém soube.** Todo alarme do sistema mora dentro dele mesmo: mesmo programa, mesmo banco, mesmo disco. Quando o disco encheu, caiu tudo junto, inclusive o alarme. E o programa que reinicia o servidor sozinho existe no projeto, mas nunca foi instalado.

**As etapas (em ordem):**

1. **Um vigia de fora** (esta semana): um script independente olha a cada 5 minutos disco, servidor e banco, e avisa o time no Discord e o David no WhatsApp só quando algo quebra. Se o próprio vigia sumir, o n8n na nuvem avisa. O servidor passa a reiniciar sozinho se cair.
2. **Arrumar o disco sem apagar prova** (esta semana): anexos com mais de 30 dias vão para um armazenamento frio; o livro de registro já guarda a impressão digital (hash) de cada um, então o dossiê continua válido. Libera ~25 GB.
3. **Painel «Saúde do sistema»** em Integrações: cada parte do sistema (coleta, Notion, tokens, avisos, medição, disco, banco, memória) com verde/amarelo/vermelho e desde quando.
4. **Auto-cura**: o sistema tenta de novo sozinho quando o Notion demora, quando uma conta falha na coleta ou quando o n8n tropeça; problema que se repete vira incidente com dono (Head de canais) e prazo para resolver.
5. **Fechar o ciclo de aprendizado**: hoje há 2.051 ações propostas, 84 aprovadas, 30 distribuídas e **0 medidas**, porque as 30 estão paradas no Notion e a medição só acontece quando o card é concluído. A virada: medir pela mudança que aparece no próprio anúncio, todo dia, sozinho. O primeiro placar de acerto das previsões sai ~3 semanas depois.
6. **O sistema corrige a si mesmo**: regra que erra mais do que um palpite simples perde peso sozinha e sai do foco (continua sendo testada de leve); números que hoje são suposições (prazo do fornecedor, estoque de segurança, efeito das datas comerciais, reação ao preço) passam a ser medidos quando houver dados suficientes.
7. **Foco 80/20** como o David decidiu: pausa automática com aviso, teste a cada 30 dias, veto por alinhamento.
8. **Neo**: os degraus de autonomia sobem sozinhos quando os números batem, com 48 h para veto; o David só aprova as estreias (primeira mudança real de preço, estoque, Ads) e o último degrau. Recuo é sempre automático.
9. **Relatório mensal do sistema ao David**: uma página com o que quebrou, o que se consertou sozinho, o quanto acertou e o que precisa da decisão dele.

**Quem vê o quê.** Head de canais: só exceções. David: só o crítico e o relatório mensal. Cliente: nada disso — continua recebendo só o Merovíngio, e quando faltar dado o texto diz «dados até tal dia».

**Prazo (estimativa).** Sistema cuidando de si: 5–8 semanas. Aprendizado fechado e se calibrando: 8–12 semanas (depende de tempo de medição, não só de programar).

**Decisões pendentes do David:** onde fica o armazenamento frio; se o banco pode ter cópia diária fora do Mac (LGPD); prazos dos incidentes e se o WhatsApp toca de madrugada; se Neo libera degraus sozinho com veto de 48 h.

---

## Decisões do David (15/10/2026, ~03h30)
- **D-A1 Armazenamento frio:** Google Drive da Place2u (pasta pelo app do Drive no Mac); mover só anexo com hash no livro, conferir o hash no destino e só então remover do Mac.
- **D-A2 Backup do banco:** sim, cifrado no Drive, 1 por dia, retenção 14 dias; chave só no Mac (e com o David).
- **D-A3 Madrugada:** só incidente CRÍTICO (servidor fora, dados parados, disco cheio) toca o WhatsApp do Head de canais a qualquer hora; o resto vai ao Discord e espera 07h.
- **D-C1 Neo:** degraus sobem sozinhos quando a métrica bate, com 48 h de veto do David; estreia de cada executor novo e o M5 exigem aprovação explícita.
