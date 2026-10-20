---
name: oferta-mkt
description: 'Constrói a OFERTA inteira de um produto para marketplace (galeria de imagens pelo molde validado + descrição + título) no repo Oferta-Mkt. Use quando o dono pedir "oferta nova", "galeria nova", "monta as fotos do anúncio", "cadastro de produto", ou der um link/SKU para criar/melhorar anúncio — em qualquer marketplace (Meli, Magalu, Shopee). Também SEMPRE que ele pedir para editar, trocar, melhorar ou regenerar UMA imagem (capa, foto, tela, mostrador, notificação na tela) de produto deste repo — mesmo sem falar em oferta: é o "modo imagem avulsa". E SEMPRE que ele falar em FICHA TÉCNICA de um anúncio que já está no ar — "otimiza a ficha", "indexa palavras novas no campo modelo/fabricante", "cauda longa", "quero aparecer em mais buscas", "a ficha está vazia", ou der um MLB pedindo mais palavras-chave: é o "modo ficha avulsa" (o título trava na 1ª venda; a ficha é a alavanca que sobra). NÃO use para análise de concorrência (repo radar-concorrencia-ml).'
---

# Oferta-Mkt — a oferta inteira por molde validado

O método completo vive neste repo: `plans/025` (fluxo), `MOLDE/*/regua.md`
(régua + G1-G7), `APRENDIZADO.md` (o que o dono já aprovou/reprovou).
Rodada 15/15 de referência: `produtos/zw01ai-01esporte-2026-08/jobs/`.

## Fluxo (nunca pule o GATE)

1. **BRIEFING** — produto + conta + SKU + referência por UMA das 3 vias
   (pesquisa com grade de confirmação · link de rival · SharePoint por SKU —
   detalhes em `plans/025`). Criar `produtos/<produto>-<conta>-<AAAA-MM>/`.
2. **FICHA** — `ficha-travada.md`: só fato com fonte. Contradição → pergunta.
2b. **>>> GATE 0 — MODELO DE REFERÊNCIA DO PRODUTO <<<** (plano 042; nasceu de
   03/09/2026, quando a galeria inteira do Prime AI saiu com o relógio do ZW01
   AI porque o Bling chama o SMART-ZWAI de "ZW01 PRIME AI" — 44 candidatas e 7
   finais no lixo; o dono só viu nas finais).
   - A imagem-base do PRODUTO vem só de três lugares: a galeria do PRÓPRIO
     anúncio (o MLB do briefing), foto que o dono mandou, ou a pasta da SKU no
     SharePoint. Nunca de pasta de outro produto por semelhança de nome ou
     sigla — sigla parecida não é o mesmo produto.
   - Recorte as bases sem texto, monte `bases/00-bases-<produto>.jpg` (folha
     com as bases em tamanho grande) e escreva as "Assinaturas físicas" da
     ficha OLHANDO a base ao lado da capa atual do anúncio: formato da caixa,
     botão × coroa, encaixe da pulseira, cor, fivela. Aponte o botão/coroa na
     base — ou escreva que NÃO há nenhum, com o mesmo peso ("NENHUM botão
     lateral; a única tecla é o círculo de toque na tela"). Em 08/09 o D20, de
     laterais lisas, ganhou "um botão oval" na assinatura por hábito: o gerador
     desenhou o botão em 6 fotos e os juízes aprovaram, porque medem fidelidade
     contra a assinatura que você escreveu. Assinatura em dúvida → pergunte ao
     dono antes do lote.
   - Envie a folha ao dono (`SendUserFile`) com a pergunta literal: **"É ESTE o
     produto? (caixa, botão e pulseira conferem?)"** — e PARE. O dono enxerga
     em 5 segundos o que 9 juízes cegos não enxergam, porque o juiz mede
     fidelidade contra a base que você deu a ele.
   - Só com o "sim" dele: grave `bases/CONFIRMACAO.json` (formato em
     `plans/042`: origem de cada base `anuncio:MLB…:foto-N` / `foto-do-dono:` /
     `sharepoint:…`, `referencia_fidelidade` = capa atual, assinaturas,
     `confirmado_pelo_dono: true`, palavras dele). `montar-lote.mjs` e
     `montar-avulso.mjs` ABORTAM sem esse arquivo — não existe atalho.
3. **MOLDE** — mapa de posições a partir de `MOLDE/<molde>/molde.md` +
   `valores.json` com TODOS os placeholders.
4. **>>> GATE 1 <<<** — mostrar ao dono a tabela posição · objeção · título ·
   subtítulo, abrindo com a folha das bases confirmadas em tamanho grande
   (nunca um thumb). NADA é gerado antes do aval dele. **O canal de aprovação é a
   página da skill `quadro-aprovacao`** (validada por ele em 04/10/2026): o GATE 1
   e cada rodada de fotos/cores vão para lá, com a pasta do Desktop junto.
5. **LOTE** — antes de qualquer `.mjs`:
   `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"` (node vive no
   nvm, fora do PATH de login). `bin/montar-lote.mjs <slug>` →
   `bin/rodar-lote.sh <slug>`
   (4 candidatas, teto 3 rodadas, retomada). Julgar com o agente
   **juiz-cego** (um por posição, NUNCA vê o raciocínio de quem gerou);
   gravar veredito validado por `bin/veredito.mjs`. Texto nas artes: SEMPRE
   por HTML+Playwright (G6), título ≤31 chars VALIDADO antes de renderizar.
6. **ENTREGA** — `finais/` + `bin/relatorio.mjs` + pasta datada no Desktop +
   entrada no `APRENDIZADO.md` (a CAUSA, nunca só o efeito).
7. **TEXTO** — descrição e TÍTULO (skill `descricoes-marketplace`), sobre a
   ficha travada. Título vem DEPOIS das imagens. Os candidatos (8 por conta, ≤60,
   =LEN ao lado) vão para a aba **CAUDA LONGA** da `ORGANIZAÇÃO <SKU>.xlsx` na
   pasta da SKU (OneDrive) — é lá que ele edita e aprova: **aprovado = célula
   pintada de amarelo** (`fill.fgColor.rgb == FFFFFF00`). O título que vira o
   SEO dos arquivos ele indica à parte; pergunte se não disser (03/10, W12 Mini).
8. **APLICAR** — dry-run + read-back; só com "ok" explícito do dono; em item
   com variações, gravar SÓ na variação alvo. Item COM variações: o PUT leva
   `pictures` (união de todos os ids) E `variations[].picture_ids` — só
   `variations` devolve 400 `item.pictures.invalid.missing_ids` (D20 e W11,
   08/09; receita em `mcp-bling-ml/src/scripts/_galeria-d20-2026-09-08.mjs`).
   O read-back logo depois do PUT não prova que a capa ficou: ~25 min depois o
   ML trocou sozinho `pictures[0]` por um recorte em fundo branco (id novo,
   não quadrado) e o dono viu antes de mim. Reconfira `pictures[0]` 30-60 min
   depois (id, tamanho, cantos iguais ao arquivo) e, se trocou, avise-o ANTES
   de regravar.
9. **ARQUIVAR** — slug = título aprovado normalizado (kebab, sem acento) +
   posição; subir à pasta da SKU no SharePoint (`config.json` tem drive/item);
   mostrar `posição → nome final` e conferir por read-back (md5).
   **Produto com cores:** uma pasta por cor (`<SKU>/COMUM/Fotos/GALERIA FINAL
   (SEO)/PRETO|ROSA|BRANCO/`) com a galeria COMPLETA daquela cor — as fotos
   comuns às cores são COPIADAS em cada pasta, porque ele sobe cor por cor
   ("na hora de subir fica mais fácil") — e as capas do teste A/B numa subpasta
   `01 - CAPA (escolha 1 para o teste A-B)/`. Nome `<slug>-<cor>-NN.jpg`, NN de
   dois dígitos, para a ordem alfabética ser a ordem do anúncio. **A ordem oficial
   é a dele:** ele reordena renomeando a pasta PRETO (deixa nomes como `9`, `09`,
   `10.1`); leia pela ordem do Finder (`localizedStandardCompare` num script
   `swift`), mapeie cada arquivo à foto por md5, renumere 02–11 limpo e aplique
   às outras cores; grave em `finais/ORDEM-OFICIAL.json`. Pasta antiga só sai
   depois de cada arquivo dela conferido por md5 na nova (W12 Mini, 03/10).

## Modo imagem avulsa (1 imagem, sem o molde de 10 posições)

Para "edita a capa", "troca a tela", "coloca notificação", "regenera essa foto":

1. **SKU e conta** (DropX `consultar_anuncio` pelo MLB; 403 também quer dizer
   "item da OUTRA conta" — tente a outra antes de concluir que é de terceiro:
   em 08/09 o MLB5209074144 deu 403 na 01smart e OK na 01esporte; em 21/09 a
   página "Loja Oficial 01Smart" era o ZW13 da 01Esporte — a loja 464922 é dela).
   Link `/up/MLBU…` é *user product*, não item: abra a página pela ponte e pegue
   o `MLB` de **10 dígitos** no HTML (os de 11 dígitos, `MLB93…`, são picture
   ids). Pasta `produtos/<produto>-<conta>-<AAAA-MM>/` — reaproveite se existir.
   **Anúncio de CATÁLOGO (`catalog_listing: true`) não tem capa própria** — confira
   ANTES da direção (22/09, MLB5769758762): o formulário de edição do item não tem
   seção de fotos; a capa exibida na busca é a da ficha do catálogo
   (`catalog_product_id`). A única via é
   `vendedores.mercadolivre.com.br/catalogo/sugerencias/corregir/<MLB…>` → Fotos →
   FOTO DE CAPA, com revisão do ML, e a arte aprovada passa a valer para TODOS os
   vendedores daquele catálogo. Diga isso ao dono no topo, junto de quem tem o
   buy-box (painel do item: "GANHANDO"), antes de gastar Codex.
2. **Base** = a foto atual do anúncio em alta: página do ML via
   `playwright-esporte`/`playwright-smart` (a página bloqueia o Playwright
   genérico com captcha), pegar a URL `mlstatic.com/..._-F.webp` da galeria e
   baixar com `curl` para `bases/` (WebP → PNG com PIL; `sips` não converte).
   **OLHE o arquivo baixado (Read) antes de usá-lo como base** — a lista de
   `<img>` da página traz frames de vídeo e imagens alheias (02/09: a "capa do
   rival" era água num copo e virou imagem 2 sem conferência).
   Referência de cena do rival (se houver): também em `bases/`, marcada como
   imagem 2 = ESTILO, nunca produto. A galeria do rival só sai pela página
   (`playwright-*` + `curl` no CDN mlstatic): a API pública e o
   `consultar_anuncio` devolvem 403 para item de terceiro.
   **Cena aprovada de outra rodada NÃO entra como referência se o produto nela
   está errado**: em 04/09 as 8 candidatas da foto de mensagens copiaram o braço
   torto e 3 copiaram a caixa do ZW01 que estavam na cena — descreva a cena em
   texto e deixe só as bases do produto.
   **O GATE 0 vale aqui também:** folha da base em tamanho grande ao dono com
   "É ESTE o produto?" e `bases/CONFIRMACAO.json` gravado com o sim dele antes
   do `montar-avulso` (que aborta sem o arquivo).
   **Galeria só com arte de fabricante (texto em tudo) e o dono manda um link
   "só para conhecimento"** (21/09, ZW13 × página da Haylou): confira a FICHA da
   página (modelo, tela, BT, mAh) e as assinaturas foto a foto contra a capa do
   anúncio; batendo, as fotos limpas viram bases com origem `foto-do-dono:<link>`
   (1000 px → centralizar em 1200×1200) — foram elas que provaram fidelidade nos
   4 vereditos (perfil com coroa/botão, fivela). Não batendo, é só conhecimento.
   **Fotos oficiais que divergem num detalhe** (fivela preta numa, prata na
   capa) não são "assinatura em dúvida" para perguntar: escreva "as duas
   aceitas" no CONFIRMACAO.json — 3 juízes listaram como leve, nenhum reprovou.
2c. **Meça a capa atual contra as vizinhas de busca ANTES de propor direção.**
   Abra a busca do termo do título pela ponte, pegue o `src` das 12 primeiras
   capas, baixe pelo CDN e compare cada uma com a nossa por **MAE em escala de
   cinza, 256×256**. MAE abaixo de ~5 quer dizer a MESMA arte de fábrica em dois
   anúncios: em 22/09 a capa do MLB5397991916 deu **0,93** contra a do rival de
   R$ 184,90 exibido dois cards ao lado — o cliente via o mesmo produto e
   decidia pelo preço. Isso troca o argumento da rodada (deixa de ser "melhorar
   o design" e vira "sair do empate com o mais barato") e a folha do grid a
   160 px mostra ao dono, em 5 segundos, o que a nossa capa perde para as
   outras. Custa 2 minutos e vale para qualquer capa de arte de fornecedor.
   **Meça também o TAMANHO da capa**: a do MLB5769758762 era 1200×871 — no card
   quadrado perdia ~27% da área para faixas brancas. Capa não quadrada é achado
   mecânico e entra no diagnóstico antes de qualquer argumento de estética.
2d. **Watchface e ícone de tela vêm de fonte real, nunca da minha cabeça** (22/09,
   ZW02 Pro — o dono chamou a tela que eu desenhei de "horrível"):
   - ranqueie as campanhas de Ads das duas contas por CTR (`ads_campanhas`,
     ≥3.000 impressões) e baixe a capa das melhores
     (`mcp-bling-ml/src/scripts/_capas-anuncios-ml.mjs <conta> <MLB…>`). Em
     09/2026 o padrão dos campeões era **imagem rica (foto de pessoa, obra de
     arte, gradiente) + hora grande com dia da semana** — nunca tela geométrica
     de indicadores;
   - procure o watchface na galeria do PRÓPRIO produto e dos anúncios irmãos
     (`_galeria-anuncio-ml.mjs <conta> <MLB>`) e recorte o mostrador da foto
     oficial corrigindo a perspectiva (elipse → círculo) para usar como `ui-…`;
   - ícone de UI (chamada, app): peça/use a referência do dono ou captura real.
     Atender e desligar são DOIS ícones diferentes (`call` = fone em pé, verde à
     ESQUERDA; `call_end` = fone DEITADO, vermelho à direita) — girar o primeiro
     nunca vira o segundo. Glifo de fonte do sistema não serve (U+260E é telefone
     de mesa) e o `Apple Color Emoji` não abre no PIL desta máquina
     (`invalid pixel size`). Receita que funcionou: silhueta branca extraída do
     print do dono (`R,G,B>190`), NEAREST para 640 px, 4 passadas de
     `GaussianBlur`+threshold (22→14→8→4) e blur final 1,6 → 8/8 letra a letra.
3. **Direção escrita** — 1 parágrafo por versão (cena, o que muda, o que fica,
   o que PODE alterar levemente) + prompt Trocar/Preservar. **A lista PRESERVAR
   só pode conter o que você aponta num recorte AMPLIADO da base** — em 22/09
   escrevi "passador PRETO de silicone" sem ampliar a peça, a capa do anúncio
   tem passador cinza-metal, e as 8 candidatas foram entregues ao dono com uma
   "invenção do gerador" que não existia. Assinatura que você não consegue
   mostrar na base não entra no prompt nem no `CONFIRMACAO.json`.
   **>>> GATE: o dono aprova a direção ANTES de qualquer geração.**
4. `node bin/montar-avulso.mjs <slug> <posição> --prompt <txt> --base <img>...`
   → `bash bin/rodar-lote.sh <slug> <posição>` (4 candidatas; exit 3 = cota,
   parar limpo).
5. **juiz-cego** (uma instância por posição, nunca vê o raciocínio) →
   `veredito.json` validado, com `alteracoes_produto` listadas. **Só na rodada
   1: "faz o juiz verificador dá apenas 1 feedback, na segunda rodada serei eu"**
   (dono, 22/09). Da rodada 2 em diante, aplique o acabamento nas 4 candidatas,
   monte a folha `00-ESCOLHA.jpg` (arte atual ao lado + tira de 160 px) e
   entregue — o juiz serve para a primeira leitura (botão a mais, texto errado
   na tela, margem fora da régua), não para escolher por ele.
6. Acabamento: `finalizar_imagem.py --capa` → 1200×1200, JPEG 4:4:4, teste 160.
7. Entrega em pasta datada no Desktop com um `LEIA-ME.md` que lista, por
   versão, as **alterações no produto** apontadas pelo juiz. O dono escolhe.
   **UMA pasta por produto no Desktop, atualizada a cada rodada** — em 22/09
   foram 4 pastas + 5 folhas de escolha e o dono disse "tô perdido". Rodada nova
   substitui a folha e o conteúdo da mesma pasta; reprovadas vão para
   `finais/_reprovadas/` (mover, nunca apagar). Antes de reescrever a pasta,
   liste o que está nela: o dono pode ter apagado as que não quer.
   **Dentro dela, só `APROVADAS/` + `REVISAR-<o-quê>/`** com o que ele precisa olhar
   agora; reprovada não vai para o Desktop (o repo guarda) — pedido dele em 22/09:
   *"apaga tudo que foi reprovado... só deixa o que é novo e o que foi aprovado"*.
   Decidiu, some o `REVISAR-`. Antes de limpar, preserve TODA candidata que ele
   citou pelo número, mesmo com ajuste pendente (`aprovada: null` no veredito): a
   limpeza de 22/09 apagou as duas escolhidas e elas voltaram do git.

**Proibido neste modo:** compor a foto à mão (PIL/HTML/recorte/perspectiva),
editar a saída de uma rodada anterior (G1), pular o gate da direção.
**Trocar SÓ um elemento de uma arte que o dono aprovou** (mostrador, tela, foto na
tela, ícone) é EDIÇÃO, nunca rodada nova nem posição nova com "a cena varia um
pouco" (22/09, Redondo Mini 01 e 06: a rodada redesenhou a cena inteira e ele
reprovou — *"era só trocar as watchface, não dá mais nada... era pra você ter
mantido o restante da foto"*). Método que ele aprovou: o gerador edita partindo da
APROVADA (ela vira a base desta edição) e `texto/colar-regioes.py` (Redondo Mini)
alinha a saída e cola de volta SÓ a região —
`--caixa x0,y0,x1,y1,<elipse|rect|circulo> --forma hull --dilatar 2`; fora dela a arte
é a aprovada, pixel a pixel (confira a "diferença média FORA das regiões" ≈ 2/255).
Disco/selo flutuante pode ser encaixado por código se o CONTEÚDO vier de uma folha
renderizada pelo gerador (`texto/trocar-mostradores.py`). No prompt, descreva só o
que MUDA: "mantenha o layout aprovado" faz o gerador pedir a imagem e não gerar nada.
**Mexer só no TEXTO de uma arte aprovada** (tirar de cima do rosto, trocar um item
da lista) não passa pelo gerador: edite o spec e remonte pela cena aprovada com
`texto/montar-arte-cena.py` (Redondo Mini). Antes de mudar, remonte a final atual e
confira que sai byte a byte igual — é a prova de que só o texto mexe. Meça a área
livre antes de posicionar (contraste do navy por coluna): em 22/09 a parede lisa
tinha só ~310 px, o título virou `titulo_linhas` empilhado ("+100" grande) e
`ancora.halo` (só no subtítulo) resolveu o trecho sobre planta escura sem véu.
**Texto sobre a arte nunca cobre rosto, mão, relógio ou mostrador — nem com véu.**
Se o layout que o dono aprovou cobre, a versão corrigida vai JUNTO na entrega; aviso
no LEIA-ME não conserta (22/09: avisei "o título fica sobre os olhos" e ele voltou
pedindo "o rosto do modelo não ser tampado").
**Rubrica do juiz não pode brigar com o prompt nem com o que o dono já aprovou**
(22/09): pedi "gotas sobre o vidro do herói" (78% da altura) e ao mesmo tempo
"toda a água abaixo de 50%" — 4 candidatas boas caíram pela contradição. Critério
meu que conflita com aprovação dele sai da rubrica.

## Modo ficha avulsa (otimizar a ficha de um anúncio que já está no ar)

Para "otimiza a ficha", "indexa palavras novas no modelo/fabricante", "a ficha
está vazia", "quero aparecer em mais buscas". É a alavanca que sobra quando o
título já travou na 1ª venda — e costuma estar quase toda vazia.

**Os passos abaixo são do Mercado Livre.** Na **Magalu** a ficha segue outro molde,
`MOLDE/ficha-magalu/README.md` (método do dono: cauda longa no Modelo, nomes livres,
8 a 10 campos de conteúdo, mais Anatel/Anvisa/MAPA), e a **subida** de anúncio novo
é a skill `cadastro-anuncio-magalu` (plano 058). Não aplique a janela de 40 c do ML na Magalu.

1. **Leia a ficha inteira antes de propor**:
   `bash ~/Projetos/mcp-bling-ml/src/scripts/dropx-rodar.sh src/scripts/_ficha-anuncio-ml.mjs <conta> <MLB>`
   devolve item, atributos preenchidos, os VAZIOS, a descrição e o catálogo de
   atributos da categoria. Sem isso você não sabe quais campos existem: a API
   pública `/items/{id}` responde 403 (PolicyAgent) desde 09/2026 — só com token.
   403 do `consultar_anuncio` também quer dizer "item da OUTRA conta": tente a outra.
2. **O molde `MOLDE/ficha-smartwatch/` é método, não lista de campos.** Viajam as
   4 regras (janela de 40 c · não repetir palavra do título · variedade máxima ·
   `termos-proibidos.json`). Não viajam nem a lista de 10 campos nem os valores
   fixos: em MLB1664 (fones) só existem 5 campos de texto livre, e
   `LINE = "Compatível Samsung Galaxy Xiaomi iPhone"` seria MENTIRA num fone
   Lightning. Valor fixo vale para a família em que nasceu — confira se é verdade
   neste produto antes de copiar.
2a. **Os três slots de cauda longa têm forma fixa (dono, 06/10/2026, reprovando a prévia do W12 Mini Pro):**
   `MODEL` = nome **comercial** do modelo + palavras-chave, igual em todos os anúncios da família mesmo repetindo
   (é o nome do catálogo e o que o cliente digita); `ALPHANUMERIC_MODEL` = só palavras-chave — **nunca SKU interno**
   (`W12PM`, `SMART-…`) nem o nome do modelo de novo; `MANUFACTURER` sem `01Smart` (já está em BRAND). As 4 regras do
   molde continuam valendo por cima (40 c, nenhuma palavra do título, variedade, termos proibidos). O exemplar que ele
   aprovou está em `MOLDE/ficha-smartwatch/molde.md` ("Exemplar aprovado pelo dono"): compare slot a slot antes de
   publicar a prévia, e mostre os slots já no formato final com a contagem de caracteres ao lado — ele reprovou a
   proposta do Pro por "W12PM" e "W12 Pro", não pelo conteúdo das palavras-chave. Plano 060.

3. **Palavras novas saem de fonte medida, não de intuição**: Trends do ML pelo
   JoomPulse (cubo `MlbCategoryKeywords`), na categoria do anúncio **e na irmã** —
   as genéricas se dividem entre elas (`headset` era #1 Most wanted em MLB1664 e
   `headphone`/`fone intra auricular` #7 e #10 em MLB196208). Só entra palavra que
   a própria ficha já sustenta (In-ear → "intra auricular"; Com microfone →
   "headset"), porque promessa falsa volta como reclamação.
4. **Procure a cauda sazonal vencida.** Campanha antiga ("kit dia dos pais") fica
   anos ocupando a janela de 40 c, às vezes dentro de `BRAND`, que é filtro
   lateral. Ninguém volta para limpar — então limpe junto.
5. **>>> GATE: prévia editável e o dono aprova campo a campo.** Artefato com
   `capabilities: {db:{}}`, contador de 40 c ao vivo, chip por palavra nova e
   status (Aprovo/Dúvida/Não) por campo; as marcações voltam por `ArtifactData`.
   Leia o db ANTES de aplicar mesmo que ele diga "pode aplicar" no chat — pode ter
   editado um texto ou marcado "Não" num campo.
6. **Aplicar** com o caminho pronto, que já faz backup, diff DE→PARA, lista de
   INTOCÁVEIS (GTIN, Anatel, SKU, cores, medidas) e read-back campo a campo:
   payload `{"attributes":[{id,value_name}]}` em `mcp-bling-ml/src/scripts/`, então
   `LIVE=1 bash src/scripts/dropx-rodar.sh src/scripts/_otimizar-ficha-mlb.mjs <conta> <MLB> <payload.json>`
   (sem `LIVE=1` é dry-run; o wrapper propaga a variável). Título, preço e estoque
   nunca entram no payload.
7. **Separe em lotes o que é palpite.** Campos ocultos da categoria
   (`tags=hidden`) aceitam gravação, mas ninguém mediu se indexam: vão num lote 2,
   depois, para o efeito do lote 1 poder ser medido sozinho. Erro de ficha que você
   encontrar de passagem (um `IS_MONAURAL=Sim` num fone estéreo, Anatel vazia com
   Bluetooth declarado) é pergunta ao dono, não conserto silencioso.

8. **Provar que a palavra INDEXA pelo buscador da própria loja** (método do dono,
   29/09) — para categoria nova, campo novo, palavra nova, ou para conferir o que
   uma ficha já no ar está indexando. Só leitura:
   `node bin/busca-loja.mjs <9222|9223> <loja> "<termo>" …` (abre aba própria no
   Chrome da ponte e fecha no fim). É a busca de
   `lista.mercadolivre.com.br/loja/<loja>/<termo>?sb=storefront_url`. Como ler:
   - **o contador "N resultados" = só quem bate TODAS as palavras.** Quando são
     poucos, o ML completa a grade com quem bate PARTE delas ("presente pai": 2
     exatos + 17 só com "presente") — o completamento NÃO prova indexação;
   - **redirecionou para `…?redirectedFromEshopZrp=`** ("Não encontramos X em
     01smart. Mostramos anúncios de outros vendedores") = **nenhum** anúncio da loja
     tem o termo indexado;
   - desenhe o teste para separar hipóteses: um termo que só existe no campo testado,
     um que existe no campo testado E em outro, e um controle comum. Cruze cada id
     exato com o campo e a posição do termo na ficha (dump de
     `mcp-bling-ml/src/scripts/_varredura-sazonal-fichas.mjs`);
   - a API `/sites/MLB/search?seller_id=` dá 403 mesmo com token — só a página serve;
   - **depois de editar, espere 30 minutos antes de medir** (regra do dono, 30/09):
     a indexação leva esse tempo. Antes disso, "não apareceu" não quer dizer nada.
     Grave a linha de base ANTES de editar, nas mesmas buscas.
   - **para mapear campo a campo sem editar nada**, busque uma palavra que exista
     SÓ naquele campo (nem no título, nem em outro campo) em vários anúncios, e
     busque uma palavra por vez, porque aí não há completamento parcial. Não use
     palavra com erro de grafia: o ML corrige ("xiome" virou xiaomi: 162 resultados).
     O ML mostra UM anúncio por família ou por cópia do mesmo produto, então achar
     50–80% dos anúncios que têm a palavra já é "indexa". O sinal de "não indexa" é
     0 de N, ou o "Não encontramos".
   **Campanha de DATA SAZONAL (Dia das Crianças, Black Friday…) é a skill `ficha-sazonal-ml`**
   (`~/.claude/skills/ficha-sazonal-ml`): fluxo completo, script de massa e registro no card.
   **PILOTO 30/09 (MLB1845576308 relógio + MLB2145180151 fone) — o que decide a estratégia sazonal:**
   - **Palavra de campanha NÃO indexa no Idiomas.** "Presente" foi testado em 3 versões e
     nenhuma indexou: 2º valor com vírgula (duas vezes) e colado no 1º valor sem vírgula.
     Cada uma foi medida 30 minutos depois da gravação. Idiomas indexa idioma de verdade
     (Espanhol, Inglês, Francês); "Multilinguagem" e as palavras do Dia dos Pais nunca
     indexaram.
   - **Campanha vai no Acessórios incluídos**, num valor só, com as palavras-chave primeiro.
     "Dia das Crianças Presente Infantil…" pôs o relógio em "presente", "presente
     criança", "presente infantil" e "relógio presente" 31 minutos depois. No fone, "…Headphone…"
     indexou no caractere 31–39. Os acessórios reais vão no fim, fora da janela.
   - Formato do fone (texto único) também indexa a campanha ("Presente" pôs o fone em
     "presente menina/menino").
   - Palavra que passa do caractere 40 dentro do valor não indexa ("Menino Menina" a partir do
     caractere 34 ficou de fora de "presente menina/menino").
   - **MPN é um 2º campo oculto que indexa, e o cliente não vê** (não aparece na página).
     Com MPN = "Menino Menina", o relógio foi para 1º lugar em "presente menina",
     "presente menino", "menina" e "menino" (30/09 17h58). Existe em smartwatch e nas
     categorias de fone. É atributo de variação na categoria, mas o ML aceitou no item
     inteiro. O ML usa o MPN para casar catálogo: não usar em anúncio de catálogo.
     **Replicado em 30/09 às 19h35**, com controle pedido pelo dono:
     - no relógio do piloto, "Menino Menina" saiu do Acessórios e ele continuou em 1º;
     - num 2º smartwatch sem nenhuma palavra de gênero (MLB3363008837), o MPN o levou de
       "não aparece" para exato em "menina", "menino" e "smartwatch menina/menino".
     Campos que NÃO indexam: Fonte do produto (0 de 25), Material do bisel, Versão do
     smartwatch.
   **Medido em 29–30/09 na 01Smart** (30 palavras, card de datas sazonais 86dww3n6v):
   - **Idiomas indexa só nos 40 primeiros caracteres e só se a lista inteira for
     CURTA**:
     - com lista de até 52 caracteres, "espanhol" e "inglês" acham 43 de 54;
     - com lista de 87 caracteres ou mais, 0 de 161, mesmo com "Espanhol" em primeiro;
     - o limite fica entre 52 e 87 caracteres e só um anúncio editado mostra onde;
     - lista inchada com palavras de campanha desliga o campo inteiro;
     - as palavras do Dia dos Pais começavam no caractere 61 e nunca indexaram;
     - "Multilinguagem" termina no caractere 40 e não serve de controle.
   - **Funções indexa nos 40 primeiros caracteres, na ordem gravada (a da API)**,
     e lista longa não atrapalha: "calculadora" achou 25 de 45 dentro dos 40 e 0 de
     62 depois; "pressão arterial" e "oxigênio no sangue", sempre depois dos 40,
     deram "Não encontramos". Valor em minúscula ("presente dia das crianças…") cai
     no fim da lista, que sai em ordem alfabética.
   - **indexam**: Fabricante, Marca, Modelo alfanumérico, Material da caixa,
     Material da pulseira, Tipo de tela, Classificação de resistência à água e ao
     pó, **Acessórios incluídos** (oculto no formulário, 8 de 11), Duração da
     bateria, Tipo de fecho, Formato do fone e Características do produto
     (só leitura). A Linha indexou parcialmente.
   - **não indexam**: Material do bisel (0 de 88), Versão do smartwatch (0 de 35),
     Tamanho da pulseira, Embalagem do envio e Funções de controle do fone
     (amostra de 3).
   - **O ML guarda a lista na ordem enviada pela API**, sem ordenar alfabeticamente.
     Piloto de 30/09, MLB1845576308: "Dia das Crianças,Presente,Português,…" voltou
     igual na leitura. A palavra de campanha vai na frente e fica na frente.
     Formato do fone (HEADPHONE_FORMAT) é texto único: vai em `value_name`, não em
     `values`.
   - **o cliente VÊ Idiomas e Acessórios incluídos** na página, em
     "Características" (conferido no MLB4066932793). `hidden` na categoria só
     esconde o campo no formulário de venda.
   Re-medir antes de mudar a estratégia: o ML muda.

**GTIN do anúncio não se discute aqui**: divergência com o Bling não é achado
(regra dele, 07/09) — fica fora do payload e fora do relatório.

## Regras invioláveis (G1-G7 da régua — resumo)

Edição parte SEMPRE da imagem-base (nunca da saída) · 4 candidatas · teto 3
rodadas e segue · cor por palavras · imagem inteira · texto SOBRE a arte nunca do gerador (UI de tela pode, conferida letra a letra) ·
**um veredito.json por rodada — sem veredito, não é entregável** · foto de produto nunca composta à mão (G8) · alteração leve do produto = listar, não reprovar ·
**base do produto só do próprio anúncio / foto do dono / SharePoint da SKU, confirmada por ele em `bases/CONFIRMACAO.json` (GATE 0)**.
**Strava nunca é citado** (nome ou logo) em arte, título ou subtítulo — "dá muita reclamação" (dono, 03/09); esporte = "sincronizado no app", "GPS pelo app do celular".
**Item de benefício na arte só com fato da `ficha-travada.md`**: campo VAZIO na ficha não entra, mesmo que o título do anúncio afirme. Em 22/09 a 06 do Redondo Mini saiu com "NFC e comando de voz" (`WITH_NFC` vazio, anotado na própria ficha travada) e "GPS integrado" (contra a regra acima), e o dono corrigiu para **"Comando de voz"** e **"GPS integrado ao celular"**.

## Lições da galeria Redondo Mini (22/09/2026 — 12 posições, 6 aprovadas, 6 encerradas pelo dono)

- **Galeria é lifestyle com pessoa, não catálogo de estúdio.** As 12 artes da rodada 1 foram reprovadas em
  bloco ("parece IA", "arte fraca", "não parece o meu relógio"). A causa foi a direção, não o gerador: eu proibi
  pessoas nos prompts e tratei a régua (R2 fundo chapado, respiro) como direção de arte. Antes de escrever
  prompt de galeria, abra a última galeria que ele APROVOU e copie o tipo de cena; em galeria longa, rode um
  piloto de 1 posição antes do lote.
- **Só o que ele pediu, e versão PRETA primeiro (05/10, kit W12MN):** "atualizar 2 fotos" = 2 posições, na cor preta, para
  aprovação; as outras cores e as versões de capa (V1–V3) só depois do ok. Gerei 31 candidatas de uma vez e ouvi "não
  precisava gerar todas… ideal era só fazer versão preta primeira". "Podemos iniciar" = briefing curto, não lote.
- **Os ajustes acumulam entre rodadas** (`rodar-lote.sh` corrigido em 22/09, com teste no `smoke.sh`): antes, só a
  `proxima_instrucao` do último veredito entrava, e a rodada 3 perdeu a direção lifestyle que ele tinha aprovado
  na 2 ("que porra é essa"). Rodada que regride ao que já foi reprovado: confira o `prompt.txt` materializado
  dela antes de culpar o gerador.
- **Cena não quadrada se RECORTA, nunca se espelha** (`texto/quadrar-cena.py`): o preenchimento por espelho
  duplicou braço e pessoa em 24 de 25 candidatas ("pq porra de espelhamento").
- **Crítico cego em Workflow com muita imagem ampliada entra em loop**: 3 `gauntlet-critic` reiniciaram por ~80
  min sem devolver nada. Para mudança só de texto, a conferência é mecânica (diferença fora do bbox do texto,
  contraste no contorno das letras, 4:4:4, prévia a 400 e 160 px). Crítico de cena: poucos recortes por agente.

## Lições de prompt e de rodada (galeria Prime AI, 03-04/09/2026 — 44 candidatas, 9 posições)

- **Caixa retangular: dê a proporção em fração legível desde a rodada 1** ("quase quadrada, altura só 16-20 % maior que a largura") — o gerador puxa para "retângulo alto tipo Apple Watch" (+15 a +22 %) ou "pulseira fitness estreita" (−21 a −29 %); foi a causa nº 1 de reprovação (7 em 3 posições). Instrução do juiz em número resolveu em 1 rodada; adjetivo não resolveu em 2.
- **Relógio no pulso tem geometria (rodada 045, 3 reprovações + 1 ajuste):** a coroa aponta para a MÃO, o eixo 12-6 do mostrador é perpendicular ao braço, e a câmera fica do lado de quem usa (ponto de vista/por cima do ombro) — de frente para a pessoa, um mostrador legível é fisicamente impossível (ela leria de cabeça para baixo). Descreva a coroa em relação à MÃO, não à caixa; poses permitidas: antebraço na horizontal com a mão para a direita (POV) ou por cima do ombro; proibido: punho na vertical com dígitos em pé para a câmera. Bloco `PULSO` do `build.py` do W11 Pro Mini; o `verificar.py` gera a tira de recortes do relógio em tamanho cheio para conferir. Plano 046.
- **"Pulseira sai pela borda" vira esmaecimento para branco** (ZW13 v3, 2 de 4 candidatas: a tira clareia nas
  últimas 15-22 linhas em vez de ser cortada). Se a cena precisa do corte, escreva "a pulseira continua além do
  quadro, escura até a última linha, sem clarear" — e o juiz mede a luminância da borda.
- **Gravação no produto (aro SPORT/SELECT…) também sai errada do gerador** ("SELCCT", ZW13 v2 c3): liste no
  prompt as palavras gravadas letra a letra e peça ao juiz o recorte ampliado do aro, não só da tela.
- **Zona reservada ao texto: descreva o OBJETO que a limita, não a porcentagem** ("o painel começa abaixo da pulseira", "cotovelo fora do quadro"). "Faixa superior de 20 % vazia" foi invadida em 6 candidatas de 3 posições.
- **Antes de gastar uma rodada por causa da zona do texto, mova o bloco HTML**: título/subtítulo/selos são camada sua; medir a área livre da candidata (PIL) e reposicionar custa zero.
- **Teto de 3 rodadas com produto fiel** → a melhor candidata vira PROPOSTA marcada "SEM APROVAÇÃO DO JUIZ" no LEIA-ME (`forcar` no spec do produto), com o texto reposicionado; o dono decide. Em 04/09 ele aprovou a proposta. Nunca silencioso.
- **"Gera a foto e eu verifico"** (dono, para UMA foto refeita): pule o juiz, aplique o texto nas 4 candidatas, entregue folha + pasta datada e ele escolhe. Mantém 4 candidatas e as bases confirmadas; o que sai é só o juízo cego.
- **Legibilidade do bloco livre sobre tecido/sombra**: `ancora.placa` no spec (placa branca translúcida ~86 %, cantos 18 px, desfoque 6 px) — o dono pediu isso na foto de mensagens; navy direto sobre camiseta ficou "ruim de ler".
- **Cota do Codex (exit 3) no meio do lote**: `rodar-lote.sh` para limpo e é idempotente — rodada com 0 png é reaproveitada; com png parcial, mova a pasta para `jobs/_parciais-cota/`. **Cron de sessão morre com a sessão** (a retomada agendada de 01:43 não rodou): retome à mão com `rodar-lote.sh <slug> [pos]`.
- **Juízes em paralelo compartilham o scratchpad**: peça no prompt do juiz uma subpasta por posição e `--out` no `teste_160.py` (sem isso ele grava `teste_160.jpg` na raiz do repo e um juiz sobrescreve a folha do outro).

## Lições da galeria D20 + fone A6S (07-08/09/2026 — 3 cores, dono como verificador, aplicada em 2 anúncios com variações)

- **UI da tela também entra como IMAGEM: recorte o mostrador da própria galeria** e passe como referência (`bases/ref-tela-<algo>.png`, registrada no CONFIRMACAO.json). Na capa do Redondo Mini (22/09) isso entregou a tela **letra a letra em 8/8 candidatas de duas rodadas** — data, os três indicadores com número e cor, hora, anel de 3 aros, gráfico com escala e eixo, batimentos. Descrever a mesma tela só em palavras é o caminho longo: o gerador acerta o layout e erra um número, e o juiz reprova por causa dele.
- **Texto longo dentro da cena entra como IMAGEM, não como texto no prompt:** a frente da caixa (logo, tagline, 5 benefícios, selo) foi desenhada em HTML, renderizada e dada ao gerador como imagem de referência — ele a reproduziu letra a letra nas 4 candidatas. G6 segue valendo para o texto SOBRE a arte; o que está impresso no objeto da cena vai por arte-imagem.
- **"Não use o verificador, eu serei o verificador" / "eu corrijo as demais uma por uma"** (dono, para a galeria inteira): juiz dispensado, texto aplicado nas 4 candidatas, folha `00-ESCOLHA.jpg` + pasta datada (`entregar-escolha.py` do produto), e só a posição que ele mandou é refeita — regenerar em lote o que ele não pediu gasta cota e a paciência dele.
- **"Texto fora do lugar" resolve com layout por candidata, não com rodada nova:** `layout-<NN>.py` mede os objetos da cena (colunas escuras, bbox por região) e posiciona números, legendas e o aviso para cada candidata. Gotcha: uma coluna de detecção larga pega a borda das vinhetas vizinhas e a legenda cai dentro do círculo — meça numa coluna estreita e confira a folha antes de mandar.
- **TIMEOUT no `rodar-lote.sh` também é candidata lenta, não só base pequena ou cota:** 2 de 4 saíram assim em várias rodadas e a rodada seguiu com as que vieram. Cota de verdade chega como exit 3 "try again at HH:MM" (fechou 09h44, voltou 13h36) e o lote para limpo.
- **Watchface: a pesquisa informa, o dono decide.** 13 agentes e um placar apontaram alternativas ao mostrador de fábrica; ele escolheu Amanhecer, reprovou na capa e voltou ao mostrador tradicional do D20 em todas as fotos (`prompts/tela.txt` num lugar só trocou os 8 prompts). Mostre a prévia no produto a 160 px e deixe a escolha com ele.

## Lições da Minha página do ML (plano 050, 17–18/09/2026 — capa, banners, selos, etiquetas; 19 posições de Codex)

- **Relógio no pulso em tamanho real: dê a proporção FÍSICA, nunca "grande".** O prompt "caixa GRANDE, 22% da altura; mão
  pequena em relação ao relógio" saiu *"gigante no braço, irreal"* (dono). Resolveu em 1 rodada, 4/4: "caixa cobre 2/3 da
  largura do pulso, pele visível dos dois lados; palma = 1,5× a largura da caixa; caixa ≤ 11% da largura da imagem".
- **Braço só pode ser cortado pela BORDA da imagem.** Antebraço com "coto" desfocado ou manga cortada no meio do quadro, ao
  lado do texto, é *"esquisito"*. Pose aprovada: pulso DIREITO entrando pela borda direita, mão voltada para o texto,
  câmera do lado de quem usa. E ao reduzir a cena (`--k`) para caber a mão, **ancorar na borda por onde o objeto entra**
  (`--ancora direita` no `montar-banners.py`) — cena centrada deixa a borda da foto no meio do banner ("buraco no braço").
- **Pulseira avulsa (kit com 2 pulseiras) aparece pela face externa, como na foto do dono** (`bases/pulseira-silicone-
  referencia-do-dono.jpg`, origem `foto-do-dono` no CONFIRMACAO.json): duas partes em curva, fivela na frente. "De costas"
  (furos/fivela para a câmera) ou enrolada sem relógio reprova. Foto do dono entra como imagem de referência da PEÇA.
- **"Proibido inventar tela/caixa" tem de estar ESCRITO.** "Sem alterar o produto" não bastou: a c4 da capa v4 fabricou uma
  caixa redonda com a UI retangular de outro modelo, e outras trocaram a arte da tela (planeta, lago). Listar: "o C mostra
  SEMPRE a lua da base; o A SEMPRE a flor; nada de ponteiros/planeta/lago".
- **O gerador estoura o tamanho pedido (~1,4×) e ignora "nenhum mostrador passa de N px"** quando o resto do prompt pede
  presença/faixa cheia. Quem enche a faixa são pulseiras longas e MAIS peças (13–17), não relógios maiores; o tamanho
  absoluto se acerta no acabamento (`montar-capa.py`: reduz a cena ANTES do recorte, `--auto` mede a CAIXA inteira na
  janela), nunca com rodada nova.
- **Peça de página: medir o enquadramento REAL antes de dar número ao gerador.** Seis rodadas de capa perseguiram "144 px"
  porque ninguém mediu: a página exibe o arquivo 1920×300 em 1:1 e mostra só o terço do meio (100 px), o cartão do logo
  cobre x 366–658. Ajustar a peça publicada contra a captura (escala/deslocamento) custa 30 s; estimar por proporção custou
  5 rodadas. Idem para o banner principal (mostra ~76% da altura) e o botão nativo (cai sobre y 46–60%).
- **"Desliga os verificadores, eu irei verificar"** (dono, 18/09) vale para ARTE (entregar as 4 candidatas com o texto
  aplicado, ele escolhe); para BUG de tela ele pediu verificador funcional ("usa verificador para testar na tela na versão
  mobile") — iPhone emulado por CDP com toque real, 4/4 provados. Os dois convivem: juiz de estética não, teste de função sim.
- **Componente de texto do ML sobre arte com texto = nunca** (o Banner secundário imprime o texto por cima da imagem,
  centralizado). Texto vai gravado na arte (G6) e o campo fica vazio; a imagem inteira já é o link.
- **Link de anúncio em componente da Minha página = `permalink` da API** (`https://produto.mercadolivre.com.br/MLB-<id>-…-_JM`).
  `https://www.mercadolivre.com.br/p/MLB<id>` é product id de CATÁLOGO e dá "anúncio indisponível" (o dono achou clicando;
  read-back de captura não testa clique). Abrir o link uma vez antes de publicar.
- **"Anunciar" só publicou quando a tela confirmou "Pronto! Você publicou as alterações."** Um clique com painel aberto
  não publicou e os links velhos ficaram 2 min no ar sem ninguém notar — `texto/ed-publicar.mjs` agora exige o aviso.
  E script que troca imagem de componente precisa de **trava de página** (uma troca de página que falha em silêncio
  trocou a imagem do componente errado: o ZW10 caiu no lugar dos selos da Início).
- **Nome do produto vem do dono, não da minha leitura da ficha:** o redondo AMOLED (MLB5889218056/MLB4227307201) é **ZW10**;
  eu chamei de "ZW02 Pro" por dois dias em direção, banner e README.

## Lições da galeria ZW13 na MAGALU (25/09/2026 — 9 posições, GPT-6-Astra, 10/10 aprovadas pelo dono após 4 rodadas e 6 edições)

- **Modelo do Codex: o dono quer o mais novo e potente, e a confirmação ANTES de gerar.** `bin/rodar-lote.sh` agora usa
  `bin/gerar_imagem_codex_astra.sh` (GPT-6-Astra; `CODEX_MODEL=` troca) por padrão. Lote inteiro com "0 png" em segundos e
  sem log não é cota: é o Codex CLI velho ("requires a newer version"; `rodar-lote.sh` apaga a rodada vazia com o log dentro).
  Antes de disparar 36 candidatas, 1 chamada de texto com o modelo (`echo OK | codex exec -m gpt-6-astra -`); se recusar,
  `npm i -g @openai/codex@latest` com o PATH do nvm.
- **Cena de pulso: o braço é da pessoa da cena, e o melhor é PRIMEIRA PESSOA sem cabeça no quadro.** "Câmera do lado de quem
  usa" + "pessoa mais longe, rosto de lado" (para o relógio caber grande) produziu antebraço em primeiro plano com o motociclista
  atrás — o dono reprovou 4 cenas ("braço com cara em cima da moto e alguém na frente, fisicamente não funciona"; "parecendo
  cotoco"), duas delas aprovadas pelo juiz cego por geometria e fidelidade. O que passou (02, 03, 09): POV, câmera nos olhos, só o
  antebraço esquerdo entrando pela borda, mão direita (se aparecer) do lado direito, nenhuma cabeça, e física correta — "não pode
  segurar o manete direito com a mão esquerda"; celular no suporte com a TELA para quem usa. O juiz agora reprova "braço não
  pertence à pessoa da cena".
- **Tamanho do relógio se pede em fração do QUADRO, em número.** "Grande e nítido" + "caixa ≈ 2/3 do pulso" deu 8–15 % da largura
  (02 e 06: 8/8 reprovadas). "A CAIXA mede cerca de UM QUARTO da largura da imagem, nunca menos de um quinto; a pessoa fica mais
  longe" saiu 23–28 % nas 7 posições seguintes na rodada 1.
- **Gravação no aro é a reprovação nº 1 em produto tático:** SPOOT, ACTOIE, SIELECT, BLOCK, BACIC, BROK, 3ELCCT em 8 candidatas de
  5 posições, todas invisíveis a 1200 px. Entra no prompt soletrado ("S-E-L-E-C-T, seis letras") e o juiz amplia o aro 6–8×. Aro
  errado numa aprovada se conserta por edição só da caixa (04: gerador + `colar-regioes`, cena idêntica).
- **≤31 chars não garante que o título cabe.** "Mensagens do WhatsApp no pulso" (30 c) mede 1.228 px em Arial Bold 74 e cortou
  nas duas bordas. `bin/validar-titulos.mjs` agora mede a largura (teto 1.130 px) além dos chars; o `render.py` do produto recusa.
- **Elemento extra do spec (número gigante, selos) em cena de pulso cai sobre o braço.** Medir onde a cena tem espaço antes de
  posicionar: selos foram para a faixa de céu logo abaixo do subtítulo (y≈250), o "7" gigante saiu (o título já traz o número).
- **"Troca só X" continuou sendo edição, não rodada** (6 vezes no dia): tirar o capacete da borda, virar o celular do suporte,
  apagar um braço solto, corrigir o aro, trocar as 4 telas laterais por telas de função, pôr 4 mostradores como discos soltos. Receita:
  o gerador edita a partir da APROVADA com a instrução "UMA única alteração… nenhuma outra parte muda, pixel a pixel" e
  `colar-regioes.py --caixa … --forma hull --dilatar 3` cola só a região (diferença fora ≈ 0–4/255). Gotchas: (a) objeto removido
  na BORDA deixa um contorno-fantasma que o gerador não apaga numa 2ª passada — resolve desfoque local só no fundo desfocado,
  fora do produto (`GaussianBlur` com máscara suave, medido 0,015 fora da faixa); (b) recorte de mostrador da arte do fabricante
  vem CORTADO nas bordas — disco solto se gera pelo gerador com as refs ("círculo completo… complete onde a referência estiver
  cortada") e cola só a faixa; (c) reduzir a cena ancorada no chão exige preencher TOPO E LATERAIS com o próprio fundo
  (`produtos/zw13-magalu-01smart-2026-09/texto/reduzir-cena.py`); a 1ª versão preencheu só o topo e o dono viu tarja preta.
- **Copy de água na arte: zero aviso negativo.** "Não indicado para banho ou natação" saiu a pedido dele ("negativa diminui a
  conversão"; ele testou banho e natação sem problema, mas também não se promete). Afirma-se o que aguenta — suor, chuva, respingos,
  lavar as mãos — com "use sem preocupações"; a ressalva mora na descrição. Revoga, para a arte, o "no máximo UM aviso" do molde.
- **Arte do fabricante com informação boa (funções em grade, mostradores) ele quer REFEITA com a nossa identidade**, não trocada por
  lifestyle: "cancelar 8 e 10, recriar mantendo a base de informação, otimizando com identidade nova e copy melhor".
- **Entrega: UMA pasta por produto e nenhuma outra.** Estrutura que funcionou: `APROVADAS/` (fechadas por ele) ·
  `REVISAR-juiz-aprovou/` (escolhida + folha das 4) · `REVISAR-escolha-v1-v4/` (rodada sem juiz) · `00-VISAO-GERAL.jpg` com o
  status escrito sobre cada posição · `LEIA-ME.md` com o estado. Edição avulsa entra na pasta de revisão com o nome do que mudou
  (`05-…-v4-SEM-CAPACETE.jpg`) e abre no Preview — pasta nova para ela virou "muitas pastas duplicadas, apague". Ao arquivar no
  SharePoint, a pasta do Desktop vai para a Lixeira ("apague tudo que você criou na área de trabalho"); o repo guarda tudo.
- **Arquivar na Magalu:** nome SEO = slug do título atual do anúncio + posição (capa com `-<cor>-`), read-back por md5; a galeria
  antiga do fabricante vai para `Fotos/_galeria-antiga-fabricante/` (mover, nunca apagar). Ele procurou a pasta duas vezes: dar
  o caminho completo do OneDrive na resposta e abrir no Finder.
- **Magalu, o que a página dá:** `__NEXT_DATA__` → `props.pageProps.data.item.media.images` (URLs com `{w}x{h}`; o CDN
  `a-static.mlcdn.com.br/1200x1200/…` aceita `curl`), `productRating.userReviews.items` (texto + nota), `questions.items`,
  `item.factsheet`; na busca, `data.search.items` (id, título, imagem). Aplicar galeria = `PATCH /seller/v1/portfolios/skus/{sku}`
  com `images[{type,reference}]` por URL pública — a VPS tem Caddy em 80/443 para hospedar (pendente, backlog do mcp-bling-ml).
- **Placar arena pelo DropX:** `ler_planilha` usa `spreadsheet_id` (o default é a planilha de reposição) e `formato: matriz`; o
  resultado passa de 1 MB e vai para arquivo — filtrar pela coluna `Grupo` em python. As colunas "Reviews — piores negativas /
  melhores positivas" e "Imagens — descrição por posição" já trazem a voz do cliente dos rivais anotados.

## Lições da galeria W12 Mini (01–03/10/2026 — 11 posições × 3 cores, 7 rodadas, Claude e Codex em paralelo)

- **Galeria conta uma história com enquadramentos diferentes.** Primeira pessoa (só o braço) em no máximo ~3 fotos; o resto
  alterna tronco/mãos (blazer), modelo em cena (dormindo), pessoa + o mesmo relógio grande ao lado mostrando a função, corpo
  inteiro + cartões (ciclista), só produto (kit, cápsulas). Escreva o enquadramento de cada posição na tabela do GATE 1 e confira a
  variedade antes de gerar (memória `feedback-galeria-varia-enquadramento-conta-historia`).
- **Segunda mão em cena de primeira pessoa sai "de criança"** e o juiz não pega (02, 06, 07 reprovadas pelo dono). Mão direita fora
  do quadro, objetos apoiados; relógio ≈ 2/3 da largura do pulso. Se a referência DELE tem duas mãos, escreva "as duas mãos são da
  MESMA mulher e têm o MESMO tamanho" (memória `feedback-segunda-mao-primeira-pessoa-reprova`).
- **"Parece fake no pulso" pode ser física, não render.** Antes de gastar rodada em "realismo", confira de que lado está a mão do
  braço com o relógio e para onde aponta a coroa: na 03 a coroa apontava para o cotovelo e 4 edições de "assentamento" falharam (o
  juiz reprovou as 4 pela geometria herdada). Conserto que preserva a cena aprovada: ESPELHAR a imagem e o gerador redesenha só a
  tela (que fica invertida). Pose de quem fala com o relógio: antebraço dobrado junto ao peito, tela virada para o rosto — a tela
  não precisa aparecer para a câmera.
- **Objeto pequeno (< ~120 px) o gerador não muda na cena inteira**: devolve pixel-idêntico e só redesenha a tela (09b: relógio de
  95 px, 8 candidatas; fone de ~12 px na 08). Recorte 4× centrado no objeto → edição → reduz e cola de volta com
  `produtos/w12-mini-ambas-2026-09/texto/colar-retangulo.py` (retângulo com pena; copie para o `texto/` do produto). `colar-regioes --forma hull` não transfere mudança de FORMATO preto-sobre-escuro
  (fica abaixo do limiar).
- **Versões de cor = edição das aprovadas, não rodada nova.** Referências: a foto aprovada (cena) + a capa já aprovada naquela cor
  (cor da caixa, silicone e couro — couro acompanha a cor: rosa = marrom-escuro, branca = caramelo). Use a SAÍDA INTEIRA do
  gerador: colar por região deixa aro/pulseira escuros sobrando, porque o relógio claro sai 2–3 px menor. A cor sai certa quase
  sempre; o que separa as 4 é o reenquadramento (o juiz reprovou as que ampliaram 1–4 % ou re-renderizaram mãos/fundo). Só ganham
  cor as fotos em que o relógio é grande e a cor aparece; cenas escuras/relógio pequeno ficam comuns às cores.
- **Trocar a cena não pode perder o benefício principal da foto.** A 08 virou ciclista na chuva e perdeu "música" — ele pediu de
  volta: título do benefício + pílulas pequenas no rodapé (2 GB de músicas · Fone Bluetooth · Certificação IP68) e o fone na cena.
  Arte de água: CLIMA coerente (chuva na cena) + "Resistente à água" por extenso no texto + selo IP68 separado; a sigla sozinha não
  fala com o cliente.
- **Tela de função tem de parecer de verdade:** modos esportivos com pictogramas de atividade (pessoa correndo/pedalando/
  caminhando, estilo app de treino), nunca bolinhas coloridas ("fake"). Logos de terceiros (ChatGPT, DeepSeek, Grok) entram como
  ícone de preenchimento no `render.py` do produto (`FILL…`, disco branco com a marca na cor dela).
- **Juiz cego volta em todas as rodadas quando ele pede** ("faz o verificador funcionar") — inclusive edições de cor e de produto.
  Limite semanal da API derrubou 6 juízes no meio: não trave a entrega — conferência mecânica (escala/deslocamento e diferença fora
  do produto contra a aprovada) e aviso explícito no cartão/LEIA-ME de que o juiz não rodou.
- **Duas entregas em paralelo (Claude × Codex) para ele comparar** funcionou: ele escolheu foto a foto (02 e 10 do Codex, 03 nossa,
  06/09b/11 do Codex com o relógio refeito). A cena que ele aprova vira BASE de edição, venha de onde vier.

## Paradas

**Dono reprovou as 4 candidatas sem dizer o motivo → pergunte a causa ANTES de
montar a rodada seguinte** (uma pergunta curta: é o produto, o arranjo, o
mostrador, ou é para não mexer nesta peça?). Reprovação em bloco não diz se o
problema é fidelidade, composição ou a própria ideia de trocar a arte, e a
segunda direção sem essa resposta é só a sua segunda hipótese. Em 22/09, na capa
do MLB5397991916, eu pulei a pergunta e parti para a outra direção: ele reprovou
as 4 dela também e encerrou a capa — 8 candidatas de Codex e nenhuma informação
sobre o que ele não quis. Se ele já mandar a direção seguinte junto, dispare o
lote e faça a pergunta na mesma mensagem: a resposta chega antes da entrega.

Ficha contraditória → pergunta. Dono reprovou 2× a mesma posição → escala.
`gerar_imagem_codex.sh` exit 3 → cota: parar LIMPO (estado em disco) e avisar.
Antes de executar plano deste repo: marcar EM EXECUÇÃO em `plans/README.md`.
