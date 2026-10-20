# Respostas dos clientes ao relatório semanal

Pedido do David (13/10/2026): «Colete a resposta dos clientes pra dentro do sistema SOMENTE com relação às mensagens, para implementarmos o relatório.»

Em 12–13/10 a Place2u mandou aos grupos de WhatsApp do Mercado Livre de 31 clientes o plano semanal do Merovíngio e depois a pergunta «O que você acha importante receber de informações toda semana?». Esses grupos são de atendimento e têm muita conversa operacional (pedidos ao consultor). Este módulo guarda **só** a mensagem do cliente que responde a uma dessas mensagens nossas. O resto é contado e descartado.

Isto é **coleta de feedback de produto**, não um segundo motor: nada aqui decide ação, prioridade ou texto ao cliente. A equipe lê, marca (revisada / implementar / descartar) e usa o resultado para desenhar o relatório.

## Peças

| Peça | Onde |
|---|---|
| Núcleo puro (filtro, temas, coleta, tick, lista, marcação) | `src/lib/respostas-relatorio.js` (`criarRespostas`, `filtrar`, `tipoAncora`, `operacional`, `opiniao`, `temasDe`) |
| Fiação real (banco, env do n8n, líder/consultor, `sync_estado`) | `src/lib/respostas-relatorio-real.js` |
| Rotas HTTP (loopback) | `src/rotas-feedback.js`, montadas no `src/server.js` depois das rotas dos gatilhos |
| Regras e listas | `config/respostas-relatorio.json` |
| Tabelas | `feedback_relatorio`, `feedback_coleta` (`SCHEMA_FEEDBACK`, aplicado no `db.js`) |
| Tela | `/planos` › «Respostas dos clientes ao relatório» (`#secFeedback`, recolhida, entre Gargalos e Avisos automáticos; código em `src/web/planos.js → montarFeedback`) |
| Autoteste | `scripts/teste-respostas-relatorio.mjs` (+ caso 18 do `teste-shell-ui.mjs`) |

## Fonte: o n8n (fluxo já ativo)

`POST {PLACE_GATILHOS_URL}/webhook/place-respostas` com a **mesma** autenticação dos gatilhos (`gatilhos-envio.postar`: `x-place-key` = `PLACE_GATILHOS_SECRET`, mais `x-place-ts`/`x-place-sig`). `postar` ganhou a opção `{ ler: true }`, que devolve o corpo JSON em `dados`.

- Corpo: `{ grupos: [jid@g.us…] (≤ 60; mandamos 10 por chamada), paginas: 1..5 }` (50 mensagens por página, mais recentes primeiro; o config usa 3).
- Resposta: `{ mensagens: [{ grupo, id, deMim, autor, nome, ts (epoch s), tipo, texto (≤ 4000), cita_id, cita_texto }] }`.
- Grupos: `clientes_central.notificacao_json.canais.whatsapp.destino`, só `…@g.us` (o «Id whatsapp meli» da central). Prospect «[Comercial] …» nunca entra. Se dois clientes têm o mesmo grupo, nenhum dos dois é lido (`grupo_compartilhado`), para não misturar clientes.
- Sem `PLACE_GATILHOS_URL`/`SECRET` (segredo com menos de 32 caracteres conta como ausente): `{ ok:false, estado:'pendente', motivo:'n8n_nao_configurado' }`, nenhuma chamada. Erro do n8n: o cliente fica `falhou` com `n8n_<status>`, ou com `n8n_resposta_invalida` quando o corpo não traz a lista. Nada é gravado e a coleta não é marcada como feita.
- Mensagem de um grupo que não pedimos é descartada.

## O filtro

**Âncora** = mensagem **nossa** (`deMim: true`) que:

- começa com «Oi, pessoal! 😊 Uma pergunta rápida» → `pergunta`, janela de **6 h**;
- contém «Merovíngio» ou «Place Sprints» → `relatorio`, **sem janela** (`janela_h: 0`): o plano só conta por **citação**. O dia depois do plano é o pico de conversa operacional nos grupos, e a revisão de 13/10 mostrou que uma janela de 24 h guardava pedidos ao consultor.

A comparação ignora acento, caixa, pontuação e emoji. As âncoras dos últimos 14 dias ficam em `feedback_coleta.ancoras_json`, então uma resposta é reconhecida mesmo quando a âncora já saiu da página lida.

Uma mensagem do cliente só é guardada se:

1. **`citou` / `certa`:** cita (`cita_id`) uma âncora. Vale mesmo dias depois e mesmo sem vocabulário.
2. **`janela` / `provavel`:** é texto (`conversation` ou `extendedTextMessage`), não cita nenhuma outra mensagem e cai nas **6 h** depois da pergunta. Com várias âncoras abertas vale a primeira em que a mensagem passa, a pergunta antes do plano. Além disso:
   - **não** é pedido operacional:
     - vocativo a uma pessoa: «Gi,», «Bom dia! 😊 Ana:», «Gi bom dia,». A palavra do vocativo não pode estar em `nao_vocativo` nem no vocabulário;
     - menção «@5511…» em qualquer lugar do texto;
     - um pedido junto com produto, link ou código MLB: «coloca», «pode», «por favor»… com «produto», «kit», «sku», «foto»…;
     - só um link, ou «Olha o que eu encontrei!»;
     - quando a mensagem **não** fala do relatório: verbo de pedido no começo («Coloca no Full esse», «Pode subir o preço…»), «por favor/pfv» ou pergunta («…já está ativa?»);
   - **e** fala do relatório (lista `opiniao`: relatório, semanal, toda semana, informações, «acho importante», «gostaria de receber», Merovíngio…) **ou** é uma resposta curta em lista («Vendas, Estoque, reposição, compras»). A lista precisa de ao menos 2 itens que sejam assunto (temas, exceto elogio/crítica/dúvida) e de nenhum item com verbo de conversa (`lista_curta.verbos`: chegou, enviei, paguei, vou…). «Bom dia, Gi», «Ok, vou ver» e «Tapete azul, tamanho G» não são lista.
   - As palavras da operação (vendas, estoque, Full, preço, promoção, Ads…) **nunca** provam opinião: só dão tema e só contam como item da lista.

Nunca são guardadas:

- mensagem nossa, mesmo citando uma âncora;
- mídia (imagem, vídeo, áudio, figurinha), mesmo com legenda ou citação;
- mensagem apagada ou criptografada, e texto vazio;
- resposta a outra mensagem que não é âncora;
- mensagem fora da janela.

Exemplo real (União Dog), que é o primeiro caso do autoteste:

- 12/10 13:19, nossa: «…Eu sou o *Merovíngio*…» → âncora `relatorio`.
- 13/10 06:37, cliente: «Bom dia! Gi, coloca no Full esse produto por favor?» → **não** é guardada: não cita o plano (e ainda é vocativo e pedido com produto).
- 13/10 08:30, nossa: «Oi, pessoal! 😊 Uma pergunta rápida…» → âncora `pergunta`.
- 13/10 08:31, cliente: «Vendas, Estoque, reposição, compras» → **guardada** (`janela`/`provavel`, temas `vendas`, `estoque_reposicao`, `compras`).

**Limites conhecidos (ponytail):**

- Prioriza não guardar o que não deve. Fica de fora a resposta legítima com cara de pedido («pode mandar quais produtos mais venderam», «Pode ver o estoque?»), a que não cita o plano e a frase solta sem vocabulário do relatório («Quanto vendi e o que repor»). A citação sempre pega.
- O consultor que escreve **do próprio celular** aparece como `deMim: false`. A confiança fica `provavel` e a equipe descarta.
- As palavras casam pelo início («ads» pega «Adson»); item com `$` no config casa a palavra inteira («envio$» não pega «enviou»). O que escapar cai em `provavel` e passa pela revisão.
- **Descartar apaga** (lápide): texto, 1º nome e temas viram vazio; a linha fica só para a próxima coleta não regravar a mensagem. Descartada não volta (409).

## Temas

Os temas são determinísticos, pela lista `temas` do config, na ordem: `vendas`, `estoque_reposicao`, `compras`, `full`, `logistica`, `anuncios`, `ads`, `preco_promocao`, `concorrencia`, `margem_custos`, `previsao`, `formato_frequencia`, `elogio`, `critica`, `duvida`.

- `critica` e `duvida` leem o texto inteiro.
- Os outros temas leem o texto sem as frases de crítica e sem a palavra depois de «não/nada/nem», para que «não gostei» ou «nada útil» não virem elogio.
- `duvida` também vale quando a mensagem tem «?».

## Tabelas

`feedback_relatorio` (PK `msg_id`, `INSERT OR IGNORE`: recoletar não duplica nem apaga a marcação):

- `cliente`;
- `grupo_hash` = sha256(jid) 16 hex;
- `autor_hash` = vazio (sha256 sem sal do telefone é reversível e nada o lia; se um dia precisar, HMAC com segredo local);
- `autor_nome` = só o 1º nome, ≤ 30;
- `texto` ≤ 2000, só da mensagem que passou no filtro, com menção «@5511…» → «@…» e telefone digitado → «[telefone]»;
- `recebido_em` (ISO), `ancora_id`, `ancora_tipo`;
- `relacao` (`citou` | `janela`) e `confianca` (`certa` | `provavel`);
- `temas_json`;
- `status` (`novo` | `revisado` | `descartado` | `implementar`);
- `nota_interna`, `status_por`, `status_em`, `coletado_em`.

`feedback_coleta` (PK `cliente`): `ultima_coleta` (ISO), `ultimo_ts` (epoch s da mensagem mais nova lida) e `ancoras_json` (`[{ id, tipo, ts, g }]`, últimos 14 dias, ≤ 50).

O jid do grupo e o do participante **nunca** são gravados, nem em log nem em resposta HTTP; o participante nem em hash. Ponytail: o `grupo_hash` não leva sal (o jid do grupo não é telefone). Se o banco sair desta máquina, troque por HMAC com um segredo local.

## HTTP (loopback; corpo JSON nos POST = 415; mensagens fixas, sem eco; prospect = 404)

- `POST /api/feedback/coletar { clientes?: [nome], por }`
  - Sem `clientes`: todos os clientes com grupo ML.
  - Lista vazia ou que não é lista = 400. Cliente fora da central ou prospect = 404. `por` que não é líder nem consultor = 403.
  - Resposta: `{ ok, lidas, guardadas, repetidas, ignoradas, por_cliente: [{ cliente, estado: ok | falhou | ignorado, motivo?, lidas, guardadas, repetidas, ignoradas }] }`. Nunca traz jid nem texto ignorado.
  - Duas coletas ao mesmo tempo: `{ ok:false, estado:'ocupado', motivo:'coleta_em_andamento' }`.
- `GET /api/feedback?status=&tema=&cliente=`
  - `status` padrão = tudo menos `descartado`. `tema` só da lista (senão 400).
  - Resposta: `{ total, itens (≤ 500, mais novos primeiro), resumo: { por_tema, sem_tema, por_cliente, por_status }, temas, status, coleta: { configurado, ultima, clientes_lidos, clientes_com_grupo }, quem }`.
  - `total` e o resumo valem para o recorte de status. O tema recorta só `itens`.
- `POST /api/feedback/status { msg_id, status, nota?, por }` → `{ ok, msg_id, status }`. Líder ou consultor (403). Status fora da lista ou nota que não é texto = 400. Sem a resposta = 404. Sem `nota`, a nota atual fica. `descartado` apaga texto, 1º nome e temas (lápide); tirar uma resposta de `descartado` = 409.

## Coleta automática

`respostas.tick()` roda a cada 10 min no `server.js` e faz uma coleta por dia, a partir das **18:00** de São Paulo (`config → coleta`):

- Não roda sem o n8n configurado.
- Coleta quem nunca foi lido e quem teve âncora vista, ou plano semanal enviado (`gatilho_lote.enviado_em`), nos últimos **14 dias**.
- Marca o dia em `sync_estado.feedback_tick_dia` **antes** de rodar: se o n8n estiver fora do ar, tenta de novo no dia seguinte.

## Tela

`/planos` › «Respostas dos clientes ao relatório» (recolhida):

- resumo do recorte;
- segmentado por tema com contagem (filtra);
- filtro de situação;
- estado da coleta;
- botão secundário «Coletar respostas agora» (pede o nome);
- tabela de 6 colunas: Cliente (e 1º nome) · Quando (à pergunta / ao plano) · Resposta (e nota) · Tema · Confiança · Status com «⋯» para marcar como revisada, implementar ou descartar (a descartada mostra «Texto apagado ao descartar» e não tem «⋯»).

Não tem botão primário novo.

## Perfil de informação do cliente (13/10/2026, Etapa 1)

O que cada cliente quer receber no relatório: serviço (`assessoria` | `consultoria` | vazio), temas **em ordem** (lista fechada em `config/perfil-informacao.json`), nível (`padrao` | `didatico` | `completo`), observação interna (≤ 500, sem telefone) e fonte (`equipe` | `whatsapp`). Não é um segundo motor: só diz quais blocos o relatório mostra e em que ordem; os números de cada bloco continuam saindo do Algoritmo/Merovíngio. Código: `src/lib/perfil-informacao.js` (núcleo, sem banco), `perfil-informacao-real.js` (fiação), rotas em `src/rotas-feedback.js` (`criarRotasPerfilInformacao`), tela `src/web/perfil-informacao.js`.

- **Ordem do relatório** (`efetivo.ordem`): temas pedidos no topo, na ordem do cliente, + o resto da **base fixa** (`base_fixa`: vendas, estoque e reposição, compras e previsibilidade — para todos, decisão 2 —, ações realizadas). Sem perfil: só a base fixa, ordenada pelos temas mais pedidos da carteira (`temas_padrao`). Tema fora da base só entra com pedido.
- **Sugestão**: derivada na leitura das respostas não descartadas em `feedback_relatorio` (tema do WhatsApp → tema da lista pelo campo `feedback` do config), só para quem **não** tem perfil salvo. Nunca é gravada (o valor `sugestao` do CHECK fica reservado), nunca sobrescreve a equipe e não muda o relatório até alguém salvar.
- **Histórico e livro**: cada mudança (inclusive só de ordem) grava `perfil_informacao_hist` (append-only, trigger barra UPDATE/DELETE) e uma `nota` no livro (`ref perfil-info:<id>`, `dados.evento = 'preferencia_cliente'`, com o antes). Tipo próprio no livro não: `TIPOS_LIVRO` é CHECK da tabela append-only e ampliá-lo exigiria recriar `registro_cliente` (os triggers barram); a nota não quebra a cadeia. Salvar igual ao atual não grava nada.
- **Feedback curado pela equipe**: `feedback_relatorio.origem` (`whatsapp` padrão | `equipe`). A linha da equipe tem `status 'revisado'`, `recebido_em` = o DIA (sem hora inventada), grupo/autor vazios, âncora/relação/confiança fixas (`pergunta`/`citou`/`certa` — o CHECK antigo não tem valor próprio; quem distingue é `origem`) e entra no livro como `resposta_cliente` na mesma transação, com o resumo «colhido pela equipe em conversa» (a ingestão do livro pula pelo UNIQUE).
- **Quem registra**: líder, consultor ou o CS deste cliente (`validarDossie`). Prévia por padrão; grava só com `confirmar: true`.

HTTP (loopback):

```
GET  /api/perfil-informacao/matriz          → { carteira, com_perfil, pct_com_perfil, por_servico, por_nivel, por_tema:[{ tema, rotulo, base_fixa, n, pct_com_perfil,
                                                por_servico, clientes:[{ cliente, servico, posicao, fonte }], n_sugestao, sugestoes }], temas_padrao, ordem_sem_perfil, base_fixa, sugestoes, catalogo }
GET  /api/cliente/perfil-informacao?cliente= → { cliente, perfil|null, sugestao|null, efetivo:{ fonte, servico, nivel, temas, ordem }, historico, catalogo, quem }
POST /api/cliente/perfil-informacao { cliente, servico?, temas, nivel?, observacao?, fonte?, por, confirmar? }
                                            → prévia { previa:true, mudou, antes, depois } | { previa:false, mudou, perfil }   (415 sem JSON, 404 fora da central, 403 quem não pode, 400 fora da lista)
```

Telas: `/planos` › «O que os clientes querem receber» (`#secPerfilInfo`, recolhida, entre as respostas e os clientes em risco; matriz de 6 colunas, só leitura) e `/cliente` › Configurar › «O que este cliente quer receber» (`#secPerfilCliente`, depois do perfil do relatório semanal; checkbox + número de ordem por tema, salvar secundário → prévia → confirmação do shell).

Seed do feedback de 13/10 (9 perfis + 8 feedbacks curados): `node scripts/seed-perfil-informacao.mjs` (prévia, banco só-leitura) e `node scripts/seed-perfil-informacao.mjs --confirmar` (grava numa transação; idempotente). Mandi Confeccoes ficou de fora: a mensagem é dúvida («Temos os relatórios?»), não preferência.

## Relatório semanal personalizado pelo perfil (13/10/2026, Etapa 3)

O plano semanal de terça (lote `semanal` dos gatilhos, `montarPlanoSemanal` em `src/lib/plano-semana-texto.js`) passa a seguir o perfil: **projeção** do que o Algoritmo e o Merovíngio já produzem (nenhuma decisão nova; tom aprovado, auditor e travas intactos). Sem a fonte `perfil` (consultor no Discord, `scripts/previa-plano-semana.mjs`) o texto é **idêntico** ao tom aprovado.

- **Ordem**: `efetivo.ordem` do perfil. Cabeçalho fixo (abertura do Merovíngio + resultado dos 28 dias = tema `vendas` na base); cada tema vira os blocos de `config/perfil-informacao.json → relatorio.base` (tema só da base fixa) ou `relatorio.pedido` (tema pedido, sobe para o topo e pode ganhar bloco a mais). Sem perfil salvo = só a base fixa, na ordem padrão da carteira (`ordem_sem_perfil`).
- **Base fixa (todos)**: ✅ entregas que estão vendendo (`acoes_realizadas`), 🎯 plano da semana com o 📦 dos campeões e os pontos do cliente (`estoque_reposicao`; `logistica_full` aponta para ele), 🛒 **Compras e previsibilidade** (`compras_previsao`, novo: até 3 produtos com «quando pedir» e «quanto» de `preverCompras`, sem repetir o 📦, prazo usado declarado — premissa ou registrado — + folga; nada no próximo ciclo = frase honesta).
- **Blocos pedidos**: 📈 estatísticas (`vendas`: unidades, ticket, top 5 com variação, curva ABC em 1 linha) · 🛠️ ações da semana (`acoes_realizadas`: tarefas do ML concluídas em 7 dias, por família, sem título nem analista) · 🔍 causa e efeito (funil visitas × conversão × ticket 28 × 28 d + medições do Merovíngio dos últimos 60 d com anúncio identificado, rótulo de confiança alta ≥ 80 / média ≥ 60 / baixa, «associação no tempo, não prova de causa») · 📉 anúncios que pedem atenção (`anuncios_performance`: regras `queda_conversao_anuncio`/`queda_exposicao_anuncio` abertas, campeão A ≥ 20 % abaixo, ≥ 100 visitas sem venda) · ✨ criação e melhoria (`anuncios_criacao_melhoria`) · 📣 Ads (investimento, vendas atribuídas pelo ML e ROAS 28 × 28 d, «o que estamos ajustando junto com você» das regras `ads_*`/`queda_ctr_ads`; nunca culpa) · 🏷️ promoções (no ar, terminando em 7 d, elegíveis, giro do Full; com a data da leitura) · 🆚 concorrência (abaixo) · 🚀 ações para vender mais (ações **aprovadas/distribuídas** com frase ao cliente em `relatorio.frases_acoes`). `margem_custos` ainda não tem bloco (o 📊 de custos do plano cobre a falta da planilha).
- **Nível**: `didatico` = linha «💡 O que isso significa» por bloco (texto fixo `relatorio.blocos.<chave>.significa`) + mini-glossário no rodapé (conversão, curva A, cobertura, ponto de pedido, ROAS); `didatico`/`completo` = até 10 linhas por bloco (padrão 5).
- **Honestidade**: fonte ausente = frase dizendo que não foi lida (nunca zero); variação e funil só com as duas janelas de 28 dias inteiras; cortes de exibição são premissa declarada no config (`$premissas`). O relatório só sai com pelo menos um bloco que traga dado (`conteudo`); a linha de gatilho só é marcada como enviada se o 🎯 entrou.
- **Concorrência — «começar pelo que dá»**: catálogo (preço para ganhar e caixa de compra, já coletados), concorrentes **cadastrados pelo consultor** em `concorrente_anuncio(cliente, item_id, url, preco, observado_em, por)` (`src/lib/concorrencia.js`; o link nunca vai ao texto), campeão sem dado = «ainda não acompanhamos concorrentes deste anúncio. Seu consultor pode cadastrar.» e a busca ampla declarada como não coletada.
- **WhatsApp em partes**: acima de `relatorio.whatsapp_max_caracteres` (4.000) o texto sai em partes **na ordem**, cortadas só entre parágrafos (nunca no meio de um bloco; título grudado no bloco seguinte; equilibradas), com «_(continua na próxima mensagem)_» nas do meio (`dividirMensagem`). Vai ao n8n no campo `whatsapp_partes` do MESMO lote (o `texto` inteiro segue para e-mail e Notion); o fluxo `place-gatilhos-entrega.json` abre 1 envio por parte (lote de 1 item, 1,5 s entre partes) e devolve **um** recibo do canal — `entregue` só se todas saíram. **No n8n, editar só o nó «Abrir por canal» do fluxo publicado** (colar o `jsCode` do modelo, que junta as partes do WhatsApp e do Discord): **não reimportar o fluxo inteiro** — o apiKey da Evolution, as credenciais do Webhook/recibo e o nó de e-mail ao vivo voltariam ao modelo, e o Discord perderia a entrega em partes. O WhatsApp no ar já tem o lote de 1 item e 1,5 s entre partes; sem a edição, o texto sai inteiro numa mensagem só.
- **Prévia**: `POST /api/gatilhos/previa { cliente, tipo: 'semanal' }` devolve também `secoes [{ chave, tema, pedido, conteudo }]`, `perfil { fonte, nivel }` e `n_partes`; o diálogo «Aviso ao cliente» mostra os blocos na ordem, quais vieram do pedido do cliente e em quantas mensagens sai.

```
GET  /api/cliente/concorrentes?cliente= → { cliente, concorrentes:[{ item_id, url, preco, observado_em }] (última observação de cada link), quem }
POST /api/cliente/concorrentes { cliente, item_id: MLB… (do cliente), url: https…, preco, observado_em?: AAAA-MM-DD (≤ hoje; padrão hoje), por, confirmar? }
                                       → prévia { previa:true, novo, depois } | { previa:false, novo, depois }   (mesmo link no mesmo dia = só atualiza o preço; 404 anúncio de outro cliente)
```

Autoteste: `scripts/teste-relatorio-perfil.mjs`.
