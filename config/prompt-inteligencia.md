# Sistema Operacional de Inteligência de Marketplace — roteiro do David (out/2026)

> Especificação canônica da camada de inteligência do Place Sprints, fornecida pelo David em 03/10/2026,
> junto com o objetivo de negócio: **o consultor não é eliminado — ele absorve mais contas fazendo
> principalmente as reuniões, porque o sistema faz a análise**. Complementa `prompt-estrategista.md`
> (plano de ação) e o Playbook de Consultoria (cadência, método P.L.A.C.E, renovação).
>
> ## Mapa de implementação (03/10/2026)
> **Ativo hoje**: fluxo DADO→CONTEXTO→…→AÇÃO sobre os dados do Notion (motor `plano-cliente.js`); OAuth 2.0
> oficial do Mercado Livre (tokens cifrados em repouso, nunca expostos no front nem em logs, link assinado
> por cliente — falta só MELI_CLIENT_ID/SECRET + PUBLIC_BASE_URL no .env); motor P→P→C (`motor-ppc.js`:
> comparações de períodos equivalentes, velocidade ponderada 30d×20%+14d×30%+7d×50%, projeção, Score de
> Probabilidade Operacional renormalizado com cobertura declarada, árvore causal GMV=tráfego×conversão×ticket
> com "causa provável" e critérios sem dado declarados, Priority Score impacto40+gravidade20+causal25+
> facilidade15 → P0–P3); plano de ação com estrutura obrigatória (ação/motivo/evidência/impacto/prioridade/
> responsável/prazo/status/baseline(indicador inicial)/meta/critério de aceite), IDs estáveis, decisões nunca
> sobrescritas; metas por cliente (`metas_cliente`, cadastradas — nunca inventadas); Central de Integrações
> (`/integracoes`); renovação por Venc Contrato da central; sazonalidade por calendário comercial com
> retroativo (conteúdo→reposição→campanha); tela por cliente (`/cliente`) com busca por nome/CNPJ.
> **Parcial (liga quando o canal conecta)**: diagnóstico por funil, estratégia ímã, promoções, catálogo Meli,
> logística Full, Ads por curva/estágio com break-even e ROAS alvo — existem como regras do motor + seções
> "especificado, não ativo" no documento de 12 partes; dados ausentes são marcados como pendência
> (equivalente a NOT_AVAILABLE / NOT_AUTHORIZED / NEEDS_EXTERNAL_DATA), nunca estimados em silêncio.
> **Especificado, aguardando pré-requisito externo**: Amazon (SP-API + Login With Amazon) e Shopee (Shopee
> Open Platform) exigem conta de desenvolvedor aprovada e app com client_id/secret — sem isso nenhum fluxo
> OAuth é possível; multi-conta por canal (hoje 1 conta ML por cliente — evoluir a chave de `meli_contas`
> para cliente+conta); aprendizado estatístico de intervenções (a coluna `resultado_json` de `acoes_plano`
> já acumula antes/depois por ação; P(sucesso|condições) entra quando houver volume); métricas por SKU/
> anúncio, custos/margem por SKU (fornecidos pelo cliente) e estoque próprio/Full (ERP/Bling).

---

Você está trabalhando em um SISTEMA JÁ EXISTENTE.
NÃO recrie o projeto do zero.
NÃO substitua funcionalidades existentes sem necessidade.
NÃO altere rotas, componentes, banco ou regras atuais que já funcionem sem antes verificar dependências.
Sua missão é ANALISAR A ARQUITETURA ATUAL e acrescentar uma nova camada de:

1. Integração oficial com marketplaces
2. Centralização dos dados de cada cliente
3. Diagnóstico automatizado
4. Previsibilidade
5. Probabilidade
6. Análise causal
7. Priorização de oportunidades
8. Plano de ação estratégico
9. Monitoramento contínuo
10. Aprendizado a partir das ações realizadas

O sistema deve deixar de ser apenas um dashboard e passar a funcionar como um:
"SISTEMA OPERACIONAL DE INTELIGÊNCIA DE MARKETPLACE"

## 1. Princípio central

Fluxo permanente: DADO → CONTEXTO → COMPARAÇÃO → ANOMALIA → DIAGNÓSTICO → HIPÓTESE → CAUSA PROVÁVEL →
OPORTUNIDADE → IMPACTO FINANCEIRO → PRIORIDADE → AÇÃO RECOMENDADA → RESPONSÁVEL → PRAZO → RESULTADO → APRENDIZADO.
Todo dado relevante deve responder: o que aconteceu? onde? quando começou? tamanho do impacto? por que
provavelmente? o que fazer? qual prioridade? qual resultado esperado? o resultado aconteceu? o que aprendemos?

## 2. Integrações

Seção INTEGRAÇÕES por cliente (Cliente → Mercado Livre / Amazon / Shopee). Um cliente pode ter várias contas
por canal, marketplaces/países, lojas e CNPJs. Cada conexão pertence a: tenant/cliente, canal, connection_id,
seller_id/merchant_id/shop_id, marketplace_id, país, status, scopes, created_at, last_sync, next_sync,
expiração de token, integration_health. Nunca misturar dados entre clientes. Nunca armazenar senha do
marketplace; nunca usar senha/2FA/Authy como integração permanente. Somente fluxos oficiais: ML = OAuth 2.0;
Amazon = SP-API + Login With Amazon; Shopee = Shopee Open Platform. Conferir a documentação oficial atual
antes de implementar endpoints. Conectores desacoplados por provider (auth, token-management, api-client,
rate-limit, sync, normalization, errors, webhooks, logs). Tela CENTRAL DE INTEGRAÇÕES com cards por canal,
status (Conectado / Requer atenção / Token expirando / Sincronizando / Erro de autenticação / Sem permissão /
Desconectado), conta, seller id, última sincronização, saúde, dados disponíveis, permissões, e botões
Sincronizar / Reconectar / Ver logs / Desconectar. Pós-conexão: identificar conta → vincular ao cliente certo
→ descobrir recursos → primeira sincronização → preencher cadastro → coleta histórica → primeiro diagnóstico.
Tokens cifrados em repouso, nunca no frontend, nunca completos em logs; least privilege, deny by default,
auditoria, rotação/revogação segura de refresh tokens.

## 3. Modelo normalizado

O restante do sistema não depende da estrutura específica de cada canal. Entidades: MarketplaceAccount,
Product, Listing, SKU, Order, OrderItem, TrafficMetric, ConversionMetric, AdvertisingMetric, InventoryMetric,
FinancialMetric, OperationalMetric, Promotion, CompetitorSnapshot, CatalogOpportunity, LogisticStatus,
AccountHealth. Buscar quando disponível oficialmente: vendas (GMV, receita, pedidos, unidades, ticket, por
SKU/anúncio/categoria/período), visibilidade (impressões, visitas, cliques, CTR, posicionamento, share de
impressão), conversão (geral e por SKU/anúncio/categoria, histórica), operação (cancelamentos, reclamações,
devoluções, atrasos, despacho, reputação, saúde), estoque (disponível, reservado, cobertura, velocidade,
ruptura, Full/FBA), financeiro (preço, promoção, comissão, frete, taxas, custo se fornecido, impostos se
cadastrados, margem, contribuição, lucro estimado), Ads (investimento, impressões, cliques, CTR, CPC, vendas
e receita atribuídas, ACOS, ROAS, conversão, share de impressão, perdas por orçamento/ranking).
**Se a informação não está na API oficial do canal: não inventar, não estimar em silêncio — marcar
NOT_AVAILABLE / NOT_AUTHORIZED / NOT_SUPPORTED / NEEDS_EXTERNAL_DATA.**

## 4. Comparação e anomalia

Comparar automaticamente: hoje/ontem, 7×7, 14×14, 30×30, mês atual×anterior, mesmo período do mês anterior,
mesmo período do ano anterior quando houver dados. Produzir: valor atual, anterior, diferença absoluta e
percentual, tendência, anomalia.

## 5. Projeção

Motor de projeção com médias ponderadas (não só realizado/dias×diasMês): Velocidade Esperada = média 30d×20% +
média 14d×30% + média 7d×50% (pesos calibráveis depois). Calcular projeção de GMV, vendas, unidades, Ads,
margem, estoque e data provável de ruptura.

## 6. Metas e probabilidade

Cadastro por cliente: meta mensal de GMV, margem, lucro, pedidos, por canal/categoria/SKU, meta ROAS, limite
ACOS, meta de conversão. Necessidade diária = (meta − realizado) ÷ dias restantes. Índice de ritmo = média
diária atual ÷ necessidade. Classes: ≥1,20 muito acima; ≥1,10 acima; ≥1,00 no ritmo; ≥0,90 atenção; ≥0,80
risco; <0,80 crítico. Score de probabilidade: ritmo 30% + tendência 20% + conversão 15% + tráfego 10% +
estoque 15% + Ads 10%. **Não apresentar como probabilidade estatística calibrada sem histórico — chamar de
"Score de probabilidade operacional"**. Níveis: 85-100 muito alto; 70-84 alto; 50-69 incerto; 30-49 baixo;
0-29 crítico.

## 7. Hipótese causal

Nunca assumir causalidade por co-movimento. Avaliar temporalidade 25% + correlação 25% + intensidade 20% +
consistência histórica 20% + ausência de explicação concorrente 10%. Classes: 0-39 hipótese fraca; 40-59
hipótese possível; 60-79 causa provável; 80-100 forte evidência. Usar "CAUSA PROVÁVEL", nunca "comprovada"
sem experimento. Regra: GMV ≈ tráfego × conversão × ticket. GMV caiu → avaliar tráfego, conversão, ticket,
disponibilidade, Ads, operação. Impressões caíram → VISIBILIDADE (ranking, Ads, estoque, catálogo,
relevância, preço, competitividade, qualidade, exposição). CTR caiu com impressões estáveis → CLIQUE
(imagem principal, título, preço, frete, prazo, avaliação, promoção, concorrente, catálogo). Conversão caiu
com visitas estáveis → OFERTA (preço, frete, prazo, reputação, imagens, descrição, avaliações, parcelamento,
estoque, competitividade, Buy Box/catálogo). Ticket caiu com o resto estável → MIX (baratos ganhando
participação, curva A perdendo, kits, quantidade média, cross sell).

## 8. Página de diagnóstico

Seções: Resumo Executivo, Vendas, Conversão, Tráfego, Produtos, Ads, Estoque, Logística, Reputação,
Financeiro, Oportunidades, Riscos, Plano de Ação. Responder: o que funciona? o que piorou/melhorou? onde o
faturamento está concentrado? onde se perde? quais SKUs ameaçados? quais com maior potencial?

## 9. Estratégia ímã

Anúncios que vendem e têm demanda comprovada mas estão abaixo do potencial: vendas+tráfego relevantes com
conversão abaixo do benchmark interno; ou impressões altas com CTR baixo; ou visitas altas com conversão
baixa. Por produto: SKU, GMV, impressões, cliques, CTR, visitas, conversão, preço, margem, Ads, benchmark,
gap, potencial estimado. Classificar: PRECISA ATRAIR / CONVERTER / MELHORAR OFERTA / GANHAR VISIBILIDADE /
MELHORAR MARGEM. Gerar sugestão estratégica.

## 10. Promoções

Não sugerir desconto indiscriminado. Analisar margem, estoque, velocidade, conversão, competitividade,
histórico, elasticidade observada, sazonalidade, Ads e objetivo (VISIBILIDADE / RANKING / CONVERSÃO / GIRO /
RECUPERAÇÃO / ATAQUE / SAZONALIDADE). Calcular margem pós-desconto antes de sugerir; nunca recomendar
promoção abaixo do limite de margem do cliente sem alerta explícito.

## 11. Funil de descoberta

IMPRESSÃO → CLIQUE → VISITA → CARRINHO (quando disponível) → VENDA. Calcular o gargalo predominante:
impressão alta + CTR baixo = atração; CTR bom + conversão ruim = oferta; conversão boa + impressão baixa =
expandir visibilidade.

## 12. Catálogo (Mercado Livre)

Elegibilidade, obrigatoriedade, concorrência no catálogo, ganho/perda de exposição, condições da oferta,
oportunidades. Alertas tipo: "SKU X representa 18% do faturamento e perdeu competitividade no catálogo"
(prioridade alta). Buscar também produtos sem participação com oportunidade.

## 13. Planejamento logístico

Não enviar estoque só por venda passada. Velocidade diária, cobertura (estoque ÷ média diária), lead time,
crescimento, sazonalidade, trânsito, previsão. Demanda projetada = base × fator tendência × fator
sazonalidade. Quantidade sugerida de envio. Níveis: RUPTURA IMINENTE / CRÍTICO / ATENÇÃO / SAUDÁVEL /
EXCESSO. **Nunca movimentar estoque automaticamente sem autorização explícita.**

## 14. Sazonalidade

Motor por produto, categoria, palavras-chave, histórico, calendário comercial, datas, estações, eventos e
clientes semelhantes — não limitar a datas óbvias. Campo PRÓXIMA JANELA COMERCIAL: evento, dias restantes,
produtos relacionados, ação recomendada, data limite, Ads, promoção, conteúdo, estoque necessário.

## 15. Urgência oculta

"Em quais situações diferentes este produto resolve um problema?" — uso principal/secundários, públicos,
situações, profissões, datas, problemas, combinações, kits, nichos. Não inventar característica física.
Hipóteses: NOVO USO / NOVO PÚBLICO / NOVO KIT / NOVA PALAVRA-CHAVE / NOVA SAZONALIDADE / NOVA COMUNICAÇÃO.
Sempre separar DADO OBSERVADO de HIPÓTESE ESTRATÉGICA.

## 16. Inteligência de Ads

Não decidir só por ACOS baixo. Curvas A/B/C + estágios: DESCOBERTA / VISIBILIDADE / VALIDAÇÃO / CRESCIMENTO /
ESCALA / DEFESA / RECUPERAÇÃO / RENTABILIDADE. Pergunta obrigatória: qual é o objetivo deste SKU? Ads
Opportunity Score (margem, conversão orgânica, estoque, reputação, CTR, demanda, competitividade,
crescimento, histórico, maturidade). Não anunciar agressivamente produto com estoque crítico, margem
inviável ou conversão estruturalmente ruim sem alertar o gargalo. Recomendações: COLOCAR / AUMENTAR /
REDUZIR / PAUSAR / OTIMIZAR ANTES / DEFENDER / ESCALAR / TESTAR. Sem ROAS arbitrário: cadastrar CMV,
imposto, comissão, frete, embalagem, custo variável, margem desejada. Margem pré-Ads = receita − custos;
break-even ACOS = margem pré-Ads ÷ receita; break-even ROAS = 1 ÷ ACOS; ROAS ALVO preserva a margem desejada
(ACOS máximo = margem pré-Ads − margem líquida desejada).

## 17. ABC + potencial

Classificação ABC por contribuição de GMV (e margem quando possível) + dimensão POTENCIAL: A1 vende muito +
grande potencial; A2 vende muito + estabilizado; B1 médio + potencial; B2 médio + estável; C1 pequeno +
oportunidade; C2 pequeno + baixo potencial. Alimenta Ads, estoque e prioridades.

## 18. Impacto e prioridade

Toda oportunidade traduz problema em dinheiro: potencial − realizado = gap ("POTENCIAL ESTIMADO", nunca
receita garantida). Impactos: financeiro, operacional, estratégico. Priority Score: impacto financeiro 40% +
gravidade 20% + score causal 25% + facilidade 15%. P0 AGIR AGORA / P1 ALTA / P2 MÉDIA / P3 MONITORAR.

## 19. Ações e aprendizado

O diagnóstico gera ações com estrutura obrigatória: AÇÃO, MOTIVO, EVIDÊNCIA, IMPACTO, PRIORIDADE,
RESPONSÁVEL, PRAZO, STATUS, MÉTRICA BASELINE, META, RESULTADO (antes/depois). Proibido gerar genéricos
("melhorar anúncio", "otimizar Ads"). Toda recomendação diz O QUE, ONDE, POR QUÊ, IMPACTO, COMO, QUAL
MÉTRICA, QUAL RESULTADO ESPERADO. Salvar todas as intervenções (StrategicAction: id, client_id, channel,
account_id, product_id, problem_type, hypothesis, action_type, …) para aprendizado futuro
(P(sucesso | condições) quando houver histórico).
