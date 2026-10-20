# Prestação de contas e Dossiê de defesa (Etapa 2 · 13/10/2026)

Pedido do David: o relatório que o Manoel montou à mão para a Juliana (09/10/2026, 19 páginas, «Relatório de Assessoria Marketplace · Prestação de contas») vira **padrão** para qualquer cliente e período — inclusive cliente em risco, jurídico, reclamação ou pedido de reembolso — e o próprio sistema guarda o passo a passo do que foi feito.

Etapa 1 (já no ar no código): livro de registro imutável, cliente em risco, contrato e pagamentos — `src/lib/livro-registro.js`, `risco-cliente.js`, `contrato-cliente.js`, contrato HTTP no cabeçalho de `src/rotas-dossie.js`.

## Duas versões

| | Prestação de contas (`cliente`) | Dossiê de defesa (`defesa`) |
|---|---|---|
| Para quem | o cliente (pode ir ao Notion dele com um clique) | uso interno e jurídico — **nunca sai do sistema**, exceto o envio mensal ao #growth |
| Tom | positivo e honesto, sem culpa, sem «causa» | tese de obrigação de meio, prova datada em cada afirmação |
| Status | `n/a` | `completo` ou `incompleto` pela definition of done |
| Marca | capa escura Place2u | faixa «CONFIDENCIAL — uso exclusivo interno/jurídico» na capa e no topo de cada página |

## Estrutura (ordem e tom do relatório do Manoel)

Capa (cliente, consultor responsável, CS, período, bases, último elo do livro) → **01** Resumo executivo (KPIs, tabela mês a mês, três conclusões fundamentadas, «Conclusão correta…» conforme a tendência medida) → **02** Visão comercial (vendas brutas, quantidade, unidades, visitas, conversão, preço médio, canceladas «—», média diária, mês parcial declarado) → **03** Execução registrada (por mês; «Concluído comprova o encerramento no Notion…») → **04** Solicitações diretas do cliente (etiqueta «Solicitação Seller») → **05** Anúncios trabalhados (intervenções × MLBs) → **06** Rastreabilidade dos MLBs (1×/2×/3×) → **07** Exemplos (até 4: medições com grupo de controle; completa com mudança de conteúdo comprovada com as duas janelas de 14 dias coletadas; ressalva de associação) → **08** Evidências de execução (cliente: tarefa, data e sha256 do print, sem imagem; defesa: prints embutidos; «registrado no livro» só para o print que já está nele) → **09** Evidências no histórico do anúncio → **10** Comunicação registrada (relatórios, planos e avisos com recibo; respostas do cliente) → **11** O que depende do cliente (neutro na versão cliente) → **12** Product Ads (por anúncio; campanha = não suportado, declarado) → **13** Evolução comparável (por dia coletado) → **14** Fotografia recente (7 dias) → **15** Rentabilidade e governança (só com custos informados; senão «Não validado») → **16** Resposta às solicitações (tema × situação × base documental) → **17** Plano de continuidade (só ação `aprovada`/`distribuida` ainda em aberto, com status, prazo e responsável da tarefa no Notion; dono «Sua equipe» quando a ação é do cliente; cliente vê só o que está no prazo, a defesa vê a vencida marcada) → **18** Fontes e critérios (F1–F6).

A defesa acrescenta, antes: **D1** Status e tese (obrigação de meio do contrato cadastrado; definition of done com responsável e prazo) e **D2** As 9 perguntas; e depois: **D3** Cronologia completa do livro (seq, data do fato, **data em que entrou no livro** — «registrado depois» quando passa de `dias_registro_tardio` com o livro já funcionando —, hash curto; início do livro declarado em D1, D3 e 18: o hash prova só que nada mudou depois da entrada; anexos do mesmo card no mesmo dia, fotografias do mesmo dia e alterações de preço/promoção da coleta de promoções do mesmo dia viram uma linha com o 1º e o último seq/hash — cada fato continua no livro), **D4** Tentativas de contato (só envio-âncora do coletor de respostas, depois de ele começar e com a janela de 7 dias fechada, pode virar «sem resposta captada»; o resto é «resposta não verificável pelo sistema», nunca silêncio), **D5** Colaboração × obstrução (só o que o histórico prova; custos só viram «aguardando o cliente» com pedido registrado, senão «sem registro de pedido» + item da definition of done), **D6** Varredura de admissão de erro (com o limite declarado), **D7** Inventário de provas (disponíveis com hash × pendentes).

## Regras

- **Números iguais às fontes**: pedidos pagos (`meli_coleta_dia`, `meli_serie_item`), visitas só dos anúncios com visitas coletadas no mês inteiro, média diária só sobre dias coletados (dia sem coleta não é zero), os 3 dias mais recentes declarados como sujeitos a recoleta.
- **Ausente = «—» com o motivo**. Canceladas não são coletadas por dia; campanha de Ads não vem na API; sem custos não há rentabilidade.
- **Nunca causa**: antes × depois só com grupo de controle (impacto-tarefas), sempre com a métrica do efeito e a ressalva «não equivale à comprovação de causalidade».
- **Prints na versão cliente**: nunca embutidos (o print de um card pode ser de ferramenta interna — bot do Discord com o WhatsApp do cliente, tela do ERP — e nada no arquivo distingue); vai a tarefa, a data e o sha256. Card «Exibir ao cliente = não» (`visivel_cliente = 0`) some de toda seção. Na defesa, prints de qualquer card.
- **Auditor antes do Notion**: a versão cliente passa pelo `auditarTexto` do relatório (`relatorio-seguro.js`) na geração; barrada = prévia com código e trecho, nada publicado (nem com `confirmar:true`). Liberado só o que o formato do Manoel exige: MLB, id de anúncio/item de outro canal (10–19 dígitos, menos o que tem cara de celular), responsáveis, «Notion». Rótulos de gente no texto (preço em R$, sim/não, status/Ads em português), sem nome de tabela, API ou nome interno.
- **9 perguntas**: Q1 só PARCIAL até a conferência item a item dos entregáveis; Q2 sem frase achada = «SEM OCORRÊNCIA NA VARREDURA», nunca PROVADO; Q4 conta só resposta «certa»; Q8 sai das leituras do balanço.
- **Definition of done** (defesa): críticos = contrato com arquivo, prova de execução datada, prova de resultado (vendas coletadas), livro íntegro, varredura declarada, balanço. Faltou crítico → **INCOMPLETO — não enviar ainda**. Não críticos (sempre listados com responsável e prazo = hoje + 3 dias): cláusula de meio conferida, comprovantes de pagamento, prova de acesso, gravações/atas, conversas do WhatsApp/Discord, revisão das frases achadas.
- **Varredura de admissão de erro**: frases de `config/dossie.json → frases_admissao` (sem acento/caixa, frase inteira, plural e singular/informal: «esqueci», «errei», «sorry»…), nos cards do Notion (registro interno, pergunta 2) e nos textos que NÓS enviamos (planos, avisos, cobranças, resumos ao time — pergunta 3). Limite declarado: conversas da equipe no WhatsApp/Discord não são lidas pelo sistema.
- Telefone/jid nunca aparecem (máscara do livro em todo trecho).

## Arquivos e guarda

- `src/lib/dossie.js` — `montarDossie(cliente, { de, ate, versao, cfg }, dados)` PURO + `criarDossies(...)` (gerar, listar, arquivo, enviarNotion, chave, tickMensal; sem import de banco) + `SCHEMA_DOSSIE`.
- `src/lib/render-dossie.js` — `htmlPdf` (tokens do 1º `:root` de `src/web/ui.css` LIDOS do arquivo; rodapé «Mercado Livre · {cliente} · {data} · pág. N / M» em margem de página do Chrome), `htmlDoc` (Word: cabeçalhos `xmlns:w`/`ProgId`, variáveis CSS resolvidas, prints viram referência arquivo + sha256, sem rodapé numerado), `gerarArquivos` (PDF pelo `gerarPdf` de `relatorio-pdf.js`; falha do PDF = `pdf_motivo`, o .doc fica).
- `src/lib/dossie-real.js` — coleta real (só leitura), Notion, n8n, sino. Cada geração faz antes uma passada incremental do livro para o cliente.
- Tabelas `dossie_gerado` (id, cliente, versao, de, ate, gerado_em, por, origem, competencia, arquivo_pdf, arquivo_doc, sha256_pdf, sha256_doc, bytes_pdf, pdf_motivo, status, pendencias_json, livro_seq, livro_hash, notion_json) e `dossie_mensal` (cliente, competencia, ids_json, estado, motivo, tentativas, …).
- Arquivos em `data/dossies/{cliente-slug}/{prestacao-contas|dossie-defesa}-{de}_{ate}-{carimbo}-{4 hex}.{pdf,doc}`. Cada geração entra no livro como `documento_gerado` (ref `dossie:{id}`, hashes do PDF e do Word); o documento imprime o último elo do livro **antes** do próprio registro.
- Word = **.rtf** pelo `textutil` do macOS (HTML → RTF; `application/rtf`): Word, Google Docs, Pages e TextEdit abrem e editam com as tabelas; cabeçalho CONFIDENCIAL em cada página da defesa e rodapé numerado. O .docx do textutil achata as tabelas, por isso RTF. Sem textutil (Linux) ou com falha: fica o **.doc HTML** (`application/msword`, abre no Word/Google Docs, no TextEdit vira código) com o motivo, e a faixa CONFIDENCIAL abre cada seção. Nenhuma dependência nova.

## HTTP (loopback; `por` = líder/consultor/CS; mensagens fixas, sem eco)

| Rota | Faz |
|---|---|
| `POST /api/cliente/dossie { cliente, versao: 'cliente'\|'defesa', de, ate, por }` | gera (sem prévia: gerar não envia nada a ninguém) → `{ ok, dossie }` |
| `GET /api/cliente/dossies?cliente=` | histórico + estado do mensal |
| `GET /api/dossie/:id/pdf` · `GET /api/dossie/:id/doc` | download (attachment); só Host loopback, nas duas versões |
| `POST /api/dossie/:id/notion { por, confirmar? }` | só versão cliente (defesa = 403); prévia por padrão; `confirmar:true` cria «Relatório de Sprints Place2u · Prestação de contas · dd/mm/aaaa a dd/mm/aaaa» na Informações do cliente (idempotente por título), anexa o PDF e registra no livro |
| `GET /api/dossie/mensal` · `POST /api/dossie/mensal { ligado, por }` | estado / chave (líder ou consultor) |
| `GET /api/risco` | agora traz também `mensal` |

## Mensal para quem está em risco

Tick a cada 10 min no `server.js`; só faz algo no **dia 1, a partir das 09:00 (America/Sao_Paulo)**, com a chave `sync_estado.dossie_mensal_ligado` **ligada** (nasce DESLIGADA). Para cada cliente com risco **aberto** (marcado por líder, consultor ou o CS **daquele** cliente): gera as duas versões do mês anterior (uma vez) e envia ao n8n. Idempotente por (cliente, competência); falha do n8n tenta de novo nos próximos ticks até `max_tentativas` (3) e avisa no sino; n8n sem configuração = `pendente` + aviso. Sem «recuperar» em outro dia.

Contrato com o fluxo **place-dossie** (o David cria no n8n; posta no #growth, canal 1040645309023391845, pelo bot):

```
POST {PLACE_GATILHOS_URL}/webhook/place-dossie
headers: x-place-key (+ x-place-ts / x-place-sig, os mesmos dos gatilhos)
{ "id": "Acme|10/2026", "cliente_rotulo": "Acme", "competencia": "10/2026",
  "texto": "<@&1517119651522547774> <@&799352939873173575> <@&1356270093516013569> 📁 Prestação de contas mensal · Acme · 10/2026 — dossiê de defesa: INCOMPLETO (5 provas pendentes: …) · livro seq 3588 · 2b538b17174d",
  "discord_mencionar_cargos": ["1517119651522547774", "799352939873173575", "1356270093516013569"],
  "arquivos": [ { "nome": "Prestacao-de-contas-acme-10-2026.pdf", "mime": "application/pdf", "base64": "…" },
                { "nome": "Dossie-defesa-acme-10-2026.pdf", "mime": "application/pdf", "base64": "…" } ] }
```

PDF acima de 8 MB não vai no corpo: o texto avisa para baixar no painel (`/cliente › Configurar`). O fluxo deve usar `allowed_mentions { parse: [], roles: discord_mencionar_cargos }` e **descartar `id` repetido** (timeout depois de o n8n já ter postado vira nova tentativa aqui). A chave e o risco aberto são conferidos de novo antes de gerar e antes de postar (desligou ou encerrou no meio = `pendente`); falha no meio da geração guarda o que já foi gerado e a próxima tentativa gera só a versão que falta.

## Telas

- `/cliente › Configurar`: `#secDossie` (período, «Gerar prestação de contas» e «Gerar dossiê de defesa» — secundários —, histórico com PDF/Word, selo, provas pendentes e «Enviar ao Notion»), `#secRisco` (marcar/encerrar com motivo; sinais só como sugestão), `#secContrato` (contrato + pagamentos com upload). `src/web/dossie.js`.
- `/planos › #secRisco` «Clientes em risco»: abertos, sinais sugeridos e a chave do mensal.

## Testes e exemplo

- `scripts/teste-dossie.mjs` (29 casos, banco em memória, Chrome por stub, nada na rede).
- Exemplo real só-leitura (União Dog, 01/08–13/10/2026): o script do scratchpad abre `data/db.sqlite` **só leitura**, copia as linhas desse cliente para o banco em memória do `db.js` e grava os arquivos fora de `data/`.

## Pendências declaradas

- Etiqueta «Solicitação Seller»: vem da «Tag» do Notion (Etapa 1) e da coluna de prioridade; a coluna nova só se completa com um sync completo (combinar).
- Canceladas e campanha de Ads não são coletadas — aparecem como «—» com o motivo.
- Margens de página do Chrome (rodapé numerado) exigem Chrome ≥ 131; o .doc HTML de fallback não tem rodapé numerado (o .rtf tem).
- A 1ª geração de um cliente roda antes a passada do livro só para ele (inclui o sha256 de todos os anexos dele): alguns segundos a mais.
