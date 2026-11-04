# Ambiente de teste do Place Sprints — estrutura (04/11/2026)

> Pedido do David: «limpe todos os dados de todos os clientes, inclusive do meu Mac; escolha 5 clientes com bastante movimentação, queda e crescimento; exclua as integrações e sincronize só com os 5; layout e comunicação na linha do HAD (had.place2u.com.br) com a paleta da Place, estrutura simples e direta; o próprio sistema pede os dados que faltam (custos etc.) e vai buscando as informações.»
> Regra de todo o desenho: **nenhum segundo motor** (Trinity coleta → Arquiteto decide → Oráculo prevê → Chaveiro executa → Merovíngio mede → Morpheus comunica). O ambiente de teste é o MESMO sistema com menos clientes, menos telas visíveis e uma camada de alimentação guiada por cima do que já existe.

## 0. Princípio
O sistema **vai buscar sozinho** tudo o que tem API (Mercado Livre, Notion) e **pede à pessoa** só o que não existe em lugar nenhum (custo por produto, prazo do fornecedor, metas, catálogo próprio, destinos de aviso). Pede **um dado de cada vez, na ordem da cadeia**, mostrando o que aquele dado destrava. Nunca pede o que já sabe; nunca inventa o que não sabe.

## 1. Redução aos 5 clientes (David executa; irreversível no Mac, backup cifrado já feito em 04/11 04:46)
- Lista fechada em `config/clientes-teste.json` (Rei das Toalhas −44 %, Prisma +29 %, Moema estável/maior receita, Photo K 1.101 tarefas, Uniaodog piloto Full).
- `scripts/reduzir-para-teste.mjs --confirmar` apaga linhas de ~120 tabelas, 62 mil evidências, 7.389 pastas (5,3 GB), 631 relatórios (1 GB), 44 conexões do ML e os backups de tokens; `VACUUM`; liga `ativo:true`.
- Com `ativo:true`, `clientesAtivos()` (descobrir.js) só devolve a lista → central, descoberta de fontes, sync do Notion e coleta do ML enxergam só os 5. Voltar = `ativo:false` + sync completo.

## 2. Integrações: só Mercado Livre e Notion
| Integração | Estado no teste | Como |
|---|---|---|
| Mercado Livre (OAuth, coleta, webhook) | **ligada**, só as 5 contas | contas dos outros apagadas pela redução |
| Notion (central + quadros + Informações) | **ligada**, só os 5 | filtro de `clientesAtivos()` |
| n8n / WhatsApp / e-mail ao cliente, Discord do time, relatório automático, alerta automático, dossiê mensal | **desligadas** (já estão) e **ocultas** no modo teste | `config/clientes-teste.json → ocultar: [...]` lido por `estrutura-estado.js` e `shell.js` (menus Comunicação, Comercial, Sprint 90, NF, ERP somem) |
| ERP (Bling/Tiny), Focus NFe, Mercado Pago, Sprint 90, Comercial público | **ocultas** | idem; rotas continuam, telas somem do menu |
| Chaveiro (escrita no ML) | desligado, visível só na Jornada como «desligado» | sem mudança |

## 3. Layout e comunicação (HAD × paleta Place)
Referências: `docs/ux/referencia-guesty.md` (mecânica de passos e cartões) + HAD (lido em 04/11: fundo azul-marinho profundo com gradiente, título grande centrado, CTA laranja, 4 cartões de recurso com frase curta; app interno a absorver depois do login).
- **Paleta** (tokens já do `ui.css`; nada de hex solto): tinta/azul Place `--azul #050b21`, acento `--laranja #ff6a19` só em 1 ação primária por tela, fundo claro `#f6f5f1`, superfícies brancas, verde/âmbar/vermelho só em estado — nunca em número.
- **Shell**: 3 menus no modo teste (Clientes · Jornada · Estrutura) em vez de 5; busca global; «Quem sou». Página inicial = **«Sucesso do cliente»**: saudação, cartão de estado da carteira («tudo em dia / N clientes pedem um dado»), os 5 clientes como cartões (receita 28 d, variação, etapa atual, próximo dado pedido), linha do tempo do que o sistema fez hoje (coleta, plano, medição).
- **Comunicação**: frases de uma linha, verbo no começo («Informe o custo de 12 produtos que são 80 % da receita»), sempre com o porquê («destrava margem e preço mínimo») e o que acontece depois («o plano recalcula na próxima madrugada»). Sem jargão interno (sem «N2», «Brier», ids `PS-`) nas telas do teste; o técnico fica em Estrutura e /metodologia.

## 4. Alimentação progressiva (a Jornada ganha formulários)
A Jornada (`/jornada`) já lê o estado de 31 passos. No modo teste ela passa a **alimentar**:
1. **Passo pede o dado dentro da própria tela** (formulário inline, molde Guesty: rótulo + (?) + campo + «Salvar»), usando as rotas de escrita que já existem: custos (`POST /api/cliente/custos` e a planilha de custos), prazo do fornecedor (`lead_time_cliente`), metas (`POST /api/cliente/metas`), catálogo próprio (`POST /api/cliente/catalogo`), coleta de promoções (`POST /api/cliente/perfil`), CS/consultor/canais (`POST /api/cliente/cadastro`), destinos de aviso (configuração de gatilhos). Nenhuma rota nova de escrita.
2. **Ordem**: o cartão «Próximo passo» é sempre o 1º passo pendente da cadeia; os passos seguintes aparecem, mas «esperam» (não se preenche custo antes de conectar o ML, porque o custo é por anúncio coletado).
3. **O sistema busca antes de pedir**: ao abrir um passo, mostra o que já leu (ex.: «li 425 anúncios; 12 deles são 80 % da receita — é só esses que preciso de custo»), e pede o mínimo que destrava (custo só da curva A primeiro).
4. **Pedido fora da tela**: a cada coleta, se um passo ficou pendente há > N dias, o sistema registra um **pedido de dado** (tabela `pedido_dado(cliente, passo, pedido_em, respondido_em, por)`) e mostra na Página inicial e no sino; mensagem ao cliente só quando os avisos forem religados (hoje desligados).
5. **Dado chega → cadeia anda sozinha**: salvar custo regera o plano do cliente (já existe `gerarPlanoConta`), salvar prazo refaz o ciclo de compras, salvar metas refaz Ads × meta; a Jornada mostra «recalculado às HH:MM».

## 5. O que não muda
Motor (regras, prioridade, previsão, medição, calibração), banco e rotas de escrita, honestidade (ausente = pendente com motivo), 1 primário por tela, testes (`npm run teste`).

## 6. Ordem de construção
| # | Entrega | Depende de |
|---|---|---|
| T0 | David roda a redução (3 comandos) e termina o login do HAD no painel | backup feito |
| T1 | Modo teste no shell/Estruturas: `ocultar` no config, 3 menus, Página inicial «Sucesso do cliente» com os 5 cartões | T0 |
| T2 | Jornada com formulários inline nos 8 passos alimentáveis + «o que já li» por passo | T1 |
| T3 | `pedido_dado` + Página inicial listando pedidos abertos + recalcular ao salvar | T2 |
| T4 | Layout HAD: tokens, cartões, linha do tempo, textos de 1 linha, celular; conferência no navegador | T1 (telas do HAD interno lidas) |
| T5 | Suíte verde, reinício no fluxo combinado, memória e CLAUDE.md | T2–T4 |
