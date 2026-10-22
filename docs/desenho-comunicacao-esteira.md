# Desenho da comunicação em esteira (Place Sprints)

Data: 21/10/2026. Status: proposta final para decisão do David. Nada foi gravado no código nem no banco. As referências arquivo:linha vêm dos três mapas de leitura, salvo onde está marcado como verificado.

## Resumo em 10 linhas

1. Hoje o Place Sprints envia comunicação por cerca de sete caminhos (WhatsApp, Notion do cliente, e-mail, Discord do consultor, sino, relatório e portal), e cada um tem seu próprio vocabulário de estado.
2. O banco e a configuração não concordam sobre quais envios estão ligados. Antes de qualquer tela, o David confirma o que vale.
3. A proposta é uma fila única, chamada Comunicação, em que cada item passa por seis estágios visíveis: Capturado, Redigido, Auditado, Liberado, Enviado e Recibo.
4. Cada item tem um dos sete estados (Processando, Aguardando você, Prontos, Enviado, Falhou, Pausado, Não elegível) e mostra o que falta para sair.
5. Cliente e Time são faixas separadas no servidor, não só na tela. O cliente nunca recebe dado interno.
6. Cada tela tem um único botão principal, com o número no rótulo ("Revisar 7", "Enviar 4 prontos").
7. "Processar lote" para em Prontos e nunca envia. O envio é um botão separado, com contagem e prévia.
8. Enviado só vira Concluído com recibo. Sem recibo no prazo, o item vira Falhou com motivo.
9. A implantação tem uma Fase 0 (decisões, sem código) e as fases F1 a F9, cada uma publicável com a suíte verde.
10. A primeira fase de código só lê: uma projeção e um endpoint, sem tela e sem envio.

**Frase-regra: nada sai sem liberação; preparar não envia; enviado só com recibo.**

---

## 0. Gate: confirmar o estado real antes de tudo

- O banco (`sync_estado`) marca como ligados: `gatilhos_ligado`, `relatorio_agendador`, `alerta_auto` e `consultor_discord_ligado`.
- A configuração marca como desligados: `agendador_ligado: false` em `config/relatorio-envio.json:24` e `automatico_ligado: false` em `config/alerta-cliente.json` (o mapa 1 cita a linha 14).
- Um dos mapas diz que a chave gravada no banco vence o padrão do arquivo. Nesse caso o efeito real é ligado.
- Já saíram, segundo os mapas: 110 lotes de WhatsApp entregues (78 de origem `timer`), 19 relatórios ao Notion em 16/10 e 36 avisos ao consultor no Discord entregues.
- `urgente.na_hora_ligado` é `true` em `config/gatilhos.json:40` (verificado). O briefing diz desligado. O interno (`consultor.urgente_ligado`) está desligado.
- Regra: nenhuma tela nova sobe antes de o David confirmar quais interruptores valem. A tela mostra o estado real de cada um no topo. Se banco e configuração divergirem, mostra "conflito" e não envia (D13).

## 1. O modelo

### 1.1 Estágios (6)

| # | Estágio | Significa | Quem move |
|---|---|---|---|
| 1 | Capturado | O fato entrou: gatilho avaliado, plano montado, relatório programado, incidente aberto | Sistema |
| 2 | Redigido | Texto ou página montados, com hash gravado | Sistema |
| 3 | Auditado | Passou pelo auditor de texto. Só vale para texto ao cliente. Em interno aparece "—" | Sistema |
| 4 | Liberado | Há liberação gravada: `liberado_por` (pessoa) ou `regra:<id>` (regra gravada com versão). Só vale para cliente | Líder; regra gravada, no caso do urgente |
| 5 | Enviado | Saiu para o canal (2xx do n8n ou página criada). Ainda não prova entrega | Sistema |
| 6 | Recibo | O canal confirmou: recibo do n8n, página criada ou adotada, ou publicado no portal | Sistema |

"Medido" (resultado) não entra na esteira. Pertence ao Merovíngio e a Anúncios.

### 1.2 Estados (7)

- **Processando:** estágio automático andando (1 a 3), ou Enviado esperando recibo dentro do prazo, ou espera automática (janela, cooldown).
- **Aguardando você:** precisa de decisão humana: liberar, corrigir texto barrado, decidir destino, reenviar falha esgotada, dono de incidente.
- **Prontos:** Liberado, com hash igual ao revisado. Espera a janela ou o envio.
- **Enviado:** recibo confirmado. Sai da fila e vai para o histórico.
- **Falhou:** erro técnico, com motivo legível, próxima tentativa (`tentar_apos`) quando houver, e ação.
- **Pausado:** parado de propósito: cooldown, teto diário, fora da janela, disjuntor, canal ou cliente pausado.
- **Não elegível:** não deveria sair. Ex.: prospect, sem base, vazio, interno com urgente desligado, PDF sob demanda, dry-run. Mostra o motivo e não tem ação.

Regras de precedência:
- Falha que exige decisão humana vira Aguardando você, mesmo que estivesse em Processando.
- Reprovação do auditor vai para Aguardando você, não para Falhou. Falha técnica e decisão de conteúdo não se misturam.
- Se o texto mudar depois da liberação (hash diferente), o item volta para Redigido e a liberação antiga não vale.

### 1.3 Transições

| De → para | Condição | Quem move |
|---|---|---|
| Capturado → Redigido | Gatilho confirmado, texto gerado com hash | Sistema |
| Redigido → Auditado | Auditor aprova | Sistema |
| Redigido → Aguardando você | Auditor reprova ou texto vazio. Motivo e frase gravados | Líder edita e reaudita. Ninguém libera texto barrado |
| Auditado → Aguardando você | Cliente sem liberação (padrão) | Sistema |
| Aguardando você → Liberado | Liberação gravada com hash | Líder (cliente). Consultor (interno do próprio cliente). Sistema (interno e urgente, pela regra gravada) |
| Liberado → Prontos | Espera janela ou lote | Sistema |
| Prontos → Enviado | Janela automática, ou botão "Enviar prontos (N)" | Sistema ou líder |
| Enviado → Recibo | Recibo do n8n ou página criada | Sistema |
| Enviado → Falhou (sem recibo) | Sem recibo após o prazo do canal (proposta: 15 min) | Sistema |
| Falhou → Prontos | "Reenviar", em motivo retentável | Líder |
| Falhou → Aguardando você | Motivo exige decisão, ou 3 tentativas esgotadas, ou disjuntor | Sistema marca; líder decide |
| Qualquer → Pausado | Cooldown, teto, janela, disjuntor, pausa manual | Sistema. Líder pausa e retoma |
| Qualquer → Não elegível | Pré-condição falhou | Sistema |
| Entrada: resposta do cliente | Cria item em Aguardando você, faixa Time | Cliente gera. CS ou líder marca Revisado, Implementar ou Descartado |

### 1.4 De onde vem cada estado hoje (principais)

- `gatilho_lote`: montado vira Redigido ou Auditado. Pendente vira Prontos, ou Falhou se `n8n_nao_configurado`. Enviado (2xx sem recibo) vira Processando e depois Falhou (sem recibo). Entregue vira Enviado. Parcial e falhou viram Falhou.
- `gatilho_cliente`: pendente com cooldown, teto ou repetição vira Pausado. `conteudo:*` vira Aguardando você. `n8n_nao_configurado` e `entrega_falhou` viram Falhou. Agrupado vira Prontos se o plano estiver liberado, senão Aguardando você. Enviado vira Processando. Entregue vira Enviado. Suprimido vira Pausado ou Não elegível. Resolvido vai para o Histórico.
- `relatorio_envio`: enviado e adotado viram Enviado. Falhou vira Falhou. `bloqueado` com motivo `vazio` vira Não elegível (hoje gravado como bloqueado em `src/lib/relatorio-envio.js:486`). Outro bloqueado vira Aguardando você.
- `relatorio_programacao`: Aguardando liberação vira Aguardando você. Agendado vira Prontos. Pausado vira Pausado. Última tentativa falhou vira Falhou. Desligado vira Não elegível.
- `alerta_cliente`: pendente com `nao_liberado` ou `sem_confirmacao` vira Aguardando você. Pendente `fora_da_janela` vira Pausado. Enviado vira Enviado. Bloqueado vira Aguardando você. Falhou vira Falhou. Suprimido vira Não elegível. Resolvido vai para o Histórico.
- `consultor_aviso`: `sem_destino` vira Aguardando você. `n8n_nao_configurado`, `n8n_500` e `recibo_falhou` viram Falhou. Entregue vira Enviado.

Mudança de semântica: hoje `enviado` quer dizer aceite (2xx). Na nova esteira, Enviado quer dizer recibo. Se algum teste fixar o valor antigo, registrar no §8.7 do design system.

## 2. A tela

- **Nome:** Comunicação. Rota `/comunicacao`. API `GET /api/comunicacao/fila`. Projeção `src/lib/comunicacao-fila.js`. A projeção só lê as tabelas existentes e não envia nada, então não é um segundo motor.

Blocos, de cima para baixo:

1. **Barra de estado.** "Atualizando a cada 8 s · agora às HH:MM". O número vem da constante real do poller do sino (`src/web/alerta.js:7`, verificado). Se o David quiser 4 s, muda a constante, e o rótulo lê a mesma constante. Ao lado, os interruptores reais por canal.
2. **Contadores por estado,** em uma linha: Todos · Processando (ponto laranja) · Aguardando você · Falhou · Prontos. Enviado, Pausado e Não elegível ficam no Histórico, recolhido. A tela abre em **Aguardando você**.
3. **Um botão principal, com o número,** que muda conforme a aba:
   - Aguardando você: "Revisar N". Abre um item por vez.
   - Falhou: "Reenviar N", só para motivos retentáveis.
   - Prontos: "Enviar N prontos". Abre prévia com o conteúdo e pede confirmação.
   - Processando e Histórico: nenhum botão principal.
   - Secundário: "Processar lote". Roda só os estágios automáticos até Prontos. Nunca envia.
4. **Duas faixas separadas,** cada uma com seus contadores:
   - **Cliente:** WhatsApp, Notion do cliente, e-mail, portal e prestação de contas. Mostra só texto liberado ou em revisão. Nunca mostra motivo interno.
   - **Time:** consultor (Discord), sino da equipe, incidentes, Chaveiro e Neo (só aviso; a ação fica em Executar), feedback e dossiê interno. Cada linha diz de qual sistema vem: Morpheus, Merovíngio, Trinity, Chaveiro, Smith, Neo ou Vigia.
5. **Modos.**
   - **Lote** (tabela): Cliente · Mensagem · Estágio (6 pontos) · Estado · Espera desde · Próxima ação. Caixa de seleção. "Processar lote" age sobre a seleção ou o filtro.
   - **Assistida** (uma linha por item, expande ao clicar).
6. **Histórico** (recolhido): enviados com recibo, pausados, não elegíveis e resolvidos. Filtros por faixa e cliente, com paginação. Substitui o "últimos 20" de `src/lib/gatilhos.js:1059`.

Linha expandida (Assistida), exemplo:

```
Cliente X · WhatsApp · Notion                       2 prontos · 1 aguardando você
  Plano da semana (terça 09:00)
    ✓ Capturado 20/10 08:50   ✓ Redigido   ✓ Auditado (passou)   ✓ Liberado (Fulano)   ○ Enviado   ○ Recibo
    Falta: janela de envio (terça 09:00)
  Ponto importante (urgente)
    ✓ Capturado   ✓ Redigido   ! Auditado: barrado "ultra relevante"
    Falta: corrigir o texto e liberar de novo
  Relatório de Sprints (Notion)
    ✓ Capturado   ✓ Redigido   ✓ Auditado   ○ Liberado: aguardando o líder
    Falta: liberar a programação
                                         [ Tudo pronto — pode enviar (2) ]
```

- Cada estágio tem um "i" com quatro linhas: o que é, quem move, o que significa e o que falta.
- O botão "Tudo pronto — pode enviar" aparece por cliente, só quando todas as mensagens dele estão em Prontos. Caso contrário mostra "Falta: …".
- A prévia do texto ao cliente tem o selo do auditor: "passou" ou "barrado: <frase>".
- Se falhou: motivo, próxima tentativa e ação. Exemplo: "n8n respondeu 502 · nova tentativa às 14:40 · Reenviar agora".

## 3. Tabela de mensagens

Todas as comunicações dos mapas aparecem uma vez. "Hoje" traz onde a mensagem está agora.

| # | Mensagem | Faixa | Hoje | Estados possíveis | Quem libera | Onde fica (nova) |
|---|---|---|---|---|---|---|
| C1 | Plano da semana, terça, WhatsApp | Cliente | `gatilho_lote` (timer e cron n8n 09:05, `src/rotas-gatilhos.js:121`). 7 clientes e 19 linhas sem liberação | Aguardando você, Prontos, Processando, Enviado, Falhou (`n8n_nao_configurado`, sem recibo), Pausado (fora da janela), Não elegível (sem WhatsApp ou sem base) | Líder (`liberado_por`), em lote | Comunicação › Cliente |
| C2 | Ponto importante da conta (urgente): estoque, ruptura, reposição, preço. 5 tipos (`config/gatilhos.json:41-47`) | Cliente | Timer, pós-coleta, cron ou manual. 18 críticos "hora" esperam a terça com rótulo "Aguardando (urgente)" | Prontos (regra gravada), Aguardando você (motivo "espera a terça"), Pausado (cooldown, teto), Enviado, Falhou | Regra `regra:14-10` gravada, ou líder (decisão D1) | Comunicação › Cliente |
| C3 | Teste de canal ("teste do canal de avisos") | Cliente, marcado "teste" | Só toast. Não persiste; sem recibo | Processando, Enviado (com recibo), Falhou | Líder ou consultor | Comunicação › Cliente, filtro Teste. Não conta em Prontos |
| C4 | E-mail do plano e do urgente | Cliente | Recibo sempre falha (sem SMTP) | Não elegível (sem SMTP); depois igual a C1 | Líder | Estrutura › Canais |
| C5 | Página "Plano da semana" ou "Ponto importante" no Notion do cliente | Cliente | Lote de C1/C2 | Enviado, Recibo (página criada ou adotada), Aguardando você (`categoria_ausente`, `destino_compartilhado`, `titulo_invalido`), Falhou | Líder | Comunicação › Cliente |
| C6 | Micro-compras (script manual) | Cliente | Script fora da app: 13 lotes em 15/10 | Como C1, sem agendamento | Líder, ao rodar | Comunicação › Cliente, marcado "script" |
| C7 | Relatório de Sprints (página e PDF) | Cliente | `relatorio_envio` e `relatorio_programacao`. 37 enviados, 2 bloqueados por "vazio" | Aguardando você (liberação pendente), Prontos (agendado), Enviado, Falhou, Pausado, Não elegível (vazio, desligado) | Líder grava `ativado_por`. Liberação em lote só com prévia (D11) | Comunicação › Cliente. Configuração em Estrutura › Relatório |
| C8 | PDF semanal sob demanda (`/semanal`, `/plano.pdf`) | Cliente (download) | Sem envio automático | Não elegível (fora da fila) | Quem baixa | Botão na linha do plano |
| C9 | Alerta de pendência crítica (página) e "Concluído" ao resolver | Cliente | `alerta_cliente`: 15 pendentes, 6 resolvidos, 0 enviados | Aguardando você (`nao_liberado`, `sem_confirmacao`), Pausado (`fora_da_janela`), Enviado, Falhou, Não elegível (suprimido), Histórico (resolvido) | Líder, pela liberação do relatório, ou manual com prévia | Comunicação › Cliente; também na ficha do cliente |
| C10 | Texto de ações do portal Sprint 90 (`/c/`) | Cliente (o cliente busca) | Sem envio. Texto auditado | Não elegível para envio; mostrar "publicado no portal" | Lacuna: não há liberador (decisão 6) | Comunicação › Cliente, marcado "Portal (pull)" |
| C11 | Prestação de contas, versão cliente | Cliente | Manual, com prévia e confirmação. Mensal desligado | Redigido, Auditado, Aguardando você, Enviado (com confirmação), Falhou | Líder ou consultor | Comunicação › Cliente (decisão 5) |
| C12 | Plano B do relatório: tarefa "Tarefas – {Cliente}" no Notion | Cliente até confirmar visibilidade (decisão 4) | 35 casos de 39 envios | Enviado, Aguardando você (responsável com 0 ou 2+ usuários) | Sistema; responsável de relatórios | Comunicação › Cliente, "Plano B" |
| C13 | Respostas dos clientes ao relatório (entrada) | Time | `feedback_relatorio`: 18 novas, 8 revisadas | Aguardando você (novo), Processando (implementar), Histórico (revisado, descartado) | Líder, CS ou consultor | Comunicação › Time |
| C14 | Resumo semanal ao consultor (Discord, terça 08:30, 3 cargos + consultor) | Time | `consultor_aviso`: 36 entregues em 20/10 | Processando, Aguardando você (`sem_destino`), Falhou (`n8n_500`, `recibo_falhou`), Enviado | Sistema. Consultor corrige destino. Envio manual com contagem (F8) | Comunicação › Time |
| C15 | Resumo de terça manual (`scripts/resumo-time-discord.mjs`) | Time | Terminal. Segundo compositor para o mesmo canal | Não elegível até unificar com C14 | Ninguém | Some na F8 |
| C16 | Urgente interno ao consultor (queda, fim de promoção, Ads sem retorno) | Time | `interno_imediato`: 0 linhas. Desligado | Não elegível (`urgente_ligado=false`) | David (decisão de ligar) | Comunicação › Time, com faixa "desligado" |
| C17 | Dossiê mensal de risco (#growth) | Time | `dossie_mensal`: 0 linhas. Chave desligada | Aguardando você (gerado sem liberação), Prontos, Enviado, Falhou (até 3 tentativas), Não elegível | Líder ou CS | Comunicação › Time |
| C18 | Incidente crítico ao Head de canais, WhatsApp | Time | Gate `whatsapp_critico_ligado=false` | Não elegível (desligado). Ligado: Processando, Enviado, Falhou | Sistema; líder liga | Comunicação › Time |
| C19 | Vigia externo: "CRITICO" e "normalizado" | Time | Arquivo `data/vigia.log`. Dry-run (`VIGIA_ENVIO_LIGADO≠1`) | Não elegível (dry-run). Depois de persistir: Enviado, Falhou | Sistema | Comunicação › Time, depois de gravar em tabela |
| C20 | Incidentes do sistema (sino) | Time | `incidente`: 1 aberto, 38 resolvidos. Resolvido não avisa | Processando (atenção), Aguardando você (crítico sem dono), Histórico | Dono resolve. Sistema fecha após 2 leituras | Comunicação › Time |
| C21 | "Só para a equipe" (Ads sem retorno, queda, promoção, origem não verificada) | Time | Sino (82 info, 11 alerta) e `/gatilhos`. 29 + 13 linhas internas | Aguardando você até "feito" ou a condição sumir | Consultor ou líder marca "feito" | Comunicação › Time |
| C22 | Gatilho do cliente falhou (lote falhou, parcial, plano não saiu) | Cliente e Time | Só no sino (`src/lib/gatilhos.js:880, :896, :1026`). Texto "Motivo registrado no log" | Falhou (aponta para C1, C2 ou C7). Aguardando você quando esgotado | Líder | Comunicação › Cliente, com alerta no Time |
| C23 | Pendência crítica interna: `alerta_estoque`, `alerta_pendencia`, `alerta_dependencia`, `alerta_acesso` | Time | Sino (53 erros de `alerta_estoque` sem agrupar) e `/planos` | Aguardando você (agrupado por cliente), Histórico (resolvido) | Líder | Comunicação › Time |
| C24 | Relatório ao Notion: falha, lote, disjuntor | Time | Sino e Hoje | Falhou, Pausado (disjuntor). Liga a C7 | Líder | Comunicação › Time |
| C25 | Chaveiro e Neo: ordens de estoque, aprovação, divergência, veto, parada de emergência | Time | `exec_ordem`: 0 linhas | Aguardando você (aprovar, veto), Processando, Enviado (executada), Falhou (divergente, falhou), Pausado (emergência), Não elegível (cancelada, obsoleta) | Dono. A ação continua em Executar | Comunicação › Time, só para aviso |
| C26 | Conexão e coleta do Mercado Livre | Time | Sino e Hoje. Não fecha quando a conexão volta | Aguardando você (conexão caída, credencial recusada, conta trocada), Falhou (coleta), Histórico (conectado, dados prontos) | Líder reconecta | Comunicação › Time |
| C27 | Sprint 90 interno (duplicado, exclusão pendente, abortada, expurgo falhou) | Time | `s90`: 0 linhas hoje | Aguardando você (duplicado, exclusão pendente), Falhou (expurgo), Histórico (abortada) | Consultor ou líder | Comunicação › Time |

## 4. Regras que impedem confusão com o cliente

- **D1. Nada sai ao cliente sem liberação registrada.** A liberação é `liberado_por` (pessoa) ou `regra:<id>` (regra gravada, com versão). Há um conflito a decidir: a regra de urgente automático de 14/10 (`config/gatilhos.json`) contraria a liberação explícita. Proposta: manter, visível como "Liberado por regra".
- **D2. "Preparar" nunca envia.** Processar lote para em Prontos. Enviar é endpoint e botão separados, com a contagem no rótulo e prévia com hash.
- **D3. Enviado só com recibo.** Sem recibo dentro da janela (proposta: 15 min), vira Falhou "sem recibo do n8n". Nunca aparece como verde.
- **D4. Falha tem motivo legível, próxima ação e `tentar_apos`.** Códigos crus (`n8n_<status>`, `erro_interno`, `entrega_falhou`) ganham texto em um dicionário. Um teste automatizado falha se algum código não tiver texto. Sai a frase "Motivo registrado no log do servidor".
- **D5. Cliente nunca vê a faixa Time.** O filtro é no servidor. A rota do cliente não devolve campos internos (`interno`, motivos `assessoria` e `origem_nao_verificada`). Interno nunca entra em lote ao cliente (`src/lib/gatilhos.js:49, :322`). Teste de contrato obrigatório. A função `publico()` não foi lida pelos mapas: verificar se ela esconde `itens_json` e `motivo`.
- **D6. Texto ao cliente passa pelo auditor, inclusive frase fixa.** Hoje a frase de abertura do plano (`src/lib/plano-semana-texto.js:19`) escapa do auditor (`:9-12`, `:44-50`). Texto barrado vai para Aguardando você, com a frase em destaque, e não sai sem edição.
- **D7. Ausente é "—", nunca zero.** Trocar `?? 0` e `|| 0` nos contadores de `alertas.js:93`, `relatorio.js:372`, `gatilhos.js:187` e `relatorio.js:401` (telas).
- **D8. Desligado é mostrado, não silenciado.** Cada canal mostra o estado real do interruptor.
- **D9. Um fato, um item.** Dedupe por (tipo, cliente, período). Não duplica relatório nem alerta.
- **D10. Espera tem motivo gravado.** Todo Pendente ou Aguardando você grava o motivo. Hoje `src/lib/gatilhos.js:1004` descarta.
- **D11. Liberação em lote mostra o conteúdo.** O "sem nova confirmação" (`src/web/relatorio.js:393-396`) vira prévia obrigatória.
- **D12. Quem fala se identifica.** Mensagem interna traz o sistema de origem. Mensagem ao cliente cita só a assinatura Merovíngio. Se "Place Sprints" no texto ao cliente é marca ou sistema interno, é decisão 7.
- **D13. Interruptor divergente bloqueia.** Se config e banco divergirem, a tela mostra "conflito" e não envia pelo canal afetado.
- **D14. O webhook recusa payload interno.** O caminho `place-gatilhos` (`src/lib/gatilhos-envio.js:101-121`) serve cliente e interno. Hoje a separação depende só do n8n ler `interno: true`. Recusar qualquer payload interno antes do envio, com teste.
- **D15. Prospect nunca entra na fila.** Toda linha tem `cliente_id`. Contadores de um cliente nunca somam outro.
- **D16. Bloqueado não parece agendado.** Programação com última tentativa bloqueada vira Pausado, não Agendado (`src/lib/relatorio-envio.js:340`). "Vazio" não é "barrado pelo auditor" (`src/web/fila.js:87`).
- **D17. Teste de canal é rastreável.** Vira lote de origem `teste`, aparece marcado e precisa de recibo.

## 5. Menu e explicação

- **Recomendado: Execução › Comunicação.** Motivo: é fila de trabalho diário, igual a Executar. A configuração (canais, interruptores, janela) fica em Estrutura, com link para a fila.
- **Não verificado:** a árvore final dos 5 menus, porque a build ainda está em andamento. Confirmar os nomes quando ela fechar.
- **Estágio com "i":** o que é, quem move, o que significa, o que falta. Ex.: "Auditado: passou pelas regras de promessa. Falta: liberação."

## 6. Fases

Regras gerais:
- Cada fase publica com a suíte verde. O comando de teste precisa ser confirmado em `package.json`.
- Testes que fixam o comportamento atual e mudam entram no §8.7 de `docs/ux/sistema-de-design.md`.
- Enquanto a build dos 5 menus estiver rodando, não tocar em `src/web/shell.js`, `src/web/index.html` nem nas telas.

Fases:

- **P0. Decisões, sem código.** Confirmar os interruptores (seção 0), `na_hora_ligado`, D1 e as decisões da seção 9.
- **F1. Leitura.** `src/lib/comunicacao-fila.js` e `GET /api/comunicacao/fila` (em `src/rotas-comunicacao.js`, montado em `src/server.js`). Implementa o mapeamento da seção 1.4, com testes unitários. Sem tela e sem escrita.
- **F2. Motivo e tentativa.** Colunas novas, com migração idempotente em `src/db.js`:
  - `motivo_espera` em `gatilho_cliente` (`src/lib/gatilhos-schema.js:13`; `gatilhos.js:1004` passa a gravar);
  - `auditado_em` e `liberado_em` em `gatilho_lote`;
  - `proxima_tentativa` em `consultor_aviso` (o `tentar_apos`).
  Trocar `?? 0` e `|| 0` por "—" (D7).
- **F3. Tela somente leitura** (depois da build). `src/web/comunicacao.js` e a página. Contadores, faixas, modo Lote e modo Assistida, sem botão de envio. Teste de contrato da faixa Cliente (D5). Só nesta fase o menu recebe a entrada.
- **F4. Ações unitárias.** Liberar, Reenviar, Pausar e Retomar, Marcar feito. Reutilizam as rotas existentes (`src/rotas-gatilhos.js`, `src/rotas-relatorio.js`, `src/rotas-alertas.js`). Nenhum emissor novo. Atenção: hoje não há pausa por cliente em gatilhos (mapa 3). Antes desta fase, decidir se Pausado vem só de disjuntor e cooldown.
- **F5. Lote separado.** "Processar lote" e "Enviar prontos (N)" separados, com confirmação e prévia (D2, D11). Usa o `enviarLote` que já existe. Registrar no §8.7.
- **F6. Recibo honesto.** Enviado sem recibo vira Falhou (D3). Teste de canal persistido (D17). `vazio` vira Não elegível (`src/lib/relatorio-envio.js:486`). Alinhar `gatilho_lote.origem` (hoje grava `timer`, `coleta`, `manual`; o schema diz `automatico`, `manual`, `n8n-cron`). Registrar no §8.7.
- **F7. Absorver os avisos espalhados,** nesta ordem. Cada passo remove o aviso antigo quando estiver coberto:
  1. Falhas de envio ao cliente (C22). O sino passa a apontar para o item.
  2. Texto barrado pelo auditor (hoje em Hoje, `src/lib/fila.js:88`).
  3. Pendência crítica `nao_liberado` e `sem_confirmacao` (C9, C23).
  4. Plano de terça sem liberação: 7 clientes, 19 linhas (C1, C2).
  5. Falhas de `consultor_aviso` que Hoje não cobre (`src/lib/fila.js:190-216`).
  6. Relatório falhou e disjuntor (C7, C24).
  7. Respostas novas dos clientes (C13).
  8. "Só para a equipe" (C21). O sino mantém o aviso; o item vai para Time, com dono.
  9. Incidente e Mercado Livre fecham quando resolvidos (C20, C26).
  10. Dossiê falhou e Sprint 90 (C17, C27).
  11. Vigia (C19), só depois de gravar em tabela.

  Som: o sino toca só para erro e para Aguardando você. Hoje toca em tudo (`src/web/alerta.js:127-129`).
- **F8. Discord único e histórico.** Unificar `scripts/resumo-time-discord.mjs` com `src/lib/consultor-discord.js`, com dedupe por (cliente, semana ISO). Botão "Enviar resumo ao consultor (N)" com contagem. Histórico com filtros, substituindo o "últimos 20". Depois de uma semana com a fila em produção, remover o aviso duplicado do sino.
- **F9. Canais e transporte.** E-mail como Não elegível enquanto não houver SMTP. Frase fixa passa pelo auditor (D6), depois da decisão 7. Script de micro-compras entra na fila (C6).

## 7. Mudanças de semântica e registro

- `enviado` deixa de ser "chegou". Enviado passa a exigir recibo (ver seção 1.4).
- Relatório `bloqueado` com motivo `vazio` passa a Não elegível.
- Plano B: 35 de 39 envios de relatório viraram tarefa no Notion. Não se sabe se o quadro é visível ao cliente (decisão 4).

## 8. Verificação e ressalvas

Correções aplicadas em relação aos rascunhos:
- A "divergência 6" do mapa 1 (`#alertasCliente` inexistente) é falsa. O id existe em `src/web/cliente.js:406` e é preenchido em `cliente.js:596`. Retirada.
- O intervalo do sino é 8 s (`src/web/alerta.js:7`), não 4 s.
- Um rascunho dizia que o auditor bloqueia "ultra relevantes" e similares. A frase é fixa e escapa do auditor (D6). Isso precisa ser corrigido no código, não só lido.
- Horário: a memória diz terça 09:00. O cron é 09:05 (`src/rotas-gatilhos.js:121`). A janela do timer é 09:00 a 20:00, no fuso do cliente.
- O nome `place-gatilhos-resumo-8h.json` diz 8h, mas o nó é terça 09:05.
- A regra de linha de configuração: `config/alerta-cliente.json` (automatico_ligado, linha 14 pelo mapa 1). Confirmar a linha exata antes de editar.

Não verificado:
- Função `publico()` e se esconde campos internos.
- Texto real do Discord (se traz o nome do sistema).
- Se o botão de alerta bloqueia `nao_liberado`.
- Visibilidade do quadro "Tarefas – {Cliente}".
- Árvore final dos menus.
- Números: vêm dos mapas de 21/10/2026, não foram recalculados.

Processo: um dos mapas admitiu ter feito grep em `.env` para checar nomes de variáveis. Isso fere a regra de não ler `.env`. Nenhum valor foi usado nesta proposta. Fica registrado.

---

## 9. Decisões que só o David toma

1. **Interruptores.** Quais valem de verdade: banco "ligado" ou configuração "desligada". Sem isso, nada avança.
2. **Urgente automático pela regra de 14/10 (D1).** Manter com regra visível, ou exigir liberação humana?
3. **`na_hora_ligado` = true** (`config/gatilhos.json:40`), contra o briefing que diz desligado. E o "ritmo de hora" contra o timer de 10 min com um lote por dia.
4. **Quadro "Tarefas – {Cliente}".** É visível ao cliente? Isso define C12.
5. **Prestação de contas (C11).** Fica na faixa Cliente?
6. **Portal Sprint 90 (C10).** Quem libera o texto? Hoje não há liberador.
7. **Texto ao cliente.** As frases "ultra relevantes", "protegem o seu faturamento" e "abrem espaço para vender mais" saem, ou o auditor passa a checar frase fixa (D6)? E "Place Sprints" no texto ao cliente: marca ou sistema interno (D12)?
8. **Prazo sem recibo.** 15 minutos (proposta) está bom?
9. **Atualização da tela.** 8 s (constante atual) ou 4 s?
10. **Menu.** Execução › Comunicação (proposta)?
11. **E-mail sem SMTP.** Esconder até haver SMTP?

## 10. Fase 0 recomendada

Fase 0 é P0 mais uma verificação só de leitura, sem código:

1. O David responde as decisões de 1 a 11, começando pela 1.
2. Confirmar os quatro interruptores e `na_hora_ligado` com consulta somente leitura e agregada (`sqlite3 -readonly`), sem copiar o banco.
3. Só então a F1 (leitura: projeção e endpoint, sem tela e sem envio).
4. Depois, F2 e F3, quando a build dos 5 menus fechar.