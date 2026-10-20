# Place Sprint 90 — guia de operação

Versão autoatendimento do Place Sprints: o lojista paga na landing, conecta a conta do Mercado Livre e usa um painel próprio (`/c/`) por 90 dias e enquanto a assinatura durar. O sistema diagnostica, escolhe até 5 prioridades por semana, prepara ficha/descrição/preço (e imagens, quando ativas) para o **cliente aprovar campo a campo**, aplica o aprovado, confere e mede. O resto ele recomenda com botão "fiz". Nada de segundo motor: tudo passa pelo Algoritmo e pelo Merovíngio (`CLAUDE.md`).

## Onde está cada coisa

| O quê | Arquivo |
|---|---|
| Desenho completo (24 decisões, modelo de dados, rotas, testes, fases) | `docs/desenho-place-sprint-90.md` |
| Números (preços em centavos, D+30, carência, pausa, retenção…) | `config/sprint90.json` — fonte única; texto nenhum inventa número |
| Termos de uso + contrato de adesão + aviso de privacidade (`s90-v1`, RASCUNHO) | `config/termos-sprint90.md` |
| Landing pública (servida em `GET /` do host S90 a partir da F1) | `assets/sprint90/landing.html` (o original fica em `~/Desktop/Place Sprint 90.html`, não editar) |
| LaunchAgent do servidor (pré-condição da F3) | `automacao/com.place2u.place-sprints.servidor.plist` |
| Passo a passo do túnel/DNS | `automacao/cloudflared-sprint90.md` |
| Testes do texto | `scripts/teste-s90-landing.mjs` (F0); os da F1 em diante seguem o desenho § 7 |

Host público: `sprint90.place2u.com.br` (env `SPRINT90_PUBLIC_HOST`). Sem a env, nada do Sprint 90 existe para o túnel.

## Decisões

**Desenho aprovado em 08/10/2026** (painel de 3 desenhos + 2 juízes): `docs/desenho-place-sprint-90.md`.

**Decisões do David em 08/10/2026** (valem sobre o desenho onde há diferença):

| Tema | Decisão |
|---|---|
| Preço | Plano Fixo R$ 997/mês **ou** Plano Crescimento R$ 454/mês + 10% do faturamento aprovado. Qualquer lojista pode contratar (nada de "feito para quem fatura até R$ X"). |
| Meios de pagamento | Mensalidade só no cartão, por assinatura do Mercado Pago. Comissão em cobrança avulsa mensal (cartão, boleto ou Pix) com extrato pedido a pedido. |
| Comissão | **Lida em D+30**: a competência de um mês (pedidos pagos criados no mês) é lida 30 dias depois do fim do mês, descontando cancelados, reembolsados e contestados até a leitura. Substitui o "D+3" do desenho (D13). |
| Nota fiscal | Emitida **manualmente** pela Place2u em até 5 dias úteis após o pagamento. |
| Inadimplência | Aviso no painel desde o 1º dia de atraso; após 5 dias de carência a conta fica inadimplente (bloqueia novas aprovações); **após 30 dias de atraso a assinatura é pausada automaticamente**. Cancelar é sempre decisão humana. Chargeback e conexão caída nunca pausam sozinhos. Substitui "nenhuma pausa automática" do desenho (D14). |
| Arrependimento | 7 dias (CDC art. 49) com estorno integral. |
| Acesso | Link de acesso entregue na página de retorno do pagamento; sem e-mail (canal "só no painel"); perdeu o link → fala com a Place2u, a equipe gera outro. |
| v1 honesta | Executa o que tem executor (diagnóstico, 5 prioridades, ficha/descrição/preço preparados e aprovados campo a campo, imagens com IA quando ativo, conferência). Recomenda o resto (Ads, estoque, promoções, campanhas) com "fiz" para medir. Duplicação e anúncio novo fora. Publicação no ML só depois do piloto (F5). Nenhuma promessa de vendas, ranking ou resultado. |
| Hospedagem | Túnel Cloudflare deste Mac. O David faz DNS, ingress e LaunchAgent; o código só prepara arquivos e passo a passo. |

## Fases e critérios

Cada fase só fecha com a suíte inteira verde (`for f in scripts/teste-*.mjs; do node "$f" >/dev/null 2>&1 || echo FALHOU $f; done`).

| Fase | Entrega | Pronto quando | Depende de fora |
|---|---|---|---|
| **F0 Texto e config** | `config/sprint90.json`, landing honesta em `assets/sprint90/`, termos `s90-v1` (rascunho), este guia, metodologia (quem decide), LaunchAgent e passo a passo do túnel preparados | `teste-s90-landing` verde; nenhuma rota tocada | nada |
| **F1 Identidade, guarda, painel de leitura** | chave `[S90]`, sessão e link de uso único, guarda por host exato, painel de leitura (Resumo, Prioridades, Conta), rotas internas de contas/acesso/estado, exclusão LGPD | testes 1–4 do desenho verdes; conta criada pela equipe conecta o ML e vê o painel | `SPRINT90_PUBLIC_HOST` no `.env` + ingress (David) |
| **F2 Decisões e execução** | aprovar/descartar/vou fazer/fiz; execução campo a campo até `aprovado_publicar` com prévia; custos/regra/catálogo declarados; conferência agendada; relatório semanal em snapshot | testes 3 e 5 verdes; cliente marca "fiz" e é medido; job chega a `aprovado_publicar` | `FAL_KEY` (opcional; sem ela, "indisponível nesta conta") |
| **F3 Pagamento (modo teste)** | Mercado Pago (assinatura, webhook com HMAC, retorno com link de acesso), cancelamento, arrependimento com estorno, chargeback, inadimplência com pausa aos 30 dias, landing com a etapa 4 ligada a `/c/assinar` | teste 6 verde; ponta a ponta com cartão de teste: assinatura autorizada → webhook real → conta ativa → retorno com link → arrependimento com estorno confirmado por leitura | `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` de teste, webhook no painel do MP para `https://sprint90.place2u.com.br/webhook/mp`, **LaunchAgent do servidor instalado** |
| **F4 Comissão** | leitura D+30 com bissecção acima de 1000 pedidos, exclusões, extrato pedido a pedido, contestação, revisão, fechamento no cancelamento | teste 7 verde; 1 competência real do piloto confere com "Métricas → Negócio" do ML, diferença explicada pedido a pedido | conta real com ≥ 1 mês de pedidos; confirmação na doc do ML dos campos de reembolso e de frete |
| **F5 Publicação real** | `publicacao_live=true` e landing com "conferência automática por leitura 30 minutos depois" | critério do "go" abaixo | 1ª publicação real supervisionada |

### Critério objetivo do "go" da F5

Todos verdadeiros, conferidos no banco e no ML:

1. Suíte inteira verde.
2. 1 job real `escopo:'ficha'` em anúncio de baixo risco (≤ 1% do GMV do piloto) publicado pela equipe via `POST /api/ofertas/jobs/:id/publicar {live:true, confirmar:true}`.
3. `conferir` conclusivo com 0 divergências e `of_publicacao.estado='verificada'`.
4. Reversão (nova versão com o valor anterior) publicada e conferida da mesma forma.
5. Nenhum `of_evento` com `credencial_expirada`, `sem_permissao` ou `validacao_rejeitada` nesse ciclo.
6. O David registra o "go" com data na linha abaixo. Só então `publicacao_live` vira `true` em `config/sprint90.json`.

> Go da F5: _pendente_ (data, job, anúncio, quem conferiu)

## Estados e régua (de `config/sprint90.json`)

- Conta: `pendente_pagamento → ativo → {inadimplente, pausado} → cancelado → excluido` (+ `excluir_pendente` quando o MP não responde na exclusão).
- Atraso contado do vencimento. Dia 1: aviso no painel. Depois de 5 dias (`fatura.carencia_dias`): `inadimplente` — bloqueia novas aprovações e execuções; leitura continua. Dia 30 (`inadimplencia.pausar_assinatura_apos_dias`): pausa automática da assinatura no MP. `cancelar_automatico=false`, `chargeback_pausa_automatica=false`, `conexao_caida_pausa_automatica=false`.
- Comissão: competência M lida em `fim de M + 30 dias` às 06:30; fatura no mesmo dia, vencimento 7 dias; base = pedidos `paid` criados em M (a partir de `inicio_em`), menos `refunded`, `charged_back`, `in_mediation` e cancelados até a leitura; na dúvida exclui; leitura incompleta → `bloqueada_dados`, nunca cobrança parcial.
- NF: manual, até 5 dias úteis após cada pagamento confirmado.
- Arrependimento: 7 dias do primeiro pagamento aprovado; estorno de cada pagamento, marcado só quando o MP confirmar; falha → `estorno_pendente` com prazo de 2 dias úteis visível no extrato.

## O que a equipe faz

Todas as rotas internas são `/api/sprint90/*`, só por loopback (o túnel recusa). Contrato final em `src/rotas-sprint90.js` (F1 em diante); os nomes abaixo são os do desenho.

| Tarefa | Como |
|---|---|
| Ver assinantes | bloco "Assinantes Sprint 90" em Integrações, ou `GET /api/sprint90/contas` |
| Criar conta (piloto, sem Mercado Pago) | cadastro pela rota interna da F1 e `POST /api/sprint90/contas/:id/estado {estado:'ativo', por, motivo:'piloto sem MP'}` |
| Gerar link de acesso | `POST /api/sprint90/contas/:id/acesso {por}` → a URL aparece **uma vez**, vale 15 min e é de uso único. Entregue por canal direto ao titular; nunca em grupo, print ou planilha. |
| Recuperar acesso (cliente perdeu o link) | confirmar que quem pede é o titular [A DEFINIR: procedimento — ex.: WhatsApp do cadastro + nome da loja + últimos dígitos do pagamento] → gerar link como acima |
| Pausar / retomar | `POST /api/sprint90/contas/:id/estado {estado:'pausado' ou 'ativo', por, motivo}` (a pausa aos 30 dias de atraso é automática; retomar depois da quitação é aqui) |
| Cancelar | o cliente cancela pelo painel; pela equipe, só por decisão registrada (inadimplência após a pausa, fraude, violação dos termos), com aviso no painel. Nunca automático. |
| Chargeback | analisar e decidir; enquanto aberto, pode suspender novas aprovações. Nada pausa sozinho. |
| Conexão do ML caída | o cliente reconecta pelo botão do painel; a cobrança não para sozinha (decisão humana). |
| Estorno que falhou | concluir em até 2 dias úteis e registrar em `POST /api/sprint90/contas/:id/estorno-feito {por}` (F3) |
| Revisar fatura / contestação | `POST /api/sprint90/faturas/:id/revisar {por, valor_centavos?, estado, nota}` (F4) |
| Nota fiscal | emitir em até 5 dias úteis após cada pagamento confirmado [A DEFINIR: onde registrar o número da NF e como entregá-la ao cliente] |

## Contratos que mudam de propósito (desenho § 7)

- `tarefas.fonte='s90'`: linha sintética do "fiz"/"vou fazer" do cliente, não é base do Notion; fica fora de KPIs do time (`metricas.js`, `placeplan.js`, `/api/estado`).
- `acoes_plano.status='distribuida'` também significa "o cliente marcou como feito".
- `of_*` aceita `por='cliente'`; `perfil_cliente.catalogo_proprio` com `por='cliente'` é declaração do cliente.
- Conferência deixa de ser só manual em modo `publicar_apos_aprovacao` (tick de 10 min, 30 min após publicar).
- `meli_contas_arquivo`, backup e restauração de conexões excluem chaves `[S90]`.

## Checklist do David

- [ ] Revisão jurídica de `config/termos-sprint90.md` e preenchimento dos [A DEFINIR] (razão social, CNPJ, endereço, Encarregado, foro, canal de atendimento) e [A CONFIRMAR].
- [ ] Decidir as regras ainda abertas nos termos: o que acontece depois do dia 90; troca de plano; reajuste após os 12 meses da turma fundadora; multa/juros de mora; prazos de contestação; mensalidade já paga no cancelamento; coleta de CPF/CNPJ e endereço para a NF e como a NF chega ao cliente; procedimento de confirmação de identidade na recuperação de acesso.
- [ ] Depois da revisão: trocar o cabeçalho "RASCUNHO" e gerar o PDF estático `assets/sprint90/termos-s90-v1.pdf` (servido por arquivo, nunca gerado em rota pública).
- [x] DNS + ingress do `sprint90.place2u.com.br` feitos em 08/10/2026 (registro de túnel no painel da Cloudflare + regra no `~/.cloudflared/config.yml`, túnel reiniciado); `SPRINT90_PUBLIC_HOST` entra no `.env` na publicação da F1.
- [ ] Instalar o LaunchAgent do servidor no lugar do `nohup` (comentário no topo do plist) — pré-condição da F3.
- [ ] F3: credenciais de **teste** do Mercado Pago no `.env` e webhook no painel do MP.
- [ ] F2 (opcional): `FAL_KEY` para imagens.
- [ ] F4: confirmar na documentação do ML os campos de reembolso/contestação e se o total do pedido inclui frete.
- [ ] F5: registrar o "go" com data neste guia.
