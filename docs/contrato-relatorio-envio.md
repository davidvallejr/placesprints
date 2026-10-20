# Contrato entre as frentes — Relatório de Sprints Place2u ao Notion (08/10/2026)

Plano aprovado: `~/.claude/plans/na-matriz-eisenhower-a-crystalline-beacon.md`. Desenho completo: `docs/desenho-relatorio-notion.md` (Parte A = conteúdo, Parte C = envio/banco/rotas; onde a Parte B diverge, vale o plano aprovado).

## Fronteira entre as frentes

| Frente | Dono dos arquivos |
|---|---|
| **Conteúdo** (B) | `src/lib/relatorio-brief.js`, `src/lib/relatorio-brief-real.js`, `config/relatorio-brief.json`, edições aditivas em `src/lib/semanal.js` e `src/lib/render-semanal.js`, `scripts/teste-relatorio-brief.mjs` |
| **Envio / Notion** (A) | `src/lib/relatorio-seguro.js`, `src/lib/relatorio-notion.js`, `src/lib/relatorio-envio.js`, `config/relatorio-envio.json`, `src/rotas-relatorio.js`, edições em `src/lib/plano-informacoes.js`, `src/lib/placeplan.js`, `src/lib/db.js`, `src/server.js`, `scripts/semear-relatorio-programacao.mjs`, `scripts/teste-relatorio-{seguro,notion,envio,rotas}.mjs` |
| **Telas** (eu) | `src/web/relatorio.js`, `src/web/cliente.*`, `src/web/planos.*`, `docs/ux/*`, `scripts/teste-shell-ui.mjs`, docs |

Nenhuma frente edita arquivo da outra. Se precisar de algo no arquivo alheio, descreva no relatório final.

## Brief (saída da frente B, entrada da frente A)

```
Brief = { versao:1, cliente, hoje:'AAAA-MM-DD', hora:'HH:MM',
  janela:{ de, ate, anterior:{de,ate}|null, rotulo:'02/10 a 08/10/2026' },   // 7 dias FECHADOS: de=hoje-7, ate=hoje-1
  titulo:'Relatório de Sprints Place2u · 02/10 a 08/10/2026',
  modo:'completo'|'sem_resultados'|'vazio',
  qualidade:{ ok:boolean, motivos:[string] },     // ok=false: ML conectado mas não respondeu
  abertura:{ tom:'verde'|'amarelo'|'laranja'|'cinza', cabecalho, frase, nudge },
  resultados:{ disponivel, motivo, linhas:[{ chave, rotulo, atual, anterior, variacao:{texto,sinal:'bom'|'ruim'|'igual'}|null }],
               hoje:{ate_hora,faturamento,pedidos}|null, nao_coletado:[string], outros:[{canal,texto}] },
  atividades:{ lista:boolean, concluido:{ total, por_canal:[{canal,n}], grupos:[{rotulo,canal,quando,n}] },
               andamento:{ total, itens:[{rotulo,canal,previsto}], promocoes:[{rotulo,ate}] } },
  desenvolvimento:{ resultados:[{ rotulo, canal, quando, metrica:{rotulo,texto}, selo:'medido'|'hipotese'|'informado', confianca:{nivel,pct}|null }],
                    vazio_resultados:string|null, mudancas:[{quando,texto}], vazio_mudancas:string|null },
  proximos:{ itens:[{ quando:ISO, fim?:ISO, rotulo, origem:'acao'|'tarefa'|'calendario'|'promocao' }], radar:[...], agenda:{p7,p8_14}|null, vazio:string|null },
  depende:{ itens:[{ rotulo, desde, dias }] },
  rodape:[string],
  _interno:{ avisos:[string], omitidos:{} } }          // _interno NUNCA vai ao Notion
```

Interface exportada pela frente B:

- `src/lib/relatorio-brief.js`: `criarBrief(deps) → { gerar(cliente, opts?) }` (`gerar` é assíncrona e devolve o Brief), `projetarBrief(semanal, ctx)` (PURA), `limparTitulo(texto, canal)`, `PROIBIDOS`, `auditarBrief(brief, ctx)`.
- `src/lib/relatorio-brief-real.js`: monta `criarBrief` com as dependências reais (montarSemanal, lerAcoes, eventosAnuncio, ...) e exporta `briefReal = { gerar(cliente, { hoje?, agora? }) }` e `nomesInternos(cliente) → string[]` (nomes de analistas/consultores/líderes e responsáveis do cliente, para o auditor).

A frente A usa `briefReal` e `nomesInternos` só no fio do `server.js`; todos os testes de A usam um brief sintético.

## Interface da frente A (consumida por rotas e telas)

`criarRelatorioEnvio({ handle, notion, brief, destinos, nomesInternos, agora, hoje, validarPor, notificar, log, elegiveis, cfg })` devolve:
`enviar(cliente, opts)`, `lote(body)`, `jobDe(id)`, `programar(body)`, `clienteDe(cliente)`, `listar()`, `diagnosticar(body)`, `diagnostico()`, `diagnosticoCsv()`, `liberar(body)`, `frequenciaEmLote(body)`, `agendador({ligado,por})`, `agendadorEstado()`, `tick()`.

## Contrato HTTP (`src/rotas-relatorio.js`, prefixo `/api/relatorio`)

Regras gerais: corpo JSON obrigatório nos POST (415 sem `Content-Type: application/json`); `por` precisa ser líder/consultor (`validarLiderOuConsultor`); mensagens de erro fixas, nunca ecoam valor recebido; prospect `[Comercial] …` rejeitado; `confirmar` só vale se for **exatamente `true`**; estado de negócio impeditivo é 200 com `ok:false` (só validação de corpo é 4xx).

| Rota | Corpo / query | Resposta |
|---|---|---|
| `GET /clientes` | — | `{ itens:[{ cliente, frequencia, frequencia_rotulo, proximo_envio, ultimo_envio_em, ultimo_url, ultimo_estado, situacao, situacao_rotulo, motivo, liberado, pronto }], resumo:{ total, prontos, liberados, pausados, sem_categoria, sem_base, nao_verificados }, agendador:{ ligado }, frequencias:[{id,rotulo}], quem:[nomes] }` — `situacao` ∈ `desligado | nao_liberado | agendado | atrasado | enviado | pausado | falhou` |
| `GET /cliente?cliente=` | — | `{ programacao:{…item de /clientes + datas_previstas:[AAAA-MM-DD ×3]}, historico:[{ id, de, ate, origem, estado, motivo, url, categoria, por, em, anexo }], diag, frequencias, quem }` |
| `POST /enviar` | `{ cliente, por, confirmar?, previa_id?, substituir?, sem_categoria?, confirmar_destino? }` | prévia: `{ ok:true, previa:true, previa_id, titulo, de, ate, parcial_ate_hora, destino:{estado,pagina_titulo,informacoes_url}, categoria:{estado,tipo,aviso}, acao, ja_enviado:{em,por,url}|null, primeiro_envio, violacoes:[], avisos:[], linhas:[string], expira_em }` · envio: `{ ok:true, previa:false, estado:'enviado'|'adotado'|'ja_enviado'|'substituido', url, categoria, proximo_envio }` · impedimento: `{ ok:false, estado, mensagem }` |
| `POST /lote` | `{ clientes:[1..40], por, confirmar? }` | prévia `{ ok:true, previa:true, itens:[{ cliente, acao:'enviar'|'ja_enviado_hoje'|'precisa_previa'|'ignorado'|'bloqueado', motivo }] }` · confirmar `{ ok:true, job:{ id } }` |
| `GET /job/:id` | — | `{ id, tipo, estado:'rodando'|'concluido'|'falhou', total, feitos, itens:[{ cliente, estado, mensagem, url }], resumo }` (404 se não existir) |
| `POST /programacao` | `{ cliente, frequencia, proximo_envio?, por, confirmar? }` | prévia `{ ok:true, previa:true, datas_previstas:[×3], avisos:[], diag }` · confirmar `{ ok:true, programacao }` |
| `POST /frequencia-lote` | `{ clientes:[1..100], frequencia, por, confirmar? }` | prévia `{ ok:true, previa:true, mudam:n, itens:[…] }` · confirmar `{ ok:true, alterados:n }` |
| `POST /liberar` | `{ clientes?:[…] (omitido = todos os prontos), por, confirmar? }` | prévia `{ ok:true, previa:true, liberaria:[cliente], ignorados:[{cliente,motivo}] }` · confirmar `{ ok:true, liberados:n }` |
| `POST /diagnostico/verificar` | `{ clientes?:[…] }` | `{ ok:true, job:{ id } }` (somente leitura) |
| `GET /diagnostico` | — | `{ itens:[{ cliente, pagina, informacoes, secao_tipo, categoria, destino, perfil, ml_conectado, pronto, proxima_acao, em }], resumo:{ prontos, opcao_ausente, sem_base, sem_pagina, nao_verificados } }` |
| `GET /diagnostico.csv` | — | CSV UTF-8 com BOM, separador `;`, prefixo `'` contra fórmula |
| `GET /agendador` | — | `{ ligado }` |
| `POST /agendador` | `{ ligado:boolean, por }` | `{ ok:true, ligado }` |

Frequências: `desligado | semanal | quinzenal | mensal` (rótulos: Desligado, Semanal, Quinzenal, Mensal).

## Regras que valem para as duas frentes

- Node: `export PATH=$HOME/.local/node/bin:$PATH`. Testes: `node scripts/teste-xxx.mjs`; os que importam `db.js` definem `process.env.PS_DB_MEMORIA = '1'` ANTES dos imports (ver `scripts/teste-dependencia-cliente.mjs`).
- **Nunca** copiar `data/db.sqlite`, nunca reiniciar o servidor (porta 3012), nunca chamar Notion/Mercado Livre de verdade (stub em tudo), nunca editar `src/web/alerta.js`, `src/lib/notion-publicar.js`, `scripts/publicar-notion.mjs`, `src/lib/notion.js`.
- Honestidade: dado não coletado = "—", nunca zero; sem promessa; associação ≠ causalidade; isolamento por cliente; SQL parametrizado; erro nunca ecoa valor.
- Não há git neste projeto: edite com cuidado, só os arquivos que são seus, e preserve o comportamento existente (a suíte inteira `node scripts/teste-*.mjs` precisa continuar verde).

## Atualização (08/10/2026, rodada de correções da revisão adversarial nº 1)

- **Cliente que não é "Ativo" na central** (Congelado, Processo de Desligamento, status vazio ou ausente): prévia, confirmar, lote, programação, liberação e frequência em lote devolvem `ok:false, estado:'cliente_inelegivel'` com a mensagem fixa "só clientes Ativos recebem relatório; mude o status na central". Desligar a programação continua valendo para qualquer cliente.
- **Prévia do envio antecipado** ganha `proximo_envio_depois` (AAAA-MM-DD, resultado de `aposEnvio`), `dias_sem_cobertura` (dias que não aparecerão em nenhum relatório) e `aviso_cobertura`.
- **Programar e frequência em lote não reativam pausa nem liberação**: só `POST /liberar` reativa; a prévia avisa "salvar não reativa — use Liberar". `frequencia-lote` devolve `ignorados` e `muda` por item.
- **`POST /programacao`**: `proximo_envio` que não for texto AAAA-MM-DD devolve 400 "data inválida…". `clientes: null`/`[]` em `liberar` e `diagnosticar` devolve 400 (só ausente significa "todos").
- **Job de lote**: itens com estado `interrompido` (Notion indisponível; o lote para depois de 3 falhas retentáveis seguidas) e `em_andamento` (409 pulado).
- **Agendador**: relê o interruptor a cada cliente; pausa com `cliente_renomeado` quando o nome da programação difere do canônico; só envia a clientes "Ativo" explícito; retém o automático quando algum cliente elegível ainda tem a página não verificada (rode "Verificar bases" antes de liberar); 5xx, rede, timeout e 429 não contam como falha do cliente (disjuntor de 3 por tick, um aviso agregado); 401 interrompe a carteira. Hora e dia da janela 17h–23h usam o fuso `America/Sao_Paulo` do config (`fuso`).

## Atualização (08/10/2026, pendências do cliente nos relatórios)

- **Brief** ganha `alertas` (uma entrada por pendência CRÍTICA: `rotulo`, `canal_rotulo`, `desde`/`dias` ou resumo curto) e `depende.pendencias[]` (até 5, ordenadas por gravidade e impacto: `rotulo`, `canal_rotulo`, `gravidade`, `desde`, `dias`, `desde_aproximado`, `por_que_importa`, `efeito_se_atrasar`, `o_que_precisamos`, `impacto_texto`, `impacto_tipo`), mais `depende.mais` e `depende.linguagem`. `depende.itens` segue igual (contrato antigo); quando há `pendencias` o conversor NÃO renderiza `itens`.
- **Blocos do Notion:** callout VERMELHO logo após a abertura quando há `alertas`; "Depende de você" vira um callout âmbar por pendência (por que importa, se atrasar, o que precisamos, impacto possível ou "impacto não estimado"); sem pendências o bloco é idêntico ao de antes.
- **Texto único** para os quatro relatórios (Notion curto, PDF semanal, relatório do sprint, documento do plano): `src/lib/pendencias-texto.js`.

## Plano B — tarefa no quadro (09/10/2026)

Pedido do David: "se você não conseguir criar a categoria, criar uma linha em tarefas de cada cliente: Canal geral, Nome Pamela, Demanda: Relatório; resumo do relatório em descrição". Em 21 dos 25 clientes a Secção da base Informações é do tipo **status** sem a opção «Relatório de Sprints Place2u» nem «Relatórios», e o Notion não cria opção de status pela API.

- **Config** (`config/relatorio-envio.json → fallback_tarefa`): `{ ligado, titulo_prefixo:'Relatório', canal:'Geral', demanda:'Relatório', responsavel:'Pamela', descricao_max:1900 }` (validado na carga; ausente = desligado).
- **Quando entra** (`relatorio-envio.montarPlano → planoTarefa`): só quando `fallback_tarefa.ligado` **e** o destino Informações bloquearia por `opcao_ausente_status`, `sem_pagina` ou `sem_base` **e** o quadro «Tarefas - {Cliente}» é localizável (`relatorio-tarefa.quadroDe`: fonte de `descobrirFontes`, schema com coluna de título). Nunca entra quando a Informações aceita (`ok`, `ok_alternativa`, `select_cria`), nem com `sem_categoria:true` (o líder escolheu a Informações sem categoria), nem para `pagina_invalida`, `sem_permissao`, `destino_compartilhado`, `base_invalida`. Sem quadro ou com o plano B desligado vale o bloqueio antigo. **O alerta ao cliente não usa o plano B.**
- **O que cria** (`src/lib/relatorio-tarefa.js`, mesmo molde de `relatorio-notion.js`): UMA página no quadro com título `${titulo_prefixo} · ${título do brief}` (ex.: «Relatório · Relatório de Sprints Place2u · 02/10 a 08/10/2026»), Canal e Demanda pelo mapa de `config/mapeamento.json` (select: o Notion cria a opção; status: só opção já existente, senão vazio + aviso), Responsável = `people` do usuário do Notion cujo nome normalizado (inteiro ou primeiro nome) bate com `responsavel` (0 ou 2+ usuários → sem responsável + aviso; fixe em `config/equipe.json → usuarios_notion`), Descrição = resumo (abertura + Resultados + Concluído + Próximos passos, ≤ `descricao_max`, auditado por `relatorio-seguro.auditarTexto` junto com o título — violação bloqueia como `conteudo`), Data = dia do envio, corpo = **os mesmos blocos** do relatório (≤100 por chamada, resto em PATCH por lotes). `retry5xx:false`; 5xx/timeout → consulta por título **no quadro** e adota. O mapa de propriedades do quadro (`mapearPropsQuadro`, `opcaoExistente`) é o mesmo de `distribuir-notion.js`, que passou a importá-lo daqui.
- **Prévia**: `acao:'criar_tarefa'` (ou `pular`/`adotar`), `destino_tipo:'tarefa'`, `tarefa:{ quadro_url, canal, demanda, responsavel, descricao, motivo }`, `categoria.estado:'nao_resolvida'`, aviso "…o relatório vai como tarefa no quadro Tarefas, Canal Geral, responsável Pamela". Para a Informações pronta nada muda (`destino_tipo:'informacoes'`).
- **Confirmar**: cria pela `relatorio-tarefa`, grava em `relatorio_envio` com `categoria='tarefa'`, `page_url` do card, estado `enviado`; mesma idempotência (índice único por cliente/de/ate + título no quadro). Reenvio do período = `ja_enviado`; `substituir` não vale para tarefa (nunca arquiva card do quadro). Resposta traz `destino_tipo:'tarefa'`.
- **Diagnóstico/liberação/agendador**: `diagnosticar` marca `pronto:true, categoria:'tarefa', proxima_acao:''` quando o plano B se aplica, então `liberar` e o `tick` seguem o caminho normal (`enviar` decide de novo na hora). A situação do cliente mostra "Destino: tarefa (Pamela) no quadro Tarefas"; o CSV mostra `tarefa (Pamela)` na coluna categoria; o histórico mostra `categoria:'tarefa'`.
- **Testes**: `scripts/teste-relatorio-tarefa.mjs` (puro) e blocos G1–G4 de `scripts/teste-relatorio-envio.mjs` (fixture: `quadro:true` em `relatorio-mundo.mjs`, `USUARIOS`/`PAMELA_ID`).

## Anexo PDF — documento do relatório na página (09/10/2026)

Pedido do David: "precisa ter o documento lá anexado no Notion". Depois de criar a página (Informações) ou a tarefa (plano B), o envio gera um PDF do **mesmo brief auditado** e o anexa à página. Feito de verdade nos 18 envios de 09/10/2026 (18/18 ok, por script contra o banco real).

- **Módulo** `src/lib/relatorio-pdf.js`: `briefParaHtml(brief, { cliente })` = HTML autocontido (estilo editorial de `estilo-editorial.js`, capa com o nome do cliente) **projetado dos mesmos blocos** de `briefParaBlocos` — as mesmas seções (abertura, Resultados em tabela, Atividades com as tarefas concluídas, Desenvolvimento, Próximos passos, Depende de você, rodapé), nenhum texto novo, e por isso passa pelo auditor de `relatorio-seguro.js` como os blocos (a capa usa a CATEGORIA fixa e não usa o `rodape()` do estilo, que cita "Notion"). `gerarPdf(html, destino, { timeout_ms })` = Chrome headless com os mesmos argumentos de `src/server.js`; arquivo em `data/relatorios/pdf/<cliente-normalizado>-<de>-<ate>.pdf`; sem Chrome → erro `pdf_indisponivel` (`pdf_timeout`, `pdf_falhou`). `anexarPdf({ notionReq, page_id, caminho, subir })` = `subirPdf` (File Upload API, `notion-publicar.js`, importado preguiçosamente) → `PATCH blocks/{page_id}/children` com um bloco `file` (`file_upload` + `name` = nome do arquivo) **logo depois do 1º bloco** (`after`; a API só insere "após" um bloco; página vazia = no fim, com o cabeçalho "Documento do relatório (PDF)"); se a página é linha de quadro cujo schema tem propriedade do tipo `files` (Anexos, Arquivo(s), Files, Documento(s), Attachments), grava também a propriedade com o mesmo upload (reupload uma vez se o Notion recusar reutilizar com 400). **Idempotente**: lista os filhos antes e não anexa se já existe bloco `file` com o mesmo nome (`acao:'ja_anexado'`).
- **Envio** (`relatorio-envio.executar`): depois de `enviado`/`adotado`/`substituido` (Informações ou tarefa) chama o anexo e devolve `anexo: 'ok' | 'falhou:<codigo>'`; coluna aditiva `relatorio_envio.anexo` (migração por `PRAGMA table_info` na fábrica). Falha do PDF/upload é **aviso** (log `aviso`), nunca desfaz o envio nem muda `estado`. `ja_enviado` (pular) não gera PDF. Config `config/relatorio-envio.json → anexo_pdf: { ligado: true, timeout_ms: 60000 }` (validado na carga; desligado = sem a chave `anexo` no retorno). Injeção para testes: `criarRelatorioEnvio({ …, pdf: { html, gerar, anexar, dir } })` (fixture `relatorio-mundo.mjs → w.pdf`, `w.pdfs`, `w.uploads`, `w.falhas.pdf/upload`).
- **Rotas** (`por` validado por líder/consultor → 403; `confirmar` só `=== true`):
  - `POST /api/relatorio/anexar { cliente, de, ate, por, confirmar? }` → prévia `{ ok, previa:true, cliente, de, ate, url, anexo_atual, faria:'anexar'|'conferir' }`; confirmar regenera o brief de hoje (**precisa ser a mesma janela** `de/ate`, senão `estado:'janela_diferente'`), audita os blocos, gera e anexa → `{ ok, estado:'anexado'|'falhou', anexo, url }`; sem envio vivo do período → `estado:'sem_envio'`; datas inválidas → 400.
  - `POST /api/relatorio/anexar-lote { desde, por, confirmar? }` → prévia `{ itens:[{ cliente, de, ate, url, anexo_atual }] }` (envios vivos com `anexo <> 'ok'` desde a data); confirmar → `{ job }` (tipo `anexar`, mesmo mutex do lote; acompanhe em `GET /job/:id`; itens `anexado` | `falhou`/`janela_diferente`…, `resumo: "N anexados · M com problema"`); nada pendente → `estado:'nada_a_anexar'`.
- **Tela** `/planos › Relatórios`: menu ⋯ → "Anexar PDF nos envios sem documento" (últimos 30 dias; prévia de quem entra → confirmar → barra do job). Sem botão primário novo. `historico[]` de `GET /cliente` ganha `anexo`.
- **Testes**: `scripts/teste-relatorio-pdf.mjs` (HTML sem vazamento, tarefas listadas, stub do Chrome e do upload, idempotência, propriedade files, falha não desfaz o envio, reanexo e lote), blocos H1–H2 de `teste-relatorio-envio.mjs` e o bloco das rotas novas em `teste-relatorio-rotas.mjs`.
