# Estado do Place Sprints — 22/10/2026

Números conferidos no banco (somente leitura) e na tela Estrutura (`/estrutura`, que lê o estado real de cada chave). Atualize esta página quando ligar algo.

## Resumo

- **Funciona e está em uso real:** coleta do Mercado Livre (49 contas, 0 com erro), leitura do Notion (15.907 tarefas), plano por cliente, plano de terça no WhatsApp (110 lotes entregues), relatório ao Notion do cliente (37 enviados), resumo de terça no Discord (36 entregues), alertas, backup cifrado, arquivamento no Drive, funil comercial público, GitHub com commit diário.
- **Construído mas desligado de propósito:** executor do Chaveiro, ajuste automático de estoque, diagnóstico por produto, lucro nas regras, nota fiscal, ciclos no plano de terça, publicação real do Sprint 90, execução real de promoções, vigia avisando.
- **Não funciona ainda:** tudo que depende de credencial que não existe (IA, Mercado Pago, ERP, provedor fiscal), canais sem API (Shopee, Amazon, TikTok), medição de resultado (0 medidas gravadas) e ROI por produto (mensalidade não está no sistema).

## 1. O que funciona hoje

| Peça | Prova |
|---|---|
| Coleta do Mercado Livre (Trinity) | última coleta 22/10 02:36 · 49 contas conectadas, 0 com erro |
| Leitura do Notion | 15.907 tarefas ativas sincronizadas |
| Plano por cliente (Arquiteto) | 2.077 ações propostas · 66 aprovadas · 30 distribuídas no Notion |
| Plano de terça no WhatsApp (Morpheus) | 110 lotes entregues, 0 falhas |
| Relatório curto ao Notion do cliente | 37 enviados · 2 bloqueados pelo auditor/destino (corretamente) |
| Resumo de terça ao consultor no Discord | 36 entregues |
| Urgente de estoque e preço com R$ | ligado desde 14/10 |
| Alerta de pendência crítica | ligado |
| Funil comercial público (diagnosticomeli) | 6 prospectos · relatório parcial com timer e WhatsApp |
| Backup cifrado diário (02:30) | ligado; arquivos em Drive |
| Arquivamento frio no Drive | ligado (launchd a cada 15 min) |
| GitHub | `davidvallejr/placesprints`, commit + push automático 23:30 |
| Os 5 menus (Assessoria · Consultor · Execução · Empresa do cliente · Estrutura) | no ar desde 22/10 |
| Tela **Hoje** (`/fila`) | fila do dia por papel, 4 números fixos |
| Tela **Estrutura** (`/estrutura`) | estado real de 31 estruturas, botão só onde funciona |
| Progresso em 10 etapas | no cliente, no Painel e em Estrutura |
| Ícone (i) «Como fazer» | 34 verbetes com passo a passo |
| Produto Performance × Prime | Performance 115 clientes (29 conectados) · Prime 55 (12) · sem produto 4 |

## 2. Construído, mas desligado (decisão: só liga com você)

| Estrutura | Onde liga | O que falta para ligar |
|---|---|---|
| Executor do Chaveiro (escrever no ML) | `config/chaveiro.json → execucao_ligada` | escolher a estreia (pausar 1 anúncio pequeno) |
| Operações liberadas no ML | `config/chaveiro.json → adaptadores_live.*` | ligar uma por vez, depois da estreia |
| Ajuste automático de estoque | `config/chaveiro.json → sync_estoque_ligado` | ligar antes o diagnóstico por produto |
| Diagnóstico por produto | `config/algoritmo.json → produto.diagnostico_ligado` | limpar o mapeamento produto↔anúncio (01Smart: 85 sem mapa, 31 conflitos) |
| Lucro por pedido nas regras | `config/algoritmo.json → financeiro.margem_medida_nas_regras` | custos informados ≥ 80% da receita |
| Emissão de nota fiscal | `config/nota-fiscal.json → nf.ligado` | CNPJ do intermediador, conta no provedor fiscal, regras do contador, certificado A1 |
| Ciclos no plano de terça | `config/algoritmo.json → relatorios_ciclo.blocos_terca_ligado` | decisão de texto |
| Publicação real no Sprint 90 | `config/sprint90.json → publicacao_live` | 1 job real conferido pela equipe |
| Promoções: execução real | banco | estreia supervisionada |
| Vigia avisa no WhatsApp | `.env → VIGIA_ENVIO_LIGADO=1` + `HEAD_CANAIS_WHATSAPP` | número do Head de canais |
| Prestação de contas mensal | banco (pronto) | ligar na tela |

## 3. O que não funciona ou está pendente

| Item | Motivo | Como resolver |
|---|---|---|
| IA que redige o diagnóstico | `ANTHROPIC_API_KEY` ausente | sem ela o texto sai por modelo fixo (honesto) |
| Sprint 90 (cobrança) | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` ausentes | conta Mercado Pago |
| Custos por ERP/planilha | `WEBHOOK_SECRET` ausente; Bling/Tiny sem OAuth | piloto com 1 cliente |
| Nota fiscal | provedor fiscal sem conta | ver § 2 |
| Imagens com IA | `FAL_KEY` ausente | contratar fal.ai |
| Perguntas e Faturamento do ML | escopos marcados no app em 21/10; **falta reautorizar cada cliente** (União Dog ainda no token de 05/10) | reconectar a conta em Estrutura › Conexões |
| Medição de resultado (Merovíngio) | 0 medidas gravadas: poucas ações distribuídas e concluídas há mais de 17 dias | distribuir as 66 aprovadas; a medição nasce sozinha |
| ROI por produto | mensalidade por cliente não está no sistema (`contrato_cliente` vazio) | importar a planilha do CS |
| Produto não mapeado | 4 clientes: «Assessoria antiga», «Implantação», «Marketplace 10X», «Não informado» | você diz Performance ou Prime |
| Shopee, Amazon, TikTok | sem API: só tarefas do Notion | — |
| Ads (escrita) e estoque antigo do Full | endpoints do ML nunca verificados | teste supervisionado |
| Agenda e transcrições do Prime | sem porta no servidor | desenho pronto (`docs/desenho-place-prime.md`) |
| Comunicação em esteira | só desenho (`docs/desenho-comunicacao-esteira.md`); 11 decisões suas | responder as decisões |
| Abas do cliente reagrupadas (F6) | exige reescrever testes presos | sua autorização |

## 4. «UpSeller turbinado» — o que um seller precisa

| Necessidade | Place Sprints | UpSeller tem? |
|---|---|---|
| Anúncio ≠ produto, vários anúncios no mesmo estoque | construído (desligado até o mapeamento) | sim |
| Estoque contado uma vez, sync entre anúncios | construído (desligado) | sim |
| Financeiro / DRE por pedido | construído (precisa de custos) | sim |
| Nota fiscal | construído (desligado, falta provedor) | sim |
| Compras: quando e quanto pedir | **funciona** (micro-compras ao cliente) | parcial |
| Duplicação sem canibalizar | construído | sim |
| Promoções | leitura funciona; execução desligada | sim |
| Ads | leitura funciona; escrita não verificada | parcial |
| Perguntas e reputação | reputação funciona; perguntas esperam reautorização | sim |
| Relatórios de ciclo (8) | **funciona** (só leitura) | parcial |
| Alertas com impacto em R$ | **funciona** | não |
| Plano de ação priorizado por R$ | **funciona** | não |
| Medição de resultado com controle (Merovíngio) | construído, 0 medidas ainda | não |
| Fila do dia do especialista | **funciona** | não |
| Consultoria (Prime): trilhas, encontros, portal | desenhado | não |

O que só o Place Sprints faz: decide o que fazer (plano por R$), mede se funcionou (antes × depois com controle) e separa assessoria de consultoria.

## 5. O que ainda é fase futura

- **F6** reagrupar as abas do cliente (Resumo de 12 para 6 blocos, aba Empresa).
- **F7** mudanças de casa fora do cliente.
- **Comunicação em esteira** (F1–F9 do desenho).
- **Jornada Prime** (trilhas, encontros, portal; P0–P9 do desenho).
- **Foco 80/20 e atribuição** (`docs/desenho-merovingio-foco-8020.md`).
