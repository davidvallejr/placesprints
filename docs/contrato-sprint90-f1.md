# Place Sprint 90 — contrato técnico da fase F1 (identidade, guarda por host e painel de leitura)

Entregue em 08/10/2026. Desenho: `docs/desenho-place-sprint-90.md` (D1–D24). Operação e fases: `docs/sprint90.md` (frente F0). Números: `config/sprint90.json` (só leitura aqui).
O painel é **projeção** do que o Algoritmo já produziu (`acoes_plano`, `dados.fila === 'esta_semana'`): nada aqui decide prioridade.

## 1. Interruptor e variáveis (`src/lib/env.js`)

| Variável | Uso na F1 |
|---|---|
| `SPRINT90_PUBLIC_HOST` | host público do painel (ex.: `sprint90.place2u.com.br`). **Vazio = nada do Sprint 90 existe**: `/c/*` e `/api/sprint90/*` caem no 404 do servidor (inclusive no localhost), o callback do ML recusa chave S90, os timers não rodam. Host comercial e do ML seguem iguais. |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_MODO` (padrão `teste`) | lidas, sem uso na F1 (F3). |
| `EMAIL_PROVEDOR`, `EMAIL_REMETENTE` | sem provedor integrado: `src/lib/email.js` devolve **sempre** `{ estado: 'pendente', canal: 'painel', faltando: [...] }`. |

Para ligar: `SPRINT90_PUBLIC_HOST=…` no `.env` + ingress no `~/.cloudflared/config.yml` (David) + reinício pelo fluxo combinado.
**`config/sprint90.json` inválido** (vírgula sobrando…) com a env definida = Sprint 90 desligado (`hostS90Publico() === ''`: callback, timers e rotas como sem a env), sem derrubar o servidor. A guarda continua reservando o host da env para a lista fechada, então o roteador fecha **todo** pedido desse host com 503 "Em manutenção" (nada cai no estático — que serviria o painel interno em `/`); no loopback `/api/sprint90/*` = 503 com o motivo real, e Integrações mostra "config/sprint90.json inválido" (não "falta a env").

## 2. Guarda (`src/lib/guarda-local.js`)

`guardaLocal(req, res, next, hostComercial, hostS90 = process.env.SPRINT90_PUBLIC_HOST)` — a assinatura antiga (4 parâmetros) segue igual.
Pelo túnel, **só o host exato** `SPRINT90_PUBLIC_HOST` alcança a lista fechada `ROTA_PUBLICA_S90` (sem prefixo aberto, sem caixa-insensível; `%2f`, `%5c` e `..` = 403):

`/`, `/logo`, `/c`, `/c/entrar`, `/c/sair`, `/c/painel`, `/c/conectar`, `/c/conectar/fim`, `/c/termos`, `/c/privacidade`, `/c/acesso/<22>`, `/c/api/resumo`, `/c/api/acoes`, `/c/api/aceite`, `/c/api/acesso/gerar`, `/c/api/dados/excluir`.

O host S90 é **exclusivo** (revisão de 08/10): a guarda decide por ele ANTES das rotas públicas do ML (`ROTA_PUBLICA`), então `/meli/*`, `/webhook/*` (inclusive `/webhook/custos/<wid>`, montado antes do roteador S90) e `/erp/callback` pelo host S90 = 403. POST no host S90 só com `Origin: https://<host>` (http:// do mesmo nome = 403).

Reforço no roteador (`src/rotas-sprint90.js`): `/c/*` só responde no host S90 ou no loopback; `/api/sprint90/*` só no loopback; qualquer outro caminho no host S90 = 404 próprio (o estático e as telas internas nunca respondem lá). `/webhook/mp` **não** está na lista (F3).
Ordem no `server.js`: `guardaLocal` → `express.json` → `rotasPublicas` → **`rotasSprint90`** → … → `express.static`.

## 3. Rotas do cliente (`/c/*`)

Identidade = sessão. No host S90 o cookie é **`__Host-s90`**: `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure` (o prefixo proíbe `Domain`: um subdomínio irmão de place2u.com.br não planta nem sombreia a sessão); só esse nome é lido nesse host e **mais de um cookie de sessão no mesmo pedido = sem sessão**. No loopback segue `s90` com `Path=/c` e `Secure` só com `X-Forwarded-Proto: https` (**em `http://localhost` sem `Secure`**: o navegador o descartaria). Token de 128 bits; no banco só o SHA-256. Sessão de 30 dias deslizante (cada uso empurra o prazo; `/c/painel` renova o cookie) com **teto absoluto de 90 dias desde o login** (`sessao_max_dias`, padrão 90). `/c/api/*` deriva o cliente **só da sessão**: `?cliente=` e `body.cliente` são ignorados. Erros com texto fixo.
**HTTPS:** toda resposta do host S90 leva `Strict-Transport-Security: max-age=31536000`; pedido com `X-Forwarded-Proto: http` vira 301 para `https://<host><caminho>` (GET/HEAD) ou 400 (outros métodos) **antes de qualquer rota** — POST em http nunca gasta o link de uso único.

| Método e rota | Sessão | O que faz |
|---|---|---|
| `GET /` (host S90) | — | Com sessão válida: 302 `/c/painel` (quem já é cliente volta ao painel). Sem sessão: `assets/sprint90/landing.html` (sem o arquivo: 302 `/c/entrar`). No loopback `/` continua sendo o painel interno. |
| `GET /c/entrar` | — | "Cole seu link" + "Perdeu o link? Fale com a Place2u". Sem formulário de e-mail. |
| `GET /c/acesso/:token` | — | Só mostra o botão "Entrar no painel" (pré-visualização de link no WhatsApp/e-mail **não** gasta o uso único). |
| `POST /c/acesso/:token` | — | Consome o link (UPDATE condicional `usado_em=''` e não vencido) → abre sessão → cookie → 303 `/c/painel`. Inválido, vencido ou usado = mesma página 404. Limite: 10 por 15 min por IP (IPv6 por /64). |
| `POST /c/sair` | — | Revoga a sessão, apaga o cookie, 303 `/c/entrar?saiu=1`. `POST /c/sair?todos=1` ("Sair de todos os aparelhos", aba Conta): revoga **todas** as sessões da conta e os links ainda não usados. |
| `GET /c/painel` | página | Painel (abas Resumo · Prioridades · Conta), montado no navegador por DOM a partir das APIs. Sem sessão: 302 `/c/entrar`. |
| `GET /c/conectar` | página | Conta `ativo` + aceite feito + ML configurado → 302 para o OAuth (`linkConectar(chave, 10/1440)`: **10 minutos**). O link fica **amarrado a esta sessão** (`s90_oauth`: hash da assinatura × hash da sessão, uso único; a mesma sessão pedindo de novo rearma). Senão página fixa (409/503). **Sessão aberta por "Guardar meu acesso"** (`s90_sessao.origem = 'painel'`: link que uma sessão gera e pode repassar) **só reconecta o vendedor já ligado**: sem vendedor na conta = 409 "Este acesso só reconecta…" antes do ML. Ligar um vendedor = sessão do link da equipe (ou do retorno do pagamento, F3). |
| `GET /c/conectar/fim?code&state` | página | Volta do OAuth: o `/meli/callback` do host do ML **não troca o código** de chave S90, só repassa `code` + `state` para cá. Sem sessão → 302 `/c/entrar`; state inválido, de outra conta, de outra sessão, vencido ou já usado → 403; conta fora de "ativa com aceite" → 409; sessão de "Guardar meu acesso" e vendedor diferente do já ligado → 409, nada gravado, autorização nova revogada (se nenhuma outra conexão do vendedor usa o app); senão troca o código, D17 na transação, grava → 303 `/c/painel?conectado=1` (409 duplicado, 410 excluída no meio, 500 falha do ML). Quem recebe o link de outra pessoa — o do OAuth **ou** o "Guardar meu acesso" — e autoriza **não liga** o próprio vendedor à conta alheia. Resíduo declarado: o titular que encaminha o link de **15 min da equipe** (entregue a ele) dentro do prazo. |
| `GET /c/termos`, `GET /c/privacidade` | — | Texto de `config/termos-sprint90.md` (tudo escapado); `/c/privacidade` = só a seção `## … Aviso de Privacidade`. Rascunho aparece com faixa "Rascunho em revisão jurídica". |
| `GET /c/api/resumo` | API | ver §5. Limite: 30/min por IP (com `/c/api/acoes`). Os números do diagnóstico ficam em cache por conta até chegar coleta nova (dias/última data) ou 15 min. |
| `GET /c/api/acoes` | API | `{ acoes: [projeção §6], fora_do_autoatendimento }` — só as ações `anuncio_*` da chave da sessão, status `proposta|aprovada|distribuida`, `dados.fila === 'esta_semana'`, na ordem do motor (score). |
| `POST /c/api/aceite` `{ aceite: true, consentimento: true }` | API | Registra o aceite dos termos e o consentimento LGPD (os dois `=== true`). |
| `POST /c/api/acesso/gerar` `{}` | API | "Guardar meu acesso": link de uso único de 30 dias (`origem: 'painel'`), mostrado uma vez. Limite 5/h por IP. |
| `POST /c/api/dados/excluir` `{ confirmar: true }` | API | Exclusão LGPD (§8). Resposta `{ ok, pendente, revogado, mensagem }`; o texto só afirma a revogação se o ML confirmou. |

Toda resposta de `/c/*`: `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: same-origin` (o desenho dizia `no-referrer`, mas com ele o navegador manda `Origin: null` no POST de formulário — `/c/acesso`, `/c/sair` — e a guarda de CSRF barra; para fora do site nenhum referrer sai). Páginas: CSP `default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'nonce-…'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, `X-Frame-Options: DENY`. Cores = 1º `:root` de `src/web/ui.css` embutido (fonte única dos tokens); nada de `/ui.css`, `/shell.js`, `/alerta.js`. POST com `Origin` de outra origem = 403 (guarda). POST de API sem `Content-Type: application/json` = 415. Sem sessão = 401 `{ erro: 'Sua sessão expirou: entre de novo pelo seu link.' }`.

## 4. Estados da conta (`s90_conta.estado`)

`pendente_pagamento → ativo → {pausado, inadimplente} → cancelado → (expurgo) excluido`; `excluir_pendente` = exclusão pedida com assinatura no MP ainda não cancelada.
Mudanças manuais (rota interna): `pendente_pagamento → ativo|cancelado`, `ativo → pausado|cancelado`, `pausado → ativo|cancelado`, `inadimplente → ativo|pausado|cancelado`.
**No piloto sem Mercado Pago, `ativo` marca o dia 1 dos 90** (`inicio_em = hoje` se vazio; `preco_travado_ate = inicio_em + 12 meses`). Na F3 isso passa a ser o 1º pagamento autorizado.
Sessão vale em `pendente_pagamento`, `ativo`, `inadimplente`, `pausado`, `cancelado` (este só leitura até o expurgo). Conectar o ML: só `ativo` com aceite.
Fase (calendário, nunca "prova concluída"): dias 1–30 Estruturação, 31–60 Evolução, 61–90 Consolidação.
Turma fundadora: vagas = ativos + pausados + inadimplentes + pendentes com menos de 24 h, contadas em transação `immediate` no cadastro e na ativação; cheia = 409 "Turma completa".

## 5. Resumo (`GET /c/api/resumo`) — campos

`conta { loja, plano, plano_rotulo, preco_centavos, comissao_pct, estado, estado_texto, inicio_em, preco_travado_ate, dia, total, fase }`,
`aceite_pendente`, `termos_disponiveis`, `termos_versao`, `pode_conectar`, `conexao { estado: conectada|caida|sem_conexao, nickname, desde }`,
`leitura { lendo, dias, ate } | null`, `numeros { faturamento_28d, variacao_pct, pedidos, ticket, anuncios_ativos, conversao_pct } | null` (de `diagnosticarConta().resumo`, só banco — nunca chama o ML), `prioridades` (quantas na semana).
Nunca saem: chave, id, e-mail, token, IP, nada do Notion.

## 6. Projeção de uma ação (`src/lib/s90-texto.js → acaoParaCliente`) — lista FECHADA

`titulo` (sem o sufixo `(MLB…)`; reprovado vira "Prioridade da semana"), `problema`, `evidencia`, `hipotese`, `como[]`, `indicador`, `meta`, `aceite`,
`previsao { tipo, horizonte_dias, cenarios{conservador,base,otimista}{unidades,receita}, premissas[], p_sucesso, p_fonte }`,
`anuncio { id, titulo, permalink (só domínio do ML), thumb (só mlstatic, em https) }` — fora do crivo (é o anúncio do próprio cliente),
`modo` (`executa` = Ofertas: ímã de conversão, fotos, frete e regras `oferta_*`; `recomenda` = o resto) + `modo_texto` (na F1 o de `executa` diz que a execução pelo painel ainda será liberada e que, até lá, o cliente aplica no Mercado Livre — a tela não promete o que não faz), `prazo`.
Cada linha de texto passa pelo auditor do relatório (`relatorio-seguro.auditarTexto`: promessa, causalidade, jargão, ID interno, nomes da equipe) e por um crivo do bastidor (consultor, analista, briefing, Notion, card, squad, Merovíngio, "o cliente" na 3ª pessoa — a "voz do cliente" fica —, duplicação/duplicata). **Linha reprovada é omitida e contada** (`linhas_omitidas`, logada no servidor; não vai ao cliente). Nunca saem: responsável, squad, delegado, Notion, profissional/ranking, lógica da prioridade, retro, id da ação.
A cópia fixa das páginas (`src/lib/s90-paginas.js`) não passa pelo auditor ("Place Sprint 90" é jargão para ele).
As regras `duplicacao_estrategica`, `urgencia_oculta` e `concentracao_receita` (`config/algoritmo.json → foco.regras_exigem_consultor`) **não nascem** para chave S90: `gerarPlanoConta` chama `montarAcoes(…, { semConsultor: ehChaveS90(cliente) })`, que as tira antes do corte de foco e conta em `omitidas.exige_consultor` — as 5 vagas da semana enchem com o que o cliente executa ou aplica. A `versao` do algoritmo não mudou (1.4.0).

## 7. Rotas internas da equipe (`/api/sprint90/*`, só loopback)

Corpo JSON obrigatório nos POST (415). `por` = nome de líder ou consultor (`validarLiderOuConsultor`; senão 403). Mensagens fixas.

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/sprint90/contas` | — | `{ ligado, host, termos { existe, publicados, rascunho, versao }, vagas { total, ocupadas, restantes }, contas: [{ id, chave, loja, nome, email, telefone, plano, preco_centavos, comissao_pct, piloto, estado, aceite_em, termos_versao, inicio_em, preco_travado_ate, criado_em, conexao }] }` |
| `POST /api/sprint90/contas` | `{ nome, loja, email, telefone?, faixa?, plano: 'fixo'|'crescimento', piloto?, por, confirmar? }` | Sem `confirmar === true` (a string "true" não vale): **prévia** `{ previa: true, conta: { …normalizado, preco_centavos, vagas, termos_publicados, termos_rascunho, piloto } }`, nada gravado. Com `confirmar: true`: cria em `pendente_pagamento` → `{ previa: false, conta }`. |
| `POST /api/sprint90/contas/:id/acesso` | `{ por }` | Link de uso único de **15 min** para a equipe entregar: `{ url: 'https://<host S90>/c/acesso/<token>', expira_em, email: { estado: 'pendente', … }, nota }`. Mostrado uma vez (só o hash fica no banco). **Sem `url_local`** (testar no computador da equipe gastava o uso único do cliente). Todo link novo (equipe ou "Guardar meu acesso") invalida os anteriores ainda não usados. |
| `POST /api/sprint90/contas/:id/revogar` | `{ por }` | `{ ok, sessoes, links }`: derruba todas as sessões e links ainda não usados da conta (Integrações → ⋯ → "Derrubar acessos"). |
| `POST /api/sprint90/contas/:id/estado` | `{ estado, por, motivo }` | `{ conta }`; transição fora da tabela §4 = 409; `motivo` obrigatório. |

**Termos e piloto.** Sem `config/termos-sprint90.md`, cadastro e aceite ficam bloqueados (503, "Termos do Place Sprint 90 ainda não publicados: cadastro bloqueado."). Arquivo que começa com `# RASCUNHO` = termos **não publicados**: o mesmo 503 para qualquer conta, **exceto** a conta criada pela equipe com `piloto: true` (estrito) — piloto/demonstração (`s90_conta.piloto = 1`), a única que cadastra e aceita o rascunho (o evento de aceite registra `rascunho: true`). Quando o texto publicado mudar o hash, todo mundo (piloto inclusive) aceita de novo. A F3 (`/c/assinar`) segue a mesma regra, sem exceção de piloto (cliente do checkout nunca é piloto).

### Como a equipe cria uma conta e entrega o acesso
Pela tela **Integrações → Assinantes Sprint 90** (`src/web/integracoes.js`, bloco `<s90>`; sem 12ª tela no shell): preencher "Seu nome" → "Nova conta Sprint 90" → prévia e confirmação → na linha: menu ⋯ → "Ativar (piloto sem Mercado Pago)" → "Gerar link de acesso" → copiar e entregar ao cliente por um canal seu (vale 15 min, abre o painel uma vez). O cliente aceita os termos no painel, conecta o Mercado Livre e, se quiser, usa "Guardar meu acesso" para ter um link próprio de 30 dias. Perdeu? A equipe gera outro.

## 7b. Isolamento nos indicadores internos (A11, 08/10)

Ações do plano de contas `[S90] …` nascem sem responsável e sem squad por desenho. Para não contaminar a visão da liderança, ficam FORA de: `padroesDaBase` (`src/lib/merovingio.js`, "Gargalos da base" e `/api/merovingio/padroes`), `padroesGlobais` (`src/lib/impacto-tarefas.js`) e `/api/planos/insights` (`src/rotas-planos.js`), todos com `NAO_S90_SQL` de `src/lib/s90-chave.js`. A conta S90 continua entrando na coleta, no plano por anúncio e na calibração (o motor aprende com ela), só não aparece como "cliente da base" nos painéis internos.

## 8. Exclusão e retenção (`src/lib/s90.js`)

`excluir(id, { por, se })` (ordem fixa): (1) assinatura no Mercado Pago cancelada **antes** (sem MP configurado e com `mp_preapproval_id` → `excluir_pendente`, aviso interno, nada apagado; o expurgo diário retenta); (2) `revogarConexao` (melhor esforço; a página só afirma o que o ML confirmou; app comparado pelo **efetivo**: `app_id ''` = app principal, então a conexão antiga da central do mesmo vendedor nunca é revogada junto); (3) `desconectar` — chave S90 **nunca** vai para `meli_contas_arquivo`; (4) evidências das tarefas da chave (FK) e as linhas da chave em **toda tabela do banco que tem a coluna `cliente`**; (4b) `ia_cache` com a chave no escopo, avisos (`notificacoes`) que citam a chave no título/corpo e `meli_notificacoes` do vendedor quando nenhuma outra conexão o usa; (5) sessões, links e vínculos de OAuth; eventos menos `aceite`/`consentimento`; (6) anonimiza `s90_conta` (nome, e-mail, telefone, loja, faixa; chave vira `[S90] excluída · <id>`); faturas e pagamentos ficam (prazo fiscal); (7) `sync_log` com a chave; (8) `data/backups/meli_pendente-*.json` da chave (`purgarPendentesDe`). `se` = estados em que a exclusão ainda vale: o estado é reconferido depois do MP, depois do ML e dentro da transação (conta ativada no meio nunca é apagada; aviso `s90_exclusao_abortada`).
`log()` (db.js) grava a chave S90 só como `Sprint 90 <id8>` — o stdout vira `data/server.log`, que a exclusão não alcança. O aviso de vendedor duplicado cita S90/prospect só pelo id.
S90 fica fora de `backupConexoes` e `restaurarConexoes`/`/api/meli/restaurar` recusam chave S90; `/api/meli/desconectar` responde `restauravel: false` para S90.
Expurgo 1×/dia (timer no `server.js`), **cada conta isolada** (uma exclusão que lança é contada em `falhas`, avisada — `s90_expurgo_falhou` — e não segura as outras): IP de evento com mais de 12 meses → apagado (primeiro, independente das exclusões); pendente de pagamento há mais de `expurgo_nao_pago_dias` (7) sem conexão → excluída; cancelada há mais de 90 dias → excluída; `excluir_pendente` → retenta; **órfãos** (linhas com chave `[S90] …` que nenhuma `s90_conta` aponta — coleta em voo que gravou depois da exclusão — e `ia_cache` com chave `[S90] …` no escopo de conta que não existe mais, de um `redigir()` em voo) → apagados; conta excluída há mais de `retencao.fiscal_anos` (5) → somem eventos (aceite com e-mail/IP/UA), faturas, pagamentos e a própria linha. Resultado `{ pendentes, cancelados, retentativas, ips, orfaos, fiscais, falhas }`. Ledger diário `data/backups/s90-<dia>.json` (contas, faturas, pagamentos, eventos; modo 0600; 30 dias), gravado **mesmo se o expurgo falhar** — dados de conta excluída somem do ledger em até 30 dias depois do prazo fiscal.
`/webhook/meli` só guarda notificação de vendedor com conexão em `meli_contas` (excluído com a revogação não confirmada, desconectado ou `user_id` inventado: nada guardado — a rota é aberta).
Conta S90 cancelada (ou pendente/exclusão agendada) sai da coleta diária, das promoções de madrugada e da renovação preventiva (`listarConexoesColeta`, `S90_FORA_DA_COLETA_SQL`): os dados já lidos ficam só para consulta até o expurgo.

## 9. Callback do Mercado Livre (`/meli/callback`, `server.js`)

`/meli/conectar` com chave S90 e Sprint 90 desligado ou conta fora de "ativa com aceite" → 410 **antes** de levar ao consentimento do ML. `/meli/callback` com chave S90: mesmas condições → 410; senão **não troca o código** — 302 para `/c/conectar/fim?code&state` (§3) **no host da sessão que pediu o link**: `https://<host S90>` ou, se ela estava no loopback (teste/piloto da equipe em `localhost`, `s90_oauth.volta`), `http://localhost:<porta>` — só host loopback, nunca um host qualquer. Lá só a sessão dona do link conclui. O state é só HMAC e o PKCE é derivado dele: sem esse passo, o link era um bearer transferível. Erro do ML (`?error=`) = texto fixo ("Autorização recusada no Mercado Livre." / "O Mercado Livre não concluiu a autorização."), **nunca** o `error_description` da query; no log, só o código do erro.
Na conclusão (`rotas-sprint90.js → concluirConexaoML`), na transação da gravação: conta re-checada e **mesmo vendedor em outro cadastro = bloqueado** (409 "Esta conta do Mercado Livre já está conectada em outro cadastro. Fale com a Place2u.", nada gravado, aviso interno `s90_seller_duplicado`). O token recém-obtido é revogado **só quando nenhuma outra conexão do mesmo vendedor usa o mesmo app efetivo** (`app_id ''` = principal) — o ML revoga o app inteiro para o vendedor, então revogar derrubaria a outra conexão (nesse caso o token novo só é descartado). Prospect do Comercial (`[Comercial] …`, lead do diagnóstico) **não** bloqueia: não é cadastro pago, e revogar um não derruba o outro.
Gravou: aviso interno (`link: '/integracoes'`), evento `conexao`, e em segundo plano coleta → `capturarAcompanhamento` → `gerarPlanoConta` (**sem `gerarPlanosEscopo`**, que depende do Notion) → 303 `/c/painel?conectado=1`. Troca de vendedor na mesma conta S90 apaga o plano por anúncio do vendedor anterior (`salvarConexao`). Erros mostram o rodapé "Volte ao painel e tente de novo".
A conta S90 em serviço (ativa, pausada, inadimplente) entra em `listarConexoesColeta` (coleta diária, promoções de madrugada) e na renovação preventiva. Tarefas `fonte = 's90'` (o "fiz" da F2) ficam fora de `metricas.js` (KPIs, filtros), `placeplan.analistaDaConta` e `/api/estado`.

## 10. Tabelas (`src/lib/s90-schema.js`, aditivas, `db.exec` depois do schema do alerta)

`s90_conta` (com `piloto` 0/1 além da seção 2 do desenho), `s90_sessao` (+ `origem`: o link que a abriu), `s90_acesso`, `s90_oauth` (vínculo link do OAuth × sessão, uso único, 10 min; + `volta`: host loopback de quem pediu) — colunas novas acrescentadas por `ALTER TABLE` em `db.js` se a tabela já existir, `s90_fatura`, `s90_pagamento`, `s90_mp_evento`, `s90_evento` (tipos usados na F1: `estado`, `novo_link`, `login`, `aceite`, `consentimento`, `conexao`, `exclusao`, `revogacao`), `s90_relatorio`. As de fatura/pagamento/MP/relatório nascem vazias (F3/F4).

## 11. Testes

`scripts/teste-sprint90-guarda.mjs` (1), `teste-sprint90-conta.mjs` (2; blocos 10–11 = achados de 08/10), `teste-sprint90-oauth.mjs` (ponta a ponta com o `server.js` real em memória, porta aleatória, ML falso), `teste-sprint90-motor.mjs` (3, sem "vou fazer/fiz"), `teste-sprint90-texto.mjs` (4, parte guarda/projeção; a landing é de `teste-s90-landing.mjs`, frente F0). Blocos novos: `teste-comercial-publico` (host comercial não alcança `/c/*` nem `/webhook/mp`), `teste-plano-anuncios` (bloco 20, `semConsultor`), `teste-shell-ui` (caso 13, bloco em `/integracoes`). Nenhuma asserção existente mudou de valor, exceto (revisão de 08/10, motivo declarado no próprio teste): o cookie do host S90 virou `__Host-s90` (A13) e as asserções da conclusão do OAuth S90 saíram do `server.js` para `rotas-sprint90.js → concluirConexaoML` (A1). Revisão dos céticos (08/10, `teste-sprint90-oauth`): volta do OAuth ao loopback, "Guardar meu acesso" só reconecta, webhook de vendedor sem conexão, host S90 = 503 com config inválida (servidor real num processo filho); `teste-sprint90-conta` bloco 10: `ia_cache` órfão no expurgo, `voltaDaConexao`/`origemDaSessao`.

## 12. Fica para depois

F2: aprovar/descartar/vou fazer/fiz (tarefa `fonte='s90'`), executar via Ofertas (import + `abrirJob`, GATE 0, campo a campo, prévia), custos/regra/catálogo do cliente, conferência e monitor agendados, relatório snapshot (`s90_relatorio`), id opaco da ação na projeção. F3: `mp.js`, `/webhook/mp` (entra na lista fechada por host), `/c/assinar`, `/c/retorno`, aplicar pagamento, cancelamento/arrependimento/estorno, inadimplência, extrato, exportar dados (até lá a tela, os termos 6.2/11.2 e a FAQ da landing dizem "peça a cópia dos dados à Place2u", corrigido em 08/10). F4: comissão (`fechamento.dias_apos_fim_mes`), faturas, contestação. Também: contador "N ações ficam com a assessoria" (hoje texto fixo; `omitidas.exige_consultor` não é persistido) e reconexão com aviso de conexão caída no extrato.
