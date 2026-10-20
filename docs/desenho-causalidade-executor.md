# Desenho: causalidade no Merovíngio + executor do plano ("Chaveiro")

> Pedido do David (08/10/2026): "Preciso que o merovingio consiga Analisar a Causa e Efeito das ações (causalidade) e tb preciso que construa um novo sistema que seja capaz de executar 100% do plano do merovíngio e do arquiteto." Arquiteto = o Algoritmo que gera o plano (`diagnostico-conta.js` + `plano-anuncios.js`); Merovíngio = a retroalimentação que mede e reordena (`impacto-tarefas.js`, `retroalimentacao.js`, `acompanhamento.js`).
>
> Desenho final, 09/10/2026. Nada aqui foi implementado. **Nota de origem:** a pasta de trabalho `scratchpad/desenho-ce/` (mapas, 3 propostas, 2 julgamentos) estava vazia quando este documento foi escrito; o desenho foi construído direto do código e dos documentos vivos do projeto (`CLAUDE.md`, `docs/metodologia-algoritmo.md`, `docs/acompanhamento-e-retroalimentacao.md`, `config/algoritmo.json`, `impacto-tarefas.js`, `ofertas-fluxo.js`, `promocoes-exec.js`). Onde haveria divergência entre propostas, a decisão e o porquê estão na seção 1.

## Resumo executivo (20 linhas)

1. Dois pedidos, uma só espinha: o Chaveiro **executa** o que o Algoritmo decidiu; o Merovíngio **mede** o que o Chaveiro fez. Nenhum motor novo decide nada (CLAUDE.md).
2. "Causalidade" vira uma **escada de evidência** com critérios numéricos: N0 observado → N1 associação ajustada (o que existe hoje) → N2 efeito estimado com controle pareado, confundidores declarados e intervalo → N3 efeito experimental (o Chaveiro sorteia um holdout ao aplicar uma família) → N4 efeito replicado (≥ 3 experimentos no mesmo sentido). O rótulo "causa confirmada" não existe em nenhum degrau.
3. Cada medida passa a dizer: quanto (efeito e intervalo), em que degrau, quais confundidores foram descontados, quais só declarados, quais não medidos, e **o que a invalidaria**.
4. O aprendizado do plano (`fatoresDoPlano`, `priorEfetivo`) passa a pesar a medida pelo degrau: N1 vale 0,5 medida, N2 0,75, N3/N4 1,0. Associação continua entrando; só deixa de mandar sozinha.
5. "Executar 100% do plano" = **toda ação tem caminho declarado** na própria ação (`dados.execucao`): `automatico` (API com aprovação, conferência e reversão), `assistido` (o sistema prepara o valor novo, o humano aplica e marca "fiz"; a leitura diária confirma), `cliente` (vira pendência cobrada pelo alerta) ou `sem_caminho` (declarado, nunca escondido).
6. A tela mostra a **cobertura real**: "N de M ações têm caminho; X automáticas, Y assistidas, Z do cliente, W sem caminho". Nunca 100% fingido.
7. Das 29 regras: 15 têm caminho automático já com adaptador existente (Ofertas, Promoções) ou de uma operação simples no item do ML (preço, frete grátis, reativar); 9 são assistidas (Ads sem API de escrita verificada, pesquisa do consultor, Full físico); 5 dependem do cliente (reposição, custos, moderação, envio físico, decisão).
8. O Chaveiro **reaproveita** os executores que existem: `of_job` (Ofertas) e `promo_plano` (Promoções) seguem sendo a máquina; o Chaveiro só abre ordens que apontam para eles. O único adaptador novo de escrita é `chaveiro-ml.js`, com **lista fechada de 3 operações** no item: `preco`, `frete_gratis`, `status_ativar`. Estoque nunca é escrito (reposição é física).
9. Salvaguardas no molde de `promocoes-exec.js`: chave global `chaveiro_ligado` (nasce desligada) + política por cliente (`exec_politica`, nasce `propor`) + `confirmar === true` + plano/ordem com hash + 1 anúncio por execução na estreia + conferência obrigatória (2xx ≠ feito) + reversão para o snapshot pela regra de parada + catálogo de terceiros e prospect bloqueados.
10. Regra que protege a própria medição: **uma intervenção por anúncio por janela de prova** (14/28 d). O Chaveiro recusa a 2ª ordem no mesmo anúncio até a 1ª ser medida; é isso que faz o N3 existir.
11. Experimento sem custo permanente: desenho **escalonado** — o holdout (≈ 25%, mínimo 1 anúncio) recebe a mesma ação depois da janela. Antes de sortear, o sistema calcula o efeito mínimo detectável; se for > 35% (teto de plausibilidade), declara "experimento não informativo" e não segura ninguém.
12. Autonomia por política, 4 níveis: `observar` → `propor` → `executar_com_aprovacao` → `executar_e_avisar`. Sobe só por liberação do líder, por cliente × adaptador, e só depois de ≥ 10 ordens conferidas sem divergência naquele adaptador.
13. Modelo de dados: 4 tabelas novas (`exec_politica`, `exec_ordem`, `exec_evento`, `exec_experimento`), 1 fonte nova no change-log (`chaveiro`, a migração do CHECK já existe) e 1 chave nova em `sync_estado`. Nenhuma tabela existente muda de forma.
14. Módulos novos: `chaveiro.js` (núcleo puro), `chaveiro-db.js`, `chaveiro-ml.js`, `experimento.js` (puro), `rotas-chaveiro.js`, `web/chaveiro.js`, `config/chaveiro.json`. Edições cirúrgicas em `impacto-tarefas.js`, `retroalimentacao.js`, `calibracao.js`, `plano-anuncios.js`, `aprendizado.js`, `server.js`.
15. Sete fases, cada uma com autoteste próprio e com valor sozinha: F1 caminho declarado + cobertura (só leitura, sem escrita externa); F2 escada N2; F3 Chaveiro assistido + cliente; F4 automático no item do ML (estreia supervisionada, 1 anúncio); F5 experimentos e N3/N4; F6 Ads (só se a API de escrita for verificada); F7 política de autonomia crescente.
16. "Anos-luz à frente do ML" vira métrica, não slogan: a decisão tem de bater (a) não fazer nada — é o N3 — e (b) seguir as sugestões do próprio ML — **não medível hoje** (as sugestões do ML não são coletadas); fica declarado como `NOT_COLLECTED`.
17. Não executável hoje (declarado, seção 10): escrita em Product Ads (endpoint não verificado), Shopee/Amazon/TikTok (sem API), estoque e Full (físicos), catálogo de terceiros, conta sem custos (preço só assistido), clientes com < 4 anúncios elegíveis por regra (sem experimento), `NOTION_TOKEN` ausente.
18. Riscos principais: confundir a própria medição com execuções em lote (mitigado pela regra 10), reversão tardia (conferência a cada tick + parada), e tentação de ler N2 como causa (o texto da tela repete o degrau e o que invalidaria).
19. Nomes: a camada de causalidade continua sendo o **Merovíngio**; o executor é proposto como **Chaveiro** (o Keymaker abre as portas que o Arquiteto desenhou). A escolha do nome é do David e não muda nada do desenho.
20. Cinco perguntas no fim; só as que mudam o desenho (holdout, reversão automática, limite de preço, nível inicial de autonomia, verificação da API de Ads).

---

## 1. Decisões

| # | Decisão | Alternativa descartada | Por quê |
|---|---|---|---|
| D1 | Chaveiro **não decide**: só executa ação com `status = 'aprovada'` em `acoes_plano` e o que a ação já carrega (`dados.acao`, `dados.parada`, `dados.depende_de`, `dados.executar_via`). | Executor com regras próprias de "o que vale a pena executar". | CLAUDE.md: nenhum segundo motor. Prioridade e corte (`fila 'esta_semana'`) são do Algoritmo. |
| D2 | Ofertas e Promoções continuam sendo os executores de conteúdo e de campanha; o Chaveiro abre `of_job` / `promo_plano` e acompanha por `ref_externa`. | Reimplementar PUT de título/galeria/ficha no Chaveiro. | `ofertas-ml.js` já tem payload por grupo, snapshot, conferência, propagação e catálogo; duplicar seria o 2º motor de escrita. |
| D3 | Adaptador novo de escrita só para 3 operações no item: `preco`, `frete_gratis`, `status_ativar`. Estoque, exclusão, categoria e pausa **nunca**. | Escrever `available_quantity` quando o cliente avisa reposição. | Estoque é físico; escrever número que o sistema não vê chegar é fingir. `PROIBIDOS_NO_PAYLOAD` de `ofertas-ml.js` já proíbe `status` e `available_quantity` no fluxo de Ofertas — o Chaveiro só abre exceção para `status: active` (reativar o que o plano diz que foi pausado por engano, com `sub_status` lido antes). |
| D4 | Ads nasce **assistido**. Automático só na F6, depois de 1 chamada real de escrita verificada e documentada. | Assumir que `PUT /advertising/.../product_ads/ads/{id}` funciona. | O projeto nunca escreveu em Product Ads; a leitura diária já mudou de endpoint uma vez. Honestidade: integração sem verificação devolve `pendente`. |
| D5 | Escada de evidência com 5 degraus (N0–N4) e critérios numéricos; rótulo máximo "efeito replicado". | Rótulo "causa confirmada" com p < 0,05. | Pedido explícito do David e do CLAUDE.md; p sozinho não separa causa de coincidência quando o tratamento foi escolhido olhando o anúncio. |
| D6 | O degrau N3 só existe quando **o Chaveiro cria o experimento** (holdout sorteado ou escalonado). Tarefa feita à mão nunca passa de N2. | Chamar de experimental qualquer medida com controle. | Sem sorteio, o controle é o que sobrou — viés de seleção já documentado ("tarefas vão para anúncios que já caíam"). |
| D7 | Holdout **escalonado** (o controle recebe a ação depois da janela), ≈ 25% e mínimo 1, só com efeito mínimo detectável ≤ 35%. | Holdout permanente de 10%. | Cliente não perde a ação, só espera 14 d em parte dos anúncios; MDE evita experimento decorativo. **Depende da pergunta P1.** |
| D8 | Uma intervenção por anúncio por janela de prova. Segunda ordem no mesmo anúncio fica `preparada` com motivo "aguardando medição de CH-…". | Executar tudo que foi aprovado de uma vez. | A atribuição "não separa duas tarefas simultâneas no mesmo anúncio" (metodologia §9). Executar em lote destruiria a medição que o David quer. |
| D9 | Reversão automática **só para o que o próprio Chaveiro aplicou**, de volta ao `snapshot_antes`, quando a regra de parada da ação bate em conferência, e só na política `executar_e_avisar`; nos demais níveis o sistema propõe a reversão como ordem. | Reverter sempre / nunca. | O snapshot é do Chaveiro, então a reversão é exata; para mudança humana o sistema não sabe o "antes" com certeza. **Depende da pergunta P2.** |
| D10 | Preço automático com dois limites: variação por ordem ≤ `preco_max_var_pct` (sugestão 10%) e nunca abaixo do piso de margem (`descontoMaximoPct`); sem custo informado, preço é **assistido**. | Preço livre quando aprovado. | Dinheiro sem premissa declarada não existe no projeto; sem custo não há piso. **Depende da pergunta P3.** |
| D11 | Política nasce `propor` (prepara tudo, nada sai). `executar_com_aprovacao` por liberação do líder; `executar_e_avisar` por cliente × adaptador, só após 10 ordens conferidas sem divergência. | Nascer em `executar_com_aprovacao`. | Mesmo molde de `promo_config.execucao_habilitada` e do agendador de relatórios: nasce desligado. **Depende da pergunta P4.** |
| D12 | Caminho `assistido` fecha pelo card do Notion (status concluída → `feita_pelo_humano`) **e** pela leitura diária (diff no change-log = conferência). Botão "Fiz" na tela é atalho, não requisito. | Botão obrigatório na tela. | O analista já vive no Notion; o sync já traz a conclusão; a prova é o change-log, não o clique. |
| D13 | Caminho `cliente` não ganha mecanismo novo: a ordem vira `pendencia_cliente` registrada (avaliador único) e a cobrança é do alerta existente (`alerta-cliente.js`, cooldown 7 d, interruptor desligado). | Mensageria própria do Chaveiro. | Política de tom e interruptores já desenhados em 08/10; segundo canal de cobrança confundiria o cliente. |
| D14 | Medida experimental grava o desenho (`exec_experimento`), não o efeito: o efeito é recalculado ao vivo por `analisarCliente` como hoje. | Guardar efeito calculado. | Mesmo princípio das medidas atuais (recalculadas a cada leitura, com params do config); evita número congelado com regra velha. |
| D15 | Tela: seção "Execução do plano" no Cliente (aba Resumo, depois de Próximas ações) e coluna "Caminho" na Distribuição. Nenhuma tela nova, nenhum botão primário novo (o botão "Executar o plano" é secundário; a confirmação tem o primário do diálogo). | Tela `/chaveiro`. | Sistema de design: 11 telas, 1 primário por tela; a execução é propriedade do cliente, não um produto à parte. |

Onde dois caminhos eram defensáveis (D7, D9, D10, D11), a decisão está tomada com um padrão conservador **e** está nas perguntas ao David, porque mudar a resposta muda tabela, trava e tela.

---

## 2. Modelo de dados

Tudo em `src/lib/chaveiro-db.js` (`SCHEMA_CHAVEIRO`, importado por `db.js` como os outros schemas; os testes sobem o mesmo DDL em memória). Listas fechadas em `CHECK`. Nenhuma coluna de tabela existente muda.

```sql
CREATE TABLE IF NOT EXISTS exec_politica (              -- autonomia por cliente; nasce 'propor'
  cliente TEXT PRIMARY KEY,
  nivel TEXT NOT NULL DEFAULT 'propor' CHECK (nivel IN ('observar','propor','executar_com_aprovacao','executar_e_avisar')),
  adaptadores_live_json TEXT NOT NULL DEFAULT '{}',    -- {"ml_item":0,"ofertas":0,"promocoes":0,"ads":0}: 1 = pode escrever de verdade
  max_ordens_dia INTEGER NOT NULL DEFAULT 1,           -- estreia supervisionada: 1
  preco_max_var_pct REAL NOT NULL DEFAULT 10,
  liberado_por TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS exec_ordem (                 -- UMA ordem por (ação do plano × anúncio): o que o Chaveiro vai fazer, fez e conferiu
  id TEXT PRIMARY KEY,                                 -- CH-xxxxxxx (sha curto de cliente|acao_id|item|operacao)
  cliente TEXT NOT NULL, acao_id TEXT NOT NULL, regra TEXT NOT NULL, item_id TEXT NOT NULL DEFAULT '',
  caminho TEXT NOT NULL CHECK (caminho IN ('automatico','assistido','cliente','sem_caminho')),
  adaptador TEXT NOT NULL CHECK (adaptador IN ('ml_item','ofertas','promocoes','ads','notion','pendencia','nenhum')),
  operacao TEXT NOT NULL,                              -- lista fechada por adaptador (seção 3.3)
  payload_json TEXT NOT NULL DEFAULT '{}',             -- só campos da lista fechada; valor novo + valor esperado depois
  snapshot_antes_json TEXT NOT NULL DEFAULT '{}',      -- leitura do item ANTES (impressaoItem) — base da conferência e da reversão
  hash TEXT NOT NULL DEFAULT '',                       -- hash(payload + snapshot): aprovado ≠ executado → recusa
  chave_idem TEXT NOT NULL UNIQUE,                     -- cliente|acao_id|item|operacao|versao: nunca duplica
  estado TEXT NOT NULL DEFAULT 'preparada' CHECK (estado IN ('preparada','aguardando_aprovacao','aprovada','na_fila','executando','em_conferencia',
    'executada','divergente','falhou','feita_pelo_humano','aguardando_cliente','revertida','cancelada','obsoleta')),
  ref_externa TEXT NOT NULL DEFAULT '',                -- of_job.id | promo_plano.id | notion_page_id | pendencia_cliente.id
  experimento_id TEXT NOT NULL DEFAULT '', braco TEXT NOT NULL DEFAULT '' CHECK (braco IN ('','tratado','controle')),
  aprovado_por TEXT NOT NULL DEFAULT '', aprovado_em TEXT NOT NULL DEFAULT '',
  executado_em TEXT NOT NULL DEFAULT '', conferir_em TEXT NOT NULL DEFAULT '', conferido_em TEXT NOT NULL DEFAULT '',
  revisar_em TEXT NOT NULL DEFAULT '',                 -- = acao.dados.revisar_em: quando a regra de parada é checada
  resultado_json TEXT NOT NULL DEFAULT '{}',           -- resposta do canal classificada (enviado|incerto|recusado), diff da conferência, motivo
  erro TEXT NOT NULL DEFAULT '',                       -- texto fixo por classe, nunca eco do valor recebido
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_exec_ordem_cliente ON exec_ordem (cliente, estado);
CREATE INDEX IF NOT EXISTS ix_exec_ordem_item ON exec_ordem (cliente, item_id, estado);

CREATE TABLE IF NOT EXISTS exec_evento (                -- auditoria append-only de toda transição
  id INTEGER PRIMARY KEY AUTOINCREMENT, ordem_id TEXT NOT NULL, cliente TEXT NOT NULL,
  de TEXT NOT NULL, para TEXT NOT NULL, por TEXT NOT NULL DEFAULT 'sistema', detalhe_json TEXT NOT NULL DEFAULT '{}', em TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS exec_experimento (           -- o DESENHO do experimento (quem é tratado, quem espera); o efeito é recalculado ao vivo
  id TEXT PRIMARY KEY, cliente TEXT NOT NULL, regra TEXT NOT NULL, familia TEXT NOT NULL,
  desenho TEXT NOT NULL CHECK (desenho IN ('escalonado','holdout')),
  semente INTEGER NOT NULL,                            -- sorteio reproduzível (xorshift com a semente) — auditável
  unidades_json TEXT NOT NULL,                         -- [{item_id, braco, ordem_id}]
  mde_pct REAL,                                        -- efeito mínimo detectável declarado ANTES do sorteio
  inicio TEXT NOT NULL, fim_previsto TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','medido','nao_informativo','cancelado')),
  resultado_json TEXT NOT NULL DEFAULT '{}', criado_em TEXT NOT NULL);
```

Ampliações em tabelas existentes (sem `ALTER`):
- `meli_item_mudanca.fonte` ganha `'chaveiro'` no CHECK de `SCHEMA_MUDANCA` (`acomp-schema.js`); `migrarMudanca` já recria a tabela sozinha quando a lista difere. A mudança aplicada pelo Chaveiro entra no change-log na hora da conferência (`de` = snapshot, `para` = lido no canal), então Folha, cartão, cronologia e Merovíngio veem a intervenção sem código novo.
- `sync_estado`: chave `chaveiro_ligado` (`'0'` enquanto nunca gravada = desligado), igual a `relatorio_agendador` e `alerta_auto`.
- `acoes_plano.dados_json` ganha `execucao` (seção 3.4) — campo dentro do JSON, como `parada` e `executar_via`; ações antigas só o recebem na próxima geração (regra já documentada em metodologia §7.7).
- Saída de `analisarCliente` (não persistida) ganha `evidencia` por medida (seção 4.4).

---

## 3. Módulos e edições por arquivo (assinaturas)

### 3.1 Novos

**`src/lib/chaveiro.js`** — núcleo puro, sem banco e sem rede (testável com objetos).
```js
export const CAMINHOS = ['automatico','assistido','cliente','sem_caminho']
export const OPERACOES = { ml_item: ['preco','frete_gratis','status_ativar'], ofertas: ['job'], promocoes: ['plano'], ads: ['verba','pausar_anuncio'], notion: ['card'], pendencia: ['registrar'], nenhum: [] }
export const ESTADOS_ORDEM = { preparada: {...}, aguardando_aprovacao: {...}, /* rótulo, ação, responsável, exige_motivo — molde de ofertas.ESTADOS */ }
export const TRANSICOES = { preparada: ['aguardando_aprovacao','obsoleta','cancelada'], aguardando_aprovacao: ['aprovada','cancelada','obsoleta'], aprovada: ['na_fila','feita_pelo_humano','aguardando_cliente','cancelada','obsoleta'],
  na_fila: ['executando','cancelada'], executando: ['em_conferencia','falhou'], em_conferencia: ['executada','divergente','falhou'], executada: ['revertida'], divergente: ['em_conferencia','cancelada','revertida'],
  falhou: ['na_fila','cancelada'], feita_pelo_humano: ['executada','divergente'], aguardando_cliente: ['feita_pelo_humano','cancelada','obsoleta'], revertida: [], cancelada: [], obsoleta: [] }

// caminho da ação: lê a ação (regra, dados.causas_possiveis, dados.executar_via, catálogo, custos) e a config → { caminho, adaptador, operacao, motivo, pendencias[] }
export function classificarCaminho(acao, { item = null, custosInformados = false, catalogoOrigem = 'nao', politica = null, cfg = CFG } = {})
// ordens de UMA ação: 1 por anúncio (ação de conta = 1 ordem sem item); payload com lista fechada; chave_idem; hash
export function montarOrdens(acao, { itens = [], snapshotDe = id => null, hoje, cfg = CFG } = {})
// as travas (puras): chave global, política, confirmar === true, hash íntegro, janela de prova livre no anúncio, teto diário, catálogo, prospect, limites de preço
export function verificarTravas({ ordem, politica, ligado, confirmar, ordensAbertasNoItem = [], executadasHoje = 0, custos = null, catalogoOrigem = 'nao', agoraMs = Date.now() }) // → { liberado, motivos[] }
// conferência: lido no canal × esperado no payload → { ok, diff[], classe: 'confere'|'divergente'|'nao_aplicado' }
export function conferir(payload, snapshotAntes, lidoDepois)
// regra de parada da ação (dados.parada) contra a série pós: → { parar: bool, motivo, metrica, valor, baseline }
export function avaliarParada(acao, { serie, baseline, hoje })
// cobertura: → { total, com_caminho, por_caminho: {automatico, assistido, cliente, sem_caminho}, por_estado, pct_com_caminho }
export function cobertura(ordens)
```

**`src/lib/chaveiro-db.js`** — DDL + repositório (`criarChaveiroDb(handle)`): `gravarOrdem`, `transicionar(ordemId, para, por, detalhe)` (valida `TRANSICOES`, grava `exec_evento` na mesma transação), `ordensDe(cliente, filtros)`, `abertasNoItem(cliente, item_id)`, `executadasHoje(cliente, dia)`, `politica(cliente)`, `gravarPolitica(...)`, `ligado()`/`ligar(por)`/`desligar(por)` em `sync_estado`, `registrarMudanca(ordem, lido)` → `historico`/`meli_item_mudanca` fonte `chaveiro`.

**`src/lib/chaveiro-ml.js`** — único adaptador novo com escrita, molde de `promocoes-exec.js` (a API real é injetável; os testes usam stub).
```js
export const CAMPOS_ESCRITA = { preco: ['price'] /* ou variations[].price com irmãs listadas por id */, frete_gratis: ['shipping.free_shipping'], status_ativar: ['status'] }   // nada fora disto sai no corpo
export function montarPayloadItem(operacao, valor, item)         // puro; reaproveita a lógica de variações de ofertas-ml.montarPayloads para preço
export function criarAdaptadorItem({ fetch, tokenValido, agora, espera = 1500 })
//   .ler(cliente, item_id)                → impressão (ofertas-ml.impressaoItem) — snapshot antes e leitura de conferência
//   .aplicar(cliente, ordem)              → { status, classe: classificarResposta(status), corpo_resumido } — 1 PUT por ordem, timeout 30 s, nunca reenvia na janela de propagação (ESPERA_PROPAGACAO_MIN = 30)
//   .reverter(cliente, ordem)             → mesmo PUT com os valores do snapshot_antes
export async function adaptadorItemPronto()                      // com credenciais reais; `pendente` sem elas
```

**`src/lib/experimento.js`** — puro.
```js
export function mde({ uTratPre, uCtrlPre, dias, z = 1.64 })      // efeito mínimo detectável (log-razão → %) para contagens: SE ≈ √(1/uT_pre + 1/uT_pos + 1/uC_pre + 1/uC_pos), superdispersão como em impacto-tarefas
export function sortear({ unidades, fracaoControle = 0.25, minControle = 1, semente })  // xorshift reproduzível → [{item_id, braco}]
export function desenhar({ cliente, regra, familia, unidades, series, hoje, janelaDias, cfg })  // → { desenho:'escalonado', unidades, mde_pct, informativo: mde ≤ cfg.mde_max_pct, motivo }
export function estimarExperimental({ tratados, controles, data, N, lag, cobertura, hoje, params })   // DiD com controle = braço controle; p por permutação dos braços (≥ 20 permutações distintas; senão null, declarado); intervalo (seção 4.3)
export function replicar(medidasN3)                                // ≥ 3 experimentos mesma família × contexto, mesmo sinal, intervalo conjunto (1/var) excluindo 0 → N4
```

**`src/rotas-chaveiro.js`** (`rotasChaveiro`, montado em `server.js` como `rotasOfertas`): ver seção 6.2.

**`src/web/chaveiro.js`** — seção `#secChaveiro` no Cliente e coluna "Caminho" em `/planos`; ids de hooks: `#chvVeredito`, `#chvTabela`, `#chvExecutar`, `#chvPolitica`. Sem token novo em `ui.css` (ponto de estado + palavra, como o resto).

**`config/chaveiro.json`** — `caminho_por_regra` (seção 5), `operacao_por_causa` (para as regras de queda), `preco_max_var_pct_padrao: 10`, `max_ordens_dia_padrao: 1`, `espera_conferencia_min: 30`, `janela_prova_padrao_dias: 14`, `experimento: { fracao_controle: 0.25, min_controle: 1, min_unidades: 4, mde_max_pct: 35, min_permutacoes: 20 }`, `evidencia: { pesos: { N0: 0, N1: 0.5, N2: 0.75, N3: 1, N4: 1 }, n2: { k_pares: 5, p_max: 0.10 }, n3: { p_max: 0.10 }, n4: { min_experimentos: 3 } }`, `autonomia: { ordens_conferidas_para_subir: 10 }`, textos fixos de motivo.

### 3.2 Edições

| Arquivo | Edição | Assinatura / ponto |
|---|---|---|
| `src/lib/impacto-tarefas.js` | `parearControle` (N2) e `nivelEvidencia` (puros); `analisarCliente` passa a devolver `evidencia` por medida e a usar o braço do experimento quando a tarefa veio de uma ordem com `experimento_id` | `export function parearControle({ alvo, candidatos, k = 5, chaves = ['curva','categoria','visitas_pre','conv_pre'] })` → `{ ids, pesos, qualidade }`; `export function nivelEvidencia(m, { experimento = null, cfg })` → `{ nivel, rotulo, criterios, intervalo, confundidores, invalida_se }` |
| `src/lib/retroalimentacao.js` | `aprender(medidas)` e `fatoresDoPlano` pesam cada medida por `cfg.evidencia.pesos[nivel]` (n efetivo = Σ pesos; Wilson sobre o n efetivo arredondado); texto do veredito cita o degrau predominante | `aprender(medidas, { pesos = cfgChaveiro.evidencia.pesos })` |
| `src/lib/calibracao.js` | `priorEfetivo` usa o mesmo n efetivo | sem mudança de assinatura |
| `src/lib/plano-anuncios.js` | `construirAcao` grava `dados.execucao = classificarCaminho(...)` (caminho, adaptador, operação, motivo, pendências); `salvarAcoesAnuncio` marca `obsoleta` a ordem cuja ação ficou obsoleta | 1 chamada em `construirAcao`; 1 UPDATE em `salvarAcoesAnuncio` |
| `src/lib/aprendizado.js` | `medirResultados`: ação com ordem `executada` conta como concluída na data da conferência (não espera o card); ordem `aguardando_cliente` entra em `aguardando_cliente` | sem mudança de assinatura |
| `src/lib/acompanhamento.js` | `vereditoCartao` mostra o degrau e o intervalo; `capturarAcompanhamento` fotografa o anúncio na conferência da ordem (fase `antes` = snapshot do Chaveiro) | `vereditoCartao(c)` lê `c.medida.evidencia` |
| `src/lib/distribuir-notion.js` | card de ação `assistido` ganha bloco "Preparado pelo sistema: {campo} {antes} → {depois}; ao aplicar, marque Concluída" | texto no `montarCard` existente |
| `src/lib/pendencias-cliente.js` | ordem `cliente` chama `registrar` do avaliador único com tipo do catálogo (`config/dependencias-cliente.json`) | reutiliza `criarPendencias(...).registrar` |
| `src/server.js` | `setInterval(() => chaveiro.tick(), 10 min)` (sai sozinho se `chaveiro_ligado` ≠ 1); `app.use(rotasChaveiro)`; `gerarPlanoConta` continua sendo quem cria ações — o tick só prepara ordens para ações `aprovada` sem ordem | 3 linhas |
| `src/lib/db.js` | importa `SCHEMA_CHAVEIRO` | 1 linha |
| `src/lib/acomp-schema.js` | `'chaveiro'` na lista de `fonte` | 1 token |
| `docs/metodologia-algoritmo.md`, `CLAUDE.md` | seção "Causalidade e execução" apontando para este desenho | texto |

Nunca tocados: `src/web/alerta.js`, `src/lib/notion.js`, `notion-publicar.js`, `publicar-notion.mjs`.

### 3.3 Operações por adaptador (lista fechada)

| Adaptador | Operação | O que sai | Conferência |
|---|---|---|---|
| `ml_item` | `preco` | `PUT /items/{id} {price}` ou `{variations:[{id, price}, {id}…]}` (irmãs preservadas) | releitura após 30 min: `price` lido = esperado (±0,01) |
| `ml_item` | `frete_gratis` | `PUT /items/{id} {shipping:{free_shipping:true}}` — **endpoint a confirmar com 1 chamada supervisionada** (campo é lido hoje em `meli-serie.js`) | `shipping.free_shipping === true` |
| `ml_item` | `status_ativar` | `PUT /items/{id} {status:'active'}` só quando `sub_status` lido não contém moderação | `status === 'active'` |
| `ofertas` | `job` | `POST /api/ofertas/jobs { acao_id }` (já existe) | estado do `of_job` ≥ `publicado_confirmado` |
| `promocoes` | `plano` | dry-run → aprovação → `executarPlano` (já existe) | `promo_plano.estado === 'executado'` + prova |
| `ads` | `verba`, `pausar_anuncio` | **nenhum até a F6**; ordem nasce `assistido` com o valor preparado | `meli_ads_dia` do dia seguinte: custo/status mudou na direção pedida |
| `notion` | `card` | `distribuir([acao], { dryRun:false })` (já existe) | card concluído **e** diff no change-log quando o campo é observável |
| `pendencia` | `registrar` | registro no avaliador único + alerta existente | pendência resolvida pelo avaliador (estoque voltou, custo cadastrado, conta reconectada) |

### 3.4 Forma de `dados.execucao` na ação

```json
{ "caminho": "automatico", "adaptador": "ml_item", "operacao": "preco", "motivo": "regra preco_mudou_vendas_cairam: uma mudança de preço; custos informados; catálogo: não",
  "pendencias": [], "valor_novo": 149.9, "valor_antes": 159.9, "janela_prova_dias": 14, "experimento_elegivel": true }
```
Sem caminho: `{ "caminho": "sem_caminho", "adaptador": "nenhum", "operacao": "", "motivo": "canal Shopee sem API: tarefa no Notion, não mensurável", "pendencias": ["API do canal"] }`. O texto do motivo vem de `config/chaveiro.json`, nunca do dado do cliente.

---

## 4. Escada de evidência e estimadores

### 4.1 Degraus e critérios (todos numéricos; o nível é o maior cujos critérios todos passam)

| Degrau | Rótulo na tela | Critérios |
|---|---|---|
| N0 | Variação observada | há antes × depois do alvo; sem controle ou sem volume mínimo (`min_unidades_base` 5 / `min_visitas_base` 30) |
| N1 | Associação ajustada (hoje) | controle da conta (`razão ≥ 0,1`, volume ≥ `min_unidades_controle` 10), `p_placebo ≤ 0,10` com ≥ 9 janelas **ou** `|z| ≥ 1,96`; cobertura da janela sem lacuna |
| N2 | Efeito estimado com controle pareado | N1 **e** controle pareado (`parearControle`, k = 5, qualidade ≥ 0,6) **e** intervalo (4.3) que exclui 0 **e** todos os confundidores da lista 4.4 com status `descontado` ou `declarado` (nenhum `nao_medido` entre preço, estado, outra tarefa, calendário, reversão) **e** `excluirDaAprendizagem === false` |
| N3 | Efeito experimental | a tarefa nasceu de `exec_ordem` com `experimento_id`; braços sorteados (semente gravada) antes da execução; `mde_pct ≤ 35`; nenhuma outra ordem nas unidades na janela (garantido por D8); `p_perm ≤ 0,10` (≥ 20 permutações) e intervalo que exclui 0; cobertura completa |
| N4 | Efeito replicado | ≥ 3 experimentos N3 da mesma família × contexto (estado da conta e nicho), mesmo sinal, intervalo conjunto (ponderado por 1/var) que exclui 0 |

"Causa confirmada" não aparece como rótulo, campo nem texto. Cada degrau carrega `invalida_se[]` (ex.: "se a janela pós tiver lacuna de coleta", "se outro anúncio do alvo mudar de preço ≥ 3%", "se o controle receber a ação antes do fim da janela").

### 4.2 Estimadores

- **Efeito pontual (N1–N3):** diferença-em-diferenças multiplicativa já existente: `efeito = (pós_alvo/pré_alvo) ÷ (pós_controle/pré_controle)`, em log. No N2 o controle é a média ponderada dos pares; no N3 é o braço controle somado.
- **Controle pareado (N2):** `parearControle` escolhe, entre anúncios da conta não tocados na janela e sem evento de preço/estado, os k mais próximos por distância normalizada em (curva ABC, `category_id`, visitas pré/dia, conversão pré); pesos ∝ 1/(1+d). `qualidade` = 1 − distância média normalizada; < 0,6 → fica N1 com motivo "sem par bom".
- **Ruído:** placebo em datas falsas (existente) no N1/N2; **permutação de braços** no N3 (troca quem é tratado/controle, recalcula o efeito; p = (1 + nº ≥ |efeito|) ÷ (n + 1)).
- **Replicação (N4):** média ponderada de log-efeitos por 1/var; var do experimento = SE² de contagem com superdispersão (a mesma de `confiancaEfeito`).

### 4.3 Intervalo

- N1/N2: percentis 10/90 da distribuição de placebos em log, deslocada para o efeito (intervalo empírico); sem 9 placebos, `efeito ± 1,64·SE` com SE de contagem (declarado "intervalo por aproximação").
- N3: percentis 10/90 da distribuição de permutação; sem 20 permutações (ex.: 2 tratados × 1 controle), intervalo `null` e nível cai para N2 com motivo "poucas unidades para permutar".
- Sempre em %, 1 casa; nunca "0 %" para valor ≠ 0 (`pctTxt`).

### 4.4 Confundidores (lista fechada; cada um com status)

| Confundidor | Como é tratado | Status possível |
|---|---|---|
| preço do alvo (`marcarPreco`) | fora do aprendizado se ≥ 3% em tarefa que não é de preço | descontado (tarefa de preço) / declarado (< 3%) / nao_medido (sem série de preço) |
| estado do anúncio (`marcarEstado`: promoção, Ads, Full, estoque zero, status) | idem, exceto o campo que é a própria intervenção | descontado / declarado / nao_medido |
| outra tarefa no mesmo alvo e janela | `concorrentes` > 0 → declarado; no N3 é impossível por D8 | descontado (N3) / declarado |
| calendário comercial (`eventos`) | declarado com o nome da data | declarado / descontado (controle na mesma data) |
| reversão à média (`reversao_provavel`) | fora do aprendizado | descontado / declarado |
| mercado/sazonal | descontado pelo controle (razão de controle) | descontado / nao_medido (sem controle) |
| ranking do ML | **nunca medido** (impressões orgânicas `NOT_AVAILABLE`) | nao_medido — sempre declarado no texto |

### 4.5 Como entra no plano

- `fatoresDoPlano`: a taxa de melhora por família × estado usa `n_efetivo = Σ peso(nivel)`; abaixo de `min_n_aprendizado` (8) continua neutro. Uma família só com N0/N1 precisa de 16 medidas para o mesmo peso que 8 medidas N3 — é a tradução numérica de "associação ≠ causalidade".
- `priorEfetivo`: mesmo n efetivo no encolhimento `p = (k + 5·p₀)/(n + 5)`.
- Texto na tela: "Funciona (N3: 2 experimentos; efeito +12% [+4%, +21%])" ou "Sem resultado mensurável (N1: 9 associações; nenhum experimento ainda)".

---

## 5. Matriz de cobertura das 29 regras

Caminho de **hoje** (com o que existe + F3/F4) e teto futuro. "Aprov." = aprovação exigida antes de qualquer escrita (sempre sim no automático; a política só decide quem aprova).

| Regra | Caminho hoje | Adaptador · operação | Conferência / prova | Reversão | Experimento |
|---|---|---|---|---|---|
| ima_conversao | automatico (catálogo: assistido) | ofertas · job `oferta_completa` | of_job conferido; conversão 14 d | job de restauração (snapshot do job) | sim (≥ 4 anúncios) |
| catalogo_buybox | automatico | ml_item · preco (price_to_win, dentro do piso) | preço lido; unidades 14 d | preço do snapshot | sim |
| estoque_ruptura | cliente | pendencia · registrar (reposição) | estoque voltou (coleta) | — | não (risco) |
| full_envio | cliente (sistema prepara a quantidade) | pendencia · registrar (envio ao Full) | `logistica = fulfillment` no change-log | — | não |
| ads_entrar | assistido (F6: automatico) | ads · verba (valor preparado) | `meli_ads_dia` do dia seguinte | voltar verba (assistido) | sim na F6 |
| ads_escalar | assistido (F6) | ads · verba | custo ↑ na direção pedida; ROAS 14 d | voltar verba | sim na F6 |
| ads_reduzir | assistido (F6) | ads · verba | custo ↓; vendas orgânicas | voltar verba | não (risco) |
| ads_otimizar_antes | automatico | ofertas · job `oferta_completa` | of_job; conversão | job de restauração | sim |
| conteudo_fotos | automatico (terceiros: bloqueada) | ofertas · job `galeria` | of_job; conversão/CTR | galeria anterior (job) | sim |
| frete_gratis | automatico (sem custo: assistido) | ml_item · frete_gratis | `free_shipping` lido; conversão | `free_shipping:false` | sim |
| sazonal | assistido (título) + automatico (promoção) | notion · card / promocoes · plano | unidades na janela | sair da campanha **nunca** (regra das promoções) | não |
| urgencia_oculta | assistido (pesquisa do consultor) | notion · card → depois ofertas · job (kit) | visitas/vendas do kit | — | não |
| promocao_giro | automatico | promocoes · plano | prova da campanha (`avaliarProva`) | não sai de campanha | não |
| cadastrar_custos | cliente | pendencia · registrar (custos) | `custos_cliente` preenchido | — | não |
| duplicacao_estrategica | automatico após briefing | ofertas · job `lancar` (duplicacao) | família medida (`medirFamilia`) | pausar duplicata (assistido) | não (família) |
| oferta_galeria | automatico | ofertas · job | of_job; conversão | job | sim |
| oferta_titulo_descricao | automatico | ofertas · job | of_job; visitas/dia | job | sim |
| oferta_completa | automatico | ofertas · job | of_job; conversão | job | sim |
| oferta_ficha | automatico | ofertas · job | of_job; visitas/dia | job | sim |
| oferta_preco | automatico | ofertas · job (escopo preco) | of_job; margem | job | sim |
| oferta_cadastro | automatico | ofertas · job (criar) | anúncio criado; 1ª venda 28 d | pausar (assistido) | não (lançamento) |
| preco_mudou_vendas_cairam | automatico | ml_item · preco (voltar/ajustar) | preço lido; unidades vs sem mudança | preço do snapshot | sim |
| queda_conversao_anuncio | por causa: preco → automatico; conteudo → ofertas; disponibilidade → cliente; catalogo → preco; mercado → assistido (observar) | `operacao_por_causa` | conversão 14 d | conforme operação | sim (preço/conteúdo) |
| queda_exposicao_anuncio | por causa: ads_desligou → assistido; preco_subiu → automatico; conteudo → ofertas; sazonal → assistido | `operacao_por_causa` | visitas/dia | conforme operação | sim (preço/conteúdo) |
| queda_ctr_ads | automatico (terceiros: bloqueada) | ofertas · job `galeria` (capa) | CTR de Ads | job | sim |
| margem_negativa | preco_abaixo_do_custo → automatico; ads_consome → assistido (Ads) | ml_item · preco / ads · verba | margem estimada | preço do snapshot | não (risco) |
| ads_abaixo_meta | assistido (F6) | ads · verba | ACOS/ROAS vs meta | voltar verba | não |
| concentracao_receita | assistido (decisão do consultor) | notion · card | participação do nº 1 | — | não |
| anuncio_restrito | pausa → automatico; moderação → cliente | ml_item · status_ativar / pendencia | `status = active`; unidades | — | não |

Contagem (caminho de hoje, F3+F4): **automático 15** (incluindo as condicionais no caso mais comum), **assistido 9**, **cliente 5**; nenhuma `sem_caminho` no Mercado Livre. Em Shopee/Amazon/TikTok toda ação é `assistido` via card (sem API, sem medição) — a cobertura por cliente mostra isso. Catálogo de terceiros rebaixa conteúdo para "sem caminho de conteúdo" com o texto fixo de `config/algoritmo.json → catalogo`.

A cobertura que a tela mostra é calculada por `chaveiro.cobertura(ordens)` sobre as ações do plano do cliente, nunca sobre esta tabela.

---

## 6. Fluxo "executar o plano inteiro"

### 6.1 Passo a passo

1. **Geração** (já existe): coleta 4–6 h → `gerarPlanoConta` → ações com `dados.execucao` (F1). Nada do Chaveiro roda aqui além de classificar.
2. **Aprovação do plano** (já existe): líder/consultor aprova as ações do foco (`/planos`, `/cliente`); no Sprint 90 o cliente aprova no painel. Sem `aprovada`, o Chaveiro não vê a ação.
3. **Preparar** — `POST /api/chaveiro/preparar { cliente }`: para cada ação `aprovada` sem ordem, `montarOrdens` lê o snapshot (`ml_item` em cache; para `ml_item` relê o item ao vivo só quando a política permite escrita), grava `exec_ordem` em `preparada`, aplica D8 (2ª ordem no mesmo anúncio fica `preparada` com motivo), e, quando a regra é `experimento_elegivel` e há ≥ 4 unidades, chama `experimento.desenhar`: se informativo, sorteia e grava `exec_experimento`; as unidades `controle` ficam `preparada` com `conferir_em = fim_previsto`. Devolve a **prévia**: tabela por caminho, cobertura, MDE de cada experimento, o que ficou travado e por quê. Nada sai para fora.
4. **Aprovar ordens** — `POST /api/chaveiro/aprovar { cliente, ordens:[], por }`: só líder/consultor (`equipe.lideresEConsultores`); grava `aprovado_por/em`, hash. Ordem `assistido` vai direto para `distribuir` (card com o valor preparado) e fica `aprovada` aguardando o humano; `cliente` registra a pendência e fica `aguardando_cliente`.
5. **Executar** — `POST /api/chaveiro/executar { cliente, confirmar:true, por }`: `verificarTravas` em cada ordem `automatico` aprovada; as liberadas vão para `na_fila`; as demais ficam com `motivos[]` visíveis. **Nada é enviado nesta chamada.**
6. **Tick** (`chaveiro.tick()`, 10 min, só com `chaveiro_ligado = 1`): pega até `max_ordens_dia` ordens `na_fila` por cliente, relê as travas (claim atômico `UPDATE … WHERE estado='na_fila'`), relê o item ao vivo e compara com o snapshot (mudou → `divergente` sem enviar, molde `conflito_externo`), envia 1 chamada, classifica (`enviado|incerto|recusado`), grava resultado parcial **antes** de seguir, e marca `em_conferencia` com `conferir_em = +30 min`. Ofertas/Promoções: o tick só abre o job/plano e acompanha `ref_externa`.
7. **Conferir** (mesmo tick): ordens `em_conferencia` vencidas → releitura → `conferir(payload, snapshot, lido)` → `executada` (grava `meli_item_mudanca` fonte `chaveiro`, fotografia `antes` em `tarefa_acomp`, notifica "aplicado e conferido") ou `divergente` (notifica com nível `alerta`). `incerto` sem confirmação em 3 conferências → `falhou` com texto fixo "o canal não confirmou: conferir no painel".
8. **Assistido fecha** pelo sync do Notion (card `concluida` → `feita_pelo_humano`) e pela coleta (diff no change-log no campo esperado → `executada`; sem diff em 3 dias → `divergente`: "marcado como feito, mudança não vista").
9. **Medir** (já existe): `analisarCliente` mede a ação pelo vínculo `plano`; com `experimento_id`, usa o braço controle e sobe ao N3. `medirResultados` registra o aprendizado.
10. **Parada e reversão** (tick, a partir de `revisar_em`): `avaliarParada(acao, série pós)`; bateu → política `executar_e_avisar`: `reverter` para o snapshot, `revertida`, aviso; demais níveis: ordem nova `preparada` "Reverter CH-…" aguardando aprovação.
11. **Escalonado**: no `fim_previsto` do experimento, as unidades `controle` passam a `aguardando_aprovacao` com o valor recalculado (o plano pode ter mudado); o experimento fica `medido`.
12. **Retroalimentar** (já existe): `retroalimentar()` lê as medidas com `evidencia` e devolve os fatores ao plano seguinte.

### 6.2 Rotas (`src/rotas-chaveiro.js`)

| Rota | Faz | Guarda |
|---|---|---|
| `GET /api/chaveiro/ordens?cliente=&estado=&pagina=` | lista + cobertura + política + experimentos | isolamento por cliente; prospect → 400 |
| `POST /api/chaveiro/preparar` | passo 3 (prévia) | JSON, `cliente` obrigatório |
| `POST /api/chaveiro/aprovar` | passo 4 | `por` líder/consultor; ids validados por lista |
| `POST /api/chaveiro/executar` | passo 5 | `confirmar === true`; política ≥ `executar_com_aprovacao`; chave global |
| `POST /api/chaveiro/fiz` | `{ ordem_id, por }` → `feita_pelo_humano` | só ordem `assistido` do cliente |
| `POST /api/chaveiro/reverter` | `{ ordem_id, confirmar:true, por }` | só `executada` com snapshot; líder |
| `POST /api/chaveiro/politica` | nível, adaptadores live, teto diário, variação de preço | líder; sobe de nível só com `ordens_conferidas_para_subir` |
| `POST /api/chaveiro/chave` | `{ ligado: true|false, por }` em `sync_estado` | líder; nasce desligada |

Mensagens de erro são textos fixos; nenhuma ecoa valor recebido.

### 6.3 Tela

- **Cliente › Resumo › "Execução do plano"** (`#secChaveiro`, depois de "Próximas ações"): frase-veredito ("7 de 9 ações têm caminho · 4 automáticas · 2 assistidas · 1 do cliente · 2 sem caminho (Shopee)"), ≤ 4 números, tabela ≤ 6 colunas (Ação · Caminho · Estado · Quando · Prova · Degrau), botão secundário "Executar o plano" (abre prévia; o diálogo tem o primário "Confirmar"), menu "⋯" com Política, Chave e Histórico. Ponto de estado + palavra; KPI sem cor.
- **Distribuição (`/planos`)**: coluna "Caminho" na tabela de ações (troca uma coluna existente de menor uso para manter ≤ 6; decisão na F1 pela tela real).
- **O que funciona (`/resultados`)**: coluna "Degrau" no drill de tarefas (`GET /api/resultados/tarefas` já devolve a medida; só expõe `evidencia.nivel`).
- Relatório ao cliente (`relatorio-brief.js`): nada muda de forma; `relatorio-seguro.js` ganha o código "degrau sem texto" para impedir "N3" cru no texto do cliente (sai "medido com grupo de comparação sorteado").

---

## 7. Salvaguardas

1. **Chave global** `chaveiro_ligado` nasce desligada; o tick sai no 1º `if`.
2. **Política por cliente** nasce `propor`; `adaptadores_live_json` nasce tudo 0 — igual a `promo_config.execucao_habilitada` e a `publicacao_live` das Ofertas.
3. **`confirmar === true`** estrito em executar e reverter (qualquer outro valor é recusado — `verificarTravas`).
4. **Hash** da ordem (payload + snapshot) conferido antes de cada envio; aprovado ≠ enviado → recusa.
5. **Lista fechada de campos** por operação (`CAMPOS_ESCRITA`); corpo montado só a partir dela; `PROIBIDOS_NO_PAYLOAD` reaproveitado.
6. **Uma intervenção por anúncio por janela de prova** (D8) — protege a medição e impede lote.
7. **Teto diário** por cliente (`max_ordens_dia`, estreia 1) e **1 chamada de escrita por ordem**; sem reenvio na janela de propagação (30 min); `incerto` nunca vira "feito".
8. **Snapshot ao vivo antes de enviar**; divergência com o cache → não envia (`divergente`).
9. **Conferência obrigatória** por releitura; `2xx ≠ feito` (lição das promoções).
10. **Reversão** só para o snapshot do próprio Chaveiro; nunca "desfazer" mudança humana.
11. **Preço**: ≤ `preco_max_var_pct` por ordem e ≥ piso de margem; sem custo → assistido. Estoque, exclusão, pausa, categoria, tipo de anúncio: nunca.
12. **Catálogo** de terceiros: nenhuma operação de conteúdo (predicado `origemCatalogo`); próprio: só preço/frete/status.
13. **Prospect `[Comercial]`** e cliente sem conta conectada: nenhuma ordem nasce.
14. **Isolamento**: toda consulta por `cliente`; ordem de outro cliente → 409 (molde `verificarTravas` das promoções).
15. **Auditoria** append-only (`exec_evento`) com `por`; nada de token ou valor sensível.
16. **Autonomia sobe por evidência**, nunca por tempo: 10 ordens conferidas sem divergência no adaptador.
17. **Textos** ao cliente passam por `relatorio-seguro.js`; o Chaveiro nunca escreve no Notion do cliente — só o alerta e o relatório existentes.
18. **Testes nunca usam a API real** (stub injetado) nem `data/db.sqlite` (banco em memória com o mesmo DDL).

---

## 8. Fases e testes

| Fase | Entrega | Escrita externa | Teste (`scripts/`) |
|---|---|---|---|
| F0 | este desenho; decisões das perguntas | nenhuma | — |
| F1 | `dados.execucao` em toda ação; `chaveiro.cobertura`; seção na tela e coluna em `/planos`; `config/chaveiro.json` | nenhuma | `teste-chaveiro-nucleo.mjs` (classificarCaminho para as 29 regras × catálogo × custos; cobertura), `teste-plano-anuncios.mjs` (bloco novo), `teste-shell-ui.mjs` |
| F2 | escada N0–N2: `parearControle`, `nivelEvidencia`, intervalo, confundidores com status; pesos no aprendizado | nenhuma | `teste-impacto.mjs` (casos N0/N1/N2, par ruim → N1, intervalo que inclui 0 → N1), `teste-retroalimentacao.mjs` (n efetivo), `teste-aprendizado.mjs` |
| F3 | Chaveiro-db, estados, preparar/aprovar, caminhos `assistido` (card + conferência por change-log) e `cliente` (pendência); tick só de conferência | só Notion (já existe, dry-run por padrão) | `teste-chaveiro-db.mjs` (transições inválidas, idempotência, auditoria), `teste-chaveiro-rotas.mjs` (isolamento, 400 fixos, líder), `teste-dependencia-cliente.mjs` (consumidor) |
| F4 | `chaveiro-ml.js` (preco, frete_gratis, status_ativar), travas, fila, conferência, reversão; estreia supervisionada com 1 anúncio de 1 cliente, chave e política abertas pelo David | ML (item) | `teste-chaveiro-ml.mjs` com stub (payload fechado, 2xx≠feito, incerto, divergente, reversão exata, hash), `teste-chaveiro-travas.mjs` |
| F5 | `experimento.js`: MDE, sorteio, escalonado, estimador por permutação, N3/N4; `analisarCliente` com braços | nenhuma nova | `teste-experimento.mjs` (semente reproduzível, MDE > 35 → não informativo, permutação p, N4 com 3), `teste-impacto.mjs` (N3) |
| F6 | Ads: 1 chamada real supervisionada de escrita; se verificada, `ads · verba` automático; senão fica assistido e documentado | ML (Ads) | `teste-chaveiro-ads.mjs` (stub) + registro da chamada real em `docs/manual-integracao-ml.md` |
| F7 | política crescente (`executar_e_avisar` por adaptador), reversão automática (D9), relatório ao cliente com degrau em linguagem simples | — | `teste-chaveiro-politica.mjs`, `teste-relatorio-seguro.mjs` (código novo) |

Cada fase fecha com todos os `teste-*.mjs` passando; nenhuma fase reinicia o servidor fora do fluxo combinado.

---

## 9. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Executar em lote e matar a própria medição | efeitos indistinguíveis, aprendizado contaminado | D8 (1 intervenção por anúncio por janela), teto diário |
| Leitura de N2 como "causa" | promessa ao cliente | rótulo fixo por degrau, `invalida_se` no cartão, `relatorio-seguro.js` barra o jargão |
| Experimento pequeno demais | holdout inútil, cliente espera à toa | MDE antes do sorteio; sem n ≥ 4, sem experimento |
| 2xx sem efeito / propagação lenta do ML | ordem "executada" sem mudança real | conferência por releitura, `incerto`, 3 tentativas, depois `falhou` |
| Preço errado em produção | prejuízo | piso de margem, variação máxima, snapshot, reversão, estreia com 1 anúncio |
| Humano marca "fiz" sem fazer | falso positivo | conferência pelo change-log; sem diff em 3 dias → `divergente` |
| Mudança de preço feita por terceiro durante a janela | confundidor | já tratado (`marcarPreco`), status `declarado` rebaixa o degrau |
| Ads: API de escrita muda/nunca verificada | ordem automática falha | nasce assistido; F6 condicional |
| Token do ML cai no meio | ordem presa | `recuperarPlanosPresos` (molde) para `executando` > 10 min; estado `falhou` com texto fixo |
| Crescimento de `exec_evento` | banco | poda > 180 dias de ordens terminais (não de `exec_ordem`) |
| Notion sem `NOTION_TOKEN` | caminho assistido não distribui | ordem fica `aprovada` com pendência "Notion não configurado" (honesto) |

---

## 10. O que não é executável hoje (declarado)

- **Product Ads**: escrita nunca feita pelo projeto; `ads · verba` e `pausar_anuncio` ficam assistidos até a F6 verificar o endpoint com 1 chamada real supervisionada. `id de campanha` não é coletado (`NOT_SUPPORTED` no plano).
- **Shopee, Amazon, TikTok, Magalu**: sem API; toda ação vai por card e não é medida — cobertura mostra "assistido, sem medição".
- **Estoque, reposição, envio ao Full**: físicos; caminho `cliente`. O sistema prepara quantidade e prazo, não escreve.
- **Catálogo de terceiros**: conteúdo não é do vendedor; próprio só por sugestão de correção no painel.
- **Conta sem custos**: preço só assistido (sem piso de margem).
- **Clientes pequenos**: experimento exige ≥ 4 anúncios elegíveis na mesma regra; a maioria das regras de um cliente terá 1–3 → teto N2.
- **"Melhor que o algoritmo do ML"**: a comparação (b) "seguir as sugestões do próprio ML" não é medível — as sugestões do ML não são coletadas (`NOT_COLLECTED`); a comparação (a) "não fazer nada" é exatamente o N3.
- **Ranking/impressões orgânicas**: `NOT_AVAILABLE`; o confundidor "ranking do ML" fica `nao_medido` para sempre e é declarado em toda medida.
- **`frete_gratis` por PUT**: campo lido hoje, escrita a confirmar na estreia da F4.
- **`NOTION_TOKEN`** ausente no ambiente atual: caminho assistido não distribui até configurar.
- **Reversão de mudança humana**: nunca (o sistema não tem o "antes" com certeza).

---

## Perguntas ao David (só as que mudam o desenho)

1. **Holdout escalonado (D7):** aceita que, numa regra com ≥ 4 anúncios elegíveis, ~25% (mínimo 1) esperem a janela de prova (14/28 d) antes de receber a mesma ação, para a medida subir ao degrau experimental? Se não, o teto é N2 e `exec_experimento` sai do desenho.
2. **Reversão automática (D9):** quando a regra de parada da ação bater, o Chaveiro pode reverter sozinho para o snapshot (só o que ele mesmo aplicou) e avisar depois — no nível `executar_e_avisar` — ou toda reversão é sempre uma ordem a aprovar?
3. **Limites de preço (D10):** variação máxima por ordem de 10% e nunca abaixo do piso de margem; sem custo informado, preço fica assistido. Confirma os dois limites (ou outro número)?
4. **Nível inicial (D11):** política nasce `propor` (prepara tudo, nada sai) e cada cliente sobe para `executar_com_aprovacao` por liberação do líder — ou todos nascem em `executar_com_aprovacao` e só a chave global segura?
5. **Ads (D4, F6):** vale fazer 1 chamada real supervisionada de escrita no Product Ads para destravar `ads · verba` automático, ou Ads fica assistido de vez (e a F6 sai do plano)?

Nome: a camada de causalidade segue **Merovíngio**; o executor está escrito como **Chaveiro**. Trocar o nome muda só textos e prefixo `CH-`.
