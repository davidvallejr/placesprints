# Plano de autonomia total — operar a conta sem consultor e sem analista

> Pedido do David (15/10/2026, ~01h15): «Plano de como poderíamos fazer para não precisar mais de consultor e não precisar mais de analista — usando esse sistema para isso, passo a passo, em que momento fazer tais coisas.»
>
> Escrito em 15/10/2026 só por leitura (`sqlite3 -readonly`, consultas agregadas; nenhum nome de pessoa sai daqui). Fontes: `CLAUDE.md`, `docs/metodologia-algoritmo.md`, `docs/desenho-causalidade-executor.md` (Chaveiro), `config/chaveiro.json`, `docs/desenho-v3-produto-estoque-financeiro.md` (com as decisões do David de 14–15/10), `docs/ofertas-estrategicas.md`, `docs/sprint90.md`, `docs/desenho-place-sprint-90.md`, `src/lib/processos.js` + `config/processos-*.json`, `config/gatilhos.json`, `consultor-discord.js`, `pendencias-cliente.js`, `alinhamentos.js`, `dossie.js`. **Não existiam ainda** `docs/desenho-v3-erp.md` nem `docs/desenho-merovingio-foco-8020.md` (estão sendo escritos); onde este plano fala de ERP e de Foco 80/20, usa só o que está registrado nas decisões do David no fim do desenho da V3 e no pedido de 15/10.
>
> Regra que vale em cada linha: **nenhum degrau de autonomia é liberado por data; é liberado por métrica medida pelo próprio sistema e aprovado pelo David.** Um motor só (Algoritmo decide, Chaveiro executa, Merovíngio mede), nunca um segundo.

---

## 1. O que consultor e analista fazem hoje (dados reais, últimos 90 dias)

Janela: tarefas do Notion com data de conclusão, início ou última edição ≥ 17/07/2026; fora `fonte in ('s90','demo')` e prospects `[Comercial]`. **11.323 tarefas em 171 clientes** (173 Ativos na central). Horas: o campo `esforco` está vazio em 100 % das tarefas — **não há medição de horas**; o que segue é contagem de tarefas, não tempo.

### 1.1 Volume e estado
| Estado | Tarefas | % |
|---|---|---|
| Concluída | 7.815 | 69 % |
| Não iniciada | 3.286 | 29 % |
| Em andamento | 131 | 1 % |
| Aguardando devolutiva do cliente | 50 | 0,4 % |
| Bloqueada | 41 | 0,4 % |

Ritmo: 620–970 tarefas por semana (pico na semana 38, ~970). **Só 30 tarefas (0,3 %) nasceram do Algoritmo** (título com `· PS-`); a etiqueta «Plano de Ação» marca 1.156 (10 %) — planos escritos à mão pelo consultor. Ou seja: hoje o trabalho do Notion é quase todo originado e priorizado por humano, não pelo sistema.

### 1.2 Por canal (campo `processo`)
| Canal | Tarefas | % |
|---|---|---|
| Shopee (todas as grafias) | ~6.300 | 56 % |
| Mercado Livre | 2.748 | 24 % |
| Amazon | 1.063 | 9 % |
| TikTok Shop | ~630 | 6 % |
| Geral / Interno / Entrada | ~420 | 4 % |

**Consequência central deste plano:** o sistema só lê e escreve no Mercado Livre. 76 % do volume de tarefas de hoje está em canais sem API no projeto. Autonomia «total» sobre a carteira atual exige adaptadores Shopee/Amazon/TikTok (ou decidir que esses canais saem do escopo da operação sem humano) — ver pergunta P1.

### 1.3 Por família de demanda (`familiaDeDemanda`, `config/processos-curadoria.json`)
| Família | Tarefas | % | Grupo de trabalho |
|---|---|---|---|
| Otimizar anúncios | 3.798 | 33,5 % | (c) execução no canal |
| Oferta Relâmpago | 1.294 | 11,4 % | (c) promoção |
| (sem tipo) | 1.037 | 9,2 % | ~80 % é execução pelo título («otimização», «aplicar estratégia IMA», «duplicar», «oferta relâmpago») |
| Duplicação de anúncios | 833 | 7,4 % | (c) cadastro |
| Cadastro de produtos | 638 | 5,6 % | (c) cadastro |
| Reunião, relatório e análise | 555 | 4,9 % | (d) comunicação / (b) decisão |
| Ads | 516 | 4,6 % | (c) tráfego |
| Outra (tipo livre) | 491 | 4,3 % | «Consultoria» 106, «Importante» 32, «Urgência Oculta» 12, «Modo Férias» 8… |
| Imagens e vídeos | 393 | 3,5 % | (c) conteúdo |
| Campanhas de desconto | 390 | 3,4 % | (c) promoção |
| Transmissão por chat | 376 | 3,3 % | (c) CRM do canal (Shopee) |
| Pesquisa de mercado | 141 | 1,2 % | (a) leitura |
| Full | 133 | 1,2 % | (c) logística (físico) |
| Preços | 129 | 1,1 % | (c) preço |
| Afiliados · Kits · Corrigir · Loja · Status · Ficha · Variações · Cupom | 599 | 5,3 % | (c) |

### 1.4 Por papel (responsável do card casado com a central e a base de prestadores; agregado, sem nomes)
| Papel | Tarefas | % | Como foi casado |
|---|---|---|---|
| Consultor (consultores da central, 17 nomes) | 1.194 | 10,5 % | `clientes_central.consultores_json` |
| Analista de E-commerce (base oficial, 17) | 2.250 | 19,9 % | `analistas_oficiais` |
| Estagiário (3 na base de prestadores) | 2.104 | 18,6 % | `prestadores.cargo` |
| Responsável não casado com a base ativa (95 nomes: ex-colaboradores, grafias, analistas fora da base oficial; 43 existem em `usuarios_notion`) | 5.087 | 44,9 % | — |
| Sem responsável | 663 | 5,9 % | — |
| Líder / CEO | 25 | 0,2 % | `lideres_json`, cargo |

O grupo «não casado» tem o mesmo perfil de família dos analistas (otimizar 2.119, oferta relâmpago 481, duplicação 422, cadastro 312) — é mão de obra de execução. Para este plano, **analista = analista oficial + estagiário + não casado = 9.441 tarefas (83 %)**; **consultor = 1.194 (10,5 %)**.

### 1.5 Divisão do trabalho de cada papel nos 6 grupos (classificação por família e título; estimativa, não leitura card a card)

| Grupo | Consultor (1.194) | Analista (9.441) |
|---|---|---|
| (a) Leitura / diagnóstico (pesquisa de mercado, «análise inicial», métricas) | ~4 % | ~1 % |
| (b) Decisão (plano de ação, precificação, «consultoria», urgência oculta, modo férias) | ~15 % | < 1 % |
| (c) Execução no canal (Ads 207, otimizar 143, Full 79, campanhas 52, oferta relâmpago 40, preços 27, cadastro/duplicação/kits/afiliados…) | ~55 % | **~96 %** (otimizar, oferta relâmpago, duplicação, cadastro, imagens, transmissão, campanhas) |
| (d) Comunicação com o cliente (reunião de alinhamento 151 no total, relatório 61, resumo semanal 18, «encontros» de absorção, resumo da reunião, processo de entrada) | ~20 % | ~2 % |
| (e) Atendimento (etiquetas Atendimento 4, Chamado 6, Solicitação Seller 15) | < 1 % | < 0,5 % |
| (f) Comercial / renovação («preparar a renovação», consultoria de renovação) | ~2 % | 0 % |

Leituras honestas: (1) o consultor hoje é **metade executor** (Ads e Full são dele) e **um quinto comunicador**; a parte «decisão» é pequena em número de cards mas é a que o sistema precisa substituir com mais cuidado. (2) O analista é execução pura — 96 % — e 56 % disso é Shopee. (3) Atendimento ao comprador **não passa pelo Notion**: não há dado; o sistema também não lê perguntas (403, `meli_pergunta` com 0 linhas) nem reclamações gravadas (`meli_claim` 0).

---

## 2. O que o sistema já faz sozinho e o que ainda depende de humano (estado em 15/10/2026)

### 2.1 Já faz (com os números do banco)
| Capacidade | Estado real | Evidência no banco |
|---|---|---|
| Coleta diária do ML (pedidos, visitas, Ads, promoções, saúde, change-log) | funciona; **47 contas conectadas de 173 Ativos (27 %)** | `meli_contas` 47; `meli_conta_saude` 41 clientes/124 dias; `meli_item_mudanca` 1.950 (promo 1.044, coleta 569, ads 337) |
| Diagnóstico + plano por anúncio (34 regras, v1.6.0) e por cliente | gera; quase nada é aprovado | `acoes_plano`: 2.051 propostas, 84 aprovadas, 30 distribuídas, 613 obsoletas |
| Chaveiro F1 (caminho declarado por ação; só classifica) | no ar | ações abertas: automático 206 · assistido 617 · cliente 301 · sem caminho 42 · geradas antes do F1 999 |
| Previsão (p_sucesso, cenários), prioridade, foco (5/semana) | funciona | `previsao_json` em cada ação |
| Medição antes × depois com controle (Merovíngio N1) | **0 ações com resultado medido** porque quase nada foi distribuído pelo Algoritmo | `resultado_json` vazio; `aprendizado` 0 linhas |
| Relatório de terça ao cliente (plano semanal, WhatsApp via n8n) + resumo interno no Discord | ligados (`gatilhos_ligado`, `consultor_discord_ligado`, `relatorio_agendador`, `alerta_auto` = ligado); envios começam 20/10 | `relatorio_envio` 18 enviados; `gatilho_lote` 19 imediatos entregues; `alerta_cliente` 15; `feedback_relatorio` 23 respostas de clientes |
| Urgente de estoque/preço com R$ (na hora) | ligado desde 14/10 | `urgente.na_hora_ligado = true` |
| Pendências do cliente por canal (avaliador único) e alerta | funciona (medido no ML; manual 0 registros) | `pendencia_cliente` 0 |
| Alinhamentos (exceções intencionais) | módulo pronto, **0 registros** | `alinhamento` 0 |
| Livro de registro append-only + dossiê/prestação de contas | livro cheio; dossiê nunca gerado | `registro_cliente` 102.235 em 178 clientes; `dossie_gerado` 0; `risco_cliente` 0 |
| Compras (ponto de reposição, quando/quanto pedir) | funciona sobre premissa (21 d) | `lead_time_cliente` 0 informados |
| Ofertas (ficha/título/descrição/preço/galeria, aprovação campo a campo, publicação com conferência) | **nunca publicou de verdade**; 5 jobs (3 rascunho, 2 pendente_dados) | `of_publicacao` 0 |
| Promoções (dry-run → aprovação → execução conferida) | pronto; **0 planos, 0 clientes com execução habilitada** | `promo_plano` 0, `promo_config` 0 |
| Sprint 90 (cliente decide e aprova no painel, sem consultor) | 1 conta piloto; `publicacao_live=false` | `s90_conta` 1 ativa |
| V3 F0–F2 (produto, estoque compartilhado em sombra), F4 financeiro (chave desligada) | em sombra | `produto.diagnostico_ligado=false`, `financeiro.margem_medida_nas_regras=false` |

### 2.2 Ainda depende de humano (e por quê)
| O quê | Dependência | Onde está declarado |
|---|---|---|
| 3 regras exigem consultor: `duplicacao_estrategica` (briefing), `urgencia_oculta` (pesquisa), `concentracao_receita` (decisão) | pesquisa/briefing humano | `config/algoritmo.json → foco.regras_exigem_consultor`; no S90 saem na geração |
| Chaveiro só classifica (F1); não existe `exec_ordem`, nem `chaveiro_ligado` | F3–F7 do desenho não construídas | desenho § 8 |
| Escrita no ML só pelos executores de Ofertas (0 publicações reais) e Promoções (0 planos) | piloto real nunca feito; escopo write do app a validar | `docs/ofertas-estrategicas.md` § «O que depende de acesso» |
| Preço, frete grátis, reativar (adaptador `chaveiro-ml.js`) | não escrito | desenho § 3.1 |
| Estoque: decisão de 15/10 manda construir o sincronismo (V3 F6 revogada «decidir depois») | adaptador `ml_estoque · alocar` não existe; Full só leitura | V3 § 7.3 e decisão 5 |
| Conteúdo/fotos com IA | `FAL_KEY` ausente no `.env` (ANTHROPIC e NOTION presentes); upload de imagem ao ML a confirmar | `ofertas-imagens.js` devolve `pendente` |
| Ads: nenhuma escrita jamais feita | endpoint de escrita não verificado (F6 do Chaveiro) | desenho D4 |
| Atendimento ao comprador (perguntas, reclamações, mediação) | perguntas em 403 (permissão do app), texto nunca lido, nenhuma resposta escrita; reclamações só contadas | § 10.5 da metodologia |
| Custos/margem | **0 clientes com custos**, 0 vínculos, 0 ERP | `custos_cliente` 0; sem custo não há piso de preço, promoção nem ROAS alvo |
| Aprovação do plano | líder/consultor aprova; 84 de 2.051 aprovadas | `/planos` |
| Alinhamentos e reuniões | alinhamento 0 registros; reunião é card do consultor (151 em 90 d) | `alinhamentos.js` |
| Shopee, Amazon, TikTok, Magalu | sem API no projeto (`NOT_SUPPORTED`): toda ação é card, sem medição | metodologia § 6 |

---

## 3. Passo a passo por função — degraus, pré-requisitos, métrica de liberação, kill switch

Escada única de autonomia (a do Chaveiro, D11): **propor → executar com aprovação → executar e avisar → autônomo** (autônomo = `executar_e_avisar` + reversão automática pela regra de parada, D9, + sem aprovação humana de ordem nenhuma naquela família). Em toda família valem as salvaguardas do desenho § 7 (chave global, política por cliente × adaptador, `confirmar === true`, hash, snapshot ao vivo, 2xx ≠ feito, 1 intervenção por anúncio por janela de prova, teto diário). **Quem aprova a passagem de degrau é sempre o David** (registro em `exec_politica.liberado_por`); o sistema só mostra que a métrica bateu. **Kill switch global:** `chaveiro_ligado = 0` (o tick sai no 1º `if`); por família: `adaptadores_live_json[adaptador] = 0`; por cliente: `exec_politica.nivel = 'propor'`.

Convenções das métricas: «ordem conferida sem divergência» = `exec_ordem.estado = executada` com `conferir()` classe `confere`; «reversão» = `revertida`; «reclamação do cliente» = resposta do cliente ao relatório classificada como insatisfação ou marcação em `risco_cliente`; «Brier» e «p calibrada» = `calibracao.js` por família (previsto × realizado).

### 3.1 Execução no Mercado Livre

| Família (famílias do Notion que absorve) | Degrau 0 → 1 → 2 → 3 | O que precisa estar pronto | Métrica que libera o próximo degrau | Kill switch / recuo |
|---|---|---|---|---|
| **Conteúdo: ficha, título, descrição, galeria** (otimizar 3.798, imagens 393, ficha 59, corrigir 92, variações 54 — no ML) | propor (hoje: Ofertas prepara, humano aprova campo a campo) → executar com aprovação (job publica após aprovação, conferência 30 min) → executar e avisar (política por cliente; conteúdo aprovado por regra: preservação, termos promocionais, catálogo) → autônomo | Chaveiro F3 (ordens, estados) + **1ª publicação real supervisionada** (critério do «go» da F5 do S90: job de ficha em anúncio ≤ 1 % do GMV, 0 divergências, reversão conferida); `FAL_KEY` para galeria; upload de imagem ao ML confirmado | 0→1: go registrado. 1→2: **10 ordens conferidas sem divergência** no adaptador `ofertas` por cliente (D11) **e** 0 `validacao_rejeitada`. 2→3: p calibrada da família conteúdo com n efetivo ≥ 8 (N2 ou melhor), Brier ≤ 0,25, ≥ 3 experimentos N3 no mesmo sentido (N4) para a regra | divergência ou `conflito_externo` em 2 ordens seguidas → volta 1 degrau; reclamação do cliente sobre texto → `propor` no cliente |
| **Preço** (preços 129, campanhas de desconto 390 na parte de preço, `preco_mudou_vendas_cairam`, `catalogo_buybox`, `margem_negativa`) | propor (assistido sem custo) → executar com aprovação (`chaveiro-ml · preco`, ≤ 10 % por ordem, nunca abaixo do piso de margem) → executar e avisar → autônomo | Chaveiro F4 (`chaveiro-ml.js`), **custos do cliente informados** (hoje 0) — sem custo não existe piso e o degrau trava em «assistido»; V3 F4 ligada (`margem_medida_nas_regras`) para piso medido | 1→2: 10 ordens conferidas sem divergência + 0 reversões por parada em 28 d. 2→3: regra de parada nunca bateu em 20 ordens; p calibrada ≥ 0,5 na família preço; Brier ≤ 0,25; N3 ≥ 1 | parada bate (vendas/dia < baseline por 14 d) → reversão ao snapshot e cliente volta a `executar_com_aprovacao` |
| **Frete grátis, reativar anúncio pausado** (status 71) | executar com aprovação → executar e avisar | F4; `frete_gratis` por PUT confirmado com 1 chamada; `sub_status` lido antes de reativar | 10 ordens conferidas; 0 reativações de anúncio em moderação | qualquer `status_ativar` divergente → adaptador `ml_item` desligado no cliente |
| **Promoções e oferta relâmpago** (oferta relâmpago 1.294, cupom 34, campanhas 390 — hoje quase tudo Shopee) | propor (dry-run) → executar com aprovação (`promo_plano` + `execucao_habilitada` por cliente) → executar e avisar (regra `promocao_giro`, `full_estoque_antigo` com margem) → autônomo | `promo_config.execucao_habilitada` (hoje 0 clientes); custos; prova da campanha (`avaliarProva`); **no ML**; Shopee só com adaptador (P1) | 1→2: 10 planos executados e conferidos sem divergência; 0 campanhas abaixo do piso de margem. 2→3: prova positiva em ≥ 60 % das campanhas medidas (Wilson inferior ≥ 0,4) em 28 d | campanha abaixo do piso ou sem custo → `propor`; nunca sai de campanha sozinho (regra das promoções) |
| **Ads** (516; 207 do consultor) | propor (valor preparado no card, humano aplica; conferência por `meli_ads_dia`) → executar com aprovação (**só se a F6 verificar o endpoint de escrita**) → executar e avisar | F6: 1 chamada real supervisionada documentada em `manual-integracao-ml.md`; meta de ACOS/ROAS cadastrada (`metas_cliente`) ou custos | 0→1: já pode (assistido). 1→2: endpoint verificado + 10 ordens de verba conferidas. 2→3: ROAS 14 d pós ≥ equilíbrio medido em 80 % das ordens; 0 ordens com gasto > teto diário | ROAS abaixo do equilíbrio 7 d → parada: voltar verba; sem meta nem custo → nunca passa de assistido |
| **Duplicação estratégica e kits** (833 + 97) | propor (briefing do consultor exigido hoje) → executar com aprovação (Ofertas `lancar`, V3 F5 ciente do estoque) → executar e avisar | `criarAnuncio` ligado ao fluxo; V3 F5 (UP esperado, kit com modo declarado); **briefing vira formulário do cliente no painel** (objetivo da lista de `config/duplicacao.json`) — é o que remove o consultor da regra | 1→2: 10 duplicações conferidas com o UP lido no dia seguinte; família medida (`medirFamilia`) sem canibalização em 28 d. 2→3: ≥ 3 famílias N3 positivas | duplicata com estoque dividido errado → pausar duplicata (assistido) e família volta a `propor` |
| **Catálogo de terceiros** | nunca conteúdo; só preço/frete/caixa de compra | predicado `editavelConteudo` | — | — |

### 3.2 Compras e estoque (famílias Full 133, «repor estoque», `estoque_ruptura`, `full_envio`)

| Etapa | Degrau | Pronto quando | Métrica de liberação | Kill switch |
|---|---|---|---|---|
| Sugestão de compra (quando/quanto pedir) | **já autônomo** (texto ao cliente no plano de terça e no urgente) | prazo do fornecedor informado por conta/SKU (hoje 0) substitui a premissa de 21 d | % de rupturas de curva A avisadas ≥ 7 d antes de zerar (meta ≥ 80 %); clientes com `lead_time` informado ≥ 50 % | `urgente.na_hora_ligado = false` |
| Sync de estoque por produto → anúncios (decisão 5 de 15/10) | propor (sombra, V3 F2/F3) → executar com aprovação (`ml_estoque · alocar`, nasce desligado por cliente) → executar e avisar | V3 F3 ligada (`produto.diagnostico_ligado`), estoque físico declarado ≤ 24 h ou ERP, trava «Σ ≤ físico − segurança», Full só leitura | 1→2: 10 alocações conferidas em todos os irmãos sem divergência; **0 vendas sem estoque** em 30 d nos produtos sincronizados. 2→3: 30 d sem divergência e 0 cancelamentos por falta | venda sem estoque ou divergência → adaptador de estoque desligado no cliente (sem reversão ao snapshot: estoque não se «desfaz») |
| Pedido ao fornecedor | **fica com o cliente** (pendência registrada + urgente): o sistema diz quando/quanto; a compra é física | ERP (Bling/Tiny) para ler pedido de compra feito → pendência fecha sozinha | pendência «hora de pedir» resolvida em ≤ 7 d em ≥ 70 % dos casos | — |
| Envio ao Full | cliente (quantidade preparada pelo sistema) | `logistica = fulfillment` no change-log fecha a ordem | idem | — |

### 3.3 Atendimento ao comprador (perguntas, reclamações, mediação) — hoje nem lido

| Degrau | Pronto quando | Métrica de liberação | Kill switch |
|---|---|---|---|
| 0 · ler: perguntas com texto, reclamações com mensagens (permissão do app no ML; 403 hoje) | permissão concedida + reautorização dos clientes; tabelas com texto | 100 % das perguntas abertas lidas em ≤ 1 h | — |
| 1 · propor: rascunho de resposta com IA (só com ficha/descrição/política de troca da conta como fonte; sem inventar prazo ou garantia), humano envia | adaptador `ml_perguntas · responder` (lista fechada: texto), auditor de texto (`relatorio-seguro`) | 50 rascunhos: ≥ 80 % enviados sem edição | — |
| 2 · executar e avisar: perguntas de **ficha** (medida, cor, compatibilidade, prazo informado pela conta) respondidas sozinhas; dúvida fora da ficha → escalonar ao cliente (pendência `atendimento_sac`) | classificador fechado por tipo de pergunta; escalonamento com SLA 24 h | 30 d com 0 reclamações originadas de resposta automática; ≥ 90 % das respostas automáticas sem correção posterior | 1 reclamação ligada a resposta automática → volta a 1 no cliente |
| 3 · reclamações e mediação | **nunca automático** (seção 4): o sistema prepara cronologia, prova (livro de registro) e rascunho; o cliente ou a mesa envia | — | — |

### 3.4 Comunicação com o cliente (substitui o grupo (d): reunião 151, relatório 61, resumo semanal, alinhamento)

| Peça | Hoje | Degrau alvo | Métrica | Kill switch |
|---|---|---|---|---|
| Plano semanal de terça (WhatsApp 09:00) + resumo interno Discord 08:30 | ligado; envios a partir de 20/10 | autônomo | taxa de leitura/resposta (`feedback_relatorio`) ≥ 40 % dos clientes em 4 semanas; 0 textos barrados pelo auditor por semana | `gatilhos_ligado = 0` |
| Relatório ao Notion do cliente (semanal/quinzenal/mensal + PDF) | agendador ligado | autônomo | 0 `falhou` em 4 envios seguidos por cliente | `relatorio_agendador` |
| Alerta de pendência crítica | ligado | autônomo | cooldown respeitado; 0 alertas sobre pendência já resolvida | `alerta_auto` |
| Cobrança de pendência (`dependencia_vencida`, catálogo por canal) | semanal no plano | autônomo | tempo médio de resolução da pendência caindo mês a mês | — |
| **Alinhamentos** (exceções intencionais) | módulo pronto, 0 registros; só painel interno | **pelo próprio cliente**: botão «É intencional» no painel S90 e resposta no WhatsApp («foi intencional» na mensagem de preço vira alinhamento com origem `s90_cliente`/`whatsapp`) | ≥ 50 % dos alinhamentos com origem do cliente em 60 d; revisão 30 d renovada sem humano | — |
| **Reunião de alinhamento** (151 cards/90 d) | consultor | **substituída por:** (1) plano de terça + respostas coletadas; (2) prestação de contas mensal gerada (`dossie` versão cliente, `dossie_mensal_ligado`); (3) painel do cliente (S90) com fato × hipótese × impacto; (4) reunião **só por exceção** aberta pela mesa (risco, churn, crise) | nº de reuniões por cliente por mês caindo para ≤ 0,25 sem queda do health score; respostas do cliente ao relatório ≥ reuniões | reclamação «não falam comigo» em `risco_cliente` → reunião da mesa |
| Onboarding («Processo de Entrada» 198, «encontros» de absorção) | consultor | painel self-service (S90 F1–F2): conectar ML, custos, prazo do fornecedor, catálogo próprio, regra comercial — cada campo é uma pendência que o sistema cobra | cliente novo com conta conectada + custos + prazo em ≤ 7 d em ≥ 70 % | — |

### 3.5 Comercial e renovação (grupo (f))

| Peça | Degrau alvo | Pronto quando | Métrica |
|---|---|---|---|
| Prestação de contas mensal (dia 1) | autônomo | `dossie_mensal_ligado` + `risco_cliente` sendo marcado | 100 % dos clientes em risco com dossiê gerado; versão cliente auditada |
| Risco de churn | propor → sinal automático: sinais SUGEREM (respostas negativas, pendências vencidas > 30 d, queda de GMV 2 ciclos, health score) e a mesa confirma | `risco-cliente.js` + feedback de relatório | precisão do sinal ≥ 60 % (marcado e confirmado) em 90 d |
| Renovação | o sistema monta o dossiê de resultado (P.R.O.V.A.: um número por etapa) e a proposta; **a conversa é humana** (seção 4) | `dossie` + `comercial.js` | — |

### 3.6 Camada de decisão — Foco 80/20 (pedido de 15/10; desenho ainda não escrito)

Escada separada, porque aqui o sistema **tira** coisas do plano, não só executa:
1. **Propor** (M2): a cada janela 15/30/45/60/90 d o Merovíngio lista o que entra/sai do foco (produtos, anúncios, famílias, canais de esforço) com degrau de evidência, p e custo de oportunidade; o David/líder confirma.
2. **Executar com aprovação** (M3): a lista vira `foco` do Algoritmo (`max_por_regra`, impacto mínimo por cliente) só depois de aprovada.
3. **Autônomo** (M5): a lista entra sozinha. **Métrica que libera:** nas 3 janelas anteriores, o GMV dos itens mantidos no foco subiu mais que o dos removidos (controle) com N2 ou melhor; Brier das previsões da família ≤ 0,25; nenhuma remoção revertida por alinhamento do cliente. **Kill switch:** chave do Foco; remoção contestada pelo cliente → item volta ao foco e janela recomeça.

Regras que hoje exigem consultor: `urgencia_oculta` e `concentracao_receita` passam a decisão do Foco 80/20 (pesquisa = diagnóstico por categoria + concorrentes por anúncio já coletados; decisão = critério numérico de concentração); `duplicacao_estrategica` passa pelo briefing do cliente (3.1).

---

## 4. O que não se automatiza (e vira «mesa» em vez de consultor por carteira)

| Fica humano | Por quê | Como a mesa trata |
|---|---|---|
| Decisão com risco jurídico/tributário: alíquota, NF (provedor fiscal, decisão 6), regra comercial sem fonte, termos | o sistema nunca presume alíquota/comissão (regra dura); NF manual até o provedor | mesa registra a regra com fonte e validade; o sistema cobra a renovação |
| Crise de reputação, mediação, chargeback, suspensão de conta, moderação | ação irreversível com terceiro (ML) e cliente emocionado | o sistema entrega cronologia + provas (livro) + rascunho; a mesa fala |
| Negociação: renovação, reajuste, churn, reembolso, contestação de fatura | obrigação de meio é defendida por pessoa | dossiê pronto; 1 pessoa para N contas |
| Exceção que o cliente não consegue explicar ao sistema («vou parar de vender isso», «estoque está no galpão do sócio», «boi de piranha») | vira alinhamento, mas alguém precisa ouvir | mesa registra o alinhamento (origem `notion`/`painel`); meta: ≥ 50 % entram pelo próprio cliente |
| Reversão de mudança feita por humano | o sistema não conhece o «antes» com certeza (D9) | mesa decide |
| Catálogo próprio × terceiros, kit pré-montado × montado na hora, estoque espelhado × dividido | não determinável por API; o sistema pergunta (até 2 por plano) | cliente responde no painel; mesa só na dúvida |

**Mesa mínima:** 1 pessoa para N contas, só exceções (Discord do time filtrado: divergências, reversões, reclamações, risco, pendências vencidas > 30 d, perguntas escaladas). **Métrica de contas por pessoa** (a ser medida em `/planos`): contas Ativas ÷ pessoas que tocaram ordem/alinhamento/risco no mês. Hoje (estimativa pela central): 173 contas ÷ (17 consultores + 17 analistas + 3 estagiários) ≈ **4,7 contas por pessoa**. Alvos por marco (estimativa, rotulada): M2 ≈ 8 · M3 ≈ 15 · M4 ≈ 30 · M5 ≈ 60 · M6 ≥ 100 contas por pessoa da mesa. O número só sobe quando a métrica de autonomia (§ 5) sobe junto; se as exceções por conta crescerem, a conta por pessoa trava.

---

## 5. Linha do tempo em marcos (liberados por métrica; semanas = ordem de grandeza, estimativa)

**Métrica de autonomia (medida pelo próprio sistema):** `autonomia = ordens executadas e conferidas pelo Chaveiro (+ ações caminho cliente resolvidas pelo avaliador sem card humano) ÷ ações do plano encerradas no período`, por família e por cliente, só no ML. Métrica irmã: `cobertura = tarefas do Notion que nasceram do Algoritmo (· PS-) ÷ tarefas do Notion` — hoje 0,3 %.

| Marco | O que entra | O que sai do humano | Autonomia (ML) | Riscos / o que faz recuar | Estimativa |
|---|---|---|---|---|---|
| **M0 — hoje (15/10)** | coleta, diagnóstico, plano, previsão, relatório de terça (20/10), urgente de estoque/preço, pendências, livro, Chaveiro F1 | nada: 0 ordens, 0 publicações reais, 0 custos, 27 % das contas conectadas | **~0 %** (cobertura 0,3 %) | — | — |
| **M1 — conectar e aprovar** | conectar as 173 contas Ativas; custos + prazo do fornecedor como pendência cobrada; líderes aprovam as 5 do foco por semana; distribuição pelo Algoritmo substitui o plano à mão (etiqueta «Plano de Ação») | consultor deixa de **escrever** o plano; aprova | autonomia ~0 %, cobertura ≥ 30 % | contas sem token; clientes sem custo (preço trava em assistido) | 3–6 semanas |
| **M2 — Chaveiro F2+F3 (assistido e cliente) + 1ª publicação real** | escada N2; ordens, estados, cards com valor preparado, conferência pelo change-log; go da F5 do S90 (ficha); Foco 80/20 em «propor» | analista deixa de decidir o quê/valor: aplica o preparado e marca «fiz»; medição automática começa a encher `aprendizado` | **10–20 %** (ações `cliente` + Ofertas conferidas) | «fiz» sem mudança (→ divergente em 3 d); Notion sem token | 4–8 semanas |
| **M3 — F4 ML item + Promoções + conteúdo com IA** | `chaveiro-ml` (preço/frete/status) com estreia de 1 anúncio; `promo_config` habilitado por cliente; `FAL_KEY` e upload de imagem; política `executar_com_aprovacao` por cliente liberada pelo David; sync de estoque em `propor` (V3 F3) | analista deixa de executar conteúdo, preço, frete, promoção no ML | **30–45 %** | preço errado (piso, 10 %, snapshot, reversão); conflito externo; lote matando a medição (D8) | 6–10 semanas |
| **M4 — F5 experimentos + F6 Ads + estoque com aprovação + atendimento nível 1** | holdout escalonado (N3/N4); Ads automático se o endpoint for verificado; `ml_estoque · alocar` com aprovação; rascunho de resposta com IA; alinhamento pelo cliente | consultor deixa de executar Ads e Full; mesa só aprova ordens de risco | **55–70 %** | Ads sem API (fica assistido para sempre); venda sem estoque; resposta errada ao comprador | 8–12 semanas |
| **M5 — F7 executar e avisar + Foco autônomo + reuniões por exceção** | `executar_e_avisar` por cliente × adaptador após 10 ordens limpas; reversão automática; Foco 80/20 entra sozinho; prestação de contas mensal; respostas automáticas de ficha | consultor sai da rotina: mesa de exceções (1:N); analista ML sai | **80–90 %** no ML | reclamações de clientes; reversões > 5 %/mês → degrau cai | 8–12 semanas |
| **M6 — multicanal ou recorte** | adaptadores Shopee/Amazon/TikTok (leitura + escrita + medição) **ou** decisão de que esses canais ficam fora da operação sem humano | analista de Shopee/Amazon/TikTok (76 % do volume de hoje) | sobre a carteira inteira: só aqui passa de ~25 % | cada canal repete M2–M5 em versão curta; sem API oficial = fica humano | 12+ semanas por canal |

Total até M5 no ML: ordem de grandeza **30–45 semanas** a partir de hoje, **se** cada métrica bater na primeira tentativa. Cada recuo (divergência, reclamação, reversão) soma a janela de prova (14–28 d) de volta.

O que faz recuar um degrau, em qualquer marco (regra única, registrada no painel): 2 divergências seguidas no adaptador; 1 reclamação do cliente ligada a uma ordem; reversão por parada > 5 % das ordens do mês; Brier da família > 0,30 em duas medições; texto barrado pelo auditor sair para o cliente.

---

## 6. Ferramentas do próprio sistema para medir e governar a transição

Nada novo que decida; só projeções (regra do CLAUDE.md):

1. **Painel de autonomia em `/planos`** (`#secAutonomia`, ≤ 4 números + 1 tabela ≤ 6 colunas): autonomia % por família e por cliente (fórmula do § 5), cobertura % (tarefas do Algoritmo ÷ tarefas do Notion), ordens conferidas × divergentes × revertidas (30 d), reclamações/riscos abertos, contas por pessoa da mesa, próximo degrau liberável por cliente × adaptador («faltam 3 ordens limpas»). Fonte: `exec_ordem`, `exec_evento`, `exec_politica`, `risco_cliente`, `feedback_relatorio`, `tarefas`.
2. **Coluna «Caminho» e «Degrau» já desenhadas** (Chaveiro § 6.3) em `/planos` e `/resultados`.
3. **`/metodologia`** continua sendo onde se lê Brier, viés e saúde das regras — é a métrica que libera 2→3.
4. **Discord do time só com exceções:** o resumo de terça fica; o urgente interno (`consultor.urgente_ligado`) passa a listar **apenas** divergência, reversão, reclamação, pendência > 30 d, pergunta escalada e sinal de risco — tudo com link para a ordem. Sem «tarefa para fazer».
5. **Livro de registro** já grava tudo (102 mil entradas): cada ordem do Chaveiro entra como `fato_em` com hash — é a prova para o dossiê quando alguém perguntar «quem mudou meu preço».
6. **Teste de regressão de autonomia:** `scripts/teste-autonomia.mjs` (a criar, em memória): a fórmula da autonomia, a regra de recuo e o bloqueio de subida sem 10 ordens limpas, para nenhuma mudança futura afrouxar a escada em silêncio.

---

## 7. Três perguntas ao David (as que mudam o plano)

1. **Shopee/Amazon/TikTok (76 % das tarefas de hoje):** construir adaptadores (leitura + escrita + medição, um por vez, M6) ou declarar que a operação sem humano é **só Mercado Livre** e esses canais continuam com analista (ou saem da oferta)? Muda o alvo: «sem analista» no ML chega em M5; na carteira inteira só com M6.
2. **Atendimento ao comprador:** o sistema pode **responder perguntas de ficha sozinho** (M4–M5, com escalonamento) ou atendimento fica 100 % do cliente para sempre (o sistema só lê, cobra e prepara)? Muda se existe o adaptador `ml_perguntas` e a permissão do app.
3. **Mesa:** quem é a 1 pessoa (ou as 2) da mesa no M3 e qual o teto de exceções por semana que ela aceita antes de o sistema travar a subida de degrau? Sem esse número, «contas por pessoa» não tem alvo e a escada não tem freio humano declarado.

---

## RESUMO EXECUTIVO

**Hoje (dados reais, 90 dias):** 11.323 tarefas no Notion em 171 clientes; 83 % são execução de analista/estagiário (otimizar anúncio, oferta relâmpago, duplicação, cadastro, imagens), 10,5 % são do consultor (metade execução — Ads e Full —, um quinto reunião/relatório, uma fração pequena de decisão). 56 % do volume é Shopee; só 24 % é Mercado Livre, o único canal que o sistema lê e escreve. Horas não são medidas. Só 0,3 % das tarefas nasceram do Algoritmo; o plano ainda é escrito à mão.

**O sistema já faz sozinho:** coleta, diagnóstico, plano com previsão, relatório de terça (a partir de 20/10), urgente de estoque/preço, pendências, livro de registro, Chaveiro F1 (classifica o caminho de cada ação: 206 automáticas, 617 assistidas, 301 do cliente nas ações abertas). **Ainda não faz:** nenhuma escrita real no ML (0 publicações, 0 promoções, 0 ordens), custos de 0 clientes, 27 % das contas conectadas, 0 medições de resultado, sem IA de imagem (FAL_KEY), sem Ads, sem atendimento, 0 alinhamentos.

**Passo a passo — em que momento cada papel deixa de ser necessário (cada passo libera por métrica, aprovada pelo David, nunca por data):**

1. **M1 (≈ 3–6 sem.) — conectar e aprovar.** Todas as contas conectadas, custos e prazo do fornecedor cobrados como pendência, o Algoritmo distribui as 5 ações da semana. *O consultor para de escrever o plano.* Libera quando a cobertura (tarefas vindas do Algoritmo) passa de 30 %.
2. **M2 (≈ 4–8 sem.) — Chaveiro assistido + 1ª publicação real.** Ordens com valor preparado, conferência pelo change-log, go da publicação de ficha, medição N2 começa a encher o aprendizado, Foco 80/20 em «propor». *O analista para de decidir o quê e quanto; só aplica e marca «fiz».* Autonomia 10–20 %.
3. **M3 (≈ 6–10 sem.) — escrita no ML.** Preço/frete/status pelo Chaveiro (estreia com 1 anúncio), promoções habilitadas por cliente, galeria com IA, política «executar com aprovação». *O analista de ML para de executar conteúdo, preço, frete e promoção.* Libera por 10 ordens conferidas sem divergência por adaptador e 0 reversões em 28 d. Autonomia 30–45 %.
4. **M4 (≈ 8–12 sem.) — experimentos, Ads, estoque, atendimento nível 1.** Holdout escalonado (N3), Ads automático só se o endpoint for verificado, sync de estoque com aprovação, rascunho de resposta ao comprador, alinhamento pelo próprio cliente. *O consultor para de executar Ads e Full.* Libera por p calibrada/Brier ≤ 0,25 e 0 vendas sem estoque em 30 d. Autonomia 55–70 %.
5. **M5 (≈ 8–12 sem.) — executar e avisar + Foco autônomo.** Reversão automática pela regra de parada, Foco 80/20 entra sozinho, prestação de contas mensal, reunião só por exceção. *O consultor por carteira deixa de existir: vira mesa de exceções (1 pessoa para N contas); o analista de ML deixa de existir.* Autonomia 80–90 % no ML. Recua um degrau com 2 divergências seguidas, 1 reclamação ligada a ordem ou reversões > 5 %/mês.
6. **M6 (12+ sem. por canal) — Shopee/Amazon/TikTok** por adaptador, ou decisão de que ficam fora. *Só aqui o analista de Shopee (56 % do volume de hoje) deixa de ser necessário.*

**O que nunca sai do humano:** risco jurídico/tributário, crise de reputação e mediação, negociação (renovação, reembolso), exceções que o cliente não consegue explicar ao sistema, reversão de mudança humana. Isso vira uma mesa mínima medida em contas por pessoa (hoje ≈ 4,7; alvo M5 ≈ 60; M6 ≥ 100), alimentada por um Discord só de exceções e por um painel de autonomia em `/planos` (autonomia %, divergências, reversões, reclamações, próximo degrau liberável).

**Ordem de grandeza total até M5 (só ML): 30–45 semanas, estimativa.** As três perguntas que mudam isso: (1) Shopee/Amazon/TikTok entram ou saem; (2) o sistema responde ao comprador ou só prepara; (3) quem é a mesa e qual o teto de exceções por semana.

---

## Decisões do David (15/10/2026, ~02h)
1. **Canais:** Mercado Livre primeiro (autonomia até M5); adaptador da Shopee começa em M4; Amazon e TikTok depois. Analista de Shopee permanece até lá.
2. **Atendimento ao comprador:** o sistema prepara; responde sozinho só perguntas simples de produto com resposta na ficha, após 50 respostas sem correção; reclamação e mediação sempre com humano. Pré-requisito: permissão de perguntas no app do ML (hoje 403).
3. **Mesa de exceções:** Head de canais; teto de 10 exceções por semana por família — acima disso, a família recua um degrau de autonomia.
