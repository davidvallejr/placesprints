# Referência visual — Guesty (lido em 04/11/2026 pelo Chrome do David, só leitura)

Pedido do David: «absorver a forma de construção do sistema com as cores da Place: blocos, estruturas, textos fáceis, com processo de alimentação, passos por etapa, sistema funcional mostrando o passo a passo» — para o onboarding/CS alimentar os dados da conta sem fricção.

## O que o Guesty faz bem (mecânica, não dados)
- **Shell**: barra superior escura (verde) com busca global («Digite / para pesquisar»), atalhos (favoritos, **Adicionar novo** com 3 itens, notificações, ajuda, avatar). Barra lateral clara, 11 itens, seções expansíveis (Operações › Tarefas, Mensagens…; Conta › Configurações › Configurações da conta, Informações da empresa, Gerenciamento de usuários; Canais › Airbnb, Vrbo, Booking…).
- **Página inicial**: saudação («Bem vindo de volta, David»), 2 cartões de «próximo evento» (foto + número grande + 1 linha), 1 cartão de estado («Suas operações estão em dia / Nenhum problema requer sua atenção» com ícone verde), bloco de 4 KPIs com chips de ícone (Check-ins · Check-outs · Hóspedes · Rotatividades) e uma **linha do tempo «Atividade próxima»** (dia grande à esquerda, foto, 1 linha de contexto, nome em negrito, selo de status à direita). Fecha com cartões de conteúdo (Guide · Partner · Onboarding).
- **Listagem de propriedades**: cartões com foto, ícones dos canais (ativo/inativo), selo «NOT ACTIVE», título + endereço. Clique em item não conectado abre um diálogo curto: título, 1 frase do motivo, «Fechar» + ação primária («Conectar anúncios»).
- **Canais › Airbnb**: cabeçalho com 1 frase + «Saiba mais»; ação primária à direita; filtro (busca + status); por conta: selo «Conectado», «Sincronizar», «Configurações»; tabela de 5 colunas com (?) nos cabeçalhos e **1 ação por linha** («Conectar»).
- **Formulário de tarefa**: barra fixa no topo com Cancel / Save; callout amarelo de orientação com link («Start automating tasks»); campo de título grande sem borda com contador 0/150; rótulos com (?) e selo NEW; escolhas por rádio (Specific time / Flexible); coluna direita com cartões de contexto (prioridade, Assignee Member/Group, Supervisor, «Applies to» Property/Reservation · All/By rule/Specific); checklist e documentos no fim.
- **Erros/vazios**: ilustração + título curto + 1 frase + 1 botão.

## Tradução para o Place Sprints (cores da Place, regras do sistema de design)
- Já temos: shell com 5 menus, Quem sou, stepper de 10 etapas (`progresso.js`), Configurar cliente em 5 grupos, (i) «Como fazer». Falta o que o David pediu: **passos dentro de cada etapa**, com estado lido do dado real, o campo/botão de alimentação ao lado e o que o passo destrava.
- Padrões a copiar: 1 frase de orientação por tela + «Saiba mais» (i); cartão de estado «tudo em dia / N pontos pedem ação»; linha do tempo com dia grande; 1 ação por linha; diálogo curto (motivo + 1 ação); formulário com barra Cancelar/Salvar fixa, rótulos com (?) e coluna direita de contexto; vazio com 1 frase + 1 botão.
- Não copiar: emoji em controle, cor em KPI, mais de um primário por tela, hex solto (tokens do `ui.css`).
