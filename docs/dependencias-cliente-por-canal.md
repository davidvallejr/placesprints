# O que depende do cliente, por canal (catálogo de 08/10/2026)

Fonte das respostas: `docs/fonte-equipe-dependencias-cliente.md` (equipe, Shopee/TikTok, Amazon) + Manual do Analista 5.9 + o que o sistema já mede no Mercado Livre. Catálogo em `config/dependencias-cliente.json` (revisável pelo David, validado na carga). Avaliador único: `src/lib/pendencias-cliente.js` (`avaliar`) — plano de ação, Resumo, relatórios e alerta leem só dele. Contrato: `docs/contrato-pendencias-cliente.md`.

## Como o sistema chega a uma pendência (3 fontes, nessa ordem de força)

| Fonte | O que é | Quem alimenta | Rótulo de evidência |
|---|---|---|---|
| `medido` | Leitura do **banco local** do Mercado Livre (estoque, vendas de 28 dias, custos, conta). Nunca chama o ML ao vivo. | coleta diária 4–6 h | FATO (a leitura tem data) |
| `tarefa` | Tarefa do Notion em `Aguardando Devolutiva do Cliente` (status `dependencia_cliente`), classificada pelo **tipo registrado** (`tarefa_dependencia.tipo`) + canal do processo. **Nunca pelo texto da tarefa.** Sem tipo registrado = item `retorno_pendente`. | sync + líder registrando o motivo | FATO (a tarefa está parada desde X) — a causa é o que o líder registrou |
| `registro` | Pendência digitada pelo líder/consultor (`pendencia_cliente`): canal sem integração e obrigação sem card (cartão vencido, despacho atrasado, verba esgotada). | `POST /api/pendencias/registrar` | INFORMADO pela equipe (o sistema não confirma; entra no plano como hipótese) |

## Catálogo: item × canal × detecção × impacto

`deteccao` é a fonte mais forte do item; **todo item pode ser registrado à mão** em qualquer canal da coluna "Canais". Gravidade base entre parênteses.

| Item (id) | Canais | Detecção | O que o sistema vê (FATO) | Impacto em R$ | Observação / HIPÓTESE |
|---|---|---|---|---|---|
| Estoque dos produtos que mais vendem (`estoque_curva_a`, atenção) | ML, Shopee, Amazon, TikTok, Magalu | **medido no ML**; tarefa (tipo *Produto ou estoque*) e registro nos demais | ML: produto curva A/B com cobertura < 10 dias e ≥ 5 un em 28 dias, leitura de estoque datada. **Crítico** só se curva A, cobertura < 5 dias e leitura com ≤ 30 h | **ML: previsto** = Σ receita/dia (28 d) × max(0, prazo de reposição − cobertura); prazo = `algoritmo.json → lead_time_reposicao_dias` (21), premissa global, cenário base. Outros canais: sem estimativa | Que a ruptura derruba o ranking é HIPÓTESE (não entra no R$). Leitura > 30 h nunca é crítica |
| Preço de venda e custo (`preco_custo`, atenção) | todos (Amazon: preço mínimo) | **medido no ML**; tarefa (*Custos e preços*) / registro | ML: sem custo geral da loja **e** produtos curva A/B sem custo do anúncio (vínculo custo ↔ anúncio) | Sem R$: margem, ROAS alvo e desconto ficam sem cálculo | — |
| Imagens e vídeo (`midia_produto`, atenção) | todos | **medido no ML** (informativo); tarefa (*Fotos do produto*) / registro | ML: produto curva A/B com menos imagens que `fotos_minimas` (5), **só anúncio de conteúdo editável** | ações do plano paradas (se ligadas por `· PS-…`) — ML; demais sem estimativa | **Anúncio de catálogo do ML (`catalogo = 1`) é ignorado**: o conteúdo é do catálogo e o vendedor não altera. Predicado injetável `editavelConteudo(item)` (padrão `!item.catalogo`) para a frente de catálogo definir "catálogo próprio editável". Leitura medida de gravidade informativa fica só no Resumo (não vira ação no plano) |
| Informações e cadastro (`dados_produto`, atenção) | todos (Amazon: planilha de produtos) | tarefa (*Informação ou cadastro*) / registro | **Sem leitura medida**: atributos (SKU, peso, medidas, cor, NCM) não são coletados. Se passar a existir, deve usar o mesmo `editavelConteudo` | ações paradas (ML) / sem estimativa | — |
| Resposta às solicitações (`resposta_solicitacoes`, atenção) | todos | registro (a tarefa sem tipo cai em `retorno_pendente`) | só o que a equipe registra | Sem R$ | O dado "não respondeu no grupo" não existe no sistema |
| Registro regulatório / categoria restrita (`regulatorio`, **crítico**) | todos (TikTok: liberação da categoria) | tarefa (*ANVISA, INMETRO ou categoria restrita*) / registro | tarefa parada desde X | ações paradas (ML) / sem estimativa | — |
| Documentos e validação da conta (`documentos_conta`, **crítico**) | todos (Amazon: cartão, endereço, identidade, contrato social; Shopee: A1, contrato social) | tarefa (*Documentos e validação da conta*) / registro | tarefa parada desde X | ações paradas (ML) / sem estimativa | Cartão vencido na Amazon **não gera card**: só o registro manual enxerga |
| Acesso à conta (`acesso_conta`, **crítico**) | todos | **medido no ML**; tarefa (*Acesso à conta*) / registro | ML: `meli_contas` com erro (crítico) ou conexão sem renovar > 24 h (atenção). O texto do erro nunca é exibido | Sem R$ (efeito é qualitativo: sem leitura de vendas e estoque) | Conexão "sem renovar" pode ser o servidor desligado, não o cliente: por isso é atenção, não crítico |
| Despacho no prazo (`despacho_prazo`, atenção) | todos (Shopee: penalidade; ML: reputação; Amazon: entrega, "antes das 11h", não cancelar errado) | registro; tarefa *Remessa, despacho ou estoque* em Shopee/TikTok/Magalu | só o que a equipe registra | Sem R$ | **Reputação e atraso de despacho do ML são lidos ao vivo e não são gravados**: não há detecção (gravar é fase futura) |
| Verba de anúncios pagos (`verba_ads`, atenção) | ML, Shopee, Amazon | registro | só o que a equipe registra | Sem R$ | O orçamento da campanha não é coletado |
| Remessa ao FBA / envio ao Full (`remessa_fba_full`, atenção) | Amazon, ML | tarefa (*Remessa, despacho ou estoque*) / registro | tarefa parada desde X | ações paradas (ML) / sem estimativa | Para Amazon e ML o tipo *Remessa…* cai aqui (item mais específico); para Shopee/TikTok/Magalu cai em `despacho_prazo`. Dúvida real → registrar o item exato |
| Aprovações pedidas (`aprovacoes`, atenção) | todos (preço mínimo, margem, campanhas, buy box) | tarefa (*Aprovação do cliente*) / registro | tarefa parada desde X | ações paradas (ML) / sem estimativa | — |
| Atendimento aos compradores (`atendimento_sac`, atenção) | todos | registro; tarefa (*Atendimento ao comprador*) | só o que a equipe registra | Sem R$ | Perguntas/mensagens do ML exigem o escopo "Comunicações" no app (hoje 403): não detectável |
| Prazo do fornecedor ou da produção (`prazo_fornecedor`, informativo; v1.6.0, 13/10/2026) | todos | **medido no ML**: produto que mais vende (A/B) vendendo sem prazo cadastrado em `lead_time_cliente` (conta toda, anúncio ou SKU) | o cálculo de reposição usa 21 dias como referência | Sem R$ | Fica no Resumo e nos relatórios, não vira ação do plano; some quando o prazo é cadastrado (`POST /api/cliente/lead-time`) |
| Retorno pendente (`retorno_pendente`, pela régua) | todos + "todos os canais" | tarefa **sem tipo registrado** (ou *Outro*) | tarefas paradas desde X | ações paradas (ML) / sem estimativa | Hoje as 58 tarefas em dependência não têm tipo: caem todas aqui. Registrar o motivo pela tela Painel executivo promove cada uma ao item certo |

### Gravidade
- **Medida:** definida pelo avaliador (estoque e conta, acima). Custos: atenção; mídia: informativo.
- **Tarefa:** pela régua do playbook (14/30 dias): menos de 14 = informativo; 14–29 = atenção (**crítico** se o item é de base crítica: documentos, acesso, regulatório); 30+ = crítico — **só com tipo registrado e data real**. Tarefa SEM tipo registrado (`retorno_pendente`) ou com data aproximada (`ultima_edicao`) fica em atenção no máximo (política de tom de 08/10: sem registro do que foi pedido ao cliente, o sistema não afirma gravidade; não alerta).
- **Registro:** a escolhida pelo líder ou, se omitida, a base do item.
- **Dias de espera:** `desdeDe` (o mais antigo entre registro, troca de status e última edição). Origem `ultima_edicao` marca `desde_aproximado`: a evidência INTERNA (Resumo, `paraCliente:false`) diz "N dia(s); data aproximada pela última atualização da tarefa"; **ao cliente** o texto é "em aberto; data aproximada: dd/mm", sem contagem de dias. Texto ao cliente só conta tarefas com `visivel_cliente = 1`.

### Como o impacto é calculado (decisão do David: só o que o sistema mede ou prevê)
1. `ruptura_receita` (estoque no ML): FATO = receita por dia dos últimos 28 dias dos produtos em risco; ESTIMATIVA = × dias sem estoque até a reposição (prazo de 21 dias, premissa); tipo `previsto`, premissa escrita no próprio campo.
2. `acoes_paradas` (só ML): soma do `valor_esperado` (`previsao_json`) das ações do plano ligadas às tarefas paradas pelo sufixo `· PS-xxxxxxxxxx` no título do card. Hoje **nenhum card tem o sufixo**: o resultado é "Impacto não estimado: N tarefa(s) parada(s) há D dia(s)".
3. `nenhum`, canais sem integração (Shopee, Amazon, TikTok, Magalu) e qualquer valor zero: `sem_estimativa` com o que está parado ("Impacto não estimado (parado: …)"). **Nunca R$ 0 e nunca R$ inventado.** Valores em reais inteiros (arredondamento explícito).
4. Resumo: soma dos valores medidos/previstos; sem nenhum valor, `impacto: null`.

## O que NÃO é detectável (limites declarados)
- Shopee, Amazon, TikTok e Magalu **não têm integração**: só aparecem por tarefa do Notion ou por registro. Nenhum R$.
- Reputação, atraso de despacho, perguntas/mensagens e orçamento de Ads do ML não são gravados (ou exigem escopo que o app não tem).
- Atributos do produto (peso, medidas, cor, vídeo, ANVISA) não são coletados.
- Cartão vencido, documento vencido e "o cliente não responde no grupo" não geram card: dependem de registro.
- "Não fez" ≠ "causou": a evidência é associação datada, nunca causalidade; efeito em ranking é hipótese.

## Como a equipe registra o que o sistema não vê
`POST /api/pendencias/registrar` `{ cliente, item, canal, detalhe (≤ 300, interno), desde?, evidencia? (link http/https), gravidade?, por, confirmar }`. Sem `confirmar: true` é **prévia** (mostra a pendência e o texto que o cliente leria, nada é gravado). Só líder ou consultor da central (`por`). Uma pendência aberta por (cliente, item, canal); ao receber o retorno do cliente, `POST /api/pendencias/resolver` `{ registro_id, por, nota? }`. O texto ao cliente é **sempre o template do catálogo** (4 campos: por que importa, o que acontece se atrasar, o que precisamos, o que a Place2u faz ao receber — este último aparece nos 4 relatórios como «O que fazemos quando recebermos»), passado pelo auditor; o `detalhe` livre nunca chega ao cliente.

## Plano de ação
Regra `pendencia_cliente` (ver `docs/metodologia-algoritmo.md`, item 8 de "Como mudar o algoritmo"): uma ação por pendência medida ou registrada (máx. 5 por cliente), "Cobrar o cliente: {item} ({canal})", responsável o consultor, 72 h, R$ só como texto da evidência. Tarefas paradas há 14+ dias continuam na ação `bloqueio_cliente`.
