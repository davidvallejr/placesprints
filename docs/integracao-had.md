# HAD → Place Sprints: o que faz sentido puxar para os clientes ativos

Análise de 06/10/2026 feita a partir do código público do HAD (`https://had.place2u.com.br/`, app Lovable sobre o Supabase `iwlgwvmjwtdllepgtnnk`). Nenhuma consulta ao banco foi feita: a estrutura abaixo vem das tabelas, campos, telas e regras que o próprio frontend usa. **Os números reais (quantos clientes, MRR, health, NPS) precisam de login no HAD ou de uma chave de leitura do Supabase** — ver "Como validar" no fim.

## 1. O que o HAD é

Plataforma de **Customer Success e Atendimento** da Place2u: clientes, tickets, oportunidades (renovação, expansão, cross-sell, upsell, downgrade), playbooks automáticos, reuniões, tarefas, pesquisa de satisfação e métricas de receita recorrente (MRR, LTV, churn, NRR). Telas: `/had/clientes`, `/had/clientes/:id`, `/had/metricas`, `/had/churn`, `/had/renovacoes`, `/had/oportunidades`, `/had/financeiro`, `/had/reunioes`, `/had/tarefas`, `/had/historico`, `/had/interacoes`, `/had/playbooks`, `/had/relatorios`, `/had/auditoria`, `/tickets`, `/sellers`, `/pesquisa`, `/calendario-atendimento`. Integrações: Conta Azul (financeiro) e Google (agenda).

O Place Sprints, por sua vez, sabe **o que a operação faz** (tarefas do Notion, planos de ação, prestadores) e **o que o canal devolve** (vendas, visitas, Ads do Mercado Livre). O HAD sabe **o que o cliente vale e como ele está se sentindo**. As duas metades do mesmo cliente nunca se encontraram.

## 2. Estrutura do HAD (27 tabelas)

| Tabela | Para que serve | Campos relevantes (lidos do app) |
|---|---|---|
| `clients` | cadastro do cliente | `razao_social`, `cnpj`, `nome_contato`, `email`, `telefone`, `endereco`, `segmento`, `servico`, `plano`, `canal_trabalhado`, `arr_mensal` (é o **MRR**, apesar do nome), `contrato_ativo`, `data_inicio_parceria`, `data_fim_parceria`, `data_cancelamento`, `motivo_cancelamento`, `health_score`, `risco_churn` (baixo/medio/alto) + `risco_churn_motivo`, `nps`, `jornada`, `responsavel_id` (CS dono) |
| `client_consultores` | consultores Place2u do cliente | `consultor_nome` (texto livre) |
| `client_responsaveis` | mais de um dono por cliente | `responsavel_id` |
| `client_tags` | etiquetas | `tag` |
| `client_opportunities` | **renovação, expansão, cross-sell, upsell, downgrade** | `tipo`, `status` (open/won/lost), `pipeline_stage`, `valor`, `valor_cobrado`, `chance_sucesso`, `motivo_perda`, `concluded_at` |
| `client_history` | linha do tempo de contato | `tipo`, `tipo_contato` (reunião, ligação, e-mail, WhatsApp, mensagem, nota), `assunto`, `comentario`, `data`, `valor`, `cancelado` |
| `cs_interactions` + `cs_interaction_goals` | ritmo de contato do CS e meta de interações | `tipo`, `interaction_date`, `notas` |
| `meetings` + `meeting_participants` | reuniões com o cliente | `title`, `meeting_date`, `duration_minutes`, `status`, `responsavel_id`, `playbook` |
| `client_tasks` / `atendimento_tasks` | tarefas de CS e de atendimento | `titulo`, `due_date`, `status`, `urgente`, `playbook` |
| `tickets`, `ticket_notes`, `categories` | atendimento | `ticket_number`, `type`, `priority`, `status`, `is_recurrent`, `client_company`, `client_product`, `resolved_at` |
| `satisfaction_surveys` | pesquisa pós-ticket (**NPS/CSAT**) | `rating`, `comment`, `ticket_id` |
| `client_financeiro` | status financeiro (via Conta Azul) | `status` (ex.: pago, pendente) |
| `playbooks` | automações | `conditions` (ex.: `ticket_aberto_dias`, `health_score`, `pre_renovacao`, `oportunidades_abertas`, `ticket_recorrente`) e `actions` (ex.: `criar_tarefa`, `notificar_cs`, `enviar_pesquisa`, `alterar_health_score`, `alterar_risco`, `adicionar_tag`, `escalar_ticket`) |
| `audit_log` | quem mudou o quê | `entity_type`, `field_changed`, `old_value`, `new_value` |
| `profiles`, `user_roles`, `user_page_permissions`, `agents` | usuários e permissões | `display_name`, `user_function`, `role` |
| `google_tokens`, `contaazul_tokens`, `deleted_clint_deals` | integrações | — |

**Métricas que o HAD calcula** (nomes das telas): MRR, evolução do MRR em 6 meses, Top 20 clientes por MRR, LTV (R$) e LTV médio em meses ("tempo médio de vida do cliente"), churn e impacto do churn na receita, **NRR (Net Revenue Retention)**, receita por tipo de expansão e por segmento, renovados × pré-renovação, oportunidades abertas por tipo.

**Chave de junção com o Place Sprints:** `clients.cnpj` ↔ `clientes_central.cnpj` (153 dos 177 clientes da central têm CNPJ). Fallback: `razao_social` ≈ nome do cliente (normalizado), como já fazemos entre central e bases do Notion. Hoje o HAD já recebe o "deal ganho" do CRM via n8n (`functions/v1/n8n-create-client`), então todo cliente novo nasce no HAD: a cobertura deve ser alta.

## 3. O que puxar para os clientes ativos (173 "Ativo" na central)

Critério: só entra o que **muda uma decisão** numa tela do Place Sprints ou **completa o veredito** do cliente. O resto fica no HAD, com link.

### 3.1 Prioridade 1 — muda a prioridade do plano e o relatório

| Dado do HAD | Onde entra no Place Sprints | Por quê |
|---|---|---|
| `arr_mensal` (MRR) e `plano` | KPI "Risco" do cliente; ordenação da Distribuição e do Painel por **receita em risco**; relatório interno | Hoje a prioridade das ações só olha GMV do canal. Um cliente de MRR alto com execução ×0,43 do ritmo é o primeiro da fila — e hoje o sistema não sabe. |
| `data_fim_parceria` + `contrato_ativo` | Substitui/complementa `Venc Contrato {canal}` do Notion (121 clientes têm vencimento registrado; o HAD deve ter todos) | O playbook de renovação do plano já usa "renovação em N dias". Com a data certa, ele dispara para quem precisa. |
| `health_score`, `risco_churn` + `risco_churn_motivo` | Veredito do cliente ("saúde do cliente: alto risco — motivo") e **fator da retroalimentação**: cliente em risco alto puxa para cima ações de resultado rápido (estoque, Ads, conversão) e empurra as de longo prazo | É a única leitura humana de "como o cliente está se sentindo"; o Merovíngio só tem números do canal. |
| `nps` (e `satisfaction_surveys.rating`) | Veredito e KPI Resultado do cliente; perfil do relatório (`perfis-cliente.json`: cliente detrator recebe relatório mais tranquilizador/com mais provas) | Fecha o ciclo: resultado de vendas × percepção. |
| `responsavel_id` (CS dono) e `client_consultores` | **Ficha do cliente** (papel "CS"/consultor) e delegação no Notion | Hoje a ficha tem só prestadores do Notion; o dono de CS vive no HAD. |

### 3.2 Prioridade 2 — contexto para quem trabalha o cliente

| Dado | Onde | Uso |
|---|---|---|
| `client_opportunities` abertas (renovação, expansão, cross-sell, upsell, downgrade) com `valor` e `chance_sucesso` | Tela do cliente, aba Estratégia; KPI Risco quando há downgrade/perda em aberto | Uma expansão de canal em negociação muda o que a operação prioriza (ex.: entrar na Shopee). |
| `client_history` / `cs_interactions` (último contato, tipo) | Meta-linha do cliente: "último contato há 23 dias (WhatsApp)" | Cliente sem contato há 30+ dias e em queda de vendas = atitude imediata no diagnóstico de queda. |
| `tickets` abertos/reclamação, `is_recurrent` | Aba Estratégia e diagnóstico de queda | Ticket de reclamação recorrente explica queda e vira "motivo" com evidência. |
| `meetings` (próxima reunião) | Cabeçalho do cliente ("reunião em 3 dias") | O relatório semanal pode ser preparado para a reunião certa. |
| `segmento`, `servico`, `canal_trabalhado` | Conferência contra `Nicho`/`Produtos`/canais da central | Hoje há 4 clientes com nicho "Mix/Multinicho" e 2 "Não informado"; o HAD pode ser a fonte oficial de cadastro. |
| `client_financeiro.status` | Aviso no cliente ("pagamento pendente") | Inadimplente em queda de vendas é outro tipo de conversa. |

### 3.3 Fica no HAD (não puxar)

Tickets em detalhe, notas, playbooks, auditoria, permissões, tokens de integração, tarefas de atendimento. São operação de CS; no Place Sprints só o link "Abrir no HAD" (`/had/clientes/:id`).

### 3.4 O caminho inverso (Place Sprints → HAD) vale mais ainda

O HAD tem `health_score` **manual** e playbooks que reagem a ele. O Place Sprints calcula, por cliente, o estado real de vendas (queda/estagnação/crescimento), o ritmo de execução e o resultado das tarefas. Mandar isso para o HAD (campo ou tag, via edge function como a `n8n-create-client` existente) transforma o health score de opinião em medida — e os playbooks de CS passam a disparar por dado ("vendas −30% em 14 dias e 0 tarefas concluídas" → tarefa para o CS).

## 4. Como integrar (proposta, sem decidir ainda)

1. **Leitura só-leitura, 1× por dia (junto com a coleta das 4h):** `clients` (campos da 3.1 + 3.2), `client_opportunities` (status open), `client_history`/`cs_interactions` (último contato), `satisfaction_surveys` (último rating), `tickets` (abertos). Guardar em `data/db.sqlite` numa tabela `had_cliente` (snapshot por dia, como já fazemos com `metricas_semana`), chaveada por CNPJ com fallback por nome.
2. **Acesso:** chave de serviço do Supabase do HAD **somente leitura** (role com `SELECT` nas tabelas acima), cifrada no `.env` como os tokens do ML. Alternativa sem chave: um workflow n8n que exporta o snapshot diário para o webhook do Place Sprints (o padrão HMAC da planilha de custos já existe).
3. **Onde aparece:** veredito e KPI Risco do cliente, ficha (CS dono), ordenação por receita em risco no Painel e na Distribuição, fator na retroalimentação, motivos/atitudes no diagnóstico de queda, perfil do relatório.
4. **Volta para o HAD (fase 2):** estado de vendas + ritmo de execução + resultado das tarefas por cliente, 1× por dia, num campo/tag do `clients`, para os playbooks do CS.

## 5. Como validar com dados reais (pendente do David)

- Entrar no HAD no navegador desta sessão (ou fornecer uma chave de leitura do Supabase `iwlgwvmjwtdllepgtnnk`). Com acesso, a próxima rodada responde: quantos clientes ativos no HAD × 173 ativos na central (quantos casam por CNPJ e por nome), distribuição de `plano`/MRR, quantos têm `health_score` e `nps` preenchidos (se estiverem vazios, a prioridade 1 muda), quantas oportunidades abertas por tipo, e que fração dos vencimentos do Notion diverge de `data_fim_parceria`.
- Confirmar que `arr_mensal` é mesmo mensal (o nome sugere anual, mas o app trata como MRR).
