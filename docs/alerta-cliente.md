# Alerta de pendência crítica do cliente (08/10/2026, frente F5)

Quando uma pendência do cliente é **crítica**, o sistema faz duas coisas, em camadas independentes:

1. **Aviso interno com som** (sempre, na primeira detecção): `notificar` com `nivel:'erro'`. É o único nível com som diferente em `src/web/alerta.js` (que não se edita).
2. **Página de alerta no Notion do cliente** (automática e imediata, só com o interruptor `alerta_auto` ligado e depois de todas as salvaguardas; ou manual, com prévia, quando o líder decide).

Fonte única dos fatos e dos textos: o avaliador de pendências (`src/lib/pendencias-cliente.js` → `avaliar` e `explicar`) e os templates fixos de `config/dependencias-cliente.json`. O alerta **não é um segundo motor**: não calcula nada, só lê, compara assinatura, avisa e (se permitido) escreve.

Arquivos: `src/lib/alerta-cliente.js` (núcleo, sem banco/Notion reais), `src/lib/alerta-cliente-real.js` (fiação e leituras ao vivo), `src/rotas-alertas.js` (HTTP), `config/alerta-cliente.json`, tabela `alerta_cliente` (`db.js`), `scripts/teste-alerta-cliente.mjs`, `scripts/teste-alerta-rotas.mjs`, `scripts/fixtures/alerta-mundo.mjs`.

## O que dispara (gatilho)

Pendência do avaliador com `gravidade === 'critico'` (config `gatilhos.gravidades`), **menos** os itens de `gatilhos.excluir_itens` (hoje `retorno_pendente`: tarefa em dependência **sem tipo registrado** nunca vira alerta ao cliente).

| Fonte | Quando é crítica (regra do avaliador) | Tipo do aviso interno |
|---|---|---|
| Estoque (ML, medido) | produto curva A com cobertura < 5 dias, volume mínimo, **leitura de até 30 h** | `alerta_estoque` |
| Conta do ML | `meli_contas` com erro | `alerta_acesso` |
| Tarefa em dependência | faixa 30+ dias, ou 14+ dias nos itens de base crítica (documentos, regulatório, acesso), **com tipo registrado pelo líder E data de início real** (registro ou troca de status; nunca a «última edição» do card) | `alerta_dependencia` |
| Registro manual | gravidade `critico` escolhida pelo líder | `alerta_pendencia` |

Atenção e informativo **não** alertam. **Política de tom (08/10):** tarefa sem tipo registrado (`retorno_pendente`) ou com data aproximada (`desde_origem = ultima_edicao`) é, no máximo, `atencao` no avaliador: nunca vira alerta ao Notion, nunca dispara o aviso interno vermelho e nunca chega ao cliente como fato com contagem de dias. O alerta só considera tarefas visíveis ao cliente (`visivel_cliente = 1`). Leitura de estoque com mais de 30 h nunca é crítica (o avaliador a rebaixa).

## Quando roda

- A cada 10 minutos (`setInterval` novo em `server.js`, ao lado do agendador de relatórios) e **ao fim da coleta diária de 4–6 h**.
- "Imediato" para **estoque** = no ciclo da coleta diária, porque a API do Mercado Livre só é lida uma vez ao dia. Para tarefa, registro e conta = em até 10 minutos.
- O aviso interno sai na hora, a qualquer hora. A página no Notion espera a janela (abaixo).

## Assinatura e estados

`assinatura = sha256(item | canal | ids ordenados | gravidade)` (16 hex). `ids` = anúncios em risco (estoque, até 10 por receita), tarefas paradas ou `r{registro}`. O "assunto" é `(cliente, item, canal)`.

| Situação | O que acontece |
|---|---|
| Assinatura igual à de um alerta aberto | nada (nem aviso) |
| Assinatura nova (mais itens, ou item novo) | aviso interno + linha nova (ou a linha ainda não enviada é atualizada no lugar) |
| Encolheu sem piorar (uma tarefa saiu da lista) | silencioso: a mesma linha acompanha a nova assinatura |
| Pendência some do avaliador | `resolvido`; se havia página, Status vira «Concluído» |
| Pendência continua mas deixou de ser crítica | **não** resolve (só o pendente ganha o motivo `sem_confirmacao_atual`) |

Estados: `pendente` (aguardando envio, com o **motivo**), `enviado` (página criada ou adotada), `suprimido` (cooldown ou reconferência negativa; **não é descartado em silêncio**, o assunto segue no próximo relatório), `bloqueado` (auditor ou 403/404/400 do Notion), `falhou` (5xx/rede/timeout, com backoff), `resolvido`.

Há no máximo uma linha aberta por `(cliente, item, canal, assinatura)` (índice único parcial).

## Salvaguardas (todas obrigatórias, nesta ordem; a que falhar deixa o alerta `pendente` com o motivo, nunca descartado)

As locais (sem rede) vêm primeiro, para não ler o Notion de madrugada por um alerta que só sai às 08:00.

| # | Salvaguarda | Motivo | Estado |
|---|---|---|---|
| 1 | Interruptor `alerta_auto` ligado (`sync_estado`; **nasce desligado**) | `interruptor_desligado` | pendente |
| 2 | Cliente liberado (`relatorio_programacao.ativado_por`) e sem pausa | `nao_liberado`, `programacao_pausada` | pendente |
| 3 | Cliente **Ativo** explícito (`status_elegiveis`) | `cliente_inelegivel` | pendente |
| 4 | Cliente **já recebeu pelo menos um relatório** (`relatorio_envio` enviado/adotado): o primeiro contato nunca é um alerta | `sem_relatorio_anterior` | pendente |
| 5 | Janela própria 08:00–20:00, dias úteis, no fuso `America/Sao_Paulo` (Intl, nunca o fuso do processo) | `fora_da_janela` | pendente (sai na abertura) |
| 6 | Cooldown de 7 dias por `(cliente, item)` | `cooldown` | **suprimido** |
| 7 | Teto semanal por cliente (3) e teto diário de páginas (20) | `teto_semanal`, `teto_diario` | pendente |
| 8 | Páginas do Notion de todos os clientes elegíveis verificadas (mesma regra do agendador de relatórios: não dá para descartar página compartilhada) | `bases_nao_verificadas` | pendente |
| 9 | Destino pronto e **não compartilhado**; a categoria «Relatório de Sprints Place2u» já existe na coluna Secção (nunca cria opção nova) | `sem_pagina`, `sem_base`, `destino_compartilhado`, `categoria_ausente`… | pendente |
| 10 | **Reconferência ao vivo** (estoque: relê `available_quantity` de até 3 anúncios; tarefa: ainda em `dependencia_cliente` no Notion; conta: ainda sem responder; registro: ainda aberto). Negativa = `reconferencia_negativa`; leitura indisponível = `reconferencia_indisponivel` (pendente, backoff 30/60/120… min, máx. 6 h) | | suprimido / pendente |
| 11 | Auditor (`auditarBlocos` + título) antes de escrever | `conteudo:<códigos>` (só os códigos; o trecho ofensivo nunca vai a log ou banco) | **bloqueado**, zero escrita |

Falhas do Notion: **401/token ausente** interrompe a varredura (um aviso `erro`, nada é bloqueado); **403/404/400** = `bloqueado` com motivo fixo (`notion_403`…); **5xx, rede e timeout NÃO pausam nada** (`falhou` + backoff; 3 seguidas no mesmo ciclo acionam o disjuntor com um aviso `alerta`). O corpo do Notion nunca vai a log, banco, aviso ou resposta.

### Tempestade
No máximo 5 avisos individuais por varredura (`max_avisos_por_varredura`); o resto vira **um** aviso agregado «M clientes com pendência crítica». Teto de 20 páginas por dia.

## A página no Notion

- **Um alerta, uma página.** Título `Alerta Place2u · {rótulo do item} ({canal}) · dd/mm/aaaa`; ícone ⚠️; categoria «Relatório de Sprints Place2u» (a que já existe); Status «Pendente» (ou «Em andamento») **só se a opção existir**; ao resolver, «Concluído» (também só se existir).
- **Corpo** (`alertaParaBlocos`, função pura): callout vermelho (âmbar se não for crítico) com o item e o canal; seções «O que está pendente» (fato datado do avaliador; com data aproximada, «em aberto; data aproximada: dd/mm», sem contagem de dias), «Por que importa», «Se atrasar», «Possível impacto» (estimativa **com premissa**, ou «Impacto não estimado: …» e «nenhum valor foi estimado»), «O que precisamos», «O que a Place2u faz ao receber»; rodapé «Informação factual datada em dd/mm às HH:MM; a leitura de impacto é uma estimativa, não uma garantia.»
- **Tom**: neutro, factual, datado. Sem responsável, prazo, nome interno, ID ou culpa; sem promessa; associação ≠ causalidade. Os quatro textos são os **templates fixos do catálogo**; todos passam pelo auditor (o teste percorre os 14 itens × todos os canais × impacto com e sem R$).
- **Idempotência**: consulta por título exato antes de criar; **uma** chamada de criação (`retry5xx:false`); 5xx/timeout consulta por título e adota a página se ela existe (`incerto=1`) em vez de reenviar.

## Envio manual (sempre disponível, mesmo com o automático desligado)

`POST /api/alertas/enviar` no molde de `/api/relatorio/enviar`: prévia → confirmar. `confirmar === true` estrito (`"true"` = prévia), `previa_id` válido por 15 min, `por` líder/consultor, trava por cliente, mesmo conteúdo da prévia (o dia e a assinatura da pendência não podem ter mudado). Reaproveita todos os guardas **exceto** interruptor, janela e liberação (o líder decide). **Nunca** para cliente não Ativo; **nunca** para destino compartilhado sem `confirmar_destino:true` (o título leva o nome do cliente ao final). Cooldown, tetos, reconferência e auditor continuam valendo.

## Rotas (prefixo `/api/alertas`, JSON; 415 sem `Content-Type: application/json`; mensagens fixas sem eco; prospect `[Comercial]` = 404)

| Rota | Corpo / query | Resposta |
|---|---|---|
| `GET /cliente?cliente=` | — | `{ itens:[Item], automatico:{ligado}, quem }` |
| `GET /pendentes` | — | `{ itens:[{cliente, …Item}], automatico:{ligado}, resumo:{pendentes, enviados_7d, bloqueados}, quem }` (pendente, falhou e bloqueado) |
| `POST /enviar` | `{ id, por, confirmar?, previa_id?, confirmar_destino? }` | prévia `{ ok:true, previa:true, previa_id, titulo, destino:{estado,pagina_titulo,informacoes_url}, acao:'criar'\|'adotar'\|'bloqueado', bloqueio, linhas:[texto], violacoes:[], avisos:[], expira_em }` · envio `{ ok:true, previa:false, estado:'enviado'\|'adotado', url }` · impedimento (200) `{ ok:false, estado, motivo, mensagem }` |
| `GET /agendador` | — | `{ ligado }` |
| `POST /agendador` | `{ ligado:boolean, por }` | `{ ok:true, ligado }` |

`Item = { id, item, rotulo, canal, canal_rotulo, gravidade, estado, motivo (texto fixo), motivo_codigo, titulo, page_url, criado_em, enviado_em, resolvido_em, assinatura }`. O `estado` do impedimento é o código do motivo (`cliente_inelegivel`, `sem_relatorio_anterior`, `destino_compartilhado`, `cooldown`, `teto_semanal`, `reconferencia_negativa`, `bloqueado`, `falhou`, `enviado`, `resolvido`…).

## Limites declarados (honestidade)

- **"Imediato" para estoque = ciclo da coleta diária.** A API só é lida uma vez ao dia; entre uma coleta e outra o sistema não vê a ruptura. A reconferência ao vivo relê só os anúncios citados, no momento do envio.
- **Notificação ao cliente no Notion não é garantida.** A página aparece na base Informações; menção ou comentário (que gerariam push) nunca foi exercitado. Validar num workspace de teste antes de prometer "o cliente é avisado".
- **Shopee, Amazon, TikTok e Magalu não têm integração**: só alertam por tarefa do Notion ou registro manual, e nunca com R$.
- **Resolver ≠ garantia de causa.** O alerta resolve quando a pendência **some do avaliador**; uma falha de coleta que esvazie os dados (ex.: reconexão com outra conta) também a faz sumir. Se a pendência voltar dentro de 7 dias, o novo alerta fica suprimido (cooldown) e a página antiga já estará «Concluído».
- **`reconferencia_negativa` e `cooldown` suprimem a assinatura**: ela só volta a alertar se mudar (item novo) ou depois de resolver e reaparecer fora do cooldown.
- **Gatilho da tarefa**: vem da régua do avaliador (30+ dias, ou 14+ nos itens de base crítica). Mudar a régua é no catálogo/playbook, não aqui.
- Documentos, acesso e regulatório alertam a partir de 14 dias porque o avaliador os classifica como críticos nessa faixa.
- O interruptor desligado ainda **detecta e avisa por dentro**; os alertas ficam `pendente` (motivo `interruptor_desligado`) e saem quando ligar, depois de reconferidos ao vivo e dentro dos tetos. A atualização do Status para «Concluído» também obedece ao interruptor (é uma escrita visível ao cliente).
- Timeout por chamada é o do cliente do Notion (60 s); não há corrida de timeout por cliente como no relatório.

## Como ligar (ordem sugerida)

1. Revisar os textos do catálogo (`config/dependencias-cliente.json`) com o David.
2. Conferir em `GET /api/alertas/pendentes` o que está aguardando e testar o **envio manual** em um cliente-piloto.
3. Só então `POST /api/alertas/agendador { ligado:true, por }`. Desligar a qualquer momento é o freio de emergência (não exige reiniciar o servidor).
