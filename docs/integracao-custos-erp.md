# Custos por SKU vindos da planilha, do Bling ou do Tiny — guia de uso

Para que serve: o módulo de Promoções só calcula a margem (MC) de um anúncio quando sabe quanto o produto custa. Sem custo, o anúncio fica **"SEM CUSTO"** e nada é recomendado. Esta integração traz o custo de cada SKU sozinha, de uma de três fontes:

| Fonte | Como chega | Situação hoje |
|---|---|---|
| **Planilha Google Sheets** | A própria planilha envia (Apps Script) a cada 10 minutos se algo mudou, mais 1 envio completo por dia | **Pronta para usar.** Validada com testes; falta o teste na sua conta Google (10 minutos, abaixo) |
| **Bling** | O painel lê o Bling 1×/dia a partir das 03h, e quando você clica em "Sincronizar agora" | Construída e testada **só com dados de exemplo**. Precisa de 1 cliente piloto (lista no fim) |
| **Tiny / Olist** | Igual ao Bling (o Tiny não avisa quando o custo muda) | Igual ao Bling: precisa de 1 cliente piloto |

O que a integração **nunca** faz:
- não escreve nada no ERP, na planilha (só a coluna de Status, pelo script do próprio cliente) nem na conta do Mercado Livre;
- não pede senha de ERP (só o login oficial do próprio ERP, que o cliente faz);
- não inventa número: custo vazio, zero, negativo ou texto é **rejeitado** e o anúncio continua "SEM CUSTO" (o custo anterior, se havia, continua valendo);
- não casa anúncio por "parecido": a ligação é **pelo SKU** do anúncio no Mercado Livre (igual, ou igual sem espaço e hífen quando só um custo casa), pelo **vínculo manual** que a equipe confirma ou herdada de outro anúncio do mesmo produto. Semelhança de nome só **sugere** (veja "Como vincular custo ao anúncio"). Anúncio sem nenhum desses fica "SEM CUSTO";
- não mistura clientes: cada cliente tem sua URL, seu segredo e seus custos.

---

## Antes do primeiro uso (uma vez só)

1. No arquivo `.env` do painel, defina `ERP_TOKEN_KEY` com uma chave nova: rode `openssl rand -hex 32` no Terminal e cole o resultado. **Guarde um backup** dessa chave (perdeu = reconectar todos os clientes). Sem ela, o painel recusa gerar webhook ou conectar ERP.
2. Confira `PUBLIC_BASE_URL` no `.env` (o mesmo endereço do túnel usado pelo Mercado Livre, começando com `https://`).
3. Reinicie o painel.

---

## Planilha em 10 minutos

1. **Integrações** → cartão do cliente → **Custos (ERP/Planilha)** → **Planilha → Gerar webhook**.
2. Abre uma janela com a URL e o **segredo**. O segredo aparece **uma única vez**: clique em **Copiar Apps Script pronto** (já vem com URL e segredo preenchidos). Fechou sem copiar? Use **Rotacionar** para gerar outro.
3. Na planilha do cliente, crie (ou use) a aba **`Custos`**:
   - coluna **A = SKU** (formate a coluna como *Texto simples*, senão zeros à esquerda somem);
   - coluna **B = MLB** (opcional, só para conferência);
   - coluna **C = Custo** (número, em reais);
   - coluna **D = Status** (o script escreve aqui; deixe vazia);
   - a linha 1 é o cabeçalho.
4. **Extensões → Apps Script**: apague o que houver, cole o script copiado e salve.
5. Escolha a função **`instalar`** e clique em **Executar**. O Google pede autorização (pode aparecer o aviso de "app não verificado": é o script do próprio cliente; clique em *Avançado → Acessar*). Depois de rodar, **apague a função `instalar`** do código e salve (o segredo fica guardado só nas propriedades do script).
6. Volte à planilha e recarregue: aparece o menu **Custos → Sincronizar agora**. Clique.
7. Confira a coluna **Status**: `OK` = aceito; `REJEITADO: …` = o motivo (custo vazio, zero, texto, SKU repetido…); `EM ANÁLISE: …` = recebido, mas **ainda não vale** (veja Quarentena abaixo); `RECUSADO no painel — o painel mantém R$ X` = valor que o dono já recusou (o anterior continua); `ENVIADO … (confira no painel)` = o resumo do servidor não fechou a conta, confira no painel. Aba `Custos` que já existia com outro cabeçalho não é tocada: o motivo vai para o `Sync_Log` e o menu **Custos → Criar aba-modelo** cria `Custos (Place Sprints)`. A aba `Sync_Log` registra cada envio.
8. No painel, **Promoções → aba Custos**: os SKUs aparecem com fonte "sheets". Rode o analista: o anúncio com esse SKU sai de "SEM CUSTO" e passa a ter MC.

Depois disso não precisa fazer mais nada: o script envia sozinho a cada 10 minutos quando algo muda e reenvia tudo 1×/dia (para o painel saber que a planilha está viva).

Cuidados com a planilha:
- **Qualquer pessoa que edita a planilha consegue ver o segredo** dentro do script. Mantenha poucos editores. Se alguém saiu da equipe, use **Rotacionar** (o segredo antigo ainda funciona por 24 h, tempo de colar o script novo; para colar só a URL e o segredo novos, use o menu **Custos → Configurar**).
- **Copiou a planilha?** Gere um webhook novo para a cópia (o segredo não deve ser reaproveitado).
- SKU repetido com custos diferentes: as duas linhas são rejeitadas (o sistema não escolhe uma em silêncio).
- Custo **0** (brinde) é rejeitado de propósito: custo zero faria a margem parecer maior do que é.

---

## Bling

O que é lido: o **preço de custo do fornecedor padrão** de cada produto (o Bling não entrega custo médio pela API). Nada é gravado no Bling.

Passo a passo (modo padrão: aplicativo público da Place2u):
1. Uma vez só, o dono cadastra o aplicativo da Place2u no Bling (com escopos **somente leitura**: Produtos e dados básicos da empresa) e digita `client_id` e `client_secret` no painel. Esses dados ficam cifrados e nunca voltam para a tela. **Atenção:** mudar os escopos do aplicativo depois desconecta todos os clientes; antes da homologação do Bling, no máximo 10 clientes podem autorizar.
2. Integrações → Custos → **Bling → Gerar link de autorização**. Envie o link ao cliente (ou acompanhe por chamada): ele entra no Bling com o login dele e autoriza. Plano mínimo do cliente no Bling: Cobalto.
3. Pronto: o painel lê os custos todo dia a partir das 03h. Para ler na hora: **Sincronizar agora**.

Alternativa (modo próprio): o cliente cria um aplicativo privado na conta dele e digita `client_id`/`client_secret` na tela. Serve para quem não quer o aplicativo público.

Bom saber:
- Produto sem custo, sem SKU ou sem fornecedor padrão aparece como **rejeitado** (nunca como custo zero).
- Kit: o custo é a soma dos componentes **somente** se o Bling entregar a composição e todos os componentes tiverem custo; senão o kit fica pendente.
- O aviso automático do Bling ("webhook") está **desligado** (`PS_BLING_WEBHOOK=0`): a leitura diária é a garantia. Só ligar depois do piloto.
- Para desconectar: **Desconectar** no painel e, no Bling, desinstale o aplicativo em "Minhas Instalações".

---

## Tiny / Olist

O que é lido: o **preço de custo** (`precoCusto`) de cada produto. Por cliente dá para trocar para **custo médio**; não há "plano B" entre os dois campos: se o campo escolhido estiver vazio, o SKU é rejeitado com uma dica (mesmo que o outro campo tenha valor).

Passo a passo:
1. O cliente precisa do plano **Construa ou superior** e da extensão "Gestão de Aplicativos".
2. Na conta dele: Configurações → Aplicativos → **+ novo aplicativo**, com permissão **só de Leitura no módulo Produtos** e o endereço de retorno `${PUBLIC_BASE_URL}/erp/callback`.
3. No painel: Integrações → Custos → **Tiny**: digite `client_id` e `client_secret` do aplicativo → **Gerar link de autorização** → o cliente autoriza com o login dele.
4. Leitura diária a partir das 03h e **Sincronizar agora**.

Bom saber:
- A autorização do Tiny vence se ficar **mais de 1 dia** sem renovar. O painel renova sozinho enquanto estiver ligado; se o Mac ficar desligado mais de um dia, o cartão mostra **reautorizar** e o cliente precisa autorizar de novo.
- O custo do Tiny só se atualiza quando o cliente lança nota de entrada, ordem de compra ou usa "Formação de Preços". Se ele não faz isso, o custo fica vazio ou velho.
- Erro de permissão (401) costuma ser o usuário sem acesso ao módulo Produtos, não senha errada.

---

## Subir planilha de custos na tela (15/10/2026)

Para o cliente que manda uma planilha (sem ERP nem Apps Script): **/cliente › Configurar › Subir planilha de custos**.

1. Escolha o arquivo **.csv** ou **.xlsx** (até 5 MB; o `.xls` antigo: abra no Excel e salve como `.xlsx`) e clique em **Ver prévia**. Nada é gravado.
2. As colunas são achadas pelo nome, em qualquer ordem, mesmo com uma linha de título antes do cabeçalho: **SKU** (código, referência), **anúncio** (MLB, ID do anúncio — aceita `MLB123…`, `mlb-123…`, o link do anúncio ou só os números), **custo** (custo unitário, preço de custo, CMV) e, se houver, título, kit/quantidade, fornecedor, prazo de reposição (dias) e NCM. Custo em `R$ 1.234,56`, `12,50` ou `1234.56`; `1.234` (milhar ou decimal?) é recusado; custo em branco = linha ignorada (modelo ainda não preenchido).
3. A prévia mostra quantas linhas casaram por critério, os anúncios que recebem custo (MLB, título, preço, custo, **margem bruta = preço − custo − tarifa da última venda**, «—» sem venda), o efeito na curva A/B, as linhas sem par (com até 3 anúncios de título parecido — só sugestão), os conflitos, a quarentena e as linhas inválidas com o motivo.
4. **Aplicar custos…** abre a confirmação: seu nome (líder, consultor ou o CS do cliente) e **Confirmar**. Grava pela mesma porta das outras fontes (`aplicarLote`, fonte `upload`), cria o vínculo das linhas com MLB, registra no livro do cliente (resumo + sha256 do arquivo), grava o prazo de reposição por anúncio (fonte «cliente») e recalcula o diagnóstico (margem, lucro F4 e Guardião leem o custo novo; o plano regera no próximo ciclo; a pendência «custos dos produtos» deixa de listar os itens cobertos).

Como a linha vira custo do anúncio (a mesma resolução única de `custo-vinculo.js`, que desde 15/10 lê também o SKU oficial do anúncio e das variações gravado na coleta, `meli_anuncio_up`):
- **MLB na linha** manda: o custo vale para aquele anúncio (se a linha também tiver SKU e ele não for o do anúncio no ML, é **conflito** e nada é casado);
- **SKU exato** do anúncio ou da variação (`promo_anuncio` + `meli_anuncio_up`, só SELLER_SKU — o campo livre `seller_custom_field` não conta);
- **SKU sem espaço e hífen**, só quando a chave aponta para um único custo;
- **mesmo produto** (mesmo `user_product_id` ou `inventory_id`) de um anúncio já resolvido;
- variações com SKUs diferentes: o anúncio ganha custo quando todas têm o **mesmo** custo; custos diferentes = sem custo único do anúncio (a venda de cada variação usa o dela no lucro F4);
- **título parecido nunca grava**: só sugere (vincule em Promoções › Custos).

Kit: a coluna kit/quantidade marca a linha como kit; o custo do kit é o informado (a composição, quando existe, aparece na prévia). Conflitos: o mesmo SKU (ou o mesmo MLB) com dois custos = nenhuma das linhas vale; custo ≥ preço do anúncio = quarentena, como nas outras fontes. O original fica em `data/custos-upload/<hash do cliente>/` (o arquivo nunca vai para o banco). Rotas: `POST /api/cliente/custos/upload` (multipart `cliente` + `arquivo`; prévia) e `POST /api/cliente/custos/upload/confirmar` `{ upload_id, por, confirmar: true }`. Teste: `scripts/teste-upload-custos.mjs`.

## Quarentena: quando um custo novo parece errado

Um custo novo **não substitui** o atual, e vai para revisão, quando:
- muda **mais de 50%** em relação ao custo atual da mesma fonte (pega vírgula no lugar errado, unidade trocada);
- fica **igual ou acima do preço cheio** do anúncio (custo maior que o preço é quase sempre erro);
- é um **kit** cujo custo próprio difere mais de 1% da soma dos componentes.

Enquanto está em quarentena, a margem continua calculada com o custo anterior. Em Integrações (botão **Quarentena (N)**) ou na aba Custos de Promoções você **Aprova** (o novo passa a valer) ou **Recusa** (o mesmo valor não volta a pedir revisão; um valor diferente pede de novo). Tudo fica no histórico do SKU com quem decidiu.

Atenção: custo que muda pode mudar a margem e **cancelar aprovações** de promoção feitas com a margem antiga (é proposital: a aprovação valia para outros números).

---

## Como vincular custo ao anúncio (07/10/2026)

Quando o custo foi cadastrado com outro nome (ex.: União Dog: "Peitoral Tamanho P" na planilha, `PEITORALH-2-P` no anúncio) ou o anúncio não tem SKU, a ligação é feita na tela: **Promoções → cliente → aba Custos**, logo no topo.

1. **Custos sem anúncio:** cada custo cadastrado que não vale para nenhum anúncio, com até 5 anúncios parecidos pelo nome (miniatura, título, MLB, SKU e "semelhança N%"; tamanhos P/M/G contam e um tamanho diferente exclui o anúncio). **Confirmar** liga o custo àquele anúncio; **Não é este** tira o candidato de vez. Nenhum candidato serve? Digite o **ID do anúncio (MLB…)** e clique em **Vincular**.
2. **Anúncios sem custo:** anúncios ativos sem custo, do maior faturamento em 30 dias para o menor. Em **Escolher custo**, digite para buscar o SKU de custo e clique em **Vincular**.
3. **Custo por anúncio:** todo anúncio com custo e a **origem do custo** — *manual* (vínculo feito à mão; manda sobre o SKU), *SKU* (igual ao do custo), *SKU normalizado* (igual sem espaço e hífen; só quando um único custo casa) ou *herdado* (de outro anúncio do mesmo produto). O manual se desfaz com **Desvincular**; um automático errado sai com **Não é este**.

Atalho: na aba **Elegíveis**, a célula "SEM CUSTO" tem **Vincular custo**, que abre a aba Custos já no anúncio. Cada vínculo grava quem fez (o nome do perfil; sem ele a tela pergunta) e entra na auditoria. Mudar um vínculo invalida aprovações antigas de promoção daquele anúncio (o selo da rodada muda). A tarifa e o frete passam a ser coletados também para o anúncio vinculado à mão, e o custo do anúncio entra na margem do plano de ação (diagnóstico da conta). Fora do escopo por enquanto: custo de kit (soma de componentes) e custo por variação.

---

## Reconciliação: o que ficou de fora

Botão **Reconciliação** no cartão (as listas dependem de o cliente já ter feito uma coleta de promoções):

| Lista | O que mostra | O que fazer |
|---|---|---|
| SKU do ERP sem anúncio | custos que não batem com nenhum anúncio coletado (nem pelo SKU, nem por vínculo; o par marcado "Não é este" não conta) | normal para produto que não está no Mercado Livre; ou vincular na aba Custos de Promoções |
| Anúncio sem custo | anúncio com SKU, mas nenhuma fonte trouxe custo | cadastrar o custo na fonte |
| Anúncio sem SKU | anúncio sem SKU no Mercado Livre (nenhum custo chega nele) | colocar o SKU no anúncio |
| Conflito | a linha disse um MLB cujo anúncio tem outro SKU | corrigir a planilha/ERP |
| Rejeitadas | linhas recusadas, com o motivo | corrigir na fonte |
| Quarentena | valores esperando decisão | aprovar ou recusar |
| Não visto | SKU que sumiu do último envio completo (o custo **continua valendo**, nada é apagado) | conferir se o produto saiu do ERP/planilha; descartar se for o caso |
| Kits pendentes | kits sem composição ou com componente sem custo | completar a composição no ERP |
| Divergência entre fontes | o mesmo SKU com custos diferentes em fontes diferentes | decidir qual fonte vale (ordem de precedência) |

**Qual custo vale quando há mais de uma fonte:** o que você digitou na aba Custos (manual) > planilha subida na tela (upload) > Bling > Tiny > planilha do webhook. A ordem pode ser mudada por cliente; fonte tirada da lista deixa de ser usada.

**Custo velho:** se a fonte não sincroniza há mais de **3 dias** (ERP) ou **14 dias** (planilha), aparece a pendência "custo velho" em Promoções. O custo antigo continua valendo; a pendência só avisa.

---

## O que NÃO foi validado (seja honesto com o cliente)

Tudo abaixo funciona nos testes com dados de exemplo construídos a partir da documentação oficial, mas **nunca rodou contra o sistema real**:
- toda a API do Bling e do Tiny: formato das listas, onde o custo realmente aparece, variações, kits, limites de uso e paginação;
- o login (OAuth) real dos dois ERPs, inclusive se o Tiny devolve o `state` no retorno e se a renovação troca a chave a cada vez;
- a assinatura do aviso do Bling (por isso ele está desligado) e se editar o custo na tela do Bling dispara o aviso;
- o Apps Script dentro do Google de verdade (autorização, envio, tipos de célula como `#N/A`) e se o Cloudflare deixa passar o envio do Google;
- se a Olist exige homologação para a Place2u ler vários clientes (pergunta a enviar para `erp.partners@olist.com`).

Nada disso é escondido: o que não foi visto está marcado como **NÃO CONFIRMADO** na especificação (`docs/integracao-custos-erp-SPEC.md`).

---

## Checklist de validação

### Fase 1 — planilha (10 minutos, sem ERP)
1. `ERP_TOKEN_KEY` no `.env`, `PUBLIC_BASE_URL` conferido, painel reiniciado.
2. Integrações → cartão do cliente-teste → **Planilha → Gerar webhook** → **Copiar Apps Script pronto**.
3. Planilha com a aba `Custos` (coluna A em *Texto simples*) e 5 linhas: 3 SKUs válidos (um deles de anúncio real do cliente), 1 com custo `0`, 1 com o texto `abc`. Cole o script, rode `instalar`, autorize, **apague `instalar`**.
4. **Custos → Sincronizar agora**. Esperado: `OK` nos 3 válidos; `REJEITADO` com motivo nos outros 2; 1 lote na aba `Sync_Log`.
5. Promoções → aba Custos: os 3 SKUs com fonte "sheets" e frescor "agora". Rode o analista: o anúncio daquele SKU sai de "SEM CUSTO" e ganha MC.
6. Sincronize de novo sem mexer: continua `OK` e nada novo no histórico.
7. Aumente um custo em 80%: Status `EM ANÁLISE`; o valor antigo continua valendo; aprove no painel e veja o histórico (recusou? a próxima sincronização mostra `RECUSADO no painel — o painel mantém R$ X`).
8. Chame a URL do webhook sem assinatura (ex.: `curl -X POST <url>`): resposta `401` sem nenhum detalhe. Rotacione o segredo e confirme que o script antigo ainda funciona por 24 h.

### Fase 2 — piloto de ERP (1 cliente por ERP, com conta cooperante)
**Bling** (aplicativo só com leitura):
- em 5 SKUs (incluindo 1 sem fornecedor padrão, 1 variação e 1 kit), comparar o custo da listagem, do detalhe e da tela do Bling;
- contar quantos produtos a listagem traz contra a tela de Produtos (zerados e excluídos);
- editar o custo na tela, por nota de entrada e por planilha, e ver se chega o aviso `product_supplier.updated`;
- conferir a assinatura do aviso num evento real;
- ver quanto tempo dura o acesso (`expires_in`) e se a chave de renovação muda a cada renovação;
- confirmar qual escopo libera `GET /produtos/fornecedores` e perguntar ao suporte se existe custo médio na API.

**Tiny** (plano Construa+, permissão Leitura em Produtos):
- tamanho máximo de página (`limit`), situação padrão da listagem, se variações aparecem na lista (e com custo), se mudar só o custo muda a `dataAlteracao`, qual erro aparece ao estourar o limite, se a chave de renovação muda, custo do kit, se o `state` volta no retorno, se o SKU é único na conta;
- enviar a pergunta de homologação à Olist.

---

Para a equipe técnica: rotas e regras em `docs/integracao-custos-erp-SPEC.md`; integração com Promoções em `docs/promocoes-por-cliente.md` §10; testes sem rede com `npm run teste:custos`.
