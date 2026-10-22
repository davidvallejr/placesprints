# Place Performance × Place Prime — produto como dimensão e a jornada Prime (desenho final, 21/10/2026)

Documento final para o David (lê sem abrir código) e para quem for implementar (ids, rotas, arquivos e linhas conferidos em 21/10/2026 com `sqlite3 -readonly`, só agregados). Base: a proposta «dimensão» (vencedora) + os enxertos das propostas «jornada» e «mínimo» aprovados pelos três juízes + a correção das falhas que eles apontaram (portal sem mexer em `s90_conta`, pendência de cadastro no lugar certo, drill por produto, «previsto» com porta de registro, crédito ao consultor que de fato treinou). Vale a regra de ouro do `CLAUDE.md`: **produto é uma dimensão** (como estado da conta e nicho) que corta diagnóstico, plano, medição e aprendizado — nunca um segundo motor. Só leitura: nada foi alterado além deste arquivo e da seção H de `docs/ux/arquitetura-5-menus.md`.

## Resumo em 10 linhas

1. **Dois produtos, já decididos em `config/produtos.json` (21/10)**: `performance` = Place Performance (assessoria: a equipe executa) e `prime` = Place Prime (consultoria: o cliente executa). Dois subtipos só como rótulo (`prime_negocio` = Legacy/Full; `performance_erp` = Reestruturação). Ninguém lê esse arquivo hoje; este desenho o liga ao sistema.
2. **Carteira resultante**: Performance **116** (102 + 7 + 2 + 4 + 1) · Prime **56** (35 + 15 + 3 + 3) · sem produto **5** (Não informado 2, Assessoria antiga 1, Implantação 1, Marketplace 10X 1) → produto `''` + pendência `produto_nao_mapeado`, nunca inferido.
3. **Produto entra em UM ponto** (`dimensoesDe`, `src/lib/impacto-tarefas.js:592`): toda medida do Merovíngio sai carimbada com `produto`; daí `/resultados`, retroalimentação, melhor profissional, calibração e `/analistas` recortam por Performance × Prime sem tabela nova. Três passagens levam o recorte a todos os menus: filtro `?f=produto` (`filtros.js`), escopo `tipo:'produto'` (`resolverEscopo`) e grupos `por_produto`/`por_produto_tipo` (+ `GRUPOS_DRILL`).
4. **«Qual produto gera mais resultado»** = uma tabela de ≤ 6 colunas em `/resultados` (`#secPorProduto`): Todos · Performance · Prime · sem produto, com n, Wilson, ganho líquido associado 90 d e ROI. Hoje sai inteira «sem amostra» (`aprendizado` = 0, `contrato_cliente` = 0) — é o número honesto; a comparação real nasce quando a medição B1 rodar e a mensalidade for informada.
5. **«Se paga»** = ganho líquido associado (receita bruta do ML, com controle) ÷ `contrato_cliente.valor_mensal_centavos` (coluna que já existe, 0 linhas): alimentar em lote pela planilha do CS. Sem valor = «—» com motivo. 80/20 por produto = `paretoTarefas` recortado por `m.produto`; o teto do foco e o caminho da ação mudam **de mão** por produto (`foco.por_produto`), não de motor.
6. **Performance → «o que o nosso time precisa melhorar»** (`#secTimeMelhorar`, 4 linhas: não sabemos fazer · execução ruim · erramos a previsão · barrado pelo auditor). **Prime → «o que o cliente não executa e não se paga»** (`#secDoCliente`: tarefas `executor = cliente` vencidas 14/30, treinado e não feito, ganho ÷ mensalidade, encontros). Hoje o Prime tem **0 de 557** tarefas com prazo: a leitura só nasce quando a tarefa ganha dono = cliente e data — é o que a trilha dá.
7. **Jornada Prime sem segundo motor**: a trilha pré-moldada é **regra do plano** (`trilha_prime`, `config/trilhas.json` curada do Manual e da jornada da consultoria) com prazo relativo ao **encontro**; o consultor «puxa» aprovando; o `distribuir()` existente cria o card no Notion (`Executor = Cliente`, prazo, «Exibir ao cliente»); o sync traz de volta; o Merovíngio mede como mede hoje.
8. **Encontro continua sendo o card** «Reunião de Alinhamento» (134 no Prime, 110 com ata) + um sidecar `encontro_info` por `tarefa_id` (tipo, consultor, gravação sem query, `transcricao_ref`, `treinado_json` marcado pelo consultor, consentimento). «Registrar encontro» = ação com essa demanda distribuída pelo mesmo caminho. Agenda geral = projeção (`GET /api/agenda`); Google Calendar/Notion Calendar são conectores da sessão do David, não do servidor — a tela diz isso.
9. **Transcrição → candidatos → ação**: `compromissosDaAta` (lista fechada de verbos) + regra `combinado_ata` em prévia; o consultor aprova/descarta como qualquer ação; a IA só redige o título contra a lista fechada de 138 processos. «Quem treina melhor» = `rankear({ papel:'treinou' })` creditando `treinado_json[].por`, mesmo Wilson, `minN = 8`. O padrão da consultoria é **sugerido** pelo Oráculo e marcado pelo David em `trilhas.json`.
10. **Portal Prime reusa o `/c/` do Sprint 90** (host exclusivo, sessão, link mágico, projeção por lista fechada) por uma tabela irmã `portal_conta` — nunca alterando `s90_conta`. O cliente vê tarefas `visivel_cliente = 1`, 6 etapas com rótulo de cliente, agenda; marca «fiz» («informado por você, não verificado»); nunca vê responsável, ranking, Notion, Merovíngio, custos. Nove fases pequenas; **P0 + P1 (3 dias)** já dão o recorte em todos os menus.

---

## 0. Fatos que decidem o desenho (conferidos em 21/10/2026)

| Fato | Número / onde | Consequência |
|---|---|---|
| `config/produtos.json` existe e ninguém o lê | 2 produtos, 2 subtipos, 9 tiers em `tier_para_produto`, `pendencia_quando_fora_da_lista: produto_nao_mapeado`; `grep produtoDe\|config/produtos src/ scripts/` só acha o `produtoDe` do grafo de anúncios (`src/lib/duplicacao.js:38`) | o helper novo chama-se **`produtoDoCliente`**/`produtoDeTier` (nunca `produtoDe`); o mapa de tiers é decisão tomada, não se reabre |
| Produto vive em dois lugares que não conversam | `clientes_central.tier` (Notion → `descobrir.js:100` → `equipe.js:114`) e `perfil_informacao.servico IN ('assessoria','consultoria','')` (`perfil-informacao.js:24`, 8 linhas preenchidas) | fonte única = `tier`; `servico` fica, é pré-preenchido por `produtoDoCliente` e vira aviso de divergência |
| Nenhum módulo do motor conhece produto | `filtros.js:40-45` (`CAMPOS_COMUNS`), `equipe.js:171` (`resolverEscopo`), `impacto-tarefas.js:386-406,592`, `retroalimentacao.js:142,170`, `calibracao.js:23`, `chaveiro.js:17`, `distribuir-notion.js:127`, `rotas-planos.js:683` (`GRUPOS_DRILL`); único filtro real: `?tier=` no CSV de links | A.2 lista os 7 pontos exatos |
| Prime no banco (tier «Place Prime», `arquivada = 0`) | 557 tarefas em 31 clientes (4 sem quadro) · 303 concluídas · 236 não iniciadas · 0 em dependência do cliente · **0 com prazo** · 89 sem responsável · 47 responsáveis, todos da equipe · `visivel_cliente = 1` em 557/557 (a propriedade «Exibir ao cliente» não existe nesses quadros: `extrair.js:78,100` cai em 1) | «o cliente não executa» não tem número hoje: precisa de dono = cliente e data |
| Reuniões já são cards | Prime 134 (110 com ata > 200 chars, 113 concluídas, 13 «Reuniao Gravada», **0 com data futura**); Performance 184 (150/123); Consultor parceiro 118 (113/116). `ehAta` em `guardiao-real.js:23`; `config/atribuicao.json:21-23 tipos_ignorados` já tem «Reunião» e «Reunião de Alinhamento» | encontro = card + sidecar; fora da medição de vendas sem código novo |
| Contas ML conectadas (por tier) | Plano Performance 27/102 · Place Prime 10/35 · Consultor parceiro 1/15 · Legacy/Full 1/6 (os outros tiers não foram contados — o P0 imprime o número certo) | «mensurável em c de M» ao lado de todo número por produto |
| Zerado em toda a base | `aprendizado` 0 · `contrato_cliente` 0 · `pagamento_cliente` 0 · `pendencia_cliente` 0 · `alinhamento` 0 · `acoes_plano` distribuídas 30 · `tarefas.fonte` ∈ {Notion 15.871, demo 36} — nenhuma `s90`/`ps` | ROI «—» e aprendizado «sem amostra» por meses; o desenho escreve isso em cada tela |
| Schema que trava atalhos | `s90_conta.plano CHECK IN ('fixo','crescimento')` + `preco_centavos NOT NULL` (`s90-schema.js:9-10`); `registro_cliente.tipo CHECK` inline sobre `TIPOS_LIVRO` (`livro-registro.js:14-24`) com 116.636 linhas, TRIGGERs sem UPDATE/DELETE e `UNIQUE (tipo, ref)` (`:31`); `historico`, `tarefa_acomp`, `tarefa_item`, `tarefa_dependencia` apontam por `tarefa_id` | portal por tabela irmã; nenhum tipo novo no livro; **nunca trocar `tarefas.id`** depois de criado |
| Da arquitetura, ainda não existem | `src/lib/estrutura-estado.js` (F3), `progresso-cliente.js` (F4), `fila.js` (F5), `curvaConcentracao`/`foco.js` do desenho do foco | o que depende deles é dito como «quando existir» |

---

## A) Produto como dimensão

### A.1 Normalização (config já decidido) → 1 função pura + 2 campos em `carregarClientes`

`src/lib/dimensoes.js`, no molde de `cfgNichos`/`normalizarNicho`/`nichoDe` (`:12-21`):

```js
// dimensoes.js — lê config/produtos.json uma vez, como cfgNichos
export const SEM_PRODUTO = 'Sem produto mapeado'
export const produtoDeTier = tier => cfgProd.tier_para_produto[String(tier || '').trim()] || null   // { produto, subtipo? } | null — nunca infere
export const produtoDoCliente = cliente => produtoDeTier(db.prepare('SELECT tier FROM clientes_central WHERE cliente = ?').get(cliente)?.tier)
```

- `equipe.js:114` (`carregarClientes`): `produto: produtoDeTier(r.tier)?.produto || ''`, `subtipo: … || ''` — `tier` continua, nada some.
- **Pendência `produto_nao_mapeado` mora em `cadastro:pendencias`** (`CHAVE_PEND`, `cadastro-clientes.js:18,192`): é pendência interna de cadastro (dono CS), listada em Estrutura › Configurar cliente e na fila do CS (F5). **Não** entra em `config/dependencias-cliente.json`, que é o catálogo do que só o cliente faz e cujo texto sai nos 4 relatórios via `pendencias-texto.js`.
- `subtipo` é só rótulo/filtro secundário (n = 3, 3 e 1): **nunca** entra em `aprender()`/`fatoresDoPlano`.
- `perfil-informacao.js:73` (`normalizar`): a tela do perfil pré-preenche `servico` a partir de `produtoDoCliente` (`prime → consultoria`, `performance → assessoria`) e mostra «diverge da central» quando o valor gravado for outro. A coluna e o CHECK (`:24`) não mudam.
- Aviso fixo na tela e na tabela por produto: «Consultor parceiro (15) e Legacy/Full (6) entram no Prime por decisão do config de 21/10» (decisão 1 no fim: subtipo `prime_parceiro` com `quem_executa:'parceiro'`, fora do ranking de consultores e da trilha).

### A.2 O ponto ÚNICO onde o recorte nasce + 3 passagens (zero motor novo)

| Onde | Mudança | Efeito |
|---|---|---|
| **`dimensoesDe`** (`impacto-tarefas.js:592`) | `{ nicho, uf, regiao, produto: produtoDoCliente(c)?.produto \|\| SEM_PRODUTO, consultor: carregarClientes()[c].principal }` | `padroesGlobais:596` já faz `Object.assign(m, d)`: **toda medida sai carimbada** → retro, melhor profissional, `/resultados`, calibração recortam sem consulta nova |
| (a) **filtro** `filtros.js:40-45` | `CAMPOS_COMUNS.produto = { rotulo: 'Produto', tipo: 'enum', opcoes: 'produtos' }`; painéis SQL (`execucao`, `analistas`, `distribuicao`) com `expande: 'clientes_do_produto'` (molde do consultor, `:52`); painéis em memória (`gmv`, `resultados`, `ofertas`, `folha`) leem `m.produto`. Resolvedor `clientesDoProduto` ao lado de `clientesDoConsultor` (`server.js:254-257`, `rotas-planos.js`); `case 'produtos'` em `opcoesDe` (`rotas-planos.js:782`, molde `case 'nichos'`) = chaves de `cfgProd.produtos` + `SEM_PRODUTO` | `?f=produto` em todas as 8 telas e exportações de `docs/filtros-avancados.md` — **é o «subdividir todos os pilares de todos os menus»** |
| (b) **escopo** `resolverEscopo` (`equipe.js:171`) | `tipo === 'produto'` → `elegiveis.filter(c => c.produto === produto)` (3 linhas) | `/planos` (gerar/distribuir por produto), `GET /api/progresso?escopo=` (F4), `GET /api/fila` (F5), `GET /api/agenda` (D.3) |
| (c) **grupos** `CHAVES_GRUPO` (`impacto-tarefas.js:386-390`) | `produto: m => m.produto \|\| SEM_PRODUTO`, `produto_tipo: m => m.tipo ? \`${m.produto}·${m.tipo}\` : null`, `consultor: m => m.consultor \|\| ''`; `agruparDimensoes` (`:395-406`) devolve `por_produto`, `por_produto_tipo`, `por_consultor`. **`GRUPOS_DRILL` (`rotas-planos.js:683`) ganha `produto`, `produto_tipo`, `consultor` no mesmo commit** — sem isso `GET /api/resultados/tarefas?grupo=produto` devolve 400 e a tabela A.4 não tem drill | `/resultados` ganha «por produto», «produto × família» e «por consultor» pela mesma função (`medidasDoGrupo:407` já aceita grupo/chave) |

Regra do `CLAUDE.md` preservada: o filtro recorta o que se vê; `padroesGlobais`/Arquiteto continuam vendo a conta inteira.

### A.3 O que cada menu mostra recortado por Performance × Prime

| Menu › submenu (destino) | Performance (time executa) | Prime (cliente executa) | O que muda no código |
|---|---|---|---|
| **Assessoria › Painel** `/` | KPIs/tarefas do time | os mesmos, sobre tarefas do cliente | `produto` em `#filtros` (painel `execucao`); `#kpisSec` ganha «Performance 116 · Prime 56 · sem produto 5» (só contagem); `#secProgresso` (F4) com seletor de produto |
| › Faturamento `/gmv` | GMV das contas Performance | GMV das contas Prime | enum `produto` (`gmvPortfolio` já recebe `filtro`, `gmv.js:30`) |
| › O que funciona `/resultados` | «o que o nosso time faz que rende» (família × analista) + `#secTimeMelhorar` (C.1) | «o que o cliente executou que rendeu» + «consultor que treina» | `#secPorProduto` NOVO (A.4); `por_produto_tipo` em `#secNichoTipo`; coluna «Executor» (D.1) |
| › Acerto do algoritmo `/metodologia` | Brier/viés por família | idem **por produto** («regra validada no Performance, sem dados no Prime» é a resposta honesta) | `compararPrevisaoRealizado` (`calibracao.js:43`) agrupa por `produtoDoCliente(l.cliente)` |
| › Carteira em risco `/planos?sec=secRisco` | risco do time | risco de **não-execução**: tarefas do cliente > 14/30 d, encontro previsto vencido sem confirmação | filtro produto; nenhum sinal fora do catálogo de pendências |
| › Comercial | — | — | nada |
| **Consultor › Resumo** `/cliente` | «Próximas ações» do time | «O que o cliente faz esta semana» + `#secEncontros` (próximo encontro, realizados ÷ previstos no ciclo, último «treinado», botão «Registrar encontro») | `#secProximas` filtra por executor; pill de produto ao lado do tier (`cliente.js:51,353`); `#secEncontros` NOVO depois de `#secAcomp` |
| › Plano | ações P0–P3 com caminho | **passos da trilha pré-datados** como ações da regra `trilha_prime`; o consultor aprova = «puxa» | regra nova em `plano-cliente.js`; distribuição igual |
| › Anúncios / Promoções / Como fazer | iguais | iguais; (i) do card diz «quem executa: cliente»; Como fazer ganha aba «Trilha Prime» | texto |
| › Estratégia | Leitura + Retro | + P.R.O.V.A. (rollup do stepper, F) | `progresso-cliente.js` (F4) devolve `prova` |
| **Execução › Distribuir** `/planos` | ao time | ao cliente (`Executor = Cliente`, consultor como 2ª pessoa) | `resolverEscopo tipo:'produto'`; `montarPagina` (D.2 passo 3) |
| › Execução no ML | Chaveiro | Chaveiro só com liberação; padrão assistido pelo cliente | `exec_politica` por cliente já existe |
| › Pelo cliente `?aba=do-cliente` | pendências | **«o que o cliente executou»**: cards `executor = cliente` fechados × abertos, régua 14/30, **«marcar feito» pelo consultor/CS** (porta manual do «fiz» antes do portal) | `#secDoCliente` conta por `executor`; PATCH de Status pelo caminho de `dependencia-cliente.js:85,168`, prévia por padrão, rótulo «registrado pelo consultor a pedido do cliente» |
| › Analistas `/analistas` | ranking de analistas | **«Consultores: quem treina melhor»** + `#secEncontros` por consultor (realizados ÷ previstos, com ata, com treinado) | `rankear` com `papel:'treinou'` (D.6); título por produto |
| **Empresa do cliente** (todos) | iguais | iguais — a conta não muda de produto | nada |
| **Estrutura › Estruturas** `/estrutura` (F3) | — | linha «Agenda da consultoria: só registro manual (Google Calendar / Notion Calendar são conectores da sessão do David, não do servidor)» | `estrutura-estado.js` |
| › Equipe | squads/analistas | consultores × carteira Prime | só-leitura |
| › Regras do método | `foco`, priors | `foco.por_produto`, `config/produtos.json`, `config/trilhas.json` (só leitura) | config |
| › Configurar cliente | ficha | ficha + «Produto: Place Prime (da central)» + aviso se `perfil_informacao.servico` divergir + pendência `produto_nao_mapeado` + «Gerar acesso ao portal» (E) | texto + rota S90 interna reusada |
| **Hoje** `/fila` (F5) | aprovar P0/P1 do time | aprovar/puxar passos da trilha; encontros da semana (previsto vencido > 24 h = «confirmar»); cliente com card parado > 14 d; transcrição sem candidatos decididos | `fila.js` recebe `produto` do cliente |

### A.4 Painel da carteira: todo + subdividido + «qual produto gera mais resultado»

`#secPorProduto` em `/resultados` (lendo `GET /api/resultados/padroes`, que já devolve `agruparDimensoes`), ≤ 6 colunas, linhas fixas **Todos · Performance · Prime · sem produto**. Usar `agrupar` direto por `CHAVES_GRUPO.produto`, **não** `comOutros('produto')`: produto com n < `min_n_padrao` aparece como «sem amostra» na própria linha, nunca somado em «Outros».

| Produto | Clientes (mensuráveis ÷ ativos) | Medidas válidas (n) | Melhorou (Wilson 95 %) | Ganho líquido associado 90 d | ROI 90 d |
|---|---|---|---|---|---|
| Todos | c ÷ 177 | n | k/n · [baixo–alto] | R$ | — (motivo) |
| Performance | ≥ 27 ÷ 116 | n | … | … | — (mensalidade informada em 0 de 116) |
| Prime | ≈ 12 ÷ 56 | n | … | … | — (0 de 56) |
| Sem produto | 0 ÷ 5 | — | — | — | — |

Regras de honestidade escritas na própria célula (padrão `cel(v, u, motivo)` de `relatorios-ciclo.js:49`):
- Rótulo «resultado **associado**» — nunca «gera», nunca «causou» (`relatorio-seguro.js:38` barra causalidade afirmada); receita bruta do ML, não lucro, salvo `financeiro.margem_medida_nas_regras = true`.
- `n < min_n_padrao` (5, `config/atribuicao.json:20`) → «sem amostra». A frase «o produto X gera mais resultado associado» só sai com `n ≥ min_n_aprendizado` (8, `config/retroalimentacao.json:15`) **nos dois** e intervalos de Wilson disjuntos; senão «sem diferença conclusiva (n Performance = a, n Prime = b)».
- «mensurável em c de M» (só canal com API — ML) e «% das tarefas em canal sem medição» ao lado.
- ROI = «—» com motivo («mensalidade informada em 0 de N») até B.

Hoje a tabela inteira sai «sem amostra» (`aprendizado` = 0, 30 ações distribuídas). É o número honesto.

---

## B) «Se paga» e 80/20 por produto

**Definição.** `ROI(cliente, janela) = ganho líquido associado na janela ÷ preço do plano na janela`.

| Peça | Fórmula / fonte | Onde nasce | Honestidade |
|---|---|---|---|
| Ganho líquido | Σ `receita_alocada` das medidas `melhorou` − Σ \|`receita_alocada`\| das `piorou`, só `!excluirDaAprendizagem(m)` (`impacto-tarefas.js:42`), janela pós-medida dentro do período (`parteNoPeriodo`, `gmv.js:22`) | `analisarCliente` (`:553`) → `resumo.ganho_associado − perda_associada` (`:578`); por produto = Σ por `m.produto` | «sem resultado mensurável» ≠ 0; marco 30/60/90 só avança com coleta |
| Preço do plano | `contrato_cliente.valor_mensal_centavos × meses` (`contrato-cliente.js:15`; `salvarContrato :91` com `por`, tipo `contrato` no livro) | hoje **0 linhas** | sem valor → «—», motivo «preço do plano não registrado» |
| Lucro em vez de receita | só com `financeiro.margem_medida_nas_regras = true` e custo informado | `lucro.js` | linha diz `fonte: lucro (cobertura x %)` ou `receita (sem custo)` |
| Por produto | Σ ganho ÷ Σ mensalidade **só dos clientes com valor informado**; declara «valor em k de M», «mensurável em c de M» | `agruparDimensoes.por_produto` + join com `contrato_cliente` | nunca estima mensalidade; nunca extrapola |

**Onde aparece:** `#secPorProduto` (A.4) · `/` `#kpisSec` «ROI 90 d associado: Performance — · Prime —» · Consultor › Resumo `#secImpacto` «÷ plano: —» · `/planos #secFocoCarteira` (quando o foco § 5 existir) ordenado por produto.

**O que falta e a escolha mais barata.** Não criar coluna em `clientes_central`: `contrato_cliente.valor_mensal_centavos` já existe, em centavos, com `por` e livro. Falta **alimentar em lote**: coluna «Mensalidade» na planilha do CS → `importarPlanilha` (`cadastro-clientes.js:172`) grava `contrato_cliente` com `por = 'planilha CS'`, prévia → `confirmar:true`, casamento de nome pelo `casar()` existente. HAD (`clients.arr_mensal`, `docs/integracao-had.md`) fica como fonte 2 quando houver chave.

**80/20 por produto.** `curvaConcentracao`/`foco.js` (`docs/desenho-merovingio-foco-8020.md`) ainda não existe. Até lá: `paretoTarefas` (`retroalimentacao.js:241`, ganho 90 d por família) recortado por `m.produto`, e a concentração por cliente via `gmvPortfolio` por produto. Quando `foco.js` nascer, roda duas curvas + a cruzada, sem código além do filtro.

**Teto e caminho mudam de mão, não de motor.** `config/algoritmo.json → foco.por_produto.prime = { max_acoes_por_cliente_semana: 3 }` sobrescreve o teto global (`:6`) na fila de `montarAcoes` (mesmo `omitidas`); premissa calibrável. O valor novo `cliente_treinado` em `classificarCaminho` (`chaveiro.js:17`) **fica para depois**: o `executor` da tarefa/medida (D.1) já responde «quem executou», e mexer no caminho toca cobertura, testes do Chaveiro e textos.

---

## C) Time no Performance · cliente no Prime

### C.1 Performance — «o que o nosso time precisa melhorar» (`#secTimeMelhorar` em `/resultados`, lendo `/api/resultados/padroes?f=produto=performance` e `/api/analistas/visao?f=`; **nenhuma rota nova**)

| Linha | Número | Fonte |
|---|---|---|
| 1 Não sabemos fazer | famílias com veredito `nao_funciona`/`inconclusivo` (n ≥ 8) **e** famílias sem nenhum prestador com `prova` | `aprender().por_tipo[].veredito` (`retroalimentacao.js:121,142`), `rankear().prova` (`melhor-profissional.js:52`), `paretoTarefas.desperdicio` |
| 2 Execução ruim | parados > `dias_parada` (30, `config/playbook.json`; a arquitetura usa 7 d para cards `PS-` — parâmetro), bloqueadas, sem prazo, sem evidência, c14 < p14 | `visaoTime`/`clientesAtrasados` (`analistas.js`), `execucaoDoCliente` (`retroalimentacao.js:495`), KPIs `metricas.js` |
| 3 Erramos a previsão | Brier por família × produto > 0,30; regras «candidata à aposentadoria» | `compararPrevisaoRealizado`/`saudeRegras` (`calibracao.js:43-74`) — **Brier por família não existe hoje** (só global `:68` e por regra); ~10 linhas |
| 4 Barrado pelo auditor | contagem de `relatorio_envio`/`gatilho_lote` por código no período | `relatorio-envio.js`, `gatilhos.js` — **sem métrica agregada hoje**; 1 SELECT por tabela |

Rodapé fixo: «Performance: 27 de 102 contas do tier principal mensuráveis (ML); 76 % das tarefas em canais sem medição de resultado».

### C.2 Prime — «o que o cliente não executa e não se paga» (`#secDoCliente` em Execução › Pelo cliente; agregado em `/analistas?f=produto=prime` e resumo em `#secPorProduto`)

| Linha | Número | Fonte | O que falta |
|---|---|---|---|
| 1 Não executa | tarefas `executor = cliente` abertas ≥ 14/30 d (`faixaDe`, `dependencia-cliente.js:39`); sem prazo; passos da trilha não puxados | `tarefas.executor` (D.1) | **0 de 557 com prazo**; `executor` não existe |
| 2 Treinado e não feito | processos em `treinado_json` dos últimos 30 d sem tarefa do cliente concluída naquela família | `encontro_info` × `tarefas` | D.1 |
| 3 Não se paga | medidas `sem_efeito`/`piorou` em passos do cliente, por família; ganho ÷ mensalidade | Merovíngio igual ao time (`impacto-tarefas.js:474` mede toda concluída com vínculo, sem olhar responsável) | 10/35 contas ML; mensalidade (B) |
| 4 Encontros | realizados ÷ previstos no ciclo, com ata (`ehAta`), com «treinado» | cards + `encontro_info` | D.4 |

Já visível com o recorte: Prime 120 reuniões para 273 conclusões em 90 d; Performance 139 para 4.786 — «mais reunião, menos execução» é o número a cruzar com ganho.

---

## D) Place Prime — a jornada do cliente dentro do Place Sprints (mínima; Notion em espelho até sair)

Princípio: **a trilha é regra do plano com prazo relativo ao encontro** (molde `sem_plano_mes`/`calendario`/`renovacao`, `plano-cliente.js:223,267,281`), distribuída pelo `distribuir()` existente e sincronizada de volta. Nada de gerador paralelo; nada de linha `fonte='ps'` enquanto o Notion for o quadro.

### D.1 Modelo de dados (aditivo, mínimo)

| Objeto | Decisão | Onde |
|---|---|---|
| **Executor** | propriedade `Executor` (select `Equipe` \| `Cliente`) nos quadros → `config/mapeamento.json → propriedades.executor: ["Executor","Quem executa"]` (molde `:21`) → coluna aditiva `tarefas.executor TEXT NOT NULL DEFAULT ''` no upsert (`sync.js:20`, +1 coluna; migração aditiva em `db.js`). **Fallback declarado** quando a propriedade não existe: `produto = prime` e `responsavel` não casa com `analistas_oficiais`/prestadores → `executor = 'cliente (inferido)'` — rotulado, nunca silencioso | decisão 3 do David |
| **Trilha** | `config/trilhas.json` (lista fechada, molde `config/duplicacao.json`): `{ id, nome, produto:['prime'], canal, encontro_gatilho:'kickoff'\|'diagnostico'\|'plano'\|'execucao'\|'reforco', passos:[{ n, processo:'6.1', titulo, executor:'cliente'\|'consultor', apos:'encontro'\|'anterior', dias, faixa_prazo, check:[…] (= evidencia do processo), prova:{ metrica, criterio } }], padrao:false }`. Curada a partir de **(a)** fases 0–5 / 7 encontros da skill `consultoria-renovacao-place2u` (Onboarding → Diagnóstico 360 → Plano P1/P2/P3 → Execução guiada → Reforço) e **(b)** do Manual (`processos-curadoria.json`): `faixa_prazo` resolve pelas 5 faixas com `ate_dias` (`:191-214`); os 25 `processos[].prazo` são texto livre e `executor` é `'analista'` nos 25; `regras_gerais.responsavel` (`:190`) já manda «quando depende do cliente, o responsável é o cliente». `prova.metrica` só da lista que o sistema mede (vendas/visitas/conversão 28 d, anúncios ativos, custo ÷ receita, pendências resolvidas); fora disso `pendente` | config |
| **Tarefa da trilha** | ação `acoes_plano` da regra `trilha_prime` (`alvo = trilha|passo|encontro_id` → `idAcao` `plano-cliente.js:85` idempotente), `prazo` = âncora + `dias` acumulados + faixa, `demanda` = família do passo, `dados.{ trilha_id, passo_n, executor, encontro_id, indicador_inicial/meta/criterio_aceite }` = `prova` (já vai ao card em «Como saberemos se funcionou», `distribuir-notion.js:77`), `conteudo` = `roteiroEmTexto(roteiro(processo))` (`processos.js:105`) + `check` como `to_do` (`distribuir-notion.js:73,110`). Card no Notion com `Executor = Cliente`, `prazo`, «Exibir ao cliente» = sim nos passos do cliente / não nos internos (**se a propriedade existir no quadro** — `opcaoExistente`; se não existir, o passo interno não é espelhado) | regra nova em `plano-cliente.js`; distribuição existente |
| **Encontro** | **continua sendo o card** `tipo_demanda IN ('Reunião de Alinhamento','Reuniao Gravada')` + sidecar `encontro_info` (molde `SCHEMA_DEPENDENCIA`, `dependencia-cliente.js:8`): `tarefa_id PK, cliente, consultor, tipo IN (kickoff,alinhamento,treinamento,revisao,fechamento), gravacao_url` (sem query, `semQuery` `livro-registro.js:59`), `transcricao_ref 'sha256:…'`, `treinado_json [{ processo_id, por }]` (ids de `processos-base.json`, 138), `consentimento_transcricao, por, atualizado_em`. Previsto = `data_inicio > hoje` e aberta · realizado = `concluida` · com ata = `ehAta` · gravada = `gravacao_url` ou `tipo_demanda = 'Reuniao Gravada'`. Os 134 cards Prime são as linhas: zero backfill, zero 2ª fonte de verdade. A tabela `encontro` completa só entra com 2ª fonte (ICS/n8n) — P8 | sidecar aditivo |
| **Treinado** | `treinado_json` **marcado pelo consultor** ao registrar o encontro (lista fechada). `treinadosDaAta(conteudo)` (regex contra os 138 ids, ao lado de `compromissosDaAta`, `guardiao.js:50`) só **sugere** o preenchimento dos 110 encontros com ata já sincronizados; nunca é fonte única. `// ponytail: regex sobre o corpo do card; o consultor corrige na tela` | `guardiao.js` |
| **Transcrição** | hoje = corpo do card (Notion meeting notes, `tarefas.conteudo`). Próximo: `.txt/.vtt` anexado ao card no Notion → o sync já baixa `file` (`sync.js:52`) para `data/evidencias/<id>` e o livro registra `anexo_tarefa` com sha256. Texto passa por `mascarar` (`livro-registro.js:56`) + `ID_INTERNO` (`relatorio-seguro.js:36`) antes de qualquer leitura fora do painel | sem rota de upload nova nas 2 semanas |
| **Famílias** | curar em `config/processos-curadoria.json → familias` (`:650`, hoje 21 sem `encontro` nem `consultoria`): `encontro` (rx `reuni[aã]o\|encontro\|kickoff\|gravad`) e `consultoria` (CONSULTORIA/consultoria/Consultoria = 37 cards do Prime, hoje em `outra:`); `tipos_ignorados` (`config/atribuicao.json:21-23`) já exclui as reuniões da medição de vendas | config |
| **Livro** | **nenhum tipo novo em `TIPOS_LIVRO`** (CHECK inline, 116.636 linhas, TRIGGERs): o card do encontro já entra como `tarefa_criada`/`tarefa_concluida`, a transcrição como `anexo_tarefa`; só o texto «no Notion» vira por fonte. `dossie.js:591` passa a contar cards de encontro com ata (1 linha) | — |
| **Permissão** | `visivel_cliente` (já sincronizado, `db.js:63`) + `executor`; a trilha nasce com `visivel_cliente = 0` nos passos internos. Portal lê só `= 1` (E) | nada no sync |
| **Identidade** | **nunca trocar `tarefas.id` depois de criado**: a tarefa da trilha nasce **pelo page_id** do Notion (como `acoes_plano.notion_page_id`, `distribuir-notion.js:201`); `registro_cliente` é `UNIQUE (tipo, ref)` com `ref = t.id` e `historico`/`tarefa_acomp`/`tarefa_item`/`tarefa_dependencia` apontam por `tarefa_id` — uma troca duplicaria `tarefa_criada` no livro e deixaria órfãos | invariante |
| **Tarefa nativa `fonte='ps'`** | **só na rota de saída do Notion** (`espelhar_notion=false` por cliente, P8): `id = 'ps:' + sha1(cliente|trilha|passo)`, DDL de `tarefas` intacto, `metricas.js:26,43` **inclui** (ao contrário de `s90` — `teste-sprint90-motor.mjs:5` fica como está; teste próprio com a regra oposta) | P8 |

### D.2 Fluxo do consultor (telas existentes)

1. **Registrar encontro** = botão em `#secEncontros` (Consultor › Resumo) → ação `demanda:'Reunião de Alinhamento'` (as regras já criam essa demanda em `plano-anuncios.js`) com `prazo` = data do encontro, `dados.encontro_info` preenchido (tipo, consultor) → prévia → `confirmar:true` pelo mesmo `distribuir()` (`distribuir-notion.js:205`); `por` validado por `lideresEConsultores`/`donos` (`equipe.js:129-131`). Sem isso «previsto» fica vazio (0 de 134 cards Prime têm data futura hoje). Previsto vencido > 24 h sem conclusão vira item «confirmar» na fila do consultor — nunca «faltou» automático.
2. **Puxar a trilha** = Consultor › Plano: a regra `trilha_prime` já propôs os passos devidos (âncora = último encontro concluído `data_conclusao || data_inicio`; sem encontro → passo 0 «Marcar encontro de abertura»); o consultor **aprova** (`POST /api/planos/acoes/status`) — isso é o «puxar». Na F5 o mesmo bloco aparece em `/fila?por=consultor`. Ordem dos passos por `ordenarPorSequencia` (`processos.js:119`) — nunca uma 2ª sequência.
3. **Datar pelo encontro** = o prazo já veio; se o encontro mudou de data, regerar o plano recalcula (ação antiga vira `obsoleta`, como qualquer regra; `idAcao` por `alvo` não duplica).
4. **Distribuir** = Execução › Distribuir, dry-run → `confirmar:true`. Em `montarPagina` (`distribuir-notion.js:127`): se `produtoDoCliente(a.cliente)?.produto === 'prime'` ou `dados.executor === 'cliente'` → `exec = null` (sem `people`), `notaResp` (`:170-175`) = «Responsável: o cliente · consultor que treina: <ficha consultor>», consultor pelo caminho de `cons` (`:165`). Performance não muda.
5. **Marcar realizado + treinado** = ao fechar o encontro, o consultor marca `treinado_json` (ids), gravação (URL sem query) e, se houver, anexa a transcrição ao card — `POST /api/cliente/encontros/:tarefa_id` (prévia → confirmar), grava só `encontro_info`.
6. **Cliente vê** = Notion (hoje) ou portal `/c/tarefas` (E).
7. **Cliente marca feito** = status no Notion (sync já traz) · «marcar feito» pelo consultor/CS em Execução › Pelo cliente (porta manual, rótulo «registrado pelo consultor a pedido do cliente») · ou `POST /c/api/tarefas/:ref/feito` no portal (E) → PATCH de Status pelo mesmo `opcoesDaFonte` + `notion.req pages/:id PATCH` de `dependencia-cliente.js:85,168`, opção existente, nunca cria select.
8. **Merovíngio mede** = `impacto-tarefas.js:474` mede toda concluída com vínculo (`vinculos.js:3-5`: citado MLB · plano `· PS-` · confirmado), sem olhar executor; `analista = responsavel` só rotula. Passo de conta (pesquisa, plano) sem item → «sem resultado mensurável», declarado. `executor` entra como campo da medida (`equipe | chaveiro | cliente`), lido de `acoes_plano.dados` via `· PS-id`.
9. **Relatório** = o mesmo `montarSemanal` (`relatorio-brief.js`) e o plano de terça (`montarPlanoSemanal`, `plano-semana-texto.js:166`) ganham a linha «tarefas suas concluídas: N de M; próximo encontro dd/mm» — projeção por `visivel_cliente`, sempre pelo `relatorio-seguro`.

### D.3 Agenda geral da consultoria (projeção, nenhum motor)

`GET /api/agenda?por=consultor|cliente|semana&escopo=` = projeção sobre os cards de encontro × `encontro_info` com `resolverEscopo` (`equipe.js:171`): previstos × realizados × com ata × gravados × com «treinado», por consultor / cliente / semana ISO. Casa em: Execução › Analistas (`#secEncontros` por consultor), Consultor › Resumo (`#secEncontros` por cliente), `/c/agenda` (cliente). Linha em Estrutura › Estruturas: «Agenda da consultoria: só registro manual — Google Calendar / Notion Calendar são conectores da sessão do David, não do servidor» até existir ICS/n8n (P8).

### D.4 Reuniões: previstas / realizadas / gravadas / o que foi treinado

Contagens de D.1 e D.3. «Treinado» = `treinado_json` por encontro → por cliente: lista de processos treinados com data e por quem (`treinado_json[].por`, não o `responsavel` do card). Dossiê deixa de dizer «o sistema não guarda reuniões» (`dossie.js:591`) quando há card de encontro com ata.

### D.5 Transcrições → candidatos de tarefa (nunca motor novo)

`compromissosDaAta` (`guardiao.js:50`, lista fechada de verbos, lado cliente/assessoria/reunião) já extrai os combinados do `conteudo`. Regra `combinado_ata` em `plano-cliente.js` (ao lado de `bloqueio_cliente :145`/`pendencia_cliente :160`): para cada combinado do lado `cliente` sem card correspondente, uma ação com `origem:'ata'`, `alvo = sha256(frase)[:16]`, prior declarado em `config/algoritmo.json`, **prévia** no Plano; o consultor aprova/descarta como qualquer ação (descarte com motivo vira alinhamento). `ia.js` só para **redigir** o título a partir do trecho contra a lista fechada de `processos[].id`; id fora da lista = descartado; sem `ANTHROPIC_API_KEY` = `pendente` (`ia.js:5`). Candidato é hipótese; a medição continua antes × depois com controle. LGPD: candidato com telefone/CPF é barrado por `ID_INTERNO` antes de virar card; texto ao cliente passa por `achaCausal`/`achaPromessa`.

### D.6 «O que funciona de qual consultor»

`rankear({ familia, papel: 'treinou' })` (`melhor-profissional.js:30`): para medida com `executor = cliente`, o crédito vai ao `por` do `treinado_json` **mais recente daquela família para aquele cliente antes da conclusão da tarefa**; sem `encontro_info` com treinado, cai no consultor da central (`c.consultores[canal] || principal`) **rotulado «atribuído pela central»** — correção da falha apontada (creditar quem de fato treinou). Mesmo Wilson, `minN = 8`, mesma frase «sem prova suficiente» (`:4,52`). Tela: `/analistas?f=produto=prime` → título «Consultores: quem treina melhor»; cada consultor vê só o seu.

### D.7 O padrão que emerge e como se difunde

`aprender()` (`retroalimentacao.js:142`) também por `trilha_id` (= `dados.trilha_id` da medida, via `· PS-id`) com veredito (n ≥ 8), tempo mediano passo → conclusão e % concluída pelo cliente no prazo. O Oráculo **sugere** em `/metodologia #secRegras` (como «regra candidata à aposentadoria», `calibracao.js:74`) a trilha com veredito `funciona` e menor tempo mediano; o David marca `padrao: true` em `config/trilhas.json` — nunca automático. Difusão = a regra `trilha_prime` propõe a trilha padrão por canal no kickoff de todo Prime novo; `/processos` (Como fazer) mostra a aba «Trilha Prime»; o consultor ainda escolhe. Honesto: com ≈ 12 contas ML no Prime e 0 medidas, o padrão fica «sem amostra» por meses — até lá o padrão é o do Manual (`sequencia_logica`, `processos.js:17`).

---

## E) Portal do cliente Prime (reaproveitar o Sprint 90)

**Reusado tal qual:** host exclusivo + lista fechada (`guarda-local.js:23,42`), sessão `__Host-s90` (token só como SHA-256), link mágico de uso único gerado pela equipe + revogação (`rotas-sprint90.js:138`), cliente **só da sessão** (`?cliente=` ignorado), ref opaca (`refAcao :32`), projeção por lista fechada + `RX_BASTIDOR` + `auditarTexto` (`s90-texto.js:11,27`), aceite/LGPD (`s90_evento`), páginas autocontidas (CSP nonce, no-store, DENY), relatório snapshot (`s90_relatorio`).

**O que muda (decisão de desenho, não ajuste):**
1. **Tabela irmã `portal_conta` (id, cliente, origem 'prime', termos_versao, termos_hash, aceite_em, consentimento_em, estado, criado_em)** com `conta_id = 'prime:<id>'` em `s90_sessao`/`s90_acesso` (sem FK, `s90-schema.js:21-22`). **Não** acrescentar `origem` em `s90_conta`: `plano CHECK IN ('fixo','crescimento')` e `preco_centavos NOT NULL` (`:9-10`) barram a conta sem cobrança e mudar o CHECK exige recriar a tabela. `ehChaveS90` (`s90-chave.js:3`) continua falso → nenhum isolamento S90 (`S90_FORA_DA_COLETA_SQL`, `fonte != 's90'`) se aplica. Sem cobrança MP.
2. `semConsultor` (`plano-anuncios.js:865`) é falso no Prime: as `foco.regras_exigem_consultor` aparecem com 3º modo em `modoDaAcao` (`s90-texto.js:38`): `MODO_TEXTO.treinado = 'Esta ação é trabalhada com o seu consultor no encontro de dd/mm; você aplica e marca feito.'`
3. `ROTA_PUBLICA_S90` ganha rotas exatas: `/c/tarefas`, `/c/api/tarefas`, `/c/api/tarefas/[0-9a-f]{16}/feito`, `/c/etapas`, `/c/agenda`, `/c/api/encontros`. Host: o mesmo `SPRINT90_PUBLIC_HOST` ou `cliente.place2u.com.br` (2ª env, mesmo ramo da guarda). O shell interno nunca cita `s90`/portal (`teste-shell-ui.mjs:299`).
4. **«Fiz»** = `POST /c/api/tarefas/:ref/feito` → PATCH de Status (D.2 passo 7) + `s90_evento 'fiz'` + livro (`tarefa_status` já existe). Rótulo fixo: «informado por você, não verificado».
5. Teste novo como `teste-sprint90-texto.mjs`: JSON do portal sem `responsavel/squad/url/notion/Merovíngio/PS-`.

**Matriz papel × objeto** (L lê · E edita/decide · A aprova · — nunca; validação no servidor por `lideresEConsultores`/`donos`, `equipe.js:129-131`; cliente só por sessão):

| Objeto | Cliente Prime | Consultor | Líder | CS | Dono |
|---|---|---|---|---|---|
| Tarefas `visivel_cliente=1` (título, canal, status, prazo, `resultado_esperado`, `proximo_passo`, check) | L + «fiz» | E | E | L | E |
| Tarefas internas (`visivel_cliente=0`, `descricao`, `conteudo`, `responsavel`, `bloqueio` cru, `url`) | — | E | E | L | E |
| Ações do plano (`acoes_plano`) | L projetado (executa · recomenda · treinado) | E aprovar/descartar/delegar | A | L | A + veto |
| Etapas (stepper) | L (6 rótulos de cliente: Começamos · Conectado · Plano · Trilha puxada · Você executando · Medido e comunicado) | L | L | L | L |
| Encontros (quando/tipo/status/pauta) | L + confirmar presença | E (registrar, `treinado_json`) | E | E | E |
| Ata/transcrição (texto) | L **só com `consentimento_transcricao`** e após auditor | E | E | — | E |
| Candidatos de tarefa da ata | — | A | A | — | A |
| Relatório / plano de terça | L (snapshot) | L + enviar | A liberar | L | A |
| Pendências (texto fixo do catálogo) | L | E | E | E | E |
| Alinhamentos | L texto · E «é intencional» | E | E | L | E |
| Medidas/`aprendizado`/calibração/Brier | — | L | L | — | L |
| Ranking «quem treina melhor» | — | L (só o seu) | L | — | L |
| Risco/dossiê/contrato/pagamento/mensalidade | — | L | E | E | E |
| Custos internos, margem Place2u, chaves de estrutura, Notion ids | — | — | L | — | E |

**O que nunca sai:** `responsavel`/squad/ranking, ids/urls do Notion, `aprendizado`/Brier, `dossie_gerado`, `risco_cliente`, margem/custos internos, `acoes_plano.dados.execucao/caminho`, `gatilho_cliente.itens_json`, `feedback_relatorio`, `consultor_aviso`, `registro_cliente` (livro é prova nossa), `alinhamento.motivo`, `treinado_json` cru/pauta interna, o `conteudo` do card, candidatos não aprovados, «o que o time precisa melhorar». `p_sucesso` já sai no S90 (`s90-texto.js:55`) — manter.

**Nas 2 primeiras semanas não há portal:** o cliente vê pelo Notion (card com «Exibir ao cliente» quando a propriedade existir), pelo relatório curto e pelo plano de terça.

---

## F) Stepper e números do topo

**Stepper (F4, `progresso-cliente.js` — ainda não existe):** as 10 etapas são as mesmas; só a **prova** muda por produto, sem 2º stepper:

| Etapa | Performance | Prime |
|---|---|---|
| 5 Plano | diagnóstico + plano regerado | idem + **trilha puxada** (≥ 1 passo datado) |
| 7 Distribuído | aprovadas não distribuídas; cobertura `PS-` | idem, contando passos da trilha com card e prazo ÷ previstos |
| 8 Executado | 3 mãos (analista `PS-` ≤ 7 d · Chaveiro · cliente pendências) | **mão única = cliente**: tarefas `executor=cliente` concluídas no prazo ÷ pré-datadas do ciclo; `atrasado` = vencida > 14 d (atenção) / > 30 d |
| 10 Comunicado → rótulo Prime **«Treinado e comunicado»** | recibo do lote semanal + relatório | + encontros realizados ÷ previstos no ciclo (meta 100 %) · com ata ÷ realizados · com «treinado» ÷ realizados; `atrasado` = previsto vencido > 24 h sem confirmação; `desligado` = nenhum card de encontro e nenhuma fonte de agenda |

P.R.O.V.A. do Prime (rollup, um número por portão, skill `place2u-metodo-prova`): **P** = etapas 1–4 + kickoff realizado · **R** = 5–6 + trilha puxada + N processos treinados · **O** = % passos do cliente no prazo · **V** = encontros realizados ÷ previstos + ata anexada · **A** = medidas `melhorou` em tarefas feitas pelo cliente após treino (`compararPrevisaoRealizado` × meta).

**Números do topo por produto** (fila e `/`, ≤ 5):

| Número | Performance | Prime | Hoje |
|---|---|---|---|
| Clientes mensuráveis ÷ ativos | ≥ 27 ÷ 116 | ≈ 12 ÷ 56 | existe |
| Execução | cards `PS-` parados > 7 d | tarefas do cliente vencidas 14/30 | Prime: 0 (sem prazo = cegueira declarada) |
| Ganho líquido associado 90 d (n, Wilson) | — | — | `aprendizado` 0 |
| ROI 90 d | — (mensalidade 0/116) | — (0/56) | B |
| Acerto da previsão (Brier, n) | — | — | 0 ações medidas |
| Autonomia % (arquitetura § F) | 0 % | 0 % (o «feito» do cliente conta como resolvido sem card) | Chaveiro desligado |
| Prime ganha um 5.º | — | encontros realizados ÷ previstos no ciclo | 0 previstos |

---

## G) Fases pequenas (cada uma publicável, suíte verde; Notion em espelho com `confirmar:true`)

Invariantes em todas: ids nunca somem (`teste-shell-ui.mjs:47-59`, `cliente.js:69 VIVOS`); `teste-shell-ui.mjs:108,299` intactos; 1 `.btn-primario` por tela; cor só por token; nenhum `#hash` no `/cliente`; toda escrita no Notion dry-run → `confirmar:true`; `alerta.js` intocado; nenhuma cópia de `data/db.sqlite`; teste novo puro com banco em memória; ids novos em `hooks_js` dos inventários e `selos_sistema.secoes` reordenado no mesmo commit que mover um `.sis`.

| Fase (dias) | Entrega | Arquivos tocados | Teste |
|---|---|---|---|
| **P0 — Dimensão (dias 1–2)** | `produtoDeTier`/`produtoDoCliente`/`SEM_PRODUTO`; `carregarClientes` com `produto`/`subtipo`; `dimensoesDe` carimba `produto` e `consultor`; `CHAVES_GRUPO` + `agruparDimensoes.por_produto/por_produto_tipo/por_consultor` + **`GRUPOS_DRILL`**; `CAMPOS_COMUNS.produto` + `clientesDoProduto` + `case 'produtos'`; `resolverEscopo tipo:'produto'`; `produto_nao_mapeado` em `cadastro:pendencias`; `perfil-informacao` pré-preenche/avisa | `src/lib/dimensoes.js`, `equipe.js:114,171`, `impacto-tarefas.js:386-406,592`, `filtros.js:40-52`, `server.js:254-257`, `rotas-planos.js:683,782`, `cadastro-clientes.js`, `perfil-informacao.js:73` | NOVO `scripts/teste-produto-dimensao.mjs`: 9 tiers → 2 produtos + 2 subtipos; os 4 tiers fora do mapa → `''` + `produto_nao_mapeado`, nunca `outro` nem inferido; `?f=produto:prime` = 56; `por_produto` com n < 5 → «sem amostra» como linha própria; `grupo=produto` no drill ≠ 400. Casos em `teste-filtros.mjs`, `teste-impacto.mjs`, `teste-filtros-rotas.mjs` |
| **P1 — Telas (dias 3–4)** | `#secPorProduto` em `/resultados` (A.4, «sem amostra» honesto, carteira 116/56/5 e aviso parceiro/Legacy); seletor em `/`, `/gmv`, `/analistas`, `/planos`; pill de produto no `/cliente`; aviso `servico ≠ produto` e pendência em Configurar | `src/web/resultados.js/.html`, `app.js`, `gmv.js`, `analistas.js`, `planos.js`, `cliente.js:51,353`, `perfil-informacao.js` (tela), `docs/ux/inventario-*.json`, `docs/filtros-avancados.md` | `teste-resultados-rotas.mjs` (≤ 6 `<th>`, linhas Todos + 2 produtos + sem produto), `teste-shell-ui.mjs` inalterado |
| **P2 — Encontros que já existem (dias 5–6)** | `encontro_info` (sidecar) + famílias `encontro`/`consultoria` curadas; `GET /api/agenda` (projeção); `POST /api/cliente/encontros/:tarefa_id` (prévia/confirmar, `treinado_json`, gravação, consentimento); «Registrar encontro» = ação `Reunião de Alinhamento` com prazo pelo `distribuir()`; `#secEncontros` no Resumo e em `/analistas`; `treinadosDaAta` como sugestão; `dossie.js:591` real; linha «Agenda» em Estruturas (F3) | `config/processos-curadoria.json`, NOVO `src/lib/encontros.js` (puro) + `src/rotas-encontros.js`, `db.js` (schema aditivo), `guardiao.js:50`, `plano-cliente.js`, `src/web/cliente.js`, `analistas.js`, `dossie.js`, inventários | NOVO `scripts/teste-encontros.mjs` (134 cards → contagens; previsto vencido → «confirmar», nunca «faltou»; `treinado_json` só ids de `processos-base`; `por` validado); `teste-processos.mjs` (famílias), `teste-sistemas.mjs` (ordem dos selos), `teste-dossie.mjs` |
| **P3 — Trilha Prime no Notion (dias 7–9)** | `Executor` em `mapeamento.json` + `tarefas.executor` (aditiva) + fallback inferido rotulado; `config/trilhas.json` (1 trilha ML curada: kickoff → coleta → pesquisa → plano → 6.1/6.4/6.7… com faixas de prazo e `encontro_gatilho`); regra `trilha_prime` + regra `combinado_ata` em `plano-cliente.js`; `montarPagina` com `exec = null` no Prime; «marcar feito» em Pelo cliente; linha no plano de terça | `config/mapeamento.json`, `config/trilhas.json`, `db.js`, `sync.js:20`, `extrair.js`, `plano-cliente.js`, `distribuir-notion.js:127-175`, `impacto-tarefas.js` (campo `executor` na medida), `plano-semana-texto.js:166`, `src/web/cliente.js` (`#secTrilha` em Plano, bloco em `#secDoCliente`), `docs/acompanhamento-e-retroalimentacao.md` | NOVO `scripts/teste-trilhas.mjs` (toda `passos[].processo` existe em `processos-base`; `prova.metrica` na lista medida; regra idempotente por `alvo`; sem encontro → passo 0; regerar não duplica; datas encadeadas pelo encontro; card Prime sem `people`, consultor citado; Performance byte a byte igual); `teste-planos.mjs`, `teste-dependencia-cliente.mjs`, `teste-guardiao.mjs` (candidato só da lista fechada; sem chave = `pendente`) |
| **P4 — Blocos C (dia 10)** | `#secTimeMelhorar` (4 linhas) e «o que o cliente executou» em `#secDoCliente`; contagem de barrados pelo auditor; Brier por família na tela | `src/web/resultados.js`, `cliente.js`, `rotas-planos.js` (só campos novos na resposta), `calibracao.js:43-71` | `teste-resultados-rotas.mjs`, `teste-aba-do-cliente.mjs` |
| **P5 — Merovíngio por produto (semana 3, pode escorregar sem perder valor)** | `aprender().por_tipo_produto` e por `trilha_id`; `fatoresDoPlano` generaliza o estágio do nicho (`:193-194`) para `[conta, produto, nicho, base]`, cada um só com `min_n_aprendizado` (8), motivo no texto; `retroalimentar:586` monta `apProduto`; `priorEfetivo(regraId, { produto })` com `min_n_padrao` senão global com a `fonte` dizendo; Brier por produto × família; `foco.por_produto`; `rankear({ papel:'treinou' })`; sugestão de trilha padrão em `#secRegras` | `retroalimentacao.js:142-213,586`, `calibracao.js:23-74`, `melhor-profissional.js:30`, `config/retroalimentacao.json`, `config/algoritmo.json → foco`, `src/web/metodologia.html`, `analistas.js` | `teste-retroalimentacao.mjs` (fixture 2 produtos: produto com n < 8 → fator **byte a byte igual** ao sem produto), `teste-merovingio.mjs`, `teste-plano-anuncios.mjs` (teto Prime 3, `omitidas`; plano idêntico sem `foco.por_produto`), `teste-melhor-profissional.mjs` (`papel:'treinou'` credita `treinado_json[].por`) |
| **P6 — ROI (1 dia + decisão 4)** | coluna «Mensalidade» na planilha do CS → `contrato_cliente.valor_mensal_centavos` via `importarPlanilha` (prévia → confirmar, livro); ROI em `#secPorProduto`, `#kpisSec`, `#secImpacto` | `cadastro-clientes.js:172`, `contrato-cliente.js:91`, `scripts/importar-base-clientes.mjs`, `impacto-tarefas.js:553-578` (só soma por produto) | `teste-cadastro-clientes.mjs`, `teste-risco-contrato.mjs` (centavos, `por`); `teste-impacto.mjs` (sem mensalidade = «—» com motivo) |
| **P7 — Portal Prime (3 dias, decisão 6)** | `portal_conta` + `conta_id='prime:<id>'`; modo `treinado`; rotas `/c/tarefas`, `/c/etapas`, `/c/agenda`, `/c/api/encontros`, `/c/api/tarefas/:ref/feito`; projeção só `visivel_cliente=1`; 6 rótulos de etapa; «Gerar acesso» em Configurar cliente | `s90-schema.js` (tabela nova), `s90-chave.js` (comentário), `s90-texto.js:12-16,38`, `rotas-sprint90.js`, `s90-paginas.js`, `guarda-local.js:23`, `src/web/cliente.js` | NOVO `scripts/teste-portal-prime.mjs` (lista fechada exata; cliente só da sessão; JSON sem bastidor; `portal_conta` não isola como S90; «fiz» → PATCH stub + `s90_evento`); `teste-sprint90-guarda.mjs`, `teste-sprint90-texto.mjs` intacto |
| **P8 — Fora do Notion (só com decisões 7 e 8)** | tabela `encontro` quando entrar ICS/n8n (`POST /webhook/encontros` com HMAC de `gatilhos-envio.js`, montado antes do `express.json` como `/webhook/custos`); upload `.txt/.vtt` em `data/encontros/<cliente>/<sha>.txt` + `consentimento_transcricao`; `tarefas.fonte='ps'` com rota de saída | `src/lib/encontros.js`, `rotas-gatilhos.js`, `sync.js`, `metricas.js:26,43`, `automacao/n8n/` | teste próprio «`ps` ENTRA nos KPIs recortada por produto» (oposto de `teste-sprint90-motor.mjs:5`, que fica como está) |

**Régua de entrega para o David:** P0 dias 1–2 · P1 dias 3–4 · P2 dias 5–6 · P3 dias 7–9 · P4 dia 10 — duas semanas, cada fase com `node scripts/teste-*.mjs` verde e Notion em espelho. Depois: P5 (aprendizado por produto, sem pressa porque não há amostra), P6 (ROI, 1 dia depois da decisão da mensalidade), P7 (portal), P8 (calendário/transcrição no servidor).

**Ordem de valor:** P0 + P1 já dão o recorte em todos os menus e a tabela honesta por produto; P2 responde «quantos encontros, quantos com ata, quem conduziu, o que foi treinado» com os 134 cards que já existem; P3 é a trilha Prime no Notion (o cliente passa a ter tarefa com dono e data — nasce o «não executa»); P4 dá as duas leituras do David; P5 faz Merovíngio/Oráculo «seguirem a linha do produto» sem mudar nenhum plano enquanto não há amostra.

---

## Decisões que só o David toma

1. **Consultor parceiro → `prime`** (como está em `produtos.json`) com `quem_executa: cliente`? O executor ali é o parceiro, não o cliente — sugestão: subtipo `prime_parceiro` com `quem_executa: 'parceiro'`, fora do ranking de consultores e da trilha.
2. Os 4 tiers fora do mapa (`Não informado` 2, `Assessoria antiga` 1, `Implantação` 1, `Marketplace 10X` 1 — 5 clientes): corrigir na central ou mapear.
3. **`Executor`** como propriedade no Notion (auditável no `historico`) ou inferência «responsável não casado = cliente (inferido)» no Prime — e a propriedade «Exibir ao cliente» nos 31 quadros Prime (sem ela, passo interno da trilha não é espelhado).
4. **Fonte da mensalidade**: planilha do CS (rápido, P6) × HAD (certo, precisa chave) × nenhuma por ora (ROI fica «—»).
5. Teto do Prime (`foco.por_produto.prime.max_acoes_por_cliente_semana`): 3 é premissa.
6. **Portal Prime**: reusa o host `sprint90.place2u.com.br` ou ganha `cliente.place2u.com.br`; quem gera o link (consultor ou líder); ou sem portal por ora (Notion basta).
7. **Transcrição**: consentimento no termo do Prime ou por encontro; retenção declarada; Meet/Fireflies via n8n sim/não.
8. **Google Calendar no servidor** (credencial + n8n + LGPD, P8): sim / não / depois.
9. **Trilha curada nº 1** (6–8 passos, canal ML): o conteúdo vem do David e dos consultores; o sistema só data, distribui e mede. Trilha padrão = sugestão do Oráculo + marcação sua (proposto) × automática por veredito.
10. `perfil_informacao.servico`: manter como aviso de divergência (proposto) ou derivar de `produto` e esconder o campo.

## Fase 0 recomendada (o menor passo que já muda a leitura)

**P0 inteira: dois dias, zero teste quebrado, zero Notion.** `src/lib/dimensoes.js` ganha `produtoDeTier`/`produtoDoCliente`; `dimensoesDe` carimba `produto`; `CAMPOS_COMUNS.produto`, `resolverEscopo tipo:'produto'`, `por_produto` + `GRUPOS_DRILL`; `produto_nao_mapeado` em `cadastro:pendencias`. Com isso toda tela que já aceita `?f=` recorta por Performance × Prime, `/resultados` responde «por produto» (hoje «sem amostra», e diz por quê), e a carteira aparece como 116 · 56 · 5. Logo depois, **P2 (dois dias)** responde ao pedido 4 com os 134 encontros que já existem — sem n8n, sem transcrição nova, sem portal.

---

## Construído em 22/10/2026 — jornada Prime (P2 + P3 + parte da P4 + upload da P8), sem credencial externa nem decisão pendente

| Peça | Onde | O que faz (e o que não faz) |
|---|---|---|
| Trilha pré-moldada | `config/trilhas.json` (lista fechada; **proposta do sistema**, `padrao:false`, a validar pelo David — decisão 9) | 1 trilha ML de 8 passos (abertura → diagnóstico 360 → plano P1/P2/P3 → execução guiada → reforço), cada passo com `processo` do Manual (validado contra os 138), `faixa_prazo`, `encontro_gatilho`, `executor`, `check` e `prova.metrica` só da lista medida. Tipos de encontro = `encontros[]` do mesmo arquivo (kickoff · diagnostico · plano · execucao · reforco · alinhamento avulso, que não ancora) — **uma lista só** no lugar das duas do § D.1 |
| Regra `trilha_prime` | `src/lib/trilhas.js` (puro) → `plano-cliente.regras()` | Só Prime. Passo nasce quando o encontro do seu gatilho foi REALIZADO e marcado com o tipo; prazo = data do encontro + `dias` (`apos:'anterior'` encadeia no passo anterior do mesmo encontro). Sem abertura marcada = passo 0 «marcar o encontro de abertura». `alvo = trilha|passo|encontro` → mesmo `idAcao`, regerar não duplica, nova abertura = novos ids (os antigos ficam obsoletos pelo `salvarPlano` de sempre). Consultor «puxa» = aprovar (mesma rota). Performance byte a byte igual (teste) |
| Regra `combinado_ata` | `trilhas.candidatosDaAta` + `descritoresCombinados` | Só Prime, encontros realizados nos últimos 30 d: frases do lado do cliente (`guardiao.compromissosDaAta`, lista fechada de verbos) da transcrição enviada (vence) ou da ata do card; barra telefone/CPF/id interno; não duplica card existente; teto 5; processo só por `acharProcesso` (lista fechada) |
| Card do cliente no Notion | `distribuir-notion.montarPagina` | `dados.executor = 'cliente'` → sem `people`, «Responsável: o cliente · consultor que acompanha: X» na descrição e no bloco «Quem e até quando». Card do time não muda |
| Encontro = card + sidecar | `src/lib/encontros.js` (`encontro_info`, fábrica sem banco/Notion/IA), `src/rotas-encontros.js` | Contagens (previsto · confirmar · realizado · com ata · gravado · com treinado); previsto vencido > 24 h = «confirmar», nunca «faltou»; treinado só ids de `processos-base.json`, `treinadosDaAta` só sugere; gravação sem query. «Registrar encontro» = ação `encontro` (demanda «Reunião de Alinhamento», prazo = data) — prévia não chama o Notion; `confirmar:true` grava aprovada e chama o `distribuir()` de sempre com `dryRun:false`; o plano nunca a torna obsoleta |
| Transcrição | `POST /api/cliente/encontros/:tarefa_id/transcricao` | `.txt` ≤ 500 KB lido no navegador; **consentimento obrigatório** (quem e quando gravados); arquivo em `data/encontros/<cliente>/<sha256>.txt`, só `sha256:` no banco; candidatos vão para a regra `combinado_ata`; IA (`ia.redigir`) só redige o título com `ANTHROPIC_API_KEY`, senão modelo fixo «Combinado na reunião: …» |
| Agenda | `GET /api/agenda?por=consultor|cliente|semana&tipo=…` | Projeção pelo `resolverEscopo`; **Google Calendar / Notion Calendar NÃO ligados ao servidor** — dito na resposta (`calendario.ligado:false`) e na tela |
| O que o cliente não executa | `GET /api/cliente/nao-executa` | Tarefas com executor = cliente (só as nascidas da trilha/combinados — decisão 3 segue aberta, dito na tela): não puxado, aguardando o Notion, no prazo, vencido 14/30 (`faixaDe`), feito no prazo; «treinado e não feito» (30 d); sem feitos = «—», nunca 0 % |
| Quem treina melhor | `GET /api/encontros/quem-treina` | Medida do Merovíngio de tarefa do cliente → crédito ao `treinado_json[].por` mais recente da família no cliente antes da medida, senão consultor da central (rotulado); Wilson, `minN = 8`, n < 8 = «sem prova suficiente» com taxa «—». Sem tela ainda (só API) |
| Telas | `src/web/encontros.js` (`window.PSEncontros`) em `/cliente` | `#secEncontros` no Resumo (depois de `#secAcomp`), `#secTrilha` no topo do Plano, `#secNaoExecuta` em Pelo cliente (depois de `#secDoCliente`) — as três sempre no DOM (VIVOS) e visíveis só no Prime (`painel.produto`); o Resumo do Performance segue com os 6 blocos da F6. Nenhum primário novo (só o Confirmar do diálogo) |
| Testes | `scripts/teste-trilhas.mjs` (6), `scripts/teste-encontros.mjs` (8) | banco em memória, stubs de distribuir/redigir, arquivos em diretório temporário |

**Próximas fases (não construídas):**
1. **Portal do cliente Prime (P7)** — `/c/tarefas`, `/c/etapas`, `/c/agenda`, «fiz» por tabela irmã `portal_conta` (nunca `s90_conta`), decisão 6 (host e quem gera o link).
2. **Google Calendar / Notion Calendar / ICS no servidor (P8)** — tabela `encontro` com 2ª fonte via n8n + HMAC, decisão 8; até lá a agenda é só cards + «Registrar encontro».
3. **Executor nos demais cards (decisão 3)** — propriedade «Executor» no Notion (`mapeamento.json` + `tarefas.executor`) ou inferência rotulada; hoje «o cliente não executa» cobre só trilha/combinados.
4. **Trilha validada (decisão 9)** — David/consultores revisam `config/trilhas.json` e marcam `padrao:true`; famílias `encontro`/`consultoria` em `processos-curadoria.json` (não mexidas: mudariam a família dos cards de reunião que hoje caem em `interna`).
5. **P4/P5 restantes** — «quem treina melhor» em `/analistas?f=produto=prime`, `executor` carimbado na medida (`impacto-tarefas`), `aprender()` por `trilha_id`, `foco.por_produto`, `#secTimeMelhorar`, «marcar feito» pelo consultor em Pelo cliente, linha «tarefas suas concluídas» no plano de terça, linha «Agenda» em Estrutura › Estruturas.
6. **ROI (P6)** — mensalidade pela planilha do CS (decisão 4).
