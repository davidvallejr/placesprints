# Alinhamentos com o cliente (exceções intencionais)

PLANO ATIVO 4 (10/10/2026), pontos do Adriano. Código: `src/lib/alinhamentos.js` (núcleo e predicado único), `src/lib/alinhamentos-real.js` (fiação), `config/alinhamentos.json` (tipos), `src/rotas-alinhamentos.js` (HTTP), `src/web/alinhamentos.js` (telas).

## Respostas curtas ao Adriano

**Como o sistema sabe que algo já foi alinhado?** Porque alguém registra. Existem três portas:

- O consultor ou líder registra em `/cliente` › Resumo › **Alinhado com o cliente**.
- Quem descarta uma ação do plano escolhe o motivo numa lista, e o descarte vira um alinhamento.
- No Sprint 90, o próprio cliente marca uma prioridade como **"É intencional"**.

Cada registro diz:

- **onde** vale: um anúncio, ou a conta para uma regra;
- **por quê**: um tipo da lista fechada, mais um detalhe interno opcional;
- **até quando**: revisão em 30 dias, por padrão.

Enquanto o alinhamento vale, o que ele cobre não vira ação no plano, aviso ao cliente nem cobrança no relatório. Exemplos de casos cobertos:

- um anúncio pausado por erro de produção;
- ACOS de 30% numa campanha de visibilidade;
- um anúncio "indisponível" que é boi de piranha;
- um produto descontinuado queimando o estoque no Full;
- um ponto que o consultor já conversou com o seller.

Sem registro, o sistema não adivinha intenção: o dado mostra pausa, ACOS alto ou ruptura, e ele recomenda.

**O que vira insight, e quem filtra?** Há quatro filtros, nesta ordem:

1. **Dado com amostra mínima e controle.** Diagnóstico e Merovíngio nunca transformam ruído em regra.
2. **Alinhamentos.** Uma regra coberta nem nasce e fica contada em `omitidas.alinhado`.
3. **Aprovação humana na assessoria.** Toda ação nasce `proposta`; o consultor aprova, ou descarta com motivo, e o descarte alimenta o filtro 2.
4. **Auditor de texto.** Ele barra promessa, nome interno, ID e jargão antes de qualquer coisa chegar ao cliente.

No Sprint 90 não há consultor. Os filtros 1, 2 e 4 são os mesmos, e o próprio cliente faz o papel do filtro 3 com o "É intencional". Uma revisão vencida devolve a regra, para a exceção não durar para sempre; a marca "observar: alinhado em dd/mm, revisar" fica só em `dados.alinhamento_vencido` (interna), nunca no texto que o painel do cliente projeta. O cliente vê a lista do que marcou e pode desfazer; a central lista, encerra e renova pela chave `[S90] …`.

**A página do que não conseguimos ver é editável?** Os bloqueios de dado não são editáveis: são fato. Ficam em `data_quality.analises_bloqueadas` e não se apagam com um clique. O que é editável é o alinhamento. Ele aparece no `/diagnostico-motor`, na seção "01 Qualidade dos dados", subtabela "Alinhado com o cliente", e é registrado em `/cliente`. O cliente lê só o rótulo do tipo e "conforme alinhado em dd/mm".

## Tipos (lista fechada)

| Tipo | Quando usar | No plano (regras que não nascem) | No relatório |
|---|---|---|---|
| `intencional` | decisão do cliente | todas as do escopo (na conta, só as regras escolhidas) | rotula |
| `ja_informado` | o consultor já falou com o seller | **nenhuma**: a regra continua; só silencia aviso, cobrança e relatório (`so_avisos`) | rotula |
| `campanha_visibilidade` | ACOS alto aceito | `ads_reduzir`, `ads_abaixo_meta`, `queda_ctr_ads`; com `acos_alvo`, as regras de Ads usam o alvo no lugar da meta da conta | rotula |
| `descontinuado_queima_estoque` | sem reposição | `estoque_ruptura`, `full_estoque_antigo`, `full_envio`; `promocao_giro` continua, com a nota de queimar estoque | rotula |
| `teste` | experimento em curso | todas as do escopo | **omite** |
| `pausa_producao` | pausado de propósito | `anuncio_restrito`, `queda_*`, `estoque_ruptura` | rotula |
| `boi_de_piranha` | anúncio de atração | `anuncio_restrito`, `queda_*`, `estoque_ruptura` | rotula |
| `outro` | o resto (exige as regras) | só as regras escolhidas | rotula |

Regras de cada tipo:

- O texto que o cliente lê é fixo, do tipo: `texto_cliente`, por exemplo "Pausa combinada com você, conforme alinhado em 10/10."
- O detalhe livre (`motivo`, até 200 caracteres) é interno, passa pelo auditor e nunca vai ao cliente.
- Na conta inteira, um tipo que cobriria tudo (`intencional`, `teste`, `ja_informado`) exige a lista de regras.

## Quem registra e como revisa

| Porta | Quem | Origem |
|---|---|---|
| `/cliente` › Resumo › Alinhado com o cliente › "Registrar alinhamento" (prévia, depois Registrar) | líder ou consultor (`por` validado) | `painel` |
| Descartar uma ação (`/cliente`: Próximas ações e aba Plano; `/planos`: Descartar marcadas, um motivo para o lote) | líder ou consultor | `descarte` (escopo = anúncio da ação, ou a conta, com a regra dela) |
| Sprint 90, painel `/c` › Prioridades › "É intencional" (motivo da lista `tipos_s90`) | o próprio cliente, só da sessão | `s90_cliente` |

**Revisão.** O prazo padrão é de 30 dias (`revisao_dias_padrao`) e o máximo é de 365. Só `descontinuado_queima_estoque` pode ser permanente.

**Vencimento.** A coleta diária roda `vencer()` antes de regerar os planos:

- o alinhamento passa de vivo a vencido;
- a regra volta a nascer, com "observar: alinhado em dd/mm, revisar" (no Sprint 90, só em `dados.alinhamento_vencido`);
- um descarte vencido devolve a ação de `descartada` para `proposta`.

**Renovar, encerrar e reabrir.** Renovar conta mais 30 dias, por padrão. Encerrar faz a regra voltar na próxima geração; se o alinhamento veio de um descarte, a ação volta de `descartada` para `proposta` na mesma transação. Reabrir uma ação descartada exige quem decide (líder ou consultor, 403 fora da central) e encerra o alinhamento daquele descarte. Qualquer decisão humana sobre uma ação cujo descarte venceu (aprovar, reabrir, descartar de novo) encerra o alinhamento vencido.

## Efeito em cada módulo

Todos perguntam ao **mesmo predicado** `alinhado(cliente, { item, regra, acao, aviso, acos })`. Nenhum módulo tem lógica própria de exceção. `aviso: true` marca quem fala com o cliente: gatilhos, pendências e reposição no relatório. Só esses consumidores veem `ja_informado`.

- Pergunta **sem regra** ("esta entidade está alinhada?") só casa alinhamento da entidade inteira, sem lista de regras. Descarte e "É intencional" citam a regra e não casam.
- **ACOS acima do alvo** é do predicado: nas regras de `regras_acos`, a campanha de visibilidade com `acos_alvo` não cobre quando `acos > acos_alvo`, e devolve `acima_do_alvo`. Outro alinhamento sem alvo no mesmo anúncio (por exemplo `intencional`) continua cobrindo. Sem leitura de ACOS, `acosDaAcao` trata a ação `ads_*` gravada com `dados.alinhamento.acos_alvo` como acima do alvo, porque o plano só a cria assim.
- O descarte de **uma ação** cobre só ela quando quem pergunta informa o id (`acao`), no anúncio e na conta: descartar a Black Friday não silencia o Natal do mesmo anúncio.
- **Plano por anúncio** (`plano-anuncios.js`). Regra ou anúncio alinhado não nasce e é contado em `omitidas.alinhado`. Ações descartadas saem antes do teto e da fila (`omitidas.descartada`). Ads por ACOS respeitam o `acos_alvo` pelo predicado. Abrir job numa oferta alinhada cria a ação na `fila`, fora da semana.
- **Plano por cliente** (`plano-cliente.js`). Aplica o mesmo filtro. O descarte de uma ação de conta (calendário, pendência) cobre só aquele id.
- **Diagnóstico** (`diagnostico-motor.js`). Lista os alinhamentos em `account_diagnosis.alinhamentos[]` e não usa estado novo de bloqueio. O render interno mostra a subtabela e o campo **Observação do consultor** (grava tipo `outro`, escopo conta, sem regras: é registro, não suprime nada). A visão do cliente mostra só os vivos com `relatorio: rotular` (o `teste` é omitido), com rótulo e texto fixo. O carimbo do memo inclui a data de revisão de cada alinhamento aberto.
- **Gatilhos** (`gatilhos.js`). Nenhum gatilho nasce para anúncio, regra ou conta alinhados — inclusive os internos (dono `assessoria`, 12/10). O tipo do gatilho é mapeado para a regra do plano por `REGRA_DO_TIPO`, por exemplo ruptura → `estoque_ruptura`, reputação → `reputacao_em_risco` e preço (mudança drástica e queda por preço) → `preco_mudou_vendas_cairam`. O alinhamento é um dos quatro filtros da origem do preço (com fonte do sistema, tarefa da equipe na janela e promoção). Um item vivo que passa a ser coberto fica `suprimido`, motivo `alinhado`: nunca vira `resolvido` e nunca gera linha "Resolvido" ao cliente. Isso vale também quando a fonte já chega filtrada pelo predicado (pendências, ação que virou obsoleta): a linha que sumiu pergunta ao predicado pelos itens dela. Quando o alinhamento acaba e a condição continua, a mesma assinatura reabre. Antes de reenviar um lote que não saiu, as linhas são reconferidas: se alguma foi alinhada ou resolvida, o lote é cancelado (`conteudo_mudou`) e as demais voltam à fila.
- **Alerta de pendência crítica** (`alerta-cliente.js`). A pendência que some porque passou a ser coberta (`alinhadas_itens` do avaliador) fica `suprimido`, motivo `alinhado`: sem «Concluído» no Notion e sem aviso de resolução. Quando o alinhamento acaba, a mesma linha reabre (`enviado` se a página existe).
- **Pendências** (`pendencias-cliente.js`).
  - Uma pendência coberta some, e a contagem interna vai em `alinhadas` (as chaves `item|canal` em `alinhadas_itens`).
  - A pendência do plano é casada pelo id da ação `pendencia_cliente` (o descarte).
  - A pendência de tarefa é casada pela regra `bloqueio_cliente`.
  - Dentro das pendências medidas, o anúncio alinhado sai da lista: estoque usa `estoque_ruptura`, custo usa `cadastrar_custos` e mídia usa `conteudo_fotos`.
- **Relatório curto** (`relatorio-brief.js`). É uma projeção, e o auditor continua passando:
  - Em **Depende de você**, a reposição de anúncio alinhado sai (o descontinuado não pede estoque).
  - Em **Desenvolvimento**, a mudança de anúncio alinhado por inteiro sai rotulada, por exemplo "Ads ligado em 1 anúncio — pausa combinada com você, conforme alinhado em 08/10"; o tipo `teste` é omitido. O descarte de uma regra não rotula nem apaga as outras mudanças do anúncio.
  - Em **Próximos passos**, o passo coberto sai, mas `ja_informado` mantém o passo, porque a regra do plano continua; Ads acima do ACOS alvo combinado também fica.
  - Tudo que sai fica em `_interno.omitidos.alinhado`.
- **Sprint 90.** `POST /c/api/acoes/{ref}/intencional {motivo_tipo}`:
  - a ref é opaca (16 hex), porque o id interno da ação nunca sai (D11);
  - uma ação de outra conta dá 404; um motivo fora da lista dá 400;
  - a guarda abre só esse formato exato.

  O painel mostra "Marcado por você como intencional em dd/mm; revisamos em dd/mm". `GET /c/api/intencionais` lista o que o cliente marcou (ref opaca, vivo ou em revisão) e `POST /c/api/intencionais/{ref}/desfazer` encerra a marca (só origem `s90_cliente`, só da sessão).

## HTTP

- `GET /api/cliente/alinhamentos?cliente=` devolve `{ cliente, alinhamentos (vivos e vencidos), tipos, revisao_dias_padrao, revisao_dias_max, quem, anuncios, regras }`.
- `GET /api/alinhamentos/tipos` devolve `{ tipos, revisao_dias_padrao, revisao_dias_max, quem }` e alimenta o diálogo de descarte, inclusive o descarte em lote.
- `POST /api/cliente/alinhamentos {cliente, escopo, chave?, regras?, tipo, motivo?, acos_alvo?, revisar_em?, permanente?, por, confirmar?}` devolve uma prévia, e só grava com `confirmar === true`. Escopo só `anuncio`, `regra` ou `conta` (`campanha_ads` e `sku` ainda não são lidos por nenhum módulo). `regras` sem curinga e da lista fechada (regras do Algoritmo + `REGRAS_CONTA`).
- `POST /api/cliente/alinhamentos/encerrar {cliente, id, por}`.
- `POST /api/cliente/alinhamentos/renovar {cliente, id, por, revisar_em?}`.
- `POST /api/planos/acoes/status {ids, status:'descartada', por, motivo_tipo, motivo?, revisar_em?, permanente?}`. Sem `motivo_tipo`, devolve 400 fixo. Reabrir (`proposta`/`aprovada`) uma descartada exige `por` de líder ou consultor (400 sem, 403 fora da central).

Os erros têm mensagem fixa e nunca ecoam o valor recebido. Prospect `[Comercial] …` nunca é cliente. A conta do Sprint 90 entra pela chave `[S90] …` de uma conta existente. Com `config/alinhamentos.json` inválido o servidor sobe (o `db.js` importa só `alinhamentos-schema.js`): o predicado responde "não alinhado" e as rotas devolvem 503 com o motivo.

## Testes

- `scripts/teste-alinhamentos.mjs` cobre o núcleo, o descarte e as rotas.
- Há blocos novos em `teste-plano-anuncios`, `teste-diagnostico-motor`, `teste-gatilhos`, `teste-pendencias-cliente`, `teste-relatorio-brief`, `teste-sprint90-guarda` e `teste-shell-ui`.
- O Sprint 90 tem um teste próprio: `scripts/teste-sprint90-intencional.mjs`.
